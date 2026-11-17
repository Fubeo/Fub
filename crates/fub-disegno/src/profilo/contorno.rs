//! Il contorno pieno di una linea a spessore variabile: gli anelli che il
//! profilo spazza lungo la linea centrale, tutti in verso positivo, la cui
//! unione è l'area del contorno. È la parte di `tools/offset.ts` del client
//! che serve allo spessore variabile (`profileLoops`), regola per regola e
//! con gli stessi numeri: le curve si dividono nei punti del profilo, ogni
//! pezzo si scosta con la derivata della larghezza, i giunti e gli estremi
//! prendono le larghezze del punto dove stanno.
//!
//! Il contorno fermo, il tratteggio e lo scostamento di `offset.ts` non
//! servono qui e non ci sono.

use std::f64::consts::{FRAC_PI_2 as QUARTO, PI, TAU};
use std::rc::Rc;
use std::sync::OnceLock;

use fub_scene::varwidth::{WidthCap, WidthJoin};

use super::curve::{
    arco_centrato, jmax, jmin, lerp, meno, norma, per, piu, rovescia, scalare, segno, uguali,
    vettoriale, ArcoCentrato, Curva, Segmento, P,
};
use super::Tratto;

/// Quanto lo scostamento di una curva può stare da quello vero.
pub(crate) const OFFSET_ERROR: f64 = 0.005;
/// Quante volte al più si divide un pezzo.
const MAX_DEPTH: usize = 16;
/// Il limite degli spigoli di un contorno a spessore variabile.
const PROFILE_MITER_LIMIT: f64 = 4.0;
/// Più vicini di così, due punti sono lo stesso.
const STILL: f64 = 1e-9;

fn unita(a: P) -> P {
    per(a, 1.0 / norma(a))
}

/// La normale di un verso: girato di un angolo retto, da x verso y.
fn normale(d: P) -> P {
    [-d[1], d[0]]
}

/// L'angolo, col segno, da `d0` a `d1`.
fn svolta(d0: P, d1: P) -> f64 {
    vettoriale(d0, d1).atan2(scalare(d0, d1))
}

// ---------------------------------------------------------------------------
// Le cubiche.
// ---------------------------------------------------------------------------

type Bez = [P; 4];

fn bez_punto([p0, p1, p2, p3]: &Bez, t: f64) -> P {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]
}

fn bez_prima([p0, p1, p2, p3]: &Bez, t: f64) -> P {
    let u = 1.0 - t;
    let (a, b, c) = (3.0 * u * u, 6.0 * u * t, 3.0 * t * t);
    [
        a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
        a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
    ]
}

fn bez_seconda([p0, p1, p2, p3]: &Bez, t: f64) -> P {
    let u = 1.0 - t;
    [
        6.0 * u * (p2[0] - 2.0 * p1[0] + p0[0]) + 6.0 * t * (p3[0] - 2.0 * p2[0] + p1[0]),
        6.0 * u * (p2[1] - 2.0 * p1[1] + p0[1]) + 6.0 * t * (p3[1] - 2.0 * p2[1] + p1[1]),
    ]
}

fn bez_terza([p0, p1, p2, p3]: &Bez) -> P {
    [
        6.0 * (p3[0] - 3.0 * p2[0] + 3.0 * p1[0] - p0[0]),
        6.0 * (p3[1] - 3.0 * p2[1] + 3.0 * p1[1] - p0[1]),
    ]
}

/// La lunghezza della poligonale dei punti.
fn gambe([p0, p1, p2, p3]: &Bez) -> f64 {
    norma(meno(*p1, *p0)) + norma(meno(*p2, *p1)) + norma(meno(*p3, *p2))
}

/// La parte di `b` fra `t0` e `t1`, dalla forma polare.
fn bez_parte(b: &Bez, t0: f64, t1: f64) -> Bez {
    let polare = |u: f64, v: f64, w: f64| -> P {
        let (q0, q1, q2) = (
            lerp(b[0], b[1], u),
            lerp(b[1], b[2], u),
            lerp(b[2], b[3], u),
        );
        lerp(lerp(q0, q1, v), lerp(q1, q2, v), w)
    };
    [
        if t0 == 0.0 { b[0] } else { polare(t0, t0, t0) },
        polare(t0, t0, t1),
        polare(t0, t1, t1),
        if t1 == 1.0 { b[3] } else { polare(t1, t1, t1) },
    ]
}

/// Il verso, lungo 1, in cui `b` va in `t`.
fn verso_in(b: &Bez, t: f64, lato: f64, scala: f64) -> P {
    let d = bez_prima(b, t);
    if norma(d) > 1e-9 * scala {
        return unita(d);
    }
    let dd = bez_seconda(b, t);
    if norma(dd) > 1e-9 * scala {
        return unita(per(dd, lato));
    }
    unita(bez_terza(b))
}

/// Il centro di curvatura di `b` in `t`.
fn centro_in(b: &Bez, t: f64, scala: f64) -> Option<P> {
    let (p, d) = (bez_punto(b, t), bez_prima(b, t));
    if norma(d) <= 1e-9 * scala {
        return Some(p);
    }
    let piega = vettoriale(d, bez_seconda(b, t));
    if piega == 0.0 {
        None
    } else {
        Some(piu(p, per(normale(d), scalare(d, d) / piega)))
    }
}

/// Le radici reali di a·t² + b·t + c.
fn radici_quadratiche(a: f64, b: f64, c: f64) -> Vec<f64> {
    let misura = jmax(jmax(a.abs(), b.abs()), c.abs());
    if misura == 0.0 {
        return Vec::new();
    }
    if a.abs() <= 1e-12 * misura {
        return if b.abs() <= 1e-12 * misura {
            Vec::new()
        } else {
            vec![-c / b]
        };
    }
    let disc = b * b - 4.0 * a * c;
    if disc < 0.0 {
        return Vec::new();
    }
    let q = -(b + (if b < 0.0 { -1.0 } else { 1.0 }) * disc.sqrt()) / 2.0;
    if q == 0.0 {
        vec![0.0]
    } else {
        vec![q / a, c / q]
    }
}

fn dentro(t: f64) -> bool {
    t > 1e-9 && t < 1.0 - 1e-9
}

/// I coefficienti di B′/3 = a·t² + b·t + c.
fn coefficienti([p0, p1, p2, p3]: &Bez) -> [P; 3] {
    let c = meno(*p1, *p0);
    let b = per(piu(meno(*p2, per(*p1, 2.0)), *p0), 2.0);
    let a = meno(piu(meno(*p3, per(*p2, 3.0)), per(*p1, 3.0)), *p0);
    [a, b, c]
}

