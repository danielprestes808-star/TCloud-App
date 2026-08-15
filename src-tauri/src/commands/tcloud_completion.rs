use crate::commands::TelegramState;
use crate::crypto::state::CryptoState;
use crate::db::DbConnection;
use grammers_client::{InputMessage, types::Peer};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn background_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroize;

const FAVORITES_MARKER: &str = "#TCLOUD_FAVORITES_V3";
const FAVORITES_MARKER_V2: &str = "#TCLOUD_FAVORITES_V2";

fn ensure_schema(conn: &sqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tcloud_folder_crypto_policy (
            folder_id INTEGER PRIMARY KEY,
            mode TEXT NOT NULL DEFAULT 'inherit',
            protect_metadata INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tcloud_music_playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tcloud_music_playlist_items (
            playlist_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(playlist_id,file_id)
        );
        CREATE TABLE IF NOT EXISTS tcloud_share_access_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL,
            accessed_at INTEGER NOT NULL,
            ip TEXT,
            user_agent TEXT,
            range_request INTEGER NOT NULL DEFAULT 0,
            authorized INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_tcloud_share_access_token ON tcloud_share_access_log(token,accessed_at DESC);
        CREATE TABLE IF NOT EXISTS tcloud_completion_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderCryptoPolicy {
    pub folder_id: i64,
    pub mode: String,
    pub protect_metadata: bool,
    pub updated_at: i64,
}

#[tauri::command]
pub fn tcloud_completion_folder_crypto_get(
    db: State<'_, DbConnection>,
    folder_id: i64,
) -> Result<FolderCryptoPolicy, String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    ensure_schema(&conn)?;
    let mut stmt = conn.prepare("SELECT mode,protect_metadata,updated_at FROM tcloud_folder_crypto_policy WHERE folder_id=?1")
        .map_err(|e| e.to_string())?;
    stmt.bind((1, folder_id)).map_err(|e| e.to_string())?;
    if let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        Ok(FolderCryptoPolicy {
            folder_id,
            mode: stmt.read::<String,_>(0).unwrap_or_else(|_| "inherit".into()),
            protect_metadata: stmt.read::<i64,_>(1).unwrap_or(1) != 0,
            updated_at: stmt.read::<i64,_>(2).unwrap_or(0),
        })
    } else {
        Ok(FolderCryptoPolicy { folder_id, mode: "inherit".into(), protect_metadata: true, updated_at: 0 })
    }
}

#[tauri::command]
pub fn tcloud_completion_folder_crypto_set(
    db: State<'_, DbConnection>,
    folder_id: i64,
    mode: String,
    protect_metadata: bool,
) -> Result<FolderCryptoPolicy, String> {
    if !matches!(mode.as_str(), "inherit" | "standard" | "vault") {
        return Err("Modo de criptografia de pasta inválido".into());
    }
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    ensure_schema(&conn)?;
    let mut stmt = conn.prepare(
        "INSERT INTO tcloud_folder_crypto_policy(folder_id,mode,protect_metadata,updated_at) VALUES(?1,?2,?3,?4)
         ON CONFLICT(folder_id) DO UPDATE SET mode=excluded.mode,protect_metadata=excluded.protect_metadata,updated_at=excluded.updated_at"
    ).map_err(|e| e.to_string())?;
    stmt.bind((1, folder_id)).map_err(|e| e.to_string())?;
    stmt.bind((2, mode.as_str())).map_err(|e| e.to_string())?;
    stmt.bind((3, if protect_metadata { 1i64 } else { 0i64 })).map_err(|e| e.to_string())?;
    stmt.bind((4, now)).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(FolderCryptoPolicy { folder_id, mode, protect_metadata, updated_at: now })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentReindexResult {
    pub text_files: usize,
    pub pdf_files: usize,
    pub ocr_images: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[cfg(all(target_os = "windows", tcloud_native_bridge))]
mod native {
    extern "C" {
        pub fn tcloud_cfapi_register(root_path: *const u16, version: *const u16, error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_cfapi_unregister(root_path: *const u16, error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_cfapi_platform_supported() -> i32;
        pub fn tcloud_windows_hello_available(error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_windows_hello_verify(prompt: *const u16, error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_dpapi_protect(text: *const u16, output_path: *const u16, error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_dpapi_unprotect(input_path: *const u16, output_text: *mut u16, output_cap: usize, error: *mut u16, error_cap: usize) -> i32;
        pub fn tcloud_ocr_image(input_path: *const u16, output_text: *mut u16, output_cap: usize, error: *mut u16, error_cap: usize) -> i32;
    }
}

#[cfg(all(target_os = "windows", not(tcloud_native_bridge)))]
mod native {
    unsafe fn write_error(out: *mut u16, cap: usize, message: &str) {
        if out.is_null() || cap == 0 { return; }
        let encoded: Vec<u16> = message.encode_utf16().collect();
        let count = encoded.len().min(cap.saturating_sub(1));
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), out, count);
        *out.add(count) = 0;
    }

    pub unsafe fn tcloud_cfapi_register(
        _root_path: *const u16, _version: *const u16, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "CFAPI nativa está desativada neste modo de compatibilidade.");
        0
    }

    pub unsafe fn tcloud_cfapi_unregister(
        _root_path: *const u16, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "CFAPI nativa não está ativa nesta compilação.");
        0
    }

    pub unsafe fn tcloud_cfapi_platform_supported() -> i32 { 0 }

    pub unsafe fn tcloud_windows_hello_available(error: *mut u16, error_cap: usize) -> i32 {
        write_error(error, error_cap, "Windows Hello nativo está temporariamente desativado nesta compilação de compatibilidade.");
        0
    }

    pub unsafe fn tcloud_windows_hello_verify(
        _prompt: *const u16, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "Windows Hello nativo está temporariamente desativado nesta compilação de compatibilidade.");
        0
    }

    pub unsafe fn tcloud_dpapi_protect(
        _text: *const u16, _output_path: *const u16, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "Proteção DPAPI via ponte nativa está indisponível nesta compilação.");
        0
    }

    pub unsafe fn tcloud_dpapi_unprotect(
        _input_path: *const u16, _output_text: *mut u16, _output_cap: usize, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "Proteção DPAPI via ponte nativa está indisponível nesta compilação.");
        0
    }

    pub unsafe fn tcloud_ocr_image(
        _input_path: *const u16, _output_text: *mut u16, _output_cap: usize, error: *mut u16, error_cap: usize
    ) -> i32 {
        write_error(error, error_cap, "OCR nativo do Windows está temporariamente desativado; indexação de PDF e texto continua disponível.");
        0
    }
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn wide_buffer_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|v| *v == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end]).trim().to_string()
}

