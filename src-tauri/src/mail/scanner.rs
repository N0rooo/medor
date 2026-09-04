use super::ImapSession;
use crate::types::ScanProgress;
use std::sync::atomic::{AtomicBool, Ordering};
use mailparse::MailHeaderMap;

const FETCH_CHUNK: usize = 500;

#[derive(Clone, Debug)]
pub struct ScannedMessage {
    pub uid: u32,
    pub from_name: String,
    pub from_addr: String,
    pub subject: String,
    pub date_ts: i64,
    pub seen: bool,
    pub list_unsubscribe: Option<String>,
    pub one_click: bool,
    pub has_list_id: bool,
    pub precedence_bulk: bool,
}

/// Sélectionne INBOX et cherche les UIDs correspondant à la portée.
/// `max_messages` : plafond (0 = sans limite), les plus récents d'abord.
pub fn search_inbox(
    session: &mut ImapSession,
    scope: &str,
    max_messages: u32,
) -> Result<(Vec<u32>, u32), String> {
    let mailbox = session
        .select("INBOX")
        .map_err(|e| format!("Impossible d'ouvrir la boîte de réception : {e}"))?;
    let inbox_total = mailbox.exists;

    let query = match scope {
        "lus" => "SEEN",
        "nonlus" => "UNSEEN",
        _ => "ALL",
    };
    let mut uids: Vec<u32> = session
        .uid_search(query)
        .map_err(|e| format!("Recherche impossible : {e}"))?
        .into_iter()
        .collect();
    uids.sort_unstable();
    let plafond = if max_messages == 0 {
        usize::MAX
    } else {
        max_messages as usize
    };
    if uids.len() > plafond {
        uids = uids.split_off(uids.len() - plafond);
    }
    Ok((uids, inbox_total))
}

/// Lit les en-têtes des UIDs donnés (INBOX déjà sélectionnée) et signale la
/// progression via `progresse(nombre lu dans ce paquet)`. Utilisable en
/// parallèle sur plusieurs connexions.
pub fn fetch_headers(
    session: &mut ImapSession,
    uids: &[u32],
    cancel: &AtomicBool,
    progresse: &(dyn Fn(u32) + Sync),
) -> Result<Vec<ScannedMessage>, String> {
    let mut messages: Vec<ScannedMessage> = Vec::with_capacity(uids.len());
    for chunk in uids.chunks(FETCH_CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            return Err("Opération annulée.".into());
        }
        let set = chunk
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(&set, "(UID FLAGS RFC822.HEADER)")
            .map_err(|e| format!("Lecture des messages impossible : {e}"))?;
        let avant = messages.len();
        for fetch in fetches.iter() {
            if let Some(m) = message_depuis_fetch(fetch) {
                messages.push(m);
            }
        }
        progresse((messages.len() - avant).max(chunk.len().min(1)) as u32);
    }
    Ok(messages)
}

/// Transforme un FETCH (UID FLAGS RFC822.HEADER) en message analysé.
pub(crate) fn message_depuis_fetch(fetch: &imap::types::Fetch) -> Option<ScannedMessage> {
    let uid = fetch.uid?;
    let seen = fetch
        .flags()
        .iter()
        .any(|f| matches!(f, imap::types::Flag::Seen));
    let header_bytes = fetch.header().unwrap_or(b"");
    let (from_name, from_addr, subject, date_ts, list_unsub, one_click, has_list_id, bulk) =
        match mailparse::parse_headers(header_bytes) {
            Ok((headers, _)) => {
                let from_raw = headers.get_first_value("From").unwrap_or_default();
                let (name, addr) = parse_from(&from_raw);
                let subject = headers.get_first_value("Subject").unwrap_or_default();
                let date_ts = headers
                    .get_first_value("Date")
                    .and_then(|d| mailparse::dateparse(&d).ok())
                    .unwrap_or(0);
                let list_unsub = headers.get_first_value("List-Unsubscribe");
                let one_click = headers
                    .get_first_value("List-Unsubscribe-Post")
                    .map(|v| v.to_lowercase().contains("one-click"))
                    .unwrap_or(false);
                let has_list_id = headers.get_first_value("List-Id").is_some();
                let bulk = headers
                    .get_first_value("Precedence")
                    .map(|v| {
                        let v = v.to_lowercase();
                        v.contains("bulk") || v.contains("list")
                    })
                    .unwrap_or(false);
                (name, addr, subject, date_ts, list_unsub, one_click, has_list_id, bulk)
            }
            Err(_) => (
                String::new(),
                String::new(),
                String::new(),
                0,
                None,
                false,
                false,
                false,
            ),
        };
    if from_addr.is_empty() {
        return None;
    }
    Some(ScannedMessage {
        uid,
        from_name,
        from_addr,
        subject,
        date_ts,
        seen,
        list_unsubscribe: list_unsub,
        one_click,
        has_list_id,
        precedence_bulk: bulk,
    })
}

