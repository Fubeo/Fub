//! Il **banco del lato provider**: un host in memoria, e una suite di
//! conformità con cui provare un provider contro il **contratto**.
//!
//! Stava in `fub-features`, privato e `#[cfg(test)]` — cioè raggiungibile
//! nemmeno dagli integration test del suo stesso crate, solo dai suoi unit test.
//! Ora è qui ([decisione
//! 0054](../../../../docs/decisions/0196-test-e-artefatti-generati.md)).
//!
//! Serve a provare le feature **contro il contratto** e non contro il kernel:
//! una feature scritta come la scriverebbe un plugin non deve avere altro modo
//! di toccare il mondo che l'[`HostApi`], e un doppio in memoria lo dimostra
//! meglio di un vault vero (i test e2e col kernel vero ci sono comunque, in
//! `tests/`).
//!
//! Il pezzo che conta è l'**orologio che si muove a comando**: è il guadagno di
//! aver messo il tempo nel contratto, e permette di invecchiare le fasce di
//! ritenzione del versioning senza piantare timestamp finti dentro lo store.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub mod conformance;

use fub_abi::command::CommandOutcome;
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::event::Event;
use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor, LinkInsert};
use fub_abi::grid::{
    validate_grid_source, GridApplyRequest, GridCommit, GridProvider, GridSession, GridSurfaceSpec,
    GridWindow, GridWindowRequest,
};
use fub_abi::locale::Locale;
use fub_abi::model::{DateFormats, DocId, DocumentModel, Heading, LinkTarget, Span, TaskMarker};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::query::{in_folder, Matches, QueryEvaluator, QueryPredicate};
use fub_abi::rules::path_policy::{self, fenced_doc_id, Naming};
use fub_abi::rules::{media, properties, trash};
use fub_abi::session::{
    AnchoredSelection, AnchoredSelections, PaneMode, SelectionSet, ViewContext,
};
use fub_abi::settings::{SettingEntry, SettingSource, SettingSpec, SettingValue};
use fub_abi::traits::{
    BacklinkRef, DataRead, DataWrite, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery,
    HostServices, IndexQuery, IndexResult, JobId, JobSpec, LinkDirection, NeighborRef, Page, Paged,
    SettingsRead, SettingsWrite, TagCount, TransferRead, TrashEntry, VaultEntry, VaultRead,
    VaultStructure, VaultWrite, ViewStateRead, ViewStateWrite,
};
use fub_abi::transfer::{ExportProvider, ImportProvider, MemorySink, PLUGIN_EXPORT_LIMIT};
use fub_abi::{PluginError, MAX_RANDOM_BYTES};

/// Il nome di un documento che **nasce** in questo doppio: il recinto l'ha già
/// messo [`fenced_doc_id`], qui si aggiunge la portabilità e la forma NFC
/// (§15.5), come fa `KernelHost::create_document`.
fn born_here(id: &DocId) -> Result<DocId, PluginError> {
    path_policy::check(id.as_str(), Naming::New)
        .map_err(|why| PluginError::BadArgs(format!("`{id}`: {why}").into()))?;
    Ok(DocId::new(path_policy::normalized(id.as_str())))
}

/// Il recinto sui path dello **spazio dati**.
///
/// L'host vero confina ogni plugin nella sua cartella
/// (`Workspace::plugin_data_path`); questo doppio non ha cartelle, quindi non
/// può confinare — ma la metà che *è* una regola del contratto, cioè che un
/// path non risale e non nomina un'unità, la applica, ed è la stessa funzione.
fn fence_data(path: &str) -> Result<(), PluginError> {
    path_policy::fenced(path)
        .map_err(|why| PluginError::PermissionDenied(format!("`{path}`: {why}").into()))
}

/// Storage dei blob e dei documenti in memoria, più un orologio pilotabile.
#[derive(Default)]
pub struct MemoryHost {
    blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    /// Blob derivati della cache, separati dai dati autorevoli.
    cache_blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    /// Le sorgenti di import aperte (decisione 0102): chiave → byte.
    ///
    /// In memoria come tutto il resto, ma dietro un handle come quelle vere, ed
    /// è il punto: chi scrive un importer che legge a pezzi deve poterlo provare
    /// senza un kernel e senza un file. Si semina con
    /// [`MemoryHost::with_source`].
    sources: Mutex<BTreeMap<u64, Vec<u8>>>,
    /// Contatore da cui nascono le chiavi delle sorgenti. Sale e non si ricicla,
    /// come nel kernel vero.
    next_source: AtomicU64,
    /// I documenti **a byte**, come stanno nel vault vero: un doppio che li
    /// tenesse come `String` non saprebbe rappresentare un allegato, e chi
    /// scrive un estrattore a `SourceKind::Bytes` non avrebbe come provarlo
    /// senza un kernel (§21.8).
    docs: Mutex<BTreeMap<String, Vec<u8>>>,
    now: AtomicU64,
    /// Il contesto servito da [`HostEnv::active_context`], come lo
    /// pubblicherebbe la shell.
    context: Mutex<Option<ViewContext>>,
    /// Quante volte [`HostEnv::active_context`] è stato chiamato.
    ///
    /// È lo stesso conto delle letture del vault, per il canale che non passa
    /// da un path: `active_context` **clona** il contesto — quindi anche il
    /// testo di ogni selezione — e chiederlo due volte nello stesso render è
    /// una copia buttata che nessun'altra traccia lascerebbe vedere, perché lo
    /// stato dopo è identico allo stato prima. Anche qui è un conto di
    /// operazioni e non un tempo.
    reads_from_context: AtomicU64,
    /// Backlink finti per [`HostQuery::query_index`], seminati per target. Il
    /// doppio non ha un grafo: risponde solo a ciò che gli è stato messo dentro,
    /// ed è quanto basta a provare una view contro il contratto.
    backlinks: Mutex<BTreeMap<String, Vec<BacklinkRef>>>,
    /// Outline finti per [`HostQuery::query_index`], seminati per documento: il
    /// doppio non parsa, come non parsa il kernel dietro `IndexQuery::Outline`.
    outlines: Mutex<BTreeMap<String, Vec<Heading>>>,
    /// Aggregazione dei tag finta per [`IndexQuery::Tags`].
    tags: Mutex<Vec<TagCount>>,
    /// Archi finti per [`IndexQuery::Neighbors`], seminati come coppie
    /// (sorgente, destinazione). Il doppio non ha un grafo — come per i
    /// backlink — e la ragione per cui questo campo esiste comunque è che una
    /// vista a grafo (§3.3) chiede il vault **intero** in una domanda sola, e
    /// senza un ramo qui si proverebbe solo end-to-end.
    edges: Mutex<Vec<(String, String)>>,
    /// Modelli finti per [`VaultRead::read_model`], seminati per documento. Il
    /// doppio **non parsa** — come non parsa per l'outline — e la ragione è la
    /// stessa: un host in memoria che si portasse dentro un `FormatProvider`
    /// proverebbe la feature contro *quel* provider invece che contro il
    /// contratto. Chi vuole il parse vero ha i test end-to-end col kernel.
    models: Mutex<BTreeMap<String, DocumentModel>>,
    /// Formati finti per [`VaultRead::format_of`], seminati per **estensione**
    /// senza il punto — che è la chiave con cui risponde anche il registro vero.
    formats: Mutex<BTreeMap<String, DocumentFormat>>,
    /// Il cestino: id nel cestino → (voce, byte). È in memoria come il
    /// resto, ma ha la stessa forma di quello vero — due id per voce, e il
    /// ripristino che rifiuta un path occupato — perché è quella forma che le
    /// feature provano. I byte sono quelli grezzi del vault: un allegato
    /// cestinato resta byte, non testo.
    trash: Mutex<BTreeMap<String, (TrashEntry, Vec<u8>)>>,
    /// Acceso, la **prossima** `free_name` occupa il nome che risponde.
    ///
    /// Si spegne da sé, perché la corsa da provare è quella di *una* domanda: un
    /// interruttore che restasse acceso renderebbe ogni nome libero occupato, e
    /// il banco proverebbe «create_document rifiuta sempre» invece di «rifiuta
    /// chi ha perso la corsa».
    steals_the_name_free: AtomicBool,
    /// Contatore per timbrare le voci del cestino con id distinti.
    trashed: AtomicU64,
    /// Le impostazioni **dichiarate** (§11.1) e ciò che è stato scritto: il
    /// doppio tiene un livello solo, perché la precedenza fra i due livelli è
    /// del kernel e si prova là — qui si prova che una feature legge la propria
    /// configurazione dall'`HostApi` e non da una variabile d'ambiente.
    settings: Mutex<BTreeMap<String, (SettingSpec, Option<SettingValue>)>>,
    /// L'esemplare di view per conto del quale questo doppio sta agendo (§11.2).
    /// `None` — il default — è «non si sta disegnando nessuna view», ed è la
    /// condizione in cui lo stato di vista non c'è: chi prova una view che
    /// ricorda qualcosa lo dice con [`MemoryHost::with_instance`].
    view_instance: Mutex<Option<String>>,
    /// (esemplare, chiave) → valore. Il proprietario **non** è nella chiave
    /// perché questo doppio lo dà a un provider solo, e non ha un id da
    /// timbrargli: il recinto fra proprietari è del kernel e si prova là.
    view_state: Mutex<BTreeMap<(String, String), serde_json::Value>>,
    /// Il locale servito da [`HostEnv::locale`], come lo comporrebbe il kernel
    /// dopo aver sentito la shell e le impostazioni (§12.3). Il default è quello
    /// del contratto — lingua indeterminata, UTC — perché un banco che partisse
    /// italiano nasconderebbe proprio i posti in cui una feature dà per scontata
    /// una lingua.
    locale: Mutex<Locale>,
    /// Contatore da cui [`HostEnv::random_bytes`] deriva byte deterministici.
    entropy: AtomicU64,
    /// Un host che **non concede entropia**: `random_bytes` rende
    /// `PermissionDenied`. Non è un capriccio del doppio, è la condizione di un
    /// `Guard` senza `Capability::Env` — e l'unico modo di provare che chi
    /// costruisce un id se ne accorga invece di produrne uno tutto a zeri.
    without_entropy: std::sync::atomic::AtomicBool,
    /// Le risposte di rete **preparate**, nell'ordine in cui verranno servite.
    ///
    /// Vuota è il default, e il default **rifiuta**: un banco che rispondesse
    /// `200` a una richiesta che nessuno ha preparato renderebbe verde un test
    /// che chiede alla rete cose che il suo autore non sapeva di chiedere. Il
    /// rifiuto è `Unserved` e non un errore inventato, perché è esattamente ciò
    /// che risponde un host montato senza client (§23.3): il doppio non finge
    /// di avere un filo.
    answers: Mutex<std::collections::VecDeque<Result<HttpResponse, PluginError>>>,
    /// Le richieste **viste**, in ordine. È la metà che serve ad asserire: che
    /// un provider abbia chiesto *quell'URL con quel verbo* è la cosa che si
    /// vuole provare, e senza questo elenco si potrebbe solo provare cosa ne ha
    /// fatto.
    requests: Mutex<Vec<HttpRequest>>,
    /// I path dello spazio dati su cui `data_write` rifiuta. Vuoto è il
    /// default. Si accende con [`MemoryHost::denies_write`].
    writes_negate: Mutex<std::collections::BTreeSet<String>>,
    /// Il **conto** delle `data_write`, per path: quante volte e quanti byte.
    ///
    /// I blob dicono com'è finito lo spazio dati; questo dice **quanto è
    /// costato arrivarci**, ed è l'unica delle due cose che vede un difetto di
    /// prestazioni. Un file riscritto mille volte e uno scritto una sola
    /// lasciano lo stesso `blobs`, e senza questo contatore un presidio sulla
    /// quantità di lavoro sarebbe verde in tutti e due i casi. È un conto di
    /// operazioni e non un tempo apposta: su una macchina condivisa un tempo
    /// non è un segnale.
    writes: Mutex<BTreeMap<String, (usize, usize)>>,
    /// Il **conto** delle letture, per path: quante volte e quanti byte.
    ///
    /// L'altra metà di [`MemoryHost::scritture_su`], e serve per la stessa
    /// ragione rovesciata: i blob e i documenti dicono cosa c'è, non **quante
    /// volte è stato aperto**. Un comando che rilegge il vault intero e uno che
    /// chiede solo le note che gli servono lasciano dietro di sé esattamente lo
    /// stesso stato, e senza questo conto un presidio sulla quantità di lettura
    /// sarebbe verde in tutti e due i casi.
    ///
    /// Ci finiscono le letture del **vault** (per `DocId`) e quelle dello
    /// **spazio dati** (per path): sono i due canali da cui si legge, e la
    /// chiave è quella con cui il chiamante ha chiesto. Anche qui è un conto di
    /// operazioni e non un tempo: su una macchina condivisa un tempo non è un
    /// segnale.
    reads: Mutex<BTreeMap<String, (usize, usize)>>,
    /// Finestre e commit preparati per i test del provider grid. Il doppio
    /// non interpreta la sorgente: risponde soltanto ai dati scriptati.
    grid_surfaces: Mutex<Vec<GridSurfaceSpec>>,
    grid_sessions: Mutex<BTreeMap<String, GridSession>>,
    grid_windows: Mutex<BTreeMap<(String, String), GridWindow>>,
    grid_commits: Mutex<BTreeMap<String, GridCommit>>,
    grid_calls: Mutex<Vec<String>>,
    grid_next_instance: AtomicU64,
    /// Gli importer e gli exporter del banco, in ordine di registrazione: è
    /// il registro che [`HostServices::run_import`] e
    /// [`HostServices::run_export`] interrogano. Si seminano con
    /// [`MemoryHost::with_import_provider`] e
    /// [`MemoryHost::with_export_provider`].
    imports: Mutex<Vec<SharedImport>>,
    exports: Mutex<Vec<Arc<dyn ExportProvider>>>,
}

