//! Comandi IPC delle griglie (fogli di calcolo) sui byte del documento.

use super::*;

/// Superfici grid dichiarate dai provider montati. La shell negozia famiglia e
/// versione prima di aprire una sessione. Legge il workspace: nella corsia del
/// foglio, perché sul thread principale aspetterebbe chi lo sta scrivendo.
#[tauri::command]
pub(crate) async fn list_grid_surfaces(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    vault: Option<String>,
) -> Result<Vec<GridSurfaceSpec>, PluginError> {
    grid_port(app, &corsie, "grid surfaces", move |host| {
        host.grid_surfaces(vault.as_deref())
    })
    .await
}

/// Il lavoro di una porta del foglio sui byte, fuori dal thread principale,
/// nella corsia del foglio (`domande::CORSIA_GRIGLIA`). Scorrendo, la shell
/// chiede una finestra a ogni blocco di righe nuove: sul thread principale,
/// lo stesso che presenta i fotogrammi, ogni lettura li fermava. La corsia
/// tiene l'ordine d'arrivo che il thread principale dava, così una finestra
/// chiesta prima di una modifica si legge alla revisione da cui la modifica
/// parte. Gli errori restano quelli dell'host, come prima.
pub(crate) async fn grid_port<T, F>(
    app: AppHandle,
    corsie: &domande::Corsie,
    cosa: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    host_lane(app, corsie, cosa, domande::CORSIA_GRIGLIA, work).await
}

/// Apre una superficie grid della versione 2 sui byte di un documento. La
/// shell non porta i byte: manda il diario delle celle cambiate (il testo
/// della sessione documento) e la revisione dei byte da cui parte; l'host li
/// legge e rifiuta con `Conflict` se nel frattempo sono cambiati.
#[tauri::command]
pub(crate) async fn open_grid_bytes(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    doc: String,
    journal: String,
    base: String,
    vault: Option<String>,
) -> Result<GridBytesSession, PluginError> {
    let doc = doc_id(&doc)?;
    grid_port(app, &corsie, "grid open", move |host| {
        host.grid_bytes_open(vault.as_deref(), &surface, &doc, &journal, Revision(base))
    })
    .await
}

#[tauri::command]
pub(crate) async fn grid_bytes_window(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    instance: String,
    request: GridWindowRequest,
    vault: Option<String>,
) -> Result<GridBytesWindow, PluginError> {
    grid_port(app, &corsie, "grid window", move |host| {
        host.grid_bytes_window(vault.as_deref(), &surface, &instance, request)
    })
    .await
}

#[tauri::command]
pub(crate) async fn apply_grid_bytes(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    instance: String,
    request: GridApplyRequest,
    vault: Option<String>,
) -> Result<GridCommit, PluginError> {
    grid_port(app, &corsie, "grid apply", move |host| {
        host.grid_bytes_apply(vault.as_deref(), &surface, &instance, request)
    })
    .await
}

/// Il catalogo dei comandi di una sessione grid sulla selezione.
#[tauri::command]
pub(crate) async fn grid_bytes_commands(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    instance: String,
    selection: GridSelection,
    vault: Option<String>,
) -> Result<Vec<GridCommandState>, PluginError> {
    grid_port(app, &corsie, "grid commands", move |host| {
        host.grid_bytes_commands(vault.as_deref(), &surface, &instance, selection)
    })
    .await
}

/// Un comando del catalogo (ADR 0219): l'esito porta il diff del giornale.
#[tauri::command]
pub(crate) async fn grid_bytes_command(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    instance: String,
    request: GridCommandRequest,
    vault: Option<String>,
) -> Result<GridCommandOutcome, PluginError> {
    grid_port(app, &corsie, "grid command", move |host| {
        host.grid_bytes_command(vault.as_deref(), &surface, &instance, request)
    })
    .await
}

/// In corsia anche la chiusura: dopo le finestre e le modifiche chieste
/// prima, che altrimenti troverebbero l'istanza già chiusa.
#[tauri::command]
pub(crate) async fn close_grid_bytes(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    surface: String,
    instance: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    grid_port(app, &corsie, "grid close", move |host| {
        host.grid_bytes_close(vault.as_deref(), &surface, &instance)
    })
    .await
}
