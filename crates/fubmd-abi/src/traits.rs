//! Gli **altri trait di estensione**, definiti una volta sola qui nel contratto.
//! Le feature ufficiali (backlink, ricerca, graph) li implementano in modo
//! nativo; i plugin di terzi (M5) li implementeranno via proxy WASM. Il kernel
//! vede sempre `dyn Trait` e non sa quale backend c'è dietro.
//!
//! Nota M1: la superficie è definita per intero (è il valore del crate-contratto),
//! ma l'app M1 cabla solo ciò che serve — backlink e ricerca passano per
//! `IndexProvider`/il grafo del kernel.

use serde::{Deserialize, Serialize};

use crate::command::{CommandOutcome, CommandSpec, InvokeMode, ParamSpec};
use crate::edit::{EditReport, EditRequest, Revision};
use crate::error::PluginError;
use crate::event::{Event, EventMask, Notice};
use crate::format::DocumentFormat;
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
// Cestino: la forma di ciò che è stato cancellato ma non distrutto.
// ---------------------------------------------------------------------------

/// Una voce del cestino del vault.
///
/// Sale nel contratto con la decisione 0013 perché [`HostApi::list_trash`] la restituisce:
/// prima viveva nel kernel, dove il solo lettore era la shell attraverso un
/// comando Tauri. Porta **due** id perché sono due domande diverse — dove il
/// file si trova ora (`id`, ed è quello che si passa a
/// [`restore_document`](HostApi::restore_document)) e dove tornerebbe
/// (`original`) — e un cestino che sapesse solo la prima non saprebbe
/// ripristinare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrashEntry {
    /// Dove il file si trova ora: `.trash/Nota.2026-07-24T15-30-00.md`.
    pub id: DocId,
    /// Dove tornerebbe un ripristino: il path d'origine se il vault lo
    /// ricorda, altrimenti il nome de-timbrato nella radice.
    pub original: DocId,
    /// Istante della cancellazione (secondi UNIX).
    pub deleted_at: u64,
    pub size: u64,
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
/// su disco né di sapere che ore sono. La decisione 0013 ha chiuso l'elenco: dopo il
/// freeze un metodo **aggiunto** qui è una minor, uno **tolto** è una major.
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
    ///
    /// È la scrittura di chi il documento intero ce l'ha in mano: l'editor che
    /// salva il proprio buffer, un importer che crea una nota. Chi vuole
    /// cambiarne **un pezzo** usa [`apply_edit`](HostApi::apply_edit) — non per
    /// eleganza, ma perché una riscrittura totale non dice cosa è cambiato e
    /// non si accorge di chi ha scritto nel frattempo.
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;

    /// La revisione del sorgente di un documento: l'identità del testo su cui
    /// si sta per calcolare una modifica.
    ///
    /// È una capacità e non un calcolo perché la [`Revision`] è **opaca** (solo
    /// l'uguaglianza è contratto) e come l'host la derivi non è promesso a
    /// nessuno: un provider che se la ricavasse da sé dal sorgente si legherebbe
    /// a questa implementazione. Vedi [`crate::edit`].
    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError>;

    /// Cambia **un pezzo** di documento: gli edit della richiesta, tutti o
    /// nessuno, sul sorgente che la sua `base` nomina.
    ///
    /// È la primitiva su cui poggia ogni modifica programmatica che non sia la
    /// riscrittura di un file intero — spuntare un task, scrivere una proprietà,
    /// correggere un link, inserire un template — e senza la quale ognuna di
    /// esse rileggerebbe e riscriverebbe tutto, perdendo per strada cosa è
    /// cambiato e chi altro stava scrivendo.
    ///
    /// [`PluginError::Conflict`] = il documento è cambiato da quando gli edit
    /// sono stati calcolati, e non è stato scritto niente: chi chiama rilegge,
    /// ricalcola e riprova. [`PluginError::BadArgs`] = gli edit non stanno in
    /// piedi (fuori dal sorgente, a metà di un carattere, sovrapposti).
    ///
    /// Il rapporto torna nelle coordinate del testo **nuovo** e porta ciò che
    /// era stato sostituito: è quanto serve a mettere il cursore dove l'utente
    /// se lo aspetta, e a costruire l'edit inverso
    /// ([`EditReport::inverse`](crate::edit::EditReport::inverse)).
    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError>;

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

    // --- il modello parsato, e di che formato è ------------------------------
    //
    // Le due capacità del §4.2 e del §4.3, che sono la stessa domanda a due
    // distanze: *cosa c'è dentro questo documento* e *cosa saprei farci*. Stanno
    // qui accanto a `read_document` perché sono la stessa specie di cosa — una
    // lettura del vault — e non dentro [`IndexQuery`], che è il canale di ciò
    // che è **derivato** e aggregato. Vedi il § in testa a `IndexQuery` per la
    // linea di confine, e il verbale della decisione 0018 per perché passa di lì.
    //
    // I due nomi dicono i due **costi**, ed è deliberato: `read_` è una lettura
    // (disco, parse), `_of` è una domanda sul nome a cui risponde una mappa. Una
    // coppia simmetrica — `document_model`/`document_format` — sarebbe stata più
    // ordinata e avrebbe nascosto che una delle due si può fare tremila volte e
    // l'altra no.

    /// La struttura di un documento: il modello parsato, con gli `Span`. Il
    /// gemello di [`read_document`](HostApi::read_document), che ne dà la
    /// sorgente.
    ///
    /// È il verso che mancava. Uno c'era, ed è
    /// [`IndexProvider::on_document_indexed`]: **spinto**, a chi indicizza,
    /// quando lo decide il kernel. Chi sta dentro un indice era quindi già
    /// servito — un indice dei task, le flashcard da blocchi, le citazioni, il
    /// chunking per l'embedding ricevono ogni modello mentre passa. Tagliato
    /// fuori era il percorso **one-shot**: chi ha bisogno del modello di
    /// *questo* documento *adesso* e non era in ascolto quando è passato — un
    /// comando che spunta il task sotto il cursore, un
    /// [`ExportProvider`](crate::transfer::ExportProvider) su un documento solo,
    /// un linter su richiesta, un TOC generato al volo. Le sue due strade erano
    /// entrambe storte: riparsare con un parser proprio, o registrare un
    /// `IndexProvider`-specchio al solo scopo di veder passare i modelli — cioè
    /// tenere una copia dell'intero vault per rispondere a una domanda su una
    /// nota.
    ///
    /// # Cosa costa, detto nella firma
    ///
    /// **Rilegge e riparsa dal disco a ogni chiamata.** Non è un dettaglio
    /// d'implementazione ma il contratto, perché un canale che serve una cache e
    /// uno che riparsa sono due firme diverse e la differenza si vede quando il
    /// chiamante cammina l'intero vault. La cache del kernel tiene i soli
    /// **metadati** (identità, frontmatter, outline, link): il corpo non c'è, e
    /// promettere un modello servito dalla cache sarebbe promettere una cache
    /// che non esiste. Chi vuole i soli metadati non passa di qui e non paga il
    /// disco — [`IndexQuery::Outline`], [`IndexQuery::Properties`] e
    /// [`IndexQuery::Tags`] rispondono dalla cache calda.
    ///
    /// Il modello è quello del **file**, con le regole di sintassi registrate
    /// già applicate. Un buffer aperto e non salvato non lo conosce nessuno al
    /// di qua del confine: chi disegna un editor tiene il proprio testo, e la
    /// verità del vault è ciò che sta sul disco.
    ///
    /// Documento che il vault non conosce → [`PluginError::Internal`] con il
    /// nome dentro; è la stessa risposta di [`read_document`](HostApi::read_document),
    /// e per la stessa ragione — non è una domanda malformata, è una domanda su
    /// qualcosa che non c'è.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError>;

    /// Di che formato è un documento, e che sintassi capirebbe: il
    /// [`DocumentFormat`](crate::format::DocumentFormat) di un [`DocId`].
    ///
    /// `None` = **nessun provider lo rivendica**, ed è una risposta utile
    /// quanto le altre: è il modo con cui chi cammina una lista sa che quel
    /// nome non è roba sua e va ignorato, invece di provare a leggerlo e
    /// dedurlo dall'errore.
    ///
    /// Non restituisce un `Result` e non tocca il disco: è una domanda sul
    /// **nome**, risolta dal registro dei formati sull'estensione. Vale quindi
    /// anche per un documento che non esiste ancora — chi sta per creare
    /// `Diario/2026-07-26.md` può chiedere prima chi lo tratterà — e si può
    /// fare su tutta una lista senza pagare un'apertura a testa.
    fn format_of(&self, id: &DocId) -> Option<DocumentFormat>;

    // --- operazioni strutturali sul vault -----------------------------------
    //
    // Creare, rinominare, cestinare: le tre cose che si fanno a un documento
    // *senza aprirlo*. Fino alla decisione 0013 erano kernel-owned e fuori dal contratto, e
    // la conseguenza era che template, daily note, import, auto-archiviazione e
    // cleanup wizard (FEATURES 16, 17, 8.3, 7.2) non potevano essere un plugin:
    // il vault sapeva farle, il confine no.
    //
    // Sono le capacità che il §7.3 metterà sotto `write_vault`. Oggi il varco
    // che le rifiuta è quello della decisione 0010: un comando in sola lettura, o
    // simulato, le riceve tutte negate.

    /// Crea un documento **nuovo** con il sorgente dato, e fallisce se quel
    /// path è già occupato.
    ///
    /// È questo rifiuto a distinguerla da [`write_document`](HostApi::write_document),
    /// che crea ciò che non c'è e sovrascrive ciò che c'è: un plugin di
    /// template che scrivesse la nota di oggi con `write_document` e sbagliasse
    /// la data **cancellerebbe** una nota dell'utente, senza che niente nel
    /// codice sembri una cancellazione. Chi vuole un nome comunque libero lo
    /// chiede a [`free_name`](HostApi::free_name) e passa quello: due capacità
    /// che si compongono dicono cosa succede, una che rinomina in silenzio no.
    ///
    /// L'id è quello del chiamante e non un nome da cui l'host deriva un path:
    /// un importer o un template sanno *dove* va la nota (`Diario/2026-07-26.md`),
    /// e un host che scegliesse la cartella al posto loro renderebbe
    /// inesprimibile metà del capitolo 16.
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;

    /// Rinomina/sposta un documento **preservando l'identità**, e riscrive i
    /// wikilink entranti che puntavano al vecchio nome.
    ///
    /// È il rename del kernel, non un rename "nudo": non ce ne sono due. Un
    /// rename che lasciasse i backlink rotti non è una versione più semplice
    /// della stessa operazione — è un'operazione che mette il vault in uno
    /// stato che l'utente non ha chiesto, e che nessuna delle due firme
    /// direbbe. Chi davvero vuole spostare un file senza toccare nessun altro
    /// documento oggi non ha un chiamante; il giorno che l'avrà, sarà un
    /// parametro in più su una capacità nuova, non un secondo significato di
    /// questo nome.
    ///
    /// Ne segue che una rinomina è un **lotto** (decisione 0011): N sorgenti riscritti,
    /// un solo [`Event::BatchEnded`](crate::Event::BatchEnded). Chiamata da
    /// dentro un lotto già aperto — un comando, per esempio — vi si unisce
    /// invece di aprirne un altro.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError>;

    /// Sposta un documento nel cestino e restituisce dov'è finito.
    ///
    /// Si chiama `trash_` e non `delete_` perché è ciò che fa: il documento
    /// esce dal vault (e dagli indici, e da
    /// [`list_documents`](HostApi::list_documents)) ma non è distrutto, e l'id
    /// restituito è quello con cui si ripristina. L'unica capacità che
    /// distrugge è [`empty_trash`](HostApi::empty_trash), e si chiama così.
    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError>;

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Sta qui accanto a [`list_documents`](HostApi::list_documents) e non
    /// dentro [`IndexQuery`] perché il cestino **non è indicizzato**: una nota
    /// cestinata non ha modello, né tag, né archi nel grafo — è esattamente
    /// ciò che l'indice non contiene. Interrogarlo dal canale dati sarebbe
    /// promettere che il canale dati sappia rispondere su ciò che non ha
    /// letto.
    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError>;

    /// Riporta nel vault una voce del cestino (`entry` è il suo
    /// [`TrashEntry::id`]) e restituisce il [`DocId`] con cui è tornata: il suo
    /// path d'origine, oppure `to` se il chiamante ne sceglie un altro.
    ///
    /// Il ripristino è una scrittura normale — parse, grafo, indici, eventi —
    /// e quindi è a sua volta annullabile. Se il path d'origine è di nuovo
    /// occupato e `to` non è stato dato, è un errore e non un nome scelto
    /// d'ufficio: chi chiama ha [`free_name`](HostApi::free_name) e decide.
    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError>;

    /// Svuota il cestino e dice quante voci ha distrutto.
    ///
    /// È l'unica capacità del contratto da cui non si torna indietro, e per
    /// questo è una capacità a sé e non un `trash_document(force: true)`: un
    /// booleano che cambia "sposta" in "distruggi" è il tipo di parametro che
    /// si passa sbagliato una volta sola.
    ///
    /// Il conteggio è un `u64` e non un `usize`: al confine il guest può essere
    /// a 32 bit, e un tipo che cambia larghezza a seconda di chi lo compila non
    /// è un tipo del contratto.
    fn empty_trash(&mut self) -> Result<u64, PluginError>;

    /// Emette un evento sull'event bus.
    fn emit(&mut self, event: Event);
    /// Chiede l'esecuzione in background di un job ([`Plugin::run_job`]).
    /// Ritorna subito con l'identità del job; l'esito arriverà come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono normale.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;

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
    /// l'altra metà del problema, e arriva con le istanze di view (§2.3).
    fn active_context(&self) -> Option<ViewContext>;

    /// Invoca un comando del registro (decisione 0009).
    ///
    /// È la capacità che rende **componibili** macro e automazioni (16.2, 16.3):
    /// senza, ogni plugin che voglia fare ciò che un altro sa già fare deve
    /// conoscerlo, dipenderne e rifarlo. Con, ne conosce l'id — che è l'unica
    /// cosa che una `CommandSpec` promette di non cambiare.
    ///
    /// Tre cose che questa firma dice *non* dicendole:
    ///
    /// - **Non prende un [`InvokeMode`]**: il modo è dell'host, non della
    ///   chiamata. Un comando che si sta simulando invoca in simulazione, e
    ///   riceve il *piano* di ciò che il comando invocato farebbe; il piano di
    ///   una macro è l'unione dei piani dei suoi passi. Se il modo fosse un
    ///   argomento, una simulazione potrebbe diventare reale invocando
    ///   qualcuno — che è esattamente il buco che la decisione 0010 ha chiuso.
    /// - **Non prende un [`Actor`](crate::event::Actor)**: l'attore non si
    ///   riazzera invocando. È chi ha chiesto, cioè chi è *entrato* nel kernel
    ///   (l'utente dalla IPC, il watcher, il plugin da un handler), e resta lui
    ///   per tutta la catena. Un comando che si intestasse le scritture che
    ///   compie per conto dell'utente direbbe all'automazione che le ha chieste
    ///   lei — e un'automazione che non riconosce più chi ha chiesto è quella
    ///   che si richiama da sola.
    /// - **Non apre un lotto suo**: si unisce a quello aperto. Una macro di tre
    ///   comandi è *una* cosa che qualcuno ha chiesto, quindi un
    ///   [`Event::BatchEnded`](crate::Event::BatchEnded) solo, quindi un
    ///   ridisegno solo.
    ///
    /// Un comando non può invocare sé stesso, nemmeno per giro: la catena è
    /// nota all'host, e una ricorsione risponde
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) nominando il giro.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError>;
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

