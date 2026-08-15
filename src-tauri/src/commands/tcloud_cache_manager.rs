use crate::db::DbConnection;
use crate::sync::cache_manager;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudCacheStatus {
    pub current_bytes: u64,
    pub limit_bytes: u64,
}

#[tauri::command]
pub fn tcloud_get_cache_status(
    db: State<'_, DbConnection>,
) -> Result<TCloudCacheStatus, String> {
    Ok(TCloudCacheStatus {
        current_bytes: cache_manager::current_cache_size(db.inner())?,
        limit_bytes: cache_manager::cache_limit_bytes(db.inner())?,
    })
}

#[tauri::command]
pub fn tcloud_set_cache_limit(
    db: State<'_, DbConnection>,
    limit_bytes: u64,
) -> Result<TCloudCacheStatus, String> {
    if limit_bytes < 512 * 1024 * 1024 {
        return Err("cache limit must be at least 512 MiB".into());
    }

    cache_manager::set_cache_limit_bytes(db.inner(), limit_bytes)?;
    let current = cache_manager::enforce_cache_limit(db.inner())?;

    Ok(TCloudCacheStatus {
        current_bytes: current,
        limit_bytes,
    })
}

#[tauri::command]
pub fn tcloud_cleanup_cache(
    db: State<'_, DbConnection>,
) -> Result<TCloudCacheStatus, String> {
    let current = cache_manager::enforce_cache_limit(db.inner())?;
    let limit = cache_manager::cache_limit_bytes(db.inner())?;
    Ok(TCloudCacheStatus {
        current_bytes: current,
        limit_bytes: limit,
    })
}
