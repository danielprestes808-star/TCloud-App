use grammers_client::types::{LoginToken, PasswordToken, Peer};
use grammers_client::Client;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tracks the lifecycle of the Telegram connection
///
/// IMPORTANT: The `runner_shutdown` field is critical for preventing stack overflow.
/// When reconnecting, we MUST shutdown the old runner before spawning a new one.
/// Without this, runner tasks accumulate and exhaust the thread stack.
#[derive(Clone)]
pub struct TelegramState {
    pub client: Arc<Mutex<Option<Client>>>,
    /// Serializes construction without blocking readers of the active client.
    pub client_init: Arc<Mutex<()>>,
    pub login_token: Arc<Mutex<Option<LoginToken>>>,
    pub password_token: Arc<Mutex<Option<PasswordToken>>>,
    pub api_id: Arc<Mutex<Option<i32>>>,
    /// Send to this channel to request runner shutdown.
    /// Uses std::sync::Mutex (not tokio) so it can be locked from synchronous
    /// contexts like the RunEvent::Exit handler.
    pub runner_shutdown: Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    /// Counter for debugging runner lifecycle
    pub runner_count: Arc<std::sync::atomic::AtomicU32>,
    /// Cache of folder_id → Peer to avoid O(N) dialog scanning on every operation.
    /// Populated lazily on first resolve_peer call, eagerly during cmd_scan_folders.
    /// Cleared on logout.
    pub peer_cache: Arc<tokio::sync::RwLock<HashMap<i64, Peer>>>,
    /// Set of transfer IDs that have been cancelled. Checked cooperatively
    /// in upload/download chunk loops. Cleared on logout.
    pub cancelled_transfers: Arc<tokio::sync::RwLock<HashSet<String>>>,
}

pub mod api_settings;
pub mod archive;
pub mod auth;
pub mod folder_groups;
pub mod fs;
pub mod network;
pub mod preview;
pub mod settings;
pub mod sharing;
pub mod streaming;
pub mod utils;
pub mod video_metadata;

pub use api_settings::*;
pub use archive::*;
pub use auth::*;
pub use folder_groups::*;
pub use fs::*;
pub use network::*;
pub use preview::*;
pub use settings::*;
pub use sharing::*;
pub use streaming::*;
pub use utils::*;
pub use video_metadata::*;

pub mod tcloud_sync_settings;

pub mod tcloud_conflicts;

pub mod tcloud_cache;

pub mod tcloud_download;

pub mod tcloud_windows_startup;

pub mod tcloud_cache_manager;

pub mod tcloud_dashboard;

pub mod tcloud_folder_manager;

pub mod tcloud_telegram_chats;

pub mod tcloud_storage_chat;

pub mod tcloud_setup;

pub mod tcloud_sync_center;

pub mod tcloud_transfer_progress;

pub mod tcloud_transfer_controls;

pub mod tcloud_job_priority;

pub mod tcloud_network_settings;

pub mod tcloud_preview;

pub mod tcloud_forums;

pub mod tcloud_cfapi;
pub mod tcloud_completion;
pub mod tcloud_desktop_experience;
pub mod tcloud_productivity;
pub mod tcloud_storage_guard;
pub mod tcloud_sync_maturity;

pub(crate) mod tcloud_global_identity;

pub(crate) mod tcloud_canonical_ops;
