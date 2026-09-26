use crate::db::DbConnection;
use crate::sync::cache;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudDownloadState {
    pub file_id: i64,
    pub status: String,
    pub local_path: Option<String>,
}

#[tauri::command]
pub fn tcloud_get_download_state(
    db: State<'_, DbConnection>,
    file_id: i64,
) -> Result<TCloudDownloadState, String> {
    if let Some(path) = cache::get_cached_path(db.inner(), file_id)? {
        if path.exists() {
            return Ok(TCloudDownloadState {
                file_id,
                status: "cached".into(),
                local_path: Some(path.to_string_lossy().to_string()),
            });
        }
    }

    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT sync_status FROM tcloud_files WHERE id = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;

    let status = match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => stmt.read::<String, _>(0).map_err(|e| e.to_string())?,
        _ => "unknown".into(),
    };

    Ok(TCloudDownloadState {
        file_id,
        status,
        local_path: None,
    })
}
