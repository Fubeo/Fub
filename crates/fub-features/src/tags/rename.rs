//! `tag.rename`: un tag rinominato in tutto il vault, coi suoi figli.
//!
//! Si riscrivono soltanto i byte del nome. Nel corpo sono gli span che il
//! provider ha già misurato (`DocumentModel::tags`); nel frontmatter sono i
//! nomi dentro il valore di `tags`, letti con la regola di
//! [`frontmatter_tags`]: virgole e spazi separano, il `#` iniziale è
//! facoltativo. Il resto del file, YAML compreso, resta com'è.
//!
//! Come `property.key.rename`, le revisioni si fissano prima di scrivere: una
//! nota cambiata nel frattempo fallisce il suo CAS invece di essere
//! sovrascritta, e l'anteprima mostra il piano senza toccare niente. Una nota
//! il cui frontmatter non si lascia riscrivere in modo lessicale (un elenco su
//! più righe con una forma che qui non si riconosce) è un fallimento dichiarato,
//! non una rinomina a metà.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{canonical_tag, Span};
use fub_abi::query::{QueryExpr, QueryPredicate};
use fub_abi::rules::tag::{frontmatter_tags, is_sub_tag, scan_tags};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{CommandProvider, Excerpts, HostApi, IndexQuery, PropertySelect};

/// Rinomina un tag, e i suoi figli, in tutte le note che lo portano.
pub const TAG_RENAME: &str = "tag.rename";

pub(super) const OLD_TAG: &str = "old_tag";
pub(super) const NEW_TAG: &str = "new_tag";
pub(super) const P_RENAME: &str = "p_rename";
pub(super) const U_RENAME: &str = "u_rename";
pub(super) const E_SAME: &str = "e_same";
pub(super) const E_INVALID: &str = "e_invalid";
pub(super) const E_FRONTMATTER: &str = "e_frontmatter";

/// I comandi dei tag.
pub struct TagCommands;

