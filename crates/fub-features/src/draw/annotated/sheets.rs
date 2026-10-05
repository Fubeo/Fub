//! Le annotazioni di una pagina come un SVG a sé.
//!
//! L'editor mostra una pagina alla volta: i gruppi di quella pagina, con le
//! risorse della radice (definizioni, stili) e niente di ciò che sta fuori
//! dalle pagine. Qui si fa lo stesso sul testo del `.fubann`: per ogni pagina
//! annotata un documento con il prologo e la radice del file, la radice
//! misurata sulla pagina del PDF, le risorse e i gruppi della pagina, presi
//! byte per byte dalla sorgente. Così un'entità della DTD, uno stile o un
//! gradiente valgono come nell'editor, e il disegno è quello di `usvg` sul
//! testo scritto, non su una sua riscrittura.
//!
//! Di ogni pagina ci sono due copie. Quella **fedele** è il disegno che va nel
//! PDF. Quella **marcata** serve a leggere che cosa c'è: ogni `rect` e ogni
//! nota ricevono un id riconoscibile, e una nota che non mostra testo riceve
//! un carattere, così `usvg` ne calcola il posto. La copia marcata non si
//! disegna mai.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::ops::Range;

use fub_scene::Annotations;
use resvg::usvg::{roxmltree, Group, Node, Paint, Tree};

const NS_SVG: &str = "http://www.w3.org/2000/svg";
const NS_FUB: &str = "https://fubeo.github.io/ns/scene/1";
const NS_XLINK: &str = "http://www.w3.org/1999/xlink";

/// Gli elementi SVG che non disegnano e che un elemento di una pagina può
/// nominare: come nel pittore dell'editor, meno quelli che nessuno nomina
/// (titolo, descrizione, metadati, script, cursori, viste).
const RESOURCES: [&str; 13] = [
    "defs",
    "style",
    "linearGradient",
    "radialGradient",
    "pattern",
    "clipPath",
    "mask",
    "filter",
    "marker",
    "symbol",
    "font",
    "font-face",
    "color-profile",
];

/// I figli della radice che l'editor non conta fra gli elementi fuori dalle
/// pagine.
const UNDRAWN: [&str; 6] = ["title", "desc", "metadata", "defs", "style", "script"];

/// Gli attributi della radice che fanno la vista: sulla pagina li mette la
/// pagina, come nell'editor. Lo `style` resta.
const ROOT_VIEW: [&str; 7] = [
    "x",
    "y",
    "width",
    "height",
    "viewBox",
    "preserveAspectRatio",
    "transform",
];

/// L'inizio degli id della copia marcata: un carattere dell'area privata di
/// Unicode, che un id scritto da una persona non usa.
const MARK: char = '\u{E000}';

/// Il carattere che la copia marcata dà a una nota che non mostra testo.
const SHOWN: char = '\u{B7}';

/// Che cosa dice `fub:annotates`.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Annotates {
    /// Non c'è: vale il nome del file.
    Absent,
    /// Un percorso del vault, com'è scritto.
    Vault(String),
    /// Un indirizzo esterno o un valore che non nomina un file del vault.
    Other,
}

/// Una nota di una pagina.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Note {
    /// L'id dell'elemento, se ne ha uno: diventa il nome dell'annotazione
    /// del PDF.
    pub(super) id: Option<String>,
    /// Il corpo, con gli a capo come `\n`.
    pub(super) body: String,
    /// Vero se la nota mostra un testo sulla pagina; senza, nel PDF ha
    /// un'icona.
    pub(super) drawn: bool,
    /// L'id che la nota ha nella copia marcata.
    mark: String,
}

/// I gruppi di una pagina e ciò che contengono.
#[derive(Default)]
struct Page {
    groups: Vec<Range<usize>>,
    /// Le modifiche della copia marcata, in ordine e senza sovrapposizioni.
    edits: Vec<(Range<usize>, String)>,
    /// Gli id dei `rect` nella copia marcata.
    rects: BTreeSet<String>,
    /// Gli id, nella copia marcata, dei `use` che richiamano un `rect`:
    /// `usvg` ne disegna una copia senza id, dentro il gruppo del `use`.
    uses: BTreeSet<String>,
    notes: Vec<Note>,
    /// La misura scritta in `fub:page-size` dal primo gruppo che ne ha una.
    size: Option<[f64; 2]>,
}

