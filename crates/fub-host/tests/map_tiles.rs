//! Le tessere della vista Mappa arrivano soltanto dagli host che questa
//! macchina ammette, e soltanto se sono ciò che la mappa accetta. La rete è
//! finta: risponde ciò che la prova le dice e ricorda che cosa le si è chiesto,
//! così «nessuna richiesta» si vede e non si suppone.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use fub_abi::net::{HttpHeader, HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::settings::SettingValue;
use fub_abi::text::Text;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::map_tiles::{TileKind, MAP_TILE_HOSTS, MAX_TILE_BYTES};
use fub_host::Host;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

/// Una rete che risponde sempre la stessa cosa e ricorda le richieste.
struct Tiles {
    status: u16,
    headers: Vec<(&'static str, &'static str)>,
    body: Vec<u8>,
    seen: Mutex<Vec<HttpRequest>>,
}

impl HostNetwork for Tiles {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.seen.lock().unwrap().push(request);
        Ok(HttpResponse {
            status: self.status,
            headers: self
                .headers
                .iter()
                .map(|(name, value)| HttpHeader::new(*name, *value))
                .collect(),
            body: self.body.clone(),
        })
    }
}

fn tiles(status: u16, headers: Vec<(&'static str, &'static str)>, body: &[u8]) -> Arc<Tiles> {
    Arc::new(Tiles {
        status,
        headers,
        body: body.to_vec(),
        seen: Mutex::new(Vec::new()),
    })
}

fn png() -> Arc<Tiles> {
    tiles(200, vec![("Content-Type", "image/png")], PNG)
}

fn host_with(network: Arc<Tiles>, allowed: &[&str]) -> Host {
    let host = Host::without_watcher().with_network(network);
    if !allowed.is_empty() {
        host.set_setting_for_user(
            None,
            MAP_TILE_HOSTS,
            SettingValue::List(allowed.iter().map(|site| site.to_string()).collect()),
        )
        .unwrap();
    }
    host
}

/// Una rete che applica il tetto come il filo vero: legge il corpo a pezzi da
/// un server che ne avrebbe `body` byte e smette appena supera il tetto
/// ricevuto. Ricorda il tetto e quanti byte ha chiesto al server.
struct Capped {
    body: u64,
    status: u16,
    cap_seen: Mutex<Option<u64>>,
    read_from_server: Mutex<u64>,
}

const SERVER_CHUNK: u64 = 16 * 1024;

impl HostNetwork for Capped {
    fn fetch(&self, _: HttpRequest) -> Result<HttpResponse, PluginError> {
        panic!("a tile must pass its byte cap to the network")
    }

    fn fetch_limited(
        &self,
        _: HttpRequest,
        _: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        *self.cap_seen.lock().unwrap() = Some(max_bytes);
        let mut body = PNG.to_vec();
        let mut read = 0u64;
        while read < self.body {
            let piece = SERVER_CHUNK.min(self.body - read);
            read += piece;
            *self.read_from_server.lock().unwrap() = read;
            if read > max_bytes {
                return Err(LimitedFetchError::TooLarge {
                    limit: max_bytes,
                    status: self.status,
                });
            }
        }
        body.resize(read as usize, 0);
        Ok(HttpResponse {
            status: self.status,
            headers: vec![HttpHeader::new("Content-Type", "image/png")],
            body,
        })
    }
}

fn capped(body: u64) -> Arc<Capped> {
    capped_with_status(body, 200)
}

fn capped_with_status(body: u64, status: u16) -> Arc<Capped> {
    Arc::new(Capped {
        body,
        status,
        cap_seen: Mutex::new(None),
        read_from_server: Mutex::new(0),
    })
}

fn host_with_capped(network: Arc<Capped>) -> Host {
    let host = Host::without_watcher().with_network(network);
    host.set_setting_for_user(
        None,
        MAP_TILE_HOSTS,
        SettingValue::List(vec!["tiles.example.test".to_owned()]),
    )
    .unwrap();
    host
}

fn requests(network: &Tiles) -> usize {
    network.seen.lock().unwrap().len()
}

/// La cache delle tessere è del processo: ogni prova chiede indirizzi suoi.
fn url(test: &str) -> String {
    format!("https://tiles.example.test/{test}/1/0/0.png")
}

