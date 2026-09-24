//! # `fub-services` — binario del backend locale (P16/P17)
//!
//! Framing HTTP con `httparse` (consolidata, già in lockfile via hyper),
//! confinata al SOLO binario servizio: nessun runtime/server/async in
//! host/kernel/ABI (il client resta `ureq` sincrono).
//!
//! Garanzie del front-end HTTP (fail-closed, dietro proxy pubblico):
//! - request-line max 8 KiB, testa totale max 32 KiB / max 64 header, oltre =
//!   414/431; path max 4 KiB, metodo solo GET/POST, versione solo HTTP/1,
//!   `Host` obbligatorio;
//! - `Transfer-Encoding` presente = 501 (niente chunked); `Content-Length`
//!   duplicata discorde o invalida = 400 (mai trattata come zero);
//!   `Expect: 100-continue` = 417; GET con corpo = 400;
//! - corpo dichiarato oltre il tetto della rotta = 413 PRIMA di allocare;
//!   short-read/timeout = 400/408; deadline ASSOLUTA dall'accettazione
//!   (10 s testata, +50 s corpo): slowloris non trattiene i worker;
//! - pool 8 worker + coda bounded 32, oltre = 503 immediato;
//! - PBKDF2 (210k round) MAI sotto il lock globale: register/login calcolano
//!   l'hash fuori dal lock (snapshot + `insert_prepared`/`check_hash`);
//!   la password dei siti è verificata fuori dal lock (record da fs);
//! - commit con custom JS senza isolamento = 422 (preflight fail-closed);
//!   serve-time con header sandbox / gate isolated-origin (vedi
//!   [`fub_services::site_isolation`]).
//!
//! Rotte servite qui: `GET /v1/hello`, account, MFA, isolamento siti.
//! `/v1/sync/*` va a `sync::handle`, `/v1/publish/*` agli handler owner,
//! e `GET /s/*` al servizio statico (record da fs, gate fuori dal lock).
//!
//! Uso:
//! ```sh
//! fub-services --data-dir ./services-data --bind 127.0.0.1:7749
//! FUB_SERVICES_DATA_DIR=./services-data fub-services
//! ```
//! Credenziali mai in argv/log/query: i token viaggiano solo in header Bearer,
//! le password statiche solo in `X-Fub-Site-Password`; nei log solo metodo + path base.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use fub_services::auth::AccountStore;
use fub_services::routing::{Hello, Route};
use fub_services::server::{parse_credentials, HttpResponse, ServiceState};

/// Tetto corpo sync-push / publish-commit (allegati a blocchi): 64 MiB.
const MAX_BODY: usize = 64 * 1024 * 1024;
/// Tetto corpi piccoli (auth/MFA/unpublish/rollback/isolation/site admin): 8 KiB.
/// Comprende anche la password massima di 1024 byte nel JSON escaped.
const SMALL_BODY: usize = 8 * 1024;
/// Tetto dry-run / pull / ack / sync secondari: 8 MiB / 1 MiB / 64 KiB.
const DRY_RUN_BODY: usize = 8 * 1024 * 1024;
const SECONDARY_BODY: usize = 1024 * 1024;
const TINY_BODY: usize = 64 * 1024;
/// Testata totale max (request-line + header): oltre = 431.
const MAX_HEAD: usize = 32 * 1024;
/// Path max: oltre = 414.
const MAX_PATH: usize = 4096;
/// Worker e coda bounded del pool.
const WORKERS: usize = 8;
const QUEUE: usize = 32;
/// Deadline assolute dall'accettazione: 10 s testata, corpo entro 60 s.
const HEAD_DEADLINE: Duration = Duration::from_secs(10);
const BODY_DEADLINE: Duration = Duration::from_secs(60);
/// Timeout per singola recv/send (rinnovato, ma sempre sotto deadline assoluta).
const IO_SLICE: Duration = Duration::from_secs(2);
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);

fn usage() -> ! {
    eprintln!("usage: fub-services [--data-dir <dir>] [--bind 127.0.0.1:7749]");
    std::process::exit(2);
}

fn main() {
    let mut data_dir: Option<PathBuf> = None;
    let mut bind = "127.0.0.1:7749".to_string();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--data-dir" => data_dir = Some(PathBuf::from(args.next().unwrap_or_else(|| usage()))),
            "--bind" => bind = args.next().unwrap_or_else(|| usage()),
            "-h" | "--help" => usage(),
            _ => usage(),
        }
    }
    let host_part = bind
        .rsplit(':')
        .nth(1)
        .unwrap_or(&bind)
        .trim_matches(['[', ']']);
    if !matches!(host_part, "127.0.0.1" | "::1" | "localhost") {
        eprintln!("refusing non-loopback bind in cleartext (production needs TLS in front)");
        std::process::exit(2);
    }
    let data_dir = data_dir.unwrap_or_else(fub_services::schema::data_dir);
    let state = Arc::new(Mutex::new(
        ServiceState::open(Some(data_dir.clone())).unwrap_or_else(|e| {
            eprintln!("cannot open state: {e}");
            std::process::exit(1);
        }),
    ));
    let listener = TcpListener::bind(&bind).unwrap_or_else(|e| {
        eprintln!("cannot bind {bind}: {e}");
        std::process::exit(1);
    });
    let (tx, rx) = std::sync::mpsc::sync_channel::<(TcpStream, Instant)>(QUEUE);
    let rx = Arc::new(Mutex::new(rx));
    for _ in 0..WORKERS {
        let rx = Arc::clone(&rx);
        let state = Arc::clone(&state);
        let data_dir = data_dir.clone();
        std::thread::spawn(move || loop {
            let (stream, accepted) = {
                let rx = rx.lock();
                match rx.recv() {
                    Ok(job) => job,
                    Err(_) => return,
                }
            };
            serve(stream, accepted, &state, &data_dir);
        });
    }
    eprintln!("fub-services/0.1.0 on {bind} ({WORKERS} workers, queue {QUEUE})");
    for conn in listener.incoming() {
        match conn {
            Ok(stream) => {
                let accepted = Instant::now();
                match tx.try_send((stream, accepted)) {
                    Ok(()) => {}
                    Err(std::sync::mpsc::TrySendError::Full((mut stream, _))) => {
                        let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
                        let _ = stream.write_all(
                            b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                        );
                    }
                    Err(std::sync::mpsc::TrySendError::Disconnected(_)) => return,
                }
            }
            Err(_) => continue,
        }
    }
}

