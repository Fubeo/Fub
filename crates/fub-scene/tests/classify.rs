//! La regola di classificazione del formato della scena (§4), una regola alla
//! volta, nei due versi: che cosa resta modificabile e che cosa diventa
//! estraneo.

mod common;

use common::{at, doc, elements, findings, first, foreign, load, role, text};
use fub_scene::{Code, Item, Lifecycle, ReadOnly, Role, StyleFacts, StyleKind, Tool, MAX_DEPTH};

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

#[test]
fn groups_and_links_judge_each_child_on_its_own() {
    let source = doc(concat!(
        r#"<g fub:layer="Uno" id="l1">"#,
        r##"<rect width="1"/><use href="#x"/><circle r="1"/>"##,
        r#"<a href="n.md"><rect style="x"/><ellipse rx="1"/></a>"#,
        "</g>"
    ));
    let scene = load(&source);
    assert_eq!(role(&scene, &[0]), Some(Role::Layer));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Rect));
    assert_eq!(role(&scene, &[0, 1]), None);
    assert_eq!(role(&scene, &[0, 2]), Some(Role::Circle));
    assert_eq!(role(&scene, &[0, 3]), Some(Role::Link));
    assert_eq!(role(&scene, &[0, 3, 0]), None);
    assert_eq!(role(&scene, &[0, 3, 1]), Some(Role::Ellipse));
}

#[test]
fn other_elements_are_units_with_their_children() {
    for body in [
        r#"<rect width="1"><animate attributeName="x"/></rect>"#,
        r#"<rect width="1">testo</rect>"#,
        r#"<rect width="1"><!-- nota --></rect>"#,
        r#"<rect width="1"><?pi x?></rect>"#,
        r#"<rect width="1"><![CDATA[ ]]></rect>"#,
        r#"<rect width="1"><title class="x">a</title></rect>"#,
        r#"<path d=""><desc><b xmlns="https://example.org">a</b></desc></path>"#,
        r#"<circle r="1"><g></g></circle>"#,
    ] {
        assert_eq!(first(body), None, "{body}");
    }
    for body in [
        "<rect width=\"1\">\n  \t\r\n</rect>",
        r#"<rect width="1"><title>Porta</title><desc>d'ingresso</desc></rect>"#,
        r#"<circle r="1"> <title id="t1">a &amp; b</title> </circle>"#,
    ] {
        assert!(first(body).is_some(), "{body}");
    }
}

#[test]
fn a_text_is_editable_only_with_allowed_tspans() {
    for body in [
        "<text></text>",
        r#"<text x="0" y="10"><tspan x="0" dy="0">uno</tspan><tspan x="0" dy="1.2">due</tspan></text>"#,
        "<text>\n  <tspan>uno</tspan>\n</text>",
        r#"<text><title>t</title><tspan>a</tspan></text>"#,
        r#"<text><tspan id="r1" fill="red" font-weight="bold">a &#x2014; b</tspan></text>"#,
        "<text><tspan></tspan></text>",
        r#"<text><tspan>a<tspan>b</tspan></tspan></text>"#,
        r##"<text><tspan x="0" dy="0">a <tspan font-weight="bold" font-style="italic">b</tspan> c<tspan fill="#ff0000" letter-spacing="-0.5" text-decoration="underline line-through"></tspan></tspan></text>"##,
        r#"<text><tspan><tspan font-size="20" xml:space="preserve"> b </tspan></tspan></text>"#,
        r#"<text><tspan><tspan xmlns:x="https://example.org" x:y="1">b</tspan></tspan></text>"#,
    ] {
        assert_eq!(first(body), Some(Role::Text), "{body}");
    }
    for body in [
        "<text>senza tspan</text>",
        r#"<text><tspan y="3">a</tspan></text>"#,
        r#"<text><tspan dx="3">a</tspan></text>"#,
        r#"<text><tspan>a<tspan>b<tspan>c</tspan></tspan></tspan></text>"#,
        r#"<text><tspan>a<tspan>b<!-- c --></tspan></tspan></text>"#,
        r#"<text><tspan><tspan id="p1">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan x="0">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan dy="1">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan text-anchor="end">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan display="none">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan opacity="0.5">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan transform="scale(2)">b</tspan></tspan></text>"#,
        r#"<text><tspan><tspan class="x">b</tspan></tspan></text>"#,
        r#"<text><tspan><title>t</title>b</tspan></text>"#,
        r#"<text><tspan>a<!-- c --></tspan></text>"#,
        r#"<text><tspan>a</tspan>b</text>"#,
        r##"<text><textPath href="#p">a</textPath></text>"##,
        r#"<text><tspan class="x">a</tspan></text>"#,
        r#"<text><tspan dy="1em">a</tspan></text>"#,
    ] {
        assert_eq!(first(body), None, "{body}");
    }
}

