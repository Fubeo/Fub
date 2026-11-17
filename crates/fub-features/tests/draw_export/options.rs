//! Le opzioni: che cosa (tavole, selezione), con che sfondo, a che misura.

use super::*;

// ---------------------------------------------------------------------------
// Le opzioni: che cosa, con che sfondo, a che misura
// ---------------------------------------------------------------------------

/// Il quaderno con quattro tavole di `fub-format-svg`: «Copertina», «Mappa
/// del porto», una senza titolo che si chiama col suo id, e un'altra
/// «Copertina».
pub(super) fn quaderno() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../fub-format-svg/tests/fixtures/boards.svg");
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Gli artefatti di un export, per path, con i loro byte.
pub(super) fn artifacts(report: &ExportReport) -> Vec<(String, Vec<u8>)> {
    report
        .artifacts
        .iter()
        .map(|a| (a.path.clone(), a.as_bytes().expect("in memoria").to_vec()))
        .collect()
}

fn paths(report: &ExportReport) -> Vec<&str> {
    report.artifacts.iter().map(|a| a.path.as_str()).collect()
}

/// Il JPEG decodificato: misura e pixel RGB.
pub(super) fn decode_jpeg(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
        .expect("un JPEG valido")
        .to_rgb8();
    (image.width(), image.height(), image.into_raw())
}

/// I segmenti di un JPEG fino ai dati dell'immagine: marcatore e contenuto.
pub(super) fn jpeg_segments(bytes: &[u8]) -> Vec<(u8, Vec<u8>)> {
    assert!(bytes.starts_with(&[0xFF, 0xD8]), "SOI");
    let mut segments = Vec::new();
    let mut at = 2;
    loop {
        assert_eq!(bytes[at], 0xFF, "a marker at {at}");
        let marker = bytes[at + 1];
        let length = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        segments.push((marker, bytes[at + 4..at + 2 + length].to_vec()));
        if marker == 0xDA {
            return segments;
        }
        at += 2 + length;
    }
}

/// Un sink che ricorda ciò che si apre: un errore delle opzioni arriva prima
/// di ogni file.
#[derive(Default)]
pub(super) struct Watched {
    inner: MemorySink,
    pub(super) opened: Vec<String>,
}

impl fub_abi::transfer::ArtifactSink for Watched {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<fub_abi::transfer::ArtifactHandle, PluginError> {
        self.opened.push(path.to_string());
        self.inner.open_artifact(path, media_type)
    }

    fn write_artifact(
        &mut self,
        handle: fub_abi::transfer::ArtifactHandle,
        bytes: &[u8],
    ) -> Result<(), PluginError> {
        self.inner.write_artifact(handle, bytes)
    }

    fn close_artifact(
        &mut self,
        handle: fub_abi::transfer::ArtifactHandle,
    ) -> Result<fub_abi::transfer::ExportArtifact, PluginError> {
        self.inner.close_artifact(handle)
    }
}

/// La chiave e gli argomenti dell'errore di un export.
pub(super) fn refusal(outcome: Result<ExportReport, PluginError>) -> (String, Vec<String>) {
    let Err(PluginError::BadArgs(text)) = outcome else {
        panic!("{outcome:?}");
    };
    let message = text.as_message().expect("un messaggio del catalogo");
    (
        message.key.clone(),
        message
            .args
            .iter()
            .map(|arg| arg.value.to_string())
            .collect(),
    )
}

