//! Gli **altri trait di estensione**, definiti una volta sola qui nel contratto.
//! Le feature ufficiali (backlink, ricerca, graph) li implementano in modo
//! nativo; i plugin di terzi (M5) li implementeranno via proxy WASM. Il kernel
//! vede sempre `dyn Trait` e non sa quale backend c'è dietro.
//!
//! Nota M1: la superficie è definita per intero (è il valore del crate-contratto),
//! ma l'app M1 cabla solo ciò che serve — backlink e ricerca passano per
//! `IndexProvider`/il grafo del kernel.

use serde::{Deserialize, Serialize};

use crate::command::{CommandOutcome, CommandSpec, InvokeMode, ParamSpec, Undone};
use crate::edit::{EditReport, EditRequest, Revision, WriteBase};
use crate::error::PluginError;
use crate::event::{Event, EventMask, Notice};
use crate::format::DocumentFormat;
use crate::locale::{Locale, Weekday};
use crate::model::{
    DocId, DocumentModel, Heading, LinkTarget, PropertyScalar, PropertyValue, Span,
};
use crate::organization::Organization;
use crate::query::{QueryExpr, QueryPredicate};
use crate::session::{ContextMask, ViewContext};
use crate::settings::{SettingEntry, SettingSpec, SettingValue};
use crate::text::{Localize, StringCatalog, Text};
use crate::ui::{UiAction, UiNode, ViewUpdate};

// ---------------------------------------------------------------------------
// Job: il varco per il lavoro lungo. Le chiamate dei trait sono sincrone e
// devono restare brevi (a M5 una deadline le tronca); tutto ciò che è lento —
// rete, calcolo pesante, camminare il vault intero — passa da qui e gira FUORI
// dal giro sincrono del kernel. Vedi docs/architecture/plugin-boundary.md,
// "Lavoro lungo: i job".
// ---------------------------------------------------------------------------

/// Richiesta di lavoro in background. `job` è il nome dell'entry point del
/// plugin ([`Plugin::run_job`]); `payload` porta i suoi **argomenti** — quale
/// cartella esportare, quale URL importare — non il suo input.
///
/// Fino alla decisione 0027 portava anche l'input, e non per scelta: dentro al
/// job non c'era `HostApi`, quindi tutto ciò che il job avrebbe letto doveva
/// leggerlo il **chiamante**, nel giro sincrono, e passarglielo qui dentro. Un
/// export del vault intero era un `payload` grande quanto il vault, letto in
/// esclusiva sul workspace: cioè il lavoro lungo fatto esattamente dove il job
/// serviva a non farlo. Adesso il vault il job se lo legge da sé
/// ([`Plugin::run_job`]), e qui restano gli argomenti.
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

/// **A che punto è** un lavoro lungo (§10.3, decisione 0035).
///
/// Un record solo, e lo usano tutti e due i modi di sapere a che punto è un
/// job: l'evento [`Event::JobProgress`](crate::Event::JobProgress) — che lo dice
/// quando cambia — e [`JobStatus`] — che lo dice a chi arriva dopo e chiede.
/// Due definizioni di "progresso" sarebbero due idee di cosa mostrare, e la
/// seconda si accorgerebbe di essere diversa dalla prima solo davanti
/// all'utente.
///
/// Non c'è nessun campo che dica «finito»: un job finisce con
/// [`Event::JobDone`](crate::Event::JobDone), che porta l'esito, ed è l'unica
/// cosa che vuol dire finire. Un `done == total` è una barra piena, non un
/// lavoro concluso.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobProgress {
    /// Quante unità sono state fatte. Cosa sia un'unità lo decide il job: note
    /// esportate, byte scaricati, file letti.
    pub done: u64,
    /// Quante ne saranno in tutto, **se il job lo sa**. Assente = indeterminato,
    /// che è un caso vero (uno scaricamento senza `Content-Length`, una
    /// scansione che non ha ancora finito di contare) e non un dato mancante:
    /// chi disegna mostra un'attesa senza barra invece di una barra che mente.
    pub total: Option<u64>,
    /// Cosa sta facendo adesso, per chi guarda: «esportando `Diario/2026.md`».
    ///
    /// È prosa composta dal job, come [`VaultStatus::last_sync_error`] e come il
    /// messaggio di un [`PluginError`]: quando il §12.1 dirà come si localizza
    /// una stringa al confine, lo dirà anche per questa.
    pub label: Option<String>,
}

/// Un lavoro lungo **vivo**: la risposta a [`IndexQuery::Jobs`] (§10.3).
///
/// «Vivo» va dal momento in cui il job è stato accettato
/// ([`Event::JobStarted`](crate::Event::JobStarted)) a quello in cui ne è
/// tornato l'esito ([`Event::JobDone`](crate::Event::JobDone)): comprende quindi
/// anche i job che aspettano un thread libero, ed è deliberato — un job in coda
/// si annulla come uno in volo (decisione 0032), quindi chi guarda deve poterlo
/// vedere per poterlo fermare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobStatus {
    pub id: JobId,
    /// Il nome dell'entry point (`JobSpec::job`).
    pub job: String,
    /// Chi lo ha chiesto, e con le cui capacità gira.
    pub plugin: String,
    /// Quando è stato accettato, in millisecondi dall'epoca UNIX: è ciò che
    /// permette a chi guarda di dire «da tre minuti» senza tenere un cronometro
    /// per ogni riga.
    pub since: u64,
    /// L'ultimo progresso riferito, se il job ne ha riferito uno. Assente non
    /// vuol dire fermo: vuol dire che quel job non racconta.
    pub progress: Option<JobProgress>,
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
// L'anagrafe: cosa c'è nel vault, e non solo quali note (§14.1, §14.2).
// ---------------------------------------------------------------------------

/// Che specie di file è una voce del vault.
///
/// Tre casi e non due, e il terzo è il punto: prima di questa voce il vault
/// vedeva i documenti e **basta** — un PNG accanto a una nota non esisteva per
/// Fub, né come allegato né come file. Le tre risposte sono tre cose che si
/// fanno diversamente: un documento si parsa, un allegato si mostra o si apre
/// con l'applicazione di sistema, un ignoto si nomina e non si tocca.
///
/// **Non è una proprietà del file**: è una proprietà del file *dato chi è
/// registrato adesso*. La regola sta in
/// [`rules::media::kind_of`](crate::rules::media::kind_of), prende le estensioni
/// dei provider come parametro, e il giorno che qualcuno rivendica `.canvas`
/// quei file diventano `Document` senza essere cambiati di un byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    /// Un `FormatProvider` rivendica la sua estensione: ha un modello, sta
    /// nell'indice, è ciò che
    /// [`list_documents`](VaultRead::list_documents) restituisce.
    Document,
    /// Un allegato: un tipo di contenuto che sappiamo nominare
    /// ([`rules::media::mime_of`](crate::rules::media::mime_of)) e che nessuno
    /// parsa.
    Asset,
    /// Il vault lo vede e nessuno sa cosa sia. Non è un errore ed è metà del
    /// valore dell'anagrafe: un file che nessuno riconosce **esiste** lo stesso
    /// — occupa spazio, si può cancellare per sbaglio, e un backup che lo
    /// saltasse lo perderebbe in silenzio.
    Unknown,
}

/// Una voce del vault: un file, con ciò che si sa di lui **senza aprirlo**.
///
/// È l'anagrafe che mancava (§14.1, §14.2), e le due mancanze erano una sola:
/// il kernel non vedeva ciò che non è un documento, e dei documenti non teneva
/// né la data né la dimensione — quindi «apri in fretta un vault grande»,
/// «trova i duplicati», «note modificate di recente» e «cosa è cambiato da
/// ieri» non avevano una **fonte**, non una implementazione.
///
/// La chiave è il path, come per ogni altra cosa del vault
/// ([decisione 0043](../../../docs/decisions/0043-il-path-e-la-chiave.md)):
/// [`DocId`] nomina *un file del vault*, e non un secondo tipo identico che
/// significhi la stessa cosa per gli allegati.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    /// Il path relativo alla radice del vault, separatori `/`.
    pub id: DocId,
    pub kind: EntryKind,
    /// Byte del file sul disco.
    pub size: u64,
    /// Ultima modifica, in **millisecondi** UNIX.
    ///
    /// Millisecondi e non secondi come [`TrashEntry::deleted_at`], perché qui
    /// il numero non serve a *mostrare* una data ma a **riconoscere una
    /// modifica**: con la granularità del secondo, due scritture della stessa
    /// dimensione nello stesso secondo sono indistinguibili — che è raro per un
    /// umano e normale per uno script. E non nanosecondi, che pure il
    /// filesystem sa dare: questo numero attraversa l'IPC come JSON, e oltre
    /// 2^53 un intero non sopravvive a un `double`.
    pub mtime: u64,
    /// L'identità del **contenuto**, quando qualcuno l'ha già avuto in mano.
    ///
    /// `None` non vuol dire «file vuoto» e non vuol dire «mai letto»: vuol dire
    /// che nessuno ha ancora pagato la lettura dei suoi byte. È la stessa
    /// impronta di [`VaultRead::document_revision`] — l'identità di un
    /// contenuto è una cosa sola, e un secondo tipo opaco accanto a
    /// [`Revision`] sarebbe due nomi per la stessa idea.
    ///
    /// **Quando si calcola**: dove i byte sono già in mano, mai aprendo un file
    /// apposta. Il kernel la calcola sui documenti che deve comunque leggere per
    /// parsarli; per un allegato non la calcola nessuno, perché leggere ogni
    /// byte di ogni PNG all'apertura è esattamente il costo che l'anagrafe
    /// esiste per togliere. Chi la vorrà — dedup (13.1), duplicati (3.2),
    /// integrità (24.2) — la farà calcolare da un job, che è il posto del
    /// lavoro lungo ([decisione 0032](../../../docs/decisions/0032-il-runner-dei-job.md)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<Revision>,
}

/// Una **cartella** del vault (§14.3).
///
/// Esiste perché il disco ce l'ha, non perché il path di un file la nomini: è
/// tutta la differenza fra una cartella e un prefisso. Prima di questa voce le
/// cartelle nascevano dai path delle note e vivevano nel solo albero della
/// shell, quindi una cartella vuota non c'era — e una cartella che restava
/// vuota (cestinata l'ultima nota) spariva da sola, mentre sul disco c'era
/// ancora.
///
/// La chiave è il path senza slash finale, come per
/// [`QueryPredicate::Folder`](crate::query::QueryPredicate::Folder) e come per
/// le chiavi dell'[organizzazione](crate::organization::Organization). **Non**
/// è un [`DocId`], che nomina un *file* («estensione inclusa»): una cartella
/// non si legge, non si scrive e non ha un modello, e chiamarla con lo stesso
/// tipo avrebbe voluto dire che ogni firma che prende un `DocId` accetta anche
/// una cartella senza saperlo. La radice del vault non è una voce: non ha un
/// nome, non si rinomina e non si cancella.
///
/// Nome e cartella genitore **non sono campi**, per la ragione per cui il MIME
/// di un allegato non lo è ([decisione 0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)):
/// sono funzioni pure del path — l'ultimo segmento, e
/// [`folder_of`](crate::query::folder_of) — e copiarle qui vorrebbe dire
/// scriverne una copia per cartella di ogni vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultFolder {
    /// Path relativo alla radice, separatori `/`, senza slash finale. Mai
    /// vuoto: `""` è la radice, e la radice non è una voce.
    pub path: String,
    /// Quante **sottocartelle dirette** ha.
    ///
    /// Sta qui perché è ciò che serve a decidere se disegnare la freccetta che
    /// apre, cioè prima di chiedere cosa c'è dentro: senza, un albero pigro
    /// dovrebbe interrogare ogni cartella per sapere quali sono espandibili —
    /// che è esattamente il giro per cartella che questa voce esiste per non
    /// fare.
    pub folders: u32,
    /// Quanti **file diretti** ha, di ogni specie.
    ///
    /// Di ogni specie e non solo documenti: la domanda a cui risponde è «questa
    /// cartella è vuota?», e una cartella con dentro solo un PNG non lo è.
    pub entries: u32,
}

/// **Dove** guardare, per le domande che si fanno per cartella (§14.3, §14.4).
///
/// Due campi e non due varianti perché sono la stessa domanda con un raggio
/// diverso, ed è la stessa coppia di
/// [`QueryPredicate::Folder`](crate::query::QueryPredicate::Folder) — che è
/// deliberato: la regola che decide se qualcosa ci sta dentro
/// ([`in_folder`](crate::query::in_folder)) è una, e due copie divergerebbero
/// sul caso che nessuno prova (la radice, che con `descendants` è tutto il
/// vault).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderScope {
    /// La cartella, senza slash finale. `""` è la radice del vault.
    pub path: String,
    /// Anche ciò che sta nelle sue discendenti. `false` = i soli figli
    /// **diretti**, che è la domanda che disegna un livello di albero.
    #[serde(default)]
    pub descendants: bool,
}

impl FolderScope {
    /// I figli diretti di questa cartella.
    pub fn direct(path: impl Into<String>) -> Self {
        FolderScope {
            path: path.into(),
            descendants: false,
        }
    }
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
// Le capacità — ventidue quando la decisione 0013 ha chiuso l'elenco,
// **trentaquattro** oggi, tutte per aggiunta (il conto si rifà contando le
// `func` delle quattordici interfacce `host-*` in `wit/fub/abi.wit`, ed è
// l'unico modo per cui questo numero è vero: scritto e basta, invecchia — §16.7)
// — non stanno
// in un trait solo, e la ragione è il §7.1: un trait solo si implementa **per
// intero o per niente**, e chi ne può fare solo una metà (il percorso di
// render, che ha il workspace in prestito condiviso; un comando che si è
// dichiarato di sola lettura; a M5 un componente senza il permesso di
// scrivere) è costretto a scrivere l'altra metà come una fila di rifiuti.
// Erano novantasei corpi di metodo per quattro implementazioni, di cui ventidue
// non facevano niente se non dire di no.
//
// Le famiglie sono quattordici e sono scelte su un criterio solo: **cosa vuol dire
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
// Al confine WIT le quattordici famiglie sono quattordici `interface`, e lì la scomposizione
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

