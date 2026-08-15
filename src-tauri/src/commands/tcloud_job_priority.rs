use crate::db::DbConnection;
use tauri::State;

fn normalize_priority(priority: &str) -> Result<i64, String> {
    match priority {
        "high" => Ok(100),
        "normal" => Ok(0),
        "low" => Ok(-100),
        _ => Err("priority must be high, normal or low".into()),
    }
}

#[tauri::command]
pub fn tcloud_set_job_priority(
    db: State<'_, DbConnection>,
    job_id: i64,
    priority: String,
) -> Result<(), String> {
    let value = normalize_priority(priority.as_str())?;
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_sync_jobs
             SET priority = ?1, updated_at = ?2
             WHERE id = ?3"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, value)).map_err(|e| e.to_string())?;
    stmt.bind((2, now)).map_err(|e| e.to_string())?;
    stmt.bind((3, job_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    drop(stmt);
    drop(conn);
    crate::sync::scheduler::signal_sync_work();
    Ok(())
}
