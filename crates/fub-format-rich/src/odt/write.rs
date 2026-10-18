//! Dalla proiezione a `content.xml`, toccando soltanto ciò che è cambiato.
//!
//! I blocchi voluti si allineano a quelli del file (la più lunga sottosequenza
//! comune, poi a coppie nei buchi): un paragrafo, un elenco o una tabella che
//! tornano identici e interi si riscrivono con i loro byte originali, e i byte
//! fissi del corpo (vedi [`Unit::Fixed`]) restano accanto al blocco che li
//! precedeva. Il resto si rigenera dai dati opachi dei nodi:
//!
//! - un paragrafo riprende il proprio tag; se il ruolo cambia cambiano
//!   l'elemento (`text:p`, `text:h`), lo stile (uno stile automatico si copia
//!   con il genitore nuovo, così la sua formattazione diretta resta) e gli
//!   elenchi che lo contengono; uno stile scelto cambia allo stesso modo, e
//!   un allineamento o una disposizione diversi da quelli mostrati diventano
//!   uno stile automatico `FubP<n>`, o la copia di quello che c'era;
//! - un tratto riprende i propri involucri; un'enfasi diversa da quella che
//!   chi scrive vedeva diventa uno stile automatico `FubT<n>` attorno al testo;
//! - un oggetto riprende il proprio XML, purché il documento lo avesse;
//! - una tabella riprende i tag di tabella, righe e celle.
//!
//! Gli stili che il codec aggiunge vanno in fondo agli stili automatici di
//! `content.xml`, o agli stili comuni di `styles.xml` per titoli e citazioni.
//! Un cambiamento che il codec non sa scrivere è [`RichError::Codec`]: il
//! salvataggio non scrive, e chi scrive tiene il proprio buffer.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::ops::Range;

use super::keys::{
    self, name_of, opening, AtomKey, CellKey, Level, ParaKey, RowKey, RunKey, TableKey,
};
use super::read::{self, inner, Body, Unit};
use super::styles::{
    self as odt_styles, Def, LevelKind, ParaChange, Position, Size, Styles, TextProps,
};
use super::xml::{self, Tree};
use crate::blob;
use crate::projection::{
    self, Align, AtomKind, Block, Cell, Inline, Line, Look, Mark, Para, Role, Row, Table,
};
use crate::RichError;

/// Oltre questo prodotto di lunghezze l'allineamento non cerca la
/// sottosequenza comune nel mezzo: accoppia per posizione.
const MAX_LCS_CELLS: usize = 4_000_000;

/// Il documento di partenza.
pub(crate) struct Base<'a> {
    pub content: &'a Tree,
    pub styles_tree: Option<&'a Tree>,
    pub styles: &'a Styles,
    pub body: &'a Body,
}

/// Ciò che lo scrittore produce.
pub(crate) struct Output {
    pub content: Vec<u8>,
    /// `styles.xml`, se il codec vi ha aggiunto stili.
    pub styles: Option<Vec<u8>>,
    /// Ciò che il file nuovo deve mostrare: i blocchi voluti, con l'enfasi che
    /// gli stili scritti danno davvero.
    pub expected: Vec<Block>,
}

/// Scrive `blocks` sul documento `base`. Con `force` non riusa niente e
/// rigenera ogni blocco: è la prova, all'apertura, che la rigenerazione
/// rilegge identico ciò che il file mostra.
pub(crate) fn write(base: &Base, blocks: &[Block], force: bool) -> Result<Output, RichError> {
    let mut writer = Writer::new(base);
    writer.check_atoms(blocks)?;
    let body = writer.body(blocks, force)?;
    let content = writer.content(body)?;
    let styles = writer.styles_part()?;
    Ok(Output {
        content,
        styles,
        expected: writer.expected,
    })
}

struct Writer<'a> {
    base: &'a Base<'a>,
    styles: Styles,
    /// Stili automatici nuovi, per `content.xml`.
    auto_xml: String,
    /// Stili comuni nuovi, per `styles.xml`.
    common_xml: String,
    clones: HashMap<(String, Option<String>), String>,
    /// Gli `xml:id` già scritti: una copia non ne ripete uno.
    seen: HashSet<String>,
    atoms: HashMap<String, usize>,
    used: HashMap<String, usize>,
    tables: Vec<(String, Vec<String>)>,
    expected: Vec<Block>,
}

/// Il piano di un paragrafo: il suo tag, gli elenchi che lo contengono, lo
/// stile con cui chi scrive ne vedeva l'enfasi e quello che avrà.
#[derive(Clone, Debug)]
struct Plan {
    tag: String,
    chain: Vec<Level>,
    shown: Option<String>,
    style: Option<String>,
    kept: bool,
}

struct Open {
    list: String,
    item: String,
}

fn style_attr(attrs: &[(String, String)]) -> Option<String> {
    attrs
        .iter()
        .find(|(k, _)| k == "text:style-name")
        .map(|(_, v)| v.clone())
}

fn set_attr(attrs: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    match (attrs.iter().position(|(k, _)| k == key), value) {
        (Some(at), Some(value)) => attrs[at].1 = value,
        (Some(at), None) => {
            attrs.remove(at);
        }
        (None, Some(value)) => attrs.push((key.to_string(), value)),
        (None, None) => {}
    }
}

fn attr<'v>(attrs: &'v [(String, String)], key: &str) -> Option<&'v str> {
    attrs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn quoted(value: &str) -> String {
    let mut out = String::new();
    xml::escape_attr(value, &mut out);
    out
}

/// Gli `xml:id` scritti in questi byte.
fn ids_in(bytes: &[u8], into: &mut HashSet<String>) {
    let needle = b" xml:id=\"";
    let mut at = 0;
    while let Some(found) = bytes[at..].windows(needle.len()).position(|w| w == needle) {
        let start = at + found + needle.len();
        let Some(len) = bytes[start..].iter().position(|&b| b == b'"') else {
            return;
        };
        into.insert(String::from_utf8_lossy(&bytes[start..start + len]).into_owned());
        at = start + len;
    }
}

/// Gli stili di tratto degli involucri, dal più esterno.
fn layers(wrap: &[String]) -> Vec<Vec<String>> {
    wrap.iter()
        .map(|tag| match keys::tag(tag) {
            Some((name, attrs)) if name == "text:span" || name == "text:a" => {
                let mut out: Vec<String> = attr(&attrs, "text:class-names")
                    .map(|n| n.split_whitespace().map(str::to_string).collect())
                    .unwrap_or_default();
                out.extend(attr(&attrs, "text:style-name").map(str::to_string));
                out
            }
            _ => Vec::new(),
        })
        .collect()
}

fn href_of(wrap: &[String]) -> Option<String> {
    wrap.iter().rev().find_map(|tag| {
        (name_of(tag) == "text:a").then(|| {
            keys::tag(tag)
                .and_then(|(_, attrs)| attr(&attrs, "xlink:href").map(str::to_string))
                .unwrap_or_default()
        })
    })
}

/// L'aspetto voluto, senza i valori che sono già quelli di `plain`, il testo
/// del paragrafo senza involucri: due forme dello stesso aspetto diventano una.
fn relative(look: &Look, plain: &TextProps) -> Look {
    let plain_color = plain
        .color
        .clone()
        .unwrap_or_else(|| projection::COLOR_AUTO.into());
    Look {
        font: look
            .font
            .clone()
            .filter(|font| Some(font) != plain.font.as_ref()),
        size: look.size.filter(|size| {
            !plain
                .points()
                .is_some_and(|p| projection::same_size(*size, p))
        }),
        color: look.color.clone().filter(|color| *color != plain_color),
        hl: look
            .hl
            .clone()
            .filter(|hl| hl != projection::HIGHLIGHT_DEFAULT),
    }
}

