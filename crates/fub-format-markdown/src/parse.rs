//! Parsing: AST comrak → `DocumentModel` comune.

use comrak::nodes::{AstNode, ListType, NodeValue, TableAlignment};
use comrak::{Arena, Options};
use fub_abi::format::ParseContext;
use fub_abi::model::{
    canonical_anchor, custom_kind, valid_anchor, Anchor, Block, ColumnAlign, DocId, DocumentModel,
    Frontmatter, Heading, HeadingSlugs, Inline, Link, LinkTarget, ListItem, Span, TableCell,
    TableRow, Tag, TaskMarker,
};
use fub_abi::options::syntax;
use fub_abi::rules::text_policy;
use fub_abi::FormatError;
use fub_sdk::scan;

use crate::offsets::Offsets;

/// Costruisce le opzioni comrak per il dialetto Obsidian.
pub fn build_options(ctx: &ParseContext) -> Options<'static> {
    let mut o = Options::default();
    o.extension.front_matter_delimiter = Some("---".to_string());
    o.extension.strikethrough = true;
    o.extension.table = true;
    o.extension.tasklist = true;
    // Senza `relaxed`, comrak riconosce come task solo `[ ]`, `[x]` e `[X]`: un
    // `[/]` resterebbe testo, e gli stati personalizzati (10.1) sarebbero
    // irrappresentabili proprio nel modello che la decisione 0003 apre per loro.
    o.parse.relaxed_tasklist_matching = true;
    o.extension.superscript = true;
    // GitHub alerts ≈ callout Obsidian.
    o.extension.alerts = true;
    // Footnote e definition list: la decisione 0003 dice che restino
    // `Block::Custom`, ma con un `custom_kind` **registrato** nel contratto — e
    // una decisione su come rappresentare qualcosa che il parser non produce
    // affatto sarebbe stata presa a vuoto.
    o.extension.footnotes = true;
    o.extension.description_lists = true;
    if ctx.enabled(syntax::WIKILINKS) {
        o.extension.wikilinks_title_after_pipe = true;
    }
    o
}

/// Accumulatore delle tabelle piatte estratte durante la visita.
#[derive(Default)]
struct Acc {
    links: Vec<Link>,
    tags: Vec<Tag>,
    outline: Vec<Heading>,
    anchors: Vec<Anchor>,
    text: String,
    /// Chi assegna gli slug dei titoli, per la durata di **questo** documento:
    /// due `## Note` non possono ricevere lo stesso `id` (vedi `HeadingSlugs`).
    slugs: HeadingSlugs,
}

pub fn parse_markdown(source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
    // `offsets` sulla sorgente **intera** — è lì che vivono gli `Span` — e a
    // comrak la vista senza BOM, perché per lui un `U+FEFF` in testa sarebbe
    // testo del primo blocco. La traslazione fra le due è una, e sta in
    // `Offsets::new` (§15.5).
    let offsets = Offsets::new(source);
    let arena = Arena::new();
    let options = build_options(ctx);
    let root = comrak::parse_document(&arena, text_policy::strip_bom(source), &options);

    let mut acc = Acc::default();
    let mut frontmatter = Frontmatter::default();
    let mut body: Vec<Block> = Vec::new();

    for child in root.children() {
        let value = &child.data.borrow().value;
        if let NodeValue::FrontMatter(raw) = value {
            // Un frontmatter che non si proietta su JSON **non si butta**: resta
            // nel modello come blocco verbatim, e da lì torna sulla sorgente
            // identico a com'era. È contenuto dell'utente, e chi non l'ha capito
            // non è autorizzato a cancellarlo.
            match parse_frontmatter(raw) {
                Ok(fm) => frontmatter = fm,
                Err(motivo) => {
                    body.push(frontmatter_non_letto(raw, motivo, span_of(child, &offsets)));
                }
            }
            continue;
        }
        let Some(block) = convert_block(child, source, &offsets, ctx, &mut acc) else {
            continue;
        };
        // L'ancora su riga propria (`^abc` da solo, subito dopo un blocco) è la
        // sola forma con cui si indirizza un contenitore — una lista, una
        // tabella, una citazione — perché lì dentro non c'è una coda di testo
        // dove scriverla. Non è un blocco: appartiene a quello che la precede.
        if let Some(id) = lone_anchor(&block) {
            if let Some(prev) = body.last_mut().filter(|p| p.anchor().is_none()) {
                set_anchor(prev, id);
                if let Some(a) = acc.anchors.last_mut() {
                    a.span = prev.span();
                }
                continue;
            }
        }
        body.push(block);
    }

    Ok(DocumentModel {
        id: DocId::new(ctx.doc_id.clone()),
        frontmatter,
        body,
        outline: acc.outline,
        links: acc.links,
        tags: acc.tags,
        anchors: acc.anchors,
        text: acc.text.trim().to_string(),
    })
}

