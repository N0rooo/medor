use crate::oauth_defaults;
use crate::store;
use crate::types::{AccountConfig, Settings};
use base64::Engine;
use rand::Rng;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE: &str = "https://mail.google.com/ openid email";

const MS_DEVICE_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_SCOPE: &str = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access openid email";

/// Identifiants Google effectifs : réglages avancés de l'utilisateur s'ils
/// existent, sinon ceux embarqués dans l'app à la compilation.
pub fn resolved_google_ids(settings: &Settings) -> (String, String) {
    if !settings.google_client_id.trim().is_empty() {
        (
            settings.google_client_id.trim().to_string(),
            settings.google_client_secret.trim().to_string(),
        )
    } else {
        (
            oauth_defaults::GOOGLE_CLIENT_ID.to_string(),
            oauth_defaults::GOOGLE_CLIENT_SECRET.to_string(),
        )
    }
}

/// Identifiant Microsoft effectif : réglages avancés, sinon embarqué.
pub fn resolved_ms_id(settings: &Settings) -> String {
    if !settings.ms_client_id.trim().is_empty() {
        settings.ms_client_id.trim().to_string()
    } else {
        oauth_defaults::MS_CLIENT_ID.to_string()
    }
}

pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub email: Option<String>,
}

pub struct DeviceCodeStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_at: Instant,
}

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn expires_at_from(expires_in: Option<i64>) -> i64 {
    now_ts() + expires_in.unwrap_or(3600) - 60
}

/// Décode la partie payload d'un JWT (sans vérification de signature :
/// on l'utilise seulement pour lire l'adresse e-mail de confort).
fn jwt_email(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let json: Value = serde_json::from_slice(&bytes).ok()?;
    json.get("email")
        .or_else(|| json.get("preferred_username"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn parse_query(url: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(qs) = url.split('?').nth(1) {
        for pair in qs.split('&') {
            let mut it = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                let key = urlencoding::decode(k).map(|c| c.into_owned()).unwrap_or_default();
                let val = urlencoding::decode(&v.replace('+', " "))
                    .map(|c| c.into_owned())
                    .unwrap_or_default();
                map.insert(key, val);
            }
        }
    }
    map
}

// --- Google : flux "boucle locale" avec PKCE. ---

pub fn google_oauth(
    app: &AppHandle,
    client_id: &str,
    client_secret: &str,
    cancel: Arc<AtomicBool>,
) -> Result<TokenSet, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err(
            "Cette version de Médor n'embarque pas encore d'identifiant OAuth Google. \
             Le mainteneur de l'app peut en intégrer un (voir README), ou vous pouvez en \
             renseigner un dans Réglages → Réglages avancés."
                .into(),
        );
    }

    let verifier: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let challenge =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        _ => return Err("Impossible d'ouvrir le port local".into()),
    };
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(GOOGLE_SCOPE),
        challenge
    );

    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Impossible d'ouvrir le navigateur : {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(300);
    let code = loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Connexion annulée.".into());
        }
        if Instant::now() > deadline {
            return Err("Délai dépassé : la connexion Google n'a pas abouti en 5 minutes.".into());
        }
        match server.recv_timeout(Duration::from_secs(1)) {
            Ok(Some(request)) => {
                let params = parse_query(request.url());
                let html = if params.contains_key("code") {
                    "<html><body style='font-family:sans-serif;padding:3em;text-align:center'><h2>Connexion réussie</h2><p>Vous pouvez fermer cet onglet et retourner dans Médor.</p></body></html>"
                } else {
                    "<html><body style='font-family:sans-serif;padding:3em;text-align:center'><h2>Connexion refusée</h2><p>Retournez dans Médor pour réessayer.</p></body></html>"
                };
                let header =
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                        .unwrap();
                let _ = request.respond(tiny_http::Response::from_string(html).with_header(header));
                if let Some(err) = params.get("error") {
                    return Err(format!("Google a refusé la connexion : {err}"));
                }
                if let Some(code) = params.get("code") {
                    break code.clone();
                }
            }
            Ok(None) => continue,
            Err(e) => return Err(e.to_string()),
        }
    };

    let resp: Value = http()?
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    token_set_from_response(resp, None)
}

