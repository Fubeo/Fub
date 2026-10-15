//! I connettori (formato della scena, connettori), coi casi scritti a mano
//! che valgono anche per la superficie:
//! `apps/client/src/__fixtures__/scene-connectors/`.

mod common;

use common::{at, doc, load, role};
use fub_scene::connectors::{
    read_connector_end, read_connector_geom, read_label_place, Anchor, ConnectorKind,
    MAX_ELBOW_POINTS,
};
use fub_scene::Role;
use serde_json::Value;

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

/// Quanti casi dell'elenco `name` si leggono e quanti no.
fn tally(cases: &Value, name: &str) -> (usize, usize) {
    let all = cases[name].as_array().unwrap();
    let read = all.iter().filter(|case| !case["read"].is_null()).count();
    (read, all.len() - read)
}

#[test]
fn la_geometria_dei_casi() {
    let cases = common::connector_cases();
    let (read, refused) = tally(&cases, "geom");
    assert!(read >= 12 && refused >= 15, "{read} {refused}");
    for case in cases["geom"].as_array().unwrap() {
        let geom = case["text"].as_str().unwrap();
        assert_eq!(
            common::as_floats(serde_json::to_value(read_connector_geom(geom)).unwrap()),
            common::as_floats(case["read"].clone()),
            "{geom:?}"
        );
    }
}

#[test]
fn i_capi_dei_casi() {
    let cases = common::connector_cases();
    let (read, refused) = tally(&cases, "end");
    assert!(read >= 6 && refused >= 8, "{read} {refused}");
    for case in cases["end"].as_array().unwrap() {
        let end = case["text"].as_str().unwrap();
        assert_eq!(
            serde_json::to_value(read_connector_end(end)).unwrap(),
            case["read"],
            "{end:?}"
        );
    }
}

#[test]
fn le_etichette_dei_casi() {
    let cases = common::connector_cases();
    let (read, refused) = tally(&cases, "along");
    assert!(read >= 6 && refused >= 12, "{read} {refused}");
    for case in cases["along"].as_array().unwrap() {
        let along = case["text"].as_str().unwrap();
        assert_eq!(
            common::as_floats(serde_json::to_value(read_label_place(along)).unwrap()),
            common::as_floats(case["read"].clone()),
            "{along:?}"
        );
    }
}

#[test]
fn la_geometria_scritta_dalla_superficie_si_rilegge() {
    let cases = common::connector_cases();
    for case in cases["write"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let written = read_connector_geom(text).unwrap_or_else(|| panic!("{text:?}"));
        let input = &case["geom"];
        let kind = input["kind"].as_str().unwrap();
        assert_eq!(
            serde_json::to_value(written.kind).unwrap(),
            kind,
            "{text:?}"
        );
        let points = input["points"].as_array().unwrap();
        assert_eq!(written.points.len(), points.len(), "{text:?}");
        // Scritta a due decimali, si rilegge a meno di mezzo centesimo.
        for (read, wanted) in written.points.iter().zip(points) {
            for axis in 0..2 {
                let wanted = wanted[axis].as_f64().unwrap();
                assert!((read[axis] - wanted).abs() <= 0.005 + 1e-9, "{text:?}");
            }
        }
    }
}

#[test]
fn un_gomito_ha_da_due_a_sessantaquattro_vertici() {
    let elbow = |count: usize| {
        let points: String = (0..count).map(|i| format!(" {i} {}", i % 2)).collect();
        read_connector_geom(&format!("elbow{points}"))
    };
    assert_eq!(MAX_ELBOW_POINTS, 64);
    assert!(elbow(1).is_none());
    assert_eq!(elbow(2).unwrap().points.len(), 2);
    assert_eq!(elbow(MAX_ELBOW_POINTS).unwrap().points.len(), 64);
    assert!(elbow(MAX_ELBOW_POINTS + 1).is_none());
}

#[test]
fn il_tipo_e_l_aggancio_si_scrivono_esatti() {
    assert_eq!(
        ConnectorKind::parse("straight"),
        Some(ConnectorKind::Straight)
    );
    assert_eq!(ConnectorKind::parse("elbow"), Some(ConnectorKind::Elbow));
    assert_eq!(ConnectorKind::parse("curved"), Some(ConnectorKind::Curved));
    for refused in ["", "Elbow", "elbow ", "arrow", "line"] {
        assert_eq!(ConnectorKind::parse(refused), None, "{refused:?}");
    }
    let anchors = ["auto", "center", "top", "right", "bottom", "left"];
    let parsed: Vec<_> = anchors.iter().map(|a| Anchor::parse(a)).collect();
    assert_eq!(
        parsed,
        [
            Some(Anchor::Auto),
            Some(Anchor::Center),
            Some(Anchor::Top),
            Some(Anchor::Right),
            Some(Anchor::Bottom),
            Some(Anchor::Left),
        ]
    );
    for refused in ["", "Top", "middle", "north"] {
        assert_eq!(Anchor::parse(refused), None, "{refused:?}");
    }
}

