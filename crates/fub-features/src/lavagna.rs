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
//! L'editor della lavagna sta nel client (`editors/canvas`): questo modulo è
//! la strada per chi la cambia senza vederla, cioè la palette, la riga di
//! comando e un agente.
//!
//! # Le impostazioni
//!
//! [`settings`] dichiara le dodici impostazioni del gruppo «Lavagna», nell'ordine
//! del pannello. Le prime cinque sono della macchina, come i modi di scrivere e
//! di toccare di questo computer; le altre sono del vault. Due dicono come si
//! scrive e si tocca: [`CANVAS_INK_MOUSE_REMEMBER_KEY`] fa ricordare a ogni
//! lavagna del computer se «Scrivi col mouse» era acceso, e
//! [`CANVAS_FINGER_MOVES_CARD_KEY`] lascia al dito spostare la scheda che tocca.
//! Le altre regolano il tasto della penna, la rotella, lo spazio di lavoro, la
//! colonna, la griglia, l'aggancio, le parti di una nota e dove vanno i file
//! trascinati. Le legge l'editor della lavagna (`editors/canvas/preferences.ts`
//! nel client), che le segue dal vivo; il test del client
//! `editors/canvas/settings-mirror.test.ts` confronta nomi, valori e ambiti.

mod apply;
mod create;

