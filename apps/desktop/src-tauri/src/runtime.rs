//! Bounded local facts about the shell. No logs, paths, tokens or office work.
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static WRITING: Mutex<()> = Mutex::new(());
const LIMIT: usize = 40;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn read(path: &Path) -> Value {
    fs::read(path)
        .ok()
        .filter(|b| b.len() <= 65536)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({"events": []}))
}

fn changed(mut state: Value, at: u64, kind: &str, fields: Value) -> Value {
    let obj = state.as_object_mut().expect("runtime state is an object");
    obj.insert("schema".into(), json!(1));
    obj.insert("shellPid".into(), json!(std::process::id()));
    obj.insert("platform".into(), json!(std::env::consts::OS));
    obj.insert("updatedAt".into(), json!(at));
    if let Some(fields) = fields.as_object() {
        for (key, value) in fields {
            obj.insert(key.clone(), value.clone());
        }
    }
    let events = obj.entry("events").or_insert_with(|| json!([]));
    if !events.is_array() {
        *events = json!([]);
    }
    let events = events.as_array_mut().unwrap();
    events.push(json!({"at": at, "kind": kind}));
    if events.len() > LIMIT {
        events.drain(..events.len() - LIMIT);
    }
    state
}

fn write_event(kind: &str, fields: Value, node: Option<u32>) {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let path = crate::env::office_home()
        .join("runtime")
        .join("desktop.json");
    let previous = read(&path);
    if node.is_some_and(|pid| previous["nodePid"].as_u64() != Some(pid as u64)) {
        return;
    }
    let state = changed(previous, now(), kind, fields);
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let temp = path.with_extension("tmp");
    if fs::write(&temp, state.to_string()).is_ok() {
        // On Windows rename cannot replace an existing file. Readers treat the
        // brief missing record as unknown, never as proof that the shell stopped.
        #[cfg(windows)]
        let _ = fs::remove_file(&path);
        let _ = fs::rename(temp, path);
    }
}

pub fn event(kind: &str, fields: Value) {
    write_event(kind, fields, None);
}

pub fn login(enabled: Option<bool>) {
    event(
        "login_checked",
        json!({"openAtLogin": enabled, "loginCheckedAt": now()}),
    );
}

pub fn power(pid: u32, state: &str) {
    write_event(
        "power_request",
        json!({"power": {
            "nodePid": pid, "state": state, "at": now(), "platform": std::env::consts::OS
        }}),
        Some(pid),
    );
}

pub fn stopped(clean: bool) {
    let at = now();
    let fields = if clean {
        json!({"state": "stopped", "nodePid": 0, "lastStopAt": at, "lastCleanShutdownAt": at})
    } else {
        json!({"state": "stopped", "nodePid": 0, "lastStopAt": at})
    };
    event("node_stopped", fields);
}

pub fn ready() {
    event(
        "node_ready",
        json!({"state": "running", "lastReadyAt": now()}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_bounded_history_and_previous_clean_shutdown() {
        let mut s = json!({"lastCleanShutdownAt": 12});
        for at in 0..100 {
            s = changed(s, at, "node_ready", json!({"state": "running"}));
        }
        assert_eq!(s["events"].as_array().unwrap().len(), LIMIT);
        assert_eq!(s["lastCleanShutdownAt"], 12);
        assert_eq!(s["updatedAt"], 99);
        assert_eq!(s["state"], "running");
    }
    #[test]
    fn failed_login_query_stays_unknown() {
        let s = changed(json!({}), 5, "login_checked", json!({"openAtLogin": null}));
        assert!(s["openAtLogin"].is_null());
    }
}
