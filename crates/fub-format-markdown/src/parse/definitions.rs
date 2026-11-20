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
    // L'ombra si paga solo se una riga può aprire un paragrafo con
    // `[etichetta]:`: una nota a piè di pagina `[^1]:` o un `a[i]:` nel codice
    // non bastano più a rifare il parse di tutta la nota (vedi
    // [`may_hide_definitions`]).
    let shadow_needed =
        shadow_forced() || may_hide_definitions(source, options.extension.footnotes);
    // Gli span dei paragrafi **prima** della correzione dei misti: è contro
    // questi che l'ombra decide se un suo paragrafo è un paragrafo vero.
    let mut real_spans = Vec::new();
    if shadow_needed {
        paragraph_spans(root, offsets, &mut real_spans);
    }
    walk_definitions(root, source, offsets, &mut defs, &mut containers);
    if !shadow_needed {
        return defs;
    }
    count_shadow_parse();
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

/// Se l'ombra può trovare una definizione che il giro sull'albero vero non
/// vede: un **sovrainsieme** esatto dei casi in cui il secondo parse cambia il
/// risultato.
///
/// L'ombra aggiunge una definizione solo da un suo paragrafo che nessun
/// paragrafo vero copre, e solo se la fetta vera di quel paragrafo comincia
/// con `[etichetta]:` (`definitions_from_slice` legge in testa). Un paragrafo
/// comincia all'inizio di una riga, dopo i marcatori dei contenitori: rientro,
/// `>` delle citazioni, marcatori di lista (`-`, `+`, `*`, `1.`, `1)`), `:`
/// delle definition list, e gruppi fra parentesi quadre — la casella di un
/// task `[ ]` e l'etichetta di una nota `[^1]:`, dopo cui comincia il suo
/// contenuto, e i `U+FEFF`. Qui il prefisso ammesso è più largo di quello di comrak (ogni
/// combinazione di quei byte, gruppi qualsiasi sulla stessa riga): un falso sì
/// costa solo il parse di oggi, un falso no perderebbe una definizione.
///
/// Con le footnote attive l'apertura di una nota (`[^1]:`, vedi
/// [`footnote_opener`]) non è una candidata: l'ombra lascia intatto ogni `[^`,
/// e quel blocco lo legge come il vero. `[^a b]:` invece comrak non lo prende
/// per una nota, e resta una candidata come le altre. Se
/// nessuna candidata c'è, gli unici `[` che l'ombra cambia stanno a metà riga
/// (link, wikilink, codice) e non spostano nessun paragrafo che cominci con
/// `[etichetta]:` — è ciò che `shadow_gate_agrees_with_the_shadow` prova sul
/// corpus generato.
fn may_hide_definitions(source: &str, footnotes: bool) -> bool {
    const BOM_BYTES: &[u8] = "\u{feff}".as_bytes();
    let b = source.as_bytes();
    // `prefix`: tutto ciò che sta prima su questa riga può essere marcatore
    // di contenitore. `depth`: dentro un gruppo fra quadre ogni byte va bene.
    let mut prefix = true;
    let mut depth = 0usize;
    let mut at = 0;
    while at < b.len() {
        let c = b[at];
        if matches!(c, b'\n' | b'\r') {
            prefix = true;
            depth = 0;
            at += 1;
            continue;
        }
        if !prefix {
            at += 1;
            continue;
        }
        // Un `U+FEFF` davanti non è testo né per noi né per comrak, che toglie
        // il suo anche dopo il nostro: in un prefisso non chiude niente.
        if depth == 0 && b[at..].starts_with(BOM_BYTES) {
            at += BOM_BYTES.len();
            continue;
        }
        if c == b'[' {
            let footnote = footnotes && footnote_opener(&b[at..]);
            if !footnote
                && definition_text::label_at(source, at)
                    .is_some_and(|(after, _)| b.get(after) == Some(&b':'))
            {
                return true;
            }
            depth += 1;
        } else if depth > 0 {
            match c {
                b']' => depth -= 1,
                // Un escape non chiude il gruppo: `\]` resta dentro (un
                // terminatore di riga dopo la barra resta un terminatore).
                b'\\' if !matches!(b.get(at + 1), Some(b'\n' | b'\r')) => at += 1,
                _ => {}
            }
        } else if !matches!(
            c,
            b' ' | b'\t' | b'>' | b'-' | b'+' | b'*' | b'.' | b')' | b':' | b'0'..=b'9'
        ) {
            prefix = false;
        }
        at += 1;
    }
    false
}

