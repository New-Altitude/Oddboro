//! The app's key. The office inside the app answers only requests that carry
//! it, so no other program on the computer can read the office or act in the
//! owner's name (`apps/office/src/lib/server/app-key.ts`).
//!
//! The shell makes a fresh one at every launch from the system's random
//! source and keeps it in memory. Node gets it as the first line on its
//! stdin, a pipe only the two hold. It is never in a file, the Keychain, the
//! environment, a command line, a URL or a log line: any program running as
//! the owner can read another's environment and command line (`ps -E`).
//!
//! It goes back to the office three ways: the window's HttpOnly cookie, set
//! before the window asks for anything (`cookie`); the shell's own requests,
//! in a header (`server::call`); and for the owner's browser, which has none,
//! a link the office makes that works once for one path (`main.rs`).
//!
//! `Key` has no `Debug` or `Display`, so it cannot be printed by mistake.

use tauri::webview::cookie::{Cookie, SameSite};
use tauri::Url;

/// The start of the line Node reads the key from. A line on Node's stdout
/// that holds it never reaches the log (`server::route`).
pub const LINE: &str = "oddboro:key ";
/// The cookie the window carries.
pub const COOKIE: &str = "oddboro-key";
/// The header the shell's own requests carry.
pub const HEADER: &str = "X-Oddboro-Key";
/// The query the office's one-time links for the owner's browser carry.
pub const LINK_QUERY: &str = "oddboro-link";

pub struct Key(String);

impl Key {
    /// 32 bytes from the system's random source, as 64 hex digits. None when
    /// the system has no randomness to give: the shell then cannot run the
    /// office.
    pub fn fresh() -> Option<Key> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).ok()?;
        Some(Key(bytes.iter().map(|b| format!("{b:02x}")).collect()))
    }

    /// The line Node reads first on its stdin, without its line break.
    pub fn line(&self) -> String {
        format!("{LINE}{}", self.0)
    }

    /// The header line for a request of the shell's own, without its line break.
    pub fn header(&self) -> String {
        format!("{HEADER}: {}", self.0)
    }

    /// The window's cookie for the office at `office`: HttpOnly, so no page
    /// script reads it; SameSite=Strict, so no other site's request carries
    /// it; and with no expiry, so it lives only while the app runs and the
    /// webview never writes it to disk. It never says Secure, not even
    /// false: macOS takes any value there as Secure, and then never sends it
    /// to the office over http (measured).
    pub fn cookie(&self, office: &Url) -> Cookie<'static> {
        Cookie::build((COOKIE, self.0.clone()))
            .domain(office.host_str().unwrap_or("127.0.0.1").to_string())
            .path("/")
            .http_only(true)
            .same_site(SameSite::Strict)
            .build()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(key: &Key) -> &str {
        &key.0
    }

    #[test]
    fn a_fresh_key_is_32_random_bytes_in_hex_every_time() {
        let (a, b) = (Key::fresh().unwrap(), Key::fresh().unwrap());
        for key in [&a, &b] {
            assert_eq!(hex(key).len(), 64);
            assert!(hex(key)
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
        }
        assert_ne!(hex(&a), hex(&b));
    }

    #[test]
    fn the_pipe_line_is_one_line_the_office_reads() {
        let key = Key::fresh().unwrap();
        let line = key.line();
        assert_eq!(line, format!("oddboro:key {}", hex(&key)));
        assert!(!line.contains('\n') && !line.contains('\r'));
        assert_eq!(key.header(), format!("X-Oddboro-Key: {}", hex(&key)));
    }

    #[test]
    fn the_cookie_is_http_only_strict_and_ends_with_the_app() {
        let key = Key::fresh().unwrap();
        let office = Url::parse("http://127.0.0.1:4500").unwrap();
        let cookie = key.cookie(&office);
        assert_eq!(cookie.name(), "oddboro-key");
        assert_eq!(cookie.value(), hex(&key));
        assert_eq!(cookie.domain(), Some("127.0.0.1"));
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.same_site(), Some(SameSite::Strict));
        assert_eq!(cookie.secure(), None);
        assert_eq!(cookie.max_age(), None);
        assert_eq!(cookie.expires(), None);
    }
}
