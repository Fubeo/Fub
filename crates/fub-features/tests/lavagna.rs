// Senza la cargo feature `lavagna` il modulo non è compilato, e un test che lo
// nomina non avrebbe un soggetto.
#![cfg(feature = "lavagna")]
//! **`canvas.apply`, `canvas.create`, `canvas.read`, `canvas.check`,
//! `canvas.guide` e `canvas.preview` end-to-end**, attraverso il kernel vero e
//! il formato vero delle lavagne: le operazioni arrivano nel file come una
//! modifica sola, il piano non scrive niente, e l'annulla riporta i byte di
//! prima; una lavagna nuova prende il nome libero, è la lavagna vuota del
//! nucleo, e l'annulla la manda nel cestino. Leggere e controllare non scrivono
//! mai: il controllo dà un problema per codice, la lettura le tre forme, la
//! guida il testo, i nomi, lo schema e gli esempi, e l'anteprima il disegno
//! (un PNG con `draw`, l'SVG senza) con l'elenco delle schede.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::traits::CommandProvider;
use fub_abi::PluginError;
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_features::lavagna::{
    CANVAS_CHECK, CANVAS_CREATE, CANVAS_GUIDE, CANVAS_PREVIEW, CANVAS_READ,
};
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

// ---- canvas.read, canvas.check, canvas.guide ----

/// Tre schede, un arco e un gruppo che le contiene: le letture di tutte le forme.
const READ_BOARD: &str = r#"{"nodes": [
  {"id": "a", "type": "text", "x": 0, "y": 0, "width": 200, "height": 80, "text": "Ciao"},
  {"id": "b", "type": "text", "x": 300, "y": 0, "width": 200, "height": 80, "text": "Poi", "color": "4"},
  {"id": "g", "type": "group", "x": -20, "y": -40, "width": 560, "height": 160, "label": "Gruppo"}
], "edges": [{"id": "e1", "fromNode": "a", "toNode": "b", "label": "porta a"}]}"#;

const EMPTY_BOARD: &str = r#"{"nodes": [], "edges": []}"#;

fn read_cmd(
    ws: &mut Workspace,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_READ, args, mode, Actor::User)
}

fn check_cmd(
    ws: &mut Workspace,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_CHECK, args, mode, Actor::User)
}

fn guide_cmd(ws: &mut Workspace, args: Value) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_GUIDE, args, InvokeMode::Apply, Actor::User)
}

/// Una lavagna di `count` schede di testo in griglia: il caso delle 100 000 schede.
fn many_cards(count: usize) -> String {
    let cards: Vec<String> = (0..count)
        .map(|i| {
            format!(
                r#"{{"id": "n{i}", "type": "text", "x": {}, "y": {}, "width": 200, "height": 80, "text": "Scheda {i}"}}"#,
                (i % 100) * 240,
                (i / 100) * 120
            )
        })
        .collect();
    format!(r#"{{"nodes": [{}], "edges": []}}"#, cards.join(", "))
}

#[test]
fn leggere_di_serie_da_una_riga_per_scheda_con_i_conti() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let doc = DocId::new(BOARD);
    let revision = ws.document_revision(&doc).expect("revisione").0;

    let outcome = read_cmd(&mut ws, json!({ "doc": BOARD }), InvokeMode::Apply).expect("si legge");
    let payload = custom(&outcome);
    assert_eq!(payload["version"], 1);
    assert_eq!(payload["kind"], "read");
    assert_eq!(payload["doc"], BOARD);
    assert_eq!(payload["revision"], json!(revision), "la revisione letta");
    assert_eq!(payload["form"], "outline");
    assert_eq!(
        payload["counts"],
        json!({ "cards": 3, "edges": 1, "groups": 1 })
    );
    assert_eq!(
        payload["bounds"],
        json!({ "x": -20, "y": -40, "width": 560, "height": 160 })
    );
    let text = payload["text"].as_str().expect("il testo");
    assert_eq!(
        text.lines().next(),
        Some("cards 3 edges 1 groups 1 bounds -20 -40 560×160")
    );
    assert_eq!(
        text,
        "cards 3 edges 1 groups 1 bounds -20 -40 560×160\n1 a text \"Ciao\" 0 0 200×80 in=g\n2 b text \"Poi\" 300 0 200×80 color=4 in=g\n3 g group \"Gruppo\" -20 -40 560×160\ne1 a -> b \"porta a\"",
        "la lettura di serie"
    );
    assert!(
        payload.get("model").is_none(),
        "il modello si dà solo se chiesto"
    );

    let dry = read_cmd(&mut ws, json!({ "doc": BOARD }), InvokeMode::DryRun)
        .expect("anche il piano legge");
    assert_eq!(custom(&dry), payload);
    assert_eq!(source(&ws, BOARD), READ_BOARD, "leggere non scrive");
}

