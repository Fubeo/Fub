//! Una pagina del visore diventa una nota soltanto da un sito approvato su
//! questa macchina: la prova non chiama la rete, la rete risponde con l'HTML,
//! e la nota è Markdown con la fonte. Un sito non approvato, un redirect o una
//! risposta che non è HTML non scrivono niente e lo dicono.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::net::{HttpHeader, HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
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
