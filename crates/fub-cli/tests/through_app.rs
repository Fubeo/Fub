//! La CLI su un vault che l'app tiene aperto: il processo del test fa la parte
//! dell'app (un `Host` con il vault aperto e il canale di controllo), il
//! binario quella dell'utente al terminale.

use std::process::{Command, Output};
use std::sync::Arc;
use std::time::Duration;

use fub_host::control::{answer, ControlServer};

struct App {
    host: Arc<fub_host::Host>,
    _server: ControlServer,
}

fn app(vault: &std::path::Path, config: &std::path::Path) -> App {
    let config = camino::Utf8Path::from_path(config).unwrap();
    let host = Arc::new(fub_host::Host::without_watcher().with_config_dir(config));
    host.open(camino::Utf8Path::from_path(vault).unwrap())
        .expect("l'app apre il vault");
    while !host
        .wait_indexed_for(None, Duration::from_millis(100))
        .unwrap()
    {}
    let served = Arc::clone(&host);
    let server = ControlServer::start(config, move |call| answer(&served, call)).unwrap();
    App {
        host,
        _server: server,
    }
}

fn cli(vault: &std::path::Path, config: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_fub-cli"))
        .env_remove("FUB_CONFIG_DIR")
        .env_remove("FUB_VAULT")
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "--config-dir",
            config.to_str().unwrap(),
            "--format",
            "json",
        ])
        .args(args)
        .output()
        .unwrap()
}

fn ok(output: &Output) -> serde_json::Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn with_the_app_open_the_cli_reads_writes_and_searches_through_it() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("a.md"), "# A\n\nrosa spina\n").unwrap();
    let app = app(&vault, &config);

    let read = ok(&cli(&vault, &config, &["read", "a.md", "--revision"]));
    assert_eq!(read["data"]["source"], "# A\n\nrosa spina\n");
    let revision = read["data"]["revision"].as_str().unwrap().to_string();

    // La scrittura la fa l'app, con la revisione letta: l'app la vede subito.
    let written = ok(&cli(
        &vault,
        &config,
        &[
            "--yes",
            "write",
            "a.md",
            "--base",
            &revision,
            "--text",
            "# A\n\nrosa gambo\n",
        ],
    ));
    assert!(written["data"]["revision"].is_string(), "{written}");
    let doc = fub_host::doc_id("a.md").unwrap();
    assert_eq!(
        app.host.read_document(None, &doc).unwrap().0,
        "# A\n\nrosa gambo\n"
    );

    // Una revisione vecchia è un conflitto, come in locale.
    let stale = cli(
        &vault,
        &config,
        &[
            "--yes", "write", "a.md", "--base", &revision, "--text", "perso",
        ],
    );
    assert_eq!(
        stale.status.code(),
        Some(5),
        "{}",
        String::from_utf8_lossy(&stale.stderr)
    );
    assert_eq!(
        app.host.read_document(None, &doc).unwrap().0,
        "# A\n\nrosa gambo\n"
    );

    let found = ok(&cli(&vault, &config, &["query", "--text", "gambo"]));
    assert_eq!(found["data"]["total"], 1, "{found}");

    // La cattura passa dal comando dell'host, nell'app.
    let captured = ok(&cli(
        &vault,
        &config,
        &[
            "--yes",
            "capture",
            "--title",
            "Lago",
            "--text",
            "acqua ferma",
        ],
    ));
    let made = captured["data"]["doc"].as_str().unwrap();
    let source = app
        .host
        .read_document(None, &fub_host::doc_id(made).unwrap())
        .unwrap()
        .0;
    assert!(source.contains("acqua ferma"), "{source}");

    let opened = ok(&cli(&vault, &config, &["vault", "open"]));
    assert_eq!(opened["data"]["via"], "app", "{opened}");
}

#[test]
fn standalone_or_without_an_app_the_vault_stays_busy() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("a.md"), "x\n").unwrap();
    let app = app(&vault, &config);

    let standalone = cli(&vault, &config, &["--standalone", "read", "a.md"]);
    assert_eq!(standalone.status.code(), Some(5));

    // L'app se ne va: il file del canale sparisce e il vault, ancora tenuto
    // dall'host, è occupato come prima.
    drop(app._server);
    let busy = cli(&vault, &config, &["read", "a.md"]);
    assert_eq!(busy.status.code(), Some(5));
    let error: serde_json::Value = serde_json::from_slice(&busy.stderr).unwrap();
    assert_eq!(error["kind"], "busy");
    drop(app.host);
}

#[test]
fn with_the_app_open_componenti_turns_bundles_off_and_on_through_it() {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("a.md"), "# A\n").unwrap();
    let app = app(&vault, &config);
    let graph_mounted = |app: &App| {
        app.host
            .bundles(None)
            .unwrap()
            .iter()
            .any(|b| b.id == "fub.graph" && b.mounted)
    };
    assert!(graph_mounted(&app));

    let list = ok(&cli(&vault, &config, &["componenti"]));
    let graph = list["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "fub.graph")
        .unwrap()
        .clone();
    assert_eq!(graph["enabled"], true);

    // Lo spegne l'app: smonta il bundle e lo scrive in plugins.disabled.
    let off = ok(&cli(
        &vault,
        &config,
        &["--yes", "componenti", "spegni", "fub.graph"],
    ));
    assert_eq!(off["data"]["dry_run"], false);
    assert!(!graph_mounted(&app));
    let why = ok(&cli(
        &vault,
        &config,
        &["componenti", "perche", "fub.graph"],
    ));
    assert_eq!(why["data"]["reason"], "off");

    ok(&cli(
        &vault,
        &config,
        &["--yes", "componenti", "accendi", "fub.graph"],
    ));
    assert!(graph_mounted(&app));
    let disabled = ok(&cli(
        &vault,
        &config,
        &["config", "--get", "plugins.disabled"],
    ));
    assert_eq!(disabled["data"]["value"], serde_json::json!([]));
}
