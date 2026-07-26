//! I comandi ufficiali end-to-end **attraverso il kernel vero**.
//!
//! Gli unit test di `commands.rs` provano il comando contro il contratto (un
//! host in memoria). Qui si prova ciò che solo il kernel può dire: che
//! l'invocazione passa dalla convalida dell'host, che una simulazione non tocca
//! il disco, e che la scrittura di un comando è una **scrittura normale** — cioè
//! che grafo, indici ed eventi la vedono per la via di sempre. Un comando che
//! scrivesse per una via privilegiata non aggiornerebbe il grafo, e il backlink
//! che questo test controlla non esisterebbe.

use camino::Utf8PathBuf;
use fubmd_abi::command::{CommandEffect, InvokeMode};
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::session::{Selection, ViewContext};
use fubmd_abi::PluginError;
use fubmd_features::{CoreCommands, COMMANDS_ID, SELECTION_WIKILINK, VAULT_REPLACE};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace, MAIN_PANE};

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
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands));
        ws.reindex().expect("reindex");
        ws
    }
}

#[test]
fn a_bulk_replace_is_shown_before_it_is_done_and_then_done() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme, il gatto mangia")
        .expect("scrive");
    ws.write_document(&DocId::new("b.md"), "nessun felino qui")
        .expect("scrive");

    let args = serde_json::json!({ "find": "gatto", "replace": "cane" });

    let outcome = ws
        .invoke_command(VAULT_REPLACE, args.clone(), InvokeMode::DryRun)
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un dry-run risponde con un piano")
    };
    assert_eq!(plan.docs, vec![DocId::new("a.md")]);
    assert_eq!(plan.edit_count(), 2);
    assert_eq!(
        ws.read_source(&DocId::new("a.md")).expect("legge"),
        "il gatto dorme, il gatto mangia",
        "il piano si guarda, non si subisce"
    );

    let outcome = ws
        .invoke_command(VAULT_REPLACE, args, InvokeMode::Apply)
        .expect("applica");
    assert_eq!(
        ws.read_source(&DocId::new("a.md")).expect("legge"),
        "il cane dorme, il cane mangia"
    );
    let notify = outcome.notify.expect("un'operazione in blocco si racconta");
    assert!(notify.contains("2 sostituzioni"), "{notify}");
}

#[test]
fn a_command_writes_through_the_normal_path_so_the_graph_sees_it() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Kant.md"), "# Kant\n")
        .expect("scrive");
    let nota = DocId::new("Nota.md");
    ws.write_document(&nota, "parlo di Kant e di altro\n")
        .expect("scrive");
    assert!(
        ws.backlinks(&DocId::new("Kant.md")).is_empty(),
        "prima non c'è nessun riferimento"
    );

    // La shell pubblica il contesto: nota aperta, «Kant» selezionato, buffer
    // pulito (quindi lo span vale anche per il file).
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(nota.clone()))
            .with_selection(Some(Selection {
                span: Some(Span::new(9, 13)),
                text: "Kant".into(),
            })),
    ));

    let outcome = ws
        .invoke_command(
            SELECTION_WIKILINK,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
        .expect("applica");
    assert_eq!(
        ws.read_source(&nota).expect("legge"),
        "parlo di [[Kant]] e di altro\n"
    );
    assert!(
        matches!(outcome.effect, CommandEffect::Reveal { .. }),
        "la shell riceve dove guardare"
    );

    let backlinks = ws.backlinks(&DocId::new("Kant.md"));
    assert_eq!(
        backlinks.len(),
        1,
        "il riferimento creato dal comando è nel grafo: la scrittura di un \
         comando è una scrittura come le altre"
    );
    assert_eq!(backlinks[0].source, nota);
}

#[test]
fn the_selection_span_is_dropped_by_the_kernel_and_the_command_says_so() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let nota = DocId::new("Nota.md");
    ws.write_document(&nota, "parlo di Kant\n").expect("scrive");
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(nota.clone()))
            .with_selection(Some(Selection {
                span: Some(Span::new(9, 13)),
                text: "Kant".into(),
            })),
    ));

    // Qualcun altro riscrive la nota: il kernel lascia cadere lo span, perché
    // quelle coordinate erano di un altro testo (§1.9).
    ws.write_document(&nota, "un testo completamente diverso\n")
        .expect("scrive");

    let err = ws
        .invoke_command(
            SELECTION_WIKILINK,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
        .unwrap_err();
    assert!(
        matches!(err, PluginError::BadArgs(_)),
        "senza uno span vero il comando non indovina un punto in cui scrivere"
    );
    assert_eq!(
        ws.read_source(&nota).expect("legge"),
        "un testo completamente diverso\n"
    );
}

#[test]
fn the_search_command_is_an_intent_and_the_kernel_refuses_it_no_writes() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let outcome = ws
        .invoke_command(
            fubmd_features::SEARCH_OPEN,
            serde_json::json!({ "query": "gatto" }),
            InvokeMode::Apply,
        )
        .expect("cerca");
    assert_eq!(
        outcome.effect,
        CommandEffect::RunSearch {
            query: "gatto".into()
        },
        "un comando può chiedere alla shell di fare qualcosa senza toccare il vault"
    );
}

#[test]
fn the_registry_is_what_a_palette_or_a_cli_reads() {
    let vault = Vault::new();
    let ws = vault.open();
    let specs = ws.commands();
    assert_eq!(specs.len(), 3, "i tre comandi ufficiali");
    let replace = specs
        .iter()
        .find(|s| s.id == VAULT_REPLACE)
        .expect("dichiarato");
    assert!(replace.scope.writes);
    assert_eq!(
        replace
            .params
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>(),
        vec!["find", "replace", "whole_word", "docs"],
        "l'ordine dei parametri è quello in cui ha senso chiederli"
    );
}