/// Le proprietà che portano il testo da `shown` all'enfasi `want` e
/// all'aspetto `look`, relativo a `plain`.
fn diff(want: &BTreeSet<Mark>, look: &Look, plain: &TextProps, shown: &TextProps) -> TextProps {
    let mut out = diff_marks(want, &shown.marks().into_iter().collect());
    let target = look.clone();
    let font = target.font.or_else(|| plain.font.clone());
    if font.is_some() && font != shown.font {
        out.font = font;
    }
    let size = target.size.or_else(|| plain.points());
    if let Some(size) = size {
        if !shown
            .points()
            .is_some_and(|p| projection::same_size(p, size))
        {
            out.size = Some(Size::Points(size));
        }
    }
    let color_of = |p: &TextProps| {
        p.color
            .clone()
            .unwrap_or_else(|| projection::COLOR_AUTO.into())
    };
    let color = target.color.unwrap_or_else(|| color_of(plain));
    if color != color_of(shown) {
        out.color = Some(color);
    }
    if want.contains(&Mark::H) {
        let hl = target
            .hl
            .unwrap_or_else(|| projection::HIGHLIGHT_DEFAULT.into());
        if shown.highlight != Some(true) || shown.background.as_deref() != Some(hl.as_str()) {
            out.highlight = Some(true);
            out.background = Some(hl);
        }
    }
    out
}

fn diff_marks(want: &BTreeSet<Mark>, shown: &BTreeSet<Mark>) -> TextProps {
    let flip =
        |mark: Mark| (want.contains(&mark) != shown.contains(&mark)).then(|| want.contains(&mark));
    let position = [Mark::Sup, Mark::Sub]
        .iter()
        .any(|m| want.contains(m) != shown.contains(m))
        .then(|| {
            if want.contains(&Mark::Sup) {
                Position::Super
            } else if want.contains(&Mark::Sub) {
                Position::Sub
            } else {
                Position::Baseline
            }
        });
    TextProps {
        bold: flip(Mark::B),
        italic: flip(Mark::I),
        underline: flip(Mark::U),
        strike: flip(Mark::S),
        highlight: flip(Mark::H),
        position,
        caps: flip(Mark::Caps),
        small_caps: flip(Mark::SmallCaps),
        ..TextProps::default()
    }
}

fn text_properties(props: &TextProps) -> String {
    let mut attrs: Vec<(String, String)> = Vec::new();
    let mut add = |k: &str, v: &str| attrs.push((k.to_string(), v.to_string()));
    if let Some(on) = props.bold {
        let v = if on { "bold" } else { "normal" };
        add("fo:font-weight", v);
        add("style:font-weight-asian", v);
        add("style:font-weight-complex", v);
    }
    if let Some(on) = props.italic {
        let v = if on { "italic" } else { "normal" };
        add("fo:font-style", v);
        add("style:font-style-asian", v);
        add("style:font-style-complex", v);
    }
    match props.underline {
        Some(true) => {
            add("style:text-underline-style", "solid");
            add("style:text-underline-width", "auto");
            add("style:text-underline-color", "font-color");
        }
        Some(false) => add("style:text-underline-style", "none"),
        None => {}
    }
    match props.strike {
        Some(true) => {
            add("style:text-line-through-style", "solid");
            add("style:text-line-through-type", "single");
        }
        Some(false) => add("style:text-line-through-style", "none"),
        None => {}
    }
    match props.highlight {
        Some(true) => add(
            "fo:background-color",
            props
                .background
                .as_deref()
                .unwrap_or(projection::HIGHLIGHT_DEFAULT),
        ),
        Some(false) => add("fo:background-color", "transparent"),
        None => {}
    }
    match props.position {
        Some(Position::Super) => add("style:text-position", "super 58%"),
        Some(Position::Sub) => add("style:text-position", "sub 58%"),
        Some(Position::Baseline) => add("style:text-position", "0% 100%"),
        None => {}
    }
    if let Some(on) = props.caps {
        add("fo:text-transform", if on { "uppercase" } else { "none" });
    }
    if let Some(on) = props.small_caps {
        add("fo:font-variant", if on { "small-caps" } else { "normal" });
    }
    if let Some(font) = &props.font {
        let family = if font.contains(' ') {
            format!("'{font}'")
        } else {
            font.clone()
        };
        add("fo:font-family", &family);
    }
    match props.size {
        Some(Size::Points(pt)) => add(
            "fo:font-size",
            &format!("{}pt", (pt * 100.0).round() / 100.0),
        ),
        Some(Size::Percent(p)) => add("fo:font-size", &format!("{p}%")),
        None => {}
    }
    match props.color.as_deref() {
        Some(projection::COLOR_AUTO) => add("style:use-window-font-color", "true"),
        Some(color) => add("fo:color", color),
        None => {}
    }
    xml::open_tag("style:text-properties", &attrs, true)
}

/// Centimetri in punti.
fn cm(cm: f32) -> f32 {
    cm * 72.0 / 2.54
}

/// Porta gli attributi di `style:paragraph-properties` al cambiamento. Un
/// `fo:margin` si scioglie nei quattro lati prima di cambiarne uno.
fn apply(attrs: &mut Vec<(String, String)>, change: &ParaChange) {
    let sides = [
        ("fo:margin-left", change.left),
        ("fo:margin-right", change.right),
        ("fo:margin-top", change.before),
        ("fo:margin-bottom", change.after),
    ];
    if sides.iter().any(|(_, c)| c.is_some()) {
        if let Some(all) = attr(attrs, "fo:margin").map(str::to_string) {
            set_attr(attrs, "fo:margin", None);
            for (name, _) in sides {
                if attr(attrs, name).is_none() {
                    set_attr(attrs, name, Some(all.clone()));
                }
            }
        }
    }
    for (name, c) in sides.into_iter().chain([("fo:text-indent", change.first)]) {
        if let Some(value) = c {
            set_attr(attrs, name, value.map(odt_styles::points));
        }
    }
    if let Some(line) = change.line {
        set_attr(attrs, "fo:line-height", None);
        set_attr(attrs, "style:line-height-at-least", None);
        match line {
            Some(Line::Multiple(m)) => set_attr(
                attrs,
                "fo:line-height",
                Some(format!("{}%", (m * 1000.0).round() / 10.0)),
            ),
            Some(Line::Exactly(pt)) => {
                set_attr(attrs, "fo:line-height", Some(odt_styles::points(pt)))
            }
            Some(Line::AtLeast(pt)) => set_attr(
                attrs,
                "style:line-height-at-least",
                Some(odt_styles::points(pt)),
            ),
            None => {}
        }
    }
    if let Some(align) = change.align {
        set_attr(
            attrs,
            "fo:text-align",
            align.map(|a| odt_styles::align_value(a).to_string()),
        );
    }
}

/// Un paragrafo che la shell mostra vuoto in una cella vuota: ProseMirror ne
/// vuole uno, il file no.
pub(crate) fn bare_cell(blocks: &[Block]) -> bool {
    match blocks {
        [] => true,
        [Block::Para(p)] => {
            p.k.is_none()
                && p.role == Role::Body
                && p.c
                    .iter()
                    .all(|i| matches!(i, Inline::Text { x, .. } if x.is_empty()))
        }
        _ => false,
    }
}

