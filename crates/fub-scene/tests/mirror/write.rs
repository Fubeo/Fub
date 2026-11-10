//! La scrittura canonica di un SVG di FubDraw, quanto basta per generare
//! le fixture: `El`, l'escape, le radici e i tratti.

use super::*;

// ---------------------------------------------------------------------------
// La scrittura canonica, quanto basta per generare.
// ---------------------------------------------------------------------------

/// Un nodo da scrivere: un elemento o una riga già fatta.
enum Node {
    Element(El),
    Raw(String),
}

/// Un elemento con gli attributi nell'ordine in cui li si dà.
pub(super) struct El {
    name: &'static str,
    attrs: Vec<(&'static str, String)>,
    text: Option<String>,
    /// Il contenuto già scritto, sulla riga del tag: i pezzi di una riga.
    markup: Option<String>,
    children: Vec<Node>,
}

impl El {
    pub(super) fn new(name: &'static str) -> El {
        El {
            name,
            attrs: Vec::new(),
            text: None,
            markup: None,
            children: Vec::new(),
        }
    }

    pub(super) fn a(mut self, name: &'static str, value: impl ToString) -> El {
        self.attrs.push((name, value.to_string()));
        self
    }

    pub(super) fn text(mut self, text: &str) -> El {
        self.text = Some(text.to_owned());
        self
    }

    pub(super) fn markup(mut self, markup: &str) -> El {
        self.markup = Some(markup.to_owned());
        self
    }

    pub(super) fn child(mut self, child: El) -> El {
        self.children.push(Node::Element(child));
        self
    }

    pub(super) fn raw(mut self, line: &str) -> El {
        self.children.push(Node::Raw(line.to_owned()));
        self
    }

    /// Scrive l'elemento come §7: una riga per elemento, due spazi di rientro
    /// per livello, il testo sulla riga del tag, i gruppi vuoti aperti.
    pub(super) fn write(&self, depth: usize, newline: &str, out: &mut String) {
        let indent = "  ".repeat(depth);
        out.push_str(&indent);
        out.push('<');
        out.push_str(self.name);
        for (name, value) in &self.attrs {
            out.push(' ');
            out.push_str(name);
            out.push_str("=\"");
            escape(value, true, out);
            out.push('"');
        }
        if let Some(text) = &self.text {
            out.push('>');
            escape(text, false, out);
            out.push_str(&format!("</{}>", self.name));
        } else if let Some(markup) = &self.markup {
            out.push('>');
            out.push_str(markup);
            out.push_str(&format!("</{}>", self.name));
        } else if self.children.is_empty() && self.name != "g" {
            out.push_str("/>");
        } else {
            out.push('>');
            out.push_str(newline);
            for child in &self.children {
                match child {
                    Node::Element(element) => element.write(depth + 1, newline, out),
                    Node::Raw(line) => {
                        out.push_str(&"  ".repeat(depth + 1));
                        out.push_str(line);
                        out.push_str(newline);
                    }
                }
            }
            out.push_str(&indent);
            out.push_str(&format!("</{}>", self.name));
        }
        out.push_str(newline);
    }
}

/// Gli escape di §7: negli attributi anche virgolette, tabulazioni e a capo.
fn escape(text: &str, attribute: bool, out: &mut String) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if attribute => out.push_str("&quot;"),
            '\t' if attribute => out.push_str("&#9;"),
            '\n' if attribute => out.push_str("&#10;"),
            '\r' if attribute => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
}

/// La radice di un documento FubDraw nuovo (§2).
pub(super) fn svg(width: u32, height: u32) -> El {
    El::new("svg")
        .a("xmlns", SVG_NS)
        .a("xmlns:fub", FUB_NS)
        .a("fub:version", 1)
        .a("viewBox", format!("0 0 {width} {height}"))
        .a("width", width)
        .a("height", height)
}

/// La carta (§2).
pub(super) fn paper(width: u32, height: u32) -> El {
    El::new("rect")
        .a("id", "fub-paper")
        .a("fub:role", "paper")
        .a("x", 0)
        .a("y", 0)
        .a("width", width)
        .a("height", height)
        .a("fill", "#ffffff")
}

pub(super) fn layer(id: &str, name: &str) -> El {
    El::new("g").a("id", id).a("fub:layer", name)
}

/// Il documento intero: radice, a capo finale.
pub(super) fn document(root: &El, newline: &str) -> String {
    let mut out = String::new();
    root.write(0, newline, &mut out);
    out
}

/// `value` con `digits` decimali impliciti, scritto senza zeri finali e
/// senza esponente: `decimal(12050, 2)` è `120.5`. Solo aritmetica intera,
/// così TypeScript scrive le stesse cifre.
pub(super) fn decimal(value: i64, digits: u32) -> String {
    let unit = 10u64.pow(digits);
    let sign = if value < 0 { "-" } else { "" };
    let (integer, fraction) = (value.unsigned_abs() / unit, value.unsigned_abs() % unit);
    let mut out = format!("{sign}{integer}");
    if fraction > 0 {
        let fraction = format!("{fraction:0width$}", width = digits as usize);
        out.push('.');
        out.push_str(fraction.trim_end_matches('0'));
    }
    out
}

/// Il `d` di un tratto: la spezzata dei suoi campioni quantizzati, chiusa.
/// FubDraw scrive il contorno di `getStroke`; per la lettura basta un `d`
/// valido.
fn polyline_d(ink: &Ink) -> String {
    let digits = match ink.scale() {
        Scale::S10 => 1,
        Scale::S100 => 2,
    };
    let mut d = String::new();
    for i in 0..ink.len() {
        let sample = ink.sample(i);
        let command = if i == 0 { "M" } else { " L" };
        d.push_str(&format!(
            "{command}{} {}",
            decimal(sample[0], digits),
            decimal(sample[1], digits)
        ));
    }
    d.push_str(" Z");
    d
}

/// Un tratto, con gli attributi nell'ordine canonico.
pub(super) fn stroke(
    id: &str,
    tool: &str,
    at: &str,
    brush: &str,
    ink: &str,
    d: &str,
    fill: &str,
) -> El {
    let mut element = El::new("path")
        .a("id", id)
        .a("fub:tool", tool)
        .a("fub:at", at)
        .a("fub:brush", brush)
        .a("d", d)
        .a("fill", fill);
    if tool == "highlighter" {
        element = element.a("fill-opacity", "0.4");
    }
    element.a("fub:ink", ink)
}

/// Un tratto con campioni validi.
pub(super) fn drawn(
    id: &str,
    tool: &str,
    at: &str,
    brush: &str,
    samples: &[Sample],
    scale: Scale,
    fill: &str,
) -> El {
    let ink = Ink::quantize(samples, scale).unwrap();
    assert_eq!(Ink::decode(&ink.encode()), Ok(ink.clone()));
    stroke(id, tool, at, brush, &ink.encode(), &polyline_d(&ink), fill)
}

pub(super) const BRUSH: &str =
    "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1";
