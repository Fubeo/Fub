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
use crate::model::{DocId, DocumentModel, Heading, PropertyScalar, PropertyValue, Span};
use crate::session::{ContextMask, ViewContext};
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
///
/// Sul confine JSON (IPC verso il frontend) viaggia come **stringa**: è un
/// u64 pieno usato come identità, e `JSON.parse` perde i bit oltre 2⁵³ in
/// silenzio — vedi la regola in [`crate::ipc`]. Nel WIT resta `u64` nativo,
/// che non ha il problema.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct JobId(pub u64);

impl Serialize for JobId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for JobId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        crate::ipc::u64_string::deserialize(d).map(JobId)
    }
}

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
///
/// # Visibilità durante i callback (contratto)
///
/// Durante un callback **in scrittura** (`handle`, `on_action`, `flush`,
/// `activate`) un provider **non vede sé stesso né i fratelli in corso di
/// chiamata**: l'host li estrae dal workspace per la durata del giro, quindi
/// una [`query_index`](HostApi::query_index) fatta da lì dentro può trovare
/// meno provider di quanti ne esistano — al limite nessuno. Non è un
/// malfunzionamento: un callback in scrittura risponde da ciò che ha già in
/// mano, non interrogando il mondo che lo sta chiamando. Il percorso di
/// **lettura** (`render_view`) invece gira sotto prestito condiviso e vede il
/// mondo intero, indici compresi.
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
    /// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
    /// a partire da un id qualsiasi. Se l'id è già libero, è lui.
    ///
    /// È una capacità e non un calcolo perché il vault è l'unico a sapere cosa
    /// è occupato — l'indicizzato **e** ciò che sta sul disco e nessuno ha
    /// ancora visto — e perché la convenzione dei nomi (D3) deve restare una
    /// sola: la usano `create_note`, il ripristino dal cestino e ogni
    /// [`ImportProvider`](crate::transfer::ImportProvider) che risolva un
    /// conflitto con
    /// [`ConflictPolicy::Rename`](crate::transfer::ConflictPolicy::Rename).
    /// Con ~50 importer in FEATURES 17.1, l'alternativa è cinquanta
    /// convenzioni.
    ///
    /// Non prenota niente: fra la domanda e la scrittura il nome può diventare
    /// occupato, e a quel punto è la scrittura a dirlo.
    fn free_name(&self, id: &DocId) -> DocId;
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

    /// Interroga il vault: backlink, grafo, struttura, tag, proprietà, salute e
    /// ricerca full-text passano tutti di qui, con la stessa semantica di
    /// dispatch del kernel (ciò di cui il kernel è già l'unica fonte di verità
    /// lo serve lui, il resto i provider registrati; vedi [`IndexQuery`]).
    ///
    /// È `&self` — una query non muta niente — ed è la ragione per cui un indice
    /// può servirla sotto prestito condiviso del workspace, come una view.
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;

    /// Il contesto del pannello con il focus: quale documento, cosa c'è
    /// selezionato, in che modalità. `None` = la shell non ne ha ancora
    /// pubblicato uno (nessun pannello).
    ///
    /// È il solo contesto di sessione che il contratto espone: una view lo
    /// **chiede** quando ne ha bisogno (un pannello backlink lo fa a ogni
    /// render), invece di riceverlo come argomento — che costringerebbe *ogni*
    /// view a portarselo anche quando non le serve (un grafo, un pannello
    /// impostazioni). Chi lo imposta è la shell, non un plugin:
    /// `active_context` non ha un gemello che scrive nell'`HostApi`, perché
    /// "quale nota guardo e dove ho cliccato" è una decisione dell'utente
    /// sull'app, non una capacità da concedere.
    ///
    /// Restituisce un [`ViewContext`] e non un `DocId` perché con schede,
    /// split e finestre multiple (FEATURES 4.1) "il documento attivo" non è più
    /// una variabile globale: due pannelli backlink affiancati farebbero la
    /// stessa domanda e riceverebbero la stessa risposta, sbagliata per uno dei
    /// due. Il [`PaneId`](crate::session::PaneId) dentro il contesto è ciò che
    /// permette di distinguerli già ora; legarli a un pannello *fisso* è
    /// l'altra metà del problema, e arriva con le istanze di view (§1.15).
    fn active_context(&self) -> Option<ViewContext>;
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
    /// Dichiarazione di interesse: gli eventi al cui arrivo la shell deve
    /// ridisegnare questa view (chiamare di nuovo `render_view`).
    ///
    /// È il pezzo di protocollo che dice *quando* una view invecchia: senza,
    /// la shell può solo indovinare per conoscenza privata delle feature — e
    /// per una view di plugin non può indovinare niente. Maschera vuota =
    /// nessun ridisegno event-driven.
    #[serde(default)]
    pub refresh: EventMask,
    /// L'altra metà della stessa dichiarazione, per ciò che **non è un evento
    /// del vault**: le parti del contesto di sessione
    /// ([`HostApi::active_context`]) al cui cambio questa view invecchia.
    ///
    /// Esiste perché "la shell ridisegna comunque quando cambia il documento
    /// attivo" smette di essere sostenibile appena il contesto porta anche la
    /// **selezione**: ridisegnare ogni view a ogni movimento del cursore
    /// significherebbe interrogare l'indice a ogni battuta di tasto. Chi segue
    /// il cursore lo dichiara e viene servito; chi mostra il vault intero (una
    /// vista a grafo, il pannello tag) non dichiara nulla e resta fermo.
    #[serde(default)]
    pub follows: ContextMask,
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
// Index — il canale dati verso le view
// ---------------------------------------------------------------------------
//
// Qui passa TUTTO ciò che una view sa del vault: full-text, backlink, grafo,
// proprietà del frontmatter, salute del vault. Ogni domanda che non è
// esprimibile come `IndexQuery` diventa un comando bespoke dell'app, cioè una
// superficie privilegiata che un plugin non potrà mai avere — è la ragione per
// cui questo enum è largo e va deciso prima del freeze di M4.
//
// Chi serve cosa: il **kernel** risponde a ciò di cui è già l'unica fonte di
// verità (grafo, modelli parsati, frontmatter); i **provider registrati** a
// tutto il resto (oggi: il full-text). La divisione non è di comodo — duplicare
// il grafo dentro un indice creerebbe una seconda verità che può divergere
// dalla prima.

