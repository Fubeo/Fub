//! La lavagna come codice: le tre forme in cui si legge una lavagna.
//!
//! Tutte e tre vengono dal modello del nucleo, con le stesse regole:
//! - [`outline`]: una riga per scheda e per arco, per leggere in fretta;
//! - [`code`]: la lista di operazioni che ricrea la lavagna. Compilata su una
//!   lavagna vuota con [`crate::ops::compile`], dà la stessa lavagna;
//! - [`json`]: il modello com'è, come lo scrive il file, `fub:ink` compreso.
//!   Accanto, [`ink_read`] dà i tratti decodificati: è solo da leggere, e non
//!   sta nel modello, così una scheda letta e rimandata non perde l'inchiostro.
//!
//! Le forme prendono le stesse [`DescribeOptions`]: `ids` tiene solo quelle
//! schede e gli archi fra loro, `max_chars` taglia l'[`outline`] e i punti di
//! [`ink_read`]. Nessuna parola in una lingua: le chiavi sono i
//! nomi dei campi del formato. Le regole stanno in
//! `docs/reference/canvas-code.md`, e quelle dell'inchiostro in
//! `docs/reference/canvas-ink-code.md`: le legge il modulo `ink`.

mod ink;

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::ink::{LayerRef, INK_KEY};
use crate::layout::{self, card_kind, inside, CardKind};
use crate::model::{
    Canvas, CanvasColor, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasNode, CanvasNodeType,
    PresetColor,
};
use crate::ops::{color, AddCardArgs, CanvasOp, ConnectArgs, Ends, SidePair, Sides};
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
    /// Di [`ink_read`] si tagliano soltanto i punti dei tratti. Il [`code`] e
    /// il [`json`] non si tagliano: una lista di operazioni tagliata non si
    /// compila, e un modello tagliato non è il file.
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
/// la riga dell'inchiostro libero, una riga per scheda (col suo numero da 1, la
/// posizione nel modello) e una per arco.
///
/// La riga dei conti dice `cards`, `edges`, `groups` (quante sono di gruppo, fra
/// le schede) e `bounds`, il riquadro che racchiude le schede: l'angolo alto a
/// sinistra e la misura, o `-` se non ce ne sono. Una scheda è
/// `N id specie [testo] x y larghezza×altezza [color=…] [in=…]`; un arco è
/// `id da -> a ["etichetta"] [color=…] [fromSide=…] [toSide=…] [fromEnd=arrow]
/// [toEnd=none]`, dove i campi compaiono solo se non sono quelli di serie. Il
/// testo è accorciato a 60 caratteri, e come stringa JSON, così una riga resta
/// una riga.
///
/// Una scheda con l'inchiostro aggiunge `ink=N [bad=M] x y larghezza×altezza`:
/// i tratti, quanti non si disegnano e il riquadro di quelli che si disegnano
/// nelle coordinate della scheda (`-` se nessuno), o `ink=foreign` per un
/// livello estraneo. L'inchiostro libero è la riga `ink board N …`, con le
/// stesse parti in coordinate della lavagna; con `ids` non c'è, perché non è
/// di una scheda. Gli archi non hanno inchiostro.
pub fn outline(canvas: &Canvas, options: &DescribeOptions) -> String {
    let view = View::of(canvas, options);
    let groups: Vec<&CanvasNode> = canvas
        .nodes
        .iter()
        .filter(|node| node.node_type == CanvasNodeType::Group)
        .collect();
    let mut lines = vec![counts(&view)];
    if options.ids.is_none() {
        if let Some(value) = canvas.extra.get(INK_KEY) {
            lines.push(format!(
                "ink board {}",
                ink::summary(value, &LayerRef::Board, None)
            ));
        }
    }
    lines.extend(
        view.nodes
            .iter()
            .map(|&(position, node)| card_line(&groups, position + 1, node)),
    );
    lines.extend(view.edges.iter().map(|edge| edge_line(edge)));
    cut_lines(&lines, options.max_chars)
}

