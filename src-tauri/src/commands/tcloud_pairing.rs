use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::tcloud_mdns::{self, TCloudMdnsRuntime};
use crate::mobile_server::MobileServerRuntime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudPairingSession {
    pub pairing_code: String,
    pub token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudPairedDevice {
    pub id: i64,
    pub device_id: String,
    pub device_name: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudPairDeviceInput {
    pub pairing_code: String,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudPairDeviceResult {
    pub device_token: String,
    pub device_id: String,
    pub device_name: String,
}

fn random_token(len: usize) -> String {
    let mut output = String::with_capacity(len);
    while output.len() < len {
        output.push_str(&format!("{:016x}", rand::random::<u64>()));
    }
    output.truncate(len);
    output
}

fn random_code() -> String {
    let value = 100_000 + (rand::random::<u32>() % 900_000);
    value.to_string()
}

#[tauri::command]
pub async fn tcloud_create_pairing_session(
    db: State<'_, DbConnection>,
    mdns: State<'_, TCloudMdnsRuntime>,
    mobile_runtime: State<'_, MobileServerRuntime>,
) -> Result<TCloudPairingSession, String> {
    let now = chrono::Utc::now().timestamp();
    let expires_at = now + 5 * 60;
    let pairing_code = random_code();
    let token = random_token(48);

    {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

        conn.execute(
            "DELETE FROM tcloud_pairing_sessions
             WHERE used = 1 OR expires_at < strftime('%s','now')"
        )
        .map_err(|e| e.to_string())?;

        {
            let mut stmt = conn
                .prepare(
                    "INSERT INTO tcloud_pairing_sessions(
                        pairing_code, token, expires_at, created_at, used
                     ) VALUES(?1, ?2, ?3, ?4, 0)"
                )
                .map_err(|e| e.to_string())?;
            stmt.bind((1, pairing_code.as_str())).map_err(|e| e.to_string())?;
            stmt.bind((2, token.as_str())).map_err(|e| e.to_string())?;
            stmt.bind((3, expires_at)).map_err(|e| e.to_string())?;
            stmt.bind((4, now)).map_err(|e| e.to_string())?;
            stmt.next().map_err(|e| e.to_string())?;
        }
    }

    let port = mobile_runtime
        .address
        .lock()
        .await
        .map(|addr| addr.port())
        .unwrap_or(9868);

    let _ = tcloud_mdns::start_advertisement(
        mdns.inner(),
        port,
        Some(pairing_code.as_str()),
    )
    .await;

    Ok(TCloudPairingSession {
        pairing_code,
        token,
        expires_at,
    })
}

#[tauri::command]
pub fn tcloud_pair_device(
    db: State<'_, DbConnection>,
    input: TCloudPairDeviceInput,
) -> Result<TCloudPairDeviceResult, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let valid = {
        let mut stmt = conn
            .prepare(
                "SELECT id
                 FROM tcloud_pairing_sessions
                 WHERE pairing_code = ?1
                   AND used = 0
                   AND expires_at >= ?2
                 LIMIT 1"
            )
            .map_err(|e| e.to_string())?;
        stmt.bind((1, input.pairing_code.as_str())).map_err(|e| e.to_string())?;
        stmt.bind((2, now)).map_err(|e| e.to_string())?;
        match stmt.next().map_err(|e| e.to_string())? {
            sqlite::State::Row => Some(stmt.read::<i64, _>(0).map_err(|e| e.to_string())?),
            _ => None,
        }
    };

    let session_id = valid.ok_or_else(|| "invalid or expired pairing code".to_string())?;
    let device_token = random_token(64);

    let mut upsert = conn
        .prepare(
            "INSERT INTO tcloud_paired_devices(
                device_id, device_name, token, created_at, last_seen_at, revoked
             ) VALUES(?1, ?2, ?3, ?4, ?5, 0)
             ON CONFLICT(device_id) DO UPDATE SET
                device_name = excluded.device_name,
                token = excluded.token,
                last_seen_at = excluded.last_seen_at,
                revoked = 0"
        )
        .map_err(|e| e.to_string())?;
    upsert.bind((1, input.device_id.as_str())).map_err(|e| e.to_string())?;
    upsert.bind((2, input.device_name.as_str())).map_err(|e| e.to_string())?;
    upsert.bind((3, device_token.as_str())).map_err(|e| e.to_string())?;
    upsert.bind((4, now)).map_err(|e| e.to_string())?;
    upsert.bind((5, now)).map_err(|e| e.to_string())?;
    upsert.next().map_err(|e| e.to_string())?;

    let mut mark = conn
        .prepare("UPDATE tcloud_pairing_sessions SET used = 1 WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    mark.bind((1, session_id)).map_err(|e| e.to_string())?;
    mark.next().map_err(|e| e.to_string())?;

    Ok(TCloudPairDeviceResult {
        device_token,
        device_id: input.device_id,
        device_name: input.device_name,
    })
}

#[tauri::command]
pub fn tcloud_list_paired_devices(
    db: State<'_, DbConnection>,
) -> Result<Vec<TCloudPairedDevice>, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, device_id, device_name, created_at, last_seen_at, revoked
             FROM tcloud_paired_devices
             ORDER BY last_seen_at DESC"
        )
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        items.push(TCloudPairedDevice {
            id: stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            device_id: stmt.read::<String, _>(1).map_err(|e| e.to_string())?,
            device_name: stmt.read::<String, _>(2).map_err(|e| e.to_string())?,
            created_at: stmt.read::<i64, _>(3).unwrap_or(0),
            last_seen_at: stmt.read::<i64, _>(4).unwrap_or(0),
            revoked: stmt.read::<i64, _>(5).unwrap_or(0) != 0,
        });
    }

    Ok(items)
}

#[tauri::command]
pub fn tcloud_revoke_paired_device(
    db: State<'_, DbConnection>,
    device_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_paired_devices
             SET revoked = 1
             WHERE device_id = ?1"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, device_id.as_str())).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}
