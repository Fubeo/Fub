//! **L'albero più grande del contratto, tradotto.**
//!
//! `document-model` — blocchi, intestazioni, link, proprietà, frontmatter — è
//! la ragione per cui `read-model` rispondeva `unserved` al primo passo di M5:
//! non perché la capacità mancasse, ma perché tradurre l'albero è un lavoro
//! suo. Sta in un modulo separato da `traduzione.rs` per la stessa ragione per
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
//! Qui c'è solo `in_*` (dal Rust di `fub-abi` al WIT che il componente riceve),
//! ed è ciò che il contratto dice di questo albero **oggi**: `read-model` lo
//! passa a un guest, e nessuna interfaccia servita dall'host lo riceve indietro.
//! Il giorno che `format.parse` attraverserà — un componente che *è* un
//! `FormatProvider` e restituisce il modello che ha parsato — servirà il `da_*`,
//! e sarà un altro passo con le sue domande (gli indici fuori range, che di
//! qua sono impossibili per costruzione e di là sono dato di un estraneo).

use fub_abi::model as rm;
use fub_abi::PluginError;

use crate::contratto::fub::abi::model as wm;
use crate::traduzione as tr;
// Lo `span` a 64 bit del confine, dal `usize` di casa, è la stessa conversione
// per chiunque attraversi — un albero di documento, un `reveal`, un `text-edit`
// — e per questo sta in `traduzione`. Ne era nata una copia qui quando quella
// era privata al proprio modulo; non lo è più.
use crate::traduzione::in_span;

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
pub(crate) const PROFONDITA_MASSIMA: u32 = 64;

// ---------------------------------------------------------------------------
// Il documento intero
// ---------------------------------------------------------------------------

