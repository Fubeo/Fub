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
//! [`settings`] dichiara due interruttori della macchina, nel gruppo
//! «Lavagna», spenti di serie: [`CANVAS_INK_MOUSE_REMEMBER_KEY`] fa ricordare
//! a ogni lavagna del computer se «Scrivi col mouse» era acceso, e
//! [`CANVAS_FINGER_MOVES_CARD_KEY`] lascia al dito spostare la scheda che
//! tocca. Li legge l'editor della lavagna (`editors/canvas/preferences.ts`
//! nel client), che li segue dal vivo; il test del client
//! `editors/canvas/settings-mirror.test.ts` confronta i nomi.

mod apply;
mod create;

use fub_abi::command::{
    CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};

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

/// Lo schema delle impostazioni della lavagna: due interruttori spenti.
///
/// Sono della **macchina**, come i suggerimenti dei disegni: dicono come si
/// scrive e si tocca su questo computer (un mouse, uno schermo touch), non
/// che cosa contiene il vault, e su un vault condiviso non cambiano le mani
/// degli altri. Li scrive chi usa Fub dalle Impostazioni; non
/// `program_writable`.
pub fn settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            CANVAS_INK_MOUSE_REMEMBER_KEY,
            Text::key(S_INK_MOUSE_REMEMBER),
            SettingKind::Toggle { default: false },
        )
        .describing(Text::key(S_INK_MOUSE_REMEMBER_DESC))
        .grouped(Text::key(S_GROUP))
        .for_machine(),
        SettingSpec::new(
            CANVAS_FINGER_MOVES_CARD_KEY,
            Text::key(S_FINGER_MOVES_CARD),
            SettingKind::Toggle { default: false },
        )
        .describing(Text::key(S_FINGER_MOVES_CARD_DESC))
        .grouped(Text::key(S_GROUP))
        .for_machine(),
    ]
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

    #[test]
    fn le_impostazioni_sono_due_interruttori_spenti_della_macchina() {
        use fub_abi::settings::{SettingScope, SettingValue};
        let specs = settings();
        let keys: Vec<_> = specs.iter().map(|spec| spec.key.as_str()).collect();
        assert_eq!(
            keys,
            ["canvas.ink_mouse_remember", "canvas.finger_moves_card"]
        );
        assert_eq!(
            keys,
            [CANVAS_INK_MOUSE_REMEMBER_KEY, CANVAS_FINGER_MOVES_CARD_KEY]
        );
        for spec in &specs {
            assert_eq!(spec.scope, SettingScope::Machine, "{}", spec.key);
            assert!(!spec.program_writable, "{}", spec.key);
            assert_eq!(
                spec.kind,
                SettingKind::Toggle { default: false },
                "{}",
                spec.key
            );
            assert_eq!(
                spec.kind.default_value(),
                SettingValue::Toggle(false),
                "{}",
                spec.key
            );
            // Un interruttore prende un interruttore e nient'altro.
            assert!(spec.kind.rejects(&SettingValue::Toggle(true)).is_none());
            assert!(spec
                .kind
                .rejects(&SettingValue::Text("sì".into()))
                .is_some());
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
