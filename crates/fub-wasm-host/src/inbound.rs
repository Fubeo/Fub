//! WASM proxies for inbound index and event exports.
//!
//! Each proxy owns the same instance as its plugin. Declarations are captured at
//! mount, while feed, query, persistence and notice delivery cross the component
//! boundary under the instance guard. Registration and teardown belong to the
//! bundle registry, not to these proxies.

use std::sync::{Arc, Mutex};

use fub_abi::event::Notice;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute,
    VaultEntry,
};
use fub_abi::PluginError;

use crate::inbound_convert as ic;
use crate::translate as tr;

/// Proxy `IndexProvider` sopra la stessa istanza del `WasmPlugin` montato.
///
/// Le rotte sono congelate al montaggio: [`routes`](IndexProvider::routes) le
/// clona, non le rilegge.
pub struct WasmIndexProvider {
    pub(crate) inner: Arc<Mutex<crate::component::Instance>>,
    pub(crate) routes: Vec<QueryRoute>,
}

/// Proxy `EventHandler` inbound sopra la stessa istanza del montato.
///
/// La maschera è congelata al montaggio: [`subscribed`](EventHandler::subscribed)
/// la clona, non la rilegge.
pub struct WasmEventHandler {
    pub(crate) inner: Arc<Mutex<crate::component::Instance>>,
    pub(crate) mask: fub_abi::event::EventMask,
}

/// Legge le rotte e congela il provider di indice sullo stesso `Arc`.
///
/// `None` se il componente non esporta `fub:abi/index`; `Err(String)` se le
/// rotte sono illeggibili o il componente cade, per
/// `RegistrationReport::failed`.
pub(crate) fn index_provider_from_inner(
    inner: Arc<Mutex<crate::component::Instance>>,
) -> Result<Option<WasmIndexProvider>, String> {
    let _guard = crate::component::enter_instance(crate::component::instance_identity(&inner))
        .map_err(|_| "re-entrant component call".to_string())?;
    let routes = {
        let mut locked = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let instance = &mut *locked;
        let Some(index) = instance.interfaces.index.as_ref() else {
            return Ok(None);
        };
        crate::limits::renew(&mut instance.store);
        let routes = index.call_routes(&mut instance.store).map_err(|error| {
            format!(
                "indice non dichiarato: {}",
                crate::component::failure(error)
            )
        })?;
        routes
            .into_iter()
            .map(ic::from_query_route)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("rotte non traducibili: {error}"))?
    };
    Ok(Some(WasmIndexProvider { inner, routes }))
}

/// Legge la maschera e congela l'handler sullo stesso `Arc`.
///
/// `None` se il componente non esporta `fub:abi/event-handler`; `Err(String)`
/// se la maschera è illeggibile o il componente cade, per
/// `RegistrationReport::failed`.
pub(crate) fn event_handler_from_inner(
    inner: Arc<Mutex<crate::component::Instance>>,
) -> Result<Option<WasmEventHandler>, String> {
    let _guard = crate::component::enter_instance(crate::component::instance_identity(&inner))
        .map_err(|_| "re-entrant component call".to_string())?;
    let mask = {
        let mut locked = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let instance = &mut *locked;
        let Some(handler) = instance.interfaces.event_handler.as_ref() else {
            return Ok(None);
        };
        crate::limits::renew(&mut instance.store);
        let mask = handler
            .call_subscribed(&mut instance.store)
            .map_err(|error| {
                format!(
                    "sottoscrizione non dichiarata: {}",
                    crate::component::failure(error)
                )
            })?;
        ic::from_event_mask(mask)
    };
    Ok(Some(WasmEventHandler { inner, mask }))
}

fn avvelenato() -> PluginError {
    PluginError::Internal("component instance is poisoned".into())
}

fn rientro() -> PluginError {
    PluginError::Internal("re-entrant component call".into())
}

