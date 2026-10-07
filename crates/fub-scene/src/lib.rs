//! Lettura delle scene FubDraw: SVG testuali con pochi attributi `fub:*`.
//!
//! Il contratto è il [formato della scena](../../../docs/reference/scene-format.md),
//! e i `§` dei commenti sono le sue sezioni. Questo crate lo legge e non scrive
//! niente: le operazioni le applica la shell
//! ([ADR 0203](../../../docs/decisions/0203-superfici-spaziali.md)), e qui si
//! decide soltanto che cosa della sorgente è modificabile, che cosa è estraneo
//! e dove sta, byte per byte.
//!
//! [`read`] restituisce una [`Scene`]: lo stato del documento, le voci in
//! ordine di documento con i loro span, ciò che ne legge l'indice (§9) e la
//! diagnostica di §12. La sorgente resta autorevole: ogni byte che non sta in
//! una voce è spazio fra due voci, e la scena non ne possiede una copia.
//!
//! [`Ink`] e [`Brush`] sono il codec di `fub:ink` e la lettura di `fub:brush`
//! (§5): la scena li usa per dire se un tratto si ridisegna, e chi scrive un
//! tratto li usa per quantizzarlo. [`rulers`] legge l'unità e le guide del
//! documento (formato della scena, unità e guide).
//!
//! Il crate è puro. Non dipende dall'ABI di Fub né dal kernel, non fa I/O e
//! compila per `wasm32-wasip2`: `crates/fub-abi/tests/dependency_invariant.rs`
//! lo verifica.

use std::fmt;

use serde::Serialize;

mod accessibility;
mod analysis;
mod brush;
mod classify;
mod diagnostics;
mod geometry;
pub mod ink;
pub mod parametric;
pub mod rulers;
pub mod text;
mod values;
pub mod varwidth;
mod xml;

pub use analysis::{
    BBox, Counts, Excerpt, Index, InkTotals, Reference, Summary, LARGE_BOLD_TEXT, LARGE_TEXT,
    MAX_IMAGE_BYTES, MIN_CONTRAST, MIN_TEXT_CONTRAST, MIN_TEXT_SIZE,
};
pub use brush::{Brush, BrushError, PF1, PF1_KEYS};
pub use classify::{ElementItem, ForeignItem, Item, Layer, Role, RootItem, Stroke, Tags, Tool};
pub use diagnostics::{Code, Diagnostic, Severity};
pub use ink::{Ink, InkError, Sample, Scale};
pub use text::{LineEnding, Span};
pub use xml::XmlErrorKind;

use crate::text::{bom_len, Utf16Map};
use crate::xml::{Kind, NS_FUB, NS_NONE};

/// Il namespace di SVG.
pub const SVG_NS: &str = "http://www.w3.org/2000/svg";
/// Il namespace degli attributi `fub:*` (§2).
pub const FUB_NS: &str = "https://fubeo.github.io/ns/scene/1";
/// Il namespace di XLink, per `xlink:href`.
pub const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

/// La versione del formato che questo lettore sa modificare.
pub const SUPPORTED_VERSION: u32 = 1;
/// La dimensione oltre la quale un file si apre in sola lettura e si
/// indicizzano solo titolo e riepilogo (§11).
pub const MAX_EDIT_BYTES: usize = 20 * 1024 * 1024;
/// Quanti elementi può avere un documento modificabile (§11).
pub const MAX_ELEMENTS: usize = 50_000;
/// Quanti contenitori modificabili si annidano al massimo sotto la radice: un
/// `g` o un `a` più profondo è estraneo, con tutto ciò che contiene. Ogni voce
/// porta il suo percorso intero, e senza un limite una catena di gruppi di
/// pochi megabyte chiederebbe gigabyte di percorsi.
pub const MAX_DEPTH: usize = 128;

/// Che documento è.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// La radice ha `fub:version`.
    Fubdraw,
    /// Un SVG senza `fub:version`: la superficie lo mostra inerte e lo adotta
    /// con «Modifica» (§2).
    Foreign,
}

