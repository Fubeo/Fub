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
use crate::model::{DocId, DocumentModel, Span};
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
pub trait HostApi: Send + Sync {
    /// Legge la sorgente di un documento dal vault.
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;
    /// Scrive la sorgente di un documento nel vault.
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;
    /// Emette un evento sull'event bus.
    fn emit(&mut self, event: Event);
    /// Chiede l'esecuzione in background di un job ([`Plugin::run_job`]).
    /// Ritorna subito con l'identità del job; l'esito arriverà come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono normale.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;
    /// Storage chiave→valore con spazio dei nomi per-plugin (persistente).
    fn storage_get(&self, key: &str) -> Option<serde_json::Value>;
    fn storage_set(&mut self, key: &str, value: serde_json::Value);
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
pub trait IndexProvider: Send + Sync {
    fn on_document_indexed(&mut self, doc: &DocumentModel);
    fn on_document_removed(&mut self, id: &DocId);
    /// Allinea l'indice alla verità completa del vault: `ids` è l'insieme di
    /// **tutti** i documenti esistenti, e ciò che l'indice ha in più è morto e
    /// va cancellato. Il kernel la chiama dopo la scansione del vault.
    ///
    /// Non è un rebuild: i documenti già presenti e immutati non vanno
    /// reindicizzati (è ciò che rende rapida la riapertura di un vault).
    fn reconcile(&mut self, ids: &[DocId]);
    /// Punto di consistenza: al ritorno, tutto ciò che è stato accettato
    /// finora è visibile alle `query` e (se l'indice è persistente) durevole.
    ///
    /// Esiste perché il kernel scrive **un documento alla volta** ma un
    /// indice vuole scrivere **a lotti**: fra un `on_document_*` e il `flush`
    /// il provider è libero di accumulare. Chi interroga senza aspettare un
    /// flush vede comunque le proprie scritture — è il provider a garantirlo,
    /// non il chiamante.
    fn flush(&mut self) -> Result<(), PluginError>;
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
