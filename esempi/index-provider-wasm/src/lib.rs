//! A small persistent inbound index: it owns a custom route and stores the ids
//! delivered by the host. The JSON reply exposes lifecycle counters to the
//! integration test without reaching into the guest's memory.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:index-provider/index-provider",
    generate_all,
});

use std::collections::BTreeSet;
use std::sync::{LazyLock, Mutex};

use exports::fub::abi::index::{
    Guest as IndexProviderGuest, IndexLoss, IndexQuery, IndexResult, QueryKind, QueryRoute,
    VaultEntry,
};
use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::{DocId, DocumentModel};
use fub::abi::text::Text;

const ID: &str = "demo.index-provider";
const ROUTE: &str = "demo.index-provider:ids";
const DATA: &str = "index-ids";
const CLOSED: &str = "closed";

#[derive(Default)]
struct Index {
    docs: BTreeSet<String>,
    loaded: usize,
    fed: usize,
    removed: usize,
    reconciled: usize,
    scanned: usize,
    flushed: usize,
    closed_before: bool,
}

static INDEX: LazyLock<Mutex<Index>> = LazyLock::new(|| Mutex::new(Index::default()));

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Inbound index (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.2.0".to_string(),
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
        #[cfg(feature = "trap-routes")]
        panic!("index declaration trap");
        #[cfg(not(feature = "trap-routes"))]
        vec![QueryRoute::Query(QueryKind::Custom(ROUTE.to_string()))]
    }

    fn activate() -> Result<(), PluginError> {
        let stored = fub::abi::host_data_read::data_read(DATA)?;
        let closed_before = fub::abi::host_data_read::data_read(CLOSED)?.as_deref() == Some(b"yes");
        let mut index = INDEX.lock().expect("index lock");
        *index = Index::default();
        index.closed_before = closed_before;
        if let Some(bytes) = stored {
            for part in bytes.split(|byte| *byte == 0).filter(|part| !part.is_empty()) {
                let id = String::from_utf8(part.to_vec()).map_err(|_| {
                    PluginError::BadArgs(Text::Literal("invalid persisted index id".to_string()))
                })?;
                index.docs.insert(id);
            }
        }
        index.loaded = index.docs.len();
        Ok(())
    }

    fn on_documents_indexed(docs: Vec<DocumentModel>) -> Vec<IndexLoss> {
        let mut index = INDEX.lock().expect("index lock");
        index.fed += docs.len();
        for doc in docs {
            index.docs.insert(doc.id);
        }
        vec![]
    }

    fn on_documents_removed(ids: Vec<DocId>) -> Vec<IndexLoss> {
        let mut index = INDEX.lock().expect("index lock");
        index.removed += ids.len();
        for id in ids {
            index.docs.remove(&id);
        }
        vec![]
    }

    fn reconcile(ids: Vec<DocId>) -> Vec<IndexLoss> {
        let mut index = INDEX.lock().expect("index lock");
        index.reconciled += 1;
        let existing: BTreeSet<_> = ids.into_iter().collect();
        index.docs.retain(|id| existing.contains(id));
        vec![]
    }

    fn flush() -> Result<(), PluginError> {
        let mut index = INDEX.lock().expect("index lock");
        let mut data = Vec::new();
        for id in &index.docs {
            data.extend_from_slice(id.as_bytes());
            data.push(0);
        }
        fub::abi::host_data_write::data_write(DATA, &data)?;
        index.flushed += 1;
        Ok(())
    }

    fn close() -> Result<(), PluginError> {
        fub::abi::host_data_write::data_write(CLOSED, b"yes")?;
        INDEX.lock().expect("index lock").docs.clear();
        Ok(())
    }

    fn query(query: IndexQuery) -> Result<IndexResult, PluginError> {
        if !matches!(&query, IndexQuery::Custom(custom) if custom.ns == ROUTE) {
            return Err(PluginError::BadArgs(Text::Literal("unexpected index route".to_string())));
        }
        let index = INDEX.lock().expect("index lock");
        Ok(IndexResult::Custom(format!(
            "{{\"count\":{},\"loaded\":{},\"fed\":{},\"removed\":{},\"reconciled\":{},\"scanned\":{},\"flushed\":{},\"closed_before\":{}}}",
            index.docs.len(), index.loaded, index.fed, index.removed,
            index.reconciled, index.scanned, index.flushed, index.closed_before,
        )))
    }

    fn up_to_date(_entries: Vec<VaultEntry>) -> Vec<DocId> {
        // The fixture keeps ids, not content fingerprints. Never claim an
        // unchanged document merely because a path is present in the index.
        INDEX.lock().expect("index lock").scanned += 1;
        vec![]
    }
}

export!(Componente);
