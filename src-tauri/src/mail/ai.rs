use crate::types::{OnboardingAnswers, SenderGroup};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const BATCH_SIZE: usize = 100;
/// Nombre maximal d'expéditeurs envoyés à l'IA (les plus volumineux d'abord).
const MAX_SENDERS: usize = 600;
const CLI_TIMEOUT: Duration = Duration::from_secs(600);

/// Source d'authentification pour le classement IA.
pub enum AiAuth {
    /// Clé API Anthropic (facturation à l'usage sur console.anthropic.com).
    ApiKey(String),
    /// CLI Claude Code installé sur la machine : utilise la session/l'abonnement
    /// Claude de l'utilisateur, sans clé API.
    ClaudeCli(PathBuf),
}

/// Cherche le binaire `claude` (Claude Code) sur la machine. Résultat mis en
/// cache pour la durée de vie du processus.
pub fn find_claude_cli() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let home = std::env::var("HOME").unwrap_or_default();
            let candidates = [
                "claude".to_string(),
                format!("{home}/.claude/local/claude"),
                "/opt/homebrew/bin/claude".to_string(),
                "/usr/local/bin/claude".to_string(),
                format!("{home}/.local/bin/claude"),
            ];
            for candidate in candidates {
                let ok = Command::new(&candidate)
                    .arg("--version")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .stdin(Stdio::null())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if ok {
                    return Some(PathBuf::from(candidate));
                }
            }
            None
        })
        .clone()
}

/// Lance `claude -p` (mode silencieux) avec le prompt sur stdin et renvoie le
/// texte de la réponse.
fn run_claude_cli(bin: &PathBuf, prompt: &str) -> Result<String, String> {
    let mut child = Command::new(bin)
        .args(["-p", "--output-format", "json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer Claude Code : {e}"))?;

    child
        .stdin
        .take()
        .ok_or("stdin indisponible")?
        .write_all(prompt.as_bytes())
        .map_err(|e| e.to_string())?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None => {
                if started.elapsed() > CLI_TIMEOUT {
                    let _ = child.kill();
                    return Err("Claude Code n'a pas répondu dans le délai imparti.".into());
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    };

    let mut stdout = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut stderr);
        }
        let detail = stderr.lines().last().unwrap_or("erreur inconnue");
        return Err(format!("Claude Code a échoué : {detail}"));
    }

    // --output-format json enveloppe la réponse : {"type":"result","result":"…"}.
    if let Ok(envelope) = stdout.parse::<Value>() {
        if let Some(result) = envelope.get("result").and_then(|v| v.as_str()) {
            return Ok(result.to_string());
        }
    }
    Ok(stdout)
}

/// Demande à Claude un libellé de classement pour chaque expéditeur.
/// Les lots sont traités EN PARALLÈLE, puis une passe d'harmonisation fusionne
/// les libellés quasi-doublons créés par des lots indépendants.
/// Renvoie une table clé d'expéditeur -> libellé (« Libellé » ou « Libellé/Sous-libellé »).
pub fn ai_label_senders(
    auth: &AiAuth,
    model: &str,
    onboarding: &OnboardingAnswers,
    existing_labels: &[String],
    senders: &[SenderGroup],
    emit: &(dyn Fn(u32, u32) + Sync),
) -> Result<HashMap<String, String>, String> {
    use std::sync::atomic::{AtomicU32, Ordering};

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let system = build_system_prompt(onboarding, existing_labels);
    let considered = &senders[..senders.len().min(MAX_SENDERS)];
    let batches: Vec<&[SenderGroup]> = considered.chunks(BATCH_SIZE).collect();
    // +1 : la passe d'harmonisation finale.
    let total = batches.len() as u32 + 1;
    emit(0, total);

    let done = AtomicU32::new(0);
    let results: Vec<Result<HashMap<String, String>, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = batches
            .iter()
            .map(|batch| {
                let client = &client;
                let system = &system;
                let done = &done;
                scope.spawn(move || {
                    let res = classify_batch(auth, client, model, system, batch);
                    let fini = done.fetch_add(1, Ordering::Relaxed) + 1;
                    emit(fini, total);
                    res
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|_| Err("erreur interne d'un lot".into())))
            .collect()
    });

    let mut labels: HashMap<String, String> = HashMap::new();
    let mut premiere_erreur: Option<String> = None;
    for res in results {
        match res {
            Ok(map) => labels.extend(map),
            Err(e) => {
                if premiere_erreur.is_none() {
                    premiere_erreur = Some(e);
                }
            }
        }
    }
    if labels.is_empty() {
        return Err(premiere_erreur.unwrap_or_else(|| "aucune réponse exploitable de l'IA".into()));
    }

    // Harmonisation : « Sport », « Running » et « Sport & Running » -> un seul libellé.
    if let Ok(mapping) = harmonize(auth, &client, model, existing_labels, &labels) {
        for valeur in labels.values_mut() {
            if let Some(nouveau) = mapping.get(valeur.as_str()) {
                *valeur = nouveau.clone();
                continue;
            }
            let racine = valeur.split('/').next().unwrap_or("").to_string();
            if let Some(nouvelle_racine) = mapping.get(racine.as_str()) {
                let reste = valeur[racine.len()..].to_string();
                *valeur = format!("{nouvelle_racine}{reste}");
            }
        }
    }

    emit(total, total);
    Ok(labels)
}

