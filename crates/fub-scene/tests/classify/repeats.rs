//! Le ripetizioni: un gruppo `fub:repeat` le cui copie sono `use` verso un
//! originale fratello, e i casi che restano estranei.

use super::*;

/// Un originale `id` per le ripetizioni, con gli attributi `attrs` in più.
fn original(id: &str, attrs: &str) -> String {
    format!(r##"<rect id="{id}" width="10" height="10" fill="#000000"{attrs}/>"##)
}

#[test]
fn a_repeat_is_a_group_with_fub_repeat_and_its_copies_are_uses_toward_a_sibling_original() {
    let scene = load(&doc(&format!(
        r##"<g fub:repeat="radial 4 50 50"><use href="#o1" transform="rotate(270 50 50)"/>{}<use id="c1" xlink:href="#o1" transform="rotate(90 50 50)"><title>Copia</title></use></g>"##,
        original("o1", "")
    )));
    assert_eq!(role(&scene, &[0]), Some(Role::Group));
    assert_eq!(
        at(&scene, &[0]).unwrap().repeat,
        Some(Repeat::Radial {
            count: 4,
            center: [50.0, 50.0]
        })
    );
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Copy));
    assert_eq!(role(&scene, &[0, 1]), Some(Role::Rect));
    assert_eq!(role(&scene, &[0, 2]), Some(Role::Copy));
    assert_eq!(at(&scene, &[0, 0]).unwrap().original.as_deref(), Some("o1"));
    assert_eq!(at(&scene, &[0, 2]).unwrap().original.as_deref(), Some("o1"));
    assert_eq!(at(&scene, &[0, 1]).unwrap().original, None);
    // Un'istanza di un simbolo può essere l'originale.
    let instance = load(&doc(&format!(
        r##"<defs>{}</defs><g fub:repeat="grid 2 1 20 0"><use id="o1" href="#s1"/><use href="#o1" transform="translate(20 0)"/></g>"##,
        symbol("s1", RECT, "")
    )));
    assert_eq!(role(&instance, &[1, 0]), Some(Role::Instance));
    assert_eq!(role(&instance, &[1, 1]), Some(Role::Copy));
    assert_eq!(
        at(&instance, &[1]).unwrap().repeat,
        Some(Repeat::Grid {
            columns: 2,
            rows: 1,
            step: [20.0, 0.0]
        })
    );
}

