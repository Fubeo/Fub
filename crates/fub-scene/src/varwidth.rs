//! Lo spessore variabile, la forma sintetica di un contorno che si allarga e
//! si stringe (formato della scena, §6): un `path` con `fub:shape="width"` e
//! `fub:geom`, che porta gli estremi, gli angoli, il profilo delle larghezze
//! e la linea centrale.
//!
//! È la lettura di `varwidth.ts` della superficie, regola per regola: i casi
//! scritti a mano in `apps/client/src/__fixtures__/scene-width/cases.json`
//! valgono per tutte e due. Il `d`, il contorno pieno, lo calcola la
//! superficie, come per la freccia; qui basta sapere se la geometria si
//! legge. Un `fub:geom` fuori dalla grammatica lascia un tracciato qualunque,
//! che si legge da `d`.

use serde::Serialize;

use crate::geometry::{parse_path, Segment};
use crate::values::{is_wsp, number_list};

/// I punti del profilo, al meno.
pub const MIN_POINTS: usize = 2;
/// I punti del profilo, al più.
pub const MAX_POINTS: usize = 1000;

/// Come finisce il contorno ai capi di una linea centrale aperta.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WidthCap {
    Butt,
    Round,
    Square,
}

/// Come gira il contorno, dalla parte di fuori, negli spigoli della linea
/// centrale.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WidthJoin {
    Miter,
    Round,
    Bevel,
}

/// Un contorno a spessore variabile, come lo porta `fub:geom`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VarWidth {
    pub cap: WidthCap,
    pub join: WidthJoin,
    /// I punti del profilo: dove stanno lungo la linea, da 0 a 1, e la
    /// larghezza a sinistra e a destra di chi la percorre sullo schermo.
    pub profile: Vec<[f64; 3]>,
    /// La linea centrale, com'è scritta: dati di un `path` con un
    /// sottotracciato solo.
    pub spine: String,
}

fn cap(word: &str) -> Option<WidthCap> {
    match word {
        "butt" => Some(WidthCap::Butt),
        "round" => Some(WidthCap::Round),
        "square" => Some(WidthCap::Square),
        _ => None,
    }
}

fn join(word: &str) -> Option<WidthJoin> {
    match word {
        "miter" => Some(WidthJoin::Miter),
        "round" => Some(WidthJoin::Round),
        "bevel" => Some(WidthJoin::Bevel),
        _ => None,
    }
}

/// Una parola di `text` da `i`, fino al primo spazio, e dove comincia ciò
/// che la segue dopo gli spazi; `None` se non la seguono spazi.
fn word(text: &str, i: usize) -> Option<(&str, usize)> {
    let bytes = text.as_bytes();
    let end = (i..bytes.len()).find(|&k| is_wsp(bytes[k]))?;
    let mut next = end;
    while next < bytes.len() && is_wsp(bytes[next]) {
        next += 1;
    }
    Some((&text[i..end], next))
}

/// Il profilo, se rispetta la grammatica: terne `t sinistra destra`, da due
/// a mille; `t` da 0 a 1 senza tornare indietro, il primo 0 e l'ultimo 1, al
/// più due uguali di fila e mai ai capi; larghezze non negative, e almeno
/// una positiva.
fn profile(text: &str) -> Option<Vec<[f64; 3]>> {
    let numbers = number_list(text)?;
    if numbers.len() % 3 != 0 {
        return None;
    }
    let points: Vec<[f64; 3]> = numbers.chunks(3).map(|p| [p[0], p[1], p[2]]).collect();
    let count = points.len();
    if !(MIN_POINTS..=MAX_POINTS).contains(&count) {
        return None;
    }
    if points[0][0] != 0.0 || points[count - 1][0] != 1.0 {
        return None;
    }
    if points[1][0] == 0.0 || points[count - 2][0] == 1.0 {
        return None;
    }
    let mut positive = false;
    for (k, &[t, left, right]) in points.iter().enumerate() {
        if !((0.0..=1.0).contains(&t) && left >= 0.0 && right >= 0.0) {
            return None;
        }
        positive |= left > 0.0 || right > 0.0;
        if k > 0 && t < points[k - 1][0] {
            return None;
        }
        if k > 1 && t == points[k - 1][0] && t == points[k - 2][0] {
            return None;
        }
    }
    positive.then_some(points)
}

/// Vero se `segments` sono un sottotracciato solo che disegna qualcosa:
/// una `M` in testa e nessun'altra, una `Z` al più in fondo, e un segmento
/// che va da qualche parte. Un arco coi capi uguali non disegna niente.
fn one_drawn_subpath(segments: &[Segment]) -> bool {
    let Some((Segment::Move(start), rest)) = segments.split_first() else {
        return false;
    };
    let mut current = *start;
    let mut drawn = false;
    for (k, segment) in rest.iter().enumerate() {
        let moves = match *segment {
            Segment::Move(_) => return false,
            Segment::Close => {
                if k + 1 != rest.len() {
                    return false;
                }
                *start != current
            }
            Segment::Line(to) | Segment::Arc { to, .. } => to != current,
            Segment::Quad(control, to) => control != current || to != current,
            Segment::Cubic(c1, c2, to) => c1 != current || c2 != current || to != current,
        };
        drawn |= moves;
        current = match *segment {
            Segment::Close => *start,
            Segment::Line(to)
            | Segment::Quad(_, to)
            | Segment::Cubic(_, _, to)
            | Segment::Arc { to, .. } => to,
            Segment::Move(_) => unreachable!(),
        };
    }
    drawn
}

/// La geometria di un `path` con `fub:shape="width"` e `fub:geom` `geom`;
/// `None` se `geom` è fuori dalla grammatica: gli estremi e gli angoli
/// seguiti da spazi, il profilo fino alla prima `M` o `m`, e da lì la linea
/// centrale, un sottotracciato solo che disegna qualcosa.
pub fn read_var_width(geom: &str) -> Option<VarWidth> {
    let bytes = geom.as_bytes();
    let mut i = 0;
    while i < bytes.len() && is_wsp(bytes[i]) {
        i += 1;
    }
    let (first, i) = word(geom, i)?;
    let (second, i) = word(geom, i)?;
    let (cap, join) = (cap(first)?, join(second)?);
    let at = i + geom[i..].find(['M', 'm'])?;
    let profile = profile(&geom[i..at])?;
    let spine = &geom[at..];
    if !one_drawn_subpath(&parse_path(spine)?) {
        return None;
    }
    Some(VarWidth {
        cap,
        join,
        profile,
        spine: spine.to_owned(),
    })
}
