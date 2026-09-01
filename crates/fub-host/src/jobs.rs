//! [`JobHost`]: le capacità di un lavoro lungo, prese **per chiamata**.
//!
//! Il §9.1 chiedeva che il lavoro lungo vedesse il vault, e la
//! [decisione 0027](../../../docs/decisions/0183-composizione-host-kernel.md)
//! ha messo l'`HostApi` nella firma di
//! [`Plugin::run_job`](fub_abi::traits::Plugin::run_job). Quella è la metà che
//! scadeva col freeze; questo è il pezzo che la rende utilizzabile — e non
//! poteva stare nel kernel, perché il kernel non sa che esiste un lock: il
//! `Workspace` è un oggetto normale, ed è chi lo monta a metterlo dietro un
//! `RwLock` ([decisione 0024](../../../docs/decisions/README.md)).
//!
//! # La regola, in una riga
//!
//! **Un prestito per chiamata, mai per la durata del job**, e il verso giusto:
//! `read()` per le letture, `write()` per le scritture. Il contrario — prendere
//! il prestito una volta e tenerlo — sarebbe stato più semplice da scrivere e
//! avrebbe riportato il problema esattamente dove stava: un export di duemila
//! note terrebbe il vault fermo per tutto il tempo dell'export, che è ciò che il
//! §9.1 esisteva per togliere.
//!
//! Da qui la conseguenza che il contratto dichiara: **il vault può cambiare fra
//! due chiamate**. Non è un difetto di questo tipo, è ciò che vuol dire non
//! fermare il mondo; la guardia contro il cambio è quella di tutti — una `base`
//! e un [`Conflict`](fub_abi::PluginError::Conflict).
//!
//! # E la cancellazione, che è la stessa idea al contrario
//!
//! Un prestito per chiamata vuol dire anche **una decisione per chiamata**, e
//! da lì viene l'annullamento (§9.3,
//! [decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)): un job
//! annullato non riceve un segnale da controllare, riceve
//! [`PluginError::Cancelled`] alla capacità successiva. Non c'è niente da
//! ricordarsi di chiamare, e un job scritto prima che la cancellazione esistesse
//! si ferma comunque.
//!
//! Ciò che **non** rifiuta sono le sei capacità che non possono fallire —
//! `free_name`, `format_of`, `now_unix_millis`, `active_context`, `emit`,
//! `report_progress` — e non è una dimenticanza: non hanno dove metterlo, un
//! rifiuto. Nessuna delle sei cambia il vault, e la ragione è strutturale: nel
//! contratto **tutto ciò che cambia il vault può fallire**, quindi tutto ciò che
//! cambia il vault si può rifiutare. Le ultime due restano aperte di proposito —
//! l'ultima cosa che un job annullato può voler dire è che sta smettendo, e a
//! che punto era.
//!
//! # E il progresso, che è l'identità al contrario
//!
//! La cancellazione arriva al job perché il suo host **smette di servirlo**; il
//! progresso esce dal job perché il suo host **lo firma**. Sono la stessa mossa
//! nei due versi: le due cose che un job non sa di sé — quando smettere e come
//! si chiama — le sa chi lo esegue (§10.3,
//! [decisione 0035](../../../docs/decisions/0184-eventi-accodati-e-job.md)).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::custody::Custody;

use fub_abi::command::{CommandOutcome, InvokeMode};
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::format::DocumentFormat;
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{
    DataRead, DataWrite, HostApi, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery,
    HostServices, IndexQuery, IndexResult, JobId, JobProgress, JobSpec, Page, Paged, ReadApi,
    SettingsRead, SettingsWrite, TransferRead, TrashEntry, VaultRead, VaultStructure, VaultWrite,
    ViewStateRead, ViewStateWrite,
};
use fub_abi::{Event, PluginError};
use fub_kernel::host::Guard;
use fub_kernel::{ReadOnly, Workspace};