/// Un paragrafo che è **soltanto** un'ancora: `^abc` su una riga sua.
fn lone_anchor(block: &Block) -> Option<String> {
    match block {
        Block::Paragraph {
            inlines,
            anchor: Some(id),
            ..
        } if inlines.is_empty() => Some(id.clone()),
        _ => None,
    }
}

fn set_anchor(block: &mut Block, id: String) {
    match block {
        Block::Heading { anchor, .. }
        | Block::Paragraph { anchor, .. }
        | Block::List { anchor, .. }
        | Block::CodeBlock { anchor, .. }
        | Block::Quote { anchor, .. }
        | Block::ThematicBreak { anchor, .. }
        | Block::Custom { anchor, .. }
        | Block::Table { anchor, .. } => *anchor = Some(id),
    }
}

fn span_of<'a>(node: &'a AstNode<'a>, offsets: &Offsets<'_>) -> Span {
    sourcepos_span(node.data.borrow().sourcepos, offsets)
}

/// Lo span di un figlio, ritagliato su quello del padre.
///
/// Serve dove il `sourcepos` di una dipendenza fa uscire un nodo dal nodo che lo
/// contiene: il modello promette che uno span nomini **quel** pezzo di documento,
/// e un figlio che esce dal padre rende indecidibile quale dei due mente.
fn ritagliato_su(figlio: Span, padre: Span) -> Span {
    ritagliato_dopo(figlio, padre, padre.start)
}

/// Lo span di un figlio, ritagliato sul padre **e dopo il fratello che lo
/// precede**.
///
/// Due fratelli non possono rivendicare gli stessi byte: una patch chirurgica su
/// span che si intersecano non ha un risultato definito. Quando il `sourcepos` di
/// comrak lo fa — succede con un `\r` nudo in mezzo a una riga di tabella, che
/// spezza la riga e lascia due celle sullo stesso `|` — il figlio in eccesso
/// ricade su uno span a larghezza zero, che non è un valore inventato per
/// l'occasione: è già come il modello rappresenta una **cella vuota**
/// (`| a || b |` dà una cella `5..5`).
fn ritagliato_dopo(figlio: Span, padre: Span, dopo: usize) -> Span {
    let minimo = dopo.max(padre.start).min(padre.end);
    let start = figlio.start.clamp(minimo, padre.end);
    let end = figlio.end.clamp(start, padre.end);
    Span::new(start, end)
}

