//! I comandi ufficiali come `CommandProvider`: il dogfooding del registro
//! (decisione 0009) e della sua descrizione a una macchina (decisione 0010).
//!
//! Tre comandi, scelti perché insieme esercitano tutto ciò che la firma promette
//! e niente che non esista ancora:
//!
//! - `search.open` — nessuna scrittura, un parametro obbligatorio, un effetto
//!   che la shell deve eseguire. È l'azione «apri la ricerca» che finora era
//!   cablata nel frontend: adesso la dichiara il kernel e la palette la trova da
//!   sola.
//! - `selection.wikilink` — il comando che vive nel **contesto di sessione**
//!   (decisione 0007) e scrive con la **modifica chirurgica** (decisione 0008): trasforma il testo
//!   selezionato in un wikilink. È la prova che le tre firme si compongono, e
//!   che la regola dello span della decisione 0007 ha un cliente che ne dipende davvero —
//!   senza span non c'è nessun punto in cui scrivere, e il comando lo dice
//!   invece di indovinare.
//! - `vault.replace` — la sostituzione su N note: parametri di quattro specie,
//!   un piano che si guarda prima di applicarlo, e un raggio dichiarato che dice
//!   a chi invoca di chiedere conferma. È il caso di 7.2 (bulk fix con dry-run) e
//!   la forma che 22.4 chiede per ogni operazione in blocco.
//!
//! Dalla decisione 0013 ci sono anche i **comandi strutturali** — creare, rinominare,
//! cestinare, il giro del cestino — che fino al giro scorso restavano cablati
//! nella shell perché l'`HostApi` non aveva le capacità per farli. Adesso le
//! ha, e questi comandi le usano **dal di fuori**, esattamente come le userebbe
//! un plugin: è il dogfooding che il registro non aveva ancora potuto fare, ed
//! è ciò che ha permesso di togliere sei comandi Tauri dalla shell (§16.6: una
//! feature nuova non deve poter aggiungere un comando Tauri — regola che
//! finché quei sei erano lì valeva solo per le feature che non toccano il
//! vault).
//!
//! E c'è `vault.archive`: simula i passi invocando `note.rename` tramite
//! `run_command`, così il piano è l'unione dei loro. In applicazione verifica
//! tutto il lotto, persiste l'intenzione e sposta una nota alla volta tramite
//! l'host: il recupero dopo un arresto sa riprendere senza sovrascrivere.
//!
//! # Cosa NON c'è qui, e perché
//!
//! Non c'è un comando che **legge** il cestino: `VaultRead::list_trash` è una
//! capacità, ma un elenco non è l'esito di un comando (`CommandOutcome` porta
//! un messaggio e un effetto, non dati). Chi deve mostrare il cestino lo legge
//! dal canale di lettura — la shell dal suo IPC, una view da `list_trash`.

use std::collections::{HashMap, HashSet};

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    CommandSurface, Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo,
    UndoStep,
};
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{Block, DocId, DocumentModel, Span, TaskMarker, FOLDER_PAGE_STEM};
use fub_abi::settings::{SettingEntry, SettingKind, SettingSource, SettingValue};
use fub_abi::text::{Arg, StringCatalog, Strings, Text};
use fub_abi::traits::{
    BacklinkRef, CommandProvider, FolderScope, HostApi, IndexQuery, IndexResult,
};
use serde::{Deserialize, Serialize};

mod recurrence;

/// Id del provider: lo spazio dati e la registrazione, come per le view.
pub const COMMANDS_ID: &str = "fub.commands";

/// Cerca nel vault.
pub const SEARCH_OPEN: &str = "search.open";
/// Trasforma la selezione in un wikilink.
pub const SELECTION_WIKILINK: &str = "selection.wikilink";
/// Sostituisci in tutte le note.
pub const VAULT_REPLACE: &str = "vault.replace";
/// Crea una nota.
pub const NOTES_CREATE: &str = "note.create";
/// Duplica una nota (o un file) accanto all'originale, con un nome libero.
pub const NOTES_DUPLICATE: &str = "note.duplicate";
/// Rinomina/sposta una nota (e i wikilink che la nominano).
pub const NOTES_RENAME: &str = "note.rename";
/// Sposta una nota nel cestino.
pub const NOTES_TRASH: &str = "note.trash";
/// Ripristina una voce del cestino.
pub const TRASH_RESTORE: &str = "trash.restore";
/// Svuota il cestino.
pub const TRASH_EMPTY: &str = "trash.empty";
/// Sposta N note in una cartella con intento durevole e recupero.
pub const VAULT_ARCHIVE: &str = "vault.archive";
/// Rinomina o sposta una cartella intera, con ciò che contiene.
pub const FOLDER_RENAME: &str = "folder.rename";
/// Manda nel cestino una cartella intera, voce per voce.
pub const FOLDER_TRASH: &str = "folder.trash";
/// Fa di una nota la pagina della sua cartella: la rinomina in `_index`,
/// tenendo l'estensione (decisione 0229). Soltanto su richiesta.
pub const NOTES_FOLDER_PAGE: &str = "note.folder_page";
/// «Nuova sottopagina»: la nota diventa la pagina della sua cartella, se non
/// lo è già, e nella cartella nasce una nota nuova.
pub const NOTES_SUBPAGE: &str = "note.subpage";
/// Spunta (o de-spunta) un task.
pub const NOTES_TASK_TOGGLE: &str = "note.task.toggle";
/// Cambia un'impostazione (§11.1).
pub const SETTINGS_SET: &str = "settings.set";
/// Riporta un'impostazione a ciò che valeva prima che qualcuno decidesse.
pub const SETTINGS_RESET: &str = "settings.reset";
/// Tira fuori la configurazione decisa, in JSON.
pub const SETTINGS_EXPORT: &str = "settings.export";
/// Rimette dentro una configurazione esportata.
pub const SETTINGS_IMPORT: &str = "settings.import";
/// Annulla l'ultima operazione annullabile (§13.3).
pub const VAULT_UNDO: &str = "vault.undo";

