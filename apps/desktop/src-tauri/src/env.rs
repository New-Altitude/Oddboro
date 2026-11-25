//! What the shell hands the office server: its port, its home, and a real PATH.

use std::env;
use std::path::PathBuf;
use std::process::Child;
use std::thread::sleep;
use std::time::{Duration, Instant};

/// The office's port when `ODDBORO_PORT` is not set.
const DEFAULT_PORT: u16 = 4500;
/// How long the login shell, or PowerShell on Windows, gets to give its PATH.
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
/// usual install folders it may have missed. Windows asks PowerShell the
/// same way. Each folder appears once.
///
/// `ODDBORO_EXTRA_PATH`'s folders go first, so a test's stand-in programs
/// reach the office without being written into the owner's own folders.
pub fn login_path() -> String {
    let base = read_login_path().unwrap_or_else(|| env::var("PATH").unwrap_or_default());
    let extra = env::var_os("ODDBORO_EXTRA_PATH").unwrap_or_default();
    let dirs = path_folders(&extra, &base, install_folders(&home()));
    env::join_paths(dirs).map_or(base, |p| p.to_string_lossy().into_owned())
}

fn path_folders(extra: &std::ffi::OsStr, base: &str, installs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for dir in env::split_paths(extra)
        .chain(env::split_paths(base))
        .chain(installs)
    {
        if !dir.as_os_str().is_empty() && !dirs.iter().any(|d| same_folder(d, &dir)) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Windows folder names ignore case; a Mac's and Linux's are compared as written.
fn same_folder(a: &std::path::Path, b: &std::path::Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Waits for `child` until `deadline`, and stops it then. True when it
/// finished on its own and succeeded.
fn finished(child: &mut Child, deadline: Instant) -> bool {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < deadline => sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
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

/// The PATH the owner's PowerShell has, after their profile runs, then the
/// user and system PATH as Windows has them saved now. A folder added in a
/// profile, or to PATH since the owner signed in, was missing, so a tool their
/// terminal ran was "not installed" here (#343). PowerShell 7 (`pwsh`) and
/// Windows PowerShell each read their own profile, so both run, side by side.
/// Each writes to a file, since PowerShell writes its output in the console's
/// code page and a PATH can hold any name.
#[cfg(windows)]
fn read_login_path() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    /// Starts the program with no console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = "[IO.File]::WriteAllText($env:ODDBORO_PATH_FILE, \
        (@($env:Path, [Environment]::GetEnvironmentVariable('Path', 'User'), \
        [Environment]::GetEnvironmentVariable('Path', 'Machine')) -join ';'))";
    let system =
        env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
    let shells = [
        PathBuf::from("pwsh.exe"),
        system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"),
    ];
    let asks: Vec<(Child, PathBuf)> = shells
        .iter()
        .enumerate()
        .filter_map(|(i, shell)| {
            let file = env::temp_dir().join(format!("oddboro-path-{}-{i}.txt", std::process::id()));
            Command::new(shell)
                .args(["-NoLogo", "-NonInteractive", "-Command", SCRIPT])
                .env("ODDBORO_PATH_FILE", &file)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .ok()
                .map(|child| (child, file))
        })
        .collect();
    let deadline = Instant::now() + LOGIN_SHELL_TIMEOUT;
    let mut paths = Vec::new();
    for (mut child, file) in asks {
        if finished(&mut child, deadline) {
            paths.extend(std::fs::read_to_string(&file).ok());
        }
        let _ = std::fs::remove_file(&file);
    }
    let path = paths.join(";");
    (!path.trim_matches(';').is_empty()).then_some(path)
}

/// The PATH from `$SHELL -l -i`, so `~/.zshrc` runs: nvm, fnm, Volta, asdf
/// and mise set Node up there, and the app brings Node but not npm. A shell
/// that fails or hangs as interactive falls back to `$SHELL -l`.
#[cfg(unix)]
fn read_login_path() -> Option<String> {
    let fallback = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };
    let shell = env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
    ask_shell(&shell, &["-l", "-i"]).or_else(|| ask_shell(&shell, &["-l"]))
}

/// Runs the shell with `flags` and a timeout, and reads the PATH it prints
/// after a marker, so a profile's own text before or after it is ignored.
#[cfg(unix)]
fn ask_shell(shell: &str, flags: &[&str]) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    const MARK: &str = "ODDBORO_PATH=";
    let mut child = Command::new(shell)
        .args(flags)
        .args(["-c", "printf '\\n%s%s\\n' ODDBORO_PATH= \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if !finished(&mut child, Instant::now() + LOGIN_SHELL_TIMEOUT) {
        return None;
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.lines().rev().find_map(|l| l.strip_prefix(MARK))?.trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::path_folders;
    use std::env;
    use std::path::PathBuf;

    fn joined(dirs: &[&str]) -> String {
        env::join_paths(dirs)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn extra_path_folders_come_first_and_each_folder_once() {
        let extra = env::join_paths(["stand-ins", "more"]).unwrap();
        let dirs = path_folders(
            &extra,
            &joined(&["bin", "stand-ins", ""]),
            vec![PathBuf::from("local"), PathBuf::from("bin")],
        );
        let names: Vec<_> = dirs
            .iter()
            .map(|d| d.to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["stand-ins", "more", "bin", "local"]);
    }

    #[test]
    fn no_extra_path_leaves_the_login_path_as_it_was() {
        let dirs = path_folders("".as_ref(), &joined(&["bin", "sbin"]), vec![]);
        assert_eq!(dirs, [PathBuf::from("bin"), PathBuf::from("sbin")]);
    }
}
