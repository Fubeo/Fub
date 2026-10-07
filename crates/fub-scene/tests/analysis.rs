//! Ciò che l'indice legge di una scena (§9): titolo, descrizione, testi,
//! collegamenti, immagini del vault e il riepilogo `fub.scene.summary`.

mod common;

use common::{doc, load, text, HEAD};
use fub_scene::{BBox, Counts, InkTotals, Summary};

/// I testi dell'indice.
fn texts(source: &str) -> Vec<String> {
    load(source)
        .index
        .texts
        .iter()
        .map(|t| t.text.clone())
        .collect()
}

/// Il rettangolo del riepilogo come `[x, y, larghezza, altezza]`.
fn bbox(body: &str) -> Option<[f64; 4]> {
    let scene = load(&doc(body));
    scene.summary.bbox.map(
        |BBox {
             x,
             y,
             width,
             height,
         }| [x, y, width, height],
    )
}

#[test]
fn title_and_desc_are_the_first_of_the_root() {
    let source = doc(concat!(
        "<title>\n  Ciclo  dell'acqua\n</title>",
        "<desc>Dal mare <![CDATA[alle <nuvole>]]> &amp; ritorno</desc>",
        "<title>Secondo</title>",
        r#"<g fub:layer="A"><title>Del livello</title><desc>no</desc></g>"#,
    ));
    let scene = load(&source);
    let title = scene.index.title.as_ref().unwrap();
    // Gli spazi come li disegna SVG.
    assert_eq!(title.text, "Ciclo dell'acqua");
    assert!(text(&source, &title.span).starts_with("<title>\n"));
    let desc = scene.index.desc.as_ref().unwrap();
    assert_eq!(desc.text, "Dal mare alle <nuvole> & ritorno");
    // Senza titolo, o con un titolo vuoto, l'indice non ne ha.
    assert!(load(&doc("<rect/>")).index.title.is_none());
    assert!(load(&doc("<title> </title>")).index.title.is_none());
}

#[test]
fn entities_that_are_plain_text_are_read() {
    let source = format!(
        "<!DOCTYPE svg [<!ENTITY nome \"Giardino\"><!ENTITY marca \"<b/>\">]>{}",
        doc("<title>&nome; &marca;fine</title>")
    );
    let scene = load(&source);
    // Un'entità con marcatura non si espande: non è testo.
    assert_eq!(scene.index.title.as_ref().unwrap().text, "Giardino fine");
}

#[test]
fn every_text_is_a_paragraph_with_its_lines_joined() {
    let source = doc(concat!(
        // Un testo di FubDraw: una riga per `tspan`.
        r#"<g fub:layer="A"><text x="10" y="20">"#,
        r#"<tspan x="10" dy="0">Evaporazione</tspan>"#,
        r#"<tspan x="10" dy="20">e  condensa</tspan>"#,
        // I pezzi di una riga sono parte della parola.
        r#"<tspan x="10" dy="20">e <tspan font-weight="bold">piog</tspan>gia</tspan></text></g>"#,
        // Un testo estraneo, col suo `title` che non si disegna.
        r#"<text style="fill:red"><title>suggerimento</title>Pioggia <tspan>fitta</tspan></text>"#,
        // Un testo vuoto non conta.
        r#"<text x="0" y="0"> </text>"#,
        // Un `text` dentro un altro non si disegna.
        r#"<text>fuori<text>dentro</text></text>"#,
        // Un collegamento dentro un testo è parte del paragrafo.
        r#"<text>vedi <a href="nota.md">la nota</a></text>"#,
    ));
    assert_eq!(
        texts(&source),
        [
            "Evaporazione e condensa e pioggia",
            "Pioggia fitta",
            "fuori",
            "vedi la nota"
        ]
    );
    let scene = load(&source);
    assert!(text(&source, &scene.index.texts[0].span).starts_with("<text x=\"10\""));
}

#[test]
fn links_point_into_the_vault() {
    let source = doc(concat!(
        r#"<a href="note/acqua.md"><circle r="1"/></a>"#,
        r#"<a xlink:href="/radice.md"><rect/></a>"#,
        // `href` vince su `xlink:href`, come in SVG 2.
        r#"<a href="vince.md" xlink:href="perde.md"/>"#,
        // Un valore con un'entità: lo span è quello grezzo.
        r#"<a href=" a&amp;b.md "/>"#,
        // Un `a` estraneo conta lo stesso: il backlink vale per il file.
        r#"<a href="estraneo.md" target="_blank"/>"#,
        // Né siti, né frammenti, né altri schemi, né valori vuoti.
        r##"<a href="https://example.org"/><a href="#sopra"/><a href="mailto:x@y"/><a href=""/>"##,
    ));
    let scene = load(&source);
    let links: Vec<_> = scene
        .index
        .links
        .iter()
        .map(|l| (l.path.as_str(), text(&source, &l.href)))
        .collect();
    assert_eq!(
        links,
        [
            ("note/acqua.md", "note/acqua.md"),
            ("/radice.md", "/radice.md"),
            ("vince.md", "vince.md"),
            ("a&b.md", " a&amp;b.md "),
            ("estraneo.md", "estraneo.md"),
        ]
    );
    assert!(text(&source, &scene.index.links[0].span).starts_with("<a href="));
    assert!(text(&source, &scene.index.links[0].span).ends_with("</a>"));
}

