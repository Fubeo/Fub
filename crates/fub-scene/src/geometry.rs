//! Geometria: matrici affini, la grammatica dei path di SVG 2 e il rettangolo
//! che contiene una figura dopo le sue trasformazioni.
//!
//! Il rettangolo è esatto: una curva di Bézier trasformata da una matrice
//! affine resta una curva di Bézier con i punti di controllo trasformati, e i
//! suoi estremi si trovano annullando la derivata; un arco ellittico
//! trasformato resta un arco, e i suoi estremi si trovano in forma chiusa.
//! Nessun punto di controllo entra nel rettangolo se la curva non ci passa.

use std::f64::consts::{PI, TAU};

use crate::values::scan_number;

/// Una matrice affine `[a b c d e f]`: `(x, y) ↦ (a·x + c·y + e, b·x + d·y + f)`,
/// come `matrix(…)` di SVG.
#[derive(Copy, Clone, Debug, PartialEq)]
pub(crate) struct Matrix(pub [f64; 6]);

impl Matrix {
    pub const IDENTITY: Matrix = Matrix([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    pub fn translate(x: f64, y: f64) -> Matrix {
        Matrix([1.0, 0.0, 0.0, 1.0, x, y])
    }

    /// Una rotazione di `degrees` gradi, nel verso di SVG (orario sullo
    /// schermo).
    pub fn rotate(degrees: f64) -> Matrix {
        let (sin, cos) = degrees.to_radians().sin_cos();
        Matrix([cos, sin, -sin, cos, 0.0, 0.0])
    }

    /// `self` dopo `inner`: la matrice che applica prima `inner` e poi `self`.
    /// È l'ordine di una lista `transform`, dove la funzione più a destra
    /// agisce per prima.
    pub fn then(self, inner: Matrix) -> Matrix {
        let [a, b, c, d, e, f] = self.0;
        let [a2, b2, c2, d2, e2, f2] = inner.0;
        Matrix([
            a * a2 + c * b2,
            b * a2 + d * b2,
            a * c2 + c * d2,
            b * c2 + d * d2,
            a * e2 + c * f2 + e,
            b * e2 + d * f2 + f,
        ])
    }

    pub fn apply(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        [a * x + c * y + e, b * x + d * y + f]
    }
}

/// Un segmento di path in coordinate assolute.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Segment {
    Move([f64; 2]),
    Line([f64; 2]),
    Quad([f64; 2], [f64; 2]),
    Cubic([f64; 2], [f64; 2], [f64; 2]),
    Arc {
        radii: [f64; 2],
        rotation: f64,
        large: bool,
        sweep: bool,
        to: [f64; 2],
    },
    Close,
}

fn is_wsp(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

/// Il lettore della grammatica dei path di SVG 2.
struct PathParser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    i: usize,
}

impl PathParser<'_> {
    fn skip_wsp(&mut self) {
        while self.i < self.bytes.len() && is_wsp(self.bytes[self.i]) {
            self.i += 1;
        }
    }

    /// `comma_wsp?`: vero se c'era una virgola.
    fn skip_separator(&mut self) -> bool {
        self.skip_wsp();
        let comma = self.bytes.get(self.i) == Some(&b',');
        if comma {
            self.i += 1;
            self.skip_wsp();
        }
        comma
    }

    /// `comma_wsp` obbligatorio: almeno uno spazio o una virgola.
    fn require_separator(&mut self) -> Option<()> {
        let from = self.i;
        self.skip_separator();
        (self.i > from).then_some(())
    }

    fn number(&mut self) -> Option<f64> {
        let (n, next) = scan_number(self.text, self.i)?;
        self.i = next;
        Some(n)
    }

    /// Un numero senza segno, come i raggi di un arco.
    fn unsigned(&mut self) -> Option<f64> {
        if matches!(self.bytes.get(self.i), Some(b'+' | b'-')) {
            return None;
        }
        self.number()
    }

    fn flag(&mut self) -> Option<bool> {
        let flag = match self.bytes.get(self.i)? {
            b'0' => false,
            b'1' => true,
            _ => return None,
        };
        self.i += 1;
        Some(flag)
    }

    fn pair(&mut self) -> Option<[f64; 2]> {
        let x = self.number()?;
        self.skip_separator();
        let y = self.number()?;
        Some([x, y])
    }

