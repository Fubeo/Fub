//! Colla Tauri v2 di FubMD: comandi IPC, ponte eventi verso il webview,
//! finestre e dialoghi.
//!
//! **Chi monta non è qui.** Registro dei formati, feature ufficiali, indice di
//! ricerca, versioning, view, comandi, sintassi, renderer, sessione e watcher
//! stanno in [`fubmd_host`], che non dipende da tauri: quel montaggio ha cinque
//! clienti previsti — CLI (27.1), API locale (27.2), e2e headless (17.2 e
//! 27.4), mobile (26.2) e PWA (26.3) — e finché viveva dentro
//! `#[tauri::command] open_vault` nessuno di loro poteva riusarlo (§8.2,
//! decisione 0023).
//!
//! Ciò che resta in questo file è **solo** ciò che non esiste senza un webview:
//! le firme `#[tauri::command]`, la traduzione degli errori in `String` per
//! l'IPC, il ponte che inoltra gli eventi del kernel a `fubmd://event`, e
//! `run()`. Se una riga di questo file può essere spiegata senza nominare
//! Tauri, sta nel posto sbagliato.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fubmd_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fubmd_abi::event::Actor;
use fubmd_abi::model::DocId;
use fubmd_abi::session::ViewContext;
use fubmd_abi::traits::{IndexQuery, IndexResult, ViewInstance, ViewSpec};
use fubmd_abi::ui::{ActionId, FieldValue, UiAction, UiNode, ViewUpdate};
use fubmd_abi::Notice;
use fubmd_features::VersionRef;
use fubmd_host::{doc_id, EventSink, Host};
use fubmd_kernel::{RenderedDocument, TrashEntry};

use tauri::{AppHandle, Emitter, State};

// I tre record che attraversano l'IPC vivono nell'host — un'API locale
// risponderebbe con gli stessi — e l'app li ri-esporta, perché è lei a farli
// attraversare il confine: il mirror TS e la sua fixture
// (`tests/ts_mirror_app.rs`) restano legati al lato che li serializza.
pub use fubmd_host::{EmbedContent, VaultInfo, WorkspaceMeta};

/// Il ponte eventi verso il webview: l'unica implementazione di [`EventSink`]
/// che ha bisogno di Tauri, ed è per questo che sta qui e non nell'host.
///
/// L'handle arriva in ritardo, e la `OnceLock` è quel ritardo reso esplicito.
/// L'ordine di Tauri è: costruzione → finestre della configurazione → `setup`,
/// e l'`AppHandle` esiste solo dall'ultimo passo. Ma lo stato gestito va
/// dichiarato al **primo**, o una `invoke` che arrivasse da una finestra già
/// aperta troverebbe `State<Host>` non gestito — che in Tauri è un panico, non
/// un errore. Quindi l'host si registra subito con questo sink vuoto, e il
/// `setup` ci mette dentro l'handle: nel frattempo un evento si perde invece di
/// far cadere l'app, e nel frattempo non c'è nessun vault aperto che possa
/// emetterne.
#[derive(Default)]
struct WebviewEvents(std::sync::OnceLock<AppHandle>);

impl EventSink for WebviewEvents {
    fn emit(&self, notice: &Notice) {
        if let Some(app) = self.0.get() {
            let _ = app.emit("fubmd://event", notice);
        }
    }
}

#[tauri::command]
fn open_vault(host: State<Host>, path: String) -> Result<VaultInfo, String> {
    host.open(&Utf8PathBuf::from(path))
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot):
/// il frontend lo legge e apre il vault senza passare dal dialog.
#[tauri::command]
fn initial_vault() -> Option<String> {
    fubmd_host::initial_vault()
}

#[tauri::command]
fn list_documents(host: State<Host>) -> Result<Vec<String>, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    Ok(ws.documents().into_iter().map(|d| d.0).collect())
}

