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

    const IGNORED_DIRS: &[&str] = &[
        ".git",
        ".next",
        ".dart_tool",
        ".gradle",
        ".idea",
        ".vscode",
        "node_modules",
        "target",
        "build",
        "dist",
        "coverage",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        "venv",
        ".turbo",
    ];
    let has_ignored_parent = path.components().any(|part| {
        let value = part.as_os_str().to_string_lossy().to_ascii_lowercase();
        IGNORED_DIRS.contains(&value.as_str())
    });

    has_ignored_parent
        || name.is_empty()
        || name == "thumbs.db"
        || name == "desktop.ini"
        || name.starts_with("~$")
        || name.ends_with(".tmp")
        || name.ends_with(".part")
        || name.ends_with(".crdownload")
        || name.ends_with(".lnk")
        || name.ends_with(".url")
}

#[cfg(test)]
mod tests {
    use super::should_ignore;
    use std::path::Path;

    #[test]
    fn ignores_generated_directories_at_any_depth() {
        assert!(should_ignore(Path::new(
            r"D:\projeto\node_modules\pkg\package.json"
        )));
        assert!(should_ignore(Path::new(
            r"D:\projeto\src-tauri\target\release\app.exe"
        )));
        assert!(should_ignore(Path::new(r"D:\projeto\.next\server\page.js")));
        assert!(should_ignore(Path::new(
            r"D:\Documentos\projeto\.venv\Lib\site-packages\pacote.py"
        )));
        assert!(should_ignore(Path::new(
            r"D:\Documentos\projeto\venv\Scripts\python.exe"
        )));
        assert!(should_ignore(Path::new(r"D:\Desktop\TCloud.lnk")));
        assert!(should_ignore(Path::new(r"D:\Desktop\Portal.url")));
        assert!(!should_ignore(Path::new(
            r"D:\Documentos\Trabalho\relatorio.pdf"
        )));
    }
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
