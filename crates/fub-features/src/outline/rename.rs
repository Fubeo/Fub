//! `heading.rename`: un titolo rinominato, e con lui i link che lo nominano.
//!
//! Si riscrivono soltanto i byte del testo: nel titolo, quelli fra i `#` e
//! un'eventuale ancora `^id`; nei link, la parte dopo `#` di un
//! `[[Nota#Titolo]]` (o `[[#Titolo]]` nella nota stessa). Un link si tocca
//! solo se oggi porta a **questo** titolo (il primo che corrisponde, come
//! risolve il kernel) e se col nome nuovo smetterebbe di portarci: un link
//! scritto con l'id esplicito del titolo resta com'è.
//!
//! Il comando rifiuta invece di indovinare:
//! - un titolo con formattazione (`## **Forte**`): il testo letto dal modello
//!   non è quello scritto, e riscriverlo perderebbe i segni;
//! - un nome che un titolo precedente già porta, perché i link andrebbero a
//!   quello;
//! - una rinomina che cambierebbe lo slug di un omonimo (`titolo-1`), perché
//!   i link a quell'omonimo cambierebbero bersaglio senza essere riscritti.
//!
//! I link Markdown con frammento (`[x](Nota.md#titolo)`) restano com'erano: il
//! loro frammento è uno slug di un'altra grammatica.
//!
//! Come `tag.rename`, le revisioni si fissano prima di scrivere, l'anteprima
//! mostra il piano e un documento cambiato nel frattempo fallisce il suo CAS.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{
    canonical_anchor, heading_matches, parse_wikilink_inner, DocId, Heading, HeadingSlugs, Link,
    LinkTarget, Span,
};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{CommandProvider, HostApi, IndexQuery, IndexResult};

/// Rinomina un titolo di una nota e aggiorna i link che lo nominano.
pub const HEADING_RENAME: &str = "heading.rename";

const DOC: &str = "doc";
const HEADING: &str = "heading";
const NEW_HEADING: &str = "new_heading";
pub(super) const P_RENAME: &str = "heading.p_rename";
pub(super) const U_RENAME: &str = "heading.u_rename";
pub(super) const E_NO_DOC: &str = "heading.e_no_doc";
pub(super) const E_MISSING: &str = "heading.e_missing";
pub(super) const E_INVALID: &str = "heading.e_invalid";
pub(super) const E_SAME: &str = "heading.e_same";
pub(super) const E_FORMATTED: &str = "heading.e_formatted";
pub(super) const E_TAKEN: &str = "heading.e_taken";
pub(super) const E_SLUGS: &str = "heading.e_slugs";

/// I comandi della struttura.
pub struct OutlineCommands;

