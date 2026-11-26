//! Comandi IPC delle view dichiarative e del loro stato.

use super::*;

/// Le view offerte dai provider registrati, nell'ordine di registrazione.
///
/// È la metà "discovery" del protocollo: la shell non cabla gli id — monta
/// ogni view nel contenitore del suo `placement` e la ridisegna quando arriva
/// un evento della sua maschera `refresh`. Una view di plugin compare da sola.
/// Fuori dal thread principale (`host_read`).
#[tauri::command]
pub(crate) async fn list_views(
    app: AppHandle,
    vault: Option<String>,
) -> Result<Vec<ViewSpec>, PluginError> {
    host_read(app, "view list", move |host| host.views(vault.as_deref())).await
}

/// Rende l'albero `UiNode` di **un'istanza** di view. Il render è una lettura:
/// prende il workspace in prestito condiviso, non in esclusiva.
///
/// L'istanza arriva dalla shell, che è chi apre: `instance` la distingue dalle
/// sorelle e `params` sono i suoi argomenti (§2.3). Per la view che la shell
/// monta da sé — una sola, senza parametri — è
/// [`ViewInstance::only`](fub_abi::traits::ViewInstance::only), e questo
/// comando accetta i due campi assenti proprio per non obbligarla a costruirla.
///
/// Gira fuori dal thread principale, nella corsia delle viste (`domande`): un
/// salvataggio invecchia una ventina di view e la shell le ridisegna tutte
/// insieme. Sul thread principale erano 100 ms di finestra ferma a ogni
/// salvataggio di una nota lunga; in corsia i disegni restano in fila fra loro
/// e la finestra continua a presentare fotogrammi.
#[tauri::command]
pub(crate) async fn render_view(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<UiNode, PluginError> {
    corsie
        .chiedi("view render", domande::CORSIA_VISTE.into(), move || {
            app.state::<Host>()
                .render_view(vault.as_deref(), &view_instance(view, instance, params))
        })
        .await
}

/// Consegna un'azione della UI al provider della view e restituisce il suo
/// aggiornamento (`Replace`/`Patch`/`Navigate`/`None`), che il frontend
/// interpreta.
///
/// `payload` è ciò che il provider aveva attaccato al nodo; `fields` è lo stato
/// dei campi di input che la shell ha raccolto. Sono due cose con due
/// proprietari (§2.7), e il fatto che arrivino come due argomenti distinti è
/// ciò che impedisce alla shell di riscrivere il primo.
///
/// Chiama il provider della view, che può essere un plugin: gira nella corsia
/// delle viste, con i disegni (`domande::CORSIA_VISTE`). Un disegno chiesto
/// dopo l'azione la vede, come sul thread principale, e le risposte escono
/// nell'ordine in cui lo stato del provider è cambiato.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn view_action(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    action: String,
    payload: Option<serde_json::Value>,
    fields: Option<Vec<FieldValue>>,
    vault: Option<String>,
) -> Result<ViewUpdate, PluginError> {
    let instance = view_instance(view, instance, params);
    let action = UiAction {
        action: ActionId(action),
        payload: payload.unwrap_or(serde_json::Value::Null),
        fields: fields.unwrap_or_default(),
    };
    view_action_in_lane(app, &corsie, instance, action, vault).await
}

pub(crate) async fn view_action_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    instance: ViewInstance,
    action: UiAction,
    vault: Option<String>,
) -> Result<ViewUpdate, PluginError> {
    host_lane(
        source,
        corsie,
        "view action",
        domande::CORSIA_VISTE,
        move |host| host.view_action(vault.as_deref(), &instance, action),
    )
    .await
}

/// L'istanza che la shell nomina, con i due default dell'esemplare unico.
pub(crate) fn view_instance(
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
) -> ViewInstance {
    ViewInstance {
        instance: instance.unwrap_or_else(|| view.clone()),
        view,
        params: params.unwrap_or(serde_json::Value::Null),
    }
}

// --- lo stato di vista della shell (§11.2) ---------------------------------
//
// La shell **non è un plugin**: non ha un manifest, non le si concedono
// capacità, e passa dall'API del `Workspace` invece che dall'`HostApi`. Per
// questo qui proprietario ed esemplare sono argomenti di una funzione e non
// qualcosa che l'host timbra — ma li timbra comunque **questa porta**, non il
// webview: se arrivassero da JS, una pagina qualunque potrebbe rileggere (e
// riscrivere) lo stato di vista di un provider. È la stessa riga dell'id di un
// job nella decisione 0035, applicata al confine di sotto.

/// Il proprietario sotto cui va lo stato di vista della shell. Un id come quello
/// di un plugin, e col prefisso del progetto: divide il recinto della shell da
/// quello di chiunque altro, senza fare di lei un caso speciale nel formato.
pub(crate) const SHELL_OWNER: &str = "fub.shell";

/// L'esemplare della shell. **Uno solo**, oggi, e dichiararlo qui è più onesto
/// che lasciarlo implicito: l'area principale è un pannello solo, quindi non c'è
/// niente da distinguere. Quando arriverà il modello di layout (§1.2) i pannelli
/// avranno un esemplare per uno, e sarà quello a comparire qui.
pub(crate) const SHELL_INSTANCE: &str = "window";

/// Ciò che la shell aveva salvato sotto questa chiave, per **questo vault** e su
/// **questa macchina**.
///
/// `None` è il caso normale del primo avvio, non un errore: chi non ha mai
/// salvato niente disegna il proprio default.
///
/// Gira nella corsia dello stato di vista (`domande::CORSIA_STATO`), la stessa
/// delle scritture: una lettura chiesta dopo una scrittura la vede.
#[tauri::command]
pub(crate) async fn view_state(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    key: String,
    vault: Option<String>,
) -> Result<Option<serde_json::Value>, PluginError> {
    view_state_in_lane(app, &corsie, key, vault).await
}

pub(crate) async fn view_state_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    key: String,
    vault: Option<String>,
) -> Result<Option<serde_json::Value>, PluginError> {
    host_lane(
        source,
        corsie,
        "view state",
        domande::CORSIA_STATO,
        move |host| host.view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key),
    )
    .await
}

/// Salva (`Some`) o dimentica (`None`) lo stato di vista della shell.
///
/// Ogni scrittura rilegge e riscrive un file: fuori dal thread principale,
/// nella corsia dello stato di vista (`domande::CORSIA_STATO`). La shell
/// scrive anche senza aspettare (la scheda scelta nell'ispettore, a ogni
/// clic), e in fila la seconda scrittura della stessa chiave non è mai
/// coperta dalla prima.
#[tauri::command]
pub(crate) async fn set_view_state(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    key: String,
    value: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    set_view_state_in_lane(app, &corsie, key, value, vault).await
}

pub(crate) async fn set_view_state_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    key: String,
    value: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host_lane(
        source,
        corsie,
        "view state write",
        domande::CORSIA_STATO,
        move |host| host.set_view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key, value),
    )
    .await
}
