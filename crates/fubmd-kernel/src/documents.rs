//! Il magazzino dei documenti: **il disco, e come ciò che ci sta sopra
//! diventa un modello**.
//!
//! È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`, e mette
//! insieme quattro campi che rispondono alla stessa domanda da quattro
//! distanze: il [`Vault`] sa *dove stanno i byte*, la [`FormatRegistry`] sa
//! *chi li capisce*, la [`SyntaxRegistry`] sa *cosa si innesta su chi li
//! capisce* (§3.1) e la [`RendererRegistry`] sa *chi disegna ciò che ne esce*
//! (§3.2). Separarli darebbe quattro componenti che nessuna operazione usa uno
//! alla volta: **ogni** parse li attraversa tutti e quattro.
//!
//! # Cosa **non** sta qui
//!
//! *Quali documenti esistono.* Sembra una domanda del vault e non lo è: la
//! risposta è la cache dei metadati dell'indice del kernel, e resta di là.
//! `Vault::exists` guarda il filesystem — che è un'altra domanda, e dà un'altra
//! risposta per un file che c'è ma nessuno ha ancora indicizzato. Chi vuole
//! l'insieme dei documenti *conosciuti* passa dall'indice; questo componente
//! sa solo leggere e scrivere quelli che gli si nominano.
//!
//! Non sta qui nemmeno la **cache dei modelli parsati**, per la ragione più
//! semplice: non esiste. Lo split metadata/body vuole che il corpo si rilegga
//! dal disco a ogni richiesta (`DocumentStore::parse_from_disk`), e la cache
//! tiene i soli metadati. È un fatto che vale la pena scrivere perché il §8.1
//! dava per scontato il contrario.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::format::{
    DocumentFormat, DocumentSource, FormatCapabilities, ParseContext, SourceKind,
};
use fubmd_abi::model::{DocId, DocumentModel};

use crate::error::{KernelError, Result};
use crate::registry::FormatRegistry;
use crate::renderer::RendererRegistry;
use crate::syntax::SyntaxRegistry;
use crate::vault::{TrashEntry, Vault, DATA_DIR};

/// Radice dello storage persistente dei plugin, dentro il vault: ogni plugin
/// ha `<vault>/.fubmd-data/plugins/<id>/` e non vede nient'altro.
///
/// Sta nel vault e non nella cartella di configurazione dell'utente perché i
/// dati derivati da un vault appartengono a quel vault: copiarlo, spostarlo o
/// metterlo in sync deve portarsi dietro anche loro.
const PLUGIN_DATA_DIR: &str = "plugins";

pub struct DocumentStore {
    /// I byte sul disco. `pub(crate)` e non dietro accessori perché le
    /// operazioni composte del `Workspace` (rinomina, cestino, riscrittura dei
    /// link) ne usano una dozzina di verbi diversi, e una facciata che li
    /// ripetesse tutti sarebbe una seconda copia della `Vault` senza esserne
    /// una: il componente è un **raggruppamento di proprietà**, non un muro.
    pub(crate) vault: Vault,
    /// Chi capisce quale estensione. Condiviso (`Arc`) con l'indice del kernel
    /// invece che copiato: «quali estensioni sono documenti» è una domanda
    /// sola.
    pub(crate) registry: Arc<FormatRegistry>,
    /// Le sintassi innestate sui provider (§3.1). Girano dopo il parse, sul
    /// modello: è ciò che le rende innestabili su un provider che non le
    /// conosce.
    pub(crate) syntax: SyntaxRegistry,
    /// Chi disegna quale `custom_kind` (§3.2). Il registro che l'escape hatch
    /// del modello non aveva.
    pub(crate) renderers: RendererRegistry,
}

impl DocumentStore {
    pub(crate) fn new(root: impl AsRef<Utf8Path>, registry: Arc<FormatRegistry>) -> Self {
        Self {
            vault: Vault::open(root),
            registry,
            syntax: SyntaxRegistry::new(),
            renderers: RendererRegistry::new(),
        }
    }

    /// La radice del vault.
    pub fn root(&self) -> &Utf8Path {
        self.vault.root()
    }

    /// Le estensioni che qualche provider rivendica.
    pub fn extensions(&self) -> Vec<String> {
        self.registry.all_extensions()
    }

