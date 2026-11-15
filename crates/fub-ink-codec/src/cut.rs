//! La gomma che taglia: un tratto si taglia soltanto dove passa il cerchio.
//!
//! È `splitInk` e `cutBrush` di `apps/client/src/ink/tools/split.ts`, che fa
//! fede, portati riga per riga: le stesse operazioni sui numeri nello stesso
//! ordine, così un taglio fatto dal nucleo e uno fatto dalla tela danno gli
//! stessi pezzi. I casi in comune sono in
//! `apps/client/src/__fixtures__/ink-cut.json`, scritti a mano: li fanno
//! girare `tests/cut_vectors.rs` e `apps/client/src/ink/tools/split-vectors.test.ts`.
//!
//! La gomma percorre un cammino largo `radius` (una salsiccia: i punti a meno
//! di `radius` dal cammino). Un tratto che lo attraversa si divide in pezzi,
//! le parti fuori; ogni pezzo resta un tratto vero, coi suoi campioni. Ai
//! bordi del cammino nasce un campione nuovo, interpolato fra i due vicini
//! (posizione, pressione e tempo; inclinazione e azimut dal più vicino), così
//! il taglio cade dove passa il cerchio e non al campione dopo. Il tempo di
//! ogni pezzo riparte da zero: `offset` dice quanti millisecondi dopo
//! l'inizio del tratto cominciava.
//!
//! Il cammino si prova a passi di metà raggio lungo ogni segmento del tratto,
//! e il bordo si trova per bisezione fra il passo fuori e quello dentro. Tutto
//! è nelle stesse coordinate: chi chiama porta il cammino in quelle del
//! tratto. Il costo cresce con i passi e con i segmenti vicini del cammino:
//! [`split_work`] lo conta prima, perché chi riceve il cammino da fuori possa
//! rifiutare un taglio troppo fine invece di fermarsi.

use crate::brush::InkBrush;
use crate::ink::{Ink, Sample, PRESSURE_STEPS};

/// Un pezzo che resta di un tratto tagliato.
#[derive(Clone, Debug, PartialEq)]
pub struct InkPiece {
    /// I campioni, col tempo da zero.
    pub samples: Vec<Sample>,
    /// Di quanti millisecondi comincia dopo il tratto intero.
    pub offset: f64,
    /// Comincia su un taglio, e non sul capo del tratto.
    pub cut_start: bool,
    /// Finisce su un taglio, e non sul capo del tratto.
    pub cut_end: bool,
}

/// Quante volte si dimezza l'intervallo per trovare il bordo.
const BISECTIONS: u32 = 16;

/// Un punto del cammino, `[x, y]`.
pub type Spot = [f64; 2];

/// La distanza al quadrato fra `p` e il segmento da `a` a `b`.
fn distance_squared(p: Spot, a: Spot, b: Spot) -> f64 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let length = dx * dx + dy * dy;
    // `clamp` lascia passare `NaN`, come `Math.max(0, Math.min(1, NaN))`.
    let k = if length == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length).clamp(0.0, 1.0)
    };
    let x = a[0] + k * dx - p[0];
    let y = a[1] + k * dy - p[1];
    x * x + y * y
}

/// Il campione a `k` fra `a` e `b`.
fn between(a: &Sample, b: &Sample, k: f64) -> Sample {
    let lerp = |u: f64, v: f64| u + (v - u) * k;
    let near = if k < 0.5 { a } else { b };
    let p = match (a.p, b.p) {
        (Some(pa), Some(pb)) => Some(lerp(pa, pb)),
        _ => None,
    };
    Sample {
        x: lerp(a.x, b.x),
        y: lerp(a.y, b.y),
        p,
        t: lerp(a.t, b.t),
        tilt: near.tilt,
    }
}

/// I segmenti del cammino vicini al tratto: quelli il cui riquadro, allargato
/// di `radius`, tocca il riquadro dei campioni. Il primo è il primo punto con
/// sé stesso, così un cammino di un punto solo è un cerchio.
fn near_segments(samples: &[Sample], path: &[Spot], radius: f64) -> Vec<(Spot, Spot)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for s in samples {
        min_x = min_x.min(s.x);
        min_y = min_y.min(s.y);
        max_x = max_x.max(s.x);
        max_y = max_y.max(s.y);
    }
    let mut segments = Vec::new();
    for i in 0..path.len() {
        let a = path[if i == 0 { 0 } else { i - 1 }];
        let b = path[i];
        if a[0].max(b[0]) < min_x - radius || a[0].min(b[0]) > max_x + radius {
            continue;
        }
        if a[1].max(b[1]) < min_y - radius || a[1].min(b[1]) > max_y + radius {
            continue;
        }
        segments.push((a, b));
    }
    segments
}

