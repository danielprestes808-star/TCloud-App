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

#[cfg(target_os = "windows")]
fn startup_entry_output() -> Option<String> {
    let output = hidden_command("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "TCloud"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn startup_entry_exists() -> bool {
    startup_entry_output().is_some()
}

#[cfg(target_os = "windows")]
fn startup_entry_is_current() -> bool {
    let Some(output) = startup_entry_output() else { return false; };
    let Ok(exe) = std::env::current_exe() else { return startup_entry_exists(); };
    let exe = exe.to_string_lossy().replace('/', "\\").to_lowercase();
    output.replace('/', "\\").to_lowercase().contains(&exe)
}

#[cfg(not(target_os = "windows"))]
fn startup_entry_exists() -> bool { false }

#[cfg(not(target_os = "windows"))]
fn startup_entry_is_current() -> bool { false }

pub(crate) fn repair_startup_if_configured() {
    #[cfg(target_os = "windows")]
    {
        // Respect the user's switch: only repair an entry that already exists.
        // This keeps updates/path changes healthy without silently re-enabling startup
        // after the user explicitly disabled it.
        if startup_entry_exists() && !startup_entry_is_current() {
            let _ = tcloud_set_startup_enabled(true);
        }
    }
}

#[tauri::command]
pub fn tcloud_startup_enabled() -> Result<bool, String> {
    // Treat a stale Run entry as disabled so the UI can repair it with one click.
    Ok(startup_entry_exists() && startup_entry_is_current())
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
        Ok(if enabled { startup_entry_is_current() } else { !startup_entry_exists() })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("automatic startup is currently available only on Windows".into())
    }
}
