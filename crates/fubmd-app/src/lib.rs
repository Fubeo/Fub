//! Backend Tauri v2 di FubMD.
//!
//! Monta il kernel agnostico con il provider markdown nativo, espone i comandi
//! IPC al frontend e fa da ponte: gli eventi dell'event bus del kernel (incluse
//! le modifiche rilevate dal file watcher) vengono inoltrati al webview.

use std::any::Any;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{BacklinkRef, IndexQuery, IndexResult, SearchHit};
use fubmd_abi::ui::UiNode;
use fubmd_features::{build_backlinks_view, SearchIndex, VersionRef, VersionStore, VersioningHandler};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, TrashEntry, Workspace};

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Sessione di un vault aperto: il workspace condiviso + il watcher tenuto vivo.
struct VaultSession {
    workspace: Arc<Mutex<Workspace>>,
    /// Copia dello store delle versioni, se il versioning è acceso. L'altra
    /// vive dentro l'handler registrato nel workspace: il kernel non sa che il
    /// versioning esiste, ed è l'app a comporre le due metà.
    versions: Option<VersionStore>,
    /// Debouncer con tipo cancellato: va solo tenuto in vita.
    _watcher: Box<dyn Any + Send>,
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<VaultSession>>,
}

#[derive(Serialize)]
struct VaultInfo {
    root: String,
    documents: Vec<String>,
    /// Il versioning è acceso? Spento significa **assente** (D7): il frontend
    /// non disegna la cronologia, e nel vault non compare nulla.
    versioning: bool,
}

/// Il versioning è acceso?
///
/// Fino ai settings dichiarativi di M3 l'interruttore è una variabile
/// d'ambiente. Acceso di default — è una rete di sicurezza, e una rete che va
/// accesa a mano non c'è quando serve — e spento da `FUBMD_VERSIONING` a `0`,
/// `off`, `no` o `false`.
fn versioning_enabled() -> bool {
    match std::env::var("FUBMD_VERSIONING") {
        Err(_) => true,
        Ok(v) => !matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "0" | "off" | "no" | "false"
        ),
    }
}

/// Lo store delle versioni della sessione, o l'errore se il versioning è
/// spento: un comando che risponde "vuoto" quando la feature non c'è
/// racconterebbe che non ci sono versioni, che è un'altra cosa.
fn versions_of(state: &AppState) -> Result<VersionStore, String> {
    state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.versions.clone())
        .ok_or_else(|| "Versioning disattivato.".to_string())
}

/// Restituisce un handle clonato al workspace corrente, o errore se nessun
/// vault è aperto.
fn current(state: &AppState) -> Result<Arc<Mutex<Workspace>>, String> {
    state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.workspace.clone())
        .ok_or_else(|| "Nessun vault aperto.".to_string())
}

#[tauri::command]
fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> Result<VaultInfo, String> {
    let root = Utf8PathBuf::from(path);
    if !root.is_dir() {
        return Err(format!("Non è una cartella valida: {root}"));
    }

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());

    let mut ws = Workspace::new(&root, registry);

    // L'indice va registrato PRIMA di `reindex`: è lì che riceve il contenuto
    // del vault e riconcilia ciò che è cambiato mentre non era vivo. Se non si
    // apre, il vault si apre lo stesso senza ricerca: la verità è il vault,
    // l'indice è stato derivato e non deve mai impedire di leggere le note.
    match SearchIndex::open(&root) {
        Ok(index) => ws.register_index_provider(Box::new(index)),
        Err(e) => eprintln!("indice di ricerca non disponibile: {e}"),
    }

    // Il versioning è una feature ufficiale scritta come la scriverebbe un
    // plugin: un `EventHandler` e nient'altro. Spento (D7) non si registra, e
    // nel vault non compare nemmeno la cartella.
    let versions = versioning_enabled()
        .then(|| VersionStore::open(&root))
        .transpose()
        .unwrap_or_else(|e| {
            eprintln!("versioning non disponibile: {e}");
            None
        });
    if let Some(store) = &versions {
        ws.register_event_handler(Box::new(VersioningHandler::new(store.clone())));
    }

    ws.reindex().map_err(|e| e.to_string())?;

    // La prima fotografia del vault. Gli snapshot nascono dagli eventi e
    // l'apertura non ne emette per documento: senza questo passaggio, la prima
    // modifica a una nota mai versionata cancellerebbe lo stato in cui l'utente
    // l'ha trovata — l'handler gira dopo la scrittura e vede solo il testo
    // nuovo. Chi ha già una storia non paga nulla, nemmeno una lettura.
    if let Some(store) = &versions {
        for id in ws.documents() {
            if store.has_versions(&id) {
                continue;
            }
            match ws.read_source(&id) {
                Ok(source) => {
                    if let Err(e) = store.snapshot(&id, &source) {
                        eprintln!("versioning: prima versione di {id} non salvata: {e}");
                    }
                }
                Err(e) => eprintln!("versioning: {id} non si legge: {e}"),
            }
        }
    }

    // Ponte eventi kernel → frontend (thread dedicato che vive quanto il bus).
    let rx = ws.bus().subscribe();
    let app_bridge = app.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            let _ = app_bridge.emit("fubmd://event", &event);
        }
    });

    let workspace = Arc::new(Mutex::new(ws));
    let watcher = spawn_watcher(&root, workspace.clone()).map_err(|e| e.to_string())?;

    let info = {
        let ws = workspace.lock().unwrap();
        VaultInfo {
            root: ws.root().to_string(),
            documents: ws.documents().into_iter().map(|d| d.0).collect(),
            versioning: versions.is_some(),
        }
    };

    *state.session.lock().unwrap() = Some(VaultSession {
        workspace,
        versions,
        _watcher: watcher,
    });
    Ok(info)
}

