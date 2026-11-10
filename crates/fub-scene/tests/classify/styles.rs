//! Gli stili: un testo o una polilinea con `fub:role="style"` nella radice,
//! con il suo nome e il suo tipo.

use super::*;

// ---------------------------------------------------------------------------
// Gli stili (formato della scena, stili).
// ---------------------------------------------------------------------------

const TEXT_STYLE: &str = r##"<text id="r1" fub:role="style" fub:name="Titolo" fub:leading="1.25" font-family="Inter" font-size="24" font-weight="700" font-style="italic" letter-spacing="0.5" text-decoration="underline" fill="#1a1a1a"/>"##;
const GRAPHIC_STYLE: &str = r##"<polyline id="r2" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#e69f00" fill-opacity="0.5" stroke="#1a1a1a" stroke-opacity="0.8" stroke-width="2" stroke-dasharray="4 2" stroke-linecap="round" stroke-linejoin="bevel" opacity="0.9" style="mix-blend-mode: multiply"/>"##;

#[test]
fn a_style_is_a_text_or_a_polyline_with_role_style_in_a_root_defs_with_name_and_kind() {
    let scene = load(&doc(&format!("<defs>{TEXT_STYLE}{GRAPHIC_STYLE}</defs>")));
    let text_style = at(&scene, &[0, 0]).unwrap();
    assert_eq!(text_style.role, Role::Resource);
    assert_eq!(text_style.lifecycle, Some(Lifecycle::Style));
    assert_eq!(
        text_style.style,
        Some(StyleFacts {
            name: "Titolo".into(),
            kind: StyleKind::Text
        })
    );
    let graphic = at(&scene, &[0, 1]).unwrap();
    assert_eq!(graphic.lifecycle, Some(Lifecycle::Style));
    assert_eq!(
        graphic.style,
        Some(StyleFacts {
            name: "Riquadro".into(),
            kind: StyleKind::Graphic
        })
    );
    // I marcatori, il filtro e un riempimento con una sfumatura sono suoi
    // come di ogni spezzata; il testo prende un colore, none o una sfumatura.
    let marker = r#"<marker id="r3" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker>"#;
    let filter = r#"<filter id="r4"><feGaussianBlur stdDeviation="2"/></filter>"#;
    let gradient = r##"<linearGradient id="r5" fub:role="private"><stop offset="0" stop-color="#000000"/></linearGradient>"##;
    for style in [
        r##"<polyline id="r6" fub:role="style" fub:name="R" points="0,0 100,0 100,100" marker-start="url(#r3)" marker-end="url(#r3)" filter="url(#r4)" fill="url(#r5) #000000"/>"##,
        r##"<text id="r6" fub:role="style" fub:name="T" fill="url(#r5) #000000"/>"##,
        r#"<text id="r6" fub:role="style" fub:name="T" fill="none"/>"#,
        r#"<text id="r6" fub:role="style" fub:name="T"/>"#,
        r#"<text id="r6" fub:role="style" fub:name="T" fub:leading="0.5"/>"#,
        r#"<text id="r6" fub:role="style" fub:name="T" fub:leading="10"/>"#,
        r#"<text id="r6" fub:role="style" fub:name="T" fub:leading="1.125"/>"#,
        "<text id=\"r6\" fub:role=\"style\" fub:name=\"T\">\n  <title>Titolo</title>\n  <desc>Per i capitoli</desc>\n</text>",
        r#"<text id="r6" fub:role="style" fub:name="T" fub:nota="x"/>"#,
    ] {
        let read = load(&doc(&format!(
            "<defs>{marker}{filter}{gradient}{style}</defs>"
        )));
        assert_eq!(
            at(&read, &[0, 3]).and_then(|e| e.lifecycle),
            Some(Lifecycle::Style),
            "{style}"
        );
    }
    let titled = load(&doc(
        r#"<defs><text id="r1" fub:role="style" fub:name="T"><title>Titolo</title></text></defs>"#,
    ));
    assert_eq!(
        at(&titled, &[0, 0]).unwrap().title.as_deref(),
        Some("Titolo")
    );
}

