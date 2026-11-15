//! `erase_along`: la gomma che taglia, scritta dal codice. Il nucleo fa ciò che
//! la tela fa quando la gomma «Solo il pezzo» si alza (N4 T22,
//! `apps/client/src/editors/canvas/ink-erase.ts`): ogni tratto che il cammino
//! tocca si taglia dove passa il cerchio (`split_ink` e `cut_brush` di
//! `fub-ink-codec`, copiati da `ink/tools/split.ts`), e i pezzi che restano
//! prendono il suo posto, nel suo ordine. Le regole stanno in
//! `docs/reference/canvas-ink-code.md`.
//!
//! - **Dove.** `on` si legge come per `draw` ([`Compiler::on_target`]): con
//!   `auto` (di serie) i punti sono della lavagna e il cammino tocca i tratti
//!   liberi e quelli di ogni scheda; con `board` solo quelli liberi; con l'id
//!   di una scheda i punti sono nelle sue coordinate e il cammino tocca solo
//!   i suoi tratti.
//! - **Le unità.** Il cammino torna nelle unità del tratto con l'inverso della
//!   trasformazione della resa ([`InkFit`], con la proporzione del contenuto
//!   `aspect` se `on` è una scheda e chi scrive la sa), e il raggio,
//!   `size / 2`, cresce di metà dello spessore del tratto: il cerchio taglia
//!   dove tocca l'inchiostro, non solo la linea di mezzo. È il conto di
//!   `cutInk`.
//! - **I pezzi.** Ogni pezzo è un tratto nuovo coi campi di quello tagliato
//!   (anche gli sconosciuti), un id nuovo dal seme, `at` spostato all'inizio
//!   del pezzo, il suo `ink` nella stessa scala e il pennello tagliato. Un
//!   pezzo che non si scrive fa togliere il tratto intero, come nella tela.
//! - **Le toppe.** Per livello, prima si tolgono i tratti tagliati
//!   dall'ultimo al primo, poi si mettono i pezzi dove stavano: le toppe di
//!   `cutStrokePatches`, che l'inversa disfa in fila. Valgono tutte o
//!   nessuna, come ogni operazione.
//! - **Ciò che non si taglia.** Un tratto che Fub non disegna, un tratto
//!   attaccato alla pagina di un PDF o alla cella di un foglio (dove stanno
//!   nella scheda lo sa solo la resa), o un livello estraneo, non si tocca: se
//!   può stare sotto il cammino, una nota ([`NoteCode::InkKept`]) lo dice.

use std::collections::HashSet;

use fub_ink_codec::{cut_brush, ink_samples, split_ink, split_work, Ink, InkBrush, InkPiece, Spot};
use serde::{de, Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::draw::OnTarget;
use super::{refuse, Compiler, NoteCode, OpError};
use crate::ink::{
    DrawnStroke, InkAnchor, InkFit, InkLayer, InkStroke, LayerRef, StrokeState, INK_KEY,
    INK_MAX_BYTES,
};
use crate::layout::Rect;
use crate::model::CanvasNode;
use crate::patch::CanvasPatch;

/// Quanti punti al più ha il cammino di `erase_along`: quanti ne ha un tratto.
pub const MAX_ERASE_POINTS: usize = fub_ink_codec::ink::INK_MAX_SAMPLES;

/// Quante distanze al più calcola un `erase_along`, sommate su tutti i tratti
/// ([`split_work`]). Un passaggio della gomma sulla tela ne fa qualche
/// migliaio; oltre, un cammino troppo fine su tratti lunghi fermerebbe il
/// nucleo, e si rifiuta.
pub const MAX_ERASE_WORK: f64 = 50_000_000.0;

/// Gli argomenti di `erase_along`: il cammino, la sua larghezza e dove.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EraseAlongArgs {
    /// I punti del cammino, `[x, y]`, nelle coordinate di `on`.
    pub points: Vec<Vec<f64>>,
    /// La larghezza della gomma, nelle coordinate di `on`: il cerchio ha
    /// raggio `size / 2`.
    #[serde(deserialize_with = "eraser_size")]
    pub size: f64,
    /// `"auto"` (di serie), `"board"` o l'id di una scheda.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
    /// La proporzione (larghezza su altezza) del contenuto che la scheda di
    /// `on` mostra, se chi scrive la sa, come in `move_strokes`: solo con `on`
    /// sull'id di una scheda. Non si scrive nel file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect: Option<f64>,
}

/// Se `size` è una larghezza che `erase_along` accetta: un numero maggiore di
/// zero.
pub fn is_eraser_size(size: f64) -> bool {
    size.is_finite() && size > 0.0
}

