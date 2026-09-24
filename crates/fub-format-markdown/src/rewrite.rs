//! Riscrittura chirurgica dei riferimenti Markdown.
//!
//! Il kernel decide quale identità deve essere raggiunta; questo modulo possiede
//! la sintassi persistita. Ogni richiesta viene ricontrollata contro il parse
//! della sorgente corrente e produce una patch dentro lo span osservato, senza
//! riserializzare il documento.

use fub_abi::format::{LinkRewrite, ParseContext};
use fub_abi::model::{parse_wikilink_inner, LinkTarget, Span};
use fub_abi::{FormatError, TextEdit};

use crate::parse::parse_markdown;

pub(crate) fn rewrite_links(
    source: &str,
    ctx: &ParseContext,
    rewrites: &[LinkRewrite],
) -> Result<Vec<TextEdit>, FormatError> {
    let model = parse_markdown(source, ctx)?;
    let mut edits = Vec::with_capacity(rewrites.len());

    for rewrite in rewrites {
        let observed = model
            .links
            .iter()
            .any(|link| link.span == rewrite.span && link.target == rewrite.target);
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
    if parse_wikilink_inner(inner).target != rewrite.target {
        return Err(FormatError::Parse(
            "wikilink target changed under rewrite".to_string(),
        ));
    }

    let page_end = inner
        .char_indices()
        .find_map(|(at, ch)| matches!(ch, '#' | '^' | '|').then_some(at))
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

fn rewrite_inline_path(source: &str, rewrite: &LinkRewrite) -> Result<TextEdit, FormatError> {
    let whole = source_slice(source, rewrite.span)?;
    let destination = inline_destination(whole).ok_or_else(|| {
        FormatError::Parse(
            "path-link rewrite span is not an inline Markdown destination".to_string(),
        )
    })?;
    Ok(TextEdit::replace(
        Span::new(
            rewrite.span.start + destination.start,
            rewrite.span.start + destination.end,
        ),
        rewrite.replacement.clone(),
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
