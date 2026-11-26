//! Comandi IPC del telefono: cattura, archivi, alberi condivisi.

use super::*;

// --- superficie IPC da `mobile` (boundary OS sopra lo stesso Host) ----------
#[tauri::command]
pub(crate) fn mobile_validate_capture(
    payload: fub_host::automation::CapturePayloadV1,
) -> Result<(), PluginError> {
    mobile::mobile_validate_capture(payload)
}

#[tauri::command]
pub(crate) fn mobile_submit_capture(
    host: State<Host>,
    payload: fub_host::automation::CapturePayloadV1,
    vault: Option<String>,
    template: Option<String>,
) -> Result<String, PluginError> {
    mobile::mobile_submit_capture(host, payload, vault, template)
}

#[tauri::command]
pub(crate) fn mobile_storage_roots(app: AppHandle) -> mobile::MobileStorageInfo {
    mobile::mobile_storage_roots(app)
}

#[tauri::command]
pub(crate) fn mobile_storage_preference(
    app: AppHandle,
) -> Result<mobile::MobileStoragePreference, PluginError> {
    mobile::mobile_storage_preference(app)
}

#[tauri::command]
pub(crate) fn mobile_set_storage_preference(
    app: AppHandle,
    preference: mobile::MobileStoragePreference,
) -> Result<mobile::MobileStoragePreference, PluginError> {
    mobile::mobile_set_storage_preference(app, preference)
}

#[tauri::command]
pub(crate) fn mobile_wasm_report() -> mobile::MobileWasmReport {
    mobile::mobile_wasm_report()
}

#[tauri::command]
pub(crate) fn mobile_classify_opened_url(
    raw: String,
) -> Result<mobile::MobileOpenedUrl, PluginError> {
    mobile::mobile_classify_opened_url(raw)
}

#[tauri::command]
pub(crate) fn mobile_register_tree_grant(
    grant: mobile::MobileTreeGrant,
) -> Result<mobile::MobileTreeGrant, PluginError> {
    mobile::mobile_register_tree_grant(grant)
}

/// La proposta di mount per la cartella condivisa. Il permesso lo chiede qui
/// al sistema operativo (`tree_access`) e il CAS lo dice la piattaforma: i due
/// booleani del webview restano nella firma per compatibilità e non decidono.
#[tauri::command]
pub(crate) async fn mobile_shared_mount_mode(
    app: AppHandle,
    grant: Option<mobile::MobileTreeGrant>,
    backend_cas: bool,
    copy_accepted: bool,
) -> Result<mobile::MobileMountMode, PluginError> {
    #[cfg(mobile)]
    {
        let _ = backend_cas;
        let Some(grant) = grant else {
            return Ok(mobile::MobileMountMode::NeedGrant);
        };
        let mode = on_tree(&app, move |tree| {
            let permission = tree.verify(&grant);
            let cas = tree_access::backend_cas(&grant);
            Ok(mobile::verified_mount_mode(
                &grant,
                permission,
                cas,
                copy_accepted,
            ))
        })
        .await;
        // Senza plugin nativo la proposta resta quella di sempre.
        Ok(mode.unwrap_or(mobile::MobileMountMode::NeedGrant))
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(mobile::mobile_shared_mount_mode(
            grant,
            backend_cas,
            copy_accepted,
        ))
    }
}

// --- la cartella condivisa (P14/F37): il sistema operativo risponde ---------
//
// Il picker, la verifica del permesso, l'accesso e la copia li fa il codice
// nativo (`tree_access.rs`), che questi comandi raggiungono fuori dal thread
// principale: il picker è un'interfaccia del sistema, e aspettarlo lì
// fermerebbe proprio chi lo deve mostrare. Sul desktop rispondono `Unserved`.

#[cfg(mobile)]
pub(crate) async fn on_tree<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&tree_access::TreeAccess) -> Result<T, PluginError> + Send + 'static,
) -> Result<T, PluginError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let tree = app
            .try_state::<tree_access::TreeAccess>()
            .ok_or_else(no_native_tree)?;
        work(&*tree)
    })
    .await
    .map_err(|error| {
        PluginError::Internal(fub_abi::text::Text::message(
            "host.mobile.native_failed",
            vec![fub_abi::text::Arg::text("reason", error.to_string())],
        ))
    })?
}

pub(crate) fn no_native_tree() -> PluginError {
    PluginError::Unserved(fub_abi::text::Text::key("host.mobile.no_native"))
}

