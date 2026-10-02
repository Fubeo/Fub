//! La lettura di un documento: stato, versione, ragioni della sola lettura,
//! limiti, errori, BOM e terminatori di riga.

mod common;

use common::{at, doc, foreign, load, text, utf16_prefix, HEAD};
use fub_scene::{
    read, Code, Item, LineEnding, ReadError, ReadOnly, Role, Severity, Status, XmlErrorKind,
    MAX_EDIT_BYTES, MAX_ELEMENTS,
};

const FUB: &str = "https://fubeo.github.io/ns/scene/1";

fn root(attributes: &str) -> String {
    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" {attributes}><rect/></svg>"#)
}

#[test]
fn a_root_without_fub_version_is_foreign() {
    let scene = load(&root(""));
    assert_eq!(scene.status, Status::Foreign);
    assert_eq!(scene.version, None);
    assert!(scene.read_only.is_empty());
    assert!(!scene.editable());
    // Il documento estraneo si classifica comunque: «Modifica» lo adotta.
    assert_eq!(at(&scene, &[0]).unwrap().role, Role::Rect);
}

#[test]
fn fub_version_one_is_editable() {
    let scene = load(&doc("<rect/>"));
    assert_eq!(scene.status, Status::Fubdraw);
    assert_eq!(scene.version, Some(1));
    assert!(scene.editable());
    assert!(scene.diagnostics.is_empty());
}

