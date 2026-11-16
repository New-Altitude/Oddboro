//! The shell's error reports: a panic, the office given up on, or a broken
//! install. They leave only after the owner's yes in the office's settings.
//! Nothing is built until there is something to send, so an idle shell runs
//! no thread or timer for reports. Reports to New Altitude go only while the
//! office is signed in to a New Altitude account, each with its access token.

use std::borrow::Cow;
use std::fs;
use std::panic;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Url;
use sentry::integrations::backtrace::ProcessStacktraceIntegration;
use sentry::integrations::contexts::ContextIntegration;
use sentry::integrations::debug_images::DebugImagesIntegration;
use sentry::integrations::panic::PanicIntegration;
use sentry::protocol::{
    Context, DebugImage, DeviceContext, Event, Exception, Level, Map, Mechanism, Stacktrace,
};
use sentry::transports::{DefaultTransportFactory, ReqwestHttpTransportOptions};
use sentry::types::Dsn;
use sentry::{ClientOptions, Integration, Transport, TransportFactory, TransportOptions};

use crate::env;
use crate::server::GaveUp;

const DSN_KEY: &str = "ODDBORO_DIAGNOSTICS_DSN";
/// The New Altitude site the office signs in to, set only in development
/// and tests. Reports to it need the sign-in too.
const ACCOUNT_SITE_KEY: &str = "ODDBORO_ACCOUNT_SITE";
/// Where the office keeps its New Altitude sign-in in the system's secret
/// store on Linux: the service every Oddboro secret sits under and the
/// sign-in's name, as `packages/ledger/src/secrets.ts` and
/// `apps/office/src/lib/server/account.ts` write them. On a Mac the app's
/// office keeps it through this shell, under `secrets::SERVICE`.
const SECRET_SERVICE: &str = "oddboro";
const SIGN_IN: &str = "new-altitude-account:oauth";
/// A token with less left than this is not sent. The office refreshes the
/// sign-in; the shell only reads it, so a report waits for the office.
const SIGN_IN_MARGIN: Duration = Duration::from_secs(60);
/// A program and its arguments.
type Reader = (&'static str, &'static [&'static str]);
/// How the office reads a secret on Linux, through the session's keyring.
const KEYRING_READ: Reader = (
    "secret-tool",
    &["lookup", "service", SECRET_SERVICE, "account", SIGN_IN],
);
/// The owner's answer, which the office's Setup writes.
const ANSWER_KEY: &str = "OFFICE_DIAGNOSTICS";
/// The most a report may hold up the dialog or the panic that sent it.
const SEND_TIMEOUT: Duration = Duration::from_secs(2);
const WITHHELD: &str = "[withheld]";
/// Sent in place of the computer's name.
const SERVER_NAME: &str = "oddboro-shell";
const EXIT_CODE: &str = "exit_code";
const KEPT_CONTEXTS: [&str; 3] = ["os", "rust", "device"];
/// Where a release names the repo in the shell's own frames: the build maps
/// the checkout's path to this (`PATH_MAPS` in `apps/desktop/scripts/release.ts`).
/// Not the checkout's own path, which would put the builder's home folder in
/// the binary.
const ROOT: &str = "/oddboro";

/// One panic report per run. A later panic most often follows from the
/// first, and a panic while a report is being sent must not send another.
static PANIC_REPORTED: AtomicBool = AtomicBool::new(false);

pub struct Diagnostics {
    /// The address as found, so Node gets the same text the shell uses.
    dsn: String,
    /// The office's settings file, which holds the owner's answer.
    settings: PathBuf,
    /// Paths under it leave as their file name alone (`report_path`).
    home: PathBuf,
    /// Whether reports to `dsn` need the office's New Altitude sign-in.
    needs_sign_in: bool,
    /// Reads the office's saved sign-in: `read_sign_in`, or a test's own.
    sign_in: fn() -> Option<String>,
}

impl Diagnostics {
    /// None when no report address is set or it is not a DSN: then the
    /// shell reports nothing and installs no panic hook.
    pub fn find() -> Option<Self> {
        // The rule `ENV_FILE` follows in `packages/ledger/src/env.ts`, for
        // the app, where the office's settings live in its home.
        let settings = std::env::var_os("ODDBORO_ENV")
            .map_or_else(|| env::office_home().join(".env"), PathBuf::from);
        Self::from_settings(
            |key| std::env::var(key).ok(),
            option_env!("ODDBORO_DIAGNOSTICS_DSN"),
            settings,
        )
    }

    /// `find` with the shell's environment, the address built into the
    /// release and the settings file given, so a test can give its own. The
    /// account site comes from the environment or the settings file only: a
    /// release builds in no site.
    fn from_settings(
        environment: impl Fn(&str) -> Option<String>,
        built_dsn: Option<&str>,
        settings: PathBuf,
    ) -> Option<Self> {
        let dsn = find_setting(DSN_KEY, environment(DSN_KEY), built_dsn, &settings)?;
        dsn.parse::<Dsn>().ok()?;
        let account_site = find_setting(
            ACCOUNT_SITE_KEY,
            environment(ACCOUNT_SITE_KEY),
            None,
            &settings,
        );
        Some(Self {
            needs_sign_in: needs_sign_in(&dsn, account_site.as_deref()),
            dsn,
            settings,
            home: env::home(),
            sign_in: read_sign_in,
        })
    }

    pub fn dsn(&self) -> &str {
        &self.dsn
    }

    /// Read at send time, so the owner's latest answer holds. A missing or
    /// unreadable file means no.
    fn allowed(&self) -> bool {
        setting(&self.settings, ANSWER_KEY).as_deref() == Some("yes")
    }

    /// Reports a panic, then hands it on to the hook that was there before.
    pub fn watch_panics(self: Arc<Self>) {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if self.allowed() && !PANIC_REPORTED.swap(true, SeqCst) {
                // Never registered with a client, so it installs no hook of
                // its own; it only turns the panic into an event.
                self.send(PanicIntegration::new().event_from_panic_info(info), None);
            }
            previous(info);
        }));
    }

    /// Reports why the shell gave up on the office: a fixed text and Node's
    /// exit code, never the log.
    pub fn gave_up(&self, why: &GaveUp) {
        let tags = match why {
            GaveUp::KeptStopping { code: Some(code) } => {
                Map::from([(EXIT_CODE.to_string(), code.to_string())])
            }
            _ => Map::new(),
        };
        self.send_fixed(why.report(), tags);
    }

    /// Reports a broken install with the fixed text the owner is shown.
    pub fn failed(&self, text: &'static str) {
        self.send_fixed(text, Map::new());
    }

    fn send_fixed(&self, text: &'static str, tags: Map<String, String>) {
        let event = Event {
            level: Level::Fatal,
            message: Some(text.to_string()),
            tags,
            ..Default::default()
        };
        self.send(event, Some(text));
    }

    /// Sends one event, if the owner said yes. `fixed` is the one message
    /// text it may keep. The client lives only for this event.
    fn send(&self, event: Event<'static>, fixed: Option<&'static str>) {
        if !self.allowed() {
            return;
        }
        let home = self.home.to_string_lossy().into_owned();
        let integrations: [Arc<dyn Integration>; 3] = [
            Arc::new(ContextIntegration::new()),
            Arc::new(DebugImagesIntegration::new()),
            Arc::new(ProcessStacktraceIntegration::new()),
        ];
        let mut options = ClientOptions::new()
            .release(format!("oddboro@{}", env!("CARGO_PKG_VERSION")))
            // Set before `ContextIntegration` runs, which fills in the
            // computer's name only when this is empty.
            .server_name(SERVER_NAME)
            .default_integrations(false)
            .integrations(integrations)
            .before_send(move |event| Some(scrub(event, &home, fixed)));
        // Not `ClientOptions::dsn`, which panics on a bad value, and this may
        // run inside the panic hook. `find` already checked it.
        options.dsn = self.dsn.parse().ok();
        let sign_in = self.needs_sign_in.then_some(self.sign_in);

        let (sent, done) = mpsc::channel();
        // On its own thread, so a door that never answers holds up the caller
        // for `SEND_TIMEOUT` at most: `close` waits that long for the queue,
        // then joins the transport's thread however long its request takes.
        // Reading the sign-in, which may wait on a locked keyring, counts in
        // the same wait.
        let sender = thread::Builder::new()
            .name("oddboro-report".into())
            .spawn(move || {
                // `rustls-no-provider` leaves the crypto provider to the
                // process. The updater installs ring only when it checks, so
                // it may be there already, which is fine. A client is built
                // only with one installed.
                let _ = rustls::crypto::ring::default_provider().install_default();
                options.transport = match sign_in {
                    None => Some(Arc::new(DefaultTransportFactory)),
                    Some(read) => {
                        // Signed out, an expired token, or a client that
                        // could not be built: the report is dropped, and
                        // dropping `sent` lets the caller go at once.
                        let Some(client) = read()
                            .and_then(|saved| access_token(&saved, now_ms()))
                            .and_then(|token| signed_client(&token))
                        else {
                            return;
                        };
                        Some(Arc::new(SignedIn(client)))
                    }
                };
                let client = sentry::Client::from(options);
                client.capture_event(event, None);
                client.close(Some(SEND_TIMEOUT));
                let _ = sent.send(());
            });
        // A thread that could not start sends nothing; a report is never
        // worth more than the dialog or the panic waiting on it.
        if sender.is_ok() {
            let _ = done.recv_timeout(SEND_TIMEOUT);
        }
    }
}

