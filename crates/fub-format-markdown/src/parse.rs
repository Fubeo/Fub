//! Parsing: AST comrak → `DocumentModel` comune.

use std::ops::Range;

use comrak::nodes::{AstNode, ListType, NodeValue, TableAlignment};
use comrak::{Arena, Options};
use fub_abi::format::ParseContext;
use fub_abi::model::{
    canonical_anchor, custom_kind, valid_anchor, Anchor, Block, ColumnAlign, DocId, DocumentModel,
    Frontmatter, Heading, HeadingSlugs, Inline, Link, LinkTarget, ListItem, Span, TableCell,
    TableRow, Tag, TaskMarker,
};
use fub_abi::options::syntax;
use fub_abi::rules::snippet;
use fub_abi::rules::text_policy;
use fub_abi::FormatError;
use fub_sdk::scan;

use crate::offsets::Offsets;
use crate::util::disescapa;

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
    /// Ogni link con la sua posizione nel testo del blocco che lo contiene:
    /// `[inizio, fine)` in **byte**, sul testo non ancora trimmato. Nascono
    /// insieme e muoiono insieme: la posizione serve solo a ritagliare il
    /// contesto (la finestra di `rules::snippet`), e tenerle nello stesso
    /// contenitore è ciò che impedisce a un inserimento di disallinearle.
    links: Vec<(Link, Range<usize>)>,
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
    // Il frontmatter c'era, anche quando non dichiarava niente: senza questo
    // sì/no, `---\n\n---` e un file che comincia col corpo arrivano al
    // serializer con la stessa mappa vuota, e la riscrittura toglie le due
    // righe di delimitatori invece di ricopiarle.
    let mut frontmatter_present = false;
    let mut body: Vec<Block> = Vec::new();

    for child in root.children() {
        let value = &child.data.borrow().value;
        if let NodeValue::FrontMatter(raw) = value {
            // Un frontmatter che non si proietta su JSON **non si butta**: resta
            // nel modello come blocco verbatim, e da lì torna sulla sorgente
            // identico a com'era. È contenuto dell'utente, e chi non l'ha capito
            // non è autorizzato a cancellarlo.
            match parse_frontmatter(raw) {
                Ok(fm) => {
                    frontmatter = fm;
                    frontmatter_present = true;
                }
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
        links: acc.links.into_iter().map(|(link, _)| link).collect(),
        tags: acc.tags,
        anchors: acc.anchors,
        text: acc.text.trim().to_string(),
        frontmatter_present,
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
            let inlines =
                inlines_del_blocco(node, source, offsets, ctx, acc, anchor.as_ref(), &mut text);
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
            let mut text = String::new();
            let inlines =
                inlines_del_blocco(node, source, offsets, ctx, acc, anchor.as_ref(), &mut text);
            let ptext = text.trim().to_string();
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
                // Il numero del primo marcatore, e solo per un ordinato: in un
                // puntato comrak lo riempie lo stesso (con `1`) e conservarlo
                // vorrebbe dire dichiarare un dato che nel file non c'è.
                start: ordered.then(|| u32::try_from(list.start).unwrap_or(1)),
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
            let inlines = inlines_del_blocco(c, source, offsets, ctx, acc, None, &mut text);
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
///
/// `nel_testo` è la posizione del link nel testo del blocco che lo contiene
/// (`[inizio, fine)` in byte, sul testo non ancora trimmato): è ciò che la
/// regola del contesto (`rules::snippet::window`) usa per ritagliare la
/// finestra attorno al link. Nasce qui perché è l'unico punto in cui la
/// lunghezza dell'etichetta è nota.
fn push_link(
    acc: &mut Acc,
    out: &mut Vec<Inline>,
    target: LinkTarget,
    label: Option<Vec<Inline>>,
    embed: bool,
    span: Span,
    nel_testo: Range<usize>,
) {
    acc.links.push((
        Link {
            target: target.clone(),
            embed,
            span,
            context: None,
        },
        nel_testo,
    ));
    out.push(Inline::Link {
        target,
        label,
        embed,
        span,
    });
}

/// Gli inline di un **blocco**: il marcatore d'ancora tolto, e il **contesto**
/// assegnato ai link che ci stanno dentro.
///
/// È l'ingresso che ogni ramo di [`convert_block`] usa; [`convert_inlines`] —
/// quella che ricorre dentro un `Emph`, uno `Strong`, l'etichetta di un link —
/// non assegna niente, perché il contesto di un link è una **finestra** del
/// testo del blocco che lo contiene (la regola sta in `rules::snippet`), e
/// dentro un `Emph` non si sa quale sia.
///
/// La regola stava scritta dentro il ramo `Paragraph`, e valeva solo lì: un
/// link in un'intestazione o in una cella di tabella nasceva con `context:
/// None`, e il pannello dei backlink lo mostrava senza la riga che lo spiega.
/// Copiarla nei due rami mancanti sarebbe stata la risposta sbagliata due
/// volte: chi *vede* il sintomo non è chi lo produce, e una regola che vale per
/// tutti i chiamanti si scrive nel posto che tutti attraversano.
///
/// I link già scoperti da un blocco **più interno** non si sovrascrivono: il
/// contesto è quello del blocco più vicino che porti del testo, che è ciò che
/// faceva già un paragrafo dentro una citazione.
fn inlines_del_blocco<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    anchor: Option<&FoundAnchor>,
    text: &mut String,
) -> Vec<Inline> {
    let link_base = acc.links.len();
    let mut inlines = convert_inlines(node, source, offsets, ctx, acc, text);
    if let Some(a) = anchor {
        strip_marker(&mut inlines, text, &a.written);
    }
    // Il contesto di un link è una **finestra** del testo del blocco che lo
    // contiene: la regola sta in `rules::snippet`, che ritaglia attorno al
    // link e aggiunge l'ellissi dove taglia. La finestra si calcola sul testo
    // **non trimmato** — le posizioni dei link sono state registrate durante
    // la costruzione, e un trim in testa le sposterebbe — e il trim lo fa la
    // regola, sulla finestra.
    //
    // Un contesto vuoto non è un contesto: `Some("")` occuperebbe il campo e
    // impedirebbe a chiunque altro di riempirlo, dicendo niente.
    for (link, nel_testo) in &mut acc.links[link_base..] {
        if link.context.is_none() {
            let c = snippet::window(text, nel_testo.clone());
            if !c.is_empty() {
                link.context = Some(c);
            }
        }
    }
    inlines
}

/// L'etichetta che comrak ha **sintetizzato dal bersaglio**, se è quella.
///
/// Un wikilink senza alias in comrak non è un nodo senza figli: è un nodo con
/// **un** figlio testo che ripete il bersaglio parola per parola. Non c'è un
/// campo che dica «questa l'ho messa io», e quindi la si riconosce dalla forma:
/// un figlio solo, di testo, uguale all'url del nodo. `None` per tutto il
/// resto, cioè per ogni etichetta che l'autore abbia scritto.
///
/// **La zona cieca che era dichiarata qui, e perché non c'è più**:
/// `[[Nota|Nota]]` — un alias battuto identico al bersaglio — risponde `Some`,
/// perché *dal nodo* i due casi sono indistinguibili, e la riga che stava qui
/// concludeva che distinguerli sarebbe costato una seconda grammatica del `|`
/// accanto a quella di comrak. La differenza osservabile però non era solo il
/// `#` di un alias: era **la riscrittura**, che toglieva dal file un `|Nota` che
/// l'utente aveva battuto a mano. E la seconda grammatica non serviva, perché
/// c'era già: [`scan::parse_wikilink_inner`] legge quel `|` per ricavare il
/// bersaglio e restituisce il campo `alias`, che il chiamante buttava. La
/// risposta di questa funzione resta quella che è — «il nodo da solo non lo sa»
/// — e chi la chiama la incrocia con l'alias del contratto.
/// L'autore ha scritto un `|` dentro queste due parentesi?
///
/// La domanda si fa **alla sorgente** perché il nodo di comrak non la sa
/// rispondere: `wl.url` porta il solo bersaglio, e l'etichetta è un figlio di
/// testo identico sia quando l'ha scritta l'autore sia quando l'ha sintetizzata
/// il parser. A leggere l'interno è [`scan::parse_wikilink_inner`], la stessa
/// funzione che ha già ricavato il bersaglio: qui la si applica ai byte giusti
/// invece che a un url in cui l'alias non c'è più.
fn alias_scritto(source: &str, span: Span) -> bool {
    let Some(slice) = source.get(span.start..span.end) else {
        return false;
    };
    let Some(inner) = slice
        .trim_start_matches('!')
        .strip_prefix("[[")
        .and_then(|s| s.strip_suffix("]]"))
    else {
        return false;
    };
    scan::parse_wikilink_inner(inner).alias.is_some()
}

fn etichetta_sintetica<'a>(node: &'a AstNode<'a>, url: &str) -> Option<String> {
    let mut figli = node.children();
    let solo = figli.next()?;
    if figli.next().is_some() {
        return None;
    }
    let value = &solo.data.borrow().value;
    let NodeValue::Text(testo) = value else {
        return None;
    };
    (testo == url).then(|| testo.to_string())
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
                push_text_features(source, slice, &s, span.start, ctx, acc, &mut out);
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
                let inizio = text_out.len();
                text_out.push_str(&label_text);
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&link.url),
                    Some(label),
                    false,
                    span,
                    inizio..text_out.len(),
                );
            }
            NodeValue::WikiLink(wl) => {
                let (embed, span) = embed_before(source, span);
                let parsed = scan::parse_wikilink_inner(&wl.url);
                // **L'etichetta che nessuno ha scritto non è prosa.** Senza
                // alias comrak sintetizza l'etichetta dal bersaglio, e
                // scandirla come si scandisce una frase faceva nascere dei tag
                // dal nome della nota: `[[#Sezione]]` — un link a un heading di
                // questa stessa nota — dichiarava un tag `Sezione` che
                // nell'indice stava accanto a quelli veri, con lo span
                // **dentro** quello del link, cioè sugli stessi byte che una
                // rinomina della nota riscrive.
                //
                // Il `#` di un bersaglio non è il `#` di un tag: introduce un
                // heading, e a dirlo è già `parse_wikilink_inner`, che di
                // quello stesso `#` fa il campo `heading`. Il difetto era che
                // gli stessi byte venivano letti due volte da due regole
                // diverse.
                //
                // **Un alias resta prosa**: `[[Nota|alias con #tag]]` è testo
                // che l'autore ha scritto, e il suo `#tag` è un tag suo. È la
                // metà da non rovesciare, ed è la ragione per cui la
                // distinzione sta qui e non in `push_text_features`.
                //
                // **E un'etichetta che nessuno ha scritto non è un'etichetta**:
                // `label` è un `Option` da sempre, e riempirlo col testo che
                // comrak sintetizza dal bersaglio rendeva `[[Nota]]` e
                // `[[Nota|Nota]]` lo stesso modello — quindi la riscrittura
                // toglieva il `|Nota` che l'utente aveva battuto a mano. Chi
                // legge l'etichetta per mostrarla ha il bersaglio accanto e ci
                // ricade da sé ([`LinkTarget::wiki_inner`]); chi la legge per
                // riscriverla non aveva nient'altro con cui distinguere i due
                // casi.
                //
                // A dire se l'alias c'era è `parse_wikilink_inner`, cioè **la
                // stessa regola** che ha appena letto il bersaglio: non è una
                // seconda grammatica del `|` accanto a quella di comrak — che
                // era il costo per cui la distinzione era stata dichiarata
                // troppo cara — è il campo `alias` che quella funzione
                // restituiva già e che qui si buttava.
                //
                // Il terzo caso è quello che tiene ferma la promessa già
                // presidiata da `un_riferimento_si_riscrive_com_era`: quando la
                // forma scritta dal bersaglio **non è quella canonica**
                // (`[[Nota^blocco]]`, che il nostro lettore accetta per
                // indulgenza), l'etichetta sintetica dice qualcosa che il
                // bersaglio canonico non direbbe più — «Nota^blocco» contro
                // «Nota#^blocco» — e allora è contenuto da conservare, non da
                // ricalcolare. Riparare dove un riferimento *punta* non è titolo
                // per cambiare ciò che si *legge*.
                let sintetica = etichetta_sintetica(child, &wl.url);
                let scritta_a_mano = alias_scritto(source, span)
                    || sintetica.as_deref() != parsed.target.wiki_inner().as_deref();
                let (label, nel_testo) = if scritta_a_mano {
                    let mut label_text = String::new();
                    let l = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                    let inizio = text_out.len();
                    text_out.push_str(&label_text);
                    (Some(l), inizio..text_out.len())
                } else {
                    // Il testo mostrato entra nel testo del blocco lo stesso —
                    // è ciò che si legge a schermo, e la finestra di contesto di
                    // un backlink si centra lì — ma senza passare per la
                    // scansione dei tag, che è il difetto qui sopra.
                    let inizio = text_out.len();
                    text_out.push_str(&wl.url);
                    (None, inizio..text_out.len())
                };
                push_link(acc, &mut out, parsed.target, label, embed, span, nel_testo);
            }
            NodeValue::Image(img) => {
                let mut label_text = String::new();
                let label = convert_inlines(child, source, offsets, ctx, acc, &mut label_text);
                // Un'immagine È un riferimento incorporato, e finché non entrava
                // in `links` nessun riferimento ad allegato veniva aggiornato al
                // rename, né risultava fra gli orfani (13.1): non perché il path
                // non fosse un arco, ma perché quell'arco non veniva raccolto.
                // L'`alt` non entra nel testo del blocco — è una divergenza
                // dichiarata del corpus — quindi la posizione del link nel
                // testo è vuota, e la finestra si centra sul punto in cui
                // l'immagine sta.
                let inizio = text_out.len();
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&img.url),
                    Some(label),
                    true,
                    span,
                    inizio..text_out.len(),
                );
            }
            NodeValue::HtmlInline(literal) => {
                // **Il gemello inline di `NodeValue::HtmlBlock`**, e prima non
                // c'era: senza un ramo suo un `<b>`, un `<br>` o un `<kbd>`
                // finiva nel catch-all, che ricorre sui figli — e un
                // `HtmlInline` di figli non ne ha, perché il markup lo porta
                // tutto nel proprio `literal`. Non degradava: **spariva**, e
                // spariva prima di ogni altro lato, cioè dal modello. La resa
                // era la metà che si vedeva meno; quella che costava era la
                // **riscrittura**, perché `serialize` scrive ciò che il modello
                // ha: `un <b>grassetto</b> inline` tornava sul disco come `un
                // grassetto inline`, e i tag dell'utente erano cancellati dal
                // suo file.
                //
                // Che i byte restino **dato** e non tornino markup è la stessa
                // scelta del blocco, presa nello stesso posto: `custom_kind::
                // HTML` è `Carico::Sorgente("html")`, quindi `serialize` li
                // ricopia identici e `render` li mostra escapati. Cosa sia
                // lecito eseguire lo decide la sanitizzazione (5.3), non il
                // provider che ha letto il file.
                //
                // In `text_out` **non ci vanno**, e qui il blocco non fa da
                // esempio: un `HtmlBlock` è tutto il contenuto del proprio
                // blocco, e se non entrasse nel testo indicizzato quel blocco
                // non sarebbe cercabile affatto; un `<b>` sta in mezzo a una
                // frase che il suo testo ce l'ha già nei nodi accanto, e
                // metterci dentro il markup significherebbe scrivere `un <b>
                // grassetto </b> inline` nel contesto di un backlink e nel
                // testo su cui si cerca.
                out.push(Inline::Custom {
                    custom_kind: custom_kind::HTML.to_string(),
                    attrs: serde_json::json!({ "html": literal }),
                    span,
                });
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
    source: &str,
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
        push_plain_or_tags(source, slice, decoded, base, ctx, acc, out);
        return;
    }
    let mut cursor = 0;
    for (parentesi, inner) in embeds {
        // Il `!` lo aggiunge allo span [`embed_before`], che è la stessa
        // funzione da cui passa il ramo comrak: qui `find_embeds` consegna le
        // sole parentesi, e chi decide dove comincia un embed è uno solo.
        let (embed, abs) = embed_before(
            source,
            Span::new(base + parentesi.start, base + parentesi.end),
        );
        let inizio = abs.start - base;
        if inizio > cursor {
            let seg = &slice[cursor..inizio];
            push_plain_or_tags(source, seg, seg, base + cursor, ctx, acc, out);
        }
        let parsed = scan::parse_wikilink_inner(&inner);
        // L'embed testuale sta DENTRO il testo pushato (comrak non l'ha
        // riconosciuto, quindi i suoi byte sono testo): la posizione è quella
        // della fetta di sorgente, che coincide col testo fintanto che non ci
        // sono entità da decodificare davanti — e se ce ne sono, la finestra
        // si centra male ma la regola normalizza i confini senza mai panicare.
        // L'alias di un embed è dell'autore quanto quello di un link, e finché
        // questa strada passava `None` senza guardarlo un `![[Nota|Alias]]`
        // rientrava dal giro come `![[Nota]]`.
        let label = parsed.alias.map(|a| vec![Inline::Text(a)]);
        push_link(
            acc,
            out,
            parsed.target,
            label,
            embed,
            abs,
            (abs.start - base)..(abs.end - base),
        );
        cursor = abs.end - base;
    }
    if cursor < slice.len() {
        let seg = &slice[cursor..];
        push_plain_or_tags(source, seg, seg, base + cursor, ctx, acc, out);
    }
}

