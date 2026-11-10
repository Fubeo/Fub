//! Query, comandi, trasferimenti, rete e servizi del doppio.

use super::*;

impl HostQuery for MemoryHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            // Come il kernel: i backlink sono una risposta del grafo, qui
            // seminata a mano. Un target senza backlink è una lista vuota, non
            // un errore.
            // La finestra la applica il doppio come la applica il kernel su una
            // risposta già in memoria (`Paged::window`): una view che paginasse
            // solo contro il finto non sarebbe provata.
            IndexQuery::Backlinks { target, page } => Ok(IndexResult::Backlinks(Paged::window(
                self.backlinks
                    .lock()
                    .unwrap()
                    .get(target.as_str())
                    .cloned()
                    .unwrap_or_default(),
                page,
            ))),
            // Come il kernel: l'outline è servito dai modelli, qui seminato a
            // mano. Documento senza outline → lista vuota, non un errore.
            IndexQuery::Outline { doc } => Ok(IndexResult::Outline(
                self.outlines
                    .lock()
                    .unwrap()
                    .get(doc.as_str())
                    .cloned()
                    .unwrap_or_default(),
            )),
            // **L'anagrafe**, e la serve dai documenti che ha in memoria: è la
            // sola domanda del canale a cui questo doppio può rispondere il
            // vero senza che gliela si semini, perché «cosa c'è» è esattamente
            // ciò che un host in memoria sa di sé. Serve a chi chiede *quali
            // documenti esistono* invece di *quali sono indicizzati* — una
            // distinzione che l'apertura a fasi (§15.7) ha reso osservabile, e
            // che senza questo ramo si proverebbe solo end-to-end.
            //
            // La specie la decide la regola del kernel
            // ([`media::kind_of_ext`]): documento se un formato lo serve,
            // allegato se ha un tipo di contenuto noto, altrimenti ignoto. La
            // cartella si sceglie con la stessa [`in_folder`].
            IndexQuery::Entries {
                of_kind,
                within,
                page,
            } => {
                let entries: Vec<VaultEntry> = self
                    .docs
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|(id, bytes)| {
                        let id = DocId::new(id);
                        let kind = media::kind_of_ext(&id, |_| self.format_of(&id).is_some());
                        VaultEntry {
                            id,
                            kind,
                            size: bytes.len() as u64,
                            mtime: self.now.load(Ordering::Relaxed),
                            fingerprint: None,
                        }
                    })
                    .filter(|entry| of_kind.is_none_or(|kind| entry.kind == kind))
                    .filter(|entry| {
                        within.as_ref().is_none_or(|scope| {
                            in_folder(&entry.id, &scope.path, scope.descendants)
                        })
                    })
                    .collect();
                Ok(IndexResult::Entries(Paged::window(entries, page)))
            }
            // I conteggi seminati sono del vault intero: a chi li chiede per
            // una selezione il doppio non sa rispondere, e lo dice.
            IndexQuery::Tags { matching, page } => {
                if !matching.is_everything() {
                    return Err(PluginError::Unserved(
                        "MemoryHost conta i tag seminati del vault intero, non di una \
                         selezione: usa un Workspace vero"
                            .into(),
                    ));
                }
                Ok(IndexResult::Tags(Paged::window(
                    self.tags.lock().unwrap().clone(),
                    page,
                )))
            }
            // **I documenti che ci sono**, scelti con le foglie che il doppio
            // sa verificare ([`Selection`]) e finiti con la stessa regola del
            // kernel ([`properties::finish`]): ordine, colonne e finestra. Il
            // frontmatter è quello dei modelli seminati; chi ordina o chiede
            // colonne su un documento senza modello riceve `unserved`. Niente
            // rilevanza e niente estratti: quelli li produce un indice.
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                excerpts: _,
            } => {
                let matches = Selection::of(self).expr(&matching)?;
                let models = self.models.lock().unwrap();
                if sort.is_some() || !select.is_none() {
                    if let Some(id) = matches.ids().find(|id| !models.contains_key(id.as_str())) {
                        return Err(unseeded(id));
                    }
                }
                Ok(IndexResult::Documents(properties::finish(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
                    &DateFormats::ISO,
                    |id| models.get(id.as_str()).map(|model| &model.frontmatter),
                )))
            }
            // **La risoluzione**, dai documenti che ha in memoria e con le
            // regole condivise di `fub_abi::rules::path`: le stesse chiavi e la
            // stessa precedenza del grafo del kernel — path, nome, alias dei
            // modelli seminati, poi il file per nome — e fra omonimi vince chi
            // combacia esattamente, poi il path più corto. Il punto dentro il
            // documento non lo cerca (non ha outline propri): `at` resta
            // `None`, che è il degrado del contratto per un punto che non si
            // trova.
            IndexQuery::Resolve { target, from } => Ok(IndexResult::Resolved(
                self.resolve(&target, from.as_ref())
                    .map(fub_abi::traits::ResolvedRef::doc),
            )),
            // I vicini, dagli archi seminati e come li cammina il kernel: i semi
            // sono una selezione ([`Selection`]), e per ognuno, in ordine di
            // id, la camminata in ampiezza fino a `depth`.
            IndexQuery::Neighbors {
                seeds,
                direction,
                depth,
                page,
            } => {
                let from = Selection::of(self).expr(&seeds)?;
                let items = from
                    .ids()
                    .flat_map(|seed| self.neighbors(seed, direction, depth))
                    .collect();
                Ok(IndexResult::Neighbors(Paged::window(items, page)))
            }
            // Le impostazioni le serve, e dal canale dati come il kernel: una
            // feature che le disegnasse chiedendole a una porta diversa nel test
            // non proverebbe la strada che percorre nell'app.
            // Il filtro per plugin **non lo sa servire**, e lo dice invece di
            // ignorarlo: questo doppio non registra chi possiede una chiave, e
            // rispondere «tutte» a chi ne ha chieste alcune farebbe passare per
            // il motivo sbagliato ogni prova che si fidasse del filtro.
            IndexQuery::Settings { plugin: Some(_) } => Err(PluginError::Unserved(
                "MemoryHost non sa di chi è una chiave: chiedi tutte le \
                 impostazioni, o usa un Workspace vero"
                    .into(),
            )),
            IndexQuery::Settings { plugin: None } => Ok(IndexResult::Settings(
                self.settings
                    .lock()
                    .unwrap()
                    .values()
                    .map(|(spec, value)| SettingEntry {
                        spec: spec.clone(),
                        value: value.clone().unwrap_or_else(|| spec.kind.default_value()),
                        source: match value {
                            Some(_) => SettingSource::Vault,
                            None => SettingSource::Default,
                        },
                    })
                    .collect(),
            )),
            // La salute del vault: un doppio senza grafo né indici non ha
            // nessun problema da segnalare, e l'elenco vuoto è la verità — non
            // un finto successo. La paginazione la applica come il kernel su
            // una risposta già in memoria (`Paged::window`).
            IndexQuery::VaultHealth { page, .. } => {
                Ok(IndexResult::VaultHealth(Paged::window(Vec::new(), page)))
            }
            // Il doppio non ha né indice né grafo né frontmatter: per tutto il
            // resto non c'è nessuno che serva la domanda, ed è quella la
            // risposta — non un `BadArgs`, che direbbe che la domanda è
            // malposta.
            _ => Err(PluginError::Unserved(
                "MemoryHost serve solo backlink, outline, tag, archi, impostazioni e \
                 salute del vault seminati a mano, più l'anagrafe, i documenti e la \
                 risoluzione dei riferimenti fra quelli che ha in memoria"
                    .into(),
            )),
        }
    }
}