#[cfg(target_os = "windows")]
fn ocr_image(path: &Path) -> Result<String, String> {
    let input = wide_path(path);
    // Windows OCR results can be fairly large for scans. 1M UTF-16 code units
    // keeps indexing bounded while being enough for normal documents.
    let mut output = vec![0u16; 1_000_000];
    let mut error = vec![0u16; 2048];
    let ok = unsafe { native::tcloud_ocr_image(input.as_ptr(), output.as_mut_ptr(), output.len(), error.as_mut_ptr(), error.len()) };
    if ok == 1 { Ok(wide_buffer_to_string(&output)) } else { Err(wide_buffer_to_string(&error)) }
}

#[cfg(not(target_os = "windows"))]
fn ocr_image(_path: &Path) -> Result<String, String> {
    Err("OCR nativo desta versão está disponível no Windows".into())
}

fn upsert_content(db: &DbConnection, file_id: i64, content: &str) -> Result<(), String> {
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tcloud_content_index (
            file_id INTEGER PRIMARY KEY,
            content TEXT NOT NULL DEFAULT '',
            indexed_at INTEGER NOT NULL
        );"
    ).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "INSERT INTO tcloud_content_index(file_id,content,indexed_at) VALUES(?1,?2,?3)
         ON CONFLICT(file_id) DO UPDATE SET content=excluded.content,indexed_at=excluded.indexed_at"
    ).map_err(|e| e.to_string())?;
    stmt.bind((1, file_id)).map_err(|e| e.to_string())?;
    stmt.bind((2, content)).map_err(|e| e.to_string())?;
    stmt.bind((3, chrono::Utc::now().timestamp())).map_err(|e| e.to_string())?;
    stmt.next().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn tcloud_completion_reindex_content(
    db: State<'_, DbConnection>,
    include_ocr: Option<bool>,
) -> Result<ContentReindexResult, String> {
    let rows = {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        conn.execute("CREATE TABLE IF NOT EXISTS tcloud_content_index (file_id INTEGER PRIMARY KEY,content TEXT NOT NULL DEFAULT '',indexed_at INTEGER NOT NULL)")
            .map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT f.id,f.name,c.local_path FROM tcloud_cache c JOIN tcloud_files f ON f.id=c.file_id WHERE f.sync_status!='trashed'")
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
            out.push((stmt.read::<i64,_>(0).map_err(|e| e.to_string())?, stmt.read::<String,_>(1).map_err(|e| e.to_string())?, stmt.read::<String,_>(2).map_err(|e| e.to_string())?));
        }
        out
    };

    let text_ext = ["txt","md","csv","json","log","xml","html","htm","ini","yaml","yml","toml","rs","ts","tsx","js","jsx","css","py","sql","rtf"];
    let image_ext = ["png","jpg","jpeg","bmp","webp","tif","tiff"];
    let mut result = ContentReindexResult { text_files: 0, pdf_files: 0, ocr_images: 0, skipped: 0, errors: Vec::new() };
    let use_ocr = include_ocr.unwrap_or(true);

    for (file_id, name, local_path) in rows {
        let path = PathBuf::from(local_path);
        if !path.is_file() { result.skipped += 1; continue; }
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let extracted = if text_ext.contains(&ext.as_str()) {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let limited = if bytes.len() > 8_000_000 { &bytes[..8_000_000] } else { &bytes[..] };
                    result.text_files += 1;
                    Some(String::from_utf8_lossy(limited).to_string())
                }
                Err(e) => { result.errors.push(format!("{}: {}", name, e)); None }
            }
        } else if ext == "pdf" {
            let p = path.clone();
            match tauri::async_runtime::spawn_blocking(move || pdf_extract::extract_text(&p)).await {
                Ok(Ok(text)) => { result.pdf_files += 1; Some(text) }
                Ok(Err(e)) => { result.errors.push(format!("{}: PDF: {}", name, e)); None }
                Err(e) => { result.errors.push(format!("{}: PDF worker: {}", name, e)); None }
            }
        } else if use_ocr && image_ext.contains(&ext.as_str()) {
            let p = path.clone();
            match tauri::async_runtime::spawn_blocking(move || ocr_image(&p)).await {
                Ok(Ok(text)) if !text.trim().is_empty() => { result.ocr_images += 1; Some(text) }
                Ok(Ok(_)) => { result.skipped += 1; None }
                Ok(Err(e)) => { result.errors.push(format!("{}: OCR: {}", name, e)); None }
                Err(e) => { result.errors.push(format!("{}: OCR worker: {}", name, e)); None }
            }
        } else {
            result.skipped += 1;
            None
        };
        if let Some(text) = extracted {
            let bounded: String = text.chars().take(2_000_000).collect();
            if let Err(e) = upsert_content(db.inner(), file_id, &bounded) {
                result.errors.push(format!("{}: índice: {}", name, e));
            }
        }
    }
    if result.errors.len() > 50 { result.errors.truncate(50); }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDownloadQueueResult {
    pub candidates: i64,
    pub queued: i64,
    pub already_queued: i64,
}

