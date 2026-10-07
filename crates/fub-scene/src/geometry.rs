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
        radii: [f64; 2],
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
        let Some(arc) = CenterArc::new(from, radii, rotation, large, sweep, to) else {
            self.include(m.apply(from));
            self.include(m.apply(to));
            return;
        };
        let CenterArc {
            center,
            radii: [rx, ry],
            sin,
            cos,
            theta1,
            delta,
        } = arc;

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

/// Un arco ellittico in forma di centro, con la conversione delle note
/// d'implementazione di SVG (F.6.5): i raggi già ingranditi se non bastavano a
/// unire gli estremi, la rotazione dell'asse x, l'angolo d'inizio e l'ampiezza
/// con il segno del verso.
#[derive(Copy, Clone, Debug)]
pub(crate) struct CenterArc {
    pub center: [f64; 2],
    pub radii: [f64; 2],
    pub sin: f64,
    pub cos: f64,
    pub theta1: f64,
    pub delta: f64,
}

impl CenterArc {
    /// L'arco da `from` a `to`; `None` se un raggio è nullo, e allora l'arco è
    /// il segmento fra gli estremi (F.6.2). Gli estremi uguali, per cui l'arco
    /// non si disegna, li esclude chi chiama.
    pub fn new(
        from: [f64; 2],
        [rx, ry]: [f64; 2],
        rotation: f64,
        large: bool,
        sweep: bool,
        to: [f64; 2],
    ) -> Option<CenterArc> {
        let (mut rx, mut ry) = (rx.abs(), ry.abs());
        if rx == 0.0 || ry == 0.0 {
            return None;
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
        Some(CenterArc {
            center,
            radii: [rx, ry],
            sin,
            cos,
            theta1,
            delta,
        })
    }

    /// Il punto dell'arco all'angolo `theta`, nelle coordinate del path.
    pub fn point(&self, theta: f64) -> [f64; 2] {
        let (s, c) = theta.sin_cos();
        let [rx, ry] = self.radii;
        [
            self.center[0] + self.cos * rx * c - self.sin * ry * s,
            self.center[1] + self.sin * rx * c + self.cos * ry * s,
        ]
    }
}

/// In quante corde [`flatten`] divide una curva o un arco.
pub(crate) const CURVE_STEPS: u32 = 16;

/// I sottotracciati di un path come poligoni, nelle coordinate di `m`: ogni
/// curva e ogni arco diventano [`CURVE_STEPS`] corde. Un poligono si intende
/// chiuso, come un sottotracciato quando lo si riempie. Serve a dire se un
/// punto sta dentro una figura piena, non a disegnarla: la corda di un quarto
/// d'ellisse in sedici parti si scosta dall'arco di meno di due millesimi del
/// raggio.
pub(crate) fn flatten(segments: &[Segment], m: &Matrix) -> Vec<Vec<[f64; 2]>> {
    let mut polygons = Vec::new();
    let mut polygon: Vec<[f64; 2]> = Vec::new();
    let mut current = [0.0, 0.0];
    let mut start = [0.0, 0.0];
    let close = |polygon: &mut Vec<[f64; 2]>, polygons: &mut Vec<Vec<[f64; 2]>>| {
        if polygon.len() > 2 {
            polygons.push(std::mem::take(polygon));
        }
        polygon.clear();
    };
    let steps = (1..=CURVE_STEPS).map(|k| f64::from(k) / f64::from(CURVE_STEPS));
    for segment in segments {
        if polygon.is_empty() && !matches!(segment, Segment::Move(_)) {
            polygon.push(m.apply(current));
        }
        match *segment {
            Segment::Move(p) => {
                close(&mut polygon, &mut polygons);
                polygon.push(m.apply(p));
                current = p;
                start = p;
            }
            Segment::Line(p) => {
                polygon.push(m.apply(p));
                current = p;
            }
            Segment::Quad(c, p) => {
                for t in steps.clone() {
                    let u = 1.0 - t;
                    polygon.push(m.apply([
                        u * u * current[0] + 2.0 * u * t * c[0] + t * t * p[0],
                        u * u * current[1] + 2.0 * u * t * c[1] + t * t * p[1],
                    ]));
                }
                current = p;
            }
            Segment::Cubic(c1, c2, p) => {
                for t in steps.clone() {
                    let u = 1.0 - t;
                    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    polygon.push(m.apply([
                        a * current[0] + b * c1[0] + c * c2[0] + d * p[0],
                        a * current[1] + b * c1[1] + c * c2[1] + d * p[1],
                    ]));
                }
                current = p;
            }
            Segment::Arc {
                radii,
                rotation,
                large,
                sweep,
                to,
            } => {
                if current != to {
                    match CenterArc::new(current, radii, rotation, large, sweep, to) {
                        Some(arc) => {
                            for t in steps.clone() {
                                polygon.push(m.apply(arc.point(arc.theta1 + arc.delta * t)));
                            }
                        }
                        None => polygon.push(m.apply(to)),
                    }
                }
                current = to;
            }
            Segment::Close => {
                close(&mut polygon, &mut polygons);
                current = start;
            }
        }
    }
    close(&mut polygon, &mut polygons);
    polygons
}

/// Le corde di un tracciato come lo segue un testo (formato della scena,
/// testo): i sottotracciati uno dopo l'altro, con le curve e gli archi in
/// [`CURVE_STEPS`] corde come in [`flatten`], e `Z` che torna all'inizio del
/// sottotracciato. Gli spostamenti non sono corde.
fn chords(segments: &[Segment]) -> Vec<([f64; 2], [f64; 2])> {
    let mut out = Vec::new();
    let mut current = [0.0, 0.0];
    let mut start = [0.0, 0.0];
    let mut to = |current: &mut [f64; 2], p: [f64; 2]| {
        if p != *current {
            out.push((*current, p));
        }
        *current = p;
    };
    let steps = (1..=CURVE_STEPS).map(|k| f64::from(k) / f64::from(CURVE_STEPS));
    for segment in segments {
        match *segment {
            Segment::Move(p) => {
                current = p;
                start = p;
            }
            Segment::Line(p) => to(&mut current, p),
            Segment::Quad(c, p) => {
                let from = current;
                for t in steps.clone() {
                    let u = 1.0 - t;
                    to(
                        &mut current,
                        [
                            u * u * from[0] + 2.0 * u * t * c[0] + t * t * p[0],
                            u * u * from[1] + 2.0 * u * t * c[1] + t * t * p[1],
                        ],
                    );
                }
            }
            Segment::Cubic(c1, c2, p) => {
                let from = current;
                for t in steps.clone() {
                    let u = 1.0 - t;
                    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    to(
                        &mut current,
                        [
                            a * from[0] + b * c1[0] + c * c2[0] + d * p[0],
                            a * from[1] + b * c1[1] + c * c2[1] + d * p[1],
                        ],
                    );
                }
            }
            Segment::Arc {
                radii,
                rotation,
                large,
                sweep,
                to: end,
            } => {
                // Un arco fra due punti uguali non si disegna.
                if current == end {
                    continue;
                }
                match CenterArc::new(current, radii, rotation, large, sweep, end) {
                    Some(arc) => {
                        for t in steps.clone() {
                            to(&mut current, arc.point(arc.theta1 + arc.delta * t));
                        }
                    }
                    None => to(&mut current, end),
                }
                // L'ultimo punto dell'arco è `to` a meno dell'arrotondamento.
                current = end;
            }
            Segment::Close => to(&mut current, start),
        }
    }
    out
}

/// Un punto lungo un tracciato e la direzione, lunga 1, in cui il tracciato
/// va lì.
#[derive(Copy, Clone, Debug, PartialEq)]
pub(crate) struct Along {
    pub at: [f64; 2],
    pub direction: [f64; 2],
}

/// Il punto di un tracciato a `distance` dal suo inizio, misurata lungo le
/// corde, e la sua direzione: dove un testo su tracciato tiene il punto di
/// `startOffset` (formato della scena, testo). Con `share` la distanza è una
/// frazione della lunghezza del tracciato; fuori dal tracciato si ferma al suo
/// estremo. `None` per un tracciato lungo zero.
pub(crate) fn along(segments: &[Segment], distance: f64, share: bool) -> Option<Along> {
    let mut parts = Vec::new();
    let mut total = 0.0;
    for (a, b) in chords(segments) {
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let l = (dx * dx + dy * dy).sqrt();
        if l > 0.0 {
            parts.push((a, b, l));
            total += l;
        }
    }
    let last = parts.len().checked_sub(1)?;
    // `Math.min(Math.max(…, 0), total)`.
    let wanted = if share { distance * total } else { distance };
    let mut left = wanted.max(0.0).min(total);
    for (i, &(a, b, l)) in parts.iter().enumerate() {
        if left > l && i < last {
            left -= l;
            continue;
        }
        let t = (left / l).min(1.0);
        return Some(Along {
            at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            direction: [(b[0] - a[0]) / l, (b[1] - a[1]) / l],
        });
    }
    None
}

/// Il numero di avvolgimento di `p` intorno ai poligoni: diverso da zero se
/// `p` sta dentro con la regola `nonzero`, quella di SVG quando `fill-rule`
/// manca, e §4 non lo ammette. Un lato conta se attraversa l'orizzontale di
/// `p` salendo o scendendo, con l'estremo basso compreso e l'alto escluso:
/// così un vertice sull'orizzontale conta una volta sola.
pub(crate) fn winding(polygons: &[Vec<[f64; 2]>], p: [f64; 2]) -> i32 {
    let mut winding = 0;
    for polygon in polygons {
        for (i, &a) in polygon.iter().enumerate() {
            let b = polygon[(i + 1) % polygon.len()];
            let side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
            if a[1] <= p[1] {
                if b[1] > p[1] && side > 0.0 {
                    winding += 1;
                }
            } else if b[1] <= p[1] && side < 0.0 {
                winding -= 1;
            }
        }
    }
    winding
}

/// I segmenti di un'ellisse di centro `center` e raggi `radii`: quattro archi
/// a partire dal punto a destra del centro, nel verso di SVG.
pub(crate) fn ellipse_path([cx, cy]: [f64; 2], [rx, ry]: [f64; 2]) -> Vec<Segment> {
    let arc = |to: [f64; 2]| Segment::Arc {
        radii: [rx, ry],
        rotation: 0.0,
        large: false,
        sweep: true,
        to,
    };
    vec![
        Segment::Move([cx + rx, cy]),
        arc([cx, cy + ry]),
        arc([cx - rx, cy]),
        arc([cx, cy - ry]),
        arc([cx + rx, cy]),
        Segment::Close,
    ]
}

/// I segmenti di un poligono o di una polilinea: SVG riempie anche la
/// polilinea, come se fosse chiusa.
pub(crate) fn points_path(points: &[[f64; 2]]) -> Vec<Segment> {
    let mut segments = Vec::with_capacity(points.len() + 1);
    for (i, &p) in points.iter().enumerate() {
        segments.push(if i == 0 {
            Segment::Move(p)
        } else {
            Segment::Line(p)
        });
    }
    if !segments.is_empty() {
        segments.push(Segment::Close);
    }
    segments
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

    fn polygons(d: &str, m: Matrix) -> Vec<Vec<[f64; 2]>> {
        flatten(&parse_path(d).unwrap(), &m)
    }

    #[test]
    fn flattened_shapes_wind_around_the_points_inside() {
        let square = "M0 0 L10 0 L10 10 L0 10 Z";
        assert_ne!(winding(&polygons(square, Matrix::IDENTITY), [5.0, 5.0]), 0);
        assert_eq!(winding(&polygons(square, Matrix::IDENTITY), [15.0, 5.0]), 0);
        // Con `nonzero` un buco disegnato al contrario resta vuoto, uno nello
        // stesso verso si riempie.
        let hole = "M0 0 L10 0 L10 10 L0 10 Z M3 3 L3 7 L7 7 L7 3 Z";
        assert_eq!(winding(&polygons(hole, Matrix::IDENTITY), [5.0, 5.0]), 0);
        assert_ne!(winding(&polygons(hole, Matrix::IDENTITY), [1.0, 5.0]), 0);
        let same = "M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z";
        assert_eq!(
            winding(&polygons(same, Matrix::IDENTITY), [5.0, 5.0]).abs(),
            2
        );
        // Gli archi e le curve seguono la loro forma.
        let ellipse = flatten(&ellipse_path([0.0, 0.0], [10.0, 5.0]), &Matrix::IDENTITY);
        assert_ne!(winding(&ellipse, [9.0, 0.0]), 0);
        assert_eq!(winding(&ellipse, [9.0, 4.0]), 0);
        let bulge = polygons("M0 0 Q5 10 10 0 Z", Matrix::IDENTITY);
        assert_ne!(winding(&bulge, [5.0, 4.0]), 0);
        assert_eq!(winding(&bulge, [5.0, 6.0]), 0);
        // La matrice sposta i poligoni.
        let moved = polygons(square, Matrix::translate(100.0, 0.0));
        assert_ne!(winding(&moved, [105.0, 5.0]), 0);
        assert_eq!(winding(&moved, [5.0, 5.0]), 0);
        // Un sottotracciato aperto si riempie come se fosse chiuso; una
        // linea non ha area.
        assert_ne!(
            winding(&polygons("M0 0 L10 0 L10 10", Matrix::IDENTITY), [8.0, 2.0]),
            0
        );
        assert!(polygons("M0 0 L10 10", Matrix::IDENTITY).is_empty());
        // Dopo `Z` senza `M` il sottotracciato nuovo riparte dall'inizio.
        let again = polygons("M0 0 L10 0 L10 10 Z L0 10 L-10 10 Z", Matrix::IDENTITY);
        assert_eq!(again.len(), 2);
        assert_eq!(again[1][0], [0.0, 0.0]);
    }

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