    fn starts_number(&self) -> bool {
        self.bytes
            .get(self.i)
            .is_some_and(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.'))
    }
}

/// Legge un attributo `d` con la grammatica completa di SVG 2: comandi assoluti
/// e relativi, comandi impliciti, flag degli archi attaccati, numeri compatti.
/// Un `d` vuoto è valido e non disegna niente; un `d` malformato è `None`,
/// perché un browser lo disegna solo fino al primo errore.
pub(crate) fn parse_path(d: &str) -> Option<Vec<Segment>> {
    let mut p = PathParser {
        text: d,
        bytes: d.as_bytes(),
        i: 0,
    };
    let mut segments = Vec::new();
    let mut current = [0.0, 0.0];
    let mut start = [0.0, 0.0];
    // L'ultimo punto di controllo di una cubica o di una quadratica, per i
    // comandi `S` e `T` che lo riflettono.
    let mut last_cubic: Option<[f64; 2]> = None;
    let mut last_quad: Option<[f64; 2]> = None;
    let mut previous: Option<u8> = None;
    p.skip_wsp();
    if p.i == p.bytes.len() {
        return Some(segments);
    }
    if !matches!(p.bytes[p.i], b'M' | b'm') {
        return None;
    }
    while p.i < p.bytes.len() {
        let command = if p.bytes[p.i].is_ascii_alphabetic() {
            let command = p.bytes[p.i];
            p.i += 1;
            p.skip_wsp();
            command
        } else if p.starts_number() {
            match previous {
                Some(b'M') => b'L',
                Some(b'm') => b'l',
                Some(b'Z' | b'z') | None => return None,
                Some(command) => command,
            }
        } else {
            return None;
        };
        let relative = command.is_ascii_lowercase();
        let base = if relative { current } else { [0.0, 0.0] };
        let at = |p: [f64; 2]| [base[0] + p[0], base[1] + p[1]];
        let (mut cubic, mut quad) = (None, None);
        match command.to_ascii_uppercase() {
            b'M' => {
                current = at(p.pair()?);
                start = current;
                segments.push(Segment::Move(current));
            }
            b'L' => {
                current = at(p.pair()?);
                segments.push(Segment::Line(current));
            }
            b'H' => {
                current = [base[0] + p.number()?, current[1]];
                segments.push(Segment::Line(current));
            }
            b'V' => {
                current = [current[0], base[1] + p.number()?];
                segments.push(Segment::Line(current));
            }
            b'C' => {
                let c1 = at(p.pair()?);
                p.skip_separator();
                let c2 = at(p.pair()?);
                p.skip_separator();
                current = at(p.pair()?);
                segments.push(Segment::Cubic(c1, c2, current));
                cubic = Some(c2);
            }
            b'S' => {
                let c1 = reflect(last_cubic, current);
                let c2 = at(p.pair()?);
                p.skip_separator();
                current = at(p.pair()?);
                segments.push(Segment::Cubic(c1, c2, current));
                cubic = Some(c2);
            }
            b'Q' => {
                let c = at(p.pair()?);
                p.skip_separator();
                current = at(p.pair()?);
                segments.push(Segment::Quad(c, current));
                quad = Some(c);
            }
            b'T' => {
                let c = reflect(last_quad, current);
                current = at(p.pair()?);
                segments.push(Segment::Quad(c, current));
                quad = Some(c);
            }
            b'A' => {
                let rx = p.unsigned()?;
                p.skip_separator();
                let ry = p.unsigned()?;
                p.skip_separator();
                let rotation = p.number()?;
                p.require_separator()?;
                let large = p.flag()?;
                p.skip_separator();
                let sweep = p.flag()?;
                p.skip_separator();
                current = at(p.pair()?);
                segments.push(Segment::Arc {
                    radii: [rx, ry],
                    rotation,
                    large,
                    sweep,
                    to: current,
                });
            }
            b'Z' => {
                current = start;
                segments.push(Segment::Close);
            }
            _ => return None,
        }
        last_cubic = cubic;
        last_quad = quad;
        previous = Some(command);
        if command.eq_ignore_ascii_case(&b'Z') {
            p.skip_wsp();
        } else if p.skip_separator() && !p.starts_number() {
            // Una virgola chiude un argomento solo se ne segue un altro.
            return None;
        }
    }
    Some(segments)
}

/// Il riflesso di un punto di controllo intorno al punto corrente; il punto
/// corrente stesso se il segmento precedente non era della stessa famiglia.
fn reflect(control: Option<[f64; 2]>, current: [f64; 2]) -> [f64; 2] {
    match control {
        Some(c) => [2.0 * current[0] - c[0], 2.0 * current[1] - c[1]],
        None => current,
    }
}

/// Il rettangolo minimo che contiene un insieme di punti.
#[derive(Copy, Clone, Debug, PartialEq)]
pub(crate) struct Bounds {
    pub min: [f64; 2],
    pub max: [f64; 2],
}

/// Un accumulatore di [`Bounds`]. I punti non finiti si scartano: vengono da
/// valori enormi moltiplicati fra loro, e un rettangolo infinito non dice
/// niente.
#[derive(Default)]
pub(crate) struct BoundsBuilder {
    bounds: Option<Bounds>,
}

impl BoundsBuilder {
    pub fn include(&mut self, [x, y]: [f64; 2]) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        let bounds = self.bounds.get_or_insert(Bounds {
            min: [x, y],
            max: [x, y],
        });
        bounds.min = [bounds.min[0].min(x), bounds.min[1].min(y)];
        bounds.max = [bounds.max[0].max(x), bounds.max[1].max(y)];
    }

