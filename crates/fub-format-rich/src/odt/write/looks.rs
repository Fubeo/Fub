//! L'enfasi e la disposizione: l'aspetto voluto rispetto a quello mostrato,
//! le proprietà di testo di uno stile automatico e i cambiamenti di paragrafo.

use std::collections::BTreeSet;

use crate::odt::styles::{self as odt_styles, ParaChange, Position, Size, TextProps};
use crate::odt::xml;
use crate::projection::{self, Line, Look, Mark};

use super::markup::{attr, set_attr};

/// L'aspetto voluto, senza i valori che sono già quelli di `plain`, il testo
/// del paragrafo senza involucri: due forme dello stesso aspetto diventano una.
pub(super) fn relative(look: &Look, plain: &TextProps) -> Look {
    let plain_color = plain
        .color
        .clone()
        .unwrap_or_else(|| projection::COLOR_AUTO.into());
    Look {
        font: look
            .font
            .clone()
            .filter(|font| Some(font) != plain.font.as_ref()),
        size: look.size.filter(|size| {
            !plain
                .points()
                .is_some_and(|p| projection::same_size(*size, p))
        }),
        color: look.color.clone().filter(|color| *color != plain_color),
        hl: look
            .hl
            .clone()
            .filter(|hl| hl != projection::HIGHLIGHT_DEFAULT),
    }
}

/// Le proprietà che portano il testo da `shown` all'enfasi `want` e
/// all'aspetto `look`, relativo a `plain`.
pub(super) fn diff(
    want: &BTreeSet<Mark>,
    look: &Look,
    plain: &TextProps,
    shown: &TextProps,
) -> TextProps {
    let mut out = diff_marks(want, &shown.marks().into_iter().collect());
    let target = look.clone();
    let font = target.font.or_else(|| plain.font.clone());
    if font.is_some() && font != shown.font {
        out.font = font;
    }
    let size = target.size.or_else(|| plain.points());
    if let Some(size) = size {
        if !shown
            .points()
            .is_some_and(|p| projection::same_size(p, size))
        {
            out.size = Some(Size::Points(size));
        }
    }
    let color_of = |p: &TextProps| {
        p.color
            .clone()
            .unwrap_or_else(|| projection::COLOR_AUTO.into())
    };
    let color = target.color.unwrap_or_else(|| color_of(plain));
    if color != color_of(shown) {
        out.color = Some(color);
    }
    if want.contains(&Mark::H) {
        let hl = target
            .hl
            .unwrap_or_else(|| projection::HIGHLIGHT_DEFAULT.into());
        if shown.highlight != Some(true) || shown.background.as_deref() != Some(hl.as_str()) {
            out.highlight = Some(true);
            out.background = Some(hl);
        }
    }
    out
}

fn diff_marks(want: &BTreeSet<Mark>, shown: &BTreeSet<Mark>) -> TextProps {
    let flip =
        |mark: Mark| (want.contains(&mark) != shown.contains(&mark)).then(|| want.contains(&mark));
    let position = [Mark::Sup, Mark::Sub]
        .iter()
        .any(|m| want.contains(m) != shown.contains(m))
        .then(|| {
            if want.contains(&Mark::Sup) {
                Position::Super
            } else if want.contains(&Mark::Sub) {
                Position::Sub
            } else {
                Position::Baseline
            }
        });
    TextProps {
        bold: flip(Mark::B),
        italic: flip(Mark::I),
        underline: flip(Mark::U),
        strike: flip(Mark::S),
        highlight: flip(Mark::H),
        position,
        caps: flip(Mark::Caps),
        small_caps: flip(Mark::SmallCaps),
        ..TextProps::default()
    }
}

