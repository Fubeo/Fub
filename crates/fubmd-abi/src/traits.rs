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
use crate::query::{QueryExpr, QueryPredicate};
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
/// Sale nel contratto con la decisione 0013 perché [`VaultRead::list_trash`] la restituisce:
/// prima viveva nel kernel, dove il solo lettore era la shell attraverso un
/// comando Tauri. Porta **due** id perché sono due domande diverse — dove il
/// file si trova ora (`id`, ed è quello che si passa a
/// [`restore_document`](VaultStructure::restore_document)) e dove tornerebbe
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

// ---------------------------------------------------------------------------
// Le capacità, per famiglia
// ---------------------------------------------------------------------------
//
// Le ventidue capacità della decisione 0013 — ventiquattro, contando le due che
// la 0018 ha aggiunto, venticinque col `call_service` della 0021 — non stanno
// in un trait solo, e la ragione è il §7.1: un trait solo si implementa **per
// intero o per niente**, e chi ne può fare solo una metà (il percorso di
// render, che ha il workspace in prestito condiviso; un comando che si è
// dichiarato di sola lettura; a M5 un componente senza il permesso di
// scrivere) è costretto a scrivere l'altra metà come una fila di rifiuti.
// Erano novantasei corpi di metodo per quattro implementazioni, di cui ventidue
// non facevano niente se non dire di no.
//
// Le famiglie sono dieci e sono scelte su un criterio solo: **cosa vuol dire
// negarne una.** È per questo che la lettura del vault sta separata dalla sua
// scrittura e dalle operazioni strutturali (i tre gradi che `read_vault` e
// `write_vault` distinguono, §7.3), che i blob del plugin si dividono nello
// stesso modo, e che ciò che l'host sa e il provider no — l'orologio, il
// pannello attivo — è una famiglia sua e non un residuo.
//
// Chi implementa tutto lo dichiara una volta: [`HostApi`] e [`ReadApi`] sono
// **somme**, con una impl generica, e nessuno le implementa a mano. Chi le
// riceve continua a scrivere `&mut dyn HostApi` come prima.
//
// Al confine WIT le dieci famiglie sono dieci `interface`, e lì la scomposizione
// smette di essere una comodità di tipi: un componente a cui il mondo non
// importa `host-vault-write` non ha **modo** di chiamarla — il rifiuto non è
// più una risposta a runtime, è l'assenza della funzione.

/// Leggere il vault: la sorgente, la struttura, l'elenco, il cestino.
///
/// È la famiglia sotto
/// [`permission::READ_VAULT`](crate::options::permission::READ_VAULT), ed è la
/// sola che ogni percorso ha — anche quello di render, anche una simulazione.
pub trait VaultRead: Send + Sync {
    /// Legge la sorgente di un documento dal vault.
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;

    /// La revisione del sorgente di un documento: l'identità del testo su cui
    /// si sta per calcolare una modifica.
    ///
    /// È una capacità e non un calcolo perché la [`Revision`] è **opaca** (solo
    /// l'uguaglianza è contratto) e come l'host la derivi non è promesso a
    /// nessuno: un provider che se la ricavasse da sé dal sorgente si legherebbe
    /// a questa implementazione. Vedi [`crate::edit`].
    ///
    /// Sta fra le **letture**, e non è una svista: chi prepara una modifica
    /// (calcolare gli edit è la parte lunga) può farlo mentre disegna, e
    /// consegnarla poi da dove si scrive.
    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError>;

    /// I documenti del vault, in ordine di id, **a finestra**.
    ///
    /// Senza, `read_document` serve solo per gli id che arrivano dagli eventi:
    /// un plugin non potrebbe rispondere a [`Event::VaultOpened`] guardandosi
    /// intorno, né costruire alcunché sull'intero vault.
    ///
    /// La [`Page`] non è un ornamento e non è simmetria con [`IndexQuery`]: è il
    /// metodo con cui un provider si guarda intorno, e senza finestra clona
    /// **tutto** il vault a ogni chiamata — il versioning lo chiama a ogni
    /// riconciliazione, e ogni feature che riparte da [`Event::VaultOpened`] lo
    /// chiamerà. `None` resta "tutto", perché chi ha davvero bisogno
    /// dell'insieme intero non deve inventarsi un tetto (è la stessa regola di
    /// [`Page`] nelle query); ma adesso chi ne vuole venti chiede venti, e il
    /// `total` gli dice quanti sono in tutto.
    ///
    /// [`Event::VaultOpened`]: crate::Event::VaultOpened
    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError>;

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
    /// gemello di [`read_document`](VaultRead::read_document), che ne dà la
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
    /// nome dentro; è la stessa risposta di
    /// [`read_document`](VaultRead::read_document), e per la stessa ragione —
    /// non è una domanda malformata, è una domanda su qualcosa che non c'è.
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

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Sta qui accanto a [`list_documents`](VaultRead::list_documents) e non
    /// dentro [`IndexQuery`] perché il cestino **non è indicizzato**: una nota
    /// cestinata non ha modello, né tag, né archi nel grafo — è esattamente
    /// ciò che l'indice non contiene. Interrogarlo dal canale dati sarebbe
    /// promettere che il canale dati sappia rispondere su ciò che non ha
    /// letto.
    ///
    /// È una **lettura** e sta fra le letture: un pannello "cestino" è una
    /// view, e una view disegna dal percorso di render.
    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError>;
}

/// Scrivere il **testo** di un documento che già esiste — o che si sta creando
/// riscrivendolo per intero.
///
/// Due capacità sole, e sono la famiglia più piccola perché è quella su cui si
/// dice di no più spesso: è ciò che una simulazione non fa, ciò che un comando
/// dichiarato innocuo non può fare, ciò che un plugin senza
/// [`permission::WRITE_VAULT`](crate::options::permission::WRITE_VAULT) non
/// ottiene.
pub trait VaultWrite: VaultRead {
    /// Scrive la sorgente di un documento nel vault.
    ///
    /// È la scrittura di chi il documento intero ce l'ha in mano: l'editor che
    /// salva il proprio buffer, un importer che crea una nota. Chi vuole
    /// cambiarne **un pezzo** usa [`apply_edit`](VaultWrite::apply_edit) — non
    /// per eleganza, ma perché una riscrittura totale non dice cosa è cambiato
    /// e non si accorge di chi ha scritto nel frattempo.
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;

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
}

