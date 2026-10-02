//! Il modello di §9: ciò che indice, ricerca, grafo e outline leggono di una
//! scena.
//!
//! La lettura è di `fub-scene`, che dà titolo, descrizione, testi,
//! collegamenti e immagini del vault con lo span del loro elemento. Qui si
//! mettono in un albero che dice la verità sulla sorgente: il documento intero
//! è il blocco [`SUMMARY_KIND`], e i suoi figli sono quegli elementi annidati
//! come lo sono nel file. Un `a` che contiene un `text` è un collegamento con
//! quel testo per etichetta; un `a` dentro un `text` è un collegamento in mezzo
//! al paragrafo. Così le tabelle piatte sono la proiezione dell'albero, e i
//! fratelli non si sovrappongono.

use std::iter::Peekable;

use fub_abi::custom::SECTIONS_ATTR;
use fub_abi::format::ParseContext;
use fub_abi::model::{
    Block, DocId, DocumentModel, Heading, HeadingSlugs, Inline, Link, LinkTarget, Span,
};
use fub_abi::rules::snippet;
use fub_abi::FormatError;
use fub_scene::{Excerpt, Reference, Scene, MAX_DEPTH};

/// Il `custom_kind` del blocco che è il documento intero. I suoi `attrs` sono
/// il riepilogo di §9: versione, livelli, conteggi, inchiostro e rettangolo.
pub const SUMMARY_KIND: &str = "fub.scene.summary";

/// Legge `source`, il testo intero del file, BOM compreso.
///
/// Un file malformato, o con una radice che non è `svg` di SVG, non è una
/// scena: l'errore porta il byte dove si vede, come lo dà `fub-scene` (§2).
pub(crate) fn parse(source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
    let scene = fub_scene::read(source).map_err(|error| FormatError::Parse(error.to_string()))?;
    model_of(&scene, source, DocId::new(ctx.doc_id.clone()))
}

