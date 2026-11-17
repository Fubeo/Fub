//! SVG export/import properties: never panics, always re-imports, and plain art survives the round
//! trip visually (render comparison with a perceptual tolerance).

use proptest::prelude::*;
use vectorcraft_color::{Color, Paint};
use vectorcraft_doc::Appearance;
use vectorcraft_geom::{PathData, Rect, shapes};
use vectorcraft_svg::{ExportOptions, ObjectIds, Styling, export, import};
use vectorcraft_testkit::fixtures::{self, DocBuilder, art_nodes};
use vectorcraft_testkit::invariants::check_document;
use vectorcraft_testkit::raster::{assert_similar, render_artboard};
use vectorcraft_testkit::strategies::{arb_closed_shape, arb_ops, arb_path_data};

fn all_options() -> Vec<ExportOptions> {
    let mut v = vec![];
    for styling in [Styling::PresentationAttributes, Styling::InlineStyle, Styling::StyleEntities, Styling::InternalCss] {
        for (minify, decimals, object_ids, responsive) in
            [(false, 3, ObjectIds::LayerNames, false), (true, 1, ObjectIds::Minimal, true), (false, 7, ObjectIds::Unique, true)]
        {
            v.push(ExportOptions { artboard: Some(0), styling, decimals, object_ids, minify, responsive, ..Default::default() });
        }
    }
    v.push(ExportOptions { artboard: None, ..Default::default() });
    v
}

fn arb_color() -> impl Strategy<Value = Color> {
    (0u8..=255, 0u8..=255, 0u8..=255).prop_map(|(r, g, b)| Color::rgb8(r, g, b))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, failure_persistence: None, ..ProptestConfig::default() })]

    /// Documents from random editing export (all option combos) and re-import to valid documents.
    #[test]
    fn random_documents_export_and_reimport(ops in arb_ops(5..40)) {
        let mut s = fixtures::session();
        for op in &ops {
            let _ = op.apply(&mut s);
        }
        let d = s.doc().unwrap().doc.clone();
        for o in all_options() {
            let svg = export(&d, &o);
            let back = import(&svg).map_err(|e| TestCaseError::fail(format!("{o:?}: {e}\n{svg}")))?;
            check_document(&back).map_err(TestCaseError::fail)?;
        }
    }

    /// Solid-filled shapes look the same after export → import.
    #[test]
    fn plain_art_survives_visually(shapes_ in prop::collection::vec((arb_closed_shape(), arb_color(), 0.2f32..1.0), 1..6)) {
        let mut b = DocBuilder::new(200.0, 200.0);
        for (p, c, o) in &shapes_ {
            b.path(p.clone(), Appearance::basic(Paint::solid(*c), Paint::None, 0.0), |n| n.opacity = *o);
        }
        let d = b.build();
        let back = import(&export(&d, &ExportOptions::default())).unwrap();
        assert_similar(&render_artboard(&d), &render_artboard(&back), 6.0, 0.002);
    }

    /// Path geometry survives within the export precision.
    #[test]
    fn path_bounds_survive(p in arb_path_data(), decimals in 2u8..6) {
        let mut b = DocBuilder::new(200.0, 200.0);
        b.path(p.clone(), Appearance::basic(Paint::None, Paint::solid(Color::BLACK), 1.0), |_| {});
        let d = b.build();
        let back = import(&export(&d, &ExportOptions { decimals, ..Default::default() })).unwrap();
        let nodes = art_nodes(&back);
        let paths: Vec<&PathData> = nodes.iter().filter_map(|n| n.path_data()).collect();
        prop_assert!(!paths.is_empty(), "no path back");
        // Multi-subpath paths may come back split into several objects; compare the union.
        let bb = paths.iter().filter_map(|q| q.bounds()).reduce(|x, y| x.union(y)).unwrap();
        let a = p.bounds().unwrap();
        let eps = 2.0 * 10f64.powi(-(decimals as i32));
        prop_assert!((a.x0 - bb.x0).abs() <= eps && (a.y0 - bb.y0).abs() <= eps && (a.x1 - bb.x1).abs() <= eps && (a.y1 - bb.y1).abs() <= eps, "{a:?} vs {bb:?}");
    }

    /// Importing arbitrary text never panics.
    #[test]
    fn import_garbage_never_panics(s in ".{0,200}") {
        let _ = import(&s);
        let _ = import(&format!("<svg xmlns=\"http://www.w3.org/2000/svg\">{s}</svg>"));
    }

    /// Importing random path data never panics and gives a valid document.
    #[test]
    fn import_random_path_data(d in "[MLCQZHVAmlcqzhva0-9 .,eE+-]{0,80}") {
        let svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><path d=\"{d}\"/></svg>");
        if let Ok(doc) = import(&svg) {
            check_document(&doc).map_err(TestCaseError::fail)?;
        }
    }
}

#[test]
fn rich_fixture_exports_with_all_options() {
    let s = fixtures::rich_session();
    let d = s.doc().unwrap().doc.clone();
    for o in all_options() {
        let svg = export(&d, &o);
        let back = import(&svg).unwrap_or_else(|e| panic!("{o:?}: {e}"));
        check_document(&back).unwrap();
        if o.minify {
            assert!(!svg.contains("\n  "), "minified output is indented");
        }
    }
}