/// Avvia un watcher debounced sulla radice del vault: ogni cambiamento
/// sincronizza il workspace, che a sua volta emette eventi verso il frontend.
fn spawn_watcher(
    root: &camino::Utf8Path,
    workspace: Arc<Mutex<Workspace>>,
) -> notify::Result<Box<dyn Any + Send>> {
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                let mut ws = workspace.lock().unwrap();
                for event in events {
                    for path in &event.paths {
                        if let Ok(p) = Utf8PathBuf::from_path_buf(path.clone()) {
                            let _ = ws.sync_path(&p);
                        }
                    }
                }
                // Fine del lotto debounced: è il punto tranquillo in cui
                // rendere durevoli gli indici. Il kernel non sa quando finisce
                // un lotto — lo sa il watcher, che il lotto lo ha formato.
                for e in ws.flush_indexes() {
                    eprintln!("flush indice: {e}");
                }
            }
            Err(errors) => {
                for e in errors {
                    eprintln!("watch error: {e:?}");
                }
            }
        },
    )?;
    debouncer.watch(root.as_std_path(), RecursiveMode::Recursive)?;
    Ok(Box::new(debouncer))
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot):
/// il frontend lo legge e apre il vault senza passare dal dialog.
#[tauri::command]
fn initial_vault() -> Option<String> {
    std::env::var("FUBMD_VAULT").ok().filter(|s| !s.is_empty())
}

#[tauri::command]
fn list_documents(state: State<AppState>) -> Result<Vec<String>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.documents().into_iter().map(|d| d.0).collect())
}

#[tauri::command]
fn read_document(state: State<AppState>, id: String) -> Result<String, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    ws.read_source(&DocId::new(id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_document(state: State<AppState>, id: String, source: String) -> Result<(), String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.write_document(&DocId::new(id), &source)
        .map_err(|e| e.to_string())
}

/// Rinomina/sposta un documento: file, grafo, evento `DocumentRenamed` e
/// riscrittura chirurgica dei wikilink entranti (stile Obsidian).
#[tauri::command]
fn rename_document(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.rename_document(&DocId::new(from), &DocId::new(to))
        .map_err(|e| e.to_string())
}

/// Crea una nota vuota e restituisce il suo id. Senza `name` nasce "Senza
/// titolo" (o il primo nome libero della famiglia); con `name` è il flusso
/// "crea nota da link non risolto", e il nome arriva dal wikilink.
#[tauri::command]
fn create_note(state: State<AppState>, name: Option<String>) -> Result<String, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.create_note(name.as_deref())
        .map(|d| d.0)
        .map_err(|e| e.to_string())
}

/// Cancella una nota spostandola nel cestino del vault; restituisce dove è
/// finita. Il delete dell'app **è** questo spostamento: niente è distrutto
/// finché l'utente non svuota il cestino.
#[tauri::command]
fn delete_document(state: State<AppState>, id: String) -> Result<String, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.delete_document(&DocId::new(id))
        .map(|d| d.0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_trash(state: State<AppState>) -> Result<Vec<TrashEntry>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    ws.list_trash().map_err(|e| e.to_string())
}

