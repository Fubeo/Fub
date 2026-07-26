//! Backend Tauri v2 di FubMD.
//!
//! Monta il kernel agnostico con il provider markdown nativo, espone i comandi
//! IPC al frontend e fa da ponte: gli eventi dell'event bus del kernel (incluse
//! le modifiche rilevate dal file watcher) vengono inoltrati al webview.

use std::any::Any;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fubmd_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fubmd_abi::event::Actor;
use fubmd_abi::model::DocId;
use fubmd_abi::session::ViewContext;
use fubmd_abi::traits::{
    BacklinkRef, IndexQuery, IndexResult, LinkDirection, Page, SearchHit, TagCount, ViewSpec,
};
use fubmd_abi::ui::{ActionId, UiAction, UiNode, ViewUpdate};
use fubmd_features::{
    BacklinksView, CoreCommands, OutlineView, SearchIndex, StatsView, TagPanelView, VersionRef,
    VersionStore, VersioningHandler, BACKLINKS_ID, COMMANDS_ID, OUTLINE_ID, SEARCH_ID, STATS_ID,
    TAGS_ID, VERSIONING_ID,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, TrashEntry, Trust, Workspace};

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use serde::{Deserialize, Serialize};
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

/// Rispecchiato da `VaultInfo` in `frontend/src/api.ts`; il legame è la
/// fixture di `tests/ts_mirror_app.rs`.
#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub documents: Vec<String>,
    /// Le estensioni che i provider registrati gestiscono (minuscole, senza
    /// punto). Il frontend le usa per ricavare il "nome pagina" di un `DocId`
    /// senza cablare `.md`: quale sia l'estensione di un documento lo sanno i
    /// `FormatDescriptor`, non la UI.
    pub extensions: Vec<String>,
    /// Il versioning è acceso? Spento significa **assente** (D7): il frontend
    /// non disegna la cronologia, e nel vault non compare nulla.
    pub versioning: bool,
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

