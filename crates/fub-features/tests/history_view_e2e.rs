// Il banco di questa feature vive con lei: senza la cargo feature `versioning`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "versioning")]
//! Il pannello **cronologia** end-to-end, montato come lo monta l'app: handler,
//! view e comando dello stesso plugin, registrati insieme.
//!
//! Prova le tre cose che la migrazione del §1.2 ha deciso per questa metà:
//!
//! 1. la view legge le versioni dal **proprio spazio dati** — non da uno store
//!    condiviso che l'host le presta, e non da un canale nuovo del contratto:
//!    qui l'esemplare in memoria dello store non le viene dato affatto, e il
//!    pannello elenca lo stesso;
//! 2. ripristinare passa da `version.restore`, che è un comando del **registro**
//!    e non una scrittura privata della view;
//! 3. un ripristino è annullabile, perché è a sua volta una scrittura — e quindi
//!    una versione (D8).

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::session::ViewContext;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::versioning::{HistoryView, VersioningCommands, HISTORY_VIEW, VERSION_RESTORE};
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace, MAIN_PANE};

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
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(VERSIONING_ID, VERSIONING_ID)
                .speaking("it", fub_features::versioning::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        let store = ws
            .with_host(VERSIONING_ID, VersionStore::open)
            .expect("store versioni");
        ws.register_event_handler(VERSIONING_ID, Box::new(VersioningHandler::new(store)))
            .expect("handler registrato");
        // …e lo store **finisce qui**: la view e il comando qui sotto non lo
        // ricevono. È la proprietà che questo banco esiste per provare — chi
        // disegna rilegge dal proprio spazio dati, e non ha bisogno che qualcuno
        // gli presti l'esemplare in memoria di chi scrive.
        ws.register_view_provider(VERSIONING_ID, Box::new(HistoryView))
            .expect("view registrata");
        ws.register_command_provider(VERSIONING_ID, Box::new(VersioningCommands))
            .expect("comando registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn istanza() -> ViewInstance {
    ViewInstance::only(HISTORY_VIEW)
}

/// Le voci disegnate: `(quando, quanto)`.
fn voci(tree: &UiNode) -> Vec<(String, Option<String>)> {
    fn walk(node: &UiNode, out: &mut Vec<(String, Option<String>)>) {
        if let UiKind::ListItem {
            title, subtitle, ..
        } = &node.kind
        {
            out.push((title.to_string(), subtitle.as_ref().map(|s| s.to_string())));
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// L'azione del primo bottone «Ripristina», o `None`.
fn ripristina(tree: &UiNode) -> Option<ActionRef> {
    fn walk(node: &UiNode, out: &mut Option<ActionRef>) {
        if out.is_some() {
            return;
        }
        if let UiKind::Button { label, action, .. } = &node.kind {
            if label == "Ripristina" {
                *out = Some(action.clone());
                return;
            }
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = None;
    walk(tree, &mut out);
    out
}

/// Ogni testo dell'albero, per chiedere *cosa dice* senza legarsi alla forma.
fn detto(tree: &UiNode) -> String {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::EmptyState { title, .. } => out.push(title.to_string()),
            UiKind::Section { title, .. } => out.push(title.to_string()),
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

fn guarda(ws: &mut Workspace, id: &str) {
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new(id))),
    ));
}

#[test]
fn la_view_elenca_le_versioni_senza_ricevere_lo_store() {
    let vault = Vault::new();
    let mut ws = vault.open();

    // Nessuna nota aperta: è uno stato, non un errore.
    assert!(detto(&ws.render_view(&istanza()).unwrap()).contains("Nessuna nota"));

    ws.write_document(&DocId::new("Uno.md"), "primo\n")
        .expect("creata");
    guarda(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "secondo\n")
        .expect("riscritta");

    let tree = ws.render_view(&istanza()).unwrap();
    let voci = voci(&tree);
    assert!(
        voci.len() >= 2,
        "due scritture, almeno due versioni: {voci:?}"
    );
    // La più recente porta «adesso» invece della dimensione: ripristinarla è
    // riscrivere il file con ciò che c'è già.
    assert_eq!(voci[0].1.as_deref(), Some("adesso"));
}

#[test]
fn lanteprima_si_ricorda_fra_due_ridisegni() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n")
        .expect("creata");
    guarda(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n")
        .expect("riscritta");

    let tree = ws.render_view(&istanza()).unwrap();
    // La più vecchia: è quella che vale la pena guardare.
    let ts = ultimo_ts(&tree);
    let update = ws
        .view_action(
            &istanza(),
            UiAction::new("preview").with_payload(serde_json::json!({ "ts": ts })),
        )
        .expect("anteprima");
    let ViewUpdate::Replace { root } = update else {
        panic!("l'anteprima si disegna")
    };
    assert!(detto(&root).contains("com'era"), "{}", detto(&root));

    // E sopravvive al ridisegno, che è la ragione per cui sta nello stato di
    // vista e non nell'albero: chi la sta leggendo salva, e il pannello si
    // ridisegna sotto.
    let tree = ws.render_view(&istanza()).unwrap();
    assert!(detto(&tree).contains("com'era"));

    ws.view_action(&istanza(), UiAction::new("close_preview"))
        .expect("chiusa");
    let tree = ws.render_view(&istanza()).unwrap();
    assert!(!detto(&tree).contains("com'era"));
}

/// L'istante della versione più vecchia disegnata.
fn ultimo_ts(tree: &UiNode) -> u64 {
    fn walk(node: &UiNode, out: &mut Vec<u64>) {
        if let UiKind::ListItem {
            action: Some(a), ..
        } = &node.kind
        {
            if let Some(ts) = a.payload.get("ts").and_then(|v| v.as_u64()) {
                out.push(ts);
            }
        }
        for figlio in node.children() {
            walk(figlio, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    *out.last().expect("almeno una versione")
}

#[test]
fn ripristinare_passa_dal_registro_e_si_annulla() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n")
        .expect("creata");
    guarda(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n")
        .expect("riscritta");

    // Il comando è nel registro, cioè: la palette lo vede, una macro lo può
    // chiamare, e questo test lo trova senza conoscere il provider.
    assert!(
        ws.commands().iter().any(|c| c.id == VERSION_RESTORE),
        "`{VERSION_RESTORE}` non è nel registro"
    );

    let tree = ws.render_view(&istanza()).unwrap();
    let ts = ultimo_ts(&tree);
    let azione = ripristina(&tree).expect("il bottone c'è");
    ws.view_action(
        &istanza(),
        UiAction::new(azione.action.0).with_payload(serde_json::json!({ "ts": ts })),
    )
    .expect("ripristino");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'era\n"
    );
}

/// L'inverso di un ripristino è un altro ripristino — e lo dichiara il comando.
///
/// Il vault è **nuovo** e nessuno ha ancora ripristinato niente: rifare il giro
/// nel test qui sopra proverebbe un'altra cosa, perché dopo un ripristino il
/// contenuto a cui si tornerebbe è quello che il ripristino stesso ha appena
/// scritto.
#[test]
fn linverso_di_un_ripristino_e_dichiarato_dal_comando() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n")
        .expect("creata");
    guarda(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n")
        .expect("riscritta");
    let ts = ultimo_ts(&ws.render_view(&istanza()).unwrap());

    let esito = ws
        .invoke_command(
            VERSION_RESTORE,
            serde_json::json!({ "doc": "Uno.md", "ts": ts }),
            fub_abi::command::InvokeMode::Apply,
            fub_abi::event::Actor::User,
        )
        .expect("ripristino");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'era\n"
    );

    // Si invoca **quello che il comando ha dichiarato**, non uno ricostruito
    // qui: è la promessa che si vuole provare.
    let undo = esito
        .undo
        .expect("il ripristino dichiara come si torna indietro");
    let [fub_abi::command::UndoStep::Command { command, args }] = &undo.steps[..] else {
        panic!(
            "l'inverso di un ripristino è un comando solo: {:?}",
            undo.steps
        )
    };
    ws.invoke_command(
        command,
        args.clone(),
        fub_abi::command::InvokeMode::Apply,
        fub_abi::event::Actor::User,
    )
    .expect("annullato");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'è\n"
    );
}