    /// I **byte** di un documento, senza decodificarli.
    ///
    /// Sta accanto a [`VaultRead::read_document`] e non al posto suo, per la
    /// stessa ragione per cui nel kernel `read` e `read_bytes` sono due
    /// funzioni: chi legge del testo non deve poter dimenticare di decodificare.
    ///
    /// Esiste perché senza di lei il confine dei plugin è **testo e basta**, e
    /// un estrattore di terzi — il PDF, l'OCR, la trascrizione di FEATURES §9.1,
    /// che è il modo in cui omnisearch fa entrare gli allegati nella ricerca —
    /// non ha modo di chiedere ciò che gli serve. Il kernel sapeva già leggere a
    /// byte per conto proprio (`SourceKind::Bytes`, dalla
    /// [decisione 0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md));
    /// quel sapere si fermava sul confine, e questa è la firma che lo fa passare
    /// (§21.8).
    ///
    /// È sotto lo stesso permesso di ogni altra lettura del vault
    /// ([`permission::READ_VAULT`](crate::options::permission::READ_VAULT)):
    /// leggere del testo e leggere dei byte non sono due gradi di fiducia — chi
    /// può leggere una nota può già leggerne i byte decodificandoli lui.
    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError>;

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
    /// [`IndexProvider::on_documents_indexed`]: **spinto**, a chi indicizza,
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
    /// per eleganza, ma perché una riscrittura totale non dice *cosa* è
    /// cambiato.
    ///
    /// # La base, e perché è un tipo a due casi e non un `Option`
    ///
    /// [`WriteBase::DescendsFrom`] porta la revisione che chi scrive si aspetta
    /// di trovare sul disco. Se non combacia, l'host risponde
    /// [`PluginError::Conflict`] e **non scrive niente**: qualcuno ha riscritto
    /// il file da quando questo testo è stato preso, e sovrascriverlo
    /// distruggerebbe il suo lavoro senza che nessuna delle due metà del sistema
    /// se ne accorga. È la stessa guardia di
    /// [`apply_edit`](VaultWrite::apply_edit) (decisione 0008), applicata alla
    /// seconda primitiva di scrittura invece di restare privilegio della prima.
    ///
    /// [`WriteBase::Dictated`] è l'altra metà, e non è l'assenza della prima:
    /// una riscrittura totale può essere compiuta da sé — un importer che crea
    /// una nota, un template che scrive la nota di oggi, il ripristino di una
    /// versione non stanno correggendo un testo che hanno letto, lo stanno
    /// **dettando**. Obbligarli a esibire una base vorrebbe dire farsela
    /// inventare, e una base inventata è una guardia che dice sempre di sì.
    ///
    /// La differenza con [`apply_edit`](VaultWrite::apply_edit), che una base la
    /// pretende e basta, resta e ha la stessa ragione di prima: un edit **non
    /// esiste** senza la revisione su cui è stato calcolato — i suoi offset
    /// indicano un testo, e senza dire quale non sono una modifica ma
    /// un'ipotesi. Qui invece i due casi sono due mestieri, e il tipo li fa
    /// nominare entrambi: fino alla decisione 0092 questo parametro era un
    /// `Option`, e scrivere ciechi era ciò che succedeva **omettendo** —
    /// cioè il default, che è il modo in cui una guardia protegge chi si
    /// ricorda di attivarla e nessun altro.
    ///
    /// # Cosa torna
    ///
    /// La revisione **prodotta**, cioè quella che il file ha adesso. Serve a chi
    /// scrive due volte di fila senza rileggere: è la `base` della scrittura
    /// dopo. Senza, l'unico modo di averla sarebbe ricalcolarla per conto
    /// proprio — cioè una seconda implementazione di come questo host deriva le
    /// impronte, che è la cosa che [`Revision`](crate::edit::Revision) è opaca
    /// per impedire.
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError>;

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
// impone (`.fub/data/plugins/<id>/`): il plugin non conosce la radice del
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

// --- le impostazioni (§11.1) -----------------------------------------------
//
// Sono **due** famiglie e non una, come per il vault e per i blob: leggere la
// propria configurazione è ciò che un `activate` fa per sapere se è acceso, e
// deve poterlo fare anche dal percorso di sola lettura; scriverla è un atto che
// una simulazione non compie e che un plugin senza permesso non ha.
//
// Non c'è un `settings_list`: l'elenco con schema, valore e provenienza è una
// **risposta con dei dati**, quindi passa dal canale dati
// ([`IndexQuery::Settings`]) come i documenti, i tag e i backlink. La riga che
// divide le due cose è quella della decisione 0013, applicata di nuovo.

/// Leggere le impostazioni **dichiarate**.
///
/// Qualunque chiave dichiarata, non solo le proprie: la configurazione non è un
/// recinto e non contiene segreti (vedi [`crate::settings`]), e un plugin di
/// tema che non potesse leggere `editor.font-size` perché non è sua sarebbe un
/// plugin di tema inutile. Ciò che è recintato è la **scrittura**.
pub trait SettingsRead: Send + Sync {
    /// Il valore che vale adesso per questa chiave: quello del vault, quello
    /// della macchina, o il default dello schema — in quest'ordine.
    ///
    /// Una chiave che **nessuno ha dichiarato** è
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) e non `None`: lo
    /// schema è il contratto fra chi legge e chi configura, e una chiave fuori
    /// schema è un errore di chi la chiede — quasi sempre un refuso — non uno
    /// stato del vault. Un valore c'è **sempre**, perché il default fa parte
    /// della dichiarazione.
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError>;
}

/// Scrivere un'impostazione **che si è dichiarata scrivibile da un programma**.
///
/// È la metà che la [decisione 0010](../../../docs/decisions/0010-comando-descritto-a-una-macchina.md)
/// aveva lasciato aperta. Due condizioni, e nessuna delle due basta da sola: il
/// permesso `fub:write-settings` nel manifest (chi scrive), e
/// [`SettingSpec::program_writable`](crate::settings::SettingSpec::program_writable)
/// sulla chiave (cosa si scrive). La seconda esiste perché il divieto che conta
/// — privacy e AI non si spostano da sole — non riguarda *chi* chiede: un
/// componente che potesse allargarsi i permessi da sé non ha permessi, e questo
/// vale anche quando quel componente è un comando del core.
pub trait SettingsWrite: SettingsRead {
    /// Scrive la chiave nel livello che il suo
    /// [`scope`](crate::settings::SettingSpec::scope) dichiara: il vault, o la
    /// macchina. Non è un parametro perché non è una scelta di chi scrive —
    /// sarebbe il modo di far viaggiare un'impostazione che non deve viaggiare.
    ///
    /// Il valore è convalidato contro la specie dichiarata (intervallo di un
    /// numero, elenco di una scelta): un valore fuori schema è
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs), non un
    /// arrotondamento.
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError>;

    /// Dimentica ciò che era stato deciso: la chiave **ricade** al livello
    /// sotto, che è il default solo se non c'era niente in mezzo.
    ///
    /// È una capacità sua e non `set_setting(default)` perché sono due cose
    /// diverse: scrivere il default *decide* che vale il default (e resta scritto
    /// quando il default cambia), azzerare *smette di decidere*. È la differenza
    /// che un «ripristina» deve fare, ed è il §11.1 per intero — l'import,
    /// l'export e il reset sono comandi che stanno in piedi su questa riga.
    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError>;
}

// --- lo stato di vista (§11.2) ----------------------------------------------
//
// Dove un provider tiene lo scroll, le sezioni collassate, il filtro corrente,
// la scheda attiva. È il caso proprio che la decisione 0013 aveva lasciato senza
// contenitore togliendo lo `storage_*` volatile — e non è quello che rientra
// dalla finestra, perché le tre proprietà che gli mancavano ci sono tutte:
//
// - **non viaggia col vault.** Vive nella cartella di configurazione della
//   macchina, accanto alle impostazioni di macchina (decisione 0036). Lo scroll
//   di ieri sul portatile non è un fatto sul vault, e sincronizzarlo vorrebbe
//   dire far litigare due finestre su dove si era rimasti;
// - **è per esemplare**, non per view: la chiave la compone l'host con
//   [`ViewInstance::instance`], che è già «quale delle tre istanze di questa
//   view sono io» (decisione 0007). Lo stesso pannello aperto due volte ha due
//   scroll, ed è la ragione per cui il §11.2 diceva *per-pannello*;
// - **è recintato**, come i blob: la chiave è la propria, e l'id di chi scrive
//   non è un parametro.
//
// Sono **due** famiglie e non una, per la ragione già scritta sui blob: si
// rilegge mentre si disegna, e non si deve poter scrivere mentre si disegna.

/// Rileggere lo stato di vista del proprio esemplare.
pub trait ViewStateRead: Send + Sync {
    /// Lo stato salvato sotto questa chiave, o `None` se non ce n'è.
    ///
    /// Assente non è un errore ed è il caso **normale**: la prima volta che una
    /// view si disegna nessuno le ha ancora salvato niente, e un provider che
    /// dovesse distinguere «mai scritto» da «errore» per disegnare la propria
    /// prima riga avrebbe un ramo che nessuno prova.
    ///
    /// **Fuori da un esemplare di view è `None`**, sempre: chi non sta
    /// disegnando né reagendo per conto di un'istanza non ha uno stato di vista
    /// da rileggere, e inventargliene uno vorrebbe dire dargli quello di
    /// qualcun altro.
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError>;
}

/// Ricordare lo stato di vista del proprio esemplare.
pub trait ViewStateWrite: ViewStateRead {
    /// Salva (`Some`) o dimentica (`None`) lo stato sotto questa chiave.
    ///
    /// `None` e non una capacità a sé perché qui — a differenza delle
    /// impostazioni — non ci sono livelli sotto a cui ricadere: una chiave c'è o
    /// non c'è, e `null` è un valore JSON come un altro che sarebbe stato
    /// ambiguo scrivere per dire «scordatelo».
    ///
    /// **Fuori da un esemplare di view è un errore** e non un silenzio: leggere
    /// a vuoto è il caso normale di chi non ha ancora salvato niente, scrivere
    /// nel vuoto è invece qualcuno che crede di ricordare e non ricorderà —
    /// cioè un difetto che si vede solo alla riapertura, quando è tardi.
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError>;
}

/// Il tetto di [`HostEnv::random_bytes`], in byte.
///
/// Sedici byte sono un UUID, trentadue una chiave: mille sono già due ordini di
/// grandezza sopra ogni identità che si possa voler generare. Il tetto c'è
/// perché una capacità senza tetto è un modo di far allocare all'host quanto
/// pare a chi chiama — la stessa disciplina del freno degli eventi
/// ([decisione 0034](../../../docs/decisions/0034-il-freno-e-il-raggruppamento.md)),
/// dove il tetto sta con chi ritira.
///
/// **Non è un termine del contratto.** Il numero non attraversa il confine, e
/// chi lo supera non lo scopre chiedendolo ma sentendoselo dire: sopra il tetto
/// `random_bytes` rende [`BadArgs`](PluginError::BadArgs) invece di mille byte
/// zitti ([decisione 0094](../../../docs/decisions/0094-un-tetto-che-si-fa-sentire.md)).
/// Così resta alzabile senza rompere nessuno — una promessa pubblica di mille
/// byte, dopo il congelamento di M4, sarebbe stata mille byte per sempre.
pub const MAX_RANDOM_BYTES: u32 = 1024;

/// Ciò che **l'host sa e il provider no**: che ore sono, in che fuso e in che
/// lingua, quanto caso serve, e cosa sta guardando l'utente.
///
/// Le quattro capacità sembrano lontane e sono la stessa specie di cosa — un
/// fatto dell'host che chi gira dentro il confine non può calcolarsi — e si
/// negano insieme: un componente sotto sandbox può non avere orologio (WASI lo
/// può negare), non avere entropia (WASI la può negare allo stesso modo), e non
/// avere titolo a sapere quale nota è aperta. Averle in una famiglia sola è ciò
/// che permette di dirlo in un posto solo.
///
/// Il §12.3 ne ha aggiunte due, con l'argomento dell'orologio applicato dove non
/// lo era: un componente che chiamasse `SystemTime::now` sarebbe non testabile e
/// non funzionante sotto sandbox, e **lo stesso vale per il caso** — che serve a
/// ogni identità che Fub genera (2.2, 8.3, 5.2, 13.3) — e per il **locale**,
/// senza il quale l'orologio sa dire *quando* e non sa dirlo a nessuno.
pub trait HostEnv: Send + Sync {
    /// Millisecondi dall'epoca UNIX, secondo l'host.
    ///
    /// Il tempo è una capacità come le altre: un componente WASM può non avere
    /// orologio (WASI lo può negare), e un host che lo fornisce può renderlo
    /// deterministico nei test. Un plugin che chiamasse `SystemTime::now` per
    /// conto proprio sarebbe non testabile e, sotto sandbox, non funzionante.
    fn now_unix_millis(&self) -> u64;

    /// In che lingua legge chi guarda, in che fuso vive, con che calendario
    /// (§12.3).
    ///
    /// È il gemello dell'orologio: `now_unix_millis` dà millisecondi UTC, cioè
    /// *quando* è successo, e senza questo record non c'è modo di dirlo a
    /// qualcuno — né di ordinare due titoli come li ordinerebbe lui, né di
    /// sapere che il suo lunedì è il primo giorno della settimana.
    ///
    /// **Non ha un gemello che scrive**, e per la stessa ragione di
    /// [`active_context`](HostEnv::active_context): in che lingua legge l'utente
    /// è una decisione dell'utente sull'app, non una capacità da concedere a un
    /// plugin. Chi lo pubblica è la shell, e chi lo decide è la persona davanti
    /// allo schermo attraverso le chiavi `locale.*` (§11.1).
    ///
    /// Un host che non ha sentito nessuno rende [`Locale::default`]: lingua
    /// indeterminata, UTC, ISO 8601. È deterministico di proposito — è la stessa
    /// ragione per cui l'orologio è una capacità.
    ///
    /// Si chiama `user_locale` e non `locale` perché il nome dice **di chi**:
    /// non è il locale del processo né quello del vault, è quello della persona
    /// davanti allo schermo, ed è l'unico che conti quando si decide come
    /// mostrarle una data.
    fn user_locale(&self) -> Locale;

