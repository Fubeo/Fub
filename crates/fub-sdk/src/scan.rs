//! Toolkit di scansione testo condiviso dai provider testuali.
//!
//! Né comrak né pulldown trattano `#tag` o la semantica interna di
//! `[[wikilink]]` in stile Obsidian: questi helper coprono quel divario e sono
//! riusabili da qualsiasi `FormatProvider` basato su testo.

use fub_abi::model::{Span, Tag};

/// Estrae i `#tag` da un frammento di **testo semplice** (il chiamante deve già
/// aver escluso code span, code block e frontmatter).
///
/// Regole in stile Obsidian: un tag è `#` seguito da lettere/cifre/`_`/`-`/`/`,
/// deve contenere almeno un carattere non numerico, e il `#` non deve seguire
/// un carattere alfanumerico (per non catturare `foo#bar`). Gli offset degli
/// `Span` sono relativi all'inizio di `text`.
pub fn extract_tags(text: &str) -> Vec<Tag> {
    let bytes = text.as_bytes();
    let mut tags = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'#' {
            i += 1;
            continue;
        }
        // Il '#' non deve seguire un carattere alfanumerico.
        if i > 0 {
            let prev = prev_char(text, i);
            if prev.map(|c| c.is_alphanumeric()).unwrap_or(false) {
                i += 1;
                continue;
            }
        }
        // Consuma i caratteri del nome del tag.
        let name_start = i + 1;
        let mut j = name_start;
        while j < text.len() {
            let c = text[j..].chars().next().unwrap();
            if is_tag_char(c) {
                j += c.len_utf8();
            } else {
                break;
            }
        }
        let name = &text[name_start..j];
        if !name.is_empty() && !name.chars().all(|c| c.is_ascii_digit()) {
            tags.push(Tag {
                name: name.to_string(),
                span: Span::new(i, j),
            });
        }
        i = j.max(i + 1);
    }
    tags
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn prev_char(text: &str, byte_idx: usize) -> Option<char> {
    text[..byte_idx].chars().next_back()
}

/// Il parsing dell'interno di un wikilink **vive nel contratto**
/// ([`fub_abi::model::parse_wikilink_inner`]) ed è ri-esportato qui perché è
/// da qui che i provider testuali lo prendono: la grammatica di
/// `Page#Heading^block|Alias` descrive i campi di `LinkTarget::Wiki`, quindi è
/// una regola di ciò che il contratto dichiara — come `canonical_tag` — e non
/// del toolkit di chi lo usa. Averla qui significava che una proprietà del
/// frontmatter non poteva riconoscere una relazione senza dipendere dall'SDK.
pub use fub_abi::model::{parse_wikilink_inner, ParsedWikilink};

#[cfg(test)]
mod tests {
    use super::*;

    fn names(text: &str) -> Vec<String> {
        extract_tags(text).into_iter().map(|t| t.name).collect()
    }

    #[test]
    fn extracts_simple_and_nested_tags() {
        assert_eq!(
            names("ciao #progetto e #area/lavoro"),
            vec!["progetto", "area/lavoro"]
        );
    }

    #[test]
    fn ignores_numeric_and_mid_word_hash() {
        assert_eq!(names("issue #123 e colore #fff ok"), vec!["fff"]);
        assert_eq!(names("a#b non e' un tag"), Vec::<String>::new());
    }

    #[test]
    fn tag_span_includes_hash() {
        let tags = extract_tags("x #foo");
        assert_eq!(tags[0].span, Span::new(2, 6));
    }

    // I test del parsing dei wikilink stanno col parsing, cioè nel contratto
    // (`fub_abi::model`): qui resta ciò che l'SDK possiede davvero, la
    // scansione dei tag.
}
