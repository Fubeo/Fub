//! Geometria: matrici affini e la grammatica dei path di SVG 2.

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