fn eraser_size<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    let size = f64::deserialize(deserializer)?;
    if is_eraser_size(size) {
        Ok(size)
    } else {
        Err(de::Error::custom(format_args!(
            "{size} is not a size greater than zero"
        )))
    }
}

/// Un livello da guardare: dove sta, chi lo tiene e dove comincia.
struct Holder<'a> {
    layer: LayerRef,
    /// La scheda che tiene il livello; `None` per la radice.
    node: Option<&'a CanvasNode>,
    /// Il valore della chiave `fub:ink`, se c'è.
    value: Option<&'a Value>,
    /// L'angolo della scheda nelle coordinate del cammino: quello sulla
    /// lavagna con `auto`, 0,0 con `on` sulla scheda.
    origin: (f64, f64),
    /// La proporzione del contenuto della scheda, se `on` è lei e si sa.
    aspect: Option<f64>,
}

/// Un tratto tagliato: dove stava e i pezzi che lo sostituiscono, ancora senza
/// id.
struct StrokeCut {
    at: usize,
    before: InkStroke,
    pieces: Vec<InkStroke>,
}

/// I tagli di un livello, nell'ordine dei tratti, e gli id che ha.
struct LayerCut {
    layer: LayerRef,
    taken: HashSet<String>,
    cuts: Vec<StrokeCut>,
}

/// Il riquadro del cammino, allargato del raggio.
#[derive(Copy, Clone)]
struct Area {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Area {
    fn around(points: impl IntoIterator<Item = [f64; 2]>, margin: f64) -> Area {
        let mut area = Area {
            min_x: f64::INFINITY,
            min_y: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            max_y: f64::NEG_INFINITY,
        };
        for [x, y] in points {
            area.min_x = area.min_x.min(x - margin);
            area.min_y = area.min_y.min(y - margin);
            area.max_x = area.max_x.max(x + margin);
            area.max_y = area.max_y.max(y + margin);
        }
        area
    }

    fn meets(&self, other: &Area) -> bool {
        self.min_x <= other.max_x
            && other.min_x <= self.max_x
            && self.min_y <= other.max_y
            && other.min_y <= self.max_y
    }

    fn of_rect(rect: &Rect) -> Area {
        Area {
            min_x: rect.x,
            min_y: rect.y,
            max_x: rect.x + rect.width,
            max_y: rect.y + rect.height,
        }
    }
}

impl Compiler {
    /// `erase_along`: i tagli di ogni tratto toccato, poi le toppe livello per
    /// livello.
    pub(super) fn erase_along(
        &mut self,
        index: usize,
        args: &EraseAlongArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let path = path_points(index, &args.points)?;
        let radius = args.size / 2.0;
        let (layers, notes) =
            self.erase_cuts(index, (args.on.as_deref(), args.aspect), &path, radius)?;
        for detail in notes {
            self.note(index, NoteCode::InkKept, detail);
        }
        let mut patches = Vec::new();
        for layer in layers {
            patches.extend(self.cut_patches(layer));
        }
        Ok(patches)
    }

