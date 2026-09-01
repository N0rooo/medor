use crate::types::{OnboardingAnswers, SenderGroup};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const BATCH_SIZE: usize = 100;
/// Nombre maximal d'expéditeurs envoyés à l'IA (les plus volumineux d'abord).
const MAX_SENDERS: usize = 600;

/// Demande à Claude un libellé de classement pour chaque expéditeur.
/// Renvoie une table clé d'expéditeur -> libellé (« Libellé » ou « Libellé/Sous-libellé »).
pub fn ai_label_senders(
    api_key: &str,
    model: &str,
    onboarding: &OnboardingAnswers,
    senders: &[SenderGroup],
    emit: &dyn Fn(u32, u32),
) -> Result<HashMap<String, String>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let system = build_system_prompt(onboarding);
    let considered = &senders[..senders.len().min(MAX_SENDERS)];
    let mut labels: HashMap<String, String> = HashMap::new();
    let total_batches = considered.chunks(BATCH_SIZE).count() as u32;

    for (index, batch) in considered.chunks(BATCH_SIZE).enumerate() {
        emit(index as u32, total_batches);
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
                "content": serde_json::to_string(&payload).unwrap_or_default()
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

        let text = value
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
            .unwrap_or_default();

        let parsed = extract_json_object(&text)
            .ok_or_else(|| "Réponse de l'IA sans objet JSON exploitable".to_string())?;
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
    }

    emit(total_batches, total_batches);
    Ok(labels)
}

fn build_system_prompt(o: &OnboardingAnswers) -> String {
    let categories = if o.categories.is_empty() {
        "Factures & reçus, Banque & finance, Shopping & livraisons, Voyages & réservations, Réseaux sociaux, Newsletters, Sécurité & comptes, Administratif, Travail".to_string()
    } else {
        o.categories.join(", ")
    };
    let granularity = if o.granularity == "fin" {
        "Ajoute un sous-libellé précis quand c'est pertinent, au format « Catégorie/Sous-libellé » (ex. « Voyages & réservations/SNCF », « Dev & outils/GitHub »)."
    } else {
        "Reste au premier niveau : un seul libellé par expéditeur, sans sous-libellé."
    };
    let usage = match o.usage.as_str() {
        "pro" => "professionnel",
        "perso" => "personnel",
        _ => "mixte (personnel et professionnel)",
    };
    let notes = if o.notes.trim().is_empty() {
        String::new()
    } else {
        format!("\nPrécisions de l'utilisateur : {}", o.notes.trim())
    };

    format!(
        "Tu es le moteur de classement de Rangemail, une application qui range les boîtes mail.\n\
        On te fournit un tableau JSON d'expéditeurs. Pour CHAQUE expéditeur, choisis le libellé de classement le plus utile.\n\n\
        Règles :\n\
        - Réponds UNIQUEMENT avec un objet JSON, sans aucun texte autour : {{\"<cle>\": \"<libellé>\", ...}} — une entrée par clé fournie, exactement les clés reçues.\n\
        - Libellés en français, courts (1 à 3 mots), sans emoji.\n\
        - Utilise en priorité ces catégories comme premier niveau : {categories}.\n\
        - {granularity}\n\
        - « Newsletters » pour les lettres d'information sans meilleure catégorie ; « Notifications » pour les mails automatiques sans valeur de classement.\n\
        - Ne dépasse pas 25 libellés de premier niveau distincts au total.\n\n\
        Profil : usage {usage} de cette boîte.{notes}"
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
