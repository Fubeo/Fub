//! **Le capacità, dal lato di chi le offre.**
//!
//! Ogni funzione di questo modulo è una host function: il componente la chiama,
//! lei inoltra la richiesta all'API prestata — `ReadApi` per le letture,
//! `HostApi` per le scritture e le action — e traduce la risposta. Non decide
//! niente: le capacità disponibili sono già quelle esposte dall'API ricevuta,
//! e questo modulo non replica controlli di permesso. Una host function di
//! questo file che leggesse i permessi sarebbe il secondo punto di enforcement
//! che la 0021 esiste per non avere.
//!
//! # Si linka ciò che si implementa
//!
//! [`add_to_linker`] non aggiunge il *world*: aggiunge le famiglie che
//! questo crate sa servire, una per una. La conseguenza è quella giusta — un
//! componente che importa una famiglia non ancora linkata **non si istanzia**,
//! e wasmtime nomina la funzione che manca. L'alternativa (linkare tutto con
//! degli stub che rispondono `unserved`) darebbe un componente che si monta,
//! gira, e scopre a metà lavoro che una capacità non c'era: lo stesso guasto,
//! più tardi e senza il nome.
//!
//! Le famiglie servite sono tutte quelle di un plugin: `host-env` (l'orologio,
//! il locale, il caso, il fuoco), `host-vault-read` (leggere il vault, modello
//! del documento compreso), `host-vault-write` e `host-vault-structure`
//! (scrivere testo, e creare, spostare, cestinare), `host-data-read` e
//! `host-data-write` (i propri blob persistiti — due interfacce e non una,
//! perché il percorso di render rilegge ciò che il provider si è salvato e non
//! deve poter scrivere mentre disegna), le impostazioni e lo stato di vista
//! (anche loro in due metà, per la stessa ragione), `host-query`,
//! `host-services`, `host-network`, `host-commands` e `host-events` (emettere
//! eventi, avviare job e riportare progresso). L'ultima è l'unica in cui il
//! guest chiama l'host mentre l'host sta chiamando il guest, e per questo il suo
//! `impl` sta in [`crate::events`] e non qui.
//!
//! Restano fuori `host-transfer-read` e `host-transfer-write`: le loro sorgenti
//! e i loro artefatti esistono soltanto dentro una chiamata di `importer` o di
//! `exporter`, export che questo crate non collega. Un plugin che le importa
//! non si carica, e il rifiuto le nomina.
//!
//! Le scritture passano dal prestito in scrittura (`guest!`): durante una
//! chiamata in sola lettura — un render — rispondono `internal` invece di
//! scrivere. Le conversioni nel verso di queste famiglie stanno in
//! [`crate::served_convert`].

use fub_abi::model::DocId;
use wasmtime::component::{HasSelf, Linker};

use crate::borrow::State;
use crate::contract::fub::abi::{
    command as w_command, edit as w_edit, format as w_format, host_commands, host_data_read,
    host_data_write, host_env, host_events, host_network, host_query, host_services,
    host_settings_read, host_settings_write, host_vault_read, host_vault_structure,
    host_vault_write, host_view_state_read, host_view_state_write, index as w_index,
    intl as w_intl, model as w_model, net as w_net, session as w_session, settings as w_settings,
};
use crate::served_convert as sc;
use crate::translate as tr;

/// Aggiunge al linker le famiglie che questo crate serve.
pub(crate) fn add_to_linker(linker: &mut Linker<State>) -> wasmtime::Result<()> {
    host_env::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_vault_read::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_data_read::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_data_write::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_vault_write::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_vault_structure::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_settings_read::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_settings_write::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_view_state_read::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_view_state_write::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_query::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_services::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_network::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_commands::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    // L'ultima è servita da `crate::events`: l'`impl` sta là perché la sua è
    // l'unica famiglia in cui la chiamata va dal guest all'host mentre l'host
    // sta chiamando il guest. La riga però sta qui, con le altre,
    // perché linkare è una cosa sola e un secondo posto da cui linkare sarebbe
    // un secondo posto in cui dimenticarsene.
    host_events::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    Ok(())
}

/// Il rifiuto che una host function restituisce quando l'host non è prestato.
/// Vedi [`crate::borrow`]: è un guasto dell'host, non del componente.
macro_rules! guest {
    ($self:expr) => {
        match $self.writer() {
            Ok(h) => h,
            Err(and) => return Err(tr::to_error(&and)),
        }
    };
}

macro_rules! reader {
    ($self:expr) => {
        match $self.reader() {
            Ok(h) => h,
            Err(and) => return Err(tr::to_error(&and)),
        }
    };
}

// ---------------------------------------------------------------------------
// host-env: le capacità senza permesso (§7.3)
// ---------------------------------------------------------------------------

impl host_env::Host for State {
    /// Senza host prestato l'orologio risponde `0`. È l'unica firma di questa
    /// famiglia che non può dire di no — il contratto la dà come `u64` nudo,
    /// perché «che ore sono» non è una domanda che si rifiuta — e zero è
    /// l'epoca, cioè un istante che nessuno scambia per adesso.
    fn now_unix_millis(&mut self) -> u64 {
        self.reader().map(|h| h.now_unix_millis()).unwrap_or(0)
    }