pub fn refresh_google(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<TokenSet, String> {
    let resp: Value = http()?
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    token_set_from_response(resp, Some(refresh_token.to_string()))
}

// --- Microsoft : flux "device code". ---

pub fn ms_device_start(client_id: &str) -> Result<DeviceCodeStart, String> {
    if client_id.trim().is_empty() {
        return Err(
            "Cette version de Médor n'embarque pas encore d'identifiant OAuth Microsoft. \
             Le mainteneur de l'app peut en intégrer un (voir README), ou vous pouvez en \
             renseigner un dans Réglages → Réglages avancés."
                .into(),
        );
    }
    let resp: Value = http()?
        .post(MS_DEVICE_URL)
        .form(&[("client_id", client_id), ("scope", MS_SCOPE)])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
        let desc = resp
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Err(format!("Microsoft a refusé la demande ({err}) : {desc}"));
    }

    let device_code = resp
        .get("device_code")
        .and_then(|v| v.as_str())
        .ok_or("Réponse Microsoft invalide")?
        .to_string();
    let user_code = resp
        .get("user_code")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let verification_uri = resp
        .get("verification_uri")
        .and_then(|v| v.as_str())
        .unwrap_or("https://microsoft.com/devicelogin")
        .to_string();
    let interval = resp.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);
    let expires_in = resp.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(900);

    Ok(DeviceCodeStart {
        device_code,
        user_code,
        verification_uri,
        interval,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    })
}

pub fn ms_device_poll(
    client_id: &str,
    start: &DeviceCodeStart,
    cancel: Arc<AtomicBool>,
) -> Result<TokenSet, String> {
    let client = http()?;
    let mut interval = start.interval.max(1);
    loop {
        if Instant::now() > start.expires_at {
            return Err("Le code de connexion Microsoft a expiré. Relancez la connexion.".into());
        }
        // Sommeil par pas d'une seconde pour réagir vite à une annulation.
        for _ in 0..interval {
            if cancel.load(Ordering::Relaxed) {
                return Err("Connexion annulée.".into());
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        let resp: Value = client
            .post(MS_TOKEN_URL)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", client_id),
                ("device_code", start.device_code.as_str()),
            ])
            .send()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;

        match resp.get("error").and_then(|v| v.as_str()) {
            None => return token_set_from_response(resp, None),
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += 5;
                continue;
            }
            Some(other) => {
                let desc = resp
                    .get("error_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                return Err(format!("Connexion Microsoft interrompue ({other}) : {desc}"));
            }
        }
    }
}

pub fn refresh_microsoft(client_id: &str, refresh_token: &str) -> Result<TokenSet, String> {
    let resp: Value = http()?
        .post(MS_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("scope", MS_SCOPE),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    token_set_from_response(resp, Some(refresh_token.to_string()))
}

fn token_set_from_response(resp: Value, fallback_refresh: Option<String>) -> Result<TokenSet, String> {
    if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
        let desc = resp
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Err(format!("Échec d'authentification ({err}) : {desc}"));
    }
    let access_token = resp
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Réponse d'authentification sans jeton d'accès")?
        .to_string();
    let refresh_token = resp
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(fallback_refresh);
    let email = resp
        .get("id_token")
        .and_then(|v| v.as_str())
        .and_then(jwt_email);
    Ok(TokenSet {
        access_token,
        refresh_token,
        expires_at: expires_at_from(resp.get("expires_in").and_then(|v| v.as_i64())),
        email,
    })
}

/// Renvoie un access token valide pour un compte OAuth, en le rafraîchissant
/// et en le persistant si nécessaire.
pub fn ensure_access_token(app: &AppHandle, account: &AccountConfig) -> Result<String, String> {
    let mut secret = store::get_secret(app, &account.id)
        .ok_or("Identifiants introuvables pour ce compte. Supprimez-le puis reconnectez-le.")?;

    if let (Some(token), Some(exp)) = (&secret.access_token, secret.expires_at) {
        if exp > now_ts() + 60 {
            return Ok(token.clone());
        }
    }

    let refresh = secret
        .refresh_token
        .clone()
        .ok_or("Jeton de rafraîchissement manquant. Reconnectez ce compte.")?;
    let cfg = store::load_config(app);
    let tokens = match account.auth_kind.as_str() {
        "oauth-google" => {
            let (id, secret) = resolved_google_ids(&cfg.settings);
            refresh_google(&id, &secret, &refresh)?
        }
        "oauth-microsoft" => refresh_microsoft(&resolved_ms_id(&cfg.settings), &refresh)?,
        other => return Err(format!("Type d'authentification inattendu : {other}")),
    };

    secret.access_token = Some(tokens.access_token.clone());
    secret.expires_at = Some(tokens.expires_at);
    if tokens.refresh_token.is_some() {
        secret.refresh_token = tokens.refresh_token.clone();
    }
    store::set_secret(app, &account.id, &secret);
    Ok(tokens.access_token)
}
