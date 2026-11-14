//! Da un testo a una lavagna: un diagramma Mermaid (`flowchart`) o una
//! scaletta rientrata diventano schede, gruppi e archi, già disposti.
//!
//! I lettori sono scritti a mano, senza dipendenze: [`mermaid::read`] e
//! [`outline::read`] danno uno [`Sketch`], cioè ciò che il testo dice (le
//! schede col loro testo, i blocchi `subgraph`, gli archi), e [`arrange`] lo
//! dispone con l'albero di [`crate::layout::arrange::tree`]. Le posizioni sono
//! relative: l'angolo in alto a sinistra del tutto sta in (0, 0). Gli id, il
//! posto sulla lavagna e le toppe li decide l'operazione (`ops/import.rs`).
//!
//! Ciò che un lettore non può tenere (una forma, uno stile, una riga che non
//! capisce) non si inventa e non si perde in silenzio: diventa una nota
//! ([`Notes`]), che l'operazione mette in [`crate::ops::Compiled::notes`]. Le
//! regole stanno in `docs/reference/canvas-import.md`.

pub(crate) mod mermaid;
pub(crate) mod outline;

use std::collections::HashMap;

use crate::layout::arrange::{self, Direction};
use crate::layout::{born_size, CardKind};
use crate::ops::NoteCode;

/// Il testo più lungo che un lettore accetta, in byte: oltre è `TooMany`.
pub const MAX_TEXT: usize = 256 * 1024;
/// Le schede e i gruppi che un testo porta al più: oltre è `TooMany`.
pub const MAX_IMPORTED: usize = 2000;
/// Gli archi che un testo porta al più: oltre è `TooMany`. Un `&` di Mermaid
/// moltiplica gli archi, e una riga sola non deve farne un milione.
pub const MAX_IMPORTED_EDGES: usize = 10_000;
/// Quanti `subgraph` uno dentro l'altro al più: oltre è `TooMany`.
pub const MAX_DEPTH: usize = 64;
/// Quante note tiene al più un'operazione; le altre si contano.
pub const MAX_NOTES: usize = 100;

/// Lo spazio fra due schede sorelle dell'albero, come `layout`.
const GAP: f64 = 24.0;
/// Il margine di un gruppo attorno alle sue schede, per lato, come `group`.
const GROUP_MARGIN: f64 = 24.0;
/// Quanti caratteri di una riga si citano al più in una nota.
const QUOTED_CHARS: usize = 80;

/// Perché un testo non diventa una lavagna. L'operazione lo traduce in
/// [`crate::ops::OpError`] con la sua posizione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ImportError {
    /// Il testo non si legge: il motivo, in inglese come gli errori delle
    /// operazioni.
    Invalid(String),
    /// Il testo porta più del limite.
    TooMany { what: &'static str, limit: usize },
}

/// Le note di un lettore: al più [`MAX_NOTES`], le altre contate.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Notes {
    pub list: Vec<(NoteCode, String)>,
    pub omitted: usize,
}

impl Notes {
    pub fn push(&mut self, code: NoteCode, detail: String) {
        if self.list.len() < MAX_NOTES {
            self.list.push((code, detail));
        } else {
            self.omitted += 1;
        }
    }
}

/// Ciò che un testo dice, prima di disporlo.
#[derive(Clone, Debug, Default)]
pub(crate) struct Sketch {
    /// Le schede di testo, nell'ordine in cui il testo le nomina.
    pub nodes: Vec<SketchNode>,
    /// I blocchi (`subgraph`), nell'ordine in cui si aprono.
    pub groups: Vec<SketchGroup>,
    /// Gli archi, nell'ordine del testo.
    pub edges: Vec<SketchEdge>,
    /// Il verso dell'albero di primo livello.
    pub direction: Option<Direction>,
    pub notes: Notes,
}

/// Una scheda di testo.
#[derive(Clone, Debug)]
pub(crate) struct SketchNode {
    /// Il nome che il testo le dà (l'id di Mermaid, il numero della riga).
    pub name: String,
    pub text: String,
    /// Il blocco che la contiene.
    pub parent: Option<usize>,
    /// La posizione fra le schede e i blocchi, nell'ordine del testo.
    pub order: usize,
}

