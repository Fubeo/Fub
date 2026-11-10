//! Parsing: AST comrak → `DocumentModel` comune.

use std::collections::HashMap;
use std::ops::Range;
use std::sync::OnceLock;

use comrak::nodes::{AstNode, ListType, NodeValue, Sourcepos, TableAlignment};
use comrak::{Arena, Options};
use entities::ENTITIES;
use fub_abi::format::ParseContext;
use fub_abi::model::{
    canonical_anchor, custom_kind, valid_anchor, Anchor, Block, ColumnAlign, DocId, DocumentModel,
    Frontmatter, Heading, HeadingSlugs, Inline, Link, LinkTarget, ListItem, Span, TableCell,
    TableRow, Tag, TaskMarker,
};
use fub_abi::options::syntax;
use fub_abi::rules::snippet;
use fub_abi::rules::text_policy;
use fub_abi::rules::yaml;
use fub_abi::FormatError;
use fub_sdk::scan;

use crate::offsets::Offsets;

const MAX_DEPTH: u32 = fub_abi::model::MAX_DOCUMENT_DEPTH;

/// Costruisce le opzioni comrak per il dialetto Obsidian.
pub fn build_options(ctx: &ParseContext) -> Options<'static> {
    let mut or = Options::default();
    or.extension.front_matter_delimiter = Some("---".to_string());
    or.extension.strikethrough = true;
    or.extension.table = true;
    or.extension.tasklist = true;
    // Senza `relaxed`, comrak riconosce come task solo `[ ]`, `[x]` e `[X]`: un
    // `[/]` resterebbe testo, e gli stati personalizzati (10.1) sarebbero
    // irrappresentabili proprio nel modello che la decisione 0003 apre per loro.
    or.parse.relaxed_tasklist_matching = true;
    or.extension.superscript = true;
    // `~x~` è pedice, `~~x~~` barrato (decisione 0228): come nella Live, dove
    // la grammatica Lezer li legge già così.
    or.extension.subscript = true;
    // GitHub alerts ≈ callout Obsidian.
    or.extension.alerts = true;
    // Footnote e definition list: la decisione 0003 dice che restino
    // `Block::Custom`, ma con un `custom_kind` **registrato** nel contratto — e
    // una decisione su come rappresentare qualcosa che il parser non produce
    // affatto sarebbe stata presa a vuoto.
    or.extension.footnotes = true;
    or.extension.description_lists = true;
    if ctx.enabled(syntax::WIKILINKS) {
        or.extension.wikilinks_title_after_pipe = true;
    }
    // `$…$` e `$$…$$` li legge il parser e non una `SyntaxRule`: una regola
    // prende il testo **dopo** il parse, e dentro una formula il parse ha già
    // fatto danni — `\{` diventava `{`, `\,` una virgola, `a*b*c` un corsivo.
    // Il contenuto di una formula non è markdown, e solo la grammatica può
    // non leggerlo come tale. Il recinto ```` ```math ```` resta della regola.
    if ctx.enabled(syntax::MATH) {
        or.extension.math_dollars = true;
    }
    or
}
/// Quanti backslash contigui precedono `at`.
fn backslashes_before(bytes: &[u8], at: usize) -> usize {
    bytes[..at]
        .iter()
        .rev()
        .take_while(|&&b| b == b'\\')
        .count()
}

fn footnote_close(source: &str, start: usize, limit: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut depth = 1;
    // La fila di backslash si conta andando avanti: ricontarla a ritroso per
    // ogni byte costava il quadrato di una fila lunga.
    let mut run = backslashes_before(bytes, start.min(bytes.len()));
    for (at, &byte) in bytes.iter().enumerate().take(limit).skip(start) {
        if matches!(byte, b'\r' | b'\n') {
            return None;
        }
        let escaped = !run.is_multiple_of(2);
        run = if byte == b'\\' { run + 1 } else { 0 };
        if escaped {
            continue;
        }
        match byte {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(at + 1);
                }
            }
            _ => {}
        }
    }
    None
}
/// Controlla il limite di annidamento senza ricorrere: le passate preliminari
/// (`recover_definitions`) devono poter rifiutare anche un AST ostile.
fn exceeds_max_depth<'a>(root: &'a AstNode<'a>) -> bool {
    let mut pending = vec![(root, 0)];
    while let Some((node, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return true;
        }
        for child in node.children() {
            pending.push((child, depth.saturating_add(1)));
        }
    }
    false
}