/// Il `sourcepos` di comrak tradotto in uno [`Span`], e **mai invertito**.
///
/// L'inversione non è un'ipotesi: `> > ---\na: 1\n---\n\n# Corpo\n` — una
/// citazione annidata la cui prima riga è un delimitatore di frontmatter — dà a un
/// blocco una fine *prima* del suo inizio (`start: 4, end: 3`). Il fuzzer del
/// §17.1 l'ha trovato al caso 1 771 834.
///
/// Un `start > end` non è uno span sbagliato, è uno span **impossibile**: nessuna
/// `&source[a..b]` ci passa, quindi il primo che ritaglia va in panico. Qui
/// diventa uno span vuoto in `start`, che è la sola forma non ambigua di «di
/// questo nodo non so dire l'estensione» — e che il presidio della coerenza vede
/// come span vuoto, cioè non lo nasconde.
///
/// Sta qui, insieme all'ancoraggio al confine di carattere di [`Offsets::byte`],
/// perché queste due righe **non rendono giusto** un numero sbagliato: rendono
/// impossibile che un numero sbagliato diventi un panico. È la differenza che il
/// §17.1 chiede al fuzzing del parser.
///
/// [`Offsets::byte`]: crate::offsets::Offsets::byte
fn sourcepos_span(sp: comrak::nodes::Sourcepos, offsets: &Offsets<'_>) -> Span {
    let start = offsets.byte(sp.start.line, sp.start.column);
    // la colonna di fine è inclusiva in comrak: +1 per l'estremo esclusivo.
    let end = offsets.byte(sp.end.line, sp.end.column + 1);
    Span::new(start, end.max(start))
}

/// L'ancora trovata in coda a un blocco: l'id canonico e **come era scritta**
/// (che è ciò che si toglie da testo e inline).
struct FoundAnchor {
    id: String,
    written: String,
}

/// `^abc123` in coda alla fetta di sorgente del blocco, preceduto da spazio (o
/// da nient'altro: è la forma su riga propria).
///
/// La registra anche nella tabella piatta del modello, con lo span del blocco e
/// quello del solo marcatore. Il `^` deve essere preceduto da spazio: senza
/// quella condizione `2^10` in fondo a un paragrafo diventerebbe un'ancora.
fn trailing_anchor(source: &str, span: Span, acc: &mut Acc) -> Option<FoundAnchor> {
    let slice = source.get(span.start..span.end)?;
    let trimmed = slice.trim_end();
    let at = trimmed.rfind('^')?;
    let written = &trimmed[at..];
    let id = &written[1..];
    if !valid_anchor(id) {
        return None;
    }
    if trimmed[..at]
        .chars()
        .next_back()
        .is_some_and(|c| !c.is_whitespace())
    {
        return None;
    }
    let id = canonical_anchor(id);
    acc.anchors.push(Anchor {
        id: id.clone(),
        span,
        marker: Span::new(span.start + at, span.start + trimmed.len()),
    });
    Some(FoundAnchor {
        id,
        written: written.to_string(),
    })
}

/// Toglie il marcatore dell'ancora dal contenuto: `^abc` è indirizzo, e
/// mostrarlo a schermo o indicizzarlo come parola sarebbe un difetto visibile.
fn strip_marker(inlines: &mut Vec<Inline>, text: &mut String, written: &str) {
    if let Some(Inline::Text(s)) = inlines.last_mut() {
        if let Some(rest) = s.trim_end().strip_suffix(written) {
            *s = rest.trim_end().to_string();
            if s.is_empty() {
                inlines.pop();
            }
        }
    }
    if let Some(rest) = text.trim_end().strip_suffix(written) {
        *text = rest.trim_end().to_string();
    }
}

