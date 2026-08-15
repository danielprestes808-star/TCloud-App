use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSetupFolder {
    pub name: String,
    pub create_group: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSetupPlan {
    pub folders: Vec<TCloudSetupFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSetupState {
    pub completed: bool,
    pub folder_count: i64,
}

fn upsert_setting(conn: &sqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_settings(key, value)
             VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    stmt.bind((2, value)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

fn scalar_i64(conn: &sqlite::Connection, sql: &str) -> Result<i64, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => stmt.read::<i64, _>(0).map_err(|e| e.to_string()),
        _ => Ok(0),
    }
}

#[tauri::command]
pub fn tcloud_get_setup_state(
    db: State<'_, DbConnection>,
) -> Result<TCloudSetupState, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let folder_count = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM tcloud_folders WHERE parent_id IS NOT NULL"
    )?;

    let mut stmt = conn
        .prepare("SELECT value FROM tcloud_settings WHERE key = 'setup_completed' LIMIT 1")
        .map_err(|e| e.to_string())?;

    let completed = match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => stmt
            .read::<String, _>(0)
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
            .unwrap_or(false),
        _ => false,
    };

    Ok(TCloudSetupState {
        completed,
        folder_count,
    })
}

#[tauri::command]
pub fn tcloud_create_default_folders(
    db: State<'_, DbConnection>,
    plan: TCloudSetupPlan,
) -> Result<Vec<i64>, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let root_id = {
        let mut stmt = conn
            .prepare("SELECT id FROM tcloud_folders WHERE parent_id IS NULL ORDER BY id LIMIT 1")
            .map_err(|e| e.to_string())?;
        match stmt.next().map_err(|e| e.to_string())? {
            sqlite::State::Row => stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            _ => return Err("TCloud root folder not found".into()),
        }
    };

    let mut ids = Vec::new();

    for item in plan.folders {
        let name = item.name.trim();
        if name.is_empty() {
            continue;
        }

        let path = format!("/{}", name);

        let mut exists = conn
            .prepare("SELECT id FROM tcloud_folders WHERE path = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        exists.bind((1, path.as_str())).map_err(|e| e.to_string())?;
        if let sqlite::State::Row = exists.next().map_err(|e| e.to_string())? {
            ids.push(exists.read::<i64, _>(0).map_err(|e| e.to_string())?);
            continue;
        }

        let mut insert = conn
            .prepare(
                "INSERT INTO tcloud_folders(
                    parent_id, name, path, created_at, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5)"
            )
            .map_err(|e| e.to_string())?;
        insert.bind((1, root_id)).map_err(|e| e.to_string())?;
        insert.bind((2, name)).map_err(|e| e.to_string())?;
        insert.bind((3, path.as_str())).map_err(|e| e.to_string())?;
        insert.bind((4, now)).map_err(|e| e.to_string())?;
        insert.bind((5, now)).map_err(|e| e.to_string())?;
        insert.next().map_err(|e| e.to_string())?;
        ids.push(crate::db::last_insert_rowid(&conn)?);
    }

    upsert_setting(&conn, "setup_completed", "1")?;
    Ok(ids)
}

#[tauri::command]
pub fn tcloud_reset_setup_state(
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    upsert_setting(&conn, "setup_completed", "0")
}