    /// `n` byte di **caso**, per generare un'identità.
    ///
    /// Sotto WASI il caso non c'è di default: è letteralmente lo stesso buco
    /// dell'orologio, un metodo più in là. Ogni identità che Fub genera lo
    /// chiede — UUID per nota (2.2), Zettelkasten id (8.3), id di blocco (5.2, e
    /// la [decisione 0003](../../../docs/decisions/0003-modello-del-documento.md)),
    /// id di annotazione (13.3) — e senza, ognuna di quelle feature si
    /// arrangerebbe con l'orologio, che a due chiamate nello stesso millisecondo
    /// dà lo stesso valore.
    ///
    /// # Byte, e non un UUID
    ///
    /// Perché le identità che servono sono **quattro forme diverse** e un metodo
    /// che ne rendesse una lascerebbe le altre tre a reimplementarsi: la
    /// capacità è l'entropia, che solo l'host ha, mentre la forma (UUID v4, v7,
    /// un id corto per un blocco) è codice di libreria e sta nell'SDK
    /// ([`fub_sdk::ids`](https://docs.rs/fub-sdk)).
    ///
    /// # Per l'identità, non per i segreti
    ///
    /// Ciò che questa capacità promette è che due chiamate non diano lo stesso
    /// valore, non che il prossimo valore sia **imprevedibile**. Chi generasse
    /// da qui un token di sessione o una chiave farebbe l'errore che questa riga
    /// esiste per non far fare: quando servirà un generatore crittografico sarà
    /// una capacità sua, con una firma sua — come il portachiavi di sistema per
    /// i segreti ([`crate::settings`]).
    ///
    /// # Chi riesce riceve esattamente `n` byte
    ///
    /// È la sola lettura possibile di questa firma, ed è ciò per cui rende un
    /// esito: `Ok` sono `n` byte, mai meno. I due modi di non riuscire sono
    /// **nominati** perché chi chiama ci risponde in due modi diversi.
    ///
    /// - [`BadArgs`](crate::PluginError::BadArgs) — sopra
    ///   [`MAX_RANDOM_BYTES`]. È una colpa di chi chiama e si corregge
    ///   chiedendo meno: un plugin che ne chiedesse un gigabyte non ha un caso
    ///   d'uso, ha un difetto, e riceverlo troncato lo lascerebbe convinto di
    ///   avere l'entropia che ha chiesto.
    /// - [`PermissionDenied`](crate::PluginError::PermissionDenied) — la
    ///   capacità [`Capability::Env`](crate::Capability::Env) non è concessa.
    ///   Non si corregge affatto: chiedere meno non serve, e la risposta giusta
    ///   è dirlo a chi guarda.
    ///
    /// Il **tetto non attraversa il confine** ed è di proposito: un numero
    /// pubblicato è una promessa che si congela, mentre ciò che il contratto
    /// deve garantire è che superarlo si **dica** — la stessa forma di
    /// [`Event::Overflow`](crate::Event), dove ciò che si pubblica è la perdita
    /// e non la soglia.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError>;

    /// Il contesto del pannello con il focus: quale documento, cosa c'è
    /// selezionato, in che modalità. `None` = la shell non ne ha ancora
    /// pubblicato uno (nessun pannello).
    ///
    /// # Due permessi, non uno
    ///
    /// È il solo metodo del contratto con **due cancelli**, e li ha perché
    /// pubblica due cose dell'utente che si concedono separatamente
    /// (§23.5, decisione 0095):
    /// [`READ_SESSION`](crate::options::permission::READ_SESSION) per quale
    /// nota è aperta e in che modalità,
    /// [`READ_SELECTION`](crate::options::permission::READ_SELECTION) per il
    /// testo selezionato. Senza il primo la risposta è `None`; con il primo e
    /// senza il secondo il contesto arriva con
    /// [`selections`](crate::session::ViewContext::selections) a `None`.
    ///
    /// La coppia esiste per una scelta che all'utente serve e che un cancello
    /// solo non sa esprimere: *«questo plugin può sapere che nota sto
    /// guardando, non cosa ci sto scrivendo»*. Nessuno dei due si appoggia a
    /// [`READ_VAULT`](crate::options::permission::READ_VAULT), che pure governa
    /// il contenuto dei documenti: appoggiarcisi avrebbe legato la selezione
    /// alla cecità sul vault, cioè avrebbe tolto proprio quella scelta.
    ///
    /// Nessuno dei due rifiuti si può **dire**, perché questa firma non ha un
    /// esito — è una delle sei senza `Result` — e in entrambi i casi la
    /// risposta nulla significa già un'altra cosa («nessun pannello», «nessun
    /// cursore»). Regge lo stesso, e per una ragione che vale solo qui: chi la
    /// riceve ha in mano il proprio manifest, quindi sa da sé perché la riceve.
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
    ///
    /// Chi lancia non deve leggere il vault per conto del job: dalla decisione
    /// 0027 il job ha l'host, e nel [`JobSpec`] vanno i suoi argomenti. Ciò che
    /// il lanciatore *non* può dare — e resta la ragione per cui questa è una
    /// richiesta e non una chiamata — è il **tempo**: il job gira quando l'host
    /// lo esegue, non adesso.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;

    /// **A che punto sono**: da chiamare dentro [`Plugin::run_job`], quanto
    /// spesso si vuole (§10.3, decisione 0035).
    ///
    /// # Perché è una capacità se il progresso è un evento
    ///
    /// Lo è, e resta un evento: ciò che finisce sul canale è
    /// [`Event::JobProgress`](crate::Event::JobProgress), con la regola della
    /// decisione 0013 — *ciò che si limita a informare è un evento*. Questa è la
    /// **porta**, come [`emit`](HostEvents::emit) è la porta di ogni altro
    /// evento, e c'è per una ragione sola: un job **non conosce il proprio
    /// `JobId`**. [`Plugin::run_job`] riceve il nome dell'entry point, gli
    /// argomenti e l'host — non l'identità — quindi non può nominare sé stesso
    /// in un evento, e chi l'identità ce l'ha è il suo host. Passando da qui
    /// l'id non è un parametro: **non si può sbagliare e non si può fingere**,
    /// che è la stessa proprietà per cui un topic di custom non si può emettere
    /// sotto il nome di un altro (§7.4).
    ///
    /// # Fuori da un job non fa niente, e non è una dimenticanza
    ///
    /// Il default è un no-op: lo eredita ogni host che non sia quello di un job.
    /// Un progresso ha bisogno di una **fine** per essere un progresso, e
    /// l'unica cosa che nel contratto ha una fine dichiarata è un job
    /// ([`Event::JobDone`](crate::Event::JobDone)); una chiamata sincrona finisce
    /// tornando, e mentre gira tiene il prestito esclusivo del workspace — chi
    /// vuole raccontarsi mentre lavora, per costruzione, è un job.
    ///
    /// Come `emit`, non ha esito: un host che non la concede non rifiuta, tace.
    /// E come `emit` **non la si nega a un job annullato**: l'ultima cosa che un
    /// job che sta smettendo può voler dire è a che punto era.
    fn report_progress(&mut self, progress: JobProgress) {
        let _ = progress;
    }
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
/// Le tre cose sono una decisione sola, e la risposta di Fub alla terza è:
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

/// **Parlare con qualcosa che non sta sul disco** (§23.3).
///
/// La [0013](../../../docs/decisions/0013-elenco-delle-capacita.md) l'aveva
/// tenuta fuori con **due bloccanti nominati** — *«servono prima §9.1 (un
/// lavoro lungo che vede il vault) perché sia utile e §7.3 (`network` letto da
/// qualcuno) perché sia sicura»* — ed è la forma migliore in cui un no si possa
/// scrivere. Sono caduti tutti e due: il primo con la
/// [0027](../../../docs/decisions/0027-il-lavoro-lungo-vede-il-vault.md), il
/// secondo con la [0021](../../../docs/decisions/0021-il-confine.md), che aveva
/// scritto perfino la riga d'innesto.
///
/// # Il permesso non dice solo *se*: dice **dove**
///
/// `fub:network` porta come parametro una **allowlist di host**, e lo prometteva
/// dalla [0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
/// senza che nessuno la leggesse. È l'unico permesso il cui parametro **si
/// onora**, e la ragione per cui si è cominciato da qui invece che dai prefissi
/// di path è che qui il divario fra ciò che il manifest dichiara e ciò che
/// l'app fa non è un recinto che perde: un manifest che dice *«mi connetto solo
/// a api.acme.com»*, mostrato all'utente, **accettato** dall'utente, e che poi
/// consenta qualunque host è una **frase falsa scritta dall'app**.
///
/// # Una richiesta sola, e i redirect non si seguono
///
/// È la proprietà su cui l'allowlist poggia, e senza la quale sarebbe una
/// decorazione: un host dichiarato che risponde `302` verso un host che non lo
/// è porterebbe fuori dal recinto **senza che nessuno lo abbia deciso**. Qui il
/// `3xx` arriva a chi ha chiesto, con il suo `Location`
/// ([`HttpResponse::redirect_to`](crate::net::HttpResponse::redirect_to));
/// seguirlo è **una seconda chiamata**, e ogni chiamata ripassa dal cancello.
/// Un salto che può uscire dal recinto non lo fa l'host per conto di qualcun
/// altro.
pub trait HostNetwork: Send + Sync {
    /// Una richiesta, una risposta.
    ///
    /// `&self` e non `&mut self` — a differenza di
    /// [`call_service`](HostServices::call_service), che pure è un effetto —
    /// perché non tocca niente dell'host: è la proprietà che permette a un job
    /// di farla **senza tenere il prestito del workspace** per quanto dura la
    /// rete, che è l'unica durata di questo contratto che l'host non governa.
    ///
    /// **Un `4xx` o un `5xx` sono `Ok`.** L'errore è non aver potuto chiedere —
    /// DNS, connessione, TLS, il tetto di tempo dell'host — e arriva come
    /// [`PluginError::Io`](crate::PluginError::Io). Le due si correggono in modi
    /// opposti, quindi vanno distinte: a un `404` si risponde guardando la
    /// risposta, a un guasto riprovando o dicendolo a chi guarda.
    ///
    /// I rifiuti sono **tre**, e ognuno dice cosa manca:
    /// [`PermissionDenied`](crate::PluginError::PermissionDenied) senza
    /// `fub:network` **o** verso un host fuori dall'allowlist dichiarata —
    /// perché sono la stessa frase, *non ti è concesso questo* —,
    /// [`BadArgs`](crate::PluginError::BadArgs) per un URL che non si legge o
    /// per uno schema che non è `https` (né `http` verso l'anello locale), e
    /// [`Unserved`](crate::PluginError::Unserved) su un host montato **senza
    /// client di rete**: non è un permesso che manca, è che di qua non ci passa
    /// nessun filo, e chi lo riceve deve poterlo dire diversamente.
    ///
    /// **Il tetto di tempo non attraversa il confine**, per la regola della
    /// [0094](../../../docs/decisions/0094-un-tetto-che-si-fa-sentire.md): un
    /// limite dell'host dev'essere visibile quando morde, non interrogabile.
    /// Chi lo supera riceve un `Io` che lo dice, e il numero resta alzabile
    /// senza rompere nessuno.
    fn fetch(
        &self,
        request: crate::net::HttpRequest,
    ) -> Result<crate::net::HttpResponse, PluginError>;
}

/// Un prestito è ancora il filo: serve a chi ha un `Arc<dyn HostNetwork>` e
/// vuole metterci davanti un cancello senza clonarlo.
impl<T: HostNetwork + ?Sized> HostNetwork for &T {
    fn fetch(
        &self,
        request: crate::net::HttpRequest,
    ) -> Result<crate::net::HttpResponse, PluginError> {
        (**self).fetch(request)
    }
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

