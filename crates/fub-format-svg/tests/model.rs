//! Il modello di §9, voce per voce: che cosa di una scena arriva all'indice,
//! alla ricerca, al grafo e all'outline, e con quali span.

use fub_abi::format::{DocumentSource, ParseContext, SourceKind};
use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget, Span};
use fub_abi::{FormatError, FormatProvider};
use fub_format_svg::{SvgProvider, FORMAT_ID, SUMMARY_KIND};

const HEAD: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1" viewBox="0 0 100 100">"#;

fn doc(body: &str) -> String {
    format!("{HEAD}{body}</svg>")
}

fn parse(source: &str) -> DocumentModel {
    SvgProvider
        .parse(
            &DocumentSource::Text(source.to_owned()),
            &ParseContext::obsidian("disegni/acqua.svg"),
        )
        .unwrap_or_else(|error| panic!("{error}\n{source}"))
}

fn slice(source: &str, span: Span) -> &str {
    &source[span.start..span.end]
}

/// I blocchi dentro il riepilogo.
fn inside(model: &DocumentModel) -> &[Block] {
    match model.body.as_slice() {
        [Block::Custom {
            custom_kind,
            blocks,
            ..
        }] if custom_kind == SUMMARY_KIND => blocks,
        other => panic!("il corpo non è il solo riepilogo: {other:?}"),
    }
}

#[test]
fn the_descriptor_claims_svg_as_text() {
    let descriptor = SvgProvider.descriptor();
    assert_eq!(descriptor.id, FORMAT_ID);
    assert_eq!(descriptor.name, "SVG (FubDraw)");
    assert_eq!(descriptor.extensions, ["svg"]);
    assert_eq!(descriptor.source, SourceKind::Text);
    // Né wikilink, né tag, né frontmatter, né prosa: le feature che scrivono
    // nel sorgente lo lasciano stare.
    assert_eq!(
        SvgProvider.capabilities(),
        fub_abi::format::FormatCapabilities::default()
    );
}

