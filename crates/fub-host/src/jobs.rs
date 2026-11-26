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

use crate::custody::{Custody, WriteTurn};
use crate::query::query_workspace;
use crate::stop_relay::StopRelay;

use fub_abi::command::{CommandOutcome, Failure, InvokeMode, PlannedEdit, UndoStep};
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::format::{DocumentFormat, LinkInsert};
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel, TaskMarker};
use fub_abi::net::{HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::rules::path_policy::fenced_doc_id;
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{
    DataRead, DataWrite, HostApi, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery,
    HostServices, IndexQuery, IndexResult, JobId, JobProgress, JobSpec, Page, Paged, ReadApi,
    SettingsRead, SettingsWrite, TransferRead, TrashEntry, VaultRead, VaultStructure, VaultWrite,
    ViewStateRead, ViewStateWrite,
};
use fub_abi::transfer::{
    ExportReport, ExportRequest, ExportTarget, ImportReport, ImportRequest, ImportSource,
};
use fub_abi::{Event, PluginError};
use fub_kernel::host::{
    authorize_export, authorize_import, authorize_path, authorize_restore, Capability, Guard,
    Policy,
};
use fub_kernel::transfer::{MemorySink, PLUGIN_EXPORT_LIMIT};
use fub_kernel::workspace::{
    DeferredEvents, EventDrain, PreparedFormatEdit, PreparedMaintenanceRebuild,
    PreparedPluginDataIo,
};
use fub_kernel::{
    authorize_query, filter_query_result, IndexBatchStep, PreparedReadOnlyCommand, ReadOnly,
    RenameRecoveryPosition, Workspace,
};

mod porte_host;
mod porte_vault;

/// L'[`HostApi`] di un job: intestato a un plugin, servito da un workspace
/// condiviso, **senza tenerlo**.
///
/// Si costruisce sul thread che esegue il job e si passa a
/// [`Plugin::run_job`](fub_abi::traits::Plugin::run_job). Le capacità sono
/// quelle del plugin e non quelle di chi esegue: le porte normali ricevono il
/// `Guard` del kernel, mentre le callback staccate rileggono la stessa policy
/// prima della preparazione.
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
    /// L'esemplare di view quando questo proxy serve una callback staccata.
    /// I job e i provider annidati restano `None`.
    instance: Option<String>,
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
    /// Le bandiere di **chi contiene** questo host, quando è l'host di una
    /// lettura col suo frame: il job e le letture più fuori. L'host è fermo se
    /// è alzata la sua bandiera o una di queste, così annullare il job ferma
    /// anche le sue letture; spegnere il plugin di una lettura alza invece
    /// solo la bandiera della lettura, e il job riceve un `Cancelled` da
    /// `invoke_command` senza essere annullato. Vuota per tutti gli altri.
    outer_stops: Vec<Arc<AtomicBool>>,
    /// **I comandi di sola lettura che stanno girando sopra questo host**, dal
    /// più esterno: ciò su cui si rifiuta la ricorsione di un comando che non
    /// passa dalla pila condivisa del workspace
    /// ([`Workspace::prepare_read_only_provider_command`]).
    ///
    /// Vuota per un job e per l'ingresso dell'utente. I comandi che scrivono
    /// non ci finiscono: la loro ricorsione la rifiuta la pila condivisa, che
    /// col turno è di chi la usa.
    chain: Vec<String>,
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
            instance: None,
            job: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            outer_stops: Vec::new(),
            chain: Vec::new(),
        }
    }

    /// Usa `mode` per le capacità annidate. I job normali restano `Apply`;
    /// un provider staccato dal lock usa `DryRun` quando il suo recinto è di
    /// sola lettura, così una macro simulata non rientra in `Apply`.
    pub fn in_mode(mut self, mode: InvokeMode) -> Self {
        self.mode = mode;
        self
    }

    /// Intesta il proxy a un esemplare di view. Lo stato di view è una capacità
    /// dell'esemplare, non del plugin in astratto, quindi il timbro viaggia col
    /// proxy e viene applicato a ogni singola acquisizione del workspace.
    pub(crate) fn for_view_instance(mut self, instance: impl Into<String>) -> Self {
        self.instance = Some(instance.into());
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
            instance: None,
            job: None,
            cancelled: Arc::clone(&self.cancelled),
            outer_stops: self.outer_stops.clone(),
            chain: self.chain.clone(),
        }
    }

    /// Host figlio per una **lettura** col suo frame: ha la bandiera `own`,
    /// figlia di quelle di questo host. Le sue bandiere sono quelle che
    /// guarda, e le stesse che la lettura iscrive fra quelle in volo.
    pub(crate) fn for_read(
        &self,
        plugin: impl Into<String>,
        mode: InvokeMode,
        own: Arc<AtomicBool>,
    ) -> Self {
        let mut outer_stops = self.outer_stops.clone();
        outer_stops.push(Arc::clone(&self.cancelled));
        JobHost {
            cancelled: own,
            outer_stops,
            ..self.for_provider(plugin, mode)
        }
    }

    /// Il rifiuto da dare a chi è stato annullato, se lo è stato.
    ///
    /// Si guarda **prima** di prendere il prestito: un job annullato smette
    /// anche di mettersi in fila per il lock, che è metà del motivo per cui lo
    /// si annulla.
    fn stopped(&self) -> Result<(), PluginError> {
        let outer = self.outer_stops.iter();
        if std::iter::once(&self.cancelled)
            .chain(outer)
            .any(|flag| flag.load(Ordering::Relaxed))
        {
            return Err(self.cancelled_error());
        }
        Ok(())
    }

    fn cancelled_error(&self) -> PluginError {
        PluginError::Cancelled(format!("the job of `{}` has been cancelled", self.plugin).into())
    }

    /// Il turno di scrittura per **un job**, cioè per chi sta dentro il codice di
    /// un componente e potrebbe tenerne l'istanza.
    ///
    /// Aspetta come [`Custody::write_turn`], ma può rinunciare: se l'attesa
    /// chiude un ciclo con un salvataggio che aspetta quell'istanza risponde con
    /// un conflitto, e se il job è stato annullato risponde di no invece di
    /// restare in fila. Vedi [`crate::waits`].
    fn turn<'a>(
        &self,
        workspace: &'a Custody<Workspace>,
    ) -> Result<WriteTurn<'a, Workspace>, PluginError> {
        self.stopped()?;
        workspace.write_turn_yielding(&|| self.stopped())
    }

    /// Applica la policy corrente del caller prima di staccare una callback dal
    /// workspace. La decisione resta quella unica di [`Policy`].
    fn authorize_caller(
        &self,
        capability: Capability,
        action: impl FnOnce() -> String,
    ) -> Result<(), PluginError> {
        let policy = self.workspace.read()?.granted_policy(&self.plugin);
        // Comandi e servizi non hanno uno scope di path: l'helper condiviso
        // applica quindi soltanto il cancello della famiglia.
        authorize_path(&policy, capability, "", action)
    }

    /// Il provider del documento, preparato sotto la lettura e autorizzato
    /// con la stessa policy di `read_model`: il chiamante lo invoca dopo aver
    /// rilasciato il lock.
    fn prepare_format_edit(
        &self,
        doc: &DocId,
        with_source: bool,
        why: &str,
    ) -> Result<Option<PreparedFormatEdit>, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.read()?;
        let policy = workspace.granted_policy(&self.plugin);
        authorize_path(&policy, Capability::VaultRead, doc.as_str(), || {
            format!("{why} from the format of `{doc}`")
        })?;
        workspace.prepare_format_edit(doc, with_source)
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
        self.writing_until(&|| self.stopped(), f)?
    }

    fn prepare_data_io(
        &self,
        capability: Capability,
        path: &str,
        action: impl Into<String>,
    ) -> Result<PreparedPluginDataIo, PluginError> {
        let action = action.into();
        let workspace = self.workspace.read()?;
        if self.mode == InvokeMode::DryRun && capability == Capability::DataWrite {
            authorize_path(
                &ReadOnly {
                    why: "simulazione del comando",
                },
                capability,
                path,
                || action.clone(),
            )?;
        }
        authorize_path(
            &workspace.granted_policy(&self.plugin),
            capability,
            path,
            || action,
        )?;
        workspace.prepare_plugin_data_io(&self.plugin, path)
    }

    fn mutate_setting_detached(
        &mut self,
        key: &str,
        value: Option<SettingValue>,
        action: impl Into<String>,
    ) -> Result<(), PluginError> {
        self.stopped()?;
        let action = action.into();
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_family(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    Capability::SettingsWrite,
                    || action.clone(),
                )?;
            }
            authorize_family(
                &ws.granted_policy(&self.plugin),
                Capability::SettingsWrite,
                || action,
            )?;
            ws.prepare_program_setting_mutation(key, value)?
        };
        let applied = prepared.invoke()?;
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_setting_mutation_deferred(applied)
        };
        finish_events(&workspace, deferred)
    }

    fn write_document_detached(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
        capability: Capability,
        action: &str,
        require_new: bool,
    ) -> Result<Revision, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            if self.mode == InvokeMode::DryRun {
                authorize_path(
                    &ReadOnly {
                        why: "simulazione del comando",
                    },
                    capability,
                    id.as_str(),
                    || format!("{action} `{id}`"),
                )?;
            }
            authorize_path(
                &ws.granted_policy(&self.plugin),
                capability,
                id.as_str(),
                || format!("{action} `{id}`"),
            )?;
            let id = fenced_doc_id(id)?;
            if require_new {
                ws.prepare_document_creation(&id)
                    .map_err(PluginError::from)?
            } else {
                ws.prepare_document_write(&id, base)
                    .map_err(PluginError::from)?
            }
        };
        let model = prepared.parse(source).map_err(PluginError::from)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut detached = self.for_provider(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut detached)
        });
        // Il disco si scrive fuori dal prestito esclusivo e sotto il turno
        // (IMP-1805): la CAS resta quella preparata, e il prestito serve solo
        // alle tabelle.
        let placed = prepared
            .place(source, before_write)
            .map_err(PluginError::from)?;
        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_placed_document_write(placed, model)
        };
        let pending = pending.invoke_indexes();
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_document_write_deferred(pending)
        };
        finish_events(&workspace, deferred)
    }

    fn apply_edit_detached(
        &mut self,
        id: &DocId,
        request: EditRequest,
    ) -> Result<EditReport, PluginError> {
        let workspace = self.workspace.clone();
        let _turn = self.turn(&workspace)?;
        self.apply_edit_detached_inner(id, request)
    }

    fn apply_edit_detached_inner(
        &mut self,
        id: &DocId,
        request: EditRequest,
    ) -> Result<EditReport, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        // Rientrante: chi passa da `apply_edit_detached` lo ha già. Il recupero
        // delle rinomine ci arriva diretto, e la scrittura sul disco fuori dal
        // prestito conta sul turno per non avere un altro writer in mezzo.
        let _turn = self.turn(&workspace)?;
        let prepared = {
            let ws = workspace.read()?;
            let id = fenced_doc_id(id)?;
            ws.prepare_document_write(&id, WriteBase::DescendsFrom(request.base.clone()))
                .map_err(PluginError::from)?
        };
        let source = prepared
            .expected_source()
            .expect("DescendsFrom keeps the verified source");
        let (next, report) = request.apply_to(source).map_err(|error| match error {
            PluginError::Conflict(_) => PluginError::Conflict(id.to_string().into()),
            other => PluginError::BadArgs(format!("{id}: {other}").into()),
        })?;
        if report.is_empty() {
            return Ok(report);
        }
        let model = prepared.parse(&next).map_err(PluginError::from)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut detached = self.for_provider(hook.owner(), InvokeMode::Apply);
            hook.invoke(&mut detached)
        });
        let base = request.base;
        // Il disco si scrive fuori dal prestito esclusivo e sotto il turno
        // (IMP-1805): la CAS resta quella preparata, e il prestito serve solo
        // alle tabelle.
        let placed = prepared
            .place(&next, before_write)
            .map_err(PluginError::from)?;
        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_placed_document_edit(placed, model, base, &report)
        };
        let pending = pending.invoke_indexes();
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_document_edit_deferred(pending, report)
        };
        finish_events(&workspace, deferred)
    }

    /// Completa gli intent di rinomina rimasti da un'interruzione, senza
    /// tenere `Custody<Workspace>` durante I/O o riscritture provider-owned.
    pub(crate) fn recover_explicit_renames(&mut self) -> Result<Vec<PluginError>, PluginError> {
        let scan = self.workspace.read()?.prepare_rename_recovery_scan();
        let (pending, scan_failures) = scan.invoke().map_err(PluginError::from)?.into_parts();
        let mut failures = scan_failures
            .into_iter()
            .map(PluginError::from)
            .collect::<Vec<_>>();
        for recovery in pending {
            let position = match recovery.classify() {
                Ok(position) => position,
                Err(error) => {
                    failures.push(PluginError::from(error));
                    continue;
                }
            };
            match position {
                RenameRecoveryPosition::Cancelled => {
                    if let Err(error) = recovery.clear() {
                        failures.push(PluginError::from(error));
                    }
                }
                RenameRecoveryPosition::Rollback => {
                    let from = recovery.to().clone();
                    let to = recovery.from().clone();
                    match self.rename_document(&from, &to) {
                        Ok(()) => {
                            if let Err(error) = recovery.clear() {
                                failures.push(PluginError::from(error));
                            }
                        }
                        Err(error) => failures.push(error),
                    }
                }
                RenameRecoveryPosition::Source => {
                    let from = recovery.from().clone();
                    let to = recovery.to().clone();
                    // `persist` riconosce lo stesso record: il retry non apre mai
                    // una finestra senza intent fra due avvii.
                    if let Err(error) = self.rename_document(&from, &to) {
                        failures.push(error);
                    }
                }
                RenameRecoveryPosition::Destination => {
                    let mut failure = None;
                    for rewrite in recovery.rewrites() {
                        let source = rewrite.source();
                        let current = match self.document_revision(source) {
                            Ok(current) => current,
                            Err(error) => {
                                failure = Some(error);
                                break;
                            }
                        };
                        if &current == rewrite.result() {
                            continue;
                        }
                        if current != rewrite.request().base {
                            failure = Some(PluginError::Conflict(
                                format!(
                                    "{} è cambiato durante il recupero della rinomina {} → {}",
                                    source,
                                    recovery.from(),
                                    recovery.to()
                                )
                                .into(),
                            ));
                            break;
                        }
                        if let Err(error) =
                            self.apply_edit_detached_inner(source, rewrite.request().clone())
                        {
                            // L'edit può essere atterrato prima che il chiamante
                            // osservasse il guasto. La revisione prodotta è la
                            // prova idempotente; ogni altro stato resta conflitto.
                            match self.document_revision(source) {
                                Ok(after) if &after == rewrite.result() => {}
                                _ => {
                                    failure = Some(error);
                                    break;
                                }
                            }
                        }
                    }
                    if let Some(error) = failure {
                        failures.push(error);
                    } else if let Err(error) = recovery.clear() {
                        failures.push(PluginError::from(error));
                    }
                }
                RenameRecoveryPosition::Conflict(message) => {
                    failures.push(PluginError::Conflict(message.into()));
                }
            }
        }
        Ok(failures)
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
        if let Some(instance) = self.instance.as_deref() {
            Ok(ws.with_read_host_instance(&self.plugin, instance, f))
        } else {
            Ok(ws.with_read_host(&self.plugin, f))
        }
    }

    /// Una scrittura: prestito **esclusivo**, tenuto per il tempo di una
    /// capacità sola. Gli eventi prodotti dalla capacità restano accodati
    /// finché il guard non è stato rilasciato; il turno di scrittura conserva
    /// invece l'unità logica e consente il rientro sullo stesso thread.
    fn writing<R>(&self, f: impl FnOnce(&mut dyn HostApi) -> R) -> Result<R, PluginError> {
        self.writing_until(&|| Ok(()), f)
    }

    /// Come [`writing`](Self::writing), ma l'attesa del turno si interrompe se
    /// `stopped` dice di no. Il turno si prende dalla porta che sa cedere;
    /// `with_event_drain` lo riprende subito dopo, rientrando senza aspettare.
    fn writing_until<R>(
        &self,
        stopped: &dyn Fn() -> Result<(), PluginError>,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> Result<R, PluginError> {
        let workspace = self.workspace.clone();
        let _turn = workspace.write_turn_yielding(stopped)?;
        with_event_drain(&workspace, |ws| {
            if let Some(instance) = self.instance.as_deref() {
                ws.with_host_mode_instance(&self.plugin, self.mode, instance, f)
            } else {
                ws.with_host_mode(&self.plugin, self.mode, f)
            }
        })
    }
}

