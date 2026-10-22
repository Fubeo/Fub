//! La **copia in Excel** di un foglio `.fubsheet`: una cartella nuova, scritta
//! dal modello di GridCraft, con la misura di ciò che non porta.
//!
//! Il `.fubsheet` resta com'è: la copia è un file nuovo, e il codec di
//! GridCraft la scrive per intero, perché non c'è un file di Excel da
//! preservare. Le righe e le colonne diventano posizioni nell'ordine del
//! foglio, che è l'ordine con cui le formule del `.fubsheet` le nominano
//! (`fub_format_sheet::excel_formula` le scrive nella sintassi di Excel).
//!
//! # I valori
//!
//! Le formule della copia portano il valore calcolato da GridCraft, che ha la
//! semantica di Excel, e la cartella chiede a Excel di ricalcolare
//! all'apertura (`fullCalcOnLoad`). Dove quel valore non è quello che il
//! `.fubsheet` mostra in Fub (una funzione che qui non c'è, un confronto fra
//! testi che Excel fa senza maiuscole, un riferimento oltre la griglia), la
//! differenza è un avviso con le celle.
//!
//! # Nessuna perdita silenziosa
//!
//! La copia si **rilegge** con il codec e si confronta cella per cella con il
//! `.fubsheet`: input, formule, stile, dimensioni. Ogni voce che manca è un
//! avviso con il numero; i fogli rinominati per le regole di Excel, le
//! formule rimaste testo e le proprietà che il formato non ha lo dicono a
//! parte.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use fub_format_sheet::{
    excel_formula, CellStyle, CellValue, HorizontalAlign, Workbook as SheetWorkbook,
};
use gridcraft_calc::recalc::Calc;
use gridcraft_core::{CellRef, Value};
use gridcraft_model::{
    Alignment, Cell, Color, Fill, Formula, HAlign, LineInfo, NumFmt, Sheet, Style, StyleId,
    Workbook,
};
use gridcraft_xlsx::XlsxKind;

use crate::XlsxError;

/// I caratteri di una cella di Excel.
const EXCEL_TEXT_CHARS: usize = 32_767;
/// I caratteri di un codice di formato numerico di Excel.
const EXCEL_NUMBER_FORMAT_CHARS: usize = 255;
/// Le celle nominate in un avviso: le altre si contano.
const NAMED_CELLS: usize = 5;
/// Quanto può scostarsi un numero riletto: la scrittura del codec arrotonda
/// a 17 cifre, e una somma può cambiare ordine.
const NUMBER_TOLERANCE: f64 = 1e-12;
/// Quanto può scostarsi una dimensione riletta: Excel salva le larghezze in
/// caratteri, e la conversione arrotonda.
const SIZE_TOLERANCE: f32 = 0.5;

/// Una nota sulla copia.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    /// Un avviso dice ciò che la copia perde o cambia; il resto è
    /// un'informazione.
    pub warning: bool,
    pub text: String,
}

impl Note {
    fn warning(text: impl Into<String>) -> Note {
        Note {
            warning: true,
            text: text.into(),
        }
    }

    fn info(text: impl Into<String>) -> Note {
        Note {
            warning: false,
            text: text.into(),
        }
    }
}

/// La copia scritta, con le sue note.
#[derive(Clone, Debug)]
pub struct Copy {
    pub bytes: Vec<u8>,
    pub notes: Vec<Note>,
}

/// La copia in Excel di `source`, e ciò che non porta.
pub fn copy(source: &SheetWorkbook) -> Result<Copy, XlsxError> {
    let values = source
        .evaluate()
        .map_err(|error| XlsxError::Codec(error.to_string()))?;
    crate::guarded(|| {
        let built = build(source);
        let mut workbook = built.workbook;
        Calc::new().recalc_all(&mut workbook);
        let bytes = gridcraft_xlsx::write_xlsx_as(&workbook, XlsxKind::Workbook)
            .map_err(|error| XlsxError::Codec(error.to_string()))?;
        let bytes = crate::graft::recalc_on_open(&bytes)
            .map_err(|error| XlsxError::Codec(error.to_string()))?;
        let (reread, _) = gridcraft_xlsx::read_xlsx(&bytes)
            .map_err(|error| XlsxError::Codec(format!("the copy cannot be read back: {error}")))?;
        let mut notes = built.notes;
        notes.extend(measure(
            source,
            &values.cells,
            &built.names,
            &built.as_text,
            &reread,
        ));
        Ok(Copy { bytes, notes })
    })
}

