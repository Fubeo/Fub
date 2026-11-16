use super::{Affine, Arc, BezPath, BlendMode, Color, FillRule, GradientStop, HashMap, Node, Point, XNode, roxmltree, shapes};

/// `n` with every object id (its descendants' and its mask art's too) zeroed, to compare art.
pub(super) fn without_ids(n: &Node) -> Node {
    let mut n = n.clone();
    n.id = vectorcraft_doc::NodeId(0);
    if let Some(m) = n.extras_if_any().and_then(|e| e.mask.as_deref_mut()) {
        m.art = Arc::new(without_ids(&m.art));
    }
    for c in n.children_mut().into_iter().flatten() {
        *c = Arc::new(without_ids(c));
    }
    n
}

/// `base`, or `base 2`, `base 3`… : the first that isn't `taken`.
pub(super) fn unique_name(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut name = base.to_string();
    let mut k = 2;
    while taken(&name) {
        name = format!("{base} {k}");
        k += 1;
    }
    name
}

/// The stops our export added for midpoints (`data-vc-midpoint`), by gradient id: for each stop,
/// the midpoint it stands for.
pub(super) fn midpoint_stops(xml: &roxmltree::Document) -> HashMap<String, Vec<Option<f32>>> {
    xml.descendants()
        .filter(|n| matches!(n.tag_name().name(), "linearGradient" | "radialGradient"))
        .filter_map(|g| {
            let id = g.attribute("id")?;
            let marks: Vec<Option<f32>> = g
                .children()
                .filter(|c| c.tag_name().name() == "stop")
                .map(|c| c.attribute("data-vc-midpoint").and_then(|v| v.parse().ok()))
                .collect();
            marks.iter().any(Option::is_some).then(|| (id.to_string(), marks))
        })
        .collect()
}

/// A gradient's stops, with the midpoint stops `marks` names folded back into the midpoints of
/// the stops before them.
pub(super) fn gradient_stops(g: &usvg::BaseGradient, marks: Option<&[Option<f32>]>) -> Vec<GradientStop> {
    let marks = marks.filter(|m| m.len() == g.stops().len());
    let mut out: Vec<GradientStop> = Vec::with_capacity(g.stops().len());
    for (i, s) in g.stops().iter().enumerate() {
        if let (Some(mid), Some(prev)) = (marks.and_then(|m| m.get(i).copied().flatten()), out.last_mut()) {
            prev.midpoint = mid.clamp(0.0, 1.0);
            continue;
        }
        let c = s.color();
        out.push(GradientStop { opacity: s.opacity().get(), ..GradientStop::new(s.offset().get(), Color::rgb8(c.red, c.green, c.blue)) });
    }
    out
}

/// The options [`crate::export::MASK_FLAGS`] records on exported `<mask>` elements, by mask id:
/// (clip, invert).
pub(super) fn mask_flags(xml: &roxmltree::Document) -> HashMap<String, (bool, bool)> {
    let attr = crate::export::MASK_FLAGS;
    if !xml.input_text().contains(attr) {
        return HashMap::new();
    }
    let flags = |n: roxmltree::Node| {
        let has = |f: &str| n.attribute(attr).is_some_and(|v| v.split_whitespace().any(|x| x == f));
        Some((n.attribute("id")?.to_string(), (!has("noclip"), has("invert"))))
    };
    xml.descendants().filter(|n| n.tag_name().name() == "mask" && n.has_attribute(attr)).filter_map(flags).collect()
}

/// Prefix of the ids [`prepass`] gives the elements it has to find again that have none.
pub(super) const MADE_UP_ID: &str = "vectorcraft-id-";

/// Is `id` one [`prepass`] made up (not a name)?
pub(super) fn made_up(id: &str) -> bool {
    id.starts_with(MADE_UP_ID)
}

/// The URL an `<a>` element links to.
pub(crate) fn href<'a>(a: XNode<'a, '_>) -> Option<&'a str> {
    a.attribute("href").or_else(|| a.attribute(("http://www.w3.org/1999/xlink", "href"))).filter(|h| !h.is_empty())
}

pub(super) fn aff(t: usvg::Transform) -> Affine {
    Affine::new([t.sx as f64, t.ky as f64, t.kx as f64, t.sy as f64, t.tx as f64, t.ty as f64])
}