/// Perché un documento si apre in sola lettura.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadOnly {
    /// C'è un `<!DOCTYPE>` (§8, S008).
    Doctype,
    /// La dichiarazione XML annuncia una codifica diversa da UTF-8: un altro
    /// lettore leggerebbe altri caratteri.
    Encoding,
    /// `fub:version` non è un intero positivo.
    InvalidVersion,
    /// `fub:version` è maggiore di [`SUPPORTED_VERSION`] (§10, S007).
    FutureVersion,
    /// Due elementi hanno lo stesso id (§7, S003).
    DuplicateId,
    /// Il file supera [`MAX_EDIT_BYTES`].
    TooLarge,
    /// Il documento ha più di [`MAX_ELEMENTS`] elementi.
    TooManyElements,
}

/// Una scena letta.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub status: Status,
    /// Le ragioni della sola lettura, in ordine fisso; vuota se il documento
    /// si può modificare.
    pub read_only: Vec<ReadOnly>,
    /// `fub:version`, se è un intero positivo che sta in 32 bit.
    pub version: Option<u32>,
    /// Se il file comincia con il BOM, che resta.
    pub bom: bool,
    /// I terminatori che il file usa.
    pub line_ending: LineEnding,
    /// Il terminatore delle righe nuove: il prevalente.
    pub line_break: LineEnding,
    /// Vero se il file supera [`MAX_EDIT_BYTES`]: se ne è letta solo la testa,
    /// e le voci sono vuote.
    pub truncated: bool,
    /// Le voci in ordine di documento. Sono vuote se il file è troncato o ha
    /// più di [`MAX_ELEMENTS`] elementi: un documento così si apre in sola
    /// lettura, e la superficie lo mostra intero come immagine.
    pub items: Vec<Item>,
    /// Titolo, descrizione, testi, collegamenti e immagini del vault, di
    /// tutto il documento: anche di ciò che è estraneo.
    pub index: Index,
    /// Il riepilogo di `fub.scene.summary`, anche quando le voci sono vuote.
    pub summary: Summary,
    pub diagnostics: Vec<Diagnostic>,
}

impl Scene {
    /// Vero se la superficie può modificare il documento così com'è: un
    /// documento FubDraw senza ragioni di sola lettura.
    pub fn editable(&self) -> bool {
        self.status == Status::Fubdraw && self.read_only.is_empty()
    }
}

/// Perché una sorgente non è una scena.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReadError {
    /// Non è XML ben formato: `offset` è il byte, BOM compreso, dove si vede.
    Malformed { offset: usize, kind: XmlErrorKind },
    /// È XML, ma la radice non è `<svg>` nel namespace SVG: nessun browser lo
    /// disegna come immagine.
    NotSvg { offset: usize },
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadError::Malformed { offset, kind } => {
                write!(f, "XML non ben formato al byte {offset}: {kind}")
            }
            ReadError::NotSvg { offset } => {
                write!(f, "la radice al byte {offset} non è un elemento svg di SVG")
            }
        }
    }
}

impl std::error::Error for ReadError {}