/// Il picker di cartella del sistema. `None`: la persona l'ha chiuso.
#[tauri::command]
pub(crate) async fn mobile_pick_tree(
    app: AppHandle,
    host: State<'_, Host>,
) -> Result<Option<mobile::MobileTreeGrant>, PluginError> {
    #[cfg(mobile)]
    let picked = on_tree(&app, |tree| tree.pick()).await;
    #[cfg(not(mobile))]
    let picked = {
        let _ = app;
        Err(no_native_tree())
    };
    for_the_shell(&host, None, picked)
}

/// Il permesso del sistema sul grant, adesso: una ricevuta salvata non basta.
#[tauri::command]
pub(crate) async fn mobile_verify_tree(
    app: AppHandle,
    grant: mobile::MobileTreeGrant,
) -> Result<mobile::MobilePermissionState, PluginError> {
    #[cfg(mobile)]
    return Ok(on_tree(&app, move |tree| Ok(tree.verify(&grant)))
        .await
        .unwrap_or(mobile::MobilePermissionState::Unknown));
    #[cfg(not(mobile))]
    {
        let _ = (app, grant);
        Ok(mobile::MobilePermissionState::Unknown)
    }
}

/// iOS: apre l'accesso alla cartella e ne restituisce il path, che da qui in
/// poi `open_vault` accetta. Android non ha un path: la cartella si copia.
#[tauri::command]
pub(crate) async fn mobile_open_shared(
    app: AppHandle,
    host: State<'_, Host>,
    grant: mobile::MobileTreeGrant,
) -> Result<String, PluginError> {
    #[cfg(mobile)]
    let opened = on_tree(&app, move |tree| tree.open_shared(&grant))
        .await
        .map(Utf8PathBuf::into_string);
    #[cfg(not(mobile))]
    let opened = {
        let _ = (app, grant);
        Err(no_native_tree())
    };
    for_the_shell(&host, None, opened)
}

/// Chiude la cartella condivisa aperta: prima il vault, poi l'accesso del
/// sistema. Restituisce ciò che non è diventato durevole chiudendo, come
/// `close_vault`.
#[tauri::command]
pub(crate) async fn mobile_close_shared(
    app: AppHandle,
    host: State<'_, Host>,
    windows: State<'_, document_windows::DocumentWindows>,
) -> Result<Vec<PluginError>, PluginError> {
    #[cfg(mobile)]
    {
        let Some(tree) = app.try_state::<tree_access::TreeAccess>() else {
            return Ok(Vec::new());
        };
        let Some(root) = tree.shared_root() else {
            return Ok(Vec::new());
        };
        let report = if host.vaults().iter().any(|open| *open == root) {
            for_the_shell(
                &host,
                None,
                document_windows::close_vault(&host, &windows, root.as_str()),
            )?
        } else {
            Vec::new()
        };
        let closing = app.clone();
        let _ = on_tree(&closing, |tree| {
            tree.close_shared();
            Ok(())
        })
        .await;
        Ok(report)
    }
    #[cfg(not(mobile))]
    {
        let _ = (app, host, windows);
        Ok(Vec::new())
    }
}

/// Android: copia la cartella condivisa in una sottocartella nuova del vault
/// privato. Niente si sovrascrive; il vault da aprire è il privato.
#[tauri::command]
pub(crate) async fn mobile_copy_tree(
    app: AppHandle,
    host: State<'_, Host>,
    grant: mobile::MobileTreeGrant,
) -> Result<MobileCopy, PluginError> {
    #[cfg(mobile)]
    let copied = {
        let private = mobile::private_vault_root(&app);
        on_tree(&app, move |tree| {
            let private = private.ok_or_else(no_native_tree)?;
            let (folder, copied) = tree.copy_into(&grant, &private)?;
            Ok(MobileCopy {
                vault: private.into_string(),
                folder: folder.into_string(),
                copied,
            })
        })
        .await
    };
    #[cfg(not(mobile))]
    let copied = {
        let _ = (app, grant);
        Err(no_native_tree())
    };
    for_the_shell(&host, None, copied)
}

/// L'esito di `mobile_copy_tree`: il vault da aprire, la cartella nuova e
/// quanto è stato copiato.
#[derive(serde::Serialize)]
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) struct MobileCopy {
    pub(crate) vault: String,
    pub(crate) folder: String,
    #[serde(flatten)]
    pub(crate) copied: tree_access::Copied,
}