#[test]
fn an_empty_setting_sends_no_request() {
    let network = png();
    let host = host_with(Arc::clone(&network), &[]);
    let refused = host.map_tile(&url("vuota"), TileKind::Raster).unwrap_err();
    assert!(
        matches!(refused, PluginError::PermissionDenied(_)),
        "{refused:?}"
    );
    assert_eq!(requests(&network), 0);
}

#[test]
fn a_host_not_in_the_setting_is_refused_without_a_request() {
    let network = png();
    let host = host_with(Arc::clone(&network), &["tiles.example.test"]);
    for other in [
        "https://tiles.example.test.evil/a/1/0/0.png",
        "https://sub.tiles.example.test/a/1/0/0.png",
        "https://evil.test/a/1/0/0.png",
    ] {
        let refused = host.map_tile(other, TileKind::Raster).unwrap_err();
        assert!(
            matches!(refused, PluginError::PermissionDenied(_)),
            "{other}: {refused:?}"
        );
    }
    assert_eq!(requests(&network), 0);
}

#[test]
fn http_and_odd_addresses_are_refused_without_a_request() {
    let network = png();
    let host = host_with(Arc::clone(&network), &["tiles.example.test"]);
    for bad in [
        "http://tiles.example.test/http/1/0/0.png",
        "https://tiles.example.test:8443/http/1/0/0.png",
        "https://me:pw@tiles.example.test/http/1/0/0.png",
        "https://tiles.example.test/http/1/0/0.png?key=secret",
    ] {
        let refused = host.map_tile(bad, TileKind::Raster).unwrap_err();
        assert!(
            matches!(refused, PluginError::PermissionDenied(_)),
            "{bad}: {refused:?}"
        );
    }
    assert_eq!(requests(&network), 0);
}

#[test]
fn an_allowed_host_gets_its_tile_with_an_app_user_agent() {
    let network = png();
    let host = host_with(Arc::clone(&network), &["Tiles.Example.Test"]);
    let tile = host.map_tile(&url("ammessa"), TileKind::Raster).unwrap();
    assert_eq!(tile.mime, "image/png");
    assert_eq!(&*tile.bytes, PNG);
    let seen = network.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let agent = seen[0]
        .headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case("user-agent"))
        .map(|header| header.value.clone())
        .unwrap();
    assert!(agent.starts_with("Fub/"), "{agent}");
    assert!(
        !seen[0]
            .headers
            .iter()
            .any(|header| ["cookie", "authorization", "referer"]
                .iter()
                .any(|name| header.name.eq_ignore_ascii_case(name))),
        "{:?}",
        seen[0].headers
    );
}

#[test]
fn a_tile_already_downloaded_is_not_asked_again() {
    let network = png();
    let host = host_with(Arc::clone(&network), &["tiles.example.test"]);
    host.map_tile(&url("cache"), TileKind::Raster).unwrap();
    host.map_tile(&url("cache"), TileKind::Raster).unwrap();
    assert_eq!(requests(&network), 1);
}

#[test]
fn a_redirect_is_refused_even_towards_another_host() {
    let network = tiles(
        302,
        vec![
            ("Location", "https://evil.test/x.png"),
            ("Content-Type", "image/png"),
        ],
        PNG,
    );
    let host = host_with(Arc::clone(&network), &["tiles.example.test"]);
    let refused = host
        .map_tile(&url("redirect"), TileKind::Raster)
        .unwrap_err();
    assert!(
        matches!(refused, PluginError::PermissionDenied(_)),
        "{refused:?}"
    );
    // Una richiesta, quella al sito ammesso: il redirect non si segue.
    let seen = network.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].url.starts_with("https://tiles.example.test/"));
}

#[test]
fn a_tile_over_one_mebibyte_is_refused() {
    let mut body = PNG.to_vec();
    body.resize(MAX_TILE_BYTES + 1, 0);
    let network = tiles(200, vec![("Content-Type", "image/png")], &body);
    let host = host_with(network, &["tiles.example.test"]);
    let refused = host.map_tile(&url("grande"), TileKind::Raster).unwrap_err();
    assert!(matches!(refused, PluginError::Io(_)), "{refused:?}");
}