/// Chi offre azioni al registro dei comandi: la palette, la tastiera, le macro
/// (16.2), la CLI (27.1) e il centro di comando (22.4) sono tutti clienti dello
/// stesso elenco. I tipi stanno in [`crate::command`], che è dove la forma di un
/// comando è ragionata per intero.
///
/// # Come l'host chiama, e cosa garantisce
///
/// - Gli argomenti arrivano **già convalidati** contro la
///   [`CommandSpec`]: un comando non deve difendersi da un chiamante distratto,
///   e i `params` che ha dichiarato sono la sua difesa.
/// - Con [`InvokeMode::DryRun`] — e con qualunque modo, se la spec dice
///   `writes: false` — l'`host` prestato è in **sola lettura**: ogni scrittura
///   risponde [`PluginError::PermissionDenied`]. La simulazione non è una
///   promessa di chi implementa.
/// - La consegna degli eventi è quella di sempre: ciò che il comando emette o
///   scrive arriva agli handler **dopo** che `invoke` è tornata (vedi
///   [`EventHandler`]).
pub trait CommandProvider: Send + Sync {
    fn commands(&self) -> Vec<CommandSpec>;
    /// Esegue (o simula) un comando. `command` è un id fra quelli di
    /// [`commands`](CommandProvider::commands); un id ignoto è
    /// [`PluginError::UnknownCommand`].
    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError>;
}