/// Classe un lot d'expéditeurs.
fn classify_batch(
    auth: &AiAuth,
    client: &reqwest::blocking::Client,
    model: &str,
    system: &str,
    batch: &[SenderGroup],
) -> Result<HashMap<String, String>, String> {
    let payload: Vec<Value> = batch
        .iter()
        .map(|s| {
            json!({
                "cle": s.key,
                "nom": s.name,
                "domaine": s.domain,
                "sujets": s.sample_subjects.iter().take(3).collect::<Vec<_>>(),
                "nombre": s.total,
                "newsletter": s.is_newsletter,
            })
        })
        .collect();

    let user_content = serde_json::to_string(&payload).unwrap_or_default();
    let text = match auth {
        AiAuth::ApiKey(key) => request_via_api(client, key, model, system, &user_content)?,
        AiAuth::ClaudeCli(bin) => {
            run_claude_cli(bin, &format!("{system}\n\nVoici les expéditeurs :\n{user_content}"))?
        }
    };

    let parsed = extract_json_object(&text)
        .ok_or_else(|| "Réponse de l'IA sans objet JSON exploitable".to_string())?;
    let mut labels = HashMap::new();
    if let Value::Object(map) = parsed {
        for (key, val) in map {
            if let Some(label) = val.as_str() {
                let clean = sanitize_label(label);
                if !clean.is_empty() {
                    labels.insert(key, clean);
                }
            }
        }
    }
    Ok(labels)
}

/// Fusionne les libellés redondants créés par des lots indépendants.
/// Renvoie une table ancien -> nouveau (vide si rien à fusionner).
fn harmonize(
    auth: &AiAuth,
    client: &reqwest::blocking::Client,
    model: &str,
    existing_labels: &[String],
    labels: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    let mut distincts: Vec<String> = labels.values().cloned().collect();
    distincts.sort();
    distincts.dedup();
    if distincts.len() < 8 {
        return Ok(HashMap::new());
    }

    let existants = if existing_labels.is_empty() {
        "(aucun)".to_string()
    } else {
        existing_labels.join(" · ")
    };
    let prompt = format!(
        "Voici des libellés de classement d'une boîte mail, créés par lots indépendants. Certains sont des doublons ou quasi-doublons thématiques (ex. « Sport », « Running » et « Sport & Running » doivent devenir un seul libellé).\n\
        Réponds UNIQUEMENT avec un objet JSON {{\"ancien\": \"nouveau\", ...}} listant les fusions/renommages — n'inclus QUE les libellés qui changent.\n\
        Règles : ne touche jamais aux libellés déjà existants dans la boîte ({existants}) — fusionne plutôt les nouveaux vers eux quand le thème correspond ; vise une taxonomie compacte (une douzaine de racines maximum) ; garde le format « Racine » ou « Racine/Sous-libellé », en français.\n\n\
        Libellés à examiner : {}",
        distincts.join(" · ")
    );

    let text = match auth {
        AiAuth::ApiKey(key) => request_via_api(
            client,
            key,
            model,
            "Tu harmonises des taxonomies de libellés de boîtes mail.",
            &prompt,
        )?,
        AiAuth::ClaudeCli(bin) => run_claude_cli(bin, &prompt)?,
    };

    let mut mapping = HashMap::new();
    if let Some(Value::Object(map)) = extract_json_object(&text) {
        for (ancien, nouveau) in map {
            if let Some(n) = nouveau.as_str() {
                let clean = sanitize_label(n);
                if !clean.is_empty() && clean != ancien {
                    mapping.insert(ancien, clean);
                }
            }
        }
    }
    Ok(mapping)
}

