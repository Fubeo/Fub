//! L'inventario di una cartella di Excel, calcolato da Fub senza il modello di
//! GridCraft.
//!
//! Prima di coprire un file con una cartella riscritta dal codec di GridCraft
//! (ADR 0219) bisogna sapere che cosa la riscrittura perderebbe. Rileggere i
//! byte nuovi con lo stesso lettore non basta: un lettore non vede ciò che
//! salta. Questo modulo legge lo zip e l'XML per conto suo, come
//! l'inventario dei documenti di Word (`fub-format-rich`), e conta ciò che il
//! pacchetto contiene in una forma che non dipende da come il codec lo
//! scrive:
//!
//! - ogni **cella** di ogni foglio, con la posizione, il valore in forma
//!   canonica, la formula (una formula condivisa si espande nella cella, come
//!   la scrive chi non condivide) e l'aspetto risolto attraverso gli stili;
//! - ogni **riga** e ogni **colonna** con le sue proprietà;
//! - ogni altro figlio di un foglio, del documento principale e della radice
//!   del pacchetto, come albero XML canonico ([`canonical`]);
//! - le parti raggiunte da una relazione, dentro l'elemento che le nomina:
//!   un `r:id` diventa il contenuto canonico della parte che punta, una parte
//!   binaria la sua impronta `sha256`, una destinazione esterna il suo URL.
//!   Così un codec che rinumera le parti o le relazioni non cambia niente, e
//!   uno che le perde sì. Una relazione che nessun attributo nomina conta da
//!   sé, con il suo tipo.
//!
//! Un foglio si riconosce dal suo `sheetId`, che la patch `0005` di
//! `vendor/gridcraft` fa sopravvivere a una riscrittura.
//!
//! Le [`NORMALIZATIONS`] sono i soli segni che non si contano, ciascuno con la
//! sua ragione: ciò che Excel ricava da altro (la catena di calcolo, le
//! dimensioni, i conteggi), i numeri che un codec riassegna, i suggerimenti
//! di resa, e le forme equivalenti di uno stesso dato (un booleano `true` o
//! `1`, un attributo con il valore predefinito dello schema o assente).
//!
//! Lo zip e l'XML hanno limiti propri (quelli di [`crate::package`] e
//! [`Limits`]): un limite superato, uno zip illeggibile o un XML malformato
//! sono un [`InventoryError`], e chi chiama fallisce chiuso.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;

use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;
use sha2::{Digest, Sha256};

use crate::package::{normalize, Package, PackageError, Rel};

/// I limiti della lettura dell'XML, oltre a quelli dello zip di
/// [`crate::package`].
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    /// Profondità di un albero XML.
    pub depth: usize,
    /// Elementi di tutte le parti XML.
    pub elements: u64,
    /// Parti raggiunte, contando ogni volta che una relazione le raggiunge.
    pub visits: usize,
}

pub(crate) const LIMITS: Limits = Limits {
    depth: 256,
    elements: 50_000_000,
    visits: 100_000,
};

/// Perché un pacchetto non si inventaria.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InventoryError {
    Package(PackageError),
    /// Un XML non è ben formato.
    Xml {
        part: String,
        error: String,
    },
    /// Un limite di [`Limits`] è superato.
    Limit(&'static str),
    /// Manca una parte che il pacchetto deve avere.
    Missing(String),
}

impl fmt::Display for InventoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InventoryError::Package(error) => write!(f, "{error}"),
            InventoryError::Xml { part, error } => write!(f, "xml of {part}: {error}"),
            InventoryError::Limit(what) => write!(f, "limit exceeded: {what}"),
            InventoryError::Missing(what) => write!(f, "missing {what}"),
        }
    }
}

impl From<PackageError> for InventoryError {
    fn from(error: PackageError) -> Self {
        InventoryError::Package(error)
    }
}

fn xml_error(part: &str, error: impl fmt::Display) -> InventoryError {
    InventoryError::Xml {
        part: part.to_string(),
        error: error.to_string(),
    }
}

/// Di chi è una cosa contata.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Owner {
    /// La radice del pacchetto: le proprietà del documento, le parti
    /// personalizzate.
    Package,
    /// Il documento principale.
    Workbook,
    /// Un foglio, per `sheetId`.
    Sheet(u32),
}

/// Una cosa che il pacchetto contiene, e che si conta.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Key {
    pub owner: Owner,
    /// `cell`, `row`, `col`, il nome di un elemento figlio (`mergeCells`,
    /// `definedNames`) o `rel:` più il tipo di una relazione.
    pub class: String,
    /// La cella (riga, colonna), la riga (riga, 0) o la colonna (0, colonna).
    pub at: Option<(u32, u32)>,
    /// La forma canonica.
    pub value: String,
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.owner {
            Owner::Package => write!(f, "package")?,
            Owner::Workbook => write!(f, "workbook")?,
            Owner::Sheet(id) => write!(f, "sheet {id}")?,
        }
        write!(f, " {}", self.class)?;
        if let Some((row, col)) = self.at {
            write!(f, " ({row},{col})")?;
        }
        let value: String = self.value.chars().take(400).collect();
        write!(f, ": {value}")
    }
}

/// L'inventario: ogni chiave con quante volte compare.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Inventory {
    pub items: BTreeMap<Key, u32>,
    /// I `sheetId` dei fogli di lavoro, nell'ordine del file.
    pub sheets: Vec<u32>,
}

impl Inventory {
    fn add(&mut self, owner: Owner, class: &str, at: Option<(u32, u32)>, value: String) {
        *self
            .items
            .entry(Key {
                owner,
                class: class.to_string(),
                at,
                value,
            })
            .or_default() += 1;
    }
}

/// Una chiave che due inventari contano diversamente.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Difference {
    pub key: Key,
    pub before: u32,
    pub after: u32,
}

impl fmt::Display for Difference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} → {}: {}", self.before, self.after, self.key)
    }
}

/// Le chiavi che `before` e `after` contano diversamente, fra quelle per cui
/// `checked` è vero.
pub(crate) fn differences(
    before: &Inventory,
    after: &Inventory,
    checked: impl Fn(&Key) -> bool,
) -> Vec<Difference> {
    let mut out = Vec::new();
    let keys: std::collections::BTreeSet<&Key> =
        before.items.keys().chain(after.items.keys()).collect();
    for key in keys {
        let (b, a) = (
            before.items.get(key).copied().unwrap_or(0),
            after.items.get(key).copied().unwrap_or(0),
        );
        if b != a && checked(key) {
            out.push(Difference {
                key: key.clone(),
                before: b,
                after: a,
            });
        }
    }
    out
}

/// I segni che l'inventario non conta, e perché.
pub(crate) const NORMALIZATIONS: &[(&str, &str)] = &[
    (
        "catena di calcolo",
        "xl/calcChain.xml è l'ordine in cui Excel ha calcolato le formule l'ultima volta: Excel la ricostruisce, e una cartella senza è valida",
    ),
    (
        "stringhe condivise, stili e metadati",
        "sharedStrings, styles e metadata non contano da sé: si risolvono nelle celle, nelle righe, nelle colonne e nelle regole che li nominano",
    ),
    (
        "formule condivise",
        "una formula condivisa (t=\"shared\") si conta espansa in ogni cella, come la scrive chi non condivide",
    ),
    (
        "dimensione del foglio",
        "<dimension> è l'area usata, che si ricava dalle celle",
    ),
    (
        "conteggi",
        "gli attributi count e uniqueCount di un elenco si ricavano dall'elenco",
    ),
    (
        "id delle relazioni e nomi delle parti",
        "un r:id si conta come la parte o l'URL che punta, non come il suo id né come il nome della parte",
    ),
    (
        "selezione e scheda attiva",
        "<selection> e tabSelected sono la posizione del cursore e la scheda scelta, non il contenuto",
    ),
    (
        "suggerimenti di resa delle righe",
        "spans, x14ac:dyDescent, thickTop e thickBot di una riga, e l'altezza di una riga che non la fissa (customHeight assente), sono calcoli di Excel per disegnare",
    ),
    (
        "suggerimenti delle colonne",
        "bestFit e customWidth di una colonna dicono come la larghezza è nata, non quale è",
    ),
    (
        "colonne della larghezza predefinita",
        "una colonna larga quanto il defaultColWidth del suo foglio, senza altre proprietà, è disegnata come una colonna assente",
    ),
    (
        "percorso del salvataggio",
        "x15ac:absPath, in un blocco mc:AlternateContent del documento principale, è la cartella in cui Excel ha salvato il file l'ultima volta",
    ),
    (
        "applicazione degli stili",
        "gli attributi apply* di un formato di cella sono suggerimenti: l'aspetto è quello che il formato nomina",
    ),
    (
        "proprietà dell'applicazione",
        "docProps/app.xml descrive l'applicazione che ha salvato e i titoli dei fogli, che si ricavano dalla cartella; ne contano soltanto Company, Manager e HyperlinkBase",
    ),
    (
        "dichiarazioni XML",
        "le dichiarazioni degli spazi dei nomi e i prefissi di mc:Ignorable non contano: conta lo spazio dei nomi di ogni nome",
    ),
    (
        "forme equivalenti",
        "un booleano true o 1, un numero 1.0 o 1, e un attributo con il valore predefinito dello schema o assente sono lo stesso dato",
    ),
    (
        "priorità delle regole",
        "la priority di una regola di formattazione condizionale conta come il suo posto fra le regole del foglio, perché un codec la rinumera",
    ),
];

