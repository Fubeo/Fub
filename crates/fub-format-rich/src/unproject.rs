//! Dalla proiezione al documento.
//!
//! Il documento di partenza è quello sul disco, alla revisione su cui la shell
//! ha lavorato: di lì vengono tutto ciò che la proiezione non porta (stili,
//! elenchi, intestazioni, note, commenti, immagini, impostazioni) e le regole
//! di risoluzione. Il corpo si ricostruisce dai nodi della proiezione:
//!
//! - un tratto riprende le proprie proprietà opache, e un'enfasi diversa da
//!   quella che chi legge vedeva diventa formattazione diretta;
//! - un paragrafo riprende le proprie, e cambia stile o elenco soltanto se il
//!   suo ruolo o il suo stile sono cambiati; allineamento, rientri,
//!   spaziature e interlinea diversi da quelli mostrati diventano
//!   formattazione diretta con la regola delle enfasi;
//! - un oggetto riprende sé stesso, purché ciò che nomina ci sia ancora.
//!
//! Ciò che la shell ha tolto si toglie come lo toglie WordCraft: i segni di
//! campi e controlli rimasti senza compagno se ne vanno, e così le caselle di
//! testo che nessuno mostra più.

use std::collections::{BTreeSet, HashSet};
use std::sync::Arc;

use wordcraft_doc::numbering::ListKind;
use wordcraft_doc::para::{Run, OBJ};
use wordcraft_doc::props::{Highlight, NumRef, Underline, VertAlign};
use wordcraft_doc::{
    Align as WcAlign, Block as WcBlock, CharProps, Document, InlineObject, ParaProps, Paragraph,
    SectionProps, StyleKind, StyleSheet,
};

use crate::blob;
use crate::projection::{
    self, Align, AtomKeep, Block, Inline, Layout, Line, Look, Mark, Para, ParaKeep, Projection,
    Role,
};
use crate::RichError;

/// Il documento che la proiezione descrive, a partire da `base`.
pub(crate) fn unproject(projection: &Projection, base: &Document) -> Result<Document, RichError> {
    let mut document = base.clone();
    let mut state = State {
        stories: HashSet::new(),
        last_list: [None, None],
        own: Dangling::of(base),
    };
    let body = blocks(&projection.blocks, &mut document, &mut state)?;
    document.body = body;
    document.ensure_nonempty();
    document.balance_field_ranges();
    document.balance_controls();
    document.prune_text_boxes();
    document.normalize_runs();
    Ok(document)
}

struct State {
    /// Le note e le caselle di testo già mostrate da un oggetto.
    stories: HashSet<u32>,
    /// L'ultimo elenco puntato e l'ultimo numerato incontrati: un paragrafo
    /// che diventa voce d'elenco continua quello vicino, come in Word.
    last_list: [Option<u32>; 2],
    own: Dangling,
}

/// Gli stili e gli elenchi che il documento stesso nomina senza averli. Un
/// riferimento così è del file, non di un incolla: resta com'è, come lo
/// lascerebbe Word, che lo ignora.
#[derive(Default)]
struct Dangling {
    styles: BTreeSet<String>,
    nums: BTreeSet<u32>,
}

impl Dangling {
    fn of(document: &Document) -> Dangling {
        let mut out = Dangling::default();
        let style = |id: Option<&str>, out: &mut Dangling| {
            if let Some(id) = id.filter(|id| document.styles.get(id).is_none()) {
                out.styles.insert(id.to_string());
            }
        };
        let mut todo: Vec<&WcBlock> = document
            .body
            .iter()
            .chain(document.parts.values().flat_map(|part| part.blocks.iter()))
            .map(|block| &**block)
            .collect();
        while let Some(block) = todo.pop() {
            match block {
                WcBlock::Para(paragraph) => {
                    style(paragraph.props.style.as_deref(), &mut out);
                    style(paragraph.mark.style.as_deref(), &mut out);
                    for run in &paragraph.runs {
                        style(run.props.style.as_deref(), &mut out);
                    }
                    if let Some(n) = paragraph
                        .props
                        .numbering
                        .filter(|n| n.num != 0 && document.numbering.num(n.num).is_none())
                    {
                        out.nums.insert(n.num);
                    }
                }
                WcBlock::Table(table) => {
                    style(table.props.style.as_deref(), &mut out);
                    todo.extend(
                        table
                            .rows
                            .iter()
                            .flat_map(|row| &row.cells)
                            .flat_map(|cell| &cell.blocks)
                            .map(|block| &**block),
                    );
                }
            }
        }
        out
    }

