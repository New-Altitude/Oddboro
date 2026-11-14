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

pub fn executable() -> std::io::Result<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE") {
        return Ok(path.into());
    }
    std::env::current_exe()
}

pub fn spawn_service() -> std::io::Result<()> {
    spawn(false)
}
pub fn spawn_successor() -> std::io::Result<()> {
    spawn(true)
}
fn spawn(successor: bool) -> std::io::Result<()> {
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
    let mut child = command
        .arg("--headless")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

pub fn stop_service(package: &tauri::PackageInfo) -> bool {
    node_binary()
        .zip(server_code(package))
        .is_some_and(|(node, code)| {
            Command::new(node)
                .arg(code.join("apps/office/scripts/office-cli.mjs"))
                .arg("stop")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        })
}

pub fn run(package: &tauri::PackageInfo, diagnostics: Option<&Diagnostics>) -> Result<(), String> {
    let _lease = lease().map_err(|e| format!("Could not claim this office: {e}"))?;
    let port = env::port();
    if server::port_taken(port) {
        return Err(format!("Port {port} is already in use."));
    }
    let update = if crate::update::ENABLED {
        crate::update::token()
    } else {
        String::new()
    };
    let service = office_server(
        node_binary().ok_or(NO_NODE)?,
        server_code(package).ok_or(NO_SERVER)?,
        port,
        package.version.to_string(),
        update.clone(),
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
    let slot = crate::service_update::Slot::default();
    let watch = std::sync::Once::new();
    let result = service
        .supervise(|| {
            server::note(&service.log, "office ready without a window");
            watch.call_once(|| {
                crate::service_update::confirmed(&package.version);
                crate::service_update::watch(
                    package.version.clone(),
                    port,
                    update.clone(),
                    slot.clone(),
                );
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
