//! Colla Tauri v2 di Fub: comandi IPC, ponte eventi verso il webview,
//! finestre e dialoghi.
//!
//! **Chi monta non è qui.** Registro dei formati, feature ufficiali, indice di
//! ricerca, versioning, view, comandi, sintassi, renderer, sessione e watcher
//! stanno in [`fub_host`], che non dipende da tauri: quel montaggio ha cinque
//! clienti previsti — CLI (27.1), API locale (27.2), e2e headless (17.2 e
//! 27.4), mobile (26.2) e PWA (26.3) — e finché viveva dentro
//! `#[tauri::command] open_vault` nessuno di loro poteva riusarlo (§8.2,
//! decisione 0023).
//!
//! Ciò che resta in questo file è **solo** ciò che non esiste senza un webview:
//! le firme `#[tauri::command]`, il ponte che inoltra gli eventi del kernel a
//! `fub://event`, e `run()`. Se una riga di questo file può essere spiegata
//! senza nominare Tauri, sta nel posto sbagliato.
//!
//! **Gli errori non si traducono più qui** (§12.2). Fino a questa seduta ogni
//! firma era `Result<_, String>` e dodici `map_err(|e| e.to_string())`
//! buttavano via il tipo sul confine: al frontend arrivava una frase italiana,
//! e l'unico modo di distinguere «esiste già» da «disco pieno» era cercarci
//! dentro una sottostringa — che `frontend/src/panels/trash.ts` non faceva
//! nemmeno, intercettando con un `catch` nudo qualunque fallimento e chiedendo
//! sempre la stessa cosa. Adesso passa un [`PluginError`], che è serializzabile
//! e **discriminabile**: `{"kind": "already_exists", "message": …}`.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::Revision;
use fub_abi::event::Actor;
use fub_abi::locale::Locale;
use fub_abi::model::DocId;
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{IndexQuery, IndexResult, JobId, ViewInstance, ViewSpec};
use fub_abi::ui::{ActionId, FieldValue, UiAction, UiNode, ViewUpdate};
use fub_abi::{Notice, PluginError};
use fub_host::{doc_id, EventSink, Host};
use fub_kernel::RenderedDocument;

use tauri::{AppHandle, Emitter, Manager, State};

// I tre record che attraversano l'IPC vivono nell'host — un'API locale
// risponderebbe con gli stessi — e l'app li ri-esporta, perché è lei a farli
// attraversare il confine: il mirror TS e la sua fixture
// (`tests/ts_mirror_app.rs`) restano legati al lato che li serializza.
pub use fub_host::{BundleInfo, EmbedContent, UnreadDoc, VaultEntry, VaultInfo};

/// I vault aperti e quale è il corrente (§9.6): rispecchiato da `OpenVaults` in
/// `frontend/src/host/contract.ts`.
///
/// Il "corrente" è una comodità della shell e non un'assunzione del backend:
/// serve a chi non nomina un vault, e chi ne ha due davanti li nomina.
#[derive(serde::Serialize)]
pub struct OpenVaults {
    pub roots: Vec<String>,
    pub current: Option<String>,
}

/// Il ponte eventi verso il webview: l'unica implementazione di [`EventSink`]
/// che ha bisogno di Tauri, ed è per questo che sta qui e non nell'host.
///
/// L'handle arriva in ritardo, e la `OnceLock` è quel ritardo reso esplicito.
/// L'ordine di Tauri è: costruzione → finestre della configurazione → `setup`,
/// e l'`AppHandle` esiste solo dall'ultimo passo. Ma lo stato gestito va
/// dichiarato al **primo**, o una `invoke` che arrivasse da una finestra già
/// aperta troverebbe `State<Host>` non gestito — che in Tauri è un panico, non
/// un errore. Quindi l'host si registra subito con questo sink vuoto, e il
/// `setup` ci mette dentro l'handle: nel frattempo un evento si perde invece di
/// far cadere l'app, e nel frattempo non c'è nessun vault aperto che possa
/// emetterne.
#[derive(Default)]
struct WebviewEvents(std::sync::OnceLock<AppHandle>);

impl EventSink for WebviewEvents {
    fn emit(&self, notice: &Notice) {
        if let Some(app) = self.0.get() {
            let _ = app.emit("fub://event", notice);
        }
    }
}

