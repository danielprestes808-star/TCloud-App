use crate::db::DbConnection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSyncActivity {
    pub id: i64,
    pub file_id: i64,
    pub file_name: String,
    pub file_path: String,
    pub operation: String,
    pub status: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub bytes_total: i64,
    pub bytes_transferred: i64,
    pub speed_bps: i64,
    pub eta_seconds: Option<i64>,
    pub paused: bool,
    pub cancel_requested: bool,
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSyncCenterStats {
    pub pending: i64,
    pub running: i64,
    pub failed: i64,
    pub completed: i64,
    pub uploads: i64,
    pub downloads: i64,
    pub deletes: i64,
    pub recent: Vec<TCloudSyncActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudSyncOverview {
    pub pending: i64,
    pub running: i64,
    pub failed: i64,
    pub historical_failed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudAttentionCleanupResult {
    pub cleaned_sync_jobs: i64,
    pub cleaned_cfapi_ops: i64,
    pub remaining: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TCloudAttentionCategories {
    pub conflicts: i64,
    pub network: i64,
    pub missing: i64,
    pub permissions: i64,
    pub explorer: i64,
    pub other: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudAttentionItem {
    pub id: i64,
    pub file_id: i64,
    pub file_name: String,
    pub file_path: String,
    pub source: String,
    pub category: String,
    pub operation: String,
    pub error: Option<String>,
    pub updated_at: i64,
    pub conflict_id: Option<i64>,
    pub remote_name: Option<String>,
    pub local_size: Option<i64>,
    pub remote_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudAttentionCenter {
    pub total: i64,
    pub historical: i64,
    pub categories: TCloudAttentionCategories,
    pub items: Vec<TCloudAttentionItem>,
}

fn scalar(conn: &sqlite::Connection, sql: &str) -> Result<i64, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    match stmt.next().map_err(|e| e.to_string())? {
        sqlite::State::Row => stmt.read::<i64, _>(0).map_err(|e| e.to_string()),
        _ => Ok(0),
    }
}

fn table_exists(conn: &sqlite::Connection, name: &str) -> bool {
    let Ok(mut stmt)=conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1") else{return false;};
    if stmt.bind((1,name)).is_err(){return false;}
    matches!(stmt.next(),Ok(sqlite::State::Row))
}


fn actionable_sync_failures(conn: &sqlite::Connection) -> Result<i64, String> {
    scalar(conn, "SELECT COUNT(DISTINCT j.file_id)
        FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id
        WHERE j.status='failed'
          AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed')
          AND NOT EXISTS (
              SELECT 1 FROM tcloud_sync_jobs newer
              WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id
          )")
}

fn historical_sync_failures(conn: &sqlite::Connection) -> Result<i64, String> {
    scalar(conn, "SELECT COUNT(*)
        FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id
        WHERE j.status='failed' AND (
            COALESCE(f.sync_status,'') IN ('synced','deleted','trashed') OR
            EXISTS (SELECT 1 FROM tcloud_sync_jobs newer
                    WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id)
        )")
}

fn historical_cfapi_failures(conn: &sqlite::Connection) -> Result<i64, String> {
    if !table_exists(conn, "tcloud_cfapi_pending_ops") { return Ok(0); }
    scalar(conn, "SELECT COUNT(*) FROM tcloud_cfapi_pending_ops p
        WHERE p.completed_at IS NULL AND p.attempts>=12
          AND EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer
                      WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id)")
}

fn classify_attention(operation: &str, error: Option<&str>) -> &'static str {
    let operation = operation.to_ascii_lowercase();
    let error = error.unwrap_or_default().to_ascii_lowercase();
    if operation.starts_with("cfapi") || matches!(operation.as_str(), "rename" | "move" | "delete" | "cleanup_delete") {
        return "explorer";
    }
    if error.contains("permission") || error.contains("access denied") || error.contains("acesso negado")
        || error.contains("permiss") || error.contains("read-only") || error.contains("readonly") {
        return "permissions";
    }
    if error.contains("not found") || error.contains("no such file") || error.contains("missing")
        || error.contains("não encontrado") || error.contains("nao encontrado") || error.contains("não existe")
        || error.contains("nao existe") {
        return "missing";
    }
    if error.contains("timeout") || error.contains("timed out") || error.contains("network")
        || error.contains("connection") || error.contains("conex") || error.contains("offline")
        || error.contains("dns") || error.contains("flood_wait") || error.contains("temporar")
        || error.contains("transport") || error.contains("telegram") {
        return "network";
    }
    "other"
}

fn increment_category(categories: &mut TCloudAttentionCategories, category: &str) {
    match category {
        "conflict" => categories.conflicts += 1,
        "network" => categories.network += 1,
        "missing" => categories.missing += 1,
        "permissions" => categories.permissions += 1,
        "explorer" => categories.explorer += 1,
        _ => categories.other += 1,
    }
}

fn actionable_attention_total(conn: &sqlite::Connection) -> Result<i64, String> {
    let mut parts = vec![
        "SELECT j.file_id AS file_id FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id \
         WHERE j.status='failed' AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed') \
         AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id)".to_string(),
        "SELECT file_id FROM tcloud_sync_conflicts WHERE resolution='pending'".to_string(),
    ];
    if table_exists(conn, "tcloud_cfapi_pending_ops") {
        parts.push("SELECT p.file_id AS file_id FROM tcloud_cfapi_pending_ops p WHERE p.completed_at IS NULL AND p.attempts>=12 \
                    AND NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id)".to_string());
    }
    let sql = format!("SELECT COUNT(*) FROM ({} )", parts.join(" UNION "));
    scalar(conn, &sql)
}

fn attention_center_inner(db: &DbConnection) -> Result<TCloudAttentionCenter, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut categories = TCloudAttentionCategories::default();
    let mut items = Vec::<TCloudAttentionItem>::new();
    let mut seen = HashSet::<i64>::new();
    let mut conflicts = HashMap::<i64, (i64, String, String, i64, Option<String>, Option<i64>, Option<i64>)>::new();

    if table_exists(&conn, "tcloud_sync_conflicts") {
        let mut stmt = conn.prepare(
            "SELECT id,file_id,COALESCE(file_name,'arquivo'),COALESCE(local_path,''),created_at,remote_name,local_size,remote_size \
             FROM tcloud_sync_conflicts WHERE resolution='pending' ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
            let file_id = stmt.read::<i64,_>(1).unwrap_or(0);
            let value = (
                stmt.read::<i64,_>(0).unwrap_or(0),
                stmt.read::<String,_>(2).unwrap_or_else(|_| "arquivo".into()),
                stmt.read::<String,_>(3).unwrap_or_default(),
                stmt.read::<i64,_>(4).unwrap_or(0),
                stmt.read::<Option<String>,_>(5).unwrap_or(None),
                stmt.read::<Option<i64>,_>(6).unwrap_or(None),
                stmt.read::<Option<i64>,_>(7).unwrap_or(None),
            );
            conflicts.entry(file_id).or_insert(value);
        }
    }

    let sync_sql = if table_exists(&conn, "tcloud_cfapi_items") {
        "SELECT j.id,j.file_id,COALESCE(f.name,'arquivo'),COALESCE(c.relative_path,f.path),j.operation,j.error,j.updated_at \
         FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id LEFT JOIN tcloud_cfapi_items c ON c.file_id=f.id \
         WHERE j.status='failed' AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed') \
           AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id) \
           AND j.id=(SELECT MAX(j2.id) FROM tcloud_sync_jobs j2 WHERE j2.file_id=j.file_id AND j2.status='failed' \
             AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs n2 WHERE n2.file_id=j2.file_id AND n2.operation=j2.operation AND n2.id>j2.id)) \
         ORDER BY j.updated_at DESC"
    } else {
        "SELECT j.id,j.file_id,COALESCE(f.name,'arquivo'),f.path,j.operation,j.error,j.updated_at \
         FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id \
         WHERE j.status='failed' AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed') \
           AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id) \
           AND j.id=(SELECT MAX(j2.id) FROM tcloud_sync_jobs j2 WHERE j2.file_id=j.file_id AND j2.status='failed' \
             AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs n2 WHERE n2.file_id=j2.file_id AND n2.operation=j2.operation AND n2.id>j2.id)) \
         ORDER BY j.updated_at DESC"
    };
    let mut sync_stmt = conn.prepare(sync_sql).map_err(|e| e.to_string())?;
    while let sqlite::State::Row = sync_stmt.next().map_err(|e| e.to_string())? {
        let file_id = sync_stmt.read::<i64,_>(1).unwrap_or(0);
        if !seen.insert(file_id) { continue; }
        let error = sync_stmt.read::<Option<String>,_>(5).unwrap_or(None);
        let operation = sync_stmt.read::<String,_>(4).unwrap_or_else(|_| "sync".into());
        let conflict = conflicts.get(&file_id);
        let category = if conflict.is_some() { "conflict" } else { classify_attention(&operation, error.as_deref()) };
        increment_category(&mut categories, category);
        items.push(TCloudAttentionItem {
            id: sync_stmt.read::<i64,_>(0).unwrap_or(0),
            file_id,
            file_name: sync_stmt.read::<String,_>(2).unwrap_or_else(|_| "arquivo".into()),
            file_path: sync_stmt.read::<String,_>(3).unwrap_or_default(),
            source: "sync".into(),
            category: category.into(),
            operation,
            error,
            updated_at: sync_stmt.read::<i64,_>(6).unwrap_or(0),
            conflict_id: conflict.map(|value| value.0),
            remote_name: conflict.and_then(|value| value.4.clone()),
            local_size: conflict.and_then(|value| value.5),
            remote_size: conflict.and_then(|value| value.6),
        });
    }
    drop(sync_stmt);

    if table_exists(&conn, "tcloud_cfapi_pending_ops") {
        let path_expr = if table_exists(&conn, "tcloud_cfapi_items") { "COALESCE(c.relative_path,'')" } else { "''" };
        let join_expr = if table_exists(&conn, "tcloud_cfapi_items") { "LEFT JOIN tcloud_cfapi_items c ON c.file_id=p.file_id" } else { "" };
        let sql = format!(
            "SELECT p.id,p.file_id,COALESCE(f.name,'arquivo'),{path_expr},p.op_type,p.last_error,COALESCE(p.last_attempt_at,p.created_at) \
             FROM tcloud_cfapi_pending_ops p LEFT JOIN tcloud_files f ON f.id=p.file_id {join_expr} \
             WHERE p.completed_at IS NULL AND p.attempts>=12 \
               AND NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id) \
               AND p.id=(SELECT MAX(p2.id) FROM tcloud_cfapi_pending_ops p2 WHERE p2.file_id=p.file_id AND p2.completed_at IS NULL AND p2.attempts>=12 \
                 AND NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops n2 WHERE n2.file_id=p2.file_id AND n2.op_type=p2.op_type AND n2.id>p2.id)) \
             ORDER BY COALESCE(p.last_attempt_at,p.created_at) DESC"
        );
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
            let file_id = stmt.read::<i64,_>(1).unwrap_or(0);
            if !seen.insert(file_id) { continue; }
            let raw_id = stmt.read::<i64,_>(0).unwrap_or(0);
            increment_category(&mut categories, "explorer");
            items.push(TCloudAttentionItem {
                id: -raw_id.abs(),
                file_id,
                file_name: stmt.read::<String,_>(2).unwrap_or_else(|_| "arquivo".into()),
                file_path: stmt.read::<String,_>(3).unwrap_or_default(),
                source: "cfapi".into(),
                category: "explorer".into(),
                operation: stmt.read::<String,_>(4).unwrap_or_else(|_| "cfapi".into()),
                error: stmt.read::<Option<String>,_>(5).unwrap_or(None),
                updated_at: stmt.read::<i64,_>(6).unwrap_or(0),
                conflict_id: None,
                remote_name: None,
                local_size: None,
                remote_size: None,
            });
        }
    }

    for (file_id, (conflict_id, file_name, local_path, created_at, remote_name, local_size, remote_size)) in conflicts {
        if !seen.insert(file_id) { continue; }
        increment_category(&mut categories, "conflict");
        items.push(TCloudAttentionItem {
            id: conflict_id,
            file_id,
            file_name,
            file_path: local_path,
            source: "conflict".into(),
            category: "conflict".into(),
            operation: "conflict".into(),
            error: None,
            updated_at: created_at,
            conflict_id: Some(conflict_id),
            remote_name,
            local_size,
            remote_size,
        });
    }

    items.sort_by(|a,b| b.updated_at.cmp(&a.updated_at));
    let total = items.len() as i64;
    items.truncate(250);
    let mut historical = historical_sync_failures(&conn)?;
    historical += historical_cfapi_failures(&conn)?;
    Ok(TCloudAttentionCenter { total, historical, categories, items })
}

fn job_counts(conn: &sqlite::Connection) -> Result<(i64, i64, i64, i64, i64, i64, i64), String> {
    // One indexed pass replaces seven independent COUNT queries. This command is
    // polled by the UI, so keeping its DB lock short is important for long-running sync.
    let mut stmt = conn.prepare(
        "SELECT
            COALESCE(SUM(CASE WHEN status IN ('pending','paused') THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN operation IN ('upload','refresh') THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN operation='download' THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN operation IN ('delete','delete_remote','delete_local') THEN 1 ELSE 0 END),0)
         FROM tcloud_sync_jobs"
    ).map_err(|e| e.to_string())?;
    if !matches!(stmt.next().map_err(|e| e.to_string())?, sqlite::State::Row) {
        return Ok((0,0,0,0,0,0,0));
    }
    Ok((
        stmt.read::<i64,_>(0).unwrap_or(0),
        stmt.read::<i64,_>(1).unwrap_or(0),
        stmt.read::<i64,_>(2).unwrap_or(0),
        stmt.read::<i64,_>(3).unwrap_or(0),
        stmt.read::<i64,_>(4).unwrap_or(0),
        stmt.read::<i64,_>(5).unwrap_or(0),
        stmt.read::<i64,_>(6).unwrap_or(0),
    ))
}

fn sync_overview_inner(db: &DbConnection) -> Result<TCloudSyncOverview, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let (mut pending, mut running, _raw_failed, _, _, _, _) = job_counts(&conn)?;
    // Only the latest attempt for the same file+operation is actionable. Historical
    // failures that were superseded by a newer attempt must not keep the red badge alive.
    let failed = actionable_attention_total(&conn)?;
    let mut historical_failed = historical_sync_failures(&conn)?;
    if table_exists(&conn, "tcloud_cfapi_pending_ops") {
        pending += scalar(&conn, "SELECT COUNT(*) FROM tcloud_cfapi_pending_ops p WHERE p.completed_at IS NULL AND p.attempts < 12 AND NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id)")?;
        historical_failed += historical_cfapi_failures(&conn)?;
    }
    if table_exists(&conn, "tcloud_explorer_folder_ops") {
        pending += scalar(&conn, "SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='pending'")?;
        running += scalar(&conn, "SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='running'")?;
    }
    Ok(TCloudSyncOverview { pending, running, failed, historical_failed })
}

#[tauri::command]
pub async fn tcloud_get_sync_overview(
    db: State<'_, DbConnection>,
) -> Result<TCloudSyncOverview, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || sync_overview_inner(&db))
        .await
        .map_err(|e| format!("sync overview worker failed: {e}"))?
}

// Kept as a plain Rust helper instead of a nested Tauri command.
// Tauri 2.11 can fail to resolve the generated __cmd__/__tauri_command_name
// macros for this specific nested command when referenced by module path from
// the large root generate_handler!. The root lib.rs owns the tiny command
// wrapper so the public JS command name remains exactly the same.
pub fn tcloud_attention_center_snapshot(
    db: &DbConnection,
) -> Result<TCloudAttentionCenter, String> {
    attention_center_inner(db)
}

fn sync_center_inner(db: &DbConnection) -> Result<TCloudSyncCenterStats, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let (mut pending, mut running, _raw_failed, mut completed, uploads, downloads, mut deletes) = job_counts(&conn)?;
    let failed = actionable_attention_total(&conn)?;

    let mut recent = Vec::new();
    let activity_sql=if table_exists(&conn,"tcloud_cfapi_items"){
        "SELECT j.id, j.file_id, f.name, COALESCE(c.relative_path,f.path), j.operation, j.status, j.error,
                j.created_at, j.updated_at, j.bytes_total, j.bytes_transferred,
                j.speed_bps, j.eta_seconds, j.paused, j.cancel_requested, j.priority
         FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id
         LEFT JOIN tcloud_cfapi_items c ON c.file_id=f.id
         WHERE j.status!='failed' OR (COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed')
           AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id))
         ORDER BY j.updated_at DESC LIMIT 100"
    }else{
        "SELECT j.id, j.file_id, f.name, f.path, j.operation, j.status, j.error,
                j.created_at, j.updated_at, j.bytes_total, j.bytes_transferred,
                j.speed_bps, j.eta_seconds, j.paused, j.cancel_requested, j.priority
         FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id
         WHERE j.status!='failed' OR (COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed')
           AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id))
         ORDER BY j.updated_at DESC LIMIT 100"
    };
    let mut stmt = conn.prepare(activity_sql).map_err(|e| e.to_string())?;

    while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        recent.push(TCloudSyncActivity {
            id: stmt.read::<i64, _>(0).map_err(|e| e.to_string())?,
            file_id: stmt.read::<i64, _>(1).map_err(|e| e.to_string())?,
            file_name: stmt.read::<String, _>(2).map_err(|e| e.to_string())?,
            file_path: stmt.read::<String, _>(3).map_err(|e| e.to_string())?,
            operation: stmt.read::<String, _>(4).map_err(|e| e.to_string())?,
            status: stmt.read::<String, _>(5).map_err(|e| e.to_string())?,
            error: stmt.read::<Option<String>, _>(6).unwrap_or(None),
            created_at: stmt.read::<i64, _>(7).unwrap_or(0),
            updated_at: stmt.read::<i64, _>(8).unwrap_or(0),
            bytes_total: stmt.read::<i64, _>(9).unwrap_or(0),
            bytes_transferred: stmt.read::<i64, _>(10).unwrap_or(0),
            speed_bps: stmt.read::<i64, _>(11).unwrap_or(0),
            eta_seconds: stmt.read::<Option<i64>, _>(12).unwrap_or(None),
            paused: stmt.read::<i64, _>(13).unwrap_or(0) != 0,
            cancel_requested: stmt.read::<i64, _>(14).unwrap_or(0) != 0,
            priority: stmt.read::<i64, _>(15).unwrap_or(0),
        });
    }
    drop(stmt);

    // CFAPI rename/move/delete operations have their own durable queue because
    // their immutable remote identity comes from the Cloud Files callback. Expose
    // them in the same Operations Center using negative ids so retry remains
    // unambiguous without changing either persistence format.
    if table_exists(&conn,"tcloud_cfapi_pending_ops") {
        pending += scalar(&conn,"SELECT COUNT(*) FROM tcloud_cfapi_pending_ops p WHERE p.completed_at IS NULL AND p.attempts < 12 AND NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id)")?;
        completed += scalar(&conn,"SELECT COUNT(*) FROM tcloud_cfapi_pending_ops WHERE completed_at IS NOT NULL")?;
        deletes += scalar(&conn,"SELECT COUNT(*) FROM tcloud_cfapi_pending_ops WHERE op_type IN ('delete','cleanup_delete')")?;

        let mut cf=conn.prepare(
            "SELECT p.id,p.file_id,COALESCE(f.name,'arquivo'),COALESCE(c.relative_path,''),p.op_type,p.attempts,p.last_error,p.created_at,COALESCE(p.last_attempt_at,p.created_at),p.completed_at
             FROM tcloud_cfapi_pending_ops p
             LEFT JOIN tcloud_files f ON f.id=p.file_id
             LEFT JOIN tcloud_cfapi_items c ON c.file_id=p.file_id
             WHERE p.completed_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer WHERE newer.file_id=p.file_id AND newer.op_type=p.op_type AND newer.id>p.id)
             ORDER BY COALESCE(p.last_attempt_at,p.created_at) DESC LIMIT 100"
        ).map_err(|e|e.to_string())?;
        while let sqlite::State::Row=cf.next().map_err(|e|e.to_string())? {
            let raw_id=cf.read::<i64,_>(0).unwrap_or(0);
            let attempts=cf.read::<i64,_>(5).unwrap_or(0);
            let completed_at=cf.read::<Option<i64>,_>(9).unwrap_or(None);
            let status=if completed_at.is_some(){"completed"}else if attempts>=12{"failed"}else{"pending"};
            recent.push(TCloudSyncActivity{
                id:-raw_id.abs(), file_id:cf.read::<i64,_>(1).unwrap_or(0),
                file_name:cf.read::<String,_>(2).unwrap_or_else(|_|"arquivo".into()),
                file_path:cf.read::<String,_>(3).unwrap_or_default(), operation:cf.read::<String,_>(4).unwrap_or_else(|_|"cfapi".into()),
                status:status.into(), error:cf.read::<Option<String>,_>(6).unwrap_or(None),
                created_at:cf.read::<i64,_>(7).unwrap_or(0), updated_at:cf.read::<i64,_>(8).unwrap_or(0),
                bytes_total:0,bytes_transferred:0,speed_bps:0,eta_seconds:None,paused:false,cancel_requested:false,priority:40,
            });
        }
        recent.sort_by(|a,b|b.updated_at.cmp(&a.updated_at));
        recent.truncate(100);
    }

    if table_exists(&conn,"tcloud_explorer_folder_ops") {
        pending += scalar(&conn,"SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='pending'")?;
        running += scalar(&conn,"SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='running'")?;
        completed += scalar(&conn,"SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='done'")?;
    }

    Ok(TCloudSyncCenterStats {
        pending,
        running,
        failed,
        completed,
        uploads,
        downloads,
        deletes,
        recent,
    })
}

