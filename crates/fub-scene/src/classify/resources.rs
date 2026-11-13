//! Le risorse del disegno (formato della scena, risorse): `defs`, sfumature,
//! motivi, ritagli, maschere, filtri e le loro primitive.

use super::*;

// ---------------------------------------------------------------------------
// Le risorse del disegno (formato della scena, risorse).
// ---------------------------------------------------------------------------

/// Quanti punti ha al più una sfumatura (formato della scena, risorse).
pub(crate) const MAX_STOPS: usize = 256;

/// Quante primitive ha al più un filtro, coi `feMergeNode` (formato della
/// scena, risorse).
pub(crate) const MAX_PRIMITIVES: usize = 64;

/// Quanti `g` si annidano al più nel contenuto di una risorsa.
pub(crate) const MAX_CONTENT_DEPTH: usize = 32;

/// Le primitive dei filtri (formato della scena, risorse): un elenco chiuso,
/// quelle di SVG 1.1 che ogni lettore disegna allo stesso modo e l'ombra di
/// Filter Effects.
const PRIMITIVES: [&str; 9] = [
    "feGaussianBlur",
    "feOffset",
    "feFlood",
    "feDropShadow",
    "feColorMatrix",
    "feComposite",
    "feBlend",
    "feMorphology",
    "feMerge",
];

/// Vero se `element` è una `defs` della radice modificabile: solo `id` fra
/// gli attributi SVG.
pub(super) fn defs_allowed(element: &Element<'_>) -> bool {
    element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => attr.local == "id" && !attr.value.is_empty(),
        NS_XLINK | NS_SVG => false,
        _ => true,
    })
}

/// Vero se `value`, una coordinata di una risorsa, rientra nelle sue unità:
/// nel riquadro (`in_box`) un numero o una percentuale, altrimenti una
/// lunghezza.
fn coordinate(value: &str, in_box: bool, non_negative: bool) -> bool {
    let n = if in_box {
        fraction(value)
    } else {
        length(value)
    };
    n.is_some_and(|n| !non_negative || n >= 0.0)
}

/// Le coordinate di ogni risorsa, nelle sue unità.
fn coordinates(tag: Tag) -> &'static [&'static str] {
    match tag {
        Tag::LinearGradient => &["x1", "y1", "x2", "y2"],
        Tag::RadialGradient => &["cx", "cy", "r", "fx", "fy"],
        Tag::Pattern | Tag::Mask | Tag::Filter => &["x", "y", "width", "height"],
        _ => &[],
    }
}

/// Le coordinate che in `userSpaceOnUse` vanno scritte: mancando, SVG le
/// prenderebbe in percentuale del viewport.
fn required(tag: Tag) -> &'static [&'static str] {
    match tag {
        Tag::LinearGradient => &["x2"],
        Tag::RadialGradient => &["cx", "cy", "r"],
        Tag::Mask | Tag::Filter => &["x", "y", "width", "height"],
        _ => &[],
    }
}

/// L'attributo delle unità delle coordinate di ogni risorsa.
fn units(tag: Tag) -> Option<&'static str> {
    match tag {
        Tag::LinearGradient | Tag::RadialGradient => Some("gradientUnits"),
        Tag::Pattern => Some("patternUnits"),
        Tag::Mask => Some("maskUnits"),
        Tag::Filter => Some("filterUnits"),
        _ => None,
    }
}