fn authorize_family<P: Policy>(
    policy: &P,
    capability: Capability,
    action: impl FnOnce() -> String,
) -> Result<(), PluginError> {
    match policy.denies(capability) {
        None => Ok(()),
        Some(why) => Err(PluginError::PermissionDenied(
            format!("{}: {why}", action()).into(),
        )),
    }
}

/// Esegue una mutazione di casa sotto guard, ma rimanda ogni dispatch fino a
/// quando il guard è stato rilasciato. È la porta comune di sessione, watcher,
/// runner e `JobHost` per gli ingressi che non hanno un epilogo preparato più
/// specifico.
pub(crate) fn with_event_drain<R>(
    workspace: &Custody<Workspace>,
    f: impl FnOnce(&mut Workspace) -> R,
) -> Result<R, PluginError> {
    let _turn = workspace.write_turn();
    let result = {
        let mut ws = workspace.write()?;
        let deferred = ws.defer_event_dispatch();
        let result = f(&mut ws);
        ws.restore_event_dispatch(deferred);
        result
    };
    drain_events(workspace)?;
    Ok(result)
}

/// Drena gli handler un notice alla volta, lasciando il workspace libero
/// durante entrambe le callback esterne (`subscribed` e `handle`).
pub(crate) fn drain_events(workspace: &Custody<Workspace>) -> Result<(), PluginError> {
    let mut drain = EventDrain::new();
    loop {
        let prepared = {
            let mut ws = workspace.write()?;
            ws.prepare_event_delivery(&mut drain)
        };
        let Some(prepared) = prepared else {
            return Ok(());
        };

        let completed = prepared.invoke(|plugin, invoke| {
            // L'attore deve restare installato per tutta la callback: le
            // capacità del JobHost riacquisiscono il workspace una per volta.
            let previous_actor = {
                let mut ws = workspace.write()?;
                ws.prepare_event_handler(plugin)
            };
            let mut host = JobHost::new(workspace.clone(), plugin.to_string());
            invoke(&mut host);
            let mut ws = workspace.write()?;
            ws.finish_event_handler(previous_actor);
            Ok(())
        });

        let mut ws = workspace.write()?;
        ws.finish_event_delivery(&mut drain, completed);
    }
}

