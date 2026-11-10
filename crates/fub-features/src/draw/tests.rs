//! Test dell'export dei disegni.

use super::*;

/// Un testo come lo legge chi guarda, nella lingua data.
fn said(text: &Text, language: &str) -> String {
    let catalogs = catalog();
    let locale = fub_abi::locale::Locale {
        language: language.to_string(),
        ..fub_abi::locale::Locale::default()
    };
    fub_abi::text::Strings::new(&catalogs, "it", &locale).render(text)
}

#[test]
fn the_settings_are_four_in_one_group_with_their_defaults() {
    use fub_abi::settings::{SettingScope, SettingValue};
    let specs = settings();
    let keys: Vec<_> = specs.iter().map(|spec| spec.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "draw.workspace",
            "draw.toolbar",
            "draw.templates",
            "draw.suggestions"
        ]
    );
    assert_eq!(
        keys,
        [
            DRAW_WORKSPACE_KEY,
            DRAW_TOOLBAR_KEY,
            DRAW_TEMPLATES_KEY,
            DRAW_SUGGESTIONS_KEY
        ]
    );
    // Il vault, tranne i suggerimenti, che sono di chi usa la macchina.
    let scopes: Vec<_> = specs.iter().map(|spec| spec.scope).collect();
    assert_eq!(
        scopes,
        [
            SettingScope::Vault,
            SettingScope::Vault,
            SettingScope::Vault,
            SettingScope::Machine
        ]
    );
    // Un componente non cambia lo spazio di lavoro o la colonna e non
    // spegne i suggerimenti da sé: soltanto la cartella è di tutti.
    let writable: Vec<_> = specs.iter().map(|spec| spec.program_writable).collect();
    assert_eq!(writable, [false, false, true, false]);

    let defaults: Vec<_> = specs.iter().map(|spec| spec.kind.default_value()).collect();
    assert_eq!(
        defaults,
        [
            SettingValue::Text("full".into()),
            SettingValue::List(vec![]),
            SettingValue::Text("Templates".into()),
            SettingValue::Toggle(true),
        ]
    );
    let SettingKind::Choice { options, .. } = &specs[0].kind else {
        panic!("lo spazio di lavoro è una scelta")
    };
    let workspaces: Vec<_> = options.iter().map(|option| option.value.as_str()).collect();
    assert_eq!(workspaces, DRAW_WORKSPACES);
    assert_eq!(workspaces, ["full", "simple"]);
    let named: Vec<_> = options
        .iter()
        .map(|option| said(&option.label, "it"))
        .collect();
    assert_eq!(named, ["Completo", "Semplice"]);

    // Tutte nel gruppo «Disegni», con etichetta e descrizione scritte in
    // entrambe le lingue (una chiave senza voce si leggerebbe nuda).
    for spec in &specs {
        for (language, group) in [("it", "Disegni"), ("en", "Drawings")] {
            assert_eq!(said(&spec.group, language), group, "{}", spec.key);
            for text in [&spec.label, &spec.description] {
                let line = said(text, language);
                assert!(
                    !line.is_empty() && !line.starts_with("s_"),
                    "{} in {language}: «{line}»",
                    spec.key
                );
            }
        }
    }
    assert_eq!(said(&specs[0].label, "it"), "Spazio di lavoro");
    assert_eq!(said(&specs[1].label, "it"), "Strumenti della colonna");
    assert_eq!(said(&specs[2].label, "it"), "Cartella dei modelli");
    // L'interruttore dei suggerimenti parla come l'editor: stessa parola
    // nell'etichetta e nella descrizione, e il nome della casella è
    // quello che l'editor mostra (apostrofo tipografico nell'inglese).
    assert_eq!(said(&specs[3].label, "it"), "Suggerimenti brevi");
    assert_eq!(said(&specs[3].label, "en"), "Short tips");
    let it = said(&specs[3].description, "it");
    let en = said(&specs[3].description, "en");
    assert!(it.contains("suggerimenti"), "{it}");
    assert!(it.contains("«Non mostrare più suggerimenti»"), "{it}");
    assert!(en.contains("tips"), "{en}");
    assert!(en.contains("«Don’t show tips again»"), "{en}");
    assert!(!en.to_lowercase().contains("hint"), "{en}");
}

