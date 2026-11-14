//! La lavagna come componente: il comando `canvas.apply`, che porta in un
//! file `.canvas` una lista di operazioni del nucleo
//! ([`fub_canvas_core::ops::CanvasOp`]) e ne fa una modifica sola, con
//! l'anteprima e l'annulla di ogni altra modifica al testo, e il comando
//! `canvas.create`, che fa nascere una lavagna vuota e la apre (`create`).
//!
//! Il comando non sa niente di schede e archi: legge il documento, chiede al
//! nucleo di aprirlo, compilare le operazioni e scriverle
//! ([`fub_canvas_core::commit::Core`]), e consegna all'host il tratto minimo
//! che è cambiato. Che cosa fa ogni operazione, e perché un errore la
//! rifiuta tutta, lo dice `docs/reference/canvas-operations.md`.
//!
//! Tre comandi leggono soltanto: `canvas.read` (la lavagna come testo, come
//! operazioni o come modello), `canvas.check` (che cosa cambierebbe, prima di
//! scrivere) e `canvas.guide` (la guida e lo schema). Stanno qui, con le stesse
//! regole di `canvas.apply`, per chi la guarda senza vederla.
//!
//! L'editor della lavagna sta nel client (`editors/canvas`): questo modulo è
//! la strada per chi la cambia senza vederla, cioè la palette, la riga di
//! comando e un agente.

mod apply;
mod check;
mod create;
mod guide;
mod preview;
mod read;

