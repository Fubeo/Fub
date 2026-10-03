//! Gli escape della scrittura canonica (§7, punto 5), sopra l'unica tabella
//! del repo.
//!
//! Le entità vengono da [`fub_abi::html::escape`], la tabella di cui il repo
//! tiene una copia sola: qui si sceglie soltanto *quali* caratteri escapare,
//! perché una scena ne escapa meno di quanti ne escapi HTML. Nel testo bastano
//! `&`, `<` e `>`; in un attributo anche `"` e, se è lui a delimitare il
//! valore, l'apice. Le entità numeriche di tabulazione e a capo non sono nella
//! tabella perché HTML non ne ha bisogno: è il parser XML che normalizza in
//! spazi quei caratteri dentro un attributo.

use fub_abi::html;

/// Il testo di `tspan`, `title` e `desc`: solo `&`, `<` e `>`.
pub(crate) fn text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' | '<' | '>' => push_entity(&mut out, c),
            c => out.push(c),
        }
    }
    out
}

/// Il valore di un attributo delimitato da `quote`: `&`, `<`, `>` e `"`,
/// l'apice fra apici singoli, e tabulazioni e a capo con la loro entità
/// numerica, che altrimenti il parser trasformerebbe in spazi.
pub(crate) fn attribute(value: &str, quote: char) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' | '<' | '>' | '"' => push_entity(&mut out, c),
            '\'' if quote == '\'' => push_entity(&mut out, c),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
    out
}

/// L'entità di `c` presa dalla tabella del repo.
fn push_entity(out: &mut String, c: char) {
    out.push_str(&html::escape(c.encode_utf8(&mut [0; 4])));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_escapes_only_what_opens_markup() {
        assert_eq!(text("a < b & c > d"), "a &lt; b &amp; c &gt; d");
        assert_eq!(text("l'acqua \"blu\""), "l'acqua \"blu\"");
    }

    #[test]
    fn an_attribute_is_escaped_for_its_quotes() {
        assert_eq!(
            attribute("a&b<c>\"d'e\tf\ng\rh", '"'),
            "a&amp;b&lt;c&gt;&quot;d'e&#9;f&#10;g&#13;h"
        );
        assert_eq!(attribute("l'acqua", '\''), "l&#39;acqua");
    }
}
