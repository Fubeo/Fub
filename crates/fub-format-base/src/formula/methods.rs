//! Le operazioni con tetto sul testo, i metodi di testo, liste, date e
//! durate, e le conversioni di valore.

use super::*;

/// `replace` con tetto PRIMA dell'allocazione: stima conservativa
/// `haystack + occorrenze × replacement`.
pub(super) fn budgeted_replace(
    haystack: &str,
    needle: &str,
    replacement: &str,
) -> Result<BaseValue, EvalError> {
    if needle.is_empty() {
        return Err(EvalError::Value("replace con pattern vuoto".to_string()));
    }
    let occurrences = haystack.matches(needle).count().min(1_000_000);
    let estimate = haystack
        .len()
        .saturating_add(occurrences.saturating_mul(replacement.len()));
    if estimate > MAX_TEXT_BYTES {
        return Err(EvalError::Value("stringa oltre il limite".to_string()));
    }
    Ok(BaseValue::Text(haystack.replace(needle, replacement)))
}

/// `split` con tetto sul numero di pezzi PRIMA di collezionarli.
pub(super) fn budgeted_split(haystack: &str, needle: &str) -> Result<BaseValue, EvalError> {
    if needle.is_empty() {
        return Err(EvalError::Value("split con pattern vuoto".to_string()));
    }
    if haystack.matches(needle).count() + 1 > MAX_TEXT_LIST_ITEMS {
        return Err(EvalError::Value("lista oltre il limite".to_string()));
    }
    Ok(BaseValue::List(
        haystack
            .split(needle)
            .map(|s| BaseValue::Text(s.to_string()))
            .collect(),
    ))
}

/// `join` con tetto PRIMA dell'allocazione del risultato.
pub(super) fn budgeted_join(items: &[BaseValue], sep: &str) -> Result<BaseValue, EvalError> {
    let mut total = sep.len().saturating_mul(items.len().saturating_sub(1));
    for item in items {
        // Stima sui byte del display senza materializzarlo due volte.
        total = total.saturating_add(display_bytes(item));
        if total > MAX_TEXT_BYTES {
            return Err(EvalError::Value("stringa oltre il limite".to_string()));
        }
    }
    Ok(BaseValue::Text(
        items
            .iter()
            .map(BaseValue::display)
            .collect::<Vec<_>>()
            .join(sep),
    ))
}

/// Byte del display senza allocare la stringa intera per la stima.
fn display_bytes(value: &BaseValue) -> usize {
    match value {
        BaseValue::Empty => 0,
        BaseValue::Text(s) => s.len(),
        BaseValue::Number(n) => BaseValue::Number(*n).display().len(),
        BaseValue::Bool(_) => 5,
        BaseValue::Date(_) | BaseValue::Duration(_) => 20,
        BaseValue::List(items) => items
            .iter()
            .map(display_bytes)
            .fold(0, usize::saturating_add)
            .saturating_add(items.len().saturating_mul(2)),
        BaseValue::Object(map) => map.iter().fold(0, |acc, (k, v)| {
            acc.saturating_add(k.len()).saturating_add(display_bytes(v))
        }),
        BaseValue::File { path, label } => path
            .len()
            .saturating_add(label.as_ref().map_or(0, String::len)),
        BaseValue::Link { target, label } => target
            .len()
            .saturating_add(label.as_ref().map_or(0, String::len)),
        BaseValue::Error(_) => 7,
    }
}

pub(super) fn eval_text_method(
    text: &str,
    method: &str,
    rest: &[BaseValue],
) -> Result<BaseValue, EvalError> {
    let base = BaseValue::Text(text.to_string());
    match method {
        "lower" | "upper" | "trim" | "reverse" | "length" | "len" | "isEmpty" | "is_empty" => {
            if !rest.is_empty() {
                return Err(EvalError::Value(format!("troppi argomenti per .{method}")));
            }
            call_known(method, vec![base], &RowContext::default())
        }
        _ => Err(EvalError::Name(format!(
            "metodo stringa sconosciuto .{method}"
        ))),
    }
}

