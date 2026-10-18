//! «Nuovo disegno» sull'host vero, con la feature `draw`.
//!
//! Il comando `drawing.create` è del bundle `fub.draw` e arriva dall'inventario
//! come gli altri: qui si prova che la palette lo trova, che il nome libero è
//! quello del vault, che il file nato è il documento nuovo del provider dei
//! disegni e che il vault lo legge come un disegno, e che l'annullamento passa
//! dal cestino.

#![cfg(feature = "draw")]

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::{FormatProvider, Locale, PluginError};
use fub_features::DRAWING_CREATE;
use fub_format_svg::{SvgProvider, FORMAT_ID, SUMMARY_KIND};
use fub_host::Host;
use serde_json::json;

/// Un SVG scritto da un altro programma, che il vault legge come disegno.
const ALTRO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">\
<circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>\n";

fn vault(files: &[(&str, &str)], locale: Option<&str>) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (name, text) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let host = Host::without_watcher();
    if let Some(language) = locale {
        host.publish_locale(Locale {
            language: language.to_string(),
            ..Locale::default()
        });
    }
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

fn run(
    host: &Host,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(None, DRAWING_CREATE, args, mode)
}

fn created(outcome: &CommandOutcome) -> DocId {
    match &outcome.effect {
        CommandEffect::Navigate { doc } => doc.clone(),
        other => panic!("un disegno creato si apre, non {other:?}"),
    }
}

fn literal(text: &fub_abi::text::Text) -> &str {
    text.as_literal()
        .unwrap_or_else(|| panic!("l'host consegna frasi, non chiavi: {text:?}"))
}

fn on_disk(root: &Utf8Path, rel: &str) -> Option<String> {
    std::fs::read_to_string(root.join(rel)).ok()
}

#[test]
fn the_palette_finds_the_command_in_the_language_of_the_vault() {
    let (_dir, _root, host) = vault(&[], None);
    let specs = host.commands(None).unwrap();
    let spec = specs
        .iter()
        .find(|spec| spec.id == DRAWING_CREATE)
        .expect("il comando è montato con la feature `draw`");
    assert_eq!(literal(&spec.title), "Nuovo disegno");
    assert!(spec.params.iter().all(|param| !param.required));

    let (_dir, _root, host) = vault(&[], Some("en-US"));
    let specs = host.commands(None).unwrap();
    let spec = specs.iter().find(|spec| spec.id == DRAWING_CREATE).unwrap();
    assert_eq!(literal(&spec.title), "New drawing");
}

#[test]
fn a_new_drawing_is_born_free_opens_and_is_a_drawing() {
    let (_dir, root, host) = vault(&[("Disegno.svg", ALTRO)], None);

    // La prova a vuoto nomina il disegno e non scrive niente.
    let plan = run(&host, json!({}), InvokeMode::DryRun).unwrap();
    match &plan.effect {
        CommandEffect::Plan(plan) => assert_eq!(plan.docs, [DocId::new("Disegno 1.svg")]),
        other => panic!("una prova a vuoto risponde con un piano, non {other:?}"),
    }
    assert!(on_disk(&root, "Disegno 1.svg").is_none());

    let outcome = run(&host, json!({}), InvokeMode::Apply).unwrap();
    let doc = created(&outcome);
    assert_eq!(doc, DocId::new("Disegno 1.svg"));
    assert_eq!(
        literal(outcome.notify.as_ref().unwrap()),
        "Creato il disegno «Disegno 1.svg»"
    );
    assert_eq!(
        on_disk(&root, "Disegno.svg").as_deref(),
        Some(ALTRO),
        "l'altro resta"
    );

    // Il file è il documento nuovo del provider, byte per byte.
    let expected = SvgProvider::new()
        .serialize(&DocumentModel::empty(doc.clone()))
        .unwrap();
    assert_eq!(
        on_disk(&root, doc.as_str()).as_deref(),
        Some(expected.as_str())
    );

    // E il vault lo legge come un disegno di FubDraw, col titolo del nome.
    let (_source, _revision, format) = host.read_document_with_format(None, &doc).unwrap();
    assert_eq!(
        format.expect("un formato lo serve").descriptor.id,
        FORMAT_ID
    );
    let model = host.read_model(None, &doc).unwrap();
    let Some(Block::Custom {
        custom_kind, attrs, ..
    }) = model.body.first()
    else {
        panic!("un disegno ha il riepilogo: {:?}", model.body);
    };
    assert_eq!(custom_kind, SUMMARY_KIND);
    assert_eq!(attrs["version"], json!(1));
    assert_eq!(attrs["foreign"], json!(false));
    assert_eq!(attrs["layers"], json!(["Livello 1"]));
    let title: Vec<&str> = model.outline.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(title, ["Disegno 1"]);

    // Il successivo prende il nome dopo, e la cartella vale per un nome
    // semplice.
    let next = created(&run(&host, json!({}), InvokeMode::Apply).unwrap());
    assert_eq!(next, DocId::new("Disegno 2.svg"));
    let placed = created(
        &run(
            &host,
            json!({ "name": "Ciclo dell'acqua", "folder": "Scienze" }),
            InvokeMode::Apply,
        )
        .unwrap(),
    );
    assert_eq!(placed, DocId::new("Scienze/Ciclo dell'acqua.svg"));
    let model = host.read_model(None, &placed).unwrap();
    assert_eq!(model.outline[0].text, "Ciclo dell'acqua");
}

