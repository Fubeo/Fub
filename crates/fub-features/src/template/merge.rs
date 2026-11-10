//! `note.merge`: più note unite in una, con i link che le seguono.

use super::*;

/// Unisce note dentro una destinazione (P05.5): per ogni sorgente si legge il
/// corpo, si accoda/prepone alla destinazione via edit CAS, e **solo dopo**
/// che la destinazione è sicura la sorgente va nel cestino. Se l'edit
/// fallisce, la sorgente resta dov'è e il guasto si conta e si dice
/// (`Partial`): mai perdita silenziosa, mai merge distruttivo diretto.
/// Undo: inverso degli edit + ripristino delle sorgenti cestinate.
pub(super) fn merge(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let sources = args
        .documents(FROM)
        .expect("l'host ha convalidato un parametro obbligatorio");
    if sources.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_SOURCES)));
    }
    let into = args
        .document(INTO)
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    if sources.iter().any(|s| s == &into) {
        return Err(PluginError::BadArgs(Text::message(
            E_MERGE_SELF,
            vec![Arg::text(A_DOC, into.as_str())],
        )));
    }
    // Unire è incollare un sorgente in un altro: ha senso solo fra documenti
    // in prosa. Un canvas incollato in una nota è JSON grezzo, e una nota
    // accodata a un `.base` ne cancella le viste. Si controlla prima di
    // leggere o cestinare qualunque cosa.
    for doc in std::iter::once(&into).chain(&sources) {
        crate::formats::require(host, doc, fub_abi::options::source::PROSE)?;
    }
    let prepend = matches!(args.text(MODE).unwrap_or("append").trim(), "prepend");
    let separator = args.text(SEPARATOR).unwrap_or("\n\n").to_string();
    let trash_sources = args.flag(TRASH_PARAM, true);
    // Preflight references and assets before editing *any* destination:
    // otherwise a failure discovered halfway through would leave a merge
    // duplicated in one note while the rest were silently skipped.
    let mut bodies: Vec<(DocId, String)> = Vec::new();
    let mut relinks: Vec<PlannedEdit> = Vec::new();
    for source in &sources {
        let body = host.read_document(source)?;
        if text_policy::strip_bom(&body).trim().is_empty() {
            continue;
        }
        check_relative_assets(host, source, &into, None)?;
        // Una sorgente che altri citano si può cestinare solo se i loro link
        // passano alla destinazione: lo dice qui il piano dell'host, così la
        // simulazione li mostra, e un host che non lo sa fare rifiuta prima di
        // toccare niente, come prima.
        if trash_sources && has_backlinks(host, source)? {
            match host.link_retarget_edits(source, &into) {
                Ok(edits) => relinks.extend(edits.into_iter().filter(|edit| &edit.doc != source)),
                Err(PluginError::Unserved(_)) => return Err(referenced(source)),
                Err(and) => return Err(and),
            }
        }
        bodies.push((source.clone(), body));
    }
    if bodies.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_SOURCES)));
    }
    let summary = Text::message(
        P_MERGE,
        vec![
            Arg::int(A_COUNT, bodies.len() as i64),
            Arg::text(A_DOC, into.as_str()),
        ],
    );
    if mode.is_dry_run() {
        let revision = host.document_revision(&into)?;
        let source = host.read_document(&into)?;
        let (at, lead) = if prepend {
            merge_head(host, &into, &source)?
        } else {
            (source.len(), "")
        };
        let at = snap_to_boundary(&source, at);
        let preview = if prepend {
            format!("{lead}{}{separator}", join_bodies(&bodies, &separator))
        } else {
            format!("{separator}{}", join_bodies(&bodies, &separator))
        };
        let request = EditRequest::new(revision, vec![TextEdit::insert(at, preview)]);
        let mut edits = vec![PlannedEdit::new(into, request)];
        edits.extend(relinks);
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(summary, edits))));
    }
    let mut failed: Vec<Failure> = Vec::new();
    let mut back_edits: Vec<PlannedEdit> = Vec::new();
    let mut trashed: Vec<(DocId, DocId)> = Vec::new();
    let mut made = 0usize;
    // Un edit per sorgente, perché una che fallisce non trascini le altre. In
    // testa però ognuno entra nello stesso punto, sopra quelli già entrati: si
    // parte dall'ultima sorgente, e il risultato è il loro ordine, quello del
    // piano.
    let mut queue: Vec<DocId> = bodies.iter().map(|(source, _)| source.clone()).collect();
    if prepend {
        queue.reverse();
    }
    // Il testo che ogni sorgente deve avere ancora: quello letto prima, o
    // quello che le ha dato questa stessa unione portando sulla destinazione
    // un suo link verso una sorgente già entrata.
    let mut expected: BTreeMap<DocId, String> = bodies.iter().cloned().collect();
    for source in &queue {
        let body = expected[source].clone();
        match host.read_document(source) {
            Ok(latest) if latest == body => {}
            Ok(_) => {
                failed.push(Failure::of(
                    source.clone(),
                    PluginError::Conflict(Text::message(
                        E_SOURCE_CHANGED,
                        vec![Arg::text(A_DOC, source.as_str())],
                    )),
                ));
                continue;
            }
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        }
        let current = match host.read_document(&into) {
            Ok(current) => current,
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        };
        let (at, lead) = if prepend {
            match merge_head(host, &into, &current) {
                Ok(head) => head,
                Err(and) => {
                    failed.push(Failure::of(source.clone(), and));
                    continue;
                }
            }
        } else {
            (current.len(), "")
        };
        let at = snap_to_boundary(&current, at);
        let inserted = text_policy::strip_bom(&body);
        let text = if prepend {
            format!("{lead}{inserted}{separator}")
        } else {
            format!("{separator}{inserted}")
        };
        let revision = match host.document_revision(&into) {
            Ok(revision) => revision,
            Err(and) => {
                failed.push(Failure::of(source.clone(), and));
                continue;
            }
        };
        let request = EditRequest::new(revision, vec![TextEdit::insert(at, text)]);
        match host.apply_edit(&into, request) {
            Ok(report) => {
                made += 1;
                back_edits.push(PlannedEdit::new(into.clone(), report.inverse()));
                if trash_sources {
                    // I link verso la sorgente passano alla destinazione, che
                    // adesso ha il suo testo; se uno non passa, la sorgente
                    // resta dov'è e nessun link resta rotto.
                    if let Err(and) =
                        move_links(host, source, &into, &mut back_edits, &mut expected)
                    {
                        failed.push(Failure::of(source.clone(), and));
                        continue;
                    }
                    // Another writer may have changed the source while we
                    // patched the destination. Keep both copies and surface a
                    // partial merge instead of trashing their newer version.
                    match host.read_document(source) {
                        Ok(latest) if latest == body => match host.trash_document(source) {
                            Ok(entry) => trashed.push((source.clone(), entry)),
                            Err(and) => failed.push(Failure::of(source.clone(), and)),
                        },
                        Ok(_) => failed.push(Failure::of(
                            source.clone(),
                            PluginError::Conflict(Text::message(
                                E_SOURCE_COPIED,
                                vec![Arg::text(A_DOC, source.as_str())],
                            )),
                        )),
                        Err(and) => failed.push(Failure::of(source.clone(), and)),
                    }
                }
            }
            Err(and) => failed.push(Failure::of(source.clone(), and)),
        }
    }
    let notify = if failed.is_empty() {
        Text::message(
            D_MERGE,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
            ],
        )
    } else {
        Text::message(
            D_MERGE_PARTIAL,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
                Arg::text(A_FAILED, why(&failed)),
            ],
        )
    };
    back_edits.reverse();
    let mut steps: Vec<UndoStep> = back_edits.into_iter().map(UndoStep::Edit).collect();
    for (source, entry) in trashed.into_iter().rev() {
        steps.push(UndoStep::Command {
            command: "trash.restore".into(),
            args: serde_json::json!({ "entry": entry.as_str(), "to": source.as_str() }),
        });
    }
    let undo = Undo {
        label: Text::message(
            U_MERGE,
            vec![
                Arg::int(A_COUNT, made as i64),
                Arg::text(A_DOC, into.as_str()),
            ],
        ),
        steps,
    };
    let count = Partial::of(bodies.len(), made, failed);
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(count))
}

