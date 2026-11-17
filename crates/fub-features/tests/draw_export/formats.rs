//! I formati uno per uno: PNG trasparente e JPEG bianco, la larghezza, le
//! opzioni sbagliate, gli stessi byte, e l'SVG con le immagini e pulito.

use super::*;

#[test]
fn without_the_paper_the_png_is_transparent_and_the_jpeg_white() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let none = serde_json::json!({"background": "none", "scale": 1});
    let report = export(&PngExport, &host, DRAW_PNG, &["scena.svg"], none.clone()).unwrap();
    let (path, bytes) = only_artifact(&report);
    // Il disegno intero: il nome di sempre.
    assert_eq!(path, "scena.png");
    let image = decode(&bytes);
    let corner = ((245 * image.width + 395) * 4) as usize;
    assert_eq!(image.rgba[corner + 3], 0);
    let with_paper = decode(&png_of(&host, "scena.svg"));
    let corner_2x = ((490 * with_paper.width + 790) * 4) as usize;
    assert_eq!(
        with_paper.rgba[corner_2x..corner_2x + 4],
        [255, 255, 255, 255]
    );

    // Sotto il JPEG resta il bianco.
    let (width, _, rgb) = decode_jpeg(&jpeg_of(&host, "scena.svg", none));
    let corner = ((245 * width + 395) * 3) as usize;
    assert!(
        rgb[corner..corner + 3].iter().all(|&c| c >= 250),
        "{:?}",
        &rgb[corner..corner + 3]
    );

    // E l'SVG non ha più la carta.
    let svg = svg_of(
        &host,
        "scena.svg",
        serde_json::json!({"background": "none"}),
    );
    assert!(!svg.contains("fub-paper"));
    assert!(svg_of(&host, "scena.svg", serde_json::Value::Null).contains(r#"id="fub-paper""#));
}

#[test]
fn a_jpeg_is_the_png_on_white_with_its_density_and_nothing_else() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let bytes = jpeg_of(&host, "scena.svg", serde_json::Value::Null);
    let segments = jpeg_segments(&bytes);
    let markers: Vec<u8> = segments.iter().map(|(marker, _)| *marker).collect();
    // Il JFIF e nient'altro di facoltativo: niente EXIF, profili o commenti.
    assert_eq!(markers[0], 0xE0);
    assert!(
        markers[1..]
            .iter()
            .all(|m| matches!(m, 0xDB | 0xC0 | 0xC4 | 0xDA)),
        "{markers:X?}"
    );
    // La densità in punti per pollice: 96 per la scala 2.
    let jfif = &segments[0].1;
    assert!(jfif.starts_with(b"JFIF\0"));
    assert_eq!(jfif[7], 1, "units: dots per inch");
    assert_eq!(&jfif[8..12], &[0, 192, 0, 192]);
    // Il colore senza sottocampionare: ogni componente 1 × 1.
    let frame = &segments.iter().find(|(m, _)| *m == 0xC0).unwrap().1;
    assert_eq!(frame[5], 3);
    for component in frame[6..].chunks(3) {
        assert_eq!(component[1], 0x11, "{frame:?}");
    }

    // I pixel sono quelli del PNG posato sul bianco, a meno del JPEG.
    let png = decode(&png_of(&host, "scena.svg"));
    let (width, height, rgb) = decode_jpeg(&bytes);
    assert_eq!((width, height), (png.width, png.height));
    let mut total = 0u64;
    for (px, jp) in png.rgba.chunks(4).zip(rgb.chunks(3)) {
        let alpha = u32::from(px[3]);
        for channel in 0..3 {
            let on_white = (u32::from(px[channel]) * alpha + 255 * (255 - alpha) + 127) / 255;
            total += u64::from((on_white as u8).abs_diff(jp[channel]));
        }
    }
    let mean = total as f64 / f64::from(width * height * 3);
    assert!(mean < 1.5, "mean difference {mean}");

    // Lo stesso disegno, gli stessi byte.
    assert_eq!(jpeg_of(&host, "scena.svg", serde_json::Value::Null), bytes);
}

