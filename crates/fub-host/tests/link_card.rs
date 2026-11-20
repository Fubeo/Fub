//! La scheda di un collegamento sull'host vero: la pagina si scarica attraverso la Guard, la
//! scheda finisce nella cache del bundle in `.fub/`, e col permesso spento
//! risponde soltanto la cache.
#![cfg(feature = "http-client")]

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::net::{HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::link_card::{
    cache_path, LINK_CARD_FETCH, LINK_CARD_ID, LINK_CARD_JOB, MAX_ICON, MAX_PAGE,
};
use fub_host::Host;

#[derive(Default)]
struct Web(Mutex<Vec<String>>);

impl HostNetwork for Web {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.0.lock().unwrap().push(request.url.clone());
        let body: &[u8] = if request.url.ends_with("favicon.ico") {
            b"\x89PNG\r\n\x1a\nicona"
        } else {
            b"<head><title>Una pagina</title><meta name=description content=Breve></head>"
        };
        Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: body.to_vec(),
        })
    }
}

fn find(dir: &Utf8Path, name: &str) -> Option<Utf8PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = Utf8PathBuf::from_path_buf(entry.path()).ok()?;
        if path.is_dir() {
            if let Some(found) = find(&path, name) {
                return Some(found);
            }
        } else if path.as_str().ends_with(name) {
            return Some(path);
        }
    }
    None
}

#[test]
fn the_card_is_fetched_through_the_guard_and_the_cache_answers_when_denied() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let network = Arc::new(Web::default());
    let host = Host::without_watcher().with_network(network.clone());
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let job = |url: &str, fetch: bool| {
        host.invoke_job(
            Some(root.as_str()),
            LINK_CARD_ID,
            LINK_CARD_JOB,
            serde_json::json!({ "url": url, "fetch": fetch }),
        )
    };

    // Senza chiedere, niente rete e niente scheda.
    let out = job("https://esempio.it/pagina", false).unwrap();
    assert!(out["card"].is_null(), "{out}");
    assert!(network.0.lock().unwrap().is_empty());

    let out = job("https://esempio.it/pagina", true).unwrap();
    assert_eq!(out["card"]["title"], "Una pagina", "{out}");
    assert_eq!(out["card"]["description"], "Breve");
    assert!(out["card"]["icon"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(
        network.0.lock().unwrap().as_slice(),
        [
            "https://esempio.it/pagina",
            "https://esempio.it/favicon.ico"
        ]
    );
    let file = cache_path("https://esempio.it/pagina");
    let name = file.rsplit('/').next().unwrap();
    let on_disk = find(&root.join(".fub"), name).expect("la scheda sta nella cache in .fub/");
    assert!(on_disk.as_str().contains(LINK_CARD_ID), "{on_disk}");

    host.set_setting_for_user(
        Some(root.as_str()),
        &fub_abi::settings::permission_key(LINK_CARD_ID, fub_abi::options::permission::NETWORK),
        SettingValue::Toggle(false),
    )
    .unwrap();
    // La scheda già scaricata resta, e il comando la dà senza job; una nuova è
    // rifiutata dalla Guard.
    let out = job("https://esempio.it/pagina", true).unwrap();
    assert_eq!(out["cached"], true, "{out}");
    let outcome = host
        .invoke_user_command(
            Some(root.as_str()),
            LINK_CARD_FETCH,
            serde_json::json!({ "url": "https://esempio.it/pagina" }),
            InvokeMode::Apply,
        )
        .unwrap();
    match outcome.effect {
        CommandEffect::Custom { ns, payload } => {
            assert_eq!(ns, LINK_CARD_ID);
            assert_eq!(payload["card"]["title"], "Una pagina", "{payload}");
            assert_eq!(payload["pending"], false);
        }
        other => panic!("{other:?}"),
    }
    let error = job("https://altro.it/", true).unwrap_err();
    assert!(
        matches!(error, PluginError::PermissionDenied(_)),
        "{error:?}"
    );
    assert_eq!(network.0.lock().unwrap().len(), 2, "niente rete se negata");
}

/// Un sito che avrebbe `page` byte di pagina e `icon` byte di icona: applica
/// il tetto ricevuto come il filo vero, leggendo a pezzi e smettendo appena lo
/// supera. Ricorda, per indirizzo, il tetto ricevuto e i byte mandati; senza
/// tetto (`fetch`) manda tutto.
struct Sized {
    page: u64,
    icon: u64,
    seen: Mutex<Vec<(String, Option<u64>, u64)>>,
}

const SERVER_CHUNK: u64 = 16 * 1024;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nicona";

impl Sized {
    fn serve(&self, url: &str, cap: Option<u64>) -> Result<HttpResponse, LimitedFetchError> {
        let icon = url.ends_with("favicon.ico");
        let size = if icon { self.icon } else { self.page };
        let mut sent = 0u64;
        let mut refused = None;
        while sent < size {
            sent += SERVER_CHUNK.min(size - sent);
            if let Some(cap) = cap.filter(|cap| sent > *cap) {
                refused = Some(cap);
                break;
            }
        }
        self.seen.lock().unwrap().push((url.to_owned(), cap, sent));
        if let Some(limit) = refused {
            return Err(LimitedFetchError::TooLarge {
                limit,
                status: 200,
                headers: Vec::new(),
            });
        }
        let mut body = if icon {
            PNG.to_vec()
        } else {
            b"<head><title>Grande</title></head>".to_vec()
        };
        body.resize(size as usize, b' ');
        Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body,
        })
    }
}

