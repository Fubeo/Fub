// Senza la cargo feature `lavagna` il modulo non è compilato, e un test che lo
// nomina non avrebbe un soggetto.
#![cfg(feature = "lavagna")]
//! **`canvas.apply` e `canvas.create` end-to-end**, attraverso il kernel vero
//! e il formato vero delle lavagne: le operazioni arrivano nel file come una
//! modifica sola, il piano non scrive niente, e l'annulla riporta i byte di
//! prima; una lavagna nuova prende il nome libero, è la lavagna vuota del
//! nucleo, e l'annulla la manda nel cestino.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_features::lavagna::CANVAS_CREATE;
use fub_features::{LavagnaCommands, CANVAS_APPLY, LAVAGNA_ID, LAVAGNA_NS};
use fub_format_canvas::CanvasProvider;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

const BOARD: &str = "Idee.canvas";

/// Una lavagna scritta a mano, con le sue abitudini: due spazi, un campo che
/// Fub non conosce, l'a capo in fondo. Sono i byte che l'annulla deve ridare.
const BEFORE: &str = "{\n  \"nodes\": [\n    {\"id\": \"a\", \"type\": \"text\", \"x\": 0, \"y\": 0, \"width\": 200, \"height\": 80, \"text\": \"Ciao\", \"x-mio\": true}\n  ],\n  \"edges\": []\n}\n";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        registry
            .register(CanvasProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(LAVAGNA_ID, LAVAGNA_ID)
                .speaking("it", fub_features::lavagna::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(LAVAGNA_ID, Box::new(LavagnaCommands))
            .expect("registrato");
        // `note.trash`, l'annulla di `canvas.create`, è dei comandi di base.
        #[cfg(feature = "commands")]
        {
            use fub_features::{CoreCommands, COMMANDS_ID};
            ws.register_plugin(
                fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                    .speaking("it", fub_features::commands::catalog()),
                fub_kernel::Trust::Core,
            )
            .expect("dichiarato");
            ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
                .expect("registrato");
        }
        ws
    }
}

fn with_board(text: &str) -> (Vault, Workspace) {
    // Scritta da fuori, come la trova Fub: anche una lavagna che il formato
    // non saprebbe salvare.
    let vault = Vault::new();
    std::fs::write(vault.root.join(BOARD), text).expect("la lavagna si scrive");
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    (vault, ws)
}

fn apply(ws: &mut Workspace, args: Value, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_APPLY, args, mode, Actor::User)
}

fn source(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

fn plugin_error(error: PluginError) -> PluginError {
    error
}

fn custom(outcome: &CommandOutcome) -> &Value {
    match &outcome.effect {
        CommandEffect::Custom { ns, payload } if ns == LAVAGNA_NS => payload,
        other => panic!("l'effetto della lavagna, non {other:?}"),
    }
}

fn ops() -> String {
    json!([
        { "op": "move", "ids": ["a"], "dx": 40, "dy": 0 },
        { "op": "add_card", "node": { "id": "b", "type": "text", "x": 300, "y": 0, "width": 200, "height": 80, "text": "Poi" } },
        { "op": "connect", "edge": { "fromNode": "a", "toNode": "b" } }
    ])
    .to_string()
}

#[test]
fn le_operazioni_arrivano_nel_file_e_l_annulla_ridà_i_byte_di_prima() {
    let (_vault, mut ws) = with_board(BEFORE);
    let doc = DocId::new(BOARD);
    let base = ws.document_revision(&doc).expect("revisione").0;

    let outcome = apply(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops(), "base": base, "seed": "2026" }),
        InvokeMode::Apply,
    )
    .expect("le operazioni si applicano");

    let after = source(&ws, BOARD);
    let canvas: Value = serde_json::from_str(&after).expect("la lavagna è JSON");
    let nodes = canvas["nodes"].as_array().expect("schede");
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0]["x"], 40, "la scheda si è spostata");
    assert_eq!(nodes[0]["x-mio"], true, "il campo sconosciuto resta");
    assert_eq!(nodes[1]["id"], "b");
    let edges = canvas["edges"].as_array().expect("archi");
    assert_eq!(edges.len(), 1);
    assert!(
        after.starts_with("{\n  \"nodes\": [\n"),
        "il resto del file è com'era: {after}"
    );
    assert!(after.ends_with("}\n"), "l'a capo in fondo resta");

    let payload = custom(&outcome);
    let created: Vec<&str> = payload["created"]
        .as_array()
        .expect("gli id nati")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(created.len(), 2);
    assert_eq!(created[0], "b");
    assert_eq!(edges[0]["id"], created[1], "l'id dell'arco è quello detto");
    assert_eq!(
        payload["revision"],
        ws.document_revision(&doc).expect("revisione").0,
        "la revisione detta è quella del file"
    );

    // L'annulla: i passi dell'esito, come li esegue il kernel.
    let undo = outcome.undo.expect("si annulla");
    assert_eq!(undo.steps.len(), 1);
    for step in undo.steps {
        let UndoStep::Edit(planned) = step else {
            panic!("l'annulla è una modifica al testo");
        };
        ws.apply_edit(&planned.doc, planned.edit)
            .expect("l'annulla si applica");
    }
    assert_eq!(source(&ws, BOARD), BEFORE, "i byte di prima");
}

