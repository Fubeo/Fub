//! Toolkit di scansione testo condiviso dai provider testuali.
//!
//! Né comrak né pulldown trattano `#tag` o la semantica interna di
//! `[[wikilink]]` in stile Obsidian: questi helper coprono quel divario e sono
//! riusabili da qualsiasi `FormatProvider` basato su testo.

use fubmd_abi::model::{LinkTarget, Span, Tag};

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

/// Risultato del parsing dell'interno di un wikilink.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedWikilink {
    pub target: LinkTarget,
    /// Alias di visualizzazione dopo `|`, se presente.
    pub alias: Option<String>,
}

/// Parsa l'interno di un wikilink, cioè il contenuto tra `[[` e `]]`.
///
/// Gestisce `Page#Heading^blockid|Alias` e imposta `embed` in base al prefisso
/// `!` che il chiamante rileva sulla sintassi esterna.
///
/// Esempi: `Nota`, `Nota#Sezione`, `Nota^blocco`, `Nota#Sez|testo`, `#SoloHeading`.
pub fn parse_wikilink_inner(inner: &str, embed: bool) -> ParsedWikilink {
    // Alias dopo la prima '|'.
    let (link_part, alias) = match inner.split_once('|') {
        Some((l, a)) => (l, Some(a.trim().to_string())),
        None => (inner, None),
    };

    // Riferimento a blocco `^id` (solo se dopo un eventuale heading).
    let (link_part, block) = match link_part.split_once('^') {
        Some((l, b)) => (l, Some(b.trim().to_string())),
        None => (link_part, None),
    };

    // Heading dopo '#'.
    let (page, heading) = match link_part.split_once('#') {
        Some((p, h)) => (p.trim().to_string(), Some(h.trim().to_string())),
        None => (link_part.trim().to_string(), None),
    };

    ParsedWikilink {
        target: LinkTarget::Wiki {
            page,
            heading,
            block,
            embed,
        },
        alias,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(text: &str) -> Vec<String> {
        extract_tags(text).into_iter().map(|t| t.name).collect()
    }

    #[test]
    fn extracts_simple_and_nested_tags() {
        assert_eq!(names("ciao #progetto e #area/lavoro"), vec!["progetto", "area/lavoro"]);
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

    #[test]
    fn wikilink_page_only() {
        let p = parse_wikilink_inner("Nota", false);
        assert_eq!(p.target, LinkTarget::wiki("Nota"));
        assert_eq!(p.alias, None);
    }

    #[test]
    fn wikilink_heading_block_alias() {
        let p = parse_wikilink_inner("Nota#Sezione^blk|Testo", false);
        assert_eq!(
            p.target,
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: Some("Sezione".into()),
                block: Some("blk".into()),
                embed: false,
            }
        );
        assert_eq!(p.alias.as_deref(), Some("Testo"));
    }

    #[test]
    fn wikilink_embed_flag() {
        let p = parse_wikilink_inner("Immagine.png", true);
        match p.target {
            LinkTarget::Wiki { embed, .. } => assert!(embed),
            _ => panic!("atteso wiki"),
        }
    }
}
