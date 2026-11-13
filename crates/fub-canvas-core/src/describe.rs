//! La lavagna come codice: le tre forme in cui si legge una lavagna.
//!
//! Tutte e tre vengono dal modello del nucleo, con le stesse regole:
//! - [`outline`]: una riga per scheda e per arco, per leggere in fretta;
//! - [`code`]: la lista di operazioni che ricrea la lavagna. Compilata su una
//!   lavagna vuota con [`crate::ops::compile`], dà la stessa lavagna;
//! - [`json`]: il modello com'è, come lo scrive il file.
//!
//! Le tre forme prendono le stesse [`DescribeOptions`]: `ids` tiene solo quelle
//! schede e gli archi fra loro, `max_chars` taglia solo l'[`outline`]. Nessuna
//! parola in una lingua: le chiavi sono i nomi dei campi del formato. Le regole
//! stanno in `docs/reference/canvas-code.md`.

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::layout::{card_kind, inside, CardKind};
use crate::model::{
    Canvas, CanvasColor, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasNode, CanvasNodeType,
    PresetColor,
};
use crate::ops::CanvasOp;
use crate::source::{canvas_value, edge_value, node_value, SourceError};

/// Quanti caratteri di un testo entrano in una riga dell'outline, il `…`
/// compreso.
const TEXT_CHARS: usize = 60;

/// Che cosa si legge di una lavagna. Il valore di serie legge tutto.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DescribeOptions {
    /// Le schede da leggere, e gli archi che le collegano fra loro. `None` vuol
    /// dire tutta la lavagna. Un id che non è una scheda si ignora: i conti
    /// dell'outline dicono quante schede ci sono davvero.
    pub ids: Option<Vec<String>>,
    /// Quanti caratteri al più dà l'[`outline`]. Si taglia a una riga intera e
    /// l'ultima riga dice quante ne restano, `…+N`. La prima riga esce sempre.
    /// Le altre forme non si tagliano: una lista di operazioni tagliata non si
    /// compila.
    pub max_chars: Option<usize>,
}

/// Le schede e gli archi che una lettura mostra.
struct View<'a> {
    /// Le schede tenute, con la loro posizione nel modello (da zero), nell'ordine
    /// del modello.
    nodes: Vec<(usize, &'a CanvasNode)>,
    /// Gli archi tenuti, nell'ordine del modello: tutti senza `ids`, con `ids`
    /// solo quelli fra due schede tenute.
    edges: Vec<&'a CanvasEdge>,
}

impl<'a> View<'a> {
    fn of(canvas: &'a Canvas, options: &DescribeOptions) -> Self {
        let wanted: Option<HashSet<&str>> = options
            .ids
            .as_ref()
            .map(|ids| ids.iter().map(String::as_str).collect());
        let nodes: Vec<(usize, &CanvasNode)> = canvas
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| {
                wanted
                    .as_ref()
                    .is_none_or(|ids| ids.contains(node.id.as_str()))
            })
            .collect();
        let shown: HashSet<&str> = nodes.iter().map(|(_, node)| node.id.as_str()).collect();
        let edges = canvas
            .edges
            .iter()
            .filter(|edge| {
                wanted.is_none()
                    || (shown.contains(edge.from_node.as_str())
                        && shown.contains(edge.to_node.as_str()))
            })
            .collect();
        Self { nodes, edges }
    }
}

/// La lavagna in righe di testo: una riga per conto, con i conti in testa, poi
/// una riga per scheda (col suo numero da 1, la posizione nel modello) e una per
/// arco.
///
/// La riga dei conti dice `cards`, `edges`, `groups` (quante sono di gruppo, fra
/// le schede) e `bounds`, il riquadro che racchiude le schede: l'angolo alto a
/// sinistra e la misura, o `-` se non ce ne sono. Una scheda è
/// `N id specie [testo] x y larghezza×altezza [color=…] [in=…]`; un arco è
/// `id da -> a ["etichetta"] [color=…] [fromSide=…] [toSide=…] [fromEnd=arrow]
/// [toEnd=none]`, dove i campi compaiono solo se non sono quelli di serie. Il
/// testo è accorciato a 60 caratteri, e come stringa JSON, così una riga resta
/// una riga.
pub fn outline(canvas: &Canvas, options: &DescribeOptions) -> String {
    let view = View::of(canvas, options);
    let groups: Vec<&CanvasNode> = canvas
        .nodes
        .iter()
        .filter(|node| node.node_type == CanvasNodeType::Group)
        .collect();
    let mut lines = vec![counts(&view)];
    lines.extend(
        view.nodes
            .iter()
            .map(|&(position, node)| card_line(&groups, position + 1, node)),
    );
    lines.extend(view.edges.iter().map(|edge| edge_line(edge)));
    cut_lines(&lines, options.max_chars)
}

