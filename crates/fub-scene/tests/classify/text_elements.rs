//! Il testo: tspan, righe, titoli e descrizioni, gli spazi tra gli elementi,
//! e il testo in area e su tracciato.

use super::*;

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