/// Il tetto della tessera arriva alla rete: da un server che manda sedici
/// mebibyte se ne legge al più uno e un pezzo, e il rifiuto dice che la
/// tessera è troppo grande.
#[test]
fn a_tile_over_one_mebibyte_stops_the_download_at_the_cap() {
    let network = capped(16 * MAX_TILE_BYTES as u64);
    let host = host_with_capped(Arc::clone(&network));
    let refused = host
        .map_tile(&url("senza-fine"), TileKind::Raster)
        .unwrap_err();
    let PluginError::Io(Text::Message(message)) = &refused else {
        panic!("{refused:?}");
    };
    assert_eq!(message.key, "host.map.tile.too_large");
    assert_eq!(
        *network.cap_seen.lock().unwrap(),
        Some(MAX_TILE_BYTES as u64)
    );
    let read = *network.read_from_server.lock().unwrap();
    assert!(
        read <= MAX_TILE_BYTES as u64 + SERVER_CHUNK,
        "read {read} bytes for a cap of {MAX_TILE_BYTES}"
    );
}

/// Lo stato prima del tetto: un redirect con un corpo enorme è ancora il
/// rifiuto del redirect, un `404` enorme è ancora l'errore di stato, non
/// «troppo grande».
#[test]
fn an_oversized_redirect_or_error_keeps_its_own_refusal() {
    let oversized = 16 * MAX_TILE_BYTES as u64;
    let redirect = host_with_capped(capped_with_status(oversized, 302))
        .map_tile(&url("redirect-enorme"), TileKind::Raster)
        .unwrap_err();
    let PluginError::PermissionDenied(Text::Message(message)) = &redirect else {
        panic!("{redirect:?}");
    };
    assert_eq!(message.key, "host.map.tile.redirect");

    let missing = host_with_capped(capped_with_status(oversized, 404))
        .map_tile(&url("assente-enorme"), TileKind::Raster)
        .unwrap_err();
    let PluginError::Io(Text::Message(message)) = &missing else {
        panic!("{missing:?}");
    };
    assert_eq!(message.key, "host.map.tile.status");
}

/// Il confine è incluso: una tessera di un mebibyte esatto passa.
#[test]
fn a_tile_of_exactly_one_mebibyte_passes() {
    let network = capped(MAX_TILE_BYTES as u64);
    let host = host_with_capped(Arc::clone(&network));
    let tile = host
        .map_tile(&url("esatta"), TileKind::Raster)
        .expect("a tile at the cap");
    assert_eq!(tile.bytes.len(), MAX_TILE_BYTES);
}

#[test]
fn a_tile_of_the_wrong_type_is_refused() {
    let host = |network| host_with(network, &["tiles.example.test"]);
    // Dichiarato HTML.
    let html = host(tiles(200, vec![("Content-Type", "text/html")], PNG));
    let refused = html.map_tile(&url("html"), TileKind::Raster).unwrap_err();
    assert!(matches!(refused, PluginError::Io(_)), "{refused:?}");
    // Dichiarato PNG, ma i byte sono altro.
    let lying = host(tiles(
        200,
        vec![("Content-Type", "image/png")],
        b"<html>x</html>",
    ));
    assert!(lying.map_tile(&url("finta"), TileKind::Raster).is_err());
    // Senza tipo dichiarato.
    let silent = host(tiles(200, Vec::new(), PNG));
    assert!(silent.map_tile(&url("muta"), TileKind::Raster).is_err());
    // Un SVG per un fornitore raster.
    let svg = host(tiles(
        200,
        vec![("Content-Type", "image/svg+xml")],
        b"<svg/>",
    ));
    assert!(svg.map_tile(&url("svg-raster"), TileKind::Raster).is_err());
    // Un SVG con un DOCTYPE per un fornitore vettoriale.
    let entities = host(tiles(
        200,
        vec![("Content-Type", "image/svg+xml")],
        b"<!DOCTYPE svg [<!ENTITY a 'aaaa'>]><svg>&a;</svg>",
    ));
    assert!(entities.map_tile(&url("entita"), TileKind::Vector).is_err());
    // Un SVG pulito per un fornitore vettoriale passa.
    let clean = host(tiles(
        200,
        vec![("Content-Type", "image/svg+xml; charset=utf-8")],
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
    ));
    assert_eq!(
        clean
            .map_tile(&url("vettore"), TileKind::Vector)
            .unwrap()
            .mime,
        "image/svg+xml"
    );
}