impl HostNetwork for Sized {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.serve(&request.url, None).map_err(|error| match error {
            LimitedFetchError::Failed(error) => error,
            other => PluginError::Io(other.to_string().into()),
        })
    }

    fn fetch_limited(
        &self,
        request: HttpRequest,
        _: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        self.serve(&request.url, Some(max_bytes))
    }
}

fn card_with(page: u64, icon: u64) -> (serde_json::Value, Vec<(String, Option<u64>, u64)>) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let network = Arc::new(Sized {
        page,
        icon,
        seen: Mutex::new(Vec::new()),
    });
    let host = Host::without_watcher().with_network(network.clone());
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let out = host
        .invoke_job(
            Some(root.as_str()),
            LINK_CARD_ID,
            LINK_CARD_JOB,
            serde_json::json!({ "url": "https://esempio.it/pagina", "fetch": true }),
        )
        .unwrap();
    let seen = network.seen.lock().unwrap().clone();
    (out, seen)
}

/// Il tetto della pagina e quello dell'icona arrivano alla rete, attraverso
/// il job e la Guard: da un sito che manderebbe sedici mebibyte se ne legge al
/// più il tetto e un pezzo. La pagina oltre il tetto resta «troppo grande»,
/// l'icona oltre il tetto resta «niente icona».
#[test]
fn page_and_icon_stop_the_download_at_their_cap() {
    let huge = 16 * MAX_PAGE as u64;
    let (out, seen) = card_with(huge, 0);
    assert_eq!(out["failed"], "too_large", "{out}");
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert_eq!(seen[0].1, Some(MAX_PAGE as u64));
    assert!(
        seen[0].2 <= MAX_PAGE as u64 + SERVER_CHUNK,
        "read {} bytes for a cap of {MAX_PAGE}",
        seen[0].2
    );

    let (out, seen) = card_with(1024, huge);
    assert_eq!(out["card"]["title"], "Grande", "{out}");
    assert_eq!(out["card"]["icon"], "", "{out}");
    assert_eq!(seen[1].0, "https://esempio.it/favicon.ico");
    assert_eq!(seen[1].1, Some(MAX_ICON as u64));
    assert!(
        seen[1].2 <= MAX_ICON as u64 + SERVER_CHUNK,
        "read {} bytes for a cap of {MAX_ICON}",
        seen[1].2
    );
}

/// Il confine è incluso: pagina e icona esattamente al tetto fanno la scheda
/// con l'icona.
#[test]
fn page_and_icon_exactly_at_the_cap_make_a_card() {
    let (out, _) = card_with(MAX_PAGE as u64, MAX_ICON as u64);
    assert_eq!(out["card"]["title"], "Grande", "{out}");
    assert!(
        out["card"]["icon"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"),
        "{out}"
    );
}
