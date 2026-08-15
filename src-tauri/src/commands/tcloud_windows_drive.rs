use serde::{Deserialize, Serialize};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudDriveStatus {
    pub mounted: bool,
    pub drive_letter: String,
    pub target: String,
}

fn normalize_drive_letter(letter: &str) -> Result<String, String> {
    let trimmed = letter.trim().trim_end_matches(':').to_ascii_uppercase();
    if trimmed.len() != 1 || !trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("invalid Windows drive letter".into());
    }
    Ok(format!("{}:", trimmed))
}

#[cfg(target_os = "windows")]
fn net_use_status(letter: &str) -> bool {
    hidden_command("cmd")
        .args(["/C", "net", "use", letter])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn net_use_status(_letter: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn set_windows_drive_label(letter: &str, label: &str) {
    let drive = letter.trim_end_matches(':').to_ascii_uppercase();

    let drive_icons_key = format!(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}\DefaultLabel",
        drive
    );
    let _ = hidden_command("reg")
        .args([
            "add",
            &drive_icons_key,
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
            label,
            "/f",
        ])
        .output();

    let network_key = format!(r"HKCU\Network\{}", drive);
    let _ = hidden_command("reg")
        .args([
            "add",
            &network_key,
            "/v",
            "_LabelFromReg",
            "/t",
            "REG_SZ",
            "/d",
            label,
            "/f",
        ])
        .output();

    let _ = hidden_command("reg")
        .args([
            "add",
            &network_key,
            "/v",
            "ProviderName",
            "/t",
            "REG_SZ",
            "/d",
            "TCloud",
            "/f",
        ])
        .output();

    let _ = hidden_command("ie4uinit.exe").arg("-show").output();
    let _ = hidden_command("RUNDLL32.EXE")
        .args(["user32.dll,UpdatePerUserSystemParameters"])
        .output();
}

#[cfg(not(target_os = "windows"))]
fn set_windows_drive_label(_letter: &str, _label: &str) {}

#[tauri::command]
pub fn tcloud_mount_drive(
    drive_letter: String,
    webdav_url: String,
) -> Result<TCloudDriveStatus, String> {
    let letter = normalize_drive_letter(&drive_letter)?;

    #[cfg(target_os = "windows")]
    {
        if net_use_status(&letter) {
            set_windows_drive_label(&letter, "TCloud");
            return Ok(TCloudDriveStatus {
                mounted: true,
                drive_letter: letter,
                target: webdav_url,
            });
        }

        let output = hidden_command("cmd")
            .args([
                "/C",
                "net",
                "use",
                &letter,
                &webdav_url,
                "/persistent:yes",
            ])
            .output()
            .map_err(|e| format!("failed to start Windows net use: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let message = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("failed to mount TCloud drive: {message}"));
        }

        set_windows_drive_label(&letter, "TCloud");
        Ok(TCloudDriveStatus {
            mounted: true,
            drive_letter: letter,
            target: webdav_url,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = webdav_url;
        Err("TCloud drive mounting is currently available only on Windows".into())
    }
}

#[tauri::command]
pub fn tcloud_unmount_drive(
    drive_letter: String,
) -> Result<TCloudDriveStatus, String> {
    let letter = normalize_drive_letter(&drive_letter)?;

    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("cmd")
            .args(["/C", "net", "use", &letter, "/delete", "/y"])
            .output()
            .map_err(|e| format!("failed to start Windows net use: {e}"))?;

        if !output.status.success() && net_use_status(&letter) {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let message = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("failed to unmount TCloud drive: {message}"));
        }

        Ok(TCloudDriveStatus {
            mounted: false,
            drive_letter: letter,
            target: String::new(),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("TCloud drive mounting is currently available only on Windows".into())
    }
}

#[tauri::command]
pub fn tcloud_drive_status(
    drive_letter: String,
    webdav_url: String,
) -> Result<TCloudDriveStatus, String> {
    let letter = normalize_drive_letter(&drive_letter)?;

    Ok(TCloudDriveStatus {
        mounted: net_use_status(&letter),
        drive_letter: letter,
        target: webdav_url,
    })
}


#[cfg(target_os = "windows")]
fn startup_entry_exists() -> bool {
    hidden_command("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "TCloud"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn startup_entry_exists() -> bool { false }

#[tauri::command]
pub fn tcloud_startup_enabled() -> Result<bool, String> {
    Ok(startup_entry_exists())
}

#[tauri::command]
pub fn tcloud_set_startup_enabled(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let exe = std::env::current_exe()
                .map_err(|e| format!("failed to locate TCloud executable: {e}"))?;
            let exe_value = format!("\"{}\" --background", exe.display());
            let output = hidden_command("reg")
                .args([
                    "add", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v", "TCloud", "/t", "REG_SZ", "/d", &exe_value, "/f",
                ])
                .output()
                .map_err(|e| format!("failed to configure Windows startup: {e}"))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(format!("failed to enable TCloud startup: {stderr}"));
            }
        } else {
            let _ = hidden_command("reg")
                .args([
                    "delete", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v", "TCloud", "/f",
                ])
                .output();
        }
        Ok(startup_entry_exists())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("automatic startup is currently available only on Windows".into())
    }
}

#[tauri::command]
pub fn tcloud_ensure_drive(
    drive_letter: String,
    webdav_url: String,
) -> Result<TCloudDriveStatus, String> {
    let letter = normalize_drive_letter(&drive_letter)?;
    if net_use_status(&letter) {
        return Ok(TCloudDriveStatus {
            mounted: true,
            drive_letter: letter,
            target: webdav_url,
        });
    }
    tcloud_mount_drive(drive_letter, webdav_url)
}


#[derive(Clone)]
pub struct TCloudBackgroundDriveState {
    pub enabled: Arc<AtomicBool>,
    pub last_mounted: Arc<AtomicBool>,
}

impl Default for TCloudBackgroundDriveState {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
            last_mounted: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudBackgroundDriveStatus {
    pub enabled: bool,
    pub mounted: bool,
    pub drive_letter: String,
}

fn background_setting_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("background_drive_enabled.txt"))
}

pub fn load_background_drive_enabled(app: &tauri::AppHandle) -> bool {
    background_setting_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|value| !matches!(value.trim(), "0" | "false" | "off" | "no"))
        .unwrap_or(true)
}

fn save_background_drive_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = background_setting_path(app)?;
    std::fs::write(path, if enabled { "1" } else { "0" }).map_err(|error| error.to_string())
}

