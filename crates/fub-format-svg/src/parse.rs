//! Il modello di §9: ciò che indice, ricerca, grafo e outline leggono di una
//! scena, e allo stesso modo di un insieme di annotazioni.
//!
//! La lettura è di `fub-scene`, che dà titolo, descrizione, testi,
//! collegamenti e immagini del vault con lo span del loro elemento, e per un
//! `.fubann` anche il PDF annotato, le pagine e le note. Qui si mettono in un
//! albero che dice la verità sulla sorgente: il documento intero è un blocco
//! di riepilogo, [`SUMMARY_KIND`] o [`ANNOTATIONS_KIND`], e i suoi figli sono
//! quegli elementi annidati come lo sono nel file. Un `a` che contiene un
//! `text` è un collegamento con quel testo per etichetta; un `a` dentro un
//! `text` è un collegamento in mezzo al paragrafo. Così le tabelle piatte sono
//! la proiezione dell'albero, e i fratelli non si sovrappongono.

use std::collections::HashSet;
use std::iter::Peekable;

use fub_abi::custom::SECTIONS_ATTR;
use fub_abi::format::ParseContext;
use fub_abi::model::{
    Block, DocId, DocumentModel, Heading, HeadingSlugs, Inline, Link, LinkTarget, Span,
};
use fub_abi::rules::snippet;
use fub_abi::FormatError;
use fub_scene::{Annotated, Annotations, Excerpt, Index, Note, Page, Reference, Scene, MAX_DEPTH};
use serde_json::{json, Value};

/// Il `custom_kind` del blocco che è il disegno intero. I suoi `attrs` sono
/// il riepilogo di §9: versione, livelli, conteggi, inchiostro e rettangolo.
pub const SUMMARY_KIND: &str = "fub.scene.summary";

/// Il `custom_kind` del blocco che è un `.fubann` intero. I suoi `attrs`
/// sono versione, conteggi e inchiostro della scena, il PDF annotato con
/// impronta e numero di pagine, e le sezioni: il titolo e una `page=k` per
/// ogni pagina.
pub const ANNOTATIONS_KIND: &str = "fub.annotations.summary";

/// Il `custom_kind` di un gruppo di pagina. `attrs` porta `page`, il numero
/// da 1, e `size`, larghezza e altezza in punti PDF o `null`.
pub const PAGE_KIND: &str = "fub.annotations.page";

/// Il `custom_kind` di una nota. I figli sono due paragrafi in ordine di
/// sorgente: il corpo, con una riga per ogni riga non vuota, e il testo
/// disegnato, che manca se la nota non ne mostra.
pub const NOTE_KIND: &str = "fub.annotations.note";

/// Il prefisso delle sezioni di pagina: `page=3` come nel frammento con cui
/// un collegamento apre il PDF a quella pagina.
pub const PAGE_SECTION: &str = "page=";

/// Legge `source`, il testo intero del file, BOM compreso.
///
/// Un file malformato, o con una radice che non è `svg` di SVG, non è una
/// scena: l'errore porta il byte dove si vede, come lo dà `fub-scene` (§2).
pub(crate) fn parse(source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
    let scene = fub_scene::read(source).map_err(|error| FormatError::Parse(error.to_string()))?;
    let pieces = pieces_of(&scene.index, &HashSet::new());
    let attrs = summary_of(&scene)?;
    Ok(model_of(
        source,
        DocId::new(ctx.doc_id.clone()),
        pieces,
        SUMMARY_KIND,
        attrs,
        Vec::new(),
    ))
}

/// Legge `source`, un `.fubann` intero, BOM compreso.
///
/// Il modello è quello di un disegno, con tre cose in più: il PDF annotato è
/// un collegamento, con lo span del valore di `fub:annotates`; ogni gruppo di
/// pagina è un blocco [`PAGE_KIND`] con le annotazioni che contiene; ogni nota
/// è un blocco [`NOTE_KIND`]. Impronta e numero di pagine stanno nel
/// riepilogo come sono scritti: confrontarli con il PDF non tocca al provider,
/// che riceve solo questa sorgente.
pub(crate) fn parse_annotations(
    source: &str,
    ctx: &ParseContext,
) -> Result<DocumentModel, FormatError> {
    let annotations = fub_scene::read_annotations(source)
        .map_err(|error| FormatError::Parse(error.to_string()))?;
    let notes: HashSet<usize> = annotations
        .notes
        .iter()
        .map(|note| note.span.bytes[0])
        .collect();
    let mut pieces = pieces_of(&annotations.scene.index, &notes);
    pieces.extend(
        annotations
            .annotates
            .iter()
            .map(|a| (span_of(&a.value), Piece::Annotated(a))),
    );
    pieces.extend(
        annotations
            .pages
            .iter()
            .map(|page| (span_of(&page.span), Piece::Page(page))),
    );
    pieces.extend(
        annotations
            .notes
            .iter()
            .map(|note| (span_of(&note.span), Piece::Note(note))),
    );

    // Una sezione per numero, nell'ordine del file: due gruppi con lo stesso
    // numero sono la stessa pagina.
    let mut sections = Vec::new();
    for page in &annotations.pages {
        let name = format!("{PAGE_SECTION}{}", page.number);
        if !sections.contains(&name) {
            sections.push(name);
        }
    }
    Ok(model_of(
        source,
        DocId::new(ctx.doc_id.clone()),
        pieces,
        ANNOTATIONS_KIND,
        annotations_summary_of(&annotations)?,
        sections,
    ))
}