/// La sorgente ha riferimenti entranti?
fn has_backlinks(host: &dyn HostApi, source: &DocId) -> Result<bool, PluginError> {
    match host.query_index(IndexQuery::Backlinks {
        target: source.clone(),
        page: None,
    })? {
        IndexResult::Backlinks(backlinks) => Ok(!backlinks.items.is_empty()),
        _ => Err(PluginError::Internal(
            "backlink query returned another result".into(),
        )),
    }
}

fn referenced(source: &DocId) -> PluginError {
    PluginError::Conflict(Text::message(
        E_REFERENCED_SOURCE,
        vec![Arg::text(A_DOC, source.as_str())],
    ))
}

/// Porta su `into` i link che raggiungono `source`, appena il suo testo è
/// entrato in `into`: il piano si chiede adesso e non al preflight, perché la
/// destinazione è cambiata e porta con sé anche i link a sé stessa che la
/// sorgente conteneva. Gli edit dentro la sorgente non servono: va nel
/// cestino. Ogni inverso finisce nell'annulla, dopo quello dell'inserimento.
fn move_links(
    host: &mut dyn HostApi,
    source: &DocId,
    into: &DocId,
    back_edits: &mut Vec<PlannedEdit>,
    expected: &mut BTreeMap<DocId, String>,
) -> Result<(), PluginError> {
    let edits = match host.link_retarget_edits(source, into) {
        Ok(edits) => edits,
        Err(PluginError::Unserved(_)) if has_backlinks(host, source)? => {
            return Err(referenced(source))
        }
        Err(PluginError::Unserved(_)) => return Ok(()),
        Err(and) => return Err(and),
    };
    for edit in edits {
        if &edit.doc == source {
            continue;
        }
        let report = host.apply_edit(&edit.doc, edit.edit)?;
        back_edits.push(PlannedEdit::new(edit.doc.clone(), report.inverse()));
        if let Some(body) = expected.get_mut(&edit.doc) {
            *body = host.read_document(&edit.doc)?;
        }
    }
    Ok(())
}

