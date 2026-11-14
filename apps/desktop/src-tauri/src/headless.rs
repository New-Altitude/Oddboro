//! Runs before Tauri initializes a display, tray, or webview. The same
//! executable still owns the Node pipes and the signed Mac Keychain identity.
use crate::{
    diagnostics::Diagnostics, env, node_binary, office_server, server, server_code, NO_NODE,
    NO_SERVER,
};

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Stdio};

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

pub fn recognized(node: &Path, code: &Path, port: u16, version: &str) -> bool {
    Command::new(node)
        .arg(code.join("apps/office/scripts/service-probe.mjs"))
        .arg(env::office_home())
        .arg(port.to_string())
        .arg(version)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
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
        String::new(),
        diagnostics,
    );
    let key = format!("{}{}", crate::update::token(), crate::update::token());
    if key.len() != 64 {
        return Err("Could not create the office identity.".into());
    }
    let descriptor = env::office_home().join("service.json");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&descriptor).map_err(|e| e.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::json!({"key": key, "port": port, "version": package.version.to_string()})
    )
    .map_err(|e| e.to_string())?;
    std::env::set_var("ODDBORO_SERVICE_KEY", key);
    std::env::set_var("ODDBORO_SERVICE_MODE", "1");
    server::on_quit_signal(server::stop);
    let result = service
        .supervise(|| server::note(&service.log, "office ready without a window"))
        .map_err(|why| why.message(&service.log_tail()));
    let _ = fs::remove_file(descriptor);
    result
}