    /// Che cosa taglia il cammino `path`, largo `radius`, livello per livello,
    /// e le note di ciò che non si taglia. Non cambia niente.
    fn erase_cuts(
        &self,
        index: usize,
        (on, aspect): (Option<&str>, Option<f64>),
        path: &[Spot],
        radius: f64,
    ) -> Result<(Vec<LayerCut>, Vec<String>), OpError> {
        let target = self.on_target(index, on)?;
        // Con `auto` il cammino passa su più schede, ognuna col suo contenuto:
        // una proporzione sola non direbbe di quale.
        if aspect.is_some() && !matches!(target, OnTarget::Card(_)) {
            return Err(OpError::Invalid {
                index,
                reason: "`aspect` needs `on` set to the id of a node".to_owned(),
            });
        }
        let board = Holder {
            layer: LayerRef::Board,
            node: None,
            value: self.working.extra.get(INK_KEY),
            origin: (0.0, 0.0),
            aspect: None,
        };
        let holders: Vec<Holder<'_>> = match target {
            OnTarget::Auto => self
                .working
                .nodes
                .iter()
                .filter(|node| node.extra.contains_key(INK_KEY))
                .map(|node| {
                    let rect = Rect::of_node(node);
                    Holder::card(node, (rect.x, rect.y), None)
                })
                .chain(std::iter::once(board))
                .collect(),
            OnTarget::Board => vec![board],
            OnTarget::Card(node) => vec![Holder::card(node, (0.0, 0.0), aspect)],
        };
        let area = Area::around(path.iter().copied(), radius);
        let mut layers = Vec::new();
        let mut notes = Vec::new();
        let mut work = 0.0;
        for holder in &holders {
            let Some(value) = holder.value else {
                continue;
            };
            let Ok(ink) = InkLayer::from_value(value) else {
                if matches!(target, OnTarget::Card(_)) {
                    return Err(OpError::ForeignLayer {
                        index,
                        layer: holder.layer.clone(),
                    });
                }
                if holder.may_hold(&area, None) {
                    notes.push(format!(
                        "the ink layer of {} is foreign, so it is not cut",
                        holder.name()
                    ));
                }
                continue;
            };
            let mut cuts = Vec::new();
            for (at, stroke) in ink.strokes.iter().enumerate() {
                let drawn = match stroke.state(&holder.layer) {
                    StrokeState::Drawn(drawn) => drawn,
                    StrokeState::Kept(reason) => {
                        if holder.may_hold(&area, Some(stroke)) {
                            notes.push(format!(
                                "stroke {:?} of {} is not drawn ({}), so it is not cut",
                                stroke.id,
                                holder.name(),
                                reason.as_str()
                            ));
                        }
                        continue;
                    }
                };
                if let Some(kind) = unplaced(&drawn) {
                    if holder.may_hold(&area, Some(stroke)) {
                        notes.push(format!(
                            "stroke {:?} of {} is anchored to a {kind}, and where the {kind} is shown in the card is known only to the renderer, so it is not cut",
                            stroke.id,
                            holder.name(),
                        ));
                    }
                    continue;
                }
                if let Some(pieces) = holder.cut(index, &drawn, path, radius, &mut work)? {
                    cuts.push(StrokeCut {
                        at,
                        before: stroke.clone(),
                        pieces: piece_records(stroke, &drawn, &pieces),
                    });
                }
            }
            if !cuts.is_empty() {
                layers.push(LayerCut {
                    layer: holder.layer.clone(),
                    taken: ink.strokes.iter().map(|stroke| stroke.id.clone()).collect(),
                    cuts,
                });
            }
        }
        Ok((layers, notes))
    }

    /// Le toppe di un livello: prima si tolgono i tratti tagliati dall'ultimo
    /// al primo (ognuno col posto che ha nel file), poi si mettono i pezzi dal
    /// primo all'ultimo dove stava il loro tratto. Gli id dei pezzi vengono
    /// dal seme e saltano quelli del livello. È `cutStrokePatches` della tela.
    fn cut_patches(&mut self, layer: LayerCut) -> Vec<CanvasPatch> {
        let LayerCut {
            layer,
            mut taken,
            cuts,
        } = layer;
        let mut patches: Vec<CanvasPatch> = cuts
            .iter()
            .rev()
            .map(|cut| CanvasPatch::Ink {
                layer: layer.clone(),
                at: cut.at,
                before: Some(cut.before.clone()),
                after: None,
            })
            .collect();
        // Dove va il primo pezzo del tratto `k`: il suo posto, meno i tratti
        // tolti prima di lui, più i pezzi già messi.
        let mut inserted = 0;
        for (k, cut) in cuts.into_iter().enumerate() {
            let first = cut.at - k + inserted;
            inserted += cut.pieces.len();
            for (position, mut piece) in (first..).zip(cut.pieces) {
                let id = loop {
                    let id = self.ids.next_id();
                    if !taken.contains(&id) {
                        break id;
                    }
                };
                taken.insert(id.clone());
                self.created.push(id.clone());
                piece.id = id;
                patches.push(CanvasPatch::Ink {
                    layer: layer.clone(),
                    at: position,
                    before: None,
                    after: Some(piece),
                });
            }
        }
        patches
    }
}