impl CommandProvider for TagCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(TAG_RENAME, Text::key(format!("{TAG_RENAME}.title")))
                .describing(Text::key(format!("{TAG_RENAME}.desc")))
                .with_param(parameter(OLD_TAG).required())
                .with_param(parameter(NEW_TAG).required())
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
            TAG_RENAME => rename_tag(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(name: &str) -> ParamSpec {
    ParamSpec::new(
        name,
        Text::key(format!("{TAG_RENAME}.{name}.title")),
        ParamKind::Text,
    )
    .describing(Text::key(format!("{TAG_RENAME}.{name}.desc")))
}

/// Il nome com'è scritto, senza il `#` iniziale, se è un tag intero.
fn tag_name(raw: &str) -> Option<&str> {
    let name = raw.trim().trim_start_matches('#');
    let probe = format!("#{name}");
    match scan_tags(&probe).as_slice() {
        [only] if only.span == Span::new(0, probe.len()) => Some(name),
        _ => None,
    }
}

/// Il nome rinominato, se `written` è `old` o un suo figlio: `new` al posto
/// dei segmenti di `old`, il resto com'era scritto.
fn renamed(written: &str, old: &str, new: &str) -> Option<String> {
    let key = canonical_tag(written);
    if key != old && !is_sub_tag(&key, old) {
        return None;
    }
    let depth = old.split('/').count();
    let rest: Vec<&str> = written.split('/').skip(depth).collect();
    Some(if rest.is_empty() {
        new.to_string()
    } else {
        format!("{new}/{}", rest.join("/"))
    })
}

fn rename_tag(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let old = tag_name(args.text(OLD_TAG).unwrap_or(""))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_INVALID)))?;
    let new = tag_name(args.text(NEW_TAG).unwrap_or(""))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_INVALID)))?
        .to_string();
    let old_key = canonical_tag(old);
    if canonical_tag(&new) == old_key && new == old {
        return Err(PluginError::BadArgs(Text::key(E_SAME)));
    }
    let docs = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Tag {
                name: old_key.clone(),
                descendants: true,
            }),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?
        .items;
    let attempted = docs.len();
    let mut plans = Vec::with_capacity(attempted);
    let mut failures = Vec::new();
    for entry in docs {
        let doc = entry.doc;
        let prepared = (|| -> Result<Option<PlannedEdit>, PluginError> {
            crate::formats::require(host, &doc, fub_abi::options::syntax::TAGS)?;
            let revision = host.document_revision(&doc)?;
            let source = host.read_document(&doc)?;
            let model = host.read_model(&doc)?;
            let mut edits = Vec::new();
            for tag in &model.tags {
                let written = source
                    .get(tag.span.start..tag.span.end)
                    .and_then(|text| text.strip_prefix('#'));
                if let Some(next) = written.and_then(|w| renamed(w, &old_key, &new)) {
                    edits.push(TextEdit::replace(tag.span, format!("#{next}")));
                }
            }
            let wanted = frontmatter_tags(&model.frontmatter)
                .iter()
                .filter(|name| renamed(name, &old_key, &new).is_some())
                .count();
            if wanted > 0 {
                crate::formats::require(host, &doc, fub_abi::options::syntax::FRONTMATTER)?;
                let found = frontmatter_edits(&source, &old_key, &new);
                if found.len() != wanted {
                    return Err(PluginError::Conflict(Text::message(
                        E_FRONTMATTER,
                        vec![Arg::text("doc", doc.as_str())],
                    )));
                }
                edits.extend(found);
            }
            if edits.is_empty() {
                return Ok(None); // già rinominato: rieseguire è innocuo
            }
            edits.sort_by_key(|edit| edit.span.start);
            Ok(Some(PlannedEdit::new(
                doc.clone(),
                EditRequest::new(revision, edits),
            )))
        })();
        match prepared {
            Ok(Some(edit)) => plans.push(edit),
            Ok(None) => {}
            Err(error) => failures.push(Failure::of(doc, error)),
        }
    }
    let summary = |count: usize| {
        Text::message(
            P_RENAME,
            vec![
                Arg::text(OLD_TAG, old),
                Arg::text(NEW_TAG, &new),
                Arg::text("count", count.to_string()),
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
    for planned in plans {
        match host.apply_edit(&planned.doc, planned.edit) {
            Ok(report) => inverses.push(PlannedEdit::new(planned.doc, report.inverse())),
            Err(error) => failures.push(Failure::of(planned.doc, error)),
        }
    }
    let changed = inverses.len();
    let mut outcome = CommandOutcome::notify(summary(changed))
        .partially(Partial::of(attempted, changed, failures));
    if !inverses.is_empty() {
        inverses.reverse();
        outcome = outcome.undoable(Undo::of_edits(
            Text::message(
                U_RENAME,
                vec![Arg::text(OLD_TAG, old), Arg::text(NEW_TAG, &new)],
            ),
            inverses,
        ));
    }
    Ok(outcome)
}

/// Le righe del frontmatter, come `(inizio, fine senza a capo)`, fra i due
/// delimitatori `---`. `None` senza un frontmatter chiuso.
fn frontmatter_lines(source: &str) -> Option<Vec<(usize, usize)>> {
    let start = if source.starts_with('\u{FEFF}') {
        '\u{FEFF}'.len_utf8()
    } else {
        0
    };
    let mut lines = Vec::new();
    let mut at = start;
    let mut first = true;
    while at < source.len() {
        let end = source[at..].find('\n').map_or(source.len(), |i| at + i);
        let content = source[at..end]
            .strip_suffix('\r')
            .map_or(end, |s| at + s.len());
        let text = &source[at..content];
        if first {
            if text.trim_end() != "---" {
                return None;
            }
            first = false;
        } else if text.trim_end() == "---" || text.trim_end() == "..." {
            return Some(lines);
        } else {
            lines.push((at, content));
        }
        at = end + 1;
    }
    None
}

/// Gli edit che rinominano `old` (e i figli) nel valore di `tags`.
fn frontmatter_edits(source: &str, old: &str, new: &str) -> Vec<TextEdit> {
    let Some(lines) = frontmatter_lines(source) else {
        return Vec::new();
    };
    let mut edits = Vec::new();
    let mut inside = false;
    for (start, end) in lines {
        let text = &source[start..end];
        let top_level = !text.is_empty() && !text.starts_with([' ', '\t', '-', '#']);
        let mut from = start;
        if top_level {
            let key = text
                .split(':')
                .next()
                .unwrap_or("")
                .trim()
                .trim_matches(['"', '\'']);
            inside = text.contains(':') && key == "tags";
            if !inside {
                continue;
            }
            from = start + text.find(':').map_or(0, |i| i + 1);
        } else if !inside {
            continue;
        }
        edits.extend(value_edits(source, from, end, old, new));
    }
    edits
}

/// I nomi da rinominare in un pezzo di valore YAML, fino a un commento.
fn value_edits(source: &str, from: usize, to: usize, old: &str, new: &str) -> Vec<TextEdit> {
    let text = &source[from..to];
    let mut edits = Vec::new();
    let mut quote: Option<char> = None;
    let mut token_start: Option<usize> = None;
    let mut previous = ' ';
    let flush = |start: Option<usize>, end: usize, edits: &mut Vec<TextEdit>| {
        let Some(start) = start else { return };
        let piece = &text[start..end];
        let name = piece.trim_start_matches('#');
        if tag_name(name) != Some(name) {
            return;
        }
        if let Some(next) = renamed(name, old, new) {
            let at = from + start + (piece.len() - name.len());
            edits.push(TextEdit::replace(Span::new(at, from + end), next));
        }
    };
    for (index, c) in text.char_indices() {
        // Fuori dalle virgolette, un `#` dopo uno spazio apre un commento YAML:
        // `tags: #a` non ha tag, e non se ne inventa uno.
        if quote.is_none() && c == '#' && previous.is_whitespace() {
            break;
        }
        let separator = c.is_whitespace() || matches!(c, ',' | '[' | ']' | '"' | '\'');
        if separator {
            flush(token_start.take(), index, &mut edits);
            if c == '"' || c == '\'' {
                quote = match quote {
                    Some(open) if open == c => None,
                    None => Some(c),
                    other => other,
                };
            }
        } else if token_start.is_none() {
            token_start = Some(index);
        }
        previous = c;
    }
    flush(token_start.take(), text.len(), &mut edits);
    edits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(source: &str, mut edits: Vec<TextEdit>) -> String {
        edits.sort_by_key(|e| std::cmp::Reverse(e.span.start));
        let mut out = source.to_string();
        for edit in edits {
            out.replace_range(edit.span.start..edit.span.end, &edit.text);
        }
        out
    }

    #[test]
    fn renamed_keeps_the_children_as_written() {
        assert_eq!(
            renamed("Progetto", "progetto", "lavoro").as_deref(),
            Some("lavoro")
        );
        assert_eq!(
            renamed("progetto/Casa", "progetto", "lavoro").as_deref(),
            Some("lavoro/Casa")
        );
        assert_eq!(renamed("progettone", "progetto", "lavoro"), None);
        assert_eq!(renamed("a/b/c", "a/b", "x").as_deref(), Some("x/c"));
    }

    #[test]
    fn the_frontmatter_keeps_its_shape() {
        let source = "---\ntitolo: progetto\ntags: [progetto, \"#progetto/casa\", altro] # progetto\nalias:\n  - progetto\n---\ncorpo #progetto\n";
        let out = apply(source, frontmatter_edits(source, "progetto", "lavoro"));
        assert_eq!(
            out,
            "---\ntitolo: progetto\ntags: [lavoro, \"#lavoro/casa\", altro] # progetto\nalias:\n  - progetto\n---\ncorpo #progetto\n"
        );
    }

    #[test]
    fn a_block_list_and_a_plain_string_are_renamed() {
        let list = "---\ntags:\n  - progetto\n- Progetto/x\nnext: progetto\n---\n";
        assert_eq!(
            apply(list, frontmatter_edits(list, "progetto", "lavoro")),
            "---\ntags:\n  - lavoro\n- lavoro/x\nnext: progetto\n---\n"
        );
        let plain = "---\r\ntags: progetto, altro\r\n---\r\n";
        assert_eq!(
            apply(plain, frontmatter_edits(plain, "progetto", "lavoro")),
            "---\r\ntags: lavoro, altro\r\n---\r\n"
        );
    }

    #[test]
    fn a_name_that_is_not_a_tag_is_refused() {
        assert_eq!(tag_name("#ok/sotto"), Some("ok/sotto"));
        assert_eq!(tag_name("due parole"), None);
        assert_eq!(tag_name("123"), None);
        assert_eq!(tag_name(""), None);
    }
}