/// [`DocId`] da input IPC: la stessa validazione del kernel
/// (`fubmd_kernel::valid_doc_id`), applicata sul confine — nessun comando
/// costruisce un `DocId` non sanitizzato da ciò che arriva dal webview.
fn doc_id(raw: &str) -> Result<DocId, String> {
    fubmd_kernel::valid_doc_id(raw).map_err(|e| e.to_string())
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

    // La sessione precedente si chiude **prima** che la nuova si apra, e non
    // dopo: l'indice di ricerca tiene un lock esclusivo di scrittura sulla
    // propria cartella, e tantivy quel lock lo aspetta *bloccando*. Aprendo la
    // nuova sessione sullo stesso vault mentre la vecchia è ancora viva, il
    // comando si pianta per sempre — nessun errore, nessun log, la finestra
    // resta a metà. Succede riaprendo lo stesso vault dal dialogo, e in
    // sviluppo a ogni ricarica della pagina.
    //
    // Prezzo dichiarato: se l'apertura nuova fallisce, non si torna alla
    // vecchia. È la scelta onesta — la sessione vecchia ha già un watcher e un
    // indice su un vault che l'utente ha detto di voler lasciare.
    drop(state.session.lock().unwrap().take());

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());

    let mut ws = Workspace::new(&root, registry);

    // L'indice va registrato PRIMA di `reindex`: è lì che riceve il contenuto
    // del vault e riconcilia ciò che è cambiato mentre non era vivo. Se non si
    // apre, il vault si apre lo stesso senza ricerca: la verità è il vault,
    // l'indice è stato derivato e non deve mai impedire di leggere le note.
    //
    // Vive nel proprio spazio dati (`.fubmd-data/plugins/fubmd.search/`), che è
    // il kernel ad assegnargli: la registrazione lo attiva, e l'attivazione è
    // il momento in cui ritrova da `data_*` le impronte di ciò che ha già visto.
    match ws
        .plugin_data_dir(SEARCH_ID)
        .and_then(|dir| SearchIndex::open(&dir))
    {
        Ok(index) => {
            if let Err(e) = ws.register_index_provider(SEARCH_ID, Box::new(index)) {
                // L'indice c'è, ma non ha ritrovato la propria memoria: si
                // reindicizza tutto. È lento, non sbagliato.
                eprintln!("indice di ricerca: impronte non ritrovate, reindicizzo: {e}");
            }
        }
        Err(e) => eprintln!("indice di ricerca non disponibile: {e}"),
    }

    // Il versioning è una feature ufficiale scritta come la scriverebbe un
    // plugin: un `EventHandler` e nient'altro. Spento (D7) non si registra, e
    // nel vault non compare nemmeno la cartella.
    //
    // Lo store si apre con le stesse capacità che avrà l'handler — un
    // `HostApi` intestato a `VERSIONING_ID` — e non con `std::fs`: l'app non ha
    // un canale privilegiato che un plugin non avrebbe. La prima fotografia del
    // vault non è più qui: è policy della feature, e scatta sull'evento
    // `VaultOpened` che `reindex` emette qui sotto.
    let versions = versioning_enabled()
        .then(|| ws.with_host(VERSIONING_ID, |host| VersionStore::open(host)))
        .transpose()
        .unwrap_or_else(|e| {
            eprintln!("versioning non disponibile: {e}");
            None
        });
    if let Some(store) = &versions {
        ws.register_event_handler(
            VERSIONING_ID,
            Box::new(VersioningHandler::new(store.clone())),
        );
    }

    // Il pannello backlink è una feature ufficiale che passa per il protocollo
    // di view come dovrà fare un plugin: registrato come `ViewProvider` fidato
    // (produce solo UI dichiarativa, niente `Html`/`WebView`), si prende
    // documento attivo e riferimenti dall'`HostApi`. L'app non gli fa più da
    // tramite — il giro render/azione passa dai comandi generici qui sotto.
    ws.register_view_provider(BACKLINKS_ID, Trust::Trusted, Box::new(BacklinksView));
    // L'outline è la seconda feature ufficiale sul giro delle view, e la prima a
    // usare il canale metadata (`IndexQuery::Outline`): legge la struttura del
    // documento attivo dal kernel, non dall'app.
    ws.register_view_provider(OUTLINE_ID, Trust::Trusted, Box::new(OutlineView));
    // Il pannello tag: aggrega i tag del vault via `IndexQuery::Tags`, click →
    // ricerca. Terza feature ufficiale sul giro delle view.
    ws.register_view_provider(TAGS_ID, Trust::Trusted, Box::new(TagPanelView));
    // Le statistiche: quarta feature sul giro delle view, e la prima a leggere
    // il **contesto di sessione** per intero — selezione e modalità, non solo
    // quale nota è aperta (§1.9).
    ws.register_view_provider(STATS_ID, Trust::Trusted, Box::new(StatsView));
    // I comandi ufficiali: la prima feature sul giro del **registro** (§1.1).
    // Da qui in poi un'azione nuova non è un comando Tauri in più — è una riga
    // in un `CommandProvider`, e la palette la trova da sola.
    ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands));

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
            extensions: ws.extensions(),
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
                    // Un rename accoppiato (`paths = [from, to]`) è una
                    // migrazione d'identità, non remove+add: la storia del
                    // versioning resta attaccata alla nota, il frontend migra
                    // i meta, e `DocumentRenamed` viene emesso anche per i
                    // rename fatti da Finder/Obsidian/sync. Tutto il resto
                    // passa dal fallback per-path qui sotto.
                    if matches!(
                        event.kind,
                        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                    ) && event.paths.len() == 2
                    {
                        if let (Ok(from), Ok(to)) = (
                            Utf8PathBuf::from_path_buf(event.paths[0].clone()),
                            Utf8PathBuf::from_path_buf(event.paths[1].clone()),
                        ) {
                            let _ = ws.sync_renamed_path(&from, &to);
                            continue;
                        }
                    }
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
    ws.read_source(&doc_id(&id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_document(state: State<AppState>, id: String, source: String) -> Result<(), String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.write_document(&doc_id(&id)?, &source)
        .map_err(|e| e.to_string())
}

/// Rinomina/sposta un documento: file, grafo, evento `DocumentRenamed` e
/// riscrittura chirurgica dei wikilink entranti (stile Obsidian).
#[tauri::command]
fn rename_document(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.rename_document(&doc_id(&from)?, &doc_id(&to)?)
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
    ws.delete_document(&doc_id(&id)?)
        .map(|d| d.0)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_trash(state: State<AppState>) -> Result<Vec<TrashEntry>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    ws.list_trash().map_err(|e| e.to_string())
}

/// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, … a partire da un
/// path occupato (D3).
///
/// Esiste per non avere **due** implementazioni della stessa convenzione: la
/// proposta che il frontend mostra quando un ripristino trova il path occupato
/// esce dallo stesso codice che nomina le note nuove. Non prenota nulla — il
/// kernel resta il backstop se il nome viene preso nel frattempo.
#[tauri::command]
fn propose_free_name(state: State<AppState>, id: String) -> Result<String, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.free_name(&DocId::new(id)).0)
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
    let to = to.as_deref().map(doc_id).transpose()?;
    ws.restore_from_trash(&doc_id(&id)?, to)
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

