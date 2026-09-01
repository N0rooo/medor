mod commands;
mod mail;
mod oauth;
mod oauth_defaults;
mod store;
mod types;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::set_onboarding,
            commands::set_settings,
            commands::add_account,
            commands::remove_account,
            commands::google_connect,
            commands::ms_device_start,
            commands::ms_device_finish,
            commands::scan_account,
            commands::apply_plan,
            commands::unsubscribe_one_click
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Rangemail");
}