/// Legge una scena da `source`, il testo intero del file, BOM compreso.
///
/// Un file oltre [`MAX_EDIT_BYTES`] si legge solo fino al primo figlio della
/// radice che non è `title` o `desc`: abbastanza per titolo e riepilogo, con
/// `truncated: true`.
pub fn read(source: &str) -> Result<Scene, ReadError> {
    let truncated = source.len() > MAX_EDIT_BYTES;
    let doc = xml::parse(source, truncated).map_err(|e| ReadError::Malformed {
        offset: e.offset,
        kind: e.kind,
    })?;
    let root = doc.element(doc.root).expect("la radice è un elemento");
    if !root.is_svg("svg") {
        return Err(ReadError::NotSvg {
            offset: doc.nodes[doc.root].start,
        });
    }
    // Di un file troncato servono solo gli offset della testa.
    let read_end = if doc.complete {
        source.len()
    } else {
        doc.nodes[doc.root].end
    };
    let map = Utf16Map::new(&source[..read_end]);
    let mut read_only = Vec::new();
    let mut diagnostics = Vec::new();

    if let Some(doctype) = doc.doctype {
        read_only.push(ReadOnly::Doctype);
        let node = &doc.nodes[doctype];
        let span = map.span(node.start, node.end);
        diagnostics.push(Diagnostic::new(Code::S008, Some(span), None));
    }
    if doc
        .encoding
        .is_some_and(|encoding| !encoding.eq_ignore_ascii_case("utf-8"))
    {
        read_only.push(ReadOnly::Encoding);
    }

    let raw_version = root.value(NS_FUB, "version");
    let status = match raw_version {
        Some(_) => Status::Fubdraw,
        None => Status::Foreign,
    };
    let version = match raw_version {
        None => None,
        Some(raw) if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) => {
            read_only.push(ReadOnly::InvalidVersion);
            None
        }
        Some(raw) => match raw.parse::<u32>() {
            Ok(0) => {
                read_only.push(ReadOnly::InvalidVersion);
                None
            }
            Ok(n) => Some(n),
            // Cifre che non stanno in 32 bit: una versione futura, e grande.
            Err(_) => {
                read_only.push(ReadOnly::FutureVersion);
                diagnostics.push(Diagnostic::new(Code::S007, None, Some(raw.to_owned())));
                None
            }
        },
    };
    if let Some(v) = version.filter(|&v| v > SUPPORTED_VERSION) {
        read_only.push(ReadOnly::FutureVersion);
        diagnostics.push(Diagnostic::new(Code::S007, None, Some(v.to_string())));
    }

    // L'unità e le guide fuori grammatica non si usano, e restano (formato
    // della scena, unità e guide, §3).
    if root
        .value(NS_FUB, "units")
        .is_some_and(|units| rulers::Unit::parse(units).is_none())
    {
        diagnostics.push(Diagnostic::new(
            Code::S011,
            None,
            Some("fub:units".to_owned()),
        ));
    }
    if root
        .value(NS_FUB, "guides")
        .is_some_and(|guides| rulers::parse_guides(guides).is_none())
    {
        diagnostics.push(Diagnostic::new(
            Code::S011,
            None,
            Some("fub:guides".to_owned()),
        ));
    }

    if duplicate_ids(&doc, &map, &mut diagnostics) {
        read_only.push(ReadOnly::DuplicateId);
    }
    if truncated {
        read_only.push(ReadOnly::TooLarge);
    }
    let too_many = doc.elements > MAX_ELEMENTS;
    if too_many {
        read_only.push(ReadOnly::TooManyElements);
    }

    // Le voci di un documento enorme costerebbero più del documento: non
    // servono, perché si apre solo in Lettura. Si classifica comunque, per il
    // riepilogo e la diagnostica; di un file troncato c'è solo la testa.
    let (items, summary) = if truncated {
        (Vec::new(), analysis::truncated_summary(status, version))
    } else {
        let classified = classify::classify_document(&doc, &map, !too_many);
        diagnostics.extend(classified.diagnostics);
        let summary = classified.tally.finish(status, version, &mut diagnostics);
        (classified.items, summary)
    };
    let index = analysis::index(&doc, &map, &mut diagnostics);

    read_only.sort();
    diagnostics::sort(&mut diagnostics);
    Ok(Scene {
        status,
        read_only,
        version,
        bom: bom_len(source) > 0,
        line_ending: LineEnding::of(source),
        line_break: LineEnding::line_break(source),
        truncated,
        items,
        index,
        summary,
        diagnostics,
    })
}

/// Segnala con S003 ogni elemento che ripete l'id di uno precedente, in
/// qualunque namespace: un'operazione per id deve trovare un elemento solo.
/// Restituisce vero se ce n'è almeno uno.
fn duplicate_ids(doc: &xml::Document<'_>, map: &Utf16Map<'_>, out: &mut Vec<Diagnostic>) -> bool {
    let mut seen = std::collections::HashSet::new();
    let mut found = false;
    for node in &doc.nodes {
        let Kind::Element(element) = &node.kind else {
            continue;
        };
        let Some(id) = element.value(NS_NONE, "id").filter(|id| !id.is_empty()) else {
            continue;
        };
        if !seen.insert(id) {
            found = true;
            let span = map.span(node.start, node.end);
            out.push(Diagnostic::new(Code::S003, Some(span), Some(id.to_owned())));
        }
    }
    found
}
