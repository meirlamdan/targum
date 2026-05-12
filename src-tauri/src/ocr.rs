use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
mod win {
    use image::{DynamicImage, ImageFormat};
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::{FileAccessMode, StorageFile},
        core::HSTRING,
    };
    use xcap::Monitor;

    pub fn capture_and_ocr(
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        scale: f64,
        preferred_lang: String,
    ) -> Result<String, String> {
        // Convert logical → physical pixels
        let px = (x as f64 * scale) as i32;
        let py = (y as f64 * scale) as i32;
        let pw = ((w as f64) * scale) as u32;
        let ph = ((h as f64) * scale) as u32;

        // Find monitor containing the selection (xcap 0.9+ methods return Result)
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let monitor = monitors
            .iter()
            .find(|m| {
                let mx = m.x().unwrap_or(0);
                let my = m.y().unwrap_or(0);
                let mw = m.width().unwrap_or(0) as i32;
                let mh = m.height().unwrap_or(0) as i32;
                px >= mx && py >= my && px < mx + mw && py < my + mh
            })
            .ok_or_else(|| "No monitor found at selection".to_string())?;

        // Capture full monitor image
        let full = monitor.capture_image().map_err(|e| e.to_string())?;

        // Crop to selection region (relative to monitor origin)
        let mon_x = monitor.x().unwrap_or(0);
        let mon_y = monitor.y().unwrap_or(0);
        let rel_x = (px - mon_x) as u32;
        let rel_y = (py - mon_y) as u32;
        let full_w = full.width();
        let full_h = full.height();
        let cw = pw.min(full_w.saturating_sub(rel_x));
        let ch = ph.min(full_h.saturating_sub(rel_y));

        if cw < 4 || ch < 4 {
            return Err("__no_text__".to_string());
        }

        let cropped = DynamicImage::ImageRgba8(full).crop_imm(rel_x, rel_y, cw, ch);

        // Save to temp file for WinRT BitmapDecoder
        let tmp = std::env::temp_dir().join("targum_ocr.png");
        cropped
            .save_with_format(&tmp, ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        let result = run_ocr(&tmp, &preferred_lang);
        let _ = std::fs::remove_file(&tmp);
        result
    }

    fn run_ocr(path: &std::path::Path, preferred_lang: &str) -> Result<String, String> {
        let hpath = HSTRING::from(path.to_str().ok_or("invalid path")?);

        let file = StorageFile::GetFileFromPathAsync(&hpath)
            .map_err(|e: windows::core::Error| e.to_string())?
            .get()
            .map_err(|e: windows::core::Error| e.to_string())?;

        let stream = file
            .OpenAsync(FileAccessMode::Read)
            .map_err(|e: windows::core::Error| e.to_string())?
            .get()
            .map_err(|e: windows::core::Error| e.to_string())?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e: windows::core::Error| e.to_string())?
            .get()
            .map_err(|e: windows::core::Error| e.to_string())?;

        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e: windows::core::Error| e.to_string())?
            .get()
            .map_err(|e: windows::core::Error| e.to_string())?;

        // If a specific language is requested, find it in installed packs
        if !preferred_lang.is_empty() {
            let languages = OcrEngine::AvailableRecognizerLanguages()
                .map_err(|e: windows::core::Error| e.to_string())?;
            let count = languages
                .Size()
                .map_err(|e: windows::core::Error| e.to_string())?;

            for i in 0..count {
                let lang = match languages.GetAt(i) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                let tag = match lang.LanguageTag() {
                    Ok(t) => t.to_string(),
                    Err(_) => continue,
                };
                if tag != preferred_lang {
                    continue;
                }
                let engine = match OcrEngine::TryCreateFromLanguage(&lang) {
                    Ok(e) => e,
                    Err(_) => break,
                };
                let ocr = match engine.RecognizeAsync(&bitmap) {
                    Ok(op) => match op.get() {
                        Ok(r) => r,
                        Err(_) => break,
                    },
                    Err(_) => break,
                };
                let text = match ocr.Text() {
                    Ok(t) => t.to_string(),
                    Err(_) => break,
                };
                return if text.trim().is_empty() {
                    Err("__no_text__".to_string())
                } else {
                    Ok(text)
                };
            }
            // Preferred language not installed — fall through to profile language
        }

        // Use Windows user profile language (default behaviour)
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|e: windows::core::Error| e.to_string())?;

        let ocr = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e: windows::core::Error| e.to_string())?
            .get()
            .map_err(|e: windows::core::Error| e.to_string())?;

        let text = ocr
            .Text()
            .map_err(|e: windows::core::Error| e.to_string())?
            .to_string();

        if text.trim().is_empty() {
            Err("__no_text__".to_string())
        } else {
            Ok(text)
        }
    }

    pub fn available_languages() -> Vec<(String, String)> {
        let Ok(languages) = OcrEngine::AvailableRecognizerLanguages() else {
            return vec![];
        };
        let Ok(count) = languages.Size() else {
            return vec![];
        };
        let mut result = vec![];
        for i in 0..count {
            let Ok(lang) = languages.GetAt(i) else { continue };
            let tag = lang.LanguageTag().map(|t| t.to_string()).unwrap_or_default();
            let name = lang
                .DisplayName()
                .map(|t| t.to_string())
                .unwrap_or_else(|_| tag.clone());
            if !tag.is_empty() {
                result.push((tag, name));
            }
        }
        result
    }
}

#[tauri::command]
pub async fn capture_ocr_region(
    app: AppHandle,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    scale: f64,
) -> Result<(), String> {
    let ocr_lang = crate::config::load_config(&app).ocr_lang;

    // Hide overlay BEFORE capturing so the dark tint doesn't appear in the screenshot
    if let Some(overlay) = app.get_webview_window("ocr-overlay") {
        let _ = overlay.hide();
    }
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    #[cfg(target_os = "windows")]
    let result =
        tokio::task::spawn_blocking(move || win::capture_and_ocr(x, y, w, h, scale, ocr_lang))
            .await
            .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let result: Result<String, String> =
        Err("OCR is not supported on this platform yet".to_string());

    match result {
        Ok(text) => {
            let _ = app.emit("ocr-text", text);
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            Ok(())
        }
        Err(e) if e == "__no_text__" => {
            let _ = app.emit("ocr-no-text", ());
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn get_ocr_languages() -> Vec<serde_json::Value> {
    #[cfg(target_os = "windows")]
    {
        return win::available_languages()
            .into_iter()
            .map(|(tag, name)| serde_json::json!({ "tag": tag, "name": name }))
            .collect();
    }
    #[cfg(not(target_os = "windows"))]
    vec![]
}

#[tauri::command]
pub fn open_ocr_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ocr-overlay") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_ocr_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ocr-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
