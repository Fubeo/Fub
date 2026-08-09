//! Il **banco del lato provider**: un host in memoria, e una suite di
//! conformità con cui provare un provider contro il **contratto**.
//!
//! Stava in `fub-features`, privato e `#[cfg(test)]` — cioè raggiungibile
//! nemmeno dagli integration test del suo stesso crate, solo dai suoi unit test.
//! Ora è qui ([decisione
//! 0054](../../../../docs/decisions/0054-il-banco-del-lato-provider.md)).
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

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

pub mod conformita;

use fub_abi::command::CommandOutcome;
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::event::Event;
use fub_abi::format::DocumentFormat;
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel, Heading, Span};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::session::{
    AnchoredSelection, AnchoredSelections, PaneMode, SelectionSet, ViewContext,
};
use fub_abi::settings::{SettingEntry, SettingSource, SettingSpec, SettingValue};
use fub_abi::traits::{
    BacklinkRef, DataRead, DataWrite, DocumentMatch, EntryKind, HostCommands, HostEnv, HostEvents,
    HostNetwork, HostQuery, HostServices, IndexQuery, IndexResult, JobId, JobSpec, LinkDirection,
    NeighborRef, Page, Paged, SettingsRead, SettingsWrite, TagCount, TransferRead, TrashEntry,
    VaultEntry, VaultRead, VaultStructure, VaultWrite, ViewStateRead, ViewStateWrite,
};
use fub_abi::{PluginError, MAX_RANDOM_BYTES};

/// Storage dei blob e dei documenti in memoria, più un orologio pilotabile.
#[derive(Default)]
pub struct MemoryHost {
    blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    /// Le sorgenti di import aperte (decisione 0102): chiave → byte.
    ///
    /// In memoria come tutto il resto, ma dietro un handle come quelle vere, ed
    /// è il punto: chi scrive un importer che legge a pezzi deve poterlo provare
    /// senza un kernel e senza un file. Si semina con
    /// [`MemoryHost::con_sorgente`].
    sources: Mutex<BTreeMap<u64, Vec<u8>>>,
    /// Contatore da cui nascono le chiavi delle sorgenti. Sale e non si ricicla,
    /// come nel kernel vero.
    aperte: AtomicU64,
    /// I documenti **a byte**, come stanno nel vault vero: un doppio che li
    /// tenesse come `String` non saprebbe rappresentare un allegato, e chi
    /// scrive un estrattore a `SourceKind::Bytes` non avrebbe come provarlo
    /// senza un kernel (§21.8).
    docs: Mutex<BTreeMap<String, Vec<u8>>>,
    now: AtomicU64,
    /// Il contesto servito da [`HostEnv::active_context`], come lo
    /// pubblicherebbe la shell.
    context: Mutex<Option<ViewContext>>,
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
    archi: Mutex<Vec<(String, String)>>,
    /// Modelli finti per [`VaultRead::read_model`], seminati per documento. Il
    /// doppio **non parsa** — come non parsa per l'outline — e la ragione è la
    /// stessa: un host in memoria che si portasse dentro un `FormatProvider`
    /// proverebbe la feature contro *quel* provider invece che contro il
    /// contratto. Chi vuole il parse vero ha i test end-to-end col kernel.
    models: Mutex<BTreeMap<String, DocumentModel>>,
    /// Formati finti per [`VaultRead::format_of`], seminati per **estensione**
    /// senza il punto — che è la chiave con cui risponde anche il registro vero.
    formats: Mutex<BTreeMap<String, DocumentFormat>>,
    /// Il cestino: id nel cestino → (voce, sorgente). È in memoria come il
    /// resto, ma ha la stessa forma di quello vero — due id per voce, e il
    /// ripristino che rifiuta un path occupato — perché è quella forma che le
    /// feature provano.
    trash: Mutex<BTreeMap<String, (TrashEntry, String)>>,
    /// Acceso, la **prossima** `free_name` occupa il nome che risponde.
    ///
    /// Si spegne da sé, perché la corsa da provare è quella di *una* domanda: un
    /// interruttore che restasse acceso renderebbe ogni nome libero occupato, e
    /// il banco proverebbe «create_document rifiuta sempre» invece di «rifiuta
    /// chi ha perso la corsa».
    ruba_il_nome_libero: AtomicBool,
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
    /// ricorda qualcosa lo dice con [`MemoryHost::con_esemplare`].
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
    senza_entropia: std::sync::atomic::AtomicBool,
    /// Le risposte di rete **preparate**, nell'ordine in cui verranno servite.
    ///
    /// Vuota è il default, e il default **rifiuta**: un banco che rispondesse
    /// `200` a una richiesta che nessuno ha preparato renderebbe verde un test
    /// che chiede alla rete cose che il suo autore non sapeva di chiedere. Il
    /// rifiuto è `Unserved` e non un errore inventato, perché è esattamente ciò
    /// che risponde un host montato senza client (§23.3): il doppio non finge
    /// di avere un filo.
    risposte: Mutex<std::collections::VecDeque<Result<HttpResponse, PluginError>>>,
    /// Le richieste **viste**, in ordine. È la metà che serve ad asserire: che
    /// un provider abbia chiesto *quell'URL con quel verbo* è la cosa che si
    /// vuole provare, e senza questo elenco si potrebbe solo provare cosa ne ha
    /// fatto.
    richieste: Mutex<Vec<HttpRequest>>,
    /// I path dello spazio dati su cui `data_write` rifiuta. Vuoto è il
    /// default. Si accende con [`MemoryHost::nega_scrittura`].
    scritture_negate: Mutex<std::collections::BTreeSet<String>>,
    /// Il **conto** delle `data_write`, per path: quante volte e quanti byte.
    ///
    /// I blob dicono com'è finito lo spazio dati; questo dice **quanto è
    /// costato arrivarci**, ed è l'unica delle due cose che vede un difetto di
    /// prestazioni. Un file riscritto mille volte e uno scritto una sola
    /// lasciano lo stesso `blobs`, e senza questo contatore un presidio sulla
    /// quantità di lavoro sarebbe verde in tutti e due i casi. È un conto di
    /// operazioni e non un tempo apposta: su una macchina condivisa un tempo
    /// non è un segnale.
    scritture: Mutex<BTreeMap<String, (usize, usize)>>,
}

