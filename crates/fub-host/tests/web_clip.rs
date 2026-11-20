//! Una pagina del visore diventa una nota soltanto da un sito approvato su
//! questa macchina: la prova non chiama la rete, la rete risponde con l'HTML,
//! e la nota è Markdown con la fonte. Un sito non approvato, un redirect o una
//! risposta che non è HTML non scrivono niente e lo dicono.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::net::{HttpHeader, HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::settings::SettingValue;
use fub_abi::text::Text;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::web_clip::MAX_PAGE;
use fub_host::Host;
use serde_json::json;

/// Una rete che risponde sempre la stessa cosa e ricorda che cosa le si è
/// chiesto.
struct Page {
    status: u16,
    kind: &'static str,
    body: &'static str,
    seen: Mutex<Vec<String>>,
}

impl HostNetwork for Page {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.seen.lock().unwrap().push(request.url);
        Ok(HttpResponse {
            status: self.status,
            headers: vec![HttpHeader {
                name: "Content-Type".into(),
                value: self.kind.into(),
            }],
            body: self.body.as_bytes().to_vec(),
        })
    }
}

const ARTICLE: &str = "<html><head><title>Il lago &amp; i monti</title>\
    <script>alert(1)</script></head><body><h1>Il lago</h1>\
    <p>Una <strong>riga</strong> dal web.</p></body></html>";

fn page(status: u16, kind: &'static str, body: &'static str) -> Arc<Page> {
    Arc::new(Page {
        status,
        kind,
        body,
        seen: Mutex::new(Vec::new()),
    })
}

fn vault_with(network: Arc<Page>) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    vault_on(network)
}

fn vault_on(network: Arc<dyn HostNetwork>) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("Diario")).unwrap();
    std::fs::create_dir(&root).unwrap();
    let host = Host::without_watcher().with_network(network);
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    (dir, root, host)
}

fn approve(host: &Host, sites: &[&str]) {
    host.set_setting_for_user(
        None,
        "viewer.hosts",
        SettingValue::List(sites.iter().map(|site| site.to_string()).collect()),
    )
    .unwrap();
}

fn clip(
    host: &Host,
    url: &str,
    mode: InvokeMode,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.invoke_user_command(
        None,
        "web.clip",
        json!({ "url": url, "folder": "Web" }),
        mode,
    )
}

fn notes(root: &Utf8PathBuf) -> Vec<String> {
    let mut found = Vec::new();
    for entry in walk(root.as_std_path()) {
        if entry.extension().is_some_and(|ext| ext == "md") {
            found.push(
                entry
                    .strip_prefix(root.as_std_path())
                    .unwrap()
                    .display()
                    .to_string(),
            );
        }
    }
    found
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        {
            continue;
        }
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path);
        }
    }
    out
}

#[test]
fn an_approved_page_plans_without_the_network_then_becomes_a_markdown_note() {
    let network = page(200, "text/html; charset=utf-8", ARTICLE);
    let (_dir, root, host) = vault_with(network.clone());
    approve(&host, &["Esempio.it"]);

    let url = "https://esempio.it/lago";
    let plan = clip(&host, url, InvokeMode::DryRun).unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)), "{plan:?}");
    assert!(
        network.seen.lock().unwrap().is_empty(),
        "la prova non chiama la rete"
    );
    assert!(notes(&root).is_empty(), "la prova non scrive");

    let done = clip(&host, url, InvokeMode::Apply).unwrap();
    let CommandEffect::Navigate { doc } = &done.effect else {
        panic!("{done:?}");
    };
    assert_eq!(network.seen.lock().unwrap().as_slice(), [url]);
    assert!(doc.as_str().starts_with("Web/"), "{doc:?}");
    let text = std::fs::read_to_string(root.join(doc.as_str())).unwrap();
    assert!(
        text.contains("Il lago & i monti"),
        "il titolo della pagina: {text}"
    );
    assert!(text.contains("**riga**"), "Markdown, non HTML: {text}");
    assert!(
        !text.contains("<script") && !text.contains("alert"),
        "{text}"
    );
    assert!(text.contains(url), "la fonte resta nella nota: {text}");
}