/// Il `ns` con cui l'esito di `settings.export` arriva alla shell.
pub const SETTINGS_NS: &str = fub_abi::ui::SETTINGS_EXPORT_NS;

/// La chiave del nome di una nota senza nome, nella lingua di chi la crea: è
/// il nome che la descrizione di `note.create` promette. L'estensione la
/// sceglie l'impostazione del core `files.new-note-extension`, la stessa che
/// legge il kernel (vedi [`crate::formats::new_note_extension`]).
const N_UNTITLED: &str = "note.untitled";

/// Il nome di una nota senza nome, dal catalogo di questo componente.
pub(crate) fn untitled(host: &dyn HostApi) -> String {
    Strings::new(&catalog(), "it", &host.user_locale()).render(&Text::key(N_UNTITLED))
}

/// Un comando del core, col titolo e la descrizione presi dal catalogo.
///
/// Le chiavi si **derivano dall'id** — `vault.replace` diventa
/// `vault.replace.title` e `vault.replace.desc` —, e non è pigrizia: era
/// l'alternativa a ottantadue costanti, una per ogni pezzo di prosa di
/// quindici comandi e ventisei parametri, e ottantadue costanti usate una
/// volta sola sono un secondo elenco da tenere allineato al primo. L'id di un
/// comando è già identità stabile per contratto — «cambiarla rompe scorciatoie,
/// macro e automazioni che la nominano» —, quindi derivarne le chiavi non
/// aggiunge nessuna fragilità che non ci fosse.
///
/// Ciò che una chiave derivata perde è il compilatore: una chiave sbagliata non
/// è più un errore di compilazione, è una stringa che scende alla chiave nuda.
/// Al suo posto c'è un presidio che vale di più, perché copre anche le chiavi
/// costanti — `ogni_chiave_dichiarata_ha_una_voce`, in fondo a questo file:
/// cammina sulle spec vere e pretende che ogni chiave che producono abbia una
/// voce in **tutte** le lingue del catalogo.
fn command(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

/// Un parametro, con le chiavi derivate da comando e nome.
fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

/// Un messaggio con un argomento solo: la forma di due terzi delle righe che
/// un comando scrive.
fn one(key: &str, name: &str, value: &str) -> Text {
    Text::message(key, vec![Arg::text(name, value)])
}

/// Un messaggio su due documenti: da chi a chi.
fn two(key: &str, doc: &str, to: &str) -> Text {
    Text::message(key, vec![Arg::text(A_DOC, doc), Arg::text(A_TO, to)])
}

/// Un messaggio con un conteggio solo.
fn count_text(key: &str, n: usize) -> Text {
    Text::message(key, vec![Arg::int(A_COUNT, n as i64)])
}

/// Un messaggio con due conteggi.
fn count_pair(key: &str, a: &str, na: usize, b: &str, nb: usize) -> Text {
    Text::message(key, vec![Arg::int(a, na as i64), Arg::int(b, nb as i64)])
}

/// Il messaggio dell'archiviazione: quante note, in che cartella, e — se ce ne
/// sono — quelle rimaste indietro.
fn archive(key: &str, n: usize, folder: &str, failed: Option<String>) -> Text {
    let mut args = vec![Arg::int(A_COUNT, n as i64), Arg::text(A_FOLDER, folder)];
    if let Some(f) = failed {
        args.push(Arg::text(A_FAILED, f));
    }
    Text::message(key, args)
}

/// Le chiavi delle righe che i comandi scrivono **mentre girano**: gli errori,
/// i riassunti di un piano, e ciò che si dice quando è andata.
///
/// Queste sono costanti e le chiavi delle spec no, e la differenza non è di
/// gusto: una chiave di spec la produce `comando()` a partire dall'id, e chi la
/// legge ha l'id davanti; queste invece stanno sparse in millecinquecento righe
/// di comandi, e scritte a mano si sarebbero scritte diverse due volte.
///
/// I prefissi dicono **quando** si leggono, ed è l'unica cosa che serve sapere
/// per tradurle: `E_` mentre qualcosa non si può fare, `Y_` in simulazione
/// (*se* lo facessi), `P_` nel riassunto di un piano, `D_` a cose fatte.
const E_NO_ACTIVE_PANE: &str = "err.no_active_pane";
const AND_NO_OPEN_NOTES: &str = "err.no_open_note";
const AND_NOTHING_SELECTED: &str = "err.nothing_selected";
const E_EMPTY_SELECTION: &str = "err.empty_selection";
const E_DIRTY_SELECTION: &str = "err.dirty_selection";
const E_SELECTION_OUTSIDE: &str = "err.selection_outside";
const AND_SELECTION_HAS_LINK: &str = "err.selection_has_link";
const E_EMPTY_FIND: &str = "err.empty_find";
const E_EMPTY_TO: &str = "err.empty_to";
const AND_NO_NOTES_GIVEN: &str = "err.no_note_given";
const AND_NOT_IN_TRASH: &str = "err.not_in_trash";
const E_PAGE_AT_ROOT: &str = "err.folder_page_at_root";
const E_PAGE_ALREADY: &str = "err.folder_page_already";
const E_SUBPAGE_NAME: &str = "err.subpage_name";
const AND_TASK_NO_NOTES: &str = "err.task_no_note";
const AND_TASK_NO_POSITION: &str = "err.task_no_position";
const AND_TASK_WRONG_PANE: &str = "err.task_wrong_pane";
const AND_TASK_NO_CARET: &str = "err.task_no_caret";
const AND_TASK_DIRTY_BUFFER: &str = "err.task_dirty_buffer";
const AND_TASK_NOT_FOUND: &str = "err.task_not_found";
const AND_TASK_CHANGED: &str = "err.task_changed";
const AND_NOT_A_TOGGLE: &str = "err.not_a_toggle";
const AND_NOT_A_NUMBER: &str = "err.not_a_number";
const E_EMPTY_FOLDER: &str = "err.empty_folder";
const E_FOLDER_INTO_ITSELF: &str = "err.folder_into_itself";
const E_FOLDER_ROLLBACK: &str = "err.folder_rollback";
const E_UNDECLARED_KEY: &str = "err.undeclared_key";
const E_NOT_PROGRAM_WRITABLE: &str = "err.not_program_writable";
const E_NOT_JSON: &str = "err.not_json";
const E_NOT_AN_OBJECT: &str = "err.not_an_object";

const P_WIKILINK: &str = "plan.wikilink";
const P_WIKILINK_MANY: &str = "plan.wikilink.many";
const P_REPLACE: &str = "plan.replace";
const P_CREATE: &str = "plan.create";
const P_RENAME: &str = "plan.rename";
const P_TRASH: &str = "plan.trash";
const P_RESTORE: &str = "plan.restore";
const P_EMPTY_TRASH: &str = "plan.empty_trash";
const P_ARCHIVE: &str = "plan.archive";
const P_FOLDER_RENAME: &str = "plan.folder_rename";
const P_FOLDER_TRASH: &str = "plan.folder_trash";
const P_TASK_DONE: &str = "plan.task_done";
const P_TASK_TODO: &str = "plan.task_todo";
const P_SETTINGS_SET: &str = "plan.settings_set";
const P_SETTINGS_RESET: &str = "plan.settings_reset";
const P_SETTINGS_IMPORT: &str = "plan.settings_import";

const Y_SETTINGS_SET: &str = "dry.settings_set";
const Y_SETTINGS_RESET: &str = "dry.settings_reset";

const D_WIKILINK: &str = "done.wikilink";
const D_WIKILINK_MANY: &str = "done.wikilink.many";
const D_REPLACE: &str = "done.replace";
const D_REPLACE_PARTIAL: &str = "done.replace_partial";
const D_CREATE: &str = "done.create";
const D_RENAME: &str = "done.rename";
const D_TRASH: &str = "done.trash";
const D_RESTORE: &str = "done.restore";
const D_EMPTY_TRASH: &str = "done.empty_trash";
const D_ARCHIVE: &str = "done.archive";
const D_ARCHIVE_PARTIAL: &str = "done.archive_partial";
const D_FOLDER_RENAME: &str = "done.folder_rename";
const D_FOLDER_RENAME_PARTIAL: &str = "done.folder_rename_partial";
const D_FOLDER_TRASH: &str = "done.folder_trash";
const D_FOLDER_TRASH_PARTIAL: &str = "done.folder_trash_partial";
const D_SETTINGS_SET: &str = "done.settings_set";
const D_SETTINGS_RESET: &str = "done.settings_reset";
const D_SETTINGS_EXPORT: &str = "done.settings_export";
const D_SETTINGS_IMPORT: &str = "done.settings_import";
const D_SETTINGS_IMPORT_PARTIAL: &str = "done.settings_import_partial";
const D_UNDONE: &str = "done.undone";
/// Annullato per intero, ma **l'operazione era già a metà** (§23.14): non è un
/// guasto di adesso, è la notizia che il giorno in cui è stata fatta non tutto
/// era riuscito — e quindi non tutto torna indietro.
const D_UNDONE_OF_PARTIAL: &str = "done.undone_of_partial";
/// L'annullamento **stesso** si è fermato a un passo, e i passi dopo non sono
/// stati provati.
const D_UNDONE_PARTIAL: &str = "done.undone_partial";
const D_NOTHING_TO_UNDO: &str = "done.nothing_to_undo";
const P_UNDO: &str = "plan.undo";

/// Le etichette dell'annullamento: cosa si disferebbe, non cosa è successo.
const U_WIKILINK: &str = "undo.wikilink";
const U_WIKILINK_MANY: &str = "undo.wikilink.many";
const U_REPLACE: &str = "undo.replace";
const U_CREATE: &str = "undo.create";
const U_RENAME: &str = "undo.rename";
const U_TRASH: &str = "undo.trash";
const U_RESTORE: &str = "undo.restore";
const U_ARCHIVE: &str = "undo.archive";
const U_FOLDER_RENAME: &str = "undo.folder_rename";
const U_FOLDER_TRASH: &str = "undo.folder_trash";
const U_TASK: &str = "undo.task";

/// I nomi degli argomenti.
const A_DOC: &str = "doc";
const A_TO: &str = "to";
const A_TEXT: &str = "text";
const A_ENTRY: &str = "entry";
const A_KEY: &str = "key";
const A_VALUE: &str = "value";
const A_FROM: &str = "from";
const A_REASON: &str = "reason";
const A_REASONS: &str = "reasons";
const A_COUNT: &str = "count";
const A_SKIPPED: &str = "skipped";
const A_OCCURRENCES: &str = "occurrences";
const A_NOTES: &str = "notes";
const A_FAILED: &str = "failed";
const A_FOLDER: &str = "folder";
const A_AT: &str = "at";
const A_WHAT: &str = "what";
/// I due conti di un esito parziale (§23.14): quante cose c'erano davanti e
/// quante sono cambiate. Stanno insieme perché una da sola non si legge —
/// «undici» non dice niente finché non c'è «su dodici».
const A_ATTEMPTED: &str = "attempted";
const A_DONE: &str = "done";

mod catalog;
mod folders;
mod notes;
mod provider;
mod rewrite;
mod tasks;
#[cfg(test)]
mod tests;

pub use catalog::catalog;
use folders::{folder_rename, folder_trash};
use notes::{
    notes_create, notes_duplicate, notes_folder_page, notes_rename, notes_subpage, notes_trash,
    plan, skipped_key, trash_empty, trash_restore, vault_undo, why,
};
pub use provider::CoreCommands;
use rewrite::{selection_wikilink, vault_replace};
use tasks::notes_task_toggle;
pub use tasks::occurrences;

// `vault.archive` e `settings.*` restano qui e non in un modulo loro: la guardia
// `a_named_rule_is_declared` (fub-abi) dichiara `parse_value` e `vault_archive`
// per percorso, `crates/fub-features/src/commands.rs::<nome>`.

// ---------------------------------------------------------------------------
// vault.archive — durable batch intent and deterministic recovery
// ---------------------------------------------------------------------------
/// La cartella in cui archiviare, quando non è stata detta.
const ARCHIVE: &str = "Archivio";
const ARCHIVE_RECOVERY: &str = "archive-recovery.json";
const ARCHIVE_SCHEMA: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ArchiveBatch {
    schema_version: u32,
    items: Vec<ArchiveItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ArchiveItem {
    from: DocId,
    to: DocId,
    preimage: Revision,
    status: ArchiveStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "error", rename_all = "snake_case")]
enum ArchiveStatus {
    Pending,
    Done,
    Failed(PluginError),
}

/// The completed source paths and typed failures of an archive recovery pass.
/// Repeated calls after a completed batch return empty vectors.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ArchiveRecovery {
    pub done: Vec<DocId>,
    pub failures: Vec<Failure>,
}

