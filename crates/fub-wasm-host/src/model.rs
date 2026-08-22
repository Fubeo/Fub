//! **L'albero più grande del contratto, tradotto.**
//!
//! `document-model` — blocchi, intestazioni, link, proprietà, frontmatter — è
//! la ragione per cui `read-model` rispondeva `unserved` al primo passo di M5:
//! non perché la capacità mancasse, ma perché tradurre l'albero è un lavoro
//! suo. Sta in un modulo separato da `translate.rs` per la stessa ragione per
//! cui il WIT lo dichiara in un'interfaccia sua: è grande, ed è l'unica parte
//! del contratto in cui una conversione ricorsiva può sbagliare in silenzio.
//!
//! # L'albero di qua, l'arena di là
//!
//! Lato Rust il corpo è un albero vero: `Vec<Block>`, e dentro un `Block::Quote`
//! altri `Vec<Block>`. Il WIT non ha tipi ricorsivi — un `record` non può
//! contenere sé stesso — e il contratto risolve la cosa come la risolvono i
//! compilatori: **un'arena piatta più degli indici**. `document-tree` porta
//! tutti i blocchi in una lista, tutti gli inline in un'altra, e le radici in
//! ordine di lettura; ogni figlio è un `u32` dentro quelle liste.
//!
//! La conseguenza pratica è che si deposita **in post-ordine**: un padre non si
//! può scrivere prima di conoscere gli indici dei figli, quindi i figli entrano
//! nell'arena per primi e il padre subito dopo. Chi legge di là ricostruisce
//! l'albero seguendo gli indici, e le radici gli dicono da dove.
//!
//! # Il verso
//!
//! Qui c'è solo `to_*` (dal Rust di `fub-abi` al WIT che il componente riceve),
//! ed è ciò che il contratto dice di questo albero **oggi**: `read-model` lo
//! passa a un guest, e nessuna interfaccia servita dall'host lo riceve indietro.
//! Il giorno che `format.parse` attraverserà — un componente che *è* un
//! `FormatProvider` e restituisce il modello che ha parsato — servirà il `from_*`,
//! e sarà un altro passo con le sue domande (gli indici fuori range, che di
//! qua sono impossibili per costruzione e di là sono dato di un estraneo).

use fub_abi::model as rm;
use fub_abi::PluginError;

use crate::contract::fub::abi::model as wm;
use crate::translate as tr;
// Lo `span` a 64 bit del confine, dal `usize` di casa, è la stessa conversione
// per chiunque attraversi — un albero di documento, un `reveal`, un `text-edit`
// — e per questo sta in `translate`. Ne era nata una copia qui quando quella
// era privata al proprio modulo; non lo è più.
use crate::translate::to_span;

/// Quanti livelli di annidamento questa traduzione scende prima di rifiutarsi.
///
/// La conversione è ricorsiva perché l'albero lo è — una citazione dentro una
/// voce di lista dentro una citazione — e quanto un documento sia profondo non
/// lo decide l'host: lo decide chi scrive il file. Diecimila `>` in testa a una
/// riga sono venti kilobyte di file e diecimila `Block::Quote` annidati nel
/// modello; senza un tetto, tradurli è uno stack overflow del thread del job, e
/// uno stack overflow non è un errore che si legge — è il processo che muore,
/// cioè l'app dell'utente portata giù da un documento. Il §16.1 promette il
/// contrario, e questa costante è metà di quella promessa.
///
/// **Sessantaquattro** perché è oltre il doppio di ciò che una prosa umana
/// annida davvero (una lista a sei rientri è già illeggibile, una citazione a
/// dodici non esiste), e perché sessantaquattro frame di questa ricorsione —
/// poche decine di byte l'uno — restano in una manciata di kilobyte anche sullo
/// stack di un thread del pool. Un tetto più alto non renderebbe leggibile
/// nessun documento in più; uno più basso rifiuterebbe file che qualcuno ha
/// scritto sul serio.
///
/// Il presidio sta **qui** e non nel provider markdown perché il modello può
/// arrivare da chiunque implementi `FormatProvider`: chi traduce è l'ultimo a
/// poter dire di no prima che la ricorsione parta davvero.
pub(crate) const MAX_DEPTH: u32 = 64;

// ---------------------------------------------------------------------------
// Il documento intero
// ---------------------------------------------------------------------------

