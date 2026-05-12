use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct AppConfig {
    pub hotkey: String,
    #[serde(default = "default_ocr_hotkey")]
    pub ocr_hotkey: String,
    #[serde(default)]
    pub ocr_lang: String, // empty = use Windows profile language
}

fn default_ocr_hotkey() -> String {
    "Ctrl+Shift+S".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: "Ctrl+Shift+T".to_string(),
            ocr_hotkey: default_ocr_hotkey(),
            ocr_lang: String::new(),
        }
    }
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("config.json"))
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), json).map_err(|e| e.to_string())
}