fn archive_store(host: &mut dyn HostApi, batch: &ArchiveBatch) -> Result<(), PluginError> {
    let bytes = serde_json::to_vec(batch)
        .map_err(|error| PluginError::Internal(format!("{ARCHIVE_RECOVERY}: {error}").into()))?;
    host.data_write(ARCHIVE_RECOVERY, &bytes)
}

fn archive_revision(host: &dyn HostApi, doc: &DocId) -> Result<Option<Revision>, PluginError> {
    match host.document_revision(doc) {
        Ok(revision) => Ok(Some(revision)),
        Err(PluginError::NotFound(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

enum ArchivePosition {
    Moved,
    Ready,
    Conflict,
}

fn archive_position(
    host: &dyn HostApi,
    item: &ArchiveItem,
) -> Result<ArchivePosition, PluginError> {
    let source = archive_revision(host, &item.from)?;
    let destination = archive_revision(host, &item.to)?;
    Ok(match (source, destination) {
        (None, Some(revision)) if revision == item.preimage => ArchivePosition::Moved,
        (Some(revision), None) if revision == item.preimage => ArchivePosition::Ready,
        _ => ArchivePosition::Conflict,
    })
}

fn archive_conflict(item: &ArchiveItem) -> PluginError {
    PluginError::Conflict(
        format!(
            "archiviazione di {} in {}: origine o destinazione cambiata",
            item.from, item.to
        )
        .into(),
    )
}

/// Resume one authoritative archive batch. Only an unchanged source with an
/// empty destination can be moved; an already moved item is never moved twice.
/// A conflict is terminal for that item, not for the independent tail.
pub fn recover_archive_batch(host: &mut dyn HostApi) -> Result<ArchiveRecovery, PluginError> {
    let Some(bytes) = host.data_read(ARCHIVE_RECOVERY)? else {
        return Ok(ArchiveRecovery::default());
    };
    let mut batch: ArchiveBatch = serde_json::from_slice(&bytes)
        .map_err(|error| PluginError::Internal(format!("{ARCHIVE_RECOVERY}: {error}").into()))?;
    if batch.schema_version != ARCHIVE_SCHEMA {
        return Err(PluginError::Internal(
            format!(
                "{ARCHIVE_RECOVERY}: unsupported schema {}",
                batch.schema_version
            )
            .into(),
        ));
    }

    let mut report = ArchiveRecovery::default();
    for index in 0..batch.items.len() {
        let item = &batch.items[index];
        let status = match &item.status {
            ArchiveStatus::Done => {
                report.done.push(item.from.clone());
                continue;
            }
            ArchiveStatus::Failed(error) => {
                report
                    .failures
                    .push(Failure::of(item.from.clone(), error.clone()));
                continue;
            }
            ArchiveStatus::Pending => match archive_position(host, item)? {
                ArchivePosition::Moved => ArchiveStatus::Done,
                ArchivePosition::Conflict => ArchiveStatus::Failed(archive_conflict(item)),
                ArchivePosition::Ready => {
                    let result = host.rename_document(&item.from, &item.to);
                    // A backlink update may fail *after* the underlying rename.
                    // Reclassification, not the returned error, decides whether
                    // this move belongs to the completed batch.
                    match archive_position(host, item)? {
                        ArchivePosition::Moved => ArchiveStatus::Done,
                        ArchivePosition::Conflict => ArchiveStatus::Failed(archive_conflict(item)),
                        ArchivePosition::Ready => ArchiveStatus::Failed(
                            result.err().unwrap_or_else(|| archive_conflict(item)),
                        ),
                    }
                }
            },
        };
        match &status {
            ArchiveStatus::Done => report.done.push(batch.items[index].from.clone()),
            ArchiveStatus::Failed(error) => report
                .failures
                .push(Failure::of(batch.items[index].from.clone(), error.clone())),
            ArchiveStatus::Pending => unreachable!(),
        }
        batch.items[index].status = status;
        archive_store(host, &batch)?;
    }
    host.data_remove(ARCHIVE_RECOVERY)?;
    Ok(report)
}

/// Dry-run composes nested rename plans; apply first records every revision and
/// destination, then drives the same recovery path used after a restart.
fn vault_archive(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let docs = args
        .documents("docs")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let folder = args
        .text("folder")
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .unwrap_or(ARCHIVE)
        .trim_end_matches('/')
        .to_string();

    if mode.is_dry_run() {
        let mut plans: Vec<CommandPlan> = Vec::new();
        for doc in &docs {
            let name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
            let to = format!("{folder}/{name}");
            if to == doc.as_str() {
                continue;
            }
            let args = serde_json::json!({ "doc": doc.as_str(), "to": to });
            if let Ok(CommandOutcome {
                effect: CommandEffect::Plan(plan),
                ..
            }) = host.run_command(NOTES_RENAME, args)
            {
                plans.push(plan);
            }
        }
        // The host propagates dry-run to the nested renames; combine their
        // plans, preserving the first appearance of each affected document.
        let mut touched_docs: Vec<DocId> = Vec::new();
        let mut seen: HashSet<DocId> = HashSet::new();
        let mut edits: Vec<PlannedEdit> = Vec::new();
        for plan in plans {
            for d in plan.docs {
                if seen.insert(d.clone()) {
                    touched_docs.push(d);
                }
            }
            edits.extend(plan.edits);
        }
        let summary = archive(P_ARCHIVE, docs.len(), &folder, None);
        let mut plan = CommandPlan::of_edits(summary, edits);
        for d in touched_docs {
            plan = plan.with_doc(d);
        }
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    // An earlier invocation owns the single intent slot until recovery has
    // classified every item. Never replace that record with the new batch, and
    // never hide a terminal conflict behind the outcome of a later request.
    let previous = recover_archive_batch(host)?;
    if !previous.failures.is_empty() {
        let made = previous.done.len();
        let total = made + previous.failures.len();
        let notify = archive(
            D_ARCHIVE_PARTIAL,
            made,
            &folder,
            Some(why(&previous.failures)),
        );
        return Ok(CommandOutcome::notify(notify).partially(Partial::of(
            total,
            made,
            previous.failures,
        )));
    }

    let mut batch = ArchiveBatch {
        schema_version: ARCHIVE_SCHEMA,
        items: Vec::new(),
    };
    let mut failed = Vec::new();
    let mut candidates = Vec::new();
    let mut sources = HashMap::<DocId, usize>::new();
    let mut destinations = HashMap::<DocId, usize>::new();
    for doc in &docs {
        let name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        let path = format!("{folder}/{name}");
        if path == doc.as_str() {
            continue;
        }
        let to = DocId::new(path);
        *sources.entry(doc.clone()).or_default() += 1;
        *destinations.entry(to.clone()).or_default() += 1;
        candidates.push((doc.clone(), to));
    }
    for (doc, to) in candidates {
        // Inspect *both* paths of *every* candidate before writing an intent.
        // In particular an occupied destination cannot be silently replaced.
        let source = archive_revision(host, &doc);
        let destination = archive_revision(host, &to);
        let repeated_source = sources[&doc] > 1;
        let repeated_destination = destinations[&to] > 1;
        let error = if repeated_source || repeated_destination || to == doc {
            Some(PluginError::Conflict(
                format!("archiviazione ambigua: {} → {}", doc, to).into(),
            ))
        } else {
            match (
                source.as_ref().map(Option::as_ref),
                destination.as_ref().map(Option::as_ref),
            ) {
                (Err(error), _) | (_, Err(error)) => Some(error.clone()),
                (Ok(None), _) => Some(PluginError::NotFound(doc.to_string().into())),
                (_, Ok(Some(_))) => Some(PluginError::AlreadyExists(to.to_string().into())),
                (Ok(Some(_)), Ok(None)) => None,
            }
        };
        if let Some(error) = error {
            failed.push(Failure::of(doc.clone(), error));
        } else if let Ok(Some(preimage)) = source {
            batch.items.push(ArchiveItem {
                from: doc.clone(),
                to,
                preimage,
                status: ArchiveStatus::Pending,
            });
        }
    }

    // A bad member rejects the *entire* fresh batch; the failures still name
    // every invalid member, while successful members remain untouched.
    let report = if failed.is_empty() && !batch.items.is_empty() {
        archive_store(host, &batch)?;
        recover_archive_batch(host)?
    } else {
        ArchiveRecovery::default()
    };
    let made = report.done.len();
    failed.extend(report.failures);
    let mut back = Vec::with_capacity(made);
    for doc in report.done.into_iter().rev() {
        let name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        let to = format!("{folder}/{name}");
        back.push(UndoStep::Command {
            command: NOTES_RENAME.into(),
            args: serde_json::json!({ "doc": to, "to": doc.as_str() }),
        });
    }
    let notify = if failed.is_empty() {
        archive(D_ARCHIVE, made, &folder, None)
    } else {
        archive(D_ARCHIVE_PARTIAL, made, &folder, Some(why(&failed)))
    };
    let count = Partial::of(docs.len(), made, failed);
    Ok(CommandOutcome::notify(notify)
        .undoable(Undo {
            label: archive(U_ARCHIVE, made, &folder, None),
            steps: back,
        })
        .partially(count))
}

// ---------------------------------------------------------------------------
// settings.* (§11.1)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
/// Le impostazioni **dichiarate**, chieste al canale dati come le chiederebbe
/// la shell.
///
/// Passa da `query_index` e non da una capacità nuova perché è la regola della
/// decisione 0013: un elenco è *dati*, e i dati hanno un canale solo. Ne segue
/// una proprietà che serve qui e non altrove — un comando che elenca le
/// impostazioni vede **le stesse righe** che vede il pannello, comprese quelle
/// dei plugin di terzi, senza conoscerne nessuna.
fn declared(host: &dyn HostApi) -> Result<Vec<SettingEntry>, PluginError> {
    match host.query_index(IndexQuery::Settings { plugin: None })? {
        IndexResult::Settings(entries) => Ok(entries),
        other => Err(off_topic("delle impostazioni", &other)),
    }
}

/// Una risposta di `query_index` di un'altra specie da quella chiesta: è un
/// guasto dell'host, non dell'utente.
fn off_topic(expected: &str, other: &IndexResult) -> PluginError {
    PluginError::Internal(
        format!(
            "risposta fuori tema: attese {expected}, arrivato {}",
            other.kind_name()
        )
        .into(),
    )
}

/// Legge un valore **dalla stringa**, secondo la specie che la chiave dichiara.
///
/// Un comando si compila da una riga di comando, da un JSON di automazione o da
/// un modello (22.4): il suo `value` è testo, e a dargli un tipo è lo schema —
/// che è l'unico posto in cui quel tipo è scritto. È la stessa mossa dei
/// `ParamSpec`, un livello più in là: qui la specie non la dichiara il comando,
/// la dichiara la chiave che si sta toccando.
fn parse_value(kind: &SettingKind, raw: &str) -> Result<SettingValue, PluginError> {
    let bad = |key: &str| PluginError::BadArgs(one(key, A_VALUE, raw));
    match kind {
        SettingKind::Toggle { .. } => match raw.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "on" | "sì" | "si" => Ok(SettingValue::Toggle(true)),
            "false" | "0" | "off" | "no" => Ok(SettingValue::Toggle(false)),
            _ => Err(bad(AND_NOT_A_TOGGLE)),
        },
        SettingKind::Number { .. } => raw
            .trim()
            .parse::<f64>()
            .map(SettingValue::Number)
            .map_err(|_| bad(AND_NOT_A_NUMBER)),
        SettingKind::Text { .. } | SettingKind::Choice { .. } => {
            Ok(SettingValue::Text(raw.to_string()))
        }
        // La virgola e non il JSON: chi scrive `a, b` in un campo di testo sta
        // scrivendo due voci, e chiedergli le virgolette vorrebbe dire fargli
        // scrivere JSON dentro una stringa di un JSON.
        SettingKind::List { .. } => Ok(SettingValue::List(
            raw.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        )),
    }
}

/// La riga di una chiave, o l'errore che dice che non esiste.
fn entry_of(host: &dyn HostApi, key: &str) -> Result<SettingEntry, PluginError> {
    declared(host)?
        .into_iter()
        .find(|and| and.spec.key == key)
        .ok_or_else(|| PluginError::BadArgs(one(E_UNDECLARED_KEY, A_KEY, key)))
}

/// Il cancello della chiave, applicato **prima di sapere in che modo si sta
/// girando**.
///
/// Un comando è un programma, quindi passa dai due cancelli come chiunque
/// altro; ciò che questa funzione aggiunge è che il rifiuto arrivi **anche in
/// simulazione**. Il gate vero resta quello dell'host
/// ([`HostApi::set_setting`]), che è dove il non-scrivere è garantito e non
/// promesso: qui si guadagna solo che il piano dica ciò che succederebbe
/// davvero, che è tutto ciò per cui un piano esiste (decisione 0010).
fn deny_if_not_writable(entry: &SettingEntry) -> Result<(), PluginError> {
    if entry.spec.program_writable {
        return Ok(());
    }
    Err(PluginError::PermissionDenied(one(
        E_NOT_PROGRAM_WRITABLE,
        A_KEY,
        &entry.spec.key,
    )))
}

fn settings_set(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = args.text("key").expect("parametro obbligatorio");
    let raw = args.text("value").expect("parametro obbligatorio");
    let entry = entry_of(host, key)?;
    deny_if_not_writable(&entry)?;
    let value = parse_value(&entry.spec.kind, raw)?;
    // Il piano deve attraversare lo stesso cancello dell'applicazione: il kernel
    // lo ripeterà in `set_setting`, ma il dry-run non arriva fin lì.
    if let Some(why) = entry.spec.kind.rejects(&value) {
        return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
    }

    // La simulazione dice cosa cambierebbe **e da cosa**: un piano senza
    // documenti sarebbe vuoto (un'impostazione non è una nota), quindi ciò che
    // si mostra è il messaggio. È il limite dichiarato di `CommandPlan` su
    // questo raggio, non una dimenticanza.
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            Y_SETTINGS_SET,
            vec![
                Arg::text(A_KEY, key),
                Arg::text(A_FROM, display(&entry.value)),
                Arg::text(A_VALUE, display(&value)),
            ],
        ))
        .with_effect(CommandEffect::Plan(CommandPlan {
            summary: one(P_SETTINGS_SET, A_KEY, key),
            ..CommandPlan::default()
        })));
    }
    host.set_setting(key, value.clone())?;
    Ok(CommandOutcome::notify(Text::message(
        D_SETTINGS_SET,
        vec![Arg::text(A_KEY, key), Arg::text(A_VALUE, display(&value))],
    )))
}