fn convert_block<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
) -> Option<Block> {
    let span = span_of(node, offsets);
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Heading(h) => {
            // L'ancora si legge sul SORGENTE prima di convertire, e si toglie
            // poi da testo e inline: `^abc` è indirizzo, non contenuto.
            let anchor = trailing_anchor(source, span, acc);
            let mut text = String::new();
            let mut inlines = convert_inlines(node, source, offsets, ctx, acc, &mut text);
            if let Some(a) = &anchor {
                strip_marker(&mut inlines, &mut text, &a.written);
            }
            acc.text.push_str(&text);
            acc.text.push('\n');
            // **Una** chiamata, due usi. Chiamare l'assegnatario due volte
            // sullo stesso titolo darebbe `note` all'outline e `note-1` al
            // blocco: uno stato letto due volte è due stati, ed è la forma in
            // cui una disambiguazione si trasforma nel difetto che voleva
            // chiudere.
            let slug = acc.slugs.next_slug(text.trim());
            acc.outline.push(Heading {
                level: h.level,
                text: text.trim().to_string(),
                slug: slug.clone(),
                span,
            });
            Some(Block::Heading {
                level: h.level,
                inlines,
                // L'ancora di un heading è il suo slug: è ciò che risolve
                // `[[Nota#Titolo]]`, ed è generato, non scritto dall'utente.
                anchor: Some(slug),
                span,
            })
        }
        NodeValue::Paragraph => {
            let anchor = trailing_anchor(source, span, acc);
            let link_base = acc.links.len();
            let mut text = String::new();
            let mut inlines = convert_inlines(node, source, offsets, ctx, acc, &mut text);
            if let Some(a) = &anchor {
                strip_marker(&mut inlines, &mut text, &a.written);
            }
            let ptext = text.trim().to_string();
            // I link scoperti in questo paragrafo ereditano il testo come contesto.
            for link in &mut acc.links[link_base..] {
                if link.context.is_none() {
                    link.context = Some(ptext.clone());
                }
            }
            acc.text.push_str(&ptext);
            acc.text.push('\n');
            Some(Block::Paragraph {
                inlines,
                anchor: anchor.map(|a| a.id),
                span,
            })
        }
        NodeValue::List(list) => {
            let ordered = matches!(list.list_type, ListType::Ordered);
            let mut items = Vec::new();
            for item in node.children() {
                let task = match &item.data.borrow().value {
                    NodeValue::TaskItem(t) => Some(TaskMarker {
                        symbol: t.symbol,
                        span: sourcepos_span(t.symbol_sourcepos, offsets),
                    }),
                    _ => None,
                };
                let mut blocks = Vec::new();
                for b in item.children() {
                    if let Some(block) = convert_block(b, source, offsets, ctx, acc) {
                        blocks.push(block);
                    }
                }
                items.push(ListItem {
                    blocks,
                    task,
                    // Ritagliato su quello della lista, e non è una cintura di
                    // sicurezza messa per prudenza: senza, l'ultima voce di una
                    // lista seguita da una riga vuota e da un blocco che non sia
                    // un paragrafo o una tabella — una riga orizzontale, un
                    // heading, un fence, una citazione — si porta dentro il
                    // separatore che la lista **non** ha. `- a\n\n***\n` dà lista
                    // `0..3` e voce `0..4`, cioè una voce che esce dal blocco che
                    // la contiene: chi cancella quella voce guidato dal suo span
                    // si mangia la riga vuota e incolla l'heading successivo alla
                    // lista. Trovato dal corpus del §17.1.
                    //
                    // La direzione del ritaglio non è arbitraria: una voce non
                    // possiede mai il separatore che la stacca dal blocco dopo,
                    // mentre allargare la lista le farebbe possedere byte che non
                    // sono suoi.
                    span: ritagliato_su(span_of(item, offsets), span),
                });
            }
            Some(Block::List {
                ordered,
                items,
                anchor: None,
                span,
            })
        }
        NodeValue::CodeBlock(cb) => {
            let lang = cb
                .info
                .split_whitespace()
                .next()
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            acc.text.push_str(&cb.literal);
            acc.text.push('\n');
            Some(Block::CodeBlock {
                lang,
                code: cb.literal,
                // Dentro un blocco di codice un `^abc` è codice: nessuna ancora.
                anchor: None,
                span,
            })
        }
        NodeValue::BlockQuote => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            Some(Block::Quote {
                blocks,
                anchor: None,
                span,
            })
        }
        NodeValue::Alert(alert) => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            let kind = format!("{:?}", alert.alert_type).to_lowercase();
            Some(custom(
                custom_kind::CALLOUT,
                serde_json::json!({ "type": kind, "title": alert.title }),
                blocks,
                span,
            ))
        }
        NodeValue::Table(t) => Some(convert_table(
            node,
            &t.alignments,
            source,
            offsets,
            ctx,
            acc,
            span,
        )),
        NodeValue::FootnoteDefinition(f) => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            Some(custom(
                custom_kind::FOOTNOTE_DEFINITION,
                serde_json::json!({ "label": f.name }),
                blocks,
                span,
            ))
        }
        NodeValue::DescriptionList => {
            // L'`item` di comrak esiste solo per tenere insieme termine e
            // descrizione: nel modello i due sono fratelli, come dice il
            // registro dei `custom_kind`.
            let mut blocks = Vec::new();
            for item in node.children() {
                blocks.extend(convert_block_children(item, source, offsets, ctx, acc));
            }
            Some(custom(
                custom_kind::DEFINITION_LIST,
                serde_json::Value::Null,
                blocks,
                span,
            ))
        }
        NodeValue::DescriptionTerm | NodeValue::DescriptionDetails => {
            let kind = if matches!(value, NodeValue::DescriptionTerm) {
                custom_kind::DEFINITION_TERM
            } else {
                custom_kind::DEFINITION_DESCRIPTION
            };
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            Some(custom(kind, serde_json::Value::Null, blocks, span))
        }
        NodeValue::HtmlBlock(h) => {
            // L'HTML grezzo entra nel modello (prima spariva: nessun figlio →
            // nessun blocco) ma resta **dato**, non markup: chi lo disegna
            // decide, e oggi nessuno lo disegna. Vedi 5.3 sulla sanitizzazione.
            acc.text.push_str(&h.literal);
            acc.text.push('\n');
            Some(custom(
                custom_kind::HTML,
                serde_json::json!({ "html": h.literal }),
                Vec::new(),
                span,
            ))
        }
        NodeValue::ThematicBreak => Some(Block::ThematicBreak { anchor: None, span }),
        // Ciò che il provider non sa nominare: escape hatch generico.
        _ => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc);
            if blocks.is_empty() {
                None
            } else {
                Some(custom(
                    custom_kind::BLOCK,
                    serde_json::Value::Null,
                    blocks,
                    span,
                ))
            }
        }
    }
}