/// Le operazioni che ricreano la lavagna: prima una `add_card` per scheda, nel
/// suo ordine, poi una `connect` per arco. Ogni scheda e ogni arco sono il loro
/// valore JSON del file, con `x` e `y` sempre, e i campi sconosciuti dentro.
///
/// Compilate su una lavagna vuota (`compile`, seme qualunque), ridanno le schede
/// e gli archi nello stesso ordine. La radice sconosciuta della lavagna non
/// ci sta: nessuna operazione la scrive, e la dà [`json`].
pub fn code(canvas: &Canvas, options: &DescribeOptions) -> Vec<CanvasOp> {
    let view = View::of(canvas, options);
    let cards = view.nodes.iter().map(|&(_, node)| CanvasOp::AddCard {
        node: object(node_value(node)),
    });
    let links = view.edges.iter().map(|edge| CanvasOp::Connect {
        edge: object(edge_value(edge)),
    });
    cards.chain(links).collect()
}

/// Il modello com'è, come valore JSON: `nodes` ed `edges` sempre, poi la radice
/// sconosciuta. Con `ids` ci sono solo quelle schede e gli archi fra loro, e
/// la radice sconosciuta no: non è di una scheda.
pub fn json(canvas: &Canvas, options: &DescribeOptions) -> Result<Value, SourceError> {
    if options.ids.is_none() {
        return canvas_value(canvas);
    }
    let view = View::of(canvas, options);
    let part = Canvas {
        nodes: view.nodes.iter().map(|&(_, node)| node.clone()).collect(),
        edges: view.edges.iter().map(|&edge| edge.clone()).collect(),
        extra: Map::new(),
    };
    canvas_value(&part)
}

/// La riga dei conti: `cards 3 edges 1 groups 0 bounds 0 0 688×544`.
fn counts(view: &View<'_>) -> String {
    let groups = view
        .nodes
        .iter()
        .filter(|(_, node)| node.node_type == CanvasNodeType::Group)
        .count();
    let bounds = match bounds(&view.nodes) {
        Some((left, top, width, height)) => format!("{left} {top} {width}×{height}"),
        None => "-".to_owned(),
    };
    format!(
        "cards {} edges {} groups {groups} bounds {bounds}",
        view.nodes.len(),
        view.edges.len()
    )
}

/// Il riquadro delle schede: l'angolo in alto a sinistra, la larghezza e
/// l'altezza. `None` se non ci sono schede.
fn bounds(nodes: &[(usize, &CanvasNode)]) -> Option<(i128, i128, i128, i128)> {
    let mut all = nodes.iter().map(|(_, node)| *node);
    let first = all.next()?;
    let (mut left, mut top) = (i128::from(first.x), i128::from(first.y));
    let (mut right, mut bottom) = (
        left + i128::from(first.width),
        top + i128::from(first.height),
    );
    for node in all {
        left = left.min(i128::from(node.x));
        top = top.min(i128::from(node.y));
        right = right.max(i128::from(node.x) + i128::from(node.width));
        bottom = bottom.max(i128::from(node.y) + i128::from(node.height));
    }
    Some((left, top, right - left, bottom - top))
}

/// La riga di una scheda. `groups` sono i gruppi di tutta la lavagna: una
/// scheda può stare dentro un gruppo anche se il gruppo non è fra quelle lette.
fn card_line(groups: &[&CanvasNode], number: usize, node: &CanvasNode) -> String {
    let mut parts = vec![
        number.to_string(),
        token(&node.id),
        kind_name(card_kind(node)).to_owned(),
    ];
    if let Some(text) = card_text(node) {
        parts.push(quoted(&shorten(&text)));
    }
    parts.push(format!("{} {}", node.x, node.y));
    parts.push(format!("{}×{}", node.width, node.height));
    if let Some(color) = &node.color {
        parts.push(format!("color={}", color_token(color)));
    }
    if let Some(group) = innermost_group(groups, node) {
        parts.push(format!("in={}", token(&group.id)));
    }
    parts.join(" ")
}

/// La riga di un arco. I lati e le punte compaiono solo se non sono quelli di
/// serie: nessun lato, punta alla fine (`toEnd` assente o `arrow`), coda senza
/// punta (`fromEnd` assente o `none`).
fn edge_line(edge: &CanvasEdge) -> String {
    let mut parts = vec![
        token(&edge.id),
        format!("{} -> {}", token(&edge.from_node), token(&edge.to_node)),
    ];
    if let Some(label) = &edge.label {
        parts.push(quoted(&shorten(label)));
    }
    if let Some(color) = &edge.color {
        parts.push(format!("color={}", color_token(color)));
    }
    if let Some(side) = edge.from_side {
        parts.push(format!("fromSide={}", side_name(side)));
    }
    if let Some(side) = edge.to_side {
        parts.push(format!("toSide={}", side_name(side)));
    }
    if edge.from_end == Some(CanvasEdgeEnd::Arrow) {
        parts.push("fromEnd=arrow".to_owned());
    }
    if edge.to_end == Some(CanvasEdgeEnd::None) {
        parts.push("toEnd=none".to_owned());
    }
    parts.join(" ")
}

