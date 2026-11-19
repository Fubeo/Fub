//! «Porta su una lavagna» e «Porta in una nota» (E25, T48): i blocchi di una
//! nota diventano schede di una lavagna, e le schede di una lavagna blocchi di
//! una nota.
//!
//! Sono sempre due file con un annulla solo: la nota da cui i blocchi partono
//! (o in cui arrivano) e la lavagna. Il comando li consegna in un
//! [`WritePlan`] (A-10, T32a), che controlla ogni revisione e ogni nome libero
//! prima di scrivere e disfa all'indietro se un passo cade; l'annullamento è
//! una voce sola ([`AppliedPlan::undo`]), che rimette i due file o, se uno è
//! cambiato dopo, non tocca niente e lo dice.
//!
//! # Dalla nota alla lavagna (`canvas.from_note`)
//!
//! Chi chiama dice i byte della scelta (`at`, inizio e fine, e `text`, ciò che
//! ci ha letto): se la nota è cambiata non si muove niente. Senza `at` vale la
//! selezione della nota attiva, o il blocco del cursore. Una scheda per blocco,
//! nello stesso ordine, una sotto l'altra:
//!
//! - un blocco è uno di primo livello della nota, o una voce di primo livello
//!   di un elenco; ciò che sta fra due blocchi resta col primo, così nessun
//!   byte della scelta si perde;
//! - un titolo porta con sé la sua sezione, fino al titolo dopo dello stesso
//!   livello o più alto, anche oltre la scelta: è una scheda sola;
//! - un embed da solo nel suo blocco (`![[Contratto.pdf#page=3|640x300]]`) è
//!   una scheda di file sullo **stesso** file, con la parte e la misura
//!   dell'embed; un embed che non si risolve resta testo;
//! - il resto è una scheda di testo, col suo Markdown com'è scritto.
//!
//! Senza `to` nasce una lavagna accanto alla nota, col nome della nota (o
//! `name` in `folder`); con `to` le schede vanno in quella lavagna, a destra di
//! ciò che c'è. I blocchi lasciano la nota; con `keep` restano (la copia del
//! trascinamento con Ctrl).
//!
//! # Dalla lavagna alla nota (`canvas.to_note`)
//!
//! Le schede scelte (`ids`, di serie tutte) diventano blocchi in colonna, da in
//! alto a sinistra a in basso a destra; le schede di un gruppo stanno insieme,
//! sotto il nome del gruppo scritto come titolo. Una scheda di testo dà il suo
//! testo, una di file il suo embed, una di link il suo indirizzo. I fili
//! diventano link, in una riga `→ …` sotto la scheda da cui partono: verso una
//! scheda di testo un link al blocco (`[[#^id]]`, che le dà l'id se non ce
//! l'ha), verso un file un link al file, verso un gruppo un link al suo titolo.
//! Due voci di elenco una dopo l'altra restano un elenco solo. Così andata e
//! ritorno danno lo stesso testo.
//!
//! Senza `to` nasce una nota accanto alla lavagna, col nome della lavagna; con
//! `to` i blocchi vanno in quella nota, all'inizio della riga `at` (di serie in
//! fondo). Le schede lasciano la lavagna (coi fili che le toccano); con `keep`
//! restano.

use std::collections::{BTreeMap, HashMap, HashSet};

use fub_abi::command::{
    AppliedPlan, Args, CommandEffect, CommandOutcome, CommandPlan, InvokeMode, Reversal, Undo,
    UndoStep, WritePlan, WriteStep,
};
use fub_abi::edit::{EditRequest, Fnv1a, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::format::LinkInsert;
use fub_abi::model::{Block, DocId, DocumentModel, LinkTarget, Span};
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, Naming};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{HostApi, IndexQuery, IndexResult};
use fub_canvas_core::commit::Core;
use fub_canvas_core::model::{Canvas, CanvasNode, CanvasNodeType};
use fub_canvas_core::ops::{compile, AddCardArgs, CanvasOp};

use super::*;

/// La capacità di una nota in prosa: si tagliano e si incollano righe.
const PROSE: &str = fub_abi::options::source::PROSE;

/// L'inverso di «crea» è «cestina», come per `canvas.create`.
const TRASH: &str = "note.trash";

pub(super) const AT: &str = "at";
pub(super) const TEXT: &str = "text";
pub(super) const TO: &str = "to";
pub(super) const KEEP: &str = "keep";

const P_FROM_NOTE: &str = "canvas.from_note.p_plan";
const N_FROM_NOTE_MOVED: &str = "canvas.from_note.n_moved";
const N_FROM_NOTE_COPIED: &str = "canvas.from_note.n_copied";
const U_FROM_NOTE: &str = "canvas.from_note.u_undo";
const E_FROM_NO_NOTE: &str = "canvas.from_note.e_no_note";
const E_FROM_NOTHING: &str = "canvas.from_note.e_nothing";
const E_FROM_DIRTY: &str = "canvas.from_note.e_dirty";
const E_FROM_RANGE: &str = "canvas.from_note.e_range";
const E_FROM_CHANGED: &str = "canvas.from_note.e_changed";

const P_TO_NOTE: &str = "canvas.to_note.p_plan";
const N_TO_NOTE_MOVED: &str = "canvas.to_note.n_moved";
const N_TO_NOTE_COPIED: &str = "canvas.to_note.n_copied";
const U_TO_NOTE: &str = "canvas.to_note.u_undo";
const E_TO_EMPTY: &str = "canvas.to_note.e_empty";
const E_TO_UNKNOWN: &str = "canvas.to_note.e_unknown";
const E_TO_AT: &str = "canvas.to_note.e_at";
const E_TO_BASE: &str = "canvas.to_note.e_base";

