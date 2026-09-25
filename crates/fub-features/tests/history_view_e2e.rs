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

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::session::ViewContext;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_features::versioning::{HistoryView, VersioningCommands, HISTORY_VIEW, VERSION_RESTORE};
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Workspace, MAIN_PANE};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Barrier, OnceLock,
};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

struct RestoreRaceStorage {
    inner: FsStorage,
    gate: Arc<Barrier>,
    document_path: Utf8PathBuf,
    snapshot_path: OnceLock<Utf8PathBuf>,
    armed: AtomicBool,
    write_fault: AtomicBool,
}

impl VaultStorage for RestoreRaceStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        let is_snapshot = self
            .snapshot_path
            .get()
            .is_some_and(|snapshot| path == snapshot)
            && self.armed.swap(false, Ordering::AcqRel);
        if is_snapshot {
            self.gate.wait();
            self.gate.wait();
        }
        self.inner.read(path)
    }
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> std::io::Result<fub_kernel::storage::ConditionalWrite> {
        if path == self.document_path && self.write_fault.swap(false, Ordering::AcqRel) {
            return Err(std::io::Error::other("write_if_unchanged fault"));
        }
        self.inner.write_if_unchanged(path, expected, bytes)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }

    fn update(
        &self,
        path: &Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }

    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }

    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }

    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
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
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
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

    fn open_with_storage(&self, storage: Arc<dyn VaultStorage>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(&self.root, registry, storage, MachineSettings::in_memory())
            .expect("l'apertura del vault riesce");
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
        ws.register_view_provider(VERSIONING_ID, Box::new(HistoryView))
            .expect("view registrata");
        ws.register_command_provider(VERSIONING_ID, Box::new(VersioningCommands))
            .expect("comando registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn instance() -> ViewInstance {
    ViewInstance::only(HISTORY_VIEW)
}

/// Le voci disegnate: `(quando, quanto)`.
fn entries(tree: &UiNode) -> Vec<(String, Option<String>)> {
    fn walk(node: &UiNode, out: &mut Vec<(String, Option<String>)>) {
        if let UiKind::ListItem {
            title, subtitle, ..
        } = &node.kind
        {
            out.push((title.to_string(), subtitle.as_ref().map(|s| s.to_string())));
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// L'azione «Ripristina» della versione più vecchia disegnata — la sola che
/// ripristinata cambi qualcosa —, con l'albero da cui è stata presa.
///
/// Il bottone sta nell'anteprima della versione scelta, non su ogni riga:
/// qui si sceglie la riga come la sceglierebbe un click, e si prende il bottone
/// col payload che il pannello gli ha disegnato addosso. Le due metà restano
/// della stessa riga, e il banco misura un ripristino vero.
fn restores(ws: &mut Workspace) -> (UiNode, Option<ActionRef>) {
    let tree = ws.render_view(&instance()).expect("storia");
    let pick = last_action(&tree);
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(pick.action.0).with_payload(pick.payload),
        )
        .expect("anteprima")
    else {
        panic!("l'anteprima si disegna")
    };
    (tree, button(&root, "Ripristina"))
}

/// «Ripristina» chiede prima di scrivere: il click porta la domanda, e il sì
/// è il bottone che ripristina davvero. Torna il sì, col suo payload.
fn confirms(ws: &mut Workspace, restore: ActionRef) -> ActionRef {
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(restore.action.0).with_payload(restore.payload),
        )
        .expect("la domanda")
    else {
        panic!("la domanda si disegna")
    };
    assert!(
        said(&root).contains("Riportare la nota a questa versione?"),
        "{}",
        said(&root)
    );
    button(&root, "Sì, ripristina").expect("il sì c'è")
}

/// Ogni testo dell'albero, per chiedere *cosa dice* senza legarsi alla forma.
fn said(tree: &UiNode) -> String {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::EmptyState { title, .. } => out.push(title.to_string()),
            UiKind::Section { title, .. } => out.push(title.to_string()),
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

fn watches(ws: &mut Workspace, id: &str) {
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new(id))),
    ));
}