// --- XML -----------------------------------------------------------------------

const NS_MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_MAIN_STRICT: &str = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_R_STRICT: &str = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_X14AC: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac";

/// Il prefisso con cui la forma canonica scrive uno spazio dei nomi: lo stesso
/// per le due forme (transitoria e stretta) dello stesso vocabolario.
fn short(ns: &str) -> String {
    match ns {
        "" | NS_MAIN | NS_MAIN_STRICT => String::new(),
        NS_R | NS_R_STRICT => "r:".into(),
        NS_MC => "mc:".into(),
        NS_X14AC => "x14ac:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/main"
        | "http://purl.oclc.org/ooxml/drawingml/main" => "a:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
        | "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing" => "xdr:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/chart"
        | "http://purl.oclc.org/ooxml/drawingml/chart" => "c:".into(),
        "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" => "x14:".into(),
        "http://schemas.microsoft.com/office/excel/2006/main" => "xm:".into(),
        "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" => "cp:".into(),
        "http://purl.org/dc/elements/1.1/" => "dc:".into(),
        "http://purl.org/dc/terms/" => "dcterms:".into(),
        "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" => "ep:".into(),
        other => format!("{{{other}}}"),
    }
}

/// Un elemento letto.
#[derive(Clone, Debug, Default)]
pub(crate) struct Node {
    /// Il prefisso canonico più il nome locale (`a:blip`, `row`).
    pub name: String,
    /// Gli attributi: nome canonico e valore, nell'ordine del file.
    pub attrs: Vec<(String, String)>,
    pub kids: Vec<Node>,
    /// Il testo, soltanto per un elemento senza figli.
    pub text: String,
}

impl Node {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.kids.iter().find(|kid| kid.name == name)
    }

    pub fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.kids.iter().filter(move |kid| kid.name == name)
    }
}

fn namespace(result: &ResolveResult<'_>) -> String {
    match result {
        ResolveResult::Bound(ns) => String::from_utf8_lossy(ns.as_ref()).into_owned(),
        ResolveResult::Unbound => String::new(),
        // Un prefisso non dichiarato resta com'è scritto: il confronto lo vede
        // sia prima sia dopo.
        ResolveResult::Unknown(prefix) => format!("?{}", String::from_utf8_lossy(prefix)),
    }
}

/// Il contatore degli elementi letti, per [`Limits::elements`].
struct Budget {
    elements: u64,
    visits: usize,
}

/// Legge una parte XML. I figli della radice di nome `stream` (le righe di
/// `sheetData`, le stringhe di `sst`) non restano nell'albero: appena chiusi
/// vanno a `sink`, perché un foglio grande non stia tutto in memoria.
fn parse(
    bytes: &[u8],
    part: &str,
    budget: &mut Budget,
    stream: Option<(&str, &str)>,
    sink: &mut dyn FnMut(Node) -> Result<(), InventoryError>,
) -> Result<Node, InventoryError> {
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut stack: Vec<Node> = Vec::new();
    let mut root: Option<Node> = None;
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| xml_error(part, error))?;
        let (start, empty) = match &event {
            Event::Start(start) => (Some(start.clone().into_owned()), false),
            Event::Empty(start) => (Some(start.clone().into_owned()), true),
            Event::Text(text) => {
                let text = text
                    .xml_content(quick_xml::XmlVersion::Implicit1_0)
                    .map_err(|error| xml_error(part, error))?;
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&text);
                }
                (None, false)
            }
            Event::CData(text) => {
                let text = text.decode().map_err(|error| xml_error(part, error))?;
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&text);
                }
                (None, false)
            }
            Event::GeneralRef(reference) => {
                let resolved = match reference
                    .resolve_char_ref()
                    .map_err(|error| xml_error(part, error))?
                {
                    Some(ch) => ch.to_string(),
                    None => {
                        let name = reference.decode().map_err(|error| xml_error(part, error))?;
                        quick_xml::escape::resolve_xml_entity(&name)
                            .ok_or_else(|| xml_error(part, format!("unknown entity &{name};")))?
                            .to_string()
                    }
                };
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&resolved);
                }
                (None, false)
            }
            Event::End(_) => {
                let mut node = stack.pop().ok_or_else(|| xml_error(part, "unbalanced"))?;
                close(&mut node);
                attach(&mut stack, &mut root, node, stream, sink, part)?;
                (None, false)
            }
            Event::Eof => break,
            _ => (None, false),
        };
        let Some(start) = start else {
            buf.clear();
            continue;
        };
        budget.elements += 1;
        if budget.elements > LIMITS.elements {
            return Err(InventoryError::Limit("xml elements"));
        }
        if stack.len() >= LIMITS.depth {
            return Err(InventoryError::Limit("xml depth"));
        }
        let (ns, local) = reader.resolver().resolve_element(start.name());
        let name = format!(
            "{}{}",
            short(&namespace(&ns)),
            String::from_utf8_lossy(local.as_ref())
        );
        let mut attrs = Vec::new();
        for attr in start.attributes() {
            let attr = attr.map_err(|error| xml_error(part, error))?;
            let qname = attr.key;
            if qname.as_namespace_binding().is_some() {
                continue;
            }
            let (attr_ns, attr_local) = reader.resolver().resolve_attribute(qname);
            let attr_ns = namespace(&attr_ns);
            let attr_name = String::from_utf8_lossy(attr_local.as_ref()).into_owned();
            if attr_ns == NS_MC && matches!(attr_name.as_str(), "Ignorable" | "MustUnderstand") {
                continue;
            }
            let value = attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(|error| xml_error(part, error))?
                .into_owned();
            attrs.push((format!("{}{attr_name}", short(&attr_ns)), value));
        }
        let node = Node {
            name,
            attrs,
            kids: Vec::new(),
            text: String::new(),
        };
        if empty {
            attach(&mut stack, &mut root, node, stream, sink, part)?;
        } else {
            stack.push(node);
        }
        buf.clear();
    }
    if !stack.is_empty() {
        return Err(xml_error(part, "unclosed elements"));
    }
    root.ok_or_else(|| xml_error(part, "no root element"))
}

/// Il testo fra gli elementi di un elemento che ha figli è soltanto spazio.
fn close(node: &mut Node) {
    if !node.kids.is_empty() && node.text.trim().is_empty() {
        node.text.clear();
    }
}

fn attach(
    stack: &mut [Node],
    root: &mut Option<Node>,
    node: Node,
    stream: Option<(&str, &str)>,
    sink: &mut dyn FnMut(Node) -> Result<(), InventoryError>,
    part: &str,
) -> Result<(), InventoryError> {
    match stack.len() {
        0 => {
            if root.is_some() {
                return Err(xml_error(part, "two root elements"));
            }
            *root = Some(node);
        }
        len => {
            let streamed = stream.is_some_and(|(parent, child)| {
                node.name == child && len >= 1 && stack[len - 1].name == parent && len <= 2
            });
            if streamed {
                sink(node)?;
            } else {
                stack[len - 1].kids.push(node);
            }
        }
    }
    Ok(())
}