/// Il modello di GridCraft di un `.fubsheet`, prima del calcolo.
struct Built {
    workbook: Workbook,
    /// Il nome nella copia di ogni foglio, nell'ordine.
    names: Vec<String>,
    /// Le formule che Excel non legge, rimaste testo: foglio e cella.
    as_text: HashSet<(usize, CellRef)>,
    notes: Vec<Note>,
}

fn build(source: &SheetWorkbook) -> Built {
    let mut notes = Vec::new();
    let names = excel_names(source);
    for (sheet, name) in source.sheets.iter().zip(&names) {
        if &sheet.name != name {
            notes.push(Note::warning(format!(
                "il foglio «{}» si chiama «{name}» nella copia: Excel non ammette quel nome",
                sheet.name
            )));
        }
    }
    let by_name: HashMap<&str, &str> = source
        .sheets
        .iter()
        .zip(&names)
        .map(|(sheet, name)| (sheet.name.as_str(), name.as_str()))
        .collect();
    let excel_name = |name: &str| by_name.get(name).map(|name| name.to_string());

    let mut workbook = Workbook::new();
    let mut styles: HashMap<CellStyle, StyleId> = HashMap::new();
    let mut sheets = Vec::with_capacity(source.sheets.len().max(1));
    let mut as_text = HashSet::new();
    let mut shortened = 0usize;
    for (index, (sheet, name)) in source.sheets.iter().zip(&names).enumerate() {
        let mut out = Sheet::new(name.clone());
        for (at, row) in sheet.rows.iter().enumerate() {
            if row.height.is_some() || row.hidden {
                out.rows.insert(
                    at as u32,
                    LineInfo {
                        size: row.height,
                        hidden: row.hidden,
                        custom: row.height.is_some(),
                        ..LineInfo::default()
                    },
                );
            }
        }
        for (at, column) in sheet.columns.iter().enumerate() {
            if column.width.is_some() || column.hidden {
                out.cols.insert(
                    at as u32,
                    LineInfo {
                        size: column.width,
                        hidden: column.hidden,
                        ..LineInfo::default()
                    },
                );
            }
        }
        let positions = Positions::of(sheet);
        for cell in &sheet.cells {
            let Some(at) = positions.at(cell) else {
                continue;
            };
            let style = *styles
                .entry(cell.style.clone())
                .or_insert_with(|| workbook.styles.intern(excel_style(&cell.style)));
            let mut out_cell = if cell.input.starts_with('=') {
                // Il testo di Excel si rilegge con il parser di GridCraft: una
                // formula che non legge resterebbe `#NAME?` nella copia.
                match excel_formula(&cell.input, excel_name)
                    .map(|text| Formula::new(&text))
                    .filter(|formula| formula.expr.is_some())
                {
                    Some(formula) => Cell::formula(formula),
                    None => {
                        as_text.insert((index, at));
                        Cell::value(text_value(&cell.input, &mut shortened))
                    }
                }
            } else {
                Cell::value(constant(&cell.input, &mut shortened))
            };
            out_cell.style = style;
            if !out_cell.is_blank() {
                out.set_cell(at, out_cell);
            }
        }
        sheets.push(Arc::new(out));
    }
    if sheets.is_empty() {
        notes.push(Note::info(
            "il foglio non ha fogli: la copia ne ha uno vuoto, perché Excel ne vuole almeno uno",
        ));
        sheets.push(Arc::new(Sheet::new("Foglio1")));
    }
    workbook.sheets = sheets;
    if shortened > 0 {
        notes.push(Note::warning(format!(
            "{} oltre {EXCEL_TEXT_CHARS} caratteri, che una cella di Excel non tiene: \
             nella copia sono accorciat{}",
            counted(shortened, "testo", "testi"),
            if shortened == 1 { "o" } else { "i" }
        )));
    }
    let workbook_properties = source.properties.len();
    let sheet_properties: usize = source.sheets.iter().map(|s| s.properties.len()).sum();
    if workbook_properties + sheet_properties > 0 {
        notes.push(Note::warning(format!(
            "{} del .fubsheet non entra{} nella copia: una cartella di Excel non ha dove tenerl{}",
            counted(
                workbook_properties + sheet_properties,
                "proprietà",
                "proprietà"
            ),
            if workbook_properties + sheet_properties == 1 {
                ""
            } else {
                "no"
            },
            if workbook_properties + sheet_properties == 1 {
                "a"
            } else {
                "e"
            },
        )));
    }
    notes.push(Note::info(
        "nella copia righe e colonne sono posizioni: gli id stabili del .fubsheet, a cui \
         puntano i suoi link alle celle, non entrano nel file",
    ));
    Built {
        workbook,
        names,
        as_text,
        notes,
    }
}