#[test]
fn an_xlink_href_with_the_same_url_is_shadowed_by_href() {
    let source = doc(concat!(
        // Lo stesso URL scritto due volte, come fa chi esporta per SVG 1.1:
        // quel lettore legge `xlink:href`, e una rinomina li riscrive insieme.
        r#"<a href="nota.md" xlink:href=" nota.md&#10;"/>"#,
        r#"<image xlink:href="foto.png" href="foto.png" width="1" height="1"/>"#,
        // Un URL diverso è nascosto e basta: non è un riferimento.
        r#"<a href="vince.md" xlink:href="perde.md"/>"#,
        // Solo `xlink:href`: è lui il riferimento, e non nasconde niente.
        r#"<a xlink:href="solo.md"/>"#,
    ));
    let scene = load(&source);
    let shadowed = |reference: &fub_scene::Reference| {
        reference
            .shadowed
            .map(|span| text(&source, &span).to_owned())
    };
    let links: Vec<_> = scene.index.links.iter().map(shadowed).collect();
    assert_eq!(links, [Some(" nota.md&#10;".to_owned()), None, None]);
    assert_eq!(
        shadowed(&scene.index.embeds[0]).as_deref(),
        Some("foto.png")
    );
    // Nella scena serializzata non c'è: la superficie non riscrive link.
    let json = serde_json::to_value(&scene.index.links[0]).unwrap();
    assert!(json.get("shadowed").is_none(), "{json}");
}

#[test]
fn vault_images_are_embeds_and_data_images_are_only_counted() {
    let source = doc(concat!(
        r#"<image href="foto/mare.png" width="10" height="10"/>"#,
        r#"<image xlink:href="../schizzo.webp" width="10" height="10"/>"#,
        r#"<image href="data:image/png;base64,AAAA" width="10" height="10"/>"#,
        r#"<image href="https://example.org/a.png" width="10" height="10"/>"#,
    ));
    let scene = load(&source);
    let embeds: Vec<_> = scene.index.embeds.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(embeds, ["foto/mare.png", "../schizzo.webp"]);
    assert_eq!(scene.summary.counts.images, 4);
}

