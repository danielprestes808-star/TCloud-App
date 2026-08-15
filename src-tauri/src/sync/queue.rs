//! TCloud durable sync queue abstraction.
//!
//! This module defines the persistence-facing types used to map SQLite rows
//! from `tcloud_sync_jobs` to the Sync Worker.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueRecord {
    pub id: String,
    pub operation: String,
    pub local_path: Option<String>,
    pub remote_file_id: Option<String>,
    pub chat_id: Option<i64>,
    pub folder_id: Option<String>,
    pub attempts: i64,
    pub status: String,
    pub last_error: Option<String>,
}

impl QueueRecord {
    pub fn is_pending(&self) -> bool {
        self.status.eq_ignore_ascii_case("pending")
            || self.status.eq_ignore_ascii_case("failed")
    }
}