/// Rispecchiato da `EmbedContent` in `frontend/src/api.ts` (fixture di
/// `tests/ts_mirror_app.rs`).
#[derive(Serialize)]
pub struct EmbedContent {
    pub doc_id: String,
    pub html: String,
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

// --- view dichiarative (protocollo generico) -------------------------------
//
// Il canale core→UI dei `ViewProvider`: la shell chiede l'albero di una view e
// rimanda le azioni al provider, senza sapere cosa la view faccia. Il pannello
// backlink passa di qui come dovrà passarci un plugin — nessun comando ad-hoc
// per feature. L'enforcement del confine di fiducia (`Html`/`WebView` solo dal
// codice fidato) è dentro `render_view`/`view_action`, in un punto solo.

/// Contesto del pannello con il focus: quale nota, cosa c'è selezionato, in che
/// modalità. Lo pubblica la shell a ogni navigazione, movimento del cursore o
/// cambio di modalità; le view lo leggono via `HostApi::active_context`.
///
/// Restituisce **gli id delle view da ridisegnare** — quelle la cui
/// `ViewSpec.follows` interseca ciò che è cambiato. Il conto lo fa il kernel e
/// non la shell perché la regola deve essere una sola: la shell sa *quando*
/// pubblicare, non *chi* segue cosa. `None` = nessun pannello (all'avvio, o
/// dopo che l'ultima nota è stata chiusa).
#[tauri::command]
fn set_active_context(
    state: State<AppState>,
    context: Option<ViewContext>,
) -> Result<Vec<String>, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    Ok(ws.set_active_context(context))
}

/// Le view offerte dai provider registrati, nell'ordine di registrazione.
///
/// È la metà "discovery" del protocollo: la shell non cabla gli id — monta
/// ogni view nel contenitore del suo `placement` e la ridisegna quando arriva
/// un evento della sua maschera `refresh`. Una view di plugin compare da sola.
#[tauri::command]
fn list_views(state: State<AppState>) -> Result<Vec<ViewSpec>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.views())
}

/// Rende l'albero `UiNode` di una view registrata. Il render è una lettura:
/// prende il workspace in prestito condiviso, non in esclusiva.
#[tauri::command]
fn render_view(state: State<AppState>, view: String) -> Result<UiNode, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    ws.render_view(&view).map_err(|e| e.to_string())
}

/// Consegna un'azione della UI al provider della view e restituisce il suo
/// aggiornamento (`Replace`/`Navigate`/`None`), che il frontend interpreta.
#[tauri::command]
fn view_action(
    state: State<AppState>,
    view: String,
    action: String,
    payload: Option<serde_json::Value>,
) -> Result<ViewUpdate, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.view_action(
        &view,
        UiAction {
            action: ActionId(action),
            payload: payload.unwrap_or(serde_json::Value::Null),
        },
    )
    .map_err(|e| e.to_string())
}

// --- comandi (protocollo generico) -----------------------------------------
//
// L'altro giro discovery+invoke accanto a quello delle view, e la ragione per
// cui questo file non deve più crescere di un comando Tauri per feature (§4.2):
// un'azione nuova si dichiara in un `CommandProvider` e arriva alla palette da
// sola, con i suoi parametri e il suo raggio.

/// I comandi offerti dai provider registrati.
///
/// La shell non ne cabla nessuno: disegna ciò che legge, chiede i parametri che
/// la spec dichiara e decide se chiedere conferma dal raggio dichiarato. Sono
/// le stesse informazioni che leggerebbero una CLI (27.1) o un chiamante
/// programmatico (22.4) — questo comando IPC è solo il primo dei suoi clienti.
#[tauri::command]
fn list_commands(state: State<AppState>) -> Result<Vec<CommandSpec>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.commands())
}

/// Esegue — o simula — un comando.
///
/// `mode` assente significa `apply`: è la scelta di **questo** confine, non del
/// contratto (dove un default non esiste apposta). Il webview è codice nostro e
/// il caso normale è eseguire; chi vuole il piano lo chiede, e riceve un
/// `CommandOutcome` con dentro l'effetto `plan`.
///
/// L'attore è [`Actor::User`] e **non** un parametro dell'IPC: da questo canale
/// passa la persona davanti allo schermo, per il tramite della webview, e
/// lasciare che il chiamante si dichiarasse chi vuole avrebbe reso l'origine una
/// stringa di cortesia — un'automazione (16.2) che potesse firmarsi "utente"
/// aggirerebbe l'unica difesa che 16.2 ha. Gli altri chiamanti del registro (la
/// CLI di 27.1, l'API locale di 27.2) sono canali diversi e diranno il proprio
/// attore là dove passano.
#[tauri::command]
fn invoke_command(
    state: State<AppState>,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
) -> Result<CommandOutcome, String> {
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.invoke_command(
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
        Actor::User,
    )
    .map_err(|e| e.to_string())
}

