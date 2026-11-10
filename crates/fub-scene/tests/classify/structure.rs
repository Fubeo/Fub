//! La struttura del documento: gruppi e altri elementi, radice, livelli, fogli,
//! forme del tratto, blocchi estranei, contenitori e limiti.

use super::*;

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