    /// Come sopra: il locale di ripiego è quello di default.
    fn user_locale(&mut self) -> w_intl::Locale {
        let locale = self.reader().map(|h| h.user_locale()).unwrap_or_default();
        tr::to_locale(&locale)
    }

    fn random_bytes(
        &mut self,
        n: u32,
    ) -> Result<Vec<u8>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.random_bytes(n).map_err(|and| tr::to_error(&and))
    }

    fn active_context(&mut self) -> Option<w_session::ViewContext> {
        self.reader()
            .ok()
            .and_then(|h| h.active_context())
            .as_ref()
            .map(tr::to_view_context)
    }
}

// ---------------------------------------------------------------------------
// host-vault-read: leggere il vault (permesso `fub:read-vault`)
// ---------------------------------------------------------------------------

impl host_vault_read::Host for State {
    fn read_document(
        &mut self,
        id: w_model::DocId,
    ) -> Result<String, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.read_document(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))
    }

    fn read_document_bytes(
        &mut self,
        id: w_model::DocId,
    ) -> Result<Vec<u8>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.read_document_bytes(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))
    }

    fn document_revision(
        &mut self,
        id: w_model::DocId,
    ) -> Result<String, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.document_revision(&DocId::new(id))
            .map(|r| r.0)
            .map_err(|and| tr::to_error(&and))
    }

    fn list_documents(
        &mut self,
        page: Option<w_index::Page>,
    ) -> Result<w_index::DocIdsPage, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.list_documents(tr::from_page(page))
            .map(tr::to_doc_ids_page)
            .map_err(|and| tr::to_error(&and))
    }

    fn free_name(&mut self, id: w_model::DocId) -> w_model::DocId {
        match self.reader() {
            Ok(h) => h.free_name(&DocId::new(id)).0,
            Err(_) => id,
        }
    }

    fn read_model(
        &mut self,
        id: w_model::DocId,
    ) -> Result<w_model::DocumentModel, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        let model = h
            .read_model(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))?;
        crate::model::to_document(model).map_err(|and| tr::to_error(&and))
    }

    fn format_of(&mut self, id: w_model::DocId) -> Option<w_format::DocumentFormat> {
        self.reader()
            .ok()
            .and_then(|h| h.format_of(&DocId::new(id)))
            .as_ref()
            .map(tr::to_format)
    }

    fn format_link(
        &mut self,
        doc: w_model::DocId,
        link: w_model::LinkInsert,
    ) -> Result<Option<String>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.format_link(&DocId::new(doc), &tr::from_link_insert(link))
            .map_err(|and| tr::to_error(&and))
    }

    fn task_state_edit(
        &mut self,
        doc: w_model::DocId,
        marker: w_model::TaskMarker,
        done: bool,
    ) -> Result<Option<w_edit::EditRequest>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        let marker = tr::from_task_marker(marker).map_err(|and| tr::to_error(&and))?;
        h.task_state_edit(&DocId::new(doc), &marker, done)
            .map(|request| request.as_ref().map(tr::to_edit_request))
            .map_err(|and| tr::to_error(&and))
    }

    fn list_trash(
        &mut self,
    ) -> Result<Vec<host_vault_read::TrashEntry>, crate::contract::fub::abi::errors::PluginError>
    {
        let h = reader!(self);
        h.list_trash()
            .map(|v| v.into_iter().map(tr::to_trash).collect())
            .map_err(|and| tr::to_error(&and))
    }
}

// ---------------------------------------------------------------------------
// host-data-read / host-data-write: storage privato del componente
// ---------------------------------------------------------------------------

impl host_data_read::Host for State {
    fn data_read(
        &mut self,
        path: String,
    ) -> Result<Option<Vec<u8>>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.data_read(&path).map_err(|and| tr::to_error(&and))
    }

    fn data_list(
        &mut self,
        prefix: String,
    ) -> Result<Vec<String>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.data_list(&prefix).map_err(|and| tr::to_error(&and))
    }

    fn cache_read(
        &mut self,
        path: String,
    ) -> Result<Option<Vec<u8>>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.cache_read(&path).map_err(|and| tr::to_error(&and))
    }
}

impl host_data_write::Host for State {
    fn data_write(
        &mut self,
        path: String,
        bytes: Vec<u8>,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.data_write(&path, &bytes)
            .map_err(|and| tr::to_error(&and))
    }

    fn data_remove(
        &mut self,
        path: String,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.data_remove(&path).map_err(|and| tr::to_error(&and))
    }

    fn cache_write(
        &mut self,
        path: String,
        bytes: Vec<u8>,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.cache_write(&path, &bytes)
            .map_err(|and| tr::to_error(&and))
    }
}

// ---------------------------------------------------------------------------
// host-vault-write / host-vault-structure: scrivere il vault (`fub:write-vault`)
// ---------------------------------------------------------------------------