#[test]
fn la_forma_code_ricrea_la_lavagna_su_una_vuota() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let outcome = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "form": "code" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    let payload = custom(&outcome);
    assert_eq!(payload["form"], "code");
    assert!(payload.get("model").is_none());
    let ops: Vec<CanvasOp> = serde_json::from_str(payload["text"].as_str().expect("il testo"))
        .expect("una lista di operazioni");
    assert_eq!(ops.len(), 4, "tre schede e un arco");

    let mut core = fub_canvas_core::commit::Core::open(EMPTY_BOARD).expect("la vuota si apre");
    let compiled = compile(core.canvas(), &ops, 1).expect("la lista si compila");
    core.commit(&compiled.patches).expect("si scrive");
    let canvas = core.canvas();
    let nodes: Vec<&str> = canvas.nodes.iter().map(|node| node.id.as_str()).collect();
    let edges: Vec<&str> = canvas.edges.iter().map(|edge| edge.id.as_str()).collect();
    assert_eq!(nodes, ["a", "b", "g"]);
    assert_eq!(edges, ["e1"]);
}

#[test]
fn la_forma_json_e_il_modello_e_si_da_solo_se_chiesta() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let outcome = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "form": "json" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    let payload = custom(&outcome);
    assert_eq!(payload["form"], "json");
    assert!(payload.get("text").is_none(), "la forma json non ha testo");
    assert_eq!(payload["model"]["nodes"].as_array().map(Vec::len), Some(3));
    assert_eq!(payload["model"]["edges"].as_array().map(Vec::len), Some(1));
}

#[test]
fn ids_legge_solo_quelle_schede_e_gli_archi_fra_loro() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let two = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ids": "[\"a\", \"zz\", \"b\"]" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    let payload = custom(&two);
    assert_eq!(
        payload["counts"],
        json!({ "cards": 2, "edges": 1, "groups": 0 }),
        "lo zz non è una scheda: i conti lo dicono"
    );
    assert_eq!(
        payload["text"]
            .as_str()
            .and_then(|text| text.lines().next()),
        Some("cards 2 edges 1 groups 0 bounds 0 0 500×80")
    );

    let alone = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ids": "[\"a\"]" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    assert_eq!(
        custom(&alone)["counts"],
        json!({ "cards": 1, "edges": 0, "groups": 0 }),
        "un arco vuole tutte e due le schede"
    );

    let none = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ids": "[]" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    assert_eq!(custom(&none)["bounds"], Value::Null);
    assert_eq!(
        custom(&none)["text"]
            .as_str()
            .and_then(|text| text.lines().next()),
        Some("cards 0 edges 0 groups 0 bounds -")
    );

    for raw in ["non è JSON", "{\"a\": 1}", "[\"a\", 3]", "\"a\""] {
        let error = read_cmd(
            &mut ws,
            json!({ "doc": BOARD, "ids": raw }),
            InvokeMode::Apply,
        )
        .expect_err("gli id non sono una lista di testi");
        assert!(matches!(error, PluginError::BadArgs(_)), "{raw}: {error:?}");
    }
}

#[test]
fn max_chars_taglia_l_outline_a_una_riga_intera_e_dice_quante_ne_restano() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let full = read_cmd(&mut ws, json!({ "doc": BOARD }), InvokeMode::Apply).expect("si legge");
    let full = custom(&full)["text"].as_str().expect("il testo").to_owned();
    assert_eq!(full.lines().count(), 5, "conti, tre schede e un arco");
    let first = full.lines().next().expect("la riga dei conti");

    // `max_chars` 0: esce la prima riga, sempre, con il conto di quelle che restano.
    let zero = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "max_chars": 0 }),
        InvokeMode::Apply,
    )
    .expect("zero è un limite valido");
    assert_eq!(custom(&zero)["text"], json!(format!("{first}\n…+4")));

    // Un limite che non entra la seconda riga: la stessa cosa, ma di sessanta caratteri.
    let sixty = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "max_chars": 60 }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    let sixty = custom(&sixty)["text"].as_str().expect("il testo");
    assert!(sixty.chars().count() <= 60, "{sixty}");
    assert_eq!(sixty, format!("{first}\n…+4"));

    let whole = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "max_chars": 10_000 }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    assert_eq!(
        custom(&whole)["text"],
        json!(full),
        "dentro il limite non si taglia"
    );

    for (form, raw) in [("code", json!(10)), ("json", json!(10))] {
        let error = read_cmd(
            &mut ws,
            json!({ "doc": BOARD, "form": form, "max_chars": raw }),
            InvokeMode::Apply,
        )
        .expect_err("max_chars vale solo per l'outline");
        assert!(
            matches!(error, PluginError::BadArgs(_)),
            "{form}: {error:?}"
        );
    }
    for raw in [json!(-1), json!(1.5)] {
        let error = read_cmd(
            &mut ws,
            json!({ "doc": BOARD, "max_chars": raw }),
            InvokeMode::Apply,
        )
        .expect_err("non è un intero da zero in su");
        assert!(matches!(error, PluginError::BadArgs(_)), "{raw}: {error:?}");
    }
}