/// La finestra chiesta su una risposta: da dove cominciare, quanti elementi al
/// più.
///
/// Sta nella **domanda** e non solo nella risposta perché chi serve la query
/// deve poter troncare *prima* di costruire il risultato: un vault con
/// centomila note non deve materializzare centomila righe per mostrarne venti
/// (24.1). `None` al posto di una `Page` significa "tutto": è la forma che
/// tiene onesti i clienti che davvero vogliono l'insieme intero (il pannello
/// tag, l'autocompletamento) senza costringerli a inventarsi un tetto.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page {
    /// Elementi da saltare. Oltre la fine → pagina vuota, non un errore.
    pub offset: u32,
    /// Quanti al più restituirne. `0` = nessuno (non "tutti": per quello si
    /// omette la `Page`).
    pub limit: u32,
}

impl Page {
    pub fn new(offset: u32, limit: u32) -> Self {
        Page { offset, limit }
    }

    /// I primi `limit` elementi.
    pub fn first(limit: u32) -> Self {
        Page { offset: 0, limit }
    }
}

/// Una risposta a finestra: gli elementi chiesti, da dove cominciano e quanti
/// ce ne sarebbero **in tutto**.
///
/// `total` non è decorativo: senza, chi disegna non sa se esiste una pagina
/// dopo, e "1-20 di 4321" — che è ciò che ogni elenco lungo mostra — non si
/// scrive. È il conteggio *prima* della finestra, non `items.len()`.
///
/// Al confine WIT non esistono i generici: ogni istanza di questo tipo è là un
/// record a sé (`backlinks-page`, `search-page`, …). La ripetizione è il prezzo
/// dichiarato di avere `total` accanto agli elementi invece che in un canale
/// separato che si può dimenticare.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub offset: u32,
    pub total: u32,
}

