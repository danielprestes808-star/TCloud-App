use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudFolderNode {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub path: String,
    pub telegram_chat_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudFolderCreateInput {
    pub parent_id: Option<i64>,
    pub name: String,
    pub telegram_chat_id: Option<i64>,
}

fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("folder name cannot contain path separators".into());
    }
    Ok(trimmed.to_string())
}

fn load_parent_path(conn: &sqlite::Connection, parent_id: Option<i64>) -> Result<String, String> {
    match parent_id {
        None => Ok("/".to_string()),
        Some(id) => {
            let mut stmt = conn
                .prepare("SELECT path FROM tcloud_folders WHERE id = ?1 LIMIT 1")
                .map_err(|e| e.to_string())?;
            stmt.bind((1, id)).map_err(|e| e.to_string())?;
            match stmt.next().map_err(|e| e.to_string())? {
                sqlite::State::Row => stmt.read::<String, _>(0).map_err(|e| e.to_string()),
                _ => Err("parent folder not found".into()),
            }
        }
    }
}

#[tauri::command]
pub fn tcloud_list_folder_tree(
    db: State<'_, DbConnection>,
) -> Result<Vec<TCloudFolderNode>, String> {
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, name, path, telegram_chat_id, created_at, updated_at
             FROM tcloud_folders
             ORDER BY path COLLATE NOCASE ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        items.push(TCloudFolderNode {
            id: stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            parent_id: stmt.read::<Option<i64>, _>(1).unwrap_or(None),
            name: stmt.read::<String, _>(2).map_err(|e| e.to_string())?,
            path: stmt.read::<String, _>(3).map_err(|e| e.to_string())?,
            telegram_chat_id: stmt.read::<Option<i64>, _>(4).unwrap_or(None),
            created_at: stmt.read::<i64, _>(5).unwrap_or(0),
            updated_at: stmt.read::<i64, _>(6).unwrap_or(0),
        });
    }
    Ok(items)
}

#[tauri::command]
pub fn tcloud_create_logical_folder(
    db: State<'_, DbConnection>,
    input: TCloudFolderCreateInput,
) -> Result<TCloudFolderNode, String> {
    let name = sanitize_name(&input.name)?;
    let now = chrono::Utc::now().timestamp();

    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let parent_path = load_parent_path(&conn, input.parent_id)?;
    let path = if parent_path == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", parent_path.trim_end_matches('/'), name)
    };

    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_folders(
                parent_id, name, path, telegram_chat_id, created_at, updated_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|e| e.to_string())?;

    match input.parent_id {
        Some(id) => stmt.bind((1, id)).map_err(|e| e.to_string())?,
        None => stmt
            .bind((1, sqlite::Value::Null))
            .map_err(|e| e.to_string())?,
    }
    stmt.bind((2, name.as_str())).map_err(|e| e.to_string())?;
    stmt.bind((3, path.as_str())).map_err(|e| e.to_string())?;
    match input.telegram_chat_id {
        Some(id) => stmt.bind((4, id)).map_err(|e| e.to_string())?,
        None => stmt
            .bind((4, sqlite::Value::Null))
            .map_err(|e| e.to_string())?,
    }
    stmt.bind((5, now)).map_err(|e| e.to_string())?;
    stmt.bind((6, now)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;

    let id = crate::db::last_insert_rowid(&conn)?;
    Ok(TCloudFolderNode {
        id,
        parent_id: input.parent_id,
        name,
        path,
        telegram_chat_id: input.telegram_chat_id,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn tcloud_update_folder_group(
    db: State<'_, DbConnection>,
    folder_id: i64,
    telegram_chat_id: Option<i64>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_folders
             SET telegram_chat_id = ?1, updated_at = ?2
             WHERE id = ?3",
        )
        .map_err(|e| e.to_string())?;

    match telegram_chat_id {
        Some(id) => stmt.bind((1, id)).map_err(|e| e.to_string())?,
        None => stmt
            .bind((1, sqlite::Value::Null))
            .map_err(|e| e.to_string())?,
    }
    stmt.bind((2, now)).map_err(|e| e.to_string())?;
    stmt.bind((3, folder_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn tcloud_delete_logical_folder(
    db: State<'_, DbConnection>,
    folder_id: i64,
) -> Result<(), String> {
    if folder_id == 1 {
        return Err("root TCloud folder cannot be deleted".into());
    }

    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;

    let mut files = conn
        .prepare("SELECT COUNT(*) FROM tcloud_files WHERE folder_id = ?1")
        .map_err(|e| e.to_string())?;
    files.bind((1, folder_id)).map_err(|e| e.to_string())?;
    if let sqlite::State::Row = files.next().map_err(|e| e.to_string())? {
        let count = files.read::<i64, _>(0).unwrap_or(0);
        if count > 0 {
            return Err("folder contains files; move or delete them first".into());
        }
    }

    let mut children = conn
        .prepare("SELECT COUNT(*) FROM tcloud_folders WHERE parent_id = ?1")
        .map_err(|e| e.to_string())?;
    children.bind((1, folder_id)).map_err(|e| e.to_string())?;
    if let sqlite::State::Row = children.next().map_err(|e| e.to_string())? {
        let count = children.read::<i64, _>(0).unwrap_or(0);
        if count > 0 {
            return Err("folder contains subfolders; remove them first".into());
        }
    }

    let mut stmt = conn
        .prepare("DELETE FROM tcloud_folders WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, folder_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}
