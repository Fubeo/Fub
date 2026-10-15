//! Il provider dentro un host, quello in memoria del banco: un disegno che
//! nasce, un modello che indica i byte giusti del file, una riscrittura che
//! passa per `apply_edit` con la sua revisione.

use fub_abi::edit::EditRequest;
use fub_abi::format::{DocumentFormat, DocumentSource, LinkRewrite, ParseContext};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::options::{source, syntax};
use fub_abi::traits::{VaultRead, VaultStructure, VaultWrite};
use fub_abi::{FormatProvider, PluginError};
use fub_format_svg::SvgProvider;
use fub_sdk::testing::MemoryHost;

const FOREIGN: &str = include_str!("fixtures/foreign-crlf-bom.svg");

fn svg_format() -> DocumentFormat {
    DocumentFormat {
        descriptor: SvgProvider.descriptor(),
        capabilities: SvgProvider.capabilities(),
    }
}

fn parse(id: &str, source: &str) -> DocumentModel {
    SvgProvider
        .parse(
            &DocumentSource::Text(source.to_owned()),
            &ParseContext::obsidian(id),
        )
        .unwrap()
}

/// Una feature che decide da una capacità riceve per un disegno «niente»: non
/// è prosa, non ha wikilink, tag, frontmatter né incorporamenti da scrivere.
#[test]
fn a_drawing_declares_no_syntax_to_the_features() {
    let host = MemoryHost::new().with_format("svg", svg_format());
    let format = host.format_of(&DocId::new("disegni/acqua.svg")).unwrap();
    assert_eq!(format.descriptor.id, "svg");
    for name in [
        source::PROSE,
        syntax::WIKILINKS,
        syntax::TAGS,
        syntax::FRONTMATTER,
        syntax::EMBEDS,
        syntax::CALLOUTS,
    ] {
        assert!(!format.capabilities.supports(name), "{name}");
    }
    // Il markdown di serie resta quello.
    let markdown = host.format_of(&DocId::new("nota.md")).unwrap();
    assert!(markdown.capabilities.supports(source::PROSE));
    // Senza il formato registrato un `.svg` non è un documento di nessuno.
    assert_eq!(MemoryHost::new().format_of(&DocId::new("acqua.svg")), None);
}

#[test]
fn a_new_drawing_is_created_and_read_back() {
    let id = DocId::new("disegni/Nuovo disegno.svg");
    let source = SvgProvider
        .serialize(&DocumentModel::empty(id.clone()))
        .unwrap();
    let mut host = MemoryHost::new().with_format("svg", svg_format());
    host.create_document(&id, &source).unwrap();
    assert_eq!(host.read_document(&id).unwrap(), source);
    let model = parse(id.as_str(), &host.read_document(&id).unwrap());
    assert_eq!(model.outline[0].text, "Nuovo disegno");
    assert!(matches!(
        host.create_document(&id, &source),
        Err(PluginError::AlreadyExists(_))
    ));
}

/// Lo span di un collegamento o del titolo, applicato al file che l'host
/// restituisce, è l'elemento: chi «mostra» un collegamento nel disegno lo
/// trova lì.
#[test]
fn the_model_points_at_the_bytes_the_host_serves() {
    let id = "mappe/quartiere.svg";
    let host = MemoryHost::new()
        .with_format("svg", svg_format())
        .with_document(id, FOREIGN)
        .with_model(id, parse(id, FOREIGN));
    let source = host.read_document(&DocId::new(id)).unwrap();
    let model = host.read_model(&DocId::new(id)).unwrap();
    let title = &source[model.outline[0].span.start..model.outline[0].span.end];
    assert_eq!(title, "<title>Mappa del quartiere</title>");
    let elements: Vec<_> = model
        .links
        .iter()
        .map(|link| &source[link.span.start..link.span.end])
        .collect();
    assert!(elements[0].starts_with("<a xlink:href='quartiere/parco.md'"));
    assert!(elements[0].ends_with("</a>"));
    assert!(elements[1].starts_with("<image xlink:href=\"foto/mappa.png\""));
}

/// La rinomina come la vede chi scrive: le patch del provider, sulla
/// revisione letta, in una richiesta sola. Il BOM, i CRLF e ogni altro byte
/// restano; la stessa richiesta su un file cambiato si rifiuta.
#[test]
fn a_rewrite_goes_through_apply_edit() {
    let id = DocId::new("mappe/quartiere.svg");
    let mut host = MemoryHost::new()
        .with_format("svg", svg_format())
        .with_document(id.as_str(), FOREIGN);
    let before = host.read_document(&id).unwrap();
    let model = parse(id.as_str(), &before);
    let rewrites: Vec<_> = model
        .links
        .iter()
        .map(|link| LinkRewrite {
            span: link.span,
            target: link.target.clone(),
            replacement: "../archivio/vecchio.md".to_owned(),
        })
        .collect();
    let edits = SvgProvider
        .rewrite_links(
            &DocumentSource::Text(before.clone()),
            &ParseContext::obsidian(id.as_str()),
            &rewrites,
        )
        .unwrap()
        .unwrap();
    let base = host.document_revision(&id).unwrap();
    let request = EditRequest::new(base, edits);
    let report = host.apply_edit(&id, request.clone()).unwrap();
    assert_eq!(report.applied.len(), 3);

    let after = host.read_document(&id).unwrap();
    assert!(after.starts_with('\u{feff}'));
    assert_eq!(
        after.matches("\r\n").count(),
        before.matches("\r\n").count()
    );
    assert_eq!(
        after,
        before
            .replace("'quartiere/parco.md'", "'../archivio/vecchio.md'")
            .replace("\"foto/mappa.png\"", "\"../archivio/vecchio.md\"")
    );
    assert!(parse(id.as_str(), &after)
        .links
        .iter()
        .all(|link| link.target
            == fub_abi::model::LinkTarget::Path("../archivio/vecchio.md".to_owned())));
    assert!(host.apply_edit(&id, request).is_err());
}