#[test]
fn a_status_other_than_success_is_an_io_error() {
    let network = tiles(404, vec![("Content-Type", "image/png")], PNG);
    let host = host_with(network, &["tiles.example.test"]);
    let failed = host
        .map_tile(&url("assente"), TileKind::Raster)
        .unwrap_err();
    assert!(matches!(failed, PluginError::Io(_)), "{failed:?}");
}

#[test]
fn the_setting_accepts_only_bare_host_names() {
    let host = Host::without_watcher();
    for bad in [
        "https://tile.openstreetmap.org",
        "tile.openstreetmap.org/",
        "*.osm.org",
        "a b",
    ] {
        let refused = host
            .set_setting_for_user(None, MAP_TILE_HOSTS, SettingValue::List(vec![bad.into()]))
            .unwrap_err();
        assert!(
            matches!(refused, PluginError::BadArgs(_)),
            "{bad}: {refused:?}"
        );
    }
    host.set_setting_for_user(
        None,
        MAP_TILE_HOSTS,
        SettingValue::List(vec!["tile.openstreetmap.org".into()]),
    )
    .unwrap();
}

/// Il filo vero davanti a un server locale: la richiesta per
/// `https://tiles.example.test/...` va a `http://127.0.0.1:<porta>/...`, così
/// la tessera passa da `UreqNetwork` senza TLS né DNS.
#[cfg(feature = "http-client")]
struct Local {
    base: String,
    wire: fub_host::net::UreqNetwork,
}

#[cfg(feature = "http-client")]
impl Local {
    fn moved(&self, mut request: HttpRequest) -> HttpRequest {
        let path = request
            .url
            .strip_prefix("https://tiles.example.test")
            .expect("a tile address")
            .to_owned();
        request.url = format!("{}{path}", self.base);
        request
    }
}

#[cfg(feature = "http-client")]
impl HostNetwork for Local {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.wire.fetch(self.moved(request))
    }

    fn fetch_limited(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        self.wire
            .fetch_limited(self.moved(request), cancelled, max_bytes)
    }
}

/// Un server HTTP di una richiesta sull'anello locale che risponde `status`
/// con un corpo breve.
#[cfg(feature = "http-client")]
fn serve_status(status: &'static str) -> (String, std::thread::JoinHandle<()>) {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let server = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("read timeout");
        let mut lines = BufReader::new(stream.try_clone().expect("clone"));
        let mut line = String::new();
        while lines.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
            line.clear();
        }
        let body = "assente";
        let mut stream = stream;
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\
                 Connection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
    });
    (base, server)
}

/// Un `404` o un `500` dal filo vero arrivano come errore di stato, con il
/// numero, e non come «la rete non risponde».
#[cfg(feature = "http-client")]
#[test]
fn a_real_error_status_is_the_status_refusal_not_the_network() {
    for (status, code, test) in [
        ("404 Not Found", "404", "filo-404"),
        ("500 Internal Server Error", "500", "filo-500"),
    ] {
        let (base, server) = serve_status(status);
        let host = Host::without_watcher().with_network(Arc::new(Local {
            base,
            wire: fub_host::net::UreqNetwork::new(),
        }));
        host.set_setting_for_user(
            None,
            MAP_TILE_HOSTS,
            SettingValue::List(vec!["tiles.example.test".to_owned()]),
        )
        .unwrap();
        let failed = host.map_tile(&url(test), TileKind::Raster).unwrap_err();
        let PluginError::Io(Text::Message(message)) = &failed else {
            panic!("{status}: {failed:?}");
        };
        assert_eq!(message.key, "host.map.tile.status", "{status}");
        let said = message
            .args
            .iter()
            .any(|arg| arg.name == "status" && format!("{:?}", arg.value).contains(code));
        assert!(said, "{status}: {message:?}");
        server.join().expect("server");
    }
}
