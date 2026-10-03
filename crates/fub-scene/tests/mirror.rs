//! Le fixture della scena per la superficie TypeScript: SVG generati
//! qui, ognuno con ciò che Rust ne legge, perché i due lettori classifichino
//! allo stesso modo.
//!
//! Rigenera con `UPDATE_MIRROR=1 cargo test -p fub-scene --test mirror`.
//! Senza la variabile il test confronta i file byte per byte e fallisce alla
//! prima differenza.
//!
//! In `apps/client/src/__fixtures__/scene/`:
//!
//! - `sparse`: un disegno FubDraw in forma canonica (§7), con ogni ruolo di
//!   §4, tratti che si ridisegnano e tratti che no, un blocco estraneo dentro
//!   un gruppo e un livello bloccato e nascosto. Una lunghezza in pollici
//!   resta com'è, come FubDraw copia i valori che non tocca;
//! - `foreign`: un SVG di un altro programma, senza `fub:version`, con un
//!   esempio di ogni motivo per cui un elemento è estraneo, contenuto attivo,
//!   prologo ed epilogo;
//! - `crlf-bom`: un disegno FubDraw con BOM e righe CRLF, testo fuori dal piano
//!   base di Unicode e un commento su più righe: gli span UTF-16 si allontanano
//!   dai byte;
//! - `doctype`: un disegno con `DOCTYPE` ed entità interne, in sola lettura.
//!
//! Ogni `<nome>.svg` ha accanto `<nome>.json`: la [`Scene`] serializzata, con
//! due spazi di rientro e un a capo finale.
//!
//! Le fixture grandi, `dense` e `ink`, non si committano: si generano qui da un
//! seme fisso con mulberry32, lo stesso generatore di
//! `apps/client/bench/graph-fixture.ts`, e `generated.json` ne fissa la
//! lunghezza, l'impronta FNV-1a a 32 bit, il riepilogo e la diagnostica. Chi
//! le rigenera in TypeScript con l'algoritmo descritto su [`dense`] e [`ink`]
//! deve ottenere la stessa impronta. Sono solo ASCII: l'impronta sui byte e
//! quella sulle unità UTF-16 coincidono.

mod common;

use std::collections::BTreeMap;
use std::path::PathBuf;

use common::check_lossless;
use fub_scene::ink::INK_MAX_SAMPLES;
use fub_scene::{read, Ink, Item, Role, Sample, Scale, Scene, FUB_NS, MAX_ELEMENTS, SVG_NS};
use serde_json::json;

// ---------------------------------------------------------------------------
// Il confronto con i file.
// ---------------------------------------------------------------------------

/// La cartella delle fixture, dalla radice del crate.
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/scene")
}

const REGENERATE: &str = "rigenera con UPDATE_MIRROR=1 cargo test -p fub-scene --test mirror";

fn updating() -> bool {
    std::env::var_os("UPDATE_MIRROR").is_some()
}

/// Scrive `actual` in `name` con `UPDATE_MIRROR`; altrimenti pretende che il
/// file abbia esattamente quei byte.
fn mirror(name: &str, actual: &str) {
    let path = fixtures().join(name);
    if updating() {
        std::fs::create_dir_all(fixtures()).unwrap();
        std::fs::write(&path, actual).unwrap();
    }
    let expected = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("{name} non si legge ({error}): {REGENERATE}"));
    let actual = actual.as_bytes();
    if expected != actual {
        let at = expected
            .iter()
            .zip(actual)
            .position(|(a, b)| a != b)
            .unwrap_or(expected.len().min(actual.len()));
        let context = |bytes: &[u8]| {
            let end = (at + 60).min(bytes.len());
            String::from_utf8_lossy(&bytes[at.saturating_sub(20).min(end)..end]).into_owned()
        };
        panic!(
            "{name} differisce dal byte {at} ({} byte attesi, {} generati)\n\
             atteso:   {:?}\n\
             generato: {:?}\n\
             {REGENERATE}",
            expected.len(),
            actual.len(),
            context(&expected),
            context(actual),
        );
    }
}

/// La scena come la fixture la conserva.
fn expected_json(scene: &Scene) -> String {
    format!("{}\n", serde_json::to_string_pretty(scene).unwrap())
}

/// Legge `source`, ne verifica la copertura e scrive la coppia di fixture.
fn fixture(name: &str, source: &str) -> Scene {
    let scene = read(source).unwrap_or_else(|e| panic!("{name}: {e}"));
    check_lossless(source, &scene);
    mirror(&format!("{name}.svg"), source);
    mirror(&format!("{name}.json"), &expected_json(&scene));
    scene
}

// ---------------------------------------------------------------------------
// La scrittura canonica, quanto basta per generare.
// ---------------------------------------------------------------------------

/// Un nodo da scrivere: un elemento o una riga già fatta.
enum Node {
    Element(El),
    Raw(String),
}

/// Un elemento con gli attributi nell'ordine in cui li si dà.
struct El {
    name: &'static str,
    attrs: Vec<(&'static str, String)>,
    text: Option<String>,
    children: Vec<Node>,
}

impl El {
    fn new(name: &'static str) -> El {
        El {
            name,
            attrs: Vec::new(),
            text: None,
            children: Vec::new(),
        }
    }