#[test]
fn the_view_lists_the_versions_without_receive_the_store() {
    let vault = Vault::new();
    let mut ws = vault.open();

    // Nessuna nota aperta: è uno stato, non un errore.
    assert!(said(&ws.render_view(&instance()).unwrap()).contains("Nessuna nota"));

    ws.write_document(&DocId::new("Uno.md"), "primo\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "secondo\n", WriteBase::Dictated)
        .expect("riscritta");

    let tree = ws.render_view(&instance()).unwrap();
    let entries = entries(&tree);
    assert!(
        entries.len() >= 2,
        "due scritture, almeno due versioni: {entries:?}"
    );
    // La più recente è la versione attuale: ripristinarla sarebbe riscrivere
    // il file con ciò che c'è già, e infatti la sua anteprima non lo offre.
    assert_eq!(entries[0].1.as_deref(), Some("Versione attuale"));
    let pick = {
        fn first(node: &UiNode) -> Option<ActionRef> {
            if let UiKind::ListItem {
                action: Some(a), ..
            } = &node.kind
            {
                return Some(a.clone());
            }
            node.children().into_iter().find_map(first)
        }
        first(&tree).expect("la versione attuale")
    };
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(pick.action.0).with_payload(pick.payload),
        )
        .expect("anteprima")
    else {
        panic!("l'anteprima si disegna")
    };
    assert!(button(&root, "Ripristina").is_none());
}

#[test]
fn preview_is_remembers_between_two_redraws() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    let tree = ws.render_view(&instance()).unwrap();
    // La più vecchia: è quella che vale la pena guardare. Il payload è **quello
    // disegnato**, non uno ricostruito qui: un banco che se lo scrive da sé
    // passerebbe verde anche se il pannello smettesse di metterci dentro ciò che
    // ci mette, e proverebbe metà di ciò che dichiara.
    let action = last_action(&tree);
    let update = ws
        .view_action(
            &instance(),
            UiAction::new(action.action.0).with_payload(action.payload),
        )
        .expect("anteprima");
    let ViewUpdate::Replace { root } = update else {
        panic!("l'anteprima si disegna")
    };
    assert!(said(&root).contains("com'era"), "{}", said(&root));

    // E sopravvive al ridisegno, che è la ragione per cui sta nello stato di
    // vista e non nell'albero: chi la sta leggendo salva, e il pannello si
    // ridisegna sotto.
    let tree = ws.render_view(&instance()).unwrap();
    assert!(said(&tree).contains("com'era"));

    ws.view_action(&instance(), UiAction::new("close_preview"))
        .expect("chiusa");
    let tree = ws.render_view(&instance()).unwrap();
    assert!(!said(&tree).contains("com'era"));
}

/// L'azione della versione più vecchia disegnata, **col payload che il pannello
/// le ha messo addosso**.
fn last_action(tree: &UiNode) -> ActionRef {
    fn walk(node: &UiNode, out: &mut Vec<ActionRef>) {
        if let UiKind::ListItem {
            action: Some(a), ..
        } = &node.kind
        {
            out.push(a.clone());
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out.pop().expect("almeno una versione")
}

/// L'istante della versione più vecchia disegnata.
fn last_ts(tree: &UiNode) -> u64 {
    last_action(tree)
        .payload
        .get("ts")
        .and_then(|v| v.as_u64())
        .expect("l'azione porta il suo istante")
}

#[test]
fn a_corrupt_snapshot_never_reaches_the_document_or_the_index() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'ora\n", WriteBase::Dictated)
        .expect("riscritta");
    let ts = last_ts(&ws.render_view(&instance()).unwrap());

    let store = vault.root.join(".fub").join("plugins").join(VERSIONING_ID);
    let index = store.join("versions.json");
    let index_before = std::fs::read(&index).expect("indice delle versioni");
    let snapshot = std::fs::read_dir(&store)
        .expect("spazio del versioning")
        .find_map(|entry| {
            let path =
                Utf8PathBuf::from_path_buf(entry.expect("voce dello store").path()).expect("utf8");
            let candidate = path.join(format!("{ts}.md"));
            candidate.is_file().then_some(candidate)
        })
        .expect("snapshot selezionato");

    let original = std::fs::read(&snapshot).expect("snapshot leggibile");
    assert_eq!(original, b"com'era\n");
    assert_eq!(original.len(), b"falsata\n".len());
    std::fs::write(&snapshot, b"falsata\n").expect("corruzione controllata");

    let error = ws
        .invoke_command(
            VERSION_RESTORE,
            serde_json::json!({ "doc": "Uno.md", "ts": ts }),
            fub_abi::command::InvokeMode::Apply,
            fub_abi::event::Actor::User,
        )
        .expect_err("uno snapshot corrotto deve essere rifiutato");
    assert!(
        matches!(&error, PluginError::Internal(_)),
        "il guasto dello snapshot è tipizzato: {error:?}"
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'ora\n",
        "il documento corrente resta autorevole"
    );
    assert_eq!(
        std::fs::read(&index).unwrap(),
        index_before,
        "un ripristino rifiutato non riscrive l'indice delle versioni"
    );
}

#[test]
fn restore_passes_from_the_record_and_is_cancels() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    // Il comando è nel registro, cioè: la palette lo vede, una macro lo può
    // chiamare, e questo test lo trova senza conoscere il provider.
    assert!(
        ws.commands().iter().any(|c| c.id == VERSION_RESTORE),
        "`{VERSION_RESTORE}` non è nel registro"
    );

    let (_, action) = restores(&mut ws);
    let action = action.expect("il bottone c'è");
    let yes = confirms(&mut ws, action);
    // La domanda da sola non scrive niente.
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'è\n"
    );
    ws.view_action(
        &instance(),
        UiAction::new(yes.action.0).with_payload(yes.payload),
    )
    .expect("ripristino");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'era\n"
    );
}