#[test]
fn boards_come_out_one_file_each_in_the_order_of_the_drawing() {
    let host = host().with_document("Scienze/quaderno.svg", &quaderno());
    // L'ordine della richiesta non conta, una ripetizione nemmeno.
    let options = serde_json::json!({
        "scope": "boards",
        "boards": ["b00000004", "b00000001", "b00000003", "b00000001"],
        "scale": 0.5,
    });
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["Scienze/quaderno.svg"],
        options.clone(),
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    // Il nome della tavola fra parentesi; la seconda «Copertina» prende un
    // numero, e la tavola senza titolo si chiama col suo id.
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).png",
            "Scienze/quaderno (b00000003).png",
            "Scienze/quaderno (Copertina 1).png",
        ]
    );
    for (_, bytes) in artifacts(&report) {
        let image = decode(&bytes);
        // 600 × 400 unità a scala 0,5.
        assert_eq!((image.width, image.height), (300, 200));
        assert_eq!(image.per_meter, Some(1890));
    }
    // La prima tavola ha la scritta «Partenza», la terza è solo carta.
    let first = decode(&artifacts(&report)[0].1);
    let dark = |image: &Image| {
        image
            .rgba
            .chunks(4)
            .filter(|px| px[0] < 100 && px[3] == 255)
            .count()
    };
    assert!(dark(&first) > 50);
    assert_eq!(dark(&decode(&artifacts(&report)[1].1)), 0);

    let report = export(
        &JpegExport,
        &host,
        DRAW_JPEG,
        &["Scienze/quaderno.svg"],
        options.clone(),
    )
    .unwrap();
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).jpg",
            "Scienze/quaderno (b00000003).jpg",
            "Scienze/quaderno (Copertina 1).jpg",
        ]
    );
    assert!(report
        .artifacts
        .iter()
        .all(|a| a.media_type == "image/jpeg"));

    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["Scienze/quaderno.svg"],
        options,
    )
    .unwrap();
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).svg",
            "Scienze/quaderno (b00000003).svg",
            "Scienze/quaderno (Copertina 1).svg",
        ]
    );
    // L'SVG di una tavola è la sua derivazione, ripulita: la tela è la
    // tavola, e dei `view` non resta niente.
    let source = quaderno();
    let scope = fub_scene::export::Scope::Board("b00000003".to_string());
    let derived =
        fub_scene::export::derive(&source, &scope, fub_scene::export::Background::Paper).unwrap();
    let expected = fub_scene::export::clean(&derived, &scope).unwrap();
    assert_eq!(
        String::from_utf8(artifacts(&report)[1].1.clone()).unwrap(),
        expected
    );
    assert!(expected.contains(r#"viewBox="0 500 600 400" width="600" height="400""#));
    assert!(!expected.contains("<view"));
    assert!(report
        .artifacts
        .iter()
        .all(|a| a.media_type == "image/svg+xml"));
}

#[test]
fn the_pdf_of_boards_has_a_page_and_a_bookmark_for_each() {
    let host = host().with_document("Scienze/quaderno.svg", &quaderno());
    let options = serde_json::json!({
        "scope": "boards",
        "boards": ["b00000002", "b00000004", "b00000001"],
    });
    let pdf_of_boards = || {
        let report = export(
            &PdfExport,
            &host,
            DRAW_PDF,
            &["Scienze/quaderno.svg"],
            options.clone(),
        )
        .unwrap();
        assert!(report.log.is_empty(), "{:?}", report.log);
        only_artifact(&report)
    };
    let (path, bytes) = pdf_of_boards();
    // Un file solo, col nome del disegno.
    assert_eq!(path, "Scienze/quaderno.pdf");
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // Tre pagine nell'ordine del documento, 600 × 400 unità ciascuna.
    assert!(
        text.contains("/Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3"),
        "{text}"
    );
    assert_eq!(text.matches("/MediaBox [0 0 450 300]").count(), 3);
    // I segnalibri: la radice, poi uno per pagina, col nome della tavola.
    assert!(
        text.contains("/Outlines 10 0 R /PageMode /UseOutlines"),
        "{text}"
    );
    assert!(text.contains("10 0 obj\n<</Type /Outlines /First 11 0 R /Last 13 0 R /Count 3>>"));
    assert!(text.contains(
        "11 0 obj\n<</Title (Copertina) /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /Fit]>>"
    ));
    assert!(text.contains(
        "12 0 obj\n<</Title (Mappa del porto) /Parent 10 0 R /Prev 11 0 R /Next 13 0 R /Dest [5 0 R /Fit]>>"
    ));
    assert!(text.contains(
        "13 0 obj\n<</Title (Copertina) /Parent 10 0 R /Prev 12 0 R /Dest [7 0 R /Fit]>>"
    ));
    assert!(text.contains("/Info 9 0 R /Root 1 0 R"));
    // Le tre tavole sono lo stesso disegno: il carattere si scrive una volta.
    assert_eq!(text.matches("/FontFile2").count(), 1, "{text}");
    // E lo stesso export dà gli stessi byte, anche con più pagine.
    for _ in 0..4 {
        assert_eq!(pdf_of_boards().1, bytes);
    }

    // Una tavola sola: il suo nome nel file.
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["Scienze/quaderno.svg"],
        serde_json::json!({"scope": "boards", "boards": ["b00000002"]}),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Scienze/quaderno (Mappa del porto).pdf");
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("/Count 1"));
    assert!(text.contains("/Title (Mappa del porto) /Parent 6 0 R /Dest [3 0 R /Fit]"));
}

#[test]
fn the_selection_is_cut_to_its_box_and_named_with_the_suffix() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    // L'ellisse col suo contorno: 50 × 25 di raggio intorno a (80, 60), più 2.
    let selection = serde_json::json!({"ids": ["o1a2b3c4d"], "box": [28, 33, 104, 54]});
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/scena.svg"],
        serde_json::json!({
            "scope": "selection",
            "selection": selection,
            "suffix": "selezione",
            "scale": 1,
        }),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena (selezione).png");
    let image = decode(&bytes);
    assert_eq!((image.width, image.height), (104, 54));
    let at = |x: u32, y: u32| {
        let i = ((y * image.width + x) * 4) as usize;
        image.rgba[i..i + 4].to_vec()
    };
    // Nel mezzo dell'ellisse, senza riempimento, c'era il cielo: con la
    // selezione resta la carta.
    assert_eq!(at(52, 27), [255, 255, 255, 255]);
    // Il contorno dell'ellisse c'è: il blu a sinistra, sul suo asse.
    let edge = at(2, 27);
    assert!(edge[2] > 150 && edge[0] < 60, "{edge:?}");

    // Senza `suffix`, la parola di serie.
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/scena.svg"],
        serde_json::json!({"scope": "selection", "selection": selection}),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena (selection).pdf");
    let text = String::from_utf8_lossy(&bytes);
    // 104 × 54 unità sono 78 × 40,5 punti; nessun segnalibro.
    assert!(text.contains("/MediaBox [0 0 78 40.5]"), "{text}");
    assert!(!text.contains("/Outlines"));
}
