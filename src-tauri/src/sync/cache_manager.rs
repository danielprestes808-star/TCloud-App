//! TCloud cache size management.

use crate::db::DbConnection;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub file_id: i64,
    pub local_path: PathBuf,
    pub last_accessed_at: i64,
}

pub fn cache_limit_bytes(db: &DbConnection) -> Result<u64, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM tcloud_settings WHERE key = 'cache_limit_bytes' LIMIT 1")
        .map_err(|e| e.to_string())?;

    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => {
            let value = stmt.read::<String, _>(0).map_err(|e| e.to_string())?;
            value.parse::<u64>().map_err(|e| e.to_string())
        }
        _ => Ok(10 * 1024 * 1024 * 1024), // 10 GiB default
    }
}

pub fn set_cache_limit_bytes(db: &DbConnection, value: u64) -> Result<(), String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_settings(key, value)
             VALUES('cache_limit_bytes', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .map_err(|e| e.to_string())?;
    let value = value.to_string();
    stmt.bind((1, value.as_str())).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn current_cache_size(db: &DbConnection) -> Result<u64, String> {
    let entries = cache_entries(db)?;
    let mut total = 0_u64;
    for entry in entries {
        if let Ok(meta) = std::fs::metadata(&entry.local_path) {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

pub fn enforce_cache_limit(db: &DbConnection) -> Result<u64, String> {
    let limit = cache_limit_bytes(db)?;
    let all_entries = cache_entries(db)?;
    let mut entries = evictable_cache_entries(db)?;
    entries.sort_by_key(|entry| entry.last_accessed_at);

    // Phase 2: calculate size from the same snapshot we use for eviction. The old
    // code loaded the entire cache table twice, which doubled allocations and file
    // metadata calls on libraries with many thousands of cached items.
    let mut total = 0_u64;
    let mut missing_ids = Vec::new();
    for entry in &all_entries {
        match std::fs::metadata(&entry.local_path) {
            Ok(meta) => total = total.saturating_add(meta.len()),
            Err(_) => missing_ids.push(entry.file_id),
        }
    }

    if !missing_ids.is_empty() {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        for file_id in missing_ids {
            let mut del = conn
                .prepare("DELETE FROM tcloud_cache WHERE file_id = ?1")
                .map_err(|e| e.to_string())?;
            del.bind((1, file_id)).map_err(|e| e.to_string())?;
            del.next().map_err(|e| e.to_string())?;
        }
    }

    for entry in entries {
        if total <= limit {
            break;
        }

        let size = std::fs::metadata(&entry.local_path)
            .map(|m| m.len())
            .unwrap_or(0);
        if size == 0 && !entry.local_path.exists() {
            continue;
        }

        let _ = std::fs::remove_file(&entry.local_path);
        if let Some(parent) = entry.local_path.parent() {
            let _ = std::fs::remove_dir(parent);
        }

        {
            let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
            {
                let mut del = conn
                    .prepare("DELETE FROM tcloud_cache WHERE file_id = ?1")
                    .map_err(|e| e.to_string())?;
                del.bind((1, entry.file_id)).map_err(|e| e.to_string())?;
                del.next().map_err(|e| e.to_string())?;
            }

            {
                let mut upd = conn
                    .prepare("UPDATE tcloud_files SET local_status = 'online' WHERE id = ?1")
                    .map_err(|e| e.to_string())?;
                upd.bind((1, entry.file_id)).map_err(|e| e.to_string())?;
                upd.next().map_err(|e| e.to_string())?;
            }
        }

        total = total.saturating_sub(size);
    }

    Ok(total)
}

pub fn free_cache_older_than(db: &DbConnection, days: i64) -> Result<u64, String> {
    if days <= 0 { return Ok(0); }
    let cutoff = chrono::Utc::now().timestamp() - days.clamp(1, 365) * 86_400;
    let entries = {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        let mut stmt = conn.prepare(
            "SELECT c.file_id,c.local_path
             FROM tcloud_cache c
             WHERE c.last_accessed_at < ?1
               AND NOT EXISTS (SELECT 1 FROM tcloud_offline_pins p WHERE p.file_id=c.file_id)
             ORDER BY c.last_accessed_at ASC"
        ).map_err(|e|e.to_string())?;
        stmt.bind((1,cutoff)).map_err(|e|e.to_string())?;
        let mut out=Vec::new();
        while let sqlite::State::Row=stmt.next().map_err(|e|e.to_string())? {
            out.push((stmt.read::<i64,_>(0).map_err(|e|e.to_string())?, PathBuf::from(stmt.read::<String,_>(1).map_err(|e|e.to_string())?)));
        }
        out
    };
    let mut freed=0u64;
    for (file_id,path) in entries {
        let size=std::fs::metadata(&path).map(|m|m.len()).unwrap_or(0);
        if path.exists() { let _=std::fs::remove_file(&path); }
        if let Some(parent)=path.parent(){let _=std::fs::remove_dir(parent);}
        let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?;
        let mut del=conn.prepare("DELETE FROM tcloud_cache WHERE file_id=?1").map_err(|e|e.to_string())?;
        del.bind((1,file_id)).map_err(|e|e.to_string())?;del.next().map_err(|e|e.to_string())?;drop(del);
        let mut upd=conn.prepare("UPDATE tcloud_files SET local_status='online' WHERE id=?1").map_err(|e|e.to_string())?;
        upd.bind((1,file_id)).map_err(|e|e.to_string())?;upd.next().map_err(|e|e.to_string())?;
        freed=freed.saturating_add(size);
    }
    Ok(freed)
}

fn evictable_cache_entries(db: &DbConnection) -> Result<Vec<CacheEntry>, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn.prepare(
        "SELECT c.file_id,c.local_path,c.last_accessed_at
         FROM tcloud_cache c
         WHERE NOT EXISTS (SELECT 1 FROM tcloud_offline_pins p WHERE p.file_id=c.file_id)
         ORDER BY c.last_accessed_at ASC"
    ).map_err(|e|e.to_string())?;
    let mut items=Vec::new();
    while let sqlite::State::Row=stmt.next().map_err(|e|e.to_string())? {
        items.push(CacheEntry{
            file_id:stmt.read::<i64,_>(0).map_err(|e|e.to_string())?,
            local_path:PathBuf::from(stmt.read::<String,_>(1).map_err(|e|e.to_string())?),
            last_accessed_at:stmt.read::<i64,_>(2).unwrap_or(0),
        });
    }
    Ok(items)
}

fn cache_entries(db: &DbConnection) -> Result<Vec<CacheEntry>, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT file_id, local_path, last_accessed_at
             FROM tcloud_cache
             ORDER BY last_accessed_at ASC"
        )
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        items.push(CacheEntry {
            file_id: stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            local_path: PathBuf::from(
                stmt.read::<String, _>(1).map_err(|e| e.to_string())?
            ),
            last_accessed_at: stmt.read::<i64, _>(2).unwrap_or(0),
        });
    }
    Ok(items)
}
