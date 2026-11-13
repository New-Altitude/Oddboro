//! Whether an address is this office, proven before a page carrying the
//! owner's key loads there. Anything can listen on the office's port while
//! the office is not on it, and any reply at all would pass a check that only
//! asks whether something answers. So the shell sends no key: it asks the
//! office's keyless proof route for a hash of the key with a fresh nonce, and
//! only the office, which holds the key, can answer it. The office side and
//! the release scripts' prover are `packages/ledger/src/office-proof.ts`; a
//! test here checks the same known answer as that file's test.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::{Duration, Instant};

use ring::hmac;
use tauri::Url;

use crate::env::OWNER_KEY_FILE;

/// The office's proof route with its nonce parameter (`OFFICE_PROOF_PATH`
/// and `NONCE_PARAM` in office-proof.ts).
const PROOF_PATH: &str = "/api/office-proof?n=";
/// The listener the shell expects to answer: the office itself. The shell
/// never opens its office through Caddy, so an answer made for Caddy fails.
const DIRECT: &str = "direct";
/// A proof is one small request on this computer; one slower than this is no answer.
const TIMEOUT: Duration = Duration::from_secs(3);
/// An answer is a short head and 64 hex characters; anything much longer is not one.
const MOST: usize = 4096;

/// The owner's key from the office's folder `home`, once the office at `url`
/// proves it holds that key. None when there is no key file, or when anything
/// else answered. The key itself never leaves the shell here.
pub fn proven_key(home: &Path, url: &Url) -> Option<String> {
    let key = std::fs::read_to_string(home.join(OWNER_KEY_FILE)).ok()?;
    let key = key.trim();
    (!key.is_empty() && proves_office(url, key)).then(|| key.to_string())
}

/// Each address the URL's name resolves to must answer the proof, so a relay
/// on `[::1]` beside the office's `127.0.0.1` fails the name. Nothing is sent
/// when any address is not loopback.
fn proves_office(url: &Url, key: &str) -> bool {
    let (Some(addresses), Some(name)) = (loopback_addresses(url), url.host_str()) else {
        return false;
    };
    // The Host header is the name and port the page will load at.
    let host = match url.port() {
        Some(port) => format!("{name}:{port}"),
        None => name.to_string(),
    };
    addresses
        .into_iter()
        .all(|address| proves_at(address, &host, key))
}

/// Every address an http URL's name stands for, when each is exactly
/// 127.0.0.1 or ::1. The office holds only those two, so any other address,
/// another one in 127/8 included, could be anything. An IP address is taken
/// as written; a name is resolved once, and its addresses are what the proof
/// connects to. None for https, for no name, or for any other address.
fn loopback_addresses(url: &Url) -> Option<Vec<SocketAddr>> {
    if url.scheme() != "http" {
        return None;
    }
    let port = url.port_or_known_default()?;
    // A URL writes an IPv6 address in brackets, which neither parses.
    let name = url
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']');
    let mut found: Vec<SocketAddr> = match name.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => (name, port).to_socket_addrs().ok()?.collect(),
    };
    found.sort_unstable();
    found.dedup();
    let loopback = [
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(Ipv6Addr::LOCALHOST),
    ];
    (!found.is_empty() && found.iter().all(|a| loopback.contains(&a.ip()))).then_some(found)
}

/// One proof at one address, with a fresh nonce, no cookie and no key. It
/// follows no redirect: only a 200 holding the right hash proves.
fn proves_at(address: SocketAddr, host: &str, key: &str) -> bool {
    let Some(nonce) = nonce() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, TIMEOUT) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    // HTTP/1.0, so Node answers with the bare body and then closes, never in
    // chunks.
    let request = format!("GET {PROOF_PATH}{nonce} HTTP/1.0\r\nHost: {host}\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    read_whole(&mut stream).is_some_and(|response| is_proof(&response, key, &nonce))
}

/// The whole response, read until the far end closes. None when it is longer
/// than an answer could be or takes longer than the timeout, so a listener
/// that sends slowly cannot hold the shell.
fn read_whole(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let deadline = Instant::now() + TIMEOUT;
    let mut response = Vec::new();
    let mut chunk = [0u8; 512];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || response.len() > MOST {
            return None;
        }
        stream.set_read_timeout(Some(left)).ok()?;
        match stream.read(&mut chunk).ok()? {
            0 => return Some(response),
            n => response.extend_from_slice(&chunk[..n]),
        }
    }
}

/// Whether `response` is a 200 whose body is the office's answer to `nonce`
/// for a direct request: the hex of HMAC-SHA256 over `<nonce>|direct`, keyed
/// with the key's text. ring compares the hash in constant time.
fn is_proof(response: &[u8], key: &str, nonce: &str) -> bool {
    let Some(split) = response.windows(4).position(|w| w == b"\r\n\r\n") else {
        return false;
    };
    let status_line = response[..split].split(|b| *b == b'\r').next();
    let ok = status_line
        .and_then(|line| line.split(|b| *b == b' ').nth(1))
        .is_some_and(|status| status == b"200");
    let Some(hash) = from_hex(&response[split + 4..]) else {
        return false;
    };
    let key = hmac::Key::new(hmac::HMAC_SHA256, key.as_bytes());
    ok && hmac::verify(&key, format!("{nonce}|{DIRECT}").as_bytes(), &hash).is_ok()
}

