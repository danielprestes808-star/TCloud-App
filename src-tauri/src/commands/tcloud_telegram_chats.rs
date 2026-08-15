use crate::commands::TelegramState;
use grammers_client::types::Peer;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudTelegramChat {
    pub id: i64,
    pub title: String,
    pub kind: String,
    pub username: Option<String>,
}

#[tauri::command]
pub async fn tcloud_list_telegram_chats(
    state: State<'_, TelegramState>,
) -> Result<Vec<TCloudTelegramChat>, String> {
    let client = state
        .client
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Telegram client is not connected".to_string())?;

    let mut dialogs = client.iter_dialogs();
    let mut items = Vec::new();

    while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
        // Telegram basic groups are not used by the existing Telegram Drive
        // storage architecture. Channels and supergroups both arrive as
        // grammers `Peer::Channel`, so expose those as valid TCloud targets.
        if let Peer::Channel(channel) = &dialog.peer {
            items.push(TCloudTelegramChat {
                id: channel.raw.id,
                title: channel.raw.title.clone(),
                kind: if channel.raw.broadcast {
                    "channel".to_string()
                } else {
                    "supergroup".to_string()
                },
                username: channel.raw.username.clone(),
            });
        }
    }

    items.sort_by(|a, b| {
        a.title
            .to_ascii_lowercase()
            .cmp(&b.title.to_ascii_lowercase())
    });
    Ok(items)
}