impl MemoryHost {
    pub fn new() -> Self {
        let host = MemoryHost::default();
        host.now.store(1_700_000_000_000, Ordering::Relaxed);
        host
    }

    /// La prossima domanda di un nome libero la **perde**: qualcun altro prende
    /// quel nome fra la risposta e la scrittura.
    ///
    /// È la finestra che `VaultRead::free_name` dichiara di lasciare aperta, e
    /// che senza questa maniglia non si costruisce se non con dei thread — cioè
    /// con una speranza sulla schedulazione al posto di un fatto.
    pub fn la_prossima_corsa_del_nome_si_perde(&self) -> &Self {
        self.ruba_il_nome_libero.store(true, Ordering::SeqCst);
        self
    }

    /// Il locale che questo doppio serve: chi prova una feature che formatta o
    /// che ordina lo dichiara, invece di scoprire il default.
    pub fn con_locale(self, locale: Locale) -> Self {
        *self.locale.lock().unwrap() = locale;
        self
    }

    /// Un host che non concede entropia: `random_bytes` rifiuta nominando il
    /// permesso, e chi costruisce un'identità deve accorgersene.
    pub fn senza_entropia(self) -> Self {
        self.senza_entropia.store(true, Ordering::Relaxed);
        self
    }

    /// Apre una sorgente di import **dietro un handle**, e restituisce la
    /// [`ImportSource`] da dare al provider (decisione 0102).
    ///
    /// Il prologo è quello che leggerebbe il kernel. Serve a provare la strada a
    /// pezzi senza un file: un importer scritto contro `SourceContent::Bytes` e
    /// mai provato contro questa è un importer che si scoprirà sul vault vero di
    /// chi migra, che è il momento peggiore.
    pub fn con_sorgente(
        &self,
        name: impl Into<String>,
        media_type: Option<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> fub_abi::transfer::ImportSource {
        use fub_abi::transfer::{ImportSource, SourceContent, SourceHandle, StreamedSource};
        let bytes = bytes.into();
        let handle = self
            .aperte
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
    pub fn con_risposta(self, risposta: HttpResponse) -> Self {
        self.risposte.lock().unwrap().push_back(Ok(risposta));
        self
    }

    /// Prepara un **guasto** del trasporto: è l'altra metà, e serve tanto
    /// quanto la prima — chi scarica deve saper dire cosa fa quando la rete non
    /// c'è, e un banco che sa solo riuscire non glielo chiede mai.
    pub fn con_guasto_di_rete(self, why: &str) -> Self {
        self.risposte
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
    pub fn nega_scrittura(&self, path: &str) {
        self.scritture_negate
            .lock()
            .unwrap()
            .insert(path.to_string());
    }

    /// Quante volte quel path è stato scritto, e quanti byte in tutto.
    ///
    /// `(0, 0)` per un path mai scritto: non essere mai passati di lì è un
    /// conto, non un'assenza di risposta.
    pub fn scritture_su(&self, path: &str) -> (usize, usize) {
        self.scritture
            .lock()
            .unwrap()
            .get(path)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Le richieste di rete che questo doppio ha visto, in ordine.
    pub fn richieste_di_rete(&self) -> Vec<HttpRequest> {
        self.richieste.lock().unwrap().clone()
    }

    /// Sposta l'orologio in avanti di `ms`.
    pub fn avanza(&self, ms: u64) {
        self.now.fetch_add(ms, Ordering::Relaxed);
    }

    /// Sposta l'orologio **indietro** di `ms`: è ciò che fa NTP, un cambio di
    /// fuso o una VM ripresa — e ciò contro cui il versioning deve difendersi.
    pub fn arretra(&self, ms: u64) {
        self.now.fetch_sub(ms, Ordering::Relaxed);
    }

    /// Aggiunge un documento al vault finto (stile builder).
    pub fn con_documento(self, id: &str, source: &str) -> Self {
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
    pub fn con_documento_binario(self, id: &str, bytes: &[u8]) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), bytes.to_vec());
        self
    }

    /// Fa sparire un documento **senza emettere eventi**: è ciò che accade
    /// quando un `DocumentRemoved` va perso in un troncamento della coda.
    pub fn dimentica_documento(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }

    /// Sposta un documento **senza emettere eventi**: il rename perso.
    pub fn rinomina_di_nascosto(&self, from: &str, to: &str) {
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
    pub fn set_selections(&self, selezioni: &[(usize, &str)]) {
        let mut ancorate = selezioni
            .iter()
            .map(|(start, text)| {
                AnchoredSelection::new(Span::new(*start, start + text.len()), *text)
            })
            .collect::<Vec<_>>();
        let primary = ancorate.remove(0);
        self.map_context(|c| {
            c.selections = Some(SelectionSet::Anchored(AnchoredSelections {
                primary,
                secondary: ancorate,
            }));
        });
    }

    /// Le stesse, a buffer sporco: il testo è vero, le coordinate no — per
    /// tutte.
    pub fn set_floating_selections(&self, testi: &[&str]) {
        use fub_abi::session::{FloatingSelection, FloatingSelections};
        let mut fluttuanti = testi
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
    pub fn con_arco(self, from: &str, to: &str) -> Self {
        self.archi
            .lock()
            .unwrap()
            .push((from.to_string(), to.to_string()));
        self
    }

    /// Semina i backlink che [`HostQuery::query_index`] restituirà per `target`
    /// (stile builder).
    pub fn con_backlink(self, target: &str, sorgenti: &[&str]) -> Self {
        let refs = sorgenti
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
    pub fn con_outline(self, doc: &str, headings: &[Heading]) -> Self {
        self.outlines
            .lock()
            .unwrap()
            .insert(doc.to_string(), headings.to_vec());
        self
    }

    /// Semina l'aggregazione dei tag che [`IndexQuery::Tags`] restituirà
    /// (stile builder): coppie nome→conteggio.
    pub fn con_tags(self, tags: &[(&str, u32)]) -> Self {
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
    pub fn con_modello(self, doc: &str, model: DocumentModel) -> Self {
        self.models.lock().unwrap().insert(doc.to_string(), model);
        self
    }

    /// Semina il formato che [`VaultRead::format_of`] restituirà per i documenti
    /// con questa estensione (stile builder).
    pub fn con_formato(self, ext: &str, format: DocumentFormat) -> Self {
        self.formats.lock().unwrap().insert(ext.to_string(), format);
        self
    }

    /// **Dichiara** un'impostazione, come farebbe il manifest di chi la offre
    /// (stile builder). Senza dichiarazione una chiave non esiste: è la stessa
    /// regola del kernel, e il doppio la ripete perché è quella che una feature
    /// incontra.
    pub fn con_impostazione(self, spec: SettingSpec) -> Self {
        self.settings
            .lock()
            .unwrap()
            .insert(spec.key.clone(), (spec, None));
        self
    }

    /// Dichiara un'impostazione **e le dà un valore**, come se l'utente
    /// l'avesse scritta.
    pub fn con_valore(self, spec: SettingSpec, value: SettingValue) -> Self {
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
    pub fn con_esemplare(self, instance: &str) -> Self {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
        self
    }

    /// Cambia esemplare **tenendo ciò che è stato salvato**: è come riaprire lo
    /// stesso pannello in un'altra istanza, ed è il modo di provare che due
    /// esemplari non si mescolano senza costruire due host.
    pub fn passa_a_esemplare(&self, instance: &str) {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
    }
}

impl VaultRead for MemoryHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        let bytes = self.read_document_bytes(id)?;
        // Come il vault vero: non si indovina un encoding, si dice di no.
        String::from_utf8(bytes)
            .map_err(|e| PluginError::Io(format!("{id} non è UTF-8: {e}").into()))
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        self.docs
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::BadArgs(format!("{id} non esiste").into()))
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        Ok(Revision::of(&self.read_document(id)?))
    }

    /// In ordine di id e a finestra, come il kernel: un doppio che
    /// restituisse tutto in ordine di hash farebbe passare i test a chi si
    /// affida a un ordine che in produzione non c'è.
    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        let mut ids: Vec<DocId> = self.docs.lock().unwrap().keys().map(DocId::new).collect();
        ids.sort();
        Ok(Paged::window(ids, page))
    }

    /// Il modello **seminato**, non uno parsato: un documento che esiste ma di
    /// cui nessuno ha seminato il modello risponde come uno che non esiste — chi
    /// prova una feature sul modello deve dire quale modello sta provando.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.models
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::Internal(format!("{id}: nessun modello seminato").into()))
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        let ext = id
            .as_str()
            .rsplit_once('.')
            .map(|(_, e)| e.to_lowercase())?;
        self.formats.lock().unwrap().get(&ext).cloned()
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
        let libero = (0u32..)
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
        if self.ruba_il_nome_libero.swap(false, Ordering::SeqCst) {
            docs.insert(libero.as_str().to_string(), b"di qualcun altro".to_vec());
        }
        libero
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        let trash = self.trash.lock().unwrap();
        let mut voci: Vec<TrashEntry> = trash.values().map(|(e, _)| e.clone()).collect();
        voci.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.id.cmp(&b.id)));
        Ok(voci)
    }
}

