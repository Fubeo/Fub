//! I `fub://` che il sistema consegna aspettano la shell nell'host: arrivano
//! anche senza un vault aperto, si prendono una volta, e quelli che scrivono
//! scrivono soltanto quando la shell lo chiede, dopo una prova che non tocca
//! niente.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode};
use fub_abi::PluginError;
use fub_host::Host;
use serde_json::{json, Value};

fn pending(host: &Host) -> Value {
    let outcome = host
        .invoke_user_command(None, "uri.pending", json!({}), InvokeMode::Apply)
        .unwrap();
    match outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == "fub.uri.pending" => payload,
        other => panic!("{other:?}"),
    }
}

fn apply(host: &Host, uri: &str, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(None, "uri.apply", json!({ "uri": uri }), mode)
}

#[test]
fn what_arrives_before_any_vault_waits_and_is_taken_once() {
    let host = Host::without_watcher();
    assert!(host.receive_uri("fub://open?note=a.md"));
    assert!(host
        .receive_uri("fub://capture?title=T&markdown=x&success_callback=https%3A%2F%2Fesempio.it"));
    assert!(host.receive_uri("fub://exec?cmd=rm"));
    let taken = pending(&host);
    let actions = taken["actions"].as_array().unwrap();
    assert_eq!(actions.len(), 3, "{taken}");
    assert_eq!(actions[0]["action"], "open");
    assert_eq!(actions[0]["note"], "a.md");
    assert_eq!(actions[0]["writes"], false);
    assert!(
        actions[1]["error"].is_string(),
        "una callback non si apre: {taken}"
    );
    assert!(actions[2]["error"].is_string(), "un'azione ignota: {taken}");
    assert_eq!(pending(&host)["actions"], json!([]), "presi una volta");
}

#[test]
fn a_writing_link_plans_first_and_writes_only_when_applied() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("Diario")).unwrap();
    std::fs::create_dir(&root).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();

    host.receive_uri("fub://new?vault=Diario&title=Ciao");
    let taken = pending(&host);
    let action = &taken["actions"][0];
    assert_eq!(action["action"], "new", "{taken}");
    assert_eq!(action["writes"], true);
    assert_eq!(action["vault"]["asked"], "Diario");
    assert_eq!(action["vault"]["current"], true, "{taken}");

    let raw = action["raw"].as_str().unwrap();
    let plan = apply(&host, raw, InvokeMode::DryRun).unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)), "{plan:?}");
    assert!(!root.join("Ciao.md").exists(), "la prova non scrive");
    let done = apply(&host, raw, InvokeMode::Apply).unwrap();
    assert!(
        matches!(&done.effect, CommandEffect::Navigate { doc } if doc.as_str() == "Ciao.md"),
        "{done:?}"
    );
    assert!(std::fs::read_to_string(root.join("Ciao.md"))
        .unwrap()
        .contains("# Ciao"));

    let captured = apply(
        &host,
        "fub://capture?title=Ritaglio&markdown=Una%20riga%20dal%20web",
        InvokeMode::Apply,
    )
    .unwrap();
    let CommandEffect::Navigate { doc } = &captured.effect else {
        panic!("{captured:?}");
    };
    assert!(std::fs::read_to_string(root.join(doc.as_str()))
        .unwrap()
        .contains("Una riga dal web"));

    assert!(matches!(
        apply(&host, "fub://open?note=Ciao.md", InvokeMode::Apply),
        Err(PluginError::BadArgs(_))
    ));
    assert!(matches!(
        apply(&host, "fub://new?vault=Altrove&title=X", InvokeMode::DryRun),
        Err(PluginError::NotFound(_))
    ));
}

/// L'URI che il clipper apre davvero (`apps/clipper/tests/fixtures/`, scritto
/// dal suo test `capture-uri-contract`).
fn clipper_uri() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/clipper/tests/fixtures/capture-uri.txt"
    );
    std::fs::read_to_string(path).unwrap().trim().to_string()
}

