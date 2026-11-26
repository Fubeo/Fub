//! Comandi IPC dei vault: aprire, elencare, scegliere il corrente, chiudere, ricordare.

use super::*;

/// I vault aperti e quale è il corrente (§9.6): rispecchiato da `OpenVaults` in
/// `apps/client/src/host/contract.ts`.
///
/// Il "corrente" è una comodità della shell e non un'assunzione del backend:
/// serve a chi non nomina un vault, e chi ne ha due davanti li nomina.
#[derive(serde::Serialize)]
pub struct OpenVaults {
    pub roots: Vec<String>,
    pub current: Option<String>,
}

/// Apre un vault e lo rende corrente. Fuori dal thread principale, nella
/// corsia dell'indice (`domande::CORSIA_INDICE`): aprire monta i provider e
/// legge il disco, e una domanda mandata dopo deve trovare il vault nuovo.
#[tauri::command]
pub(crate) async fn open_vault(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
) -> Result<VaultInfo, PluginError> {
    // Su mobile si monta il vault privato, che il backend risolve da sé nella
    // sandbox, o la cartella condivisa che il codice nativo ha consegnato per
    // un grant verificato (`mobile_open_shared`): nessun altro path.
    #[cfg(mobile)]
    return host_lane(
        app.clone(),
        &corsie,
        "vault open",
        domande::CORSIA_INDICE,
        move |host| {
            for_the_shell(
                host,
                None,
                mobile::open_mobile_vault(
                    host,
                    mobile::private_vault_root(&app).as_deref(),
                    app.try_state::<tree_access::TreeAccess>()
                        .and_then(|tree| tree.shared_root())
                        .as_deref(),
                    &path,
                ),
            )
        },
    )
    .await;
    #[cfg(not(mobile))]
    open_vault_in_lane(app, &corsie, path).await
}

// Su mobile `open_vault` apre da sé: questa resta per il desktop e le prove.
#[cfg_attr(mobile, allow(dead_code))]
pub(crate) async fn open_vault_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    path: String,
) -> Result<VaultInfo, PluginError> {
    // Il lock di scrittura fra processi lo prende l'host aprendo, e lo lascia
    // chiudendo: qui non c'è niente da tenere. Un altro scrittore è un
    // conflitto con la sua chiave, che la shell legge come frase.
    host_lane(
        source,
        corsie,
        "vault open",
        domande::CORSIA_INDICE,
        move |host| for_the_shell(host, None, host.open(Utf8Path::new(&path))),
    )
    .await
}

// --- i vault aperti (§9.6) -------------------------------------------------
//
// L'host tiene una **mappa** di sessioni e sa qual è la corrente: ogni comando
// qui sotto accetta un `vault` opzionale, e chi non lo passa parla con la
// corrente — che è ciò che la shell fa oggi, con una finestra sola. I tre
// comandi che seguono sono il minimo che serve a chi vorrà fare altrimenti: sapere
// quali sono aperti, sceglierne uno, e chiuderne uno senza chiudere l'app.

/// I vault aperti, e quale è il corrente.
#[tauri::command]
pub(crate) fn list_vaults(host: State<Host>) -> OpenVaults {
    OpenVaults {
        roots: host.vaults().into_iter().map(|r| r.to_string()).collect(),
        current: host.current().map(|r| r.to_string()),
    }
}

/// Rende corrente un vault già aperto. Aprirne uno nuovo lo fa `open_vault`,
/// che lo rende corrente da sé. Nella corsia dell'indice: una domanda senza
/// vault mandata dopo parla con quello scelto qui.
#[tauri::command]
pub(crate) async fn set_current_vault(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
) -> Result<(), PluginError> {
    set_current_vault_in_lane(app, &corsie, path).await
}

pub(crate) async fn set_current_vault_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    path: String,
) -> Result<(), PluginError> {
    host_lane(
        source,
        corsie,
        "current vault",
        domande::CORSIA_INDICE,
        move |host| host.set_current(&Utf8PathBuf::from(path)),
    )
    .await
}

/// Chiude un vault: flush, `close` degli indici, disattivazione dei plugin
/// (§9.5). Restituisce **ciò che è andato storto chiudendo**, che non è un
/// motivo per non chiudere: la lista è quasi sempre vuota, e quando non lo è
/// dice cosa non è diventato durevole — **con la specie di ciascuno**, come
/// ogni altro errore che esce di qui (decisione 0041): una lista di frasi
/// avrebbe fatto la stessa figura a schermo e tolto alla shell l'unica cosa su
/// cui può ramificare.
/// Una finestra documento attiva trattiene quel vault: chiuderlo prima della
/// conferma di distruzione nativa perderebbe la sessione autorevole.
/// Nella corsia dell'indice, in fila con l'apertura: chiudere e riaprire lo
/// stesso vault di fila lo lascia aperto.
#[tauri::command]
pub(crate) async fn close_vault(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
) -> Result<Vec<PluginError>, PluginError> {
    close_vault_in_lane(app, &corsie, path).await
}

