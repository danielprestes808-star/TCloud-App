use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::sync::watcher_runtime::TCloudWatcherState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfigResponse {
    pub local_root: Option<String>,
    pub watcher_enabled: bool,
    pub recovered_previous_session: bool,
    pub database_healthy: bool,
    pub last_maintenance_at: Option<i64>,
    pub last_deep_maintenance_at: Option<i64>,
    pub last_resume_at: Option<i64>,
}

fn upsert_setting(conn: &sqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("INSERT INTO tcloud_settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    stmt.bind((2, value)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_setting(conn: &sqlite::Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM tcloud_settings WHERE key = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => stmt.read::<String, _>(0).map(Some).map_err(|e| e.to_string()),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn tcloud_set_sync_folder(db: State<'_, DbConnection>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() { return Err("sync folder cannot be empty".into()); }
    let folder = std::path::PathBuf::from(trimmed);
    if !folder.exists() {
        std::fs::create_dir_all(&folder).map_err(|e| format!("failed to create sync folder: {e}"))?;
    }
    if !folder.is_dir() { return Err("sync path must be a folder".into()); }
    let value = folder.to_string_lossy().to_string();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    upsert_setting(&conn, "local_root", &value)?;
    Ok(value)
}

#[tauri::command]
pub fn tcloud_set_watcher_enabled(
    db: State<'_, DbConnection>,
    watcher: State<'_, TCloudWatcherState>,
    enabled: bool,
) -> Result<bool, String> {
    if enabled {
        let root = {
            let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
            read_setting(&conn, "local_root")?
                .ok_or_else(|| "choose a TCloud sync folder before enabling synchronization".to_string())?
        };
        watcher.start(std::path::PathBuf::from(root), db.inner().clone())?;
    } else {
        watcher.stop()?;
    }

    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    upsert_setting(&conn, "watcher_enabled", if enabled { "1" } else { "0" })?;
    Ok(enabled)
}

#[tauri::command]
pub fn tcloud_get_watcher_status(
    watcher: State<'_, TCloudWatcherState>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": watcher.is_running(),
        "root": watcher.root().map(|p| p.to_string_lossy().to_string())
    }))
}

#[tauri::command]
pub fn tcloud_get_sync_config(db: State<'_, DbConnection>) -> Result<SyncConfigResponse, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let local_root = read_setting(&conn, "local_root")?;
    let watcher_enabled = read_setting(&conn, "watcher_enabled")?
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    let recovered_previous_session = read_setting(&conn, "stability_previous_unclean")?
        .map(|v| v == "1")
        .unwrap_or(false);
    let database_healthy = read_setting(&conn, "stability_db_check")?
        .map(|v| v != "attention")
        .unwrap_or(true);
    let last_maintenance_at = read_setting(&conn, "stability_last_maintenance_at")?
        .and_then(|v| v.parse::<i64>().ok());
    let last_deep_maintenance_at = read_setting(&conn, "stability_last_deep_maintenance_at")?
        .and_then(|v| v.parse::<i64>().ok());
    let last_resume_at = read_setting(&conn, "stability_last_resume_at")?
        .and_then(|v| v.parse::<i64>().ok());
    Ok(SyncConfigResponse {
        local_root,
        watcher_enabled,
        recovered_previous_session,
        database_healthy,
        last_maintenance_at,
        last_deep_maintenance_at,
        last_resume_at,
    })
}