/// Le frasi di questo modulo: chiave, italiano, inglese. Le legge
/// [`catalog`](super::catalog).
pub(super) const STRINGS: &[(&str, &str, &str)] = &[
    (
        "canvas.from_note.title",
        "Porta su una lavagna",
        "Bring onto a whiteboard",
    ),
    (
        "canvas.from_note.desc",
        "I blocchi scelti diventano schede di una lavagna, una per blocco e nello stesso ordine: una lavagna nuova accanto alla nota, o quella indicata. I file incorporati restano gli stessi.",
        "The chosen blocks become cards of a whiteboard, one per block and in the same order: a new whiteboard next to the note, or the one given. Embedded files stay the same.",
    ),
    ("canvas.from_note.doc.title", "Nota", "Note"),
    (
        "canvas.from_note.doc.desc",
        "La nota da cui partono i blocchi; di serie quella aperta.",
        "The note the blocks come from; the open one by default.",
    ),
    ("canvas.from_note.at.title", "Byte della scelta", "Bytes of the choice"),
    (
        "canvas.from_note.at.desc",
        "Inizio e fine dei blocchi, in byte del file; di serie la selezione o il blocco del cursore.",
        "Start and end of the blocks, in bytes of the file; the selection or the block at the cursor by default.",
    ),
    ("canvas.from_note.text.title", "Testo letto", "Text read"),
    (
        "canvas.from_note.text.desc",
        "Il testo che sta fra quei byte: se la nota è cambiata non si muove niente.",
        "The text between those bytes: if the note changed nothing moves.",
    ),
    ("canvas.from_note.to.title", "Lavagna", "Whiteboard"),
    (
        "canvas.from_note.to.desc",
        "La lavagna dove vanno le schede; senza, ne nasce una accanto alla nota.",
        "The whiteboard the cards go to; without one, a new one is made next to the note.",
    ),
    ("canvas.from_note.name.title", "Nome", "Name"),
    (
        "canvas.from_note.name.desc",
        "Il nome della lavagna nuova; di serie quello della nota.",
        "The name of the new whiteboard; the note's name by default.",
    ),
    ("canvas.from_note.folder.title", "Cartella", "Folder"),
    (
        "canvas.from_note.folder.desc",
        "La cartella della lavagna nuova; di serie quella della nota.",
        "The folder of the new whiteboard; the note's folder by default.",
    ),
    ("canvas.from_note.keep.title", "Lascia nella nota", "Keep in the note"),
    (
        "canvas.from_note.keep.desc",
        "I blocchi restano anche nella nota: una copia invece di uno spostamento.",
        "The blocks stay in the note too: a copy instead of a move.",
    ),
    (
        P_FROM_NOTE,
        "Porta i blocchi di «{doc}» su «{to}»",
        "Bring the blocks of “{doc}” onto “{to}”",
    ),
    (
        N_FROM_NOTE_MOVED,
        "Portato sulla lavagna «{to}».",
        "Brought onto the whiteboard “{to}”.",
    ),
    (
        N_FROM_NOTE_COPIED,
        "Copiato sulla lavagna «{to}».",
        "Copied onto the whiteboard “{to}”.",
    ),
    (
        U_FROM_NOTE,
        "Porta su «{to}»",
        "Bring onto “{to}”",
    ),
    (
        E_FROM_NO_NOTE,
        "Apri una nota, o scegli quale, per portarne i blocchi su una lavagna.",
        "Open a note, or choose one, to bring its blocks onto a whiteboard.",
    ),
    (
        E_FROM_NOTHING,
        "Non c'è niente da portare: scegli uno o più blocchi della nota.",
        "There is nothing to bring: choose one or more blocks of the note.",
    ),
    (
        E_FROM_DIRTY,
        "La nota ha modifiche non salvate: salvala, poi scegli di nuovo i blocchi.",
        "The note has unsaved changes: save it, then choose the blocks again.",
    ),
    (
        E_FROM_RANGE,
        "I blocchi indicati non stanno su righe intere della nota.",
        "The blocks given are not on whole lines of the note.",
    ),
    (
        E_FROM_CHANGED,
        "La nota «{doc}» è cambiata: scegli di nuovo i blocchi.",
        "The note “{doc}” changed: choose the blocks again.",
    ),
    (
        "canvas.to_note.title",
        "Porta in una nota",
        "Bring into a note",
    ),
    (
        "canvas.to_note.desc",
        "Le schede della lavagna diventano blocchi di una nota, in colonna da in alto a sinistra a in basso a destra; i fili diventano link. Una nota nuova accanto alla lavagna, o quella indicata.",
        "The cards of the whiteboard become blocks of a note, in a column from top left to bottom right; the wires become links. A new note next to the whiteboard, or the one given.",
    ),
    ("canvas.to_note.doc.title", "Lavagna", "Whiteboard"),
    (
        "canvas.to_note.doc.desc",
        "La lavagna da cui partono le schede; di serie quella aperta.",
        "The whiteboard the cards come from; the open one by default.",
    ),
    ("canvas.to_note.ids.title", "Schede", "Cards"),
    (
        "canvas.to_note.ids.desc",
        "Gli id delle schede, separati da virgole; di serie tutte. Un gruppo porta le sue.",
        "The ids of the cards, separated by commas; all by default. A group brings its own.",
    ),
    ("canvas.to_note.to.title", "Nota", "Note"),
    (
        "canvas.to_note.to.desc",
        "La nota dove vanno i blocchi; senza, ne nasce una accanto alla lavagna.",
        "The note the blocks go to; without one, a new one is made next to the whiteboard.",
    ),
    ("canvas.to_note.at.title", "Byte d'arrivo", "Landing byte"),
    (
        "canvas.to_note.at.desc",
        "L'inizio della riga della nota dove vanno i blocchi; di serie in fondo.",
        "The start of the line of the note where the blocks go; at the end by default.",
    ),
    ("canvas.to_note.name.title", "Nome", "Name"),
    (
        "canvas.to_note.name.desc",
        "Il nome della nota nuova; di serie quello della lavagna.",
        "The name of the new note; the whiteboard's name by default.",
    ),
    ("canvas.to_note.folder.title", "Cartella", "Folder"),
    (
        "canvas.to_note.folder.desc",
        "La cartella della nota nuova; di serie quella della lavagna.",
        "The folder of the new note; the whiteboard's folder by default.",
    ),
    ("canvas.to_note.keep.title", "Lascia sulla lavagna", "Keep on the whiteboard"),
    (
        "canvas.to_note.keep.desc",
        "Le schede restano anche sulla lavagna: una copia invece di uno spostamento.",
        "The cards stay on the whiteboard too: a copy instead of a move.",
    ),
    ("canvas.to_note.base.title", "Revisione di partenza", "Base revision"),
    (
        "canvas.to_note.base.desc",
        "Se c'è, le schede si portano solo da questa revisione della lavagna.",
        "If given, the cards are brought only from this revision of the whiteboard.",
    ),
    (
        P_TO_NOTE,
        "Porta le schede di «{doc}» in «{to}»",
        "Bring the cards of “{doc}” into “{to}”",
    ),
    (
        N_TO_NOTE_MOVED,
        "Portato nella nota «{to}».",
        "Brought into the note “{to}”.",
    ),
    (
        N_TO_NOTE_COPIED,
        "Copiato nella nota «{to}».",
        "Copied into the note “{to}”.",
    ),
    (U_TO_NOTE, "Porta in «{to}»", "Bring into “{to}”"),
    (
        E_TO_EMPTY,
        "Sulla lavagna «{doc}» non ci sono schede da portare in una nota.",
        "The whiteboard “{doc}” has no cards to bring into a note.",
    ),
    (
        E_TO_UNKNOWN,
        "Sulla lavagna «{doc}» non c'è più la scheda «{id}»: scegli di nuovo le schede.",
        "The whiteboard “{doc}” no longer has the card “{id}”: choose the cards again.",
    ),
    (
        E_TO_AT,
        "Il punto d'arrivo non è l'inizio di una riga della nota «{doc}».",
        "The landing point is not the start of a line of the note “{doc}”.",
    ),
    (
        E_TO_BASE,
        "La lavagna «{doc}» è cambiata: scegli di nuovo le schede.",
        "The whiteboard “{doc}” changed: choose the cards again.",
    ),
];