fn settings_reset(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = args.text("key").expect("parametro obbligatorio");
    let entry = entry_of(host, key)?;
    deny_if_not_writable(&entry)?;
    if mode.is_dry_run() {
        return Ok(CommandOutcome::notify(Text::message(
            Y_SETTINGS_RESET,
            vec![
                Arg::text(A_KEY, key),
                Arg::text(A_VALUE, display(&entry.value)),
            ],
        ))
        .with_effect(CommandEffect::Plan(CommandPlan {
            summary: one(P_SETTINGS_RESET, A_KEY, key),
            ..CommandPlan::default()
        })));
    }
    host.reset_setting(key)?;
    Ok(CommandOutcome::notify(one(D_SETTINGS_RESET, A_KEY, key)))
}

/// Esporta ciò che **qualcuno ha deciso**, e non i default.
///
/// I default non sono una configurazione: sono ciò che vale quando non c'è una
/// configurazione, e portarli dentro un export vorrebbe dire che reimportarlo
/// **decide** tutto ciò che nessuno aveva deciso — cioè congela per sempre i
/// default di oggi, compresi quelli che cambieranno.
fn settings_export(host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    let mut decise = serde_json::Map::new();
    for entry in declared(host)? {
        if entry.source != SettingSource::Default {
            decise.insert(
                entry.spec.key.clone(),
                serde_json::to_value(&entry.value)
                    .map_err(|and| PluginError::Internal(and.to_string().into()))?,
            );
        }
    }
    let count = decise.len();
    Ok(
        CommandOutcome::notify(count_text(D_SETTINGS_EXPORT, count)).with_effect(
            CommandEffect::Custom {
                ns: SETTINGS_NS.to_string(),
                payload: serde_json::Value::Object(decise),
            },
        ),
    )
}

