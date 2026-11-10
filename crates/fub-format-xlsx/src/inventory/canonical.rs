//! La forma canonica di un albero: numeri, booleani, valori di default,
//! attributi lasciati cadere e la scrittura.

use super::*;

// --- forma canonica ------------------------------------------------------------

/// Un numero in forma canonica: `1.0` e `1` sono lo stesso numero. Un testo
/// che non è un numero decimale resta com'è.
pub(super) fn number(text: &str) -> String {
    let trimmed = text.trim();
    let decimal = !trimmed.is_empty()
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b))
        && trimmed.bytes().any(|b| b.is_ascii_digit());
    match trimmed.parse::<f64>() {
        Ok(value) if decimal && value.is_finite() => {
            if value == 0.0 {
                "0".into()
            } else {
                format!("{value}")
            }
        }
        _ => text.to_string(),
    }
}

/// Un attributo booleano in forma canonica.
pub(super) fn boolean(value: &str) -> Option<bool> {
    match value {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// Gli attributi che hanno un valore predefinito nello schema (ECMA-376 parte
/// 1, §18): con quel valore, sono come assenti.
fn default_of(element: &str, attr: &str) -> Option<&'static str> {
    Some(match (element, attr) {
        (_, "hidden" | "outlineLevel" | "collapsed" | "customFormat") => "0",
        (
            "sheetView",
            "showGridLines" | "showRowColHeaders" | "showZeros" | "showOutlineSymbols",
        )
        | ("sheetView", "defaultGridColor" | "showRuler" | "showWhiteSpace") => "1",
        ("sheetView", "zoomScale" | "zoomScaleNormal" | "zoomScalePageLayoutView") => "100",
        ("sheetView", "zoomScaleSheetLayoutView") => "0",
        ("sheetView", "rightToLeft" | "showFormulas" | "windowProtection" | "tabSelected") => "0",
        ("sheetView", "view") => "normal",
        ("sheetView", "colorId") => "64",
        ("sheetView", "topLeftCell") => "A1",
        ("pane", "xSplit" | "ySplit") => "0",
        ("pane", "activePane") => "topLeft",
        ("pane", "state") => "split",
        ("sheetFormatPr", "baseColWidth") => "8",
        ("sheetFormatPr", "customHeight" | "zeroHeight" | "thickTop" | "thickBottom") => "0",
        ("sheetFormatPr", "outlineLevelRow" | "outlineLevelCol") => "0",
        ("sheetPr", "filterMode" | "published" | "enableFormatConditionsCalculation") => match attr
        {
            "published" | "enableFormatConditionsCalculation" => "1",
            _ => "0",
        },
        ("sheetPr", "syncHorizontal" | "syncVertical" | "transitionEvaluation") => "0",
        ("sheetPr", "transitionEntry") => "0",
        ("outlinePr", "applyStyles" | "showOutlineSymbols") => match attr {
            "showOutlineSymbols" => "1",
            _ => "0",
        },
        ("outlinePr", "summaryBelow" | "summaryRight") => "1",
        ("pageSetUpPr", "autoPageBreaks") => "1",
        ("pageSetUpPr", "fitToPage") => "0",
        ("pageSetup", "paperSize" | "scale" | "firstPageNumber" | "fitToWidth" | "fitToHeight") => {
            match attr {
                "scale" => "100",
                _ => "1",
            }
        }
        ("pageSetup", "pageOrder") => "downThenOver",
        ("pageSetup", "orientation") => "default",
        ("pageSetup", "usePrinterDefaults") => "1",
        ("pageSetup", "blackAndWhite" | "draft" | "useFirstPageNumber") => "0",
        ("pageSetup", "cellComments") => "none",
        ("pageSetup", "errors") => "displayed",
        ("pageSetup", "horizontalDpi" | "verticalDpi") => "600",
        ("pageSetup", "copies") => "1",
        ("printOptions", "gridLinesSet") => "1",
        ("printOptions", _) => "0",
        ("headerFooter", "differentOddEven" | "differentFirst") => "0",
        ("headerFooter", "scaleWithDoc" | "alignWithMargins") => "1",
        ("sheetProtection", "sheet" | "objects" | "scenarios") => "0",
        ("sheetProtection", "formatCells" | "formatColumns" | "formatRows")
        | ("sheetProtection", "insertColumns" | "insertRows" | "insertHyperlinks")
        | ("sheetProtection", "deleteColumns" | "deleteRows" | "sort" | "autoFilter")
        | ("sheetProtection", "pivotTables") => "1",
        ("sheetProtection", "selectLockedCells" | "selectUnlockedCells") => "0",
        ("dataValidation", "type") => "none",
        ("dataValidation", "errorStyle") => "stop",
        ("dataValidation", "imeMode") => "noControl",
        ("dataValidation", "operator") => "between",
        ("dataValidation", "allowBlank" | "showDropDown") => "0",
        ("dataValidation", "showInputMessage" | "showErrorMessage") => "0",
        ("dataValidations", "disablePrompts") => "0",
        ("cfRule", "stopIfTrue" | "aboveAverage" | "percent" | "bottom" | "equalAverage") => {
            match attr {
                "aboveAverage" => "1",
                _ => "0",
            }
        }
        ("cfRule", "stdDev") => "0",
        ("conditionalFormatting", "pivot") => "0",
        ("dataBar", "minLength") => "10",
        ("dataBar", "maxLength") => "90",
        ("dataBar", "showValue") => "1",
        ("iconSet", "iconSet") => "3TrafficLights1",
        ("iconSet", "showValue" | "percent") => "1",
        ("iconSet", "reverse") => "0",
        ("cfvo", "gte") => "1",
        ("hyperlink", _) => return None,
        ("tableStyleInfo", _) => return None,
        ("workbookPr", "date1904" | "showObjects") => match attr {
            "date1904" => "0",
            _ => "all",
        },
        ("calcPr", "calcMode") => "auto",
        ("calcPr", "fullCalcOnLoad" | "calcCompleted" | "calcOnSave" | "concurrentCalc") => {
            match attr {
                "fullCalcOnLoad" => "0",
                _ => "1",
            }
        }
        ("calcPr", "iterate") => "0",
        ("calcPr", "iterateCount") => "100",
        ("calcPr", "iterateDelta") => "0.001",
        ("calcPr", "fullPrecision") => "1",
        ("calcPr", "refMode") => "A1",
        ("definedName", "function" | "vbProcedure" | "xlm" | "publishToServer") => "0",
        ("definedName", "workbookParameter") => "0",
        ("sheet", "state") => "visible",
        ("workbookView", "showHorizontalScroll" | "showVerticalScroll" | "showSheetTabs")
        | ("workbookView", "autoFilterDateGrouping") => "1",
        ("workbookView", "visibility") => "visible",
        ("workbookView", "minimized") => "0",
        ("alignment", "horizontal") => "general",
        ("alignment", "vertical") => "bottom",
        ("alignment", "indent" | "relativeIndent" | "textRotation" | "readingOrder") => "0",
        ("alignment", "wrapText" | "shrinkToFit" | "justifyLastLine") => "0",
        ("protection", "locked") => "1",
        ("autoFilter", _) | ("filterColumn", "hiddenButton" | "showButton") => match attr {
            "showButton" => "1",
            "hiddenButton" => "0",
            _ => return None,
        },
        ("filters", "blank") => "0",
        ("comment", "shapeId") => "0",
        _ => return None,
    })
}

/// Gli attributi che una forma canonica non conta, per elemento.
fn dropped(element: &str, attr: &str) -> bool {
    matches!(
        (element, attr),
        (_, "count" | "uniqueCount" | "x14ac:dyDescent")
            | ("sheetView", "tabSelected" | "workbookViewId")
            | ("pane", "activePane")
            | ("cfRule", "priority")
    )
}

/// La forma canonica di un elemento con i suoi discendenti: il nome, gli
/// attributi in ordine di nome, senza quelli con il valore predefinito e con
/// i booleani e i numeri in una forma sola, i figli in ordine e il testo.
/// `resolve` riscrive un attributo prima: un `r:id` nella parte che punta, un
/// `dxfId` nel formato che nomina.
pub(crate) fn canonical(
    node: &Node,
    resolve: &mut dyn FnMut(&Node, &str, &str) -> Option<String>,
) -> String {
    let mut out = String::new();
    write_canonical(node, resolve, &mut out);
    out
}

fn write_canonical(
    node: &Node,
    resolve: &mut dyn FnMut(&Node, &str, &str) -> Option<String>,
    out: &mut String,
) {
    out.push('<');
    out.push_str(&node.name);
    let mut attrs: Vec<(String, String)> = Vec::new();
    for (name, value) in &node.attrs {
        if dropped(&node.name, name) {
            continue;
        }
        if let Some(resolved) = resolve(node, name, value) {
            attrs.push((name.clone(), resolved));
            continue;
        }
        let value = match boolean(value) {
            Some(flag) if !value.chars().all(|c| c.is_ascii_digit()) || value.len() == 1 => {
                if flag { "1" } else { "0" }.to_string()
            }
            _ => number(value),
        };
        if default_of(&node.name, name).is_some_and(|default| number(default) == value) {
            continue;
        }
        attrs.push((name.clone(), value));
    }
    attrs.sort();
    for (name, value) in attrs {
        out.push(' ');
        out.push_str(&name);
        out.push('=');
        out.push_str(&format!("{value:?}"));
    }
    out.push('>');
    for kid in &node.kids {
        let mut text = String::new();
        write_canonical(kid, resolve, &mut text);
        // Le proprietà di un foglio senza attributi sono quelle predefinite.
        if node.name == "sheetPr" && text == format!("<{}></>", kid.name) {
            continue;
        }
        out.push_str(&text);
    }
    if !node.text.is_empty() {
        out.push_str(&format!("{:?}", node.text));
    }
    out.push_str("</>");
}