fn custom(kind: &str, attrs: serde_json::Value, blocks: Vec<Block>, span: Span) -> Block {
    Block::Custom {
        custom_kind: kind.to_string(),
        attrs,
        blocks,
        anchor: None,
        span,
    }
}

#[allow(clippy::too_many_arguments)]
fn convert_table<'a>(
    node: &'a AstNode<'a>,
    alignments: &[TableAlignment],
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    span: Span,
) -> Block {
    let align = alignments
        .iter()
        .map(|a| match a {
            TableAlignment::Left => ColumnAlign::Left,
            TableAlignment::Center => ColumnAlign::Center,
            TableAlignment::Right => ColumnAlign::Right,
            TableAlignment::None => ColumnAlign::None,
        })
        .collect();
    let mut head = None;
    let mut rows = Vec::new();
    // Scorre attraverso **tutte** le celle della tabella, non si azzera a ogni
    // riga: due celle non possono rivendicare gli stessi byte nemmeno se stanno
    // su righe diverse, e i due casi in cui comrak lo fa nascono proprio dove una
    // riga finisce — una riga di prosa che continua la tabella (in GFM una
    // tabella si chiude su una riga vuota o su un altro blocco, non su una riga
    // di testo) e un `\r` nudo che spezza una riga in due. Vedi
    // [`ritagliato_dopo`].
    let mut fine = span.start;
    for r in node.children() {
        let is_header = matches!(r.data.borrow().value, NodeValue::TableRow(true));
        let mut cells = Vec::new();
        for c in r.children() {
            let mut text = String::new();
            let inlines = convert_inlines(c, source, offsets, ctx, acc, &mut text);
            acc.text.push_str(text.trim());
            acc.text.push(' ');
            let cella = ritagliato_dopo(span_of(c, offsets), span, fine);
            fine = cella.end;
            cells.push(TableCell {
                inlines,
                span: cella,
            });
        }
        let row = TableRow { cells };
        acc.text.push('\n');
        if is_header && head.is_none() {
            head = Some(row);
        } else {
            rows.push(row);
        }
    }
    Block::Table {
        head,
        rows,
        align,
        anchor: None,
        span,
    }
}

