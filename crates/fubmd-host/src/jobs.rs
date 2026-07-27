//! [`JobHost`]: le capacità di un lavoro lungo, prese **per chiamata**.
//!
//! Il §9.1 chiedeva che il lavoro lungo vedesse il vault, e la
//! [decisione 0027](../../../docs/decisions/0027-il-lavoro-lungo-vede-il-vault.md)
//! ha messo l'`HostApi` nella firma di
//! [`Plugin::run_job`](fubmd_abi::traits::Plugin::run_job). Quella è la metà che
//! scadeva col freeze; questo è il pezzo che la rende utilizzabile — e non
//! poteva stare nel kernel, perché il kernel non sa che esiste un lock: il
//! `Workspace` è un oggetto normale, ed è chi lo monta a metterlo dietro un
//! `RwLock` ([decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)).
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
//! e un [`Conflict`](fubmd_abi::PluginError::Conflict).

use std::sync::{Arc, RwLock};

use fubmd_abi::command::CommandOutcome;
use fubmd_abi::edit::{EditReport, EditRequest, Revision};
use fubmd_abi::format::DocumentFormat;
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::session::ViewContext;
use fubmd_abi::traits::{
    DataRead, DataWrite, HostApi, HostCommands, HostEnv, HostEvents, HostQuery, HostServices,
    IndexQuery, IndexResult, JobId, JobSpec, Page, Paged, ReadApi, TrashEntry, VaultRead,
    VaultStructure, VaultWrite,
};
use fubmd_abi::{Event, PluginError};
use fubmd_kernel::Workspace;

/// L'[`HostApi`] di un job: intestato a un plugin, servito da un workspace
/// condiviso, **senza tenerlo**.
///
/// Si costruisce sul thread che esegue il job e si passa a
/// [`Plugin::run_job`](fubmd_abi::traits::Plugin::run_job). Le capacità sono
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
/// [decisione 0024]: ../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md
pub struct JobHost {
    workspace: Arc<RwLock<Workspace>>,
    plugin: String,
}

impl JobHost {
    /// Le capacità di `plugin` sul workspace di una sessione aperta.
    ///
    /// L'id è quello con cui il plugin si è **dichiarato**: un id che nessuno ha
    /// dichiarato riceve un host che nega tutto dicendo perché — la stessa
    /// risposta di `Workspace::with_host`, e per la stessa ragione (il kernel
    /// non presta capacità a una stringa).
    pub fn new(workspace: Arc<RwLock<Workspace>>, plugin: impl Into<String>) -> Self {
        JobHost {
            workspace,
            plugin: plugin.into(),
        }
    }

    /// Una lettura: prestito **condiviso**, e N job che leggono non si aspettano
    /// né fra loro né con le view che disegnano.
    fn reading<R>(&self, f: impl FnOnce(&dyn ReadApi) -> R) -> R {
        let ws = self.workspace.read().expect("workspace avvelenato");
        ws.with_read_host(&self.plugin, f)
    }

    /// Una scrittura: prestito **esclusivo**, tenuto per il tempo di una
    /// capacità sola. Ciò che ne nasce — parse, grafo, indici, eventi, handler —
    /// succede lì dentro, come per ogni altra scrittura del kernel.
    fn writing<R>(&self, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {
        let mut ws = self.workspace.write().expect("workspace avvelenato");
        ws.with_host(&self.plugin, f)
    }
}

// Le dieci famiglie. Sono trentadue righe di delega e nessuna decisione: ogni
// decisione è già stata presa un livello più in basso (il recinto dei `DocId`,
// la politica dei permessi, il dispatch degli eventi), e ripeterne una qui
// sarebbe una seconda idea della stessa regola.

impl VaultRead for JobHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.reading(|h| h.read_document(id))
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.reading(|h| h.document_revision(id))
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.reading(|h| h.list_documents(page))
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.reading(|h| h.free_name(id))
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.reading(|h| h.read_model(id))
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.reading(|h| h.format_of(id))
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.reading(|h| h.list_trash())
    }
}

impl VaultWrite for JobHost {
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.writing(|h| h.write_document(id, source))
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.writing(|h| h.apply_edit(id, request))
    }
}

impl VaultStructure for JobHost {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.writing(|h| h.create_document(id, source))
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.writing(|h| h.rename_document(from, to))
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.writing(|h| h.trash_document(id))
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.writing(|h| h.restore_document(entry, to))
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.writing(|h| h.empty_trash())
    }
}

impl DataRead for JobHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.reading(|h| h.data_read(path))
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.reading(|h| h.data_list(prefix))
    }
}

impl DataWrite for JobHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.writing(|h| h.data_write(path, bytes))
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.writing(|h| h.data_remove(path))
    }
}

impl HostEnv for JobHost {
    fn now_unix_millis(&self) -> u64 {
        self.reading(|h| h.now_unix_millis())
    }

    /// Che pannello guarda l'utente **adesso**, non quando il job è partito: un
    /// job dura, e un contesto congelato all'avvio sarebbe una risposta vecchia
    /// che nessuno saprebbe riconoscere come tale.
    fn active_context(&self) -> Option<ViewContext> {
        self.reading(|h| h.active_context())
    }
}

impl HostEvents for JobHost {
    /// Emettere prende il prestito **esclusivo**: un evento entra nella coda del
    /// dispatcher e da lì raggiunge gli handler, che scrivono.
    fn emit(&mut self, event: Event) {
        self.writing(|h| h.emit(event))
    }

    /// Un job può chiederne un altro: la coda è la stessa, e a drenarla è sempre
    /// chi possiede i thread.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.writing(|h| h.spawn_job(spec))
    }
}

impl HostQuery for JobHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.reading(|h| h.query_index(query))
    }
}

impl HostCommands for JobHost {
    /// Il comando gira **dentro** il prestito esclusivo, cioè nel giro sincrono
    /// del kernel come se lo avesse invocato la shell: un job non porta i comandi
    /// fuori dal kernel, ci entra.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.writing(|h| h.run_command(command, args))
    }
}

impl HostServices for JobHost {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.writing(|h| h.call_service(service, method, args))
    }
}
