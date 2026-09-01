pub mod ai;
pub mod classify;
pub mod organizer;
pub mod scanner;

use crate::oauth;
use crate::store;
use crate::types::AccountConfig;
use tauri::AppHandle;

pub type ImapSession = imap::Session<native_tls::TlsStream<std::net::TcpStream>>;

struct XOAuth2 {
    user: String,
    token: String,
}

impl imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> Self::Response {
        format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.token)
    }
}

pub fn open_session(app: &AppHandle, account: &AccountConfig) -> Result<ImapSession, String> {
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let client = imap::connect(
        (account.imap.host.as_str(), account.imap.port),
        account.imap.host.as_str(),
        &tls,
    )
    .map_err(|e| format!("Connexion à {} impossible : {e}", account.imap.host))?;

    match account.auth_kind.as_str() {
        "password" => {
            let secret = store::get_secret(app, &account.id)
                .ok_or("Mot de passe introuvable pour ce compte. Supprimez-le puis reconnectez-le.")?;
            let password = secret
                .password
                .ok_or("Mot de passe introuvable pour ce compte.")?;
            client
                .login(&account.email, &password)
                .map_err(|e| format!("Authentification refusée : {}", e.0))
        }
        _ => {
            let token = oauth::ensure_access_token(app, account)?;
            let auth = XOAuth2 {
                user: account.email.clone(),
                token,
            };
            client
                .authenticate("XOAUTH2", &auth)
                .map_err(|e| format!("Authentification OAuth refusée : {}", e.0))
        }
    }
}

/// Teste la connexion d'un compte (connexion + sélection de la boîte de réception).
pub fn test_account(app: &AppHandle, account: &AccountConfig) -> Result<(), String> {
    let mut session = open_session(app, account)?;
    session
        .select("INBOX")
        .map_err(|e| format!("Boîte de réception inaccessible : {e}"))?;
    let _ = session.logout();
    Ok(())
}