/// A setting such as the report address, first found wins: the shell's
/// environment, the value built into the release, then the settings file. An
/// empty value counts as unset at every step: a release built with the
/// variable unset gets `Some("")`.
fn find_setting(
    key: &str,
    environment: Option<String>,
    built: Option<&str>,
    settings: &Path,
) -> Option<String> {
    environment
        .filter(|v| !v.is_empty())
        .or_else(|| built.filter(|v| !v.is_empty()).map(str::to_string))
        .or_else(|| setting(settings, key).filter(|v| !v.is_empty()))
}

/// Whether reports sent to this address need a New Altitude sign-in: New
/// Altitude's own address over https, or the account site itself when one is
/// set (a stand-in in development and tests, whose port may differ). The
/// office's `needsSignIn` in `apps/office/src/lib/diagnostics.ts` is the
/// same rule, and both are tested against `needs-sign-in.cases.json`.
fn needs_sign_in(dsn: &str, account_site: Option<&str>) -> bool {
    let Ok(to) = Url::parse(dsn) else {
        return false;
    };
    let Some(host) = to.host_str() else {
        return false;
    };
    let own = host == "newaltitude.ai" || host.ends_with(".newaltitude.ai");
    let site = account_site.and_then(|site| Url::parse(site).ok());
    (to.scheme() == "https" && own) || site.is_some_and(|site| site.host_str() == Some(host))
}

