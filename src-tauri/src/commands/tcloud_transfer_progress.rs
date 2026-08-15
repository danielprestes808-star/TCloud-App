use crate::db::DbConnection;
use crate::sync::progress;
use tauri::State;

#[tauri::command]
pub fn tcloud_transfer_start(
    db: State<'_, DbConnection>,
    job_id: i64,
    bytes_total: i64,
) -> Result<(), String> {
    progress::start_transfer(db.inner(), job_id, bytes_total)
}

#[tauri::command]
pub fn tcloud_transfer_progress(
    db: State<'_, DbConnection>,
    job_id: i64,
    bytes_transferred: i64,
) -> Result<(), String> {
    progress::update_transfer_progress(db.inner(), job_id, bytes_transferred)
}

#[tauri::command]
pub fn tcloud_transfer_finish(
    db: State<'_, DbConnection>,
    job_id: i64,
) -> Result<(), String> {
    progress::finish_transfer(db.inner(), job_id)
}