#[tauri::command]
fn open_vault(host: State<Host>, path: String) -> Result<VaultInfo, PluginError> {
    host.open(&Utf8PathBuf::from(path))
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
fn list_vaults(host: State<Host>) -> OpenVaults {
    OpenVaults {
        roots: host.vaults().into_iter().map(|r| r.to_string()).collect(),
        current: host.current().map(|r| r.to_string()),
    }
}

/// Rende corrente un vault già aperto. Aprirne uno nuovo lo fa `open_vault`,
/// che lo rende corrente da sé.
#[tauri::command]
fn set_current_vault(host: State<Host>, path: String) -> Result<(), PluginError> {
    host.set_current(&Utf8PathBuf::from(path))
}

/// Chiude un vault: flush, `close` degli indici, disattivazione dei plugin
/// (§9.5). Restituisce **ciò che è andato storto chiudendo**, che non è un
/// motivo per non chiudere: la lista è quasi sempre vuota, e quando non lo è
/// dice cosa non è diventato durevole.
#[tauri::command]
fn close_vault(host: State<Host>, path: String) -> Result<Vec<String>, PluginError> {
    Ok(host
        .close_vault(&Utf8PathBuf::from(path))?
        .into_iter()
        .map(|e| e.to_string())
        .collect())
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot):
/// il frontend lo legge e apre il vault senza passare dal dialog.
#[tauri::command]
fn initial_vault() -> Option<String> {
    fub_host::initial_vault()
}

// `list_documents` **non è più un comando** (§14.4). Era l'ultimo dato che la
// shell chiedeva fuori da `IndexQuery`, e la finestra che il contratto ha dal
// §5.5 questo confine non l'ha mai usata: restituiva l'intero vault in un
// `Vec<String>`, e chi disegnava venti righe ne riceveva diecimila. Chi vuole
// l'elenco lo chiede con `IndexQuery::Entries`, che la specie la sceglie e la
// pagina la taglia — e per cartella, che è ciò che serve a un albero.
//
// La **capacità** omonima resta dov'era (`VaultRead::list_documents`): quella
// la `Page` la prende, ed è l'elenco dei plugin, non quello della shell.

/// Il sorgente di un documento **e la revisione che lo nomina** (§18.1):
/// rispecchiato da `DocumentSource` in `frontend/src/host/contract.ts`.
///
/// Due campi e non uno perché chi apre un documento è chi lo salverà, e per
/// salvarlo in sicurezza deve poter dire da cosa era partito. Viaggiano
/// **insieme** e non in due porte per la ragione per cui la revisione è opaca
/// (`fub_abi::edit`): l'alternativa a riceverla è ricalcolarla di là dal
/// confine, cioè una seconda implementazione di come questo host deriva le
/// impronte — due implementazioni che a un certo punto divergono, e la seconda
/// mente in silenzio. Qui la deriva chi ha appena letto il file, dallo stesso
/// testo, senza rileggere niente.
#[derive(serde::Serialize)]
pub struct DocumentSource {
    pub text: String,
    pub revision: String,
}

#[tauri::command]
fn read_document(
    host: State<Host>,
    id: String,
    vault: Option<String>,
) -> Result<DocumentSource, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    let text = ws.read_source(&doc_id(&id)?).map_err(PluginError::from)?;
    let revision = Revision::of(&text).0;
    Ok(DocumentSource { text, revision })
}

#[tauri::command]
fn write_document(
    host: State<Host>,
    id: String,
    source: String,
    base: Option<String>,
    vault: Option<String>,
) -> Result<String, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.write_document_from(&doc_id(&id)?, &source, base.map(Revision::new))
        .map(|r| r.0)
        .map_err(PluginError::from)
}

/// **Scrive la bozza di un documento** (§15.2): ciò che c'è nel buffer adesso.
///
/// Una porta e non un comando del registro, ed è la sola riga di questo file
/// dove l'assenza di una capacità è **voluta per sempre** invece che in attesa
/// di un cliente: il testo non ancora salvato è il dato più privato che un vault
/// contenga, e una `draft_write` sull'`HostApi` lo darebbe a ogni plugin
/// montato. La shell non è un plugin, e questa è la sua porta.
///
/// `base` è la revisione del file su cui il buffer sta lavorando — assente per
/// una nota mai salvata — e la manda **chi ha il buffer**, perché è l'unico a
/// sapere da quale lettura quel testo si è discostato.
#[tauri::command]
fn save_draft(
    host: State<Host>,
    id: String,
    text: String,
    base: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.save_draft(&doc_id(&id)?, &text, base.map(Revision::new))
        .map_err(|e| PluginError::Internal(format!("bozza non scritta: {e}").into()))
}

