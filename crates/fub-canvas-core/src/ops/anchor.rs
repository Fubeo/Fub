//! A quale scheda va un tratto: `strokeBounds` e `anchorAt` di
//! `apps/client/src/editors/canvas/anchor.ts`, portati riga per riga. Fa fede
//! il TypeScript, che la tela usa quando la penna si alza: `draw` con
//! `on: "auto"` deve dare la stessa scheda.
//!
//! Solo geometria sulle coordinate della lavagna, con le stesse guardie sui
//! numeri non finiti. Le due copie le legano i casi scritti a mano di
//! `apps/client/src/__fixtures__/ink-anchor.json`, che girano qui (i test in
//! fondo) e in Vitest contro `anchor.ts`
//! (`apps/client/src/editors/canvas/anchor-vectors.test.ts`).

use crate::layout::Rect;

/// Il riquadro di `points` allargato di metà `size` da ogni lato, così anche
/// un tocco solo ha un'area.
///
/// Non dà mai `NaN`: i punti con una coordinata non finita si saltano, un
/// `size` non finito o negativo vale 0, e senza punti validi il riquadro è
/// quello vuoto nell'origine. Vicino ai limiti di `f64` la larghezza può
/// ancora traboccare in infinito; [`anchor_at`] tratta quel riquadro come
/// libero.
pub(crate) fn stroke_bounds(points: impl IntoIterator<Item = (f64, f64)>, size: f64) -> Rect {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (x, y) in points {
        if !x.is_finite() || !y.is_finite() {
            continue;
        }
        if x < min_x {
            min_x = x;
        }
        if x > max_x {
            max_x = x;
        }
        if y < min_y {
            min_y = y;
        }
        if y > max_y {
            max_y = y;
        }
    }
    if min_x > max_x {
        return Rect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        };
    }
    let half = if size.is_finite() && size > 0.0 {
        size / 2.0
    } else {
        0.0
    };
    let x = min_x - half;
    let y = min_y - half;
    Rect {
        x,
        y,
        width: max_x + half - x,
        height: max_y + half - y,
    }
}

/// La posizione in `cards` della scheda a cui appartiene il tratto di
/// riquadro `b`, o `None` se il tratto è libero. `cards` sono i rettangoli
/// delle schede nell'ordine di `nodes`.
///
/// Conta solo la scheda più in alto che il riquadro tocca (l'ultima): il
/// tratto è suo se lei contiene il centro di `b` (i bordi contano dentro), se
/// dentro di lei sta almeno metà dell'area di `b` e se `can_hold` la accetta;
/// altrimenti il tratto è libero, anche se una scheda sotto lo avrebbe preso.
///
/// La parte di `b` dentro una scheda si misura asse per asse, così una scheda
/// enorme non fa traboccare un'area. Su un asse dove `b` non ha lunghezza il
/// riquadro è un punto: è coperto tutto se il punto sta dentro la scheda,
/// bordi compresi, e per niente altrimenti. Un riquadro con una misura non
/// finita o negativa non è di nessuno. Le schede con una posizione non
/// finita, o una misura non finita o non positiva, non toccano niente.
pub(crate) fn anchor_at(
    cards: &[Rect],
    b: Rect,
    can_hold: impl Fn(usize) -> bool,
) -> Option<usize> {
    if !valid_box(&b) {
        return None;
    }
    for (index, card) in cards.iter().enumerate().rev() {
        if !valid_card(card) {
            continue;
        }
        let share = coverage(b.x, b.width, card.x, card.width)
            * coverage(b.y, b.height, card.y, card.height);
        if share <= 0.0 {
            continue;
        }
        let owns = share >= 0.5
            && within(b.x + b.width / 2.0, card.x, card.width)
            && within(b.y + b.height / 2.0, card.y, card.height)
            && can_hold(index);
        return owns.then_some(index);
    }
    None
}

fn valid_box(b: &Rect) -> bool {
    b.x.is_finite()
        && b.y.is_finite()
        && b.width.is_finite()
        && b.height.is_finite()
        && b.width >= 0.0
        && b.height >= 0.0
}