#[test]
fn text_lines_and_titles_carry_their_decoded_content() {
    let source = doc(concat!(
        "<title>Gatti &amp; cani &#233;</title>",
        "<desc>  spazi  </desc>",
        r#"<text><tspan>a &lt; b</tspan> <tspan>  due  </tspan></text>"#,
        r#"<text><tspan>a <tspan font-weight="bold">b</tspan><tspan> c</tspan>!</tspan></text>"#,
    ));
    let scene = load(&source);
    assert_eq!(
        at(&scene, &[0]).unwrap().text.as_deref(),
        Some("Gatti & cani é")
    );
    assert_eq!(at(&scene, &[1]).unwrap().text.as_deref(), Some("  spazi  "));
    let lines = at(&scene, &[2]).unwrap().lines.clone().unwrap();
    assert_eq!(lines, ["a < b", "  due  "]);
    assert_eq!(at(&scene, &[2]).unwrap().text, None);
    // I pezzi di una riga sono la riga intera.
    assert_eq!(at(&scene, &[3]).unwrap().lines.clone().unwrap(), ["a b c!"]);
}

#[test]
fn title_and_desc_hold_character_data_only() {
    assert_eq!(first("<title></title>"), Some(Role::Title));
    assert_eq!(first("<title>a<tspan>b</tspan></title>"), None);
    assert_eq!(first("<title>a<!-- b --></title>"), None);
    assert_eq!(first("<desc><![CDATA[a]]></desc>"), None);
    assert_eq!(first(r#"<desc style="x">a</desc>"#), None);
    // Fuori da un'unità, dentro un livello, valgono da sé.
    let source = doc(
        r#"<g fub:layer="Uno"><title>Livello</title><desc>a<b xmlns="https://example.org"/></desc></g>"#,
    );
    let scene = load(&source);
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Title));
    assert_eq!(role(&scene, &[0, 1]), None);
}

#[test]
fn whitespace_between_elements_belongs_to_nobody() {
    let source = doc("\n  <g>\n    <rect width=\"1\"/>\r\n\t</g>\n");
    let scene = load(&source);
    assert!(foreign(&scene).is_empty());
    assert_eq!(elements(&scene).len(), 2);
    // Il testo non vuoto in un contenitore è estraneo.
    let source = doc("<g> parole </g>");
    let scene = load(&source);
    let blocks = foreign(&scene);
    assert_eq!(blocks.len(), 1);
    assert_eq!(text(&source, &blocks[0].span), "parole");
    assert_eq!(blocks[0].parent_path.as_deref(), Some(&[0][..]));
    assert_eq!(blocks[0].elements, [0, 0]);
}

#[test]
fn attributes_in_other_namespaces_are_kept_and_decide_nothing() {
    let body = concat!(
        r#"<rect xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" "#,
        r#"xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" "#,
        r#"inkscape:label="Porta" sodipodi:insensitive="true" xml:space="preserve" "#,
        r#"fub:sconosciuto="1" width="1"/>"#
    );
    assert_eq!(first(body), Some(Role::Rect));
}

#[test]
fn the_root_is_not_classified() {
    let source = concat!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" class="x" style="background:url(#a)" "#,
        r#"onload="alert(1)" data-x="1" width="100%">"#,
        r#"<rect width="1"/></svg>"#
    );
    let scene = load(source);
    assert!(matches!(scene.items[0], Item::Root(_)));
    assert_eq!(role(&scene, &[0]), Some(Role::Rect));
}