    fn style(&self, styles: &StyleSheet, id: &str) -> bool {
        styles.get(id).is_some() || self.styles.contains(id)
    }
}

fn blocks(
    blocks: &[Block],
    document: &mut Document,
    state: &mut State,
) -> Result<Vec<Arc<WcBlock>>, RichError> {
    blocks
        .iter()
        .map(|block| match block {
            Block::Para(para) => {
                paragraph(para, document, state).map(|p| Arc::new(WcBlock::Para(p)))
            }
            Block::Table(table) => {
                let mut out: wordcraft_doc::Table = match &table.k {
                    Some(k) => blob::decode(k)?,
                    // Una tabella nuova è quella di Word: la griglia a tutta
                    // riga, a colonne uguali, con i bordi.
                    None => {
                        let cols = table.rows.iter().map(|row| row.cells.len()).max();
                        let cols = cols.unwrap_or(0);
                        let mut fresh =
                            wordcraft_doc::Table::new(1, cols, document.last_section.text_width());
                        fresh.rows.clear();
                        fresh.props.style = builtin_style(&mut document.styles, "TableGrid");
                        fresh
                    }
                };
                let grid = out.grid.clone();
                if out
                    .props
                    .style
                    .as_deref()
                    .is_some_and(|id| !state.own.style(&document.styles, id))
                {
                    out.props.style = None;
                }
                out.rows = table
                    .rows
                    .iter()
                    .map(|row| {
                        let mut out: wordcraft_doc::Row = match &row.k {
                            Some(k) => blob::decode(k)?,
                            None => wordcraft_doc::Row::default(),
                        };
                        out.cells = row
                            .cells
                            .iter()
                            .enumerate()
                            .map(|(c, cell)| {
                                let mut out: wordcraft_doc::Cell = match &cell.k {
                                    Some(k) => blob::decode(k)?,
                                    None => {
                                        let mut fresh = wordcraft_doc::Cell::empty();
                                        fresh.props.width = grid.get(c).copied();
                                        fresh
                                    }
                                };
                                out.blocks = self::blocks(&cell.blocks, document, state)?;
                                if !out.blocks.iter().any(|b| matches!(**b, WcBlock::Para(_))) {
                                    // Word vuole un paragrafo in fondo a ogni cella.
                                    out.blocks.push(Arc::new(WcBlock::Para(Paragraph::new())));
                                }
                                Ok(out)
                            })
                            .collect::<Result<_, RichError>>()?;
                        Ok(out)
                    })
                    .collect::<Result<_, RichError>>()?;
                if out.rows.is_empty() || out.rows.iter().any(|row| row.cells.is_empty()) {
                    return Err(RichError::Malformed("table without rows or cells".into()));
                }
                let cols = out
                    .rows
                    .iter()
                    .map(|row| row.cells.iter().map(|c| c.span()).sum());
                let cols: usize = cols.max().unwrap_or(0);
                if cols > wordcraft_doc::table::MAX_COLS {
                    return Err(RichError::Malformed("a table with too many columns".into()));
                }
                if cols != out.grid.len() {
                    let width = document.last_section.text_width();
                    regrid(&mut out, cols, width);
                }
                Ok(Arc::new(WcBlock::Table(out)))
            }
        })
        .collect()
}

