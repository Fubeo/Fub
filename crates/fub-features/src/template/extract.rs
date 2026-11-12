//! `note.extract`: la selezione portata in una nota nuova.

use super::*;

/// Estrae la selezione in una nota nuova (P05.5): prima si crea e si verifica
/// la destinazione, poi si sostituisce la selezione con un link/embed via
/// edit CAS. **Mai il contrario**: la sorgente non si tocca prima che la
/// destinazione sia sicura. Se la sostituzione fallisce, la nota creata va
/// nel cestino (compensazione) e l'errore torna a chi chiama — nessuna mezza
/// estrazione silenziosa. Undo: inverso dell'edit + cestino della nota.
pub(super) fn extract(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let view_context = host
        .active_context()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    let from = view_context
        .doc
        .clone()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    // La selezione diventa il corpo di una nota e al suo posto va un link:
    // tutte e due le cose hanno senso solo in un sorgente in prosa, e il link
    // lo scrive il suo formato. Si chiede prima delle coordinate: le carte
    // scelte in una tela arrivano senza, e il motivo vero è il formato.
    crate::formats::require(host, &from, fub_abi::options::source::PROSE)?;
    let selections = view_context
        .selections
        .as_ref()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    let placed = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    if !placed.secondary.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_MULTI_SELECTION)));
    }
    let primary = &placed.primary;
    if primary.text.trim().is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_SELECTION)));
    }
    let selected = primary.text.clone();
    let span = primary.span;
    let name = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| slug_from_text(&selected));
    if name.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_SELECTION)));
    }
    let id = host.free_name(&DocId::new(with_extension(host, &name)?));
    // The session supplied the span and text. A stale context must not replace
    // some other bytes even if the file itself has a valid current revision.
    let revision = host.document_revision(&from)?;
    let original = host.read_document(&from)?;
    if original.get(span.start..span.end) != Some(selected.as_str()) {
        return Err(PluginError::Conflict(Text::message(
            E_STALE_SELECTION,
            vec![Arg::text(A_DOC, from.as_str())],
        )));
    }
    check_relative_assets(host, &from, &id, Some(span))?;
    // «Niente» toglie la selezione e basta: il testo vive nella nota nuova, e
    // l'annullamento lo rimette dov'era come per gli altri due.
    let link = match args.text(REPLACE).unwrap_or("link").trim() {
        "none" => String::new(),
        replace => crate::formats::link_text(
            host,
            &from,
            &crate::formats::wikilink(id.page_name(), None, replace == "embed"),
        )?,
    };
    let summary = Text::message(
        P_EXTRACT,
        vec![
            Arg::text(A_DOC, id.as_str()),
            Arg::text(FROM, from.as_str()),
        ],
    );
    if mode.is_dry_run() {
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
            CommandPlan::of_edits(summary, Vec::new())
                .with_doc(from)
                .with_doc(id),
        )));
    }
    // 1. La destinazione: corpo = selezione, avvolta dal template se detto.
    let body = match args.text(TEMPLATE).map(str::trim).filter(|s| !s.is_empty()) {
        Some(tpl) => {
            let grezzo = host.read_document(&DocId::new(with_extension(host, tpl)?))?;
            let ctx = context(host)?;
            wrap_selection(
                expand_full(&grezzo, &file_name(&id), &ctx, host)?,
                &selected,
            )
        }
        None => selected.clone(),
    };
    host.create_document(&id, &body)?;
    // 2. La sorgente, solo a destinazione sicura: la selezione diventa link.
    let request = EditRequest::new(revision, vec![TextEdit::replace(span, link)]);
    let report = match host.apply_edit(&from, request) {
        Ok(report) => report,
        Err(and) => return Err(compensate_extract(host, &id, and)),
    };
    let undo = Undo {
        label: Text::message(
            U_EXTRACT,
            vec![
                Arg::text(A_DOC, id.as_str()),
                Arg::text(FROM, from.as_str()),
            ],
        ),
        steps: vec![
            UndoStep::Edit(PlannedEdit::new(from.clone(), report.inverse())),
            UndoStep::Command {
                command: TRASH.into(),
                args: serde_json::json!({ "doc": id.as_str() }),
            },
        ],
    };
    let from_label = Arg::text(FROM, from.as_str());
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc: from,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(Text::message(
        D_EXTRACT,
        vec![Arg::text(A_DOC, id.as_str()), from_label],
    ))
    .undoable(undo)
    .with_effect(effect))
}

/// Il corpo della nota estratta da un template: la selezione dove il template
/// dice `{{selection}}`, altrimenti in coda al suo testo dopo una riga vuota,
/// con i terminatori di riga del template.
///
/// La sorgente toglie la selezione in ogni caso (al suo posto un link, un
/// embed o niente), quindi un template che non la colloca non può lasciarla
/// fuori: il testo non starebbe più da nessuna parte (difetto I21).
fn wrap_selection(expanded: String, selected: &str) -> String {
    const SELECTION: &str = "{{selection}}";
    if expanded.contains(SELECTION) {
        return expanded.replace(SELECTION, selected);
    }
    if expanded.is_empty() {
        return selected.to_string();
    }
    let eol = if expanded.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let gap = if expanded.ends_with(&eol.repeat(2)) {
        String::new()
    } else if expanded.ends_with('\n') {
        eol.to_string()
    } else {
        eol.repeat(2)
    };
    format!("{expanded}{gap}{selected}")
}

fn compensate_extract(
    host: &mut dyn HostApi,
    created: &DocId,
    failure: PluginError,
) -> PluginError {
    match host.trash_document(created) {
        Ok(_) => failure,
        Err(cleanup) => PluginError::Conflict(Text::message(
            E_EXTRACT_CLEANUP,
            vec![
                Arg::text("reason", failure.to_string()),
                Arg::text(A_DOC, created.as_str()),
                Arg::text("cleanup", cleanup.to_string()),
            ],
        )),
    }
}

/// Un titolo dalla selezione: prima riga non vuota, troncata a 60 caratteri,
/// senza caratteri vietati nei path. Mai vuoto: il chiamante rifiuta dopo.
fn slug_from_text(text: &str) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let clean: String = first
        .chars()
        .take(60)
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/' => ' ',
            c => c,
        })
        .collect();
    clean.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Relative embedded asset paths cannot be transplanted to another directory
/// without rewriting their link syntax. Reject before either note is mutated;
/// absolute vault paths and external URLs retain their meaning.
pub(super) fn check_relative_assets(
    host: &dyn HostApi,
    source: &DocId,
    target: &DocId,
    selected: Option<fub_abi::model::Span>,
) -> Result<(), PluginError> {
    if source.as_str().rsplit_once('/').map(|(dir, _)| dir)
        == target.as_str().rsplit_once('/').map(|(dir, _)| dir)
    {
        return Ok(());
    }
    let model = host.read_model(source)?;
    for link in model.links {
        let inside =
            selected.is_none_or(|span| link.span.start >= span.start && link.span.end <= span.end);
        if inside
            && link.embed
            && matches!(&link.target, LinkTarget::Path(path) if !path.starts_with('/'))
        {
            return Err(PluginError::Conflict(Text::message(
                E_ASSET_MOVE,
                vec![Arg::text(A_DOC, source.as_str())],
            )));
        }
    }
    Ok(())
}
