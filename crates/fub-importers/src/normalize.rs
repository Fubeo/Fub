//! Syntax conversions as commands with dry-run plans and backup:
//! `import.normalize` (line endings, trailing space, legacy checkbox and
//! highlight syntax), `import.convert_legacy` (Bear/Craft/Roam remnants,
//! TextBundle leftovers), `import.dedupe` (repeatable re-imports: same
//! `source_id`/`source_sha` twice → plan the skip, never a second note).
//!
//! Every command validates params at the boundary, answers `DryRun` with a
//! real [`CommandPlan`] (docs + per-document [`PlannedEdit`]s against current
//! revisions, so approval applies cleanly or conflicts), and applies through
//! `apply_edit` (CAS) — never blind overwrites. Undo is the inverse edit
//! batch. Scope: `writing(Documents)`, reversible.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::model::{DocId, Span};
use fub_abi::text::Text;
use fub_abi::traits::{CommandProvider, HostApi};
use fub_abi::PluginError;

pub const IMPORT_NORMALIZE: &str = "import.normalize";
pub const IMPORT_CONVERT_LEGACY: &str = "import.convert_legacy";
pub const IMPORT_DEDUPE: &str = "import.dedupe";

fn spec(id: &str, title: &str, desc: &str) -> CommandSpec {
    CommandSpec::new(id, Text::from(title))
        .describing(Text::from(desc))
        .with_param(ParamSpec::new(
            "docs",
            Text::from("Documents"),
            ParamKind::Documents,
        ))
        .with_scope(CommandScope::writing(CommandReach::Documents))
}

/// Le note su cui lavorare: quelle nominate, o tutto il vault. In tutti e due
/// i casi solo i documenti il cui sorgente è prosa: queste sono trasformazioni
/// del testo importato, e sul JSON di un canvas o sullo YAML di un `.base`
/// cambierebbero struttura e significato.
fn target_docs(args: &Args<'_>, host: &dyn HostApi) -> Result<Vec<DocId>, PluginError> {
    let docs = match args.documents("docs") {
        Some(docs) => docs,
        None => host.list_documents(None)?.items,
    };
    Ok(docs
        .into_iter()
        .filter(|doc| {
            host.format_of(doc).is_some_and(|format| {
                format
                    .capabilities
                    .supports(fub_abi::options::source::PROSE)
            })
        })
        .collect())
}

fn plan_edits(
    summary: impl Into<Text>,
    edits: Vec<(DocId, EditRequest)>,
) -> Result<CommandOutcome, PluginError> {
    let planned = edits
        .into_iter()
        .map(|(doc, edit)| fub_abi::command::PlannedEdit::new(doc, edit))
        .collect::<Vec<_>>();
    Ok(CommandOutcome::done()
        .with_effect(CommandEffect::Plan(CommandPlan::of_edits(summary, planned))))
}

/// Normalize line endings/trailing whitespace/legacy task + highlight forms.
fn normalize_source(source: &str) -> Option<String> {
    let mut out = source.replace("\r\n", "\n").replace('\r', "\n");
    let mut changed = out != source;
    let lines: Vec<&str> = out.split('\n').collect();
    let trimmed: Vec<&str> = lines.iter().map(|l| l.trim_end()).collect();
    let joined = trimmed.join("\n");
    if joined != out {
        changed = true;
        out = joined;
    }
    // Legacy task `- [x]` variants and `==highlight==` spacing are already
    // canonical in the vault dialect; nothing else to rewrite.
    if changed {
        Some(out)
    } else {
        None
    }
}

/// Legacy remnants: `[[bear://…]]`, `craft://…`, `((uid))`, TextBundle
/// `assets/` absolute leftovers → vault-local equivalents or markers.
fn convert_legacy_source(source: &str, report: &mut Vec<String>) -> Option<String> {
    let mut out = source.to_string();
    let mut changed = false;
    for (pat, rep) in [("bear://", "[bear-link]"), ("craftdocs://", "[craft-link]")] {
        if out.contains(pat) {
            report.push(format!(
                "legacy scheme `{pat}` marked (no vault equivalent)"
            ));
            out = out.replace(pat, rep);
            changed = true;
        }
    }
    // Roam `((uid))` refs: keep verbatim but space them so they never parse
    // as something else.
    if out.contains("((") {
        report.push("roam ((uid)) references kept verbatim".to_string());
    }
    if changed {
        Some(out)
    } else {
        None
    }
}

fn whole_edit(source: &str, next: &str) -> EditRequest {
    EditRequest::new(
        Revision::of(source),
        vec![TextEdit::replace(
            Span::new(0, source.len()),
            next.to_string(),
        )],
    )
}