impl<'a> Holder<'a> {
    /// Il livello della scheda `node`, col suo angolo in `origin`.
    fn card(node: &'a CanvasNode, origin: (f64, f64), aspect: Option<f64>) -> Holder<'a> {
        Holder {
            layer: LayerRef::Node(node.id.clone()),
            node: Some(node),
            value: node.extra.get(INK_KEY),
            origin,
            aspect,
        }
    }

    /// Come si nomina il livello in una nota.
    fn name(&self) -> String {
        match &self.layer {
            LayerRef::Board => "the board".to_owned(),
            LayerRef::Node(id) => format!("node {id:?}"),
        }
    }

    /// Se il livello, o il tratto `stroke` che non si disegna, può stare sotto
    /// il cammino: per una scheda, se il cammino tocca la scheda; per la
    /// radice, se tocca i punti del tratto, quando si leggono, e sempre
    /// altrimenti.
    fn may_hold(&self, area: &Area, stroke: Option<&InkStroke>) -> bool {
        if let Some(node) = self.node {
            let rect = Rect::of_node(node);
            let rect = Rect {
                x: self.origin.0,
                y: self.origin.1,
                ..rect
            };
            return area.meets(&Area::of_rect(&rect));
        }
        let ink = stroke
            .and_then(|stroke| stroke.ink.as_ref())
            .and_then(Value::as_str)
            .filter(|text| text.len() <= INK_MAX_BYTES)
            .and_then(|text| Ink::decode(text).ok());
        match ink {
            Some(ink) => area.meets(&Area::around((0..ink.len()).map(|i| ink.point(i)), 0.0)),
            None => true,
        }
    }

    /// Il taglio del tratto `drawn` di questo livello: i pezzi che restano,
    /// vuoto se il cammino lo copre tutto, `None` se non lo tocca. Il lavoro si
    /// somma in `work` e non passa [`MAX_ERASE_WORK`].
    fn cut(
        &self,
        index: usize,
        drawn: &DrawnStroke,
        path: &[Spot],
        radius: f64,
        work: &mut f64,
    ) -> Result<Option<Vec<InkPiece>>, OpError> {
        // Come `erasableInk` e `cutInk`: lo spostamento della resa si somma
        // all'angolo della scheda, e il cammino torna nelle unità del tratto.
        // Un tratto di pagina o di cella non arriva qui ([`unplaced`]): senza
        // misura non si taglia.
        let Some(fit) = InkFit::of(self.node, &drawn.anchor, self.aspect) else {
            return Ok(None);
        };
        if fit.s.is_nan() || fit.s <= 0.0 {
            return Ok(None);
        }
        let (fx, fy) = (self.origin.0 + fit.dx, self.origin.1 + fit.dy);
        let local: Vec<Spot> = path
            .iter()
            .map(|&[x, y]| [(x - fx) / fit.s, (y - fy) / fit.s])
            .collect();
        let reach = radius / fit.s + brush_size(&drawn.brush) / 2.0;
        let samples = ink_samples(&drawn.ink);
        *work += split_work(&samples, &local, reach);
        // Un conto `NaN` si rifiuta anche lui.
        if work.is_nan() || *work > MAX_ERASE_WORK {
            return Err(refuse(
                index,
                "the eraser path is too fine for these strokes: use a larger `size` or split the path",
            ));
        }
        Ok(split_ink(&samples, &local, reach))
    }
}

/// `"page"` o `"cell"` per un tratto attaccato alla pagina di un PDF o alla
/// cella di un foglio: il nucleo non sa dove la scheda li mostra (la pagina
/// che si vede, il riquadro della cella), e la gomma in codice non li taglia.
/// `None` per gli altri tratti.
fn unplaced(drawn: &DrawnStroke) -> Option<&'static str> {
    match drawn.anchor {
        InkAnchor::Page { .. } => Some("page"),
        InkAnchor::Cell { .. } => Some("cell"),
        InkAnchor::Card { .. } | InkAnchor::Free => None,
    }
}

/// Lo spessore del pennello, in unità dell'ancora.
fn brush_size(brush: &InkBrush) -> f64 {
    match brush {
        InkBrush::Pf1(brush) => brush.size,
        InkBrush::Nib1(brush) => brush.size,
    }
}

/// I tratti dei pezzi `pieces` del tratto `stroke`, ancora senza id: i campi
/// del tratto, `at` spostato all'inizio del pezzo, il pennello tagliato (il
/// testo di prima se il pezzo ha i due capi del tratto) e il suo `ink` nella
/// stessa scala. Se un pezzo non si scrive, nessuno: il tratto si toglie
/// intero, come nella tela.
fn piece_records(stroke: &InkStroke, drawn: &DrawnStroke, pieces: &[InkPiece]) -> Vec<InkStroke> {
    let record = |piece: &InkPiece| -> Option<InkStroke> {
        let brush = if piece.cut_start || piece.cut_end {
            Some(Value::String(
                cut_brush(&drawn.brush, piece.cut_start, piece.cut_end)
                    .encode()
                    .ok()?,
            ))
        } else {
            stroke.brush.clone()
        };
        let ink = Ink::quantize(&piece.samples, drawn.ink.scale()).ok()?;
        let at = match &stroke.at {
            Some(Value::String(at)) => Some(Value::String(
                shifted_at(at, piece.offset).unwrap_or_else(|| at.clone()),
            )),
            other => other.clone(),
        };
        Some(InkStroke {
            id: String::new(),
            at,
            brush,
            ink: Some(Value::String(ink.encode())),
            ..stroke.clone()
        })
    };
    pieces
        .iter()
        .map(record)
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default()
}