type SharedImport = Arc<Mutex<Box<dyn ImportProvider>>>;

impl MemoryHost {
    pub fn new() -> Self {
        let host = MemoryHost::default();
        host.now.store(1_700_000_000_000, Ordering::Relaxed);
        host
    }
    /// Registra un binding della famiglia grid senza introdurre un parser.
    pub fn with_grid_surface(self, surface: GridSurfaceSpec) -> Self {
        self.grid_surfaces.lock().unwrap().push(surface);
        self
    }

    /// Prepara una finestra che il provider di test restituirà per istanza e
    /// foglio. Gli id delle istanze sono quelli restituiti da `open`.
    pub fn with_grid_window(self, instance: &str, window: GridWindow) -> Self {
        self.grid_windows
            .lock()
            .unwrap()
            .insert((instance.to_owned(), window.sheet.clone()), window);
        self
    }

    /// Prepara un esito di commit; il valore è già derivato da un provider
    /// autorevole e il doppio non rivaluta formule.
    pub fn with_grid_commit(self, instance: &str, commit: GridCommit) -> Self {
        self.grid_commits
            .lock()
            .unwrap()
            .insert(instance.to_owned(), commit);
        self
    }

    pub fn grid_calls(&self) -> Vec<String> {
        self.grid_calls.lock().unwrap().clone()
    }

    /// La prossima domanda di un nome libero la **perde**: qualcun altro prende
    /// quel nome fra la risposta e la scrittura.
    ///
    /// È la finestra che `VaultRead::free_name` dichiara di lasciare aperta, e
    /// che senza questa maniglia non si costruisce se non con dei thread — cioè
    /// con una speranza sulla schedulazione al posto di un fatto.
    pub fn the_next_run_of_the_name_is_loses(&self) -> &Self {
        self.steals_the_name_free.store(true, Ordering::SeqCst);
        self
    }

    /// Il locale che questo doppio serve: chi prova una feature che formatta o
    /// che ordina lo dichiara, invece di scoprire il default.
    pub fn with_locale(self, locale: Locale) -> Self {
        *self.locale.lock().unwrap() = locale;
        self
    }

    /// Un host che non concede entropia: `random_bytes` rifiuta nominando il
    /// permesso, e chi costruisce un'identità deve accorgersene.
    pub fn without_entropy(self) -> Self {
        self.without_entropy.store(true, Ordering::Relaxed);
        self
    }

    /// Registra un importer sul banco, dopo quelli già registrati: come
    /// nell'host vero, [`HostServices::run_import`] sceglie il primo che
    /// riconosce la sorgente.
    pub fn with_import_provider(self, provider: Box<dyn ImportProvider>) -> Self {
        self.imports
            .lock()
            .unwrap()
            .push(Arc::new(Mutex::new(provider)));
        self
    }

    /// Registra un exporter sul banco: [`HostServices::run_export`] sceglie
    /// quello che offre la destinazione chiesta.
    pub fn with_export_provider(self, provider: Box<dyn ExportProvider>) -> Self {
        self.exports.lock().unwrap().push(Arc::from(provider));
        self
    }

    /// Apre una sorgente di import **dietro un handle**, e restituisce la
    /// [`ImportSource`] da dare al provider (decisione 0102).
    ///
    /// Il prologo è quello che leggerebbe il kernel. Serve a provare la strada a
    /// pezzi senza un file: un importer scritto contro `SourceContent::Bytes` e
    /// mai provato contro questa è un importer che si scoprirà sul vault vero di
    /// chi migra, che è il momento peggiore.
    pub fn with_source(
        &self,
        name: impl Into<String>,
        media_type: Option<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> fub_abi::transfer::ImportSource {
        use fub_abi::transfer::{ImportSource, SourceContent, SourceHandle, StreamedSource};
        let bytes = bytes.into();
        let handle = self
            .next_source
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        let len = bytes.len() as u64;
        let prologue = bytes[..bytes.len().min(8 * 1024)].to_vec();
        self.sources.lock().unwrap().insert(handle, bytes);
        ImportSource {
            name: name.into(),
            media_type,
            content: SourceContent::Streamed(StreamedSource {
                handle: SourceHandle(handle),
                len,
                prologue,
            }),
        }
    }

    /// Prepara la prossima risposta di rete. Si può chiamare più volte: le
    /// risposte escono nell'ordine in cui sono entrate.
    pub fn with_response(self, answer: HttpResponse) -> Self {
        self.answers.lock().unwrap().push_back(Ok(answer));
        self
    }

    /// Prepara un **guasto** del trasporto: è l'altra metà, e serve tanto
    /// quanto la prima — chi scarica deve saper dire cosa fa quando la rete non
    /// c'è, e un banco che sa solo riuscire non glielo chiede mai.
    pub fn with_network_fault(self, why: &str) -> Self {
        self.answers
            .lock()
            .unwrap()
            .push_back(Err(PluginError::Io(why.to_string().into())));
        self
    }

    /// D'ora in poi `data_write` su questo path **fallisce**.
    ///
    /// Non è una crudeltà del doppio: è il disco pieno, la quota finita, il
    /// permesso tolto sotto i piedi mentre l'app è aperta. Serve perché la
    /// forma «muta lo stato, poi persisti» si giudica soltanto sul ramo in cui
    /// la persistenza non riesce, e un banco che sa solo riuscire non lo
    /// esercita mai. Si accende a metà partita di proposito — la storia si
    /// costruisce con le scritture buone, e poi cede quella che interessa.
    pub fn denies_write(&self, path: &str) {
        self.writes_negate.lock().unwrap().insert(path.to_string());
    }

    /// Quante volte quel path è stato scritto, e quanti byte in tutto.
    ///
    /// `(0, 0)` per un path mai scritto: non essere mai passati di lì è un
    /// conto, non un'assenza di risposta.
    pub fn writes_on(&self, path: &str) -> (usize, usize) {
        self.writes
            .lock()
            .unwrap()
            .get(path)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Quante volte quel path (o quel `DocId`) è stato **letto**, e quanti byte
    /// in tutto. `(0, 0)` per ciò che nessuno ha mai aperto.
    pub fn reads_on(&self, path: &str) -> (usize, usize) {
        self.reads
            .lock()
            .unwrap()
            .get(path)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Il totale delle letture: quante e quanti byte, su tutto.
    ///
    /// È la forma che serve quando la domanda non è *quel* documento ma
    /// **quanti**: «questo comando ha aperto il vault intero?» non si risponde
    /// path per path.
    pub fn read_totals(&self) -> (usize, usize) {
        self.reads
            .lock()
            .unwrap()
            .values()
            .fold((0, 0), |(n, b), (dn, db)| (n + dn, b + db))
    }

    /// Quante volte qualcuno ha chiesto il contesto attivo.
    ///
    /// La forma con cui si prova che un render è una **fotografia**: una sola
    /// lettura, e ciò che ne esce viene da quell'unica.
    pub fn reads_from_context(&self) -> u64 {
        self.reads_from_context.load(Ordering::Relaxed)
    }

    /// Segna una lettura riuscita. Privato: il conto si legge, non si scrive.
    fn record_read(&self, key: &str, byte: usize) {
        let mut reads = self.reads.lock().unwrap();
        let count = reads.entry(key.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += byte;
    }

    /// Le richieste di rete che questo doppio ha visto, in ordine.
    pub fn network_requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().unwrap().clone()
    }

    /// Sposta l'orologio in avanti di `ms`.
    pub fn advance(&self, ms: u64) {
        self.now.fetch_add(ms, Ordering::Relaxed);
    }

    /// Sposta l'orologio **indietro** di `ms`: è ciò che fa NTP, un cambio di
    /// fuso o una VM ripresa — e ciò contro cui il versioning deve difendersi.
    pub fn backtrack(&self, ms: u64) {
        self.now.fetch_sub(ms, Ordering::Relaxed);
    }

    /// Aggiunge un documento al vault finto (stile builder).
    pub fn with_document(self, id: &str, source: &str) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.as_bytes().to_vec());
        self
    }

    /// Aggiunge un documento che **non è testo**: un PDF, un `.canvas`, un file
    /// con un encoding suo.
    ///
    /// Chi lo legge con `read_document` riceve lo stesso errore che riceverebbe
    /// dal vault vero; chi lo legge con `read_document_bytes` riceve i byte.
    pub fn with_binary_document(self, id: &str, bytes: &[u8]) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), bytes.to_vec());
        self
    }

    /// Fa sparire un documento **senza emettere eventi**: è ciò che accade
    /// quando un `DocumentRemoved` va perso in un troncamento della coda.
    pub fn forgets_document(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }

    /// Sposta un documento **senza emettere eventi**: il rename perso.
    pub fn rename_of_hidden(&self, from: &str, to: &str) {
        let mut docs = self.docs.lock().unwrap();
        if let Some(source) = docs.remove(from) {
            docs.insert(to.to_string(), source);
        }
    }

    /// Imposta il documento attivo, come farebbe la shell su una navigazione:
    /// pannello principale, nessuna selezione, modalità normale.
    pub fn set_active(&self, id: Option<&str>) {
        *self.context.lock().unwrap() =
            id.map(|id| ViewContext::new("main").with_doc(Some(DocId::new(id))));
    }

    /// Pubblica un contesto intero: è la forma con cui si provano le view che
    /// seguono la selezione o la modalità.
    pub fn set_context(&self, context: Option<ViewContext>) {
        *self.context.lock().unwrap() = context;
    }

    /// Sposta il cursore (senza testo selezionato) nel documento attivo.
    /// `None` = il buffer è sporco, quindi nessuna coordinata sarebbe vera.
    pub fn set_caret(&self, byte: Option<usize>) {
        self.map_context(|c| {
            c.selections = Some(match byte {
                Some(b) => SelectionSet::caret(b),
                None => SelectionSet::floating(""),
            });
        });
    }

    /// Seleziona `text` a partire da `start` byte nel documento attivo.
    pub fn set_selection(&self, start: usize, text: &str) {
        self.map_context(|c| {
            c.selections = Some(SelectionSet::anchored(
                Span::new(start, start + text.len()),
                text,
            ));
        });
    }

    /// Più selezioni insieme, come le pubblica un pannello con più cursori: la
    /// **prima** coppia è la primaria, le altre le secondarie (decisione 0093).
    ///
    /// Che la primaria sia la prima *di questo elenco* è una comodità di questo
    /// aiuto, non una regola del contratto: là è un campo, e proprio perché è un
    /// campo un aiuto può sceglierla come gli torna.
    pub fn set_selections(&self, selections: &[(usize, &str)]) {
        let mut anchored = selections
            .iter()
            .map(|(start, text)| {
                AnchoredSelection::new(Span::new(*start, start + text.len()), *text)
            })
            .collect::<Vec<_>>();
        let primary = anchored.remove(0);
        self.map_context(|c| {
            c.selections = Some(SelectionSet::Anchored(AnchoredSelections {
                primary,
                secondary: anchored,
            }));
        });
    }

    /// Le stesse, a buffer sporco: il testo è vero, le coordinate no — per
    /// tutte.
    pub fn set_floating_selections(&self, texts: &[&str]) {
        use fub_abi::session::{FloatingSelection, FloatingSelections};
        let mut fluttuanti = texts
            .iter()
            .map(|t| FloatingSelection::new(*t))
            .collect::<Vec<_>>();
        let primary = fluttuanti.remove(0);
        self.map_context(|c| {
            c.selections = Some(SelectionSet::Floating(FloatingSelections {
                primary,
                secondary: fluttuanti,
            }));
        });
    }

    /// Cambia la modalità del pannello attivo.
    pub fn set_mode(&self, mode: PaneMode) {
        self.map_context(|c| c.mode = mode);
    }

    fn map_context(&self, f: impl FnOnce(&mut ViewContext)) {
        let mut ctx = self.context.lock().unwrap();
        let mut context = ctx.take().unwrap_or_else(|| ViewContext::new("main"));
        f(&mut context);
        *ctx = Some(context);
    }

    /// Semina un arco del grafo dei link: `from` nomina `to` (stile builder).
    ///
    /// Non deriva dai documenti seminati, e non è una pigrizia del doppio: per
    /// derivarlo bisognerebbe parsare, e questo host non parsa — è la stessa
    /// regola dell'outline e dei modelli.
    pub fn with_edge(self, from: &str, to: &str) -> Self {
        self.edges
            .lock()
            .unwrap()
            .push((from.to_string(), to.to_string()));
        self
    }

    /// Semina i backlink che [`HostQuery::query_index`] restituirà per `target`
    /// (stile builder).
    pub fn with_backlink(self, target: &str, sources: &[&str]) -> Self {
        let refs = sources
            .iter()
            .map(|s| BacklinkRef {
                source: DocId::new(*s),
                context: None,
            })
            .collect();
        self.backlinks
            .lock()
            .unwrap()
            .insert(target.to_string(), refs);
        self
    }

    /// Semina l'outline che [`HostQuery::query_index`] restituirà per `doc`
    /// (stile builder).
    pub fn with_outline(self, doc: &str, headings: &[Heading]) -> Self {
        self.outlines
            .lock()
            .unwrap()
            .insert(doc.to_string(), headings.to_vec());
        self
    }

    /// Semina l'aggregazione dei tag che [`IndexQuery::Tags`] restituirà
    /// (stile builder): coppie nome→conteggio.
    pub fn with_tags(self, tags: &[(&str, u32)]) -> Self {
        *self.tags.lock().unwrap() = tags
            .iter()
            .map(|(name, count)| TagCount {
                name: name.to_string(),
                count: *count,
            })
            .collect();
        self
    }

    /// Semina il modello che [`VaultRead::read_model`] restituirà per `doc`
    /// (stile builder).
    pub fn with_model(self, doc: &str, model: DocumentModel) -> Self {
        self.models.lock().unwrap().insert(doc.to_string(), model);
        self
    }

    /// Semina il formato che [`VaultRead::format_of`] restituirà per i documenti
    /// con questa estensione (stile builder).
    pub fn with_format(self, ext: &str, format: DocumentFormat) -> Self {
        self.formats.lock().unwrap().insert(ext.to_string(), format);
        self
    }

    /// **Dichiara** un'impostazione, come farebbe il manifest di chi la offre
    /// (stile builder). Senza dichiarazione una chiave non esiste: è la stessa
    /// regola del kernel, e il doppio la ripete perché è quella che una feature
    /// incontra.
    pub fn with_setting(self, spec: SettingSpec) -> Self {
        self.settings
            .lock()
            .unwrap()
            .insert(spec.key.clone(), (spec, None));
        self
    }

    /// Dichiara un'impostazione **e le dà un valore**, come se l'utente
    /// l'avesse scritta.
    pub fn with_value(self, spec: SettingSpec, value: SettingValue) -> Self {
        self.settings
            .lock()
            .unwrap()
            .insert(spec.key.clone(), (spec, Some(value)));
        self
    }

    /// Dice per conto di **quale esemplare di view** questo doppio sta agendo
    /// (stile builder), che è ciò che dà uno stato di vista a chi lo usa.
    ///
    /// Nell'app l'esemplare lo timbra l'host e nessuno lo nomina; qui lo nomina
    /// il test, perché il test è il chiamante — è la stessa asimmetria per cui
    /// `Workspace::view_state` prende il proprietario e la capacità no.
    pub fn with_instance(self, instance: &str) -> Self {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
        self
    }

    /// Cambia esemplare **tenendo ciò che è stato salvato**: è come riaprire lo
    /// stesso pannello in un'altra istanza, ed è il modo di provare che due
    /// esemplari non si mescolano senza costruire due host.
    pub fn switch_to_instance(&self, instance: &str) {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
    }
}

