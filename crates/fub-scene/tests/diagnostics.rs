//! La diagnostica di §12: per ogni codice un caso che la produce e uno che
//! non la produce, con la gravità della tabella.

mod common;

use common::{doc, load, text};
use fub_scene::{read, Code, Diagnostic, Scene, Severity, MAX_IMAGE_BYTES};

/// Le diagnostiche di `scene` con il codice `code`.
fn of(scene: &Scene, code: Code) -> Vec<&Diagnostic> {
    scene
        .diagnostics
        .iter()
        .filter(|d| d.code == code)
        .collect()
}

/// I dettagli delle diagnostiche con il codice `code`.
fn details(scene: &Scene, code: Code) -> Vec<&str> {
    of(scene, code)
        .iter()
        .map(|d| d.detail.as_deref().unwrap_or_default())
        .collect()
}

/// Un documento FubDraw col titolo, così S001 non c'entra.
fn titled(body: &str) -> String {
    doc(&format!("<title>Prova</title>{body}"))
}

#[test]
fn s001_a_drawing_without_a_title() {
    // Senza `title`, con un titolo vuoto o di soli spazi e commenti, con il
    // titolo di un gruppo invece che della radice, o di un altro namespace.
    for (body, on_title) in [
        ("<rect/>", false),
        ("<title/>", true),
        ("<title> \n\t</title>", true),
        ("<title><!-- da scrivere --></title>", true),
        (r#"<g fub:layer="A"><title>Livello</title></g>"#, false),
        (
            r#"<x:title xmlns:x="https://example.org">Altro</x:title>"#,
            false,
        ),
    ] {
        let source = doc(body);
        let scene = load(&source);
        let found = of(&scene, Code::S001);
        assert_eq!(found.len(), 1, "{body}");
        assert_eq!(found[0].severity, Severity::Warning);
        match found[0].span {
            Some(span) => {
                assert!(on_title, "{body}");
                assert!(text(&source, &span).starts_with("<title"));
            }
            None => assert!(!on_title, "{body}"),
        }
    }
    // Un titolo con del testo, anche in CDATA o con un'entità, e anche dopo
    // altri figli della radice.
    for body in [
        "<title>Ciclo dell'acqua</title>",
        "<title><![CDATA[Acqua]]></title>",
        "<title>&amp;</title>",
        "<desc>prima</desc><rect/><title>Dopo</title>",
    ] {
        assert!(of(&load(&doc(body)), Code::S001).is_empty(), "{body}");
    }
}

#[test]
fn s002_foreign_blocks() {
    let source = titled("<rect/><use href=\"#a\"/><!-- nota -->");
    let scene = load(&source);
    let found = of(&scene, Code::S002);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Info);
    assert_eq!(
        text(&source, &found[0].span.unwrap()),
        "<use href=\"#a\"/><!-- nota -->"
    );
    assert!(of(&load(&titled("<rect/>")), Code::S002).is_empty());
}

#[test]
fn s003_duplicate_ids() {
    let scene = load(&titled(r#"<rect id="a"/><circle id="a"/>"#));
    let found = of(&scene, Code::S003);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Error);
    assert_eq!(found[0].detail.as_deref(), Some("a"));
    assert!(!scene.editable());
    // Id diversi, o vuoti, non sono duplicati.
    let scene = load(&titled(
        r#"<rect id="a"/><circle id="b"/><use id=""/><use id=""/>"#,
    ));
    assert!(of(&scene, Code::S003).is_empty());
}

#[test]
fn s004_ink_or_brush_that_do_not_read() {
    let stroke = |ink: &str| {
        titled(&format!(
            r##"<path fub:tool="pen" fub:brush="pf1" fub:ink="{ink}" d="" fill="#000000"/>"##
        ))
    };
    let scene = load(&stroke("1 s100 cxy 0,0 1"));
    let found = of(&scene, Code::S004);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Error);
    assert_eq!(found[0].detail.as_deref(), Some("fub:ink arity 1"));
    assert!(scene.editable());
    assert!(of(&load(&stroke("1 s100 cxy 0,0 1,1")), Code::S004).is_empty());
}

