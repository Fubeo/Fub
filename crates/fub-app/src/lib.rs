//! Colla Tauri v2 di Fub: comandi IPC, ponte eventi verso il webview,
//! finestre e dialoghi.
//!
//! **Chi monta non è qui.** Registro dei formati, feature ufficiali, indice di
//! ricerca, versioning, view, comandi, sintassi, renderer, sessione e watcher
//! stanno in [`fub_host`], che non dipende da tauri: quel montaggio ha cinque
//! clienti previsti — CLI (27.1), API locale (27.2), e2e headless (17.2 e
//! 27.4), mobile (26.2) e PWA (26.3) — e finché viveva dentro
//! `#[tauri::command] open_vault` nessuno di loro poteva riusarlo (§8.2,
//! decisione 0023).
//!
//! Ciò che resta in questo file è **solo** ciò che non esiste senza un webview:
//! le firme `#[tauri::command]`, il ponte che inoltra gli eventi del kernel a
//! `fub://event`, e `run()`. Se una riga di questo file può essere spiegata
//! senza nominare Tauri, sta nel posto sbagliato.
//!
//! **Gli errori non si traducono più qui** (§12.2). Fino a questa seduta ogni
//! firma era `Result<_, String>` e dodici `map_err(|e| e.to_string())`
//! buttavano via il tipo sul confine: al frontend arrivava una frase italiana,
//! e l'unico modo di distinguere «esiste già» da «disco pieno» era cercarci
//! dentro una sottostringa — che `apps/client/src/panels/trash.ts` non faceva
//! nemmeno, intercettando con un `catch` nudo qualunque fallimento e chiedendo
//! sempre la stessa cosa. Adesso passa un [`PluginError`], che è serializzabile
//! e **discriminabile**: `{"kind": "already_exists", "message": …}`.

use std::collections::BTreeMap;
use std::io::Read;
use std::io::Write;
use std::sync::Arc;

use camino::Utf8Path;
use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::format::SourceKind;
use fub_abi::grid::{
    GridApplyRequest, GridCommit, GridSession, GridSurfaceSpec, GridWindow, GridWindowRequest,
};
use fub_abi::locale::Locale;
use fub_abi::session::ViewContext;
use fub_abi::settings::{SettingScope, SettingValue};
use fub_abi::theme::ThemeLight;
use fub_abi::traits::{IndexQuery, IndexResult, JobId, ViewInstance, ViewSpec};
use fub_abi::ui::{ActionId, FieldValue, UiAction, UiNode, ViewUpdate};
use fub_abi::{Notice, PluginError};
use fub_host::{doc_id, Delivery, EventSink, Host};
use fub_wasm_host::catalog::{CatalogEntry, CatalogError, CatalogTrust, SignedFeed};
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::{InstalledOperation, InstalledPluginManager, InstalledShutdown};
use tauri::{AppHandle, Emitter, Manager, State};

// I tre record che attraversano l'IPC vivono nell'host — un'API locale
// risponderebbe con gli stessi — e l'app li ri-esporta, perché è lei a farli
// attraversare il confine: il mirror TS e la sua fixture
// (`tests/ts_mirror_app.rs`) restano legati al lato che li serializza.
pub use fub_host::{
    BundleInfo, EmbedContent, ThemeInfo, ThemePayload, UnreadDoc, VaultEntry, VaultInfo,
};
pub use fub_wasm_host::managed::InstalledPluginInfo;
mod document_windows;
mod frame_rate;
mod mobile;
mod resources;
mod support;
mod web_viewer;
pub use support::DemoClosed;
/// Adattatore OS per `fub://` (P13): thin sopra `fub_host::automation`.
pub mod uri;

/// I vault aperti e quale è il corrente (§9.6): rispecchiato da `OpenVaults` in
/// `apps/client/src/host/contract.ts`.
///
/// Il "corrente" è una comodità della shell e non un'assunzione del backend:
/// serve a chi non nomina un vault, e chi ne ha due davanti li nomina.
#[derive(serde::Serialize)]
pub struct OpenVaults {
    pub roots: Vec<String>,
    pub current: Option<String>,
}

enum InstalledAvailability {
    Ready(Arc<InstalledPluginManager>),
    NotConfigured,
    Failed(PluginError),
}

struct InstalledPlugins {
    availability: InstalledAvailability,
}

impl InstalledPlugins {
    fn new(availability: InstalledAvailability) -> Self {
        Self { availability }
    }

    fn manager(&self) -> Result<Arc<InstalledPluginManager>, PluginError> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => Ok(manager.clone()),
            InstalledAvailability::NotConfigured => Err(PluginError::Unserved(
                "installed plugin storage is unavailable without a machine configuration path"
                    .into(),
            )),
            InstalledAvailability::Failed(error) => Err(error.clone()),
        }
    }

    fn manager_for_legacy(&self) -> Option<Arc<InstalledPluginManager>> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => Some(manager.clone()),
            InstalledAvailability::NotConfigured | InstalledAvailability::Failed(_) => None,
        }
    }

    fn begin_shutdown(&self) -> Result<Option<InstalledShutdown>, PluginError> {
        match &self.availability {
            InstalledAvailability::Ready(manager) => manager.begin_shutdown().map(Some),
            InstalledAvailability::NotConfigured | InstalledAvailability::Failed(_) => Ok(None),
        }
    }
}

async fn run_installed<T, F>(app: AppHandle, action: F) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&InstalledOperation, &Host) -> Result<T, PluginError> + Send + 'static,
{
    let installed = app.state::<InstalledPlugins>();
    let manager = installed.manager()?;
    let operation = manager.begin_operation()?;

    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        action(&operation, &host)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(
            format!("installed plugin operation did not complete: {error}").into(),
        )
    })?
}

/// Catalog trust is selected only by the machine's configuration directory.
/// No IPC argument names a key, feed, trust path, or remote endpoint.
struct CatalogConfig(Option<Utf8PathBuf>);

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct MachineCatalogTrust {
    keys: BTreeMap<String, String>,
    min_generation: String,
}

/// L'errore dell'host come lo legge la shell: nella sua lingua. Dentro l'host
/// un errore può restare una chiave del catalogo del core, e sul filo JSON una
/// chiave non risolta è un oggetto, non una frase
/// ([`Host::localized_error`]).
pub(crate) fn for_the_shell<T>(
    host: &Host,
    vault: Option<&str>,
    result: Result<T, PluginError>,
) -> Result<T, PluginError> {
    result.map_err(|error| host.localized_error(vault, error))
}

fn bounded_config(path: &Utf8Path, limit: u64) -> Result<Vec<u8>, PluginError> {
    let file = std::fs::File::open(path).map_err(|error| {
        PluginError::Io(format!("catalog machine configuration unreadable: {error}").into())
    })?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            PluginError::Io(format!("catalog machine configuration unreadable: {error}").into())
        })?;
    if bytes.len() as u64 > limit {
        return Err(PluginError::BadArgs(
            "catalog configuration exceeds its size limit".into(),
        ));
    }
    Ok(bytes)
}

fn machine_catalog(config: Option<&Utf8Path>) -> Result<(CatalogTrust, SignedFeed), PluginError> {
    let dir =
        config.ok_or_else(|| PluginError::Unserved("catalog trust is not configured".into()))?;
    let trust_path = dir.join("catalog-trust.json");
    let bytes = match bounded_config(&trust_path, 64 * 1024) {
        Err(PluginError::Io(_)) if !trust_path.exists() => {
            return Err(PluginError::Unserved(
                "catalog trust is not configured".into(),
            ));
        }
        other => other?,
    };
    let configured: MachineCatalogTrust = serde_json::from_slice(&bytes).map_err(|error| {
        PluginError::BadArgs(format!("invalid machine catalog trust: {error}").into())
    })?;
    if configured.keys.is_empty() {
        return Err(PluginError::Unserved(
            "catalog trust has no configured keys".into(),
        ));
    }
    let min_generation = parse_installation(&configured.min_generation)?;
    let mut trust = CatalogTrust {
        min_generation,
        ..CatalogTrust::default()
    };
    for (id, key) in configured.keys {
        trust = trust.with_key(id, &key).map_err(catalog_error)?;
    }
    // Acquisition is local and explicit: the operator provisions this file,
    // and a catalog_* command reads it. Never fetch a feed on startup.
    let feed_path = dir.join("catalog-feed.json");
    let feed: SignedFeed = serde_json::from_slice(&bounded_config(&feed_path, 4 * 1024 * 1024)?)
        .map_err(|error| {
            PluginError::BadArgs(format!("invalid signed catalog feed: {error}").into())
        })?;
    Ok((trust, feed))
}

fn catalog_error(error: CatalogError) -> PluginError {
    match error {
        CatalogError::Manager(error) => error,
        CatalogError::Signature(message) => PluginError::PermissionDenied(message.into()),
        CatalogError::Stale(message) | CatalogError::Integrity(message) => {
            PluginError::Conflict(message.into())
        }
        CatalogError::Unavailable(message) => PluginError::Unserved(message.into()),
        CatalogError::Invalid(message) | CatalogError::Unreadable(message) => {
            PluginError::BadArgs(message.into())
        }
        CatalogError::Io(error) => PluginError::Io(error.to_string().into()),
        CatalogError::Store(error) => PluginError::Io(error.to_string().into()),
        CatalogError::Theme(error) => PluginError::Io(error.to_string().into()),
    }
}