/// I nomi dei fogli secondo le regole di Excel: da 1 a 31 caratteri, senza
/// `: \ / ? * [ ]`, senza apostrofo ai bordi, non `History`, e diversi
/// senza contare le maiuscole. Un nome che le rispetta resta com'è.
fn excel_names(source: &SheetWorkbook) -> Vec<String> {
    let mut taken: HashSet<String> = HashSet::new();
    let mut names = Vec::with_capacity(source.sheets.len());
    // Prima i nomi validi, che restano; poi gli altri, che prendono un nome
    // libero.
    let valid: Vec<bool> = source
        .sheets
        .iter()
        .map(|sheet| is_excel_name(&sheet.name) && taken.insert(sheet.name.to_lowercase()))
        .collect();
    for (sheet, valid) in source.sheets.iter().zip(valid) {
        if valid {
            names.push(sheet.name.clone());
            continue;
        }
        let base: String = sheet
            .name
            .chars()
            .map(|c| match c {
                ':' | '\\' | '/' | '?' | '*' | '[' | ']' => '_',
                c if c.is_control() => '_',
                c => c,
            })
            .collect();
        let base = base.trim_matches('\'').trim();
        let base = if base.is_empty() { "Foglio" } else { base };
        let name = (0u32..)
            .map(|n| {
                let suffix = if n == 0 {
                    String::new()
                } else {
                    format!(" ({})", n + 1)
                };
                let room = 31 - suffix.chars().count();
                let head: String = base.chars().take(room).collect();
                format!("{}{suffix}", head.trim_end_matches('\''))
            })
            .find(|name| is_excel_name(name) && taken.insert(name.to_lowercase()))
            .expect("i suffissi sono infiniti");
        names.push(name);
    }
    names
}

fn is_excel_name(name: &str) -> bool {
    let chars = name.chars().count();
    (1..=31).contains(&chars)
        && !name
            .chars()
            .any(|c| matches!(c, ':' | '\\' | '/' | '?' | '*' | '[' | ']') || c.is_control())
        && !name.starts_with('\'')
        && !name.ends_with('\'')
        && !name.eq_ignore_ascii_case("History")
}

/// Le posizioni delle righe e delle colonne di un foglio.
struct Positions<'a> {
    rows: HashMap<&'a str, u32>,
    columns: HashMap<&'a str, u32>,
}

impl<'a> Positions<'a> {
    fn of(sheet: &'a fub_format_sheet::Sheet) -> Self {
        Positions {
            rows: sheet
                .rows
                .iter()
                .enumerate()
                .map(|(at, row)| (row.id.as_ref(), at as u32))
                .collect(),
            columns: sheet
                .columns
                .iter()
                .enumerate()
                .map(|(at, column)| (column.id.as_ref(), at as u32))
                .collect(),
        }
    }

    fn at(&self, cell: &fub_format_sheet::Cell) -> Option<CellRef> {
        let at = CellRef::new(
            *self.rows.get(cell.row.as_ref())?,
            *self.columns.get(cell.column.as_ref())?,
        );
        at.is_valid().then_some(at)
    }
}

