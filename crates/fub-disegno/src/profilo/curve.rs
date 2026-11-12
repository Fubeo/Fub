//! I segmenti di un tracciato e le curve una alla volta: la lettura e la
//! scrittura del `d`, il punto e la derivata a un parametro, la divisione in
//! due, l'arco nella forma col centro. È `scene/geometry.ts` (la lettura),
//! `scene/serialize.ts` (`pathData`) e `scene/curves.ts` del client, regola
//! per regola: il contorno pieno che se ne calcola deve essere quello del
//! client.
//!
//! La lettura del `d` è quella di `fub_scene` (`geometry.rs`, che il crate
//! tiene per sé), con la grammatica di SVG 2.

use std::f64::consts::{PI, TAU};

use crate::differenza::numero;

/// Un punto.
pub(crate) type P = [f64; 2];

/// Un segmento che disegna qualcosa da un punto all'altro (`Curve` del
/// client).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Curva {
    Linea(P),
    Quad(P, P),
    Cubica(P, P, P),
    Arco {
        raggi: P,
        rotazione: f64,
        grande: bool,
        verso: bool,
        a: P,
    },
}

impl Curva {
    /// Il punto d'arrivo.
    pub(crate) fn fine(&self) -> P {
        match *self {
            Curva::Linea(a)
            | Curva::Quad(_, a)
            | Curva::Cubica(_, _, a)
            | Curva::Arco { a, .. } => a,
        }
    }
}

/// Un segmento di un tracciato, in coordinate assolute.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Segmento {
    Muovi(P),
    Curva(Curva),
    Chiudi,
}

// ---------------------------------------------------------------------------
// I numeri come li fa JavaScript.
// ---------------------------------------------------------------------------

/// `Math.hypot` di V8 per due valori: normalizzati al più grande, sommati
/// con la compensazione di Kahan. La radice del sistema arrotonda in un
/// altro modo, e i confronti con la tolleranza ne risentirebbero.
pub(crate) fn ipot(a: f64, b: f64) -> f64 {
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let (a, b) = (a.abs(), b.abs());
    let max = if b > a { b } else { a };
    if max == 0.0 {
        return 0.0;
    }
    let mut somma = 0.0;
    let mut compenso = 0.0;
    for v in [a, b] {
        let n = v / max;
        let addendo = n * n - compenso;
        let parziale = somma + addendo;
        compenso = (parziale - somma) - addendo;
        somma = parziale;
    }
    somma.sqrt() * max
}

/// `Math.max(a, b)`: `NaN` se uno dei due lo è, e 0 è più di -0.
pub(crate) fn jmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else if b > a || (a == 0.0 && a.is_sign_negative()) {
        b
    } else {
        a
    }
}

/// `Math.min(a, b)`: `NaN` se uno dei due lo è, e -0 è meno di 0.
pub(crate) fn jmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else if b < a || (a == 0.0 && b.is_sign_negative()) {
        b
    } else {
        a
    }
}

