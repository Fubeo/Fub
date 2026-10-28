//! InkML, il formato dell'inchiostro di Word (W3C, «Ink Markup Language»).
//!
//! Word salva l'inchiostro di un documento come una parte InkML
//! (`word/ink/inkN.xml`) che il corpo nomina con un `w14:contentPart` dentro
//! un `mc:AlternateContent`, con un'immagine di ripiego per chi non lo legge.
//! Qui c'è soltanto la traduzione fra quella parte e i tratti: chi la mette
//! nel pacchetto è il formato del documento.
//!
//! **Che cosa si scrive.** Un contesto con quattro canali — `X` e `Y` in
//! centimetri a risoluzione 1000 (centesimi di millimetro, come Word), `F`
//! la pressione intera su 32767, `T` i millisecondi —, un pennello per ogni
//! aspetto diverso (colore, larghezza, altezza, punta, evidenziatore,
//! trasparenza) e una `trace` per tratto, coi valori espliciti.
//!
//! **Che cosa si legge.** Lo stesso, più ciò che Word e gli altri scrivono di
//! solito: i canali in un ordine qualsiasi, valori decimali, le differenze
//! prime (`'`) e seconde (`"`) e il ritorno all'esplicito (`!`), canali che
//! mancano in un punto (si ripete il valore di prima), le unità `cm`, `mm`,
//! `in`, `pt`, `px` e `himetric`. Ciò che non si capisce è un
//! [`InkmlError`]: il documento tiene allora la parte com'è, opaca, e lo dice.
//!
//! Le coordinate dei tratti sono in punti tipografici (1/72 di pollice), le
//! unità della pagina dei documenti.

use std::collections::HashMap;
use std::fmt::Write as _;

use crate::sample::Sample;

/// Il namespace di InkML.
pub const INKML_NS: &str = "http://www.w3.org/2003/InkML";

/// Quanti centimetri fa un punto tipografico.
const CM_PER_PT: f64 = 2.54 / 72.0;

/// La risoluzione delle coordinate scritte: millesimi di centimetro.
const WRITE_RESOLUTION: f64 = 1000.0;

/// Il massimo della pressione scritta.
const WRITE_PRESSURE_MAX: f64 = 32767.0;

/// Quanti tratti e quanti punti per tratto si leggono, al più: una parte più
/// grande non è inchiostro scritto a mano.
pub const MAX_TRACES: usize = 10_000;

/// La punta del pennello.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum InkTip {
    Ellipse,
    Rectangle,
}

/// L'aspetto di un tratto.
#[derive(Clone, Debug, PartialEq)]
pub struct InkBrush {
    /// `#rrggbb`, minuscolo.
    pub color: String,
    /// Larghezza e altezza della punta, in punti.
    pub width: f64,
    pub height: f64,
    pub tip: InkTip,
    /// L'evidenziatore: Word lo scrive con `rasterOp="maskPen"`, e lo disegna
    /// moltiplicando i colori.
    pub highlighter: bool,
    /// 0 opaco … 255 trasparente, come `transparency` di InkML.
    pub transparency: u8,
    /// Lo spessore non segue la pressione (`ignorePressure`): il Pennarello.
    pub ignore_pressure: bool,
    /// La penna di Fub che ha scritto il tratto (`fubPen`), perché riaperto
    /// in Fub torni con la sua: Word non la conosce e la ignora. Soltanto
    /// lettere, cifre e trattini.
    pub pen: Option<String>,
}

impl Default for InkBrush {
    fn default() -> Self {
        InkBrush {
            color: "#000000".to_owned(),
            width: 1.0,
            height: 1.0,
            tip: InkTip::Ellipse,
            highlighter: false,
            transparency: 0,
            ignore_pressure: false,
            pen: None,
        }
    }
}

/// Un tratto: il suo pennello e i campioni, in punti e millisecondi.
#[derive(Clone, Debug, PartialEq)]
pub struct InkStroke {
    pub brush: InkBrush,
    pub samples: Vec<Sample>,
}

/// L'inchiostro di una parte InkML.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct InkDocument {
    pub strokes: Vec<InkStroke>,
}

/// Perché una parte non si legge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InkmlError {
    /// Non è XML ben formato, nei limiti che servono qui.
    Malformed(String),
    /// Non c'è un elemento `ink`.
    NotInk,
    /// Un canale, un'unità o una codifica che qui non si capisce.
    Unsupported(String),
    /// Oltre i limiti di [`MAX_TRACES`] e [`crate::MAX_SAMPLES`].
    TooLarge,
}