fn flessi(b: &Bez) -> Vec<f64> {
    let [a, bb, c] = coefficienti(b);
    radici_quadratiche(
        -vettoriale(a, bb),
        2.0 * vettoriale(c, a),
        vettoriale(c, bb),
    )
    .into_iter()
    .filter(|&t| dentro(t))
    .collect()
}

fn cuspidi(b: &Bez, scala: f64) -> Vec<f64> {
    let [a, bb, c] = coefficienti(b);
    let mut out: Vec<f64> = Vec::new();
    for asse in [0, 1] {
        for t in radici_quadratiche(a[asse], bb[asse], c[asse]) {
            if dentro(t)
                && norma(bez_prima(b, t)) <= 1e-7 * scala
                && !out.iter().any(|&u| (u - t).abs() < 1e-9)
            {
                out.push(t);
            }
        }
    }
    out
}

/// Dove si cercano i cambi di segno (`FRACTIONS`).
fn frazioni() -> &'static [f64] {
    static F: OnceLock<Vec<f64>> = OnceLock::new();
    F.get_or_init(|| {
        let vicine = [1e-6, 1e-5, 1e-4, 1e-3, 0.004, 0.01];
        let mut f: Vec<f64> = vicine.to_vec();
        f.extend((0..47).map(|i| f64::from(i + 1) / 48.0));
        f.extend(vicine.iter().map(|u| 1.0 - u));
        f.sort_by(|m, n| m.total_cmp(n));
        f
    })
}

/// Gli zeri di `f` fra `ta` e `tb` dove cambia segno.
fn radici_di(f: &dyn Fn(f64) -> f64, ta: f64, tb: f64) -> Vec<f64> {
    let mut out = Vec::new();
    let (mut t0, mut v0) = (ta, f(ta));
    for &u in frazioni().iter().chain(std::iter::once(&1.0)) {
        let t1 = if u == 1.0 { tb } else { ta + (tb - ta) * u };
        let v1 = f(t1);
        if v0 != 0.0 && v1 != 0.0 && (v0 < 0.0) != (v1 < 0.0) {
            let (mut lo, mut hi, mut basso) = (t0, t1, v0);
            let mut k = 0;
            while k < 64 && hi - lo > 1e-15 {
                let m = (lo + hi) / 2.0;
                let fm = f(m);
                if (fm < 0.0) == (basso < 0.0) {
                    lo = m;
                    basso = fm;
                } else {
                    hi = m;
                }
                k += 1;
            }
            out.push((lo + hi) / 2.0);
        }
        if v1 != 0.0 {
            t0 = t1;
            v0 = v1;
        }
    }
    out
}

const GAUSS_8: [(f64, f64); 8] = [
    (-0.9602898564975363, 0.1012285362903763),
    (-0.7966664774136267, 0.2223810344533745),
    (-0.525532409916329, 0.3137066458778873),
    (-0.1834346424956498, 0.362683783378362),
    (0.1834346424956498, 0.362683783378362),
    (0.525532409916329, 0.3137066458778873),
    (0.7966664774136267, 0.2223810344533745),
    (0.9602898564975363, 0.1012285362903763),
];

const GAUSS_3: [(f64, f64); 3] = [
    (-0.7745966692414834, 5.0 / 9.0),
    (0.0, 8.0 / 9.0),
    (0.7745966692414834, 5.0 / 9.0),
];

/// La lunghezza di `b` fra `t0` e `t1`.
fn lunghezza_fra(b: &Bez, t0: f64, t1: f64) -> f64 {
    let (meta, mezzo) = ((t1 - t0) / 2.0, (t0 + t1) / 2.0);
    let mut somma = 0.0;
    for (x, w) in GAUSS_8 {
        somma += w * norma(bez_prima(b, mezzo + meta * x));
    }
    somma * meta
}

// ---------------------------------------------------------------------------
// I sottotracciati.
// ---------------------------------------------------------------------------

/// Un pezzo che disegna qualcosa: una linea, una cubica con la sua misura,
/// o un arco di cerchio.
#[derive(Clone, Copy, Debug)]
enum Elemento {
    Linea {
        da: P,
        a: P,
    },
    Cubica {
        bez: Bez,
        scala: f64,
    },
    Cerchio {
        da: P,
        a: P,
        centro: P,
        raggio: f64,
        inizio: f64,
        delta: f64,
    },
}

struct Sotto {
    elementi: Vec<Elemento>,
    chiuso: bool,
}

fn inizio_di(e: &Elemento) -> P {
    match *e {
        Elemento::Cubica { bez, .. } => bez[0],
        Elemento::Linea { da, .. } | Elemento::Cerchio { da, .. } => da,
    }
}

fn fine_di(e: &Elemento) -> P {
    match *e {
        Elemento::Cubica { bez, .. } => bez[3],
        Elemento::Linea { a, .. } | Elemento::Cerchio { a, .. } => a,
    }
}

fn sul_cerchio(c: P, r: f64, angolo: f64) -> P {
    [c[0] + r * angolo.cos(), c[1] + r * angolo.sin()]
}

fn verso_del_cerchio(angolo: f64, delta: f64) -> P {
    if delta > 0.0 {
        [-angolo.sin(), angolo.cos()]
    } else {
        [angolo.sin(), -angolo.cos()]
    }
}

fn verso_iniziale(e: &Elemento) -> P {
    match *e {
        Elemento::Linea { da, a } => unita(meno(a, da)),
        Elemento::Cubica { bez, scala } => verso_in(&bez, 0.0, 1.0, scala),
        Elemento::Cerchio { inizio, delta, .. } => verso_del_cerchio(inizio, delta),
    }
}

fn verso_finale(e: &Elemento) -> P {
    match *e {
        Elemento::Linea { da, a } => unita(meno(a, da)),
        Elemento::Cubica { bez, scala } => verso_in(&bez, 1.0, -1.0, scala),
        Elemento::Cerchio { inizio, delta, .. } => verso_del_cerchio(inizio + delta, delta),
    }
}

fn spingi_cubica(bez: Bez, out: &mut Vec<Elemento>) {
    let scala = gambe(&bez);
    if scala > STILL {
        out.push(Elemento::Cubica { bez, scala });
    }
}

/// Lo scarto massimo di una cubica che copre l'angolo `theta` di un cerchio
/// di raggio `r`.
fn scarto(r: f64, theta: f64) -> f64 {
    (r * 4.0 * (theta / 4.0).sin().powf(6.0)) / (27.0 * (theta / 4.0).cos().powf(2.0))
}