fn valid_card(card: &Rect) -> bool {
    card.x.is_finite()
        && card.y.is_finite()
        && card.width.is_finite()
        && card.height.is_finite()
        && card.width > 0.0
        && card.height > 0.0
}

/// La parte, fra 0 e 1, del segmento `start..start+length` che sta dentro
/// `card_start..card_start+card_length`.
fn coverage(start: f64, length: f64, card_start: f64, card_length: f64) -> f64 {
    if length == 0.0 {
        return if within(start, card_start, card_length) {
            1.0
        } else {
            0.0
        };
    }
    let overlap = (start + length).min(card_start + card_length) - start.max(card_start);
    // Come `!(overlap > 0)` del TypeScript: anche `NaN` non copre.
    if overlap.is_nan() || overlap <= 0.0 {
        return 0.0;
    }
    (overlap / length).min(1.0)
}

fn within(value: f64, start: f64, length: f64) -> bool {
    value >= start && value <= start + length
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::Value;

    use super::*;

    /// Il file dei casi, scritto a mano e letto anche da Vitest.
    fn cases() -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src/__fixtures__/ink-anchor.json");
        let text = std::fs::read_to_string(&path).expect("ink-anchor.json si legge");
        serde_json::from_str(&text).expect("ink-anchor.json è JSON")
    }

    /// Un numero del file: un numero JSON, o `"NaN"`, `"Infinity"`,
    /// `"-Infinity"`, che JSON non sa scrivere.
    fn number(value: &Value) -> f64 {
        match value {
            Value::Number(number) => number.as_f64().expect("un numero"),
            Value::String(text) => match text.as_str() {
                "NaN" => f64::NAN,
                "Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                other => panic!("numero sconosciuto {other:?}"),
            },
            other => panic!("non è un numero: {other}"),
        }
    }

    fn rect(value: &Value) -> Rect {
        Rect {
            x: number(&value["x"]),
            y: number(&value["y"]),
            width: number(&value["width"]),
            height: number(&value["height"]),
        }
    }

    /// Due numeri uguali, anche se infiniti; a meno di un ulp relativo,
    /// perché il TypeScript fa le stesse operazioni nello stesso ordine.
    fn same(left: f64, right: f64) -> bool {
        left == right || (left - right).abs() <= f64::EPSILON * left.abs().max(right.abs())
    }

    #[test]
    fn i_riquadri_dei_casi_sono_quelli_di_anchor_ts() {
        let cases = cases();
        let list = cases["bounds"].as_array().expect("bounds è una lista");
        assert!(list.len() >= 5, "pochi casi di strokeBounds");
        for case in list {
            let name = case["name"].as_str().expect("un nome");
            let points: Vec<(f64, f64)> = case["points"]
                .as_array()
                .expect("points è una lista")
                .iter()
                .map(|point| (number(&point[0]), number(&point[1])))
                .collect();
            let got = stroke_bounds(points, number(&case["size"]));
            let want = rect(&case["expect"]);
            assert!(
                same(got.x, want.x)
                    && same(got.y, want.y)
                    && same(got.width, want.width)
                    && same(got.height, want.height),
                "{name}: {got:?} invece di {want:?}"
            );
        }
    }

    #[test]
    fn le_ancore_dei_casi_sono_quelle_di_anchor_ts() {
        let cases = cases();
        let list = cases["anchor"].as_array().expect("anchor è una lista");
        assert!(list.len() >= 8, "pochi casi di anchorAt");
        for case in list {
            let name = case["name"].as_str().expect("un nome");
            let nodes = case["nodes"].as_array().expect("nodes è una lista");
            let cards: Vec<Rect> = nodes.iter().map(rect).collect();
            let refused: Vec<&str> = case
                .get("refuse")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let got = anchor_at(&cards, rect(&case["bounds"]), |index| {
                !refused.contains(&nodes[index]["id"].as_str().unwrap_or_default())
            })
            .map(|index| nodes[index]["id"].clone())
            .unwrap_or(Value::Null);
            assert_eq!(got, case["expect"], "{name}");
        }
    }
}
