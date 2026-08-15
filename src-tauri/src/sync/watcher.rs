//! TCloud File Watcher
//!
//! Converts local filesystem events into sync intents. The actual OS watcher
//! implementation can be backed by the `notify` crate; this module keeps the
//! mapping logic independent and testable.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LocalChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalChange {
    pub kind: LocalChangeKind,
    pub path: PathBuf,
    pub old_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncIntentKind {
    Upload,
    DeleteRemote,
    MoveRemote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncIntent {
    pub kind: SyncIntentKind,
    pub path: String,
    pub old_path: Option<String>,
}

/// Ignore temporary/system files that should not create cloud sync work.
pub fn should_ignore(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    name.is_empty()
        || name == "thumbs.db"
        || name == "desktop.ini"
        || name.starts_with("~$")
        || name.ends_with(".tmp")
        || name.ends_with(".part")
        || name.ends_with(".crdownload")
}

/// Translate a local filesystem change into a TCloud sync intent.
pub fn change_to_intent(change: &LocalChange) -> Option<SyncIntent> {
    if should_ignore(&change.path) {
        return None;
    }

    match change.kind {
        LocalChangeKind::Created | LocalChangeKind::Modified => Some(SyncIntent {
            kind: SyncIntentKind::Upload,
            path: change.path.to_string_lossy().to_string(),
            old_path: None,
        }),
        LocalChangeKind::Removed => Some(SyncIntent {
            kind: SyncIntentKind::DeleteRemote,
            path: change.path.to_string_lossy().to_string(),
            old_path: None,
        }),
        LocalChangeKind::Renamed => Some(SyncIntent {
            kind: SyncIntentKind::MoveRemote,
            path: change.path.to_string_lossy().to_string(),
            old_path: change
                .old_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }),
    }
}