/// L'[`HostApi`] di un job: intestato a un plugin, servito da un workspace
/// condiviso, **senza tenerlo**.
///
/// Si costruisce sul thread che esegue il job e si passa a
/// [`Plugin::run_job`](fub_abi::traits::Plugin::run_job). Le capacità sono
/// quelle del plugin e non quelle di chi esegue: la politica del §7.3 sta
/// davanti come in ogni altro prestito, perché a metterla è il kernel dentro
/// `with_host`/`with_read_host`, non questo tipo.
///
/// # Cosa costa
///
/// Un lock preso e rilasciato per capacità. Su un job che cammina il vault sono
/// migliaia di prese, ed è il prezzo dichiarato: sono prese **condivise**, che
/// non si aspettano fra loro e che chi salva scavalca ([decisione 0024]), contro
/// un'unica presa lunga che non le farebbe aspettare — le farebbe non accadere.
///
/// [decisione 0024]: ../../../docs/decisions/README.md
pub struct JobHost {
    workspace: Custody<Workspace>,
    plugin: String,
    /// Modalità effettiva delle capacità annidate (`Apply` o simulazione).
    mode: InvokeMode,
    /// **L'identità che il job non ha** (§10.3,
    /// [decisione 0035](../../../docs/decisions/0184-eventi-accodati-e-job.md)).
    ///
    /// `Plugin::run_job` riceve il nome dell'entry point, gli argomenti e
    /// l'host — non l'id — quindi un job non può nominare sé stesso in un
    /// evento. Chi può è questo host, e per questo
    /// [`report_progress`](fub_abi::traits::HostEvents::report_progress) non
    /// ha un parametro per l'id: non c'è modo di sbagliarlo e non c'è modo di
    /// raccontare il progresso di un altro.
    ///
    /// `None` è l'host di nessun job — quello che un test costruisce a mano per
    /// avere le capacità di un plugin fuori dal pool. Lì un progresso non ha di
    /// chi essere, e la porta torna a essere il no-op che il contratto dichiara.
    job: Option<JobId>,
    /// La bandiera dell'**annullamento** (§9.3, decisione 0032): alzata, ogni
    /// capacità che può dire di no dice di no.
    ///
    /// Sta qui e non nel contratto perché la cancellazione **non aggiunge una
    /// capacità**: non c'è un `is_cancelled()` che un job debba ricordarsi di
    /// chiamare — c'è un host che smette di servirlo. Un job scritto senza
    /// sapere che la cancellazione esiste si ferma comunque, alla prima cosa
    /// che prova a fare.
    cancelled: Arc<AtomicBool>,
}

impl JobHost {
    /// Le capacità di `plugin` sul workspace di una sessione aperta.
    ///
    /// L'id è quello con cui il plugin si è **dichiarato**: un id che nessuno ha
    /// dichiarato riceve un host che nega tutto dicendo perché — la stessa
    /// risposta di `Workspace::with_host`, e per la stessa ragione (il kernel
    /// non presta capacità a una stringa).
    pub fn new(workspace: Custody<Workspace>, plugin: impl Into<String>) -> Self {
        JobHost {
            workspace,
            plugin: plugin.into(),
            mode: InvokeMode::Apply,
            job: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Usa `mode` per le capacità annidate. I job normali restano `Apply`;
    /// un provider staccato dal lock usa `DryRun` quando il suo recinto è di
    /// sola lettura, così una macro simulata non rientra in `Apply`.
    pub fn in_mode(mut self, mode: InvokeMode) -> Self {
        self.mode = mode;
        self
    }

    /// Dice a questo host **di quale job** è l'host, che è tutto ciò che serve
    /// perché il job possa raccontarsi (§10.3).
    ///
    /// Come la bandiera dell'annullamento, l'id lo sa il runner: sono le due
    /// cose che il job non può sapere di sé — quando smettere, e come si chiama.
    pub fn for_job(mut self, id: JobId) -> Self {
        self.job = Some(id);
        self
    }

    /// Lega questo host alla bandiera con cui il suo job si può **annullare**.
    ///
    /// La tiene il runner, che è l'unico a sapere quale job è quale; alzarla è
    /// tutto ciò che «annullare» vuol dire.
    pub fn cancelled_by(mut self, flag: Arc<AtomicBool>) -> Self {
        self.cancelled = flag;
        self
    }

    /// Host figlio per un provider invocato da questo contesto. Condivide la
    /// cancellazione, ma non l'identità del job: un comando annidato non può
    /// attribuirsi il progresso del job che lo ha chiamato.
    fn for_provider(&self, plugin: impl Into<String>, mode: InvokeMode) -> Self {
        JobHost {
            workspace: self.workspace.clone(),
            plugin: plugin.into(),
            mode,
            job: None,
            cancelled: Arc::clone(&self.cancelled),
        }
    }

    /// Il rifiuto da dare a chi è stato annullato, se lo è stato.
    ///
    /// Si guarda **prima** di prendere il prestito: un job annullato smette
    /// anche di mettersi in fila per il lock, che è metà del motivo per cui lo
    /// si annulla.
    fn stopped(&self) -> Result<(), PluginError> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(PluginError::Cancelled(
                format!("the job of `{}` has been cancelled", self.plugin).into(),
            ));
        }
        Ok(())
    }