fn paragraph(
    para: &Para,
    document: &mut Document,
    state: &mut State,
) -> Result<Paragraph, RichError> {
    let keep: ParaKeep = para
        .k
        .as_deref()
        .map(blob::decode)
        .transpose()?
        .unwrap_or_default();
    let mut keep = ParaKeep {
        props: known_para(keep.props, document, &state.own),
        mark: known_char(keep.mark, &document.styles, &state.own),
    };
    // L'enfasi che la shell mostrava era risolta con lo stile di prima.
    let shown_style = keep.props.style.clone();
    let before = projection::role(document, &keep.props);
    let shown_align = projection::align(&document.styles, &keep.props);
    let shown_layout = projection::layout(&document.styles, &keep.props);
    let shown_s = (before == Role::Body)
        .then(|| projection::style_of(document, &keep.props))
        .flatten();
    if before != para.role {
        keep.props = with_role(keep.props, before, para.role, document, state);
    }
    if para.role == Role::Body && para.s != shown_s {
        keep.props = with_style(keep.props, para.s.as_deref(), &document.styles);
    }
    keep.props = with_layout(
        keep.props,
        (para.align, &para.p),
        (shown_align, &shown_layout),
        &document.styles,
    );
    if let Role::List { ordered, .. } = para.role {
        if let Some(n) = document.styles.resolve_para(&keep.props).numbering {
            state.last_list[usize::from(ordered)] = Some(n.num);
        }
    }

    let mut out = Paragraph::new();
    out.props = keep.props;
    out.mark = keep.mark.clone();
    for inline in &para.c {
        match inline {
            Inline::Text { x, k, m, href, f } => {
                if x.contains(OBJ) {
                    return Err(RichError::Malformed("object marker inside text".into()));
                }
                if x.is_empty() {
                    continue;
                }
                let props = match k {
                    Some(k) => known_char(blob::decode(k)?, &document.styles, &state.own),
                    None => keep.mark.clone(),
                };
                let props = with_marks(
                    props,
                    m,
                    href.as_deref(),
                    shown_style.as_deref(),
                    &mut document.styles,
                );
                let props = with_look(props, m, f, shown_style.as_deref(), &document.styles);
                push(&mut out, x, props);
            }
            Inline::Atom { k, .. } => {
                let AtomKeep { props, object } = blob::decode(k)?;
                let Some(object) = known_object(object, document, state)? else {
                    continue;
                };
                let props = known_char(props, &document.styles, &state.own);
                push(&mut out, &OBJ.to_string(), props);
                out.objects.push(object);
            }
        }
    }
    out.section = para
        .sect
        .as_deref()
        .map(blob::decode::<SectionProps>)
        .transpose()?
        .filter(|section| known_section(section, document))
        .map(Box::new);
    out.normalize();
    Ok(out)
}

fn push(paragraph: &mut Paragraph, text: &str, props: CharProps) {
    paragraph.text.push_str(text);
    paragraph.runs.push(Run {
        len: text.len(),
        props,
    });
}

/// Le proprietà di un paragrafo, senza i riferimenti a ciò che il documento non
/// ha: un paragrafo incollato da un altro documento porta la propria
/// formattazione diretta, non stili ed elenchi che qui non esistono (salvo
/// quelli che il documento stesso nomina già senza averli, [`Dangling`]).
fn known_para(mut props: ParaProps, document: &Document, own: &Dangling) -> ParaProps {
    if props
        .style
        .as_deref()
        .is_some_and(|id| !own.style(&document.styles, id))
    {
        props.style = None;
    }
    if props.numbering.is_some_and(|n| {
        n.num != 0 && document.numbering.num(n.num).is_none() && !own.nums.contains(&n.num)
    }) {
        props.numbering = None;
    }
    props.num_change = None;
    props.fmt_change = None;
    props
}

/// Le proprietà di un tratto, con la stessa regola. Le revisioni tracciate non
/// passano: un documento che ne ha si apre in sola lettura.
fn known_char(mut props: CharProps, styles: &StyleSheet, own: &Dangling) -> CharProps {
    if props
        .style
        .as_deref()
        .is_some_and(|id| !own.style(styles, id))
    {
        props.style = None;
    }
    props.ins = None;
    props.del = None;
    props.fmt_change = None;
    props
}

fn known_section(section: &SectionProps, document: &Document) -> bool {
    [&section.headers, &section.footers]
        .into_iter()
        .flat_map(|set| [set.default, set.first, set.even])
        .flatten()
        .all(|id| document.parts.contains_key(&id))
}

/// L'oggetto, se ciò che nomina c'è. `None` per un segno di commento che non
/// ha più il suo commento (incollato da un altro documento): senza commento il
/// segno non segna niente.
fn known_object(
    object: InlineObject,
    document: &Document,
    state: &mut State,
) -> Result<Option<InlineObject>, RichError> {
    match &object {
        InlineObject::Image { media, .. } if !document.media.contains_key(media) => {
            return Err(RichError::Missing(format!("image {media}")));
        }
        InlineObject::NoteRef { id, .. } => story(*id, document, state)?,
        InlineObject::CommentStart { id } | InlineObject::CommentEnd { id }
            if !document.comments.contains_key(id) =>
        {
            return Ok(None);
        }
        _ => {}
    }
    for id in object.text_boxes() {
        story(id, document, state)?;
    }
    Ok(Some(object))
}

fn story(id: u32, document: &Document, state: &mut State) -> Result<(), RichError> {
    if !document.parts.contains_key(&id) {
        return Err(RichError::Missing(format!("story {id}")));
    }
    if !state.stories.insert(id) {
        return Err(RichError::DuplicateStory(id));
    }
    Ok(())
}

