//! La scheda di un collegamento sull'host vero: la pagina si scarica attraverso la Guard, la
//! scheda finisce nella cache del bundle in `.fub/`, e col permesso spento
//! risponde soltanto la cache.
#![cfg(feature = "http-client")]

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::link_card::{cache_path, LINK_CARD_FETCH, LINK_CARD_ID, LINK_CARD_JOB};
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
