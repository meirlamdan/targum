use serde::Serialize;

#[derive(Serialize)]
pub struct TranslateResult {
    pub translated: String,
    pub detected_lang: String,
}

fn extract_between<'a>(s: &'a str, prefix: &str, end: char) -> Option<&'a str> {
    let start = s.find(prefix)? + prefix.len();
    let len = s[start..].find(end)?;
    Some(&s[start..start + len])
}

fn to_bing_lang(lang: &str) -> &str {
    match lang {
        "auto" => "auto-detect",
        "zh" => "zh-Hans",
        other => other,
    }
}

fn from_bing_lang(lang: &str) -> String {
    match lang {
        "zh-Hans" | "zh-Hant" => "zh".to_string(),
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn translate_bing_text(text: String, target_lang: String, source_lang: String) -> Result<TranslateResult, String> {
    if text.trim().is_empty() {
        return Ok(TranslateResult {
            translated: String::new(),
            detected_lang: String::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent(if cfg!(target_os = "windows") {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        } else {
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        })
        .cookie_store(true)
        .build()
        .map_err(|e| e.to_string())?;

    let page = client
        .get("https://www.bing.com/translator")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Bing page error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Bing page read error: {}", e))?;

    // Try unquoted JS key `IG:"VALUE"` first, then quoted JSON key `"IG":"VALUE"`
    let ig = extract_between(&page, "IG:\"", '"')
        .or_else(|| extract_between(&page, "\"IG\":\"", '"'))
        .unwrap_or("")
        .to_string();

    // IID is optional — static fallback works fine
    let iid = extract_between(&page, "data-iid=\"", '"')
        .unwrap_or("translator.5028.6")
        .to_string();

    // Token/key: try without spaces first, then with spaces
    let key = extract_between(&page, "params_AbusePreventionHelper=[", ',')
        .or_else(|| extract_between(&page, "params_AbusePreventionHelper = [", ','))
        .map(str::trim)
        .unwrap_or("")
        .to_string();

    let token = if !key.is_empty() {
        let pat1 = format!("params_AbusePreventionHelper=[{},\"", key);
        let pat2 = format!("params_AbusePreventionHelper = [{},\"", key);
        extract_between(&page, &pat1, '"')
            .or_else(|| extract_between(&page, &pat2, '"'))
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    };

    let bing_from = to_bing_lang(&source_lang).to_string();
    let bing_to = to_bing_lang(&target_lang).to_string();

    let url = if !ig.is_empty() {
        format!("https://www.bing.com/ttranslatev3?isVertical=1&IG={}&IID={}", ig, iid)
    } else {
        "https://www.bing.com/ttranslatev3?isVertical=1".to_string()
    };

    let mut form: Vec<(&str, &str)> = vec![
        ("fromLang", &bing_from),
        ("text", &text),
        ("to", &bing_to),
    ];
    if !token.is_empty() && !key.is_empty() {
        form.push(("token", &token));
        form.push(("key", &key));
    }

    let response = client
        .post(&url)
        .header("Referer", "https://www.bing.com/translator")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Bing translate error: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Bing response read error: {}", e))?;

    if !status.is_success() {
        return Err(format!("Bing HTTP {}: {}", status, &body[..body.len().min(300)]));
    }

    let raw: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Bing parse error: {} — body: {}", e, &body[..body.len().min(300)]))?;

    let translated = raw[0]["translations"][0]["text"]
        .as_str()
        .ok_or_else(|| format!("Bing: unexpected response — body: {}", &body[..body.len().min(300)]))?
        .to_string();

    let detected_lang = raw[0]["detectedLanguage"]["language"]
        .as_str()
        .map(from_bing_lang)
        .unwrap_or_else(|| "auto".to_string());

    Ok(TranslateResult {
        translated,
        detected_lang,
    })
}

#[tauri::command]
pub async fn translate_mymemory_text(text: String, target_lang: String, source_lang: String) -> Result<TranslateResult, String> {
    if text.trim().is_empty() {
        return Ok(TranslateResult { translated: String::new(), detected_lang: String::new() });
    }

    let mm_source = if source_lang == "auto" { "autodetect".to_string() } else { source_lang.clone() };
    let langpair = format!("{}|{}", mm_source, target_lang);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", text.as_str()), ("langpair", langpair.as_str())])
        .send()
        .await
        .map_err(|e| format!("MyMemory network error: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| format!("MyMemory read error: {}", e))?;

    if !status.is_success() {
        return Err(format!("MyMemory HTTP {}: {}", status, &body[..body.len().min(300)]));
    }

    let raw: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("MyMemory parse error: {} — body: {}", e, &body[..body.len().min(300)]))?;

    if raw["responseStatus"].as_u64().unwrap_or(200) == 429 {
        return Err("MyMemory: daily quota exceeded (50 000 chars/day)".to_string());
    }

    let translated = raw["responseData"]["translatedText"]
        .as_str()
        .ok_or_else(|| format!("MyMemory: unexpected response — body: {}", &body[..body.len().min(300)]))?
        .to_string();

    let detected_lang = raw["matches"][0]["source-lang"]
        .as_str()
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "auto".to_string());

    Ok(TranslateResult { translated, detected_lang })
}

#[tauri::command]
pub async fn translate_text(text: String, target_lang: String, source_lang: String) -> Result<TranslateResult, String> {
    if text.trim().is_empty() {
        return Ok(TranslateResult {
            translated: String::new(),
            detected_lang: String::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[
            ("client", "gtx"),
            ("sl", source_lang.as_str()),
            ("tl", target_lang.as_str()),
            ("dt", "t"),
            ("q", text.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let raw: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Response: [[["translated", "original", ...], ...], null, "detected_lang", ...]
    let translated = raw[0]
        .as_array()
        .ok_or("Unexpected response format")?
        .iter()
        .filter_map(|chunk| chunk[0].as_str())
        .collect::<Vec<_>>()
        .join("");

    let detected_lang = raw[2].as_str().unwrap_or("auto").to_string();

    Ok(TranslateResult {
        translated,
        detected_lang,
    })
}

fn chunk_text(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() && current.len() + 1 + word.len() > max_len {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() { current.push(' '); }
        current.push_str(word);
    }
    if !current.trim().is_empty() { chunks.push(current); }
    chunks
}

#[tauri::command]
pub async fn speak_tts(text: String, lang: String) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() { return Ok(vec![]); }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let mut audio: Vec<u8> = Vec::new();
    for chunk in chunk_text(&text, 200) {
        let bytes = client
            .get("https://translate.googleapis.com/translate_tts")
            .query(&[("ie", "UTF-8"), ("q", chunk.as_str()), ("tl", lang.as_str()), ("client", "gtx"), ("ttsspeed", "1")])
            .send().await.map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
        audio.extend_from_slice(&bytes);
    }
    Ok(audio)
}
