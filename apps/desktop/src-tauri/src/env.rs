//! What the shell hands the office server: its port, its home, and a real PATH.

use std::env;
use std::path::PathBuf;
#[cfg(unix)]
use std::time::Duration;

/// The office's port when `ODDBORO_PORT` is not set.
const DEFAULT_PORT: u16 = 4500;
/// How long the login shell gets to print its PATH.
#[cfg(unix)]
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// `ODDBORO_PORT` from the shell's own environment, or 4500.
pub fn port() -> u16 {
    env::var("ODDBORO_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// The owner's home folder.
pub fn home() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(var).map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

/// `ODDBORO_HOME` from the shell's own environment, or `~/.oddboro`.
pub fn office_home() -> PathBuf {
    env::var_os("ODDBORO_HOME").map_or_else(|| home().join(".oddboro"), PathBuf::from)
}

/// `ODDBORO_LOG` from the shell's own environment, so a test's run never
/// writes to the owner's log, or else where Node's output goes:
/// `~/Library/Logs/Oddboro` on a Mac, and on Linux and Windows the folder the
/// office's own login service logs to (`packages/ledger/src/platform.ts`).
pub fn log_file() -> PathBuf {
    env::var_os("ODDBORO_LOG")
        .filter(|s| !s.is_empty())
        .map_or_else(default_log_file, PathBuf::from)
}

#[cfg(target_os = "macos")]
fn default_log_file() -> PathBuf {
    home().join("Library/Logs/Oddboro/office.log")
}

#[cfg(target_os = "linux")]
fn default_log_file() -> PathBuf {
    let state = env::var_os("XDG_STATE_HOME")
        .filter(|s| !s.is_empty())
        .map_or_else(|| home().join(".local/state"), PathBuf::from);
    state.join("oddboro/office.log")
}

#[cfg(windows)]
fn default_log_file() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .filter(|s| !s.is_empty())
        .map_or_else(|| home().join("AppData").join("Local"), PathBuf::from)
        .join("Oddboro")
        .join("Logs")
        .join("office.log")
}

/// The PATH the owner's Terminal would have. An app opened from the Finder or
/// a Linux launcher starts with a short system PATH, and the server spawns
/// `claude`, `git` and `uvx`, so ask the login shell once and then add the
/// usual install folders it may have missed. Windows has no login shell: an
/// app gets the owner's own PATH, plus the same kind of folders.
pub fn login_path() -> String {
    let base = read_login_path().unwrap_or_else(|| env::var("PATH").unwrap_or_default());
    let mut dirs: Vec<PathBuf> = env::split_paths(&base)
        .filter(|d| !d.as_os_str().is_empty())
        .collect();
    for dir in install_folders(&home()) {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    env::join_paths(dirs).map_or(base, |p| p.to_string_lossy().into_owned())
}

/// Where `claude`, `git` and `uvx` usually install.
#[cfg(unix)]
fn install_folders(home: &std::path::Path) -> Vec<PathBuf> {
    vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        home.join(".local/bin"),
        home.join(".claude/local"),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
    ]
}

/// Claude Code's and uv's installers use `.local\bin`, WinGet links its
/// installs from one folder, and Git for Windows keeps `git` in `cmd`.
#[cfg(windows)]
fn install_folders(home: &std::path::Path) -> Vec<PathBuf> {
    let local = env::var_os("LOCALAPPDATA")
        .map_or_else(|| home.join("AppData").join("Local"), PathBuf::from);
    vec![
        home.join(".local").join("bin"),
        local.join("Microsoft").join("WinGet").join("Links"),
        PathBuf::from(r"C:\Program Files\Git\cmd"),
    ]
}

#[cfg(windows)]
fn read_login_path() -> Option<String> {
    None
}

/// Runs `$SHELL -l -c 'printf %s "$PATH"'` with a timeout. A profile that
/// prints its own text first is fine: the PATH is the last line.
#[cfg(unix)]
fn read_login_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::thread::sleep;
    use std::time::Instant;

    let fallback = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };
    let shell = env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
    let mut child = Command::new(shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + LOGIN_SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => sleep(Duration::from_millis(50)),
            Ok(Some(_)) => return None,
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.lines().last()?.trim().to_string();
    (!path.is_empty()).then_some(path)
}