fn convert_block_children<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
) -> Vec<Block> {
    node.children()
        .filter_map(|c| convert_block(c, source, offsets, ctx, acc))
        .collect()
}

/// Emette un link **e** lo registra nella tabella piatta: sono due gesti che
/// non devono poter divergere (l'immagine divergeva).
fn push_link(
    acc: &mut Acc,
    out: &mut Vec<Inline>,
    target: LinkTarget,
    label: Option<Vec<Inline>>,
    embed: bool,
    span: Span,
) {
    acc.links.push(Link {
        target: target.clone(),
        embed,
        span,
        context: None,
    });
    out.push(Inline::Link {
        target,
        label,
        embed,
        span,
    });
}

fn convert_inlines<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    text_out: &mut String,
) -> Vec<Inline> {
    let mut out = Vec::new();
    for child in node.children() {
        let span = span_of(child, offsets);
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(s) => {
                let s: String = s.to_string();
                text_out.push_str(&s);
                // Tag ed embed si scandiscono sulla FETTA DI SORGENTE del
                // nodo, non sul testo decodificato: comrak scioglie escape ed
                // entità (`\#` → `#`, `&amp;` → `&`) ma la base dello span è
                // il `sourcepos` nel sorgente — su `pre \# poi #tag` lo span
                // del tag punterebbe una fetta spostata di un byte per ogni
                // carattere decodificato prima di lui. Sul sorgente, inoltre,
                // gli escape sono ancora visibili: `\#nontag` non diventa un
                // tag (Obsidian lo neutralizza).
                let slice = source.get(span.start..span.end).unwrap_or(&s);
                push_text_features(slice, &s, span.start, ctx, acc, &mut out);
            }
            NodeValue::SoftBreak | NodeValue::LineBreak => {
                text_out.push(' ');
                out.push(Inline::Text(" ".to_string()));
            }
            NodeValue::Emph => {
                out.push(Inline::Emph(convert_inlines(
                    child, source, offsets, ctx, acc, text_out,
                )));
            }
            NodeValue::Strong => {
                out.push(Inline::Strong(convert_inlines(
                    child, source, offsets, ctx, acc, text_out,
                )));
            }
            NodeValue::Code(code) => {
                text_out.push_str(&code.literal);
                out.push(Inline::Code(code.literal));
            }
            NodeValue::Link(link) => {
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                text_out.push_str(&label_text);
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&link.url),
                    Some(label),
                    false,
                    span,
                );
            }
            NodeValue::WikiLink(wl) => {
                // Il `!` che precede fa embed solo se è un `!` vero: sotto
                // escape (`\![[...]]`) è un punto esclamativo letterale.
                let embed = span.start > 0
                    && source.as_bytes()[span.start - 1] == b'!'
                    && !is_escaped(source, span.start - 1);
                let parsed = scan::parse_wikilink_inner(&wl.url);
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                text_out.push_str(&label_text);
                push_link(acc, &mut out, parsed.target, Some(label), embed, span);
            }
            NodeValue::Image(img) => {
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                // Un'immagine È un riferimento incorporato, e finché non entrava
                // in `links` nessun riferimento ad allegato veniva aggiornato al
                // rename, né risultava fra gli orfani (13.1): non perché il path
                // non fosse un arco, ma perché quell'arco non veniva raccolto.
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&img.url),
                    Some(label),
                    true,
                    span,
                );
            }
            NodeValue::FootnoteReference(f) => {
                out.push(Inline::Custom {
                    custom_kind: custom_kind::FOOTNOTE_REFERENCE.to_string(),
                    attrs: serde_json::json!({ "label": f.name }),
                    span,
                });
            }
            _ => {
                // Sotto-inline sconosciuti: recupera almeno il testo.
                let nested = convert_inlines(child, source, offsets, ctx, acc, text_out);
                out.extend(nested);
            }
        }
    }
    out
}

