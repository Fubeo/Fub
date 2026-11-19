// Senza le cargo feature `lavagna` e `commands` (l'annulla e il cestino) i
// comandi non ci sono, e un test che li nomina non avrebbe un soggetto.
#![cfg(all(feature = "lavagna", feature = "commands"))]
//! **«Porta su una lavagna» e «Porta in una nota» end-to-end** (E25, T48),
//! attraverso il kernel vero, il formato vero delle note e quello delle
//! lavagne: andata e ritorno nota, lavagna, nota danno lo stesso testo; due
//! file con un annulla solo, che li rimette tutti e due o, se uno è cambiato
//! dopo, non tocca niente; una nota o una lavagna cambiata nel frattempo non
//! muove niente.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode};
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_features::lavagna::{CANVAS_FROM_NOTE, CANVAS_TO_NOTE};
use fub_features::{CoreCommands, LavagnaCommands, COMMANDS_ID, LAVAGNA_ID, VAULT_UNDO};
use fub_format_canvas::CanvasProvider;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

mod lavagna_nota {
    use super::*;

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
            ws.register_plugin(
                fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                    .speaking("it", fub_features::commands::catalog()),
                fub_kernel::Trust::Core,
            )
            .expect("dichiarato");
            ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
                .expect("registrato");
            ws
        }
    }

    /// Una nota coi casi del piano: un titolo con sotto una sezione, un
    /// elenco, un embed di un file (che resta lo stesso file) e un paragrafo
    /// fuori dalla scelta.
    const NOTE: &str = "Mostra.md";
    const NOTE_TEXT: &str = "# Mostra\n\nIntro che resta.\n\n- lunedì chiuso\n- martedì 10-18\n\n![[Pianta]]\n\n## Percorso\n\nSi entra dal cortile.\n\nPoi la sala grande.\n\n## Dopo\n\nFine che resta.\n";
    /// La scelta: dall'elenco alla sezione «Percorso» compresa.
    const CHOSEN: &str = "- lunedì chiuso\n- martedì 10-18\n\n![[Pianta]]\n\n## Percorso\n\nSi entra dal cortile.\n\nPoi la sala grande.";

    fn with_note() -> (Vault, Workspace) {
        let vault = Vault::new();
        std::fs::write(vault.root.join(NOTE), NOTE_TEXT).expect("la nota si scrive");
        std::fs::write(vault.root.join("Pianta.md"), "La pianta.\n").expect("si scrive");
        let mut ws = vault.open();
        ws.reindex().expect("reindex");
        (vault, ws)
    }

    fn chosen_args() -> Value {
        let start = NOTE_TEXT.find(CHOSEN).expect("la scelta c'è");
        json!({ "doc": NOTE, "at": [start, start + CHOSEN.len()], "text": CHOSEN })
    }

    fn invoke(
        ws: &mut Workspace,
        command: &str,
        args: Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        ws.invoke_command(command, args, mode, Actor::User)
    }

    fn undo(ws: &mut Workspace) -> Result<CommandOutcome, PluginError> {
        invoke(ws, VAULT_UNDO, Value::Null, InvokeMode::Apply)
    }

    fn source(ws: &Workspace, id: &str) -> String {
        ws.read_source(&DocId::new(id)).expect("legge")
    }

    fn opened(outcome: &CommandOutcome) -> DocId {
        match &outcome.effect {
            CommandEffect::Navigate { doc } => doc.clone(),
            other => panic!("il file nuovo si apre, non {other:?}"),
        }
    }

    fn nodes(ws: &Workspace, id: &str) -> Vec<Value> {
        let canvas: Value = serde_json::from_str(&source(ws, id)).expect("la lavagna è JSON");
        canvas["nodes"].as_array().expect("schede").clone()
    }

    #[test]
    fn lavagna_andata_e_ritorno_danno_lo_stesso_testo_e_l_annulla_rimette_i_due_file() {
        let (_vault, mut ws) = with_note();

        // Andata: quattro schede, nello stesso ordine e una sotto l'altra.
        let there = invoke(&mut ws, CANVAS_FROM_NOTE, chosen_args(), InvokeMode::Apply)
            .expect("i blocchi vanno sulla lavagna");
        let board = opened(&there);
        assert_eq!(
            board.as_str(),
            "Mostra.canvas",
            "accanto alla nota, col suo nome"
        );
        let cards = nodes(&ws, board.as_str());
        assert_eq!(cards.len(), 4, "{cards:#?}");
        assert_eq!(cards[0]["text"], "- lunedì chiuso");
        assert_eq!(cards[1]["text"], "- martedì 10-18");
        assert_eq!(cards[2]["type"], "file");
        assert_eq!(
            cards[2]["file"], "Pianta.md",
            "il file incorporato resta lo stesso"
        );
        assert_eq!(
            cards[3]["text"], "## Percorso\n\nSi entra dal cortile.\n\nPoi la sala grande.",
            "il titolo porta la sua sezione"
        );
        let ys: Vec<i64> = cards
            .iter()
            .map(|card| card["y"].as_i64().unwrap())
            .collect();
        assert!(
            ys.windows(2).all(|pair| pair[0] < pair[1]),
            "in colonna: {ys:?}"
        );
        assert_eq!(
            source(&ws, NOTE),
            "# Mostra\n\nIntro che resta.\n\n## Dopo\n\nFine che resta.\n",
            "i blocchi lasciano la nota"
        );
        assert_eq!(
            there.notify.as_ref().expect("si racconta").to_string(),
            "Portato sulla lavagna «Mostra»."
        );

        // Ritorno: una nota nuova col testo di prima.
        let back = invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": board.as_str() }),
            InvokeMode::Apply,
        )
        .expect("le schede tornano in una nota");
        let note = opened(&back);
        assert_eq!(
            note.as_str(),
            "Mostra 1.md",
            "accanto alla lavagna, nel primo nome libero"
        );
        assert_eq!(source(&ws, note.as_str()), format!("{CHOSEN}\n"));
        assert!(
            nodes(&ws, board.as_str()).is_empty(),
            "le schede lasciano la lavagna"
        );

        // Due annulla: ognuno rimette i suoi due file.
        undo(&mut ws).expect("si annulla il ritorno");
        assert!(
            ws.read_source(&note).is_err(),
            "la nota nata va nel cestino"
        );
        assert_eq!(nodes(&ws, board.as_str()).len(), 4, "le schede tornano");
        undo(&mut ws).expect("si annulla l'andata");
        assert!(
            ws.read_source(&board).is_err(),
            "la lavagna nata va nel cestino"
        );
        assert_eq!(source(&ws, NOTE), NOTE_TEXT, "la nota è com'era");
    }

    #[test]
    fn lavagna_con_lascia_nella_nota_copia_e_la_nota_non_cambia() {
        let (_vault, mut ws) = with_note();
        let mut args = chosen_args();
        args["keep"] = json!(true);
        let outcome = invoke(&mut ws, CANVAS_FROM_NOTE, args, InvokeMode::Apply).expect("copia");
        assert_eq!(source(&ws, NOTE), NOTE_TEXT);
        assert_eq!(nodes(&ws, opened(&outcome).as_str()).len(), 4);
        assert_eq!(
            outcome.notify.as_ref().expect("si racconta").to_string(),
            "Copiato sulla lavagna «Mostra»."
        );
    }

    #[test]
    fn lavagna_un_titolo_da_solo_porta_tutta_la_sezione() {
        let (_vault, mut ws) = with_note();
        let heading = "## Percorso";
        let start = NOTE_TEXT.find(heading).expect("c'è");
        let outcome = invoke(
            &mut ws,
            CANVAS_FROM_NOTE,
            json!({ "doc": NOTE, "at": [start, start + heading.len()], "text": heading }),
            InvokeMode::Apply,
        )
        .expect("il titolo va sulla lavagna");
        let cards = nodes(&ws, opened(&outcome).as_str());
        assert_eq!(cards.len(), 1);
        assert_eq!(
            cards[0]["text"],
            "## Percorso\n\nSi entra dal cortile.\n\nPoi la sala grande."
        );
        assert_eq!(
            source(&ws, NOTE),
            "# Mostra\n\nIntro che resta.\n\n- lunedì chiuso\n- martedì 10-18\n\n![[Pianta]]\n\n## Dopo\n\nFine che resta.\n"
        );
    }

    #[test]
    fn lavagna_una_nota_cambiata_non_muove_niente() {
        let (_vault, mut ws) = with_note();
        let changed = NOTE_TEXT.replace("Intro che resta.", "Intro riscritta da fuori, più lunga.");
        ws.write_document(&DocId::new(NOTE), &changed, WriteBase::Dictated)
            .expect("scrive");
        let error = invoke(&mut ws, CANVAS_FROM_NOTE, chosen_args(), InvokeMode::Apply)
            .expect_err("i byte non sono più quelli");
        assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
        assert_eq!(source(&ws, NOTE), changed);
        assert!(
            ws.read_source(&DocId::new("Mostra.canvas")).is_err(),
            "nessuna lavagna"
        );
    }

    #[test]
    fn lavagna_la_simulazione_nomina_i_due_file_e_non_scrive() {
        let (_vault, mut ws) = with_note();
        let outcome =
            invoke(&mut ws, CANVAS_FROM_NOTE, chosen_args(), InvokeMode::DryRun).expect("il piano");
        let CommandEffect::Plan(plan) = outcome.effect else {
            panic!("una simulazione dà il piano");
        };
        let docs: Vec<&str> = plan.docs.iter().map(DocId::as_str).collect();
        assert!(
            docs.contains(&NOTE) && docs.contains(&"Mostra.canvas"),
            "{docs:?}"
        );
        assert_eq!(source(&ws, NOTE), NOTE_TEXT);
        assert!(ws.read_source(&DocId::new("Mostra.canvas")).is_err());
    }

    /// Una lavagna con un gruppo, un filo verso una scheda di testo, uno verso
    /// una scheda di file e uno verso il gruppo.
    const BOARD: &str = "Idee.canvas";
    const BOARD_TEXT: &str = r#"{
  "nodes": [
    {"id": "gruppo1", "type": "group", "x": 0, "y": 200, "width": 600, "height": 400, "label": "Da fare"},
    {"id": "dentro2", "type": "text", "x": 40, "y": 400, "width": 200, "height": 60, "text": "Seconda dentro"},
    {"id": "dentro1", "type": "text", "x": 40, "y": 260, "width": 200, "height": 60, "text": "Prima dentro"},
    {"id": "fuori1", "type": "text", "x": 0, "y": 0, "width": 200, "height": 60, "text": "In cima"},
    {"id": "file1", "type": "file", "x": 700, "y": 0, "width": 300, "height": 200, "file": "Pianta.md"},
    {"id": "sotto1", "type": "text", "x": 0, "y": 700, "width": 200, "height": 60, "text": "In fondo"}
  ],
  "edges": [
    {"id": "e1", "fromNode": "fuori1", "toNode": "sotto1"},
    {"id": "e2", "fromNode": "fuori1", "toNode": "file1", "label": "pianta"},
    {"id": "e3", "fromNode": "sotto1", "toNode": "gruppo1"}
  ]
}
"#;

    fn with_board() -> (Vault, Workspace) {
        let vault = Vault::new();
        std::fs::write(vault.root.join(BOARD), BOARD_TEXT).expect("si scrive");
        std::fs::write(vault.root.join("Pianta.md"), "La pianta.\n").expect("si scrive");
        std::fs::write(
            vault.root.join("Diario.md"),
            "# Diario\n\nPrima.\n\nDopo.\n",
        )
        .expect("si scrive");
        let mut ws = vault.open();
        ws.reindex().expect("reindex");
        (vault, ws)
    }

    #[test]
    fn lavagna_coi_gruppi_e_i_fili_diventa_una_colonna_coi_link() {
        let (_vault, mut ws) = with_board();
        let outcome = invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": BOARD, "keep": true }),
            InvokeMode::Apply,
        )
        .expect("in una nota");
        let note = opened(&outcome);
        assert_eq!(note.as_str(), "Idee.md");
        assert_eq!(
            source(&ws, note.as_str()),
            "In cima\n\n→ [[#^sotto1]] · [[Pianta|pianta]]\n\n![[Pianta]]\n\n## Da fare\n\nPrima dentro\n\nSeconda dentro\n\nIn fondo ^sotto1\n\n→ [[#Da fare]]\n"
        );
        assert_eq!(
            source(&ws, BOARD),
            BOARD_TEXT,
            "con «lascia» la lavagna non cambia"
        );
    }

    #[test]
    fn lavagna_le_schede_scelte_vanno_in_una_nota_che_c_e_e_l_annulla_rimette_i_due_file() {
        let (_vault, mut ws) = with_board();
        let diary = "# Diario\n\nPrima.\n\nDopo.\n";
        let at = diary.find("Dopo.").expect("c'è");
        invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": BOARD, "ids": "gruppo1", "to": "Diario.md", "at": at }),
            InvokeMode::Apply,
        )
        .expect("nella nota");
        assert_eq!(
            source(&ws, "Diario.md"),
            "# Diario\n\nPrima.\n\n## Da fare\n\nPrima dentro\n\nSeconda dentro\n\nDopo.\n",
            "il gruppo porta le sue schede, all'inizio della riga detta"
        );
        let left: Vec<String> = nodes(&ws, BOARD)
            .iter()
            .map(|node| node["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            left,
            ["fuori1", "file1", "sotto1"],
            "il gruppo e le sue schede lasciano la lavagna"
        );
        let canvas: Value = serde_json::from_str(&source(&ws, BOARD)).unwrap();
        assert_eq!(
            canvas["edges"].as_array().unwrap().len(),
            2,
            "il filo verso il gruppo se ne va"
        );

        undo(&mut ws).expect("si annulla");
        assert_eq!(source(&ws, "Diario.md"), diary);
        assert_eq!(source(&ws, BOARD), BOARD_TEXT);
    }

    #[test]
    fn lavagna_l_annulla_dopo_che_un_file_e_cambiato_non_tocca_niente() {
        let (_vault, mut ws) = with_board();
        invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": BOARD, "ids": "fuori1", "to": "Diario.md" }),
            InvokeMode::Apply,
        )
        .expect("nella nota");
        let board_after = source(&ws, BOARD);
        let later = format!("{}Scritto dopo.\n", source(&ws, "Diario.md"));
        ws.write_document(&DocId::new("Diario.md"), &later, WriteBase::Dictated)
            .expect("scrive");
        let error = undo(&mut ws).expect_err("la nota è cambiata dopo");
        assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
        assert_eq!(source(&ws, "Diario.md"), later);
        assert_eq!(source(&ws, BOARD), board_after);
    }

    #[test]
    fn lavagna_cambiata_o_scheda_sparita_non_muovono_niente() {
        let (_vault, mut ws) = with_board();
        let error = invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": BOARD, "base": "vecchia" }),
            InvokeMode::Apply,
        )
        .expect_err("la revisione non è quella");
        assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
        let error = invoke(
            &mut ws,
            CANVAS_TO_NOTE,
            json!({ "doc": BOARD, "ids": "fuori1,sparita" }),
            InvokeMode::Apply,
        )
        .expect_err("una scheda non c'è");
        assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
        assert_eq!(source(&ws, BOARD), BOARD_TEXT);
        assert!(ws.read_source(&DocId::new("Idee.md")).is_err());
    }

    #[test]
    fn lavagna_i_blocchi_vanno_in_una_lavagna_che_c_e_a_destra_di_cio_che_ha() {
        let (_vault, mut ws) = with_board();
        let block = "Prima.";
        let start = "# Diario\n\nPrima.\n\nDopo.\n".find(block).unwrap();
        invoke(
            &mut ws,
            CANVAS_FROM_NOTE,
            json!({ "doc": "Diario.md", "at": [start, start + block.len()], "text": block, "to": BOARD }),
            InvokeMode::Apply,
        )
        .expect("sulla lavagna");
        let cards = nodes(&ws, BOARD);
        assert_eq!(cards.len(), 7);
        let added = cards.last().unwrap();
        assert_eq!(added["text"], "Prima.");
        assert!(
            added["x"].as_i64().unwrap() >= 1000,
            "a destra di ciò che c'è: {added}"
        );
        assert_eq!(source(&ws, "Diario.md"), "# Diario\n\nDopo.\n");
        undo(&mut ws).expect("si annulla");
        assert_eq!(source(&ws, BOARD), BOARD_TEXT);
        assert_eq!(source(&ws, "Diario.md"), "# Diario\n\nPrima.\n\nDopo.\n");
    }
}
