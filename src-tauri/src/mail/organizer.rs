use super::classify::GroupUids;
use super::utf7;
use super::ImapSession;
use crate::types::{ApplyProgress, ApplyResult, ApplySelection, DeleteLabelsResult, RestoreResult};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};

const MOVE_CHUNK: usize = 400;

/// Applique le plan de rangement : crée les libellés (dossiers IMAP), archive
/// les mails lus dedans, et déplace les expéditeurs indésirables vers le spam.
pub fn apply(
    session: &mut ImapSession,
    uids: &HashMap<String, GroupUids>,
    selection: &ApplySelection,
    cancel: &AtomicBool,
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
        if cancel.load(Ordering::Relaxed) {
            result.errors.push("Opération annulée en cours de route.".into());
            return Ok(result);
        }
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
            if cancel.load(Ordering::Relaxed) {
                result.errors.push("Opération annulée en cours de route.".into());
                return Ok(result);
            }
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
            if cancel.load(Ordering::Relaxed) {
                result.errors.push("Opération annulée en cours de route.".into());
                return Ok(result);
            }
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
const DOSSIERS_PROTEGES: [&str; 27] = [
    "inbox", "sent", "sent items", "sent messages", "drafts", "draft", "junk", "junk email",
    "spam", "trash", "deleted messages", "deleted items", "deleted", "archive", "notes",
    "outbox", "all mail", "clutter", "conversation history", "rss feeds", "rss",
    "éléments envoyés", "éléments supprimés", "courrier indésirable", "brouillons",
    "boîte d'envoi", "historique des conversations",
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
    emit: &dyn Fn(u32, u32),
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
                let lower = super::utf7::decode(wire).to_lowercase();
                if lower == "inbox" || lower.starts_with("[gmail]") || lower.starts_with("[google mail]") {
                    return false;
                }
                let racine = lower
                    .split(delimiter.as_str())
                    .next()
                    .unwrap_or(&lower)
                    .to_string();
                let dernier = lower
                    .rsplit(delimiter.as_str())
                    .next()
                    .unwrap_or(&lower)
                    .to_string();
                !(DOSSIERS_PROTEGES.contains(&racine.as_str())
                    || DOSSIERS_PROTEGES.contains(&dernier.as_str()))
            })
            .cloned()
            .collect(),
    };

    // Enfants avant parents : on ne peut pas supprimer un dossier qui a
    // encore des sous-dossiers sur certains serveurs.
    candidates.sort_by_key(|n| std::cmp::Reverse((n.matches(delimiter.as_str()).count(), n.len())));

    let total_candidats = candidates.len() as u32;
    for (index, wire) in candidates.into_iter().enumerate() {
        emit(index as u32 + 1, total_candidats);
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

/// Annule un rangement : remet dans la boîte de réception TOUS les mails des
/// dossiers listés (ceux créés par Médor), puis supprime ces dossiers vides.
/// Rien n'est jamais supprimé côté mails.
pub fn restore_to_inbox(
    session: &mut ImapSession,
    folders_display: Option<Vec<String>>,
    emit: &dyn Fn(u32, u32),
) -> Result<RestoreResult, String> {
    let mut result = RestoreResult::default();

    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Impossible de lister les dossiers : {e}"))?;
    let mut delimiter = "/".to_string();
    let mut server_wires: Vec<String> = Vec::new();
    for name in names.iter() {
        if let Some(d) = name.delimiter() {
            if !d.is_empty() {
                delimiter = d.to_string();
            }
        }
        let noselect = name
            .attributes()
            .iter()
            .any(|a| matches!(a, imap::types::NameAttribute::NoSelect));
        if !noselect {
            server_wires.push(name.name().to_string());
        }
    }
    drop(names);

    // Sans liste fournie (suivi perdu : ancienne version, compte reconnecté…),
    // on balaie TOUT le serveur sauf la boîte de réception et les dossiers
    // système — c'est le sens du bouton « Tout remettre en boîte de réception ».
    let liste: Vec<String> = match folders_display {
        Some(list) => list,
        None => server_wires
            .iter()
            .filter_map(|wire| {
                let display = super::utf7::decode(wire);
                let lower = display.to_lowercase();
                if lower == "inbox"
                    || lower.starts_with("[gmail]")
                    || lower.starts_with("[google mail]")
                {
                    return None;
                }
                let racine = lower
                    .split(delimiter.as_str())
                    .next()
                    .unwrap_or(&lower)
                    .to_string();
                let dernier = lower
                    .rsplit(delimiter.as_str())
                    .next()
                    .unwrap_or(&lower)
                    .to_string();
                if DOSSIERS_PROTEGES.contains(&racine.as_str())
                    || DOSSIERS_PROTEGES.contains(&dernier.as_str())
                {
                    return None;
                }
                Some(display.replace(delimiter.as_str(), "/"))
            })
            .collect(),
    };

    // Les plus profonds d'abord : on vide et supprime les enfants avant les parents.
    let mut folders: Vec<String> = liste;
    folders.sort_by_key(|n| std::cmp::Reverse(n.matches('/').count()));

    // Pré-inventaire : total réel de mails à ramener, pour une progression
    // honnête (en mails, pas en dossiers).
    let mut par_dossier: Vec<(String, String, u32)> = Vec::new();
    let mut total_mails: u32 = 0;
    for display in folders.iter() {
        let wire = utf7::encode(&display.replace('/', &delimiter));
        let compte = session.select(&wire).map(|mb| mb.exists).unwrap_or(0);
        total_mails += compte;
        par_dossier.push((display.clone(), wire, compte));
    }
    emit(0, total_mails);

    let mut done: u32 = 0;
    for (display, wire, attendu) in par_dossier {
        if attendu > 0 {
            match session.select(&wire) {
                Ok(_) => {
                    let mut uids: Vec<u32> = match session.uid_search("ALL") {
                        Ok(set) => set.into_iter().collect(),
                        Err(e) => {
                            result.errors.push(format!("« {display} » : {e}"));
                            continue;
                        }
                    };
                    uids.sort_unstable();
                    for chunk in uids.chunks(MOVE_CHUNK) {
                        let set = chunk
                            .iter()
                            .map(|u| u.to_string())
                            .collect::<Vec<_>>()
                            .join(",");
                        match move_uids(session, &set, "INBOX") {
                            Ok(()) => result.restored += chunk.len() as u32,
                            Err(e) => result
                                .errors
                                .push(format!("Retour depuis « {display} » : {e}")),
                        }
                        done += chunk.len() as u32;
                        emit(done.min(total_mails), total_mails);
                    }
                }
                Err(_) => continue, // dossier déjà absent : rien à faire
            }
        }

        // On ne peut pas supprimer un dossier sélectionné : on repasse sur INBOX.
        let _ = session.select("INBOX");
        match session.delete(&wire) {
            Ok(()) => result.folders_deleted += 1,
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                if !msg.contains("exist") {
                    result
                        .errors
                        .push(format!("Suppression de « {display} » : {e}"));
                }
            }
        }
    }

    Ok(result)
}