/// Il modello di documento, dal Rust del kernel al WIT che il componente riceve.
///
/// Fallisce solo per l'albero: le tabelle piatte (outline, link, tag, ancore) e
/// il frontmatter sono conversioni totali, l'unica domanda che può ricevere un
/// «no» è quanto è profondo il corpo.
/// «no» è quanto è profondo il corpo.
pub(crate) fn to_document(m: &rm::DocumentModel) -> Result<wm::DocumentModel, PluginError> {
    Ok(wm::DocumentModel {
        id: m.id.0.clone(),
        frontmatter: to_frontmatter(&m.frontmatter),
        body: to_tree(&m.body)?,
        outline: m.outline.iter().map(to_heading).collect(),
        links: m.links.iter().map(to_link).collect(),
        tags: m.tags.iter().map(to_tag).collect(),
        anchors: m.anchors.iter().map(to_anchor).collect(),
        text: m.text.clone(),
        frontmatter_present: m.frontmatter_present,
    })
}

/// Il frontmatter attraversa come JSON, che al confine è una stringa.
///
/// È la **verità grezza** — ciò che il file dice, ordine delle chiavi compreso
/// (il workspace accende `serde_json/preserve_order`) — e non la sua lettura
/// normalizzata: `property-value` esiste nel WIT ma non dentro `document-model`,
/// perché chi legge un modello vuole il documento com'è e chi vuole «questa
/// proprietà è una data» lo chiede all'indice.
fn to_frontmatter(f: &rm::Frontmatter) -> String {
    serde_json::to_string(&f.0).expect("frontmatter is always serializable")
}

// ---------------------------------------------------------------------------
// Le tabelle piatte: outline, link, tag, ancore
// ---------------------------------------------------------------------------

fn to_heading(h: &rm::Heading) -> wm::Heading {
    wm::Heading {
        level: h.level,
        text: h.text.clone(),
        slug: h.slug.clone(),
        span: to_span(h.span),
        explicit_anchor: h.explicit_anchor.clone(),
    }
}

fn to_target(t: &rm::LinkTarget) -> wm::LinkTarget {
    match t {
        rm::LinkTarget::Wiki {
            page,
            heading,
            block,
        } => wm::LinkTarget::Wiki(wm::LinkTargetWiki {
            page: page.clone(),
            heading: heading.clone(),
            block: block.clone(),
        }),
        rm::LinkTarget::Url(u) => wm::LinkTarget::Url(u.clone()),
        rm::LinkTarget::Path(p) => wm::LinkTarget::Path(p.clone()),
    }
}

fn to_link(the: &rm::Link) -> wm::Link {
    wm::Link {
        target: to_target(&the.target),
        embed: the.embed,
        span: to_span(the.span),
        context: the.context.clone(),
    }
}

fn to_tag(t: &rm::Tag) -> wm::Tag {
    wm::Tag {
        name: t.name.clone(),
        span: to_span(t.span),
    }
}

fn to_anchor(a: &rm::Anchor) -> wm::Anchor {
    wm::Anchor {
        id: a.id.clone(),
        span: to_span(a.span),
        marker: to_span(a.marker),
    }
}

// ---------------------------------------------------------------------------
// Il corpo: l'albero che diventa arena
// ---------------------------------------------------------------------------

/// Il corpo del documento appiattito nelle due liste del contratto.
fn to_tree(body: &[rm::Block]) -> Result<wm::DocumentTree, PluginError> {
    let mut arena = Arena::default();
    let roots = arena.blocks(body, 1)?;
    Ok(wm::DocumentTree {
        blocks: arena.blocks,
        inlines: arena.inline,
        roots,
    })
}

/// Le due liste di `document-tree` mentre si riempiono.
///
/// Non è una comodità: è l'unico posto in cui un indice viene assegnato, e
/// tenerlo unico è ciò che rende impossibile un `block-ref` che punta
/// altrove — «fuori range = modello malformato», dice il WIT, e di qua il caso
/// non si può nemmeno scrivere.
#[derive(Default)]
struct Arena {
    blocks: Vec<wm::Block>,
    inline: Vec<wm::Inline>,
}

impl Arena {
    /// Deposita un blocco già tradotto e restituisce il suo `block-ref`.
    fn place_block(&mut self, b: wm::Block) -> Result<u32, PluginError> {
        let index = reference(self.blocks.len())?;
        self.blocks.push(b);
        Ok(index)
    }