impl std::fmt::Display for InkmlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InkmlError::Malformed(why) => write!(f, "InkML non ben formato: {why}"),
            InkmlError::NotInk => f.write_str("non è una parte InkML"),
            InkmlError::Unsupported(what) => write!(f, "InkML non letto: {what}"),
            InkmlError::TooLarge => f.write_str("InkML troppo grande"),
        }
    }
}

impl std::error::Error for InkmlError {}

// ── Scrittura ────────────────────────────────────────────────────────────────

fn number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    let text = format!("{rounded}");
    if text == "-0" {
        "0".to_owned()
    } else {
        text
    }
}

/// La parte InkML di `ink`.
pub fn to_inkml(ink: &InkDocument) -> String {
    let mut brushes: Vec<&InkBrush> = Vec::new();
    for stroke in &ink.strokes {
        if !brushes.contains(&&stroke.brush) {
            brushes.push(&stroke.brush);
        }
    }
    let mut out = String::new();
    out.push_str(&format!("<inkml:ink xmlns:inkml=\"{INKML_NS}\">"));
    out.push_str("<inkml:definitions>");
    out.push_str(
        "<inkml:context xml:id=\"ctx0\"><inkml:inkSource xml:id=\"inkSrc0\"><inkml:traceFormat>",
    );
    out.push_str("<inkml:channel name=\"X\" type=\"integer\" units=\"cm\"/>");
    out.push_str("<inkml:channel name=\"Y\" type=\"integer\" units=\"cm\"/>");
    out.push_str("<inkml:channel name=\"F\" type=\"integer\" max=\"32767\" units=\"dev\"/>");
    out.push_str("<inkml:channel name=\"T\" type=\"integer\" units=\"dev\"/>");
    out.push_str("</inkml:traceFormat><inkml:channelProperties>");
    out.push_str(
        "<inkml:channelProperty channel=\"X\" name=\"resolution\" value=\"1000\" units=\"1/cm\"/>",
    );
    out.push_str(
        "<inkml:channelProperty channel=\"Y\" name=\"resolution\" value=\"1000\" units=\"1/cm\"/>",
    );
    out.push_str(
        "<inkml:channelProperty channel=\"T\" name=\"resolution\" value=\"1\" units=\"1/ms\"/>",
    );
    out.push_str("</inkml:channelProperties></inkml:inkSource></inkml:context>");
    for (index, brush) in brushes.iter().enumerate() {
        let _ = write!(out, "<inkml:brush xml:id=\"br{index}\">");
        let _ = write!(
            out,
            "<inkml:brushProperty name=\"width\" value=\"{}\" units=\"cm\"/>",
            number(brush.width * CM_PER_PT)
        );
        let _ = write!(
            out,
            "<inkml:brushProperty name=\"height\" value=\"{}\" units=\"cm\"/>",
            number(brush.height * CM_PER_PT)
        );
        let _ = write!(
            out,
            "<inkml:brushProperty name=\"color\" value=\"{}\"/>",
            brush.color.to_ascii_uppercase()
        );
        if brush.transparency > 0 {
            let _ = write!(
                out,
                "<inkml:brushProperty name=\"transparency\" value=\"{}\"/>",
                brush.transparency
            );
        }
        let tip = match brush.tip {
            InkTip::Ellipse => "ellipse",
            InkTip::Rectangle => "rectangle",
        };
        let _ = write!(out, "<inkml:brushProperty name=\"tip\" value=\"{tip}\"/>");
        if brush.highlighter {
            out.push_str("<inkml:brushProperty name=\"rasterOp\" value=\"maskPen\"/>");
        }
        if brush.ignore_pressure {
            out.push_str("<inkml:brushProperty name=\"ignorePressure\" value=\"1\"/>");
        }
        if let Some(pen) = brush.pen.as_deref().filter(|pen| pen_id(pen)) {
            let _ = write!(
                out,
                "<inkml:brushProperty name=\"fubPen\" value=\"{pen}\"/>"
            );
        }
        out.push_str("</inkml:brush>");
    }
    out.push_str("</inkml:definitions>");
    for stroke in &ink.strokes {
        let brush = brushes
            .iter()
            .position(|each| *each == &stroke.brush)
            .unwrap_or(0);
        let _ = write!(
            out,
            "<inkml:trace contextRef=\"#ctx0\" brushRef=\"#br{brush}\">"
        );
        for (index, sample) in stroke.samples.iter().enumerate() {
            if index > 0 {
                out.push_str(", ");
            }
            let x = (sample.x * CM_PER_PT * WRITE_RESOLUTION).round() as i64;
            let y = (sample.y * CM_PER_PT * WRITE_RESOLUTION).round() as i64;
            let f = (sample.p.unwrap_or(0.5).clamp(0.0, 1.0) * WRITE_PRESSURE_MAX).round() as i64;
            let t = sample.t.max(0.0).round() as i64;
            let _ = write!(out, "{x} {y} {f} {t}");
        }
        out.push_str("</inkml:trace>");
    }
    out.push_str("</inkml:ink>");
    out
}