// --- forma canonica ------------------------------------------------------------

/// Un numero in forma canonica: `1.0` e `1` sono lo stesso numero. Un testo
/// che non è un numero decimale resta com'è.
fn number(text: &str) -> String {
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
fn boolean(value: &str) -> Option<bool> {
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
        write_canonical(kid, resolve, out);
    }
    if !node.text.is_empty() {
        out.push_str(&format!("{:?}", node.text));
    }
    out.push_str("</>");
}

// --- formule -------------------------------------------------------------------

/// Una colonna in lettere (`A`, `XFD`) → indice da 0.
fn column_index(letters: &str) -> Option<u32> {
    if letters.is_empty() || letters.len() > 3 {
        return None;
    }
    let mut value = 0u32;
    for byte in letters.bytes() {
        if !byte.is_ascii_uppercase() {
            return None;
        }
        value = value * 26 + u32::from(byte - b'A' + 1);
    }
    (value <= 16_384).then(|| value - 1)
}

fn column_letters(mut index: u32) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii")
}

/// `B12` → (11, 1).
pub(crate) fn cell_ref(text: &str) -> Option<(u32, u32)> {
    let text = text.replace('$', "");
    let split = text.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = text.split_at(split);
    let col = column_index(&letters.to_ascii_uppercase())?;
    let row: u32 = digits.parse().ok()?;
    (1..=1_048_576).contains(&row).then(|| (row - 1, col))
}