/// Lo stile di Excel di una cella del `.fubsheet`.
fn excel_style(style: &CellStyle) -> Style {
    let mut out = Style::default();
    out.font.bold = style.bold;
    out.font.italic = style.italic;
    if let Some(color) = style.text_color.as_deref().and_then(hex_color) {
        out.font.color = color;
    }
    if let Some(color) = style.fill_color.as_deref().and_then(hex_color) {
        out.fill = Fill::solid(color);
    }
    if let Some(horizontal) = style.horizontal {
        out.align = Alignment {
            h: match horizontal {
                HorizontalAlign::Start => HAlign::Left,
                HorizontalAlign::Center => HAlign::Center,
                HorizontalAlign::End => HAlign::Right,
            },
            ..Alignment::default()
        };
    }
    if let Some(format) = style
        .number_format
        .as_deref()
        .filter(|f| excel_number_format(f))
    {
        out.num_fmt = NumFmt::new(format);
    }
    out
}

/// Un colore esadecimale CSS (`#rgb` o `#rrggbb`); gli altri modi di dire un
/// colore non hanno un equivalente sicuro in Excel.
fn hex_color(color: &str) -> Option<Color> {
    let hex = color.trim().strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let full = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 => hex.to_string(),
        _ => return None,
    };
    u32::from_str_radix(&full, 16).ok().map(Color::Rgb)
}

fn excel_number_format(format: &str) -> bool {
    !format.is_empty()
        && format.chars().count() <= EXCEL_NUMBER_FORMAT_CHARS
        && !format.chars().any(char::is_control)
}

/// Il valore di una costante del `.fubsheet`, letta come la legge lui: vero
/// e falso senza maiuscole, un numero di Rust, il resto testo. Un numero che
/// non è finito (`inf`, `NaN`) resta il testo scritto.
fn constant(input: &str, shortened: &mut usize) -> Value {
    if input.is_empty() {
        Value::Empty
    } else if input.eq_ignore_ascii_case("TRUE") {
        Value::Bool(true)
    } else if input.eq_ignore_ascii_case("FALSE") {
        Value::Bool(false)
    } else {
        match input.parse::<f64>() {
            Ok(number) if number.is_finite() => Value::number(number),
            _ => text_value(input, shortened),
        }
    }
}

fn text_value(input: &str, shortened: &mut usize) -> Value {
    if input.chars().count() > EXCEL_TEXT_CHARS {
        *shortened += 1;
        Value::text(input.chars().take(EXCEL_TEXT_CHARS).collect::<String>())
    } else {
        Value::text(input)
    }
}

