//! Utility: slug per gli heading e escape HTML.

/// Slug in stile Obsidian: minuscolo, spazi → `-`, via la punteggiatura.
pub fn slugify(text: &str) -> String {
    let mut slug = String::with_capacity(text.len());
    let mut last_dash = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
            last_dash = false;
        } else if (c.is_whitespace() || c == '-' || c == '_')
            && !last_dash && !slug.is_empty() {
                slug.push('-');
                last_dash = true;
            }
        // ogni altra punteggiatura viene ignorata
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

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
    fn slugify_basic() {
        assert_eq!(slugify("Ciao Mondo!"), "ciao-mondo");
        assert_eq!(slugify("Sezione   con  spazi"), "sezione-con-spazi");
        assert_eq!(slugify("A/B & C"), "ab-c");
    }

    #[test]
    fn escape_basic() {
        assert_eq!(escape_html("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&#39;");
    }
}