/// Le pagine annotate di un `.fubann`.
pub(super) struct Sheets<'a> {
    source: &'a str,
    /// Dove comincia il tag d'apertura della radice: ciò che precede è il
    /// prologo.
    root: usize,
    /// Il tag d'apertura della radice senza gli attributi della vista e senza
    /// la chiusura `>`.
    open: String,
    /// Il tag di chiusura della radice.
    close: String,
    resources: Vec<Range<usize>>,
    pages: BTreeMap<u32, Page>,
    /// Gli elementi fuori dalle pagine che l'editor conta e non mostra.
    pub(super) outside: usize,
    pub(super) annotates: Annotates,
}

impl<'a> Sheets<'a> {
    /// Le pagine di `source`, il testo intero del `.fubann`, letto da
    /// `annotations`: i gruppi di pagina e le note sono quelli del lettore
    /// del formato, ritrovati qui per posizione.
    pub(super) fn read(source: &'a str, annotations: &Annotations) -> Result<Sheets<'a>, String> {
        let options = roxmltree::ParsingOptions {
            allow_dtd: true,
            ..roxmltree::ParsingOptions::default()
        };
        let doc = roxmltree::Document::parse_with_options(source, options)
            .map_err(|error| format!("the annotations are not readable XML: {error}"))?;
        let root = doc.root_element();
        let start = root.range().start;
        let tag_end = start_tag_end(source, start)
            .ok_or_else(|| "the annotations have no complete root tag".to_string())?;
        let name = qualified_name(source, start);
        let mut cuts: Vec<Range<usize>> = root
            .attributes()
            .filter(|attr| attr.namespace().is_none() && ROOT_VIEW.contains(&attr.name()))
            .map(|attr| attr.range())
            .collect();
        cuts.sort_by_key(|cut| cut.start);
        let mut open = String::new();
        let mut at = start;
        for cut in cuts {
            open.push_str(&source[at..cut.start]);
            at = cut.end;
        }
        let tag = source[at..tag_end].trim_end_matches(char::is_whitespace);
        open.push_str(tag.strip_suffix('/').unwrap_or(tag));

        let annotates = match root.attribute((NS_FUB, "annotates")) {
            None => Annotates::Absent,
            Some(_) => match &annotations.annotates {
                Some(annotated) => Annotates::Vault(annotated.path.clone()),
                None => Annotates::Other,
            },
        };

        let ids = ids(&doc);
        let numbers: BTreeMap<usize, &fub_scene::Page> = annotations
            .pages
            .iter()
            .map(|page| (page.span.bytes[0], page))
            .collect();
        let mut sheets = Sheets {
            source,
            root: start,
            open,
            close: format!("</{name}>"),
            resources: Vec::new(),
            pages: BTreeMap::new(),
            outside: 0,
            annotates,
        };
        let mut groups = Vec::new();
        for child in root.children().filter(|node| node.is_element()) {
            let range = child.range();
            if let Some(page) = numbers.get(&range.start) {
                groups.push((page.number, page.size, child));
                continue;
            }
            let svg = child.tag_name().namespace() == Some(NS_SVG);
            let local = child.tag_name().name();
            if svg && RESOURCES.contains(&local) {
                sheets.resources.push(range);
            }
            if !(svg && UNDRAWN.contains(&local)) {
                sheets.outside += 1;
            }
        }
        if groups.len() != annotations.pages.len() {
            return Err("the page groups of the annotations could not be found".to_string());
        }

        let notes: BTreeMap<usize, &fub_scene::Note> = annotations
            .notes
            .iter()
            .map(|note| (note.span.bytes[0], note))
            .collect();
        let rect_ids: BTreeSet<&str> = doc
            .descendants()
            .filter(|node| {
                node.tag_name().namespace() == Some(NS_SVG) && node.tag_name().name() == "rect"
            })
            .filter_map(|node| node.attribute("id"))
            .filter(|id| ids.contains(*id))
            .collect();
        let mut rects = 0usize;
        let mut uses = 0usize;
        let mut marked = 0usize;
        for (number, size, group) in groups {
            let page = sheets.pages.entry(number).or_default();
            page.groups.push(group.range());
            page.size = page.size.or(size);
            for node in group.descendants().filter(|node| node.is_element()) {
                let element = node.tag_name();
                if element.namespace() != Some(NS_SVG) {
                    continue;
                }
                if element.name() == "rect" {
                    let mark = format!("{MARK}r{rects}");
                    rects += 1;
                    let id = identify(source, node, &ids, &mark, &mut page.edits);
                    page.rects.insert(id);
                } else if element.name() == "use" && uses_rect(node, &rect_ids) {
                    let mark = format!("{MARK}u{uses}");
                    uses += 1;
                    let id = identify(source, node, &ids, &mark, &mut page.edits);
                    page.uses.insert(id);
                } else if let Some(note) = notes.get(&node.range().start) {
                    let mark = format!("{MARK}n{marked}");
                    marked += 1;
                    let mark = identify(source, node, &ids, &mark, &mut page.edits);
                    let drawn = !note.text.chars().all(char::is_whitespace);
                    if !drawn {
                        show(source, node, note, &mut page.edits);
                    }
                    page.notes.push(Note {
                        id: node.attribute("id").map(str::to_string),
                        body: note.body.clone(),
                        drawn,
                        mark,
                    });
                }
            }
            page.edits.sort_by_key(|(range, _)| range.start);
        }
        Ok(sheets)
    }

    /// I numeri delle pagine annotate, in ordine.
    pub(super) fn numbers(&self) -> Vec<u32> {
        self.pages.keys().copied().collect()
    }

    /// La misura che il primo gruppo della pagina scrive in `fub:page-size`.
    pub(super) fn written_size(&self, number: u32) -> Option<[f64; 2]> {
        self.pages.get(&number).and_then(|page| page.size)
    }

    /// Le note della pagina, in ordine di documento.
    pub(super) fn notes(&self, number: u32) -> &[Note] {
        self.pages
            .get(&number)
            .map_or(&[], |page| page.notes.as_slice())
    }

    /// Il disegno della pagina `number`, misurato `size` (larghezza e altezza
    /// della pagina come si mostra).
    pub(super) fn svg(&self, number: u32, size: (f64, f64)) -> String {
        self.assemble(number, size, false)
    }

    /// La copia marcata della pagina: vedi [`read_marks`].
    pub(super) fn marked(&self, number: u32, size: (f64, f64)) -> String {
        self.assemble(number, size, true)
    }

    fn assemble(&self, number: u32, (width, height): (f64, f64), marked: bool) -> String {
        let source = self.source;
        let mut out = String::with_capacity(source.len());
        out.push_str(&source[..self.root]);
        out.push_str(&self.open);
        let _ = write!(
            out,
            " width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\">"
        );
        for range in &self.resources {
            out.push_str(&source[range.clone()]);
        }
        if let Some(page) = self.pages.get(&number) {
            let mut edits = page.edits.iter().peekable();
            for group in &page.groups {
                let mut at = group.start;
                while let Some((range, text)) =
                    edits.next_if(|(range, _)| marked && range.start < group.end)
                {
                    out.push_str(&source[at..range.start]);
                    out.push_str(text);
                    at = range.end;
                }
                out.push_str(&source[at..group.end]);
            }
        }
        out.push_str(&self.close);
        out
    }
}

/// Ciò che la copia marcata di una pagina dice.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Reading {
    /// Quante coperture: `rect` che si vedono, pieni di un colore opaco.
    pub(super) covers: usize,
    /// Quanti altri segni nascondono ciò che hanno sotto: tracciati con un
    /// riempimento opaco, come un tratto di penna, e immagini. Non sono
    /// coperture, e una pagina che ha solo loro non si redige.
    pub(super) opaque: usize,
    /// Per ogni nota della pagina, nell'ordine di [`Sheets::notes`], il
    /// riquadro del suo testo in coordinate delle annotazioni (`[x0 y0 x1
    /// y1]`); `None` se la nota non si vede.
    pub(super) notes: Vec<Option<[f64; 4]>>,
}