/// Il passo del taglio, `radius / 2`, se il taglio si può fare: il passo è
/// finito e maggiore di zero e i campioni hanno `x` e `y` finiti. Altrimenti
/// `None`, e il tratto non si taglia: un passo zero (un raggio così piccolo
/// che la metà arrotonda a zero) o un campione non finito farebbero un numero
/// di passi infinito o `NaN`, e il giro non finirebbe. La tela non ci arriva:
/// i suoi raggi sono di qualche pixel.
fn walk_step(samples: &[Sample], radius: f64) -> Option<f64> {
    let step = radius / 2.0;
    let finite = samples.iter().all(|s| s.x.is_finite() && s.y.is_finite());
    (step.is_finite() && step > 0.0 && finite).then_some(step)
}

/// Quanti passi fa il taglio fra i campioni `a` e `b`, col passo `step` di
/// [`walk_step`]: almeno uno. Infinito solo se la distanza trabocca.
fn steps(a: &Sample, b: &Sample, step: f64) -> f64 {
    ((b.x - a.x).hypot(b.y - a.y) / step).ceil().max(1.0)
}

/// Quante distanze al più calcola [`split_ink`] prima delle bisezioni: un
/// passo per campione del cammino fra due campioni, per ogni segmento vicino
/// del cammino. Zero se il taglio non si fa (nessun campione, nessun segmento
/// vicino, un raggio non positivo, un passo che [`walk_step`] non accetta).
/// Mai `NaN`; infinito se una distanza trabocca, e allora [`split_ink`] non
/// taglia.
pub fn split_work(samples: &[Sample], path: &[Spot], radius: f64) -> f64 {
    if samples.is_empty() || path.is_empty() || radius.is_nan() || radius <= 0.0 {
        return 0.0;
    }
    let Some(step) = walk_step(samples, radius) else {
        return 0.0;
    };
    let segments = near_segments(samples, path, radius).len();
    if segments == 0 {
        return 0.0;
    }
    let walked: f64 = samples
        .windows(2)
        .map(|pair| steps(&pair[0], &pair[1], step))
        .sum();
    // Al più 10 000 segmenti per un cammino vero: il cast è esatto.
    #[allow(clippy::cast_precision_loss)]
    let segments = segments as f64;
    (1.0 + walked) * segments
}

/// Un pezzo mentre si costruisce.
struct Open {
    samples: Vec<Sample>,
    cut_start: bool,
    cut_end: bool,
}

