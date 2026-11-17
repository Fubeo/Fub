//! Scrivere come JavaScript: l'escape delle stringhe di `JSON.stringify`, i
//! numeri di `Number.prototype.toString` e l'ordine delle chiavi di un
//! oggetto JavaScript (regole R6 e R10 di `docs/reference/canvas-format.md`).
//!
//! Il TypeScript della tela scrive il sorgente con `JSON.stringify`: perché i
//! due lati producano gli stessi byte, il nucleo imita le sue tre scelte.
//!
//! - **Numeri** ([`js_number`]): le cifre più corte che si rileggono uguali,
//!   e nel pareggio esatto fra due candidati la cifra pari (ECMA-262,
//!   `Number::toString`); la forma esponenziale da `1e21` in su e sotto
//!   `1e-6`; `-0` si scrive `0`. Ogni numero di un [`Value`] passa da `f64`,
//!   come farebbe JavaScript dopo averlo letto: un intero oltre 2^53 si
//!   arrotonda come `as f64`.
//! - **Stringhe** ([`js_string`]): l'escape solo per `"`, `\` e i controlli
//!   sotto U+0020; `/`, i caratteri non ASCII, U+2028 e U+2029 restano come
//!   sono.
//! - **Chiavi** ([`js_entries`]): prima quelle che sembrano indici di array
//!   (da `"0"` a `"4294967294"`, senza zeri in testa) in ordine crescente,
//!   poi le altre nell'ordine di inserimento. `__proto__` è una chiave come
//!   le altre.
//!
//! Nessuna funzione va in panico: sono tutte totali.

use std::fmt::Write as _;

use serde_json::{Map, Number, Value};

/// Il più grande indice di array di JavaScript: 2^32 − 2.
const MAX_ARRAY_INDEX: u64 = 4_294_967_294;

/// La strada lenta dei test: con 1100 decimali dopo la prima cifra
/// l'espansione di un `f64` finito è esatta (al più 767 cifre significative).
#[cfg(test)]
const EXACT_DIGITS: usize = 1100;

/// Scrive `x` come `Number.prototype.toString` (ECMA-262 `Number::toString`
/// in base 10).
///
/// `NaN` dà `"NaN"`, `+∞` `"Infinity"`, `−∞` `"-Infinity"`, come
/// `String(x)` in JavaScript. Un [`Value`] di `serde_json` non contiene mai
/// questi valori, quindi [`encode`] non li incontra; chi chiama `js_number`
/// direttamente per scrivere JSON deve escluderli prima (`JSON.stringify` li
/// scriverebbe `null`).
pub fn js_number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if x == 0.0 {
        // Anche `-0`: `(-0).toString()` è `"0"`.
        return "0".to_owned();
    }
    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    let (digits, exponent) = shortest_digits(x.abs());
    write_number(&mut out, &digits, exponent);
    out
}

/// Le cifre significative più corte di `x` (finito, positivo) e l'esponente
/// della prima cifra: `x ≈ 0.d₁d₂…dₖ × 10^(exponent + 1)`.
///
/// `{:e}` di Rust dà già le cifre più corte che si rileggono uguali e, fra
/// queste, le più vicine; nel pareggio esatto però non sceglie la cifra pari
/// come vuole ECMA-262. Il pareggio si riconosce sull'espansione esatta e si
/// risolve qui; [`tie_precision`] dice, senza espandere, quando non può
/// esserci.
fn shortest_digits(x: f64) -> (Vec<u8>, i32) {
    shortest_digits_with(x, Expansion::WhenNeeded)
}

/// Quando si calcola l'espansione esatta. `Always` è la strada lenta di
/// riferimento, che i test confrontano con quella veloce.
#[derive(Clone, Copy)]
enum Expansion {
    WhenNeeded,
    #[cfg(test)]
    Always,
}