#[test]
fn s005_active_content() {
    let source = titled(concat!(
        r#"<script>alert(1)</script>"#,
        r#"<rect onclick="alert(1)" width="1" height="1"/>"#,
        r#"<a href=" JavaScript:alert(1)"><circle r="1"/></a>"#,
        r#"<image xlink:href="java&#9;script:x"/>"#,
        r#"<a href="note.md"><set attributeName="href" to="javascript:alert(1)"/></a>"#,
        r#"<animate attributeName="xlink:href" values="a.md;javascript:x"/>"#,
        r#"<foreignObject><p xmlns="http://www.w3.org/1999/xhtml" onmouseover="x()">"#,
        r#"<script>x()</script></p></foreignObject>"#,
    ));
    let source = source.replace("<svg ", "<svg onload=\"init()\" ");
    let scene = load(&source);
    assert_eq!(
        details(&scene, Code::S005),
        [
            "onload",
            "script",
            "onclick",
            "href",
            "xlink:href",
            "to",
            "values",
            "onmouseover",
            "script"
        ]
    );
    let found = of(&scene, Code::S005);
    assert!(found.iter().all(|d| d.severity == Severity::Warning));
    assert!(text(&source, &found[1].span.unwrap()).starts_with("<script>"));
    // Né un percorso che somiglia allo schema, né un attributo di un altro
    // namespace, né uno `script` che non è HTML o SVG, né un'animazione di
    // un altro attributo, né il testo di un `text`.
    let scene = load(&titled(concat!(
        r#"<a href="javascript.md"><rect fub:onclick="x" width="1" height="1"/></a>"#,
        r#"<x:script xmlns:x="https://example.org">x()</x:script>"#,
        r#"<set attributeName="fill" to="javascript:x"/>"#,
        r#"<text x="0" y="0"><tspan x="0" dy="0">javascript:alert(1)</tspan></text>"#,
    )));
    assert!(of(&scene, Code::S005).is_empty());
}

#[test]
fn s006_an_embedded_image_over_the_limit() {
    // Ogni quattro simboli base64 sono tre byte: `n` simboli più un `=`
    // valgono `n · 3 / 4` byte, arrotondati per difetto.
    let image = |symbols: usize| {
        titled(&format!(
            r#"<image width="1" height="1" href="data:image/png;base64,{}="/>"#,
            "A".repeat(symbols)
        ))
    };
    let at_limit = MAX_IMAGE_BYTES * 4 / 3 + 1;
    assert_eq!(at_limit * 3 / 4, MAX_IMAGE_BYTES);
    assert!(of(&load(&image(at_limit)), Code::S006).is_empty());
    let scene = load(&image(at_limit + 4));
    let found = of(&scene, Code::S006);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Warning);
    assert_eq!(
        found[0].detail.as_deref(),
        Some((MAX_IMAGE_BYTES + 3).to_string().as_str())
    );
    // Un'immagine del vault non è incorporata.
    let scene = load(&titled(r#"<image width="1" height="1" href="foto.png"/>"#));
    assert!(of(&scene, Code::S006).is_empty());
}

#[test]
fn s007_a_newer_format() {
    let newer = titled("").replace("fub:version=\"1\"", "fub:version=\"2\"");
    let scene = load(&newer);
    let found = of(&scene, Code::S007);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Info);
    assert!(!scene.editable());
    assert!(of(&load(&titled("")), Code::S007).is_empty());
}

#[test]
fn s008_a_doctype() {
    let source = format!("<!DOCTYPE svg>{}", titled(""));
    let scene = load(&source);
    let found = of(&scene, Code::S008);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Info);
    assert_eq!(text(&source, &found[0].span.unwrap()), "<!DOCTYPE svg>");
    assert!(of(&load(&titled("")), Code::S008).is_empty());
}

/// Una scena con la carta di colore `paper` e `body` nel livello.
fn on_paper(paper: &str, body: &str) -> Scene {
    load(&titled(&format!(
        r#"<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="{paper}"/><g fub:layer="A">{body}</g>"#
    )))
}

/// Un tratto con lo strumento e gli attributi dati.
fn stroke(tool: &str, attributes: &str) -> String {
    format!(
        r#"<path fub:tool="{tool}" fub:brush="pf1" fub:ink="1 s10 cxy 0,0" d="M0 0 L1 1 L0 1 Z" {attributes}/>"#
    )
}

