//! La regola di classificazione del formato della scena (§4), una regola alla
//! volta, nei due versi: che cosa resta modificabile e che cosa diventa
//! estraneo.

mod common;

use common::{at, doc, elements, first, foreign, load, role, text};
use fub_scene::{Item, ReadOnly, Role, Tool, MAX_DEPTH};

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
        "<defs></defs>",
        "<style>rect{}</style>",
        "<script>alert(1)</script>",
        "<foreignObject></foreignObject>",
        "<symbol></symbol>",
        "<switch></switch>",
        "<svg></svg>",
        "<linearGradient></linearGradient>",
        "<clipPath></clipPath>",
        "<metadata></metadata>",
        "<tspan>fuori da un testo</tspan>",
        "<marker></marker>",
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
        r#"filter="none""#,
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
fn a_value_with_url_makes_the_element_foreign() {
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
        "\n  <defs/>",
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
    assert_eq!(text(&source, &blocks[1].span), "<defs/>");
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