/// Ciò che la copia riletta porta del `.fubsheet`.
fn measure(
    source: &SheetWorkbook,
    values: &[fub_format_sheet::EvaluatedCell],
    names: &[String],
    as_text: &HashSet<(usize, CellRef)>,
    copy: &Workbook,
) -> Vec<Note> {
    let mut notes = Vec::new();
    let mut had: BTreeMap<Item, usize> = BTreeMap::new();
    let mut kept: BTreeMap<Item, usize> = BTreeMap::new();
    let mut count = |item: Item, survived: bool| {
        *had.entry(item).or_default() += 1;
        if survived {
            *kept.entry(item).or_default() += 1;
        }
    };
    let fub_values: HashMap<(&str, &str, &str), &CellValue> = values
        .iter()
        .map(|cell| {
            (
                (cell.sheet.as_ref(), cell.row.as_ref(), cell.column.as_ref()),
                &cell.value,
            )
        })
        .collect();
    let mut different: Vec<String> = Vec::new();
    let mut different_count = 0usize;
    let mut text_formulas: Vec<String> = Vec::new();

    for (index, (sheet, name)) in source.sheets.iter().zip(names).enumerate() {
        let target = copy.sheets.iter().find(|candidate| &candidate.name == name);
        count(Item::Sheets, target.is_some());
        let empty = Sheet::new(name.clone());
        let target: &Sheet = target.map(|sheet| &**sheet).unwrap_or(&empty);
        for (at, row) in sheet.rows.iter().enumerate() {
            let line = target.rows.get(&(at as u32));
            if let Some(height) = row.height {
                count(
                    Item::RowHeights,
                    line.and_then(|line| line.size)
                        .is_some_and(|size| (size - height).abs() <= SIZE_TOLERANCE),
                );
            }
            if row.hidden {
                count(Item::HiddenRows, line.is_some_and(|line| line.hidden));
            }
        }
        for (at, column) in sheet.columns.iter().enumerate() {
            let line = target.cols.get(&(at as u32));
            if let Some(width) = column.width {
                count(
                    Item::ColumnWidths,
                    line.and_then(|line| line.size)
                        .is_some_and(|size| (size - width).abs() <= SIZE_TOLERANCE),
                );
            }
            if column.hidden {
                count(Item::HiddenColumns, line.is_some_and(|line| line.hidden));
            }
        }
        let positions = Positions::of(sheet);
        for cell in &sheet.cells {
            let at = positions.at(cell);
            let out = at.and_then(|at| target.cell(at));
            let style = out.map(|out| copy.styles.get(out.style));
            let address = || match at {
                Some(at) => format!("{name}!{}", at.a1()),
                None => format!("{name}!{}:{}", cell.row.as_ref(), cell.column.as_ref()),
            };
            let formula = cell.input.starts_with('=');
            if !cell.input.is_empty() {
                count(
                    Item::Values,
                    out.is_some_and(|out| !out.value.is_empty() || out.formula.is_some()),
                );
            }
            if formula {
                let as_text = at.is_some_and(|at| as_text.contains(&(index, at)));
                if as_text && text_formulas.len() < NAMED_CELLS {
                    text_formulas.push(address());
                }
                count(Item::Formulas, out.is_some_and(|out| out.formula.is_some()));
            }
            let fub_style = &cell.style;
            if fub_style.bold {
                count(Item::Bold, style.is_some_and(|style| style.font.bold));
            }
            if fub_style.italic {
                count(Item::Italic, style.is_some_and(|style| style.font.italic));
            }
            if let Some(color) = &fub_style.text_color {
                let wanted = hex_color(color);
                count(
                    Item::TextColors,
                    wanted.is_some() && style.is_some_and(|style| Some(style.font.color) == wanted),
                );
            }
            if let Some(color) = &fub_style.fill_color {
                let wanted = hex_color(color).map(Fill::solid);
                count(
                    Item::FillColors,
                    wanted.is_some() && style.is_some_and(|style| Some(style.fill) == wanted),
                );
            }
            if let Some(horizontal) = fub_style.horizontal {
                let wanted = match horizontal {
                    HorizontalAlign::Start => HAlign::Left,
                    HorizontalAlign::Center => HAlign::Center,
                    HorizontalAlign::End => HAlign::Right,
                };
                count(
                    Item::Alignments,
                    style.is_some_and(|style| style.align.h == wanted),
                );
            }
            if let Some(format) = &fub_style.number_format {
                count(
                    Item::NumberFormats,
                    style.is_some_and(|style| style.num_fmt.as_str() == format),
                );
            }
            // Il valore: quello che Fub mostra, e quello che la copia porta.
            let mine = fub_values
                .get(&(sheet.id.as_ref(), cell.row.as_ref(), cell.column.as_ref()))
                .copied();
            let theirs = out.map(|out| &out.value);
            let as_text = at.is_some_and(|at| as_text.contains(&(index, at)));
            if let Some(mine) = mine {
                if !as_text && !same_value(mine, theirs.unwrap_or(&Value::Empty)) {
                    different_count += 1;
                    if different.len() < NAMED_CELLS {
                        different.push(format!(
                            "{} (Fub {}, la copia {})",
                            address(),
                            shown_fub(mine),
                            shown_copy(theirs.unwrap_or(&Value::Empty))
                        ));
                    }
                }
            }
        }
    }

    let mut missing = Vec::new();
    for item in Item::ALL {
        let had = had.get(&item).copied().unwrap_or(0);
        let has = kept.get(&item).copied().unwrap_or(0);
        if has < had {
            missing.push(match has {
                0 => item.counted(had),
                has => format!("{} su {had}", item.counted(had - has)),
            });
        }
    }
    if !missing.is_empty() {
        notes.push(Note::warning(format!(
            "la copia non porta: {}",
            missing.join(", ")
        )));
    }
    let text_count = as_text.len();
    if text_count > 0 {
        notes.push(Note::warning(format!(
            "{} che Excel non sa leggere rest{} testo nella copia: {}{}",
            counted(text_count, "formula", "formule"),
            if text_count == 1 { "a" } else { "ano" },
            text_formulas.join(", "),
            more(text_count, text_formulas.len()),
        )));
    }
    if different_count > 0 {
        notes.push(Note::warning(format!(
            "{} nella copia un valore diverso da quello che Fub mostra, perché Excel \
             calcola a modo suo: {}{}",
            match different_count {
                1 => "1 cella ha".to_string(),
                n => format!("{n} celle hanno"),
            },
            different.join("; "),
            more(different_count, different.len()),
        )));
    }
    notes.push(Note::info(
        "Excel ricalcola le formule della copia quando la apre",
    ));
    notes
}

