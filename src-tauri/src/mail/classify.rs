use super::scanner::ScannedMessage;
use crate::types::{ApercuMail, SenderGroup};
use std::collections::HashMap;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct GroupUids {
    pub read: Vec<u32>,
    pub all: Vec<u32>,
    /// Aperçu des mails de l'expéditeur (sujets + dates), pour l'inspection
    /// avant d'agir. Conservé côté cache seulement.
    pub apercu: Vec<ApercuMail>,
}

/// Règles de classement par domaine d'expéditeur.
const DOMAIN_RULES: &[(&[&str], &str)] = &[
    (
        &[
            "facebook", "instagram", "twitter", "x.com", "linkedin", "tiktok", "pinterest",
            "reddit", "discord", "snapchat", "threads", "strava", "twitch",
        ],
        "Réseaux sociaux",
    ),
    (
        &[
            "github", "gitlab", "bitbucket", "vercel", "netlify", "npmjs", "docker",
            "atlassian", "jira", "slack", "notion", "figma", "supabase", "heroku",
            "digitalocean", "cloudflare", "anthropic", "openai", "jetbrains", "expo.dev",
            "sentry", "linear.app", "railway",
        ],
        "Dev/Outils",
    ),
    (
        &[
            "booking", "airbnb", "sncf", "ouigo", "airfrance", "easyjet", "ryanair",
            "transavia", "uber", "bolt.eu", "blablacar", "trainline", "hotels.com",
            "expedia", "kayak", "abritel", "gites-de-france", "flixbus",
        ],
        "Voyages",
    ),
    (
        &[
            "amazon", "cdiscount", "fnac", "darty", "zalando", "aliexpress", "shein",
            "vinted", "leboncoin", "ebay", "etsy", "temu", "rakuten", "veepee",
            "laredoute", "decathlon", "ikea", "leroymerlin", "backmarket",
        ],
        "Shopping",
    ),
    (
        &[
            "paypal", "revolut", "n26", "boursorama", "fortuneo", "credit-agricole",
            "creditagricole", "bnpparibas", "societegenerale", "caisse-epargne", "lcl.fr",
            "banquepopulaire", "lydia", "sumeria", "qonto", "wise.com", "creditmutuel",
            "hellobank", "shine.fr", "stripe.com", "binance", "coinbase", "tradere",
        ],
        "Finances/Banque",
    ),
    (
        &[
            "impots.gouv", "dgfip", "ameli", "caf.fr", "urssaf", "pole-emploi",
            "francetravail", "service-public", "edf", "engie", "totalenergies", "veolia",
            "suez", "orange.fr", "sfr", "bouyguestelecom", "sosh", "assurance",
            "harmonie-mutuelle", "maif", "macif", "matmut", "axa", "groupama",
        ],
        "Administratif",
    ),
    (
        &["indeed", "welcometothejungle", "jobteaser", "apec.fr", "hellowork", "monster"],
        "Travail",
    ),
];

/// Règles de classement par mots du sujet (appliquées si le domaine n'a rien donné).
const SUBJECT_RULES: &[(&[&str], &str)] = &[
    (
        &[
            "code de vérification", "verification code", "code de sécurité", "security code",
            "alerte de sécurité", "security alert", "mot de passe", "password",
            "nouvelle connexion", "new sign-in", "sign in", "code de connexion",
            "confirmez votre adresse", "confirm your email", "vérifiez votre",
            "two-factor", "2fa", "authentification",
        ],
        "Sécurité/Comptes",
    ),
    (
        &[
            "facture", "invoice", "reçu de", "receipt", "paiement", "payment",
            "prélèvement", "quittance", "échéance", "relevé", "abonnement", "renouvellement",
        ],
        "Factures",
    ),
    (
        &[
            "commande", "order", "expédié", "shipped", "livraison", "delivery", "colis",
            "parcel", "suivi de", "tracking",
        ],
        "Shopping",
    ),
    (
        &[
            "réservation", "booking confirm", "billet", "ticket", "itinéraire", "boarding",
            "embarquement", "check-in", "séjour",
        ],
        "Voyages",
    ),
    (
        &["virement", "solde", "compte bancaire", "carte bancaire", "remboursement"],
        "Finances/Banque",
    ),
];

const SPAM_SUBJECT_HINTS: &[&str] = &[
    "gagné", "gagnez", "félicitations", "urgent", "offre exclusive", "100% gratuit",
    "cash", "crypto gratuite", "miracle", "élargissez", "hot ", "xxx", "casino",
    "jackpot", "prêt immédiat", "richesse",
];

/// Volume minimal d'un expéditeur pour mériter son propre sous-dossier.
const MIN_POUR_SOUS_LIBELLE: u32 = 3;