#[test]
fn a_site_not_approved_or_not_https_never_reaches_the_network() {
    let network = page(200, "text/html", ARTICLE);
    let (_dir, root, host) = vault_with(network.clone());
    approve(&host, &["esempio.it"]);
    for url in [
        "https://altro.it/",
        "https://statico.esempio.it/",
        "http://esempio.it/",
        "https://esempio.it:8443/",
        "https://io@esempio.it/",
    ] {
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = clip(&host, url, mode).unwrap_err();
            assert!(
                matches!(error, PluginError::PermissionDenied(_)),
                "{url}: {error:?}"
            );
        }
    }
    assert!(network.seen.lock().unwrap().is_empty());
    assert!(notes(&root).is_empty());
}

#[test]
fn a_redirect_or_an_answer_that_is_not_a_page_writes_nothing() {
    for (status, kind) in [
        (301, "text/html"),
        (404, "text/html"),
        (200, "application/pdf"),
    ] {
        let (_dir, root, host) = vault_with(page(status, kind, ARTICLE));
        approve(&host, &["esempio.it"]);
        let error = clip(&host, "https://esempio.it/", InvokeMode::Apply).unwrap_err();
        assert!(
            matches!(error, PluginError::Io(_) | PluginError::BadArgs(_)),
            "{status} {kind}: {error:?}"
        );
        assert!(notes(&root).is_empty(), "{status} {kind}");
    }
}

/// Un server che avrebbe `body` byte di HTML: applica il tetto ricevuto come
/// il filo vero, leggendo a pezzi e smettendo appena lo supera, e ricorda il
/// tetto e quanti byte ha mandato. Senza tetto (`fetch`) li manda tutti.
struct Endless {
    status: u16,
    kind: &'static str,
    body: u64,
    cap_seen: Mutex<Option<u64>>,
    sent: Mutex<u64>,
}

const SERVER_CHUNK: u64 = 16 * 1024;

impl Endless {
    fn serve(&self, cap: Option<u64>) -> Result<HttpResponse, LimitedFetchError> {
        let headers = vec![HttpHeader::new("Content-Type", self.kind)];
        let mut sent = 0u64;
        while sent < self.body {
            sent += SERVER_CHUNK.min(self.body - sent);
            *self.sent.lock().unwrap() = sent;
            if let Some(cap) = cap.filter(|cap| sent > *cap) {
                return Err(LimitedFetchError::TooLarge {
                    limit: cap,
                    status: self.status,
                    headers,
                });
            }
        }
        let mut body = b"<title>Pagina</title><p>testo</p>".to_vec();
        body.resize(self.body as usize, b' ');
        Ok(HttpResponse {
            status: self.status,
            headers,
            body,
        })
    }
}

impl HostNetwork for Endless {
    fn fetch(&self, _: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.serve(None).map_err(|error| match error {
            LimitedFetchError::Failed(error) => error,
            other => PluginError::Io(other.to_string().into()),
        })
    }

    fn fetch_limited(
        &self,
        _: HttpRequest,
        _: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        *self.cap_seen.lock().unwrap() = Some(max_bytes);
        self.serve(Some(max_bytes))
    }
}

fn endless(status: u16, body: u64) -> Arc<Endless> {
    endless_of(status, "text/html", body)
}

fn endless_of(status: u16, kind: &'static str, body: u64) -> Arc<Endless> {
    Arc::new(Endless {
        status,
        kind,
        body,
        cap_seen: Mutex::new(None),
        sent: Mutex::new(0),
    })
}

/// Il testo dell'errore come lo vede chi usa Fub: il comando dell'utente lo
/// rende nella lingua dell'interfaccia.
fn shown(text: &Text) -> String {
    match text {
        Text::Literal(text) => text.to_string(),
        other => panic!("not rendered: {other:?}"),
    }
}