async fn run_catalog<T, F>(app: AppHandle, action: F) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(
            &InstalledPluginManager,
            &Host,
            &CatalogTrust,
            &SignedFeed,
            u64,
        ) -> Result<T, CatalogError>
        + Send
        + 'static,
{
    let manager = app.state::<InstalledPlugins>().manager()?;
    let dir = app.state::<CatalogConfig>().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (trust, feed) = machine_catalog(dir.as_deref())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| {
                PluginError::Internal(format!("invalid system clock: {error}").into())
            })?
            .as_millis()
            .try_into()
            .map_err(|_| {
                PluginError::Internal("system clock exceeds catalog timestamp range".into())
            })?;
        action(&manager, &app.state::<Host>(), &trust, &feed, now).map_err(catalog_error)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(format!("catalog operation did not complete: {error}").into())
    })?
}

/// Il ponte eventi verso il webview: l'unica implementazione di [`EventSink`]
/// che ha bisogno di Tauri, ed è per questo che sta qui e non nell'host.
///
/// L'handle arriva in ritardo, e la `OnceLock` è quel ritardo reso esplicito.
/// L'ordine di Tauri è: costruzione → finestre della configurazione → `setup`,
/// e l'`AppHandle` esiste solo dall'ultimo passo. Ma lo stato gestito va
/// dichiarato al **primo**, o una `invoke` che arrivasse da una finestra già
/// aperta troverebbe `State<Host>` non gestito — che in Tauri è un panico, non
/// un errore. Quindi l'host si registra subito con questo sink vuoto, e il
/// `setup` ci mette dentro l'handle.
///
/// **Ciò che succede in quella finestra adesso si dice.** Prima erano due rami
/// vuoti — `if let Some(app)` senza `else`, e un `let _ =` sulla consegna — e
/// due rami vuoti sono la stessa frase: *l'evento non è uscito, e nessuno lo
/// saprà*. Il commento che stava qui diceva che nella finestra non c'è nessun
/// vault aperto che possa emettere, ed è probabilmente vero oggi; ma «probabile»
/// è un argomento, non un presidio, e la seconda strada — una consegna che torna
/// con un errore — non ha nemmeno quell'argomento. Adesso tutte e due rendono
/// [`Consegna::Persa`], il ponte le conta, e chi riceve prende un `Overflow`
/// appena l'uscita torna a funzionare.
#[derive(Default)]
struct WebviewEvents(std::sync::OnceLock<AppHandle>);

impl EventSink for WebviewEvents {
    fn emit(&self, notice: &Notice) -> Delivery {
        let Some(app) = self.0.get() else {
            tracing::warn!(
                target: "fub.app",
                event = ?notice.kind(),
                "an event was born before the webview existed: nobody will see it, \
                 and subscribers will get an Overflow as soon as the exit opens"
            );
            return Delivery::Dropped;
        };
        // Events can contain vault data: never broadcast them to a document
        // surface or a remote viewer. The main webview is the only host.
        match app.emit_to("main", "fub://event", notice) {
            Ok(()) => Delivery::Done,
            Err(and) => {
                // Un notice che non attraversa l'IPC è un **bug del programma**,
                // non un guasto d'ambiente: la forma è nostra, e `Event::Custom`
                // porta un `serde_json::Value`, che si serializza sempre. Per
                // questo non è un `expect`, che trasformerebbe il bug di un
                // plugin in un'app che cade, e non è un ramo vuoto, che lo
                // trasformerebbe in una shell ferma senza motivo: si dice, e si
                // conta.
                tracing::error!(
                    target: "fub.app",
                    event = ?notice.kind(),
                    error = %and,
                    "an event did not cross the IPC: the receiver falls behind by \
                     this fact and will reconcile on the next successful delivery"
                );
                Delivery::Dropped
            }
        }
    }
}

#[tauri::command]
fn open_vault(app: AppHandle, host: State<Host>, path: String) -> Result<VaultInfo, PluginError> {
    // Su mobile si monta soltanto il vault privato, che il backend risolve da
    // sé nella sandbox; una cartella condivisa chiede un grant verificato.
    #[cfg(mobile)]
    return for_the_shell(
        &host,
        None,
        mobile::open_private_vault(&host, mobile::private_vault_root(&app).as_deref(), &path),
    );
    // Il lock di scrittura fra processi lo prende l'host aprendo, e lo lascia
    // chiudendo: qui non c'è niente da tenere. Un altro scrittore è un
    // conflitto con la sua chiave, che la shell legge come frase.
    #[cfg(not(mobile))]
    {
        let _ = app;
        for_the_shell(&host, None, host.open(Utf8Path::new(&path)))
    }
}

// --- i vault aperti (§9.6) -------------------------------------------------
//
// L'host tiene una **mappa** di sessioni e sa qual è la corrente: ogni comando
// qui sotto accetta un `vault` opzionale, e chi non lo passa parla con la
// corrente — che è ciò che la shell fa oggi, con una finestra sola. I tre
// comandi che seguono sono il minimo che serve a chi vorrà fare altrimenti: sapere
// quali sono aperti, sceglierne uno, e chiuderne uno senza chiudere l'app.

/// I vault aperti, e quale è il corrente.
#[tauri::command]
fn list_vaults(host: State<Host>) -> OpenVaults {
    OpenVaults {
        roots: host.vaults().into_iter().map(|r| r.to_string()).collect(),
        current: host.current().map(|r| r.to_string()),
    }
}

/// Rende corrente un vault già aperto. Aprirne uno nuovo lo fa `open_vault`,
/// che lo rende corrente da sé.
#[tauri::command]
fn set_current_vault(host: State<Host>, path: String) -> Result<(), PluginError> {
    host.set_current(&Utf8PathBuf::from(path))
}

/// Chiude un vault: flush, `close` degli indici, disattivazione dei plugin
/// (§9.5). Restituisce **ciò che è andato storto chiudendo**, che non è un
/// motivo per non chiudere: la lista è quasi sempre vuota, e quando non lo è
/// dice cosa non è diventato durevole — **con la specie di ciascuno**, come
/// ogni altro errore che esce di qui (decisione 0041): una lista di frasi
/// avrebbe fatto la stessa figura a schermo e tolto alla shell l'unica cosa su
/// cui può ramificare.
/// Una finestra documento attiva trattiene quel vault: chiuderlo prima della
/// conferma di distruzione nativa perderebbe la sessione autorevole.
#[tauri::command]
fn close_vault(
    host: State<Host>,
    windows: State<document_windows::DocumentWindows>,
    path: String,
) -> Result<Vec<PluginError>, PluginError> {
    document_windows::close_vault(&host, &windows, &path)
}

/// Path del vault da aprire all'avvio: l'override di ambiente (`FUB_VAULT`)
/// se non vuoto, altrimenti l'ultimo vault aperto ancora sul disco. Il
/// frontend lo legge e apre il vault senza passare dal dialogo. Su mobile è il
/// vault privato, se è la scelta salvata.
#[tauri::command]
fn initial_vault(app: AppHandle, host: State<Host>) -> Option<String> {
    #[cfg(mobile)]
    {
        let _ = host;
        mobile::initial_private_vault(&app)
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        fub_host::initial_vault().or_else(|| host.last_vault())
    }
}

/// **L'avviso di sessione** (§25.5): la diagnosi «la cartella di configurazione
/// non si può scrivere» (o non c'è), come `Event::Trouble` di severità
/// `Warning`, una volta per sessione.
///
/// È un **tiraggio** e non una spinta all'avvio: quando la diagnosi nasce
/// (`install_logging`) non esiste ancora né l'handle del webview né il ponte —
/// che parte al primo vault aperto — né l'ascoltatore della shell. Una spinta
/// a quell'ora sarebbe emessa nel vuoto e persa in silenzio; un comando chiesto
/// dalla shell dopo che il router è attaccato è l'unico istante in cui la
/// consegna è garantita dall'ordine dell'IPC. Il secondo chiamante (un test, un
/// altro frontend) trova la risposta già consumata: `None`.
#[tauri::command]
fn session_notice(host: State<Host>) -> Option<fub_abi::Notice> {
    host.session_notice()
}

// `list_documents` **non è più un comando** (§14.4). Era l'ultimo dato che la
// shell chiedeva fuori da `IndexQuery`, e la finestra che il contratto ha dal
// §5.5 questo confine non l'ha mai usata: restituiva l'intero vault in un
// `Vec<String>`, e chi disegnava venti righe ne riceveva diecimila. Chi vuole
// l'elenco lo chiede con `IndexQuery::Entries`, che la specie la sceglie e la
// pagina la taglia — e per cartella, che è ciò che serve a un albero.
//
// La **capacità** omonima resta dov'era (`VaultRead::list_documents`): quella
// la `Page` la prende, ed è l'elenco dei plugin, non quello della shell.

