//! Lo spessore variabile (formato della scena, §6), coi casi scritti a mano
//! che valgono anche per la superficie: `apps/client/src/__fixtures__/scene-width/`.

mod common;

use fub_scene::varwidth::{read_var_width, MAX_POINTS, MIN_POINTS};

#[test]
fn la_geometria_dei_casi() {
    let cases = common::width_cases();
    let read = cases["read"].as_array().unwrap();
    assert!(read.len() >= 40);
    for case in read {
        let geom = case["geom"].as_str().unwrap();
        assert_eq!(
            common::as_floats(serde_json::to_value(read_var_width(geom)).unwrap()),
            common::as_floats(case["varwidth"].clone()),
            "{geom:?}"
        );
    }
}

#[test]
fn i_profili_dei_vettori_si_leggono() {
    let cases = common::width_cases();
    for case in cases["profiles"].as_array().unwrap() {
        let points: Vec<String> = case["profile"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let p = p.as_array().unwrap();
                format!("{} {} {}", p[0], p[1], p[2])
            })
            .collect();
        let geom = format!("round round {} M0 0 L100 0", points.join(" "));
        let read = read_var_width(&geom).unwrap_or_else(|| panic!("{geom:?}"));
        assert_eq!(read.profile.len(), points.len(), "{geom:?}");
    }
}

#[test]
fn il_profilo_ha_da_due_a_mille_punti() {
    let profile = |count: usize| {
        let inner: String = (1..count - 1)
            .map(|k| format!(" {} 1 1", k as f64 / (count - 1) as f64))
            .collect();
        read_var_width(&format!("round round 0 1 1{inner} 1 1 1 M0 0 L10 0"))
    };
    assert_eq!(profile(MIN_POINTS).unwrap().profile.len(), MIN_POINTS);
    assert_eq!(profile(MAX_POINTS).unwrap().profile.len(), MAX_POINTS);
    assert!(profile(MAX_POINTS + 1).is_none());
}
