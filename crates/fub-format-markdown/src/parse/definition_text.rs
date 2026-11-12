//! La grammatica di una definizione di riferimento (etichetta, destinazione,
//! titolo) e il suo posto fra i blocchi.

use super::*;

/// Una definizione grezza, con la sua estensione consumata (incluso il
/// terminatore di riga) e le posizioni di url e titolo nella fetta (per la
/// base di `decodifica_segmento`).
struct RawDef {
    def: Definition,
    end: usize,
    url_start: usize,
    title_start: usize,
}

/// Le definizioni in testa a una fetta di paragrafo, decodificate e in `defs`;
/// restituisce quanti byte (nella fetta) hanno consumato, cioè dove comincia
/// il contenuto residuo. È il lettore condiviso dal giro vero e dall'ombra.
pub(super) fn definitions_from_slice(
    slice: &str,
    base: usize,
    source: &str,
    defs: &mut Vec<Definition>,
) -> usize {
    let mut pos = 0;
    while slice.as_bytes().get(pos) == Some(&b'[') {
        match definition_at(slice, pos, base) {
            Some(d) => {
                let RawDef {
                    def,
                    end,
                    url_start,
                    title_start,
                } = d;
                // `fine` è già un offset assoluto nella fetta: sommarlo a
                // `pos` raddoppia quanto consumato dalla seconda definizione.
                pos = end;
                // La decodifica degli escape e delle entità, con la base nel
                // sorgente: la stessa regola dei link.
                let url = decode_segment(source, &def.url, base + url_start);
                let title = def
                    .title
                    .map(|t| decode_segment(source, &t, base + title_start));
                defs.push(Definition {
                    span: def.span,
                    label: def.label,
                    url,
                    title,
                });
            }
            None => break,
        }
    }
    pos
}

/// La grammatica è quella di `Parser::parse_reference_inline` di comrak:
/// `[etichetta]` + `:` + spnl + destinazione + spnl + titolo? + spnl + fine
/// riga — con il ripiego senza titolo quando il titolo non chiude la riga.
fn definition_at(slice: &str, pos: usize, base: usize) -> Option<RawDef> {
    let b = slice.as_bytes();
    let (after_label, label) = label_at(slice, pos)?;
    if b.get(after_label) != Some(&b':') {
        return None;
    }
    let mut p = spnl_at(slice, after_label + 1);
    let (after_url, url, url_start) = dest_at(slice, p)?;
    p = after_url;
    let before_title = p;
    p = spnl_at(slice, p);
    let (mut title, title_start) = if let Some((end, t)) = title_at(slice, p) {
        // `titolo_in` restituisce la fine esclusa dopo la chiusura e la fetta
        // senza i delimitatori: l'inizio del **contenuto** è il byte dopo
        // l'apre — `p + 1` — non `fine - t.len()`, che per un contenuto lungo
        // L vale `p + 2` (la fine esclusa è `i + 1`, la chiusura sta a `i`).
        // `titolo_inizio` è la base da cui `decodifica_segmento` decide la
        // priorità escape/entità del **primo** carattere del titolo:
        // sbagliata di un byte, `"\"inizio"` legge il vicino sbagliato e
        // l'escape in testa si scioglie o resta a seconda di quello.
        let content_start = p + 1;
        p = end;
        (Some(t), content_start)
    } else {
        (None, before_title)
    };
    let no_title = title.is_none();
    if no_title {
        p = before_title;
    }
    let mut end = spaces_at(slice, p);
    if !eol_at(slice, end) {
        if no_title {
            return None;
        }
        // Il titolo c'era ma non chiudeva la riga: si ripiega alla
        // definizione senza titolo, come comrak.
        title = None;
        p = before_title;
        end = spaces_at(slice, p);
        if !eol_at(slice, end) {
            return None;
        }
    }
    // `fine` è la posizione del terminatore di riga (o dell'EOF). Il consumo
    // del pre-pass include il terminatore; lo span del blocco lo rifila.
    let mut consumed = end;
    match b.get(consumed) {
        Some(b'\n') => consumed += 1,
        Some(b'\r') => {
            consumed += 1;
            if b.get(consumed) == Some(&b'\n') {
                consumed += 1;
            }
        }
        None => {}
        _ => return None,
    }
    let mut content_end = end;
    if content_end > 0 && b[content_end - 1] == b'\n' {
        content_end -= 1;
    }
    if content_end > 0 && b[content_end - 1] == b'\r' {
        content_end -= 1;
    }
    Some(RawDef {
        def: Definition {
            span: Span::new(base + pos, base + content_end),
            label: label.to_string(),
            url: url.to_string(),
            title: title.map(str::to_string),
        },
        end: consumed,
        url_start,
        title_start,
    })
}

