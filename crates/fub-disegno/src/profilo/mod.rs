//! Lo spessore di una linea a spessore variabile (`fub:shape="width"`): il
//! profilo riscalato e il contorno pieno che il file scrive in `d`.
//!
//! È ciò che fa `widthTo` del client
//! (`apps/client/src/editors/spatial/tools/look/write.ts`) quando il
//! pannello cambia lo spessore: tutto il profilo si allarga o si stringe
//! nella stessa proporzione, perché il punto più largo sia spesso quanto
//! chiesto; `fub:geom` si riscrive coi numeri del formato
//! (`writeVarWidth`, `scene/varwidth.ts`), si rilegge, e dal profilo riletto
//! si calcola il contorno (`widthAttrs`, `tools/profile.ts`;
//! `profileArea`, `tools/offset.ts`; l'unione, `tools/boolean.ts`).
//!
//! Il TypeScript è il riferimento: i calcoli sono i suoi, nello stesso
//! ordine, e i vettori di `tests/corpus/spessore-variabile.json`, scritti
//! dal client, dicono che il `d` coincide entro un centesimo.

// `!(x > 0.0)` è voluto: è il `!(x > 0)` del TypeScript, vero anche per
// `NaN`, e i calcoli devono andare per gli stessi rami.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

mod contorno;
mod curve;
mod unione;

use fub_scene::varwidth::{read_var_width, VarWidth, WidthCap, WidthJoin, MAX_POINTS, MIN_POINTS};

use crate::differenza::numero;
use curve::{jmax, jmin, leggi_d, scrivi_d, segno};

/// I decimali della posizione di un punto del profilo; le larghezze ne
/// hanno due, come la geometria.
const AT_DECIMALS: usize = 4;

/// `fub:geom` e `d` di una linea a spessore variabile.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Scritto {
    pub geom: String,
    pub d: String,
}

/// Lo spessore di `profilo`: la larghezza più grande fra i suoi punti, da
/// un lato all'altro (`profileWidth`).
pub(crate) fn spessore(profilo: &[[f64; 3]]) -> f64 {
    profilo
        .iter()
        .fold(0.0, |m, [_, sinistra, destra]| jmax(m, sinistra + destra))
}

/// La linea `v` spessa `larghezza` nel punto più largo (`widthTo` senza
/// estremi e angoli nuovi): `None` se non cambia niente che si scriva, come
/// uno spessore 0, o se il contorno non riesce.
pub(crate) fn con_spessore(v: &VarWidth, larghezza: f64) -> Option<Scritto> {
    let k = larghezza / spessore(&v.profile);
    if !(k > 0.0 && k.is_finite()) {
        return None;
    }
    let profilo: Vec<[f64; 3]> = v
        .profile
        .iter()
        .map(|&[t, sinistra, destra]| [t, sinistra * k, destra * k])
        .collect();
    let linea = leggi_d(&v.spine).unwrap_or_default();
    attributi(v.cap, v.join, &profilo, &linea)
}

fn parola_cap(c: WidthCap) -> &'static str {
    match c {
        WidthCap::Butt => "butt",
        WidthCap::Round => "round",
        WidthCap::Square => "square",
    }
}

fn parola_join(j: WidthJoin) -> &'static str {
    match j {
        WidthJoin::Miter => "miter",
        WidthJoin::Round => "round",
        WidthJoin::Bevel => "bevel",
    }
}

/// Un numero arrotondato come lo scrive il formato, e riletto.
fn arrotondato(v: f64, decimali: usize) -> f64 {
    numero(v, decimali).parse().unwrap_or(0.0)
}