/// Richiesta parsata con limiti già applicati (fail-closed).
struct Parsed {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    req_host: Option<String>,
    body: Vec<u8>,
}

/// Legge e valida testata+corpo con `httparse`. Errori = risposta immediata.
fn read_request(stream: &mut TcpStream, accepted: Instant) -> Result<Parsed, HttpResponse> {
    stream
        .set_read_timeout(Some(IO_SLICE))
        .map_err(|_| HttpResponse::err(500, "io error"))?;
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let head_end = loop {
        if Instant::now().saturating_duration_since(accepted) > HEAD_DEADLINE {
            return Err(HttpResponse::err(408, "header timeout"));
        }
        if buf.len() > MAX_HEAD {
            return Err(HttpResponse::err(431, "headers too large"));
        }
        let n = stream.read(&mut tmp).map_err(|e| {
            if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut
            {
                if Instant::now().saturating_duration_since(accepted) > HEAD_DEADLINE {
                    HttpResponse::err(408, "header timeout")
                } else {
                    HttpResponse::err(400, "header read failed")
                }
            } else {
                HttpResponse::err(400, "header read failed")
            }
        })?;
        if n == 0 {
            return Err(HttpResponse::err(400, "connection closed"));
        }
        buf.extend_from_slice(&tmp[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut req = httparse::Request::new(&mut headers);
        match req.parse(&buf) {
            Err(_) => return Err(HttpResponse::err(400, "bad request")),
            Ok(httparse::Status::Partial) => {
                if buf.len() > MAX_HEAD {
                    return Err(HttpResponse::err(431, "headers too large"));
                }
                continue;
            }
            Ok(httparse::Status::Complete(amt)) => break amt,
        }
    };
    // Re-parse sullo stesso buffer per estrarre i campi (bounded, già validato).
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);
    let amt = match req.parse(&buf) {
        Ok(httparse::Status::Complete(amt)) => amt,
        _ => return Err(HttpResponse::err(400, "bad request")),
    };
    debug_assert_eq!(amt, head_end);
    let method = req.method.unwrap_or("").to_string();
    let raw_path = req.path.unwrap_or("").to_string();
    let version = req.version.unwrap_or(0);
    if version != 1 {
        return Err(HttpResponse::err(400, "bad version"));
    }
    if !matches!(method.as_str(), "GET" | "POST") {
        return Err(HttpResponse::err(400, "method not allowed"));
    }
    if raw_path.len() > MAX_PATH || !raw_path.starts_with('/') {
        return Err(HttpResponse::err(414, "path too long"));
    }
    let mut header_list = Vec::new();
    let mut content_lengths: Vec<String> = Vec::new();
    let mut has_te = false;
    let mut has_continue = false;
    let mut req_host: Option<String> = None;
    for h in req.headers.iter() {
        let name = h.name.to_ascii_lowercase();
        let value = if name == "x-fub-site-password" {
            String::from_utf8(h.value.to_vec())
                .map_err(|_| HttpResponse::err(400, "bad site password header"))?
        } else {
            String::from_utf8_lossy(h.value).trim().to_string()
        };
        match name.as_str() {
            "content-length" => content_lengths.push(value.clone()),
            "transfer-encoding" => has_te = true,
            "expect" => {
                if value.to_ascii_lowercase().contains("100-continue") {
                    has_continue = true;
                }
            }
            "host" => req_host = Some(value.clone()),
            _ => {}
        }
        header_list.push((name, value));
    }
    if req_host
        .as_ref()
        .map(|h| h.trim().is_empty())
        .unwrap_or(true)
    {
        return Err(HttpResponse::err(400, "host required"));
    }
    if has_te {
        return Err(HttpResponse::err(501, "chunked unsupported"));
    }
    if has_continue {
        return Err(HttpResponse::err(417, "expectation failed"));
    }
    // RFC 9112 §6.3: un mittente non deve mai duplicare Content-Length, nemmeno
    // con lo stesso valore (ambiguità di framing dietro proxy). Qualunque
    // duplicato = 400 fail-closed, identico o discorde.
    if content_lengths.len() > 1 {
        return Err(HttpResponse::err(400, "duplicate content-length"));
    }
    if header_list
        .iter()
        .filter(|(name, _)| name == "x-fub-site-password")
        .count()
        > 1
    {
        return Err(HttpResponse::err(400, "duplicate site password header"));
    }
    let declared: u64 = match content_lengths.first() {
        None => 0,
        Some(raw) => raw
            .parse::<u64>()
            .map_err(|_| HttpResponse::err(400, "bad content-length"))?,
    };
    let (_, query) = split_query(&raw_path);
    let route = fub_services::routing::route(&method, &raw_path);
    if method == "GET" && declared > 0 {
        return Err(HttpResponse::err(400, "body not allowed"));
    }
    let limit = body_limit(&route) as u64;
    if declared > limit {
        return Err(HttpResponse::err(413, "body too large"));
    }
    if declared > MAX_BODY as u64 {
        return Err(HttpResponse::err(413, "body too large"));
    }
    let already = (buf.len() - amt) as u64;
    if already > declared {
        return Err(HttpResponse::err(400, "body overflow"));
    }
    let mut body = Vec::with_capacity(declared.min(1 << 20) as usize);
    body.extend_from_slice(&buf[amt..]);
    while (body.len() as u64) < declared {
        if Instant::now().saturating_duration_since(accepted) > BODY_DEADLINE {
            return Err(HttpResponse::err(408, "body timeout"));
        }
        let n = stream
            .read(&mut tmp)
            .map_err(|_| HttpResponse::err(400, "body read failed"))?;
        if n == 0 {
            return Err(HttpResponse::err(400, "body truncated"));
        }
        // Nessun overflow prima di allocare: il contatore resta sotto `declared`.
        let room = declared - body.len() as u64;
        let take = (n as u64).min(room) as usize;
        body.extend_from_slice(&tmp[..take]);
        if n as u64 > room {
            return Err(HttpResponse::err(400, "body overflow"));
        }
    }
    Ok(Parsed {
        method,
        path: raw_path,
        query,
        headers: header_list,
        req_host,
        body,
    })
}

/// Tetto del corpo per rotta: piccolo per auth/metadata, 64 MiB solo dove i
/// corpi grandi sono necessari (push/commit).
fn body_limit(route: &Route) -> usize {
    match route {
        Route::Hello => 0,
        Route::AccountRegister | Route::AccountLogin | Route::MfaVerify => SMALL_BODY,
        Route::SyncPush => MAX_BODY,
        Route::SyncPull | Route::SyncAck => SECONDARY_BODY,
        Route::SyncStatus
        | Route::SyncVersions
        | Route::SyncTrash
        | Route::SyncRestore
        | Route::SyncInvite
        | Route::SyncInviteAccept
        | Route::SyncRevoke
        | Route::SyncVaultKeyStore
        | Route::SyncVaultKeyGet => TINY_BODY,
        Route::PublishDryRun => DRY_RUN_BODY,
        Route::PublishCommit => MAX_BODY,
        Route::PublishUnpublish
        | Route::PublishRollback
        | Route::PublishIsolation
        | Route::PublishSiteAdmin => SMALL_BODY,
        Route::PublishStatus => 0,
        Route::StaticSite { .. } => 0,
        Route::Unknown => TINY_BODY,
    }
}

fn split_query(path: &str) -> (String, Vec<(String, String)>) {
    let (base, rest) = match path.find('?') {
        Some(i) => (path[..i].to_string(), &path[i + 1..]),
        None => (path.to_string(), ""),
    };
    let mut out = Vec::new();
    for pair in rest.split('&') {
        if pair.is_empty() {
            continue;
        }
        match pair.find('=') {
            Some(i) => out.push((pair[..i].to_string(), pair[i + 1..].to_string())),
            None => out.push((pair.to_string(), String::new())),
        }
    }
    (base, out)
}

fn query_get<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn header_get<'a>(headers: &'a [(String, String)], key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn serve(stream: TcpStream, accepted: Instant, state: &Arc<Mutex<ServiceState>>, data_dir: &Path) {
    let mut stream = stream;
    let response = match read_request(&mut stream, accepted) {
        Err(r) => r,
        Ok(parsed) => dispatch(parsed, state, data_dir),
    };
    // Le statiche 200 con header sandbox/isolamento sono già incapsulate
    // (`content_type == "raw"`): escono grezze, senza seconda testata.
    if response.content_type == "raw" {
        let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
        let _ = stream.write_all(&response.body);
        let _ = stream.flush();
        return;
    }
    respond(&mut stream, &response, &[]);
}

fn respond(stream: &mut TcpStream, response: &HttpResponse, extra: &[(&str, &str)]) {
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let mut head = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: {}\r\ncontent-length: {}\r\n",
        response.status,
        response.status_text(),
        response.content_type,
        response.body.len()
    );
    for (name, value) in extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("connection: close\r\n\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&response.body);
    let _ = stream.flush();
}

fn dispatch(parsed: Parsed, state: &Arc<Mutex<ServiceState>>, data_dir: &Path) -> HttpResponse {
    let route = fub_services::routing::route(&parsed.method, &parsed.path);
    let auth = header_get(&parsed.headers, "authorization");
    let response = match route {
        Route::Hello => HttpResponse::json(200, &Hello::current()),
        Route::AccountRegister => handle_register(state, &parsed.body),
        Route::AccountLogin => handle_login(state, &parsed.body),
        Route::MfaVerify => {
            let mut state = state.lock();
            handle_mfa(&mut state, auth, &parsed.body)
        }
        Route::SyncPush
        | Route::SyncPull
        | Route::SyncAck
        | Route::SyncStatus
        | Route::SyncVersions
        | Route::SyncTrash
        | Route::SyncRestore
        | Route::SyncInvite
        | Route::SyncInviteAccept
        | Route::SyncRevoke
        | Route::SyncVaultKeyStore
        | Route::SyncVaultKeyGet => {
            let mut state = state.lock();
            fub_services::sync::handle(&mut state, &parsed.method, &parsed.path, auth, &parsed.body)
        }
        Route::PublishDryRun | Route::PublishUnpublish | Route::PublishRollback => {
            let mut state = state.lock();
            fub_services::publish::handle(
                &mut state,
                &parsed.method,
                &parsed.path,
                auth,
                &parsed.body,
            )
        }
        Route::PublishCommit => {
            // Preflight custom-JS fuori dal lock (solo file I/O, mai KDF).
            if let Err(r) = fub_services::site_isolation::preflight_commit(data_dir, &parsed.body) {
                r
            } else {
                let mut state = state.lock();
                fub_services::publish::handle(
                    &mut state,
                    &parsed.method,
                    &parsed.path,
                    auth,
                    &parsed.body,
                )
            }
        }
        Route::PublishStatus => {
            let mut state = state.lock();
            fub_services::publish::handle(
                &mut state,
                &parsed.method,
                &parsed.path,
                auth,
                &parsed.body,
            )
        }
        Route::PublishSiteAdmin => {
            let mut state = state.lock();
            fub_services::publish::handle_site_admin(&mut state, auth, &parsed.body)
        }
        Route::PublishIsolation => handle_isolation(state, data_dir, auth, &parsed.body),
        Route::StaticSite { site, rest } => handle_static(
            state,
            data_dir,
            auth,
            &site,
            &rest,
            &parsed.query,
            header_get(&parsed.headers, "x-fub-site-password"),
            parsed.req_host.as_deref(),
        ),
        Route::Unknown => HttpResponse::err(404, "unknown route"),
    };
    eprintln!(
        "{}",
        fub_services::server::log_line(&parsed.method, &parsed.path, response.status)
    );
    response
}

/// Register con KDF fuori dal lock: validazione + hash sul worker, solo
/// lookup/inserimento sotto lock breve.
fn handle_register(state: &Arc<Mutex<ServiceState>>, body: &[u8]) -> HttpResponse {
    let creds = match parse_credentials(body) {
        Err(r) => return r,
        Ok(creds) => creds,
    };
    let name = creds.name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return HttpResponse::err(422, "bad account name");
    }
    if creds.password.len() < 8 {
        return HttpResponse::err(422, "password too short (min 8)");
    }
    {
        let state = state.lock();
        if state.accounts.by_name.contains_key(&name) {
            return HttpResponse::err(422, "account exists");
        }
    }
    // 210k round PBKDF2 senza lock: sync/publish non si fermano.
    let pw = match AccountStore::prepare_hash(&creds.password) {
        Err(e) => return HttpResponse::err(500, &e),
        Ok(pw) => pw,
    };
    let mut state = state.lock();
    let id = match state.accounts.insert_prepared(&name, pw) {
        Err(e) => return HttpResponse::err(422, &e),
        Ok(id) => id,
    };
    match state.accounts.issue_session_token(&id) {
        Err(e) => HttpResponse::err(500, &e),
        Ok(token) => HttpResponse::json(
            201,
            &serde_json::json!({ "account_id": id, "token": token }),
        ),
    }
}