#[test]
fn the_summary_counts_the_editable_scene() {
    let source = doc(concat!(
        "<title>Riepilogo</title>",
        r##"<rect id="fub-paper" fub:role="paper" width="1600" height="1000" fill="#ffffff"/>"##,
        r#"<g fub:layer="Schizzo">"#,
        r##"<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s100 cxypt 0,0,0,0 1,1,1,250 1,1,1,250" d="M0 0 L1 1 Z" fill="#000000"/>"##,
        r##"<path fub:tool="highlighter" fub:brush="pf1" fub:ink="1 s10 cxyt 0,0,0 1,1,40" d="M0 0 L1 1 Z" fill="#f0e442"/>"##,
        // Un tratto che non si legge conta, ma non il suo inchiostro.
        r##"<path fub:tool="pen" fub:brush="pf1" fub:ink="rotto" d="" fill="#000000"/>"##,
        "</g>",
        r#"<g fub:layer="Forme"><rect width="1" height="1"/><ellipse rx="1" ry="1"/>"#,
        r#"<path fub:shape="arrow" fub:geom="0 0 1 1" d="M0 0 L1 1"/><line/><polygon points="0 0 1 1"/>"#,
        r#"<text x="0" y="0"><tspan x="0" dy="0">a</tspan></text>"#,
        r#"<a href="nota.md"><image width="1" height="1" href="foto.png"/></a>"#,
        "<use/></g>",
        "<!-- fine -->",
    ));
    let scene = load(&source);
    assert_eq!(
        scene.summary,
        Summary {
            version: Some(1),
            foreign: false,
            truncated: false,
            layers: vec!["Schizzo".to_owned(), "Forme".to_owned()],
            counts: Counts {
                strokes: 3,
                shapes: 5,
                texts: 1,
                images: 1,
                links: 1,
                foreign: 2,
            },
            ink: InkTotals {
                samples: 5,
                duration: 540,
            },
            // L'ellisse di raggio 1 intorno all'origine; la carta no.
            bbox: Some(BBox {
                x: -1.0,
                y: -1.0,
                width: 2.0,
                height: 2.0,
            }),
        }
    );
    // Un documento estraneo non ha versione.
    let foreign = load(r#"<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>"#);
    assert_eq!(foreign.summary.version, None);
    assert!(foreign.summary.foreign);
}

#[test]
fn the_bbox_follows_transforms_and_curve_extrema() {
    // Le curve contano per i loro estremi, non per i punti di controllo.
    assert_eq!(
        bbox(r#"<path d="M0 0 Q50 100 100 0"/>"#),
        Some([0.0, 0.0, 100.0, 50.0])
    );
    assert_eq!(
        bbox(r#"<path d="M0 0 C0 100 100 100 100 0"/>"#),
        Some([0.0, 0.0, 100.0, 75.0])
    );
    // Un quadrato ruotato di 45° dentro un livello spostato: i bordi si
    // arrotondano ai centesimi, e la larghezza è la differenza dei bordi.
    assert_eq!(
        bbox(concat!(
            r#"<g fub:layer="A" transform="translate(100 0)">"#,
            r#"<rect width="10" height="10" transform="rotate(45)"/></g>"#
        )),
        Some([92.93, 0.0, 14.14, 14.14])
    );
    // Un'ellisse ruotata di 90° scambia gli assi.
    assert_eq!(
        bbox(r#"<ellipse cx="0" cy="0" rx="20" ry="10" transform="rotate(90)"/>"#),
        Some([-10.0, -20.0, 20.0, 40.0])
    );
    // In SVG 2 un raggio assente vale l'altro.
    assert_eq!(bbox(r#"<ellipse rx="5"/>"#), Some([-5.0, -5.0, 10.0, 10.0]));
    // Le unità assolute si convertono: 1in = 96 unità.
    assert_eq!(
        bbox(r#"<line x1="0" y1="0" x2="1in" y2="2.54cm"/>"#),
        Some([0.0, 0.0, 96.0, 96.0])
    );
    // Di un testo contano i punti d'inizio delle righe.
    assert_eq!(
        bbox(concat!(
            r#"<text x="10" y="20"><tspan x="10" dy="0">a</tspan>"#,
            r#"<tspan x="30" dy="15">b</tspan></text>"#
        )),
        Some([10.0, 20.0, 20.0, 15.0])
    );
}

#[test]
fn the_bbox_ignores_paper_foreign_and_hidden_content() {
    let body = concat!(
        r#"<rect fub:role="paper" width="1600" height="1000"/>"#,
        r#"<rect x="10" y="10" width="5" height="5"/>"#,
        r#"<g fub:layer="Nascosto" display="none"><rect x="500" width="5" height="5"/></g>"#,
        r#"<rect x="-500" width="5" height="5" display="none"/>"#,
        r#"<use x="900"/><rect x="900" width="1" height="1" style="x"/>"#,
    );
    assert_eq!(bbox(body), Some([10.0, 10.0, 5.0, 5.0]));
    // Senza niente di visibile il rettangolo non c'è.
    assert_eq!(
        bbox(r#"<rect fub:role="paper" width="10" height="10"/><title>t</title>"#),
        None
    );
    assert_eq!(bbox(r#"<path d=""/>"#), None);
}

#[test]
fn a_truncated_file_is_summarized_from_its_head() {
    let head = doc("<title>Grande</title><desc>d</desc><g fub:layer=\"Uno\">");
    let head = head.strip_suffix("</svg>").unwrap();
    let filler = "<!-- riempitivo -->".repeat(fub_scene::MAX_EDIT_BYTES / 19 + 1);
    let source = format!("{head}{filler}</g></svg>");
    let scene = load(&source);
    assert!(scene.truncated);
    assert_eq!(scene.index.title.as_ref().unwrap().text, "Grande");
    assert_eq!(scene.index.desc.as_ref().unwrap().text, "d");
    assert_eq!(
        scene.summary,
        Summary {
            version: Some(1),
            foreign: false,
            truncated: true,
            layers: Vec::new(),
            counts: Counts::default(),
            ink: InkTotals::default(),
            bbox: None,
        }
    );
}

#[test]
fn a_document_with_too_many_elements_is_still_summarized() {
    let source = doc(&r#"<rect width="1" height="1"/>"#.repeat(fub_scene::MAX_ELEMENTS));
    let scene = load(&source);
    assert!(scene.items.is_empty());
    assert_eq!(scene.summary.counts.shapes, fub_scene::MAX_ELEMENTS);
    assert_eq!(scene.summary.bbox.unwrap().width, 1.0);
    // La radice è ancora quella di sempre.
    assert!(source.starts_with(HEAD));
}