/// Lit les en-têtes des dossiers donnés (noms IMAP encodés), sans rien
/// déplacer — sert au ré-inventaire des mails déjà rangés.
pub fn scan_folders(
    session: &mut ImapSession,
    folders_wire: &[String],
    cancel: &AtomicBool,
    emit: &dyn Fn(ScanProgress),
) -> Result<Vec<ScannedMessage>, String> {
    // Pré-inventaire : total réel, pour une progression honnête.
    let mut travaux: Vec<(String, u32)> = Vec::new();
    let mut total: u32 = 0;
    for wire in folders_wire {
        if let Ok(mb) = session.select(wire) {
            if mb.exists > 0 {
                travaux.push((wire.clone(), mb.exists));
                total += mb.exists;
            }
        }
    }
    emit(ScanProgress {
        phase: "liste".into(),
        done: 0,
        total,
        note: None,
    });

    let mut messages: Vec<ScannedMessage> = Vec::new();
    for (wire, _) in travaux {
        if cancel.load(Ordering::Relaxed) {
            return Err("Opération annulée.".into());
        }
        if session.select(&wire).is_err() {
            continue;
        }
        let mut uids: Vec<u32> = match session.uid_search("ALL") {
            Ok(set) => set.into_iter().collect(),
            Err(_) => continue,
        };
        uids.sort_unstable();
        for chunk in uids.chunks(FETCH_CHUNK) {
            if cancel.load(Ordering::Relaxed) {
                return Err("Opération annulée.".into());
            }
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let fetches = session
                .uid_fetch(&set, "(UID FLAGS RFC822.HEADER)")
                .map_err(|e| format!("Lecture des messages impossible : {e}"))?;
            for fetch in fetches.iter() {
                if let Some(m) = message_depuis_fetch(fetch) {
                    messages.push(m);
                }
            }
            emit(ScanProgress {
                phase: "lecture".into(),
                done: (messages.len() as u32).min(total),
                total,
                note: None,
            });
        }
    }
    Ok(messages)
}

fn parse_from(raw: &str) -> (String, String) {
    match mailparse::addrparse(raw) {
        Ok(list) => {
            for addr in list.iter() {
                match addr {
                    mailparse::MailAddr::Single(info) => {
                        return (
                            info.display_name.clone().unwrap_or_default(),
                            info.addr.to_lowercase(),
                        )
                    }
                    mailparse::MailAddr::Group(group) => {
                        if let Some(info) = group.addrs.first() {
                            return (
                                info.display_name.clone().unwrap_or_default(),
                                info.addr.to_lowercase(),
                            );
                        }
                    }
                }
            }
            (String::new(), String::new())
        }
        Err(_) => {
            // Secours : extraire ce qui ressemble à une adresse.
            let cleaned = raw
                .split(|c| c == '<' || c == '>' || c == ' ' || c == ',')
                .find(|part| part.contains('@'))
                .unwrap_or("")
                .to_lowercase();
            (String::new(), cleaned)
        }
    }
}