/// Rimette dentro una configurazione esportata, **una chiave alla volta**.
///
/// Non è tutto-o-niente, ed è una scelta: un file che nomina una chiave di un
/// plugin che non c'è più non deve impedire di applicare le altre venti. Ciò
/// che non entra viene **contato e detto** — che è la differenza fra un import
/// parziale e un import parziale in silenzio.
fn settings_import(
    args: Args,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let raw = args.text("json").expect("parametro obbligatorio");
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|and| PluginError::BadArgs(one(E_NOT_JSON, A_REASON, &and.to_string())))?;
    let object = parsed
        .as_object()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NOT_AN_OBJECT)))?;

    let declared: std::collections::BTreeMap<String, SettingEntry> = declared(host)?
        .into_iter()
        .map(|and| (and.spec.key.clone(), and))
        .collect();

    let before = object.len();
    let (mut applied, mut skipped): (usize, Vec<Failure>) = (0, Vec::new());
    for (key, raw_value) in object {
        let Some(entry) = declared.get(key) else {
            skipped.push(skipped_key(
                key,
                PluginError::BadArgs("nessuno la declare".into()),
            ));
            continue;
        };
        let value: SettingValue = match serde_json::from_value(raw_value.clone()) {
            Ok(value) => value,
            Err(_) => {
                skipped.push(skipped_key(
                    key,
                    PluginError::BadArgs("valore illeggibile".into()),
                ));
                continue;
            }
        };
        if let Some(why) = entry.spec.kind.rejects(&value) {
            skipped.push(skipped_key(key, PluginError::BadArgs(why.into())));
            continue;
        }
        // Il cancello della chiave si applica **anche in simulazione**, o il
        // piano direbbe una cosa e l'applicazione ne farebbe un'altra: senza
        // questa riga un dry-run su un file che nomina `privacy.telemetry`
        // risponde «2 applicate», e l'apply subito dopo «1 applicata, 1
        // saltata». Un piano che non è ciò che succederebbe non è un piano
        // (decisione 0010).
        if let Err(and) = deny_if_not_writable(entry) {
            skipped.push(skipped_key(key, and));
            continue;
        }
        if mode.is_dry_run() {
            applied += 1;
            continue;
        }
        match host.set_setting(key, value) {
            Ok(()) => applied += 1,
            // Il rifiuto più importante è questo, e va **detto**: un file di
            // impostazioni che passa di mano non sposta le chiavi che un
            // programma non può scrivere.
            Err(and) => skipped.push(skipped_key(key, and)),
        }
    }

    let message = if skipped.is_empty() {
        count_text(D_SETTINGS_IMPORT, applied)
    } else {
        Text::message(
            D_SETTINGS_IMPORT_PARTIAL,
            vec![
                Arg::int(A_COUNT, applied as i64),
                Arg::int(A_SKIPPED, skipped.len() as i64),
                // Le ragioni per cui una chiave è saltata attraversano come
                // **dato**, non come prosa da tradurre, e restano in italiano.
                // Non è pigrizia: metà di quelle ragioni non sono di questo
                // file — vengono da `SettingKind::rejects`, che sta nel
                // **contratto** e scrive italiano cablato. Finché quel buco non
                // ha un proprietario (nessun catalogo appartiene all'ABI),
                // tradurre le due righe di qui lascerebbe una frase mezza in
                // una lingua e mezza nell'altra, che è peggio di una
                // dichiaratamente in una sola.
                Arg::text(A_REASONS, why(&skipped)),
            ],
        )
    };
    let outcome = CommandOutcome::notify(message).partially(Partial::of(before, applied, skipped));
    Ok(if mode.is_dry_run() {
        outcome.with_effect(CommandEffect::Plan(CommandPlan {
            summary: count_text(P_SETTINGS_IMPORT, applied),
            ..CommandPlan::default()
        }))
    } else {
        outcome
    })
}

/// Un valore dentro un messaggio, **come dato**.
///
/// Diceva «acceso» e «spento» e «niente», cioè tre parole italiane che
/// finivano dentro una frase composta altrove — e una parola dentro una frase è
/// la cosa che il motore dei template della 0040 non sa comporre: un argomento
/// è `ArgValue`, e `ArgValue::Text` è dato per definizione («se andasse
/// tradotto sarebbe una chiave, non un argomento»).
///
/// Quindi un interruttore si mostra come `true`/`false`, che è la stessa cosa
/// che chi lo cambia scrive in `settings.set` e nel file: non è una resa più
/// povera, è la stessa in tutte le lingue. L'elenco vuoto è un trattino lungo,
/// che non è parola di nessuno.
fn display(value: &SettingValue) -> String {
    match value {
        SettingValue::Toggle(v) => format!("`{v}`"),
        SettingValue::Number(n) => n.to_string(),
        SettingValue::Text(t) => format!("`{t}`"),
        SettingValue::List(the) if the.is_empty() => "—".into(),
        SettingValue::List(the) => the.join(", "),
    }
}
