// TCloud 13.0.17 - Smart Storage Guard
// Keeps the local backing cache bounded without touching Telegram data or files
// explicitly pinned as "Disponivel offline".

use crate::db::DbConnection;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

const DEFAULT_CACHE_LIMIT_BYTES: i64 = 1536 * 1024 * 1024; // TCLOUD_MEDIA_MANAGER_90_STORAGE
const DEFAULT_HIGH_WATER_PERCENT: i64 = 80;
const DEFAULT_TARGET_PERCENT: i64 = 60;
const DEFAULT_VIDEO_TTL_HOURS: i64 = 24;
const LOW_DISK_TRIGGER_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const LOW_DISK_TARGET_BYTES: u64 = 12 * 1024 * 1024 * 1024;
const RECENT_ACCESS_GRACE_SECONDS: i64 = 10 * 60;

#[derive(Debug)]
struct CacheEntry {
    file_id: i64,
    local_path: PathBuf,
    last_accessed_at: i64,
    name: String,
    mime_type: String,
    pinned: bool,
    active: bool,
    bytes: u64,
}

fn read_setting(conn: &sqlite::Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM tcloud_settings WHERE key=?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => Ok(stmt.read::<String, _>(0).ok()),
        _ => Ok(None),
    }
}

fn write_setting(conn: &sqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_settings(key,value) VALUES(?1,?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    stmt.bind((2, value)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_setting(conn: &sqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    if read_setting(conn, key)?.is_none() {
        write_setting(conn, key, value)?;
    }
    Ok(())
}

pub fn install_storage_defaults(db: &DbConnection) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tcloud_settings (key TEXT PRIMARY KEY NOT NULL,value TEXT); \
         CREATE TABLE IF NOT EXISTS tcloud_offline_pins(file_id INTEGER PRIMARY KEY,pinned_at INTEGER NOT NULL);",
    )
    .map_err(|e| e.to_string())?;

    let migrated = read_setting(&conn, "storage_guard_v1317_applied")?
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);

    if !migrated {
        let current = read_setting(&conn, "cache_limit_bytes")?
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|v| *v > 0);
        let next = current
            .map(|v| v.min(DEFAULT_CACHE_LIMIT_BYTES))
            .unwrap_or(DEFAULT_CACHE_LIMIT_BYTES);
        write_setting(&conn, "cache_limit_bytes", &next.to_string())?;
        write_setting(&conn, "storage_guard_v1317_applied", "1")?;
    }

    ensure_setting(&conn, "cache_auto_cleanup", "1")?;
    ensure_setting(&conn, "cache_video_temporary", "1")?;
    ensure_setting(
        &conn,
        "cache_video_ttl_hours",
        &DEFAULT_VIDEO_TTL_HOURS.to_string(),
    )?;
    ensure_setting(
        &conn,
        "cache_cleanup_high_percent",
        &DEFAULT_HIGH_WATER_PERCENT.to_string(),
    )?;
    ensure_setting(
        &conn,
        "cache_cleanup_target_percent",
        &DEFAULT_TARGET_PERCENT.to_string(),
    )?;
    Ok(())
}

fn is_video(entry: &CacheEntry) -> bool {
    if entry.mime_type.to_ascii_lowercase().starts_with("video/") {
        return true;
    }
    let lower = entry.name.to_ascii_lowercase();
    [
        ".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".wmv", ".mpeg", ".mpg", ".ts",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn available_bytes_for(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().to_string_lossy().len())
        .map(|disk| disk.available_space())
}

fn delete_cache_row(db: &DbConnection, file_id: i64) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("DELETE FROM tcloud_cache WHERE file_id=?1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_entry(db: &DbConnection, entry: &CacheEntry) -> u64 {
    match std::fs::remove_file(&entry.local_path) {
        Ok(()) => {
            let _ = delete_cache_row(db, entry.file_id);
            entry.bytes
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let _ = delete_cache_row(db, entry.file_id);
            0
        }
        Err(error) => {
            log::debug!(
                "TCloud Smart Storage: cache {} nao pode ser liberado agora: {}",
                entry.local_path.display(),
                error
            );
            0
        }
    }
}

fn load_entries(db: &DbConnection) -> Result<Vec<CacheEntry>, String> {
    let rows = {
        let conn = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT c.file_id,c.local_path,c.last_accessed_at, \
                        COALESCE(f.name,''),COALESCE(f.mime_type,''), \
                        CASE WHEN EXISTS(SELECT 1 FROM tcloud_offline_pins p WHERE p.file_id=c.file_id) THEN 1 ELSE 0 END, \
                        CASE WHEN EXISTS(SELECT 1 FROM tcloud_sync_jobs j WHERE j.file_id=c.file_id AND j.status IN ('pending','running','paused')) THEN 1 ELSE 0 END \
                 FROM tcloud_cache c \
                 LEFT JOIN tcloud_files f ON f.id=c.file_id \
                 ORDER BY c.last_accessed_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
            rows.push((
                stmt.read::<i64, _>(0).unwrap_or(0),
                stmt.read::<String, _>(1).unwrap_or_default(),
                stmt.read::<i64, _>(2).unwrap_or(0),
                stmt.read::<String, _>(3).unwrap_or_default(),
                stmt.read::<String, _>(4).unwrap_or_default(),
                stmt.read::<i64, _>(5).unwrap_or(0) != 0,
                stmt.read::<i64, _>(6).unwrap_or(0) != 0,
            ));
        }
        rows
    };

    Ok(rows
        .into_iter()
        .map(
            |(file_id, local_path, last_accessed_at, name, mime_type, pinned, active)| {
                let local_path = PathBuf::from(local_path);
                let bytes = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
                CacheEntry {
                    file_id,
                    local_path,
                    last_accessed_at,
                    name,
                    mime_type,
                    pinned,
                    active,
                    bytes,
                }
            },
        )
        .collect())
}

