use crate::mail::classify::{build_groups, GroupUids};
use crate::mail::{ai, organizer, scanner};
use crate::oauth::{self, DeviceCodeStart, TokenSet};
use crate::store;
use crate::types::*;
use std::collections::HashMap;
use std::sync::Mutex;
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
    store::save_config(&app, &cfg);
    if let Some(key) = patch.anthropic_key {
        store::set_anthropic_key(&app, &key);
    }
    get_state(app).await
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
        let tokens = oauth::google_oauth(&app, &client_id, &client_secret)?;
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
        let tokens = oauth::ms_device_poll(&pending.client_id, &pending.start)?;
        account_from_tokens(&app, "outlook", "oauth-microsoft", tokens)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- Scan & plan

#[tauri::command]
pub async fn scan_account(app: AppHandle, account_id: String) -> Result<Plan, String> {
    tauri::async_runtime::spawn_blocking(move || scan_blocking(app, account_id))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_blocking(app: AppHandle, account_id: String) -> Result<Plan, String> {
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
    let emit_progress = |p: ScanProgress| emit_scan(&app, p);
    let (messages, inbox_total) =
        scanner::scan_inbox(&mut session, onboarding.horizon_months, &emit_progress)?;
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
    let (mut groups, uids) = build_groups(&messages);

    let mut generated_by = "heuristique".to_string();
    let mut ai_note: Option<String> = None;
    if let Some(api_key) = store::get_anthropic_key(&app) {
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
        match ai::ai_label_senders(&api_key, &cfg.settings.model, &onboarding, &groups, &emit_ai) {
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
            "Classement heuristique : ajoutez une clé API Claude dans les réglages pour un classement plus fin."
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

fn build_plan(
    account_id: &str,
    scanned: u32,
    inbox_total: u32,
    senders: Vec<SenderGroup>,
    generated_by: String,
    ai_note: Option<String>,
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
    }
}

#[tauri::command]
pub async fn apply_plan(
    app: AppHandle,
    account_id: String,
    selection: ApplySelection,
) -> Result<ApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        let result = organizer::apply(&mut session, &uids, &selection, &emit)?;
        let _ = session.logout();

        // Le plan ne correspond plus à l'état de la boîte : on invalide le cache.
        let state = app.state::<AppState>();
        state.scans.lock().unwrap().remove(&account_id);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
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