/// Se `b` comincia con l'apertura di una nota come la riconosce comrak
/// (`scanners::footnote_definition`): `[^`, un'etichetta senza `]`, spazi,
/// tab o terminatori, `]:`. `[^a b]:` non lo è, e per comrak può essere una
/// definizione di riferimento con etichetta `^a b`.
///
/// Lo scorrimento si ferma anche al `[` dopo: comrak accetterebbe `[^a[b]:`
/// come nota, ma qui un no in più vuol dire solo provare la candidata, e
/// fermarsi lì tiene lineare una riga di `[^[^[^…`.
fn footnote_opener(b: &[u8]) -> bool {
    let Some(rest) = b.strip_prefix(b"[^") else {
        return false;
    };
    let label = rest
        .iter()
        .take_while(|&&c| !matches!(c, b']' | b'[' | b' ' | b'\t' | b'\r' | b'\n'))
        .count();
    label > 0 && rest[label..].starts_with(b"]:")
}

#[cfg(test)]
thread_local! {
    /// Quante volte questo thread ha rifatto il parse dell'ombra.
    static SHADOW_PARSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// Forza l'ombra a ogni parse, per confrontare il filtro con il recupero
    /// senza filtro.
    static FORCE_SHADOW: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn shadow_forced() -> bool {
    FORCE_SHADOW.with(std::cell::Cell::get)
}

#[cfg(not(test))]
fn shadow_forced() -> bool {
    false
}

#[cfg(test)]
fn count_shadow_parse() {
    SHADOW_PARSES.with(|n| n.set(n.get() + 1));
}

#[cfg(not(test))]
fn count_shadow_parse() {}

/// Quanto `walk_definitions` deve sapere di un nodo.
enum WalkKind {
    Paragraph,
    BlockQuote,
    List,
    Other,
}

fn walk_definitions<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    defs: &mut Vec<Definition>,
    containers: &mut Vec<Container>,
) {
    // Solo il genere del nodo, senza clonare il suo valore (testo, codice):
    // il prestito si rilascia subito, perché il ramo del paragrafo misto
    // riscrive il sourcepos con `borrow_mut`.
    let kind = match &node.data.borrow().value {
        NodeValue::Paragraph => WalkKind::Paragraph,
        NodeValue::BlockQuote => WalkKind::BlockQuote,
        NodeValue::List(_) => WalkKind::List,
        _ => WalkKind::Other,
    };
    let span = span_of(node, offsets);
    match kind {
        WalkKind::Paragraph => {
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
        WalkKind::BlockQuote => {
            let width = blockquote_width(source, span.start);
            containers.push(Container::BlockQuote(width));
            for child in node.children() {
                walk_definitions(child, source, offsets, defs, containers);
            }
            containers.pop();
        }
        WalkKind::List => {
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
        WalkKind::Other => {
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
    if matches!(node.data.borrow().value, NodeValue::Paragraph) {
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
    if matches!(node.data.borrow().value, NodeValue::Paragraph) {
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

#[cfg(test)]
mod tests {
    use super::{FORCE_SHADOW, SHADOW_PARSES};
    use fub_abi::format::ParseContext;

    /// Il parse di una nota e quante ombre ha rifatto.
    fn parse_counting(source: &str) -> (String, usize) {
        SHADOW_PARSES.with(|n| n.set(0));
        let model = super::super::parse_markdown(source, &ParseContext::obsidian("nota.md"));
        (
            format!("{model:?}"),
            SHADOW_PARSES.with(std::cell::Cell::get),
        )
    }

    /// Lo stesso parse con l'ombra rifatta sempre, come prima del filtro.
    fn parse_forced(source: &str) -> String {
        FORCE_SHADOW.with(|f| f.set(true));
        let model = super::super::parse_markdown(source, &ParseContext::obsidian("nota.md"));
        FORCE_SHADOW.with(|f| f.set(false));
        format!("{model:?}")
    }

    #[test]
    fn a_footnote_alone_does_not_pay_the_shadow() {
        let src = "# Nota\n\nTesto con richiamo[^1] e un [link](altra.md).\n\n[^1]: La nota.\n";
        let (model, parses) = parse_counting(src);
        assert_eq!(parses, 0, "una nota a piè di pagina non è una definizione");
        assert_eq!(model, parse_forced(src));
    }

    #[test]
    fn brackets_in_code_do_not_pay_the_shadow() {
        let src = "```ts\nconst a = b[i]: number;\ntype T = { x[k]: string };\n```\n\n    arr[1]: x\n\nIn riga `a[i]: b` e [[wiki]] e [l](u).\n";
        let (model, parses) = parse_counting(src);
        assert_eq!(parses, 0, "`a[i]:` non può aprire un paragrafo");
        assert_eq!(model, parse_forced(src));
    }

    #[test]
    fn a_lone_definition_still_pays_the_shadow_and_is_kept() {
        for src in [
            "[rif]: nota.md\n",
            "> [rif]: nota.md\n",
            "- [rif]: nota.md\n",
            "1. > [rif]: nota.md\n",
            "  * [ ] [rif]: nota.md\n",
            "[^1]: [rif]: nota.md\n",
            "\u{feff}[rif]: nota.md\n",
            "Termine\n\n: [rif]: nota.md\n",
            "[rif\n]: nota.md\n",
        ] {
            let (model, parses) = parse_counting(src);
            assert_eq!(parses, 1, "{src:?}: una definizione da sola chiede l'ombra");
            assert!(
                model.contains("nota.md"),
                "{src:?}: la definizione resta nel modello"
            );
            assert_eq!(model, parse_forced(src), "{src:?}");
        }
    }

    #[test]
    fn the_gate_is_linear_on_a_line_of_openers() {
        for line in ["[^".repeat(200_000), "[".repeat(200_000), "- [^a".repeat(100_000)] {
            let started = std::time::Instant::now();
            assert!(!super::may_hide_definitions(&line, true));
            assert!(
                started.elapsed() < std::time::Duration::from_secs(1),
                "{:?} per {} byte",
                started.elapsed(),
                line.len()
            );
        }
    }

    /// Il filtro contro il recupero senza filtro, su sorgenti generate dai
    /// pezzi che contano: quadre, due punti, marcatori di contenitore, note,
    /// codice, escape, terminatori. Il filtro può dire sì a vuoto, mai no
    /// quando l'ombra cambia il risultato. `FUB_FUZZ_CASI` ne alza il numero,
    /// come per i fuzzer del corpus.
    #[test]
    fn shadow_gate_agrees_with_the_shadow() {
        const PIECES: &[&str] = &[
            "[",
            "]",
            ":",
            "^",
            "[^1]",
            "[^1]: ",
            "[a]",
            "[a]: ",
            "[a]: u",
            " \"t\"",
            "[b]:\n",
            ": ",
            "> ",
            ">",
            "- ",
            "* ",
            "+ ",
            "1. ",
            "2) ",
            "- [ ] ",
            "[x] ",
            "  ",
            "    ",
            "\t",
            "a",
            "x",
            "a[i]: ",
            "(u)",
            "[[w]]",
            "`",
            "```\n",
            "\\",
            "\\[",
            "|",
            "| - |",
            "\n",
            "\n",
            "\n\n",
            "\r\n",
            "\r",
            "<u>",
            "'t'",
            "# ",
            "---\n",
            "> [!NOTE]\n",
            "\u{feff}",
            "é",
            "$",
            "*e*",
            "<div>\n",
            "===\n",
            "~~~\n",
            "$$\n",
            "[!",
            "]]",
            "-# ",
            ">>> ",
            "   [a]: <u v>",
            "[a]:\n  u\n",
            "[^a b]: ",
        ];
        let cases = std::env::var("FUB_FUZZ_CASI")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(2000)
            .max(2000)
            * 2;
        let mut state: u64 = std::env::var("FUB_FUZZ_SEME")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0x9e37_79b9_7f4a_7c15)
            | 1;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let mut gated_off = 0;
        for case in 0..cases {
            let len = 1 + (next() % 24) as usize;
            let src: String = (0..len)
                .map(|_| PIECES[(next() % PIECES.len() as u64) as usize])
                .collect();
            let (model, parses) = parse_counting(&src);
            if parses == 0 {
                gated_off += 1;
            }
            assert_eq!(
                model,
                parse_forced(&src),
                "caso {case}: il filtro ha tolto un'ombra che serviva per {src:?}"
            );
        }
        // Il confronto ha senso solo se il filtro ha davvero detto no spesso.
        assert!(
            gated_off * 4 > cases,
            "il filtro ha detto no solo {gated_off} volte su {cases}"
        );
    }

    /// La misura: una nota lunga con le note a piè di pagina, col filtro e
    /// con l'ombra rifatta sempre (com'era prima). Non è un controllo: si
    /// lancia a mano, in release, con
    /// `cargo test --release -p fub-format-markdown --lib -- --ignored --nocapture misura`.
    #[test]
    #[ignore = "misura a mano, non un controllo"]
    fn misura_il_parse_di_una_nota_con_le_note() {
        const GIRI: u32 = 30;
        let mut src = String::from("# Diario\n\n");
        for i in 0..2_000 {
            src.push_str(&format!(
                "Paragrafo {i} con un [link](nota{i}.md), [[wiki {i}]] e un richiamo[^{i}].\n\n"
            ));
        }
        src.push_str("```ts\nconst a = b[i]: number;\n```\n\n");
        for i in 0..2_000 {
            src.push_str(&format!("[^{i}]: La nota {i}.\n"));
        }
        let ctx = ParseContext::obsidian("nota.md");
        let (_, parses) = parse_counting(&src);
        assert_eq!(parses, 0);
        let time = |forced: bool| {
            FORCE_SHADOW.with(|f| f.set(forced));
            let started = std::time::Instant::now();
            for _ in 0..GIRI {
                std::hint::black_box(super::super::parse_markdown(&src, &ctx).unwrap());
            }
            FORCE_SHADOW.with(|f| f.set(false));
            started.elapsed() / GIRI
        };
        let before = time(true);
        let after = time(false);
        println!(
            "MISURA parse: {} KB, con l'ombra {before:?}, col filtro {after:?}",
            src.len() / 1024
        );
    }
}