#[test]
fn a_copy_has_only_id_transform_and_one_href_and_only_titles_and_descriptions() {
    let copy = |used: &str| {
        role(
            &load(&doc(&format!(
                r#"<g fub:repeat="mirror 20 0 20 10">{}{used}</g>"#,
                original("o1", "")
            ))),
            &[0, 1],
        )
    };
    for used in [
        r##"<use href="#o1"/>"##,
        r##"<use xlink:href="#o1"/>"##,
        r##"<use id="c1" href="#o1" transform="matrix(-1 0 0 1 40 0)"/>"##,
        "<use href=\"#o1\" fub:nota=\"x\">\n  <desc>Riflessa</desc>\n</use>",
    ] {
        assert_eq!(copy(used), Some(Role::Copy), "{used}");
    }
    let rect_inside = format!(r##"<use href="#o1">{}</use>"##, original("r2", ""));
    for used in [
        "<use/>",
        r##"<use href="#o1" opacity="0.5"/>"##,
        r##"<use href="#o1" display="none"/>"##,
        r##"<use href="#o1" fill="#ff0000"/>"##,
        r##"<use href="#o1" style="opacity: 0.5"/>"##,
        r##"<use href="#o1" x="10"/>"##,
        r##"<use href="#o1" xlink:href="#o1"/>"##,
        r##"<use href="#o1" transform="scale(2"/>"##,
        r##"<use href="#o9"/>"##,
        r#"<use href="o1"/>"#,
        rect_inside.as_str(),
    ] {
        assert_eq!(copy(used), None, "{used}");
    }
}

#[test]
fn without_a_valid_repeat_or_toward_a_non_sibling_original_a_use_stays_foreign() {
    let roles = |body: &str, path: &[usize]| role(&load(&doc(body)), path);
    let o1 = original("o1", "");
    let copy = r##"<use href="#o1" transform="translate(20 0)"/>"##;
    assert_eq!(roles(&format!("<g>{o1}{copy}</g>"), &[0, 1]), None);
    assert_eq!(
        roles(
            &format!(r#"<g fub:repeat="radial 1 0 0">{o1}{copy}</g>"#),
            &[0, 1]
        ),
        None
    );
    assert_eq!(
        at(
            &load(&doc(&format!(r#"<g fub:repeat="radial 1 0 0">{o1}</g>"#))),
            &[0]
        )
        .unwrap()
        .repeat,
        None
    );
    let layer = format!(r#"<g fub:layer="Sfondo" fub:repeat="grid 2 1 20 0">{o1}{copy}</g>"#);
    assert_eq!(roles(&layer, &[0]), Some(Role::Layer));
    assert_eq!(roles(&layer, &[0, 1]), None);
    assert_eq!(
        roles(
            &format!(r#"<a href="nota.md" fub:repeat="grid 2 1 20 0">{o1}{copy}</a>"#),
            &[0, 1]
        ),
        None
    );
    // Un cugino non è un originale, né una copia, un titolo o un estraneo.
    for (body, path) in [
        (
            format!(r#"<g fub:repeat="grid 2 1 20 0"><g>{o1}</g>{copy}</g>"#),
            [0, 1],
        ),
        (
            format!(r#"{o1}<g fub:repeat="grid 2 1 20 0">{copy}</g>"#),
            [1, 0],
        ),
        (
            format!(
                r##"<g fub:repeat="grid 3 1 20 0">{o1}<use id="c1" href="#o1"/><use href="#c1"/></g>"##
            ),
            [0, 2],
        ),
        (
            format!(r#"<g fub:repeat="grid 2 1 20 0"><title id="o1">Fila</title>{copy}</g>"#),
            [0, 1],
        ),
        (
            format!(r#"<g fub:repeat="grid 2 1 20 0"><switch id="o1"/>{copy}</g>"#),
            [0, 1],
        ),
        (
            r##"<g fub:repeat="grid 2 1 20 0"><use id="o1" href="#o1"/></g>"##.to_owned(),
            [0, 0],
        ),
    ] {
        assert_eq!(roles(&body, &path), None, "{body}");
    }
    // Dentro un originale, una ripetizione ha i suoi originali e non vede
    // quelli di fuori.
    let nested = load(&doc(&format!(
        r##"<g fub:repeat="radial 2 0 0"><g id="o1"><g fub:repeat="grid 2 1 10 0">{}<use href="#o2" transform="translate(10 0)"/><use href="#o1"/></g></g><use href="#o1" transform="rotate(180)"/></g>"##,
        original("o2", "")
    )));
    assert_eq!(role(&nested, &[0, 0, 0, 1]), Some(Role::Copy));
    assert_eq!(role(&nested, &[0, 0, 0, 2]), None);
    assert_eq!(role(&nested, &[0, 1]), Some(Role::Copy));
}

#[test]
fn a_copy_is_not_counted_and_the_box_of_the_drawing_takes_in_the_copies() {
    let o1 = original("o1", "");
    let scene = load(&doc(&format!(
        r##"<g fub:repeat="grid 3 1 20 0">{o1}<use href="#o1" transform="translate(20 0)"/><use href="#o1" transform="translate(40 0)"/></g>"##
    )));
    let b = scene.summary.bbox.unwrap();
    assert_eq!([b.x, b.y, b.width, b.height], [0.0, 0.0, 50.0, 10.0]);
    assert_eq!(scene.summary.counts.shapes, 1);
    // Le copie stanno nelle coordinate del gruppo.
    assert_eq!(
        bbox(&format!(
            r##"<g transform="translate(100 0)" fub:repeat="mirror 20 0 20 10">{o1}<use href="#o1" transform="matrix(-1 0 0 1 40 0)"/></g>"##
        )),
        Some([100.0, 0.0, 40.0, 10.0])
    );
    assert_eq!(
        bbox(&format!(
            r##"<g transform="rotate(90)" fub:repeat="grid 2 1 20 0">{o1}<use href="#o1" transform="translate(20 0)"/></g>"##
        )),
        Some([-10.0, 0.0, 10.0, 30.0])
    );
    // L'originale si sposta e le copie lo seguono; un originale nascosto
    // nasconde le copie.
    assert_eq!(
        bbox(&format!(
            r##"<g fub:repeat="grid 2 1 20 0">{}<use href="#o1" transform="translate(20 0)"/></g>"##,
            original("o1", r#" x="5" transform="translate(0 5)""#)
        )),
        Some([5.0, 5.0, 30.0, 10.0])
    );
    assert_eq!(
        bbox(&format!(
            r##"<g fub:repeat="grid 2 1 20 0">{}<use href="#o1" transform="translate(20 0)"/></g>"##,
            original("o1", r#" display="none""#)
        )),
        None
    );
    // Un'istanza come originale, e una ripetizione dentro un simbolo.
    assert_eq!(
        bbox(&format!(
            r##"<defs>{}</defs><g fub:repeat="grid 2 1 20 0"><use id="o1" href="#s1" transform="translate(0 30)"/><use href="#o1" transform="translate(20 0)"/></g>"##,
            symbol("s1", RECT, "")
        )),
        Some([0.0, 30.0, 30.0, 10.0])
    );
    assert_eq!(
        bbox(&format!(
            r##"<defs>{}</defs><use href="#s1" transform="translate(50 0)"/>"##,
            symbol(
                "s1",
                &format!(
                    r##"<g fub:repeat="grid 1 2 0 20">{o1}<use href="#o1" transform="translate(0 20)"/></g>"##
                ),
                ""
            )
        )),
        Some([50.0, 0.0, 10.0, 30.0])
    );
    // Una ripetizione dentro un originale: le copie di fuori portano anche
    // quelle di dentro.
    assert_eq!(
        bbox(&format!(
            r##"<g fub:repeat="grid 1 2 0 50"><g id="o1"><g fub:repeat="grid 2 1 20 0">{}<use href="#o2" transform="translate(20 0)"/></g></g><use href="#o1" transform="translate(0 50)"/></g>"##,
            original("o2", "")
        )),
        Some([0.0, 0.0, 30.0, 60.0])
    );
}

#[test]
fn over_a_copy_the_backdrop_is_unknown_as_over_an_instance() {
    let codes =
        |body: &str| -> Vec<Code> { findings(&load(&doc(body))).iter().map(|d| d.code).collect() };
    let white = |x: u32, y: u32| {
        format!(
            r##"<text x="{x}" y="{y}" font-size="16" fill="#ffffff"><tspan x="{x}" dy="0">Luce</tspan></text>"##
        )
    };
    let row = r##"<g fub:repeat="grid 2 1 100 0"><rect id="o1" width="40" height="40" fill="#0072b2"/><use href="#o1" transform="translate(100 0)"/></g>"##;
    assert_eq!(codes(&format!("{row}{}", white(110, 20))), []);
    assert_eq!(codes(&format!("{row}{}", white(60, 20))), [Code::S009]);
}
