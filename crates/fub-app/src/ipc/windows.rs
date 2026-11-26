//! Comandi IPC delle finestre dei documenti.

use super::*;

// --- superficie IPC da `document_windows` (finestre documento) ---------------
#[tauri::command]
pub(crate) async fn open_document_window(
    app: AppHandle,
    window: tauri::WebviewWindow,
    host: State<'_, Host>,
    registry: State<'_, document_windows::DocumentWindows>,
    request: document_windows::DocumentWindowRequest,
) -> Result<document_windows::DocumentWindowOpened, PluginError> {
    document_windows::open_document_window(app, window, host, registry, request).await
}

#[tauri::command]
pub(crate) fn close_document_window(
    app: AppHandle,
    window: tauri::WebviewWindow,
    registry: State<document_windows::DocumentWindows>,
    label: String,
) -> Result<(), PluginError> {
    document_windows::close_document_window(app, window, registry, label)
}

#[tauri::command]
pub(crate) fn finish_main_close(
    app: AppHandle,
    window: tauri::WebviewWindow,
    registry: State<document_windows::DocumentWindows>,
) -> Result<(), PluginError> {
    document_windows::finish_main_close(app, window, registry)
}