#[tauri::command]
pub async fn tcloud_get_sync_center(
    db: State<'_, DbConnection>,
) -> Result<TCloudSyncCenterStats, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || sync_center_inner(&db))
        .await
        .map_err(|e| format!("sync center worker failed: {e}"))?
}

#[tauri::command]
pub fn tcloud_retry_sync_job(
    db: State<'_, DbConnection>,
    job_id: i64,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    if job_id < 0 && table_exists(&conn,"tcloud_cfapi_pending_ops") {
        let id=job_id.saturating_abs();
        let mut stmt=conn.prepare("UPDATE tcloud_cfapi_pending_ops SET attempts=0,last_attempt_at=NULL,last_error=NULL,completed_at=NULL WHERE id=?1")
            .map_err(|e|e.to_string())?;
        stmt.bind((1,id)).map_err(|e|e.to_string())?;
        stmt.next().map_err(|e|e.to_string())?;
        drop(stmt);
        drop(conn);
        #[cfg(target_os = "windows")]
        crate::commands::tcloud_cfapi::signal_cfapi_pending_work();
        return Ok(());
    }

    let mut stmt = conn
        .prepare(
            "UPDATE tcloud_sync_jobs
             SET status = 'pending', error = NULL, attempts = 0, next_attempt_at = NULL, cancel_requested = 0, paused = 0, pause_scope = NULL, updated_at = ?1
             WHERE id = ?2"
        )
        .map_err(|e| e.to_string())?;
    stmt.bind((1, now)).map_err(|e| e.to_string())?;
    stmt.bind((2, job_id)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    drop(stmt);
    drop(conn);
    crate::sync::scheduler::signal_sync_work();
    Ok(())
}

#[tauri::command]
pub fn tcloud_retry_all_sync_failures(
    db: State<'_, DbConnection>,
) -> Result<i64, String> {
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let count = actionable_sync_failures(&conn)?;
    if count > 0 {
        let mut stmt = conn.prepare(
            "UPDATE tcloud_sync_jobs SET status='pending',error=NULL,attempts=0,next_attempt_at=NULL,
                    cancel_requested=0,paused=0,pause_scope=NULL,updated_at=?1
             WHERE id IN (
                 SELECT j.id FROM tcloud_sync_jobs j JOIN tcloud_files f ON f.id=j.file_id
                 WHERE j.status='failed'
                   AND COALESCE(f.sync_status,'') NOT IN ('synced','deleted','trashed')
                   AND NOT EXISTS (SELECT 1 FROM tcloud_sync_jobs newer
                                   WHERE newer.file_id=j.file_id AND newer.operation=j.operation AND newer.id>j.id)
             )"
        ).map_err(|e|e.to_string())?;
        stmt.bind((1,now)).map_err(|e|e.to_string())?;
        stmt.next().map_err(|e|e.to_string())?;
    }
    drop(conn);
    if count > 0 { crate::sync::scheduler::signal_sync_work(); }
    Ok(count)
}

#[tauri::command]
pub fn tcloud_cleanup_stale_attention(
    db: State<'_, DbConnection>,
) -> Result<TCloudAttentionCleanupResult, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let cleaned_sync_jobs = historical_sync_failures(&conn)?;
    conn.execute("DELETE FROM tcloud_sync_jobs
        WHERE status='failed' AND (
            EXISTS (SELECT 1 FROM tcloud_files f WHERE f.id=tcloud_sync_jobs.file_id AND COALESCE(f.sync_status,'') IN ('synced','deleted','trashed')) OR
            EXISTS (SELECT 1 FROM tcloud_sync_jobs newer WHERE newer.file_id=tcloud_sync_jobs.file_id AND newer.operation=tcloud_sync_jobs.operation AND newer.id>tcloud_sync_jobs.id)
        )").map_err(|e|e.to_string())?;

    let mut cleaned_cfapi_ops = 0;
    if table_exists(&conn, "tcloud_cfapi_pending_ops") {
        cleaned_cfapi_ops = historical_cfapi_failures(&conn)?;
        conn.execute("DELETE FROM tcloud_cfapi_pending_ops
            WHERE completed_at IS NULL AND attempts>=12
              AND EXISTS (SELECT 1 FROM tcloud_cfapi_pending_ops newer
                          WHERE newer.file_id=tcloud_cfapi_pending_ops.file_id
                            AND newer.op_type=tcloud_cfapi_pending_ops.op_type
                            AND newer.id>tcloud_cfapi_pending_ops.id)")
            .map_err(|e|e.to_string())?;
    }

    let remaining = actionable_attention_total(&conn)?;
    Ok(TCloudAttentionCleanupResult { cleaned_sync_jobs, cleaned_cfapi_ops, remaining })
}

#[tauri::command]
pub fn tcloud_clear_completed_jobs(
    db: State<'_, DbConnection>,
) -> Result<i64, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;

    let count = scalar(
        &conn,
        "SELECT COUNT(*) FROM tcloud_sync_jobs WHERE status = 'completed'"
    )?;

    conn.execute("DELETE FROM tcloud_sync_jobs WHERE status = 'completed'")
        .map_err(|e| e.to_string())?;
    let mut total=count;
    if table_exists(&conn,"tcloud_cfapi_pending_ops") {
        let cf_count=scalar(&conn,"SELECT COUNT(*) FROM tcloud_cfapi_pending_ops WHERE completed_at IS NOT NULL")?;
        conn.execute("DELETE FROM tcloud_cfapi_pending_ops WHERE completed_at IS NOT NULL").map_err(|e|e.to_string())?;
        total+=cf_count;
    }
    if table_exists(&conn,"tcloud_explorer_folder_ops") {
        let folder_count=scalar(&conn,"SELECT COUNT(*) FROM tcloud_explorer_folder_ops WHERE status='done'")?;
        conn.execute("DELETE FROM tcloud_explorer_folder_ops WHERE status='done'").map_err(|e|e.to_string())?;
        total+=folder_count;
    }

    Ok(total)
}