// ── Lettura: un XML minimo ───────────────────────────────────────────────────

#[derive(Debug)]
struct Element {
    name: String,
    attrs: HashMap<String, String>,
    children: Vec<Node>,
}

#[derive(Debug)]
enum Node {
    Element(Element),
    Text(String),
}

impl Element {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }

    fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|node| match node {
            Node::Element(element) => Some(element),
            Node::Text(_) => None,
        })
    }

    fn text(&self) -> String {
        let mut out = String::new();
        for node in &self.children {
            match node {
                Node::Text(text) => out.push_str(text),
                Node::Element(element) => out.push_str(&element.text()),
            }
        }
        out
    }

    fn descendants<'a>(&'a self, out: &mut Vec<&'a Element>) {
        for child in self.elements() {
            out.push(child);
            child.descendants(out);
        }
    }
}

/// Il nome senza prefisso.
fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';') else {
            out.push_str(rest);
            return out;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.starts_with("#x") => u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => out.push(c),
            None => out.push_str(&rest[..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

struct Parser<'a> {
    text: &'a str,
    at: usize,
}

impl<'a> Parser<'a> {
    fn malformed(&self, why: &str) -> InkmlError {
        InkmlError::Malformed(format!("{why} (byte {})", self.at))
    }

    fn rest(&self) -> &'a str {
        &self.text[self.at..]
    }

    /// Salta dichiarazioni, commenti e istruzioni.
    fn skip_misc(&mut self) -> Result<(), InkmlError> {
        loop {
            let rest = self.rest();
            let trimmed = rest.trim_start();
            self.at += rest.len() - trimmed.len();
            let (open, close) = if trimmed.starts_with("<?") {
                ("<?", "?>")
            } else if trimmed.starts_with("<!--") {
                ("<!--", "-->")
            } else if trimmed.starts_with("<!") {
                ("<!", ">")
            } else {
                return Ok(());
            };
            let end = trimmed[open.len()..]
                .find(close)
                .ok_or_else(|| self.malformed("non chiuso"))?;
            self.at += open.len() + end + close.len();
        }
    }

    fn element(&mut self, depth: usize) -> Result<Element, InkmlError> {
        if depth > 64 {
            return Err(self.malformed("troppo annidato"));
        }
        let rest = self.rest();
        if !rest.starts_with('<') {
            return Err(self.malformed("atteso un elemento"));
        }
        let end = rest
            .find('>')
            .ok_or_else(|| self.malformed("tag non chiuso"))?;
        let mut tag = &rest[1..end];
        let empty = tag.ends_with('/');
        if empty {
            tag = &tag[..tag.len() - 1];
        }
        self.at += end + 1;
        let name_end = tag.find(|c: char| c.is_whitespace()).unwrap_or(tag.len());
        let name = tag[..name_end].to_owned();
        let mut attrs = HashMap::new();
        let mut attr_text = tag[name_end..].trim();
        while !attr_text.is_empty() {
            let eq = attr_text
                .find('=')
                .ok_or_else(|| self.malformed("attributo senza valore"))?;
            let key = attr_text[..eq].trim();
            let after = attr_text[eq + 1..].trim_start();
            let quote = after
                .chars()
                .next()
                .filter(|c| *c == '"' || *c == '\'')
                .ok_or_else(|| self.malformed("valore senza virgolette"))?;
            let close = after[1..]
                .find(quote)
                .ok_or_else(|| self.malformed("virgolette non chiuse"))?;
            attrs.insert(local(key).to_owned(), unescape(&after[1..1 + close]));
            attr_text = after[close + 2..].trim_start();
        }
        let mut element = Element {
            name: local(&name).to_owned(),
            attrs,
            children: Vec::new(),
        };
        if empty {
            return Ok(element);
        }
        loop {
            let rest = self.rest();
            if rest.is_empty() {
                return Err(self.malformed("elemento non chiuso"));
            }
            if rest.starts_with("</") {
                let end = rest
                    .find('>')
                    .ok_or_else(|| self.malformed("chiusura non finita"))?;
                if local(rest[2..end].trim()) != element.name {
                    return Err(self.malformed("chiusura diversa"));
                }
                self.at += end + 1;
                return Ok(element);
            }
            if rest.starts_with("<!--") || rest.starts_with("<?") {
                self.skip_misc()?;
                continue;
            }
            if let Some(cdata) = rest.strip_prefix("<![CDATA[") {
                let end = cdata
                    .find("]]>")
                    .ok_or_else(|| self.malformed("CDATA non chiuso"))?;
                element.children.push(Node::Text(cdata[..end].to_owned()));
                self.at += 9 + end + 3;
                continue;
            }
            if rest.starts_with('<') {
                let child = self.element(depth + 1)?;
                element.children.push(Node::Element(child));
                continue;
            }
            let end = rest.find('<').unwrap_or(rest.len());
            element.children.push(Node::Text(unescape(&rest[..end])));
            self.at += end;
        }
    }
}

fn parse(text: &str) -> Result<Element, InkmlError> {
    let mut parser = Parser { text, at: 0 };
    parser.skip_misc()?;
    parser.element(0)
}

// ── Lettura: l'inchiostro ────────────────────────────────────────────────────

/// Un canale del formato dei tratti, con il fattore che porta in punti (per
/// `X` e `Y`) o in unità della pressione e del tempo.
#[derive(Clone, Debug)]
struct Channel {
    name: String,
    /// Moltiplicando il valore letto si ha: punti per X e Y, una frazione per
    /// F, millisecondi per T.
    scale: f64,
}

/// Quanti punti fa un'unità di lunghezza.
fn points_per(units: &str) -> Option<f64> {
    match units {
        "cm" => Some(1.0 / CM_PER_PT),
        "mm" => Some(0.1 / CM_PER_PT),
        "in" => Some(72.0),
        "pt" => Some(1.0),
        "px" => Some(0.75),
        "himetric" => Some(0.001 / CM_PER_PT),
        "m" => Some(100.0 / CM_PER_PT),
        _ => None,
    }
}

/// Il formato di un contesto: i canali coi loro fattori.
fn trace_format(context: &Element) -> Result<Vec<Channel>, InkmlError> {
    let mut all = Vec::new();
    context.descendants(&mut all);
    let resolutions: HashMap<String, f64> = all
        .iter()
        .filter(|el| el.name == "channelProperty" && el.attr("name") == Some("resolution"))
        .filter_map(|el| {
            Some((
                el.attr("channel")?.to_owned(),
                el.attr("value")?.parse::<f64>().ok()?,
            ))
        })
        .filter(|(_, value)| *value > 0.0)
        .collect();
    let mut channels = Vec::new();
    for channel in all.iter().filter(|el| el.name == "channel") {
        let name = channel.attr("name").unwrap_or_default().to_owned();
        let units = channel.attr("units").unwrap_or("");
        let resolution = resolutions.get(&name).copied().unwrap_or(1.0);
        let scale = match name.as_str() {
            "X" | "Y" => {
                let per = if units.is_empty() || units == "dev" {
                    // Senza unità le coordinate sono già quelle della pagina.
                    Some(1.0)
                } else {
                    points_per(units)
                };
                per.ok_or_else(|| InkmlError::Unsupported(format!("unità «{units}»")))? / resolution
            }
            "F" => {
                let max = channel
                    .attr("max")
                    .and_then(|value| value.parse::<f64>().ok())
                    .filter(|max| *max > 0.0)
                    .unwrap_or(1.0);
                1.0 / max
            }
            "T" => match units {
                "s" => 1000.0 / resolution,
                _ => 1.0 / resolution,
            },
            _ => 1.0,
        };
        channels.push(Channel { name, scale });
    }
    Ok(channels)
}

/// Il formato di serie di InkML: X e Y, senza unità.
fn default_format() -> Vec<Channel> {
    vec![
        Channel {
            name: "X".into(),
            scale: 1.0,
        },
        Channel {
            name: "Y".into(),
            scale: 1.0,
        },
    ]
}

/// Un nome di penna che si scrive com'è in un attributo: da 1 a 32 lettere,
/// cifre o trattini.
fn pen_id(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn brush_of(element: &Element) -> InkBrush {
    let mut brush = InkBrush::default();
    for property in element.elements().filter(|el| el.name == "brushProperty") {
        let value = property.attr("value").unwrap_or("");
        let length = || -> Option<f64> {
            let number: f64 = value.parse().ok()?;
            let per = points_per(property.attr("units").unwrap_or("cm"))?;
            Some(number * per)
        };
        match property.attr("name").unwrap_or("") {
            "width" => brush.width = length().unwrap_or(brush.width),
            "height" => brush.height = length().unwrap_or(brush.height),
            "color" => {
                let hex = value.trim_start_matches('#');
                if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    brush.color = format!("#{}", hex.to_ascii_lowercase());
                }
            }
            "transparency" => {
                brush.transparency = value.parse::<u16>().map(|v| v.min(255) as u8).unwrap_or(0)
            }
            "tip" => {
                brush.tip = if value.eq_ignore_ascii_case("rectangle") {
                    InkTip::Rectangle
                } else {
                    InkTip::Ellipse
                };
            }
            "rasterOp" => brush.highlighter = value == "maskPen",
            "ignorePressure" => {
                brush.ignore_pressure = value == "1" || value.eq_ignore_ascii_case("true")
            }
            "fubPen" if pen_id(value) => brush.pen = Some(value.to_owned()),
            _ => {}
        }
    }
    brush
}

/// Un valore di un canale in una traccia, con la sua codifica.
#[derive(Copy, Clone)]
enum Mode {
    Explicit,
    First,
    Second,
}

/// Un valore letto, col segno della codifica che porta davanti.
type Read = (Option<Mode>, f64);

/// Chi riceve ogni traccia, col contesto e il pennello del gruppo.
type TraceVisitor<'a> =
    dyn FnMut(&Element, Option<&str>, Option<&str>) -> Result<(), InkmlError> + 'a;

/// Divide il testo di una traccia in punti e valori. Un valore può portare
/// davanti `!` (esplicito), `'` (differenza prima) o `"` (differenza
/// seconda), che valgono per quel canale da lì in poi; i segni `-` staccati
/// e i numeri accostati («1-2») si separano.
fn trace_points(text: &str) -> Result<Vec<Vec<Read>>, InkmlError> {
    let mut points = Vec::new();
    for raw in text.split(',') {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let mut values = Vec::new();
        let bytes = raw.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i] as char;
            if c.is_whitespace() {
                i += 1;
                continue;
            }
            let mode = match c {
                '!' => Some(Mode::Explicit),
                '\'' => Some(Mode::First),
                '"' => Some(Mode::Second),
                _ => None,
            };
            if mode.is_some() {
                i += 1;
                while i < bytes.len() && (bytes[i] as char).is_whitespace() {
                    i += 1;
                }
            }
            let start = i;
            if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') {
                i += 1;
            }
            while i < bytes.len()
                && ((bytes[i] as char).is_ascii_digit()
                    || bytes[i] == b'.'
                    || bytes[i] == b'e'
                    || bytes[i] == b'E')
            {
                // Un esponente può avere il suo segno.
                if (bytes[i] == b'e' || bytes[i] == b'E')
                    && i + 1 < bytes.len()
                    && (bytes[i + 1] == b'-' || bytes[i + 1] == b'+')
                {
                    i += 1;
                }
                i += 1;
            }
            let token = &raw[start..i];
            if token.is_empty() || token == "-" || token == "+" {
                return Err(InkmlError::Unsupported(format!(
                    "valore «{}» in una traccia",
                    &raw[start..(start + 1).min(raw.len())]
                )));
            }
            let value: f64 = token
                .parse()
                .map_err(|_| InkmlError::Unsupported(format!("valore «{token}»")))?;
            values.push((mode, value));
        }
        points.push(values);
    }
    Ok(points)
}