/// Quante altre ce ne sono oltre quelle nominate.
fn more(total: usize, named: usize) -> String {
    match total.saturating_sub(named) {
        0 => String::new(),
        rest => format!(" e altre {rest}"),
    }
}

fn counted(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Lo stesso valore per chi lo guarda.
fn same_value(fub: &CellValue, copy: &Value) -> bool {
    match (fub, copy) {
        (CellValue::Blank, Value::Empty) => true,
        (CellValue::Number(a), Value::Number(b)) => {
            a == b || (a - b).abs() <= NUMBER_TOLERANCE * a.abs().max(b.abs())
        }
        (CellValue::Text(a), Value::Text(b)) => a.as_str() == &**b,
        (CellValue::Boolean(a), Value::Bool(b)) => a == b,
        (CellValue::Error(a), Value::Error(b)) => a.display() == b.as_str(),
        _ => false,
    }
}

fn shown_fub(value: &CellValue) -> String {
    match value {
        CellValue::Blank => "vuota".into(),
        CellValue::Text(text) => format!("«{}»", short(text)),
        value => value.display(),
    }
}

fn shown_copy(value: &Value) -> String {
    match value {
        Value::Empty => "vuota".into(),
        Value::Text(text) => format!("«{}»", short(text)),
        Value::Number(number) => number.to_string(),
        Value::Bool(true) => "TRUE".into(),
        Value::Bool(false) => "FALSE".into(),
        Value::Error(error) => error.as_str().into(),
        Value::Array(_) => "una matrice".into(),
    }
}

fn short(text: &str) -> String {
    if text.chars().count() <= 24 {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(24).collect::<String>())
    }
}

/// Ciò che si conta del `.fubsheet` e si ritrova nella copia.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Item {
    Sheets,
    Values,
    Formulas,
    Bold,
    Italic,
    TextColors,
    FillColors,
    Alignments,
    NumberFormats,
    RowHeights,
    ColumnWidths,
    HiddenRows,
    HiddenColumns,
}

impl Item {
    pub const ALL: [Item; 13] = [
        Item::Sheets,
        Item::Values,
        Item::Formulas,
        Item::Bold,
        Item::Italic,
        Item::TextColors,
        Item::FillColors,
        Item::Alignments,
        Item::NumberFormats,
        Item::RowHeights,
        Item::ColumnWidths,
        Item::HiddenRows,
        Item::HiddenColumns,
    ];

    fn counted(self, n: usize) -> String {
        let (one, many) = match self {
            Item::Sheets => ("foglio", "fogli"),
            Item::Values => ("cella scritta", "celle scritte"),
            Item::Formulas => ("formula", "formule"),
            Item::Bold => ("cella in grassetto", "celle in grassetto"),
            Item::Italic => ("cella in corsivo", "celle in corsivo"),
            Item::TextColors => ("colore del testo", "colori del testo"),
            Item::FillColors => ("colore di riempimento", "colori di riempimento"),
            Item::Alignments => ("allineamento", "allineamenti"),
            Item::NumberFormats => ("formato numerico", "formati numerici"),
            Item::RowHeights => ("altezza di riga", "altezze di riga"),
            Item::ColumnWidths => ("larghezza di colonna", "larghezze di colonna"),
            Item::HiddenRows => ("riga nascosta", "righe nascoste"),
            Item::HiddenColumns => ("colonna nascosta", "colonne nascoste"),
        };
        counted(n, one, many)
    }
}
