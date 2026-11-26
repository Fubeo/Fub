//! Comandi IPC dell'indice, dei lavori e dei dati dell'albero (icone, fissati, spazi, ordine).

use super::*;

/// Il canale dati, **generico**: il gemello di `render_view`/`view_action`.
///
/// Erano quattro comandi — `search`, `list_tags`, `graph_data` e `backlinks` —
/// e i primi tre avvolgevano lo stesso `query_index` mentre il quarto lo
/// **scavalcava**, chiamando il grafo del kernel diretto. Il problema non era la
/// ripetizione: era che un provider può fare qualunque query e la shell no, e
/// che ogni variante nuova del canale dati avrebbe richiesto un comando in più.
///
/// Con questo comando la shell ha le stesse capacità di un plugin: il grafo
/// smette di avere un canale privilegiato, i backlink smettono di avere il
/// proprio, e la dieta dell'IPC (§16.6) diventa praticabile — un'allowlist che
/// vieta i comandi bespoke non deve più dire di no a feature che non hanno altra
/// strada.
///
/// Gira fuori dal thread principale, in fila (`domande`): una domanda può
/// durare centinaia di millisecondi — il correttore che controlla una nota
/// lunga (`fub.proof`), una ricerca su un vault grande — e sul thread
/// principale ferma la finestra, che per tutto quel tempo non presenta
/// fotogrammi. Le domande di una stessa corsia rispondono nell'ordine in cui
/// sono entrate, come prima.
#[tauri::command]
pub(crate) async fn query_index(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    query: IndexQuery,
    vault: Option<String>,
) -> Result<IndexResult, PluginError> {
    query_index_in_lane(app, &corsie, query, vault).await
}

pub(crate) async fn query_index_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    query: IndexQuery,
    vault: Option<String>,
) -> Result<IndexResult, PluginError> {
    let corsia = domande::corsia(&query);
    corsie
        .chiedi("index query", corsia, move || {
            source.with_host(|host| host.query_index(vault.as_deref(), query))
        })
        .await
}

/// **Ferma un lavoro lungo** (§10.3): l'altro capo di `Host::cancel_job`, che
/// finora usavano solo i presidi.
///
/// L'id arriva come **stringa** perché è un u64 pieno e `JSON.parse` perde i
/// bit oltre 2⁵³ in silenzio (la regola sta in `fub_abi::ipc`): un job che
/// non si annulla una volta ogni tanto sarebbe il difetto peggiore di questa
/// riga, perché somiglia a un job lento.
///
/// Non c'è un «job sconosciuto», ed è una decisione della 0032: annullare un
/// job un istante prima che parta deve valere quanto annullarne uno in volo, e
/// un pulsante premuto quando il lavoro è appena finito non è un errore da
/// mostrare — è la cosa più normale che l'utente faccia.
///
/// Per la stessa ragione non ha un ordine da tenere, ed esce dal thread
/// principale senza corsia (`host_read`): trovare la sessione risolve il
/// percorso del vault, e non deve aspettare dietro un'apertura in corsia.
#[tauri::command]
pub(crate) async fn cancel_job(
    app: AppHandle,
    id: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let id = id
        .parse::<u64>()
        .map_err(|_| PluginError::BadArgs(format!("invalid job id: `{id}`").into()))?;
    host_read(app, "job cancel", move |host| {
        host.cancel_job(vault.as_deref(), JobId(id))
    })
    .await
}

// --- versioning ------------------------------------------------------------
//
// Il kernel non sa che il versioning esiste, e comporre le due metà — lo store
// e l'handler registrato — è lavoro dell'host: qui restano le tre firme IPC.

// Il versioning **non ha più tre porte**. `list_versions`, `read_version` e
// `restore_version` erano i tre bespoke che la §16.6 aveva già classificato —
// due letture e un comando — e chi li chiamava era uno solo: il pannello
// cronologia di questa shell. Dal §1.2 la cronologia è un `ViewProvider` della
// feature versioning, cioè dello stesso plugin che le versioni le scrive: legge
// dal proprio spazio dati e ripristina invocando `version.restore`, che adesso è
// un comando del **registro** e non di Tauri. Le due letture non sono state
// migrate a `IndexQuery`: sono sparite, perché chi le faceva era di là.

// --- organizzazione del vault (§11.3) ---------------------------------------
//
// **Leggerla non è qui**: passa da `query_index` (`IndexQuery::Organization`),
// come le impostazioni e i tag — un elenco è dati, e i dati hanno un canale solo
// (decisione 0013). Prima era un comando IPC che restituiva il blob intero,
// quindi una cosa che la shell sapeva chiedere e un plugin no.
//
// E si scrive **per chiave**. Prima erano due funzioni, `read_workspace_meta` e
// `write_workspace_meta`: la shell rileggeva tutto, cambiava un campo e
// riscriveva tutto. Con due finestre sullo stesso vault quella è una *lost
// update* — la seconda che salva cancella ciò che ha fatto la prima, e nessuna
// delle due se ne accorge. Sono comandi IPC e non capacità dell'`HostApi`
// perché nessun plugin le chiede ancora: una capacità concessa a nessuno è
// superficie da mantenere e sandboxare per sempre.
//
// Le quattro scritture girano nella corsia dell'indice (`data_port`), dove
// l'organizzazione si legge: due clic di fila sulla puntina lasciano
// l'ultimo, e la lettura chiesta dopo li vede.

/// Il lavoro di una scrittura dei dati che le domande dell'indice leggono
/// (impostazioni, organizzazione, vault corrente e conosciuti), fuori dal
/// thread principale, nella corsia dell'indice (`domande::CORSIA_INDICE`).
/// Sul thread principale la scrittura finiva prima che la domanda mandata
/// dopo entrasse in fila, anche se la shell non aspettava la risposta: nella
/// stessa corsia è ancora così.
pub(crate) async fn data_port<T, F>(
    source: impl HostSource,
    corsie: &domande::Corsie,
    cosa: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    host_lane(source, corsie, cosa, domande::CORSIA_INDICE, work).await
}

/// L'emoji accanto a una nota o a una cartella (`None` la toglie).
#[tauri::command]
pub(crate) async fn set_icon(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
    icon: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "organization", move |host| {
        host.set_icon(vault.as_deref(), &path, icon)
    })
    .await
}

/// Appunta o spunta una nota.
#[tauri::command]
pub(crate) async fn set_pinned(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    id: String,
    pinned: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    set_pinned_in_lane(app, &corsie, id, pinned, vault).await
}

pub(crate) async fn set_pinned_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    id: String,
    pinned: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(source, corsie, "organization", move |host| {
        host.set_pinned(vault.as_deref(), &id, pinned)
    })
    .await
}

/// Registra o toglie una cartella dagli spazi.
#[tauri::command]
pub(crate) async fn set_space(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    path: String,
    space: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "organization", move |host| {
        host.set_space(vault.as_deref(), &path, space)
    })
    .await
}

/// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
#[tauri::command]
pub(crate) async fn set_order(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    folder: String,
    names: Vec<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    data_port(app, &corsie, "organization", move |host| {
        host.set_order(vault.as_deref(), &folder, names)
    })
    .await
}