pub fn build_groups(
    messages: &[ScannedMessage],
    sous_libelles: bool,
) -> (Vec<SenderGroup>, HashMap<String, GroupUids>) {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, SenderGroup> = HashMap::new();
    let mut uids: HashMap<String, GroupUids> = HashMap::new();
    let mut newsletter_hits: HashMap<String, u32> = HashMap::new();
    let mut last_ts: HashMap<String, i64> = HashMap::new();

    for msg in messages {
        let key = msg.from_addr.clone();
        let entry = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            SenderGroup {
                key: key.clone(),
                name: String::new(),
                address: msg.from_addr.clone(),
                domain: msg.from_addr.split('@').nth(1).unwrap_or("").to_string(),
                total: 0,
                read: 0,
                unread: 0,
                last_date: String::new(),
                is_newsletter: false,
                one_click: false,
                unsubscribe_http: None,
                unsubscribe_mailto: None,
                sample_subjects: Vec::new(),
                label: String::new(),
                spam_suspect: false,
                last_ts: 0,
                unsubscribed_at: None,
                still_mailing: false,
            }
        });

        entry.total += 1;
        if msg.seen {
            entry.read += 1;
        } else {
            entry.unread += 1;
        }
        if entry.name.is_empty() && !msg.from_name.is_empty() {
            entry.name = msg.from_name.clone();
        }
        if entry.sample_subjects.len() < 5 && !msg.subject.trim().is_empty() {
            entry.sample_subjects.push(msg.subject.trim().to_string());
        }
        if msg.list_unsubscribe.is_some() || msg.has_list_id || msg.precedence_bulk {
            *newsletter_hits.entry(key.clone()).or_default() += 1;
        }
        if msg.one_click {
            entry.one_click = true;
        }
        if let Some(raw) = &msg.list_unsubscribe {
            let (http, mailto) = parse_unsubscribe(raw);
            if entry.unsubscribe_http.is_none() {
                entry.unsubscribe_http = http;
            }
            if entry.unsubscribe_mailto.is_none() {
                entry.unsubscribe_mailto = mailto;
            }
        }
        let ts = last_ts.entry(key.clone()).or_insert(0);
        if msg.date_ts > *ts {
            *ts = msg.date_ts;
        }

        let group_uids = uids.entry(key.clone()).or_default();
        group_uids.all.push(msg.uid);
        if msg.seen {
            group_uids.read.push(msg.uid);
        }
        if group_uids.apercu.len() < 60 {
            group_uids.apercu.push(ApercuMail {
                subject: msg.subject.trim().to_string(),
                date: if msg.date_ts > 0 {
                    chrono::DateTime::from_timestamp(msg.date_ts, 0)
                        .map(|d| d.format("%d/%m/%Y").to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                },
                seen: msg.seen,
                from: String::new(),
            });
        }
    }

    let mut result: Vec<SenderGroup> = Vec::with_capacity(order.len());
    for key in order {
        let mut group = groups.remove(&key).unwrap();
        let hits = newsletter_hits.get(&key).copied().unwrap_or(0);
        group.is_newsletter = hits > 0 && hits * 2 >= group.total;
        if let Some(ts) = last_ts.get(&key) {
            if *ts > 0 {
                group.last_ts = *ts;
                group.last_date = chrono::DateTime::from_timestamp(*ts, 0)
                    .map(|d| d.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
            }
        }
        if group.name.is_empty() {
            group.name = group.address.split('@').next().unwrap_or("").to_string();
        }
        group.label = heuristic_label(&group, sous_libelles);
        group.spam_suspect = spam_suspect(&group);
        result.push(group);
    }

    result.sort_by(|a, b| b.total.cmp(&a.total));
    (result, uids)
}

fn parse_unsubscribe(raw: &str) -> (Option<String>, Option<String>) {
    let mut http = None;
    let mut mailto = None;
    for part in raw.split(',') {
        let trimmed = part.trim().trim_start_matches('<').trim_end_matches('>');
        if trimmed.starts_with("http") && http.is_none() {
            http = Some(trimmed.to_string());
        } else if trimmed.starts_with("mailto:") && mailto.is_none() {
            mailto = Some(trimmed.to_string());
        }
    }
    (http, mailto)
}

/// Nom de « marque » lisible tiré du domaine, pour nommer un sous-dossier
/// (ex. `mail.amazon.fr` → « Amazon », `impots.gouv.fr` → « Impots »).
fn brand_from_domain(domain: &str) -> Option<String> {
    let parts: Vec<&str> = domain.split('.').filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    // Suffixes intermédiaires sans valeur de marque (impots.gouv.fr, foo.co.uk…).
    const SUFFIXES: [&str; 5] = ["gouv", "co", "com", "asso", "org"];
    let mut idx = parts.len() - 2;
    if SUFFIXES.contains(&parts[idx]) && idx > 0 {
        idx -= 1;
    }
    let raw = parts[idx];
    if raw.len() < 2 {
        return None;
    }
    let mut chars = raw.chars();
    let first = chars.next()?.to_uppercase().to_string();
    Some(format!("{first}{}", chars.as_str()))
}