pub(super) fn is_plain(g: &usvg::Group) -> bool {
    g.clip_path().is_none() && only_clips(g)
}

/// Does group `g` leave its art as it is, but for a clip path (no mask, filter, opacity or blend)?
pub(super) fn only_clips(g: &usvg::Group) -> bool {
    g.mask().is_none() && g.filters().is_empty() && g.opacity().get() >= 1.0 && g.blend_mode() == usvg::BlendMode::Normal
}

pub(super) fn blend(b: usvg::BlendMode) -> BlendMode {
    use usvg::BlendMode as B;
    match b {
        B::Normal => BlendMode::Normal,
        B::Multiply => BlendMode::Multiply,
        B::Screen => BlendMode::Screen,
        B::Overlay => BlendMode::Overlay,
        B::Darken => BlendMode::Darken,
        B::Lighten => BlendMode::Lighten,
        B::ColorDodge => BlendMode::ColorDodge,
        B::ColorBurn => BlendMode::ColorBurn,
        B::HardLight => BlendMode::HardLight,
        B::SoftLight => BlendMode::SoftLight,
        B::Difference => BlendMode::Difference,
        B::Exclusion => BlendMode::Exclusion,
        B::Hue => BlendMode::Hue,
        B::Saturation => BlendMode::Saturation,
        B::Color => BlendMode::Color,
        B::Luminosity => BlendMode::Luminosity,
    }
}

pub(super) fn bezpath(p: &usvg::tiny_skia_path::Path, m: Affine) -> BezPath {
    use usvg::tiny_skia_path::PathSegment as S;
    if let Some(e) = usvg_ellipse(p) {
        return m * e;
    }
    let pt = |p: usvg::tiny_skia_path::Point| m * Point::new(p.x as f64, p.y as f64);
    let mut bp = BezPath::new();
    for s in p.segments() {
        match s {
            S::MoveTo(p) => bp.move_to(pt(p)),
            S::LineTo(p) => bp.line_to(pt(p)),
            S::QuadTo(a, p) => bp.quad_to(pt(a), pt(p)),
            S::CubicTo(a, b, p) => bp.curve_to(pt(a), pt(b), pt(p)),
            S::Close => bp.close_path(),
        }
    }
    bp
}

