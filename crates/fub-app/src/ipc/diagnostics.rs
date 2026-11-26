//! Comandi IPC della demo, della diagnostica d'avvio, del supporto e della salute della configurazione.

use super::*;

// --- superficie IPC da `support` (demo, diagnostica, recupero) ----------------
//
// Wrapper sottili: la logica resta in `support` come `pub fn` pura,
// qui solo le firme `#[tauri::command]` che delegano.
#[tauri::command]
pub(crate) fn demo_root() -> Option<String> {
    support::demo_root()
}

// La demo apre, chiude e azzera un vault: nella corsia dell'indice
// (`vault_port`), in fila con `open_vault` e `close_vault`.
#[tauri::command]
pub(crate) async fn open_demo(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
) -> Result<fub_host::support::DemoOpened, PluginError> {
    vault_port(app, &corsie, "demo open", support::open_demo).await
}

#[tauri::command]
pub(crate) async fn close_demo(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    return_to: Option<String>,
) -> Result<support::DemoClosed, PluginError> {
    vault_port(app, &corsie, "demo close", move |host, windows| {
        support::close_demo(host, windows, return_to)
    })
    .await
}

#[tauri::command]
pub(crate) async fn reset_demo(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
) -> Result<String, PluginError> {
    vault_port(app, &corsie, "demo reset", support::reset_demo).await
}

#[tauri::command]
pub(crate) fn startup_diagnostics(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<PluginError>, PluginError> {
    support::startup_diagnostics(host, vault)
}

// La schermata di supporto legge e scrive i dati che la corsia dell'indice
// scrive: l'anteprima conta le impostazioni e i vault conosciuti, l'export
// rifiuta una destinazione dentro un vault aperto o conosciuto, la salute e
// il recupero leggono e riscrivono i file di macchina. Girano fuori dal
// thread principale (l'export scrive un archivio, l'anteprima conta le righe
// di tutto il log, il recupero copia e riscrive un file) e in fila con le
// scritture di quei dati: un vault aperto subito prima dell'export è già
// escluso, e la salute chiesta dopo un'impostazione scritta la vede. Il
// recupero di `view-state.json` sta nella corsia dello stato di vista, dove
// quel file si scrive (`support::recover_lane`).
#[tauri::command]
pub(crate) async fn support_preview(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    vault: Option<String>,
    log_lines: Option<usize>,
) -> Result<fub_host::support::SupportPreview, PluginError> {
    support_preview_in_lane(app, &corsie, vault, log_lines).await
}

pub(crate) async fn support_preview_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    vault: Option<String>,
    log_lines: Option<usize>,
) -> Result<fub_host::support::SupportPreview, PluginError> {
    data_port(source, corsie, "support preview", move |host| {
        support::support_preview(host, vault.as_deref(), log_lines)
    })
    .await
}

#[tauri::command]
pub(crate) async fn support_export(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    preview: fub_host::support::SupportPreview,
    consent: fub_host::support::ExportConsent,
) -> Result<String, PluginError> {
    support_export_in_lane(app, &corsie, preview, consent).await
}

pub(crate) async fn support_export_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    preview: fub_host::support::SupportPreview,
    consent: fub_host::support::ExportConsent,
) -> Result<String, PluginError> {
    data_port(source, corsie, "support export", move |host| {
        support::support_export(host, &preview, &consent)
    })
    .await
}

#[tauri::command]
pub(crate) async fn config_health(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
) -> Result<Vec<fub_host::support::ConfigReport>, PluginError> {
    config_health_in_lane(app, &corsie).await
}

pub(crate) async fn config_health_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
) -> Result<Vec<fub_host::support::ConfigReport>, PluginError> {
    data_port(source, corsie, "config health", |host| {
        Ok(support::config_health(host))
    })
    .await
}

#[tauri::command]
pub(crate) async fn recover_config(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
    action: fub_host::support::RecoverAction,
) -> Result<fub_host::support::RecoverOutcome, PluginError> {
    recover_config_in_lane(app, &corsie, path, action).await
}

pub(crate) async fn recover_config_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    path: String,
    action: fub_host::support::RecoverAction,
) -> Result<fub_host::support::RecoverOutcome, PluginError> {
    let corsia = source.with_host(|host| support::recover_lane(host, &path));
    host_lane(source, corsie, "config recovery", corsia, move |host| {
        support::recover_config(host, &path, action)
    })
    .await
}