    /// **Annulla l'ultima operazione annullabile**, e dice quale era (§13.3).
    ///
    /// `Ok(None)` = non c'era niente da annullare, e non è un errore: è la
    /// risposta normale a un vault appena aperto, e un comando che la riceve ha
    /// una frase da mostrare e non un guasto da riferire.
    ///
    /// Sta qui accanto a [`run_command`](HostCommands::run_command) perché la
    /// pila che consuma è fatta di [`Undo`](crate::command::Undo) — cioè, per
    /// metà, di comandi — e perché è la stessa specie di atto: fare qualcosa che
    /// qualcun altro ha dichiarato di saper fare. È una capacità e non un
    /// comando del registro per la ragione della decisione 0009 letta al
    /// contrario: la pila è **privata del kernel**, e un comando riceve solo
    /// l'`HostApi` — quindi «togli l'ultima voce e falla» non è scrivibile senza
    /// una firma. Il comando che la invoca c'è lo stesso, ed è quello che
    /// compare nella palette.
    ///
    /// Tre cose che questa firma dice non dicendole:
    ///
    /// - **Annullare non è annullabile**: mentre un annullamento gira, la pila
    ///   non cresce. Senza, la prima cosa annullabile che si trova sarebbe
    ///   l'annullamento stesso, e Ctrl-Z due volte non farebbe niente due volte.
    ///   Il *redo* è un'altra pila e un'altra decisione, e oggi non c'è.
    /// - **La pila dura quanto il vault aperto.** È la cronologia «per
    ///   sessione» che FEATURES 4.2 chiede, e non di più: farla sopravvivere a
    ///   una chiusura vorrebbe dire tenerla su disco *e* accorgersi di ciò che
    ///   è cambiato mentre l'app era spenta, cioè un journal (§15.2) e non una
    ///   pila.
    /// - **Un annullamento può fallire come qualunque scrittura**, e il caso che
    ///   conta è [`PluginError::Conflict`]: il documento è cambiato da quando
    ///   l'operazione lo aveva toccato, quindi tornare indietro cancellerebbe il
    ///   lavoro di qualcun altro. Fallire lì è il comportamento giusto, e la
    ///   voce resta consumata — riprovare vorrebbe dire riprovare a cancellarlo.
    ///
    /// # Una voce non è un passo, ed è ciò che questa firma diceva male (§23.14)
    ///
    /// La riga qui sopra — *«può fallire come qualunque scrittura»* — descriveva
    /// un annullamento come **una** scrittura. È una lista: una macro che ha
    /// rinominato dodici note torna indietro da dodici rinomine, e il passo che
    /// fallisce sta in mezzo agli altri. Con un `Option<Text>` le tre risposte
    /// possibili erano due, e quella che mancava era la più frequente e la sola
    /// su cui si può fare qualcosa:
    ///
    /// | cosa è successo | cosa risponde |
    /// |---|---|
    /// | tutti i passi sono andati | `Ok(Some(Undone { replay: None, … }))` |
    /// | qualcuno sì e qualcuno no | `Ok(Some(Undone { replay: Some(…), … }))` |
    /// | **niente** è cambiato | `Err(…)` — il primo perché |
    /// | non c'era niente da annullare | `Ok(None)` |
    ///
    /// L'ultima riga della tabella non è un errore e non lo è mai stata: è la
    /// risposta normale a un vault appena aperto.
    ///
    /// La terza tiene la promessa della riga qui sopra **alla lettera**: se non
    /// è cambiato niente, un annullamento è fallito come qualunque scrittura, e
    /// chi lo invocava sperando in un `Err` continua a riceverlo. Ciò che
    /// smette di essere un errore è soltanto il caso in cui *una parte del
    /// lavoro è stata fatta* — buttarla via insieme alla notizia sarebbe l'unica
    /// risposta peggiore del silenzio.
    ///
    /// E l'[`Undone`] porta **due** conti, non uno: quello di questo
    /// annullamento e quello dell'operazione che annulla, che poteva essere già
    /// a metà per conto suo. Vedi il tipo.
    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError>;
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
pub trait ReadApi:
    VaultRead + DataRead + HostQuery + HostEnv + SettingsRead + ViewStateRead
{
}

impl<T: VaultRead + DataRead + HostQuery + HostEnv + SettingsRead + ViewStateRead + ?Sized> ReadApi
    for T
{
}

/// Le capacità che il kernel concede a un provider/plugin: la **somma** delle
/// quindici famiglie.
///
/// È l'**unico** varco col mondo: ciò che non passa di qui, un plugin WASM non
/// lo potrà fare. Per questo la superficie va chiusa *prima* del freeze di M4 —
/// il dogfooding del versioning ha trovato il buco: un `EventHandler` scritto
/// come lo scriverebbe un plugin non aveva modo di tenere uno store di snapshot
/// su disco né di sapere che ore sono. La decisione 0013 ha chiuso l'elenco: dopo il
/// freeze un metodo **aggiunto** a una famiglia è una minor, uno **tolto** è una
/// major.
///
/// Non si implementa e non si dichiara: chi ha le quindici famiglie ce l'ha, per
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
    ReadApi
    + VaultWrite
    + VaultStructure
    + DataWrite
    + SettingsWrite
    + ViewStateWrite
    + HostEvents
    + HostCommands
    + HostServices
    + HostNetwork
{
}

impl<T> HostApi for T where
    T: ReadApi
        + VaultWrite
        + VaultStructure
        + DataWrite
        + SettingsWrite
        + ViewStateWrite
        + HostEvents
        + HostCommands
        + HostServices
        + HostNetwork
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
    pub title: Text,
    pub surface: ViewSurface,
    /// Dichiarazione di interesse: gli eventi al cui arrivo la shell deve
    /// ridisegnare questa view (chiamare di nuovo `render_view`).
    ///
    /// **Dal §22.3 questo campo è ciò che l'host ci ha scritto, non ciò che il
    /// provider ci scrive**: la maschera la dichiara
    /// [`ViewProvider::interests`], per esemplare, e l'host risolve qui quella
    /// dell'esemplare unico quando prende in carico la spec. Scriverlo dal
    /// provider non è un errore ed è ancora il modo di dirlo in un posto solo —
    /// ma è `interests` a essere chiesta, e se le due dicessero cose diverse
    /// vince lei. Maschera vuota = nessun ridisegno event-driven.
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
    /// Vale parola per parola ciò che è scritto su [`refresh`](Self::refresh):
    /// dal §22.3 le due metà si dichiarano insieme in [`ViewInterests`], e
    /// questo campo è dove l'host posa la risposta per l'esemplare unico.
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
    pub fn new(id: impl Into<String>, title: impl Into<Text>, surface: ViewSurface) -> Self {
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

impl Localize for ViewSpec {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        visit(&mut self.title);
        self.params.visit_texts(visit);
    }
}

/// **Quando questa view invecchia**, per l'esemplare che lo chiede (§22.3).
///
/// Le due metà stanno in un record solo perché sono la stessa dichiarazione
/// vista su due canali — gli eventi del vault (`refresh`) e il contesto di
/// sessione (`follows`) — e separarle darebbe due posti dove la stessa view può
/// dire due cose diverse su quando ridisegnarsi.
///
/// I campi omonimi di [`ViewSpec`] restano il **caso largo**: sono la
/// dichiarazione fatta prima che un esemplare esistesse, e per l'esemplare unico
/// ([`ViewInstance::only`]) le due cose coincidono per costruzione — è l'host a
/// risolverle, dove le spec si chiedono.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ViewInterests {
    #[serde(default)]
    pub refresh: EventMask,
    #[serde(default)]
    pub follows: ContextMask,
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
    /// Cosa fa invecchiare **questo esemplare** (§22.3).
    ///
    /// Non ha un default, e non è una dimenticanza: con un default vuoto un
    /// provider che non la implementa smetterebbe di ridisegnarsi in silenzio,
    /// e a scoprirlo sarebbe uno schermo fermo invece del compilatore.
    fn interests(&self, instance: &ViewInstance) -> ViewInterests;
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

/// Se la risposta deve portarsi dietro gli **estratti**, o solo dire quali
/// documenti combaciano (§21.9).
///
/// È la stessa specie di distinzione di [`PropertySelect`] — *cosa* torna
/// indietro, non *cosa* si seleziona — e nasce da una misura: una ricerca
/// testuale su duemila note ne costava ventitré millisecondi, e ventuno erano
/// duemila estratti generati per mostrarne venti. Il pianificatore chiede senza
/// finestra (l'ordine della risposta è del contratto, non del motore), quindi
/// senza questo campo non ha nessun modo di dire «per adesso mi bastano gli id»:
/// chi indicizza deve presumere che l'estratto serva sempre, ed è il caso più
/// caro.
///
/// Vale per chi **produce** una risposta, non per chi la legge: un estratto
/// assente non vuol dire che non ce ne sia uno da fare — vuol dire che nessuno
/// l'ha chiesto. È la stessa lettura di
/// [`DocumentMatch::occurrences`] vuoto.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Excerpts {
    /// Sì: chi ha cercato vede **perché** una nota è nel risultato. È il
    /// default, ed è il verso giusto in cui sbagliare — chi non sa di questo
    /// campo riceve una risposta completa e paga, invece di ricevere una
    /// risposta muta e non capire perché.
    #[default]
    Attach,
    /// No: la domanda seleziona e basta. La chiede chi sa che getterà via quasi
    /// tutto — il pianificatore prima di applicare la finestra, un'automazione
    /// che conta, `vault.replace` che riscrive — e non chi disegna un elenco di
    /// risultati.
    ///
    /// Non tocca la **rilevanza**: il punteggio serve a ordinare, e ordinare è
    /// esattamente ciò che si fa prima di sapere quale pagina resta.
    Omit,
}

impl Excerpts {
    pub fn wanted(self) -> bool {
        matches!(self, Excerpts::Attach)
    }
}

/// Una proprietà con il suo valore normalizzato ([`PropertyValue`], decisione 0003).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyEntry {
    pub key: String,
    pub value: PropertyValue,
}

/// **Un punto dentro un documento**, dicibile nel contratto (decisione 0049).
///
/// È una primitiva sola per i tre clienti che la chiedevano da tre firme
/// diverse: il salto all'occorrenza di un risultato di ricerca
/// ([`DocumentMatch::occurrences`]), il riferimento a un blocco o a un heading
/// che [`IndexResult::Resolved`] deve poter indicare ([`ResolvedRef`]), e la
/// citazione di una lavagna verso un punto di una nota. Tre modi di dire
/// «dove» sarebbero stati tre modi diversi, e il secondo sarebbe arrivato con
/// il primo già congelato.
///
/// # I tre campi sono tre domande diverse
///
/// - `span` è in **byte del sorgente** del documento — la stessa valuta di ogni
///   altro [`Span`] del modello, e quella che
///   [`ViewUpdate::Reveal`](crate::ui::ViewUpdate::Reveal) sa già portare in
///   un editor. Non è un intervallo dentro
///   [`snippet`](DocumentMatch::snippet): quello serve a **disegnare** una riga
///   e non a tornare al testo, e le due cose non sono la stessa.
/// - `anchor` è l'ancora del blocco che ospita il punto, quando ce n'è una
///   (`^abc`, o lo slug di un heading). Sopravvive alla riscrittura del
///   paragrafo che la contiene, cosa che uno span non fa; ma non è immortale —
///   cancellare la riga che la porta la fa sparire — e per questo non
///   **sostituisce** lo span.
/// - `revision` dice **di quando**: uno span invecchia appena il documento
///   cambia sotto, e senza questo campo la shell porterebbe il cursore nel
///   punto sbagliato senza accorgersene. Il contratto sa già dirlo altrove
///   ([`EditRequest`](crate::edit::EditRequest), decisione 0008), e la risposta
///   qui è **una** perché la domanda era la stessa da due lati.
///
/// Non è opzionale la revisione e non lo è lo span: una posizione che non sa
/// dire di quando è una posizione che non si può usare senza indovinare, e chi
/// non sa dirlo non produce una posizione affatto (`None`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocPosition {
    /// Byte nel **sorgente** del documento, non dentro un estratto.
    pub span: Span,
    /// L'ancora del blocco che lo ospita, se ne ha una.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    /// Il sorgente su cui `span` è stato calcolato.
    pub revision: Revision,
}

impl DocPosition {
    /// Un punto senza ancora: il caso di chi ha trovato un'occorrenza nel testo
    /// e non sa (o non ha pagato per sapere) in che blocco cade.
    pub fn at(span: Span, revision: Revision) -> Self {
        DocPosition {
            span,
            anchor: None,
            revision,
        }
    }

    pub fn with_anchor(mut self, anchor: impl Into<String>) -> Self {
        self.anchor = Some(anchor.into());
        self
    }
}

/// Cosa nomina un riferimento: **quale** documento e, quando il riferimento lo
/// dice, **dove dentro** (risposta a [`IndexQuery::Resolve`]).
///
/// `at` è presente solo se il riferimento chiedeva un punto — `[[Nota#Sezione]]`
/// o `[[Nota#^blocco]]` — e quel punto esiste ancora: un `heading` che nessuno
/// ha più, un `^abc` cancellato e un riferimento che nomina la nota e basta
/// danno tutti e tre `None`, e chi ha chiesto apre il documento in cima. È lo
/// stesso degrado del `None` che avvolge questo record, un gradino più in
/// basso.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedRef {
    pub doc: DocId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<DocPosition>,
}