/// Il profilo come lo scrive FubDraw (`writtenProfile`).
fn profilo_scritto(profilo: &[[f64; 3]]) -> Option<Vec<[f64; 3]>> {
    if profilo.len() < MIN_POINTS {
        return None;
    }
    let ultimo = profilo.len() - 1;
    let mut prima = 0.0;
    let arrotondati: Vec<[f64; 3]> = profilo
        .iter()
        .enumerate()
        .map(|(k, &[t, sinistra, destra])| {
            let posto = if k == 0 {
                0.0
            } else if k == ultimo {
                1.0
            } else {
                jmax(prima, jmin(1.0, arrotondato(t, AT_DECIMALS)))
            };
            prima = posto;
            [
                posto,
                jmax(0.0, arrotondato(sinistra, 2)),
                jmax(0.0, arrotondato(destra, 2)),
            ]
        })
        .collect();
    let dentro: Vec<[f64; 3]> = arrotondati
        .iter()
        .enumerate()
        .filter(|(k, p)| *k == 0 || *k == ultimo || (p[0] > 0.0 && p[0] < 1.0))
        .map(|(_, p)| *p)
        .collect();
    let n = dentro.len();
    let fuori: Vec<[f64; 3]> = dentro
        .iter()
        .enumerate()
        .filter(|&(k, p)| {
            !(k > 0 && k < n - 1 && dentro[k - 1][0] == p[0] && dentro[k + 1][0] == p[0])
        })
        .map(|(_, p)| *p)
        .collect();
    if fuori.len() > MAX_POINTS || !fuori.iter().any(|p| p[1] > 0.0 || p[2] > 0.0) {
        return None;
    }
    Some(fuori)
}

/// `fub:geom` coi numeri del formato (`writeVarWidth`); `None` se scritto non
/// si rilegge.
fn scrivi_geom(
    cap: WidthCap,
    join: WidthJoin,
    profilo: &[[f64; 3]],
    linea: &[curve::Segmento],
) -> Option<String> {
    let punti = profilo_scritto(profilo)?;
    let numeri: Vec<String> = punti
        .iter()
        .map(|&[t, sinistra, destra]| {
            format!(
                "{} {} {}",
                numero(t, AT_DECIMALS),
                numero(sinistra, 2),
                numero(destra, 2)
            )
        })
        .collect();
    let geom = format!(
        "{} {} {} {}",
        parola_cap(cap),
        parola_join(join),
        numeri.join(" "),
        scrivi_d(linea)
    );
    read_var_width(&geom).map(|_| geom)
}

/// `fub:geom` e `d` (`widthAttrs`): il contorno viene dalla geometria
/// scritta e riletta; `None` se non si scrive, o se il contorno non riesce
/// o non dipinge niente.
fn attributi(
    cap: WidthCap,
    join: WidthJoin,
    profilo: &[[f64; 3]],
    linea: &[curve::Segmento],
) -> Option<Scritto> {
    let geom = scrivi_geom(cap, join, profilo, linea)?;
    let scritta = read_var_width(&geom)?;
    let linea = leggi_d(&scritta.spine).unwrap_or_default();
    let anelli = contorno::anelli(&linea, &tratti(&scritta.profile), scritta.cap, scritta.join);
    if anelli.is_empty() {
        return None;
    }
    let area = unione::unione(&anelli, unione::MAX_PIECES).ok()?;
    if area.is_empty() {
        return None;
    }
    Some(Scritto {
        geom,
        d: scrivi_d(&area),
    })
}

// ---------------------------------------------------------------------------
// Le larghezze lungo la linea (`scene/varwidth.ts`).
// ---------------------------------------------------------------------------

/// Un tratto del profilo fra due punti con posizioni diverse: per ogni lato
/// le larghezze ai capi e le pendenze, per unità di `t` (Hermite).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Tratto {
    pub t0: f64,
    pub t1: f64,
    pub sinistra: [f64; 4],
    pub destra: [f64; 4],
}

impl Tratto {
    fn s(&self, t: f64) -> (f64, f64) {
        let h = self.t1 - self.t0;
        (h, jmin(1.0, jmax(0.0, (t - self.t0) / h)))
    }

    /// Le larghezze a sinistra e a destra in `t` (`spanWidths`).
    pub(crate) fn larghezze(&self, t: f64) -> [f64; 2] {
        let (h, s) = self.s(t);
        [
            jmax(0.0, hermite(&self.sinistra, h, s)),
            jmax(0.0, hermite(&self.destra, h, s)),
        ]
    }

    /// Quanto cambiano le larghezze in `t` (`spanSlopes`).
    pub(crate) fn pendenze(&self, t: f64) -> [f64; 2] {
        let (h, s) = self.s(t);
        [
            pendenza_hermite(&self.sinistra, h, s),
            pendenza_hermite(&self.destra, h, s),
        ]
    }
}

