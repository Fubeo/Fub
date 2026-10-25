//! L'input di una cella: il testo che la griglia mostra nella barra della
//! formula e che l'utente scrive, e il valore costante che ne viene.
//!
//! La regola è senza locale: un numero si scrive con il punto decimale, come lo
//! salva il file, e la shell converte il separatore della lingua prima di
//! mandarlo. Niente si indovina: una data, una percentuale o una valuta
//! scritte a mano restano testo, perché `3/4/2026` non vuol dire la stessa
//! cosa in ogni paese.
//!
//! Le due direzioni sono una l'inversa dell'altra: per ogni valore `v`,
//! `parse(&input_of(v)) == v`.

use gridcraft_core::{CellError, Value};

/// Il testo più lungo di una cella: il limite di Excel.
pub const MAX_TEXT_CHARS: usize = 32_767;

/// Il valore costante che un input scrive in una cella.
#[derive(Clone, Debug, PartialEq)]
pub enum NewValue {
    /// La cella vuota.
    Blank,
    Number(f64),
    Text(String),
    Bool(bool),
    Error(CellError),
}

/// Perché un input non diventa un valore.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputError {
    /// L'input comincia con `=`: le formule non si scrivono.
    Formula,
    /// Il testo supera [`MAX_TEXT_CHARS`].
    TooLong,
}

/// Il valore che `input` scrive.
pub fn parse(input: &str) -> Result<NewValue, InputError> {
    if input.is_empty() {
        return Ok(NewValue::Blank);
    }
    if let Some(text) = input.strip_prefix('\'') {
        return text_value(text);
    }
    if input.starts_with('=') {
        return Err(InputError::Formula);
    }
    if input.eq_ignore_ascii_case("TRUE") {
        return Ok(NewValue::Bool(true));
    }
    if input.eq_ignore_ascii_case("FALSE") {
        return Ok(NewValue::Bool(false));
    }
    if let Some(error) = CellError::parse(input) {
        return Ok(NewValue::Error(error));
    }
    if let Some(number) = number(input) {
        return Ok(NewValue::Number(number));
    }
    text_value(input)
}

fn text_value(text: &str) -> Result<NewValue, InputError> {
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(InputError::TooLong);
    }
    Ok(NewValue::Text(text.to_string()))
}

/// Un numero nella forma `[+-]cifre[.cifre][e[+-]cifre]`, finito.
fn number(input: &str) -> Option<f64> {
    let bytes = input.as_bytes();
    let mut at = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        at += 1;
    }
    let int = digits(bytes, &mut at);
    let mut frac = 0;
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        frac = digits(bytes, &mut at);
    }
    if int == 0 && frac == 0 {
        return None;
    }
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        at += 1;
        if matches!(bytes.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        if digits(bytes, &mut at) == 0 {
            return None;
        }
    }
    if at != bytes.len() {
        return None;
    }
    let number: f64 = input.trim_start_matches('+').parse().ok()?;
    number
        .is_finite()
        .then_some(if number == 0.0 { 0.0 } else { number })
}

fn digits(bytes: &[u8], at: &mut usize) -> usize {
    let start = *at;
    while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
        *at += 1;
    }
    *at - start
}

/// L'input di un numero: la forma più corta che si rilegge uguale.
pub fn number_input(number: f64) -> String {
    if number == number.trunc() && number.abs() < 1e15 {
        return format!("{}", number as i64);
    }
    let text = format!("{number:?}");
    text.strip_suffix(".0").map(str::to_string).unwrap_or(text)
}

/// L'input di un valore costante, come la cella lo mostra a chi la modifica.
pub fn input_of(value: &NewValue) -> String {
    match value {
        NewValue::Blank => String::new(),
        NewValue::Number(number) => number_input(*number),
        NewValue::Bool(true) => "TRUE".to_string(),
        NewValue::Bool(false) => "FALSE".to_string(),
        NewValue::Error(error) => error.as_str().to_string(),
        NewValue::Text(text) => {
            // Un testo che si leggerebbe come altro tiene l'apostrofo.
            if parse(text) == Ok(NewValue::Text(text.clone())) {
                text.clone()
            } else {
                format!("'{text}")
            }
        }
    }
}

/// Il valore costante di un valore del modello, se ne ha uno.
pub fn constant(value: &Value) -> Option<NewValue> {
    Some(match value {
        Value::Empty => NewValue::Blank,
        Value::Number(number) => NewValue::Number(*number),
        Value::Text(text) => NewValue::Text(text.to_string()),
        Value::Bool(flag) => NewValue::Bool(*flag),
        Value::Error(error) => NewValue::Error(*error),
        Value::Array(_) => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l_input_si_legge_senza_indovinare() {
        assert_eq!(parse(""), Ok(NewValue::Blank));
        assert_eq!(parse("12"), Ok(NewValue::Number(12.0)));
        assert_eq!(parse("-0"), Ok(NewValue::Number(0.0)));
        assert_eq!(parse("+1.5e3"), Ok(NewValue::Number(1500.0)));
        assert_eq!(parse(".5"), Ok(NewValue::Number(0.5)));
        assert_eq!(parse("true"), Ok(NewValue::Bool(true)));
        assert_eq!(parse("#n/a"), Ok(NewValue::Error(CellError::NA)));
        assert_eq!(parse("=A1"), Err(InputError::Formula));
        assert_eq!(parse("'=A1"), Ok(NewValue::Text("=A1".into())));
        for text in [
            " 12", "12 ", "1,5", "3/4/2026", "10%", "inf", "NaN", "1e", ".", "1e999",
        ] {
            assert_eq!(parse(text), Ok(NewValue::Text(text.into())), "{text}");
        }
        assert_eq!(
            parse(&"x".repeat(MAX_TEXT_CHARS + 1)),
            Err(InputError::TooLong)
        );
    }

    #[test]
    fn ogni_valore_si_rilegge_dal_suo_input() {
        let values = [
            NewValue::Blank,
            NewValue::Number(0.1),
            NewValue::Number(1e16),
            NewValue::Number(-1.5e-7),
            NewValue::Number(123456789012345.0),
            NewValue::Number(f64::MAX),
            NewValue::Bool(false),
            NewValue::Error(CellError::Div0),
            NewValue::Text(String::new()),
            NewValue::Text("12".into()),
            NewValue::Text("'già".into()),
            NewValue::Text("=SUM(A1)".into()),
            NewValue::Text("TRUE".into()),
            NewValue::Text("#REF!".into()),
            NewValue::Text("testo".into()),
        ];
        for value in values {
            assert_eq!(parse(&input_of(&value)), Ok(value.clone()), "{value:?}");
        }
        assert_eq!(input_of(&NewValue::Text("12".into())), "'12");
        assert_eq!(input_of(&NewValue::Number(1e16)), "1e16");
    }
}
