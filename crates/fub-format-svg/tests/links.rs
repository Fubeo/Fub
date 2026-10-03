//! I riferimenti di un disegno: la riscrittura quando una destinazione cambia
//! nome, chirurgica sui byte del valore, e il riferimento nuovo.

use fub_abi::edit::{EditRequest, Revision};
use fub_abi::format::{DocumentSource, LinkInsert, LinkRewrite, ParseContext};
use fub_abi::model::{DocumentModel, LinkTarget};
use fub_abi::rules::path::percent_encode_path;
use fub_abi::{FormatError, FormatProvider, TextEdit};
use fub_format_svg::SvgProvider;

const DRAWING: &str = include_str!("fixtures/drawing.svg");
const FOREIGN: &str = include_str!("fixtures/foreign-crlf-bom.svg");

fn ctx(id: &str) -> ParseContext {
    ParseContext::obsidian(id)
}

fn parse(source: &str) -> DocumentModel {
    SvgProvider
        .parse(
            &DocumentSource::Text(source.to_owned()),
            &ctx("disegni/d.svg"),
        )
        .unwrap()
}

/// La richiesta che il kernel farebbe per il collegamento `index` del
/// modello, verso `replacement`.
fn request(model: &DocumentModel, index: usize, replacement: &str) -> LinkRewrite {
    let link = &model.links[index];
    LinkRewrite {
        span: link.span,
        target: link.target.clone(),
        replacement: replacement.to_owned(),
    }
}

