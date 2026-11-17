//! Scegliere la faccia: l'algoritmo dei CSS su peso, stile e larghezza fra
//! le facce di una famiglia.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

#[cfg(test)]
use super::describe::Generic;
use super::describe::{Coordinate, Face, Slot, Style};

// --- scegliere ---------------------------------------------------------------

/// Che faccia si cerca: il peso da 1 a 1000, lo stile e la larghezza in
/// percentuale.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub(crate) struct Request {
    pub weight: f64,
    pub style: Style,
    pub stretch: f64,
}

impl Request {
    /// Il tondo normale: è la faccia che dice la famiglia generica.
    pub(crate) const REGULAR: Request = Request {
        weight: 400.0,
        style: Style::Normal,
        stretch: 100.0,
    };
}

/// La faccia scelta: il file, la faccia nel file e i punti degli assi.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Choice {
    pub file: usize,
    pub face: usize,
    pub coordinates: Vec<Coordinate>,
}

/// Una faccia possibile: una faccia con uno dei suoi stili.
struct Candidate<'f> {
    file: usize,
    face: usize,
    item: &'f Face,
    slot: &'f Slot,
}

/// Sceglie fra le facce di `files`, nell'ordine dato, quella della famiglia
/// `family` che i CSS sceglierebbero per `request` (CSS Fonts 4, §5.2): prima
/// la larghezza, poi lo stile, poi il peso, con un carattere variabile che
/// vale per tutto l'intervallo dei suoi assi. A pari merito vince una faccia
/// statica, poi l'ordine dei file e delle facce. Le famiglie di Fub non si
/// scelgono qui. Il client fa la stessa scelta, e i vettori di
/// `__fixtures__/scene-fonts/choose.json` provano tutti e due.
pub(crate) fn choose(files: &[&[Face]], family: &str, request: &Request) -> Option<Choice> {
    pick(files, family, request, false)
}

/// La stessa scelta fra i caratteri di Fub, per l'export.
pub(crate) fn choose_reserved(
    files: &[&[Face]],
    family: &str,
    request: &Request,
) -> Option<Choice> {
    pick(files, family, request, true)
}

fn pick(files: &[&[Face]], family: &str, request: &Request, reserved: bool) -> Option<Choice> {
    let mut candidates: Vec<Candidate> = Vec::new();
    for (file, faces) in files.iter().enumerate() {
        for (face, item) in faces.iter().enumerate() {
            if !item.is_called(family) || item.is_reserved() != reserved {
                continue;
            }
            for slot in &item.styles {
                candidates.push(Candidate {
                    file,
                    face,
                    item,
                    slot,
                });
            }
        }
    }
    keep_best(&mut candidates, |each| {
        stretch_key(each.item.stretch, request.stretch)
    });
    keep_best(&mut candidates, |each| {
        (style_rank(each.slot.style, request.style), 0.0)
    });
    keep_best(&mut candidates, |each| {
        weight_key(each.item.weight, request.weight)
    });
    let best = candidates
        .iter()
        .find(|each| each.item.axes.is_empty())
        .or_else(|| candidates.first())?;
    let mut coordinates = Vec::new();
    for axis in &best.item.axes {
        let value = match axis.tag.as_str() {
            "wght" => Some(request.weight.clamp(axis.min, axis.max)),
            "wdth" => Some(request.stretch.clamp(axis.min, axis.max)),
            tag => best
                .slot
                .fixed
                .iter()
                .find(|each| each.tag == tag)
                .map(|each| each.value),
        };
        if let Some(value) = value {
            coordinates.push(Coordinate {
                tag: axis.tag.clone(),
                value,
            });
        }
    }
    Some(Choice {
        file: best.file,
        face: best.face,
        coordinates,
    })
}

/// La famiglia generica di una famiglia del vault: quella del suo tondo
/// normale, o della faccia che lo sostituisce. È la regola con cui il client
/// scrive la famiglia generica dopo quella del vault; l'export la legge dal
/// testo, e qui la provano i vettori condivisi.
#[cfg(test)]
pub(crate) fn family_generic(files: &[&[Face]], family: &str) -> Option<Generic> {
    let choice = choose(files, family, &Request::REGULAR)?;
    Some(files[choice.file][choice.face].generic)
}

/// Tiene i candidati con la chiave più piccola, nell'ordine in cui erano.
fn keep_best<'f>(candidates: &mut Vec<Candidate<'f>>, key: impl Fn(&Candidate<'f>) -> (u8, f64)) {
    let Some(best) = candidates.iter().map(&key).min_by(compare) else {
        return;
    };
    candidates.retain(|each| compare(&key(each), &best) == Ordering::Equal);
}

fn compare(a: &(u8, f64), b: &(u8, f64)) -> Ordering {
    a.0.cmp(&b.0).then(a.1.total_cmp(&b.1))
}

/// Quanto un intervallo di larghezze è lontano da quella chiesta: fino al 100%
/// prima le più strette, dalla più vicina, poi le più larghe; oltre, il
/// contrario.
fn stretch_key([low, high]: [f64; 2], wanted: f64) -> (u8, f64) {
    if low <= wanted && wanted <= high {
        (0, 0.0)
    } else if wanted <= 100.0 {
        if high < wanted {
            (1, wanted - high)
        } else {
            (2, low - wanted)
        }
    } else if low > wanted {
        (1, low - wanted)
    } else {
        (2, wanted - high)
    }
}

/// Quanto uno stile è lontano da quello chiesto: il corsivo cerca il corsivo,
/// poi l'obliquo, poi il tondo; il tondo il tondo, poi l'obliquo, poi il
/// corsivo; l'obliquo l'obliquo, poi il corsivo, poi il tondo.
fn style_rank(style: Style, wanted: Style) -> u8 {
    let order = match wanted {
        Style::Italic => [Style::Italic, Style::Oblique, Style::Normal],
        Style::Normal => [Style::Normal, Style::Oblique, Style::Italic],
        Style::Oblique => [Style::Oblique, Style::Italic, Style::Normal],
    };
    order.iter().position(|each| *each == style).unwrap_or(3) as u8
}

/// Quanto un intervallo di pesi è lontano da quello chiesto: fra 400 e 500
/// prima i più neri fino a 500, poi i più chiari, poi i più neri oltre 500;
/// sotto 400 prima i più chiari; sopra 500 prima i più neri.
fn weight_key([low, high]: [f64; 2], wanted: f64) -> (u8, f64) {
    if low <= wanted && wanted <= high {
        (0, 0.0)
    } else if (400.0..=500.0).contains(&wanted) {
        if low > wanted && low <= 500.0 {
            (1, low - wanted)
        } else if high < wanted {
            (2, wanted - high)
        } else {
            (3, low - wanted)
        }
    } else if wanted < 400.0 {
        if high < wanted {
            (1, wanted - high)
        } else {
            (2, low - wanted)
        }
    } else if low > wanted {
        (1, low - wanted)
    } else {
        (2, wanted - high)
    }
}
