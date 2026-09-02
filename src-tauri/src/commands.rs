use crate::mail::ai::AiAuth;
use crate::mail::classify::{build_groups, GroupUids};
use crate::mail::{ai, organizer, scanner};
use crate::oauth::{self, DeviceCodeStart, TokenSet};
use crate::store;
use crate::types::*;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct ScanCache {
    pub uids: HashMap<String, GroupUids>,
    pub plan: Plan,
}

pub struct PendingDevice {
    pub start: DeviceCodeStart,
    pub client_id: String,
}

#[derive(Default)]
pub struct AppState {
    pub scans: Mutex<HashMap<String, ScanCache>>,
    pub pending_device: Mutex<Option<PendingDevice>>,
    /// Drapeau d'annulation du flux OAuth en cours (Google ou Microsoft).
    pub oauth_cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// Comptes sur lesquels une opération (analyse, rangement) est en cours —
    /// évite qu'un rangement automatique chevauche une action manuelle.
    pub busy: Mutex<HashSet<String>>,
}

/// Verrou d'occupation d'un compte, relâché automatiquement en fin de portée.
struct BusyGuard {
    app: AppHandle,
    id: String,
}

impl BusyGuard {
    fn try_new(app: &AppHandle, id: &str) -> Option<Self> {
        let state = app.state::<AppState>();
        let mut busy = state.busy.lock().unwrap();
        if busy.contains(id) {
            return None;
        }
        busy.insert(id.to_string());
        Some(Self {
            app: app.clone(),
            id: id.to_string(),
        })
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        let state = self.app.state::<AppState>();
        state.busy.lock().unwrap().remove(&self.id);
    }
}

/// Prépare un nouveau drapeau d'annulation, en annulant l'éventuel flux précédent.
fn new_cancel_flag(app: &AppHandle) -> Arc<AtomicBool> {
    let state = app.state::<AppState>();
    let mut guard = state.oauth_cancel.lock().unwrap();
    if let Some(old) = guard.as_ref() {
        old.store(true, Ordering::Relaxed);
    }
    let flag = Arc::new(AtomicBool::new(false));
    *guard = Some(flag.clone());
    flag
}

fn preset_for(provider: &str) -> Option<ImapEndpoint> {
    match provider {
        "gmail" => Some(ImapEndpoint {
            host: "imap.gmail.com".into(),
            port: 993,
        }),
        "outlook" => Some(ImapEndpoint {
            host: "outlook.office365.com".into(),
            port: 993,
        }),
        "icloud" => Some(ImapEndpoint {
            host: "imap.mail.me.com".into(),
            port: 993,
        }),
        _ => None,
    }
}

fn emit_scan(app: &AppHandle, progress: ScanProgress) {
    let _ = app.emit("scan-progress", progress);
}

// ---------------------------------------------------------------- Bootstrap

#[tauri::command]
pub async fn get_state(app: AppHandle) -> Result<AppBootstrap, String> {
    let cfg = store::load_config(&app);
    let has_key = store::get_anthropic_key(&app).is_some();
    let (google_id, _) = oauth::resolved_google_ids(&cfg.settings);
    let ms_id = oauth::resolved_ms_id(&cfg.settings);
    Ok(AppBootstrap {
        accounts: cfg.accounts,
        onboarding: cfg.onboarding,
        settings: cfg.settings,
        has_anthropic_key: has_key,
        google_oauth_ready: !google_id.is_empty(),
        ms_oauth_ready: !ms_id.is_empty(),
        claude_cli_available: ai::find_claude_cli().is_some(),
        last_auto: if cfg.last_auto_result.is_empty() {
            None
        } else {
            Some(cfg.last_auto_result)
        },
        autostart_enabled: {
            use tauri_plugin_autostart::ManagerExt;
            app.autolaunch().is_enabled().unwrap_or(false)
        },
    })
}