impl CommandProvider for OutlineCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(HEADING_RENAME, Text::key(format!("{HEADING_RENAME}.title")))
                .describing(Text::key(format!("{HEADING_RENAME}.desc")))
                .with_param(parameter(DOC, ParamKind::Document))
                .with_param(parameter(HEADING, ParamKind::Text).required())
                .with_param(parameter(NEW_HEADING, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            HEADING_RENAME => rename_heading(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(
        name,
        Text::key(format!("{HEADING_RENAME}.{name}.title")),
        kind,
    )
    .describing(Text::key(format!("{HEADING_RENAME}.{name}.desc")))
}

/// Il nome nuovo, se un wikilink lo può portare dopo `#`.
fn new_name(raw: &str) -> Option<&str> {
    let name = raw.trim();
    let forbidden = |c: char| matches!(c, '[' | ']' | '|' | '#' | '^') || c.is_control();
    (!name.is_empty() && !name.contains(forbidden)).then_some(name)
}

/// I byte del testo di un titolo, dentro il suo span: quelli che si
/// riscrivono. `None` se il testo scritto non è quello del modello.
fn heading_text_span(source: &str, heading: &Heading) -> Option<Span> {
    let block = source.get(heading.span.start..heading.span.end)?;
    let line_end = block.find(['\n', '\r']).unwrap_or(block.len());
    let line = &block[..line_end];
    let indent = line.len() - line.trim_start_matches(' ').len();
    let mut start = indent;
    let mut end = line.len();
    let rest = &line[indent..];
    if rest.starts_with('#') {
        // ATX: i `#` d'apertura, e una sequenza di chiusura preceduta da uno spazio.
        let hashes = rest.len() - rest.trim_start_matches('#').len();
        start += hashes;
        let body = line[start..end].trim_end();
        let without = body.trim_end_matches('#');
        end = start
            + if without.len() < body.len()
                && (without.is_empty() || without.ends_with([' ', '\t']))
            {
                without.len()
            } else {
                body.len()
            };
    }
    let mut text = &line[start..end];
    if let Some(anchor) = &heading.explicit_anchor {
        let marker = format!("^{anchor}");
        if let Some(before) = text.trim_end().strip_suffix(marker.as_str()) {
            text = before;
        }
    }
    let lead = text.len() - text.trim_start().len();
    let trimmed = text.trim();
    (trimmed == heading.text).then(|| {
        let at = heading.span.start + start + lead;
        Span::new(at, at + trimmed.len())
    })
}

/// Gli slug che l'outline avrebbe con `texts` al posto dei testi, con la
/// stessa regola del parser: un id esplicito vince e occupa il suo slug.
fn slugs<'a>(outline: &'a [Heading], texts: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut slugs = HeadingSlugs::new();
    outline
        .iter()
        .zip(texts)
        .map(|(heading, text)| match &heading.explicit_anchor {
            Some(raw) => {
                let slug = canonical_anchor(raw);
                let _ = slugs.next_slug(&slug);
                slug
            }
            None => slugs.next_slug(text.trim()),
        })
        .collect()
}

/// La posizione del titolo che `query` nomina: il primo che corrisponde.
fn first_match(outline: &[Heading], query: &str) -> Option<usize> {
    outline.iter().position(|h| heading_matches(query, h))
}

/// Gli edit che fanno nominare il titolo nuovo ai link di `source` che oggi
/// nominano il vecchio. `points_here` dice se la pagina del link è il
/// documento del titolo.
fn link_edits(
    source: &str,
    links: &[Link],
    outline: &[Heading],
    index: usize,
    renamed: &Heading,
    mut points_here: impl FnMut(&LinkTarget) -> Result<bool, PluginError>,
) -> Result<Vec<TextEdit>, PluginError> {
    let mut edits = Vec::new();
    for link in links {
        let LinkTarget::Wiki {
            page,
            heading: Some(written),
            block: None,
        } = &link.target
        else {
            continue;
        };
        if first_match(outline, written) != Some(index) || heading_matches(written, renamed) {
            continue;
        }
        if !points_here(&link.target)? {
            continue;
        }
        let Some(raw) = source.get(link.span.start..link.span.end) else {
            continue;
        };
        let Some(open) = raw.find("[[") else { continue };
        let Some(close) = raw.rfind("]]").filter(|&c| c > open) else {
            continue;
        };
        let inner = &raw[open + 2..close];
        let link_part = inner.split('|').next().unwrap_or(inner);
        let Some(hash) = link_part.find('#') else {
            continue;
        };
        let field = &link_part[hash + 1..];
        let lead = field.len() - field.trim_start().len();
        let at = link.span.start + open + 2 + hash + 1 + lead;
        let span = Span::new(at, at + field.trim().len());
        let mut next = inner.to_string();
        let local = span.start - (link.span.start + open + 2);
        next.replace_range(local..local + field.trim().len(), &renamed.text);
        let keeps = matches!(
            parse_wikilink_inner(&next).target,
            LinkTarget::Wiki { page: ref p, heading: Some(ref h), block: None }
                if p.trim() == page.trim() && *h == renamed.text
        );
        if !keeps {
            continue; // la grammatica lo leggerebbe in un altro modo: non si tocca
        }
        edits.push(TextEdit::replace(span, renamed.text.clone()));
    }
    Ok(edits)
}

fn resolves_to(
    host: &dyn HostApi,
    target: &LinkTarget,
    from: &DocId,
    doc: &DocId,
) -> Result<bool, PluginError> {
    if target.names_host() {
        return Ok(from == doc);
    }
    let LinkTarget::Wiki { page, .. } = target else {
        return Ok(false);
    };
    Ok(matches!(
        host.query_index(IndexQuery::Resolve {
            target: LinkTarget::wiki(page.clone()),
            from: Some(from.clone()),
        })?,
        IndexResult::Resolved(Some(found)) if found.doc == *doc
    ))
}

fn rename_heading(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document(DOC)
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    crate::formats::require(host, &doc, fub_abi::options::syntax::WIKILINKS)?;
    let query = args.text(HEADING).unwrap_or("").trim().to_string();
    let wanted = new_name(args.text(NEW_HEADING).unwrap_or(""))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_INVALID)))?
        .to_string();
    let revision = host.document_revision(&doc)?;
    let source = host.read_document(&doc)?;
    let model = host.read_model(&doc)?;
    let outline = &model.outline;
    let index = first_match(outline, query.trim_start_matches('#')).ok_or_else(|| {
        PluginError::NotFound(Text::message(E_MISSING, vec![Arg::text(HEADING, &query)]))
    })?;
    let old = outline[index].clone();
    if old.text == wanted {
        return Err(PluginError::BadArgs(Text::key(E_SAME)));
    }
    let text_span = heading_text_span(&source, &old).ok_or_else(|| {
        PluginError::Conflict(Text::message(
            E_FORMATTED,
            vec![Arg::text(HEADING, &old.text)],
        ))
    })?;
    let mut renamed = old.clone();
    renamed.text = wanted.clone();
    let before = slugs(outline, outline.iter().map(|h| h.text.as_str()));
    let after = slugs(
        outline,
        outline.iter().enumerate().map(|(i, h)| {
            if i == index {
                wanted.as_str()
            } else {
                h.text.as_str()
            }
        }),
    );
    renamed.slug = after[index].clone();
    if before
        .iter()
        .zip(&after)
        .enumerate()
        .any(|(i, (b, a))| i != index && b != a)
    {
        return Err(PluginError::Conflict(Text::message(
            E_SLUGS,
            vec![Arg::text(NEW_HEADING, &wanted)],
        )));
    }
    let mut next_outline = outline.clone();
    next_outline[index] = renamed.clone();
    if first_match(&next_outline, &wanted) != Some(index) {
        return Err(PluginError::Conflict(Text::message(
            E_TAKEN,
            vec![Arg::text(NEW_HEADING, &wanted)],
        )));
    }

    // Il documento del titolo: il titolo e i suoi link interni in un edit solo.
    let mut own = vec![TextEdit::replace(text_span, wanted.clone())];
    own.extend(link_edits(
        &source,
        &model.links,
        outline,
        index,
        &renamed,
        |target| Ok(target.names_host()),
    )?);
    own.sort_by_key(|edit| edit.span.start);
    let mut plans = vec![PlannedEdit::new(
        doc.clone(),
        EditRequest::new(revision, own),
    )];

    let sources = host
        .query_index(IndexQuery::Backlinks {
            target: doc.clone(),
            page: None,
        })?
        .backlinks()?
        .items;
    let mut seen = std::collections::BTreeSet::new();
    let mut attempted = 1;
    let mut failures = Vec::new();
    for backlink in sources {
        let from = backlink.source;
        if from == doc || !seen.insert(from.clone()) {
            continue;
        }
        attempted += 1;
        let prepared = (|| -> Result<Option<PlannedEdit>, PluginError> {
            crate::formats::require(host, &from, fub_abi::options::syntax::WIKILINKS)?;
            let revision = host.document_revision(&from)?;
            let text = host.read_document(&from)?;
            let model = host.read_model(&from)?;
            let edits = link_edits(&text, &model.links, outline, index, &renamed, |target| {
                resolves_to(host, target, &from, &doc)
            })?;
            Ok((!edits.is_empty())
                .then(|| PlannedEdit::new(from.clone(), EditRequest::new(revision, edits))))
        })();
        match prepared {
            Ok(Some(edit)) => plans.push(edit),
            Ok(None) => {}
            Err(error) => failures.push(Failure::of(from, error)),
        }
    }
    let summary = |count: usize| {
        Text::message(
            P_RENAME,
            vec![
                Arg::text(HEADING, &old.text),
                Arg::text(NEW_HEADING, &wanted),
                Arg::text("count", count.saturating_sub(1).to_string()),
            ],
        )
    };
    if mode.is_dry_run() {
        let planned = plans.len();
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary(planned),
                plans,
            )))
            .partially(Partial::of(attempted, planned, failures)));
    }
    let mut inverses = Vec::new();
    for (position, planned) in plans.into_iter().enumerate() {
        match host.apply_edit(&planned.doc, planned.edit) {
            Ok(report) => inverses.push(PlannedEdit::new(planned.doc, report.inverse())),
            // Senza il titolo i link nuovi punterebbero a niente: ci si ferma.
            Err(error) if position == 0 => return Err(error),
            Err(error) => failures.push(Failure::of(planned.doc, error)),
        }
    }
    let changed = inverses.len();
    inverses.reverse();
    Ok(CommandOutcome::notify(summary(changed))
        .partially(Partial::of(attempted, changed, failures))
        .undoable(Undo::of_edits(
            Text::message(
                U_RENAME,
                vec![
                    Arg::text(HEADING, &old.text),
                    Arg::text(NEW_HEADING, &wanted),
                ],
            ),
            inverses,
        )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heading(text: &str, start: usize, end: usize, anchor: Option<&str>) -> Heading {
        Heading {
            level: 2,
            text: text.to_string(),
            slug: fub_abi::model::heading_slug(text),
            span: Span::new(start, end),
            explicit_anchor: anchor.map(str::to_string),
        }
    }

    fn written(source: &str, span: Option<Span>) -> Option<&str> {
        span.map(|s| &source[s.start..s.end])
    }

    #[test]
    fn the_text_is_found_between_the_marks() {
        let source = "## Titolo uno ##\n";
        let h = heading("Titolo uno", 0, 16, None);
        assert_eq!(
            written(source, heading_text_span(source, &h)),
            Some("Titolo uno")
        );
        let source = "### C# ^Mio-id\n";
        let h = heading("C#", 0, 14, Some("Mio-id"));
        assert_eq!(written(source, heading_text_span(source, &h)), Some("C#"));
        let source = "Setext\r\n======\r\n";
        let h = heading("Setext", 0, 14, None);
        assert_eq!(
            written(source, heading_text_span(source, &h)),
            Some("Setext")
        );
    }

    #[test]
    fn a_formatted_heading_is_not_rewritten() {
        let source = "## **Forte**\n";
        let h = heading("Forte", 0, 12, None);
        assert_eq!(heading_text_span(source, &h), None);
    }

    #[test]
    fn a_new_name_must_fit_in_a_link() {
        assert_eq!(new_name("  Nuovo  "), Some("Nuovo"));
        for bad in ["", "a|b", "a#b", "a^b", "a]]", "a\nb"] {
            assert_eq!(new_name(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn only_the_links_to_this_heading_change() {
        let outline = vec![heading("Uno", 0, 6, None), heading("Due", 7, 13, None)];
        let mut renamed = outline[0].clone();
        renamed.text = "Primo".into();
        renamed.slug = "primo".into();
        let source = "[[Nota#Uno]] [[Nota#uno|alias]] ![[Nota# Uno ]] [[Nota#Due]] [[Nota#^blk]]";
        let links: Vec<Link> = [
            "[[Nota#Uno]]",
            "[[Nota#uno|alias]]",
            "![[Nota# Uno ]]",
            "[[Nota#Due]]",
            "[[Nota#^blk]]",
        ]
        .iter()
        .map(|raw| {
            let at = source.find(raw).unwrap();
            let inner = raw
                .trim_start_matches('!')
                .trim_start_matches("[[")
                .trim_end_matches("]]");
            Link {
                target: parse_wikilink_inner(inner).target,
                embed: raw.starts_with('!'),
                span: Span::new(at, at + raw.len()),
                context: None,
            }
        })
        .collect();
        let edits = link_edits(source, &links, &outline, 0, &renamed, |_| Ok(true)).unwrap();
        let mut out = source.to_string();
        for edit in edits.iter().rev() {
            out.replace_range(edit.span.start..edit.span.end, &edit.text);
        }
        assert_eq!(
            out,
            "[[Nota#Primo]] [[Nota#Primo|alias]] ![[Nota# Primo ]] [[Nota#Due]] [[Nota#^blk]]"
        );
    }

    #[test]
    fn renaming_a_twin_would_move_the_other() {
        let outline = vec![heading("Uno", 0, 6, None), heading("Uno", 7, 13, None)];
        let before = slugs(&outline, outline.iter().map(|h| h.text.as_str()));
        let after = slugs(&outline, ["Altro", "Uno"].into_iter());
        assert_eq!(before, vec!["uno", "uno-1"]);
        assert_eq!(after, vec!["altro", "uno"]);
    }
}
