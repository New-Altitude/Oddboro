//! A still office list above other apps. Navigation selects the existing pane,
//! so an open chat draft survives a click. The page has no native permissions.
use std::fs;

use serde_json::{json, Value};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::{env, server, show, MAIN};
pub const STRIP: &str = "office-strip";

/// Only these same-origin links select the main office. No arbitrary script
/// or destination from a page reaches the native window.
fn destination(home: &Url, to: &Url) -> Option<Value> {
    if to.origin() != home.origin() || to.path() != "/" {
        return None;
    }
    let pairs: Vec<_> = to.query_pairs().collect();
    if pairs.len() != 1 {
        return None;
    }
    let (key, value) = &pairs[0];
    if key == "desk" && value == "1" {
        return Some(json!({"desk": true}));
    }
    if key == "odd"
        && !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Some(json!({"odd": value}));
    }
    None
}

pub fn open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(STRIP) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let Some(main) = app.get_webview_window(MAIN) else {
        return;
    };
    let Ok(home) = main.url() else {
        return;
    };
    let Ok(url) = home.join("/strip") else {
        return;
    };
    let handle = app.clone();
    let built = WebviewWindowBuilder::new(app, STRIP, WebviewUrl::External(url))
        .title("Office strip")
        .inner_size(340.0, 360.0)
        .min_inner_size(260.0, 160.0)
        .always_on_top(true)
        .center()
        .on_navigation(move |to| {
            if let Some(target) = destination(&home, to) {
                if let Some(main) = handle.get_webview_window(MAIN) {
                    let _ = main.eval(format!("window.dispatchEvent(new CustomEvent('oddboro:open', {{detail:{target}}}))"));
                    show(&handle);
                }
                return false;
            }
            to.origin() == home.origin() && to.path() == "/strip"
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build();
    match built {
        Ok(window) => {
            restore(&window);
            server::note(
                &env::log_file(),
                &format!(
                    "office strip opened: always on top {}",
                    window.is_always_on_top().unwrap_or(false)
                ),
            );
        }
        Err(error) => server::note(&env::log_file(), &format!("office strip: {error}")),
    }
}

// Save on close and quit, not on every pixel of a drag. Physical coordinates
// preserve the place on a display. A removed display returns to the centre.
pub fn save(window: &WebviewWindow) {
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let value = json!({"x":position.x,"y":position.y,"width":size.width,"height":size.height});
    if let Err(error) = fs::write(
        env::office_home().join("strip-window.json"),
        value.to_string(),
    ) {
        server::note(
            &env::log_file(),
            &format!("save office strip size: {error}"),
        );
    }
}

fn bounds(value: &Value) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let x = i32::try_from(value.get("x")?.as_i64()?).ok()?;
    let y = i32::try_from(value.get("y")?.as_i64()?).ok()?;
    let width = u32::try_from(value.get("width")?.as_u64()?).ok()?;
    let height = u32::try_from(value.get("height")?.as_u64()?).ok()?;
    if !(260..=4000).contains(&width) || !(160..=4000).contains(&height) {
        return None;
    }
    Some((
        PhysicalPosition::new(x, y),
        PhysicalSize::new(width, height),
    ))
}

fn restore(window: &WebviewWindow) {
    let value = fs::read(env::office_home().join("strip-window.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let Some((position, size)) = value.as_ref().and_then(bounds) else {
        return;
    };
    let monitors = window.available_monitors().unwrap_or_default();
    let visible = monitors.iter().any(|monitor| {
        let at = monitor.position();
        let area = monitor.size();
        // Keep the title bar and a useful part of the window on this display.
        i64::from(position.x) >= i64::from(at.x)
            && i64::from(position.y) >= i64::from(at.y)
            && i64::from(position.x) + 260 <= i64::from(at.x) + i64::from(area.width)
            && i64::from(position.y) + 160 <= i64::from(at.y) + i64::from(area.height)
    });
    let _ = window.set_size(size);
    if visible {
        let _ = window.set_position(position);
    } else {
        let _ = window.center();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_strip_link_can_only_select_the_same_office() {
        let home = Url::parse("http://127.0.0.1:4500/").unwrap();
        assert_eq!(
            destination(&home, &home.join("/?odd=robin").unwrap()),
            Some(json!({"odd":"robin"}))
        );
        assert_eq!(
            destination(&home, &home.join("/?desk=1").unwrap()),
            Some(json!({"desk":true}))
        );
        for url in [
            "http://elsewhere/?odd=robin",
            "http://127.0.0.1:4501/?desk=1",
            "http://127.0.0.1:4500/?odd=%27);evil()",
            "http://127.0.0.1:4500/?odd=",
            "http://127.0.0.1:4500/api/?desk=1",
            "http://127.0.0.1:4500/?desk=1&odd=robin",
        ] {
            assert_eq!(destination(&home, &Url::parse(url).unwrap()), None);
        }
    }
    #[test]
    fn corrupt_or_unreasonable_bounds_use_the_default() {
        let valid = json!({"x":-400,"y":40,"width":340,"height":360});
        assert!(bounds(&valid).is_some());
        for invalid in [
            json!(null),
            json!({}),
            json!({"x":0,"y":0,"width":-1,"height":360}),
            json!({"x":0,"y":0,"width":340,"height":99999}),
        ] {
            assert!(bounds(&invalid).is_none());
        }
    }
}
