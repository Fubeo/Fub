//! La cattura è un comando solo, e i trasporti lo chiamano: questi sono i casi
//! in cui le quattro copie divergevano, o sbagliavano tutte e quattro.
//!
//! L'host è quello vero, con i formati e le feature ufficiali: il nome della
//! nota lo decide `note.create`, le proprietà `note.property.set`, e il
//! formato della destinazione le capacità del provider.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_host::automation::{CaptureMode, CapturePayloadV1, CaptureTarget};
use fub_host::capture::{self, NewNote, CAPTURE_APPLY};
use fub_host::Host;

const URL: &str = "https://example.com/articolo";

fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (name, text) in files {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

fn payload(mode: CaptureMode, note: Option<&str>) -> CapturePayloadV1 {
    CapturePayloadV1 {
        v: 1,
        title: "Articolo: Rust/async".to_string(),
        markdown: "Il testo.\n".to_string(),
        source_url: Some(URL.to_string()),
        properties: None,
        target: CaptureTarget {
            vault: None,
            folder: None,
            note: note.map(str::to_string),
            mode,
        },
    }
}

fn read(root: &Utf8Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

/// Il blocco atteso, con la riga della fonte nella lingua del vault: si
/// controlla che sia una frase e non la chiave nuda.
fn chunk_of(text: &str) -> &str {
    let at = text
        .find("# Articolo: Rust/async")
        .unwrap_or_else(|| panic!("nessun titolo in {text:?}"));
    &text[at..]
}

fn assert_chunk(chunk: &str, eol: &str) {
    let expected_head = format!("# Articolo: Rust/async{eol}{eol}Il testo.{eol}{eol}");
    assert!(chunk.starts_with(&expected_head), "{chunk:?}");
    let source = &chunk[expected_head.len()..];
    let line = source.split(eol).next().unwrap();
    assert!(line.ends_with(URL), "{source:?}");
    assert!(!line.contains("host.capture"), "la chiave nuda: {line:?}");
    assert!(line.len() > URL.len(), "la fonte ha un'etichetta: {line:?}");
}

#[test]
fn a_title_names_the_new_note_in_one_portable_segment() {
    let (_dir, root, host) = vault(&[]);
    let doc = capture::apply(&host, None, &payload(CaptureMode::Create, None), None)
        .expect("la cattura crea la nota");
    assert_eq!(doc, DocId::new("Articolo Rust async.md"));
    let text = read(&root, doc.as_str());
    assert!(text.starts_with("# Articolo: Rust/async"), "{text:?}");
    assert_chunk(chunk_of(&text), "\n");

    // Un punto nel titolo non è un'estensione: la nota resta Markdown.
    let mut dotted = payload(CaptureMode::Create, None);
    dotted.title = "Report v1.2".to_string();
    let doc = capture::apply(&host, None, &dotted, None).expect("il punto è del nome");
    assert_eq!(doc, DocId::new("Report v1.2.md"));

    // Lo stesso nome una seconda volta è un conflitto, mai una sovrascrittura.
    let again = capture::apply(&host, None, &payload(CaptureMode::Create, None), None);
    assert!(
        matches!(again, Err(PluginError::AlreadyExists(_))),
        "{again:?}"
    );
}

#[test]
fn the_folder_and_the_properties_are_born_with_the_note() {
    let (_dir, root, host) = vault(&[]);
    let mut clip = payload(CaptureMode::Create, None);
    clip.target.folder = Some("Clips".to_string());
    clip.properties = Some(
        serde_json::json!({ "fonte": "web", "voto": 5 })
            .as_object()
            .unwrap()
            .clone(),
    );
    let doc = capture::apply(&host, None, &clip, None).unwrap();
    assert_eq!(doc, DocId::new("Clips/Articolo Rust async.md"));
    let text = read(&root, doc.as_str());
    assert!(text.starts_with("---\n"), "{text:?}");
    assert!(
        text.contains("\n---\n\n# Articolo: Rust/async\n"),
        "{text:?}"
    );
    let model = host.read_model(None, &doc).unwrap();
    assert_eq!(model.frontmatter.0["fonte"], "web");
    assert_eq!(model.frontmatter.0["voto"], 5);
}

#[test]
fn append_keeps_one_blank_line_and_the_line_endings() {
    let (_dir, root, host) = vault(&[("Nota.md", "# Nota\r\n\r\ntesto\r\n")]);
    capture::apply(
        &host,
        None,
        &payload(CaptureMode::Append, Some("Nota.md")),
        None,
    )
    .unwrap();
    let text = read(&root, "Nota.md");
    assert!(
        text.starts_with("# Nota\r\n\r\ntesto\r\n\r\n# Articolo"),
        "{text:?}"
    );
    assert!(!text.replace("\r\n", "").contains('\n'), "{text:?}");
    assert_chunk(chunk_of(&text), "\r\n");
}

#[test]
fn prepend_writes_after_the_frontmatter() {
    let (_dir, root, host) = vault(&[("Nota.md", "---\ntag: x\n---\n\n# Nota\n")]);
    capture::apply(
        &host,
        None,
        &payload(CaptureMode::Prepend, Some("Nota.md")),
        None,
    )
    .unwrap();
    let text = read(&root, "Nota.md");
    assert!(
        text.starts_with("---\ntag: x\n---\n\n# Articolo: Rust/async\n"),
        "{text:?}"
    );
    assert!(text.ends_with("\n\n# Nota\n"), "{text:?}");
    let model = host.read_model(None, &DocId::new("Nota.md")).unwrap();
    assert_eq!(
        model.frontmatter.0["tag"], "x",
        "il frontmatter resta un frontmatter"
    );
}

#[test]
fn a_capture_never_writes_into_a_canvas() {
    let board = r#"{"nodes":[],"edges":[]}"#;
    let (_dir, root, host) = vault(&[("board.canvas", board)]);
    let appended = capture::apply(
        &host,
        None,
        &payload(CaptureMode::Append, Some("board.canvas")),
        None,
    );
    assert!(
        matches!(appended, Err(PluginError::BadArgs(_))),
        "{appended:?}"
    );
    assert_eq!(read(&root, "board.canvas"), board);

    let created = capture::apply(
        &host,
        None,
        &payload(CaptureMode::Create, Some("Lavagna.canvas")),
        None,
    );
    assert!(
        matches!(created, Err(PluginError::BadArgs(_))),
        "{created:?}"
    );
    assert!(!root.join("Lavagna.canvas").exists(), "niente nasce");
}

#[test]
fn a_failed_property_leaves_no_text_to_duplicate_on_retry() {
    let (_dir, root, host) = vault(&[("Nota.md", "# Nota\n")]);
    host.invoke_user_command(
        None,
        "property.type.set",
        serde_json::json!({ "key": "voto", "type": "number" }),
        InvokeMode::Apply,
    )
    .unwrap();
    let mut clip = payload(CaptureMode::Append, Some("Nota.md"));
    clip.properties = Some(
        serde_json::json!({ "voto": "alto" })
            .as_object()
            .unwrap()
            .clone(),
    );
    for _ in 0..2 {
        let refused = capture::apply(&host, None, &clip, None);
        assert!(refused.is_err(), "il tipo dichiarato rifiuta «alto»");
        assert_eq!(read(&root, "Nota.md"), "# Nota\n", "niente testo a metà");
    }
    clip.properties = Some(
        serde_json::json!({ "voto": 4 })
            .as_object()
            .unwrap()
            .clone(),
    );
    capture::apply(&host, None, &clip, None).unwrap();
    let text = read(&root, "Nota.md");
    assert_eq!(text.matches("# Articolo").count(), 1, "{text:?}");
}

#[test]
fn a_note_born_from_a_template_goes_back_to_the_trash_when_the_capture_fails() {
    let (_dir, root, host) = vault(&[("Modelli/Clip.md", "# {{title}}\n")]);
    host.invoke_user_command(
        None,
        "property.type.set",
        serde_json::json!({ "key": "voto", "type": "number" }),
        InvokeMode::Apply,
    )
    .unwrap();
    let mut clip = payload(CaptureMode::Create, None);
    clip.properties = Some(
        serde_json::json!({ "voto": "alto" })
            .as_object()
            .unwrap()
            .clone(),
    );
    let refused = capture::apply(&host, None, &clip, Some("Modelli/Clip.md"));
    assert!(refused.is_err());
    assert!(
        !root.join("Articolo Rust async.md").exists(),
        "la nota nata dalla cattura è tornata nel cestino"
    );

    // Il template vale soltanto per una cattura che crea.
    let daily = capture::apply(
        &host,
        None,
        &payload(CaptureMode::Daily, None),
        Some("Modelli/Clip.md"),
    );
    assert!(matches!(daily, Err(PluginError::BadArgs(_))), "{daily:?}");
}

#[test]
fn daily_appends_to_the_note_of_the_day() {
    let (_dir, root, host) = vault(&[]);
    let first = capture::apply(&host, None, &payload(CaptureMode::Daily, None), None).unwrap();
    let second = capture::apply(&host, None, &payload(CaptureMode::Daily, None), None).unwrap();
    assert_eq!(first, second, "la stessa nota del giorno");
    let text = read(&root, first.as_str());
    assert_eq!(text.matches("# Articolo").count(), 2, "{text:?}");
    assert!(!text.contains("\n\n\n"), "una riga vuota sola: {text:?}");
}

#[test]
fn a_vault_named_by_the_payload_is_validated_first() {
    let (_dir, _root, host) = vault(&[]);
    let mut clip = payload(CaptureMode::Create, None);
    clip.target.vault = Some("../fuori".to_string());
    let refused = capture::apply(&host, None, &clip, None);
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
}

#[test]
fn the_command_plans_without_writing_and_applies_through_the_registry() {
    let (_dir, root, host) = vault(&[]);
    let listed = host.commands(None).unwrap();
    assert!(listed.iter().any(|spec| spec.id == CAPTURE_APPLY));
    let args = serde_json::json!({
        "payload_json": serde_json::to_string(&payload(CaptureMode::Create, None)).unwrap(),
    });
    let planned = host
        .invoke_user_command(None, CAPTURE_APPLY, args.clone(), InvokeMode::DryRun)
        .unwrap();
    match planned.effect {
        CommandEffect::Plan(plan) => {
            assert_eq!(plan.docs, vec![DocId::new("Articolo Rust async.md")]);
        }
        other => panic!("un piano, non {other:?}"),
    }
    assert!(!root.join("Articolo Rust async.md").exists());

    let done = host
        .invoke_user_command(None, CAPTURE_APPLY, args, InvokeMode::Apply)
        .unwrap();
    assert!(matches!(
        done.effect,
        CommandEffect::Navigate { ref doc } if doc.as_str() == "Articolo Rust async.md"
    ));
    let bad = host.invoke_user_command(
        None,
        CAPTURE_APPLY,
        serde_json::json!({ "payload_json": "{\"v\":1}" }),
        InvokeMode::Apply,
    );
    assert!(matches!(bad, Err(PluginError::BadArgs(_))), "{bad:?}");
}

#[test]
fn a_new_note_takes_its_name_and_its_title_by_the_capture_rules() {
    let (_dir, root, host) = vault(&[("Modelli/Diario.md", "---\ntipo: diario\n---\n\nOggi.\n")]);
    let titled = NewNote {
        title: Some("Idee: marzo"),
        ..NewNote::default()
    };
    let planned = capture::new_note(&host, None, &titled, InvokeMode::DryRun).unwrap();
    assert_eq!(planned, DocId::new("Idee marzo.md"));
    assert!(!root.join("Idee marzo.md").exists(), "il piano non scrive");
    let doc = capture::new_note(&host, None, &titled, InvokeMode::Apply).unwrap();
    assert_eq!(doc, planned);
    assert_eq!(read(&root, doc.as_str()), "# Idee: marzo\n");

    // Dal template il titolo va dove comincia il corpo: il frontmatter resta
    // la prima cosa del file.
    let from_template = NewNote {
        folder: Some("Diario"),
        name: Some("Lunedì"),
        title: Some("Lunedì"),
        template: Some("Modelli/Diario.md"),
    };
    let doc = capture::new_note(&host, None, &from_template, InvokeMode::Apply).unwrap();
    assert_eq!(doc, DocId::new("Diario/Lunedì.md"));
    let text = read(&root, doc.as_str());
    assert!(text.starts_with("---\n"), "{text:?}");
    assert!(text.ends_with("\n---\n\n# Lunedì\n\nOggi.\n"), "{text:?}");
    let model = host.read_model(None, &doc).unwrap();
    assert_eq!(model.frontmatter.0["tipo"], "diario");

    // Senza nome né titolo il nome è quello di `note.create`, non una copia.
    let expected = match host
        .invoke_user_command(
            None,
            "note.create",
            serde_json::json!({}),
            InvokeMode::DryRun,
        )
        .unwrap()
        .effect
    {
        CommandEffect::Plan(plan) => plan.docs[0].clone(),
        other => panic!("un piano, non {other:?}"),
    };
    let bare = capture::new_note(&host, None, &NewNote::default(), InvokeMode::Apply).unwrap();
    assert_eq!(bare, expected);
    assert_eq!(read(&root, bare.as_str()), "");

    // Un titolo non entra in un canvas, e il canvas non nasce.
    let canvas = NewNote {
        name: Some("Lavagna.canvas"),
        title: Some("Lavagna"),
        ..NewNote::default()
    };
    let refused = capture::new_note(&host, None, &canvas, InvokeMode::Apply);
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
    assert!(!root.join("Lavagna.canvas").exists());

    // Un titolo su più righe non diventa più righe del documento.
    let injected = NewNote {
        title: Some("A\n---\nB"),
        ..NewNote::default()
    };
    let refused = capture::new_note(&host, None, &injected, InvokeMode::DryRun);
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
}