/// Il testo che una riga mostra per una scheda: il testo, l'etichetta del
/// gruppo, il percorso del file col suo sottopercorso, il collegamento.
fn card_text(node: &CanvasNode) -> Option<String> {
    match node.node_type {
        CanvasNodeType::Text => node.text.clone(),
        CanvasNodeType::Group => node.label.clone(),
        CanvasNodeType::File => node
            .file
            .as_ref()
            .map(|path| format!("{path}{}", node.subpath.as_deref().unwrap_or(""))),
        CanvasNodeType::Link => node.url.clone(),
    }
}

/// Il gruppo più piccolo che contiene la scheda; a parità di misura, il primo
/// del modello. Una scheda non è dentro sé stessa.
fn innermost_group<'a>(groups: &[&'a CanvasNode], node: &CanvasNode) -> Option<&'a CanvasNode> {
    groups
        .iter()
        .copied()
        .filter(|group| inside(node, group))
        .min_by_key(|group| i128::from(group.width) * i128::from(group.height))
}

/// Accorcia un testo a [`TEXT_CHARS`] caratteri, il `…` compreso. Conta i
/// caratteri, non i byte.
fn shorten(text: &str) -> String {
    if text.chars().count() <= TEXT_CHARS {
        return text.to_owned();
    }
    let mut short: String = text.chars().take(TEXT_CHARS - 1).collect();
    short.push('…');
    short
}

/// Un testo come stringa JSON: `"` e a capo come nel file, una riga sola.
fn quoted(text: &str) -> String {
    Value::String(text.to_owned()).to_string()
}

/// Un id, un colore esadecimale o un nome in una riga: così com'è se ha solo
/// lettere, cifre e `-_.:#`, altrimenti come stringa JSON. Così uno spazio o un
/// `"` nell'id non spezzano la riga.
fn token(text: &str) -> String {
    let plain = !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '#'));
    if plain {
        text.to_owned()
    } else {
        quoted(text)
    }
}

/// Il colore come lo scrive il file: `"1"`…`"6"` per i preset, il `#` per l'altro.
fn color_token(color: &CanvasColor) -> String {
    match color {
        CanvasColor::Preset(preset) => preset_number(*preset).to_owned(),
        CanvasColor::Hex(hex) => token(hex),
    }
}

fn preset_number(preset: PresetColor) -> &'static str {
    match preset {
        PresetColor::Red => "1",
        PresetColor::Orange => "2",
        PresetColor::Yellow => "3",
        PresetColor::Green => "4",
        PresetColor::Cyan => "5",
        PresetColor::Purple => "6",
    }
}

/// Il nome di una specie nell'outline. Sono i nomi di [`CardKind`] in minuscolo,
/// come nei vettori di `layout`.
fn kind_name(kind: CardKind) -> &'static str {
    match kind {
        CardKind::Text => "text",
        CardKind::Note => "note",
        CardKind::Document => "document",
        CardKind::Sheet => "sheet",
        CardKind::Pdf => "pdf",
        CardKind::Image => "image",
        CardKind::Web => "web",
        CardKind::Craft => "craft",
        CardKind::File => "file",
        CardKind::Group => "group",
    }
}

fn side_name(side: CanvasEdgeSide) -> &'static str {
    match side {
        CanvasEdgeSide::Top => "top",
        CanvasEdgeSide::Right => "right",
        CanvasEdgeSide::Bottom => "bottom",
        CanvasEdgeSide::Left => "left",
    }
}

/// Le righe unite da a capo, tagliate a `max_chars` caratteri se serve. Si
/// tiene la prima riga e quante righe intere entrano, con l'ultima riga
/// `…+N` che dice quante ne restano. La prima riga esce anche se da sola supera
/// il limite, e senza `max_chars` non si taglia nulla.
fn cut_lines(lines: &[String], max_chars: Option<usize>) -> String {
    let whole = lines.join("\n");
    let Some(limit) = max_chars else {
        return whole;
    };
    if lines.len() < 2 || whole.chars().count() <= limit {
        return whole;
    }
    let mut shown = 1;
    let mut used = lines[0].chars().count();
    while shown + 1 < lines.len() {
        let with_next = used + 1 + lines[shown].chars().count();
        let rest = lines.len() - (shown + 1);
        let marker = format!("…+{rest}").chars().count();
        if with_next + 1 + marker > limit {
            break;
        }
        used = with_next;
        shown += 1;
    }
    let mut cut = lines[..shown].join("\n");
    cut.push('\n');
    cut.push_str(&format!("…+{}", lines.len() - shown));
    cut
}

/// Un valore JSON che è un oggetto, come mappa dei suoi campi. Una scheda o un
/// arco del modello è sempre un oggetto: l'altro ramo non si raggiunge.
fn object(value: Result<Value, SourceError>) -> Map<String, Value> {
    match value {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}
