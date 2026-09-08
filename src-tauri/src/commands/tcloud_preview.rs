use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tokio::io::AsyncWriteExt;

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
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;

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

fn safe_cache_name(core_file_id: &str, name: &str) -> String {
    let safe = |value: &str| {
        value
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    format!("{}_{}", safe(core_file_id), safe(name))
}

#[tauri::command]
pub async fn tcloud_prepare_canonical_preview(
    app: tauri::AppHandle,
    db: State<'_, DbConnection>,
    file_id: i64,
    core_file_id: String,
    access_token: Option<String>,
) -> Result<TCloudPreviewInfo, String> {
    let core_file_id = core_file_id.trim().to_string();
    if core_file_id.is_empty() {
        return Err("Identidade canônica ausente.".into());
    }
    let (name, mime_type, expected_size) = {
        let conn = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT name,mime_type,size FROM tcloud_files WHERE id=?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
        if !matches!(stmt.next().map_err(|e| e.to_string())?, sqlite::State::Row) {
            return Err("Arquivo não encontrado.".into());
        }
        (
            stmt.read::<String, _>(0).map_err(|e| e.to_string())?,
            stmt.read::<Option<String>, _>(1).unwrap_or(None),
            stmt.read::<i64, _>(2).unwrap_or(0).max(0) as u64,
        )
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("canonical-media");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;
    let target = cache_dir.join(safe_cache_name(&core_file_id, &name));
    if target.is_file()
        && (expected_size == 0 || target.metadata().map(|m| m.len()).unwrap_or(0) == expected_size)
    {
        crate::sync::cache::mark_cached(db.inner(), file_id, &target)?;
        return Ok(TCloudPreviewInfo {
            file_id,
            name,
            mime_type,
            ready: true,
            local_path: Some(target.to_string_lossy().to_string()),
            queued: false,
            message: "Mídia recuperada pelo identificador canônico.".into(),
        });
    }

    let partial = target.with_extension(format!(
        "{}.part",
        target
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("media")
    ));
    let mut offset = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    if expected_size > 0 && offset > expected_size {
        tokio::fs::remove_file(&partial)
            .await
            .map_err(|e| e.to_string())?;
        offset = 0;
    }
    let mut output = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&partial)
        .await
        .map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let mut total = expected_size;

    while total == 0 || offset < total {
        let mut request = client
            .get(crate::commands::tcloud_canonical_ops::canonical_media_url(
                &core_file_id,
            )?)
            .header(reqwest::header::RANGE, format!("bytes={offset}-"));
        if let Some(token) = access_token.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Core media HTTP {}", response.status()));
        }
        if let Some(range) = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
        {
            if let Some(value) = range.rsplit('/').next().and_then(|v| v.parse::<u64>().ok()) {
                total = value;
            }
        } else if total == 0 {
            total = offset + response.content_length().unwrap_or(0);
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            return Err("O Core não retornou bytes da mídia.".into());
        }
        output.write_all(&bytes).await.map_err(|e| e.to_string())?;
        output.flush().await.map_err(|e| e.to_string())?;
        offset += bytes.len() as u64;
    }
    drop(output);
    if total > 0 && offset != total {
        return Err(format!(
            "Download canônico incompleto: {offset} de {total} bytes."
        ));
    }
    if target.exists() {
        tokio::fs::remove_file(&target)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::rename(&partial, &target)
        .await
        .map_err(|e| e.to_string())?;
    crate::sync::cache::mark_cached(db.inner(), file_id, &target)?;

    Ok(TCloudPreviewInfo {
        file_id,
        name,
        mime_type,
        ready: true,
        local_path: Some(target.to_string_lossy().to_string()),
        queued: false,
        message: "Mídia recuperada pelo identificador canônico.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::safe_cache_name;

    #[test]
    fn canonical_cache_name_cannot_escape_cache_directory() {
        let value = safe_cache_name("../../core:id", "../video:final?.mp4");
        assert!(!value.contains('/'));
        assert!(!value.contains('\\'));
        assert!(!value.contains(':'));
    }
}