#[test]
fn il_piano_non_scrive_e_dice_la_stessa_modifica() {
    let (_vault, mut ws) = with_board(BEFORE);
    let doc = DocId::new(BOARD);
    let args = json!({ "doc": BOARD, "ops": ops() });

    let plan = apply(&mut ws, args.clone(), InvokeMode::DryRun).expect("il piano");
    assert_eq!(source(&ws, BOARD), BEFORE, "il piano non scrive");
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un piano");
    };
    assert_eq!(plan.edit_count(), 1);
    let planned = plan.edits[0].clone();
    assert_eq!(planned.doc, doc);

    // Senza seme gli id vengono dalla revisione: il piano e l'applicazione
    // sulla stessa revisione scrivono lo stesso testo.
    let applied = apply(&mut ws, args, InvokeMode::Apply).expect("si applica");
    let after = source(&ws, BOARD);
    let mut expected = BEFORE.to_string();
    let edit = &planned.edit.edits[0];
    expected.replace_range(edit.span.start..edit.span.end, &edit.text);
    assert_eq!(after, expected);
    assert!(applied.undo.is_some());
}

#[test]
fn due_applicazioni_sulla_stessa_revisione_la_seconda_e_in_conflitto() {
    let (_vault, mut ws) = with_board(BEFORE);
    let base = ws
        .document_revision(&DocId::new(BOARD))
        .expect("revisione")
        .0;
    let args = json!({ "doc": BOARD, "ops": ops(), "base": base });

    apply(&mut ws, args.clone(), InvokeMode::Apply).expect("la prima si applica");
    let written = source(&ws, BOARD);
    let error = plugin_error(
        apply(&mut ws, args, InvokeMode::Apply).expect_err("la seconda non trova la sua base"),
    );
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(source(&ws, BOARD), written, "la seconda non ha scritto");
}

#[test]
fn una_lavagna_vuota_si_scrive_per_intero() {
    let (_vault, mut ws) = with_board("");
    let added = json!([
        { "op": "add_card", "node": { "id": "b", "type": "text", "x": 0, "y": 0, "width": 200, "height": 80, "text": "Prima" } }
    ])
    .to_string();
    apply(
        &mut ws,
        json!({ "doc": BOARD, "ops": added }),
        InvokeMode::Apply,
    )
    .expect("si applica a una lavagna vuota");
    let canvas: Value = serde_json::from_str(&source(&ws, BOARD)).expect("JSON");
    assert_eq!(canvas["nodes"][0]["id"], "b");
}

#[test]
fn gli_argomenti_sbagliati_sono_errori_chiari_e_il_file_non_cambia() {
    let (_vault, mut ws) = with_board(BEFORE);
    let cases = [
        json!({ "doc": BOARD, "ops": "non è JSON" }),
        json!({ "doc": BOARD, "ops": "[]" }),
        json!({ "doc": BOARD, "ops": "{\"op\":\"move\"}" }),
        json!({ "doc": BOARD, "ops": "[{\"op\":\"fly\"}]" }),
        json!({ "doc": BOARD, "ops": ops(), "seed": "-3" }),
        json!({ "doc": BOARD, "ops": "[{\"op\":\"remove\",\"ids\":[\"nessuno\"]}]" }),
        json!({ "doc": BOARD, "ops": "[{\"op\":\"resize\",\"id\":\"a\",\"width\":0,\"height\":10}]" }),
    ];
    for args in cases {
        let error =
            plugin_error(apply(&mut ws, args.clone(), InvokeMode::Apply).expect_err("rifiutato"));
        assert!(
            matches!(error, PluginError::BadArgs(_)),
            "{args}: {error:?}"
        );
        assert_eq!(source(&ws, BOARD), BEFORE, "{args}: il file non cambia");
    }
}

#[test]
fn una_base_diversa_e_un_conflitto() {
    let (_vault, mut ws) = with_board(BEFORE);
    let error = plugin_error(
        apply(
            &mut ws,
            json!({ "doc": BOARD, "ops": ops(), "base": "sha256:0" }),
            InvokeMode::DryRun,
        )
        .expect_err("una base vecchia"),
    );
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
}

#[test]
fn un_documento_che_non_e_una_lavagna_e_rifiutato() {
    let (_vault, mut ws) = with_board(BEFORE);
    ws.write_document(&DocId::new("Nota.md"), "# Nota\n", WriteBase::Dictated)
        .expect("la nota si scrive");
    let error = plugin_error(
        apply(
            &mut ws,
            json!({ "doc": "Nota.md", "ops": ops() }),
            InvokeMode::Apply,
        )
        .expect_err("non è una lavagna"),
    );
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, "Nota.md"), "# Nota\n");
}