#[test]
fn una_lavagna_di_100_000_schede_si_legge_con_il_limite_di_serie() {
    let (_vault, mut ws) = with_board(&many_cards(100_000));

    let outline = read_cmd(&mut ws, json!({ "doc": BOARD }), InvokeMode::Apply).expect("si legge");
    let payload = custom(&outline);
    assert_eq!(payload["counts"]["cards"], 100_000);
    let text = payload["text"].as_str().expect("il testo");
    assert!(
        text.chars().count() <= 20_000,
        "l'outline di serie sta in 20 000 caratteri: {}",
        text.chars().count()
    );
    // La riga dei conti, le schede lette e la riga che dice quante ne restano
    // sono tutte le 100 001 righe della lavagna.
    let lines: Vec<&str> = text.lines().collect();
    let rest: usize = lines
        .last()
        .and_then(|last| last.strip_prefix("…+"))
        .and_then(|rest| rest.parse().ok())
        .expect("l'ultima riga dice quante restano");
    let shown = lines.len() - 2;
    assert_eq!(
        shown + rest,
        100_000,
        "le schede lette e quelle che restano"
    );

    // Il modello intero solo se chiesto.
    let model = read_cmd(
        &mut ws,
        json!({ "doc": BOARD, "form": "json" }),
        InvokeMode::Apply,
    )
    .expect("si legge");
    assert_eq!(
        custom(&model)["model"]["nodes"].as_array().map(Vec::len),
        Some(100_000)
    );
}

#[test]
fn leggere_e_controllare_rifiutano_come_apply_un_documento_che_non_e_una_lavagna() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    ws.write_document(&DocId::new("Nota.md"), "# Nota\n", WriteBase::Dictated)
        .expect("la nota si scrive");
    let args = json!({ "doc": "Nota.md", "ops": ops() });
    for name in [CANVAS_READ, CANVAS_CHECK, CANVAS_PREVIEW, CANVAS_APPLY] {
        let error = ws
            .invoke_command(name, args.clone(), InvokeMode::Apply, Actor::User)
            .expect_err("una nota non è una lavagna");
        assert!(
            matches!(error, PluginError::BadArgs(_)),
            "{name}: {error:?}"
        );
    }
    assert_eq!(source(&ws, "Nota.md"), "# Nota\n", "la nota non cambia");
}

#[test]
fn una_lavagna_che_non_si_apre_e_un_errore_di_argomenti_per_tutti_e_tre() {
    let (_vault, mut ws) = with_board("{\"nodes\": [");
    let args = json!({ "doc": BOARD, "ops": ops() });
    for name in [CANVAS_READ, CANVAS_CHECK, CANVAS_PREVIEW, CANVAS_APPLY] {
        let error = ws
            .invoke_command(name, args.clone(), InvokeMode::Apply, Actor::User)
            .expect_err("non si apre");
        assert!(
            matches!(error, PluginError::BadArgs(_)),
            "{name}: {error:?}"
        );
    }
    assert_eq!(source(&ws, BOARD), "{\"nodes\": [", "il file non cambia");
}