#[test]
fn layers_are_groups_with_fub_layer_under_the_root() {
    let source = doc(concat!(
        r#"<g id="l1" fub:layer="Primo piano" fub:locked="true" display="none">"#,
        r#"<g fub:layer="Annidato"></g>"#,
        "</g>",
        r#"<g fub:layer="" fub:locked="false"/>"#,
        "<g></g>",
    ));
    let scene = load(&source);
    let layer = at(&scene, &[0]).unwrap();
    assert_eq!(layer.role, Role::Layer);
    let info = layer.layer.as_ref().unwrap();
    assert_eq!(info.name, "Primo piano");
    assert!(info.locked && info.hidden);
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Group));
    let empty = at(&scene, &[1]).unwrap();
    assert_eq!(empty.role, Role::Layer);
    assert!(!empty.layer.as_ref().unwrap().locked);
    assert_eq!(empty.tags.unwrap().close, None);
    assert_eq!(role(&scene, &[2]), Some(Role::Group));
    assert!(at(&scene, &[2]).unwrap().layer.is_none());
}

#[test]
fn the_paper_is_a_rect_with_role_paper_under_the_root() {
    let source = doc(concat!(
        r##"<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>"##,
        r#"<g fub:layer="Uno"><rect fub:role="paper" width="1"/></g>"#,
        r#"<rect fub:role="carta" width="1"/>"#,
    ));
    let scene = load(&source);
    assert_eq!(role(&scene, &[0]), Some(Role::Paper));
    assert_eq!(role(&scene, &[1, 0]), Some(Role::Rect));
    assert_eq!(role(&scene, &[2]), Some(Role::Rect));
}

#[test]
fn strokes_are_paths_with_a_known_tool() {
    let source = doc(concat!(
        r#"<path fub:tool="pen" d="M0 0"/>"#,
        r#"<path fub:tool="highlighter" d="M0 0"/>"#,
        r#"<path fub:tool="pennello" d="M0 0"/>"#,
        r#"<rect fub:tool="pen"/>"#,
    ));
    let scene = load(&source);
    assert_eq!(
        at(&scene, &[0]).unwrap().stroke.as_ref().unwrap().tool,
        Tool::Pen
    );
    assert_eq!(
        at(&scene, &[1]).unwrap().stroke.as_ref().unwrap().tool,
        Tool::Highlighter
    );
    assert_eq!(role(&scene, &[2]), Some(Role::Path));
    assert!(at(&scene, &[2]).unwrap().stroke.is_none());
    assert_eq!(role(&scene, &[3]), Some(Role::Rect));
}

#[test]
fn arrows_need_four_numbers_and_unknown_shapes_are_paths() {
    let source = doc(concat!(
        r#"<path fub:shape="arrow" fub:geom="10 20, 30 -4.5" d="M10 20 L30 -4.5"/>"#,
        r#"<path fub:shape="arrow" fub:geom="10 20 30" d="M0 0"/>"#,
        r#"<path fub:shape="arrow" fub:geom="1 2 3 4 5" d="M0 0"/>"#,
        r#"<path fub:shape="arrow" fub:geom="1 2 3 4px" d="M0 0"/>"#,
        r#"<path fub:shape="hexagon" fub:geom="1 2 3 4" d="M0 0"/>"#,
        r#"<path fub:shape="arrow" d="M0 0"/>"#,
    ));
    let scene = load(&source);
    let arrow = at(&scene, &[0]).unwrap();
    assert_eq!(arrow.role, Role::Arrow);
    assert_eq!(arrow.arrow, Some([10.0, 20.0, 30.0, -4.5]));
    for index in 1..6 {
        assert_eq!(role(&scene, &[index]), Some(Role::Path), "{index}");
        assert_eq!(at(&scene, &[index]).unwrap().arrow, None);
    }
}

