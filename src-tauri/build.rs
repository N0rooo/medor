use std::fs;

/// Charge les identifiants OAuth depuis `src-tauri/oauth.local.json` (fichier
/// non versionné, voir `oauth.local.json.example`) et les expose au code via
/// les variables lues par `option_env!` dans `src/oauth_defaults.rs`.
fn load_local_oauth() {
    println!("cargo:rerun-if-changed=oauth.local.json");
    let Ok(raw) = fs::read_to_string("oauth.local.json") else {
        return;
    };
    let Ok(json) = raw.parse::<serde_json::Value>() else {
        println!("cargo:warning=oauth.local.json illisible : JSON invalide, fichier ignoré");
        return;
    };
    let pairs = [
        ("googleClientId", "RANGEMAIL_GOOGLE_CLIENT_ID"),
        ("googleClientSecret", "RANGEMAIL_GOOGLE_CLIENT_SECRET"),
        ("msClientId", "RANGEMAIL_MS_CLIENT_ID"),
    ];
    for (key, env_name) in pairs {
        if let Some(value) = json.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                println!("cargo:rustc-env={env_name}={trimmed}");
            }
        }
    }
}

fn main() {
    load_local_oauth();
    tauri_build::build()
}
