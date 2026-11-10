//! Le definizioni di riferimento: dove stanno, attraverso i contenitori, e
//! il sorgente in ombra che le ritrova.

use super::*;

// ---------------------------------------------------------------------------
// Reference definitions
// ---------------------------------------------------------------------------
//
// comrak non lascia un nodo per una reference definition: le consuma dentro il
// paragrafo (`resolve_reference_link_definitions`) e stacca il paragrafo di
// sola definizione (`finalize_borrowed`). Questo pre-pass le rilegge dalla
// sorgente **prima** della conversione, con la stessa grammatica del parser
// comrak: i paragrafi **misti** restano nell'albero e si riscontano i loro
// sourcepos (per comrak il contenuto dopo lo sconto ricomincia dalla riga del
// primo `[`, e i nodi inline che ne nascono portano riga e colonna di lì — la
// verità è che la riga e la colonna sono quelle del sorgente, `n` righe più in
// là); quelli di **sola** definizione — che nell'albero non ci sono più — si
// rileggono da un'ombra della sorgente in cui comrak non le riconosce (vedi
// [`ombra_sorgente`]).

/// Un livello di contenitore: quanto di ogni riga di paragrafo appartiene al
/// contenitore e non al testo. Serve a ricostruire il `line_offsets` di comrak
/// (che è privato) per correggere le colonne degli inline residui.
#[derive(Clone, Copy)]
enum Container {
    /// Una citazione: la larghezza del marcatore (`>` o `> `).
    BlockQuote(usize),
    /// Una voce di lista: rientro del marcatore e larghezza del suo prefisso.
    ListItem { width: usize, indent: usize },
}

/// Una definizione letta dalla sorgente, già tradotta in byte e decodificata.
pub(super) struct Definition {
    pub(super) span: Span,
    pub(super) label: String,
    pub(super) url: String,
    pub(super) title: Option<String>,
}

/// Il recupero: cammina l'albero, per ogni paragrafo legge le definizioni in
/// testa e risconta i sourcepos del contenuto residuo; i paragrafi di **sola**
/// definizione — che comrak ha già staccato — si rileggono dall'ombra della
/// sorgente (vedi [`gira_ombra`]).
pub(super) fn recover_definitions<'a>(
    root: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    options: &Options<'_>,
) -> Vec<Definition> {
    // Una definizione comincia con `[etichetta]:`, i due caratteri attaccati
    // anche quando l'etichetta va a capo: senza `]:` nella sorgente non ce n'è
    // nessuna, e non si paga il secondo parse dell'ombra.
    if !source.contains("]:") {
        return Vec::new();
    }
    let mut defs = Vec::new();
    let mut containers: Vec<Container> = Vec::new();
    // Gli span dei paragrafi **prima** della correzione dei misti: è contro
    // questi che l'ombra decide se un suo paragrafo è un paragrafo vero.
    let mut real_spans = Vec::new();
    paragraph_spans(root, offsets, &mut real_spans);
    walk_definitions(root, source, offsets, &mut defs, &mut containers);
    // I paragrafi di **sola** definizione comrak li stacca in
    // `finalize_borrowed` (l'arm `Paragraph`): nell'albero vero non ci sono, e
    // il giro sopra non li ha visti — senza un recupero, `[rif]: nota.md` da
    // solo produceva `body: []`. Si rileggono da un'ombra della sorgente a
    // lunghezza uguale in cui comrak non riconosce le definizioni: lì quei
    // paragrafi restano, e la fetta si legge dal vero con lo stesso span.
    let shadow = shadow_source(source, options.extension.footnotes);
    let arena = Arena::new();
    let shadow_root = comrak::parse_document(&arena, text_policy::strip_bom(&shadow), options);
    walk_shadow(shadow_root, source, offsets, &real_spans, &mut defs);
    defs
}

