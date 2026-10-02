//! Riscrittura chirurgica dei riferimenti Markdown.
//!
//! Il kernel decide quale identità deve essere raggiunta; questo modulo possiede
//! la sintassi persistita. Ogni richiesta viene ricontrollata contro il parse
//! della sorgente corrente e produce una patch dentro lo span osservato, senza
//! riserializzare il documento.

use fub_abi::format::{LinkRewrite, ParseContext};
use fub_abi::model::{parse_wikilink_inner, LinkTarget, Span};
use fub_abi::{FormatError, TextEdit};

use crate::destination::{angled_dest, dest_text};
use crate::parse::parse_markdown;

pub(crate) fn rewrite_links(
    source: &str,
    ctx: &ParseContext,
    rewrites: &[LinkRewrite],
) -> Result<Vec<TextEdit>, FormatError> {
    let model = parse_markdown(source, ctx)?;
    // I link per span, per cercarli invece di scorrerli: una rinomina che
    // riscrive centomila link di una nota lunga li scorreva centomila volte.
    let mut observed_links: Vec<_> = model.links.iter().collect();
    observed_links.sort_by_key(|link| (link.span.start, link.span.end));
    let mut edits = Vec::with_capacity(rewrites.len());

    for rewrite in rewrites {
        let key = (rewrite.span.start, rewrite.span.end);
        let first = observed_links.partition_point(|link| (link.span.start, link.span.end) < key);
        let observed = observed_links[first..]
            .iter()
            .take_while(|link| link.span == rewrite.span)
            .any(|link| link.target == rewrite.target);
        if !observed {
            return Err(FormatError::Parse(format!(
                "markdown link changed under rewrite at {}..{}",
                rewrite.span.start, rewrite.span.end
            )));
        }
        edits.push(match &rewrite.target {
            LinkTarget::Wiki { .. } => rewrite_wikilink(source, rewrite)?,
            LinkTarget::Path(_) => rewrite_inline_path(source, rewrite)?,
            LinkTarget::Url(_) => {
                return Err(FormatError::Parse(
                    "a remote URL is not rewritten by a vault rename".to_string(),
                ));
            }
        });
    }

    edits.sort_by_key(|edit| (edit.span.start, edit.span.end));
    for pair in edits.windows(2) {
        if pair[1].span.start < pair[0].span.end {
            return Err(FormatError::Parse(
                "markdown link rewrites overlap; refusing a partial rename".to_string(),
            ));
        }
    }
    Ok(edits)
}

fn rewrite_wikilink(source: &str, rewrite: &LinkRewrite) -> Result<TextEdit, FormatError> {
    let whole = source_slice(source, rewrite.span)?;
    let inner_start = if whole.starts_with("![[") {
        3
    } else if whole.starts_with("[[") {
        2
    } else {
        return Err(FormatError::Parse(
            "wikilink rewrite span does not start on a wikilink".to_string(),
        ));
    };
    let Some(inner_end) = whole.len().checked_sub(2) else {
        return Err(FormatError::Parse(
            "truncated wikilink rewrite span".to_string(),
        ));
    };
    if inner_end < inner_start || !whole.ends_with("]]") {
        return Err(FormatError::Parse(
            "wikilink rewrite span does not end on a wikilink".to_string(),
        ));
    }
    let inner = &whole[inner_start..inner_end];
    let (read, written_at) = unescaped(inner);
    if parse_wikilink_inner(&read).target != rewrite.target {
        return Err(FormatError::Parse(
            "wikilink target changed under rewrite".to_string(),
        ));
    }

    let page_end = read
        .char_indices()
        .find_map(|(at, ch)| matches!(ch, '#' | '^' | '|').then_some(written_at[at]))
        .unwrap_or(inner.len());
    let raw_page = &inner[..page_end];
    let left = raw_page.len() - raw_page.trim_start().len();
    let right = raw_page.trim_end().len();
    if left == right {
        return Err(FormatError::Parse(
            "a heading-only wikilink does not name the renamed document".to_string(),
        ));
    }
    if rewrite
        .replacement
        .chars()
        .any(|ch| matches!(ch, ']' | '|' | '#' | '^' | '\n' | '\r'))
    {
        return Err(FormatError::Parse(
            "renamed page cannot be represented losslessly as a wikilink".to_string(),
        ));
    }

    Ok(TextEdit::replace(
        Span::new(
            rewrite.span.start + inner_start + left,
            rewrite.span.start + inner_start + right,
        ),
        rewrite.replacement.clone(),
    ))
}