/// Le coppie (blocco del file, blocco voluto): uguali, e poi accoppiati per
/// posizione nei buchi fra due uguali.
fn matching(
    base: &[&Block],
    new: &[Block],
    force: bool,
) -> (Vec<Option<usize>>, Vec<Option<usize>>) {
    let (m, n) = (base.len(), new.len());
    let mut equal: Vec<Option<usize>> = vec![None; n];
    if !force {
        let mut p = 0;
        while p < m.min(n) && *base[p] == new[p] {
            equal[p] = Some(p);
            p += 1;
        }
        let mut s = 0;
        while s < m.min(n) - p && *base[m - 1 - s] == new[n - 1 - s] {
            equal[n - 1 - s] = Some(m - 1 - s);
            s += 1;
        }
        let (bm, nm) = (m - p - s, n - p - s);
        if bm > 0 && nm > 0 && bm * nm <= MAX_LCS_CELLS {
            let width = nm + 1;
            let mut table = vec![0u32; (bm + 1) * width];
            for i in (0..bm).rev() {
                for j in (0..nm).rev() {
                    table[i * width + j] = if *base[p + i] == new[p + j] {
                        table[(i + 1) * width + j + 1] + 1
                    } else {
                        table[(i + 1) * width + j].max(table[i * width + j + 1])
                    };
                }
            }
            let (mut i, mut j) = (0, 0);
            while i < bm && j < nm {
                if *base[p + i] == new[p + j] {
                    equal[p + j] = Some(p + i);
                    i += 1;
                    j += 1;
                } else if table[(i + 1) * width + j] >= table[i * width + j + 1] {
                    i += 1;
                } else {
                    j += 1;
                }
            }
        }
    }
    let mut paired = equal.clone();
    let (mut b, mut j) = (0, 0);
    let mut anchors: Vec<(usize, usize)> = equal
        .iter()
        .enumerate()
        .filter_map(|(j, e)| e.map(|b| (b, j)))
        .collect();
    anchors.push((m, n));
    for (next_b, next_j) in anchors {
        let len = (next_b - b).min(next_j - j);
        for t in 0..len {
            paired[j + t] = Some(b + t);
        }
        b = next_b + 1;
        j = next_j + 1;
    }
    (equal, paired)
}