#[tauri::command]
pub fn tcloud_completion_queue_indexable_downloads(
    db: State<'_, DbConnection>,
    limit: Option<i64>,
) -> Result<IndexDownloadQueueResult, String> {
    let limit = limit.unwrap_or(100).clamp(1, 250) as usize;
    let indexable = [
        "txt","md","csv","json","log","xml","html","htm","ini","yaml","yml","toml",
        "rs","ts","tsx","js","jsx","css","py","sql","rtf","pdf",
        "png","jpg","jpeg","bmp","webp","tif","tiff",
    ];
    let now = chrono::Utc::now().timestamp();
    let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let mut stmt = conn.prepare(
        "SELECT f.id,f.name FROM tcloud_files f
         LEFT JOIN tcloud_cache c ON c.file_id=f.id
         WHERE c.file_id IS NULL AND f.telegram_message_id IS NOT NULL
           AND COALESCE(f.sync_status,'')!='trashed'
         ORDER BY f.updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let mut rows: Vec<(i64,String)> = Vec::new();
    while let sqlite::State::Row = stmt.next().map_err(|e| e.to_string())? {
        let id = stmt.read::<i64,_>(0).map_err(|e| e.to_string())?;
        let name = stmt.read::<String,_>(1).unwrap_or_default();
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if indexable.contains(&ext.as_str()) { rows.push((id,name)); }
    }
    let candidates = rows.len() as i64;
    let mut queued=0i64; let mut already_queued=0i64;
    for (file_id,_) in rows.into_iter().take(limit) {
        let mut exists = conn.prepare(
            "SELECT id FROM tcloud_sync_jobs WHERE file_id=?1 AND operation='download'
             AND status IN ('pending','running','paused','downloading') LIMIT 1"
        ).map_err(|e|e.to_string())?;
        exists.bind((1,file_id)).map_err(|e|e.to_string())?;
        if let sqlite::State::Row = exists.next().map_err(|e|e.to_string())? { already_queued+=1; continue; }
        let mut job=conn.prepare(
            "INSERT INTO tcloud_sync_jobs(file_id,operation,status,created_at,updated_at) VALUES(?1,'download','pending',?2,?3)"
        ).map_err(|e|e.to_string())?;
        job.bind((1,file_id)).map_err(|e|e.to_string())?;
        job.bind((2,now)).map_err(|e|e.to_string())?;
        job.bind((3,now)).map_err(|e|e.to_string())?;
        job.next().map_err(|e|e.to_string())?;
        let mut up=conn.prepare("UPDATE tcloud_files SET sync_status='downloading',updated_at=?1 WHERE id=?2").map_err(|e|e.to_string())?;
        up.bind((1,now)).map_err(|e|e.to_string())?; up.bind((2,file_id)).map_err(|e|e.to_string())?; up.next().map_err(|e|e.to_string())?;
        queued+=1;
    }
    drop(stmt);
    drop(conn);
    if queued > 0 { crate::sync::scheduler::signal_sync_work(); }
    Ok(IndexDownloadQueueResult{candidates,queued,already_queued})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CfapiStatus {
    pub platform_supported: bool,
    pub registered: bool,
    pub root_path: String,
    pub fallback: String,
    pub detail: String,
}

fn cfapi_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("CloudRoot");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

#[tauri::command]
pub fn tcloud_completion_cfapi_status(app: AppHandle) -> Result<CfapiStatus, String> {
    let root = cfapi_root(&app)?;
    #[cfg(target_os = "windows")]
    {
        let supported = unsafe { native::tcloud_cfapi_platform_supported() } == 1;
        let marker = root.join(".tcloud-cfapi-registered");
        return Ok(CfapiStatus { platform_supported: supported, registered: marker.exists(), root_path: root.to_string_lossy().into_owned(), fallback: "Nenhum — CFAPI/Explorer".into(), detail: if marker.exists() { "Sync root CFAPI registrado e disponível para hidratação nativa.".into() } else { "CFAPI disponível para ativação.".into() } });
    }
    #[cfg(not(target_os = "windows"))]
    Ok(CfapiStatus { platform_supported: false, registered: false, root_path: root.to_string_lossy().into_owned(), fallback: "Não aplicável".into(), detail: "CFAPI é uma integração do Windows.".into() })
}

#[tauri::command]
pub fn tcloud_completion_cfapi_set(app: AppHandle, enabled: bool) -> Result<CfapiStatus, String> {
    let root = cfapi_root(&app)?;
    #[cfg(target_os = "windows")]
    {
        let root_w = wide_path(&root);
        let mut error = vec![0u16; 2048];
        let ok = if enabled {
            let version = wide(env!("CARGO_PKG_VERSION"));
            unsafe { native::tcloud_cfapi_register(root_w.as_ptr(), version.as_ptr(), error.as_mut_ptr(), error.len()) }
        } else {
            unsafe { native::tcloud_cfapi_unregister(root_w.as_ptr(), error.as_mut_ptr(), error.len()) }
        };
        if ok != 1 {
            let detail = wide_buffer_to_string(&error);
            // Unregistering an already-unregistered root should not make TCloud unusable.
            if enabled { return Err(if detail.is_empty() { "Falha ao registrar CFAPI".into() } else { detail }); }
        }
        let marker = root.join(".tcloud-cfapi-registered");
        if enabled { let _ = std::fs::write(&marker, env!("CARGO_PKG_VERSION")); } else { let _ = std::fs::remove_file(&marker); }
        return tcloud_completion_cfapi_status(app);
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = enabled; tcloud_completion_cfapi_status(app) }
}

fn hello_secret_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vault");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("windows_hello.dat"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowsHelloStatus {
    pub supported: bool,
    pub enrolled: bool,
    pub detail: String,
}

#[tauri::command]
pub fn tcloud_completion_windows_hello_status(app: AppHandle) -> Result<WindowsHelloStatus, String> {
    let enrolled = hello_secret_path(&app)?.exists();
    #[cfg(target_os = "windows")]
    {
        let mut error = vec![0u16; 2048];
        let supported = unsafe { native::tcloud_windows_hello_available(error.as_mut_ptr(), error.len()) } == 1;
        let detail = if supported { "Windows Hello disponível".into() } else { let e=wide_buffer_to_string(&error); if e.is_empty(){"Windows Hello indisponível".into()}else{e} };
        return Ok(WindowsHelloStatus { supported, enrolled, detail });
    }
    #[cfg(not(target_os = "windows"))]
    Ok(WindowsHelloStatus { supported: false, enrolled, detail: "Windows Hello requer Windows".into() })
}

#[tauri::command]
pub fn tcloud_completion_windows_hello_enroll(app: AppHandle, mut passphrase: String) -> Result<WindowsHelloStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let mut error = vec![0u16; 2048];
        let prompt = wide("Autorizar o Windows Hello para o Cofre TCloud");
        if unsafe { native::tcloud_windows_hello_verify(prompt.as_ptr(), error.as_mut_ptr(), error.len()) } != 1 {
            passphrase.zeroize();
            return Err({ let e=wide_buffer_to_string(&error); if e.is_empty(){"Verificação do Windows Hello cancelada".into()}else{e} });
        }
        let secret = wide(&passphrase);
        let path = hello_secret_path(&app)?;
        let path_w = wide_path(&path);
        let ok = unsafe { native::tcloud_dpapi_protect(secret.as_ptr(), path_w.as_ptr(), error.as_mut_ptr(), error.len()) };
        passphrase.zeroize();
        if ok != 1 { return Err({ let e=wide_buffer_to_string(&error); if e.is_empty(){"Falha ao proteger credencial do Cofre".into()}else{e} }); }
        return tcloud_completion_windows_hello_status(app);
    }
    #[cfg(not(target_os = "windows"))]
    { passphrase.zeroize(); Err("Windows Hello requer Windows".into()) }
}