fn walk_definitions<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    defs: &mut Vec<Definition>,
    containers: &mut Vec<Container>,
) {
    let value = node.data.borrow().value.clone();
    let span = span_of(node, offsets);
    match value {
        NodeValue::Paragraph => {
            let Some(slice) = source.get(span.start..span.end) else {
                return;
            };
            // Definizioni in testa, come le consuma comrak: una dopo l'altra,
            // finché la riga non comincia più con `[`.
            let before = defs.len();
            let pos = definitions_from_slice(slice, span.start, source, defs);
            if defs.len() == before {
                return;
            }
            // Qui arrivano solo i paragrafi **misti**: quello di sola
            // definizione comrak lo stacca in `finalize_borrowed`, e lo
            // rilegge l'ombra (`gira_ombra`). Il contenuto residuo comincia
            // alla riga `n`+1, alla colonna del primo byte di contenuto di lì.
            let n = terminators_in(&slice[..pos]);
            let remainder = &slice[pos..];
            if remainder.is_empty() {
                // Difensivo: comrak ha già staccato il paragrafo vuoto, e se
                // un residuo vuoto arrivasse qui non ci sarebbe nulla da
                // riscontare.
                return;
            }
            let mut sp = node.data.borrow().sourcepos;
            let row_zero = sp.start.line;
            sp.start.line += n;
            let (prefixes, virtual_prefixes) = row_prefixes(source, span.start, slice, containers);
            sp.start.column = 1 + prefixes[n];
            node.data.borrow_mut().sourcepos = sp;
            let delta = |row: usize| -> isize {
                // `comrak` conta le colonne come se ogni riga fosse la prima
                // del paragrafo: il prefisso virtuale è quello implicito nei
                // suoi sourcepos, mentre `prefixes[k]` è quello fisico.
                let k = row.saturating_sub(row_zero) + n;
                let physical = prefixes.get(k).copied().unwrap_or(0) as isize;
                let virtual_prefix = virtual_prefixes.get(k).copied().unwrap_or(0) as isize;
                physical - virtual_prefix
            };
            shift_descendants(node, n, &delta);
        }
        NodeValue::BlockQuote => {
            let width = blockquote_width(source, span.start);
            containers.push(Container::BlockQuote(width));
            for child in node.children() {
                walk_definitions(child, source, offsets, defs, containers);
            }
            containers.pop();
        }
        NodeValue::List(_) => {
            for item in node.children() {
                let width = marker_width(source, offsets, item);
                let item_start = item.data.borrow().sourcepos.start;
                let line_start = offsets.byte(item_start.line, 1);
                let marker_start = offsets.byte(item_start.line, item_start.column);
                let marker_indent = marker_start.saturating_sub(line_start);
                let line_end = source.as_bytes()[line_start..]
                    .iter()
                    .position(|&c| matches!(c, b'\r' | b'\n'))
                    .map_or(source.len(), |end| line_start + end);
                let parent_prefix = container_prefix(&source[line_start..line_end], containers);
                let indent = marker_indent.saturating_sub(parent_prefix);
                containers.push(Container::ListItem { width, indent });
                for child in item.children() {
                    walk_definitions(child, source, offsets, defs, containers);
                }
                containers.pop();
            }
        }
        _ => {
            // Gli altri contenitori (footnote, definition list, html…) non
            // aggiungono marcatori di riga propri; i figli si visitano uguale.
            for child in node.children() {
                walk_definitions(child, source, offsets, defs, containers);
            }
        }
    }
}

/// Gli span dei paragrafi dell'albero vero, **prima** che la correzione dei
/// misti li sposti: è contro questi che l'ombra decide se un suo paragrafo è
/// un paragrafo vero (già letto dal giro principale) o uno staccato da comrak.
fn paragraph_spans<'a>(node: &'a AstNode<'a>, offsets: &Offsets<'_>, spans: &mut Vec<Span>) {
    let value = node.data.borrow().value.clone();
    if matches!(value, NodeValue::Paragraph) {
        spans.push(span_of(node, offsets));
        return;
    }
    for child in node.children() {
        paragraph_spans(child, offsets, spans);
    }
}

/// L'ombra a lunghezza uguale: ogni `[` diventa una `x`.
///
/// Le reference definition sono l'unico costrutto che comrak consuma dentro un
/// paragrafo, e le riconosce dal primo carattere: senza `[` i paragrafi di
/// sola definizione restano paragrafi, con gli **stessi** span — la lunghezza
/// non cambia, quindi le posizioni dell'ombra sono quelle del vero.
///
/// `[^` resta intatto quando le footnote sono attive: lì non è una definizione
/// da recuperare ma un blocco `FootnoteDefinition`, che l'ombra deve
/// conservare come il vero — sennò una nota tornerebbe come reference
/// definition.
fn shadow_source(source: &str, footnotes: bool) -> String {
    let b = source.as_bytes();
    let mut shadow = Vec::with_capacity(b.len());
    for (the, &c) in b.iter().enumerate() {
        if c == b'[' && !(footnotes && b.get(the + 1) == Some(&b'^')) {
            shadow.push(b'x');
        } else {
            shadow.push(c);
        }
    }
    // La sostituzione è byte-per-byte a lunghezza uguale, e l'unico byte
    // cambiato è `[` (un byte): la stringa resta UTF-8 valida.
    String::from_utf8(shadow).expect("shadow is a permutation of the source")
}