/// Patch di Fub (`0004-ellissi-importate`, issue #407): `p` is the path usvg makes of a
/// `<circle>` or an `<ellipse>` (or of a `<path>` drawing the same four arcs), as the standard
/// ellipse ([`shapes::ellipse`]: four smooth anchors, each quarter one cubic with handles
/// [`shapes::KAPPA`] of the radii long), starting where SVG starts it, at 3 o'clock, and running
/// the same way. usvg cuts each quarter into one cubic or more in `f32` (more as soon as `f32`
/// rounding makes the quarter a hair longer than a right angle, and the anchors at 12 and 6 o'clock
/// read back as corners), so without this an ellipse the export wrote as `<ellipse>` came back as
/// another curve: the same within 0.03% of its radii, but the renderer flattens each with its own
/// chords (0.25 px), and on a narrow ellipse, whose ends bend tighter than half a pixel, the two
/// differ along the whole edge near the ends.
///
/// Recognised by shape, not by how usvg counts: cubics whose ends lie on the ellipse that their
/// bounds give, going once round it from 3 o'clock, clockwise on screen, at most a quarter turn
/// each, each with the handles of the standard cubic arc of its span (`4/3·tan(span/4)` of the
/// radii, along the tangent), within `f32` rounding. Any other path keeps its own segments.
fn usvg_ellipse(p: &usvg::tiny_skia_path::Path) -> Option<BezPath> {
    use std::f64::consts::{FRAC_PI_2, TAU};
    use usvg::tiny_skia_path::PathSegment as S;
    let segments: Vec<S> = p.segments().collect();
    let [S::MoveTo(start), body @ .., S::Close] = segments.as_slice() else { return None };
    let pt = |p: &usvg::tiny_skia_path::Point| Point::new(f64::from(p.x), f64::from(p.y));
    let mut cubics = Vec::with_capacity(body.len());
    for s in body {
        let S::CubicTo(a, b, e) = s else { return None };
        cubics.push([pt(a), pt(b), pt(e)]);
    }
    if cubics.len() < 4 {
        return None;
    }
    let ends = || std::iter::once(pt(start)).chain(cubics.iter().map(|c| c[2]));
    let (x0, x1) = ends().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), e| (a.min(e.x), b.max(e.x)));
    let (y0, y1) = ends().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), e| (a.min(e.y), b.max(e.y)));
    let (c, rx, ry) = (Point::new((x0 + x1) / 2.0, (y0 + y1) / 2.0), (x1 - x0) / 2.0, (y1 - y0) / 2.0);
    if !(rx > 0.0 && ry > 0.0 && rx.is_finite() && ry.is_finite()) {
        return None;
    }
    // A few dozen f32 steps of the largest coordinate: usvg's arithmetic in f32, and kurbo's
    // re-derived centre and radii.
    let tol = (c.x.abs() + rx).max(c.y.abs() + ry).max(1.0) * f64::from(f32::EPSILON) * 32.0;
    let on = |t: f64| Point::new(c.x + rx * t.cos(), c.y + ry * t.sin());
    // The tangent at `t`, as long as the handle of a standard arc spanning `span`.
    let arm = |t: f64, span: f64| kurbo::Vec2::new(-rx * t.sin(), ry * t.cos()) * (4.0 / 3.0 * (span / 4.0).tan());
    let angle = |p: Point| ((p.y - c.y) / ry).atan2((p.x - c.x) / rx).rem_euclid(TAU);
    if pt(start).distance(on(0.0)) > tol {
        return None;
    }
    let last = cubics.len() - 1;
    let mut t0 = 0.0;
    for (i, [a, b, e]) in cubics.iter().enumerate() {
        // The end of the last cubic is the start again: a whole turn.
        let t1 = if i == last { TAU } else { angle(*e) };
        let span = t1 - t0;
        if !(span > 0.0 && span <= FRAC_PI_2 + 1e-3)
            || e.distance(on(t1)) > tol
            || a.distance(on(t0) + arm(t0, span)) > tol
            || b.distance(on(t1) - arm(t1, span)) > tol
        {
            return None;
        }
        t0 = t1;
    }
    let mut e = shapes::ellipse(vectorcraft_geom::Rect::new(x0, y0, x1, y1));
    // `shapes::ellipse` starts at 9 o'clock; SVG at 3, two anchors on, the same way round.
    e.subpaths[0].anchors.rotate_left(2);
    Some(e.to_bezpath())
}

/// The shapes of clip path `cp` on an element whose user space `ts` maps to the document.
pub(super) fn clip_shapes(cp: &usvg::ClipPath, ts: Affine) -> Vec<(BezPath, FillRule)> {
    fn collect(g: &usvg::Group, m: Affine, out: &mut Vec<(BezPath, FillRule)>) {
        for c in g.children() {
            match c {
                usvg::Node::Group(g) => collect(g, m * aff(g.transform()), out),
                usvg::Node::Path(p) => out.push((bezpath(p.data(), m), p.fill().map(|f| rule(f.rule())).unwrap_or_default())),
                _ => {}
            }
        }
    }
    let mut shapes = Vec::new();
    collect(cp.root(), ts * aff(cp.transform()), &mut shapes);
    shapes
}

/// Does clip path `cp` (on an element whose user space `ts` maps to the document) leave `art`,
/// placed by `xf`, whole? (Only its bounds are checked: the box must be inside a clip shape.)
pub(super) fn uncut(cp: &usvg::ClipPath, ts: Affine, art: &Node, xf: Affine) -> bool {
    let Some(b) = art.visual_bounds() else { return false };
    if cp.clip_path().is_some() {
        return false;
    }
    // Art touching the clip's edge isn't cut by it.
    let e = 1e-6 * (b.width() + b.height()).max(1e-9);
    let b = b.inflate(-e, -e);
    let shapes = clip_shapes(cp, ts);
    let corners = [Point::new(b.x0, b.y0), Point::new(b.x1, b.y0), Point::new(b.x1, b.y1), Point::new(b.x0, b.y1)];
    corners.iter().all(|c| shapes.iter().any(|(s, _)| kurbo::Shape::contains(s, xf * *c)))
}

pub(super) fn rule(r: usvg::FillRule) -> FillRule {
    match r {
        usvg::FillRule::NonZero => FillRule::NonZero,
        usvg::FillRule::EvenOdd => FillRule::EvenOdd,
    }
}