#[tauri::command]
fn read_document(host: State<Host>, id: String) -> Result<String, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    ws.read_source(&doc_id(&id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_document(host: State<Host>, id: String, source: String) -> Result<(), String> {
    let ws = host.workspace()?;
    let mut ws = ws.lock().unwrap();
    ws.write_document(&doc_id(&id)?, &source)
        .map_err(|e| e.to_string())
}

// Le cinque azioni STRUTTURALI — crea, rinomina, cestina, ripristina, svuota —
// non sono più comandi Tauri: sono comandi del registro (decisione 0009), serviti da
// `CoreCommands` attraverso le capacità della decisione 0013, e la shell li invoca con
// `invoke_command` come li invocherebbe una CLI o un plugin.
//
// È ciò che rende vera la regola del §16.6 — "una feature nuova non deve poter
// aggiungere un comando Tauri" — che finché quelle cinque stavano qui valeva
// solo per le feature che non toccano il vault.
//
// Restano le due LETTURE del giro, e resta la stessa linea a dividerle: un
// `CommandOutcome` porta un messaggio e un effetto, non dati. Ciò che risponde
// con dei dati si chiede al canale di lettura, come i documenti, i tag e i
// backlink — anche quando i dati riguardano il cestino, e anche quando la
// risposta è un nome.

#[tauri::command]
fn list_trash(host: State<Host>) -> Result<Vec<TrashEntry>, String> {
    let ws = host.workspace()?;
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
fn propose_free_name(host: State<Host>, id: String) -> Result<String, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    Ok(ws.free_name(&DocId::new(id)).0)
}

/// Contenuto di un embed `![[page#heading]]`: il frontend lo innesta nel
/// placeholder emesso dal provider (profondità massima e cicli a suo carico).
#[tauri::command]
fn render_embed(
    host: State<Host>,
    page: String,
    heading: Option<String>,
) -> Result<EmbedContent, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    let (doc_id, content) = ws
        .render_embed(&page, heading.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(EmbedContent {
        doc_id: doc_id.0,
        content,
    })
}

#[tauri::command]
fn render_preview(host: State<Host>, id: String) -> Result<RenderedDocument, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    ws.render_preview(&DocId::new(id))
        .map_err(|e| e.to_string())
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
/// cambio di modalità; le view lo leggono via `HostEnv::active_context`.
///
/// Restituisce **gli id delle view da ridisegnare** — quelle la cui
/// `ViewSpec.follows` interseca ciò che è cambiato. Il conto lo fa il kernel e
/// non la shell perché la regola deve essere una sola: la shell sa *quando*
/// pubblicare, non *chi* segue cosa. `None` = nessun pannello (all'avvio, o
/// dopo che l'ultima nota è stata chiusa).
#[tauri::command]
fn set_active_context(
    host: State<Host>,
    context: Option<ViewContext>,
) -> Result<Vec<String>, String> {
    let ws = host.workspace()?;
    let mut ws = ws.lock().unwrap();
    Ok(ws.set_active_context(context))
}

/// Le view offerte dai provider registrati, nell'ordine di registrazione.
///
/// È la metà "discovery" del protocollo: la shell non cabla gli id — monta
/// ogni view nel contenitore del suo `placement` e la ridisegna quando arriva
/// un evento della sua maschera `refresh`. Una view di plugin compare da sola.
#[tauri::command]
fn list_views(host: State<Host>) -> Result<Vec<ViewSpec>, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    Ok(ws.views())
}

/// Rende l'albero `UiNode` di **un'istanza** di view. Il render è una lettura:
/// prende il workspace in prestito condiviso, non in esclusiva.
///
/// L'istanza arriva dalla shell, che è chi apre: `instance` la distingue dalle
/// sorelle e `params` sono i suoi argomenti (§2.3). Per la view che la shell
/// monta da sé — una sola, senza parametri — è
/// [`ViewInstance::only`](fubmd_abi::traits::ViewInstance::only), e questo
/// comando accetta i due campi assenti proprio per non obbligarla a costruirla.
#[tauri::command]
fn render_view(
    host: State<Host>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
) -> Result<UiNode, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    ws.render_view(&istanza(view, instance, params))
        .map_err(|e| e.to_string())
}

/// Consegna un'azione della UI al provider della view e restituisce il suo
/// aggiornamento (`Replace`/`Patch`/`Navigate`/`None`), che il frontend
/// interpreta.
///
/// `payload` è ciò che il provider aveva attaccato al nodo; `fields` è lo stato
/// dei campi di input che la shell ha raccolto. Sono due cose con due
/// proprietari (§2.7), e il fatto che arrivino come due argomenti distinti è
/// ciò che impedisce alla shell di riscrivere il primo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn view_action(
    host: State<Host>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    action: String,
    payload: Option<serde_json::Value>,
    fields: Option<Vec<FieldValue>>,
) -> Result<ViewUpdate, String> {
    let ws = host.workspace()?;
    let mut ws = ws.lock().unwrap();
    ws.view_action(
        &istanza(view, instance, params),
        UiAction {
            action: ActionId(action),
            payload: payload.unwrap_or(serde_json::Value::Null),
            fields: fields.unwrap_or_default(),
        },
    )
    .map_err(|e| e.to_string())
}