#[test]
fn un_connettore_vuole_la_grammatica_intera_o_e_un_tracciato() {
    let cases = common::connector_cases();
    for case in cases["geom"].as_array().unwrap() {
        let geom = case["text"].as_str().unwrap();
        let source = doc(&format!(
            r#"<path fub:shape="connector" fub:geom="{}" d="M0 0 L10 10"/>"#,
            attribute(geom)
        ));
        let scene = load(&source);
        let item = at(&scene, &[0]).unwrap();
        if case["read"].is_null() {
            assert_eq!(item.role, Role::Path, "{geom:?}");
            assert_eq!(item.connector, None, "{geom:?}");
        } else {
            assert_eq!(item.role, Role::Connector, "{geom:?}");
            let facts = item.connector.as_ref().unwrap();
            assert_eq!(
                common::as_floats(serde_json::to_value(&facts.geom).unwrap()),
                common::as_floats(case["read"].clone()),
                "{geom:?}"
            );
            assert_eq!((&facts.from, &facts.to), (&None, &None));
        }
    }
}

#[test]
fn un_connettore_senza_la_forma_o_con_un_altra_e_un_tracciato() {
    let source = doc(concat!(
        r#"<path fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>"#,
        r#"<path fub:shape="Connector" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>"#,
        r#"<path fub:shape="connector" d="M0 0 L10 10"/>"#,
        r#"<path fub:shape="arrow" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>"#,
        r#"<path fub:shape="connector" fub:geom="straight 0 0 10 10" d="M0 0 L10 10"/>"#,
    ));
    let scene = load(&source);
    for index in 0..4 {
        assert_eq!(role(&scene, &[index]), Some(Role::Path), "{index}");
        assert_eq!(at(&scene, &[index]).unwrap().connector, None);
    }
    assert_eq!(role(&scene, &[4]), Some(Role::Connector));
}

#[test]
fn i_capi_fuori_grammatica_restano_liberi() {
    let cases = common::connector_cases();
    for case in cases["end"].as_array().unwrap() {
        let end = case["text"].as_str().unwrap();
        let source = doc(&format!(
            r#"<path fub:shape="connector" fub:geom="straight 0 0 10 10" fub:from="{}" fub:to="r2 left" d="M0 0 L10 10"/>"#,
            attribute(end)
        ));
        let scene = load(&source);
        let item = at(&scene, &[0]).unwrap();
        // Il connettore resta un connettore, e l'altro capo si legge.
        assert_eq!(item.role, Role::Connector, "{end:?}");
        let facts = item.connector.as_ref().unwrap();
        assert_eq!(
            serde_json::to_value(&facts.from).unwrap(),
            case["read"],
            "{end:?}"
        );
        assert_eq!(
            serde_json::to_value(&facts.to).unwrap(),
            serde_json::json!({ "id": "r2", "anchor": "left" })
        );
    }
}

#[test]
fn l_etichetta_fuori_grammatica_non_si_usa() {
    let cases = common::connector_cases();
    for case in cases["along"].as_array().unwrap() {
        let along = case["text"].as_str().unwrap();
        let source = doc(&format!(
            r#"<text fub:along="{}" x="5" y="5"><tspan x="5" dy="0">Sì</tspan></text>"#,
            attribute(along)
        ));
        let scene = load(&source);
        let item = at(&scene, &[0]).unwrap();
        assert_eq!(item.role, Role::Text, "{along:?}");
        assert_eq!(
            common::as_floats(serde_json::to_value(&item.along).unwrap()),
            common::as_floats(case["read"].clone()),
            "{along:?}"
        );
    }
    // Un testo su tracciato può essere l'etichetta di un connettore.
    let source = doc(concat!(
        r##"<defs id="d"><path id="r1" d="M0 0 L50 0"/></defs>"##,
        r##"<text fub:along="c1 0.5 4"><textPath href="#r1">Su</textPath></text>"##,
    ));
    let scene = load(&source);
    let along = at(&scene, &[1]).unwrap().along.as_ref().unwrap();
    assert_eq!((along.id.as_str(), along.t, along.offset), ("c1", 0.5, 4.0));
}

#[test]
fn il_connettore_conta_fra_le_forme_e_ha_il_riquadro_di_d() {
    let source = doc(concat!(
        r##"<rect id="a" x="0" y="0" width="10" height="10" fill="#cccccc"/>"##,
        r##"<path id="c" fub:shape="connector" fub:geom="elbow 10 5 60 5 60 90 100 90" fub:from="a right" d="M10 5 L60 5 L60 90 L100 90" fill="none" stroke="#000000" stroke-width="2"/>"##,
        r#"<path id="p" fub:shape="connector" fub:geom="straight 0 0" d="M0 0 L5 5"/>"#,
    ));
    let scene = load(&source);
    assert_eq!(scene.summary.counts.shapes, 3);
    assert_eq!(role(&scene, &[1]), Some(Role::Connector));
    assert_eq!(role(&scene, &[2]), Some(Role::Path));
    // Il riquadro si misura da `d`: da 0,0 al capo a 100,90.
    let bbox = scene.summary.bbox.expect("il riquadro del disegno");
    assert_eq!(
        (bbox.x, bbox.y, bbox.width, bbox.height),
        (0.0, 0.0, 100.0, 90.0)
    );
}
