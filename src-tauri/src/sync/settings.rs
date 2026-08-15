//! TCloud local sync settings.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncSettings {
    pub local_root: Option<String>,
    pub watcher_enabled: bool,
}

pub const CREATE_SETTINGS_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS tcloud_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
)
"#;

pub const SET_LOCAL_ROOT_SQL: &str = r#"
INSERT INTO tcloud_settings(key, value)
VALUES ('local_root', ?1)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
"#;

pub const SET_WATCHER_ENABLED_SQL: &str = r#"
INSERT INTO tcloud_settings(key, value)
VALUES ('watcher_enabled', ?1)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
"#;

pub const GET_LOCAL_ROOT_SQL: &str =
    "SELECT value FROM tcloud_settings WHERE key = 'local_root' LIMIT 1";

pub const GET_WATCHER_ENABLED_SQL: &str =
    "SELECT value FROM tcloud_settings WHERE key = 'watcher_enabled' LIMIT 1";