#[test]
fn a_style_without_its_form_is_foreign() {
    for style in [
        r#"<text id="r1" fub:role="style" font-size="12"/>"#,
        r#"<text id="r1" fub:role="style" fub:name=" "/>"#,
        r#"<text fub:role="style" fub:name="T"/>"#,
        r#"<text id="" fub:role="style" fub:name="T"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" x="0"/>"#,
        r##"<text id="r1" fub:role="style" fub:name="T" stroke="#000000"/>"##,
        r#"<text id="r1" fub:role="style" fub:name="T" opacity="0.5"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T"><tspan>Testo</tspan></text>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading="0.4"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading="10.5"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading="1.2345"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading="1e0"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading=".5"/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" fub:leading=""/>"#,
        r#"<text id="r1" fub:role="style" fub:name="T" font-weight="pesante"/>"#,
        r##"<text id="r1" fub:role="style" fub:name="T" fill="url(#r9) #000000"/>"##,
        r#"<polyline id="r1" fub:role="style" fub:name="R"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0 0 100 0 100 100"/>"#,
        r#"<polyline id="r1" fub:role="style" points="0,0 100,0 100,100"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" transform="scale(2)"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" font-size="12"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" display="none"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" stroke-width="largo"/>"#,
        r#"<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100"><rect/></polyline>"#,
    ] {
        assert_eq!(resource(style), None, "{style}");
    }
    // Fuori da una defs della radice fub:role non fa uno stile: una spezzata
    // fra gli oggetti resta una spezzata.
    assert_eq!(
        first(r#"<polyline fub:role="style" fub:name="R" points="0,0 100,0 100,100"/>"#),
        Some(Role::Polyline)
    );
}

#[test]
fn another_resource_with_role_style_has_no_lifecycle() {
    let scene = load(&doc(
        r##"<defs><linearGradient id="r1" fub:role="style" fub:name="R"><stop offset="0" stop-color="#000000"/></linearGradient></defs>"##,
    ));
    let gradient = at(&scene, &[0, 0]).unwrap();
    assert_eq!(gradient.role, Role::Resource);
    assert_eq!(gradient.lifecycle, None);
    assert_eq!(gradient.style, None);
}

#[test]
fn a_follower_says_its_style_with_fub_style_and_a_missing_or_wrong_style_is_s018() {
    let swatch = r##"<linearGradient id="r3" fub:role="swatch" fub:name="Blu"><stop stop-color="#0072b2"/></linearGradient>"##;
    let broken = r#"<polyline id="r4" fub:role="style" fub:name="Rotto" points="0,0"/>"#;
    let scene = load(&doc(&format!(
        concat!(
            "<defs>{}{}{}{}</defs>",
            r#"<g id="l1" fub:layer="Livello 1" fub:style="r2">"#,
            r#"<rect id="o1" fub:style="r2" width="10" height="10"/>"#,
            r#"<text id="o2" fub:style="r1"><tspan>Titolo</tspan></text>"#,
            r#"<g id="o3" fub:style="r2"><circle id="o4" r="5"/></g>"#,
            r#"<rect id="o5" fub:style="r1" width="10" height="10"/>"#,
            r#"<text id="o6" fub:style="r2"><tspan>Nota</tspan></text>"#,
            r#"<circle id="o7" fub:style="r9" r="5"/>"#,
            r#"<line id="o8" fub:style="r3" x2="10"/>"#,
            r#"<ellipse id="o9" fub:style="r4" rx="5" ry="5"/>"#,
            r#"<a id="oa" href="nota.md" fub:style="r9"><rect id="ob" width="1" height="1"/></a>"#,
            r#"<rect id="oc" fub:style="r9" width="-1" height="1"/>"#,
            "</g>"
        ),
        TEXT_STYLE, GRAPHIC_STYLE, swatch, broken
    )));
    let follows = |path: &[usize]| at(&scene, path).unwrap().follows.as_deref();
    assert_eq!(follows(&[1, 0]), Some("r2"));
    assert_eq!(follows(&[1, 1]), Some("r1"));
    assert_eq!(follows(&[1, 2]), Some("r2"));
    assert_eq!(follows(&[1, 3]), Some("r1"));
    // Un livello o un collegamento non seguono uno stile: fub:style resta
    // com'è e non dice niente; un estraneo non segue niente.
    assert_eq!(follows(&[1]), None);
    assert_eq!(follows(&[1, 8]), None);
    assert_eq!(role(&scene, &[1, 9]), None);
    // Lo stile rotto e il rettangolo estraneo sono S002.
    let found = findings(&scene);
    assert_eq!(found.iter().filter(|d| d.code == Code::S002).count(), 2);
    let followed: Vec<(Code, Option<&str>)> = found
        .iter()
        .filter(|d| d.code != Code::S002)
        .map(|d| (d.code, d.detail.as_deref()))
        .collect();
    assert_eq!(
        followed,
        [
            (Code::S018, Some("r1")),
            (Code::S018, Some("r2")),
            (Code::S018, Some("r9")),
            (Code::S018, Some("r3")),
            (Code::S018, Some("r4")),
        ]
    );
}