/// Il tetto della pagina arriva alla rete: da un server che manda sedici
/// mebibyte se ne leggono al più due e un pezzo, e il rifiuto è quello di
/// sempre per la pagina troppo grande.
#[test]
fn a_page_over_the_cap_stops_the_download_at_the_cap() {
    let network = endless(200, 16 * MAX_PAGE as u64);
    let (_dir, root, host) = vault_on(network.clone());
    approve(&host, &["esempio.it"]);
    let error = clip(&host, "https://esempio.it/enorme", InvokeMode::Apply).unwrap_err();
    // La frase di `host.web.clip.too_large`.
    let PluginError::BadArgs(text) = &error else {
        panic!("{error:?}");
    };
    assert!(shown(text).contains("supera i 2 MiB"), "{error:?}");
    assert_eq!(*network.cap_seen.lock().unwrap(), Some(MAX_PAGE as u64));
    let sent = *network.sent.lock().unwrap();
    assert!(
        sent <= MAX_PAGE as u64 + SERVER_CHUNK,
        "read {sent} bytes for a cap of {MAX_PAGE}"
    );
    assert!(notes(&root).is_empty());
}

/// Lo stato prima del tetto: un `404` enorme resta l'errore di stato.
#[test]
fn an_oversized_error_keeps_its_status_refusal() {
    let (_dir, root, host) = vault_on(endless(404, 16 * MAX_PAGE as u64));
    approve(&host, &["esempio.it"]);
    let error = clip(&host, "https://esempio.it/assente", InvokeMode::Apply).unwrap_err();
    // La frase di `host.web.clip.status`.
    let PluginError::Io(text) = &error else {
        panic!("{error:?}");
    };
    assert!(shown(text).contains("ha risposto 404"), "{error:?}");
    assert!(notes(&root).is_empty());
}

/// Il tipo prima del tetto: un PDF enorme resta «non è una pagina», non
/// «troppo grande», come un PDF piccolo.
#[test]
fn an_oversized_file_that_is_not_a_page_says_so() {
    let (_dir, root, host) = vault_on(endless_of(200, "application/pdf", 5 * 1024 * 1024));
    approve(&host, &["esempio.it"]);
    let error = clip(&host, "https://esempio.it/articolo.pdf", InvokeMode::Apply).unwrap_err();
    let (_small_dir, _small_root, small_host) = vault_on(endless_of(200, "application/pdf", 1024));
    approve(&small_host, &["esempio.it"]);
    let small = clip(
        &small_host,
        "https://esempio.it/breve.pdf",
        InvokeMode::Apply,
    )
    .unwrap_err();
    // La frase di `host.web.clip.not_html`, la stessa del PDF piccolo.
    let (PluginError::BadArgs(text), PluginError::BadArgs(small_text)) = (&error, &small) else {
        panic!("{error:?} / {small:?}");
    };
    assert_eq!(shown(text), shown(small_text));
    assert!(shown(text).contains("application/pdf"), "{error:?}");
    assert!(notes(&root).is_empty());
}

/// Il confine è incluso: una pagina di due mebibyte esatti diventa una nota.
#[test]
fn a_page_exactly_at_the_cap_becomes_a_note() {
    let (_dir, root, host) = vault_on(endless(200, MAX_PAGE as u64));
    approve(&host, &["esempio.it"]);
    clip(&host, "https://esempio.it/esatta", InvokeMode::Apply).expect("a page at the cap");
    assert_eq!(notes(&root).len(), 1);
}

#[test]
fn the_approved_sites_are_a_machine_setting() {
    let host = Host::without_watcher();
    let entry = host
        .machine_settings()
        .into_iter()
        .find(|entry| entry.spec.key == "viewer.hosts")
        .expect("dichiarata al livello macchina");
    assert_eq!(entry.value, SettingValue::List(Vec::new()));
}