impl VaultWrite for MemoryHost {
    /// La scrittura intera come la fa l'host vero, **guardia compresa**: se chi
    /// scrive dice da cosa era partito e il testo non è più quello, `Conflict` e
    /// non si scrive niente. Vale qui la ragione scritta sotto per `apply_edit`
    /// — un doppio che accettasse qualunque base non proverebbe niente proprio
    /// della cosa che questa firma esiste per rendere impossibile.
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        let mut docs = self.docs.lock().unwrap();
        if let WriteBase::DescendsFrom(attesa) = base {
            let adesso = docs
                .get(id.as_str())
                .map(|b| Revision::of(&String::from_utf8_lossy(b)));
            if adesso.as_ref() != Some(&attesa) {
                return Err(PluginError::Conflict(
                    format!("`{id}` è cambiato da sotto").into(),
                ));
            }
        }
        docs.insert(id.to_string(), source.as_bytes().to_vec());
        Ok(Revision::of(source))
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
        if self.docs.lock().unwrap().contains_key(id.as_str()) {
            return Err(PluginError::BadArgs(format!("{id} esiste già").into()));
        }
        // Il nome è libero — la riga sopra l'ha appena verificato — quindi non
        // c'è nessuna revisione da cui discendere.
        self.write_document(id, source, WriteBase::Dictated)
            .map(|_| ())
    }

    /// Sposta il sorgente e basta: questo doppio non ha un grafo, quindi non
    /// riscrive i backlink entranti. Che la rinomina *li* riscriva è una
    /// proprietà del kernel e si prova contro il kernel (`tests/`); qui si
    /// prova che una feature sappia chiederla.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let mut docs = self.docs.lock().unwrap();
        if from == to {
            return Ok(());
        }
        if docs.contains_key(to.as_str()) {
            return Err(PluginError::BadArgs(format!("{to} esiste già").into()));
        }
        let source = docs
            .remove(from.as_str())
            .ok_or_else(|| PluginError::BadArgs(format!("{from} non esiste").into()))?;
        docs.insert(to.to_string(), source);
        Ok(())
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        let source = self.read_document(id)?;
        self.docs.lock().unwrap().remove(id.as_str());
        let stamp = self.trashed.fetch_add(1, Ordering::Relaxed);
        let trashed = DocId::new(format!(".trash/{id}.{stamp}"));
        self.trash.lock().unwrap().insert(
            trashed.to_string(),
            (
                TrashEntry {
                    id: trashed.clone(),
                    original: id.clone(),
                    deleted_at: self.now_unix_millis() / 1000,
                    size: source.len() as u64,
                },
                source,
            ),
        );
        Ok(trashed)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        let (voce, source) = self
            .trash
            .lock()
            .unwrap()
            .get(entry.as_str())
            .cloned()
            .ok_or_else(|| PluginError::BadArgs(format!("{entry} non è nel cestino").into()))?;
        let target = to.unwrap_or(voce.original);
        self.create_document(&target, &source)?;
        self.trash.lock().unwrap().remove(entry.as_str());
        Ok(target)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        let mut trash = self.trash.lock().unwrap();
        let quante = trash.len() as u64;
        trash.clear();
        Ok(quante)
    }
}