/// Dossiers « rangés » du compte : tous les dossiers sélectionnables, sauf la
/// boîte de réception et les dossiers système (FR/EN).
pub fn dossiers_ranges(session: &mut ImapSession) -> Result<(Vec<String>, String), String> {
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Impossible de lister les dossiers : {e}"))?;
    let mut delimiter = "/".to_string();
    let mut wires: Vec<String> = Vec::new();
    for name in names.iter() {
        if let Some(d) = name.delimiter() {
            if !d.is_empty() {
                delimiter = d.to_string();
            }
        }
        let noselect = name
            .attributes()
            .iter()
            .any(|a| matches!(a, imap::types::NameAttribute::NoSelect));
        if !noselect {
            wires.push(name.name().to_string());
        }
    }
    drop(names);
    let filtres = wires
        .into_iter()
        .filter(|wire| {
            let lower = super::utf7::decode(wire).to_lowercase();
            if lower == "inbox"
                || lower.starts_with("[gmail]")
                || lower.starts_with("[google mail]")
            {
                return false;
            }
            let racine = lower
                .split(delimiter.as_str())
                .next()
                .unwrap_or(&lower)
                .to_string();
            let dernier = lower
                .rsplit(delimiter.as_str())
                .next()
                .unwrap_or(&lower)
                .to_string();
            !(DOSSIERS_PROTEGES.contains(&racine.as_str())
                || DOSSIERS_PROTEGES.contains(&dernier.as_str()))
        })
        .collect();
    Ok((filtres, delimiter))
}

/// Met à la corbeille TOUT le contenu d'un dossier (nom affiché, « / »),
/// puis supprime le dossier lui-même (sauf s'il garde des sous-dossiers :
/// certains serveurs refusent, on le laisse alors en place).
/// Renvoie (mails déplacés, dossier supprimé ?).
pub fn trash_folder_content(
    session: &mut ImapSession,
    folder_display: &str,
    cancel: &AtomicBool,
    emit: &dyn Fn(u32, u32),
) -> Result<(u32, bool), String> {
    let (trash, delimiter) = dossier_corbeille(session)?;
    let wire = super::utf7::encode(&folder_display.replace('/', &delimiter));
    session
        .select(&wire)
        .map_err(|e| format!("Dossier « {folder_display} » inaccessible : {e}"))?;
    let mut uids: Vec<u32> = session
        .uid_search("ALL")
        .map_err(|e| format!("Recherche impossible : {e}"))?
        .into_iter()
        .collect();
    uids.sort_unstable();
    let total = uids.len() as u32;
    emit(0, total);
    let mut count: u32 = 0;
    for chunk in uids.chunks(MOVE_CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            // Annulé en route : le dossier garde ses mails restants.
            return Ok((count, false));
        }
        let set = chunk
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        if move_uids(session, &set, &trash).is_ok() {
            count += chunk.len() as u32;
        }
        emit(count.min(total), total);
    }

    // Supprimer le dossier vidé (impossible tant qu'il est sélectionné).
    let _ = session.select("INBOX");
    let deleted = session.delete(&wire).is_ok();
    Ok((count, deleted))
}

