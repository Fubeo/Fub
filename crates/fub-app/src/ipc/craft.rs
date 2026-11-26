//! Comandi IPC dei programmi Craft della macchina, solo per la shell principale.

use super::*;

// --- «Apri con» un'app Craft e l'anteprima fatta dalla sua CLI ---------------
//
// Tre comandi della sola shell principale, come `reveal_in_system`: avviano o
// interrogano programmi della macchina, e un plugin o l'MCP, che raggiungono le
// porte generiche (`invoke_command`), non devono arrivarci. Le regole stanno
// in `fub-host` (`open_with.rs`, `craft_render.rs`); qui solo il cancello, il
// thread di lavoro e l'errore localizzato. `fub-host` ha la feature `craft`
// fra quelle di default, che l'app non spegne: i tre metodi ci sono sempre.

/// Il lavoro di uno dei comandi Craft fuori dal thread principale, con
/// l'errore dell'host nella lingua di chi guarda.
pub(crate) async fn craft_off_main<T, F>(
    app: AppHandle,
    vault: Option<String>,
    what: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host, Option<&str>) -> Result<T, PluginError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        let vault = vault.as_deref();
        for_the_shell(&host, vault, work(&host, vault))
    })
    .await
    .map_err(|error| unfinished(what, error))?
}

/// Le app Craft che aprono `doc` (percorso relativo alla radice del vault),
/// nell'ordine della tabella; senza `doc` tutte quelle che Fub conosce.
#[tauri::command]
pub(crate) async fn external_editors(
    window: tauri::WebviewWindow,
    app: AppHandle,
    vault: Option<String>,
    doc: Option<String>,
) -> Result<Vec<fub_host::open_with::ExternalEditor>, PluginError> {
    guard_main_shell(&window, "list external editors")?;
    craft_off_main(app, vault, "external editors", move |host, vault| {
        host.external_editors(vault, doc.as_deref())
    })
    .await
}

/// Apre la voce `path` del vault con l'app Craft `editor`; `page` vale per
/// PdfCraft.
#[tauri::command]
pub(crate) async fn open_with(
    window: tauri::WebviewWindow,
    app: AppHandle,
    vault: Option<String>,
    path: String,
    editor: String,
    page: Option<u32>,
) -> Result<fub_host::open_with::OpenedWith, PluginError> {
    guard_main_shell(&window, "open entries with an external editor")?;
    craft_off_main(app, vault, "open with", move |host, vault| {
        host.open_with(vault, &path, &editor, page)
    })
    .await
}

/// L'anteprima di `doc` fatta dalla CLI della sua app, dopo un gesto: mette in
/// coda il job `craft.render` e risponde subito; il risultato arriva come
/// `job_done`. Non è un comando del bundle `fub.craft`, perché avviare un
/// programma non passa dalle porte che un plugin e l'MCP raggiungono.
#[tauri::command]
pub(crate) async fn craft_render(
    window: tauri::WebviewWindow,
    app: AppHandle,
    vault: Option<String>,
    doc: String,
    size: fub_host::craft_render::PreviewSize,
) -> Result<fub_host::craft_render::CraftPreview, PluginError> {
    guard_main_shell(&window, "render previews with an external editor")?;
    craft_off_main(app, vault, "craft render", move |host, vault| {
        host.craft_render(vault, &doc, size)
    })
    .await
}