impl DataRead for MemoryHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        Ok(self.blobs.lock().unwrap().get(path).cloned())
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
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
}

impl DataWrite for MemoryHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        if self.scritture_negate.lock().unwrap().contains(path) {
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
        let mut scritture = self.scritture.lock().unwrap();
        let conto = scritture.entry(path.to_string()).or_insert((0, 0));
        conto.0 += 1;
        conto.1 += bytes.len();
        Ok(())
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.blobs.lock().unwrap().remove(path);
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
                 `MemoryHost::con_esemplare`"
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
        if self.senza_entropia.load(Ordering::Relaxed) {
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
            .map(|i| base.get(i).copied().unwrap_or(i as u8))
            .collect())
    }

    fn active_context(&self) -> Option<ViewContext> {
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
            // Solo i documenti: il doppio non ha allegati, quindi a una domanda
            // su `Asset` risponde con l'elenco vuoto, che è la verità.
            IndexQuery::Entries { of_kind, page, .. } => {
                let entries: Vec<VaultEntry> = match of_kind {
                    Some(EntryKind::Document) | None => self
                        .docs
                        .lock()
                        .unwrap()
                        .iter()
                        .map(|(id, source)| VaultEntry {
                            id: DocId::new(id),
                            kind: EntryKind::Document,
                            size: source.len() as u64,
                            mtime: self.now.load(Ordering::Relaxed),
                            fingerprint: None,
                        })
                        .collect(),
                    Some(_) => Vec::new(),
                };
                Ok(IndexResult::Entries(Paged::window(entries, page)))
            }
            IndexQuery::Tags { page, .. } => Ok(IndexResult::Tags(Paged::window(
                self.tags.lock().unwrap().clone(),
                page,
            ))),
            // **I documenti che ci sono**, come l'anagrafe qui sopra e per la
            // stessa ragione: «quali documenti esistono» è ciò che un host in
            // memoria sa di sé senza che glielo si semini. Niente rilevanza e
            // niente estratti — quelli li produce un indice, e qui non ce n'è
            // uno — quindi la selezione si **ignora**: chi vuole provare un
            // filtro vuole un kernel vero.
            IndexQuery::Documents { page, .. } => Ok(IndexResult::Documents(Paged::window(
                self.docs
                    .lock()
                    .unwrap()
                    .keys()
                    .map(|id| DocumentMatch {
                        doc: DocId::new(id),
                        score: None,
                        snippet: None,
                        highlights: Vec::new(),
                        occurrences: Default::default(),
                        properties: Default::default(),
                    })
                    .collect(),
                page,
            ))),
            // I vicini, dagli archi seminati. Il verso lo si onora — è l'unica
            // cosa che questo ramo possa sbagliare in modo invisibile — e la
            // profondità no: oltre il primo passo servirebbe una chiusura
            // transitiva, cioè un grafo, cioè il kernel. Chiederne di più è
            // `Unserved`, che è la risposta onesta.
            IndexQuery::Neighbors {
                direction,
                depth,
                page,
                ..
            } => {
                if depth > 1 {
                    return Err(PluginError::Unserved(
                        "MemoryHost non cammina il grafo: chiedi depth 1, o usa un Workspace vero"
                            .into(),
                    ));
                }
                let archi = self.archi.lock().unwrap();
                let mut items = Vec::new();
                for (from, to) in archi.iter() {
                    // `via` è da dove si parte, `doc` dove si arriva: entrante
                    // vuol dire che i due si scambiano.
                    if matches!(direction, LinkDirection::Outbound | LinkDirection::Both) {
                        items.push(NeighborRef {
                            doc: DocId::new(to),
                            via: DocId::new(from),
                            depth: 1,
                        });
                    }
                    if matches!(direction, LinkDirection::Inbound | LinkDirection::Both) {
                        items.push(NeighborRef {
                            doc: DocId::new(from),
                            via: DocId::new(to),
                            depth: 1,
                        });
                    }
                }
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
            // Il doppio non ha né indice né grafo né frontmatter: per tutto il
            // resto non c'è nessuno che serva la domanda, ed è quella la
            // risposta — non un `BadArgs`, che direbbe che la domanda è
            // malposta.
            _ => Err(PluginError::Unserved(
                "MemoryHost serve solo backlink, outline, tag, archi e impostazioni \
                 seminati a mano, più i documenti che ha in memoria"
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
        let da = (offset.min(bytes.len() as u64)) as usize;
        let a = da.saturating_add(len as usize).min(bytes.len());
        Ok(bytes[da..a].to_vec())
    }
}

impl HostNetwork for MemoryHost {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.richieste.lock().unwrap().push(request);
        self.risposte
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::format::{FormatCapabilities, FormatDescriptor};
    use fub_abi::locale::{HourCycle, Weekday};

    /// Il locale del doppio parte **indeterminato**, come quello del contratto:
    /// un banco che partisse italiano nasconderebbe proprio i posti in cui una
    /// feature dà per scontata una lingua. Chi ne prova una che formatta o che
    /// ordina lo dichiara, e allora lo vede.
    #[test]
    fn the_double_starts_with_nobody_having_spoken() {
        let host = MemoryHost::new();
        assert_eq!(host.user_locale(), Locale::default());
        assert!(!host.user_locale().has_language());

        let host = host.con_locale(Locale {
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
        let primo = host.random_bytes(16).unwrap();
        let secondo = host.random_bytes(16).unwrap();
        assert_eq!(primo.len(), 16);
        assert_ne!(primo, secondo);
    }

    /// Il doppio risponde per **estensione**, che è la stessa chiave del
    /// registro vero: una feature che si prova qui e poi gira sul kernel deve
    /// trovare la stessa regola, o il doppio starebbe provando un'altra cosa.
    #[test]
    fn the_double_answers_the_format_by_extension_and_none_for_what_nobody_claims() {
        let host = MemoryHost::new().con_formato(
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
        let host = MemoryHost::new().con_documento("nota.md", "# c'è");
        let esito = host.read_model(&DocId::new("nota.md"));
        assert!(
            matches!(esito, Err(PluginError::Internal(msg)) if msg.to_string().contains("nota.md"))
        );
    }
}