#[test]
fn a_name_that_is_taken_or_not_a_drawing_writes_nothing() {
    let (_dir, root, host) = vault(&[("Gatto.svg", ALTRO), ("Appunti.md", "# Appunti\n")], None);
    for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
        let error = run(&host, json!({ "name": "Gatto" }), mode).unwrap_err();
        assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
        assert_eq!(
            literal(error.message()),
            "«Gatto.svg» c'è già: un disegno nuovo non prende il posto di un file."
        );

        let error = run(&host, json!({ "name": "Idea.md" }), mode).unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert_eq!(
            literal(error.message()),
            "«Idea.md» non è il nome di un disegno: un disegno è un file `.svg`."
        );

        let error = run(&host, json!({ "name": "Scienze: acqua" }), mode).unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert!(
            literal(error.message()).contains("«:», che un filesystem si riserva"),
            "{error:?}"
        );
    }
    assert_eq!(on_disk(&root, "Gatto.svg").as_deref(), Some(ALTRO));
    assert!(on_disk(&root, "Idea.md").is_none());
    assert!(on_disk(&root, "Idea.md.svg").is_none());
}

#[test]
fn undoing_the_creation_sends_the_drawing_to_the_trash() {
    let (_dir, root, host) = vault(&[], None);
    let outcome = run(&host, json!({ "name": "Gatto" }), InvokeMode::Apply).unwrap();
    let doc = created(&outcome);
    assert!(on_disk(&root, doc.as_str()).is_some());
    let undo = outcome.undo.expect("la creazione si annulla");
    assert_eq!(literal(&undo.label), "la creazione del disegno «Gatto.svg»");
    // I passi come li esegue la shell: comandi del registro, nell'ordine dato.
    for step in undo.steps {
        let UndoStep::Command { command, args } = step else {
            panic!("l'inverso di una creazione è un comando");
        };
        host.invoke_user_command(None, &command, args, InvokeMode::Apply)
            .unwrap();
    }
    assert!(
        on_disk(&root, doc.as_str()).is_none(),
        "il disegno è nel cestino"
    );
    // E il nome torna libero.
    let again = created(&run(&host, json!({ "name": "Gatto" }), InvokeMode::Apply).unwrap());
    assert_eq!(again, doc);
}

#[test]
fn in_english_an_untitled_drawing_is_a_drawing() {
    let (_dir, root, host) = vault(&[], Some("en-GB"));
    let outcome = run(&host, json!({}), InvokeMode::Apply).unwrap();
    let doc = created(&outcome);
    assert_eq!(doc, DocId::new("Drawing.svg"));
    assert_eq!(
        literal(outcome.notify.as_ref().unwrap()),
        "Created the drawing «Drawing.svg»"
    );
    let source = on_disk(&root, doc.as_str()).unwrap();
    assert!(source.contains("<title>Drawing</title>"), "{source}");
}