/// Un elemento della scena che il modello nomina.
#[derive(Copy, Clone)]
enum Piece<'s> {
    /// Il `title` della radice: l'heading di livello 1.
    Title(&'s Excerpt),
    /// Il `desc` della radice.
    Desc(&'s Excerpt),
    /// Un `text`, con le righe unite.
    Text(&'s Excerpt),
    /// Un `a` verso il vault.
    Link(&'s Reference),
    /// Un `image` con un percorso del vault.
    Embed(&'s Reference),
}

impl Piece<'_> {
    /// Il testo di un titolo, di una descrizione o di un testo.
    fn text(&self) -> Option<&str> {
        match self {
            Piece::Title(excerpt) | Piece::Desc(excerpt) | Piece::Text(excerpt) => {
                Some(&excerpt.text)
            }
            Piece::Link(_) | Piece::Embed(_) => None,
        }
    }
}

/// Un elemento con quelli che contiene.
struct Node<'s> {
    piece: Piece<'s>,
    span: Span,
    children: Vec<Node<'s>>,
}

fn span_of(span: &fub_scene::Span) -> Span {
    Span::new(span.bytes[0], span.bytes[1])
}

fn model_of(scene: &Scene, source: &str, id: DocId) -> Result<DocumentModel, FormatError> {
    let index = &scene.index;
    let mut pieces: Vec<(Span, Piece<'_>)> = Vec::new();
    pieces.extend(
        index
            .title
            .iter()
            .map(|t| (span_of(&t.span), Piece::Title(t))),
    );
    pieces.extend(
        index
            .desc
            .iter()
            .map(|d| (span_of(&d.span), Piece::Desc(d))),
    );
    pieces.extend(
        index
            .texts
            .iter()
            .map(|t| (span_of(&t.span), Piece::Text(t))),
    );
    pieces.extend(
        index
            .links
            .iter()
            .map(|r| (span_of(&r.span), Piece::Link(r))),
    );
    pieces.extend(
        index
            .embeds
            .iter()
            .map(|r| (span_of(&r.span), Piece::Embed(r))),
    );
    // Gli elementi XML si annidano o stanno separati: in ordine d'inizio, e a
    // parità il più largo prima, ogni elemento viene dopo chi lo contiene.
    pieces.sort_by_key(|(span, _)| (span.start, std::cmp::Reverse(span.end)));

    let mut model = DocumentModel::empty(id);
    model.text = pieces
        .iter()
        .filter_map(|(_, piece)| piece.text())
        .collect::<Vec<_>>()
        .join("\n");

    let mut pieces = pieces.into_iter().peekable();
    let forest = forest(&mut pieces, usize::MAX, 0);

    let mut slugs = HeadingSlugs::new();
    let mut blocks = Vec::with_capacity(forest.len());
    for node in &forest {
        blocks.push(block_of(node, &mut model, &mut slugs));
    }

    let mut attrs = serde_json::to_value(&scene.summary)
        .map_err(|error| FormatError::Parse(format!("riepilogo della scena: {error}")))?;
    // Un disegno ha una sezione sola, il titolo, ed è il disegno intero:
    // `![[disegno#Titolo]]` lo incorpora tutto, e un altro nome non è una
    // sezione del disegno. Senza la dichiarazione il kernel cercherebbe i
    // blocchi che cominciano dal titolo in poi, e il riepilogo, che contiene
    // tutto, comincia prima: l'embed sarebbe vuoto.
    attrs[SECTIONS_ATTR] = model
        .outline
        .iter()
        .filter(|heading| !heading.text.is_empty())
        .map(|heading| serde_json::Value::String(heading.text.clone()))
        .collect();
    let bom = if source.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    model.body.push(Block::Custom {
        custom_kind: SUMMARY_KIND.to_owned(),
        attrs,
        blocks,
        anchor: None,
        span: Span::new(bom, source.len()),
    });
    Ok(model)
}

/// Gli elementi che cominciano prima di `end`, ciascuno con quelli che
/// contiene.
///
/// L'albero si ferma a [`MAX_DEPTH`] livelli, la profondità oltre la quale un
/// contenitore di una scena è estraneo (§4): più in fondo gli elementi restano
/// nel modello, fratelli dell'ultimo livello. È un caso che solo un file
/// costruito apposta raggiunge, e senza il limite ogni livello costerebbe una
/// chiamata a chi costruisce, confronta e libera il modello.
fn forest<'s, I>(pieces: &mut Peekable<I>, end: usize, depth: usize) -> Vec<Node<'s>>
where
    I: Iterator<Item = (Span, Piece<'s>)>,
{
    let mut nodes = Vec::new();
    while let Some((span, piece)) = pieces.next_if(|(span, _)| span.start < end) {
        let children = if depth < MAX_DEPTH {
            forest(pieces, span.end, depth + 1)
        } else {
            Vec::new()
        };
        nodes.push(Node {
            piece,
            span,
            children,
        });
    }
    nodes
}

/// Il blocco di un elemento che sta direttamente nella scena.
fn block_of(node: &Node<'_>, model: &mut DocumentModel, slugs: &mut HeadingSlugs) -> Block {
    match node.piece {
        Piece::Title(excerpt) => {
            let mut inlines = vec![Inline::Text(excerpt.text.clone())];
            links_within(&node.children, Some(&excerpt.text), &mut inlines, model);
            let slug = slugs.next_slug(&excerpt.text);
            model.outline.push(Heading {
                level: 1,
                text: excerpt.text.clone(),
                slug: slug.clone(),
                span: node.span,
                explicit_anchor: None,
            });
            Block::Heading {
                level: 1,
                inlines,
                anchor: Some(slug),
                span: node.span,
                explicit_anchor: None,
            }
        }
        Piece::Desc(excerpt) | Piece::Text(excerpt) => {
            let mut inlines = vec![Inline::Text(excerpt.text.clone())];
            links_within(&node.children, Some(&excerpt.text), &mut inlines, model);
            Block::Paragraph {
                inlines,
                anchor: None,
                span: node.span,
            }
        }
        // Un collegamento o un'immagine fuori da ogni testo è un paragrafo
        // fatto solo del riferimento.
        Piece::Link(_) | Piece::Embed(_) => Block::Paragraph {
            inlines: vec![link_of(node, None, model)],
            anchor: None,
            span: node.span,
        },
    }
}

/// I riferimenti contenuti in un testo: il testo è già nel blocco, e qui
/// arrivano, in ordine, i collegamenti e le immagini che ci stanno dentro.
fn links_within(
    children: &[Node<'_>],
    around: Option<&str>,
    out: &mut Vec<Inline>,
    model: &mut DocumentModel,
) {
    for child in children {
        match child.piece.text() {
            Some(text) => links_within(&child.children, Some(text), out, model),
            None => out.push(link_of(child, around, model)),
        }
    }
}

/// L'inline di un collegamento o di un'immagine, con l'etichetta fatta di ciò
/// che contiene. La voce della tabella `links` entra **prima** di quelle della
/// sua etichetta: è l'ordine in cui le trova chi cammina l'albero.
///
/// `around` è il testo che contiene il riferimento, se ce n'è uno: il contesto
/// del backlink quando l'etichetta non ha testo suo.
fn link_of(node: &Node<'_>, around: Option<&str>, model: &mut DocumentModel) -> Inline {
    let (reference, embed) = match node.piece {
        Piece::Link(reference) => (reference, false),
        Piece::Embed(reference) => (reference, true),
        Piece::Title(_) | Piece::Desc(_) | Piece::Text(_) => {
            unreachable!("un testo non è un riferimento")
        }
    };
    let target = LinkTarget::Path(reference.path.clone());
    let at = model.links.len();
    model.links.push(Link {
        target: target.clone(),
        embed,
        span: node.span,
        context: None,
    });
    let label = (!node.children.is_empty()).then(|| label_of(&node.children, around, model));
    let own = label
        .iter()
        .flatten()
        .filter_map(|inline| match inline {
            Inline::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let context = if own.is_empty() {
        around.map(|text| snippet::window(text, 0..0))
    } else {
        Some(snippet::window(&own, 0..0))
    };
    model.links[at].context = context.filter(|context| !context.is_empty());
    Inline::Link {
        target,
        label,
        embed,
        span: node.span,
    }
}

/// L'etichetta di un collegamento: i testi che contiene, separati da un a
/// capo morbido, con i riferimenti che stanno dentro ciascuno.
fn label_of(children: &[Node<'_>], around: Option<&str>, model: &mut DocumentModel) -> Vec<Inline> {
    let mut label = Vec::new();
    for child in children {
        match child.piece.text() {
            Some(text) => {
                if !label.is_empty() {
                    label.push(Inline::SoftBreak);
                }
                label.push(Inline::Text(text.to_owned()));
                links_within(&child.children, Some(text), &mut label, model);
            }
            None => label.push(link_of(child, around, model)),
        }
    }
    label
}