impl VaultRead for MemoryHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        let bytes = self.read_document_bytes(id)?;
        // Come il vault vero: non si indovina un encoding, si dice di no.
        String::from_utf8(bytes)
            .map_err(|and| PluginError::Io(format!("{id} non è UTF-8: {and}").into()))
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        let id = fenced_doc_id(id)?;
        let bytes = self
            .docs
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::NotFound(id.to_string().into()))?;
        // Solo le letture **riuscite**, come per le scritture: chiedere un
        // documento che non c'è non è lavoro fatto sul disco.
        self.record_read(id.as_str(), bytes.len());
        Ok(bytes)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        // Sui byte grezzi, non sul testo: per un sorgente UTF-8 è la stessa
        // impronta (`of` è `of_bytes` del testo), ma un allegato non è testo e
        // `read_document` lo rifiuterebbe — mentre la revisione è di ciò che
        // sta nel vault, non di ciò che si riesce a leggere come testo.
        Ok(Revision::of_bytes(&self.read_document_bytes(id)?))
    }

    /// In ordine di id e a finestra, come il kernel: un doppio che
    /// restituisse tutto in ordine di hash farebbe passare i test a chi si
    /// affida a un ordine che in produzione non c'è. Soltanto i documenti,
    /// come nel vault vero: un allegato o un file che nessun formato serve sta
    /// nell'anagrafe ([`IndexQuery::Entries`]), non qui.
    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        Ok(Paged::window(self.documents(), page))
    }

    /// Il modello **seminato**, non uno parsato: un documento che esiste ma di
    /// cui nessuno ha seminato il modello risponde come uno che non esiste — chi
    /// prova una feature sul modello deve dire quale modello sta provando.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        self.models
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::Internal(format!("{id}: nessun modello seminato").into()))
    }

    /// Il registro **seminato**, e sotto di esso il markdown che ogni vault di
    /// Fub serve comunque: vedi [`formato_di_serie`].
    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        let ext = id
            .as_str()
            .rsplit_once('.')
            .map(|(_, and)| and.to_lowercase())?;
        if let Some(seeded) = self.formats.lock().unwrap().get(&ext) {
            return Some(seeded.clone());
        }
        format_of_series(&ext)
    }

    /// La convenzione D3 su ciò che questo host ha in memoria: `nome.md`,
    /// `nome 1.md`, … Nel kernel la stessa risposta guarda anche il disco
    /// (`Workspace::free_name`), che qui non c'è.
    fn free_name(&self, id: &DocId) -> DocId {
        let mut docs = self.docs.lock().unwrap();
        let (stem, ext) = match id.as_str().rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.contains('/') => {
                (stem, format!(".{ext}"))
            }
            _ => (id.as_str(), String::new()),
        };
        let free = (0u32..)
            .map(|n| match n {
                0 => id.clone(),
                n => DocId::new(format!("{stem} {n}{ext}")),
            })
            .find(|c| !docs.contains_key(c.as_str()))
            .expect("la sequenza dei candidati è infinita");
        // **Qualcun altro prende il nome fra la domanda e la scrittura.**
        //
        // È la corsa che `free_name` dichiara di non chiudere — *«non prenota
        // niente: fra la domanda e la scrittura il nome può diventare occupato,
        // e a quel punto è la scrittura a dirlo»* — e che nessun banco di questo
        // repo costruiva. Senza una maniglia non è costruibile senza thread, e
        // con i thread sarebbe una speranza sulla schedulazione invece di un
        // fatto: qui la finestra si apre dove è dichiarata, cioè dentro la
        // risposta, e chi legge il banco vede il momento esatto.
        if self.steals_the_name_free.swap(false, Ordering::SeqCst) {
            docs.insert(free.as_str().to_string(), b"di qualcun altro".to_vec());
        }
        free
    }

    /// Il Markdown di serie scrive il link come il provider vero; un formato
    /// seminato con [`with_format`](MemoryHost::with_format) non ha una
    /// grammatica qui, e risponde «non so» come un provider senza
    /// l'operazione. Un link che la grammatica non sa scrivere è `internal`,
    /// come nel kernel, che riceve dal provider un errore di serializzazione.
    /// La parità col provider vero la prova
    /// `markdown_writes_links_and_ticks_alike` in `both_hosts_answer_alike`.
    fn format_link(&self, doc: &DocId, link: &LinkInsert) -> Result<Option<String>, PluginError> {
        if !self.speaks_series_markdown(doc) {
            return Ok(None);
        }
        series_markdown::link(link).map_err(|why| PluginError::Internal(why.into()))
    }

    /// Come [`format_link`](VaultRead::format_link): il simbolo del Markdown di
    /// serie, sulla revisione dei byte che il doppio ha adesso.
    fn task_state_edit(
        &self,
        doc: &DocId,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        if !self.speaks_series_markdown(doc) {
            return Ok(None);
        }
        let source = self.read_document(doc)?;
        let edits = series_markdown::task(&source, marker, done)
            .map_err(|why| PluginError::Internal(why.into()))?;
        Ok(Some(EditRequest::new(Revision::of(&source), edits)))
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        let trash = self.trash.lock().unwrap();
        let mut entries: Vec<TrashEntry> = trash.values().map(|(and, _)| and.clone()).collect();
        entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.id.cmp(&b.id)));
        Ok(entries)
    }
}