/// Le chiavi degli errori e degli esiti, per il controllo del catalogo.
#[cfg(test)]
pub(super) const KEYS: &[&str] = &[
    P_FROM_NOTE,
    N_FROM_NOTE_MOVED,
    N_FROM_NOTE_COPIED,
    U_FROM_NOTE,
    E_FROM_NO_NOTE,
    E_FROM_NOTHING,
    E_FROM_DIRTY,
    E_FROM_RANGE,
    E_FROM_CHANGED,
    P_TO_NOTE,
    N_TO_NOTE_MOVED,
    N_TO_NOTE_COPIED,
    U_TO_NOTE,
    E_TO_EMPTY,
    E_TO_UNKNOWN,
    E_TO_AT,
    E_TO_BASE,
];

/// Una frase con il nome di pagina di uno o due documenti.
fn named(key: &str, pairs: &[(&str, &DocId)]) -> Text {
    Text::message(
        key,
        pairs
            .iter()
            .map(|(name, doc)| Arg::text(*name, doc.page_name()))
            .collect(),
    )
}

/// Una nota letta per il piano: la revisione su cui si calcola, il testo e il
/// modello. Prima la revisione, poi il testo: se la nota cambia in mezzo, la
/// modifica ha una base vecchia e la scrittura è un conflitto.
struct Note {
    revision: Revision,
    source: String,
    model: DocumentModel,
}

fn read_note(host: &dyn HostApi, doc: &DocId) -> Result<Note, PluginError> {
    let revision = host.document_revision(doc)?;
    let source = host.read_document(doc)?;
    let model = host.read_model(doc)?;
    Ok(Note {
        revision,
        source,
        model,
    })
}

/// Una lavagna letta per il piano.
struct Board {
    revision: Revision,
    core: Core,
}

fn read_board(host: &dyn HostApi, doc: &DocId) -> Result<Board, PluginError> {
    let revision = host.document_revision(doc)?;
    let source = host.read_document(doc)?;
    let core = Core::open(source).map_err(|error| opening(doc, &error))?;
    Ok(Board { revision, core })
}

/// Il file nuovo, o quello che c'è: dove arriva ciò che si porta.
enum Landing {
    New(DocId),
    Existing(DocId),
}

impl Landing {
    fn doc(&self) -> &DocId {
        match self {
            Landing::New(doc) | Landing::Existing(doc) => doc,
        }
    }
}

/// L'annullamento del piano, in un passo: l'inverso di ogni modifica e il
/// cestino per il file nato.
fn undo_of(applied: &AppliedPlan, label: Text) -> Undo {
    applied.undo(label, |reversal| match reversal {
        Reversal::Trash { doc } => UndoStep::Command {
            command: TRASH.to_string(),
            args: serde_json::json!({ "doc": doc.as_str() }),
        },
        // Questi piani non rinominano: se un giorno lo facessero, il nome di
        // prima torna col comando delle note.
        Reversal::Rename { from, to } => UndoStep::Command {
            command: "note.rename".to_string(),
            args: serde_json::json!({ "doc": from.as_str(), "to": to.as_str() }),
        },
    })
}

/// La simulazione: le modifiche del piano, e i file che nascerebbero.
fn dry_run(plan: &WritePlan, summary: Text) -> CommandOutcome {
    let edits = plan
        .steps
        .iter()
        .filter_map(|step| match step {
            WriteStep::Edit(edit) => Some(edit.clone()),
            _ => None,
        })
        .collect();
    let mut command_plan = CommandPlan::of_edits(summary, edits);
    for doc in plan.docs() {
        command_plan = command_plan.with_doc(doc);
    }
    CommandOutcome::done().with_effect(CommandEffect::Plan(command_plan))
}

/// Un nome nuovo accanto a `beside` (o in `folder`), col nome `name` o, di
/// serie, il primo libero della famiglia di `stem`. Un nome dato e preso è un
/// conflitto, mai una sovrascrittura.
fn new_file(
    host: &dyn HostApi,
    beside: &DocId,
    name: Option<&str>,
    folder: Option<&str>,
    stem: &str,
    extension: &str,
) -> Result<DocId, PluginError> {
    let folder = match folder {
        Some(folder) => folders::normalized(&path_policy::from_outside(folder)).to_string(),
        None => beside
            .as_str()
            .rsplit_once('/')
            .map(|(folder, _)| folder.to_string())
            .unwrap_or_default(),
    };
    let placed = |name: &str| {
        if folder.is_empty() || name.contains('/') {
            name.to_string()
        } else {
            format!("{folder}/{name}")
        }
    };
    let checked = |written: &str| -> Result<DocId, PluginError> {
        path_policy::check(written, Naming::New)
            .map_err(|fault| create::bad_name(written, &fault))?;
        Ok(DocId::new(path_policy::normalized(written)))
    };
    let given = name
        .map(path_policy::from_outside)
        .filter(|name| !name.trim().is_empty());
    match given {
        Some(name) => {
            let doc = checked(&crate::formats::with_extension(
                host,
                &placed(&name),
                extension,
            ))?;
            if host.free_name(&doc) != doc {
                return Err(PluginError::AlreadyExists(Text::message(
                    E_TAKEN,
                    vec![Arg::text("doc", doc.as_str())],
                )));
            }
            Ok(doc)
        }
        None => Ok(host.free_name(&checked(&placed(&format!("{stem}.{extension}")))?)),
    }
}

// ---------------------------------------------------------------------------
// Dalla nota alla lavagna
// ---------------------------------------------------------------------------