impl ResolvedRef {
    /// Il documento, senza un punto dentro.
    pub fn doc(doc: DocId) -> Self {
        ResolvedRef { doc, at: None }
    }
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
    /// **Dove**, nel sorgente del documento, sta ciò che ha combaciato — in
    /// ordine di posizione (decisione 0049).
    ///
    /// Non è un doppione di `highlights`, ed è la distinzione che rende
    /// esprimibili tre cose che prima non lo erano: la ricerca dentro la nota
    /// aperta (§21.4), il «vai all'occorrenza successiva», e N risultati per
    /// nota. `highlights` è la forma giusta per **disegnare** una riga —
    /// intervalli dentro `snippet`, che chi disegna avvolge — e non ha nessuna
    /// coordinata nel documento; queste sono le coordinate, e non hanno niente
    /// da disegnare.
    ///
    /// Vuoto non vuol dire «nessuna occorrenza»: vuol dire che nessuno le ha
    /// calcolate. Chi seleziona senza cercare del testo (`tipo: progetto`) non
    /// ha niente da localizzare, e un provider può rispondere senza pagare la
    /// lettura del sorgente.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub occurrences: Vec<DocPosition>,
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
            occurrences: Vec::new(),
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
    ///
    /// **Le occorrenze invece si sommano**, e la differenza non è
    /// un'incoerenza: è la stessa regola resa dipendente da chi chiede
    /// (decisione 0049). «Un estratto per documento» è vero della riga di una
    /// collezione, che di righe ne disegna una; è falso della ricerca, che di
    /// occorrenze ne mostra N e permette di saltare all'una o all'altra. Le due
    /// cose stanno nello stesso record perché il record è uno, e ognuna segue
    /// la regola del proprio cliente.
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
        for position in other.occurrences {
            if !self.occurrences.contains(&position) {
                self.occurrences.push(position);
            }
        }
        self.occurrences.sort_by_key(|p| (p.span.start, p.span.end));
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

/// Una **bozza**: ciò che l'utente stava scrivendo e non ha salvato (§15.2).
///
/// Porta il testo con sé, e non un puntatore da risolvere con una seconda
/// domanda: la sola ragione per cui questo tipo esiste è che quel testo non
/// vada perso, e un elenco che dice *ci sono tre bozze* senza poterle mostrare
/// avrebbe rimandato l'unica cosa che conta a una chiamata che può fallire.
/// Quante ce ne sono lo governa la paginazione, come per ogni altra risposta.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftInfo {
    /// Di quale documento è. Per una nota mai salvata è il nome che avrebbe.
    pub doc: DocId,
    /// Millisecondi UNIX dell'ultima scrittura della bozza.
    pub at: u64,
    /// La revisione del file su cui il buffer stava lavorando, **quando chi ha
    /// scritto la bozza la sapeva**.
    ///
    /// `None` non vuol dire «nota nuova» — quello lo dice `exists` — vuol dire
    /// *non lo so*: chi tiene un buffer non sempre ha in mano l'impronta del
    /// file da cui è partito, e inventargliela sarebbe peggio che ammetterlo.
    /// La differenza si vede in cosa si può offrire: con una base si può dire
    /// «il file è cambiato sotto», senza si può solo mostrare i due testi.
    pub base: Option<Revision>,
    /// Il documento c'è ancora? Lo dice l'anagrafe (§14.1), che è chi sa cosa
    /// contiene il vault.
    ///
    /// `false` è il caso che questa voce esiste per non nascondere: una nota
    /// cancellata mentre il suo buffer era sporco lascia una bozza **orfana**,
    /// e quella bozza è l'unica copia rimasta di ciò che l'utente aveva
    /// scritto. Buttarla in silenzio sarebbe la perdita che la seduta 20 vieta.
    pub exists: bool,
    /// La revisione del file **adesso**, per quel che il vault ne sa; `None` se
    /// il documento non c'è o se nessuno ne ha ancora letto i byte.
    ///
    /// Sta accanto a `base` perché è il fatto che il chiamante non può
    /// procurarsi da sé, e **non** un giudizio: che `base != current` voglia
    /// dire *tieni il tuo testo* o *tieni quello sul disco* è una domanda da
    /// fare a una persona, non un ramo di un `if` nel kernel.
    pub current: Option<Revision>,
    /// Il testo non salvato.
    pub text: String,
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
        /// Se le righe devono portare l'**estratto** attorno al match (§21.9).
        /// Assente = sì: chi non lo nomina riceve una risposta completa.
        #[serde(default)]
        excerpts: Excerpts,
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
    /// **Questo vault sa quando cambia da fuori?** (§9.7)
    ///
    /// È l'unica variante che non chiede niente *sul contenuto* del vault: chiede
    /// del vault stesso, e la ragione per cui passa da qui invece che da un
    /// comando suo è che i suoi due clienti sono già qui. La shell ha
    /// `query_index`; una feature ha `HostQuery` e null'altro — un comando IPC
    /// nuovo sarebbe stato visibile solo alla prima delle due, cioè un fatto che
    /// il core conosce e i plugin no.
    ///
    /// La domanda che risponde è quella che nessuno faceva: il watcher è
    /// **l'unico** meccanismo con cui Fub viene a sapere che qualcun altro ha
    /// toccato il vault — non c'è una riconciliazione periodica, e niente
    /// confronta mai la cache col disco — e finché nessuno chiedeva se fosse
    /// vivo, un vault senza rilevamento e uno con rilevamento erano
    /// indistinguibili da fuori.
    VaultStatus,
    /// **Cosa sta girando adesso in questo vault?** (§10.3)
    ///
    /// La seconda variante che non chiede del contenuto ma del vault stesso, e
    /// passa da qui per la ragione della [`VaultStatus`](IndexQuery::VaultStatus):
    /// i suoi clienti sono i due che il canale dati ce li ha già — la shell, che
    /// disegna il centro attività, e una feature, che di comandi IPC non ne ha
    /// nessuno.
    ///
    /// È anche la **riconciliazione** di quel centro, ed è la ragione per cui
    /// esiste invece di lasciar contare gli eventi: `job-started` e
    /// `job-progress` si riscoprono chiedendo
    /// ([`Event::is_recoverable`](crate::Event::is_recoverable)), quindi i freni
    /// del canale (decisione 0034) possono buttarli — e chi li butta manda un
    /// `overflow`, che vuol dire *richiedi*. Senza questa domanda quel
    /// troncamento sarebbe una perdita definitiva, cioè un centro attività che
    /// mostra per sempre un lavoro finito.
    Jobs,
    /// **Com'è configurato questo vault?** (§11.1)
    ///
    /// Torna le impostazioni *risolte*: lo schema che qualcuno ha dichiarato, il
    /// valore che vale adesso e da quale livello viene. È la terza variante che
    /// non chiede del contenuto ma del vault stesso, e passa da qui per la
    /// ragione delle altre due — un elenco è **dati**, e i dati hanno un canale
    /// solo (decisione 0013). Un `settings_list` sull'`HostApi` sarebbe stato il
    /// primo caso in cui la shell e un plugin chiedono la stessa cosa a due
    /// porte diverse.
    ///
    /// `plugin` assente = tutte, in ordine di chiave. Con un id, solo quelle
    /// dichiarate da lui: è ciò che serve al pannello di **un** plugin, e ciò
    /// che permette a chi disegna di non filtrare per prefisso — la chiave di
    /// una feature del core non ha un prefisso da confrontare.
    Settings { plugin: Option<String> },
    /// **Com'è organizzato questo vault?** (§11.3)
    ///
    /// Icone, note appuntate, ordinamenti scelti a mano, spazi. Passa da qui e
    /// non da un comando IPC per la ragione delle altre quattro varianti che
    /// chiedono del vault e non del contenuto: un elenco è **dati**, e i dati
    /// hanno un canale solo (decisione 0013). Prima era un comando IPC che
    /// restituiva il blob intero, quindi era una cosa che la shell sapeva
    /// chiedere e un provider no — la stessa asimmetria che il canale dati
    /// esiste per non avere.
    ///
    /// Senza parametri: l'organizzazione di un vault è una, e chi ne vuole un
    /// pezzo lo prende dal record. Non è paginata perché non cresce col vault ma
    /// con **ciò che l'utente ha toccato a mano** — le note che ha appuntato, le
    /// cartelle a cui ha dato un'icona.
    Organization,
    /// **Cosa nomina questo riferimento, adesso?** (§13.1)
    ///
    /// È l'altra metà della decisione 0043: se il path è la chiave per sempre,
    /// allora un riferimento *scritto* — un `[[Wikilink]]`, un `[t](a/b.md)` —
    /// non è una chiave, è un nome che va risolto, e la risoluzione ha regole
    /// (nome più vicino alla radice fra omonimi, alias del frontmatter, path
    /// relativo alla cartella di chi scrive) che vivono nel kernel.
    ///
    /// Finché quelle regole non uscivano di lì, la risposta la sapeva **la sola
    /// shell**, per un comando IPC scritto apposta (`resolve_link`): un fatto
    /// sul vault che il core conosceva e un provider no — la stessa asimmetria
    /// che il canale dati esiste per non avere (decisione 0019). Con questa
    /// variante il comando bespoke sparisce e la domanda ha una porta sola.
    ///
    /// I clienti veri sono tre e nessuno è ipotetico: la navigazione da un
    /// wikilink (la shell, oggi), un comando che riceve il nome di una nota
    /// invece del suo path — [`Args::document`](crate::command::Args::document)
    /// costruisce un [`DocId`] dalla stringa e **non risolve niente** — e i
    /// redirect da note rinominate (FEATURES 7.1), che la 0043 ha dichiarato
    /// essere una feature sopra il kernel: una tabella di alias che ascolta
    /// `DocumentRenamed` esiste già oggi, ciò che le mancava era qualcuno che le
    /// facesse la domanda.
    ///
    /// La risposta è **una o nessuna**, e non è paginata: risolvere non è
    /// cercare. Chi vuole i candidati di una ricerca per nome chiede
    /// [`Documents`](IndexQuery::Documents) con
    /// [`TextField::Name`](crate::query::TextField::Name), che è un'altra
    /// domanda e ha un'altra risposta.
    Resolve {
        /// Il bersaglio, nel vocabolario del modello: è ciò che un
        /// [`FormatProvider`](crate::format::FormatProvider) produce parsando, e
        /// riusarlo evita che il chiamante debba dire *di che specie* è il
        /// riferimento con una convenzione sua.
        ///
        /// [`LinkTarget::Url`] risolve a `None` e non è un errore: la domanda
        /// «questo riferimento è una nota del vault?» ha una risposta anche
        /// quando è no, ed è ciò che permette di passare qui l'esito di
        /// [`LinkTarget::classify`] senza filtrarlo prima.
        target: LinkTarget,
        /// Il documento **dentro cui** il riferimento è scritto. Serve ai
        /// [`LinkTarget::Path`], che sono relativi alla cartella di chi li
        /// ospita; assente = relativi alla radice del vault. Per un
        /// [`LinkTarget::Wiki`] non cambia niente, perché la regola Obsidian non
        /// guarda da dove si sta scrivendo.
        #[serde(default)]
        from: Option<DocId>,
    },
    /// **Cosa c'è nel vault**: l'anagrafe, non l'indice (§14.1, §14.2).
    ///
    /// È la sola domanda del canale che risponde anche su ciò che **non** è un
    /// documento, ed è per questo che è una variante e non un filtro di
    /// [`Documents`](IndexQuery::Documents): là si chiedono note, con
    /// frontmatter e rilevanza; qui si chiede *cosa c'è sul disco*, e la
    /// risposta include un PNG, uno ZIP e un file che nessuno sa cosa sia.
    ///
    /// La ragione per cui esiste è la stessa per cui la
    /// [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md)
    /// ha tenuto `create_folder` **fuori** dalle capacità: un'anagrafe che
    /// contenesse gli allegati senza che nessuna domanda li sappia chiedere
    /// sarebbe uno stato che il kernel tiene e nessuno può vedere. Passa di qui
    /// e non da una capacità nuova perché è **una risposta con dei dati**, e
    /// quelle passano dal canale dati
    /// ([decisione 0019](../../../docs/decisions/0019-il-canale-dati.md)).
    ///
    /// L'ordine è quello dei [`DocId`], come per i documenti e per la stessa
    /// ragione: è ciò che rende stabile una risposta paginata.
    Entries {
        /// Solo una specie, o tutte. `Some(Asset)` è la domanda «quali allegati
        /// ci sono», che è quella che serve a un pannello degli allegati e a
        /// chi cerca gli orfani; `None` è l'anagrafe intera, cioè l'albero dei
        /// file che la shell disegna.
        #[serde(default)]
        of_kind: Option<EntryKind>,
        /// **In quale cartella** (§14.4). Assente = tutto il vault, che è
        /// com'era prima che questo campo esistesse.
        ///
        /// È la metà che mancava al canale della lista: un albero disegna venti
        /// righe e ne chiedeva diecimila, perché l'unica domanda possibile era
        /// «tutto». Con `descendants: false` la risposta cresce con **la
        /// cartella aperta** e non col vault, e la finestra si applica dopo il
        /// filtro — cioè la pagina è una pagina di quella cartella.
        #[serde(default)]
        within: Option<FolderScope>,
        #[serde(default)]
        page: Option<Page>,
    },
    /// **Quali cartelle ci sono** (§14.3).
    ///
    /// Una variante sua e non una specie in più di
    /// [`Entries`](IndexQuery::Entries): una cartella non ha dimensione, non ha
    /// un contenuto da datare e non ha un'impronta, e infilarla in un
    /// [`VaultEntry`] avrebbe voluto dire tre campi che mentono e un filtro da
    /// ricordarsi in ogni cliente dell'anagrafe. Sono due domande, e chi
    /// disegna un livello di albero le fa tutte e due.
    ///
    /// Le cartelle escono dalla **camminata del disco**, non dai path dei file:
    /// una cartella vuota c'è, e resta lì quando la sua ultima nota va nel
    /// cestino — che è ciò che è successo davvero sul disco.
    Folders {
        /// Da dove guardare. Assente = ogni cartella del vault, a ogni
        /// profondità (l'elenco che serve a chi ne offre una da scegliere);
        /// [`FolderScope::direct`] = un livello solo, che è ciò che apre un nodo
        /// dell'albero.
        #[serde(default)]
        under: Option<FolderScope>,
        #[serde(default)]
        page: Option<Page>,
    },
    // In **coda** e non accanto a `VaultHealth`, che pure è la sua vicina di
    // senso: l'ordine dei casi è il discriminante dell'ABI, quindi una variante
    // inserita in mezzo rinumera tutte quelle che vengono dopo. Additiva vuol
    // dire in fondo — è la stessa disciplina delle righe che si appendono a un
    // registro, applicata a un enum.
    /// **Cosa è rimasto non salvato** (§15.2): le bozze che il buffer di crash
    /// ha lasciato sul disco.
    ///
    /// Passa da qui e non da un comando IPC suo per la ragione di `Watching`
    /// più sopra — i clienti sono già qui — e per una che è di questa variante
    /// soltanto: **leggere non è cambiare**
    /// ([0085](../../../docs/decisions/0085-leggere-non-e-cambiare.md)), e
    /// ritrovare ciò che si stava scrivendo è la lettura più innocua che ci
    /// sia. È chi decide *cosa farne* a mutare qualcosa, e quello è un comando.
    Drafts {
        #[serde(default)]
        page: Option<Page>,
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
            | IndexQuery::VaultHealth { page, .. }
            | IndexQuery::Drafts { page }
            | IndexQuery::Entries { page, .. }
            | IndexQuery::Folders { page, .. } => *page,
            IndexQuery::Outline { .. }
            | IndexQuery::Custom { .. }
            | IndexQuery::VaultStatus
            | IndexQuery::Jobs
            | IndexQuery::Settings { .. }
            | IndexQuery::Organization
            | IndexQuery::Resolve { .. } => None,
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
            | IndexQuery::Drafts { .. }
            | IndexQuery::Custom { .. }
            | IndexQuery::VaultStatus
            | IndexQuery::Jobs
            | IndexQuery::Settings { .. }
            | IndexQuery::Organization
            | IndexQuery::Resolve { .. }
            // L'anagrafe non seleziona documenti: la sua domanda non è «quali
            // note combaciano» ma «cosa c'è», e un'espressione qui vorrebbe
            // dire filtrare dei file con un linguaggio che parla di note. Vale
            // anche per le cartelle, che una nota non lo sono affatto.
            | IndexQuery::Entries { .. }
            | IndexQuery::Folders { .. } => None,
        }
    }

    /// Rimpiazza l'espressione con una già risolta (`Docs { … }`), lasciando
    /// tutto il resto com'era.
    pub fn with_expression(self, resolved: QueryExpr) -> IndexQuery {
        match self {
            IndexQuery::Documents {
                sort,
                select,
                page,
                excerpts,
                ..
            } => IndexQuery::Documents {
                matching: resolved,
                sort,
                select,
                page,
                excerpts,
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
            IndexQuery::Drafts { .. } => QueryKind::Drafts,
            IndexQuery::Custom { ns, .. } => QueryKind::Custom(ns.clone()),
            IndexQuery::VaultStatus => QueryKind::VaultStatus,
            IndexQuery::Jobs => QueryKind::Jobs,
            IndexQuery::Settings { .. } => QueryKind::Settings,
            IndexQuery::Organization => QueryKind::Organization,
            IndexQuery::Resolve { .. } => QueryKind::Resolve,
            IndexQuery::Entries { .. } => QueryKind::Entries,
            IndexQuery::Folders { .. } => QueryKind::Folders,
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
    /// Chi risponde a «questo vault sa quando cambia da fuori?» (§9.7). Il
    /// proprietario è il kernel, e non è un'ovvietà del codice: è l'unico che
    /// conosce sia l'esito delle sincronizzazioni sia il fatto — passatogli da
    /// chi monta — che un rilevatore ci sia.
    VaultStatus,
    /// Chi risponde a «cosa sta girando adesso?» (§10.3). Il proprietario è di
    /// nuovo il kernel, e di nuovo non per abitudine: la coda dei job è sua
    /// (`spawn_job` conta gli id, `complete_job` chiude), e chi possiede i
    /// thread — che pure sa quali sono partiti — non sa niente di quelli che
    /// devono ancora entrargli in mano.
    Jobs,
    /// Chi risponde a «com'è configurato questo vault?» (§11.1). Il
    /// proprietario è ancora il kernel, e stavolta per un motivo che si vede a
    /// occhio: lo schema lo tiene il registro dei plugin, il valore lo tiene lo
    /// store di configurazione, e sono due cose che stanno nello stesso posto
    /// solo lì.
    Settings,
    /// Chi risponde a «com'è organizzato questo vault?» (§11.3). Il proprietario
    /// è il kernel, e stavolta è una **conquista** e non una constatazione:
    /// finché il sidecar lo leggevano due funzioni dell'host con `std::fs`,
    /// questa domanda non aveva un proprietario affatto — la sapeva fare la
    /// shell, e nessun altro.
    Organization,
    /// Chi risponde a «cosa nomina questo riferimento?» (§13.1). Il proprietario
    /// è il kernel perché la risoluzione è una funzione del **grafo**, che è
    /// suo: gli omonimi si dirimono per distanza dalla radice e gli alias
    /// stanno in un indice che solo lui tiene.
    ///
    /// Che sia una famiglia con un padrone solo — e quindi che un plugin di
    /// redirect **non** possa scavalcarla — è deliberato: chi risolvesse al
    /// posto del kernel deciderebbe anche dove puntano i link nel grafo, cioè
    /// riscriverebbe l'anagrafe del vault dal di fuori. Un redirect è ciò che si
    /// dice quando la risposta è `None`, e vive accanto a questa domanda, non al
    /// suo posto.
    Resolve,
    /// Chi risponde a «cosa c'è in questo vault?» (§14.1, §14.2). Il
    /// proprietario è il kernel, e stavolta per esclusione: l'anagrafe la
    /// costruisce chi cammina il disco, e nessun altro cammina il disco.
    ///
    /// Un indice di terzi può **sostituirla** come ogni altra famiglia — un
    /// giorno, un indice che tiene il proprio elenco su un supporto remoto —
    /// ma chi lo fa si prende anche il resto: la scansione, il rilevamento e la
    /// tabella che il kernel scrive sono la sua fonte, non la sua copia.
    Entries,
    /// Chi risponde a «quali cartelle ci sono?» (§14.3). Il kernel, e per la
    /// ragione di [`Entries`](QueryKind::Entries): una cartella la vede chi
    /// cammina il disco. Le due famiglie restano **due**, così che un indice
    /// che sappia elencare i file di un supporto remoto possa rivendicare la
    /// prima senza doversi inventare la seconda.
    Folders,
    /// Ciò che è rimasto non salvato (§15.2). In coda come nell'[`IndexQuery`],
    /// e per la stessa ragione: l'ordine è il discriminante.
    Drafts,
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

/// Che rapporto ha questo vault con il disco (risposta a
/// [`IndexQuery::VaultStatus`], §9.7).
///
/// I tre campi sono tre domande diverse, e tenerle separate è il punto:
/// «Fub **saprebbe** che il vault è cambiato», «**è già** successo qualcosa
/// che non ha saputo leggere», e «cosa». Un booleano solo avrebbe confuso un
/// vault senza rilevamento — dove il rischio è noto e permanente — con un vault
/// che il rilevamento ce l'ha e ha appena mancato un file, che è un incidente.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultStatus {
    /// `false` = **nessuno vede le scritture altrui**. Non è una condizione di
    /// nicchia: non c'è su network share e cloud drive, sui vault sincronizzati
    /// con strumenti esterni, oltre il limite di inotify su vault grandi, e non
    /// esisterà affatto su CLI, PWA e mobile.
    pub watching: bool,
    /// Quante sincronizzazioni per-path sono fallite da quando il vault è
    /// aperto. Erano `let _ =`: un file esterno che non si legge o non si parsa
    /// lasciava la cache, il grafo e l'indice fermi a **prima**, per sempre,
    /// senza che niente lo dicesse.
    pub sync_failures: u32,
    /// L'ultimo di quei fallimenti, già composto. È un messaggio e non un
    /// codice, e va con il §12.2: quando l'errore al confine avrà una forma,
    /// l'avrà anche questo.
    pub last_sync_error: Option<String>,
    /// **A che punto è l'indicizzazione** dell'apertura (§15.7).
    pub indexing: IndexingState,
}

/// **Se ciò che l'indice risponde è tutto** (§15.7).
///
/// Un vault si apre in due tempi: appena scansionato è utilizzabile — le note
/// ci sono, si aprono, si scrivono — e la ricerca si popola dopo. Chi disegna
/// un risultato deve poter dire «sto ancora indicizzando» invece di mostrare
/// *niente trovato*, che nei primi secondi di un vault grande sarebbe una
/// risposta falsa e indistinguibile da quella vera.
///
/// **Non porta numeri**, ed è deliberato: a che punto è lo racconta il job
/// `vault.index` come qualunque altro lavoro lungo
/// ([`JobStatus::progress`], §10.3). Un `done`/`total` anche qui sarebbe una
/// seconda sorgente per la stessa barra, e le due divergerebbero il giorno che
/// una delle due si aggiorna e l'altra no.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexingState {
    /// L'indicizzazione sta camminando.
    Running,
    /// È arrivata in fondo: l'indice sa tutto ciò che c'è da sapere.
    ///
    /// È il **default** perché è lo stato di un vault che non ha niente da
    /// indicizzare, ed è la risposta giusta per ogni host che serve questa
    /// struttura senza avere un'apertura in corso.
    #[default]
    Ready,
    /// È stata interrotta — dal pulsante, o da un vault che chiude. Ciò che c'è
    /// è buono, ciò che manca non ha un nome, e si rifà riaprendo.
    Stopped,
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
    /// Il rapporto fra questo vault e il disco (risposta a
    /// [`IndexQuery::VaultStatus`]).
    VaultStatus(VaultStatus),
    /// I lavori lunghi vivi (risposta a [`IndexQuery::Jobs`]), in ordine di
    /// [`JobId`] — cioè di richiesta.
    ///
    /// Senza finestra, come l'outline e per la stessa ragione: non cresce col
    /// vault. Cresce con quanti job ci sono insieme, che è un numero piccolo per
    /// costruzione — i thread che li eseguono sono due.
    Jobs(Vec<JobStatus>),
    /// Le impostazioni risolte (risposta a [`IndexQuery::Settings`]), in ordine
    /// di chiave.
    ///
    /// Senza finestra come le due sopra: un'impostazione la dichiara qualcuno
    /// che l'ha scritta a mano, quindi il loro numero cresce con i plugin
    /// montati e non col vault. Il giorno che un plugin ne dichiarasse mille,
    /// il problema non sarebbe la finestra.
    Settings(Vec<SettingEntry>),
    /// L'organizzazione del vault (risposta a [`IndexQuery::Organization`]):
    /// icone, appuntate, ordinamenti, spazi.
    ///
    /// Un record e non una lista, perché è **una** cosa e non un elenco: chi la
    /// chiede la disegna intera (la sidebar) o ne guarda un campo.
    Organization(Organization),
    /// Cosa nomina un riferimento, o niente (risposta a
    /// [`IndexQuery::Resolve`]).
    ///
    /// `None` non è un errore ed è metà del valore di questa risposta: un
    /// link rotto, un `Url` verso il mondo esterno e una nota rinominata via da
    /// sotto danno tutti e tre `None`, e chi ha chiesto sa che deve proporre
    /// qualcos'altro — creare la nota (§21.7), seguire un redirect, aprire il
    /// browser. Distinguerli qui vorrebbe dire mettere nella risposta di una
    /// domanda sull'anagrafe le ragioni di chi non c'è, che sono di chi
    /// chiede.
    ///
    /// Il payload è un [`ResolvedRef`] e non un [`DocId`] nudo dalla decisione
    /// 0049: `[[Nota#Sezione]]` e `[[Nota#^blocco]]` **portano** un punto — il
    /// modello lo parsa dalla 0003 — e una risposta che sa dire solo *quale
    /// documento* costringeva chi risolve a scartarlo, che è ciò che tutti e
    /// cinque i punti del kernel facevano. È un **ritaglio** della linea di
    /// base, non un'aggiunta: la variante c'era già, e affiancargliene una
    /// seconda avrebbe lasciato per sempre due casi che rispondono alla stessa
    /// domanda, con chi legge a doversi ricordare quale guardare
    /// (`docs/architecture/wit-congelato.md`, tabella dei ritagli).
    Resolved(Option<ResolvedRef>),
    /// Cosa c'è nel vault (risposta a [`IndexQuery::Entries`]), in ordine di
    /// [`DocId`].
    ///
    /// **A finestra**, e qui più che altrove: è l'unica risposta che cresce col
    /// numero di *file* invece che col numero di note, e in un vault vero gli
    /// allegati sono più delle note.
    Entries(Paged<VaultEntry>),
    /// Le cartelle (risposta a [`IndexQuery::Folders`]), in ordine di path.
    ///
    /// A finestra come l'anagrafe: chieste `under` una cartella sono poche, ma
    /// chieste su tutto il vault sono tante quante le cartelle — e chi ne offre
    /// un elenco da scegliere non deve trasferirle tutte per mostrarne dieci.
    Folders(Paged<VaultFolder>),
    /// Ciò che era rimasto non salvato (risposta a [`IndexQuery::Drafts`]). In
    /// coda come la sua domanda, e per la stessa ragione: l'ordine dei casi è
    /// il discriminante dell'ABI.
    Drafts(Paged<DraftInfo>),
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
            other => Err(PluginError::Internal(
                format!(
                    "risposta fuori tema: attesi dei documenti, arrivato {}",
                    other.kind_name()
                )
                .into(),
            )),
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
            IndexResult::VaultStatus(_) => "vault-status",
            IndexResult::Jobs(_) => "jobs",
            IndexResult::Settings(_) => "settings",
            IndexResult::Organization(_) => "organization",
            IndexResult::Resolved(_) => "resolved",
            IndexResult::Entries(_) => "entries",
            IndexResult::Folders(_) => "folders",
            IndexResult::Drafts(_) => "drafts",
        }
    }
}

