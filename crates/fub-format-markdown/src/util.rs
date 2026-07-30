//! Utility: slug per gli heading e escape HTML.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_basic() {
        assert_eq!(escape_html("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&#39;");
    }
}