/// Un blocco, che diventa un gruppo.
#[derive(Clone, Debug)]
pub(crate) struct SketchGroup {
    /// L'id del `subgraph`.
    pub name: String,
    /// Il titolo, che diventa l'etichetta del gruppo.
    pub label: String,
    /// Il blocco che lo contiene.
    pub parent: Option<usize>,
    /// Il verso dell'albero dentro il blocco; senza, quello del blocco di fuori.
    pub direction: Option<Direction>,
    pub order: usize,
}

/// Un capo di un arco: una scheda o un blocco.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum End {
    Node(usize),
    Group(usize),
}

/// Un arco.
#[derive(Clone, Debug)]
pub(crate) struct SketchEdge {
    pub from: End,
    pub to: End,
    pub label: Option<String>,
    /// Una punta alla partenza (`<-->`).
    pub from_arrow: bool,
    /// Una punta all'arrivo (`-->`; `---` non ne ha).
    pub to_arrow: bool,
}

/// Un rettangolo disposto, relativo all'angolo del tutto.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Placed {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Lo [`Sketch`] disposto: un rettangolo per scheda e per blocco, e la misura
/// del tutto.
#[derive(Clone, Debug)]
pub(crate) struct Arranged {
    pub nodes: Vec<Placed>,
    pub groups: Vec<Placed>,
    pub size: (f64, f64),
}

/// Un elemento di un blocco: una scheda o un blocco dentro.
type Item = End;

/// Dispone lo schizzo. Ogni blocco è un albero dentro di sé, con le schede e i
/// blocchi che contiene, e diventa un gruppo con il margine di 24; i blocchi e
/// le schede libere sono l'albero di primo livello. Un arco fra due elementi di
/// blocchi diversi conta, nel loro primo blocco comune, come un arco fra i due
/// elementi che li contengono. Un blocco vuoto ha la misura di nascita di un
/// gruppo.
pub(crate) fn arrange(sketch: &Sketch) -> Arranged {
    let groups = sketch.groups.len();
    // Gli elementi di ogni blocco (l'ultimo posto è il primo livello),
    // nell'ordine del testo.
    let root = groups;
    let mut members: Vec<Vec<(usize, Item)>> = vec![Vec::new(); groups + 1];
    for (index, node) in sketch.nodes.iter().enumerate() {
        members[node.parent.unwrap_or(root)].push((node.order, End::Node(index)));
    }
    for (index, group) in sketch.groups.iter().enumerate() {
        members[group.parent.unwrap_or(root)].push((group.order, End::Group(index)));
    }
    for list in &mut members {
        list.sort_by_key(|(order, _)| *order);
    }
    let members: Vec<Vec<Item>> = members
        .into_iter()
        .map(|list| list.into_iter().map(|(_, item)| item).collect())
        .collect();
    let position: HashMap<Item, usize> = members
        .iter()
        .flat_map(|list| list.iter().enumerate().map(|(at, item)| (*item, at)))
        .collect();

    // Gli archi di ogni blocco, fra i suoi elementi.
    let mut links: Vec<Vec<(usize, usize)>> = vec![Vec::new(); groups + 1];
    for edge in &sketch.edges {
        let from = path(sketch, edge.from);
        let to = path(sketch, edge.to);
        let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
        let (Some(&first), Some(&second)) = (from.get(shared), to.get(shared)) else {
            // Un capo contiene l'altro (o è lo stesso): l'arco non dispone niente.
            continue;
        };
        let block = match shared {
            0 => root,
            _ => match from[shared - 1] {
                End::Group(group) => group,
                End::Node(_) => continue,
            },
        };
        links[block].push((position[&first], position[&second]));
    }

    // Il verso di ogni blocco: il suo, o quello del blocco di fuori.
    let top = sketch.direction.unwrap_or(Direction::Down);
    let mut direction = vec![top; groups];
    let depth = depths(sketch);
    let mut outer_first: Vec<usize> = (0..groups).collect();
    outer_first.sort_by_key(|&group| depth[group]);
    for &group in &outer_first {
        let inherited = sketch.groups[group]
            .parent
            .map_or(top, |parent| direction[parent]);
        direction[group] = sketch.groups[group].direction.unwrap_or(inherited);
    }

    // Dal blocco più dentro a quello più fuori: le misure dei blocchi dentro
    // sono pronte quando serve.
    let node_sizes: Vec<(f64, f64)> = sketch
        .nodes
        .iter()
        .map(|node| born_size(CardKind::Text, Some(&node.text), None))
        .collect();
    let mut group_sizes = vec![(0.0, 0.0); groups];
    // La posizione di ogni elemento dentro il suo blocco, dall'angolo del
    // contenuto.
    let mut inner: Vec<Vec<(f64, f64)>> = vec![Vec::new(); groups + 1];
    let mut extents = vec![(0.0, 0.0); groups + 1];
    let mut inner_first = outer_first.clone();
    inner_first.reverse();
    for block in inner_first.into_iter().chain(std::iter::once(root)) {
        let sizes: Vec<(f64, f64)> = members[block]
            .iter()
            .map(|item| match *item {
                End::Node(node) => node_sizes[node],
                End::Group(group) => group_sizes[group],
            })
            .collect();
        let way = if block == root { top } else { direction[block] };
        let at = arrange::tree(&sizes, &links[block], way, GAP);
        let extent = at
            .iter()
            .zip(&sizes)
            .fold((0.0_f64, 0.0_f64), |(w, h), (&(x, y), &(sw, sh))| {
                (w.max(x + sw), h.max(y + sh))
            });
        extents[block] = extent;
        inner[block] = at;
        if block != root {
            group_sizes[block] = if members[block].is_empty() {
                born_size(CardKind::Group, None, None)
            } else {
                (extent.0 + 2.0 * GROUP_MARGIN, extent.1 + 2.0 * GROUP_MARGIN)
            };
        }
    }

    // Dal primo livello in giù: ogni elemento al suo posto assoluto.
    let mut nodes = vec![Placed::default(); sketch.nodes.len()];
    let mut placed_groups = vec![Placed::default(); groups];
    let mut origin = vec![(0.0, 0.0); groups + 1];
    for block in std::iter::once(root).chain(outer_first.iter().copied()) {
        let (ox, oy) = origin[block];
        for (item, &(x, y)) in members[block].iter().zip(&inner[block]) {
            let (x, y) = ((ox + x).round(), (oy + y).round());
            match *item {
                End::Node(node) => {
                    let (width, height) = node_sizes[node];
                    nodes[node] = Placed {
                        x,
                        y,
                        width,
                        height,
                    };
                }
                End::Group(group) => {
                    let (width, height) = group_sizes[group];
                    placed_groups[group] = Placed {
                        x,
                        y,
                        width,
                        height,
                    };
                    origin[group] = (x + GROUP_MARGIN, y + GROUP_MARGIN);
                }
            }
        }
    }
    Arranged {
        nodes,
        groups: placed_groups,
        size: extents[root],
    }
}

