// Il comando sta dietro `xlsx` (scrive il foglio con `fub-format-xlsx`) e nel
// registro di `commands`: senza tutte e due non c'è un soggetto.
#![cfg(all(feature = "commands", feature = "xlsx"))]
//! «Trasforma in foglio» end-to-end, attraverso il kernel vero (E23): la
//! tabella di una nota diventa un `.xlsx` accanto a lei coi suoi valori, al
//! suo posto resta l'embed della parte di foglio, e un annullamento rimette
//! le cose com'erano — sui due file, o su nessuno.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::model::{Block, DocId, Inline};
use fub_abi::PluginError;
use fub_features::{CoreCommands, COMMANDS_ID, NOTE_TABLE_SHEET, VAULT_UNDO};
use fub_format_markdown::MarkdownProvider;
use fub_format_xlsx::XlsxProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::json;

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

    fn write(&self, path: &str, text: &str) {
        let at = self.root.join(path);
        std::fs::create_dir_all(at.parent().expect("cartella")).expect("cartella");
        std::fs::write(at, text).expect("scritto");
    }

    fn text(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).expect("letto")
    }

    fn exists(&self, path: &str) -> bool {
        self.root.join(path).exists()
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        registry
            .register(XlsxProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

const NOTE: &str = "Progetti/Conti.md";

/// Una tabella in mezzo a una nota, con un numero all'italiana, una
/// percentuale e una cella con la barra protetta.
const TABLE: &str = "| Voce | Importo | Quota |\n\
                     | --- | ---: | ---: |\n\
                     | Affitto | 1.240,50 € | 12,5% |\n\
                     | Luce \\| gas | 98 | 3% |";

fn note_text() -> String {
    format!("# Conti\n\nPrima.\n\n{TABLE}\n\nDopo.\n")
}

/// I valori come li legge il client: l'intestazione è testo, i numeri hanno
/// il loro aspetto, `\|` è una barra.
fn cells() -> String {
    json!([
        ["Voce", "Importo", "Quota"],
        [
            "Affitto",
            { "number": 1240.5, "decimals": 2, "grouped": true, "currency": "€", "currency_after": true, "currency_spaced": true },
            { "number": 0.125, "decimals": 1, "percent": true }
        ],
        ["Luce | gas", { "number": 98.0 }, { "number": 0.03, "percent": true }]
    ])
    .to_string()
}

fn args(source: &str) -> serde_json::Value {
    let start = source.find(TABLE).expect("la tabella c'è");
    json!({
        "doc": NOTE,
        "at": [start, start + TABLE.len()],
        "text": TABLE,
        "cells": cells(),
    })
}

fn turn(ws: &mut Workspace, args: serde_json::Value) -> Result<String, PluginError> {
    let outcome = ws.invoke_command(NOTE_TABLE_SHEET, args, InvokeMode::Apply, Actor::User)?;
    Ok(outcome
        .notify
        .and_then(|t| t.as_literal().map(str::to_owned))
        .unwrap_or_default())
}

fn undo(ws: &mut Workspace) -> Result<String, PluginError> {
    let outcome = ws.invoke_command(
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )?;
    Ok(outcome
        .notify
        .and_then(|t| t.as_literal().map(str::to_owned))
        .unwrap_or_default())
}

/// La frase di un errore: tradotta se l'host l'ha già resa, sennò la chiave.
fn words(text: &fub_abi::text::Text) -> String {
    text.as_literal()
        .map(str::to_owned)
        .or_else(|| text.as_message().map(|m| m.key.clone()))
        .unwrap_or_default()
}

/// Le celle del foglio come le mostra: il modello del provider dei fogli.
fn shown(ws: &Workspace, sheet: &str) -> Vec<Vec<String>> {
    let model = ws
        .read_model(&DocId::new(sheet))
        .expect("il foglio si legge");
    let rows = model
        .body
        .iter()
        .find_map(|block| match block {
            Block::Table { rows, .. } => Some(rows.clone()),
            _ => None,
        })
        .expect("l'anteprima del foglio è una tabella");
    rows.iter()
        .map(|row| {
            row.cells
                .iter()
                .map(|cell| {
                    cell.inlines
                        .iter()
                        .map(|inline| match inline {
                            Inline::Text(text) => text.as_str(),
                            _ => "",
                        })
                        .collect()
                })
                .collect()
        })
        .collect()
}

#[test]
fn the_table_becomes_a_sheet_and_undo_puts_back_both_files() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();

    let done = turn(&mut ws, args(&note_text())).expect("trasformata");
    assert!(done.contains("Progetti/Conti.xlsx"), "{done}");

    // Il foglio accanto alla nota, coi valori e il loro aspetto.
    assert!(vault.exists("Progetti/Conti.xlsx"));
    assert_eq!(
        shown(&ws, "Progetti/Conti.xlsx"),
        vec![
            vec!["Voce", "Importo", "Quota"],
            vec!["Affitto", "1,240.50 €", "12.5%"],
            vec!["Luce | gas", "98", "3%"],
        ]
    );
    // Al posto della tabella, l'embed della parte di foglio.
    let note = vault.text(NOTE);
    assert!(!note.contains("| Voce |"), "{note}");
    let embed = note
        .lines()
        .find(|line| line.starts_with("![["))
        .expect("l'embed c'è");
    assert!(
        embed == "![[Conti.xlsx#Foglio1!A1:C3]]"
            || embed == "![[Progetti/Conti.xlsx#Foglio1!A1:C3]]",
        "{embed}"
    );
    assert!(note.starts_with("# Conti\n\nPrima.\n\n") && note.ends_with("\n\nDopo.\n"));

    // L'annullamento: la nota com'era, il foglio nel cestino.
    undo(&mut ws).expect("annullato");
    assert_eq!(vault.text(NOTE), note_text());
    assert!(!vault.exists("Progetti/Conti.xlsx"));
}

#[test]
fn a_name_already_taken_gets_a_free_one() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    vault.write(
        "Progetti/Conti.xlsx",
        "non un foglio, ma un file che c'è già",
    );
    let mut ws = vault.open();

    let done = turn(&mut ws, args(&note_text())).expect("trasformata");
    assert!(done.contains("Progetti/Conti 1.xlsx"), "{done}");
    assert_eq!(
        vault.text("Progetti/Conti.xlsx"),
        "non un foglio, ma un file che c'è già",
        "il file che c'era non si tocca"
    );
    assert!(vault.text(NOTE).contains("Conti 1.xlsx#Foglio1!A1:C3]]"));
}