/// Le proprietà di un paragrafo che passa dal ruolo `from` al ruolo `to`.
fn with_role(
    mut props: ParaProps,
    from: Role,
    to: Role,
    document: &mut Document,
    state: &State,
) -> ParaProps {
    let previous = document
        .styles
        .resolve_para(&props)
        .numbering
        .filter(|n| n.num != 0);
    match from {
        Role::Body => {}
        Role::Heading { .. } => {
            props.style = None;
            props.outline_level = None;
        }
        Role::Quote => props.style = None,
        Role::List { .. } => {
            if props.style.as_deref() == Some("ListParagraph") {
                props.style = None;
            }
            props.numbering = None;
        }
    }
    // Un elenco che arriva dallo stile si spegne con il numero 0.
    if !matches!(to, Role::List { .. })
        && document
            .styles
            .resolve_para(&props)
            .numbering
            .is_some_and(|n| n.num != 0)
    {
        props.numbering = Some(NumRef { num: 0, level: 0 });
    }
    match to {
        Role::Body => {}
        Role::Heading { level } => {
            props.style = heading_style(&mut document.styles, level.clamp(1, 9));
        }
        Role::Quote => props.style = builtin_style(&mut document.styles, "Quote"),
        Role::List { ordered, level } => {
            // Un cambio di livello resta nello stesso elenco; un elenco nuovo
            // continua l'ultimo della stessa specie, o quello del documento.
            let same = matches!(from, Role::List { ordered: was, .. } if was == ordered);
            let num = previous
                .filter(|_| same)
                .map(|n| n.num)
                .or(state.last_list[usize::from(ordered)])
                .or_else(|| document.numbering.find_kind(kind(ordered)))
                .unwrap_or_else(|| document.numbering.add_list(kind(ordered)));
            props.numbering = Some(NumRef {
                num,
                level: level.min(8),
            });
            if props.style.is_none() {
                props.style = builtin_style(&mut document.styles, "ListParagraph");
            }
        }
    }
    props
}

/// Le proprietà di un paragrafo di corpo con lo stile `style`; `None` è
/// quello predefinito. Uno stile che il documento non ha lascia le cose come
/// sono.
fn with_style(mut props: ParaProps, style: Option<&str>, styles: &StyleSheet) -> ParaProps {
    match style {
        Some(id)
            if styles
                .get(id)
                .is_some_and(|s| s.kind == StyleKind::Paragraph) =>
        {
            props.style = Some(id.to_string());
        }
        Some(_) => {}
        None => props.style = None,
    }
    props
}

/// Le proprietà di un paragrafo con l'allineamento e la disposizione voluti,
/// con la regola delle enfasi: un valore diverso da quello mostrato si toglie
/// se basta toglierlo, se no si scrive diretto. Ciò che la disposizione non
/// nomina è quello dello stile.
fn with_layout(
    mut props: ParaProps,
    (align, want): (Option<Align>, &Layout),
    (shown_align, shown): (Option<Align>, &Layout),
    styles: &StyleSheet,
) -> ParaProps {
    let left = |a: Option<Align>| a.filter(|a| *a != Align::Left);
    let (align, shown_align) = (left(align), left(shown_align));
    if align != shown_align {
        props.align = None;
        if projection::align(styles, &props) != align {
            props.align = Some(match align {
                None | Some(Align::Left) => WcAlign::Left,
                Some(Align::Center) => WcAlign::Center,
                Some(Align::Right) => WcAlign::Right,
                Some(Align::Justify) => WcAlign::Justify,
            });
        }
    }
    let plain = styles.resolve_para(&projection::bare_layout(&props));
    let same = projection::same_size;
    if want.left != shown.left {
        let target = want.left.unwrap_or(plain.indent_left);
        props.indent_left = None;
        props.indent_left_chars = None;
        if !same(styles.resolve_para(&props).indent_left, target) {
            props.indent_left = Some(target);
            if !same(styles.resolve_para(&props).indent_left, target) {
                props.indent_left_chars = Some(0.0);
            }
        }
    }
    if want.right != shown.right {
        let target = want.right.unwrap_or(plain.indent_right);
        props.indent_right = None;
        props.indent_right_chars = None;
        if !same(styles.resolve_para(&props).indent_right, target) {
            props.indent_right = Some(target);
            if !same(styles.resolve_para(&props).indent_right, target) {
                props.indent_right_chars = Some(0.0);
            }
        }
    }
    if want.first != shown.first {
        let target = want.first.unwrap_or(plain.indent_first);
        props.indent_first = None;
        props.indent_first_chars = None;
        if !same(styles.resolve_para(&props).indent_first, target) {
            props.indent_first = Some(target);
            if !same(styles.resolve_para(&props).indent_first, target) {
                props.indent_first_chars = Some(0.0);
            }
        }
    }
    if want.before != shown.before {
        let target = want.before.unwrap_or(plain.space_before);
        props.space_before = None;
        props.space_before_auto = None;
        if !same(styles.resolve_para(&props).space_before, target) {
            props.space_before = Some(target);
            if !same(styles.resolve_para(&props).space_before, target) {
                props.space_before_auto = Some(false);
            }
        }
    }
    if want.after != shown.after {
        let target = want.after.unwrap_or(plain.space_after);
        props.space_after = None;
        props.space_after_auto = None;
        if !same(styles.resolve_para(&props).space_after, target) {
            props.space_after = Some(target);
            if !same(styles.resolve_para(&props).space_after, target) {
                props.space_after_auto = Some(false);
            }
        }
    }
    if want.line != shown.line {
        let target = want.line.unwrap_or_else(|| Line::of(plain.line_spacing));
        props.line_spacing = None;
        if !Line::of(styles.resolve_para(&props).line_spacing).same(target) {
            props.line_spacing = Some(target.spacing());
        }
    }
    props
}

