//! Che cosa esce: PNG e PDF di una scena contro le baseline, gli stessi
//! byte, il titolo, la scala, le immagini, i motivi e i caratteri.

use super::*;

// ---------------------------------------------------------------------------
// Che cosa esce
// ---------------------------------------------------------------------------

#[test]
fn the_png_of_a_scene_matches_its_baseline() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/scena.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena.png");
    assert_eq!(report.artifacts[0].media_type, "image/png");
    assert!(report.log.is_empty(), "{:?}", report.log);

    let image = decode(&bytes);
    // Scala 2 di serie: 400 × 250 pixel CSS diventano 800 × 500.
    assert_eq!((image.width, image.height), (800, 500));
    // 192 punti per pollice, in punti per metro.
    assert_eq!(image.per_meter, Some(7559));
    baseline("scena.png", &bytes, same_png);
}

#[test]
fn the_pdf_of_a_scene_matches_its_baseline() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/scena.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena.pdf");
    assert_eq!(report.artifacts[0].media_type, "application/pdf");
    assert!(report.log.is_empty(), "{:?}", report.log);

    let text = String::from_utf8_lossy(&bytes);
    assert!(text.starts_with("%PDF-1.7\n"));
    assert!(text.ends_with("%%EOF\n"));
    // 400 × 250 pixel CSS a 96 per pollice sono 300 × 187,5 punti.
    assert!(text.contains("/MediaBox [0 0 300 187.5]"), "{text}");
    // Il testo resta testo, nei caratteri di Fub incorporati.
    for font in [
        "Inter-Regular",
        "Inter-Bold",
        "Literata-Bold",
        "JetBrainsMono-Regular",
    ] {
        assert!(text.contains(&format!("+{font}")), "{font} is not embedded");
    }
    assert!(text.contains("/FontFile2"));
    baseline("scena.pdf", &bytes, same_pdf);
}

#[test]
fn the_same_drawing_gives_the_same_bytes() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let png = png_of(&host, "scena.svg");
    assert_eq!(png, png_of(&host, "scena.svg"));
    // `svg2pdf` scrive caratteri e risorse nell'ordine di una `HashMap`, che
    // cambia a ogni istanza: con quattro caratteri nello stesso disegno, otto
    // export uguali vogliono dire che l'ordine non viene da lì.
    let pdf = pdf_of(&host, "scena.svg");
    for _ in 0..8 {
        assert_eq!(pdf, pdf_of(&host, "scena.svg"));
    }
}

#[test]
fn the_title_of_the_drawing_reaches_both_files() {
    let mut model = DocumentModel::empty(DocId::new("acqua.svg"));
    model.body.push(Block::Custom {
        custom_kind: "svg.scene".to_string(),
        attrs: serde_json::Value::Null,
        blocks: vec![Block::Heading {
            level: 1,
            inlines: vec![Inline::Text("Città d'acqua".to_string())],
            anchor: None,
            span: Span::new(0, 1),
            explicit_anchor: None,
        }],
        anchor: None,
        span: Span::new(0, 1),
    });
    let host = host()
        .with_document("acqua.svg", &fixture("scena.svg"))
        .with_model("acqua.svg", model)
        .with_document("senza.svg", &fixture("scena.svg"));

    let image = decode(&png_of(&host, "acqua.svg"));
    assert!(image
        .texts
        .contains(&("Title".to_string(), "Città d'acqua".to_string())));
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "acqua.svg")).into_owned();
    // Non ASCII, quindi UTF-16BE con il BOM.
    let utf16: String = "\u{feff}Città d'acqua"
        .encode_utf16()
        .map(|unit| format!("{unit:04X}"))
        .collect();
    assert!(pdf.contains(&format!("/Title <{utf16}>")), "{pdf}");
    assert!(pdf.contains("/DisplayDocTitle true"));

    // Senza modello, il nome del file.
    let image = decode(&png_of(&host, "senza.svg"));
    assert!(image
        .texts
        .contains(&("Title".to_string(), "senza".to_string())));
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "senza.svg")).into_owned();
    assert!(pdf.contains("/Title (senza)"));
}

