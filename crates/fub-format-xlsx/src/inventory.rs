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

mod canonical;
mod reader;
mod styles;
mod xml;

pub(crate) use canonical::canonical;
use canonical::{boolean, number};
pub(crate) use reader::inventory;
use reader::{rich_text, Reader};
use styles::{font_canonical, read_styles, Styles};
pub(crate) use xml::Node;
use xml::{parse, Budget};

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

/// I segni che l'inventario non conta, e perché. La tabella documenta le
/// regole, che il codice applica una per una: niente la legge.
#[allow(dead_code)]
pub(crate) const NORMALIZATIONS: &[(&str, &str)] = &[
    (
        "catena di calcolo",
        "xl/calcChain.xml è l'ordine in cui Excel ha calcolato le formule l'ultima volta: Excel la ricostruisce, e una cartella senza è valida",
    ),
    (
        "stringhe condivise, stili e metadati",
        "sharedStrings, styles e metadata non contano da sé: si risolvono nelle celle, nelle righe, nelle colonne e nelle regole che li nominano; una cartella senza styles ha gli stili di una cartella nuova di Excel, con cui Excel la apre",
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
        "elementi vuoti",
        "un elemento del documento o del foglio senza attributi né figli (<workbookProtection/>, <printOptions/>), e una proprietà vuota di <sheetPr>, valgono i predefiniti dello schema come un elemento assente",
    ),
    (
        "priorità delle regole",
        "la priority di una regola di formattazione condizionale conta come il suo posto fra le regole del foglio, perché un codec la rinumera",
    ),
];

/// Gli stili di una cartella senza la parte degli stili: quelli con cui Excel
/// la apre, gli stessi di una cartella nuova.
const NEW_WORKBOOK_STYLES: &str = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><scheme val="minor"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;

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
                if value != format!("<{name}></>") {
                    out.add(owner, name, None, value);
                }
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
use crate::common;

#[cfg(test)]
mod tests;
