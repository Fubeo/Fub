//! «Annota il PDF» sull'host vero, con la feature `draw`.
//!
//! Il comando `pdf.annotate` è del bundle `fub.draw`, accanto a «Nuovo
//! disegno»: qui si prova che la palette lo trova, che la prima volta le
//! annotazioni nascono accanto al PDF come documento nuovo del provider
//! `fubann` e il vault le legge come annotazioni di quel PDF, che la seconda
//! volta si aprono soltanto, e che il PDF non cambia di un byte in nessun
//! ramo.

#![cfg(feature = "draw")]

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::{FormatProvider, PluginError};
use fub_features::PDF_ANNOTATE;
use fub_format_svg::{FubannProvider, ANNOTATIONS_FORMAT_ID, ANNOTATIONS_KIND};
use fub_host::Host;
use serde_json::json;

/// Un PDF minimo: per il comando conta che ci sia, non che cosa dice.
const PDF: &[u8] = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";

fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (name, bytes) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

fn run(host: &Host, pdf: &str, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(None, PDF_ANNOTATE, json!({ "pdf": pdf }), mode)
}

fn opened(outcome: &CommandOutcome) -> DocId {
    match &outcome.effect {
        CommandEffect::Navigate { doc } => doc.clone(),
        other => panic!("le annotazioni si aprono, non {other:?}"),
    }
}

fn literal(text: &fub_abi::text::Text) -> &str {
    text.as_literal()
        .unwrap_or_else(|| panic!("l'host consegna frasi, non chiavi: {text:?}"))
}

fn bytes(root: &Utf8Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}

const BANDO: &str = "Gare/Bando di gara.pdf";
const NOTE: &str = "Gare/Bando di gara.pdf.fubann";

#[test]
fn the_palette_finds_the_command_and_it_asks_for_a_pdf() {
    let (_dir, _root, host) = vault(&[]);
    let specs = host.commands(None).unwrap();
    let spec = specs
        .iter()
        .find(|spec| spec.id == PDF_ANNOTATE)
        .expect("il comando è montato con la feature `draw`");
    assert_eq!(literal(&spec.title), "Annota il PDF");
    assert_eq!(spec.params.len(), 1);
    assert!(spec.params[0].required);
}

#[test]
fn the_first_time_they_are_born_the_second_they_open_and_the_pdf_stays() {
    let (_dir, root, host) = vault(&[(BANDO, PDF)]);

    let plan = run(&host, BANDO, InvokeMode::DryRun).unwrap();
    match &plan.effect {
        CommandEffect::Plan(plan) => assert_eq!(plan.docs, [DocId::new(NOTE)]),
        other => panic!("una prova a vuoto risponde con un piano, non {other:?}"),
    }
    assert!(bytes(&root, NOTE).is_none());

    let outcome = run(&host, BANDO, InvokeMode::Apply).unwrap();
    let doc = opened(&outcome);
    assert_eq!(doc, DocId::new(NOTE));
    assert_eq!(
        literal(outcome.notify.as_ref().unwrap()),
        format!("Create le annotazioni «{NOTE}»")
    );
    let expected = FubannProvider::new()
        .serialize(&DocumentModel::empty(doc.clone()))
        .unwrap();
    assert_eq!(bytes(&root, NOTE), Some(expected.into_bytes()));

    // Il vault le legge come annotazioni di quel PDF.
    let (_source, _revision, format) = host.read_document_with_format(None, &doc).unwrap();
    assert_eq!(
        format.expect("un formato le serve").descriptor.id,
        ANNOTATIONS_FORMAT_ID
    );
    let model = host.read_model(None, &doc).unwrap();
    let Some(Block::Custom {
        custom_kind, attrs, ..
    }) = model.body.first()
    else {
        panic!("le annotazioni hanno il riepilogo: {:?}", model.body);
    };
    assert_eq!(custom_kind, ANNOTATIONS_KIND);
    // Il riferimento come è scritto, percent-encoded e relativo alla cartella.
    assert_eq!(
        attrs["annotates"],
        json!("Bando%20di%20gara.pdf"),
        "{attrs}"
    );

    // La seconda volta si aprono soltanto: niente da annunciare né da annullare.
    let again = run(&host, BANDO, InvokeMode::Apply).unwrap();
    assert_eq!(opened(&again), doc);
    assert!(again.notify.is_none() && again.undo.is_none());

    assert_eq!(
        bytes(&root, BANDO).as_deref(),
        Some(PDF),
        "il PDF non cambia"
    );
}

#[test]
fn undoing_the_birth_sends_the_annotations_to_the_trash_and_keeps_the_pdf() {
    let (_dir, root, host) = vault(&[(BANDO, PDF)]);
    let outcome = run(&host, BANDO, InvokeMode::Apply).unwrap();
    let undo = outcome.undo.expect("la nascita si annulla");
    for step in undo.steps {
        let UndoStep::Command { command, args } = step else {
            panic!("l'inverso di una creazione è un comando");
        };
        host.invoke_user_command(None, &command, args, InvokeMode::Apply)
            .unwrap();
    }
    assert!(
        bytes(&root, NOTE).is_none(),
        "le annotazioni sono nel cestino"
    );
    assert_eq!(bytes(&root, BANDO).as_deref(), Some(PDF));
    // E rinascono.
    assert_eq!(
        opened(&run(&host, BANDO, InvokeMode::Apply).unwrap()),
        DocId::new(NOTE)
    );
}

#[test]
fn what_is_not_a_pdf_of_the_vault_is_not_annotated() {
    let (_dir, root, host) = vault(&[("Appunti.md", b"# Appunti\n")]);
    for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
        let error = run(&host, "Appunti.md", mode).unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        let error = run(&host, "Manca.pdf", mode).unwrap_err();
        assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
        assert_eq!(
            literal(error.message()),
            "Il PDF «Manca.pdf» non c'è nel vault."
        );
    }
    assert!(bytes(&root, "Appunti.md.fubann").is_none());
    assert!(bytes(&root, "Manca.pdf.fubann").is_none());
}
