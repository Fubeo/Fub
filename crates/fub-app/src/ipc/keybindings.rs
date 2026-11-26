//! Comandi IPC delle scorciatoie in attesa di essere adottate.

use super::*;

/// Le scorciatoie che questo vault propone e che nessuno ha ancora guardato
/// (§23.13): chiave d'impostazione → accordo.
#[tauri::command]
pub(crate) async fn pending_keybindings(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    vault: Option<String>,
) -> Result<std::collections::BTreeMap<String, String>, PluginError> {
    data_port(app, &corsie, "keybindings", move |host| {
        host.pending_keybindings(vault.as_deref())
    })
    .await
}

/// «Usa le sue»: le scorciatoie del vault valgono da adesso.
#[tauri::command]
pub(crate) async fn adopt_keybindings(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "keybindings", move |host| {
        host.adopt_keybindings(vault.as_deref())
    })
    .await
}

/// «Tieni le mie»: le scorciatoie del vault escono dal suo file.
#[tauri::command]
pub(crate) async fn discard_keybindings(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "keybindings", move |host| {
        host.discard_keybindings(vault.as_deref())
    })
    .await
}