    fn a(mut self, name: &'static str, value: impl ToString) -> El {
        self.attrs.push((name, value.to_string()));
        self
    }

    fn text(mut self, text: &str) -> El {
        self.text = Some(text.to_owned());
        self
    }

    fn child(mut self, child: El) -> El {
        self.children.push(Node::Element(child));
        self
    }

    fn raw(mut self, line: &str) -> El {
        self.children.push(Node::Raw(line.to_owned()));
        self
    }

    /// Scrive l'elemento come §7: una riga per elemento, due spazi di rientro
    /// per livello, il testo sulla riga del tag, i gruppi vuoti aperti.
    fn write(&self, depth: usize, newline: &str, out: &mut String) {
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
fn svg(width: u32, height: u32) -> El {
    El::new("svg")
        .a("xmlns", SVG_NS)
        .a("xmlns:fub", FUB_NS)
        .a("fub:version", 1)
        .a("viewBox", format!("0 0 {width} {height}"))
        .a("width", width)
        .a("height", height)
}

/// La carta (§2).
fn paper(width: u32, height: u32) -> El {
    El::new("rect")
        .a("id", "fub-paper")
        .a("fub:role", "paper")
        .a("x", 0)
        .a("y", 0)
        .a("width", width)
        .a("height", height)
        .a("fill", "#ffffff")
}

fn layer(id: &str, name: &str) -> El {
    El::new("g").a("id", id).a("fub:layer", name)
}

/// Il documento intero: radice, a capo finale.
fn document(root: &El, newline: &str) -> String {
    let mut out = String::new();
    root.write(0, newline, &mut out);
    out
}

/// `value` con `digits` decimali impliciti, scritto senza zeri finali e
/// senza esponente: `decimal(12050, 2)` è `120.5`. Solo aritmetica intera,
/// così TypeScript scrive le stesse cifre.
fn decimal(value: i64, digits: u32) -> String {
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
fn stroke(id: &str, tool: &str, at: &str, brush: &str, ink: &str, d: &str, fill: &str) -> El {
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
fn drawn(
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

const BRUSH: &str =
    "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1";

// ---------------------------------------------------------------------------
// Le quattro fixture committate.
// ---------------------------------------------------------------------------

/// `sparse`: l'esempio di §13 allargato a ogni ruolo.
fn sparse() -> String {
    let pen: Vec<Sample> = (0..12)
        .map(|i| {
            let i = f64::from(i);
            Sample {
                x: 120.5 + 2.5 * i + 0.013 * (i % 3.0),
                y: 30.2 - 0.37 * i,
                p: Some((100.0 + 10.0 * i) / 255.0),
                t: 8.0 * i,
                tilt: None,
            }
        })
        .collect();
    let highlighter: Vec<Sample> = (0..5)
        .map(|i| {
            let i = f64::from(i);
            Sample {
                x: 300.0 + 40.0 * i,
                y: 455.0,
                p: None,
                t: 16.0 * i,
                tilt: None,
            }
        })
        .collect();
    let group = El::new("g")
        .a("id", "o00000010")
        .a("transform", "matrix(0.866 0.5 -0.5 0.866 40 -20)")
        .child(
            El::new("rect")
                .a("id", "o00000011")
                .a("x", 900)
                .a("y", 100)
                .a("width", 160)
                .a("height", 90)
                .a("rx", 12)
                .a("fill", "#009e73"),
        )
        .child(
            El::new("circle")
                .a("id", "o00000012")
                .a("cx", 1200)
                .a("cy", 150)
                .a("r", 40)
                .a("fill", "#cc79a7"),
        )
        .child(
            El::new("line")
                .a("id", "o00000013")
                .a("x1", 900)
                .a("y1", 250)
                .a("x2", "1.5in")
                .a("y2", 250)
                .a("stroke", "#000000")
                .a("stroke-width", 2)
                .a("stroke-dasharray", "8 4"),
        )
        .child(
            El::new("polyline")
                .a("id", "o00000014")
                .a("points", "900,300 950,280 1000,320 1050,290")
                .a("fill", "none")
                .a("stroke", "#0072b2")
                .a("stroke-width", 3),
        )
        .child(
            El::new("polygon")
                .a("id", "o00000015")
                .a("points", "1100 300 1160 340 1080 360")
                .a("fill", "#d55e00")
                .a("opacity", "0.8"),
        )
        .child(
            El::new("path")
                .a("id", "o00000016")
                .a(
                    "d",
                    "M900 400 C950 350 1000 450 1050 400 A40 40 0 0 1 1130 400 Q1160 360 1190 400 Z",
                )
                .a("fill", "none")
                .a("stroke", "#000000")
                .a("stroke-width", 2),
        )
        .child(
            El::new("image")
                .a("id", "o00000017")
                .a("x", 1250)
                .a("y", 300)
                .a("width", 200)
                .a("height", 150)
                .a("preserveAspectRatio", "xMidYMid slice")
                .a("href", "foto/mare.png"),
        )
        // Un elemento estraneo dentro un gruppo modificabile: un blocco.
        .child(El::new("use").a("href", "#o1a2b3c4d").a("x", 10));
    let text = El::new("text")
        .a("id", "o9i0j1k2l")
        .a("x", 720)
        .a("y", 460)
        .a("fill", "#000000")
        .a("font-family", "Inter, sans-serif")
        .a("font-size", 32)
        .child(El::new("tspan").a("x", 720).a("dy", 0).text("Evaporazione"))
        .child(El::new("tspan").a("x", 720).a("dy", 40).text("& condensa"));
    let first = layer("l3f8a0c2d", "Livello 1")
        .child(
            El::new("ellipse")
                .a("id", "o1a2b3c4d")
                .a("cx", 300)
                .a("cy", 200)
                .a("rx", 120)
                .a("ry", 60)
                .a("fill", "none")
                .a("stroke", "#0072b2")
                .a("stroke-width", 4),
        )
        .child(
            El::new("path")
                .a("id", "o5e6f7g8h")
                .a("fub:shape", "arrow")
                .a("fub:geom", "420 200 700 420")
                .a(
                    "d",
                    "M420 200 L700 420 M682.18 417.45 L700 420 L693.3 403.29",
                )
                .a("fill", "none")
                .a("stroke", "#000000")
                .a("stroke-width", 4)
                .a("stroke-linecap", "round")
                .a("stroke-linejoin", "round"),
        )
        .child(text)
        .child(drawn(
            "o7k2m9x4q",
            "pen",
            "2026-10-01T09:20:31.250Z",
            &format!("{BRUSH} sim=0"),
            &pen,
            Scale::S100,
            "#d55e00",
        ))
        .child(drawn(
            "o00000001",
            "highlighter",
            "2026-10-01T09:20:33.000Z",
            &format!("{BRUSH} sim=1"),
            &highlighter,
            Scale::S10,
            "#f0e442",
        ))
        .child(group)
        .child(
            El::new("a")
                .a("id", "o00000020")
                .a("href", "note/acqua.md")
                .child(El::new("title").text("Il ciclo nella nota"))
                .child(
                    El::new("rect")
                        .a("id", "o00000021")
                        .a("x", 1400)
                        .a("y", 800)
                        .a("width", 120)
                        .a("height", 60)
                        .a("fill", "#56b4e9"),
                ),
        );
    let notes = layer("l9z8y7x6w", "Appunti")
        .a("fub:locked", "true")
        .a("display", "none")
        // Un inchiostro rotto: S004, il tratto si sposta ma non si ridisegna.
        .child(stroke(
            "o00000030",
            "pen",
            "2026-10-01T09:21:00.000Z",
            &format!("{BRUSH} sim=1"),
            "1 s100 cxy 0,0 1",
            "M0 0 L1 1 Z",
            "#000000",
        ))
        // Un canale sconosciuto: S010.
        .child(stroke(
            "o00000031",
            "pen",
            "2026-10-01T09:21:01.000Z",
            &format!("{BRUSH} sim=1"),
            "1 s10 cxytq 1000,1000,0,5 10,5,8,-5",
            "M100 100 L101 100.5 Z",
            "#000000",
        ))
        // Un arancione sulla carta bianca: S009.
        .child(drawn(
            "o00000032",
            "pen",
            "2026-10-01T09:21:02.000Z",
            &format!("{BRUSH} sim=1"),
            &highlighter,
            Scale::S100,
            "#e69f00",
        ))
        .child(
            El::new("image")
                .a("id", "o00000033")
                .a("x", 10)
                .a("y", 10)
                .a("width", 8)
                .a("height", 8)
                .a("href", "data:image/png;base64,iVBORw0KGgo="),
        )
        .child(El::new("g").a("id", "o00000034"));
    let root = svg(1600, 1000)
        .child(El::new("title").text("Ciclo dell'acqua"))
        .child(El::new("desc").text("Dal mare alle nuvole, e ritorno"))
        .child(paper(1600, 1000))
        .child(first)
        .child(notes);
    document(&root, "\n")
}

/// `foreign`: un SVG d'altri, con un esempio per regola di §4.
fn foreign() -> String {
    let root = El::new("svg")
        .a("xmlns", SVG_NS)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .a("xmlns:inkscape", "http://www.inkscape.org/namespaces/inkscape")
        .a("xmlns:sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")
        .a("width", "210mm")
        .a("height", "148mm")
        .a("viewBox", "0 0 210 148")
        .a("onload", "init()")
        .child(El::new("title").text("Mappa del quartiere"))
        .raw(r##"<defs><linearGradient id="cielo"><stop offset="0" stop-color="#56b4e9"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>"##)
        .raw("<style><![CDATA[ .strada { stroke: #999999; } ]]></style>")
        .raw(r#"<sodipodi:namedview id="vista" inkscape:zoom="1"/>"#)
        .child(
            El::new("g")
                .a("id", "strade")
                .a("inkscape:groupmode", "layer")
                .a("inkscape:label", "Strade")
                // Una classe CSS: estraneo.
                .raw(r#"<path class="strada" d="M10 10 H200"/>"#)
                .raw(r##"<path d="M10 20 H200" stroke="#999999" stroke-width="2"/>"##)
                // Un `d` malformato, una percentuale, un `url(`.
                .raw(r#"<path d="M10 30 L20"/>"#)
                .raw(r#"<rect x="5%" y="0" width="10" height="10"/>"#)
                .raw(r#"<rect x="20" y="40" width="30" height="20" fill="url(#cielo)"/>"#)
                // Un attributo di Inkscape non decide niente.
                .raw(r##"<rect x="60" y="40" width="30" height="20" rx="4" fill="#cc79a7" inkscape:label="Piazza"/>"##)
                // Un gestore di evento e un colore funzionale.
                .raw(r#"<circle cx="100" cy="50" r="5" onclick="apri()"/>"#)
                .raw(r#"<ellipse cx="120" cy="50" rx="6" ry="4" fill="rgb(0,0,0)"/>"#),
        )
        .child(
            El::new("g")
                .a("id", "etichette")
                .a("inkscape:groupmode", "layer")
                .a("inkscape:label", "Etichette")
                // Righe di Inkscape: `y` sui `tspan`, che §4 non ammette.
                .raw(r#"<text x="10" y="80" xml:space="preserve"><tspan sodipodi:role="line" x="10" y="80">Via Roma</tspan><tspan sodipodi:role="line" x="10" y="90">Piazza &amp; mercato</tspan></text>"#)
                // Testo fuori dai `tspan`: estraneo. Poi un `text` con le
                // righe di FubDraw, modificabile.
                .raw(r#"<text x="10" y="100" font-size="4.2333px">Scuola</text>"#)
                .raw(r#"<text x="10" y="110"><tspan x="10" dy="0">Parco</tspan></text>"#)
                .raw(r#"<a href="javascript:alert(1)"><text x="10" y="120">Clicca</text></a>"#)
                .raw(r#"<a xlink:href="quartiere/parco.md"><rect x="150" y="100" width="20" height="10"/></a>"#),
        )
        .raw(r#"<image x="150" y="10" width="40" height="30" href="https://example.org/foto.jpg"/>"#)
        .raw(r#"<image x="150" y="50" width="10" height="10" href="data:image/svg+xml,%3Csvg%2F%3E"/>"#)
        .raw(r##"<use href="#strade" x="0" y="5"/>"##)
        .raw(r#"<foreignObject x="0" y="130" width="100" height="18"><div xmlns="http://www.w3.org/1999/xhtml">Nota <b>importante</b></div></foreignObject>"#)
        .raw("<script>console.log('mai eseguito')</script>")
        .raw("<?elabora questa istruzione?>")
        .raw(r#"<polygon points="0,0 10,0 5"/>"#)
        .raw(r##"<polyline points="0,140 10,145 20,140" fill="none" stroke="#000000"/>"##);
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n\
         <!-- Creato da un altro programma -->\n\
         {}<!-- fine -->\n",
        document(&root, "\n")
    )
}

/// `crlf-bom`: BOM, CRLF e caratteri che in UTF-16 valgono due unità.
fn crlf_bom() -> String {
    let root = svg(800, 600)
        .child(El::new("title").text("Città di 東京 🌧"))
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello — uno")
                .raw("<!-- un commento\r\n     su due righe -->")
                .child(
                    El::new("text")
                        .a("id", "o00000001")
                        .a("x", 40)
                        .a("y", 80)
                        .a("font-family", "Literata, serif")
                        .a("font-size", 24)
                        .child(El::new("tspan").a("x", 40).a("dy", 0).text("Perché sì 😀"))
                        .child(El::new("tspan").a("x", 40).a("dy", 30).text("𝄞 e ♪")),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000002")
                        .a("x", 40)
                        .a("y", 200)
                        .a("width", 100)
                        .a("height", 50)
                        .a("fill", "#0072b2")
                        // Un attributo `fub:*` sconosciuto con un a capo.
                        .a("fub:nota", "prima riga\nseconda"),
                ),
        );
    format!("\u{feff}{}", document(&root, "\r\n"))
}

/// `doctype`: entità interne, nei namespace e nel testo.
fn doctype() -> String {
    let root = El::new("svg")
        .a("xmlns", "&ns_svg;")
        .a("xmlns:fub", "&ns_fub;")
        .a("fub:version", 1)
        .a("viewBox", "0 0 100 100")
        .a("width", 100)
        .a("height", 100)
        .raw("<title>&luogo; d'inverno</title>")
        .child(paper(100, 100))
        .child(
            layer("l00000001", "Livello 1")
                .child(
                    El::new("rect")
                        .a("id", "o00000001")
                        .a("x", 10)
                        .a("y", 10)
                        .a("width", 20)
                        .a("height", 20)
                        .a("fill", "#0072b2"),
                )
                .raw(r#"<text x="10" y="60"><tspan x="10" dy="0">&luogo;</tspan></text>"#),
        );
    // Gli escape del writer non toccano le entità: si rimettono a mano.
    let body = document(&root, "\n").replace("&amp;ns_", "&ns_");
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE svg [\n  \
         <!ENTITY ns_svg \"{SVG_NS}\">\n  \
         <!ENTITY ns_fub \"{FUB_NS}\">\n  \
         <!ENTITY luogo \"Giardino\">\n\
         ]>\n{body}"
    )
}

#[test]
fn sparse_is_a_complete_drawing() {
    let scene = fixture("sparse", &sparse());
    assert!(scene.editable());
    let summary = &scene.summary;
    assert_eq!(summary.layers, ["Livello 1", "Appunti"]);
    assert_eq!(
        (
            summary.counts.strokes,
            summary.counts.shapes,
            summary.counts.foreign
        ),
        (5, 9, 1)
    );
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::*;
    assert_eq!(codes, [S002, S004, S009, S010]);
    assert_eq!(scene.index.links.len(), 1);
    assert_eq!(scene.index.embeds.len(), 1);
}

#[test]
fn foreign_has_one_case_per_rule() {
    let scene = fixture("foreign", &foreign());
    assert!(!scene.editable());
    assert!(scene.summary.foreign);
    let editable: Vec<_> = scene
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Element(element) => Some((element.path.clone(), element.role)),
            _ => None,
        })
        .collect();
    assert!(editable.contains(&(vec![4, 1], Role::Path)));
    assert!(editable.contains(&(vec![4, 5], Role::Rect)));
    assert!(editable.contains(&(vec![5, 2], Role::Text)));
    assert!(editable.contains(&(vec![5, 4], Role::Link)));
    // Un'immagine remota resta modificabile; una spezzata dopo il blocco
    // pure.
    assert!(editable.contains(&(vec![6], Role::Image)));
    assert!(editable.contains(&(vec![12], Role::Polyline)));
    // Prologo, blocchi ed epilogo: nove blocchi estranei.
    assert_eq!(scene.summary.counts.foreign, 9);
    let s005 = scene
        .diagnostics
        .iter()
        .filter(|d| d.code == fub_scene::Code::S005)
        .count();
    assert_eq!(s005, 4);
}

#[test]
fn crlf_bom_moves_utf16_away_from_bytes() {
    let source = crlf_bom();
    let scene = fixture("crlf-bom", &source);
    assert!(scene.bom);
    assert_eq!(scene.line_ending, fub_scene::LineEnding::Crlf);
    assert!(scene.editable());
    let Some(Item::Element(text)) = scene
        .items
        .iter()
        .find(|item| matches!(item, Item::Element(e) if e.role == Role::Text))
    else {
        panic!("manca il testo")
    };
    assert_ne!(text.span.bytes, text.span.utf16);
    assert_eq!(
        text.lines.as_deref(),
        Some(["Perché sì 😀".to_owned(), "𝄞 e ♪".to_owned()].as_slice())
    );
}

#[test]
fn doctype_is_read_only() {
    let scene = fixture("doctype", &doctype());
    assert_eq!(scene.read_only, [fub_scene::ReadOnly::Doctype]);
    assert_eq!(scene.status, fub_scene::Status::Fubdraw);
    // Il titolo con un'entità è estraneo, ma l'indice lo legge.
    assert_eq!(
        scene.index.title.as_ref().map(|t| t.text.as_str()),
        Some("Giardino d'inverno")
    );
}

// ---------------------------------------------------------------------------
// Le fixture generate, fissate da `generated.json`.
// ---------------------------------------------------------------------------

/// mulberry32: il passo di `seedRandom` in `graph-fixture.ts`, ripetuto su
/// uno stato che avanza di `0x6d2b79f5` a ogni numero. Il `k`-esimo numero,
/// da zero, è `seedRandom(seed + k · 0x6d2b79f5)` per 2³², in aritmetica a
/// 32 bit.
struct Mulberry32(u32);

impl Mulberry32 {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }

    /// Un intero in `0..n`, col resto: il piccolo sbilanciamento non conta,
    /// conta che TypeScript lo rifaccia uguale.
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }

    /// `below(n)` diviso per `unit`, in doppia precisione.
    fn fraction(&mut self, n: u32, unit: u32) -> f64 {
        f64::from(self.below(n)) / f64::from(unit)
    }
}

/// FNV-1a a 32 bit sui byte, scritto in esadecimale su otto cifre.
fn fnv1a(text: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for &byte in text.as_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// La tavolozza Okabe–Ito di FubDraw, nell'ordine: nero, Blu, Vermiglio,
/// Verde, Porpora, Giallo, Arancione, Azzurro.
const PALETTE: [&str; 8] = [
    "#000000", "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#f0e442", "#e69f00", "#56b4e9",
];

const WORDS: [&str; 8] = [
    "mare", "nuvola", "pioggia", "fiume", "vento", "sole", "neve", "lago",
];

/// `count` punti a caso nella pagina, in centesimi, separati da spazi.
fn random_points(rng: &mut Mulberry32, count: u32) -> String {
    (0..count)
        .map(|_| {
            let x = rng.below(160_000);
            let y = rng.below(100_000);
            format!("{} {}", decimal(x.into(), 2), decimal(y.into(), 2))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `dense`: un disegno FubDraw di esattamente [`MAX_ELEMENTS`] elementi,
/// l'ultimo numero che si modifica ancora.
///
/// Radice, titolo «Denso», carta di 1600 × 1000 e otto livelli `l0000000k`
/// di nome «Livello k». Gli elementi rimasti si dividono in parti uguali fra i
/// livelli, il resto all'ultimo. In ogni livello, finché la sua quota non è
/// finita, si estrae `below(10)` e si scrive, con l'id `o` più il contatore
/// su otto cifre e i numeri in centesimi:
///
/// 0. `rect`: `x below(160000)`, `y below(100000)`, `width` e `height`
///    `1 + below(20000)`, `fill` della tavolozza `below(8)`;
/// 1. `ellipse`: `cx`, `cy`, `rx` e `ry` come sopra, `fill`;
/// 2. `circle`: `cx`, `cy`, `r 1 + below(10000)`, `fill`;
/// 3. `line`: due punti, `stroke` della tavolozza, `stroke-width 2`;
/// 4. `polyline`: `3 + below(4)` punti, `fill none`, `stroke`;
/// 5. `polygon`: `3 + below(4)` punti, `fill`;
/// 6. `path`: `M` più tre segmenti; per ognuno `below(4)` sceglie `L` (un
///    punto), `Q` (due), `C` (tre) o `A`: un arco di cerchio, col raggio
///    `1 + below(20000)` per `rx` e per `ry`, `0`, i due flag `below(2)` e
///    `below(2)` e un punto; poi `fill none`, `stroke`. Archi ellittici a
///    caso, con un raggio molto più piccolo dell'altro, si gonfierebbero di
///    milioni di unità per raggiungere il punto finale;
/// 7. `text`: il numero di righe `1 + below(3)`, estratto subito dopo il
///    tipo; poi `x`, `y`, `fill #000000`, `font-family Inter, sans-serif`,
///    `font-size 16`, e per ogni riga un `tspan` con la `x` del testo, `dy`
///    `0` la prima e `20` le altre, e la parola `below(8)` di [`WORDS`];
/// 8. un gruppo: `g` con `transform translate(dx dy)`, `dx below(1000)` e
///    `dy below(1000)` interi, poi un `rect` e un `circle` come sopra;
/// 9. un `use` con `href` verso l'ultimo oggetto scritto, anche di un
///    livello prima, o verso la carta se non ce n'è: estraneo.
///
/// Un `text` costa uno più le sue righe, un gruppo tre, ogni altro elemento
/// uno; quello che costa più della quota rimasta diventa un `rect`, con le
/// estrazioni del `rect`. Gli id si contano nell'ordine in cui gli elementi
/// si aprono: il gruppo prima del suo `rect` e del suo `circle`.
fn dense(seed: u32) -> String {
    const LAYERS: usize = 8;
    let mut rng = Mulberry32(seed);
    let mut next_id = 0u32;
    let mut id = || {
        next_id += 1;
        format!("o{next_id:08}")
    };
    let budget = MAX_ELEMENTS - 3 - LAYERS;
    let mut root = svg(1600, 1000)
        .child(El::new("title").text("Denso"))
        .child(paper(1600, 1000));
    let mut last = "fub-paper".to_owned();
    for k in 1..=LAYERS {
        let mut quota = budget / LAYERS + if k == LAYERS { budget % LAYERS } else { 0 };
        let mut group = layer(&format!("l{k:08}"), &format!("Livello {k}"));
        while quota > 0 {
            let mut kind = rng.below(10);
            let tspans = if kind == 7 { 1 + rng.below(3) } else { 0 };
            let cost = match kind {
                7 => 1 + tspans as usize,
                8 => 3,
                _ => 1,
            };
            if cost > quota {
                kind = 0;
            }
            let rect = |rng: &mut Mulberry32, id: String| {
                El::new("rect")
                    .a("id", id)
                    .a("x", decimal(rng.below(160_000).into(), 2))
                    .a("y", decimal(rng.below(100_000).into(), 2))
                    .a("width", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("height", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize])
            };
            let circle = |rng: &mut Mulberry32, id: String| {
                El::new("circle")
                    .a("id", id)
                    .a("cx", decimal(rng.below(160_000).into(), 2))
                    .a("cy", decimal(rng.below(100_000).into(), 2))
                    .a("r", decimal((1 + rng.below(10_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize])
            };
            let me = id();
            let element = match kind {
                0 => rect(&mut rng, me.clone()),
                1 => El::new("ellipse")
                    .a("id", &me)
                    .a("cx", decimal(rng.below(160_000).into(), 2))
                    .a("cy", decimal(rng.below(100_000).into(), 2))
                    .a("rx", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("ry", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize]),
                2 => circle(&mut rng, me.clone()),
                3 => {
                    let points = random_points(&mut rng, 2);
                    let p: Vec<&str> = points.split(' ').collect();
                    El::new("line")
                        .a("id", &me)
                        .a("x1", p[0])
                        .a("y1", p[1])
                        .a("x2", p[2])
                        .a("y2", p[3])
                        .a("stroke", PALETTE[rng.below(8) as usize])
                        .a("stroke-width", 2)
                }
                4 => {
                    let count = 3 + rng.below(4);
                    El::new("polyline")
                        .a("id", &me)
                        .a("points", random_points(&mut rng, count))
                        .a("fill", "none")
                        .a("stroke", PALETTE[rng.below(8) as usize])
                }
                5 => {
                    let count = 3 + rng.below(4);
                    El::new("polygon")
                        .a("id", &me)
                        .a("points", random_points(&mut rng, count))
                        .a("fill", PALETTE[rng.below(8) as usize])
                }
                6 => {
                    let mut d = format!("M{}", random_points(&mut rng, 1));
                    for _ in 0..3 {
                        match rng.below(4) {
                            0 => d.push_str(&format!(" L{}", random_points(&mut rng, 1))),
                            1 => d.push_str(&format!(" Q{}", random_points(&mut rng, 2))),
                            2 => d.push_str(&format!(" C{}", random_points(&mut rng, 3))),
                            _ => {
                                let r = decimal((1 + rng.below(20_000)).into(), 2);
                                let (large, sweep) = (rng.below(2), rng.below(2));
                                let to = random_points(&mut rng, 1);
                                d.push_str(&format!(" A{r} {r} 0 {large} {sweep} {to}"));
                            }
                        }
                    }
                    El::new("path")
                        .a("id", &me)
                        .a("d", d)
                        .a("fill", "none")
                        .a("stroke", PALETTE[rng.below(8) as usize])
                }
                7 => {
                    let x = decimal(rng.below(160_000).into(), 2);
                    let mut text = El::new("text")
                        .a("id", &me)
                        .a("x", &x)
                        .a("y", decimal(rng.below(100_000).into(), 2))
                        .a("fill", "#000000")
                        .a("font-family", "Inter, sans-serif")
                        .a("font-size", 16);
                    for line in 0..tspans {
                        let dy = if line == 0 { 0 } else { 20 };
                        let word = WORDS[rng.below(8) as usize];
                        text = text.child(El::new("tspan").a("x", &x).a("dy", dy).text(word));
                    }
                    text
                }
                8 => {
                    let transform = format!("translate({} {})", rng.below(1000), rng.below(1000));
                    El::new("g")
                        .a("id", &me)
                        .a("transform", transform)
                        .child(rect(&mut rng, id()))
                        .child(circle(&mut rng, id()))
                }
                _ => El::new("use").a("id", &me).a("href", format!("#{last}")),
            };
            last = me;
            quota -= if kind == 0 { 1 } else { cost };
            group = group.child(element);
        }
        root = root.child(group);
    }
    document(&root, "\n")
}

/// `ink`: quaranta tratti generati, campionati e quantizzati da Rust.
///
/// Titolo «Inchiostro», carta di 1600 × 1000, un livello `l00000001`
/// «Livello 1». Per il tratto `i`, nell'ordine:
///
/// 1. i campioni: 1 per `i = 0`, 2 per `i = 1`, [`INK_MAX_SAMPLES`] per
///    `i = 2`, altrimenti `2 + below(1500)`;
/// 2. la pressione se `below(2) = 1`, l'inclinazione se `below(2) = 1`;
/// 3. la scala: `s100` se `below(2) = 1`, altrimenti `s10`. Il tratto
///    `i = 2` ha comunque pressione, inclinazione e `s100`: il più lungo
///    possibile, con tutti i canali;
/// 4. l'evidenziatore se `below(8) = 0`, col Giallo; altrimenti la penna
///    col colore `below(8)` della tavolozza;
/// 5. il pennello `below(3)` di [`BRUSHES`], più `sim=1` senza pressione e
///    `sim=0` con;
/// 6. la pausa prima del tratto, `below(2000)` millisecondi.
///
/// Poi i campioni, ognuno con le estrazioni in quest'ordine: `x` e `y`, per il
/// primo `below(160000) / 100` e `below(100000) / 100`, per gli altri il
/// precedente più `(below(2001) − 1000) / 1000`; con la pressione
/// `p = below(1001) / 1000`; dal secondo campione `t`, il precedente più
/// `below(17001) / 1000`, mentre il primo ha `t = 0` e non estrae niente; con
/// l'inclinazione `a = below(90001) / 1000` e `z = below(360000) / 1000`. I
/// conti sono in doppia precisione, e `Ink::quantize` li arrotonda.
///
/// L'id è `o` più `i + 1` su otto cifre. `fub:at` è le 9:00 UTC del 2 ottobre
/// 2026 più le pause fino a questa compresa e le durate dei tratti precedenti,
/// cioè il loro `t` quantizzato finale. `d` è la spezzata dei campioni
/// quantizzati.
fn ink(seed: u32) -> (String, u64) {
    let mut rng = Mulberry32(seed);
    let mut layer = layer("l00000001", "Livello 1");
    let mut clock: u64 = 0;
    let mut total = 0u64;
    for i in 0..40u32 {
        let count = match i {
            0 => 1,
            1 => 2,
            2 => INK_MAX_SAMPLES as u32,
            _ => 2 + rng.below(1500),
        };
        let pressure = rng.below(2) == 1 || i == 2;
        let tilt = rng.below(2) == 1 || i == 2;
        let scale = if rng.below(2) == 1 || i == 2 {
            Scale::S100
        } else {
            Scale::S10
        };
        let highlighter = rng.below(8) == 0;
        let fill = if highlighter {
            PALETTE[5]
        } else {
            PALETTE[rng.below(8) as usize]
        };
        let brush = format!(
            "{} sim={}",
            BRUSHES[rng.below(3) as usize],
            u8::from(!pressure)
        );
        clock += u64::from(rng.below(2000));
        let mut samples = Vec::with_capacity(count as usize);
        let (mut x, mut y, mut t) = (0.0, 0.0, 0.0);
        for k in 0..count {
            if k == 0 {
                x = rng.fraction(160_000, 100);
                y = rng.fraction(100_000, 100);
            } else {
                x += (f64::from(rng.below(2001)) - 1000.0) / 1000.0;
                y += (f64::from(rng.below(2001)) - 1000.0) / 1000.0;
            }
            let p = pressure.then(|| rng.fraction(1001, 1000));
            if k > 0 {
                t += rng.fraction(17_001, 1000);
            }
            let tilt = tilt.then(|| (rng.fraction(90_001, 1000), rng.fraction(360_000, 1000)));
            samples.push(Sample { x, y, p, t, tilt });
        }
        let quantized = Ink::quantize(&samples, scale).unwrap();
        let (h, m, s, ms) = (
            9 + clock / 3_600_000,
            clock / 60_000 % 60,
            clock / 1000 % 60,
            clock % 1000,
        );
        let at = format!("2026-10-02T{h:02}:{m:02}:{s:02}.{ms:03}Z");
        let tool = if highlighter { "highlighter" } else { "pen" };
        layer = layer.child(drawn(
            &format!("o{:08}", i + 1),
            tool,
            &at,
            &brush,
            &samples,
            scale,
            fill,
        ));
        clock += quantized.duration().unwrap_or(0).max(0) as u64;
        total += quantized.len() as u64;
    }
    let root = svg(1600, 1000)
        .child(El::new("title").text("Inchiostro"))
        .child(paper(1600, 1000))
        .child(layer);
    (document(&root, "\n"), total)
}

const BRUSHES: [&str; 3] = [
    BRUSH,
    "pf1 size=8 thinning=0.6 smoothing=0.5 streamline=0.4 taperStart=12 taperEnd=12 capStart=0 capEnd=0",
    "pf1 size=2.5 thinning=-0.2 smoothing=0.7 streamline=0.6 taperStart=0 taperEnd=0 capStart=1 capEnd=1",
];

const DENSE_SEED: u32 = 0x2026_1002;
const INK_SEED: u32 = 0x2026_1003;

/// Quel che `generated.json` fissa di una fixture generata.
fn facts(seed: u32, source: &str, scene: &Scene) -> serde_json::Value {
    let mut codes: BTreeMap<String, usize> = BTreeMap::new();
    for diagnostic in &scene.diagnostics {
        *codes.entry(format!("{:?}", diagnostic.code)).or_default() += 1;
    }
    json!({
        "seed": seed,
        "bytes": source.len(),
        "fnv1a": fnv1a(source),
        "items": scene.items.len(),
        "diagnostics": codes,
        "summary": scene.summary,
    })
}

#[test]
fn generated_fixtures_are_pinned() {
    let source = dense(DENSE_SEED);
    assert!(source.is_ascii());
    // Senza commenti né istruzioni, ogni `<` che non chiude apre un elemento.
    let elements = source.matches('<').count() - source.matches("</").count();
    assert_eq!(elements, MAX_ELEMENTS);
    let dense_scene = read(&source).unwrap();
    check_lossless(&source, &dense_scene);
    // Esattamente al limite: ancora modificabile.
    assert!(dense_scene.editable(), "{:?}", dense_scene.read_only);
    let roles = |scene: &Scene, wanted: Role| {
        scene
            .items
            .iter()
            .filter(|item| matches!(item, Item::Element(e) if e.role == wanted))
            .count()
    };
    assert!(roles(&dense_scene, Role::Text) > 0 && roles(&dense_scene, Role::Group) > 0);
    let dense_facts = facts(DENSE_SEED, &source, &dense_scene);

    let (source, samples) = ink(INK_SEED);
    assert!(source.is_ascii());
    let ink_scene = read(&source).unwrap();
    check_lossless(&source, &ink_scene);
    assert!(ink_scene.editable());
    assert_eq!(ink_scene.summary.counts.strokes, 40);
    assert_eq!(ink_scene.summary.ink.samples, samples);
    // Ogni tratto si ridisegna: il codec rilegge ciò che ha scritto.
    for item in &ink_scene.items {
        if let Item::Element(element) = item {
            if let Some(stroke) = &element.stroke {
                assert!(stroke.redrawable, "{:?}", element.id);
            }
        }
    }
    let ink_facts = facts(INK_SEED, &source, &ink_scene);

    let pinned = json!({"dense": dense_facts, "ink": ink_facts});
    mirror(
        "generated.json",
        &format!("{}\n", serde_json::to_string_pretty(&pinned).unwrap()),
    );
}

#[test]
fn the_folder_holds_only_what_this_test_writes() {
    if updating() {
        // Gli altri test stanno scrivendo: si guarda al giro dopo.
        return;
    }
    let mut found: Vec<String> = std::fs::read_dir(fixtures())
        .unwrap_or_else(|error| {
            panic!("la cartella delle fixture non si legge ({error}): {REGENERATE}")
        })
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    found.sort();
    let mut expected: Vec<String> = ["sparse", "foreign", "crlf-bom", "doctype"]
        .iter()
        .flat_map(|name| [format!("{name}.json"), format!("{name}.svg")])
        .chain(["generated.json".to_owned()])
        .collect();
    expected.sort();
    assert_eq!(found, expected, "file in più o in meno: {REGENERATE}");
}

#[test]
fn the_generator_is_mulberry32() {
    // I primi numeri del seme 0, come li dà `seedRandom` di TypeScript.
    let mut rng = Mulberry32(0);
    let first = [rng.next(), rng.next(), rng.next()];
    assert_eq!(first, [1_144_304_738, 1_416_247, 958_946_056]);
    assert_eq!(fnv1a(""), "811c9dc5");
    assert_eq!(fnv1a("a"), "e40c292c");
    assert_eq!(decimal(12050, 2), "120.5");
    assert_eq!(decimal(-5, 2), "-0.05");
    assert_eq!(decimal(300, 2), "3");
}