impl MemoryHost {
    /// A cosa punta `target`, scritto in `from`, fra i documenti in memoria.
    ///
    /// È la regola di `fub_kernel::graph` (`resolve_wiki`/`resolve_path`) e
    /// del ripiego sull'anagrafe (`resolve_entry_in`) scritta come scansione:
    /// il doppio ha pochi documenti e nessun indice. La parità col kernel la
    /// prova `both_hosts_answer_alike`.
    fn resolve(&self, target: &LinkTarget, from: Option<&DocId>) -> Option<DocId> {
        use fub_abi::rules::path::{exact_key, resolution_key, resolve_against, strip_ext};
        let docs = self.docs.lock().unwrap();
        // L'ordine fra omonimi del grafo: il path più corto, poi il minore;
        // fra formati dello stesso path, prima la prosa.
        let prose = |id: &DocId| {
            self.format_of(id).is_some_and(|format| {
                format
                    .capabilities
                    .supports(fub_abi::options::source::PROSE)
            })
        };
        let mut ids: Vec<DocId> = docs.keys().map(DocId::new).collect();
        ids.sort_by(|a, b| {
            let depth = |id: &DocId| id.as_str().matches('/').count();
            depth(a).cmp(&depth(b)).then_with(|| {
                let by_path = a.as_str().cmp(b.as_str());
                if strip_ext(a.as_str()) == strip_ext(b.as_str()) {
                    prose(b).cmp(&prose(a)).then(by_path)
                } else {
                    by_path
                }
            })
        });
        // Fra i candidati di una chiave vince chi combacia esattamente con
        // ciò che si è scritto, altrimenti il primo per priorità.
        let pick = |key: &str,
                    exact: &str,
                    keyed: &dyn Fn(&DocId) -> String,
                    form: &dyn Fn(&DocId) -> String| {
            let mut candidates = ids.iter().filter(|id| keyed(id) == key).peekable();
            let first = (*candidates.peek()?).clone();
            Some(
                candidates
                    .find(|id| form(id) == exact)
                    .cloned()
                    .unwrap_or(first),
            )
        };
        let root = DocId::new("");
        let source = from.unwrap_or(&root);
        match target {
            _ if target.names_host() => from.filter(|doc| docs.contains_key(doc.as_str())).cloned(),
            LinkTarget::Wiki { page, .. } => {
                let key = resolution_key(page);
                let exact = exact_key(page);
                if key.is_empty() {
                    return None;
                }
                let by_path = |id: &DocId| resolution_key(&strip_ext(id.as_str()));
                if key.contains('/') {
                    let stem = strip_ext(&key);
                    if let Some(id) = ids
                        .iter()
                        .find(|id| by_path(id) == stem && exact_key(id.as_str()) == exact)
                    {
                        return Some(id.clone());
                    }
                    if let Some(id) = pick(&stem, &strip_ext(&exact), &by_path, &|id| {
                        exact_key(&strip_ext(id.as_str()))
                    }) {
                        return Some(id);
                    }
                }
                let by_name = |id: &DocId| resolution_key(id.page_name());
                if let Some(id) = pick(&key, &exact, &by_name, &|id| exact_key(id.page_name())) {
                    return Some(id);
                }
                // Il nome con la sua estensione (`[[board.canvas]]`), prima
                // degli alias come nel grafo.
                let file = |id: &DocId| id.as_str().rsplit('/').next().unwrap_or("").to_string();
                if strip_ext(&key) != key {
                    if let Some(id) = pick(&key, &exact, &|id| resolution_key(&file(id)), &|id| {
                        exact_key(&file(id))
                    }) {
                        return Some(id);
                    }
                }
                let models = self.models.lock().unwrap();
                let aliased = ids.iter().find(|id| {
                    models.get(id.as_str()).is_some_and(|model| {
                        model
                            .frontmatter
                            .aliases()
                            .iter()
                            .any(|alias| resolution_key(alias) == key)
                    })
                });
                if let Some(id) = aliased {
                    return Some(id.clone());
                }
                // Il file per nome, estensione compresa (`[[foto.png]]`), o
                // per path intero: il più vicino alla radice.
                ids.iter()
                    .find(|id| {
                        let name = id.as_str().rsplit('/').next().unwrap_or(id.as_str());
                        resolution_key(name) == key || resolution_key(id.as_str()) == key
                    })
                    .cloned()
            }
            LinkTarget::Path(raw) => {
                let path = resolve_against(source, raw)?;
                let key = resolution_key(&path);
                let exact = exact_key(&path);
                if key.is_empty() {
                    return None;
                }
                let stem = strip_ext(&key);
                let by_path = |id: &DocId| resolution_key(&strip_ext(id.as_str()));
                if let Some(id) = ids
                    .iter()
                    .filter(|id| by_path(id) == stem)
                    .find(|id| exact_key(id.as_str()) == exact)
                    .or_else(|| {
                        ids.iter()
                            .filter(|id| by_path(id) == stem)
                            .find(|id| resolution_key(id.as_str()) == key)
                    })
                {
                    return Some(id.clone());
                }
                if let Some(id) = pick(&key, &exact, &by_path, &|id| {
                    exact_key(&strip_ext(id.as_str()))
                }) {
                    return Some(id);
                }
                // L'anagrafe: il path esatto, poi la sua chiave.
                if docs.contains_key(path.as_str()) {
                    return Some(DocId::new(path));
                }
                let mut named: Vec<&DocId> = ids
                    .iter()
                    .filter(|id| resolution_key(id.as_str()) == key)
                    .collect();
                named.sort_by(|a, b| a.as_str().cmp(b.as_str()));
                named.first().map(|id| (*id).clone())
            }
            LinkTarget::Url(_) => None,
        }
    }
}

impl MemoryHost {
    /// I documenti **come li conta il kernel**: quelli che un formato serve,
    /// in ordine di id. È l'universo delle domande sui documenti; l'anagrafe
    /// intera, allegati compresi, è [`IndexQuery::Entries`].
    fn documents(&self) -> Vec<DocId> {
        let docs = self.docs.lock().unwrap();
        docs.keys()
            .map(DocId::new)
            .filter(|id| self.format_of(id).is_some())
            .collect()
    }

    /// I documenti a un passo da `doc` sugli archi seminati, nel verso
    /// chiesto: ciò che nel kernel risponde il grafo (`LinkGraph::linked`).
    fn linked(&self, doc: &DocId, direction: LinkDirection) -> BTreeSet<DocId> {
        let edges = self.edges.lock().unwrap();
        let mut out = BTreeSet::new();
        for (from, to) in edges.iter() {
            let outbound = matches!(direction, LinkDirection::Outbound | LinkDirection::Both);
            let inbound = matches!(direction, LinkDirection::Inbound | LinkDirection::Both);
            if outbound && from == doc.as_str() {
                out.insert(DocId::new(to));
            }
            if inbound && to == doc.as_str() {
                out.insert(DocId::new(from));
            }
        }
        out
    }

    /// La camminata del kernel (`LinkGraph::neighbors`) sugli archi seminati:
    /// in ampiezza, ogni documento una volta sola alla distanza minima, `via`
    /// è l'anello da cui ci si arriva, e chi parte non è vicino di sé stesso.
    /// L'ordine è distanza crescente, poi id.
    fn neighbors(&self, doc: &DocId, direction: LinkDirection, depth: u8) -> Vec<NeighborRef> {
        let mut seen = BTreeSet::from([doc.clone()]);
        let mut out = Vec::new();
        let mut frontier = vec![doc.clone()];
        for step in 1..=depth {
            let mut next = Vec::new();
            for from in &frontier {
                for to in self.linked(from, direction) {
                    if !seen.insert(to.clone()) {
                        continue;
                    }
                    out.push(NeighborRef {
                        doc: to.clone(),
                        via: from.clone(),
                        depth: step,
                    });
                    next.push(to);
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        out.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.doc.cmp(&b.doc)));
        out
    }

    /// `doc` è servito dal Markdown di serie, e non da un formato seminato?
    /// La risposta è quella di `format_of`, così l'estensione si legge in un
    /// posto solo.
    fn speaks_series_markdown(&self, doc: &DocId) -> bool {
        self.format_of(doc)
            .is_some_and(|format| Some(format) == format_of_series("md"))
    }
}

/// Le due scritture mirate del Markdown di serie, per il doppio.
///
/// Sono la grammatica di `fub-format-markdown` ridotta a ciò che le feature
/// chiedono: un wikilink, un embed e il simbolo di un task. Il doppio non può
/// dipendere dal provider (vedi `models`), e la copia è tenuta onesta dal
/// banco di parità del kernel.
mod series_markdown {
    use fub_abi::edit::TextEdit;
    use fub_abi::format::LinkInsert;
    use fub_abi::model::{parse_wikilink_inner, Span, TaskMarker};

    pub(super) fn link(link: &LinkInsert) -> Result<Option<String>, String> {
        let Some(inside) = link.target.wiki_inner() else {
            return Ok(None);
        };
        let label = link.label.as_deref().filter(|label| *label != inside);
        let inner = match label {
            Some(label) => format!("{inside}|{label}"),
            None => inside.clone(),
        };
        let read_back = parse_wikilink_inner(&inner);
        if inner.contains(['[', ']', '\n', '\r'])
            || read_back.target != link.target
            || read_back.alias.as_deref() != label
        {
            return Err(format!("«{inner}» non si scrive in un wikilink"));
        }
        let bang = if link.embed { "!" } else { "" };
        Ok(Some(format!("{bang}[[{inner}]]")))
    }

    pub(super) fn task(
        source: &str,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Vec<TextEdit>, String> {
        let Some(symbol) = source.get(marker.span.start..marker.span.end) else {
            return Err("il marcatore è fuori dalla sorgente".to_string());
        };
        if symbol.chars().count() != 1 || !between_the_brackets_of_an_item(source, marker.span) {
            return Err(format!(
                "nessun task ha il marcatore in {}..{}",
                marker.span.start, marker.span.end
            ));
        }
        let wanted = if done { "x" } else { " " };
        Ok(vec![TextEdit::replace(marker.span, wanted)])
    }

    /// Il carattere fra le parentesi di un elemento d'elenco — `- [ ]`,
    /// `1. [x]`, anche citato (`> - [ ]`) — seguito da uno spazio o dalla fine
    /// della riga. È il task del provider ridotto a una riga: senza, il doppio
    /// scriveva la spunta su qualunque byte gli si indicasse, anche in mezzo
    /// alla prosa, dove il kernel rifiuta. Un elenco dentro un blocco di
    /// codice qui passa: la riga non sa di stare in un blocco.
    fn between_the_brackets_of_an_item(source: &str, span: Span) -> bool {
        let line = source[..span.start].rfind('\n').map_or(0, |at| at + 1);
        let Some(before) = source[line..span.start].strip_suffix('[') else {
            return false;
        };
        let closes = source[span.end..]
            .strip_prefix(']')
            .is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\t', '\n', '\r']));
        let head = before.trim_start_matches([' ', '\t', '>']);
        let gap = match head.strip_prefix(['-', '*', '+']) {
            Some(gap) => gap,
            None => {
                let digits =
                    head.len() - head.trim_start_matches(|c: char| c.is_ascii_digit()).len();
                match head[digits..].strip_prefix(['.', ')']) {
                    Some(gap) if (1..=9).contains(&digits) => gap,
                    _ => return false,
                }
            }
        };
        closes && !gap.is_empty() && gap.trim_start_matches([' ', '\t']).is_empty()
    }
}

/// Le foglie che il doppio sa verificare **con le regole condivise**, sui
/// documenti che ha in memoria: un elenco di id, una cartella
/// ([`in_folder`]), un link sugli archi seminati, una proprietà sul
/// frontmatter dei modelli seminati ([`properties::test`]). La struttura —
/// OR, AND, negazione — è quella di [`QueryEvaluator`], la stessa del kernel.
///
/// Il resto (testo, tag, regex, task, glob, estensione, predicati di terzi)
/// vuole un indice o una regola che vive nel kernel, e la risposta è
/// `unserved`: ignorare il filtro farebbe passare per il motivo sbagliato
/// ogni prova che se ne fidasse.
struct Selection<'a> {
    host: &'a MemoryHost,
    documents: Vec<DocId>,
}

impl<'a> Selection<'a> {
    fn of(host: &'a MemoryHost) -> Self {
        Selection {
            host,
            documents: host.documents(),
        }
    }

    fn keep(&self, test: impl Fn(&DocId) -> bool) -> Matches {
        Matches::of_docs(self.documents.iter().filter(|id| test(id)).cloned())
    }
}

impl QueryEvaluator for Selection<'_> {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.documents.iter().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Docs { docs } => Ok(self.keep(|id| docs.contains(id))),
            QueryPredicate::Folder { path, descendants } => {
                Ok(self.keep(|id| in_folder(id, path, *descendants)))
            }
            QueryPredicate::Linked { doc, direction } => {
                let linked = self.host.linked(doc, *direction);
                Ok(self.keep(|id| linked.contains(id)))
            }
            QueryPredicate::Property { filter } => {
                let models = self.host.models.lock().unwrap();
                let mut found = Vec::new();
                for id in &self.documents {
                    let model = models.get(id.as_str()).ok_or_else(|| unseeded(id))?;
                    if properties::test(&model.frontmatter, filter, &DateFormats::ISO) {
                        found.push(id.clone());
                    }
                }
                Ok(Matches::of_docs(found))
            }
            other => Err(PluginError::Unserved(
                format!(
                    "MemoryHost non valuta questa foglia senza un indice: {other:?}; \
                     usa un Workspace vero"
                )
                .into(),
            )),
        }
    }
}

/// Il frontmatter di `id` serve e nessuno ha seminato il suo modello: il
/// doppio non parsa, e rispondere come se il documento non avesse proprietà
/// sarebbe inventare.
fn unseeded(id: &DocId) -> PluginError {
    PluginError::Unserved(
        format!(
            "MemoryHost non conosce il frontmatter di `{id}`: seminane il modello \
             con `with_model`, o usa un Workspace vero"
        )
        .into(),
    )
}