/// Le operazioni **strutturali** sul vault: creare, rinominare, cestinare,
/// ripristinare, distruggere.
///
/// Creare, rinominare, cestinare sono le tre cose che si fanno a un documento
/// *senza aprirlo*. Fino alla decisione 0013 erano kernel-owned e fuori dal
/// contratto, e la conseguenza era che template, daily note, import,
/// auto-archiviazione e cleanup wizard (FEATURES 16, 17, 8.3, 7.2) non potevano
/// essere un plugin: il vault sapeva farle, il confine no.
///
/// Stanno sotto
/// [`permission::WRITE_VAULT`](crate::options::permission::WRITE_VAULT) come
/// [`VaultWrite`], e sono una famiglia a parte perché il no è di **specie
/// diversa**: chi scrive testo cambia una nota che l'utente ha già, chi cestina
/// gliela toglie. Un host può voler concedere il primo e negare il secondo, e
/// finché erano lo stesso trait quella distinzione non era esprimibile.
pub trait VaultStructure: VaultRead {
    /// Crea un documento **nuovo** con il sorgente dato, e fallisce se quel
    /// path è già occupato.
    ///
    /// È questo rifiuto a distinguerla da [`write_document`](VaultWrite::write_document),
    /// che crea ciò che non c'è e sovrascrive ciò che c'è: un plugin di
    /// template che scrivesse la nota di oggi con `write_document` e sbagliasse
    /// la data **cancellerebbe** una nota dell'utente, senza che niente nel
    /// codice sembri una cancellazione. Chi vuole un nome comunque libero lo
    /// chiede a [`free_name`](VaultRead::free_name) e passa quello: due capacità
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
    /// [`list_documents`](VaultRead::list_documents)) ma non è distrutto, e l'id
    /// restituito è quello con cui si ripristina. L'unica capacità che
    /// distrugge è [`empty_trash`](VaultStructure::empty_trash), e si chiama così.
    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError>;

    /// Riporta nel vault una voce del cestino (`entry` è il suo
    /// [`TrashEntry::id`]) e restituisce il [`DocId`] con cui è tornata: il suo
    /// path d'origine, oppure `to` se il chiamante ne sceglie un altro.
    ///
    /// Il ripristino è una scrittura normale — parse, grafo, indici, eventi —
    /// e quindi è a sua volta annullabile. Se il path d'origine è di nuovo
    /// occupato e `to` non è stato dato, è un errore e non un nome scelto
    /// d'ufficio: chi chiama ha [`free_name`](VaultRead::free_name) e decide.
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
}

// --- storage persistente per-plugin -----------------------------------------
//
// Blob nominati con path relativi dentro uno spazio che l'host assegna e
// impone (`.fubmd-data/plugins/<id>/`): il plugin non conosce la radice del
// vault, non compone path assoluti e non può uscire dal proprio recinto.
// È l'alternativa a un'API filesystem scoped, ed è stata scelta perché il
// recinto qui è una proprietà della firma, non una convenzione da
// rispettare — vedi docs/architecture/plugin-boundary.md.
//
// Sono **due** famiglie e non una, per la stessa ragione per cui lo sono la
// lettura e la scrittura del vault: il percorso di render può rileggere ciò che
// il provider si è salvato (un pannello che ricorda la sezione aperta) e non
// deve poter scrivere mentre disegna.

/// Rileggere i propri blob persistenti.
pub trait DataRead: Send + Sync {
    /// Legge un blob. Assente → `Ok(None)` (mancare non è un errore).
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError>;
    /// I blob sotto un prefisso, path relativi allo spazio del plugin e
    /// ordinati. Prefisso inesistente → lista vuota.
    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError>;
}

/// Scrivere e cancellare i propri blob persistenti.
pub trait DataWrite: DataRead {
    /// Scrive un blob, creando le directory intermedie.
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError>;
    /// Cancella un blob. Idempotente: cancellare ciò che non c'è riesce.
    fn data_remove(&mut self, path: &str) -> Result<(), PluginError>;
}

/// Ciò che **l'host sa e il provider no**: che ore sono, e cosa sta guardando
/// l'utente.
///
/// Le due capacità sembrano lontane e sono la stessa specie di cosa — un fatto
/// dell'host che chi gira dentro il confine non può calcolarsi — e si negano
/// insieme: un componente sotto sandbox può non avere orologio (WASI lo può
/// negare) e può non avere titolo a sapere quale nota è aperta. Averle in una
/// famiglia sola è ciò che permette di dirlo in un posto solo.
pub trait HostEnv: Send + Sync {
    /// Millisecondi dall'epoca UNIX, secondo l'host.
    ///
    /// Il tempo è una capacità come le altre: un componente WASM può non avere
    /// orologio (WASI lo può negare), e un host che lo fornisce può renderlo
    /// deterministico nei test. Un plugin che chiamasse `SystemTime::now` per
    /// conto proprio sarebbe non testabile e, sotto sandbox, non funzionante.
    fn now_unix_millis(&self) -> u64;

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
}

/// Farsi sentire: emettere un evento, chiedere lavoro lungo.
///
/// Le due sono una famiglia perché si negano insieme e per la stessa ragione:
/// sono **effetti che una simulazione non può ritirare**. Un `DocumentChanged`
/// finto fa ricaricare l'editor su una modifica che non è avvenuta; un job
/// gira fuori dal giro sincrono e rientra come evento quando la simulazione è
/// finita da un pezzo.
pub trait HostEvents: Send + Sync {
    /// Emette un evento sull'event bus.
    ///
    /// È l'unica capacità del contratto **senza esito**, e ne segue una cosa
    /// che va detta: un host che non la concede non ha modo di rifiutare, può
    /// solo non emettere. Il silenzio è il no.
    fn emit(&mut self, event: Event);
    /// Chiede l'esecuzione in background di un job ([`Plugin::run_job`]).
    /// Ritorna subito con l'identità del job; l'esito arriverà come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono normale.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;
}