/// Il modello di documento, dal Rust del kernel al WIT che il componente riceve.
///
/// Fallisce solo per l'albero: le tabelle piatte (outline, link, tag, ancore) e
/// il frontmatter sono conversioni totali, l'unica domanda che può ricevere un
/// «no» è quanto è profondo il corpo.
pub(crate) fn in_documento(m: &rm::DocumentModel) -> Result<wm::DocumentModel, PluginError> {
    Ok(wm::DocumentModel {
        id: m.id.0.clone(),
        frontmatter: in_frontmatter(&m.frontmatter),
        body: in_albero(&m.body)?,
        outline: m.outline.iter().map(in_intestazione).collect(),
        links: m.links.iter().map(in_link).collect(),
        tags: m.tags.iter().map(in_tag).collect(),
        anchors: m.anchors.iter().map(in_ancora).collect(),
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
fn in_frontmatter(f: &rm::Frontmatter) -> String {
    serde_json::to_string(&f.0).expect("un frontmatter è sempre serializzabile")
}

// ---------------------------------------------------------------------------
// Le tabelle piatte: outline, link, tag, ancore
// ---------------------------------------------------------------------------

fn in_intestazione(h: &rm::Heading) -> wm::Heading {
    wm::Heading {
        level: h.level,
        text: h.text.clone(),
        slug: h.slug.clone(),
        span: in_span(h.span),
        explicit_anchor: h.explicit_anchor.clone(),
    }
}

fn in_bersaglio(t: &rm::LinkTarget) -> wm::LinkTarget {
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

fn in_link(l: &rm::Link) -> wm::Link {
    wm::Link {
        target: in_bersaglio(&l.target),
        embed: l.embed,
        span: in_span(l.span),
        context: l.context.clone(),
    }
}

fn in_tag(t: &rm::Tag) -> wm::Tag {
    wm::Tag {
        name: t.name.clone(),
        span: in_span(t.span),
    }
}

fn in_ancora(a: &rm::Anchor) -> wm::Anchor {
    wm::Anchor {
        id: a.id.clone(),
        span: in_span(a.span),
        marker: in_span(a.marker),
    }
}

// ---------------------------------------------------------------------------
// Il corpo: l'albero che diventa arena
// ---------------------------------------------------------------------------

/// Il corpo del documento appiattito nelle due liste del contratto.
fn in_albero(body: &[rm::Block]) -> Result<wm::DocumentTree, PluginError> {
    let mut arena = Arena::default();
    let roots = arena.blocchi(body, 1)?;
    Ok(wm::DocumentTree {
        blocks: arena.blocchi,
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
    blocchi: Vec<wm::Block>,
    inline: Vec<wm::Inline>,
}

impl Arena {
    /// Deposita un blocco già tradotto e restituisce il suo `block-ref`.
    fn posa_blocco(&mut self, b: wm::Block) -> Result<u32, PluginError> {
        let indice = riferimento(self.blocchi.len())?;
        self.blocchi.push(b);
        Ok(indice)
    }

    /// Deposita un inline già tradotto e restituisce il suo `inline-ref`.
    fn posa_inline(&mut self, i: wm::Inline) -> Result<u32, PluginError> {
        let indice = riferimento(self.inline.len())?;
        self.inline.push(i);
        Ok(indice)
    }

    fn blocchi(&mut self, v: &[rm::Block], profondita: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|b| self.blocco(b, profondita)).collect()
    }

    fn inline(&mut self, v: &[rm::Inline], profondita: u32) -> Result<Vec<u32>, PluginError> {
        v.iter().map(|i| self.inline_uno(i, profondita)).collect()
    }

    /// Un blocco e tutto ciò che porta dentro, in post-ordine.
    ///
    /// `profondita` è il livello di **questo** blocco (le radici stanno a 1) e
    /// non un contatore condiviso: due rami paralleli non si sommano, perché ciò
    /// che consuma lo stack è la discesa, non la larghezza.
    ///
    /// La `match` è esaustiva senza `_ =>`, e non è pignoleria: è il presidio
    /// che il modulo `traduzione` dichiara in testa a sé stesso. Il giorno che
    /// `Block` cresce di una variante — e cresce, la 0003 ha già promosso la
    /// tabella e lasciato in coda footnote e definition list — questo file
    /// smette di compilare e nomina la riga. Con un `_ =>` che ingoia il caso
    /// nuovo, invece, il blocco nuovo arriverebbe di là come qualcos'altro (o
    /// non arriverebbe affatto) e nessuno lo saprebbe fino a un bug di rendering
    /// in casa di un terzo.
    fn blocco(&mut self, b: &rm::Block, profondita: u32) -> Result<u32, PluginError> {
        if profondita > PROFONDITA_MASSIMA {
            return Err(troppo_profondo());
        }
        let giu = profondita + 1;
        let tradotto = match b {
            rm::Block::Heading {
                level,
                inlines,
                anchor,
                span,
                explicit_anchor,
            } => wm::Block::Heading(wm::BlockHeading {
                level: *level,
                inlines: self.inline(inlines, giu)?,
                anchor: anchor.clone(),
                span: in_span(*span),
                explicit_anchor: explicit_anchor.clone(),
            }),
            rm::Block::Paragraph {
                inlines,
                anchor,
                span,
            } => wm::Block::Paragraph(wm::BlockParagraph {
                inlines: self.inline(inlines, giu)?,
                anchor: anchor.clone(),
                span: in_span(*span),
            }),
            rm::Block::List {
                ordered,
                items,
                anchor,
                span,
                start,
            } => {
                let mut voci = Vec::with_capacity(items.len());
                for v in items {
                    voci.push(self.voce(v, giu)?);
                }
                wm::Block::List(wm::BlockList {
                    ordered: *ordered,
                    items: voci,
                    anchor: anchor.clone(),
                    span: in_span(*span),
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
                span: in_span(*span),
            }),
            rm::Block::Quote {
                blocks,
                anchor,
                span,
            } => wm::Block::Quote(wm::BlockQuote {
                blocks: self.blocchi(blocks, giu)?,
                anchor: anchor.clone(),
                span: in_span(*span),
            }),
            rm::Block::ThematicBreak { anchor, span } => {
                wm::Block::ThematicBreak(wm::BlockThematicBreak {
                    anchor: anchor.clone(),
                    span: in_span(*span),
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
                attrs: tr::in_json(attrs),
                blocks: self.blocchi(blocks, giu)?,
                anchor: anchor.clone(),
                span: in_span(*span),
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
                    Some(r) => Some(self.riga(r, giu)?),
                    None => None,
                };
                let mut righe = Vec::with_capacity(rows.len());
                for r in rows {
                    righe.push(self.riga(r, giu)?);
                }
                wm::Block::Table(wm::BlockTable {
                    head,
                    rows: righe,
                    align: align.iter().map(|a| in_allineamento(*a)).collect(),
                    anchor: anchor.clone(),
                    span: in_span(*span),
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
                span: in_span(*span),
            }),
        };
        self.posa_blocco(tradotto)
    }

    /// Una voce di lista: i suoi blocchi, e la task se è una task.
    fn voce(&mut self, v: &rm::ListItem, profondita: u32) -> Result<wm::ListItem, PluginError> {
        Ok(wm::ListItem {
            blocks: self.blocchi(&v.blocks, profondita)?,
            task: v.task.as_ref().map(in_marcatore),
            span: in_span(v.span),
        })
    }

    fn riga(&mut self, r: &rm::TableRow, profondita: u32) -> Result<wm::TableRow, PluginError> {
        let mut celle = Vec::with_capacity(r.cells.len());
        for c in &r.cells {
            celle.push(wm::TableCell {
                inlines: self.inline(&c.inlines, profondita)?,
                span: in_span(c.span),
            });
        }
        Ok(wm::TableRow { cells: celle })
    }

    /// Un inline e ciò che porta dentro, in post-ordine.
    ///
    /// Gli inline si annidano quanto i blocchi — un `**grassetto con *corsivo*
    /// dentro**`, l'etichetta di un link che è a sua volta enfasi — e il tetto è
    /// lo stesso: la discesa costa stack qui esattamente come di sopra, e due
    /// budget separati vorrebbero dire che il caso peggiore è la loro somma.
    ///
    /// Si chiama `inline_uno` perché `inline` è già il plurale del suo
    /// chiamante; un nome è la firma che si legge dal punto di chiamata.
    fn inline_uno(&mut self, i: &rm::Inline, profondita: u32) -> Result<u32, PluginError> {
        if profondita > PROFONDITA_MASSIMA {
            return Err(troppo_profondo());
        }
        let giu = profondita + 1;
        let tradotto = match i {
            rm::Inline::Text(s) => wm::Inline::Text(s.clone()),
            rm::Inline::Emph(v) => wm::Inline::Emph(self.inline(v, giu)?),
            rm::Inline::Strong(v) => wm::Inline::Strong(self.inline(v, giu)?),
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
                    Some(v) => Some(self.inline(v, giu)?),
                    None => None,
                };
                wm::Inline::Link(wm::InlineLink {
                    target: in_bersaglio(target),
                    label,
                    embed: *embed,
                    span: in_span(*span),
                })
            }
            rm::Inline::TagRef { name, span } => wm::Inline::TagRef(wm::InlineTagRef {
                name: name.clone(),
                span: in_span(*span),
            }),
            rm::Inline::Custom {
                custom_kind,
                attrs,
                span,
            } => wm::Inline::Custom(wm::InlineCustom {
                custom_kind: custom_kind.clone(),
                attrs: tr::in_json(attrs),
                span: in_span(*span),
            }),
            rm::Inline::Superscript(v) => wm::Inline::Superscript(self.inline(v, giu)?),
            rm::Inline::Strikethrough(v) => wm::Inline::Strikethrough(self.inline(v, giu)?),
            rm::Inline::HardBreak => wm::Inline::HardBreak,
            rm::Inline::SoftBreak => wm::Inline::SoftBreak,
        };
        self.posa_inline(tradotto)
    }
}

fn in_marcatore(t: &rm::TaskMarker) -> wm::TaskMarker {
    wm::TaskMarker {
        symbol: t.symbol,
        span: in_span(t.span),
    }
}

fn in_allineamento(a: rm::ColumnAlign) -> wm::ColumnAlign {
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
fn riferimento(len: usize) -> Result<u32, PluginError> {
    u32::try_from(len).map_err(|_| {
        PluginError::Internal(
            "l'albero del documento ha più nodi di quanti un riferimento a 32 bit \
             ne possa nominare"
                .into(),
        )
    })
}

/// Il rifiuto di un albero troppo profondo.
///
/// `Internal` e non `BadArgs`: chi ha chiesto il modello non ha sbagliato
/// niente — ha nominato un documento che esiste — ed è l'host a non saperlo
/// portare di là. Il messaggio dice il tetto, perché un limite senza il proprio
/// numero è indistinguibile da un guasto.
fn troppo_profondo() -> PluginError {
    PluginError::Internal(
        format!(
            "l'albero del documento supera i {PROFONDITA_MASSIMA} livelli di annidamento \
             che l'host traduce"
        )
        .into(),
    )
}

#[cfg(test)]
mod prove {
    use super::*;

    fn span() -> rm::Span {
        rm::Span::new(0, 0)
    }

    /// Una citazione dentro l'altra, `n` volte.
    fn citazioni(n: u32) -> rm::Block {
        let mut b = rm::Block::Paragraph {
            inlines: vec![rm::Inline::Text("fondo".into())],
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
    fn il_figlio_entra_nellarena_prima_del_padre() {
        let albero = in_albero(&[citazioni(1)]).expect("due livelli passano");
        assert_eq!(
            albero.roots,
            vec![1],
            "la radice è la citazione, non il testo"
        );
        assert_eq!(albero.blocks.len(), 2);
        assert_eq!(albero.inlines.len(), 1);
        let wm::Block::Quote(q) = &albero.blocks[1] else {
            panic!("la radice è la citazione");
        };
        assert_eq!(
            q.blocks,
            vec![0],
            "il figlio è il blocco depositato per primo"
        );
    }

    /// Il tetto è quello dichiarato: l'ultimo livello ammesso passa, il primo di
    /// troppo riceve un errore che nomina il numero invece di un `SIGSEGV`.
    #[test]
    fn un_albero_troppo_profondo_si_rifiuta_invece_di_far_saltare_lo_stack() {
        // Le radici stanno a 1, e il testo dentro il paragrafo occupa un livello
        // suo — è il budget unico dichiarato in `inline_uno`. Quindi
        // `PROFONDITA_MASSIMA - 2` citazioni mettono l'inline più interno
        // esattamente sull'ultimo livello lecito.
        let al_pelo = citazioni(PROFONDITA_MASSIMA - 2);
        assert!(
            in_albero(&[al_pelo]).is_ok(),
            "l'ultimo livello lecito passa"
        );

        let uno_di_troppo = citazioni(PROFONDITA_MASSIMA - 1);
        let errore = in_albero(&[uno_di_troppo]).expect_err("un livello in più no");
        assert!(
            matches!(&errore, PluginError::Internal(t)
                if t.as_literal().is_some_and(|m| m.contains(&PROFONDITA_MASSIMA.to_string()))),
            "il rifiuto dice il tetto: {errore}"
        );
    }

    /// Duemila `>` in testa a una riga sono due kilobyte di file, e trentuno
    /// volte il tetto: senza il tetto questo test non fallirebbe, **morirebbe**.
    #[test]
    fn un_documento_malato_non_porta_giu_il_thread() {
        let errore = in_albero(&[citazioni(2_000)]).expect_err("nessun albero così passa");
        assert!(matches!(errore, PluginError::Internal(_)));
    }
}
