//! Comandi IPC del disegno, con porte tipizzate e nominate.

use super::*;

// Il disegno sul motore (K5, `docs/reference/drawing-ipc.md`): sei porte
// tipate come quelle della griglia. Il motore lavora fuori dal thread
// principale: un'apertura importa il disegno, un gesto aspetta il reimport
// della copia. L'ordine delle richieste di un'istanza lo tiene la sessione del
// motore nel client, che le manda una alla volta. Senza il motore in questa
// build ogni porta risponde `unserved` (`fub_host::drawing`).

/// Il lavoro di una porta del disegno, fuori dal thread principale, con
/// l'errore nella lingua della shell ([`drawing_for_the_shell`]).
pub(crate) async fn drawing_port<T, F>(
    app: AppHandle,
    vault: Option<String>,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host, Option<&str>) -> Result<T, PluginError> + Send + 'static,
{
    off_main(app, move |host| {
        drawing_for_the_shell(host, vault.as_deref(), work)
    })
    .await
}

/// L'esito di `work` con l'errore passato da [`for_the_shell`]: l'host dice
/// il motore spento con una chiave del suo catalogo, che sul filo sarebbe un
/// oggetto, e il client riconosce un `unserved` solo da un messaggio che è
/// una frase (`asPluginError` di `host/errors.ts`). Senza, il motore spento
/// si leggerebbe come un guasto, e il disegno riaperto resterebbe «fermo».
pub(crate) fn drawing_for_the_shell<T>(
    host: &Host,
    vault: Option<&str>,
    work: impl FnOnce(&Host, Option<&str>) -> Result<T, PluginError>,
) -> Result<T, PluginError> {
    for_the_shell(host, vault, work(host, vault))
}

/// Apre un'istanza del motore sul testo del disegno `doc` (a capo LF).
#[tauri::command]
pub(crate) async fn open_drawing(
    app: AppHandle,
    doc: String,
    text: String,
    vault: Option<String>,
) -> Result<DrawingOpen, PluginError> {
    let doc = doc_id(&doc)?;
    drawing_port(app, vault, move |host, vault| {
        host.drawing_open(vault, &doc, &text)
    })
    .await
}

/// Porta all'istanza un cambio del testo del disegno.
#[tauri::command]
pub(crate) async fn drawing_sync(
    app: AppHandle,
    instance: String,
    sync: DrawingSync,
    vault: Option<String>,
) -> Result<DrawingSynced, PluginError> {
    drawing_port(app, vault, move |host, vault| {
        host.drawing_sync(vault, &instance, sync)
    })
    .await
}

/// Un pezzo di gesto: risponde l'anteprima o le operazioni di scena.
#[tauri::command]
pub(crate) async fn drawing_gesture(
    app: AppHandle,
    instance: String,
    gesture: DrawingGesture,
    vault: Option<String>,
) -> Result<DrawingOutcome, PluginError> {
    drawing_port(app, vault, move |host, vault| {
        host.drawing_gesture(vault, &instance, gesture)
    })
    .await
}

/// I comandi del disegno, accesi o spenti sulla selezione.
#[tauri::command]
pub(crate) async fn drawing_commands(
    app: AppHandle,
    instance: String,
    selection: Vec<String>,
    vault: Option<String>,
) -> Result<Vec<DrawingCommandInfo>, PluginError> {
    drawing_port(app, vault, move |host, vault| {
        host.drawing_commands(vault, &instance, &selection)
    })
    .await
}

/// Un comando del disegno sulla selezione.
#[tauri::command]
pub(crate) async fn drawing_command(
    app: AppHandle,
    instance: String,
    request: DrawingCommandRequest,
    vault: Option<String>,
) -> Result<DrawingOutcome, PluginError> {
    drawing_port(app, vault, move |host, vault| {
        host.drawing_command(vault, &instance, request)
    })
    .await
}

/// Chiude l'istanza del motore.
#[tauri::command]
pub(crate) async fn close_drawing(
    app: AppHandle,
    instance: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    drawing_port(app, vault, move |host, vault| {
        host.drawing_close(vault, &instance)
    })
    .await
}
