use std::{fs, path::PathBuf};

fn rust_string_literal(value: &str) -> String {
    format!("{:?}", value)
}

fn generate_tcloud_credentials() {
    println!("cargo:rerun-if-changed=.env.tcloud");
    println!("cargo:rerun-if-env-changed=TCLOUD_TELEGRAM_API_ID");
    println!("cargo:rerun-if-env-changed=TCLOUD_TELEGRAM_API_HASH");

    let mut api_id = std::env::var("TCLOUD_TELEGRAM_API_ID").ok();
    let mut api_hash = std::env::var("TCLOUD_TELEGRAM_API_HASH").ok();

    if let Ok(contents) = fs::read_to_string(".env.tcloud") {
        for raw_line in contents.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if value.is_empty() {
                continue;
            }
            match key.trim() {
                "TCLOUD_TELEGRAM_API_ID" if api_id.is_none() => api_id = Some(value),
                "TCLOUD_TELEGRAM_API_HASH" if api_hash.is_none() => api_hash = Some(value),
                _ => {}
            }
        }
    }

    // Do not use cargo:rustc-env for secrets: Cargo can echo build-script stdout,
    // which would expose the API hash in build logs. Generate a private Rust
    // source file in OUT_DIR instead; only the compiler sees the literal.
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR missing"));
    let body = format!(
        "pub const BUILD_API_ID: Option<&str> = {};\npub const BUILD_API_HASH: Option<&str> = {};\n",
        api_id.as_deref().map(rust_string_literal).map(|v| format!("Some({v})")).unwrap_or_else(|| "None".into()),
        api_hash.as_deref().map(rust_string_literal).map(|v| format!("Some({v})")).unwrap_or_else(|| "None".into()),
    );
    fs::write(out_dir.join("tcloud_credentials.rs"), body)
        .expect("failed to generate TCloud credentials source");
}

fn configure_windows_native_helpers() {
    println!("cargo:rustc-check-cfg=cfg(tcloud_native_bridge)");
    println!("cargo:rerun-if-env-changed=TCLOUD_ENABLE_NATIVE_WIN_BRIDGE");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    // The C++/WinRT bridge is intentionally opt-in. Different Windows SDK /
    // Visual Studio Build Tools installations expose different CFAPI/WinRT
    // headers, and making this translation unit mandatory can prevent the
    // entire TCloud application from compiling. The stable desktop path uses
    // WebDAV + Rust fallbacks and remains fully buildable without cl.exe.
    //
    // To experiment with the native bridge later, set
    // TCLOUD_ENABLE_NATIVE_WIN_BRIDGE=1 and restore/enable the cc build step.
    let requested = std::env::var("TCLOUD_ENABLE_NATIVE_WIN_BRIDGE")
        .map(|v| matches!(v.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);

    if requested {
        println!("cargo:warning=TCloud native Windows bridge is currently disabled in 10.1.2 compatibility mode; using safe Rust/WebDAV fallbacks.");
    }
}

fn main() {
    generate_tcloud_credentials();
    configure_windows_native_helpers();

    tauri_build::build()
}