/// Login con KDF fuori dal lock: snapshot hash sotto lock breve, verifica
/// fuori, emissione token sotto lock breve. MFA (HMAC veloce) sotto lock.
fn handle_login(state: &Arc<Mutex<ServiceState>>, body: &[u8]) -> HttpResponse {
    #[derive(serde::Deserialize)]
    struct Login {
        name: String,
        password: String,
        code: Option<String>,
    }
    let login: Login = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad login body"),
        Ok(login) => login,
    };
    let key = login.name.trim().to_string();
    let now = fub_services::schema::now_ms();
    let snapshot = {
        let state = state.lock();
        if state.logins.blocked(&key, now) {
            return HttpResponse::err(429, "rate limited");
        }
        state.accounts.password_hash_of(&login.name)
    };
    let (account_id, pw) = match snapshot {
        Err(_) => {
            // Hash fittizio per pari tempo di risposta (no user enumeration
            // temporale), poi 401 generico.
            let _ = AccountStore::prepare_hash(&login.password);
            let mut state = state.lock();
            state.logins.note_fail(&key, now);
            return HttpResponse::err(401, "bad credentials");
        }
        Ok(snapshot) => snapshot,
    };
    let ok = AccountStore::check_hash(&login.password, &pw).unwrap_or(false);
    let mut state = state.lock();
    if !ok {
        state.logins.note_fail(&key, now);
        return HttpResponse::err(401, "bad credentials");
    }
    // Step-up TOTP: record clonato, `check_totp` su borrow locali (HMAC veloce
    // sotto lock breve, mai KDF), write-back solo al successo.
    if state.totps.contains_key(&account_id) {
        let code = match login.code.as_deref() {
            Some(code) if !code.trim().is_empty() => code.to_string(),
            _ => return HttpResponse::err(401, "mfa required"),
        };
        let mut record = match state.totps.get(&account_id) {
            Some(record) => record.clone(),
            None => return HttpResponse::err(401, "mfa required"),
        };
        let step_key = format!("login:{account_id}");
        match state.logins.check_totp(&mut record, &step_key, &code) {
            Ok(true) => {
                state.totps.insert(account_id.clone(), record);
            }
            Ok(false) => return HttpResponse::err(401, "bad totp"),
            Err(e) => return HttpResponse::err(429, &e),
        }
    }
    state.logins.note_success(&key);
    match state.accounts.issue_session_token(&account_id) {
        Err(e) => HttpResponse::err(500, &e),
        Ok(token) => HttpResponse::json(
            200,
            &serde_json::json!({ "account_id": account_id, "token": token }),
        ),
    }
}