#[test]
fn a_width_gives_exactly_those_pixels() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["scena.svg"],
        serde_json::json!({"width": 1000}),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    // 400 × 250 unità a 1000 pixel di larghezza: scala 2,5.
    assert_eq!((image.width, image.height), (1000, 625));
    assert_eq!(image.per_meter, Some(9449));
    let bytes = jpeg_of(&host, "scena.svg", serde_json::json!({"width": 1000}));
    assert_eq!(decode_jpeg(&bytes).0, 1000);
    assert_eq!(&jpeg_segments(&bytes)[0].1[8..12], &[0, 240, 0, 240]);

    // Una larghezza che farebbe l'immagine troppo alta esce ridotta, e il
    // log lo dice.
    let tall = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="4000"><rect width="100" height="4000" fill="#0072b2"/></svg>"##;
    let host = host.with_document("torre.svg", tall);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["torre.svg"],
        serde_json::json!({"width": 1000}),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert_eq!((image.width, image.height), (410, 16_384));
    assert_eq!(
        messages(&report),
        ["exported 410 pixels wide instead of 1000: at the requested width the image would exceed 16384 pixels per side or 32 million pixels"]
    );
}

#[test]
fn a_wrong_option_stops_the_export_before_any_file() {
    let host = host()
        .with_document("Scienze/quaderno.svg", &quaderno())
        .with_document("scena.svg", &fixture("scena.svg"));
    let selection = |ids: serde_json::Value| {
        let selection = serde_json::json!({"ids": ids, "box": [0, 0, 10, 10]});
        serde_json::json!({"scope": "selection", "selection": selection})
    };
    // Il provider, la sua destinazione, i documenti, le opzioni e l'errore.
    type Case<'a> = (
        &'a dyn ExportProvider,
        &'a str,
        Vec<&'a str>,
        serde_json::Value,
        &'a str,
    );
    let cases: Vec<Case> = vec![
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "pages"}),
            "e_scope",
        ),
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            serde_json::json!({"scope": "boards"}),
            "e_boards",
        ),
        (
            &SvgExport,
            DRAW_SVG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "selection"}),
            "e_selection",
        ),
        (
            &JpegExport,
            DRAW_JPEG,
            vec!["scena.svg"],
            serde_json::json!({"background": "white"}),
            "e_background",
        ),
        (
            &JpegExport,
            DRAW_JPEG,
            vec!["scena.svg"],
            serde_json::json!({"scale": 2, "width": 800}),
            "e_scale_and_width",
        ),
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"width": 0}),
            "e_width",
        ),
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "selection", "selection": {"ids": ["o1a2b3c4d"], "box": [0, 0, 0, 10]}}),
            "e_box",
        ),
        // Con le tavole e la selezione, un disegno solo.
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg", "Scienze/quaderno.svg"],
            serde_json::json!({"scope": "boards", "boards": ["b00000001"]}),
            "e_one_drawing",
        ),
        // La pagina di stampa: una carta che non c'è, e una su cui non resta
        // posto per il disegno.
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            serde_json::json!({"paper": "b5"}),
            "e_paper",
        ),
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            serde_json::json!({"paper": "a6", "margin": 40, "bleed": 5, "marks": ["crop"]}),
            "e_room",
        ),
        // Ciò che il disegno non ha: anche dopo una tavola che c'è.
        (
            &PngExport,
            DRAW_PNG,
            vec!["Scienze/quaderno.svg"],
            serde_json::json!({"scope": "boards", "boards": ["b00000001", "b9"]}),
            "e_board",
        ),
        // Un id che non è un oggetto: la carta, un `tspan`, una risorsa.
        (
            &SvgExport,
            DRAW_SVG,
            vec!["scena.svg"],
            selection(serde_json::json!(["o1a2b3c4d", "fub-paper"])),
            "e_object",
        ),
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            selection(serde_json::json!(["cielo"])),
            "e_object",
        ),
    ];
    for (provider, target, docs, options, key) in cases {
        let request = ExportRequest::new(
            target,
            ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
        )
        .with_options(options.clone());
        let mut sink = Watched::default();
        let outcome = provider.export(&request, &host, &mut sink);
        let (got, args) = refusal(outcome);
        assert_eq!(got, key, "{options}");
        assert!(sink.opened.is_empty(), "{options}: {:?}", sink.opened);
        match key {
            "e_board" => assert_eq!(args, ["Scienze/quaderno.svg", "b9"]),
            "e_object" => assert_eq!(args[0], "scena.svg"),
            "e_one_drawing" => assert_eq!(args, ["2"]),
            _ => {}
        }
    }
}

