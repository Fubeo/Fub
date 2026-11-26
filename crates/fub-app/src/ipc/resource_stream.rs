//! Comandi IPC delle risorse lette e scritte a pezzi (flussi binari).

use super::*;

/// La finestra che chiede una porta delle risorse: il label e l'origin che
/// il recinto controlla vengono dalla finestra nativa, non dagli argomenti
/// JavaScript. Si leggono nel comando; il lavoro va in corsia.
pub(crate) struct ResourceCaller {
    pub(crate) label: String,
    pub(crate) origin: String,
}

pub(crate) fn resource_caller(
    window: &tauri::WebviewWindow,
) -> Result<ResourceCaller, PluginError> {
    let origin = window.url().map_err(|and| {
        PluginError::Internal(format!("resource window URL unavailable: {and}").into())
    })?;
    Ok(ResourceCaller {
        label: window.label().to_owned(),
        origin: origin.to_string(),
    })
}

/// Il lavoro di una porta delle risorse, fuori dal thread principale, nella
/// corsia delle risorse (`domande::CORSIA_RISORSE`). Un PDF che scorre chiede
/// un pezzo dopo l'altro: sul thread principale ogni lettura dal disco
/// toglieva fotogrammi alla finestra. La fila tiene l'ordine che il thread
/// principale dava: un pezzo chiesto prima della chiusura del prestito si
/// legge prima che il prestito si chiuda.
pub(crate) async fn resource_port<T, F>(
    source: impl HostSource,
    corsie: &domande::Corsie,
    cosa: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    host_lane(source, corsie, cosa, domande::CORSIA_RISORSE, work).await
}

/// Apre un lease sui byte di una risorsa.
#[tauri::command]
pub(crate) async fn resource_open(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    id: String,
    vault: Option<String>,
) -> Result<fub_host::resources::ResourceDescriptor, PluginError> {
    let caller = resource_caller(&window)?;
    resource_open_in_lane(app, &corsie, caller, id, vault).await
}

pub(crate) async fn resource_open_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    caller: ResourceCaller,
    id: String,
    vault: Option<String>,
) -> Result<fub_host::resources::ResourceDescriptor, PluginError> {
    resource_port(source, corsie, "resource open", move |host| {
        resources::resource_open_cmd(host, &caller.label, &caller.origin, &id, vault.as_deref())
    })
    .await
}

/// Serve un chunk come corpo IPC binario, senza array JSON o base64.
#[tauri::command]
pub(crate) async fn resource_read_chunk(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    handle: fub_host::resources::ResourceHandle,
    offset: u64,
    len: u32,
) -> Result<tauri::ipc::Response, PluginError> {
    let caller = resource_caller(&window)?;
    resource_read_chunk_in_lane(app, &corsie, caller, handle, offset, len).await
}

pub(crate) async fn resource_read_chunk_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    caller: ResourceCaller,
    handle: fub_host::resources::ResourceHandle,
    offset: u64,
    len: u32,
) -> Result<tauri::ipc::Response, PluginError> {
    resource_port(source, corsie, "resource read", move |host| {
        resources::resource_read_chunk_cmd(host, &caller.label, &caller.origin, handle, offset, len)
    })
    .await
}

/// Rilascia il lease; la chiusura ripetuta resta idempotente.
#[tauri::command]
pub(crate) async fn resource_close(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    handle: fub_host::resources::ResourceHandle,
) -> Result<(), PluginError> {
    let caller = resource_caller(&window)?;
    resource_close_in_lane(app, &corsie, caller, handle).await
}

pub(crate) async fn resource_close_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    caller: ResourceCaller,
    handle: fub_host::resources::ResourceHandle,
) -> Result<(), PluginError> {
    resource_port(source, corsie, "resource close", move |host| {
        resources::resource_close_cmd(host, &caller.label, &caller.origin, handle)
    })
    .await
}

/// Binary IPC body; metadata lives only in the bounded, strict header. Il
/// corpo si copia per entrare in corsia, perché la richiesta di Tauri vive
/// solo quanto il comando; il tetto si controlla prima della copia.
#[tauri::command]
pub(crate) async fn resource_write(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<fub_host::resources::ResourceWriteReceipt, PluginError> {
    let caller = resource_caller(&window)?;
    let bytes = resources::resource_write_body(&request)?;
    resources::check_inline_limit(bytes.len() as u64)?;
    let bytes = bytes.to_vec();
    let headers = request.headers().clone();
    resource_port(app, &corsie, "resource write", move |host| {
        resources::resource_write_cmd(host, &caller.label, &caller.origin, &headers, &bytes)
    })
    .await
}
