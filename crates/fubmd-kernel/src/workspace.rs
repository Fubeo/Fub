//! Il `Workspace`: l'orchestratore del core. Tiene insieme vault, registry dei
//! formati, cache dei modelli parsati, grafo dei link ed event bus. È l'API
//! principale che l'app Tauri consuma. Resta agnostico: parla solo tramite
//! `dyn FormatProvider` e i tipi di `fubmd-abi`.

use std::collections::HashMap;

use camino::Utf8Path;
use fubmd_abi::format::{ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::BacklinkRef;
use fubmd_abi::Event;

use crate::bus::EventBus;
use crate::error::{KernelError, Result};
use crate::graph::LinkGraph;
use crate::registry::FormatRegistry;
use crate::vault::Vault;

/// Come il `Workspace` tiene aggiornato il grafo dopo una modifica.
///
/// L'incrementale è il percorso normale; il rebuild completo resta disponibile
/// come rete di sicurezza (e come oracolo nei test) finché non ci fidiamo
/// ciecamente dell'invalidazione — vedi `docs/milestones/M2-search-graph.md`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum GraphUpdate {
    #[default]
    Incremental,
    FullRebuild,
}

pub struct Workspace {
    vault: Vault,
    registry: FormatRegistry,
    models: HashMap<DocId, DocumentModel>,
    graph: LinkGraph,
    graph_update: GraphUpdate,
    bus: EventBus,
}

impl Workspace {
    /// Crea un workspace su una radice con un registry di provider già popolato.
    pub fn new(root: impl AsRef<Utf8Path>, registry: FormatRegistry) -> Self {
        Workspace {
            vault: Vault::open(root),
            registry,
            models: HashMap::new(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            bus: EventBus::new(),
        }
    }

    /// Sceglie la strategia di aggiornamento del grafo (default: incrementale).
    pub fn set_graph_update(&mut self, mode: GraphUpdate) {
        self.graph_update = mode;
    }

    pub fn graph_update(&self) -> GraphUpdate {
        self.graph_update
    }

    pub fn bus(&self) -> &EventBus {
        &self.bus
    }

    pub fn root(&self) -> &Utf8Path {
        self.vault.root()
    }

    /// Riparsa tutti i documenti del vault e ricostruisce il grafo.
    pub fn reindex(&mut self) -> Result<()> {
        let ids = self.vault.list_documents(&self.registry.all_extensions())?;
        let mut models = HashMap::with_capacity(ids.len());
        for id in ids {
            {
                let src = self.vault.read(&id)?;
                let model = self.parse(&id, &src)?;
                models.insert(id, model);
            }
        }
        self.models = models;
        self.rebuild_graph();
        self.bus.emit(Event::VaultOpened {
            root: self.vault.root().to_string(),
        });
        self.bus.emit(Event::IndexUpdated);
        Ok(())
    }

    /// Elenco ordinato dei documenti indicizzati.
    pub fn documents(&self) -> Vec<DocId> {
        let mut ids: Vec<DocId> = self.models.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn model(&self, id: &DocId) -> Option<&DocumentModel> {
        self.models.get(id)
    }

    /// Sorgente grezza di un documento dal disco.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.vault.read(id)
    }

    /// Scrive la sorgente, riparsa il documento, aggiorna il grafo ed emette
    /// gli eventi. Il grafo si aggiorna per-documento ([`GraphUpdate`]).
    pub fn write_document(&mut self, id: &DocId, source: &str) -> Result<()> {
        self.vault.write(id, source)?;
        self.ingest(id, source)
    }

    /// Riparsa un documento già presente sul disco (usato dal file watcher).
    pub fn refresh_from_disk(&mut self, id: &DocId) -> Result<()> {
        let src = self.vault.read(id)?;
        self.ingest(id, &src)
    }

    fn ingest(&mut self, id: &DocId, source: &str) -> Result<()> {
        let model = self.parse(id, source)?;
        self.models.insert(id.clone(), model);
        match self.graph_update {
            // borrow disgiunti: `graph` in scrittura, `models` in lettura.
            GraphUpdate::Incremental => self.graph.upsert(&self.models[id]),
            GraphUpdate::FullRebuild => self.rebuild_graph(),
        }
        self.bus.emit(Event::DocumentChanged { id: id.clone() });
        self.bus.emit(Event::IndexUpdated);
        Ok(())
    }

    /// Sincronizza un path assoluto dopo un evento del filesystem: riparsa se
    /// esiste ed è un formato gestito, rimuove se sparito. Restituisce `true`
    /// se qualcosa è cambiato. Path fuori dal vault o senza provider: ignorati.
    pub fn sync_path(&mut self, abs: &Utf8Path) -> Result<bool> {
        let id = match self.vault.doc_id_for_path(abs) {
            Ok(id) => id,
            Err(_) => return Ok(false),
        };
        let ext = extension_of(&id).unwrap_or_default();
        if self.registry.provider_for_ext(&ext).is_none() {
            return Ok(false);
        }
        if abs.exists() {
            self.refresh_from_disk(&id)?;
            Ok(true)
        } else {
            let existed = self.models.contains_key(&id);
            self.remove_document(&id);
            Ok(existed)
        }
    }

    /// Rimuove un documento (usato dal file watcher su cancellazione).
    pub fn remove_document(&mut self, id: &DocId) {
        if self.models.remove(id).is_some() {
            match self.graph_update {
                GraphUpdate::Incremental => self.graph.remove(id),
                GraphUpdate::FullRebuild => self.rebuild_graph(),
            }
            self.bus.emit(Event::DocumentRemoved { id: id.clone() });
            self.bus.emit(Event::IndexUpdated);
        }
    }

    /// Rende l'anteprima HTML di un documento tramite il suo provider.
    pub fn render_preview(&self, id: &DocId) -> Result<String> {
        let model = self
            .models
            .get(id)
            .ok_or_else(|| KernelError::NotFound(id.to_string()))?;
        let provider = self.provider_for(id)?;
        let opts = RenderOptions {
            wikilinks_as_data_attrs: true,
        };
        Ok(provider.render_html(model, &opts)?)
    }

    /// Backlink verso un documento.
    pub fn backlinks(&self, id: &DocId) -> Vec<BacklinkRef> {
        self.graph.backlinks(id)
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, id: &DocId) -> Vec<DocId> {
        self.graph.outgoing(id)
    }

    /// Risolve il nome di un wikilink a un documento esistente.
    pub fn resolve_link(&self, page: &str) -> Option<DocId> {
        self.graph.resolve_wiki(page)
    }

    // --- interni ---------------------------------------------------------

    fn parse(&self, id: &DocId, source: &str) -> Result<DocumentModel> {
        let provider = self.provider_for(id)?;
        let ctx = ParseContext::obsidian(id.as_str());
        Ok(provider.parse(source, &ctx)?)
    }

    fn provider_for(&self, id: &DocId) -> Result<&dyn fubmd_abi::FormatProvider> {
        let ext = extension_of(id).unwrap_or_default();
        self.registry
            .provider_for_ext(&ext)
            .ok_or(KernelError::NoProvider(ext))
    }

    fn rebuild_graph(&mut self) {
        self.graph = LinkGraph::build(self.models.values());
    }
}

fn extension_of(id: &DocId) -> Option<String> {
    id.as_str()
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}
