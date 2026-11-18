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
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate, CONFIRM_NS};
use fub_features::{CoreCommands, COMMANDS_ID, TRASH_ID, TRASH_VIEW};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, ViewStates, Workspace};
use std::sync::Arc;

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
        self.open_on(ViewStates::in_memory())
    }

    /// Come lo monta l'app a un avvio: lo stato di vista è quello della
    /// macchina, che un avvio dopo rilegge dallo stesso file.
    fn open_on(&self, states: Arc<ViewStates>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry)
            .expect("l'apertura del vault riesce")
            .with_view_states(states);
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
        ws.register_view_provider(TRASH_ID, Box::new(fub_features::TrashView::default()))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn instance() -> ViewInstance {
    ViewInstance::only(TRASH_VIEW)
}

/// I titoli delle voci disegnate, in ordine.
fn entries(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        if let UiKind::ListItem { title, .. } = &node.kind {
            out.push(title.to_string());
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// Il testo di ogni nodo `Text` dell'albero, concatenato: serve a chiedere
/// *cosa dice* il pannello senza legarsi alla sua forma.
fn said(tree: &UiNode) -> String {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::EmptyState { title, .. } => out.push(title.to_string()),
            UiKind::Failed { message, .. } => out.push(message.to_string()),
            _ => {}
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out.join("\n")
}

/// L'azione del primo bottone con questa etichetta, o `None`.
///
/// Il parametro è `wanted` e non `label`: dentro il `match` sul `Button`
/// quella parola è il campo del nodo, e se le due condividono il nome il
/// confronto `label == label` è sempre vero e si prende il primo bottone
/// dell'albero qualunque etichetta si chieda.
fn button(tree: &UiNode, label: &str) -> Option<ActionRef> {
    fn walk(node: &UiNode, wanted: &str, out: &mut Option<ActionRef>) {
        if out.is_some() {
            return;
        }
        if let UiKind::Button { label, action, .. } = &node.kind {
            if label == wanted {
                *out = Some(action.clone());
                return;
            }
        }
        for child in node.children() {
            walk(child, wanted, out);
        }
    }
    let mut out = None;
    walk(tree, label, &mut out);
    out
}

/// L'azione di ripristino della prima voce: quella che porta i due id nel
/// payload.
fn restores(tree: &UiNode) -> ActionRef {
    button(tree, "Ripristina").expect("la voce ha il suo bottone")
}

#[test]
fn the_panel_lists_the_trash_and_the_says_when_and_empty() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();

    let tree = ws.render_view(&instance()).unwrap();
    assert!(
        said(&tree).contains("vuoto"),
        "un cestino vuoto si dice, non si mostra come una lista senza righe: {}",
        said(&tree)
    );

    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");
    let tree = ws.render_view(&instance()).unwrap();
    assert_eq!(entries(&tree), vec!["Uno".to_string()]);
}

/// Il nome di una voce è quello della pagina, qualunque estensione abbia il
/// file: non soltanto `.md`.
#[test]
fn an_entry_is_named_without_its_extension_whatever_it_is() {
    let vault = Vault::new();
    vault.put("Due.markdown", "secondo\n");
    let mut ws = vault.open();

    ws.delete_document(&fub_abi::model::DocId::new("Due.markdown"))
        .expect("cestinata");
    let tree = ws.render_view(&instance()).unwrap();
    assert_eq!(entries(&tree), vec!["Due".to_string()]);
}

#[test]
fn restore_passes_from_the_record_of_the_commands_and_brings_back_the_notes_in_the_vault() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();
    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");

    let tree = ws.render_view(&instance()).unwrap();
    let update = ws
        .view_action(
            &instance(),
            UiAction::new(restores(&tree).action.0).with_payload(restores(&tree).payload),
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
fn a_new_occupied_path_becomes_a_question_in_the_tree_not_a_window() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    let mut ws = vault.open();
    ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
        .expect("cestinata");
    // Qualcuno ricrea una nota con lo stesso nome: il path d'origine è occupato.
    vault.put("Uno.md", "un'altra cosa\n");
    ws.reindex().expect("reindex");

    let tree = ws.render_view(&instance()).unwrap();
    let action = restores(&tree);
    let update = ws
        .view_action(
            &instance(),
            UiAction::new(action.action.0).with_payload(action.payload),
        )
        .expect("la domanda non è un errore");

    let ViewUpdate::Replace { root } = update else {
        panic!("una domanda si disegna: {update:?}");
    };
    assert!(
        said(&root).contains("esiste di nuovo"),
        "la domanda è nell'albero: {}",
        said(&root)
    );
    // E il nome proposto è nel campo, modificabile: proporre non è decidere.
    let proposed = field(&root).expect("il campo con il nome proposto");
    // `free_name` propone il primo candidato libero: con «Uno.md» occupato è
    // «Uno 1.md», e il test allinea la sua attesa a quella produzione.
    assert_eq!(proposed, "Uno 1.md", "il nome proposto è libero");
    assert!(vault.root.join("Uno.md").exists(), "niente è stato scritto");

    // Si risponde, e la nota torna col nome scelto.
    let update = ws
        .view_action(
            &instance(),
            UiAction::new("restore_as").with_fields(vec![fub_abi::ui::FieldValue {
                field: "name".into(),
                value: fub_abi::ui::UiValue::Text(proposed.clone()),
            }]),
        )
        .expect("ripristino con nome");
    assert!(
        matches!(&update, ViewUpdate::Navigate { doc_id } if *doc_id == proposed),
        "{update:?}"
    );
    assert!(
        vault.root.join(&proposed).exists(),
        "la nota è tornata come {proposed}"
    );
    assert!(
        vault.root.join("Uno.md").exists(),
        "e quella che c'era non è stata toccata"
    );
}

/// Il valore del primo `TextInput` dell'albero.
fn field(tree: &UiNode) -> Option<String> {
    fn walk(node: &UiNode, out: &mut Option<String>) {
        if out.is_some() {
            return;
        }
        if let UiKind::TextInput { value, .. } = &node.kind {
            *out = Some(value.clone());
            return;
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = None;
    walk(tree, &mut out);
    out
}

#[test]
fn empty_asks_first_and_the_question_is_can_withdraw() {
    let vault = Vault::new();
    vault.put("Uno.md", "primo\n");
    vault.put("Due.md", "secondo\n");
    let mut ws = vault.open();
    for id in ["Uno.md", "Due.md"] {
        ws.delete_document(&fub_abi::model::DocId::new(id))
            .expect("cestinata");
    }

    let tree = ws.render_view(&instance()).unwrap();
    let empties = button(&tree, "Svuota il cestino").expect("il bottone c'è");
    let update = ws
        .view_action(&instance(), UiAction::new(empties.action.0))
        .expect("la domanda");
    let ViewUpdate::Replace { root } = update else {
        panic!("svuotare chiede: {update:?}")
    };
    assert!(
        said(&root).contains("2"),
        "la domanda dice quante voci sta per distruggere: {}",
        said(&root)
    );
    assert_eq!(ws.list_trash().unwrap().len(), 2, "chiedere non distrugge");

    // Rinunciare rimette il pannello com'era, e lo stato di vista si pulisce.
    let cancels = button(&root, "Annulla").expect("si può rinunciare");
    ws.view_action(&instance(), UiAction::new(cancels.action.0))
        .expect("rinuncia");
    let tree = ws.render_view(&instance()).unwrap();
    assert!(
        !said(&tree).contains("Distruggo"),
        "la domanda ritirata non torna a galla al ridisegno: {}",
        said(&tree)
    );
    assert_eq!(ws.list_trash().unwrap().len(), 2);

    // E confermando sparisce davvero.
    let empties = button(&tree, "Svuota il cestino").expect("il bottone c'è");
    ws.view_action(&instance(), UiAction::new(empties.action.0))
        .expect("la domanda");
    let tree = ws.render_view(&instance()).unwrap();
    let confirmation = button(&tree, "Svuota il cestino").expect("la conferma");
    ws.view_action(&instance(), UiAction::new(confirmation.action.0))
        .expect("svuotato");
    assert!(ws.list_trash().unwrap().is_empty());
}

/// Il nodo [`CONFIRM_NS`] della domanda, se l'albero ne ha uno.
fn confirmation(tree: &UiNode) -> Option<&UiNode> {
    if matches!(&tree.kind, UiKind::Custom { ns, .. } if ns == CONFIRM_NS) {
        return Some(tree);
    }
    tree.children().into_iter().find_map(confirmation)
}

/// La chiave del primo bottone con questa etichetta.
fn key_of(tree: &UiNode, wanted: &str) -> Option<String> {
    if let UiKind::Button { label, .. } = &tree.kind {
        if label == wanted {
            return tree.key.clone();
        }
    }
    tree.children()
        .into_iter()
        .find_map(|child| key_of(child, wanted))
}

/// L'azione che la shell manda per Esc: il `cancel` del payload della domanda.
fn escape_of(node: &UiNode) -> ActionRef {
    let UiKind::Custom { payload, .. } = &node.kind else {
        panic!("non è una domanda: {node:?}")
    };
    serde_json::from_value(payload["cancel"].clone()).expect("il no per Esc")
}

fn trash_two(vault: &Vault, ws: &mut Workspace) {
    vault.put("Uno.md", "primo\n");
    vault.put("Due.md", "secondo\n");
    ws.reindex().expect("reindex");
    for id in ["Uno.md", "Due.md"] {
        ws.delete_document(&fub_abi::model::DocId::new(id))
            .expect("cestinata");
    }
}

/// **Esc dice no a «Svuoto davvero?»** (IMP-110): la domanda è un nodo
/// `CONFIRM_NS` con la chiave del bottone che l'ha aperta, e l'azione che
/// dichiara per Esc è quella di «Annulla», che la chiude senza distruggere.
#[test]
fn escape_withdraws_the_empty_question() {
    let vault = Vault::new();
    let mut ws = vault.open();
    trash_two(&vault, &mut ws);

    let tree = ws.render_view(&instance()).unwrap();
    let opener = key_of(&tree, "Svuota il cestino").expect("il bottone ha una chiave");
    let empties = button(&tree, "Svuota il cestino").unwrap();
    let ViewUpdate::Replace { root } = ws
        .view_action(&instance(), UiAction::new(empties.action.0))
        .expect("la domanda")
    else {
        panic!("svuotare chiede")
    };
    let node = confirmation(&root).expect("la domanda è un nodo di conferma");
    assert_eq!(node.key.as_deref(), Some(opener.as_str()));
    assert!(said(node).contains("Distruggo"), "{}", said(node));
    let escape = escape_of(node);
    assert_eq!(Some(escape.clone()), button(node, "Annulla"));
    assert!(
        key_of(&root, "Svuota il cestino") != Some(opener.clone()),
        "la domanda sta al posto del bottone, non accanto"
    );

    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(escape.action.0).with_payload(escape.payload),
        )
        .expect("Esc")
    else {
        panic!("il pannello si ridisegna")
    };
    assert!(confirmation(&root).is_none());
    assert_eq!(key_of(&root, "Svuota il cestino"), Some(opener));
    assert_eq!(ws.list_trash().unwrap().len(), 2, "Esc non distrugge");
}

/// **«Svuoto davvero?» non sopravvive al riavvio** (IMP-110).
///
/// La domanda stava nello stato di vista, che dura fra un avvio e l'altro: al
/// riavvio il cestino si riapriva con il sì pronto, e il primo «Svuota il
/// cestino» premuto distruggeva tutto senza più chiedere.
#[test]
fn the_empty_question_does_not_survive_a_restart() {
    let vault = Vault::new();
    let config = tempfile::tempdir().expect("tempdir");
    let file = Utf8PathBuf::from_path_buf(config.path().join("view-states.json")).expect("utf8");
    {
        let (states, warning) = ViewStates::open(&file);
        assert!(warning.is_none());
        let mut ws = vault.open_on(states);
        trash_two(&vault, &mut ws);
        let tree = ws.render_view(&instance()).unwrap();
        let empties = button(&tree, "Svuota il cestino").unwrap();
        ws.view_action(&instance(), UiAction::new(empties.action.0))
            .expect("la domanda");
        // La domanda è aperta, e si chiude l'app senza rispondere.
    }
    let saved = std::fs::read_to_string(&file).unwrap_or_default();
    assert!(
        !saved.contains("\"ask\""),
        "la domanda non è sul disco: {saved}"
    );

    let (states, _) = ViewStates::open(&file);
    let mut ws = vault.open_on(states);
    let tree = ws.render_view(&instance()).unwrap();
    assert!(confirmation(&tree).is_none(), "{}", said(&tree));
    assert!(!said(&tree).contains("Distruggo"), "{}", said(&tree));
    // Il primo «Svuota il cestino» chiede di nuovo, non distrugge.
    let empties = button(&tree, "Svuota il cestino").expect("il bottone c'è");
    ws.view_action(&instance(), UiAction::new(empties.action.0))
        .expect("la domanda");
    assert_eq!(ws.list_trash().unwrap().len(), 2, "riaprire non distrugge");
}

/// Anche la domanda del nome resta in memoria: al riavvio la voce torna col
/// suo «Ripristina», e la domanda chiusa rende il fuoco a quel bottone.
#[test]
fn the_name_question_does_not_survive_a_restart() {
    let vault = Vault::new();
    let config = tempfile::tempdir().expect("tempdir");
    let file = Utf8PathBuf::from_path_buf(config.path().join("view-states.json")).expect("utf8");
    {
        let (states, _) = ViewStates::open(&file);
        let mut ws = vault.open_on(states);
        vault.put("Uno.md", "primo\n");
        ws.reindex().expect("reindex");
        ws.delete_document(&fub_abi::model::DocId::new("Uno.md"))
            .expect("cestinata");
        vault.put("Uno.md", "un'altra cosa\n");
        ws.reindex().expect("reindex");
        let tree = ws.render_view(&instance()).unwrap();
        let opener = key_of(&tree, "Ripristina").expect("il bottone ha una chiave");
        let action = restores(&tree);
        let ViewUpdate::Replace { root } = ws
            .view_action(
                &instance(),
                UiAction::new(action.action.0).with_payload(action.payload),
            )
            .expect("la domanda")
        else {
            panic!("la domanda si disegna")
        };
        let node = confirmation(&root).expect("la domanda del nome è un nodo di conferma");
        assert_eq!(node.key.as_deref(), Some(opener.as_str()));
        assert_eq!(Some(escape_of(node)), button(node, "Annulla"));
    }
    let saved = std::fs::read_to_string(&file).unwrap_or_default();
    assert!(!saved.contains("\"ask\""), "{saved}");

    let (states, _) = ViewStates::open(&file);
    let ws = vault.open_on(states);
    let tree = ws.render_view(&instance()).unwrap();
    assert!(confirmation(&tree).is_none(), "{}", said(&tree));
    assert!(field(&tree).is_none(), "nessun campo del nome al riavvio");
    assert!(button(&tree, "Ripristina").is_some());
}

/// Una domanda che le versioni di prima hanno lasciato nello stato di vista
/// non si disegna, e al primo gesto sul pannello se ne va dal disco.
#[test]
fn a_question_left_by_an_older_version_is_ignored_and_removed() {
    let vault = Vault::new();
    let mut ws = vault.open();
    trash_two(&vault, &mut ws);
    ws.set_view_state(
        TRASH_ID,
        TRASH_VIEW,
        "ask",
        Some(serde_json::json!({ "kind": "empty" })),
    )
    .unwrap();

    let tree = ws.render_view(&instance()).unwrap();
    assert!(!said(&tree).contains("Distruggo"), "{}", said(&tree));
    assert!(confirmation(&tree).is_none());
    // Un sì arrivato senza una domanda in corso non svuota niente.
    ws.view_action(&instance(), UiAction::new("empty_confirm"))
        .expect("ignorato");
    assert_eq!(ws.list_trash().unwrap().len(), 2);
    assert_eq!(ws.view_state(TRASH_ID, TRASH_VIEW, "ask"), None);
}

/// Il presidio che sostituisce l'import fra due moduli di feature.
///
/// `trash.rs` scrive `"trash.restore"` e `"trash.empty"` come stringhe, perché
/// un id di comando è un nome del registro e non un item Rust — è ciò che
/// scriverebbe un plugin di terzi. Il costo di quella scelta è che il
/// compilatore non tiene più i due allineati: lo tiene questo test, che li cerca
/// dove il pannello li andrà a premere.
#[test]
fn the_two_commands_that_the_panel_presses_are_in_the_record() {
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
