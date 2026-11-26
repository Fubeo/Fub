//! Import ed export: sorgenti aperte, importer ed exporter.

use super::*;

thread_local! {
    /// Gli [`ImportProvider`] che questo thread sta eseguendo, per indirizzo.
    ///
    /// `import` chiede `&mut self`, quindi ogni importer sta dietro il proprio
    /// lucchetto esclusivo. Un secondo import sullo stesso thread — l'importer
    /// che, importando, chiede all'host una sorgente che riconosce lui stesso —
    /// lo aspetterebbe per sempre: lo si rifiuta. Da un altro thread si
    /// aspetta il turno, come per ogni scrittura.
    pub(super) static IMPORTING: std::cell::RefCell<Vec<usize>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub(super) type SharedImport = Arc<SharedShelter<Box<dyn ImportProvider>>>;

pub(super) fn import_key(provider: &SharedImport) -> usize {
    Arc::as_ptr(provider) as *const () as usize
}

pub(super) fn importing_here(provider: &SharedImport) -> bool {
    let key = import_key(provider);
    IMPORTING.with(|running| running.borrow().contains(&key))
}

/// L'iscrizione di un import in corso su questo thread; uscire dallo scope,
/// anche per un panico, la toglie.
pub(super) struct Importing(pub(super) usize);

impl Importing {
    pub(super) fn enter(provider: &SharedImport) -> Importing {
        let key = import_key(provider);
        IMPORTING.with(|running| running.borrow_mut().push(key));
        Importing(key)
    }
}

impl Drop for Importing {
    fn drop(&mut self) {
        IMPORTING.with(|running| {
            let mut running = running.borrow_mut();
            if let Some(at) = running.iter().rposition(|key| *key == self.0) {
                running.remove(at);
            }
        });
    }
}

pub(super) fn reentrant_import(owner: &str) -> PluginError {
    PluginError::Conflict(
        format!("`{owner}` is already importing: an import cannot re-enter its own importer")
            .into(),
    )
}

/// Gli [`ImportProvider`] registrati, presi sotto lock e interpellabili senza
/// tenere `Custody<Workspace>`: un import può durare quanto la rete che lo
/// alimenta, e intanto il workspace resta di tutti.
///
/// Il dispatch è quello di [`Workspace::import`]: in ordine di registrazione,
/// il primo che riconosce la sorgente.
pub struct PreparedImport {
    pub(super) candidates: Vec<(String, SharedImport)>,
}

impl PreparedImport {
    /// La posizione del primo importer che riconosce `source`.
    ///
    /// Nessuno → `BadArgs`: il kernel non ha un formato di riserva, e fingere
    /// di averlo produrrebbe note vuote.
    pub fn choose(&self, source: &ImportSource) -> std::result::Result<usize, PluginError> {
        for (at, (owner, provider)) in self.candidates.iter().enumerate() {
            if importing_here(provider) {
                return Err(reentrant_import(owner));
            }
            if provider.read().can_handle(source) {
                return Ok(at);
            }
        }
        Err(PluginError::BadArgs(
            format!(
                "nessun ImportProvider registrato riconosce `{}`",
                source.name
            )
            .into(),
        ))
    }

    /// Chi ha registrato l'importer in `at`: l'host con cui chiamarlo è il suo.
    pub fn owner(&self, at: usize) -> &str {
        &self.candidates[at].0
    }

    /// Esegue soltanto il codice esterno, con l'host che chi chiama ha
    /// intestato a [`owner`](Self::owner).
    pub fn invoke(
        &self,
        at: usize,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> std::result::Result<ImportReport, PluginError> {
        let (owner, provider) = &self.candidates[at];
        if importing_here(provider) {
            return Err(reentrant_import(owner));
        }
        let _importing = Importing::enter(provider);
        let mut provider = provider.write();
        provider.import(source, request, host)
    }
}

/// Gli [`ExportProvider`] registrati, presi sotto lock e interpellabili senza
/// tenere `Custody<Workspace>`. `export` prende `&self`, quindi più export
/// girano insieme anche sullo stesso provider.
pub struct PreparedExport {
    pub(super) candidates: Vec<(String, Arc<dyn ExportProvider>)>,
}

impl PreparedExport {
    /// Le destinazioni offerte, in ordine di registrazione.
    pub fn targets(&self) -> Vec<ExportTarget> {
        self.candidates
            .iter()
            .flat_map(|(_, provider)| provider.targets())
            .collect()
    }

    /// La posizione del provider che offre `target`; nessuno → `BadArgs`.
    pub fn choose(&self, target: &str) -> std::result::Result<usize, PluginError> {
        self.candidates
            .iter()
            .position(|(_, provider)| provider.targets().iter().any(|t| t.id == target))
            .ok_or_else(|| {
                PluginError::BadArgs(format!("destinazione di export ignota: `{target}`").into())
            })
    }

    /// Chi ha registrato il provider in `at`: l'host con cui chiamarlo è il suo.
    pub fn owner(&self, at: usize) -> &str {
        &self.candidates[at].0
    }

    /// Esegue soltanto il codice esterno, con l'host di sola lettura che chi
    /// chiama ha intestato a [`owner`](Self::owner).
    pub fn invoke(
        &self,
        at: usize,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> std::result::Result<ExportReport, PluginError> {
        self.candidates[at].1.export(request, host, out)
    }
}

impl Workspace {
    // --- import ed export ---------------------------------------------------
    //
    // Il kernel non sa cosa sia un formato di scambio: sa scegliere chi lo sa e
    // prestargli le capacità. Vedi `fub_abi::transfer`.

    /// Registra un [`ImportProvider`] sotto un id. L'ordine di registrazione è
    /// l'ordine in cui i provider vengono interpellati da
    /// [`import`](Workspace::import).
    ///
    /// Come per gli altri provider, `id` è un nome semplice e determina lo
    /// spazio dati autorevole (`.fub/plugins/<id>/`), con cache derivata in `.fub/data/plugins/<id>/`.
    pub fn register_import_provider(
        &mut self,
        plugin: impl Into<String>,
        p: Box<dyn ImportProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::import(p);
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Registra un [`ExportProvider`] per conto di un plugin dichiarato.
    ///
    /// Gli id delle **destinazioni** (`markdown.files`) sono nomi in uno spazio
    /// condiviso: valgono la regola del §7.4 e il conflitto, come per le view.
    pub fn register_export_provider(
        &mut self,
        plugin: impl Into<String>,
        p: Box<dyn ExportProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::export(p).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// **Apre** una sorgente perché un provider la legga a pezzi invece che
    /// tutta insieme (decisione 0102).
    ///
    /// Chi chiama è chi ha aperto il dialogo di sistema: il kernel non sceglie
    /// il file, lo riceve già aperto sotto forma di [`SourceBacking`]. È la
    /// stessa divisione della 0006 — «chi apre il dialogo di sistema e chi posa
    /// i byte è l'host» — spostata di un gradino, perché adesso c'è qualcosa da
    /// tenere aperto fra l'una e l'altra.
    ///
    /// Il prologo si legge **qui e una volta sola**, ed è ciò che rende
    /// possibile il dispatch: [`ImportProvider::can_handle`] non riceve un host
    /// e quindi non può leggere niente. Senza, una sorgente a handle si
    /// riconoscerebbe dal solo nome — e la 0006 spiega perché non basta.
    ///
    /// Chiude [`close_source`](Workspace::close_source), e non `import`: la
    /// coppia preview→apply è due chiamate sulla stessa sorgente, e chiuderla in
    /// mezzo vorrebbe dire rileggerla per rispondere alla stessa domanda.
    pub fn open_source(
        &mut self,
        name: impl Into<String>,
        media_type: Option<String>,
        mut backing: Box<dyn SourceBacking>,
    ) -> std::result::Result<ImportSource, PluginError> {
        let len = backing.len();
        let prologue = backing.read_at(0, PROLOGUE as u32)?;
        let handle = self.sources.acquire().open(backing);
        Ok(ImportSource {
            name: name.into(),
            media_type,
            content: SourceContent::Streamed(StreamedSource {
                handle,
                len,
                prologue,
            }),
        })
    }

    /// Chiude una sorgente aperta. Chiudere ciò che non c'è riesce.
    pub fn close_source(&mut self, handle: SourceHandle) {
        self.sources.acquire().close(handle);
    }

    /// Legge da una sorgente aperta: il lato host di
    /// [`TransferRead::read_source`](fub_abi::traits::TransferRead::read_source).
    pub(crate) fn read_open_source(
        &self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> std::result::Result<Vec<u8>, PluginError> {
        self.sources.acquire().read(handle, offset, len)
    }

    /// Quanti byte ha una sorgente aperta, se lo è.
    pub fn source_len(&self, handle: SourceHandle) -> Option<u64> {
        self.sources.acquire().len(handle)
    }

    /// Gli importer registrati, per chiamarli fuori dal lock del workspace.
    pub fn prepare_import(&self) -> PreparedImport {
        PreparedImport {
            candidates: self
                .providers
                .imports
                .iter()
                .map(|(owner, provider)| (owner.clone(), Arc::clone(provider)))
                .collect(),
        }
    }

    /// Gli exporter registrati, per chiamarli fuori dal lock del workspace.
    pub fn prepare_export(&self) -> PreparedExport {
        PreparedExport {
            candidates: self
                .providers
                .exports
                .iter()
                .map(|(owner, provider)| (owner.clone(), Arc::clone(provider)))
                .collect(),
        }
    }

    /// Fa entrare una sorgente esterna nel vault, col **primo** provider
    /// registrato che la riconosce.
    ///
    /// Il dispatch è lo stesso di `query_index` visto da vicino: interpellare in
    /// ordine e fermarsi al primo che risponde. Qui però la domanda «è roba
    /// tua?» è esplicita ([`ImportProvider::can_handle`]) invece di essere
    /// dedotta da un `BadArgs`, perché una sorgente si può riconoscere **senza**
    /// provare a importarla — e provare, per un import, vuol dire scrivere.
    ///
    /// Nessun provider la riconosce → `BadArgs`: il kernel non ha un formato di
    /// riserva, e fingere di averlo produrrebbe note vuote.
    ///
    /// Gli eventi che l'import genera (una `DocumentChanged` per documento,
    /// oggi) arrivano **dopo** che la chiamata del provider è tornata, come per
    /// ogni altro callback in scrittura. Che siano N e non uno è il debito del
    /// decisione 0011 (il lotto), non una scelta di qui.
    pub fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
    ) -> std::result::Result<ImportReport, PluginError> {
        self.import_in_mode(source, request, InvokeMode::Apply)
    }

    /// Come [`import`](Workspace::import), chiesto da un host in `mode`.
    ///
    /// L'importer riceve le **proprie** capacità, come un servizio; in
    /// simulazione però le riceve dietro la stessa politica di sola lettura
    /// del comando che lo chiede, così un'anteprima dentro un `dry-run` non
    /// ha una scala per scrivere.
    pub(crate) fn import_in_mode(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        mode: InvokeMode,
    ) -> std::result::Result<ImportReport, PluginError> {
        let prepared = self.prepare_import();
        let at = prepared.choose(source)?;
        let owner = prepared.owner(at).to_string();
        // La stessa disciplina di tutti gli altri, e non più una quarta copia:
        // vedi `Workspace::with_provider_call`.
        let report = self.with_provider_call(|ws| {
            if mode.is_dry_run() {
                let granted = ws.providers.plugins.granted(&owner);
                let mut host = Guard::new(
                    KernelHost {
                        ws,
                        plugin: &owner,
                        mode: InvokeMode::DryRun,
                        instance: None,
                    },
                    (
                        ReadOnly {
                            why: "una simulazione non scrive",
                        },
                        granted,
                    ),
                );
                prepared.invoke(at, source, request, &mut host)
            } else {
                let mut host = ws.host_for(&owner, InvokeMode::Apply);
                prepared.invoke(at, source, request, &mut host)
            }
        });
        self.dispatch_pending();
        // L'errore dell'importer, nel catalogo di chi l'ha scritto (§12.2),
        // come quello di un exporter.
        report.map_err(|error| self.localized(&owner, error))
    }

    /// Le destinazioni di export offerte dai provider registrati.
    pub fn export_targets(&self) -> Vec<ExportTarget> {
        self.providers.export_targets()
    }

    /// Esporta secondo la richiesta, col provider che possiede la destinazione.
    ///
    /// Prende `&self`, come [`render_view`](Workspace::render_view) e per la
    /// stessa ragione: un export è una lettura, e le letture girano sotto
    /// prestito condiviso invece di mettersi in fila dietro una scrittura. Il
    /// provider durante l'export vede il mondo intero attraverso un host di
    /// sola lettura — indici compresi, che è ciò che serve a una selezione per
    /// query.
    pub fn export(
        &self,
        request: &ExportRequest,
    ) -> std::result::Result<ExportReport, PluginError> {
        let mut sink = MemorySink::default();
        self.export_to(request, &mut sink)
    }

    /// Come [`export`](Workspace::export), ma versando gli artefatti dove dice
    /// chi chiama (decisione 0102).
    ///
    /// I due non sono due modi di fare la stessa cosa: `export` tiene tutto in
    /// memoria — che è ciò che il contratto faceva sempre, e che va benissimo
    /// per tre note — mentre qui l'esito può non entrarci. Un export del vault
    /// intero in PDF è il caso per cui questa esiste.
    pub fn export_to(
        &self,
        request: &ExportRequest,
        out: &mut dyn ArtifactSink,
    ) -> std::result::Result<ExportReport, PluginError> {
        let prepared = self.prepare_export();
        let at = prepared.choose(&request.target)?;
        let owner = prepared.owner(at);
        let host = self.read_host_for(owner);
        // L'errore dell'exporter, nel catalogo di chi l'ha scritto (§12.2).
        prepared
            .invoke(at, request, &host, out)
            .map_err(|error| self.localized(owner, error))
    }
}
