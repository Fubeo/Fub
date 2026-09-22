//! Guest che esporta la porta canonica `index` (`IndexProvider`), non ancora
//! supportata dal runtime WASM.
//!
//! I metodi sono trap intenzionali: il test monta il componente e dimostra che
//! nessun ingresso del lifecycle o delle query raggiunge questa porta differita.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:index-provider/index-provider",
    generate_all,
});
use exports::fub::abi::index::{
    Guest as IndexProviderGuest, IndexLoss, IndexQuery, IndexResult, QueryRoute, VaultEntry,
};
use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::{DocId, DocumentModel};

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "demo.index-provider".to_string(),
            name: "Deferred IndexProvider (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.1.1".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(_job: String, _payload: String) -> Result<String, PluginError> {
        Ok("{}".to_string())
    }
}

impl IndexProviderGuest for Componente {
    fn routes() -> Vec<QueryRoute> {
        panic!("deferred IndexProvider must never be called")
    }

    fn activate() -> Result<(), PluginError> {
        panic!("deferred IndexProvider must never be called")
    }

    fn on_documents_indexed(_docs: Vec<DocumentModel>) -> Vec<IndexLoss> {
        panic!("deferred IndexProvider must never be called")
    }

    fn on_documents_removed(_ids: Vec<DocId>) -> Vec<IndexLoss> {
        panic!("deferred IndexProvider must never be called")
    }

    fn reconcile(_ids: Vec<DocId>) -> Vec<IndexLoss> {
        panic!("deferred IndexProvider must never be called")
    }

    fn flush() -> Result<(), PluginError> {
        panic!("deferred IndexProvider must never be called")
    }

    fn close() -> Result<(), PluginError> {
        panic!("deferred IndexProvider must never be called")
    }

    fn query(_query: IndexQuery) -> Result<IndexResult, PluginError> {
        panic!("deferred IndexProvider must never be called")
    }

    fn up_to_date(_entries: Vec<VaultEntry>) -> Vec<DocId> {
        panic!("deferred IndexProvider must never be called")
    }
}

export!(Componente);
