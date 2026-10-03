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
    ] {
        assert_eq!(code.severity(), severity);
        assert!(!code.message().is_empty());
    }
    // Un documento malformato non ha diagnostica: è un errore.
    assert!(read("<svg").is_err());
}