/// Ripristina una voce del cestino, opzionalmente sotto un altro nome (è il
/// caso in cui il path originale è di nuovo occupato e l'app ha chiesto).
#[tauri::command]
fn restore_from_trash(
    state: State<AppState>,
    id: String,
    to: Option<String>,
) -> Result<String, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.restore_from_trash(&DocId::new(id), to.map(DocId::new))
        .map(|d| d.0)
        .map_err(|e| e.to_string())
}

/// Svuota il cestino: restituisce quante voci ha cancellato, perché da qui in
/// poi non sono più recuperabili e l'utente deve poterlo leggere.
#[tauri::command]
fn empty_trash(state: State<AppState>) -> Result<usize, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.empty_trash().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct EmbedContent {
    doc_id: String,
    html: String,
}

/// Contenuto di un embed `![[page#heading]]`: il frontend lo innesta nel
/// placeholder emesso dal provider (profondità massima e cicli a suo carico).
#[tauri::command]
fn render_embed(
    state: State<AppState>,
    page: String,
    heading: Option<String>,
) -> Result<EmbedContent, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    let (doc_id, html) = ws
        .render_embed(&page, heading.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(EmbedContent {
        doc_id: doc_id.0,
        html,
    })
}

#[tauri::command]
fn render_preview(state: State<AppState>, id: String) -> Result<String, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    ws.render_preview(&DocId::new(id))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn backlinks(state: State<AppState>, id: String) -> Result<Vec<BacklinkRef>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.backlinks(&DocId::new(id)))
}

/// Backlink già in forma di UI dichiarativa (dogfooding del protocollo `UiNode`).
#[tauri::command]
fn backlinks_view(state: State<AppState>, id: String) -> Result<UiNode, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(build_backlinks_view(&ws.backlinks(&DocId::new(id))))
}

/// Ricerca full-text sul vault.
///
/// `snippet` è testo semplice e `highlights` sono intervalli in byte al suo
/// interno: il frontend evidenzia con i propri elementi, senza mai interpretare
/// come markup ciò che arriva da un provider (vedi `SearchHit`).
#[tauri::command]
fn search(state: State<AppState>, query: String, limit: Option<u32>) -> Result<Vec<SearchHit>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    let q = IndexQuery::FullText {
        query,
        limit: limit.unwrap_or(50),
    };
    match ws.query_index(q).map_err(|e| e.to_string())? {
        IndexResult::Search(hits) => Ok(hits),
        other => Err(format!("l'indice ha risposto fuori tema: {other:?}")),
    }
}

// --- versioning ------------------------------------------------------------
//
// Il kernel non sa che il versioning esiste: le versioni le tiene un
// `EventHandler`, e il ripristino è una scrittura normale (D8). L'app compone
// le due metà, che è esattamente ciò che dovrà fare per un plugin di terzi.

#[tauri::command]
fn list_versions(state: State<AppState>, id: String) -> Result<Vec<VersionRef>, String> {
    Ok(versions_of(&state)?.list(&DocId::new(id)))
}

#[tauri::command]
fn read_version(state: State<AppState>, id: String, ts: u64) -> Result<String, String> {
    versions_of(&state)?
        .read(&DocId::new(id), ts)
        .map_err(|e| e.to_string())
}

/// Ripristina una versione riscrivendo il documento (D8): passa da parse,
/// grafo, indici ed eventi come ogni altra modifica — e siccome passa dagli
/// eventi, genera a sua volta uno snapshot. Il ripristino è annullabile.
#[tauri::command]
fn restore_version(state: State<AppState>, id: String, ts: u64) -> Result<(), String> {
    let doc = DocId::new(id);
    let source = versions_of(&state)?
        .read(&doc, ts)
        .map_err(|e| e.to_string())?;
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.write_document(&doc, &source).map_err(|e| e.to_string())
}

#[tauri::command]
fn resolve_link(state: State<AppState>, page: String) -> Result<Option<String>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.resolve_link(&page).map(|d| d.0))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            initial_vault,
            list_documents,
            read_document,
            write_document,
            rename_document,
            create_note,
            delete_document,
            list_trash,
            restore_from_trash,
            empty_trash,
            render_preview,
            render_embed,
            backlinks,
            backlinks_view,
            search,
            resolve_link,
            list_versions,
            read_version,
            restore_version,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di FubMD");
}