pub(super) fn eval_list_method(
    items: &[BaseValue],
    method: &str,
    rest: &[BaseValue],
) -> Result<BaseValue, EvalError> {
    let base = BaseValue::List(items.to_vec());
    match method {
        "length" | "len" | "reverse" | "unique" | "uniq" | "sort" | "flat" | "first" | "last"
        | "join" | "isEmpty" | "is_empty" => {
            let mut args = vec![base];
            args.extend(rest.iter().cloned());
            // Arity oltre il limite = errore valore (mai panico).
            match function_arity(method) {
                Some((min, max)) if args.len() >= min && args.len() <= max => {
                    call_known(method, args, &RowContext::default())
                }
                _ => Err(EvalError::Value(format!("argomenti errati per .{method}"))),
            }
        }
        _ => Err(EvalError::Name(format!(
            "metodo lista sconosciuto .{method}"
        ))),
    }
}

pub(super) fn eval_date_field(ms: i64, field: &str) -> Result<BaseValue, EvalError> {
    // Giorno civile su epoch-ms (UTC): sufficiente per ordinare/raggruppare.
    let days = ms.div_euclid(86_400_000);
    match field {
        "epoch" | "value" => Ok(BaseValue::Number(ms as f64)),
        "day" | "date" => Ok(BaseValue::Date(days * 86_400_000)),
        "isEmpty" | "is_empty" => Ok(BaseValue::Bool(false)),
        _ => Err(EvalError::Name(format!("campo data sconosciuto .{field}"))),
    }
}

pub(super) fn eval_duration_field(ms: i64, field: &str) -> Result<BaseValue, EvalError> {
    match field {
        "millis" | "value" => Ok(BaseValue::Number(ms as f64)),
        "days" => Ok(BaseValue::Number(ms as f64 / 86_400_000.0)),
        "hours" => Ok(BaseValue::Number(ms as f64 / 3_600_000.0)),
        _ => Err(EvalError::Name(format!(
            "campo durata sconosciuto .{field}"
        ))),
    }
}

pub(super) fn to_number(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Number(n) => Ok(BaseValue::Number(*n)),
        BaseValue::Bool(true) => Ok(BaseValue::Number(1.0)),
        BaseValue::Bool(false) => Ok(BaseValue::Number(0.0)),
        BaseValue::Empty => Ok(BaseValue::Empty),
        BaseValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .map(BaseValue::Number)
            .map_err(|_| EvalError::Value(format!("`{s}` non è un numero"))),
        BaseValue::Date(ms) => Ok(BaseValue::Number(*ms as f64)),
        BaseValue::Duration(ms) => Ok(BaseValue::Number(*ms as f64)),
        other => Err(EvalError::Value(format!(
            "number() su {}",
            other.type_name()
        ))),
    }
}

pub(super) fn parse_date_value(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Date(ms) => Ok(BaseValue::Date(*ms)),
        BaseValue::Text(s) => parse_iso_date_ms(s.trim())
            .map(BaseValue::Date)
            .ok_or_else(|| EvalError::Value(format!("`{s}` non è una data ISO"))),
        BaseValue::Empty => Ok(BaseValue::Empty),
        other => Err(EvalError::Value(format!("date() su {}", other.type_name()))),
    }
}

pub(super) fn parse_duration_value(value: &BaseValue) -> Result<BaseValue, EvalError> {
    match value {
        BaseValue::Duration(ms) => Ok(BaseValue::Duration(*ms)),
        BaseValue::Number(n) => Ok(BaseValue::Duration(*n as i64)),
        BaseValue::Text(s) => parse_duration_ms(s.trim())
            .map(BaseValue::Duration)
            .ok_or_else(|| EvalError::Value(format!("`{s}` non è una durata"))),
        BaseValue::Empty => Ok(BaseValue::Empty),
        other => Err(EvalError::Value(format!(
            "duration() su {}",
            other.type_name()
        ))),
    }
}
