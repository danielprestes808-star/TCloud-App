// TCloud is a GUI app on Windows in both debug and release. Child CLI helpers are also hidden.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

/// Must match the `identifier` in tauri.conf.json
#[cfg(target_os = "linux")]
const BUNDLE_ID: &str = "com.cameronamer.telegramdrive";

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut args = std::env::args_os().skip(1);
        if let Some(mode) = args.next() {
            let mode = mode.to_string_lossy();
            if mode == "--cfapi-pin" || mode == "--cfapi-unpin" {
                let pinned = mode == "--cfapi-pin";
                let Some(path) = args.next() else { std::process::exit(2); };
                let result = app_lib::commands::tcloud_cfapi::shell_pin_path(std::path::Path::new(&path), pinned);
                std::process::exit(if result.is_ok() { 0 } else { 3 });
            }
        }
    }
    // Fix EGL_BAD_ALLOC on Linux distros (especially Arch) where the AppImage's
    // bundled Mesa conflicts with the host's GPU driver stack.
    // This must be set BEFORE tauri::Builder initializes the WebKitGTK WebView.
    // The cfg gate ensures this is completely inert on Windows and macOS builds.
    #[cfg(target_os = "linux")]
    {
        // Read the user's preference from settings.json BEFORE WebKitGTK init.
        // The env var must be set before Tauri touches the WebView, so we cannot
        // defer this to lib.rs. We use std::fs directly since Tauri's path APIs
        // are not yet available at this point.
        let disable_dmabuf = match std::env::var("HOME") {
            Ok(home) => {
                // Resolve the same app-data path that Tauri would use
                let settings_path = std::path::PathBuf::from(home)
                    .join(".local/share")
                    .join(BUNDLE_ID)
                    .join("settings.json");
                if settings_path.exists() {
                    match std::fs::read_to_string(&settings_path) {
                        Ok(content) => {
                            #[derive(serde::Deserialize)]
                            struct SettingsFile {
                                settings: Option<SettingsPayload>,
                            }
                            #[derive(serde::Deserialize)]
                            struct SettingsPayload {
                                #[serde(rename = "linuxRenderingFix")]
                                linux_rendering_fix: Option<bool>,
                            }
                            match serde_json::from_str::<SettingsFile>(&content) {
                                Ok(file) => {
                                    file.settings
                                        .and_then(|s| s.linux_rendering_fix)
                                        .unwrap_or(true) // Default to enabled (safe)
                                }
                                Err(_) => true, // Can't parse — default safe
                            }
                        }
                        Err(_) => true, // Can't read — default safe
                    }
                } else {
                    true // No settings yet — default safe
                }
            }
            Err(_) => true, // Can't determine HOME — default safe
        };

        if disable_dmabuf {
            // User wants the fix (or default) — disable DMA-BUF renderer
            if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        } else {
            // User explicitly disabled the fix — remove the env var if already set
            // (e.g. from a previous run or system-wide config)
            if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_ok() {
                std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
            }
        }
    }

    app_lib::run()
}