/// `Math.sign`.
pub(crate) fn segno(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// `remEuclid` del client: il resto, portato fra 0 e |b|.
fn resto_euclideo(a: f64, b: f64) -> f64 {
    let r = a % b;
    if r < 0.0 {
        r + b.abs()
    } else {
        r
    }
}

// ---------------------------------------------------------------------------
// I punti.
// ---------------------------------------------------------------------------

pub(crate) fn piu(a: P, b: P) -> P {
    [a[0] + b[0], a[1] + b[1]]
}

pub(crate) fn meno(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}

pub(crate) fn per(a: P, k: f64) -> P {
    [a[0] * k, a[1] * k]
}

pub(crate) fn scalare(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

pub(crate) fn vettoriale(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

pub(crate) fn norma(a: P) -> f64 {
    ipot(a[0], a[1])
}

pub(crate) fn distanza(a: P, b: P) -> f64 {
    ipot(a[0] - b[0], a[1] - b[1])
}

pub(crate) fn lerp(a: P, b: P, t: f64) -> P {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

pub(crate) fn uguali(a: P, b: P) -> bool {
    a[0] == b[0] && a[1] == b[1]
}

// ---------------------------------------------------------------------------
// La lettura e la scrittura del `d`.
// ---------------------------------------------------------------------------

fn spazio(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

/// Un numero SVG al byte `i` di `text`, come `scan_number` di `fub_scene`.
fn numero_svg(text: &str, mut i: usize) -> Option<(f64, usize)> {
    let bytes = text.as_bytes();
    let start = i;
    if matches!(bytes.get(i), Some(b'+' | b'-')) {
        i += 1;
    }
    let cifre = |i: &mut usize| {
        let da = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i > da
    };
    let intero = cifre(&mut i);
    if bytes.get(i) == Some(&b'.') {
        let mut j = i + 1;
        if !cifre(&mut j) {
            return None;
        }
        i = j;
    } else if !intero {
        return None;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        if cifre(&mut j) {
            i = j;
        }
    }
    let v: f64 = text[start..i].parse().ok()?;
    (v.abs() <= f64::from(f32::MAX)).then_some((v, i))
}

struct Lettore<'a> {
    text: &'a str,
    bytes: &'a [u8],
    i: usize,
}

impl Lettore<'_> {
    fn spazi(&mut self) {
        while self.i < self.bytes.len() && spazio(self.bytes[self.i]) {
            self.i += 1;
        }
    }

    fn separatore(&mut self) -> bool {
        self.spazi();
        let virgola = self.bytes.get(self.i) == Some(&b',');
        if virgola {
            self.i += 1;
            self.spazi();
        }
        virgola
    }

    fn separatore_obbligato(&mut self) -> Option<()> {
        let da = self.i;
        self.separatore();
        (self.i > da).then_some(())
    }

    fn numero(&mut self) -> Option<f64> {
        let (n, dopo) = numero_svg(self.text, self.i)?;
        self.i = dopo;
        Some(n)
    }

    fn senza_segno(&mut self) -> Option<f64> {
        if matches!(self.bytes.get(self.i), Some(b'+' | b'-')) {
            return None;
        }
        self.numero()
    }

    fn bandiera(&mut self) -> Option<bool> {
        let b = match self.bytes.get(self.i)? {
            b'0' => false,
            b'1' => true,
            _ => return None,
        };
        self.i += 1;
        Some(b)
    }

    fn coppia(&mut self) -> Option<P> {
        let x = self.numero()?;
        self.separatore();
        let y = self.numero()?;
        Some([x, y])
    }

    fn comincia_numero(&self) -> bool {
        self.bytes
            .get(self.i)
            .is_some_and(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.'))
    }
}

fn rifletti(controllo: Option<P>, corrente: P) -> P {
    match controllo {
        Some(c) => [2.0 * corrente[0] - c[0], 2.0 * corrente[1] - c[1]],
        None => corrente,
    }
}

/// I segmenti di un `d`, con la grammatica completa di SVG 2; `None` se è
/// malformato.
pub(crate) fn leggi_d(d: &str) -> Option<Vec<Segmento>> {
    let mut p = Lettore {
        text: d,
        bytes: d.as_bytes(),
        i: 0,
    };
    let mut out = Vec::new();
    let mut corrente = [0.0, 0.0];
    let mut inizio = [0.0, 0.0];
    let mut ultima_cubica: Option<P> = None;
    let mut ultima_quad: Option<P> = None;
    let mut prima: Option<u8> = None;
    p.spazi();
    if p.i == p.bytes.len() {
        return Some(out);
    }
    if !matches!(p.bytes[p.i], b'M' | b'm') {
        return None;
    }
    while p.i < p.bytes.len() {
        let comando = if p.bytes[p.i].is_ascii_alphabetic() {
            let c = p.bytes[p.i];
            p.i += 1;
            p.spazi();
            c
        } else if p.comincia_numero() {
            match prima {
                Some(b'M') => b'L',
                Some(b'm') => b'l',
                Some(b'Z' | b'z') | None => return None,
                Some(c) => c,
            }
        } else {
            return None;
        };
        let relativo = comando.is_ascii_lowercase();
        let base = if relativo { corrente } else { [0.0, 0.0] };
        let at = |q: P| [base[0] + q[0], base[1] + q[1]];
        let (mut cubica, mut quad) = (None, None);
        match comando.to_ascii_uppercase() {
            b'M' => {
                corrente = at(p.coppia()?);
                inizio = corrente;
                out.push(Segmento::Muovi(corrente));
            }
            b'L' => {
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Linea(corrente)));
            }
            b'H' => {
                corrente = [base[0] + p.numero()?, corrente[1]];
                out.push(Segmento::Curva(Curva::Linea(corrente)));
            }
            b'V' => {
                corrente = [corrente[0], base[1] + p.numero()?];
                out.push(Segmento::Curva(Curva::Linea(corrente)));
            }
            b'C' => {
                let c1 = at(p.coppia()?);
                p.separatore();
                let c2 = at(p.coppia()?);
                p.separatore();
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Cubica(c1, c2, corrente)));
                cubica = Some(c2);
            }
            b'S' => {
                let c1 = rifletti(ultima_cubica, corrente);
                let c2 = at(p.coppia()?);
                p.separatore();
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Cubica(c1, c2, corrente)));
                cubica = Some(c2);
            }
            b'Q' => {
                let c = at(p.coppia()?);
                p.separatore();
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Quad(c, corrente)));
                quad = Some(c);
            }
            b'T' => {
                let c = rifletti(ultima_quad, corrente);
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Quad(c, corrente)));
                quad = Some(c);
            }
            b'A' => {
                let rx = p.senza_segno()?;
                p.separatore();
                let ry = p.senza_segno()?;
                p.separatore();
                let rotazione = p.numero()?;
                p.separatore_obbligato()?;
                let grande = p.bandiera()?;
                p.separatore();
                let verso = p.bandiera()?;
                p.separatore();
                corrente = at(p.coppia()?);
                out.push(Segmento::Curva(Curva::Arco {
                    raggi: [rx, ry],
                    rotazione,
                    grande,
                    verso,
                    a: corrente,
                }));
            }
            b'Z' => {
                corrente = inizio;
                out.push(Segmento::Chiudi);
            }
            _ => return None,
        }
        ultima_cubica = cubica;
        ultima_quad = quad;
        prima = Some(comando);
        if comando.eq_ignore_ascii_case(&b'Z') {
            p.spazi();
        } else if p.separatore() && !p.comincia_numero() {
            return None;
        }
    }
    Some(out)
}

