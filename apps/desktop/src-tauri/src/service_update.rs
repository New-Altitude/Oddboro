//! Signed updates owned by the supervisor. No webview or display is needed.
//! Reuse the desktop manifest, public key, signature format and the office's
//! install window. The service lease stays held through replacement.
#[cfg(not(windows))]
use crate::headless;
use crate::{env, server, update};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde_json::{json, Value};
#[cfg(not(target_os = "macos"))]
use std::io::Write;
use std::{
    error::Error,
    fs,
    io::Read,
    path::PathBuf,
    sync::{
        mpsc::{channel, RecvTimeoutError},
        Arc,
    },
    thread,
    time::Duration,
};
#[cfg(target_os = "macos")]
use std::{io, path::Path};
#[cfg(target_os = "linux")]
use std::{io, path::Path};
use tauri_plugin_updater::RemoteRelease;

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;
const LIMIT: u64 = 512 * 1024 * 1024;
const CONF: &str = include_str!("../tauri.conf.json");
#[cfg(not(windows))]
const BACKUP: &str = ".oddboro-before-update";
struct Release {
    version: Version,
    notes: String,
    bytes: Vec<u8>,
}
fn read_url(url: &str, limit: u64, timeout: u64) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err("Update downloads require HTTPS".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(timeout))
        .build()?;
    let res = client
        .get(url)
        .header("User-Agent", "Oddboro updater")
        .send()?
        .error_for_status()?;
    let mut buf = Vec::new();
    res.take(limit + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > limit {
        return Err("Update exceeds the download limit".into());
    }
    Ok(buf)
}
fn verify(bytes: &[u8], signature: &str, key: &str, version: &Version) -> Result<()> {
    let key = PublicKey::decode(std::str::from_utf8(&STANDARD.decode(key)?)?)?;
    let sig = Signature::decode(std::str::from_utf8(&STANDARD.decode(signature)?)?)?;
    key.verify(bytes, &sig, true)?;
    let signed = sig
        .trusted_comment()
        .split('\t')
        .find_map(|v| v.strip_prefix("version:"))
        .ok_or("The update has no signed version")?;
    if &Version::parse(signed.trim_start_matches('v'))? != version {
        return Err("The signed version differs from the release".into());
    }
    Ok(())
}
fn check(current: &Version) -> Result<Option<Release>> {
    let conf: Value = serde_json::from_str(CONF)?;
    let cfg = &conf["plugins"]["updater"];
    let configured = cfg["endpoints"][0]
        .as_str()
        .ok_or("Missing updater endpoint")?;
    let endpoint = std::env::var("ODDBORO_UPDATE_URL").unwrap_or_else(|_| configured.to_owned());
    let release: RemoteRelease = serde_json::from_slice(&read_url(&endpoint, 1024 * 1024, 8)?)?;
    if release.version <= *current {
        return Ok(None);
    }
    let target = tauri_plugin_updater::target().ok_or("Unsupported update platform")?;
    let bytes = read_url(release.download_url(&target)?.as_str(), LIMIT, 900)?;
    verify(
        &bytes,
        release.signature(&target)?,
        cfg["pubkey"].as_str().ok_or("Missing release key")?,
        &release.version,
    )?;
    Ok(Some(Release {
        version: release.version,
        notes: release.notes.unwrap_or_default(),
        bytes,
    }))
}

pub struct Pending {
    pub path: PathBuf,
    #[cfg(not(windows))]
    version: Version,
    dir: tempfile::TempDir,
}
#[cfg(target_os = "macos")]
fn installed_path() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let bundle = exe.ancestors().nth(3).ok_or("Not an installed Mac app")?;
    if bundle.extension().is_none_or(|x| x != "app") {
        return Err("Not an installed Mac app".into());
    }
    Ok(bundle.into())
}
#[cfg(target_os = "linux")]
fn installed_path() -> Result<PathBuf> {
    Ok(std::env::var_os("APPIMAGE")
        .ok_or("Not running from an AppImage")?
        .into())
}
#[cfg(windows)]
fn installed_path() -> Result<PathBuf> {
    Ok(std::env::current_exe()?)
}