#[test]
fn controllare_dice_il_riassunto_e_non_scrive() {
    // Schede alte 160, il minimo della stima del testo: una più bassa darebbe
    // anche `text_overflow`, e questo caso vuole solo la sovrapposizione.
    const TALL: &str = r#"{"nodes": [{"id": "a", "type": "text", "x": 0, "y": 0, "width": 200, "height": 160, "text": "Ciao"}], "edges": []}"#;
    let (_vault, mut ws) = with_board(TALL);
    let ops = json!([
        { "op": "move", "ids": ["a"], "dx": 40, "dy": 0 },
        { "op": "add_card", "node": { "id": "b", "type": "text", "x": 100, "y": 0, "width": 200, "height": 160, "text": "Poi" } }
    ])
    .to_string();
    let args = json!({ "doc": BOARD, "ops": ops });
    let outcome = check_cmd(&mut ws, args.clone(), InvokeMode::Apply).expect("il rapporto");
    let payload = custom(&outcome);
    assert_eq!(payload["kind"], "check");
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["problems"], json!([]));
    // La scheda `a` si sposta e `b` nasce sopra: si coprono, e l'avviso lo dice.
    assert_eq!(
        payload["warnings"],
        json!([{ "code": "overlap", "ids": ["a", "b"] }])
    );
    assert_eq!(payload["warnings_omitted"], 0);
    assert_eq!(payload["summary"]["cards_added"][0]["id"], "b");
    assert_eq!(payload["summary"]["cards_changed"][0]["id"], "a");
    assert_eq!(
        payload["outline_after"]
            .as_str()
            .and_then(|text| text.lines().next()),
        Some("cards 2 edges 0 groups 0 bounds 40 0 260×160")
    );
    // L'esempio di `canvas-operations.md`, «Comandi»: il payload intero.
    assert_eq!(
        *payload,
        json!({
            "version": 1,
            "kind": "check",
            "ok": true,
            "problems": [],
            "warnings": [{ "code": "overlap", "ids": ["a", "b"] }],
            "warnings_omitted": 0,
            "summary": {
                "cards_added": [{ "id": "b", "text": "Poi" }],
                "cards_removed": [],
                "cards_changed": [{
                    "id": "a",
                    "text": "Ciao",
                    "moved": { "from": { "x": 0, "y": 0 }, "to": { "x": 40, "y": 0 } }
                }],
                "edges_added": [],
                "edges_removed": [],
                "edges_changed": [],
                "order_changed": false
            },
            "outline_after": "cards 2 edges 0 groups 0 bounds 40 0 260×160\n1 a text \"Ciao\" 40 0 200×160\n2 b text \"Poi\" 100 0 200×160"
        }),
        "il payload del controllo"
    );
    assert!(outcome.notify.is_some(), "il riassunto per chi legge");
    assert_eq!(source(&ws, BOARD), TALL, "controllare non scrive");

    let dry = check_cmd(&mut ws, args, InvokeMode::DryRun).expect("anche il piano controlla");
    assert_eq!(custom(&dry), payload);
}

#[test]
fn ogni_codice_di_problema_ha_il_suo_problema() {
    let (_vault, mut ws) = with_board(BEFORE);
    let cases = [
        (json!([{ "op": "fly" }]), "unknown_op"),
        (
            json!([{ "op": "move", "ids": ["a"], "dx": 1, "dy": 1, "zz": 2 }]),
            "unknown_field",
        ),
        (
            json!([{ "op": "move", "ids": ["a"], "dx": 1 }]),
            "missing_field",
        ),
        (
            json!([{ "op": "move", "ids": "a", "dx": 1, "dy": 1 }]),
            "wrong_type",
        ),
        (
            json!([{ "op": "move", "ids": ["zz"], "dx": 1, "dy": 1 }]),
            "unknown_node",
        ),
        (json!([{ "op": "remove", "ids": ["zz"] }]), "unknown_edge"),
        (
            json!([{ "op": "add_card", "node": { "id": "a", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "" } }]),
            "duplicate_id",
        ),
        (
            json!([{ "op": "resize", "id": "a", "width": 0, "height": 10 }]),
            "invalid",
        ),
        (json!([]), "invalid"),
        (json!({ "op": "move" }), "wrong_type"),
    ];
    for (ops, code) in cases {
        let outcome = check_cmd(
            &mut ws,
            json!({ "doc": BOARD, "ops": ops.to_string() }),
            InvokeMode::Apply,
        )
        .expect("un rapporto, non un errore");
        let payload = custom(&outcome);
        assert_eq!(payload["ok"], false, "{ops}");
        let problems = payload["problems"].as_array().expect("i problemi");
        assert_eq!(problems.len(), 1, "{ops}: {problems:?}");
        assert_eq!(problems[0]["code"], code, "{ops}");
        assert_eq!(
            problems[0]["text"],
            json!({ "key": format!("canvas.check.p_{code}") }),
            "{ops}: la frase la rende il catalogo"
        );
        assert_eq!(payload["summary"], Value::Null, "{ops}");
        assert_eq!(payload["outline_after"], Value::Null, "{ops}");
    }
}

