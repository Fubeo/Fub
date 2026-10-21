//! **Il testo indicizzato dice ciò che si legge, e gli span coprono ciò che
//! nominano.**
//!
//! Tre casi che stavano fra le divergenze dichiarate di `the_corpus.rs`: l'alt
//! di un'immagine fuori dal testo, la sintassi `![[` dentro, e il termine di
//! una definition list stretta con uno span di un byte.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block, DocumentModel, Span};
use fub_format_markdown::MarkdownProvider;

fn parse(source: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian("nota.md"))
        .expect("markdown valido")
}

#[test]
fn the_alt_of_an_image_is_text_of_its_block() {
    let doc = parse("![una *didascalia*](f.png) e ![](vuota.png)\n");
    assert_eq!(doc.text.trim(), "una didascalia e");
    let link = &doc.links[0];
    assert_eq!(link.context.as_deref(), Some("una didascalia e"));
}

#[test]
fn an_embed_is_text_by_what_it_shows() {
    let doc = parse("![[Nota]], ![[Nota#Sezione]] e ![[Nota^b1|il blocco]]\n");
    assert_eq!(doc.text.trim(), "Nota, Nota#Sezione e il blocco");
    assert!(!doc.text.contains("![["));
    // I byte del file restano quelli: la proiezione è del testo, non della sorgente.
    assert_eq!(doc.links.len(), 3);
    assert!(doc.links.iter().all(|link| link.embed));
}

fn term_span(doc: &DocumentModel) -> (Span, Span) {
    match &doc.body[..] {
        [Block::Custom { blocks, .. }] => match &blocks[..] {
            [Block::Custom {
                custom_kind,
                blocks: term,
                span,
                ..
            }, ..]
                if custom_kind == custom_kind::DEFINITION_TERM =>
            {
                (*span, term[0].span())
            }
            other => panic!("termine atteso, trovati: {other:#?}"),
        },
        other => panic!("definition list attesa, trovata: {other:#?}"),
    }
}

#[test]
fn the_term_of_a_tight_definition_list_spans_its_line() {
    let source = "Tèrmine 🎉 #tag\n: la definizione\n";
    let doc = parse(source);
    let (term, paragraph) = term_span(&doc);
    assert_eq!(&source[term.start..term.end], "Tèrmine 🎉 #tag");
    assert_eq!(paragraph, term);
    let tag = &doc.tags[0];
    assert!(term.start <= tag.span.start && tag.span.end <= term.end);
    // La forma larga aveva già lo span giusto, e lo tiene.
    let loose = "Termine\n\n: la definizione\n";
    let (term, _) = term_span(&parse(loose));
    assert_eq!(&loose[term.start..term.end], "Termine");
}