/// I punti del cammino: `[x, y]`, almeno uno, al più [`MAX_ERASE_POINTS`].
fn path_points(index: usize, points: &[Vec<f64>]) -> Result<Vec<Spot>, OpError> {
    if points.is_empty() {
        return Err(refuse(index, "`points` is empty"));
    }
    if points.len() > MAX_ERASE_POINTS {
        return Err(OpError::TooMany {
            index,
            what: "points in an eraser path",
            limit: MAX_ERASE_POINTS,
        });
    }
    points
        .iter()
        .enumerate()
        .map(|(at, point)| match point.as_slice() {
            [x, y] => Ok([*x, *y]),
            _ => Err(refuse(index, format!("point {at}: a point is [x, y]"))),
        })
        .collect()
}

/// I millisecondi di un giorno.
const DAY_MS: i64 = 86_400_000;

/// `at` spostato di `offset` millisecondi, come `shiftedAt` della tela:
/// `None` se resta com'è, cioè se non si legge, se `offset` è zero o se
/// l'esito esce dagli anni 0–9999. Un `offset` che non è zero ma arrotonda a
/// zero riscrive `at` nella forma di `toISOString`, come la tela.
///
/// `Date.parse` legge molte forme; il nucleo, che non ha un fuso orario, legge
/// quelle che non ne dipendono: una data ISO 8601 `YYYY-MM-DD`, da sola (la
/// mezzanotte UTC) o con `THH:MM`, i secondi e le frazioni facoltativi, e il
/// fuso `Z` o `±HH:MM`. L'esito è nella forma di `toISOString`, coi
/// millisecondi e `Z`, fra gli anni 0 e 9999.
fn shifted_at(at: &str, offset: f64) -> Option<String> {
    let time = parse_iso(at)?;
    if offset == 0.0 {
        return None;
    }
    let shift = js_round(offset);
    if !shift.is_finite() || shift.abs() > 8.64e15 {
        return None;
    }
    // Entro ±8,64·10¹⁵ ms, i limiti di `Date`: il cast è esatto.
    #[allow(clippy::cast_possible_truncation)]
    let shifted = time.checked_add(shift as i64)?;
    format_iso(shifted)
}

/// `Math.round`: al più vicino, e a metà verso l'alto.
fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// I giorni dal 1970-01-01 della data `year-month-day` (calendario
/// gregoriano prolettico).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// La data dei giorni `days` dal 1970-01-01: anno, mese e giorno.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Le cifre `text[from..from + len]` come numero, se sono tutte cifre ASCII.
fn digits(text: &[u8], from: usize, len: usize) -> Option<i64> {
    let part = text.get(from..from + len)?;
    part.iter().try_fold(0_i64, |value, &byte| {
        byte.is_ascii_digit()
            .then(|| value * 10 + i64::from(byte - b'0'))
    })
}