impl HostCommands for MemoryHost {
    /// Il doppio non ha un registro dei comandi: comporre comandi si prova
    /// contro il kernel, che è l'unico ad averlo. Rispondere `unknown-command`
    /// è la stessa risposta che darebbe l'host vero per un id inesistente, e
    /// non è un finto successo.
    fn run_command(
        &mut self,
        command: &str,
        _args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        Err(PluginError::UnknownCommand(command.into()))
    }

    /// E non ha nemmeno la pila delle operazioni, per la stessa ragione: la
    /// tiene il kernel, che è l'unico che vede passare gli esiti. `None` — cioè
    /// «niente da annullare» — è la risposta vera per un host che non ha mai
    /// eseguito niente, e non un finto successo.
    fn undo_last(&mut self) -> Result<Option<fub_abi::command::Undone>, PluginError> {
        Ok(None)
    }
}

impl TransferRead for MemoryHost {
    fn read_source(
        &self,
        handle: fub_abi::transfer::SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        let sources = self.sources.lock().unwrap();
        let Some(bytes) = sources.get(&handle.0) else {
            return Err(PluginError::BadArgs(
                "questo handle di sorgente non è (o non è più) aperto".into(),
            ));
        };
        let from = (offset.min(bytes.len() as u64)) as usize;
        let a = from.saturating_add(len as usize).min(bytes.len());
        Ok(bytes[from..a].to_vec())
    }
}