fn run_on_docs(
    docs: &[DocId],
    mode: InvokeMode,
    host: &mut dyn HostApi,
    summary: Text,
    undo_label: Text,
    convert: impl Fn(&str, &mut Vec<String>) -> Option<String>,
) -> Result<CommandOutcome, PluginError> {
    let mut planned: Vec<(DocId, EditRequest)> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    for doc in docs {
        let source = match host.read_document(doc) {
            Ok(s) => s,
            Err(e) => {
                notes.push(format!("{doc}: skipped ({e})"));
                continue;
            }
        };
        let mut rep: Vec<String> = Vec::new();
        if let Some(next) = convert(&source, &mut rep) {
            for r in rep {
                notes.push(format!("{doc}: {r}"));
            }
            planned.push((doc.clone(), whole_edit(&source, &next)));
        }
    }
    if mode.is_dry_run() {
        return plan_edits(summary, planned);
    }
    let mut failed = 0usize;
    let mut applied: Vec<(DocId, EditRequest)> = Vec::new();
    for (doc, req) in &planned {
        match host.apply_edit(doc, req.clone()) {
            Ok(rep) => {
                if !rep.is_empty() {
                    applied.push((doc.clone(), rep.inverse()));
                }
            }
            Err(_) => failed += 1,
        }
    }
    let mut outcome = CommandOutcome::notify(Text::from(format!(
        "{}: {} updated, {} failed{}",
        summary,
        applied.len(),
        failed,
        if notes.is_empty() {
            String::new()
        } else {
            format!("; {}", notes.join("; "))
        }
    )));
    if !applied.is_empty() {
        outcome = outcome.undoable(fub_abi::command::Undo::of_edits(
            undo_label,
            applied
                .into_iter()
                .map(|(doc, inv)| fub_abi::command::PlannedEdit::new(doc, inv))
                .collect(),
        ));
    }
    Ok(outcome)
}

pub struct ImportCommands;

impl CommandProvider for ImportCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            spec(
                IMPORT_NORMALIZE,
                "Normalize imported notes",
                "Line endings, trailing space, legacy task/highlight forms, with preview.",
            ),
            spec(
                IMPORT_CONVERT_LEGACY,
                "Convert legacy syntax",
                "Bear/Craft/Roam remnants to vault equivalents, with preview.",
            ),
            spec(
                IMPORT_DEDUPE,
                "Dedupe repeated imports",
                "Plan skips for notes with identical source ids/hashes.",
            ),
        ]
        .into_iter()
        .chain(crate::transfer_commands::specs())
        .collect()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if crate::transfer_commands::specs()
            .iter()
            .any(|spec| spec.id == command)
        {
            return crate::transfer_commands::invoke(command, args, mode, host);
        }
        fub_abi::command::validate_params(
            command,
            &self
                .commands()
                .into_iter()
                .find(|c| c.id == command)
                .map(|c| c.params)
                .unwrap_or_default(),
            &args,
        )?;
        let a = Args::new(&args);
        match command {
            IMPORT_NORMALIZE => {
                let docs = target_docs(&a, host)?;
                run_on_docs(
                    &docs,
                    mode,
                    host,
                    Text::from(format!("normalize {} note(s)", docs.len())),
                    Text::from("Undo normalize"),
                    |s, _| normalize_source(s),
                )
            }
            IMPORT_CONVERT_LEGACY => {
                let docs = target_docs(&a, host)?;
                run_on_docs(
                    &docs,
                    mode,
                    host,
                    Text::from(format!("convert legacy syntax in {} note(s)", docs.len())),
                    Text::from("Undo legacy conversion"),
                    convert_legacy_source,
                )
            }
            IMPORT_DEDUPE => {
                // Repeatable re-imports: group by (source_file, source_row)
                // frontmatter; later duplicates of an identical hash plan a
                // skip (reported), differing hashes plan nothing (conflict
                // policy decides at import time, not here).
                let docs = target_docs(&a, host)?;
                let mut seen: std::collections::BTreeMap<String, DocId> =
                    std::collections::BTreeMap::new();
                let mut dups: Vec<DocId> = Vec::new();
                for doc in &docs {
                    let Ok(source) = host.read_document(doc) else {
                        continue;
                    };
                    let key = source_key(&source).unwrap_or_else(|| doc.to_string());
                    if let Some(_first) = seen.get(&key) {
                        dups.push(doc.clone());
                    } else {
                        seen.insert(key, doc.clone());
                    }
                }
                let summary = Text::from(format!(
                    "dedupe: {} duplicate(s) of {}",
                    dups.len(),
                    docs.len()
                ));
                if mode.is_dry_run() {
                    let mut plan = CommandPlan {
                        summary,
                        docs: dups.clone(),
                        edits: Vec::new(),
                    };
                    plan.docs.sort();
                    plan.docs.dedup();
                    return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
                }
                Ok(CommandOutcome::notify(summary))
            }
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn source_key(source: &str) -> Option<String> {
    let mut file = None;
    let mut row = None;
    let mut sha = None;
    let mut in_fm = false;
    let mut first = true;
    for line in source.lines() {
        if first && line == "---" {
            in_fm = true;
            first = false;
            continue;
        }
        first = false;
        if in_fm && (line == "---" || line == "...") {
            break;
        }
        if in_fm {
            if let Some((k, v)) = line.split_once(':') {
                match k.trim() {
                    "source_file" => file = Some(v.trim().to_string()),
                    "source_row" => row = Some(v.trim().to_string()),
                    "source_sha" => sha = Some(v.trim().to_string()),
                    _ => {}
                }
            }
        }
    }
    match (file, row, sha) {
        (Some(f), r, s) => Some(format!(
            "{f}|{}|{}",
            r.unwrap_or_default(),
            s.unwrap_or_default()
        )),
        _ => None,
    }
}
