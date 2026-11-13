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

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use super::keys::{self, name_of, opening, AtomKey, Level};
use super::read::{inner, Body, Unit};
use super::styles::Styles;
use super::xml::Tree;
use crate::blob;
use crate::projection::{Block, Inline, Role};
use crate::RichError;

mod looks;
mod markup;
mod paragraphs;
mod tables;

use markup::{attr, ids_in, set_attr, splice};
use tables::width;

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
    /// Le immagini nuove da mettere nel pacchetto: percorso, tipo e byte.
    pub pictures: Vec<(String, &'static str, Vec<u8>)>,
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
        pictures: writer.pictures,
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
    /// Le tabelle di partenza: chiave, chiavi delle righe e colonne.
    tables: Vec<(Option<String>, Vec<Option<String>>, usize)>,
    /// Lo stile delle celle delle tabelle nuove, una volta scritto.
    grid_cell: Option<String>,
    /// Le tabelle nuove già nominate.
    named: usize,
    /// Le immagini e le note nuove già nominate.
    framed: usize,
    noted: usize,
    /// Le note nuove a piè di pagina e di chiusura già scritte.
    cited: [usize; 2],
    pictures: Vec<(String, &'static str, Vec<u8>)>,
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
            grid_cell: None,
            named: 0,
            common_xml: String::new(),
            clones: HashMap::new(),
            seen: HashSet::new(),
            atoms: HashMap::new(),
            used: HashMap::new(),
            tables: Vec::new(),
            framed: 0,
            noted: 0,
            cited: [0; 2],
            pictures: Vec::new(),
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
                        if let Inline::Atom { k: Some(k), .. } = inline {
                            if let Ok(key) = blob::decode::<AtomKey>(k) {
                                *self.atoms.entry(key.xml).or_default() += 1;
                            }
                        }
                    }
                }
                Block::Table(t) => {
                    let rows = t.rows.iter().map(|r| r.k.clone()).collect();
                    self.tables.push((t.k.clone(), rows, width(t).unwrap_or(0)));
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