/// I pezzi di `samples` fuori dal cammino `path` largo `radius`: `None` se il
/// cammino non lo tocca, un vettore vuoto se lo cancella tutto.
///
/// Il lavoro cresce con [`split_work`]: chi riceve il cammino da fuori lo
/// conta prima. Un passo che [`walk_step`] non accetta, o un numero di passi
/// infinito, non taglia: `None`.
pub fn split_ink(samples: &[Sample], path: &[Spot], radius: f64) -> Option<Vec<InkPiece>> {
    if samples.is_empty() || path.is_empty() || radius.is_nan() || radius <= 0.0 {
        return None;
    }
    let step = walk_step(samples, radius)?;
    if samples
        .windows(2)
        .any(|pair| !steps(&pair[0], &pair[1], step).is_finite())
    {
        return None;
    }
    // Del cammino contano i segmenti vicini al tratto.
    let segments = near_segments(samples, path, radius);
    if segments.is_empty() {
        return None;
    }
    let limit = radius * radius;
    let inside = |s: &Sample| {
        segments
            .iter()
            .any(|&(a, b)| distance_squared([s.x, s.y], a, b) < limit)
    };

    let mut pieces: Vec<Open> = Vec::new();
    let mut current: Option<Open> = None;
    let mut touched = false;
    let first = samples[0];
    let mut was_in = inside(&first);
    if was_in {
        touched = true;
    } else {
        current = Some(Open {
            samples: vec![first],
            cut_start: false,
            cut_end: false,
        });
    }
    for pair in samples.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        let n = steps(a, b, step);
        let mut from = 0.0;
        let mut k = 1.0;
        while k <= n {
            let to = k / n;
            let at = if k == n { *b } else { between(a, b, to) };
            let is_in = inside(&at);
            if is_in != was_in {
                touched = true;
                // Il bordo fra `from` (dalla parte di `was_in`) e `to`.
                let mut lo = from;
                let mut hi = to;
                for _ in 0..BISECTIONS {
                    let mid = (lo + hi) / 2.0;
                    if inside(&between(a, b, mid)) == was_in {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                let edge = between(a, b, if was_in { hi } else { lo });
                if is_in {
                    if let Some(mut open) = current.take() {
                        open.samples.push(edge);
                        open.cut_end = true;
                        pieces.push(open);
                    }
                } else {
                    current = Some(Open {
                        samples: vec![edge],
                        cut_start: true,
                        cut_end: false,
                    });
                }
                was_in = is_in;
            }
            if k == n && !is_in {
                if let Some(open) = current.as_mut() {
                    open.samples.push(*b);
                }
            }
            from = to;
            k += 1.0;
        }
    }
    if !touched {
        return None;
    }
    if let Some(open) = current {
        pieces.push(open);
    }
    // Un pezzo di un punto solo, nato da un taglio, è il bordo: non resta.
    Some(
        pieces
            .into_iter()
            .filter(|piece| piece.samples.len() > 1 || (!piece.cut_start && !piece.cut_end))
            .map(|piece| {
                let offset = piece.samples[0].t;
                InkPiece {
                    samples: piece
                        .samples
                        .iter()
                        .map(|s| Sample {
                            t: s.t - offset,
                            ..*s
                        })
                        .collect(),
                    offset,
                    cut_start: piece.cut_start,
                    cut_end: piece.cut_end,
                }
            })
            .collect(),
    )
}

/// Il pennello di un pezzo: ai tagli niente rastremazione, perché il tratto
/// continuava. La punta piatta non ne ha.
pub fn cut_brush(brush: &InkBrush, cut_start: bool, cut_end: bool) -> InkBrush {
    match brush {
        InkBrush::Nib1(_) => brush.clone(),
        InkBrush::Pf1(pf1) => {
            let mut cut = pf1.clone();
            if cut_start {
                cut.taper_start = 0.0;
            }
            if cut_end {
                cut.taper_end = 0.0;
            }
            InkBrush::Pf1(cut)
        }
    }
}

/// I campioni di un inchiostro in unità locali, come `dequantizeSample` di
/// `sample.ts`: `x` e `y` divisi per la scala, la pressione per 255, il tempo
/// in millisecondi (0 senza il canale `t`), l'inclinazione in gradi.
pub fn ink_samples(ink: &Ink) -> Vec<Sample> {
    let factor = ink.scale().factor();
    let column = |letter| ink.channel(letter);
    let (p, t, a, z) = (column('p'), column('t'), column('a'), column('z'));
    // Gli interi di `fub:ink` stanno entro ±(2⁵³ − 1): il cast è esatto.
    #[allow(clippy::cast_precision_loss)]
    let float = |value: i64| value as f64;
    (0..ink.len())
        .map(|i| {
            let row = ink.sample(i);
            Sample {
                x: float(row[0]) / factor,
                y: float(row[1]) / factor,
                p: p.map(|p| float(row[p]) / PRESSURE_STEPS),
                t: t.map_or(0.0, |t| float(row[t])),
                tilt: a.zip(z).map(|(a, z)| (float(row[a]), float(row[z]))),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brush::Brush;

    fn line() -> Vec<Sample> {
        (0..=10)
            .map(|i| Sample {
                x: f64::from(i) * 10.0,
                y: 0.0,
                p: Some(0.5),
                t: f64::from(i) * 10.0,
                tilt: None,
            })
            .collect()
    }

    fn sample(x: f64, y: f64) -> Sample {
        Sample {
            x,
            y,
            p: None,
            t: 0.0,
            tilt: None,
        }
    }

    #[test]
    fn un_taglio_a_meta_fa_due_pezzi_coi_bordi_esatti() {
        let pieces = split_ink(&line(), &[[50.0, -20.0], [50.0, 20.0]], 5.0).expect("toccato");
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].samples.last().map(|s| s.x), Some(45.0));
        assert_eq!(pieces[1].samples[0].x, 55.0);
        assert_eq!(pieces[1].offset, 55.0);
        assert!(!pieces[0].cut_start && pieces[0].cut_end);
        assert!(pieces[1].cut_start && !pieces[1].cut_end);
    }

    #[test]
    fn senza_cammino_o_raggio_non_si_taglia() {
        assert_eq!(split_ink(&line(), &[], 5.0), None);
        assert_eq!(split_ink(&line(), &[[50.0, 0.0]], 0.0), None);
        assert_eq!(split_ink(&line(), &[[50.0, 0.0]], f64::NAN), None);
        assert_eq!(split_ink(&[], &[[50.0, 0.0]], 5.0), None);
        assert_eq!(split_work(&line(), &[[50.0, 0.0]], 0.0), 0.0);
        assert_eq!(split_work(&line(), &[[500.0, 500.0]], 5.0), 0.0);
    }

    #[test]
    fn il_lavoro_conta_i_passi_per_i_segmenti_vicini() {
        // Dieci segmenti lunghi 10 col passo 2,5: quattro passi l'uno, più il
        // primo campione. Del cammino è vicino solo il segmento da un punto
        // all'altro: il primo punto da solo sta 20 sotto il tratto.
        let work = split_work(&line(), &[[50.0, -20.0], [50.0, 20.0]], 5.0);
        assert_eq!(work, 41.0);
        let two = split_work(&line(), &[[50.0, 0.0], [60.0, 0.0]], 5.0);
        assert_eq!(two, 41.0 * 2.0);
        let fine = split_work(&line(), &[[50.0, 0.0]], 1e-300);
        assert!(fine.is_infinite() || fine > 1e300);
    }

    #[test]
    fn un_passo_zero_o_un_campione_non_finito_non_taglia_e_non_costa() {
        // 5e-324 / 2 arrotonda a zero: il passo è zero, e due campioni uguali
        // darebbero 0 / 0.
        let samples = [sample(0.0, 0.0), sample(0.0, 0.0), sample(10.0, 0.0)];
        assert_eq!(split_work(&samples, &[[0.0, 0.0]], 5e-324), 0.0);
        assert!(split_ink(&samples, &[[0.0, 0.0]], 5e-324).is_none());
        let wild = [sample(0.0, 0.0), sample(f64::INFINITY, 0.0)];
        assert_eq!(split_work(&wild, &[[0.0, 0.0]], 4.0), 0.0);
        assert!(split_ink(&wild, &[[0.0, 0.0]], 4.0).is_none());
        let nan = [sample(0.0, 0.0), sample(f64::NAN, 0.0)];
        assert!(split_ink(&nan, &[[0.0, 0.0]], 4.0).is_none());
        // Una distanza che trabocca: il lavoro è infinito e il taglio non si fa.
        let far = [sample(-f64::MAX, 0.0), sample(f64::MAX, 0.0)];
        assert_eq!(split_work(&far, &[[0.0, 0.0]], 4.0), f64::INFINITY);
        assert!(split_ink(&far, &[[0.0, 0.0]], 4.0).is_none());
    }

    #[test]
    fn il_pennello_perde_la_rastremazione_solo_ai_tagli() {
        let brush = InkBrush::Pf1(Brush {
            taper_start: 8.0,
            taper_end: 12.0,
            ..Brush::default()
        });
        let InkBrush::Pf1(start) = cut_brush(&brush, true, false) else {
            panic!("pf1")
        };
        assert_eq!((start.taper_start, start.taper_end), (0.0, 12.0));
        let InkBrush::Pf1(end) = cut_brush(&brush, false, true) else {
            panic!("pf1")
        };
        assert_eq!((end.taper_start, end.taper_end), (8.0, 0.0));
        let nib = InkBrush::parse("nib1 size=10").expect("nib1");
        assert_eq!(cut_brush(&nib, true, true), nib);
    }

    #[test]
    fn i_campioni_si_leggono_come_in_typescript() {
        let ink = Ink::decode("1 s100 cxypt 12050,3020,128,0 25,-3,2,8").expect("ink");
        let samples = ink_samples(&ink);
        assert_eq!(samples[0].x, 120.5);
        assert_eq!(samples[0].p, Some(128.0 / 255.0));
        assert_eq!(samples[1].t, 8.0);
        let bare = Ink::decode("1 s10 cxy 5,5 1,1").expect("ink");
        let samples = ink_samples(&bare);
        assert_eq!((samples[1].x, samples[1].t, samples[1].p), (0.6, 0.0, None));
        let tilted = Ink::decode("1 s100 cxytaz 0,0,0,40,10").expect("ink");
        assert_eq!(ink_samples(&tilted)[0].tilt, Some((40.0, 10.0)));
    }
}
