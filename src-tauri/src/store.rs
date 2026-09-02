use crate::types::{AccountSecret, Config};
use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "medor";
/// Ancien nom de service : les secrets existants y sont migrés à la volée.
const KEYRING_SERVICE_LEGACY: &str = "rangemail";

/// Cache mémoire des secrets : une seule lecture du Trousseau par lancement,
/// pour éviter les demandes de mot de passe macOS à répétition.
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

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
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, name) {
        if let Ok(value) = entry.get_password() {
            return Some(value);
        }
    }
    // Migration depuis l'ancien service « rangemail ».
    if let Ok(old) = keyring::Entry::new(KEYRING_SERVICE_LEGACY, name) {
        if let Ok(value) = old.get_password() {
            let _ = keyring_set(name, &value);
            let _ = old.delete_credential();
            return Some(value);
        }
    }
    None
}

fn keyring_delete(name: &str) {
    for service in [KEYRING_SERVICE, KEYRING_SERVICE_LEGACY] {
        if let Ok(entry) = keyring::Entry::new(service, name) {
            let _ = entry.delete_credential();
        }
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
    cache()
        .lock()
        .unwrap()
        .insert(name.to_string(), Some(value.to_string()));
}

fn get_raw_secret(app: &AppHandle, name: &str) -> Option<String> {
    if let Some(en_cache) = cache().lock().unwrap().get(name) {
        return en_cache.clone();
    }
    let valeur = keyring_get(name).or_else(|| {
        let map = fallback_load(app);
        let encoded = map.get(name)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .ok()?;
        String::from_utf8(bytes).ok()
    });
    cache()
        .lock()
        .unwrap()
        .insert(name.to_string(), valeur.clone());
    valeur
}

fn delete_raw_secret(app: &AppHandle, name: &str) {
    keyring_delete(name);
    let mut map = fallback_load(app);
    if map.remove(name).is_some() {
        fallback_save(app, &map);
    }
    cache().lock().unwrap().insert(name.to_string(), None);
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
