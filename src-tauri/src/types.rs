use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImapEndpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountConfig {
    pub id: String,
    /// gmail | outlook | icloud | imap
    pub provider: String,
    pub email: String,
    /// password | oauth-google | oauth-microsoft
    pub auth_kind: String,
    pub imap: ImapEndpoint,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingAnswers {
    /// perso | pro | mixte
    pub usage: String,
    pub categories: Vec<String>,
    /// large | fin
    pub granularity: String,
    /// 0 = toute la boîte
    pub horizon_months: u32,
    pub archive_read_newsletters: bool,
    pub notes: String,
}

impl Default for OnboardingAnswers {
    fn default() -> Self {
        Self {
            usage: "mixte".into(),
            categories: vec![],
            granularity: "fin".into(),
            horizon_months: 12,
            archive_read_newsletters: true,
            notes: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub ms_client_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            model: "claude-opus-5".into(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            ms_client_id: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub accounts: Vec<AccountConfig>,
    pub onboarding: Option<OnboardingAnswers>,
    pub settings: Settings,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountSecret {
    pub password: Option<String>,
    pub refresh_token: Option<String>,
    pub access_token: Option<String>,
    /// Timestamp (secondes) d'expiration de l'access token.
    pub expires_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddAccountInput {
    pub provider: String,
    pub email: String,
    pub auth_kind: String,
    pub password: Option<String>,
    pub imap: Option<ImapEndpoint>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SenderGroup {
    pub key: String,
    pub name: String,
    pub address: String,
    pub domain: String,
    pub total: u32,
    pub read: u32,
    pub unread: u32,
    pub last_date: String,
    pub is_newsletter: bool,
    pub one_click: bool,
    pub unsubscribe_http: Option<String>,
    pub unsubscribe_mailto: Option<String>,
    pub sample_subjects: Vec<String>,
    pub label: String,
    pub spam_suspect: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanLabel {
    pub name: String,
    pub sender_keys: Vec<String>,
    pub read_count: u32,
    pub total_count: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub account_id: String,
    pub scanned: u32,
    pub inbox_total: u32,
    pub senders: Vec<SenderGroup>,
    pub labels: Vec<PlanLabel>,
    pub newsletters: Vec<String>,
    pub spam_suspects: Vec<String>,
    /// ia | heuristique
    pub generated_by: String,
    pub ai_note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    /// connexion | liste | lecture | classement | ia
    pub phase: String,
    pub done: u32,
    pub total: u32,
    pub note: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplySelectionLabel {
    pub name: String,
    pub sender_keys: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplySelection {
    pub labels: Vec<ApplySelectionLabel>,
    pub junk_sender_keys: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProgress {
    pub done: u32,
    pub total: u32,
    pub label: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub archived: u32,
    pub labels_created: u32,
    pub junked: u32,
    pub errors: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MsDeviceCodeInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeResult {
    pub ok: bool,
    /// one-click | lien | mailto | aucun
    pub method: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    pub accounts: Vec<AccountConfig>,
    pub onboarding: Option<OnboardingAnswers>,
    pub settings: Settings,
    pub has_anthropic_key: bool,
    /// La connexion « Se connecter avec Google » est-elle utilisable
    /// (identifiant embarqué dans l'app ou renseigné dans les réglages) ?
    pub google_oauth_ready: bool,
    /// Idem pour la connexion Microsoft.
    pub ms_oauth_ready: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub model: Option<String>,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub ms_client_id: Option<String>,
    /// Chaîne vide = supprimer la clé.
    pub anthropic_key: Option<String>,
}
