use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudCreatedStorageChat {
    pub chat_id: i64,
    pub title: String,
    pub kind: String,
    pub folder_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudCreateStorageChatInput {
    pub folder_id: i64,
    pub title: Option<String>,
    pub kind: Option<String>,
}

fn default_title(folder_name: &str) -> String {
    format!("TCloud - {}", folder_name)
}

#[tauri::command]
pub async fn tcloud_create_storage_chat(
    db: State<'_, DbConnection>,
    state: State<'_, crate::commands::TelegramState>,
    input: TCloudCreateStorageChatInput,
) -> Result<TCloudCreatedStorageChat, String> {
    let folder_name = {
        let conn = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare("SELECT name FROM tcloud_folders WHERE id = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        stmt.bind((1, input.folder_id)).map_err(|e| e.to_string())?;
        match stmt.next().map_err(|e| e.to_string())? {
            sqlite::State::Row => stmt.read::<String, _>(0).map_err(|e| e.to_string())?,
            _ => return Err("TCloud folder not found".into()),
        }
    };

    let title = input
        .title
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default_title(&folder_name));

    let kind = input.kind.unwrap_or_else(|| "group".to_string());

    let client = state
        .client
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Telegram client is not connected".to_string())?;

    // grammers exposes raw MTProto invocation through `invoke`.
    // We use Telegram's native creation methods and then persist the resulting chat id.
    let chat_id: i64 = match kind.as_str() {
        "channel" => {
            use grammers_tl_types as tl;
            let updates = client
                .invoke(&tl::functions::channels::CreateChannel {
                    broadcast: true,
                    megagroup: false,
                    for_import: false,
                    forum: false,
                    title: title.clone(),
                    about: "TCloud storage".into(),
                    geo_point: None,
                    address: None,
                    ttl_period: None,
                })
                .await
                .map_err(|e| e.to_string())?;

            let chats = match updates {
                tl::enums::Updates::TooLong => Vec::new(),
                tl::enums::Updates::Combined(data) => data.chats,
                tl::enums::Updates::Updates(data) => data.chats,
                tl::enums::Updates::UpdateShort(_) => Vec::new(),
                tl::enums::Updates::UpdateShortChatMessage(_) => Vec::new(),
                tl::enums::Updates::UpdateShortMessage(_) => Vec::new(),
                tl::enums::Updates::UpdateShortSentMessage(_) => Vec::new(),
            };

            let chat = chats
                .into_iter()
                .next()
                .ok_or_else(|| "Telegram did not return the created channel".to_string())?;

            match chat {
                tl::enums::Chat::Channel(channel) => channel.id,
                _ => return Err("unexpected Telegram response while creating channel".into()),
            }
        }
        _ => {
            use grammers_tl_types as tl;

            // Basic groups require at least one other user. For personal cloud storage,
            // a megagroup is a better default because it can be created without adding
            // arbitrary contacts.
            let updates = client
                .invoke(&tl::functions::channels::CreateChannel {
                    broadcast: false,
                    megagroup: true,
                    for_import: false,
                    forum: false,
                    title: title.clone(),
                    about: "TCloud storage".into(),
                    geo_point: None,
                    address: None,
                    ttl_period: None,
                })
                .await
                .map_err(|e| e.to_string())?;

            let chats = match updates {
                tl::enums::Updates::TooLong => Vec::new(),
                tl::enums::Updates::Combined(data) => data.chats,
                tl::enums::Updates::Updates(data) => data.chats,
                tl::enums::Updates::UpdateShort(_) => Vec::new(),
                tl::enums::Updates::UpdateShortChatMessage(_) => Vec::new(),
                tl::enums::Updates::UpdateShortMessage(_) => Vec::new(),
                tl::enums::Updates::UpdateShortSentMessage(_) => Vec::new(),
            };

            let chat = chats
                .into_iter()
                .next()
                .ok_or_else(|| "Telegram did not return the created group".to_string())?;

            match chat {
                tl::enums::Chat::Channel(channel) => channel.id,
                _ => return Err("unexpected Telegram response while creating group".into()),
            }
        }
    };

    {
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
        stmt.bind((1, chat_id)).map_err(|e| e.to_string())?;
        stmt.bind((2, now)).map_err(|e| e.to_string())?;
        stmt.bind((3, input.folder_id)).map_err(|e| e.to_string())?;
        stmt.next().map_err(|e| e.to_string())?;
    }

    Ok(TCloudCreatedStorageChat {
        chat_id,
        title,
        kind: if kind == "channel" {
            "channel".into()
        } else {
            "supergroup".into()
        },
        folder_id: input.folder_id,
    })
}