pub(crate) async fn close_vault_in_lane(
    source: impl WindowsSource,
    corsie: &domande::Corsie,
    path: String,
) -> Result<Vec<PluginError>, PluginError> {
    vault_port(source, corsie, "vault close", move |host, windows| {
        document_windows::close_vault(host, windows, &path)
    })
    .await
}

/// Il lavoro di un comando che chiude o cambia un vault davanti alle finestre
/// documento (`close_vault`, la demo), nella corsia dell'indice, in fila con
/// `open_vault` e `set_current_vault`.
pub(crate) async fn vault_port<T, F>(
    source: impl WindowsSource,
    corsie: &domande::Corsie,
    cosa: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host, &document_windows::DocumentWindows) -> Result<T, PluginError> + Send + 'static,
{
    corsie
        .chiedi(cosa, domande::CORSIA_INDICE.into(), move || {
            source.with_windows(work)
        })
        .await
}

/// Path del vault da aprire all'avvio: l'override di ambiente (`FUB_VAULT`)
/// se non vuoto, altrimenti l'ultimo vault aperto ancora sul disco. Il
/// frontend lo legge e apre il vault senza passare dal dialogo. Su mobile è il
/// vault privato, se è la scelta salvata.
#[tauri::command]
pub(crate) fn initial_vault(app: AppHandle, host: State<Host>) -> Option<String> {
    #[cfg(mobile)]
    {
        let _ = host;
        mobile::initial_private_vault(&app)
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        fub_host::initial_vault().or_else(|| host.last_vault())
    }
}

/// **L'avviso di sessione** (§25.5): la diagnosi «la cartella di configurazione
/// non si può scrivere» (o non c'è), come `Event::Trouble` di severità
/// `Warning`, una volta per sessione.
///
/// È un **tiraggio** e non una spinta all'avvio: quando la diagnosi nasce
/// (`install_logging`) non esiste ancora né l'handle del webview né il ponte —
/// che parte al primo vault aperto — né l'ascoltatore della shell. Una spinta
/// a quell'ora sarebbe emessa nel vuoto e persa in silenzio; un comando chiesto
/// dalla shell dopo che il router è attaccato è l'unico istante in cui la
/// consegna è garantita dall'ordine dell'IPC. Il secondo chiamante (un test, un
/// altro frontend) trova la risposta già consumata: `None`.
#[tauri::command]
pub(crate) fn session_notice(host: State<Host>) -> Option<fub_abi::Notice> {
    host.session_notice()
}

// I vault conosciuti e le scorciatoie proposte da un vault stanno nella
// corsia dell'indice (`data_port`): l'elenco lo aggiorna anche `open_vault`,
// e le scorciatoie adottate sono impostazioni che le domande leggono.

/// I vault che questa macchina conosce: preferiti, poi recenti.
#[tauri::command]
pub(crate) async fn known_vaults(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
) -> Result<Vec<VaultEntry>, PluginError> {
    data_port(app, &corsie, "known vaults", |host| Ok(host.known_vaults())).await
}

#[tauri::command]
pub(crate) async fn set_vault_favorite(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
    favorite: bool,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "known vaults", move |host| {
        host.set_vault_favorite(&Utf8PathBuf::from(path), favorite)
    })
    .await
}

/// L'aspetto con cui un vault compare nell'elenco: **tutto quanto**, nelle
/// stesse forme in cui `known_vaults` lo restituisce. L'icona che non c'è è
/// `null`, il nome che nessuno ha scelto è la stringa vuota — e questa è
/// l'unica lettura possibile della firma, che è ciò che un `null` sul nome non
/// sarebbe stato.
#[tauri::command]
pub(crate) async fn set_vault_look(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
    icon: Option<String>,
    name: String,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "known vaults", move |host| {
        host.set_vault_look(&Utf8PathBuf::from(path), icon, name)
    })
    .await
}

/// Toglie un vault dall'elenco dei conosciuti. **Non lo cancella dal disco.**
#[tauri::command]
pub(crate) async fn forget_vault(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "known vaults", move |host| {
        host.forget_vault(&Utf8PathBuf::from(path))
    })
    .await
}