/// Il sorgente di un documento, la revisione che lo nomina e i metadati con
/// cui la shell sceglie la superficie (§18.1, §11.4): rispecchiato da
/// `DocumentSource` in `apps/client/src/host/contract.ts`.
///
/// Viaggiano **insieme**: chi apre il documento deve sia salvarlo contro la
/// revisione letta, sia montare la superficie dichiarata dal registro dei
/// formati. Separarli in più porte aggiungerebbe un viaggio IPC e potrebbe
/// associare al buffer metadati letti dopo un cambio di registro.
#[derive(serde::Serialize)]
pub struct DocumentSource {
    pub text: String,
    pub revision: String,
    pub format_id: Option<String>,
    pub source_kind: SourceKind,
}

#[tauri::command]
fn read_document(
    host: State<Host>,
    id: String,
    vault: Option<String>,
) -> Result<DocumentSource, PluginError> {
    let id = doc_id(&id)?;
    let (text, revision, format) = host.read_document_with_format(vault.as_deref(), &id)?;
    let format_id = format.as_ref().map(|known| known.descriptor.id.clone());
    let source_kind = format
        .map(|known| known.descriptor.source)
        .unwrap_or(SourceKind::Text);
    Ok(DocumentSource {
        text,
        revision: revision.0,
        format_id,
        source_kind,
    })
}

/// Apre un lease sui byte di una risorsa. Il label e l'origin provengono dalla
/// finestra nativa, non dagli argomenti JavaScript.
#[tauri::command]
fn resource_open(
    host: State<Host>,
    window: tauri::WebviewWindow,
    id: String,
    vault: Option<String>,
) -> Result<fub_host::resources::ResourceDescriptor, PluginError> {
    let origin = window.url().map_err(|and| {
        PluginError::Internal(format!("resource window URL unavailable: {and}").into())
    })?;
    resources::resource_open_cmd(
        &*host,
        window.label(),
        origin.as_str(),
        &id,
        vault.as_deref(),
    )
}

/// Serve un chunk come corpo IPC binario, senza array JSON o base64.
#[tauri::command]
fn resource_read_chunk(
    host: State<Host>,
    window: tauri::WebviewWindow,
    handle: fub_host::resources::ResourceHandle,
    offset: u64,
    len: u32,
) -> Result<tauri::ipc::Response, PluginError> {
    let origin = window.url().map_err(|and| {
        PluginError::Internal(format!("resource window URL unavailable: {and}").into())
    })?;
    resources::resource_read_chunk_cmd(&*host, window.label(), origin.as_str(), handle, offset, len)
}