#[tauri::command]
pub async fn set_onboarding(app: AppHandle, answers: OnboardingAnswers) -> Result<(), String> {
    let mut cfg = store::load_config(&app);
    cfg.onboarding = Some(answers);
    store::save_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
pub async fn set_settings(app: AppHandle, patch: SettingsPatch) -> Result<AppBootstrap, String> {
    let mut cfg = store::load_config(&app);
    if let Some(v) = patch.model {
        cfg.settings.model = v;
    }
    if let Some(v) = patch.google_client_id {
        cfg.settings.google_client_id = v.trim().to_string();
    }
    if let Some(v) = patch.google_client_secret {
        cfg.settings.google_client_secret = v.trim().to_string();
    }
    if let Some(v) = patch.ms_client_id {
        cfg.settings.ms_client_id = v.trim().to_string();
    }
    if let Some(v) = patch.auto_enabled {
        cfg.settings.auto_enabled = v;
    }
    if let Some(v) = patch.auto_frequency {
        if ["1h", "6h", "jour"].contains(&v.as_str()) {
            cfg.settings.auto_frequency = v;
        }
    }
    if let Some(v) = patch.auto_hour {
        cfg.settings.auto_hour = v.min(23);
    }
    if let Some(v) = patch.auto_scope {
        if ["tous", "lus", "nonlus"].contains(&v.as_str()) {
            cfg.settings.auto_scope = v;
        }
    }
    if let Some(v) = patch.auto_junk {
        cfg.settings.auto_junk = v;
    }
    store::save_config(&app, &cfg);
    if let Some(key) = patch.anthropic_key {
        store::set_anthropic_key(&app, &key);
    }
    get_state(app).await
}

/// Active ou désactive le lancement de Médor à l'ouverture de session.
#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())
    } else {
        launcher.disable().map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------- Comptes

#[tauri::command]
pub async fn add_account(app: AppHandle, input: AddAccountInput) -> Result<AccountConfig, String> {
    tauri::async_runtime::spawn_blocking(move || add_account_blocking(app, input))
        .await
        .map_err(|e| e.to_string())?
}

fn add_account_blocking(app: AppHandle, input: AddAccountInput) -> Result<AccountConfig, String> {
    let email = input.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err("Adresse e-mail invalide.".into());
    }
    let endpoint = match input.imap {
        Some(ep) => ep,
        None => preset_for(&input.provider).ok_or("Renseignez le serveur IMAP.")?,
    };
    let password = input
        .password
        .clone()
        .filter(|p| !p.trim().is_empty())
        .ok_or("Renseignez le mot de passe (ou mot de passe d'application).")?;

    let account = AccountConfig {
        id: uuid::Uuid::new_v4().to_string(),
        provider: input.provider.clone(),
        email: email.clone(),
        auth_kind: "password".into(),
        imap: endpoint,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store::set_secret(
        &app,
        &account.id,
        &AccountSecret {
            password: Some(password.trim().to_string()),
            ..Default::default()
        },
    );

    if let Err(e) = crate::mail::test_account(&app, &account) {
        store::delete_secret(&app, &account.id);
        return Err(e);
    }

    let mut cfg = store::load_config(&app);
    cfg.accounts.retain(|a| a.email != email || a.provider != account.provider);
    cfg.accounts.push(account.clone());
    store::save_config(&app, &cfg);
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(app: AppHandle, id: String) -> Result<(), String> {
    let mut cfg = store::load_config(&app);
    cfg.accounts.retain(|a| a.id != id);
    store::save_config(&app, &cfg);
    store::delete_secret(&app, &id);
    let state = app.state::<AppState>();
    state.scans.lock().unwrap().remove(&id);
    Ok(())
}

// ---------------------------------------------------------------- OAuth

fn account_from_tokens(
    app: &AppHandle,
    provider: &str,
    auth_kind: &str,
    tokens: TokenSet,
) -> Result<AccountConfig, String> {
    let email = tokens
        .email
        .clone()
        .ok_or("Impossible de déterminer l'adresse e-mail du compte connecté.")?
        .to_lowercase();
    let account = AccountConfig {
        id: uuid::Uuid::new_v4().to_string(),
        provider: provider.into(),
        email: email.clone(),
        auth_kind: auth_kind.into(),
        imap: preset_for(provider).unwrap(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store::set_secret(
        app,
        &account.id,
        &AccountSecret {
            password: None,
            refresh_token: tokens.refresh_token,
            access_token: Some(tokens.access_token),
            expires_at: Some(tokens.expires_at),
        },
    );

    if let Err(e) = crate::mail::test_account(app, &account) {
        store::delete_secret(app, &account.id);
        return Err(format!("Connecté à {email}, mais l'IMAP a échoué : {e}"));
    }

    let mut cfg = store::load_config(app);
    for old in cfg
        .accounts
        .iter()
        .filter(|a| a.email == email && a.provider == account.provider)
    {
        store::delete_secret(app, &old.id);
    }
    cfg.accounts
        .retain(|a| a.email != email || a.provider != account.provider);
    cfg.accounts.push(account.clone());
    store::save_config(app, &cfg);
    Ok(account)
}

#[tauri::command]
pub async fn google_connect(app: AppHandle) -> Result<AccountConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = store::load_config(&app);
        let (client_id, client_secret) = oauth::resolved_google_ids(&cfg.settings);
        let cancel = new_cancel_flag(&app);
        let tokens = oauth::google_oauth(&app, &client_id, &client_secret, cancel)?;
        account_from_tokens(&app, "gmail", "oauth-google", tokens)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ms_device_start(app: AppHandle) -> Result<MsDeviceCodeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = store::load_config(&app);
        let ms_client_id = oauth::resolved_ms_id(&cfg.settings);
        let start = oauth::ms_device_start(&ms_client_id)?;
        let info = MsDeviceCodeInfo {
            user_code: start.user_code.clone(),
            verification_uri: start.verification_uri.clone(),
            message: format!(
                "Ouvrez {} et saisissez le code {}",
                start.verification_uri, start.user_code
            ),
        };
        let state = app.state::<AppState>();
        *state.pending_device.lock().unwrap() = Some(PendingDevice {
            start,
            client_id: ms_client_id,
        });
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ms_device_finish(app: AppHandle) -> Result<AccountConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pending = {
            let state = app.state::<AppState>();
            let mut guard = state.pending_device.lock().unwrap();
            guard.take()
        }
        .ok_or("Aucune connexion Microsoft en cours. Relancez la connexion.")?;
        let cancel = new_cancel_flag(&app);
        let tokens = oauth::ms_device_poll(&pending.client_id, &pending.start, cancel)?;
        account_from_tokens(&app, "outlook", "oauth-microsoft", tokens)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Annule le flux OAuth en cours (Google ou Microsoft) : le bouton de
/// connexion redevient utilisable immédiatement côté interface.
#[tauri::command]
pub async fn oauth_cancel(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Some(flag) = state.oauth_cancel.lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------- Scan & plan

#[tauri::command]
pub async fn scan_account(app: AppHandle, account_id: String, scope: String) -> Result<Plan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_blocking(app, account_id, scope))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_blocking(app: AppHandle, account_id: String, scope: String) -> Result<Plan, String> {
    let _busy = BusyGuard::try_new(&app, &account_id)
        .ok_or("Une opération est déjà en cours sur ce compte.")?;
    let cfg = store::load_config(&app);
    let account = cfg
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or("Compte introuvable.")?
        .clone();
    let onboarding = cfg.onboarding.clone().unwrap_or_default();

    emit_scan(
        &app,
        ScanProgress {
            phase: "connexion".into(),
            done: 0,
            total: 0,
            note: Some(account.email.clone()),
        },
    );

    let mut session = crate::mail::open_session(&app, &account)?;

    // Libellés déjà présents : l'IA les réutilisera au lieu d'inventer des doublons.
    let existing_labels: Vec<String> = session
        .list(Some(""), Some("*"))
        .map(|names| {
            names
                .iter()
                .filter_map(|n| {
                    let decoded = crate::mail::utf7::decode(n.name());
                    let lower = decoded.to_lowercase();
                    if lower == "inbox"
                        || lower.starts_with("[gmail]")
                        || lower.starts_with("[google mail]")
                    {
                        None
                    } else {
                        Some(decoded)
                    }
                })
                .take(120)
                .collect()
        })
        .unwrap_or_default();

    let emit_progress = |p: ScanProgress| emit_scan(&app, p);
    let (messages, inbox_total) =
        scanner::scan_inbox(&mut session, onboarding.horizon_months, &scope, &emit_progress)?;
    let _ = session.logout();

    emit_scan(
        &app,
        ScanProgress {
            phase: "classement".into(),
            done: 0,
            total: 0,
            note: None,
        },
    );
    let (mut groups, uids) = build_groups(&messages, onboarding.granularity == "fin");

    // Authentification IA : clé API si renseignée, sinon la session Claude Code
    // de la machine (abonnement Claude), sinon classement heuristique seul.
    let auth = if let Some(key) = store::get_anthropic_key(&app) {
        Some(AiAuth::ApiKey(key))
    } else {
        ai::find_claude_cli().map(AiAuth::ClaudeCli)
    };

    let mut generated_by = "heuristique".to_string();
    let mut ai_note: Option<String> = None;
    if let Some(auth) = auth {
        emit_scan(
            &app,
            ScanProgress {
                phase: "ia".into(),
                done: 0,
                total: 0,
                note: None,
            },
        );
        let emit_ai = |done: u32, total: u32| {
            emit_scan(
                &app,
                ScanProgress {
                    phase: "ia".into(),
                    done,
                    total,
                    note: None,
                },
            );
        };
        match ai::ai_label_senders(
            &auth,
            &cfg.settings.model,
            &onboarding,
            &existing_labels,
            &groups,
            &emit_ai,
        ) {
            Ok(labels) => {
                for group in groups.iter_mut() {
                    if let Some(label) = labels.get(&group.key) {
                        group.label = label.clone();
                    }
                }
                generated_by = "ia".into();
            }
            Err(e) => {
                ai_note = Some(format!(
                    "Classement heuristique utilisé (IA indisponible : {e})"
                ));
            }
        }
    } else {
        ai_note = Some(
            "Classement heuristique : installez Claude Code ou ajoutez une clé API Claude dans les réglages pour un classement sur mesure."
                .into(),
        );
    }

    let plan = build_plan(
        &account_id,
        messages.len() as u32,
        inbox_total,
        groups,
        generated_by,
        ai_note,
        scope,
        existing_labels,
    );

    let state = app.state::<AppState>();
    state.scans.lock().unwrap().insert(
        account_id,
        ScanCache {
            uids,
            plan: plan.clone(),
        },
    );
    Ok(plan)
}

#[allow(clippy::too_many_arguments)]
fn build_plan(
    account_id: &str,
    scanned: u32,
    inbox_total: u32,
    senders: Vec<SenderGroup>,
    generated_by: String,
    ai_note: Option<String>,
    scope: String,
    existing_labels: Vec<String>,
) -> Plan {
    let mut label_map: HashMap<String, PlanLabel> = HashMap::new();
    let mut newsletters: Vec<String> = Vec::new();
    let mut spam: Vec<String> = Vec::new();

    for sender in &senders {
        let entry = label_map
            .entry(sender.label.clone())
            .or_insert_with(|| PlanLabel {
                name: sender.label.clone(),
                sender_keys: Vec::new(),
                read_count: 0,
                total_count: 0,
            });
        entry.sender_keys.push(sender.key.clone());
        entry.read_count += sender.read;
        entry.total_count += sender.total;

        if sender.is_newsletter {
            newsletters.push(sender.key.clone());
        }
        if sender.spam_suspect {
            spam.push(sender.key.clone());
        }
    }

    let mut labels: Vec<PlanLabel> = label_map.into_values().collect();
    labels.sort_by(|a, b| b.total_count.cmp(&a.total_count));

    Plan {
        account_id: account_id.to_string(),
        scanned,
        inbox_total,
        senders,
        labels,
        newsletters,
        spam_suspects: spam,
        generated_by,
        ai_note,
        scope,
        existing_labels,
    }
}

#[tauri::command]
pub async fn apply_plan(
    app: AppHandle,
    account_id: String,
    selection: ApplySelection,
) -> Result<ApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_blocking(app, account_id, selection))
        .await
        .map_err(|e| e.to_string())?
}

fn apply_blocking(
    app: AppHandle,
    account_id: String,
    selection: ApplySelection,
) -> Result<ApplyResult, String> {
    let _busy = BusyGuard::try_new(&app, &account_id)
        .ok_or("Une opération est déjà en cours sur ce compte.")?;
    {
        let cfg = store::load_config(&app);
        let account = cfg
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or("Compte introuvable.")?
            .clone();

        let uids = {
            let state = app.state::<AppState>();
            let scans = state.scans.lock().unwrap();
            let cache = scans
                .get(&account_id)
                .ok_or("Analyse expirée : relancez l'analyse de la boîte.")?;
            cache.uids.clone()
        };

        let mut session = crate::mail::open_session(&app, &account)?;
        let emit = |p: ApplyProgress| {
            let _ = app.emit("apply-progress", p);
        };
        let mut result = organizer::apply(&mut session, &uids, &selection, &emit)?;
        let _ = session.logout();

        // Couleurs des libellés : possible uniquement via l'API Gmail (OAuth).
        if !selection.label_colors.is_empty() {
            if account.provider == "gmail" && account.auth_kind == "oauth-google" {
                match oauth::ensure_access_token(&app, &account) {
                    Ok(token) => {
                        let errs = crate::mail::gmail::apply_label_colors(&token, &selection.label_colors);
                        result.errors.extend(errs);
                    }
                    Err(e) => result
                        .errors
                        .push(format!("Couleurs non appliquées (jeton indisponible) : {e}")),
                }
            }
        }

        // Mémoriser les libellés touchés (parents compris) pour pouvoir les
        // supprimer plus tard depuis l'app.
        let mut cfg = store::load_config(&app);
        let entry = cfg.created_labels.entry(account_id.clone()).or_default();
        for label in &selection.labels {
            let mut prefix = String::new();
            for part in label.name.split('/') {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                if !entry.contains(&prefix) {
                    entry.push(prefix.clone());
                }
            }
        }
        store::save_config(&app, &cfg);

        // Le plan ne correspond plus à l'état de la boîte : on invalide le cache.
        let state = app.state::<AppState>();
        state.scans.lock().unwrap().remove(&account_id);
        Ok(result)
    }
}

/// Supprime des libellés côté serveur : ceux créés par Médor
/// (`only_rangemail = true`), ou tous les dossiers non-système du compte.
#[tauri::command]
pub async fn delete_labels(
    app: AppHandle,
    account_id: String,
    only_rangemail: bool,
) -> Result<DeleteLabelsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = store::load_config(&app);
        let account = cfg
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or("Compte introuvable.")?
            .clone();

        let targets = if only_rangemail {
            let tracked = cfg
                .created_labels
                .get(&account_id)
                .cloned()
                .unwrap_or_default();
            if tracked.is_empty() {
                return Err(
                    "Médor n'a pas (encore) de liste de libellés créés pour ce compte. \
                     Utilisez « Supprimer TOUS les libellés », ou refaites un rangement d'abord."
                        .into(),
                );
            }
            Some(tracked)
        } else {
            None
        };

        let mut session = crate::mail::open_session(&app, &account)?;
        let result = organizer::delete_labels(&mut session, targets)?;
        let _ = session.logout();

        if only_rangemail {
            let mut cfg = store::load_config(&app);
            cfg.created_labels.remove(&account_id);
            store::save_config(&app, &cfg);
        }

        // Les libellés n'existent plus : le plan en cache est caduc.
        let state = app.state::<AppState>();
        state.scans.lock().unwrap().remove(&account_id);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------- Rangement automatique

/// Boucle de fond : vérifie chaque minute si un rangement automatique est dû,
/// puis analyse et range chaque compte. L'app doit rester ouverte.
pub fn auto_sort_loop(app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_secs(60));
        let cfg = store::load_config(&app);
        if !cfg.settings.auto_enabled || cfg.accounts.is_empty() {
            continue;
        }
        if !auto_due(&cfg.settings, cfg.last_auto_run) {
            continue;
        }

        let mut archived = 0u32;
        let mut junked = 0u32;
        let mut erreurs: Vec<String> = Vec::new();
        for account in cfg.accounts.clone() {
            match auto_sort_account(&app, &account.id, &cfg.settings.auto_scope, cfg.settings.auto_junk)
            {
                Ok(res) => {
                    archived += res.archived;
                    junked += res.junked;
                    if let Some(err) = res.errors.first() {
                        erreurs.push(err.clone());
                    }
                }
                Err(e) => erreurs.push(format!("{} : {e}", account.email)),
            }
        }

        let stamp = chrono::Local::now().format("%d/%m à %H:%M");
        let mut resume = format!("{stamp} — {archived} mails rangés");
        if junked > 0 {
            resume.push_str(&format!(", {junked} vers les indésirables"));
        }
        if !erreurs.is_empty() {
            resume.push_str(&format!(" · {} erreur(s) : {}", erreurs.len(), erreurs[0]));
        }

        let mut cfg2 = store::load_config(&app);
        cfg2.last_auto_run = chrono::Utc::now().timestamp();
        cfg2.last_auto_result = resume.clone();
        store::save_config(&app, &cfg2);
        let _ = app.emit("auto-sort-done", resume.clone());

        if archived + junked > 0 {
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title("Médor 🐶")
                .body(&resume)
                .show();
        }
    }
}

