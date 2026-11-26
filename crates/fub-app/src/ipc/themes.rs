//! Comandi IPC dei temi: elenco, lettura, cartelle installate e collegate.

use super::*;

/// Chi questo host sa montare, e chi è acceso in questo vault. Non è
/// `VaultInfo.plugins`: quello elenca chi è **dichiarato nel kernel**, e un
/// componente spento non lo è — «spento» e «non c'è» sono due stati diversi.
/// Fuori dal thread principale (`host_read`): legge il workspace.
#[tauri::command]
pub(crate) async fn list_bundles(
    app: AppHandle,
    vault: Option<String>,
) -> Result<Vec<BundleInfo>, PluginError> {
    host_read(app, "bundle list", move |host| {
        host.bundles(vault.as_deref())
    })
    .await
}
/// Elenca i temi installati che l'host ha verificato caricabili. Fuori dal
/// thread principale (`host_read`): legge e controlla le cartelle dei temi.
#[tauri::command]
pub(crate) async fn list_themes(app: AppHandle) -> Result<Vec<ThemeInfo>, PluginError> {
    host_read(app, "theme list", |host| host.themes()).await
}

/// Legge una sola luce del tema richiesto; il filesystem non attraversa l'IPC.
/// Fuori dal thread principale (`host_read`): legge un file del tema.
#[tauri::command]
pub(crate) async fn read_theme(
    app: AppHandle,
    id: String,
    light: ThemeLight,
) -> Result<ThemePayload, PluginError> {
    host_read(app, "theme read", move |host| host.read_theme(&id, light)).await
}

/// La scelta di una cartella di tema arriva da qui.
pub(crate) type ThemeFolderPick = std::sync::mpsc::Receiver<Option<tauri_plugin_dialog::FilePath>>;

/// Apre la finestra nativa per scegliere la cartella di un tema, col titolo
/// scritto dall'host, e restituisce dove arriverà la scelta (`None`: la
/// persona l'ha chiusa). Sul desktop la finestra ha per genitore quella della
/// shell.
///
/// Su Android e iOS il plugin del dialogo non ha la scelta di una cartella
/// (`pick_folder` esiste solo sul desktop): il comando risponde `Unserved`,
/// e niente si apre. I temi da cartella sono un attrezzo da sviluppatore sul
/// computer; sul telefono la cartella condivisa passa da `tree_access`.
#[cfg(desktop)]
pub(crate) fn pick_theme_folder(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    title: String,
) -> Result<ThemeFolderPick, PluginError> {
    use tauri_plugin_dialog::DialogExt;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    Ok(receiver)
}

#[cfg(mobile)]
pub(crate) fn pick_theme_folder(
    _app: &AppHandle,
    _window: &tauri::WebviewWindow,
    _title: String,
) -> Result<ThemeFolderPick, PluginError> {
    Err(PluginError::Unserved(fub_abi::Text::key(
        "host.theme_folder.desktop_only",
    )))
}

/// «Installa da cartella…»: la persona sceglie la cartella di un tema nella
/// finestra **nativa**, aperta qui, e l'host la legge senza installarla
/// (`Host::check_theme_folder`): il manifest, il fascio di ogni luce e
/// l'impronta dei byte, perché la shell faccia girare i suoi cancelli CSS
/// prima che niente arrivi nella configurazione.
///
/// La webview non dà un path e non dà nemmeno il titolo della finestra: quella
/// finestra è il punto in cui la persona dà il suo permesso, e la scrive
/// l'host (`Host::theme_folder_pick_title`). La webview riceve l'esito, con la
/// cartella scelta da mostrare. Così la modalità sviluppatore, che la webview
/// può accendere con `set_setting`, non basta a far leggere o installare una
/// cartella che la persona non ha scelto. Solo la shell principale; la
/// modalità si controlla prima di aprire la finestra, e l'host la ricontrolla.
/// Aprire la finestra scarta il permesso del controllo di prima, qualunque
/// cosa la persona scelga poi; la finestra chiusa è `cancelled`.
#[tauri::command]
pub(crate) async fn check_theme_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<fub_host::theme::ThemeFolderCheck, PluginError> {
    guard_main_shell(&window, "install themes from a folder")?;
    let title = {
        let host = app.state::<Host>();
        host.forget_theme_folder();
        let allowed = host.theme_folder_allowed();
        for_the_shell(&host, None, allowed)?;
        host.theme_folder_pick_title()
    };
    let receiver = {
        let host = app.state::<Host>();
        for_the_shell(&host, None, pick_theme_folder(&app, &window, title))?
    };
    off_main(app, move |host| {
        let result = receiver
            .recv()
            .map_err(|_| PluginError::Internal(fub_abi::Text::key("host.theme_folder.pick_failed")))
            .and_then(|selection| match selection {
                None => Ok(fub_host::theme::ThemeFolderCheck::Cancelled),
                Some(selected) => {
                    let unreadable = || {
                        PluginError::BadArgs(fub_abi::Text::key(
                            "host.theme_folder.unreadable_path",
                        ))
                    };
                    let path = selected.into_path().map_err(|_| unreadable())?;
                    let path = Utf8PathBuf::from_path_buf(path).map_err(|_| unreadable())?;
                    host.check_theme_folder(&path)
                }
            });
        for_the_shell(host, None, result)
    })
    .await
}

