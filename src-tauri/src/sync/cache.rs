//! TCloud local cache management.

use crate::db::DbConnection;
use std::path::{Path, PathBuf};

pub fn cache_root() -> Result<PathBuf, String> {
    let base = dirs::cache_dir().ok_or_else(|| "unable to resolve system cache directory".to_string())?;
    Ok(base.join("TCloud").join("files"))
}

pub fn ensure_cache_root() -> Result<PathBuf, String> {
    let root = cache_root()?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("failed to create TCloud cache: {e}"))?;
    Ok(root)
}

pub fn cached_path_for(file_id: i64, name: &str) -> Result<PathBuf, String> {
    let root = ensure_cache_root()?;
    Ok(root.join(file_id.to_string()).join(name))
}

pub fn mark_cached(
    db: &DbConnection,
    file_id: i64,
    local_path: &Path,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let path = local_path.to_string_lossy().to_string();
    {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

        {
            let mut stmt = conn
                .prepare(
                    "UPDATE tcloud_files
                     SET local_status = 'cached',
                         sync_status = 'synced',
                         updated_at = ?1
                     WHERE id = ?2"
                )
                .map_err(|e| e.to_string())?;
            stmt.bind((1, now)).map_err(|e| e.to_string())?;
            stmt.bind((2, file_id)).map_err(|e| e.to_string())?;
            stmt.next().map_err(|e| e.to_string())?;
        }

        {
            let mut meta = conn
                .prepare(
                    "INSERT INTO tcloud_cache(file_id, local_path, cached_at, last_accessed_at)
                     VALUES(?1, ?2, ?3, ?4)
                     ON CONFLICT(file_id) DO UPDATE SET
                        local_path = excluded.local_path,
                        cached_at = excluded.cached_at,
                        last_accessed_at = excluded.last_accessed_at"
                )
                .map_err(|e| e.to_string())?;
            meta.bind((1, file_id)).map_err(|e| e.to_string())?;
            meta.bind((2, path.as_str())).map_err(|e| e.to_string())?;
            meta.bind((3, now)).map_err(|e| e.to_string())?;
            meta.bind((4, now)).map_err(|e| e.to_string())?;
            meta.next().map_err(|e| e.to_string())?;
        }
    }
    let _ = crate::sync::cache_manager::enforce_cache_limit(db);
    Ok(())
}

pub fn get_cached_path(db: &DbConnection, file_id: i64) -> Result<Option<PathBuf>, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT local_path FROM tcloud_cache WHERE file_id = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;

    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => {
            let path = stmt.read::<String, _>(0).map_err(|e| e.to_string())?;
            Ok(Some(PathBuf::from(path)))
        }
        _ => Ok(None),
    }
}

pub fn touch_cache(db: &DbConnection, file_id: i64) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("UPDATE tcloud_cache SET last_accessed_at = ?1 WHERE file_id = ?2")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, now)).map_err(|e| e.to_string())?;
    stmt.bind((2, file_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}