fn auto_due(settings: &Settings, last_run: i64) -> bool {
    use chrono::Timelike;
    let now = chrono::Local::now();
    match settings.auto_frequency.as_str() {
        "1h" => now.timestamp() - last_run >= 3590,
        "6h" => now.timestamp() - last_run >= 6 * 3600 - 10,
        _ => {
            // Quotidien : à l'heure choisie, une seule fois par jour.
            if now.hour() != settings.auto_hour as u32 {
                return false;
            }
            match chrono::DateTime::from_timestamp(last_run, 0) {
                Some(d) => d.with_timezone(&chrono::Local).date_naive() != now.date_naive(),
                None => true,
            }
        }
    }
}

/// Analyse puis range un compte sans intervention : tous les libellés proposés
/// sauf « À trier », et les indésirables si l'option est activée.
fn auto_sort_account(
    app: &AppHandle,
    account_id: &str,
    scope: &str,
    junk: bool,
) -> Result<ApplyResult, String> {
    let plan = scan_blocking(app.clone(), account_id.to_string(), scope.to_string())?;
    if plan.senders.is_empty() {
        return Ok(ApplyResult::default());
    }
    let junk_keys: Vec<String> = if junk { plan.spam_suspects.clone() } else { Vec::new() };
    let junk_set: HashSet<&String> = junk_keys.iter().collect();
    let labels: Vec<ApplySelectionLabel> = plan
        .labels
        .iter()
        .filter(|l| l.name != "À trier")
        .map(|l| ApplySelectionLabel {
            name: l.name.clone(),
            sender_keys: l
                .sender_keys
                .iter()
                .filter(|k| !junk_set.contains(k))
                .cloned()
                .collect(),
        })
        .filter(|l| !l.sender_keys.is_empty())
        .collect();
    if labels.is_empty() && junk_keys.is_empty() {
        return Ok(ApplyResult::default());
    }
    apply_blocking(
        app.clone(),
        account_id.to_string(),
        ApplySelection {
            labels,
            junk_sender_keys: junk_keys,
            label_colors: HashMap::new(),
        },
    )
}