#[test]
fn the_suggestions_toggle_takes_a_toggle_and_nothing_else() {
    use fub_abi::settings::SettingValue;
    let specs = settings();
    let kind = &specs
        .iter()
        .find(|spec| spec.key == DRAW_SUGGESTIONS_KEY)
        .unwrap()
        .kind;
    assert!(kind.rejects(&SettingValue::Toggle(false)).is_none());
    assert!(kind.rejects(&SettingValue::Toggle(true)).is_none());
    assert!(kind.rejects(&SettingValue::Text("no".into())).is_some());
}

#[test]
fn the_font_database_holds_fubs_faces_and_nothing_else() {
    let db = fub_fonts();
    assert_eq!(db.len(), FACES.len());
    let mut families = BTreeSet::new();
    for face in db.faces() {
        // Dai byte compilati nel binario, non da un file: è ciò che rende
        // l'export uguale su ogni macchina.
        assert!(matches!(face.source, fontdb::Source::Binary(_)));
        families.insert(face.families[0].0.as_str());
    }
    assert_eq!(families, BTreeSet::from([SANS, MONO, SERIF]));

    for (generic, family) in [
        (fontdb::Family::Serif, SERIF),
        (fontdb::Family::SansSerif, SANS),
        (fontdb::Family::Monospace, MONO),
        (fontdb::Family::Cursive, SERIF),
        (fontdb::Family::Fantasy, SANS),
    ] {
        assert_eq!(db.family_name(&generic), family);
    }

    // Ogni famiglia ha i suoi due pesi, in tondo e in corsivo.
    let families = [SANS, SERIF, MONO];
    let styles = [fontdb::Style::Normal, fontdb::Style::Italic];
    for (family, style) in families
        .into_iter()
        .flat_map(|family| styles.map(|style| (family, style)))
    {
        for weight in [400, 700] {
            let id = db
                .query(&fontdb::Query {
                    families: &[fontdb::Family::Name(family)],
                    weight: fontdb::Weight(weight),
                    style,
                    ..fontdb::Query::default()
                })
                .unwrap_or_else(|| panic!("{family} {weight}"));
            let face = db.face(id).unwrap();
            assert_eq!(face.weight, fontdb::Weight(weight), "{family}");
            assert_eq!(face.style, style, "{family}");
        }
    }
}

