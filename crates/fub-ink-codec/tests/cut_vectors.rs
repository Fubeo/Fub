//! I casi della gomma che taglia, `apps/client/src/__fixtures__/ink-cut.json`,
//! scritti a mano: `split_ink` e `cut_brush` di `src/cut.rs` devono dare i pezzi
//! e i pennelli che il file dice. L'altra metà è
//! `apps/client/src/ink/tools/split-vectors.test.ts`, che fa girare gli stessi
//! casi contro `split.ts`, che fa fede.

use std::path::PathBuf;

use fub_ink_codec::cut::{cut_brush, split_ink, InkPiece, Spot};
use fub_ink_codec::{InkBrush, Sample};
use serde_json::Value;

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/ink-cut.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("ink-cut.json: {e}"))
}

fn number(value: &Value, what: &str) -> f64 {
    value
        .as_f64()
        .unwrap_or_else(|| panic!("{what} non è un numero: {value}"))
}

/// Un campione del file: `{x, y, t, p?, a?, z?}`, con `a` e `z` insieme.
fn sample(value: &Value, what: &str) -> Sample {
    let get = |key: &str| value.get(key).map(|v| number(v, what));
    let tilt = match (get("a"), get("z")) {
        (Some(a), Some(z)) => Some((a, z)),
        (None, None) => None,
        _ => panic!("{what}: `a` e `z` vanno insieme"),
    };
    Sample {
        x: get("x").unwrap_or_else(|| panic!("{what}: manca x")),
        y: get("y").unwrap_or_else(|| panic!("{what}: manca y")),
        p: get("p"),
        t: get("t").unwrap_or_else(|| panic!("{what}: manca t")),
        tilt,
    }
}

fn samples(value: &Value, what: &str) -> Vec<Sample> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("{what}: i campioni sono una lista"))
        .iter()
        .map(|s| sample(s, what))
        .collect()
}

fn close(left: f64, right: f64, tolerance: f64) -> bool {
    (left - right).abs() <= tolerance
}

fn same_sample(got: &Sample, want: &Sample, tolerance: f64) -> bool {
    let option = |l: Option<f64>, r: Option<f64>| match (l, r) {
        (Some(l), Some(r)) => close(l, r, tolerance),
        (None, None) => true,
        _ => false,
    };
    close(got.x, want.x, tolerance)
        && close(got.y, want.y, tolerance)
        && close(got.t, want.t, tolerance)
        && option(got.p, want.p)
        && option(got.tilt.map(|t| t.0), want.tilt.map(|t| t.0))
        && option(got.tilt.map(|t| t.1), want.tilt.map(|t| t.1))
}

fn check_pieces(name: &str, got: &[InkPiece], want: &[Value], tolerance: f64) {
    assert_eq!(got.len(), want.len(), "{name}: quanti pezzi\n{got:#?}");
    for (at, (piece, expect)) in got.iter().zip(want).enumerate() {
        let what = format!("{name}, pezzo {at}");
        assert_eq!(
            Some(piece.cut_start),
            expect["cutStart"].as_bool(),
            "{what}: cutStart"
        );
        assert_eq!(
            Some(piece.cut_end),
            expect["cutEnd"].as_bool(),
            "{what}: cutEnd"
        );
        assert!(
            close(piece.offset, number(&expect["offset"], &what), tolerance),
            "{what}: offset {}",
            piece.offset
        );
        let samples = samples(&expect["samples"], &what);
        assert_eq!(
            piece.samples.len(),
            samples.len(),
            "{what}: quanti campioni\n{:#?}",
            piece.samples
        );
        for (i, (got, want)) in piece.samples.iter().zip(&samples).enumerate() {
            assert!(
                same_sample(got, want, tolerance),
                "{what}, campione {i}: {got:?} invece di {want:?}"
            );
        }
    }
}

#[test]
fn i_tagli_del_file_tornano() {
    let file = vectors();
    let tolerance = number(&file["tolerance"], "tolerance");
    let cases = file["split"].as_array().expect("split è una lista");
    assert!(cases.len() >= 6, "i sei casi del piano ci sono");
    for case in cases {
        let name = case["name"].as_str().expect("un nome");
        let path: Vec<Spot> = serde_json::from_value(case["path"].clone())
            .unwrap_or_else(|e| panic!("{name}: path {e}"));
        let radius = number(&case["radius"], name);
        let got = split_ink(&samples(&case["samples"], name), &path, radius);
        match (&case["expect"], got) {
            (Value::Null, None) => {}
            (Value::Null, Some(pieces)) => panic!("{name}: non doveva toccarlo\n{pieces:#?}"),
            (Value::Array(_), None) => panic!("{name}: doveva toccarlo"),
            (Value::Array(want), Some(pieces)) => check_pieces(name, &pieces, want, tolerance),
            (other, _) => panic!("{name}: expect è null o una lista, non {other}"),
        }
    }
}

#[test]
fn i_pennelli_del_file_tornano() {
    let file = vectors();
    let cases = file["brush"].as_array().expect("brush è una lista");
    assert!(!cases.is_empty());
    for case in cases {
        let name = case["name"].as_str().expect("un nome");
        let brush = InkBrush::parse(case["brush"].as_str().expect("un pennello"))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let cut = cut_brush(
            &brush,
            case["cutStart"].as_bool().expect("cutStart"),
            case["cutEnd"].as_bool().expect("cutEnd"),
        );
        let text = cut.encode().unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(Some(text.as_str()), case["expect"].as_str(), "{name}");
    }
}
