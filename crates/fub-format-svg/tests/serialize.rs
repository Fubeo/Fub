//! Un disegno nuovo: il file che il kernel scrive quando si crea un documento
//! `.svg`. Si legge come scena FubDraw modificabile, senza diagnostica.

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::{Block, DocId, DocumentModel, Heading, Inline, Span};
use fub_abi::FormatProvider;
use fub_format_svg::SvgProvider;
use fub_scene::{Item, Role};

fn new_document(model: &DocumentModel) -> String {
    SvgProvider.serialize(model).unwrap()
}

fn titled(id: &str, title: &str) -> DocumentModel {
    let mut model = DocumentModel::empty(DocId::new(id));
    model.body.push(Block::Heading {
        level: 1,
        inlines: vec![Inline::Text(title.to_owned())],
        anchor: None,
        span: Span::new(0, 0),
        explicit_anchor: None,
    });
    model
}

#[test]
fn a_new_drawing_is_root_title_paper_and_first_layer() {
    let source = new_document(&DocumentModel::empty(DocId::new(
        "disegni/Ciclo dell'acqua.svg",
    )));
    let layer = source
        .split("<g id=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .unwrap();
    assert_eq!(
        source,
        format!(
            concat!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">"#,
                "\n  <title>Ciclo dell'acqua</title>\n",
                r##"  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>"##,
                "\n  <g id=\"{layer}\" fub:layer=\"Livello 1\">\n  </g>\n</svg>\n",
            ),
            layer = layer
        )
    );
    // Lo stesso nome, lo stesso file: il provider è una funzione pura.
    assert_eq!(
        source,
        new_document(&DocumentModel::empty(DocId::new(
            "disegni/Ciclo dell'acqua.svg"
        )))
    );
    assert_ne!(
        source,
        new_document(&DocumentModel::empty(DocId::new(
            "altri/Ciclo dell'acqua.svg"
        )))
    );
}

#[test]
fn a_new_drawing_reads_back_editable_and_clean() {
    for model in [
        DocumentModel::empty(DocId::new("a.svg")),
        titled("b.svg", "Un titolo"),
        titled("c.svg", "  A & <b>  \n  c  "),
    ] {
        let source = new_document(&model);
        let scene = fub_scene::read(&source).unwrap();
        assert!(scene.editable(), "{source}");
        assert!(scene.diagnostics.is_empty(), "{:?}", scene.diagnostics);
        assert!(!scene.summary.foreign);
        assert_eq!(scene.summary.layers, ["Livello 1"]);
        let roles: Vec<_> = scene
            .items
            .iter()
            .map(|item| match item {
                Item::Root(_) => None,
                Item::Element(element) => Some(element.role),
                Item::Foreign(foreign) => panic!("estraneo: {foreign:?}"),
            })
            .collect();
        assert_eq!(
            roles,
            [
                None,
                Some(Role::Title),
                Some(Role::Paper),
                Some(Role::Layer)
            ]
        );
        // E il provider ne legge il titolo che ha scritto.
        let back = SvgProvider
            .parse(
                &DocumentSource::Text(source.clone()),
                &ParseContext::obsidian(model.id.as_str()),
            )
            .unwrap();
        assert_eq!(back.outline.len(), 1);
        assert!(!source.contains('\r'));
        assert!(source.ends_with("</svg>\n"));
    }
}

#[test]
fn the_title_comes_from_the_model_on_one_line_and_escaped() {
    let source = new_document(&titled("c.svg", "  A & <b>\n\t c\u{1}  "));
    assert!(
        source.contains("<title>A &amp; &lt;b&gt; c</title>"),
        "{source}"
    );
    let back = fub_scene::read(&source).unwrap();
    assert_eq!(back.index.title.unwrap().text, "A & <b> c");

    // Senza heading nel corpo vale l'outline; senza nemmeno quello, il nome.
    let mut outlined = DocumentModel::empty(DocId::new("d.svg"));
    outlined.outline.push(Heading {
        level: 1,
        text: "Dall'outline".to_owned(),
        slug: "dalloutline".to_owned(),
        span: Span::new(0, 0),
        explicit_anchor: None,
    });
    assert!(new_document(&outlined).contains("<title>Dall'outline</title>"));
    assert!(new_document(&titled("cartella/Nome file.svg", " \n "))
        .contains("<title>Nome file</title>"));
}