/// **Il markdown, che ogni vault di Fub serve.**
///
/// Il registro dei formati di questo doppio è ciò che gli si semina con
/// [`MemoryHost::with_format`], e finché era *soltanto* quello il doppio si
/// comportava come un vault in cui non è registrato nessun provider: `format_of`
/// rispondeva «non so» per ogni estensione, e la scrittura scriveva lo stesso —
/// mentre il kernel, che un registro ce l'ha, risponde `unserved` a chi prova a
/// scrivere un formato che nessuno parsa. Un plugin che crea `appunti.txt`
/// passava di qua e si rompeva di là (difetto 0222).
///
/// Il markdown non si semina perché non è una scelta di chi scrive il banco: è
/// ciò che il core registra in ogni vault, ed è la ragione per cui un doppio
/// vuoto deve rispondere *come un vault vero* e non *come un vault vuoto*. Chi
/// ne serve altri li dichiara, e chi vuole un markdown diverso lo sovrascrive —
/// `with_format` vince, perché il registro seminato si guarda per primo.
///
/// Le capacità sono **quelle del provider vero**, sintassi di lettura
/// comprese: una feature che decide da una capacità (scrivere un blocco, una
/// proprietà, un `[[link]]`, leggere le note a piè di pagina dal modello) deve
/// ricevere qui la risposta che riceve nel vault. Il doppio non parsa — i
/// modelli si seminano, vedi `read_model` — ma la dichiarazione dice cosa il
/// formato *sa*, non chi lo sta parsando.
fn format_of_series(ext: &str) -> Option<DocumentFormat> {
    matches!(ext, "md" | "markdown").then(|| DocumentFormat {
        descriptor: FormatDescriptor::text("markdown", "Markdown (Obsidian)", &["md", "markdown"]),
        capabilities: FormatCapabilities::of(&[
            fub_abi::options::syntax::WIKILINKS,
            fub_abi::options::syntax::TAGS,
            fub_abi::options::syntax::FRONTMATTER,
            fub_abi::options::syntax::CALLOUTS,
            fub_abi::options::syntax::EMBEDS,
            fub_abi::options::syntax::FOOTNOTES,
            fub_abi::options::syntax::DEFINITION_LISTS,
            fub_abi::options::source::PROSE,
        ]),
    })
}

impl VaultWrite for MemoryHost {
    /// La scrittura intera come la fa l'host vero, **guardia compresa**: se chi
    /// scrive dice da cosa era partito e il testo non è più quello, `Conflict` e
    /// non si scrive niente. Vale qui la ragione scritta sotto per `apply_edit`
    /// — un doppio che accettasse qualunque base non proverebbe niente proprio
    /// della cosa che questa firma esiste per rendere impossibile.
    ///
    /// Il parse invece non c'è, per la ragione scritta su `models`: un
    /// sorgente che il provider del formato rifiuterebbe qui si scrive. Chi
    /// prova che una feature scrive un sorgente valido lo prova col kernel.
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        let mut docs = self.docs.lock().unwrap();
        let id = if matches!(&base, WriteBase::Dictated) && !docs.contains_key(id.as_str()) {
            // `Dictated` creates when the document is absent, so it must obey
            // the same portability rule as `create_document`. Existing
            // imported names remain addressable verbatim.
            born_here(&id)?
        } else {
            id
        };
        // **Nessuno serve questo formato.** Nel kernel è il primo modo in cui
        // una scrittura può finire senza che il chiamante abbia sbagliato
        // niente — il parse che precede il disco non trova un provider per
        // quell'estensione (`KernelError::NoProvider`), e la faccia è
        // `unserved` —, e qui non c'era: chi scriveva `appunti.txt` contro il
        // doppio lo scriveva, e sul vault vero no (difetto 0222).
        if self.format_of(&id).is_none() {
            return Err(PluginError::Unserved(
                format!("nessun provider serve il formato di `{id}`").into(),
            ));
        }
        if let WriteBase::DescendsFrom(wait_for) = base {
            // Sui byte grezzi, come il kernel che confronta col disco: la
            // `from_utf8_lossy` di prima fondeva byte diversi nello stesso
            // testo, e una guardia che non distingue non protegge.
            let now = docs.get(id.as_str()).map(|b| Revision::of_bytes(b));
            if now.as_ref() != Some(&wait_for) {
                return Err(PluginError::Conflict(
                    format!("`{id}` è cambiato da sotto").into(),
                ));
            }
        }
        docs.insert(id.to_string(), source.as_bytes().to_vec());
        Ok(Revision::of(source))
    }
    /// Deposita byte grezzi senza conversioni: `None` crea solo se assente
    /// (atomico), `Some` confronta l'impronta dei byte attuali e risponde
    /// `Conflict` senza scrivere se non coincide. Niente fallback UTF-8, niente
    /// variante dettata implicita: la revisione è dei byte grezzi prodotti.
    /// A differenza della via testuale, qui nessun cancello di formato: un file
    /// opaco senza provider si deposita comunque, come nel kernel — che per lui
    /// emette `EntryChanged` senza inventare un modello — e non `Unserved`.
    fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        let id = if expected.is_none() && !self.docs.lock().unwrap().contains_key(id.as_str()) {
            // Come `write_document` dettato: creare è far nascere un nome, e un
            // nome che nasce passa la portabilità. Chi esiste resta com'è.
            born_here(&id)?
        } else {
            id
        };
        let mut docs = self.docs.lock().unwrap();
        match (&expected, docs.get(id.as_str())) {
            (None, Some(_)) => {
                return Err(PluginError::AlreadyExists(id.to_string().into()));
            }
            (None, None) => {}
            (Some(_), None) => {
                return Err(PluginError::Conflict(
                    format!("`{id}` non esiste più").into(),
                ));
            }
            (Some(wait_for), Some(now)) => {
                if &Revision::of_bytes(now) != wait_for {
                    return Err(PluginError::Conflict(
                        format!("`{id}` è cambiato da sotto").into(),
                    ));
                }
            }
        }
        docs.insert(id.to_string(), bytes.to_vec());
        Ok(Revision::of_bytes(bytes))
    }

    /// La modifica chirurgica come la fa l'host vero: la base si verifica, gli
    /// edit si applicano tutti o nessuno, e il documento nuovo è una scrittura
    /// normale. Un doppio che qui accettasse qualunque base non proverebbe
    /// niente proprio della cosa che questa firma esiste per rendere
    /// impossibile.
    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        let source = self.read_document(id)?;
        let (next, report) = request.apply_to(&source)?;
        if report.is_empty() {
            return Ok(report);
        }
        // La base è quella appena letta, e dirlo qui non è cerimonia: questo
        // doppio *discende* dal sorgente su cui ha calcolato gli edit, e un
        // `Dictated` direbbe il falso in una firma che esiste per non farlo.
        self.write_document(id, &next, WriteBase::DescendsFrom(Revision::of(&source)))?;
        Ok(report)
    }
}

impl VaultStructure for MemoryHost {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        // Due letture dello stesso nome, come le fa `KernelHost`: il recinto —
        // sta dentro il vault? — e la portabilità, che vale solo perché qui il
        // nome **nasce**.
        let id = fenced_doc_id(id)?;
        let id = born_here(&id)?;
        if self.docs.lock().unwrap().contains_key(id.as_str()) {
            return Err(PluginError::AlreadyExists(id.to_string().into()));
        }
        // Il nome è libero — la riga sopra l'ha appena verificato — quindi non
        // c'è nessuna revisione da cui discendere.
        self.write_document(&id, source, WriteBase::Dictated)
            .map(|_| ())
    }

    /// Sposta il sorgente e basta: questo doppio non ha un grafo, quindi non
    /// riscrive i backlink entranti. Che la rinomina *li* riscriva è una
    /// proprietà del kernel e si prova contro il kernel (`tests/`); qui si
    /// prova che una feature sappia chiederla.
    ///
    /// La destinazione però è un nome che **nasce**, e va giudicata come tale:
    /// rinominare *verso* `aux.md` è creare un file che su Windows non si apre,
    /// e il kernel lo rifiuta con `bad-args` prima di guardare qualunque altra
    /// cosa. Qui non lo faceva nessuno, e la stessa rinomina riusciva contro il
    /// doppio e falliva sul vault vero (difetto 0222). Si giudica `to` e non
    /// `from` per la ragione scritta là: rinominare *via da* `aux.md` è
    /// precisamente il modo di sistemarlo.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let from = &fenced_doc_id(from)?;
        let to = &born_here(&fenced_doc_id(to)?)?;
        let mut docs = self.docs.lock().unwrap();
        if from == to {
            return Ok(());
        }
        if docs.contains_key(to.as_str()) {
            return Err(PluginError::AlreadyExists(to.to_string().into()));
        }
        // **Un documento resta un documento.** Rinominare `nota.md` in
        // `nota.txt` nel kernel non riesce: la rinomina riparsa ciò che ha
        // spostato, e per `.txt` non c'è nessun provider — `unserved`, la stessa
        // faccia della scrittura. Un allegato invece si sposta senza che nessuno
        // lo parsi, e qui la differenza fra i due si legge dove la legge il
        // kernel: chi ha un formato deve atterrare su un formato (difetto 0222).
        if self.format_of(from).is_some() && self.format_of(to).is_none() {
            return Err(PluginError::Unserved(
                format!("nessun provider serve il formato di `{to}`").into(),
            ));
        }
        let source = docs
            .remove(from.as_str())
            .ok_or_else(|| PluginError::NotFound(from.to_string().into()))?;
        docs.insert(to.to_string(), source);
        Ok(())
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        let id = &fenced_doc_id(id)?;
        // Byte grezzi: come il disco del kernel, un allegato cestinato non è
        // testo e non deve passare da `read_document` — che lo rifiuterebbe.
        let bytes = self.read_document_bytes(id)?;
        self.docs.lock().unwrap().remove(id.as_str());
        // La forma dell'id la dà la regola del contratto, la stessa che usa il
        // kernel: un cestino piatto, il timbro prima dell'estensione, e il
        // contatore solo sulle collisioni (0219). Il timbro qui è un contatore
        // travestito da istante — questo doppio non ha un orologio — ma la
        // *forma* dell'id è quella vera, ed è la sola cosa su cui chi sviluppa
        // contro il doppio scrive del codice.
        let n = self.trashed.fetch_add(1, Ordering::Relaxed);
        let stamp = format!("2026-01-01T00-00-{n:02}");
        let occupied = self.trash.lock().unwrap();
        let trashed = DocId::new(trash::trashed_id(id.as_str(), &stamp, &mut |c| {
            occupied.contains_key(c)
        }));
        drop(occupied);
        self.trash.lock().unwrap().insert(
            trashed.to_string(),
            (
                TrashEntry {
                    id: trashed.clone(),
                    original: id.clone(),
                    deleted_at: self.now_unix_millis() / 1000,
                    size: bytes.len() as u64,
                },
                bytes,
            ),
        );
        Ok(trashed)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        let (entry, bytes) = self
            .trash
            .lock()
            .unwrap()
            .get(entry.as_str())
            .cloned()
            .ok_or_else(|| PluginError::NotFound(entry.to_string().into()))?;
        // `entry` nomina un file dentro `.trash/`, che il recinto dei
        // documenti rifiuta apposta: chi lo valida è la ricerca fra le voci del
        // cestino, appena sopra. Il `to` invece atterra nel vault, ed è un nome
        // che **nasce**: senza `to` torna quello che c'era, e quello non si
        // rigiudica (è la stessa asimmetria del protocollo staged del kernel).
        let target = match to {
            Some(to) => born_here(&fenced_doc_id(&to)?)?,
            None => entry.original,
        };
        if self.docs.lock().unwrap().contains_key(target.as_str()) {
            return Err(PluginError::AlreadyExists(target.to_string().into()));
        }
        // Byte grezzi senza passare dal testo né rigiudicare chi torna a casa:
        // `None` rimette l'originale com'era (stessa asimmetria del protocollo
        // staged del kernel), anche se è un allegato che nessuna porta di
        // scrittura servirebbe. Solo il `to` esplicito è un nome che nasce e
        // si giudica come tale, già fatto sopra.
        self.docs.lock().unwrap().insert(target.to_string(), bytes);
        self.trash.lock().unwrap().remove(entry.id.as_str());
        Ok(target)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        let mut trash = self.trash.lock().unwrap();
        let count = trash.len() as u64;
        trash.clear();
        Ok(count)
    }
}

