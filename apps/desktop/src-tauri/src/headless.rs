//! Runs before Tauri initializes a display, tray, or webview. The same
//! executable still owns the Node pipes and the signed Mac Keychain identity.
use crate::{
    diagnostics::Diagnostics, env, node_binary, office_server, server, server_code, NO_NODE,
    NO_SERVER,
};

pub fn run(package: &tauri::PackageInfo, diagnostics: Option<&Diagnostics>) -> Result<(), String> {
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
    server::on_quit_signal(server::stop);
    service
        .supervise(|| server::note(&service.log, "office ready without a window"))
        .map_err(|why| why.message(&service.log_tail()))
}