#[test]
fn s009_a_pen_stroke_that_fades_into_the_paper() {
    // I tre colori chiari della tavolozza sotto 3:1 sulla carta bianca, il
    // nero quasi trasparente, un'opacità di gruppo, un colore ereditato dal
    // livello e un tratto nero sulla carta nera.
    for (paper, body, detail) in [
        ("#ffffff", stroke("pen", r##"fill="#f0e442""##), "1.32"),
        ("#ffffff", stroke("pen", r##"fill="#e69f00""##), "2.25"),
        ("#ffffff", stroke("pen", r##"fill="#56b4e9""##), "2.30"),
        (
            "#ffffff",
            stroke("pen", r##"fill="#000000" fill-opacity="0.1""##),
            "1.24",
        ),
        (
            "#ffffff",
            format!(r#"<g opacity="0.2">{}</g>"#, stroke("pen", "")),
            "1.60",
        ),
        (
            "#ffffff",
            format!(r#"<g fill="yellow">{}</g>"#, stroke("pen", "")),
            "1.07",
        ),
        ("#000000", stroke("pen", ""), "1.00"),
    ] {
        let scene = on_paper(paper, &body);
        let found = of(&scene, Code::S009);
        assert_eq!(found.len(), 1, "{body}");
        assert_eq!(found[0].severity, Severity::Info);
        assert_eq!(found[0].detail.as_deref(), Some(detail), "{body}");
    }
    // I colori scuri della tavolozza, il bianco sulla carta nera,
    // l'evidenziatore giallo, una forma gialla e un tratto senza
    // riempimento: niente S009.
    for (paper, body) in [
        ("#ffffff", stroke("pen", r##"fill="#0072b2""##)),
        ("#ffffff", stroke("pen", r##"fill="#cc79a7""##)),
        ("#ffffff", stroke("pen", "")),
        ("#000000", stroke("pen", r##"fill="#ffffff""##)),
        (
            "#ffffff",
            stroke("highlighter", r##"fill="#f0e442" fill-opacity="0.4""##),
        ),
        (
            "#ffffff",
            r##"<rect width="10" height="10" fill="#f0e442"/>"##.to_owned(),
        ),
        ("#ffffff", stroke("pen", r#"fill="none""#)),
    ] {
        assert!(of(&on_paper(paper, &body), Code::S009).is_empty(), "{body}");
    }
    // Senza carta il tratto sta sul bianco.
    let scene = load(&titled(&stroke("pen", r##"fill="#f0e442""##)));
    assert_eq!(details(&scene, Code::S009), ["1.32"]);
}

/// Un testo di una riga, con gli attributi dati sul `text`.
fn label(attributes: &str, line: &str) -> String {
    format!(r#"<text x="20" y="50" {attributes}><tspan x="20" dy="0">{line}</tspan></text>"#)
}

#[test]
fn s009_a_text_that_fades_into_what_lies_under_it() {
    // Un testo normale vuole 4,5:1: il verde della tavolozza ne ha 3,42
    // sul bianco, il nero sul blu 4,04. Il fondo è la carta con sopra le
    // forme piene che coprono l'inizio della riga, composte con le loro
    // opacità, e un testo bianco sul bianco non si legge.
    let black_box = r##"<rect x="0" y="0" width="100" height="100" fill="#000000"/>"##;
    let blue_box = r##"<rect x="0" y="0" width="100" height="100" fill="#0072b2"/>"##;
    for (body, detail) in [
        (label(r##"fill="#f0e442""##, "Sole"), "1.32"),
        (label(r##"fill="#009e73""##, "Prato"), "3.42"),
        (format!("{blue_box}{}", label("", "Mare")), "4.04"),
        (label(r##"fill="#ffffff""##, "Neve"), "1.00"),
        // Un rettangolo nero a metà: il fondo è grigio, e il bianco ci sta
        // sotto 4,5:1.
        (
            format!(
                r##"<rect width="100" height="100" fill="#000000" opacity="0.5"/>{}"##,
                label(r##"fill="#ffffff""##, "Nebbia")
            ),
            "3.94",
        ),
        // Una forma dipinta dopo il testo gli sta sopra, non sotto.
        (
            format!("{}{black_box}", label(r##"fill="#ffffff""##, "Sotto")),
            "1.00",
        ),
        // Il colore di una riga vince su quello del testo; conta la riga
        // peggiore.
        (
            r##"<text x="20" y="50"><tspan x="20" dy="0">Uno</tspan><tspan x="20" dy="20" fill="#f0e442">Due</tspan></text>"##
                .to_owned(),
            "1.32",
        ),
        // Così un pezzo della riga col suo colore; uno vuoto non si legge.
        (
            r##"<text x="20" y="50"><tspan x="20" dy="0">Uno <tspan fill="#f0e442">due</tspan><tspan fill="#ffffff"> </tspan></tspan></text>"##
                .to_owned(),
            "1.32",
        ),
        // Il verde vuole 4,5:1 nel pezzo piccolo, anche se la riga è grande.
        (
            r##"<text x="20" y="50" fill="#009e73"><tspan x="20" dy="0" font-size="30">Grande <tspan font-size="12">piccolo</tspan></tspan></text>"##
                .to_owned(),
            "3.42",
        ),
        // Fuori dall'ellisse, anche se dentro il suo rettangolo.
        (
            format!(
                r##"<ellipse cx="60" cy="60" rx="60" ry="60" fill="#000000"/>{}"##,
                r##"<text x="5" y="10" fill="#ffffff"><tspan x="5" dy="0">Angolo</tspan></text>"##
            ),
            "1.00",
        ),
    ] {
        let scene = on_paper("#ffffff", &body);
        let found = of(&scene, Code::S009);
        assert_eq!(found.len(), 1, "{body}");
        assert_eq!(found[0].severity, Severity::Info);
        assert_eq!(found[0].detail.as_deref(), Some(detail), "{body}");
    }
    for body in [
        // Il nero sul bianco, il blu della tavolozza (5,19:1), il bianco
        // sul nero di un rettangolo, di un'ellisse, di un poligono, di un
        // tracciato con le curve e di un rettangolo arrotondato.
        label("", "Nero"),
        label(r##"fill="#0072b2""##, "Blu"),
        format!("{black_box}{}", label(r##"fill="#ffffff""##, "Notte")),
        format!(
            r##"<ellipse cx="50" cy="50" rx="45" ry="30" fill="#000000"/>{}"##,
            label(r##"fill="#ffffff""##, "Uovo")
        ),
        r##"<polygon points="0 0 100 0 100 100" fill="#000000"/><text x="80" y="40" fill="#ffffff"><tspan x="80" dy="0">Vela</tspan></text>"##
            .to_owned(),
        format!(
            r##"<path d="M0 0 C50 -20 150 20 100 0 Q120 50 100 100 A50 50 0 0 1 0 100 Z" fill="#000000"/>{}"##,
            label(r##"fill="#ffffff""##, "Onda")
        ),
        format!(
            r##"<rect width="100" height="100" rx="30" fill="#000000"/>{}"##,
            label(r##"fill="#ffffff""##, "Tondo")
        ),
        // Un testo grande vuole 3:1: 24 px, 19 px in grassetto, 12 px in un
        // gruppo che raddoppia.
        label(r##"fill="#009e73" font-size="24""##, "Titolo"),
        label(r##"fill="#009e73" font-size="19" font-weight="bold""##, "Forte"),
        format!(
            r#"<g transform="scale(2)" font-size="12">{}</g>"#,
            label(r##"fill="#009e73""##, "Grande")
        ),
        // Sopra un'immagine il fondo non si sa, finché una forma opaca non la
        // copre.
        format!(
            r#"<image x="0" y="0" width="100" height="100" href="foto.png" aria-hidden="true"/>{}"#,
            label(r##"fill="#ffffff""##, "Foto")
        ),
        // Nascosto, senza riempimento, o di righe vuote: non si legge.
        label(r##"fill="#ffffff" display="none""##, "Via"),
        label(r#"fill="none""#, "Vuoto"),
        label(r##"fill="#ffffff""##, " "),
        // Un pezzo grande, o in grassetto e abbastanza grande, vuole 3:1.
        label(
            "",
            r##"Nero <tspan fill="#009e73" font-size="24">titolo</tspan><tspan fill="#009e73" font-size="19" font-weight="bold">forte</tspan>"##,
        ),
        // Un pezzo nascosto o senza riempimento non si legge.
        label(
            "",
            r##"Nero <tspan fill="#ffffff" display="none">via</tspan><tspan fill="none">vuoto</tspan>"##,
        ),
    ] {
        assert!(of(&on_paper("#ffffff", &body), Code::S009).is_empty(), "{body}");
    }
    // Un'immagine coperta da una forma opaca: il fondo torna a sapersi.
    let scene = on_paper(
        "#ffffff",
        &format!(
            r#"<image x="0" y="0" width="100" height="100" href="foto.png" aria-hidden="true"/>{black_box}{}"#,
            label(r##"fill="#000000""##, "Buio")
        ),
    );
    assert_eq!(details(&scene, Code::S009), ["1.00"]);
    // Il grassetto a 18 px non è ancora grande.
    let scene = on_paper(
        "#ffffff",
        &label(
            r##"fill="#009e73" font-size="18" font-weight="700""##,
            "Quasi",
        ),
    );
    assert_eq!(details(&scene, Code::S009), ["3.42"]);
}

#[test]
fn s009_and_s013_a_text_on_a_path_is_seen_where_it_starts_on_the_side_of_the_glyphs() {
    // Il tracciato va da sinistra a destra a metà altezza, o al contrario; il
    // rettangolo nero copre la metà di sopra.
    let scene = |d: &str, attributes: &str, offset: &str| {
        load(&titled(&format!(
            concat!(
                r##"<defs><path id="r1" d="{}"/></defs><rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>"##,
                r##"<g fub:layer="A"><rect width="100" height="50" fill="#000000"/>"##,
                r##"<text {}><textPath href="#r1" startOffset="{}">Onda</textPath></text></g>"##,
            ),
            d, attributes, offset
        )))
    };
    let right = "M0 50 L100 50";
    let left = "M100 50 L0 50";
    let white = r##"fill="#ffffff""##;
    let black = r##"fill="#000000""##;
    assert!(details(&scene(right, white, "50%"), Code::S009).is_empty());
    assert_eq!(details(&scene(left, white, "50%"), Code::S009), ["1.00"]);
    assert!(details(&scene(left, black, "50%"), Code::S009).is_empty());
    assert_eq!(details(&scene(right, black, "50%"), Code::S009), ["1.00"]);
    // Una curva: a metà va verso destra, e il punto sta sopra.
    assert!(details(&scene("M0 60 Q50 40 100 60", white, "50%"), Code::S009).is_empty());
    // Oltre la fine si ferma all'estremo; un tracciato lungo zero non si
    // guarda.
    assert!(details(&scene("M0 50 L60 50", white, "500"), Code::S009).is_empty());
    assert_eq!(
        details(&scene("M0 50 L60 50 L60 100", white, "500"), Code::S009),
        ["1.00"]
    );
    assert!(details(&scene("M50 50 L50 50", white, "50%"), Code::S009).is_empty());
    // Il corpo conta come per le righe.
    let small = r##"fill="#ffffff" font-size="9""##;
    assert_eq!(details(&scene(right, small, "50%"), Code::S013), ["9.00"]);
    let enough = r##"fill="#ffffff" font-size="12""##;
    assert!(details(&scene(right, enough, "50%"), Code::S013).is_empty());
}

#[test]
fn s009_a_pen_stroke_is_measured_on_what_lies_under_it() {
    // Il bianco su un rettangolo nero si legge; a cavallo del bordo conta il
    // contrasto mediano, quello della parte più lunga.
    let pen = |d: &str| {
        format!(
            r##"<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s10 cxy 0,0" d="{d}" fill="#ffffff"/>"##
        )
    };
    let black_box = r##"<rect x="0" y="0" width="50" height="100" fill="#000000"/>"##;
    let inside = pen("M10 10 L20 20 L10 20 Z");
    assert!(of(
        &on_paper("#ffffff", &format!("{black_box}{inside}")),
        Code::S009
    )
    .is_empty());
    // Tre vertici su cinque fuori dal rettangolo: la mediana sta sul bianco.
    let across = pen("M40 10 L60 10 L70 20 L80 30 L40 30 Z");
    let scene = on_paper("#ffffff", &format!("{black_box}{across}"));
    assert_eq!(details(&scene, Code::S009), ["1.00"]);
    // Tre su cinque dentro: la mediana sta sul nero.
    let mostly = pen("M10 10 L20 10 L30 20 L80 30 L60 30 Z");
    assert!(of(
        &on_paper("#ffffff", &format!("{black_box}{mostly}")),
        Code::S009
    )
    .is_empty());
    // Un tratto senza geometria non si vede, e non si misura.
    assert!(of(&on_paper("#ffffff", &pen("")), Code::S009).is_empty());
}

#[test]
fn s012_an_image_without_a_description() {
    let image = |attributes: &str, children: &str| {
        let tag = r#"<image x="0" y="0" width="10" height="10" href="foto.png""#;
        if children.is_empty() {
            titled(&format!("{tag} {attributes}/>"))
        } else {
            titled(&format!("{tag} {attributes}>{children}</image>"))
        }
    };
    for source in [
        image("", ""),
        image("", "<title> </title>"),
        image(r#"aria-hidden="false""#, ""),
        // Anche un'immagine incorporata.
        titled(r#"<image width="1" height="1" href="data:image/png;base64,iVBORw0KGgo="/>"#),
    ] {
        let scene = load(&source);
        let found = of(&scene, Code::S012);
        assert_eq!(found.len(), 1, "{source}");
        assert_eq!(found[0].severity, Severity::Warning);
        let span = found[0].span.expect("S012 riguarda l'immagine");
        assert!(text(&source, &span).starts_with("<image"), "{source}");
    }
    for source in [
        image("", "<title>Il porto</title>"),
        image("", "<desc>Barche ormeggiate al tramonto</desc>"),
        image(r#"aria-hidden="true""#, ""),
        image(r#"display="none""#, ""),
    ] {
        assert!(of(&load(&source), Code::S012).is_empty(), "{source}");
    }
    // `aria-hidden` vale solo `true` o `false`: altrimenti l'immagine è
    // estranea, e la superficie non la descrive.
    let scene = load(&image(r#"aria-hidden="forse""#, ""));
    assert!(of(&scene, Code::S012).is_empty());
    assert_eq!(of(&scene, Code::S002).len(), 1);
}

#[test]
fn s013_a_text_too_small_at_full_size() {
    for (body, detail) in [
        (label(r#"font-size="11""#, "Nota"), "11.00"),
        (label(r#"font-size="8pt""#, "Punti"), "10.66"),
        (
            format!(r#"<g font-size="10">{}</g>"#, label("", "Eredita")),
            "10.00",
        ),
        (
            format!(
                r#"<g transform="scale(0.5)">{}</g>"#,
                label(r#"font-size="20""#, "Ridotto")
            ),
            "10.00",
        ),
        // Conta l'altezza: schiacciato in verticale si legge piccolo.
        (
            format!(
                r#"<g transform="scale(1 0.5)">{}</g>"#,
                label(r#"font-size="20""#, "Schiacciato")
            ),
            "10.00",
        ),
        // La riga più piccola.
        (
            r#"<text x="0" y="20"><tspan x="0" dy="0">Grande</tspan><tspan x="0" dy="20" font-size="9">piccolo</tspan></text>"#
                .to_owned(),
            "9.00",
        ),
        // E il pezzo più piccolo di una riga.
        (
            label(r#"font-size="20""#, r#"Grande <tspan font-size="10.5">piccolo</tspan>"#),
            "10.50",
        ),
    ] {
        let scene = load(&titled(&body));
        let found = of(&scene, Code::S013);
        assert_eq!(found.len(), 1, "{body}");
        assert_eq!(found[0].severity, Severity::Info);
        assert_eq!(found[0].detail.as_deref(), Some(detail), "{body}");
    }
    for body in [
        label(r#"font-size="12""#, "Giusto"),
        label("", "Di serie"),
        format!(
            r#"<g transform="rotate(90)">{}</g>"#,
            label(r#"font-size="16""#, "Ruotato")
        ),
        format!(
            r#"<g transform="scale(2)">{}</g>"#,
            label(r#"font-size="8""#, "Ingrandito")
        ),
        label(r#"font-size="9" display="none""#, "Nascosto"),
        label(r#"font-size="9""#, "  "),
        // Un pezzo piccolo nascosto o vuoto non conta.
        label(
            "",
            r#"Testo <tspan font-size="9" display="none">via</tspan><tspan font-size="9"> </tspan>"#,
        ),
    ] {
        assert!(of(&load(&titled(&body)), Code::S013).is_empty(), "{body}");
    }
    // Una grandezza della radice che §4 non legge non dice niente.
    let source = titled(&label("", "Em"))
        .replace("fub:version=\"1\"", "fub:version=\"1\" font-size=\"0.5em\"");
    assert!(of(&load(&source), Code::S013).is_empty());
}

#[test]
fn s010_unknown_ink_channels() {
    let ink = |channels: &str| {
        titled(&format!(
            r##"<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s10 c{channels} 0,0,0" d="" fill="#000000"/>"##
        ))
    };
    let scene = load(&ink("xyk"));
    let found = of(&scene, Code::S010);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].severity, Severity::Info);
    assert_eq!(found[0].detail.as_deref(), Some("k"));
    assert!(of(&load(&ink("xyp")), Code::S010).is_empty());
}

#[test]
fn s011_units_or_guides_out_of_grammar() {
    let root = |attributes: &str| {
        titled("").replace(
            "fub:version=\"1\"",
            &format!("fub:version=\"1\" {attributes}"),
        )
    };
    let scene = load(&root(r#"fub:guides="x 1;" fub:units="MM""#));
    let found = of(&scene, Code::S011);
    assert_eq!(found.len(), 2);
    assert!(found
        .iter()
        .all(|d| d.severity == Severity::Info && d.span.is_none()));
    // Prima l'unità, poi le guide, come in TypeScript.
    assert_eq!(details(&scene, Code::S011), ["fub:units", "fub:guides"]);
    // Il documento resta modificabile: si ignorano soltanto.
    assert!(scene.editable());
    for valid in [
        r#"fub:units="mm" fub:guides="x 1; y 2 locked""#,
        r#"fub:guides="""#,
        "",
    ] {
        assert!(of(&load(&root(valid)), Code::S011).is_empty(), "{valid}");
    }
}

#[test]
fn s014_a_local_reference_to_a_missing_id() {
    let source = titled(concat!(
        r##"<defs><linearGradient id="r1"/></defs>"##,
        r##"<rect fill="url(#r1)" stroke="url(#r2) #000000"/>"##,
        r##"<g filter="url(#r3)" style="fill: url(#r4); stroke: url('#r4')"><use href="#r5" xlink:href="#r5"/></g>"##,
        r##"<a href="#r6"><circle r="1" clip-path="url(#r7)" mask="url(#r7)"/></a>"##,
        r##"<rect fub:nota="url(#r8)"/>"##,
    ));
    let scene = load(&source);
    let found = of(&scene, Code::S014);
    assert!(found.iter().all(|d| d.severity == Severity::Warning));
    // Una per id e per attributo, in ordine di elemento e di attributo; un
    // `href` su un collegamento è un'ancora, e gli altri namespace non
    // rimandano a niente.
    assert_eq!(
        details(&scene, Code::S014),
        [
            "stroke #r2",
            "filter #r3",
            "style #r4",
            "href #r5",
            "xlink:href #r5",
            "clip-path #r7",
            "mask #r7"
        ]
    );
    let span = found[0].span.expect("S014 riguarda l'elemento");
    assert_eq!(
        text(&source, &span),
        r##"<rect fill="url(#r1)" stroke="url(#r2) #000000"/>"##
    );
    let span = found[4].span.expect("S014 riguarda l'elemento");
    assert!(text(&source, &span).starts_with("<use"));
    // Il documento resta modificabile: gli elementi col riferimento rotto
    // sono estranei.
    assert!(scene.editable());
    for body in [
        r##"<defs><linearGradient id="r1"/></defs><rect fill="url(#r1)"/>"##,
        r##"<rect id="r2" fill="url(#r2)"/>"##,
        r##"<a href="#sezione"></a>"##,
        r##"<image href="a.png#x"/>"##,
        r##"<rect fill="url(a.svg#r1)"/>"##,
    ] {
        assert!(of(&load(&titled(body)), Code::S014).is_empty(), "{body}");
    }
}

#[test]
fn every_code_has_its_severity_and_a_message() {
    use Code::*;
    for (code, severity) in [
        (S001, Severity::Warning),
        (S002, Severity::Info),
        (S003, Severity::Error),
        (S004, Severity::Error),
        (S005, Severity::Warning),
        (S006, Severity::Warning),
        (S007, Severity::Info),
        (S008, Severity::Info),
        (S009, Severity::Info),
        (S010, Severity::Info),
        (S011, Severity::Info),
        (S012, Severity::Warning),
        (S013, Severity::Info),
        (S014, Severity::Warning),
    ] {
        assert_eq!(code.severity(), severity);
        assert!(!code.message().is_empty());
    }
    // Un documento malformato non ha diagnostica: è un errore.
    assert!(read("<svg").is_err());
}