/// Trouve la corbeille du compte et le délimiteur de dossiers.
fn dossier_corbeille(session: &mut ImapSession) -> Result<(String, String), String> {
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Impossible de lister les dossiers : {e}"))?;
    let mut delimiter = "/".to_string();
    let mut trash: Option<String> = None;
    for name in names.iter() {
        if let Some(d) = name.delimiter() {
            if !d.is_empty() {
                delimiter = d.to_string();
            }
        }
        let special = name.attributes().iter().any(|a| {
            matches!(a, imap::types::NameAttribute::Custom(c) if c.eq_ignore_ascii_case("\\Trash"))
        });
        if special {
            trash = Some(name.name().to_string());
            break;
        }
        if trash.is_none() {
            let lower = super::utf7::decode(name.name()).to_lowercase();
            if lower.contains("trash") || lower.contains("corbeille") || lower.contains("deleted") {
                trash = Some(name.name().to_string());
            }
        }
    }
    let trash = trash.ok_or("Corbeille introuvable sur ce compte.")?;
    Ok((trash, delimiter))
}

/// Met à la corbeille TOUS les mails d'expéditeurs donnés, où qu'ils soient :
/// cherche par adresse (FROM) dans la boîte de réception ET dans le libellé où
/// Médor les a rangés — fonctionne donc aussi APRÈS un rangement.
pub fn trash_senders_by_address(
    session: &mut ImapSession,
    cibles: &[(String, Option<String>)],
    cancel: &AtomicBool,
    emit: &dyn Fn(u32, u32, bool),
) -> Result<u32, String> {
    let (trash, delimiter) = dossier_corbeille(session)?;

    // Chaque adresse n'est cherchée que là où elle peut être : son propre
    // dossier de rangement — plus la boîte de réception pour tout le monde.
    // (Chercher toutes les adresses dans tous les dossiers était quadratique :
    // des milliers de commandes IMAP et des minutes de silence.)
    let toutes: Vec<String> = cibles.iter().map(|(a, _)| a.clone()).collect();
    let mut par_dossier: Vec<(String, Vec<String>)> = vec![("INBOX".to_string(), toutes)];
    let mut index: HashMap<String, usize> = HashMap::new();
    for (adresse, label) in cibles {
        if let Some(label) = label {
            let wire = super::utf7::encode(&label.replace('/', &delimiter));
            let i = *index.entry(wire.clone()).or_insert_with(|| {
                par_dossier.push((wire, Vec::new()));
                par_dossier.len() - 1
            });
            par_dossier[i].1.push(adresse.clone());
        }
    }

    // Pré-inventaire, avec progression (en dossiers) et annulation.
    let total_dossiers = par_dossier.len() as u32;
    let mut travaux: Vec<(String, Vec<u32>)> = Vec::new();
    let mut total: u32 = 0;
    for (i, (dossier, adresses)) in par_dossier.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(0);
        }
        emit(i as u32, total_dossiers, true);
        if session.select(dossier).is_err() {
            continue;
        }
        let mut uids: Vec<u32> = Vec::new();
        for adresse in adresses {
            if let Ok(set) = session.uid_search(format!("FROM \"{}\"", adresse.replace('"', ""))) {
                uids.extend(set);
            }
        }
        uids.sort_unstable();
        uids.dedup();
        total += uids.len() as u32;
        if !uids.is_empty() {
            travaux.push((dossier.clone(), uids));
        }
    }
    emit(0, total, false);

    let mut count: u32 = 0;
    for (dossier, uids) in travaux {
        if session.select(&dossier).is_err() {
            continue;
        }
        for chunk in uids.chunks(MOVE_CHUNK) {
            if cancel.load(Ordering::Relaxed) {
                return Ok(count);
            }
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            if move_uids(session, &set, &trash).is_ok() {
                count += chunk.len() as u32;
            }
            emit(count.min(total), total, false);
        }
    }
    Ok(count)
}

/// Met à la corbeille du compte tous les messages donnés (récupérables
/// depuis la corbeille — rien n'est détruit immédiatement).
pub fn trash_uids(
    session: &mut ImapSession,
    uids: &[u32],
    cancel: &AtomicBool,
    emit: &dyn Fn(u32, u32),
) -> Result<u32, String> {
    let (trash, _) = dossier_corbeille(session)?;

    session
        .select("INBOX")
        .map_err(|e| format!("Impossible d'ouvrir la boîte de réception : {e}"))?;

    let total = uids.len() as u32;
    let mut count: u32 = 0;
    for chunk in uids.chunks(MOVE_CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            return Ok(count);
        }
        let set = chunk
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        move_uids(session, &set, &trash)?;
        count += chunk.len() as u32;
        emit(count, total);
    }
    Ok(count)
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
