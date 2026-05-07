use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_SHIFT,
};

#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

#[cfg(target_os = "macos")]
fn simulate_copy() {
    let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        return;
    };
    let key_c: CGKeyCode = 8; // 'C'
    if let Ok(ev) = CGEvent::new_keyboard_event(source.clone(), key_c, true) {
        ev.set_flags(CGEventFlags::CGEventFlagCommand);
        ev.post(CGEventTapLocation::HID);
    }
    thread::sleep(Duration::from_millis(20));
    if let Ok(ev) = CGEvent::new_keyboard_event(source, key_c, false) {
        ev.set_flags(CGEventFlags::CGEventFlagCommand);
        ev.post(CGEventTapLocation::HID);
    }
}

#[cfg(target_os = "windows")]
unsafe fn simulate_copy(hwnd: isize) {
    use std::mem::{size_of, zeroed};

    SetForegroundWindow(hwnd as *mut _);
    thread::sleep(Duration::from_millis(80));

    // Release Ctrl+Shift (still held from hotkey), then press Ctrl+C cleanly
    let vk_c: u16 = 0x43;
    let seq: [INPUT; 6] = [
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: VK_CONTROL as u16, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 };
            i
        },
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: VK_SHIFT as u16, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 };
            i
        },
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: VK_CONTROL as u16, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 };
            i
        },
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: vk_c, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 };
            i
        },
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: vk_c, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 };
            i
        },
        {
            let mut i: INPUT = zeroed();
            i.r#type = INPUT_KEYBOARD;
            i.Anonymous.ki = KEYBDINPUT { wVk: VK_CONTROL as u16, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 };
            i
        },
    ];

    SendInput(seq.len() as u32, seq.as_ptr(), size_of::<INPUT>() as i32);
}

pub fn handle_hotkey(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    let hwnd: isize = unsafe { GetForegroundWindow() as isize };
    #[cfg(not(target_os = "windows"))]
    let hwnd: isize = 0;

    let app = app.clone();
    thread::spawn(move || {
        let before = arboard::Clipboard::new()
            .ok()
            .and_then(|mut cb| cb.get_text().ok())
            .unwrap_or_default();

        #[cfg(target_os = "windows")]
        if hwnd != 0 {
            unsafe { simulate_copy(hwnd) };
        }
        #[cfg(target_os = "macos")]
        simulate_copy();

        // Poll clipboard for up to 600ms for new content
        let selected = {
            let mut result = String::new();
            for _ in 0..6 {
                thread::sleep(Duration::from_millis(100));
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    let text = cb.get_text().unwrap_or_default();
                    if text != before && !text.is_empty() {
                        result = text;
                        break;
                    }
                }
            }
            result
        };

        if let Some(window) = app.get_webview_window("main") {
            window.show().ok();
            window.set_focus().ok();
            window.unminimize().ok();
        }

        let trimmed = selected.trim().to_string();
        if !trimmed.is_empty() {
            app.emit("translate-selection", trimmed).ok();
        }
    });
}
