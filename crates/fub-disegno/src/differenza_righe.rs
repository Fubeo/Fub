//! Le righe di un testo del motore come le scrive il file (K6 T16): la
//! posizione del `<text>` (`x`, `y`, per un testo in area `fub:wrap`) e un
//! `<tspan>` per riga, con `x`, `dy` e, in area, `fub:join`
//! (`docs/reference/scene-format-text.md`, §4).
//!
//! Le righe di un testo in area sono quelle che il motore dispone nel suo
//! riquadro, largo quanto il riquadro e alto quanto serve: il formato non
//! scrive l'altezza, che va dalla prima riga all'ultima.

use serde_json::{json, Value};
use vectorcraft_doc::text::{Justify, TextKind, TextObject};
use vectorcraft_geom::{shapes, Affine, Point, Rect};

use super::{numero, DECIMALI_GEOMETRIA};

/// Il perché di un testo che va a capo in modo che il file non dice.
pub(crate) const RIQUADRO_FUORI: &str =
    "il testo in area di Fub è un riquadro solo, senza margine interno, colonne o righe, con il testo orizzontale";
/// Il perché del giustificato in area.
pub(crate) const GIUSTIFICATO_IN_AREA: &str =
    "il file non scrive il giustificato: il testo in area si allinea a sinistra, al centro o a destra";

/// La posizione e le righe di un testo, come attributi e figli del `<text>`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RigheScritte {
    pub x: String,
    pub y: String,
    /// `fub:wrap`, per un testo in area.
    pub wrap: Option<String>,
    /// I `<tspan>`, come `children` di un `add`.
    pub righe: Vec<Value>,
}