/// Il giro sull'ombra: legge le definizioni dei paragrafi che nessun paragrafo
/// vero copre — sono quelli che comrak ha staccato perché di **sola**
/// definizione. La fetta si legge dal vero (l'ombra ha gli stessi span), e per
/// loro non c'è alcun sourcepos da correggere: contenuto residuo non ce n'è.
fn walk_shadow<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    real_spans: &[Span],
    defs: &mut Vec<Definition>,
) {
    let value = node.data.borrow().value.clone();
    if matches!(value, NodeValue::Paragraph) {
        let span = span_of(node, offsets);
        // `reali` è ordinato per inizio e disgiunto (pre-order di
        // `span_dei_paragrafi`): il solo candidato a contenere `span` è il
        // primo che non finisce prima di lui.
        let idx = real_spans.partition_point(|r| r.end <= span.start);
        if real_spans.get(idx).is_some_and(|r| contains_span(*r, span)) {
            return;
        }
        if let Some(slice) = source.get(span.start..span.end) {
            definitions_from_slice(slice, span.start, source, defs);
        }
        return;
    }
    for child in node.children() {
        walk_shadow(child, source, offsets, real_spans, defs);
    }
}

/// Quante righe hanno consumato le definizioni: il numero di terminatori nella
/// fetta consumata (`\r\n` è **un** terminatore).
fn terminators_in(slice: &str) -> usize {
    let b = slice.as_bytes();
    let mut n = 0;
    let mut the = 0;
    while the < b.len() {
        match b[the] {
            b'\n' => {
                n += 1;
                the += 1;
            }
            b'\r' => {
                n += 1;
                the += 1;
                if b.get(the) == Some(&b'\n') {
                    the += 1;
                }
            }
            _ => the += 1,
        }
    }
    n
}

/// I prefissi di riga del paragrafo: per ogni riga della fetta, quanti byte di
/// marcatore e indentazione comrak ha consumato (il suo `line_offsets`, che il
/// crate tiene privato). `slice_start` è il byte della prima riga nel sorgente.
/// Restituisce il prefisso fisico della riga e quello virtuale che `comrak`
/// riflette nei sourcepos.
fn row_prefixes(
    source: &str,
    slice_start: usize,
    slice: &str,
    containers: &[Container],
) -> (Vec<usize>, Vec<usize>) {
    let mut prefixes = Vec::new();
    let mut virtual_prefixes = Vec::new();
    let mut row_start = slice_start;
    for row in lines_of(slice) {
        let end = row_start + row.len();
        let row = &source[row_start..end];
        let physical = row_prefix(row, containers);
        prefixes.push(physical);
        virtual_prefixes.push(virtual_prefix(row, containers));
        row_start = end;
        // il terminatore sta fra le righe della fetta? la riga seguente
        // comincia dopo; `lines_of` non lo include.
        if row_start < source.len() {
            let was_cr = source.as_bytes()[row_start] == b'\r';
            row_start += 1;
            if was_cr && source.as_bytes().get(row_start) == Some(&b'\n') {
                row_start += 1;
            }
        }
    }
    (prefixes, virtual_prefixes)
}

