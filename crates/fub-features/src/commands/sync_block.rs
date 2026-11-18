//! `note.block.sync`: il blocco sincronizzato (E14). Un blocco riceve il suo
//! id, se non ce l'ha, e la nota scelta riceve in fondo la sua trasclusione,
//! `![[Nota#^id]]`: il formato che Obsidian legge, nessun segno nuovo. Da lì
//! il blocco si scrive da tutte e due le parti, perché la trasclusione viva di
//! un blocco nella nota che la ospita è il blocco stesso (`transclusion.ts`).
//!
//! Sono due scritture — l'id nella nota del blocco, la trasclusione in quella
//! scelta — e vanno **tutte e due o nessuna**: un [`WritePlan`] (A-10) che
//! controlla ogni revisione prima di scrivere e disfa se un passo cade. Un
//! annulla solo le rimette tutte e due; se una è cambiata dopo, non tocca
//! niente e lo dice.
//!
//! Senza `to` il comando dà soltanto l'id al blocco: è la strada di chi scrive
//! il riferimento nel proprio testo (il «/» «Blocco di un'altra nota», il
//! completamento `[[^^`), che dice l'id da scrivere (`id`) per saperlo prima.
//!
//! Che cosa sia il blocco lo dice chi chiama, in byte (`at`) e col testo letto
//! (`text`), come per «Sposta in…»: se fra quei byte c'è altro, la nota è
//! cambiata e non si scrive niente.

use super::move_block::{
    blocks_in, caret_range, eol_of, fresh_id, given_bytes, insertion, is_item, line_range, read,
    reference, request_of, IdPlace, Read, E_BLOCK_DIRTY, E_BLOCK_NOT_FOUND, E_BLOCK_NO_CARET,
    E_BLOCK_RANGE,
};
use super::*;

use fub_abi::command::{AppliedPlan, Reversal, WritePlan, WriteStep};
use fub_abi::format::LinkInsert;
use fub_abi::model::LinkTarget;

pub(super) const E_SYNC_NO_CARET: &str = "err.block_sync.no_caret";
pub(super) const E_SYNC_DIRTY: &str = "err.block_sync.dirty";
pub(super) const E_SYNC_NOT_FOUND: &str = "err.block_sync.not_found";
pub(super) const E_SYNC_CHANGED: &str = "err.block_sync.changed";
pub(super) const E_SYNC_SAME: &str = "err.block_sync.same";
pub(super) const E_SYNC_MANY: &str = "err.block_sync.many";
pub(super) const E_SYNC_ID: &str = "err.block_sync.id";
pub(super) const E_SYNC_ID_TAKEN: &str = "err.block_sync.id_taken";
pub(super) const E_SYNC_OTHER_ID: &str = "err.block_sync.other_id";
pub(super) const P_BLOCK_SYNC: &str = "plan.block_sync";
pub(super) const U_BLOCK_SYNC: &str = "undo.block_sync";
pub(super) const U_BLOCK_ID: &str = "undo.block_id";
/// L'esito: il blocco sincronizzato in fondo a `{to}`.
pub(super) const D_BLOCK_SYNC: &str = "done.block_sync";
/// L'esito senza `to`: il blocco ha ricevuto l'id `{id}`.
pub(super) const D_BLOCK_ID: &str = "done.block_id";
const A_ID: &str = "id";

/// Quanto può essere lungo un id dato da chi chiama: quelli di Fub sono sei
/// caratteri, quelli scritti a mano di rado più di qualche parola.
const ID_MAX: usize = 64;

