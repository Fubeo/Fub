//! La pagina di stampa: carta, rifilatura, abbondanza e segni, letti da
//! due lettori di PDF.

use super::*;

// ---------------------------------------------------------------------------
// La pagina di stampa
// ---------------------------------------------------------------------------

/// Punti per millimetro.
const PT_PER_MM: f64 = 72.0 / 25.4;

/// Il PDF di `doc` con le opzioni `options`, come testo, e le note del log.
fn printed(host: &MemoryHost, doc: &str, options: serde_json::Value) -> (String, Vec<String>) {
    let report = export(&PdfExport, host, DRAW_PDF, &[doc], options).unwrap();
    let text = String::from_utf8_lossy(&only_artifact(&report).1).into_owned();
    (text, messages(&report))
}

/// I numeri dell'array dopo la prima `key` di `pdf`, o di ognuna.
fn arrays(pdf: &str, key: &str) -> Vec<Vec<f64>> {
    pdf.match_indices(key)
        .map(|(at, _)| {
            let rest = &pdf[at + key.len()..];
            let rest = rest.trim_start().strip_prefix('[').expect("un array");
            rest[..rest.find(']').unwrap()]
                .split_whitespace()
                .map(|n| n.parse().unwrap())
                .collect()
        })
        .collect()
}

fn array(pdf: &str, key: &str) -> Vec<f64> {
    arrays(pdf, key)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("{key}: {pdf}"))
}

/// Vero se `got` e `want` sono gli stessi numeri a meno di quanto un PDF
/// arrotonda, quattro decimali.
fn same_numbers(got: &[f64], want: &[f64]) -> bool {
    got.len() == want.len() && got.iter().zip(want).all(|(a, b)| (a - b).abs() < 2e-4)
}

/// I numeri del contenuto della prima pagina di `pdf` prima dell'operatore
/// `operator` (`cm`), ogni volta che compare.
fn operands(pdf: &str, operator: &str) -> Vec<Vec<f64>> {
    let content = &pdf[pdf.find("stream\nq ").expect("il contenuto") + 7..];
    let content = &content[..content.find("endstream").unwrap()];
    let mut found = Vec::new();
    let mut numbers = Vec::new();
    for token in content.split_whitespace() {
        match token.parse::<f64>() {
            Ok(n) => numbers.push(n),
            Err(_) if token == operator => found.push(std::mem::take(&mut numbers)),
            Err(_) => numbers.clear(),
        }
    }
    found
}

#[test]
fn a_print_page_has_its_paper_trim_bleed_and_marks() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let (pdf, log) = printed(
        &host,
        "scena.svg",
        serde_json::json!({"paper": "a4", "bleed": 3, "marks": ["crop", "registration"]}),
    );
    assert!(log.is_empty(), "{log:?}");
    // 400 × 250 è più largo che alto: l'A4 si gira, e il disegno, 300 ×
    // 187,5 punti, ci sta alla sua misura, al centro.
    let (width, height) = (297.0 * PT_PER_MM, 210.0 * PT_PER_MM);
    assert!(
        same_numbers(&array(&pdf, "/MediaBox"), &[0.0, 0.0, width, height]),
        "{pdf}"
    );
    let (left, bottom) = ((width - 300.0) / 2.0, (height - 187.5) / 2.0);
    let trim = [left, bottom, left + 300.0, bottom + 187.5];
    assert!(same_numbers(&array(&pdf, "/TrimBox"), &trim), "{pdf}");
    let bleed = 3.0 * PT_PER_MM;
    let bled = [
        trim[0] - bleed,
        trim[1] - bleed,
        trim[2] + bleed,
        trim[3] + bleed,
    ];
    assert!(same_numbers(&array(&pdf, "/BleedBox"), &bled), "{pdf}");
    // Il disegno ha l'abbondanza intorno, 3 mm per lato oltre la rifilatura:
    // la pagina derivata è di 422,68 × 272,68 pixel.
    let drawn = operands(&pdf, "cm");
    let (w, h) = (422.68 * 0.75, 272.68 * 0.75);
    let (x, y) = (left - (w - 300.0) / 2.0, bottom - (h - 187.5) / 2.0);
    assert!(
        same_numbers(&drawn[0], &[w, 0.0, 0.0, h, x, y]),
        "{drawn:?}"
    );
    // La stampa non adatta la carta, e il cassetto si sceglie dalla misura.
    assert!(pdf.contains(
        "/ViewerPreferences <</DisplayDocTitle true /PickTrayByPDFSize true /PrintScaling /None>>"
    ));
    // I segni nel colore di registro, sottili un quarto di punto: due di
    // taglio per angolo, un cerchio con la croce a metà di ogni lato.
    assert!(pdf.contains(
        "/ColorSpace <</R [/Separation /All /DeviceCMYK <</C0 [0 0 0 0] /C1 [1 1 1 1] /Domain [0 1] /FunctionType 2 /N 1>>]>>"
    ), "{pdf}");
    assert!(pdf.contains("\nq /R CS 1 SCN 0.25 w\n"), "{pdf}");
    assert_eq!(operands(&pdf, "S").len(), 8 + 8 + 4);
    assert_eq!(operands(&pdf, "c").len(), 4 * 4);
    // Il primo segno di taglio: in alto a sinistra, orizzontale, da 3 mm
    // oltre l'abbondanza per 5 mm verso il bordo.
    let near = bleed + 3.0 * PT_PER_MM;
    let top = height - bottom;
    let first = [left - near, top, left - near - 5.0 * PT_PER_MM, top];
    let moves = operands(&pdf, "m");
    let lines = operands(&pdf, "l");
    assert!(same_numbers(&moves[0], &first[..2]), "{moves:?}");
    assert!(same_numbers(&lines[0], &first[2..]), "{lines:?}");
}

