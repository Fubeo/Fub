//! I valori OOXML in forma canonica, per l'inventario di [`crate::inventory`].
//!
//! Il codec può scrivere lo stesso valore in un'altra forma lessicale: `true`
//! al posto di `1`, `ff0000` al posto di `FF0000`, `12` al posto di `12.0`,
//! `72pt` al posto di `1in`. Per l'inventario sono lo stesso valore. La forma
//! canonica dipende soltanto dalla forma del valore, non dall'attributo che lo
//! porta, e si applica uguale ai due lati del confronto: una regola troppo
//! larga può nascondere un cambiamento fra due scritture equivalenti di un
//! tipo, non una perdita.
//!
//! I tipi, dalla parte 1 di ECMA-376:
//!
//! - `ST_OnOff`, soltanto negli spazi dei nomi di WordprocessingML: `true` e
//!   `on` sono `1`, `false` e `off` sono `0`;
//! - `ST_HexColorRGB`: sei cifre esadecimali, in maiuscolo;
//! - i numeri decimali: `12.0`, `+12` e `012` sono `12`, `-0` è `0`;
//! - `ST_UniversalMeasure` (`mm`, `cm`, `in`, `pt`, `pc`, `pi`): in punti;
//! - le percentuali (`50.0%`): il numero canonico con `%`.
//!
//! Un valore lungo si tiene per impronta: la chiave resta piccola.

use crate::inventory::sha256;

/// Oltre questa misura un valore entra nell'inventario come impronta.
const LONG: usize = 96;

/// Gli spazi dei nomi di WordprocessingML, dove `on` e `off` sono booleani.
fn wordprocessing(ns: &str) -> bool {
    ns == "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        || ns.starts_with("http://schemas.microsoft.com/office/word/")
}

/// Il valore canonico di un attributo, o del testo di un elemento, nello
/// spazio dei nomi `ns`.
pub(crate) fn value(ns: &str, raw: &str) -> String {
    let token = raw.trim();
    let canonical = if wordprocessing(ns) && matches!(token, "true" | "on") {
        Some("1".to_string())
    } else if wordprocessing(ns) && matches!(token, "false" | "off") {
        Some("0".to_string())
    } else if let Some(number) = number(token) {
        Some(number)
    } else if token.len() == 6 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(token.to_ascii_uppercase())
    } else if let Some(points) = measure(token) {
        Some(format!("{points}pt"))
    } else {
        token
            .strip_suffix('%')
            .and_then(number)
            .map(|number| format!("{number}%"))
    };
    let out = canonical.unwrap_or_else(|| raw.to_string());
    if out.len() > LONG {
        return format!("sha256:{}", sha256(out.as_bytes()));
    }
    out
}

/// Un numero decimale in forma canonica: senza segno `+`, senza zeri
/// superflui, intero quando lo è.
fn number(token: &str) -> Option<String> {
    let digits = token.strip_prefix(['+', '-']).unwrap_or(token);
    let (int, frac) = digits.split_once('.').unwrap_or((digits, ""));
    let valid = !(int.is_empty() && frac.is_empty())
        && int.bytes().all(|b| b.is_ascii_digit())
        && frac.bytes().all(|b| b.is_ascii_digit());
    if !valid {
        return None;
    }
    let parsed: f64 = token.parse().ok()?;
    format_number(parsed)
}

fn format_number(x: f64) -> Option<String> {
    if !x.is_finite() {
        return None;
    }
    // Lo zero negativo e l'errore di un calcolo in virgola mobile si
    // assorbono.
    let x = (x * 1e6).round() / 1e6;
    let x = if x == 0.0 { 0.0 } else { x };
    if x.fract() == 0.0 && x.abs() < 1e15 {
        return Some(format!("{}", x as i64));
    }
    Some(format!("{x}"))
}

/// Una misura universale in punti.
fn measure(token: &str) -> Option<String> {
    let units = [
        ("mm", 72.0 / 25.4),
        ("cm", 72.0 / 2.54),
        ("in", 72.0),
        ("pt", 1.0),
        ("pc", 12.0),
        ("pi", 12.0),
    ];
    units.iter().find_map(|(unit, factor)| {
        let n = token.strip_suffix(unit)?;
        number(n)?;
        format_number(n.parse::<f64>().ok()? * factor)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const W14: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
    const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

    #[test]
    fn i_booleani_di_wordprocessingml_hanno_una_forma() {
        for raw in ["1", "true", "on", " true "] {
            assert_eq!(value(W, raw), "1", "{raw}");
        }
        for raw in ["0", "false", "off"] {
            assert_eq!(value(W14, raw), "0", "{raw}");
        }
        // Fuori da WordprocessingML `on` è una stringa.
        assert_eq!(value(A, "on"), "on");
        assert_eq!(value("", "true"), "true");
    }

    #[test]
    fn i_colori_si_confrontano_senza_maiuscole() {
        assert_eq!(value(W, "ff00aa"), "FF00AA");
        assert_eq!(value(W, "FF00AA"), "FF00AA");
        assert_eq!(value(W, "auto"), "auto");
        // Otto cifre (un `rsid`, un `paraId`) restano come sono.
        assert_eq!(value(W, "00ab12cd"), "00ab12cd");
    }

    #[test]
    fn i_numeri_si_confrontano_per_valore() {
        assert_eq!(value(W, "12.0"), "12");
        assert_eq!(value(W, "+12"), "12");
        assert_eq!(value(W, "012"), "12");
        assert_eq!(value(W, "-0"), "0");
        assert_eq!(value(W, "1.50"), "1.5");
        assert_eq!(value(W, "-3.25"), "-3.25");
        assert_ne!(value(W, "12"), value(W, "13"));
        // Non sono numeri.
        assert_eq!(value(W, "1e3"), "1e3");
        assert_eq!(value(W, "."), ".");
        assert_eq!(value(W, "1.2.3"), "1.2.3");
        assert_eq!(value(W, "NaN"), "NaN");
    }

    #[test]
    fn le_misure_universali_sono_in_punti() {
        assert_eq!(value(W, "1in"), "72pt");
        assert_eq!(value(W, "72pt"), "72pt");
        assert_eq!(value(W, "2.54cm"), "72pt");
        assert_eq!(value(W, "25.4mm"), "72pt");
        assert_eq!(value(W, "6pc"), "72pt");
        assert_eq!(value(W, "6pi"), "72pt");
        assert_eq!(value(W, "1.5in"), "108pt");
        assert_eq!(value(W, "in"), "in");
    }

    #[test]
    fn le_percentuali_hanno_il_numero_canonico() {
        assert_eq!(value(W, "50.0%"), "50%");
        assert_eq!(value(W, "50%"), "50%");
        assert_eq!(value(W, "%"), "%");
    }

    #[test]
    fn un_valore_lungo_è_un_impronta_e_le_stringhe_restano() {
        let long = "x".repeat(200);
        let canonical = value(W, &long);
        assert!(canonical.starts_with("sha256:"));
        assert_ne!(canonical, value(W, &"y".repeat(200)));
        // Le stringhe non si toccano, spazi compresi.
        assert_eq!(value(W, " Titolo 1 "), " Titolo 1 ");
    }
}