/// Il canale dati: interrogare l'indice.
///
/// Una famiglia con una capacità sola, e non è uno spreco: è la sola lettura
/// che non riguarda **un** documento ma ciò che è derivato dall'intero vault, e
/// un host può volerla negare a chi ha `read_vault` ristretto a una cartella —
/// una query aggregata non ha un path da confrontare con una allowlist.
pub trait HostQuery: Send + Sync {
    /// Interroga il vault: backlink, grafo, struttura, tag, proprietà, salute e
    /// ricerca full-text passano tutti di qui, con la stessa semantica di
    /// dispatch del kernel (ciò di cui il kernel è già l'unica fonte di verità
    /// lo serve lui, il resto i provider registrati; vedi [`IndexQuery`]).
    ///
    /// È `&self` — una query non muta niente — ed è la ragione per cui un indice
    /// può servirla sotto prestito condiviso del workspace, come una view.
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}

/// **Chiamare un altro plugin** e ricevere una risposta (§7.5).
///
/// Era il canale che non c'era. Gli unici modi in cui due provider si potevano
/// parlare erano [`Event::Custom`](crate::Event::Custom) — fire-and-forget,
/// senza risposta — e [`IndexQuery::Custom`], che ha un destinatario dichiarato
/// (decisione 0019) ma resta *una domanda all'indice*. Una **chiamata** non
/// c'era: A non poteva chiedere qualcosa a B e ricevere un risultato.
///
/// Il capitolo 21 lo dà per scontato a ogni riga — FubCharts che disegna dati
/// di FubDB, FubForms che scrive in FubDB, FubCalendar che legge da FubTasks —
/// e senza questa capacità quei moduli non sarebbero plugin: sarebbero crate
/// linkati che si vedono a compile time, cioè il contrario del §16.3.
///
/// # La terna, e perché va insieme
///
/// Da sola una chiamata non basta: serve sapere **chi offre cosa**
/// ([`PluginManifest::provides`]), **chi ha bisogno di chi**
/// ([`PluginManifest::requires`]) e cosa succede quando ciò che serve non c'è.
/// Le tre cose sono una decisione sola, e la risposta di FubMD alla terza è:
/// **chi dipende da ciò che non c'è non si dichiara affatto**. Non si attiva
/// degradato e non si disattiva dopo: chi lo monta riceve un errore che nomina
/// il requisito mancante, e decide.
pub trait HostServices: Send + Sync {
    /// Chiama un metodo di un servizio offerto da un altro plugin.
    ///
    /// `service` è un `ns` con la regola dei nomi del §7.4 — è l'id del plugin
    /// che lo offre, o un nome dentro di esso. Nessuno lo offre →
    /// [`PluginError::Unserved`], che è distinguibile da «chi lo offre ha
    /// fallito»; ed è la stessa distinzione che la decisione 0019 ha portato
    /// nel canale dati.
    ///
    /// `&mut self` perché una chiamata può **scrivere**: chiedere a FubDB di
    /// registrare una riga è ciò per cui FubForms esiste. Le capacità di chi
    /// esegue restano le **sue** — un servizio non presta i propri permessi a
    /// chi lo chiama, e chi lo chiama non presta i propri a lui.
    ///
    /// Un servizio non può chiamare sé stesso, nemmeno per giro: la catena è
    /// nota all'host e una ricorsione risponde
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) nominando il giro.
    /// È la stessa regola di [`HostCommands::run_command`], per la stessa
    /// ragione.
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError>;
}