/// MFA enroll/verify: solo HMAC veloci sotto lock breve, mai KDF.
fn handle_mfa(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account_id = match state.bearer(auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(serde::Deserialize)]
    struct MfaBody {
        code: Option<String>,
        enroll: Option<bool>,
    }
    let parsed: MfaBody = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad mfa body"),
        Ok(parsed) => parsed,
    };
    if parsed.enroll == Some(true) {
        match fub_services::mfa::generate_secret() {
            Err(e) => HttpResponse::err(500, &e),
            Ok(secret) => {
                state.totps.insert(
                    account_id,
                    fub_services::mfa::TotpRecord {
                        secret_b64: secret.secret_b64.clone(),
                        last_counter: None,
                    },
                );
                HttpResponse::json(201, &serde_json::json!({ "secret_b64": secret.secret_b64 }))
            }
        }
    } else {
        match (state.totps.get_mut(&account_id), parsed.code) {
            (Some(record), Some(code)) => {
                let now = fub_services::schema::now_ms();
                match fub_services::mfa::verify_totp(record, &code, now) {
                    Ok(true) => HttpResponse::json(200, &serde_json::json!({ "ok": true })),
                    _ => HttpResponse::err(401, "bad totp"),
                }
            }
            _ => HttpResponse::err(400, "mfa not enrolled or code missing"),
        }
    }
}