fn vault(name: &str) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join(name)).unwrap();
    std::fs::create_dir(&root).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    (dir, root, host)
}

#[test]
fn the_clipper_uri_is_accepted_and_written_once() {
    let (_dir, root, host) = vault("Ritagli");
    let raw = clipper_uri();
    assert!(host.receive_uri(&raw));
    let taken = pending(&host);
    let action = &taken["actions"][0];
    assert!(
        action["error"].is_null(),
        "il clipper parla la lingua dell'app: {taken}"
    );
    assert_eq!(action["action"], "capture");
    assert_eq!(
        action["title"], "Ritaglio di prova",
        "lo spazio è %20, non +"
    );
    assert_eq!(action["folder"], "Clips");

    let done = apply(&host, &raw, InvokeMode::Apply).unwrap();
    let CommandEffect::Navigate { doc } = &done.effect else {
        panic!("{done:?}");
    };
    let text = std::fs::read_to_string(root.join(doc.as_str())).unwrap();
    assert!(text.contains("Una riga dal web, con & e ?."), "{text}");
    assert!(
        text.contains("autore: Ada"),
        "le proprietà arrivano: {text}"
    );

    // Lo stesso nonce: un nuovo tentativo non si accoda e non si riscrive,
    // nemmeno se qualcuno lo conferma.
    assert!(host.receive_uri(&raw));
    assert_eq!(pending(&host)["actions"], json!([]));
    assert!(matches!(
        apply(&host, &raw, InvokeMode::DryRun),
        Err(PluginError::Conflict(_))
    ));
    assert!(matches!(
        apply(&host, &raw, InvokeMode::Apply),
        Err(PluginError::Conflict(_))
    ));
    let notes: Vec<String> = std::fs::read_dir(root.join("Clips"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".md"))
        .collect();
    assert_eq!(notes.len(), 1, "una nota sola: {notes:?}");
}

#[test]
fn a_failed_write_does_not_burn_the_nonce() {
    let (_dir, root, host) = vault("Diario");
    let raw = "fub://capture?title=Uno&markdown=x&mode=append&note=manca.md&nonce=n-fallita";
    assert!(
        apply(&host, raw, InvokeMode::Apply).is_err(),
        "la nota non c'è"
    );
    std::fs::write(root.join("manca.md"), "prima\n").unwrap();
    host.wait_indexed(None).unwrap();
    apply(&host, raw, InvokeMode::Apply).expect("riprovata, scrive");
    assert!(std::fs::read_to_string(root.join("manca.md"))
        .unwrap()
        .contains('x'));
}

#[test]
fn too_many_captures_at_once_are_refused_and_counted() {
    let host = Host::without_watcher();
    let cap = fub_host::uri_inbox::CAPTURE_CAPACITY;
    for n in 0..cap {
        assert!(host.receive_uri(&format!("fub://capture?title=T{n}&markdown=x")));
    }
    assert!(!host.receive_uri("fub://capture?title=Oltre&markdown=x"));
    assert!(host.receive_uri("fub://open?note=a.md"), "il resto passa");
    let taken = pending(&host);
    assert_eq!(taken["actions"].as_array().unwrap().len(), cap + 1);
    assert_eq!(taken["refused"], 1);
}

#[test]
fn the_envelope_fields_are_checked_not_trusted() {
    let host = Host::without_watcher();
    for bad in [
        "fub://capture?title=T&markdown=x&v=2",
        "fub://capture?title=T&markdown=x&origin=banca-sicura",
        "fub://capture?title=T&markdown=x&timestamp_ms=0",
        "fub://capture?title=T&markdown=x&properties=%5B1%5D",
        "fub://capture?title=T&markdown=x&nonce=%20",
    ] {
        host.receive_uri(bad);
    }
    let taken = pending(&host);
    for action in taken["actions"].as_array().unwrap() {
        assert!(action["error"].is_string(), "{taken}");
    }
}
