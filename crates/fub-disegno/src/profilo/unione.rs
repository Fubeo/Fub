//! L'unione degli anelli del contorno: il tracciato dell'area che coprono.
//! È `combine("union", …)` di `tools/boolean.ts` del client per una forma
//! sola, fatta per il calcolo (`built`), riempita `nonzero` e non scritta,
//! regola per regola: le spezzate, l'arrangiamento planare, le facce, gli
//! avvolgimenti e le curve ritrovate. Gli altri casi del client (più forme,
//! le altre operazioni, le regioni) non servono qui e non ci sono.
//!
//! L'ordine conta come nel client: i vertici si numerano nello stesso
//! ordine, e le mappe che il client scorre nell'ordine di inserimento
//! ([`Ordinata`]) si scorrono qui nello stesso.

use std::collections::HashMap;
use std::f64::consts::FRAC_PI_2 as QUARTO;
use std::hash::Hash;

use super::curve::{
    arco_centrato, derivata_a, distanza, dividi, ipot, jmax, jmin, punto_a, rovescia, uguali,
    Curva, Segmento, P,
};

/// I punti più vicini di così si fondono.
const EPSILON: f64 = 0.015;
/// Quanto la spezzata può scostarsi dalla curva.
const FLATNESS: f64 = 0.002;
/// Quanto un nodo fra due linee può scostarsi dalla retta che le unisce.
const COLLINEAR: f64 = 0.004;
/// I passi al più della spezzata di una curva.
const MAX_STEPS: f64 = 4096.0;
/// I giri al più per rendere planare l'arrangiamento.
const MAX_ROUNDS: usize = 16;
/// I pezzi al più delle spezzate dell'unione (`MAX_PIECES` di `offset.ts`).
pub(crate) const MAX_PIECES: usize = 250_000;

/// Perché l'unione non c'è (`Refusal` di `offset.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Rifiuto {
    /// Le spezzate passano [`MAX_PIECES`] pezzi.
    Complessa,
    /// Il calcolo non riesce.
    Fallita,
}

fn arrotonda(v: f64, fattore: f64) -> f64 {
    let r = (v * fattore + 0.5).floor();
    if r == 0.0 {
        0.0
    } else {
        r
    }
}

/// `a - b || c - d` di JavaScript: il primo se non è zero né `NaN`.
fn o(a: f64, b: f64) -> f64 {
    if a != 0.0 && !a.is_nan() {
        a
    } else {
        b
    }
}

/// Negativo se `p` viene prima di `q` da sinistra, poi dall'alto, al
/// centesimo.
fn a_sinistra(p: P, q: P) -> f64 {
    o(
        arrotonda(p[0], 100.0) - arrotonda(q[0], 100.0),
        arrotonda(p[1], 100.0) - arrotonda(q[1], 100.0),
    )
}

fn clamp01(t: f64) -> f64 {
    jmin(1.0, jmax(0.0, t))
}

fn ordine(v: f64) -> std::cmp::Ordering {
    if v < 0.0 {
        std::cmp::Ordering::Less
    } else if v > 0.0 {
        std::cmp::Ordering::Greater
    } else {
        std::cmp::Ordering::Equal
    }
}

/// Una mappa che si scorre nell'ordine di inserimento, come `Map` di
/// JavaScript.
struct Ordinata<K, V> {
    indice: HashMap<K, usize>,
    voci: Vec<(K, V)>,
}

impl<K: Hash + Eq + Copy, V> Ordinata<K, V> {
    fn nuova() -> Self {
        Ordinata {
            indice: HashMap::new(),
            voci: Vec::new(),
        }
    }

    fn get(&self, k: &K) -> Option<&V> {
        self.indice.get(k).map(|&i| &self.voci[i].1)
    }

    fn voce(&mut self, k: K, nuova: impl FnOnce() -> V) -> &mut V {
        let i = match self.indice.get(&k) {
            Some(&i) => i,
            None => {
                self.voci.push((k, nuova()));
                self.indice.insert(k, self.voci.len() - 1);
                self.voci.len() - 1
            }
        };
        &mut self.voci[i].1
    }

    fn len(&self) -> usize {
        self.voci.len()
    }
}

// ---------------------------------------------------------------------------
// Le curve della forma.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
struct Sorgente {
    da: P,
    curva: Curva,
}

/// `curva` come SVG la disegna: un arco senza centro è una linea.
fn disegnata(da: P, curva: Curva) -> Curva {
    match curva {
        Curva::Arco { a, .. } if arco_centrato(da, &curva).is_none() => Curva::Linea(a),
        _ => curva,
    }
}

/// Le curve della forma, in ordine; un sottotracciato aperto si chiude con
/// una linea.
fn sorgenti(segmenti: &[Segmento]) -> Vec<Sorgente> {
    let mut out = Vec::new();
    let mut aggiungi = |da: P, c: Curva| {
        out.push(Sorgente {
            da,
            curva: disegnata(da, c),
        });
    };
    let mut inizio = [0.0, 0.0];
    let mut corrente = [0.0, 0.0];
    let mut aperto = false;
    for s in segmenti {
        match *s {
            Segmento::Muovi(a) => {
                if aperto {
                    aggiungi(corrente, Curva::Linea(inizio));
                }
                aperto = false;
                inizio = a;
                corrente = a;
            }
            Segmento::Chiudi => {
                aggiungi(corrente, Curva::Linea(inizio));
                corrente = inizio;
                aperto = false;
            }
            Segmento::Curva(c) => {
                aggiungi(corrente, c);
                corrente = c.fine();
                aperto = true;
            }
        }
    }
    if aperto {
        aggiungi(corrente, Curva::Linea(inizio));
    }
    out
}