impl<T> Paged<T> {
    /// Tutto ciò che c'è, senza finestra.
    pub fn all(items: Vec<T>) -> Self {
        let total = items.len() as u32;
        Paged {
            items,
            offset: 0,
            total,
        }
    }

    /// Ritaglia una risposta **già in memoria**.
    ///
    /// È la strada di chi la finestra non la sa applicare alla fonte (il kernel
    /// interroga mappe che ha già in mano): il conteggio resta quello vero,
    /// solo gli elementi si riducono. Un indice che sappia paginare alla
    /// sorgente — tantivy sa — costruisce il [`Paged`] da sé e non passa di qui.
    pub fn window(items: Vec<T>, page: Option<Page>) -> Self {
        let total = items.len() as u32;
        let Some(page) = page else {
            return Paged {
                items,
                offset: 0,
                total,
            };
        };
        let items = items
            .into_iter()
            .skip(page.offset as usize)
            .take(page.limit as usize)
            .collect();
        Paged {
            items,
            offset: page.offset,
            total,
        }
    }
}

/// In che verso si cammina il grafo dei link.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkDirection {
    /// I link **uscenti**: le note che questa nomina.
    #[default]
    Outbound,
    /// I link **entranti**: le note che nominano questa (i backlink).
    Inbound,
    /// Entrambi i versi, come li disegna una vista a grafo.
    Both,
}

/// L'ambito di una ricerca full-text: *dove* cercare, non *cosa*.
///
/// Vuoto in ogni campo = tutto il vault. È separato dalla stringa di query
/// perché la stringa è il linguaggio del provider (oggi tantivy, §2.17) mentre
/// l'ambito è **dato del contratto**: una shell che offre "cerca in questa
/// cartella" non deve comporre sintassi altrui per ottenerlo, e un provider
/// diverso non può interpretarlo diversamente.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchScope {
    /// Cartelle del vault (path relativi senza slash finale; `""` è la radice):
    /// il documento è in ambito se sta in una di esse **o in una discendente**.
    /// Più cartelle sono in OR.
    pub folders: Vec<String>,
    /// Tag in forma canonica (senza `#`, vedi `canonical_tag`): il documento
    /// deve portarne almeno uno. Più tag sono in OR.
    pub tags: Vec<String>,
}

/// Come si mette alla prova una proprietà del frontmatter.
///
/// Un `variant` e non una coppia operatore+valore: `exists` e `missing` un
/// valore non ce l'hanno, e un campo che in due casi su sette non significa
/// niente è un invito a riempirlo di `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum PropertyTest {
    /// La chiave c'è (anche con valore vuoto: `chiave:` esiste).
    Exists,
    /// La chiave non c'è.
    Missing,
    Equals(PropertyValue),
    NotEquals(PropertyValue),
    /// Per un elenco: contiene questo scalare. Per un testo: lo contiene come
    /// sottostringa. Per il resto: uguaglianza.
    Contains(PropertyScalar),
    /// Confronti d'ordine fra valori della **stessa specie** (numero, data,
    /// testo). Specie diverse non si ordinano: la prova è falsa, non un errore
    /// — un vault vero ha frontmatter disomogeneo e una query non deve morirci.
    GreaterThan(PropertyValue),
    LessThan(PropertyValue),
}

/// Una condizione su una proprietà. Più filtri di una query sono in **AND**:
/// l'OR e le parentesi arrivano con la query come AST (§2.17), e finché non
/// c'è è meglio dire chiaramente cosa questa forma esprime.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyFilter {
    pub key: String,
    pub test: PropertyTest,
}

/// Come ordinare i documenti di una [`IndexQuery::Properties`]. Chi non ha la
/// chiave finisce **in fondo** in entrambi i versi (è assente, non minimo), e a
/// parità vale l'ordine dei `DocId`: una risposta paginata deve essere stabile,
/// o la seconda pagina ripete la prima.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertySort {
    pub key: String,
    pub descending: bool,
}

/// Una proprietà con il suo valore normalizzato ([`PropertyValue`], §1.5).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyEntry {
    pub key: String,
    pub value: PropertyValue,
}