impl DataRead for MemoryHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        fence_data(path)?;
        let blob = self.blobs.lock().unwrap().get(path).cloned();
        if let Some(bytes) = &blob {
            self.record_read(path, bytes.len());
        }
        Ok(blob)
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        // Il prefisso vuoto è la radice dello spazio dati, e non nomina niente
        // apposta: è l'unico path che non passa dal recinto.
        if !prefix.is_empty() {
            fence_data(prefix)?;
        }
        // Semantica di *cartella*, come l'host vero (`KernelHost`), non di
        // prefisso testuale: un finto che si comporta diversamente dal vero è
        // una trappola che scatta il giorno che si cambia chiamante.
        Ok(self
            .blobs
            .lock()
            .unwrap()
            .keys()
            .filter(|k| prefix.is_empty() || k.starts_with(&format!("{prefix}/")))
            .cloned()
            .collect())
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        fence_data(path)?;
        let blob = self.cache_blobs.lock().unwrap().get(path).cloned();
        if let Some(bytes) = &blob {
            self.record_read(path, bytes.len());
        }
        Ok(blob)
    }
}

impl DataWrite for MemoryHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        fence_data(path)?;
        if self.writes_negate.lock().unwrap().contains(path) {
            return Err(PluginError::Io(
                format!("scrittura negata su `{path}`").into(),
            ));
        }
        self.blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        // Il conto sale **solo** sulle scritture riuscite: una scrittura
        // negata non è lavoro fatto sul disco, e contarla renderebbe il
        // contatore inservibile proprio nei banchi che provano i rifiuti.
        let mut writes = self.writes.lock().unwrap();
        let count = writes.entry(path.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += bytes.len();
        Ok(())
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        fence_data(path)?;
        self.blobs.lock().unwrap().remove(path);
        Ok(())
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        fence_data(path)?;
        if self.writes_negate.lock().unwrap().contains(path) {
            return Err(PluginError::Io(
                format!("scrittura cache negata su `{path}`").into(),
            ));
        }
        self.cache_blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        let mut writes = self.writes.lock().unwrap();
        let count = writes.entry(path.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += bytes.len();
        Ok(())
    }
}

impl SettingsRead for MemoryHost {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        let settings = self.settings.lock().unwrap();
        let (spec, value) = settings.get(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        Ok(value.clone().unwrap_or_else(|| spec.kind.default_value()))
    }
}

impl SettingsWrite for MemoryHost {
    /// Il doppio applica **il cancello della chiave** e non quello del
    /// permesso: il secondo è del guard del kernel, il primo è ciò che una
    /// feature scritta come un plugin deve trovarsi davanti anche qui — o il
    /// test proverebbe una scrittura che nell'app vera è un rifiuto.
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        let mut settings = self.settings.lock().unwrap();
        let (spec, slot) = settings.get_mut(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        if !spec.program_writable {
            return Err(PluginError::PermissionDenied(
                format!("l'impostazione `{key}` non si è dichiarata scrivibile da un programma")
                    .into(),
            ));
        }
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        *slot = Some(value);
        Ok(())
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        let mut settings = self.settings.lock().unwrap();
        let (spec, slot) = settings.get_mut(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        if !spec.program_writable {
            return Err(PluginError::PermissionDenied(
                format!("l'impostazione `{key}` non si è dichiarata scrivibile da un programma")
                    .into(),
            ));
        }
        *slot = None;
        Ok(())
    }
}

/// Lo stato di vista del doppio è quello di **un esemplare per volta**, e senza
/// esemplare non c'è: leggere torna `None`, scrivere è `BadArgs`. Non è una
/// mutilazione per comodità — è ciò che risponde l'host vero fuori da una view
/// (`KernelHost`), e un doppio che accettasse la scrittura farebbe passare un
/// provider che nell'app perde quello che crede di ricordare.
impl ViewStateRead for MemoryHost {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        let Some(instance) = self.view_instance.lock().unwrap().clone() else {
            return Ok(None);
        };
        Ok(self
            .view_state
            .lock()
            .unwrap()
            .get(&(instance, key.to_string()))
            .cloned())
    }
}

impl ViewStateWrite for MemoryHost {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        let instance = self.view_instance.lock().unwrap().clone().ok_or_else(|| {
            PluginError::BadArgs(
                "lo stato di vista è di un esemplare di view: dillo con \
                 `MemoryHost::with_instance`"
                    .into(),
            )
        })?;
        let mut states = self.view_state.lock().unwrap();
        match value {
            Some(v) => states.insert((instance, key.to_string()), v),
            None => states.remove(&(instance, key.to_string())),
        };
        Ok(())
    }
}

impl HostEnv for MemoryHost {
    fn now_unix_millis(&self) -> u64 {
        self.now.load(Ordering::Relaxed)
    }

    fn user_locale(&self) -> Locale {
        self.locale.lock().unwrap().clone()
    }

    /// Deterministico, come l'orologio di questo banco: i byte sono un contatore
    /// in little-endian. Un test che generasse identità **vere** non potrebbe
    /// asserire su ciò che produce, e un banco che non si può asserire non
    /// presidia niente. Che siano diversi a ogni chiamata è tutto ciò che serve
    /// a chi verifica di non collidere.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        // Il contatore in little-endian nei primi otto byte, l'indice negli
        // altri. Due chiamate non danno mai lo stesso blocco — che è la sola
        // promessa della capacità vera — e ogni chiamata è prevedibile, che è la
        // sola cosa che rende asseribile un test.
        if self.without_entropy.load(Ordering::Relaxed) {
            return Err(PluginError::PermissionDenied(
                "questo banco non concede entropia".into(),
            ));
        }
        // Il tetto lo porta anche il doppio, e non è pedanteria: un banco che
        // concedesse ciò che l'host vero rifiuta lascerebbe verde un test scritto
        // sopra una richiesta che in produzione non riesce.
        if n > MAX_RANDOM_BYTES {
            return Err(PluginError::BadArgs(
                format!("chiesti {n} byte di caso, il massimo è {MAX_RANDOM_BYTES}").into(),
            ));
        }
        let base = self.entropy.fetch_add(1, Ordering::Relaxed).to_le_bytes();
        Ok((0..n as usize)
            .map(|the| base.get(the).copied().unwrap_or(the as u8))
            .collect())
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.reads_from_context.fetch_add(1, Ordering::Relaxed);
        self.context.lock().unwrap().clone()
    }
}

impl HostEvents for MemoryHost {
    fn emit(&mut self, _event: Event) {}

    fn spawn_job(&mut self, _spec: JobSpec) -> Result<JobId, PluginError> {
        Ok(JobId(0))
    }
}

impl HostQuery for MemoryHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            // Come il kernel: i backlink sono una risposta del grafo, qui
            // seminata a mano. Un target senza backlink è una lista vuota, non
            // un errore.
            // La finestra la applica il doppio come la applica il kernel su una
            // risposta già in memoria (`Paged::window`): una view che paginasse
            // solo contro il finto non sarebbe provata.
            IndexQuery::Backlinks { target, page } => Ok(IndexResult::Backlinks(Paged::window(
                self.backlinks
                    .lock()
                    .unwrap()
                    .get(target.as_str())
                    .cloned()
                    .unwrap_or_default(),
                page,
            ))),
            // Come il kernel: l'outline è servito dai modelli, qui seminato a
            // mano. Documento senza outline → lista vuota, non un errore.
            IndexQuery::Outline { doc } => Ok(IndexResult::Outline(
                self.outlines
                    .lock()
                    .unwrap()
                    .get(doc.as_str())
                    .cloned()
                    .unwrap_or_default(),
            )),
            // **L'anagrafe**, e la serve dai documenti che ha in memoria: è la
            // sola domanda del canale a cui questo doppio può rispondere il
            // vero senza che gliela si semini, perché «cosa c'è» è esattamente
            // ciò che un host in memoria sa di sé. Serve a chi chiede *quali
            // documenti esistono* invece di *quali sono indicizzati* — una
            // distinzione che l'apertura a fasi (§15.7) ha reso osservabile, e
            // che senza questo ramo si proverebbe solo end-to-end.
            //
            // La specie la decide la regola del kernel
            // ([`media::kind_of_ext`]): documento se un formato lo serve,
            // allegato se ha un tipo di contenuto noto, altrimenti ignoto. La
            // cartella si sceglie con la stessa [`in_folder`].
            IndexQuery::Entries {
                of_kind,
                within,
                page,
            } => {
                let entries: Vec<VaultEntry> = self
                    .docs
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|(id, bytes)| {
                        let id = DocId::new(id);
                        let kind = media::kind_of_ext(&id, |_| self.format_of(&id).is_some());
                        VaultEntry {
                            id,
                            kind,
                            size: bytes.len() as u64,
                            mtime: self.now.load(Ordering::Relaxed),
                            fingerprint: None,
                        }
                    })
                    .filter(|entry| of_kind.is_none_or(|kind| entry.kind == kind))
                    .filter(|entry| {
                        within.as_ref().is_none_or(|scope| {
                            in_folder(&entry.id, &scope.path, scope.descendants)
                        })
                    })
                    .collect();
                Ok(IndexResult::Entries(Paged::window(entries, page)))
            }
            // I conteggi seminati sono del vault intero: a chi li chiede per
            // una selezione il doppio non sa rispondere, e lo dice.
            IndexQuery::Tags { matching, page } => {
                if !matching.is_everything() {
                    return Err(PluginError::Unserved(
                        "MemoryHost conta i tag seminati del vault intero, non di una \
                         selezione: usa un Workspace vero"
                            .into(),
                    ));
                }
                Ok(IndexResult::Tags(Paged::window(
                    self.tags.lock().unwrap().clone(),
                    page,
                )))
            }
            // **I documenti che ci sono**, scelti con le foglie che il doppio
            // sa verificare ([`Selection`]) e finiti con la stessa regola del
            // kernel ([`properties::finish`]): ordine, colonne e finestra. Il
            // frontmatter è quello dei modelli seminati; chi ordina o chiede
            // colonne su un documento senza modello riceve `unserved`. Niente
            // rilevanza e niente estratti: quelli li produce un indice.
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                excerpts: _,
            } => {
                let matches = Selection::of(self).expr(&matching)?;
                let models = self.models.lock().unwrap();
                if sort.is_some() || !select.is_none() {
                    if let Some(id) = matches.ids().find(|id| !models.contains_key(id.as_str())) {
                        return Err(unseeded(id));
                    }
                }
                Ok(IndexResult::Documents(properties::finish(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
                    &DateFormats::ISO,
                    |id| models.get(id.as_str()).map(|model| &model.frontmatter),
                )))
            }
            // **La risoluzione**, dai documenti che ha in memoria e con le
            // regole condivise di `fub_abi::rules::path`: le stesse chiavi e la
            // stessa precedenza del grafo del kernel — path, nome, alias dei
            // modelli seminati, poi il file per nome — e fra omonimi vince chi
            // combacia esattamente, poi il path più corto. Il punto dentro il
            // documento non lo cerca (non ha outline propri): `at` resta
            // `None`, che è il degrado del contratto per un punto che non si
            // trova.
            IndexQuery::Resolve { target, from } => Ok(IndexResult::Resolved(
                self.resolve(&target, from.as_ref())
                    .map(fub_abi::traits::ResolvedRef::doc),
            )),
            // I vicini, dagli archi seminati e come li cammina il kernel: i semi
            // sono una selezione ([`Selection`]), e per ognuno, in ordine di
            // id, la camminata in ampiezza fino a `depth`.
            IndexQuery::Neighbors {
                seeds,
                direction,
                depth,
                page,
            } => {
                let from = Selection::of(self).expr(&seeds)?;
                let items = from
                    .ids()
                    .flat_map(|seed| self.neighbors(seed, direction, depth))
                    .collect();
                Ok(IndexResult::Neighbors(Paged::window(items, page)))
            }
            // Le impostazioni le serve, e dal canale dati come il kernel: una
            // feature che le disegnasse chiedendole a una porta diversa nel test
            // non proverebbe la strada che percorre nell'app.
            // Il filtro per plugin **non lo sa servire**, e lo dice invece di
            // ignorarlo: questo doppio non registra chi possiede una chiave, e
            // rispondere «tutte» a chi ne ha chieste alcune farebbe passare per
            // il motivo sbagliato ogni prova che si fidasse del filtro.
            IndexQuery::Settings { plugin: Some(_) } => Err(PluginError::Unserved(
                "MemoryHost non sa di chi è una chiave: chiedi tutte le \
                 impostazioni, o usa un Workspace vero"
                    .into(),
            )),
            IndexQuery::Settings { plugin: None } => Ok(IndexResult::Settings(
                self.settings
                    .lock()
                    .unwrap()
                    .values()
                    .map(|(spec, value)| SettingEntry {
                        spec: spec.clone(),
                        value: value.clone().unwrap_or_else(|| spec.kind.default_value()),
                        source: match value {
                            Some(_) => SettingSource::Vault,
                            None => SettingSource::Default,
                        },
                    })
                    .collect(),
            )),
            // La salute del vault: un doppio senza grafo né indici non ha
            // nessun problema da segnalare, e l'elenco vuoto è la verità — non
            // un finto successo. La paginazione la applica come il kernel su
            // una risposta già in memoria (`Paged::window`).
            IndexQuery::VaultHealth { page, .. } => {
                Ok(IndexResult::VaultHealth(Paged::window(Vec::new(), page)))
            }
            // Il doppio non ha né indice né grafo né frontmatter: per tutto il
            // resto non c'è nessuno che serva la domanda, ed è quella la
            // risposta — non un `BadArgs`, che direbbe che la domanda è
            // malposta.
            _ => Err(PluginError::Unserved(
                "MemoryHost serve solo backlink, outline, tag, archi, impostazioni e \
                 salute del vault seminati a mano, più l'anagrafe, i documenti e la \
                 risoluzione dei riferimenti fra quelli che ha in memoria"
                    .into(),
            )),
        }
    }
}