/// L'interno di un wikilink come lo legge il parser, con le barre degli escape
/// sciolte, e per ogni byte letto il byte scritto da cui comincia il suo
/// carattere: la barra, per un carattere escapato.
///
/// comrak scioglie gli escape del bersaglio (`clean_url`), e in una cella toglie
/// prima la barra di ogni `\|`: in entrambi i casi `[[Nota\|alias]]` punta a
/// `Nota`, e il `|` separa l'alias. Letto sui byte scritti, quel bersaglio era
/// `Nota\` e la rinomina lo rifiutava come cambiato.
fn unescaped(inner: &str) -> (String, Vec<usize>) {
    let mut read = String::with_capacity(inner.len());
    let mut written_at = Vec::with_capacity(inner.len());
    let mut chars = inner.char_indices().peekable();
    while let Some((at, ch)) = chars.next() {
        let ch = match chars.peek() {
            Some(&(_, next)) if ch == '\\' && next.is_ascii_punctuation() => {
                chars.next();
                next
            }
            _ => ch,
        };
        read.push(ch);
        written_at.resize(read.len(), at);
    }
    (read, written_at)
}

/// Il `replacement` di un path è la destinazione **decodificata** che il link
/// deve avere, non testo da incollare: `Nuova Nota.md` scritto nudo in
/// `[titolo](…)` non è più un link, e la nota perderebbe l'arco del grafo.
/// La destinazione si riscrive nella forma che rileggendola torna la stessa
/// ([`dest_text`], [`angled_dest`]): fra parentesi angolari resta fra
/// angolari, una nuda resta nuda finché può.
fn rewrite_inline_path(source: &str, rewrite: &LinkRewrite) -> Result<TextEdit, FormatError> {
    let whole = source_slice(source, rewrite.span)?;
    let destination = inline_destination(whole).ok_or_else(|| {
        FormatError::Parse(
            "path-link rewrite span is not an inline Markdown destination".to_string(),
        )
    })?;
    let replacement = &rewrite.replacement;
    if replacement.is_empty() || replacement.contains(['\n', '\r']) {
        return Err(FormatError::Parse(
            "renamed path cannot be represented losslessly as a Markdown destination".to_string(),
        ));
    }
    let angled = destination.start > 0 && whole.as_bytes()[destination.start - 1] == b'<';
    let written = if angled {
        angled_dest(replacement)
    } else {
        dest_text(replacement)
    };
    Ok(TextEdit::replace(
        Span::new(
            rewrite.span.start + destination.start,
            rewrite.span.start + destination.end,
        ),
        written,
    ))
}

fn source_slice(source: &str, span: Span) -> Result<&str, FormatError> {
    source.get(span.start..span.end).ok_or_else(|| {
        FormatError::Parse(format!(
            "markdown rewrite span {}..{} is outside the source or splits UTF-8",
            span.start, span.end
        ))
    })
}

/// Restituisce il contenuto della destinazione di `[label](dest "title")` o
/// `![alt](<dest>)`, escludendo parentesi e parentesi angolari.
fn inline_destination(link: &str) -> Option<std::ops::Range<usize>> {
    let bytes = link.as_bytes();
    let label_start = match bytes {
        [b'!', b'[', ..] => 2,
        [b'[', ..] => 1,
        _ => return None,
    };

    let mut escaped = false;
    let mut nested = 0usize;
    let mut opener = None;
    for at in label_start..bytes.len() {
        let byte = bytes[at];
        if escaped {
            escaped = false;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            continue;
        }
        match byte {
            b'[' => nested += 1,
            b']' if nested > 0 => nested -= 1,
            b']' if bytes.get(at + 1) == Some(&b'(') => {
                opener = Some(at + 2);
                break;
            }
            _ => {}
        }
    }
    let mut at = opener?;
    while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    if bytes.get(at) == Some(&b'<') {
        let start = at + 1;
        at = start;
        escaped = false;
        while at < bytes.len() {
            let byte = bytes[at];
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'>' {
                return (at > start).then_some(start..at);
            }
            at += 1;
        }
        return None;
    }

    let start = at;
    let mut parens = 0usize;
    escaped = false;
    while at < bytes.len() {
        let byte = bytes[at];
        if escaped {
            escaped = false;
            at += 1;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            at += 1;
            continue;
        }
        match byte {
            b'(' => parens += 1,
            b')' if parens > 0 => parens -= 1,
            b')' => break,
            byte if byte.is_ascii_whitespace() && parens == 0 => break,
            _ => {}
        }
        at += 1;
    }
    (at > start).then_some(start..at)
}

#[cfg(test)]
mod tests {
    use fub_abi::edit::{EditRequest, Revision};
    use fub_abi::model::LinkTarget;

    use super::*;

    fn rewritten(source: &str, replacement: &str) -> String {
        let ctx = ParseContext::obsidian("note.md");
        let model = parse_markdown(source, &ctx).expect("parse");
        let link = model.links.first().expect("link");
        let edits = rewrite_links(
            source,
            &ctx,
            &[LinkRewrite {
                span: link.span,
                target: link.target.clone(),
                replacement: replacement.to_string(),
            }],
        )
        .expect("rewrite");
        EditRequest::new(Revision::of(source), edits)
            .apply_to(source)
            .expect("apply")
            .0
    }