#[test]
fn troppe_schede_sono_il_problema_too_many() {
    let (_vault, mut ws) = with_board(&many_cards(100_000));
    let ops = json!([{ "op": "add_card", "node": { "id": "nuova", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "" } }]);
    let outcome = check_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops.to_string() }),
        InvokeMode::Apply,
    )
    .expect("un rapporto");
    let problems = custom(&outcome)["problems"].clone();
    assert_eq!(problems[0]["code"], "too_many", "{problems}");
    assert_eq!(problems[0]["index"], 0);
}

#[test]
fn una_base_vecchia_e_il_problema_stale_base_e_non_un_errore() {
    let (_vault, mut ws) = with_board(BEFORE);
    let current = ws
        .document_revision(&DocId::new(BOARD))
        .expect("revisione")
        .0;
    let ops = json!([{ "op": "move", "ids": ["a"], "dx": 40, "dy": 0 }]).to_string();

    let stale = check_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops, "base": "sha256:0" }),
        InvokeMode::Apply,
    )
    .expect("un rapporto");
    let payload = custom(&stale);
    assert_eq!(payload["ok"], false);
    assert_eq!(payload["problems"][0]["code"], "stale_base");
    assert_eq!(
        payload["problems"][0]["text"]["key"],
        "canvas.check.p_stale_base"
    );
    assert_eq!(payload["problems"].as_array().map(Vec::len), Some(1));
    assert_eq!(payload["summary"], Value::Null);
    assert_eq!(payload["outline_after"], Value::Null);

    // Con la revisione giusta il controllo passa, e la base vecchia con una
    // lista sbagliata dà i due problemi, la base prima.
    let fresh = check_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops, "base": current }),
        InvokeMode::Apply,
    )
    .expect("un rapporto");
    assert_eq!(custom(&fresh)["ok"], true);
    let both = check_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ops": "[{\"op\":\"fly\"}]", "base": "sha256:0" }),
        InvokeMode::Apply,
    )
    .expect("un rapporto");
    let codes: Vec<&Value> = custom(&both)["problems"]
        .as_array()
        .expect("i problemi")
        .iter()
        .map(|problem| &problem["code"])
        .collect();
    assert_eq!(codes, [&json!("stale_base"), &json!("unknown_op")]);
    assert_eq!(source(&ws, BOARD), BEFORE, "il controllo non scrive");
}

#[test]
fn gli_id_del_controllo_sono_quelli_della_scrittura() {
    let (_vault, mut ws) = with_board(BEFORE);
    let ops = json!([{ "op": "add_card", "node": { "type": "text", "x": 400, "y": 0, "width": 200, "height": 80, "text": "Nuova" } }])
        .to_string();
    let checked = check_cmd(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops }),
        InvokeMode::Apply,
    )
    .expect("il rapporto");
    let predicted = custom(&checked)["summary"]["cards_added"][0]["id"].clone();
    let applied = apply(
        &mut ws,
        json!({ "doc": BOARD, "ops": ops }),
        InvokeMode::Apply,
    )
    .expect("si applica");
    assert_eq!(
        custom(&applied)["created"][0],
        predicted,
        "stesso seme, stessi id"
    );
}