pub fn start_background_drive_watchdog(app: tauri::AppHandle) {
    let state = app.state::<TCloudBackgroundDriveState>().inner().clone();
    let initially_enabled = load_background_drive_enabled(&app);
    state.enabled.store(initially_enabled, Ordering::Relaxed);

    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        // Give startup services a short head start before the first mount attempt.
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;

        loop {
            if !state.enabled.load(Ordering::Relaxed) {
                state.last_mounted.store(false, Ordering::Relaxed);
                interval.tick().await;
                continue;
            }

            match crate::commands::webdav_settings::ensure_background_drive_endpoint(&app) {
                Ok(url) => {
                    // WebDAV may have just restarted. A small delay avoids mapping
                    // before the local listener is ready.
                    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                    match tcloud_ensure_drive("T".to_string(), url) {
                        Ok(status) => {
                            state.last_mounted.store(status.mounted, Ordering::Relaxed);
                        }
                        Err(error) => {
                            state.last_mounted.store(false, Ordering::Relaxed);
                            log::warn!("TCloud background drive mount retry: {}", error);
                        }
                    }
                }
                Err(error) => {
                    state.last_mounted.store(false, Ordering::Relaxed);
                    log::warn!("TCloud background WebDAV endpoint unavailable: {}", error);
                }
            }

            interval.tick().await;
        }
    });

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        state.last_mounted.store(false, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn tcloud_background_drive_status(
    state: tauri::State<'_, TCloudBackgroundDriveState>,
) -> TCloudBackgroundDriveStatus {
    TCloudBackgroundDriveStatus {
        enabled: state.enabled.load(Ordering::Relaxed),
        mounted: net_use_status("T:"),
        drive_letter: "T:".to_string(),
    }
}

#[tauri::command]
pub fn tcloud_set_background_drive_enabled(
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, TCloudBackgroundDriveState>,
) -> Result<TCloudBackgroundDriveStatus, String> {
    save_background_drive_enabled(&app, enabled)?;
    state.enabled.store(enabled, Ordering::Relaxed);

    #[cfg(target_os = "windows")]
    if enabled {
        // Make sure installed TCloud starts at Windows login in background mode.
        tcloud_set_startup_enabled(true)?;
    }

    Ok(TCloudBackgroundDriveStatus {
        enabled,
        mounted: net_use_status("T:"),
        drive_letter: "T:".to_string(),
    })
}


#[tauri::command]
pub fn tcloud_mount_background_drive(
    drive_letter: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, TCloudBackgroundDriveState>,
) -> Result<TCloudDriveStatus, String> {
    save_background_drive_enabled(&app, true)?;
    state.enabled.store(true, Ordering::Relaxed);

    #[cfg(target_os = "windows")]
    {
        let _ = tcloud_set_startup_enabled(true);
    }

    let url = crate::commands::webdav_settings::ensure_background_drive_endpoint(&app)?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    let result = tcloud_ensure_drive(drive_letter, url)?;
    state.last_mounted.store(result.mounted, Ordering::Relaxed);
    Ok(result)
}

#[tauri::command]
pub fn tcloud_unmount_background_drive(
    drive_letter: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, TCloudBackgroundDriveState>,
) -> Result<TCloudDriveStatus, String> {
    // Disable the watchdog first, or it would remount the drive automatically.
    save_background_drive_enabled(&app, false)?;
    state.enabled.store(false, Ordering::Relaxed);
    let result = tcloud_unmount_drive(drive_letter)?;
    state.last_mounted.store(false, Ordering::Relaxed);
    Ok(result)
}


#[tauri::command]
pub fn tcloud_refresh_drive_label(
    drive_letter: String,
) -> Result<TCloudDriveStatus, String> {
    let letter = normalize_drive_letter(&drive_letter)?;
    set_windows_drive_label(&letter, "TCloud");

    Ok(TCloudDriveStatus {
        mounted: net_use_status(&letter),
        drive_letter: letter,
        target: String::new(),
    })
}


#[tauri::command]
pub fn tcloud_open_drive_in_explorer(drive_letter: String) -> Result<bool, String> {
    let letter = normalize_drive_letter(&drive_letter)?;

    #[cfg(target_os = "windows")]
    {
        let target = format!("{}\\", letter);
        Command::new("explorer.exe")
            .arg(target)
            .spawn()
            .map_err(|error| format!("failed to open TCloud drive in Explorer: {error}"))?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = letter;
        Err("opening TCloud drive in Explorer is available only on Windows".into())
    }
}

#[tauri::command]
pub fn tcloud_install_explorer_integration() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_cmd = format!("\"{}\"", exe.display());

        let open_key = r"HKCU\Software\Classes\Drive\shell\TCloudOpen";
        let _ = hidden_command("reg").args(["add", open_key, "/ve", "/d", "Abrir TCloud", "/f"]).output();
        let _ = hidden_command("reg").args(["add", open_key, "/v", "Icon", "/d", exe.to_string_lossy().as_ref(), "/f"]).output();
        let _ = hidden_command("reg").args(["add", open_key, "/v", "AppliesTo", "/d", "System.ItemPathDisplay:~=\"T:\\\"", "/f"]).output();
        let command_key = format!(r"{}\command", open_key);
        let output = hidden_command("reg").args(["add", &command_key, "/ve", "/d", &exe_cmd, "/f"]).output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }

        let drive_key = r"HKCU\Software\Classes\Drive\shell\TCloudDrive";
        let _ = hidden_command("reg").args(["add", drive_key, "/ve", "/d", "Abrir unidade TCloud", "/f"]).output();
        let _ = hidden_command("reg").args(["add", drive_key, "/v", "AppliesTo", "/d", "System.ItemPathDisplay:~=\"T:\\\"", "/f"]).output();
        let drive_command_key = format!(r"{}\command", drive_key);
        let _ = hidden_command("reg").args(["add", &drive_command_key, "/ve", "/d", r#"explorer.exe T:\"#, "/f"]).output();
        return Ok(true);
    }
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

#[tauri::command]
pub fn tcloud_uninstall_explorer_integration() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        for key in [r"HKCU\Software\Classes\Drive\shell\TCloudOpen", r"HKCU\Software\Classes\Drive\shell\TCloudDrive"] {
            let _ = hidden_command("reg").args(["delete", key, "/f"]).output();
        }
        return Ok(true);
    }
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}