#[test]
fn una_lavagna_che_non_si_legge_e_rifiutata() {
    // Una chiave ripetuta, un JSON rotto, un id vuoto: R1–R10 non li leggono.
    for text in [
        "{\"nodes\": [], \"nodes\": []}",
        "{\"nodes\": [",
        "{\"nodes\": [{\"id\": \"\", \"type\": \"text\", \"x\": 0, \"y\": 0, \"width\": 1, \"height\": 1, \"text\": \"\"}]}",
    ] {
        let (_vault, mut ws) = with_board(text);
        let error = plugin_error(
            apply(&mut ws, json!({ "doc": BOARD, "ops": ops() }), InvokeMode::Apply)
                .expect_err("illeggibile"),
        );
        assert!(matches!(error, PluginError::BadArgs(_)), "{text}: {error:?}");
        assert_eq!(source(&ws, BOARD), text, "{text}: il file non cambia");
    }
}

fn create(
    ws: &mut Workspace,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_CREATE, args, mode, Actor::User)
}

fn opened(outcome: &CommandOutcome) -> DocId {
    match &outcome.effect {
        CommandEffect::Navigate { doc } => doc.clone(),
        other => panic!("una lavagna nuova si apre, non {other:?}"),
    }
}

/// Il «Fatto quando» di `canvas.create`: due lavagne senza nome, la seconda
/// col nome libero dopo; il sorgente lo apre il nucleo; l'annulla, anche dopo
/// che il file è cambiato, lo porta nel cestino con quello che aveva.
#[cfg(feature = "commands")]
#[test]
fn due_lavagne_senza_nome_si_aprono_col_nucleo_e_l_annulla_le_cestina() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.reindex().expect("reindex");

    let first = create(&mut ws, json!({}), InvokeMode::Apply).expect("la prima nasce");
    let second = create(&mut ws, json!({}), InvokeMode::Apply).expect("la seconda nasce");
    assert_eq!(opened(&first), DocId::new("Lavagna.canvas"));
    assert_eq!(opened(&second), DocId::new("Lavagna 1.canvas"));

    for doc in [opened(&first), opened(&second)] {
        let text = source(&ws, doc.as_str());
        assert_eq!(text, "{\n  \"nodes\": [],\n  \"edges\": []\n}\n");
        let core = fub_canvas_core::commit::Core::open(text.as_str()).expect("il nucleo la apre");
        assert!(core.canvas().nodes.is_empty());
        assert!(vault.root.join(doc.as_str()).is_file(), "{doc} è sul disco");
    }

    // La seconda cambia prima dell'annulla: il cestino tiene ciò che aveva.
    let doc = opened(&second);
    let added = json!([
        { "op": "add_card", "node": { "id": "b", "type": "text", "x": 0, "y": 0, "width": 200, "height": 80, "text": "Dopo" } }
    ])
    .to_string();
    apply(
        &mut ws,
        json!({ "doc": doc.as_str(), "ops": added }),
        InvokeMode::Apply,
    )
    .expect("si cambia");
    let changed = source(&ws, doc.as_str());

    let undo = second.undo.expect("la creazione si annulla");
    for step in undo.steps {
        let UndoStep::Command { command, args } = step else {
            panic!("l'annulla di una creazione è un comando");
        };
        ws.invoke_command(&command, args, InvokeMode::Apply, Actor::User)
            .expect("l'annulla si esegue");
    }
    assert!(ws.read_source(&doc).is_err(), "la lavagna non c'è più");
    assert!(ws.read_source(&opened(&first)).is_ok(), "la prima resta");
    let trash = ws.list_trash().expect("il cestino");
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].original, doc);
    assert_eq!(
        std::fs::read_to_string(vault.root.join(trash[0].id.as_str())).expect("nel cestino"),
        changed,
        "il cestino tiene la lavagna cambiata"
    );

    // Il nome liberato torna il primo libero.
    let again = create(&mut ws, json!({}), InvokeMode::Apply).expect("un'altra");
    assert_eq!(opened(&again), DocId::new("Lavagna 1.canvas"));
}

#[test]
fn una_lavagna_nasce_anche_in_una_cartella_che_non_c_e() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    let outcome = create(
        &mut ws,
        json!({ "name": "Piano.canvas", "folder": "Nuove/Idee" }),
        InvokeMode::Apply,
    )
    .expect("nasce con la sua cartella");
    assert_eq!(opened(&outcome), DocId::new("Nuove/Idee/Piano.canvas"));
    assert!(vault.root.join("Nuove/Idee/Piano.canvas").is_file());
}

#[test]
fn una_lavagna_non_prende_il_posto_di_un_file() {
    let (_vault, mut ws) = with_board(BEFORE);
    for name in ["Idee", BOARD] {
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = create(&mut ws, json!({ "name": name }), mode).expect_err("occupato");
            assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
        }
    }
    assert_eq!(source(&ws, BOARD), BEFORE);
    let error = create(&mut ws, json!({ "name": "Idee: due" }), InvokeMode::Apply)
        .expect_err("un nome vietato");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
}
