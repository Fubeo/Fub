//! Le risorse del disegno nella radice `defs`: gradienti, filtri, riferimenti
//! e ciclo di vita.

use super::*;

// Le risorse del disegno (formato della scena, risorse).

/// Il ruolo del primo figlio della radice, dopo una `defs` con `defs`.
fn user(defs: &str, body: &str) -> Option<Role> {
    role(&load(&doc(&format!("<defs>{defs}</defs>{body}"))), &[1])
}

const GRADIENT: &str = r##"<linearGradient id="r1"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>"##;

#[test]
fn a_root_defs_is_a_container_that_judges_each_child_on_its_own() {
    let scene = load(&doc(&format!(
        r#"<defs id="fub-defs">{GRADIENT}<symbol id="s"/><title>Risorse</title></defs>"#
    )));
    assert_eq!(role(&scene, &[0]), Some(Role::Defs));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Resource));
    assert_eq!(role(&scene, &[0, 1]), None);
    assert_eq!(role(&scene, &[0, 2]), Some(Role::Title));
    assert_eq!(first("<defs/>"), Some(Role::Defs));
    // Un attributo SVG che non è l'id, o una defs fuori dalla radice, la
    // rendono estranea.
    assert_eq!(first(r##"<defs fill="#000000"></defs>"##), None);
    assert_eq!(first(r#"<defs id=""></defs>"#), None);
    let scene = load(&doc(&format!("<g><defs>{GRADIENT}</defs></g>")));
    assert_eq!(role(&scene, &[0, 0]), None);
    // Gli attributi di altri namespace restano.
    assert_eq!(first(r#"<defs fub:nota="x"></defs>"#), Some(Role::Defs));
}

#[test]
fn every_kind_of_resource_is_editable_in_a_root_defs_with_its_id() {
    for body in [
        GRADIENT,
        r#"<radialGradient id="r1" cx="0.5" cy="50%" r="0.5" fx="0.4" fy="0.4" spreadMethod="reflect"><stop offset="0.5" stop-color="red" stop-opacity="0.5"/></radialGradient>"#,
        r##"<pattern id="r1" x="0" y="0" width="0.1" height="0.1" patternContentUnits="objectBoundingBox" viewBox="0 0 10 10"><rect width="5" height="5" fill="#000000"/></pattern>"##,
        r#"<marker id="r1" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="strokeWidth" orient="auto-start-reverse" viewBox="0 0 10 10"><path d="M0 0 L10 5 L0 10 z"/></marker>"#,
        r#"<marker id="r1" orient="90deg"/>"#,
        r#"<clipPath id="r1" clipPathUnits="objectBoundingBox" transform="scale(2)"><circle cx="0.5" cy="0.5" r="0.5" clip-rule="evenodd"/><text x="0" y="1"><tspan x="0" dy="0">Ritaglio</tspan></text></clipPath>"#,
        r##"<mask id="r1" x="-10%" y="-10%" width="120%" height="120%" maskContentUnits="userSpaceOnUse"><rect width="100" height="100" fill="#ffffff"/></mask>"##,
        r#"<filter id="r1" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2 3"/></filter>"#,
    ] {
        assert_eq!(resource(body), Some(Role::Resource), "{body}");
    }
    assert_eq!(resource("<linearGradient/>"), None);
    assert_eq!(resource(r#"<linearGradient id=""/>"#), None);
}

#[test]
fn a_resource_that_points_at_another_or_has_a_style_is_foreign() {
    for body in [
        r##"<linearGradient id="r1" href="#r2"/>"##,
        r##"<linearGradient id="r1" xlink:href="#r2"/>"##,
        r##"<pattern id="r1" href="#r2"/>"##,
        r#"<linearGradient id="r1" style="color:red"/>"#,
        r#"<radialGradient id="r1" fr="0.1"/>"#,
        r#"<mask id="r1" mask-type="alpha"/>"#,
        r#"<filter id="r1" primitiveUnits="objectBoundingBox"/>"#,
        r##"<linearGradient id="r1" fill="#000000"/>"##,
        r##"<clipPath id="r1" fill="#000000"/>"##,
    ] {
        assert_eq!(resource(body), None, "{body}");
    }
}

#[test]
fn coordinates_follow_their_units() {
    // Numeri e percentuali nel riquadro, lunghezze nello spazio d'uso.
    let editable = [
        r#"<linearGradient id="r1" x1="10%" x2="1"/>"#,
        r#"<linearGradient id="r1" gradientUnits="userSpaceOnUse" x1="0" x2="10mm"/>"#,
        r#"<radialGradient id="r1" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="5"/>"#,
        r#"<filter id="r1" filterUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"/>"#,
        // Con uno `stop` o nessuno la sfumatura è un colore pieno, o niente:
        // le coordinate non contano.
        r##"<linearGradient id="r1" gradientUnits="userSpaceOnUse"><stop stop-color="#000"/></linearGradient>"##,
        r#"<linearGradient id="r1" gradientUnits="userSpaceOnUse"/>"#,
        r#"<radialGradient id="r1" gradientUnits="userSpaceOnUse"><stop/></radialGradient>"#,
    ];
    let foreign = [
        r#"<linearGradient id="r1" x1="10px"/>"#,
        r#"<linearGradient id="r1" gradientUnits="userSpaceOnUse" x1="0" x2="10%"/>"#,
        // Nello spazio d'uso, ciò che mancando sarebbe in percentuale del
        // viewport va scritto, se c'è una sfumatura.
        r#"<linearGradient id="r1" gradientUnits="userSpaceOnUse"><stop offset="0"/><stop offset="1"/></linearGradient>"#,
        r#"<radialGradient id="r1" gradientUnits="userSpaceOnUse" cx="0" cy="0"><stop/><stop/></radialGradient>"#,
        r#"<filter id="r1" filterUnits="userSpaceOnUse" x="0" y="0" width="10"/>"#,
        // Raggi e dimensioni non negativi.
        r#"<radialGradient id="r1" r="-0.5"/>"#,
        r#"<pattern id="r1" width="-1"/>"#,
        r#"<marker id="r1" markerWidth="-1"/>"#,
        // Le scatole e le parole chiave.
        r#"<marker id="r1" viewBox="0,0,10,-1"/>"#,
        r#"<linearGradient id="r1" spreadMethod="mirror"/>"#,
        r#"<marker id="r1" markerUnits="objectBoundingBox"/>"#,
    ];
    for body in editable {
        assert_eq!(resource(body), Some(Role::Resource), "{body}");
    }
    for body in foreign {
        assert_eq!(resource(body), None, "{body}");
    }
    // Gli angoli.
    for orient in ["auto", "45", "-1.5e1deg", "100grad", "3.14rad"] {
        let body = format!(r#"<marker id="r1" orient="{orient}"/>"#);
        assert_eq!(resource(&body), Some(Role::Resource), "{orient}");
    }
    for orient in ["", "45turn", "auto auto", "1 deg"] {
        let body = format!(r#"<marker id="r1" orient="{orient}"/>"#);
        assert_eq!(resource(&body), None, "{orient}");
    }
}

#[test]
fn gradients_hold_only_stops_with_their_attributes_up_to_256() {
    let gradient = |stops: &str| format!(r#"<linearGradient id="r1">{stops}</linearGradient>"#);
    let body =
        gradient("\n  <title>Cielo</title>\n  <stop offset=\"50%\" stop-color=\"#ff0000\"/>\n");
    assert_eq!(resource(&body), Some(Role::Resource));
    for stop in [
        r#"<stop offset="0" stop-color="none"/>"#,
        r#"<stop offset="0" style="stop-color:red"/>"#,
        r#"<stop offset="0" stop-opacity="2"/>"#,
        r#"<stop offset="1px"/>"#,
        r##"<stop offset="0" fill="#000000"/>"##,
        r#"<stop offset="0"><title>x</title></stop>"#,
        r#"<rect width="1" height="1"/>"#,
        "testo",
    ] {
        assert_eq!(resource(&gradient(stop)), None, "{stop}");
    }
    let stop = r#"<stop offset="0"/>"#;
    assert_eq!(resource(&gradient(&stop.repeat(256))), Some(Role::Resource));
    assert_eq!(resource(&gradient(&stop.repeat(257))), None);
}

#[test]
fn contents_are_shapes_texts_and_groups_without_groups_in_clips() {
    let body =
        r##"<pattern id="r1"><g fill="#ff0000"><g><rect width="1" height="1"/></g></g></pattern>"##;
    assert_eq!(resource(body), Some(Role::Resource));
    let body = r#"<clipPath id="r1"><g><rect width="1" height="1"/></g></clipPath>"#;
    assert_eq!(resource(body), None);
    for content in [
        r#"<image href="a.png"/>"#,
        r#"<a href="n.md"></a>"#,
        r##"<use href="#x"/>"##,
        r#"<g fub:layer="Uno"><rect/></g>"#,
        r#"<rect width="1" class="x"/>"#,
    ] {
        let body = format!(r#"<mask id="r1">{content}</mask>"#);
        let expected = content.starts_with("<g").then_some(Role::Resource);
        assert_eq!(resource(&body), expected, "{body}");
    }
    // Trentadue gruppi annidati sì, trentatré no.
    let nest = |depth: usize| {
        format!(
            r#"<marker id="r1">{}<rect/>{}</marker>"#,
            "<g>".repeat(depth),
            "</g>".repeat(depth)
        )
    };
    assert_eq!(resource(&nest(32)), Some(Role::Resource));
    assert_eq!(resource(&nest(33)), None);
}

#[test]
fn contents_refer_only_to_gradients() {
    let defs = format!(r#"{GRADIENT}<pattern id="r2" width="1" height="1"/><filter id="r3"/>"#);
    let scene = |inner: &str| {
        let source = doc(&format!(
            r#"<defs>{defs}<pattern id="r4">{inner}</pattern></defs>"#
        ));
        role(&load(&source), &[0, 3])
    };
    assert_eq!(scene(r##"<rect fill="url(#r1)"/>"##), Some(Role::Resource));
    assert_eq!(scene(r##"<rect fill="url(#r2)"/>"##), None);
    assert_eq!(scene(r##"<rect filter="url(#r3)"/>"##), None);
    assert_eq!(
        scene(r#"<rect filter="none" clip-path="none"/>"#),
        Some(Role::Resource)
    );
}

#[test]
fn filter_primitives_are_a_closed_list() {
    let filter = |body: &str| resource(&format!(r#"<filter id="r1">{body}</filter>"#));
    for body in [
        r#"<feOffset dx="2" dy="-2"/>"#,
        r##"<feFlood flood-color="#000000" flood-opacity="0.5"/>"##,
        r#"<feDropShadow dx="2" dy="2" stdDeviation="1" flood-color="black" flood-opacity="0.3"/>"#,
        r#"<feColorMatrix type="saturate" values="0.5"/>"#,
        r#"<feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>"#,
        r#"<feColorMatrix type="luminanceToAlpha"/>"#,
        r#"<feComposite in="SourceGraphic" in2="SourceAlpha" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>"#,
        r#"<feBlend in2="SourceGraphic" mode="multiply"/>"#,
        r#"<feMorphology operator="dilate" radius="1 2"/>"#,
        r#"<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge>"#,
        r#"<feGaussianBlur id="p1" x="0" y="0" width="10" height="10" color-interpolation-filters="linearRGB" stdDeviation="1"/>"#,
    ] {
        assert_eq!(filter(body), Some(Role::Resource), "{body}");
    }
    for body in [
        r#"<feTurbulence baseFrequency="0.1"/>"#,
        r#"<feImage href="a.png"/>"#,
        r#"<feGaussianBlur stdDeviation="-1"/>"#,
        r#"<feGaussianBlur stdDeviation="1 2 3"/>"#,
        r#"<feGaussianBlur in="BackgroundImage"/>"#,
        r#"<feComposite operator="in"/>"#,
        r#"<feBlend in2="SourceGraphic" mode="overlay"/>"#,
        r#"<feColorMatrix type="saturate" values="-1"/>"#,
        r#"<feColorMatrix values="1 0 0"/>"#,
        r#"<feOffset dx="1px"/>"#,
        r#"<feFlood flood-color="none"/>"#,
        r#"<feFlood in="SourceGraphic"/>"#,
        r#"<feOffset stdDeviation="1"/>"#,
        r#"<feOffset x="1%"/>"#,
        r#"<feOffset result="a b"/>"#,
        "<feMerge><feOffset/></feMerge>",
        "<feMergeNode/>",
        "<feOffset><title>x</title></feOffset>",
        "<g/>",
    ] {
        assert_eq!(filter(body), None, "{body}");
    }
}

#[test]
fn inputs_point_at_earlier_results() {
    let filter = |body: &str| resource(&format!(r#"<filter id="r1">{body}</filter>"#));
    let body = concat!(
        r#"<feGaussianBlur in="SourceAlpha" result="ombra"/><feOffset in="ombra" result="spostata"/>"#,
        r#"<feMerge><feMergeNode in="spostata"/><feMergeNode in="SourceGraphic"/></feMerge>"#
    );
    assert_eq!(filter(body), Some(Role::Resource));
    let body = r#"<feOffset in="ombra"/><feGaussianBlur result="ombra"/>"#;
    assert_eq!(filter(body), None);
    // Gli ingressi si leggono come sono scritti.
    let body = r#"<feGaussianBlur result="ombra"/><feOffset in=" ombra"/>"#;
    assert_eq!(filter(body), None);
    assert_eq!(filter(r#"<feOffset in="sourcegraphic"/>"#), None);
    assert_eq!(filter(&"<feOffset/>".repeat(64)), Some(Role::Resource));
    let body = "<feOffset/>".repeat(63) + "<feMerge><feMergeNode/></feMerge>";
    assert_eq!(filter(&body), None);
}

#[test]
fn fill_and_stroke_point_at_gradients_and_patterns_with_an_optional_fallback() {
    let defs = format!(r#"{GRADIENT}<pattern id="r2" width="1" height="1"/><filter id="r3"/>"#);
    for value in [
        "url(#r1)",
        "url(#r2)",
        "url(#r1) #ff0000",
        "url(#r1) none",
        "url(\"#r1\")",
        "url( '#r1' )",
        "URL(#r1)",
        " url(#r1) red ",
    ] {
        let quoted = value.replace('"', "&quot;");
        let body = format!(r#"<rect fill="{quoted}"/>"#);
        assert_eq!(user(&defs, &body), Some(Role::Rect), "{value}");
        let body = format!(r#"<g stroke="{quoted}"></g>"#);
        assert_eq!(user(&defs, &body), Some(Role::Group), "{value}");
    }
    // Non sulle righe e sui pezzi di un testo.
    let body = r##"<text x="0" y="0" fill="url(#r1)"><tspan x="0" dy="0">a</tspan></text>"##;
    assert_eq!(user(&defs, body), Some(Role::Text));
    let body = r##"<text x="0" y="0"><tspan x="0" dy="0" fill="url(#r1)">a</tspan></text>"##;
    assert_eq!(user(&defs, body), None);
    let body = r##"<text x="0" y="0"><tspan x="0" dy="0">a<tspan stroke="url(#r1)">b</tspan></tspan></text>"##;
    assert_eq!(user(&defs, body), None);
    for value in [
        "url(#r3)",
        "url(#r4)",
        "url(#r1)#ff0000",
        "url(#r1) url(#r2)",
        "url(r1)",
        "url(#r\\31)",
        "url(#r1) currentColor",
        "url(#r1",
        "url(a.svg#r1)",
    ] {
        let body = format!(r#"<rect fill="{value}"/>"#);
        assert_eq!(user(&defs, &body), None, "{value}");
    }
}

#[test]
fn markers_go_on_paths_and_clips_masks_and_filters_on_what_is_drawn() {
    let defs = format!(
        r#"{GRADIENT}<marker id="r2"/><clipPath id="r3"/><mask id="r4"/><filter id="r5"/>"#
    );
    for tag in ["path", "line", "polyline", "polygon"] {
        let body = format!(
            r##"<{tag} marker-start="url(#r2)" marker-mid="none" marker-end="url(#r2)"/>"##
        );
        assert!(user(&defs, &body).is_some(), "{tag}");
    }
    assert_eq!(user(&defs, r##"<rect marker-end="url(#r2)"/>"##), None);
    assert_eq!(user(&defs, r#"<g marker-end="none"></g>"#), None);
    assert_eq!(user(&defs, r##"<path marker-end="url(#r1)"/>"##), None);
    for body in [
        r##"<rect clip-path="url(#r3)" mask="url(#r4)" filter="url(#r5)"/>"##,
        r##"<text x="0" y="0" filter="url(#r5)"><tspan x="0" dy="0">a</tspan></text>"##,
        r##"<image href="a.png" clip-path="url(#r3)"/>"##,
        r##"<g mask="url(#r4)"></g>"##,
        r##"<a href="n.md" filter="url(#r5)"></a>"##,
        r##"<g fub:layer="Uno" filter="url(#r5)"></g>"##,
    ] {
        assert!(user(&defs, body).is_some(), "{body}");
    }
    assert_eq!(user(&defs, r##"<rect clip-path="url(#r4)"/>"##), None);
    assert_eq!(user(&defs, r##"<rect filter="url(#r3)"/>"##), None);
    assert_eq!(user(&defs, r#"<rect clip-path="inset(10%)"/>"#), None);
    assert_eq!(
        user(&defs, r##"<rect filter="url(#r5) blur(1px)"/>"##),
        None
    );
    // `clip-rule` vale soltanto dentro un ritaglio.
    assert_eq!(user(&defs, r#"<rect clip-rule="evenodd"/>"#), None);
}

#[test]
fn a_reference_holds_toward_an_editable_resource_in_a_root_defs_wherever_it_is() {
    // La defs può venire dopo chi la usa.
    let scene = load(&doc(&format!(
        r##"<rect fill="url(#r1)"/><defs>{GRADIENT}</defs>"##
    )));
    assert_eq!(role(&scene, &[0]), Some(Role::Rect));
    // Una risorsa estranea, o in una defs estranea, non vale.
    let scene = load(&doc(
        r##"<defs><linearGradient id="r1" href="#x"/></defs><rect fill="url(#r1)"/>"##,
    ));
    assert_eq!(role(&scene, &[1]), None);
    let scene = load(&doc(&format!(
        r##"<defs class="x">{GRADIENT}</defs><rect fill="url(#r1)"/>"##
    )));
    assert_eq!(role(&scene, &[1]), None);
    let scene = load(&doc(&format!(
        r##"<g><defs>{GRADIENT}</defs></g><rect fill="url(#r1)"/>"##
    )));
    assert_eq!(role(&scene, &[1]), None);
    // Due risorse con lo stesso id: vale la prima.
    let scene = load(&doc(&format!(
        r##"<defs>{GRADIENT}<filter id="r1"/></defs><rect fill="url(#r1)"/><rect filter="url(#r1)"/>"##
    )));
    assert_eq!(role(&scene, &[1]), Some(Role::Rect));
    assert_eq!(role(&scene, &[2]), None);
    // Un motivo che usa una sfumatura scritta dopo di lui.
    let scene = load(&doc(&format!(
        r##"<defs><pattern id="r2"><rect fill="url(#r1)"/></pattern>{GRADIENT}</defs><rect fill="url(#r2)"/>"##
    )));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Resource));
    assert_eq!(role(&scene, &[1]), Some(Role::Rect));
}

#[test]
fn a_resource_tells_its_lifecycle_and_its_name() {
    let scene = load(&doc(concat!(
        r#"<defs><linearGradient id="r1" fub:role="private"><title>Tramonto</title></linearGradient>"#,
        r#"<filter id="r2" fub:role="shared"/><mask id="r3" fub:role="paper"/></defs>"#
    )));
    let gradient = at(&scene, &[0, 0]).unwrap();
    assert_eq!(gradient.lifecycle, Some(Lifecycle::Private));
    assert_eq!(gradient.title.as_deref(), Some("Tramonto"));
    assert_eq!(
        at(&scene, &[0, 1]).unwrap().lifecycle,
        Some(Lifecycle::Shared)
    );
    let mask = at(&scene, &[0, 2]).unwrap();
    assert_eq!(mask.lifecycle, None);
    assert_eq!(mask.role, Role::Resource);
}