/// Legge l'albero della copia marcata della pagina `number`.
///
/// Una **copertura** è un `rect` che si vede e copre ciò che ha sotto: il suo
/// riempimento è di un colore pieno, con opacità 1, e nessun gruppo che lo
/// contiene lo rende trasparente. Il tratto non conta: una copertura con il
/// bordo copre comunque. Un gradiente copre se tutte le sue fermate sono
/// opache, un motivo si conta sempre: per la redazione è meglio una pagina in
/// più che una in meno.
///
/// Gli altri segni opachi si contano con la stessa regola sul riempimento,
/// senza guardare il tratto: un contorno o una freccia coprono una linea, non
/// un'area.
pub(super) fn read_marks(sheets: &Sheets<'_>, number: u32, tree: &Tree) -> Reading {
    let Some(page) = sheets.pages.get(&number) else {
        return Reading::default();
    };
    let mut reading = Reading {
        covers: 0,
        opaque: 0,
        notes: vec![None; page.notes.len()],
    };
    let marks: BTreeMap<&str, usize> = page
        .notes
        .iter()
        .enumerate()
        .map(|(index, note)| (note.mark.as_str(), index))
        .collect();
    walk(
        tree.root(),
        1.0,
        false,
        &page.uses,
        &mut |node, opacity, used| match node {
            Node::Path(path) => {
                let covers = path.is_visible()
                    && opacity >= 1.0
                    && path
                        .fill()
                        .is_some_and(|fill| fill.opacity().get() >= 1.0 && opaque(fill.paint()));
                if covers && (used || page.rects.contains(path.id())) {
                    reading.covers += 1;
                } else if covers {
                    reading.opaque += 1;
                }
            }
            Node::Image(image) if image.is_visible() && opacity >= 1.0 => reading.opaque += 1,
            Node::Text(text) => {
                if let Some(&index) = marks.get(text.id()) {
                    let rect = node.abs_bounding_box();
                    reading.notes[index] = Some([
                        f64::from(rect.left()),
                        f64::from(rect.top()),
                        f64::from(rect.right()),
                        f64::from(rect.bottom()),
                    ]);
                }
            }
            _ => {}
        },
    );
    reading
}