/// Un documento e le sue proprietà: la riga di una collezione (8.4) o di un
/// database su file (11).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentProperties {
    pub doc: DocId,
    /// In ordine di chiave. Quali chiavi ci sono lo decide `select` nella
    /// query; vuoto là = tutto il frontmatter del documento.
    pub properties: Vec<PropertyEntry>,
}

/// Un valore distinto di una proprietà e quante note lo portano: la faccetta di
/// 9.1, gemella di [`TagCount`] per il frontmatter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyCount {
    pub value: PropertyValue,
    pub count: u32,
}

/// Quale controllo di salute del vault si sta chiedendo.
///
/// Ogni voce è un'interrogazione sul grafo e sui modelli che il kernel **ha già
/// in memoria**: 7.2 ne chiede una trentina, e senza questa variante ognuna
/// sarebbe un comando bespoke sullo stesso dato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCheck {
    /// Link che non risolvono a nessun documento del vault (wikilink e link
    /// markdown; un URL non è un link rotto, è un'altra cosa).
    BrokenLinks,
    /// Note che nessuno nomina: zero riferimenti entranti.
    OrphanDocuments,
}

/// Un problema trovato da un [`HealthCheck`], sul documento che lo porta.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HealthIssue {
    /// Il documento in cui sta il problema: la nota che contiene il link rotto,
    /// la nota orfana.
    pub doc: DocId,
    pub check: HealthCheck,
    /// Il dettaglio leggibile: per un link rotto la destinazione **come era
    /// scritta**, che è ciò che serve per correggerla. Assente quando il
    /// problema è il documento stesso (una nota orfana non ha un dettaglio).
    pub detail: Option<String>,
    /// Dove sta nel sorgente, quando il problema ha un punto: lo span del link
    /// rotto. In byte, come ogni span del modello.
    pub span: Option<Span>,
}

