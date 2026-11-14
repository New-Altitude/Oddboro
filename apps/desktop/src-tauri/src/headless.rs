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
        false,
        diagnostics,
    );
    let descriptor = env::office_home().join("service.json");
    std::env::set_var("ODDBORO_SERVICE_MODE", "1");
    server::on_quit_signal(server::stop);
    let result = service
        .supervise(|| server::note(&service.log, "office ready without a window"))
        .map_err(|why| why.message(&service.log_tail()));
    let _ = fs::remove_file(descriptor);
    result
}
