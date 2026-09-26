//! TCloud transfer progress tracking.
//!
//! 12.7.1 Part 2 keeps the hot progress path in memory and persists a smoothed
//! snapshot to SQLite at a human-visible cadence. This avoids hundreds of DB
//! writes per second on fast downloads while producing a steadier speed/ETA.

use crate::db::DbConnection;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
struct TransferSample {
    bytes_total: i64,
    sample_bytes: i64,
    sample_at: Instant,
    smoothed_speed_bps: f64,
    last_persist_at: Instant,
    last_persisted_bytes: i64,
}

static TRANSFER_SAMPLES: LazyLock<Mutex<HashMap<i64, TransferSample>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_samples() -> std::sync::MutexGuard<'static, HashMap<i64, TransferSample>> {
    TRANSFER_SAMPLES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn forget_transfer(job_id: i64) {
    lock_samples().remove(&job_id);
}

pub fn start_transfer(db: &DbConnection, job_id: i64, bytes_total: i64) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let total = bytes_total.max(0);
    {
        let conn = db
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "UPDATE tcloud_sync_jobs
                 SET status = 'running',
                     bytes_total = ?1,
                     bytes_transferred = 0,
                     started_at = ?2,
                     speed_bps = 0,
                     eta_seconds = NULL,
                     updated_at = ?3
                 WHERE id = ?4",
            )
            .map_err(|e| e.to_string())?;
        stmt.bind((1, total)).map_err(|e| e.to_string())?;
        stmt.bind((2, now)).map_err(|e| e.to_string())?;
        stmt.bind((3, now)).map_err(|e| e.to_string())?;
        stmt.bind((4, job_id)).map_err(|e| e.to_string())?;
        stmt.next().map_err(|e| e.to_string())?;
    }

    let instant = Instant::now();
    lock_samples().insert(
        job_id,
        TransferSample {
            bytes_total: total,
            sample_bytes: 0,
            sample_at: instant,
            smoothed_speed_bps: 0.0,
            last_persist_at: instant,
            last_persisted_bytes: 0,
        },
    );
    Ok(())
}

fn load_total(db: &DbConnection, job_id: i64) -> Result<i64, String> {
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT bytes_total FROM tcloud_sync_jobs WHERE id=?1 LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, job_id)).map_err(|e| e.to_string())?;
    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => Ok(stmt.read::<i64, _>(0).unwrap_or(0).max(0)),
        _ => Err("sync job not found".into()),
    }
}

pub fn update_transfer_progress(
    db: &DbConnection,
    job_id: i64,
    bytes_transferred: i64,
) -> Result<(), String> {
    let transferred = bytes_transferred.max(0);
    let known_total = lock_samples().get(&job_id).map(|sample| sample.bytes_total);
    let total = match known_total {
        Some(total) => total,
        None => load_total(db, job_id)?,
    };

    let now_instant = Instant::now();
    let (speed_bps, eta_seconds, should_persist) = {
        let mut samples = lock_samples();
        let sample = samples.entry(job_id).or_insert_with(|| TransferSample {
            bytes_total: total,
            sample_bytes: transferred,
            sample_at: now_instant,
            smoothed_speed_bps: 0.0,
            last_persist_at: now_instant - Duration::from_secs(1),
            last_persisted_bytes: transferred,
        });
        sample.bytes_total = total;

        let sample_elapsed = now_instant.duration_since(sample.sample_at);
        let delta_bytes = transferred.saturating_sub(sample.sample_bytes);

        // Calculate speed from a real time window, then apply an EMA so the ETA
        // does not jump wildly from one Telegram chunk to another.
        if delta_bytes > 0 && sample_elapsed >= Duration::from_millis(450) {
            let instantaneous = delta_bytes as f64 / sample_elapsed.as_secs_f64().max(0.001);
            sample.smoothed_speed_bps = if sample.smoothed_speed_bps > 0.0 {
                sample.smoothed_speed_bps * 0.68 + instantaneous * 0.32
            } else {
                instantaneous
            };
            sample.sample_bytes = transferred;
            sample.sample_at = now_instant;
        } else if delta_bytes == 0 && sample_elapsed >= Duration::from_secs(3) {
            // A stalled transfer should not keep displaying an old optimistic ETA.
            sample.smoothed_speed_bps *= 0.65;
            if sample.smoothed_speed_bps < 1024.0 {
                sample.smoothed_speed_bps = 0.0;
            }
            sample.sample_at = now_instant;
        } else if delta_bytes > 0
            && sample.sample_bytes == 0
            && sample_elapsed < Duration::from_millis(450)
        {
            // A resumed download can jump from zero to many MiB instantly because
            // those bytes were already present in the .part file. Treat that as a
            // baseline, not as network throughput.
            sample.sample_bytes = transferred;
            sample.sample_at = now_instant;
        }

        let speed = sample.smoothed_speed_bps.max(0.0).round() as i64;
        let eta = if speed > 0 && total > transferred {
            Some(((total - transferred) as f64 / speed as f64).ceil() as i64)
        } else if total > 0 && transferred >= total {
            Some(0)
        } else {
            None
        };

        // Persist often enough for a responsive UI, but not once per network chunk.
        let persist_elapsed = now_instant.duration_since(sample.last_persist_at);
        let persist_delta = transferred.saturating_sub(sample.last_persisted_bytes);
        let done = total > 0 && transferred >= total;
        let persist = done
            || persist_elapsed >= Duration::from_millis(650)
            || persist_delta >= 8 * 1024 * 1024;
        if persist {
            sample.last_persist_at = now_instant;
            sample.last_persisted_bytes = transferred;
        }
        (speed, eta, persist)
    };

    if !should_persist {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp();
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_sync_jobs
             SET bytes_transferred = ?1,
                 speed_bps = ?2,
                 eta_seconds = ?3,
                 updated_at = ?4
             WHERE id = ?5",
        )
        .map_err(|e| e.to_string())?;

    stmt.bind((1, transferred)).map_err(|e| e.to_string())?;
    stmt.bind((2, speed_bps)).map_err(|e| e.to_string())?;
    match eta_seconds {
        Some(v) => stmt.bind((3, v)).map_err(|e| e.to_string())?,
        None => stmt
            .bind((3, sqlite::Value::Null))
            .map_err(|e| e.to_string())?,
    }
    stmt.bind((4, now)).map_err(|e| e.to_string())?;
    stmt.bind((5, job_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn finish_transfer(db: &DbConnection, job_id: i64) -> Result<(), String> {
    forget_transfer(job_id);
    let now = chrono::Utc::now().timestamp();
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_sync_jobs
             SET status = 'completed',
                 bytes_transferred = CASE
                    WHEN bytes_total > 0 THEN bytes_total
                    ELSE bytes_transferred
                 END,
                 speed_bps = 0,
                 eta_seconds = 0,
                 updated_at = ?1
             WHERE id = ?2",
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, now)).map_err(|e| e.to_string())?;
    stmt.bind((2, job_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}