#[test]
fn una_lista_che_non_si_legge_non_cambia_il_file() {
    // Il primo problema della forma e la chiave dell'errore si provano nei test
    // unitari di `lavagna.rs`: qui il kernel rende già il testo nella lingua.
    let (_vault, mut ws) = with_board(BEFORE);
    for ops in ["[{\"op\":\"fly\"}]", "non è JSON", "{}"] {
        let error = apply(
            &mut ws,
            json!({ "doc": BOARD, "ops": ops }),
            InvokeMode::Apply,
        )
        .expect_err("una lista che non si legge");
        assert!(matches!(error, PluginError::BadArgs(_)), "{ops}: {error:?}");
    }
    assert_eq!(source(&ws, BOARD), BEFORE, "il file non cambia");
}

#[test]
fn i_comandi_che_leggono_non_scrivono() {
    let specs = LavagnaCommands.commands();
    for id in [CANVAS_READ, CANVAS_CHECK, CANVAS_GUIDE, CANVAS_PREVIEW] {
        let spec = specs
            .iter()
            .find(|spec| spec.id == id)
            .unwrap_or_else(|| panic!("manca «{id}»"));
        assert!(!spec.scope.writes, "«{id}» non scrive");
    }
}

#[test]
fn la_guida_senza_topic_da_il_testo_e_tutte_le_operazioni() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    let outcome = guide_cmd(&mut ws, json!({})).expect("la guida");
    let payload = custom(&outcome);
    assert_eq!(payload["kind"], "guide");
    let text = payload["text"].as_str().expect("il testo");
    assert!(!text.trim().is_empty());
    assert!(text.lines().count() <= 150, "la guida sta in 150 righe");
    let names: Vec<&str> = payload["ops"]
        .as_array()
        .expect("le operazioni")
        .iter()
        .filter_map(|op| op["name"].as_str())
        .collect();
    assert_eq!(
        names,
        ["add_card", "move", "resize", "connect", "remove", "set", "reorder"]
    );
    assert_eq!(
        payload["schema"]["items"]["oneOf"].as_array().map(Vec::len),
        Some(7)
    );
    let examples = payload["examples"].as_array().expect("gli esempi");
    assert!(examples.len() >= 7, "almeno un esempio per operazione");
    assert!(examples.iter().all(|example| example["op"].is_string()));
}

#[test]
fn la_guida_con_un_topic_da_solo_la_sua_voce() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    let outcome = guide_cmd(&mut ws, json!({ "topic": "move" })).expect("la guida");
    let payload = custom(&outcome);
    let ops = payload["ops"].as_array().expect("le operazioni");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["name"], "move");
    assert_eq!(
        payload["schema"]["items"]["oneOf"][0]["properties"]["op"]["const"],
        "move"
    );
    assert_eq!(
        payload["schema"]["items"]["oneOf"].as_array().map(Vec::len),
        Some(1)
    );
    let examples = payload["examples"].as_array().expect("gli esempi");
    assert!(!examples.is_empty());
    assert!(examples.iter().all(|example| example["op"] == "move"));
    assert!(payload["text"].as_str().is_some_and(|t| !t.is_empty()));

    // Un topic vuoto è come non averlo.
    let blank = guide_cmd(&mut ws, json!({ "topic": "  " })).expect("la guida");
    assert_eq!(custom(&blank)["ops"].as_array().map(Vec::len), Some(7));
}

#[test]
fn un_topic_sconosciuto_e_un_errore_di_argomenti() {
    // I nomi vicini sono nel messaggio: si provano nei test unitari di `lavagna.rs`.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    for topic in ["mvoe", "xyzzy"] {
        let error = guide_cmd(&mut ws, json!({ "topic": topic })).expect_err("non c'è");
        assert!(
            matches!(error, PluginError::BadArgs(_)),
            "{topic}: {error:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// canvas.preview
// ---------------------------------------------------------------------------

fn preview_cmd(ws: &mut Workspace, args: Value) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(CANVAS_PREVIEW, args, InvokeMode::Apply, Actor::User)
}

/// Il tipo dell'immagine che la build dà: un PNG con `draw`, altrimenti l'SVG.
fn image_media() -> &'static str {
    if cfg!(feature = "draw") {
        "image/png"
    } else {
        "image/svg+xml"
    }
}

/// Il lato lungo di un'immagine, dalla sua misura nel payload.
fn long_side(image: &Value) -> Option<u64> {
    image["width"]
        .as_u64()
        .zip(image["height"].as_u64())
        .map(|(w, h)| w.max(h))
}