impl HostNetwork for MemoryHost {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.requests.lock().unwrap().push(request);
        self.answers.lock().unwrap().pop_front().unwrap_or_else(|| {
            Err(PluginError::Unserved(
                "nessuna risposta preparata: questo banco non ha un filo verso \
                 fuori finché non glielo si dà (`con_risposta`)"
                    .into(),
            ))
        })
    }
}

impl HostServices for MemoryHost {
    /// Il doppio non ha un registro dei plugin: chi prova un servizio lo prova
    /// contro il kernel, che è l'unico ad averlo. `Unserved` è la stessa
    /// risposta che darebbe l'host vero per un `ns` che nessuno offre, e non è
    /// un finto successo.
    fn call_service(
        &mut self,
        service: &str,
        _method: &str,
        _args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        Err(PluginError::Unserved(
            format!("MemoryHost non ha un registro dei plugin: nessuno offre `{service}`").into(),
        ))
    }

    fn export_targets(&self) -> Result<Vec<fub_abi::transfer::ExportTarget>, PluginError> {
        Ok(self
            .exports
            .lock()
            .unwrap()
            .iter()
            .flat_map(|provider| provider.targets())
            .collect())
    }

    /// Lo stesso dispatch e lo stesso sink dell'host vero: la destinazione
    /// sceglie l'exporter, e i byte tornano nel rapporto col tetto di
    /// [`PLUGIN_EXPORT_LIMIT`]. Il doppio non ha capacità per plugin: il
    /// provider legge questo stesso banco.
    fn run_export(
        &mut self,
        request: &fub_abi::transfer::ExportRequest,
    ) -> Result<fub_abi::transfer::ExportReport, PluginError> {
        let provider = self
            .exports
            .lock()
            .unwrap()
            .iter()
            .find(|provider| provider.targets().iter().any(|t| t.id == request.target))
            .cloned()
            .ok_or_else(|| {
                PluginError::BadArgs(
                    format!("destinazione di export ignota: `{}`", request.target).into(),
                )
            })?;
        let mut sink = MemorySink::bounded(PLUGIN_EXPORT_LIMIT);
        provider.export(request, self, &mut sink)
    }

    /// Il primo importer che riconosce la sorgente, come nell'host vero. Un
    /// importer che, importando, chiede di nuovo sé stesso riceve `Conflict`
    /// invece di bloccarsi.
    fn run_import(
        &mut self,
        source: &fub_abi::transfer::ImportSource,
        request: &fub_abi::transfer::ImportRequest,
    ) -> Result<fub_abi::transfer::ImportReport, PluginError> {
        let candidates: Vec<SharedImport> = self.imports.lock().unwrap().clone();
        for candidate in candidates {
            let Ok(mut provider) = candidate.try_lock() else {
                return Err(PluginError::Conflict(
                    "an importer is already importing: an import cannot re-enter it".into(),
                ));
            };
            if provider.can_handle(source) {
                return provider.import(source, request, self);
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
}
