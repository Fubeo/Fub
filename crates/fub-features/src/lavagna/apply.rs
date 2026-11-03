//! `canvas.apply`: una lista di operazioni portata in una lavagna come una
//! modifica sola.
//!
//! I passi sono quelli di ogni modifica al testo (decisione 0008): la
//! revisione si fissa prima di leggere, il nucleo apre il sorgente, compila
//! le operazioni e le scrive, e all'host va il tratto minimo cambiato con la
//! revisione di partenza, così una scrittura avvenuta nel frattempo fallisce
//! il suo CAS invece di sparire. L'anteprima mostra la stessa modifica senza
//! scriverla, l'annulla è l'inversa che l'host restituisce.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, InvokeMode, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, Fnv1a, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{DocId, Span};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::HostApi;
use fub_canvas_core::commit::{CommitError, Core};
use fub_canvas_core::ops::{compile, CanvasOp, OpError};
use fub_canvas_core::CanvasError;
use serde_json::json;

use super::*;

/// L'id del formato delle lavagne (`fub_format_canvas::model::FORMAT_ID`):
/// la feature non dipende dal formato, ne nomina soltanto l'id del contratto.
const CANVAS_FORMAT: &str = "canvas";

pub(super) fn canvas_apply(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document(DOC)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    let is_canvas = host
        .format_of(&doc)
        .is_some_and(|format| format.descriptor.id == CANVAS_FORMAT);
    if !is_canvas {
        return Err(PluginError::BadArgs(about(E_NOT_CANVAS, &doc, Vec::new())));
    }
    let ops = operations(args.text(OPS).unwrap_or(""))?;
    let seed = args.text(SEED).map(seed).transpose()?;

    let revision = host.document_revision(&doc)?;
    if let Some(base) = args.text(BASE) {
        if Revision::new(base) != revision {
            return Err(PluginError::Conflict(about(E_BASE, &doc, Vec::new())));
        }
    }
    let source = host.read_document(&doc)?;
    let mut core = Core::open(source).map_err(|error| opening(&doc, &error))?;
    // Senza un seme gli id nascono dalla revisione: anteprima e applicazione
    // sulla stessa revisione danno gli stessi id.
    let seed = seed.unwrap_or_else(|| Fnv1a::hash(revision.0.as_bytes()));
    let compiled = compile(core.canvas(), &ops, seed).map_err(operation)?;
    let committed = core
        .commit(&compiled.patches)
        .map_err(|error| committing(&doc, error))?;
    let edit = committed.edit;
    let created = compiled.created;

    let count = Arg::text("count", ops.len().to_string());
    if edit.start == edit.end && edit.text.is_empty() {
        // Le operazioni non cambiano un byte: niente da scrivere né da annullare.
        let outcome = if mode.is_dry_run() {
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                about(P_APPLY, &doc, vec![count]),
                Vec::new(),
            )))
        } else {
            CommandOutcome::notify(about(N_UNCHANGED, &doc, Vec::new()))
                .with_effect(effect(&created, &revision))
        };
        return Ok(outcome);
    }
    let request = EditRequest::new(
        revision,
        vec![TextEdit::replace(
            Span::new(edit.start, edit.end),
            edit.text,
        )],
    );
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                about(P_APPLY, &doc, vec![count]),
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        about(U_APPLY, &doc, Vec::new()),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    Ok(CommandOutcome::notify(about(N_APPLIED, &doc, Vec::new()))
        .undoable(undo)
        .with_effect(effect(&created, &report.revision)))
}

/// Che cosa ha fatto il comando, per chi lo ha chiamato: gli id nati e la
/// revisione della lavagna dopo.
fn effect(created: &[String], revision: &Revision) -> CommandEffect {
    CommandEffect::Custom {
        ns: LAVAGNA_NS.into(),
        payload: json!({ "created": created, "revision": revision.0 }),
    }
}

/// Una frase che nomina il documento, più altri argomenti.
fn about(key: &str, doc: &DocId, mut args: Vec<Arg>) -> Text {
    args.insert(0, Arg::text("doc", doc.as_str()));
    Text::message(key, args)
}

/// La lista delle operazioni: un array JSON, non vuoto.
fn operations(raw: &str) -> Result<Vec<CanvasOp>, PluginError> {
    let ops: Vec<CanvasOp> = serde_json::from_str(raw).map_err(|error| {
        PluginError::BadArgs(Text::message(
            E_OPS_JSON,
            vec![Arg::text("reason", error.to_string())],
        ))
    })?;
    if ops.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_OPS_EMPTY)));
    }
    Ok(ops)
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

/// Un'operazione rifiutata: la posizione si conta da uno, come la legge chi
/// ha scritto la lista.
fn operation(error: OpError) -> PluginError {
    let position = Arg::text("position", (error.index() + 1).to_string());
    let (key, mut args) = match &error {
        OpError::UnknownNode { id, .. } => (E_OP_UNKNOWN_NODE, vec![Arg::text("id", id)]),
        OpError::UnknownEdge { id, .. } => (E_OP_UNKNOWN_EDGE, vec![Arg::text("id", id)]),
        OpError::DuplicateId { id, .. } => (E_OP_DUPLICATE, vec![Arg::text("id", id)]),
        OpError::TooMany { what, limit, .. } => (
            if *what == "edges" {
                E_OP_TOO_MANY_EDGES
            } else {
                E_OP_TOO_MANY_NODES
            },
            vec![Arg::text("limit", limit.to_string())],
        ),
        OpError::Invalid { reason, .. } => (E_OP_INVALID, vec![Arg::text("reason", reason)]),
    };
    args.insert(0, position);
    PluginError::BadArgs(Text::message(key, args))
}

