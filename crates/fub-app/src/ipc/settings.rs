//! Comandi IPC delle impostazioni e dei profili di impostazioni.

use super::*;

// --- impostazioni, componenti, vault conosciuti (§11.1) --------------------
//
// **Leggere** le impostazioni non è qui**: passa da `query_index`
// (`IndexQuery::Settings`), come i tag e i backlink — un elenco è dati, e i dati
// hanno un canale solo. Qui ci sono le tre cose che dati non sono: scrivere,
// accendere un componente, e la memoria fra un avvio e l'altro.
//
// Perché scrivere passa da un comando IPC e non dal `settings.set` del registro:
// sono due autorità diverse, ed è la distinzione della decisione 0012 applicata
// alla configurazione. Da qui passa **la persona davanti allo schermo**, che ha
// cliccato su un interruttore; da `settings.set` passa un *programma*, e quello
// tocca solo le chiavi che si sono dichiarate scrivibili da un programma. Se
// fossero la stessa strada, o l'utente non potrebbe cambiare le proprie
// impostazioni di privacy, o un plugin potrebbe.

/// Scrive un'impostazione **per conto dell'utente**. Nella corsia
/// dell'indice (`data_port`): un cursore trascinato manda una scrittura a
/// ogni passo senza aspettare la risposta, e in fila vince l'ultima, sia nel
/// file sia nello zoom della finestra.
#[tauri::command]
pub(crate) async fn set_setting(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    key: String,
    value: SettingValue,
    vault: Option<String>,
) -> Result<(), PluginError> {
    set_setting_in_lane(app, &corsie, window, key, value, vault).await
}

pub(crate) async fn set_setting_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    native: impl NativeSettings,
    key: String,
    value: SettingValue,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(source, corsie, "setting", move |host| {
        let zoom = (key == fub_host::settings::APPEARANCE_ZOOM)
            .then(|| value.as_number())
            .flatten();
        // Il side effect nativo segue una scrittura riuscita: un valore
        // rifiutato non deve lasciare la finestra in uno stato che il livello
        // macchina nega.
        host.set_setting_for_user(vault.as_deref(), &key, value)?;
        if let Some(scale) = zoom {
            native.set_zoom(scale).map_err(|and| {
                PluginError::Internal(format!("native zoom not applied: {and}").into())
            })?;
        }
        if key == fub_host::settings::APPEARANCE_FRAME_RATE {
            native.set_frame_rate(frame_rate::beyond_60(&host.machine_settings()));
        }
        Ok(())
    })
    .await
}

/// Dimentica ciò che era stato deciso per una chiave: torna a valere il livello
/// sotto.
#[tauri::command]
pub(crate) async fn reset_setting(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    key: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "setting", move |host| {
        host.reset_setting_for_user(vault.as_deref(), &key)?;
        if key == fub_host::settings::APPEARANCE_ZOOM {
            NativeSettings::set_zoom(&window, fub_host::settings::DEFAULT_ZOOM).map_err(|and| {
                PluginError::Internal(format!("native zoom not reset: {and}").into())
            })?;
        }
        if key == fub_host::settings::APPEARANCE_FRAME_RATE {
            window.set_frame_rate(frame_rate::beyond_60(&host.machine_settings()));
        }
        Ok(())
    })
    .await
}

#[derive(serde::Serialize)]
pub(crate) struct SettingsProfiles {
    pub(crate) active: String,
    pub(crate) names: Vec<String>,
}

// I profili delle impostazioni stanno in fila con le scritture delle chiavi
// (`data_port`): passare a un profilo e scrivere una chiave subito dopo
// scrive nel profilo nuovo, come sul thread principale.

#[tauri::command]
pub(crate) async fn settings_profiles(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    scope: SettingScope,
    vault: Option<String>,
) -> Result<SettingsProfiles, PluginError> {
    data_port(app, &corsie, "settings profile", move |host| {
        let (active, names) = host.settings_profiles(vault.as_deref(), scope)?;
        Ok(SettingsProfiles { active, names })
    })
    .await
}

#[tauri::command]
pub(crate) async fn export_settings_profile(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<String, PluginError> {
    data_port(app, &corsie, "settings profile", move |host| {
        host.export_settings_profile(vault.as_deref(), scope, &name)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_settings_profile(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    json: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "settings profile", move |host| {
        host.import_settings_profile(vault.as_deref(), scope, &json)?;
        reapply_native(host, &window)
    })
    .await
}

#[tauri::command]
pub(crate) async fn duplicate_settings_profile(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    scope: SettingScope,
    source: String,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "settings profile", move |host| {
        host.duplicate_settings_profile(vault.as_deref(), scope, &source, &name)
    })
    .await
}

#[tauri::command]
pub(crate) async fn switch_settings_profile(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    switch_settings_profile_in_lane(app, &corsie, window, scope, name, vault).await
}

pub(crate) async fn switch_settings_profile_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    native: impl NativeSettings,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(source, corsie, "settings profile", move |host| {
        host.switch_settings_profile(vault.as_deref(), scope, &name)?;
        reapply_native(host, &native)
    })
    .await
}

#[tauri::command]
pub(crate) async fn reset_settings_profile(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    window: tauri::WebviewWindow,
    scope: SettingScope,
    name: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "settings profile", move |host| {
        host.reset_settings_profile(vault.as_deref(), scope, &name)?;
        reapply_native(host, &window)
    })
    .await
}

/// Zoom e tetto dei fotogrammi sono side effect nativi: un profilo cambiato,
/// importato o azzerato cambia il valore di macchina, e le finestre devono
/// seguirlo subito come dopo `set_setting`, non al prossimo avvio.
pub(crate) fn reapply_native(host: &Host, native: &impl NativeSettings) -> Result<(), PluginError> {
    let machine = host.machine_settings();
    native.set_frame_rate(frame_rate::beyond_60(&machine));
    let zoom = machine
        .iter()
        .find(|entry| entry.spec.key == fub_host::settings::APPEARANCE_ZOOM)
        .and_then(|entry| entry.value.as_number())
        .unwrap_or(fub_host::settings::DEFAULT_ZOOM);
    native
        .set_zoom(zoom)
        .map_err(|and| PluginError::Internal(format!("native zoom not applied: {and}").into()))
}

#[tauri::command]
pub(crate) fn frame_capabilities(host: State<Host>) -> fub_host::settings::FrameCapabilities {
    host.frame_capabilities()
}

#[tauri::command]
pub(crate) fn setting_requires_reopen(host: State<Host>, key: String) -> bool {
    host.setting_requires_reopen(&key)
}