/// Rilascia il lease; la chiusura ripetuta resta idempotente.
#[tauri::command]
fn resource_close(
    host: State<Host>,
    window: tauri::WebviewWindow,
    handle: fub_host::resources::ResourceHandle,
) -> Result<(), PluginError> {
    let origin = window.url().map_err(|and| {
        PluginError::Internal(format!("resource window URL unavailable: {and}").into())
    })?;
    resources::resource_close_cmd(&*host, window.label(), origin.as_str(), handle)
}
/// Binary IPC body; metadata lives only in the bounded, strict header.
#[tauri::command]
fn resource_write(
    host: State<Host>,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<fub_host::resources::ResourceWriteReceipt, PluginError> {
    let origin = window.url().map_err(|error| {
        PluginError::Internal(format!("resource window URL unavailable: {error}").into())
    })?;
    let bytes = resources::resource_write_body(&request)?;
    resources::resource_write_cmd(
        &*host,
        window.label(),
        origin.as_str(),
        request.headers(),
        bytes,
    )
}

struct ViewerConfig(Option<Utf8PathBuf>);

#[tauri::command]
async fn viewer_open(
    app: AppHandle,
    window: tauri::WebviewWindow,
    config: State<'_, ViewerConfig>,
    open: web_viewer::ViewerOpen,
) -> Result<String, PluginError> {
    let dir = config.0.clone().ok_or_else(|| {
        PluginError::Unserved("viewer profile requires a machine configuration directory".into())
    })?;
    // Il loader pdf.js atteso dalla shell resta quello in bundle locale, mai una fetch remota.
    let _loader = resources::make_pdf_loader();
    resources::open_viewer(app, window, open, dir).await
}

#[tauri::command]
async fn viewer_save(
    host: State<'_, Host>,
    window: tauri::WebviewWindow,
    url: String,
    title: String,
    allowlist: Vec<String>,
    vault: Option<String>,
    attachment_folder: String,
) -> Result<fub_host::resources::ResourceWriteReceipt, PluginError> {
    let origin = window.url().map_err(|error| {
        PluginError::Internal(format!("viewer window URL unavailable: {error}").into())
    })?;
    // Il filo verso fuori è quello dell'host: lo stesso che i workspace
    // montati usano, e lo stesso che un banco sostituisce.
    let network = host.network().ok_or_else(|| {
        PluginError::Unserved("this host has no network client for the viewer".into())
    })?;
    resources::viewer_save(
        &*host,
        &*network,
        window.label(),
        origin.as_str(),
        &url,
        &title,
        &allowlist,
        vault.as_deref(),
        &attachment_folder,
    )
    .await
}

/// Superfici grid dichiarate dai provider montati. La shell negozia famiglia e
/// versione prima di aprire una sessione.
#[tauri::command]
fn list_grid_surfaces(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<GridSurfaceSpec>, PluginError> {
    host.grid_surfaces(vault.as_deref())
}

#[tauri::command]
fn open_grid(
    host: State<Host>,
    surface: String,
    source: String,
    revision: String,
    vault: Option<String>,
) -> Result<GridSession, PluginError> {
    host.grid_open(vault.as_deref(), &surface, &source, Revision(revision))
}

#[tauri::command]
fn grid_window(
    host: State<Host>,
    surface: String,
    instance: String,
    request: GridWindowRequest,
    vault: Option<String>,
) -> Result<GridWindow, PluginError> {
    host.grid_window(vault.as_deref(), &surface, &instance, request)
}

#[tauri::command]
fn apply_grid(
    host: State<Host>,
    surface: String,
    instance: String,
    request: GridApplyRequest,
    vault: Option<String>,
) -> Result<GridCommit, PluginError> {
    host.grid_apply(vault.as_deref(), &surface, &instance, request)
}

#[tauri::command]
fn reload_grid(
    host: State<Host>,
    surface: String,
    instance: String,
    source: String,
    revision: String,
    vault: Option<String>,
) -> Result<GridSession, PluginError> {
    host.grid_reload(
        vault.as_deref(),
        &surface,
        &instance,
        Revision(revision),
        &source,
        Revision::of(&source),
    )
}

#[tauri::command]
fn close_grid(
    host: State<Host>,
    surface: String,
    instance: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.grid_close(vault.as_deref(), &surface, &instance)
}

/// **Scrive un documento intero** dichiarando da cosa parte (§18.1, §23.11).
///
/// `base` non è opzionale, e non è una svista: un campo mancante qui è un errore
/// di deserializzazione, cioè la shell che ha dimenticato di dichiarare non
/// scrive di nascosto — smette di scrivere, e lo si vede al primo salvataggio.
/// Fino alla decisione 0092 era un `Option<String>` col default `null`, e il
/// default voleva dire «sovrascrivi comunque»: la guardia si perdeva
/// **omettendola**, che è il modo in cui una guardia non protegge nessuno.
#[tauri::command]
fn write_document(
    host: State<Host>,
    id: String,
    source: String,
    base: WriteBase,
    vault: Option<String>,
) -> Result<String, PluginError> {
    host.write_document(vault.as_deref(), &doc_id(&id)?, &source, base)
        .map(|revision| revision.0)
}

/// **Scrive la bozza di un documento** (§15.2): ciò che c'è nel buffer adesso.
///
/// Una porta e non un comando del registro, ed è la sola riga di questo file
/// dove l'assenza di una capacità è **voluta per sempre** invece che in attesa
/// di un cliente: il testo non ancora salvato è il dato più privato che un vault
/// contenga, e una `draft_write` sull'`HostApi` lo darebbe a ogni plugin
/// montato. La shell non è un plugin, e questa è la sua porta.
///
/// `base` è la revisione del file su cui il buffer sta lavorando — assente per
/// una nota mai salvata — e la manda **chi ha il buffer**, perché è l'unico a
/// sapere da quale lettura quel testo si è discostato.
#[tauri::command]
fn save_draft(
    host: State<Host>,
    id: String,
    text: String,
    base: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.save_draft(
        vault.as_deref(),
        &doc_id(&id)?,
        &text,
        base.map(Revision::new),
    )
}

/// **Butta la bozza di un documento**: il buffer è tornato pulito, o l'utente ha
/// scelto di scartare ciò che aveva recuperato.
#[tauri::command]
fn discard_draft(host: State<Host>, id: String, vault: Option<String>) -> Result<(), PluginError> {
    host.discard_draft(vault.as_deref(), &doc_id(&id)?)
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
// E adesso non restano nemmeno le due LETTURE che il giro si era tenuto —
// `list_trash` e `propose_free_name`. Non sono state migrate: sono rimaste
// **senza chiamante**. Le chiedeva il pannello cestino di questa shell, che dal
// §1.2 è un `ViewProvider` e le chiede dall'altro lato del confine, dove sono
// due capacità del contratto (`VaultRead::list_trash`, `VaultRead::free_name`)
// e non due porte. Una porta che nessuno attraversa è una promessa che nessuno
// mantiene: il modo giusto di reggerla è toglierla, e rimetterla il giorno che
// qualcuno di qua abbia di nuovo quella domanda.

// `render_preview` e `render_embed` (0163) non sono più qui: sono passati al
// canale dati (`query_index` con `IndexQuery::RenderPreview` /
// `IndexQuery::RenderEmbed`), come l'outline e ogni altra lettura. Un fatto
// sul vault che solo la shell sapeva chiedere è adesso una domanda del canale
// di tutti — un `ViewProvider` che volesse mostrare un documento reso ce l'ha,
// e la shell non è più l'unica.

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
    vault: Option<String>,
) -> Result<Vec<String>, PluginError> {
    host.set_active_context(vault.as_deref(), context)
}

/// La shell riporta cosa il **sistema** dice: lingua, fuso, calendario (§12.3).
///
/// Lo pubblica la webview perché è l'unica che lo sappia davvero — `Intl` porta
/// un ICU intero, il lato Rust avrebbe bisogno di un database dei fusi orari per
/// dare una risposta peggiore — e lo pubblica **una volta per tutti i vault**:
/// la lingua di chi guarda non è di un vault, a differenza del contesto di
/// pannello qui sopra. Ciò che l'utente ha scelto nelle chiavi `locale.*` sta
/// sopra a questo, e le due cose le compone il kernel.
///
/// Restituisce `true` se qualcosa è cambiato: la shell ridisegna solo allora.
#[tauri::command]
fn set_system_locale(host: State<Host>, locale: Locale) -> bool {
    host.publish_locale(locale)
}

/// Le view offerte dai provider registrati, nell'ordine di registrazione.
///
/// È la metà "discovery" del protocollo: la shell non cabla gli id — monta
/// ogni view nel contenitore del suo `placement` e la ridisegna quando arriva
/// un evento della sua maschera `refresh`. Una view di plugin compare da sola.
#[tauri::command]
fn list_views(host: State<Host>, vault: Option<String>) -> Result<Vec<ViewSpec>, PluginError> {
    host.views(vault.as_deref())
}

/// Rende l'albero `UiNode` di **un'istanza** di view. Il render è una lettura:
/// prende il workspace in prestito condiviso, non in esclusiva.
///
/// L'istanza arriva dalla shell, che è chi apre: `instance` la distingue dalle
/// sorelle e `params` sono i suoi argomenti (§2.3). Per la view che la shell
/// monta da sé — una sola, senza parametri — è
/// [`ViewInstance::only`](fub_abi::traits::ViewInstance::only), e questo
/// comando accetta i due campi assenti proprio per non obbligarla a costruirla.
#[tauri::command]
fn render_view(
    host: State<Host>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<UiNode, PluginError> {
    host.render_view(vault.as_deref(), &view_instance(view, instance, params))
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
    vault: Option<String>,
) -> Result<ViewUpdate, PluginError> {
    host.view_action(
        vault.as_deref(),
        &view_instance(view, instance, params),
        UiAction {
            action: ActionId(action),
            payload: payload.unwrap_or(serde_json::Value::Null),
            fields: fields.unwrap_or_default(),
        },
    )
}

/// L'istanza che la shell nomina, con i due default dell'esemplare unico.
fn view_instance(
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
fn list_commands(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<CommandSpec>, PluginError> {
    host.commands(vault.as_deref())
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
/// Anche `trash.os` passa da qui: la scelta è esplicita nel comando e
/// l'esito `effect.custom` distingue cestino OS e fallback interno, senza
/// introdurre un'altra porta Tauri o un writer della shell.
#[tauri::command]
fn invoke_command(
    host: State<Host>,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
    vault: Option<String>,
) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(
        vault.as_deref(),
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
    )
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
fn query_index(
    host: State<Host>,
    query: IndexQuery,
    vault: Option<String>,
) -> Result<IndexResult, PluginError> {
    host.query_index(vault.as_deref(), query)
}

/// **Ferma un lavoro lungo** (§10.3): l'altro capo di `Host::cancel_job`, che
/// finora usavano solo i presidi.
///
/// L'id arriva come **stringa** perché è un u64 pieno e `JSON.parse` perde i
/// bit oltre 2⁵³ in silenzio (la regola sta in `fub_abi::ipc`): un job che
/// non si annulla una volta ogni tanto sarebbe il difetto peggiore di questa
/// riga, perché somiglia a un job lento.
///
/// Non c'è un «job sconosciuto», ed è una decisione della 0032: annullare un
/// job un istante prima che parta deve valere quanto annullarne uno in volo, e
/// un pulsante premuto quando il lavoro è appena finito non è un errore da
/// mostrare — è la cosa più normale che l'utente faccia.
#[tauri::command]
fn cancel_job(host: State<Host>, id: String, vault: Option<String>) -> Result<(), PluginError> {
    let id = id
        .parse::<u64>()
        .map_err(|_| PluginError::BadArgs(format!("invalid job id: `{id}`").into()))?;
    host.cancel_job(vault.as_deref(), JobId(id))
}

// --- versioning ------------------------------------------------------------
//
// Il kernel non sa che il versioning esiste, e comporre le due metà — lo store
// e l'handler registrato — è lavoro dell'host: qui restano le tre firme IPC.

// Il versioning **non ha più tre porte**. `list_versions`, `read_version` e
// `restore_version` erano i tre bespoke che la §16.6 aveva già classificato —
// due letture e un comando — e chi li chiamava era uno solo: il pannello
// cronologia di questa shell. Dal §1.2 la cronologia è un `ViewProvider` della
// feature versioning, cioè dello stesso plugin che le versioni le scrive: legge
// dal proprio spazio dati e ripristina invocando `version.restore`, che adesso è
// un comando del **registro** e non di Tauri. Le due letture non sono state
// migrate a `IndexQuery`: sono sparite, perché chi le faceva era di là.

// --- organizzazione del vault (§11.3) ---------------------------------------
//
// **Leggerla non è qui**: passa da `query_index` (`IndexQuery::Organization`),
// come le impostazioni e i tag — un elenco è dati, e i dati hanno un canale solo
// (decisione 0013). Prima era un comando IPC che restituiva il blob intero,
// quindi una cosa che la shell sapeva chiedere e un plugin no.
//
// E si scrive **per chiave**. Prima erano due funzioni, `read_workspace_meta` e
// `write_workspace_meta`: la shell rileggeva tutto, cambiava un campo e
// riscriveva tutto. Con due finestre sullo stesso vault quella è una *lost
// update* — la seconda che salva cancella ciò che ha fatto la prima, e nessuna
// delle due se ne accorge. Sono comandi IPC e non capacità dell'`HostApi`
// perché nessun plugin le chiede ancora: una capacità concessa a nessuno è
// superficie da mantenere e sandboxare per sempre.

/// L'emoji accanto a una nota o a una cartella (`None` la toglie).
#[tauri::command]
fn set_icon(
    host: State<Host>,
    path: String,
    icon: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_icon(vault.as_deref(), &path, icon)
}

/// Appunta o spunta una nota.
#[tauri::command]
fn set_pinned(
    host: State<Host>,
    id: String,
    pinned: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_pinned(vault.as_deref(), &id, pinned)
}

/// Registra o toglie una cartella dagli spazi.
#[tauri::command]
fn set_space(
    host: State<Host>,
    path: String,
    space: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_space(vault.as_deref(), &path, space)
}

/// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
#[tauri::command]
fn set_order(
    host: State<Host>,
    folder: String,
    names: Vec<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_order(vault.as_deref(), &folder, names)
}

// --- impostazioni, componenti, vault conosciuti (§11.1) --------------------
//
// **Leggere** le impostazioni non è qui**: passa da `query_index`
// (`IndexQuery::Settings`), come i tag e i backlink — un elenco è dati, e i dati
// hanno un canale solo. Qui ci sono le tre cose che dati non sono: scrivere,
// accendere un componente, e la memoria fra un avvio e l'altro.
//
// Perché scrivere passa da un comando IPC e non dal `settings.set` del registro:
// sono due autorità diverse, ed è la distinzione della decisione 0012 applicata
// alla configurazione. Da qui passa **la persona davanti allo schermo**, che ha
// cliccato su un interruttore; da `settings.set` passa un *programma*, e quello
// tocca solo le chiavi che si sono dichiarate scrivibili da un programma. Se
// fossero la stessa strada, o l'utente non potrebbe cambiare le proprie
// impostazioni di privacy, o un plugin potrebbe.

/// Scrive un'impostazione **per conto dell'utente**.
#[tauri::command]
fn set_setting(
    host: State<Host>,
    window: tauri::WebviewWindow,
    key: String,
    value: SettingValue,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let zoom = (key == fub_host::settings::APPEARANCE_ZOOM)
        .then(|| value.as_number())
        .flatten();
    // Il side effect nativo segue una scrittura riuscita: un valore rifiutato
    // non deve lasciare la finestra in uno stato che il livello macchina nega.
    host.set_setting_for_user(vault.as_deref(), &key, value)?;
    if let Some(scale) = zoom {
        window.set_zoom(scale).map_err(|and| {
            PluginError::Internal(format!("native zoom not applied: {and}").into())
        })?;
    }
    if key == fub_host::settings::APPEARANCE_FRAME_RATE {
        let beyond_60 = frame_rate::beyond_60(&host.machine_settings());
        frame_rate::apply_all(window.app_handle(), beyond_60);
    }
    Ok(())
}

/// Dimentica ciò che era stato deciso per una chiave: torna a valere il livello
/// sotto.
#[tauri::command]
fn reset_setting(
    host: State<Host>,
    window: tauri::WebviewWindow,
    key: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.reset_setting_for_user(vault.as_deref(), &key)?;
    if key == fub_host::settings::APPEARANCE_ZOOM {
        window
            .set_zoom(fub_host::settings::DEFAULT_ZOOM)
            .map_err(|and| PluginError::Internal(format!("native zoom not reset: {and}").into()))?;
    }
    if key == fub_host::settings::APPEARANCE_FRAME_RATE {
        let beyond_60 = frame_rate::beyond_60(&host.machine_settings());
        frame_rate::apply_all(window.app_handle(), beyond_60);
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct SettingsProfiles {
    active: String,
    names: Vec<String>,
}

#[tauri::command]
fn settings_profiles(
    host: State<Host>,
    scope: SettingScope,
    vault: Option<String>,
) -> Result<SettingsProfiles, PluginError> {
    let (active, names) = host.settings_profiles(vault.as_deref(), scope)?;
    Ok(SettingsProfiles { active, names })
}

#[tauri::command]
fn export_settings_profile(
    host: State<Host>,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<String, PluginError> {
    host.export_settings_profile(vault.as_deref(), scope, &name)
}

#[tauri::command]
fn import_settings_profile(
    host: State<Host>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    json: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.import_settings_profile(vault.as_deref(), scope, &json)?;
    reapply_native(&host, &window)
}

#[tauri::command]
fn duplicate_settings_profile(
    host: State<Host>,
    scope: SettingScope,
    source: String,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.duplicate_settings_profile(vault.as_deref(), scope, &source, &name)
}

#[tauri::command]
fn switch_settings_profile(
    host: State<Host>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.switch_settings_profile(vault.as_deref(), scope, &name)?;
    reapply_native(&host, &window)
}

#[tauri::command]
fn reset_settings_profile(
    host: State<Host>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.reset_settings_profile(vault.as_deref(), scope, &name)?;
    reapply_native(&host, &window)
}

/// Zoom e tetto dei fotogrammi sono side effect nativi: un profilo cambiato,
/// importato o azzerato cambia il valore di macchina, e le finestre devono
/// seguirlo subito come dopo `set_setting`, non al prossimo avvio.
fn reapply_native(host: &Host, window: &tauri::WebviewWindow) -> Result<(), PluginError> {
    let machine = host.machine_settings();
    frame_rate::apply_all(window.app_handle(), frame_rate::beyond_60(&machine));
    let zoom = machine
        .iter()
        .find(|entry| entry.spec.key == fub_host::settings::APPEARANCE_ZOOM)
        .and_then(|entry| entry.value.as_number())
        .unwrap_or(fub_host::settings::DEFAULT_ZOOM);
    window
        .set_zoom(zoom)
        .map_err(|and| PluginError::Internal(format!("native zoom not applied: {and}").into()))
}

#[tauri::command]
fn frame_capabilities(host: State<Host>) -> fub_host::settings::FrameCapabilities {
    host.frame_capabilities()
}

#[tauri::command]
fn setting_requires_reopen(host: State<Host>, key: String) -> bool {
    host.setting_requires_reopen(&key)
}

// --- lo stato di vista della shell (§11.2) ---------------------------------
//
// La shell **non è un plugin**: non ha un manifest, non le si concedono
// capacità, e passa dall'API del `Workspace` invece che dall'`HostApi`. Per
// questo qui proprietario ed esemplare sono argomenti di una funzione e non
// qualcosa che l'host timbra — ma li timbra comunque **questa porta**, non il
// webview: se arrivassero da JS, una pagina qualunque potrebbe rileggere (e
// riscrivere) lo stato di vista di un provider. È la stessa riga dell'id di un
// job nella decisione 0035, applicata al confine di sotto.

/// Il proprietario sotto cui va lo stato di vista della shell. Un id come quello
/// di un plugin, e col prefisso del progetto: divide il recinto della shell da
/// quello di chiunque altro, senza fare di lei un caso speciale nel formato.
const SHELL_OWNER: &str = "fub.shell";

/// L'esemplare della shell. **Uno solo**, oggi, e dichiararlo qui è più onesto
/// che lasciarlo implicito: l'area principale è un pannello solo, quindi non c'è
/// niente da distinguere. Quando arriverà il modello di layout (§1.2) i pannelli
/// avranno un esemplare per uno, e sarà quello a comparire qui.
const SHELL_INSTANCE: &str = "window";

/// Ciò che la shell aveva salvato sotto questa chiave, per **questo vault** e su
/// **questa macchina**.
///
/// `None` è il caso normale del primo avvio, non un errore: chi non ha mai
/// salvato niente disegna il proprio default.
#[tauri::command]
fn view_state(
    host: State<Host>,
    key: String,
    vault: Option<String>,
) -> Result<Option<serde_json::Value>, PluginError> {
    host.view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key)
}

/// Salva (`Some`) o dimentica (`None`) lo stato di vista della shell.
#[tauri::command]
fn set_view_state(
    host: State<Host>,
    key: String,
    value: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key, value)
}

/// Chi questo host sa montare, e chi è acceso in questo vault. Non è
/// `VaultInfo.plugins`: quello elenca chi è **dichiarato nel kernel**, e un
/// componente spento non lo è — «spento» e «non c'è» sono due stati diversi.
#[tauri::command]
fn list_bundles(host: State<Host>, vault: Option<String>) -> Result<Vec<BundleInfo>, PluginError> {
    host.bundles(vault.as_deref())
}
/// Elenca i temi installati che l'host ha verificato caricabili.
#[tauri::command]
fn list_themes(host: State<Host>) -> Result<Vec<ThemeInfo>, PluginError> {
    host.themes()
}

/// Legge una sola luce del tema richiesto; il filesystem non attraversa l'IPC.
#[tauri::command]
fn read_theme(
    host: State<Host>,
    id: String,
    light: ThemeLight,
) -> Result<ThemePayload, PluginError> {
    host.read_theme(&id, light)
}

fn parse_installation(installation: &str) -> Result<u64, PluginError> {
    if installation.is_empty() || !installation.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(PluginError::BadArgs(
            format!("invalid installation id: `{installation}`").into(),
        ));
    }
    installation.parse::<u64>().map_err(|_| {
        PluginError::BadArgs(format!("invalid installation id: `{installation}`").into())
    })
}

#[tauri::command]
async fn list_installed_plugins(
    app: AppHandle,
    vault: Option<String>,
) -> Result<Vec<InstalledPluginInfo>, PluginError> {
    run_installed(app, move |manager, host| {
        manager.list(host, vault.as_deref())
    })
    .await
}

#[tauri::command]
async fn install_plugin(app: AppHandle, path: String) -> Result<InstalledPluginInfo, PluginError> {
    run_installed(app, move |manager, _host| {
        manager.install(&Utf8PathBuf::from(path))
    })
    .await
}

#[tauri::command]
async fn set_installed_plugin_enabled(
    app: AppHandle,
    installation: String,
    enabled: bool,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| {
        manager.set_enabled(host, installation, enabled)
    })
    .await
}

#[tauri::command]
async fn set_installed_plugin_consent(
    app: AppHandle,
    installation: String,
    consent: Consent,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| {
        manager.set_consent(host, installation, consent)
    })
    .await
}

#[tauri::command]
async fn remove_installed_plugin(
    app: AppHandle,
    installation: String,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_installed(app, move |manager, host| manager.remove(host, installation)).await
}

#[derive(serde::Serialize)]
struct CatalogChange {
    plugin: InstalledPluginInfo,
    diagnostics: Vec<PluginError>,
}

#[tauri::command]
async fn catalog_search(app: AppHandle, needle: String) -> Result<Vec<CatalogEntry>, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager.catalog_search(trust, feed, now, &needle)
    })
    .await
}

/// L'artefatto scelto per il catalogo si legge come la sorgente di
/// un'installazione diretta: file regolare, nessun symlink, tetto di byte.
fn catalog_artifact(source: &str) -> Result<Vec<u8>, CatalogError> {
    Ok(fub_wasm_host::installed::read_source_file(Utf8Path::new(
        source,
    ))?)
}

#[tauri::command]
async fn catalog_install(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<InstalledPluginInfo, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        manager.catalog_install(trust, feed, now, &id, &version, &bytes)
    })
    .await
}