/// Milliseconds since 1970, as the office's `Date.now()` saves them.
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis())
}

/// The access token in the office's saved sign-in, when it has at least
/// `SIGN_IN_MARGIN` left. The office saves `{ tokens, savedAt }`, with the
/// token's lifetime in seconds and the time saved in milliseconds.
fn access_token(saved: &str, now_ms: u128) -> Option<String> {
    let saved: serde_json::Value = serde_json::from_str(saved).ok()?;
    let token = saved["tokens"]["access_token"].as_str()?;
    let lasts_s = saved["tokens"]["expires_in"].as_u64()?;
    let saved_at = saved["savedAt"].as_u64()?;
    let expires = u128::from(saved_at) + u128::from(lasts_s) * 1000;
    (expires > now_ms + SIGN_IN_MARGIN.as_millis()).then(|| token.to_string())
}

/// The command that reads the office's sign-in on this system. None on a
/// Mac, where the shell reads its own Keychain (`keychain_sign_in`), and on
/// Windows, where the office keeps it in the Credential Manager in pieces
/// the shell does not read, so its reports to New Altitude are dropped.
fn sign_in_command() -> Option<Reader> {
    // `cfg!`, not `#[cfg]`, so every system's branch compiles everywhere.
    cfg!(target_os = "linux").then_some(KEYRING_READ)
}