#[test]
fn rect_survives_visually_with_stroke() {
    let mut b = DocBuilder::new(100.0, 100.0);
    b.path(
        shapes::rectangle(Rect::new(20.0, 20.0, 80.0, 70.0)),
        Appearance::basic(Paint::solid(Color::rgb8(30, 120, 200)), Paint::solid(Color::BLACK), 3.0),
        |_| {},
    );
    let d = b.build();
    let back = import(&export(&d, &ExportOptions::default())).unwrap();
    assert_similar(&render_artboard(&d), &render_artboard(&back), 4.0, 0.001);
}

/// Patch di Fub (`0004`, issue #407): il caso minimo che `plain_art_survives_visually` ha trovato
/// in CI. Un'ellisse stretta di quattro ancore `Smooth`, nera, con un'opacità quasi piena.
#[test]
fn narrow_ellipse_with_almost_full_opacity_survives_visually() {
    use vectorcraft_geom::{Anchor, AnchorKind, Point, SubPath};
    let a = |p: (f64, f64), i: (f64, f64), o: (f64, f64)| Anchor {
        p: Point::new(p.0, p.1),
        h_in: Point::new(i.0, i.1),
        h_out: Point::new(o.0, o.1),
        kind: AnchorKind::Smooth,
    };
    let anchors = vec![
        a((103.89344726137028, 38.45078087901094), (103.89344726137028, 59.68656077757416), (103.89344726137028, 17.215000980447723)),
        a((108.1798637814197, 0.0), (105.81254130597362, 0.0), (110.54718625686577, 0.0)),
        a((112.46628030146911, 38.45078087901094), (112.46628030146911, 17.215000980447723), (112.46628030146911, 59.68656077757416)),
        a((108.1798637814197, 76.90156175802188), (110.54718625686577, 76.90156175802188), (105.81254130597362, 76.90156175802188)),
    ];
    let mut b = DocBuilder::new(200.0, 200.0);
    b.path(PathData::single(SubPath::new(anchors, true)), Appearance::basic(Paint::solid(Color::BLACK), Paint::None, 0.0), |n| n.opacity = 0.9908846);
    let d = b.build();
    let svg = export(&d, &ExportOptions::default());
    let back = import(&svg).unwrap();
    assert_similar(&render_artboard(&d), &render_artboard(&back), 6.0, 0.002);
}

/// Patch di Fub (`0004`, issue #407): `<circle>` and `<ellipse>`, rotated too, come back as the
/// standard ellipse (four smooth anchors, handles [`shapes::KAPPA`] of the radii long) starting at
/// 3 o'clock, where SVG starts them; a closed path of four cubics that isn't one keeps its anchors.
#[test]
fn imported_circles_and_ellipses_are_the_standard_ellipse() {
    use vectorcraft_geom::{Affine, AnchorKind, Point};
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <ellipse cx="108.18" cy="38.451" rx="4.286" ry="38.451"/>
        <circle cx="50" cy="150" r="40"/>
        <ellipse cx="1000.5" cy="20" rx="900.25" ry="3.5"/>
        <ellipse cx="100" cy="100" rx="90" ry="3" transform="rotate(30 100 100)"/>
        <path d="M 30 0 C 30 30 30 30 0 30 C -30 30 -30 30 -30 0 C -30 -30 -30 -30 0 -30 C 30 -30 30 -30 30 0 Z"/>
    </svg>"#;
    let back = import(svg).unwrap();
    let paths: Vec<&PathData> = art_nodes(&back).into_iter().filter_map(|n| n.path_data()).collect();
    assert_eq!(paths.len(), 5);
    let rotate = Affine::rotate_about(30f64.to_radians(), Point::new(100.0, 100.0));
    for (i, (cx, cy, rx, ry, m)) in [
        (108.18, 38.451, 4.286, 38.451, Affine::IDENTITY),
        (50.0, 150.0, 40.0, 40.0, Affine::IDENTITY),
        (1000.5, 20.0, 900.25, 3.5, Affine::IDENTITY),
        (100.0, 100.0, 90.0, 3.0, rotate),
    ]
    .into_iter()
    .enumerate()
    {
        let mut want = shapes::ellipse(Rect::new(cx - rx, cy - ry, cx + rx, cy + ry));
        want.subpaths[0].anchors.rotate_left(2);
        let (got, want) = (&paths[i].subpaths, &want.subpaths[0].anchors);
        assert_eq!(got.len(), 1, "ellipse {i}");
        assert!(got[0].closed, "ellipse {i}");
        assert_eq!(got[0].anchors.len(), 4, "ellipse {i}: {:?}", got[0].anchors);
        for (g, w) in got[0].anchors.iter().zip(want) {
            assert_eq!(g.kind, AnchorKind::Smooth, "ellipse {i}");
            for (g, w) in [(g.p, w.p), (g.h_in, w.h_in), (g.h_out, w.h_out)] {
                assert!(g.distance(m * w) < 1e-3, "ellipse {i}: {g:?} != {:?}", m * w);
            }
        }
    }
    // A rounded square drawn with four cubics: its handles aren't an ellipse's.
    let square = &paths[4].subpaths[0].anchors;
    assert_eq!(square.len(), 4);
    assert_eq!(square[0].h_out, Point::new(30.0, 30.0));
}