/// I campioni di una traccia col formato `channels`.
fn trace_samples(text: &str, channels: &[Channel]) -> Result<Vec<Sample>, InkmlError> {
    let points = trace_points(text)?;
    if points.len() > crate::MAX_SAMPLES {
        return Err(InkmlError::TooLarge);
    }
    let n = channels.len();
    let mut modes = vec![Mode::Explicit; n];
    let mut value = vec![0.0f64; n];
    let mut velocity = vec![0.0f64; n];
    let mut samples = Vec::with_capacity(points.len());
    let index = |name: &str| channels.iter().position(|c| c.name == name);
    let (x, y, f, t) = (index("X"), index("Y"), index("F"), index("T"));
    let (Some(x), Some(y)) = (x, y) else {
        return Err(InkmlError::Unsupported("una traccia senza X o Y".into()));
    };
    for (point_index, point) in points.iter().enumerate() {
        if point.len() > n {
            return Err(InkmlError::Unsupported("più valori che canali".into()));
        }
        for channel in 0..n {
            let Some(&(mode, read)) = point.get(channel) else {
                // Un canale che manca ripete il valore di prima.
                velocity[channel] = 0.0;
                continue;
            };
            if let Some(mode) = mode {
                modes[channel] = mode;
            }
            // Il primo punto è sempre esplicito.
            let mode = if point_index == 0 {
                Mode::Explicit
            } else {
                modes[channel]
            };
            match mode {
                Mode::Explicit => {
                    velocity[channel] = read - value[channel];
                    value[channel] = read;
                }
                Mode::First => {
                    velocity[channel] = read;
                    value[channel] += read;
                }
                Mode::Second => {
                    velocity[channel] += read;
                    value[channel] += velocity[channel];
                }
            }
        }
        samples.push(Sample {
            x: value[x] * channels[x].scale,
            y: value[y] * channels[y].scale,
            p: f.map(|f| (value[f] * channels[f].scale).clamp(0.0, 1.0)),
            t: t.map(|t| value[t] * channels[t].scale)
                .unwrap_or(point_index as f64 * 8.0),
            tilt: None,
        });
    }
    // Il tempo parte da zero.
    if let Some(start) = samples.first().map(|s| s.t) {
        for sample in &mut samples {
            sample.t -= start;
        }
    }
    Ok(samples)
}