fn shortest_digits_with(x: f64, expansion: Expansion) -> (Vec<u8>, i32) {
    let (digits, exponent) = split_scientific(&format!("{x:e}"));
    // L'ultima cifra tenuta vale 10^unit; il pareggio c'è quando la parte
    // esatta sotto quella cifra è proprio mezza unità: 5 seguito da zeri.
    let unit = i64::from(exponent) - digits.len() as i64 + 1;
    let precision = match expansion {
        Expansion::WhenNeeded => match tie_precision(x, exponent, unit) {
            Some(precision) => precision,
            None => return (digits, exponent),
        },
        #[cfg(test)]
        Expansion::Always => EXACT_DIGITS,
    };
    let (exact, exact_exponent) = split_scientific(&format!("{x:.precision$e}"));
    let half = i64::from(exact_exponent) - (unit - 1);
    let Ok(half) = usize::try_from(half) else {
        return (digits, exponent);
    };
    let is_tie = exact.get(half) == Some(&5) && exact[half + 1..].iter().all(|&d| d == 0);
    if !is_tie {
        return (digits, exponent);
    }
    if digits.last().is_some_and(|&d| d % 2 == 0) {
        return (digits, exponent);
    }
    // I due candidati alla stessa scala: l'espansione troncata all'unità
    // (`floor`) e quella più uno (`ceil`). Vince quello con l'ultima cifra
    // pari, se si rilegge uguale.
    let floor = exact[..half].to_vec();
    let ceil = increment(&floor);
    let ceil_exponent = exact_exponent + i32::from(ceil.len() > floor.len());
    for (candidate, candidate_exponent) in [(floor, exact_exponent), (ceil, ceil_exponent)] {
        let even = candidate.last().is_some_and(|&d| d % 2 == 0);
        if even && reads_back(&candidate, candidate_exponent, x) {
            return (trimmed(candidate), candidate_exponent);
        }
    }
    (digits, exponent)
}

/// Le cifre dopo la prima che bastano per l'espansione esatta di `x`
/// (finito, positivo), o `None` se un pareggio all'unità 10^unit è
/// impossibile e l'espansione non serve.
///
/// Si scompone `x = M · 2^E` con `M` dispari (i subnormali partono da
/// `E = −1074`). Un pareggio vuole che la parte esatta sotto l'unità sia
/// `5 · 10^(unit − 1)`, quindi che 2 divida `x` esattamente `unit − 1` volte,
/// cioè `E = unit − 1`:
/// - `E < 0`: `x = M · 5^(−E) / 10^(−E)` con `M · 5^(−E)` dispari, quindi
///   l'esatto finisce a 10^E con una cifra dispari; il pareggio vuole che
///   finisca con il 5 a 10^(unit − 1).
/// - `E ≥ 0`: `x` è un intero e `x ≡ 5 · 10^(unit − 1) (mod 10^unit)` vuole
///   che 2 divida `x` proprio `unit − 1` volte.
///
/// Se `E = unit − 1` bastano le cifre fino a 10^min(E, 0): `exponent − E`
/// (o `exponent` per un intero) dopo la prima, perché la prima cifra esatta
/// non sta mai sopra 10^exponent. Il caso è raro: la gran parte dei numeri
/// non si espande.
fn tie_precision(x: f64, exponent: i32, unit: i64) -> Option<usize> {
    let bits = x.to_bits();
    let biased = i64::try_from((bits >> 52) & 0x7ff).unwrap_or(0);
    let fraction = bits & ((1_u64 << 52) - 1);
    let (mantissa, binary_exponent) = if biased == 0 {
        (fraction, -1074_i64)
    } else {
        (fraction | (1_u64 << 52), biased - 1075)
    };
    if mantissa == 0 {
        return None;
    }
    let binary_exponent = binary_exponent + i64::from(mantissa.trailing_zeros());
    if unit - 1 != binary_exponent {
        return None;
    }
    usize::try_from(i64::from(exponent) - binary_exponent.min(0)).ok()
}

/// `digits × 10^(exponent − len + 1)` si rilegge come `x`?
fn reads_back(digits: &[u8], exponent: i32, x: f64) -> bool {
    let mut text = String::with_capacity(digits.len() + 8);
    for &d in digits {
        text.push(char::from(b'0' + d));
    }
    let _ = write!(text, "e{}", i64::from(exponent) - digits.len() as i64 + 1);
    text.parse::<f64>() == Ok(x)
}

/// Le cifre (0–9) e l'esponente di una stringa `d.ddde±n` di `{:e}`.
fn split_scientific(text: &str) -> (Vec<u8>, i32) {
    let (mantissa, exponent) = text.split_once('e').unwrap_or((text, "0"));
    let digits: Vec<u8> = mantissa
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|b| b - b'0')
        .collect();
    (trimmed(digits), exponent.parse().unwrap_or(0))
}