/// Consegna gli eventi e completa l'epilogo opaco preparato dal kernel.
///
/// La riga del registro si appende **fuori** dal prestito esclusivo (IMP-1805):
/// è una scrittura sul disco, e su un disco occupato dura secondi che nessuna
/// lettura del vault deve passare ad aspettare. L'ordine delle righe lo tiene
/// il turno di scrittura, quindi la si stacca solo se il turno è di questo
/// thread — lo è per ogni chiamante di oggi; chi non lo tenesse la scrive
/// dentro il prestito, come prima.
pub(crate) fn finish_events<T>(
    workspace: &Custody<Workspace>,
    deferred: DeferredEvents<T>,
) -> Result<T, PluginError> {
    drain_events(workspace)?;
    if !workspace.holds_turn() {
        let mut ws = workspace.write()?;
        return Ok(ws.finish_deferred_events(deferred));
    }
    let (outcome, record) = {
        let mut ws = workspace.write()?;
        ws.finish_deferred_events_detached(deferred)
    };
    if let Some(record) = record {
        if let Err(failure) = record.append() {
            workspace.write()?.report_journal_failure(failure);
        }
    }
    Ok(outcome)
}

/// Esegue un comando **di sola lettura** col frame tutto suo
/// ([`PreparedReadOnlyCommand`]), senza il turno di scrittura.
///
/// Il provider gira sotto il recinto [`ReadOnly`], come sul percorso
/// condiviso; il suo host porta avanti la catena dei comandi, così una sua
/// invocazione annidata di sé stesso è rifiutata. La fine prende solo un
/// prestito condiviso: una lettura non ha undo da spingere, batch da chiudere
/// né eventi da consegnare.
pub(crate) fn run_read_only_command(
    workspace: &Custody<Workspace>,
    mut host: JobHost,
    mut prepared: PreparedReadOnlyCommand,
) -> Result<CommandOutcome, PluginError> {
    host.chain = prepared.chain().to_vec();
    let why = prepared.read_only_reason();
    let mut host = Guard::new(host, ReadOnly { why });
    let outcome = prepared.invoke(&mut host);
    let ws = workspace.read()?;
    ws.finish_read_only_provider_command(prepared, outcome)
}