/// L'inchiostro di una parte InkML.
pub fn from_inkml(text: &str) -> Result<InkDocument, InkmlError> {
    let root = parse(text)?;
    if root.name != "ink" {
        return Err(InkmlError::NotInk);
    }
    let mut all = Vec::new();
    root.descendants(&mut all);
    let mut contexts: HashMap<String, Vec<Channel>> = HashMap::new();
    let mut brushes: HashMap<String, InkBrush> = HashMap::new();
    let mut default_context: Option<Vec<Channel>> = None;
    for element in &all {
        match element.name.as_str() {
            "context" => {
                let format = trace_format(element)?;
                let format = if format.is_empty() {
                    default_format()
                } else {
                    format
                };
                if let Some(id) = element.attr("id") {
                    contexts.insert(format!("#{id}"), format.clone());
                }
                default_context.get_or_insert(format);
            }
            "inkSource" => {
                if let Some(id) = element.attr("id") {
                    let format = trace_format(element)?;
                    if !format.is_empty() {
                        contexts.entry(format!("#{id}")).or_insert(format);
                    }
                }
            }
            "brush" => {
                if let Some(id) = element.attr("id") {
                    brushes.insert(format!("#{id}"), brush_of(element));
                }
            }
            _ => {}
        }
    }
    let mut strokes = Vec::new();
    let mut traces = 0usize;
    let mut walk = |trace: &Element,
                    inherited_context: Option<&str>,
                    inherited_brush: Option<&str>|
     -> Result<(), InkmlError> {
        traces += 1;
        if traces > MAX_TRACES {
            return Err(InkmlError::TooLarge);
        }
        let context = trace.attr("contextRef").or(inherited_context);
        let channels = match context {
            Some(reference) => contexts
                .get(reference)
                .cloned()
                .ok_or_else(|| InkmlError::Unsupported(format!("contesto «{reference}»")))?,
            None => default_context.clone().unwrap_or_else(default_format),
        };
        let brush = trace
            .attr("brushRef")
            .or(inherited_brush)
            .and_then(|reference| brushes.get(reference))
            .cloned()
            .unwrap_or_default();
        let samples = trace_samples(&trace.text(), &channels)?;
        if !samples.is_empty() {
            strokes.push(InkStroke { brush, samples });
        }
        Ok(())
    };
    // Le tracce stanno sotto `ink` o in un `traceGroup`, che può dare
    // contesto e pennello.
    fn visit<'a>(
        element: &'a Element,
        context: Option<&'a str>,
        brush: Option<&'a str>,
        walk: &mut TraceVisitor<'_>,
    ) -> Result<(), InkmlError> {
        for child in element.elements() {
            match child.name.as_str() {
                "trace" => walk(child, context, brush)?,
                "traceGroup" => visit(
                    child,
                    child.attr("contextRef").or(context),
                    child.attr("brushRef").or(brush),
                    walk,
                )?,
                _ => {}
            }
        }
        Ok(())
    }
    visit(&root, None, None, &mut walk)?;
    Ok(InkDocument { strokes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(x: f64, y: f64, p: f64, t: f64) -> Sample {
        Sample {
            x,
            y,
            p: Some(p),
            t,
            tilt: None,
        }
    }

    #[test]
    fn la_penna_e_la_pressione_ignorata_tornano() {
        let ink = InkDocument {
            strokes: vec![InkStroke {
                brush: InkBrush {
                    ignore_pressure: true,
                    pen: Some("marker".into()),
                    ..InkBrush::default()
                },
                samples: vec![sample(0.0, 0.0, 0.5, 0.0), sample(10.0, 0.0, 0.5, 8.0)],
            }],
        };
        let text = to_inkml(&ink);
        assert!(text.contains("<inkml:brushProperty name=\"ignorePressure\" value=\"1\"/>"));
        let back = from_inkml(&text).unwrap();
        assert!(back.strokes[0].brush.ignore_pressure);
        assert_eq!(back.strokes[0].brush.pen.as_deref(), Some("marker"));
        // Un nome che non è un id non si scrive, e non si legge.
        let mut odd = ink.clone();
        odd.strokes[0].brush.pen = Some("a\"b".into());
        assert!(!to_inkml(&odd).contains("fubPen"));
        let forged = text.replace("value=\"marker\"", "value=\"x y\"");
        assert_eq!(from_inkml(&forged).unwrap().strokes[0].brush.pen, None);
    }

    #[test]
    fn andata_e_ritorno_entro_un_centesimo_di_millimetro() {
        let ink = InkDocument {
            strokes: vec![
                InkStroke {
                    brush: InkBrush {
                        color: "#0072b2".into(),
                        width: 2.0,
                        height: 2.0,
                        ..InkBrush::default()
                    },
                    samples: vec![
                        sample(10.0, 20.0, 0.5, 0.0),
                        sample(12.5, 21.25, 0.75, 8.0),
                        sample(15.0, 23.0, 0.25, 16.0),
                    ],
                },
                InkStroke {
                    brush: InkBrush {
                        color: "#f0e442".into(),
                        width: 8.0,
                        height: 8.0,
                        tip: InkTip::Rectangle,
                        highlighter: true,
                        transparency: 128,
                        ..InkBrush::default()
                    },
                    samples: vec![sample(0.0, 0.0, 0.5, 0.0), sample(100.0, 0.0, 0.5, 120.0)],
                },
            ],
        };
        let text = to_inkml(&ink);
        let back = from_inkml(&text).unwrap();
        assert_eq!(back.strokes.len(), 2);
        for (a, b) in ink.strokes.iter().zip(&back.strokes) {
            assert_eq!(a.brush.color, b.brush.color);
            assert_eq!(a.brush.tip, b.brush.tip);
            assert_eq!(a.brush.highlighter, b.brush.highlighter);
            assert_eq!(a.brush.transparency, b.brush.transparency);
            assert!(
                (a.brush.width - b.brush.width).abs() < 0.05,
                "{} {}",
                a.brush.width,
                b.brush.width
            );
            assert_eq!(a.samples.len(), b.samples.len());
            for (p, q) in a.samples.iter().zip(&b.samples) {
                // Un centesimo di millimetro è 0,0283 punti.
                assert!(
                    (p.x - q.x).abs() < 0.03 && (p.y - q.y).abs() < 0.03,
                    "{p:?} {q:?}"
                );
                assert!((p.p.unwrap() - q.p.unwrap()).abs() < 1e-4);
                assert_eq!(p.t, q.t);
            }
        }
        // Lo stesso pennello si scrive una volta.
        assert_eq!(text.matches("<inkml:brush ").count(), 2);
    }

    #[test]
    fn legge_le_differenze_di_word() {
        // Un tratto come lo scrive Word: esplicito, poi differenze prime e
        // seconde, con canali che mancano.
        let text = r##"<?xml version="1.0" encoding="UTF-8"?>
<inkml:ink xmlns:inkml="http://www.w3.org/2003/InkML">
  <inkml:definitions>
    <inkml:context xml:id="ctx0">
      <inkml:inkSource xml:id="inkSrc0">
        <inkml:traceFormat>
          <inkml:channel name="X" type="integer" max="32767" units="cm"/>
          <inkml:channel name="Y" type="integer" max="32767" units="cm"/>
          <inkml:channel name="F" type="integer" max="4095" units="dev"/>
          <inkml:channel name="T" type="integer" max="2.14748E9" units="dev"/>
        </inkml:traceFormat>
        <inkml:channelProperties>
          <inkml:channelProperty channel="X" name="resolution" value="1000" units="1/cm"/>
          <inkml:channelProperty channel="Y" name="resolution" value="1000" units="1/cm"/>
          <inkml:channelProperty channel="F" name="resolution" value="0" units="1/dev"/>
          <inkml:channelProperty channel="T" name="resolution" value="1" units="1/dev"/>
        </inkml:channelProperties>
      </inkml:inkSource>
      <inkml:timestamp xml:id="ts0" timeString="2026-10-27T10:00:00.000"/>
    </inkml:context>
    <inkml:brush xml:id="br0">
      <inkml:brushProperty name="width" value="0.05" units="cm"/>
      <inkml:brushProperty name="height" value="0.05" units="cm"/>
      <inkml:brushProperty name="color" value="#E71224"/>
    </inkml:brush>
  </inkml:definitions>
  <inkml:trace contextRef="#ctx0" brushRef="#br0">1000 2000 2048 0, '10 '-5 '0 '8, "2 "1 0 8, !1100 !2000</inkml:trace>
</inkml:ink>"##;
        let ink = from_inkml(text).unwrap();
        assert_eq!(ink.strokes.len(), 1);
        let stroke = &ink.strokes[0];
        assert_eq!(stroke.brush.color, "#e71224");
        assert!((stroke.brush.width - 0.05 / CM_PER_PT).abs() < 1e-9);
        let xs: Vec<i64> = stroke
            .samples
            .iter()
            .map(|s| (s.x / (1.0 / CM_PER_PT / 1000.0)).round() as i64)
            .collect();
        let ys: Vec<i64> = stroke
            .samples
            .iter()
            .map(|s| (s.y / (1.0 / CM_PER_PT / 1000.0)).round() as i64)
            .collect();
        // 1000; +10; +(10+2); poi esplicito 1100.
        assert_eq!(xs, vec![1000, 1010, 1022, 1100]);
        // 2000; -5; -5+1=-4; ancora esplicito 2000.
        assert_eq!(ys, vec![2000, 1995, 1991, 2000]);
        assert!((stroke.samples[0].p.unwrap() - 2048.0 / 4095.0).abs() < 1e-9);
        let ts: Vec<f64> = stroke.samples.iter().map(|s| s.t).collect();
        // Il modo di un canale resta finché un altro segno non lo cambia: nel
        // terzo punto F e T sono ancora differenze prime; nel quarto mancano,
        // e ripetono il valore di prima.
        assert_eq!(ts, vec![0.0, 8.0, 16.0, 16.0]);
    }

    #[test]
    fn senza_contesto_x_e_y_sono_della_pagina() {
        let ink = from_inkml(
            r#"<ink xmlns="http://www.w3.org/2003/InkML"><trace>10 0, 20 5, 30 10</trace></ink>"#,
        )
        .unwrap();
        assert_eq!(
            ink.strokes[0]
                .samples
                .iter()
                .map(|s| (s.x, s.y))
                .collect::<Vec<_>>(),
            vec![(10.0, 0.0), (20.0, 5.0), (30.0, 10.0)]
        );
        assert_eq!(ink.strokes[0].samples[0].p, None);
    }

    #[test]
    fn i_gruppi_danno_il_pennello() {
        let ink = from_inkml(
            r##"<ink><definitions><brush xml:id="b"><brushProperty name="color" value="#00FF00"/></brush></definitions><traceGroup brushRef="#b"><trace>0 0, 1 1</trace></traceGroup></ink>"##,
        )
        .unwrap();
        assert_eq!(ink.strokes[0].brush.color, "#00ff00");
    }

    #[test]
    fn cio_che_non_si_capisce_e_un_errore() {
        assert_eq!(from_inkml("<svg/>"), Err(InkmlError::NotInk));
        assert!(matches!(
            from_inkml("<ink><trace>1 2"),
            Err(InkmlError::Malformed(_))
        ));
        assert!(matches!(
            from_inkml("<ink><trace>1 ? 2</trace></ink>"),
            Err(InkmlError::Unsupported(_))
        ));
        assert!(matches!(
            from_inkml(
                r##"<ink><context xml:id="c"><traceFormat><channel name="X" units="parsec"/><channel name="Y"/></traceFormat></context><trace contextRef="#c">1 2</trace></ink>"##
            ),
            Err(InkmlError::Unsupported(_))
        ));
        assert!(matches!(
            from_inkml(r##"<ink><trace contextRef="#nessuno">1 2</trace></ink>"##),
            Err(InkmlError::Unsupported(_))
        ));
    }
}
