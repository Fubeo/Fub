//! Native boundary for secondary document surfaces. The main window alone owns
//! the host and the authoritative document session; children have no IPC grants.

use std::collections::HashMap;
use std::path::PathBuf;

use fub_abi::PluginError;
use fub_host::{doc_id, Host};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};
use uuid::Uuid;

const ENTRY: &str = "document.html";
const CLOSE_REQUESTED: &str = "fub://document-window-close-requested";
const CLOSED: &str = "fub://document-window-closed";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentWindowRequest {
    pub surface: String,
    pub channel: String,
    pub document: String,
    pub vault: String,
    pub session: String,
    pub surface_id: String,
}

#[derive(Serialize)]
pub struct DocumentWindowOpened {
    pub label: String,
}

#[derive(Clone, Serialize)]
struct DocumentWindowEvent {
    label: String,
    surface: String,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum CloseState {
    Open,
    Requested,
    Closing,
}

struct RegisteredWindow {
    request: DocumentWindowRequest,
    close: CloseState,
}

#[derive(Default)]
struct WindowRegistry {
    windows: HashMap<String, RegisteredWindow>,
    main_closing: bool,
    vault_closing: bool,
}

#[derive(Default)]
pub struct DocumentWindows(Mutex<WindowRegistry>);

impl DocumentWindows {
    pub fn has_children(&self) -> bool {
        !self.0.lock().windows.is_empty()
    }
}

struct VaultTransition<'a>(&'a DocumentWindows);

impl Drop for VaultTransition<'_> {
    fn drop(&mut self) {
        self.0 .0.lock().vault_closing = false;
    }
}

pub(crate) fn with_vault_transition<T>(
    host: &Host,
    registry: &DocumentWindows,
    path: &str,
    action: impl FnOnce() -> Result<T, PluginError>,
) -> Result<T, PluginError> {
    // Resolving host keys may touch the filesystem; never do it under the
    // registry mutex. An alias could name a leased vault, so fail closed.
    let canonical = host.vaults().iter().any(|vault| vault.as_str() == path);
    {
        let mut windows = registry.0.lock();
        if windows.main_closing || windows.vault_closing {
            return Err(permitted("main window or a vault is already closing"));
        }
        if !windows.windows.is_empty()
            && (!canonical
                || windows
                    .windows
                    .values()
                    .any(|entry| entry.request.vault == path))
        {
            return Err(permitted(
                "close document windows before closing their vault",
            ));
        }
        windows.vault_closing = true;
    }
    let _transition = VaultTransition(registry);
    action()
}

fn invalid(message: &'static str) -> PluginError {
    PluginError::BadArgs(message.into())
}

fn permitted(message: &'static str) -> PluginError {
    PluginError::PermissionDenied(message.into())
}

fn valid_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|uuid| uuid.to_string() == value && !uuid.is_nil())
}

fn validate(request: &DocumentWindowRequest, host: &Host) -> Result<(), PluginError> {
    if request.surface != "document" {
        return Err(invalid(
            "only the document surface can open a document window",
        ));
    }
    if !request
        .channel
        .strip_prefix("docwin-")
        .is_some_and(valid_uuid)
        || !valid_uuid(&request.session)
        || !request
            .surface_id
            .strip_prefix("remote:")
            .is_some_and(valid_uuid)
    {
        return Err(invalid(
            "invalid document window channel, session or surfaceId",
        ));
    }
    doc_id(&request.document)?;
    if !host
        .vaults()
        .iter()
        .any(|vault| vault.as_str() == request.vault)
    {
        return Err(invalid("document window vault is not open"));
    }
    Ok(())
}

// Do not trust a label or URL supplied by JS. Tauri's ACL grants app commands
// only to `main`; this second native check pins its actual loaded origin too.
fn trusted_main<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    app: &AppHandle<R>,
) -> Result<tauri::Url, PluginError> {
    if window.label() != "main" {
        return Err(permitted("only the main window controls document windows"));
    }
    let url = window.url().map_err(|error| {
        PluginError::Internal(format!("could not inspect main window URL: {error}").into())
    })?;
    if !matches!(url.path(), "/" | "/index.html")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(permitted("main window is not at its app entry"));
    }
    let bundled = url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")));
    #[cfg(dev)]
    let dev = app
        .config()
        .build
        .dev_url
        .as_ref()
        .is_some_and(|base| url.origin() == base.origin());
    #[cfg(not(dev))]
    let dev = {
        let _ = app;
        false
    };
    if bundled || dev {
        Ok(url)
    } else {
        Err(permitted("main window is not on the local app origin"))
    }
}

fn entry_path(request: &DocumentWindowRequest) -> String {
    // URL owns percent encoding, including '&', '=', '#', non-ASCII and paths.
    // Only this fixed app entry can be opened; never accept a URL from JS.
    let mut url = tauri::Url::parse("tauri://localhost/document.html").expect("fixed app URL");
    url.query_pairs_mut()
        .append_pair("surface", &request.surface)
        .append_pair("channel", &request.channel)
        .append_pair("document", &request.document)
        .append_pair("vault", &request.vault)
        .append_pair("session", &request.session)
        .append_pair("surfaceId", &request.surface_id);
    format!("{ENTRY}?{}", url.query().expect("document entry has query"))
}