// ---------------------------------------------------------------------------
// View (UI dichiarativa)
// ---------------------------------------------------------------------------

/// Dove una view si **ancora**. Non è come si disegna — quello è l'albero
/// [`UiNode`] — ma quale superficie della finestra occupa.
///
/// Erano tre (`LeftSidebar`, `RightSidebar`, `Bottom`) e con tre superfici
/// nominate ogni capitolo grande di FEATURES doveva uscire dal contratto per
/// avere un posto dove stare: il grafo lo ha già fatto, con un comando bespoke e
/// un renderer privato, **non** perché sia speciale ma perché non c'era un posto
/// dove metterlo. Il nome è cambiato da `ViewPlacement` a `ViewSurface` perché
/// una voce di menu o una scheda di impostazioni non è un *posto in un layout*:
/// è una superficie della shell a cui ci si attacca. Le tre di prima restano
/// dove erano, in testa e nello stesso ordine, perché sono lo stesso
/// discriminante.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewSurface {
    LeftSidebar,
    RightSidebar,
    Bottom,
    /// L'area principale, cioè dove oggi c'è l'editor e basta. È la superficie
    /// che mancava di più: database (11), canvas e slide (12), grafo (7.3),
    /// viste task (10.3), dashboard (11.5) e calendario (10.4) vivono qui, e
    /// senza di essa ognuno di quei capitoli ripete la scappatoia del grafo.
    ///
    /// Che la shell di oggi abbia **un** documento aperto e nessun modello di
    /// tab non è un'obiezione: il modello di layout è la feature 3.3 (§1.2), e
    /// il contratto deve poter nominare la superficie prima che la shell sappia
    /// dividerla in due.
    Main,
    /// Una finestra modale: la view che chiede qualcosa e se ne va.
    Modal,
    /// La barra di stato: poco spazio, sempre visibile. Il posto di ciò che
    /// informa senza interrompere — lo stato del sync (18.1), il conteggio
    /// parole, l'indicizzazione in corso.
    StatusBar,
    /// La barra delle icone: i pulsanti che aprono qualcosa.
    Ribbon,
    /// Una voce nel menu dell'app.
    Menu,
    /// Una voce nel menu contestuale. Cosa fosse il bersaglio del clic lo dice
    /// il contesto di sessione (decisione 0007), non un parametro di questa
    /// superficie.
    ContextMenu,
    /// Una scheda nelle impostazioni (28): è ciò che rende le impostazioni di un
    /// plugin indistinguibili da quelle del core, invece di una finestra a
    /// parte che il plugin deve inventarsi.
    SettingsTab,
}

