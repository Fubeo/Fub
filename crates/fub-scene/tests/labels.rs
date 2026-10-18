//! Le etichette nelle forme (formato della scena, etichette), coi casi
//! scritti a mano che valgono anche per la superficie:
//! `apps/client/src/__fixtures__/scene-labels/cases.json`.

mod common;

use common::{at, doc, load};
use fub_scene::labels::read_inside;
use fub_scene::Role;

/// Il valore di un attributo scritto con gli escape di §7: anche tabulazioni
/// e a capo restano quelli che sono, e non diventano spazi.
fn attribute(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '"' => out.push_str("&quot;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
    out
}

#[test]
fn le_forme_dei_casi() {
    let cases = common::label_cases();
    let all = cases["inside"].as_array().unwrap();
    let read = all.iter().filter(|case| !case["read"].is_null()).count();
    assert!(read >= 6 && all.len() - read >= 6, "{read} {}", all.len());
    for case in all {
        let inside = case["text"].as_str().unwrap();
        assert_eq!(
            serde_json::to_value(read_inside(inside)).unwrap(),
            case["read"],
            "{inside:?}"
        );
    }
}

#[test]
fn un_testo_porta_la_forma_scritta() {
    let cases = common::label_cases();
    for case in cases["inside"].as_array().unwrap() {
        let inside = case["text"].as_str().unwrap();
        let source = doc(&format!(
            r#"<text fub:inside="{}" x="5" y="5"><tspan x="5" dy="0">Sì</tspan></text>"#,
            attribute(inside)
        ));
        let scene = load(&source);
        let item = at(&scene, &[0]).unwrap();
        assert_eq!(item.role, Role::Text, "{inside:?}");
        assert_eq!(
            serde_json::to_value(&item.inside).unwrap(),
            case["read"],
            "{inside:?}"
        );
    }
}

#[test]
fn fub_inside_conta_solo_su_un_testo() {
    let scene = load(&doc(
        r#"<rect fub:inside="r1" x="0" y="0" width="10" height="10"/>"#,
    ));
    let item = at(&scene, &[0]).unwrap();
    assert_eq!((item.role, item.inside.is_none()), (Role::Rect, true));
}
