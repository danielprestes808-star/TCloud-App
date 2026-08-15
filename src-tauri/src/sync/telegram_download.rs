//! TCloud real download worker support.
//!
//! This module resolves a remote TCloud file, obtains its Telegram message/file
//! reference from SQLite, downloads it through the existing authenticated
//! Telegram client, and stores the result in the local cache.

use crate::db::DbConnection;
use crate::sync::cache::{cached_path_for, mark_cached};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RemoteDownloadRecord {
    pub file_id: i64,
    pub name: String,
    pub telegram_chat_id: i64,
    pub telegram_message_id: i64,
}

pub fn load_remote_record(
    db: &DbConnection,
    file_id: i64,
) -> Result<RemoteDownloadRecord, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, telegram_chat_id, telegram_message_id
             FROM tcloud_files
             WHERE id = ?1
               AND telegram_chat_id IS NOT NULL
               AND telegram_message_id IS NOT NULL
             LIMIT 1"
        )
        .map_err(|e| e.to_string())?;

    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;

    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => Ok(RemoteDownloadRecord {
            file_id: stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            name: stmt.read::<String, _>(1).map_err(|e| e.to_string())?,
            telegram_chat_id: stmt.read::<i64, _>(2).map_err(|e| e.to_string())?,
            telegram_message_id: stmt.read::<i64, _>(3).map_err(|e| e.to_string())?,
        }),
        _ => Err("remote Telegram reference not found for TCloud file".into()),
    }
}

pub fn prepare_cache_target(record: &RemoteDownloadRecord) -> Result<PathBuf, String> {
    let path = cached_path_for(record.file_id, &record.name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create cache folder: {e}"))?;
    }
    Ok(path)
}

pub fn complete_download(
    db: &DbConnection,
    file_id: i64,
    target: &PathBuf,
) -> Result<(), String> {
    mark_cached(db, file_id, target)
}
