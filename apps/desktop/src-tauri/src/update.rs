//! Updates. Every one is required. As the app opens, before the server
//! starts, the shell checks for a newer version (5 second timeout) and
//! installs it at once. While the office runs it checks every 4 hours, and
//! whenever the server asks (`oddboro:update-check` on its stdout, from
//! Check now). A new version downloads in the background, the server picks
//! when it installs (`/api/update`, asked every 30 seconds), and the shell
//! stops the server, installs it and opens the new version. Offline, or any
//! error: it logs the problem and carries on. Release builds only.
//!
//! On Windows the updater runs the new version's installer and ends this app
//! itself, and the installer opens the new version when it is done.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use std::thread::sleep;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::server;

/// A line the server writes to its stdout when the owner presses Check now.
pub const CHECK_LINE: &str = "oddboro:update-check";
/// Only a release build updates. A debug build is not in a bundle to replace.
pub const ENABLED: bool = cfg!(not(debug_assertions));

const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Set on a version the shell opens itself (Linux, or Windows after a failed
/// install): the pid of the one it replaces.
pub const RELAUNCH_FROM: &str = "ODDBORO_RELAUNCH_FROM";
/// The longest a new version waits for the old one to quit.
const OLD_QUITS_WITHIN: Duration = Duration::from_secs(30);

static CHECK_NOW: OnceLock<Sender<()>> = OnceLock::new();

/// Shows the owner that Oddboro is updating, with the version it updates to.
pub type ShowUpdating = fn(&AppHandle, &str);

/// As the app opens: install a newer version before the server starts.
/// Returns true when it installed one and the new version is opening, so the
/// caller must stop.
pub fn on_launch(app: &AppHandle, log: &Path, show: ShowUpdating) -> bool {
    if !ENABLED {
        return false;
    }
    let update = match check(app) {
        Ok(Some(update)) => update,
        Ok(None) => {
            server::note(log, "update check: this is the newest version");
            return false;
        }
        Err(e) => {
            server::note(log, &format!("update check failed, starting anyway: {e}"));
            return false;
        }
    };
    let (from, to) = (&update.current_version, &update.version);
    server::note(
        log,
        &format!("updating from {from} to {to} before the office starts"),
    );
    show(app, &update.version);
    match download(&update).and_then(|bytes| install(&update, &bytes)) {
        Ok(()) => {
            server::note(log, &installed(&update));
            relaunch(app);
            true
        }
        Err(e) => {
            server::note(
                log,
                &format!("update to {} failed, starting anyway: {e}", update.version),
            );
            false
        }
    }
}

/// Wake the service's one update worker when the owner chooses Check now.
pub fn set_checks(tx: Sender<()>) -> Result<(), Sender<()>> {
    CHECK_NOW.set(tx)
}
pub fn check_now() {
    if let Some(tx) = CHECK_NOW.get() {
        let _ = tx.send(());
    }
}

/// The office's next start logs "first start of X" (`packages/ledger/src/backup.ts`).
/// Without it after this line, the update opened the old version again (#40).
fn installed(update: &Update) -> String {
    let (from, to) = (&update.current_version, &update.version);
    format!("installed {to} over {from}, opening it")
}

fn check(app: &AppHandle) -> Result<Option<Update>, String> {
    let mut builder = app.updater_builder().timeout(CHECK_TIMEOUT);
    // For local testing only: a latest.json served from this Mac.
    if let Ok(url) = std::env::var("ODDBORO_UPDATE_URL") {
        let url = Url::parse(&url).map_err(|e| format!("ODDBORO_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let found = tauri::async_runtime::block_on(updater.check()).map_err(|e| e.to_string())?;
    // The 5 seconds are for the check. The download gets longer.
    Ok(found.map(|mut update| {
        update.timeout = Some(DOWNLOAD_TIMEOUT);
        update
    }))
}

/// Downloads the update and checks its signature against the key in the app.
fn download(update: &Update) -> Result<Vec<u8>, String> {
    tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).map_err(|e| e.to_string())
}

/// Checks the signature again and replaces this app's bundle with the new one.
fn install(update: &Update, bytes: &[u8]) -> Result<(), String> {
    update.install(bytes).map_err(|e| e.to_string())
}

/// Opens the bundle at this app's path (the new version, once installed) and
/// quits this one. `open -n` hands it to launchd, which drops this process's
/// environment, so the ODDBORO_ settings go along with `--env`.
#[cfg(target_os = "macos")]
fn relaunch(app: &AppHandle) {
    let bundle = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.parent()?.parent()?.to_path_buf()))
        .filter(|b| b.extension().is_some_and(|e| e == "app"));
    if let Some(bundle) = bundle {
        let mut open = Command::new("/usr/bin/open");
        open.arg("-n");
        for (key, value) in std::env::vars() {
            if key.starts_with("ODDBORO_") {
                open.arg("--env").arg(format!("{key}={value}"));
            }
        }
        let _ = open
            .arg(bundle)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    app.exit(0);
}

/// Opens this app again and quits this one: on Linux the AppImage, which the
/// updater replaced in place. On Windows a successful install never gets
/// here (see the top of this file), so this reopens the same version after a
/// failed one. The new one keeps this environment, and waits for this one to
/// go before it claims the single instance.
#[cfg(not(target_os = "macos"))]
fn relaunch(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    let program = std::env::var_os("APPIMAGE");
    #[cfg(windows)]
    let program = std::env::current_exe().ok();
    if let Some(program) = program {
        let _ = Command::new(program)
            .env(RELAUNCH_FROM, std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    app.exit(0);
}

/// In a version the updater just opened, waits up to 30 seconds for the old
/// one to quit, so the two never hold the single instance or the port at once.
pub fn wait_for_old() {
    let Some(pid) = std::env::var(RELAUNCH_FROM)
        .ok()
        .and_then(|p| p.parse::<u32>().ok())
    else {
        return;
    };
    // Not for any version this one opens later.
    std::env::remove_var(RELAUNCH_FROM);
    let deadline = Instant::now() + OLD_QUITS_WITHIN;
    while Instant::now() < deadline && running(pid) {
        sleep(Duration::from_millis(100));
    }
}

#[cfg(unix)]
fn running(pid: u32) -> bool {
    // SAFETY: kill with signal 0 only asks whether the process exists.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    // SAFETY: the handle is checked before use and closed once.
    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if process.is_null() {
            return false;
        }
        let alive = WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
        CloseHandle(process);
        alive
    }
}

/// One request to the server's `/api/update`, with the token that marks it as
/// the shell's. HTTP/1.0, so the answer comes whole, never chunked.
pub fn ask(port: u16, token: &str, method: &str, body: Option<&Value>) -> Option<Value> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let body = body.map(Value::to_string).unwrap_or_default();
    let request = format!(
        "{method} /api/update HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nX-Oddboro-Update-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut answer = String::new();
    stream.read_to_string(&mut answer).ok()?;
    let (_, json) = answer.split_once("\r\n\r\n")?;
    serde_json::from_str(json).ok()
}

/// A fresh secret for this run, so only this shell can tell the server an
/// update is ready. Empty if the system has no randomness to give: the server
/// then takes no update requests at all.
pub fn token() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        return String::new();
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