/// 16 random bytes in lowercase hex, the nonce shape the proof route takes.
fn nonce() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Lowercase hex as the office writes it, back to bytes. None for anything else.
fn from_hex(text: &[u8]) -> Option<Vec<u8>> {
    let digit = |b: u8| match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    };
    if !text.len().is_multiple_of(2) {
        return None;
    }
    text.chunks(2)
        .map(|pair| Some((digit(pair[0])? << 4) | digit(pair[1])?))
        .collect()
}

/// Stand-ins for the office and for squatters on a free port, for this
/// file's tests and the server's.
#[cfg(test)]
pub mod stand_in {
    use std::io::{BufRead, BufReader, Write};
    use std::net::{IpAddr, TcpListener};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::thread;

    use ring::hmac;

    /// A key in the shape the office makes, so no real key is near a test.
    pub const KEY: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    /// The office's answer to `nonce` for `via`, as the office's route makes it.
    pub fn answer(nonce: &str, via: &str) -> String {
        let key = hmac::Key::new(hmac::HMAC_SHA256, KEY.as_bytes());
        hmac::sign(&key, format!("{nonce}|{via}").as_bytes())
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// The nonce a request asked about, or empty.
    pub fn nonce_of(request: &str) -> String {
        request
            .split_once("?n=")
            .and_then(|(_, rest)| rest.split(' ').next())
            .unwrap_or_default()
            .to_string()
    }

    /// The office: answers the proof for a direct request.
    pub fn office(request: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\n\r\n{}",
            answer(&nonce_of(request), "direct")
        )
    }