/// Ogni nodo dell'albero con l'opacità che gli danno i gruppi che lo
/// contengono, e se sta dentro uno dei `use` di `uses`. Il testo non si apre:
/// le sue forme non sono coperture.
fn walk(
    group: &Group,
    opacity: f32,
    used: bool,
    uses: &BTreeSet<String>,
    visit: &mut impl FnMut(&Node, f32, bool),
) {
    for node in group.children() {
        visit(node, opacity, used);
        if let Node::Group(inner) = node {
            let used = used || uses.contains(inner.id());
            walk(inner, opacity * inner.opacity().get(), used, uses, visit);
        }
    }
}

/// Vero se il `use` richiama un `rect` del documento: con `href`, che in SVG
/// 2 vince, o con `xlink:href`.
fn uses_rect(node: roxmltree::Node<'_, '_>, rect_ids: &BTreeSet<&str>) -> bool {
    node.attributes()
        .find(|attr| attr.namespace().is_none() && attr.name() == "href")
        .or_else(|| {
            node.attributes()
                .find(|attr| attr.namespace() == Some(NS_XLINK) && attr.name() == "href")
        })
        .and_then(|attr| attr.value().strip_prefix('#'))
        .is_some_and(|id| rect_ids.contains(id))
}

fn opaque(paint: &Paint) -> bool {
    match paint {
        Paint::Color(_) | Paint::Pattern(_) => true,
        Paint::LinearGradient(gradient) => {
            gradient.stops().iter().all(|s| s.opacity().get() >= 1.0)
        }
        Paint::RadialGradient(gradient) => {
            gradient.stops().iter().all(|s| s.opacity().get() >= 1.0)
        }
    }
}