pub(super) fn canvas_from_note(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let context = host.active_context();
    let doc = crate::formats::document_with(&args, DOC, &*host, PROSE)?
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_FROM_NO_NOTE)))?;
    crate::formats::require(&*host, &doc, PROSE)?;
    let to = match args.text(TO).map(str::trim).filter(|to| !to.is_empty()) {
        Some(_) => Some(canvas_doc_in(&args, TO, &*host)?),
        None => None,
    };
    let keep = args.flag(KEEP, false);

    let note = read_note(&*host, &doc)?;
    let chosen = match args.numbers(AT) {
        Some(at) => {
            let (start, end) = given_bytes(&at)?;
            if let Some(expected) = args.text(TEXT) {
                if note.source.get(start..end) != Some(expected) {
                    return Err(PluginError::Conflict(named(
                        E_FROM_CHANGED,
                        &[("doc", &doc)],
                    )));
                }
            }
            line_range(&note.source, start, end)
                .ok_or_else(|| PluginError::BadArgs(Text::key(E_FROM_RANGE)))?
        }
        None => context_range(context.as_ref(), &doc, &note)?,
    };
    let spans = card_spans(&note, chosen.0, chosen.1);
    let (Some(first), Some(last)) = (spans.first(), spans.last()) else {
        return Err(PluginError::BadArgs(Text::key(E_FROM_NOTHING)));
    };
    let taken = (first.0, last.1);
    let cards: Vec<AddCardArgs> = spans
        .iter()
        .map(|&(start, end)| card_of(&*host, &doc, &note, start, end))
        .collect::<Result<_, _>>()?;

    let landing = match to {
        Some(to) => Landing::Existing(to),
        None => {
            if host
                .format_of(&DocId::new("x.canvas"))
                .is_none_or(|format| format.descriptor.id != CANVAS_FORMAT)
            {
                return Err(PluginError::BadArgs(Text::key(E_NO_FORMAT)));
            }
            Landing::New(new_file(
                &*host,
                &doc,
                args.text(NAME),
                args.text(FOLDER),
                doc.page_name(),
                "canvas",
            )?)
        }
    };

    // La lavagna di prima (vuota, se nasce) e le schede in colonna.
    let (mut core, revision) = match &landing {
        Landing::Existing(to) => {
            let board = read_board(&*host, to)?;
            (board.core, Some(board.revision))
        }
        Landing::New(new) => (
            Core::open(create::empty_source(new)?).map_err(|error| opening(new, &error))?,
            None,
        ),
    };
    let seed =
        Fnv1a::hash(format!("{}\u{0}{}", note.revision.0, landing.doc().as_str()).as_bytes());
    let mut ops: Vec<CanvasOp> = cards.into_iter().map(CanvasOp::AddCard).collect();
    // Le note di ciò che le misure hanno corretto non servono qui: le schede
    // nascono con le misure dei loro file.
    let _ = prepare_ops(&*host, core.canvas(), &mut ops);
    let compiled = compile(core.canvas(), &ops, seed).map_err(apply::operation)?;
    let committed = core
        .commit(&compiled.patches)
        .map_err(|error| apply::committing(landing.doc(), error))?;

    let mut plan = WritePlan::new();
    plan = match revision {
        None => plan.create(landing.doc().clone(), committed.source),
        Some(revision) => {
            let edit = committed.edit;
            plan.edit(
                landing.doc().clone(),
                EditRequest::new(
                    revision,
                    vec![TextEdit::replace(
                        Span::new(edit.start, edit.end),
                        edit.text,
                    )],
                ),
            )
        }
    };
    if !keep {
        let (from, until) = removal(&note.source, taken.0, taken.1);
        plan = plan.edit(
            doc.clone(),
            EditRequest::new(
                note.revision.clone(),
                vec![TextEdit::delete(Span::new(from, until))],
            ),
        );
    }

    let target = landing.doc().clone();
    if mode.is_dry_run() {
        return Ok(dry_run(
            &plan,
            named(P_FROM_NOTE, &[("doc", &doc), ("to", &target)]),
        ));
    }
    let applied = plan.apply(host).map_err(PluginError::from)?;
    let undo = undo_of(&applied, named(U_FROM_NOTE, &[("to", &target)]));
    let notice = if keep {
        N_FROM_NOTE_COPIED
    } else {
        N_FROM_NOTE_MOVED
    };
    let outcome = CommandOutcome::notify(named(notice, &[("to", &target)])).undoable(undo);
    Ok(match landing {
        Landing::New(doc) => outcome.with_effect(CommandEffect::Navigate { doc }),
        Landing::Existing(_) => outcome,
    })
}

/// Una lavagna nominata nel campo `name`: come [`canvas_doc`], per un campo
/// che non si chiama `doc`.
fn canvas_doc_in(args: &Args<'_>, name: &str, host: &dyn HostApi) -> Result<DocId, PluginError> {
    let is_canvas = |doc: &DocId| {
        host.format_of(doc)
            .is_some_and(|format| format.descriptor.id == CANVAS_FORMAT)
    };
    let doc = crate::formats::document_named_by(args, name, host, is_canvas)?
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    if !is_canvas(&doc) {
        return Err(PluginError::BadArgs(about(E_NOT_CANVAS, &doc, Vec::new())));
    }
    Ok(doc)
}

/// `at` come intervallo di byte: due numeri interi, inizio e fine.
fn given_bytes(at: &[f64]) -> Result<(usize, usize), PluginError> {
    let bad = || PluginError::BadArgs(Text::key(E_FROM_RANGE));
    let [start, end] = at else { return Err(bad()) };
    let whole = |n: f64| (n.is_finite() && n >= 0.0 && n.fract() == 0.0).then_some(n as usize);
    whole(*start).zip(whole(*end)).ok_or_else(bad)
}

/// L'intervallo portato su righe intere: comincia all'inizio di una riga,
/// finisce alla fine di una (gli a capo in coda restano fuori), sta su confini
/// di carattere e non è vuoto. È la regola di «Sposta in…»
/// (`commands/move_block.rs`): i moduli di feature non si nominano fra loro.
fn line_range(source: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    if start >= end || end > source.len() {
        return None;
    }
    if !source.is_char_boundary(start) || !source.is_char_boundary(end) {
        return None;
    }
    let bytes = source.as_bytes();
    if start > 0 && bytes[start - 1] != b'\n' {
        return None;
    }
    let mut end = end;
    while end > start && matches!(bytes[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    if end < source.len() && !matches!(bytes[end], b'\n' | b'\r') {
        return None;
    }
    (end > start && !source[start..end].trim().is_empty()).then_some((start, end))
}

/// La scelta della nota attiva, senza `at`: le righe della selezione, o il
/// blocco del cursore. Le coordinate valgono per il file soltanto a buffer
/// pulito (decisione 0007).
fn context_range(
    context: Option<&fub_abi::session::ViewContext>,
    doc: &DocId,
    note: &Note,
) -> Result<(usize, usize), PluginError> {
    let nothing = || PluginError::BadArgs(Text::key(E_FROM_NOTHING));
    let context = context
        .filter(|context| context.doc.as_ref() == Some(doc))
        .ok_or_else(nothing)?;
    let selections = context.selections.as_ref().ok_or_else(nothing)?;
    let placed = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_FROM_DIRTY)))?
        .all();
    let (Some(first), Some(last)) = (placed.first(), placed.last()) else {
        return Err(nothing());
    };
    let (start, end) = (first.span.start, last.span.end);
    let source = &note.source;
    if start > source.len() || end > source.len() {
        return Err(nothing());
    }
    let (start, end) = if start == end {
        let block = note
            .model
            .body
            .iter()
            .map(Block::span)
            .find(|span| span.start <= start && start <= span.end)
            .ok_or_else(nothing)?;
        (block.start, block.end)
    } else {
        (start, end)
    };
    let line_start = source[..start].rfind('\n').map_or(0, |i| i + 1);
    let line_end = source[end..].find('\n').map_or(source.len(), |i| end + i);
    line_range(source, line_start, line_end).ok_or_else(nothing)
}

/// Dove comincia ogni blocco di primo livello della nota (e ogni voce di primo
/// livello di un elenco), in ordine.
fn block_starts(body: &[Block]) -> Vec<usize> {
    let mut starts = Vec::new();
    for block in body {
        match block {
            Block::List { items, .. } if !items.is_empty() => {
                starts.extend(items.iter().map(|item| item.span.start));
            }
            other => starts.push(other.span().start),
        }
    }
    starts.sort_unstable();
    starts.dedup();
    starts
}