/// **Butta la bozza di un documento**: il buffer è tornato pulito, o l'utente ha
/// scelto di scartare ciò che aveva recuperato.
#[tauri::command]
fn discard_draft(host: State<Host>, id: String, vault: Option<String>) -> Result<(), PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.discard_draft(&doc_id(&id)?)
        .map_err(|e| PluginError::Internal(format!("bozza non buttata: {e}").into()))
}

// Le cinque azioni STRUTTURALI — crea, rinomina, cestina, ripristina, svuota —
// non sono più comandi Tauri: sono comandi del registro (decisione 0009), serviti da
// `CoreCommands` attraverso le capacità della decisione 0013, e la shell li invoca con
// `invoke_command` come li invocherebbe una CLI o un plugin.
//
// È ciò che rende vera la regola del §16.6 — "una feature nuova non deve poter
// aggiungere un comando Tauri" — che finché quelle cinque stavano qui valeva
// solo per le feature che non toccano il vault.
//
// E adesso non restano nemmeno le due LETTURE che il giro si era tenuto —
// `list_trash` e `propose_free_name`. Non sono state migrate: sono rimaste
// **senza chiamante**. Le chiedeva il pannello cestino di questa shell, che dal
// §1.2 è un `ViewProvider` e le chiede dall'altro lato del confine, dove sono
// due capacità del contratto (`VaultRead::list_trash`, `VaultRead::free_name`)
// e non due porte. Una porta che nessuno attraversa è una promessa che nessuno
// mantiene: il modo giusto di reggerla è toglierla, e rimetterla il giorno che
// qualcuno di qua abbia di nuovo quella domanda.

/// Contenuto di un embed `![[page#heading]]`: il frontend lo innesta nel
/// placeholder emesso dal provider (profondità massima e cicli a suo carico).
#[tauri::command]
fn render_embed(
    host: State<Host>,
    page: String,
    heading: Option<String>,
    vault: Option<String>,
) -> Result<EmbedContent, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    let (doc_id, content) = ws.render_embed(&page, heading.as_deref())?;
    Ok(EmbedContent {
        doc_id: doc_id.0,
        content,
    })
}

#[tauri::command]
fn render_preview(
    host: State<Host>,
    id: String,
    vault: Option<String>,
) -> Result<RenderedDocument, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    ws.render_preview(&DocId::new(id))
        .map_err(PluginError::from)
}

// --- view dichiarative (protocollo generico) -------------------------------
//
// Il canale core→UI dei `ViewProvider`: la shell chiede l'albero di una view e
// rimanda le azioni al provider, senza sapere cosa la view faccia. Il pannello
// backlink passa di qui come dovrà passarci un plugin — nessun comando ad-hoc
// per feature. L'enforcement del confine di fiducia (`Html`/`WebView` solo dal
// codice fidato) è dentro `render_view`/`view_action`, in un punto solo.

/// Contesto del pannello con il focus: quale nota, cosa c'è selezionato, in che
/// modalità. Lo pubblica la shell a ogni navigazione, movimento del cursore o
/// cambio di modalità; le view lo leggono via `HostEnv::active_context`.
///
/// Restituisce **gli id delle view da ridisegnare** — quelle la cui
/// `ViewSpec.follows` interseca ciò che è cambiato. Il conto lo fa il kernel e
/// non la shell perché la regola deve essere una sola: la shell sa *quando*
/// pubblicare, non *chi* segue cosa. `None` = nessun pannello (all'avvio, o
/// dopo che l'ultima nota è stata chiusa).
#[tauri::command]
fn set_active_context(
    host: State<Host>,
    context: Option<ViewContext>,
    vault: Option<String>,
) -> Result<Vec<String>, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    Ok(ws.set_active_context(context))
}

