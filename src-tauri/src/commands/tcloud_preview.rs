use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudPreviewInfo {
    pub file_id: i64,
    pub name: String,
    pub mime_type: Option<String>,
    pub ready: bool,
    pub local_path: Option<String>,
    pub queued: bool,
    pub message: String,
}

fn safe_relative_path(raw: &str) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            std::path::Component::Normal(value) => result.push(value),
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(result)
}

fn sync_root(conn: &sqlite::Connection) -> Option<PathBuf> {
    let mut stmt = conn
        .prepare(
            "SELECT value FROM tcloud_settings
             WHERE key IN ('sync_folder','local_root')
             ORDER BY CASE key WHEN 'sync_folder' THEN 0 ELSE 1 END
             LIMIT 1",
        )
        .ok()?;
    match stmt.next().ok()? {
        sqlite::State::Row => stmt.read::<String, _>(0).ok().map(PathBuf::from),
        _ => None,
    }
}

#[tauri::command]
pub fn tcloud_prepare_preview(
    db: State<'_, DbConnection>,
    file_id: i64,
) -> Result<TCloudPreviewInfo, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let (name, logical_path, mime_type, telegram_message_id) = {
        let mut stmt = conn
            .prepare(
                "SELECT name, path, mime_type, telegram_message_id
                 FROM tcloud_files WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
        match stmt.next().map_err(|e| e.to_string())? {
            sqlite::State::Row => (
                stmt.read::<String, _>(0).map_err(|e| e.to_string())?,
                stmt.read::<String, _>(1).map_err(|e| e.to_string())?,
                stmt.read::<Option<String>, _>(2).unwrap_or(None),
                stmt.read::<Option<i64>, _>(3).unwrap_or(None),
            ),
            _ => return Err("TCloud file not found".into()),
        }
    };

    // Cache wins.
    {
        let mut stmt = conn
            .prepare("SELECT local_path FROM tcloud_cache WHERE file_id = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
        if let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
            if let Ok(local_path) = stmt.read::<String, _>(0) {
                if Path::new(&local_path).exists() {
                    let mut touch = conn
                        .prepare("UPDATE tcloud_cache SET last_accessed_at = ?1 WHERE file_id = ?2")
                        .map_err(|e| e.to_string())?;
                    touch.bind((1, now)).map_err(|e| e.to_string())?;
                    touch.bind((2, file_id)).map_err(|e| e.to_string())?;
                    touch.next().map_err(|e| e.to_string())?;
                    return Ok(TCloudPreviewInfo {
                        file_id,
                        name,
                        mime_type,
                        ready: true,
                        local_path: Some(local_path),
                        queued: false,
                        message: "Arquivo disponível no cache.".into(),
                    });
                }
            }
        }
    }

    // Then check the configured sync root.
    if let (Some(root), Some(relative)) = (sync_root(&conn), safe_relative_path(&logical_path)) {
        let candidate = root.join(relative);
        if candidate.exists() {
            return Ok(TCloudPreviewInfo {
                file_id,
                name,
                mime_type,
                ready: true,
                local_path: Some(candidate.to_string_lossy().to_string()),
                queued: false,
                message: "Arquivo disponível localmente.".into(),
            });
        }
    }

    if telegram_message_id.is_none() {
        return Ok(TCloudPreviewInfo {
            file_id,
            name,
            mime_type,
            ready: false,
            local_path: None,
            queued: false,
            message: "O arquivo ainda não possui uma cópia remota no Telegram.".into(),
        });
    }

    let already_queued = {
        let mut stmt = conn
            .prepare(
                "SELECT COUNT(*) FROM tcloud_sync_jobs
                 WHERE file_id = ?1 AND operation = 'download'
                   AND status IN ('pending','running','paused')",
            )
            .map_err(|e| e.to_string())?;
        stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
        match stmt.next().map_err(|e| e.to_string())? {
            sqlite::State::Row => stmt.read::<i64, _>(0).unwrap_or(0) > 0,
            _ => false,
        }
    };

    if !already_queued {
        let mut stmt = conn
            .prepare(
                "INSERT INTO tcloud_sync_jobs(file_id, operation, status, created_at, updated_at, priority)
                 VALUES(?1, 'download', 'pending', ?2, ?3, 145)",
            )
            .map_err(|e| e.to_string())?;
        stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
        stmt.bind((2, now)).map_err(|e| e.to_string())?;
        stmt.bind((3, now)).map_err(|e| e.to_string())?;
        stmt.next().map_err(|e| e.to_string())?;
        crate::sync::scheduler::signal_sync_work();
    }

    Ok(TCloudPreviewInfo {
        file_id,
        name,
        mime_type,
        ready: false,
        local_path: None,
        queued: true,
        message: if already_queued {
            "Download para pré-visualização já está em andamento.".into()
        } else {
            "Arquivo adicionado à fila de download para pré-visualização.".into()
        },
    })
}