impl host_vault_write::Host for State {
    fn write_document(
        &mut self,
        id: w_model::DocId,
        source: String,
        base: w_edit::WriteBase,
    ) -> Result<String, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.write_document(&DocId::new(id), &source, sc::from_write_base(base))
            .map(|r| r.0)
            .map_err(|and| tr::to_error(&and))
    }

    fn apply_edit(
        &mut self,
        id: w_model::DocId,
        request: w_edit::EditRequest,
    ) -> Result<w_edit::EditReport, crate::contract::fub::abi::errors::PluginError> {
        let request = tr::from_edit_request(request).map_err(|and| tr::to_error(&and))?;
        let h = guest!(self);
        h.apply_edit(&DocId::new(id), request)
            .map(|report| sc::to_edit_report(&report))
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_vault_structure::Host for State {
    fn create_document(
        &mut self,
        id: w_model::DocId,
        source: String,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.create_document(&DocId::new(id), &source)
            .map_err(|and| tr::to_error(&and))
    }

    fn rename_document(
        &mut self,
        from: w_model::DocId,
        to: w_model::DocId,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.rename_document(&DocId::new(from), &DocId::new(to))
            .map_err(|and| tr::to_error(&and))
    }

    fn trash_document(
        &mut self,
        id: w_model::DocId,
    ) -> Result<w_model::DocId, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.trash_document(&DocId::new(id))
            .map(|d| d.0)
            .map_err(|and| tr::to_error(&and))
    }

    fn restore_document(
        &mut self,
        entry: w_model::DocId,
        to: Option<w_model::DocId>,
    ) -> Result<w_model::DocId, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.restore_document(&DocId::new(entry), to.map(DocId::new))
            .map(|d| d.0)
            .map_err(|and| tr::to_error(&and))
    }

    fn empty_trash(&mut self) -> Result<u64, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.empty_trash().map_err(|and| tr::to_error(&and))
    }
}

// ---------------------------------------------------------------------------
// host-settings-* e host-view-state-*: le impostazioni e lo stato di vista
// ---------------------------------------------------------------------------

impl host_settings_read::Host for State {
    fn setting(
        &mut self,
        key: String,
    ) -> Result<w_settings::SettingValue, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.setting(&key)
            .map(|v| sc::to_setting_value(&v))
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_settings_write::Host for State {
    fn set_setting(
        &mut self,
        key: String,
        value: w_settings::SettingValue,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.set_setting(&key, sc::from_setting_value(value))
            .map_err(|and| tr::to_error(&and))
    }

    fn reset_setting(
        &mut self,
        key: String,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.reset_setting(&key).map_err(|and| tr::to_error(&and))
    }
}

impl host_view_state_read::Host for State {
    fn view_state(
        &mut self,
        key: String,
    ) -> Result<Option<String>, crate::contract::fub::abi::errors::PluginError> {
        let h = reader!(self);
        h.view_state(&key)
            .map(|v| v.as_ref().map(tr::to_json))
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_view_state_write::Host for State {
    fn set_view_state(
        &mut self,
        key: String,
        value: Option<String>,
    ) -> Result<(), crate::contract::fub::abi::errors::PluginError> {
        let value = value
            .as_deref()
            .map(tr::from_json)
            .transpose()
            .map_err(|and| tr::to_error(&and))?;
        let h = guest!(self);
        h.set_view_state(&key, value)
            .map_err(|and| tr::to_error(&and))
    }
}

// ---------------------------------------------------------------------------
// host-query, host-services, host-network, host-commands
// ---------------------------------------------------------------------------

impl host_query::Host for State {
    fn query_index(
        &mut self,
        query: w_index::IndexQuery,
    ) -> Result<w_index::IndexResult, crate::contract::fub::abi::errors::PluginError> {
        let query = sc::from_index_query(query).map_err(|and| tr::to_error(&and))?;
        let h = reader!(self);
        h.query_index(query)
            .and_then(|result| sc::to_index_result(&result))
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_services::Host for State {
    fn call_service(
        &mut self,
        service: String,
        method: String,
        args: String,
    ) -> Result<String, crate::contract::fub::abi::errors::PluginError> {
        let args = tr::from_json(&args).map_err(|and| tr::to_error(&and))?;
        let h = guest!(self);
        h.call_service(&service, &method, args)
            .map(|v| tr::to_json(&v))
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_network::Host for State {
    fn fetch(
        &mut self,
        request: w_net::HttpRequest,
    ) -> Result<w_net::HttpResponse, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.fetch(sc::from_http_request(request))
            .map(sc::to_http_response)
            .map_err(|and| tr::to_error(&and))
    }
}

impl host_commands::Host for State {
    fn run_command(
        &mut self,
        command: String,
        args: String,
    ) -> Result<w_command::CommandOutcome, crate::contract::fub::abi::errors::PluginError> {
        let args = tr::from_json(&args).map_err(|and| tr::to_error(&and))?;
        let h = guest!(self);
        h.run_command(&command, args)
            .map(|o| sc::to_command_outcome(&o))
            .map_err(|and| tr::to_error(&and))
    }

    fn undo_last(
        &mut self,
    ) -> Result<Option<w_command::Undone>, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.undo_last()
            .map(|u| u.as_ref().map(sc::to_undone))
            .map_err(|and| tr::to_error(&and))
    }
}