#[test]
fn polygons_and_stars_need_their_whole_grammar_or_are_paths() {
    let cases = common::shape_cases();
    for case in cases["read"].as_array().unwrap() {
        let shape = case["shape"].as_str().unwrap();
        let geom = case["geom"].as_str().unwrap();
        let source = doc(&format!(
            r#"<path fub:shape="{shape}" fub:geom="{geom}" d="M0 0 L10 0 L5 5 Z"/>"#
        ));
        let item = at(&load(&source), &[0]).unwrap().clone();
        let expected = &case["polygonal"];
        if expected.is_null() {
            assert_eq!(item.role, Role::Path, "{geom:?}");
            assert_eq!(item.polygonal, None, "{geom:?}");
        } else {
            let role = if shape == "star" {
                Role::Star
            } else {
                Role::Ngon
            };
            assert_eq!(item.role, role, "{geom:?}");
            let mut want = expected.clone();
            want["shape"] = shape.into();
            assert_eq!(
                common::as_floats(serde_json::to_value(item.polygonal).unwrap()),
                common::as_floats(want),
                "{geom:?}"
            );
        }
    }
}

#[test]
fn variable_widths_need_their_whole_grammar_or_are_paths() {
    let cases = common::width_cases();
    for case in cases["read"].as_array().unwrap() {
        let geom = case["geom"].as_str().unwrap();
        let source = doc(&format!(
            r#"<path fub:shape="width" fub:geom="{}" d="M0 0 L10 0 L5 5 Z"/>"#,
            geom.replace('\t', "&#9;").replace('\n', "&#10;")
        ));
        let item = at(&load(&source), &[0]).unwrap().clone();
        let expected = &case["varwidth"];
        if expected.is_null() {
            assert_eq!(item.role, Role::Path, "{geom:?}");
            assert_eq!(item.varwidth, None, "{geom:?}");
        } else {
            assert_eq!(item.role, Role::Width, "{geom:?}");
            assert_eq!(
                common::as_floats(serde_json::to_value(item.varwidth).unwrap()),
                common::as_floats(expected.clone()),
                "{geom:?}"
            );
        }
    }
}

#[test]
fn contiguous_foreign_nodes_form_one_block() {
    let source = doc(concat!(
        "\n  <rect width=\"1\"/>",
        "\n  <!-- a -->\n  <use href=\"#x\"/>\n  <?pi x?>\n  <style>s</style>",
        "\n  <circle r=\"1\"/>",
        "\n  <switch/>",
        "\n",
    ));
    let scene = load(&source);
    let blocks = foreign(&scene);
    assert_eq!(blocks.len(), 2);
    assert_eq!(
        text(&source, &blocks[0].span),
        "<!-- a -->\n  <use href=\"#x\"/>\n  <?pi x?>\n  <style>s</style>"
    );
    assert_eq!(blocks[0].elements, [1, 3]);
    assert_eq!(blocks[0].indent, "  ");
    assert_eq!(blocks[0].parent_path.as_deref(), Some(&[][..]));
    assert_eq!(text(&source, &blocks[1].span), "<switch/>");
    assert_eq!(blocks[1].elements, [4, 5]);
    // L'indice di un elemento conta anche gli estranei che lo precedono.
    assert_eq!(role(&scene, &[3]), Some(Role::Circle));
}

#[test]
fn a_block_without_elements_points_at_the_next_element() {
    let source = doc("<rect/><!-- a --><circle r=\"1\"/>");
    let scene = load(&source);
    assert_eq!(foreign(&scene)[0].elements, [1, 1]);
}

#[test]
fn prolog_and_epilog_are_document_blocks() {
    let source = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- prologo -->\n{}\n<!-- epilogo --><?fine?>\n",
        doc("<rect/>")
    );
    let scene = load(&source);
    let blocks = foreign(&scene);
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].parent_path, None);
    assert_eq!(
        text(&source, &blocks[0].span),
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- prologo -->"
    );
    assert_eq!(blocks[0].elements, [0, 0]);
    assert_eq!(blocks[1].parent_path, None);
    assert_eq!(text(&source, &blocks[1].span), "<!-- epilogo --><?fine?>");
    assert_eq!(blocks[1].elements, [1, 1]);
    assert!(matches!(scene.items[1], Item::Root(_)));
}