/// Toglie gli zeri in coda (resta almeno una cifra).
fn trimmed(mut digits: Vec<u8>) -> Vec<u8> {
    while digits.len() > 1 && digits.last() == Some(&0) {
        digits.pop();
    }
    digits
}

/// `digits + 1` all'ultima cifra, con lo stesso numero di cifre o una in più
/// in testa (`99` → `100`).
fn increment(digits: &[u8]) -> Vec<u8> {
    let mut out = digits.to_vec();
    for d in out.iter_mut().rev() {
        if *d == 9 {
            *d = 0;
        } else {
            *d += 1;
            return out;
        }
    }
    out.insert(0, 1);
    out
}

/// ECMA-262 `Number::toString`, passi 6–12: `digits` sono le k cifre di s,
/// `exponent + 1` è n.
fn write_number(out: &mut String, digits: &[u8], exponent: i32) {
    let k = digits.len() as i64;
    let n = i64::from(exponent) + 1;
    let push_digits = |out: &mut String, slice: &[u8]| {
        for &d in slice {
            out.push(char::from(b'0' + d));
        }
    };
    if k <= n && n <= 21 {
        push_digits(out, digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        let split = n as usize;
        push_digits(out, &digits[..split]);
        out.push('.');
        push_digits(out, &digits[split..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        push_digits(out, digits);
    } else {
        let (first, rest) = digits.split_first().unwrap_or((&0, &[]));
        push_digits(out, std::slice::from_ref(first));
        if !rest.is_empty() {
            out.push('.');
            push_digits(out, rest);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
}

/// Scrive un numero di `serde_json` come lo riscriverebbe JavaScript dopo
/// averlo letto: passa sempre da `f64` (un intero oltre 2^53 si arrotonda
/// come `as f64`).
pub fn js_json_number(number: &Number) -> String {
    match number.as_f64() {
        Some(x) => js_number(x),
        // Solo con `arbitrary_precision`, che il nucleo non usa: si rilegge
        // il testo come farebbe `JSON.parse`.
        None => match number.to_string().parse::<f64>() {
            Ok(x) if x.is_finite() => js_number(x),
            _ => "null".to_owned(),
        },
    }
}

/// Scrive `text` come stringa JSON tra virgolette, con gli escape di
/// `JSON.stringify`.
pub fn js_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    push_string(&mut out, text);
    out
}

fn push_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// La chiave è un indice di array per JavaScript? Le stringhe canoniche
/// degli interi da 0 a 2^32 − 2: `"0"` sì, `"01"`, `"-0"` e `"4294967295"`
/// no.
pub fn is_array_index(key: &str) -> bool {
    let bytes = key.as_bytes();
    if bytes.is_empty() || bytes.len() > 10 || !bytes.iter().all(u8::is_ascii_digit) {
        return false;
    }
    if bytes.len() > 1 && bytes[0] == b'0' {
        return false;
    }
    key.parse::<u64>().is_ok_and(|n| n <= MAX_ARRAY_INDEX)
}

/// Le voci di un oggetto nell'ordine in cui JavaScript le enumera: prima le
/// chiavi che sembrano indici, in ordine crescente, poi le altre
/// nell'ordine della mappa (con `preserve_order`, quello di inserimento).
pub fn js_entries(map: &Map<String, Value>) -> Vec<(&str, &Value)> {
    let mut indices: Vec<(u64, &str, &Value)> = Vec::new();
    let mut others: Vec<(&str, &Value)> = Vec::with_capacity(map.len());
    for (key, value) in map {
        match key.parse::<u64>() {
            Ok(n) if is_array_index(key) => indices.push((n, key, value)),
            _ => others.push((key, value)),
        }
    }
    indices.sort_by_key(|&(n, _, _)| n);
    indices
        .into_iter()
        .map(|(_, key, value)| (key, value))
        .chain(others)
        .collect()
}

/// `JSON.stringify(value)`: compatto, nessuno spazio.
pub fn encode(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None, 0);
    out
}

/// `JSON.stringify(value, null, 2)`: rientro di due spazi; un array o un
/// oggetto vuoto resta `[]` o `{}`. Nessun `"\n"` finale: lo aggiunge chi
/// scrive il file.
pub fn encode_pretty(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, Some("  "), 0);
    out
}

fn write_value(out: &mut String, value: &Value, indent: Option<&str>, depth: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => out.push_str(&js_json_number(number)),
        Value::String(text) => push_string(out, text),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (key, item)) in js_entries(map).into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                push_string(out, key);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push('}');
        }
    }
}