#[test]
fn the_new_formats_give_the_same_bytes_every_time() {
    let host = host()
        .with_document("scena.svg", &fixture("scena.svg"))
        .with_document("Scienze/quaderno.svg", &quaderno());
    let svg = svg_of(&host, "scena.svg", serde_json::Value::Null);
    assert_eq!(svg_of(&host, "scena.svg", serde_json::Value::Null), svg);
    // L'SVG pulito di un disegno pulito non cambia.
    assert_eq!(
        fub_scene::export::clean(&svg, &fub_scene::export::Scope::Drawing).unwrap(),
        svg
    );
    let boards = serde_json::json!({"scope": "boards", "boards": ["b00000001", "b00000002"], "background": "none"});
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&JpegExport, DRAW_JPEG),
        (&SvgExport, DRAW_SVG),
        (&PdfExport, DRAW_PDF),
    ] {
        let once = export(
            provider,
            &host,
            target,
            &["Scienze/quaderno.svg"],
            boards.clone(),
        )
        .unwrap();
        let again = export(
            provider,
            &host,
            target,
            &["Scienze/quaderno.svg"],
            boards.clone(),
        )
        .unwrap();
        assert_eq!(artifacts(&once), artifacts(&again), "{target}");
    }
}

#[test]
fn the_svg_carries_the_vault_images_it_can_read() {
    use base64::Engine as _;
    let svg = with_images(&[
        ("foto/rosso.png", 0, 60),
        ("foto/manca.png", 60, 40),
        ("https://example.org/a.png", 100, 30),
        ("foto/rosso.png", 130, 30),
    ]);
    let red = red_png();
    let host = host()
        .with_document("disegni/acqua.svg", &svg)
        .with_binary_document("disegni/foto/rosso.png", &red);
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    // Il disegno è già `acqua.svg`: l'export ha la parola fra parentesi.
    assert_eq!(path, "disegni/acqua (exported).svg");
    let text = String::from_utf8(bytes).expect("UTF-8");
    // Fuori dal vault un percorso non porta a niente: l'immagine entra coi
    // suoi byte, letti una volta anche se il disegno la usa due volte.
    let uri = format!(
        "href=\"data:image/png;base64,{}\"",
        base64::engine::general_purpose::STANDARD.encode(&red)
    );
    assert_eq!(text.matches(&uri).count(), 2, "{text}");
    assert_eq!(host.reads_on("disegni/foto/rosso.png"), (1, red.len()));
    // Ciò che non c'è resta com'è, e il log lo dice; un indirizzo del web
    // resta un indirizzo.
    assert!(text.contains("href=\"foto/manca.png\""), "{text}");
    assert!(
        text.contains("href=\"https://example.org/a.png\""),
        "{text}"
    );
    assert_eq!(
        messages(&report),
        ["1 image is not in the vault and was not exported: foto/manca.png"]
    );
    assert_eq!(report.log[0].entry.as_deref(), Some("disegni/acqua.svg"));

    // La parola la sceglie chi esporta, nella sua lingua.
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/acqua.svg"],
        serde_json::json!({"suffix": "esportato"}),
    )
    .unwrap();
    assert_eq!(only_artifact(&report).0, "disegni/acqua (esportato).svg");
}

