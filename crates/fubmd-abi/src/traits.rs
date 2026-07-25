//! Gli **altri trait di estensione**, definiti una volta sola qui nel contratto.
//! Le feature ufficiali (backlink, ricerca, graph) li implementano in modo
//! nativo; i plugin di terzi (M5) li implementeranno via proxy WASM. Il kernel
//! vede sempre `dyn Trait` e non sa quale backend c'è dietro.
//!
//! Nota M1: la superficie è definita per intero (è il valore del crate-contratto),
//! ma l'app M1 cabla solo ciò che serve — backlink e ricerca passano per
//! `IndexProvider`/il grafo del kernel.

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::event::{Event, EventMask};
use crate::model::{DocId, DocumentModel, Heading, Span};
use crate::ui::{UiAction, UiNode, ViewUpdate};

// ---------------------------------------------------------------------------
// Job: il varco per il lavoro lungo. Le chiamate dei trait sono sincrone e
// devono restare brevi (a M5 una deadline le tronca); tutto ciò che è lento —
// rete, calcolo pesante — passa da qui e gira FUORI dal giro sincrono del
// kernel. Vedi docs/architecture/plugin-boundary.md, "Lavoro lungo: i job".
// ---------------------------------------------------------------------------

/// Richiesta di lavoro in background. `job` è il nome dell'entry point del
/// plugin ([`Plugin::run_job`]); `payload` porta TUTTO l'input necessario:
/// dentro al job non c'è `HostApi` (niente vault, niente eventi) — input nel
/// payload, output nel risultato.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JobSpec {
    pub job: String,
    pub payload: serde_json::Value,
}

/// Identità di un job lanciato: chi lo lancia la conserva e riconosce il
/// proprio esito in [`Event::JobDone`](crate::Event::JobDone).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct JobId(pub u64);

// ---------------------------------------------------------------------------
// Capability handle: l'unico modo con cui un provider tocca il mondo esterno.
// Nativo → oggetto in-process diretto. WASM (M5) → proxy che reinoltra le
// chiamate come host function attraverso il confine.
// ---------------------------------------------------------------------------

/// Le capacità che il kernel concede a un provider/plugin.
///
/// È l'**unico** varco col mondo: ciò che non passa di qui, un plugin WASM non
/// lo potrà fare. Per questo la superficie va chiusa *prima* del freeze di M4 —
/// il dogfooding del versioning ha trovato il buco: un `EventHandler` scritto
/// come lo scriverebbe un plugin non aveva modo di tenere uno store di snapshot
/// su disco (lo `storage_*` in-memory non basta) né di sapere che ore sono.
pub trait HostApi: Send + Sync {
    /// Legge la sorgente di un documento dal vault.
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;
    /// Scrive la sorgente di un documento nel vault.
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;
    /// I documenti del vault, in ordine.
    ///
    /// Senza, `read_document` serve solo per gli id che arrivano dagli eventi:
    /// un plugin non potrebbe rispondere a [`Event::VaultOpened`] guardandosi
    /// intorno, né costruire alcunché sull'intero vault.
    ///
    /// [`Event::VaultOpened`]: crate::Event::VaultOpened
    fn list_documents(&self) -> Result<Vec<DocId>, PluginError>;
    /// Emette un evento sull'event bus.
    fn emit(&mut self, event: Event);
    /// Chiede l'esecuzione in background di un job ([`Plugin::run_job`]).
    /// Ritorna subito con l'identità del job; l'esito arriverà come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono normale.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;
    /// Stato leggero e **volatile** con spazio dei nomi per-plugin: preferenze,
    /// cursori, ciò che si può ricostruire. Non sopravvive alla chiusura — per
    /// i dati che devono durare c'è `data_*`.
    fn storage_get(&self, key: &str) -> Option<serde_json::Value>;
    fn storage_set(&mut self, key: &str, value: serde_json::Value);