fn prepare(release: &Release) -> Result<Pending> {
    let current = installed_path()?;
    let parent = current.parent().ok_or("Missing installation directory")?;
    #[cfg(not(windows))]
    let dir = tempfile::Builder::new()
        .prefix(".oddboro-update-")
        .tempdir_in(parent)?;
    #[cfg(windows)]
    let dir = {
        let _ = parent;
        tempfile::Builder::new()
            .prefix("oddboro-update-")
            .tempdir()?
    };
    #[cfg(target_os = "macos")]
    let path = {
        let dest = dir.path().join("Oddboro.app");
        tar::Archive::new(flate2::read::GzDecoder::new(release.bytes.as_slice()))
            .unpack(dir.path())?;
        if !dest.join("Contents/MacOS/oddboro").is_file() {
            return Err("Update contains no Oddboro app".into());
        }
        dest
    };
    #[cfg(not(target_os = "macos"))]
    let path = {
        let p = dir.path().join(if cfg!(windows) {
            "Oddboro-setup.exe"
        } else {
            "Oddboro.AppImage"
        });
        let mut f = fs::File::create(&p)?;
        f.write_all(&release.bytes)?;
        f.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(fs::Permissions::from_mode(0o755))?;
        }
        p
    };
    Ok(Pending {
        path,
        dir,
        #[cfg(not(windows))]
        version: release.version.clone(),
    })
}
// Atomic replacement keeps the previous bundle until this version starts and
// answers /api/health. A platform that will not permit the swap fails before
// either installation is moved.
#[cfg(target_os = "macos")]
fn exchange(current: &Path, new: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let a = CString::new(current.as_os_str().as_bytes())?;
    let b = CString::new(new.as_os_str().as_bytes())?;
    // SAFETY: both paths are live nul-terminated strings for renamex_np.
    if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(windows))]