/// Gli elementi dal primo livello fino a `end` compreso: i blocchi che lo
/// contengono, dal più fuori, e lui.
fn path(sketch: &Sketch, end: End) -> Vec<Item> {
    let mut chain = vec![end];
    let mut parent = match end {
        End::Node(node) => sketch.nodes[node].parent,
        End::Group(group) => sketch.groups[group].parent,
    };
    while let Some(group) = parent {
        chain.push(End::Group(group));
        parent = sketch.groups[group].parent;
    }
    chain.reverse();
    chain
}

/// Quanti blocchi contengono ogni blocco. I blocchi si aprono dopo il blocco
/// che li contiene, quindi il genitore ha sempre un indice più piccolo.
fn depths(sketch: &Sketch) -> Vec<usize> {
    let mut depth = vec![0_usize; sketch.groups.len()];
    for (index, group) in sketch.groups.iter().enumerate() {
        if let Some(parent) = group.parent {
            depth[index] = depth[parent] + 1;
        }
    }
    depth
}

/// Una riga del testo citata in una nota: al più [`QUOTED_CHARS`] caratteri.
pub(crate) fn quote(line: &str) -> String {
    let line = line.trim();
    if line.chars().count() <= QUOTED_CHARS {
        return line.to_owned();
    }
    let mut cut: String = line.chars().take(QUOTED_CHARS).collect();
    cut.push('…');
    cut
}

/// Le righe del testo, col loro numero da 1: una riga finisce a `\n` o a
/// `\r\n`, e un BOM in testa non conta.
pub(crate) fn lines(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .enumerate()
        .map(|(index, line)| (index + 1, line))
}