/// Ricerca full-text sul vault.
///
/// `snippet` è testo semplice e `highlights` sono intervalli in byte al suo
/// interno: il frontend evidenzia con i propri elementi, senza mai interpretare
/// come markup ciò che arriva da un provider (vedi `SearchHit`).
#[tauri::command]
fn search(
    state: State<AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    let q = IndexQuery::FullText {
        query,
        // Tutto il vault: l'ambito (cartella, tag) è nel contratto e lo esercita
        // l'indice; la shell non ha ancora un modo di chiederlo all'utente.
        scope: Default::default(),
        page: Some(Page::first(limit.unwrap_or(50))),
    };
    match ws.query_index(q).map_err(|e| e.to_string())? {
        // `total` resta all'indice finché la UI non mostra "1-20 di N": qui
        // passa la sola pagina, che è ciò che il pannello disegna.
        IndexResult::Search(hits) => Ok(hits.items),
        other => Err(format!("l'indice ha risposto fuori tema: {other:?}")),
    }
}

/// I tag del vault con la loro frequenza, per l'autocompletamento `#` in
/// editor. Il kernel risponde da uno snapshot incrementale (canale metadata,
/// come l'outline): chiederli a ogni popup è economico, niente cache lato UI.
#[tauri::command]
fn list_tags(state: State<AppState>) -> Result<Vec<TagCount>, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    match ws
        .query_index(IndexQuery::Tags { page: None })
        .map_err(|e| e.to_string())?
    {
        IndexResult::Tags(tags) => Ok(tags.items),
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

/// Rileggere una versione passa dall'`HostApi` come tutto il resto: l'app
/// presta al versioning le sue stesse capacità (`Workspace::with_host`), non
/// una scorciatoia sul filesystem.
fn read_version_source(state: &AppState, doc: &DocId, ts: u64) -> Result<String, String> {
    let store = versions_of(state)?;
    let ws = current(state)?;
    let mut ws = ws.lock().unwrap();
    ws.with_host(VERSIONING_ID, |host| store.read(doc, ts, host))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_version(state: State<AppState>, id: String, ts: u64) -> Result<String, String> {
    read_version_source(&state, &DocId::new(id), ts)
}

/// Ripristina una versione riscrivendo il documento (D8): passa da parse,
/// grafo, indici ed eventi come ogni altra modifica — e siccome passa dagli
/// eventi, genera a sua volta uno snapshot. Il ripristino è annullabile.
#[tauri::command]
fn restore_version(state: State<AppState>, id: String, ts: u64) -> Result<(), String> {
    let doc = DocId::new(id);
    let source = read_version_source(&state, &doc, ts)?;
    let ws = current(&state)?;
    let mut ws = ws.lock().unwrap();
    ws.write_document(&doc, &source).map_err(|e| e.to_string())
}

// --- organizzazione del vault ----------------------------------------------
//
// Icone, note appuntate, ordinamenti scelti a mano e spazio attivo vivono nel
// sidecar `.fubmd/workspace.json`, dentro il vault: le note restano markdown
// puro e l'organizzazione viaggia col vault (sync, git). A differenza di
// `.fubmd-data` questi dati sono autorevoli, non derivati: persi, non si
// ricostruiscono. Il kernel non ne sa nulla — `.fubmd` è un dot-dir, quindi
// scansione, watcher e indice lo ignorano già.

/// Metadati di organizzazione del vault (rispecchiato da `WorkspaceMeta` in
/// `frontend/src/api.ts`). Le chiavi sono path relativi al vault: `DocId` per
/// le note, path di cartella senza slash finale per le cartelle (`""` è la
/// radice).
#[derive(Default, Serialize, Deserialize)]
pub struct WorkspaceMeta {
    /// path → emoji mostrata accanto al nome.
    #[serde(default)]
    pub icons: std::collections::BTreeMap<String, String>,
    /// Note appuntate in cima alla sidebar, nell'ordine scelto.
    #[serde(default)]
    pub pinned: Vec<String>,
    /// cartella → nomi dei figli nell'ordine scelto a mano; chi non compare
    /// segue in ordine alfabetico.
    #[serde(default)]
    pub order: std::collections::BTreeMap<String, Vec<String>>,
    /// Cartelle registrate come "spazi": la striscia di icone in cima alla
    /// sidebar, nell'ordine in cui appaiono. QUALE spazio è selezionato è
    /// stato di vista, per-macchina: sta al frontend, non qui.
    #[serde(default)]
    pub spaces: Vec<String>,
}

fn workspace_meta_path(state: &AppState) -> Result<Utf8PathBuf, String> {
    let ws = current(state)?;
    let ws = ws.lock().unwrap();
    Ok(ws.root().join(".fubmd").join("workspace.json"))
}

/// File assente = vault mai personalizzato: si risponde col default, non con
/// un errore. Un file presente ma malformato invece È un errore: sovrascriverlo
/// in silenzio con il default butterebbe via l'organizzazione dell'utente.
#[tauri::command]
fn read_workspace_meta(state: State<AppState>) -> Result<WorkspaceMeta, String> {
    let path = workspace_meta_path(&state)?;
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| format!("{path} non è un workspace.json valido: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(WorkspaceMeta::default()),
        Err(e) => Err(format!("non riesco a leggere {path}: {e}")),
    }
}

#[tauri::command]
fn write_workspace_meta(state: State<AppState>, meta: WorkspaceMeta) -> Result<(), String> {
    let path = workspace_meta_path(&state)?;
    let dir = path
        .parent()
        .expect("il sidecar sta sempre in una cartella");
    std::fs::create_dir_all(dir).map_err(|e| format!("non riesco a creare {dir}: {e}"))?;
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("non riesco a scrivere {path}: {e}"))
}

// --- graph-data --------------------------------------------------------------
//
// L'ultima view di M2, e l'unica FUORI da `UiNode`: un grafo force-directed è
// Canvas, e il protocollo dichiarativo non lo esprime (né deve: è la
// superficie privilegiata dichiarata nel piano). Da qui esce solo DATO —
// nodi e archi — e il renderer vive nel frontend.
//
// Il grafo però è entrato nel contratto (§1.6: `IndexQuery::Neighbors`), e
// questo comando ne è il **primo cliente**: gli archi li chiede una nota alla
// volta al canale dati, con le stesse capacità che avrà una vista a grafo di
// terzi. Prima li prendeva da `Workspace::outgoing`, che è una scorciatoia che
// un plugin non ha — cioè la definizione di superficie privilegiata.

/// Un arco del grafo: `from` linka `to` (wikilink risolto).
#[derive(Serialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
}