/// Il giudizio su un attributo SVG senza namespace di una risorsa, con le
/// coordinate nel riquadro se `in_box`.
fn resource_attribute(tag: Tag, name: &str, value: &str, in_box: bool) -> bool {
    use Tag::*;
    if name == "id" {
        return !value.is_empty();
    }
    if coordinates(tag).contains(&name) {
        return coordinate(value, in_box, matches!(name, "r" | "width" | "height"));
    }
    let gradient = matches!(tag, LinearGradient | RadialGradient);
    match name {
        "gradientUnits" | "spreadMethod" => gradient && keyword(name, value),
        "gradientTransform" => gradient && transform(value).is_some(),
        "patternUnits" | "patternContentUnits" => tag == Pattern && keyword(name, value),
        "patternTransform" => tag == Pattern && transform(value).is_some(),
        "viewBox" => matches!(tag, Pattern | Marker) && view_box(value).is_some(),
        "preserveAspectRatio" => matches!(tag, Pattern | Marker) && preserve_aspect_ratio(value),
        "markerUnits" => tag == Marker && keyword(name, value),
        "refX" | "refY" => tag == Marker && length(value).is_some(),
        "markerWidth" | "markerHeight" => tag == Marker && non_negative_length(value).is_some(),
        "orient" => {
            tag == Marker
                && (matches!(trim(value), "auto" | "auto-start-reverse") || angle(value).is_some())
        }
        "clipPathUnits" | "clip-rule" => tag == ClipPath && keyword(name, value),
        "transform" => tag == ClipPath && transform(value).is_some(),
        "maskUnits" | "maskContentUnits" => tag == Mask && keyword(name, value),
        "filterUnits" | "primitiveUnits" | "color-interpolation-filters" => {
            tag == Filter && keyword(name, value)
        }
        _ => false,
    }
}

/// Vero se `element`, una risorsa di tag `tag` in una `defs` della radice, è
/// modificabile: attributi, figli e riferimenti del suo contenuto.
pub(super) fn resource_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    tag: Tag,
    resolve: Resolve<'_>,
) -> bool {
    if element.value(NS_NONE, "id").is_none_or(str::is_empty) {
        return false;
    }
    let in_box = units(tag)
        .and_then(|name| element.value(NS_NONE, name))
        .is_none_or(|units| trim(units) != "userSpaceOnUse");
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => {
            !has_url(&attr.value) && resource_attribute(tag, attr.local, &attr.value, in_box)
        }
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    if !attributes {
        return false;
    }
    // Una sfumatura con uno `stop` o nessuno è un colore pieno, o niente:
    // le sue coordinate non contano, nemmeno quelle del viewport.
    let plain = matches!(tag, Tag::LinearGradient | Tag::RadialGradient)
        && element
            .children
            .iter()
            .filter(|&&child| doc.element(child).is_some_and(|e| e.is_svg("stop")))
            .count()
            <= 1;
    if !in_box
        && !plain
        && required(tag)
            .iter()
            .any(|name| element.value(NS_NONE, name).is_none())
    {
        return false;
    }
    match tag {
        Tag::LinearGradient | Tag::RadialGradient => stops_allowed(doc, element),
        Tag::Filter => primitives_allowed(doc, element),
        _ => {
            // Il contenuto rimanda soltanto alle sfumature: così le risorse
            // non si rimandano in cerchio.
            let gradients = |id: &str| resolve(id).filter(|&kind| kind == ResourceKind::Gradient);
            let clip = tag == Tag::ClipPath;
            element
                .children
                .iter()
                .all(|&child| content_allowed(doc, child, clip, &gradients, 1))
        }
    }
}

/// Vero se `element`, un `path` in una `defs` della radice, è il tracciato di
/// un testo (formato della scena, testo): `id`, `d` e nessun altro attributo
/// SVG, e per figli soltanto `title` e `desc`.
pub(super) fn path_resource_allowed(doc: &Document<'_>, element: &Element<'_>) -> bool {
    if element.value(NS_NONE, "id").is_none_or(str::is_empty)
        || element.value(NS_NONE, "d").is_none()
    {
        return false;
    }
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => attr.local == "id" || (attr.local == "d" && parse_path(&attr.value).is_some()),
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    attributes
        && element
            .children
            .iter()
            .all(|&child| blank_or_meta(doc, child) == Some(true))
}