fn kind(ordered: bool) -> ListKind {
    if ordered {
        ListKind::Numbered
    } else {
        ListKind::Bullet
    }
}

/// Lo stile di titolo del livello: quello del documento se c'è, altrimenti
/// quello predefinito di WordCraft, aggiunto al documento.
fn heading_style(styles: &mut StyleSheet, level: u8) -> Option<String> {
    let id = format!("Heading{level}");
    if styles.get(&id).is_some() {
        return Some(id);
    }
    if let Some(found) = styles
        .styles
        .iter()
        .find(|s| s.kind == StyleKind::Paragraph && s.para.outline_level == Some(level - 1))
    {
        return Some(found.id.clone());
    }
    builtin_style(styles, &id)
}

/// Una tabella a cui la shell ha aggiunto o tolto colonne: la griglia si
/// rifà dalle larghezze della prima riga senza celle unite, riportate alla
/// larghezza di prima (o del testo); senza una riga così, a colonne uguali.
/// Ogni cella prende la larghezza delle colonne che copre.
fn regrid(table: &mut wordcraft_doc::Table, cols: usize, text: f32) {
    let total = match table.grid.iter().sum::<f32>() {
        sum if sum > 0.0 => sum,
        _ => text,
    };
    let widths = table
        .rows
        .iter()
        .filter(|row| row.cells.len() == cols && row.cells.iter().all(|c| c.span() == 1))
        .find_map(|row| {
            let widths = row.cells.iter().map(|c| c.props.width.filter(|w| *w > 0.0));
            widths.collect::<Option<Vec<f32>>>()
        });
    let grid: Vec<f32> = match widths {
        Some(widths) => {
            let sum: f32 = widths.iter().sum();
            widths.iter().map(|w| w * total / sum).collect()
        }
        None => vec![total / cols as f32; cols],
    };
    for row in &mut table.rows {
        let mut at = 0;
        for cell in &mut row.cells {
            let end = (at + cell.span()).min(cols);
            cell.props.width = Some(grid[at.min(end)..end].iter().sum());
            cell.props.width_pct = None;
            at = end;
        }
    }
    table.grid = grid;
}

/// `id` nel documento, copiato dagli stili predefiniti di WordCraft (con la
/// catena da cui deriva) se il documento non lo ha; `None` se non c'è nemmeno
/// fra quelli.
fn builtin_style(styles: &mut StyleSheet, id: &str) -> Option<String> {
    if styles.get(id).is_some() {
        return Some(id.to_string());
    }
    let builtin = StyleSheet::builtin();
    builtin.get(id)?;
    let mut missing: Vec<&str> = vec![id];
    while let Some(next) = missing.pop() {
        if styles.get(next).is_some() {
            continue;
        }
        let Some(style) = builtin.get(next) else {
            continue;
        };
        missing.extend(style.based_on.as_deref());
        missing.extend(style.linked.as_deref());
        missing.extend(style.next.as_deref());
        styles.upsert(style.clone());
    }
    Some(id.to_string())
}