/// The office's sign-in in the app's own Keychain items, which trust only
/// this app, so the read needs no prompt (`secrets.rs`).
#[cfg(target_os = "macos")]
fn keychain_sign_in() -> Option<String> {
    let value =
        security_framework::passwords::get_generic_password(crate::secrets::SERVICE, SIGN_IN)
            .ok()?;
    String::from_utf8(value).ok()
}

#[cfg(not(target_os = "macos"))]
fn keychain_sign_in() -> Option<String> {
    None
}

/// The office's saved sign-in, read from the secret store the office keeps
/// it in. Never refreshed or written here. None when there is none, the
/// read fails, or the system has no way to it.
fn read_sign_in() -> Option<String> {
    if cfg!(target_os = "macos") {
        return keychain_sign_in();
    }
    let (program, args) = sign_in_command()?;
    let read = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !read.status.success() {
        return None;
    }
    // A line break after the value would not matter: JSON reads past it.
    String::from_utf8(read.stdout).ok()
}

/// A client that sends the account's token with every request, marked
/// sensitive so no debug output prints it.
fn signed_client(token: &str) -> Option<reqwest::Client> {
    let mut bearer = HeaderValue::from_str(&format!("Bearer {token}")).ok()?;
    bearer.set_sensitive(true);
    reqwest::Client::builder()
        .default_headers(HeaderMap::from_iter([(AUTHORIZATION, bearer)]))
        .build()
        .ok()
}

/// Sentry's own transport, on a client that carries the sign-in.
struct SignedIn(reqwest::Client);

impl TransportFactory for SignedIn {
    fn create_transport_with_options(&self, options: TransportOptions) -> Arc<dyn Transport> {
        Arc::new(
            ReqwestHttpTransportOptions::from(options)
                .with_client(self.0.clone())
                .build(),
        )
    }
}

/// A key's value in a settings file, read as `readEnv` in
/// `packages/ledger/src/env.ts` reads it: the last `KEY=value` line wins.
fn setting(file: &Path, key: &str) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    text.lines()
        .rev()
        .filter_map(|line| line.trim().split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, value)| value.to_string())
}

