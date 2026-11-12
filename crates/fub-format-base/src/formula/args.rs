//! Gli attrezzi delle funzioni: tag e link, argomenti tipizzati, date e
//! durate, aggregati, appartenenza, fette e ordinamento.

use super::*;

/// I nomi dei tag di un valore: lista o testo con virgole, senza `#`.
pub(super) fn tag_names(value: &BaseValue) -> Vec<String> {
    let clean = |s: &str| s.trim().trim_start_matches('#').to_string();
    match value {
        BaseValue::List(items) => items.iter().map(|v| clean(&v.display())).collect(),
        BaseValue::Text(text) => text
            .split(',')
            .map(clean)
            .filter(|t| !t.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// Il bersaglio di un link, senza estensione `.md`, per confrontare `[[a]]`
/// con `a.md`.
pub(super) fn link_target(value: &BaseValue) -> String {
    let raw = match value {
        BaseValue::Link { target, .. } => target.clone(),
        BaseValue::File { path, .. } => path.clone(),
        other => other.display(),
    };
    raw.trim_start_matches("[[")
        .trim_end_matches("]]")
        .trim_end_matches(".md")
        .to_string()
}

pub(super) fn date_arg(value: &BaseValue, function: &str) -> Result<i64, EvalError> {
    match value {
        BaseValue::Date(ms) => Ok(*ms),
        other => Err(EvalError::Value(format!(
            "`{function}` vuole una data, trovato {}",
            other.type_name()
        ))),
    }
}

/// (anno, mese 1..12, giorno 1..31) di un giorno dall'epoca, calendario
/// gregoriano proletttico (algoritmo di Hinnant).
pub(super) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/// Formatta una data (UTC) coi segnaposto di Moment più usati: `YYYY YY MMMM
/// MMM MM M DD D dddd ddd HH H hh h mm m ss s A a`. Il testo fra `[ ]` resta
/// com'è; ogni altro carattere passa.
pub(super) fn format_date(ms: i64, pattern: &str) -> String {
    let days = ms.div_euclid(86_400_000);
    let secs = ms.rem_euclid(86_400_000) / 1000;
    let (year, month, day) = civil_from_days(days);
    let weekday = (days + 4).rem_euclid(7) as usize;
    let (hour, minute, second) = (secs / 3600, secs / 60 % 60, secs % 60);
    let hour12 = if hour % 12 == 0 { 12 } else { hour % 12 };
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(close) = chars[i + 1..].iter().position(|c| *c == ']') {
                out.extend(&chars[i + 1..i + 1 + close]);
                i += close + 2;
                continue;
            }
        }
        let run = chars[i..].iter().take_while(|c| **c == chars[i]).count();
        let token: String = chars[i..i + run].iter().collect();
        let piece = match token.as_str() {
            "YYYY" => Some(format!("{year:04}")),
            "YY" => Some(format!("{:02}", year.rem_euclid(100))),
            "MMMM" => Some(MONTHS[(month - 1) as usize].to_string()),
            "MMM" => Some(MONTHS[(month - 1) as usize][..3].to_string()),
            "MM" => Some(format!("{month:02}")),
            "M" => Some(month.to_string()),
            "DD" => Some(format!("{day:02}")),
            "D" => Some(day.to_string()),
            "dddd" => Some(WEEKDAYS[weekday].to_string()),
            "ddd" => Some(WEEKDAYS[weekday][..3].to_string()),
            "HH" => Some(format!("{hour:02}")),
            "H" => Some(hour.to_string()),
            "hh" => Some(format!("{hour12:02}")),
            "h" => Some(hour12.to_string()),
            "mm" => Some(format!("{minute:02}")),
            "m" => Some(minute.to_string()),
            "ss" => Some(format!("{second:02}")),
            "s" => Some(second.to_string()),
            "A" => Some(if hour < 12 { "AM" } else { "PM" }.to_string()),
            "a" => Some(if hour < 12 { "am" } else { "pm" }.to_string()),
            _ => None,
        };
        match piece {
            Some(p) => out.push_str(&p),
            None => out.push_str(&token),
        }
        i += run;
    }
    out
}

/// «3 days ago» / «in 2 hours», con la scala che userebbe Obsidian.
pub(super) fn relative_time(ms: i64, now_ms: i64) -> String {
    let delta = ms - now_ms;
    let secs = delta.abs() / 1000;
    let (count, unit) = match secs {
        0..=44 => return "just now".to_string(),
        45..=2_699 => ((secs + 30) / 60, "minute"),
        2_700..=75_599 => ((secs + 1800) / 3600, "hour"),
        75_600..=2_332_799 => ((secs + 43_200) / 86_400, "day"),
        2_332_800..=27_647_999 => ((secs + 1_296_000) / 2_592_000, "month"),
        _ => ((secs + 15_768_000) / 31_536_000, "year"),
    };
    let unit = if count == 1 {
        unit.to_string()
    } else {
        format!("{unit}s")
    };
    if delta < 0 {
        format!("{count} {unit} ago")
    } else {
        format!("in {count} {unit}")
    }
}

pub(super) fn string_arg(value: &BaseValue, _fn: &str) -> Result<String, EvalError> {
    match value {
        BaseValue::Text(s) => Ok(s.clone()),
        BaseValue::Empty => Ok(String::new()),
        BaseValue::Number(n) => Ok(BaseValue::Number(*n).display()),
        BaseValue::Bool(b) => Ok(b.to_string()),
        other => Err(EvalError::Value(format!(
            "testo atteso, trovato {}",
            other.type_name()
        ))),
    }
}

pub(super) fn number_arg(value: &BaseValue, _fn: &str) -> Result<f64, EvalError> {
    match value {
        BaseValue::Number(n) => Ok(*n),
        BaseValue::Bool(true) => Ok(1.0),
        BaseValue::Bool(false) => Ok(0.0),
        BaseValue::Text(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| EvalError::Value(format!("`{s}` non è un numero"))),
        other => Err(EvalError::Value(format!(
            "numero atteso, trovato {}",
            other.type_name()
        ))),
    }
}

pub(super) fn list_arg(value: &BaseValue, _fn: &str) -> Result<Vec<BaseValue>, EvalError> {
    match value {
        BaseValue::List(v) => Ok(v.clone()),
        BaseValue::Empty => Ok(Vec::new()),
        other => Err(EvalError::Value(format!(
            "lista attesa, trovata {}",
            other.type_name()
        ))),
    }
}

pub(super) fn aggregate_numbers(name: &str, args: Vec<BaseValue>) -> Result<BaseValue, EvalError> {
    let mut numbers = Vec::new();
    for arg in args {
        match arg {
            BaseValue::List(items) => {
                for item in items {
                    numbers.push(number_arg(&item, name)?);
                }
            }
            BaseValue::Empty => {}
            other => numbers.push(number_arg(&other, name)?),
        }
    }
    if numbers.is_empty() {
        return Ok(BaseValue::Empty);
    }
    match name {
        "min" => Ok(BaseValue::Number(
            numbers.into_iter().reduce(f64::min).unwrap_or(0.0),
        )),
        "max" => Ok(BaseValue::Number(
            numbers.into_iter().reduce(f64::max).unwrap_or(0.0),
        )),
        "sum" => Ok(BaseValue::Number(numbers.iter().sum())),
        "average" | "avg" => Ok(BaseValue::Number(
            numbers.iter().sum::<f64>() / numbers.len() as f64,
        )),
        _ => unreachable!(),
    }
}

pub(super) fn eval_contains(
    haystack: &BaseValue,
    needle: &BaseValue,
) -> Result<BaseValue, EvalError> {
    match (haystack, needle) {
        (BaseValue::Text(h), BaseValue::Text(n)) => Ok(BaseValue::Bool(h.contains(n.as_str()))),
        (BaseValue::List(items), needle) => Ok(BaseValue::Bool(items.contains(needle))),
        (BaseValue::Empty, _) => Ok(BaseValue::Bool(false)),
        (h, n) => Err(EvalError::Value(format!(
            "contains fra {} e {}",
            h.type_name(),
            n.type_name()
        ))),
    }
}

pub(super) fn eval_contains_all(
    haystack: &BaseValue,
    needles: &[BaseValue],
) -> Result<BaseValue, EvalError> {
    for needle in needles {
        if !truthy(&eval_contains(haystack, needle)?) {
            return Ok(BaseValue::Bool(false));
        }
    }
    Ok(BaseValue::Bool(true))
}

pub(super) fn eval_contains_any(
    haystack: &BaseValue,
    needles: &[BaseValue],
) -> Result<BaseValue, EvalError> {
    for needle in needles {
        if truthy(&eval_contains(haystack, needle)?) {
            return Ok(BaseValue::Bool(true));
        }
    }
    Ok(BaseValue::Bool(false))
}

pub(super) fn eval_slice(args: &[BaseValue]) -> Result<BaseValue, EvalError> {
    if args.len() < 2 || args.len() > 3 {
        return Err(EvalError::Value("slice vuole start[, end]".to_string()));
    }
    let start = match &args[1] {
        BaseValue::Number(n) => *n as i64,
        other => {
            return Err(EvalError::Value(format!(
                "slice start su {}",
                other.type_name()
            )))
        }
    };
    let end = if args.len() > 2 {
        match &args[2] {
            BaseValue::Number(n) => Some(*n as i64),
            other => {
                return Err(EvalError::Value(format!(
                    "slice end su {}",
                    other.type_name()
                )))
            }
        }
    } else {
        None
    };
    let normalize = |index: i64, len: i64| -> usize {
        if index < 0 {
            len.saturating_add(index).max(0) as usize
        } else {
            (index as usize).min(len as usize)
        }
    };
    match &args[0] {
        BaseValue::Text(s) => {
            let chars: Vec<char> = s.chars().collect();
            let len = chars.len() as i64;
            let from = normalize(start, len);
            let to = end.map(|e| normalize(e, len)).unwrap_or(len as usize);
            let (from, to) = (from.min(to), to.max(from));
            Ok(BaseValue::Text(
                chars[from..to.min(chars.len())].iter().collect(),
            ))
        }
        BaseValue::List(items) => {
            let len = items.len() as i64;
            let from = normalize(start, len);
            let to = end.map(|e| normalize(e, len)).unwrap_or(len as usize);
            let (from, to) = (from.min(to), to.max(from));
            Ok(BaseValue::List(items[from..to.min(items.len())].to_vec()))
        }
        other => Err(EvalError::Value(format!("slice su {}", other.type_name()))),
    }
}

pub(super) fn sort_key(value: &BaseValue) -> String {
    match value {
        BaseValue::Number(n) => format!("n:{n:020.6}"),
        BaseValue::Text(s) => format!("t:{s}"),
        BaseValue::Bool(b) => format!("b:{b}"),
        BaseValue::Date(ms) => format!("d:{ms:020}"),
        BaseValue::Duration(ms) => format!("u:{ms:020}"),
        _ => format!("x:{}", value.display()),
    }
}

/// `YYYY-MM-DD[ HH:mm[:ss]]` -> epoch-ms UTC. Solo ISO rigido.
pub(super) fn parse_iso_date_ms(text: &str) -> Option<i64> {
    let (date, time) = match text.split_once(['T', 't', ' ']) {
        Some((d, t)) => (d, Some(t)),
        None => (text, None),
    };
    let mut parts = date.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (hour, minute, second) = match time {
        None => (0, 0, 0),
        Some(t) => {
            let t = t.trim_end_matches(['Z', 'z']);
            // Fuso `+HH:mm` supportato solo come scarto ore/minuti.
            let (t, offset_min): (&str, i64) = match t.rfind(['+', '-']) {
                Some(at) if at > 0 => {
                    let (head, zone) = t.split_at(at);
                    let sign = if zone.starts_with('-') { -1 } else { 1 };
                    let (h, m) = match zone[1..].split_once(':') {
                        Some((h, m)) => (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?),
                        None => (zone[1..].parse::<i64>().ok()?, 0),
                    };
                    (head, sign * (h * 60 + m))
                }
                _ => (t, 0),
            };
            let mut tp = t.split(':');
            let h: i64 = tp.next()?.parse().ok()?;
            let m: i64 = tp.next().map(str::parse).transpose().ok()?.unwrap_or(0);
            let s: i64 = tp
                .next()
                .map(|v| v.split('.').next().unwrap_or("0").parse())
                .transpose()
                .ok()?
                .unwrap_or(0);
            if tp.next().is_some() || h > 23 || m > 59 || s > 60 {
                return None;
            }
            (
                h * 3_600_000 + m * 60_000 + s * 1_000 - offset_min * 60_000,
                0,
                0,
            )
        }
    };
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400_000 + hour + minute + second)
}

pub(super) fn parse_duration_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // Millisecondi nudi.
    if let Ok(ms) = text.parse::<i64>() {
        return Some(ms);
    }
    let (amount, unit) = split_amount_unit(text)?;
    let amount: i64 = amount.parse().ok()?;
    let per = match unit {
        "ms" | "millisecond" | "milliseconds" => 1,
        "s" | "sec" | "secs" | "second" | "seconds" => 1_000,
        "m" | "min" | "mins" | "minute" | "minutes" => 60_000,
        "h" | "hour" | "hours" => 3_600_000,
        "d" | "day" | "days" => 86_400_000,
        "w" | "week" | "weeks" => 604_800_000,
        _ => return None,
    };
    amount.checked_mul(per)
}

fn split_amount_unit(text: &str) -> Option<(&str, &str)> {
    let split = text
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(text.len());
    let (amount, unit) = text.split_at(split);
    if amount.trim().is_empty() || unit.trim().is_empty() {
        return None;
    }
    Some((amount.trim(), unit.trim()))
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (month + 9).rem_euclid(12);
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

pub(super) fn start_of_day_ms(now_ms: i64) -> i64 {
    now_ms.div_euclid(86_400_000) * 86_400_000
}
