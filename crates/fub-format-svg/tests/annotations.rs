//! Il provider `fubann`, voce per voce: il PDF annotato come collegamento, le
//! pagine e le note nel modello, l'elenco dell'anteprima, le annotazioni nuove
//! e la riscrittura quando il PDF cambia nome.

use fub_abi::custom::SECTION_ATTR;
use fub_abi::edit::{EditRequest, Revision};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, LinkInsert, LinkRewrite, ParseContext, RenderOptions,
    SourceKind,
};
use fub_abi::model::{Block, DocId, DocumentModel, Heading, Inline, LinkTarget, Span};
use fub_abi::{FormatError, FormatProvider, TextEdit};
use fub_format_svg::{
    FubannProvider, SvgProvider, ANNOTATIONS_FORMAT_ID, ANNOTATIONS_KIND, NOTE_KIND, PAGE_KIND,
};

const FIXTURE: &str = include_str!("fixtures/annotations.fubann");
const ID: &str = "atti/Bando di gara.pdf.fubann";

const HEAD: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando.pdf">"#;

fn doc(body: &str) -> String {
    format!("{HEAD}{body}</svg>")
}

fn parse(source: &str) -> DocumentModel {
    FubannProvider
        .parse(
            &DocumentSource::Text(source.to_owned()),
            &ParseContext::obsidian(ID),
        )
        .unwrap_or_else(|error| panic!("{error}\n{source}"))
}

fn slice(source: &str, span: Span) -> &str {
    &source[span.start..span.end]
}

/// Il riepilogo: `attrs` e figli.
fn summary(model: &DocumentModel) -> (&serde_json::Value, &[Block]) {
    match model.body.as_slice() {
        [Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        }] if custom_kind == ANNOTATIONS_KIND => (attrs, blocks),
        other => panic!("il corpo non è il solo riepilogo: {other:?}"),
    }
}

fn kind(block: &Block) -> Option<&str> {
    match block {
        Block::Custom { custom_kind, .. } => Some(custom_kind),
        _ => None,
    }
}

fn children(block: &Block) -> &[Block] {
    match block {
        Block::Custom { blocks, .. } => blocks,
        other => panic!("non è un blocco custom: {other:?}"),
    }
}

fn render(model: &DocumentModel) -> String {
    FubannProvider
        .render_html(model, &RenderOptions::preview())
        .unwrap()
}

#[test]
fn the_descriptor_claims_fubann_as_text() {
    let descriptor = FubannProvider.descriptor();
    assert_eq!(descriptor.id, ANNOTATIONS_FORMAT_ID);
    assert_eq!(descriptor.id, "fubann");
    assert_eq!(descriptor.name, "Annotazioni PDF (FubDraw)");
    assert_eq!(descriptor.extensions, ["fubann"]);
    assert_eq!(descriptor.source, SourceKind::Text);
    assert_eq!(FubannProvider.capabilities(), FormatCapabilities::default());
}

#[test]
fn the_pdf_is_a_link_on_the_value_of_fub_annotates() {
    let source = doc(r#"<g fub:page="1"><text fub:note="Da rivedere">Importo</text></g>"#);
    let model = parse(&source);
    let link = &model.links[0];
    assert_eq!(link.target, LinkTarget::Path("Bando.pdf".to_owned()));
    assert!(!link.embed);
    assert_eq!(slice(&source, link.span), "Bando.pdf");
    // Il contesto del backlink è il testo delle annotazioni.
    assert_eq!(link.context.as_deref(), Some("Importo Da rivedere"));

    let (attrs, blocks) = summary(&model);
    assert_eq!(attrs["annotates"], "Bando.pdf");
    let Block::Paragraph { inlines, span, .. } = &blocks[0] else {
        panic!("{:?}", blocks[0]);
    };
    assert_eq!(*span, link.span);
    assert!(matches!(
        inlines.as_slice(),
        [Inline::Link {
            label: None,
            embed: false,
            ..
        }]
    ));

    // Senza annotazioni il backlink non ha contesto, e il titolo non lo è:
    // chi mostra il backlink nomina già il documento.
    let model = parse(&doc("<title>Solo il titolo</title>"));
    assert_eq!(model.links[0].context, None);
}

#[test]
fn a_value_that_is_not_in_the_vault_is_no_link() {
    for value in ["https://example.org/a.pdf", "#page=2", "", "//host/a.pdf"] {
        let source = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:annotates="{value}"><text>t</text></svg>"#
        );
        let model = parse(&source);
        assert!(model.links.is_empty(), "{value:?}");
        assert_eq!(summary(&model).0["annotates"], serde_json::Value::Null);
    }
}