pub(super) fn notes_block_sync(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let context = host.active_context();
    let doc = crate::formats::document_with(&args, "doc", &*host, fub_abi::options::source::PROSE)?
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_OPEN_NOTES)))?;
    let to = crate::formats::document_with(&args, "to", &*host, fub_abi::options::source::PROSE)?;
    let asked_id = args
        .text(A_ID)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| id.strip_prefix('^').unwrap_or(id).to_string());
    if let Some(id) = &asked_id {
        if !valid_id(id) {
            return Err(PluginError::BadArgs(one(E_SYNC_ID, A_ID, id)));
        }
    }
    if to.as_ref() == Some(&doc) {
        return Err(PluginError::BadArgs(Text::key(E_SYNC_SAME)));
    }
    // Si scrive un id nel testo e un riferimento in un altro: due sorgenti in
    // prosa.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    if let Some(to) = &to {
        crate::formats::require(host, to, fub_abi::options::source::PROSE)?;
    }

    let from = read(host, &doc)?;
    let range = match args.numbers("at") {
        Some(at) => {
            let (start, end) = given_bytes(&at)?;
            // Prima di ogni altra domanda: se fra quei byte c'è altro, la nota
            // è cambiata e non si scrive niente.
            if let Some(expected) = args.text(A_TEXT) {
                if from.source.get(start..end) != Some(expected) {
                    return Err(PluginError::Conflict(one(
                        E_SYNC_CHANGED,
                        A_DOC,
                        doc.page_name(),
                    )));
                }
            }
            line_range(&from.source, start, end)
                .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_RANGE)))?
        }
        None => caret_range(context.as_ref(), &doc, &from).map_err(caret_error)?,
    };

    let target = match &to {
        Some(to) => Some((to.clone(), read(host, to)?)),
        None => None,
    };
    let planned = plan_sync(host, &doc, &from, range, asked_id, target.as_ref())?;

    if mode.is_dry_run() {
        let edits = planned
            .plan
            .steps
            .iter()
            .filter_map(|step| match step {
                WriteStep::Edit(edit) => Some(edit.clone()),
                _ => None,
            })
            .collect();
        let title = match &to {
            Some(to) => one(P_BLOCK_SYNC, A_TO, to.page_name()),
            None => one(D_BLOCK_ID, A_ID, &planned.id),
        };
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(title, edits))));
    }

    if planned.plan.steps.is_empty() {
        // Il blocco ha già quell'id e non c'è una nota da scrivere: niente da
        // fare, e niente da annullare.
        return Ok(CommandOutcome::done());
    }
    let applied = planned.plan.apply(host).map_err(PluginError::from)?;
    let undo_title = match &to {
        Some(to) => one(U_BLOCK_SYNC, A_TO, to.page_name()),
        None => one(U_BLOCK_ID, A_DOC, doc.page_name()),
    };
    Ok(CommandOutcome::notify(planned.done).undoable(undo_of(&applied, undo_title)))
}

/// Gli errori del cursore di «Sposta in…» detti per questo gesto.
fn caret_error(error: PluginError) -> PluginError {
    let PluginError::BadArgs(Text::Message(message)) = &error else {
        return error;
    };
    let key = match message.key.as_str() {
        E_BLOCK_NO_CARET => E_SYNC_NO_CARET,
        E_BLOCK_DIRTY => E_SYNC_DIRTY,
        E_BLOCK_NOT_FOUND => E_SYNC_NOT_FOUND,
        _ => return error,
    };
    PluginError::BadArgs(Text::key(key))
}

/// Un id di blocco come il kernel lo legge: lettere, cifre e trattini.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// `^id` compare in `source` come segno di un blocco: seguito da un carattere
/// che non sta in un id (o dalla fine).
fn id_used(source: &str, id: &str) -> bool {
    let marker = format!("^{id}");
    source.match_indices(&marker).any(|(at, _)| {
        source[at + marker.len()..]
            .bytes()
            .next()
            .is_none_or(|b| !(b.is_ascii_alphanumeric() || b == b'-'))
    })
}

/// Il piano pronto, l'id del blocco e la frase di quando sarà fatto.
struct Planned {
    plan: WritePlan,
    id: String,
    done: Text,
}