/// La shell riporta cosa il **sistema** dice: lingua, fuso, calendario (§12.3).
///
/// Lo pubblica la webview perché è l'unica che lo sappia davvero — `Intl` porta
/// un ICU intero, il lato Rust avrebbe bisogno di un database dei fusi orari per
/// dare una risposta peggiore — e lo pubblica **una volta per tutti i vault**:
/// la lingua di chi guarda non è di un vault, a differenza del contesto di
/// pannello qui sopra. Ciò che l'utente ha scelto nelle chiavi `locale.*` sta
/// sopra a questo, e le due cose le compone il kernel.
///
/// Restituisce `true` se qualcosa è cambiato: la shell ridisegna solo allora.
#[tauri::command]
fn set_system_locale(host: State<Host>, locale: Locale) -> bool {
    host.publish_locale(locale)
}

/// Le view offerte dai provider registrati, nell'ordine di registrazione.
///
/// È la metà "discovery" del protocollo: la shell non cabla gli id — monta
/// ogni view nel contenitore del suo `placement` e la ridisegna quando arriva
/// un evento della sua maschera `refresh`. Una view di plugin compare da sola.
#[tauri::command]
fn list_views(host: State<Host>, vault: Option<String>) -> Result<Vec<ViewSpec>, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    Ok(ws.views())
}

/// Rende l'albero `UiNode` di **un'istanza** di view. Il render è una lettura:
/// prende il workspace in prestito condiviso, non in esclusiva.
///
/// L'istanza arriva dalla shell, che è chi apre: `instance` la distingue dalle
/// sorelle e `params` sono i suoi argomenti (§2.3). Per la view che la shell
/// monta da sé — una sola, senza parametri — è
/// [`ViewInstance::only`](fub_abi::traits::ViewInstance::only), e questo
/// comando accetta i due campi assenti proprio per non obbligarla a costruirla.
#[tauri::command]
fn render_view(
    host: State<Host>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<UiNode, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    ws.render_view(&istanza(view, instance, params))
}

/// Consegna un'azione della UI al provider della view e restituisce il suo
/// aggiornamento (`Replace`/`Patch`/`Navigate`/`None`), che il frontend
/// interpreta.
///
/// `payload` è ciò che il provider aveva attaccato al nodo; `fields` è lo stato
/// dei campi di input che la shell ha raccolto. Sono due cose con due
/// proprietari (§2.7), e il fatto che arrivino come due argomenti distinti è
/// ciò che impedisce alla shell di riscrivere il primo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn view_action(
    host: State<Host>,
    view: String,
    instance: Option<String>,
    params: Option<serde_json::Value>,
    action: String,
    payload: Option<serde_json::Value>,
    fields: Option<Vec<FieldValue>>,
    vault: Option<String>,
) -> Result<ViewUpdate, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.view_action(
        &istanza(view, instance, params),
        UiAction {
            action: ActionId(action),
            payload: payload.unwrap_or(serde_json::Value::Null),
            fields: fields.unwrap_or_default(),
        },
    )
}

/// L'istanza che la shell nomina, con i due default dell'esemplare unico.
fn istanza(
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

// --- comandi (protocollo generico) -----------------------------------------
//
// L'altro giro discovery+invoke accanto a quello delle view, e la ragione per
// cui questo file non deve più crescere di un comando Tauri per feature (§16.6):
// un'azione nuova si dichiara in un `CommandProvider` e arriva alla palette da
// sola, con i suoi parametri e il suo raggio.

/// I comandi offerti dai provider registrati.
///
/// La shell non ne cabla nessuno: disegna ciò che legge, chiede i parametri che
/// la spec dichiara e decide se chiedere conferma dal raggio dichiarato. Sono
/// le stesse informazioni che leggerebbero una CLI (27.1) o un chiamante
/// programmatico (22.4) — questo comando IPC è solo il primo dei suoi clienti.
#[tauri::command]
fn list_commands(
    host: State<Host>,
    vault: Option<String>,
) -> Result<Vec<CommandSpec>, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    Ok(ws.commands())
}