    pub fn finish(self) -> Option<Bounds> {
        self.bounds
    }

    /// Aggiunge i segmenti di un path trasformati da `m`.
    pub fn path(&mut self, segments: &[Segment], m: &Matrix) {
        let mut current = [0.0, 0.0];
        let mut start = [0.0, 0.0];
        for segment in segments {
            match *segment {
                Segment::Move(p) => {
                    current = p;
                    start = p;
                }
                Segment::Line(p) => {
                    self.include(m.apply(current));
                    self.include(m.apply(p));
                    current = p;
                }
                Segment::Quad(c, p) => {
                    self.quad(m.apply(current), m.apply(c), m.apply(p));
                    current = p;
                }
                Segment::Cubic(c1, c2, p) => {
                    self.cubic([m.apply(current), m.apply(c1), m.apply(c2), m.apply(p)]);
                    current = p;
                }
                Segment::Arc {
                    radii,
                    rotation,
                    large,
                    sweep,
                    to,
                } => {
                    self.arc(current, radii, rotation, large, sweep, to, m);
                    current = to;
                }
                Segment::Close => {
                    self.include(m.apply(current));
                    self.include(m.apply(start));
                    current = start;
                }
            }
        }
    }

    fn quad(&mut self, p0: [f64; 2], p1: [f64; 2], p2: [f64; 2]) {
        self.include(p0);
        self.include(p2);
        for axis in 0..2 {
            // B'(t) = 0 per t = (p0 − p1) / (p0 − 2·p1 + p2).
            let denominator = p0[axis] - 2.0 * p1[axis] + p2[axis];
            if denominator != 0.0 {
                let t = (p0[axis] - p1[axis]) / denominator;
                if t > 0.0 && t < 1.0 {
                    let u = 1.0 - t;
                    self.include([
                        u * u * p0[0] + 2.0 * u * t * p1[0] + t * t * p2[0],
                        u * u * p0[1] + 2.0 * u * t * p1[1] + t * t * p2[1],
                    ]);
                }
            }
        }
    }

    fn cubic(&mut self, [p0, p1, p2, p3]: [[f64; 2]; 4]) {
        self.include(p0);
        self.include(p3);
        let point = |t: f64| {
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            [
                a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
            ]
        };
        for axis in 0..2 {
            // B'(t)/3 = a·t² + b·t + c.
            let a = -p0[axis] + 3.0 * p1[axis] - 3.0 * p2[axis] + p3[axis];
            let b = 2.0 * (p0[axis] - 2.0 * p1[axis] + p2[axis]);
            let c = p1[axis] - p0[axis];
            for t in quadratic_roots(a, b, c) {
                if t > 0.0 && t < 1.0 {
                    self.include(point(t));
                }
            }
        }
    }