/// `[etichetta]` — il contenuto è rifilato, come in comrak.
fn label_at(slice: &str, pos: usize) -> Option<(usize, &str)> {
    let b = slice.as_bytes();
    if b.get(pos) != Some(&b'[') {
        return None;
    }
    let mut the = pos + 1;
    let mut mon = 0usize;
    while the < b.len() {
        match b[the] {
            b']' => {
                let label = slice[pos + 1..the].trim();
                if label.is_empty() {
                    return None;
                }
                return Some((the + 1, label));
            }
            b'[' => return None,
            b'\\' => {
                the += 1;
                mon += 1;
                if b.get(the).is_some_and(|c| c.is_ascii_punctuation()) {
                    the += 1;
                    mon += 1;
                }
            }
            _ => {
                the += 1;
                mon += 1;
            }
        }
        if mon > 999 {
            return None;
        }
    }
    None
}

/// La destinazione, nuda o fra `<…>` — come `manual_scan_link_url`.
fn dest_at(slice: &str, pos: usize) -> Option<(usize, &str, usize)> {
    let b = slice.as_bytes();
    if pos >= b.len() {
        return None;
    }
    if b[pos] == b'<' {
        let mut the = pos + 1;
        while the < b.len() {
            match b[the] {
                b'>' => return Some((the + 1, &slice[pos + 1..the], pos + 1)),
                b'\\' => the += 2,
                b'\n' | b'\r' | b'<' => return None,
                _ => the += 1,
            }
        }
        return None;
    }
    let mut the = pos;
    let mut depth = 0usize;
    while the < b.len() {
        match b[the] {
            b'\\' if the + 1 < b.len() && b[the + 1].is_ascii_punctuation() => the += 2,
            b'(' => {
                depth += 1;
                the += 1;
                if depth > 32 {
                    return None;
                }
            }
            b')' => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
                the += 1;
            }
            c if c.is_ascii_whitespace() || (c.is_ascii_control() && c != 0) => {
                if the == pos {
                    return None;
                }
                break;
            }
            _ => the += 1,
        }
    }
    if the == pos || depth != 0 {
        None
    } else {
        Some((the, &slice[pos..the], pos))
    }
}

/// Il titolo fra `"…"`, `'…'` o `(…)` — le parentesi non si annidano.
fn title_at(slice: &str, pos: usize) -> Option<(usize, &str)> {
    let b = slice.as_bytes();
    let (open, close) = match b.get(pos) {
        Some(b'"') => (b'"', b'"'),
        Some(b'\'') => (b'\'', b'\''),
        Some(b'(') => (b'(', b')'),
        _ => return None,
    };
    let _ = open;
    let mut the = pos + 1;
    while the < b.len() {
        match b[the] {
            b'\\' => {
                if let Some(c) = slice[the + 1..].chars().next() {
                    the += 1 + c.len_utf8();
                } else {
                    the += 1;
                }
            }
            c if c == close => return Some((the + 1, &slice[pos + 1..the])),
            b'(' if close == b')' => return None,
            _ => the += 1,
        }
    }
    None
}

/// spnl: spazi/tab, poi al più una fine riga, poi spazi/tab.
fn spnl_at(slice: &str, mut pos: usize) -> usize {
    pos = spaces_at(slice, pos);
    if eol_at(slice, pos) {
        let was_cr = slice.as_bytes().get(pos) == Some(&b'\r');
        pos += 1;
        if was_cr && slice.as_bytes().get(pos) == Some(&b'\n') {
            pos += 1;
        }
        pos = spaces_at(slice, pos);
    }
    pos
}

fn spaces_at(slice: &str, mut pos: usize) -> usize {
    while pos < slice.len() && matches!(slice.as_bytes()[pos], b' ' | b'\t') {
        pos += 1;
    }
    pos
}

/// Fine riga o fine della fetta (l'EOF conta, come in comrak).
fn eol_at(slice: &str, pos: usize) -> bool {
    pos >= slice.len() || matches!(slice.as_bytes()[pos], b'\n' | b'\r')
}

