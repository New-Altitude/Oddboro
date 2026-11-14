//! Runs before Tauri initializes a display, tray, or webview. The same
//! executable still owns the Node pipes and the signed Mac Keychain identity.
use crate::{
    diagnostics::Diagnostics, env, node_binary, office_server, server, server_code, NO_NODE,
    NO_SERVER,
};

use crate::key::Key;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// The operating system releases this lock even after a crash. The lock file
/// stays in place so simultaneous launchers always lock the same inode.
pub fn lease() -> io::Result<File> {
    let home = env::office_home();
    fs::create_dir_all(&home)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700))?;
    }
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(home.join("service.lock"))?;
    lock.try_lock().map_err(io::Error::from)?;
    Ok(lock)
}

/// The bundled probe decrypts the current session and verifies the server
/// on its port before handing the app key to the shell over a private pipe.
pub fn unlock(
    node: &Path,
    code: &Path,
    port: u16,
    version: &str,
    credential: &str,
) -> Option<Arc<Key>> {
    let mut child = Command::new(node)
        .arg(code.join("apps/office/scripts/service-probe.mjs"))
        .arg(env::office_home())
        .arg(port.to_string())
        .arg(version)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.take()?.write_all(credential.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    if !out.status.success() {
        return None;
    }
    Key::adopt(std::str::from_utf8(&out.stdout).ok()?)
}

pub fn prompt(app: &AppHandle) {
    crate::loading(app, "", true);
}

#[tauri::command]
pub fn dismiss_pairing(window: tauri::WebviewWindow) {
    if window.label() != crate::LOADING {
        return;
    }
    if let Some(key) = crate::key::current() {
        let app = window.app_handle().clone();
        std::thread::spawn(move || {
            if let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1:{}", env::port())) {
                crate::open_main(&app, &url, Some(&key));
            }
        });
    }
}

#[tauri::command]
pub async fn unlock_office(window: tauri::WebviewWindow, credential: String) -> Result<(), String> {
    if window.label() != crate::LOADING {
        return Err("Open the pairing window.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let info = app.package_info();
        let port = env::port();
        let key = unlock(
            &node_binary().ok_or(NO_NODE)?,
            &server_code(info).ok_or(NO_SERVER)?,
            port,
            &info.version.to_string(),
            &credential,
        )
        .ok_or("Check the pairing code and that this version of the office is running.")?;
        crate::open_main(
            &app,
            &tauri::Url::parse(&format!("http://127.0.0.1:{port}")).map_err(|e| e.to_string())?,
            Some(&key),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn executable() -> std::io::Result<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE") {
        return Ok(path.into());
    }
    std::env::current_exe()
}

pub fn spawn_service() -> std::io::Result<std::process::Child> {
    spawn(false)
}
pub fn spawn_successor() -> std::io::Result<()> {
    let mut child = spawn(true)?;
    std::thread::spawn(move || child.wait());
    Ok(())
}
fn spawn(successor: bool) -> std::io::Result<std::process::Child> {
    let mut command = Command::new(executable()?);
    if successor {
        command.env(crate::update::RELAUNCH_FROM, std::process::id().to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00000200);
    }
    command
        .arg("--headless")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(if successor {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .spawn()
}

pub fn stop_service(package: &tauri::PackageInfo) -> bool {
    let Some(key) = crate::key::current() else {
        return false;
    };
    let Some((node, code)) = node_binary().zip(server_code(package)) else {
        return false;
    };
    let Ok(mut child) = Command::new(node)
        .arg(code.join("apps/office/scripts/service-probe.mjs"))
        .arg("--stop")
        .arg(env::office_home())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    if !child
        .stdin
        .take()
        .is_some_and(|mut input| input.write_all(key.line().as_bytes()).is_ok())
    {
        return false;
    }
    child.wait().is_ok_and(|s| s.success())
}

pub fn run(package: &tauri::PackageInfo, diagnostics: Option<&Diagnostics>) -> Result<(), String> {
    let _lease = lease().map_err(|e| format!("Could not claim this office: {e}"))?;
    let port = env::port();
    if server::port_taken(port) {
        return Err(format!("Port {port} is already in use."));
    }
    let service = office_server(
        node_binary().ok_or(NO_NODE)?,
        server_code(package).ok_or(NO_SERVER)?,
        port,
        package.version.to_string(),
        crate::update::ENABLED,
        diagnostics,
    );
    let descriptor = env::office_home().join("service.json");
    std::env::set_var("ODDBORO_SERVICE_MODE", "1");
    server::on_quit_signal(server::stop);
    let slot = crate::service_update::Slot::default();
    let watch = std::sync::Once::new();
    let result = service
        .supervise(|| {
            server::note(&service.log, "office ready without a window");
            watch.call_once(|| {
                #[cfg(not(windows))]
                crate::service_update::confirmed(&package.version);
                crate::service_update::watch(package.version.clone(), port, slot.clone());
            });
        })
        .map_err(|why| {
            if let Some(d) = diagnostics {
                d.gave_up(&why);
            }
            why.message(&service.log_tail())
        });
    if let Some(next) = slot.lock().unwrap_or_else(|e| e.into_inner()).take() {
        if let Err(e) = crate::service_update::install(next) {
            server::note(
                &service.log,
                &format!("Service upgrade failed: {e}; restarting the installed office"),
            );
            spawn_successor().map_err(|e| e.to_string())?;
        }
    }
    let _ = fs::remove_file(descriptor);
    result
}
