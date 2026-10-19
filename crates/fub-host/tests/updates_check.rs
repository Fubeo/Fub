//! Il controllo degli aggiornamenti sull'host vero: il job passa dalla Guard,
//! e la Guard lo lascia arrivare soltanto a `api.github.com`.
#![cfg(feature = "http-client")]

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::settings::SettingValue;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::Host;

#[derive(Default)]
struct Github(Mutex<Vec<String>>);

impl HostNetwork for Github {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.0.lock().unwrap().push(request.url);
        Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: br#"{"tag_name":"v999.0.0","html_url":"https://github.com/Fubeo/Fub/releases/tag/v999.0.0"}"#.to_vec(),
        })
    }
}

#[test]
fn the_check_asks_github_through_the_guard_and_stops_when_denied() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    let network = Arc::new(Github::default());
    let host = Host::without_watcher().with_network(network.clone());
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    let out = host
        .invoke_job(
            Some(root.as_str()),
            fub_host::updates::UPDATES_ID,
            fub_host::updates::UPDATES_CHECK_JOB,
            serde_json::json!({}),
        )
        .unwrap();
    assert_eq!(out["newer"], true, "{out}");
    assert_eq!(out["current"], fub_host::updates::CURRENT_VERSION);
    assert_eq!(
        network.0.lock().unwrap().as_slice(),
        ["https://api.github.com/repos/Fubeo/Fub/releases/latest"]
    );

    host.set_setting_for_user(
        Some(root.as_str()),
        &fub_abi::settings::permission_key(
            fub_host::updates::UPDATES_ID,
            fub_abi::options::permission::NETWORK,
        ),
        SettingValue::Toggle(false),
    )
    .unwrap();
    let error = host
        .invoke_job(
            Some(root.as_str()),
            fub_host::updates::UPDATES_ID,
            fub_host::updates::UPDATES_CHECK_JOB,
            serde_json::json!({}),
        )
        .unwrap_err();
    assert!(
        matches!(error, PluginError::PermissionDenied(_)),
        "{error:?}"
    );
    assert_eq!(network.0.lock().unwrap().len(), 1, "niente rete se negata");
}
