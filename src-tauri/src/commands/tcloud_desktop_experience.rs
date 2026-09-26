use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;

const KEY_CLOSE_BEHAVIOR: &str = "desktop_close_behavior";
const KEY_CLOSE_NOTICE_SEEN: &str = "desktop_close_notice_seen";
const KEY_QUIET_RETRIES: &str = "desktop_quiet_retries";
const KEY_AUTO_FREE_SPACE_DAYS: &str = "desktop_auto_free_space_days";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudDesktopPreferences {
    pub close_behavior: String,
    pub close_notice_seen: bool,
    pub quiet_retries: bool,
    pub auto_free_space_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudHealthReport {
    pub database_ok: bool,
    pub active_transfers: i64,
    pub waiting_transfers: i64,
    pub attention_items: i64,
    pub conflicts: i64,
    pub cached_files: i64,
    pub stalled_transfers: i64,
    pub failed_cfapi_operations: i64,
    pub previous_unclean_shutdown: bool,
    pub stale_history_cleaned: i64,
    pub repaired: bool,
    pub summary: String,
}

fn read_setting(conn: &sqlite::Connection, key: &str) -> Option<String> {
    let mut stmt = conn
        .prepare("SELECT value FROM tcloud_settings WHERE key=?1 LIMIT 1")
        .ok()?;
    stmt.bind((1, key)).ok()?;
    if matches!(stmt.next().ok()?, sqlite::State::Row) {
        stmt.read::<String, _>(0).ok()
    } else {
        None
    }
}

fn write_setting(conn: &sqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO tcloud_settings(key,value) VALUES(?1,?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, key)).map_err(|e| e.to_string())?;
    stmt.bind((2, value)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

fn scalar(conn: &sqlite::Connection, sql: &str) -> i64 {
    let Ok(mut stmt) = conn.prepare(sql) else {
        return 0;
    };
    if matches!(stmt.next(), Ok(sqlite::State::Row)) {
        stmt.read::<i64, _>(0).unwrap_or(0)
    } else {
        0
    }
}

fn table_exists(conn: &sqlite::Connection, name: &str) -> bool {
    let Ok(mut stmt) =
        conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1")
    else {
        return false;
    };
    if stmt.bind((1, name)).is_err() {
        return false;
    }
    matches!(stmt.next(), Ok(sqlite::State::Row))
}

pub(crate) fn load_preferences(db: &DbConnection) -> TCloudDesktopPreferences {
    let Ok(conn) = db.lock() else {
        return TCloudDesktopPreferences {
            close_behavior: "background".into(),
            close_notice_seen: false,
            quiet_retries: true,
            auto_free_space_days: 0,
        };
    };
    let close_behavior = read_setting(&conn, KEY_CLOSE_BEHAVIOR)
        .filter(|v| v == "background" || v == "exit")
        .unwrap_or_else(|| "background".into());
    let close_notice_seen = read_setting(&conn, KEY_CLOSE_NOTICE_SEEN)
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    let quiet_retries = read_setting(&conn, KEY_QUIET_RETRIES)
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(true);
    let auto_free_space_days = read_setting(&conn, KEY_AUTO_FREE_SPACE_DAYS)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(0, 365);
    TCloudDesktopPreferences {
        close_behavior,
        close_notice_seen,
        quiet_retries,
        auto_free_space_days,
    }
}

pub(crate) fn should_keep_running_on_close(db: &DbConnection) -> bool {
    load_preferences(db).close_behavior != "exit"
}

pub(crate) fn mark_close_notice_seen(db: &DbConnection) -> Result<bool, String> {
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let already = read_setting(&conn, KEY_CLOSE_NOTICE_SEEN)
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    if !already {
        write_setting(&conn, KEY_CLOSE_NOTICE_SEEN, "1")?;
    }
    Ok(!already)
}

fn cleanup_stale_history(conn: &sqlite::Connection) -> Result<i64, String> {
    let before = scalar(conn, "SELECT COUNT(*) FROM tcloud_sync_jobs");
    // Keep active work and the newest terminal failure for a still-problematic file.
    // Old completed/cancelled rows and failures that have since been superseded are
    // history, not user-facing problems.
    conn.execute(
        "DELETE FROM tcloud_sync_jobs
         WHERE status IN ('completed','cancelled')
           AND updated_at < strftime('%s','now') - 604800;
         DELETE FROM tcloud_sync_jobs
         WHERE status='failed'
           AND EXISTS(
             SELECT 1 FROM tcloud_sync_jobs newer
             WHERE newer.file_id=tcloud_sync_jobs.file_id
               AND newer.id>tcloud_sync_jobs.id
               AND newer.status IN ('completed','pending','running','paused')
           );
         DELETE FROM tcloud_sync_jobs
         WHERE status='failed'
           AND EXISTS(
             SELECT 1 FROM tcloud_files f
             WHERE f.id=tcloud_sync_jobs.file_id
               AND COALESCE(f.sync_status,'') IN ('synced','deleted','trashed')
           );",
    )
    .map_err(|e| e.to_string())?;
    let after = scalar(conn, "SELECT COUNT(*) FROM tcloud_sync_jobs");
    Ok((before - after).max(0))
}

pub(crate) fn run_startup_housekeeping(db: &DbConnection) {
    let auto_days = load_preferences(db).auto_free_space_days;
    {
        let Ok(conn) = db.lock() else {
            return;
        };
        match cleanup_stale_history(&conn) {
            Ok(cleaned) if cleaned > 0 => {
                log::info!("TCloud: removed {cleaned} stale transfer history row(s).")
            }
            Ok(_) => {}
            Err(error) => log::warn!("TCloud transfer-history housekeeping: {error}"),
        }
    }
    if auto_days > 0 {
        match crate::sync::cache_manager::free_cache_older_than(db, auto_days) {
            Ok(freed) if freed > 0 => {
                log::info!("TCloud: automatic space cleanup freed {freed} bytes.")
            }
            Ok(_) => {}
            Err(error) => log::warn!("TCloud automatic space cleanup: {error}"),
        }
    }
}

#[tauri::command]
pub fn tcloud_get_desktop_preferences(
    db: State<'_, DbConnection>,
) -> Result<TCloudDesktopPreferences, String> {
    Ok(load_preferences(db.inner()))
}

#[tauri::command]
pub fn tcloud_set_desktop_preferences(
    db: State<'_, DbConnection>,
    close_behavior: String,
    quiet_retries: bool,
    auto_free_space_days: i64,
) -> Result<TCloudDesktopPreferences, String> {
    let close_behavior = if close_behavior == "exit" {
        "exit"
    } else {
        "background"
    };
    let conn = db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    write_setting(&conn, KEY_CLOSE_BEHAVIOR, close_behavior)?;
    write_setting(
        &conn,
        KEY_QUIET_RETRIES,
        if quiet_retries { "1" } else { "0" },
    )?;
    let auto_days_value = auto_free_space_days.clamp(0, 365).to_string();
    write_setting(&conn, KEY_AUTO_FREE_SPACE_DAYS, auto_days_value.as_str())?;
    drop(conn);
    if auto_free_space_days > 0 {
        let _ = crate::sync::cache_manager::free_cache_older_than(
            db.inner(),
            auto_free_space_days.clamp(1, 365),
        );
    }
    Ok(load_preferences(db.inner()))
}

#[tauri::command]
pub async fn tcloud_run_health_check(
    db: State<'_, DbConnection>,
    repair: bool,
) -> Result<TCloudHealthReport, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        let mut quick = conn.prepare("PRAGMA quick_check(1)").map_err(|e| e.to_string())?;
        let database_ok = if matches!(quick.next().map_err(|e| e.to_string())?, sqlite::State::Row) {
            quick.read::<String, _>(0).unwrap_or_default().eq_ignore_ascii_case("ok")
        } else {
            false
        };
        drop(quick);

        let cleaned = if repair { cleanup_stale_history(&conn)? } else { 0 };
        if repair {
            let _ = conn.execute("PRAGMA optimize;");
        }

        let active_transfers = scalar(&conn, "SELECT COUNT(*) FROM tcloud_sync_jobs WHERE status='running'");
        let waiting_transfers = scalar(&conn, "SELECT COUNT(*) FROM tcloud_sync_jobs WHERE status IN ('pending','paused')");
        let attention_items = scalar(
            &conn,
            "SELECT COUNT(DISTINCT j.file_id)
             FROM tcloud_sync_jobs j
             JOIN tcloud_files f ON f.id=j.file_id
             WHERE j.status='failed'
               AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed')",
        );
        let conflicts = if table_exists(&conn, "tcloud_sync_conflicts") {
            scalar(&conn, "SELECT COUNT(*) FROM tcloud_sync_conflicts WHERE resolution='pending'")
        } else { 0 };
        let cached_files = if table_exists(&conn, "tcloud_cache") {
            scalar(&conn, "SELECT COUNT(*) FROM tcloud_cache")
        } else { 0 };
        // A job can legitimately run for a long time when the file is huge. Six hours
        // is intentionally conservative: this only surfaces work that deserves a look;
        // it never cancels or requeues it automatically.
        let stalled_transfers = scalar(
            &conn,
            "SELECT COUNT(*) FROM tcloud_sync_jobs WHERE status='running' AND COALESCE(updated_at,0) < strftime('%s','now') - 21600",
        );
        let failed_cfapi_operations = if table_exists(&conn, "tcloud_cfapi_pending_ops") {
            scalar(&conn, "SELECT COUNT(DISTINCT file_id) FROM tcloud_cfapi_pending_ops WHERE completed_at IS NULL AND attempts>=12")
        } else { 0 };
        let previous_unclean_shutdown = read_setting(&conn, "stability_previous_unclean")
            .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);
        let summary = if !database_ok {
            "O banco local precisa de atenção.".to_string()
        } else if stalled_transfers > 0 {
            format!("TCloud está funcionando, mas {} transferência(ões) estão sem progresso há várias horas.", stalled_transfers)
        } else if attention_items > 0 || conflicts > 0 || failed_cfapi_operations > 0 {
            format!("{} item(ns) precisam de atenção, {} conflito(s) e {} ação(ões) do Explorer pendente(s).", attention_items, conflicts, failed_cfapi_operations)
        } else if previous_unclean_shutdown {
            "TCloud se recuperou de uma interrupção anterior e o banco local está íntegro.".to_string()
        } else if active_transfers > 0 || waiting_transfers > 0 {
            format!("TCloud saudável. {} transferência(ões) continuam em segundo plano.", active_transfers + waiting_transfers)
        } else {
            "TCloud saudável. Nenhuma ação necessária.".to_string()
        };
        Ok(TCloudHealthReport {
            database_ok,
            active_transfers,
            waiting_transfers,
            attention_items,
            conflicts,
            cached_files,
            stalled_transfers,
            failed_cfapi_operations,
            previous_unclean_shutdown,
            stale_history_cleaned: cleaned,
            repaired: repair,
            summary,
        })
    })
    .await
    .map_err(|e| format!("health check worker failed: {e}"))?
}