#[tauri::command]
async fn catalog_update(
    app: AppHandle,
    installation: String,
    version: String,
    source: String,
) -> Result<CatalogChange, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        let (plugin, diagnostics) =
            manager.catalog_update(host, trust, feed, now, installation, &version, &bytes)?;
        Ok(CatalogChange {
            plugin,
            diagnostics,
        })
    })
    .await
}

#[tauri::command]
async fn catalog_rollback(
    app: AppHandle,
    installation: String,
    prior_version: String,
    source: String,
) -> Result<CatalogChange, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        let bytes = catalog_artifact(&source)?;
        let (plugin, diagnostics) = manager.catalog_rollback(
            host,
            trust,
            feed,
            now,
            installation,
            &prior_version,
            &bytes,
        )?;
        Ok(CatalogChange {
            plugin,
            diagnostics,
        })
    })
    .await
}

#[tauri::command]
async fn catalog_revoke(
    app: AppHandle,
    installation: String,
) -> Result<Vec<PluginError>, PluginError> {
    let installation = parse_installation(&installation)?;
    run_catalog(app, move |manager, host, trust, feed, now| {
        manager.catalog_revoke(host, trust, feed, now, installation)
    })
    .await
}

#[tauri::command]
async fn catalog_install_theme(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_install_theme(trust, feed, now, &id, &version, Utf8Path::new(&source))
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
async fn catalog_update_theme(
    app: AppHandle,
    id: String,
    version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_update_theme(trust, feed, now, &id, &version, Utf8Path::new(&source))
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
async fn catalog_rollback_theme(
    app: AppHandle,
    id: String,
    prior_version: String,
    source: String,
) -> Result<String, PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager
            .catalog_rollback_theme(
                trust,
                feed,
                now,
                &id,
                &prior_version,
                Utf8Path::new(&source),
            )
            .map(|path| path.into_string())
    })
    .await
}