/// Esegue — o simula — un comando.
///
/// `mode` assente significa `apply`: è la scelta di **questo** confine, non del
/// contratto (dove un default non esiste apposta). Il webview è codice nostro e
/// il caso normale è eseguire; chi vuole il piano lo chiede, e riceve un
/// `CommandOutcome` con dentro l'effetto `plan`.
///
/// L'attore è [`Actor::User`] e **non** un parametro dell'IPC: da questo canale
/// passa la persona davanti allo schermo, per il tramite della webview, e
/// lasciare che il chiamante si dichiarasse chi vuole avrebbe reso l'origine una
/// stringa di cortesia — un'automazione (16.2) che potesse firmarsi "utente"
/// aggirerebbe l'unica difesa che 16.2 ha. Gli altri chiamanti del registro (la
/// CLI di 27.1, l'API locale di 27.2) sono canali diversi e diranno il proprio
/// attore là dove passano.
#[tauri::command]
fn invoke_command(
    host: State<Host>,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
    vault: Option<String>,
) -> Result<CommandOutcome, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.invoke_command(
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
        Actor::User,
    )
}

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
#[tauri::command]
fn query_index(
    host: State<Host>,
    query: IndexQuery,
    vault: Option<String>,
) -> Result<IndexResult, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    ws.query_index(query)
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
#[tauri::command]
fn cancel_job(host: State<Host>, id: String, vault: Option<String>) -> Result<(), PluginError> {
    let id = id
        .parse::<u64>()
        .map_err(|_| PluginError::BadArgs(format!("identità di job non valida: `{id}`").into()))?;
    host.cancel_job(vault.as_deref(), JobId(id))
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

/// L'emoji accanto a una nota o a una cartella (`None` la toglie).
#[tauri::command]
fn set_icon(
    host: State<Host>,
    path: String,
    icon: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_icon(vault.as_deref(), &path, icon)
}

/// Appunta o spunta una nota.
#[tauri::command]
fn set_pinned(
    host: State<Host>,
    id: String,
    pinned: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_pinned(vault.as_deref(), &id, pinned)
}

/// Registra o toglie una cartella dagli spazi.
#[tauri::command]
fn set_space(
    host: State<Host>,
    path: String,
    space: bool,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_space(vault.as_deref(), &path, space)
}

/// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
#[tauri::command]
fn set_order(
    host: State<Host>,
    folder: String,
    names: Vec<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    host.set_order(vault.as_deref(), &folder, names)
}

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

/// Scrive un'impostazione **per conto dell'utente**.
#[tauri::command]
fn set_setting(
    host: State<Host>,
    key: String,
    value: SettingValue,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.set_setting(&key, value)
}

/// Dimentica ciò che era stato deciso per una chiave: torna a valere il livello
/// sotto.
#[tauri::command]
fn reset_setting(host: State<Host>, key: String, vault: Option<String>) -> Result<(), PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write().unwrap();
    ws.reset_setting(&key)
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
const SHELL_OWNER: &str = "fub.shell";

/// L'esemplare della shell. **Uno solo**, oggi, e dichiararlo qui è più onesto
/// che lasciarlo implicito: l'area principale è un pannello solo, quindi non c'è
/// niente da distinguere. Quando arriverà il modello di layout (§1.2) i pannelli
/// avranno un esemplare per uno, e sarà quello a comparire qui.
const SHELL_INSTANCE: &str = "window";

/// Ciò che la shell aveva salvato sotto questa chiave, per **questo vault** e su
/// **questa macchina**.
///
/// `None` è il caso normale del primo avvio, non un errore: chi non ha mai
/// salvato niente disegna il proprio default.
#[tauri::command]
fn view_state(
    host: State<Host>,
    key: String,
    vault: Option<String>,
) -> Result<Option<serde_json::Value>, PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read().unwrap();
    Ok(ws.view_state(SHELL_OWNER, SHELL_INSTANCE, &key))
}

/// Salva (`Some`) o dimentica (`None`) lo stato di vista della shell.
#[tauri::command]
fn set_view_state(
    host: State<Host>,
    key: String,
    value: Option<serde_json::Value>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let ws = host.workspace(vault.as_deref())?;
    // Prestito **condiviso**: lo store ha il suo lucchetto dentro, e prendere
    // qui quello esclusivo del workspace bloccherebbe chi legge per il tempo di
    // una scrittura su disco — per salvare uno scroll.
    let ws = ws.read().unwrap();
    ws.set_view_state(SHELL_OWNER, SHELL_INSTANCE, &key, value)
        .map_err(|e| PluginError::Io(e.into()))
}

/// Chi questo host sa montare, e chi è acceso in questo vault. Non è
/// `VaultInfo.plugins`: quello elenca chi è **dichiarato nel kernel**, e un
/// componente spento non lo è — «spento» e «non c'è» sono due stati diversi.
#[tauri::command]
fn list_bundles(host: State<Host>, vault: Option<String>) -> Result<Vec<BundleInfo>, PluginError> {
    host.bundles(vault.as_deref())
}