    /// Una lettura che può **rifiutare**: prima la bandiera, poi il prestito.
    fn read_result<R>(
        &self,
        f: impl FnOnce(&dyn ReadApi) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.stopped()?;
        self.reading(f)?
    }

    /// Una scrittura che può **rifiutare**. Tutto ciò che cambia il vault passa
    /// di qui, ed è la ragione per cui la cancellazione non ha bisogno di
    /// nient'altro: nel contratto **tutto ciò che cambia il vault può fallire**,
    /// quindi tutto ciò che cambia il vault si può rifiutare.
    fn write_result<R>(
        &mut self,
        f: impl FnOnce(&mut dyn HostApi) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.stopped()?;
        self.writing(f)?
    }

    /// Una lettura: prestito **condiviso**, e N job che leggono non si aspettano
    /// né fra loro né con le view che disegnano.
    ///
    /// **Può rispondere di no** da quando prendere il prestito è una domanda
    /// (decisione 0120). Le capacità che un esito ce l'hanno lo propagano; le
    /// cinque che non ce l'hanno — `free_name`, `format_of`, `now_unix_millis`,
    /// `user_locale`, `active_context`, e `emit` di là — degradano al valore che
    /// il contratto già prevede per «non lo so», e la ragione per cui va bene è
    /// che quel job è **già finito**: il pool si ferma al primo veleno, quindi
    /// nessuna di quelle risposte fa più da premessa a niente.
    fn reading<R>(&self, f: impl FnOnce(&dyn ReadApi) -> R) -> Result<R, PluginError> {
        let ws = self.workspace.read()?;
        Ok(ws.with_read_host(&self.plugin, f))
    }

    /// Una scrittura: prestito **esclusivo**, tenuto per il tempo di una
    /// capacità sola. Ciò che ne nasce — parse, grafo, indici, eventi, handler —
    /// succede lì dentro, come per ogni altra scrittura del kernel.
    fn writing<R>(&self, f: impl FnOnce(&mut dyn HostApi) -> R) -> Result<R, PluginError> {
        let mut ws = self.workspace.write()?;
        Ok(ws.with_host_mode(&self.plugin, self.mode, f))
    }
}

// Le dodici famiglie. Sono righe di delega e nessuna decisione: ogni
// decisione è già stata presa un livello più in basso (il recinto dei `DocId`,
// la politica dei permessi, il dispatch degli eventi), e ripeterne una qui
// sarebbe una seconda idea della stessa regola.

impl VaultRead for JobHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.read_result(|h| h.read_document(id))
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.read_document_bytes(id))
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.read_result(|h| h.document_revision(id))
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.read_result(|h| h.list_documents(page))
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.reading(|h| h.free_name(id))
            .unwrap_or_else(|_| id.clone())
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.read_result(|h| h.read_model(id))
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.reading(|h| h.format_of(id)).unwrap_or_default()
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.read_result(|h| h.list_trash())
    }
}

impl VaultWrite for JobHost {
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.write_result(|h| h.write_document(id, source, base.clone()))
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.write_result(|h| h.apply_edit(id, request))
    }
}

impl VaultStructure for JobHost {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.write_result(|h| h.create_document(id, source))
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.write_result(|h| h.rename_document(from, to))
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.write_result(|h| h.trash_document(id))
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.write_result(|h| h.restore_document(entry, to))
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.write_result(|h| h.empty_trash())
    }
}

