//! **Le capacità, dal lato di chi le offre.**
//!
//! Ogni funzione di questo modulo è una host function: il componente la chiama,
//! lei chiede la stessa cosa all'`HostApi` prestato e traduce la risposta. Non
//! decide niente — chi può cosa lo ha già deciso il `Guard` del kernel, che è
//! *dentro* l'`HostApi` che arriva qui (vedi il doc del crate). Una host
//! function di questo file che leggesse i permessi sarebbe il secondo punto di
//! enforcement che la 0021 esiste per non avere.
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
//! Le famiglie di oggi sono tre: `host-env` (l'orologio, il locale, il caso, il
//! fuoco), `host-vault-read` (leggere il vault, modello del documento compreso)
//! e `host-events` (pubblicare un evento, e sottoscrivere). Le prime due sono
//! quelle che il ping del primo plugin nativo attraversa, cioè quelle su cui
//! c'è una parità da provare; la terza è l'unica in cui il guest chiama l'host
//! mentre l'host sta chiamando il guest, e per questo il suo `impl` sta in
//! [`crate::events`] e non qui.

use fub_abi::model::DocId;
use wasmtime::component::{HasSelf, Linker};

use crate::borrow::State;
use crate::contract::fub::abi::{
    format as w_format, host_env, host_events, host_vault_read, index as w_index, intl as w_intl,
    model as w_model, session as w_session,
};
use crate::translate as tr;

/// Aggiunge al linker le famiglie che questo crate serve.
pub(crate) fn add_to_linker(linker: &mut Linker<State>) -> wasmtime::Result<()> {
    host_env::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    host_vault_read::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    // La terza è servita da `crate::events`: l'`impl` sta là perché la sua è
    // l'unica famiglia in cui la chiamata va dal guest all'host mentre l'host
    // sta chiamando il guest. La riga però sta qui, con le altre due, perché
    // linkare è una cosa sola e un secondo posto da cui linkare sarebbe un
    // secondo posto in cui dimenticarsene.
    host_events::add_to_linker::<State, HasSelf<State>>(linker, |s| s)?;
    Ok(())
}

/// Il rifiuto che una host function restituisce quando l'host non è prestato.
/// Vedi [`crate::borrow`]: è un guasto dell'host, non del componente.
macro_rules! guest {
    ($self:expr) => {
        match $self.guest() {
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
    /// l'epoca, cioè un istante che nessuno scambia per adesso.
    fn now_unix_millis(&mut self) -> u64 {
        self.guest().map(|h| h.now_unix_millis()).unwrap_or(0)
    }

    /// Come sopra: il locale di ripiego è quello di default, che è la stessa
    /// cosa che l'host risponde quando l'utente non ha scelto niente.
    fn user_locale(&mut self) -> w_intl::Locale {
        let locale = self.guest().map(|h| h.user_locale()).unwrap_or_default();
        tr::to_locale(&locale)
    }

    fn random_bytes(
        &mut self,
        n: u32,
    ) -> Result<Vec<u8>, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.random_bytes(n).map_err(|and| tr::to_error(&and))
    }

    fn active_context(&mut self) -> Option<w_session::ViewContext> {
        self.guest()
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
        let h = guest!(self);
        h.read_document(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))
    }

    fn read_document_bytes(
        &mut self,
        id: w_model::DocId,
    ) -> Result<Vec<u8>, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.read_document_bytes(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))
    }

    fn document_revision(
        &mut self,
        id: w_model::DocId,
    ) -> Result<String, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.document_revision(&DocId::new(id))
            .map(|r| r.0)
            .map_err(|and| tr::to_error(&and))
    }

    fn list_documents(
        &mut self,
        page: Option<w_index::Page>,
    ) -> Result<w_index::DocIdsPage, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        h.list_documents(tr::from_page(page))
            .map(tr::to_doc_ids_page)
            .map_err(|and| tr::to_error(&and))
    }

    fn free_name(&mut self, id: w_model::DocId) -> w_model::DocId {
        match self.guest() {
            Ok(h) => h.free_name(&DocId::new(id)).0,
            // Senza host non c'è nessun vault in cui il nome sia libero: torna
            // quello chiesto, che è ciò che `free_name` risponde quando è già
            // libero.
            Err(_) => id,
        }
    }

    /// **L'albero più grande del contratto, di là dal confine.**
    ///
    /// Fino al passo scorso rispondeva `unserved` col proprio perché: tradurre
    /// `document-model` — blocchi, intestazioni, link, frontmatter — è un lavoro
    /// suo, e un modello vuoto sarebbe stata una risposta *sbagliata* a una
    /// domanda giusta. Quel lavoro adesso c'è, e sta in [`crate::model`]: qui
    /// resta ciò che fanno tutte le altre di questa famiglia — chiedere all'host
    /// prestato e tradurre la risposta.
    ///
    /// I due errori possibili sono due cose diverse e restano distinguibili: il
    /// primo `?` porta il no del vault (permesso, documento assente, I/O), il
    /// secondo il no della traduzione (un albero più profondo di quanto l'host
    /// scenda). Entrambi arrivano al componente come **valore**, non come trap.
    /// scenda). Entrambi arrivano al componente come **valore**, non come trap.
    fn read_model(
        &mut self,
        id: w_model::DocId,
    ) -> Result<w_model::DocumentModel, crate::contract::fub::abi::errors::PluginError> {
        let h = guest!(self);
        let model = h
            .read_model(&DocId::new(id))
            .map_err(|and| tr::to_error(&and))?;
        crate::model::to_document(model).map_err(|and| tr::to_error(&and))
    }

    fn format_of(&mut self, id: w_model::DocId) -> Option<w_format::DocumentFormat> {
        self.guest()
            .ok()
            .and_then(|h| h.format_of(&DocId::new(id)))
            .as_ref()
            .map(tr::to_format)
    }

    fn list_trash(
        &mut self,
    ) -> Result<Vec<host_vault_read::TrashEntry>, crate::contract::fub::abi::errors::PluginError>
    {
        let h = guest!(self);
        h.list_trash()
            .map(|v| v.into_iter().map(tr::to_trash).collect())
            .map_err(|and| tr::to_error(&and))
    }
}