/// Chi **offre** un servizio agli altri plugin (§7.5).
///
/// Quali `ns` serva non lo dice questo trait: lo dice il
/// [`PluginManifest::provides`] di chi lo registra. È deliberato — «cosa offro»
/// è una dichiarazione del plugin, che l'host legge *prima* di montarlo e usa
/// per risolvere le dipendenze di chi arriva dopo; se stesse in un metodo del
/// provider, per saperlo bisognerebbe averlo già montato.
pub trait ServiceProvider: Send + Sync {
    /// Esegue un metodo. `service` è uno dei `ns` dichiarati nel manifest — un
    /// provider può offrirne più d'uno — e `method` un nome che il servizio
    /// documenta.
    ///
    /// Un `method` ignoto è [`PluginError::BadArgs`]: la domanda è arrivata a
    /// chi la doveva ricevere, ed è malposta. `Unserved` significa un'altra
    /// cosa — che nessuno serve quel `ns` — e lo risponde l'host, non questo
    /// trait.
    fn call(
        &self,
        service: &str,
        method: &str,
        args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError>;
}

/// Invocare i comandi del registro: la capacità che rende componibili macro e
/// automazioni.
///
/// È una famiglia sua perché è l'unica che **moltiplica**: chi la ottiene può
/// fare tutto ciò che sanno fare i comandi registrati, e un permesso che si
/// concede senza saperlo sarebbe la scala privilegiata verso ogni altra
/// capacità. Il §7.3 la nomina per questo.
pub trait HostCommands: Send + Sync {
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
// Le due somme: cosa si può fare **senza cambiare niente**, e tutto
// ---------------------------------------------------------------------------

/// Tutto ciò che si può fare **senza cambiare niente**.
///
/// È il tipo del percorso di lettura: `render_view` (che gira sotto prestito
/// condiviso del workspace) e `export` (che per contratto non scrive nel vault)
/// lo ricevono, e la loro firma dice adesso ciò che prima diceva una riga di
/// prosa. Prima ricevevano l'`HostApi` intero e l'host che glielo prestava
/// implementava dodici capacità di scrittura come altrettanti `unreachable!()`:
/// il divieto era vero, e non era un tipo.
///
/// Non si implementa: c'è una impl generica per chiunque abbia le quattro
/// famiglie di lettura.
pub trait ReadApi: VaultRead + DataRead + HostQuery + HostEnv {}

impl<T: VaultRead + DataRead + HostQuery + HostEnv + ?Sized> ReadApi for T {}

/// Le capacità che il kernel concede a un provider/plugin: la **somma** delle
/// dieci famiglie.
///
/// È l'**unico** varco col mondo: ciò che non passa di qui, un plugin WASM non
/// lo potrà fare. Per questo la superficie va chiusa *prima* del freeze di M4 —
/// il dogfooding del versioning ha trovato il buco: un `EventHandler` scritto
/// come lo scriverebbe un plugin non aveva modo di tenere uno store di snapshot
/// su disco né di sapere che ore sono. La decisione 0013 ha chiuso l'elenco: dopo il
/// freeze un metodo **aggiunto** a una famiglia è una minor, uno **tolto** è una
/// major.
///
/// Non si implementa e non si dichiara: chi ha le dieci famiglie ce l'ha, per
/// la impl generica qui sotto. Chi lo **riceve** continua a scrivere
/// `&mut dyn HostApi` come prima — è il tipo di chi può fare tutto, e a quello
/// non è cambiato niente.
///
/// # Visibilità durante i callback (contratto)
///
/// Durante un callback **in scrittura** (`handle`, `on_action`, `flush`,
/// `activate`) un provider **non vede sé stesso né i fratelli in corso di
/// chiamata**: l'host li estrae dal workspace per la durata del giro, quindi
/// una [`query_index`](HostQuery::query_index) fatta da lì dentro può trovare
/// meno provider di quanti ne esistano — al limite nessuno. Non è un
/// malfunzionamento: un callback in scrittura risponde da ciò che ha già in
/// mano, non interrogando il mondo che lo sta chiamando. Il percorso di
/// **lettura** (`render_view`) invece gira sotto prestito condiviso e vede il
/// mondo intero, indici compresi.
pub trait HostApi:
    ReadApi + VaultWrite + VaultStructure + DataWrite + HostEvents + HostCommands + HostServices
{
}

impl<T> HostApi for T where
    T: ReadApi
        + VaultWrite
        + VaultStructure
        + DataWrite
        + HostEvents
        + HostCommands
        + HostServices
        + ?Sized
{
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
    /// ([`HostEnv::active_context`]) al cui cambio questa view invecchia.
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
/// si aspettano a vicenda, e dalla
/// [decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)
/// il render gira davvero in parallelo: era la firma a permetterlo. Il kernel estrae il provider dal workspace per la
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
    ///
    /// L'host è un [`ReadApi`] e non un [`HostApi`]: disegnare è leggere, e
    /// dal §7.1 quella frase è un tipo invece che un commento. Chi disegna non
    /// ha davanti le capacità di scrittura — non le può chiamare, non le deve
    /// rifiutare, e l'host che gliele prestava non deve più implementarne
    /// dodici come altrettanti `unreachable!()`.
    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
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
// Chi serve cosa **si dichiara** ([`QueryRoute`]), e chi risponde è un
// [`IndexProvider`] — anche quando è il kernel. Ciò di cui il kernel è già
// l'unica fonte di verità (grafo, metadati parsati, frontmatter) lo serve il
// suo indice interno, che è registrato per primo e non è privilegiato: si
// dichiara come gli altri, e chi vuole sostituirlo lo chiede per nome. Prima
// erano sette varianti su nove a cui il kernel rispondeva con un `return`
// anticipato, e a cui nessun provider registrato arrivava mai: il canale era
// "dati verso le view" per chiunque, ma "dati **da** chiunque" per due varianti
// su nove.
//
// Che il grafo non si duplichi dentro un altro indice resta vero, e adesso ha
// dove essere detto: chi lo volesse servire dichiarerebbe la stessa rotta, e la
// registrazione lo direbbe invece di lasciar vincere l'ordine di montaggio.
//
// # Dove finisce questo canale, e comincia una lettura
//
// Qui sta ciò che è **derivato**: aggregato sul vault (i tag, le faccette, la
// salute), oppure calcolato su una relazione che nessun documento contiene da
// solo (i backlink, i vicini). Il documento **in sé** — la sua sorgente, la sua
// struttura, di che formato è — non passa di qui ma dall'[`HostApi`]
// (`read_document`, `read_model`, `format_of`), e la ragione è
// duplice. La prima: una variante che il kernel servisse **sempre** da sé
// sarebbe una rotta che nessun altro può dichiarare, cioè il difetto che il
// routing (decisione 0019) è servito a togliere — allora era la regola, e
// riportarcelo dentro per un documento singolo sarebbe ricominciare. La
// seconda: `IndexResult` è l'enum su cui ogni indice fa `match`, e infilarci un
// `DocumentModel` intero vorrebbe dire farlo attraversare la firma di chi non
// lo ha chiesto.
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

/// Una condizione su una proprietà: la foglia
/// [`QueryPredicate::Property`](crate::query::QueryPredicate::Property).
///
/// L'OR e la negazione non stanno qui e non ci sono mai stati: li porta il
/// linguaggio che sta intorno ([`crate::query`]), che è il posto dove valgono
/// per **ogni** foglia e non solo per il frontmatter.
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

/// Quali proprietà del frontmatter portarsi dietro in una risposta.
///
/// Era un `Vec<String>` con la convenzione «vuoto = tutte», e la convenzione si
/// è rotta quando le due domande sono diventate una: un elenco di risultati di
/// ricerca che si trascina l'intero frontmatter di mille note è il default
/// sbagliato, e «tutte» non si può dire con una lista di chiavi che non si
/// conoscono. Sono tre casi, e adesso si nominano.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PropertySelect {
    /// Nessuna: la riga è il documento e basta. È il default, ed è ciò che
    /// vuole chi disegna un elenco di titoli.
    #[default]
    None,
    /// Tutto il frontmatter: l'ispettore delle proprietà, l'esportatore.
    All,
    /// Queste chiavi, in ordine di chiave. Una chiave chiesta e assente non
    /// compare: l'assenza è un fatto, non un valore da inventare.
    Keys { keys: Vec<String> },
}

impl PropertySelect {
    /// Le chiavi nominate, per chi deve decidere se vale la pena guardare il
    /// frontmatter.
    pub fn is_none(&self) -> bool {
        matches!(self, PropertySelect::None)
    }

