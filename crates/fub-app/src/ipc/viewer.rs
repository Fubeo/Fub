//! Comandi IPC del visore esterno e delle tessere della mappa.

use super::*;

pub(crate) struct ViewerConfig(pub(crate) Option<Utf8PathBuf>);

/// Il canale di controllo dell'app ([`fub_host::control`]): la CLI e l'host
/// nativo del clipper lavorano attraverso l'app sui vault che lei tiene aperti.
/// Lo possiede l'app; si chiude all'uscita, prima dei vault.
#[cfg(not(mobile))]
pub(crate) struct ControlChannel(
    pub(crate) std::sync::Mutex<Option<fub_host::control::ControlServer>>,
);

#[cfg(not(mobile))]
pub(crate) fn start_control(app: &tauri::App) {
    let Some(dir) = app.state::<ViewerConfig>().0.clone() else {
        return;
    };
    let handle = app.handle().clone();
    match fub_host::control::ControlServer::start(&dir, move |call| {
        fub_host::control::answer(&handle.state::<Host>(), call)
    }) {
        Ok(server) => {
            app.manage(ControlChannel(std::sync::Mutex::new(Some(server))));
        }
        // Senza canale la CLI trova il vault occupato, come prima: l'app
        // funziona lo stesso.
        Err(error) => {
            tracing::warn!(target: "fub.app", %error, "canale di controllo non avviato");
        }
    }
}

#[tauri::command]
pub(crate) async fn viewer_open(
    host: State<'_, Host>,
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
    let opened = resources::open_viewer(app, window, open, dir).await;
    for_the_shell(&host, None, opened)
}

/// Indietro, avanti, ricarica, chiudi o porta davanti la finestra del visore:
/// i gesti della barra che la shell disegna nella finestra principale.
#[tauri::command]
pub(crate) fn viewer_control(
    host: State<'_, Host>,
    app: AppHandle,
    window: tauri::WebviewWindow,
    action: String,
) -> Result<(), PluginError> {
    let done = window
        .url()
        .map_err(|error| resources::viewer_failed("host.viewer.url_unavailable", error))
        .and_then(|origin| {
            resources::viewer_control(&app, window.label(), origin.as_str(), &action)
        });
    for_the_shell(&host, None, done)
}

#[tauri::command]
pub(crate) async fn viewer_save(
    host: State<'_, Host>,
    window: tauri::WebviewWindow,
    url: String,
    title: String,
    allowlist: Vec<String>,
    vault: Option<String>,
    attachment_folder: String,
) -> Result<fub_host::resources::ResourceWriteReceipt, PluginError> {
    let origin = for_the_shell(
        &host,
        None,
        window
            .url()
            .map_err(|error| resources::viewer_failed("host.viewer.url_unavailable", error)),
    )?;
    // Il filo verso fuori è quello dell'host: lo stesso che i workspace
    // montati usano, e lo stesso che un banco sostituisce.
    let network = host.network().ok_or_else(|| {
        PluginError::Unserved("this host has no network client for the viewer".into())
    })?;
    let saved = resources::viewer_save(
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
    .await;
    for_the_shell(&host, vault.as_deref(), saved)
}

/// Una tessera della vista Mappa di una Base, come corpo IPC binario: la
/// scarica l'host, soltanto da un host che `map.tile-hosts` ammette su questa
/// macchina (`Host::map_tile`, dove stanno tutte le regole). La webview non
/// apre connessioni: la sua CSP non ammette `https:` in `connect-src`.
/// Fuori dal thread principale: una tessera aspetta la rete.
#[tauri::command]
pub(crate) async fn map_tile(
    app: AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    kind: fub_host::map_tiles::TileKind,
) -> Result<tauri::ipc::Response, PluginError> {
    let origin = window
        .url()
        .map_err(|error| resources::viewer_failed("host.viewer.url_unavailable", error));
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let tile = origin
            .and_then(|origin| resources::guard_trusted_local(&label, origin.as_str()))
            .and_then(|()| host.map_tile(&url, kind));
        for_the_shell(&host, None, tile).map(|tile| tauri::ipc::Response::new(tile.bytes.to_vec()))
    })
    .await
    .map_err(|error| unfinished("map tile", error))?
}
