//! TCloud watcher -> SQLite bridge.
//!
//! Maps File Watcher intents to durable rows in `tcloud_sync_jobs`.
//! The actual SQL execution should use the project's existing DB connection.

use serde::{Deserialize, Serialize};
use super::watcher::{SyncIntent, SyncIntentKind};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSyncJob {
    pub operation: String,
    pub local_path: Option<String>,
    pub old_path: Option<String>,
    pub status: String,
    pub attempts: i64,
}

pub fn intent_to_job(intent: &SyncIntent) -> NewSyncJob {
    let operation = match intent.kind {
        SyncIntentKind::Upload => "upload",
        SyncIntentKind::DeleteRemote => "delete_remote",
        SyncIntentKind::MoveRemote => "move_remote",
    }
    .to_string();

    NewSyncJob {
        operation,
        local_path: Some(intent.path.clone()),
        old_path: intent.old_path.clone(),
        status: "pending".into(),
        attempts: 0,
    }
}

/// SQL used by the command/database layer to insert a watcher-generated job.
/// Kept centralized to avoid schema drift.
pub const INSERT_SYNC_JOB_SQL: &str = r#"
INSERT INTO tcloud_sync_jobs
(operation, local_path, old_path, status, attempts)
VALUES (?1, ?2, ?3, ?4, ?5)
"#;
