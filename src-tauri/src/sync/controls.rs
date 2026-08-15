//! TCloud transfer control helpers.

use crate::db::DbConnection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobControlState {
    Continue,
    Paused,
    Cancelled,
}

pub fn job_control_state(
    db: &DbConnection,
    job_id: i64,
) -> Result<JobControlState, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT paused, cancel_requested
             FROM tcloud_sync_jobs
             WHERE id = ?1
             LIMIT 1"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, job_id)).map_err(|e| e.to_string())?;

    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => {
            let paused = stmt.read::<i64, _>(0).unwrap_or(0) != 0;
            let cancelled = stmt.read::<i64, _>(1).unwrap_or(0) != 0;
            if cancelled {
                Ok(JobControlState::Cancelled)
            } else if paused {
                Ok(JobControlState::Paused)
            } else {
                Ok(JobControlState::Continue)
            }
        }
        _ => Err("sync job not found".into()),
    }
}

pub fn mark_cancelled(
    db: &DbConnection,
    job_id: i64,
) -> Result<(), String> {
    crate::sync::progress::forget_transfer(job_id);
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_sync_jobs
             SET status = 'cancelled',
                 error = NULL,
                 speed_bps = 0,
                 eta_seconds = NULL,
                 updated_at = ?1
             WHERE id = ?2"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, now)).map_err(|e| e.to_string())?;
    stmt.bind((2, job_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn wait_if_paused(
    db: &DbConnection,
    job_id: i64,
) -> Result<JobControlState, String> {
    job_control_state(db, job_id)
}