impl DataRead for JobHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.read_result(|h| h.data_read(path))
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.read_result(|h| h.data_list(prefix))
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.read_result(|h| h.cache_read(path))
    }
}

impl DataWrite for JobHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.write_result(|h| h.data_write(path, bytes))
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.write_result(|h| h.data_remove(path))
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.write_result(|h| h.cache_write(path, bytes))
    }
}

/// Un job non disegna una view, quindi **non ha uno stato di vista**: leggere
/// torna `None` (che è il caso normale di chi non ha mai salvato) e scrivere è
/// l'errore che il contratto dichiara. Non è una mutilazione di questo host: è
/// la stessa riga che vale per un `EventHandler` e per un comando, scritta qui
/// perché qui la si legge.
impl ViewStateRead for JobHost {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        self.read_result(|h| h.view_state(key))
    }
}

impl ViewStateWrite for JobHost {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.write_result(|h| h.set_view_state(key, value.clone()))
    }
}

impl SettingsRead for JobHost {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.read_result(|h| h.setting(key))
    }
}

impl SettingsWrite for JobHost {
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.write_result(|h| h.set_setting(key, value.clone()))
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.write_result(|h| h.reset_setting(key))
    }
}

impl HostEnv for JobHost {
    fn now_unix_millis(&self) -> u64 {
        self.reading(|h| h.now_unix_millis()).unwrap_or_default()
    }

    /// Come il contesto qui sotto: quello di **adesso**. Un job che dura può
    /// attraversare un cambio di lingua o l'ora legale, e ciò che scrive dopo va
    /// scritto come lo legge chi lo sta aspettando.
    fn user_locale(&self) -> Locale {
        self.reading(|h| h.user_locale()).unwrap_or_default()
    }

    /// La sola delle quattro capacità di `HostEnv` che passa da `read_result`, e
    /// non per scelta di questo modulo: è l'unica che ha un esito, e da quando
    /// ce l'ha (decisione 0094) la regola della
    /// [0032](../../../docs/decisions/0183-composizione-host-kernel.md) — *la
    /// cancellazione non aggiunge una capacità, toglie le altre* — la può
    /// raggiungere. Prima non poteva: un job annullato che chiedeva byte li
    /// riceveva, perché la firma non aveva un posto in cui dire di no.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.random_bytes(n))
    }

    /// Che pannello guarda l'utente **adesso**, non quando il job è partito: un
    /// job dura, e un contesto congelato all'avvio sarebbe una risposta vecchia
    /// che nessuno saprebbe riconoscere come tale.
    fn active_context(&self) -> Option<ViewContext> {
        self.reading(|h| h.active_context()).unwrap_or_default()
    }
}

impl HostEvents for JobHost {
    /// Emettere prende il prestito **esclusivo**: un evento entra nella coda del
    /// dispatcher e da lì raggiunge gli handler, che scrivono.
    fn emit(&mut self, event: Event) {
        let _ = self.writing(|h| h.emit(event));
    }

    /// Un job può chiederne un altro: la coda è la stessa, e a drenarla è sempre
    /// chi possiede i thread.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.write_result(|h| h.spawn_job(spec))
    }

    /// **Il timbro**: il job dice a che punto è, e chi lo dice per lui è questo
    /// host, che l'identità ce l'ha (§10.3).
    ///
    /// Non passa da `with_host` come tutto il resto, e non è una scorciatoia: le
    /// capacità sono ciò che si presta a un *plugin*, e qui il fatto da
    /// registrare non è del plugin — è di **questo job**, che il contratto non
    /// dà modo di nominare. Il prestito esclusivo lo prende lo stesso, perché
    /// dall'altra parte c'è una tabella da aggiornare e una coda da drenare.
    ///
    /// Non si nega a un job annullato, come `emit`: l'ultima cosa che un job che
    /// sta smettendo può voler dire è a che punto era arrivato.
    fn report_progress(&mut self, progress: JobProgress) {
        let Some(id) = self.job else {
            return;
        };
        if let Ok(mut ws) = self.workspace.write() {
            ws.notes_job_progress(id, progress);
        }
    }
}

impl HostQuery for JobHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.read_result(|h| h.query_index(query))
    }
}