/// Ajoute un sous-dossier « marque » au libellé si l'expéditeur a assez de volume.
fn with_brand(label: &str, group: &SenderGroup, sous_libelles: bool) -> String {
    if !sous_libelles || group.total < MIN_POUR_SOUS_LIBELLE {
        return label.to_string();
    }
    match brand_from_domain(&group.domain) {
        Some(brand) => format!("{label}/{brand}"),
        None => label.to_string(),
    }
}

/// Cohérence hiérarchique déterministe : si un thème existe quelque part comme
/// sous-catégorie (« Sport/Paris sportifs »), aucune RACINE du même nom ne doit
/// subsister — « Paris sportifs » et « Paris sportifs/Winamax » sont rabattus
/// sous « Sport/Paris sportifs ». S'applique après l'IA ET après la mémoire.
pub fn normaliser_hierarchie(groups: &mut [SenderGroup], existing_labels: &[String]) {
    use std::collections::HashMap as Map;
    // sous-catégorie (minuscule) -> "Racine/Sous-catégorie" canonique
    let mut sous_vers_chemin: Map<String, String> = Map::new();
    let mut racines: std::collections::HashSet<String> = std::collections::HashSet::new();
    let alimente = |label: &str,
                    sous: &mut Map<String, String>,
                    racines: &mut std::collections::HashSet<String>| {
        let segs: Vec<&str> = label.split('/').collect();
        racines.insert(segs[0].to_lowercase());
        if segs.len() >= 2 {
            sous.entry(segs[1].to_lowercase())
                .or_insert_with(|| format!("{}/{}", segs[0], segs[1]));
        }
    };
    for label in existing_labels {
        alimente(label, &mut sous_vers_chemin, &mut racines);
    }
    for group in groups.iter() {
        alimente(&group.label, &mut sous_vers_chemin, &mut racines);
    }

    for group in groups.iter_mut() {
        let segs: Vec<String> = group.label.split('/').map(|s| s.to_string()).collect();
        let racine_min = segs[0].to_lowercase();
        // La racine du libellé est connue ailleurs comme sous-catégorie ?
        if let Some(chemin) = sous_vers_chemin.get(&racine_min) {
            // Ne pas toucher aux libellés déjà bien placés (« Sport/… »).
            if !chemin.to_lowercase().starts_with(&format!("{racine_min}/"))
                && chemin.to_lowercase() != racine_min
            {
                group.label = match segs.len() {
                    1 => chemin.clone(),
                    2 => format!("{}/{}", chemin, segs[1]),
                    // 3 niveaux : on garde la marque, la sous-catégorie d'origine saute.
                    _ => format!("{}/{}", chemin, segs[2]),
                };
            }
        }
    }
}

pub fn heuristic_label(group: &SenderGroup, sous_libelles: bool) -> String {
    let domain = group.domain.to_lowercase();
    let address = group.address.to_lowercase();

    for (patterns, label) in DOMAIN_RULES {
        if patterns.iter().any(|p| domain.contains(p)) {
            return with_brand(label, group, sous_libelles);
        }
    }

    let subjects = group
        .sample_subjects
        .iter()
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>();
    let mut best: Option<(&str, usize)> = None;
    for (patterns, label) in SUBJECT_RULES {
        let hits = subjects
            .iter()
            .filter(|s| patterns.iter().any(|p| s.contains(p)))
            .count();
        if hits > 0 && best.map(|(_, b)| hits > b).unwrap_or(true) {
            best = Some((label, hits));
        }
    }
    if let Some((label, _)) = best {
        return with_brand(label, group, sous_libelles);
    }

    if group.is_newsletter {
        return with_brand("Newsletters", group, sous_libelles);
    }
    if address.starts_with("no-reply")
        || address.starts_with("noreply")
        || address.starts_with("notification")
        || address.starts_with("ne-pas-repondre")
    {
        return "Notifications".to_string();
    }
    // Pas de « À trier » : le solde va dans Autres, rangé par marque si possible.
    with_brand("Autres", group, sous_libelles)
}

fn spam_suspect(group: &SenderGroup) -> bool {
    // « Quasi jamais lu » : au moins 4 non-lus et un taux de lecture <= 10 %.
    let quasi_jamais_lu = group.unread >= 4 && group.read * 10 <= group.total;
    let hits = group
        .sample_subjects
        .iter()
        .filter(|s| {
            let lower = s.to_lowercase();
            SPAM_SUBJECT_HINTS.iter().any(|h| lower.contains(h))
        })
        .count();
    (quasi_jamais_lu && (group.is_newsletter || hits >= 1)) || (hits >= 2 && group.read == 0)
}