/// L'istanza che la shell nomina, con i due default dell'esemplare unico.
fn istanza(
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
) -> ViewInstance {
    ViewInstance {
        instance: instance.unwrap_or_else(|| view.clone()),
        view,
        params: params.unwrap_or(serde_json::Value::Null),
    }
}

// --- comandi (protocollo generico) -----------------------------------------
//
// L'altro giro discovery+invoke accanto a quello delle view, e la ragione per
// cui questo file non deve più crescere di un comando Tauri per feature (§16.6):
// un'azione nuova si dichiara in un `CommandProvider` e arriva alla palette da
// sola, con i suoi parametri e il suo raggio.

/// I comandi offerti dai provider registrati.
///
/// La shell non ne cabla nessuno: disegna ciò che legge, chiede i parametri che
/// la spec dichiara e decide se chiedere conferma dal raggio dichiarato. Sono
/// le stesse informazioni che leggerebbero una CLI (27.1) o un chiamante
/// programmatico (22.4) — questo comando IPC è solo il primo dei suoi clienti.
#[tauri::command]
fn list_commands(host: State<Host>) -> Result<Vec<CommandSpec>, String> {
    let ws = host.workspace()?;
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
    host: State<Host>,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
) -> Result<CommandOutcome, String> {
    let ws = host.workspace()?;
    let mut ws = ws.lock().unwrap();
    ws.invoke_command(
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
        Actor::User,
    )
    .map_err(|e| e.to_string())
}

/// Il canale dati, **generico**: il gemello di `render_view`/`view_action`.
///
/// Erano quattro comandi — `search`, `list_tags`, `graph_data` e `backlinks` —
/// e i primi tre avvolgevano lo stesso `query_index` mentre il quarto lo
/// **scavalcava**, chiamando il grafo del kernel diretto. Il problema non era la
/// ripetizione: era che un provider può fare qualunque query e la shell no, e
/// che ogni variante nuova del canale dati avrebbe richiesto un comando in più.
///
/// Con questo comando la shell ha le stesse capacità di un plugin: il grafo
/// smette di avere un canale privilegiato, i backlink smettono di avere il
/// proprio, e la dieta dell'IPC (§16.6) diventa praticabile — un'allowlist che
/// vieta i comandi bespoke non deve più dire di no a feature che non hanno altra
/// strada.
#[tauri::command]
fn query_index(host: State<Host>, query: IndexQuery) -> Result<IndexResult, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    ws.query_index(query).map_err(|e| e.to_string())
}

// --- versioning ------------------------------------------------------------
//
// Il kernel non sa che il versioning esiste, e comporre le due metà — lo store
// e l'handler registrato — è lavoro dell'host: qui restano le tre firme IPC.

#[tauri::command]
fn list_versions(host: State<Host>, id: String) -> Result<Vec<VersionRef>, String> {
    host.list_versions(&DocId::new(id))
}

#[tauri::command]
fn read_version(host: State<Host>, id: String, ts: u64) -> Result<String, String> {
    host.read_version(&DocId::new(id), ts)
}

#[tauri::command]
fn restore_version(host: State<Host>, id: String, ts: u64) -> Result<(), String> {
    host.restore_version(&DocId::new(id), ts)
}

// --- organizzazione del vault ----------------------------------------------
//
// Il sidecar `.fubmd/workspace.json` è stato del vault e vive nell'host; qui
// restano le due firme IPC.

#[tauri::command]
fn read_workspace_meta(host: State<Host>) -> Result<WorkspaceMeta, String> {
    host.read_meta()
}

#[tauri::command]
fn write_workspace_meta(host: State<Host>, meta: WorkspaceMeta) -> Result<(), String> {
    host.write_meta(&meta)
}

#[tauri::command]
fn resolve_link(host: State<Host>, page: String) -> Result<Option<String>, String> {
    let ws = host.workspace()?;
    let ws = ws.lock().unwrap();
    Ok(ws.resolve_link(&page).map(|d| d.0))
}

pub fn run() {
    // Il sink è un parametro del montaggio, quindi l'host si costruisce qui e
    // non nel `setup`; l'handle che gli manca ce lo mette il `setup` (vedi
    // `WebviewEvents`).
    let sink = Arc::new(WebviewEvents::default());
    let bridge = sink.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Host::new().with_sink(sink))
        .setup(move |app| {
            let _ = bridge.0.set(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            initial_vault,
            list_documents,
            read_document,
            write_document,
            list_trash,
            propose_free_name,
            render_preview,
            render_embed,
            set_active_context,
            list_views,
            render_view,
            view_action,
            list_commands,
            invoke_command,
            query_index,
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
