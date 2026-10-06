//! Poligoni regolari e stelle (formato della scena, §6), coi casi scritti a
//! mano che valgono anche per la superficie:
//! `apps/client/src/__fixtures__/scene-shapes/`.

mod common;

use fub_scene::parametric::{read_polygonal, PolygonalShape, MAX_COUNT, MIN_COUNT};

#[test]
fn la_geometria_dei_casi() {
    let cases = common::shape_cases();
    let read = cases["read"].as_array().unwrap();
    assert!(read.len() >= 20);
    for case in read {
        let shape = case["shape"].as_str().unwrap();
        let geom = case["geom"].as_str().unwrap();
        let actual = read_polygonal(PolygonalShape::parse(shape).unwrap(), geom);
        let mut expected = case["polygonal"].clone();
        if !expected.is_null() {
            expected["shape"] = shape.into();
        }
        assert_eq!(
            common::as_floats(serde_json::to_value(actual).unwrap()),
            common::as_floats(expected),
            "{shape} {geom:?}"
        );
    }
}

#[test]
fn la_geometria_scritta_dalla_superficie_si_rilegge() {
    let cases = common::shape_cases();
    for case in cases["write"]
        .as_array()
        .unwrap()
        .iter()
        .chain(cases["path"].as_array().unwrap())
    {
        let geom = case["geom"].as_str().unwrap();
        let shape = case["shape"]
            .as_str()
            .or_else(|| case["polygonal"]["shape"].as_str())
            .unwrap();
        assert!(
            read_polygonal(PolygonalShape::parse(shape).unwrap(), geom).is_some(),
            "{shape} {geom:?}"
        );
    }
}

#[test]
fn i_lati_sono_interi_da_tre_a_mille() {
    let polygon = |n: String| read_polygonal(PolygonalShape::Polygon, &format!("0 0 10 {n} 0 0"));
    assert_eq!(polygon(MIN_COUNT.to_string()).unwrap().count, MIN_COUNT);
    assert_eq!(polygon(MAX_COUNT.to_string()).unwrap().count, MAX_COUNT);
    assert!(polygon((MIN_COUNT - 1).to_string()).is_none());
    assert!(polygon((MAX_COUNT + 1).to_string()).is_none());
    assert_eq!(polygon("5e0".into()).unwrap().count, 5);
    assert!(polygon("5.000001".into()).is_none());
    assert_eq!(PolygonalShape::parse("arrow"), None);
}
