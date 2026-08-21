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

use std::collections::HashSet;
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::custom::SyntaxForm;
use fub_abi::format::{
    DocumentFormat, DocumentSource, FormatCapabilities, ParseContext, SourceKind,
};
use fub_abi::model::{DocId, DocumentModel};

use crate::error::{KernelError, Result};
use crate::registry::FormatRegistry;
use crate::renderer::RendererRegistry;
use crate::syntax::SyntaxRegistry;
use crate::vault::{data_root, FUB_DIR, TrashEntry, Vault};

/// Radice dello storage persistente dei plugin, dentro il vault: ogni plugin
/// ha `<vault>/.fub/plugins/<id>/` per i dati autorevoli e non vede nient'altro;
/// la cache derivata vive in `<vault>/.fub/data/plugins/<id>/`.
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
    /// Il supporto arriva da fuori e non si costruisce qui: dentro un workspace
    /// è **uno solo**, condiviso col sidecar dell'organizzazione, con la
    /// configurazione del vault e con l'anagrafe (§15.1, e la
    /// [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) per
    /// il giorno in cui gliel'hanno dato). Due supporti sulla stessa cartella
    /// sarebbero due idee di cosa c'è dentro.
    pub(crate) fn new(
        root: impl AsRef<Utf8Path>,
        registry: Arc<FormatRegistry>,
        storage: Arc<dyn crate::storage::VaultStorage>,
        settings: crate::settings::SharedSettings,
    ) -> Result<Self> {
        Ok(Self {
            // Le impostazioni arrivano fin qui per una riga sola, ed è la
            // §15.6: **quali file sono del vault** è una dichiarazione di
            // questo vault, non una costante di chi ha compilato.
            vault: Vault::on(root, storage)?.watching(settings),
            registry,
            syntax: SyntaxRegistry::new(),
            renderers: RendererRegistry::new(),
        })
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

    /// Come [`parse`](Self::parse), ma il testo lo possiede già chi chiama:
    /// entra nel provider così com'è, senza la copia che la firma presa in
    /// prestito pagherebbe. È la via delle risincronizzazioni, dove il
    /// sorgente è appena uscito da una lettura e non serve a più nessuno.
    pub(crate) fn parse_owned(&self, id: &DocId, source: String) -> Result<DocumentModel> {
        self.parse_source(id, DocumentSource::Text(source))
    }

    /// Legge un documento **nella forma che il suo provider chiede**: testo
    /// decodificato o byte grezzi (§3.4).
    ///
    /// È il **punto unico** in cui `FormatDescriptor::source` viene consultato.
    /// Non è una comodità: finché la scelta stava dentro `parse_from_disk`,
    /// valeva per chi apre un documento e non per chi **indicizza** — che legge
    /// e prende l'impronta in una fase e parsa in un'altra, e quindi non passava
    /// di lì. Lo stesso file aveva due destini a seconda di chi lo leggeva
    /// (§21.8).
    pub(crate) fn source_from_disk(&self, id: &DocId) -> Result<DocumentSource> {
        Ok(match self.provider_for(id)?.descriptor().source {
            SourceKind::Text => DocumentSource::Text(self.vault.read(id)?),
            SourceKind::Bytes => DocumentSource::Bytes(self.vault.read_bytes(id)?),
        })
    }

    /// Legge e parsa un documento nella forma che il suo provider chiede.
    pub(crate) fn parse_from_disk(&self, id: &DocId) -> Result<DocumentModel> {
        self.parse_source(id, self.source_from_disk(id)?)
    }

    pub(crate) fn parse_source(&self, id: &DocId, source: DocumentSource) -> Result<DocumentModel> {
        let provider = self.provider_for(id)?;
        let ctx = ParseContext::obsidian(id.as_str());
        // Il parse è dentro ogni scrittura, quindi sotto il prestito esclusivo
        // di chi scrive: un provider di formato che pania su un documento
        // storto si porterebbe via il vault, e non il documento (§9.3). Con la
        // rete il panico diventa un `FormatError` come un altro, e la scrittura
        // fallisce dicendo di chi è la colpa.
        let mut model = crate::safety::caught(
            &provider.descriptor().id,
            crate::safety::Gate::FormatParse,
            id.as_str(),
            fub_abi::error::FormatError::Parse,
            || provider.parse(&source, &ctx),
        )?;
        // L'innesto del §3.1: le regole sintattiche registrate girano DOPO il
        // provider, sul modello. È ciò che le rende innestabili su un provider
        // che non le conosce — vedi `syntax::apply_rules`.
        self.syntax
            .apply(&mut model, &ctx, &provider.descriptor().id);
        Ok(model)
    }

    pub(crate) fn provider_for(&self, id: &DocId) -> Result<&dyn fub_abi::FormatProvider> {
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
    /// da quelle che le [`SyntaxRule`](fub_abi::custom::SyntaxRule) registrate gli innestano (§3.1).
    /// L'ordine della sovrapposizione dice chi vince su una chiave condivisa,
    /// ed è il provider: se sa fare `fub:math` per conto suo, il suo dettaglio
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

    /// Le sintassi che questo documento capirebbe, e **come si riconoscono**
    /// quando la forma è dichiarata (§4.4).
    ///
    /// È `format_of` per chi deve **disegnare** invece di parsare. Le due
    /// domande hanno la stessa risposta sui nomi e non sulla forma: le capacità
    /// dicono *cosa so fare*, questa dice *a cosa somiglia*, e la seconda esiste
    /// perché una superficie di scrittura non ha il provider — ha un buffer
    /// sporco che nessuno al di qua del confine conosce
    /// ([0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md)).
    ///
    /// L'ordine è quello della **dichiarazione**: prima ciò che il provider sa
    /// fare per conto suo (in ordine di `OptionMap`, cioè di dichiarazione del
    /// provider), poi ciò che le regole innestano, in ordine di applicazione.
    /// Un elenco che cambiasse ordine a ogni chiamata renderebbe il file
    /// generato di `frontend/` rumoroso senza che niente sia cambiato.
    ///
    /// Chi arriva due volte compare **una**, e vince chi porta il trigger: una
    /// regola che innesta un nome che il provider dichiara già è la stessa
    /// sintassi vista da chi ne conosce la forma, ed è la stessa regola di
    /// precedenza di `format_of` letta al contrario — là il provider vince
    /// perché il suo *dettaglio* è più informativo, qui la regola vince perché
    /// il suo *trigger* lo è.
    ///
    /// # Solo le **accese**
    ///
    /// Si legge `active()` e non `iter()`, cioè la stessa domanda che
    /// [`format_of`](Self::format_of) fa con `enabled`. Finché era `iter()` le
    /// due rispondevano diverso sulla stessa mappa: una sintassi che un provider
    /// dichiara *e spegne* — `.with(nome, false)`, l'unico modo che ha di dire
    /// «questa la conosco e qui non la faccio» — non compariva fra le capacità e
    /// compariva fra le forme, cioè la superficie di scrittura l'avrebbe
    /// decorata e il parse non l'avrebbe letta. Nessun provider di questo repo
    /// la usa, il che è precisamente il motivo per cui la divergenza poteva
    /// restare lì.
    pub fn syntax_forms(&self, id: &DocId) -> Vec<SyntaxForm> {
        let Ok(provider) = self.provider_for(id) else {
            return Vec::new();
        };
        let grafted = self.syntax.forms(&provider.descriptor().id);
        // La domanda «è già innestato?» si fa una volta per nome che il
        // provider dichiara: su un insieme, non rescandendo l'elenco.
        let nested: HashSet<&str> = grafted.iter().map(|g| g.name.as_str()).collect();
        let mut out: Vec<SyntaxForm> = provider
            .capabilities()
            .syntax
            .active()
            .filter(|(name, _)| !nested.contains(*name))
            .map(|(name, _)| SyntaxForm {
                name: name.to_string(),
                trigger: None,
            })
            .collect();
        out.extend(grafted);
        out
    }

    // --- storage persistente dei plugin ------------------------------------

    /// La radice autorevole dello spazio dati di un plugin.
    pub(crate) fn plugin_data_root(&self, plugin: &str) -> Utf8PathBuf {
        self.vault
            .root()
            .join(FUB_DIR)
            .join(PLUGIN_DATA_DIR)
            .join(plugin)
    }

    /// La radice derivata dello spazio cache di un plugin.
    pub(crate) fn plugin_cache_root(&self, plugin: &str) -> Utf8PathBuf {
        data_root(self.vault.root())
            .join(PLUGIN_DATA_DIR)
            .join(plugin)
    }

    /// Le radici degli spazi dati **che esistono sul disco**, montati o no.
    ///
    /// Il «o no» è la parte che conta (§13.2): un plugin spento oggi non deve
    /// tornare acceso domani con le chiavi di ieri. La migrazione al rename e la
    /// raccolta camminano il disco, non il registro dei montati — chi non c'è
    /// non può accorgersi di niente, ed è esattamente chi ha più bisogno che
    /// qualcun altro se ne accorga per lui.
    pub(crate) fn plugin_data_roots(&self) -> Vec<Utf8PathBuf> {
        let mut roots = Vec::new();
        for plugins in [
            self.vault.root().join(FUB_DIR).join(PLUGIN_DATA_DIR),
            data_root(self.vault.root()).join(PLUGIN_DATA_DIR),
        ] {
            // In ordine — lo dà `VaultStorage::list` — perché gli errori che ne
            // escono finiscono in un messaggio, e un messaggio che cambia ordine a
            // ogni giro non si confronta. Le due radici restano entrambe leggibili
            // durante il passaggio additivo del layout.
            roots.extend(
                self.vault
                    .storage()
                    .list(&plugins)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|and| and.stat.is_dir())
                    .map(|and| and.path),
            );
        }
        roots
    }
}

/// L'estensione di un `DocId`, in minuscolo e senza il punto.
pub(crate) fn extension_of(id: &DocId) -> Option<String> {
    id.as_str()
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}
