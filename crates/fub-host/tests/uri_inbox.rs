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
