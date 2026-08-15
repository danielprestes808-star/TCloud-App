//! TCloud download job processor integration.

use crate::db::DbConnection;
use crate::sync::telegram_download::{
    complete_download, load_remote_record, prepare_cache_target, RemoteDownloadRecord,
};
use std::future::Future;
use std::path::PathBuf;

pub async fn process_download_job<F, Fut>(
    db: &DbConnection,
    file_id: i64,
    downloader: F,
) -> Result<PathBuf, String>
where
    F: FnOnce(RemoteDownloadRecord, PathBuf) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let record = load_remote_record(db, file_id)?;
    let target = prepare_cache_target(&record)?;

    downloader(record.clone(), target.clone()).await?;
    complete_download(db, file_id, &target)?;

    Ok(target)
}