#[test]
fn a_restore_asked_and_cancelled_leaves_the_note_alone() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    let action = restores(&mut ws).1.expect("il bottone c'è");
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(action.action.0).with_payload(action.payload),
        )
        .expect("la domanda")
    else {
        panic!("la domanda si disegna")
    };
    let no = button(&root, "Annulla").expect("il no c'è");
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(no.action.0).with_payload(no.payload),
        )
        .expect("annullato")
    else {
        panic!("il pannello si ridisegna")
    };
    assert!(
        button(&root, "Ripristina").is_some(),
        "torna il bottone di prima"
    );
    assert!(
        !said(&root).contains("Riportare la nota"),
        "la domanda sparisce"
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'è\n"
    );
}

/// **Un ripristino disegnato su un'altra nota non scrive su questa.**
///
/// È il difetto 0047 nel suo secondo sito, e la corsa si **costruisce** invece
/// di aspettarla: tre chiamate in fila con il cambio di nota in mezzo, che è la
/// finestra vera — il pannello di `Uno.md` è ancora sotto il dito di chi clicca
/// perché il ridisegno che segue un cambio di nota arriva dopo.
///
/// Le due metà venivano da due istanti diversi: l'istante dalla storia di
/// `Uno.md`, la nota dal contesto attivo *adesso*. Qui l'istante di `Uno.md`
/// **esiste anche** nella storia di `Due.md`, perché le due note sono state
/// scritte insieme — che non è una coincidenza da laboratorio, è ciò che
/// succede in un lotto —, quindi il vecchio codice non si fermava a un errore:
/// riportava indietro `Due.md` in silenzio.
#[test]
fn a_restore_drawn_on_another_notes_not_writes_on_this() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "uno com'era\n", WriteBase::Dictated)
        .expect("creata");
    ws.write_document(&DocId::new("Due.md"), "due com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "uno com'è\n", WriteBase::Dictated)
        .expect("riscritta");
    ws.write_document(&DocId::new("Due.md"), "due com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    // 1. Il pannello si disegna su `Uno.md`, e il bottone si porta dietro la
    //    nota su cui è stato disegnato — fino al sì della domanda.
    let restore = restores(&mut ws).1.expect("il bottone c'è");
    let action = confirms(&mut ws, restore);
    // 2. La nota attiva cambia. Il ridisegno arriverà, ma non è ancora arrivato.
    watches(&mut ws, "Due.md");
    // 3. Il click parte dal pannello vecchio.
    ws.view_action(
        &instance(),
        UiAction::new(action.action.0).with_payload(action.payload),
    )
    .expect("un click scaduto non è un errore: è un click che non significa");

    assert_eq!(
        std::fs::read_to_string(vault.root.join("Due.md")).unwrap(),
        "due com'è\n",
        "la nota che si sta leggendo non torna indietro per un click su un'altra"
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "uno com'è\n",
        "e nemmeno quella disegnata: un salto scaduto si butta, non si consegna"
    );
}

/// L'inverso di un ripristino è un altro ripristino — e lo dichiara il comando.
///
/// Il vault è **nuovo** e nessuno ha ancora ripristinato niente: rifare il giro
/// nel test qui sopra proverebbe un'altra cosa, perché dopo un ripristino il
/// contenuto a cui si tornerebbe è quello che il ripristino stesso ha appena
/// scritto.
#[test]
fn inverse_of_a_restore_and_declared_from_the_command() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n", WriteBase::Dictated)
        .expect("riscritta");
    let ts = last_ts(&ws.render_view(&instance()).unwrap());

    let outcome = ws
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
    let undo = outcome
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
#[test]
fn restore_conflicts_if_document_changes_while_snapshot_is_read() {
    let vault = Vault::new();
    let gate = Arc::new(Barrier::new(2));
    let storage = Arc::new(RestoreRaceStorage {
        inner: FsStorage,
        gate: Arc::clone(&gate),
        document_path: vault.root.join("Uno.md"),
        snapshot_path: OnceLock::new(),
        armed: AtomicBool::new(false),
        write_fault: AtomicBool::new(false),
    });
    let mut ws = vault.open_with_storage(Arc::clone(&storage) as Arc<dyn VaultStorage>);
    let doc = DocId::new("Uno.md");
    ws.write_document(&doc, "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, doc.as_str());
    ws.write_document(&doc, "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    let (tree, action) = restores(&mut ws);
    let action = action.expect("il bottone c'è");
    let count_before = entries(&tree).len();
    let store = vault.root.join(".fub").join("plugins").join(VERSIONING_ID);
    let index = store.join("versions.json");
    let index_before = std::fs::read(&index).expect("indice delle versioni");
    let snapshot = std::fs::read_dir(&store)
        .expect("spazio del versioning")
        .find_map(|entry| {
            let path =
                Utf8PathBuf::from_path_buf(entry.expect("voce dello store").path()).expect("utf8");
            let candidate = path.join(format!(
                "{}.md",
                action
                    .payload
                    .get("ts")
                    .and_then(|value| value.as_u64())
                    .expect("l'azione porta il suo istante")
            ));
            candidate.is_file().then_some(candidate)
        })
        .expect("snapshot selezionato");
    storage
        .snapshot_path
        .set(snapshot)
        .expect("snapshot armabile");
    storage.armed.store(true, Ordering::Release);
    let root = vault.root.clone();
    let external = std::thread::spawn(move || {
        gate.wait();
        std::fs::write(root.join("Uno.md"), "modifica esterna\n").expect("scrittura esterna");
        gate.wait();
    });
    let events = ws.bus().subscribe();

    let error = ws
        .invoke_command(
            VERSION_RESTORE,
            action.payload,
            fub_abi::command::InvokeMode::Apply,
            fub_abi::event::Actor::User,
        )
        .expect_err("il ripristino concorrente deve essere un conflitto");
    external.join().expect("thread esterno");

    assert!(
        matches!(error, PluginError::Conflict(_)),
        "errore: {error:?}"
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "modifica esterna\n"
    );
    assert_eq!(std::fs::read(&index).unwrap(), index_before);
    assert_eq!(
        entries(&ws.render_view(&instance()).unwrap()).len(),
        count_before
    );
    assert!(
        events.try_iter().next().is_none(),
        "un conflitto non emette eventi"
    );
}

#[test]
fn restore_reports_io_and_changes_nothing_if_document_write_fails() {
    let vault = Vault::new();
    let storage = Arc::new(RestoreRaceStorage {
        inner: FsStorage,
        gate: Arc::new(Barrier::new(2)),
        document_path: vault.root.join("Uno.md"),
        snapshot_path: OnceLock::new(),
        armed: AtomicBool::new(false),
        write_fault: AtomicBool::new(false),
    });
    let mut ws = vault.open_with_storage(Arc::clone(&storage) as Arc<dyn VaultStorage>);
    let doc = DocId::new("Uno.md");
    ws.write_document(&doc, "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, doc.as_str());
    ws.write_document(&doc, "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    let (tree, action) = restores(&mut ws);
    let action = action.expect("il bottone c'è");
    let entries_before = entries(&tree);
    let index = vault
        .root
        .join(".fub")
        .join("plugins")
        .join(VERSIONING_ID)
        .join("versions.json");
    let index_before = std::fs::read(&index).expect("indice delle versioni");
    storage.write_fault.store(true, Ordering::Release);
    let events = ws.bus().subscribe();

    let error = ws
        .invoke_command(
            VERSION_RESTORE,
            action.payload,
            fub_abi::command::InvokeMode::Apply,
            fub_abi::event::Actor::User,
        )
        .expect_err("il guasto della scrittura deve essere un errore I/O");
    assert!(
        !storage.write_fault.load(Ordering::Acquire),
        "il guasto one-shot è stato consumato"
    );

    assert!(matches!(error, PluginError::Io(_)), "errore: {error:?}");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'è\n"
    );
    assert_eq!(std::fs::read(&index).unwrap(), index_before);
    let entries_after = entries(&ws.render_view(&instance()).unwrap());
    assert_eq!(entries_after, entries_before);
    assert!(
        events.try_iter().next().is_none(),
        "un guasto I/O non emette eventi"
    );
}

/// Il bottone disegnato con quell'etichetta, col payload che il pannello gli ha
/// messo addosso.
fn button(tree: &UiNode, wanted: &str) -> Option<ActionRef> {
    fn walk(node: &UiNode, wanted: &str, out: &mut Option<ActionRef>) {
        if let UiKind::Button { label, action, .. } = &node.kind {
            if label == wanted && out.is_none() {
                *out = Some(action.clone());
            }
        }
        for child in node.children() {
            walk(child, wanted, out);
        }
    }
    let mut out = None;
    walk(tree, wanted, &mut out);
    out
}

#[test]
fn the_comparison_shows_what_changed_since_that_version_and_survives_a_redraw() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(
        &DocId::new("Uno.md"),
        "titolo\ncom'era\nfine\n",
        WriteBase::Dictated,
    )
    .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(
        &DocId::new("Uno.md"),
        "titolo\ncom'è\nfine\n",
        WriteBase::Dictated,
    )
    .expect("riscritta");

    let tree = ws.render_view(&instance()).unwrap();
    let action = last_action(&tree);
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(action.action.0).with_payload(action.payload),
        )
        .expect("anteprima")
    else {
        panic!("l'anteprima si disegna")
    };
    // Di una versione passata il confronto è la vista di partenza.
    let text = said(&root);
    assert!(text.contains("1 righe in più e 1 in meno"), "{text}");
    assert!(text.contains("com'era") && text.contains("com'è"), "{text}");
    let show = button(&root, "Mostra il testo").expect("il testo intero è a un clic");
    let ViewUpdate::Replace { root: shown } = ws
        .view_action(
            &instance(),
            UiAction::new(show.action.0).with_payload(show.payload.clone()),
        )
        .expect("testo")
    else {
        panic!("il testo si disegna")
    };
    assert!(
        said(&shown).contains("titolo\ncom'era\nfine"),
        "{}",
        said(&shown)
    );
    let compare = button(&shown, "Confronta con l'attuale").expect("e il confronto torna");
    ws.view_action(
        &instance(),
        UiAction::new(compare.action.0).with_payload(compare.payload),
    )
    .expect("confronto");

    // Come l'anteprima, il confronto sta nello stato di vista: una scrittura
    // ridisegna il pannello e il confronto segue il contenuto attuale.
    ws.write_document(
        &DocId::new("Uno.md"),
        "titolo\ncom'era\nfine\n",
        WriteBase::Dictated,
    )
    .expect("riportata");
    let text = said(&ws.render_view(&instance()).unwrap());
    assert!(text.contains("identica"), "{text}");

    ws.view_action(&instance(), UiAction::new("close_preview"))
        .expect("chiusa");
    assert!(!said(&ws.render_view(&instance()).unwrap()).contains("identica"));
}

#[test]
fn copying_a_version_hands_its_text_to_the_shell_without_writing() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Uno.md"), "com'era\n", WriteBase::Dictated)
        .expect("creata");
    watches(&mut ws, "Uno.md");
    ws.write_document(&DocId::new("Uno.md"), "com'è\n", WriteBase::Dictated)
        .expect("riscritta");

    let tree = ws.render_view(&instance()).unwrap();
    let action = last_action(&tree);
    let ViewUpdate::Replace { root } = ws
        .view_action(
            &instance(),
            UiAction::new(action.action.0).with_payload(action.payload),
        )
        .expect("anteprima")
    else {
        panic!("l'anteprima si disegna")
    };
    let copy = button(&root, "Copia il testo").expect("una versione di testo si copia");
    let update = ws
        .view_action(
            &instance(),
            UiAction::new(copy.action.0).with_payload(copy.payload),
        )
        .expect("copia");
    assert_eq!(
        update,
        ViewUpdate::Custom {
            ns: fub_abi::ui::CLIPBOARD_TEXT_NS.to_string(),
            payload: serde_json::json!({ "text": "com'era\n" }),
        }
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Uno.md")).unwrap(),
        "com'è\n",
        "copiare non tocca la nota"
    );
}