#[tauri::command]
pub fn tcloud_completion_windows_hello_remove(app: AppHandle) -> Result<WindowsHelloStatus, String> {
    let path = hello_secret_path(&app)?;
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    tcloud_completion_windows_hello_status(app)
}

#[tauri::command]
pub fn tcloud_completion_windows_hello_unlock(app: AppHandle, crypto_state: State<'_, CryptoState>) -> Result<u64, String> {
    #[cfg(target_os = "windows")]
    {
        let path = hello_secret_path(&app)?;
        if !path.exists() { return Err("Windows Hello ainda não foi configurado para este Cofre".into()); }
        let mut error = vec![0u16; 2048];
        let prompt = wide("Desbloquear Cofre TCloud");
        if unsafe { native::tcloud_windows_hello_verify(prompt.as_ptr(), error.as_mut_ptr(), error.len()) } != 1 {
            return Err({ let e=wide_buffer_to_string(&error); if e.is_empty(){"Verificação do Windows Hello cancelada".into()}else{e} });
        }
        let path_w = wide_path(&path);
        let mut output = vec![0u16; 65536];
        if unsafe { native::tcloud_dpapi_unprotect(path_w.as_ptr(), output.as_mut_ptr(), output.len(), error.as_mut_ptr(), error.len()) } != 1 {
            return Err({ let e=wide_buffer_to_string(&error); if e.is_empty(){"Falha ao recuperar credencial protegida".into()}else{e} });
        }
        let mut passphrase = wide_buffer_to_string(&output);
        let result = crypto_state.unlock(passphrase.as_bytes()).map_err(|e| e.to_string());
        passphrase.zeroize();
        output.zeroize();
        result
    }
    #[cfg(not(target_os = "windows"))]
    { let _=app; let _=crypto_state; Err("Windows Hello requer Windows".into()) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicTrack {
    pub file_id: i64,
    pub message_id: Option<i64>,
    pub folder_id: Option<i64>,
    pub name: String,
    pub local_path: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_seconds: Option<f64>,
    pub cached: bool,
}

fn ffprobe_tags(path: &str) -> (Option<String>,Option<String>,Option<String>,Option<f64>) {
    let output = background_command("ffprobe").args(["-v","quiet","-print_format","json","-show_entries","format=duration:format_tags=title,artist,album",path]).output();
    let Ok(output) = output else { return (None,None,None,None); };
    if !output.status.success() { return (None,None,None,None); }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else { return (None,None,None,None); };
    let format = value.get("format");
    let tags = format.and_then(|v| v.get("tags"));
    let title = tags.and_then(|v| v.get("title")).and_then(|v| v.as_str()).map(str::to_string);
    let artist = tags.and_then(|v| v.get("artist")).and_then(|v| v.as_str()).map(str::to_string);
    let album = tags.and_then(|v| v.get("album")).and_then(|v| v.as_str()).map(str::to_string);
    let duration = format.and_then(|v| v.get("duration")).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok());
    (title,artist,album,duration)
}

#[tauri::command]
pub async fn tcloud_completion_music_library(db: State<'_, DbConnection>) -> Result<Vec<MusicTrack>, String> {
    let rows = {
        let conn = db.lock().map_err(|_| "database lock poisoned".to_string())?;
        ensure_schema(&conn)?;
        let mut stmt = conn.prepare(
            "SELECT f.id,f.telegram_message_id,f.telegram_chat_id,f.name,c.local_path
             FROM tcloud_files f LEFT JOIN tcloud_cache c ON c.file_id=f.id
             WHERE f.sync_status!='trashed' AND (lower(f.name) LIKE '%.mp3' OR lower(f.name) LIKE '%.m4a' OR lower(f.name) LIKE '%.flac' OR lower(f.name) LIKE '%.wav' OR lower(f.name) LIKE '%.ogg' OR lower(f.name) LIKE '%.opus' OR lower(f.name) LIKE '%.aac')
             ORDER BY f.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let mut out=Vec::new();
        while let sqlite::State::Row=stmt.next().map_err(|e|e.to_string())? {
            out.push((stmt.read::<i64,_>(0).map_err(|e|e.to_string())?,stmt.read::<Option<i64>,_>(1).unwrap_or(None),stmt.read::<Option<i64>,_>(2).unwrap_or(None),stmt.read::<String,_>(3).map_err(|e|e.to_string())?,stmt.read::<Option<String>,_>(4).unwrap_or(None)));
        }
        out
    };
    let mut tracks=Vec::with_capacity(rows.len());
    for (file_id,message_id,folder_id,name,local_path) in rows {
        let stem = Path::new(&name).file_stem().and_then(|s|s.to_str()).unwrap_or(&name).to_string();
        let (title,artist,album,duration)=if let Some(path)=local_path.as_ref().filter(|p|Path::new(p).is_file()) {
            let p=path.clone(); tauri::async_runtime::spawn_blocking(move || ffprobe_tags(&p)).await.unwrap_or((None,None,None,None))
        } else {(None,None,None,None)};
        tracks.push(MusicTrack{file_id,message_id,folder_id,name:name.clone(),local_path:local_path.clone(),title:title.unwrap_or(stem),artist:artist.unwrap_or_else(||"Artista desconhecido".into()),album:album.unwrap_or_else(||"Sem álbum".into()),duration_seconds:duration,cached:local_path.as_ref().map(|p|Path::new(p).is_file()).unwrap_or(false)});
    }
    Ok(tracks)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicPlaylist { pub id:i64, pub name:String, pub file_ids:Vec<i64>, pub created_at:i64 }

#[tauri::command]
pub fn tcloud_completion_music_playlists(db: State<'_, DbConnection>) -> Result<Vec<MusicPlaylist>,String> {
    let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?; ensure_schema(&conn)?;
    let mut stmt=conn.prepare("SELECT id,name,created_at FROM tcloud_music_playlists ORDER BY name COLLATE NOCASE").map_err(|e|e.to_string())?;
    let mut out=Vec::new();
    while let sqlite::State::Row=stmt.next().map_err(|e|e.to_string())? {
        let id=stmt.read::<i64,_>(0).map_err(|e|e.to_string())?;
        let mut items=conn.prepare("SELECT file_id FROM tcloud_music_playlist_items WHERE playlist_id=?1 ORDER BY position,file_id").map_err(|e|e.to_string())?; items.bind((1,id)).map_err(|e|e.to_string())?;
        let mut ids=Vec::new(); while let sqlite::State::Row=items.next().map_err(|e|e.to_string())? { ids.push(items.read::<i64,_>(0).map_err(|e|e.to_string())?); }
        out.push(MusicPlaylist{id,name:stmt.read(1).map_err(|e|e.to_string())?,created_at:stmt.read(2).unwrap_or(0),file_ids:ids});
    }
    Ok(out)
}

#[tauri::command]
pub fn tcloud_completion_music_playlist_save(db: State<'_, DbConnection>, id:Option<i64>, name:String, file_ids:Vec<i64>) -> Result<i64,String> {
    let name=name.trim(); if name.is_empty(){return Err("Nome da playlist vazio".into());}
    let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?; ensure_schema(&conn)?; conn.execute("BEGIN IMMEDIATE").map_err(|e|e.to_string())?;
    let playlist_id=if let Some(id)=id { let mut s=conn.prepare("UPDATE tcloud_music_playlists SET name=?1 WHERE id=?2").map_err(|e|e.to_string())?;s.bind((1,name)).map_err(|e|e.to_string())?;s.bind((2,id)).map_err(|e|e.to_string())?;s.next().map_err(|e|e.to_string())?;id } else { let mut s=conn.prepare("INSERT INTO tcloud_music_playlists(name,created_at) VALUES(?1,?2)").map_err(|e|e.to_string())?;s.bind((1,name)).map_err(|e|e.to_string())?;s.bind((2,chrono::Utc::now().timestamp())).map_err(|e|e.to_string())?;s.next().map_err(|e|e.to_string())?;crate::db::last_insert_rowid(&conn)? };
    {let mut d=conn.prepare("DELETE FROM tcloud_music_playlist_items WHERE playlist_id=?1").map_err(|e|e.to_string())?;d.bind((1,playlist_id)).map_err(|e|e.to_string())?;d.next().map_err(|e|e.to_string())?;}
    for (position,file_id) in file_ids.iter().enumerate(){let mut s=conn.prepare("INSERT OR REPLACE INTO tcloud_music_playlist_items(playlist_id,file_id,position) VALUES(?1,?2,?3)").map_err(|e|e.to_string())?;s.bind((1,playlist_id)).map_err(|e|e.to_string())?;s.bind((2,*file_id)).map_err(|e|e.to_string())?;s.bind((3,position as i64)).map_err(|e|e.to_string())?;s.next().map_err(|e|e.to_string())?;}
    conn.execute("COMMIT").map_err(|e|e.to_string())?; Ok(playlist_id)
}

#[tauri::command]
pub fn tcloud_completion_music_playlist_delete(db: State<'_, DbConnection>, id:i64)->Result<bool,String>{let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?;ensure_schema(&conn)?;let mut a=conn.prepare("DELETE FROM tcloud_music_playlist_items WHERE playlist_id=?1").map_err(|e|e.to_string())?;a.bind((1,id)).map_err(|e|e.to_string())?;a.next().map_err(|e|e.to_string())?;let mut b=conn.prepare("DELETE FROM tcloud_music_playlists WHERE id=?1").map_err(|e|e.to_string())?;b.bind((1,id)).map_err(|e|e.to_string())?;b.next().map_err(|e|e.to_string())?;Ok(true)}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupResult { pub removed_files:i64, pub reclaimed_bytes:i64, pub pruned_versions:i64, pub pruned_trash_rows:i64, pub errors:Vec<String> }

#[tauri::command]
pub fn tcloud_completion_cleanup_apply(db: State<'_, DbConnection>, cache_days:Option<i64>, trash_days:Option<i64>, version_days:Option<i64>) -> Result<CleanupResult,String> {
    let now=chrono::Utc::now().timestamp(); let cache_cutoff=now-cache_days.unwrap_or(30).clamp(1,3650)*86400; let trash_cutoff=now-trash_days.unwrap_or(30).clamp(1,3650)*86400; let version_cutoff=now-version_days.unwrap_or(90).clamp(1,3650)*86400;
    let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?; ensure_schema(&conn)?;
    let mut result=CleanupResult{removed_files:0,reclaimed_bytes:0,pruned_versions:0,pruned_trash_rows:0,errors:Vec::new()};
    let mut rows=Vec::new();
    if let Ok(mut stmt)=conn.prepare("SELECT c.file_id,c.local_path,COALESCE(f.size,0) FROM tcloud_cache c LEFT JOIN tcloud_files f ON f.id=c.file_id LEFT JOIN tcloud_offline_pins p ON p.file_id=c.file_id WHERE p.file_id IS NULL AND COALESCE(c.last_accessed_at,0) < ?1") { let _=stmt.bind((1,cache_cutoff)); while let Ok(sqlite::State::Row)=stmt.next(){rows.push((stmt.read::<i64,_>(0).unwrap_or(0),stmt.read::<String,_>(1).unwrap_or_default(),stmt.read::<i64,_>(2).unwrap_or(0)));} }
    for (file_id,path,size) in rows { if !path.is_empty() { match std::fs::remove_file(&path){Ok(_)=>{result.removed_files+=1;result.reclaimed_bytes+=size.max(0)},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>result.errors.push(format!("{}: {}",path,e))}; } let mut d=conn.prepare("DELETE FROM tcloud_cache WHERE file_id=?1").map_err(|e|e.to_string())?;d.bind((1,file_id)).map_err(|e|e.to_string())?;d.next().map_err(|e|e.to_string())?; }
    // Manual snapshots are metadata-only and may age out here. Automatic versions
    // have file_id and represent real retained Telegram messages; their retention is
    // enforced by the upload processor so metadata and remote object are never split.
    result.pruned_versions={let before=scalar_count(&conn,"SELECT COUNT(*) FROM tcloud_versions WHERE file_id IS NULL");let mut d=conn.prepare("DELETE FROM tcloud_versions WHERE file_id IS NULL AND created_at < ?1").map_err(|e|e.to_string())?;d.bind((1,version_cutoff)).map_err(|e|e.to_string())?;d.next().map_err(|e|e.to_string())?;before-scalar_count(&conn,"SELECT COUNT(*) FROM tcloud_versions WHERE file_id IS NULL")};
    // Expired Trash entries become durable delete_remote jobs instead of silently
    // dropping local safety metadata. A retention value <= 0 means never expire.
    result.pruned_trash_rows=0;
    if trash_days.unwrap_or(30)>0{
        let mut expired=Vec::new();
        let mut q=conn.prepare("SELECT id,file_id,message_id,COALESCE(folder_id,0) FROM tcloud_trash WHERE deleted_at < ?1").map_err(|e|e.to_string())?;q.bind((1,trash_cutoff)).map_err(|e|e.to_string())?;
        while let sqlite::State::Row=q.next().map_err(|e|e.to_string())?{expired.push((q.read::<i64,_>(0).unwrap_or(0),q.read::<Option<i64>,_>(1).unwrap_or(None),q.read::<i64,_>(2).unwrap_or(0),q.read::<i64,_>(3).unwrap_or(0)));}drop(q);
        for (trash_id,stored_file,mid,folder) in expired{
            let file_id=if let Some(fid)=stored_file{Some(fid)}else{let mut f=conn.prepare("SELECT id FROM tcloud_files WHERE telegram_message_id=?1 AND COALESCE(telegram_chat_id,0)=?2 ORDER BY id DESC LIMIT 1").map_err(|e|e.to_string())?;f.bind((1,mid)).map_err(|e|e.to_string())?;f.bind((2,folder)).map_err(|e|e.to_string())?;if matches!(f.next().map_err(|e|e.to_string())?,sqlite::State::Row){Some(f.read::<i64,_>(0).unwrap_or(0))}else{None}};
            if let Some(fid)=file_id{crate::commands::tcloud_sync_maturity::queue_permanent_delete(&conn,fid)?;}
            let mut d=conn.prepare("DELETE FROM tcloud_trash WHERE id=?1").map_err(|e|e.to_string())?;d.bind((1,trash_id)).map_err(|e|e.to_string())?;d.next().map_err(|e|e.to_string())?;result.pruned_trash_rows+=1;
        }
    }
    if result.errors.len()>30{result.errors.truncate(30);} Ok(result)
}

fn scalar_count(conn:&sqlite::Connection,sql:&str)->i64{let Ok(mut s)=conn.prepare(sql)else{return 0};match s.next(){Ok(sqlite::State::Row)=>s.read::<i64,_>(0).unwrap_or(0),_=>0}}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck { pub name:String, pub status:String, pub detail:String }

#[tauri::command]
pub async fn tcloud_completion_deep_diagnostics(app:AppHandle, db:State<'_,DbConnection>, telegram:State<'_,TelegramState>) -> Result<Vec<DiagnosticCheck>,String>{
    let mut checks=Vec::new();
    {let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?; match conn.execute("CREATE TEMP TABLE IF NOT EXISTS tcloud_diag_test(v INTEGER); DELETE FROM tcloud_diag_test; INSERT INTO tcloud_diag_test(v) VALUES(1);"){Ok(_)=>checks.push(DiagnosticCheck{name:"SQLite".into(),status:"ok".into(),detail:"Leitura/escrita local OK".into()}),Err(e)=>checks.push(DiagnosticCheck{name:"SQLite".into(),status:"error".into(),detail:e.to_string()})};}
    let client={telegram.client.lock().await.clone()}; if let Some(client)=client {match client.get_me().await{Ok(_)=>checks.push(DiagnosticCheck{name:"Telegram".into(),status:"ok".into(),detail:"Sessão conectada".into()}),Err(e)=>checks.push(DiagnosticCheck{name:"Telegram".into(),status:"error".into(),detail:e.to_string()})}}else{checks.push(DiagnosticCheck{name:"Telegram".into(),status:"warning".into(),detail:"Cliente desconectado".into()})}
    let cache=app.path().app_cache_dir().map_err(|e|e.to_string())?;let _=std::fs::create_dir_all(&cache);let probe=cache.join(".tcloud-write-test");match std::fs::write(&probe,b"ok").and_then(|_|std::fs::remove_file(&probe)){Ok(_)=>checks.push(DiagnosticCheck{name:"Cache".into(),status:"ok".into(),detail:cache.to_string_lossy().into_owned()}),Err(e)=>checks.push(DiagnosticCheck{name:"Cache".into(),status:"error".into(),detail:e.to_string()})}
    let ffmpeg=background_command("ffmpeg").arg("-version").output().map(|o|o.status.success()).unwrap_or(false);checks.push(DiagnosticCheck{name:"FFmpeg".into(),status:if ffmpeg{"ok"}else{"warning"}.into(),detail:if ffmpeg{"Disponível"}else{"Não encontrado no PATH"}.into()});
    let cf={let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?;crate::commands::tcloud_cfapi::status_inner(&app,Some(&conn))?};checks.push(DiagnosticCheck{name:"CFAPI".into(),status:if cf.platform_supported{"ok"}else{"warning"}.into(),detail:cf.detail});
    let wh=tcloud_completion_windows_hello_status(app.clone())?;checks.push(DiagnosticCheck{name:"Windows Hello".into(),status:if wh.supported{"ok"}else{"warning"}.into(),detail:wh.detail});
    let free=sysinfo::Disks::new_with_refreshed_list().iter().map(|d|d.available_space()).max().unwrap_or(0);checks.push(DiagnosticCheck{name:"Disco".into(),status:if free>512*1024*1024{"ok"}else{"warning"}.into(),detail:format!("Maior volume com {:.1} GB livres",free as f64/1024.0/1024.0/1024.0)});
    let updater_configured=option_env!("TCLOUD_UPDATER_CONFIGURED")==Some("1");
    let updater_channel=option_env!("TCLOUD_UPDATER_CHANNEL").unwrap_or("desenvolvimento");
    let updater_host=option_env!("TCLOUD_UPDATER_ENDPOINT_HOST").unwrap_or("");
    checks.push(DiagnosticCheck{name:"Atualizador".into(),status:if updater_configured{"ok"}else{"warning"}.into(),detail:if updater_configured{format!("Canal {updater_channel}; endpoint HTTPS: {updater_host}; assinatura obrigatoria")}else{"Build sem endpoint de atualizacao (normal em desenvolvimento)".into()}});
    Ok(checks)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareAuditItem { pub id:i64,pub token:String,pub accessed_at:i64,pub ip:Option<String>,pub user_agent:Option<String>,pub range_request:bool,pub authorized:bool }

#[tauri::command]
pub fn tcloud_completion_share_audit(db:State<'_,DbConnection>,token:Option<String>,limit:Option<i64>)->Result<Vec<ShareAuditItem>,String>{let conn=db.lock().map_err(|_|"database lock poisoned".to_string())?;ensure_schema(&conn)?;let limit=limit.unwrap_or(100).clamp(1,1000);let mut out=Vec::new();if let Some(token)=token{let mut s=conn.prepare("SELECT id,token,accessed_at,ip,user_agent,range_request,authorized FROM tcloud_share_access_log WHERE token=?1 ORDER BY accessed_at DESC LIMIT ?2").map_err(|e|e.to_string())?;s.bind((1,token.as_str())).map_err(|e|e.to_string())?;s.bind((2,limit)).map_err(|e|e.to_string())?;while let sqlite::State::Row=s.next().map_err(|e|e.to_string())?{out.push(audit_row(&s)?);}}else{let mut s=conn.prepare("SELECT id,token,accessed_at,ip,user_agent,range_request,authorized FROM tcloud_share_access_log ORDER BY accessed_at DESC LIMIT ?1").map_err(|e|e.to_string())?;s.bind((1,limit)).map_err(|e|e.to_string())?;while let sqlite::State::Row=s.next().map_err(|e|e.to_string())?{out.push(audit_row(&s)?);}}Ok(out)}
fn audit_row(s:&sqlite::Statement<'_>)->Result<ShareAuditItem,String>{Ok(ShareAuditItem{id:s.read(0).map_err(|e|e.to_string())?,token:s.read(1).map_err(|e|e.to_string())?,accessed_at:s.read(2).unwrap_or(0),ip:s.read::<Option<String>,_>(3).unwrap_or(None),user_agent:s.read::<Option<String>,_>(4).unwrap_or(None),range_request:s.read::<i64,_>(5).unwrap_or(0)!=0,authorized:s.read::<i64,_>(6).unwrap_or(0)!=0})}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoritesRemoteState { pub found: bool, pub ids: Vec<String> }

#[tauri::command]
pub async fn tcloud_completion_favorites_pull(telegram:State<'_,TelegramState>)->Result<FavoritesRemoteState,String>{
    let client={telegram.client.lock().await.clone()}.ok_or_else(||"Telegram desconectado".to_string())?;
    let me=client.get_me().await.map_err(|e|e.to_string())?;
    let peer=Peer::User(me);
    let mut iter=client.iter_messages(&peer);
    let mut seen=0usize;
    while let Some(msg)=iter.next().await.map_err(|e|e.to_string())?{
        seen+=1;
        let text=msg.text();
        if text.starts_with(FAVORITES_MARKER){
            let json=text.strip_prefix(FAVORITES_MARKER).unwrap_or("").trim();
            let ids=serde_json::from_str::<Vec<String>>(json).map_err(|e|e.to_string())?;
            return Ok(FavoritesRemoteState{found:true,ids});
        }
        // Compatibility with the old message-id-only format. Saved Messages
        // did not carry folder context, so map legacy values to the root key.
        if text.starts_with(FAVORITES_MARKER_V2){
            let json=text.strip_prefix(FAVORITES_MARKER_V2).unwrap_or("").trim();
            let old=serde_json::from_str::<Vec<i64>>(json).map_err(|e|e.to_string())?;
            let ids=old.into_iter().map(|id|format!("0:{id}")).collect();
            return Ok(FavoritesRemoteState{found:true,ids});
        }
        if seen>=250{break;}
    }
    Ok(FavoritesRemoteState{found:false,ids:Vec::new()})
}

#[tauri::command]
pub async fn tcloud_completion_favorites_push(telegram:State<'_,TelegramState>,ids:Vec<String>)->Result<bool,String>{
    let client={telegram.client.lock().await.clone()}.ok_or_else(||"Telegram desconectado".to_string())?;
    let me=client.get_me().await.map_err(|e|e.to_string())?;
    let peer=Peer::User(me);
    let mut unique=ids.into_iter().filter(|v|!v.trim().is_empty()).collect::<Vec<_>>();
    unique.sort(); unique.dedup();
    let payload=format!("{}\n{}",FAVORITES_MARKER,serde_json::to_string(&unique).map_err(|e|e.to_string())?);
    // Keep one metadata message instead of accumulating one message per toggle.
    let mut iter=client.iter_messages(&peer);
    let mut existing=None;
    let mut seen=0usize;
    while let Some(msg)=iter.next().await.map_err(|e|e.to_string())?{
        seen+=1;
        if msg.text().starts_with(FAVORITES_MARKER){existing=Some(msg.id());break;}
        if seen>=250{break;}
    }
    if let Some(id)=existing{
        client.edit_message(&peer, id, InputMessage::new().text(payload.clone())).await.map_err(|e| e.to_string())?;
    }else{
        client.send_message(&peer, InputMessage::new().text(payload)).await.map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackStatus { pub prepared:bool,pub target_version:Option<String>,pub backup_path:Option<String>,pub healthy:bool }
fn rollback_dir(app:&AppHandle)->Result<PathBuf,String>{let d=app.path().app_data_dir().map_err(|e|e.to_string())?.join("update-rollback");std::fs::create_dir_all(&d).map_err(|e|e.to_string())?;Ok(d)}
#[tauri::command]
pub fn tcloud_completion_prepare_rollback(app:AppHandle,target_version:String)->Result<RollbackStatus,String>{let dir=rollback_dir(&app)?;let exe=std::env::current_exe().map_err(|e|e.to_string())?;let backup=dir.join("tcloud-previous.exe");std::fs::copy(&exe,&backup).map_err(|e|format!("Falha ao criar backup para rollback: {e}"))?;let state=serde_json::json!({"target_version":target_version,"backup_path":backup,"exe_path":exe,"prepared_at":chrono::Utc::now().timestamp()});std::fs::write(dir.join("rollback.json"),serde_json::to_vec_pretty(&state).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;let _=std::fs::remove_file(dir.join("healthy"));let _=std::fs::remove_file(dir.join("probation-started"));Ok(RollbackStatus{prepared:true,target_version:state["target_version"].as_str().map(str::to_string),backup_path:Some(backup.to_string_lossy().into_owned()),healthy:false})}
#[tauri::command]
pub fn tcloud_completion_mark_update_healthy(app:AppHandle)->Result<RollbackStatus,String>{
    let dir=rollback_dir(&app)?;
    if dir.join("rollback.json").exists(){
        std::fs::write(dir.join("healthy"),chrono::Utc::now().timestamp().to_string()).map_err(|e|e.to_string())?;
        let _=std::fs::remove_file(dir.join("probation-started"));
    }
    tcloud_completion_rollback_status(app)
}
#[tauri::command]
pub fn tcloud_completion_cancel_rollback(app:AppHandle)->Result<bool,String>{let dir=rollback_dir(&app)?;let _=std::fs::remove_file(dir.join("rollback.json"));let _=std::fs::remove_file(dir.join("healthy"));let _=std::fs::remove_file(dir.join("probation-started"));Ok(true)}
#[tauri::command]
pub fn tcloud_completion_rollback_status(app:AppHandle)->Result<RollbackStatus,String>{let dir=rollback_dir(&app)?;let path=dir.join("rollback.json");if !path.exists(){return Ok(RollbackStatus{prepared:false,target_version:None,backup_path:None,healthy:dir.join("healthy").exists()});}let value:serde_json::Value=serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;Ok(RollbackStatus{prepared:true,target_version:value.get("target_version").and_then(|v|v.as_str()).map(str::to_string),backup_path:value.get("backup_path").and_then(|v|v.as_str()).map(str::to_string),healthy:dir.join("healthy").exists()})}
#[tauri::command]
pub fn tcloud_completion_force_rollback(app:AppHandle)->Result<bool,String>{
    let dir=rollback_dir(&app)?;
    let value:serde_json::Value=serde_json::from_slice(&std::fs::read(dir.join("rollback.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let backup=PathBuf::from(value.get("backup_path").and_then(|v|v.as_str()).ok_or_else(||"Backup de rollback ausente".to_string())?);
    let exe=PathBuf::from(value.get("exe_path").and_then(|v|v.as_str()).ok_or_else(||"Executável alvo ausente".to_string())?);
    if !backup.exists(){return Err("Backup de rollback não existe".into());}
    #[cfg(target_os="windows")]
    {
        let script=dir.join("rollback-now.ps1");
        let pid=std::process::id();
        let escape=|p:&Path| p.to_string_lossy().replace('\'', "''");
        let body=format!(
            "$ErrorActionPreference='Stop'; while(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{Start-Sleep -Milliseconds 300}}; Copy-Item -LiteralPath '{}' -Destination '{}' -Force; Start-Process -FilePath '{}'; Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
            escape(&backup),escape(&exe),escape(&exe)
        );
        std::fs::write(&script,body).map_err(|e|e.to_string())?;
        background_command("powershell").args(["-NoProfile","-WindowStyle","Hidden","-ExecutionPolicy","Bypass","-File",script.to_string_lossy().as_ref()]).spawn().map_err(|e|e.to_string())?;
        // The helper waits for the current process to terminate before replacing the binary.
        // The UI can now close/relaunch the app without racing the executable lock.
    }
    #[cfg(not(target_os="windows"))]
    {std::fs::copy(&backup,&exe).map_err(|e|e.to_string())?;}
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStartupGuard { pub action:String, pub detail:String, pub target_version:Option<String> }

#[tauri::command]
pub fn tcloud_completion_update_startup_guard(app:AppHandle)->Result<UpdateStartupGuard,String>{
    let status=tcloud_completion_rollback_status(app.clone())?;
    if !status.prepared || status.healthy {
        return Ok(UpdateStartupGuard{action:"normal".into(),detail:"Nenhum rollback pendente".into(),target_version:status.target_version});
    }

    // Loose/development builds are rebuilt and restarted frequently. Treating a second
    // staging launch as a failed updater installation used to close tcloud.exe seconds
    // after `npm run tauri:shell` completed.
    let staging_env=std::env::var("TCLOUD_STAGING").map(|v|v=="1"||v.eq_ignore_ascii_case("true")).unwrap_or(false);
    let staging_path=std::env::current_exe().ok().map(|p|p.to_string_lossy().to_ascii_lowercase().contains("dist-shell")).unwrap_or(false);
    if staging_env || staging_path {
        return Ok(UpdateStartupGuard{action:"normal".into(),detail:"Rollback automático desativado no staging de desenvolvimento".into(),target_version:status.target_version});
    }

    // Ignore rollback metadata prepared for another target version. This can happen
    // after a manual reinstall/downgrade and must never terminate a healthy build.
    let current_version=app.package_info().version.to_string();
    if let Some(target)=status.target_version.as_deref() {
        if target != current_version {
            return Ok(UpdateStartupGuard{action:"normal".into(),detail:format!("Rollback pendente pertence à versão {target}, não à versão atual {current_version}"),target_version:status.target_version});
        }
    }

    let dir=rollback_dir(&app)?;
    let probation=dir.join("probation-started");
    let now=chrono::Utc::now().timestamp();
    if !probation.exists(){
        std::fs::write(&probation,now.to_string()).map_err(|e|e.to_string())?;
        return Ok(UpdateStartupGuard{action:"probation".into(),detail:"Primeira inicialização da atualização; aguardando confirmação de estabilidade".into(),target_version:status.target_version});
    }

    // A quick second launch is common after login, restart or user testing. Give the
    // new build a real health window before considering rollback.
    let started=std::fs::read_to_string(&probation).ok().and_then(|v|v.trim().parse::<i64>().ok()).unwrap_or(now);
    let elapsed=now.saturating_sub(started);
    const MIN_PROBATION_SECONDS:i64=120;
    if elapsed < MIN_PROBATION_SECONDS {
        return Ok(UpdateStartupGuard{action:"probation".into(),detail:format!("Atualização em observação por mais {} segundo(s)",MIN_PROBATION_SECONDS-elapsed),target_version:status.target_version});
    }

    tcloud_completion_force_rollback(app)?;
    Ok(UpdateStartupGuard{action:"rollback_scheduled".into(),detail:"A atualização não confirmou estabilidade após a janela de observação; restauração automática agendada".into(),target_version:status.target_version})
}

#[tauri::command]
pub async fn tcloud_completion_zip_files(app:AppHandle,paths:Vec<String>,archive_name:Option<String>)->Result<String,String>{
    if paths.is_empty(){return Err("Nenhum arquivo para compactar".into());}
    let out_dir=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("upload-bundles");std::fs::create_dir_all(&out_dir).map_err(|e|e.to_string())?;
    let safe_name=archive_name.unwrap_or_else(||format!("TCloud-lote-{}.zip",chrono::Utc::now().format("%Y%m%d-%H%M%S"))).replace('/', "_").replace('\\', "_");
    let out=out_dir.join(if safe_name.to_ascii_lowercase().ends_with(".zip"){safe_name}else{format!("{safe_name}.zip")});
    let out_clone=out.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let file=std::fs::File::create(&out_clone).map_err(|e|e.to_string())?;let mut zip=zip::ZipWriter::new(file);let options=zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for raw in paths{let path=PathBuf::from(raw);if !path.is_file(){continue;}let name=path.file_name().and_then(|v|v.to_str()).unwrap_or("arquivo");zip.start_file(name,options).map_err(|e|e.to_string())?;let mut input=std::fs::File::open(&path).map_err(|e|e.to_string())?;std::io::copy(&mut input,&mut zip).map_err(|e|e.to_string())?;}
        zip.finish().map_err(|e|e.to_string())?;Ok::<(),String>(())
    }).await.map_err(|e|e.to_string())??;
    Ok(out.to_string_lossy().into_owned())
}