    pub fn keys(names: &[&str]) -> Self {
        PropertySelect::Keys {
            keys: names.iter().map(|k| k.to_string()).collect(),
        }
    }
}

/// Una proprietà con il suo valore normalizzato ([`PropertyValue`], decisione 0003).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyEntry {
    pub key: String,
    pub value: PropertyValue,
}

/// Un documento che ha combaciato, con ciò che la query gli ha attaccato
/// addosso: la riga di una collezione (8.4), di un database su file (11) o di
/// un elenco di risultati di ricerca.
///
/// **È un tipo solo dove prima erano due** (`SearchHit` e `DocumentProperties`),
/// ed è la conseguenza visibile del linguaggio: finché «cerca» e «filtra» erano
/// due varianti, i loro risultati erano due tipi e il join fra i due era
/// inesprimibile — le note `tipo: progetto` che parlano di rust dovevano essere
/// due domande e un'intersezione fatta a mano da chi disegna. Adesso sono una
/// domanda sola, e la sua riga porta ciò che ha da portare: la rilevanza e
/// l'estratto se un ramo di testo ha contribuito, le proprietà se sono state
/// chieste.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentMatch {
    pub doc: DocId,
    /// Rilevanza, quando a selezionare è stato (anche) un
    /// [`QueryPredicate::Text`](crate::query::QueryPredicate::Text). Assente per
    /// una selezione che non ha niente da ordinare per pertinenza: `tipo:
    /// progetto` non è più o meno vero su una nota che su un'altra.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    /// L'estratto attorno al match, **testo semplice** e mai markup: chi disegna
    /// lo inserisce come testo (nessun varco di injection da un provider di
    /// terzi — stessa regola di [`UiNode`](crate::ui::UiNode)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// Porzioni di `snippet` che hanno prodotto il match, in ordine e non
    /// sovrapposte. Intervalli in **byte dentro `snippet`**, che chi disegna
    /// avvolge con i propri elementi.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub highlights: Vec<Span>,
    /// In ordine di chiave. Quali chiavi ci sono lo decide `select` nella
    /// query; vuoto là = niente, non "tutto il frontmatter" — un elenco di
    /// risultati non deve trascinarsi dietro il frontmatter di mille note per
    /// mostrarne il titolo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<PropertyEntry>,
}

impl DocumentMatch {
    /// Un documento selezionato e basta: nessuna rilevanza, nessun estratto.
    pub fn of(doc: DocId) -> Self {
        DocumentMatch {
            doc,
            score: None,
            snippet: None,
            highlights: Vec::new(),
            properties: Vec::new(),
        }
    }

    pub fn with_score(mut self, score: f32) -> Self {
        self.score = Some(score);
        self
    }

