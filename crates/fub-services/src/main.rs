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
//! - un lock per sito e uno per vault, presi prima di quello globale: staging,
//!   copia, code e fsync tengono soltanto il proprio, e il lock globale resta
//!   a sessioni, ACL e registri (STR-05);
//! - commit con custom JS senza isolamento = 422 (preflight fail-closed);
//!   serve-time con header sandbox / gate isolated-origin (vedi
//!   [`fub_services::site_isolation`]).
//!
//! Rotte servite qui: `GET /v1/hello`, account, MFA, isolamento siti.
//! `/v1/sync/*` va a `sync::admit` e `VaultWork::run`, `/v1/publish/*` agli handler owner,
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

use fub_services::routing::Route;
use fub_services::server::{HttpResponse, ServiceState};

#[path = "main/routes.rs"]
mod routes;

use routes::{dispatch, KdfCaller};

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
        std::thread::spawn(move || {
            run_worker(&rx, &|stream, accepted| {
                serve(stream, accepted, &state, &data_dir)
            })
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

/// Un worker del pool: serve connessioni finché la coda resta aperta.
///
/// Un panic dentro una richiesta chiude **quella** connessione, non il worker.
/// Senza la barriera il thread moriva e nessuno lo rifaceva: otto richieste che
/// trovavano lo stesso difetto spegnevano il pool, la coda si riempiva e da lì
/// ogni connessione riceveva 503 fino al riavvio. Lo stato condiviso non ne
/// esce peggio di prima: il lucchetto di `parking_lot` si rilascia anche
/// srotolando, e gli altri worker lo usavano già dopo un panic.
fn run_worker(
    rx: &Mutex<std::sync::mpsc::Receiver<(TcpStream, Instant)>>,
    serve: &dyn Fn(TcpStream, Instant),
) {
    loop {
        let (stream, accepted) = {
            let rx = rx.lock();
            match rx.recv() {
                Ok(job) => job,
                Err(_) => return,
            }
        };
        let served =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| serve(stream, accepted)));
        if served.is_err() {
            eprintln!("fub-services: una richiesta è andata in panic; il worker continua");
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
    /// L'IP del peer TCP: l'origine dei limiti per chi non è autenticato.
    peer: Option<std::net::IpAddr>,
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
            "expect" if value.to_ascii_lowercase().contains("100-continue") => {
                has_continue = true;
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
        peer: stream.peer_addr().ok().map(|addr| addr.ip()),
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

/// Statico `/s/<site>/...` con gate password FUORI dal lock: record da fs,
/// PBKDF2 senza lock, serve lock-free; il lock copre solo il ramo
/// bearer-fallback (lookup ACL breve, mai KDF).
#[allow(clippy::too_many_arguments)]
fn handle_static(
    state: &Arc<Mutex<ServiceState>>,
    caller: &KdfCaller,
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
    // Una password presentata a un sito protetto costa una PBKDF2: passa dai
    // limiti per origine e globale e dal semaforo, come il login.
    let gate = if record.password_hash.is_some() && site_password.is_some() {
        let _permit = match caller.enter() {
            Err(r) => return r,
            Ok(permit) => permit,
        };
        site_api::check_password_gate(&record, site_password)
    } else {
        site_api::check_password_gate(&record, None)
    };
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
    // Riparare `live` scrive l'albero del sito: lo fa soltanto chi tiene il
    // lock del sito, come commit, rollback e unpublish. La lettura non ne ha
    // bisogno, e nessuno dei due tocca il lock globale.
    if site_api::live_needs_repair(data_dir, site_id) {
        let site = Arc::clone(&state.lock().site_locks).of(site_id);
        let _site = site.lock();
        if site_api::recover_interrupted_commit(data_dir, site_id).is_err() {
            return HttpResponse::err(404, "static not found");
        }
    }
    let (bytes, _) = match site_api::read_static(data_dir, site_id, clean) {
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
#[path = "main/worker_tests.rs"]
mod worker_tests;

#[cfg(test)]
#[path = "main/sync_http_tests.rs"]
mod sync_http_tests;
