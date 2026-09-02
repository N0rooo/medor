use super::classify::GroupUids;
use super::utf7;
use super::ImapSession;
use crate::types::{ApplyProgress, ApplyResult, ApplySelection, DeleteLabelsResult};
use std::collections::{HashMap, HashSet};

const MOVE_CHUNK: usize = 200;

/// Applique le plan de rangement : crée les libellés (dossiers IMAP), archive
/// les mails lus dedans, et déplace les expéditeurs indésirables vers le spam.
pub fn apply(
    session: &mut ImapSession,
    uids: &HashMap<String, GroupUids>,
    selection: &ApplySelection,
    emit: &dyn Fn(ApplyProgress),
) -> Result<ApplyResult, String> {
    let mut result = ApplyResult::default();

    // Inventaire des dossiers existants + délimiteur hiérarchique du serveur.
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Impossible de lister les dossiers : {e}"))?;
    let mut existing: HashSet<String> = HashSet::new();
    let mut delimiter = "/".to_string();
    let mut junk_path: Option<String> = None;
    for name in names.iter() {
        existing.insert(name.name().to_lowercase());
        if let Some(d) = name.delimiter() {
            if !d.is_empty() {
                delimiter = d.to_string();
            }
        }
        let lower = name.name().to_lowercase();
        if junk_path.is_none() && (lower.contains("spam") || lower.contains("junk")) {
            junk_path = Some(name.name().to_string());
        }
    }

    // Volume total pour la progression. La portée (lus / non lus / tout) a déjà
    // été appliquée au moment de l'analyse : on range tout ce qui a été scanné.
    let mut total_ops: u32 = 0;
    for label in &selection.labels {
        for key in &label.sender_keys {
            if let Some(g) = uids.get(key) {
                total_ops += g.all.len() as u32;
            }
        }
    }
    for key in &selection.junk_sender_keys {
        if let Some(g) = uids.get(key) {
            total_ops += g.all.len() as u32;
        }
    }
    let mut done: u32 = 0;

    session
        .select("INBOX")
        .map_err(|e| format!("Impossible d'ouvrir la boîte de réception : {e}"))?;

    // 1) Archiver les mails dans leurs libellés.
    for label in &selection.labels {
        // Rassembler d'abord ce qu'il y a à déplacer : si rien, on ne crée
        // même pas le libellé — pas de dossier vide.
        let mut to_move: Vec<u32> = Vec::new();
        for key in &label.sender_keys {
            if let Some(g) = uids.get(key) {
                to_move.extend(&g.all);
            }
        }
        if to_move.is_empty() {
            continue;
        }

        let native = label.name.replace('/', &delimiter);

        // Créer TOUTE la hiérarchie, parents compris : Gmail n'affiche
        // « Parent → Enfant » que si le libellé parent nu existe aussi.
        // Les noms IMAP s'envoient en « UTF-7 modifié » (accents, &, etc.).
        let parts: Vec<&str> = native.split(delimiter.as_str()).collect();
        let mut prefix = String::new();
        let mut ok = true;
        for (i, part) in parts.iter().enumerate() {
            if i > 0 {
                prefix.push_str(&delimiter);
            }
            prefix.push_str(part);
            let wire = utf7::encode(&prefix);
            if existing.contains(&wire.to_lowercase()) {
                continue;
            }
            match session.create(&wire) {
                Ok(()) => {
                    existing.insert(wire.to_lowercase());
                    result.labels_created += 1;
                }
                Err(e) => {
                    let msg = e.to_string().to_lowercase();
                    // Certains serveurs répondent une erreur si le dossier existe déjà.
                    if msg.contains("exist") {
                        existing.insert(wire.to_lowercase());
                    } else {
                        result
                            .errors
                            .push(format!("Création du libellé « {prefix} » impossible : {e}"));
                        ok = false;
                        break;
                    }
                }
            }
        }
        if !ok {
            continue;
        }
        let path = utf7::encode(&native);

        for chunk in to_move.chunks(MOVE_CHUNK) {
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            match move_uids(session, &set, &path) {
                Ok(()) => {
                    result.archived += chunk.len() as u32;
                }
                Err(e) => {
                    result
                        .errors
                        .push(format!("Déplacement vers « {} » : {e}", label.name));
                }
            }
            done += chunk.len() as u32;
            emit(ApplyProgress {
                done,
                total: total_ops,
                label: label.name.clone(),
            });
        }
    }

    // 2) Déplacer les indésirables vers le dossier spam.
    if !selection.junk_sender_keys.is_empty() {
        let junk = match junk_path {
            Some(p) => p,
            None => {
                let p = utf7::encode("Indésirables");
                if !existing.contains(&p.to_lowercase()) {
                    if let Err(e) = session.create(&p) {
                        result
                            .errors
                            .push(format!("Création du dossier Indésirables impossible : {e}"));
                    }
                }
                p
            }
        };

        let mut to_junk: Vec<u32> = Vec::new();
        for key in &selection.junk_sender_keys {
            if let Some(g) = uids.get(key) {
                to_junk.extend(&g.all);
            }
        }
        for chunk in to_junk.chunks(MOVE_CHUNK) {
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            match move_uids(session, &set, &junk) {
                Ok(()) => {
                    result.junked += chunk.len() as u32;
                }
                Err(e) => {
                    result.errors.push(format!("Déplacement vers le spam : {e}"));
                }
            }
            done += chunk.len() as u32;
            emit(ApplyProgress {
                done,
                total: total_ops,
                label: "Indésirables".into(),
            });
        }
    }

    Ok(result)
}

