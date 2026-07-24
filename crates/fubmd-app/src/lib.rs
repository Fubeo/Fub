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
use fubmd_features::{build_backlinks_view, SearchIndex};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Sessione di un vault aperto: il workspace condiviso + il watcher tenuto vivo.
struct VaultSession {
    workspace: Arc<Mutex<Workspace>>,
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

    ws.reindex().map_err(|e| e.to_string())?;

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
        }
    };

    *state.session.lock().unwrap() = Some(VaultSession {
        workspace,
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
            render_preview,
            render_embed,
            backlinks,
            backlinks_view,
            search,
            resolve_link,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di FubMD");
}