/// Inserisce le definizioni nell'albero: il contenitore più profondo che
/// contiene il loro span, in ordine di sorgente.
pub(super) fn insert_definitions(defs: Vec<Definition>, body: &mut Vec<Block>) {
    let mut blocks: Vec<Block> = defs
        .into_iter()
        .map(|d| Block::ReferenceDefinition {
            label: d.label,
            url: d.url,
            title: d.title,
            anchor: None,
            span: d.span,
        })
        .collect();
    // Il giro vero e l'ombra consegnano due sequenze in ordine ciascuna.
    blocks.sort_by_key(|b| b.span().start);
    insert_sorted(blocks, body);
}

/// Colloca le definizioni, in ordine di inizio, nel contenitore più profondo
/// che contiene il loro span, un livello alla volta e tutte insieme: una per
/// una, fra ricerca lineare del contenitore e `insert`, costavano il quadrato
/// del loro numero (quarantamila righe `[lN]: /u` superavano il secondo).
fn insert_sorted(defs: Vec<Block>, blocks: &mut Vec<Block>) {
    let siblings = Siblings::new(blocks.iter().map(Block::span));
    let mut here = Vec::new();
    let mut inside: Vec<(usize, Vec<Block>)> = Vec::new();
    for d in defs {
        match siblings
            .holding(d.span())
            .filter(|&index| is_definition_container(&blocks[index]))
        {
            Some(index) => push_grouped(&mut inside, index, d),
            None => here.push(d),
        }
    }
    for (index, group) in inside {
        match &mut blocks[index] {
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                insert_sorted(group, blocks);
            }
            Block::List { items, .. } => {
                let siblings = Siblings::new(items.iter().map(|item| item.span));
                let mut per_item: Vec<(usize, Vec<Block>)> = Vec::new();
                for d in group {
                    match siblings.holding(d.span()) {
                        Some(item) => push_grouped(&mut per_item, item, d),
                        None => here.push(d),
                    }
                }
                for (item, group) in per_item {
                    insert_sorted(group, &mut items[item].blocks);
                }
            }
            _ => here.extend(group),
        }
    }
    if here.is_empty() {
        return;
    }
    here.sort_by_key(|b| b.span().start);
    // Ogni definizione va prima del primo fratello che non comincia prima di
    // lei: su un livello in ordine è la `partition_point` di sempre, e resta
    // definito anche con le note citate che comrak porta in fondo.
    let old = std::mem::take(blocks);
    blocks.reserve(old.len() + here.len());
    let mut old = old.into_iter().peekable();
    for d in here {
        let start = d.span().start;
        while let Some(b) = old.next_if(|b| b.span().start < start) {
            blocks.push(b);
        }
        blocks.push(d);
    }
    blocks.extend(old);
}

fn is_definition_container(block: &Block) -> bool {
    matches!(
        block,
        Block::Quote { .. } | Block::Custom { .. } | Block::List { .. }
    )
}

fn push_grouped(groups: &mut Vec<(usize, Vec<Block>)>, index: usize, d: Block) {
    match groups.last_mut() {
        Some((last, group)) if *last == index => group.push(d),
        _ => groups.push((index, vec![d])),
    }
}

/// Gli span di un livello di fratelli, ordinati per inizio. I fratelli sono
/// disgiunti, quindi il solo che può contenere uno span è l'ultimo che
/// comincia non dopo di lui; l'ordine del vettore non basta, perché comrak
/// porta in fondo le note a piè di pagina citate.
struct Siblings(Vec<(Span, usize)>);

impl Siblings {
    fn new(spans: impl Iterator<Item = Span>) -> Self {
        let mut order: Vec<(Span, usize)> = spans
            .enumerate()
            .map(|(index, span)| (span, index))
            .collect();
        order.sort_by_key(|(span, _)| span.start);
        Siblings(order)
    }

    fn holding(&self, span: Span) -> Option<usize> {
        let after = self
            .0
            .partition_point(|(sibling, _)| sibling.start <= span.start);
        let (sibling, index) = *self.0.get(after.checked_sub(1)?)?;
        contains_span(sibling, span).then_some(index)
    }
}

pub(super) fn contains_span(parent: Span, child: Span) -> bool {
    parent.start <= child.start && child.end <= parent.end
}
