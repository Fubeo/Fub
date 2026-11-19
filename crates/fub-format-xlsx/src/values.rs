//! Una cartella **nuova coi valori**: un foglio solo, le celle date una per
//! una, e il loro formato numerico. È ciò che scrive «Trasforma in foglio»
//! (E23): la tabella di una nota diventa un file `.xlsx` accanto a lei.
//!
//! Come per [`blank`](crate::blank) il codec di GridCraft scrive il pacchetto
//! intero, ed è lecito per la stessa ragione: il file non c'è ancora, e niente
//! di suo si può perdere. I byte si rileggono prima di tornare, e una rilettura
//! con avvisi è un errore.
//!
//! I valori arrivano già letti: un testo, un numero col suo aspetto, o niente.
//! Leggere «1.240,50 €» come un numero è della lingua di chi l'ha scritto, e
//! lo fa chi chiama; qui si traduce l'aspetto in un formato numerico di Excel
//! ([`number_format`]), che ogni programma mostra nella lingua di chi apre il
//! file. Le formule non si scrivono: un testo che comincia con `=` resta
//! testo, col segno dell'apostrofo come quando lo si scrive a mano.

use gridcraft_core::{quote_sheet, CellRef, RangeRef, Value, MAX_COLS, MAX_ROWS};
use gridcraft_model::style::NumFmt;
use gridcraft_model::Workbook;

use crate::input::{self, NewValue, MAX_TEXT_CHARS};
use crate::{guarded, read, XlsxError};

/// Le cifre dopo la virgola più numerose che un formato porta: oltre, il
/// doppio di Excel non ne ha di vere.
pub const MAX_DECIMALS: u8 = 15;

/// I caratteri più lunghi di un simbolo di valuta.
const MAX_CURRENCY_CHARS: usize = 4;

/// Una cella del foglio che nasce.
#[derive(Clone, Debug, PartialEq)]
pub enum Filled {
    /// La cella vuota.
    Blank,
    /// Un testo, così com'è. Uno che si leggerebbe come un numero o una
    /// formula resta testo.
    Text(String),
    /// Un numero e l'aspetto con cui era scritto.
    Number { value: f64, look: NumberLook },
}

/// L'aspetto di un numero scritto a mano: quante cifre dopo la virgola, i
/// separatori delle migliaia, la percentuale, la valuta, le parentesi dei
/// conti. Una percentuale porta il valore come frazione (`0.125` per «12,5%»)
/// e le cifre che si vedono (`1`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NumberLook {
    pub decimals: u8,
    pub grouped: bool,
    pub percent: bool,
    /// Il negativo fra parentesi, come nei conti: «(1.234)».
    pub parens: bool,
    pub currency: Option<Currency>,
}

/// Il simbolo di una valuta e dove sta.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Currency {
    pub symbol: String,
    /// Dopo il numero («12 €») o prima («€ 12», «$12»).
    pub after: bool,
    /// Uno spazio fra il simbolo e il numero.
    pub spaced: bool,
}

/// Perché i valori non diventano una cartella.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ValuesError {
    /// Nessuna cella.
    #[error("no cells")]
    Empty,
    /// Più righe o colonne di quante un foglio ne tiene.
    #[error("{rows} rows by {columns} columns do not fit a sheet")]
    TooLarge { rows: usize, columns: usize },
    /// Un testo oltre il limite di una cella.
    #[error("the text of {cell} is longer than a cell holds")]
    TooLong { cell: String },
    /// Un numero che non è finito.
    #[error("the number of {cell} is not finite")]
    NotFinite { cell: String },
    /// Un simbolo di valuta che un formato non porta.
    #[error("the currency symbol of {cell} cannot be written in a format")]
    Currency { cell: String },
    /// Un nome di foglio che Excel rifiuta.
    #[error("sheet name rejected: {0}")]
    SheetName(String),
    /// Il codec non scrive o non rilegge il pacchetto.
    #[error(transparent)]
    Codec(#[from] XlsxError),
}

/// La cartella scritta: i byte e la parte che i valori occupano, col foglio
/// (`Foglio1!A1:C5`, `'Conti 2025'!A1:C5`), da scrivere nell'embed.
#[derive(Clone, Debug, PartialEq)]
pub struct Written {
    pub bytes: Vec<u8>,
    pub part: String,
}

