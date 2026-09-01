use crate::types::{AccountSecret, Config};
use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "rangemail";

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("dossier de données introuvable");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

fn config_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("config.json")
}

fn fallback_secrets_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("secrets.json")
}

pub fn load_config(app: &AppHandle) -> Config {
    let path = config_path(app);
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<Config>(&raw) {
            return cfg;
        }
    }
    Config::default()
}

pub fn save_config(app: &AppHandle, cfg: &Config) {
    let path = config_path(app);
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, json);
    }
}

// --- Secrets : Trousseau système d'abord, fichier local (base64) en secours. ---

fn keyring_set(name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

fn keyring_get(name: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, name).ok()?;
    entry.get_password().ok()
}

fn keyring_delete(name: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, name) {
        let _ = entry.delete_credential();
    }
}

fn fallback_load(app: &AppHandle) -> HashMap<String, String> {
    if let Ok(raw) = fs::read_to_string(fallback_secrets_path(app)) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
            return map;
        }
    }
    HashMap::new()
}

fn fallback_save(app: &AppHandle, map: &HashMap<String, String>) {
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(fallback_secrets_path(app), json);
    }
}

fn set_raw_secret(app: &AppHandle, name: &str, value: &str) {
    if keyring_set(name, value).is_err() {
        let mut map = fallback_load(app);
        map.insert(
            name.to_string(),
            base64::engine::general_purpose::STANDARD.encode(value),
        );
        fallback_save(app, &map);
    }
}

fn get_raw_secret(app: &AppHandle, name: &str) -> Option<String> {
    if let Some(v) = keyring_get(name) {
        return Some(v);
    }
    let map = fallback_load(app);
    let encoded = map.get(name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    String::from_utf8(bytes).ok()
}

fn delete_raw_secret(app: &AppHandle, name: &str) {
    keyring_delete(name);
    let mut map = fallback_load(app);
    if map.remove(name).is_some() {
        fallback_save(app, &map);
    }
}

pub fn set_secret(app: &AppHandle, account_id: &str, secret: &AccountSecret) {
    if let Ok(json) = serde_json::to_string(secret) {
        set_raw_secret(app, &format!("account-{account_id}"), &json);
    }
}

pub fn get_secret(app: &AppHandle, account_id: &str) -> Option<AccountSecret> {
    let raw = get_raw_secret(app, &format!("account-{account_id}"))?;
    serde_json::from_str(&raw).ok()
}

pub fn delete_secret(app: &AppHandle, account_id: &str) {
    delete_raw_secret(app, &format!("account-{account_id}"));
}

pub fn set_anthropic_key(app: &AppHandle, key: &str) {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        delete_raw_secret(app, "anthropic-key");
    } else {
        set_raw_secret(app, "anthropic-key", trimmed);
    }
}

pub fn get_anthropic_key(app: &AppHandle) -> Option<String> {
    get_raw_secret(app, "anthropic-key")
}