/// Gli `attrs` del riepilogo di un disegno: il [`fub_scene::Summary`].
fn summary_of(scene: &Scene) -> Result<Value, FormatError> {
    serde_json::to_value(&scene.summary)
        .map_err(|error| FormatError::Parse(format!("riepilogo della scena: {error}")))
}

/// Gli `attrs` del riepilogo di un `.fubann`: quello della scena senza
/// livelli né rettangolo, e in più il PDF annotato, l'impronta e il numero di
/// pagine.
///
/// Le pagine hanno ciascuna le sue coordinate, tutte con l'origine in alto a
/// sinistra: un rettangolo che le unisse non direbbe dove sta niente. I
/// livelli non ci sono, perché i gruppi della radice sono pagine.
/// *(Proposta del 3 ottobre 2026, da rivedere.)*
fn annotations_summary_of(annotations: &Annotations) -> Result<Value, FormatError> {
    let mut attrs = summary_of(&annotations.scene)?;
    if let Some(object) = attrs.as_object_mut() {
        object.remove("layers");
        object.remove("bbox");
    }
    attrs["annotates"] = json!(annotations.annotates.as_ref().map(|a| &a.path));
    attrs["digest"] = json!(annotations.digest);
    attrs["pages"] = json!(annotations.page_count);
    Ok(attrs)
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
    /// Il PDF annotato: il valore di `fub:annotates` sulla radice.
    Annotated(&'s Annotated),
    /// Un gruppo di pagina di un `.fubann`.
    Page(&'s Page),
    /// Una nota: un `text` con `fub:note`.
    Note(&'s Note),
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

/// Gli elementi dell'indice di una scena, tranne i testi che cominciano in
/// `notes`: quelli sono note, e il chiamante li aggiunge come tali.
fn pieces_of<'s>(index: &'s Index, notes: &HashSet<usize>) -> Vec<(Span, Piece<'s>)> {
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
            .filter(|t| !notes.contains(&t.span.bytes[0]))
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
    pieces
}

/// Le righe del corpo di una nota come le legge l'indice: ogni riga con gli
/// spazi XML ridotti a uno e niente spazi ai bordi, le righe vuote tolte.
fn body_lines(note: &Note) -> Vec<String> {
    note.body
        .split('\n')
        .map(|line| {
            line.split([' ', '\t', '\r'])
                .filter(|word| !word.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect()
}

/// I testi che un elemento porta alla ricerca: titolo, descrizione e testi
/// per intero; di una nota il testo disegnato, se c'è, e le righe del corpo.
fn searchable(piece: &Piece<'_>) -> Vec<String> {
    match piece {
        Piece::Title(excerpt) | Piece::Desc(excerpt) | Piece::Text(excerpt) => {
            vec![excerpt.text.clone()]
        }
        Piece::Note(note) => {
            let mut lines = Vec::new();
            if !note.text.is_empty() {
                lines.push(note.text.clone());
            }
            lines.extend(body_lines(note));
            lines
        }
        Piece::Link(_) | Piece::Embed(_) | Piece::Annotated(_) | Piece::Page(_) => Vec::new(),
    }
}

/// Il modello: il corpo è un blocco solo, `kind`, che va dal primo byte dopo
/// il BOM alla fine del file e contiene gli elementi di `pieces` annidati come
/// nel file.
///
/// Le sezioni nominate del blocco sono il titolo, se non è vuoto, e poi
/// `sections`. Senza la dichiarazione il kernel cercherebbe i blocchi che
/// cominciano dal titolo in poi, e il riepilogo, che contiene tutto, comincia
/// prima: l'embed sarebbe vuoto.
fn model_of(
    source: &str,
    id: DocId,
    mut pieces: Vec<(Span, Piece<'_>)>,
    kind: &str,
    mut attrs: Value,
    sections: Vec<String>,
) -> DocumentModel {
    // Gli elementi XML si annidano o stanno separati: in ordine d'inizio, e a
    // parità il più largo prima, ogni elemento viene dopo chi lo contiene.
    pieces.sort_by_key(|(span, _)| (span.start, std::cmp::Reverse(span.end)));

    let mut model = DocumentModel::empty(id);
    let texts: Vec<(bool, String)> = pieces
        .iter()
        .flat_map(|(_, piece)| {
            let title = matches!(piece, Piece::Title(_));
            searchable(piece).into_iter().map(move |text| (title, text))
        })
        .collect();
    model.text = texts
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    // Il contesto del backlink del PDF annotato: il testo delle annotazioni
    // senza il titolo, che chi mostra il backlink nomina già.
    // *(Proposta del 3 ottobre 2026, da rivedere.)*
    let annotations = texts
        .iter()
        .filter(|(title, _)| !title)
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    let mut pieces = pieces.into_iter().peekable();
    let forest = forest(&mut pieces, usize::MAX, 0);

    let mut tree = Tree {
        model,
        slugs: HeadingSlugs::new(),
        annotated_context: Some(snippet::window(&annotations, 0..0))
            .filter(|context| !context.is_empty()),
    };
    let blocks = forest.iter().map(|node| tree.block(node)).collect();
    let mut model = tree.model;

    // Un disegno ha una sezione sola, il titolo, ed è il disegno intero:
    // `![[disegno#Titolo]]` lo incorpora tutto, e un altro nome non è una
    // sezione del disegno.
    attrs[SECTIONS_ATTR] = model
        .outline
        .iter()
        .filter(|heading| !heading.text.is_empty())
        .map(|heading| heading.text.clone())
        .chain(sections)
        .map(Value::String)
        .collect();
    let bom = if source.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    model.body.push(Block::Custom {
        custom_kind: kind.to_owned(),
        attrs,
        blocks,
        anchor: None,
        span: Span::new(bom, source.len()),
    });
    model
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

/// Chi costruisce i blocchi: la tabella dei collegamenti e l'outline crescono
/// mentre si cammina l'albero, nell'ordine in cui le trova chi lo rilegge.
struct Tree {
    model: DocumentModel,
    slugs: HeadingSlugs,
    /// Il contesto del backlink del PDF annotato.
    annotated_context: Option<String>,
}

impl Tree {
    /// Il blocco di un elemento che sta nel riepilogo o in una pagina.
    fn block(&mut self, node: &Node<'_>) -> Block {
        match node.piece {
            Piece::Title(excerpt) => {
                let mut inlines = vec![Inline::Text(excerpt.text.clone())];
                self.links_within(&node.children, Some(&excerpt.text), &mut inlines);
                let slug = self.slugs.next_slug(&excerpt.text);
                self.model.outline.push(Heading {
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
                self.links_within(&node.children, Some(&excerpt.text), &mut inlines);
                Block::Paragraph {
                    inlines,
                    anchor: None,
                    span: node.span,
                }
            }
            // Un riferimento fuori da ogni testo è un paragrafo fatto solo del
            // riferimento; il PDF annotato è sempre così.
            Piece::Link(_) | Piece::Embed(_) | Piece::Annotated(_) => Block::Paragraph {
                inlines: vec![self.link(node, None)],
                anchor: None,
                span: node.span,
            },
            Piece::Page(page) => Block::Custom {
                custom_kind: PAGE_KIND.to_owned(),
                attrs: json!({ "page": page.number, "size": page.size }),
                blocks: node
                    .children
                    .iter()
                    .map(|child| self.block(child))
                    .collect(),
                anchor: None,
                span: node.span,
            },
            Piece::Note(note) => self.note(node, note),
        }
    }

    /// Il blocco di una nota: il paragrafo del corpo, con le righe separate
    /// da un a capo e lo span del valore di `fub:note`, e poi quello del testo
    /// disegnato, con i riferimenti che contiene e lo span del contenuto del
    /// `text`. È l'ordine della sorgente: il valore sta nel tag d'apertura, il
    /// contenuto dopo, e i due span non si toccano.
    fn note(&mut self, node: &Node<'_>, note: &Note) -> Block {
        let mut blocks = vec![Block::Paragraph {
            inlines: lines_of(body_lines(note)),
            anchor: None,
            span: span_of(&note.value),
        }];
        let mut inlines = Vec::new();
        if !note.text.is_empty() {
            inlines.push(Inline::Text(note.text.clone()));
        }
        let around = Some(note.text.as_str()).filter(|text| !text.is_empty());
        self.links_within(&node.children, around, &mut inlines);
        // Testo e riferimenti stanno fra i tag: senza contenuto non ce n'è.
        if let (false, Some(content)) = (inlines.is_empty(), note.content) {
            blocks.push(Block::Paragraph {
                inlines,
                anchor: None,
                span: span_of(&content),
            });
        }
        Block::Custom {
            custom_kind: NOTE_KIND.to_owned(),
            attrs: json!({}),
            blocks,
            anchor: None,
            span: node.span,
        }
    }

    /// I riferimenti contenuti in un testo: il testo è già nel blocco, e qui
    /// arrivano, in ordine, i collegamenti e le immagini che ci stanno dentro.
    fn links_within(&mut self, children: &[Node<'_>], around: Option<&str>, out: &mut Vec<Inline>) {
        for child in children {
            match child.piece {
                Piece::Title(excerpt) | Piece::Desc(excerpt) | Piece::Text(excerpt) => {
                    self.links_within(&child.children, Some(&excerpt.text), out);
                }
                Piece::Note(note) => {
                    let text = Some(note.text.as_str()).filter(|text| !text.is_empty());
                    self.links_within(&child.children, text.or(around), out);
                }
                Piece::Page(_) => self.links_within(&child.children, around, out),
                Piece::Link(_) | Piece::Embed(_) | Piece::Annotated(_) => {
                    out.push(self.link(child, around));
                }
            }
        }
    }

    /// L'inline di un riferimento, con l'etichetta fatta di ciò che contiene.
    /// La voce della tabella `links` entra **prima** di quelle della sua
    /// etichetta: è l'ordine in cui le trova chi cammina l'albero.
    ///
    /// `around` è il testo che contiene il riferimento, se ce n'è uno: il
    /// contesto del backlink quando l'etichetta non ha testo suo. Il PDF
    /// annotato ha per contesto il testo delle annotazioni.
    fn link(&mut self, node: &Node<'_>, around: Option<&str>) -> Inline {
        let (path, embed) = match node.piece {
            Piece::Link(reference) => (&reference.path, false),
            Piece::Embed(reference) => (&reference.path, true),
            Piece::Annotated(annotated) => (&annotated.path, false),
            Piece::Title(_) | Piece::Desc(_) | Piece::Text(_) | Piece::Page(_) | Piece::Note(_) => {
                unreachable!("sono riferimenti solo i collegamenti, le immagini e il PDF annotato")
            }
        };
        let target = LinkTarget::Path(path.clone());
        let at = self.model.links.len();
        self.model.links.push(Link {
            target: target.clone(),
            embed,
            span: node.span,
            context: None,
        });
        let label = (!node.children.is_empty()).then(|| self.label(&node.children, around));
        let own = label
            .iter()
            .flatten()
            .filter_map(|inline| match inline {
                Inline::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        let context = if matches!(node.piece, Piece::Annotated(_)) {
            self.annotated_context.clone()
        } else if own.is_empty() {
            around.map(|text| snippet::window(text, 0..0))
        } else {
            Some(snippet::window(&own, 0..0))
        };
        self.model.links[at].context = context.filter(|context| !context.is_empty());
        Inline::Link {
            target,
            label,
            embed,
            span: node.span,
        }
    }

    /// L'etichetta di un collegamento: i testi che contiene, separati da un a
    /// capo morbido, con i riferimenti che stanno dentro ciascuno. Una nota ci
    /// porta il testo disegnato e le righe del corpo.
    fn label(&mut self, children: &[Node<'_>], around: Option<&str>) -> Vec<Inline> {
        let mut label = Vec::new();
        for child in children {
            match child.piece {
                Piece::Title(excerpt) | Piece::Desc(excerpt) | Piece::Text(excerpt) => {
                    if !label.is_empty() {
                        label.push(Inline::SoftBreak);
                    }
                    label.push(Inline::Text(excerpt.text.clone()));
                    self.links_within(&child.children, Some(&excerpt.text), &mut label);
                }
                Piece::Note(note) => {
                    if !label.is_empty() {
                        label.push(Inline::SoftBreak);
                    }
                    let mut lines = body_lines(note);
                    if !note.text.is_empty() {
                        lines.insert(0, note.text.clone());
                    }
                    label.extend(lines_of(lines));
                    let text = Some(note.text.as_str()).filter(|text| !text.is_empty());
                    self.links_within(&child.children, text.or(around), &mut label);
                }
                Piece::Page(_) => self.links_within(&child.children, around, &mut label),
                Piece::Link(_) | Piece::Embed(_) | Piece::Annotated(_) => {
                    label.push(self.link(child, around));
                }
            }
        }
        label
    }
}

/// Le righe come inline, separate da un a capo.
fn lines_of(lines: Vec<String>) -> Vec<Inline> {
    let mut inlines = Vec::with_capacity(lines.len() * 2);
    for line in lines {
        if !inlines.is_empty() {
            inlines.push(Inline::HardBreak);
        }
        inlines.push(Inline::Text(line));
    }
    inlines
}