/// Divide un frammento di testo in `Text`/`TagRef`, registrando i tag in `acc`.
/// Elabora un frammento estraendo, nell'ordine, gli embed `![[...]]` (che
/// comrak non riconosce) e poi i `#tag` dai segmenti restanti.
///
/// `slice` è la fetta di **sorgente** del nodo, `base` il suo offset in byte:
/// la scansione avviene lì, perché gli `Span` prodotti sono offset nel
/// sorgente e lì gli escape sono ancora visibili. `decoded` è il testo come lo
/// consegna comrak, ed è ciò che si emette come `Inline::Text` quando il
/// frammento non contiene feature — così la resa mostra `#` e `&`, non `\#` e
/// `&amp;`. (Nei rari segmenti misti — escape E tag nello stesso nodo — il
/// testo fra le feature resta quello del sorgente: più fedele alla
/// serializzazione, marginalmente più grezzo a schermo.)
fn push_text_features(
    slice: &str,
    decoded: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) {
    let embeds = if ctx.enabled(syntax::WIKILINKS) {
        find_embeds(slice)
    } else {
        Vec::new()
    };
    if embeds.is_empty() {
        push_plain_or_tags(slice, decoded, base, ctx, acc, out);
        return;
    }
    let mut cursor = 0;
    for (span, inner) in embeds {
        if span.start > cursor {
            let seg = &slice[cursor..span.start];
            push_plain_or_tags(seg, seg, base + cursor, ctx, acc, out);
        }
        let parsed = scan::parse_wikilink_inner(&inner);
        let abs = Span::new(base + span.start, base + span.end);
        push_link(acc, out, parsed.target, None, true, abs);
        cursor = span.end;
    }
    if cursor < slice.len() {
        let seg = &slice[cursor..];
        push_plain_or_tags(seg, seg, base + cursor, ctx, acc, out);
    }
}

/// Trova gli embed `![[...]]`, restituendo (span nel frammento, contenuto
/// interno). Il frammento è sorgente: un `!` sotto escape (`\![[...]]`) non
/// apre un embed.
fn find_embeds(text: &str) -> Vec<(Span, String)> {
    let mut res = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if !text.is_char_boundary(i) {
            i += 1;
            continue;
        }
        if text[i..].starts_with("![[") && !is_escaped(text, i) {
            if let Some(rel) = text[i + 3..].find("]]") {
                let inner = text[i + 3..i + 3 + rel].to_string();
                let end = i + 3 + rel + 2;
                res.push((Span::new(i, end), inner));
                i = end;
                continue;
            }
        }
        i += 1;
    }
    res
}

/// Il carattere a `idx` è sotto escape? Conta i backslash contigui che lo
/// precedono: una sequenza dispari escapa (`\#`), una pari no (`\\#`: il primo
/// `\` escapa il secondo, il `#` è libero).
fn is_escaped(text: &str, idx: usize) -> bool {
    text[..idx]
        .bytes()
        .rev()
        .take_while(|b| *b == b'\\')
        .count()
        % 2
        == 1
}

/// Il `#` a `idx` è il cuore di un riferimento a carattere numerico (`&#65;`,
/// `&#x27;`)? Nel testo decodificato quel `#` non esiste: un tag estratto da
/// lì sarebbe un'invenzione (la forma esadecimale ha un nome di tag valido,
/// es. `x27`).
fn is_entity_hash(text: &str, idx: usize) -> bool {
    if !text[..idx].ends_with('&') {
        return false;
    }
    let rest = &text[idx + 1..];
    let (cifre, esadecimale) = match rest.strip_prefix(['x', 'X']) {
        Some(hex) => (hex, true),
        None => (rest, false),
    };
    match cifre.find(';') {
        Some(n) if n > 0 => cifre[..n].chars().all(|c| {
            if esadecimale {
                c.is_ascii_hexdigit()
            } else {
                c.is_ascii_digit()
            }
        }),
        _ => false,
    }
}

