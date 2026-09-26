//! Le scritture mirate che il provider possiede: come si scrive un riferimento
//! e quale simbolo segna un task.
//!
//! Le feature sanno dove scrivere e cosa ottenere; la sintassi sta qui, come
//! per la riscrittura dei link al rename. Ogni risposta si ricontrolla contro
//! la grammatica che il parser legge, così una feature non può scrivere un
//! testo che alla rilettura porta altrove.

use fub_abi::format::{LinkInsert, ParseContext};
use fub_abi::model::{parse_wikilink_inner, Block, TaskMarker};
use fub_abi::options::syntax;
use fub_abi::{FormatError, TextEdit};

use crate::parse::parse_markdown;

/// Un wikilink (`[[…]]`), o un embed (`![[…]]`) quando il riferimento
/// incorpora. Un URL e un path si scrivono con un'altra sintassi che nessuna
/// feature chiede oggi: la risposta è `None`, non un wikilink approssimato.
pub(crate) fn format_link(
    ctx: &ParseContext,
    link: &LinkInsert,
) -> Result<Option<String>, FormatError> {
    if !ctx.options.enabled(syntax::WIKILINKS)
        || (link.embed && !ctx.options.enabled(syntax::EMBEDS))
    {
        return Ok(None);
    }
    let Some(inside) = link.target.wiki_inner() else {
        return Ok(None);
    };
    let label = link.label.as_deref().filter(|label| *label != inside);
    let inner = match label {
        Some(label) => format!("{inside}|{label}"),
        None => inside.clone(),
    };
    // Le parentesi chiuderebbero il link prima del tempo, e un a capo lo
    // spezzerebbe; il resto lo dice il giro di andata e ritorno.
    let read_back = parse_wikilink_inner(&inner);
    if inner.contains(['[', ']', '\n', '\r'])
        || read_back.target != link.target
        || read_back.alias.as_deref() != label
    {
        return Err(FormatError::Serialize(format!(
            "«{inner}» non si scrive in un wikilink senza cambiare destinazione"
        )));
    }
    let bang = if link.embed { "!" } else { "" };
    Ok(Some(format!("{bang}[[{inner}]]")))
}

/// Il simbolo fra le parentesi: `x` per fatto, lo spazio per da fare.
///
/// Il marcatore deve essere uno di quelli che il parse della sorgente attuale
/// produce: uno span preso da un'altra versione del file è un errore, non una
/// `x` scritta in mezzo a una parola.
pub(crate) fn set_task_state(
    source: &str,
    marker: &TaskMarker,
    done: bool,
) -> Result<Vec<TextEdit>, FormatError> {
    let model = parse_markdown(source, &ParseContext::obsidian(""))?;
    let mut markers = Vec::new();
    collect_tasks(&model.body, &mut markers);
    if !markers.iter().any(|found| found.span == marker.span) {
        return Err(FormatError::Parse(format!(
            "nessun task ha il marcatore in {}..{}",
            marker.span.start, marker.span.end
        )));
    }
    let symbol = if done { "x" } else { " " };
    Ok(vec![TextEdit::replace(marker.span, symbol)])
}

fn collect_tasks(blocks: &[Block], out: &mut Vec<TaskMarker>) {
    for block in blocks {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    out.extend(item.task);
                    collect_tasks(&item.blocks, out);
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                collect_tasks(blocks, out);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{LinkTarget, Span};

    fn link(target: LinkTarget, label: Option<&str>, embed: bool) -> LinkInsert {
        LinkInsert {
            target,
            label: label.map(str::to_string),
            embed,
        }
    }

    fn written(insert: &LinkInsert) -> Option<String> {
        format_link(&ParseContext::obsidian("a.md"), insert).expect("scrivibile")
    }

    #[test]
    fn a_link_is_written_as_the_parser_reads_it() {
        assert_eq!(
            written(&link(LinkTarget::wiki("Kant"), None, false)).as_deref(),
            Some("[[Kant]]")
        );
        assert_eq!(
            written(&link(LinkTarget::wiki("Kant"), Some("il filosofo"), false)).as_deref(),
            Some("[[Kant|il filosofo]]")
        );
        assert_eq!(
            written(&link(LinkTarget::wiki("Kant"), Some("Kant"), true)).as_deref(),
            Some("![[Kant]]"),
            "un'etichetta uguale alla destinazione non è un alias"
        );
        let heading = LinkTarget::Wiki {
            page: "Kant".into(),
            heading: Some("Critica".into()),
            block: None,
        };
        assert_eq!(
            written(&link(heading, None, false)).as_deref(),
            Some("[[Kant#Critica]]")
        );
    }

    #[test]
    fn what_the_grammar_cannot_say_is_refused() {
        for page in ["a|b", "a]]b", "a[b", "riga\nnuova"] {
            let refused = format_link(
                &ParseContext::obsidian("a.md"),
                &link(LinkTarget::wiki(page), None, false),
            );
            assert!(refused.is_err(), "{page:?} non si scrive: {refused:?}");
        }
        let alias = format_link(
            &ParseContext::obsidian("a.md"),
            &link(LinkTarget::wiki("Kant"), Some("a]]b"), false),
        );
        assert!(alias.is_err(), "{alias:?}");
    }

    #[test]
    fn without_wikilinks_there_is_no_link_to_write() {
        let mut ctx = ParseContext::obsidian("a.md");
        ctx.options.remove(syntax::WIKILINKS);
        assert_eq!(
            format_link(&ctx, &link(LinkTarget::wiki("Kant"), None, false)).expect("risposta"),
            None
        );
        assert_eq!(
            written(&link(LinkTarget::Path("a.png".into()), None, true)),
            None,
            "un path si scrive con un'altra sintassi"
        );
    }

    #[test]
    fn a_task_changes_only_its_symbol() {
        let source = "- [ ] uno\n- [x] due\n";
        let open = TaskMarker {
            symbol: None,
            span: Span::new(3, 4),
        };
        assert_eq!(
            set_task_state(source, &open, true).expect("spunta"),
            vec![TextEdit::replace(Span::new(3, 4), "x")]
        );
        let closed = TaskMarker {
            symbol: Some('x'),
            span: Span::new(13, 14),
        };
        assert_eq!(
            set_task_state(source, &closed, false).expect("toglie"),
            vec![TextEdit::replace(Span::new(13, 14), " ")]
        );
    }

    #[test]
    fn a_marker_from_another_source_is_refused() {
        let stale = TaskMarker {
            symbol: None,
            span: Span::new(1, 2),
        };
        assert!(set_task_state("- [ ] uno\n", &stale, true).is_err());
    }
}