/// Le operazioni che ricreano la lavagna: prima una `add_card` per scheda, nel
/// suo ordine, ognuna seguita dalla `add_strokes` del suo inchiostro se ce
/// l'ha, poi una `connect` per arco, e in fondo la `add_strokes` dell'inchiostro
/// libero. Ogni scheda e ogni arco vanno nella forma breve quando ogni suo campo
/// ci sta, e altrimenti sono il loro valore JSON del file, con i campi
/// sconosciuti dentro. I tratti vanno come nel file, con le stringhe esatte.
///
/// Compilate su una lavagna vuota (`compile`, seme qualunque), ridanno le schede
/// e gli archi nello stesso ordine e con gli stessi campi, inchiostro compreso.
/// Un livello che `add_strokes` non ricrea uguale (estraneo, con un tratto che
/// non si disegna, con campi in più o vuoto) resta nella scheda intera, com'è
/// nel file. La radice sconosciuta della lavagna non ci sta, e nemmeno un
/// livello libero così: nessuna operazione la scrive, e la dà [`json`]. Con
/// `ids` l'inchiostro libero non c'è.
pub fn code(canvas: &Canvas, options: &DescribeOptions) -> Vec<CanvasOp> {
    let view = View::of(canvas, options);
    let mut ops = Vec::with_capacity(view.nodes.len() + view.edges.len() + 1);
    for &(_, node) in &view.nodes {
        card_ops(node, &mut ops);
    }
    ops.extend(view.edges.iter().map(|&edge| link_op(edge)));
    if options.ids.is_none() {
        let board = canvas.extra.get(INK_KEY);
        ops.extend(board.and_then(|value| ink::strokes_op(value, LayerRef::Board)));
    }
    ops
}

/// La scheda come `add_card`, poi il suo inchiostro come `add_strokes` se
/// l'operazione lo ricrea uguale. La scheda va nella forma breve se ci sta,
/// altrimenti intera, come nel file; un livello che non va in `add_strokes`
/// resta dentro la scheda intera.
fn card_ops(node: &CanvasNode, ops: &mut Vec<CanvasOp>) {
    // `add_strokes` rimette il livello in fondo ai campi della scheda: lo porta
    // solo se è già l'ultimo, così il giro non cambia l'ordine delle chiavi.
    let strokes = node
        .extra
        .iter()
        .next_back()
        .filter(|(key, _)| key.as_str() == INK_KEY)
        .and_then(|(_, value)| ink::strokes_op(value, LayerRef::Node(node.id.clone())));
    let bare;
    let card_node = if strokes.is_some() {
        let mut without = node.clone();
        without.extra.shift_remove(INK_KEY);
        bare = without;
        &bare
    } else {
        node
    };
    let card = short_card(card_node).unwrap_or_else(|| AddCardArgs {
        node: Some(object(node_value(card_node))),
        ..AddCardArgs::default()
    });
    ops.push(CanvasOp::AddCard(card));
    ops.extend(strokes);
}

/// La forma breve di una scheda, se ogni suo campo ci sta. L'`id`, `x` e `y`
/// ci sono sempre; `width` e `height` solo se non sono quelle di nascita; il
/// tipo lo dice il contenuto, tranne che per un gruppo. Non ci sta una scheda
/// con un campo sconosciuto, uno sfondo, un colore che la tavola non scrive, o
/// un gruppo senza etichetta (la forma breve gli darebbe `""`).
fn short_card(node: &CanvasNode) -> Option<AddCardArgs> {
    if !node.extra.is_empty() || node.background.is_some() || node.background_style.is_some() {
        return None;
    }
    let color = match &node.color {
        None => None,
        Some(color) => Some(color::written(color)?),
    };
    let mut card = AddCardArgs {
        id: Some(node.id.clone()),
        x: Some(node.x),
        y: Some(node.y),
        color,
        ..AddCardArgs::default()
    };
    match node.node_type {
        CanvasNodeType::Text => {
            if node.file.is_some()
                || node.subpath.is_some()
                || node.url.is_some()
                || node.label.is_some()
            {
                return None;
            }
            card.text = Some(node.text.clone()?);
        }
        CanvasNodeType::File => {
            if node.text.is_some() || node.url.is_some() || node.label.is_some() {
                return None;
            }
            card.file = Some(node.file.clone()?);
            card.subpath = node.subpath.clone();
        }
        CanvasNodeType::Link => {
            if node.text.is_some()
                || node.file.is_some()
                || node.subpath.is_some()
                || node.label.is_some()
            {
                return None;
            }
            card.url = Some(node.url.clone()?);
        }
        CanvasNodeType::Group => {
            if node.text.is_some()
                || node.file.is_some()
                || node.subpath.is_some()
                || node.url.is_some()
            {
                return None;
            }
            card.kind = Some(CanvasNodeType::Group);
            card.label = Some(node.label.clone()?);
        }
    }
    let text = match node.node_type {
        CanvasNodeType::Text => node.text.as_deref(),
        _ => None,
    };
    let (born_width, born_height) = layout::born_size(card_kind(node), text, None);
    if node.width as f64 != born_width {
        card.width = Some(node.width);
    }
    if node.height as f64 != born_height {
        card.height = Some(node.height);
    }
    Some(card)
}

