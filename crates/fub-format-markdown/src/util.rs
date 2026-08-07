//! Utility: escape HTML e la misura dei delimitatori ripetuti.

// Lo slug degli heading NON sta più qui: è `fub_abi::model::heading_slug`.
// Era una funzione privata di questo provider, e la regola che genera un
// indirizzo (`[[Nota#Titolo]]`) deve valere per chiunque lo risolva — due
// provider con due slugify diversi danno due id allo stesso titolo.

/// Escape per contenuto testuale HTML.
pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape per valore di attributo HTML (fra virgolette doppie).
pub fn escape_attr(s: &str) -> String {
    escape_html(s)
}

/// La fila più lunga di `c` dentro `s`.
///
/// La chiedono i due posti che devono **recintare** del testo che potrebbe
/// contenere il recinto: `serialize`, per un code block e per il codice inline,
/// e `transfer`, per il frontmatter di una nota che finisce dentro un documento
/// unico. Sta qui e non in uno dei due perché il secondo non deve avere ragione
/// di nominare il primo: `serialize_non_riscrive.rs` conta chi nomina
/// `serialize` dal codice di produzione, e aveva ragione a fermarsi — prendere
/// una funzione da lì per riusarla è il primo centimetro della strada che quel
/// presidio esiste per chiudere.
pub fn fila_massima(s: &str, c: char) -> usize {
    let mut max = 0;
    let mut corrente = 0;
    for ch in s.chars() {
        if ch == c {
            corrente += 1;
            max = max.max(corrente);
        } else {
            corrente = 0;
        }
    }
    max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_fila_si_misura_anche_quando_e_zero() {
        assert_eq!(fila_massima("", '`'), 0);
        assert_eq!(fila_massima("a`b``c```d", '`'), 3);
        assert_eq!(fila_massima("```", '`'), 3);
    }

    #[test]
    fn escape_basic() {
        assert_eq!(escape_html("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&#39;");
    }
}