#[test]
fn the_fitted_paper_grows_by_the_bleed_and_the_marks() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let (pdf, _) = printed(
        &host,
        "scena.svg",
        serde_json::json!({"bleed": 3, "marks": ["crop"]}),
    );
    // La carta su misura: la rifilatura, più 3 mm di abbondanza e 8 di
    // segni per lato.
    let edge = 11.0 * PT_PER_MM;
    let media = [0.0, 0.0, 300.0 + 2.0 * edge, 187.5 + 2.0 * edge];
    assert!(same_numbers(&array(&pdf, "/MediaBox"), &media), "{pdf}");
    let trim = [edge, edge, edge + 300.0, edge + 187.5];
    assert!(same_numbers(&array(&pdf, "/TrimBox"), &trim), "{pdf}");
    // Soltanto i segni di taglio: otto linee, nessun cerchio.
    assert_eq!(operands(&pdf, "S").len(), 8);
    assert!(operands(&pdf, "c").is_empty());
    // Senza segni né carta, l'abbondanza è tutta la pagina in più.
    let (pdf, _) = printed(&host, "scena.svg", serde_json::json!({"bleed": 3}));
    let bleed = 3.0 * PT_PER_MM;
    let media = [0.0, 0.0, 300.0 + 2.0 * bleed, 187.5 + 2.0 * bleed];
    assert!(same_numbers(&array(&pdf, "/MediaBox"), &media), "{pdf}");
    assert!(same_numbers(&array(&pdf, "/BleedBox"), &media), "{pdf}");
    assert!(!pdf.contains("/Separation"));
}

#[test]
fn a_drawing_that_does_not_fit_shrinks_and_keeps_the_bleed_on_the_paper() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let (pdf, _) = printed(
        &host,
        "scena.svg",
        serde_json::json!({"paper": [80, 100], "margin": 5, "bleed": 2}),
    );
    // Fra i margini di 100 × 80 mm restano 86 × 66 mm: la larghezza manda,
    // e il disegno si riduce a 86 mm.
    let trim = array(&pdf, "/TrimBox");
    let trim_width = 86.0 * PT_PER_MM;
    assert!(((trim[2] - trim[0]) - trim_width).abs() < 2e-4, "{trim:?}");
    let scale = trim_width / 300.0;
    assert!(
        ((trim[3] - trim[1]) - 187.5 * scale).abs() < 2e-4,
        "{trim:?}"
    );
    // L'abbondanza resta di 2 mm sulla carta: la derivazione l'ha chiesta
    // più larga, divisa per la scala.
    let bled = array(&pdf, "/BleedBox");
    assert!(
        ((trim[0] - bled[0]) - 2.0 * PT_PER_MM).abs() < 2e-4,
        "{bled:?}"
    );
    let drawn = operands(&pdf, "cm");
    assert!(
        ((trim[0] - drawn[0][4]) - 2.0 * PT_PER_MM).abs() < 0.01,
        "{drawn:?}"
    );
    // «Adatta alla pagina» la ingrandisce fino ai margini.
    let (pdf, _) = printed(
        &host,
        "scena.svg",
        serde_json::json!({"paper": "a3", "fit": "page", "orientation": "portrait"}),
    );
    let trim = array(&pdf, "/TrimBox");
    assert!(
        ((trim[2] - trim[0]) - 277.0 * PT_PER_MM).abs() < 2e-4,
        "{trim:?}"
    );
    assert!(same_numbers(
        &array(&pdf, "/MediaBox")[2..],
        &[297.0 * PT_PER_MM, 420.0 * PT_PER_MM]
    ));
}