/// Dossiers système qu'on ne supprime jamais, même en mode « tout supprimer ».
const DOSSIERS_PROTEGES: [&str; 15] = [
    "inbox", "sent", "sent messages", "drafts", "draft", "junk", "junk email", "spam", "trash",
    "deleted messages", "deleted", "archive", "notes", "outbox", "all mail",
];

/// Supprime des libellés/dossiers IMAP.
/// - `targets: Some(noms)` : supprime uniquement ces libellés (noms « affichés »,
///   avec `/` comme séparateur) — enfants d'abord, parents ensuite.
/// - `targets: None` : supprime TOUS les dossiers du compte sauf la boîte de
///   réception et les dossiers système ([Gmail]/…, Envoyés, Corbeille…).
/// Les mails ne sont pas supprimés : sur Gmail ils restent dans « Tous les messages ».
pub fn delete_labels(
    session: &mut ImapSession,
    targets: Option<Vec<String>>,
) -> Result<DeleteLabelsResult, String> {
    let mut result = DeleteLabelsResult::default();

    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Impossible de lister les dossiers : {e}"))?;
    let mut delimiter = "/".to_string();
    let mut server_names: Vec<String> = Vec::new();
    for name in names.iter() {
        if let Some(d) = name.delimiter() {
            if !d.is_empty() {
                delimiter = d.to_string();
            }
        }
        let has_noselect = name
            .attributes()
            .iter()
            .any(|a| matches!(a, imap::types::NameAttribute::NoSelect));
        if !has_noselect {
            server_names.push(name.name().to_string());
        }
    }

    let mut candidates: Vec<String> = match targets {
        Some(display_names) => display_names
            .iter()
            .map(|n| utf7::encode(&n.replace('/', &delimiter)))
            .collect(),
        None => server_names
            .iter()
            .filter(|wire| {
                let lower = wire.to_lowercase();
                if lower == "inbox" || lower.starts_with("[gmail]") || lower.starts_with("[google mail]") {
                    return false;
                }
                let dernier = lower
                    .rsplit(delimiter.as_str())
                    .next()
                    .unwrap_or(&lower)
                    .to_string();
                !DOSSIERS_PROTEGES.contains(&dernier.as_str())
            })
            .cloned()
            .collect(),
    };

    // Enfants avant parents : on ne peut pas supprimer un dossier qui a
    // encore des sous-dossiers sur certains serveurs.
    candidates.sort_by_key(|n| std::cmp::Reverse((n.matches(delimiter.as_str()).count(), n.len())));

    for wire in candidates {
        match session.delete(&wire) {
            Ok(()) => result.deleted += 1,
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                // Déjà supprimé / inexistant : rien à signaler.
                if !msg.contains("exist") {
                    result.errors.push(format!("« {wire} » : {e}"));
                }
            }
        }
    }
    Ok(result)
}

/// Déplace des messages ; utilise MOVE si le serveur le gère, sinon COPY + suppression.
fn move_uids(session: &mut ImapSession, uid_set: &str, target: &str) -> Result<(), String> {
    match session.uid_mv(uid_set, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            session
                .uid_copy(uid_set, target)
                .map_err(|e| e.to_string())?;
            session
                .uid_store(uid_set, "+FLAGS (\\Deleted)")
                .map_err(|e| e.to_string())?;
            session.expunge().map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}
