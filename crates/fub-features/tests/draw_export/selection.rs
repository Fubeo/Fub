//! La selezione, i nomi e gli errori: solo i disegni, nomi che non si
//! scontrano, destinazioni rifiutate e disegni rotti.

use super::*;

// ---------------------------------------------------------------------------
// La selezione, i nomi, gli errori
// ---------------------------------------------------------------------------

#[test]
fn only_drawings_are_exported_and_names_never_collide() {
    let svg = fixture("scena.svg");
    let host = host()
        .with_document("disegni/mare.svg", &svg)
        .with_document("disegni/Mare.svg", &svg)
        .with_document("note/Pioggia.md", "# Pioggia\n");
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["note/Pioggia.md", "disegni/mare.svg", "disegni/Mare.svg"],
        serde_json::json!({ "scale": 0.25 }),
    )
    .unwrap();
    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    // L'ordine è quello della selezione risolta, cioè dei path.
    assert_eq!(paths, ["disegni/Mare.png", "disegni/mare 1.png"]);
    assert_eq!(
        messages(&report),
        ["1 selected document is not a drawing and was skipped"]
    );
    assert_eq!(report.log[0].level, NoteLevel::Info);

    // In SVG il numero resta del nome del disegno, prima della parola.
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/mare.svg", "disegni/Mare.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "disegni/Mare (exported).svg",
            "disegni/mare 1 (exported).svg"
        ]
    );

    let outcome = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["note/Pioggia.md"],
        serde_json::Value::Null,
    );
    assert!(matches!(outcome, Err(PluginError::BadArgs(_))));
}

#[test]
fn a_target_that_is_not_its_own_is_refused() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PDF),
        (&PdfExport, DRAW_PNG),
        (&PdfExport, "importers.pdf"),
    ] {
        let outcome = export(
            provider,
            &host,
            target,
            &["scena.svg"],
            serde_json::Value::Null,
        );
        assert!(matches!(outcome, Err(PluginError::BadArgs(_))), "{target}");
    }
}

#[test]
fn a_broken_drawing_does_not_stop_the_others() {
    let host = host()
        .with_document(
            "rotto.svg",
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect",
        )
        .with_document("scena.svg", &fixture("scena.svg"));
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        let report = export(
            provider,
            &host,
            target,
            &["rotto.svg", "scena.svg"],
            serde_json::Value::Null,
        )
        .unwrap();
        assert_eq!(report.artifacts.len(), 1);
        assert_eq!(report.log.len(), 1, "{:?}", report.log);
        assert_eq!(report.log[0].level, NoteLevel::Warning);
        assert_eq!(report.log[0].entry.as_deref(), Some("rotto.svg"));
        assert!(report.log[0]
            .message
            .starts_with("not a readable SVG drawing"));

        // Da solo, niente da consegnare: un errore che dice perché.
        let outcome = export(
            provider,
            &host,
            target,
            &["rotto.svg"],
            serde_json::Value::Null,
        );
        let Err(PluginError::BadArgs(text)) = outcome else {
            panic!("{outcome:?}");
        };
        let shown = format!("{text:?}");
        assert!(shown.contains("rotto.svg"), "{shown}");
        assert!(shown.contains("not a readable SVG drawing"), "{shown}");
    }
}
