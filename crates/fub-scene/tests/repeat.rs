//! Le ripetizioni (formato della scena, ripetizioni), coi casi scritti a mano
//! che valgono anche per la superficie:
//! `apps/client/src/__fixtures__/scene-repeat/cases.json`.

mod common;

use fub_scene::repeat::read_repeat;

#[test]
fn le_ripetizioni_dei_casi() {
    let cases = common::repeat_cases();
    let all = cases["read"].as_array().unwrap();
    let read = all.iter().filter(|case| !case["read"].is_null()).count();
    assert!(read >= 12 && all.len() - read >= 30, "{read} {}", all.len());
    for case in all {
        let text = case["text"].as_str().unwrap();
        assert_eq!(
            common::as_floats(serde_json::to_value(read_repeat(text)).unwrap()),
            common::as_floats(case["read"].clone()),
            "{text:?}"
        );
    }
}

#[test]
fn le_ripetizioni_scritte_si_rileggono() {
    let cases = common::repeat_cases();
    for case in cases["write"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let read = read_repeat(text).unwrap_or_else(|| panic!("{text:?}"));
        assert_eq!(
            serde_json::to_value(&read).unwrap()["kind"],
            case["repeat"]["kind"],
            "{text:?}"
        );
    }
}