/// Configurazione isolamento custom-JS: bearer + owner/Admin sotto lock breve,
/// scrittura sidecar fuori dal lock.
fn handle_isolation(
    state: &Arc<Mutex<ServiceState>>,
    data_dir: &Path,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    #[derive(serde::Deserialize)]
    struct IsolationBody {
        site_id: String,
        mode: String,
        origin: Option<String>,
    }
    let parsed: IsolationBody = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad isolation body"),
        Ok(parsed) => parsed,
    };
    if parsed.site_id.is_empty() || parsed.site_id.len() > 64 {
        return HttpResponse::err(400, "bad site id");
    }
    let account = {
        let state = state.lock();
        match state.bearer(auth) {
            Err(r) => return r,
            Ok(account) => account,
        }
    };
    // Autorizzazione: owner sempre, altrimenti grant Admin (lock breve, mai KDF).
    {
        let state = state.lock();
        let resource = format!("site:{}", parsed.site_id);
        let authorized = match fub_services::publish::site::load_record(data_dir, &parsed.site_id) {
            Ok(record) => {
                if record.owner == account {
                    true
                } else if record.revoked.iter().any(|r| r == &account) {
                    false
                } else {
                    match state.acls.get(&resource) {
                        Some(acl) => {
                            fub_services::acl::check(acl, &account, fub_services::acl::Role::Admin)
                                .is_ok()
                        }
                        None => false,
                    }
                }
            }
            Err(_) => true,
        };
        if !authorized {
            return HttpResponse::err(403, "forbidden");
        }
    }
    match fub_services::site_isolation::save_mode(
        data_dir,
        &parsed.site_id,
        &parsed.mode,
        parsed.origin.as_deref(),
    ) {
        Err(e) => HttpResponse::err(400, &e),
        Ok(config) => HttpResponse::json(
            200,
            &serde_json::json!({ "site_id": parsed.site_id, "mode": config.mode, "origin": config.origin }),
        ),
    }
}

/// Statico `/s/<site>/...` con gate password FUORI dal lock: record da fs,
/// PBKDF2 senza lock, serve lock-free; il lock copre solo il ramo
/// bearer-fallback (lookup ACL breve, mai KDF).
#[allow(clippy::too_many_arguments)]
fn handle_static(
    state: &Arc<Mutex<ServiceState>>,
    data_dir: &Path,
    auth: Option<&str>,
    site_id: &str,
    rest: &str,
    query: &[(String, String)],
    site_password: Option<&str>,
    req_host: Option<&str>,
) -> HttpResponse {
    use fub_services::publish::site as site_api;
    let record = match site_api::load_record(data_dir, site_id) {
        Ok(record) => record,
        Err(site_api::SiteError::SiteNotFound(_)) => {
            return HttpResponse::err(404, "site not found")
        }
        Err(_) => return HttpResponse::err(500, "io error"),
    };
    // URL credentials leak through history, referrers and access logs. Reject
    // even when a valid header is supplied instead of silently accepting both.
    if query_get(query, "password").is_some() {
        return HttpResponse::err(400, "credentials in URL are forbidden");
    }
    if let Some(tls) = &record.tls {
        if req_host
            .and_then(|host| host.split(':').next())
            .is_some_and(|host| host.eq_ignore_ascii_case(&tls.domain))
        {
            let intent = site_api::TlsConfig {
                provisioned: false,
                ..tls.clone()
            };
            if !tls.provisioned || !site_api::valid_tls_intent(&intent) {
                return HttpResponse::err(403, "domain not provisioned");
            }
        }
    }
    let gate = site_api::check_password_gate(&record, site_password);
    match gate {
        site_api::PasswordGate::Public => {}
        site_api::PasswordGate::Locked { password_ok: true } => {}
        site_api::PasswordGate::Locked { password_ok: false } => {
            let account = match auth {
                Some(auth) => {
                    let state = state.lock();
                    match state.bearer(Some(auth)) {
                        Err(_) => return HttpResponse::err(401, "site locked"),
                        Ok(account) => account,
                    }
                }
                None => return HttpResponse::err(401, "site locked"),
            };
            let allowed = {
                let state = state.lock();
                if record.owner == account {
                    true
                } else if record.revoked.iter().any(|r| r == &account) {
                    false
                } else if record.collaborator_roles.contains_key(&account) {
                    true
                } else {
                    state
                        .acls
                        .get(&format!("site:{site_id}"))
                        .is_some_and(|acl| acl.role_of(&account).is_some())
                }
            };
            if !allowed {
                return HttpResponse::err(401, "site locked");
            }
        }
    }
    let clean = rest.trim_start_matches('/');
    let clean = if clean.is_empty() {
        "index.html"
    } else {
        clean
    };
    let (bytes, _) = match site_api::resolve_static(data_dir, site_id, clean) {
        Err(_) => return HttpResponse::err(404, "static not found"),
        Ok(found) => found,
    };
    let content_type = site_api::static_content_type(clean);
    match fub_services::site_isolation::serve_headers(
        data_dir,
        site_id,
        req_host,
        content_type,
        &bytes,
    ) {
        fub_services::site_isolation::ServeDecision::DenyOrigin => {
            HttpResponse::err(403, "wrong origin")
        }
        fub_services::site_isolation::ServeDecision::Allow(extra) => {
            // Gli header sandbox/isolamento viaggiano con la risposta: `respond`
            // non li conosce, quindi la risposta statica 200 esce da qui.
            let mut head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\n",
                bytes.len()
            );
            for (name, value) in &extra {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
            head.push_str("connection: close\r\n\r\n");
            // Incapsulata come corpo speciale: il chiamante la scrive grezza.
            HttpResponse {
                status: 200,
                content_type: "raw",
                body: [head.as_bytes(), &bytes].concat(),
            }
        }
    }
}

