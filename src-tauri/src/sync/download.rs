//! TCloud download-on-demand orchestration.
//!
//! This module resolves a file from cache first. If absent, it creates a
//! durable download job for the existing Telegram queue processor.

use crate::db::DbConnection;
use crate::sync::cache::{get_cached_path, touch_cache};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFileResult {
    pub ready: bool,
    pub local_path: Option<String>,
    pub queued: bool,
}

pub fn resolve_or_queue_download(
    db: &DbConnection,
    file_id: i64,
) -> Result<OpenFileResult, String> {
    if let Some(path) = get_cached_path(db, file_id)? {
        if path.exists() {
            touch_cache(db, file_id)?;
            return Ok(OpenFileResult {
                ready: true,
                local_path: Some(path.to_string_lossy().to_string()),
                queued: false,
            });
        }
    }

    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let mut exists = conn
        .prepare(
            "SELECT id FROM tcloud_sync_jobs
             WHERE file_id = ?1 AND operation = 'download'
               AND status IN ('pending','running')
             LIMIT 1"
        )
        .map_err(|e| e.to_string())?;
    exists.bind((1, file_id)).map_err(|e| e.to_string())?;

    if let sqlite::State::Row = exists.next().map_err(|e| e.to_string())? {
        return Ok(OpenFileResult {
            ready: false,
            local_path: None,
            queued: true,
        });
    }

    let mut job = conn
        .prepare(
            "INSERT INTO tcloud_sync_jobs(file_id, operation, status, created_at, updated_at, priority)
             VALUES(?1, 'download', 'pending', ?2, ?3, 150)"
        )
        .map_err(|e| e.to_string())?;
    job.bind((1, file_id)).map_err(|e| e.to_string())?;
    job.bind((2, now)).map_err(|e| e.to_string())?;
    job.bind((3, now)).map_err(|e| e.to_string())?;
    job.next().map_err(|e| e.to_string())?;

    let mut update = conn
        .prepare(
            "UPDATE tcloud_files
             SET local_status = 'online', sync_status = 'downloading', updated_at = ?1
             WHERE id = ?2"
        )
        .map_err(|e| e.to_string())?;
    update.bind((1, now)).map_err(|e| e.to_string())?;
    update.bind((2, file_id)).map_err(|e| e.to_string())?;
    update.next().map_err(|e| e.to_string())?;
    drop(update);
    drop(job);
    drop(exists);
    drop(conn);
    crate::sync::scheduler::signal_sync_work();

    Ok(OpenFileResult {
        ready: false,
        local_path: None,
        queued: true,
    })
}