/// Gli id del documento che compaiono una volta sola: un id ripetuto non
/// riconosce il suo elemento.
fn ids(doc: &roxmltree::Document<'_>) -> BTreeSet<String> {
    let mut seen = BTreeMap::<&str, usize>::new();
    for node in doc.descendants() {
        if let Some(id) = node.attribute("id") {
            *seen.entry(id).or_default() += 1;
        }
    }
    seen.into_iter()
        .filter(|(_, count)| *count == 1)
        .map(|(id, _)| id.to_string())
        .collect()
}

/// L'id con cui l'elemento si riconosce nella copia marcata: il suo, se è
/// unico, così un `<use>` che lo nomina resta valido; altrimenti `mark`, che
/// la copia marcata gli scrive.
fn identify(
    source: &str,
    node: roxmltree::Node<'_, '_>,
    ids: &BTreeSet<String>,
    mark: &str,
    edits: &mut Vec<(Range<usize>, String)>,
) -> String {
    match node
        .attributes()
        .find(|attr| attr.namespace().is_none() && attr.name() == "id")
    {
        Some(attr) if ids.contains(attr.value()) => attr.value().to_string(),
        Some(attr) => {
            edits.push((attr.range_value(), mark.to_string()));
            mark.to_string()
        }
        None => {
            let at = node.range().start + 1 + qualified_name(source, node.range().start).len();
            edits.push((at..at, format!(" id=\"{mark}\"")));
            mark.to_string()
        }
    }
}

/// Dà un carattere a una nota che non mostra testo: un tag autochiuso diventa
/// un elemento con il carattere dentro, uno vuoto lo riceve in testa.
fn show(
    source: &str,
    node: roxmltree::Node<'_, '_>,
    note: &fub_scene::Note,
    edits: &mut Vec<(Range<usize>, String)>,
) {
    match note.content {
        Some(content) => {
            let at = content.bytes[0];
            edits.push((at..at, SHOWN.to_string()));
        }
        None => {
            let end = node.range().end;
            let name = qualified_name(source, node.range().start);
            edits.push((end - 2..end, format!(">{SHOWN}</{name}>")));
        }
    }
}