/// I passi che bastano alla spezzata di `s`, e quanto è lunga al più.
fn naturale(s: &Sorgente) -> (f64, f64) {
    let da = s.da;
    match s.curva {
        Curva::Linea(a) => (1.0, distanza(da, a)),
        Curva::Quad(c, a) => {
            let piega = ipot(da[0] - 2.0 * c[0] + a[0], da[1] - 2.0 * c[1] + a[1]);
            (
                (piega / (4.0 * FLATNESS)).sqrt().ceil(),
                distanza(da, c) + distanza(c, a),
            )
        }
        Curva::Cubica(c1, c2, a) => {
            let piega = jmax(
                ipot(da[0] - 2.0 * c1[0] + c2[0], da[1] - 2.0 * c1[1] + c2[1]),
                ipot(c1[0] - 2.0 * c2[0] + a[0], c1[1] - 2.0 * c2[1] + a[1]),
            );
            (
                ((3.0 * piega) / (4.0 * FLATNESS)).sqrt().ceil(),
                distanza(da, c1) + distanza(c1, c2) + distanza(c2, a),
            )
        }
        Curva::Arco { .. } => {
            let Some(arco) = arco_centrato(da, &s.curva) else {
                return (1.0, 0.0);
            };
            let raggio = jmax(arco.raggi[0], arco.raggi[1]);
            let passo = if raggio <= FLATNESS {
                QUARTO
            } else {
                2.0 * (1.0 - FLATNESS / raggio).acos()
            };
            ((arco.delta.abs() / passo).ceil(), raggio * arco.delta.abs())
        }
    }
}

/// I passi della spezzata di una curva con `(passi, lunghezza)` naturali.
fn passi_di((passi, lunghezza): (f64, f64), campata: f64) -> usize {
    let p = jmax(
        jmax(
            jmin(passi, (lunghezza / (2.0 * EPSILON)).floor()),
            (lunghezza / campata).ceil(),
        ),
        1.0,
    );
    if p.is_finite() {
        jmin(p, MAX_STEPS) as usize
    } else {
        1
    }
}

/// I punti che contengono `s`.
fn estensione(s: &Sorgente) -> Vec<P> {
    let da = s.da;
    match s.curva {
        Curva::Linea(a) => vec![da, a],
        Curva::Quad(c, a) => vec![da, c, a],
        Curva::Cubica(c1, c2, a) => vec![da, c1, c2, a],
        Curva::Arco { a, .. } => match arco_centrato(da, &s.curva) {
            Some(arco) => {
                let r = jmax(arco.raggi[0], arco.raggi[1]);
                vec![
                    da,
                    a,
                    [arco.centro[0] - r, arco.centro[1] - r],
                    [arco.centro[0] + r, arco.centro[1] + r],
                ]
            }
            None => vec![da, a],
        },
    }
}

// ---------------------------------------------------------------------------
// L'arrangiamento.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Taglio {
    u: f64,
    v: usize,
}

/// Le spezzate di tutte le curve, che si spezzano e si fondono finché
/// formano un grafo planare (`Net`).
struct Rete {
    sorgenti: Vec<Sorgente>,
    x: Vec<f64>,
    y: Vec<f64>,
    rango: Vec<u8>,
    primo: Vec<f64>,
    a: Vec<usize>,
    b: Vec<usize>,
    src: Vec<usize>,
    ta: Vec<f64>,
    tb: Vec<f64>,
    min: P,
    cella: f64,
    righe: i64,
    unioni: Vec<(usize, usize)>,
    noti: usize,
    nuovi: Vec<bool>,
}

impl Rete {
    fn nuova(sorgenti: Vec<Sorgente>) -> Rete {
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for s in &sorgenti {
            for [px, py] in estensione(s) {
                x0 = jmin(x0, px);
                y0 = jmin(y0, py);
                x1 = jmax(x1, px);
                y1 = jmax(y1, py);
            }
        }
        let naturali: Vec<(f64, f64)> = sorgenti.iter().map(naturale).collect();
        let (mut conta, mut totale) = (0.0, 0.0);
        for n in &naturali {
            conta += passi_di(*n, f64::INFINITY) as f64;
            totale += n.1;
        }
        let grossa = jmax(x1 - x0, y1 - y0) / 64.0;
        let fine = (4.0 * totale) / conta;
        let cella = jmax(
            if fine.is_finite() {
                jmin(grossa, fine)
            } else {
                grossa
            },
            16.0 * EPSILON,
        );
        let righe = ((y1 - y0 + 2.0) / cella).ceil() as i64 + 2;
        let mut rete = Rete {
            sorgenti: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            rango: Vec::new(),
            primo: Vec::new(),
            a: Vec::new(),
            b: Vec::new(),
            src: Vec::new(),
            ta: Vec::new(),
            tb: Vec::new(),
            min: [x0 - 1.0, y0 - 1.0],
            cella,
            righe,
            unioni: Vec::new(),
            noti: 0,
            nuovi: Vec::new(),
        };
        for (i, s) in sorgenti.iter().enumerate() {
            let passi = passi_di(naturali[i], cella);
            let mut prima = rete.vertice(s.da, 0, i as f64);
            for k in 1..=passi {
                let t = k as f64 / passi as f64;
                let dopo = if k == passi {
                    rete.vertice(s.curva.fine(), 0, f64::INFINITY)
                } else {
                    rete.vertice(punto_a(s.da, &s.curva, t), 2, f64::INFINITY)
                };
                rete.spingi(prima, dopo, i, (k - 1) as f64 / passi as f64, t);
                prima = dopo;
            }
        }
        rete.sorgenti = sorgenti;
        rete
    }

    fn vertice(&mut self, p: P, rango: u8, primo: f64) -> usize {
        self.x.push(p[0]);
        self.y.push(p[1]);
        self.rango.push(rango);
        self.primo.push(primo);
        self.x.len() - 1
    }

    fn in_(&self, v: usize) -> P {
        [self.x[v], self.y[v]]
    }

    fn spingi(&mut self, a: usize, b: usize, src: usize, ta: f64, tb: f64) {
        self.a.push(a);
        self.b.push(b);
        self.src.push(src);
        self.ta.push(ta);
        self.tb.push(tb);
        self.nuovi.push(true);
    }

    fn planare(&mut self, limite: usize) -> bool {
        for _ in 0..=MAX_ROUNDS {
            self.fondi();
            let tagli = self.tagli();
            if tagli.is_empty() && self.unioni.is_empty() {
                return true;
            }
            self.spezza(&tagli);
            if self.a.len() > limite {
                return false;
            }
        }
        false
    }

