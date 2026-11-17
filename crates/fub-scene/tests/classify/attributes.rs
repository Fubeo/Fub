//! Tag e attributi che la scena accetta, e i valori che ciascuno può avere:
//! lunghezze, colori, percorsi, tipografia, trasformazioni, URL e href.

use super::*;

#[test]
fn every_tag_of_the_table_is_editable() {
    for (body, expected) in [
        (r#"<path d="M0 0 L10 10"/>"#, Role::Path),
        (
            r#"<rect x="1" y="2" width="3" height="4" rx="1" ry="1"/>"#,
            Role::Rect,
        ),
        (r#"<ellipse cx="5" cy="5" rx="4" ry="2"/>"#, Role::Ellipse),
        (r#"<circle cx="5" cy="5" r="4"/>"#, Role::Circle),
        (r#"<line x1="0" y1="0" x2="10" y2="10"/>"#, Role::Line),
        (r#"<polyline points="0,0 10,10 20,0"/>"#, Role::Polyline),
        (r#"<polygon points="0 0 10 10 20 0"/>"#, Role::Polygon),
        (
            r#"<text x="1" y="2"><tspan x="1" dy="0">a</tspan></text>"#,
            Role::Text,
        ),
        (
            r#"<image x="0" y="0" width="1" height="1" href="foto.png"/>"#,
            Role::Image,
        ),
        ("<g></g>", Role::Group),
        (r#"<a href="note.md"></a>"#, Role::Link),
        ("<title>Titolo</title>", Role::Title),
        ("<desc>Descrizione</desc>", Role::Desc),
    ] {
        assert_eq!(first(body), Some(expected), "{body}");
    }
}

#[test]
fn a_tag_outside_the_table_is_foreign() {
    for body in [
        "<use href=\"#a\"/>",
        "<style>rect{}</style>",
        "<script>alert(1)</script>",
        "<foreignObject></foreignObject>",
        "<symbol></symbol>",
        "<switch></switch>",
        "<svg></svg>",
        // Le risorse stanno in una `defs` della radice: fuori, sono estranee.
        r#"<linearGradient id="r1"></linearGradient>"#,
        r#"<clipPath id="r1"></clipPath>"#,
        "<metadata></metadata>",
        "<tspan>fuori da un testo</tspan>",
        r#"<marker id="r1"></marker>"#,
        "<animate/>",
    ] {
        assert_eq!(first(body), None, "{body}");
    }
}

#[test]
fn tags_are_recognized_by_namespace_not_by_prefix() {
    // Un prefisso qualunque legato al namespace SVG è SVG.
    assert_eq!(
        first(r#"<s:rect xmlns:s="http://www.w3.org/2000/svg" width="1" height="1"/>"#),
        Some(Role::Rect)
    );
    // Lo stesso nome locale in un altro namespace non lo è.
    assert_eq!(
        first(r#"<x:rect xmlns:x="https://example.org/x" width="1"/>"#),
        None
    );
    // Un `rect` che ridichiara il namespace di default fuori da SVG.
    assert_eq!(first(r#"<rect xmlns="https://example.org/x"/>"#), None);
    // Il namespace di `fub` vale per URI: un altro prefisso funziona.
    let source = doc(r#"<g xmlns:f="https://fubeo.github.io/ns/scene/1" f:layer="Uno"></g>"#);
    assert_eq!(role(&load(&source), &[0]), Some(Role::Layer));
}

#[test]
fn every_attribute_of_the_list_is_allowed() {
    let presentation = concat!(
        r##"id="o1" fill="#ff0000" fill-opacity="0.5" stroke="none" stroke-width="2" "##,
        r#"stroke-opacity="1" stroke-linecap="round" stroke-linejoin="bevel" "#,
        r#"stroke-dasharray="4 2" opacity="0" display="inline" transform="rotate(45)" "#,
        r#"font-family="Inter, sans-serif" font-size="12" font-weight="bold" font-style="italic" "#,
        r#"letter-spacing="-0.5" text-anchor="middle""#
    );
    let body = format!(r#"<rect {presentation} x="0" y="0" width="1" height="1"/>"#);
    assert_eq!(first(&body), Some(Role::Rect));
    let body = format!(r#"<g {presentation}></g>"#);
    assert_eq!(first(&body), Some(Role::Group));
}

#[test]
fn an_attribute_outside_the_list_makes_the_element_foreign() {
    for attribute in [
        r#"class="a""#,
        r#"style="fill:red""#,
        r#"onclick="alert(1)""#,
        r#"stroke-miterlimit="4""#,
        r#"filter="blur(2px)""#,
        r#"mask-type="alpha""#,
        r#"data-x="1""#,
        r#"aria-label="x""#,
        r#"role="img""#,
        r#"visibility="hidden""#,
        r#"cx="1""#,
    ] {
        let body = format!(r#"<rect width="1" height="1" {attribute}/>"#);
        assert_eq!(first(&body), None, "{body}");
    }
    // Un attributo nel namespace SVG non è un attributo SVG.
    let body = r#"<rect xmlns:s="http://www.w3.org/2000/svg" s:fill="red"/>"#;
    assert_eq!(first(body), None);
}

#[test]
fn style_says_only_the_blend_and_on_a_container_the_isolation() {
    for body in [
        r#"<rect width="1" height="1" style="mix-blend-mode: multiply"/>"#,
        r#"<text style="mix-blend-mode: screen"><tspan>a</tspan></text>"#,
        r#"<image href="a.png" style="mix-blend-mode: luminosity"/>"#,
        r#"<g style="isolation: isolate"></g>"#,
        r#"<g style="mix-blend-mode: difference; isolation: isolate"></g>"#,
        r#"<a href="Note.md" style="isolation: auto"></a>"#,
    ] {
        assert!(first(body).is_some(), "{body}");
    }
    for body in [
        // L'isolamento vale soltanto su un contenitore.
        r#"<rect width="1" height="1" style="isolation: isolate"/>"#,
        // I browser ignorano gli attributi di presentazione omonimi.
        r#"<rect width="1" height="1" mix-blend-mode="multiply"/>"#,
        r#"<g isolation="isolate"></g>"#,
        r#"<rect width="1" height="1" style="mix-blend-mode: plus-lighter"/>"#,
        r#"<rect width="1" height="1" style="mix-blend-mode: multiply; opacity: 0.5"/>"#,
        r#"<text><tspan style="mix-blend-mode: multiply">a</tspan></text>"#,
    ] {
        assert_eq!(first(body), None, "{body}");
    }
}

#[test]
fn geometry_attributes_belong_to_their_tag() {
    assert_eq!(first(r#"<circle r="1"/>"#), Some(Role::Circle));
    assert_eq!(first(r#"<ellipse r="1"/>"#), None);
    assert_eq!(first(r#"<rect r="1"/>"#), None);
    assert_eq!(first(r#"<line x="1"/>"#), None);
    assert_eq!(first(r#"<path points="0 0"/>"#), None);
    assert_eq!(first(r#"<polygon d="M0 0"/>"#), None);
    assert_eq!(first(r#"<text dx="1"></text>"#), None);
    assert_eq!(first(r#"<image href="a.png" rx="1"/>"#), None);
    assert_eq!(
        first(r#"<image href="a.png" preserveAspectRatio="xMidYMid slice"/>"#),
        Some(Role::Image)
    );
    assert_eq!(first(r#"<rect preserveAspectRatio="none"/>"#), None);
    assert_eq!(first(r#"<g x="1"></g>"#), None);
    // `href` vale solo su `a` e `image`.
    assert_eq!(first(r#"<rect href="a.md"/>"#), None);
}

#[test]
fn lengths_take_absolute_units_only() {
    for value in [
        "1", "-1.5", ".5", "1e3", "+2", " 3 ", "1px", "1in", "2.54cm", "10mm", "4Q", "12pt", "1pc",
    ] {
        let body = format!(r#"<rect x="{value}"/>"#);
        assert_eq!(first(&body), Some(Role::Rect), "{body}");
    }
    for value in [
        "",
        "1%",
        "1em",
        "1ex",
        "1rem",
        "1ch",
        "1vw",
        "1vh",
        "calc(1px)",
        "auto",
        "1PX",
        "1 px",
        "1.",
        "e3",
        "1e",
        "inherit",
    ] {
        let body = format!(r#"<rect x="{value}"/>"#);
        assert_eq!(first(&body), None, "{body}");
    }
}

#[test]
fn negative_sizes_make_the_element_foreign() {
    for attribute in [
        r#"width="-1""#,
        r#"height="-1""#,
        r#"rx="-1""#,
        r#"ry="-0.5""#,
        r#"stroke-width="-1""#,
        r#"font-size="-1""#,
    ] {
        assert_eq!(first(&format!("<rect {attribute}/>")), None, "{attribute}");
    }
    assert_eq!(first(r#"<circle r="-1"/>"#), None);
    assert_eq!(
        first(r#"<rect width="0" height="0" x="-5" y="-5"/>"#),
        Some(Role::Rect)
    );
    assert_eq!(first(r#"<circle r="0"/>"#), Some(Role::Circle));
}

#[test]
fn path_data_follows_the_svg_2_grammar() {
    for d in [
        "",
        "M0 0",
        "m1.5.5l2-3",
        "M0 0 a1 1 0 011 1",
        "M0,0 C1,1 2,2 3,3 S4 4 5 5 z",
        "M0 0 Q1 1 2 2 T3 3 H4 V5 Z",
    ] {
        assert_eq!(
            first(&format!(r#"<path d="{d}"/>"#)),
            Some(Role::Path),
            "{d}"
        );
    }
    for d in [
        "L0 0",
        "M0",
        "M0 0 L",
        "M0 0 Z 1 1",
        "M0 0 A1 1 0 2 1 2 2",
        "M0 0 X1 1",
        "M0 0,",
    ] {
        assert_eq!(first(&format!(r#"<path d="{d}"/>"#)), None, "{d}");
    }
}

#[test]
fn points_need_an_even_count() {
    assert_eq!(
        first(r#"<polyline points="0,0 1,1"/>"#),
        Some(Role::Polyline)
    );
    assert_eq!(first(r#"<polygon points=""/>"#), Some(Role::Polygon));
    assert_eq!(first(r#"<polyline points="0,0 1"/>"#), None);
    assert_eq!(first(r#"<polygon points="0,0,"/>"#), None);
    assert_eq!(first(r#"<polygon points="0px 0"/>"#), None);
}

#[test]
fn dasharray_is_none_or_non_negative_lengths() {
    for value in ["none", "4", "4 2", "4,2,1", "1mm 2px", "0"] {
        assert_eq!(
            first(&format!(r#"<line stroke-dasharray="{value}"/>"#)),
            Some(Role::Line),
            "{value}"
        );
    }
    for value in ["", "-1", "4 -2", "1%", "4,", "inherit"] {
        assert_eq!(
            first(&format!(r#"<line stroke-dasharray="{value}"/>"#)),
            None,
            "{value}"
        );
    }
}

#[test]
fn colors_are_hex_names_or_none() {
    for value in [
        "none",
        "#ff0000",
        "#F00",
        "#AbCdEf",
        "red",
        "rebeccapurple",
        " #fff ",
    ] {
        assert_eq!(
            first(&format!(r#"<rect fill="{value}"/>"#)),
            Some(Role::Rect),
            "{value}"
        );
    }
    for value in [
        "",
        "rgb(0,0,0)",
        "hsl(0 0% 0%)",
        "currentColor",
        "currentcolor",
        "transparent",
        "inherit",
        "#ff00",
        "#ff00ff00",
        "Red",
        "url(#g)",
        "#ggg",
    ] {
        assert_eq!(
            first(&format!(r#"<rect fill="{value}"/>"#)),
            None,
            "{value}"
        );
        assert_eq!(
            first(&format!(r#"<rect stroke="{value}"/>"#)),
            None,
            "{value}"
        );
    }
}

#[test]
fn opacity_is_a_number_from_zero_to_one() {
    for value in ["0", "1", "0.25", ".5", "1e-1"] {
        assert_eq!(
            first(&format!(r#"<rect opacity="{value}"/>"#)),
            Some(Role::Rect),
            "{value}"
        );
    }
    for value in ["1.5", "-0.1", "50%", "", "inherit"] {
        assert_eq!(
            first(&format!(r#"<rect fill-opacity="{value}"/>"#)),
            None,
            "{value}"
        );
    }
}

#[test]
fn keywords_take_their_listed_values() {
    for attribute in [
        r#"display="none""#,
        r#"display="inline""#,
        r#"stroke-linecap="butt""#,
        r#"stroke-linecap="square""#,
        r#"stroke-linejoin="miter""#,
        r#"stroke-linejoin="round""#,
        r#"font-weight="normal""#,
        r#"font-weight="100""#,
        r#"font-weight="900""#,
        r#"text-anchor="start""#,
        r#"text-anchor="end""#,
    ] {
        assert_eq!(
            first(&format!("<rect {attribute}/>")),
            Some(Role::Rect),
            "{attribute}"
        );
    }
    for attribute in [
        r#"display="block""#,
        r#"display="inherit""#,
        r#"stroke-linecap="Round""#,
        r#"stroke-linejoin="arcs""#,
        r#"font-weight="bolder""#,
        r#"font-weight="550""#,
        r#"font-weight="1000""#,
        r#"text-anchor="inherit""#,
    ] {
        assert_eq!(first(&format!("<rect {attribute}/>")), None, "{attribute}");
    }
    for value in ["none", "xMidYMid", "xMinYMax meet", "xMaxYMin slice"] {
        let body = format!(r#"<image href="a.png" preserveAspectRatio="{value}"/>"#);
        assert_eq!(first(&body), Some(Role::Image), "{value}");
    }
    for value in [
        "",
        "xMidYmid",
        "none slice meet",
        "defer xMidYMid",
        "inherit",
    ] {
        let body = format!(r#"<image href="a.png" preserveAspectRatio="{value}"/>"#);
        assert_eq!(first(&body), None, "{value}");
    }
}

#[test]
fn typography_takes_its_values() {
    for attribute in [
        r#"font-style="normal""#,
        r#"font-style="italic""#,
        r#"font-style="oblique""#,
        r#"letter-spacing="normal""#,
        r#"letter-spacing="0""#,
        r#"letter-spacing="-1.5""#,
        r#"letter-spacing="2px""#,
        r#"letter-spacing="0.1in""#,
    ] {
        assert_eq!(
            first(&format!("<g {attribute}></g>")),
            Some(Role::Group),
            "{attribute}"
        );
    }
    for attribute in [
        r#"font-style="Italic""#,
        r#"font-style="oblique 10deg""#,
        r#"font-style="inherit""#,
        r#"letter-spacing="10%""#,
        r#"letter-spacing="0.1em""#,
        r#"letter-spacing="wide""#,
        r#"letter-spacing="""#,
    ] {
        assert_eq!(first(&format!("<g {attribute}></g>")), None, "{attribute}");
    }
    for value in [
        "none",
        "underline",
        "line-through underline",
        "underline overline line-through",
    ] {
        let body = format!(
            r#"<text text-decoration="{value}"><tspan text-decoration="{value}">a</tspan></text>"#
        );
        assert_eq!(first(&body), Some(Role::Text), "{value}");
    }
    for value in [
        "",
        "underline underline",
        "none underline",
        "blink",
        "Underline",
        "underline red",
    ] {
        let body = format!(r#"<text text-decoration="{value}"></text>"#);
        assert_eq!(first(&body), None, "{value}");
    }
    // Non si eredita: su un gruppo o una forma non vuol dire niente.
    assert_eq!(first(r#"<g text-decoration="underline"></g>"#), None);
    assert_eq!(first(r#"<rect text-decoration="none"/>"#), None);
}

#[test]
fn transforms_are_lists_of_svg_functions() {
    for value in [
        "",
        "matrix(1 0 0 1 10 20)",
        "translate(10)",
        "translate(10,20) scale(2)",
        "rotate(45 50 50),skewX(10) skewY(-5)",
        "scale(1 2)translate(3 4)",
    ] {
        assert_eq!(
            first(&format!(r#"<g transform="{value}"></g>"#)),
            Some(Role::Group),
            "{value}"
        );
    }
    for value in [
        "translate(10px)",
        "rotate(45deg)",
        "matrix(1 0 0 1 10)",
        "Translate(1)",
        "translate(1),",
        "scale()",
        "translate(1 2 3)",
    ] {
        assert_eq!(
            first(&format!(r#"<g transform="{value}"></g>"#)),
            None,
            "{value}"
        );
    }
}

#[test]
fn font_family_accepts_any_value() {
    assert_eq!(
        first(r#"<text font-family="'Comic Sans MS', cursive"></text>"#),
        Some(Role::Text)
    );
    assert_eq!(first(r#"<text font-family=""></text>"#), Some(Role::Text));
}

#[test]
fn a_url_that_does_not_lead_to_an_editable_resource_makes_the_element_foreign() {
    for body in [
        r#"<rect fill="url(#g)"/>"#,
        r#"<rect stroke="URL(#g)"/>"#,
        r#"<text font-family="url(x)"></text>"#,
        r#"<image href="url(a.png)"/>"#,
        r#"<a xlink:href="url(a.md)"></a>"#,
    ] {
        assert_eq!(first(body), None, "{body}");
    }
    // Un attributo che il browser non legge non riferisce niente: lì `url(`
    // è testo come un altro.
    assert_eq!(first(r#"<rect fub:nota="url(x)"/>"#), Some(Role::Rect));
    let body = r#"<rect xmlns:i="https://example.org/i" i:fill="url(#g)"/>"#;
    assert_eq!(first(body), Some(Role::Rect));
}

#[test]
fn link_hrefs_point_into_the_vault() {
    for value in [
        "note.md",
        "../altro/nota.md",
        "/radice.md",
        "nota.md#sezione",
        "una nota.md",
    ] {
        assert_eq!(
            first(&format!(r#"<a href="{value}"></a>"#)),
            Some(Role::Link),
            "{value}"
        );
        assert_eq!(
            first(&format!(r#"<a xlink:href="{value}"></a>"#)),
            Some(Role::Link),
            "{value}"
        );
    }
    for value in [
        "https://example.org",
        "mailto:a@b.c",
        "javascript:alert(1)",
        "#frag",
        "",
        "//host/a.md",
        "data:text/plain,a",
    ] {
        assert_eq!(
            first(&format!(r#"<a href="{value}"></a>"#)),
            None,
            "{value}"
        );
    }
    // Un `a` senza `href` è un collegamento ancora da scrivere.
    assert_eq!(first("<a></a>"), Some(Role::Link));
}

#[test]
fn image_hrefs_are_raster_data_vault_paths_or_remote() {
    for value in [
        "data:image/png;base64,iVBORw0KGgo=",
        "data:image/jpeg;base64,/9j/",
        "data:image/webp;base64,UklGRg==",
        "data:image/gif;base64,R0lGOD",
        "foto.png",
        "/media/foto.jpg",
        "https://example.org/foto.png",
    ] {
        assert_eq!(
            first(&format!(r#"<image href="{value}"/>"#)),
            Some(Role::Image),
            "{value}"
        );
        assert_eq!(
            first(&format!(r#"<image xlink:href="{value}"/>"#)),
            Some(Role::Image),
            "{value}"
        );
    }
    for value in [
        "data:image/svg+xml,%3Csvg%2F%3E",
        "data:text/html,x",
        "#frag",
        "javascript:x",
        "ftp://host/a.png",
        "",
    ] {
        assert_eq!(
            first(&format!(r#"<image href="{value}"/>"#)),
            None,
            "{value}"
        );
    }
}

#[test]
fn xlink_allows_only_href_on_links_and_images() {
    assert_eq!(first(r#"<rect xlink:href="a.md"/>"#), None);
    assert_eq!(first(r#"<a xlink:title="Nota"></a>"#), None);
    assert_eq!(first(r#"<image xlink:show="embed" href="a.png"/>"#), None);
}