/// Le righe di una fetta, senza i terminatori.
fn lines_of(slice: &str) -> impl Iterator<Item = &str> {
    let mut rest = Some(slice);
    std::iter::from_fn(move || {
        let current = rest.take()?;
        if current.is_empty() {
            return None;
        }
        let bytes = current.as_bytes();
        let end = bytes
            .iter()
            .position(|&c| matches!(c, b'\r' | b'\n'))
            .unwrap_or(current.len());
        if end < current.len() {
            let width = if bytes[end] == b'\r' && bytes.get(end + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
            rest = Some(&current[end + width..]);
        }
        Some(&current[..end])
    })
}

/// La larghezza del marcatore della citazione sulla riga d'apertura.
fn blockquote_width(source: &str, start: usize) -> usize {
    let Some(row) = source.get(start..) else {
        return 2;
    };
    let line_end = row
        .as_bytes()
        .iter()
        .position(|&c| matches!(c, b'\r' | b'\n'))
        .unwrap_or(row.len());
    let bytes = &row.as_bytes()[..line_end];
    let Some(marker) = bytes.iter().position(|&c| c == b'>') else {
        return 2;
    };
    1 + usize::from(bytes.get(marker + 1) == Some(&b' '))
}

/// I byte della riga che appartengono ai soli contenitori, senza
/// l'indentazione del paragrafo.
fn container_prefix(row: &str, containers: &[Container]) -> usize {
    let b = row.as_bytes();
    let mut the = 0;
    for &m in containers {
        match m {
            Container::BlockQuote(_) => {
                let indent = b[the..]
                    .iter()
                    .take_while(|&&c| c == b' ' || c == b'\t')
                    .count();
                the += indent;
                if b.get(the) == Some(&b'>') {
                    the += 1;
                    if b.get(the) == Some(&b' ') {
                        the += 1;
                    }
                } else {
                    break;
                }
            }
            Container::ListItem { width, .. } => {
                let line_indent = b[the..]
                    .iter()
                    .take_while(|&&c| c == b' ' || c == b'\t')
                    .count();
                let marker = the + line_indent;
                if matches!(b.get(marker), Some(b'-' | b'+' | b'*' | b'0'..=b'9')) {
                    the = (marker + width).min(b.len());
                } else {
                    the = (the + line_indent.max(width)).min(b.len());
                }
            }
        }
    }
    the
}

/// Quanti byte della riga appartengono ai contenitori (e all'indentazione del
/// paragrafo): per una riga pigra (citazione che non si apre) il contenuto
/// reale resta nella stessa posizione fisica, anche se `comrak` ne assume
/// il marcatore implicito.
fn row_prefix(row: &str, containers: &[Container]) -> usize {
    let b = row.as_bytes();
    let the = container_prefix(row, containers);
    the + b[the..]
        .iter()
        .take_while(|&&c| c == b' ' || c == b'\t')
        .count()
}

/// Prefisso che `comrak` ha già incorporato nei sourcepos della riga.
fn virtual_prefix(row: &str, containers: &[Container]) -> usize {
    let b = row.as_bytes();
    let mut the = 0;
    let mut prefix = 0;
    for &m in containers {
        match m {
            Container::BlockQuote(width) => {
                let indent = b[the..]
                    .iter()
                    .take_while(|&&c| c == b' ' || c == b'\t')
                    .count();
                the += indent;
                if b.get(the) == Some(&b'>') {
                    let marker = 1 + usize::from(b.get(the + 1) == Some(&b' '));
                    the += marker;
                    prefix += indent + marker;
                } else {
                    prefix += width + indent;
                    break;
                }
            }
            Container::ListItem { width, indent } => {
                let line_indent = b[the..]
                    .iter()
                    .take_while(|&&c| c == b' ' || c == b'\t')
                    .count();
                let marker = the + line_indent;
                if matches!(b.get(marker), Some(b'-' | b'+' | b'*' | b'0'..=b'9')) {
                    the = (marker + width).min(b.len());
                    prefix += line_indent + width;
                } else {
                    the = (the + line_indent.max(width)).min(b.len());
                    prefix += indent + width;
                }
            }
        }
    }
    prefix
}

/// La larghezza in byte del marcatore della voce: `- ` → 2, `1. ` → 3.
fn marker_width(source: &str, offsets: &Offsets<'_>, item: &AstNode<'_>) -> usize {
    let sp = item.data.borrow().sourcepos.start;
    let start = offsets.byte(sp.line, 1);
    let row = &source[start..];
    let rb = row.as_bytes();
    let marker_start = offsets.byte(sp.line, sp.column).saturating_sub(start);
    let mut the = marker_start;
    if matches!(rb.get(the), Some(b'-' | b'+' | b'*')) {
        the += 1;
    } else {
        let mut digits = 0;
        while rb.get(the).is_some_and(|c| c.is_ascii_digit()) {
            the += 1;
            digits += 1;
        }
        if digits == 0 || !matches!(rb.get(the), Some(b'.' | b')')) {
            return 2;
        }
        the += 1;
    }
    let spaces = rb[the..]
        .iter()
        .take_while(|&&c| c == b' ' || c == b'\t')
        .take(4)
        .count();
    if spaces == 0 {
        2
    } else {
        (the - marker_start) + spaces
    }
}

/// Sposta i sourcepos dei discendenti di un paragrafo misto: righe di `n`,
/// colonne secondo lo scarto fra il prefisso fisico e quello implicito nei
/// sourcepos di `comrak`.
fn shift_descendants<'a>(node: &'a AstNode<'a>, n: usize, delta: &dyn Fn(usize) -> isize) {
    for child in node.children() {
        shift_node(child, n, delta);
    }
}

fn shift_node<'a>(node: &'a AstNode<'a>, n: usize, delta: &dyn Fn(usize) -> isize) {
    let mut sp = node.data.borrow().sourcepos;
    let start_line = sp.start.line;
    let end_line = sp.end.line;
    let start_delta = delta(start_line);
    let end_delta = delta(end_line);
    sp.start.line += n;
    sp.end.line += n;
    sp.start.column = (sp.start.column as isize + start_delta).max(1) as usize;
    sp.end.column = (sp.end.column as isize + end_delta).max(1) as usize;
    node.data.borrow_mut().sourcepos = sp;
    for child in node.children() {
        shift_node(child, n, delta);
    }
}