    /// Fonde ciò che un altro ramo sa dello stesso documento.
    ///
    /// La rilevanza che resta è la **maggiore**, e la scelta è deliberata: il
    /// kernel non è un motore di ranking, e sommare le rilevanze di due rami
    /// vorrebbe dire inventare uno scoring che nessuno ha misurato. Comporle
    /// davvero è mestiere di chi indicizza, e ci arriva quando l'intera clausola
    /// gli viene consegnata (il pushdown del pianificatore). L'estratto è il
    /// primo che c'è: due estratti dello stesso documento sono due finestre
    /// sullo stesso testo, e mostrarne due sarebbe rumore.
    pub fn absorb(&mut self, other: DocumentMatch) {
        self.score = match (self.score, other.score) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        if self.snippet.is_none() {
            self.snippet = other.snippet;
            self.highlights = other.highlights;
        }
        for entry in other.properties {
            if !self.properties.iter().any(|e| e.key == entry.key) {
                self.properties.push(entry);
            }
        }
        self.properties.sort_by(|a, b| a.key.cmp(&b.key));
    }
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
///
/// Ogni variante che seleziona documenti lo fa con lo stesso linguaggio
/// ([`QueryExpr`]), e ogni variante arriva a **qualcuno**: chi la serve è
/// dichiarato alla registrazione ([`QueryRoute`]), non scoperto provando in
/// ordine finché uno non dice di no.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IndexQuery {
    /// **I documenti che combaciano.** È la variante che ha sostituito
    /// `full_text` e `properties`: erano due modi di chiedere la stessa cosa —
    /// quali note — in due lingue che non si potevano comporre.
    ///
    /// Copre 9.1 (ricerca per campo), 8.4 (collezioni), 11 (database su file),
    /// 16 (template con query) e la ricerca vera e propria, e le mette **in
    /// congiunzione fra loro**: `matching` è un'espressione, non un filtro.
    Documents {
        #[serde(default)]
        matching: QueryExpr,
        /// Assente = per rilevanza se c'è (l'ordine di chi ha cercato),
        /// altrimenti per `DocId`.
        #[serde(default)]
        sort: Option<PropertySort>,
        /// Quali proprietà del frontmatter portarsi dietro: esiste per non far
        /// viaggiare l'intero frontmatter di mille note quando ne servono due
        /// colonne.
        #[serde(default)]
        select: PropertySelect,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I riferimenti entranti verso un documento, col loro contesto.
    ///
    /// Resta una variante sua e non una `Documents` con
    /// [`QueryPredicate::Linked`](crate::query::QueryPredicate::Linked) perché
    /// la risposta è **diversa**: porta il frammento di testo in cui il link
    /// compare, che è ciò che un pannello backlink mostra. La forma senza
    /// contesto — «le note che nominano questa, in AND con altro» — è la foglia.
    Backlinks {
        target: DocId,
        #[serde(default)]
        page: Option<Page>,
    },
    /// La struttura (heading) di un documento: il modo con cui una view legge la
    /// struttura parsata senza avere un `FormatProvider` (che, essendo un
    /// plugin, non ha). Documento inesistente → outline vuota, non un errore.
    ///
    /// È l'unica risposta non paginata dell'enum, e per una ragione: cresce con
    /// **un** documento, non col vault, e chi la chiede ha già in mano quel
    /// documento intero.
    Outline { doc: DocId },
    /// I tag con la loro frequenza, in ordine di chiave canonica. Chi vuole i
    /// più usati ordina lui: l'ordine stabile è quello che rende paginabile la
    /// risposta.
    ///
    /// `matching` restringe **su quali documenti** si conta: vuoto = tutto il
    /// vault (il pannello dei tag, l'autocompletamento), altrimenti sono le
    /// **faccette** di un risultato — «quali tag hanno le note che parlano di
    /// rust» — che la decisione 0005 aveva dichiarato fuori portata perché
    /// avrebbero voluto un campo facet nel motore. Con un linguaggio non lo
    /// vogliono: il sottoinsieme è una query, e i tag li conta chi li ha in
    /// cache.
    Tags {
        #[serde(default)]
        matching: QueryExpr,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I vicini nel grafo dei link, fino a `depth` passi.
    ///
    /// È il grafo (7.3) che entra nel contratto: finché usciva solo da un
    /// comando dell'app, una vista a grafo di terzi era impossibile e quella
    /// ufficiale restava superficie privilegiata.
    ///
    /// I **semi** sono un'espressione e non un documento solo, ed è ciò che
    /// rende esprimibile il grafo intero in una domanda sola (`seeds` vuota =
    /// tutto il vault, `depth: 1`, uscenti: sono esattamente gli archi) invece
    /// che in una domanda per nota — che sull'IPC vorrebbe dire mille viaggi
    /// per disegnare un grafo, cioè un comando bespoke.
    Neighbors {
        #[serde(default)]
        seeds: QueryExpr,
        #[serde(default)]
        direction: LinkDirection,
        /// Passi di distanza, almeno 1 (`0` → risposta vuota).
        depth: u8,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I valori distinti di una proprietà con quante note li portano: le
    /// **faccette** di 9.1. Un elenco contribuisce con ogni suo elemento (una
    /// nota con `autore: [a, b]` conta per `a` e per `b`), che è ciò che una
    /// faccetta deve fare.
    PropertyValues {
        key: String,
        /// Su quale sottoinsieme contare: le faccette si contano **sui documenti
        /// già selezionati**, o la navigazione per faccette non converge mai.
        #[serde(default)]
        matching: QueryExpr,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Un controllo di salute del vault (7.2), dal grafo e dai modelli in
    /// memoria.
    VaultHealth {
        check: HealthCheck,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Varco di estensione: query definite da un provider di terzi, con
    /// namespace (`ns` = plugin id). Chi non ha dichiarato quel `ns` non la
    /// riceve mai, e se non l'ha dichiarato nessuno il chiamante riceve
    /// [`PluginError::Unserved`] — non l'errore dell'ultimo interpellato.
    Custom {
        ns: String,
        query: serde_json::Value,
    },
}

impl IndexQuery {
    /// La finestra chiesta, se la variante ne ha una.
    pub fn page(&self) -> Option<Page> {
        match self {
            IndexQuery::Documents { page, .. }
            | IndexQuery::Backlinks { page, .. }
            | IndexQuery::Tags { page, .. }
            | IndexQuery::Neighbors { page, .. }
            | IndexQuery::PropertyValues { page, .. }
            | IndexQuery::VaultHealth { page, .. } => *page,
            IndexQuery::Outline { .. } | IndexQuery::Custom { .. } => None,
        }
    }

    /// L'espressione che la variante porta, se ne porta una: è ciò che il
    /// pianificatore deve risolvere **prima** di consegnare la query a chi la
    /// serve.
    pub fn expression(&self) -> Option<&QueryExpr> {
        match self {
            IndexQuery::Documents { matching, .. }
            | IndexQuery::Tags { matching, .. }
            | IndexQuery::PropertyValues { matching, .. } => Some(matching),
            IndexQuery::Neighbors { seeds, .. } => Some(seeds),
            IndexQuery::Backlinks { .. }
            | IndexQuery::Outline { .. }
            | IndexQuery::VaultHealth { .. }
            | IndexQuery::Custom { .. } => None,
        }
    }

    /// Rimpiazza l'espressione con una già risolta (`Docs { … }`), lasciando
    /// tutto il resto com'era.
    pub fn with_expression(self, resolved: QueryExpr) -> IndexQuery {
        match self {
            IndexQuery::Documents {
                sort, select, page, ..
            } => IndexQuery::Documents {
                matching: resolved,
                sort,
                select,
                page,
            },
            IndexQuery::Tags { page, .. } => IndexQuery::Tags {
                matching: resolved,
                page,
            },
            IndexQuery::PropertyValues { key, page, .. } => IndexQuery::PropertyValues {
                key,
                matching: resolved,
                page,
            },
            IndexQuery::Neighbors {
                direction,
                depth,
                page,
                ..
            } => IndexQuery::Neighbors {
                seeds: resolved,
                direction,
                depth,
                page,
            },
            other => other,
        }
    }

    /// La famiglia di questa query: ciò che si dichiara di servire.
    pub fn kind(&self) -> QueryKind {
        match self {
            IndexQuery::Documents { .. } => QueryKind::Documents,
            IndexQuery::Backlinks { .. } => QueryKind::Backlinks,
            IndexQuery::Outline { .. } => QueryKind::Outline,
            IndexQuery::Tags { .. } => QueryKind::Tags,
            IndexQuery::Neighbors { .. } => QueryKind::Neighbors,
            IndexQuery::PropertyValues { .. } => QueryKind::PropertyValues,
            IndexQuery::VaultHealth { .. } => QueryKind::VaultHealth,
            IndexQuery::Custom { ns, .. } => QueryKind::Custom(ns.clone()),
        }
    }
}

/// La famiglia di una [`IndexQuery`]: ciò che un indice dichiara di **servire**.
///
/// Non è il `kind` della serializzazione con un nome diverso: `Custom` porta il
/// namespace, perché due plugin che estendono il canale non si contendono la
/// stessa casella.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum QueryKind {
    Documents,
    Backlinks,
    Outline,
    Tags,
    Neighbors,
    PropertyValues,
    VaultHealth,
    Custom(String),
}

/// La specie di una [`QueryPredicate`]: ciò che un indice dichiara di saper
/// **valutare**.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PredicateKind {
    Text,
    Property,
    Tag,
    Folder,
    Linked,
    Custom(String),
}

impl PredicateKind {
    pub fn of(predicate: &QueryPredicate) -> Option<PredicateKind> {
        match predicate {
            QueryPredicate::Text(_) => Some(PredicateKind::Text),
            QueryPredicate::Property { .. } => Some(PredicateKind::Property),
            QueryPredicate::Tag { .. } => Some(PredicateKind::Tag),
            QueryPredicate::Folder { .. } => Some(PredicateKind::Folder),
            QueryPredicate::Linked { .. } => Some(PredicateKind::Linked),
            QueryPredicate::Custom { ns, .. } => Some(PredicateKind::Custom(ns.clone())),
            // `Docs` non ha proprietario: è già la risposta, e chiunque riceva
            // un'espressione deve saperla leggere (è la forma in cui il
            // pianificatore consegna ciò che ha risolto per conto suo).
            QueryPredicate::Docs { .. } => None,
        }
    }
}

/// Cosa un [`IndexProvider`] dichiara di servire, **alla registrazione**.
///
/// Prima non si dichiarava niente: il kernel provava gli indici in ordine finché
/// uno non rispondeva `BadArgs`, e di `BadArgs` arrivava al chiamante quello
/// dell'**ultimo** interpellato mentre ogni altro errore tornava dal **primo**
/// che lo dava — da fuori i due casi non si distinguevano. Con un indice
/// funzionava benissimo; con quelli che FEATURES chiede (full-text, semantico e
/// vettoriale, proprietà, task, database, citazioni) ogni query gira su tutti, e
/// due indici che rivendicano la stessa cosa si oscurano a vicenda **in
/// silenzio**.
///
/// # Le due specie, e perché una sola ha un padrone
///
/// - Una **variante** ([`Query`](QueryRoute::Query)) ha un proprietario solo. Lì
///   la risposta si **compone** — il conteggio dei tag, l'elenco dei backlink,
///   il verdetto di un controllo di salute — e due autori per la stessa risposta
///   vuol dire che vince chi si è registrato prima, cioè un dettaglio di
///   montaggio. Registrare una variante già rivendicata è un conflitto, con la
///   stessa disciplina del `FormatRegistry` (decisione 0017): si rifiuta, e chi
///   vuole **sostituire** lo chiede per nome.
/// - Un **predicato** ([`Predicate`](QueryRoute::Predicate)) può averne più
///   d'uno, e non è una tolleranza: un predicato è un *fatto sul vault*, e `#rust`
///   seleziona le stesse note per chiunque le conti. Chi indicizza il testo
///   conosce anche cartelle e tag — li ha indicizzati per poter filtrare senza
///   uscire dal motore — e dichiararlo è ciò che permette al pianificatore di
///   consegnargli l'intera clausola invece di ricomporla a mano. Chi rivendica
///   una foglia promette la **stessa** risposta degli altri; a chi sia andata
///   davvero risponde il piano, che è visibile.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "route", rename_all = "snake_case")]
pub enum QueryRoute {
    /// «Rispondo io a questa famiglia di domande.»
    Query(QueryKind),
    /// «So valutare questa foglia.»
    Predicate(PredicateKind),
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

/// La risposta a una [`IndexQuery`].
///
/// Tag **adiacente** (`kind` + `value`) e non interno, e non è una scelta di
/// gusto: `Outline` porta una lista e `Custom` può portare uno scalare, e un
/// `variant` con tag interno e payload che non è una mappa **non si
/// serializza** — `serde_json` fallisce a runtime, non in compilazione. Era
/// latente finché nessuno metteva un `IndexResult` sul filo; il canale dati
/// generico sull'IPC (§5.4) ce lo mette a ogni ricerca. È lo stesso difetto che
/// la decisione 0005 aveva trovato su `PropertyValue`, `LinkTarget` e `Inline`,
/// nello stesso modo: mettendoli in un test che li serializza tutti.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum IndexResult {
    /// I documenti che combaciano (risposta a [`IndexQuery::Documents`]).
    Documents(Paged<DocumentMatch>),
    Backlinks(Paged<BacklinkRef>),
    /// Gli heading di un documento, in ordine di apparizione (risposta a
    /// [`IndexQuery::Outline`]). L'unica risposta senza finestra: cresce con un
    /// documento, non col vault.
    Outline(Vec<Heading>),
    /// I tag con la loro frequenza (risposta a [`IndexQuery::Tags`]).
    Tags(Paged<TagCount>),
    /// I vicini nel grafo (risposta a [`IndexQuery::Neighbors`]), per distanza
    /// crescente e poi per `DocId`.
    Neighbors(Paged<NeighborRef>),
    /// Le faccette di una proprietà (risposta a [`IndexQuery::PropertyValues`]).
    PropertyValues(Paged<PropertyCount>),
    /// I problemi trovati (risposta a [`IndexQuery::VaultHealth`]).
    VaultHealth(Paged<HealthIssue>),
    /// Risposta a una [`IndexQuery::Custom`].
    Custom(serde_json::Value),
}

impl IndexResult {
    /// I documenti di una risposta a [`IndexQuery::Documents`], o l'errore che
    /// dice cosa è arrivato invece.
    ///
    /// Esiste perché il `match` con un ramo «l'indice ha risposto fuori tema»
    /// era scritto in ogni chiamante, ogni volta con un messaggio diverso: è la
    /// forma minima del §16.6 applicata al canale più usato.
    pub fn documents(self) -> Result<Paged<DocumentMatch>, PluginError> {
        match self {
            IndexResult::Documents(docs) => Ok(docs),
            other => Err(PluginError::Internal(format!(
                "risposta fuori tema: attesi dei documenti, arrivato {}",
                other.kind_name()
            ))),
        }
    }

    /// Il nome della variante, per i messaggi d'errore.
    pub fn kind_name(&self) -> &'static str {
        match self {
            IndexResult::Documents(_) => "documents",
            IndexResult::Backlinks(_) => "backlinks",
            IndexResult::Outline(_) => "outline",
            IndexResult::Tags(_) => "tags",
            IndexResult::Neighbors(_) => "neighbors",
            IndexResult::PropertyValues(_) => "property-values",
            IndexResult::VaultHealth(_) => "vault-health",
            IndexResult::Custom(_) => "custom",
        }
    }
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
    /// **Cosa serve**, dichiarato una volta alla registrazione.
    ///
    /// È la metà che mancava: senza, il kernel non poteva fare altro che
    /// interpellare tutti in ordine e dedurre da un errore chi fosse il
    /// destinatario. Con essa il dispatch è una lettura di tabella, un
    /// conflitto si vede **al montaggio** invece che come una risposta
    /// plausibile e sbagliata, e «nessuno serve questa domanda»
    /// ([`PluginError::Unserved`]) è distinguibile da «chi la serve ha
    /// fallito» — che è il §12.2 applicato al canale più usato dopo la lista
    /// documenti.
    ///
    /// Dichiarare una famiglia è impegnativo: chi dichiara
    /// [`QueryKind::Tags`] riceverà **ogni** interrogazione sui tag, e nessun
    /// altro la vedrà. Dichiarare un predicato lo è meno — un predicato è un
    /// fatto, e più d'uno lo può verificare — ma chi lo fa promette la stessa
    /// risposta degli altri. Vedi [`QueryRoute`].
    ///
    /// Un elenco vuoto è legittimo e vuol dire una cosa sola: questo indice
    /// **non risponde a niente**, si limita a stare dietro all'alimentazione.
    /// È il caso di chi accumula per esportare, e non è più un indice muto per
    /// sbaglio — lo è per dichiarazione.
    fn routes(&self) -> Vec<QueryRoute>;

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

    /// Risponde a una query **che è stata dichiarata**.
    ///
    /// Il kernel non manda qui domande che [`routes`](IndexProvider::routes) non
    /// rivendica: non c'è nessun «non è roba mia» da restituire, e il `BadArgs`
    /// che serviva a dirlo è tornato a significare quello che dice — gli
    /// argomenti non stanno in piedi.
    ///
    /// Ciò che arriva è **già risolto**: un'espressione contiene solo foglie che
    /// questo provider ha dichiarato di saper valutare, oppure una
    /// [`QueryPredicate::Docs`](crate::query::QueryPredicate::Docs) in cui il
    /// pianificatore ha messo il risultato di ciò che sapeva valutare qualcun
    /// altro. La **struttura** invece resta da leggere: OR, AND e negazione
    /// hanno un'implementazione sola, ed è
    /// [`QueryEvaluator`](crate::query::QueryEvaluator) — chi non vuole
    /// tradurla nel proprio motore implementa le due foglie e lascia fare a
    /// quella.
    ///
    /// # Due `query` possono essere in volo insieme
    ///
    /// Questo trait è `Send + Sync` e questo metodo prende `&self`: il kernel
    /// serve le interrogazioni sotto **prestito condiviso** del workspace, e N
    /// chiamate concorrenti sulla stessa istanza sono lecite per costruzione.
    ///
    /// Lecite, non necessariamente **parallele**. Un provider che metta un lock
    /// dentro il proprio `&self` è conforme, e si rimette in fila da solo senza
    /// che nessuno se ne accorga: il `RwLock` del workspace non attraversa il
    /// lock di un provider. Il contratto non chiede di dichiararlo, e non è una
    /// dimenticanza — è la [decisione
    /// 0026](../../../docs/decisions/0026-due-query-insieme.md): una
    /// dichiarazione non potrebbe cambiare ciò che è *lecito* (lo dice già
    /// `Send + Sync`), quindi sarebbe un fatto che nessun chiamante può
    /// verificare e su cui nessuno può agire, e sbagliarla non produrrebbe un
    /// errore ma solo un'attesa.
    ///
    /// Resta quindi un **requisito in prosa**, e vale per chi scrive un indice:
    /// serializzare è permesso e sconsigliato, e chi vuole sapere se il proprio
    /// indice scala lo **misura**. Il primo indice nativo lo fa
    /// (`fubmd_features::SearchIndex`, presidio
    /// `due_ricerche_stanno_nell_indice_insieme`), e lo fa perché per un anno
    /// non lo faceva senza che si vedesse.
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

    /// I permessi che una **feature ufficiale** dichiara: leggere e scrivere il
    /// vault, invocare i comandi del registro, chiamare i servizi degli altri.
    ///
    /// Non è "tutti i permessi", ed è deliberato che non lo sia: la rete, gli
    /// appunti, la camera e il filesystem esterno non li ha nessuna delle
    /// feature di questo repo, e concederli in blocco a chi è di casa
    /// renderebbe il punto di applicazione del §7.3 vero solo per i plugin di
    /// terzi — cioè una regola che non si prova mai dove la si scrive.
    pub fn core() -> Self {
        PluginPermissions::of(&[
            crate::options::permission::READ_VAULT,
            crate::options::permission::WRITE_VAULT,
            crate::options::permission::RUN_COMMAND,
            crate::options::permission::CALL_SERVICE,
        ])
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
    /// I **servizi che offre** (§7.5): i `ns` con cui altri plugin lo chiamano
    /// via [`HostServices::call_service`].
    ///
    /// Sta nel manifest e non in un metodo del provider perché l'host deve
    /// poterlo leggere **prima** di montarlo: è ciò con cui risolve le
    /// dipendenze di chi arriva dopo. Ogni nome vale la regola del §7.4 — o è
    /// l'id del plugin, o è dentro di esso.
    #[serde(default)]
    pub provides: Vec<String>,
    /// I servizi di cui **ha bisogno**. Un requisito che nessuno offre non è un
    /// avvertimento: il plugin non si dichiara affatto, e chi lo monta legge
    /// quale requisito manca.
    ///
    /// È la semantica dichiarata della terna del §7.5, ed è quella che non
    /// lascia in piedi uno stato intermedio: un plugin «attivo ma degradato»
    /// è uno stato che nessuno prova e che ogni feature deve poi gestire.
    #[serde(default)]
    pub requires: Vec<String>,
}

impl PluginManifest {
    /// Un manifest **senza permessi**: id, nome, e la versione di ABI con cui è
    /// compilato.
    ///
    /// Il default è nessun permesso, e non è pigrizia: un plugin che non
    /// dichiara niente non deve poter fare niente, o dichiarare smetterebbe di
    /// essere ciò che apre le porte. I permessi si aggiungono con
    /// [`granting`](PluginManifest::granting).
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        PluginManifest {
            id: id.into(),
            name: name.into(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            abi_version: ABI_VERSION.to_string(),
            permissions: PluginPermissions::default(),
            provides: Vec::new(),
            requires: Vec::new(),
        }
    }

    /// I servizi che questo plugin offre (§7.5).
    pub fn providing(mut self, services: &[&str]) -> Self {
        self.provides = services.iter().map(|s| s.to_string()).collect();
        self
    }

    /// I servizi di cui questo plugin ha bisogno per essere montato.
    pub fn requiring(mut self, services: &[&str]) -> Self {
        self.requires = services.iter().map(|s| s.to_string()).collect();
        self
    }

    /// I permessi che questo manifest dichiara.
    pub fn granting(mut self, permissions: PluginPermissions) -> Self {
        self.permissions = permissions;
        self
    }

    /// Il manifest di una **feature ufficiale** di questo repo: la versione del
    /// contratto è quella con cui è compilata, i permessi sono quelli di
    /// [`PluginPermissions::core`].
    ///
    /// Esiste perché dal §7.3 il kernel non registra più provider intestati a
    /// una stringa: chi registra si dichiara, e una feature che sta nello
    /// stesso binario deve dichiararsi come si dichiarerà un plugin — con le
    /// stesse informazioni, o il punto di applicazione lo si proverebbe solo
    /// contro chi non esiste ancora.
    pub fn core(id: impl Into<String>, name: impl Into<String>) -> Self {
        PluginManifest::new(id, name).granting(PluginPermissions::core())
    }
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
    /// Corpo di un job richiesto via [`HostEvents::spawn_job`]: eseguito
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
