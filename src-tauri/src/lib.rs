mod config;
mod selection;
mod translate;
mod tray;

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct HotkeyState(pub Mutex<String>);

#[tauri::command]
fn get_hotkey(state: tauri::State<HotkeyState>) -> String {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_hotkey(
    app: AppHandle,
    shortcut: String,
    state: tauri::State<HotkeyState>,
) -> Result<(), String> {
    let old = {
        let guard = state.0.lock().unwrap();
        guard.clone()
    };
    let _ = app.global_shortcut().unregister(old.as_str());
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut.as_str(), |app_handle, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            selection::handle_hotkey(app_handle);
        }
    }) {
        // Re-register old shortcut so the user doesn't lose it
        let _ = app.global_shortcut().on_shortcut(old.as_str(), |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                selection::handle_hotkey(app_handle);
            }
        });
        return Err(e.to_string());
    }
    *state.0.lock().unwrap() = shortcut.clone();
    config::save_config(&app, &config::AppConfig { hotkey: shortcut })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            translate::translate_text,
            translate::translate_bing_text,
            translate::translate_mymemory_text,
            get_hotkey,
            set_hotkey,
        ])
        .setup(|app| {
            tray::setup_tray(app)?;

            let cfg = config::load_config(app.handle());
            let initial_hotkey = cfg.hotkey.clone();
            app.manage(HotkeyState(Mutex::new(initial_hotkey.clone())));

            app.handle()
                .global_shortcut()
                .on_shortcut(initial_hotkey.as_str(), |app_handle, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        selection::handle_hotkey(app_handle);
                    }
                })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                let _ = window.emit("window-hidden", ());
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