    /// Il sorgente di un documento, come testo.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.vault.read(id)
    }

    /// C'è un provider per l'estensione di questo id?
    pub(crate) fn has_provider_for(&self, id: &DocId) -> bool {
        extension_of(id).is_some_and(|ext| self.registry.provider_for_ext(&ext).is_some())
    }

    // --- cestino -----------------------------------------------------------

    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.vault.list_trash()
    }

    pub fn empty_trash(&mut self) -> Result<usize> {
        self.vault.empty_trash()
    }

    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe.
    pub fn undrawn_kinds(&self) -> Vec<String> {
        let drawn = self.renderers.rendered_kinds();
        self.syntax
            .produced_kinds()
            .into_iter()
            .filter(|k| !drawn.contains(k))
            .collect()
    }

    // --- parse -------------------------------------------------------------

    /// Parsa una sorgente che il chiamante ha già in mano.
    ///
    /// Ha per forza del testo: chi la chiama è appena passato da una scrittura o
    /// da un `Vault::read`. Per un documento che sta solo sul disco c'è
    /// `DocumentStore::parse_from_disk`, che legge nella forma che il provider
    /// ha dichiarato.
    pub(crate) fn parse(&self, id: &DocId, source: &str) -> Result<DocumentModel> {
        self.parse_source(id, DocumentSource::Text(source.to_string()))
    }

    /// Legge e parsa un documento **nella forma che il suo provider chiede**:
    /// testo decodificato o byte grezzi (§3.4).
    pub(crate) fn parse_from_disk(&self, id: &DocId) -> Result<DocumentModel> {
        let source = match self.provider_for(id)?.descriptor().source {
            SourceKind::Text => DocumentSource::Text(self.vault.read(id)?),
            SourceKind::Bytes => DocumentSource::Bytes(self.vault.read_bytes(id)?),
        };
        self.parse_source(id, source)
    }

    fn parse_source(&self, id: &DocId, source: DocumentSource) -> Result<DocumentModel> {
        let provider = self.provider_for(id)?;
        let ctx = ParseContext::obsidian(id.as_str());
        // Il parse è dentro ogni scrittura, quindi sotto il prestito esclusivo
        // di chi scrive: un provider di formato che pania su un documento
        // storto si porterebbe via il vault, e non il documento (§9.3). Con la
        // rete il panico diventa un `FormatError` come un altro, e la scrittura
        // fallisce dicendo di chi è la colpa.
        let mut model = crate::safety::caught(
            &provider.descriptor().id,
            &format!("parsando `{id}`"),
            fubmd_abi::error::FormatError::Parse,
            || provider.parse(&source, &ctx),
        )?;
        // L'innesto del §3.1: le regole sintattiche registrate girano DOPO il
        // provider, sul modello. È ciò che le rende innestabili su un provider
        // che non le conosce — vedi `syntax::apply_rules`.
        self.syntax
            .apply(&mut model, &ctx, &provider.descriptor().id);
        Ok(model)
    }

    pub(crate) fn provider_for(&self, id: &DocId) -> Result<&dyn fubmd_abi::FormatProvider> {
        let ext = extension_of(id).unwrap_or_default();
        self.registry
            .provider_for_ext(&ext)
            .ok_or(KernelError::NoProvider(ext))
    }

    /// Di che formato è un documento, e che sintassi capirebbe (§4.3).
    ///
    /// Non tocca il disco e non chiede che il documento esista: è una domanda
    /// sull'**estensione**, e il registro dei formati è l'unico che sa
    /// rispondere. `None` = nessun provider la rivendica.
    ///
    /// Le capacità sono quelle **effettive**: quelle del provider, sovrapposte
    /// da quelle che le [`SyntaxRule`](fubmd_abi::custom::SyntaxRule) registrate gli innestano (§3.1).
    /// L'ordine della sovrapposizione dice chi vince su una chiave condivisa,
    /// ed è il provider: se sa fare `fubmd:math` per conto suo, il suo dettaglio
    /// è più informativo del semplice «acceso» che una regola può dichiarare.
    pub fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        let provider = self.provider_for(id).ok()?;
        let descriptor = provider.descriptor();
        let grafted = self.syntax.grafted_syntax(&descriptor.id);
        let capabilities = FormatCapabilities {
            syntax: grafted.overlay(&provider.capabilities().syntax),
        };
        Some(DocumentFormat {
            descriptor,
            capabilities,
        })
    }

    // --- storage persistente dei plugin ------------------------------------

    /// La radice dello spazio dati di un plugin.
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.vault
            .root()
            .join(DATA_DIR)
            .join(PLUGIN_DATA_DIR)
            .join(plugin)
    }
}

/// L'estensione di un `DocId`, in minuscolo e senza il punto.
pub(crate) fn extension_of(id: &DocId) -> Option<String> {
    id.as_str()
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}