/// **Su questa identità, l'indice adesso mente** (§20.1, decisione 0051).
///
/// È ciò che i tre metodi dell'alimentazione restituiscono, ed è un dato e non
/// un errore: non dice «la chiamata è fallita», dice *quale documento* è rimasto
/// fuori. La differenza è tutta la voce — un indice che perdeva un documento non
/// aveva un valore di ritorno con cui dirlo, e «l'indice ha perso qualcosa»
/// senza un [`DocId`] non fa agire nessuno.
///
/// Il significato è uno solo, letto dal verso di ognuno dei tre metodi:
///
/// - dopo un [`on_documents_indexed`](IndexProvider::on_documents_indexed):
///   questo documento **non c'è**, e chi cerca non lo troverà;
/// - dopo un [`on_documents_removed`](IndexProvider::on_documents_removed):
///   questo documento **c'è ancora**, e chi cerca lo troverà pur essendo sparito
///   dal vault;
/// - dopo un [`reconcile`](IndexProvider::reconcile): questo documento è morto
///   ad app chiusa e l'indice non è riuscito a dimenticarlo.
///
/// In tutti e tre i casi, ciò che l'indice risponde su quell'identità non
/// corrisponde più al vault, e chi ha un canale per dirlo lo dice (§20.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IndexLoss {
    /// Il documento su cui l'indice non è più allineato. Nominarlo è l'intero
    /// scopo di questo tipo: è ciò che un esito cumulativo — «il flush è
    /// fallito» — non sa dire, e senza cui nessuno può né ritentare né mostrare
    /// niente di utile.
    pub id: DocId,
    /// Perché, nella forma con cui ogni fallimento arriva a chi disegna: un
    /// [`Text`](crate::text::Text) dentro un [`PluginError`], quindi
    /// traducibile da chi lo mostra (decisione 0041).
    pub why: PluginError,
}

impl IndexLoss {
    /// La perdita di un documento, con la ragione già composta.
    pub fn new(id: DocId, why: PluginError) -> Self {
        IndexLoss { id, why }
    }
}