/// L'arco come `connect`: la forma breve se ci sta, altrimenti l'arco del file.
fn link_op(edge: &CanvasEdge) -> CanvasOp {
    let link = short_link(edge).unwrap_or_else(|| ConnectArgs {
        edge: Some(object(edge_value(edge))),
        ..ConnectArgs::default()
    });
    CanvasOp::Connect(link)
}

/// La forma breve di un arco, se ogni suo campo ci sta. L'`id`, `from` e `to`
/// ci sono sempre; i lati solo se ci sono; le punte come `ends`, che di serie
/// è una punta alla fine. Non ci sta un campo sconosciuto, un colore che la
/// tavola non scrive, o una coppia di punte che `ends` non dice.
fn short_link(edge: &CanvasEdge) -> Option<ConnectArgs> {
    if !edge.extra.is_empty() {
        return None;
    }
    let color = match &edge.color {
        None => None,
        Some(color) => Some(color::written(color)?),
    };
    let sides = match (edge.from_side, edge.to_side) {
        (None, None) => None,
        (from, to) => Some(Sides::Pair(SidePair { from, to })),
    };
    let ends = match (edge.from_end, edge.to_end) {
        (None, Some(CanvasEdgeEnd::Arrow)) => None,
        (None, Some(CanvasEdgeEnd::None)) => Some(Ends::None),
        (Some(CanvasEdgeEnd::Arrow), Some(CanvasEdgeEnd::Arrow)) => Some(Ends::Both),
        _ => return None,
    };
    Some(ConnectArgs {
        id: Some(edge.id.clone()),
        from: Some(edge.from_node.clone()),
        to: Some(edge.to_node.clone()),
        label: edge.label.clone(),
        color,
        sides,
        ends,
        ..ConnectArgs::default()
    })
}

/// Il modello com'è, come valore JSON: `nodes` ed `edges` sempre, poi la radice
/// sconosciuta. Con `ids` ci sono solo quelle schede e gli archi fra loro, e
/// la radice sconosciuta no: non è di una scheda. I livelli `fub:ink` restano
/// com'è nel file; la loro lettura è [`ink_read`].
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

/// La lettura dell'inchiostro, da mettere accanto al [`json`]: un oggetto per
/// livello, `{layer, state, strokes}`, quelli delle schede nell'ordine del
/// modello, poi quello della radice (senza `ids`). `layer` è `"board"` o
/// `{"node": id}`, `state` è `ok` o `foreign` (un livello estraneo non elenca
/// tratti). Un tratto che si disegna è `{id, color, size, tool, pen?, bounds,
/// points}`, con i punti nelle coordinate di chi lo tiene arrotondati a 0,1;
/// uno che non si disegna è `{id, bad}`, con la ragione.
///
/// È solo da leggere: non è il formato del file, e nessuna operazione la
/// prende. `max_chars` ne taglia soltanto i punti (`points_omitted`). Le
/// stringhe esatte dei tratti le danno [`json`] e [`code`].
pub fn ink_read(canvas: &Canvas, options: &DescribeOptions) -> Value {
    let view = View::of(canvas, options);
    let nodes: Vec<&CanvasNode> = view.nodes.iter().map(|&(_, node)| node).collect();
    let board = match options.ids {
        None => canvas.extra.get(INK_KEY),
        Some(_) => None,
    };
    ink::read_layers(&nodes, board, options.max_chars)
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
    if let Some(value) = node.extra.get(INK_KEY) {
        let layer = LayerRef::Node(node.id.clone());
        parts.push(format!("ink={}", ink::summary(value, &layer, Some(node))));
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
pub(crate) fn card_text(node: &CanvasNode) -> Option<String> {
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
pub(crate) fn shorten(text: &str) -> String {
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

/// Il colore come lo scrive il file: `"1"`…`"6"` per i preset, il `#` per
/// l'altro, e un colore che Fub non conosce com'è scritto.
fn color_token(color: &CanvasColor) -> String {
    match color {
        CanvasColor::Preset(preset) => preset_number(*preset).to_owned(),
        CanvasColor::Hex(text) | CanvasColor::Unknown(text) => token(text),
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