use fub_abi::command::{
    Args, Choice, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use fub_canvas_core::CanvasError;

/// L'id del componente, lo stesso della sua riga nella mappa.
pub const LAVAGNA_ID: &str = "fub.lavagna";

/// Applica una lista di operazioni a una lavagna.
pub const CANVAS_APPLY: &str = "canvas.apply";

/// Crea una lavagna vuota e la apre.
pub const CANVAS_CREATE: &str = "canvas.create";

/// Legge una lavagna: come testo (una riga per scheda), come lista di operazioni
/// che la ricrea, o come modello. Non scrive.
pub const CANVAS_READ: &str = "canvas.read";

/// Dice che cosa cambierebbe una lista di operazioni, con i problemi e gli avvisi.
/// Non scrive.
pub const CANVAS_CHECK: &str = "canvas.check";

/// La guida per scrivere una lavagna: il testo, i nomi delle operazioni, lo
/// schema e gli esempi. Non legge nessun documento.
pub const CANVAS_GUIDE: &str = "canvas.guide";

/// Disegna una lavagna, com'è o com'era dopo una lista di operazioni, senza
/// scriverla: un PNG con `draw`, altrimenti l'SVG come testo.
pub const CANVAS_PREVIEW: &str = "canvas.preview";

/// Il namespace dell'effetto che dice che cosa ha fatto `canvas.apply`.
pub const LAVAGNA_NS: &str = LAVAGNA_ID;

/// L'id del formato delle lavagne (`fub_format_canvas::model::FORMAT_ID`):
/// la feature non dipende dal formato, ne nomina soltanto l'id del contratto.
const CANVAS_FORMAT: &str = "canvas";

const DOC: &str = "doc";
const OPS: &str = "ops";
const BASE: &str = "base";
const SEED: &str = "seed";
const NAME: &str = "name";
const FOLDER: &str = "folder";
const FORM: &str = "form";
const IDS: &str = "ids";
const MAX_CHARS: &str = "max_chars";
const TOPIC: &str = "topic";

const P_APPLY: &str = "canvas.apply.p_apply";
const N_APPLIED: &str = "canvas.apply.n_applied";
const N_UNCHANGED: &str = "canvas.apply.n_unchanged";
const U_APPLY: &str = "canvas.apply.u_apply";
const E_NO_DOC: &str = "canvas.apply.e_no_doc";
const E_NOT_CANVAS: &str = "canvas.apply.e_not_canvas";
const E_OPS_JSON: &str = "canvas.apply.e_ops_json";
const E_OPS_EMPTY: &str = "canvas.apply.e_ops_empty";
const E_SEED: &str = "canvas.apply.e_seed";
const E_BASE: &str = "canvas.apply.e_base";
const E_OPEN_LIMIT: &str = "canvas.apply.e_open_limit";
const E_OPEN_JSON: &str = "canvas.apply.e_open_json";
const E_OPEN_INVALID: &str = "canvas.apply.e_open_invalid";
const E_OP_UNKNOWN_NODE: &str = "canvas.apply.e_op_unknown_node";
const E_OP_UNKNOWN_EDGE: &str = "canvas.apply.e_op_unknown_edge";
const E_OP_DUPLICATE: &str = "canvas.apply.e_op_duplicate";
const E_OP_TOO_MANY_NODES: &str = "canvas.apply.e_op_too_many_nodes";
const E_OP_TOO_MANY_EDGES: &str = "canvas.apply.e_op_too_many_edges";
const E_OP_INVALID: &str = "canvas.apply.e_op_invalid";
const E_COMMIT_STALE: &str = "canvas.apply.e_commit_stale";
const E_COMMIT_INVALID: &str = "canvas.apply.e_commit_invalid";
const E_COMMIT_REJECTED: &str = "canvas.apply.e_commit_rejected";
const E_COMMIT_UNSTABLE: &str = "canvas.apply.e_commit_unstable";

/// Il nome di una lavagna senza nome, prima del numero che lo rende libero.
const N_UNTITLED: &str = "canvas.create.untitled";
const P_CREATE: &str = "canvas.create.p_create";
const N_CREATED: &str = "canvas.create.n_created";
const U_CREATE: &str = "canvas.create.u_create";
const E_NO_FORMAT: &str = "canvas.create.e_no_format";
const E_NAME_NOT_CANVAS: &str = "canvas.create.e_name_not_canvas";
const E_TAKEN: &str = "canvas.create.e_taken";
const E_SOURCE: &str = "canvas.create.e_source";
const E_NAME_EMPTY: &str = "canvas.create.e_name_empty";
const E_NAME_TRAVERSAL: &str = "canvas.create.e_name_traversal";
const E_NAME_MACHINE: &str = "canvas.create.e_name_machine";
const E_NAME_CONTROL: &str = "canvas.create.e_name_control";
const E_NAME_RESERVED: &str = "canvas.create.e_name_reserved";
const E_NAME_DEVICE: &str = "canvas.create.e_name_device";
const E_NAME_TRAILING_DOT: &str = "canvas.create.e_name_trailing_dot";
const E_NAME_HIDDEN: &str = "canvas.create.e_name_hidden";
const E_NAME_TOO_LONG: &str = "canvas.create.e_name_too_long";

const N_CHECK_SUMMARY: &str = "canvas.check.n_summary";
const N_CHECK_REFUSED: &str = "canvas.check.n_refused";
const E_READ_FORM: &str = "canvas.read.e_form";
const E_READ_IDS: &str = "canvas.read.e_ids";
const E_READ_MAX_CHARS: &str = "canvas.read.e_max_chars";
const E_READ_MAX_CHARS_FORM: &str = "canvas.read.e_max_chars_form";
const E_READ_WRITE: &str = "canvas.read.e_write";
const E_GUIDE_TOPIC: &str = "canvas.guide.e_topic";

const SIZE: &str = "size";
const E_PREVIEW_OPS: &str = "canvas.preview.e_ops";
const E_PREVIEW_SIZE: &str = "canvas.preview.e_size";
const E_PREVIEW_BASE: &str = "canvas.preview.e_base";
const E_PREVIEW_PNG: &str = "canvas.preview.e_png";

/// I comandi della lavagna.
pub struct LavagnaCommands;

impl CommandProvider for LavagnaCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(CANVAS_APPLY, Text::key(format!("{CANVAS_APPLY}.title")))
                .describing(Text::key(format!("{CANVAS_APPLY}.desc")))
                .with_param(parameter(CANVAS_APPLY, DOC, ParamKind::Document).required())
                .with_param(parameter(CANVAS_APPLY, OPS, ParamKind::Text).required())
                .with_param(parameter(CANVAS_APPLY, BASE, ParamKind::Text))
                .with_param(parameter(CANVAS_APPLY, SEED, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(CANVAS_CREATE, Text::key(format!("{CANVAS_CREATE}.title")))
                .describing(Text::key(format!("{CANVAS_CREATE}.desc")))
                .with_param(parameter(CANVAS_CREATE, NAME, ParamKind::Text))
                .with_param(parameter(CANVAS_CREATE, FOLDER, ParamKind::Text))
                // Un documento solo, e il cestino lo rende reversibile: lo
                // stesso raggio di `note.create` e di `drawing.create`.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(CANVAS_READ, Text::key(format!("{CANVAS_READ}.title")))
                .describing(Text::key(format!("{CANVAS_READ}.desc")))
                .with_param(parameter(CANVAS_READ, DOC, ParamKind::Document).required())
                .with_param(parameter(
                    CANVAS_READ,
                    FORM,
                    ParamKind::Choice(vec![
                        Choice::new("outline", Text::key("canvas.read.form.outline")),
                        Choice::new("code", Text::key("canvas.read.form.code")),
                        Choice::new("json", Text::key("canvas.read.form.json")),
                    ]),
                ))
                .with_param(parameter(CANVAS_READ, IDS, ParamKind::Text))
                .with_param(parameter(CANVAS_READ, MAX_CHARS, ParamKind::Number))
                .with_scope(CommandScope::read_only()),
            CommandSpec::new(CANVAS_CHECK, Text::key(format!("{CANVAS_CHECK}.title")))
                .describing(Text::key(format!("{CANVAS_CHECK}.desc")))
                .with_param(parameter(CANVAS_CHECK, DOC, ParamKind::Document).required())
                .with_param(parameter(CANVAS_CHECK, OPS, ParamKind::Text).required())
                .with_param(parameter(CANVAS_CHECK, BASE, ParamKind::Text))
                .with_param(parameter(CANVAS_CHECK, SEED, ParamKind::Text))
                .with_scope(CommandScope::read_only()),
            CommandSpec::new(CANVAS_GUIDE, Text::key(format!("{CANVAS_GUIDE}.title")))
                .describing(Text::key(format!("{CANVAS_GUIDE}.desc")))
                .with_param(parameter(CANVAS_GUIDE, TOPIC, ParamKind::Text))
                .with_scope(CommandScope::read_only()),
            CommandSpec::new(CANVAS_PREVIEW, Text::key(format!("{CANVAS_PREVIEW}.title")))
                .describing(Text::key(format!("{CANVAS_PREVIEW}.desc")))
                .with_param(parameter(CANVAS_PREVIEW, DOC, ParamKind::Document).required())
                .with_param(parameter(CANVAS_PREVIEW, OPS, ParamKind::Text))
                .with_param(parameter(CANVAS_PREVIEW, BASE, ParamKind::Text))
                .with_param(parameter(CANVAS_PREVIEW, SEED, ParamKind::Text))
                .with_param(parameter(CANVAS_PREVIEW, SIZE, ParamKind::Number))
                .with_scope(CommandScope::read_only()),
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
            CANVAS_APPLY => apply::canvas_apply(Args::new(&args), mode, host),
            CANVAS_CREATE => create::canvas_create(Args::new(&args), mode, host),
            CANVAS_READ => read::canvas_read(Args::new(&args), host),
            CANVAS_CHECK => check::canvas_check(Args::new(&args), host),
            CANVAS_GUIDE => guide::canvas_guide(Args::new(&args)),
            CANVAS_PREVIEW => preview::canvas_preview(Args::new(&args), host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

/// Il documento di un comando della lavagna: un argomento di tipo documento che
/// è una lavagna. Un altro formato, o nessun formato, è `BadArgs`.
fn canvas_doc(args: &Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    let doc = args
        .document(DOC)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    let is_canvas = host
        .format_of(&doc)
        .is_some_and(|format| format.descriptor.id == CANVAS_FORMAT);
    if !is_canvas {
        return Err(PluginError::BadArgs(about(E_NOT_CANVAS, &doc, Vec::new())));
    }
    Ok(doc)
}

/// Una frase che nomina il documento, più altri argomenti.
fn about(key: &str, doc: &DocId, mut args: Vec<Arg>) -> Text {
    args.insert(0, Arg::text("doc", doc.as_str()));
    Text::message(key, args)
}

/// Una lista di operazioni che non è JSON: `reason` è il motivo di serde, e
/// `problem` il primo problema della forma (o «-» se non c'è).
fn ops_json(reason: String, problem: String) -> PluginError {
    PluginError::BadArgs(Text::message(
        E_OPS_JSON,
        vec![Arg::text("reason", reason), Arg::text("problem", problem)],
    ))
}

/// Il seme dato: un intero decimale a 64 bit senza segno, come lo porta il
/// JSON (in stringa, perché un `u64` non ci sta in un numero JSON).
fn seed(raw: &str) -> Result<u64, PluginError> {
    raw.trim()
        .parse::<u64>()
        .map_err(|_| PluginError::BadArgs(Text::message(E_SEED, vec![Arg::text("seed", raw)])))
}

/// Una lavagna che il nucleo non sa leggere (R1–R10 di `canvas-format.md`).
fn opening(doc: &DocId, error: &CanvasError) -> PluginError {
    let key = match error {
        CanvasError::Limit { .. } => E_OPEN_LIMIT,
        CanvasError::Json(_) => E_OPEN_JSON,
        CanvasError::Invalid(_) => E_OPEN_INVALID,
    };
    PluginError::BadArgs(about(
        key,
        doc,
        vec![Arg::text("reason", error.to_string())],
    ))
}

/// Le frasi del componente, in italiano e in inglese: chiave, italiano,
/// inglese. Una tabella sola, così una lingua non resta indietro.
const STRINGS: &[(&str, &str, &str)] = &[
    (
        "canvas.apply.title",
        "Applica operazioni alla lavagna",
        "Apply operations to the whiteboard",
    ),
    (
        "canvas.apply.desc",
        "Aggiunge, sposta, collega e toglie schede di una lavagna in una modifica sola, che si annulla in un passo.",
        "Adds, moves, connects and removes cards of a whiteboard in a single change, undone in one step.",
    ),
    ("canvas.apply.doc.title", "Lavagna", "Whiteboard"),
    (
        "canvas.apply.doc.desc",
        "Il file .canvas da cambiare.",
        "The .canvas file to change.",
    ),
    ("canvas.apply.ops.title", "Operazioni", "Operations"),
    (
        "canvas.apply.ops.desc",
        "Una lista JSON di operazioni (add_card, move, resize, connect, remove, set, reorder).",
        "A JSON list of operations (add_card, move, resize, connect, remove, set, reorder).",
    ),
    ("canvas.apply.base.title", "Revisione di partenza", "Base revision"),
    (
        "canvas.apply.base.desc",
        "Se c'è, le operazioni valgono solo per questa revisione della lavagna.",
        "If given, the operations apply only to this revision of the whiteboard.",
    ),
    ("canvas.apply.seed.title", "Seme", "Seed"),
    (
        "canvas.apply.seed.desc",
        "Un intero da cui nascono gli id delle schede nuove; se manca viene dalla revisione.",
        "An integer the ids of new cards come from; if missing it comes from the revision.",
    ),
    (
        P_APPLY,
        "Applica {count} operazioni a {doc}",
        "Apply {count} operations to {doc}",
    ),
    (N_APPLIED, "Lavagna {doc} aggiornata.", "Whiteboard {doc} updated."),
    (
        N_UNCHANGED,
        "Le operazioni non cambiano {doc}.",
        "The operations do not change {doc}.",
    ),
    (
        U_APPLY,
        "Operazioni sulla lavagna {doc}",
        "Operations on the whiteboard {doc}",
    ),
    (E_NO_DOC, "Nessuna lavagna indicata.", "No whiteboard given."),
    (
        E_NOT_CANVAS,
        "{doc} non è una lavagna.",
        "{doc} is not a whiteboard.",
    ),
    (
        E_OPS_JSON,
        "Le operazioni non sono una lista JSON valida: {reason}. Primo problema (codice · percorso · suggerimento): {problem}.",
        "The operations are not a valid JSON list: {reason}. First problem (code · path · suggestion): {problem}.",
    ),
    (
        E_OPS_EMPTY,
        "Nessuna operazione da applicare.",
        "No operations to apply.",
    ),
    (
        E_SEED,
        "Il seme «{seed}» non è un intero da 0 a 18446744073709551615.",
        "The seed \"{seed}\" is not an integer from 0 to 18446744073709551615.",
    ),
    (
        E_BASE,
        "{doc} è cambiata dalla revisione indicata: rileggila e riprova.",
        "{doc} changed since the given revision: read it again and retry.",
    ),
    (
        E_OPEN_LIMIT,
        "{doc} è troppo grande per una lavagna: {reason}",
        "{doc} is too large for a whiteboard: {reason}",
    ),
    (
        E_OPEN_JSON,
        "{doc} non è JSON leggibile: {reason}",
        "{doc} is not readable JSON: {reason}",
    ),
    (
        E_OPEN_INVALID,
        "{doc} non è una lavagna valida: {reason}",
        "{doc} is not a valid whiteboard: {reason}",
    ),
    (
        E_OP_UNKNOWN_NODE,
        "Operazione {position}: non c'è la scheda «{id}».",
        "Operation {position}: there is no card \"{id}\".",
    ),
    (
        E_OP_UNKNOWN_EDGE,
        "Operazione {position}: non c'è né una scheda né un collegamento «{id}».",
        "Operation {position}: there is no card or connection \"{id}\".",
    ),
    (
        E_OP_DUPLICATE,
        "Operazione {position}: l'id «{id}» è già usato o ripetuto.",
        "Operation {position}: the id \"{id}\" is already taken or repeated.",
    ),
    (
        E_OP_TOO_MANY_NODES,
        "Operazione {position}: una lavagna ha al massimo {limit} schede.",
        "Operation {position}: a whiteboard holds at most {limit} cards.",
    ),
    (
        E_OP_TOO_MANY_EDGES,
        "Operazione {position}: una lavagna ha al massimo {limit} collegamenti.",
        "Operation {position}: a whiteboard holds at most {limit} connections.",
    ),
    (
        E_OP_INVALID,
        "Operazione {position}: {reason}",
        "Operation {position}: {reason}",
    ),
    (
        E_COMMIT_STALE,
        "Le operazioni non corrispondono più alla lavagna {doc}: riprova.",
        "The operations no longer match the whiteboard {doc}: retry.",
    ),
    (
        E_COMMIT_INVALID,
        "Dopo le operazioni {doc} non sarebbe una lavagna valida: {reason}",
        "After the operations {doc} would not be a valid whiteboard: {reason}",
    ),
    (
        E_COMMIT_REJECTED,
        "Il testo di {doc} non si può cambiare senza riscriverlo: {reason}",
        "The text of {doc} cannot be changed without rewriting it: {reason}",
    ),
    (
        E_COMMIT_UNSTABLE,
        "La lavagna {doc} scritta non si rilegge uguale: non l'ho cambiata.",
        "The written whiteboard {doc} does not read back the same: it was not changed.",
    ),
    ("canvas.create.title", "Nuova lavagna", "New whiteboard"),
    (
        "canvas.create.desc",
        "Crea una lavagna vuota e la apre. Senza nome nasce «Lavagna», e se quel nome è preso «Lavagna 1», «2», …",
        "Creates an empty whiteboard and opens it. Without a name it is called «Whiteboard», and if that name is taken «Whiteboard 1», «2», …",
    ),
    ("canvas.create.name.title", "Nome", "Name"),
    (
        "canvas.create.name.desc",
        "Il nome o il path della lavagna. Senza estensione riceve `.canvas`. Assente = «Lavagna».",
        "The name or the path of the whiteboard. Without an extension it gets `.canvas`. Absent = «Whiteboard».",
    ),
    ("canvas.create.folder.title", "Cartella", "Folder"),
    (
        "canvas.create.folder.desc",
        "La cartella in cui nasce una lavagna con un nome semplice. Assente = la radice del vault.",
        "The folder where a whiteboard with a plain name is created. Absent = the root of the vault.",
    ),
    (N_UNTITLED, "Lavagna", "Whiteboard"),
    (P_CREATE, "Crea la lavagna «{doc}»", "Create the whiteboard «{doc}»"),
    (N_CREATED, "Creata la lavagna «{doc}»", "Created the whiteboard «{doc}»"),
    (
        U_CREATE,
        "la creazione della lavagna «{doc}»",
        "the creation of the whiteboard «{doc}»",
    ),
    (
        E_NO_FORMAT,
        "Questo vault non apre le lavagne: nessun formato serve i file `.canvas`.",
        "This vault does not open whiteboards: no format serves `.canvas` files.",
    ),
    (
        E_NAME_NOT_CANVAS,
        "«{doc}» non è il nome di una lavagna: una lavagna è un file `.canvas`.",
        "«{doc}» is not the name of a whiteboard: a whiteboard is a `.canvas` file.",
    ),
    (
        E_TAKEN,
        "«{doc}» c'è già: una lavagna nuova non prende il posto di un file.",
        "«{doc}» already exists: a new whiteboard does not replace a file.",
    ),
    (
        E_SOURCE,
        "La lavagna «{doc}» non si è potuta scrivere: {reason}",
        "The whiteboard «{doc}» could not be written: {reason}",
    ),
    (
        E_NAME_EMPTY,
        "La lavagna non può chiamarsi «{doc}»: manca il nome.",
        "The whiteboard cannot be called «{doc}»: the name is missing.",
    ),
    (
        E_NAME_TRAVERSAL,
        "La lavagna non può chiamarsi «{doc}»: «.» e «..» non sono nomi.",
        "The whiteboard cannot be called «{doc}»: «.» and «..» are not names.",
    ),
    (
        E_NAME_MACHINE,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» è il modo in cui il vault è fatto, non ciò che contiene.",
        "The whiteboard cannot be called «{doc}»: «{segment}» is how the vault is made, not what it holds.",
    ),
    (
        E_NAME_CONTROL,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» contiene un carattere di controllo.",
        "The whiteboard cannot be called «{doc}»: «{segment}» contains a control character.",
    ),
    (
        E_NAME_RESERVED,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» contiene «{ch}», che un filesystem si riserva.",
        "The whiteboard cannot be called «{doc}»: «{segment}» contains «{ch}», which a filesystem reserves.",
    ),
    (
        E_NAME_DEVICE,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» è un nome che Windows si riserva.",
        "The whiteboard cannot be called «{doc}»: «{segment}» is a name Windows reserves.",
    ),
    (
        E_NAME_TRAILING_DOT,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» finisce con un punto, che Windows toglie.",
        "The whiteboard cannot be called «{doc}»: «{segment}» ends with a dot, which Windows removes.",
    ),
    (
        E_NAME_HIDDEN,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» comincia con un punto, e il vault non lo elencherebbe.",
        "The whiteboard cannot be called «{doc}»: «{segment}» starts with a dot, and the vault would not list it.",
    ),
    (
        E_NAME_TOO_LONG,
        "La lavagna non può chiamarsi «{doc}»: «{segment}» è troppo lungo (il massimo è {max} byte).",
        "The whiteboard cannot be called «{doc}»: «{segment}» is too long (at most {max} bytes).",
    ),
    (
        "canvas.read.title",
        "Leggi la lavagna",
        "Read the whiteboard",
    ),
    (
        "canvas.read.desc",
        "Legge una lavagna come testo, una riga per scheda; come la lista di operazioni che la ricrea; o come modello. Non scrive niente.",
        "Reads a whiteboard as text, one line per card; as the list of operations that recreates it; or as its model. Writes nothing.",
    ),
    ("canvas.read.doc.title", "Lavagna", "Whiteboard"),
    (
        "canvas.read.doc.desc",
        "Il file .canvas da leggere.",
        "The .canvas file to read.",
    ),
    ("canvas.read.form.title", "Forma", "Form"),
    (
        "canvas.read.form.desc",
        "outline (di serie): una riga per scheda e per arco. code: le operazioni che la ricreano. json: il modello.",
        "outline (default): one line per card and edge. code: the operations that recreate it. json: the model.",
    ),
    (
        "canvas.read.form.outline",
        "Una riga per scheda",
        "One line per card",
    ),
    (
        "canvas.read.form.code",
        "Le operazioni che la ricreano",
        "The operations that recreate it",
    ),
    (
        "canvas.read.form.json",
        "Il modello, come nel file",
        "The model, as in the file",
    ),
    ("canvas.read.ids.title", "Schede", "Cards"),
    (
        "canvas.read.ids.desc",
        "Una lista JSON di id: legge solo quelle schede e gli archi fra loro.",
        "A JSON list of ids: reads only those cards and the edges between them.",
    ),
    (
        "canvas.read.max_chars.title",
        "Caratteri al massimo",
        "Maximum characters",
    ),
    (
        "canvas.read.max_chars.desc",
        "Solo per la forma outline: taglia a una riga intera e dice quante ne restano. Assente = 20 000.",
        "Only for the outline form: cuts at a whole line and says how many remain. Absent = 20 000.",
    ),
    (
        E_READ_FORM,
        "La forma «{form}» non c'è: si legge come outline, code o json.",
        "The form \"{form}\" does not exist: read it as outline, code or json.",
    ),
    (
        E_READ_IDS,
        "Gli id non sono una lista JSON di testi, come [\"t1\", \"t2\"].",
        "The ids are not a JSON list of strings, like [\"t1\", \"t2\"].",
    ),
    (
        E_READ_MAX_CHARS,
        "max_chars vuole un intero da zero in su.",
        "max_chars wants a whole number from zero up.",
    ),
    (
        E_READ_MAX_CHARS_FORM,
        "max_chars vale solo per la forma outline: {form} si legge intera.",
        "max_chars applies only to the outline form: {form} is read whole.",
    ),
    (
        E_READ_WRITE,
        "La lettura di {doc} non si scrive come JSON.",
        "The reading of {doc} cannot be written as JSON.",
    ),
    (
        "canvas.check.title",
        "Controlla le operazioni",
        "Check the operations",
    ),
    (
        "canvas.check.desc",
        "Dice che cosa cambierebbe una lista di operazioni, con gli avvisi e i problemi. Non scrive niente.",
        "Says what a list of operations would change, with warnings and problems. Writes nothing.",
    ),
    ("canvas.check.doc.title", "Lavagna", "Whiteboard"),
    (
        "canvas.check.doc.desc",
        "Il file .canvas da controllare.",
        "The .canvas file to check.",
    ),
    ("canvas.check.ops.title", "Operazioni", "Operations"),
    (
        "canvas.check.ops.desc",
        "Una lista JSON di operazioni, come in canvas.apply.",
        "A JSON list of operations, as in canvas.apply.",
    ),
    ("canvas.check.base.title", "Revisione di partenza", "Base revision"),
    (
        "canvas.check.base.desc",
        "Se la lavagna è cambiata da questa revisione, c'è il problema «stale_base».",
        "If the whiteboard changed since this revision, there is the problem \"stale_base\".",
    ),
    ("canvas.check.seed.title", "Seme", "Seed"),
    (
        "canvas.check.seed.desc",
        "Lo stesso seme di canvas.apply: così gli id del controllo sono quelli della scrittura.",
        "The same seed as canvas.apply: so the ids of the check are those of the write.",
    ),
    (
        N_CHECK_SUMMARY,
        "Si può scrivere: schede nuove {added}, cambiate {changed}, tolte {removed}; archi toccati {edges}; avvisi {warnings}.",
        "It can be written: new cards {added}, changed {changed}, removed {removed}; edges touched {edges}; warnings {warnings}.",
    ),
    (
        N_CHECK_REFUSED,
        "Non si scrive: problemi {problems}.",
        "Not written: problems {problems}.",
    ),
    (
        "canvas.check.p_invalid",
        "La lista o un'operazione non si può scrivere così com'è.",
        "The list or an operation cannot be written as it is.",
    ),
    (
        "canvas.check.p_unknown_op",
        "Il nome dell'operazione non c'è: i nomi sono in canvas.guide.",
        "The operation name does not exist: the names are in canvas.guide.",
    ),
    (
        "canvas.check.p_unknown_field",
        "L'operazione non ha questo campo.",
        "The operation has no such field.",
    ),
    (
        "canvas.check.p_missing_field",
        "Manca un campo obbligatorio.",
        "A required field is missing.",
    ),
    (
        "canvas.check.p_wrong_type",
        "Un valore ha il tipo sbagliato.",
        "A value has the wrong type.",
    ),
    (
        "canvas.check.p_bad_value",
        "Un valore non è fra quelli ammessi.",
        "A value is not one of the allowed ones.",
    ),
    (
        "canvas.check.p_unknown_node",
        "Non c'è una scheda con questo id.",
        "There is no card with this id.",
    ),
    (
        "canvas.check.p_unknown_edge",
        "Non c'è né una scheda né un arco con questo id.",
        "There is neither a card nor an edge with this id.",
    ),
    (
        "canvas.check.p_duplicate_id",
        "L'id è già preso, o è ripetuto.",
        "The id is already taken, or repeated.",
    ),
    (
        "canvas.check.p_too_many",
        "La lavagna avrebbe troppe schede o troppi archi.",
        "The whiteboard would have too many cards or edges.",
    ),
    (
        "canvas.check.p_stale_base",
        "La lavagna è cambiata dalla revisione indicata: rileggila.",
        "The whiteboard changed since the given revision: read it again.",
    ),
    (
        "canvas.guide.title",
        "Guida alla lavagna",
        "Whiteboard guide",
    ),
    (
        "canvas.guide.desc",
        "La guida per scrivere una lavagna con le operazioni: il testo, i nomi, lo schema e gli esempi.",
        "The guide to writing a whiteboard with operations: the text, the names, the schema and the examples.",
    ),
    (
        "canvas.guide.topic.title",
        "Operazione",
        "Operation",
    ),
    (
        "canvas.guide.topic.desc",
        "Il nome di un'operazione: solo la sua voce, il suo schema e i suoi esempi. Assente = tutte.",
        "The name of an operation: only its entry, its schema and its examples. Absent = all.",
    ),
    (
        E_GUIDE_TOPIC,
        "Non c'è un'operazione «{topic}»: prova con {near}.",
        "There is no operation \"{topic}\": try {near}.",
    ),
    (
        "canvas.preview.title",
        "Anteprima della lavagna",
        "Whiteboard preview",
    ),
    (
        "canvas.preview.desc",
        "Disegna una lavagna come immagine, per vederne la forma: un PNG con draw, altrimenti l'SVG come testo. Con le operazioni disegna la lavagna di dopo, senza scriverla. Non scrive niente.",
        "Draws a whiteboard as an image, to see its shape: a PNG with draw, otherwise the SVG as text. With operations it draws the whiteboard after them, without writing it. Writes nothing.",
    ),
    ("canvas.preview.doc.title", "Lavagna", "Whiteboard"),
    (
        "canvas.preview.doc.desc",
        "Il file .canvas da disegnare.",
        "The .canvas file to draw.",
    ),
    ("canvas.preview.ops.title", "Operazioni", "Operations"),
    (
        "canvas.preview.ops.desc",
        "Una lista JSON di operazioni: si disegna la lavagna di dopo, senza scriverla. Assente = la lavagna com'è.",
        "A JSON list of operations: draws the whiteboard after them, without writing it. Absent = the whiteboard as it is.",
    ),
    (
        "canvas.preview.base.title",
        "Revisione di partenza",
        "Base revision",
    ),
    (
        "canvas.preview.base.desc",
        "La revisione che la lista ha letto: se la lavagna è cambiata, l'anteprima non si fa.",
        "The revision the list read: if the whiteboard changed, the preview is not made.",
    ),
    ("canvas.preview.seed.title", "Seme", "Seed"),
    (
        "canvas.preview.seed.desc",
        "Il seme degli id nuovi, come in canvas.apply. Assente = la revisione.",
        "The seed of the new ids, as in canvas.apply. Absent = the revision.",
    ),
    ("canvas.preview.size.title", "Lato lungo", "Long side"),
    (
        "canvas.preview.size.desc",
        "I pixel del lato lungo, da 64 a 2048. Assente = 1024.",
        "The pixels of the long side, from 64 to 2048. Absent = 1024.",
    ),
    (
        E_PREVIEW_OPS,
        "La lista non si può disegnare: l'operazione {position} dà «{code}» ({reason}).",
        "The list cannot be drawn: operation {position} gives \"{code}\" ({reason}).",
    ),
    (
        E_PREVIEW_SIZE,
        "size vuole un intero da zero in su.",
        "size wants a whole number from zero up.",
    ),
    (
        E_PREVIEW_BASE,
        "La lavagna è cambiata dalla revisione indicata: l'anteprima non si fa, rileggila.",
        "The whiteboard changed since the given revision: the preview is not made, read it again.",
    ),
    (
        E_PREVIEW_PNG,
        "Il disegno non si è potuto rasterizzare: {reason}.",
        "The drawing could not be rasterized: {reason}.",
    ),
];

/// Le stringhe del componente.
pub fn catalog() -> Vec<StringCatalog> {
    let mut it = StringCatalog::new("it");
    let mut en = StringCatalog::new("en");
    for (key, italiano, english) in STRINGS {
        it = it.with(*key, *italiano);
        en = en.with(*key, *english);
    }
    vec![it, en]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ogni_chiave_di_errore_e_nelle_due_lingue() {
        let catalogs = catalog();
        let keys = [
            P_APPLY,
            N_APPLIED,
            N_UNCHANGED,
            U_APPLY,
            E_NO_DOC,
            E_NOT_CANVAS,
            E_OPS_JSON,
            E_OPS_EMPTY,
            E_SEED,
            E_BASE,
            E_OPEN_LIMIT,
            E_OPEN_JSON,
            E_OPEN_INVALID,
            E_OP_UNKNOWN_NODE,
            E_OP_UNKNOWN_EDGE,
            E_OP_DUPLICATE,
            E_OP_TOO_MANY_NODES,
            E_OP_TOO_MANY_EDGES,
            E_OP_INVALID,
            E_COMMIT_STALE,
            E_COMMIT_INVALID,
            E_COMMIT_REJECTED,
            E_COMMIT_UNSTABLE,
            N_UNTITLED,
            P_CREATE,
            N_CREATED,
            U_CREATE,
            E_NO_FORMAT,
            E_NAME_NOT_CANVAS,
            E_TAKEN,
            E_SOURCE,
            E_NAME_EMPTY,
            E_NAME_TRAVERSAL,
            E_NAME_MACHINE,
            E_NAME_CONTROL,
            E_NAME_RESERVED,
            E_NAME_DEVICE,
            E_NAME_TRAILING_DOT,
            E_NAME_HIDDEN,
            E_NAME_TOO_LONG,
            N_CHECK_SUMMARY,
            N_CHECK_REFUSED,
            E_READ_FORM,
            E_READ_IDS,
            E_READ_MAX_CHARS,
            E_READ_MAX_CHARS_FORM,
            E_READ_WRITE,
            E_GUIDE_TOPIC,
            E_PREVIEW_OPS,
            E_PREVIEW_SIZE,
            E_PREVIEW_BASE,
            E_PREVIEW_PNG,
        ];
        for catalog in &catalogs {
            for key in keys {
                assert!(
                    catalog.entries.contains_key(key),
                    "«{key}» manca in «{}»",
                    catalog.locale
                );
            }
        }
        assert_eq!(catalogs.len(), 2);
        assert_eq!(catalogs[0].entries.len(), STRINGS.len());
    }

    /// Ogni codice che il payload di `canvas.check` può dare ha la sua frase,
    /// in tutte e due le lingue: la rende il catalogo, non il payload.
    #[test]
    fn ogni_codice_di_problema_ha_la_sua_frase() {
        let catalogs = catalog();
        for code in check::CODES {
            let key = format!("canvas.check.p_{code}");
            for catalog in &catalogs {
                assert!(
                    catalog.entries.contains_key(key.as_str()),
                    "«{key}» manca in «{}»",
                    catalog.locale
                );
            }
        }
    }

    use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
    use fub_abi::text::{ArgValue, Message, Text};
    use fub_sdk::testing::MemoryHost;
    use serde_json::{json, Value};

    /// Un host con una lavagna, una nota e una lavagna che non si apre. Gli errori
    /// si provano sul provider: il kernel li rende nella lingua di sistema, e lì
    /// la chiave del catalogo non si vede più.
    fn host() -> MemoryHost {
        MemoryHost::new()
            .with_format(
                "canvas",
                DocumentFormat {
                    descriptor: FormatDescriptor::text(CANVAS_FORMAT, "Canvas", &["canvas"]),
                    capabilities: FormatCapabilities::default(),
                },
            )
            .with_document("Idee.canvas", r#"{"nodes": [], "edges": []}"#)
            .with_document("Nota.md", "# Nota\n")
            .with_document("Rotta.canvas", "{\"nodes\": [")
    }

    /// Il rifiuto di un comando, com'è uscito dal provider.
    fn refusal(command: &str, args: Value) -> PluginError {
        let mut host = host();
        LavagnaCommands
            .invoke(command, args, InvokeMode::Apply, &mut host)
            .expect_err("il comando rifiuta")
    }

    /// Il messaggio di un errore di argomenti: la chiave, e i suoi argomenti.
    fn message(error: &PluginError) -> &Message {
        let PluginError::BadArgs(text) = error else {
            panic!("un errore di argomenti, non {error:?}");
        };
        text.as_message().expect("un messaggio del catalogo")
    }

    fn arg(error: &PluginError, name: &str) -> String {
        match message(error).arg(name) {
            Some(ArgValue::Text(value)) => value.clone(),
            other => panic!("l'argomento «{name}» non è un testo: {other:?}"),
        }
    }

    /// La notifica del controllo: il riassunto con i conti se si scrive, il
    /// conto dei problemi se no. Le chiavi si vedono solo qui: il kernel le rende.
    #[test]
    fn la_notifica_del_controllo_porta_i_conti() {
        let mut host = host();
        let add = json!([{ "op": "add_card", "node": { "id": "n", "type": "text", "x": 0, "y": 0, "width": 200, "height": 160, "text": "x" } }]);
        let summary = LavagnaCommands
            .invoke(
                CANVAS_CHECK,
                json!({ "doc": "Idee.canvas", "ops": add.to_string() }),
                InvokeMode::Apply,
                &mut host,
            )
            .expect("il rapporto");
        let text = summary
            .notify
            .as_ref()
            .and_then(Text::as_message)
            .expect("un riassunto");
        assert_eq!(text.key, "canvas.check.n_summary");
        assert_eq!(text.arg("added"), Some(&ArgValue::Int(1)));
        assert_eq!(text.arg("edges"), Some(&ArgValue::Int(0)));

        let refused = LavagnaCommands
            .invoke(
                CANVAS_CHECK,
                json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"fly\"}]" }),
                InvokeMode::Apply,
                &mut host,
            )
            .expect("il rapporto");
        let text = refused
            .notify
            .as_ref()
            .and_then(Text::as_message)
            .expect("un conto");
        assert_eq!(text.key, "canvas.check.n_refused");
        assert_eq!(text.arg("problems"), Some(&ArgValue::Int(1)));
    }

    #[test]
    fn leggere_rifiuta_con_le_sue_chiavi() {
        let form = refusal(CANVAS_READ, json!({ "doc": "Idee.canvas", "form": "xml" }));
        assert_eq!(message(&form).key, "canvas.read.e_form");
        assert_eq!(arg(&form, "form"), "xml");

        let ids = refusal(
            CANVAS_READ,
            json!({ "doc": "Idee.canvas", "ids": "non è JSON" }),
        );
        assert_eq!(message(&ids).key, "canvas.read.e_ids");

        let negative = refusal(
            CANVAS_READ,
            json!({ "doc": "Idee.canvas", "max_chars": -1 }),
        );
        assert_eq!(message(&negative).key, "canvas.read.e_max_chars");

        let code = refusal(
            CANVAS_READ,
            json!({ "doc": "Idee.canvas", "form": "code", "max_chars": 10 }),
        );
        assert_eq!(message(&code).key, "canvas.read.e_max_chars_form");
        assert_eq!(arg(&code, "form"), "code");
    }

    #[test]
    fn un_documento_che_non_e_una_lavagna_o_non_si_apre_ha_le_chiavi_di_apply() {
        let nota = json!({ "doc": "Nota.md", "ops": "[{\"op\":\"remove\",\"ids\":[\"a\"]}]" });
        for name in [CANVAS_READ, CANVAS_CHECK, CANVAS_APPLY] {
            let error = refusal(name, nota.clone());
            assert_eq!(message(&error).key, "canvas.apply.e_not_canvas", "{name}");
        }

        let rotta =
            json!({ "doc": "Rotta.canvas", "ops": "[{\"op\":\"remove\",\"ids\":[\"a\"]}]" });
        let apply = refusal(CANVAS_APPLY, rotta.clone());
        let expected = message(&apply).key.clone();
        assert!(expected.starts_with("canvas.apply.e_open_"), "{expected}");
        for name in [CANVAS_READ, CANVAS_CHECK] {
            let error = refusal(name, rotta.clone());
            assert_eq!(message(&error).key, expected, "{name}");
        }
    }

    #[test]
    fn controllare_rifiuta_il_testo_che_non_e_json_senza_problema_della_forma() {
        let error = refusal(
            CANVAS_CHECK,
            json!({ "doc": "Idee.canvas", "ops": "non è JSON" }),
        );
        assert_eq!(message(&error).key, "canvas.apply.e_ops_json");
        assert_eq!(arg(&error, "problem"), "-");
    }

    #[test]
    fn apply_con_una_lista_che_non_si_legge_nomina_il_primo_problema() {
        let error = refusal(
            CANVAS_APPLY,
            json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"fly\"}]" }),
        );
        assert_eq!(message(&error).key, "canvas.apply.e_ops_json");
        assert_eq!(arg(&error, "problem"), "unknown_op · /0/op");

        // Con un nome vicino, il vicino fa parte del problema.
        let near = refusal(
            CANVAS_APPLY,
            json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"moev\",\"ids\":[\"a\"],\"dx\":1,\"dy\":1}]" }),
        );
        assert_eq!(arg(&near, "problem"), "unknown_op · /0/op · move");
    }

    #[test]
    fn la_guida_rifiuta_un_topic_sconosciuto_con_i_nomi_vicini() {
        let near = refusal(CANVAS_GUIDE, json!({ "topic": "mvoe" }));
        assert_eq!(message(&near).key, "canvas.guide.e_topic");
        assert_eq!(arg(&near, "topic"), "mvoe");
        assert_eq!(arg(&near, "near"), "move");

        // Senza vicini, la frase elenca tutti i nomi.
        let far = refusal(CANVAS_GUIDE, json!({ "topic": "xyzzy" }));
        let names = arg(&far, "near");
        assert!(
            names.contains("add_card") && names.contains("reorder"),
            "{names}"
        );
    }

    /// `canvas.preview` rifiuta con le sue chiavi: una lista che non si disegna
    /// dice l'operazione e il codice del primo problema, un lato che non è un
    /// intero dice la sua chiave. Le chiavi si vedono solo qui: il kernel le rende.
    #[test]
    fn il_disegno_rifiuta_con_le_sue_chiavi() {
        let unknown = refusal(
            CANVAS_PREVIEW,
            json!({ "doc": "Idee.canvas", "ops": json!([{ "op": "move", "ids": ["manca"], "dx": 1, "dy": 0 }]).to_string() }),
        );
        assert_eq!(message(&unknown).key, "canvas.preview.e_ops");
        assert_eq!(arg(&unknown, "position"), "1");
        assert_eq!(arg(&unknown, "code"), "unknown_node");

        // Una lista vuota non ha un'operazione: la posizione è «-».
        let empty = refusal(CANVAS_PREVIEW, json!({ "doc": "Idee.canvas", "ops": "[]" }));
        assert_eq!(message(&empty).key, "canvas.preview.e_ops");
        assert_eq!(arg(&empty, "position"), "-");

        let size = refusal(CANVAS_PREVIEW, json!({ "doc": "Idee.canvas", "size": 1.5 }));
        assert_eq!(message(&size).key, "canvas.preview.e_size");

        let not_json = refusal(
            CANVAS_PREVIEW,
            json!({ "doc": "Idee.canvas", "ops": "non json" }),
        );
        assert_eq!(message(&not_json).key, "canvas.apply.e_ops_json");
    }
}