/// Installa la cartella che `check_theme_folder` ha fatto scegliere e ha
/// letto: `digest` dice quale controllo la shell ha visto, il path lo tiene
/// l'host (`Host::install_theme_from_folder`), che applica anche la modalità
/// sviluppatore, le porte dell'installazione e il confronto dei byte. Con
/// `replace` un tema con lo stesso id si sostituisce; senza, la collisione
/// torna come esito e niente si tocca. Solo la shell principale. La copia
/// legge e scrive il disco: fuori dal thread principale.
#[tauri::command]
pub(crate) async fn install_theme_from_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
    replace: bool,
    digest: String,
) -> Result<fub_host::theme::ThemeFolderInstall, PluginError> {
    guard_main_shell(&window, "install themes from a folder")?;
    off_main(app, move |host| {
        let result = host.install_theme_from_folder(replace, &digest);
        for_the_shell(host, None, result)
    })
    .await
}

/// Scarta la cartella che `check_theme_folder` ha controllato: la persona ha
/// risposto «no» a «Sostituisci», o il cancello della shell l'ha rifiutata
/// (`Host::forget_theme_folder`). Dopo, `install_theme_from_folder` risponde
/// `unchecked`. Solo la shell principale; niente modalità sviluppatore, perché
/// un permesso si può sempre buttare.
#[tauri::command]
pub(crate) fn discard_theme_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), PluginError> {
    guard_main_shell(&window, "install themes from a folder")?;
    app.state::<Host>().forget_theme_folder();
    Ok(())
}

/// L'evento del tema collegato verso la finestra principale: la cartella è
/// cambiata (un salvataggio, un rifiuto, la cartella sparita), col suo stato
/// (`fub_host::theme::ThemeLink`). La shell rilegge e rimonta il tema se è
/// quello in uso o in anteprima.
pub const THEME_CHANGED: &str = "fub://theme-changed";

/// «Collega una cartella…»: la persona sceglie la cartella di un tema nella
/// finestra **nativa**, aperta qui col titolo dell'host, e l'host la legge con
/// le porte dell'installazione e, se è pronta, la collega e la guarda
/// (`Host::link_theme_folder`). Come «Installa da cartella…», la webview non
/// dà un path e la modalità sviluppatore si controlla prima di aprire la
/// finestra e di nuovo nell'host. Solo la shell principale; la finestra chiusa
/// è `cancelled`, e il collegamento di prima resta.
#[tauri::command]
pub(crate) async fn link_theme_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<fub_host::theme::ThemeFolderLink, PluginError> {
    guard_main_shell(&window, "link a theme folder")?;
    let title = {
        let host = app.state::<Host>();
        let allowed = host.theme_folder_allowed();
        for_the_shell(&host, None, allowed)?;
        host.theme_link_pick_title()
    };
    let receiver = {
        let host = app.state::<Host>();
        for_the_shell(&host, None, pick_theme_folder(&app, &window, title))?
    };
    off_main(app, move |host| {
        let result = receiver
            .recv()
            .map_err(|_| PluginError::Internal(fub_abi::Text::key("host.theme_folder.pick_failed")))
            .and_then(|selection| match selection {
                None => Ok(fub_host::theme::ThemeFolderLink::Cancelled),
                Some(selected) => {
                    let unreadable = || {
                        PluginError::BadArgs(fub_abi::Text::key(
                            "host.theme_folder.unreadable_path",
                        ))
                    };
                    let path = selected.into_path().map_err(|_| unreadable())?;
                    let path = Utf8PathBuf::from_path_buf(path).map_err(|_| unreadable())?;
                    host.link_theme_folder(&path)
                }
            });
        for_the_shell(host, None, result)
    })
    .await
}

/// «Scollega»: azzera la cartella collegata e smonta l'osservatore
/// (`Host::unlink_theme_folder`). Solo la shell principale; niente modalità
/// sviluppatore, perché scollegare si può sempre.
#[tauri::command]
pub(crate) async fn unlink_theme_folder(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), PluginError> {
    guard_main_shell(&window, "link a theme folder")?;
    off_main(app, move |host| {
        let result = host.unlink_theme_folder();
        for_the_shell(host, None, result)
    })
    .await
}

/// Il tema collegato com'è adesso (`Host::theme_link`), `null` se nessuna
/// cartella è collegata o la modalità sviluppatore è spenta: Aspetto lo
/// disegna, e la shell all'avvio dice se la cartella non c'è più. Legge il
/// disco: fuori dal thread principale.
#[tauri::command]
pub(crate) async fn theme_link(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<fub_host::theme::ThemeLink>, PluginError> {
    guard_main_shell(&window, "link a theme folder")?;
    off_main(app, move |host| Ok(host.theme_link())).await
}