/// Il `!` che precede un `[[…]]` lo rende un **embed**, e allora lo span
/// comincia da lì.
///
/// Il `!` è parte del riferimento, non del testo che lo precede: chi cancella o
/// riscrive un embed guidato dal suo span deve portarsi via anche quello, o
/// resta un punto esclamativo orfano. Sotto escape (`\![[…]]`) è un punto
/// esclamativo letterale: niente embed, e lo span resta quello delle parentesi.
///
/// **Sta in una funzione sola perché le strade che leggono un `[[…]]` sono
/// due**: il nodo `WikiLink` di comrak e il ripiego testuale di [`find_embeds`]
/// — che esiste perché comrak un `![[` non lo riconosce affatto. Le due
/// rispondevano in modi diversi sullo stesso `!`: la seconda lo teneva dentro
/// lo span, la prima lo guardava per decidere `embed` e poi lo lasciava fuori.
/// Oggi la prima un `!` non escapato non lo vede mai — è per questo che il
/// disaccordo non si vede da nessuna parte — ed è esattamente la forma in cui
/// una divergenza aspetta l'aggiornamento di una dipendenza per diventare vera.
/// A confrontare le due strade adesso c'è
/// `tests/il_corpus.rs::un_embed_comincia_dal_suo_punto_esclamativo`, e il
/// contorno che ne dipende è dichiarato nel corpus della shell
/// (`frontend/src/editor/corpus.test.ts`: «lo span del modello comprende il `!`
/// dell'embed»).
fn embed_before(source: &str, parentesi: Span) -> (bool, Span) {
    if parentesi.start > 0
        && source.as_bytes()[parentesi.start - 1] == b'!'
        && !is_escaped(source, parentesi.start - 1)
    {
        (true, Span::new(parentesi.start - 1, parentesi.end))
    } else {
        (false, parentesi)
    }
}

