//! Le tessere della vista Mappa arrivano soltanto dagli host che questa
//! macchina ammette, e soltanto se sono ciò che la mappa accetta. La rete è
//! finta: risponde ciò che la prova le dice e ricorda che cosa le si è chiesto,
//! così «nessuna richiesta» si vede e non si suppone.

use std::sync::{Arc, Mutex};

use fub_abi::net::{HttpHeader, HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
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
