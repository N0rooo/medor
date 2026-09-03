use super::ImapSession;
use crate::types::ScanProgress;
use std::sync::atomic::{AtomicBool, Ordering};
use mailparse::MailHeaderMap;

const FETCH_CHUNK: usize = 300;

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

/// `scope` : "tous" (tout), "lus" (SEEN) ou "nonlus" (UNSEEN).
/// `max_messages` : plafond par analyse (0 = sans limite), les plus récents d'abord.
pub fn scan_inbox(
    session: &mut ImapSession,
    horizon_months: u32,
    scope: &str,
    max_messages: u32,
    cancel: &AtomicBool,
    emit: &dyn Fn(ScanProgress),
) -> Result<(Vec<ScannedMessage>, u32), String> {
    let mailbox = session
        .select("INBOX")
        .map_err(|e| format!("Impossible d'ouvrir la boîte de réception : {e}"))?;
    let inbox_total = mailbox.exists;

    emit(ScanProgress {
        phase: "liste".into(),
        done: 0,
        total: inbox_total,
        note: None,
    });

    let mut criteres: Vec<String> = Vec::new();
    match scope {
        "lus" => criteres.push("SEEN".into()),
        "nonlus" => criteres.push("UNSEEN".into()),
        _ => {}
    }
    if horizon_months > 0 {
        let since = chrono::Utc::now() - chrono::Duration::days(horizon_months as i64 * 30);
        // Le format de date IMAP exige des mois en anglais abrégé (%b de chrono).
        criteres.push(format!("SINCE {}", since.format("%d-%b-%Y")));
    }
    let query = if criteres.is_empty() {
        "ALL".to_string()
    } else {
        criteres.join(" ")
    };

    let mut uids: Vec<u32> = session
        .uid_search(&query)
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

    let total = uids.len() as u32;
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

        for fetch in fetches.iter() {
            let Some(uid) = fetch.uid else { continue };
            let seen = fetch
                .flags()
                .iter()
                .any(|f| matches!(f, imap::types::Flag::Seen));
            let header_bytes = fetch.header().unwrap_or(b"");
            let parsed = mailparse::parse_headers(header_bytes);
            let (from_name, from_addr, subject, date_ts, list_unsub, one_click, has_list_id, bulk) =
                match parsed {
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
                continue;
            }

            messages.push(ScannedMessage {
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
            });
        }

        emit(ScanProgress {
            phase: "lecture".into(),
            done: messages.len() as u32,
            total,
            note: None,
        });
    }

    Ok((messages, inbox_total))
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
