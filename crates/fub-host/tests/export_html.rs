//! L'export HTML di una nota sul montaggio vero: la resa di stampa, con le
//! immagini del vault e le note incorporate dentro il file, e nel rapporto
//! ciò che un file statico non può portare.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::transfer::{ArtifactContent, ExportReport, ExportRequest, ExportSelection};
use fub_host::Host;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfinto";

fn export(files: &[(&str, &[u8])], doc: &str) -> ExportReport {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (path, bytes) in files {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let request = ExportRequest::new(
        "importers.html",
        ExportSelection::Documents(vec![DocId::new(doc)]),
    );
    let report = host
        .invoke_job(
            None,
            "fub.importers",
            "import.transfer",
            serde_json::json!({"op": "export", "request": request}),
        )
        .expect("l'export HTML gira");
    serde_json::from_value(report).unwrap()
}

fn page(report: &ExportReport) -> String {
    match &report.artifacts[0].content {
        ArtifactContent::Bytes(bytes) => String::from_utf8(bytes.clone()).unwrap(),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_note_becomes_one_inert_file_with_its_images_and_embeds_inside() {
    let report = export(
        &[
            (
                "note/Viaggio.md",
                "# Viaggio\n\nTesto con **forza**.\n\n![Il lago](img/lago.png)\n\n![[Diario]]\n\n![[Assente]]\n\n![remota](https://esempio.it/x.png)\n"
                    .as_bytes(),
            ),
            ("note/img/lago.png", PNG),
            ("Diario.md", b"Una riga del diario.\n\n![[Viaggio]]\n"),
        ],
        "note/Viaggio.md",
    );
    assert_eq!(report.artifacts.len(), 1);
    assert_eq!(report.artifacts[0].path, "note/Viaggio.html");
    let html = page(&report);
    assert!(html.starts_with("<!doctype html>"), "{html}");
    assert!(html.contains("<title>Viaggio</title>"), "{html}");
    assert!(
        html.contains("default-src 'none'"),
        "il file non carica niente: {html}"
    );
    assert!(html.contains("<strong>forza</strong>"), "{html}");
    assert!(
        html.contains("<img alt=\"Il lago\" src=\"data:image/png;base64,iVBORw0KGgpmaW50bw==\">"),
        "l'immagine del vault entra nel file: {html}"
    );
    assert!(
        html.contains("Una riga del diario."),
        "la nota incorporata entra: {html}"
    );
    assert!(
        html.contains("<a href=\"https://esempio.it/x.png\">"),
        "la remota resta un collegamento: {html}"
    );
    let notes: Vec<&str> = report
        .log
        .iter()
        .map(|note| note.message.as_str())
        .collect();
    assert!(
        notes
            .iter()
            .any(|note| note.contains("`Assente`") && note.contains("non si trova")),
        "{notes:?}"
    );
    assert!(
        notes.iter().any(|note| note.contains("remote")),
        "{notes:?}"
    );
    assert!(
        notes
            .iter()
            .any(|note| note.contains("note/Viaggio.md") && note.contains("giro")),
        "Viaggio dentro Diario dentro Viaggio è un giro: {notes:?}"
    );
}

#[test]
fn a_diagram_is_named_in_the_file_and_in_the_report() {
    let report = export(
        &[(
            "Schema.md",
            b"# Schema\n\n```mermaid\ngraph TD; A-->B;\n```\n",
        )],
        "Schema.md",
    );
    let html = page(&report);
    let notes: Vec<&str> = report
        .log
        .iter()
        .map(|note| note.message.as_str())
        .collect();
    if cfg!(feature = "blocks") {
        assert!(
            html.contains("data-custom-kind=\"diagram\""),
            "il riquadro dice cosa manca: {html}"
        );
        assert!(
            notes
                .iter()
                .any(|note| note.contains("parti interattive (diagram ×1)")),
            "{notes:?}"
        );
    } else {
        // Senza la feature dei blocchi il recinto resta codice, ed è il testo
        // che l'autore ha scritto: niente da dichiarare.
        assert!(html.contains("graph TD;"), "{html}");
    }
}