impl<'a> Writer<'a> {
    fn new(base: &'a Base<'a>) -> Writer<'a> {
        let mut writer = Writer {
            base,
            styles: base.styles.clone(),
            auto_xml: String::new(),
            common_xml: String::new(),
            clones: HashMap::new(),
            seen: HashSet::new(),
            atoms: HashMap::new(),
            used: HashMap::new(),
            tables: Vec::new(),
            expected: Vec::new(),
        };
        let blocks = base.body.blocks();
        writer.inventory(&blocks);
        writer
    }

    /// Gli oggetti e le tabelle del documento di partenza.
    fn inventory(&mut self, blocks: &[Block]) {
        for block in blocks {
            match block {
                Block::Para(p) => {
                    for inline in &p.c {
                        if let Inline::Atom { k, .. } = inline {
                            if let Ok(key) = blob::decode::<AtomKey>(k) {
                                *self.atoms.entry(key.xml).or_default() += 1;
                            }
                        }
                    }
                }
                Block::Table(t) => {
                    self.tables
                        .push((t.k.clone(), t.rows.iter().map(|r| r.k.clone()).collect()));
                    for row in &t.rows {
                        for cell in &row.cells {
                            self.inventory(&cell.blocks);
                        }
                    }
                }
            }
        }
    }

    /// Il nuovo interno di `office:text`.
    fn body(&mut self, blocks: &[Block], force: bool) -> Result<String, RichError> {
        let tree = self.base.content;
        let mut base_blocks: Vec<&Block> = Vec::new();
        let mut base_nodes = Vec::new();
        let mut fixed: Vec<(Range<usize>, usize)> = Vec::new();
        let mut units: Vec<(Range<usize>, usize, usize)> = Vec::new();
        for unit in &self.base.body.units {
            match unit {
                Unit::Fixed(range) => fixed.push((range.clone(), base_blocks.len())),
                Unit::Blocks {
                    span,
                    blocks,
                    nodes,
                } => {
                    units.push((span.clone(), base_blocks.len(), blocks.len()));
                    base_blocks.extend(blocks.iter());
                    base_nodes.extend(nodes.iter().copied());
                }
            }
        }
        let (equal, paired) = matching(&base_blocks, blocks, force);
        let n = blocks.len();

        // Dove va ogni pezzo fisso: dopo il blocco voluto accoppiato all'ultimo
        // blocco del file che lo precedeva, e dopo i blocchi nuovi che lo
        // seguono subito.
        let mut last_paired: Vec<Option<usize>> = vec![None; base_blocks.len() + 1];
        let mut best = None;
        let mut by_base: Vec<Option<usize>> = vec![None; base_blocks.len()];
        for (j, b) in paired.iter().enumerate() {
            if let Some(b) = b {
                by_base[*b] = Some(j);
            }
        }
        for b in 0..base_blocks.len() {
            last_paired[b] = best;
            if by_base[b].is_some() {
                best = by_base[b];
            }
        }
        last_paired[base_blocks.len()] = best;
        let mut before: Vec<Range<usize>> = Vec::new();
        let mut after: Vec<Vec<Range<usize>>> = vec![Vec::new(); n];
        for (range, pos) in &fixed {
            match last_paired[*pos] {
                None => before.push(range.clone()),
                Some(mut j) => {
                    while j + 1 < n && paired[j + 1].is_none() {
                        j += 1;
                    }
                    after[j].push(range.clone());
                }
            }
        }

        // I piani dei paragrafi, in ordine: un paragrafo che diventa voce
        // d'elenco guarda quello prima.
        let mut plans: Vec<Option<Plan>> = Vec::with_capacity(n);
        for (j, block) in blocks.iter().enumerate() {
            let prev = (j > 0 && after[j - 1].is_empty())
                .then(|| plans[j - 1].as_ref().map(|p: &Plan| p.chain.as_slice()))
                .flatten()
                .filter(|chain| !chain.is_empty());
            let plan = match block {
                Block::Para(para) => Some(self.plan(para, prev)?),
                Block::Table(_) => None,
            };
            plans.push(plan);
        }

        // Le unità che tornano intere e identiche.
        let mut by_equal: Vec<Option<usize>> = vec![None; base_blocks.len()];
        for (j, b) in equal.iter().enumerate() {
            if let Some(b) = b {
                by_equal[*b] = Some(j);
            }
        }
        let mut keep: HashMap<usize, (Range<usize>, usize)> = HashMap::new();
        let first_list = |plan: &Option<Plan>| -> Option<String> {
            plan.as_ref()
                .and_then(|p| p.chain.first().map(|l| l.list.clone()))
        };
        for (span, start, len) in &units {
            let Some(j) = by_equal[*start] else {
                continue;
            };
            if !(0..*len).all(|t| j + t < n && equal[j + t] == Some(start + t)) {
                continue;
            }
            if let Some(list) = first_list(&plans[j]) {
                let prev = j > 0
                    && after[j - 1].is_empty()
                    && first_list(&plans[j - 1]) == Some(list.clone());
                let next = j + len < n
                    && after[j + len - 1].is_empty()
                    && first_list(&plans[j + len]) == Some(list.clone());
                if prev || next {
                    continue;
                }
            }
            keep.insert(j, (span.clone(), *len));
        }
        let mut reuse: Vec<Option<Range<usize>>> = vec![None; n];
        let mut j = 0;
        while j < n {
            if let Some((_, len)) = keep.get(&j) {
                j += len;
                continue;
            }
            if let (Some(b), Some(plan)) = (equal[j], &plans[j]) {
                if plan.kept {
                    reuse[j] = Some(tree.nodes[base_nodes[b]].span.clone());
                }
            }
            j += 1;
        }
        for (span, _) in keep.values() {
            ids_in(&tree.source[span.clone()], &mut self.seen);
        }
        for span in reuse.iter().flatten() {
            ids_in(&tree.source[span.clone()], &mut self.seen);
        }
        for (range, _) in &fixed {
            ids_in(&tree.source[range.clone()], &mut self.seen);
        }

        let source = &tree.source;
        let raw =
            |range: &Range<usize>| String::from_utf8_lossy(&source[range.clone()]).into_owned();
        let mut out = String::new();
        let mut stack: Vec<Open> = Vec::new();
        for range in &before {
            out.push_str(&raw(range));
        }
        let mut skip = 0;
        for j in 0..n {
            if j < skip {
                // dentro un'unità riscritta intera
            } else if let Some((span, len)) = keep.get(&j) {
                self.close_to(&mut stack, 0, &mut out);
                out.push_str(&raw(span));
                self.expected.extend(blocks[j..j + len].iter().cloned());
                skip = j + len;
            } else {
                let expected = self.block(
                    &blocks[j],
                    plans[j].as_ref(),
                    reuse[j].as_ref().map(raw),
                    &mut stack,
                    &mut out,
                )?;
                self.expected.push(expected);
            }
            if !after[j].is_empty() {
                self.close_to(&mut stack, 0, &mut out);
                for range in &after[j] {
                    out.push_str(&raw(range));
                }
            }
        }
        self.close_to(&mut stack, 0, &mut out);
        Ok(out)
    }

    /// Un blocco rigenerato, nel contesto di elenchi `stack`.
    fn block(
        &mut self,
        block: &Block,
        plan: Option<&Plan>,
        raw: Option<String>,
        stack: &mut Vec<Open>,
        out: &mut String,
    ) -> Result<Block, RichError> {
        match (block, plan) {
            (Block::Para(para), Some(plan)) => {
                if plan.chain.is_empty() {
                    self.close_to(stack, 0, out);
                } else {
                    self.enter(stack, &plan.chain, out);
                }
                match raw {
                    Some(raw) => {
                        out.push_str(&raw);
                        Ok(block.clone())
                    }
                    None => self.para(para, plan, out).map(Block::Para),
                }
            }
            (Block::Table(table), _) => {
                self.close_to(stack, 0, out);
                self.table(table, out).map(Block::Table)
            }
            (Block::Para(_), None) => Err(RichError::Codec("odt: paragraph without a plan".into())),
        }
    }

    /// I blocchi di una cella.
    fn cell(&mut self, blocks: &[Block], out: &mut String) -> Result<Vec<Block>, RichError> {
        let mut stack = Vec::new();
        let mut prev: Option<Vec<Level>> = None;
        let mut expected = Vec::new();
        for block in blocks {
            let plan = match block {
                Block::Para(para) => {
                    let plan = self.plan(para, prev.as_deref().filter(|c| !c.is_empty()))?;
                    prev = Some(plan.chain.clone());
                    Some(plan)
                }
                Block::Table(_) => {
                    prev = None;
                    None
                }
            };
            expected.push(self.block(block, plan.as_ref(), None, &mut stack, out)?);
        }
        self.close_to(&mut stack, 0, out);
        Ok(expected)
    }

    fn close_to(&mut self, stack: &mut Vec<Open>, depth: usize, out: &mut String) {
        while stack.len() > depth {
            let open = stack.pop().expect("not empty");
            out.push_str(&format!("</{}>", name_of(&open.item)));
            out.push_str("</text:list>");
        }
    }

    /// Porta gli elenchi aperti a quelli di `chain`.
    fn enter(&mut self, stack: &mut Vec<Open>, chain: &[Level], out: &mut String) {
        let mut l = 0;
        while l < stack.len()
            && l < chain.len()
            && stack[l].list == chain[l].list
            && stack[l].item == chain[l].item
            && !chain[l].open
        {
            l += 1;
        }
        if l == chain.len() {
            self.close_to(stack, l, out);
            return;
        }
        if l < stack.len() {
            self.close_to(stack, l + 1, out);
            let keep_list = stack[l].list == chain[l].list;
            out.push_str(&format!("</{}>", name_of(&stack[l].item)));
            if keep_list {
                stack[l].item = chain[l].item.clone();
                let item = self.fresh(&chain[l].item, false);
                out.push_str(&item);
            } else {
                out.push_str("</text:list>");
                stack.pop();
            }
        }
        for level in &chain[stack.len()..] {
            let list = self.fresh(&level.list, true);
            out.push_str(&list);
            let item = self.fresh(&level.item, false);
            out.push_str(&item);
            stack.push(Open {
                list: level.list.clone(),
                item: level.item.clone(),
            });
        }
    }

    /// Un tag da scrivere, senza un `xml:id` già scritto. Un elenco che perde
    /// così il suo è la seconda parte di un elenco diviso: continua la
    /// numerazione della prima.
    fn fresh(&mut self, tag: &str, list: bool) -> String {
        let tag = opening(tag);
        if !tag.contains("xml:id=") {
            return tag;
        }
        let Some((name, mut attrs)) = keys::tag(&tag) else {
            return tag;
        };
        let Some(id) = attr(&attrs, "xml:id").map(str::to_string) else {
            return tag;
        };
        if self.seen.insert(id) {
            return tag;
        }
        set_attr(&mut attrs, "xml:id", None);
        if list
            && attr(&attrs, "text:continue-numbering").is_none()
            && attr(&attrs, "text:continue-list").is_none()
        {
            attrs.push(("text:continue-numbering".into(), "true".into()));
        }
        keys::rebuild(&name, &attrs)
    }

    // ── Paragrafi ───────────────────────────────────────────────────────────

    /// Il piano di un paragrafo: quello del ruolo, poi lo stile scelto, poi
    /// allineamento e disposizione.
    fn plan(&mut self, para: &Para, prev: Option<&[Level]>) -> Result<Plan, RichError> {
        let key: Option<ParaKey> = para.k.as_deref().map(blob::decode).transpose()?;
        let before = key.as_ref().map(|key| read::role(&self.styles, key));
        let mut plan = self.plan_role(para, prev)?;
        let (name, mut attrs) = keys::tag(&plan.tag)
            .ok_or_else(|| RichError::Malformed("odt: paragraph tag".into()))?;
        let shown = plan.shown.clone();

        let shown_s = (before == Some(Role::Body))
            .then(|| self.styles.common_of(shown.as_deref()))
            .flatten();
        if para.role == Role::Body && para.s != shown_s {
            let target = match para.s.as_deref() {
                Some(id) if self.styles.common("paragraph", id) => Some(Some(id.to_string())),
                Some(_) => None,
                None => Some(None),
            };
            if let Some(target) = target {
                self.restyle(&mut attrs, target)?;
                plan.kept = false;
            }
        }

        let current = style_attr(&attrs);
        let common = self.styles.common_of(current.as_deref());
        let plain = self.styles.para(common.as_deref());
        let plain_align = self.styles.align(common.as_deref());
        let shown_layout = self.styles.layout(shown.as_deref());
        let left = |a: Option<Align>| a.filter(|a| *a != Align::Left);
        let mut change = ParaChange::default();
        if left(para.align) != self.styles.align(shown.as_deref()) {
            let want = left(para.align);
            change.align = Some((want != plain_align).then(|| want.unwrap_or(Align::Left)));
        }
        let length = |want: Option<f32>, shown: Option<f32>, plain: Option<f32>| {
            (want != shown).then(|| {
                let plain = plain.unwrap_or(0.0);
                let target = want.unwrap_or(plain);
                (!projection::same_size(target, plain)).then_some(target)
            })
        };
        let want = &para.p;
        change.left = length(want.left, shown_layout.left, plain.left);
        change.right = length(want.right, shown_layout.right, plain.right);
        change.first = length(want.first, shown_layout.first, plain.first);
        change.before = length(want.before, shown_layout.before, plain.before);
        change.after = length(want.after, shown_layout.after, plain.after);
        if want.line != shown_layout.line {
            let plain = plain.line.unwrap_or(Line::Multiple(1.0));
            let target = want.line.unwrap_or(plain);
            change.line = Some((!target.same(plain)).then_some(target));
        }
        if !change.is_empty() {
            let automatic = current
                .as_deref()
                .filter(|c| self.styles.get("paragraph", c).is_some_and(|d| d.automatic))
                .map(str::to_string);
            let value = match automatic {
                Some(auto) => {
                    let parent = self
                        .styles
                        .get("paragraph", &auto)
                        .and_then(|d| d.parent.clone());
                    Some(self.clone_para_with(&auto, parent, Some(&change))?)
                }
                None if change.only_clears() => current,
                None => Some(self.para_style(current, &change)),
            };
            set_attr(&mut attrs, "text:style-name", value);
        }
        plan.style = style_attr(&attrs);
        plan.tag = keys::rebuild(&name, &attrs);
        Ok(plan)
    }

    fn plan_role(&mut self, para: &Para, prev: Option<&[Level]>) -> Result<Plan, RichError> {
        let key: Option<ParaKey> = para.k.as_deref().map(blob::decode).transpose()?;
        let before = key.as_ref().map(|key| read::role(&self.styles, key));
        if let (Some(key), Some(before)) = (&key, before) {
            if before == para.role {
                let style = keys::tag(&key.tag).and_then(|(_, attrs)| style_attr(&attrs));
                return Ok(Plan {
                    tag: opening(&key.tag),
                    chain: key.list.clone(),
                    shown: style.clone(),
                    style,
                    kept: true,
                });
            }
        }
        let (_, mut attrs) = match &key {
            Some(key) => keys::tag(&key.tag)
                .ok_or_else(|| RichError::Malformed("odt: paragraph tag".into()))?,
            None => ("text:p".to_string(), Vec::new()),
        };
        let shown = key.as_ref().and_then(|_| style_attr(&attrs));
        let name = match para.role {
            Role::Heading { level } => {
                set_attr(
                    &mut attrs,
                    "text:outline-level",
                    Some(level.clamp(1, 9).to_string()),
                );
                "text:h"
            }
            _ => {
                for gone in [
                    "text:outline-level",
                    "text:is-list-header",
                    "text:restart-numbering",
                    "text:start-value",
                ] {
                    set_attr(&mut attrs, gone, None);
                }
                "text:p"
            }
        };
        let target = match para.role {
            Role::Heading { level } => Some(Some(self.heading(level.clamp(1, 9))?)),
            Role::Quote => Some(Some(self.quotations()?)),
            Role::Body | Role::List { .. } => match before {
                Some(Role::Heading { .. } | Role::Quote) | None => Some(self.body_style()),
                Some(_) => None,
            },
        };
        if let Some(target) = target {
            self.restyle(&mut attrs, target)?;
        }
        let style = style_attr(&attrs);
        let chain = match para.role {
            Role::List { ordered, level } => {
                let own = key.as_ref().map(|k| k.list.as_slice()).unwrap_or(&[]);
                self.derive(
                    ordered,
                    usize::from(level.min(8)),
                    own,
                    prev,
                    style.as_deref(),
                )?
            }
            _ => Vec::new(),
        };
        Ok(Plan {
            tag: keys::rebuild(name, &attrs),
            chain,
            shown: if key.is_some() { shown } else { style.clone() },
            style,
            kept: false,
        })
    }

    /// Gli elenchi per una voce di livello `level`: quelli del paragrafo
    /// stesso o della voce prima, se il loro stile ha la specie voluta a quel
    /// livello; altrimenti un elenco nuovo.
    fn derive(
        &mut self,
        ordered: bool,
        level: usize,
        own: &[Level],
        prev: Option<&[Level]>,
        para_style: Option<&str>,
    ) -> Result<Vec<Level>, RichError> {
        let want = if ordered {
            LevelKind::Number
        } else {
            LevelKind::Bullet
        };
        let depth = u8::try_from(level).unwrap_or(8);
        for candidate in [own, prev.unwrap_or(&[])] {
            if candidate.is_empty() {
                continue;
            }
            let mut chain: Vec<Level> = candidate.iter().take(level + 1).cloned().collect();
            for l in &mut chain {
                l.open = false;
            }
            while chain.len() < level + 1 {
                chain.push(Level {
                    list: "<text:list>".into(),
                    item: "<text:list-item>".into(),
                    open: false,
                });
            }
            if name_of(&chain[level].item) != "text:list-item" {
                chain[level].item = "<text:list-item>".into();
            }
            chain[level].open = true;
            let style = read::list_style(&self.styles, &chain, para_style);
            if self.styles.level_kind(style.as_deref(), depth) == want {
                return Ok(chain);
            }
        }
        let style = match self
            .styles
            .list_names()
            .into_iter()
            .find(|name| self.styles.level_kind(Some(name), depth) == want)
        {
            Some(name) => name.to_string(),
            None => self.list_style(want),
        };
        let mut chain = vec![Level {
            list: format!("<text:list text:style-name=\"{}\">", quoted(&style)),
            item: "<text:list-item>".into(),
            open: true,
        }];
        while chain.len() < level + 1 {
            chain.push(Level {
                list: "<text:list>".into(),
                item: "<text:list-item>".into(),
                open: true,
            });
        }
        Ok(chain)
    }

    /// Cambia lo stile del paragrafo: uno automatico si copia con il genitore
    /// nuovo, uno comune si sostituisce.
    fn restyle(
        &mut self,
        attrs: &mut Vec<(String, String)>,
        target: Option<String>,
    ) -> Result<(), RichError> {
        let current = style_attr(attrs);
        if current == target {
            return Ok(());
        }
        let automatic = current
            .as_deref()
            .filter(|c| self.styles.get("paragraph", c).is_some_and(|d| d.automatic))
            .map(str::to_string);
        let value = match automatic {
            Some(auto) => Some(self.clone_para_with(&auto, target, None)?),
            None => target,
        };
        set_attr(attrs, "text:style-name", value);
        Ok(())
    }

    /// Copia lo stile automatico `auto` col genitore `parent` e, se c'è, la
    /// disposizione cambiata.
    fn clone_para_with(
        &mut self,
        auto: &str,
        parent: Option<String>,
        change: Option<&ParaChange>,
    ) -> Result<String, RichError> {
        let key = (auto.to_string(), parent.clone());
        if change.is_none() {
            if let Some(name) = self.clones.get(&key) {
                return Ok(name.clone());
            }
        }
        let tree = self.base.content;
        let container = tree
            .child(tree.root, "office:automatic-styles")
            .ok_or_else(|| RichError::Codec(format!("odt: style {auto} not found")))?;
        let (id, element) = tree
            .elements(container)
            .find(|(_, e)| {
                e.name == "style:style"
                    && e.attr("style:name") == Some(auto)
                    && e.attr("style:family") == Some("paragraph")
            })
            .ok_or_else(|| RichError::Codec(format!("odt: style {auto} not found")))?;
        let name = self.styles.fresh("FubP");
        let mut attrs = element.attrs.clone();
        set_attr(&mut attrs, "style:name", Some(name.clone()));
        set_attr(&mut attrs, "style:parent-style-name", parent.clone());
        let span = tree.nodes[id].span.clone();
        let raw = |range: Range<usize>| String::from_utf8_lossy(&tree.source[range]).into_owned();
        match change {
            None if element.open == span => {
                self.auto_xml
                    .push_str(&xml::open_tag("style:style", &attrs, true))
            }
            None => {
                self.auto_xml
                    .push_str(&xml::open_tag("style:style", &attrs, false));
                self.auto_xml.push_str(&raw(element.open.end..span.end));
            }
            Some(change) => {
                let mut out = xml::open_tag("style:style", &attrs, false);
                let props = tree
                    .elements(id)
                    .find(|(_, e)| e.name == "style:paragraph-properties");
                match props {
                    Some((pid, props)) => {
                        let pspan = tree.nodes[pid].span.clone();
                        let mut pattrs = props.attrs.clone();
                        apply(&mut pattrs, change);
                        out.push_str(&raw(element.open.end..pspan.start));
                        if props.open == pspan {
                            out.push_str(&xml::open_tag(
                                "style:paragraph-properties",
                                &pattrs,
                                true,
                            ));
                        } else {
                            out.push_str(&xml::open_tag(
                                "style:paragraph-properties",
                                &pattrs,
                                false,
                            ));
                            out.push_str(&raw(props.open.end..pspan.end));
                        }
                        out.push_str(&raw(pspan.end..span.end));
                    }
                    None => {
                        let mut pattrs = Vec::new();
                        apply(&mut pattrs, change);
                        out.push_str(&xml::open_tag("style:paragraph-properties", &pattrs, true));
                        if element.open == span {
                            out.push_str("</style:style>");
                        } else {
                            out.push_str(&raw(element.open.end..span.end));
                        }
                    }
                }
                self.auto_xml.push_str(&out);
            }
        }
        let mut def = self
            .styles
            .get("paragraph", auto)
            .cloned()
            .unwrap_or_default();
        def.parent = parent;
        def.automatic = true;
        if let Some(change) = change {
            def.para = def.para.changed(change);
            def.align = change.align.unwrap_or(def.align);
        } else {
            self.clones.insert(key, name.clone());
        }
        self.styles.define("paragraph", &name, def);
        Ok(name)
    }

    /// Uno stile automatico nuovo di genitore `parent` con soltanto la
    /// disposizione `change`, o quello uguale già scritto.
    fn para_style(&mut self, parent: Option<String>, change: &ParaChange) -> String {
        let para = odt_styles::ParaProps::default().changed(change);
        let align = change.align.flatten();
        if let Some(name) = self
            .styles
            .find_para("FubP", parent.as_deref(), &para, align)
        {
            return name;
        }
        let name = self.styles.fresh("FubP");
        let mut attrs = vec![
            ("style:name".to_string(), name.clone()),
            ("style:family".to_string(), "paragraph".to_string()),
        ];
        if let Some(parent) = &parent {
            attrs.push(("style:parent-style-name".into(), parent.clone()));
        }
        let mut pattrs = Vec::new();
        apply(&mut pattrs, change);
        self.auto_xml.push_str(&format!(
            "{}{}</style:style>",
            xml::open_tag("style:style", &attrs, false),
            xml::open_tag("style:paragraph-properties", &pattrs, true)
        ));
        self.styles.define(
            "paragraph",
            &name,
            Def {
                parent,
                para,
                align,
                automatic: true,
                ..Def::default()
            },
        );
        name
    }

    fn body_style(&self) -> Option<String> {
        ["Text_20_body", "Standard"]
            .into_iter()
            .find(|name| self.styles.common("paragraph", name))
            .map(str::to_string)
    }

    fn need_styles_part(&self, what: &str) -> Result<(), RichError> {
        if self.base.styles_tree.is_none() {
            return Err(RichError::Codec(format!(
                "odt: a document without styles.xml cannot gain the {what} style"
            )));
        }
        Ok(())
    }

    /// Lo stile comune del titolo di livello `level`, aggiunto a `styles.xml`
    /// come quello di LibreOffice se il documento non ne ha uno.
    fn heading(&mut self, level: u8) -> Result<String, RichError> {
        if let Some(name) = self.styles.heading(level) {
            return Ok(name);
        }
        self.need_styles_part("heading")?;
        let name = format!("Heading_20_{level}");
        let size = match level {
            1 => "130%",
            2 => "115%",
            3 => "101%",
            4 => "95%",
            _ => "85%",
        };
        self.common_xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:display-name=\"Heading {level}\" \
             style:family=\"paragraph\" style:default-outline-level=\"{level}\" \
             style:class=\"text\"><style:paragraph-properties fo:margin-top=\"0.423cm\" \
             fo:margin-bottom=\"0.212cm\" fo:keep-with-next=\"always\"/>\
             <style:text-properties fo:font-size=\"{size}\" fo:font-weight=\"bold\" \
             style:font-weight-asian=\"bold\" style:font-weight-complex=\"bold\"/>\
             </style:style>"
        ));
        let def = Def {
            text: TextProps {
                bold: Some(true),
                ..TextProps::default()
            },
            outline_level: Some(level),
            para: odt_styles::ParaProps {
                before: Some(cm(0.423)),
                after: Some(cm(0.212)),
                ..odt_styles::ParaProps::default()
            },
            ..Def::default()
        };
        self.styles.define("paragraph", &name, def);
        Ok(name)
    }

    fn quotations(&mut self) -> Result<String, RichError> {
        let name = "Quotations";
        if self.styles.common("paragraph", name) {
            return Ok(name.to_string());
        }
        self.need_styles_part("quotation")?;
        self.common_xml.push_str(
            "<style:style style:name=\"Quotations\" style:family=\"paragraph\" \
             style:class=\"html\"><style:paragraph-properties fo:margin-left=\"1cm\" \
             fo:margin-right=\"1cm\" fo:margin-top=\"0cm\" fo:margin-bottom=\"0.283cm\" \
             fo:text-indent=\"0cm\" style:auto-text-indent=\"false\"/></style:style>",
        );
        let para = odt_styles::ParaProps {
            left: Some(cm(1.0)),
            right: Some(cm(1.0)),
            first: Some(0.0),
            before: Some(0.0),
            after: Some(cm(0.283)),
            line: None,
        };
        self.styles.define(
            "paragraph",
            name,
            Def {
                para,
                ..Def::default()
            },
        );
        Ok(name.to_string())
    }

    /// Uno stile d'elenco nuovo, puntato o numerato su dieci livelli.
    fn list_style(&mut self, kind: LevelKind) -> String {
        let name = self.styles.fresh("FubL");
        let mut out = format!("<text:list-style style:name=\"{name}\">");
        for level in 1..=10u32 {
            let margin = 0.635 * f64::from(level + 1);
            let props = format!(
                "<style:list-level-properties text:list-level-position-and-space-mode=\
                 \"label-alignment\"><style:list-level-label-alignment \
                 text:label-followed-by=\"listtab\" text:list-tab-stop-position=\"{margin:.3}cm\" \
                 text:margin-left=\"{margin:.3}cm\" text:text-indent=\"-0.635cm\"/>\
                 </style:list-level-properties>"
            );
            match kind {
                LevelKind::Number => out.push_str(&format!(
                    "<text:list-level-style-number text:level=\"{level}\" \
                     style:num-suffix=\".\" style:num-format=\"1\">{props}\
                     </text:list-level-style-number>"
                )),
                _ => out.push_str(&format!(
                    "<text:list-level-style-bullet text:level=\"{level}\" \
                     text:bullet-char=\"•\">{props}</text:list-level-style-bullet>"
                )),
            }
        }
        out.push_str("</text:list-style>");
        self.auto_xml.push_str(&out);
        self.styles.define_list(&name, kind);
        name
    }

    fn text_style(&mut self, props: TextProps) -> String {
        if let Some(name) = self.styles.find_text("FubT", &props) {
            return name;
        }
        let name = self.styles.fresh("FubT");
        self.auto_xml.push_str(&format!(
            "<style:style style:name=\"{name}\" style:family=\"text\">{}</style:style>",
            text_properties(&props)
        ));
        self.styles.define(
            "text",
            &name,
            Def {
                text: props,
                automatic: true,
                ..Def::default()
            },
        );
        name
    }

    fn para(&mut self, para: &Para, plan: &Plan, out: &mut String) -> Result<Para, RichError> {
        let tag = self.fresh(&plan.tag, false);
        out.push_str(&tag);
        let mut stack: Vec<String> = Vec::new();
        let mut space_ok = false;
        let mut expected = Vec::new();
        for inline in &para.c {
            match inline {
                Inline::Text { x, k, m, href, f } => {
                    if x.is_empty() {
                        continue;
                    }
                    let mut wrap = match k {
                        Some(k) => blob::decode::<RunKey>(k)?.wrap,
                        None => Vec::new(),
                    };
                    self.link(&mut wrap, href.as_deref());
                    let want: BTreeSet<Mark> = m.iter().copied().collect();
                    let plain = self.styles.text(plan.shown.as_deref(), &[]);
                    let look = relative(f, &plain);
                    let shown = self.styles.text(plan.shown.as_deref(), &layers(&wrap));
                    let change = diff(&want, &look, &plain, &shown);
                    if change != TextProps::default() {
                        let name = self.text_style(change);
                        wrap.push(format!("<text:span text:style-name=\"{}\">", quoted(&name)));
                    }
                    let got_props = self.styles.text(plan.style.as_deref(), &layers(&wrap));
                    let got_look = got_props.look(&self.styles.text(plan.style.as_deref(), &[]));
                    let got = got_props.marks();
                    if plan.kept
                        && (got.iter().copied().collect::<BTreeSet<_>>() != want
                            || got_look != look)
                    {
                        return Err(RichError::Fidelity);
                    }
                    sync(&mut stack, &wrap, out);
                    text(x, &mut space_ok, out)?;
                    expected.push(Inline::Text {
                        x: x.clone(),
                        k: None,
                        m: got,
                        href: href_of(&wrap),
                        f: got_look,
                    });
                }
                Inline::Atom { k, .. } => {
                    let key: AtomKey = blob::decode(k)?;
                    sync(&mut stack, &key.wrap, out);
                    out.push_str(&key.xml);
                    space_ok = false;
                    expected.push(inline.clone());
                }
            }
        }
        sync(&mut stack, &[], out);
        out.push_str(&format!("</{}>", name_of(&plan.tag)));
        let style = plan.style.as_deref();
        Ok(Para {
            role: para.role,
            align: self.styles.align(style),
            k: None,
            sect: None,
            p: self.styles.layout(style),
            s: (para.role == Role::Body)
                .then(|| self.styles.common_of(style))
                .flatten(),
            f: Look::default(),
            c: expected,
        })
    }

    /// Mette il link voluto negli involucri del tratto.
    fn link(&self, wrap: &mut Vec<String>, href: Option<&str>) {
        if href_of(wrap).as_deref() == href {
            return;
        }
        match href {
            None => wrap.retain(|tag| name_of(tag) != "text:a"),
            Some(href) => match wrap.iter().rposition(|tag| name_of(tag) == "text:a") {
                Some(at) => {
                    if let Some((name, mut attrs)) = keys::tag(&wrap[at]) {
                        set_attr(&mut attrs, "xlink:href", Some(href.to_string()));
                        wrap[at] = keys::rebuild(&name, &attrs);
                    }
                }
                None => {
                    let mut attrs = vec![
                        ("xlink:type".to_string(), "simple".to_string()),
                        ("xlink:href".to_string(), href.to_string()),
                    ];
                    if self.styles.common("text", "Internet_20_link") {
                        attrs.push(("text:style-name".into(), "Internet_20_link".into()));
                    }
                    if self.styles.common("text", "Visited_20_Internet_20_Link") {
                        attrs.push((
                            "text:visited-style-name".into(),
                            "Visited_20_Internet_20_Link".into(),
                        ));
                    }
                    wrap.insert(0, keys::rebuild("text:a", &attrs));
                }
            },
        }
    }

    /// Gli oggetti di tutti i blocchi, anche di quelli che passano grezzi:
    /// una nota copiata accanto a quella rimasta al suo posto è una seconda.
    fn check_atoms(&mut self, blocks: &[Block]) -> Result<(), RichError> {
        for block in blocks {
            match block {
                Block::Para(p) => {
                    for inline in &p.c {
                        if let Inline::Atom { k, kind, .. } = inline {
                            self.check_atom(&blob::decode(k)?, *kind)?;
                        }
                    }
                }
                Block::Table(t) => {
                    for cell in t.rows.iter().flat_map(|row| &row.cells) {
                        self.check_atoms(&cell.blocks)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Un oggetto c'era nel documento; uno che non si ripete (una nota, un
    /// segnalibro, un commento, una forma) non compare più volte di prima.
    fn check_atom(&mut self, key: &AtomKey, kind: AtomKind) -> Result<(), RichError> {
        let Some(&had) = self.atoms.get(&key.xml) else {
            return Err(RichError::Missing(format!("an object of kind {kind:?}")));
        };
        if matches!(kind, AtomKind::Image | AtomKind::Graphic) {
            return Ok(());
        }
        let used = self.used.entry(key.xml.clone()).or_default();
        *used += 1;
        if *used > had {
            return Err(RichError::Missing(format!(
                "a second copy of an object of kind {kind:?}"
            )));
        }
        Ok(())
    }

    // ── Tabelle ─────────────────────────────────────────────────────────────

    fn table(&mut self, table: &Table, out: &mut String) -> Result<Table, RichError> {
        let key: TableKey = blob::decode(&table.k)?;
        if !key.rows {
            let base = self
                .tables
                .iter()
                .find(|(k, _)| *k == table.k)
                .ok_or_else(|| RichError::Missing("a table".into()))?;
            let rows: Vec<&String> = table.rows.iter().map(|r| &r.k).collect();
            if rows.len() != base.1.len() || rows.iter().zip(&base.1).any(|(a, b)| *a != b) {
                return Err(RichError::Codec(
                    "odt: rows of a table with cells merged across rows cannot be added, \
                     moved or removed"
                        .into(),
                ));
            }
        }
        if table.rows.is_empty() || table.rows.iter().any(|row| row.cells.is_empty()) {
            return Err(RichError::Malformed("table without rows or cells".into()));
        }
        out.push_str(&self.fresh(&key.open, false));
        out.push_str(&key.head);
        let mut header = false;
        let mut headers_done = false;
        let mut rows = Vec::new();
        for row in &table.rows {
            let rk: RowKey = blob::decode(&row.k)?;
            if rk.header != header {
                if rk.header {
                    if headers_done {
                        return Err(RichError::Codec(
                            "odt: header rows must stay together".into(),
                        ));
                    }
                    out.push_str("<table:table-header-rows>");
                } else {
                    out.push_str("</table:table-header-rows>");
                    headers_done = true;
                }
                header = rk.header;
            }
            out.push_str(&self.fresh(&rk.open, false));
            out.push_str(&rk.lead);
            let mut cells = Vec::new();
            for cell in &row.cells {
                let ck: CellKey = blob::decode(&cell.k)?;
                let blocks = if bare_cell(&cell.blocks) {
                    if ck.open.ends_with("/>") {
                        out.push_str(&ck.open);
                    } else {
                        out.push_str(&ck.open);
                        out.push_str("</table:table-cell>");
                    }
                    Vec::new()
                } else {
                    out.push_str(&opening(&ck.open));
                    let blocks = self.cell(&cell.blocks, out)?;
                    out.push_str("</table:table-cell>");
                    blocks
                };
                out.push_str(&ck.tail);
                cells.push(Cell {
                    k: cell.k.clone(),
                    blocks,
                });
            }
            out.push_str("</table:table-row>");
            rows.push(Row {
                k: row.k.clone(),
                cells,
            });
        }
        if header {
            out.push_str("</table:table-header-rows>");
        }
        out.push_str("</table:table>");
        Ok(Table {
            k: table.k.clone(),
            rows,
        })
    }

    // ── Le parti ───────────────────────────────────────────────────────────

    fn content(&self, body: String) -> Result<Vec<u8>, RichError> {
        let tree = self.base.content;
        let mut splices: Vec<(Range<usize>, String)> = Vec::new();
        if !self.auto_xml.is_empty() {
            match tree.child(tree.root, "office:automatic-styles") {
                Some(auto) => {
                    let element = tree.element(auto).expect("an element");
                    let span = tree.nodes[auto].span.clone();
                    if element.open == span {
                        let open = String::from_utf8_lossy(&tree.source[span.clone()]).into_owned();
                        splices.push((
                            span,
                            format!(
                                "{}{}</office:automatic-styles>",
                                opening(&open),
                                self.auto_xml
                            ),
                        ));
                    } else {
                        let end = inner(tree, auto).end;
                        splices.push((end..end, self.auto_xml.clone()));
                    }
                }
                None => {
                    let at = tree
                        .child(tree.root, "office:body")
                        .map(|b| tree.nodes[b].span.start)
                        .ok_or_else(|| RichError::Codec("odt: no office:body".into()))?;
                    splices.push((
                        at..at,
                        format!(
                            "<office:automatic-styles>{}</office:automatic-styles>",
                            self.auto_xml
                        ),
                    ));
                }
            }
        }
        splices.push((self.base.body.inner.clone(), body));
        Ok(splice(&tree.source, splices))
    }

    fn styles_part(&self) -> Result<Option<Vec<u8>>, RichError> {
        if self.common_xml.is_empty() {
            return Ok(None);
        }
        let tree = self
            .base
            .styles_tree
            .ok_or_else(|| RichError::Codec("odt: no styles.xml".into()))?;
        let splices = match tree.child(tree.root, "office:styles") {
            Some(styles) => {
                let element = tree.element(styles).expect("an element");
                let span = tree.nodes[styles].span.clone();
                if element.open == span {
                    let open = String::from_utf8_lossy(&tree.source[span.clone()]).into_owned();
                    vec![(
                        span,
                        format!("{}{}</office:styles>", opening(&open), self.common_xml),
                    )]
                } else {
                    let end = inner(tree, styles).end;
                    vec![(end..end, self.common_xml.clone())]
                }
            }
            None => {
                let at = ["office:automatic-styles", "office:master-styles"]
                    .iter()
                    .find_map(|n| tree.child(tree.root, n))
                    .map_or_else(
                        || inner(tree, tree.root).end,
                        |id| tree.nodes[id].span.start,
                    );
                vec![(
                    at..at,
                    format!("<office:styles>{}</office:styles>", self.common_xml),
                )]
            }
        };
        Ok(Some(splice(&tree.source, splices)))
    }
}

fn splice(source: &[u8], mut splices: Vec<(Range<usize>, String)>) -> Vec<u8> {
    splices.sort_by_key(|(range, _)| (range.start, range.end));
    let mut out = Vec::with_capacity(source.len());
    let mut at = 0;
    for (range, text) in splices {
        out.extend_from_slice(&source[at..range.start]);
        out.extend_from_slice(text.as_bytes());
        at = range.end;
    }
    out.extend_from_slice(&source[at..]);
    out
}

/// Porta gli involucri aperti a quelli voluti.
fn sync(stack: &mut Vec<String>, want: &[String], out: &mut String) {
    let common = stack.iter().zip(want).take_while(|(a, b)| a == b).count();
    while stack.len() > common {
        let tag = stack.pop().expect("not empty");
        out.push_str(&format!("</{}>", name_of(&tag)));
    }
    for tag in &want[common..] {
        out.push_str(&opening(tag));
        stack.push(tag.clone());
    }
}

/// Il testo di un tratto con la regola degli spazi di ODF: uno spazio
/// letterale soltanto dopo un carattere visibile, `text:s` per gli altri.
fn text(x: &str, space_ok: &mut bool, out: &mut String) -> Result<(), RichError> {
    let mut chars = x.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' => {
                let mut n = 1;
                while chars.peek() == Some(&' ') {
                    chars.next();
                    n += 1;
                }
                if *space_ok {
                    out.push(' ');
                    n -= 1;
                }
                match n {
                    0 => {}
                    1 => out.push_str("<text:s/>"),
                    n => out.push_str(&format!("<text:s text:c=\"{n}\"/>")),
                }
                *space_ok = false;
            }
            '\t' => {
                out.push_str("<text:tab/>");
                *space_ok = false;
            }
            '\n' => {
                out.push_str("<text:line-break/>");
                *space_ok = false;
            }
            '\u{c}' | '\u{e}' => {
                return Err(RichError::Codec(
                    "odt: a page or column break inside a paragraph cannot be written".into(),
                ))
            }
            c if (c as u32) < 0x20 || matches!(c, '\u{fffe}' | '\u{ffff}') => {
                return Err(RichError::Codec(format!(
                    "odt: character U+{:04X} cannot be written",
                    c as u32
                )))
            }
            c => {
                let mut buf = [0; 4];
                xml::escape_text(c.encode_utf8(&mut buf), out);
                *space_ok = true;
            }
        }
    }
    Ok(())
}