fn newline(out: &mut String, indent: Option<&str>, depth: usize) {
    if let Some(indent) = indent {
        out.push('\n');
        for _ in 0..depth {
            out.push_str(indent);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{shortest_digits_with, Expansion};

    /// xorshift64: un generatore deterministico scritto a mano, così il test
    /// non dipende da un crate e ogni giro vede gli stessi numeri.
    struct XorShift(u64);

    impl XorShift {
        fn next(&mut self) -> u64 {
            let mut s = self.0;
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            self.0 = s;
            s
        }
    }

    /// Confronta le due strade su `x` se è finito e positivo; dice se l'ha
    /// contato.
    fn same_digits(x: f64) -> usize {
        if !(x.is_finite() && x > 0.0) {
            return 0;
        }
        assert_eq!(
            shortest_digits_with(x, Expansion::WhenNeeded),
            shortest_digits_with(x, Expansion::Always),
            "{x:e} ({:#018x})",
            x.to_bits()
        );
        1
    }

    // Quattro test e non uno, così girano in parallelo: in tutto più di
    // 200 000 numeri, ognuno anche con l'espansione intera (la strada lenta).

    #[test]
    fn fast_path_matches_on_integers() {
        let mut rng = XorShift(0x9e37_79b9_7f4a_7c15);
        let mut count = 0;
        // Interi piccoli e grandi, fino oltre 2^53.
        for i in 1..=25_500_u64 {
            count += same_digits(i as f64);
            count += same_digits((rng.next() >> (rng.next() % 64)) as f64);
        }
        for x in [9_007_199_254_740_991.0, 9_007_199_254_740_992.0, f64::MAX] {
            count += same_digits(x);
        }
        assert!(count >= 50_000, "{count}");
    }

    #[test]
    fn fast_path_matches_on_small_decimals() {
        let mut rng = XorShift(0x2545_f491_4f6c_dd1d);
        let mut count = 0;
        // Centesimi, millesimi, ottavi, binari, terzi.
        for _ in 0..50_000 {
            let n = (rng.next() % 10_000_000) as f64 + 1.0;
            let d = [10.0, 100.0, 1000.0, 8.0, 16.0, 1024.0, 3.0][(rng.next() % 7) as usize];
            count += same_digits(n / d);
        }
        assert!(count >= 50_000, "{count}");
    }

    #[test]
    fn fast_path_matches_on_the_whole_bit_space() {
        let mut rng = XorShift(0xd1b5_4a32_d192_ed03);
        let mut count = 0;
        // Normali, subnormali, enormi: i bit a caso, senza segno.
        for _ in 0..52_000 {
            count += same_digits(f64::from_bits(rng.next() & !(1_u64 << 63)));
        }
        for x in [5e-324, f64::MIN_POSITIVE] {
            count += same_digits(x);
        }
        assert!(count >= 50_000, "{count}");
    }

    #[test]
    fn fast_path_matches_on_ties() {
        let mut rng = XorShift(0x8cb9_2ba7_2f3d_8dd7);
        let mut count = 0;
        // (k + ½) · 2^e ha l'ultima cifra binaria a 2^(e−1): le cifre più
        // corte cadono spesso a metà fra due candidati.
        for _ in 0..50_000 {
            let k = (rng.next() % (1 << 20)) as f64 + 0.5;
            let e = (rng.next() % 140) as i32 - 70;
            count += same_digits(k * 2_f64.powi(e));
        }
        // I pareggi noti (vedi `tests/js_encoder.rs`).
        for x in [
            0.7534866333007812,
            17.767898559570312,
            196181128186770.12,
            12.569839477539062,
            0.5,
            1.5,
            2.5,
        ] {
            count += same_digits(x);
        }
        assert!(count >= 50_000, "{count}");
    }
}