    /// Un arco ellittico da `from` a `to`, con la conversione al centro delle
    /// note d'implementazione di SVG (F.6.5) e gli estremi in forma chiusa.
    #[allow(clippy::too_many_arguments)]
    fn arc(
        &mut self,
        from: [f64; 2],
        [rx, ry]: [f64; 2],
        rotation: f64,
        large: bool,
        sweep: bool,
        to: [f64; 2],
        m: &Matrix,
    ) {
        if from == to {
            // Estremi uguali: l'arco non si disegna (F.6.2).
            return;
        }
        let (mut rx, mut ry) = (rx.abs(), ry.abs());
        if rx == 0.0 || ry == 0.0 {
            self.include(m.apply(from));
            self.include(m.apply(to));
            return;
        }
        let (sin, cos) = rotation.to_radians().sin_cos();
        let dx = (from[0] - to[0]) / 2.0;
        let dy = (from[1] - to[1]) / 2.0;
        let x1 = cos * dx + sin * dy;
        let y1 = -sin * dx + cos * dy;
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
        if lambda > 1.0 {
            rx *= lambda.sqrt();
            ry *= lambda.sqrt();
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
        let mut coefficient = (numerator / denominator).max(0.0).sqrt();
        if large == sweep {
            coefficient = -coefficient;
        }
        let cx1 = coefficient * rx * y1 / ry;
        let cy1 = -coefficient * ry * x1 / rx;
        let center = [
            cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2.0,
            sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2.0,
        ];
        let angle = |ux: f64, uy: f64| uy.atan2(ux);
        let theta1 = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
        let theta2 = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry);
        let mut delta = (theta2 - theta1).rem_euclid(TAU);
        if !sweep && delta > 0.0 {
            delta -= TAU;
        }

        // P(θ) = M·c + A·(cos θ, sin θ), con A = lineare(M) · R(φ) · diag(rx, ry).
        let [a, b, c, d, _, _] = m.0;
        let linear = Matrix([a, b, c, d, 0.0, 0.0])
            .then(Matrix([cos, sin, -sin, cos, 0.0, 0.0]))
            .then(Matrix([rx, 0.0, 0.0, ry, 0.0, 0.0]));
        let [a11, a21, a12, a22, _, _] = linear.0;
        let origin = m.apply(center);
        let point = |theta: f64| {
            let (s, c) = theta.sin_cos();
            [origin[0] + a11 * c + a12 * s, origin[1] + a21 * c + a22 * s]
        };
        self.include(m.apply(from));
        self.include(m.apply(to));
        for base in [a12.atan2(a11), a22.atan2(a21)] {
            for theta in [base, base + PI] {
                let offset = if delta >= 0.0 {
                    (theta - theta1).rem_euclid(TAU)
                } else {
                    -(theta1 - theta).rem_euclid(TAU)
                };
                if offset.abs() <= delta.abs() {
                    self.include(point(theta));
                }
            }
        }
    }

    /// Un'ellisse di centro `center` e raggi `radii`, trasformata da `m`.
    pub fn ellipse(&mut self, center: [f64; 2], [rx, ry]: [f64; 2], m: &Matrix) {
        let [a, b, c, d, _, _] = m.0;
        let half = [
            ((a * rx).powi(2) + (c * ry).powi(2)).sqrt(),
            ((b * rx).powi(2) + (d * ry).powi(2)).sqrt(),
        ];
        let o = m.apply(center);
        self.include([o[0] - half[0], o[1] - half[1]]);
        self.include([o[0] + half[0], o[1] + half[1]]);
    }
}

/// Le radici reali di `a·t² + b·t + c`, anche quando l'equazione degenera in
/// una lineare.
///
/// La forma è quella stabile: `q = −(b + segno(b)·√Δ) / 2`, radici `q / a` e
/// `c / q`. La formula della scuola sottrae due numeri quasi uguali quando
/// `b²` domina `4ac`, e perde le cifre di una radice.
fn quadratic_roots(a: f64, b: f64, c: f64) -> Vec<f64> {
    if a == 0.0 {
        return if b == 0.0 { Vec::new() } else { vec![-c / b] };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return Vec::new();
    }
    let q = -0.5 * (b + discriminant.sqrt().copysign(b));
    if q == 0.0 {
        // b = 0 e c = 0: la sola radice è 0, doppia.
        return vec![0.0];
    }
    vec![q / a, c / q]
}