#[test]
fn the_scale_sets_pixels_and_density() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["scena.svg"],
        serde_json::json!({ "scale": 0.5 }),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert_eq!((image.width, image.height), (200, 125));
    assert_eq!(image.per_meter, Some(1890));

    for wrong in [
        serde_json::json!(0),
        serde_json::json!(-1),
        serde_json::json!(8.5),
        serde_json::json!("2"),
        serde_json::json!([2]),
    ] {
        let outcome = export(
            &PngExport,
            &host,
            DRAW_PNG,
            &["scena.svg"],
            serde_json::json!({ "scale": wrong }),
        );
        assert!(
            matches!(outcome, Err(PluginError::BadArgs(_))),
            "scale {wrong} accepted"
        );
    }
}

#[test]
fn a_drawing_too_large_for_a_png_comes_out_smaller_and_says_so() {
    let wide = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="10"><rect width="40000" height="10" fill="#0072b2"/></svg>"##;
    let host = host().with_document("striscia.svg", wide);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["striscia.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert!(image.width <= 16_384, "{}", image.width);
    assert!(image.width > 16_000, "{}", image.width);
    let log = messages(&report);
    assert!(log.iter().any(|m| m.contains("instead of 2")), "{log:?}");
}

#[test]
fn a_huge_drawing_keeps_its_size_on_a_pdf_page() {
    // 40 000 pixel CSS sono 30 000 punti, oltre il lato massimo di una pagina
    // per i lettori (14 400): la pagina dichiara un'unità più grande.
    let wide = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="10"><rect width="40000" height="10" fill="#0072b2"/></svg>"##;
    let host = host().with_document("striscia.svg", wide);
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "striscia.svg")).into_owned();
    let after = |key: &str| -> Vec<f64> {
        let rest = &pdf[pdf.find(key).unwrap_or_else(|| panic!("{key}: {pdf}")) + key.len()..];
        let end = rest.find([']', '>', '/']).unwrap();
        rest[..end]
            .split_whitespace()
            .map(|n| n.trim_start_matches('[').parse().unwrap())
            .collect()
    };
    let unit = after("/UserUnit ")[0];
    let media = after("/MediaBox ");
    assert_eq!(unit, 2.0834);
    assert!(media[2] <= 14_400.0, "{media:?}");
    // Moltiplicata per l'unità, la pagina è il disegno: 30 000 × 7,5 punti.
    assert!((media[2] * unit - 30_000.0).abs() < 0.01, "{media:?}");
    assert!((media[3] * unit - 7.5).abs() < 0.001, "{media:?}");
}