/// Dove entra un'unione in testa: dopo il BOM e dopo il frontmatter della
/// destinazione, che deve restare la prima cosa del file. Lo dice il modello
/// ([`fub_abi::model::DocumentModel::body_start`]), qualunque sia la sintassi
/// del frontmatter.
/// Il secondo valore è il terminatore che manca quando il frontmatter chiude il
/// file senza andare a capo.
fn merge_head(
    host: &dyn HostApi,
    doc: &DocId,
    source: &str,
) -> Result<(usize, &'static str), PluginError> {
    // Un modello che non viene da `source`: la destinazione è cambiata fra le
    // due letture.
    let start = host.read_model(doc)?.body_start(source).map_err(|_| {
        PluginError::Conflict(Text::message(
            E_SOURCE_CHANGED,
            vec![Arg::text(A_DOC, doc.as_str())],
        ))
    })?;
    Ok(match start {
        None => (text_policy::bom_len(source), ""),
        Some(at) if at == source.len() && !source.ends_with(['\n', '\r']) => {
            (at, text_policy::line_break(source))
        }
        Some(at) => (at, ""),
    })
}

/// I corpi uniti nell'ordine delle sorgenti, senza il loro BOM, col separatore
/// fra i blocchi e mai ai bordi del documento: chi chiama aggiunge il
/// separatore dal lato giusto (testa per prepend, coda per append).
fn join_bodies(bodies: &[(DocId, String)], separator: &str) -> String {
    bodies
        .iter()
        .map(|(_, b)| text_policy::strip_bom(b))
        .collect::<Vec<_>>()
        .join(separator)
}