pub async fn open_document_window(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, Host>,
    registry: State<'_, DocumentWindows>,
    request: DocumentWindowRequest,
) -> Result<DocumentWindowOpened, PluginError> {
    let main_url = trusted_main(&window, &app)?;
    let path = entry_path(&request);
    let expected = main_url.join(&path).map_err(|error| {
        PluginError::Internal(format!("invalid local document entry: {error}").into())
    })?;
    let label;
    validate(&request, &host)?;
    let vault = request.vault.clone();
    {
        let mut windows = registry.0.lock();
        if windows.main_closing || windows.vault_closing {
            return Err(permitted("main window or vault is already closing"));
        }
        if windows.windows.values().any(|entry| {
            entry.request.channel == request.channel
                || entry.request.surface_id == request.surface_id
        }) {
            return Err(invalid(
                "document window channel or surfaceId is already in use",
            ));
        }
        label = loop {
            let candidate = format!("document-{}", Uuid::new_v4());
            if !windows.windows.contains_key(&candidate) {
                break candidate;
            }
        };
        windows.windows.insert(
            label.clone(),
            RegisteredWindow {
                request,
                close: CloseState::Open,
            },
        );
    }
    // A close may have completed between validation and reservation. Once
    // reserved, any new close must reject this child, so recheck outside the
    // mutex before creating a native window for a vanished session.
    if !host.vaults().iter().any(|opened| opened.as_str() == vault) {
        registry.0.lock().windows.remove(&label);
        return Err(invalid("document window vault is not open"));
    }

    // The registry exists before build: a native close immediately after create
    // is still intercepted. Navigation cannot turn a granted label into a
    // remote page. Neither window.open nor downloads may escape the entry.
    let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(PathBuf::from(path)))
        .title("Documento · Fub")
        .inner_size(1024.0, 760.0)
        .min_inner_size(480.0, 320.0)
        .on_navigation(move |url| url == &expected)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build();
    if let Err(error) = result {
        registry.0.lock().windows.remove(&label);
        return Err(PluginError::Internal(
            format!("document window not opened: {error}").into(),
        ));
    }
    Ok(DocumentWindowOpened { label })
}

pub fn close_document_window(
    app: AppHandle,
    window: WebviewWindow,
    registry: State<'_, DocumentWindows>,
    label: String,
) -> Result<(), PluginError> {
    trusted_main(&window, &app)?;
    {
        let mut windows = registry.0.lock();
        let entry = windows
            .windows
            .get_mut(&label)
            .ok_or_else(|| invalid("unknown document window"))?;
        if entry.close == CloseState::Closing {
            return Err(invalid("document window is already closing"));
        }
        entry.close = CloseState::Closing;
    }
    // `close()` would reenter CloseRequested, causing a second freeze/write.
    // `destroy()` skips CloseRequested; the actual Destroyed event removes the
    // registry entry and is the *only* source of `closed` notification.
    let result = app
        .get_webview_window(&label)
        .ok_or_else(|| PluginError::Internal("registered document window is missing".into()))
        .and_then(|target| {
            target.destroy().map_err(|error| {
                PluginError::Internal(format!("document window not closed: {error}").into())
            })
        });
    if result.is_err() {
        if let Some(entry) = registry.0.lock().windows.get_mut(&label) {
            entry.close = CloseState::Requested;
        }
    }
    result
}

pub(crate) fn close_vault(
    host: &Host,
    registry: &DocumentWindows,
    path: &str,
) -> Result<Vec<PluginError>, PluginError> {
    with_vault_transition(host, registry, path, || {
        host.close_vault(&camino::Utf8PathBuf::from(path))
    })
}

pub fn finish_main_close(
    app: AppHandle,
    window: WebviewWindow,
    registry: State<'_, DocumentWindows>,
) -> Result<(), PluginError> {
    trusted_main(&window, &app)?;
    {
        let mut windows = registry.0.lock();
        if !windows.windows.is_empty() || windows.vault_closing {
            return Err(permitted(
                "document windows or a vault close have not finished",
            ));
        }
        if windows.main_closing {
            return Err(invalid("main window is already closing"));
        }
        // Prevent a concurrent open from registering between this check and
        // the asynchronous native destruction of the main window.
        windows.main_closing = true;
    }
    if let Err(error) = window.destroy() {
        registry.0.lock().main_closing = false;
        return Err(PluginError::Internal(
            format!("main window not closed: {error}").into(),
        ));
    }
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    let registry = app.state::<DocumentWindows>();
    match event {
        WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
            // The root may only leave through finish_main_close after the
            // frontend's drain/flush. This also covers a close before its JS
            // listener was installed: an early X must not discard edits.
            api.prevent_close();
        }
        WindowEvent::CloseRequested { api, .. } => {
            let payload = {
                let mut windows = registry.0.lock();
                let Some(entry) = windows.windows.get_mut(window.label()) else {
                    return;
                };
                api.prevent_close();
                // A failed parent flush leaves the window open. A later OS X
                // must retry the drain; the parent coalesces requests in flight.
                if entry.close == CloseState::Closing {
                    return;
                }
                entry.close = CloseState::Requested;
                DocumentWindowEvent {
                    label: window.label().to_owned(),
                    surface: entry.request.surface.clone(),
                }
            };
            if let Err(error) = app.emit_to("main", CLOSE_REQUESTED, payload) {
                tracing::error!(target: "fub.app", %error, label = window.label(), "document close request not delivered");
                if let Some(entry) = registry.0.lock().windows.get_mut(window.label()) {
                    entry.close = CloseState::Open;
                }
            }
        }
        WindowEvent::Destroyed => {
            let removed = registry.0.lock().windows.remove(window.label());
            if let Some(entry) = removed {
                let event = DocumentWindowEvent {
                    label: window.label().to_owned(),
                    surface: entry.request.surface,
                };
                if let Err(error) = app.emit_to("main", CLOSED, event) {
                    tracing::error!(target: "fub.app", %error, label = window.label(), "document destruction not delivered");
                }
            }
        }
        _ => {}
    }
}