#[test]
fn the_summary_carries_the_pdf_its_digest_and_its_pages() {
    let model = parse(FIXTURE);
    let (attrs, _) = summary(&model);
    assert_eq!(attrs["version"], 1);
    assert_eq!(attrs["foreign"], false);
    assert_eq!(attrs["truncated"], false);
    assert_eq!(attrs["annotates"], "Bando%20di%20gara.pdf");
    assert_eq!(
        attrs["digest"],
        "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
    assert_eq!(attrs["pages"], 12);
    assert_eq!(attrs["counts"]["strokes"], 1);
    assert_eq!(attrs["ink"]["samples"], 2);
    // Né livelli né rettangolo: le pagine hanno ciascuna le sue coordinate.
    assert!(attrs.get("layers").is_none());
    assert!(attrs.get("bbox").is_none());

    // Un valore fuori grammatica è assente, e il riepilogo lo dice.
    let model = parse(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:digest="md5:00" fub:pages="tre"/>"#,
    );
    let (attrs, _) = summary(&model);
    assert_eq!(attrs["digest"], serde_json::Value::Null);
    assert_eq!(attrs["pages"], serde_json::Value::Null);
    assert_eq!(attrs["foreign"], true);
}

#[test]
fn a_page_is_a_block_with_its_annotations() {
    let source = doc(concat!(
        r#"<title>T</title>"#,
        r#"<g fub:page="2" fub:page-size="612 792"><text>uno</text><a href="n.md"><rect/></a></g>"#,
        r#"<g fub:page="5"/>"#,
        r#"<text>fuori</text>"#,
    ));
    let model = parse(&source);
    let (_, blocks) = summary(&model);
    let kinds: Vec<_> = blocks.iter().map(kind).collect();
    assert_eq!(
        kinds,
        [None, None, Some(PAGE_KIND), Some(PAGE_KIND), None],
        "collegamento al PDF, titolo, due pagine, un testo fuori"
    );
    let Block::Custom { attrs, span, .. } = &blocks[2] else {
        unreachable!()
    };
    assert_eq!(attrs["page"], 2);
    assert_eq!(attrs["size"], serde_json::json!([612.0, 792.0]));
    assert!(slice(&source, *span).starts_with(r#"<g fub:page="2""#));
    assert_eq!(children(&blocks[2]).len(), 2);
    let Block::Custom { attrs, .. } = &blocks[3] else {
        unreachable!()
    };
    assert_eq!(attrs["size"], serde_json::Value::Null);
    assert!(children(&blocks[3]).is_empty());
}

#[test]
fn a_note_is_its_body_and_its_text() {
    let source = doc(concat!(
        r#"<g fub:page="1"><text fub:note="Prima riga&#10;&#10;  seconda   riga  ">"#,
        r#"Vista <a href="n.md">qui</a></text></g>"#,
    ));
    let model = parse(&source);
    let (_, blocks) = summary(&model);
    let note = &children(&blocks[1])[0];
    assert_eq!(kind(note), Some(NOTE_KIND));
    let [Block::Paragraph {
        inlines: body,
        span: body_span,
        ..
    }, Block::Paragraph {
        inlines: text,
        span: text_span,
        ..
    }] = children(note)
    else {
        panic!("{note:?}");
    };
    // Il corpo viene prima, come nella sorgente: il valore sta nel tag
    // d'apertura. Le righe vuote cadono e gli spazi si riducono.
    assert_eq!(
        body,
        &[
            Inline::Text("Prima riga".to_owned()),
            Inline::HardBreak,
            Inline::Text("seconda riga".to_owned()),
        ]
    );
    assert_eq!(
        slice(&source, *body_span),
        "Prima riga&#10;&#10;  seconda   riga  "
    );
    assert_eq!(
        slice(&source, *text_span),
        r#"Vista <a href="n.md">qui</a>"#
    );
    assert!(matches!(
        text.as_slice(),
        [Inline::Text(vista), Inline::Link { .. }] if vista == "Vista qui"
    ));
    assert_eq!(model.text, "Vista qui\nPrima riga\nseconda riga");
    // Un `a` senza testo suo prende per contesto il testo che lo contiene.
    assert_eq!(model.links[1].context.as_deref(), Some("Vista qui"));

    // Una nota senza testo ha solo il corpo.
    let model = parse(&doc(r#"<text fub:note="Solo il corpo"/>"#));
    let (_, blocks) = summary(&model);
    assert_eq!(kind(&blocks[1]), Some(NOTE_KIND));
    assert_eq!(children(&blocks[1]).len(), 1);
    assert_eq!(model.text, "Solo il corpo");
}

#[test]
fn a_note_inside_a_link_is_its_label() {
    let source = doc(r#"<a href="n.md"><text fub:note="corpo&#10;altro">vista</text></a>"#);
    let model = parse(&source);
    let (_, blocks) = summary(&model);
    let Block::Paragraph { inlines, .. } = &blocks[1] else {
        panic!("{:?}", blocks[1]);
    };
    let [Inline::Link {
        label: Some(label), ..
    }] = inlines.as_slice()
    else {
        panic!("{inlines:?}");
    };
    assert_eq!(
        label,
        &[
            Inline::Text("vista".to_owned()),
            Inline::HardBreak,
            Inline::Text("corpo".to_owned()),
            Inline::HardBreak,
            Inline::Text("altro".to_owned()),
        ]
    );
    assert_eq!(model.links[1].context.as_deref(), Some("vista corpo altro"));
    assert_eq!(model.text, "vista\ncorpo\naltro");
}

#[test]
fn the_sections_are_the_title_and_the_pages() {
    let source = doc(concat!(
        "<title>Revisione</title>",
        r#"<g fub:page="3"/><g fub:page="1"/><g fub:page="3"/>"#,
    ));
    let model = parse(&source);
    assert_eq!(
        summary(&model).0["sections"],
        serde_json::json!(["Revisione", "page=3", "page=1"])
    );
    assert_eq!(
        model.outline,
        [Heading {
            level: 1,
            text: "Revisione".to_owned(),
            slug: "revisione".to_owned(),
            span: model.outline[0].span,
            explicit_anchor: None,
        }]
    );

    // Lo stesso file letto come disegno non ha pagine: `fub:page` è un
    // attributo sconosciuto, e la sola sezione è il titolo.
    let drawing = SvgProvider
        .parse(
            &DocumentSource::Text(source.clone()),
            &ParseContext::obsidian("d.svg"),
        )
        .unwrap();
    let Block::Custom { attrs, .. } = &drawing.body[0] else {
        unreachable!()
    };
    assert_eq!(attrs["sections"], serde_json::json!(["Revisione"]));
    assert_eq!(drawing.links.len(), 0);
}

#[test]
fn the_preview_lists_the_annotations_by_page() {
    let html = render(&parse(FIXTURE));
    assert!(html.starts_with(concat!(
        r#"<section class="fub-annotations" data-annotates="Bando%20di%20gara.pdf" data-pages="12""#,
        r#" data-fub-source-start="0" data-fub-source-end="1715">"#,
    )));
    assert!(html.contains(
        r#"<h1 data-fub-source-start="244" data-fub-source-end="278">Revisione del bando</h1>"#
    ));
    assert!(html.contains(concat!(
        r#"<p class="fub-annotations-target" data-fub-source-start="118" data-fub-source-end="139">"#,
        r##"<a class="internal-path" data-path="Bando%20di%20gara.pdf" href="#">Bando di gara.pdf</a></p>"##,
    )));
    assert!(html.contains(
        r#"<section class="fub-annotations-page" data-page="3" data-page-size="595.28 841.89""#
    ));
    assert!(html.contains(
        r##"<h2><a class="internal-path" data-path="Bando%20di%20gara.pdf#page=3" href="#">p. 3</a></h2>"##
    ));
    // La nota: prima ciò che si vede sulla pagina, poi il corpo.
    let note = html.find("Importo da rivedere").unwrap();
    let body = html.find("L&#39;importo a base d&#39;asta").unwrap();
    assert!(note < body);
    assert!(
        html.contains("è cambiato.<br>Chiedere conferma all&#39;ufficio &lt;gare&gt;.</p></li>")
    );
    assert!(html.contains(r#"<li class="fub-annotations-note""#));
    assert!(html.contains(r#"<p class="fub-annotations-body""#));
    assert!(html.contains(concat!(
        r##"<li class="fub-annotations-text" data-fub-source-start="1198" data-fub-source-end="1431">"##,
        r##"<a class="internal-path" data-path="../Verbali/Verbale%2012.md" href="#">Vedi il verbale</a></li>"##,
    )));
    // Il testo fuori dalle pagine resta, in ordine di documento.
    assert!(
        html.ends_with(r#">Fuori dalle pagine</p></section>"#),
        "{html}"
    );
}

#[test]
fn a_page_section_lists_only_that_page() {
    let model = parse(FIXTURE);
    let mut section = DocumentModel::empty(model.id.clone());
    section.body = model.body.clone();
    let Block::Custom { attrs, .. } = &mut section.body[0] else {
        unreachable!()
    };
    attrs[SECTION_ATTR] = serde_json::json!("page=3");
    let html = render(&section);
    assert!(html.contains(r#"data-page="3""#));
    assert!(!html.contains(r#"data-page="1""#));
    assert!(!html.contains("Revisione del bando"));
    assert!(!html.contains("fub-annotations-target"));
    assert!(html.contains("Manca la firma del RUP"));

    // Il titolo è l'insieme intero.
    attrs_of(&mut section)[SECTION_ATTR] = serde_json::json!("Revisione del bando");
    assert_eq!(render(&section), render(&model));
}

fn attrs_of(model: &mut DocumentModel) -> &mut serde_json::Value {
    match &mut model.body[0] {
        Block::Custom { attrs, .. } => attrs,
        _ => unreachable!(),
    }
}

/// Con dei renderer registrati il kernel passa un frammento che ha solo i
/// blocchi: l'elenco deve uscire uguale.
#[test]
fn a_fragment_renders_like_the_whole_model() {
    let model = parse(FIXTURE);
    let mut fragment = DocumentModel::empty(model.id.clone());
    fragment.body = model.body.clone();
    assert_eq!(render(&fragment), render(&model));
}

#[test]
fn no_resource_is_ever_loaded_and_everything_is_escaped() {
    let source = doc(concat!(
        r#"<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>"#,
        r#"<g fub:page="1"><image href="foto/x&quot;.png"/><a href="javascript:alert(1)"><text>no</text></a>"#,
        r#"<text fub:note="&lt;img src=x onerror=alert(1)&gt;">&lt;b&gt;</text></g>"#,
    ));
    let html = render(&parse(&source));
    assert!(!html.contains("<img"), "{html}");
    assert!(!html.contains("<script"), "{html}");
    assert!(!html.contains("src=\""), "{html}");
    assert!(!html.contains("javascript:"), "{html}");
    assert!(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
    // Un'immagine del vault è un collegamento interno, non un'immagine.
    assert!(html.contains(
        r##"<a class="internal-path" data-path="foto/x&quot;.png" href="#">foto/x&quot;.png</a>"##
    ));
}

#[test]
fn without_a_pdf_a_page_title_is_only_its_number() {
    let model = parse(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"><g fub:page="4"><text>t</text></g></svg>"#,
    );
    let html = render(&model);
    assert!(html.contains("<h2>p. 4</h2>"), "{html}");
    assert!(!html.contains("data-annotates"));
    assert!(!html.contains("internal-path"));
}

#[test]
fn new_annotations_name_their_pdf() {
    let new = |id: &str| {
        FubannProvider
            .serialize(&DocumentModel::empty(DocId::new(id)))
            .unwrap()
    };
    let source = new(ID);
    assert_eq!(
        source,
        concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando%20di%20gara.pdf">"#,
            "\n  <title>Bando di gara.pdf</title>\n</svg>\n",
        )
    );
    let model = parse(&source);
    assert_eq!(
        model.links[0].target,
        LinkTarget::Path("Bando%20di%20gara.pdf".to_owned())
    );
    assert_eq!(model.outline[0].text, "Bando di gara.pdf");

    // Un nome che sembra uno schema prende `./`, e si rilegge nel vault.
    assert!(new("nota:1.pdf.fubann").contains(r#"fub:annotates="./nota:1.pdf""#));
    // Senza un PDF nel nome, niente `fub:annotates`.
    let orphan = new("atti/Appunti.fubann");
    assert!(!orphan.contains("fub:annotates"), "{orphan}");
    assert!(orphan.contains("<title>Appunti</title>"));

    // Il titolo viene dal modello, se ce n'è uno.
    let mut model = DocumentModel::empty(DocId::new(ID));
    model.outline.push(Heading {
        level: 1,
        text: "Revisione & note".to_owned(),
        slug: "revisione-note".to_owned(),
        span: Span::new(0, 0),
        explicit_anchor: None,
    });
    let source = FubannProvider.serialize(&model).unwrap();
    assert!(source.contains("<title>Revisione &amp; note</title>"));
}

/// La richiesta che il kernel farebbe per il collegamento `index`.
fn request(model: &DocumentModel, index: usize, replacement: &str) -> LinkRewrite {
    let link = &model.links[index];
    LinkRewrite {
        span: link.span,
        target: link.target.clone(),
        replacement: replacement.to_owned(),
    }
}

fn rewrite(source: &str, rewrites: &[LinkRewrite]) -> Result<Vec<TextEdit>, FormatError> {
    FubannProvider
        .rewrite_links(
            &DocumentSource::Text(source.to_owned()),
            &ParseContext::obsidian(ID),
            rewrites,
        )
        .map(|edits| edits.expect("il provider riscrive da sé"))
}

fn apply(source: &str, edits: Vec<TextEdit>) -> String {
    EditRequest::new(Revision::of(source), edits)
        .apply_to(source)
        .unwrap()
        .0
}

#[test]
fn renaming_the_pdf_rewrites_only_the_value() {
    let model = parse(FIXTURE);
    let edits = rewrite(FIXTURE, &[request(&model, 0, "Bando%20definitivo.pdf")]).unwrap();
    assert_eq!(edits.len(), 1);
    let after = apply(FIXTURE, edits);
    assert_eq!(
        after,
        FIXTURE.replacen(
            r#"fub:annotates="Bando%20di%20gara.pdf""#,
            r#"fub:annotates="Bando%20definitivo.pdf""#,
            1
        )
    );
    let model = parse(&after);
    assert_eq!(
        model.links[0].target,
        LinkTarget::Path("Bando%20definitivo.pdf".to_owned())
    );

    // Il PDF e un collegamento di una pagina nella stessa richiesta.
    let model = parse(FIXTURE);
    let edits = rewrite(
        FIXTURE,
        &[
            request(&model, 1, "../Verbali/Verbale%2013.md"),
            request(&model, 0, "../Bando.pdf"),
        ],
    )
    .unwrap();
    let after = apply(FIXTURE, edits);
    let targets: Vec<_> = parse(&after).links.into_iter().map(|l| l.target).collect();
    assert_eq!(
        targets,
        [
            LinkTarget::Path("../Bando.pdf".to_owned()),
            LinkTarget::Path("../Verbali/Verbale%2013.md".to_owned()),
        ]
    );
}

#[test]
fn renaming_keeps_quotes_bom_and_crlf() {
    let source = "\u{feff}<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\"\r\n     fub:version=\"1\" fub:annotates='l&apos;atto.pdf'>\r\n</svg>\r\n";
    let model = parse(source);
    assert_eq!(
        model.links[0].target,
        LinkTarget::Path("l'atto.pdf".to_owned())
    );
    let edits = rewrite(source, &[request(&model, 0, "l'atto & co.pdf")]).unwrap();
    let after = apply(source, edits);
    assert_eq!(
        after,
        source.replace("l&apos;atto.pdf", "l&#39;atto &amp; co.pdf")
    );
    assert_eq!(
        parse(&after).links[0].target,
        LinkTarget::Path("l'atto & co.pdf".to_owned())
    );
}

#[test]
fn a_rewrite_that_does_not_match_the_source_is_refused() {
    let model = parse(FIXTURE);
    let mut moved = request(&model, 0, "altro.pdf");
    moved.span = Span::new(moved.span.start + 1, moved.span.end);
    assert!(rewrite(FIXTURE, &[moved]).is_err());
    let mut renamed = request(&model, 0, "altro.pdf");
    renamed.target = LinkTarget::Path("Bando.pdf".to_owned());
    assert!(rewrite(FIXTURE, &[renamed]).is_err());
    assert_eq!(rewrite(FIXTURE, &[]).unwrap(), []);
}

#[test]
fn a_new_reference_is_written_like_in_a_drawing() {
    let link = LinkInsert {
        target: LinkTarget::Path("atti/Verbali/Verbale 12.md#Esito".to_owned()),
        label: None,
        embed: false,
    };
    let ctx = ParseContext::obsidian(ID);
    assert_eq!(
        FubannProvider.format_link(&ctx, &link).unwrap(),
        SvgProvider.format_link(&ctx, &link).unwrap()
    );
}