/// Il grafo del vault: nodi = documenti indicizzati, archi = wikilink
/// risolti, deduplicati (la molteplicità non disegna nulla). Rispecchiato da
/// `GraphData` in `frontend/src/api.ts` (fixture di `tests/ts_mirror_app.rs`).
#[derive(Serialize)]
pub struct GraphData {
    pub nodes: Vec<String>,
    pub edges: Vec<GraphEdge>,
}

#[tauri::command]
fn graph_data(state: State<AppState>) -> Result<GraphData, String> {
    let ws = current(&state)?;
    let ws = ws.lock().unwrap();
    let docs = ws.documents();
    let mut seen = std::collections::BTreeSet::new();
    let mut edges = Vec::new();
    for from in &docs {
        // Adiacenza pura: un passo, verso uscente. A `depth: 1` il `via` di ogni
        // vicino è il documento interrogato, cioè l'arco è (from → doc).
        let neighbors = match ws
            .query_index(IndexQuery::Neighbors {
                doc: from.clone(),
                direction: LinkDirection::Outbound,
                depth: 1,
                page: None,
            })
            .map_err(|e| e.to_string())?
        {
            IndexResult::Neighbors(n) => n.items,
            other => return Err(format!("il grafo ha risposto fuori tema: {other:?}")),
        };
        for neighbor in neighbors {
            if seen.insert((from.clone(), neighbor.doc.clone())) {
                edges.push(GraphEdge {
                    from: from.0.clone(),
                    to: neighbor.doc.0,
                });
            }
        }
    }
    Ok(GraphData {
        nodes: docs.into_iter().map(|d| d.0).collect(),
        edges,
    })
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
            propose_free_name,
            restore_from_trash,
            empty_trash,
            render_preview,
            render_embed,
            backlinks,
            set_active_context,
            list_views,
            render_view,
            view_action,
            list_commands,
            invoke_command,
            search,
            list_tags,
            graph_data,
            resolve_link,
            list_versions,
            read_version,
            restore_version,
            read_workspace_meta,
            write_workspace_meta,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di FubMD");
}