fn pezzi_dell_arco(r: f64, delta: f64) -> usize {
    let mut pezzi = jmax(1.0, (delta.abs() / QUARTO - 1e-9).ceil());
    while pezzi < 1024.0 && scarto(r, delta.abs() / pezzi) > OFFSET_ERROR / 2.0 {
        pezzi += 1.0;
    }
    pezzi as usize
}

/// Le cubiche di un arco d'ellisse.
fn cubiche_dell_ellisse(da: P, a: P, arco: &ArcoCentrato, out: &mut Vec<Elemento>) {
    let r = jmax(arco.raggi[0], arco.raggi[1]);
    let pezzi = pezzi_dell_arco(r, arco.delta);
    let passo = arco.delta / pezzi as f64;
    let k = (4.0 / 3.0) * (passo / 4.0).tan();
    let su = |theta: f64| -> P {
        let (ex, ey) = (arco.raggi[0] * theta.cos(), arco.raggi[1] * theta.sin());
        [
            arco.centro[0] + arco.cos * ex - arco.sin * ey,
            arco.centro[1] + arco.sin * ex + arco.cos * ey,
        ]
    };
    let lungo = |theta: f64| -> P {
        let (ex, ey) = (-arco.raggi[0] * theta.sin(), arco.raggi[1] * theta.cos());
        [arco.cos * ex - arco.sin * ey, arco.sin * ex + arco.cos * ey]
    };
    for i in 0..pezzi {
        let (ta, tb) = (
            arco.inizio + passo * i as f64,
            arco.inizio + passo * (i + 1) as f64,
        );
        let p0 = if i == 0 { da } else { su(ta) };
        let p3 = if i == pezzi - 1 { a } else { su(tb) };
        spingi_cubica(
            [
                p0,
                piu(p0, per(lungo(ta), k)),
                meno(p3, per(lungo(tb), k)),
                p3,
            ],
            out,
        );
    }
}

/// I pezzi di `curva` da `da`.
fn elementi_di(da: P, curva: &Curva, out: &mut Vec<Elemento>) {
    match *curva {
        Curva::Linea(a) => {
            if norma(meno(a, da)) > STILL {
                out.push(Elemento::Linea { da, a });
            }
        }
        Curva::Quad(c, a) => {
            spingi_cubica([da, lerp(da, c, 2.0 / 3.0), lerp(a, c, 2.0 / 3.0), a], out)
        }
        Curva::Cubica(c1, c2, a) => spingi_cubica([da, c1, c2, a], out),
        Curva::Arco { a, .. } => match arco_centrato(da, curva) {
            None => elementi_di(da, &Curva::Linea(a), out),
            Some(arco) if (arco.raggi[0] - arco.raggi[1]).abs() <= 1e-9 * arco.raggi[0] => {
                let inizio = arco.inizio + arco.sin.atan2(arco.cos);
                out.push(Elemento::Cerchio {
                    da,
                    a,
                    centro: arco.centro,
                    raggio: arco.raggi[0],
                    inizio,
                    delta: arco.delta,
                });
            }
            Some(arco) => cubiche_dell_ellisse(da, a, &arco, out),
        },
    }
}

/// I sottotracciati di `segmenti` che disegnano qualcosa.
fn sottotracciati(segmenti: &[Segmento]) -> Vec<Sotto> {
    let mut out = Vec::new();
    let mut elementi = Vec::new();
    let mut inizio = [0.0, 0.0];
    let mut corrente = [0.0, 0.0];
    let mut disegna = false;
    let mut chiudi = |elementi: &mut Vec<Elemento>, disegna: &mut bool, chiuso: bool| {
        if *disegna {
            out.push(Sotto {
                elementi: std::mem::take(elementi),
                chiuso,
            });
        }
        elementi.clear();
        *disegna = false;
    };
    for s in segmenti {
        match s {
            Segmento::Muovi(a) => {
                chiudi(&mut elementi, &mut disegna, false);
                inizio = *a;
                corrente = *a;
            }
            Segmento::Chiudi => {
                disegna = true;
                elementi_di(corrente, &Curva::Linea(inizio), &mut elementi);
                chiudi(&mut elementi, &mut disegna, true);
                corrente = inizio;
            }
            Segmento::Curva(c) => {
                disegna = true;
                elementi_di(corrente, c, &mut elementi);
                corrente = c.fine();
            }
        }
    }
    chiudi(&mut elementi, &mut disegna, false);
    out
}

// ---------------------------------------------------------------------------
// La misura dei pezzi.
// ---------------------------------------------------------------------------

const MEASURE_PARTS: usize = 16;

/// Quanto è lungo un pezzo, e il suo parametro a una lunghezza dall'inizio.
#[derive(Clone, Debug)]
enum Misura {
    Dritta(f64),
    Cubica { bez: Bez, somme: Vec<f64> },
}

impl Misura {
    fn di(e: &Elemento) -> Misura {
        match *e {
            Elemento::Linea { da, a } => Misura::Dritta(norma(meno(a, da))),
            Elemento::Cerchio { raggio, delta, .. } => Misura::Dritta(raggio * delta.abs()),
            Elemento::Cubica { bez, .. } => {
                let mut somme = vec![0.0];
                for i in 0..MEASURE_PARTS {
                    let n = MEASURE_PARTS as f64;
                    somme.push(somme[i] + lunghezza_fra(&bez, i as f64 / n, (i + 1) as f64 / n));
                }
                Misura::Cubica { bez, somme }
            }
        }
    }

    fn totale(&self) -> f64 {
        match self {
            Misura::Dritta(t) => *t,
            Misura::Cubica { somme, .. } => somme[MEASURE_PARTS],
        }
    }

    fn lunghezza_a(&self, t: f64) -> f64 {
        match self {
            Misura::Dritta(totale) => totale * t,
            Misura::Cubica { bez, somme } => {
                let totale = somme[MEASURE_PARTS];
                if t <= 0.0 {
                    return 0.0;
                }
                if t >= 1.0 {
                    return totale;
                }
                let n = MEASURE_PARTS as f64;
                let i = ((t * n).floor() as usize).min(MEASURE_PARTS - 1);
                somme[i] + lunghezza_fra(bez, i as f64 / n, t)
            }
        }
    }

