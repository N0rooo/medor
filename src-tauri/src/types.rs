use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Rangement automatique planifié (l'app doit rester ouverte).
    pub auto_enabled: bool,
    /// 1h | 6h | jour
    pub auto_frequency: String,
    /// Heure locale (0-23) pour la fréquence « jour ».
    pub auto_hour: u8,
    /// Portée des analyses automatiques : tous | lus | nonlus
    pub auto_scope: String,
    /// Déplacer aussi les indésirables détectés lors du rangement automatique.
    pub auto_junk: bool,
    /// Nombre maximal de mails par analyse (0 = sans limite).
    pub scan_limit: u32,
    /// Notification quand une opération se termine.
    pub notify_done: bool,
    /// Jouer un son avec la notification.
    pub notify_sound: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            model: "claude-opus-5".into(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            ms_client_id: String::new(),
            auto_enabled: false,
            auto_frequency: "jour".into(),
            auto_hour: 8,
            auto_scope: "lus".into(),
            auto_junk: false,
            scan_limit: 3000,
            notify_done: true,
            notify_sound: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub accounts: Vec<AccountConfig>,
    pub onboarding: Option<OnboardingAnswers>,
    pub settings: Settings,
    /// Libellés créés par Rangemail, par identifiant de compte — pour pouvoir
    /// les supprimer depuis l'app.
    pub created_labels: HashMap<String, Vec<String>>,
    /// Timestamp (s) du dernier rangement automatique.
    pub last_auto_run: i64,
    /// Résumé lisible du dernier rangement automatique.
    pub last_auto_result: String,
    /// Mémoire de Médor : expéditeur -> libellé appliqué. Alimentée à chaque
    /// rangement validé ; prioritaire sur l'IA aux analyses suivantes.
    pub sender_rules: HashMap<String, String>,
    /// Désabonnements demandés : expéditeur -> timestamp de la demande.
    pub unsubscribed: HashMap<String, i64>,
    /// Journal des actions de Médor (les 200 dernières).
    pub journal: Vec<JournalEntry>,
    /// Compteur de fierté : mails rangés depuis l'adoption.
    pub stats_archived_total: u64,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
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
    /// Timestamp du mail le plus récent.
    pub last_ts: i64,
    /// Désabonnement demandé via Médor à cette date (timestamp s).
    pub unsubscribed_at: Option<i64>,
    /// Continue d'écrire malgré un désabonnement demandé il y a plus de 3 jours.
    pub still_mailing: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApercuMail {
    pub subject: String,
    pub date: String,
    pub seen: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JournalEntry {
    pub id: String,
    pub account_id: String,
    pub account_email: String,
    pub ts: i64,
    /// rangement | auto | corbeille | restauration
    pub kind: String,
    pub archived: u32,
    pub junked: u32,
    pub trashed: u32,
    pub restored: u32,
    pub labels_created: u32,
    /// Libellés touchés — permet « vider ces libellés vers la boîte de réception ».
    pub labels: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanLabel {
    pub name: String,
    pub sender_keys: Vec<String>,
    pub read_count: u32,
    pub total_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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
    /// Portée de l'analyse : tous | lus | nonlus
    pub scope: String,
    /// Libellés déjà présents sur le serveur (noms décodés), pour afficher
    /// dans l'app ce qui sera créé vs simplement complété.
    pub existing_labels: Vec<String>,
    /// Date de l'analyse (epoch s) — sert au rappel « analyse du … ».
    #[serde(default)]
    pub scanned_at: i64,
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
    /// Couleur choisie par libellé de premier niveau (fond hex de la palette
    /// Gmail). Appliquée seulement sur les comptes Gmail connectés en OAuth.
    #[serde(default)]
    pub label_colors: HashMap<String, String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoucleProgress {
    pub passe: u32,
    pub archives_cumules: u32,
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

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLabelsResult {
    pub deleted: u32,
    pub errors: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// Mails remis dans la boîte de réception.
    pub restored: u32,
    /// Dossiers créés par Médor supprimés après vidage.
    pub folders_deleted: u32,
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
    /// Claude Code est installé sur la machine : le classement IA peut passer
    /// par la session/l'abonnement Claude de l'utilisateur, sans clé API.
    pub claude_cli_available: bool,
    /// Résumé du dernier rangement automatique, s'il y en a eu un.
    pub last_auto: Option<String>,
    /// Médor se lance-t-il à l'ouverture de session ?
    pub autostart_enabled: bool,
    /// Mails rangés depuis l'adoption (tous comptes confondus).
    pub total_archived: u64,
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
    pub auto_enabled: Option<bool>,
    pub auto_frequency: Option<String>,
    pub auto_hour: Option<u8>,
    pub auto_scope: Option<String>,
    pub auto_junk: Option<bool>,
    pub scan_limit: Option<u32>,
    pub notify_done: Option<bool>,
    pub notify_sound: Option<bool>,
}