/// Un esemplare vivo di una view: *quale* view, *quale* esemplare, e con quali
/// parametri.
///
/// È l'altra metà della decisione 0007. Quella risponde a «quale documento sta
/// guardando questa view»; questa a «quale delle tre istanze di questa view
/// sono io». Senza, [`ViewProvider::views`] restituisce un elenco **statico** e
/// non c'è modo di dire *questa view, con questo parametro* — cioè le viste
/// multiple di un database (11.2), le viste salvate (8.3), le query embed
/// parametriche (9.2), una dashboard per progetto (11.5), un canvas per file
/// (12), i task per tag / per cartella / per data (10.3): la stessa view, filtri
/// diversi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViewInstance {
    /// L'id della [`ViewSpec`] di cui questa è un'istanza.
    pub view: String,
    /// L'identità dell'esemplare, unica fra le istanze **vive**. La sceglie chi
    /// apre (la shell, o il comando che ha restituito
    /// [`CommandEffect::OpenView`](crate::command::CommandEffect::OpenView)); il
    /// provider la riceve e basta. Per la view che la shell monta da sola —
    /// quella dichiarata, senza parametri — è l'id della view: un esemplare
    /// solo che si chiama come la sua specie.
    pub instance: String,
    /// Gli argomenti dichiarati in [`ViewSpec::params`], già convalidati contro
    /// di essi come lo sono quelli di un comando: un provider non deve
    /// difendersi da un chiamante distratto.
    #[serde(default)]
    pub params: serde_json::Value,
}