/// La formula di una cella figlia di una formula condivisa: i riferimenti
/// relativi della formula della cella principale spostati di `rows` righe e
/// `cols` colonne, come fa Excel quando la legge. I testi fra virgolette, i
/// nomi dei fogli fra apici e i riferimenti strutturati fra parentesi quadre
/// non si toccano.
pub(crate) fn shift_formula(formula: &str, rows: i64, cols: i64) -> String {
    let chars: Vec<char> = formula.chars().collect();
    let mut out = String::with_capacity(formula.len());
    let mut i = 0;
    let ident = |c: char| c.is_alphanumeric() || c == '_' || c == '.' || c == '\\';
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            // Un testo o un nome fra apici: fino alla chiusura, con la
            // chiusura raddoppiata come escape.
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == c {
                    if i + 1 < chars.len() && chars[i + 1] == c {
                        out.push(c);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '[' {
            let mut depth = 0;
            while i < chars.len() {
                out.push(chars[i]);
                match chars[i] {
                    '[' => depth += 1,
                    ']' => {
                        depth -= 1;
                        if depth == 0 {
                            i += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            continue;
        }
        let preceded = i > 0 && (ident(chars[i - 1]) || chars[i - 1] == '$');
        if !preceded && (c == '$' || c.is_ascii_alphabetic() || c.is_ascii_digit()) {
            if let Some((text, used)) = shift_reference(&chars[i..], rows, cols) {
                let next = chars.get(i + used).copied();
                if !next.is_some_and(|n| ident(n) || n == '(' || n == '!') {
                    out.push_str(&text);
                    i += used;
                    continue;
                }
            }
            // Un nome, una funzione o un numero: tutto il token com'è.
            let start = i;
            while i < chars.len() && (ident(chars[i]) || chars[i] == '$') {
                i += 1;
            }
            if i == start {
                i += 1;
            }
            out.extend(&chars[start..i]);
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Un riferimento all'inizio di `chars` (`A1`, `$B$2`, `C:D`, `3:5`) spostato,
/// con quanti caratteri occupa.
fn shift_reference(chars: &[char], rows: i64, cols: i64) -> Option<(String, usize)> {
    fn part(chars: &[char]) -> (bool, String, usize) {
        let mut i = 0;
        let absolute = chars.first() == Some(&'$');
        if absolute {
            i += 1;
        }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_alphabetic() {
            i += 1;
        }
        let letters: String = chars[start..i].iter().collect();
        (absolute, letters, i)
    }
    fn digits(chars: &[char]) -> (bool, String, usize) {
        let mut i = 0;
        let absolute = chars.first() == Some(&'$');
        if absolute {
            i += 1;
        }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        (absolute, chars[start..i].iter().collect(), i)
    }
    let shift_col = |absolute: bool, letters: &str| -> Option<String> {
        let index = column_index(&letters.to_ascii_uppercase())? as i64;
        let moved = if absolute { index } else { index + cols };
        if !(0..16_384).contains(&moved) {
            return Some("#REF!".into());
        }
        Some(format!(
            "{}{}",
            if absolute { "$" } else { "" },
            column_letters(moved as u32)
        ))
    };
    let shift_row = |absolute: bool, number: &str| -> Option<String> {
        let index: i64 = number.parse().ok()?;
        if !(1..=1_048_576).contains(&index) {
            return None;
        }
        let moved = if absolute { index } else { index + rows };
        if !(1..=1_048_576).contains(&moved) {
            return Some("#REF!".into());
        }
        Some(format!("{}{moved}", if absolute { "$" } else { "" }))
    };
    // Una cella: lettere e cifre.
    let (col_abs, letters, used) = part(chars);
    if !letters.is_empty() {
        let (row_abs, number, used_row) = digits(&chars[used..]);
        if !number.is_empty() {
            let col = shift_col(col_abs, &letters)?;
            let row = shift_row(row_abs, &number)?;
            if col == "#REF!" || row == "#REF!" {
                return Some(("#REF!".into(), used + used_row));
            }
            return Some((format!("{col}{row}"), used + used_row));
        }
        // Colonne intere: `A:C`.
        if chars.get(used) == Some(&':') && used_row == usize::from(row_abs) {
            let (end_abs, end, end_used) = part(&chars[used + 1..]);
            if !end.is_empty()
                && !chars
                    .get(used + 1 + end_used)
                    .is_some_and(|c| c.is_ascii_digit())
            {
                let a = shift_col(col_abs, &letters)?;
                let b = shift_col(end_abs, &end)?;
                return Some((format!("{a}:{b}"), used + 1 + end_used));
            }
        }
        return None;
    }
    // Righe intere: `3:5`.
    let (row_abs, number, used) = digits(chars);
    if !number.is_empty() && chars.get(used) == Some(&':') {
        let (end_abs, end, end_used) = digits(&chars[used + 1..]);
        if !end.is_empty() {
            let a = shift_row(row_abs, &number)?;
            let b = shift_row(end_abs, &end)?;
            return Some((format!("{a}:{b}"), used + 1 + end_used));
        }
    }
    None
}

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
struct Styles {
    /// L'aspetto di ogni formato di cella (`cellXfs`).
    cells: Vec<String>,
    /// Ogni formato differenziale (`dxfs`).
    dxfs: Vec<String>,
}

/// Gli elementi di un carattere sono un insieme: l'ordine non conta, e una
/// proprietà booleana spenta è come assente.
fn font_canonical(node: &Node) -> String {
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

fn read_styles(node: &Node) -> Styles {
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

// --- colori --------------------------------------------------------------------

/// La tavolozza predefinita dei colori indicizzati (ECMA-376 parte 1,
/// §18.8.27).
const INDEXED: [u32; 64] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, //
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, //
    0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, //
    0x9999FF, 0x993366, 0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF, //
    0x000080, 0xFF00FF, 0xFFFF00, 0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF, //
    0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99, 0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99, //
    0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900, 0xFF6600, 0x666699, 0x969696, //
    0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333, //
];

/// I colori di una cartella: la tavolozza dei colori indicizzati, e se il
/// Testo 1 del tema (`dk1`) è il colore automatico del testo.
pub(crate) struct Colors {
    palette: Vec<String>,
    dark_is_auto: bool,
}

impl Default for Colors {
    fn default() -> Self {
        Colors {
            palette: INDEXED.iter().map(|rgb| format!("FF{rgb:06X}")).collect(),
            dark_is_auto: true,
        }
    }
}

impl Colors {
    /// La tavolozza di `styles` (`colors/indexedColors`) e il `dk1` del tema.
    fn new(styles: Option<&Node>, theme: Option<&Node>) -> Colors {
        let mut colors = Colors::default();
        if let Some(list) = styles
            .and_then(|styles| styles.child("colors"))
            .and_then(|colors| colors.child("indexedColors"))
        {
            let custom: Vec<String> = list
                .children("rgbColor")
                .map(|color| rgb(color.attr("rgb").unwrap_or("")))
                .collect();
            if !custom.is_empty() {
                colors.palette = custom;
            }
        }
        let dark = theme
            .and_then(|theme| theme.child("a:themeElements"))
            .and_then(|elements| elements.child("a:clrScheme"))
            .and_then(|scheme| scheme.child("a:dk1"));
        if let Some(dark) = dark {
            colors.dark_is_auto = dark.kids.iter().any(|kid| match kid.name.as_str() {
                "a:sysClr" => kid.attr("val") == Some("windowText"),
                "a:srgbClr" => kid
                    .attr("val")
                    .is_some_and(|v| v.eq_ignore_ascii_case("000000")),
                _ => false,
            });
        }
        colors
    }

    /// Riscrive i colori di `node` in una forma sola: un colore indicizzato
    /// della tavolozza diventa il suo `rgb`, e in un carattere (non in un
    /// formato differenziale, dove un colore assente vuol dire «non cambia»)
    /// il colore automatico, il colore di sistema del testo e il Testo 1 di un
    /// tema che lo fa nero sono come assenti.
    fn fix(&self, node: &mut Node, in_dxf: bool) {
        let in_dxf = in_dxf || node.name == "dxf";
        for (key, value) in &mut node.attrs {
            if key == "rgb" {
                *value = rgb(value);
            }
        }
        if let Some(at) = node.attrs.iter().position(|(key, _)| key == "indexed") {
            let index: Option<usize> = node.attrs[at].1.parse().ok();
            if let Some(color) = index.and_then(|index| self.palette.get(index)) {
                node.attrs[at] = ("rgb".into(), color.clone());
            }
        }
        if !in_dxf && matches!(node.name.as_str(), "font" | "rPr") {
            node.kids
                .retain(|kid| kid.name != "color" || !self.automatic(kid));
        }
        for kid in &mut node.kids {
            self.fix(kid, in_dxf);
        }
    }

    fn automatic(&self, color: &Node) -> bool {
        if color.attr("auto").and_then(boolean) == Some(true) {
            return true;
        }
        if color.attr("indexed") == Some("64") {
            return true;
        }
        let tinted = color.attr("tint").is_some_and(|tint| number(tint) != "0");
        self.dark_is_auto && color.attr("theme") == Some("1") && !tinted
    }
}

/// Un `rgb` in forma canonica: maiuscolo, con l'alfa.
fn rgb(value: &str) -> String {
    let upper = value.trim().to_ascii_uppercase();
    if upper.len() == 6 {
        format!("FF{upper}")
    } else {
        upper
    }
}

// --- il pacchetto --------------------------------------------------------------

/// Le relazioni che non si contano: parti che si risolvono in altre
/// (stili, stringhe, metadati), o che si ricavano (la catena di calcolo).
fn resolved_kind(kind: &str) -> bool {
    matches!(
        kind,
        "styles" | "sharedStrings" | "calcChain" | "sheetMetadata" | "worksheet"
    )
}

struct Reader<'a> {
    package: Package<'a>,
    budget: Budget,
    /// Le parti in corso di visita, contro i cicli.
    visiting: HashSet<String>,
    colors: Colors,
}

impl<'a> Reader<'a> {
    fn read(&mut self, part: &str) -> Result<Option<Vec<u8>>, InventoryError> {
        Ok(self.package.read(part)?)
    }

    /// La forma canonica della parte che una relazione punta: l'URL se è
    /// esterna, l'XML canonico (con le sue relazioni) se è XML, l'impronta se
    /// è binaria.
    fn target(&mut self, rel: &Rel) -> Result<String, InventoryError> {
        if rel.external {
            return Ok(format!("{} -> {:?}", rel.kind, rel.target));
        }
        self.budget.visits += 1;
        if self.budget.visits > LIMITS.visits {
            return Err(InventoryError::Limit("related parts"));
        }
        let part = normalize(&rel.target);
        if !self.visiting.insert(part.clone()) {
            return Ok(format!("{} -> (cycle)", rel.kind));
        }
        let result = self.part(&part, &rel.kind);
        self.visiting.remove(&part);
        Ok(format!("{} -> {}", rel.kind, result?))
    }

    fn part(&mut self, part: &str, kind: &str) -> Result<String, InventoryError> {
        let Some(bytes) = self.read(part)? else {
            return Ok("(missing)".into());
        };
        if !looks_like_xml(&bytes) {
            return Ok(format!("sha256 {}", sha256(&bytes)));
        }
        let mut root = parse(&bytes, part, &mut self.budget, None, &mut |_| Ok(()))?;
        self.colors.fix(&mut root, false);
        let rels = self.package.rels(part)?;
        let mut used: HashSet<String> = HashSet::new();
        let mut text = self.canonical_with_rels(&root, &rels, &mut used, kind)?;
        for rel in &rels {
            if !used.contains(&rel.id) {
                text.push_str(&format!(" +rel {}", self.target(rel)?));
            }
        }
        Ok(text)
    }

    /// La forma canonica di `node`, con ogni attributo dello spazio dei nomi
    /// delle relazioni risolto nella parte che punta.
    fn canonical_with_rels(
        &mut self,
        node: &Node,
        rels: &[Rel],
        used: &mut HashSet<String>,
        _kind: &str,
    ) -> Result<String, InventoryError> {
        // Le destinazioni prima, perché la forma canonica non può fallire.
        let mut targets: HashMap<String, String> = HashMap::new();
        let mut ids = Vec::new();
        collect_rel_ids(node, &mut ids);
        for id in ids {
            if targets.contains_key(&id) {
                continue;
            }
            let target = match rels.iter().find(|rel| rel.id == id) {
                Some(rel) => self.target(rel)?,
                None => "(dangling)".into(),
            };
            used.insert(id.clone());
            targets.insert(id, target);
        }
        Ok(canonical(node, &mut |_, name, value| {
            name.starts_with("r:")
                .then(|| targets.get(value).cloned().unwrap_or_default())
        }))
    }
}

fn collect_rel_ids(node: &Node, out: &mut Vec<String>) {
    for (name, value) in &node.attrs {
        if name.starts_with("r:") {
            out.push(value.clone());
        }
    }
    for kid in &node.kids {
        collect_rel_ids(kid, out);
    }
}

fn looks_like_xml(bytes: &[u8]) -> bool {
    let start = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(bytes)
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|at| &bytes[at..]);
    start.is_some_and(|rest| rest.starts_with(b"<"))
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// L'inventario dei byte di una cartella.
pub(crate) fn inventory(bytes: &[u8]) -> Result<Inventory, InventoryError> {
    let package = Package::open(bytes)?;
    if package.has_duplicates() {
        return Err(InventoryError::Package(PackageError::Zip(
            "two entries with the same part name".into(),
        )));
    }
    let mut reader = Reader {
        package,
        budget: Budget {
            elements: 0,
            visits: 0,
        },
        visiting: HashSet::new(),
        colors: Colors::default(),
    };
    let mut out = Inventory::default();
    let workbook = reader.package.workbook_part()?;
    // La radice del pacchetto: ogni relazione tranne il documento principale.
    for rel in reader.package.rels("")? {
        if rel.kind == "officeDocument" && normalize(&rel.target) == workbook {
            continue;
        }
        let value = match rel.kind.as_str() {
            "extended-properties" if !rel.external => app_properties(&mut reader, &rel)?,
            _ => reader.target(&rel)?,
        };
        out.add(Owner::Package, &format!("rel:{}", rel.kind), None, value);
    }
    let workbook_rels = reader.package.rels(&workbook)?;
    let find = |kind: &str| {
        workbook_rels
            .iter()
            .find(|rel| rel.kind == kind && !rel.external)
            .map(|rel| normalize(&rel.target))
    };
    let xml = |reader: &mut Reader<'_>, kind: &str| -> Result<Option<Node>, InventoryError> {
        let Some(part) = find(kind) else {
            return Ok(None);
        };
        let Some(bytes) = reader.read(&part)? else {
            return Ok(None);
        };
        parse(&bytes, &part, &mut reader.budget, None, &mut |_| Ok(())).map(Some)
    };
    let theme = xml(&mut reader, "theme")?;
    let mut styles = xml(&mut reader, "styles")?;
    reader.colors = Colors::new(styles.as_ref(), theme.as_ref());
    if let Some(styles) = &mut styles {
        reader.colors.fix(styles, false);
    }
    let styles = styles.as_ref().map(read_styles).unwrap_or_default();
    let mut strings: Vec<String> = Vec::new();
    if let Some(part) = find("sharedStrings") {
        if let Some(bytes) = reader.read(&part)? {
            let colors = &reader.colors;
            parse(
                &bytes,
                &part,
                &mut reader.budget,
                Some(("sst", "si")),
                &mut |mut si| {
                    colors.fix(&mut si, false);
                    strings.push(rich_text(&si));
                    Ok(())
                },
            )?;
        }
    }
    let metadata = match find("sheetMetadata") {
        Some(part) => match reader.read(&part)? {
            Some(bytes) => Some(parse(&bytes, &part, &mut reader.budget, None, &mut |_| {
                Ok(())
            })?),
            None => None,
        },
        None => None,
    };
    let metadata = Metadata::new(metadata.as_ref());

    let bytes = reader
        .read(&workbook)?
        .ok_or_else(|| InventoryError::Missing(workbook.clone()))?;
    let root = parse(&bytes, &workbook, &mut reader.budget, None, &mut |_| Ok(()))?;
    // I fogli: `sheetId` di ogni voce, per tradurre `localSheetId` (una
    // posizione) e `activeTab`.
    let entries: Vec<&Node> = root
        .child("sheets")
        .map(|sheets| sheets.children("sheet").collect())
        .unwrap_or_default();
    let ids: Vec<u32> = entries
        .iter()
        .map(|entry| {
            entry
                .attr("sheetId")
                .and_then(|id| id.parse().ok())
                .unwrap_or(0)
        })
        .collect();
    let mut used: HashSet<String> = HashSet::new();
    for kid in &root.kids {
        match kid.name.as_str() {
            "sheets" => {
                for (index, entry) in entries.iter().enumerate() {
                    let rel = entry
                        .attr("r:id")
                        .and_then(|id| workbook_rels.iter().find(|rel| rel.id == id));
                    if let Some(rel) = rel {
                        used.insert(rel.id.clone());
                    }
                    let mut value = format!(
                        "{:?} {}",
                        entry.attr("name").unwrap_or(""),
                        entry.attr("state").unwrap_or("visible")
                    );
                    match rel {
                        Some(rel) if rel.kind == "worksheet" && !rel.external => {
                            out.sheets.push(ids[index]);
                            sheet(
                                &mut reader,
                                &mut out,
                                ids[index],
                                &normalize(&rel.target),
                                &styles,
                                &strings,
                                &metadata,
                            )?;
                            value.push_str(" worksheet");
                        }
                        Some(rel) => value.push_str(&format!(" {}", reader.target(rel)?)),
                        None => value.push_str(" (no part)"),
                    }
                    // Il posto del foglio fra gli altri conta: l'ordine delle
                    // schede è contenuto.
                    out.add(
                        Owner::Workbook,
                        "sheet",
                        Some((index as u32, ids[index])),
                        value,
                    );
                }
            }
            "definedNames" => {
                for name in kid.children("definedName") {
                    let mut name = name.clone();
                    for (key, value) in &mut name.attrs {
                        if key == "localSheetId" {
                            let index: usize = value.parse().unwrap_or(usize::MAX);
                            *value = format!(
                                "sheet {}",
                                ids.get(index).map_or("?".into(), |id| id.to_string())
                            );
                        }
                    }
                    out.add(
                        Owner::Workbook,
                        "definedName",
                        None,
                        canonical(&name, &mut |_, _, _| None),
                    );
                }
            }
            "bookViews" => {
                for view in kid.children("workbookView") {
                    // La finestra (posizione, misure) è dell'applicazione; la
                    // scheda attiva si conta per `sheetId`.
                    let tab: usize = view
                        .attr("activeTab")
                        .and_then(|tab| tab.parse().ok())
                        .unwrap_or(0);
                    let mut view = view.clone();
                    view.attrs.retain(|(key, _)| {
                        !matches!(
                            key.as_str(),
                            "xWindow"
                                | "yWindow"
                                | "windowWidth"
                                | "windowHeight"
                                | "activeTab"
                                | "firstSheet"
                                | "tabRatio"
                        )
                    });
                    out.add(
                        Owner::Workbook,
                        "workbookView",
                        None,
                        format!(
                            "{} active {}",
                            canonical(&view, &mut |_, _, _| None),
                            ids.get(tab).copied().unwrap_or(0)
                        ),
                    );
                }
            }
            "calcPr" => {
                let mut calc = kid.clone();
                // Il numero della versione di calcolo dice chi ha calcolato.
                calc.attrs
                    .retain(|(key, _)| !matches!(key.as_str(), "calcId" | "forceFullCalc"));
                out.add(
                    Owner::Workbook,
                    "calcPr",
                    None,
                    canonical(&calc, &mut |_, _, _| None),
                );
            }
            "fileVersion" => {
                // Chi ha salvato, non che cosa.
            }
            "mc:AlternateContent" if only_save_path(kid) => {
                // Dove il file è stato salvato l'ultima volta, non che cosa.
            }
            name => {
                let value = reader.canonical_with_rels(kid, &workbook_rels, &mut used, "")?;
                out.add(Owner::Workbook, name, None, value);
            }
        }
    }
    for rel in &workbook_rels {
        if used.contains(&rel.id) || resolved_kind(&rel.kind) {
            continue;
        }
        let value = reader.target(rel)?;
        out.add(Owner::Workbook, &format!("rel:{}", rel.kind), None, value);
    }
    Ok(out)
}

/// Il blocco di compatibilità che porta soltanto `x15ac:absPath`, la cartella
/// in cui Excel ha salvato il file.
fn only_save_path(node: &Node) -> bool {
    const NS_X15AC: &str = "{http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac}absPath";
    let choices: Vec<&Node> = node.kids.iter().collect();
    !choices.is_empty()
        && choices.iter().all(|choice| {
            (choice.name == "mc:Choice" && choice.kids.iter().all(|kid| kid.name == NS_X15AC))
                || (choice.name == "mc:Fallback" && choice.kids.is_empty())
        })
}

/// Le proprietà dell'applicazione che sono del documento.
fn app_properties(reader: &mut Reader<'_>, rel: &Rel) -> Result<String, InventoryError> {
    let part = normalize(&rel.target);
    let Some(bytes) = reader.read(&part)? else {
        return Ok("(missing)".into());
    };
    let root = parse(&bytes, &part, &mut reader.budget, None, &mut |_| Ok(()))?;
    let mut out = String::new();
    for kid in &root.kids {
        let local = kid.name.trim_start_matches("ep:");
        if matches!(local, "Company" | "Manager" | "HyperlinkBase") && !kid.text.is_empty() {
            out.push_str(&format!("{local}={:?} ", kid.text));
        }
    }
    Ok(out)
}

/// Il testo di una stringa (`si`, `is`): il solo testo se è semplice, la
/// forma canonica dei run se ne ha.
fn rich_text(node: &Node) -> String {
    if node.kids.len() == 1 && node.kids[0].name == "t" {
        return format!("{:?}", node.kids[0].text);
    }
    let mut out = String::new();
    for kid in &node.kids {
        match kid.name.as_str() {
            "t" => out.push_str(&format!("{:?}", kid.text)),
            "r" => {
                out.push_str("<r");
                if let Some(props) = kid.child("rPr") {
                    out.push(' ');
                    out.push_str(&font_canonical(props));
                }
                out.push('>');
                if let Some(text) = kid.child("t") {
                    out.push_str(&format!("{:?}", text.text));
                }
            }
            _ => out.push_str(&canonical(kid, &mut |_, _, _| None)),
        }
    }
    out
}

/// I tipi dei metadati delle celle (`cm`, `vm`), per nome.
struct Metadata {
    cell: Vec<String>,
    value: Vec<String>,
}

impl Metadata {
    fn new(root: Option<&Node>) -> Metadata {
        let Some(root) = root else {
            return Metadata {
                cell: Vec::new(),
                value: Vec::new(),
            };
        };
        let types: Vec<String> = root
            .child("metadataTypes")
            .map(|list| {
                list.children("metadataType")
                    .map(|kind| kind.attr("name").unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();
        let blocks = |name: &str| -> Vec<String> {
            root.child(name)
                .map(|list| {
                    list.children("bk")
                        .map(|block| {
                            block
                                .children("rc")
                                .map(|record| {
                                    let kind: usize =
                                        record.attr("t").and_then(|t| t.parse().ok()).unwrap_or(0);
                                    types.get(kind.wrapping_sub(1)).cloned().unwrap_or_default()
                                })
                                .collect::<Vec<_>>()
                                .join("+")
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        Metadata {
            cell: blocks("cellMetadata"),
            value: blocks("valueMetadata"),
        }
    }

    fn name(list: &[String], index: Option<&str>) -> String {
        let index: usize = index.and_then(|index| index.parse().ok()).unwrap_or(0);
        list.get(index.wrapping_sub(1))
            .cloned()
            .unwrap_or_else(|| format!("#{index}"))
    }
}

/// Una formula condivisa: la cella principale e il suo testo.
struct Shared {
    at: (u32, u32),
    text: String,
}

fn sheet(
    reader: &mut Reader<'_>,
    out: &mut Inventory,
    id: u32,
    part: &str,
    styles: &Styles,
    strings: &[String],
    metadata: &Metadata,
) -> Result<(), InventoryError> {
    let owner = Owner::Sheet(id);
    let Some(bytes) = reader.read(part)? else {
        out.add(owner, "missing", None, String::new());
        return Ok(());
    };
    let rels = reader.package.rels(part)?;
    let style = |index: Option<&str>| -> String {
        let index: usize = index.and_then(|index| index.parse().ok()).unwrap_or(0);
        styles.cells.get(index).cloned().unwrap_or_default()
    };
    let mut shared: HashMap<String, Shared> = HashMap::new();
    let mut next_row = 0u32;
    let mut cells: Vec<(Option<(u32, u32)>, String)> = Vec::new();
    let mut rows: Vec<(u32, String)> = Vec::new();
    let colors = std::mem::take(&mut reader.colors);
    let mut sink = |mut row: Node| -> Result<(), InventoryError> {
        colors.fix(&mut row, false);
        let index = row
            .attr("r")
            .and_then(|r| r.parse::<u32>().ok())
            .filter(|&r| r >= 1)
            .map_or(next_row, |r| r - 1);
        next_row = index + 1;
        // Le proprietà della riga.
        let mut props = Vec::new();
        let custom = row.attr("customHeight").and_then(boolean).unwrap_or(false);
        if custom {
            if let Some(height) = row.attr("ht") {
                props.push(format!("ht={}", number(height)));
            }
        }
        for flag in ["hidden", "collapsed"] {
            if row.attr(flag).and_then(boolean).unwrap_or(false) {
                props.push(flag.to_string());
            }
        }
        if let Some(level) = row.attr("outlineLevel").filter(|level| *level != "0") {
            props.push(format!("outline={level}"));
        }
        if row.attr("customFormat").and_then(boolean).unwrap_or(false) {
            props.push(format!("style {}", style(row.attr("s"))));
        }
        if !props.is_empty() {
            rows.push((index, props.join(" ")));
        }
        let mut col = 0u32;
        for cell in row.children("c") {
            let at = match cell.attr("r") {
                Some(r) => cell_ref(r),
                None => Some((index, col)),
            };
            if let Some((_, c)) = at {
                col = c + 1;
            }
            let mut value = String::new();
            let kind = cell.attr("t").unwrap_or("n");
            let raw = cell.child("v").map(|v| v.text.as_str());
            match (kind, raw) {
                ("s", Some(raw)) => {
                    let index: usize = raw.trim().parse().unwrap_or(usize::MAX);
                    value.push_str("s:");
                    value.push_str(strings.get(index).map_or("(missing)", String::as_str));
                }
                ("inlineStr", _) => {
                    value.push_str("s:");
                    if let Some(inline) = cell.child("is") {
                        value.push_str(&rich_text(inline));
                    }
                }
                ("str", Some(raw)) => value.push_str(&format!("s:{raw:?}")),
                ("b", Some(raw)) => value.push_str(&format!(
                    "b:{}",
                    u8::from(boolean(raw.trim()).unwrap_or(false))
                )),
                ("e", Some(raw)) => value.push_str(&format!("e:{}", raw.trim())),
                ("d", Some(raw)) => value.push_str(&format!("d:{raw}")),
                (_, Some(raw)) => value.push_str(&format!("n:{}", number(raw))),
                (_, None) => {}
            }
            if let Some(formula) = cell.child("f") {
                let text = formula_text(formula, at, &mut shared);
                value.push_str(&format!(" f:{text:?}"));
                match formula.attr("t") {
                    Some("array") => {
                        value.push_str(&format!(" array {}", formula.attr("ref").unwrap_or("")))
                    }
                    Some("dataTable") => {
                        let mut table = formula.clone();
                        table.text.clear();
                        table.attrs.retain(|(key, _)| key != "t");
                        value.push_str(&format!(
                            " table {}",
                            canonical(&table, &mut |_, _, _| None)
                        ));
                    }
                    _ => {}
                }
                if formula.attr("aca").and_then(boolean).unwrap_or(false) {
                    value.push_str(" aca");
                }
            }
            if let Some(cm) = cell.attr("cm") {
                value.push_str(&format!(" cm {}", Metadata::name(&metadata.cell, Some(cm))));
            }
            if let Some(vm) = cell.attr("vm") {
                value.push_str(&format!(
                    " vm {}",
                    Metadata::name(&metadata.value, Some(vm))
                ));
            }
            if cell.attr("ph").and_then(boolean).unwrap_or(false) {
                value.push_str(" ph");
            }
            value.push_str(" | ");
            value.push_str(&style(cell.attr("s")));
            cells.push((at, value));
        }
        Ok(())
    };
    let root = parse(
        &bytes,
        part,
        &mut reader.budget,
        Some(("sheetData", "row")),
        &mut sink,
    );
    reader.colors = colors;
    let mut root = root?;
    reader.colors.fix(&mut root, false);
    let default_style = style(None);
    for (at, value) in cells {
        // Una cella senza valore, senza formula e con l'aspetto predefinito
        // è come assente.
        if value == format!(" | {default_style}") {
            continue;
        }
        out.add(owner, "cell", at, value);
    }
    for (index, value) in rows {
        out.add(owner, "row", Some((index, 0)), value);
    }
    let mut used: HashSet<String> = HashSet::new();
    // Una colonna larga quanto la larghezza predefinita del foglio è come
    // senza larghezza.
    let default_width = root
        .kids
        .iter()
        .find(|kid| kid.name == "sheetFormatPr")
        .and_then(|format| format.attr("defaultColWidth"))
        .map(number);
    let mut priorities: Vec<i64> = Vec::new();
    collect_priorities(&root, &mut priorities);
    priorities.sort_unstable();
    priorities.dedup();
    for kid in &root.kids {
        match kid.name.as_str() {
            "sheetData" | "dimension" => {}
            "cols" => {
                for col in kid.children("col") {
                    let (Some(min), Some(max)) = (
                        col.attr("min").and_then(|v| v.parse::<u32>().ok()),
                        col.attr("max").and_then(|v| v.parse::<u32>().ok()),
                    ) else {
                        continue;
                    };
                    let mut props = Vec::new();
                    if let Some(width) = col.attr("width").map(number) {
                        if default_width.as_ref() != Some(&width) {
                            props.push(format!("width={width}"));
                        }
                    }
                    for flag in ["hidden", "collapsed", "phonetic"] {
                        if col.attr(flag).and_then(boolean).unwrap_or(false) {
                            props.push(flag.to_string());
                        }
                    }
                    if let Some(level) = col.attr("outlineLevel").filter(|level| *level != "0") {
                        props.push(format!("outline={level}"));
                    }
                    let style = style(col.attr("style"));
                    if style != default_style {
                        props.push(format!("style {style}"));
                    }
                    if props.is_empty() {
                        continue;
                    }
                    let value = props.join(" ");
                    for index in min.max(1)..=max.min(16_384) {
                        out.add(owner, "col", Some((0, index - 1)), value.clone());
                    }
                }
            }
            "sheetViews" => {
                for view in kid.children("sheetView") {
                    let mut view = view.clone();
                    view.kids.retain(|kid| kid.name != "selection");
                    out.add(
                        owner,
                        "sheetView",
                        None,
                        canonical(&view, &mut |_, _, _| None),
                    );
                }
            }
            "mergeCells" => {
                for merge in kid.children("mergeCell") {
                    out.add(
                        owner,
                        "mergeCell",
                        None,
                        merge.attr("ref").unwrap_or("").to_ascii_uppercase(),
                    );
                }
            }
            "conditionalFormatting" => {
                let mut sqref: Vec<String> = kid
                    .attr("sqref")
                    .unwrap_or("")
                    .split_whitespace()
                    .map(str::to_ascii_uppercase)
                    .collect();
                sqref.sort();
                for rule in kid.children("cfRule") {
                    let rank = rule
                        .attr("priority")
                        .and_then(|p| p.parse::<i64>().ok())
                        .and_then(|p| priorities.binary_search(&p).ok());
                    let text = canonical(rule, &mut |_, name, value| {
                        (name == "dxfId").then(|| {
                            value
                                .parse::<usize>()
                                .ok()
                                .and_then(|index| styles.dxfs.get(index).cloned())
                                .unwrap_or_default()
                        })
                    });
                    out.add(
                        owner,
                        "cfRule",
                        None,
                        format!(
                            "{} #{} {text}",
                            sqref.join(" "),
                            rank.map_or(-1, |r| r as i64)
                        ),
                    );
                }
            }
            "dataValidations" => {
                for validation in kid.children("dataValidation") {
                    let mut validation = validation.clone();
                    for (key, value) in &mut validation.attrs {
                        if key == "sqref" {
                            let mut refs: Vec<String> = value
                                .split_whitespace()
                                .map(str::to_ascii_uppercase)
                                .collect();
                            refs.sort();
                            *value = refs.join(" ");
                        }
                    }
                    out.add(
                        owner,
                        "dataValidation",
                        None,
                        canonical(&validation, &mut |_, _, _| None),
                    );
                }
            }
            "hyperlinks" => {
                for link in kid.children("hyperlink") {
                    let value = reader.canonical_with_rels(link, &rels, &mut used, "")?;
                    out.add(owner, "hyperlink", None, value);
                }
            }
            name => {
                let value = reader.canonical_with_rels(kid, &rels, &mut used, "")?;
                out.add(owner, name, None, value);
            }
        }
    }
    for rel in &rels {
        if used.contains(&rel.id) {
            continue;
        }
        let value = reader.target(rel)?;
        out.add(owner, &format!("rel:{}", rel.kind), None, value);
    }
    Ok(())
}

/// Le priorità delle regole di un foglio, in ordine: il posto di una regola
/// fra le altre è ciò che conta.
fn collect_priorities(node: &Node, out: &mut Vec<i64>) {
    if node.name == "cfRule" || node.name == "x14:cfRule" {
        if let Some(priority) = node.attr("priority").and_then(|p| p.parse().ok()) {
            out.push(priority);
        }
    }
    for kid in &node.kids {
        collect_priorities(kid, out);
    }
}

/// Il testo della formula di una cella; una formula condivisa si espande.
fn formula_text(
    formula: &Node,
    at: Option<(u32, u32)>,
    shared: &mut HashMap<String, Shared>,
) -> String {
    let text = formula.text.clone();
    if formula.attr("t") != Some("shared") {
        return text;
    }
    let Some(index) = formula.attr("si").map(str::to_string) else {
        return text;
    };
    if !text.is_empty() {
        if let Some(at) = at {
            shared.insert(
                index,
                Shared {
                    at,
                    text: text.clone(),
                },
            );
        }
        return text;
    }
    match (shared.get(&index), at) {
        (Some(master), Some(at)) => shift_formula(
            &master.text,
            i64::from(at.0) - i64::from(master.at.0),
            i64::from(at.1) - i64::from(master.at.1),
        ),
        _ => text,
    }
}

#[cfg(test)]
#[path = "../tests/common/mod.rs"]
mod common;

#[cfg(test)]
mod tests {
    use super::*;

    const COMMENTS: &str =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
    const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    /// Una cartella con ciò che una riscrittura deve portare: valori, formule,
    /// stili, unioni, regole (anche di Excel 2010), convalide, collegamenti con
    /// il loro testo, testo formattato, note con il loro disegno.
    fn rich() -> Vec<u8> {
        let sheet = r#"<sheetFormatPr defaultRowHeight="15"/><cols><col min="2" max="3" width="20.7109375" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>0.25</v></c><c r="C1" s="3" t="inlineStr"><is><r><rPr><b/></rPr><t>Uno</t></r><r><t xml:space="preserve"> due</t></r></is></c></row><row r="2" ht="30" customHeight="1"><c r="A2"><f>SUM(B1:B3)</f><v>0.25</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" s="5"><v>45000</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="D1:E2"/></mergeCells><conditionalFormatting sqref="B1:B3"><cfRule type="cellIs" dxfId="0" priority="2" operator="greaterThan"><formula>0</formula></cfRule><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{9B4F274F-F774-40EE-9C50-A8B810847010}</x14:id></ext></extLst></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="list" sqref="C3"><formula1>"sì,no"</formula1></dataValidation></dataValidations><hyperlinks><hyperlink ref="A1" location="Foglio1!C2" display="Alla data"/></hyperlinks><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><legacyDrawing r:id="rVml"/><extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{9B4F274F-F774-40EE-9C50-A8B810847010}"><x14:dataBar minLength="0" maxLength="100" border="1"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:borderColor rgb="FF638EC6"/></x14:dataBar></x14:cfRule><xm:sqref>B1:B3</xm:sqref></x14:conditionalFormatting><x14:conditionalFormatting><x14:cfRule type="iconSet" priority="1" id="{23404A22-2791-4FFE-B3BF-645D3DA783FE}"><x14:iconSet iconSet="3Stars"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo></x14:iconSet></x14:cfRule><xm:sqref>C1:C3</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>"#;
        let strings = r#"<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><r><rPr><i/><sz val="11"/><rFont val="Calibri"/></rPr><t>Titolo</t></r></si></sst>"#;
        let comments = r#"<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Anna</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><b/><sz val="9"/><rFont val="Tahoma"/></rPr><t>Anna:</t></r><r><rPr><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">
da rivedere</t></r></text></comment></commentList></comments>"#;
        let vml = "<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"><o:shapelayout v:ext=\"edit\"><o:idmap v:ext=\"edit\" data=\"1\"/></o:shapelayout><v:shape id=\"_x0000_s1025\" type=\"#_x0000_t202\" style=\"position:absolute;width:96pt;height:55.5pt;visibility:hidden;mso-wrap-style:tight\" fillcolor=\"infoBackground [80]\"><x:ClientData ObjectType=\"Note\"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>";
        let sheet_rels = format!(
            r#"<Relationship Id="rComments" Type="{R}/comments" Target="../comments1.xml"/><Relationship Id="rVml" Type="{R}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>"#
        );
        common::Package {
            sheets: vec![common::sheet("Foglio1", sheet)],
            workbook_tail: r#"<definedNames><definedName name="Totale">Foglio1!$A$2</definedName></definedNames>"#,
            parts: vec![
                ("xl/sharedStrings.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml", strings.as_bytes().to_vec()),
                ("xl/comments1.xml", COMMENTS, comments.as_bytes().to_vec()),
                ("xl/drawings/vmlDrawing1.vml", "application/vnd.openxmlformats-officedocument.vmlDrawing", vml.as_bytes().to_vec()),
            ],
            workbook_rels: vec![("rStrings", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings", "sharedStrings.xml")],
            sheet_rels: vec![(0, sheet_rels)],
            ..common::Package::default()
        }
        .bytes()
    }

    fn rewritten(bytes: &[u8], edit: impl FnOnce(&mut gridcraft_model::Workbook)) -> Vec<u8> {
        let (mut wb, _) = gridcraft_xlsx::read_xlsx(bytes).unwrap();
        edit(&mut wb);
        gridcraft_xlsx::write_xlsx(&wb).unwrap()
    }

    fn all_differences(before: &[u8], after: &[u8]) -> Vec<String> {
        let (before, after) = (inventory(before).unwrap(), inventory(after).unwrap());
        differences(&before, &after, |_| true)
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    /// Se una chiave dell'inventario porta `mark` nella sua forma intera.
    fn holds(inventory: &Inventory, mark: &str) -> bool {
        inventory.items.keys().any(|k| k.value.contains(mark))
    }

    #[test]
    fn una_cartella_riscritta_senza_modifiche_non_perde_niente() {
        let file = rich();
        let (before, after) = (
            inventory(&file).unwrap(),
            inventory(&rewritten(&file, |_| {})).unwrap(),
        );
        for mark in [
            "x14:conditionalFormattings",
            "Alla data",
            "Titolo",
            "Anna:",
            "idmap",
            "D1:E2",
            "sì,no",
            "Totale",
        ] {
            assert!(holds(&before, mark), "{mark}");
        }
        let found = differences(&before, &after, |_| true);
        let lost: Vec<String> = found
            .iter()
            .filter(|d| d.after < d.before)
            .map(ToString::to_string)
            .collect();
        assert_eq!(lost, Vec::<String>::new());
        // Ciò che si aggiunge sono le parti che GridCraft scrive sempre e
        // che questa cartella, fatta a mano, non aveva.
        let added: Vec<String> = found.iter().map(ToString::to_string).collect();
        let written = [
            "rel:core-properties",
            "rel:extended-properties",
            "calcPr",
            "rel:theme",
            "workbookView",
            "sheetView",
        ];
        assert!(
            added
                .iter()
                .all(|d| d.starts_with("0 → 1: ") && written.iter().any(|w| d.contains(w))),
            "{added:#?}"
        );
    }

    #[test]
    fn un_grafico_e_un_immagine_si_contano_e_restano() {
        use gridcraft_model::{Anchor, Chart, ChartKind, Image, LegendPos, Series};
        let data = common::one_sheet(
            r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nord</t></is></c><c r="B1"><v>3</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sud</t></is></c><c r="B2"><v>5</v></c></row></sheetData>"#,
        );
        let at = |cell| Anchor {
            cell: gridcraft_core::CellRef::parse(cell).unwrap(),
            width: 320.0,
            height: 200.0,
            ..Anchor::default()
        };
        let file = rewritten(&data, |wb| {
            let sheet = wb.sheet_mut(0).unwrap();
            sheet.charts.push(Chart {
                id: 1,
                kind: ChartKind::ColumnClustered,
                anchor: at("D2"),
                title: Some("Vendite".into()),
                series: vec![Series {
                    categories: Some("Foglio1!$A$1:$A$2".into()),
                    values: "Foglio1!$B$1:$B$2".into(),
                    ..Series::default()
                }],
                legend: LegendPos::Bottom,
                data_labels: false,
                gridlines: true,
                style: 2,
                x_title: None,
                y_title: None,
                source: None,
                by_rows: false,
                pivot: None,
            });
            let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
            png.extend([7; 64]);
            sheet.images.push(Image {
                id: 2,
                anchor: at("D20"),
                data: png.into(),
                mime: "image/png".into(),
                alt: "Logo".into(),
            });
        });
        let counted = inventory(&file).unwrap();
        for mark in ["Vendite", "Logo"] {
            assert!(holds(&counted, mark), "{mark}");
        }
        assert_eq!(
            all_differences(&file, &rewritten(&file, |_| {})),
            Vec::<String>::new()
        );
        let without = rewritten(&file, |wb| wb.sheet_mut(0).unwrap().charts.clear());
        let lost = differences(&counted, &inventory(&without).unwrap(), |_| true);
        assert!(
            lost.iter()
                .any(|d| d.after < d.before && d.key.value.contains("Vendite")),
            "{lost:#?}"
        );
    }

    #[test]
    fn una_perdita_della_riscrittura_si_conta() {
        let file = rich();
        let b2 = gridcraft_core::CellRef::new(1, 1);
        let lost = rewritten(&file, |wb| {
            let sheet = wb.sheet_mut(0).unwrap();
            sheet.comments.remove(&b2);
            sheet.hyperlinks.clear();
        });
        let found = all_differences(&file, &lost);
        assert!(found.iter().any(|d| d.contains("hyperlink")), "{found:#?}");
        assert!(
            found.iter().any(|d| d.contains("da rivedere")),
            "{found:#?}"
        );
    }

    #[test]
    fn cio_che_excel_ricava_non_si_conta() {
        let base = r#"<sheetFormatPr defaultColWidth="9" defaultRowHeight="15"/><cols><col min="1" max="1" width="12" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1"><v>1.0</v></c></row></sheetData>"#;
        let same = r#"<dimension ref="A1:B1"/><sheetFormatPr defaultColWidth="9.0" defaultRowHeight="15"/><cols><col min="1" max="1" width="12.0" bestFit="1"/><col min="2" max="9" width="9"/></cols><sheetData><row r="1" spans="1:2"><c r="A1" t="b"><v>true</v></c><c r="B1"><v>1</v></c></row></sheetData>"#;
        let saved_in = r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x15"><x15ac:absPath xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" url="C:\Utenti\Anna\"/></mc:Choice></mc:AlternateContent>"#;
        let a = common::one_sheet(base);
        let b = common::Package {
            sheets: vec![common::sheet("Foglio1", same)],
            workbook_tail: Box::leak(saved_in.to_string().into_boxed_str()),
            ..common::Package::default()
        }
        .bytes();
        assert_eq!(all_differences(&a, &b), Vec::<String>::new());
        // Una colonna più larga della predefinita conta.
        let wider = common::one_sheet(&base.replace(
            r#"<col min="1" max="1" width="12" customWidth="1"/>"#,
            r#"<col min="1" max="2" width="12"/>"#,
        ));
        assert_eq!(
            all_differences(&a, &wider),
            ["0 → 1: sheet 1 col (0,1): width=12"]
        );
    }

    #[test]
    fn un_xml_rotto_non_si_inventaria() {
        let broken =
            common::one_sheet("<sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></row></sheetData>");
        assert!(
            matches!(inventory(&broken), Err(InventoryError::Xml { .. })),
            "{:?}",
            inventory(&broken).err()
        );
        assert!(matches!(
            inventory(b"non un pacchetto"),
            Err(InventoryError::Package(_))
        ));
    }

    #[test]
    fn le_formule_condivise_si_spostano_come_in_excel() {
        assert_eq!(shift_formula("A1+$B$1+B$2+$C3", 2, 1), "B3+$B$1+C$2+$C5");
        assert_eq!(shift_formula("SUM(A1:A3)", 1, 0), "SUM(A2:A4)");
        assert_eq!(
            shift_formula("\"A1\"&'Q1 data'!A1", 1, 1),
            "\"A1\"&'Q1 data'!B2"
        );
        assert_eq!(shift_formula("LOG10(A1)", 1, 0), "LOG10(A2)");
        assert_eq!(
            shift_formula("Tabella1[Colonna1]+A1", 0, 1),
            "Tabella1[Colonna1]+B1"
        );
        assert_eq!(
            shift_formula("SUM(A:A)+SUM(1:1)", 1, 1),
            "SUM(B:B)+SUM(2:2)"
        );
        assert_eq!(shift_formula("A1", -1, 0), "#REF!");
        assert_eq!(shift_formula("Sheet2!A1*2.5E+3", 1, 0), "Sheet2!A2*2.5E+3");
    }

    #[test]
    fn i_numeri_e_i_booleani_hanno_una_forma_sola() {
        assert_eq!(number("1.0"), "1");
        assert_eq!(number("0.10"), "0.1");
        assert_eq!(number("-0"), "0");
        assert_eq!(number("007a"), "007a");
        assert_eq!(boolean("true"), Some(true));
        assert_eq!(cell_ref("$B$12"), Some((11, 1)));
        assert_eq!(cell_ref("XFE1"), None);
    }
}