/// Vero se un nodo è spazio, `title` o `desc` ammessi: i figli che ogni
/// risorsa può avere. `None` per un altro elemento.
pub(super) fn blank_or_meta(doc: &Document<'_>, child: NodeId) -> Option<bool> {
    match &doc.nodes[child].kind {
        Kind::Text { blank, .. } => Some(*blank),
        Kind::Element(_) => {
            let element = doc.element(child).expect("un nodo elemento è un elemento");
            matches!(Tag::of(element), Some(Tag::Title | Tag::Desc))
                .then(|| allowed_part(doc, child, false, &no_resources))
        }
        _ => Some(false),
    }
}

/// Vero se i figli di una sfumatura sono ammessi: `stop`, al più
/// [`MAX_STOPS`], ognuno con `offset`, `stop-color` e `stop-opacity`.
fn stops_allowed(doc: &Document<'_>, element: &Element<'_>) -> bool {
    let mut stops = 0;
    for &child in &element.children {
        if let Some(plain) = blank_or_meta(doc, child) {
            if !plain {
                return false;
            }
            continue;
        }
        let stop = doc.element(child).expect("un nodo elemento è un elemento");
        stops += 1;
        if !stop.is_svg("stop") || stops > MAX_STOPS {
            return false;
        }
        let attributes = stop.attrs.iter().all(|attr| match attr.ns {
            NS_NONE => match attr.local {
                "id" => !attr.value.is_empty(),
                "offset" => fraction(&attr.value).is_some(),
                "stop-color" => paint(&attr.value).is_some_and(|color| color != Paint::None),
                "stop-opacity" => opacity(&attr.value).is_some(),
                _ => false,
            },
            NS_XLINK | NS_SVG => false,
            _ => true,
        });
        let empty = stop
            .children
            .iter()
            .all(|&inner| matches!(doc.nodes[inner].kind, Kind::Text { blank: true, .. }));
        if !attributes || !empty {
            return false;
        }
    }
    true
}

/// Vero se `id`, nel contenuto di una risorsa, è ammesso: spazi, `title`,
/// `desc`, una forma, un testo e, fuori da un ritaglio, un `g` che ne
/// contiene, fino a [`MAX_CONTENT_DEPTH`] livelli.
fn content_allowed(
    doc: &Document<'_>,
    id: NodeId,
    clip: bool,
    resolve: Resolve<'_>,
    depth: usize,
) -> bool {
    if let Some(plain) = blank_or_meta(doc, id) {
        return plain;
    }
    let element = doc.element(id).expect("un nodo elemento è un elemento");
    let Some(tag) = Tag::of(element) else {
        return false;
    };
    if tag.is_shape() || tag == Tag::Text {
        return attributes_allowed(element, tag, resolve, clip)
            && unit_children_allowed(doc, element, tag, resolve);
    }
    if tag != Tag::G || clip || depth > MAX_CONTENT_DEPTH {
        return false;
    }
    attributes_allowed(element, tag, resolve, false)
        && element
            .children
            .iter()
            .all(|&child| content_allowed(doc, child, clip, resolve, depth + 1))
}

/// Vero se `value`, un `result`, è un nome senza spazi.
fn result_name(value: &str) -> bool {
    !value.is_empty() && !value.bytes().any(is_wsp)
}

/// Quanti numeri vuole `values` per ogni tipo di `feColorMatrix`.
fn matrix_values(kind: &str) -> Option<usize> {
    match kind {
        "matrix" => Some(20),
        "saturate" | "hueRotate" => Some(1),
        "luminanceToAlpha" => Some(0),
        _ => None,
    }
}