/// Un commit rifiutato. Una toppa stantia o un sorgente che non si rilegge
/// sono un difetto del nucleo, non degli argomenti: errori interni.
fn committing(doc: &DocId, error: CommitError) -> PluginError {
    let reason = || vec![Arg::text("reason", error.to_string())];
    match &error {
        CommitError::Stale(_) => PluginError::Internal(about(E_COMMIT_STALE, doc, Vec::new())),
        CommitError::Invalid(_) => PluginError::BadArgs(about(E_COMMIT_INVALID, doc, reason())),
        CommitError::Rejected(_) => PluginError::BadArgs(about(E_COMMIT_REJECTED, doc, reason())),
        CommitError::Unstable { .. } => {
            PluginError::Internal(about(E_COMMIT_UNSTABLE, doc, Vec::new()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(text: &Text) -> Option<&str> {
        text.as_message().map(|message| message.key.as_str())
    }

    #[test]
    fn il_seme_e_un_intero_a_64_bit() {
        assert_eq!(seed("0").ok(), Some(0));
        assert_eq!(seed(" 18446744073709551615 ").ok(), Some(u64::MAX));
        assert!(matches!(
            seed("18446744073709551616"),
            Err(PluginError::BadArgs(_))
        ));
        assert!(matches!(seed("-1"), Err(PluginError::BadArgs(_))));
        assert!(matches!(seed("dodici"), Err(PluginError::BadArgs(_))));
    }

    #[test]
    fn le_operazioni_sono_una_lista_non_vuota() {
        assert!(matches!(
            operations("non json"),
            Err(PluginError::BadArgs(_))
        ));
        assert!(matches!(operations("{}"), Err(PluginError::BadArgs(_))));
        assert!(matches!(operations(""), Err(PluginError::BadArgs(_))));
        assert!(
            matches!(operations("[]"), Err(PluginError::BadArgs(t)) if key(&t) == Some(E_OPS_EMPTY))
        );
        assert!(matches!(
            operations(r#"[{"op":"fly"}]"#),
            Err(PluginError::BadArgs(_))
        ));
        let ops = operations(r#"[{"op":"remove","ids":["a"]}]"#).ok();
        assert_eq!(ops.map(|ops| ops.len()), Some(1));
    }

    #[test]
    fn la_posizione_dell_operazione_si_conta_da_uno() {
        let PluginError::BadArgs(text) = operation(OpError::UnknownNode {
            index: 0,
            id: "x".into(),
        }) else {
            panic!("un'operazione sbagliata è un argomento sbagliato");
        };
        assert_eq!(key(&text), Some(E_OP_UNKNOWN_NODE));
        let PluginError::BadArgs(text) = operation(OpError::TooMany {
            index: 2,
            what: "edges",
            limit: 4,
        }) else {
            panic!("troppi archi è un argomento sbagliato");
        };
        assert_eq!(key(&text), Some(E_OP_TOO_MANY_EDGES));
    }

    /// Una lavagna come la scrive Obsidian: tab, campi nel suo ordine (il
    /// testo prima delle coordinate), `null` su campi che Fub legge assenti,
    /// escape scritti a modo suo e niente a capo in fondo.
    const OBSIDIAN: &str = "{\n\t\"nodes\":[\n\t\t{\"id\":\"6f1d2a\",\"type\":\"text\",\"text\":\"caff\\u00e9 \\/ [[Nota]]\",\"x\":-120,\"y\":-60,\"width\":250,\"height\":60,\"color\":null},\n\t\t{\"id\":\"9c0b7e\",\"type\":\"file\",\"file\":\"Nota.md\",\"x\":200,\"y\":-60,\"width\":400,\"height\":400,\"subpath\":null}\n\t],\n\t\"edges\":[\n\t\t{\"id\":\"e71a\",\"fromNode\":\"6f1d2a\",\"fromSide\":\"right\",\"toNode\":\"9c0b7e\",\"toSide\":\"left\"}\n\t]\n}";

    #[test]
    fn spostare_una_scheda_di_obsidian_cambia_solo_i_byte_della_coordinata() {
        use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
        use fub_abi::traits::VaultRead;
        use fub_sdk::testing::MemoryHost;

        let mut host = MemoryHost::new()
            .with_format(
                "canvas",
                DocumentFormat {
                    descriptor: FormatDescriptor::text(CANVAS_FORMAT, "Canvas", &["canvas"]),
                    capabilities: FormatCapabilities::default(),
                },
            )
            .with_document("Idee.canvas", OBSIDIAN);
        let ops = json!([{ "op": "move", "ids": ["6f1d2a"], "dx": 80, "dy": 0 }]).to_string();
        let args = json!({ "doc": "Idee.canvas", "ops": ops });
        canvas_apply(Args::new(&args), InvokeMode::Apply, &mut host)
            .expect("lo spostamento si applica");

        let after = host
            .read_document(&DocId::new("Idee.canvas"))
            .expect("la lavagna si legge");
        assert_eq!(after, OBSIDIAN.replacen("\"x\":-120", "\"x\":-40", 1));
    }
}