    fn parametro(&self, s: f64) -> f64 {
        match self {
            Misura::Dritta(totale) => jmin(1.0, jmax(0.0, s / totale)),
            Misura::Cubica { bez, somme } => {
                let totale = somme[MEASURE_PARTS];
                if s <= 0.0 {
                    return 0.0;
                }
                if s >= totale {
                    return 1.0;
                }
                let n = MEASURE_PARTS as f64;
                let mut i = 0;
                while i < MEASURE_PARTS - 1 && somme[i + 1] < s {
                    i += 1;
                }
                let base = i as f64 / n;
                let (obiettivo, parte) = (s - somme[i], somme[i + 1] - somme[i]);
                if !(parte > 0.0) {
                    return base;
                }
                let (mut lo, mut hi) = (base, (i + 1) as f64 / n);
                let mut t = base + (hi - base) * (obiettivo / parte);
                let mut k = 0;
                while k < 40 && hi - lo > 1e-15 {
                    let f = lunghezza_fra(bez, base, t) - obiettivo;
                    if f.abs() <= 1e-12 * jmax(1.0, totale) {
                        break;
                    }
                    if f > 0.0 {
                        hi = t;
                    } else {
                        lo = t;
                    }
                    let velocita = norma(bez_prima(bez, t));
                    let dopo = if velocita > 0.0 {
                        t - f / velocita
                    } else {
                        (lo + hi) / 2.0
                    };
                    t = if dopo > lo && dopo < hi {
                        dopo
                    } else {
                        (lo + hi) / 2.0
                    };
                    k += 1;
                }
                t
            }
        }
    }
}

