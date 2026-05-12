mod config;
mod ocr;
mod selection;
mod translate;
mod tray;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

pub struct HotkeyState(pub Mutex<String>);
pub struct OcrHotkeyState(pub Mutex<String>);

struct UpdateState(Arc<Mutex<Option<tauri_plugin_updater::Update>>>);

#[tauri::command]
fn get_hotkey(state: tauri::State<HotkeyState>) -> String {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_hotkey(
    app: AppHandle,
    shortcut: String,
    state: tauri::State<HotkeyState>,
    ocr_state: tauri::State<OcrHotkeyState>,
) -> Result<(), String> {
    let old = {
        let guard = state.0.lock().unwrap();
        guard.clone()
    };
    let _ = app.global_shortcut().unregister(old.as_str());
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                selection::handle_hotkey(app_handle);
            }
        })
    {
        let _ = app
            .global_shortcut()
            .on_shortcut(old.as_str(), |app_handle, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    selection::handle_hotkey(app_handle);
                }
            });
        return Err(e.to_string());
    }
    *state.0.lock().unwrap() = shortcut.clone();
    let ocr_hotkey = ocr_state.0.lock().unwrap().clone();
    let ocr_lang = config::load_config(&app).ocr_lang;
    config::save_config(
        &app,
        &config::AppConfig {
            hotkey: shortcut,
            ocr_hotkey,
            ocr_lang,
        },
    )
}

#[tauri::command]
fn get_ocr_hotkey(state: tauri::State<OcrHotkeyState>) -> String {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_ocr_hotkey(
    app: AppHandle,
    shortcut: String,
    state: tauri::State<HotkeyState>,
    ocr_state: tauri::State<OcrHotkeyState>,
) -> Result<(), String> {
    let old = {
        let guard = ocr_state.0.lock().unwrap();
        guard.clone()
    };
    let _ = app.global_shortcut().unregister(old.as_str());
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = ocr::open_ocr_overlay(app_handle.clone());
            }
        })
    {
        let _ = app
            .global_shortcut()
            .on_shortcut(old.as_str(), |app_handle, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = ocr::open_ocr_overlay(app_handle.clone());
                }
            });
        return Err(e.to_string());
    }
    *ocr_state.0.lock().unwrap() = shortcut.clone();
    let hotkey = state.0.lock().unwrap().clone();
    let ocr_lang = config::load_config(&app).ocr_lang;
    config::save_config(
        &app,
        &config::AppConfig {
            hotkey,
            ocr_hotkey: shortcut,
            ocr_lang,
        },
    )
}

#[tauri::command]
fn get_ocr_lang(app: AppHandle) -> String {
    config::load_config(&app).ocr_lang
}

#[tauri::command]
fn set_ocr_lang(
    app: AppHandle,
    lang: String,
    state: tauri::State<HotkeyState>,
    ocr_state: tauri::State<OcrHotkeyState>,
) -> Result<(), String> {
    config::save_config(
        &app,
        &config::AppConfig {
            hotkey: state.0.lock().unwrap().clone(),
            ocr_hotkey: ocr_state.0.lock().unwrap().clone(),
            ocr_lang: lang,
        },
    )
}

#[tauri::command]
async fn check_for_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<serde_json::Value, String> {
    let update = app
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    match update {
        Some(u) => {
            let info = serde_json::json!({
                "available": true,
                "version": u.version,
                "body": u.body
            });
            *state.0.lock().unwrap() = Some(u);
            Ok(info)
        }
        None => {
            *state.0.lock().unwrap() = None;
            Ok(serde_json::json!({ "available": false }))
        }
    }
}

#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let update = state.0.lock().unwrap().take();
    if let Some(u) = update {
        let app2 = app.clone();
        u.download_and_install(
            move |downloaded, total| {
                let _ = app2.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            translate::translate_text,
            translate::translate_bing_text,
            translate::translate_mymemory_text,
            translate::speak_tts,
            get_hotkey,
            set_hotkey,
            get_ocr_hotkey,
            set_ocr_hotkey,
            ocr::capture_ocr_region,
            ocr::open_ocr_overlay,
            ocr::hide_ocr_overlay,
            ocr::get_ocr_languages,
            get_ocr_lang,
            set_ocr_lang,
            check_for_update,
            install_update,
        ])
        .setup(|app| {
            tray::setup_tray(app)?;

            let cfg = config::load_config(app.handle());
            let initial_hotkey = cfg.hotkey.clone();
            let initial_ocr_hotkey = cfg.ocr_hotkey.clone();

            app.manage(HotkeyState(Mutex::new(initial_hotkey.clone())));
            app.manage(OcrHotkeyState(Mutex::new(initial_ocr_hotkey.clone())));
            app.manage(UpdateState(Arc::new(Mutex::new(None))));

            // Register translation hotkey
            app.handle()
                .global_shortcut()
                .on_shortcut(initial_hotkey.as_str(), |app_handle, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        selection::handle_hotkey(app_handle);
                    }
                })?;

            // Register OCR hotkey
            app.handle()
                .global_shortcut()
                .on_shortcut(
                    initial_ocr_hotkey.as_str(),
                    |app_handle, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            let _ = ocr::open_ocr_overlay(app_handle.clone());
                        }
                    },
                )?;

            // Create OCR overlay window (hidden, transparent, always-on-top, fullscreen)
            tauri::WebviewWindowBuilder::new(
                app,
                "ocr-overlay",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("OCR")
            .transparent(true)
            .always_on_top(true)
            .decorations(false)
            .skip_taskbar(true)
            .fullscreen(true)
            .visible(false)
            .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "ocr-overlay" {
                    window.hide().unwrap();
                } else {
                    window.hide().unwrap();
                    let _ = window.emit("window-hidden", ());
                }
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