#[test]
fn il_disegno_non_scrive_e_dice_la_forma() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let before = source(&ws, BOARD);
    let outcome = preview_cmd(&mut ws, json!({ "doc": BOARD })).expect("si disegna");

    let payload = custom(&outcome);
    assert_eq!(payload["kind"], "preview");
    assert_eq!(payload["version"], 1);
    assert_eq!(payload["image"]["media_type"], image_media());
    assert_eq!(
        long_side(&payload["image"]),
        Some(1024),
        "il lato lungo di serie"
    );

    // Le tre schede di READ_BOARD, col numero che la lettura dà loro.
    let outline = payload["outline"].as_array().expect("l'elenco");
    let ids: Vec<&str> = outline
        .iter()
        .map(|card| card["id"].as_str().expect("un id"))
        .collect();
    assert_eq!(ids, ["a", "b", "g"]);
    assert_eq!(outline[2]["kind"], "group");
    assert_eq!(payload["outline_omitted"], 0);
    assert_eq!(source(&ws, BOARD), before, "il file non cambia");
}

#[test]
fn con_le_operazioni_disegna_la_lavagna_di_dopo_senza_scriverla() {
    let (_vault, mut ws) = with_board(BEFORE);
    let before = source(&ws, BOARD);
    let read = read_cmd(&mut ws, json!({ "doc": BOARD }), InvokeMode::Apply).expect("si legge");
    let revision = custom(&read)["revision"].clone();

    let outcome = preview_cmd(&mut ws, json!({ "doc": BOARD, "ops": ops() })).expect("si disegna");
    let payload = custom(&outcome);
    let ids: Vec<&str> = payload["outline"]
        .as_array()
        .expect("l'elenco")
        .iter()
        .map(|card| card["id"].as_str().expect("un id"))
        .collect();
    assert_eq!(
        ids,
        ["a", "b"],
        "la scheda nuova c'è, nella lavagna di dopo"
    );
    assert_eq!(payload["revision"], revision, "la revisione non cambia");
    assert_eq!(source(&ws, BOARD), before, "il file non cambia");
}

#[test]
fn una_lista_che_non_si_disegna_e_un_argomento_sbagliato() {
    let (_vault, mut ws) = with_board(BEFORE);
    let unknown = json!([{ "op": "move", "ids": ["manca"], "dx": 1, "dy": 0 }]).to_string();
    for ops in [unknown, "non json".to_owned(), "[]".to_owned()] {
        let error = preview_cmd(&mut ws, json!({ "doc": BOARD, "ops": ops }))
            .expect_err("la lista non si disegna");
        assert!(matches!(error, PluginError::BadArgs(_)), "{ops}: {error:?}");
    }
}

#[test]
fn una_base_vecchia_e_un_conflitto_come_in_apply() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let error = preview_cmd(
        &mut ws,
        json!({ "doc": BOARD, "base": "revisione-vecchia" }),
    )
    .expect_err("la lavagna è cambiata");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
}

#[test]
fn la_misura_si_stringe_e_un_numero_che_non_e_intero_e_un_errore() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let big = preview_cmd(&mut ws, json!({ "doc": BOARD, "size": 10_000 })).expect("si stringe");
    assert_eq!(long_side(&custom(&big)["image"]), Some(2048));

    let small = preview_cmd(&mut ws, json!({ "doc": BOARD, "size": 0 })).expect("si stringe");
    assert_eq!(long_side(&custom(&small)["image"]), Some(64));

    for bad in [json!(1.5), json!(-3)] {
        let error = preview_cmd(&mut ws, json!({ "doc": BOARD, "size": bad.clone() }))
            .expect_err("un lato non è un intero da zero in su");
        assert!(matches!(error, PluginError::BadArgs(_)), "{bad}: {error:?}");
    }
}

#[test]
fn una_lavagna_vuota_si_disegna_come_un_quadrato_di_64() {
    let (_vault, mut ws) = with_board(EMPTY_BOARD);
    let outcome = preview_cmd(&mut ws, json!({ "doc": BOARD })).expect("si disegna");
    let image = &custom(&outcome)["image"];
    assert_eq!(
        (image["width"].as_u64(), image["height"].as_u64()),
        (Some(64), Some(64))
    );
    assert_eq!(
        custom(&outcome)["outline"].as_array().map(Vec::len),
        Some(0)
    );
}