/// I tratti della scelta `start..end`, uno per scheda (le regole sono in testa
/// al modulo): un titolo porta la sua sezione, e fra due blocchi nessun byte
/// resta fuori.
fn card_spans(note: &Note, start: usize, end: usize) -> Vec<(usize, usize)> {
    let source = &note.source;
    let starts = block_starts(&note.model.body);
    // Si comincia dal primo blocco della scelta: ciò che c'è prima (righe
    // vuote, il frontmatter) non è un blocco.
    let Some(&start) = starts.iter().find(|&&s| s >= start && s < end) else {
        return Vec::new();
    };
    // Le sezioni dei titoli che cominciano nella scelta, anche oltre.
    let outline = &note.model.outline;
    let mut end = end;
    let mut sections: Vec<(usize, usize)> = Vec::new();
    for (index, heading) in outline.iter().enumerate() {
        let at = heading.span.start;
        if at < start || at >= end {
            continue;
        }
        let until = outline[index + 1..]
            .iter()
            .find(|next| next.level <= heading.level)
            .map_or(source.len(), |next| next.span.start);
        let until = trimmed_end(source, at, until);
        sections.push((at, until));
        end = end.max(until);
    }
    let inside_a_section = |cut: usize| sections.iter().any(|&(from, to)| from < cut && cut < to);
    let mut cuts: Vec<usize> = starts
        .iter()
        .copied()
        .filter(|&s| s > start && s < end && !inside_a_section(s))
        .collect();
    cuts.push(end);
    let mut spans = Vec::new();
    let mut from = start;
    for cut in cuts {
        let until = trimmed_end(source, from, cut.min(end));
        if until > from {
            spans.push((from, until));
        }
        from = cut;
    }
    spans
}

/// La fine di `from..to` senza gli spazi e gli a capo in coda.
fn trimmed_end(source: &str, from: usize, to: usize) -> usize {
    let to = to.min(source.len()).max(from);
    from + source[from..to].trim_end().len()
}

/// La scheda di un tratto della nota: un file per un embed da solo, il testo
/// per il resto. Il posto lo dà il nucleo: una sotto l'altra.
fn card_of(
    host: &dyn HostApi,
    doc: &DocId,
    note: &Note,
    start: usize,
    end: usize,
) -> Result<AddCardArgs, PluginError> {
    let text = &note.source[start..end];
    if let Some(card) = embedded_file(host, doc, note, start, end)? {
        return Ok(card);
    }
    Ok(AddCardArgs {
        text: Some(text.replace("\r\n", "\n")),
        ..AddCardArgs::default()
    })
}

/// La scheda di file di un embed wiki da solo nel suo tratto, sullo stesso
/// file, con la parte (`#page=3`, `#Titolo`, `#^id`) e la misura
/// (`|640x300`, `|640`) dell'embed. `None` se il tratto non è un embed solo,
/// se nomina la nota stessa o se non si risolve: resta testo.
fn embedded_file(
    host: &dyn HostApi,
    doc: &DocId,
    note: &Note,
    start: usize,
    end: usize,
) -> Result<Option<AddCardArgs>, PluginError> {
    let text = &note.source[start..end];
    let lead = text.len() - text.trim_start().len();
    let (from, to) = (start + lead, end);
    let written = &note.source[from..to];
    if written.contains('\n') || !written.starts_with("![[") || !written.ends_with("]]") {
        return Ok(None);
    }
    let Some(link) = note
        .model
        .links
        .iter()
        .find(|link| link.embed && link.span.start == from && link.span.end == to)
    else {
        return Ok(None);
    };
    let LinkTarget::Wiki {
        page,
        heading,
        block,
    } = &link.target
    else {
        return Ok(None);
    };
    if page.trim().is_empty() {
        return Ok(None);
    }
    let found = match host.query_index(IndexQuery::Resolve {
        target: LinkTarget::wiki(page.as_str()),
        from: Some(doc.clone()),
    }) {
        Ok(IndexResult::Resolved(Some(found))) => found.doc,
        Ok(_) | Err(PluginError::Unserved(_)) => return Ok(None),
        Err(error) => return Err(error),
    };
    let subpath = match (block, heading) {
        (Some(block), _) => Some(format!("#^{block}")),
        (None, Some(heading)) => Some(format!("#{heading}")),
        (None, None) => None,
    };
    let (width, height) = embed_size(&written[3..written.len() - 2]);
    Ok(Some(AddCardArgs {
        file: Some(found.as_str().to_string()),
        subpath,
        width,
        height,
        ..AddCardArgs::default()
    }))
}

/// La misura scritta dopo la barra di un embed, come la capisce Obsidian:
/// `640x300` o `640`. Una misura assurda non conta.
fn embed_size(inner: &str) -> (Option<i64>, Option<i64>) {
    const MAX: i64 = 100_000;
    let Some((_, size)) = inner.rsplit_once('|') else {
        return (None, None);
    };
    let number = |text: &str| {
        text.trim()
            .parse::<i64>()
            .ok()
            .filter(|value| *value > 0 && *value <= MAX)
    };
    match size.split_once('x') {
        Some((width, height)) => match (number(width), number(height)) {
            (Some(width), Some(height)) => (Some(width), Some(height)),
            _ => (None, None),
        },
        None => (number(size), None),
    }
}

/// Che cosa si toglie dalla nota quando i blocchi la lasciano: le loro righe
/// con l'a capo, e una delle due righe vuote che resterebbero attaccate; in
/// fondo alla nota anche le righe vuote prima. È la regola di «Sposta in…».
fn removal(source: &str, start: usize, end: usize) -> (usize, usize) {
    let mut to = end;
    if source[to..].starts_with("\r\n") {
        to += 2;
    } else if source[to..].starts_with('\n') {
        to += 1;
    }
    let blank_before =
        start == 0 || source[..start].ends_with("\n\n") || source[..start].ends_with("\n\r\n");
    if to >= source.len() {
        let mut from = start;
        while from > 0 {
            let line_start = source[..from - 1].rfind('\n').map_or(0, |i| i + 1);
            if line_start == 0 || !source[line_start..from].trim().is_empty() {
                break;
            }
            from = line_start;
        }
        return (from, source.len());
    }
    if blank_before {
        let next_end = source[to..].find('\n').map_or(source.len(), |i| to + i + 1);
        if source[to..next_end].trim().is_empty() {
            to = next_end;
        }
    }
    (start, to)
}

// ---------------------------------------------------------------------------
// Dalla lavagna alla nota
// ---------------------------------------------------------------------------