impl ViewInstance {
    /// L'istanza unica di una view senza parametri.
    pub fn only(view: impl Into<String>) -> Self {
        let view = view.into();
        ViewInstance {
            instance: view.clone(),
            view,
            params: serde_json::Value::Null,
        }
    }

    pub fn new(
        view: impl Into<String>,
        instance: impl Into<String>,
        params: serde_json::Value,
    ) -> Self {
        ViewInstance {
            view: view.into(),
            instance: instance.into(),
            params,
        }
    }

    /// Un parametro, per nome.
    pub fn param(&self, name: &str) -> Option<&serde_json::Value> {
        self.params.get(name)
    }

    /// Un parametro testuale — la forma che serve quasi sempre.
    pub fn text_param(&self, name: &str) -> Option<&str> {
        self.param(name).and_then(|v| v.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViewSpec {
    pub id: String,
    pub title: String,
    pub surface: ViewSurface,
    /// Dichiarazione di interesse: gli eventi al cui arrivo la shell deve
    /// ridisegnare questa view (chiamare di nuovo `render_view`).
    ///
    /// È il pezzo di protocollo che dice *quando* una view invecchia: senza,
    /// la shell può solo indovinare per conoscenza privata delle feature — e
    /// per una view di plugin non può indovinare niente. Maschera vuota =
    /// nessun ridisegno event-driven.
    ///
    /// Una view che dichiara
    /// [`IndexUpdated`](crate::event::EventKind::IndexUpdated) deve dichiarare
    /// anche [`BatchEnded`](crate::event::EventKind::BatchEnded): dentro un
    /// lotto (decisione 0011) il primo non arriva, e il secondo è ciò che le fa fare
    /// **un** ridisegno dove prima ne faceva N. Vale a rovescio per una view che
    /// segue i documenti: quelli passano tutti, lotto o no.
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
    /// Gli argomenti con cui si può aprire un'**istanza** di questa view.
    ///
    /// Sono gli stessi [`ParamSpec`] dei comandi, e non un secondo tipo con lo
    /// stesso mestiere: chi apre una view parametrica lo fa quasi sempre da un
    /// comando ([`CommandEffect::OpenView`](crate::command::CommandEffect::OpenView)),
    /// e due grammatiche di parametri vorrebbero dire due convalide, due
    /// descrizioni per un umano e due modi di sbagliarle. Vuoto = la view ha una
    /// sola istanza, quella che la shell monta da sé.
    #[serde(default)]
    pub params: Vec<ParamSpec>,
    /// L'icona con cui la shell la nomina dove non c'è spazio per il titolo (la
    /// ribbon, una scheda). Un nome del repertorio della shell, come
    /// [`UiKind::Icon`](crate::ui::UiKind::Icon); ciò che non conosce lo ignora.
    #[serde(default)]
    pub icon: Option<String>,
    /// L'ordine fra le view della stessa superficie: crescente, i pari merito
    /// nell'ordine di registrazione. Con tre pannelli decideva la shell per
    /// conoscenza privata di quali fossero; con le superfici del §2.2 non ha più
    /// su cosa decidere.
    #[serde(default)]
    pub order: i32,
    /// È aperta appena la superficie esiste, o aspetta che qualcuno la chieda?
    /// Il default (`false`) è **chiusa**, perché una view che si apre da sola
    /// costa lo spazio di tutti quelli che non la volevano.
    #[serde(default)]
    pub open_by_default: bool,
    /// La dimensione che vorrebbe, in pixel logici, sull'asse che la sua
    /// superficie lascia decidere (la larghezza in una sidebar, l'altezza in
    /// basso). È una preferenza: la shell la usa alla prima apertura, e da lì in
    /// poi comanda ciò che l'utente ha trascinato.
    #[serde(default)]
    pub preferred_size: Option<u32>,
    /// Si può chiudere? Il default (`true`) è sì. Una view che dice di no sta
    /// dicendo che la sua superficie non ha senso senza di lei — la barra di
    /// stato di chi la sta usando come tale.
    #[serde(default = "crate::ipc::default_true")]
    pub closable: bool,
}

impl ViewSpec {
    /// Le tre cose che una view non può non dire. Tutto il resto ha un default
    /// dichiarato qui e si aggiunge col builder: con dieci campi, una `ViewSpec`
    /// scritta a mano diventa un elenco di `Default::default()` in cui la riga
    /// che conta non si distingue.
    pub fn new(id: impl Into<String>, title: impl Into<String>, surface: ViewSurface) -> Self {
        ViewSpec {
            id: id.into(),
            title: title.into(),
            surface,
            refresh: EventMask::default(),
            follows: ContextMask::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }
    }

    /// Gli eventi al cui arrivo questa view è invecchiata.
    pub fn refreshing(mut self, refresh: EventMask) -> Self {
        self.refresh = refresh;
        self
    }

    /// Le parti del contesto di sessione che questa view segue.
    pub fn following(mut self, follows: ContextMask) -> Self {
        self.follows = follows;
        self
    }

    pub fn with_params(mut self, params: Vec<ParamSpec>) -> Self {
        self.params = params;
        self
    }

    pub fn with_icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn ordered(mut self, order: i32) -> Self {
        self.order = order;
        self
    }

    pub fn open_by_default(mut self) -> Self {
        self.open_by_default = true;
        self
    }

    pub fn sized(mut self, preferred_size: u32) -> Self {
        self.preferred_size = Some(preferred_size);
        self
    }

    pub fn unclosable(mut self) -> Self {
        self.closable = false;
        self
    }

    /// I parametri di un'istanza sono compilabili contro questa spec?
    ///
    /// È la stessa convalida degli argomenti di un comando, e letteralmente la
    /// stessa funzione: chi apre una view da un comando e chi la apre a mano
    /// devono ricevere la stessa risposta sullo stesso argomento sbagliato.
    pub fn validate_params(&self, params: &serde_json::Value) -> Result<(), PluginError> {
        crate::command::validate_params(&self.id, &self.params, params)
    }
}

/// Chi disegna una view.
///
/// # Perché `render_view` prende `&self` e `on_action` `&mut self`
///
/// Le due firme dicono insieme cosa può essere una view, e prima di questa
/// seduta dicevano che era una funzione **pura**: entrambe prendevano `&self`,
/// quindi filtro corrente, tab attiva, pagina, ordinamento, selezione e sezioni
/// aperte non avevano dove stare se non dietro un `Mutex` che ogni autore di
/// provider si inventava per conto suo. Con tre pannelli in sola lettura non si
/// notava; con i nodi di input del §2.1 è il caso normale.
///
/// Ora il percorso di **scrittura** (`on_action`) può mutare il provider e
/// quello di **lettura** (`render_view`) no. Non è un compromesso: è la stessa
/// divisione che regge `index.query` e il §8.3 — N view che si ridisegnano non
/// si aspettano a vicenda, e il giorno che il render girasse in parallelo la
/// firma lo permette già. Il kernel estrae il provider dal workspace per la
/// durata di `on_action`, come faceva prima per prestargli l'host in scrittura;
/// il costo di `&mut self` è quindi zero, ed è per questo che la terza strada —
/// l'interior mutability dichiarata a contratto — non serve più a nessuno.
///
/// A M5 la firma non si vede: nel WIT `self` non compare, e un componente WASM
/// muta la propria memoria lineare senza chiedere permesso a nessuno. È il
/// motivo per cui questa è la scelta che costa meno di tutte al confine.
pub trait ViewProvider: Send + Sync {
    fn views(&self) -> Vec<ViewSpec>;
    /// Restituisce l'albero di UI dichiarativa per **questa istanza** della
    /// view.
    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn HostApi,
    ) -> Result<UiNode, PluginError>;
    fn on_action(
        &mut self,
        instance: &ViewInstance,
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
//
// # Dove finisce questo canale, e comincia una lettura
//
// Qui sta ciò che è **derivato**: aggregato sul vault (i tag, le faccette, la
// salute), oppure calcolato su una relazione che nessun documento contiene da
// solo (i backlink, i vicini). Il documento **in sé** — la sua sorgente, la sua
// struttura, di che formato è — non passa di qui ma dall'[`HostApi`]
// (`read_document`, `read_model`, `format_of`), e la ragione è
// duplice. La prima: una `IndexQuery` ha un dispatch *per tentativi* fra i
// provider registrati, e una variante che il kernel serve sempre da sé
// aggiungerebbe l'ottava su nove che a un provider non arriva mai — cioè
// crescerebbe esattamente il difetto del §5.1. La seconda: `IndexResult` è
// l'enum su cui ogni indice fa `match`, e infilarci un `DocumentModel` intero
// vorrebbe dire farlo attraversare la firma di chi non lo ha chiesto.
//
// [`IndexQuery::Outline`] e [`IndexQuery::Tags`] stanno di qua e restano di
// qua: sono **proiezioni** che il kernel tiene in cache, e servirle costa una
// lettura di mappa invece di un parse. Il criterio non è "riguarda un
// documento" — è *chi lo sa già*.

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
/// perché la stringa è il linguaggio del provider (oggi tantivy, §5.3) mentre
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
/// l'OR e le parentesi arrivano con la query come AST (§5.3), e finché non
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

/// Una proprietà con il suo valore normalizzato ([`PropertyValue`], decisione 0003).
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
///
/// # Cosa arriva: l'evento e la sua origine (decisione 0012)
///
/// [`handle`](EventHandler::handle) riceve un [`Notice`], non un [`Event`] nudo:
/// accanto a *cosa* è successo c'è **chi lo ha chiesto**
/// ([`Origin::actor`](crate::event::Origin::actor)) e di quale **lotto** fa
/// parte ([`Origin::batch`](crate::event::Origin::batch)). È ciò che rende
/// scrivibile un'automazione su-modifica: senza,
/// [`Actor::is_plugin`](crate::event::Actor::is_plugin) non avrebbe niente da
/// leggere e ogni handler che scrive dovrebbe riconoscere le proprie scritture
/// dal loro *contenuto* — cioè richiamarsi da solo finché il budget del dispatch
/// non lo tronca.
///
/// # E cosa non arriva: `index-updated` dentro un lotto
///
/// Chi dichiara [`EventKind::IndexUpdated`](crate::event::EventKind::IndexUpdated)
/// deve dichiarare anche
/// [`EventKind::BatchEnded`](crate::event::EventKind::BatchEnded): dentro un
/// lotto è il solo dei due che arriva (vedi [`crate::event`]). Gli eventi
/// **per-documento** invece passano tutti, dentro un lotto come fuori.
pub trait EventHandler: Send + Sync {
    fn subscribed(&self) -> EventMask;
    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError>;
}

// ---------------------------------------------------------------------------
// Ciclo di vita del plugin (bundle nativo o WASM)
// ---------------------------------------------------------------------------

/// Cosa un plugin dichiara di voler fare.
///
/// Erano tre booleani — leggere, scrivere, rete — contro ciò che il 20.1, il
/// 23.1 e il 20.3 chiedono: appunti, camera e microfono, filesystem esterno, e
/// soprattutto **rete con allowlist** e **file con allowlist**, cioè permessi
/// che hanno un *parametro*. Un booleano non ha dove metterlo, e il permesso
/// «rete» senza allowlist è o tutto o niente.
///
/// Le chiavi del core stanno in [`permission`](crate::options::permission); il
/// valore è il parametro (una lista di host, un elenco di prefissi di path).
/// Un permesso con un namespace di terzi resta nella mappa e attraversa il
/// confine intatto: un host che non lo conosce può **rifiutarlo**, che è
/// esattamente ciò che un enum chiuso non gli avrebbe permesso di fare.
///
/// Il **punto di applicazione non esiste ancora** ed è il §7.3: qui c'è la
/// forma, che è la metà che scade col freeze.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PluginPermissions {
    pub granted: crate::options::OptionMap,
}

impl PluginPermissions {
    /// I permessi che dichiarano questi nomi, senza parametro.
    pub fn of(names: &[&str]) -> Self {
        PluginPermissions {
            granted: names
                .iter()
                .fold(crate::options::OptionMap::new(), |m, n| m.on(*n)),
        }
    }

    pub fn has(&self, name: &str) -> bool {
        self.granted.enabled(name)
    }
}

/// La versione del contratto che QUESTO abi definisce. È la stessa del
/// `package fubmd:abi@…` nel WIT (il test di conformità le confronta).
pub const ABI_VERSION: &str = "0.1.0";

// Niente `Eq`: i permessi portano un parametro JSON, e `serde_json::Value` non
// è `Eq` (contiene numeri in virgola mobile). È lo stesso motivo per cui
// `Block::Custom` si ferma a `PartialEq`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