#[cfg(not(feature = "draw"))]
#[test]
fn senza_draw_l_immagine_e_l_svg_come_testo() {
    let (_vault, mut ws) = with_board(READ_BOARD);
    let outcome = preview_cmd(&mut ws, json!({ "doc": BOARD })).expect("si disegna");
    let data = custom(&outcome)["image"]["data"]
        .as_str()
        .expect("il testo dell'SVG");
    assert!(data.starts_with("<svg "), "{}", &data[..data.len().min(80)]);
    assert!(
        data.contains("<![CDATA[Ciao]]></text>"),
        "il testo della scheda c'è nell'SVG"
    );
}

#[cfg(feature = "draw")]
mod con_draw {
    use super::*;
    use base64::Engine as _;

    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    /// Il PNG di un disegno in base64: la sua misura e i suoi pixel in RGBA.
    fn decode(data: &str) -> (u32, u32, Vec<u8>) {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .expect("il PNG è in base64");
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .expect("un PNG si legge");
        let mut buffer = vec![0; reader.output_buffer_size().expect("una misura")];
        let info = reader.next_frame(&mut buffer).expect("i pixel");
        buffer.truncate(info.buffer_size());
        (info.width, info.height, buffer)
    }

    /// Il disegno, con i suoi pixel, e la misura dichiarata nel payload che coincide.
    fn picture(ws: &mut Workspace, args: Value) -> (Value, Vec<u8>) {
        let outcome = preview_cmd(ws, args).expect("si disegna");
        let image = custom(&outcome)["image"].clone();
        let (width, height, pixels) = decode(image["data"].as_str().expect("i dati"));
        assert_eq!(image["media_type"], "image/png");
        assert_eq!(
            (image["width"].as_u64(), image["height"].as_u64()),
            (Some(u64::from(width)), Some(u64::from(height)))
        );
        (image, pixels)
    }

    #[test]
    fn il_png_ha_la_firma_e_due_chiamate_danno_gli_stessi_byte() {
        let (_vault, mut ws) = with_board(READ_BOARD);
        let raw = |ws: &mut Workspace| {
            let outcome = preview_cmd(ws, json!({ "doc": BOARD })).expect("si disegna");
            let data = custom(&outcome)["image"]["data"]
                .as_str()
                .expect("i dati")
                .to_owned();
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .expect("base64")
        };
        let first = raw(&mut ws);
        let second = raw(&mut ws);
        assert_eq!(first[..8], PNG_SIGNATURE, "la firma del PNG");
        assert_eq!(first, second, "la stessa lavagna dà gli stessi byte");
    }

    #[test]
    fn una_scheda_con_testo_ha_pixel_di_testo_non_solo_del_suo_colore() {
        // Una scheda rossa di serie col testo scuro: il rosso c'è, e c'è anche
        // l'inchiostro del testo, cioè pixel scuri che non sono né il rosso né il
        // bianco del fondo.
        let (_vault, mut ws) = with_board(
            r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":320,"height":160,"color":"1","text":"Ciao mondo, come va"}],"edges":[]}"#,
        );
        let (_image, pixels) = picture(&mut ws, json!({ "doc": BOARD }));
        let red = [0xfb, 0xe1, 0xe1];
        let ink = pixels
            .chunks_exact(4)
            .filter(|px| u32::from(px[0]) + u32::from(px[1]) + u32::from(px[2]) < 300)
            .count();
        let card = pixels.chunks_exact(4).filter(|px| px[..3] == red).count();
        assert!(card > 1000, "la scheda rossa si vede: {card} pixel");
        assert!(ink > 50, "il testo si vede: {ink} pixel scuri");
    }

    #[test]
    fn un_carattere_che_i_font_non_hanno_resta_un_segno_e_non_un_errore() {
        // Emoji, scrittura da destra a sinistra e un controllo: il disegno esce
        // lo stesso, con i caratteri di Fub e senza un carattere di sistema.
        let (_vault, mut ws) = with_board(
            r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":320,"height":160,"text":"emoji 👋 ebraico שלום \u0007 fine"}],"edges":[]}"#,
        );
        let (image, _pixels) = picture(&mut ws, json!({ "doc": BOARD }));
        assert_eq!(image["media_type"], "image/png");
    }
}