pub(super) fn canvas_to_note(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = match args.text(DOC).map(str::trim).filter(|doc| !doc.is_empty()) {
        Some(_) => canvas_doc(&args, &*host)?,
        None => {
            let doc = host
                .active_context()
                .and_then(|context| context.doc)
                .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
            if host
                .format_of(&doc)
                .is_none_or(|format| format.descriptor.id != CANVAS_FORMAT)
            {
                return Err(PluginError::BadArgs(about(E_NOT_CANVAS, &doc, Vec::new())));
            }
            doc
        }
    };
    let keep = args.flag(KEEP, false);
    let to = crate::formats::document_with(&args, TO, &*host, PROSE)?;
    if let Some(to) = &to {
        crate::formats::require(&*host, to, PROSE)?;
    }

    let mut board = read_board(&*host, &doc)?;
    if let Some(base) = args.text(BASE) {
        if Revision::new(base) != board.revision {
            return Err(PluginError::Conflict(named(E_TO_BASE, &[("doc", &doc)])));
        }
    }
    let chosen = chosen_cards(board.core.canvas(), args.text(IDS), &doc)?;

    let landing = match to {
        Some(to) => Landing::Existing(to),
        None => {
            let extension = crate::formats::new_note_extension(&*host)?;
            Landing::New(new_file(
                &*host,
                &doc,
                args.text(NAME),
                args.text(FOLDER),
                doc.page_name(),
                &extension,
            )?)
        }
    };
    let target = landing.doc().clone();
    let body = note_text(&*host, &target, board.core.canvas(), &chosen)?;

    let mut plan = WritePlan::new();
    match &landing {
        Landing::New(new) => {
            plan = plan.create(new.clone(), format!("{body}\n"));
        }
        Landing::Existing(to) => {
            let note = read_note(&*host, to)?;
            let at = match args.number(AT) {
                Some(at) => landing_byte(&note.source, at)
                    .ok_or_else(|| PluginError::BadArgs(named(E_TO_AT, &[("doc", to)])))?,
                None => note.source.len(),
            };
            let insert = inserted(&note.source, at, &body);
            plan = plan.edit(
                to.clone(),
                EditRequest::new(note.revision, vec![TextEdit::insert(at, insert)]),
            );
        }
    }
    if !keep {
        let ids: Vec<String> = chosen.iter().cloned().collect();
        let compiled = compile(
            board.core.canvas(),
            &[CanvasOp::Remove { ids }],
            Fnv1a::hash(board.revision.0.as_bytes()),
        )
        .map_err(apply::operation)?;
        let committed = board
            .core
            .commit(&compiled.patches)
            .map_err(|error| apply::committing(&doc, error))?;
        let edit = committed.edit;
        plan = plan.edit(
            doc.clone(),
            EditRequest::new(
                board.revision.clone(),
                vec![TextEdit::replace(
                    Span::new(edit.start, edit.end),
                    edit.text,
                )],
            ),
        );
    }

    if mode.is_dry_run() {
        return Ok(dry_run(
            &plan,
            named(P_TO_NOTE, &[("doc", &doc), ("to", &target)]),
        ));
    }
    let applied = plan.apply(host).map_err(PluginError::from)?;
    let undo = undo_of(&applied, named(U_TO_NOTE, &[("to", &target)]));
    let notice = if keep {
        N_TO_NOTE_COPIED
    } else {
        N_TO_NOTE_MOVED
    };
    let outcome = CommandOutcome::notify(named(notice, &[("to", &target)])).undoable(undo);
    Ok(match landing {
        Landing::New(doc) => outcome.with_effect(CommandEffect::Navigate { doc }),
        Landing::Existing(_) => outcome,
    })
}

/// Le schede da portare: quelle di `ids` (separati da virgole), di serie
/// tutte; un gruppo porta le schede che contiene. Un id che non c'è è un
/// conflitto: la lavagna è cambiata da quando le si è scelte.
fn chosen_cards(
    canvas: &Canvas,
    ids: Option<&str>,
    doc: &DocId,
) -> Result<HashSet<String>, PluginError> {
    let written: Vec<&str> = ids
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();
    let mut chosen: HashSet<String> = HashSet::new();
    if written.is_empty() {
        chosen.extend(canvas.nodes.iter().map(|node| node.id.clone()));
    } else {
        for id in written {
            if !canvas.nodes.iter().any(|node| node.id == id) {
                return Err(PluginError::Conflict(Text::message(
                    E_TO_UNKNOWN,
                    vec![Arg::text("doc", doc.page_name()), Arg::text("id", id)],
                )));
            }
            chosen.insert(id.to_string());
        }
        // Un gruppo porta ciò che contiene, anche i gruppi dentro di lui.
        loop {
            let before = chosen.len();
            let groups: Vec<&CanvasNode> = canvas
                .nodes
                .iter()
                .filter(|node| node.node_type == CanvasNodeType::Group && chosen.contains(&node.id))
                .collect();
            for node in &canvas.nodes {
                if groups
                    .iter()
                    .any(|group| group.id != node.id && contains(group, node))
                {
                    chosen.insert(node.id.clone());
                }
            }
            if chosen.len() == before {
                break;
            }
        }
    }
    if chosen.is_empty() {
        return Err(PluginError::BadArgs(named(E_TO_EMPTY, &[("doc", doc)])));
    }
    Ok(chosen)
}

/// Il gruppo contiene la scheda: tutta dentro il suo rettangolo.
fn contains(group: &CanvasNode, node: &CanvasNode) -> bool {
    let (gx, gy) = (i128::from(group.x), i128::from(group.y));
    let (gr, gb) = (gx + i128::from(group.width), gy + i128::from(group.height));
    let (x, y) = (i128::from(node.x), i128::from(node.y));
    let (r, b) = (x + i128::from(node.width), y + i128::from(node.height));
    x >= gx && y >= gy && r <= gr && b <= gb && (r - x) * (b - y) < (gr - gx) * (gb - gy)
}

/// Un pezzo della nota che nasce: il suo testo e la scheda da cui viene.
struct Piece {
    id: String,
    text: String,
}

/// Il testo dei blocchi che le schede `chosen` danno nella nota `target`, in
/// colonna (le regole sono in testa al modulo), senza l'a capo in fondo.
fn note_text(
    host: &dyn HostApi,
    target: &DocId,
    canvas: &Canvas,
    chosen: &HashSet<String>,
) -> Result<String, PluginError> {
    let nodes: Vec<&CanvasNode> = canvas
        .nodes
        .iter()
        .filter(|node| chosen.contains(&node.id))
        .collect();
    // Il genitore di ogni scheda: il gruppo più piccolo che la contiene.
    let mut parent: HashMap<&str, &str> = HashMap::new();
    for node in &nodes {
        let holder = nodes
            .iter()
            .filter(|group| {
                group.node_type == CanvasNodeType::Group
                    && group.id != node.id
                    && contains(group, node)
            })
            .min_by_key(|group| i128::from(group.width) * i128::from(group.height));
        if let Some(group) = holder {
            parent.insert(node.id.as_str(), group.id.as_str());
        }
    }
    let mut children: BTreeMap<Option<&str>, Vec<&CanvasNode>> = BTreeMap::new();
    for node in &nodes {
        children
            .entry(parent.get(node.id.as_str()).copied())
            .or_default()
            .push(node);
    }
    for list in children.values_mut() {
        list.sort_by_key(|node| (node.y, node.x));
    }

    // I fili che partono dalle schede scelte: chi li riceve ha bisogno di un
    // nome (un id di blocco) prima di scrivere i testi.
    let by_id: HashMap<&str, &CanvasNode> = canvas
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let mut block_ids: HashMap<&str, String> = HashMap::new();
    let mut taken: HashSet<String> = HashSet::new();
    for node in &nodes {
        if let Some(id) = node.text.as_deref().and_then(written_block_id) {
            taken.insert(id.to_ascii_lowercase());
        }
    }
    let mut arrows: HashMap<&str, Vec<String>> = HashMap::new();
    let mut levels: HashMap<&str, usize> = HashMap::new();
    fill_levels(&children, None, 0, &mut levels);
    for edge in &canvas.edges {
        if !chosen.contains(&edge.from_node) {
            continue;
        }
        let Some(&target_node) = by_id.get(edge.to_node.as_str()) else {
            continue;
        };
        let link = match target_node.node_type {
            CanvasNodeType::Text if chosen.contains(&target_node.id) => {
                let id = match block_ids.get(target_node.id.as_str()) {
                    Some(id) => id.clone(),
                    None => {
                        let id = target_node
                            .text
                            .as_deref()
                            .and_then(written_block_id)
                            .map(str::to_string)
                            .unwrap_or_else(|| fresh_block_id(&target_node.id, &mut taken));
                        block_ids.insert(target_node.id.as_str(), id.clone());
                        id
                    }
                };
                Some(LinkInsert {
                    target: LinkTarget::Wiki {
                        page: String::new(),
                        heading: None,
                        block: Some(id),
                    },
                    label: edge.label.clone(),
                    embed: false,
                })
            }
            CanvasNodeType::File => match target_node.file.as_deref() {
                Some(file) if !file.is_empty() => Some(file_link(
                    host,
                    file,
                    target_node.subpath.as_deref(),
                    edge.label.clone(),
                    false,
                )?),
                _ => None,
            },
            CanvasNodeType::Group if chosen.contains(&target_node.id) => target_node
                .label
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .map(|label| LinkInsert {
                    target: LinkTarget::Wiki {
                        page: String::new(),
                        heading: Some(label.to_string()),
                        block: None,
                    },
                    label: edge.label.clone(),
                    embed: false,
                }),
            CanvasNodeType::Link => {
                if let Some(url) = target_node.url.as_deref().filter(|url| !url.is_empty()) {
                    arrows
                        .entry(edge.from_node.as_str())
                        .or_default()
                        .push(url.to_string());
                }
                None
            }
            _ => None,
        };
        if let Some(link) = link {
            let written = crate::formats::link_text(host, target, &link)?;
            arrows
                .entry(edge.from_node.as_str())
                .or_default()
                .push(written);
        }
    }

    let mut pieces: Vec<Piece> = Vec::new();
    let mut ctx = Writing {
        host,
        target,
        children: &children,
        block_ids: &block_ids,
        arrows: &arrows,
        levels: &levels,
    };
    ctx.emit(None, &mut pieces)?;
    Ok(join(&pieces))
}

