mod commands;
mod mail;
mod oauth;
mod oauth_defaults;
mod store;
mod types;

use commands::AppState;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

fn montrer_fenetre(app: &tauri::AppHandle) {
    if let Some(fenetre) = app.get_webview_window("main") {
        let _ = fenetre.show();
        let _ = fenetre.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::default())
        .setup(|app| {
            // Icône de la barre de menus : Médor reste actif fenêtre fermée.
            let ouvrir = MenuItemBuilder::with_id("ouvrir", "Ouvrir Médor").build(app)?;
            let quitter = MenuItemBuilder::with_id("quitter", "Quitter Médor").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&ouvrir)
                .separator()
                .item(&quitter)
                .build()?;
            let mut tray = TrayIconBuilder::with_id("principal").menu(&menu).on_menu_event(
                |app, event| match event.id().as_ref() {
                    "ouvrir" => montrer_fenetre(app),
                    "quitter" => app.exit(0),
                    _ => {}
                },
            );
            if let Some(icone) = app.default_window_icon() {
                tray = tray.icon(icone.clone());
            }
            tray.build(app)?;

            // Planificateur du rangement automatique (voir Réglages).
            let handle = app.handle().clone();
            std::thread::spawn(move || commands::auto_sort_loop(handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenêtre masque l'app au lieu de la quitter : le
            // rangement automatique continue en arrière-plan.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::set_settings,
            commands::set_autostart,
            commands::add_account,
            commands::remove_account,
            commands::google_connect,
            commands::ms_device_start,
            commands::ms_device_finish,
            commands::oauth_cancel,
            commands::scan_account,
            commands::apply_plan,
            commands::cancel_operation,
            commands::sort_everything,
            commands::get_journal,
            commands::undo_journal_entry,
            commands::get_sender_preview,
            commands::delete_labels,
            commands::restore_inbox,
            commands::trash_senders,
            commands::unsubscribe_one_click,
            commands::auto_pending,
            commands::auto_run_now,
            commands::auto_defer,
            commands::get_last_plan
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de Médor");

    app.run(|app_handle, event| {
        // macOS : clic sur l'icône du Dock quand la fenêtre est masquée.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            montrer_fenetre(app_handle);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, &event);
    });
}