    fn fondi(&mut self) {
        let n = self.x.len();
        let mut padre: Vec<usize> = (0..n).collect();
        fn trova(padre: &mut [usize], mut v: usize) -> usize {
            while padre[v] != v {
                padre[v] = padre[padre[v]];
                v = padre[v];
            }
            v
        }
        let rango = &self.rango;
        let meglio = |u: usize, v: usize| rango[u] < rango[v] || (rango[u] == rango[v] && u < v);
        let unisci = |padre: &mut [usize], v: usize, w: usize| {
            let (rv, rw) = (trova(padre, v), trova(padre, w));
            if rv == rw {
                return;
            }
            if meglio(rv, rw) {
                padre[rw] = rv;
            } else {
                padre[rv] = rw;
            }
        };
        let mut vivi: Vec<usize> = Vec::new();
        let mut visti = vec![false; n];
        for estremi in [&self.a, &self.b] {
            for &v in estremi.iter() {
                if visti[v] {
                    continue;
                }
                visti[v] = true;
                vivi.push(v);
            }
        }
        let (x, y, min) = (&self.x, &self.y, self.min);
        let cella_di = |v: usize| -> (i64, i64) {
            (
                ((x[v] - min[0]) / EPSILON).floor() as i64,
                ((y[v] - min[1]) / EPSILON).floor() as i64,
            )
        };
        let mut griglia: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let incontra =
            |padre: &mut [usize], griglia: &HashMap<(i64, i64), Vec<usize>>, v: usize| {
                let (cx, cy) = cella_di(v);
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        if let Some(lista) = griglia.get(&(cx + dx, cy + dy)) {
                            for &w in lista {
                                if w != v && ipot(x[v] - x[w], y[v] - y[w]) <= EPSILON {
                                    unisci(padre, v, w);
                                }
                            }
                        }
                    }
                }
            };
        for &v in &vivi {
            if v < self.noti {
                continue;
            }
            incontra(&mut padre, &griglia, v);
            griglia.entry(cella_di(v)).or_default().push(v);
        }
        if !griglia.is_empty() {
            for &v in &vivi {
                if v < self.noti {
                    incontra(&mut padre, &griglia, v);
                }
            }
        }
        for &(v, w) in &self.unioni {
            unisci(&mut padre, v, w);
        }
        self.unioni.clear();
        self.noti = n;
        for &v in &vivi {
            let radice = trova(&mut padre, v);
            if radice != v {
                self.primo[radice] = jmin(self.primo[radice], self.primo[v]);
            }
        }
        let mut tenuti = Vec::new();
        for i in 0..self.a.len() {
            if trova(&mut padre, self.a[i]) != trova(&mut padre, self.b[i]) {
                tenuti.push(i);
            }
        }
        let mut nuovi = Vec::with_capacity(tenuti.len());
        let (mut a, mut b) = (
            Vec::with_capacity(tenuti.len()),
            Vec::with_capacity(tenuti.len()),
        );
        for &i in &tenuti {
            let (ra, rb) = (trova(&mut padre, self.a[i]), trova(&mut padre, self.b[i]));
            nuovi.push(self.nuovi[i] || ra != self.a[i] || rb != self.b[i]);
            a.push(ra);
            b.push(rb);
        }
        self.src = tenuti.iter().map(|&i| self.src[i]).collect();
        self.ta = tenuti.iter().map(|&i| self.ta[i]).collect();
        self.tb = tenuti.iter().map(|&i| self.tb[i]).collect();
        self.a = a;
        self.b = b;
        self.nuovi = nuovi;
    }

    /// Dove spezzare i pezzi in questo giro (`cuts`).
    fn tagli(&mut self) -> HashMap<usize, Vec<Taglio>> {
        let count = self.a.len();
        let mut scatola = vec![0i64; count * 4];
        let mut griglia: Ordinata<i64, Vec<usize>> = Ordinata::nuova();
        for i in 0..count {
            let (p, q) = (self.a[i], self.b[i]);
            let (x, y) = (&self.x, &self.y);
            let ix0 = ((jmin(x[p], x[q]) - EPSILON - self.min[0]) / self.cella).floor() as i64;
            let iy0 = ((jmin(y[p], y[q]) - EPSILON - self.min[1]) / self.cella).floor() as i64;
            let ix1 = ((jmax(x[p], x[q]) + EPSILON - self.min[0]) / self.cella).floor() as i64;
            let iy1 = ((jmax(y[p], y[q]) + EPSILON - self.min[1]) / self.cella).floor() as i64;
            scatola[i * 4..i * 4 + 4].copy_from_slice(&[ix0, iy0, ix1, iy1]);
            for ix in ix0..=ix1 {
                for iy in iy0..=iy1 {
                    griglia.voce(ix * self.righe + iy, Vec::new).push(i);
                }
            }
        }
        let mut out: HashMap<usize, Vec<Taglio>> = HashMap::new();
        let mut nuovi_vertici: Vec<P> = Vec::new();
        let base = self.x.len();
        let mut unioni: Vec<(usize, usize)> = Vec::new();
        {
            let (x, y, a, b, nuovi) = (&self.x, &self.y, &self.a, &self.b, &self.nuovi);
            let taglia = |out: &mut HashMap<usize, Vec<Taglio>>, pezzo: usize, u: f64, v: usize| {
                out.entry(pezzo).or_default().push(Taglio { u, v });
            };
            let vicino = |out: &mut HashMap<usize, Vec<Taglio>>,
                          unioni: &mut Vec<(usize, usize)>,
                          v: usize,
                          pezzo: usize|
             -> bool {
                let (p, q) = (a[pezzo], b[pezzo]);
                let dx = x[q] - x[p];
                let dy = y[q] - y[p];
                let u = ((x[v] - x[p]) * dx + (y[v] - y[p]) * dy) / (dx * dx + dy * dy);
                if !(u > 0.0 && u < 1.0) {
                    return false;
                }
                if ipot(x[p] + u * dx - x[v], y[p] + u * dy - y[v]) > EPSILON {
                    return false;
                }
                let lunghezza = ipot(dx, dy);
                if jmin(u, 1.0 - u) * lunghezza > EPSILON {
                    taglia(out, pezzo, u, v);
                } else {
                    unioni.push((v, if u < 0.5 { p } else { q }));
                }
                true
            };
            let orienta = |p: usize, q: usize, r: usize| -> f64 {
                (x[q] - x[p]) * (y[r] - y[p]) - (y[q] - y[p]) * (x[r] - x[p])
            };
            for (chiave, lista) in &griglia.voci {
                if !lista.iter().any(|&i| nuovi[i]) {
                    continue;
                }
                let cx = (*chiave as f64 / self.righe as f64).floor() as i64;
                let cy = chiave - cx * self.righe;
                for i in 0..lista.len() {
                    for j in i + 1..lista.len() {
                        let (p, q) = (lista[i], lista[j]);
                        if !nuovi[p] && !nuovi[q] {
                            continue;
                        }
                        if scatola[p * 4].max(scatola[q * 4]) != cx
                            || scatola[p * 4 + 1].max(scatola[q * 4 + 1]) != cy
                        {
                            continue;
                        }
                        let (a1, b1, a2, b2) = (a[p], b[p], a[q], b[q]);
                        if (a1 == a2 && b1 == b2) || (a1 == b2 && b1 == a2) {
                            continue;
                        }
                        let mut toccato = false;
                        for v in [a2, b2] {
                            if v != a1 && v != b1 && vicino(&mut out, &mut unioni, v, p) {
                                toccato = true;
                            }
                        }
                        for v in [a1, b1] {
                            if v != a2 && v != b2 && vicino(&mut out, &mut unioni, v, q) {
                                toccato = true;
                            }
                        }
                        if toccato || a1 == a2 || a1 == b2 || b1 == a2 || b1 == b2 {
                            continue;
                        }
                        let d1 = orienta(a1, b1, a2);
                        let d2 = orienta(a1, b1, b2);
                        let d3 = orienta(a2, b2, a1);
                        let d4 = orienta(a2, b2, b1);
                        if !((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
                            || !((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
                        {
                            continue;
                        }
                        let s = d3 / (d3 - d4);
                        let v = base + nuovi_vertici.len();
                        nuovi_vertici
                            .push([x[a1] + s * (x[b1] - x[a1]), y[a1] + s * (y[b1] - y[a1])]);
                        taglia(&mut out, p, s, v);
                        taglia(&mut out, q, d1 / (d1 - d2), v);
                    }
                }
            }
        }
        // Gli incroci vengono dopo i vertici che c'erano, e i confronti di
        // questo giro guardano solo quelli: si aggiungono ora, nello stesso
        // ordine.
        for p in nuovi_vertici {
            self.vertice(p, 1, f64::INFINITY);
        }
        self.unioni.extend(unioni);
        out
    }

    fn spezza(&mut self, tagli: &HashMap<usize, Vec<Taglio>>) {
        let n = self.a.len();
        let (mut a, mut b, mut src, mut ta, mut tb, mut nuovi) = (
            Vec::with_capacity(n),
            Vec::with_capacity(n),
            Vec::with_capacity(n),
            Vec::with_capacity(n),
            Vec::with_capacity(n),
            Vec::with_capacity(n),
        );
        for i in 0..n {
            let lista = tagli.get(&i);
            let mut da = self.a[i];
            let mut t = self.ta[i];
            if let Some(lista) = lista {
                let mut ordinati = lista.clone();
                ordinati.sort_by(|m, n| ordine(m.u - n.u));
                for Taglio { u, v } in ordinati {
                    let at = self.ta[i] + (self.tb[i] - self.ta[i]) * u;
                    a.push(da);
                    b.push(v);
                    src.push(self.src[i]);
                    ta.push(t);
                    tb.push(at);
                    nuovi.push(true);
                    da = v;
                    t = at;
                }
            }
            a.push(da);
            b.push(self.b[i]);
            src.push(self.src[i]);
            ta.push(t);
            tb.push(self.tb[i]);
            nuovi.push(lista.is_some());
        }
        self.a = a;
        self.b = b;
        self.src = src;
        self.ta = ta;
        self.tb = tb;
        self.nuovi = nuovi;
    }
}

// ---------------------------------------------------------------------------
// Lati, facce e avvolgimenti.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Lungo {
    src: usize,
    ta: f64,
    tb: f64,
}

/// Un lato del grafo, da `a` a `b` con `a < b`.
struct Lato {
    a: usize,
    b: usize,
    lungo: Vec<Lungo>,
    /// Di quanto cambia l'avvolgimento della forma.
    delta: i64,
}

fn lati_di(rete: &Rete) -> Vec<Lato> {
    let mut per_chiave: Ordinata<(usize, usize), Lato> = Ordinata::nuova();
    for i in 0..rete.a.len() {
        let (p, q) = (rete.a[i], rete.b[i]);
        let avanti = p < q;
        let chiave = if avanti { (p, q) } else { (q, p) };
        let lato = per_chiave.voce(chiave, || Lato {
            a: p.min(q),
            b: p.max(q),
            lungo: Vec::new(),
            delta: 0,
        });
        let src = rete.src[i];
        lato.lungo.push(if avanti {
            Lungo {
                src,
                ta: rete.ta[i],
                tb: rete.tb[i],
            }
        } else {
            Lungo {
                src,
                ta: rete.tb[i],
                tb: rete.ta[i],
            }
        });
        lato.delta += if avanti { 1 } else { -1 };
    }
    per_chiave
        .voci
        .into_iter()
        .map(|(_, l)| l)
        .filter(|l| l.delta != 0)
        .collect()
}

struct AnelloDiLati {
    meta: Vec<usize>,
}

/// Il grafo coi lati: ogni lato ha due mezzi lati, `2e` da `a` a `b` e
/// `2e + 1` all'inverso (`Graph`).
struct Grafo<'r> {
    rete: &'r Rete,
    lati: Vec<Lato>,
    attorno: Ordinata<usize, Vec<usize>>,
    posto: Vec<usize>,
    faccia: Vec<usize>,
    facce: usize,
    esterna: usize,
}

impl<'r> Grafo<'r> {
    fn nuovo(rete: &'r Rete, lati: Vec<Lato>) -> Grafo<'r> {
        let n = lati.len() * 2;
        let mut g = Grafo {
            rete,
            lati,
            attorno: Ordinata::nuova(),
            posto: vec![0; n],
            faccia: vec![usize::MAX; n],
            facce: 0,
            esterna: 0,
        };
        let mut angolo = vec![0.0; n];
        for (h, verso) in angolo.iter_mut().enumerate() {
            let (da, a) = (g.origine(h), g.arrivo(h));
            *verso = (rete.y[a] - rete.y[da]).atan2(rete.x[a] - rete.x[da]);
            g.attorno.voce(da, Vec::new).push(h);
        }
        for (_, lista) in &mut g.attorno.voci {
            lista.sort_by(|&p, &q| ordine(angolo[p] - angolo[q]));
            for (i, &h) in lista.iter().enumerate() {
                g.posto[h] = i;
            }
        }
        g
    }

    fn origine(&self, h: usize) -> usize {
        let l = &self.lati[h >> 1];
        if h & 1 == 1 {
            l.b
        } else {
            l.a
        }
    }

    fn arrivo(&self, h: usize) -> usize {
        let l = &self.lati[h >> 1];
        if h & 1 == 1 {
            l.a
        } else {
            l.b
        }
    }

    fn dopo(&self, h: usize) -> usize {
        let lista = self
            .attorno
            .get(&self.arrivo(h))
            .expect("un vertice del grafo");
        lista[(self.posto[h ^ 1] + lista.len() - 1) % lista.len()]
    }

    fn traccia(&mut self) -> bool {
        let rete = self.rete;
        let count = self.lati.len() * 2;
        let mut ciclo = vec![usize::MAX; count];
        let mut cicli = 0;
        for h in 0..count {
            if ciclo[h] != usize::MAX {
                continue;
            }
            let mut g = h;
            let mut passi = 0;
            loop {
                ciclo[g] = cicli;
                g = self.dopo(g);
                passi += 1;
                if passi > count {
                    return false;
                }
                if g == h {
                    break;
                }
            }
            cicli += 1;
        }
        let mut parti: HashMap<usize, usize> = HashMap::new();
        fn parte_di(parti: &mut HashMap<usize, usize>, v: usize) -> usize {
            let mut radice = v;
            while parti[&radice] != radice {
                radice = parti[&radice];
            }
            parti.insert(v, radice);
            radice
        }
        for (v, _) in &self.attorno.voci {
            parti.insert(*v, *v);
        }
        for l in &self.lati {
            let (ra, rb) = (parte_di(&mut parti, l.a), parte_di(&mut parti, l.b));
            if ra != rb {
                parti.insert(ra.max(rb), ra.min(rb));
            }
        }
        let mut sinistro: Ordinata<usize, usize> = Ordinata::nuova();
        for (v, _) in &self.attorno.voci {
            let v = *v;
            let radice = parte_di(&mut parti, v);
            let migliore = sinistro.voce(radice, || v);
            let m = *migliore;
            if rete.x[v] < rete.x[m] || (rete.x[v] == rete.x[m] && rete.y[v] < rete.y[m]) {
                *migliore = v;
            }
        }
        let mut facce: Vec<usize> = (0..=cicli).collect();
        fn trova(facce: &mut [usize], mut f: usize) -> usize {
            while facce[f] != f {
                facce[f] = facce[facce[f]];
                f = facce[f];
            }
            f
        }
        let unisci = |facce: &mut [usize], f: usize, g: usize| {
            let (rf, rg) = (trova(facce, f), trova(facce, g));
            if rf != rg {
                facce[rf.max(rg)] = rf.min(rg);
            }
        };
        let parte_del_lato: Vec<usize> = self
            .lati
            .iter()
            .map(|l| parte_di(&mut parti, l.a))
            .collect();
        let (mut y0, mut y1) = (f64::INFINITY, f64::NEG_INFINITY);
        for (v, _) in &self.attorno.voci {
            y0 = jmin(y0, rete.y[*v]);
            y1 = jmax(y1, rete.y[*v]);
        }
        let bande = if sinistro.len() > 1 {
            (self.lati.len() as f64).sqrt().ceil() as usize
        } else {
            1
        };
        let altezza = o(y1 - y0, 1.0);
        let banda = |y: f64| -> usize {
            let b = (((y - y0) / altezza) * bande as f64).floor();
            jmin((bande - 1) as f64, jmax(0.0, b)) as usize
        };
        let mut in_banda: Vec<Vec<usize>> = vec![Vec::new(); bande];
        for (e, l) in self.lati.iter().enumerate() {
            let (ya, yb) = (rete.y[l.a], rete.y[l.b]);
            for lista in &mut in_banda[banda(jmin(ya, yb))..=banda(jmax(ya, yb))] {
                lista.push(e);
            }
        }
        for &(radice, v) in &sinistro.voci {
            let lista = self.attorno.get(&v).expect("un vertice del grafo");
            let fuori = ciclo[lista[lista.len() - 1]];
            let (vx, vy) = (rete.x[v], rete.y[v]);
            let mut colpo: Option<usize> = None;
            let mut colpo_x = f64::NEG_INFINITY;
            let mut colpo_pendenza = f64::NEG_INFINITY;
            for &e in &in_banda[banda(rete.y[v])] {
                let l = &self.lati[e];
                if parte_del_lato[e] == radice {
                    continue;
                }
                let (mut lo, mut hi) = (l.a, l.b);
                if rete.y[lo] > rete.y[hi] {
                    std::mem::swap(&mut lo, &mut hi);
                }
                if !(rete.y[lo] <= vy && vy < rete.y[hi]) {
                    continue;
                }
                let pendenza = (rete.x[hi] - rete.x[lo]) / (rete.y[hi] - rete.y[lo]);
                let cx = rete.x[lo] + (vy - rete.y[lo]) * pendenza;
                if !(cx < vx) {
                    continue;
                }
                if cx > colpo_x || (cx == colpo_x && pendenza > colpo_pendenza) {
                    colpo = Some(e);
                    colpo_x = cx;
                    colpo_pendenza = pendenza;
                }
            }
            match colpo {
                None => unisci(&mut facce, fuori, cicli),
                Some(e) => {
                    let l = &self.lati[e];
                    let h = if rete.y[l.a] > rete.y[l.b] {
                        2 * e
                    } else {
                        2 * e + 1
                    };
                    unisci(&mut facce, fuori, ciclo[h]);
                }
            }
        }
        let mut ids: HashMap<usize, usize> = HashMap::new();
        let mut id_di = |facce: &mut [usize], f: usize| -> usize {
            let radice = trova(facce, f);
            let n = ids.len();
            *ids.entry(radice).or_insert(n)
        };
        self.esterna = id_di(&mut facce, cicli);
        for (h, &c) in ciclo.iter().enumerate().take(count) {
            self.faccia[h] = id_di(&mut facce, c);
        }
        self.facce = ids.len();
        true
    }

    /// L'avvolgimento di ogni faccia, dalla faccia esterna (`windings`).
    fn avvolgimenti(&self) -> Option<Vec<i64>> {
        let mut meta: Vec<Vec<usize>> = vec![Vec::new(); self.facce];
        for (h, &f) in self.faccia.iter().enumerate() {
            meta[f].push(h);
        }
        let mut out: Vec<Option<i64>> = vec![None; self.facce];
        out[self.esterna] = Some(0);
        let mut coda = vec![self.esterna];
        while let Some(f) = coda.pop() {
            let mut noto = out[f].expect("una faccia raggiunta");
            for &h in &meta[f] {
                let g = self.faccia[h ^ 1];
                let delta = self.lati[h >> 1].delta;
                let segno = if h & 1 == 1 { -1 } else { 1 };
                if g == f {
                    if delta != 0 {
                        return None;
                    }
                    continue;
                }
                noto -= segno * delta;
                let diverso = match out[g] {
                    None => {
                        out[g] = Some(noto);
                        coda.push(g);
                        false
                    }
                    Some(visto) => visto != noto,
                };
                noto += segno * delta;
                if diverso {
                    return None;
                }
            }
        }
        out.into_iter().collect()
    }

    /// Gli anelli dei mezzi lati che hanno a sinistra una faccia dentro e a
    /// destra no (`loops`).
    fn anelli(&self, pezzo: &[i64]) -> Option<Vec<AnelloDiLati>> {
        let count = self.faccia.len();
        let bordo = |h: usize| -> bool {
            let proprio = pezzo[self.faccia[h]];
            proprio >= 0 && proprio != pezzo[self.faccia[h ^ 1]]
        };
        let mut usati = vec![false; count];
        let mut out = Vec::new();
        for inizio in 0..count {
            if usati[inizio] || !bordo(inizio) {
                continue;
            }
            let mut meta = Vec::new();
            let mut h = inizio;
            loop {
                usati[h] = true;
                meta.push(h);
                let lista = self.attorno.get(&self.arrivo(h))?;
                let indietro = self.posto[h ^ 1];
                let mut dopo = None;
                for passo in 1..=lista.len() {
                    let g = lista[(indietro + lista.len() * 2 - passo) % lista.len()];
                    if bordo(g) {
                        dopo = Some(g);
                        break;
                    }
                }
                let dopo = dopo?;
                if (usati[dopo] && dopo != inizio) || meta.len() > count {
                    return None;
                }
                h = dopo;
                if h == inizio {
                    break;
                }
            }
            out.push(AnelloDiLati { meta });
        }
        Some(out)
    }
}

// ---------------------------------------------------------------------------
// Le curve ritrovate.
// ---------------------------------------------------------------------------

/// Il parametro di `s` più vicino a `p`, partendo da `t` (`project`).
fn proietta(s: &Sorgente, p: P, mut t: f64) -> f64 {
    let mut migliore = distanza(punto_a(s.da, &s.curva, t), p);
    let mut i = 0;
    while i < 16 && migliore > 0.0 {
        let q = punto_a(s.da, &s.curva, t);
        let d = derivata_a(s.da, &s.curva, t);
        let dd = d[0] * d[0] + d[1] * d[1];
        if !(dd > 0.0) {
            break;
        }
        let dopo = clamp01(t - ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / dd);
        let scarto = distanza(punto_a(s.da, &s.curva, dopo), p);
        if !(scarto < migliore) {
            break;
        }
        migliore = scarto;
        t = dopo;
        i += 1;
    }
    t
}

/// Dove `uno` e `altro` si incrociano, partendo da `s` e `t` (`crossing`).
fn incrocio(uno: &Sorgente, mut s: f64, altro: &Sorgente, mut t: f64) -> Option<(P, f64)> {
    for _ in 0..32 {
        let p = punto_a(uno.da, &uno.curva, s);
        let q = punto_a(altro.da, &altro.curva, t);
        let (fx, fy) = (p[0] - q[0], p[1] - q[1]);
        if ipot(fx, fy) < 1e-9 {
            return Some((p, s));
        }
        let d1 = derivata_a(uno.da, &uno.curva, s);
        let d2 = derivata_a(altro.da, &altro.curva, t);
        let det = d2[0] * d1[1] - d1[0] * d2[1];
        if !(det.abs() > 1e-9 * ipot(d1[0], d1[1]) * ipot(d2[0], d2[1])) {
            return None;
        }
        s = clamp01(s - (d2[0] * fy - fx * d2[1]) / det);
        t = clamp01(t - (d1[0] * fy - d1[1] * fx) / det);
    }
    None
}

/// Vero se `uno` fra `s0` e `s1` corre lungo `altro` (`alongside`).
fn accanto(uno: &Sorgente, s0: f64, s1: f64, altro: &Sorgente, mut t: f64) -> bool {
    for k in 0..=8 {
        let p = punto_a(uno.da, &uno.curva, s0 + ((s1 - s0) * f64::from(k)) / 8.0);
        t = proietta(altro, p, t);
        if distanza(punto_a(altro.da, &altro.curva, t), p) > 2.0 * EPSILON {
            return false;
        }
    }
    true
}

/// `curva` da `da` coi capi portati in `inizio` e `fine` (`moved`).
fn spostata(da: P, curva: &Curva, inizio: P, fine: P) -> Curva {
    let sposta = |p: P, era: P, ora: P| [p[0] + ora[0] - era[0], p[1] + ora[1] - era[1]];
    match *curva {
        Curva::Linea(_) => Curva::Linea(fine),
        Curva::Quad(c, _) => Curva::Quad(c, fine),
        Curva::Cubica(c1, c2, a) => {
            Curva::Cubica(sposta(c1, da, inizio), sposta(c2, a, fine), fine)
        }
        Curva::Arco {
            raggi,
            rotazione,
            grande,
            verso,
            ..
        } => Curva::Arco {
            raggi,
            rotazione,
            grande,
            verso,
            a: fine,
        },
    }
}

/// Il pezzo di `s` fra `t0` e `t1`, percorso da `t0` a `t1` (`pieceOf`).
fn pezzo_di(s: &Sorgente, t0: f64, t1: f64) -> (P, Curva) {
    let (mut da, mut curva) = (s.da, s.curva);
    let (lo, hi) = (jmin(t0, t1), jmax(t0, t1));
    if hi < 1.0 {
        curva = dividi(da, &curva, hi).0;
    }
    if lo > 0.0 {
        let (sinistra, destra) = dividi(da, &curva, lo / hi);
        da = sinistra.fine();
        curva = destra;
    }
    if t0 > t1 {
        let a = curva.fine();
        curva = rovescia(da, &curva);
        da = a;
    }
    (da, curva)
}

/// Un arco in archi di un quarto di giro al più (`quarters`).
fn quarti(da: P, curva: Curva) -> Vec<Curva> {
    let Curva::Arco { a, .. } = curva else {
        return vec![curva];
    };
    let Some(arco) = arco_centrato(da, &curva) else {
        return vec![Curva::Linea(a)];
    };
    let quanti = (arco.delta.abs() / QUARTO - 1e-9).ceil() as usize;
    let mut out = Vec::new();
    let mut at = da;
    let mut resto = curva;
    let mut restano = quanti;
    while restano > 1 {
        let (testa, coda) = dividi(at, &resto, 1.0 / restano as f64);
        out.push(testa);
        at = testa.fine();
        resto = coda;
        restano -= 1;
    }
    out.push(resto);
    out
}

/// Il doppio dell'area con segno racchiusa da curve (`turning`).
fn giro(curve: &[(P, Curva)]) -> f64 {
    let mut somma = 0.0;
    for (da, curva) in curve {
        let passi = if matches!(curva, Curva::Linea(_)) {
            1
        } else {
            16
        };
        let mut p = *da;
        for k in 1..=passi {
            let q = if k == passi {
                curva.fine()
            } else {
                punto_a(*da, curva, f64::from(k) / f64::from(passi))
            };
            somma += p[0] * q[1] - q[0] * p[1];
            p = q;
        }
    }
    somma
}

#[derive(Clone, Copy)]
struct Passo {
    h: usize,
    src: usize,
    da: f64,
    a: f64,
}

#[derive(Clone, Copy)]
struct Pezzo {
    inizio: P,
    curva: Curva,
    vertice: Option<usize>,
}

struct Costruito {
    chiave: f64,
    inizio: P,
    segmenti: Vec<Segmento>,
}

/// I tracciati dei bordi del risultato (`Arrangement.build`, con il pezzo
/// unico dell'unione e la forma che gira come se stessa).
fn costruisci(grafo: &Grafo<'_>, pezzo: &[i64]) -> Option<Vec<Costruito>> {
    let rete = grafo.rete;
    let sorgenti = &rete.sorgenti;
    let lati = &grafo.lati;
    let anelli = grafo.anelli(pezzo)?;
    let punto_della = |src: usize, t: f64| punto_a(sorgenti[src].da, &sorgenti[src].curva, t);
    let continua = |p: &Passo, q: &Passo| -> bool {
        if p.src != q.src {
            return false;
        }
        let su = p.a > p.da;
        if su != (q.a > q.da) {
            return false;
        }
        if p.a == q.da {
            return true;
        }
        if if su { q.da < p.a } else { q.da > p.a } {
            return false;
        }
        let v = rete.in_(grafo.arrivo(p.h));
        [p.a, (p.a + q.da) / 2.0, q.da]
            .iter()
            .all(|&t| distanza(punto_della(p.src, t), v) <= 2.0 * EPSILON)
    };
    let passi_dell_anello = |meta: &[usize]| -> Vec<Passo> {
        let n = meta.len();
        let passo = |h: usize, l: &Lungo| -> Passo {
            if h & 1 == 1 {
                Passo {
                    h,
                    src: l.src,
                    da: l.tb,
                    a: l.ta,
                }
            } else {
                Passo {
                    h,
                    src: l.src,
                    da: l.ta,
                    a: l.tb,
                }
            }
        };
        let mut out: Vec<Passo> = meta
            .iter()
            .map(|&h| {
                let lungo = &lati[h >> 1].lungo;
                let mut migliore = &lungo[0];
                for l in &lungo[1..] {
                    if l.src < migliore.src {
                        migliore = l;
                    }
                }
                passo(h, migliore)
            })
            .collect();
        let mut deciso: Vec<bool> = meta
            .iter()
            .map(|&h| lati[h >> 1].lungo.len() == 1)
            .collect();
        for avanti in [true, false] {
            for k in 1..2 * n {
                let i = if avanti { k % n } else { (2 * n - 1 - k) % n };
                let j = if avanti { (i + n - 1) % n } else { (i + 1) % n };
                if deciso[i] || !deciso[j] {
                    continue;
                }
                let Some(stesso) = lati[meta[i] >> 1]
                    .lungo
                    .iter()
                    .find(|l| l.src == out[j].src)
                else {
                    continue;
                };
                out[i] = passo(meta[i], stesso);
                deciso[i] = true;
            }
        }
        out
    };
    let mut posti: HashMap<usize, P> = HashMap::new();
    let mut posto_di = |v: usize| -> P {
        if let Some(p) = posti.get(&v) {
            return *p;
        }
        let mut p = rete.in_(v);
        if rete.rango[v] != 0 {
            let mut attraverso: Vec<(usize, f64)> = Vec::new();
            for &h in grafo.attorno.get(&v).map(Vec::as_slice).unwrap_or(&[]) {
                for l in &lati[h >> 1].lungo {
                    if !attraverso.iter().any(|(s, _)| *s == l.src) {
                        attraverso.push((l.src, if h & 1 == 1 { l.tb } else { l.ta }));
                    }
                }
            }
            attraverso.sort_by_key(|m| m.0);
            let mut q: Option<P> = None;
            let mut lontano = f64::INFINITY;
            'coppie: for i in 0..attraverso.len() {
                for j in i + 1..attraverso.len() {
                    let (uno, altro) = (attraverso[i], attraverso[j]);
                    let (primo, secondo) = (&sorgenti[uno.0], &sorgenti[altro.0]);
                    let Some((punto, s)) = incrocio(primo, uno.1, secondo, altro.1) else {
                        continue;
                    };
                    let d = distanza(punto, p);
                    if d <= 2.0 * EPSILON {
                        q = Some(punto);
                        break 'coppie;
                    }
                    if d < lontano && accanto(primo, uno.1, s, secondo, altro.1) {
                        lontano = d;
                        q = Some(punto);
                    }
                }
            }
            if q.is_none() {
                if let Some(&(src, t)) = attraverso.first() {
                    let su = punto_della(src, proietta(&sorgenti[src], p, t));
                    if distanza(su, p) <= 2.0 * EPSILON {
                        q = Some(su);
                    }
                }
            }
            if let Some(q) = q {
                p = q;
            }
        }
        posti.insert(v, p);
        p
    };

    let mut fuori = Vec::new();
    // La forma gira come se stessa: il verso delle sue curve.
    let verso = giro(&sorgenti.iter().map(|s| (s.da, s.curva)).collect::<Vec<_>>());
    for anello in &anelli {
        let passi = passi_dell_anello(&anello.meta);
        let n = passi.len();
        let comincia = (0..n)
            .find(|&i| !continua(&passi[(i + n - 1) % n], &passi[i]))
            .unwrap_or(0);
        let ordine_: Vec<Passo> = passi[comincia..]
            .iter()
            .chain(passi[..comincia].iter())
            .copied()
            .collect();
        let mut pezzi: Vec<Pezzo> = Vec::new();
        let mut i = 0;
        while i < ordine_.len() {
            let mut j = i + 1;
            while j < ordine_.len() && continua(&ordine_[j - 1], &ordine_[j]) {
                j += 1;
            }
            let Passo { src, da, .. } = ordine_[i];
            let a = ordine_[j - 1].a;
            let (v0, v1) = (grafo.origine(ordine_[i].h), grafo.arrivo(ordine_[j - 1].h));
            let (inizio, fine) = (posto_di(v0), posto_di(v1));
            let sorgente = &sorgenti[src];
            let t0 = proietta(sorgente, posto_di(v0), da);
            let t1 = proietta(sorgente, posto_di(v1), a);
            // La forma è fatta per il calcolo (`written` falso): una curva
            // intera non si riscrive com'era.
            if t0 == t1 {
                pezzi.push(Pezzo {
                    inizio,
                    curva: Curva::Linea(fine),
                    vertice: Some(v0),
                });
            } else {
                let (pda, pcurva) = pezzo_di(sorgente, t0, t1);
                let tutte = quarti(inizio, spostata(pda, &pcurva, inizio, fine));
                let mut at = inizio;
                for (k, curva) in tutte.iter().enumerate() {
                    pezzi.push(Pezzo {
                        inizio: at,
                        curva: *curva,
                        vertice: if k == 0 { Some(v0) } else { None },
                    });
                    at = curva.fine();
                }
            }
            i = j;
        }
        let mut k = pezzi.len();
        while k > 0 && pezzi.len() > 1 {
            k -= 1;
            let p = pezzi[k];
            if matches!(p.curva, Curva::Linea(a) if uguali(p.inizio, a)) {
                pezzi.remove(k);
            }
        }
        // Due linee dritte di fila diventano una: la forma è fatta per il
        // calcolo, e i suoi nodi non sono di nessuno.
        let dritte = |prima: &Pezzo, ora: &Pezzo| -> bool {
            let (Curva::Linea(q), Curva::Linea(_)) = (ora.curva, prima.curva) else {
                return false;
            };
            let (p, nodo) = (prima.inizio, ora.inizio);
            let (dx, dy) = (q[0] - p[0], q[1] - p[1]);
            let u = ((nodo[0] - p[0]) * dx + (nodo[1] - p[1]) * dy) / (dx * dx + dy * dy);
            u > 0.0
                && u < 1.0
                && ipot(p[0] + u * dx - nodo[0], p[1] + u * dy - nodo[1]) <= COLLINEAR
        };
        let mut i: isize = 0;
        while pezzi.len() > 2 && (i as usize) < pezzi.len() {
            let iu = i as usize;
            let at = (iu + pezzi.len() - 1) % pezzi.len();
            let (prima, ora) = (pezzi[at], pezzi[iu]);
            if !dritte(&prima, &ora) {
                i += 1;
                continue;
            }
            pezzi[at] = Pezzo {
                curva: ora.curva,
                ..prima
            };
            pezzi.remove(iu);
            i = 0;
        }
        let chiave_di = |p: &Pezzo| -> f64 {
            match p.vertice {
                None => f64::INFINITY,
                Some(v) => rete.primo[v],
            }
        };
        let mut testa = 0;
        for (i, p) in pezzi.iter().enumerate() {
            let (migliore, chiave) = (&pezzi[testa], chiave_di(p));
            if chiave < chiave_di(migliore)
                || (chiave == chiave_di(migliore) && a_sinistra(p.inizio, migliore.inizio) < 0.0)
            {
                testa = i;
            }
        }
        pezzi.rotate_left(testa);
        let area = giro(
            &pezzi
                .iter()
                .map(|p| (p.inizio, p.curva))
                .collect::<Vec<_>>(),
        ) / 2.0;
        if area.abs() <= (EPSILON * EPSILON) / 4.0 {
            continue;
        }
        let inizio = pezzi[0].inizio;
        let curve: Vec<Curva> = if verso >= 0.0 {
            pezzi.iter().map(|p| p.curva).collect()
        } else {
            pezzi
                .iter()
                .rev()
                .map(|p| rovescia(p.inizio, &p.curva))
                .collect()
        };
        let mut segmenti = vec![Segmento::Muovi(inizio)];
        segmenti.extend(curve.into_iter().map(Segmento::Curva));
        if matches!(segmenti.last(), Some(Segmento::Curva(Curva::Linea(_)))) {
            segmenti.pop();
        }
        segmenti.push(Segmento::Chiudi);
        let chiave = match pezzi[0].vertice {
            None => f64::INFINITY,
            Some(v) => rete.primo[v],
        };
        fuori.push(Costruito {
            chiave,
            inizio,
            segmenti,
        });
    }
    Some(fuori)
}

fn ordine_dei_costruiti(m: &Costruito, n: &Costruito) -> std::cmp::Ordering {
    if m.chiave != n.chiave {
        return if m.chiave < n.chiave {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        };
    }
    ordine(a_sinistra(m.inizio, n.inizio))
}

/// L'unione delle aree degli anelli `segmenti`, riempiti `nonzero`: il
/// tracciato, vuoto se non copre niente.
pub(crate) fn unione(segmenti: &[Segmento], limite: usize) -> Result<Vec<Segmento>, Rifiuto> {
    let sorgenti = sorgenti(segmenti);
    if sorgenti.is_empty() {
        return Ok(Vec::new());
    }
    let mut rete = Rete::nuova(sorgenti);
    if rete.a.len() > limite {
        return Err(Rifiuto::Complessa);
    }
    if !rete.planare(limite) {
        return Err(if rete.a.len() > limite {
            Rifiuto::Complessa
        } else {
            Rifiuto::Fallita
        });
    }
    let lati = lati_di(&rete);
    if lati.is_empty() {
        return Ok(Vec::new());
    }
    let mut grafo = Grafo::nuovo(&rete, lati);
    if !grafo.traccia() {
        return Err(Rifiuto::Fallita);
    }
    let avvolgimenti = grafo.avvolgimenti().ok_or(Rifiuto::Fallita)?;
    let pezzo: Vec<i64> = avvolgimenti
        .iter()
        .map(|&w| if w != 0 { 0 } else { -1 })
        .collect();
    let mut costruiti = costruisci(&grafo, &pezzo).ok_or(Rifiuto::Fallita)?;
    costruiti.sort_by(ordine_dei_costruiti);
    Ok(costruiti.into_iter().flat_map(|c| c.segmenti).collect())
}
