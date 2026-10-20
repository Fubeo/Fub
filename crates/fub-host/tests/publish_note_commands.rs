//! I gesti di pubblicazione sulla nota aperta, sull'host vero: «Pubblica
//! questa nota» la segna con `publish: true` e mette in coda la prova, mai la
//! pubblicazione; l'indirizzo pubblico si copia e si apre soltanto per una
//! nota che il sito servirebbe.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::PluginError;
use fub_host::publish::commands::{PUBLISH_NOTE, PUBLISH_NOTE_COPY_URL, PUBLISH_NOTE_OPEN};
use fub_host::Host;
use serde_json::json;

fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).unwrap();
    std::fs::create_dir(&root).unwrap();
    for (name, text) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    host.set_setting_for_user(
        None,
        "publish.server_url",
        SettingValue::Text("https://pub.example.org/".into()),
    )
    .expect("il server si imposta");
    (dir, host)
}

fn run(host: &Host, command: &str, doc: &str) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(
        None,
        command,
        json!({ "doc": doc, "site": "blog" }),
        InvokeMode::Apply,
    )
}

fn custom(outcome: &CommandOutcome) -> (String, serde_json::Value) {
    match &outcome.effect {
        CommandEffect::Custom { ns, payload } => (ns.clone(), payload.clone()),
        other => panic!("l'esito chiede qualcosa alla shell: {other:?}"),
    }
}

#[test]
fn the_public_address_is_copied_and_opened_only_for_a_public_note() {
    let (_dir, host) = vault(&[
        (
            "Diario/Una pagina.md",
            "---\npublish: true\n---\n# Pubblica\n",
        ),
        ("segreta.md", "---\npublish: true\nprivate: true\n---\n"),
        ("bozza.md", "# Nessun publish\n"),
    ]);
    let copied = run(&host, PUBLISH_NOTE_COPY_URL, "Diario/Una pagina.md").unwrap();
    assert_eq!(
        custom(&copied),
        (
            fub_abi::ui::CLIPBOARD_TEXT_NS.to_string(),
            json!({ "text": "https://pub.example.org/s/blog/diario/una-pagina.html" })
        )
    );
    // Il sito non è mai andato online: l'avviso lo dice.
    assert!(format!("{:?}", copied.notify).contains("non è ancora online"));
    let opened = run(&host, PUBLISH_NOTE_OPEN, "Diario/Una pagina.md").unwrap();
    assert_eq!(
        custom(&opened),
        (
            fub_abi::ui::WEB_OPEN_NS.to_string(),
            json!({ "url": "https://pub.example.org/s/blog/diario/una-pagina.html" })
        )
    );
    for doc in ["segreta.md", "bozza.md"] {
        let error = run(&host, PUBLISH_NOTE_COPY_URL, doc).unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{doc}: {error:?}");
    }
}

#[test]
fn publishing_this_note_marks_it_and_queues_only_the_dry_run() {
    let (_dir, host) = vault(&[
        ("bozza.md", "# Da pubblicare\n"),
        ("segreta.md", "---\ndraft: true\n---\n"),
    ]);
    let doc = DocId::new("bozza.md");
    let planned = host
        .invoke_user_command(
            None,
            PUBLISH_NOTE,
            json!({ "doc": "bozza.md", "site": "blog" }),
            InvokeMode::DryRun,
        )
        .unwrap();
    assert!(planned.notify.is_some());
    assert!(!host
        .read_document(None, &doc)
        .unwrap()
        .0
        .contains("publish"));

    let outcome = run(&host, PUBLISH_NOTE, "bozza.md").unwrap();
    assert!(format!("{:?}", outcome.notify).contains("Nota segnata per blog"));
    assert!(outcome.undo.is_some(), "la proprietà scritta si annulla");
    let (text, _) = host.read_document(None, &doc).unwrap();
    assert!(text.contains("publish: true"), "{text}");
    host.wait_indexed(None).unwrap();
    // Ora è pubblica: l'indirizzo c'è.
    assert!(run(&host, PUBLISH_NOTE_COPY_URL, "bozza.md").is_ok());

    // Una bozza dichiarata non si segna: resta fuori, e il file non cambia.
    let error = run(&host, PUBLISH_NOTE, "segreta.md").unwrap_err();
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(
        host.read_document(None, &DocId::new("segreta.md"))
            .unwrap()
            .0,
        "---\ndraft: true\n---\n"
    );
}

#[test]
fn without_a_site_the_note_commands_say_where_to_choose_one() {
    let (_dir, host) = vault(&[("pub.md", "---\npublish: true\n---\n")]);
    let error = host
        .invoke_user_command(
            None,
            PUBLISH_NOTE_COPY_URL,
            json!({ "doc": "pub.md" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
    assert!(
        format!("{error:?}").contains("Nessun sito scelto"),
        "{error:?}"
    );
}