#[test]
fn cdata_and_entity_references_are_foreign_nodes() {
    let source = concat!(
        r#"<!DOCTYPE svg [<!ENTITY nome "Fub">]>"#,
        r#"<svg xmlns="http://www.w3.org/2000/svg"><g><![CDATA[<x>]]>&nome;<rect/></g>"#,
        "<title>&nome;</title></svg>"
    );
    let scene = load(source);
    let blocks = foreign(&scene);
    assert_eq!(text(source, &blocks[1].span), "<![CDATA[<x>]]>&nome;");
    assert_eq!(blocks[1].parent_path.as_deref(), Some(&[0][..]));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Rect));
    // Un titolo con un'entità non si può riscrivere: è estraneo.
    assert_eq!(role(&scene, &[1]), None);
}

#[test]
fn containers_carry_their_tags_and_items_their_indent() {
    let source = doc("\n  <g id=\"g1\">\n    <a href=\"n.md\">\n\t\t<rect/>\n    </a>\n  </g>\n");
    let scene = load(&source);
    let group = at(&scene, &[0]).unwrap();
    let tags = group.tags.unwrap();
    assert_eq!(text(&source, &tags.open), "<g id=\"g1\">");
    assert_eq!(text(&source, &tags.close.unwrap()), "</g>");
    assert_eq!(group.indent, "  ");
    assert_eq!(group.id.as_deref(), Some("g1"));
    let link = at(&scene, &[0, 0]).unwrap();
    assert_eq!(text(&source, &link.tags.unwrap().open), "<a href=\"n.md\">");
    assert_eq!(link.indent, "    ");
    let rect = at(&scene, &[0, 0, 0]).unwrap();
    assert_eq!(rect.indent, "\t\t");
    assert_eq!(rect.tags, None);
    assert_eq!(rect.id, None);
    // Un elemento che non comincia la riga prende il rientro della riga.
    let source = doc("\n    <rect/><circle r=\"1\"/>");
    assert_eq!(at(&common::load(&source), &[1]).unwrap().indent, "    ");
}

