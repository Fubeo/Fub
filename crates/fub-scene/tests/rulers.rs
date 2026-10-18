//! L'unità e le guide del documento (formato della scena, unità e guide), coi
//! casi scritti a mano che valgono anche per la superficie:
//! `apps/client/src/__fixtures__/scene-rulers/`.

use std::path::PathBuf;

use fub_scene::rulers::{parse_guides, Axis, Guide, Unit, MAX_GUIDES};
use serde_json::Value;

fn cases() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-rulers/cases.json");
    let text = std::fs::read_to_string(&path).expect("i casi delle unità e delle guide");
    serde_json::from_str(&text).expect("JSON dei casi")
}

#[test]
fn le_unita_dei_casi() {
    let cases = cases();
    let units = cases["units"].as_array().unwrap();
    assert!(units.len() >= 10);
    for case in units {
        let value = case["value"].as_str().unwrap();
        let expected = case["unit"].as_str();
        let actual = Unit::parse(value).map(|unit| serde_json::to_value(unit).unwrap());
        assert_eq!(
            actual.as_ref().and_then(Value::as_str),
            expected,
            "{value:?}"
        );
    }
}

#[test]
fn le_guide_dei_casi() {
    let cases = cases();
    let guides = cases["guides"].as_array().unwrap();
    assert!(guides.len() >= 20);
    for case in guides {
        let value = case["value"].as_str().unwrap();
        let actual = parse_guides(value).map(|guides| serde_json::to_value(guides).unwrap());
        let expected = (!case["guides"].is_null()).then(|| case["guides"].clone());
        // Il JSON dei casi scrive gli interi senza decimali, serde li scrive
        // come `f64`: si confrontano i numeri.
        match (actual, expected) {
            (None, None) => {}
            (Some(Value::Array(actual)), Some(Value::Array(expected))) => {
                assert_eq!(actual.len(), expected.len(), "{value:?}");
                for (a, e) in actual.iter().zip(&expected) {
                    assert_eq!(a["axis"], e["axis"], "{value:?}");
                    assert_eq!(a["locked"], e["locked"], "{value:?}");
                    assert_eq!(a["at"].as_f64(), e["at"].as_f64(), "{value:?}");
                }
            }
            (actual, expected) => panic!("{value:?}: {actual:?} invece di {expected:?}"),
        }
    }
}

#[test]
fn le_guide_sono_al_piu_mille() {
    let many = |n: usize| {
        (0..n)
            .map(|i| format!("x {i}"))
            .collect::<Vec<_>>()
            .join("; ")
    };
    assert_eq!(parse_guides(&many(MAX_GUIDES)).unwrap().len(), MAX_GUIDES);
    assert_eq!(parse_guides(&many(MAX_GUIDES + 1)), None);
}

#[test]
fn una_guida_non_ha_segno() {
    let guides = parse_guides("y -0").unwrap();
    assert_eq!(
        guides,
        [Guide {
            axis: Axis::Y,
            at: 0.0,
            locked: false
        }]
    );
    assert!(guides[0].at.is_sign_positive());
}

#[test]
fn un_pollice_e_96_unita() {
    assert_eq!(Unit::In.size(), 96.0);
    assert_eq!(Unit::Px.size(), 1.0);
    assert!((Unit::Cm.size() * 2.54 - 96.0).abs() < 1e-12);
    assert!((Unit::Mm.size() * 25.4 - 96.0).abs() < 1e-12);
    assert!((Unit::Pt.size() * 72.0 - 96.0).abs() < 1e-12);
}