/// Porta in fondo il solo rebuild di manutenzione con la stessa sequenza a
/// fasi dell'apertura. Il turno resta unico, mentre ogni callback di formato,
/// sintassi e indice attraversa il confine senza guardie del workspace.
pub(crate) fn run_detached_rebuild_index(
    workspace: &Custody<Workspace>,
    prepared: PreparedMaintenanceRebuild,
) -> Result<CommandOutcome, PluginError> {
    let rebuilding = if prepared.mode().is_dry_run() {
        None
    } else {
        Some((|| {
            let prepared_scan = {
                let ws = workspace.read()?;
                ws.prepare_scan_vault().map_err(|error| {
                    PluginError::Internal(format!("l'indice non si è rifatto: {error}").into())
                })?
            };
            let completed_scan = prepared_scan.invoke();
            let mut work = {
                let mut ws = workspace.write()?;
                ws.finalize_scan_vault(completed_scan)
            };

            while !work.finished() {
                let checked = {
                    let ws = workspace.read()?;
                    ws.prepare_index_batch_check(&mut work)
                }
                .invoke();
                let parsed = {
                    let ws = workspace.read()?;
                    ws.prepare_index_batch_parse(checked)
                }
                .invoke(&mut work);
                // A prese brevi, come l'apertura (`runner.rs`): chi apre una
                // nota durante il rebuild non aspetta la fetta intera.
                let mut parsed = parsed;
                let pending = loop {
                    let step = {
                        let mut ws = workspace.write()?;
                        ws.commit_index_batch_within(parsed, fub_kernel::INDEX_WRITE_BUDGET)
                    };
                    match step {
                        IndexBatchStep::Done(pending) => break pending,
                        IndexBatchStep::More(rest) => {
                            parsed = rest;
                            workspace.make_way(crate::runner::MAKE_WAY);
                        }
                    }
                };
                let pending = pending.map(|pending| pending.invoke_indexes());
                if let Some(pending) = pending {
                    workspace.write()?.finalize_index_batch_prepared(pending);
                }
            }

            let graph = {
                let sources = workspace.read()?.graph_sources();
                sources.build()
            };
            let prepared_finish = {
                let ws = workspace.read()?;
                ws.prepare_finish_index_with_graph(work, graph)
            };
            let completed_finish = prepared_finish.invoke();
            let (opening, rejoin) = workspace
                .write()?
                .finalize_finish_index_detached(completed_finish);
            // Come all'apertura (`runner/shared.rs`): i dati delle rinomine
            // riconosciute si spostano fuori dal prestito esclusivo, sotto il
            // turno del comando, prima della raccolta qui sotto.
            if !rejoin.is_empty() {
                let completed = rejoin.invoke();
                workspace.write()?.finish_rejoin(completed);
            }

            let _ = crate::teardown::flush_indexes(workspace)?;
            workspace.read()?.store_entries();
            if let Err(error) = workspace.read()?.collect_doc_data() {
                tracing::warn!(
                    target: "fub.kernel",
                    "spazi per-documento non raccolti: {error}"
                );
            }
            Ok(opening)
        })())
    };

    let deferred = {
        let mut ws = workspace.write()?;
        ws.finish_maintenance_rebuild(prepared, rebuilding)
    };
    finish_events(workspace, deferred)?
}