/// Il giudizio su un attributo senza namespace della primitiva `local`;
/// `input` dice se un ingresso è ammesso.
fn primitive_attribute(local: &str, name: &str, value: &str, input: &dyn Fn(&str) -> bool) -> bool {
    let shadow = local == "feDropShadow";
    match name {
        "id" => !value.is_empty(),
        "result" => local != "feMergeNode" && result_name(value),
        "color-interpolation-filters" => local != "feMergeNode" && keyword(name, value),
        "x" | "y" => local != "feMergeNode" && length(value).is_some(),
        "width" | "height" => local != "feMergeNode" && non_negative_length(value).is_some(),
        "in" => local != "feFlood" && local != "feMerge" && input(value),
        "in2" => matches!(local, "feComposite" | "feBlend") && input(value),
        "stdDeviation" => (local == "feGaussianBlur" || shadow) && one_or_two(value).is_some(),
        "dx" | "dy" => (local == "feOffset" || shadow) && number(value).is_some(),
        "flood-color" => {
            (local == "feFlood" || shadow) && paint(value).is_some_and(|color| color != Paint::None)
        }
        "flood-opacity" => (local == "feFlood" || shadow) && opacity(value).is_some(),
        "type" => local == "feColorMatrix" && matrix_values(value).is_some(),
        // Il numero lo controlla chi conosce il tipo.
        "values" => local == "feColorMatrix" && number_list(value).is_some(),
        "operator" => match local {
            "feComposite" => matches!(value, "over" | "in" | "out" | "atop" | "xor" | "arithmetic"),
            "feMorphology" => matches!(value, "erode" | "dilate"),
            _ => false,
        },
        "k1" | "k2" | "k3" | "k4" => local == "feComposite" && number(value).is_some(),
        "mode" => {
            local == "feBlend"
                && matches!(
                    value,
                    "normal" | "multiply" | "screen" | "darken" | "lighten"
                )
        }
        "radius" => local == "feMorphology" && one_or_two(value).is_some(),
        _ => false,
    }
}

/// Vero se la primitiva `element` è ammessa, con gli ingressi che rimandano
/// a `results`, i nomi delle primitive che la precedono.
fn primitive_allowed(doc: &Document<'_>, element: &Element<'_>, results: &HashSet<&str>) -> bool {
    let input =
        |value: &str| value == "SourceGraphic" || value == "SourceAlpha" || results.contains(value);
    let local = element.local;
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => {
            !has_url(&attr.value) && primitive_attribute(local, attr.local, &attr.value, &input)
        }
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    if !attributes {
        return false;
    }
    if matches!(local, "feComposite" | "feBlend") && element.value(NS_NONE, "in2").is_none() {
        return false;
    }
    if local == "feColorMatrix" {
        let kind = element.value(NS_NONE, "type").unwrap_or("matrix");
        let wanted = matrix_values(kind).expect("il tipo è già controllato");
        if let Some(values) = element.value(NS_NONE, "values") {
            let numbers = number_list(values).expect("i valori sono già controllati");
            if numbers.len() != wanted || (kind == "saturate" && numbers[0] < 0.0) {
                return false;
            }
        }
    }
    element
        .children
        .iter()
        .all(|&child| match &doc.nodes[child].kind {
            Kind::Text { blank, .. } => *blank,
            Kind::Element(_) => {
                let node = doc.element(child).expect("un nodo elemento è un elemento");
                local == "feMerge"
                    && node.is_svg("feMergeNode")
                    && primitive_allowed(doc, node, results)
            }
            _ => false,
        })
}

/// Vero se i figli di un filtro sono ammessi: primitive dell'elenco, al più
/// [`MAX_PRIMITIVES`] coi `feMergeNode`, ognuna con ingressi che vengono
/// prima.
fn primitives_allowed(doc: &Document<'_>, element: &Element<'_>) -> bool {
    let mut results = HashSet::new();
    let mut count = 0;
    for &child in &element.children {
        if let Some(plain) = blank_or_meta(doc, child) {
            if !plain {
                return false;
            }
            continue;
        }
        let primitive = doc.element(child).expect("un nodo elemento è un elemento");
        if primitive.ns != NS_SVG || !PRIMITIVES.contains(&primitive.local) {
            return false;
        }
        count += 1 + primitive
            .children
            .iter()
            .filter(|&&inner| doc.element(inner).is_some())
            .count();
        if count > MAX_PRIMITIVES || !primitive_allowed(doc, primitive, &results) {
            return false;
        }
        if let Some(result) = primitive.value(NS_NONE, "result") {
            results.insert(result);
        }
    }
    true
}
