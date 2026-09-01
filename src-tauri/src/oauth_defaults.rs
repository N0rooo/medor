//! Identifiants OAuth embarqués dans l'application.
//!
//! À renseigner UNE FOIS par le mainteneur de l'app (voir README, section
//! « Intégrer les identifiants OAuth ») : ensuite, les utilisateurs cliquent
//! simplement sur « Se connecter avec Google / Microsoft », sans rien
//! configurer. C'est le fonctionnement standard des clients mail de bureau
//! (le « secret » d'un client OAuth d'application installée n'est pas
//! confidentiel au sens strict — Google le documente ainsi).
//!
//! Trois façons de les fournir (sans jamais commiter de secret) :
//! 1. Fichier local NON VERSIONNÉ `src-tauri/oauth.local.json` (recommandé,
//!    voir `oauth.local.json.example`) — lu par `build.rs` à la compilation ;
//! 2. Variables d'environnement à la compilation :
//!    `RANGEMAIL_GOOGLE_CLIENT_ID`, `RANGEMAIL_GOOGLE_CLIENT_SECRET`,
//!    `RANGEMAIL_MS_CLIENT_ID` ;
//! 3. Ou en remplaçant directement les chaînes vides ci-dessous (uniquement
//!    si votre fork reste privé).
//!
//! Les valeurs saisies dans « Réglages avancés » de l'app priment toujours
//! sur celles embarquées ici.

pub const GOOGLE_CLIENT_ID: &str = match option_env!("RANGEMAIL_GOOGLE_CLIENT_ID") {
    Some(v) => v,
    None => "",
};

pub const GOOGLE_CLIENT_SECRET: &str = match option_env!("RANGEMAIL_GOOGLE_CLIENT_SECRET") {
    Some(v) => v,
    None => "",
};

pub const MS_CLIENT_ID: &str = match option_env!("RANGEMAIL_MS_CLIENT_ID") {
    Some(v) => v,
    None => "",
};
