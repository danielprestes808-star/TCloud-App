use serde::{Deserialize, Serialize};
use sqlite::{Connection, State};

const DEFAULT_CORE_URL: &str = "https://tcloud-core.onrender.com";

pub(crate) fn core_url() -> String {
    std::env::var("TCLOUD_CORE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CORE_URL.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreCatalogFile {
    id: String,
    name: String,
    size: u64,
    telegram_peer_id: Option<i64>,
    telegram_message_id: Option<i64>,
}

#[derive(Debug)]
struct LocalTransportIdentity {
    name: String,
    size: i64,
    telegram_chat_id: Option<i64>,
    telegram_message_id: Option<i64>,
}

fn local_transport_identity(
    conn: &Connection,
    local_file_id: i64,
) -> Result<Option<LocalTransportIdentity>, String> {
    let mut q = conn
        .prepare(
            "SELECT name,size,telegram_chat_id,telegram_message_id
             FROM tcloud_files WHERE id=?1 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    q.bind((1, local_file_id)).map_err(|e| e.to_string())?;
    if !matches!(q.next().map_err(|e| e.to_string())?, State::Row) {
        return Ok(None);
    }
    Ok(Some(LocalTransportIdentity {
        name: q.read::<String, _>(0).map_err(|e| e.to_string())?,
        size: q.read::<i64, _>(1).unwrap_or(0),
        telegram_chat_id: q.read::<Option<i64>, _>(2).unwrap_or(None),
        telegram_message_id: q.read::<Option<i64>, _>(3).unwrap_or(None),
    }))
}

fn unique_catalog_match<'a>(
    identity: &LocalTransportIdentity,
    files: &'a [CoreCatalogFile],
) -> Option<&'a CoreCatalogFile> {
    let message_id = identity.telegram_message_id?;
    let compatible = |file: &&CoreCatalogFile| {
        file.telegram_message_id == Some(message_id)
            && file.name.eq_ignore_ascii_case(&identity.name)
            && (identity.size <= 0 || file.size == 0 || file.size == identity.size as u64)
    };
    let exact = files
        .iter()
        .filter(|file| {
            compatible(file)
                && identity.telegram_chat_id.is_some()
                && file.telegram_peer_id == identity.telegram_chat_id
        })
        .collect::<Vec<_>>();
    if exact.len() == 1 {
        return exact.first().copied();
    }
    let fallback = files.iter().filter(compatible).collect::<Vec<_>>();
    (fallback.len() == 1).then(|| fallback[0])
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFileIdentity {
    pub local_file_id: i64,
    pub core_file_id: Option<String>,
    pub canonical: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CanonicalFileMutation {
    pub local_file_id: i64,
    pub core_file_id: Option<String>,
    pub name: Option<String>,
    pub parent_id: Option<String>,
}

fn mapped_core_file_id(conn: &Connection, local_file_id: i64) -> Result<Option<String>, String> {
    let mut q = conn
        .prepare("SELECT core_file_id FROM tcloud_core_file_map WHERE local_file_id=?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    q.bind((1, local_file_id)).map_err(|e| e.to_string())?;

    if matches!(q.next().map_err(|e| e.to_string())?, State::Row) {
        return q.read::<String, _>(0).map(Some).map_err(|e| e.to_string());
    }

    Ok(None)
}

#[allow(dead_code)]
pub(crate) fn resolve_core_file_id(
    conn: &Connection,
    local_file_id: i64,
    explicit_core_file_id: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(value) = explicit_core_file_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return Ok(Some(value.to_string()));
    }
    mapped_core_file_id(conn, local_file_id)
}

pub(crate) fn canonical_media_url(core_file_id: &str) -> Result<String, String> {
    let value = core_file_id.trim();
    if value.is_empty() {
        return Err("core_file_id vazio.".to_string());
    }
    Ok(format!("{}/api/v1/media/{value}", core_url()))
}

#[allow(dead_code)]
pub(crate) fn canonical_file_url(core_file_id: &str) -> Result<String, String> {
    let value = core_file_id.trim();
    if value.is_empty() {
        return Err("core_file_id vazio.".to_string());
    }
    Ok(format!("{}/api/v1/files/{value}", core_url()))
}

#[allow(dead_code)]
pub(crate) fn validate_mutation_identity(
    conn: &Connection,
    input: &CanonicalFileMutation,
) -> Result<Option<String>, String> {
    let resolved = resolve_core_file_id(conn, input.local_file_id, input.core_file_id.as_deref())?;

    // Compatibilidade temporaria: registros ainda nao mapeados continuam no fluxo legado.
    // Quando o mapa existir, o chamador deve preferir a operacao Core pelo UUID.
    Ok(resolved)
}
#[tauri::command]
pub(crate) async fn tcloud_resolve_core_file_id(
    app: tauri::AppHandle,
    local_file_id: i64,
    access_token: Option<String>,
) -> Result<CanonicalFileIdentity, String> {
    use tauri::Manager;

    let db = app
        .try_state::<crate::db::DbConnection>()
        .ok_or_else(|| "DbConnection indisponivel.".to_string())?;

    let (mapped, identity) = {
        let conn = db
            .lock()
            .map_err(|_| "Falha ao bloquear SQLite.".to_string())?;
        (
            mapped_core_file_id(&conn, local_file_id)?,
            local_transport_identity(&conn, local_file_id)?,
        )
    };
    let mut core_file_id = mapped;

    let discovered = if core_file_id.is_none() {
        if let Some(identity) = identity.filter(|value| value.telegram_message_id.is_some()) {
            let client = reqwest::Client::new();
            let mut request = client
                .get(format!("{}/api/v1/files", core_url()))
                .timeout(std::time::Duration::from_secs(4));
            if let Some(token) = access_token.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                request = request.bearer_auth(token);
            }
            match request.send().await {
                Ok(response) if response.status().is_success() => match response.bytes().await {
                    Ok(bytes) => serde_json::from_slice::<Vec<CoreCatalogFile>>(&bytes)
                        .ok()
                        .and_then(|files| {
                            unique_catalog_match(&identity, &files).map(|file| file.id.clone())
                        }),
                    Err(_) => None,
                },
                _ => None,
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Some(found_id) = discovered {
        let conn = db
            .lock()
            .map_err(|_| "Falha ao bloquear SQLite.".to_string())?;
        crate::commands::tcloud_global_identity::bind_core_file_id(
            &conn,
            local_file_id,
            &found_id,
        )?;
        core_file_id = Some(found_id);
    }

    Ok(CanonicalFileIdentity {
        local_file_id,
        canonical: core_file_id.is_some(),
        core_file_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core(id: &str, peer: i64, message: i64, name: &str, size: u64) -> CoreCatalogFile {
        CoreCatalogFile {
            id: id.into(),
            name: name.into(),
            size,
            telegram_peer_id: Some(peer),
            telegram_message_id: Some(message),
        }
    }

    #[test]
    fn canonical_match_prefers_exact_transport_identity() {
        let local = LocalTransportIdentity {
            name: "foto.jpg".into(),
            size: 42,
            telegram_chat_id: Some(-1001),
            telegram_message_id: Some(77),
        };
        let files = vec![
            core("wrong", -1002, 77, "foto.jpg", 42),
            core("right", -1001, 77, "foto.jpg", 42),
        ];
        assert_eq!(unique_catalog_match(&local, &files).unwrap().id, "right");
    }

    #[test]
    fn canonical_match_rejects_ambiguous_fallback() {
        let local = LocalTransportIdentity {
            name: "foto.jpg".into(),
            size: 42,
            telegram_chat_id: Some(-9999),
            telegram_message_id: Some(77),
        };
        let files = vec![
            core("one", -1001, 77, "foto.jpg", 42),
            core("two", -1002, 77, "foto.jpg", 42),
        ];
        assert!(unique_catalog_match(&local, &files).is_none());
    }
}