fn coordinata(v: f64) -> String {
    numero(v, 2)
}

fn punto(p: P) -> String {
    format!("{} {}", coordinata(p[0]), coordinata(p[1]))
}

/// Il `d` di `segmenti`, coi numeri a due decimali (`pathData` del client).
pub(crate) fn scrivi_d(segmenti: &[Segmento]) -> String {
    segmenti
        .iter()
        .map(|s| match *s {
            Segmento::Muovi(a) => format!("M{}", punto(a)),
            Segmento::Curva(Curva::Linea(a)) => format!("L{}", punto(a)),
            Segmento::Curva(Curva::Quad(c, a)) => format!("Q{} {}", punto(c), punto(a)),
            Segmento::Curva(Curva::Cubica(c1, c2, a)) => {
                format!("C{} {} {}", punto(c1), punto(c2), punto(a))
            }
            Segmento::Curva(Curva::Arco {
                raggi,
                rotazione,
                grande,
                verso,
                a,
            }) => format!(
                "A{} {} {} {} {}",
                punto(raggi),
                coordinata(rotazione),
                u8::from(grande),
                u8::from(verso),
                punto(a)
            ),
            Segmento::Chiudi => "Z".to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// Le curve (`scene/curves.ts`).
// ---------------------------------------------------------------------------

/// Un arco ellittico nella forma col centro, coi raggi già ingranditi
/// quando non bastano a unire gli estremi.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ArcoCentrato {
    pub centro: P,
    pub raggi: P,
    pub cos: f64,
    pub sin: f64,
    pub inizio: f64,
    pub delta: f64,
}

/// L'arco da `da` nella forma col centro (`arcCenter`); `None` se SVG non lo
/// disegna come arco.
pub(crate) fn arco_centrato(da: P, curva: &Curva) -> Option<ArcoCentrato> {
    let Curva::Arco {
        raggi,
        rotazione,
        grande,
        verso,
        a,
    } = *curva
    else {
        return None;
    };
    if da[0] == a[0] && da[1] == a[1] {
        return None;
    }
    let mut rx = raggi[0].abs();
    let mut ry = raggi[1].abs();
    if rx == 0.0 || ry == 0.0 {
        return None;
    }
    let radianti = rotazione * (PI / 180.0);
    let sin = radianti.sin();
    let cos = radianti.cos();
    let dx = (da[0] - a[0]) / 2.0;
    let dy = (da[1] - a[1]) / 2.0;
    let x1 = cos * dx + sin * dy;
    let y1 = -sin * dx + cos * dy;
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lambda > 1.0 {
        rx *= lambda.sqrt();
        ry *= lambda.sqrt();
    }
    let numeratore = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let denominatore = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let mut coefficiente = jmax(numeratore / denominatore, 0.0).sqrt();
    if grande == verso {
        coefficiente = -coefficiente;
    }
    let cx1 = (coefficiente * rx * y1) / ry;
    let cy1 = (-coefficiente * ry * x1) / rx;
    let centro = [
        cos * cx1 - sin * cy1 + (da[0] + a[0]) / 2.0,
        sin * cx1 + cos * cy1 + (da[1] + a[1]) / 2.0,
    ];
    let inizio = ((y1 - cy1) / ry).atan2((x1 - cx1) / rx);
    let fine = ((-y1 - cy1) / ry).atan2((-x1 - cx1) / rx);
    let mut delta = resto_euclideo(fine - inizio, TAU);
    if !verso && delta > 0.0 {
        delta -= TAU;
    }
    Some(ArcoCentrato {
        centro,
        raggi: [rx, ry],
        cos,
        sin,
        inizio,
        delta,
    })
}

/// Il punto dell'ellisse di `arco` all'angolo `theta`.
pub(crate) fn su_ellisse(arco: &ArcoCentrato, theta: f64) -> P {
    let ex = arco.raggi[0] * theta.cos();
    let ey = arco.raggi[1] * theta.sin();
    [
        arco.centro[0] + arco.cos * ex - arco.sin * ey,
        arco.centro[1] + arco.sin * ex + arco.cos * ey,
    ]
}

/// La derivata dell'ellisse di `arco` rispetto all'angolo.
pub(crate) fn lungo_ellisse(arco: &ArcoCentrato, theta: f64) -> P {
    let ex = -arco.raggi[0] * theta.sin();
    let ey = arco.raggi[1] * theta.cos();
    [arco.cos * ex - arco.sin * ey, arco.sin * ex + arco.cos * ey]
}

/// Il punto di `curva`, da `da`, al parametro `t` (`pointAt`).
pub(crate) fn punto_a(da: P, curva: &Curva, t: f64) -> P {
    let u = 1.0 - t;
    match *curva {
        Curva::Linea(a) => lerp(da, a, t),
        Curva::Quad(c, a) => [
            u * u * da[0] + 2.0 * u * t * c[0] + t * t * a[0],
            u * u * da[1] + 2.0 * u * t * c[1] + t * t * a[1],
        ],
        Curva::Cubica(c1, c2, a) => {
            let (p0, p1, p2, p3) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            [
                p0 * da[0] + p1 * c1[0] + p2 * c2[0] + p3 * a[0],
                p0 * da[1] + p1 * c1[1] + p2 * c2[1] + p3 * a[1],
            ]
        }
        Curva::Arco { a, .. } => match arco_centrato(da, curva) {
            None => lerp(da, a, t),
            Some(_) if t == 1.0 => a,
            Some(_) if t == 0.0 => da,
            Some(arco) => su_ellisse(&arco, arco.inizio + arco.delta * t),
        },
    }
}

/// La derivata di `curva` rispetto a `t` (`derivativeAt`).
pub(crate) fn derivata_a(da: P, curva: &Curva, t: f64) -> P {
    let u = 1.0 - t;
    match *curva {
        Curva::Linea(a) => meno(a, da),
        Curva::Quad(c, a) => [
            2.0 * u * (c[0] - da[0]) + 2.0 * t * (a[0] - c[0]),
            2.0 * u * (c[1] - da[1]) + 2.0 * t * (a[1] - c[1]),
        ],
        Curva::Cubica(c1, c2, a) => {
            let (p0, p1, p2) = (3.0 * u * u, 6.0 * u * t, 3.0 * t * t);
            [
                p0 * (c1[0] - da[0]) + p1 * (c2[0] - c1[0]) + p2 * (a[0] - c2[0]),
                p0 * (c1[1] - da[1]) + p1 * (c2[1] - c1[1]) + p2 * (a[1] - c2[1]),
            ]
        }
        Curva::Arco { a, .. } => match arco_centrato(da, curva) {
            None => meno(a, da),
            Some(arco) => {
                let [x, y] = lungo_ellisse(&arco, arco.inizio + arco.delta * t);
                [x * arco.delta, y * arco.delta]
            }
        },
    }
}

/// `curva` divisa al parametro `t` in due curve dello stesso tipo
/// (`splitAt`).
pub(crate) fn dividi(da: P, curva: &Curva, t: f64) -> (Curva, Curva) {
    match *curva {
        Curva::Linea(a) => (Curva::Linea(lerp(da, a, t)), *curva),
        Curva::Quad(c, a) => {
            let p = lerp(da, c, t);
            let q = lerp(c, a, t);
            (Curva::Quad(p, lerp(p, q, t)), Curva::Quad(q, a))
        }
        Curva::Cubica(c1, c2, a) => {
            let ab = lerp(da, c1, t);
            let bc = lerp(c1, c2, t);
            let cd = lerp(c2, a, t);
            let abc = lerp(ab, bc, t);
            let bcd = lerp(bc, cd, t);
            (
                Curva::Cubica(ab, abc, lerp(abc, bcd, t)),
                Curva::Cubica(bcd, cd, a),
            )
        }
        Curva::Arco {
            raggi,
            rotazione,
            verso,
            grande,
            a,
        } => match arco_centrato(da, curva) {
            None => (
                Curva::Arco {
                    raggi,
                    rotazione,
                    grande,
                    verso,
                    a: lerp(da, a, t),
                },
                *curva,
            ),
            Some(arco) => {
                let mezzo = su_ellisse(&arco, arco.inizio + arco.delta * t);
                (
                    Curva::Arco {
                        raggi: arco.raggi,
                        rotazione,
                        grande: (arco.delta * t).abs() > PI,
                        verso,
                        a: mezzo,
                    },
                    Curva::Arco {
                        raggi: arco.raggi,
                        rotazione,
                        grande: (arco.delta * (1.0 - t)).abs() > PI,
                        verso,
                        a,
                    },
                )
            }
        },
    }
}

/// `curva` percorsa al contrario: da dove arriva a `da` (`reversed`).
pub(crate) fn rovescia(da: P, curva: &Curva) -> Curva {
    match *curva {
        Curva::Linea(_) => Curva::Linea(da),
        Curva::Quad(c, _) => Curva::Quad(c, da),
        Curva::Cubica(c1, c2, _) => Curva::Cubica(c2, c1, da),
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
            verso: !verso,
            a: da,
        },
    }
}