// ---------------------------------------------------------------- Désabonnement

#[tauri::command]
pub async fn unsubscribe_one_click(
    app: AppHandle,
    account_id: String,
    sender_key: String,
) -> Result<UnsubscribeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sender = {
            let state = app.state::<AppState>();
            let scans = state.scans.lock().unwrap();
            let cache = scans
                .get(&account_id)
                .ok_or("Analyse expirée : relancez l'analyse de la boîte.")?;
            cache
                .plan
                .senders
                .iter()
                .find(|s| s.key == sender_key)
                .cloned()
                .ok_or("Expéditeur introuvable dans la dernière analyse.")?
        };

        let Some(url) = sender.unsubscribe_http.clone() else {
            return Ok(UnsubscribeResult {
                ok: false,
                method: "aucun".into(),
                detail: "Pas de lien de désabonnement pour cet expéditeur.".into(),
            });
        };
        if !sender.one_click {
            return Ok(UnsubscribeResult {
                ok: false,
                method: "lien".into(),
                detail: url,
            });
        }

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        match client
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .body("List-Unsubscribe=One-Click")
            .send()
        {
            Ok(resp) if resp.status().is_success() => Ok(UnsubscribeResult {
                ok: true,
                method: "one-click".into(),
                detail: format!("Désabonnement demandé auprès de {}", sender.domain),
            }),
            Ok(_) => Ok(UnsubscribeResult {
                ok: false,
                method: "lien".into(),
                detail: url.clone(),
            }),
            Err(_) => Ok(UnsubscribeResult {
                ok: false,
                method: "lien".into(),
                detail: url,
            }),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