#[tauri::command]
async fn catalog_revoke_theme(app: AppHandle, id: String) -> Result<(), PluginError> {
    run_catalog(app, move |manager, _, trust, feed, now| {
        manager.catalog_revoke_theme(trust, feed, now, &id)
    })
    .await
}

#[tauri::command]
fn plugin_budget_snapshot(
    installed: State<InstalledPlugins>,
) -> Result<fub_wasm_host::budgets::BudgetSnapshot, PluginError> {
    installed.manager()?.process_budgets()
}

#[derive(Clone, serde::Serialize)]
struct LimitedMode {
    enabled: bool,
    reason: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct LimitedStartupChoice {
    enabled: bool,
    reason: Option<String>,
}

fn limited_startup(config: Option<&Utf8Path>) -> LimitedMode {
    let Some(dir) = config else {
        return LimitedMode {
            enabled: false,
            reason: None,
        };
    };
    let path = dir.join("installed-limited.json");
    if !path.exists() {
        return LimitedMode {
            enabled: false,
            reason: None,
        };
    }
    match bounded_config(&path, 4096).and_then(|bytes| {
        serde_json::from_slice::<LimitedStartupChoice>(&bytes).map_err(|error| {
            PluginError::BadArgs(format!("invalid limited startup configuration: {error}").into())
        })
    }) {
        Ok(choice) if choice.enabled => LimitedMode {
            enabled: true,
            reason: Some(
                choice
                    .reason
                    .filter(|reason| !reason.trim().is_empty())
                    .unwrap_or_else(|| "limited startup selected in machine configuration".into()),
            ),
        },
        Ok(_) => LimitedMode {
            enabled: false,
            reason: None,
        },
        Err(error) => LimitedMode {
            enabled: true,
            reason: Some(format!("invalid limited startup configuration: {error}")),
        },
    }
}

#[tauri::command]
fn plugin_limited_mode(mode: State<LimitedMode>) -> LimitedMode {
    mode.inner().clone()
}

/// Conserva il comando storico per i bundle ufficiali e nativi. Il manager
/// prende autorità soltanto quando il runtime selezionato appartiene al claim
/// installato; un record collidente o non noto continua sul percorso nativo.
#[tauri::command]
async fn set_plugin_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
    vault: Option<String>,
) -> Result<Vec<PluginError>, PluginError> {
    let installed = app.state::<InstalledPlugins>();
    let operation = installed
        .manager_for_legacy()
        .map(|manager| manager.begin_operation())
        .transpose()?;

    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        if let Some(operation) = operation {
            if let Some(errors) =
                operation.set_enabled_by_id(&host, vault.as_deref(), &id, enabled)?
            {
                return Ok(errors);
            }
        }
        host.set_plugin_enabled(vault.as_deref(), &id, enabled)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(format!("plugin toggle did not complete: {error}").into())
    })?
}

/// I vault che questa macchina conosce: preferiti, poi recenti.
#[tauri::command]
fn known_vaults(host: State<Host>) -> Vec<VaultEntry> {
    host.known_vaults()
}

#[tauri::command]
fn set_vault_favorite(host: State<Host>, path: String, favorite: bool) -> Result<(), PluginError> {
    host.set_vault_favorite(&Utf8PathBuf::from(path), favorite)
}

/// L'aspetto con cui un vault compare nell'elenco: **tutto quanto**, nelle
/// stesse forme in cui `known_vaults` lo restituisce. L'icona che non c'è è
/// `null`, il nome che nessuno ha scelto è la stringa vuota — e questa è
/// l'unica lettura possibile della firma, che è ciò che un `null` sul nome non
/// sarebbe stato.
#[tauri::command]
fn set_vault_look(
    host: State<Host>,
    path: String,
    icon: Option<String>,
    name: String,
) -> Result<(), PluginError> {
    host.set_vault_look(&Utf8PathBuf::from(path), icon, name)
}

/// Toglie un vault dall'elenco dei conosciuti. **Non lo cancella dal disco.**
#[tauri::command]
fn forget_vault(host: State<Host>, path: String) -> Result<(), PluginError> {
    host.forget_vault(&Utf8PathBuf::from(path))
}

/// Le scorciatoie che questo vault propone e che nessuno ha ancora guardato
/// (§23.13): chiave d'impostazione → accordo.
#[tauri::command]
fn pending_keybindings(
    host: State<Host>,
    vault: Option<String>,
) -> Result<std::collections::BTreeMap<String, String>, PluginError> {
    host.pending_keybindings(vault.as_deref())
}

/// «Usa le sue»: le scorciatoie del vault valgono da adesso.
#[tauri::command]
fn adopt_keybindings(host: State<Host>, vault: Option<String>) -> Result<(), PluginError> {
    host.adopt_keybindings(vault.as_deref())
}

/// «Tieni le mie»: le scorciatoie del vault escono dal suo file.
#[tauri::command]
fn discard_keybindings(host: State<Host>, vault: Option<String>) -> Result<(), PluginError> {
    host.discard_keybindings(vault.as_deref())
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedAction {
    raw: String,
    kind: &'static str,
    reason: Option<String>,
}

fn forward_uri(app: &AppHandle, raw: &str) {
    let action = match uri::handle_fub_uri(raw) {
        Ok(uri::UriOutcome::Navigate { .. } | uri::UriOutcome::Search { .. }) => OpenedAction {
            raw: raw.to_string(),
            kind: "navigation",
            reason: None,
        },
        Ok(uri::UriOutcome::Create { .. } | uri::UriOutcome::CapturePending { .. }) => {
            OpenedAction {
                raw: raw.to_string(),
                kind: "pending_action",
                reason: None,
            }
        }
        Err(error) => OpenedAction {
            raw: raw.to_string(),
            kind: "invalid",
            reason: Some(error),
        },
    };
    if let Some(main) = app.get_webview_window("main") {
        if main
            .url()
            .is_ok_and(|url| resources::is_local_origin(url.as_str()))
        {
            let _ = main.emit("fub://pending-action", action);
        }
    }
}

// `pending_opened_urls`, `mobile_pending_opened_urls` e `release_info` non ci
// sono più: nessuna riga di `apps/client/src` li invocava e nessun listener di
// eventi li drenava (`fub://pending-action` / `fub://opened-url` restano
// spinte senza coda di recupero). Una porta che nessuno attraversa è una
// promessa che nessuno mantiene: toglierla è il modo giusto di reggerla.

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum SaveArtifactOutcome {
    Saved { path: String },
    Cancelled,
}

#[tauri::command]
async fn save_artifact(
    app: AppHandle,
    window: tauri::WebviewWindow,
    suggested_name: String,
    media_type: String,
    bytes: Vec<u8>,
) -> Result<SaveArtifactOutcome, PluginError> {
    use tauri_plugin_dialog::DialogExt;
    let origin = window
        .url()
        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
    resources::guard_trusted_local(window.label(), origin.as_str())?;
    if window.label() != "main" {
        return Err(PluginError::PermissionDenied(
            "only the main shell may save artifacts".into(),
        ));
    }
    if suggested_name.is_empty()
        || suggested_name == "."
        || suggested_name == ".."
        || suggested_name.len() > 255
        || suggested_name.contains(['/', '\\'])
        || suggested_name.chars().any(char::is_control)
    {
        return Err(PluginError::BadArgs(
            "artifact name must be a safe basename".into(),
        ));
    }
    if media_type.is_empty()
        || media_type.len() > 128
        || !media_type
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'+' | b'-'))
        || !media_type.contains('/')
    {
        return Err(PluginError::BadArgs("invalid artifact media type".into()));
    }
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(PluginError::BadArgs(
            "artifact exceeds the 64 MiB save limit".into(),
        ));
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(&window)
        .set_file_name(suggested_name)
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = receiver
            .recv()
            .map_err(|_| PluginError::Internal("native save dialog did not return".into()))?
        else {
            return Ok(SaveArtifactOutcome::Cancelled);
        };
        let path = selected.into_path().map_err(|error| {
            PluginError::BadArgs(format!("native save destination unavailable: {error}").into())
        })?;
        let parent = path
            .parent()
            .ok_or_else(|| PluginError::BadArgs("native save destination has no parent".into()))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| PluginError::Io(format!("cannot prepare artifact: {error}").into()))?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|error| PluginError::Io(format!("cannot write artifact: {error}").into()))?;
        temp.persist(&path)
            .map_err(|error| PluginError::Io(format!("cannot publish artifact: {error}").into()))?;
        Ok(SaveArtifactOutcome::Saved {
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| PluginError::Internal(format!("save task did not complete: {error}").into()))?
}