#[test]
fn the_svg_keeps_the_path_of_the_images_the_export_cannot_hold() {
    use base64::Engine as _;
    use fub_abi::transfer::PLUGIN_EXPORT_LIMIT;
    // Due immagini da 13 MiB: in base64 una passa i 17, e due insieme non
    // stanno nei 32 MiB che l'host consegna. Sono PNG veri con byte in coda.
    let red = red_png();
    let mut large = red.clone();
    large.resize(13 * 1024 * 1024, 0);
    let host = host()
        .with_document(
            "uno.svg",
            &with_images(&[("a.png", 0, 60), ("b.png", 60, 60), ("rosso.png", 120, 40)]),
        )
        .with_document(
            "due.svg",
            &with_images(&[("a.png", 0, 80), ("rosso.png", 80, 80)]),
        )
        .with_binary_document("a.png", &large)
        .with_binary_document("b.png", &large)
        .with_binary_document("rosso.png", &red);
    let request = ExportRequest::new(
        DRAW_SVG,
        ExportSelection::Documents(vec![DocId::new("uno.svg"), DocId::new("due.svg")]),
    );
    // Il sink dell'host, col suo tetto: l'export non fallisce.
    let mut sink = MemorySink::bounded(PLUGIN_EXPORT_LIMIT);
    let report = SvgExport.export(&request, &host, &mut sink).unwrap();
    let texts: Vec<(String, String)> = report
        .artifacts
        .iter()
        .map(|a| {
            let text = String::from_utf8(a.as_bytes().expect("in memoria").to_vec());
            (a.path.clone(), text.expect("UTF-8"))
        })
        .collect();
    let paths: Vec<&str> = texts.iter().map(|(path, _)| path.as_str()).collect();
    // L'ordine è quello dei path.
    assert_eq!(paths, ["due (exported).svg", "uno (exported).svg"]);
    let (due, uno) = (&texts[0].1, &texts[1].1);
    let red_uri = format!(
        "href=\"data:image/png;base64,{}\"",
        base64::engine::general_purpose::STANDARD.encode(&red)
    );
    // Il primo file prende l'immagine grande e la piccola; il secondo, con
    // ciò che resta, soltanto la piccola, e le grandi tengono il percorso.
    assert!(due.len() > 17 * 1024 * 1024, "{}", due.len());
    assert!(due.contains(&red_uri) && !due.contains("href=\"a.png\""));
    assert!(uno.contains(&red_uri), "{uno}");
    assert!(uno.contains("href=\"a.png\"") && uno.contains("href=\"b.png\""));
    assert!(due.len() + uno.len() <= PLUGIN_EXPORT_LIMIT);
    assert_eq!(
        messages(&report),
        ["2 vault images would take the export past 32 MiB and keep their path: a.png, b.png"]
    );
    assert_eq!(report.log[0].entry.as_deref(), Some("uno.svg"));
}

/// I pixel moltiplicati per la loro opacità, e l'opacità: ciò che si vede.
/// Il colore di un pixel quasi trasparente, diviso per un'opacità di 1 su 255,
/// può cambiare di tutto senza che si veda niente.
fn premultiplied(image: &Image) -> Vec<u8> {
    image
        .rgba
        .chunks(4)
        .flat_map(|px| {
            let alpha = u16::from(px[3]);
            let times = |c: u8| ((u16::from(c) * alpha + 127) / 255) as u8;
            [times(px[0]), times(px[1]), times(px[2]), px[3]]
        })
        .collect()
}

/// Il PNG a scala 1 di un testo SVG, come disegno di un vault da solo.
pub(super) fn png_of_text(text: &str) -> Option<Image> {
    let host = host().with_document("prova.svg", text);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["prova.svg"],
        serde_json::json!({"scale": 1}),
    )
    .ok()?;
    Some(decode(&only_artifact(&report).1))
}

/// Quanto possono differire il disegno derivato e quello pulito, che scrive i
/// numeri con 2 decimali: un punto si sposta al più di mezzo centesimo, e la
/// copertura di un pixel di bordo cambia di un livello o due. Dove il punto è
/// la punta di uno spigolo vivo o dà la direzione a un marker lo spostamento si
/// amplifica, e qualche pixel cambia di più: mai più di un quarto, mai più di
/// un valore su mille, e in media meno di un centesimo di livello.
const CLEAN_TOLERANCE: u8 = 4;
const CLEAN_WORST: u8 = 64;