/// Accende o spegne un componente, adesso e per i prossimi avvii. Restituisce
/// ciò che è andato storto **spegnendo**, che non è un motivo per non spegnere.
#[tauri::command]
fn set_plugin_enabled(
    host: State<Host>,
    id: String,
    enabled: bool,
    vault: Option<String>,
) -> Result<Vec<String>, PluginError> {
    host.set_plugin_enabled(vault.as_deref(), &id, enabled)
}

/// I vault che questa macchina conosce: preferiti, poi recenti.
#[tauri::command]
fn known_vaults(host: State<Host>) -> Vec<VaultEntry> {
    host.known_vaults()
}

#[tauri::command]
fn set_vault_favorite(host: State<Host>, path: String, favorite: bool) -> Result<(), PluginError> {
    host.set_vault_favorite(&Utf8PathBuf::from(path), favorite)
}

#[tauri::command]
fn set_vault_look(
    host: State<Host>,
    path: String,
    icon: Option<String>,
    name: Option<String>,
) -> Result<(), PluginError> {
    host.set_vault_look(&Utf8PathBuf::from(path), icon, name)
}

/// Toglie un vault dall'elenco dei conosciuti. **Non lo cancella dal disco.**
#[tauri::command]
fn forget_vault(host: State<Host>, path: String) -> Result<(), PluginError> {
    host.forget_vault(&Utf8PathBuf::from(path))
}

pub fn run() {
    // Il collettore del log si installa **prima** di tutto: le righe che
    // `Host::installed` scrive aprendo i file della macchina devono avere un
    // posto dove andare (§17.3, decisione 0062). L'`Arc` torna qui e passa
    // all'host, perché è lo stesso su cui il montaggio cambierà il livello
    // leggendo le impostazioni.
    let levels = fub_host::install_logging();
    // Il sink è un parametro del montaggio, quindi l'host si costruisce qui e
    // non nel `setup`; l'handle che gli manca ce lo mette il `setup` (vedi
    // `WebviewEvents`).
    let sink = Arc::new(WebviewEvents::default());
    let bridge = sink.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // `installed()` e non `new()`: è qui che Fub è un'**installazione** —
        // con una cartella di configurazione, un livello macchina e un registro
        // dei vault. Un test o un e2e headless costruiscono `Host::new()`, che
        // lavora in memoria e non tocca la configurazione di chi lo esegue.
        .manage(Host::installed().with_levels(levels).with_sink(sink))
        .setup(move |app| {
            let _ = bridge.0.set(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_vault,
            close_vault,
            list_vaults,
            set_current_vault,
            initial_vault,
            read_document,
            write_document,
            save_draft,
            discard_draft,
            render_preview,
            render_embed,
            set_active_context,
            set_system_locale,
            list_views,
            render_view,
            view_action,
            list_commands,
            invoke_command,
            query_index,
            cancel_job,
            set_icon,
            set_pinned,
            set_space,
            set_order,
            set_setting,
            reset_setting,
            view_state,
            set_view_state,
            list_bundles,
            set_plugin_enabled,
            known_vaults,
            set_vault_favorite,
            set_vault_look,
            forget_vault,
        ])
        .build(tauri::generate_context!())
        .expect("errore durante l'avvio di Fub")
        // **Chi chiude sa che sta chiudendo** (§9.5). Il kernel non può saperlo:
        // non sa quando finisce un lotto, e finché l'unico chiamante di
        // `flush_indexes` era il callback del watcher, la durabilità di un
        // indice dipendeva da un componente opzionale. Qui invece il fatto è
        // certo, ed è l'ultimo momento in cui si può dire a qualcuno di
        // chiudersi: `Host::close` fa il giro su ogni vault aperto.
        //
        // `Exit` e non `ExitRequested`: il secondo si può annullare, e chiudere
        // gli indici di un vault che poi resta aperto sarebbe peggio che non
        // chiuderli.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                for e in app.state::<Host>().close() {
                    // L'app sta uscendo: il ponte verso la shell sta morendo e
                    // non c'è nessuno che disegna un evento. Resta il log, che è
                    // ciò che il bundle diagnostico (§15.2) raccoglierà — e il
                    // fatto che un indice non si sia chiuso pulito è una
                    // diagnosi per chi sviluppa, non una cosa che l'utente può
                    // ancora riparare a schermo spento (0062).
                    tracing::warn!(target: "fub.app", "chiusura del vault: {e}");
                }
            }
        });
}
