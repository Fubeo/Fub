//! La lavagna come componente: il comando `canvas.apply`, che porta in un
//! file `.canvas` una lista di operazioni del nucleo
//! ([`fub_canvas_core::ops::CanvasOp`]) e ne fa una modifica sola, con
//! l'anteprima e l'annulla di ogni altra modifica al testo.
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

mod apply;

use fub_abi::command::{
    CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};

/// L'id del componente, lo stesso della sua riga nella mappa.
pub const LAVAGNA_ID: &str = "fub.lavagna";

/// Applica una lista di operazioni a una lavagna.
pub const CANVAS_APPLY: &str = "canvas.apply";

/// Il namespace dell'effetto che dice che cosa ha fatto `canvas.apply`.
pub const LAVAGNA_NS: &str = LAVAGNA_ID;

const DOC: &str = "doc";
const OPS: &str = "ops";
const BASE: &str = "base";
const SEED: &str = "seed";

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

/// I comandi della lavagna.
pub struct LavagnaCommands;

impl CommandProvider for LavagnaCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(CANVAS_APPLY, Text::key(format!("{CANVAS_APPLY}.title")))
                .describing(Text::key(format!("{CANVAS_APPLY}.desc")))
                .with_param(parameter(DOC, ParamKind::Document).required())
                .with_param(parameter(OPS, ParamKind::Text).required())
                .with_param(parameter(BASE, ParamKind::Text))
                .with_param(parameter(SEED, ParamKind::Text))
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
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(
        name,
        Text::key(format!("{CANVAS_APPLY}.{name}.title")),
        kind,
    )
    .describing(Text::key(format!("{CANVAS_APPLY}.{name}.desc")))
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
}