    /// A listener on `ip` (port 0 for a free one) that keeps every request's
    /// head and answers with `reply`. None when `ip` cannot be bound here.
    pub fn listen(
        ip: IpAddr,
        port: u16,
        reply: fn(&str) -> String,
    ) -> Option<(u16, Arc<Mutex<Vec<String>>>)> {
        let listener = TcpListener::bind((ip, port)).ok()?;
        let port = listener.local_addr().ok()?.port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut head = String::new();
                let mut reader = BufReader::new(&stream);
                while reader.read_line(&mut head).is_ok_and(|n| n > 2) {}
                let response = reply(&head);
                log.lock().unwrap().push(head);
                let _ = (&stream).write_all(response.as_bytes());
            }
        });
        Some((port, seen))
    }

    /// An office folder of its own, holding `key` when one is given.
    pub fn home(name: &str, key: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oddboro-proof-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(key) = key {
            std::fs::write(dir.join(super::OWNER_KEY_FILE), format!("{key}\n")).unwrap();
        }
        dir
    }

    /// Nothing a listener saw holds the key, a cookie or the address
    /// parameter that carries the key.
    pub fn saw_no_key(seen: &Mutex<Vec<String>>) {
        let all = seen.lock().unwrap().join("\n").to_lowercase();
        for word in [KEY, "oddboro-owner", "oddboro-key", "cookie"] {
            assert!(!all.contains(&word.to_lowercase()), "a listener saw {word}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::stand_in::{answer, home, listen, nonce_of, office, saw_no_key, KEY};
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    fn v4() -> IpAddr {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    }

    /// The vector `packages/ledger/test/office-proof.test.ts` asserts, so the
    /// shell and the office cannot drift apart.
    const NONCE: &str = "00112233445566778899aabbccddeeff";
    const DIRECT_ANSWER: &str = "fe5da38501d71f0d941745ef27bdf1bd4711f009683db3e551a3a5c729988668";
    const HTTPS_ANSWER: &str = "19abd2febf443a57e45c5792a1c8ab1038892f01aed5262c386f57cea5ed860a";

    fn reply(body: &str) -> Vec<u8> {
        format!("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\n{body}").into_bytes()
    }

    #[test]
    fn the_shell_takes_the_same_known_answer_as_the_office() {
        assert!(is_proof(&reply(DIRECT_ANSWER), KEY, NONCE));
        // The answer through Caddy is a different hash, and the shell expects
        // its office directly.
        assert!(!is_proof(&reply(HTTPS_ANSWER), KEY, NONCE));
        assert!(!is_proof(&reply(&DIRECT_ANSWER.to_uppercase()), KEY, NONCE));
        assert!(!is_proof(&reply(&DIRECT_ANSWER[1..]), KEY, NONCE));
        let not_found = format!("HTTP/1.1 404 Not Found\r\n\r\n{DIRECT_ANSWER}");
        assert!(!is_proof(not_found.as_bytes(), KEY, NONCE));
        // The stand-in office makes the same answer, so the tests below prove against it.
        assert_eq!(answer(NONCE, "direct"), DIRECT_ANSWER);
    }

    #[test]
    fn the_office_holding_the_key_proves_itself_and_is_never_sent_the_key() {
        let (port, seen) = listen(v4(), 0, office).unwrap();
        let home = home("office", Some(KEY));
        let at = url(&format!("http://127.0.0.1:{port}/"));
        assert_eq!(proven_key(&home, &at).as_deref(), Some(KEY));
        saw_no_key(&seen);
        let requests = seen.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /api/office-proof?n="));
        assert!(requests[0].contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert_eq!(nonce_of(&requests[0]).len(), 32);
    }

    #[test]
    fn a_squatter_on_the_port_never_proves_and_never_sees_the_key() {
        let squatters: [fn(&str) -> String; 6] = [
            |_| "HTTP/1.1 404 Not Found\r\n\r\nnot here".into(),
            |_| "HTTP/1.1 200 OK\r\n\r\n{\"office\":true}".into(),
            // A proof captured earlier from the real office, for another nonce.
            |_| format!("HTTP/1.1 200 OK\r\n\r\n{DIRECT_ANSWER}"),
            // A relay that hands the proof to Caddy: the answer names Caddy.
            |r| {
                format!(
                    "HTTP/1.1 200 OK\r\n\r\n{}",
                    answer(&nonce_of(r), "proxy:http")
                )
            },
            // A redirect to the real office, which the proof never follows.
            |_| "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\n\r\n".into(),
            |_| String::new(),
        ];
        let home = home("squatter", Some(KEY));
        for (i, squat) in squatters.into_iter().enumerate() {
            let (port, seen) = listen(v4(), 0, squat).unwrap();
            let at = url(&format!("http://127.0.0.1:{port}/"));
            assert_eq!(proven_key(&home, &at), None, "squatter {i}");
            assert_eq!(
                seen.lock().unwrap().len(),
                1,
                "squatter {i}: one proof, nothing more"
            );
            saw_no_key(&seen);
        }
    }

    #[test]
    fn without_a_key_file_nothing_is_proven_and_nothing_is_sent() {
        let (port, seen) = listen(v4(), 0, office).unwrap();
        let home = home("no-key", None);
        assert_eq!(
            proven_key(&home, &url(&format!("http://127.0.0.1:{port}/"))),
            None
        );
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn only_an_http_address_at_exactly_127_0_0_1_or_ipv6_loopback_is_asked() {
        for good in ["http://127.0.0.1:4599/", "http://[::1]:4599/"] {
            assert_eq!(
                loopback_addresses(&url(good)).map(|a| a.len()),
                Some(1),
                "{good}"
            );
        }
        for bad in [
            "http://127.0.0.2:4599/",
            "http://192.0.2.1:4599/",
            "http://10.0.0.1/",
            "http://[::2]:4599/",
            "https://127.0.0.1:4599/",
            "http://nowhere.invalid:4599/",
            "file:///tmp/x",
        ] {
            assert_eq!(loopback_addresses(&url(bad)), None, "{bad}");
        }
        // An ODDBORO_SERVER_URL elsewhere gets no request, so no proof and no key.
        let home = home("elsewhere", Some(KEY));
        assert_eq!(proven_key(&home, &url("http://192.0.2.1:4599/")), None);
    }

    #[test]
    fn a_squatter_at_another_127_address_gets_no_request() {
        // A Mac has only 127.0.0.1 on its loopback; Linux answers all of 127/8.
        let Some((port, seen)) = listen("127.0.0.2".parse().unwrap(), 0, office) else {
            return;
        };
        let home = home("other-127", Some(KEY));
        assert_eq!(
            proven_key(&home, &url(&format!("http://127.0.0.2:{port}/"))),
            None
        );
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn a_name_is_proven_only_when_every_address_it_resolves_to_answers() {
        let v6 = IpAddr::V6(Ipv6Addr::LOCALHOST);
        let resolved: Vec<IpAddr> = ("localhost", 9)
            .to_socket_addrs()
            .map(|a| a.map(|a| a.ip()).collect())
            .unwrap_or_default();
        // The test needs `localhost` to name both loopback addresses, as a Mac's does.
        if !(resolved.contains(&v4()) && resolved.contains(&v6)) {
            return;
        }
        let (port, office_seen) = listen(v4(), 0, office).unwrap();
        let Some((_, relay_seen)) = listen(v6, port, |_| "HTTP/1.1 200 OK\r\n\r\nok".into()) else {
            return;
        };
        let home = home("every-address", Some(KEY));
        let name = url(&format!("http://localhost:{port}/"));
        assert_eq!(proven_key(&home, &name), None);
        assert_eq!(relay_seen.lock().unwrap().len(), 1);
        saw_no_key(&office_seen);
        saw_no_key(&relay_seen);

        let (both, _) = listen(v4(), 0, office).unwrap();
        if listen(v6, both, office).is_some() {
            let name = url(&format!("http://localhost:{both}/"));
            assert_eq!(proven_key(&home, &name).as_deref(), Some(KEY));
        }
    }
}