/// Segmento senza embed: estrae i `#tag` (se abilitati) o emette testo piatto.
/// `slice`/`decoded`/`base` come in [`push_text_features`].
fn push_plain_or_tags(
    slice: &str,
    decoded: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) {
    let tags: Vec<Tag> = if ctx.enabled(syntax::TAGS) {
        scan::scan_tags(slice)
            .into_iter()
            // Sul sorgente gli pseudo-tag si riconoscono: `\#` è sotto escape,
            // `&#x27;` è un'entità — nessuno dei due è un tag per Obsidian.
            .filter(|t| !is_escaped(slice, t.span.start) && !is_entity_hash(slice, t.span.start))
            .collect()
    } else {
        Vec::new()
    };
    if tags.is_empty() {
        if !decoded.is_empty() {
            out.push(Inline::Text(decoded.to_string()));
        }
        return;
    }
    let mut cursor = 0;
    for tag in tags {
        if tag.span.start > cursor {
            out.push(Inline::Text(slice[cursor..tag.span.start].to_string()));
        }
        let abs = Span::new(base + tag.span.start, base + tag.span.end);
        out.push(Inline::TagRef {
            name: tag.name.clone(),
            span: abs,
        });
        acc.tags.push(Tag {
            name: tag.name,
            span: abs,
        });
        cursor = tag.span.end;
    }
    if cursor < slice.len() {
        out.push(Inline::Text(slice[cursor..].to_string()));
    }
}

/// Il frontmatter proiettato su JSON, oppure **perché non si è potuto**.
///
/// L'errore è una frase, non un tipo: qui non c'è nessuno che debba
/// distinguere fra «virgola sbagliata» e «non è una mappa» *facendo* qualcosa
/// di diverso — c'è qualcuno che deve leggerla. Ciò che conta è che il
/// fallimento **esista**: prima cadeva in un `_ => Frontmatter::default()`, e
/// da lì in poi un frontmatter rotto e un frontmatter assente erano
/// indistinguibili per chiunque, riscrittura compresa.
fn parse_frontmatter(raw: &str) -> Result<Frontmatter, String> {
    // `raw` include i delimitatori `---`; li togliamo prima di parsare lo YAML.
    let inner = raw
        .trim()
        .trim_start_matches("---")
        .trim_end_matches("---")
        .trim();
    if inner.is_empty() {
        return Ok(Frontmatter::default());
    }
    match serde_yaml_ng::from_str::<serde_json::Value>(inner) {
        Ok(serde_json::Value::Object(map)) => Ok(Frontmatter(map)),
        // Uno YAML valido che non è una mappa (`- a`, `solo testo`) non è un
        // frontmatter: non ha proprietà da offrire, e non è un errore di
        // sintassi che si possa citare con una riga.
        Ok(altro) => Err(format!(
            "il frontmatter non è una mappa di proprietà ma {}",
            specie_yaml(&altro)
        )),
        Err(e) => Err(e.to_string()),
    }
}

fn specie_yaml(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "un valore vuoto",
        serde_json::Value::Bool(_) => "un booleano",
        serde_json::Value::Number(_) => "un numero",
        serde_json::Value::String(_) => "una stringa",
        serde_json::Value::Array(_) => "un elenco",
        serde_json::Value::Object(_) => "una mappa",
    }
}

/// Il blocco che conserva un frontmatter illeggibile **verbatim**.
///
/// `text` è normalizzato a finire con un solo `\n` dopo il delimitatore di
/// chiusura: `raw` di comrak si porta dietro anche la riga vuota che separa il
/// frontmatter dal corpo, e quella riga la rimette il serializer come
/// separatore fra blocchi. Senza la normalizzazione il giro completo
/// guadagnerebbe una riga vuota a ogni passaggio.
fn frontmatter_non_letto(raw: &str, motivo: String, span: Span) -> Block {
    let mut text = raw.trim_end().to_string();
    text.push('\n');
    Block::Custom {
        custom_kind: custom_kind::FRONTMATTER_UNPARSED.to_string(),
        attrs: serde_json::json!({ "text": text, "error": motivo }),
        blocks: Vec::new(),
        anchor: None,
        span,
    }
}