#[test]
fn an_empty_id_makes_the_element_foreign() {
    assert_eq!(first(r#"<rect id=""/>"#), None);
    assert_eq!(first(r#"<rect id="x"/>"#), Some(Role::Rect));
}

#[test]
fn containers_deeper_than_the_limit_are_foreign() {
    let nest = |depth: usize| {
        doc(&format!(
            "{}<rect/>{}",
            "<g>".repeat(depth),
            "</g>".repeat(depth)
        ))
    };
    let source = nest(MAX_DEPTH);
    let scene = load(&source);
    assert!(foreign(&scene).is_empty());
    let deepest = elements(&scene).last().unwrap().path.clone();
    assert_eq!(deepest, vec![0; MAX_DEPTH + 1]);

    // Diecimila livelli: i primi `MAX_DEPTH` sono gruppi, il resto è un
    // blocco solo, e né la lettura né la visita esauriscono lo stack.
    let source = nest(10_000);
    let scene = load(&source);
    assert_eq!(elements(&scene).len(), MAX_DEPTH);
    let block = foreign(&scene)[0];
    assert_eq!(block.parent_path.as_deref(), Some(&[0; MAX_DEPTH][..]));
    assert_eq!(block.elements, [0, 1]);
}

#[test]
fn a_document_beyond_the_element_limit_has_no_items() {
    // Centomila livelli annidati: oltre il limite di elementi, la lettura
    // regge e la scena non costruisce voci.
    let depth = 100_000;
    let source = doc(&format!("{}{}", "<g>".repeat(depth), "</g>".repeat(depth)));
    let scene = load(&source);
    assert_eq!(scene.read_only, [ReadOnly::TooManyElements]);
    assert!(scene.items.is_empty());
}

// Le risorse del disegno (formato della scena, risorse).

/// Il ruolo del primo figlio della `defs` di `doc(<defs>body</defs>)`.
fn resource(body: &str) -> Option<Role> {
    role(&load(&doc(&format!("<defs>{body}</defs>"))), &[0, 0])
}

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

// ---------------------------------------------------------------------------
// Il testo in area e su tracciato (formato della scena, testo).
// ---------------------------------------------------------------------------

const PATH: &str = r#"<path id="r1" fub:role="private" d="M0 50 C30 0 70 0 100 50"/>"#;

/// Il ruolo del primo figlio della radice dopo una `defs` con `defs`.
fn on_path(body: &str, defs: &str) -> Option<Role> {
    role(&load(&doc(&format!("<defs>{defs}</defs>{body}"))), &[1])
}

#[test]
fn a_path_in_a_root_defs_is_the_path_of_a_text_with_id_and_d_only() {
    let scene = load(&doc(&format!(
        r#"<defs>{PATH}<path id="r2" d="M0 0 L10 0"><title>Linea</title></path></defs>"#
    )));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Resource));
    assert_eq!(
        at(&scene, &[0, 0]).unwrap().lifecycle,
        Some(Lifecycle::Private)
    );
    assert_eq!(at(&scene, &[0, 1]).unwrap().title.as_deref(), Some("Linea"));
    for defs in [
        r#"<path d="M0 0 L10 0"/>"#,
        r#"<path id="r1"/>"#,
        r#"<path id="r1" d="M0 0 L"/>"#,
        r#"<path id="r1" d="M0 0 L10 0" transform="scale(2)"/>"#,
        r##"<path id="r1" d="M0 0 L10 0" fill="#000000"/>"##,
        r#"<path id="r1" d="M0 0 L10 0" style="x"/>"#,
        r#"<path id="r1" d="M0 0 L10 0"><rect/></path>"#,
        r#"<path id="r1" d="M0 0 L10 0" xlink:title="x"/>"#,
    ] {
        let scene = load(&doc(&format!("<defs>{defs}</defs>")));
        assert_eq!(role(&scene, &[0, 0]), None, "{defs}");
    }
    // Gli attributi di altri namespace restano; fuori da una defs un path è
    // una forma.
    let scene = load(&doc(
        r#"<defs><path id="r1" d="M0 0 L10 0" fub:nota="x"/></defs>"#,
    ));
    assert_eq!(role(&scene, &[0, 0]), Some(Role::Resource));
    assert_eq!(first(r#"<path id="r1" d="M0 0 L10 0"/>"#), Some(Role::Path));
}

#[test]
fn a_text_follows_a_path_of_the_resources_with_a_text_path() {
    for body in [
        r##"<text><textPath href="#r1">a</textPath></text>"##,
        r##"<text><textPath xlink:href="#r1">a</textPath></text>"##,
        r##"<text text-anchor="middle" font-size="20"><textPath href="#r1" startOffset="50%">a</textPath></text>"##,
        r##"<text><textPath href="#r1" startOffset="-12.5">a</textPath></text>"##,
        r##"<text><textPath href="#r1" startOffset="1cm">a</textPath></text>"##,
        "<text>\n  <title>t</title>\n  <textPath href=\"#r1\">a <tspan font-weight=\"bold\" fill=\"#ff0000\">b</tspan> c</textPath>\n</text>",
        r##"<text><textPath href="#r1"></textPath></text>"##,
        r##"<text><textPath href="#r1" fub:nota="x">a &#x2014; b</textPath></text>"##,
    ] {
        assert_eq!(on_path(body, PATH), Some(Role::Text), "{body}");
    }
    // La defs può venire dopo.
    let scene = load(&doc(&format!(
        r##"<text><textPath href="#r1">a</textPath></text><defs>{PATH}</defs>"##
    )));
    assert_eq!(role(&scene, &[0]), Some(Role::Text));
    for body in [
        // Due riferimenti, nessuno, uno che non è un tracciato o che non c'è.
        r##"<text><textPath href="#r1" xlink:href="#r1">a</textPath></text>"##,
        "<text><textPath>a</textPath></text>",
        r##"<text><textPath href="#r2">a</textPath></text>"##,
        r##"<text><textPath href="#g1">a</textPath></text>"##,
        r#"<text><textPath href="r1">a</textPath></text>"#,
        r##"<text><textPath href="url(#r1)">a</textPath></text>"##,
        // Attributi fuori elenco.
        r##"<text><textPath href="#r1" id="t1">a</textPath></text>"##,
        r##"<text><textPath href="#r1" method="stretch">a</textPath></text>"##,
        r##"<text><textPath href="#r1" spacing="auto">a</textPath></text>"##,
        r##"<text><textPath href="#r1" side="right">a</textPath></text>"##,
        r#"<text><textPath path="M0 0 L10 0">a</textPath></text>"#,
        r##"<text><textPath href="#r1" fill="#000000">a</textPath></text>"##,
        r##"<text><textPath href="#r1" startOffset="auto">a</textPath></text>"##,
        r##"<text><textPath href="#r1" startOffset="1em">a</textPath></text>"##,
        // Il contenuto: dati di carattere e pezzi.
        r##"<text><textPath href="#r1">a<!-- b --></textPath></text>"##,
        r##"<text><textPath href="#r1"><tspan x="0">a</tspan></textPath></text>"##,
        r##"<text><textPath href="#r1"><tspan dy="1">a</tspan></textPath></text>"##,
        r##"<text><textPath href="#r1"><tspan>a<tspan>b</tspan></tspan></textPath></text>"##,
        r##"<text><textPath href="#r1"><title>t</title>a</textPath></text>"##,
        // Le righe o il tracciato, non tutti e due; un tracciato solo; niente
        // x e y.
        r##"<text><tspan>a</tspan><textPath href="#r1">b</textPath></text>"##,
        r##"<text><textPath href="#r1">a</textPath><textPath href="#r1">b</textPath></text>"##,
        r##"<text><textPath href="#r1">a</textPath>b</text>"##,
        r##"<text x="0"><textPath href="#r1">a</textPath></text>"##,
        r##"<text y="0"><textPath href="#r1">a</textPath></text>"##,
        // Un textPath fuori da un testo, o in una riga.
        r##"<textPath href="#r1">a</textPath>"##,
        r##"<text><tspan><textPath href="#r1">a</textPath></tspan></text>"##,
    ] {
        assert_eq!(on_path(body, PATH), None, "{body}");
    }
    assert_eq!(
        on_path(
            r##"<text><textPath href="#g1">a</textPath></text>"##,
            r#"<linearGradient id="g1"/>"#
        ),
        None
    );
}

#[test]
fn a_text_on_a_path_does_not_stand_in_the_content_of_a_resource() {
    let scene = load(&doc(&format!(
        r##"<defs>{PATH}<pattern id="r2" width="10" height="10" patternUnits="userSpaceOnUse"><text><textPath href="#r1">a</textPath></text></pattern></defs>"##
    )));
    assert_eq!(role(&scene, &[0, 1]), None);
}

#[test]
fn the_scene_gives_the_line_of_a_text_on_a_path_and_its_path() {
    let scene = load(&doc(&format!(
        r##"<defs>{PATH}</defs><text><textPath xlink:href="#r1"> a <tspan font-weight="bold">b</tspan>&amp;</textPath></text>"##
    )));
    let item = at(&scene, &[1]).unwrap();
    assert_eq!(item.lines, Some(vec![" a b&".to_owned()]));
    assert_eq!(item.text_path.as_deref(), Some("r1"));
    assert_eq!(item.wrap, None);
    // Un testo su tracciato non va a capo.
    let scene = load(&doc(&format!(
        r##"<defs>{PATH}</defs><text fub:wrap="100"><textPath href="#r1">a</textPath></text>"##
    )));
    assert_eq!(at(&scene, &[1]).unwrap().wrap, None);
}

#[test]
fn an_area_text_gives_the_width_of_its_box() {
    let area = |wrap: &str| {
        let scene = load(&doc(&format!(
            r#"<text fub:wrap="{wrap}" x="10" y="20"><tspan x="10" dy="0">a</tspan><tspan fub:join="space" x="10" dy="24">b</tspan></text>"#
        )));
        at(&scene, &[0]).unwrap().wrap
    };
    assert_eq!(area("320"), Some(320.0));
    assert_eq!(area(" 12.5 "), Some(12.5));
    // Fuori grammatica è un testo da punto, sempre modificabile.
    for wrap in ["0", "-5", "10px", "", "x"] {
        assert_eq!(area(wrap), None, "{wrap}");
    }
    let scene = load(&doc(r#"<text fub:wrap="x"><tspan>a</tspan></text>"#));
    assert_eq!(role(&scene, &[0]), Some(Role::Text));
    assert_eq!(at(&scene, &[0]).unwrap().lines, Some(vec!["a".to_owned()]));
}

#[test]
fn the_index_joins_without_a_space_the_lines_that_continue_a_word() {
    let index = |body: &str| -> Vec<String> {
        load(&doc(body))
            .index
            .texts
            .into_iter()
            .map(|excerpt| excerpt.text)
            .collect()
    };
    assert_eq!(
        index(concat!(
            r#"<text fub:wrap="100"><tspan>Una pa</tspan><tspan fub:join="word">rola</tspan><tspan fub:join="space">e un trat-</tspan>"#,
            r#"<tspan fub:join="word">tino</tspan><tspan>Nuovo</tspan></text>"#
        )),
        ["Una parola e un trat-tino Nuovo"]
    );
    // Fuori da un testo in area, o sulla prima riga, fub:join non vale.
    assert_eq!(
        index(r#"<text><tspan>pa</tspan><tspan fub:join="word">rola</tspan></text>"#),
        ["pa rola"]
    );
    assert_eq!(
        index(r#"<text fub:wrap="100"><tspan fub:join="word">a</tspan><tspan>b</tspan></text>"#),
        ["a b"]
    );
    assert_eq!(
        index(r#"<text fub:wrap="100"><tspan>a</tspan><tspan fub:join="parola">b</tspan></text>"#),
        ["a b"]
    );
    // Un testo su tracciato è una riga.
    assert_eq!(
        index(&format!(
            r##"<defs>{PATH}</defs><text><textPath href="#r1">a <tspan>b</tspan></textPath></text>"##
        )),
        ["a b"]
    );
}

#[test]
fn an_area_text_says_which_lines_continue_a_word() {
    let glued = |body: &str| at(&load(&doc(body)), &[0]).unwrap().glued.clone();
    // Dopo la prima riga, solo `word`; `space`, nessun valore e un valore
    // sconosciuto cominciano o continuano con uno spazio.
    assert_eq!(
        glued(concat!(
            r#"<text fub:wrap="100"><tspan>Una pa</tspan><tspan fub:join="word">rola</tspan><tspan fub:join="space">e un trat-</tspan>"#,
            r#"<tspan fub:join="word">tino</tspan><tspan fub:join="parola">Nuovo</tspan></text>"#
        )),
        Some(vec![false, true, false, true, false])
    );
    // Se nessuna riga lo fa, o fuori da un testo in area, o sulla prima
    // riga, non c'è.
    assert_eq!(
        glued(r#"<text fub:wrap="100"><tspan>a</tspan><tspan fub:join="space">b</tspan></text>"#),
        None
    );
    assert_eq!(
        glued(r#"<text><tspan>pa</tspan><tspan fub:join="word">rola</tspan></text>"#),
        None
    );
    assert_eq!(
        glued(r#"<text fub:wrap="100"><tspan fub:join="word">a</tspan><tspan>b</tspan></text>"#),
        None
    );
}

#[test]
fn the_box_of_a_text_on_a_path_is_that_of_its_path() {
    let scene = load(&doc(
        r##"<defs><path id="r1" d="M10 20 L60 20 L60 70"/></defs><text transform="translate(5 5)"><textPath href="#r1">a</textPath></text>"##,
    ));
    let bbox = scene.summary.bbox.unwrap();
    assert_eq!(
        [bbox.x, bbox.y, bbox.width, bbox.height],
        [15.0, 25.0, 50.0, 50.0]
    );
}

/// Un simbolo `id` con `body` dentro e gli attributi `attrs` in più.
fn symbol(id: &str, body: &str, attrs: &str) -> String {
    format!(r#"<symbol id="{id}" overflow="visible"{attrs}>{body}</symbol>"#)
}

const RECT: &str = r##"<rect width="10" height="10" fill="#000000"/>"##;

/// Il riquadro del riepilogo di `doc(body)`, come `x y w h`.
fn bbox(body: &str) -> Option<[f64; 4]> {
    load(&doc(body))
        .summary
        .bbox
        .map(|b| [b.x, b.y, b.width, b.height])
}

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