/// Appel direct de l'API Anthropic (chemin « clé API »).
fn request_via_api(
    client: &reqwest::blocking::Client,
    api_key: &str,
    model: &str,
    system: &str,
    user_content: &str,
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": [{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"}
        }],
        "output_config": {"effort": "low"},
        "messages": [{
            "role": "user",
            "content": user_content
        }]
    });

    let resp = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Appel à l'API Claude impossible : {e}"))?;

    let status = resp.status();
    let value: Value = resp
        .json()
        .map_err(|e| format!("Réponse de l'API Claude illisible : {e}"))?;

    if !status.is_success() {
        let msg = value
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("erreur inconnue");
        return Err(format!("API Claude ({status}) : {msg}"));
    }
    if value.get("stop_reason").and_then(|v| v.as_str()) == Some("refusal") {
        return Err("L'API Claude a refusé la requête.".into());
    }

    Ok(value
        .get("content")
        .and_then(|v| v.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default())
}

fn build_system_prompt(o: &OnboardingAnswers, existing_labels: &[String]) -> String {
    let categories = if o.categories.is_empty() {
        "Invente toi-même les catégories de premier niveau les plus utiles pour CETTE boîte (une dizaine maximum), en t'inspirant au besoin des classiques : Factures & reçus, Banque & finance, Shopping & livraisons, Voyages & réservations, Réseaux sociaux, Newsletters, Sécurité & comptes, Administratif, Travail.".to_string()
    } else {
        format!(
            "Utilise en priorité ces catégories comme premier niveau : {}.",
            o.categories.join(", ")
        )
    };
    let granularity = if o.granularity == "fin" {
        "Mets presque toujours un sous-libellé au format « Catégorie/Service » (ex. « Voyages & réservations/SNCF », « Dev & outils/GitHub », « Newsletters/Le Monde ») : dès qu'un expéditeur correspond à un service ou une marque identifiable, il mérite son sous-dossier. Reste au premier niveau seulement pour les expéditeurs trop rares ou inclassables."
    } else {
        "Reste au premier niveau : un seul libellé par expéditeur, sans sous-libellé."
    };
    let usage = match o.usage.as_str() {
        "pro" => "professionnel",
        "perso" => "personnel",
        _ => "mixte (personnel et professionnel)",
    };
    let existants = if existing_labels.is_empty() {
        String::new()
    } else {
        format!(
            "\nLibellés DÉJÀ existants dans cette boîte — réutilise-les en priorité, avec leur orthographe exacte, dès qu'ils conviennent (ne crée pas de doublon proche) : {}",
            existing_labels.join(" · ")
        )
    };
    let notes = if o.notes.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\nConsignes personnelles de l'utilisateur — à respecter en PRIORITÉ sur toutes les autres règles, y compris en créant les libellés spécifiques qu'elles demandent :\n{}",
            o.notes.trim()
        )
    };

    format!(
        "Tu es le moteur de classement de Médor, une application qui range les boîtes mail.\n\
        On te fournit un tableau JSON d'expéditeurs. Pour CHAQUE expéditeur, choisis le libellé de classement le plus utile.\n\n\
        Règles :\n\
        - Réponds UNIQUEMENT avec un objet JSON, sans aucun texte autour : {{\"<cle>\": \"<libellé>\", ...}} — une entrée par clé fournie, exactement les clés reçues.\n\
        - Libellés en français, courts (1 à 3 mots), sans emoji.\n\
        - {categories}\n\
        - {granularity}\n\
        - « Newsletters » pour les lettres d'information sans meilleure catégorie ; « Notifications » pour les mails automatiques sans valeur de classement.\n\
        - Ne dépasse pas 25 libellés de premier niveau distincts au total.\n\n\
        Profil : usage {usage} de cette boîte.{existants}{notes}"
    )
}

fn extract_json_object(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

fn sanitize_label(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .filter(|c| !matches!(c, '"' | '\\' | '%' | '*' | '\r' | '\n' | '\t'))
        .collect();
    let parts: Vec<&str> = cleaned
        .split('/')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .take(2)
        .collect();
    parts.join("/")
}