fn plan_sync(
    host: &dyn HostApi,
    doc: &DocId,
    from: &Read,
    (start, end): (usize, usize),
    asked_id: Option<String>,
    target: Option<&(DocId, Read)>,
) -> Result<Planned, PluginError> {
    let (count, place) = blocks_in(&from.model.body, start, end);
    if count != 1 {
        return Err(PluginError::BadArgs(Text::key(E_SYNC_MANY)));
    }
    let own = from
        .model
        .anchors
        .iter()
        .find(|anchor| anchor.marker.start >= start && anchor.marker.end <= end)
        .map(|anchor| anchor.id.clone());
    let (id, id_edit) = match (own, asked_id) {
        (Some(own), Some(asked)) if own != canonical(&asked) => {
            // Chi chiama ha letto un altro blocco, o un'altra versione di
            // questo: il riferimento che scriverebbe non porterebbe qui.
            return Err(PluginError::Conflict(Text::message(
                E_SYNC_OTHER_ID,
                vec![Arg::text(A_DOC, doc.page_name()), Arg::text(A_ID, own)],
            )));
        }
        (Some(own), _) => (own, None),
        (None, Some(asked)) => {
            if id_used(&from.source, &asked) {
                return Err(PluginError::Conflict(Text::message(
                    E_SYNC_ID_TAKEN,
                    vec![
                        Arg::text(A_DOC, doc.page_name()),
                        Arg::text(A_ID, asked.as_str()),
                    ],
                )));
            }
            let edit = id_insertion(&from.source, start, end, place, &asked);
            (asked, Some(edit))
        }
        (None, None) => {
            let mut sources = vec![from.source.as_str()];
            if let Some((_, to)) = target {
                sources.push(to.source.as_str());
            }
            let id = fresh_id(host, &sources)?;
            let edit = id_insertion(&from.source, start, end, place, &id);
            (id, Some(edit))
        }
    };

    let mut plan = WritePlan::new();
    let done = match target {
        Some((to_doc, to)) => {
            let link = LinkInsert {
                target: LinkTarget::Wiki {
                    page: reference(host, doc)?,
                    heading: None,
                    block: Some(id.clone()),
                },
                label: None,
                embed: true,
            };
            let written = crate::formats::link_text(host, to_doc, &link)?;
            let at = to.source.len();
            let edit = TextEdit::insert(at, insertion(&to.source, at, &written));
            plan = plan.edit(to_doc.clone(), request_of(to.revision.clone(), vec![edit]));
            Text::message(
                D_BLOCK_SYNC,
                vec![
                    Arg::text(A_TO, to_doc.page_name()),
                    Arg::text(A_ID, id.as_str()),
                ],
            )
        }
        None => one(D_BLOCK_ID, A_ID, &id),
    };
    if let Some(edit) = id_edit {
        plan = plan.edit(doc.clone(), request_of(from.revision.clone(), vec![edit]));
    }
    Ok(Planned { plan, id, done })
}

/// L'id com'è confrontato dal kernel: senza il `^` e in minuscolo.
fn canonical(id: &str) -> String {
    fub_abi::model::canonical_anchor(id)
}

/// La modifica che scrive `^id` dove il kernel lo legge, toccando soltanto
/// quel punto: in coda all'ultima riga (testo, titolo), in coda alla prima
/// frase di una voce (prima dei figli), o su una riga sua dopo una riga vuota
/// (codice, tabella, citazione…). È la regola di `blocks/anchor.ts` nel client
/// e di «Sposta in…».
fn id_insertion(
    source: &str,
    start: usize,
    end: usize,
    place: Option<IdPlace>,
    id: &str,
) -> TextEdit {
    let body = &source[start..end];
    let marker = format!("^{id}");
    match place.unwrap_or(IdPlace::OwnLine) {
        IdPlace::OwnLine => {
            let eol = eol_of(source);
            TextEdit::insert(end, format!("{eol}{eol}{marker}"))
        }
        IdPlace::Tail => {
            let at = start + body.trim_end().len();
            TextEdit::insert(at, format!(" {marker}"))
        }
        IdPlace::Item => {
            // La prima frase della voce: le righe fino a una vuota o a una
            // voce figlia.
            let mut sentence_end = 0;
            let mut offset = 0;
            for (n, line) in body.split('\n').enumerate() {
                if n > 0 && (line.trim().is_empty() || is_item(line)) {
                    break;
                }
                sentence_end = offset + line.trim_end().len();
                offset += line.len() + 1;
            }
            TextEdit::insert(start + sentence_end, format!(" {marker}"))
        }
    }
}

/// L'annullamento del piano: per ogni nota l'inverso della sua modifica, in un
/// passo solo.
fn undo_of(applied: &AppliedPlan, title: Text) -> Undo {
    applied.undo(title, |reversal| match reversal {
        Reversal::Trash { doc } => UndoStep::Command {
            command: NOTES_TRASH.to_string(),
            args: serde_json::json!({ "doc": doc.as_str() }),
        },
        Reversal::Rename { from, to } => UndoStep::Command {
            command: NOTES_RENAME.to_string(),
            args: serde_json::json!({ "doc": from.as_str(), "to": to.as_str() }),
        },
    })
}

#[cfg(test)]
#[path = "sync_block_tests.rs"]
mod tests;