/// The one rule every shell report passes on its way out, an allow-list: an
/// event leaves with only the fields named here. A message is kept only when
/// it is `fixed`, the text the code sent; an exception's value never is,
/// since a panic's message is free text (`unwrap` and `expect` print values
/// and paths). File and line stay: they are code. No user, extra, request
/// or breadcrumbs.
fn scrub(event: Event<'static>, home: &str, fixed: Option<&str>) -> Event<'static> {
    let exception: Vec<Exception> = event
        .exception
        .values
        .into_iter()
        .map(|e| Exception {
            ty: e.ty,
            value: e.value.map(|_| WITHHELD.to_string()),
            stacktrace: e.stacktrace.map(|s| stacktrace_report_paths(s, home)),
            thread_id: e.thread_id,
            mechanism: e.mechanism.map(|m| Mechanism {
                ty: m.ty,
                handled: m.handled,
                ..Default::default()
            }),
            ..Default::default()
        })
        .collect();
    let mut debug_meta = event.debug_meta.into_owned();
    debug_meta.images = debug_meta
        .images
        .into_iter()
        .map(image_file_names)
        .collect();
    Event {
        event_id: event.event_id,
        level: event.level,
        timestamp: event.timestamp,
        platform: event.platform,
        release: event.release,
        environment: event.environment,
        server_name: event.server_name,
        sdk: event.sdk,
        message: event.message.map(|m| {
            if Some(m.as_str()) == fixed {
                m
            } else {
                WITHHELD.to_string()
            }
        }),
        tags: event
            .tags
            .into_iter()
            .filter(|(k, _)| k == EXIT_CODE)
            .collect(),
        contexts: event
            .contexts
            .into_iter()
            .filter(|(k, _)| KEPT_CONTEXTS.contains(&k.as_str()))
            .map(|(k, context)| match k.as_str() {
                "device" => (k, chip_only(context)),
                _ => (k, context),
            })
            .collect(),
        exception: exception.into(),
        debug_meta: Cow::Owned(debug_meta),
        ..Default::default()
    }
}

fn stacktrace_report_paths(mut stacktrace: Stacktrace, home: &str) -> Stacktrace {
    for frame in &mut stacktrace.frames {
        frame.abs_path = frame.abs_path.as_deref().map(|p| report_path(p, home));
        frame.filename = frame.filename.as_deref().map(|p| report_path(p, home));
    }
    stacktrace
}

/// The device context with only the chip's architecture, the part the
/// privacy policy names. On a Mac the context also holds the model
/// (`MacBookPro18,3`) and its family.
fn chip_only(context: Context) -> Context {
    let arch = match context {
        Context::Device(device) => device.arch,
        _ => None,
    };
    DeviceContext {
        arch,
        ..Default::default()
    }
    .into()
}

/// A debug image as its file names alone. It names a loaded file wherever it
/// was installed, in a folder the owner may have named (`D:\Ada Quill\Apps`,
/// `/Volumes/<name>`). Sentry matches debug files by their id, not their path.
fn image_file_names(image: DebugImage) -> DebugImage {
    match image {
        DebugImage::Apple(mut i) => {
            i.name = file_name(&i.name).to_string();
            DebugImage::Apple(i)
        }
        DebugImage::Symbolic(mut i) => {
            i.name = file_name(&i.name).to_string();
            i.debug_file = i.debug_file.map(|f| file_name(&f).to_string());
            DebugImage::Symbolic(i)
        }
        DebugImage::Wasm(mut i) => {
            i.code_file = file_name(&i.code_file).to_string();
            i.debug_file = i.debug_file.map(|f| file_name(&f).to_string());
            DebugImage::Wasm(i)
        }
        // A UUID, no path.
        DebugImage::Proguard(i) => DebugImage::Proguard(i),
    }
}

/// The last part of a path, by either kind of slash.
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or_default()
}

/// Forward slashes and no drive letter, so a Windows path and its folder
/// compare the same way a Unix one does.
fn comparable(path: &str) -> String {
    let path = path.replace('\\', "/");
    match path.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => path[2..].to_string(),
        _ => path,
    }
}

/// `path` relative to `folder` when it lies inside it.
fn inside<'a>(path: &'a str, folder: &str) -> Option<&'a str> {
    // `env::home()` is `/` when no home is set, which is no folder to hide.
    if folder.len() < 2 {
        return None;
    }
    path.strip_prefix(&format!("{}/", comparable(folder).trim_end_matches('/')))
}

/// A file path as a report may carry it, by the office's rule (`reportPath`
/// in `apps/office/src/lib/diagnostics.ts`). Under Oddboro's own code it
/// becomes relative to it; inside a package, it keeps the part from
/// `node_modules/` on; anywhere else under the home folder it becomes its
/// file name alone, since the folders there can name the owner's work. A path
/// outside the home folder (a system library, the installed app) stays as it
/// is, and so does anything that is not a file path.
fn report_path(path: &str, home: &str) -> String {
    let file = match path.as_bytes() {
        [b'/' | b'\\', ..] => true,
        [drive, b':', b'/' | b'\\', ..] => drive.is_ascii_alphabetic(),
        _ => false,
    };
    if !file {
        return path.to_string();
    }
    let p = comparable(path);
    if let Some(own) = inside(&p, ROOT) {
        return own.to_string();
    }
    if let Some(at) = p.find("/node_modules/") {
        return p[at + 1..].to_string();
    }
    if inside(&p, home).is_some() {
        return file_name(&p).to_string();
    }
    path.to_string()
}

#[cfg(test)]
mod tests;