/// I segmenti di un rettangolo, con gli angoli arrotondati da `rx` e `ry`
/// già ridotti come vuole SVG.
pub(crate) fn rect_path(x: f64, y: f64, w: f64, h: f64, rx: f64, ry: f64) -> Vec<Segment> {
    let rx = rx.min(w / 2.0);
    let ry = ry.min(h / 2.0);
    if rx <= 0.0 || ry <= 0.0 {
        return vec![
            Segment::Move([x, y]),
            Segment::Line([x + w, y]),
            Segment::Line([x + w, y + h]),
            Segment::Line([x, y + h]),
            Segment::Close,
        ];
    }
    let arc = |to: [f64; 2]| Segment::Arc {
        radii: [rx, ry],
        rotation: 0.0,
        large: false,
        sweep: true,
        to,
    };
    vec![
        Segment::Move([x + rx, y]),
        Segment::Line([x + w - rx, y]),
        arc([x + w, y + ry]),
        Segment::Line([x + w, y + h - ry]),
        arc([x + w - rx, y + h]),
        Segment::Line([x + rx, y + h]),
        arc([x, y + h - ry]),
        Segment::Line([x, y + ry]),
        arc([x + rx, y]),
        Segment::Close,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(d: &str, m: Matrix) -> Bounds {
        let mut b = BoundsBuilder::default();
        b.path(&parse_path(d).unwrap(), &m);
        b.finish().unwrap()
    }

    fn close(a: Bounds, min: [f64; 2], max: [f64; 2]) {
        let ok =
            (0..2).all(|i| (a.min[i] - min[i]).abs() < 1e-9 && (a.max[i] - max[i]).abs() < 1e-9);
        assert!(ok, "{a:?} invece di {min:?} {max:?}");
    }

    #[test]
    fn the_path_grammar_is_complete() {
        for valid in [
            "",
            "  ",
            "M0 0",
            "m10 10 20 20",
            "M1,2L3,4",
            "M0 0 a1 1 0 011 1",
            "M0 0 A1 1 0 1 0 2 2",
            "M0 0 C1 1 2 2 3 3 S4 4 5 5 Q6 6 7 7 T8 8 Z",
            "M0 0 h10 v10 H0 V0 z m5 5 l1 1",
            "M1.5.5L2-3",
            "M0 0 1e2 1E-2",
            "M0 0 Z M1 1 Z",
            "M0 0 L1 1, 2 2",
        ] {
            assert!(parse_path(valid).is_some(), "{valid:?}");
        }
        for invalid in [
            "L0 0",
            "M",
            "M0",
            "M0 0 L",
            "M0 0 Z 1 1",
            "M0 0 X1 1",
            "M0 0 A-1 1 0 0 1 2 2",
            "M0 0 A1 1 0 2 1 2 2",
            "M0 0 A1 1 00 1 2 2",
            "M0 0,",
            "M0 0, L1 1",
            "M,0 0",
            "M0 0 L1.",
            "M0 0 L1e",
        ] {
            assert!(parse_path(invalid).is_none(), "{invalid:?}");
        }
    }

    #[test]
    fn relative_and_implicit_commands_become_absolute() {
        let segments = parse_path("m10 10 5 0 v5 z l1 1").unwrap();
        assert_eq!(
            segments,
            vec![
                Segment::Move([10.0, 10.0]),
                Segment::Line([15.0, 10.0]),
                Segment::Line([15.0, 15.0]),
                Segment::Close,
                Segment::Line([11.0, 11.0]),
            ]
        );
    }

    #[test]
    fn curves_contribute_their_extrema_not_their_controls() {
        close(
            bounds("M0 0 Q50 100 100 0", Matrix::IDENTITY),
            [0.0, 0.0],
            [100.0, 50.0],
        );
        close(
            bounds("M0 0 C0 100 100 100 100 0", Matrix::IDENTITY),
            [0.0, 0.0],
            [100.0, 75.0],
        );
        // Un semicerchio di raggio 10 sopra l'asse.
        close(
            bounds("M0 0 A10 10 0 0 1 20 0", Matrix::IDENTITY),
            [0.0, -10.0],
            [20.0, 0.0],
        );
        close(
            bounds("M0 0 A10 10 0 0 0 20 0", Matrix::IDENTITY),
            [0.0, 0.0],
            [20.0, 10.0],
        );
        // Raggi troppo piccoli si allargano fino a congiungere gli estremi.
        close(
            bounds("M0 0 A1 1 0 0 1 20 0", Matrix::IDENTITY),
            [0.0, -10.0],
            [20.0, 0.0],
        );
    }

    #[test]
    fn transformed_curves_stay_exact() {
        let m = Matrix::rotate(45.0);
        let b = bounds("M-10 0 A10 10 0 1 1 10 0 A10 10 0 1 1 -10 0", m);
        close(b, [-10.0, -10.0], [10.0, 10.0]);
        let mut e = BoundsBuilder::default();
        e.ellipse([0.0, 0.0], [20.0, 10.0], &Matrix::rotate(90.0));
        let e = e.finish().unwrap();
        close(e, [-10.0, -20.0], [10.0, 20.0]);
        let mut r = BoundsBuilder::default();
        r.path(
            &rect_path(0.0, 0.0, 10.0, 10.0, 5.0, 5.0),
            &Matrix::rotate(45.0),
        );
        // Un cerchio di raggio 5 col centro in (5, 5), ruotato intorno all'origine.
        let center = 50f64.sqrt();
        close(
            r.finish().unwrap(),
            [-5.0, center - 5.0],
            [5.0, center + 5.0],
        );
    }
}
