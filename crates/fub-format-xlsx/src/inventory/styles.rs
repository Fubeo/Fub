//! Gli stili della cartella: formati numerici di serie, font e la lettura di
//! `styles.xml`.

use super::*;

// --- stili ---------------------------------------------------------------------

/// I formati numerici predefiniti (ECMA-376 parte 1, §18.8.30).
fn builtin_format(id: u32) -> Option<&'static str> {
    Some(match id {
        0 => "General",
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        12 => "# ?/?",
        13 => "# ??/??",
        14 => "mm-dd-yy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "m/d/yy h:mm",
        37 => "#,##0 ;(#,##0)",
        38 => "#,##0 ;[Red](#,##0)",
        39 => "#,##0.00;(#,##0.00)",
        40 => "#,##0.00;[Red](#,##0.00)",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        48 => "##0.0E+0",
        49 => "@",
        _ => return None,
    })
}

/// Gli stili di una cartella, risolti: ciò che un indice nomina.
#[derive(Default)]
pub(super) struct Styles {
    /// L'aspetto di ogni formato di cella (`cellXfs`).
    pub(super) cells: Vec<String>,
    /// Ogni formato differenziale (`dxfs`).
    pub(super) dxfs: Vec<String>,
}

/// Gli elementi di un carattere sono un insieme: l'ordine non conta, e una
/// proprietà booleana spenta è come assente.
pub(super) fn font_canonical(node: &Node) -> String {
    let mut parts: Vec<String> = Vec::new();
    for kid in &node.kids {
        let flag = matches!(
            kid.name.as_str(),
            "b" | "i" | "strike" | "condense" | "extend" | "outline" | "shadow"
        );
        if flag {
            if kid.attr("val").and_then(boolean).unwrap_or(true) {
                parts.push(format!("<{}>", kid.name));
            }
            continue;
        }
        if kid.name == "u" {
            let value = kid.attr("val").unwrap_or("single");
            if value != "none" {
                parts.push(format!("<u {value}>"));
            }
            continue;
        }
        if kid.name == "vertAlign" && kid.attr("val") == Some("baseline") {
            continue;
        }
        parts.push(canonical(kid, &mut |_, _, _| None));
    }
    parts.sort();
    parts.concat()
}

pub(super) fn read_styles(node: &Node) -> Styles {
    let mut formats: HashMap<u32, String> = HashMap::new();
    if let Some(list) = node.child("numFmts") {
        for format in list.children("numFmt") {
            if let (Some(id), Some(code)) = (
                format.attr("numFmtId").and_then(|id| id.parse().ok()),
                format.attr("formatCode"),
            ) {
                formats.insert(id, code.to_string());
            }
        }
    }
    let format = |id: u32| -> String {
        match formats.get(&id) {
            Some(code) => format!("fmt {code:?}"),
            None => match builtin_format(id) {
                Some(code) => format!("fmt {code:?}"),
                None => format!("fmt #{id}"),
            },
        }
    };
    let list = |name: &str, each: &str, canon: &dyn Fn(&Node) -> String| -> Vec<String> {
        node.child(name)
            .map(|list| list.children(each).map(canon).collect())
            .unwrap_or_default()
    };
    let fonts = list("fonts", "font", &font_canonical);
    let plain = |node: &Node| canonical(node, &mut |_, _, _| None);
    let fills = list("fills", "fill", &plain);
    let borders = list("borders", "border", &plain);
    // Il nome dello stile di cella da cui un formato discende.
    let mut parents: HashMap<u32, String> = HashMap::new();
    if let Some(list) = node.child("cellStyles") {
        for style in list.children("cellStyle") {
            if let Some(id) = style.attr("xfId").and_then(|id| id.parse().ok()) {
                let name = match style.attr("builtinId") {
                    Some(builtin) => format!("builtin {builtin}"),
                    None => format!("{:?}", style.attr("name").unwrap_or("")),
                };
                parents.entry(id).or_insert(name);
            }
        }
    }
    let pick = |list: &[String], id: Option<&str>| -> String {
        let index: usize = id.and_then(|id| id.parse().ok()).unwrap_or(0);
        list.get(index).cloned().unwrap_or_default()
    };
    let xf = |xf: &Node| -> String {
        let mut out = String::new();
        let fmt: u32 = xf
            .attr("numFmtId")
            .and_then(|id| id.parse().ok())
            .unwrap_or(0);
        out.push_str(&format(fmt));
        out.push_str(" font ");
        out.push_str(&pick(&fonts, xf.attr("fontId")));
        out.push_str(" fill ");
        out.push_str(&pick(&fills, xf.attr("fillId")));
        out.push_str(" border ");
        out.push_str(&pick(&borders, xf.attr("borderId")));
        for flag in ["quotePrefix", "pivotButton"] {
            if xf.attr(flag).and_then(boolean).unwrap_or(false) {
                out.push(' ');
                out.push_str(flag);
            }
        }
        for kid in &xf.kids {
            let text = canonical(kid, &mut |_, _, _| None);
            // Un allineamento o una protezione vuoti sono quelli predefiniti.
            if text != format!("<{}></>", kid.name) {
                out.push(' ');
                out.push_str(&text);
            }
        }
        let parent: u32 = xf.attr("xfId").and_then(|id| id.parse().ok()).unwrap_or(0);
        out.push_str(" style ");
        out.push_str(parents.get(&parent).map_or("builtin 0", String::as_str));
        out
    };
    let cells = node
        .child("cellXfs")
        .map(|list| list.children("xf").map(xf).collect())
        .unwrap_or_default();
    let dxf = |dxf: &Node| -> String {
        let mut out = String::new();
        for kid in &dxf.kids {
            out.push_str(&match kid.name.as_str() {
                "font" => format!("<font {}>", font_canonical(kid)),
                "numFmt" => format(
                    kid.attr("numFmtId")
                        .and_then(|id| id.parse().ok())
                        .unwrap_or(0),
                )
                .replace(
                    "fmt #",
                    &format!("fmt {:?} #", kid.attr("formatCode").unwrap_or("")),
                ),
                _ => canonical(kid, &mut |_, _, _| None),
            });
        }
        out
    };
    let dxfs = node
        .child("dxfs")
        .map(|list| list.children("dxf").map(dxf).collect())
        .unwrap_or_default();
    Styles { cells, dxfs }
}