/// I millisecondi dal 1970 di una data ISO 8601 nelle forme di [`shifted_at`].
fn parse_iso(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let year = digits(bytes, 0, 4)?;
    let month = digits(bytes, 5, 2)?;
    let day = digits(bytes, 8, 2)?;
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    let date = days_from_civil(year, month, day) * DAY_MS;
    if bytes.len() == 10 {
        return Some(date);
    }
    if bytes.get(10) != Some(&b'T') || bytes.get(13) != Some(&b':') {
        return None;
    }
    let hour = digits(bytes, 11, 2)?;
    let minute = digits(bytes, 14, 2)?;
    let mut at = 16;
    let mut second = 0;
    let mut millis = 0;
    if bytes.get(at) == Some(&b':') {
        second = digits(bytes, at + 1, 2)?;
        at += 3;
        if bytes.get(at) == Some(&b'.') {
            at += 1;
            let start = at;
            while bytes.get(at).is_some_and(u8::is_ascii_digit) {
                at += 1;
            }
            if at == start {
                return None;
            }
            // I primi tre decimali sono i millisecondi; gli altri si tagliano.
            let taken = (at - start).min(3);
            let scale = [100, 10, 1][taken - 1];
            millis = digits(bytes, start, taken)? * scale;
        }
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let zone = match bytes.get(at..)? {
        b"Z" => 0,
        [sign @ (b'+' | b'-'), ..] if bytes.len() == at + 6 && bytes[at + 3] == b':' => {
            let hours = digits(bytes, at + 1, 2)?;
            let minutes = digits(bytes, at + 4, 2)?;
            if hours > 23 || minutes > 59 {
                return None;
            }
            let minutes = hours * 60 + minutes;
            if *sign == b'+' {
                minutes
            } else {
                -minutes
            }
        }
        _ => return None,
    };
    Some(date + ((hour * 60 + minute - zone) * 60 + second) * 1000 + millis)
}

/// I millisecondi `time` dal 1970 come `toISOString`, fra gli anni 0 e 9999.
fn format_iso(time: i64) -> Option<String> {
    let days = time.div_euclid(DAY_MS);
    let rest = time.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    if !(0..=9999).contains(&year) {
        return None;
    }
    let (hour, rest) = (rest / 3_600_000, rest % 3_600_000);
    let (minute, rest) = (rest / 60_000, rest % 60_000);
    let (second, millis) = (rest / 1000, rest % 1000);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn at_si_sposta_come_to_iso_string() {
        let at = "2026-11-02T09:20:31.250Z";
        assert_eq!(
            shifted_at(at, 55.0).as_deref(),
            Some("2026-11-02T09:20:31.305Z")
        );
        // Arrotondato come `Math.round`: a metà verso l'alto.
        assert_eq!(
            shifted_at(at, 0.5).as_deref(),
            Some("2026-11-02T09:20:31.251Z")
        );
        assert_eq!(shifted_at(at, 0.0), None);
        // Non zero ma arrotonda a zero: la tela riscrive `at` con
        // `toISOString`, coi millisecondi.
        assert_eq!(
            shifted_at(at, 0.49999999999999994).as_deref(),
            Some("2026-11-02T09:20:31.250Z")
        );
        assert_eq!(
            shifted_at("2026-11-02T10:20:31.25+01:00", 0.2).as_deref(),
            Some("2026-11-02T09:20:31.250Z")
        );
        assert_eq!(
            shifted_at("2026-11-02", 0.2).as_deref(),
            Some("2026-11-02T00:00:00.000Z")
        );
        // Attraverso la mezzanotte, il mese e l'anno bisestile.
        assert_eq!(
            shifted_at("2024-02-28T23:59:59.999Z", 1.0).as_deref(),
            Some("2024-02-29T00:00:00.000Z")
        );
        assert_eq!(
            shifted_at("2023-12-31T23:59:59.500Z", 600.0).as_deref(),
            Some("2024-01-01T00:00:00.100Z")
        );
    }

    #[test]
    fn at_legge_le_forme_senza_fuso_locale() {
        assert_eq!(
            shifted_at("2026-11-02", 8.0).as_deref(),
            Some("2026-11-02T00:00:00.008Z")
        );
        assert_eq!(
            shifted_at("2026-11-02T10:20+01:00", 8.0).as_deref(),
            Some("2026-11-02T09:20:00.008Z")
        );
        assert_eq!(
            shifted_at("2026-11-02T09:20:31.2509Z", 1.0).as_deref(),
            Some("2026-11-02T09:20:31.251Z")
        );
        assert_eq!(
            shifted_at("2026-11-02T09:20:31Z", 1000.0).as_deref(),
            Some("2026-11-02T09:20:32.000Z")
        );
        // Un'ora senza fuso dipende dal fuso della macchina: resta com'è.
        for kept in [
            "2026-11-02T09:20:31",
            "ieri",
            "2026-13-01",
            "2026-02-30",
            "2026-11-02T24:00:00Z",
            "2026-11-02T09:20:31.Z",
            "",
        ] {
            assert_eq!(shifted_at(kept, 8.0), None, "{kept:?}");
        }
    }

    #[test]
    fn i_giorni_vanno_e_tornano() {
        for days in [-719_468, -1, 0, 1, 19_000, 2_932_896] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    use crate::ops::{compile, CanvasOp, Compiled};
    use serde_json::json;

    const BALL: &str = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";

    fn board(value: &Value) -> crate::Canvas {
        crate::parse(&value.to_string()).expect("una lavagna valida")
    }

    fn run(canvas: &crate::Canvas, op: Value) -> Result<Compiled, OpError> {
        let ops: Vec<CanvasOp> = serde_json::from_value(json!([op])).expect("si legge");
        compile(canvas, &ops, 0)
    }

    fn free(id: &str, brush: &str, ink: &str) -> Value {
        json!({"id": id, "tool": "pen", "brush": brush, "color": "#0072b2",
               "anchor": {"kind": "free"}, "ink": ink})
    }

    #[test]
    fn oltre_diecimila_punti_e_too_many() {
        let canvas = board(&json!({"nodes": [], "edges": []}));
        let points: Vec<[f64; 2]> = (0..=MAX_ERASE_POINTS).map(|i| [i as f64, 0.0]).collect();
        let error = run(
            &canvas,
            json!({"op": "erase_along", "points": points, "size": 4}),
        )
        .expect_err("10 001 punti non entrano");
        assert!(
            matches!(error, OpError::TooMany { index: 0, limit, .. } if limit == MAX_ERASE_POINTS),
            "{error:?}"
        );
        let points = &points[..MAX_ERASE_POINTS];
        run(
            &canvas,
            json!({"op": "erase_along", "points": points, "size": 4}),
        )
        .expect("10 000 punti entrano");
    }

    #[test]
    fn il_tratto_che_non_si_legge_resta_e_la_nota_lo_dice() {
        let canvas = board(&json!({
            "nodes": [{"id": "t1", "type": "text", "text": "t", "x": 0, "y": 0,
                       "width": 100, "height": 100, "fub:ink": {"v": 2, "strokes": []}}],
            "edges": [],
            "fub:ink": {"v": 1, "strokes": [free("rotto", BALL, "non è inchiostro")]}
        }));
        let compiled = run(
            &canvas,
            json!({"op": "erase_along", "points": [[50, 50], [60, 50]], "size": 8}),
        )
        .expect("con auto non è un errore");
        assert!(compiled.patches.is_empty());
        let details: Vec<&str> = compiled
            .notes
            .iter()
            .map(|note| {
                assert_eq!(note.code, NoteCode::InkKept);
                note.detail.as_str()
            })
            .collect();
        assert_eq!(details.len(), 2, "{details:?}");
        assert!(details[0].contains("node \"t1\" is foreign"), "{details:?}");
        assert!(details[1].contains("stroke \"rotto\""), "{details:?}");
    }

    #[test]
    fn la_nota_non_c_e_lontano_dal_cammino() {
        let canvas = board(&json!({
            "nodes": [{"id": "t1", "type": "text", "text": "t", "x": 500, "y": 500,
                       "width": 100, "height": 100, "fub:ink": {"v": 2, "strokes": []}}],
            "edges": [],
            "fub:ink": {"v": 1, "strokes": [free("lontano", "pf1 size=-1", "1 s100 cxy 90000,90000")]}
        }));
        let compiled = run(
            &canvas,
            json!({"op": "erase_along", "points": [[0, 0]], "size": 8}),
        )
        .expect("si compila");
        assert!(
            compiled.patches.is_empty() && compiled.notes.is_empty(),
            "{:?}",
            compiled.notes
        );
    }

    #[test]
    fn un_cammino_troppo_fine_su_un_tratto_lungo_si_rifiuta() {
        // Un tratto di un milione di unità in un segmento: ogni passo di un
        // quarto dello spessore conta, per ognuno dei segmenti vicini.
        let canvas = board(&json!({
            "nodes": [], "edges": [],
            "fub:ink": {"v": 1, "strokes": [free("lungo", BALL, "1 s100 cxy 0,0 100000000,0")]}
        }));
        let points: Vec<[f64; 2]> = (0..200).map(|i| [f64::from(i) * 10.0, 0.0]).collect();
        let error = run(
            &canvas,
            json!({"op": "erase_along", "points": points, "size": 1}),
        )
        .expect_err("troppo lavoro");
        assert!(
            matches!(error, OpError::Invalid { index: 0, .. }),
            "{error:?}"
        );
        let few = &points[..2];
        run(
            &canvas,
            json!({"op": "erase_along", "points": few, "size": 1}),
        )
        .expect("due punti vanno bene");
    }

    #[test]
    fn un_raggio_che_arrotonda_a_zero_finisce_subito() {
        // Lo scenario della revisione: lo spessore e la gomma più piccoli che
        // un f64 dice. Il passo del taglio arrotonda a zero, e due campioni
        // uguali darebbero 0 / 0: il taglio non si fa, e il tetto resta acceso.
        let canvas = board(&json!({
            "nodes": [], "edges": [],
            "fub:ink": {"v": 1, "strokes": [free("s", "pf1 size=1e-323", "1 s100 cxy 0,0 0,0 1000,0")]}
        }));
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let outcome = run(
                &canvas,
                json!({"op": "erase_along", "points": [[0, 0]], "size": 5e-324}),
            );
            let _ = send.send(outcome);
        });
        let outcome = receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("erase_along finisce subito");
        let compiled = outcome.expect("si compila");
        assert!(compiled.patches.is_empty(), "{:?}", compiled.patches);
        // Il tratto si disegna (nessuna nota `ink_kept`): il caso arriva al taglio.
        assert!(compiled.notes.is_empty(), "{:?}", compiled.notes);
    }

    /// Un tratto di pagina o di cella non si taglia: dove la scheda mostra la
    /// pagina o la cella lo sa solo la resa. Se il cammino passa sulla scheda,
    /// la nota `ink_kept` lo dice, con l'ancora; se no, niente nota.
    #[test]
    fn il_tratto_di_pagina_o_di_cella_resta_e_la_nota_lo_dice() {
        let anchored = |id: &str, anchor: Value| {
            json!({"id": id, "tool": "pen", "brush": BALL, "color": "#0072b2",
                   "anchor": anchor, "ink": "1 s100 cxy 1000,1000 4000,0"})
        };
        let canvas = board(&json!({
            "nodes": [
                {"id": "p1", "type": "file", "file": "Corsi/dispensa.pdf", "x": 0, "y": 0,
                 "width": 300, "height": 400, "fub:ink": {"v": 1, "strokes": [
                     anchored("sp", json!({"kind": "page", "page": 2, "width": 595, "height": 842}))]}},
                {"id": "x1", "type": "file", "file": "Corsi/voti.xlsx", "x": 1000, "y": 0,
                 "width": 300, "height": 200, "fub:ink": {"v": 1, "strokes": [
                     anchored("sc", json!({"kind": "cell", "sheet": "Foglio1", "cell": "B3"}))]}}
            ],
            "edges": []
        }));
        for (on, id, kind) in [("p1", "sp", "page"), ("x1", "sc", "cell")] {
            let compiled = run(
                &canvas,
                json!({"op": "erase_along", "on": on, "points": [[10, 10], [50, 10]], "size": 40}),
            )
            .expect("non è un errore");
            assert!(compiled.patches.is_empty(), "{on}: {:?}", compiled.patches);
            assert_eq!(compiled.notes.len(), 1, "{on}: {:?}", compiled.notes);
            assert_eq!(compiled.notes[0].code, NoteCode::InkKept);
            let detail = &compiled.notes[0].detail;
            assert!(
                detail.contains(&format!("stroke \"{id}\""))
                    && detail.contains(&format!("anchored to a {kind}")),
                "{detail}"
            );
        }
        // Con `auto` lontano dalle due schede: nessuna nota.
        let far = run(
            &canvas,
            json!({"op": "erase_along", "points": [[600, 600]], "size": 4}),
        )
        .expect("non è un errore");
        assert!(
            far.patches.is_empty() && far.notes.is_empty(),
            "{:?}",
            far.notes
        );
    }

    /// `aspect` è la proporzione del contenuto della scheda di `on`, come in
    /// `move_strokes`: sull'immagine 600 × 200 con un tratto disegnato a
    /// 300 × 300 e un contenuto 2:1, il tratto a x = 30 sta a x = 140 della
    /// scheda; senza, a x = 220. Con `auto` o `board` non vale.
    #[test]
    fn la_proporzione_del_contenuto_sposta_il_taglio() {
        let canvas = board(&json!({
            "nodes": [{"id": "f1", "type": "file", "file": "Foto/lavagna.png", "x": 0, "y": 0,
                       "width": 600, "height": 200, "fub:ink": {"v": 1, "strokes": [
                {"id": "s1", "tool": "pen", "brush": BALL, "color": "#0072b2",
                 "anchor": {"kind": "card", "width": 300, "height": 300},
                 "ink": "1 s100 cxy 3000,10000 0,10000"}]}}],
            "edges": []
        }));
        let erase = |x: f64, aspect: Option<f64>| {
            let mut op = json!({"op": "erase_along", "on": "f1",
                                "points": [[x, -1000], [x, 1000]], "size": 4});
            if let Some(aspect) = aspect {
                op["aspect"] = json!(aspect);
            }
            run(&canvas, op).expect("si compila").patches.len()
        };
        assert_eq!(erase(140.0, None), 0, "senza proporzione il tratto è a 220");
        assert!(erase(220.0, None) > 0);
        assert!(erase(140.0, Some(2.0)) > 0, "con 2:1 il tratto è a 140");
        assert_eq!(erase(220.0, Some(2.0)), 0);
        // Una proporzione che non vale dà la regola senza.
        assert!(erase(220.0, Some(-1.0)) > 0);
        for on in [None, Some("board")] {
            let mut op = json!({"op": "erase_along", "points": [[140, 0]], "size": 4, "aspect": 2});
            if let Some(on) = on {
                op["on"] = json!(on);
            }
            let error = run(&canvas, op).expect_err("aspect senza una scheda");
            assert!(
                matches!(error, OpError::Invalid { index: 0, .. }),
                "{error:?}"
            );
        }
    }
}