pub(super) fn text_properties(props: &TextProps) -> String {
    let mut attrs: Vec<(String, String)> = Vec::new();
    let mut add = |k: &str, v: &str| attrs.push((k.to_string(), v.to_string()));
    if let Some(on) = props.bold {
        let v = if on { "bold" } else { "normal" };
        add("fo:font-weight", v);
        add("style:font-weight-asian", v);
        add("style:font-weight-complex", v);
    }
    if let Some(on) = props.italic {
        let v = if on { "italic" } else { "normal" };
        add("fo:font-style", v);
        add("style:font-style-asian", v);
        add("style:font-style-complex", v);
    }
    match props.underline {
        Some(true) => {
            add("style:text-underline-style", "solid");
            add("style:text-underline-width", "auto");
            add("style:text-underline-color", "font-color");
        }
        Some(false) => add("style:text-underline-style", "none"),
        None => {}
    }
    match props.strike {
        Some(true) => {
            add("style:text-line-through-style", "solid");
            add("style:text-line-through-type", "single");
        }
        Some(false) => add("style:text-line-through-style", "none"),
        None => {}
    }
    match props.highlight {
        Some(true) => add(
            "fo:background-color",
            props
                .background
                .as_deref()
                .unwrap_or(projection::HIGHLIGHT_DEFAULT),
        ),
        Some(false) => add("fo:background-color", "transparent"),
        None => {}
    }
    match props.position {
        Some(Position::Super) => add("style:text-position", "super 58%"),
        Some(Position::Sub) => add("style:text-position", "sub 58%"),
        Some(Position::Baseline) => add("style:text-position", "0% 100%"),
        None => {}
    }
    if let Some(on) = props.caps {
        add("fo:text-transform", if on { "uppercase" } else { "none" });
    }
    if let Some(on) = props.small_caps {
        add("fo:font-variant", if on { "small-caps" } else { "normal" });
    }
    if let Some(font) = &props.font {
        let family = if font.contains(' ') {
            format!("'{font}'")
        } else {
            font.clone()
        };
        add("fo:font-family", &family);
    }
    match props.size {
        Some(Size::Points(pt)) => add(
            "fo:font-size",
            &format!("{}pt", (pt * 100.0).round() / 100.0),
        ),
        Some(Size::Percent(p)) => add("fo:font-size", &format!("{p}%")),
        None => {}
    }
    match props.color.as_deref() {
        Some(projection::COLOR_AUTO) => add("style:use-window-font-color", "true"),
        Some(color) => add("fo:color", color),
        None => {}
    }
    xml::open_tag("style:text-properties", &attrs, true)
}

/// Centimetri in punti.
pub(super) fn cm(cm: f32) -> f32 {
    cm * 72.0 / 2.54
}

/// Porta gli attributi di `style:paragraph-properties` al cambiamento. Un
/// `fo:margin` si scioglie nei quattro lati prima di cambiarne uno.
pub(super) fn apply(attrs: &mut Vec<(String, String)>, change: &ParaChange) {
    let sides = [
        ("fo:margin-left", change.left),
        ("fo:margin-right", change.right),
        ("fo:margin-top", change.before),
        ("fo:margin-bottom", change.after),
    ];
    if sides.iter().any(|(_, c)| c.is_some()) {
        if let Some(all) = attr(attrs, "fo:margin").map(str::to_string) {
            set_attr(attrs, "fo:margin", None);
            for (name, _) in sides {
                if attr(attrs, name).is_none() {
                    set_attr(attrs, name, Some(all.clone()));
                }
            }
        }
    }
    for (name, c) in sides.into_iter().chain([("fo:text-indent", change.first)]) {
        if let Some(value) = c {
            set_attr(attrs, name, value.map(odt_styles::points));
        }
    }
    if let Some(line) = change.line {
        set_attr(attrs, "fo:line-height", None);
        set_attr(attrs, "style:line-height-at-least", None);
        match line {
            Some(Line::Multiple(m)) => set_attr(
                attrs,
                "fo:line-height",
                Some(format!("{}%", (m * 1000.0).round() / 10.0)),
            ),
            Some(Line::Exactly(pt)) => {
                set_attr(attrs, "fo:line-height", Some(odt_styles::points(pt)))
            }
            Some(Line::AtLeast(pt)) => set_attr(
                attrs,
                "style:line-height-at-least",
                Some(odt_styles::points(pt)),
            ),
            None => {}
        }
    }
    if let Some(align) = change.align {
        set_attr(
            attrs,
            "fo:text-align",
            align.map(|a| odt_styles::align_value(a).to_string()),
        );
    }
}
