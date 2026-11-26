//! Comandi IPC degli artefatti: salvare, stampare, mostrare nel sistema.

use super::*;

// `pending_opened_urls`, `mobile_pending_opened_urls` e `release_info` non ci
// sono più: nessuna riga di `apps/client/src` li invocava. Sul desktop la coda
// di recupero è dell'host (`uri.pending`, un comando come gli altri), e
// `fub://pending-action` è il campanello; `fub://opened-url` del mobile resta
// una spinta senza coda.

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum SaveArtifactOutcome {
    Saved { path: String },
    Cancelled,
}

/// Chi passa un artefatto al sistema: la finestra principale, sulla sua
/// origine locale. `what` dice che cosa le altre non possono fare.
pub(crate) fn guard_main_shell(
    window: &tauri::WebviewWindow,
    what: &str,
) -> Result<(), PluginError> {
    let origin = window
        .url()
        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
    main_shell_only(window.label(), origin.as_str(), what)
}

/// La regola di [`guard_main_shell`] su label e origin letti lato nativo:
/// una finestra locale fidata, e fra queste soltanto `main`.
pub(crate) fn main_shell_only(label: &str, origin: &str, what: &str) -> Result<(), PluginError> {
    resources::guard_trusted_local(label, origin)?;
    if label != "main" {
        return Err(PluginError::PermissionDenied(
            format!("only the main shell may {what}").into(),
        ));
    }
    Ok(())
}

/// Un PDF: il suo tipo di contenuto, e come cominciano i suoi byte.
pub(crate) const PDF: (&str, &[u8]) = ("application/pdf", b"%PDF-");

/// Un artefatto che si passa al sistema: un nome di file senza cartelle, un
/// tipo di contenuto, al più 64 MiB. Con `only`, il tipo dev'essere quello e
/// i byte devono cominciare come lui.
pub(crate) fn check_artifact(
    suggested_name: &str,
    media_type: &str,
    bytes: &[u8],
    only: Option<(&str, &[u8])>,
) -> Result<(), PluginError> {
    if suggested_name.is_empty()
        || suggested_name == "."
        || suggested_name == ".."
        || suggested_name.len() > 255
        || suggested_name.contains(['/', '\\'])
        || suggested_name.chars().any(char::is_control)
    {
        return Err(PluginError::BadArgs(
            "artifact name must be a safe basename".into(),
        ));
    }
    if media_type.is_empty()
        || media_type.len() > 128
        || !media_type
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'+' | b'-'))
        || !media_type.contains('/')
        || only.is_some_and(|(wanted, magic)| media_type != wanted || !bytes.starts_with(magic))
    {
        return Err(PluginError::BadArgs("invalid artifact media type".into()));
    }
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(PluginError::BadArgs(
            "artifact exceeds the 64 MiB limit".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_artifact(
    app: AppHandle,
    window: tauri::WebviewWindow,
    suggested_name: String,
    media_type: String,
    bytes: Vec<u8>,
) -> Result<SaveArtifactOutcome, PluginError> {
    use tauri_plugin_dialog::DialogExt;
    guard_main_shell(&window, "save artifacts")?;
    check_artifact(&suggested_name, &media_type, &bytes, None)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let dialog = app.dialog().file();
    // Il genitore della finestra di dialogo esiste solo sul desktop.
    #[cfg(desktop)]
    let dialog = dialog.set_parent(&window);
    dialog
        .set_file_name(suggested_name)
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = receiver
            .recv()
            .map_err(|_| PluginError::Internal("native save dialog did not return".into()))?
        else {
            return Ok(SaveArtifactOutcome::Cancelled);
        };
        let path = selected.into_path().map_err(|error| {
            PluginError::BadArgs(format!("native save destination unavailable: {error}").into())
        })?;
        let parent = path
            .parent()
            .ok_or_else(|| PluginError::BadArgs("native save destination has no parent".into()))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| PluginError::Io(format!("cannot prepare artifact: {error}").into()))?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|error| PluginError::Io(format!("cannot write artifact: {error}").into()))?;
        temp.persist(&path)
            .map_err(|error| PluginError::Io(format!("cannot publish artifact: {error}").into()))?;
        Ok(SaveArtifactOutcome::Saved {
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|error| unfinished("save", error))?
}

/// Il lavoro `what` di un comando, su un altro thread, che non è finito.
pub(crate) fn unfinished(what: &str, error: impl std::fmt::Display) -> PluginError {
    PluginError::Internal(format!("{what} task did not complete: {error}").into())
}

/// «Stampa…»: il PDF di un export va nel programma che il sistema usa per i
/// PDF, da cui si stampa (`print.rs`). Soltanto un PDF, e soltanto dalla
/// shell.
#[tauri::command]
pub(crate) async fn print_artifact(
    window: tauri::WebviewWindow,
    suggested_name: String,
    media_type: String,
    bytes: Vec<u8>,
) -> Result<print::PrintOutcome, PluginError> {
    guard_main_shell(&window, "print artifacts")?;
    check_artifact(&suggested_name, &media_type, &bytes, Some(PDF))?;
    tauri::async_runtime::spawn_blocking(move || print::open_for_print(&suggested_name, &bytes))
        .await
        .map_err(|error| unfinished("print", error))
}

/// «Mostra nel file manager» e «Apri con l'app di sistema»: una voce del
/// vault, per percorso relativo alla radice, passa al sistema (`reveal.rs`).
/// Soltanto dalla shell, e soltanto dentro il vault.
#[tauri::command]
pub(crate) async fn reveal_in_system(
    window: tauri::WebviewWindow,
    host: State<'_, Host>,
    vault: Option<String>,
    path: String,
    open: bool,
) -> Result<reveal::RevealOutcome, PluginError> {
    guard_main_shell(&window, "reveal entries")?;
    let root = host.root(vault.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || reveal::hand_over(root.as_std_path(), &path, open))
        .await
        .map_err(|error| unfinished("reveal", error))?
}
