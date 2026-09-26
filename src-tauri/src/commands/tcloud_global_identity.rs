use sqlite::Connection;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn bind_core_file_id(
    conn: &Connection,
    local_file_id: i64,
    core_file_id: &str,
) -> Result<(), String> {
    let core_file_id = core_file_id.trim();
    if core_file_id.is_empty() {
        return Err("core_file_id vazio.".to_string());
    }

    let now = now_unix();
    let mut q = conn
        .prepare(
            "INSERT INTO tcloud_core_file_map(local_file_id,core_file_id,created_at,updated_at)
             VALUES(?1,?2,?3,?3)
             ON CONFLICT(local_file_id) DO UPDATE SET
               core_file_id=excluded.core_file_id,
               updated_at=excluded.updated_at",
        )
        .map_err(|e| e.to_string())?;

    q.bind((1, local_file_id)).map_err(|e| e.to_string())?;
    q.bind((2, core_file_id)).map_err(|e| e.to_string())?;
    q.bind((3, now)).map_err(|e| e.to_string())?;
    q.next().map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn core_file_id(
    conn: &Connection,
    local_file_id: i64,
) -> Result<Option<String>, String> {
    let mut q = conn
        .prepare("SELECT core_file_id FROM tcloud_core_file_map WHERE local_file_id=?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    q.bind((1, local_file_id)).map_err(|e| e.to_string())?;
    if matches!(q.next().map_err(|e| e.to_string())?, sqlite::State::Row) {
        return q.read::<String, _>(0).map(Some).map_err(|e| e.to_string());
    }
    Ok(None)
}

#[allow(dead_code)]
pub(crate) fn validate_remote_identity_source(
    core_file_id: Option<&str>,
    telegram_chat_id: Option<i64>,
) -> Result<(), String> {
    if core_file_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some()
    {
        return Ok(());
    }

    if let Some(chat_id) = telegram_chat_id {
        if chat_id < 0 && chat_id > -1_000_000 {
            return Err(
                "Identidade remota local/sintetica detectada sem core_file_id canonico."
                    .to_string(),
            );
        }
    }

    Ok(())
}
