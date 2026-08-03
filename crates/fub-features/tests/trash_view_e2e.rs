// Il banco di questa feature vive con lei: senza la cargo feature `trash`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto. Serve anche `commands`, perché ciò che questo pannello prova è
// **che invoca comandi del registro**: senza quel bundle il soggetto c'è a metà.
#![cfg(all(feature = "trash", feature = "commands"))]
//! Il cestino end-to-end **attraverso il kernel vero**: vault su disco, note
//! vere cestinate davvero, comandi veri nel registro.
//!
//! Prova le tre cose che questa migrazione ha deciso (§1.2):
//!
//! 1. il pannello non ha capacità sue — elenca con `list_trash` e agisce con
//!    `run_command`, cioè con ciò che avrebbe un plugin di terzi;
//! 2. le due domande — *svuoto davvero?*, *il path è occupato: che nome le do?*
//!    — si fanno **con l'albero** e non con una finestra della shell, e vivono
//!    nello stato di vista dell'esemplare;
//! 3. i due id di comando che `trash.rs` scrive come stringhe sono davvero nel
//!    registro. È il presidio che sostituisce l'import fra moduli di feature.

use camino::Utf8PathBuf;
use fub_abi::traits::{CommandProvider, ViewInstance};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::{CoreCommands, COMMANDS_ID, TRASH_ID, TRASH_VIEW};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

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

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry);
        // I due bundle: chi disegna e chi possiede i comandi che disegna. È la
        // stessa coppia che monta l'app, e il pannello non sa niente dell'altro
        // se non i due id.
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(TRASH_ID, TRASH_ID)
                .speaking("it", fub_features::trash::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(TRASH_ID, Box::new(fub_features::TrashView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn istanza() -> ViewInstance {
    ViewInstance::only(TRASH_VIEW)
}

/// I titoli delle voci disegnate, in ordine.
fn voci(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        if let UiKind::ListItem { title, .. } = &node.kind {
            out.push(title.to_string());
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// Il testo di ogni nodo `Text` dell'albero, concatenato: serve a chiedere
/// *cosa dice* il pannello senza legarsi alla sua forma.
fn detto(tree: &UiNode) -> String {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::EmptyState { title, .. } => out.push(title.to_string()),
            UiKind::Failed { message, .. } => out.push(message.to_string()),
            _ => {}
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out.join("\n")
}

/// L'azione del primo bottone con questa etichetta, o `None`.
fn bottone(tree: &UiNode, etichetta: &str) -> Option<ActionRef> {
    fn walk(node: &UiNode, etichetta: &str, out: &mut Option<ActionRef>) {
        if out.is_some() {
            return;
        }
        if let UiKind::Button { label, action, .. } = &node.kind {
            if label == etichetta {
                *out = Some(action.clone());
                return;
            }
        }
        for figlio in node.children() {
            walk(figlio, etichetta, out);
        }
    }
    let mut out = None;
    walk(tree, etichetta, &mut out);
    out
}

/// L'azione di ripristino della prima voce: quella che porta i due id nel
/// payload.
fn ripristina(tree: &UiNode) -> ActionRef {
    bottone(tree, "Ripristina").expect("la voce ha il suo bottone")
}

#[test]
fn il_pannello_elenca_il_cestino_e_lo_dice_quando_e_vuoto() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();

    let tree = ws.render_view(&istanza()).unwrap();
    assert!(
        detto(&tree).contains("vuoto"),
        "un cestino vuoto si dice, non si mostra come una lista senza righe: {}",
        detto(&tree)
    );

    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");
    let tree = ws.render_view(&istanza()).unwrap();
    assert_eq!(voci(&tree), vec!["Uno".to_string()]);
}

#[test]
fn ripristinare_passa_dal_registro_dei_comandi_e_riporta_la_nota_nel_vault() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();
    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");

    let tree = ws.render_view(&istanza()).unwrap();
    let update = ws
        .view_action(
            &istanza(),
            UiAction::new(ripristina(&tree).action.0).with_payload(ripristina(&tree).payload),
        )
        .expect("ripristino");

    // Ripristinare **naviga**: la nota torna e la si apre, che è ciò che faceva
    // il pannello nativo e che qui non costa una capacità in più.
    assert!(
        matches!(&update, ViewUpdate::Navigate { doc_id } if doc_id == "Uno.md"),
        "ripristinare apre la nota tornata: {update:?}"
    );
    assert!(vault.root.join("Uno.md").exists(), "la nota è tornata");
    assert!(
        ws.list_trash().unwrap().is_empty(),
        "il cestino si è svuotato"
    );
}

#[test]
fn un_path_di_nuovo_occupato_diventa_una_domanda_nellalbero_non_una_finestra() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();
    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");
    // Qualcuno ricrea una nota con lo stesso nome: il path d'origine è occupato.
    vault.put("Uno.md", "un'altra cosa\n");
    ws.reindex().expect("reindex");

    let tree = ws.render_view(&istanza()).unwrap();
    let azione = ripristina(&tree);
    let update = ws
        .view_action(
            &istanza(),
            UiAction::new(azione.action.0).with_payload(azione.payload),
        )
        .expect("la domanda non è un errore");

    let ViewUpdate::Replace { root } = update else {
        panic!("una domanda si disegna: {update:?}");
    };
    assert!(
        detto(&root).contains("esiste di nuovo"),
        "la domanda è nell'albero: {}",
        detto(&root)
    );
    // E il nome proposto è nel campo, modificabile: proporre non è decidere.
    let proposto = campo(&root).expect("il campo con il nome proposto");
    assert_ne!(proposto, "Uno.md", "il nome proposto è libero");
    assert!(vault.root.join("Uno.md").exists(), "niente è stato scritto");

    // Si risponde, e la nota torna col nome scelto.
    let update = ws
        .view_action(
            &istanza(),
            UiAction::new("restore_as").with_fields(vec![fub_abi::ui::FieldValue {
                field: "name".into(),
                value: fub_abi::ui::UiValue::Text(proposto.clone()),
            }]),
        )
        .expect("ripristino con nome");
    assert!(
        matches!(&update, ViewUpdate::Navigate { doc_id } if *doc_id == proposto),
        "{update:?}"
    );
    assert!(
        vault.root.join(&proposto).exists(),
        "la nota è tornata come {proposto}"
    );
    assert!(
        vault.root.join("Uno.md").exists(),
        "e quella che c'era non è stata toccata"
    );
}

/// Il valore del primo `TextInput` dell'albero.
fn campo(tree: &UiNode) -> Option<String> {
    fn walk(node: &UiNode, out: &mut Option<String>) {
        if out.is_some() {
            return;
        }
        if let UiKind::TextInput { value, .. } = &node.kind {
            *out = Some(value.clone());
            return;
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = None;
    walk(tree, &mut out);
    out
}

#[test]
fn svuotare_chiede_prima_e_la_domanda_si_puo_ritirare() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    vault.put("Due.md", "secondo\n");
    let mut ws = vault.open();
    for id in ["Uno.md", "Due.md"] {
        ws.delete_document(&fub_abi::model::DocId::new(id))
            .expect("cestinata");
    }

    let tree = ws.render_view(&istanza()).unwrap();
    let svuota = bottone(&tree, "Svuota il cestino").expect("il bottone c'è");
    let update = ws
        .view_action(&istanza(), UiAction::new(svuota.action.0))
        .expect("la domanda");
    let ViewUpdate::Replace { root } = update else {
        panic!("svuotare chiede: {update:?}")
    };
    assert!(
        detto(&root).contains("2"),
        "la domanda dice quante voci sta per distruggere: {}",
        detto(&root)
    );
    assert_eq!(ws.list_trash().unwrap().len(), 2, "chiedere non distrugge");

    // Rinunciare rimette il pannello com'era, e lo stato di vista si pulisce.
    let annulla = bottone(&root, "Annulla").expect("si può rinunciare");
    ws.view_action(&istanza(), UiAction::new(annulla.action.0))
        .expect("rinuncia");
    let tree = ws.render_view(&istanza()).unwrap();
    assert!(
        !detto(&tree).contains("Distruggo"),
        "la domanda ritirata non torna a galla al ridisegno: {}",
        detto(&tree)
    );
    assert_eq!(ws.list_trash().unwrap().len(), 2);

    // E confermando sparisce davvero.
    let svuota = bottone(&tree, "Svuota il cestino").expect("il bottone c'è");
    ws.view_action(&istanza(), UiAction::new(svuota.action.0))
        .expect("la domanda");
    let tree = ws.render_view(&istanza()).unwrap();
    let conferma = bottone(&tree, "Svuota il cestino").expect("la conferma");
    ws.view_action(&istanza(), UiAction::new(conferma.action.0))
        .expect("svuotato");
    assert!(ws.list_trash().unwrap().is_empty());
}

/// Il presidio che sostituisce l'import fra due moduli di feature.
///
/// `trash.rs` scrive `"trash.restore"` e `"trash.empty"` come stringhe, perché
/// un id di comando è un nome del registro e non un item Rust — è ciò che
/// scriverebbe un plugin di terzi. Il costo di quella scelta è che il
/// compilatore non tiene più i due allineati: lo tiene questo test, che li cerca
/// dove il pannello li andrà a premere.
#[test]
fn i_due_comandi_che_il_pannello_preme_sono_nel_registro() {
    let specs = CoreCommands.commands();
    for id in ["trash.restore", "trash.empty"] {
        assert!(
            specs.iter().any(|s| s.id == id),
            "il pannello cestino invoca «{id}», che nessuno dichiara più: o è \
             stato rinominato, e allora va rinominato anche in `trash.rs`, o è \
             sparito, e allora il bottone che lo preme non ha più senso"
        );
    }
}