#[test]
fn the_whole_document_is_the_summary() {
    let source = doc(concat!(
        "<title>Riepilogo</title>",
        r##"<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>"##,
        r##"<g id="l00000001" fub:layer="Schizzo"><rect x="1" y="2" width="3" height="4" fill="#000000"/></g>"##,
    ));
    let model = parse(&source);
    let [Block::Custom {
        attrs,
        span,
        anchor,
        ..
    }] = model.body.as_slice()
    else {
        panic!("{:?}", model.body)
    };
    assert_eq!(*span, Span::new(0, source.len()));
    assert_eq!(*anchor, None);
    assert_eq!(attrs["version"], 1);
    assert_eq!(attrs["foreign"], false);
    assert_eq!(attrs["truncated"], false);
    assert_eq!(attrs["layers"], serde_json::json!(["Schizzo"]));
    assert_eq!(attrs["counts"]["shapes"], 1);
    assert_eq!(
        attrs["bbox"],
        serde_json::json!({"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0})
    );
    assert_eq!(model.id.as_str(), "disegni/acqua.svg");
    assert!(model.frontmatter.is_empty() && !model.frontmatter_present);
    assert!(model.tags.is_empty() && model.anchors.is_empty());
}

/// Un disegno ha una sezione sola, il titolo, che è il disegno intero: il
/// kernel la sceglie per `![[disegno#Titolo]]` senza cercare blocchi dopo il
/// titolo, e un altro nome non è una sezione.
#[test]
fn the_title_is_the_only_section() {
    let sections = |source: &str| {
        let model = parse(source);
        let Block::Custom { attrs, .. } = &model.body[0] else {
            panic!("{:?}", model.body)
        };
        attrs[fub_abi::custom::SECTIONS_ATTR].clone()
    };
    assert_eq!(
        sections(&doc(
            "<title> Ciclo\n dell'acqua </title><g fub:layer=\"A\"/>"
        )),
        serde_json::json!(["Ciclo dell'acqua"])
    );
    // Senza titolo, o con un titolo vuoto, nessuna sezione.
    assert_eq!(sections(&doc("<desc>Solo</desc>")), serde_json::json!([]));
    assert_eq!(sections(&doc("<title> </title>")), serde_json::json!([]));
}

#[test]
fn a_leading_bom_stays_out_of_the_summary() {
    let source = format!("\u{feff}{}", doc("<title>Con BOM</title>"));
    let model = parse(&source);
    assert_eq!(model.body[0].span(), Span::new(3, source.len()));
    assert_eq!(model.text, "Con BOM");
}

#[test]
fn the_title_is_the_heading_and_the_outline() {
    let source = doc("<title>\n  Ciclo  dell'acqua\n</title><desc>Dal mare</desc>");
    let model = parse(&source);
    let [Block::Heading {
        level,
        inlines,
        anchor,
        span,
        explicit_anchor,
    }, Block::Paragraph {
        inlines: desc,
        span: desc_span,
        ..
    }] = inside(&model)
    else {
        panic!("{:?}", inside(&model))
    };
    assert_eq!(*level, 1);
    assert_eq!(inlines, &[Inline::Text("Ciclo dell'acqua".to_owned())]);
    assert_eq!(anchor.as_deref(), Some("ciclo-dellacqua"));
    assert_eq!(*explicit_anchor, None);
    assert!(slice(&source, *span).starts_with("<title>"));
    assert_eq!(desc, &[Inline::Text("Dal mare".to_owned())]);
    assert_eq!(slice(&source, *desc_span), "<desc>Dal mare</desc>");

    let [heading] = model.outline.as_slice() else {
        panic!("{:?}", model.outline)
    };
    assert_eq!(
        (heading.level, heading.text.as_str(), heading.slug.as_str()),
        (1, "Ciclo dell'acqua", "ciclo-dellacqua")
    );
    assert_eq!(heading.span, *span);
}

#[test]
fn every_text_is_a_paragraph_and_the_text_field_reads_them_in_order() {
    let source = doc(concat!(
        "<title>Acqua</title>",
        r#"<g fub:layer="A"><text x="0" y="0"><tspan x="0" dy="0">Evaporazione</tspan>"#,
        r#"<tspan x="0" dy="10">e condensa</tspan></text></g>"#,
        "<desc>Dopo i testi</desc>",
        r#"<text style="fill:red">Pioggia <tspan>fitta</tspan></text>"#,
    ));
    let model = parse(&source);
    // In ordine di documento: chi cerca trova la riga dove sta.
    assert_eq!(
        model.text,
        "Acqua\nEvaporazione e condensa\nDopo i testi\nPioggia fitta"
    );
    let texts: Vec<_> = inside(&model)
        .iter()
        .filter_map(|block| match block {
            Block::Paragraph { inlines, span, .. } => Some((inlines.clone(), *span)),
            _ => None,
        })
        .collect();
    assert_eq!(texts.len(), 3);
    assert!(slice(&source, texts[0].1).starts_with("<text x=\"0\""));
    assert_eq!(texts[2].0, [Inline::Text("Pioggia fitta".to_owned())]);
}

#[test]
fn a_link_around_a_text_takes_it_as_label_and_context() {
    let source =
        doc(r#"<a href="../note/Nuvole.md#Cumuli"><text>Le nuvole</text><text>alte</text></a>"#);
    let model = parse(&source);
    let [Block::Paragraph { inlines, span, .. }] = inside(&model) else {
        panic!("{:?}", inside(&model))
    };
    let [Inline::Link {
        target,
        label,
        embed,
        span: link_span,
    }] = inlines.as_slice()
    else {
        panic!("{inlines:?}")
    };
    assert_eq!(
        *target,
        LinkTarget::Path("../note/Nuvole.md#Cumuli".to_owned())
    );
    assert!(!embed);
    assert_eq!(span, link_span);
    assert!(slice(&source, *span).starts_with("<a href="));
    assert!(slice(&source, *span).ends_with("</a>"));
    assert_eq!(
        label.as_deref(),
        Some(
            &[
                Inline::Text("Le nuvole".to_owned()),
                Inline::SoftBreak,
                Inline::Text("alte".to_owned()),
            ][..]
        )
    );
    let [link] = model.links.as_slice() else {
        panic!("{:?}", model.links)
    };
    assert_eq!(link.span, *span);
    assert_eq!(link.context.as_deref(), Some("Le nuvole alte"));
}

#[test]
fn a_link_inside_a_text_sits_in_its_paragraph() {
    let source = doc(r#"<text>Vedi <a href="Pioggia.md">la pioggia</a> e il mare</text>"#);
    let model = parse(&source);
    let [Block::Paragraph { inlines, span, .. }] = inside(&model) else {
        panic!("{:?}", inside(&model))
    };
    assert!(slice(&source, *span).starts_with("<text>"));
    let [Inline::Text(text), Inline::Link {
        target,
        label,
        span: link_span,
        ..
    }] = inlines.as_slice()
    else {
        panic!("{inlines:?}")
    };
    assert_eq!(text, "Vedi la pioggia e il mare");
    assert_eq!(*target, LinkTarget::Path("Pioggia.md".to_owned()));
    // Il testo dell'`a` è già nel paragrafo: l'etichetta non lo ripete.
    assert_eq!(*label, None);
    assert_eq!(
        slice(&source, *link_span),
        r#"<a href="Pioggia.md">la pioggia</a>"#
    );
    // Il contesto del backlink è il paragrafo in cui il collegamento compare.
    assert_eq!(
        model.links[0].context.as_deref(),
        Some("Vedi la pioggia e il mare")
    );
}

#[test]
fn a_vault_image_is_an_embed_and_others_are_not_links() {
    let source = doc(concat!(
        r#"<a href="/Glossario.md"><image href="foto/mare.png" width="1" height="1"/></a>"#,
        r#"<image xlink:href="../schizzo.webp" width="1" height="1"/>"#,
        r#"<image href="data:image/png;base64,AAAA" width="1" height="1"/>"#,
        r#"<image href="https://example.org/a.png" width="1" height="1"/>"#,
        r##"<a href="https://example.org"/><a href="#sopra"/><a href="mailto:x@y"/><a href=""/>"##,
    ));
    let model = parse(&source);
    let links: Vec<_> = model
        .links
        .iter()
        .map(|link| (link.target.clone(), link.embed, link.context.clone()))
        .collect();
    assert_eq!(
        links,
        [
            (LinkTarget::Path("/Glossario.md".to_owned()), false, None),
            (LinkTarget::Path("foto/mare.png".to_owned()), true, None),
            (LinkTarget::Path("../schizzo.webp".to_owned()), true, None),
        ]
    );
    // L'immagine dentro il collegamento ne è l'etichetta.
    let Block::Paragraph { inlines, .. } = &inside(&model)[0] else {
        panic!()
    };
    let [Inline::Link {
        label: Some(label), ..
    }] = inlines.as_slice()
    else {
        panic!("{inlines:?}")
    };
    assert!(matches!(
        label.as_slice(),
        [Inline::Link {
            embed: true,
            label: None,
            ..
        }]
    ));
    assert!(slice(&source, model.links[1].span).starts_with("<image href="));
}

#[test]
fn the_path_is_the_url_text_and_not_the_raw_value() {
    let source = doc(r#"<a href=" Sale &amp; pepe.md&#10;"/>"#);
    let model = parse(&source);
    assert_eq!(
        model.links[0].target,
        LinkTarget::Path("Sale & pepe.md".to_owned())
    );
}

#[test]
fn a_foreign_drawing_is_read_whole() {
    // Niente `fub:version`: estraneo per intero, e l'indice lo legge lo stesso.
    let source = concat!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">"#,
        r#"<title>Diagramma</title><g class="node"><text>Inizio</text></g>"#,
        r#"<a href="Fine.md"><text>Fine</text></a></svg>"#,
    );
    let model = parse(source);
    assert_eq!(model.text, "Diagramma\nInizio\nFine");
    assert_eq!(model.links.len(), 1);
    let Block::Custom { attrs, .. } = &model.body[0] else {
        panic!()
    };
    assert_eq!(attrs["foreign"], true);
    assert_eq!(attrs["version"], serde_json::Value::Null);
}

#[test]
fn a_huge_drawing_indexes_its_title_and_summary() {
    let mut source = doc("<title>Enorme</title><desc>Grande</desc><g>");
    source.truncate(source.len() - "</svg>".len());
    let filler = r#"<rect width="1" height="1"/>"#;
    while source.len() <= fub_scene::MAX_EDIT_BYTES {
        source.push_str(filler);
    }
    source.push_str(r#"<text>dopo la testa</text></g></svg>"#);
    let model = parse(&source);
    assert_eq!(model.text, "Enorme\nGrande");
    assert_eq!(model.outline[0].text, "Enorme");
    let Block::Custom { attrs, span, .. } = &model.body[0] else {
        panic!()
    };
    assert_eq!(attrs["truncated"], true);
    assert_eq!(*span, Span::new(0, source.len()));
}

#[test]
fn what_is_not_a_scene_is_refused_with_the_byte() {
    let refused = |source: &str| {
        SvgProvider
            .parse(
                &DocumentSource::Text(source.to_owned()),
                &ParseContext::obsidian("x.svg"),
            )
            .unwrap_err()
    };
    let FormatError::Parse(why) =
        refused("\u{feff}<svg xmlns=\"http://www.w3.org/2000/svg\"><g></svg>")
    else {
        panic!()
    };
    assert!(why.contains("byte"), "{why}");
    assert!(matches!(
        refused("<html xmlns=\"http://www.w3.org/1999/xhtml\"/>"),
        FormatError::Parse(_)
    ));
    assert!(matches!(refused(""), FormatError::Parse(_)));
    // Byte invece di testo: il formato è testuale, e lo dice col suo id.
    assert_eq!(
        SvgProvider
            .parse(
                &DocumentSource::Bytes(b"<svg/>".to_vec()),
                &ParseContext::obsidian("x.svg")
            )
            .unwrap_err(),
        FormatError::Unsupported {
            format: FORMAT_ID.to_owned(),
            got: SourceKind::Bytes
        }
    );
}