    #[test]
    fn wikilink_changes_only_page_and_preserves_embed_heading_and_alias() {
        assert_eq!(
            rewritten("prima ![[Old#Heading|label]] dopo", "New"),
            "prima ![[New#Heading|label]] dopo"
        );
    }

    /// Il bersaglio si legge come lo legge il parser, con gli escape sciolti:
    /// `[[Old\|alias]]` è la forma di un alias in una cella, e nel resto del
    /// testo `\|` e `\#` separano come `|` e `#`. La barra resta dov'era.
    #[test]
    fn an_escaped_separator_stays_a_separator() {
        for (source, expected) in [
            (
                "| a |\n|---|\n| [[Old\\|alias]] |\n",
                "| a |\n|---|\n| [[New\\|alias]] |\n",
            ),
            (
                "| a |\n|---|\n| [[Old#H\\|alias]] |\n",
                "| a |\n|---|\n| [[New#H\\|alias]] |\n",
            ),
            (
                "| a |\n|---|\n| x\\|y [[Old]] |\n",
                "| a |\n|---|\n| x\\|y [[New]] |\n",
            ),
            (
                "| a |\n|---|\n| x\\|y [l](Old) |\n",
                "| a |\n|---|\n| x\\|y [l](New) |\n",
            ),
            ("[[Old\\|alias]] fuori", "[[New\\|alias]] fuori"),
            ("[[Old\\#H]]", "[[New\\#H]]"),
            ("[[Old\\\\|alias]]", "[[New|alias]]"),
            ("[[Dir\\Old|alias]]", "[[New|alias]]"),
            ("[[Città#H]]", "[[New#H]]"),
        ] {
            assert_eq!(rewritten(source, "New"), expected, "{source:?}");
        }
    }

    #[test]
    fn inline_path_preserves_label_title_and_delimiters() {
        assert_eq!(
            rewritten("[label](old.md \"title\")", "dir/new%20name.md"),
            "[label](dir/new%20name.md \"title\")"
        );
        assert_eq!(
            rewritten("![alt](<old file.md>)", "new%20file.md"),
            "![alt](<new%20file.md>)"
        );
    }

    fn reparsed_target(source: &str) -> Option<LinkTarget> {
        let ctx = ParseContext::obsidian("note.md");
        let model = parse_markdown(source, &ctx).expect("parse");
        model.links.first().map(|link| link.target.clone())
    }

    #[test]
    fn renamed_path_stays_a_link_that_reaches_the_new_name() {
        // Il caso della segnalazione: una destinazione nuda con uno spazio
        // non è più un link.
        assert_eq!(
            rewritten("[titolo](vecchia.md)", "Nuova Nota.md"),
            "[titolo](<Nuova Nota.md>)"
        );
        let names = [
            "Nuova Nota.md",
            "cartella/Nuova Nota.md#Sezione con spazi",
            "città vecchia.md",
            "a(b.md",
            "a)b.md",
            "a(b)c.md",
            "x<y>.md",
            "barra\\rovescia.md",
            "R&D.md",
            "a&amp;b.md",
            "a&#38;b.md",
            "a&#x26;b.md",
            "tab\tqui.md",
            "Nuova%20Nota.md",
        ];
        let sources = [
            "[titolo](vecchia.md)",
            "[titolo](vecchia.md \"titolo\")",
            "[titolo](<vecchia file.md>)",
            "![alt](vecchia.md)",
        ];
        for name in names {
            for source in sources {
                let out = rewritten(source, name);
                assert_eq!(
                    reparsed_target(&out),
                    Some(LinkTarget::Path(name.to_string())),
                    "{source:?} rinominato in {name:?} è diventato {out:?}"
                );
            }
        }
    }

    #[test]
    fn a_destination_that_markdown_cannot_hold_is_refused() {
        let ctx = ParseContext::obsidian("note.md");
        let source = "[titolo](vecchia.md)";
        let model = parse_markdown(source, &ctx).expect("parse");
        let link = model.links.first().expect("link");
        for replacement in ["a\nb.md", "a\r\nb.md", ""] {
            let err = rewrite_links(
                source,
                &ctx,
                &[LinkRewrite {
                    span: link.span,
                    target: link.target.clone(),
                    replacement: replacement.to_string(),
                }],
            )
            .expect_err("a line ending has no form in a destination");
            assert!(matches!(err, FormatError::Parse(_)));
        }
    }

    #[test]
    fn request_must_name_the_link_observed_at_that_span() {
        let ctx = ParseContext::obsidian("note.md");
        let err = rewrite_links(
            "[[Old]]",
            &ctx,
            &[LinkRewrite {
                span: Span::new(0, 7),
                target: LinkTarget::wiki("Other"),
                replacement: "New".to_string(),
            }],
        )
        .expect_err("stale target");
        assert!(matches!(err, FormatError::Parse(_)));
    }
}