#[test]
fn only_raster_images_are_kept_and_the_bytes_decide() {
    let kind = |bytes: &[u8]| raster(Arc::new(bytes.to_vec()));
    // Il minimo che dice formato e misura, 2 × 1 pixel: l'intestazione del
    // file, e per il JPEG il suo primo `SOF`.
    assert!(matches!(
        kind(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x02\0\0\0\x01"),
        Some(ImageKind::PNG(_))
    ));
    assert!(matches!(
        kind(&[
            0xFF, 0xD8, 0xFF, 0xC0, 0, 0x11, 8, 0, 1, 0, 2, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1
        ]),
        Some(ImageKind::JPEG(_))
    ));
    assert!(matches!(
        kind(b"GIF89a\x02\0\x01\0\0\0\0"),
        Some(ImageKind::GIF(_))
    ));
    assert!(matches!(
        kind(b"GIF87a\x02\0\x01\0\0\0\0"),
        Some(ImageKind::GIF(_))
    ));
    assert!(matches!(
        kind(b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f\x01\0\0\0"),
        Some(ImageKind::WEBP(_))
    ));
    // Un SVG, anche quando si dichiara `image/png`, resta fuori: dentro
    // potrebbe nominare altre risorse.
    assert!(kind(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>").is_none());
    assert!(kind(b"\x1f\x8b\x08\x00").is_none());
    assert!(kind(b"RIFF\0\0\0\0AVI LIST").is_none());
    assert!(kind(b"RIFF").is_none());
    assert!(kind(b"").is_none());
    // Il formato giusto senza una misura che si legga, o con un lato
    // nullo: `usvg` la scarterebbe senza dirlo, e qui resta fuori prima.
    assert!(kind(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR").is_none());
    assert!(kind(&[0xFF, 0xD8, 0xFF, 0xE0]).is_none());
    assert!(kind(b"GIF89a\0\0\x01\0\0\0\0").is_none());
    assert!(kind(b"RIFF\0\0\0\0WEBPVP8L").is_none());
}

#[test]
fn a_vault_path_is_read_like_the_client_reads_it() {
    for (href, path) in [
        ("foto/mare.png", Some("foto/mare.png")),
        ("/Allegati/foto.png", Some("/Allegati/foto.png")),
        ("../foto.png", Some("../foto.png")),
        ("  foto.png\n", Some("foto.png")),
        ("fo\tto\r\n.png", Some("foto.png")),
        ("foto mare.png", Some("foto mare.png")),
        ("foto%20mare.png", Some("foto%20mare.png")),
        // Un `:` dopo una barra non fa uno schema.
        ("cartella/ore 10:30.png", Some("cartella/ore 10:30.png")),
        ("1nota:foto.png", Some("1nota:foto.png")),
        ("", None),
        ("  ", None),
        ("#foto", None),
        ("//example.org/foto.png", None),
        ("\\\\server\\foto.png", None),
        ("/\\server/foto.png", None),
        ("https://example.org/foto.png", None),
        ("HTTP://example.org/foto.png", None),
        ("file:///etc/foto.png", None),
        ("data:image/png;base64,AAAA", None),
        ("C:\\foto.png", None),
        ("nota:foto.png", None),
    ] {
        assert_eq!(vault_path(href).as_deref(), path, "{href:?}");
    }
}

#[test]
fn a_png_scale_stays_within_the_pixel_limits() {
    let scale = |width: f32, height: f32| measure(width, height, Size::Scale(2.0)).scale;
    assert_eq!(scale(400.0, 250.0), 2.0);
    // 8192 × 4096 è proprio l'area massima: ci sta a scala 2, il doppio no.
    assert_eq!(scale(4096.0, 2048.0), 2.0);
    assert_eq!(scale(8192.0, 4096.0), 1.0);
    let (side_max, area_max) = (SIDE_MAX as f32, AREA_MAX as f32);
    for (width, height) in [(40_000.0, 10.0), (10.0, 40_000.0), (10_000.0, 10_000.0)] {
        let scale = scale(width, height);
        let (w, h) = ((width * scale).ceil(), (height * scale).ceil());
        assert!(
            w <= side_max && h <= side_max && w * h <= area_max,
            "{w}×{h}"
        );
        // Ridotta, ma non più del necessario.
        let side = w.max(h);
        assert!(
            side >= side_max * 0.99 || w * h >= area_max * 0.99,
            "{w}×{h}"
        );
    }
}

// --- il PDF -------------------------------------------------------------

/// Lo stesso grafo di oggetti, scritto due volte con numeri, ordine degli
/// oggetti e ordine delle chiavi diversi: è ciò che fa `svg2pdf` da
/// un'istanza all'altra. Il flusso contiene la parola `endstream`, che si
/// salta perché la lunghezza è quella dichiarata.
const CHUNK_A: &[u8] = b"1 0 obj\n<</Type /XObject /Subtype /Form /Resources <</Font <</f0 3 0 R>>>> /Length 13>>\nstream\nq endstream Q\nendstream\nendobj\n\
3 0 obj\n<</BaseFont /AAAAAA+Inter-Regular /Descendants [2 0 R] /Widths [0 0 500]>>\nendobj\n\
2 0 obj\n<</Z 1.5 /A (st\\)r\\\\ing) /M <00FF> /Back 1 0 R>>\nendobj\n\
9 0 obj\n<</Unreachable true>>\nendobj\n";
const CHUNK_B: &[u8] = b"% un commento\n4 0 obj\n<</M <00FF> /Back 7 0 R /A (st\\)r\\\\ing) /Z 1.5>>\nendobj\n\
7 0 obj\r\n<</Subtype /Form /Length 13 /Resources <</Font <</f0 5 0 R>>>> /Type /XObject>>\nstream\r\nq endstream Q\nendstream\nendobj\n\
5 0 obj\n<</Widths [0 0 500] /Descendants [4 0 R] /BaseFont /AAAAAA+Inter-Regular>>\nendobj\n";

#[test]
fn two_numberings_of_the_same_graph_give_the_same_file() {
    let a = pdf::canonical(pdf::parse(CHUNK_A).unwrap(), 1, 6).unwrap();
    let b = pdf::canonical(pdf::parse(CHUNK_B).unwrap(), 7, 6).unwrap();
    assert_eq!(a, b);

    let file = pdf::file(&a, "/Info 5 0 R /Root 1 0 R");
    let xref = file.windows(5).position(|w| w == b"xref\n").unwrap();
    let (body, tail) = file.split_at(xref);
    // In ampiezza dalla radice, con le chiavi in ordine; l'oggetto 9 non
    // si raggiunge e non c'è.
    let expected: &[u8] = b"%PDF-1.7\n%\x80\x80\x80\x80\n\
6 0 obj\n<</Length 13 /Resources <</Font <</f0 7 0 R>>>> /Subtype /Form /Type /XObject>>\nstream\nq endstream Q\nendstream\nendobj\n\
7 0 obj\n<</BaseFont /AAAAAA+Inter-Regular /Descendants [8 0 R] /Widths [0 0 500]>>\nendobj\n\
8 0 obj\n<</A (st\\)r\\\\ing) /Back 6 0 R /M <00FF> /Z 1.5>>\nendobj\n";
    assert_eq!(
        String::from_utf8_lossy(body),
        String::from_utf8_lossy(expected)
    );

    // La tabella punta all'inizio di ogni oggetto, con righe di 20 byte.
    let tail = std::str::from_utf8(tail).unwrap();
    let mut lines = tail.split('\n').skip(2);
    for id in 0..9usize {
        let line = lines.next().unwrap();
        assert_eq!(line.len(), 19, "{line:?}");
        assert!(line.ends_with('\r'));
        let offset: usize = line[..10].parse().unwrap();
        if id >= 6 {
            assert!(file[offset..].starts_with(format!("{id} 0 obj\n").as_bytes()));
        } else {
            assert_eq!(line, "0000000000 65535 f\r");
        }
    }
    assert!(tail.ends_with(&format!("startxref\n{xref}\n%%EOF\n")));

    // E il file si rilegge negli stessi oggetti.
    assert_eq!(pdf::parse(body).unwrap(), a);
}

#[test]
fn a_chunk_that_is_not_pdf_writers_is_refused() {
    let canonical = |chunk: &[u8]| pdf::parse(chunk).and_then(|o| pdf::canonical(o, 1, 6));
    for (chunk, why) in [
        (
            &b"1 0 obj\n<<>>\nendobj\n1 0 obj\n<<>>\nendobj\n"[..],
            "used twice",
        ),
        (b"1 0 obj\n<</A 2 0 R>>\nendobj\n", "missing"),
        (b"2 0 obj\n<<>>\nendobj\n", "missing"),
        (
            b"1 0 obj\n<</Length 2 0 R>>\nstream\nab\nendstream\nendobj\n",
            "direct length",
        ),
        (
            b"1 0 obj\n<</Length 99>>\nstream\nab\nendstream\nendobj\n",
            "longer than",
        ),
        (
            b"1 0 obj\n<</Length 2>>\nstream ab\nendstream\nendobj\n",
            "own line",
        ),
        (b"1 0 obj\n<</A (open>>\nendobj\n", "unterminated"),
        (b"1 0 obj\n<<1 2>>\nendobj\n", "must be a name"),
        (b"1 0 obj\n<<>>\n", "endobj"),
    ] {
        let error = canonical(chunk).unwrap_err();
        assert!(error.contains(why), "{error}");
    }
    let deep = [&b"1 0 obj\n"[..], &[b'['; 80], &[b']'; 80], b"\nendobj\n"].concat();
    assert!(canonical(&deep).unwrap_err().contains("nested too deeply"));
}

#[test]
fn the_page_has_the_size_of_the_drawing_and_its_title() {
    let chunk = b"1 0 obj\n<</Type /XObject /Subtype /Form /BBox [0 0 401 250] /Length 0>>\nstream\n\nendstream\nendobj\n";
    let page = pdf::Page::read(chunk, 1, 401.0, 250.0, None, None).unwrap();
    let file = pdf::document(vec![page], "Città (1)").unwrap();
    let text = String::from_utf8_lossy(&file);
    // 401 × 250 pixel CSS sono 300,75 × 187,5 punti: senza zeri in coda.
    assert!(text.contains("/MediaBox [0 0 300.75 187.5]"), "{text}");
    assert!(text.contains("stream\nq 300.75 0 0 187.5 0 0 cm /D Do Q\nendstream"));
    assert!(!text.contains("/UserUnit"));
    assert!(text.contains("/Resources <</XObject <</D 6 0 R>> /ProcSet [/PDF /ImageC /ImageB]>>"));
    assert!(
        text.contains("6 0 obj\n<</BBox [0 0 401 250] /Length 0 /Subtype /Form /Type /XObject>>")
    );
    assert!(text.contains("/Info 5 0 R /Root 1 0 R /Size 7"));

    assert_eq!(pdf::text_string("scena"), b"(scena)");
    assert_eq!(pdf::text_string("a(b)\\"), b"(a\\(b\\)\\\\)");
    assert_eq!(pdf::text_string("Città"), b"<FEFF004300690074007400E0>");
    assert_eq!(pdf::text_string("a\nb"), b"<FEFF0061000A0062>");
    assert_eq!(pdf::text_string("水"), b"<FEFF6C34>");
    assert!(
        text.contains("/Title <FEFF004300690074007400E00020002800310029>"),
        "{text}"
    );
}

/// Le misure delle immagini che `svg2pdf` dipinge per gli effetti di
/// `svg`, che ha `units_per_inch` unità per pollice: `/Width` e
/// `/Height` di ogni immagine, e della sua trasparenza.
fn painted(svg: &str, units_per_inch: f32) -> Vec<(u32, u32)> {
    let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
    let (chunk, _) = svg2pdf::to_chunk(&tree, pdf::options(&tree, units_per_inch)).unwrap();
    let text = String::from_utf8_lossy(chunk.as_bytes());
    let read = |key: &str| -> Vec<u32> {
        text.match_indices(key)
            .map(|(at, _)| {
                let digits = text[at + key.len()..]
                    .split(|c: char| !c.is_ascii_digit())
                    .next()
                    .unwrap();
                digits.parse().unwrap()
            })
            .collect()
    };
    read("/Width ").into_iter().zip(read("/Height ")).collect()
}

/// Un disegno con un'ombra la cui regione è di 96 × 48 unità, dentro
/// `wrap` (`{}` è il posto dell'oggetto).
fn shadowed(size: f32, wrap: &str) -> String {
    let object =
        r##"<rect x="20" y="20" width="60" height="20" fill="#336699" filter="url(#f)"/>"##;
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}"><filter id="f" filterUnits="userSpaceOnUse" x="10" y="10" width="96" height="48" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2"/></filter>{}</svg>"##,
        wrap.replace("{}", object)
    )
}

#[test]
fn effects_are_painted_at_300_dpi_on_the_page() {
    // 96 pixel CSS sono un pollice: 300 pixel dipinti.
    let plain = painted(&shadowed(400.0, "{}"), CSS_DPI);
    assert!(!plain.is_empty());
    assert!(plain.iter().all(|&size| size == (300, 150)), "{plain:?}");

    // Un gruppo che ingrandisce due volte: la regione, nelle coordinate
    // del gruppo, si dipinge col doppio dei pixel.
    let doubled = painted(
        &shadowed(400.0, r#"<g transform="scale(2)">{}</g>"#),
        CSS_DPI,
    );
    assert!(
        doubled.iter().all(|&size| size == (600, 300)),
        "{doubled:?}"
    );

    // Una rotazione non ingrandisce.
    let turned = painted(
        &shadowed(400.0, r#"<g transform="rotate(90 200 200)">{}</g>"#),
        CSS_DPI,
    );
    assert!(turned.iter().all(|&size| size == (300, 150)), "{turned:?}");

    // Le annotazioni di un PDF sono in punti: 72 per pollice.
    let svg =
        shadowed(400.0, "{}").replace(r#"width="96" height="48""#, r#"width="72" height="36""#);
    let points = painted(&svg, 72.0);
    assert!(points.iter().all(|&size| size == (300, 150)), "{points:?}");
}

#[test]
fn blending_stays_vector_in_the_pdf() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g style="isolation: isolate"><rect width="60" height="60" fill="#56b4e9"/><circle cx="60" cy="60" r="30" fill="#e69f00" style="mix-blend-mode: multiply"/></g></svg>"##;
    let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
    let (chunk, _) = svg2pdf::to_chunk(&tree, pdf::options(&tree, CSS_DPI)).unwrap();
    let text = String::from_utf8_lossy(chunk.as_bytes());
    assert!(text.contains("/BM /Multiply"), "{text}");
    // Nessuna immagine: la fusione non si dipinge.
    assert!(!text.contains("/Subtype /Image"), "{text}");
}

#[test]
fn a_huge_effect_lowers_the_resolution_and_the_export_still_happens() {
    let options = |svg: &str| {
        let tree = Tree::from_str(svg, &usvg::Options::default()).unwrap();
        pdf::options(&tree, CSS_DPI).raster_scale
    };
    // Senza effetti la scala non conta, e resta quella dei 300 dpi.
    let none = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>"#;
    assert_eq!(options(none), 300.0 / 96.0);
    // Una regione di 20 000 × 20 000 unità avrebbe 3,9 miliardi di
    // pixel: si dipinge con 4096 × 4096.
    let huge = shadowed(20_000.0, "{}").replace(
        r#"width="96" height="48""#,
        r#"width="20000" height="20000""#,
    );
    let scale = options(&huge);
    assert!((20_000.0 * scale - 4096.0).abs() < 0.01, "{scale}");
}