#[test]
fn a_webp_image_reaches_both_formats() {
    // Un WebP senza perdita, 2 × 2 pixel verdi: `svg2pdf` di suo non decodifica
    // WebP, e la feature `webp` di `image` è accesa per questo.
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .encode(
            &[0, 158, 115].repeat(4),
            2,
            2,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image width="20" height="20" image-rendering="optimizeSpeed" href="data:image/webp;base64,{}"/></svg>"##,
        base64(&webp)
    );
    let host = host().with_document("verde.svg", &svg);

    let image = decode(&png_of(&host, "verde.svg"));
    let green = image
        .rgba
        .chunks(4)
        .filter(|px| px == &[0, 158, 115, 255])
        .count();
    assert_eq!(green, (image.width * image.height) as usize);

    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["verde.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let pdf = only_artifact(&report).1;
    let pdf = String::from_utf8_lossy(&pdf);
    assert!(pdf.contains("/Subtype /Image"), "{pdf}");
}

#[test]
fn a_cropped_image_and_a_masked_group_come_out_as_they_are_seen() {
    // Come li scrive FubDraw: un'immagine rossa di 80 × 80 ritagliata a
    // 40 × 20 da un `clipPath` suo, e un quadrato verde con una maschera
    // d'opacità che lo sfuma da pieno, a sinistra, a vuoto, a destra.
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 160 80" width="160" height="80"><defs id="fub-defs"><clipPath id="c1" fub:role="private"><rect x="20" y="30" width="40" height="20"/></clipPath><linearGradient id="g1" fub:role="private" x1="80" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient><mask id="m1" fub:role="private" x="80" y="0" width="80" height="80" maskUnits="userSpaceOnUse"><rect x="80" y="0" width="80" height="80" fill="url(#g1) #808080"/></mask></defs><rect id="fub-paper" fub:role="paper" x="0" y="0" width="160" height="80" fill="#ffffff"/><g id="l1" fub:layer="Livello 1"><image id="o1" x="0" y="0" width="80" height="80" preserveAspectRatio="none" image-rendering="optimizeSpeed" clip-path="url(#c1)" href="data:image/png;base64,{}"/><g id="g2" mask="url(#m1)"><rect id="o2" x="80" y="0" width="80" height="80" fill="#009e73"/></g></g></svg>"##,
        base64(&red_png())
    );
    let host = host().with_document("ritagli.svg", &svg);
    let one = serde_json::json!({"scale": 1});
    let report = export(&PngExport, &host, DRAW_PNG, &["ritagli.svg"], one).unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let image = decode(&only_artifact(&report).1);
    let at = |image: &Image, x: u32, y: u32| {
        let i = ((y * image.width + x) * 4) as usize;
        image.rgba[i..i + 4].to_vec()
    };
    // Dell'immagine resta il ritaglio, e il resto è carta.
    assert_eq!(red_pixels(&image), 40 * 20);
    assert_eq!(at(&image, 40, 40), [255, 0, 0, 255]);
    assert_eq!(at(&image, 10, 10), [255, 255, 255, 255]);
    assert_eq!(at(&image, 70, 70), [255, 255, 255, 255]);
    // Il verde è pieno dove la maschera è bianca e sparisce dove è nera.
    let full = at(&image, 81, 40);
    assert!(full[0] < 30 && full[1] > 140, "{full:?}");
    let gone = at(&image, 158, 40);
    assert!(gone.iter().all(|&c| c > 240), "{gone:?}");

    // Il PDF ha il ritaglio prima dell'immagine, e la maschera come maschera
    // morbida dello stato grafico con cui si disegna il quadrato verde.
    let pdf = pdf_of(&host, "ritagli.svg");
    assert!(String::from_utf8_lossy(&pdf).contains("/SMask"));
    let pdf = tokens(&pdf);
    let page = pdf
        .iter()
        .find_map(|t| match t {
            Token::Stream(data)
                if data.is_ascii() && String::from_utf8_lossy(data).contains("20 30 m") =>
            {
                Some(tokens(data))
            }
            _ => None,
        })
        .expect("il contenuto del disegno");
    let dos: Vec<usize> = page
        .iter()
        .enumerate()
        .filter(|(_, t)| is_word(t, "Do"))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(dos.len(), 2, "l'immagine e il quadrato: {page:?}");
    let (image_do, green_do) = (dos[0], dos[1]);
    let name_before = |at: usize| match &page[at - 1] {
        Token::Word(name) => String::from_utf8_lossy(name).into_owned(),
        other => panic!("un nome prima di Do, non {other:?}"),
    };

    // Il ritaglio dell'immagine: il percorso del rettangolo di 20 per 30, la
    // regola `W n`, e solo dopo l'immagine, dentro lo stesso `q`.
    let path = operators("20 30 m 60 30 l 60 50 l 20 50 l h W n");
    let clip = page
        .windows(path.len())
        .position(|w| w == path.as_slice())
        .expect("il ritaglio dell'immagine");
    assert!(
        clip + path.len() <= image_do,
        "il ritaglio precede l'immagine"
    );
    let block = *saved_before(&page, clip)
        .last()
        .expect("il ritaglio sta in un q");
    assert!(
        saved_before(&page, image_do).contains(&block),
        "l'immagine è nel ritaglio"
    );
    assert!(
        !saved_before(&page, green_do).contains(&block),
        "il quadrato no"
    );
    let drawn = object(&pdf, reference(&pdf, &name_before(image_do)));
    assert!(drawn
        .windows(2)
        .any(|w| is_word(&w[0], "/Subtype") && is_word(&w[1], "/Image")));
    assert!(
        states_at(&page, image_do)
            .iter()
            .all(|state| !object(&pdf, reference(&pdf, state))
                .iter()
                .any(|t| is_word(t, "/SMask"))),
        "l'immagine non ha una maschera morbida"
    );

    // Il quadrato verde: la form con il suo riempimento, disegnata con lo
    // stato grafico che ha la maschera morbida, di luminosità, il cui gruppo
    // ritaglia alla regione della maschera.
    let square = object(&pdf, reference(&pdf, &name_before(green_do)));
    let fill = content_of(square);
    let rect = operators("80 0 m 160 0 l 160 80 l 80 80 l h f");
    assert!(
        fill.windows(rect.len()).any(|w| w == rect.as_slice()),
        "{fill:?}"
    );
    let scn = fill
        .iter()
        .position(|t| is_word(t, "scn"))
        .expect("un colore");
    let channels: Vec<f64> = fill[scn - 3..scn]
        .iter()
        .map(|t| match t {
            Token::Number(n) => *n,
            other => panic!("un canale, non {other:?}"),
        })
        .collect();
    for (found, wanted) in channels.iter().zip([0.0, 158.0 / 255.0, 115.0 / 255.0]) {
        assert!((found - wanted).abs() < 0.01, "{channels:?}");
    }
    let masks: Vec<&[Token]> = states_at(&page, green_do)
        .iter()
        .map(|state| object(&pdf, reference(&pdf, state)))
        .filter(|state| state.iter().any(|t| is_word(t, "/SMask")))
        .collect();
    assert_eq!(masks.len(), 1, "una sola maschera morbida per il quadrato");
    assert!(masks[0].iter().any(|t| is_word(t, "/Luminosity")));
    let region = operators("80 0 80 80 re h W n");
    let group = content_of(object(&pdf, reference(masks[0], "/G")));
    assert!(
        group.starts_with(&[Token::Word(b"q".to_vec())])
            && group.windows(region.len()).any(|w| w == region.as_slice()),
        "{group:?}"
    );

    // L'SVG pulito tiene le risorse, senza i ruoli dell'editor, e si
    // disegna allo stesso modo.
    let clean = svg_of(&host, "ritagli.svg", serde_json::Value::Null);
    assert!(clean.contains(r#"<clipPath id="c1"><rect"#), "{clean}");
    assert!(clean.contains(r#"<mask id="m1" x="80""#), "{clean}");
    assert!(clean.contains(r#"clip-path="url(#c1)""#), "{clean}");
    assert!(clean.contains(r#"mask="url(#m1)""#), "{clean}");
    assert!(!clean.contains("fub:"), "{clean}");
    let drawn = png_of_text(&clean).expect("l'SVG pulito si disegna");
    assert_eq!(red_pixels(&drawn), 40 * 20);
    assert_eq!(at(&drawn, 81, 40), full);
}

#[test]
fn a_hatch_and_a_motif_come_out_as_they_are_seen() {
    // Come li scrive FubDraw: un quadrato con righe orizzontali nere alte 4
    // ogni 8 su un fondo blu, e uno riempito da un motivo del documento, un
    // quadratino rosso di 10 in una mattonella di 20.
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 160 80" width="160" height="80"><defs id="fub-defs"><pattern id="h1" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" fub:pattern="lines 0 8 4 #000000 #0072b2"><rect width="8" height="8" fill="#0072b2"/><rect y="2" width="8" height="4" fill="#000000"/></pattern><pattern id="m1" fub:role="swatch" fub:name="Quadri" x="80" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><rect x="80" y="0" width="10" height="10" fill="#ff0000" transform="matrix(1 0 0 1 -80 0)"/></pattern></defs><rect id="fub-paper" fub:role="paper" x="0" y="0" width="160" height="80" fill="#ffffff"/><g id="l1" fub:layer="Livello 1"><rect id="o1" x="0" y="0" width="80" height="80" fill="url(#h1) #003959"/><rect id="o2" x="80" y="0" width="80" height="80" fill="url(#m1) #ff0000"/></g></svg>"##;
    let host = host().with_document("campiture.svg", svg);
    let one = serde_json::json!({"scale": 1});
    let report = export(&PngExport, &host, DRAW_PNG, &["campiture.svg"], one).unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let image = decode(&only_artifact(&report).1);
    let at = |image: &Image, x: u32, y: u32| {
        let i = ((y * image.width + x) * 4) as usize;
        image.rgba[i..i + 4].to_vec()
    };
    // Le righe si ripetono ogni 8, senza giunte fra una mattonella e l'altra.
    for y in (0..80).step_by(8) {
        for x in [0, 37, 79] {
            assert_eq!(at(&image, x, y), [0, 114, 178, 255], "fondo in {x}, {y}");
            assert_eq!(
                at(&image, x, y + 3),
                [0, 0, 0, 255],
                "riga in {x}, {}",
                y + 3
            );
            assert_eq!(
                at(&image, x, y + 7),
                [0, 114, 178, 255],
                "fondo in {x}, {}",
                y + 7
            );
        }
    }
    // Il motivo mostra il quadratino dov'era, e poi ogni 20.
    assert_eq!(red_pixels(&image), 16 * 10 * 10);
    assert_eq!(at(&image, 85, 5), [255, 0, 0, 255]);
    assert_eq!(at(&image, 125, 65), [255, 0, 0, 255]);
    assert_eq!(at(&image, 95, 5), [255, 255, 255, 255]);
    assert_eq!(at(&image, 85, 15), [255, 255, 255, 255]);

    // Il PDF li scrive come motivi a mattonelle.
    let pdf = pdf_of(&host, "campiture.svg");
    let text = String::from_utf8_lossy(&pdf);
    assert_eq!(
        text.matches("/PatternType 1").count(),
        2,
        "due motivi a mattonelle"
    );

    // L'SVG pulito tiene i motivi, senza i ruoli dell'editor, e si disegna
    // allo stesso modo.
    let clean = svg_of(&host, "campiture.svg", serde_json::Value::Null);
    assert!(clean.contains(r#"<pattern id="h1" width="8""#), "{clean}");
    assert!(clean.contains(r#"<pattern id="m1" x="80""#), "{clean}");
    assert!(!clean.contains("fub:"), "{clean}");
    let drawn = png_of_text(&clean).expect("l'SVG pulito si disegna");
    assert_eq!(red_pixels(&drawn), 16 * 10 * 10);
    assert_eq!(at(&drawn, 37, 3), [0, 0, 0, 255]);
}

#[test]
fn characters_outside_fubs_fonts_are_noted() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30" font-family="Inter, sans-serif" font-size="20">Acqua 水 Ω</text></svg>"##;
    let host = host().with_document("lingue.svg", svg);
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        let report = export(
            provider,
            &host,
            target,
            &["lingue.svg"],
            serde_json::Value::Null,
        )
        .unwrap();
        assert_eq!(report.artifacts.len(), 1);
        let note = report
            .log
            .iter()
            .find(|note| note.message.contains("outside the drawing's fonts"))
            .unwrap_or_else(|| panic!("{:?}", report.log));
        assert_eq!(note.level, NoteLevel::Warning);
        assert_eq!(note.entry.as_deref(), Some("lingue.svg"));
        assert!(note.message.ends_with("Ω水"), "{}", note.message);
    }
}