#[test]
fn fub_version_is_found_by_namespace() {
    let scene = load(&root(&format!(r#"xmlns:f="{FUB}" f:version="1""#)));
    assert_eq!(scene.status, Status::Fubdraw);
    // `fub:` legato a un altro URI non è FubDraw.
    let scene = load(&root(
        r#"xmlns:fub="https://example.org/fub" fub:version="1""#,
    ));
    assert_eq!(scene.status, Status::Foreign);
    // Né lo è un `version` senza namespace.
    let scene = load(&root(r#"version="1""#));
    assert_eq!(scene.status, Status::Foreign);
}

#[test]
fn a_future_version_is_read_only_with_s007() {
    for (value, detail) in [("2", "2"), ("002", "2"), ("4294967296", "4294967296")] {
        let scene = load(&root(&format!(
            r#"xmlns:fub="{FUB}" fub:version="{value}""#
        )));
        assert_eq!(scene.status, Status::Fubdraw);
        assert_eq!(scene.read_only, [ReadOnly::FutureVersion], "{value}");
        assert_eq!(scene.diagnostics.len(), 1);
        let diagnostic = &scene.diagnostics[0];
        assert_eq!(diagnostic.code, Code::S007);
        assert_eq!(diagnostic.severity, Severity::Info);
        assert_eq!(diagnostic.span, None);
        assert_eq!(diagnostic.detail.as_deref(), Some(detail));
    }
}

#[test]
fn an_invalid_version_is_read_only() {
    for value in ["", "0", "000", "1.0", " 1", "1 ", "+1", "-1", "uno", "1e0"] {
        let scene = load(&root(&format!(
            r#"xmlns:fub="{FUB}" fub:version="{value}""#
        )));
        assert_eq!(scene.status, Status::Fubdraw, "{value:?}");
        assert_eq!(scene.read_only, [ReadOnly::InvalidVersion], "{value:?}");
        assert_eq!(scene.version, None);
        assert!(scene.diagnostics.is_empty());
    }
    let scene = load(&root(&format!(r#"xmlns:fub="{FUB}" fub:version="01""#)));
    assert_eq!(scene.version, Some(1));
    assert!(scene.editable());
}

#[test]
fn a_doctype_is_read_only_with_s008() {
    let source = format!("<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n{}", doc("<rect/>"));
    let scene = load(&source);
    assert_eq!(scene.read_only, [ReadOnly::Doctype]);
    let s008: Vec<_> = scene
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::S008)
        .collect();
    assert_eq!(s008.len(), 1);
    let span = s008[0].span.unwrap();
    assert!(text(&source, &span).starts_with("<!DOCTYPE svg"));
    assert!(text(&source, &span).ends_with("svg11.dtd\">"));
    // Il DOCTYPE è anche un blocco estraneo del prologo.
    assert_eq!(foreign(&scene)[0].span, span);
    assert_eq!(
        scene
            .diagnostics
            .iter()
            .filter(|d| d.code == Code::S002)
            .count(),
        1
    );
}

#[test]
fn a_declared_encoding_other_than_utf8_is_read_only() {
    for (encoding, read_only) in [
        ("UTF-8", false),
        ("utf-8", false),
        ("ISO-8859-1", true),
        ("UTF-16", true),
        ("windows-1252", true),
    ] {
        let source = format!(
            "<?xml version=\"1.0\" encoding=\"{encoding}\"?>{}",
            doc("<rect/>")
        );
        let scene = load(&source);
        assert_eq!(
            scene.read_only.contains(&ReadOnly::Encoding),
            read_only,
            "{encoding}"
        );
    }
    // Senza dichiarazione, o senza codifica, è UTF-8.
    let scene = load(&format!("<?xml version=\"1.0\"?>{}", doc("")));
    assert!(scene.editable());
}

#[test]
fn duplicate_ids_are_read_only_with_s003() {
    let source = doc(concat!(
        r#"<rect id="a"/><g id="b"><circle id="a" r="1"/></g>"#,
        r#"<use id="b" href="x.svg"/><x:e xmlns:x="https://example.org" id="a"/>"#,
        r#"<rect id=""/><rect id=""/><rect x:id="c" xmlns:x="https://example.org"/><rect id="c"/>"#,
    ));
    let scene = load(&source);
    assert_eq!(scene.read_only, [ReadOnly::DuplicateId]);
    let s003: Vec<_> = scene
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::S003)
        .collect();
    let found: Vec<_> = s003
        .iter()
        .map(|d| {
            (
                d.detail.as_deref().unwrap(),
                text(&source, &d.span.unwrap()),
            )
        })
        .collect();
    assert_eq!(
        found,
        [
            ("a", r#"<circle id="a" r="1"/>"#),
            ("b", r#"<use id="b" href="x.svg"/>"#),
            ("a", r#"<x:e xmlns:x="https://example.org" id="a"/>"#),
        ]
    );
    assert!(s003.iter().all(|d| d.severity == Severity::Error));
}

#[test]
fn the_element_limit_is_inclusive() {
    // La radice conta: `MAX_ELEMENTS` elementi in tutto sono ancora
    // modificabili, uno in più no.
    let fill = |n: usize| doc(&"<rect/>".repeat(n - 1));
    let scene = load(&fill(MAX_ELEMENTS));
    assert!(scene.editable());
    let scene = load(&fill(MAX_ELEMENTS + 1));
    assert_eq!(scene.read_only, [ReadOnly::TooManyElements]);
    assert!(scene.items.is_empty());
}

#[test]
fn a_file_beyond_the_size_limit_reads_only_its_head() {
    let head = doc("<title>Grande</title><desc>d</desc><g fub:layer=\"Uno\">");
    let head = head.strip_suffix("</svg>").unwrap();
    // Dopo la testa, contenuto che non si guarda: anche malformato.
    let filler = "<!-- riempitivo -->".repeat(MAX_EDIT_BYTES / 19 + 1);
    let source = format!("{head}{filler}<rect></g></svg>");
    assert!(source.len() > MAX_EDIT_BYTES);
    let scene = load(&source);
    assert!(scene.truncated);
    assert_eq!(scene.read_only, [ReadOnly::TooLarge]);
    assert!(scene.items.is_empty());
    assert_eq!(scene.status, Status::Fubdraw);
    // Una testa malformata resta un errore.
    let source =
        format!("<svg xmlns=\"http://www.w3.org/2000/svg\"><title>a</titolo>{filler}</svg>");
    assert!(matches!(read(&source), Err(ReadError::Malformed { .. })));
}

#[test]
fn a_file_at_the_size_limit_is_read_whole() {
    let empty = doc("");
    let source = format!("{HEAD}{}</svg>", " ".repeat(MAX_EDIT_BYTES - empty.len()));
    assert_eq!(source.len(), MAX_EDIT_BYTES);
    let scene = load(&source);
    assert!(!scene.truncated);
    assert!(scene.editable());
}

#[test]
fn a_root_that_is_not_svg_is_an_error() {
    for (source, offset) in [
        ("<html/>", 0),
        ("<svg/>", 0),
        (
            "\u{feff}<?xml version=\"1.0\"?>\n<svg xmlns=\"https://example.org\"/>",
            25,
        ),
        (
            "<s:svg xmlns:s=\"http://www.w3.org/2000/svg\"/>",
            usize::MAX,
        ),
    ] {
        match read(source) {
            Err(ReadError::NotSvg { offset: found }) => assert_eq!(found, offset, "{source}"),
            Ok(scene) => {
                // Un prefisso legato a SVG è SVG.
                assert_eq!(offset, usize::MAX, "{source}");
                assert_eq!(scene.status, Status::Foreign);
            }
            Err(e) => panic!("{source}: {e}"),
        }
    }
}

#[test]
fn malformed_xml_is_an_error_at_the_right_byte() {
    for (source, offset, kind) in [
        ("", 0, XmlErrorKind::MissingRoot),
        (
            "<svg xmlns=\"http://www.w3.org/2000/svg\">",
            0,
            XmlErrorKind::UnclosedElement,
        ),
        (
            "\u{feff}<svg xmlns=\"http://www.w3.org/2000/svg\">",
            3,
            XmlErrorKind::UnclosedElement,
        ),
        ("<svg><g></svg>", 8, XmlErrorKind::MismatchedEndTag),
        ("<svg/><svg/>", 6, XmlErrorKind::MultipleRoots),
        (
            "<svg a=\"1\" a=\"2\"/>",
            11,
            XmlErrorKind::DuplicateAttribute,
        ),
        ("<svg a=\"<\"/>", 8, XmlErrorKind::LessThanInAttribute),
        ("<svg>&nessuna;</svg>", 5, XmlErrorKind::UndeclaredEntity),
        ("<svg><p:g/></svg>", 6, XmlErrorKind::UndeclaredPrefix),
        (
            "\u{feff}<svg><!-- a -- b --></svg>",
            15,
            XmlErrorKind::InvalidComment,
        ),
        ("<svg/>testo", 6, XmlErrorKind::ContentOutsideRoot),
        (
            " <?xml version=\"1.0\"?><svg/>",
            1,
            XmlErrorKind::MisplacedDeclaration,
        ),
        ("<svg>]]></svg>", 5, XmlErrorKind::CdataEndInText),
    ] {
        match read(source) {
            Err(ReadError::Malformed {
                offset: found,
                kind: found_kind,
            }) => {
                assert_eq!((found, found_kind), (offset, kind), "{source:?}");
            }
            other => panic!("{source:?}: {other:?}"),
        }
    }
}

#[test]
fn the_bom_is_kept_and_counted() {
    let source = format!("\u{feff}{}", doc("\n  <rect/>"));
    let scene = load(&source);
    assert!(scene.bom);
    let Item::Root(root) = &scene.items[0] else {
        panic!("la prima voce è la radice")
    };
    assert_eq!(root.span.bytes[0], 3);
    assert_eq!(root.span.utf16[0], 1);
    let rect = at(&scene, &[0]).unwrap();
    assert_eq!(text(&source, &rect.span), "<rect/>");
    assert_eq!(rect.indent, "  ");
    // Il BOM vale una unità UTF-16, come nel testo che la sessione valida.
    assert_eq!(rect.span.utf16[0], rect.span.bytes[0] - 2);
}

#[test]
fn spans_in_utf16_skip_the_carriage_returns_of_crlf() {
    let source = format!("{HEAD}\r\n  <title>è 🎨</title>\r\n  <rect/>\r</svg>");
    let scene = load(&source);
    assert_eq!(scene.line_ending, LineEnding::Mixed);
    assert_eq!(scene.line_break, LineEnding::Crlf);
    let prefix = utf16_prefix(&source);
    let rect = at(&scene, &[1]).unwrap();
    assert_eq!(rect.span.utf16[0], prefix[rect.span.bytes[0]]);
    // `è` è un'unità e due byte, 🎨 due unità e quattro byte, e ogni CRLF
    // conta una unità.
    let title = at(&scene, &[0]).unwrap();
    let length = title.span.bytes[1] - title.span.bytes[0];
    assert_eq!(title.span.utf16[1] - title.span.utf16[0], length - 1 - 2);
}

#[test]
fn line_endings_are_reported() {
    for (source, ending, line_break) in [
        (doc("\n<rect/>\n"), LineEnding::Lf, LineEnding::Lf),
        (doc("\r\n<rect/>\r\n"), LineEnding::Crlf, LineEnding::Crlf),
        (doc("\r<rect/>\r"), LineEnding::Cr, LineEnding::Cr),
        (doc("<rect/>"), LineEnding::Lf, LineEnding::Lf),
        (doc("\r\n<rect/>\n\n"), LineEnding::Mixed, LineEnding::Lf),
        (doc("\r\n<rect/>\n"), LineEnding::Mixed, LineEnding::Crlf),
    ] {
        let scene = load(&source);
        assert_eq!(
            (scene.line_ending, scene.line_break),
            (ending, line_break),
            "{source:?}"
        );
    }
}

#[test]
fn every_foreign_block_is_an_s002() {
    let source = format!("<!-- a -->{}", doc("<rect/><use/><circle/><!-- b -->"));
    let scene = load(&source);
    let blocks = foreign(&scene);
    assert_eq!(blocks.len(), 3);
    let s002: Vec<_> = scene
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::S002)
        .collect();
    assert_eq!(s002.len(), 3);
    for (diagnostic, block) in s002.iter().zip(&blocks) {
        assert_eq!(diagnostic.span, Some(block.span));
        assert_eq!(diagnostic.severity, Severity::Info);
    }
    assert!(load(&doc("<rect/>")).diagnostics.is_empty());
}

#[test]
fn read_only_reasons_and_diagnostics_are_sorted() {
    let source = format!(
        "<?xml version=\"1.0\" encoding=\"latin1\"?><!DOCTYPE svg>{}",
        root(&format!(
            r#"xmlns:fub="{FUB}" fub:version="3" id="a"><g id="a"/><rect id="a"/"#
        ))
    );
    let scene = load(&source);
    assert_eq!(
        scene.read_only,
        [
            ReadOnly::Doctype,
            ReadOnly::Encoding,
            ReadOnly::FutureVersion,
            ReadOnly::DuplicateId
        ]
    );
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(
        codes,
        [Code::S002, Code::S003, Code::S003, Code::S007, Code::S008]
    );
}

#[test]
fn the_scene_serializes_to_the_documented_shape() {
    let source = format!(
        "\u{feff}{}",
        doc("<g fub:layer=\"Uno\" id=\"l1\"><use/></g>")
    );
    let value = serde_json::to_value(load(&source)).unwrap();
    assert_eq!(value["status"], "fubdraw");
    assert_eq!(value["readOnly"], serde_json::json!([]));
    assert_eq!(value["version"], 1);
    assert_eq!(value["bom"], true);
    assert_eq!(value["lineEnding"], "lf");
    assert_eq!(value["lineBreak"], "lf");
    assert_eq!(value["truncated"], false);
    let items = value["items"].as_array().unwrap();
    assert_eq!(items[0]["kind"], "root");
    assert!(items[0]["bytes"].is_array() && items[0]["utf16"].is_array());
    assert!(items[0]["tags"]["open"]["bytes"].is_array());
    let layer = &items[1];
    assert_eq!(layer["kind"], "element");
    assert_eq!(layer["path"], serde_json::json!([0]));
    assert_eq!(layer["tag"], "g");
    assert_eq!(layer["role"], "layer");
    assert_eq!(layer["id"], "l1");
    assert_eq!(
        layer["layer"],
        serde_json::json!({"name": "Uno", "locked": false, "hidden": false})
    );
    assert_eq!(layer["indent"], "");
    assert!(layer.get("stroke").is_none() && layer.get("lines").is_none());
    let block = &items[2];
    assert_eq!(block["kind"], "foreign");
    assert_eq!(block["parentPath"], serde_json::json!([0]));
    assert_eq!(block["elements"], serde_json::json!([0, 1]));
    let diagnostic = &value["diagnostics"][0];
    assert_eq!(diagnostic["code"], "S002");
    assert_eq!(diagnostic["severity"], "info");
    assert_eq!(diagnostic["bytes"], block["bytes"]);
    assert!(diagnostic.get("detail").is_none());
}

#[test]
fn read_only_documents_are_still_classified() {
    let source = format!("<!DOCTYPE svg>{}", doc("<rect/><use/>"));
    let scene = load(&source);
    assert!(!scene.editable());
    assert_eq!(at(&scene, &[0]).unwrap().role, Role::Rect);
    assert_eq!(foreign(&scene).len(), 2);
}