/// La profondità di ogni gruppo: il titolo di un gruppo di primo livello è un
/// `##`, uno dentro un altro un `###`, e così via fino a sei.
fn fill_levels<'a>(
    children: &BTreeMap<Option<&'a str>, Vec<&'a CanvasNode>>,
    parent: Option<&'a str>,
    depth: usize,
    levels: &mut HashMap<&'a str, usize>,
) {
    let Some(list) = children.get(&parent) else {
        return;
    };
    for node in list {
        if node.node_type == CanvasNodeType::Group {
            levels.insert(node.id.as_str(), depth);
            fill_levels(children, Some(node.id.as_str()), depth + 1, levels);
        }
    }
}

/// Ciò che serve per scrivere i pezzi.
struct Writing<'a> {
    host: &'a dyn HostApi,
    target: &'a DocId,
    children: &'a BTreeMap<Option<&'a str>, Vec<&'a CanvasNode>>,
    block_ids: &'a HashMap<&'a str, String>,
    arrows: &'a HashMap<&'a str, Vec<String>>,
    levels: &'a HashMap<&'a str, usize>,
}

impl Writing<'_> {
    fn emit(&mut self, parent: Option<&str>, pieces: &mut Vec<Piece>) -> Result<(), PluginError> {
        let Some(list) = self.children.get(&parent) else {
            return Ok(());
        };
        for node in list {
            let text = match node.node_type {
                CanvasNodeType::Text => {
                    let text = node.text.as_deref().unwrap_or("").trim_end().to_string();
                    match self.block_ids.get(node.id.as_str()) {
                        Some(id) if written_block_id(&text).is_none() => with_block_id(&text, id),
                        _ => text,
                    }
                }
                CanvasNodeType::File => match node.file.as_deref() {
                    Some(file) if !file.is_empty() => {
                        let link = file_link(self.host, file, node.subpath.as_deref(), None, true)?;
                        crate::formats::link_text(self.host, self.target, &link)?
                    }
                    _ => String::new(),
                },
                CanvasNodeType::Link => node.url.clone().unwrap_or_default(),
                CanvasNodeType::Group => {
                    let depth = self.levels.get(node.id.as_str()).copied().unwrap_or(0);
                    match node
                        .label
                        .as_deref()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                    {
                        Some(label) => format!("{} {label}", "#".repeat((depth + 2).min(6))),
                        None => String::new(),
                    }
                }
            };
            if !text.trim().is_empty() {
                pieces.push(Piece {
                    id: node.id.clone(),
                    text,
                });
            }
            if let Some(arrows) = self.arrows.get(node.id.as_str()) {
                pieces.push(Piece {
                    id: String::new(),
                    text: format!("→ {}", arrows.join(" · ")),
                });
            }
            if node.node_type == CanvasNodeType::Group {
                self.emit(Some(node.id.as_str()), pieces)?;
            }
        }
        Ok(())
    }
}

/// I pezzi uno sotto l'altro, separati da una riga vuota; due voci di elenco
/// una dopo l'altra restano un elenco solo.
fn join(pieces: &[Piece]) -> String {
    let mut out = String::new();
    let mut previous: Option<&Piece> = None;
    for piece in pieces {
        if let Some(previous) = previous {
            let tight = !previous.id.is_empty()
                && !piece.id.is_empty()
                && previous.text.lines().last().is_some_and(is_list_item)
                && piece.text.lines().next().is_some_and(is_list_item);
            out.push_str(if tight { "\n" } else { "\n\n" });
        }
        out.push_str(&piece.text);
        previous = Some(piece);
    }
    out
}