use fub_abi::command::{
    CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use fub_abi::ui::UiOption;

/// L'id del componente, lo stesso della sua riga nella mappa.
pub const LAVAGNA_ID: &str = "fub.lavagna";

/// Applica una lista di operazioni a una lavagna.
pub const CANVAS_APPLY: &str = "canvas.apply";

/// Crea una lavagna vuota e la apre.
pub const CANVAS_CREATE: &str = "canvas.create";

/// Il namespace dell'effetto che dice che cosa ha fatto `canvas.apply`.
pub const LAVAGNA_NS: &str = LAVAGNA_ID;

/// L'impostazione «Ricorda se scrivi col mouse»: accesa, ogni lavagna del
/// computer si apre con «Scrivi col mouse» come l'ha lasciato l'ultima.
pub const CANVAS_INK_MOUSE_REMEMBER_KEY: &str = "canvas.ink_mouse_remember";

/// L'impostazione «Il dito sposta le schede»: accesa, il dito sposta la
/// scheda che tocca, e la lavagna solo dove non ci sono schede.
pub const CANVAS_FINGER_MOVES_CARD_KEY: &str = "canvas.finger_moves_card";

/// L'impostazione «Il dito scrive»: acceso, su uno schermo touch un dito scrive
/// con la penna scelta, come una penna vera.
pub const CANVAS_FINGER_WRITES_KEY: &str = "canvas.finger_writes";

/// L'impostazione «Il tasto della penna»: che cosa fa il tasto sul fianco della
/// penna. Il primo valore è quello di serie.
pub const CANVAS_PEN_BUTTON_KEY: &str = "canvas.pen_button";
/// I valori di [`CANVAS_PEN_BUTTON_KEY`], nell'ordine dei pulsanti.
pub const CANVAS_PEN_BUTTON_VALUES: [&str; 3] = ["radial", "eraser", "pan"];

/// L'impostazione «La rotella del mouse»: che cosa fa fuori da una scheda attiva.
pub const CANVAS_WHEEL_KEY: &str = "canvas.wheel";
/// I valori di [`CANVAS_WHEEL_KEY`]. Il primo è quello di serie.
pub const CANVAS_WHEEL_VALUES: [&str; 2] = ["pan", "zoom"];

/// L'impostazione «Spazio di lavoro»: quanti strumenti e pannelli mostra la
/// lavagna.
pub const CANVAS_WORKSPACE_KEY: &str = "canvas.workspace";
/// I valori di [`CANVAS_WORKSPACE_KEY`]. Il primo è quello di serie.
pub const CANVAS_WORKSPACE_VALUES: [&str; 3] = ["auto", "full", "simple"];

/// L'impostazione «Strumenti della colonna»: gli strumenti della colonna, nell'ordine
/// in cui compaiono. Una lista vuota vale quella di serie.
pub const CANVAS_TOOLBAR_KEY: &str = "canvas.toolbar";

/// L'impostazione «Griglia»: mostra i punti della griglia sulla lavagna.
pub const CANVAS_GRID_KEY: &str = "canvas.grid";

/// L'impostazione «Aggancia le schede»: i bordi di una scheda che si sposta o si
/// ridimensiona si agganciano alle schede vicine e alla griglia.
pub const CANVAS_SNAP_KEY: &str = "canvas.snap";

/// L'impostazione «Scegli le parti di una nota»: a una nota con titoli, portata
/// sulla lavagna, si apre l'elenco delle sue parti.
pub const CANVAS_PARTS_PICKER_KEY: &str = "canvas.parts_picker";

/// L'impostazione «Dove vanno i file trascinati»: dove si copiano i file portati
/// sulla lavagna dal computer, o incollati. Il primo valore è quello di serie.
pub const CANVAS_DROP_FOLDER_KEY: &str = "canvas.drop_folder";
/// I valori di [`CANVAS_DROP_FOLDER_KEY`]. Il primo è quello di serie.
pub const CANVAS_DROP_FOLDER_VALUES: [&str; 3] = ["notes", "board", "folder"];

/// L'impostazione «Cartella dei file trascinati»: il nome della cartella accanto
/// alla lavagna, o il percorso nel vault per il valore `folder`. Il percorso non
/// si controlla qui: il client, che lo usa, riporta a [`CANVAS_DROP_FOLDER_PATH_DEFAULT`]
/// un nome che non va bene.
pub const CANVAS_DROP_FOLDER_PATH_KEY: &str = "canvas.drop_folder_path";
/// Il valore di serie di [`CANVAS_DROP_FOLDER_PATH_KEY`].
pub const CANVAS_DROP_FOLDER_PATH_DEFAULT: &str = "Allegati";

const DOC: &str = "doc";
const OPS: &str = "ops";
const BASE: &str = "base";
const SEED: &str = "seed";
const NAME: &str = "name";
const FOLDER: &str = "folder";

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
const E_OP_UNKNOWN_STROKE: &str = "canvas.apply.e_op_unknown_stroke";
const E_OP_FOREIGN_LAYER: &str = "canvas.apply.e_op_foreign_layer";
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

const S_GROUP: &str = "s_group";
const S_INK_MOUSE_REMEMBER: &str = "s_ink_mouse_remember";
const S_INK_MOUSE_REMEMBER_DESC: &str = "s_ink_mouse_remember_desc";
const S_FINGER_MOVES_CARD: &str = "s_finger_moves_card";
const S_FINGER_MOVES_CARD_DESC: &str = "s_finger_moves_card_desc";
const S_FINGER_WRITES: &str = "s_finger_writes";
const S_FINGER_WRITES_DESC: &str = "s_finger_writes_desc";
const S_PEN_BUTTON: &str = "s_pen_button";
const S_PEN_BUTTON_DESC: &str = "s_pen_button_desc";
const S_PEN_BUTTON_RADIAL: &str = "s_pen_button_radial";
const S_PEN_BUTTON_ERASER: &str = "s_pen_button_eraser";
const S_PEN_BUTTON_PAN: &str = "s_pen_button_pan";
const S_WHEEL: &str = "s_wheel";
const S_WHEEL_DESC: &str = "s_wheel_desc";
const S_WHEEL_PAN: &str = "s_wheel_pan";
const S_WHEEL_ZOOM: &str = "s_wheel_zoom";
const S_WORKSPACE: &str = "s_workspace";
const S_WORKSPACE_DESC: &str = "s_workspace_desc";
const S_WORKSPACE_AUTO: &str = "s_workspace_auto";
const S_WORKSPACE_FULL: &str = "s_workspace_full";
const S_WORKSPACE_SIMPLE: &str = "s_workspace_simple";
const S_TOOLBAR: &str = "s_toolbar";
const S_TOOLBAR_DESC: &str = "s_toolbar_desc";
const S_GRID: &str = "s_grid";
const S_GRID_DESC: &str = "s_grid_desc";
const S_SNAP: &str = "s_snap";
const S_SNAP_DESC: &str = "s_snap_desc";
const S_PARTS_PICKER: &str = "s_parts_picker";
const S_PARTS_PICKER_DESC: &str = "s_parts_picker_desc";
const S_DROP_FOLDER: &str = "s_drop_folder";
const S_DROP_FOLDER_DESC: &str = "s_drop_folder_desc";
const S_DROP_FOLDER_NOTES: &str = "s_drop_folder_notes";
const S_DROP_FOLDER_BOARD: &str = "s_drop_folder_board";
const S_DROP_FOLDER_FOLDER: &str = "s_drop_folder_folder";
const S_DROP_FOLDER_PATH: &str = "s_drop_folder_path";
const S_DROP_FOLDER_PATH_DESC: &str = "s_drop_folder_path_desc";

/// Lo schema delle impostazioni della lavagna: le dodici del gruppo «Lavagna»,
/// nell'ordine del pannello.
///
/// Le prime cinque sono della **macchina**, come i suggerimenti dei disegni:
/// dicono come si scrive e si tocca su questo computer (un mouse, uno schermo
/// touch, una penna), non che cosa contiene il vault, e su un vault condiviso
/// non cambiano le mani degli altri. Le altre sono del **vault**: la colonna,
/// la griglia e i file trascinati appartengono a quella lavagna. Li scrive chi
/// usa Fub dalle Impostazioni; nessuna è `program_writable`.
///
/// Il valore di una scelta è il suo id stabile, il primo della lista è quello di
/// serie; la frase che lo mostra sta nel catalogo, in italiano e in inglese.
pub fn settings() -> Vec<SettingSpec> {
    vec![
        row(
            CANVAS_INK_MOUSE_REMEMBER_KEY,
            S_INK_MOUSE_REMEMBER,
            S_INK_MOUSE_REMEMBER_DESC,
            SettingKind::Toggle { default: false },
        )
        .for_machine(),
        row(
            CANVAS_FINGER_MOVES_CARD_KEY,
            S_FINGER_MOVES_CARD,
            S_FINGER_MOVES_CARD_DESC,
            SettingKind::Toggle { default: false },
        )
        .for_machine(),
        row(
            CANVAS_FINGER_WRITES_KEY,
            S_FINGER_WRITES,
            S_FINGER_WRITES_DESC,
            SettingKind::Toggle { default: false },
        )
        .for_machine(),
        row(
            CANVAS_PEN_BUTTON_KEY,
            S_PEN_BUTTON,
            S_PEN_BUTTON_DESC,
            choice(
                &CANVAS_PEN_BUTTON_VALUES,
                &[S_PEN_BUTTON_RADIAL, S_PEN_BUTTON_ERASER, S_PEN_BUTTON_PAN],
            ),
        )
        .for_machine(),
        row(
            CANVAS_WHEEL_KEY,
            S_WHEEL,
            S_WHEEL_DESC,
            choice(&CANVAS_WHEEL_VALUES, &[S_WHEEL_PAN, S_WHEEL_ZOOM]),
        )
        .for_machine(),
        row(
            CANVAS_WORKSPACE_KEY,
            S_WORKSPACE,
            S_WORKSPACE_DESC,
            choice(
                &CANVAS_WORKSPACE_VALUES,
                &[S_WORKSPACE_AUTO, S_WORKSPACE_FULL, S_WORKSPACE_SIMPLE],
            ),
        ),
        row(
            CANVAS_TOOLBAR_KEY,
            S_TOOLBAR,
            S_TOOLBAR_DESC,
            SettingKind::List {
                default: Vec::new(),
            },
        ),
        row(
            CANVAS_GRID_KEY,
            S_GRID,
            S_GRID_DESC,
            SettingKind::Toggle { default: true },
        ),
        row(
            CANVAS_SNAP_KEY,
            S_SNAP,
            S_SNAP_DESC,
            SettingKind::Toggle { default: true },
        ),
        row(
            CANVAS_PARTS_PICKER_KEY,
            S_PARTS_PICKER,
            S_PARTS_PICKER_DESC,
            SettingKind::Toggle { default: true },
        ),
        row(
            CANVAS_DROP_FOLDER_KEY,
            S_DROP_FOLDER,
            S_DROP_FOLDER_DESC,
            choice(
                &CANVAS_DROP_FOLDER_VALUES,
                &[
                    S_DROP_FOLDER_NOTES,
                    S_DROP_FOLDER_BOARD,
                    S_DROP_FOLDER_FOLDER,
                ],
            ),
        ),
        row(
            CANVAS_DROP_FOLDER_PATH_KEY,
            S_DROP_FOLDER_PATH,
            S_DROP_FOLDER_PATH_DESC,
            SettingKind::Text {
                default: CANVAS_DROP_FOLDER_PATH_DEFAULT.to_string(),
            },
        ),
    ]
}

/// Una riga della sezione «Lavagna»: la chiave, il nome, la descrizione e la
/// specie. Ambito di serie il vault; chi è della macchina lo dice con
/// `for_machine`.
fn row(key: &str, label: &str, description: &str, kind: SettingKind) -> SettingSpec {
    SettingSpec::new(key, Text::key(label), kind)
        .describing(Text::key(description))
        .grouped(Text::key(S_GROUP))
}

/// Una scelta fra `values`, ognuno con la frase di `labels` nello stesso ordine.
/// Il primo valore è quello di serie.
fn choice(values: &[&str], labels: &[&str]) -> SettingKind {
    SettingKind::Choice {
        default: values.first().copied().unwrap_or_default().to_string(),
        options: values
            .iter()
            .zip(labels)
            .map(|(value, label)| UiOption::new(*value, Text::key(*label)))
            .collect(),
    }
}

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
            CANVAS_APPLY => apply::canvas_apply(fub_abi::command::Args::new(&args), mode, host),
            CANVAS_CREATE => create::canvas_create(fub_abi::command::Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
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
        "Le operazioni non sono una lista JSON valida: {reason}",
        "The operations are not a valid JSON list: {reason}",
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
        E_OP_UNKNOWN_STROKE,
        "Operazione {position}: nell'inchiostro non c'è il tratto «{id}».",
        "Operation {position}: there is no stroke \"{id}\" in the ink.",
    ),
    (
        E_OP_FOREIGN_LAYER,
        "Operazione {position}: questo inchiostro non è scritto da Fub, e Fub non lo modifica.",
        "Operation {position}: this ink was not written by Fub, and Fub does not change it.",
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
    (S_GROUP, "Lavagna", "Whiteboard"),
    (
        S_INK_MOUSE_REMEMBER,
        "Ricorda se scrivi col mouse",
        "Remember whether you write with the mouse",
    ),
    (
        S_INK_MOUSE_REMEMBER_DESC,
        "Riaprendo una lavagna, l'interruttore «Scrivi col mouse» resta come l'hai lasciato. Spenta, la lavagna si apre sempre con l'interruttore spento. Il tasto D funziona sempre.",
        "When you reopen a whiteboard, the «Write with the mouse» switch stays as you left it. Off, the whiteboard always opens with the switch off. The D key always works.",
    ),
    (
        S_FINGER_MOVES_CARD,
        "Il dito sposta le schede",
        "A finger moves the cards",
    ),
    (
        S_FINGER_MOVES_CARD_DESC,
        "Sullo schermo touch il dito sposta la scheda che tocca, e la lavagna solo dove non ci sono schede. Spenta, il dito sposta sempre la lavagna e una scheda si sposta dalla sua testata. Due dita ingrandiscono sempre.",
        "On a touch screen a finger moves the card it touches, and the whiteboard only where there are no cards. Off, a finger always moves the whiteboard and a card moves by its header. Two fingers always zoom.",
    ),
    (S_FINGER_WRITES, "Il dito scrive", "A finger writes"),
    (
        S_FINGER_WRITES_DESC,
        "Sullo schermo touch un dito scrive con la penna scelta, come una penna vera; due dita spostano e ingrandiscono. Si cambia anche dall'interruttore in fondo alla colonna.",
        "On a touch screen a finger writes with the chosen pen, like a real pen; two fingers move and zoom. It can also be changed from the switch at the bottom of the column.",
    ),
    (S_PEN_BUTTON, "Il tasto della penna", "The pen button"),
    (
        S_PEN_BUTTON_DESC,
        "Che cosa fa il tasto sul fianco della penna: apre il menu radiale, cancella come il retro della penna, o sposta la lavagna. Su un computer senza penna non fa niente.",
        "What the button on the side of the pen does: it opens the radial menu, erases like the back of the pen, or moves the whiteboard. On a computer without a pen it does nothing.",
    ),
    (S_PEN_BUTTON_RADIAL, "Apre il menu", "Opens the menu"),
    (S_PEN_BUTTON_ERASER, "Cancella", "Erases"),
    (S_PEN_BUTTON_PAN, "Sposta la lavagna", "Moves the whiteboard"),
    (S_WHEEL, "La rotella del mouse", "The mouse wheel"),
    (
        S_WHEEL_DESC,
        "Che cosa fa la rotella fuori da una scheda attiva. Ctrl+rotella e il pizzico ingrandiscono sempre; dentro una scheda attiva la rotella scorre la scheda.",
        "What the wheel does outside an active card. Ctrl+wheel and pinch always zoom; inside an active card the wheel scrolls the card.",
    ),
    (S_WHEEL_PAN, "Sposta la lavagna", "Moves the whiteboard"),
    (S_WHEEL_ZOOM, "Ingrandisce", "Zooms"),
    (S_WORKSPACE, "Spazio di lavoro", "Workspace"),
    (
        S_WORKSPACE_DESC,
        "Completo offre tutti gli strumenti, il navigatore e l'ispettore; Semplice ha la colonna ridotta e caselle grandi, per il dito e la penna. Automatico sceglie Semplice sui dispositivi che hanno solo il tocco.",
        "Full offers all the tools, the navigator and the inspector; Simple has a reduced column and large boxes, for the finger and the pen. Automatic chooses Simple on devices that only have touch.",
    ),
    (S_WORKSPACE_AUTO, "Automatico", "Automatic"),
    (S_WORKSPACE_FULL, "Completo", "Full"),
    (S_WORKSPACE_SIMPLE, "Semplice", "Simple"),
    (S_TOOLBAR, "Strumenti della colonna", "Column tools"),
    (
        S_TOOLBAR_DESC,
        "Gli strumenti che la colonna della lavagna mostra, in ordine; vuota, quelli di serie. Uno strumento tolto resta raggiungibile dai tasti e da Ctrl+/.",
        "The tools the whiteboard column shows, in order; empty, the default ones. A removed tool stays reachable from the keys and from Ctrl+/.",
    ),
    (S_GRID, "Griglia", "Grid"),
    (
        S_GRID_DESC,
        "Mostra i punti della griglia sulla lavagna. Ctrl+' la mostra o la nasconde solo per la lavagna aperta.",
        "Shows the grid dots on the whiteboard. Ctrl+' shows or hides it only for the open whiteboard.",
    ),
    (S_SNAP, "Aggancia le schede", "Snap cards"),
    (
        S_SNAP_DESC,
        "Spostando o ridimensionando una scheda, i bordi si agganciano alle schede vicine e alla griglia. Alt tenuto lo spegne per quel gesto.",
        "When you move or resize a card, its edges snap to nearby cards and to the grid. Holding Alt turns it off for that gesture.",
    ),
    (S_PARTS_PICKER, "Scegli le parti di una nota", "Choose the parts of a note"),
    (
        S_PARTS_PICKER_DESC,
        "Portando sulla lavagna una nota con almeno due titoli, accanto alla scheda si apre l'elenco dei titoli per tenerne solo alcuni. Con Alt, mentre la lasci, arriva intera.",
        "Bringing a note with at least two headings onto the whiteboard opens, next to the card, the list of its headings to keep only some. With Alt, while you drop it, it arrives whole.",
    ),
    (S_DROP_FOLDER, "Dove vanno i file trascinati", "Where dragged files go"),
    (
        S_DROP_FOLDER_DESC,
        "I file portati sulla lavagna dal computer, o incollati, si copiano nel vault qui. «Con le note» segue la cartella degli allegati delle note; «Con la lavagna» li mette in una cartella accanto alla lavagna; «In una cartella» sempre nella stessa cartella del vault. Un file che è già nel vault non si copia.",
        "Files brought onto the whiteboard from the computer, or pasted, are copied into the vault here. «With the notes» follows the attachments folder of the notes; «With the whiteboard» puts them in a folder next to the whiteboard; «In a folder» always in the same folder of the vault. A file already in the vault is not copied.",
    ),
    (S_DROP_FOLDER_NOTES, "Con le note", "With the notes"),
    (S_DROP_FOLDER_BOARD, "Con la lavagna", "With the whiteboard"),
    (S_DROP_FOLDER_FOLDER, "In una cartella", "In a folder"),
    (S_DROP_FOLDER_PATH, "Cartella dei file trascinati", "Folder for dragged files"),
    (
        S_DROP_FOLDER_PATH_DESC,
        "Il nome della cartella accanto alla lavagna, o il percorso nel vault per «In una cartella». Con «Con le note» non si usa.",
        "The name of the folder next to the whiteboard, or the path in the vault for «In a folder». With «With the notes» it is not used.",
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
            E_OP_UNKNOWN_STROKE,
            E_OP_FOREIGN_LAYER,
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
            S_GROUP,
            S_INK_MOUSE_REMEMBER,
            S_INK_MOUSE_REMEMBER_DESC,
            S_FINGER_MOVES_CARD,
            S_FINGER_MOVES_CARD_DESC,
            S_FINGER_WRITES,
            S_FINGER_WRITES_DESC,
            S_PEN_BUTTON,
            S_PEN_BUTTON_DESC,
            S_PEN_BUTTON_RADIAL,
            S_PEN_BUTTON_ERASER,
            S_PEN_BUTTON_PAN,
            S_WHEEL,
            S_WHEEL_DESC,
            S_WHEEL_PAN,
            S_WHEEL_ZOOM,
            S_WORKSPACE,
            S_WORKSPACE_DESC,
            S_WORKSPACE_AUTO,
            S_WORKSPACE_FULL,
            S_WORKSPACE_SIMPLE,
            S_TOOLBAR,
            S_TOOLBAR_DESC,
            S_GRID,
            S_GRID_DESC,
            S_SNAP,
            S_SNAP_DESC,
            S_PARTS_PICKER,
            S_PARTS_PICKER_DESC,
            S_DROP_FOLDER,
            S_DROP_FOLDER_DESC,
            S_DROP_FOLDER_NOTES,
            S_DROP_FOLDER_BOARD,
            S_DROP_FOLDER_FOLDER,
            S_DROP_FOLDER_PATH,
            S_DROP_FOLDER_PATH_DESC,
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

    /// `text` com'è detto in `language`, col catalogo del componente.
    fn said(text: &Text, language: &str) -> String {
        let catalogs = catalog();
        let locale = fub_abi::locale::Locale {
            language: language.to_string(),
            ..fub_abi::locale::Locale::default()
        };
        fub_abi::text::Strings::new(&catalogs, "it", &locale).render(text)
    }

    /// Le dodici impostazioni nell'ordine del pannello: la chiave, la specie, il
    /// valore di serie, lo spazio. Le prime cinque sono della macchina.
    #[test]
    fn le_dodici_impostazioni_hanno_chiave_specie_e_valore_di_serie() {
        use fub_abi::settings::{SettingScope, SettingValue};
        let want: [(&str, &str, SettingValue); 12] = [
            (
                "canvas.ink_mouse_remember",
                "toggle",
                SettingValue::Toggle(false),
            ),
            (
                "canvas.finger_moves_card",
                "toggle",
                SettingValue::Toggle(false),
            ),
            (
                "canvas.finger_writes",
                "toggle",
                SettingValue::Toggle(false),
            ),
            (
                "canvas.pen_button",
                "choice",
                SettingValue::Text("radial".into()),
            ),
            ("canvas.wheel", "choice", SettingValue::Text("pan".into())),
            (
                "canvas.workspace",
                "choice",
                SettingValue::Text("auto".into()),
            ),
            ("canvas.toolbar", "list", SettingValue::List(Vec::new())),
            ("canvas.grid", "toggle", SettingValue::Toggle(true)),
            ("canvas.snap", "toggle", SettingValue::Toggle(true)),
            ("canvas.parts_picker", "toggle", SettingValue::Toggle(true)),
            (
                "canvas.drop_folder",
                "choice",
                SettingValue::Text("notes".into()),
            ),
            (
                "canvas.drop_folder_path",
                "text",
                SettingValue::Text("Allegati".into()),
            ),
        ];
        let specs = settings();
        assert_eq!(specs.len(), want.len());
        for (index, (spec, (key, kind, default))) in specs.iter().zip(&want).enumerate() {
            assert_eq!(spec.key, *key);
            assert_eq!(spec.kind.name(), *kind, "{key}");
            assert_eq!(&spec.kind.default_value(), default, "{key}");
            assert!(!spec.program_writable, "{key}");
            let scope = if index < 5 {
                SettingScope::Machine
            } else {
                SettingScope::Vault
            };
            assert_eq!(spec.scope, scope, "{key}");
            // Ogni specie prende il suo valore e nient'altro.
            let other = match spec.kind.default_value() {
                SettingValue::Toggle(_) => SettingValue::Text("sì".into()),
                _ => SettingValue::Toggle(true),
            };
            assert!(spec.kind.rejects(&other).is_some(), "{key}");
        }
    }

    /// Le scelte hanno i valori del piano, nell'ordine dei pulsanti, e un valore
    /// fuori lista è un rifiuto per chi scrive.
    #[test]
    fn le_scelte_hanno_i_valori_del_piano() {
        use fub_abi::settings::SettingValue;
        let specs = settings();
        let values = |key: &str| -> Vec<String> {
            let spec = specs.iter().find(|spec| spec.key == key).expect(key);
            match &spec.kind {
                SettingKind::Choice { options, .. } => {
                    options.iter().map(|option| option.value.clone()).collect()
                }
                other => panic!("{key} non è una scelta: {}", other.name()),
            }
        };
        assert_eq!(values(CANVAS_PEN_BUTTON_KEY), ["radial", "eraser", "pan"]);
        assert_eq!(values(CANVAS_WHEEL_KEY), ["pan", "zoom"]);
        assert_eq!(values(CANVAS_WORKSPACE_KEY), ["auto", "full", "simple"]);
        assert_eq!(values(CANVAS_DROP_FOLDER_KEY), ["notes", "board", "folder"]);
        for key in [
            CANVAS_PEN_BUTTON_KEY,
            CANVAS_WHEEL_KEY,
            CANVAS_WORKSPACE_KEY,
            CANVAS_DROP_FOLDER_KEY,
        ] {
            let spec = specs.iter().find(|spec| spec.key == key).expect(key);
            assert!(
                spec.kind
                    .rejects(&SettingValue::Text("altro".into()))
                    .is_some(),
                "{key}"
            );
        }
    }

    /// I testi italiani del prototipo approvato (T25, «Come frasi»), parola per
    /// parola: il nome e la descrizione di ogni riga.
    #[test]
    fn i_testi_italiani_sono_quelli_del_prototipo_approvato() {
        let specs = settings();
        let approved: [(&str, &str); 12] = [
            (
                "Ricorda se scrivi col mouse",
                "Riaprendo una lavagna, l'interruttore «Scrivi col mouse» resta come l'hai lasciato. Spenta, la lavagna si apre sempre con l'interruttore spento. Il tasto D funziona sempre.",
            ),
            (
                "Il dito sposta le schede",
                "Sullo schermo touch il dito sposta la scheda che tocca, e la lavagna solo dove non ci sono schede. Spenta, il dito sposta sempre la lavagna e una scheda si sposta dalla sua testata. Due dita ingrandiscono sempre.",
            ),
            (
                "Il dito scrive",
                "Sullo schermo touch un dito scrive con la penna scelta, come una penna vera; due dita spostano e ingrandiscono. Si cambia anche dall'interruttore in fondo alla colonna.",
            ),
            (
                "Il tasto della penna",
                "Che cosa fa il tasto sul fianco della penna: apre il menu radiale, cancella come il retro della penna, o sposta la lavagna. Su un computer senza penna non fa niente.",
            ),
            (
                "La rotella del mouse",
                "Che cosa fa la rotella fuori da una scheda attiva. Ctrl+rotella e il pizzico ingrandiscono sempre; dentro una scheda attiva la rotella scorre la scheda.",
            ),
            (
                "Spazio di lavoro",
                "Completo offre tutti gli strumenti, il navigatore e l'ispettore; Semplice ha la colonna ridotta e caselle grandi, per il dito e la penna. Automatico sceglie Semplice sui dispositivi che hanno solo il tocco.",
            ),
            (
                "Strumenti della colonna",
                "Gli strumenti che la colonna della lavagna mostra, in ordine; vuota, quelli di serie. Uno strumento tolto resta raggiungibile dai tasti e da Ctrl+/.",
            ),
            (
                "Griglia",
                "Mostra i punti della griglia sulla lavagna. Ctrl+' la mostra o la nasconde solo per la lavagna aperta.",
            ),
            (
                "Aggancia le schede",
                "Spostando o ridimensionando una scheda, i bordi si agganciano alle schede vicine e alla griglia. Alt tenuto lo spegne per quel gesto.",
            ),
            (
                "Scegli le parti di una nota",
                "Portando sulla lavagna una nota con almeno due titoli, accanto alla scheda si apre l'elenco dei titoli per tenerne solo alcuni. Con Alt, mentre la lasci, arriva intera.",
            ),
            (
                "Dove vanno i file trascinati",
                "I file portati sulla lavagna dal computer, o incollati, si copiano nel vault qui. «Con le note» segue la cartella degli allegati delle note; «Con la lavagna» li mette in una cartella accanto alla lavagna; «In una cartella» sempre nella stessa cartella del vault. Un file che è già nel vault non si copia.",
            ),
            (
                "Cartella dei file trascinati",
                "Il nome della cartella accanto alla lavagna, o il percorso nel vault per «In una cartella». Con «Con le note» non si usa.",
            ),
        ];
        for (spec, (label, description)) in specs.iter().zip(approved) {
            assert_eq!(said(&spec.label, "it"), label, "{}", spec.key);
            assert_eq!(said(&spec.description, "it"), description, "{}", spec.key);
        }
    }

    /// Le opzioni in italiano e in inglese, e le etichette inglesi delle righe.
    #[test]
    fn le_opzioni_e_l_inglese_dicono_le_stesse_cose() {
        let specs = settings();
        let labels = |key: &str, language: &str| -> Vec<String> {
            let spec = specs.iter().find(|spec| spec.key == key).expect(key);
            match &spec.kind {
                SettingKind::Choice { options, .. } => options
                    .iter()
                    .map(|option| said(&option.label, language))
                    .collect(),
                other => panic!("{key} non è una scelta: {}", other.name()),
            }
        };
        assert_eq!(
            labels(CANVAS_PEN_BUTTON_KEY, "it"),
            ["Apre il menu", "Cancella", "Sposta la lavagna"]
        );
        assert_eq!(
            labels(CANVAS_WHEEL_KEY, "it"),
            ["Sposta la lavagna", "Ingrandisce"]
        );
        assert_eq!(
            labels(CANVAS_WORKSPACE_KEY, "it"),
            ["Automatico", "Completo", "Semplice"]
        );
        assert_eq!(
            labels(CANVAS_DROP_FOLDER_KEY, "it"),
            ["Con le note", "Con la lavagna", "In una cartella"]
        );
        assert_eq!(
            labels(CANVAS_PEN_BUTTON_KEY, "en"),
            ["Opens the menu", "Erases", "Moves the whiteboard"]
        );
        assert_eq!(
            labels(CANVAS_WHEEL_KEY, "en"),
            ["Moves the whiteboard", "Zooms"]
        );
        assert_eq!(
            labels(CANVAS_WORKSPACE_KEY, "en"),
            ["Automatic", "Full", "Simple"]
        );
        assert_eq!(
            labels(CANVAS_DROP_FOLDER_KEY, "en"),
            ["With the notes", "With the whiteboard", "In a folder"]
        );
        let english = [
            "Remember whether you write with the mouse",
            "A finger moves the cards",
            "A finger writes",
            "The pen button",
            "The mouse wheel",
            "Workspace",
            "Column tools",
            "Grid",
            "Snap cards",
            "Choose the parts of a note",
            "Where dragged files go",
            "Folder for dragged files",
        ];
        for (spec, label) in specs.iter().zip(english) {
            assert_eq!(said(&spec.label, "en"), label, "{}", spec.key);
        }
    }

    #[test]
    fn le_impostazioni_parlano_italiano_e_inglese() {
        let specs = settings();
        for spec in &specs {
            for (language, group) in [("it", "Lavagna"), ("en", "Whiteboard")] {
                assert_eq!(said(&spec.group, language), group, "{}", spec.key);
                for text in [&spec.label, &spec.description] {
                    let line = said(text, language);
                    assert!(
                        !line.is_empty() && !line.starts_with("s_"),
                        "{} in {language}: «{line}»",
                        spec.key
                    );
                }
            }
        }
        // Le parole del prototipo approvato (PLAN-ui/lavagna-penne.html).
        assert_eq!(said(&specs[0].label, "it"), "Ricorda se scrivi col mouse");
        assert_eq!(said(&specs[1].label, "it"), "Il dito sposta le schede");
        assert_eq!(
            said(&specs[0].label, "en"),
            "Remember whether you write with the mouse"
        );
        assert_eq!(said(&specs[1].label, "en"), "A finger moves the cards");
        let it = said(&specs[0].description, "it");
        assert!(it.contains("«Scrivi col mouse»"), "{it}");
        assert!(it.contains("Il tasto D funziona sempre."), "{it}");
        let en = said(&specs[0].description, "en");
        assert!(en.contains("«Write with the mouse»"), "{en}");
        let it = said(&specs[1].description, "it");
        assert!(it.contains("Due dita ingrandiscono sempre."), "{it}");
        let en = said(&specs[1].description, "en");
        assert!(en.contains("Two fingers always zoom."), "{en}");
    }
}