    /// Deposita un inline già tradotto e restituisce il suo `inline-ref`.
    fn place_inline(&mut self, the: wm::Inline) -> Result<u32, PluginError> {
        let index = reference(self.inline.len())?;
        self.inline.push(the);
        Ok(index)
    }

    fn blocks(&mut self, v: &[rm::Block], depth: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|b| self.block(b, depth)).collect()
    }

    fn inline(&mut self, v: &[rm::Inline], depth: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|the| self.single_inline(the, depth)).collect()
    }

    /// Un blocco e tutto ciò che porta dentro, in post-ordine.
    ///
    /// `depth` è il livello di **questo** blocco (le radici stanno a 1) e
    /// non un contatore condiviso: due rami paralleli non si sommano, perché ciò
    /// che consuma lo stack è la discesa, non la larghezza.
    ///
    /// La `match` è esaustiva senza `_ =>`, e non è pignoleria: è il presidio
    /// che il modulo `translate` dichiara in testa a sé stesso. Il giorno che
    /// `Block` cresce di una variante — e cresce, la 0003 ha già promosso la
    /// tabella e lasciato in coda footnote e definition list — questo file
    /// smette di compilare e nomina la riga. Con un `_ =>` che ingoia il caso
    /// nuovo, invece, il blocco nuovo arriverebbe di là come qualcos'altro (o
    /// non arriverebbe affatto) e nessuno lo saprebbe fino a un bug di rendering
    /// in casa di un terzo.
    fn block(&mut self, b: &rm::Block, depth: u32) -> Result<u32, PluginError> {
        if depth > MAX_DEPTH {
            return Err(too_deep());
        }
        let down = depth + 1;
        let translated = match b {
            rm::Block::Heading {
                level,
                inlines,
                anchor,
                span,
                explicit_anchor,
            } => wm::Block::Heading(wm::BlockHeading {
                level: *level,
                inlines: self.inline(inlines, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
                explicit_anchor: explicit_anchor.clone(),
            }),
            rm::Block::Paragraph {
                inlines,
                anchor,
                span,
            } => wm::Block::Paragraph(wm::BlockParagraph {
                inlines: self.inline(inlines, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::List {
                ordered,
                items,
                anchor,
                span,
                start,
            } => {
                let mut entries = Vec::with_capacity(items.len());
                for v in items {
                    entries.push(self.entry(v, down)?);
                }
                wm::Block::List(wm::BlockList {
                    ordered: *ordered,
                    items: entries,
                    anchor: anchor.clone(),
                    span: to_span(*span),
                    start: *start,
                })
            }
            rm::Block::CodeBlock {
                lang,
                code,
                anchor,
                span,
            } => wm::Block::CodeBlock(wm::BlockCodeBlock {
                lang: lang.clone(),
                code: code.clone(),
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::Quote {
                blocks,
                anchor,
                span,
            } => wm::Block::Quote(wm::BlockQuote {
                blocks: self.blocks(blocks, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::ThematicBreak { anchor, span } => {
                wm::Block::ThematicBreak(wm::BlockThematicBreak {
                    anchor: anchor.clone(),
                    span: to_span(*span),
                })
            }
            rm::Block::Custom {
                custom_kind,
                attrs,
                blocks,
                anchor,
                span,
            } => wm::Block::Custom(wm::BlockCustom {
                custom_kind: custom_kind.clone(),
                attrs: tr::to_json(attrs),
                blocks: self.blocks(blocks, down)?,
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
            rm::Block::Table {
                head,
                rows,
                align,
                anchor,
                span,
            } => {
                // Le celle portano **inline**, ed è la ragione per cui la
                // tabella non stava dentro `Custom`: qui si vede in una riga,
                // perché è l'unico ramo che scende negli inline passando da un
                // record che non è un blocco.
                let head = match head {
                    Some(r) => Some(self.row(r, down)?),
                    None => None,
                };
                let mut converted_rows = Vec::with_capacity(rows.len());
                for r in rows {
                    converted_rows.push(self.row(r, down)?);
                }
                wm::Block::Table(wm::BlockTable {
                    head,
                    rows: converted_rows,
                    align: align.iter().map(|a| to_alignment(*a)).collect(),
                    anchor: anchor.clone(),
                    span: to_span(*span),
                })
            }
            rm::Block::ReferenceDefinition {
                label,
                url,
                title,
                anchor,
                span,
            } => wm::Block::ReferenceDefinition(wm::BlockReferenceDefinition {
                label: label.clone(),
                url: url.clone(),
                title: title.clone(),
                anchor: anchor.clone(),
                span: to_span(*span),
            }),
        };
        self.place_block(translated)
    }

    /// Una voce di lista: i suoi blocchi, e la task se è una task.
    fn entry(&mut self, v: &rm::ListItem, depth: u32) -> Result<wm::ListItem, PluginError> {
        Ok(wm::ListItem {
            blocks: self.blocks(&v.blocks, depth)?,
            task: v.task.as_ref().map(to_marker),
            span: to_span(v.span),
        })
    }

    fn row(&mut self, r: &rm::TableRow, depth: u32) -> Result<wm::TableRow, PluginError> {
        let mut cells = Vec::with_capacity(r.cells.len());
        for c in &r.cells {
            cells.push(wm::TableCell {
                inlines: self.inline(&c.inlines, depth)?,
                span: to_span(c.span),
            });
        }
        Ok(wm::TableRow { cells })
    }

    /// Un inline e ciò che porta dentro, in post-ordine.
    ///
    /// Gli inline si annidano quanto i blocchi — un `**grassetto con *corsivo*
    /// dentro**`, l'etichetta di un link che è a sua volta enfasi — e il tetto è
    /// lo stesso: la discesa costa stack qui esattamente come di sopra, e due
    /// budget separati vorrebbero dire che il caso peggiore è la loro somma.
    ///
    /// Si chiama `single_inline` perché `inline` è già il plurale del suo
    /// chiamante; un nome è la firma che si legge dal punto di chiamata.
    fn single_inline(&mut self, the: &rm::Inline, depth: u32) -> Result<u32, PluginError> {
        if depth > MAX_DEPTH {
            return Err(too_deep());
        }
        let down = depth + 1;
        let translated = match the {
            rm::Inline::Text(s) => wm::Inline::Text(s.clone()),
            rm::Inline::Emph(v) => wm::Inline::Emph(self.inline(v, down)?),
            rm::Inline::Strong(v) => wm::Inline::Strong(self.inline(v, down)?),
            rm::Inline::Code(s) => wm::Inline::Code(s.clone()),
            rm::Inline::Link {
                target,
                label,
                embed,
                span,
            } => {
                // L'etichetta assente e l'etichetta vuota sono due cose diverse:
                // `[[Nota]]` non ha etichetta (la si genera dal bersaglio),
                // `[](nota.md)` ne ha una vuota. Il `match` esplicito invece di
                // un `map` perché dentro c'è un `?`.
                let label = match label {
                    Some(v) => Some(self.inline(v, down)?),
                    None => None,
                };
                wm::Inline::Link(wm::InlineLink {
                    target: to_target(target),
                    label,
                    embed: *embed,
                    span: to_span(*span),
                })
            }
            rm::Inline::TagRef { name, span } => wm::Inline::TagRef(wm::InlineTagRef {
                name: name.clone(),
                span: to_span(*span),
            }),
            rm::Inline::Custom {
                custom_kind,
                attrs,
                span,
            } => wm::Inline::Custom(wm::InlineCustom {
                custom_kind: custom_kind.clone(),
                attrs: tr::to_json(attrs),
                span: to_span(*span),
            }),
            rm::Inline::Superscript(v) => wm::Inline::Superscript(self.inline(v, down)?),
            rm::Inline::Strikethrough(v) => wm::Inline::Strikethrough(self.inline(v, down)?),
            rm::Inline::HardBreak => wm::Inline::HardBreak,
            rm::Inline::SoftBreak => wm::Inline::SoftBreak,
        };
        self.place_inline(translated)
    }
}

fn to_marker(t: &rm::TaskMarker) -> wm::TaskMarker {
    wm::TaskMarker {
        symbol: t.symbol,
        span: to_span(t.span),
    }
}

fn to_alignment(a: rm::ColumnAlign) -> wm::ColumnAlign {
    match a {
        rm::ColumnAlign::None => wm::ColumnAlign::None,
        rm::ColumnAlign::Left => wm::ColumnAlign::Left,
        rm::ColumnAlign::Center => wm::ColumnAlign::Center,
        rm::ColumnAlign::Right => wm::ColumnAlign::Right,
    }
}

/// L'indice di un nodo nell'arena, alla larghezza che il contratto dichiara.
///
/// `block-ref` e `inline-ref` sono `u32`, e un `as u32` avrebbe **troncato** in
/// silenzio: il nodo quattro-miliardi-e-uno avrebbe ricevuto l'indice 1, cioè
/// un albero che di là si ricostruisce sbagliato invece di non ricostruirsi. Il
/// caso non capita — un documento con quattro miliardi di nodi non entra nella
/// memoria di nessuno — ma «non capita» e «non si può scrivere» sono due
/// affermazioni diverse, e solo la seconda regge senza qualcuno che la
/// ricontrolli.
fn reference(len: usize) -> Result<u32, PluginError> {
    u32::try_from(len).map_err(|_| {
        PluginError::Internal(
            "the document tree has more nodes than a 32-bit reference can name".into(),
        )
    })
}

/// Il rifiuto di un albero troppo profondo.
///
/// `Internal` e non `BadArgs`: chi ha chiesto il modello non ha sbagliato
/// niente — ha nominato un documento che esiste — ed è l'host a non saperlo
/// portare di là. Il messaggio dice il tetto, perché un limite senza il proprio
/// numero è indistinguibile da un guasto.
fn too_deep() -> PluginError {
    PluginError::Internal(
        format!(
            "l'albero del documento supera i {MAX_DEPTH} livelli di annidamento \
             che l'host traduce"
        )
        .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span() -> rm::Span {
        rm::Span::new(0, 0)
    }

    /// Una citazione dentro l'altra, `n` volte.
    fn quotes(n: u32) -> rm::Block {
        let mut b = rm::Block::Paragraph {
            inlines: vec![rm::Inline::Text("bottom".into())],
            anchor: None,
            span: span(),
        };
        for _ in 0..n {
            b = rm::Block::Quote {
                blocks: vec![b],
                anchor: None,
                span: span(),
            };
        }
        b
    }

    /// L'arena è in post-ordine e le radici sono in ordine di lettura: il figlio
    /// esiste **prima** del padre, ed è ciò che rende ogni riferimento valido
    /// nel momento in cui viene scritto.
    #[test]
    fn the_child_enters_the_arena_before_the_parent() {
        let tree = to_tree(&[quotes(1)]).expect("two levels pass");
        assert_eq!(tree.roots, vec![1], "the root is the quote, not the text");
        assert_eq!(tree.blocks.len(), 2);
        assert_eq!(tree.inlines.len(), 1);
        let wm::Block::Quote(q) = &tree.blocks[1] else {
            panic!("the root is the quote");
        };
        assert_eq!(q.blocks, vec![0], "the child is the first block deposited");
    }

    /// Il tetto è quello dichiarato: l'ultimo livello ammesso passa, il primo di
    /// troppo riceve un errore che nomina il numero invece di un `SIGSEGV`.
    /// troppo riceve un errore che nomina il numero invece di un `SIGSEGV`.
    #[test]
    fn a_too_deep_tree_is_rejected_instead_of_crashing_the_stack() {
        // Le radici stanno a 1, e il testo dentro il paragrafo occupa un livello
        // suo — è il budget unico dichiarato in `single_inline`. Quindi
        // `MAX_DEPTH - 2` citazioni mettono l'inline più interno
        // esattamente sull'ultimo livello lecito.
        let at_the_limit = quotes(MAX_DEPTH - 2);
        assert!(
            to_tree(&[at_the_limit]).is_ok(),
            "the last allowed level passes"
        );

        let one_too_many = quotes(MAX_DEPTH - 1);
        let error = to_tree(&[one_too_many]).expect_err("one more level should fail");
        assert!(
            matches!(&error, PluginError::Internal(t)
                if t.as_literal().is_some_and(|m| m.contains(&MAX_DEPTH.to_string()))),
            "the refusal names the ceiling: {error}"
        );
    }

    /// Duemila `>` in testa a una riga sono due kilobyte di file, e trentuno
    /// volte il tetto: senza il tetto questo test non fallirebbe, **morirebbe**.
    /// volte il tetto: senza il tetto questo test non fallirebbe, **morirebbe**.
    #[test]
    fn a_malformed_document_does_not_bring_down_the_thread() {
        let error = to_tree(&[quotes(2_000)]).expect_err("no tree that deep passes");
        assert!(matches!(error, PluginError::Internal(_)));
    }
}
