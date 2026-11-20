//! Le tessere della vista Mappa di una Base: [`Host::map_tile`].
//!
//! Un `.base` può dichiarare un fornitore di tessere (`url_template`,
//! `network: true`), ma il file sta nel vault, e un vault scaricato non deve
//! poter far uscire richieste. Chi decide a chi si chiede è **questa
//! macchina**: [`MAP_TILE_HOSTS`], un'impostazione di macchina vuota di serie.
//! Vuota, nessuna richiesta parte.
//!
//! Le tessere le scarica l'host, con il filo verso fuori che hanno tutti
//! ([`Host::network`], `UreqNetwork`): la webview non apre connessioni (la sua
//! CSP non ammette `https:` in `connect-src`) e riceve soltanto byte già
//! controllati. Le regole stanno qui, e la shell non le può allargare: il suo
//! controllo (`allowedBaseTileUrl`) è una comodità per non chiedere ciò che
//! verrebbe rifiutato.
//!
//! - solo `https`, porta 443, senza credenziali, query o frammento;
//! - l'host esattamente fra quelli di [`MAP_TILE_HOSTS`] (niente sottodomini
//!   impliciti);
//! - nessun redirect: il filo non li segue e un `3xx` è un rifiuto;
//! - al più [`MAX_TILE_BYTES`] byte, entro [`TILE_TIMEOUT`]: il tetto va alla
//!   rete (`HostNetwork::fetch_limited`), che smette di leggere appena lo
//!   supera, e si ricontrolla dopo per un filo che non lo sa applicare;
//! - PNG, JPEG o WebP per un fornitore raster, controllati sul tipo dichiarato
//!   **e** sui primi byte; SVG soltanto per un fornitore vettoriale, testo
//!   UTF-8 con una radice `<svg` e senza DOCTYPE (le entità di un DOCTYPE sono
//!   il modo di far esplodere un parser XML). La shell lo mostra soltanto come
//!   `<image>` di un SVG, dove script e risorse esterne non partono;
//! - al più [`MAX_TILES_IN_FLIGHT`] richieste insieme in tutto il processo;
//! - un `User-Agent` che dice l'app e la versione, nient'altro: niente
//!   cookie (il client non ne ha), niente `Referer`, niente credenziali.
//!
//! Le tessere scaricate restano in memoria, fino a [`CACHE_BYTES`] in tutto,
//! perché chi le serve chiede di non riscaricare ciò che si è già avuto
//! (la policy delle tessere di OpenStreetMap). Niente va su disco né nel vault.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use fub_abi::net::{HttpRequest, LimitedFetchError};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;

use crate::Host;

/// Gli host da cui la vista Mappa può scaricare tessere, su questa macchina.
pub const MAP_TILE_HOSTS: &str = "map.tile-hosts";

/// Il fornitore che le Impostazioni propongono con un clic.
pub const OPENSTREETMAP_TILE_HOST: &str = "tile.openstreetmap.org";

/// Quanti byte può pesare una tessera.
pub const MAX_TILE_BYTES: usize = 1024 * 1024;

/// Quanto si aspetta una tessera, connessione compresa. Il filo ha tetti suoi
/// più larghi (dieci secondi per connettersi, sessanta in tutto); una tessera
/// che non arriva in questo tempo non serve più a chi guarda la mappa.
pub const TILE_TIMEOUT: Duration = Duration::from_secs(15);

/// Quante tessere si scaricano insieme, in tutto il processo. Due, come chiede
/// chi le serve gratis: una vista ne chiede fino a 64 e le aspetta in fila.
pub const MAX_TILES_IN_FLIGHT: usize = 2;

/// Quanto aspetta una richiesta in fila prima di dire che il filo è occupato.
const QUEUE_WAIT: Duration = Duration::from_secs(30);

/// Quanti byte di tessere restano in memoria.
pub const CACHE_BYTES: usize = 8 * 1024 * 1024;

/// Il `User-Agent` delle tessere: il nome dell'app e la versione, per chi serve
/// le tessere e vuole sapere chi chiede. Nessun dato di chi usa l'app.
const USER_AGENT: &str = concat!(
    "Fub/",
    env!("CARGO_PKG_VERSION"),
    " (map tiles; +https://github.com/Fubeo/Fub)"
);

/// Il genere del fornitore, com'è nel `.base`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TileKind {
    Raster,
    Vector,
}

/// Una tessera arrivata e controllata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapTile {
    /// Il tipo, letto dai byte e uguale a quello dichiarato.
    pub mime: &'static str,
    pub bytes: Arc<[u8]>,
}