/// Il nome qualificato del tag che comincia a `start` (il `<`).
fn qualified_name(source: &str, start: usize) -> &str {
    let rest = &source[start + 1..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .unwrap_or(rest.len());
    &rest[..end]
}

/// Dove finisce il tag d'apertura che comincia a `start`: la posizione del
/// `>` che lo chiude, fuori dai valori fra virgolette.
fn start_tag_end(source: &str, start: usize) -> Option<usize> {
    let mut quote = None;
    for (offset, byte) in source.as_bytes()[start..].iter().enumerate() {
        match (quote, byte) {
            (None, b'"' | b'\'') => quote = Some(*byte),
            (Some(open), _) if open == *byte => quote = None,
            (None, b'>') => return Some(start + offset),
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEAD: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1""#;

    fn sheets(source: &str) -> (Annotations, Sheets<'_>) {
        let annotations = fub_scene::read_annotations(source).expect("annotazioni leggibili");
        let sheets = Sheets::read(source, &annotations).expect("pagine leggibili");
        (annotations, sheets)
    }

    /// L'albero con le opzioni dell'export: senza caratteri `usvg` toglie il
    /// testo, e le note con lui.
    fn tree(svg: &str) -> Tree {
        let refused = std::sync::Arc::new(std::sync::Mutex::new(crate::draw::Refused::default()));
        Tree::from_str(svg, &crate::draw::options(&refused, None)).expect("SVG leggibile")
    }

    #[test]
    fn a_page_keeps_its_groups_the_resources_and_the_prolog() {
        let source = format!(
            "\u{FEFF}<?xml version=\"1.0\"?>\n<!DOCTYPE svg [<!ENTITY c \"#d55e00\">]>\n\
             {HEAD} width=\"10\" viewBox=\"0 0 5 5\" style=\"color: red\" fub:annotates=\"Bando.pdf\">\
             <title>T</title><defs><linearGradient id=\"g\"/></defs>\
             <g id=\"p0001\" fub:page=\"1\"><rect width=\"5\" height=\"5\" fill=\"&c;\"/></g>\
             <rect id=\"fuori\" width=\"1\" height=\"1\"/>\
             <g id=\"p0002\" fub:page=\"2\"><circle r=\"1\"/></g>\
             <g fub:page=\"1\"><path d=\"M0 0 L1 1\"/></g></svg>"
        );
        let (_, sheets) = sheets(&source);
        assert_eq!(sheets.numbers(), vec![1, 2]);
        assert_eq!(sheets.outside, 1);
        assert_eq!(sheets.annotates, Annotates::Vault("Bando.pdf".to_string()));
        let svg = sheets.svg(1, (612.0, 792.0));
        assert!(svg.starts_with(
            "\u{FEFF}<?xml version=\"1.0\"?>\n<!DOCTYPE svg [<!ENTITY c \"#d55e00\">]>\n<svg "
        ));
        assert!(svg.contains(r#"style="color: red" fub:annotates="Bando.pdf" width="612" height="792" viewBox="0 0 612 792">"#));
        assert!(!svg.contains("viewBox=\"0 0 5 5\"") && !svg.contains("width=\"10\""));
        assert!(svg.contains("<defs><linearGradient id=\"g\"/></defs>"));
        assert!(!svg.contains("<title>") && !svg.contains("fuori") && !svg.contains("circle"));
        assert!(svg.contains("fill=\"&c;\"/></g><g fub:page=\"1\"><path"));
        assert!(svg.ends_with("</svg>"));
        // Il disegno si legge, con l'entità della DTD.
        let drawn = tree(&svg);
        assert_eq!(drawn.size().width(), 612.0);
    }

    #[test]
    fn the_annotated_pdf_is_read_from_the_root() {
        for (attrs, expected) in [
            ("", Annotates::Absent),
            (
                " fub:annotates=\"../Gare/Bando%20di%20gara.pdf\"",
                Annotates::Vault("../Gare/Bando%20di%20gara.pdf".to_string()),
            ),
            (
                " fub:annotates=\"https://example.org/a.pdf\"",
                Annotates::Other,
            ),
            (" fub:annotates=\"\"", Annotates::Other),
        ] {
            let source = format!("{HEAD}{attrs}><g fub:page=\"1\"/></svg>");
            let (_, sheets) = sheets(&source);
            assert_eq!(sheets.annotates, expected, "{attrs}");
        }
    }

    #[test]
    fn covers_are_opaque_visible_rects() {
        let source = format!(
            "{HEAD}><g fub:page=\"1\">\
             <rect id=\"nero\" x=\"1\" width=\"5\" height=\"5\" fill=\"#000000\"/>\
             <rect width=\"5\" height=\"5\" style=\"fill: white; stroke: red\"/>\
             <rect id=\"velato\" width=\"5\" height=\"5\" fill=\"#000\" fill-opacity=\"0.4\"/>\
             <g opacity=\"0.5\"><rect width=\"5\" height=\"5\" fill=\"#000\"/></g>\
             <rect width=\"5\" height=\"5\" fill=\"none\" stroke=\"#000\"/>\
             <rect width=\"5\" height=\"5\" fill=\"#000\" visibility=\"hidden\"/>\
             <path d=\"M0 0 H5 V5 H0 Z\" fill=\"#000\"/>\
             <rect id=\"doppio\" width=\"5\" height=\"5\" fill=\"#111\"/><rect id=\"doppio\" width=\"5\" height=\"5\" fill=\"#222\"/>\
             <defs><rect id=\"modello\" width=\"5\" height=\"5\" fill=\"#000\"/><g id=\"gruppo\"><rect width=\"5\" height=\"5\" fill=\"#000\"/></g></defs>\
             <use href=\"#modello\"/><use xmlns:xl=\"http://www.w3.org/1999/xlink\" xl:href=\"#modello\" x=\"3\"/>\
             <use href=\"#gruppo\"/>\
             </g></svg>"
        );
        let (_, sheets) = sheets(&source);
        let marked = sheets.marked(1, (100.0, 100.0));
        // Il nero, il bianco col bordo, i due doppi e il modello usato due
        // volte, con `href` e con `xlink:href`.
        let reading = read_marks(&sheets, 1, &tree(&marked));
        assert_eq!(reading.covers, 6, "{marked}");
        // Il tracciato pieno e il rettangolo dentro il gruppo usato non sono
        // coperture, ma nascondono.
        assert_eq!(reading.opaque, 2, "{marked}");
        // La copia fedele non cambia niente.
        let svg = sheets.svg(1, (100.0, 100.0));
        assert!(!svg.contains(MARK));
        assert!(svg.contains("<rect width=\"5\" height=\"5\" style=\"fill: white; stroke: red\"/>"));
    }

    #[test]
    fn a_note_has_its_body_and_the_box_of_its_text() {
        let source = format!(
            "{HEAD}><g fub:page=\"2\">\
             <text id=\"o1\" x=\"10\" y=\"20\" font-size=\"12\" fub:note=\"Primo&#10;secondo\"><tspan x=\"10\" dy=\"0\">Etichetta</tspan></text>\
             <text x=\"300\" y=\"400\" font-size=\"12\" fub:note=\"Solo corpo\"/>\
             <text x=\"50\" y=\"60\" font-size=\"12\" fub:note=\"Vuota\">  </text>\
             <text x=\"1\" y=\"1\" display=\"none\" fub:note=\"Nascosta\">Testo</text>\
             </g></svg>"
        );
        let (_, sheets) = sheets(&source);
        let notes = sheets.notes(2);
        assert_eq!(notes.len(), 4);
        assert_eq!(notes[0].id.as_deref(), Some("o1"));
        assert_eq!(notes[0].body, "Primo\nsecondo");
        assert!(notes[0].drawn && !notes[1].drawn && !notes[2].drawn && notes[3].drawn);
        assert_eq!(notes[1].id, None);
        let marked = sheets.marked(2, (595.0, 842.0));
        let reading = read_marks(&sheets, 2, &tree(&marked));
        let [first, alone, empty, hidden] = [
            reading.notes[0],
            reading.notes[1],
            reading.notes[2],
            reading.notes[3],
        ];
        let first = first.expect("la nota con l'etichetta si vede");
        assert!(
            first[0] >= 9.0 && first[0] <= 11.0 && first[3] >= 18.0 && first[3] <= 24.0,
            "{first:?}"
        );
        let alone = alone.expect("la nota col solo corpo ha un posto");
        assert!(
            alone[0] >= 299.0 && alone[0] <= 301.0 && alone[3] >= 398.0,
            "{alone:?}"
        );
        assert!(empty.is_some());
        assert_eq!(hidden, None);
        // Nella copia fedele la nota col solo corpo resta un tag autochiuso.
        assert!(sheets
            .svg(2, (595.0, 842.0))
            .contains("fub:note=\"Solo corpo\"/>"));
    }

    #[test]
    fn a_namespaced_root_closes_with_its_name() {
        let source = "<s:svg xmlns:s=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\"><s:g fub:page=\"1\"><s:text fub:note=\"N\" x=\"1\" y=\"9\"/></s:g></s:svg>";
        let (_, sheets) = sheets(source);
        let marked = sheets.marked(1, (20.0, 20.0));
        assert!(marked.contains(&format!(">{SHOWN}</s:text>")), "{marked}");
        assert!(marked.ends_with("</s:svg>"));
        assert!(read_marks(&sheets, 1, &tree(&marked)).notes[0].is_some());
    }

    #[test]
    fn the_start_tag_ends_outside_quotes() {
        assert_eq!(start_tag_end("<svg a=\">\" b='>'>x", 0), Some(16));
        assert_eq!(start_tag_end("<svg a=\">", 0), None);
    }
}