#[test]
fn the_clean_svg_draws_the_pixels_of_the_derived_one() {
    let scene_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fub-scene/tests/corpus");
    let vectors = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-export");
    let read_json = |name: &str| -> Vec<serde_json::Value> {
        let text = fs::read_to_string(vectors.join(name)).unwrap();
        serde_json::from_str(&text).unwrap()
    };
    let scope_of = |vector: &serde_json::Value| -> fub_scene::export::Scope {
        let scope = &vector["scope"];
        match scope["kind"].as_str().unwrap() {
            "drawing" => fub_scene::export::Scope::Drawing,
            "board" => fub_scene::export::Scope::Board(scope["id"].as_str().unwrap().to_string()),
            "selection" => fub_scene::export::Scope::Selection {
                ids: scope["ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| id.as_str().unwrap().to_string())
                    .collect(),
                rect: <[f64; 4]>::try_from(
                    scope["box"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_f64().unwrap())
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            },
            other => panic!("{other}"),
        }
    };
    // Il corpus di `fub-scene` derivato intero; i testi derivati dei casi
    // della derivazione; i testi di partenza di quelli dell'SVG pulito.
    let mut cases: Vec<(String, String, fub_scene::export::Scope)> = Vec::new();
    let mut corpus: Vec<PathBuf> = fs::read_dir(&scene_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "svg"))
        .collect();
    corpus.sort();
    for path in corpus {
        let scope = fub_scene::export::Scope::Drawing;
        let source = fs::read_to_string(&path).unwrap();
        let derived =
            fub_scene::export::derive(&source, &scope, fub_scene::export::Background::Paper)
                .unwrap();
        cases.push((path.display().to_string(), derived, scope));
    }
    for vector in read_json("derive.json") {
        if let Some(text) = vector["expect"]["text"].as_str() {
            cases.push((
                format!("derive: {}", vector["name"]),
                text.to_string(),
                scope_of(&vector),
            ));
        }
    }
    for vector in read_json("clean.json") {
        if vector["expect"]["text"].is_string() {
            let input = vector["input"].as_str().unwrap().to_string();
            cases.push((
                format!("clean: {}", vector["name"]),
                input,
                scope_of(&vector),
            ));
        }
    }
    let mut drawn = 0;
    for (name, derived, scope) in cases {
        let cleaned =
            fub_scene::export::clean(&derived, &scope).unwrap_or_else(|e| panic!("{name}: {e}"));
        // Ripulire non cambia niente.
        assert_eq!(
            fub_scene::export::clean(&cleaned, &scope).unwrap(),
            cleaned,
            "{name}"
        );
        // Un disegno che non si disegna, come una tela vuota, non si
        // disegna nemmeno pulito.
        let (before, after) = match (png_of_text(&derived), png_of_text(&cleaned)) {
            (Some(before), Some(after)) => (before, after),
            (None, None) => continue,
            _ => panic!("{name}: one draws and the other does not"),
        };
        drawn += 1;
        assert_eq!(
            (before.width, before.height),
            (after.width, after.height),
            "{name}"
        );
        let (pa, pb) = (premultiplied(&before), premultiplied(&after));
        let mut worst = 0u8;
        let mut beyond = 0usize;
        let mut total = 0u64;
        for (a, b) in pa.iter().zip(&pb) {
            let d = a.abs_diff(*b);
            worst = worst.max(d);
            beyond += usize::from(d > CLEAN_TOLERANCE);
            total += u64::from(d);
        }
        let mean = total as f64 / pa.len() as f64;
        assert!(
            worst <= CLEAN_WORST && beyond * 1000 <= pa.len() && mean < 0.01,
            "{name}: worst {worst}, {beyond} values beyond {CLEAN_TOLERANCE}, mean {mean}"
        );
    }
    assert!(drawn >= 40, "{drawn}");
}