/// Una interrogazione all'indice: il canale dati unico verso le view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IndexQuery {
    /// I riferimenti entranti verso un documento. Li serve il **kernel** dal
    /// grafo, che ne è l'unica fonte di verità.
    Backlinks {
        target: DocId,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Ricerca full-text, servita dai provider registrati.
    FullText {
        query: String,
        /// Dove cercare. `SearchScope::default()` = tutto il vault.
        #[serde(default)]
        scope: SearchScope,
        #[serde(default)]
        page: Option<Page>,
    },
    /// La struttura (heading) di un documento. Come i backlink, non la serve un
    /// indice ma il **kernel**, dai modelli che già tiene: è il modo con cui una
    /// view legge la struttura parsata di un documento senza avere un
    /// `FormatProvider` (che, essendo un plugin, non ha). Documento inesistente
    /// → outline vuota, non un errore.
    ///
    /// È l'unica risposta non paginata dell'enum, e per una ragione: cresce con
    /// **un** documento, non col vault, e chi la chiede ha già in mano quel
    /// documento intero.
    Outline { doc: DocId },
    /// I tag dell'intero vault con la loro frequenza, serviti dal **kernel** dai
    /// modelli (come [`IndexQuery::Outline`], è il canale metadata), in ordine
    /// di chiave canonica. Chi vuole i più usati ordina lui: l'ordine stabile
    /// è quello che rende paginabile la risposta.
    Tags {
        #[serde(default)]
        page: Option<Page>,
    },
    /// I vicini di un documento nel grafo dei link, fino a `depth` passi.
    ///
    /// È il grafo (7.3) che entra nel contratto: finché usciva solo da un
    /// comando dell'app, una vista a grafo di terzi era impossibile e quella
    /// ufficiale restava superficie privilegiata. `depth: 1` con
    /// [`LinkDirection::Outbound`] è l'adiacenza pura — il mattone con cui si
    /// ricostruisce il grafo intero, un documento alla volta.
    Neighbors {
        doc: DocId,
        #[serde(default)]
        direction: LinkDirection,
        /// Passi di distanza, almeno 1 (`0` → risposta vuota).
        depth: u8,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I documenti che soddisfano dei filtri sul frontmatter, con le loro
    /// proprietà: la base di 9.1 (ricerca per campo), 8.4 (collezioni), 11
    /// (database su file), 16 (template con query). La serve il **kernel**, che
    /// il frontmatter di ogni nota ce l'ha già in cache.
    Properties {
        /// In AND fra loro; vuoto = tutti i documenti.
        #[serde(default)]
        filter: Vec<PropertyFilter>,
        #[serde(default)]
        sort: Option<PropertySort>,
        /// Le chiavi da restituire; vuoto = tutto il frontmatter. Esiste per
        /// non far viaggiare l'intero frontmatter di mille note quando ne
        /// servono due colonne — e per non doverlo aggiungere dopo il freeze,
        /// quando un campo in più a un record è una migrazione.
        #[serde(default)]
        select: Vec<String>,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I valori distinti di una proprietà con quante note li portano: le
    /// **faccette** di 9.1. Un elenco contribuisce con ogni suo elemento (una
    /// nota con `autore: [a, b]` conta per `a` e per `b`), che è ciò che una
    /// faccetta deve fare.
    PropertyValues {
        key: String,
        /// Gli stessi filtri di [`IndexQuery::Properties`]: le faccette si
        /// contano **sul sottoinsieme già filtrato**, o la navigazione per
        /// faccette non converge mai.
        #[serde(default)]
        filter: Vec<PropertyFilter>,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Un controllo di salute del vault (7.2), servito dal **kernel** dal grafo
    /// e dai modelli in memoria.
    VaultHealth {
        check: HealthCheck,
        #[serde(default)]
        page: Option<Page>,
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

/// Un vicino nel grafo (risposta a [`IndexQuery::Neighbors`]).
///
/// `via` è l'anello precedente del cammino, e c'è perché senza di esso una
/// risposta con `depth > 1` è un sacchetto di nodi: con esso è un **albero**, e
/// gli archi si ricostruiscono. L'arco è `via → doc` per i link uscenti,
/// `doc → via` per gli entranti; a `depth: 1` `via` è il documento interrogato.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NeighborRef {
    pub doc: DocId,
    pub via: DocId,
    /// Passi dal documento interrogato: 1 = adiacente.
    pub depth: u8,
}

/// Un tag del vault con quante note lo portano (risposta a
/// [`IndexQuery::Tags`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagCount {
    /// Nome del tag senza `#`, con la gerarchia intatta (`a/b`).
    pub name: String,
    pub count: u32,
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
    Backlinks(Paged<BacklinkRef>),
    Search(Paged<SearchHit>),
    /// Gli heading di un documento, in ordine di apparizione (risposta a
    /// [`IndexQuery::Outline`]). L'unica risposta senza finestra: cresce con un
    /// documento, non col vault.
    Outline(Vec<Heading>),
    /// I tag del vault con la loro frequenza (risposta a [`IndexQuery::Tags`]).
    Tags(Paged<TagCount>),
    /// I vicini nel grafo (risposta a [`IndexQuery::Neighbors`]), per distanza
    /// crescente e poi per `DocId`.
    Neighbors(Paged<NeighborRef>),
    /// I documenti che passano i filtri, con le loro proprietà (risposta a
    /// [`IndexQuery::Properties`]).
    Properties(Paged<DocumentProperties>),
    /// Le faccette di una proprietà (risposta a [`IndexQuery::PropertyValues`]).
    PropertyValues(Paged<PropertyCount>),
    /// I problemi trovati (risposta a [`IndexQuery::VaultHealth`]).
    VaultHealth(Paged<HealthIssue>),
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

/// Reazione agli eventi del vault.
///
/// # Semantica di consegna (contratto)
///
/// Gli eventi arrivano **dopo che la tua chiamata è tornata**, mai dentro di
/// essa: se durante `handle` (o `on_action`, `flush`, `activate`) emetti
/// eventi o scrivi documenti via [`HostApi`], gli handler — te compreso — li
/// ricevono quando il tuo frame si è chiuso. Un provider non è mai rientrato
/// nella propria istanza. È la semantica che il component model impone a M5
/// (un'istanza WASM non è rientrante) e vale identica in nativo: contarci
/// sopra in un senso o nell'altro non è un dettaglio d'implementazione.
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

/// La versione del contratto che QUESTO abi definisce. È la stessa del
/// `package fubmd:abi@…` nel WIT (il test di conformità le confronta).
pub const ABI_VERSION: &str = "0.1.0";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// La versione del contratto (`fubmd:abi@X.Y.Z`) contro cui il plugin è
    /// stato scritto. È il punto d'appoggio della promessa "cambi additivi
    /// versionati post-freeze": senza un campo versione fin dal primo
    /// manifest, il campo aggiunto dopo avrebbe lui stesso bisogno di una
    /// versione per essere letto.
    ///
    /// La regola di caricamento è [`abi_compatible`]: si rifiuta una major
    /// diversa, si accetta una minor uguale o inferiore a quella dell'host
    /// (il contratto post-freeze cresce solo per aggiunta).
    pub abi_version: String,
    pub permissions: PluginPermissions,
}

/// Un plugin che dichiara `declared` può girare su un host che parla
/// [`ABI_VERSION`]?
///
/// La regola del freeze (M4): **major diversa → rifiuto** (il contratto è
/// cambiato in modo incompatibile); **minor del plugin ≤ minor dell'host →
/// accetto** (post-freeze il contratto cresce solo per aggiunta, quindi un
/// host più nuovo serve ogni plugin più vecchio); minor del plugin maggiore →
/// rifiuto (il plugin usa cose che questo host non ha). La patch non conta.
/// Una versione che non parsa si rifiuta: meglio un no chiaro che un runtime
/// a sorpresa.
pub fn abi_compatible(declared: &str) -> bool {
    fn major_minor(v: &str) -> Option<(u64, u64)> {
        let mut parts = v.trim().split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        Some((major, minor))
    }
    match (major_minor(declared), major_minor(ABI_VERSION)) {
        (Some((dmaj, dmin)), Some((hmaj, hmin))) => dmaj == hmaj && dmin <= hmin,
        _ => false,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_abi_version_rule_rejects_other_majors_and_newer_minors() {
        assert!(abi_compatible(ABI_VERSION), "l'host accetta sé stesso");
        assert!(
            abi_compatible("0.0.9"),
            "una minor inferiore è servibile: post-freeze si cresce per aggiunta"
        );
        assert!(
            !abi_compatible("0.2.0"),
            "una minor superiore usa cose che l'host non ha"
        );
        assert!(!abi_compatible("1.0.0"), "una major diversa è un rifiuto");
        assert!(
            abi_compatible("0.1.999"),
            "la patch non conta: non cambia il contratto"
        );
        assert!(!abi_compatible(""), "una versione che non parsa si rifiuta");
        assert!(!abi_compatible("abc"));
        assert!(!abi_compatible("0"));
    }

    #[test]
    fn a_window_keeps_the_total_of_what_it_did_not_return() {
        let items: Vec<u32> = (0..10).collect();

        let all = Paged::window(items.clone(), None);
        assert_eq!(all.items.len(), 10, "senza finestra si restituisce tutto");
        assert_eq!((all.offset, all.total), (0, 10));

        let page = Paged::window(items.clone(), Some(Page::new(4, 3)));
        assert_eq!(page.items, vec![4, 5, 6]);
        assert_eq!(
            (page.offset, page.total),
            (4, 10),
            "`total` è il conteggio PRIMA della finestra: senza, chi disegna \
             non sa che esiste una pagina dopo"
        );

        let beyond = Paged::window(items.clone(), Some(Page::new(99, 5)));
        assert!(
            beyond.items.is_empty(),
            "oltre la fine è vuoto, non un errore"
        );
        assert_eq!(beyond.total, 10);

        let none = Paged::window(items, Some(Page::first(0)));
        assert!(
            none.items.is_empty(),
            "limite 0 è nessun elemento — «tutti» si chiede omettendo la Page"
        );
    }

    #[test]
    fn a_job_id_crosses_the_json_boundary_as_a_string() {
        // u64 pieno: come `number` JS perderebbe i bit oltre 2^53.
        let id = JobId(u64::MAX);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{}\"", u64::MAX));
        assert_eq!(serde_json::from_str::<JobId>(&json).unwrap(), id);
        // I client scritti prima della regola mandavano il numero nudo.
        assert_eq!(serde_json::from_str::<JobId>("7").unwrap(), JobId(7));
    }
}
