use super::classify::GroupUids;
use super::ImapSession;
use crate::types::{ApplyProgress, ApplyResult, ApplySelection};
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

    // Volume total pour la progression.
    let mut total_ops: u32 = 0;
    for label in &selection.labels {
        for key in &label.sender_keys {
            if let Some(g) = uids.get(key) {
                total_ops += g.read.len() as u32;
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

    // 1) Archiver les mails lus dans leurs libellés.
    for label in &selection.labels {
        let path = label.name.replace('/', &delimiter);
        if !existing.contains(&path.to_lowercase()) {
            match session.create(&path) {
                Ok(()) => {
                    existing.insert(path.to_lowercase());
                    result.labels_created += 1;
                }
                Err(e) => {
                    let msg = e.to_string().to_lowercase();
                    // Certains serveurs répondent une erreur si le dossier existe déjà.
                    if msg.contains("exist") {
                        existing.insert(path.to_lowercase());
                    } else {
                        result
                            .errors
                            .push(format!("Création du libellé « {} » impossible : {e}", label.name));
                        continue;
                    }
                }
            }
        }

        let mut to_move: Vec<u32> = Vec::new();
        for key in &label.sender_keys {
            if let Some(g) = uids.get(key) {
                to_move.extend(&g.read);
            }
        }

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
                let p = "Indésirables".to_string();
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