/// Il codice in riga vince sulla formula, come nella shell: lì un `$…$` che
/// scavalca un `` `…` `` non è una formula (`isFree` della vivi preview), qui
/// comrak legge i dollari da sinistra e chiude anche sul `$` dentro il codice
/// che viene dopo. `costa $5, usa `$HOME`` diventava una formula, e col codice
/// sparivano dal modello i tag e i link che stavano in mezzo.
///
/// Nei blocchi dove una formula ha ingoiato un backtick, gli inline si
/// rileggono da un secondo parse senza dollari, che si paga solo lì. I due
/// alberi hanno gli stessi blocchi con gli stessi sourcepos: comrak legge
/// `math_dollars` soltanto nel parser inline. Il giro è iterativo, come
/// quello di [`exceeds_max_depth`], che dopo misura l'albero innestato.
fn code_beats_dollars<'a>(
    arena: &'a Arena<'a>,
    root: &'a AstNode<'a>,
    source: &str,
    options: &Options<'_>,
) {
    let mut swallowed: Vec<(BlockKey, &'a AstNode<'a>)> = Vec::new();
    for node in root.descendants() {
        let crosses = matches!(
            &node.data.borrow().value,
            NodeValue::Math(math) if math.literal.contains('`')
        );
        if !crosses {
            continue;
        }
        let mut holder = node.parent();
        while let Some(block) = holder {
            if block.data.borrow().value.contains_inlines() {
                break;
            }
            holder = block.parent();
        }
        if let Some(block) = holder {
            let key = block_key(block);
            if !swallowed.iter().any(|(k, _)| *k == key) {
                swallowed.push((key, block));
            }
        }
    }
    if swallowed.is_empty() {
        return;
    }
    let mut plain = options.clone();
    plain.extension.math_dollars = false;
    let plain_root = comrak::parse_document(arena, text_policy::strip_bom(source), &plain);
    let mut pairs = Vec::new();
    for node in plain_root.descendants() {
        let key = block_key(node);
        if let Some(at) = swallowed.iter().position(|(k, _)| *k == key) {
            pairs.push((swallowed.swap_remove(at).1, node));
        }
    }
    for (block, plain_block) in pairs {
        for child in block.children().collect::<Vec<_>>() {
            child.detach();
        }
        for child in plain_block.children().collect::<Vec<_>>() {
            block.append(child);
        }
    }
}

/// Gli inline di una cella tornano sui byte del sorgente.
///
/// comrak toglie la barra di ogni `\|` prima di leggere gli inline di una cella
/// (`unescape_pipes`), e i loro sourcepos contano i byte di quel testo, non del
/// sorgente: ogni barra tolta spostava di un byte a sinistra tutto ciò che la
/// seguiva. In `| a\|b [[w]] |` lo span del link affettava ` [[w]`, che la
/// rinomina rifiuta, e un `#tag` non era più un tag perché la sua fetta non era
/// quella del testo.
///
/// Le colonne si correggono nel sistema di comrak, dove una cella conta un byte
/// per colonna dal suo inizio. La `j`-esima `|` sciolta è finita in `columns[j]`:
/// un inizio esce dopo quelle che lo precedono, e cade sulla barra se comincia
/// proprio sulla `|`; una fine, inclusiva, comprende anche la sua.
fn escaped_pipes_in_cells<'a>(root: &'a AstNode<'a>, source: &str, offsets: &Offsets<'_>) {
    for cell in root.descendants() {
        if !matches!(cell.data.borrow().value, NodeValue::TableCell) {
            continue;
        }
        let sp = cell.data.borrow().sourcepos;
        let span = sourcepos_span(sp, offsets);
        let Some(text) = source.get(span.start..span.end) else {
            continue;
        };
        // La stessa lettura di `unescape_pipes`: una barra apre un escape
        // soltanto se non è a sua volta escapata.
        let mut columns = Vec::new();
        let mut backslash = false;
        for (at, byte) in text.bytes().enumerate() {
            if backslash && byte == b'|' {
                columns.push(sp.start.column + at - (columns.len() + 1));
            }
            backslash = !backslash && byte == b'\\';
        }
        if columns.is_empty() {
            continue;
        }
        for node in cell.descendants().skip(1) {
            let mut at = node.data.borrow().sourcepos;
            if at.start.line == sp.start.line {
                at.start.column += columns.partition_point(|&column| column < at.start.column);
            }
            if at.end.line == sp.start.line {
                at.end.column += columns.partition_point(|&column| column <= at.end.column);
            }
            node.data.borrow_mut().sourcepos = at;
        }
    }
}