pub fn run_storage_guard_once(db: &DbConnection) -> Result<u64, String> {
    install_storage_defaults(db)?;

    let (limit, high_percent, target_percent, video_ttl_hours, auto_cleanup, video_temporary) = {
        let conn = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let limit = read_setting(&conn, "cache_limit_bytes")?
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_CACHE_LIMIT_BYTES as u64);
        let high = read_setting(&conn, "cache_cleanup_high_percent")?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_HIGH_WATER_PERCENT as u64)
            .clamp(50, 95);
        let target = read_setting(&conn, "cache_cleanup_target_percent")?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_TARGET_PERCENT as u64)
            .clamp(20, high.saturating_sub(5));
        let ttl = read_setting(&conn, "cache_video_ttl_hours")?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(DEFAULT_VIDEO_TTL_HOURS)
            .clamp(1, 720);
        let auto_cleanup = read_setting(&conn, "cache_auto_cleanup")?
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true);
        let video_temporary = read_setting(&conn, "cache_video_temporary")?
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true);
        (limit, high, target, ttl, auto_cleanup, video_temporary)
    };

    if !auto_cleanup {
        return Ok(0);
    }

    let now = chrono::Utc::now().timestamp();
    let video_cutoff = now.saturating_sub(video_ttl_hours.saturating_mul(3600));
    let recent_cutoff = now.saturating_sub(RECENT_ACCESS_GRACE_SECONDS);
    let mut entries = load_entries(db)?;
    let mut total = entries.iter().map(|e| e.bytes).sum::<u64>();
    let mut reclaimed = 0u64;

    // Remove stale database rows first. No file is touched here because it is already absent.
    for entry in entries
        .iter()
        .filter(|e| e.bytes == 0 && !e.local_path.exists())
    {
        let _ = delete_cache_row(db, entry.file_id);
    }

    // Videos are temporary unless explicitly pinned for offline use.
    if video_temporary {
        for entry in entries
            .iter()
            .filter(|e| !e.pinned && !e.active && is_video(e) && e.last_accessed_at <= video_cutoff)
        {
            let bytes = remove_entry(db, entry);
            reclaimed = reclaimed.saturating_add(bytes);
            total = total.saturating_sub(bytes);
        }
    }

    // Re-load after the video pass so rows already removed are not selected twice.
    entries = load_entries(db)?;
    total = entries.iter().map(|e| e.bytes).sum::<u64>();

    let probe_path = entries
        .first()
        .map(|e| e.local_path.clone())
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from));
    let mut free_estimate = probe_path.as_deref().and_then(available_bytes_for);
    let low_disk = free_estimate
        .map(|v| v < LOW_DISK_TRIGGER_BYTES)
        .unwrap_or(false);
    let high_water = limit.saturating_mul(high_percent) / 100;
    let target = limit.saturating_mul(target_percent) / 100;

    if total > high_water || low_disk {
        for entry in entries
            .iter()
            .filter(|e| !e.pinned && !e.active && e.last_accessed_at <= recent_cutoff)
        {
            let cache_ok = total <= target;
            let disk_ok = if low_disk {
                free_estimate
                    .map(|free| free >= LOW_DISK_TARGET_BYTES)
                    .unwrap_or(true)
            } else {
                true
            };
            if cache_ok && disk_ok {
                break;
            }
            let bytes = remove_entry(db, entry);
            reclaimed = reclaimed.saturating_add(bytes);
            total = total.saturating_sub(bytes);
            if let Some(free) = free_estimate.as_mut() {
                *free = free.saturating_add(bytes);
            }
        }
    }

    if reclaimed > 0 {
        log::info!(
            "TCloud Smart Storage liberou {} byte(s) do cache local nao fixado.",
            reclaimed
        );
    }
    Ok(reclaimed)
}

fn run_manual_cleanup(db: &DbConnection) -> Result<u64, String> {
    install_storage_defaults(db)?;
    let now = chrono::Utc::now().timestamp();
    let recent_cutoff = now.saturating_sub(RECENT_ACCESS_GRACE_SECONDS);
    let entries = load_entries(db)?;
    let mut reclaimed = 0u64;
    for entry in entries.iter() {
        if entry.bytes == 0 && !entry.local_path.exists() {
            let _ = delete_cache_row(db, entry.file_id);
            continue;
        }
        if entry.pinned || entry.active || entry.last_accessed_at > recent_cutoff {
            continue;
        }
        reclaimed = reclaimed.saturating_add(remove_entry(db, entry));
    }
    Ok(reclaimed)
}

#[tauri::command]
pub async fn tcloud_storage_guard_cleanup_now(db: State<'_, DbConnection>) -> Result<u64, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || run_manual_cleanup(&db))
        .await
        .map_err(|e| e.to_string())?
}

pub fn start_storage_guard(db: DbConnection) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            let worker_db = db.clone();
            match tokio::task::spawn_blocking(move || run_storage_guard_once(&worker_db)).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => log::warn!("TCloud Smart Storage: {}", error),
                Err(error) => log::warn!("TCloud Smart Storage worker falhou: {}", error),
            }
            tokio::time::sleep(Duration::from_secs(10 * 60)).await;
        }
    });
}