impl IndexProvider for WasmIndexProvider {
    fn routes(&self) -> Vec<QueryRoute> {
        self.routes.clone()
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        crate::component::call(&self.inner, host, |interfaces, store| {
            let index = interfaces.index.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/index`".into())
            })?;
            index
                .call_activate(store)
                .map_err(crate::component::failure)?
                .map_err(tr::from_error)
        })
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        if docs.is_empty() {
            return Vec::new();
        }
        let mut documenti = Vec::with_capacity(docs.len());
        let mut accepted_ids = Vec::with_capacity(docs.len());
        let mut perdite = Vec::new();
        for doc in docs {
            match crate::model::to_document(doc.clone()) {
                Ok(documento) => {
                    documenti.push(documento);
                    accepted_ids.push(&doc.id);
                }
                Err(error) => perdite.push(IndexLoss::new(doc.id.clone(), error)),
            }
        }
        if documenti.is_empty() {
            return perdite;
        }
        let _guard = match crate::component::enter_instance(crate::component::instance_identity(
            self.inner.as_ref(),
        )) {
            Ok(guard) => guard,
            Err(()) => {
                return docs
                    .iter()
                    .map(|doc| IndexLoss::new(doc.id.clone(), rientro()))
                    .collect()
            }
        };
        let mut locked = match self.inner.lock() {
            Ok(locked) => locked,
            Err(_) => {
                return docs
                    .iter()
                    .map(|doc| IndexLoss::new(doc.id.clone(), avvelenato()))
                    .collect()
            }
        };
        let instance = &mut *locked;
        crate::limits::renew(&mut instance.store);
        let Some(index) = instance.interfaces.index.as_ref() else {
            return docs
                .iter()
                .map(|doc| {
                    IndexLoss::new(
                        doc.id.clone(),
                        PluginError::Internal("il componente non esporta `fub:abi/index`".into()),
                    )
                })
                .collect();
        };
        match index.call_on_documents_indexed(&mut instance.store, &documenti) {
            Ok(guest_losses) => perdite.extend(guest_losses.into_iter().map(ic::from_index_loss)),
            Err(error) => {
                let why = crate::component::failure(error);
                perdite.extend(
                    accepted_ids
                        .into_iter()
                        .map(|id| IndexLoss::new(id.clone(), why.clone())),
                );
            }
        }
        perdite
    }

    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        if ids.is_empty() {
            return Vec::new();
        }
        let _guard = match crate::component::enter_instance(crate::component::instance_identity(
            self.inner.as_ref(),
        )) {
            Ok(guard) => guard,
            Err(()) => {
                return ids
                    .iter()
                    .map(|id| IndexLoss::new(id.clone(), rientro()))
                    .collect()
            }
        };
        let mut locked = match self.inner.lock() {
            Ok(locked) => locked,
            Err(_) => {
                return ids
                    .iter()
                    .map(|id| IndexLoss::new(id.clone(), avvelenato()))
                    .collect()
            }
        };
        let instance = &mut *locked;
        crate::limits::renew(&mut instance.store);
        let Some(index) = instance.interfaces.index.as_ref() else {
            return ids
                .iter()
                .map(|id| {
                    IndexLoss::new(
                        id.clone(),
                        PluginError::Internal("il componente non esporta `fub:abi/index`".into()),
                    )
                })
                .collect();
        };
        let righe: Vec<String> = ids.iter().map(|id| id.0.clone()).collect();
        match index.call_on_documents_removed(&mut instance.store, &righe) {
            Ok(perdite) => perdite.into_iter().map(ic::from_index_loss).collect(),
            Err(error) => {
                let why = crate::component::failure(error);
                ids.iter()
                    .map(|id| IndexLoss::new(id.clone(), why.clone()))
                    .collect()
            }
        }
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let _guard = match crate::component::enter_instance(crate::component::instance_identity(
            self.inner.as_ref(),
        )) {
            Ok(guard) => guard,
            Err(()) => {
                return ids
                    .iter()
                    .map(|id| IndexLoss::new(id.clone(), rientro()))
                    .collect()
            }
        };
        let mut locked = match self.inner.lock() {
            Ok(locked) => locked,
            Err(_) => {
                return ids
                    .iter()
                    .map(|id| IndexLoss::new(id.clone(), avvelenato()))
                    .collect()
            }
        };
        let instance = &mut *locked;
        crate::limits::renew(&mut instance.store);
        let Some(index) = instance.interfaces.index.as_ref() else {
            return ids
                .iter()
                .map(|id| {
                    IndexLoss::new(
                        id.clone(),
                        PluginError::Internal("il componente non esporta `fub:abi/index`".into()),
                    )
                })
                .collect();
        };
        let righe: Vec<String> = ids.iter().map(|id| id.0.clone()).collect();
        match index.call_reconcile(&mut instance.store, &righe) {
            Ok(perdite) => perdite.into_iter().map(ic::from_index_loss).collect(),
            Err(error) => {
                let why = crate::component::failure(error);
                ids.iter()
                    .map(|id| IndexLoss::new(id.clone(), why.clone()))
                    .collect()
            }
        }
    }

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        crate::component::call(&self.inner, host, |interfaces, store| {
            let index = interfaces.index.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/index`".into())
            })?;
            index
                .call_flush(store)
                .map_err(crate::component::failure)?
                .map_err(tr::from_error)
        })
    }

    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        crate::component::call(&self.inner, host, |interfaces, store| {
            let index = interfaces.index.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/index`".into())
            })?;
            index
                .call_close(store)
                .map_err(crate::component::failure)?
                .map_err(tr::from_error)
        })
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let domanda = ic::to_index_query(&query)?;
        let _guard = crate::component::enter_instance(crate::component::instance_identity(
            self.inner.as_ref(),
        ))
        .map_err(|_| rientro())?;
        let mut locked = self.inner.lock().map_err(|_| avvelenato())?;
        let instance = &mut *locked;
        crate::limits::renew(&mut instance.store);
        let index = instance.interfaces.index.as_ref().ok_or_else(|| {
            PluginError::Internal("il componente non esporta `fub:abi/index`".into())
        })?;
        let risposta = index
            .call_query(&mut instance.store, &domanda)
            .map_err(crate::component::failure)?
            .map_err(tr::from_error)?;
        ic::from_index_result(risposta)
    }

    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        if entries.is_empty() {
            return Vec::new();
        }
        let voci: Vec<_> = entries.iter().map(ic::to_vault_entry).collect();
        let _guard = match crate::component::enter_instance(crate::component::instance_identity(
            self.inner.as_ref(),
        )) {
            Ok(guard) => guard,
            Err(()) => return Vec::new(),
        };
        let mut locked = match self.inner.lock() {
            Ok(locked) => locked,
            Err(_) => return Vec::new(),
        };
        let instance = &mut *locked;
        crate::limits::renew(&mut instance.store);
        let Some(index) = instance.interfaces.index.as_ref() else {
            return Vec::new();
        };
        match index.call_up_to_date(&mut instance.store, &voci) {
            Ok(righe) => righe.into_iter().map(DocId).collect(),
            Err(_) => Vec::new(),
        }
    }
}

impl EventHandler for WasmEventHandler {
    fn subscribed(&self) -> fub_abi::event::EventMask {
        self.mask.clone()
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let avviso = ic::to_notice(notice);
        crate::component::call(&self.inner, host, |interfaces, store| {
            let handler = interfaces.event_handler.as_ref().ok_or_else(|| {
                PluginError::Internal("il componente non esporta `fub:abi/event-handler`".into())
            })?;
            handler
                .call_handle(store, &avviso)
                .map_err(crate::component::failure)?
                .map_err(tr::from_error)
        })
    }
}