/// Un indice derivato dal contenuto del vault.
///
/// Il kernel lo alimenta **direttamente** (non via event bus): ogni documento
/// che entra o esce dal `Workspace` passa da `on_documents_indexed` /
/// `on_documents_removed` dentro la stessa operazione che aggiorna il grafo.
/// Un indice non può quindi perdere aggiornamenti per un troncamento della
/// coda eventi ([`Event::Overflow`](crate::Event::Overflow)) — è la ragione
/// per cui l'alimentazione non passa da [`EventHandler`].
///
/// Resta un solo modo di divergere dal vault: ciò che succede mentre l'indice
/// **non è vivo** (documenti cancellati ad app chiusa, se l'indice è
/// persistente). Lo chiude [`IndexProvider::reconcile`].
///
/// # L'alimentazione ha un esito, ed è a lotti (§20.1, decisione 0051)
///
/// I tre metodi che portano il dato restituivano `()` mentre `activate` e
/// `flush` restituivano un `Result`: il ciclo di vita poteva fallire e dirlo,
/// l'alimentazione no. E il canale che il [`PIANO`](../../../docs/PIANO.md)
/// dichiarava incapace di perdere pezzi — *«un indice che perde un aggiornamento
/// non tace: risponde sbagliato, in silenzio»* — manteneva la promessa a metà:
/// il **canale** non tronca, ma il **destinatario** può rifiutare, e la firma
/// rendeva quel rifiuto indicibile.
///
/// Le due domande erano due — *che forma ha l'esito* e *qual è la grana* — e
/// hanno una risposta sola, che è la ragione per cui sono state decise insieme:
/// un esito **per lotto** dice *quale* documento (cosa che un esito cumulativo
/// raccolto dal `flush` non sa fare) e costa **un attraversamento del confine
/// per lotto** invece che per documento, con lo stesso campo. A M5 ogni
/// chiamata è una serializzazione, e un `reindex` da 100k note con la firma di
/// prima erano 100k attraversamenti per indice.
///
/// Ciò che il lotto **non** riduce è il volume: quei modelli passano comunque,
/// e per intero. Riduce il numero di volte in cui si attraversa, che è l'unica
/// metà del costo su cui una firma possa qualcosa.
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
/// - `on_documents_*` e `reconcile` sono **mutazioni in memoria**: fra un
///   `on_documents_*` e il `flush` il provider accumula (è già il contratto di
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

    /// **Prendi questi documenti**, e di' quali non hai preso.
    ///
    /// I tre metodi dell'alimentazione — questo, `on_documents_removed` e
    /// `reconcile` — sono a **lotto** e restituiscono un esito; erano per
    /// documento e restituivano `()`, ed è il ritaglio della
    /// [decisione 0051](../../../docs/decisions/0051-l-alimentazione-risponde.md).
    /// Vedi [`IndexLoss`] per cosa vuol dire nominare una perdita, e il doc del
    /// trait per perché la grana e l'esito sono la stessa domanda.
    ///
    /// # Un lotto non è una transazione
    ///
    /// È la stessa frase della [decisione 0011](../../../docs/decisions/0011-il-lotto.md),
    /// e vale nello stesso senso: un lotto **accettato a metà è la norma**, non
    /// un errore. Ciò che si elenca è perduto, ciò che non si elenca è preso, e
    /// non c'è niente da annullare — il chiamante non ritenta il lotto e non
    /// butta via il resto. Un elenco vuoto vuol dire che è andato tutto bene,
    /// ed è ciò che restituisce chi non ha niente da dire.
    ///
    /// Chi fallisce **in blocco** — il writer è andato, l'indice non è più
    /// affidabile — elenca tutto ciò che gli è stato dato. Costa una riga e
    /// dice la verità: quel documento, in quell'indice, adesso non c'è.
    ///
    /// # Chi taglia il lotto
    ///
    /// Il kernel, che è l'unico a sapere quanti modelli ha in mano. Un indice
    /// non può quindi dedurre niente dalla **dimensione** di ciò che riceve: un
    /// lotto di uno non vuol dire «una scrittura singola» e un lotto pieno non
    /// vuol dire «apertura del vault». Ciò che si può dedurre da un lotto è una
    /// cosa sola, e basta: questi documenti sono arrivati insieme, quindi si
    /// possono scrivere insieme.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss>;

    /// **Togli questi documenti**, e di' quali non hai tolto.
    ///
    /// Il gemello di [`on_documents_indexed`](IndexProvider::on_documents_indexed),
    /// e l'esito ha lo stesso significato letto dall'altro verso: un id
    /// elencato qui è un documento che **c'è ancora** in un indice da cui il
    /// vault l'ha tolto. È la bugia opposta e la più visibile delle due — chi
    /// cerca trova una nota che non esiste e la apre.
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;

    /// Allinea l'indice alla verità completa del vault: `ids` è l'insieme di
    /// **tutti** i documenti esistenti, e ciò che l'indice ha in più è morto e
    /// va cancellato. Il kernel la chiama dopo la scansione del vault.
    ///
    /// Non è un rebuild: i documenti già presenti e immutati non vanno
    /// reindicizzati (è ciò che rende rapida la riapertura di un vault).
    ///
    /// L'esito è l'unico dei tre che nomina identità **che il chiamante non ha
    /// mandato**: ciò che non si è potuto cancellare è per definizione fuori da
    /// `ids`. Il significato però è lo stesso di sempre — su questa identità
    /// l'indice adesso mente — ed è la ragione per cui il tipo è lo stesso.
    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;
    /// Punto di consistenza **e di persistenza**: al ritorno, tutto ciò che è
    /// stato accettato finora è visibile alle `query` e durevole.
    ///
    /// Esiste perché il kernel scrive **un documento alla volta** ma un
    /// indice vuole scrivere **a lotti**: fra un `on_documents_*` e il `flush`
    /// il provider è libero di accumulare. Chi interroga senza aspettare un
    /// flush vede comunque le proprie scritture — è il provider a garantirlo,
    /// non il chiamante.
    ///
    /// È l'unico punto in cui un indice scrive, e per questo riceve l'host:
    /// ciò che deve sopravvivere alla chiusura passa da `data_*`.
    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;

    /// **L'ultima chiamata**: l'indice sta per smettere, e questo è il punto in
    /// cui lascia andare ciò che tiene — segmenti mmappati, lock file, thread di
    /// merge, handle aperti. Il gemello di
    /// [`activate`](IndexProvider::activate), che è la prima.
    ///
    /// Il kernel chiama [`flush`](IndexProvider::flush) e **poi** questa: chi
    /// arriva qui ha già avuto il proprio punto di persistenza, e l'host lo
    /// riceve lo stesso perché una chiusura può avere qualcosa di suo da
    /// scrivere (un marcatore di spegnimento pulito, che alla riapertura
    /// distingue «chiuso bene» da «il processo è morto»).
    ///
    /// Non ha un corpo di default, ed è la scelta che la decisione 0028 ha preso
    /// invece di rimandarla: un indice che tiene un lock file e non ha un punto
    /// dove rilasciarlo lo rilascia quando il processo muore, cioè mai — e un
    /// default no-op avrebbe fatto sembrare quel caso normale. Costa una riga a
    /// chi non ha niente da chiudere (`Ok(())`) e la scrive sapendo di non
    /// averne.
    ///
    /// # Perché non basta il `Drop`
    ///
    /// Perché un `Drop` non ha l'`HostApi`: ciò che un indice rende durevole
    /// passa da `data_*`, e un provider che persistesse mentre viene distrutto
    /// dovrebbe usare `std::fs` — cioè uscire dal proprio recinto — o non
    /// persistere affatto. E a M5 non c'è nemmeno il `Drop`: un componente WASM
    /// che l'host smonta non esegue **niente** al proprio smontaggio, quindi
    /// senza questa funzione un indice di terzi non avrebbe alcun modo di
    /// chiudersi bene. Il `Drop` nativo resta, e resta la rete: qui c'è la
    /// chiusura *ordinata*, quella che può ancora parlare.
    ///
    /// Dopo `close` l'indice non riceve più niente — né alimentazione, né
    /// `flush`, né `query`. L'errore non è fatale per chi chiama: chi smette
    /// smette comunque, e ciò che è andato storto torna a chi ha un canale per
    /// dirlo.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;

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
    /// (`fub_features::SearchIndex`, presidio
    /// `due_ricerche_stanno_nell_indice_insieme`), e lo fa perché per un anno
    /// non lo faceva senza che si vedesse.
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;

    /// **Di queste voci, quali hai già così come sono?** Il kernel la chiama
    /// durante la scansione, prima di leggere e parsare (§14.2).
    ///
    /// È la domanda che mancava, e la sua assenza costava una riapertura intera:
    /// il kernel leggeva e parsava **tutto** il vault a ogni apertura *prima
    /// ancora di chiedere all'indice se gli interessava*, e l'indice —
    /// persistente, con tutto già dentro — si limitava a riscrivere ciò che
    /// aveva. La promessa scritta in [`reconcile`](IndexProvider::reconcile) («i
    /// documenti immutati non vanno reindicizzati») era vera per chi indicizza e
    /// falsa per chi alimenta.
    ///
    /// # Cosa arriva, e su cosa si risponde
    ///
    /// Le [`VaultEntry`] dei soli documenti, con dimensione, data e — quando il
    /// kernel ce l'ha — l'impronta del contenuto. Un indice risponde con gli id
    /// che ha già **durevolmente** e nella stessa versione: dopo un `git
    /// checkout` che ha ritimbrato mille file senza cambiarne uno, chi tiene
    /// l'impronta li riconosce tutti e mille.
    ///
    /// # Il default dice di no, ed è la risposta giusta
    ///
    /// Un elenco vuoto significa «mandami tutto», cioè il comportamento di
    /// prima. È deliberato che sia quello che si ottiene **non pensandoci**: un
    /// indice che rispondesse di sì per sbaglio resterebbe indietro in silenzio,
    /// e un indice che dice di no paga una reindicizzazione che non serviva.
    /// Sbagliare da questa parte costa tempo; dall'altra costa un indice che
    /// mente.
    ///
    /// Chi risponde deve dire la verità su **ciò che è durevole**, non su ciò
    /// che ha in memoria: chi ha appena buttato il proprio stato perché la
    /// versione dello schema non combaciava non ha niente, e dirlo è l'unica
    /// cosa che gli impedisce di restare vuoto per sempre.
    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
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
            // Le impostazioni (§11.1): c'è perché ha un cliente vero — i comandi
            // `settings.*` di `CoreCommands` — e non per completezza. Concederlo
            // qui non apre niente di per sé: il secondo cancello è **la
            // chiave**, e una chiave che non si è dichiarata scrivibile da un
            // programma resta chiusa anche a chi ha questo permesso.
            crate::options::permission::WRITE_SETTINGS,
            // La sessione (§23.5): entrambi, e con due clienti distinti che è
            // ciò che li giustifica. `read-session` da solo basta all'indice
            // della nota (`fub.outline` segna la sezione del cursore) e ai
            // backlink; `read-selection` lo vuole chi conta le parole di ciò
            // che è selezionato e chi ci costruisce sopra un wikilink.
            crate::options::permission::READ_SESSION,
            crate::options::permission::READ_SELECTION,
        ])
    }
}

/// La versione del contratto che QUESTO abi definisce. È la stessa del
/// `package fub:abi@…` nel WIT (il test di conformità le confronta).
pub const ABI_VERSION: &str = "0.1.0";

// Niente `Eq`: i permessi portano un parametro JSON, e `serde_json::Value` non
// è `Eq` (contiene numeri in virgola mobile). È lo stesso motivo per cui
// `Block::Custom` si ferma a `PartialEq`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// La versione del contratto (`fub:abi@X.Y.Z`) contro cui il plugin è
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
    /// Le **impostazioni che dichiara** (§11.1): chiave, specie, default,
    /// etichetta, gruppo.
    ///
    /// Sta qui e non in un `SettingsProvider` da registrare per la stessa
    /// ragione di `provides`, un passo più in là: la dichiarazione viene prima
    /// di [`Plugin::activate`], e il primo che legge un'impostazione è proprio
    /// un `activate` che deve sapere se la sua feature è accesa. Uno schema
    /// registrato dopo sarebbe uno schema assente nel momento in cui serve.
    ///
    /// Ogni chiave vale la regola del §7.4 come i nomi dei servizi: il core
    /// nomina nudo (`versioning.enabled`), un plugin dentro il proprio id.
    #[serde(default)]
    pub settings: Vec<SettingSpec>,
    /// Le **stringhe che dichiara** (§12.1), una voce per lingua.
    ///
    /// Sta nel manifest per le stesse due ragioni di `settings`, più una terza
    /// che è solo delle stringhe. Le prime due: si legge **prima** di montare —
    /// una palette di comandi mostra i titoli di componenti che nessuno ha
    /// ancora attivato — e un catalogo registrato da
    /// [`Plugin::activate`](crate::traits::Plugin::activate) sarebbe assente
    /// esattamente quando serve. La terza: un catalogo è **dato**, e dato nel
    /// manifest vuol dire che si corregge una traduzione senza ricompilare, e
    /// che a M5 un componente WASM non se lo scrive a build time.
    ///
    /// Le chiavi qui dentro sono **nude**, e questa è la differenza deliberata
    /// dalle chiavi delle impostazioni: quelle vivono in un archivio solo e
    /// devono quindi qualificarsi col nome di chi le dichiara
    /// (`versioning.enabled`); un catalogo appartiene a un componente e basta,
    /// quindi la qualifica è **strutturale** — un plugin non ha nemmeno il modo
    /// di nominare la stringa di un altro.
    #[serde(default)]
    pub strings: Vec<StringCatalog>,
    /// La lingua in cui questo componente è scritto: il penultimo gradino della
    /// scala di [`Strings`](crate::text::Strings), quello che si usa quando la
    /// lingua di chi guarda non ha catalogo.
    ///
    /// Vuoto = nessun ripiego, e si scende dritti alla chiave nuda. È il
    /// default corretto per chi non dichiara stringhe.
    #[serde(default)]
    pub default_locale: String,
    /// Le **sveglie** che dichiara (§22.1, decisione 0069): un nome e ogni
    /// quanto suona.
    ///
    /// Sta nel manifest per la ragione di `settings`, letta su un asse
    /// diverso. Là la dichiarazione doveva precedere
    /// [`Plugin::activate`](crate::traits::Plugin::activate) perché il primo
    /// lettore di un'impostazione è proprio un `activate`; qui perché una
    /// sveglia è ciò che **fa succedere** un evento, non ciò che ne filtra uno.
    /// Una [`EventMask`](crate::event::EventMask) è il posto sbagliato per
    /// definizione: si applica agli eventi che accadono, e un timer che nessuno
    /// ha fatto partire non ne genera nessuno da filtrare — è la ragione per cui
    /// il tentativo ritirato dalla decisione 0063 non trovava un valutatore.
    ///
    /// Ogni nome è **nudo** e vale dentro il componente, come le chiavi di un
    /// catalogo di stringhe: la qualifica è strutturale, ed è
    /// [`Event::TimerFired::owner`](crate::event::Event::TimerFired) a dire di
    /// chi è.
    #[serde(default)]
    pub timers: Vec<TimerSpec>,
}

/// Una sveglia dichiarata da un componente (§22.1, decisione 0069).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimerSpec {
    /// Il nome, nudo: viaggia in
    /// [`Event::TimerFired::timer`](crate::event::Event::TimerFired) e serve a
    /// chi ha dichiarato più di una sveglia per distinguerle.
    pub id: String,
    pub schedule: TimerSchedule,
}

/// Ogni quanto suona una sveglia (§22.1, decisione 0069; §22.4, decisione 0091).
///
/// **Due famiglie, e la differenza non è di comodo.** `Every` e `After` si
/// misurano in *tempo trascorso*: la loro regola è pura e sta tutta in
/// [`nth_after`](TimerSchedule::nth_after), che non ha bisogno di sapere che ore
/// sono. `AtWallClock` si misura in *ora civile*: quanti secondi manchino alle
/// nove dipende da che ore sono adesso, e nessuna funzione che non lo riceva lo
/// può calcolare. La regola di questa seconda famiglia esiste lo stesso e sta
/// lo stesso nel contratto — è [`WallClock::next_after`], che riceve l'ora
/// civile invece di leggerla — e per questo `nth_after` risponde `None` a un
/// orario di parete: non è «non suona più», è *questa non è la sua regola*, e il
/// suo doc lo dice.
///
/// Il caso nuovo è **in coda**, e non «dove starebbe meglio»: l'ordine dei casi
/// è il discriminante dell'ABI
/// ([0088](../../../docs/decisions/0088-cio-che-non-e-ancora-successo.md)),
/// quindi additivo vuol dire in fondo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimerSchedule {
    /// Suona ogni `seconds` secondi, per sempre, a partire dalla
    /// registrazione del componente.
    Every { seconds: u64 },
    /// Suona **una volta sola**, `seconds` secondi dopo la registrazione.
    After { seconds: u64 },
    /// Suona a un **orario di parete** (§22.4, decisione 0091): «ogni giorno
    /// alle 9», «il lunedì alle 7:30».
    AtWallClock(WallClock),
}

impl TimerSchedule {
    /// Fra quanti secondi dalla registrazione suona la `n`-esima volta
    /// (`n` a partire da 0)? `None` = non suona più.
    ///
    /// È la regola della famiglia che si misura in **tempo trascorso**, e sta
    /// nel contratto perché chi implementa lo scheduler la applichi invece di
    /// avere la propria idea di cosa voglia dire «ogni ora», che è il modo in
    /// cui due host finirebbero per suonare in due momenti diversi.
    ///
    /// **Per un [`AtWallClock`](TimerSchedule::AtWallClock) risponde `None`, e
    /// non vuol dire che non suona.** Vuol dire che la sua regola è un'altra —
    /// [`WallClock::next_after`] — perché di questa firma manca l'ingrediente:
    /// quanti secondi manchino alle nove non è una funzione di *quante volte ha
    /// già suonato*, è una funzione di *che ore sono adesso*. Chi implementa uno
    /// scheduler distingue le due famiglie con
    /// [`wall_clock`](TimerSchedule::wall_clock), che è la domanda fatta apposta
    /// per non doverlo dedurre da un `None`.
    pub fn nth_after(&self, n: u64) -> Option<u64> {
        match *self {
            TimerSchedule::Every { seconds } => seconds.max(1).checked_mul(n.checked_add(1)?),
            TimerSchedule::After { seconds } if n == 0 => Some(seconds),
            TimerSchedule::After { .. } => None,
            TimerSchedule::AtWallClock(_) => None,
        }
    }

    /// L'orario di parete, se è di quella famiglia.
    ///
    /// Esiste perché uno scheduler non debba distinguere le due famiglie da un
    /// `None` di [`nth_after`](TimerSchedule::nth_after): un `None` è già la
    /// risposta di un `After` che ha finito, e due significati sullo stesso
    /// valore sono il modo in cui una sveglia smette di suonare senza che
    /// nessuno abbia scritto una riga sbagliata.
    pub fn wall_clock(&self) -> Option<&WallClock> {
        match self {
            TimerSchedule::AtWallClock(w) => Some(w),
            _ => None,
        }
    }
}