#[cfg(test)]
mod sync_http_tests {
    use super::*;
    use fub_services::sync::{OpKind, SyncOp};
    use serde_json::{json, Value};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "fub-services-sync-http-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // Exercise the same accept -> parser -> dispatcher -> HTTP writer path as
    // the loopback binary, rather than invoking sync::handle directly.
    fn exchange_raw(state: &Arc<Mutex<ServiceState>>, dir: &Path, request: &[u8]) -> Vec<u8> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::clone(state);
        let dir = dir.to_path_buf();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve(stream, Instant::now(), &state, &dir);
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client.write_all(request).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let mut bytes = Vec::new();
        client.read_to_end(&mut bytes).unwrap();
        server.join().unwrap();
        bytes
    }

    fn exchange(state: &Arc<Mutex<ServiceState>>, dir: &Path, request: &[u8]) -> (u16, Value) {
        let bytes = exchange_raw(state, dir, request);
        let boundary = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
        let head = std::str::from_utf8(&bytes[..boundary]).unwrap();
        assert!(
            head.contains("\r\ncontent-type: application/json\r\n"),
            "{head}"
        );
        let length: usize = head
            .lines()
            .find_map(|line| line.strip_prefix("content-length: "))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(length, bytes.len() - boundary - 4, "{head}");
        let status = head
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes[boundary + 4..]).unwrap(),
        )
    }

    fn request(
        state: &Arc<Mutex<ServiceState>>,
        dir: &Path,
        method: &str,
        path: &str,
        auth: Option<&str>,
        body: Value,
    ) -> (u16, Value) {
        let body = if method == "GET" {
            Vec::new()
        } else {
            serde_json::to_vec(&body).unwrap()
        };
        let header = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\n{}Content-Length: {}\r\n\r\n",
            auth.map(|a| format!("Authorization: {a}\r\n"))
                .unwrap_or_default(),
            body.len()
        );
        let mut wire = header.into_bytes();
        wire.extend_from_slice(&body);
        exchange(state, dir, &wire)
    }

    #[test]
    fn every_sync_handler_is_reachable_through_loopback_http() {
        let dir = TempDir::new();
        let mut state = ServiceState::open(Some(dir.0.clone())).unwrap();
        let owner = state
            .accounts
            .create_account("http-owner", "correct-horse-99")
            .unwrap();
        let guest = state
            .accounts
            .create_account("http-guest", "correct-horse-99")
            .unwrap();
        let owner_auth = format!(
            "Bearer {}",
            state.accounts.issue_session_token(&owner).unwrap()
        );
        let guest_auth = format!(
            "Bearer {}",
            state.accounts.issue_session_token(&guest).unwrap()
        );
        let state = Arc::new(Mutex::new(state));
        let vault = "http-vault";
        let doc = "notes/http.md";
        let op = SyncOp {
            op_id: "http-op-1".to_string(),
            replica_id: "http-replica".to_string(),
            doc_id: doc.to_string(),
            kind: OpKind::Create,
            vv: [("http-replica".to_string(), 1)].into(),
            ciphertext_b64: "YQ==".to_string(),
            nonce_b64: "AAAAAAAAAAAAAAAA".to_string(),
            aad: String::new(),
            ts_ms: fub_services::schema::now_ms(),
            vault_id: vault.to_string(),
            key_epoch: 0,
            rename_from: None,
            rename_to: None,
        };
        let push = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/push",
            Some(&owner_auth),
            json!({"protocol":"fub-sync/1","replica_id":"http-replica","ops":[op]}),
        );
        assert_eq!(push.0, 200, "{push:?}");
        assert_eq!(push.1["ack"], json!(["http-op-1"]));
        assert_eq!(push.1["server_vv"]["http-replica"], "1");

        let pull = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/pull",
            Some(&owner_auth),
            json!({"replica_id":"http-peer","vault_id":vault,"since_vv":{}}),
        );
        assert_eq!(pull.0, 200, "{pull:?}");
        assert_eq!(pull.1["ops"][0]["vv"]["http-replica"], "1");
        let ack = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/ack",
            Some(&owner_auth),
            json!({"replica_id":"http-replica","vault_id":vault,"ack":["http-op-1"]}),
        );
        assert_eq!(ack.0, 200, "{ack:?}");
        assert_eq!(ack.1["acked"], json!(["http-op-1"]));

        let status = request(
            &state,
            &dir.0,
            "GET",
            &format!("/v1/sync/status?vault_id={vault}&replica_id=http-replica"),
            Some(&owner_auth),
            Value::Null,
        );
        assert_eq!(status.0, 200, "{status:?}");
        assert_eq!(status.1["server_vv"]["http-replica"], "1");
        let versions = request(
            &state,
            &dir.0,
            "GET",
            &format!("/v1/sync/versions?vault_id={vault}&doc_id=notes%2Fhttp.md"),
            Some(&owner_auth),
            Value::Null,
        );
        assert_eq!(versions.0, 200, "{versions:?}");
        assert_eq!(versions.1["versions"][0]["version"], "1");

        let trash = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/trash",
            Some(&owner_auth),
            json!({"doc_id":doc,"vault_id":vault}),
        );
        assert_eq!(trash.0, 200, "{trash:?}");
        assert_eq!(trash.1["trashed"], doc);
        let restore = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/restore",
            Some(&owner_auth),
            json!({"doc_id":doc,"vault_id":vault}),
        );
        assert_eq!(restore.0, 200, "{restore:?}");
        assert_eq!(restore.1["requires_fresh_push"], true);

        let wrapped = fub_services::crypto::wrap_vdk(&[7; 32], &[9; 32]).unwrap();
        let stored = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/vault-key",
            Some(&owner_auth),
            json!({"vault_id":vault,"wrapped":wrapped}),
        );
        assert_eq!(stored.0, 200, "{stored:?}");
        let key = request(
            &state,
            &dir.0,
            "GET",
            &format!("/v1/sync/vault-key?vault_id={vault}"),
            Some(&owner_auth),
            Value::Null,
        );
        assert_eq!(key.0, 200, "{key:?}");
        assert_eq!(key.1["wrapped"], serde_json::to_value(&wrapped).unwrap());
        assert!(key.1["wrapped_hash"].is_string());

        let invite = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/invite",
            Some(&owner_auth),
            json!({"vault_id":vault,"role":"writer"}),
        );
        assert_eq!(invite.0, 201, "{invite:?}");
        let accepted = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/invite/accept",
            Some(&guest_auth),
            json!({"token_b64": invite.1["token_b64"]}),
        );
        assert_eq!(accepted.0, 200, "{accepted:?}");
        assert_eq!(accepted.1["role"], "writer");
        let revoked = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/revoke",
            Some(&owner_auth),
            json!({"vault_id":vault,"account_id":guest}),
        );
        assert_eq!(revoked.0, 200, "{revoked:?}");
        let forbidden = request(
            &state,
            &dir.0,
            "GET",
            &format!("/v1/sync/vault-key?vault_id={vault}"),
            Some(&guest_auth),
            Value::Null,
        );
        assert_eq!(forbidden.0, 403, "{forbidden:?}");
        assert!(forbidden.1["error"].is_string());
    }

    #[test]
    fn sync_http_rejects_unauthorized_unmatched_and_oversized_requests() {
        let dir = TempDir::new();
        let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
        for (method, path) in [
            ("POST", "/v1/sync/push"),
            ("POST", "/v1/sync/pull"),
            ("POST", "/v1/sync/ack"),
            ("GET", "/v1/sync/status"),
            ("GET", "/v1/sync/versions"),
            ("POST", "/v1/sync/trash"),
            ("POST", "/v1/sync/restore"),
            ("POST", "/v1/sync/invite"),
            ("POST", "/v1/sync/invite/accept"),
            ("POST", "/v1/sync/revoke"),
            ("POST", "/v1/sync/vault-key"),
            ("GET", "/v1/sync/vault-key"),
        ] {
            let (status, body) = request(&state, &dir.0, method, path, None, json!({}));
            assert_eq!(status, 401, "{method} {path}: {body}");
            assert!(body["error"].is_string(), "{method} {path}: {body}");
        }
        for (method, path) in [
            ("GET", "/v1/sync/push"),
            ("POST", "/v1/sync/status"),
            ("POST", "/v1/sync/missing"),
            ("GET", "/v1/sync/invite"),
        ] {
            let (status, body) = request(&state, &dir.0, method, path, None, json!({}));
            assert_eq!(status, 404, "{method} {path}: {body}");
            assert_eq!(body["error"], "unknown route");
        }
        let oversized =
            b"POST /v1/sync/invite HTTP/1.1\r\nHost: localhost\r\nContent-Length: 65537\r\n\r\n";
        let (status, body) = exchange(&state, &dir.0, oversized);
        assert_eq!(status, 413);
        assert_eq!(body["error"], "body too large");
        let duplicate = b"POST /v1/sync/invite HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}";
        let (status, body) = exchange(&state, &dir.0, duplicate);
        assert_eq!(status, 400);
        assert_eq!(body["error"], "duplicate content-length");
        let oversized_pull =
            b"POST /v1/sync/pull HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048577\r\n\r\n";
        let (status, body) = exchange(&state, &dir.0, oversized_pull);
        assert_eq!(status, 413);
        assert_eq!(body["error"], "body too large");
        let get_with_body =
            b"GET /v1/sync/status HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}";
        let (status, body) = exchange(&state, &dir.0, get_with_body);
        assert_eq!(status, 400);
        assert_eq!(body["error"], "body not allowed");
        let mut state_guard = state.lock();
        let owner = state_guard
            .accounts
            .create_account("http-negative", "correct-horse-99")
            .unwrap();
        let auth = format!(
            "Bearer {}",
            state_guard.accounts.issue_session_token(&owner).unwrap()
        );
        drop(state_guard);
        let (status, body) = request(
            &state,
            &dir.0,
            "POST",
            "/v1/sync/invite",
            Some(&auth),
            json!({"role":"unrecognized"}),
        );
        assert_eq!(status, 400);
        assert_eq!(body["error"], "bad invite body");
    }

    #[test]
    fn publish_admin_body_limits_and_roles_survive_restart() {
        let dir = TempDir::new();
        let mut service = ServiceState::open(Some(dir.0.clone())).unwrap();
        let owner = service
            .accounts
            .create_account("site-owner", "correct-horse-99")
            .unwrap();
        let admin = service
            .accounts
            .create_account("site-admin", "correct-horse-99")
            .unwrap();
        let owner_auth = format!(
            "Bearer {}",
            service.accounts.issue_session_token(&owner).unwrap()
        );
        let admin_auth = format!(
            "Bearer {}",
            service.accounts.issue_session_token(&admin).unwrap()
        );
        let state = Arc::new(Mutex::new(service));
        let path = "/v1/publish/site";
        assert_eq!(
            request(&state, &dir.0, "GET", path, Some(&owner_auth), Value::Null).0,
            404
        );
        assert_eq!(
            request(
                &state,
                &dir.0,
                "POST",
                path,
                None,
                json!({"protocol":"fub-publish/1","site_id":"journal"})
            )
            .0,
            401
        );

        let oversized = format!(
            "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: {owner_auth}\r\nContent-Length: {}\r\n\r\n",
            SMALL_BODY + 1
        );
        assert_eq!(exchange(&state, &dir.0, oversized.as_bytes()).0, 413);
        let malformed = format!(
            "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: {owner_auth}\r\nContent-Length: 1\r\n\r\n{{"
        );
        assert_eq!(exchange(&state, &dir.0, malformed.as_bytes()).0, 400);
        assert!(!fub_services::publish::site::site_dir(&dir.0, "journal").exists());

        let created = request(
            &state,
            &dir.0,
            "POST",
            path,
            Some(&owner_auth),
            json!({"protocol":"fub-publish/1","site_id":"journal",
                "grant":{"account_id":admin,"role":"admin"}}),
        );
        assert_eq!(created.0, 200, "{created:?}");
        drop(state);
        let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
        let change =
            json!({"protocol":"fub-publish/1","site_id":"journal","theme_css":"theme.css"});
        assert_eq!(
            request(
                &state,
                &dir.0,
                "POST",
                path,
                Some(&admin_auth),
                change.clone()
            )
            .0,
            200
        );
        let downgraded = request(
            &state,
            &dir.0,
            "POST",
            path,
            Some(&owner_auth),
            json!({"protocol":"fub-publish/1","site_id":"journal",
                "grant":{"account_id":admin,"role":"writer"}}),
        );
        assert_eq!(downgraded.0, 200, "{downgraded:?}");
        drop(state);
        let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
        assert_eq!(
            request(
                &state,
                &dir.0,
                "POST",
                path,
                Some(&admin_auth),
                change.clone()
            )
            .0,
            403
        );
        let revoked = request(
            &state,
            &dir.0,
            "POST",
            path,
            Some(&owner_auth),
            json!({"protocol":"fub-publish/1","site_id":"journal","revoke":admin}),
        );
        assert_eq!(revoked.0, 200, "{revoked:?}");
        drop(state);
        let state = Arc::new(Mutex::new(ServiceState::open(Some(dir.0.clone())).unwrap()));
        assert_eq!(
            request(&state, &dir.0, "POST", path, Some(&admin_auth), change).0,
            403
        );
        let record = fub_services::publish::site::load_record(&dir.0, "journal").unwrap();
        assert_eq!(record.theme_css.as_deref(), Some("theme.css"));
    }

    fn static_request(
        state: &Arc<Mutex<ServiceState>>,
        dir: &Path,
        path: &str,
        host: &str,
        headers: &str,
    ) -> (u16, Vec<u8>) {
        let wire = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{headers}\r\n");
        let bytes = exchange_raw(state, dir, wire.as_bytes());
        let boundary = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let status = std::str::from_utf8(&bytes[..boundary])
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        (status, bytes[boundary + 4..].to_vec())
    }

    #[test]
    fn static_site_password_uses_header_and_domain_requires_provisioning() {
        let dir = TempDir::new();
        let mut service = ServiceState::open(Some(dir.0.clone())).unwrap();
        let owner = service
            .accounts
            .create_account("static-owner", "correct-horse-99")
            .unwrap();
        let owner_auth = format!(
            "Bearer {}",
            service.accounts.issue_session_token(&owner).unwrap()
        );
        let state = Arc::new(Mutex::new(service));
        let created = request(
            &state,
            &dir.0,
            "POST",
            "/v1/publish/site",
            Some(&owner_auth),
            json!({"protocol":"fub-publish/1","site_id":"web",
                "password":"site-secret",
                "tls":{"domain":"example.test","path_prefix":"/notes/","provisioned":false}}),
        );
        assert_eq!(created.0, 200, "{created:?}");
        let mut record = fub_services::publish::site::load_record(&dir.0, "web").unwrap();
        record.live_version = Some(1);
        fub_services::publish::site::save_record(&dir.0, &record).unwrap();
        let live = fub_services::publish::site::public_base_path(&dir.0, "web");
        std::fs::create_dir_all(&live).unwrap();
        std::fs::write(live.join(".fub-cache-epoch"), b"1").unwrap();
        std::fs::write(live.join("index.html"), b"<h1>site</h1>").unwrap();

        assert_eq!(
            static_request(&state, &dir.0, "/s/web/", "localhost", "").0,
            401
        );
        assert_eq!(
            static_request(
                &state,
                &dir.0,
                "/s/web/?password=site-secret",
                "localhost",
                ""
            )
            .0,
            400
        );
        assert_eq!(
            static_request(
                &state,
                &dir.0,
                "/s/web/?password=site-secret",
                "localhost",
                "X-Fub-Site-Password: site-secret\r\n"
            )
            .0,
            400
        );
        assert_eq!(
            static_request(
                &state,
                &dir.0,
                "/s/web/",
                "localhost",
                "X-Fub-Site-Password: wrong\r\n"
            )
            .0,
            401
        );
        assert_eq!(
            static_request(
                &state,
                &dir.0,
                "/s/web/",
                "localhost",
                "X-Fub-Site-Password: site-secret\r\nX-Fub-Site-Password: wrong\r\n"
            )
            .0,
            400
        );
        let canonical = static_request(
            &state,
            &dir.0,
            "/s/web/",
            "localhost",
            "X-Fub-Site-Password: site-secret\r\n",
        );
        assert_eq!(canonical.0, 200);
        assert_eq!(canonical.1, b"<h1>site</h1>");
        assert_eq!(
            static_request(
                &state,
                &dir.0,
                "/s/web/",
                "example.test",
                "X-Fub-Site-Password: site-secret\r\n"
            )
            .0,
            403
        );

        // Only the external operator can mark a domain provisioned; the
        // administration request accepts intent with provisioned=false.
        record.tls.as_mut().unwrap().provisioned = true;
        fub_services::publish::site::save_record(&dir.0, &record).unwrap();
        let domain = static_request(
            &state,
            &dir.0,
            "/s/web/",
            "example.test",
            "X-Fub-Site-Password: site-secret\r\n",
        );
        assert_eq!(domain.0, 200);
        assert_eq!(domain.1, canonical.1);
    }
}