/// L'host di un indirizzo di tessera, se l'indirizzo ha la forma ammessa:
/// `https`, senza credenziali, porta 443 o nessuna, senza query né frammento.
/// In minuscolo.
fn tile_host(url: &str) -> Option<String> {
    let scheme = url.get(..8)?;
    if !scheme.eq_ignore_ascii_case("https://") {
        return None;
    }
    let rest = &url[8..];
    if rest.contains(['?', '#', '\\']) || rest.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return None;
    }
    let (authority, path) = rest.split_once('/')?;
    if path.is_empty() {
        return None;
    }
    if authority.is_empty() || authority.contains('@') || authority.starts_with('[') {
        return None;
    }
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    if port.is_some_and(|port| port != "443") || !is_host_name(host) {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// Un nome di host come si scrive nell'impostazione: lettere ASCII, cifre,
/// trattini e punti, etichette non vuote, al più 253 caratteri. Niente schema,
/// porta, percorso o caratteri jolly.
pub fn is_host_name(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// Gli host ammessi su questa macchina, in minuscolo.
fn allowed_hosts(host: &Host) -> Vec<String> {
    match host.machine.effective(MAP_TILE_HOSTS) {
        Ok((SettingValue::List(hosts), _)) => hosts
            .iter()
            .map(|entry| entry.trim().to_ascii_lowercase())
            .filter(|entry| !entry.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// Il tipo di una tessera dai suoi primi byte, se è uno di quelli ammessi per
/// il genere del fornitore.
fn sniffed(kind: TileKind, bytes: &[u8]) -> Option<&'static str> {
    match kind {
        TileKind::Raster => {
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                Some("image/png")
            } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                Some("image/jpeg")
            } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
                Some("image/webp")
            } else {
                None
            }
        }
        TileKind::Vector => {
            let text = std::str::from_utf8(bytes).ok()?;
            let text = text.strip_prefix('\u{feff}').unwrap_or(text);
            let lower = text.to_ascii_lowercase();
            if lower.contains("<!doctype") || lower.contains("<!entity") {
                return None;
            }
            let head = lower.trim_start();
            let rooted =
                head.starts_with("<svg") || (head.starts_with("<?xml") && lower.contains("<svg"));
            rooted.then_some("image/svg+xml")
        }
    }
}

/// Il tipo dichiarato, senza parametri, in minuscolo.
fn declared(kind: Option<&str>) -> Option<String> {
    let kind = kind?.split(';').next()?.trim().to_ascii_lowercase();
    (!kind.is_empty()).then_some(kind)
}

/// La fila delle richieste: al più [`MAX_TILES_IN_FLIGHT`] insieme.
struct Gate {
    busy: Mutex<usize>,
    freed: Condvar,
}

static GATE: Gate = Gate {
    busy: Mutex::new(0),
    freed: Condvar::new(),
};

/// Il posto preso nella fila; lo rende quando esce di scena.
struct Seat;

impl Gate {
    fn enter(&'static self) -> Option<Seat> {
        let busy = self
            .busy
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let (mut busy, timeout) = self
            .freed
            .wait_timeout_while(busy, QUEUE_WAIT, |busy| *busy >= MAX_TILES_IN_FLIGHT)
            .unwrap_or_else(|poison| poison.into_inner());
        if timeout.timed_out() && *busy >= MAX_TILES_IN_FLIGHT {
            return None;
        }
        *busy += 1;
        Some(Seat)
    }
}

impl Drop for Seat {
    fn drop(&mut self) {
        let mut busy = GATE
            .busy
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *busy = busy.saturating_sub(1);
        GATE.freed.notify_one();
    }
}

/// Le tessere già arrivate, le più recenti in fondo.
struct Cache {
    tiles: VecDeque<(String, MapTile)>,
    bytes: usize,
}

static CACHE: Mutex<Cache> = Mutex::new(Cache {
    tiles: VecDeque::new(),
    bytes: 0,
});

fn cached(url: &str, kind: TileKind) -> Option<MapTile> {
    let mut cache = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    let at = cache.tiles.iter().position(|(seen, _)| seen == url)?;
    let entry = cache.tiles.remove(at)?;
    let tile = entry.1.clone();
    cache.tiles.push_back(entry);
    // Una tessera chiesta con l'altro genere si controlla di nuovo.
    (sniffed(kind, &tile.bytes) == Some(tile.mime)).then_some(tile)
}

fn remember(url: &str, tile: &MapTile) {
    let mut cache = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(at) = cache.tiles.iter().position(|(seen, _)| seen == url) {
        if let Some((_, old)) = cache.tiles.remove(at) {
            cache.bytes -= old.bytes.len();
        }
    }
    cache.bytes += tile.bytes.len();
    cache.tiles.push_back((url.to_owned(), tile.clone()));
    while cache.bytes > CACHE_BYTES {
        let Some((_, old)) = cache.tiles.pop_front() else {
            break;
        };
        cache.bytes -= old.bytes.len();
    }
}

fn refused(key: &str, args: Vec<Arg>) -> PluginError {
    PluginError::PermissionDenied(Text::message(key, args))
}

fn failed(key: &str, args: Vec<Arg>) -> PluginError {
    PluginError::Io(Text::message(key, args))
}

/// Il rifiuto per lo stato della risposta: un `3xx` è un redirect che non si
/// segue, ogni altro stato fuori da `2xx` un errore del sito. Vale sia per la
/// risposta letta sia per quella fermata dal tetto di byte.
fn status_refusal(status: u16, site: &str) -> Result<(), PluginError> {
    if (300..400).contains(&status) {
        return Err(refused(
            "host.map.tile.redirect",
            vec![Arg::text("site", site)],
        ));
    }
    if !(200..300).contains(&status) {
        return Err(failed(
            "host.map.tile.status",
            vec![
                Arg::text("site", site),
                Arg::text("status", status.to_string()),
            ],
        ));
    }
    Ok(())
}

impl Host {
    /// Una tessera della vista Mappa, se questa macchina ammette l'host
    /// dell'indirizzo. Vedi la testa del modulo per le regole.
    ///
    /// Gli errori: `PermissionDenied` per un indirizzo o un host non ammesso e
    /// per un redirect; `Unserved` se l'host non ha un filo verso fuori; `Io`
    /// per la rete, uno stato diverso da 2xx, una tessera troppo grande o di
    /// un tipo che non si accetta.
    pub fn map_tile(&self, url: &str, kind: TileKind) -> Result<MapTile, PluginError> {
        let Some(site) = tile_host(url) else {
            return Err(refused(
                "host.map.tile.not_https",
                vec![Arg::text("url", url)],
            ));
        };
        if !allowed_hosts(self).contains(&site) {
            return Err(refused(
                "host.map.tile.not_allowed",
                vec![Arg::text("site", &site)],
            ));
        }
        if let Some(tile) = cached(url, kind) {
            return Ok(tile);
        }
        let network = self
            .network()
            .ok_or_else(|| PluginError::Unserved(Text::key("host.map.tile.no_network")))?;
        let Some(_seat) = GATE.enter() else {
            return Err(failed("host.map.tile.busy", Vec::new()));
        };
        let request = HttpRequest::get(url)
            .with_header("User-Agent", USER_AGENT)
            .with_header(
                "Accept",
                match kind {
                    TileKind::Raster => "image/png, image/jpeg, image/webp",
                    TileKind::Vector => "image/svg+xml",
                },
            );
        // Il tetto va alla rete, che smette di leggere appena lo supera: un
        // server rotto o ostile non fa scaricare il tetto generale dell'host
        // per ogni tessera.
        let response = with_deadline(TILE_TIMEOUT, |cancelled| {
            network.fetch_limited(request, cancelled, MAX_TILE_BYTES as u64)
        })
        .map_err(|error| match error {
            // Lo stato prima del tetto: un redirect o un `404` con un corpo
            // enorme restano un redirect e un errore di stato.
            LimitedFetchError::TooLarge { status, .. } => match status_refusal(status, &site) {
                Err(refusal) => refusal,
                Ok(()) => failed("host.map.tile.too_large", vec![Arg::text("site", &site)]),
            },
            LimitedFetchError::Failed(PluginError::Cancelled(_)) => {
                failed("host.map.tile.timeout", vec![Arg::text("site", &site)])
            }
            LimitedFetchError::Failed(PluginError::Io(_)) => {
                failed("host.map.tile.network", vec![Arg::text("site", &site)])
            }
            LimitedFetchError::Failed(other) => other,
        })?;
        status_refusal(response.status, &site)?;
        if response.body.len() > MAX_TILE_BYTES {
            return Err(failed(
                "host.map.tile.too_large",
                vec![Arg::text("site", &site)],
            ));
        }
        let said = declared(response.content_type());
        let seen = sniffed(kind, &response.body);
        let mime = match (said.as_deref(), seen) {
            (Some(said), Some(seen)) if said == seen => seen,
            _ => {
                return Err(failed(
                    "host.map.tile.bad_type",
                    vec![
                        Arg::text("site", &site),
                        Arg::text("kind", said.unwrap_or_default()),
                    ],
                ))
            }
        };
        let tile = MapTile {
            mime,
            bytes: Arc::from(response.body),
        };
        remember(url, &tile);
        Ok(tile)
    }
}

/// `work` con una bandiera che si alza dopo `limit`: il filo la guarda mentre
/// legge e smette. Il guardiano se ne va appena `work` è finito.
fn with_deadline<T>(limit: Duration, work: impl FnOnce(&AtomicBool) -> T) -> T {
    let cancelled = Arc::new(AtomicBool::new(false));
    let done = Arc::new((Mutex::new(false), Condvar::new()));
    let watchdog = {
        let cancelled = Arc::clone(&cancelled);
        let done = Arc::clone(&done);
        std::thread::Builder::new()
            .name("fub-map-tile".into())
            .spawn(move || {
                let (lock, finished) = &*done;
                let over = lock.lock().unwrap_or_else(|poison| poison.into_inner());
                let (over, _) = finished
                    .wait_timeout_while(over, limit, |over| !*over)
                    .unwrap_or_else(|poison| poison.into_inner());
                if !*over {
                    cancelled.store(true, Ordering::Relaxed);
                }
            })
    };
    let result = work(&cancelled);
    {
        let (lock, finished) = &*done;
        *lock.lock().unwrap_or_else(|poison| poison.into_inner()) = true;
        finished.notify_all();
    }
    if let Ok(watchdog) = watchdog {
        let _ = watchdog.join();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_bare_https_tile_addresses_name_a_host() {
        assert_eq!(
            tile_host("https://Tile.OpenStreetMap.org/1/0/0.png").as_deref(),
            Some("tile.openstreetmap.org")
        );
        assert_eq!(
            tile_host("https://tiles.example.test:443/1/0/0.png").as_deref(),
            Some("tiles.example.test")
        );
        for bad in [
            "http://tiles.example.test/1/0/0.png",
            "https://user:pw@tiles.example.test/1/0/0.png",
            "https://tiles.example.test:8443/1/0/0.png",
            "https://tiles.example.test/1/0/0.png?key=x",
            "https://tiles.example.test/1/0/0.png#x",
            "https://[::1]/1/0/0.png",
            "https://tiles.example.test",
            "https://tiles.example.test/",
            "https://tiles example.test/1.png",
            "https://*.example.test/1.png",
            "ftp://tiles.example.test/1.png",
        ] {
            assert_eq!(tile_host(bad), None, "{bad}");
        }
    }

    #[test]
    fn host_names_are_bare_names() {
        assert!(is_host_name("tile.openstreetmap.org"));
        assert!(is_host_name("a-b.example"));
        for bad in [
            "",
            "https://x.org",
            "x.org/",
            "x.org:443",
            "*.x.org",
            "-x.org",
            "x..org",
            "x .org",
        ] {
            assert!(!is_host_name(bad), "{bad}");
        }
    }

    #[test]
    fn the_bytes_must_be_what_the_provider_kind_allows() {
        assert_eq!(
            sniffed(TileKind::Raster, b"\x89PNG\r\n\x1a\nrest"),
            Some("image/png")
        );
        assert_eq!(
            sniffed(TileKind::Raster, &[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(
            sniffed(TileKind::Raster, b"RIFF\0\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(sniffed(TileKind::Raster, b"<svg/>"), None);
        assert_eq!(
            sniffed(
                TileKind::Vector,
                b"<svg xmlns='http://www.w3.org/2000/svg'/>"
            ),
            Some("image/svg+xml")
        );
        assert_eq!(
            sniffed(TileKind::Vector, b"<?xml version='1.0'?><svg/>"),
            Some("image/svg+xml")
        );
        assert_eq!(
            sniffed(TileKind::Vector, b"<!DOCTYPE svg [<!ENTITY a 'b'>]><svg/>"),
            None
        );
        assert_eq!(sniffed(TileKind::Vector, b"<html><svg/></html>"), None);
        assert_eq!(sniffed(TileKind::Vector, b"\x89PNG\r\n\x1a\n"), None);
    }

    #[test]
    fn a_deadline_raises_the_flag_only_when_the_work_overruns() {
        let quick = with_deadline(Duration::from_secs(5), |flag| flag.load(Ordering::Relaxed));
        assert!(!quick);
        let slow = with_deadline(Duration::from_millis(20), |flag| {
            for _ in 0..200 {
                if flag.load(Ordering::Relaxed) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        });
        assert!(slow);
    }
}
