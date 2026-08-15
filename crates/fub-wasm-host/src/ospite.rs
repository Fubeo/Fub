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
//! [`aggiungi_al_linker`] non aggiunge il *world*: aggiunge le famiglie che
//! questo crate sa servire, una per una. La conseguenza è quella giusta — un
//! componente che importa una famiglia non ancora linkata **non si istanzia**,
//! e wasmtime nomina la funzione che manca. L'alternativa (linkare tutto con
//! degli stub che rispondono `unserved`) darebbe un componente che si monta,
//! gira, e scopre a metà lavoro che una capacità non c'era: lo stesso guasto,
//! più tardi e senza il nome.
//!
//! Le famiglie di oggi sono due: `host-env` (l'orologio, il locale, il caso, il
//! fuoco) e `host-vault-read` (leggere il vault). Sono quelle che il ping del
//! primo plugin nativo attraversa, cioè quelle su cui c'è una parità da provare.

use fub_abi::model::DocId;
use fub_abi::PluginError;
use wasmtime::component::{HasSelf, Linker};

use crate::contratto::fub::abi::{
    format as w_format, host_env, host_vault_read, index as w_index, intl as w_intl,
    model as w_model, session as w_session,
};
use crate::prestito::Stato;
use crate::traduzione as tr;

/// Aggiunge al linker le famiglie che questo crate serve.
pub(crate) fn aggiungi_al_linker(linker: &mut Linker<Stato>) -> wasmtime::Result<()> {
    host_env::add_to_linker::<Stato, HasSelf<Stato>>(linker, |s| s)?;
    host_vault_read::add_to_linker::<Stato, HasSelf<Stato>>(linker, |s| s)?;
    Ok(())
}

/// Il rifiuto che una host function restituisce quando l'host non è prestato.
/// Vedi [`crate::prestito`]: è un guasto dell'host, non del componente.
macro_rules! ospite {
    ($self:expr) => {
        match $self.ospite() {
            Ok(h) => h,
            Err(e) => return Err(tr::in_errore(&e)),
        }
    };
}

// ---------------------------------------------------------------------------
// host-env: le capacità senza permesso (§7.3)
// ---------------------------------------------------------------------------

impl host_env::Host for Stato {
    /// Senza host prestato l'orologio risponde `0`. È l'unica firma di questa
    /// famiglia che non può dire di no — il contratto la dà come `u64` nudo,
    /// perché «che ore sono» non è una domanda che si rifiuta — e zero è
    /// l'epoca, cioè un istante che nessuno scambia per adesso.
    fn now_unix_millis(&mut self) -> u64 {
        self.ospite().map(|h| h.now_unix_millis()).unwrap_or(0)
    }

    /// Come sopra: il locale di ripiego è quello di default, che è la stessa
    /// cosa che l'host risponde quando l'utente non ha scelto niente.
    fn user_locale(&mut self) -> w_intl::Locale {
        let locale = self.ospite().map(|h| h.user_locale()).unwrap_or_default();
        tr::in_locale(&locale)
    }

    fn random_bytes(
        &mut self,
        n: u32,
    ) -> Result<Vec<u8>, crate::contratto::fub::abi::errors::PluginError> {
        let ospite = ospite!(self);
        ospite.random_bytes(n).map_err(|e| tr::in_errore(&e))
    }

    fn active_context(&mut self) -> Option<w_session::ViewContext> {
        self.ospite()
            .ok()
            .and_then(|h| h.active_context())
            .as_ref()
            .map(tr::in_view_context)
    }
}

// ---------------------------------------------------------------------------
// host-vault-read: leggere il vault (permesso `fub:read-vault`)
// ---------------------------------------------------------------------------

impl host_vault_read::Host for Stato {
    fn read_document(
        &mut self,
        id: w_model::DocId,
    ) -> Result<String, crate::contratto::fub::abi::errors::PluginError> {
        let ospite = ospite!(self);
        ospite
            .read_document(&DocId::new(id))
            .map_err(|e| tr::in_errore(&e))
    }

    fn read_document_bytes(
        &mut self,
        id: w_model::DocId,
    ) -> Result<Vec<u8>, crate::contratto::fub::abi::errors::PluginError> {
        let ospite = ospite!(self);
        ospite
            .read_document_bytes(&DocId::new(id))
            .map_err(|e| tr::in_errore(&e))
    }

    fn document_revision(
        &mut self,
        id: w_model::DocId,
    ) -> Result<String, crate::contratto::fub::abi::errors::PluginError> {
        let ospite = ospite!(self);
        ospite
            .document_revision(&DocId::new(id))
            .map(|r| r.0)
            .map_err(|e| tr::in_errore(&e))
    }

    fn list_documents(
        &mut self,
        page: Option<w_index::Page>,
    ) -> Result<w_index::DocIdsPage, crate::contratto::fub::abi::errors::PluginError> {
        let ospite = ospite!(self);
        ospite
            .list_documents(tr::da_page(page))
            .map(tr::in_doc_ids_page)
            .map_err(|e| tr::in_errore(&e))
    }

    fn free_name(&mut self, id: w_model::DocId) -> w_model::DocId {
        match self.ospite() {
            Ok(h) => h.free_name(&DocId::new(id)).0,
            // Senza host non c'è nessun vault in cui il nome sia libero: torna
            // quello chiesto, che è ciò che `free_name` risponde quando è già
            // libero.
            Err(_) => id,
        }
    }

    /// **Dichiaratamente non servita a questo giro.**
    ///
    /// `document-model` è l'albero più grande del contratto — blocchi,
    /// intestazioni, link, proprietà — e tradurlo è un passo suo, non una riga
    /// di questo. Risponde `unserved` col proprio perché invece di un modello
    /// vuoto: un modello vuoto è una risposta *sbagliata* a una domanda giusta,
    /// e chi la ricevesse concluderebbe che la nota non ha niente dentro.
    fn read_model(
        &mut self,
        _id: w_model::DocId,
    ) -> Result<w_model::DocumentModel, crate::contratto::fub::abi::errors::PluginError> {
        Err(tr::in_errore(&PluginError::Unserved(
            "read-model non attraversa ancora il confine WASM: il modello di documento \
             è il prossimo passo di M5"
                .into(),
        )))
    }

    fn format_of(&mut self, id: w_model::DocId) -> Option<w_format::DocumentFormat> {
        self.ospite()
            .ok()
            .and_then(|h| h.format_of(&DocId::new(id)))
            .as_ref()
            .map(tr::in_formato)
    }

    fn list_trash(
        &mut self,
    ) -> Result<Vec<host_vault_read::TrashEntry>, crate::contratto::fub::abi::errors::PluginError>
    {
        let ospite = ospite!(self);
        ospite
            .list_trash()
            .map(|v| v.into_iter().map(tr::in_cestino).collect())
            .map_err(|e| tr::in_errore(&e))
    }
}