// --- superficie IPC da `support` (demo, diagnostica, recupero) ----------------
//
// Wrapper sottili: la logica resta in `support` come `pub fn` pura,
// qui solo le firme `#[tauri::command]` che delegano.
#[tauri::command]
fn demo_root() -> Option<String> {
    support::demo_root()
}

#[tauri::command]
fn open_demo(
    host: State<Host>,
    windows: State<document_windows::DocumentWindows>,
) -> Result<fub_host::support::DemoOpened, PluginError> {
    support::open_demo(host, windows)
}

#[tauri::command]
fn close_demo(
    host: State<Host>,
    windows: State<document_windows::DocumentWindows>,
    return_to: Option<String>,
) -> Result<support::DemoClosed, PluginError> {
    support::close_demo(host, windows, return_to)
}

#[tauri::command]
fn reset_demo(
    host: State<Host>,
    windows: State<document_windows::DocumentWindows>,
) -> Result<String, PluginError> {
    support::reset_demo(host, windows)
}

#[tauri::command]
fn startup_diagnostics(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<PluginError>, PluginError> {
    support::startup_diagnostics(host, vault)
}

#[tauri::command]
fn support_preview(
    host: State<Host>,
    vault: Option<String>,
    log_lines: Option<usize>,
) -> Result<fub_host::support::SupportPreview, PluginError> {
    support::support_preview(host, vault, log_lines)
}

#[tauri::command]
fn support_export(
    host: State<Host>,
    preview: fub_host::support::SupportPreview,
    consent: fub_host::support::ExportConsent,
) -> Result<String, PluginError> {
    support::support_export(host, preview, consent)
}

#[tauri::command]
fn config_health() -> Vec<fub_host::support::ConfigReport> {
    support::config_health()
}

#[tauri::command]
fn recover_config(
    path: String,
    action: fub_host::support::RecoverAction,
) -> Result<fub_host::support::RecoverOutcome, PluginError> {
    support::recover_config(path, action)
}

// --- superficie IPC da `document_windows` (finestre documento) ---------------
#[tauri::command]
async fn open_document_window(
    app: AppHandle,
    window: tauri::WebviewWindow,
    host: State<'_, Host>,
    registry: State<'_, document_windows::DocumentWindows>,
    request: document_windows::DocumentWindowRequest,
) -> Result<document_windows::DocumentWindowOpened, PluginError> {
    document_windows::open_document_window(app, window, host, registry, request).await
}

#[tauri::command]
fn close_document_window(
    app: AppHandle,
    window: tauri::WebviewWindow,
    registry: State<document_windows::DocumentWindows>,
    label: String,
) -> Result<(), PluginError> {
    document_windows::close_document_window(app, window, registry, label)
}

#[tauri::command]
fn finish_main_close(
    app: AppHandle,
    window: tauri::WebviewWindow,
    registry: State<document_windows::DocumentWindows>,
) -> Result<(), PluginError> {
    document_windows::finish_main_close(app, window, registry)
}

// --- superficie IPC da `mobile` (boundary OS sopra lo stesso Host) ----------
#[tauri::command]
fn mobile_validate_capture(
    payload: fub_host::automation::CapturePayloadV1,
) -> Result<(), PluginError> {
    mobile::mobile_validate_capture(payload)
}

#[tauri::command]
fn mobile_submit_capture(
    host: State<Host>,
    payload: fub_host::automation::CapturePayloadV1,
    vault: Option<String>,
    template: Option<String>,
) -> Result<String, PluginError> {
    mobile::mobile_submit_capture(host, payload, vault, template)
}

#[tauri::command]
fn mobile_storage_roots(app: AppHandle) -> mobile::MobileStorageInfo {
    mobile::mobile_storage_roots(app)
}

#[tauri::command]
fn mobile_storage_preference(
    app: AppHandle,
) -> Result<mobile::MobileStoragePreference, PluginError> {
    mobile::mobile_storage_preference(app)
}

#[tauri::command]
fn mobile_set_storage_preference(
    app: AppHandle,
    preference: mobile::MobileStoragePreference,
) -> Result<mobile::MobileStoragePreference, PluginError> {
    mobile::mobile_set_storage_preference(app, preference)
}

#[tauri::command]
fn mobile_wasm_report() -> mobile::MobileWasmReport {
    mobile::mobile_wasm_report()
}

#[tauri::command]
fn mobile_classify_opened_url(raw: String) -> Result<mobile::MobileOpenedUrl, PluginError> {
    mobile::mobile_classify_opened_url(raw)
}

#[tauri::command]
fn mobile_register_tree_grant(
    grant: mobile::MobileTreeGrant,
) -> Result<mobile::MobileTreeGrant, PluginError> {
    mobile::mobile_register_tree_grant(grant)
}

#[tauri::command]
fn mobile_shared_mount_mode(
    grant: Option<mobile::MobileTreeGrant>,
    backend_cas: bool,
    copy_accepted: bool,
) -> mobile::MobileMountMode {
    mobile::mobile_shared_mount_mode(grant, backend_cas, copy_accepted)
}

#[cfg(mobile)]
fn forward_mobile_opened(app: &AppHandle, raw: &str) {
    // Spinta senza coda di recupero: la shell mobile riceve `fub://opened-url`
    // e riclassifica con `mobile_classify_opened_url` prima di ogni gesto.
    match mobile::classify_opened_url(raw) {
        Ok(opened) => {
            if let Some(main) = app.get_webview_window("main") {
                if main
                    .url()
                    .is_ok_and(|url| resources::is_local_origin(url.as_str()))
                {
                    let _ = main.emit("fub://opened-url", opened);
                }
            }
        }
        Err(error) => tracing::warn!(target: "fub.app", "rejected OS URL: {error}"),
    }
}

pub fn run() {
    // Il bootstrap sceglie la cartella canonica una volta sola. Log, host e
    // store installato ricevono lo stesso valore: nessun proprietario riapre
    // l'ambiente o deduce una seconda posizione.
    let config_dir = fub_host::config_dir();
    let (levels, warning) = fub_host::install_logging(config_dir.as_deref());
    let installed_availability = match config_dir.as_deref() {
        Some(dir) => {
            tracing::info!(
                target: "fub.app",
                config_dir = %dir,
                "opening installed plugin manager"
            );
            match InstalledPluginManager::open(dir) {
                Ok(manager) => InstalledAvailability::Ready(Arc::new(manager)),
                Err(error) => {
                    tracing::error!(
                        target: "fub.app",
                        config_dir = %dir,
                        error = %error,
                        "installed plugin manager unavailable"
                    );
                    InstalledAvailability::Failed(error)
                }
            }
        }
        None => InstalledAvailability::NotConfigured,
    };
    let limited = limited_startup(config_dir.as_deref());

    // Il sink è un parametro del montaggio, quindi l'host si costruisce qui e
    // non nel `setup`; l'handle che gli manca ce lo mette il `setup` (vedi
    // `WebviewEvents`).
    let sink = Arc::new(WebviewEvents::default());
    let bridge = sink.clone();
    let mut host = Host::new();
    if let Some(dir) = config_dir.as_deref() {
        host = host.with_config_dir(dir);
    }
    host = host
        .with_session_notice(warning)
        .with_levels(levels)
        .with_sink(sink);
    // Keep the manager alive in `InstalledPlugins`; the startup source is the
    // sole host integration point and its snapshot also carries formats.
    if let InstalledAvailability::Ready(manager) = &installed_availability {
        let source: Arc<dyn fub_host::StartupSource> = if let Some(reason) = &limited.reason {
            manager.limited_startup(reason.clone())
        } else {
            manager.clone()
        };
        host = host.with_startup_source(source);
    }

    let mut builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("fub-asset", |context, request, responder| {
            let app = context.app_handle().clone();
            let label = context.webview_label().to_string();
            std::thread::spawn(move || {
                let result = (|| {
                    let uri = request.uri();
                    let valid_host =
                        matches!(uri.host(), Some("localhost" | "fub-asset.localhost"));
                    // L'URL canonico resta quello costruito da `asset_url`: nessuna forma alternativa.
                    let _canonical = resources::asset_url(fub_host::resources::ResourceHandle(0));
                    if !valid_host || uri.query().is_some() {
                        return Err(PluginError::BadArgs("invalid asset URL authority".into()));
                    }
                    let window = app.get_webview_window(&label).ok_or_else(|| {
                        PluginError::PermissionDenied(
                            "asset requester has no trusted webview".into(),
                        )
                    })?;
                    let origin = window
                        .url()
                        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
                    let range = request
                        .headers()
                        .get(tauri::http::header::RANGE)
                        .map(|header| {
                            header
                                .to_str()
                                .map_err(|_| PluginError::BadArgs("invalid Range header".into()))
                        })
                        .transpose()?;
                    let served = resources::handle_asset_request(
                        &*app.state::<Host>(),
                        &label,
                        origin.as_str(),
                        uri.path(),
                        range,
                    )?;
                    resources::asset_http_response(served)
                })();
                let response = result.unwrap_or_else(|error| {
                    let status = match error {
                        PluginError::PermissionDenied(_) => 403,
                        PluginError::NotFound(_) | PluginError::BadArgs(_) => 404,
                        _ => 500,
                    };
                    tauri::http::Response::builder()
                        .status(status)
                        .header("cache-control", "no-store")
                        .body(Vec::new())
                        .expect("static asset error response")
                });
                responder.respond(response);
            });
        })
        .manage(host)
        .manage(InstalledPlugins::new(installed_availability))
        .manage(ViewerConfig(config_dir.clone()))
        .manage(CatalogConfig(config_dir.clone()))
        .manage(limited)
        .manage(document_windows::DocumentWindows::default())
        .on_window_event(|window, event| {
            document_windows::on_window_event(window, event);
            // La regola pura di sospensione/ripresa resta quella di `mobile::MobileLifecycle`;
            // il ramo nativo la applica solo dove gli eventi OS esistono (`cfg(mobile)`).
            let _lifecycle = [
                mobile::MobileLifecycle::Foreground.step(mobile::MobileLifecycle::Hidden),
                mobile::MobileLifecycle::Suspended.step(mobile::MobileLifecycle::Foreground),
            ];
            #[cfg(mobile)]
            if let Some(action) = mobile::window_event_action(event) {
                let name = match action {
                    mobile::MobileLifecycleAction::KeepOpen => "tauri://suspended",
                    mobile::MobileLifecycleAction::Rejoin => "tauri://resumed",
                };
                let _ = window.emit(name, ());
            }
        });

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for raw in args.iter().filter(|arg| arg.starts_with("fub://")) {
                forward_uri(app, raw);
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }));
    }
    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        // Ogni webview, anche le finestre aperte dopo, prende il tetto dei
        // fotogrammi prima di disegnare.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                let machine = webview.app_handle().state::<Host>().machine_settings();
                frame_rate::apply(webview, frame_rate::beyond_60(&machine));
            }
        })
        .setup(move |app| {
            let _ = bridge.0.set(app.handle().clone());
            let machine = app.state::<Host>().machine_settings();
            let zoom = machine.iter()
                .find(|entry| entry.spec.key == fub_host::settings::APPEARANCE_ZOOM)
                .and_then(|entry| entry.value.as_number())
                .unwrap_or(fub_host::settings::DEFAULT_ZOOM);
            #[cfg(not(mobile))]
            let system_frame = machine.iter()
                .find(|entry| entry.spec.key == fub_host::settings::CHROME_FRAME)
                .and_then(|entry| entry.value.as_text())
                == Some("system");
            for window in app.webview_windows().values() {
                window.set_zoom(zoom)?;
                #[cfg(not(mobile))]
                if window.label() == "main" {
                    window.set_decorations(system_frame)?;
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            for raw in std::env::args().filter(|arg| arg.starts_with("fub://")) {
                forward_uri(app.handle(), &raw);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            close_vault,
            list_vaults,
            discard_draft,
            set_active_context,
            set_system_locale,
            set_current_vault,
            initial_vault,
            session_notice,
            save_artifact,
            demo_root,
            open_demo,
            close_demo,
            reset_demo,
            startup_diagnostics,
            support_preview,
            support_export,
            config_health,
            recover_config,
            open_document_window,
            close_document_window,
            finish_main_close,
            read_document,
            resource_open,
            resource_read_chunk,
            resource_close,
            resource_write,
            viewer_open,
            viewer_save,
            list_grid_surfaces,
            open_grid,
            grid_window,
            apply_grid,
            reload_grid,
            close_grid,
            write_document,
            save_draft,
            list_bundles,
            list_themes,
            read_theme,
            list_installed_plugins,
            plugin_budget_snapshot,
            plugin_limited_mode,
            catalog_search,
            catalog_install,
            catalog_update,
            catalog_rollback,
            catalog_revoke,
            catalog_install_theme,
            catalog_update_theme,
            catalog_rollback_theme,
            catalog_revoke_theme,
            list_views,
            render_view,
            view_action,
            list_commands,
            invoke_command,
            query_index,
            cancel_job,
            set_icon,
            set_pinned,
            set_space,
            set_order,
            set_setting,
            reset_setting,
            settings_profiles,
            export_settings_profile,
            import_settings_profile,
            duplicate_settings_profile,
            switch_settings_profile,
            reset_settings_profile,
            frame_capabilities,
            setting_requires_reopen,
            view_state,
            set_view_state,

            install_plugin,
            set_installed_plugin_enabled,
            set_installed_plugin_consent,
            remove_installed_plugin,
            set_plugin_enabled,
            known_vaults,
            set_vault_favorite,
            set_vault_look,
            forget_vault,
            pending_keybindings,
            adopt_keybindings,
            discard_keybindings,
            mobile_validate_capture,
            mobile_submit_capture,
            mobile_storage_roots,
            mobile_storage_preference,
            mobile_set_storage_preference,
            mobile_wasm_report,
            mobile_classify_opened_url,
            mobile_register_tree_grant,
            mobile_shared_mount_mode,
        ])
        .build(tauri::generate_context!())
        .expect("error during Fub startup")

        // **Chi chiude sa che sta chiudendo** (§9.5). Il kernel non può saperlo:
        // non sa quando finisce un lotto, e finché l'unico chiamante di
        // `flush_indexes` era il callback del watcher, la durabilità di un
        // indice dipendeva da un componente opzionale. Qui invece il fatto è
        // certo, ed è l'ultimo momento in cui si può dire a qualcuno di
        // chiudersi: `Host::close` fa il giro su ogni vault aperto.
        //
        // `Exit` e non `ExitRequested`: il secondo si può annullare, e chiudere
        // gli indici di un vault che poi resta aperto sarebbe peggio che non
        // chiuderli.
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    #[cfg(mobile)]
                    forward_mobile_opened(app, url.as_str());
                    #[cfg(not(mobile))]
                    if url.scheme() == uri::URI_SCHEME {
                        forward_uri(app, url.as_str());
                    }
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if let Some(main) = app.get_webview_window("main") {
                    // OS Quit skips the window's CloseRequested event. Redirect
                    // it through the main webview's drain/flush path instead.
                    api.prevent_exit();
                    if let Err(error) = main.close() {
                        tracing::error!(target: "fub.app", %error, "could not request main window drain");
                    }
                } else if app.state::<document_windows::DocumentWindows>().has_children() {
                    // A force-destroyed main cannot drain surviving children.
                    api.prevent_exit();
                    tracing::error!(target: "fub.app", "cannot exit with live document windows and no main window");
                }
            }
            if let tauri::RunEvent::Exit = event {
                let shutdown = app.state::<InstalledPlugins>().begin_shutdown();
                for and in app.state::<Host>().close() {
                    // L'app sta uscendo: il ponte verso la shell sta morendo e
                    // non c'è nessuno che disegna un evento. Resta il log, che è
                    // ciò che il bundle diagnostico (§15.2) raccoglierà — e il
                    // fatto che un indice non si sia chiuso pulito è una
                    // diagnosi per chi sviluppa, non una cosa che l'utente può
                    // ancora riparare a schermo spento (0062).
                    tracing::warn!(target: "fub.app", "vault closure: {and}");
                }
                // Il lease di scrittura fra processi è delle sessioni: l'host
                // l'ha lasciato chiudendo ciascuna, dopo il suo teardown.
                match shutdown {
                    Ok(Some(shutdown)) => {
                        if let Err(and) = shutdown.finish() {
                            tracing::error!(
                                target: "fub.app",
                                "installed plugin manager did not drain: {and}"
                            );
                        }
                    }
                    Ok(None) => {}
                    Err(and) => tracing::error!(
                        target: "fub.app",
                        "installed plugin manager did not begin shutdown; host closure completed: {and}"
                    ),
                }
            }
        });
}

#[cfg(test)]
mod installed_ipc_tests {
    use super::*;

    #[test]
    fn installation_ids_are_strict_decimal_u64_strings() {
        assert_eq!(parse_installation("0").unwrap(), 0);
        assert_eq!(
            parse_installation("18446744073709551615").unwrap(),
            u64::MAX
        );
        for invalid in ["", "-1", "+1", " 1", "1 ", "١", "18446744073709551616"] {
            assert!(
                matches!(parse_installation(invalid), Err(PluginError::BadArgs(_))),
                "{invalid:?} deve essere rifiutato"
            );
        }
    }
}
