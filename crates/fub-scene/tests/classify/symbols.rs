//! I simboli e le loro istanze (`use`): identità, contenuto, riquadro e
//! annidamento.

use super::*;

#[test]
fn a_symbol_is_a_symbol_with_id_and_visible_overflow_in_a_root_defs_its_children_judged_one_by_one()
{
    let scene = load(&doc(&format!(
        "<defs>{}</defs>",
        symbol(
            "s1",
            &format!("<title>Lampadina</title>{RECT}<switch/>"),
            r##" fub:source="Simboli/Casa.svg#s1 0123456789abcdef""##
        )
    )));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Symbol));
    assert_eq!(role(&scene, &[0, 0, 0]), Some(Role::Title));
    assert_eq!(role(&scene, &[0, 0, 1]), Some(Role::Rect));
    assert_eq!(role(&scene, &[0, 0, 2]), None);
    let item = at(&scene, &[0, 0]).unwrap();
    assert_eq!(item.title.as_deref(), Some("Lampadina"));
    assert_eq!(
        item.source.as_deref(),
        Some("Simboli/Casa.svg#s1 0123456789abcdef")
    );
    assert!(item.tags.is_some());
    let one = |body: &str| role(&load(&doc(&format!("<defs>{body}</defs>"))), &[0, 0]);
    assert_eq!(
        one(r#"<symbol id="s1" overflow=" visible "/>"#),
        Some(Role::Symbol)
    );
    assert_eq!(
        one(r#"<symbol id="s1" overflow="visible" fub:nota="x"/>"#),
        Some(Role::Symbol)
    );
    for body in [
        r#"<symbol id="s1"/>"#,
        r#"<symbol id="s1" overflow="hidden"/>"#,
        r#"<symbol id="" overflow="visible"/>"#,
        r#"<symbol overflow="visible"/>"#,
        r#"<symbol id="s1" overflow="visible" viewBox="0 0 10 10"/>"#,
        r#"<symbol id="s1" overflow="visible" x="0"/>"#,
        r#"<symbol id="s1" overflow="visible" transform="scale(2)"/>"#,
        r##"<symbol id="s1" overflow="visible" fill="#000000"/>"##,
        r##"<symbol id="s1" overflow="visible" xlink:href="#s1"/>"##,
    ] {
        assert_eq!(one(body), None, "{body}");
    }
    // Fuori da una defs della radice è estraneo.
    assert_eq!(first(&symbol("s1", RECT, "")), None);
    let scene = load(&doc(&format!("<g>{}</g>", symbol("s1", RECT, ""))));
    assert_eq!(role(&scene, &[0, 0]), None);
    let scene = load(&doc(&format!(
        "<g><defs>{}</defs></g>",
        symbol("s1", RECT, "")
    )));
    assert_eq!(role(&scene, &[0, 0]), None);
}

#[test]
fn a_symbol_that_contains_itself_is_foreign_even_through_other_symbols() {
    let roles = |defs: &str| {
        let scene = load(&doc(&format!("<defs>{defs}</defs>")));
        [0, 1, 2].map(|k| at(&scene, &[0, k]).map(|item| item.role))
    };
    // Una catena senza cicli, scritta in qualunque ordine.
    let chain = [
        symbol("s1", r##"<use href="#s2"/>"##, ""),
        symbol("s2", r##"<use href="#s3"/>"##, ""),
        symbol("s3", RECT, ""),
    ]
    .concat();
    assert_eq!(roles(&chain), [Some(Role::Symbol); 3]);
    // Sé stesso, e due a vicenda; chi usa uno di loro resta, la sua istanza
    // no.
    assert_eq!(
        roles(&symbol("s1", r##"<use href="#s1"/>"##, "")),
        [None; 3]
    );
    let scene = load(&doc(&format!(
        "<defs>{}{}{}</defs>",
        symbol("s1", r##"<use href="#s2"/>"##, ""),
        symbol("s2", r##"<g><use xlink:href="#s1"/></g>"##, ""),
        symbol("s3", &format!(r##"{RECT}<use href="#s1"/>"##), "")
    )));
    assert_eq!(role(&scene, &[0, 0]), None);
    assert_eq!(role(&scene, &[0, 1]), None);
    assert_eq!(role(&scene, &[0, 2]), Some(Role::Symbol));
    assert_eq!(role(&scene, &[0, 2, 0]), Some(Role::Rect));
    assert_eq!(role(&scene, &[0, 2, 1]), None);
    // Anche un riferimento che non è un'istanza fa il ciclo.
    let through = [
        symbol(
            "s1",
            r##"<rect width="10" height="10" fill="url(#s2) #000000"/>"##,
            "",
        ),
        symbol("s2", r##"<use href="#s1"/>"##, ""),
    ]
    .concat();
    assert_eq!(roles(&through), [None; 3]);
}

#[test]
fn a_long_chain_of_symbols_is_read_without_recursion() {
    let length = 3000;
    let defs: String = (0..length)
        .map(|k| {
            let body = if k + 1 < length {
                format!(r##"<use href="#s{}" transform="translate(1 0)"/>"##, k + 1)
            } else {
                RECT.to_owned()
            };
            symbol(&format!("s{k}"), &body, "")
        })
        .collect();
    let scene = load(&doc(&format!(r##"<defs>{defs}</defs><use href="#s0"/>"##)));
    assert_eq!(role(&scene, &[0, length - 1]), Some(Role::Symbol));
    assert_eq!(role(&scene, &[1]), Some(Role::Instance));
    let b = scene.summary.bbox.unwrap();
    assert_eq!(
        [b.x, b.y, b.width, b.height],
        [(length - 1) as f64, 0.0, 10.0, 10.0]
    );
}

#[test]
fn an_id_already_taken_by_a_resource_stays_the_resources() {
    let scene = load(&doc(&format!(
        r##"<defs><linearGradient id="s1"><stop offset="0" stop-color="#000000"/></linearGradient>{}</defs><use href="#s1"/>"##,
        symbol("s1", RECT, "")
    )));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Resource));
    assert_eq!(role(&scene, &[0, 1]), None);
    assert_eq!(role(&scene, &[1]), None);
    assert!(findings(&scene).iter().any(|d| d.code == Code::S003));
}

#[test]
fn an_instance_is_a_use_toward_a_symbol_with_its_attributes_and_only_titles_and_descriptions() {
    const RESOURCES: &str = r##"<clipPath id="c1"><rect width="5" height="5"/></clipPath><mask id="m1"><rect width="5" height="5" fill="#ffffff"/></mask><filter id="f1"><feGaussianBlur stdDeviation="1"/></filter>"##;
    let instance = |used: &str| {
        role(
            &load(&doc(&format!(
                "<defs>{RESOURCES}{}</defs>{used}",
                symbol("s1", RECT, "")
            ))),
            &[1],
        )
    };
    for used in [
        r##"<use href="#s1"/>"##,
        r##"<use xlink:href="#s1"/>"##,
        r##"<use id="o1" href="#s1" transform="translate(10 20) rotate(30)" opacity="0.5" display="none" style="mix-blend-mode: multiply"/>"##,
        r##"<use href="#s1" clip-path="url(#c1)" mask="url(#m1)" filter="url(#f1)"/>"##,
        "<use href=\"#s1\" fub:nota=\"x\">\n  <title>Lampada</title>\n  <desc>In cucina</desc>\n</use>",
    ] {
        assert_eq!(instance(used), Some(Role::Instance), "{used}");
    }
    let rect_inside = format!(r##"<use href="#s1">{RECT}</use>"##);
    for used in [
        "<use/>",
        r##"<use x="10" href="#s1"/>"##,
        r##"<use width="10" href="#s1"/>"##,
        r##"<use fill="#ff0000" href="#s1"/>"##,
        r##"<use stroke="#ff0000" href="#s1"/>"##,
        r##"<use font-size="12" href="#s1"/>"##,
        r##"<use style="isolation: isolate" href="#s1"/>"##,
        r##"<use href="#s1" xlink:href="#s1"/>"##,
        r##"<use href="#c1"/>"##,
        r##"<use href="#s9"/>"##,
        r#"<use href="s1"/>"#,
        r##"<use href="Simboli.svg#s1"/>"##,
        r##"<use href="#s1" clip-path="url(#m1)"/>"##,
        rect_inside.as_str(),
        r##"<use href="#s1">testo</use>"##,
    ] {
        assert_eq!(instance(used), None, "{used}");
    }
    // Il simbolo dell'istanza, da `href` o da `xlink:href`.
    let scene = load(&doc(&format!(
        r##"<defs>{}</defs><use href="#s1"/><a href="note.md"><use xlink:href="#s1"/></a>"##,
        symbol("s1", RECT, "")
    )));
    assert_eq!(at(&scene, &[1]).unwrap().symbol.as_deref(), Some("s1"));
    assert_eq!(at(&scene, &[2, 0]).unwrap().symbol.as_deref(), Some("s1"));
    assert_eq!(role(&scene, &[2, 0]), Some(Role::Instance));
    // In una defs un'istanza è estranea.
    let scene = load(&doc(&format!(
        r##"<defs>{}<use href="#s1"/></defs>"##,
        symbol("s1", RECT, "")
    )));
    assert_eq!(role(&scene, &[0, 1]), None);
}

#[test]
fn the_box_of_an_instance_is_that_of_its_symbol_and_the_symbol_counts_once() {
    assert_eq!(
        bbox(&format!(
            r##"<use href="#s1" transform="translate(100 50) scale(2)"/><defs>{}</defs>"##,
            symbol("s1", RECT, "")
        )),
        Some([100.0, 50.0, 20.0, 20.0])
    );
    // Il contenuto del simbolo nelle sue coordinate non conta, e nemmeno
    // un'istanza nascosta o di un simbolo vuoto.
    assert_eq!(
        bbox(&format!(
            "<defs>{}{}</defs>",
            symbol("s1", RECT, ""),
            symbol("s2", "", "")
        )),
        None
    );
    assert_eq!(
        bbox(&format!(
            r##"<defs>{}</defs><use href="#s1" display="none"/><g display="none"><use href="#s1"/></g>"##,
            symbol("s1", RECT, "")
        )),
        None
    );
    assert_eq!(
        bbox(&format!(
            r##"<defs>{}</defs><use href="#s2"/>"##,
            symbol("s2", "", "")
        )),
        None
    );
    // Un simbolo dentro un altro, ruotato.
    assert_eq!(
        bbox(&format!(
            r##"<defs>{}{}</defs><use href="#s2" transform="translate(50 50)"/>"##,
            symbol("s1", RECT, ""),
            symbol("s2", r##"<use href="#s1" transform="rotate(90)"/>"##, "")
        )),
        Some([40.0, 50.0, 10.0, 10.0])
    );
    let scene = load(&doc(&format!(
        r##"<defs>{}</defs><use href="#s1"/><use href="#s1"/>"##,
        symbol(
            "s1",
            &format!(r#"{RECT}<text x="0" y="0"><tspan x="0" dy="0">a</tspan></text>"#),
            ""
        )
    )));
    let counts = &scene.summary.counts;
    assert_eq!((counts.shapes, counts.texts), (1, 1));
}

#[test]
fn the_content_of_a_symbol_is_not_judged_against_the_backdrop_and_an_instance_covers_like_an_image()
{
    let codes =
        |body: &str| -> Vec<Code> { findings(&load(&doc(body))).iter().map(|d| d.code).collect() };
    let white = |x: u32, y: u32, size: u32| {
        format!(
            r##"<text x="{x}" y="{y}" font-size="{size}" fill="#ffffff"><tspan x="{x}" dy="0">Luce</tspan></text>"##
        )
    };
    // Un testo bianco sul bianco della carta: S009.
    assert_eq!(codes(&white(10, 10, 16)), [Code::S009]);
    // Nel simbolo no, ma un testo troppo piccolo resta.
    assert_eq!(
        codes(&format!(
            "<defs>{}</defs>",
            symbol("s1", &white(10, 10, 16), "")
        )),
        []
    );
    assert_eq!(
        codes(&format!(
            "<defs>{}</defs>",
            symbol("s1", &white(10, 10, 6), "")
        )),
        [Code::S013]
    );
    // Sopra un'istanza il fondo non si sa; accanto sì.
    let icon = format!(
        r##"<defs>{}</defs><use href="#s1" transform="translate(0 0)"/>"##,
        symbol(
            "s1",
            r##"<rect width="40" height="40" fill="#0072b2"/>"##,
            ""
        )
    );
    assert_eq!(codes(&format!("{icon}{}", white(10, 20, 16))), []);
    assert_eq!(codes(&format!("{icon}{}", white(60, 20, 16))), [Code::S009]);
    // Un'istanza dopo il testo non gli sta sotto.
    assert_eq!(
        codes(&format!(
            r##"<defs>{}</defs>{}<use href="#s1"/>"##,
            symbol(
                "s1",
                r##"<rect width="40" height="40" fill="#0072b2"/>"##,
                ""
            ),
            white(10, 20, 16)
        )),
        [Code::S009]
    );
}