    // --- storage persistente per-plugin -------------------------------------
    //
    // Blob nominati con path relativi dentro uno spazio che l'host assegna e
    // impone (`.fubmd-data/plugins/<id>/`): il plugin non conosce la radice del
    // vault, non compone path assoluti e non può uscire dal proprio recinto.
    // È l'alternativa a un'API filesystem scoped, ed è stata scelta perché il
    // recinto qui è una proprietà della firma, non una convenzione da
    // rispettare — vedi docs/architecture/plugin-boundary.md.

    /// Legge un blob. Assente → `Ok(None)` (mancare non è un errore).
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError>;
    /// Scrive un blob, creando le directory intermedie.
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError>;
    /// Cancella un blob. Idempotente: cancellare ciò che non c'è riesce.
    fn data_remove(&mut self, path: &str) -> Result<(), PluginError>;
    /// I blob sotto un prefisso, path relativi allo spazio del plugin e
    /// ordinati. Prefisso inesistente → lista vuota.
    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError>;

    /// Millisecondi dall'epoca UNIX, secondo l'host.
    ///
    /// Il tempo è una capacità come le altre: un componente WASM può non avere
    /// orologio (WASI lo può negare), e un host che lo fornisce può renderlo
    /// deterministico nei test. Un plugin che chiamasse `SystemTime::now` per
    /// conto proprio sarebbe non testabile e, sotto sandbox, non funzionante.
    fn now_unix_millis(&self) -> u64;

    // --- interrogazione dell'indice e contesto della sessione ---------------
    //
    // Le due capacità che un `ViewProvider` deve avere per essere un vero
    // provider e non un guscio a cui l'app passa i dati già pronti: sapere
    // *cosa* c'è nel vault (backlink, ricerca) e *quale* documento è aperto.
    // Senza, un pannello backlink in WASM non potrebbe fare né l'una né l'altra
    // cosa — le farebbe l'app per lui, cioè un dogfooding finto. Vedi
    // docs/architecture/plugin-boundary.md, "Interrogazione e contesto".

    /// Interroga gli indici del vault: backlink e ricerca full-text passano di
    /// qui, con la stessa semantica di dispatch del kernel (i backlink li serve
    /// il grafo, tutto il resto i provider registrati; vedi [`IndexQuery`]).
    ///
    /// È `&self` — una query non muta niente — ed è la ragione per cui un indice
    /// può servirla sotto prestito condiviso del workspace, come una view.
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;