/// I byte di una cartella con un foglio, `sheet`, e le righe `rows` a partire
/// da `A1`. Con `header` la prima riga è l'intestazione, in grassetto.
/// `file_name` è il nome del file che nascerà, quello che il pacchetto ricorda
/// come proprio.
pub fn of_values(
    file_name: &str,
    sheet: &str,
    rows: &[Vec<Filled>],
    header: bool,
) -> Result<Written, ValuesError> {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if rows.is_empty() || columns == 0 {
        return Err(ValuesError::Empty);
    }
    if rows.len() > MAX_ROWS as usize || columns > MAX_COLS as usize {
        return Err(ValuesError::TooLarge {
            rows: rows.len(),
            columns,
        });
    }
    // Il controllo prima del codec: un errore nomina la cella, e il codec
    // riceve soltanto valori che sa scrivere.
    for (row, cells) in rows.iter().enumerate() {
        for (column, cell) in cells.iter().enumerate() {
            let at = || CellRef::new(row as u32, column as u32).a1();
            match cell {
                Filled::Blank => {}
                Filled::Text(text) => {
                    if text.chars().count() > MAX_TEXT_CHARS {
                        return Err(ValuesError::TooLong { cell: at() });
                    }
                }
                Filled::Number { value, look } => {
                    if !value.is_finite() {
                        return Err(ValuesError::NotFinite { cell: at() });
                    }
                    if look
                        .currency
                        .as_ref()
                        .is_some_and(|c| !writable_symbol(&c.symbol))
                    {
                        return Err(ValuesError::Currency { cell: at() });
                    }
                }
            }
        }
    }
    let range = RangeRef::new(
        CellRef::new(0, 0),
        CellRef::new(rows.len() as u32 - 1, columns as u32 - 1),
    )
    .a1();
    let part = format!("{}!{range}", quote_sheet(sheet));
    Workbook::new()
        .check_sheet_name(sheet, Some(0))
        .map_err(ValuesError::SheetName)?;
    let bytes = guarded(|| {
        let mut workbook = Workbook::new();
        fill(&mut workbook, sheet, rows, header);
        gridcraft_engine::io::save_bytes_as(
            &workbook,
            file_name,
            gridcraft_engine::io::FileKind::Xlsx,
        )
        .map_err(|error| XlsxError::Codec(error.to_string()))
    })?;
    let reread = read(&bytes)?;
    if let Some(warning) = reread.report.warnings.first() {
        return Err(ValuesError::Codec(XlsxError::Codec(warning.clone())));
    }
    Ok(Written { bytes, part })
}

/// Scrive le celle nel primo foglio, già controllate.
fn fill(workbook: &mut Workbook, name: &str, rows: &[Vec<Filled>], header: bool) {
    let bold = header.then(|| {
        workbook
            .styles
            .derive(Default::default(), |style| style.font.bold = true)
    });
    // Gli stili si internano prima di prendere il foglio: due prestiti
    // mutabili della cartella non stanno insieme.
    let mut planned: Vec<(CellRef, Value, Option<gridcraft_model::style::StyleId>)> = Vec::new();
    for (row, cells) in rows.iter().enumerate() {
        let head = header && row == 0;
        for (column, cell) in cells.iter().enumerate() {
            let at = CellRef::new(row as u32, column as u32);
            let (value, format, quoted) = match cell {
                Filled::Blank => continue,
                Filled::Text(text) if text.is_empty() => continue,
                Filled::Text(text) => {
                    // Un testo che si leggerebbe come altro porta l'apostrofo:
                    // nel foglio resta testo anche quando lo si modifica.
                    let quoted = input::parse(text) != Ok(NewValue::Text(text.clone()));
                    (Value::Text(text.as_str().into()), None, quoted)
                }
                Filled::Number { value, look } => (
                    Value::Number(if *value == 0.0 { 0.0 } else { *value }),
                    number_format(look),
                    false,
                ),
            };
            let base = if head { bold } else { None };
            let style = if format.is_some() || quoted {
                Some(workbook.styles.derive(base.unwrap_or_default(), |style| {
                    if let Some(code) = &format {
                        style.num_fmt = NumFmt::new(code);
                    }
                    style.quote_prefix = quoted;
                }))
            } else {
                base
            };
            planned.push((at, value, style));
        }
    }
    if let Some(sheet) = workbook.sheet_mut(0) {
        sheet.name = name.to_string();
        for (at, value, style) in planned {
            sheet.set_value(at, value);
            if let Some(style) = style {
                sheet.set_style(at, style);
            }
        }
    }
}

