use crate::db::DbConnection;
use crate::sync::cache;
use crate::sync::download::{resolve_or_queue_download, OpenFileResult};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudCacheInfo {
    pub cached: bool,
    pub local_path: Option<String>,
}

#[tauri::command]
pub fn tcloud_request_file(
    db: State<'_, DbConnection>,
    file_id: i64,
) -> Result<OpenFileResult, String> {
    resolve_or_queue_download(db.inner(), file_id)
}

#[tauri::command]
pub fn tcloud_get_cache_info(
    db: State<'_, DbConnection>,
    file_id: i64,
) -> Result<TCloudCacheInfo, String> {
    let path = cache::get_cached_path(db.inner(), file_id)?;
    let cached = path.as_ref().map(|p| p.exists()).unwrap_or(false);

    Ok(TCloudCacheInfo {
        cached,
        local_path: if cached {
            path.map(|p| p.to_string_lossy().to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub fn tcloud_remove_cached_copy(
    db: State<'_, DbConnection>,
    file_id: i64,
) -> Result<(), String> {
    if let Some(path) = cache::get_cached_path(db.inner(), file_id)? {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("failed to remove cached file: {e}"))?;
        }
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }

    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let mut delete = conn
        .prepare("DELETE FROM tcloud_cache WHERE file_id = ?1")
        .map_err(|e| e.to_string())?;
    delete.bind((1, file_id)).map_err(|e| e.to_string())?;
    delete.next().map_err(|e| e.to_string())?;

    let mut update = conn
        .prepare(
            "UPDATE tcloud_files SET local_status = 'online', updated_at = ?1 WHERE id = ?2"
        )
        .map_err(|e| e.to_string())?;
    update.bind((1, now)).map_err(|e| e.to_string())?;
    update.bind((2, file_id)).map_err(|e| e.to_string())?;
    update.next().map_err(|e| e.to_string())?;

    Ok(())
}