fn rewrite(source: &str, rewrites: &[LinkRewrite]) -> Result<Vec<TextEdit>, FormatError> {
    SvgProvider
        .rewrite_links(
            &DocumentSource::Text(source.to_owned()),
            &ctx("disegni/d.svg"),
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

fn paths(source: &str) -> Vec<String> {
    parse(source)
        .links
        .iter()
        .map(|link| match &link.target {
            LinkTarget::Path(path) => path.clone(),
            other => panic!("{other:?}"),
        })
        .collect()
}

#[test]
fn only_the_value_bytes_change() {
    let model = parse(DRAWING);
    let edits = rewrite(
        DRAWING,
        &[
            request(&model, 0, "../note/Nubi.md#Cumuli"),
            request(&model, 2, "foto/mare grande.png"),
            request(&model, 3, "Sale & \"pepe\".md"),
        ],
    )
    .unwrap();
    assert_eq!(edits.len(), 3);
    for edit in &edits {
        let link = model
            .links
            .iter()
            .find(|link| link.span.start <= edit.span.start && edit.span.end <= link.span.end)
            .expect("ogni patch sta dentro l'elemento chiesto");
        let element = &DRAWING[link.span.start..link.span.end];
        assert!(element.starts_with("<a ") || element.starts_with("<image "));
    }
    let after = apply(DRAWING, edits);
    assert_eq!(
        after,
        DRAWING
            .replace(
                r#""../note/Nuvole.md#Cumuli""#,
                r#""../note/Nubi.md#Cumuli""#
            )
            .replace(r#""foto/mare.png""#, r#""foto/mare grande.png""#)
            .replace(
                r#""Sale &amp; pepe.md""#,
                r#""Sale &amp; &quot;pepe&quot;.md""#
            )
    );
    assert_eq!(
        paths(&after),
        [
            "../note/Nubi.md#Cumuli",
            "/Glossario.md",
            "foto/mare grande.png",
            "Sale & \"pepe\".md",
            "Pioggia.md"
        ]
    );
}

/// BOM, CRLF, apici singoli e un `xlink:href` che ripete `href`: si riscrive
/// anche quello, con le sue virgolette, e nient'altro.
#[test]
fn a_foreign_file_keeps_every_other_byte() {
    let model = parse(FOREIGN);
    let edits = rewrite(
        FOREIGN,
        &[
            request(&model, 0, "quartiere/l'parco.md"),
            request(&model, 1, "foto/mappa vecchia.png"),
        ],
    )
    .unwrap();
    assert_eq!(edits.len(), 3, "href, xlink:href ombra e l'immagine");
    let after = apply(FOREIGN, edits);
    assert!(after.starts_with('\u{feff}'));
    assert_eq!(
        after.matches("\r\n").count(),
        FOREIGN.matches("\r\n").count()
    );
    assert_eq!(
        after,
        FOREIGN
            .replace("'quartiere/parco.md'", "'quartiere/l&#39;parco.md'")
            .replace(r#""foto/mappa.png""#, r#""foto/mappa vecchia.png""#)
    );
    assert_eq!(
        paths(&after),
        ["quartiere/l'parco.md", "foto/mappa vecchia.png"]
    );
    let scene = fub_scene::read(&after).unwrap();
    assert!(scene.index.links[0].shadowed.is_some());
}

#[test]
fn a_rewrite_that_does_not_match_the_source_is_refused() {
    let model = parse(DRAWING);
    let mut moved = request(&model, 0, "x.md");
    moved.span.start += 1;
    let mut changed = request(&model, 0, "x.md");
    changed.target = LinkTarget::Path("Altro.md".to_owned());
    let wiki = LinkRewrite {
        target: LinkTarget::wiki("Nuvole"),
        ..request(&model, 0, "x.md")
    };
    for (what, rewrites) in [
        ("span spostato", vec![moved]),
        ("percorso cambiato", vec![changed]),
        ("wikilink", vec![wiki]),
        (
            "due volte lo stesso",
            vec![request(&model, 0, "a.md"), request(&model, 0, "b.md")],
        ),
        ("destinazione vuota", vec![request(&model, 0, " ")]),
        ("fuori dal vault", vec![request(&model, 0, "//host/x.md")]),
    ] {
        assert!(rewrite(DRAWING, &rewrites).is_err(), "{what}");
    }
    assert_eq!(rewrite(DRAWING, &[]).unwrap(), []);
    assert!(rewrite("<svg", &[request(&model, 0, "x.md")]).is_err());
}

/// Un nome il cui primo segmento sembra uno schema si rilegge come URL: con
/// `./` davanti resta un percorso del vault e porta allo stesso documento.
#[test]
fn a_name_that_looks_like_a_scheme_keeps_pointing_into_the_vault() {
    let model = parse(DRAWING);
    let after = apply(
        DRAWING,
        rewrite(DRAWING, &[request(&model, 4, "Pioggia:2.md")]).unwrap(),
    );
    assert!(after.contains(r#"<a href="./Pioggia:2.md">"#));
    assert_eq!(paths(&after)[4], "./Pioggia:2.md");
}

#[test]
fn a_new_reference_is_relative_to_the_drawing() {
    let format = |target: LinkTarget, embed: bool| {
        SvgProvider.format_link(
            &ctx("disegni/acqua/ciclo.svg"),
            &LinkInsert {
                target,
                label: Some("ignorata".to_owned()),
                embed,
            },
        )
    };
    let path = |p: &str| LinkTarget::Path(p.to_owned());
    for (written, expected) in [
        ("../../note/Nuvole.md#Cumuli", "../../note/Nuvole.md#Cumuli"),
        ("/note/Nuvole.md", "../../note/Nuvole.md"),
        ("/disegni/acqua/foto.png", "foto.png"),
        ("Sale & pepe.md", "Sale%20&amp;%20pepe.md"),
        ("/nota:1.md", "../../nota:1.md"),
        ("nota:1.md", "./nota:1.md"),
    ] {
        assert_eq!(
            format(path(written), false).unwrap().as_deref(),
            Some(expected),
            "{written}"
        );
        // Un'immagine si scrive come un collegamento.
        assert_eq!(
            format(path(written), true).unwrap(),
            format(path(written), false).unwrap()
        );
    }
    assert!(format(path("../../../fuori.md"), false).is_err());
    assert_eq!(format(LinkTarget::wiki("Nuvole"), false).unwrap(), None);
    assert_eq!(
        format(LinkTarget::Url("https://example.org".to_owned()), false).unwrap(),
        None
    );
}

/// Il riferimento scritto, messo in un `href`, si rilegge e si risolve nel
/// documento chiesto. Il bersaglio `Path` è URI-like: un `#` nel nome del
/// file arriva come `%23`, e così resta.
#[test]
fn a_new_reference_reads_back_to_its_target() {
    let doc = fub_abi::model::DocId::new("disegni/ciclo.svg");
    for target in [
        "note/Sale & pepe.md",
        "disegni/L'acqua è #1.md",
        "x/nota:1.md",
    ] {
        let value = SvgProvider
            .format_link(
                &ctx(doc.as_str()),
                &LinkInsert {
                    target: LinkTarget::Path(format!("/{}", percent_encode_path(target))),
                    label: None,
                    embed: false,
                },
            )
            .unwrap()
            .unwrap();
        let source =
            format!(r#"<svg xmlns="http://www.w3.org/2000/svg"><a href="{value}"/></svg>"#);
        let written = &paths(&source)[0];
        assert_eq!(
            fub_abi::rules::path::resolve_against(&doc, written).as_deref(),
            Some(target),
            "{value}"
        );
    }
}