#[test]
fn every_board_gets_its_print_page() {
    let host = host().with_document("Scienze/quaderno.svg", &quaderno());
    let (pdf, _) = printed(
        &host,
        "Scienze/quaderno.svg",
        serde_json::json!({"scope": "boards", "boards": ["b00000001", "b00000002"], "bleed": 3}),
    );
    let bleed = 3.0 * PT_PER_MM;
    let media = [0.0, 0.0, 450.0 + 2.0 * bleed, 300.0 + 2.0 * bleed];
    let trim = [bleed, bleed, bleed + 450.0, bleed + 300.0];
    assert_eq!(arrays(&pdf, "/MediaBox").len(), 2);
    for found in arrays(&pdf, "/MediaBox") {
        assert!(same_numbers(&found, &media), "{found:?}");
    }
    for found in arrays(&pdf, "/TrimBox") {
        assert!(same_numbers(&found, &trim), "{found:?}");
    }
}

#[test]
fn the_default_print_options_give_the_file_of_always() {
    let host = host()
        .with_document("scena.svg", &fixture("scena.svg"))
        .with_document("Scienze/quaderno.svg", &quaderno());
    let plain = pdf_of(&host, "scena.svg");
    let defaults = serde_json::json!({
        "paper": "fit",
        "bleed": 0,
        "marks": [],
        "orientation": "landscape",
        "margin": 30,
        "fit": "page",
    });
    let report = export(&PdfExport, &host, DRAW_PDF, &["scena.svg"], defaults).unwrap();
    assert_eq!(only_artifact(&report).1, plain);
    let text = String::from_utf8_lossy(&plain);
    assert!(!text.contains("/TrimBox") && !text.contains("/PrintScaling"));
    // Anche con le tavole.
    let boards = serde_json::json!({"scope": "boards", "boards": ["b00000003"]});
    let before = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["Scienze/quaderno.svg"],
        boards.clone(),
    );
    let mut with_defaults = boards;
    with_defaults["bleed"] = serde_json::json!(0);
    let after = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["Scienze/quaderno.svg"],
        with_defaults,
    );
    assert_eq!(
        only_artifact(&before.unwrap()).1,
        only_artifact(&after.unwrap()).1
    );
}

#[test]
fn a_drawing_without_a_size_of_its_own_has_no_bleed_and_says_so() {
    let bare = r##"<svg xmlns="http://www.w3.org/2000/svg"><rect width="60" height="40" fill="#0072b2"/></svg>"##;
    let host = host().with_document("nudo.svg", bare);
    let (pdf, log) = printed(&host, "nudo.svg", serde_json::json!({"bleed": 3}));
    assert_eq!(
        log,
        ["the drawing has neither a viewBox nor a width and height, so its PDF has no bleed"]
    );
    // Senza abbondanza né segni, la pagina è quella di sempre, grande quanto
    // ciò che `usvg` disegna.
    assert!(!pdf.contains("/TrimBox"), "{pdf}");
    assert!(
        same_numbers(&array(&pdf, "/MediaBox"), &[0.0, 0.0, 45.0, 30.0]),
        "{pdf}"
    );
}