impl HostCommands for MemoryHost {
    /// Il doppio non ha un registro dei comandi: comporre comandi si prova
    /// contro il kernel, che è l'unico ad averlo. Rispondere `unknown-command`
    /// è la stessa risposta che darebbe l'host vero per un id inesistente, e
    /// non è un finto successo.
    fn run_command(
        &mut self,
        command: &str,
        _args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        Err(PluginError::UnknownCommand(command.into()))
    }

    /// E non ha nemmeno la pila delle operazioni, per la stessa ragione: la
    /// tiene il kernel, che è l'unico che vede passare gli esiti. `None` — cioè
    /// «niente da annullare» — è la risposta vera per un host che non ha mai
    /// eseguito niente, e non un finto successo.
    fn undo_last(&mut self) -> Result<Option<fub_abi::command::Undone>, PluginError> {
        Ok(None)
    }
}

impl TransferRead for MemoryHost {
    fn read_source(
        &self,
        handle: fub_abi::transfer::SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        let sources = self.sources.lock().unwrap();
        let Some(bytes) = sources.get(&handle.0) else {
            return Err(PluginError::BadArgs(
                "questo handle di sorgente non è (o non è più) aperto".into(),
            ));
        };
        let from = (offset.min(bytes.len() as u64)) as usize;
        let a = from.saturating_add(len as usize).min(bytes.len());
        Ok(bytes[from..a].to_vec())
    }
}

impl HostNetwork for MemoryHost {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.requests.lock().unwrap().push(request);
        self.answers.lock().unwrap().pop_front().unwrap_or_else(|| {
            Err(PluginError::Unserved(
                "nessuna risposta preparata: questo banco non ha un filo verso \
                 fuori finché non glielo si dà (`con_risposta`)"
                    .into(),
            ))
        })
    }
}

impl HostServices for MemoryHost {
    /// Il doppio non ha un registro dei plugin: chi prova un servizio lo prova
    /// contro il kernel, che è l'unico ad averlo. `Unserved` è la stessa
    /// risposta che darebbe l'host vero per un `ns` che nessuno offre, e non è
    /// un finto successo.
    fn call_service(
        &mut self,
        service: &str,
        _method: &str,
        _args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        Err(PluginError::Unserved(
            format!("MemoryHost non ha un registro dei plugin: nessuno offre `{service}`").into(),
        ))
    }

    fn export_targets(&self) -> Result<Vec<fub_abi::transfer::ExportTarget>, PluginError> {
        Ok(self
            .exports
            .lock()
            .unwrap()
            .iter()
            .flat_map(|provider| provider.targets())
            .collect())
    }

    /// Lo stesso dispatch e lo stesso sink dell'host vero: la destinazione
    /// sceglie l'exporter, e i byte tornano nel rapporto col tetto di
    /// [`PLUGIN_EXPORT_LIMIT`]. Il doppio non ha capacità per plugin: il
    /// provider legge questo stesso banco.
    fn run_export(
        &mut self,
        request: &fub_abi::transfer::ExportRequest,
    ) -> Result<fub_abi::transfer::ExportReport, PluginError> {
        let provider = self
            .exports
            .lock()
            .unwrap()
            .iter()
            .find(|provider| provider.targets().iter().any(|t| t.id == request.target))
            .cloned()
            .ok_or_else(|| {
                PluginError::BadArgs(
                    format!("destinazione di export ignota: `{}`", request.target).into(),
                )
            })?;
        let mut sink = MemorySink::bounded(PLUGIN_EXPORT_LIMIT);
        provider.export(request, self, &mut sink)
    }

    /// Il primo importer che riconosce la sorgente, come nell'host vero. Un
    /// importer che, importando, chiede di nuovo sé stesso riceve `Conflict`
    /// invece di bloccarsi.
    fn run_import(
        &mut self,
        source: &fub_abi::transfer::ImportSource,
        request: &fub_abi::transfer::ImportRequest,
    ) -> Result<fub_abi::transfer::ImportReport, PluginError> {
        let candidates: Vec<SharedImport> = self.imports.lock().unwrap().clone();
        for candidate in candidates {
            let Ok(mut provider) = candidate.try_lock() else {
                return Err(PluginError::Conflict(
                    "an importer is already importing: an import cannot re-enter it".into(),
                ));
            };
            if provider.can_handle(source) {
                return provider.import(source, request, self);
            }
        }
        Err(PluginError::BadArgs(
            format!(
                "nessun ImportProvider registrato riconosce `{}`",
                source.name
            )
            .into(),
        ))
    }
}