/// La parte di `e` fra i parametri `t0` e `t1`.
fn parte_di(e: &Elemento, t0: f64, t1: f64) -> Elemento {
    match *e {
        Elemento::Linea { da, a } => Elemento::Linea {
            da: if t0 == 0.0 { da } else { lerp(da, a, t0) },
            a: if t1 == 1.0 { a } else { lerp(da, a, t1) },
        },
        Elemento::Cubica { bez, .. } => {
            let bez = bez_parte(&bez, t0, t1);
            Elemento::Cubica {
                bez,
                scala: gambe(&bez),
            }
        }
        Elemento::Cerchio {
            da,
            a,
            centro,
            raggio,
            inizio,
            delta,
        } => {
            let (nuovo, d) = (inizio + delta * t0, delta * (t1 - t0));
            Elemento::Cerchio {
                da: if t0 == 0.0 {
                    da
                } else {
                    sul_cerchio(centro, raggio, nuovo)
                },
                a: if t1 == 1.0 {
                    a
                } else {
                    sul_cerchio(centro, raggio, nuovo + d)
                },
                centro,
                raggio,
                inizio: nuovo,
                delta: d,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Gli anelli.
// ---------------------------------------------------------------------------

/// Un anello: dove comincia, e le curve, che tornano all'inizio con una
/// linea.
pub(crate) struct Anello {
    pub inizio: P,
    pub curve: Vec<Curva>,
}

/// ½∫(x dy − y dx) lungo `curva` da `da`.
fn spazzata(da: P, curva: &Curva) -> f64 {
    match *curva {
        Curva::Linea(a) => (da[0] * a[1] - a[0] * da[1]) / 2.0,
        Curva::Quad(c, a) => spazzata(
            da,
            &Curva::Cubica(lerp(da, c, 2.0 / 3.0), lerp(a, c, 2.0 / 3.0), a),
        ),
        Curva::Cubica(c1, c2, a) => {
            let b: Bez = [da, c1, c2, a];
            let mut somma = 0.0;
            for (x, w) in GAUSS_3 {
                let t = (1.0 + x) / 2.0;
                somma += w * vettoriale(bez_punto(&b, t), bez_prima(&b, t));
            }
            somma / 4.0
        }
        Curva::Arco { a, .. } => match arco_centrato(da, curva) {
            None => spazzata(da, &Curva::Linea(a)),
            Some(arco) => {
                let (r, [cx, cy], a0) = (arco.raggi[0], arco.centro, arco.inizio);
                let a1 = a0 + arco.delta;
                (r * r * arco.delta + cx * r * (a1.sin() - a0.sin())
                    - cy * r * (a1.cos() - a0.cos()))
                    / 2.0
            }
        },
    }
}

fn area_di(inizio: P, curve: &[Curva]) -> f64 {
    let mut somma = 0.0;
    let mut da = inizio;
    for c in curve {
        somma += spazzata(da, c);
        da = c.fine();
    }
    somma + (da[0] * inizio[1] - inizio[0] * da[1]) / 2.0
}

/// `curve` da `inizio` percorse al contrario, dalla fine.
fn curve_rovesciate(inizio: P, curve: &[Curva]) -> Vec<Curva> {
    let mut out = Vec::with_capacity(curve.len());
    let mut da = inizio;
    for c in curve {
        out.push(rovescia(da, c));
        da = c.fine();
    }
    out.reverse();
    out
}

/// Aggiunge l'anello da `inizio`, girato in verso positivo; niente se non
/// racchiude niente.
fn spingi_anello(out: &mut Vec<Anello>, inizio: P, curve: Vec<Curva>) {
    let area = area_di(inizio, &curve);
    if !(area.abs() > 1e-12) {
        return;
    }
    if area > 0.0 {
        out.push(Anello { inizio, curve });
    } else {
        let fine = curve[curve.len() - 1].fine();
        let curve = curve_rovesciate(inizio, &curve);
        out.push(Anello {
            inizio: fine,
            curve,
        });
    }
}

fn linea(a: P) -> Curva {
    Curva::Linea(a)
}

fn arco(raggio: f64, verso: bool, a: P) -> Curva {
    Curva::Arco {
        raggi: [raggio, raggio],
        rotazione: 0.0,
        grande: false,
        verso,
        a,
    }
}

/// Gli archi da `da` attorno a `centro`, di `angolo` in tutto, a pezzi di un
/// angolo retto al più; l'ultimo finisce in `a`.
fn archi_attorno(centro: P, raggio: f64, da: P, angolo: f64, a: P) -> Vec<Curva> {
    let pezzi = jmax(1.0, (angolo.abs() / QUARTO - 1e-9).ceil()) as usize;
    let inizio = (da[1] - centro[1]).atan2(da[0] - centro[0]);
    (1..=pezzi)
        .map(|k| {
            let fine = if k == pezzi {
                a
            } else {
                sul_cerchio(centro, raggio, inizio + (angolo * k as f64) / pezzi as f64)
            };
            arco(raggio, angolo > 0.0, fine)
        })
        .collect()
}

/// Lo scostamento di un pezzo da una parte, nel verso del pezzo.
struct Lato {
    inizio: P,
    curve: Vec<Curva>,
    fine: P,
}

fn dritto(da: P, a: P) -> Lato {
    Lato {
        inizio: da,
        curve: vec![linea(a)],
        fine: a,
    }
}

/// I pezzi di fila che fanno un anello (`Chain`).
#[derive(Default)]
struct Catena {
    avanti: Vec<Curva>,
    dietro: Vec<Curva>,
    primo: Option<(P, P)>,
    ultimo: (P, P),
}

impl Catena {
    fn aggiungi(&mut self, verso: Lato, via: Lato) {
        if self.primo.is_none() {
            self.primo = Some((verso.inizio, via.inizio));
        } else {
            if !uguali(self.ultimo.0, verso.inizio) {
                self.dietro.push(linea(verso.inizio));
            }
            if !uguali(self.ultimo.1, via.inizio) {
                self.avanti.push(linea(via.inizio));
            }
        }
        self.dietro.extend(verso.curve);
        self.avanti.extend(via.curve);
        self.ultimo = (verso.fine, via.fine);
    }

    fn chiudi(&mut self, out: &mut Vec<Anello>) {
        let Some((inizio, altro)) = self.primo.take() else {
            return;
        };
        let mut curve = vec![linea(altro)];
        curve.append(&mut self.avanti);
        curve.push(linea(self.ultimo.0));
        curve.extend(curve_rovesciate(inizio, &self.dietro));
        self.dietro.clear();
        spingi_anello(out, inizio, curve);
    }
}

/// Il disco di raggio `h` attorno a `p`.
fn spingi_disco(out: &mut Vec<Anello>, p: P, h: f64) {
    let da = piu(p, [h, 0.0]);
    let curve = archi_attorno(p, h, da, TAU, da);
    spingi_anello(out, da, curve);
}

// ---------------------------------------------------------------------------
// I pezzi.
// ---------------------------------------------------------------------------

type Funzione = Rc<dyn Fn(f64) -> f64>;

/// Quanto il contorno di un pezzo arriva da una parte, e quanto cambia.
#[derive(Clone)]
struct Portata {
    a: Funzione,
    pendenza: Funzione,
}

impl Portata {
    fn fissa(h: f64) -> Portata {
        Portata {
            a: Rc::new(move |_| h),
            pendenza: Rc::new(|_| 0.0),
        }
    }

    fn con_segno(&self, s: f64) -> Portata {
        let (a, p) = (self.a.clone(), self.pendenza.clone());
        Portata {
            a: Rc::new(move |t| s * a(t)),
            pendenza: Rc::new(move |t| s * p(t)),
        }
    }

    fn in_(&self, t: f64) -> f64 {
        (self.a)(t)
    }
}

/// Le due parti del contorno di un pezzo: verso la normale e dall'altra.
#[derive(Clone)]
struct Fascia {
    verso: Portata,
    via: Portata,
    ferma: Option<(f64, f64)>,
}

fn fascia_ferma(verso: f64, via: f64) -> Fascia {
    Fascia {
        verso: Portata::fissa(verso),
        via: Portata::fissa(via),
        ferma: Some((verso, via)),
    }
}

/// Dove si confronta lo scostamento calcolato con quello vero.
const SAMPLES: [f64; 7] = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];

/// Lo scostamento di `b` fra `ta` e `tb` di `s`.
fn scosta_cubica(b: &Bez, scala: f64, ta: f64, tb: f64, s: &Portata) -> Lato {
    let punto = |t: f64, lato: f64| -> P {
        piu(
            bez_punto(b, t),
            per(normale(verso_in(b, t, lato, scala)), s.in_(t)),
        )
    };
    let derivata = |t: f64, lato: f64| -> P {
        let d = bez_prima(b, t);
        let quadrato = scalare(d, d);
        if quadrato > (1e-9 * scala).powf(2.0) {
            let lungo = per(
                d,
                1.0 - (s.in_(t) * vettoriale(d, bez_seconda(b, t))) / (quadrato * quadrato.sqrt()),
            );
            return piu(
                lungo,
                per(normale(per(d, 1.0 / quadrato.sqrt())), (s.pendenza)(t)),
            );
        }
        let passo = 1e-7 * lato;
        per(meno(punto(t + passo, lato), punto(t, lato)), 1.0 / passo)
    };
    struct Visita<'a> {
        punto: &'a dyn Fn(f64, f64) -> P,
        derivata: &'a dyn Fn(f64, f64) -> P,
        curve: Vec<Curva>,
    }
    #[allow(clippy::too_many_arguments)]
    fn visita(v: &mut Visita<'_>, t0: f64, p0: P, d0: P, t1: f64, p1: P, d1: P, profondita: usize) {
        let k = (t1 - t0) / 3.0;
        let (c1, c2) = (piu(p0, per(d0, k)), meno(p1, per(d1, k)));
        let prova: Bez = [p0, c1, c2, p1];
        let sta = SAMPLES.iter().all(|&u| {
            norma(meno(
                bez_punto(&prova, u),
                (v.punto)(t0 + (t1 - t0) * u, 1.0),
            )) <= OFFSET_ERROR
        });
        if sta || profondita >= MAX_DEPTH {
            v.curve.push(Curva::Cubica(c1, c2, p1));
            return;
        }
        let tm = (t0 + t1) / 2.0;
        let (pm, dm) = ((v.punto)(tm, 1.0), (v.derivata)(tm, 1.0));
        visita(v, t0, p0, d0, tm, pm, dm, profondita + 1);
        visita(v, tm, pm, dm, t1, p1, d1, profondita + 1);
    }
    let (inizio, fine) = (punto(ta, 1.0), punto(tb, -1.0));
    let (da, db) = (derivata(ta, 1.0), derivata(tb, -1.0));
    let mut v = Visita {
        punto: &punto,
        derivata: &derivata,
        curve: Vec::new(),
    };
    visita(&mut v, ta, inizio, da, tb, fine, db, 0);
    Lato {
        inizio,
        curve: v.curve,
        fine,
    }
}

/// Di quanto gira `b` fra `ta` e `tb`, dove la curvatura ha il segno
/// `segno`.
fn giro_di(b: &Bez, scala: f64, ta: f64, tb: f64, s: f64) -> f64 {
    let mut angolo = svolta(verso_in(b, ta, 1.0, scala), verso_in(b, tb, -1.0, scala));
    if s > 0.0 && angolo < -1e-9 {
        angolo += TAU;
    } else if s < 0.0 && angolo > 1e-9 {
        angolo -= TAU;
    }
    angolo.abs()
}

/// Dove scrivono i pezzi: la catena e gli anelli.
struct Uscita<'a> {
    catena: &'a mut Catena,
    out: &'a mut Vec<Anello>,
}

#[allow(clippy::too_many_arguments)]
fn spazza_pezzo(
    b: &Bez,
    scala: f64,
    ta: f64,
    tb: f64,
    fascia: &Fascia,
    s: f64,
    piegato: bool,
    u: &mut Uscita<'_>,
    profondita: usize,
) {
    if profondita < MAX_DEPTH && giro_di(b, scala, ta, tb, s) > QUARTO + 1e-9 {
        let tm = (ta + tb) / 2.0;
        spazza_pezzo(b, scala, ta, tm, fascia, s, piegato, u, profondita + 1);
        spazza_pezzo(b, scala, tm, tb, fascia, s, piegato, u, profondita + 1);
        return;
    }
    if piegato && s != 0.0 && spazza_piegato(b, scala, ta, tb, fascia, s, u, profondita) {
        return;
    }
    let verso = scosta_cubica(b, scala, ta, tb, &fascia.verso);
    let via = scosta_cubica(b, scala, ta, tb, &fascia.via.con_segno(-1.0));
    u.catena.aggiungi(verso, via);
}

#[allow(clippy::too_many_arguments)]
fn spazza_piegato(
    b: &Bez,
    scala: f64,
    ta: f64,
    tb: f64,
    fascia: &Fascia,
    s: f64,
    u: &mut Uscita<'_>,
    profondita: usize,
) -> bool {
    let dentro = if s > 0.0 {
        fascia.verso.clone()
    } else {
        fascia.via.con_segno(-1.0)
    };
    let fuori = if s > 0.0 {
        fascia.via.con_segno(-1.0)
    } else {
        fascia.verso.clone()
    };
    let (pa, pb) = (bez_punto(b, ta), bez_punto(b, tb));
    let (na, nb) = (
        normale(verso_in(b, ta, 1.0, scala)),
        normale(verso_in(b, tb, -1.0, scala)),
    );
    let attraverso = vettoriale(na, nb);
    let salto = meno(pb, pa);
    let (la, lb) = (
        vettoriale(salto, nb) / attraverso,
        vettoriale(salto, na) / attraverso,
    );
    let (sa, sb) = (dentro.in_(ta), dentro.in_(tb));
    if !(la / sa > 0.0 && la / sa < 1.0 && lb / sb > 0.0 && lb / sb < 1.0) {
        if profondita >= MAX_DEPTH {
            return false;
        }
        let tm = (ta + tb) / 2.0;
        spazza_pezzo(b, scala, ta, tm, fascia, s, true, u, profondita + 1);
        spazza_pezzo(b, scala, tm, tb, fascia, s, true, u, profondita + 1);
        return true;
    }
    let x = piu(pa, per(na, la));
    u.catena.chiudi(u.out);
    let esterno = scosta_cubica(b, scala, ta, tb, &fuori);
    let interno = scosta_cubica(b, scala, ta, tb, &dentro);
    let mut curve = esterno.curve;
    curve.push(linea(x));
    spingi_anello(u.out, esterno.inizio, curve);
    let mut curve = vec![linea(interno.inizio)];
    curve.extend(interno.curve);
    spingi_anello(u.out, x, curve);
    if let (Some(ea), Some(eb)) = (centro_in(b, ta, scala), centro_in(b, tb, scala)) {
        spingi_anello(u.out, x, vec![linea(ea), linea(eb)]);
    }
    true
}

fn spazza_cubica(b: &Bez, scala: f64, fascia: &Fascia, u: &mut Uscita<'_>) {
    let cusp = cuspidi(b, scala);
    let mut tagli = vec![0.0];
    tagli.extend(cusp.iter().copied());
    tagli.extend(flessi(b));
    tagli.push(1.0);
    tagli.sort_by(|m, n| m.partial_cmp(n).unwrap_or(std::cmp::Ordering::Equal));
    for i in 0..tagli.len() - 1 {
        let (ta, tb) = (tagli[i], tagli[i + 1]);
        if tb - ta > 1e-12 {
            let mezzo = (ta + tb) / 2.0;
            let s = segno(vettoriale(bez_prima(b, mezzo), bez_seconda(b, mezzo)));
            let dentro = if s > 0.0 {
                fascia.verso.clone()
            } else {
                fascia.via.clone()
            };
            let f = |t: f64| -> f64 {
                let d = bez_prima(b, t);
                norma(d).powf(3.0) - dentro.in_(t) * vettoriale(d, bez_seconda(b, t)).abs()
            };
            let mut limiti = vec![ta];
            if s != 0.0 {
                limiti.extend(radici_di(&f, ta, tb));
            }
            limiti.push(tb);
            for k in 0..limiti.len() - 1 {
                let (t0, t1) = (limiti[k], limiti[k + 1]);
                if t1 - t0 > 1e-12 {
                    let piegato = f((t0 + t1) / 2.0) < 0.0;
                    spazza_pezzo(b, scala, t0, t1, fascia, s, piegato, u, 0);
                }
            }
        }
        if i + 2 < tagli.len() && cusp.contains(&tb) {
            u.catena.chiudi(u.out);
            let h = jmax(fascia.verso.in_(tb), fascia.via.in_(tb));
            if h > 0.0 {
                spingi_disco(u.out, bez_punto(b, tb), h);
            }
        }
    }
}

/// Un arco di cerchio con le parti del contorno ferme.
fn spazza_cerchio(e: &Elemento, (verso, via): (f64, f64), u: &mut Uscita<'_>) {
    let Elemento::Cerchio {
        centro,
        raggio: r,
        inizio,
        delta,
        ..
    } = *e
    else {
        return;
    };
    let pezzi = jmax(1.0, (delta.abs() / QUARTO - 1e-9).ceil()) as usize;
    let avanti = delta > 0.0;
    let (h, lontano) = if avanti { (verso, via) } else { (via, verso) };
    let lato = |a0: f64, a1: f64, raggio: f64| -> Lato {
        let (da, a) = (
            sul_cerchio(centro, raggio, a0),
            sul_cerchio(centro, raggio, a1),
        );
        Lato {
            inizio: da,
            curve: vec![arco(raggio, avanti, a)],
            fine: a,
        }
    };
    for k in 0..pezzi {
        let (a0, a1) = (
            inizio + (delta * k as f64) / pezzi as f64,
            inizio + (delta * (k + 1) as f64) / pezzi as f64,
        );
        if h < r {
            let (interno, esterno) = (lato(a0, a1, r - h), lato(a0, a1, r + lontano));
            if avanti {
                u.catena.aggiungi(interno, esterno);
            } else {
                u.catena.aggiungi(esterno, interno);
            }
            continue;
        }
        u.catena.chiudi(u.out);
        spingi_anello(
            u.out,
            centro,
            vec![
                linea(sul_cerchio(centro, r + lontano, a0)),
                arco(r + lontano, avanti, sul_cerchio(centro, r + lontano, a1)),
            ],
        );
        if h > r {
            spingi_anello(
                u.out,
                centro,
                vec![
                    linea(sul_cerchio(centro, h - r, a0 + PI)),
                    arco(h - r, avanti, sul_cerchio(centro, h - r, a1 + PI)),
                ],
            );
        }
    }
}

/// Un pezzo col suo contorno.
fn spazza(e: &Elemento, fascia: &Fascia, u: &mut Uscita<'_>) {
    match *e {
        Elemento::Linea { da, a } => {
            let Some((verso, via)) = fascia.ferma else {
                let bez = [da, lerp(da, a, 1.0 / 3.0), lerp(da, a, 2.0 / 3.0), a];
                spazza_cubica(&bez, norma(meno(a, da)), fascia, u);
                return;
            };
            let n = normale(unita(meno(a, da)));
            let (tv, tw) = (per(n, verso), per(n, via));
            u.catena.aggiungi(
                dritto(piu(da, tv), piu(a, tv)),
                dritto(meno(da, tw), meno(a, tw)),
            );
        }
        Elemento::Cubica { bez, scala } => spazza_cubica(&bez, scala, fascia, u),
        Elemento::Cerchio { .. } => match fascia.ferma {
            Some(ferma) => spazza_cerchio(e, ferma, u),
            None => {
                for pezzo in cubiche_del_cerchio(e) {
                    if let Elemento::Cubica { bez, scala } = pezzo {
                        spazza_cubica(&bez, scala, fascia, u);
                    }
                }
            }
        },
    }
}

/// Le cubiche di un arco di cerchio.
fn cubiche_del_cerchio(e: &Elemento) -> Vec<Elemento> {
    let Elemento::Cerchio {
        da,
        a,
        centro,
        raggio,
        inizio,
        delta,
    } = *e
    else {
        return Vec::new();
    };
    let pezzi = pezzi_dell_arco(raggio, delta);
    let passo = delta / pezzi as f64;
    let k = (4.0 / 3.0) * (passo / 4.0).tan() * raggio;
    (0..pezzi)
        .map(|i| {
            let (ta, tb) = (inizio + passo * i as f64, inizio + passo * (i + 1) as f64);
            let p0 = if i == 0 {
                da
            } else {
                sul_cerchio(centro, raggio, ta)
            };
            let p3 = if i == pezzi - 1 {
                a
            } else {
                sul_cerchio(centro, raggio, tb)
            };
            let bez: Bez = [
                p0,
                piu(p0, per([-ta.sin(), ta.cos()], k)),
                meno(p3, per([-tb.sin(), tb.cos()], k)),
                p3,
            ];
            Elemento::Cubica {
                bez,
                scala: gambe(&bez),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Giunti ed estremi.
// ---------------------------------------------------------------------------

/// Vero se fra `d0` e `d1` non serve un giunto.
fn liscio(d0: P, d1: P, h: f64) -> bool {
    svolta(d0, d1).abs() * h <= OFFSET_ERROR
}

/// Il giunto in `p` fra una curva che arriva con `d0` e una che parte con
/// `d1`.
fn giunto(p: P, d0: P, d1: P, (verso, via): (f64, f64), stile: WidthJoin, out: &mut Vec<Anello>) {
    let giro = svolta(d0, d1);
    let portata = if giro > 0.0 { -via } else { verso };
    let h = portata.abs();
    if !(h > 0.0) {
        return;
    }
    let (n0, n1) = (normale(d0), normale(d1));
    let (a, b) = (piu(p, per(n0, portata)), piu(p, per(n1, portata)));
    if stile == WidthJoin::Round {
        let mut curve = vec![linea(a)];
        curve.extend(archi_attorno(p, h, a, giro, b));
        spingi_anello(out, p, curve);
        return;
    }
    let meta = giro.abs() / 2.0;
    if stile == WidthJoin::Miter && 1.0 / meta.cos() <= PROFILE_MITER_LIMIT {
        let spigolo = piu(p, per(unita(piu(n0, n1)), portata / meta.cos()));
        spingi_anello(out, p, vec![linea(a), linea(spigolo), linea(b)]);
        return;
    }
    spingi_anello(out, p, vec![linea(a), linea(b)]);
}

/// L'estremo in `p` di un sottotracciato aperto, verso `e`.
fn estremo(p: P, e: P, lato: f64, altro: f64, stile: WidthCap, out: &mut Vec<Anello>) {
    let h = (lato + altro) / 2.0;
    if !(h > 0.0) {
        return;
    }
    let n = normale(e);
    let (a, b) = (piu(p, per(n, lato)), meno(p, per(n, altro)));
    match stile {
        WidthCap::Square => {
            let f = per(e, h);
            spingi_anello(out, a, vec![linea(piu(a, f)), linea(piu(b, f)), linea(b)]);
        }
        WidthCap::Round => {
            let curve = archi_attorno(lerp(a, b, 0.5), h, a, -PI, b);
            spingi_anello(out, a, curve);
        }
        WidthCap::Butt => {}
    }
}

// ---------------------------------------------------------------------------
// Lo spessore variabile.
// ---------------------------------------------------------------------------

/// Un pezzo fra due punti del profilo, col suo contorno.
struct Pezzo {
    elemento: Elemento,
    apre: bool,
    fascia: Fascia,
}

/// Vero se il lato del tratto non cambia.
fn piatto(lato: &[f64; 4]) -> bool {
    lato[0] == lato[1] && lato[2] == 0.0 && lato[3] == 0.0
}

/// Le parti del contorno di `e`, una linea o una cubica, che comincia alla
/// frazione `ua` di un sottotracciato lungo `totale`, dentro `tratto`.
fn fascia_del_profilo(e: &Elemento, ua: f64, tratto: Tratto, totale: f64) -> Fascia {
    let misura = Rc::new(Misura::di(e));
    let cubica = match *e {
        Elemento::Cubica { bez, .. } => Some(bez),
        _ => None,
    };
    let lato = |k: usize| -> Portata {
        let (m1, m2) = (misura.clone(), misura.clone());
        let u1 = move |t: f64| ua + m1.lunghezza_a(t) / totale;
        let u2 = move |t: f64| ua + m2.lunghezza_a(t) / totale;
        let m3 = misura.clone();
        let velocita = move |t: f64| match cubica {
            Some(bez) => norma(bez_prima(&bez, t)),
            None => m3.totale(),
        };
        Portata {
            a: Rc::new(move |t| tratto.larghezze(u1(t))[k]),
            pendenza: Rc::new(move |t| (tratto.pendenze(u2(t))[k] * velocita(t)) / totale),
        }
    };
    Fascia {
        verso: lato(1),
        via: lato(0),
        ferma: None,
    }
}

/// I pezzi di `sotto` coi loro contorni.
fn tratti_di(sotto: &Sotto, tratti: &[Tratto]) -> Vec<Pezzo> {
    let misure: Vec<Misura> = sotto.elementi.iter().map(Misura::di).collect();
    let totale: f64 = misure.iter().fold(0.0, |s, m| s + m.totale());
    if !(totale > STILL) {
        return Vec::new();
    }
    let mut nodi: Vec<f64> = Vec::new();
    for t in tratti {
        if !nodi.contains(&t.t0) {
            nodi.push(t.t0);
        }
    }
    nodi.retain(|&u| u > 0.0 && u < 1.0);
    let mut out = Vec::new();
    let spingi = |e: Elemento, apre: bool, ua: f64, ub: f64, out: &mut Vec<Pezzo>| {
        let tratto = tratti[super::tratto_in(tratti, (ua + ub) / 2.0)];
        if piatto(&tratto.sinistra) && piatto(&tratto.destra) {
            out.push(Pezzo {
                elemento: e,
                apre,
                fascia: fascia_ferma(tratto.destra[0], tratto.sinistra[0]),
            });
        } else if matches!(e, Elemento::Cerchio { .. }) {
            let mut u = ua;
            for (i, pezzo) in cubiche_del_cerchio(&e).into_iter().enumerate() {
                out.push(Pezzo {
                    elemento: pezzo,
                    apre: apre && i == 0,
                    fascia: fascia_del_profilo(&pezzo, u, tratto, totale),
                });
                u += Misura::di(&pezzo).totale() / totale;
            }
        } else {
            out.push(Pezzo {
                elemento: e,
                apre,
                fascia: fascia_del_profilo(&e, ua, tratto, totale),
            });
        }
    };
    let mut inizio = 0.0;
    for (i, e) in sotto.elementi.iter().enumerate() {
        let misura = &misure[i];
        let fine = inizio + misura.totale();
        let mut tagli = vec![0.0];
        tagli.extend(
            nodi.iter()
                .map(|u| u * totale)
                .filter(|&s| s > inizio + STILL && s < fine - STILL)
                .map(|s| misura.parametro(s - inizio)),
        );
        tagli.push(1.0);
        for k in 0..tagli.len() - 1 {
            let (t0, t1) = (tagli[k], tagli[k + 1]);
            if t1 - t0 <= 1e-12 {
                continue;
            }
            let parte = if t0 == 0.0 && t1 == 1.0 {
                *e
            } else {
                parte_di(e, t0, t1)
            };
            spingi(
                parte,
                k == 0,
                (inizio + misura.lunghezza_a(t0)) / totale,
                (inizio + misura.lunghezza_a(t1)) / totale,
                &mut out,
            );
        }
        inizio = fine;
    }
    out
}

/// Gli anelli di un sottotracciato col contorno del profilo `tratti`.
fn sottotracciato(
    sotto: &Sotto,
    tratti: &[Tratto],
    cap: WidthCap,
    join: WidthJoin,
    out: &mut Vec<Anello>,
) {
    let pezzi = tratti_di(sotto, tratti);
    let n = pezzi.len();
    if n == 0 {
        return;
    }
    let larghezze = |prima: &Pezzo, dopo: &Pezzo| -> (f64, f64) {
        (
            jmax(prima.fascia.verso.in_(1.0), dopo.fascia.verso.in_(0.0)),
            jmax(prima.fascia.via.in_(1.0), dopo.fascia.via.in_(0.0)),
        )
    };
    let spigolo = |prima: &Pezzo, dopo: &Pezzo| -> bool {
        let (a, b) = larghezze(prima, dopo);
        dopo.apre
            && !liscio(
                verso_finale(&prima.elemento),
                verso_iniziale(&dopo.elemento),
                jmax(a, b),
            )
    };
    let mut ordine: Vec<usize> = (0..n).collect();
    let mut chiudendo = false;
    if sotto.chiuso {
        if let Some(k) = (0..n).find(|&i| spigolo(&pezzi[(i + n - 1) % n], &pezzi[i])) {
            ordine = (k..n).chain(0..k).collect();
            chiudendo = true;
        }
    }
    let mut catena = Catena::default();
    let unisci = |prima: &Pezzo, dopo: &Pezzo, catena: &mut Catena, out: &mut Vec<Anello>| {
        if !spigolo(prima, dopo) {
            return;
        }
        catena.chiudi(out);
        giunto(
            inizio_di(&dopo.elemento),
            verso_finale(&prima.elemento),
            verso_iniziale(&dopo.elemento),
            larghezze(prima, dopo),
            join,
            out,
        );
    };
    for (i, &j) in ordine.iter().enumerate() {
        if i > 0 {
            unisci(&pezzi[ordine[i - 1]], &pezzi[j], &mut catena, out);
        }
        let s = &pezzi[j];
        spazza(
            &s.elemento,
            &s.fascia,
            &mut Uscita {
                catena: &mut catena,
                out,
            },
        );
    }
    if chiudendo {
        unisci(&pezzi[ordine[n - 1]], &pezzi[ordine[0]], &mut catena, out);
    }
    catena.chiudi(out);
    if !sotto.chiuso {
        let (primo, ultimo) = (&pezzi[ordine[0]], &pezzi[ordine[n - 1]]);
        estremo(
            inizio_di(&primo.elemento),
            per(verso_iniziale(&primo.elemento), -1.0),
            primo.fascia.via.in_(0.0),
            primo.fascia.verso.in_(0.0),
            cap,
            out,
        );
        estremo(
            fine_di(&ultimo.elemento),
            verso_finale(&ultimo.elemento),
            ultimo.fascia.verso.in_(1.0),
            ultimo.fascia.via.in_(1.0),
            cap,
            out,
        );
    }
}

/// Gli anelli del contorno a spessore variabile lungo `segmenti`, come
/// sottotracciati in verso positivo (`profileLoops`).
pub(crate) fn anelli(
    segmenti: &[Segmento],
    tratti: &[Tratto],
    cap: WidthCap,
    join: WidthJoin,
) -> Vec<Segmento> {
    let mut out = Vec::new();
    if tratti.is_empty() {
        return Vec::new();
    }
    for sotto in sottotracciati(segmenti) {
        sottotracciato(&sotto, tratti, cap, join, &mut out);
    }
    let mut segmenti = Vec::new();
    for a in out {
        segmenti.push(Segmento::Muovi(a.inizio));
        segmenti.extend(a.curve.into_iter().map(Segmento::Curva));
        segmenti.push(Segmento::Chiudi);
    }
    segmenti
}