/// Due lettori di PDF che non sono il nostro, `lopdf` per i riquadri e
/// `hayro` per i pixel, trovano la carta, la rifilatura, l'abbondanza e i
/// segni al decimo di millimetro.
#[test]
fn two_pdf_readers_find_paper_trim_bleed_and_marks_to_a_tenth_of_a_millimetre() {
    // Una carta gialla di 400 × 300 con una striscia rossa da 100 a 300.
    let drawing = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" viewBox="0 0 400 300" width="400" height="300"><rect fub:role="paper" width="400" height="300" fill="#ffff00"/><rect x="100" width="200" height="300" fill="#ff0000"/></svg>"##;
    let host = host().with_document("striscia.svg", drawing);
    let options = serde_json::json!({"paper": "a4", "bleed": 3, "marks": ["crop"]});
    let report = export(&PdfExport, &host, DRAW_PDF, &["striscia.svg"], options).unwrap();
    let bytes = only_artifact(&report).1;
    // L'A4 girato, e il disegno, 105,83 × 79,375 mm, al centro.
    let (left, top) = (
        (297.0 - 400.0 * 25.4 / 96.0) / 2.0,
        (210.0 - 300.0 * 25.4 / 96.0) / 2.0,
    );
    let (right, bottom) = (297.0 - left, 210.0 - top);

    let doc = lopdf::Document::load_mem(&bytes).unwrap();
    let page = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
    let millimetres = |key: &[u8]| -> Vec<f64> {
        page.get(key)
            .and_then(lopdf::Object::as_array)
            .unwrap()
            .iter()
            .map(|n| f64::from(n.as_float().unwrap()) / PT_PER_MM)
            .collect()
    };
    let tenth = |got: Vec<f64>, want: [f64; 4]| {
        assert!(
            got.iter().zip(want).all(|(a, b)| (a - b).abs() < 0.05),
            "{got:?} invece di {want:?}"
        );
    };
    tenth(millimetres(b"MediaBox"), [0.0, 0.0, 297.0, 210.0]);
    // In un PDF l'origine è in basso: il disegno è al centro, quindi il basso
    // è uguale all'alto.
    tenth(millimetres(b"TrimBox"), [left, top, right, bottom]);
    tenth(
        millimetres(b"BleedBox"),
        [left - 3.0, top - 3.0, right + 3.0, bottom + 3.0],
    );

    // Dieci pixel per millimetro: un pixel è un decimo.
    let pdf = hayro::hayro_syntax::Pdf::new(std::sync::Arc::new(bytes)).unwrap();
    let pages = pdf.pages();
    let page = pages.first().unwrap();
    let (width, height) = page.render_dimensions();
    let scale = (10.0 / PT_PER_MM) as f32;
    let render = hayro::RenderSettings {
        x_scale: scale,
        y_scale: scale,
        width: Some(2970),
        height: Some(2100),
        bg_color: hayro::vello_cpu::color::palette::css::WHITE,
    };
    assert_eq!(
        ((width * scale).round(), (height * scale).round()),
        (2970.0, 2100.0)
    );
    let pixmap = hayro::render(
        page,
        &hayro::hayro_interpret::InterpreterSettings::default(),
        &render,
    );
    let data = pixmap.data_as_u8_slice();
    let at = |x: f64, y: f64| -> [u8; 3] {
        let i = ((y * 10.0) as usize * usize::from(pixmap.width()) + (x * 10.0) as usize) * 4;
        [data[i], data[i + 1], data[i + 2]]
    };
    const WHITE: [u8; 3] = [255, 255, 255];
    const YELLOW: [u8; 3] = [255, 255, 0];
    const RED: [u8; 3] = [255, 0, 0];
    let middle = (top + bottom) / 2.0;
    // La striscia rossa comincia a 100 pixel dal bordo sinistro del disegno.
    let red = left + 100.0 * 25.4 / 96.0;
    assert_eq!(at(red - 0.15, middle), YELLOW);
    assert_eq!(at(red + 0.15, middle), RED);
    // La carta arriva fino al bordo dell'abbondanza, 3 mm oltre la
    // rifilatura, e lì finisce.
    assert_eq!(at(left - 0.15, middle), YELLOW);
    assert_eq!(at(left - 3.0 + 0.15, middle), YELLOW);
    assert_eq!(at(left - 3.0 - 0.15, middle), WHITE);
    assert_eq!(at(150.0, top - 3.0 + 0.15), YELLOW);
    assert_eq!(at(150.0, top - 3.0 - 0.15), WHITE);
    // Il segno di taglio in alto a sinistra, sulla riga della rifilatura, da
    // 8 a 3 mm oltre il bordo dell'abbondanza: scuro sulla sua riga, e bianco
    // fuori.
    let dark = |x: f64| {
        (-1..=1)
            .map(|row| at(x, top + f64::from(row) / 10.0)[0])
            .min()
            .unwrap()
    };
    assert!(dark(left - 3.0 - 5.5) < 160, "{}", dark(left - 3.0 - 5.5));
    assert_eq!(dark(left - 3.0 - 1.5), 255, "fra il segno e l'abbondanza");
    assert_eq!(dark(left - 3.0 - 8.5), 255, "oltre il segno");
    assert_eq!(at(left - 3.0 - 5.5, top - 1.0), WHITE);
}