/// Una riga che comincia una voce di elenco (`- `, `* `, `+ `, `1. `, `1) `),
/// anche rientrata.
fn is_list_item(line: &str) -> bool {
    let line = line.trim_start();
    if let Some(rest) = line.strip_prefix(['-', '*', '+']) {
        return rest.is_empty() || rest.starts_with(' ');
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    digits > 0
        && digits <= 9
        && line[digits..]
            .strip_prefix(['.', ')'])
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
}

/// L'id di blocco scritto in coda all'ultima riga (`… ^abc`, o `^abc` da solo
/// su una riga), se c'è.
fn written_block_id(text: &str) -> Option<&str> {
    let last = text.trim_end().lines().last()?;
    let (before, id) = last.rsplit_once('^')?;
    let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    (valid && (before.is_empty() || before.ends_with(char::is_whitespace))).then_some(id)
}

/// Un id di blocco nuovo per la scheda `card`: i primi sei caratteri del suo id
/// che vanno bene in un `^id`, o, se non bastano o sono presi, uno che nasce
/// dall'id. Sempre lo stesso per la stessa scheda.
fn fresh_block_id(card: &str, taken: &mut HashSet<String>) -> String {
    let clean: String = card
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .take(6)
        .collect();
    let mut candidate = clean;
    let mut round: u64 = 0;
    while candidate.len() < 4 || taken.contains(&candidate) {
        let hash = Fnv1a::hash(format!("{card}\u{0}{round}").as_bytes());
        candidate = format!("{:06x}", hash & 0xff_ffff);
        round += 1;
    }
    taken.insert(candidate.clone());
    candidate
}

/// Il testo con l'id di blocco in coda: sull'ultima riga, o su una riga sua
/// dopo una riga vuota quando l'ultima riga è di un recinto, di una tabella o
/// di una formula, dove un `^id` cambierebbe il blocco.
fn with_block_id(text: &str, id: &str) -> String {
    let last = text.lines().last().unwrap_or("").trim_start();
    let own_line = ["```", "~~~", "|", "$$", ">"]
        .iter()
        .any(|lead| last.starts_with(lead));
    if own_line {
        format!("{text}\n\n^{id}")
    } else {
        format!("{text} ^{id}")
    }
}

/// Il riferimento a un file del vault con la sua parte: un titolo
/// (`#Titolo`), un blocco (`#^id`) o un'altra parte (`#page=3`), che il link
/// porta come titolo.
fn file_link(
    host: &dyn HostApi,
    file: &str,
    subpath: Option<&str>,
    label: Option<String>,
    embed: bool,
) -> Result<LinkInsert, PluginError> {
    let doc = DocId::new(file);
    let page = file_reference(host, &doc)?;
    let part = subpath
        .map(|sub| sub.trim_start_matches('#'))
        .filter(|sub| !sub.is_empty());
    let (heading, block) = match part {
        Some(part) => match part.strip_prefix('^') {
            Some(block) => (None, Some(block.to_string())),
            None => (Some(part.to_string()), None),
        },
        None => (None, None),
    };
    Ok(LinkInsert {
        target: LinkTarget::Wiki {
            page,
            heading,
            block,
        },
        label,
        embed,
    })
}

/// Il nome con cui un link wiki porta al file: per una nota il più corto che
/// il vault risolve a lei ([`crate::formats::link_reference`]); per un altro
/// file il nome con l'estensione, come lo scrive Obsidian, poi il percorso.
fn file_reference(host: &dyn HostApi, doc: &DocId) -> Result<String, PluginError> {
    if crate::formats::understands(host, doc, PROSE) {
        return crate::formats::link_reference(host, doc);
    }
    let path = doc.as_str();
    let file_name = path.rsplit('/').next().unwrap_or(path);
    for candidate in [file_name, path] {
        match host.query_index(IndexQuery::Resolve {
            target: LinkTarget::wiki(candidate),
            from: None,
        }) {
            Ok(IndexResult::Resolved(Some(found))) if found.doc == *doc => {
                return Ok(candidate.to_string())
            }
            Ok(_) => {}
            Err(PluginError::Unserved(_)) => break,
            Err(error) => return Err(error),
        }
    }
    Ok(path.to_string())
}

/// `at` come byte d'arrivo: un intero all'inizio di una riga della nota (o in
/// fondo).
fn landing_byte(source: &str, at: f64) -> Option<usize> {
    if !(at.is_finite() && at >= 0.0 && at.fract() == 0.0) {
        return None;
    }
    let at = at as usize;
    (at <= source.len()
        && source.is_char_boundary(at)
        && (at == 0 || at == source.len() || source.as_bytes()[at - 1] == b'\n'))
        .then_some(at)
}

/// Il testo da inserire in `at`: i blocchi con una riga vuota prima e dopo,
/// senza raddoppiare quelle che ci sono, e con gli a capo della nota.
fn inserted(source: &str, at: usize, body: &str) -> String {
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let before = &source[..at];
    let after = &source[at..];
    let mut out = String::new();
    if !before.is_empty() {
        if !before.ends_with('\n') {
            out.push_str(newline);
            out.push_str(newline);
        } else if !(before.ends_with("\n\n") || before.ends_with("\n\r\n")) {
            out.push_str(newline);
        }
    }
    out.push_str(&body.replace('\n', newline));
    out.push_str(newline);
    if !after.is_empty() && !after.starts_with('\n') && !after.starts_with("\r\n") {
        out.push_str(newline);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_misura_dell_embed_e_quella_di_obsidian() {
        assert_eq!(embed_size("Conti.xlsx|640x300"), (Some(640), Some(300)));
        assert_eq!(embed_size("Conti.xlsx|640"), (Some(640), None));
        assert_eq!(embed_size("Conti.xlsx|0x0"), (None, None));
        assert_eq!(embed_size("Conti.xlsx|row"), (None, None));
        assert_eq!(embed_size("Conti.xlsx"), (None, None));
    }

    #[test]
    fn l_id_di_blocco_scritto_si_riconosce() {
        assert_eq!(written_block_id("Testo ^abc-1"), Some("abc-1"));
        assert_eq!(written_block_id("- a\n- b\n\n^xyz"), Some("xyz"));
        assert_eq!(written_block_id("2^3"), None);
        assert_eq!(written_block_id("Testo"), None);
    }

    #[test]
    fn un_id_nuovo_nasce_dalla_scheda_e_non_ripete() {
        let mut taken = HashSet::new();
        assert_eq!(fresh_block_id("6f1d2a9c0b7e", &mut taken), "6f1d2a");
        let again = fresh_block_id("6f1d2a00", &mut taken);
        assert_ne!(again, "6f1d2a");
        assert_eq!(again.len(), 6);
        assert_eq!(fresh_block_id("a", &mut HashSet::new()).len(), 6);
    }

    #[test]
    fn l_id_va_su_una_riga_sua_dopo_un_recinto_o_una_tabella() {
        assert_eq!(with_block_id("Ciao", "abc"), "Ciao ^abc");
        assert_eq!(with_block_id("```\nx\n```", "abc"), "```\nx\n```\n\n^abc");
        assert_eq!(with_block_id("| a |\n| - |", "abc"), "| a |\n| - |\n\n^abc");
    }

    #[test]
    fn le_voci_di_elenco_restano_un_elenco() {
        let piece = |id: &str, text: &str| Piece {
            id: id.to_string(),
            text: text.to_string(),
        };
        let pieces = [piece("a", "- uno"), piece("b", "- due"), piece("c", "Fine")];
        assert_eq!(join(&pieces), "- uno\n- due\n\nFine");
        assert!(is_list_item("1. primo"));
        assert!(is_list_item("  * dentro"));
        assert!(!is_list_item("-nota"));
        assert!(!is_list_item("2026 anno"));
    }

    #[test]
    fn l_inserto_tiene_una_riga_vuota_prima_e_dopo() {
        assert_eq!(inserted("A\n", 2, "X"), "\nX\n");
        assert_eq!(inserted("A\n\nB\n", 3, "X"), "X\n\n");
        assert_eq!(inserted("A", 1, "X"), "\n\nX\n");
        assert_eq!(inserted("", 0, "X"), "X\n");
        assert_eq!(inserted("A\r\n", 3, "X\nY"), "\r\nX\r\nY\r\n");
    }

    #[test]
    fn il_byte_d_arrivo_e_l_inizio_di_una_riga() {
        assert_eq!(landing_byte("A\nB\n", 2.0), Some(2));
        assert_eq!(landing_byte("A\nB\n", 1.0), None);
        assert_eq!(landing_byte("A\nB\n", 4.0), Some(4));
        assert_eq!(landing_byte("A\nB\n", 9.0), None);
        assert_eq!(landing_byte("A\nB\n", 1.5), None);
    }
}