impl HostCommands for JobHost {
    /// Un comando annidato conserva il turno di mutazione ma **rilascia il
    /// `RwLock`** durante `CommandProvider::invoke`, come il percorso top-level.
    /// Il proxy figlio riacquisisce capacità strette una chiamata alla volta.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_nested_provider_command(command, args.clone(), self.mode)? {
                Some(prepared) => prepared,
                None => return ws.invoke_nested_maintenance_command(command, args, self.mode),
            }
        };

        let owner = prepared.owner().to_string();
        let host_mode = prepared.host_mode();
        let outcome = if let Some(why) = prepared.read_only_reason() {
            let host = self.for_provider(owner, host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = self.for_provider(owner, host_mode);
            prepared.invoke(&mut host)
        };

        let mut ws = workspace.write()?;
        ws.finish_provider_command(prepared, outcome)
    }

    /// Come sopra, e per la stessa ragione: annullare è scrivere, quindi entra
    /// nel giro sincrono invece di portarsi via il vault.
    fn undo_last(&mut self) -> Result<Option<fub_abi::command::Undone>, PluginError> {
        self.write_result(|h| h.undo_last())
    }
}

/// Sotto prestito **condiviso**, e la decisione 0102 lo scrive dove conta: un
/// import di un vault intero legge la sorgente per minuti, e servirlo da
/// `writing` terrebbe il lock esclusivo per tutto quel tempo — cioè affamerebbe
/// chi scrive esattamente come farebbe una lettura di documento, ma per minuti
/// invece che per microsecondi. È la ragione per cui `TransferRead` sta in
/// [`ReadApi`](fub_abi::traits::ReadApi) e non su `HostApi`.
impl TransferRead for JobHost {
    fn read_source(
        &self,
        handle: fub_abi::transfer::SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        self.read_result(|h| h.read_source(handle, offset, len))
    }
}

impl HostNetwork for JobHost {
    /// **L'unica capacità che non passa dal prestito del workspace**, e non è
    /// una scorciatoia: è la sola la cui durata l'host non governa.
    ///
    /// Tutte le altre righe di questo file delegano dentro `reading` o
    /// `writing`, cioè tenendo il lock per il tempo della chiamata — che per
    /// una lettura di documento è microscopico. Una richiesta di rete dura
    /// quanto la rete: tenere il prestito condiviso per quel tempo affamerebbe
    /// chi scrive, che è precisamente il difetto contro cui la
    /// [0024](../../../docs/decisions/README.md)
    /// ha scelto l'`RwLock` — e lo farebbe su una chiamata che **il vault non
    /// lo tocca affatto**.
    ///
    /// Quindi il lock si prende due volte e per un istante: una per il permesso
    /// e il filo, una — implicita — per ciò che chi chiama farà del risultato.
    /// Il permesso si rilegge **adesso** invece di catturarlo all'avvio del job,
    /// perché un plugin revocato mentre una richiesta è in volo deve trovare il
    /// cancello chiuso alla successiva, non alla fine del job.
    ///
    /// La cancellazione si guarda **due volte**, prima e dopo aver preso il
    /// filo, ed è la lezione della
    /// [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md) presa
    /// sul serio: questa è la cosa più lunga che un job possa fare, quindi è
    /// quella in cui *la cancellazione toglie le altre capacità* conta di più.
    /// Fermare la richiesta **già partita** è parte della stessa domanda: il
    /// token arriva al transport e il suo reader chiude la connessione al primo
    /// controllo, senza aspettare il tetto globale dell'host.
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.stopped()?;
        let (client, granted) = {
            let ws = self.workspace.read()?;
            (ws.network(), ws.granted_policy(&self.plugin))
        };
        self.stopped()?;
        let Some(client) = client else {
            return Err(PluginError::Unserved(
                "this host is mounted without a network client".into(),
            ));
        };
        // Lo stesso `Guard` di tutti gli altri: il cancello è uno solo, e chi
        // gira dentro un job non ne attraversa uno più largo.
        Guard::new(client.as_ref(), granted).fetch_cancelled(request, self.cancelled.as_ref())
    }
}

impl HostServices for JobHost {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.write_result(|h| h.call_service(service, method, args))
    }
}