/// Le proprietà di un tratto con l'enfasi voluta. `shown_style` è lo stile di
/// paragrafo con cui la shell ha visto il tratto: un'enfasi uguale a quella
/// vista lascia le proprietà come sono, una diversa diventa formattazione
/// diretta — tolta, se toglierla basta, altrimenti scritta.
fn with_marks(
    mut props: CharProps,
    marks: &[Mark],
    href: Option<&str>,
    shown_style: Option<&str>,
    styles: &mut StyleSheet,
) -> CharProps {
    let want: BTreeSet<Mark> = marks.iter().copied().collect();
    let shown: BTreeSet<Mark> = projection::marks(styles, shown_style, &props)
        .into_iter()
        .collect();
    for mark in [
        Mark::B,
        Mark::I,
        Mark::U,
        Mark::S,
        Mark::H,
        Mark::Sup,
        Mark::Sub,
        Mark::Caps,
        Mark::SmallCaps,
    ] {
        let on = want.contains(&mark);
        if on == shown.contains(&mark) {
            continue;
        }
        let mut cleared = props.clone();
        set(&mut cleared, mark, None);
        let after: BTreeSet<Mark> = projection::marks(styles, shown_style, &cleared)
            .into_iter()
            .collect();
        props = if after.contains(&mark) == on {
            cleared
        } else {
            set(&mut props, mark, Some(on));
            props
        };
    }
    if props.link.as_deref() != href {
        props.link = href.map(str::to_string);
        match href {
            Some(_) if props.style.is_none() => props.style = builtin_style(styles, "Hyperlink"),
            None if props.style.as_deref() == Some("Hyperlink") => props.style = None,
            _ => {}
        }
    }
    props
}

/// Riporta sul tratto l'aspetto voluto con la stessa regola delle enfasi: un
/// valore che differisce da quello mostrato si toglie se basta toglierlo, se
/// no si scrive diretto. Quello che il tratto non nomina è quello del
/// paragrafo.
fn with_look(
    mut props: CharProps,
    marks: &[Mark],
    look: &Look,
    shown_style: Option<&str>,
    styles: &StyleSheet,
) -> CharProps {
    let plain = styles.resolve_char(shown_style, &CharProps::default());
    let shown = |props: &CharProps| styles.resolve_char(shown_style, props);

    let font = look.font.clone().unwrap_or_else(|| plain.font.clone());
    if shown(&props).font != font {
        props.font = None;
        if shown(&props).font != font {
            props.font = Some(font);
        }
    }
    let size = look.size.unwrap_or(plain.size);
    if !projection::same_size(shown(&props).size, size) {
        props.size = None;
        if !projection::same_size(shown(&props).size, size) {
            props.size = Some(size);
        }
    }
    let color = look
        .color
        .as_deref()
        .and_then(projection::color_of)
        .unwrap_or(plain.color);
    if shown(&props).color != color {
        props.color = None;
        if shown(&props).color != color {
            props.color = Some(color);
        }
    }
    if marks.contains(&Mark::H) {
        let highlight = look
            .hl
            .as_deref()
            .and_then(projection::highlight_of)
            .unwrap_or(Highlight::Yellow);
        if shown(&props).highlight != highlight.rgb() {
            props.highlight = None;
            if shown(&props).highlight != highlight.rgb() {
                props.highlight = Some(highlight);
            }
        }
    }
    props
}

/// Scrive o toglie (`None`) la formattazione diretta di un'enfasi.
fn set(props: &mut CharProps, mark: Mark, on: Option<bool>) {
    match mark {
        Mark::B => props.bold = on,
        Mark::I => props.italic = on,
        Mark::U => {
            props.underline = on.map(|on| {
                if on {
                    Underline::Single
                } else {
                    Underline::None
                }
            })
        }
        Mark::S => {
            props.strike = on;
            if on.is_some() {
                props.double_strike = None;
            }
        }
        Mark::H => {
            props.highlight = on.map(|on| {
                if on {
                    Highlight::Yellow
                } else {
                    Highlight::None
                }
            })
        }
        Mark::Sup | Mark::Sub => {
            let mine = if mark == Mark::Sup {
                VertAlign::Superscript
            } else {
                VertAlign::Subscript
            };
            props.vert_align = match on {
                None => None,
                Some(true) => Some(mine),
                Some(false) => Some(VertAlign::Baseline),
            };
        }
        Mark::Caps => props.caps = on,
        Mark::SmallCaps => props.small_caps = on,
    }
}
