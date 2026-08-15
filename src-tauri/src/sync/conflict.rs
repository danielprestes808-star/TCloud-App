//! TCloud conflict detection helpers.

use crate::db::DbConnection;

pub fn record_conflict(
    db: &DbConnection,
    file_id: i64,
    local_hash: Option<&str>,
    remote_hash: Option<&str>,
) -> Result<i64, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_sync_conflicts(
                file_id, local_hash, remote_hash, resolution, created_at
             ) VALUES(?1, ?2, ?3, 'pending', ?4)"
        )
        .map_err(|e| e.to_string())?;

    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
    match local_hash {
        Some(v) => stmt.bind((2, v)).map_err(|e| e.to_string())?,
        None => stmt.bind((2, sqlite::Value::Null)).map_err(|e| e.to_string())?,
    }
    match remote_hash {
        Some(v) => stmt.bind((3, v)).map_err(|e| e.to_string())?,
        None => stmt.bind((3, sqlite::Value::Null)).map_err(|e| e.to_string())?,
    }
    stmt.bind((4, now)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;

    let id = crate::db::last_insert_rowid(&conn)?;

    let mut update = conn
        .prepare("UPDATE tcloud_files SET sync_status = 'conflict', updated_at = ?1 WHERE id = ?2")
        .map_err(|e| e.to_string())?;
    update.bind((1, now)).map_err(|e| e.to_string())?;
    update.bind((2, file_id)).map_err(|e| e.to_string())?;
    update.next().map_err(|e| e.to_string())?;

    Ok(id)
}