/// Le righe del testo `t`, con `m` dallo spazio del testo a quello del
/// `<text>`. `righe_di_punto` sono le righe di un testo di punto già pronte
/// (quelle che non cambiano restano come le scrive il file); senza, sono le
/// righe del motore. Un errore dice perché il file non le scrive.
pub(crate) fn righe_scritte(
    t: &TextObject,
    m: Affine,
    righe_di_punto: Option<Vec<String>>,
) -> Result<RigheScritte, &'static str> {
    if t.vertical {
        return Err(RIQUADRO_FUORI);
    }
    let [a, b, c, d, _, _] = m.as_coeffs();
    let s = a;
    if !(s.is_finite() && s > 1e-9)
        || b.abs() > 1e-6 * s
        || c.abs() > 1e-6 * s
        || (d - s).abs() > 1e-6 * s
    {
        return Err("il testo è ruotato, inclinato o schiacciato: le sue righe non si riscrivono");
    }
    let passo = |dy: f64| numero(dy * s, DECIMALI_GEOMETRIA);
    match &t.kind {
        TextKind::Point => {
            let testo = t.plain_text();
            let righe = righe_di_punto
                .unwrap_or_else(|| dividi(&testo).into_iter().map(str::to_string).collect());
            let lay = vectorcraft_text::layout(vectorcraft_text::FontDb::global(), t);
            let interlinea = t
                .runs
                .first()
                .map(|r| r.style.effective_leading())
                .unwrap_or(0.0);
            let basi: Option<Vec<f64>> = (lay.lines.len() == righe.len())
                .then(|| lay.lines.iter().map(|l| l.baseline).collect());
            let o = m * Point::ZERO;
            let x = numero(o.x, DECIMALI_GEOMETRIA);
            let figli = righe
                .into_iter()
                .enumerate()
                .map(|(i, riga)| {
                    let dy = match (&basi, i) {
                        (_, 0) => "0".to_string(),
                        (Some(basi), i) => passo(basi[i] - basi[i - 1]),
                        (None, _) => passo(interlinea),
                    };
                    json!({ "tag": "tspan", "attrs": { "x": x, "dy": dy }, "text": riga })
                })
                .collect();
            Ok(RigheScritte {
                x: x.clone(),
                y: numero(o.y, DECIMALI_GEOMETRIA),
                wrap: None,
                righe: figli,
            })
        }
        TextKind::Area { frame } => {
            let area = &t.area;
            if area.rows != 1
                || area.columns != 1
                || area.inset.abs() > 1e-9
                || frame.subpaths.len() != 1
                || !t.wrap.is_empty()
            {
                return Err(RIQUADRO_FUORI);
            }
            let fb = frame.bounds().ok_or(RIQUADRO_FUORI)?;
            if fb.width() <= 1e-6 || !fb.width().is_finite() {
                return Err(RIQUADRO_FUORI);
            }
            let ancora = match t.para_at(0).justify {
                Justify::Left | Justify::Auto => 0.0,
                Justify::Center => 0.5,
                Justify::Right => 1.0,
                _ => return Err(GIUSTIFICATO_IN_AREA),
            };
            if (0..t.paras.len()).any(|i| t.para_at(i).justify != t.para_at(0).justify) {
                return Err(
                    "i paragrafi di un testo in area hanno tutti lo stesso allineamento nel file",
                );
            }
            // Il riquadro alto quanto serve: le righe che il formato scrive.
            let mut alto = t.clone();
            alto.area.fit = Default::default();
            alto.kind = TextKind::Area {
                frame: shapes::rectangle(Rect::new(fb.x0, fb.y0, fb.x1, fb.y0 + 1e7)),
            };
            let lay = vectorcraft_text::layout(vectorcraft_text::FontDb::global(), &alto);
            let testo = alto.plain_text();
            let mut righe: Vec<(String, Option<&'static str>)> = Vec::new();
            for (i, l) in lay.lines.iter().enumerate() {
                let riga = testo.get(l.start..l.end).ok_or(RIQUADRO_FUORI)?;
                let unione = match l.start.checked_sub(1).map(|p| testo.as_bytes()[p]) {
                    _ if i == 0 => None,
                    Some(b'\n') | None => None,
                    Some(b' ') => Some("space"),
                    Some(_) => Some("word"),
                };
                if unione == Some("space") {
                    if let Some((prima, _)) = righe.last_mut() {
                        if prima.ends_with(' ') {
                            prima.pop();
                        }
                    }
                }
                righe.push((riga.strip_suffix('\n').unwrap_or(riga).to_string(), unione));
            }
            if righe.is_empty() {
                righe.push((String::new(), None));
            }
            // Le righe tornano il testo senza perdere un carattere.
            let mut di_nuovo = String::new();
            for (i, (riga, unione)) in righe.iter().enumerate() {
                if i > 0 {
                    di_nuovo.push_str(match unione {
                        None => "\n",
                        Some("space") => " ",
                        Some(_) => "",
                    });
                }
                di_nuovo.push_str(riga);
            }
            if di_nuovo != testo.replace("\r\n", "\n") {
                return Err("il testo non si scrive riga per riga nel riquadro: le righe del file non lo ridanno uguale");
            }
            let base = lay.lines.first().map_or(fb.y0, |l| l.baseline);
            let o = m * Point::new(fb.x0 + ancora * fb.width(), base);
            let x = numero(o.x, DECIMALI_GEOMETRIA);
            let basi: Vec<f64> = lay.lines.iter().map(|l| l.baseline).collect();
            let figli = righe
                .into_iter()
                .enumerate()
                .map(|(i, (riga, unione))| {
                    let dy = if i == 0 {
                        "0".to_string()
                    } else {
                        passo(basi[i] - basi[i - 1])
                    };
                    let mut attrs = serde_json::Map::new();
                    if let Some(u) = unione {
                        attrs.insert("fub:join".into(), json!(u));
                    }
                    attrs.insert("x".into(), json!(x));
                    attrs.insert("dy".into(), json!(dy));
                    json!({ "tag": "tspan", "attrs": attrs, "text": riga })
                })
                .collect();
            Ok(RigheScritte {
                x: x.clone(),
                y: numero(o.y, DECIMALI_GEOMETRIA),
                wrap: Some(numero(fb.width() * s, DECIMALI_GEOMETRIA)),
                righe: figli,
            })
        }
        _ => Err("dal motore si scrivono il testo di punto e il testo in area"),
    }
}

/// Le righe di un testo: si va a capo con LF, CRLF, CR e i separatori di
/// riga e di paragrafo del motore.
pub(crate) fn dividi(testo: &str) -> Vec<&str> {
    let mut fuori = Vec::new();
    let mut da = 0;
    let mut it = testo.char_indices().peekable();
    while let Some((i, c)) = it.next() {
        if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}' | '\u{3}') {
            fuori.push(&testo[da..i]);
            let mut fine = i + c.len_utf8();
            if c == '\r' && it.peek().is_some_and(|(_, d)| *d == '\n') {
                it.next();
                fine += 1;
            }
            da = fine;
        }
    }
    fuori.push(&testo[da..]);
    fuori
}