fn hermite(&[w0, w1, m0, m1]: &[f64; 4], h: f64, s: f64) -> f64 {
    let s2 = s * s;
    let s3 = s2 * s;
    (2.0 * s3 - 3.0 * s2 + 1.0) * w0
        + (s3 - 2.0 * s2 + s) * h * m0
        + (-2.0 * s3 + 3.0 * s2) * w1
        + (s3 - s2) * h * m1
}

fn pendenza_hermite(&[w0, w1, m0, m1]: &[f64; 4], h: f64, s: f64) -> f64 {
    let s2 = s * s;
    ((6.0 * s2 - 6.0 * s) * w0
        + (3.0 * s2 - 4.0 * s + 1.0) * h * m0
        + (-6.0 * s2 + 6.0 * s) * w1
        + (3.0 * s2 - 2.0 * s) * h * m1)
        / h
}

/// Le pendenze di `pchip` nei punti `ts` di larghezze `ws`.
fn pendenze_pchip(ts: &[f64], ws: &[f64]) -> Vec<f64> {
    let n = ts.len();
    let h: Vec<f64> = (0..n - 1).map(|k| ts[k + 1] - ts[k]).collect();
    let d: Vec<f64> = (0..n - 1).map(|k| (ws[k + 1] - ws[k]) / h[k]).collect();
    if n == 2 {
        return vec![d[0], d[0]];
    }
    let mut m = vec![0.0; n];
    for k in 1..n - 1 {
        let (prima, dopo) = (d[k - 1], d[k]);
        if segno(prima) * segno(dopo) <= 0.0 {
            continue;
        }
        let w1 = 2.0 * h[k] + h[k - 1];
        let w2 = h[k] + 2.0 * h[k - 1];
        m[k] = (w1 + w2) / (w1 / prima + w2 / dopo);
    }
    let capo = |h0: f64, h1: f64, d0: f64, d1: f64| -> f64 {
        let pendenza = ((2.0 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if segno(pendenza) != segno(d0) {
            return 0.0;
        }
        if segno(d0) != segno(d1) && pendenza.abs() > (3.0 * d0).abs() {
            return 3.0 * d0;
        }
        pendenza
    };
    m[0] = capo(h[0], h[1], d[0], d[1]);
    m[n - 1] = capo(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    m
}

/// I tratti di `profilo` (`widthSpans`): i punti si dividono negli scalini,
/// e ogni fila fra due scalini ha le sue pendenze.
pub(crate) fn tratti(profilo: &[[f64; 3]]) -> Vec<Tratto> {
    let Some(primo) = profilo.first() else {
        return Vec::new();
    };
    let mut file: Vec<Vec<[f64; 3]>> = vec![vec![*primo]];
    for p in &profilo[1..] {
        let fila = file.last_mut().expect("una fila");
        if p[0] == fila[fila.len() - 1][0] {
            file.push(vec![*p]);
        } else {
            fila.push(*p);
        }
    }
    let mut out = Vec::new();
    for fila in &file {
        if fila.len() < 2 {
            continue;
        }
        let ts: Vec<f64> = fila.iter().map(|p| p[0]).collect();
        let sinistra = pendenze_pchip(&ts, &fila.iter().map(|p| p[1]).collect::<Vec<_>>());
        let destra = pendenze_pchip(&ts, &fila.iter().map(|p| p[2]).collect::<Vec<_>>());
        for k in 0..fila.len() - 1 {
            let (a, b) = (fila[k], fila[k + 1]);
            out.push(Tratto {
                t0: a[0],
                t1: b[0],
                sinistra: [a[1], b[1], sinistra[k], sinistra[k + 1]],
                destra: [a[2], b[2], destra[k], destra[k + 1]],
            });
        }
    }
    out
}

/// Il tratto dove sta `t` (`spanAt`): quello che comincia lì dopo uno
/// scalino, l'ultimo per `t` = 1.
pub(crate) fn tratto_in(tratti: &[Tratto], t: f64) -> usize {
    let (mut lo, mut hi) = (0usize, tratti.len().saturating_sub(1));
    while lo < hi {
        let mezzo = (lo + hi + 1) >> 1;
        if tratti[mezzo].t0 <= t {
            lo = mezzo;
        } else {
            hi = mezzo - 1;
        }
    }
    lo
}