fn backup(current: &Path) -> Result<PathBuf> {
    let name = current
        .file_name()
        .ok_or("No application name")?
        .to_string_lossy();
    Ok(current.with_file_name(format!("{name}{BACKUP}")))
}
#[cfg(not(windows))]
fn remove_backup(path: &Path) -> io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}
#[cfg(not(windows))]
fn record() -> PathBuf {
    env::office_home().join("service-update.json")
}
#[cfg(not(windows))]
fn same_record(old: &Path, version: &Version) -> bool {
    let Ok(bytes) = fs::read(record()) else {
        return false;
    };
    serde_json::from_slice::<Value>(&bytes)
        .is_ok_and(|r| r == json!({"backup":old,"version":version.to_string()}))
}
pub fn confirmed(_version: &Version) {
    if !update::ENABLED {
        return;
    }
    #[cfg(not(windows))]
    if let Ok(path) = installed_path().and_then(|p| backup(&p)) {
        if same_record(&path, _version) && (!path.exists() || remove_backup(&path).is_ok()) {
            let _ = fs::remove_file(record());
        }
    }
}
pub fn install(pending: Pending) -> Result<()> {
    #[cfg(not(windows))]
    {
        let current = installed_path()?;
        let old = backup(&current)?;
        if old.exists() {
            return Err("An earlier upgrade backup still exists; check the office log".into());
        }
        fs::write(
            record(),
            serde_json::to_vec(&json!({"backup":old,"version":pending.version.to_string()}))?,
        )?;
        #[cfg(target_os = "macos")]
        {
            exchange(&current, &pending.path)?;
            if let Err(e) = fs::rename(&pending.path, &old) {
                // Keep both installations if rollback also fails.
                if exchange(&current, &pending.path).is_err() {
                    let _ = pending.dir.keep();
                }
                return Err(e.into());
            }
        }
        #[cfg(target_os = "linux")]
        {
            fs::hard_link(&current, &old)?;
            if let Err(e) = fs::rename(&pending.path, &current) {
                let _ = fs::remove_file(old);
                return Err(e.into());
            }
        }
        // Use the stable installation path, never an old AppImage mount.
        let _keep_until_restart = &pending.dir;
        if let Err(e) = headless::spawn_successor() {
            #[cfg(target_os = "macos")]
            exchange(&current, &old)?;
            #[cfg(target_os = "linux")]
            fs::rename(&old, &current)?;
            return Err(e.into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&pending.path)
            .args(["/S", "/UPDATE", "/R", "/ARGS", "--headless"])
            .creation_flags(0x08000000)
            .spawn()?;
        // NSIS opens its own file after CreateProcess. Do not remove it while it runs.
        let _ = pending.dir.keep();
    }
    Ok(())
}
pub type Slot = Arc<std::sync::Mutex<Option<Pending>>>;
pub fn watch(version: Version, port: u16, token: String, slot: Slot) {
    if !update::ENABLED {
        return;
    }
    let (tx, rx) = channel();
    if update::set_checks(tx).is_err() {
        return;
    }
    thread::spawn(move || {
        let mut first = true;
        loop {
            if !first
                && matches!(
                    rx.recv_timeout(Duration::from_secs(4 * 60 * 60)),
                    Err(RecvTimeoutError::Disconnected)
                )
            {
                return;
            }
            first = false;
            let result = check(&version).and_then(|release| {
                let Some(r) = release else {
                    update::ask(port, &token, "POST", Some(&json!({"checked":true})));
                    return Ok(false);
                };
                let prepared = prepare(&r)?;
                let ready = json!({"version":r.version.to_string(),"notes":r.notes});
                loop {
                    let status = update::ask(port, &token, "GET", None);
                    if status
                        .as_ref()
                        .is_some_and(|s| s["ready"] == true && s["version"] == ready["version"])
                    {
                        if status.as_ref().is_some_and(|s| s["install"] == true) {
                            break;
                        }
                    } else {
                        update::ask(port, &token, "POST", Some(&ready));
                    }
                    thread::sleep(Duration::from_secs(30));
                }
                *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(prepared);
                server::stop();
                Ok(true)
            });
            match result {
                Ok(true) => return,
                Ok(false) => (),
                Err(e) => {
                    let message = e.to_string();
                    server::note(
                        &env::log_file(),
                        &format!("service update deferred: {message}"),
                    );
                    update::ask(port, &token, "POST", Some(&json!({"failed":message})));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_signed_version_and_bytes_must_both_match_the_release() {
        let key = include_str!("../../test/fixtures/service-update/release.pub").trim();
        let sig = include_str!("../../test/fixtures/service-update/payload.sig").trim();
        let version = Version::parse("1.2.3").unwrap();
        assert!(verify(b"Oddboro test release", sig, key, &version).is_ok());
        assert!(verify(b"altered bytes", sig, key, &version).is_err());
        assert!(verify(
            b"Oddboro test release",
            sig,
            key,
            &Version::parse("9.9.9").unwrap()
        )
        .is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn a_bundle_swap_keeps_both_versions_and_can_be_reversed() {
        let parent = tempfile::tempdir().unwrap();
        let a = parent.path().join("Installed.app");
        let b = parent.path().join("Staged.app");
        for (p, v) in [(&a, "1"), (&b, "2")] {
            fs::create_dir(p).unwrap();
            fs::write(p.join("version"), v).unwrap();
        }
        exchange(&a, &b).unwrap();
        assert_eq!(fs::read(a.join("version")).unwrap(), b"2");
        assert_eq!(fs::read(b.join("version")).unwrap(), b"1");
        exchange(&a, &b).unwrap();
        assert_eq!(fs::read(a.join("version")).unwrap(), b"1");
    }
}
