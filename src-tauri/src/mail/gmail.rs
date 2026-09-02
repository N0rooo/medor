//! Petites opérations via l'API REST Gmail (couleurs de libellés), avec le
//! même jeton OAuth que l'IMAP. Gmail n'accepte que des couleurs issues de sa
//! palette officielle : la palette ci-dessous n'utilise que des valeurs
//! autorisées.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const LABELS_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/labels";

/// (fond, texte) — uniquement des couleurs de la palette autorisée par Gmail.
const PALETTE: [(&str, &str); 12] = [
    ("#fb4c2f", "#ffffff"),
    ("#ffad47", "#ffffff"),
    ("#fad165", "#000000"),
    ("#16a766", "#ffffff"),
    ("#43d692", "#000000"),
    ("#4a86e8", "#ffffff"),
    ("#285bac", "#ffffff"),
    ("#a479e2", "#ffffff"),
    ("#f691b3", "#000000"),
    ("#e66550", "#ffffff"),
    ("#999999", "#ffffff"),
    ("#2da2bb", "#ffffff"),
];

/// Applique une couleur à chaque libellé de premier niveau donné (et à tous
/// ses sous-libellés). `colors` : nom de premier niveau -> couleur de fond.
/// Renvoie la liste des erreurs rencontrées (non bloquantes).
pub fn apply_label_colors(token: &str, colors: &HashMap<String, String>) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return vec![format!("Couleurs : client HTTP indisponible ({e})")],
    };

    let labels: Vec<Value> = match client.get(LABELS_URL).bearer_auth(token).send() {
        Ok(resp) if resp.status().is_success() => resp
            .json::<Value>()
            .ok()
            .and_then(|v| v.get("labels").and_then(|l| l.as_array()).cloned())
            .unwrap_or_default(),
        Ok(resp) => {
            return vec![format!("Couleurs : l'API Gmail a répondu {}", resp.status())];
        }
        Err(e) => return vec![format!("Couleurs : appel à l'API Gmail impossible ({e})")],
    };

    for (top, bg) in colors {
        let text = PALETTE
            .iter()
            .find(|(fond, _)| fond.eq_ignore_ascii_case(bg))
            .map(|(_, texte)| *texte)
            .unwrap_or("#ffffff");
        for label in &labels {
            let Some(name) = label.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            if name != top && !name.starts_with(&format!("{top}/")) {
                continue;
            }
            let Some(id) = label.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let body = json!({"color": {"backgroundColor": bg, "textColor": text}});
            match client
                .patch(format!("{LABELS_URL}/{id}"))
                .bearer_auth(token)
                .json(&body)
                .send()
            {
                Ok(resp) if resp.status().is_success() => {}
                Ok(resp) => errors.push(format!("Couleur de « {name} » refusée ({})", resp.status())),
                Err(e) => errors.push(format!("Couleur de « {name} » : {e}")),
            }
        }
    }
    errors
}