/// Trova gli embed `![[...]]`, restituendo (span **delle sole parentesi** nel
/// frammento, contenuto interno). Il `!` lo aggiunge [`embed_before`], che è
/// dove quella decisione sta per tutt'e due le strade.
///
/// Il frammento è sorgente: un `!` sotto escape (`\![[...]]`) non apre un
/// embed.
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
                res.push((Span::new(i + 1, end), inner));
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
    source: &str,
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
            .filter(|t| {
                !sotto_escape(source, slice, base, t.span.start)
                    && !is_entity_hash(slice, t.span.start)
            })
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
            // Il testo fra le feature viene dal **sorgente**, dove gli escape
            // sono ancora scritti: `Inline::Text` porta il testo come si legge
            // (è l'invariante da cui `serialize` decide cosa ri-escapare), e
            // una barra rovescia di sintassi lì dentro sarebbe letta come testo
            // e riscritta raddoppiata.
            out.push(Inline::Text(disescapa(&slice[cursor..tag.span.start])));
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
        out.push(Inline::Text(disescapa(&slice[cursor..])));
    }
}

/// Il carattere a `idx` è sotto escape, **anche quando la barra rovescia è
/// fuori dal nodo**?
///
/// `is_escaped` guarda la fetta, e per un escape in mezzo alla fetta basta. Il
/// caso che si perdeva è quello in testa: il `sourcepos` di comrak per un
/// carattere escapato comincia **dal carattere**, non dalla barra, quindi su
/// `\#nontag` la fetta del nodo è `#nontag` e la barra è il byte prima —
/// invisibile a chi guarda solo la fetta. Il commento accanto alla chiamata
/// diceva già la cosa giusta («sul sorgente gli escape sono ancora visibili»),
/// ma la fetta non è il sorgente: il risultato era che `\#nontag` **dichiarava
/// un tag**, che finiva nell'indice e nel pannello dei tag.
fn sotto_escape(source: &str, slice: &str, base: usize, idx: usize) -> bool {
    if is_escaped(slice, idx) {
        return true;
    }
    // Solo in testa, e solo se la fetta è davvero quella del sorgente a `base`:
    // il ripiego di `convert_inlines` passa il testo decodificato, e lì gli
    // offset non allineano.
    idx == 0
        && base > 0
        && source.get(base..base + slice.len()) == Some(slice)
        && is_escaped(source, base)
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
