//! Comandi IPC di Live, la condivisione col telefono.

use super::*;

// --- La sessione live (ADR 0205) ---
//
// Il registro delle sessioni, la pompa degli eventi e le chiusure stanno in
// `live.rs`. La sessione appartiene alla finestra che l'ha aperta, presa dal
// webview e non dagli argomenti: un'altra finestra non la vede. Gli errori sono
// chiavi del catalogo del core, e la shell li riceve nella sua lingua.

/// Apre una sessione live sul documento. Gli eventi arrivano a gruppi da
/// `events`, che vive quanto la sessione.
#[tauri::command]
pub(crate) async fn live_start(
    host: State<'_, Host>,
    sessions: State<'_, live::LiveSessions>,
    window: tauri::WebviewWindow,
    request: LiveStart,
    events: tauri::ipc::Channel<Vec<fub_live::host::LiveEvent>>,
) -> Result<LiveStarted, PluginError> {
    let port = live::port(&host.machine_settings());
    let (started, pump) = for_the_shell(
        &host,
        None,
        sessions.start(window.label(), request, port, events).await,
    )?;
    tauri::async_runtime::spawn(pump);
    Ok(started)
}

/// Il QR in corso, o uno nuovo con `renew`.
#[tauri::command]
pub(crate) async fn live_pairing(
    host: State<'_, Host>,
    sessions: State<'_, live::LiveSessions>,
    window: tauri::WebviewWindow,
    session: String,
    renew: bool,
) -> Result<Option<fub_live::host::Pairing>, PluginError> {
    for_the_shell(
        &host,
        None,
        sessions.pairing(window.label(), &session, renew),
    )
}

/// Manda allo scrittore `ack`, `nack`, `ops` o `snapshot`.
#[tauri::command]
pub(crate) fn live_send(
    host: State<Host>,
    sessions: State<live::LiveSessions>,
    window: tauri::WebviewWindow,
    session: String,
    message: fub_live::host::ShellMessage,
) -> Result<(), PluginError> {
    for_the_shell(
        &host,
        None,
        sessions.send(window.label(), &session, message),
    )
}

/// Lo stato della sessione, con i commit a cui la shell non ha ancora
/// risposto: il canale non è autorevole (0184), questo sì.
#[tauri::command]
pub(crate) fn live_status(
    host: State<Host>,
    sessions: State<live::LiveSessions>,
    window: tauri::WebviewWindow,
    session: String,
) -> Result<fub_live::host::LiveStatus, PluginError> {
    for_the_shell(&host, None, sessions.status(window.label(), &session))
}

/// Chiude la sessione e restituisce i commit rimasti senza risposta.
#[tauri::command]
pub(crate) async fn live_stop(
    host: State<'_, Host>,
    sessions: State<'_, live::LiveSessions>,
    window: tauri::WebviewWindow,
    session: String,
    reason: fub_live::host::EndReason,
) -> Result<fub_live::host::StopReport, PluginError> {
    for_the_shell(
        &host,
        None,
        sessions.stop(window.label(), &session, reason).await,
    )
}