#[test]
fn undo_after_the_sheet_changed_touches_nothing_and_says_so() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    turn(&mut ws, args(&note_text())).expect("trasformata");
    let note = vault.text(NOTE);

    // Qualcuno scrive nel foglio dopo la trasformazione.
    let sheet = vault.root.join("Progetti/Conti.xlsx");
    let mut bytes = std::fs::read(&sheet).expect("letto");
    bytes.extend_from_slice(b"cambiato");
    std::fs::write(&sheet, &bytes).expect("scritto");
    ws.reindex().expect("reindex");

    let error = undo(&mut ws).expect_err("l'annullamento si ferma");
    let PluginError::Conflict(text) = &error else {
        panic!("un conflitto, non {error:?}");
    };
    let said = words(text);
    assert!(
        said.contains("è cambiato dopo la trasformazione") || said.ends_with("undo_sheet_changed"),
        "{said}"
    );
    // Niente si è mosso: la nota ha ancora l'embed, il foglio è dov'era.
    assert_eq!(vault.text(NOTE), note);
    assert_eq!(std::fs::read(&sheet).expect("letto"), bytes);
}

#[test]
fn undo_finds_the_embed_after_the_note_changed_elsewhere() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    turn(&mut ws, args(&note_text())).expect("trasformata");

    // Una riga nuova in fondo alla nota, dopo la trasformazione.
    let changed = format!("{}Ancora.\n", vault.text(NOTE));
    vault.write(NOTE, &changed);
    ws.reindex().expect("reindex");

    undo(&mut ws).expect("annullato");
    assert_eq!(vault.text(NOTE), format!("{}Ancora.\n", note_text()));
    assert!(!vault.exists("Progetti/Conti.xlsx"));
}

#[test]
fn a_changed_table_writes_nothing() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    let mut stale = args(&note_text());
    stale["text"] = json!(TABLE.replace("Affitto", "Mutuo"));

    let error = turn(&mut ws, stale).expect_err("la tabella è cambiata");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(vault.text(NOTE), note_text());
    assert!(!vault.exists("Progetti/Conti.xlsx"));
}

#[test]
fn bytes_that_are_not_a_table_are_refused() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    let source = note_text();
    let start = source.find("Prima.").expect("c'è");
    let error = turn(
        &mut ws,
        json!({
            "doc": NOTE,
            "at": [start, start + "Prima.".len()],
            "text": "Prima.",
            "cells": cells(),
        }),
    )
    .expect_err("non è una tabella");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert!(!vault.exists("Progetti/Conti.xlsx"));
}

#[test]
fn from_the_palette_it_says_where_to_start() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    let error = turn(&mut ws, json!({ "doc": NOTE })).expect_err("senza tabella");
    let PluginError::BadArgs(text) = &error else {
        panic!("{error:?}");
    };
    let said = words(text);
    assert!(
        said.contains("parte da una tabella") || said.ends_with("no_cells"),
        "{said}"
    );
}

#[test]
fn the_dry_run_names_both_files_and_writes_nothing() {
    let vault = Vault::new();
    vault.write(NOTE, &note_text());
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            NOTE_TABLE_SHEET,
            args(&note_text()),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simulata");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano");
    };
    let docs: Vec<&str> = plan.docs.iter().map(DocId::as_str).collect();
    assert_eq!(docs, vec!["Progetti/Conti.xlsx", NOTE]);
    assert_eq!(vault.text(NOTE), note_text());
    assert!(!vault.exists("Progetti/Conti.xlsx"));
}