/// Un simbolo che sta fra le virgolette di un formato: corto, senza
/// virgolette, barre rovesciate o caratteri di controllo.
fn writable_symbol(symbol: &str) -> bool {
    let count = symbol.chars().count();
    (1..=MAX_CURRENCY_CHARS).contains(&count)
        && !symbol
            .chars()
            .any(|c| c == '"' || c == '\\' || c.is_control() || c.is_whitespace())
}

/// Il formato numerico di Excel che mostra un numero con l'aspetto `look`, o
/// `None` per il formato «Generale» (un numero intero senza separatori e
/// senza simboli).
///
/// I separatori sono quelli del formato (`,` le migliaia, `.` i decimali):
/// chi apre il file li vede nella propria lingua.
pub fn number_format(look: &NumberLook) -> Option<String> {
    let decimals = look.decimals.min(MAX_DECIMALS) as usize;
    if decimals == 0 && !look.grouped && !look.percent && !look.parens && look.currency.is_none() {
        return None;
    }
    let mut body = String::from(if look.grouped { "#,##0" } else { "0" });
    if decimals > 0 {
        body.push('.');
        body.push_str(&"0".repeat(decimals));
    }
    if look.percent {
        body.push('%');
    }
    if let Some(currency) = &look.currency {
        let space = if currency.spaced { " " } else { "" };
        body = if currency.after {
            format!("{body}\"{space}{}\"", currency.symbol)
        } else {
            format!("\"{}{space}\"{body}", currency.symbol)
        };
    }
    Some(if look.parens {
        format!("{body};({body})")
    } else {
        body
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use gridcraft_numfmt::{format_value, NumberFormat};

    fn number(value: f64, look: NumberLook) -> Filled {
        Filled::Number { value, look }
    }

    fn euro_after() -> Option<Currency> {
        Some(Currency {
            symbol: "€".into(),
            after: true,
            spaced: true,
        })
    }

    /// Il testo che il foglio mostra per una cella, col suo formato.
    fn shown(workbook: &Workbook, at: &str) -> String {
        let sheet = workbook.sheet(0).unwrap();
        let at = CellRef::parse(at).unwrap();
        let style = workbook.styles.get(sheet.style_id(at));
        format_value(
            &sheet.value(at),
            &NumberFormat::parse_cached(style.num_fmt.as_str()),
            workbook.date_system,
        )
        .text
    }

    #[test]
    fn i_formati_dicono_l_aspetto_del_numero() {
        assert_eq!(number_format(&NumberLook::default()), None);
        let grouped = NumberLook {
            decimals: 2,
            grouped: true,
            ..NumberLook::default()
        };
        assert_eq!(number_format(&grouped).as_deref(), Some("#,##0.00"));
        let percent = NumberLook {
            decimals: 1,
            percent: true,
            ..NumberLook::default()
        };
        assert_eq!(number_format(&percent).as_deref(), Some("0.0%"));
        let euro = NumberLook {
            decimals: 2,
            grouped: true,
            currency: euro_after(),
            ..NumberLook::default()
        };
        assert_eq!(number_format(&euro).as_deref(), Some("#,##0.00\" €\""));
        let dollar = NumberLook {
            currency: Some(Currency {
                symbol: "$".into(),
                after: false,
                spaced: false,
            }),
            parens: true,
            ..NumberLook::default()
        };
        assert_eq!(number_format(&dollar).as_deref(), Some("\"$\"0;(\"$\"0)"));
    }

    #[test]
    fn i_valori_tornano_coi_loro_tipi_e_il_loro_aspetto() {
        let rows = vec![
            vec![
                Filled::Text("Mese".into()),
                Filled::Text("Spesa".into()),
                Filled::Text("12".into()),
            ],
            vec![
                Filled::Text("Gennaio".into()),
                number(
                    1240.5,
                    NumberLook {
                        decimals: 2,
                        grouped: true,
                        currency: euro_after(),
                        ..NumberLook::default()
                    },
                ),
                number(
                    0.125,
                    NumberLook {
                        decimals: 1,
                        percent: true,
                        ..NumberLook::default()
                    },
                ),
            ],
            vec![
                Filled::Text("=SOMMA(B2)".into()),
                Filled::Blank,
                number(
                    -1234.0,
                    NumberLook {
                        grouped: true,
                        parens: true,
                        ..NumberLook::default()
                    },
                ),
            ],
            vec![Filled::Text("a\ncapo".into())],
        ];
        let written = of_values("Conti.xlsx", "Foglio1", &rows, true).unwrap();
        assert_eq!(written.part, "Foglio1!A1:C4");
        let spaced = of_values("Conti.xlsx", "Conti 2025", &rows, true).unwrap();
        assert_eq!(spaced.part, "'Conti 2025'!A1:C4");
        let read = read(&written.bytes).unwrap();
        assert!(
            read.report.warnings.is_empty(),
            "{:?}",
            read.report.warnings
        );
        let workbook = read.workbook;
        assert_eq!(workbook.sheets.len(), 1);
        let sheet = workbook.sheet(0).unwrap();
        assert_eq!(sheet.name, "Foglio1");
        assert_eq!(
            sheet.value(CellRef::parse("B2").unwrap()),
            Value::Number(1240.5)
        );
        assert_eq!(
            sheet.value(CellRef::parse("C2").unwrap()),
            Value::Number(0.125)
        );
        // Un testo che si legge come numero, nell'intestazione, resta testo.
        assert_eq!(
            sheet.value(CellRef::parse("C1").unwrap()),
            Value::Text("12".into())
        );
        // Una formula scritta in una tabella è testo, e non si calcola.
        assert_eq!(
            sheet.value(CellRef::parse("A3").unwrap()),
            Value::Text("=SOMMA(B2)".into())
        );
        assert!(sheet
            .cell(CellRef::parse("A3").unwrap())
            .unwrap()
            .formula
            .is_none());
        assert_eq!(sheet.value(CellRef::parse("B3").unwrap()), Value::Empty);
        assert_eq!(
            sheet.value(CellRef::parse("A4").unwrap()),
            Value::Text("a\ncapo".into())
        );
        assert_eq!(shown(&workbook, "B2"), "1,240.50 €");
        assert_eq!(shown(&workbook, "C2"), "12.5%");
        assert_eq!(shown(&workbook, "C3"), "(1,234)");
        // L'intestazione è in grassetto, il resto no.
        let bold = |at: &str| {
            workbook
                .styles
                .get(sheet.style_id(CellRef::parse(at).unwrap()))
                .font
                .bold
        };
        assert!(bold("A1") && bold("C1"));
        assert!(!bold("A2"));
    }

    #[test]
    fn cio_che_un_foglio_non_tiene_non_si_scrive() {
        assert_eq!(
            of_values("a.xlsx", "Foglio1", &[], true),
            Err(ValuesError::Empty)
        );
        assert_eq!(
            of_values("a.xlsx", "Foglio1", &[vec![]], true),
            Err(ValuesError::Empty)
        );
        let long = vec![vec![Filled::Text("x".repeat(MAX_TEXT_CHARS + 1))]];
        assert_eq!(
            of_values("a.xlsx", "Foglio1", &long, false),
            Err(ValuesError::TooLong { cell: "A1".into() })
        );
        let wide = vec![vec![Filled::Blank; MAX_COLS as usize + 1]];
        assert!(matches!(
            of_values("a.xlsx", "Foglio1", &wide, false),
            Err(ValuesError::TooLarge { .. })
        ));
        let infinite = vec![vec![
            Filled::Text("a".into()),
            number(f64::NAN, NumberLook::default()),
        ]];
        assert_eq!(
            of_values("a.xlsx", "Foglio1", &infinite, false),
            Err(ValuesError::NotFinite { cell: "B1".into() })
        );
        let quoted = vec![vec![number(
            1.0,
            NumberLook {
                currency: Some(Currency {
                    symbol: "\"".into(),
                    after: true,
                    spaced: false,
                }),
                ..NumberLook::default()
            },
        )]];
        assert_eq!(
            of_values("a.xlsx", "Foglio1", &quoted, false),
            Err(ValuesError::Currency { cell: "A1".into() })
        );
        let one = vec![vec![Filled::Text("a".into())]];
        assert!(matches!(
            of_values("a.xlsx", "a/b", &one, false),
            Err(ValuesError::SheetName(_))
        ));
    }
}