/// Un blocco si riconosce nell'altro albero dalla posizione e dal tipo.
type BlockKey = (Sourcepos, std::mem::Discriminant<NodeValue>);

fn block_key<'a>(node: &'a AstNode<'a>) -> BlockKey {
    let data = node.data.borrow();
    (data.sourcepos, std::mem::discriminant(&data.value))
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
    depth_error: bool,
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
    code_beats_dollars(&arena, root, source, &options);
    // Le passate di recupero attraversano l'AST prima del convertitore e non
    // possono affidarsi al suo guard ricorsivo: per un documento ostile la
    // ricorsione preventiva sarebbe già sufficiente a esaurire lo stack.
    if exceeds_max_depth(root) {
        return Err(FormatError::Parse(format!(
            "annidamento del documento oltre {MAX_DEPTH} livelli"
        )));
    }
    escaped_pipes_in_cells(root, source, &offsets);

    // comrak consuma le reference definitions durante il parsing senza lasciare
    // un nodo nell'AST (§4: senza il recupero, `[a][rif]` + `[rif]: nota.md`
    // riscritto diventava `[a](nota.md)` e la riga di definizione spariva dal
    // file). Le si rilegge dalla sorgente, con la stessa grammatica di comrak
    // (paragrafi che cominciano con `[etichetta]:`), e si ritagliano i
    // sourcepos dei paragrafi che restano: il contenuto residuo non comincia
    // più alla riga del primo `[`.
    let defs = recover_definitions(root, source, &offsets, &options);

    let mut acc = Acc::default();
    let mut frontmatter = Frontmatter::default();
    // Il frontmatter c'era, anche quando non dichiarava niente: senza questo
    // sì/no, `---\n\n---` e un file che comincia col corpo arrivano al
    // serializer con la stessa mappa vuota, e la riscrittura toglie le due
    // righe di delimitatori invece di ricopiarle.
    let mut frontmatter_present = false;
    let mut frontmatter_end = 0;
    let mut body: Vec<Block> = Vec::new();

    for child in root.children() {
        let value = &child.data.borrow().value;
        if let NodeValue::FrontMatter(raw) = value {
            frontmatter_end = span_of(child, &offsets).end;
            // Un frontmatter che non si proietta su JSON **non si butta**: resta
            // nel modello come blocco verbatim, e da lì torna sulla sorgente
            // identico a com'era. È contenuto dell'utente, e chi non l'ha capito
            // non è autorizzato a cancellarlo.
            match parse_frontmatter(raw) {
                Ok(fm) => {
                    frontmatter = fm;
                    frontmatter_present = true;
                }
                Err(reason) => {
                    body.push(frontmatter_verbatim(raw, reason, span_of(child, &offsets)));
                }
            }
            continue;
        }
        let Some(block) = convert_block(child, source, &offsets, ctx, &mut acc, 1) else {
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

    if acc.depth_error {
        return Err(FormatError::Parse(format!(
            "annidamento del documento oltre {MAX_DEPTH} livelli"
        )));
    }

    // Le definizioni recuperate entrano nell'albero **dopo** la conversione, nel
    // contenitore più profondo che contiene il loro span: il paragrafo che le
    // portava è stato staccato dal pre-pass, e lo span dice dove abitavano.
    insert_definitions(defs, &mut body);
    if ctx.enabled(syntax::FOOTNOTES) {
        recover_unreferenced_footnotes(source, frontmatter_end, &mut body);
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

/// Le definizioni di nota che nessun richiamo usa.
///
/// comrak le toglie dall'albero, perché non hanno niente da rendere; nel file
/// però ci sono, e senza di loro il modello non sa dire «questa nota non è
/// richiamata da nessuna parte» e `serialize` le perde. Si rileggono dalle
/// righe che nessun blocco copre, con la forma che comrak riconosce:
/// `[^etichetta]:` con al più tre spazi di rientro. Entrano marcate
/// `unreferenced`, in fondo come le altre definizioni, e la resa le salta come
/// faceva comrak. Il loro testo non entra nella proiezione piatta: non c'era
/// prima, e la ricerca resta quella di sempre.
fn recover_unreferenced_footnotes(source: &str, frontmatter_end: usize, body: &mut Vec<Block>) {
    if !source.contains("[^") {
        return;
    }
    // Gli span in ordine d'inizio, ciascuno con la fine più lontana raggiunta
    // fin lì: una riga è coperta se un blocco comincia non dopo di lei e
    // finisce dopo. Chiederlo blocco per blocco costava righe × blocchi, e
    // ottantamila note citate erano due secondi.
    let mut covered: Vec<(usize, usize)> = body
        .iter()
        .map(|block| {
            let span = block.span();
            (span.start, span.end.max(span.start + 1))
        })
        .collect();
    covered.sort_unstable();
    let mut reach = 0;
    for (_, end) in &mut covered {
        reach = reach.max(*end);
        *end = reach;
    }
    let mut line_start = 0;
    while line_start < source.len() {
        let line_end = source[line_start..]
            .find('\n')
            .map_or(source.len(), |offset| line_start + offset);
        let content_end = line_end
            .checked_sub(1)
            .filter(|at| *at >= line_start && source.as_bytes()[*at] == b'\r')
            .unwrap_or(line_end);
        let free = line_start >= frontmatter_end && {
            let before = covered.partition_point(|&(start, _)| start <= line_start);
            before == 0 || covered[before - 1].1 <= line_start
        };
        if free {
            let line = &source[line_start..content_end];
            let indent = line.bytes().take_while(|byte| *byte == b' ').count();
            let definition = (indent <= 3)
                .then(|| line[indent..].strip_prefix("[^"))
                .flatten()
                .and_then(|rest| rest.find("]:").map(|end| (&rest[..end], &rest[end + 2..])));
            if let Some((label, rest)) = definition {
                if !label.is_empty() && !label.contains(['[', ']']) {
                    let start = line_start + indent;
                    let text = rest.trim();
                    let blocks = if text.is_empty() {
                        Vec::new()
                    } else {
                        let at = content_end - rest.trim_start().len();
                        vec![Block::Paragraph {
                            inlines: vec![Inline::Text(text.to_string())],
                            anchor: None,
                            span: Span::new(at, at + text.len()),
                        }]
                    };
                    body.push(custom(
                        custom_kind::FOOTNOTE_DEFINITION,
                        serde_json::json!({ "label": label, "unreferenced": true }),
                        blocks,
                        Span::new(start, content_end),
                    ));
                }
            }
        }
        if line_end == source.len() {
            break;
        }
        line_start = line_end + 1;
    }
}

mod blocks;
mod definition_text;
mod definitions;
mod frontmatter;
mod html_entities;
mod inlines;
mod spans;

use blocks::{
    block_inlines, convert_block_children, convert_table, custom, push_link, synthetic_label,
    term_span, written_alias,
};
use definition_text::{contains_span, definitions_from_slice, insert_definitions};
use definitions::{recover_definitions, Definition};
use frontmatter::{frontmatter_verbatim, parse_frontmatter};
use html_entities::{decode_segment, under_escape};
use inlines::{convert_inlines, is_escaped};
use spans::{
    clipped_after_sibling, clipped_to_child, lone_anchor, set_anchor, sourcepos_span, span_of,
    strip_marker, trailing_anchor, FoundAnchor,
};

fn convert_block<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    depth: u32,
) -> Option<Block> {
    if depth > MAX_DEPTH {
        acc.depth_error = true;
        return None;
    }
    let down = depth.saturating_add(1);
    let span = span_of(node, offsets);
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Heading(h) => {
            // L'ancora si legge sul SORGENTE prima di convertire, e si toglie
            // poi da testo e inline: `^abc` è indirizzo, non contenuto.
            let anchor = trailing_anchor(source, span, acc);
            let mut text = String::new();
            let inlines = block_inlines(
                node,
                source,
                offsets,
                ctx,
                acc,
                anchor.as_ref(),
                &mut text,
                down,
            );
            acc.text.push_str(&text);
            acc.text.push('\n');
            // Un'ancora scritta dall'utente è un id dichiarato: la generazione
            // dello slug viene **bypassata** (un id che qualcuno ha scritto non
            // si disambiguà), e lo slug è la sua forma canonica — la stessa
            // chiave con cui la tabella piatta `anchors` risolve
            // `[[Nota#^mio-id]]`. `None` conserva il comportamento storico.
            let explicit_anchor = anchor.as_ref().map(|a| a.raw.clone());
            let slug = match &explicit_anchor {
                Some(raw) => canonical_anchor(raw),
                None => acc.slugs.next_slug(text.trim()),
            };
            if explicit_anchor.is_some() {
                // Anche un id scritto dall'utente occupa lo slug per i titoli successivi.
                let _ = acc.slugs.next_slug(&slug);
            }
            acc.outline.push(Heading {
                level: h.level,
                text: text.trim().to_string(),
                slug: slug.clone(),
                span,
                explicit_anchor: explicit_anchor.clone(),
            });
            Some(Block::Heading {
                level: h.level,
                inlines,
                // L'ancora del blocco è lo slug (la chiave di `[[Nota#Titolo]]`
                // e l'`id` dell'HTML); con un id scritto è quell'id **com'è
                // scritto**, e l'HTML lo porta verbatim.
                anchor: Some(explicit_anchor.clone().unwrap_or(slug)),
                span,
                explicit_anchor,
            })
        }
        NodeValue::Paragraph => {
            let anchor = trailing_anchor(source, span, acc);
            let mut text = String::new();
            let inlines = block_inlines(
                node,
                source,
                offsets,
                ctx,
                acc,
                anchor.as_ref(),
                &mut text,
                down,
            );
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
                    if let Some(block) = convert_block(b, source, offsets, ctx, acc, down) {
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
                    span: clipped_to_child(span_of(item, offsets), span),
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
            let blocks = convert_block_children(node, source, offsets, ctx, acc, down);
            Some(Block::Quote {
                blocks,
                anchor: None,
                span,
            })
        }
        NodeValue::Alert(alert) => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc, down);
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
            down,
        )),
        NodeValue::FootnoteDefinition(f) => {
            let blocks = convert_block_children(node, source, offsets, ctx, acc, down);
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
                blocks.extend(convert_block_children(
                    item, source, offsets, ctx, acc, down,
                ));
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
            let mut blocks = convert_block_children(node, source, offsets, ctx, acc, down);
            let span = if matches!(value, NodeValue::DescriptionTerm) {
                term_span(node, source, offsets, span, &mut blocks)
            } else {
                span
            };
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
            let blocks = convert_block_children(node, source, offsets, ctx, acc, down);
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