    /// Il documento con il focus della sessione di editing, se ce n'è uno.
    ///
    /// È il solo contesto di sessione che il contratto espone: una view lo
    /// **chiede** quando ne ha bisogno (un pannello backlink lo fa a ogni
    /// render), invece di riceverlo come argomento — che costringerebbe *ogni*
    /// view a portarselo anche quando non le serve (un grafo, un pannello
    /// impostazioni). Chi lo imposta è la shell, non un plugin: `active_document`
    /// non ha un gemello che scrive nell'`HostApi`, perché "quale nota guardo"
    /// è una decisione dell'utente sull'app, non una capacità da concedere.
    fn active_document(&self) -> Option<DocId>;
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSpec {
    pub id: String,
    pub title: String,
    /// Suggerimento di scorciatoia, es. `"Mod-p"` (non vincolante).
    pub keybinding: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommandOutcome {
    pub notify: Option<String>,
}

pub trait CommandProvider: Send + Sync {
    fn commands(&self) -> Vec<CommandSpec>;
    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError>;
}

// ---------------------------------------------------------------------------
// View (UI dichiarativa)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewPlacement {
    LeftSidebar,
    RightSidebar,
    Bottom,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewSpec {
    pub id: String,
    pub title: String,
    pub placement: ViewPlacement,
}

pub trait ViewProvider: Send + Sync {
    fn views(&self) -> Vec<ViewSpec>;
    /// Restituisce l'albero di UI dichiarativa per la view corrente.
    fn render_view(&self, view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError>;
    fn on_action(
        &self,
        view: &str,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError>;
}

// ---------------------------------------------------------------------------
// Index (ricerca, backlink)
// ---------------------------------------------------------------------------

/// Una interrogazione all'indice. Backlink e full-text passano di qui.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IndexQuery {
    Backlinks {
        target: DocId,
    },
    FullText {
        query: String,
        limit: u32,
    },
    /// La struttura (heading) di un documento. Come i backlink, non la serve un
    /// indice ma il **kernel**, dai modelli che già tiene: è il modo con cui una
    /// view legge la struttura parsata di un documento senza avere un
    /// `FormatProvider` (che, essendo un plugin, non ha). Documento inesistente
    /// → outline vuota, non un errore.
    Outline {
        doc: DocId,
    },
    /// Varco di estensione: query definite da un provider di terzi, con
    /// namespace (`ns` = plugin id). Un provider che non riconosce `ns`
    /// risponde `PluginError::BadArgs`.
    Custom {
        ns: String,
        query: serde_json::Value,
    },
}

/// Un riferimento entrante (backlink) verso un documento.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BacklinkRef {
    pub source: DocId,
    pub context: Option<String>,
}

/// Un risultato di ricerca full-text.
///
/// `snippet` è **testo semplice**, mai markup: il provider non decora, e chi
/// disegna lo inserisce come testo (nessun varco di injection da un provider
/// di terzi — stessa regola di [`UiNode`](crate::ui::UiNode), il contenuto
/// attivo è riservato al codice fidato). L'evidenziazione passa da
/// `highlights`: intervalli in **byte dentro `snippet`**, che chi disegna
/// avvolge con i propri elementi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SearchHit {
    pub doc: DocId,
    pub score: f32,
    pub snippet: String,
    /// Porzioni di `snippet` che hanno prodotto il match, in ordine e non
    /// sovrapposte.
    pub highlights: Vec<Span>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IndexResult {
    Backlinks(Vec<BacklinkRef>),
    Search(Vec<SearchHit>),
    /// Gli heading di un documento, in ordine di apparizione (risposta a
    /// [`IndexQuery::Outline`]).
    Outline(Vec<Heading>),
    /// Risposta a una [`IndexQuery::Custom`].
    Custom(serde_json::Value),
}

/// Un indice derivato dal contenuto del vault.
///
/// Il kernel lo alimenta **direttamente** (non via event bus): ogni documento
/// che entra o esce dal `Workspace` passa da `on_document_indexed` /
/// `on_document_removed` dentro la stessa operazione che aggiorna il grafo.
/// Un indice non può quindi perdere aggiornamenti per un troncamento della
/// coda eventi ([`Event::Overflow`](crate::Event::Overflow)) — è la ragione
/// per cui l'alimentazione non passa da [`EventHandler`].
///
/// Resta un solo modo di divergere dal vault: ciò che succede mentre l'indice
/// **non è vivo** (documenti cancellati ad app chiusa, se l'indice è
/// persistente). Lo chiude [`IndexProvider::reconcile`].
///
/// # Dove sta l'`HostApi`, e perché non è su ogni metodo
///
/// Un indice persistente deve poter **caricare e salvare** il proprio stato, e
/// l'unico storage durevole del contratto è `data_*` dell'[`HostApi`]: senza
/// host in nessuna firma, un index provider di terzi in WASM non potrebbe
/// persistere nulla — lo stesso buco che il versioning ha fatto emergere per
/// [`EventHandler`]. L'host arriva quindi nei **due punti in cui lo stato
/// attraversa il disco**: [`activate`](IndexProvider::activate) per leggerlo,
/// [`flush`](IndexProvider::flush) per scriverlo.
///
/// Non sugli altri, e per ragioni, non per risparmio:
///
/// - `on_document_*` e `reconcile` sono **mutazioni in memoria**: fra un
///   `on_document_*` e il `flush` il provider accumula (è già il contratto di
///   `flush`, che esiste perché il kernel scrive un documento alla volta e un
///   indice vuole scrivere a lotti). Dare l'host qui costringerebbe il kernel a
///   prestare `&mut Workspace` dentro il ciclo di alimentazione, cioè a
///   duplicare il modello appena parsato a ogni salvataggio.
/// - `query` prende `&self` e il kernel serve le interrogazioni **sotto
///   prestito condiviso** del workspace: un host per-query lo prenderebbe in
///   esclusiva, il contrario della direzione in cui va la concorrenza
///   (`Mutex` → `RwLock`). Un indice risponde da ciò che ha già in mano.
///
/// L'host è per-chiamata e non un handle conservato alla costruzione perché è
/// l'unica forma che regge entrambi i backend: un handle dovrebbe essere
/// `'static` (la regola d'oro vieta i lifetime nelle firme) e l'host del kernel
/// **è** un prestito `&mut Workspace`, che `'static` non può essere.
pub trait IndexProvider: Send + Sync {
    /// Carica lo stato persistente dell'indice. Il kernel la chiama **una
    /// volta**, quando l'indice viene registrato, prima di qualunque
    /// alimentazione.
    ///
    /// Un indice tutto in memoria non ha niente da fare qui; un indice
    /// persistente ricostruisce da `data_*` ciò che gli serve per riconoscere
    /// quel che ha già visto (ed è quel riconoscimento a rendere rapida la
    /// riapertura di un vault non toccato). L'errore non è fatale per il
    /// chiamante: un indice è stato *derivato*, e nel dubbio si ricostruisce.
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn on_document_indexed(&mut self, doc: &DocumentModel);
    fn on_document_removed(&mut self, id: &DocId);
    /// Allinea l'indice alla verità completa del vault: `ids` è l'insieme di
    /// **tutti** i documenti esistenti, e ciò che l'indice ha in più è morto e
    /// va cancellato. Il kernel la chiama dopo la scansione del vault.
    ///
    /// Non è un rebuild: i documenti già presenti e immutati non vanno
    /// reindicizzati (è ciò che rende rapida la riapertura di un vault).
    fn reconcile(&mut self, ids: &[DocId]);
    /// Punto di consistenza **e di persistenza**: al ritorno, tutto ciò che è
    /// stato accettato finora è visibile alle `query` e durevole.
    ///
    /// Esiste perché il kernel scrive **un documento alla volta** ma un
    /// indice vuole scrivere **a lotti**: fra un `on_document_*` e il `flush`
    /// il provider è libero di accumulare. Chi interroga senza aspettare un
    /// flush vede comunque le proprie scritture — è il provider a garantirlo,
    /// non il chiamante.
    ///
    /// È l'unico punto in cui un indice scrive, e per questo riceve l'host:
    /// ciò che deve sopravvivere alla chiusura passa da `data_*`.
    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

pub trait EventHandler: Send + Sync {
    fn subscribed(&self) -> EventMask;
    fn handle(&mut self, event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError>;
}

// ---------------------------------------------------------------------------
// Ciclo di vita del plugin (bundle nativo o WASM)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginPermissions {
    pub read_vault: bool,
    pub write_vault: bool,
    pub network: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: PluginPermissions,
}

pub trait Plugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    /// Corpo di un job richiesto via [`HostApi::spawn_job`]: eseguito
    /// dall'host fuori dal kernel (a M5 su un'istanza separata del
    /// componente). Deliberatamente **senza** `HostApi`: il job è puro
    /// rispetto al vault — input nel `payload`, output nel risultato; le
    /// eventuali scritture le fa chi riceve il `JobDone`, dentro il giro
    /// sincrono normale. Default: nessun job supportato.
    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        let _ = payload;
        Err(PluginError::UnknownJob(job.to_string()))
    }
}