/// Una sveglia a **orario di parete** (§22.4, decisione 0091).
///
/// «Ogni giorno alle 9» non è «ogni 86400 secondi»: l'una segue il calendario di
/// chi la legge — e quindi il suo fuso e la sua ora legale — l'altra no.
///
/// **L'orario è in due interi e non in una stringa `"09:00"`**: una stringa
/// vuole un parser al confine, e con lui un modo di fallire che nessuno sa dove
/// mettere — un manifest si legge quando il componente si registra, e «l'orario
/// non si capisce» diventerebbe un errore di registrazione per un campo che
/// avrebbe potuto non essere sbagliabile. Due interi si controllano dove si
/// leggono.
///
/// **Un caso solo per «ogni giorno» e «il lunedì»**, con [`days`](Self::days)
/// vuoto a dire *ogni giorno*: un `Daily` e un `Weekly` separati sarebbero due
/// casi del `variant` con la stessa aritmetica dentro, e il secondo si
/// distinguerebbe dal primo solo per un campo in più.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WallClock {
    /// L'ora, `0..=23`. Fuori scala la sveglia non suona: vedi
    /// [`valid`](Self::valid).
    pub hour: u8,
    /// I minuti, `0..=59`.
    pub minute: u8,
    /// In che giorni. **Vuoto = ogni giorno.**
    #[serde(default)]
    pub days: Vec<Weekday>,
    /// Il fuso in cui leggere [`hour`](Self::hour), come nome IANA
    /// (`Europe/Rome`). **Assente = il fuso della macchina** — cioè quello del
    /// sistema, salvo l'impostazione `timers.zone` che lo sovrascrive per questa
    /// macchina.
    ///
    /// I due stati sono due significati diversi, e la ragione per cui il campo
    /// c'è. Assente vuol dire *quando chi guarda lo schermo comincia a
    /// lavorare*: un portatile portato a Tokyo suona alle 9 di Tokyo, ed è il
    /// caso normale. Presente vuol dire *ancorato a un posto*: «il digest delle
    /// 9 dell'ufficio di Roma» resta delle 9 di Roma anche per chi lo legge
    /// altrove — che è ciò che un vault condiviso fra persone in due paesi vuole
    /// poter dire, e che un fuso implicito non sa esprimere.
    ///
    /// Un nome che il database dei fusi non conosce **non fa suonare la
    /// sveglia**, e non ripiega su UTC: un ripiego silenzioso è la specie di
    /// bugia che la [0077] rifiuta nel registro dei comandi — la dichiarazione
    /// sarebbe onorata da un'altra sveglia, all'ora sbagliata, senza che nessuno
    /// se ne accorga.
    ///
    /// [0077]: ../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Quanto tardi è ancora utile suonare, in secondi. **`0` = mai.**
    ///
    /// **Non è il campo dell'ora legale**, ed è la cosa che questa decisione ha
    /// scoperto misurando: l'ora legale non ne vuole uno, perché a lei
    /// rispondono due *regole* — quelle qui sotto — e restava scoperta un'altra
    /// domanda, che la voce non aveva fatto. Un'occorrenza può essere passata
    /// senza che nessuno la suonasse perché la macchina dormiva, perché il pool
    /// era occupato, perché l'app era chiusa. La domanda utile non è
    /// *si recupera?* ma *fino a quanto tardi ha ancora senso*: un promemoria
    /// delle 9 alle 17 non serve più (`0`), un backup notturno in ritardo di
    /// venti minuti va fatto lo stesso (`3600`).
    ///
    /// Un intero al posto di una bandiera **risolve da sé la macchina che dorme
    /// due giorni**: quelle occorrenze cadono fuori da qualunque finestra
    /// sensata e non suonano — invece di suonare due volte, che è la risposta
    /// che nessuno vuole e che un `catch-up: bool` avrebbe dato.
    ///
    /// # Le due regole dell'ora legale, che non sono campi
    ///
    /// **Un'ora che non esiste si sposta in avanti** della durata del salto: la
    /// domenica in cui l'ora legale entra, una sveglia delle 2:30 suona alle
    /// 3:30. È la disambiguazione *compatible* di RFC 5545, cioè ciò che fa ogni
    /// calendario, e vuol dire che la sveglia non perde mai un giorno.
    ///
    /// **Un'ora che esiste due volte suona alla prima.** Discende
    /// dall'invariante e non da una scelta: al più *una* suonata per occorrenza,
    /// sempre, perché **un'occorrenza è la sua data civile e non il suo
    /// istante**. La domenica in cui l'ora legale esce, le 2:30 che accadono due
    /// volte sono una sola data civile.
    #[serde(default)]
    pub catch_up_seconds: u64,
}

impl WallClock {
    /// Ogni giorno a quest'ora, nel fuso della macchina, senza recupero.
    pub fn daily(hour: u8, minute: u8) -> Self {
        WallClock {
            hour,
            minute,
            days: Vec::new(),
            zone: None,
            catch_up_seconds: 0,
        }
    }

    /// Solo in questi giorni.
    pub fn on(mut self, days: impl IntoIterator<Item = Weekday>) -> Self {
        self.days = days.into_iter().collect();
        self
    }

    /// In questo fuso, per nome IANA, invece che in quello della macchina.
    pub fn anchored(mut self, zone: impl Into<String>) -> Self {
        self.zone = Some(zone.into());
        self
    }

    /// Con questa finestra di recupero.
    pub fn catching_up(mut self, seconds: u64) -> Self {
        self.catch_up_seconds = seconds;
        self
    }

    /// L'orario è scrivibile su un orologio?
    ///
    /// Un orario fuori scala non è un errore di registrazione ed è deliberato:
    /// il manifest si legge quando il componente entra, e rifiutare un
    /// componente intero per una sveglia storta sarebbe una punizione
    /// sproporzionata. Non suona, e non suona **in modo osservabile** — chi
    /// implementa uno scheduler chiama questa funzione e sa perché.
    pub fn valid(&self) -> bool {
        self.hour < 24 && self.minute < 60
    }

    /// Il giorno è fra quelli dichiarati? (elenco vuoto = ogni giorno)
    pub fn falls_on(&self, day: Weekday) -> bool {
        self.days.is_empty() || self.days.contains(&day)
    }

    /// **La regola.** La prima occorrenza *strettamente dopo* `now`, in ora
    /// civile locale; `None` se non ne esiste nessuna.
    ///
    /// È pura come [`TimerSchedule::nth_after`] ed è nel contratto per la stessa
    /// ragione — due host non devono avere due idee di quando siano le nove del
    /// prossimo lunedì — ma riceve l'ora civile invece di riceverne il
    /// trascorso: è l'ingrediente che alla firma sorella manca, ed è tutto ciò
    /// che serve perché anche questa famiglia abbia la sua regola qui dentro.
    ///
    /// **Il calendario finisce qui, il fuso no.** Questa funzione lavora su ore
    /// civili e non sa cosa sia un fuso: convertire un'ora civile nell'istante
    /// in cui accade — e decidere cosa fare dell'ora che l'ora legale cancella o
    /// raddoppia — è di chi possiede l'orologio, cioè dell'host. Il contratto
    /// dice *quali* occorrenze esistono, l'host dice *quando* accadono.
    pub fn next_after(&self, now: CivilTime) -> Option<CivilTime> {
        if !self.valid() {
            return None;
        }
        let oggi = CivilTime {
            hour: self.hour,
            minute: self.minute,
            second: 0,
            ..now
        };
        let primo = if oggi > now { oggi } else { oggi.next_day() };
        // Al più otto giorni: sette coprono ogni elenco non vuoto, e l'ottavo
        // esiste solo perché il primo candidato può essere già domani.
        let mut c = primo;
        for _ in 0..8 {
            if self.falls_on(c.weekday()) {
                return Some(c);
            }
            c = c.next_day();
        }
        None
    }

    /// L'ultima occorrenza **a `now` o prima**, in ora civile locale.
    ///
    /// È la metà della regola che serve al recupero: senza di lei uno scheduler
    /// che si sveglia in ritardo sa solo qual è la prossima, e non ha modo di
    /// sapere se ne ha appena persa una — cioè
    /// [`catch_up_seconds`](Self::catch_up_seconds) non sarebbe onorabile, e un
    /// campo dichiarato e non onorato è peggio di un campo assente.
    pub fn latest_upto(&self, now: CivilTime) -> Option<CivilTime> {
        if !self.valid() {
            return None;
        }
        let oggi = CivilTime {
            hour: self.hour,
            minute: self.minute,
            second: 0,
            ..now
        };
        let primo = if oggi <= now { oggi } else { oggi.prev_day() };
        let mut c = primo;
        for _ in 0..8 {
            if self.falls_on(c.weekday()) {
                return Some(c);
            }
            c = c.prev_day();
        }
        None
    }
}

/// Un'**ora civile**: ciò che si legge su un calendario appeso al muro, senza
/// fuso e senza offset (§22.4, decisione 0091).
///
/// Non attraversa il confine e non sta nel WIT: è l'ingrediente della regola,
/// come `n` lo è di [`TimerSchedule::nth_after`]. Chi possiede l'orologio la
/// costruisce dal proprio istante e la riconverte in un istante; chi applica la
/// regola non ha bisogno d'altro.
///
/// **Il confronto è l'ordine cronologico**, ed è la ragione dell'ordine dei
/// campi: `derive(PartialOrd)` confronta in ordine di dichiarazione, e dall'anno
/// al secondo quello è esattamente l'ordine del tempo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CivilTime {
    pub year: i32,
    /// `1..=12`.
    pub month: u8,
    /// `1..=31`.
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl CivilTime {
    /// Il giorno della settimana, dal calendario gregoriano proplettico.
    pub fn weekday(&self) -> Weekday {
        // Giorni dal 1970-01-01, che era un giovedì.
        let d = self.days_from_epoch().rem_euclid(7);
        match (d + 3) % 7 {
            0 => Weekday::Monday,
            1 => Weekday::Tuesday,
            2 => Weekday::Wednesday,
            3 => Weekday::Thursday,
            4 => Weekday::Friday,
            5 => Weekday::Saturday,
            _ => Weekday::Sunday,
        }
    }

    /// Stessa ora, il giorno dopo.
    pub fn next_day(self) -> Self {
        Self::from_days(self.days_from_epoch() + 1, self)
    }

    /// Stessa ora, il giorno prima.
    pub fn prev_day(self) -> Self {
        Self::from_days(self.days_from_epoch() - 1, self)
    }

    /// I giorni dal 1970-01-01 (algoritmo *days from civil* di Howard Hinnant).
    fn days_from_epoch(&self) -> i64 {
        let y = self.year as i64 - i64::from(self.month <= 2);
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let m = self.month as i64;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + self.day as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    /// L'inverso, tenendo l'ora di `ora_del_giorno`.
    fn from_days(days: i64, ora_del_giorno: Self) -> Self {
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        CivilTime {
            year: (y + i64::from(m <= 2)) as i32,
            month: m as u8,
            day: d as u8,
            ..ora_del_giorno
        }
    }
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
            settings: Vec::new(),
            strings: Vec::new(),
            default_locale: String::new(),
            timers: Vec::new(),
        }
    }

    /// Le sveglie che questo componente dichiara (§22.1).
    pub fn waking(mut self, timers: Vec<TimerSpec>) -> Self {
        self.timers = timers;
        self
    }

    /// Le impostazioni che questo plugin dichiara (§11.1).
    pub fn configuring(mut self, settings: Vec<SettingSpec>) -> Self {
        self.settings = settings;
        self
    }

    /// Le stringhe che questo plugin dichiara (§12.1), con la lingua in cui è
    /// scritto.
    ///
    /// Le due cose insieme e non in due metodi: un catalogo senza lingua di
    /// ripiego è la metà che si dimentica, e si dimentica in silenzio — le
    /// chiavi restano nude solo per chi legge in un'altra lingua.
    pub fn speaking(
        mut self,
        default_locale: impl Into<String>,
        strings: Vec<StringCatalog>,
    ) -> Self {
        self.default_locale = default_locale.into();
        self.strings = strings;
        self
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
    /// dall'host **fuori** dal giro sincrono del kernel (a M5 su un'istanza
    /// separata del componente), con le stesse capacità che il plugin ha
    /// altrove. Default: nessun job supportato.
    ///
    /// Fino alla decisione 0027 questa firma non aveva l'`host`, e il job era
    /// dichiarato «puro rispetto al vault»: input nel `payload`, output nel
    /// risultato. Per un calcolo puro era la firma giusta e resta disponibile —
    /// chi non tocca l'`host` scrive lo stesso job di prima. Per tutto il resto
    /// era il divieto di esistere: import, export, sync, backup, embedding, OCR,
    /// reindicizzazione e web clipper camminano il vault, e l'unico posto in cui
    /// potevano girare era l'unico che non lo vedeva.
    ///
    /// # Ciò che questo host è, e ciò che non è
    ///
    /// È l'`HostApi` di sempre, con davanti la politica del plugin (§7.3): un
    /// job di chi non ha `write_vault` riceve gli stessi rifiuti che riceve il
    /// suo `handle`. **Non** è uno snapshot, e la differenza va detta perché è
    /// l'unica cosa che si comporta diversamente dal giro sincrono:
    ///
    /// - **Il vault si vede per chiamata, non per job.** Ogni capacità prende il
    ///   prestito del workspace, fa il suo lavoro e lo rilascia. Fra due
    ///   chiamate il vault può cambiare — l'utente che salva, il watcher che
    ///   vede una scrittura altrui, un altro job — e chi cammina il vault vedrà
    ///   qualcosa che non è mai stato vero tutto insieme. È il prezzo di non
    ///   tenere fermo il vault per la durata di un lavoro lungo, ed è il verso
    ///   giusto in cui pagarlo: l'alternativa è un'app che si blocca per la
    ///   durata di un export.
    /// - **Contro quel cambio la guardia esiste già, ed è la stessa di tutti.**
    ///   Chi scrive un pezzo passa da [`VaultWrite::apply_edit`] con la `base`
    ///   che [`VaultRead::document_revision`] gli ha dato, e riceve
    ///   [`PluginError::Conflict`] se qualcuno è arrivato prima; chi crea passa
    ///   da [`VaultStructure::create_document`], che rifiuta un path occupato.
    ///   La decisione 0008 aveva scritto che una base omessa la si omette
    ///   «proprio nel caso lungo (l'automazione che calcola per un minuto), che
    ///   è l'unico in cui serve»: questa è quell'automazione.
    /// - **Un job non è una transazione e non è un lotto.** N scritture sono N
    ///   scritture, con N eventi, e nessuno le annulla se la terza fallisce. Il
    ///   lotto (decisione 0011) copre ciò che accade dentro **una** chiamata del
    ///   kernel; un job dura più di una chiamata per definizione.
    /// - **Chi esegue non tiene niente in mano.** L'host chiama `run_job` senza
    ///   nessun prestito del workspace aperto — altrimenti la prima capacità che
    ///   il job usa aspetterebbe chi l'ha chiamato, per sempre.
    ///
    /// L'esito torna comunque come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono: ciò che il
    /// job restituisce è il suo **risultato**, non più il suo unico effetto.
    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let (_, _) = (payload, host);
        Err(PluginError::UnknownJob(job.to_string().into()))
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