impl GridProvider for MemoryHost {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        self.grid_surfaces.lock().unwrap().clone()
    }

    fn open(
        &mut self,
        surface: &str,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if !self
            .grid_surfaces
            .lock()
            .unwrap()
            .iter()
            .any(|candidate| candidate.id == surface)
        {
            return Err(PluginError::Unserved(
                format!("grid surface `{surface}` is not served").into(),
            ));
        }
        if revision.0.is_empty() {
            return Err(PluginError::BadArgs(
                "grid revision must not be empty".into(),
            ));
        }
        let instance = format!(
            "grid-memory-{}",
            self.grid_next_instance.fetch_add(1, Ordering::Relaxed) + 1
        );
        let session = GridSession {
            instance: instance.clone(),
            revision,
            sheets: Vec::new(),
        };
        session.validate()?;
        self.grid_calls
            .lock()
            .unwrap()
            .push(format!("open:{surface}:{instance}"));
        self.grid_sessions
            .lock()
            .unwrap()
            .insert(instance, session.clone());
        Ok(session)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        request.validate()?;
        let session = self
            .grid_sessions
            .lock()
            .unwrap()
            .get(instance)
            .cloned()
            .ok_or_else(|| {
                PluginError::Unserved(format!("grid instance `{instance}` is not open").into())
            })?;
        if session.revision != request.revision {
            return Err(PluginError::Conflict(
                format!("grid instance `{instance}` revision is stale").into(),
            ));
        }
        let window = self
            .grid_windows
            .lock()
            .unwrap()
            .get(&(instance.to_owned(), request.sheet.clone()))
            .cloned()
            .ok_or_else(|| {
                PluginError::Unserved(
                    format!("no scripted grid window for `{instance}/{}`", request.sheet).into(),
                )
            })?;
        if window.revision != request.revision {
            return Err(PluginError::Conflict(
                "scripted grid window revision is stale".into(),
            ));
        }
        window.validate()?;
        self.grid_calls
            .lock()
            .unwrap()
            .push(format!("window:{instance}:{}", request.sheet));
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let mut sessions = self.grid_sessions.lock().unwrap();
        let session = sessions.get_mut(instance).ok_or_else(|| {
            PluginError::Unserved(format!("grid instance `{instance}` is not open").into())
        })?;
        if session.revision != request.revision {
            return Err(PluginError::Conflict(
                format!("grid instance `{instance}` revision is stale").into(),
            ));
        }
        let commit = self
            .grid_commits
            .lock()
            .unwrap()
            .get(instance)
            .cloned()
            .ok_or_else(|| {
                PluginError::Unserved(format!("no scripted grid commit for `{instance}`").into())
            })?;
        commit.validate()?;
        if commit.revision == request.revision {
            return Err(PluginError::Conflict(
                "scripted grid commit did not advance revision".into(),
            ));
        }
        session.revision = commit.revision.clone();
        self.grid_calls
            .lock()
            .unwrap()
            .push(format!("apply:{instance}"));
        Ok(commit)
    }

    fn reload(
        &mut self,
        instance: &str,
        expected: Revision,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if revision.0.is_empty() {
            return Err(PluginError::BadArgs(
                "grid revision must not be empty".into(),
            ));
        }
        let mut sessions = self.grid_sessions.lock().unwrap();
        let session = sessions.get_mut(instance).ok_or_else(|| {
            PluginError::Unserved(format!("grid instance `{instance}` is not open").into())
        })?;
        if session.revision != expected {
            return Err(PluginError::Conflict(
                format!("grid instance `{instance}` revision is stale").into(),
            ));
        }
        session.revision = revision;
        self.grid_calls
            .lock()
            .unwrap()
            .push(format!("reload:{instance}"));
        Ok(session.clone())
    }

    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        if self
            .grid_sessions
            .lock()
            .unwrap()
            .remove(instance)
            .is_none()
        {
            return Err(PluginError::Unserved(
                format!("grid instance `{instance}` is not open").into(),
            ));
        }
        self.grid_windows
            .lock()
            .unwrap()
            .retain(|(candidate, _), _| candidate != instance);
        self.grid_commits.lock().unwrap().remove(instance);
        self.grid_calls
            .lock()
            .unwrap()
            .push(format!("close:{instance}"));
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.grid_sessions.lock().unwrap().clear();
        self.grid_windows.lock().unwrap().clear();
        self.grid_commits.lock().unwrap().clear();
        self.grid_calls.lock().unwrap().push("shutdown".into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::format::{FormatCapabilities, FormatDescriptor};
    use fub_abi::locale::{HourCycle, Weekday};
    use fub_abi::traits::EntryKind;

    /// Il locale del doppio parte **indeterminato**, come quello del contratto:
    /// un banco che partisse italiano nasconderebbe proprio i posti in cui una
    /// feature dà per scontata una lingua. Chi ne prova una che formatta o che
    /// ordina lo dichiara, e allora lo vede.
    #[test]
    fn the_double_starts_with_nobody_having_spoken() {
        let host = MemoryHost::new();
        assert_eq!(host.user_locale(), Locale::default());
        assert!(!host.user_locale().has_language());

        let host = host.with_locale(Locale {
            language: "it-IT".into(),
            timezone: "Europe/Rome".into(),
            utc_offset_minutes: 120,
            first_day_of_week: Weekday::Monday,
            hour_cycle: HourCycle::H23,
        });
        assert_eq!(host.user_locale().language_base(), "it");
        assert_eq!(host.user_locale().utc_offset_minutes, 120);
    }

    /// L'entropia del doppio è **deterministica e mai ripetuta**: la prima
    /// proprietà rende asseribile un test, la seconda è la sola promessa della
    /// capacità vera.
    #[test]
    fn the_doubles_entropy_never_repeats() {
        let host = MemoryHost::new();
        let first = host.random_bytes(16).unwrap();
        let second = host.random_bytes(16).unwrap();
        assert_eq!(first.len(), 16);
        assert_ne!(first, second);
    }

    /// Il doppio risponde per **estensione**, che è la stessa chiave del
    /// registro vero: una feature che si prova qui e poi gira sul kernel deve
    /// trovare la stessa regola, o il doppio starebbe provando un'altra cosa.
    #[test]
    fn the_double_answers_the_format_by_extension_and_none_for_what_nobody_claims() {
        let host = MemoryHost::new().with_format(
            "md",
            DocumentFormat {
                descriptor: FormatDescriptor::text("markdown", "Markdown", &["md"]),
                capabilities: FormatCapabilities::default(),
            },
        );

        let markdown = host
            .format_of(&DocId::new("Progetti/Nota.md"))
            .expect("`.md` è seminato");
        assert_eq!(markdown.descriptor.id, "markdown");
        assert!(
            host.format_of(&DocId::new("allegato.pdf")).is_none(),
            "nessuno rivendica `.pdf`: `none` è una risposta, non un errore"
        );
        assert!(
            host.format_of(&DocId::new("LICENSE")).is_none(),
            "un nome senza estensione non ha niente da chiedere al registro"
        );
    }

    /// Un modello non seminato è un errore, non un modello vuoto: chi prova una
    /// feature sul modello deve dire **quale** modello sta provando, o proverebbe
    /// il caso «documento vuoto» credendo di provare il proprio.
    #[test]
    fn the_double_refuses_to_invent_a_model_nobody_seeded() {
        let host = MemoryHost::new().with_document("nota.md", "# c'è");
        let outcome = host.read_model(&DocId::new("nota.md"));
        assert!(
            matches!(outcome, Err(PluginError::Internal(msg)) if msg.to_string().contains("nota.md"))
        );
    }

    /// I byte grezzi attraversano il doppio senza conversioni: 0..255, BOM e
    /// CRLF tornano identici, e la revisione è dei byte prodotti.
    #[test]
    fn raw_bytes_come_back_untouched() {
        let mut host = MemoryHost::new();
        let all: Vec<u8> = (0u8..=255).collect();
        // `.bin` non è rivendicato da nessun formato seminato: la porta raw lo
        // deposita comunque, come il kernel che accetta file opachi.
        let id = DocId::new("allegato.bin");
        let revision = host.write_document_bytes(&id, &all, None).unwrap();
        assert_eq!(revision, Revision::of_bytes(&all));
        assert_eq!(host.read_document_bytes(&id).unwrap(), all);
        assert_eq!(host.document_revision(&id).unwrap(), revision);
        assert!(
            matches!(host.read_document(&id), Err(PluginError::Io(_))),
            "0..255 non è UTF-8: come il vault vero, si dice di no"
        );

        let bom_crlf = b"\xef\xbb\xbfprima\r\nseconda\r\n".to_vec();
        let text_id = DocId::new("nota.md");
        let text_rev = host
            .write_document_bytes(&text_id, &bom_crlf, None)
            .unwrap();
        assert_eq!(text_rev, Revision::of_bytes(&bom_crlf));
        assert_eq!(host.read_document_bytes(&text_id).unwrap(), bom_crlf);
    }

    /// `None` è create-only: la seconda creazione rifiuta e lascia i byte vecchi.
    #[test]
    fn creating_twice_keeps_the_first_bytes() {
        let mut host = MemoryHost::new();
        let id = DocId::new("allegato.bin");
        host.write_document_bytes(&id, &[1, 2, 3], None).unwrap();
        let err = host
            .write_document_bytes(&id, &[9, 9, 9], None)
            .unwrap_err();
        assert!(matches!(err, PluginError::AlreadyExists(_)), "{err:?}");
        assert_eq!(host.read_document_bytes(&id).unwrap(), vec![1, 2, 3]);
    }

    /// Una CAS fallita non scrive niente: i byte restano quelli di prima.
    #[test]
    fn a_stale_cas_leaves_the_bytes_where_they_were() {
        let mut host = MemoryHost::new();
        let id = DocId::new("allegato.bin");
        let first = host.write_document_bytes(&id, &[1, 2, 3], None).unwrap();
        let stale = Revision::of_bytes(&[0]);
        let err = host
            .write_document_bytes(&id, &[9, 9, 9], Some(stale))
            .unwrap_err();
        assert!(matches!(err, PluginError::Conflict(_)), "{err:?}");
        assert_eq!(host.read_document_bytes(&id).unwrap(), vec![1, 2, 3]);
        let second = host
            .write_document_bytes(&id, &[9, 9, 9], Some(first))
            .unwrap();
        assert_eq!(second, Revision::of_bytes(&[9, 9, 9]));
        assert_eq!(host.read_document_bytes(&id).unwrap(), vec![9, 9, 9]);
    }

    /// Il cestino tiene byte, non testo: un allegato cestinato torna identico.
    #[test]
    fn trash_keeps_raw_bytes() {
        let mut host = MemoryHost::new();
        let all: Vec<u8> = (0u8..=255).collect();
        let id = DocId::new("allegato.bin");
        host.write_document_bytes(&id, &all, None).unwrap();
        let trashed = host.trash_document(&id).unwrap();
        assert!(host.read_document_bytes(&id).is_err());
        let back = host.restore_document(&trashed, None).unwrap();
        assert_eq!(back, id);
        assert_eq!(host.read_document_bytes(&id).unwrap(), all);
    }

    #[test]
    fn memory_host_uses_the_grid_protocol_as_a_scripted_provider() {
        let revision = Revision("r1".into());
        let next = Revision("r2".into());
        let surface = GridSurfaceSpec::new("sheet", "grid");
        let window = GridWindow {
            revision: revision.clone(),
            sheet: "sheet-1".into(),
            row_start: 0,
            column_start: 0,
            total_rows: 1,
            total_columns: 1,
            rows: Vec::new(),
            columns: Vec::new(),
            cells: Vec::new(),
        };
        let commit = GridCommit {
            revision: next.clone(),
            edit: fub_abi::grid::GridSourceEdit {
                from: 0,
                to: 0,
                deleted: String::new(),
                inserted: String::new(),
            },
            invalidation: fub_abi::grid::GridInvalidation::All,
        };
        let mut host = MemoryHost::new()
            .with_grid_surface(surface)
            .with_grid_window("grid-memory-1", window);
        host = host.with_grid_commit("grid-memory-1", commit);

        let session = host.open("sheet", "=1", revision.clone()).unwrap();
        let returned = host
            .window(
                &session.instance,
                GridWindowRequest {
                    revision: revision.clone(),
                    sheet: "sheet-1".into(),
                    row_start: 0,
                    row_count: 1,
                    column_start: 0,
                    column_count: 1,
                },
            )
            .unwrap();
        assert_eq!(returned.revision, revision);
        let applied = host
            .apply(
                &session.instance,
                GridApplyRequest {
                    revision: Revision("r1".into()),
                    patches: vec![fub_abi::grid::GridCellPatch {
                        cell: fub_abi::grid::GridCellKey {
                            sheet: "sheet-1".into(),
                            row: "row-1".into(),
                            column: "column-1".into(),
                        },
                        before: Some("".into()),
                        after: "2".into(),
                    }],
                },
            )
            .unwrap();
        assert_eq!(applied.revision, next);
        assert_eq!(
            host.grid_calls(),
            vec![
                "open:sheet:grid-memory-1",
                "window:grid-memory-1:sheet-1",
                "apply:grid-memory-1"
            ]
        );
    }

    fn neighbors(
        host: &MemoryHost,
        seeds: Vec<&str>,
        direction: LinkDirection,
        depth: u8,
    ) -> Vec<String> {
        let seeds = if seeds.is_empty() {
            fub_abi::query::QueryExpr::default()
        } else {
            fub_abi::query::QueryExpr::of(QueryPredicate::Docs {
                docs: seeds.into_iter().map(DocId::new).collect(),
            })
        };
        let IndexResult::Neighbors(found) = host
            .query_index(IndexQuery::Neighbors {
                seeds,
                direction,
                depth,
                page: None,
            })
            .unwrap()
        else {
            panic!("una risposta fuori tema");
        };
        found
            .items
            .iter()
            .map(|n| format!("{}<{}@{}", n.doc, n.via, n.depth))
            .collect()
    }

    /// I vicini partono **dai semi** e camminano come il grafo del kernel: in
    /// ampiezza, ognuno una volta sola alla distanza minima. Prima il doppio
    /// ignorava i semi e rispondeva con tutti gli archi del vault.
    #[test]
    fn the_neighbors_start_from_the_seeds_and_walk_like_the_graph() {
        let host = MemoryHost::new()
            .with_document("a.md", "")
            .with_document("b.md", "")
            .with_document("c.md", "")
            .with_document("d.md", "")
            .with_edge("a.md", "b.md")
            .with_edge("a.md", "b.md")
            .with_edge("b.md", "c.md")
            .with_edge("c.md", "a.md")
            .with_edge("d.md", "a.md");
        assert_eq!(
            neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 1),
            ["b.md<a.md@1"]
        );
        assert_eq!(
            neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 3),
            ["b.md<a.md@1", "c.md<b.md@2"],
            "chi parte non torna vicino di sé stesso"
        );
        assert_eq!(
            neighbors(&host, vec!["a.md"], LinkDirection::Inbound, 1),
            ["c.md<a.md@1", "d.md<a.md@1"]
        );
        assert_eq!(
            neighbors(&host, vec!["a.md"], LinkDirection::Both, 1),
            ["b.md<a.md@1", "c.md<a.md@1", "d.md<a.md@1"]
        );
        assert_eq!(
            neighbors(&host, vec![], LinkDirection::Outbound, 1),
            ["b.md<a.md@1", "c.md<b.md@1", "a.md<c.md@1", "a.md<d.md@1"],
            "senza semi, ogni documento in ordine di id"
        );
        assert!(neighbors(&host, vec!["a.md"], LinkDirection::Outbound, 0).is_empty());
    }

    fn documents(
        host: &MemoryHost,
        matching: fub_abi::query::QueryExpr,
    ) -> Result<Vec<String>, PluginError> {
        match host.query_index(IndexQuery::Documents {
            matching,
            sort: None,
            select: Default::default(),
            page: None,
            excerpts: Default::default(),
        })? {
            IndexResult::Documents(found) => {
                Ok(found.items.iter().map(|m| m.doc.to_string()).collect())
            }
            _ => panic!("una risposta fuori tema"),
        }
    }

    /// Il filtro si **valuta** con le regole condivise, oppure si rifiuta:
    /// prima il doppio lo ignorava e rispondeva con tutti i documenti, allegati
    /// compresi, e una prova che si fidava del filtro passava per il motivo
    /// sbagliato.
    #[test]
    fn the_double_evaluates_the_filter_or_says_it_cannot() {
        let mut model = DocumentModel::empty(DocId::new("Progetti/Idea.md"));
        model
            .frontmatter
            .0
            .insert("stato".into(), serde_json::json!("aperto"));
        let host = MemoryHost::new()
            .with_document("Nota.md", "")
            .with_document("Progetti/Idea.md", "")
            .with_binary_document("Progetti/foto.png", b"png")
            .with_model("Progetti/Idea.md", model);
        let folder = || {
            fub_abi::query::QueryExpr::of(QueryPredicate::Folder {
                path: "Progetti".into(),
                descendants: true,
            })
        };
        assert_eq!(
            documents(&host, fub_abi::query::QueryExpr::default()).unwrap(),
            ["Nota.md", "Progetti/Idea.md"],
            "un allegato non è un documento"
        );
        assert_eq!(documents(&host, folder()).unwrap(), ["Progetti/Idea.md"]);
        let text = fub_abi::query::QueryExpr::of(QueryPredicate::Text(
            fub_abi::query::TextQuery::terms("idea"),
        ));
        assert!(matches!(
            documents(&host, text),
            Err(PluginError::Unserved(_))
        ));
        let property = || {
            fub_abi::query::QueryExpr::of(QueryPredicate::Property {
                filter: fub_abi::traits::PropertyFilter {
                    key: "stato".into(),
                    test: fub_abi::traits::PropertyTest::Exists,
                },
            })
        };
        assert!(
            matches!(documents(&host, property()), Err(PluginError::Unserved(msg)) if msg.to_string().contains("Nota.md")),
            "senza il modello di Nota.md il doppio non sa se ha la proprietà"
        );
        let host = host.with_model("Nota.md", DocumentModel::empty(DocId::new("Nota.md")));
        assert_eq!(documents(&host, property()).unwrap(), ["Progetti/Idea.md"]);

        assert_eq!(
            host.list_documents(None).unwrap().items,
            [DocId::new("Nota.md"), DocId::new("Progetti/Idea.md")]
        );
        let IndexResult::Entries(entries) = host
            .query_index(IndexQuery::Entries {
                of_kind: None,
                within: Some(fub_abi::traits::FolderScope::direct("Progetti")),
                page: None,
            })
            .unwrap()
        else {
            panic!("una risposta fuori tema");
        };
        let kinds: Vec<(String, EntryKind)> = entries
            .items
            .into_iter()
            .map(|entry| (entry.id.to_string(), entry.kind))
            .collect();
        assert_eq!(
            kinds,
            [
                ("Progetti/Idea.md".to_string(), EntryKind::Document),
                ("Progetti/foto.png".to_string(), EntryKind::Asset),
            ]
        );
    }
}
