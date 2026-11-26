//! Regole di sintassi, renderer, modelli dei documenti e link.

use super::*;

/// Il piano per portare su un documento esistente i link verso un altro,
/// fotografato sotto la guardia e da eseguire fuori: [`Self::edits`] chiama i
/// provider di formato, che non girano sotto il lock del workspace.
pub struct PreparedLinkRetarget {
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) rewrites: Vec<PreparedExplicitLinkRewrite>,
}

impl PreparedLinkRetarget {
    /// Gli edit, uno per documento che cambia, ciascuno sulla revisione dei
    /// byte appena letti: chi li applica li vede fallire se nel frattempo il
    /// documento è cambiato.
    ///
    /// Un file a byte che non sa riscriversi ferma il piano, come una sorgente
    /// di testo senza riscrittura: qui non c'è una rinomina già fatta a cui
    /// appendere l'avviso, e chi unisce le note cestinerebbe un file a cui quel
    /// link punta ancora.
    pub fn edits(self) -> Result<Vec<(DocId, EditRequest)>> {
        let PreparedLinkRewriteOutcome {
            edits,
            unwritable_bytes,
        } = invoke_prepared_link_rewrites(self.storage.as_ref(), self.rewrites)?;
        if let Some(destination) = unwritable_bytes.first() {
            return Err(no_link_rewrite(destination));
        }
        Ok(edits
            .into_iter()
            .map(|edit| (edit.source().clone(), edit.request().clone()))
            .collect())
    }
}

/// Lettura del modello risolta fino al confine del parser. La sorgente, il
/// provider e le regole sono posseduti: `invoke` non prende in prestito il
/// workspace e può quindi attraversare il codice esterno senza la sua guardia.
pub struct PreparedDocumentModel {
    pub(super) id: DocId,
    pub(super) source_revision: Revision,
    pub(super) source: DocumentSource,
    pub(super) parser: PreparedParse,
    pub(super) syntax_generation: u64,
}

/// Modello prodotto fuori dal workspace, ancora da confrontare con la
/// sorgente e la pipeline correnti.
pub struct CompletedDocumentModel {
    pub(super) id: DocId,
    pub(super) source_revision: Revision,
    pub(super) model: DocumentModel,
    pub(super) syntax_generation: u64,
}

impl PreparedDocumentModel {
    /// Esegue `FormatProvider::parse` e le `SyntaxRule` sulla fotografia
    /// preparata. Il chiamante deve avere già rilasciato qualunque guardia di
    /// `Custody<Workspace>`.
    pub fn invoke(self) -> std::result::Result<CompletedDocumentModel, PluginError> {
        let PreparedDocumentModel {
            id,
            source_revision,
            source,
            parser,
            syntax_generation,
        } = self;
        let model = parser.invoke(source).map_err(PluginError::from)?;
        Ok(CompletedDocumentModel {
            id,
            source_revision,
            model,
            syntax_generation,
        })
    }
}

/// Una scrittura mirata chiesta al provider di un documento, risolta fino al
/// confine del provider: `invoke` non prende in prestito il workspace.
///
/// Sono le domande che una feature fa al formato invece di scrivere la sua
/// sintassi ([`VaultRead::format_link`](fub_abi::traits::VaultRead::format_link)
/// e [`VaultRead::task_state_edit`](fub_abi::traits::VaultRead::task_state_edit)).
pub struct PreparedFormatEdit {
    pub(super) parser: PreparedParse,
    /// La sorgente su cui il provider lavora, per le operazioni che la
    /// leggono. Il link non la legge: il documento può non esistere ancora.
    pub(super) source: Option<DocumentSource>,
}

impl PreparedFormatEdit {
    /// Il testo con cui il formato scrive `link`. Il chiamante deve avere già
    /// rilasciato la guardia del workspace.
    pub fn format_link(
        &self,
        link: &fub_abi::format::LinkInsert,
    ) -> std::result::Result<Option<String>, PluginError> {
        self.parser.format_link(link).map_err(PluginError::from)
    }

    /// La modifica che porta il task di `marker` a `done`, con la revisione
    /// della sorgente su cui è stata calcolata.
    pub fn task_state_edit(
        &self,
        marker: &fub_abi::model::TaskMarker,
        done: bool,
    ) -> std::result::Result<Option<EditRequest>, PluginError> {
        let source = self
            .source
            .as_ref()
            .ok_or_else(|| PluginError::Internal("la sorgente non è stata preparata".into()))?;
        let edits = self
            .parser
            .task_state_edits(source, marker, done)
            .map_err(PluginError::from)?;
        Ok(edits.map(|edits| EditRequest::new(Revision::of_bytes(source.bytes()), edits)))
    }
}

impl Workspace {
    /// Innesta una sintassi su un provider (§3.1), o dice **perché no**.
    ///
    /// Il `Result` non è cerimonia: due regole che rivendicano la stessa
    /// sintassi sono un conflitto, e il modo in cui questo registro sbagliava
    /// prima era proprio non avere dove dirlo.
    pub fn register_syntax_rule(
        &mut self,
        plugin: impl Into<String>,
        rule: Box<dyn SyntaxRule>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::syntax(rule).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Registra chi disegna un `custom_kind` (§3.2).
    ///
    /// Il [`Trust`] è quello del **plugin** e non un parametro di questa
    /// chiamata: un `CustomRendering::Ui` è un albero di UI, e da chi non è il
    /// core il contenuto attivo si rifiuta a qualunque profondità — ma *quanto*
    /// ci si fida di qualcuno è una proprietà sua, non di ogni cosa che
    /// registra (§7.3).
    pub fn register_custom_renderer(
        &mut self,
        plugin: impl Into<String>,
        renderer: Box<dyn CustomRenderer>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::renderer(renderer).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// I `custom_kind` che qualcuno **produce** e nessuno **disegna**.
    ///
    /// È il conto che il §3.2 chiedeva di poter fare: ogni nome qui dentro è un
    /// blocco che l'utente leggerà crudo — il degrado generico funziona, ma
    /// nessuno ha detto chi lo disegnerebbe. Chi monta l'app può guardarlo; oggi
    /// non c'è ancora una superficie dove mostrarlo (§20.4).
    pub fn undrawn_kinds(&self) -> Vec<String> {
        self.docs.undrawn_kinds()
    }

    /// Prepara gli edit che portano su `to`, che esiste già, i link che oggi
    /// raggiungono `from`: la riscrittura dei backlink di una rinomina, senza
    /// la rinomina. È ciò che serve a un'unione di note per cestinare la
    /// sorgente senza lasciare link rotti.
    pub fn prepare_link_retarget(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> std::result::Result<PreparedLinkRetarget, PluginError> {
        let from = fenced_doc_id(from)?;
        let to = fenced_doc_id(to)?;
        for id in [&from, &to] {
            if !self.indexes.core.metas.contains_key(id) {
                return Err(PluginError::NotFound(id.to_string().into()));
            }
        }
        let rewrites = if from == to {
            Vec::new()
        } else {
            self.prepare_explicit_link_rewrites(&from, &to, true)
        };
        Ok(PreparedLinkRetarget {
            storage: Arc::clone(self.docs.vault.storage()),
            rewrites,
        })
    }

    /// [`Self::prepare_link_retarget`] ed esecuzione nello stesso passo, per
    /// chi tiene già il workspace in mano (l'host del kernel, i test).
    pub fn link_retarget_edits(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> std::result::Result<Vec<(DocId, EditRequest)>, PluginError> {
        self.prepare_link_retarget(from, to)?
            .edits()
            .map_err(PluginError::from)
    }

    /// Congela sorgente, parser e regole per una lettura del modello che verrà
    /// eseguita dal composition root senza la guardia del workspace.
    pub fn prepare_detached_document_model(
        &self,
        id: &DocId,
    ) -> std::result::Result<PreparedDocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        let indexed = self.indexes.core.metas.contains_key(&id);
        let parseable_file =
            self.docs.vault.stat(&id).is_some() && self.docs.provider_for(&id).is_ok();
        if !indexed && !parseable_file {
            return Err(PluginError::NotFound(id.to_string().into()));
        }
        let source = self.docs.source_from_disk(&id).map_err(PluginError::from)?;
        let source_revision = Revision::of_bytes(source.bytes());
        let parser = self.docs.prepare_parse(&id).map_err(PluginError::from)?;
        Ok(PreparedDocumentModel {
            id,
            source_revision,
            source,
            parser,
            syntax_generation: self.syntax_generation,
        })
    }

    /// Il provider di `id` pronto per una scrittura mirata fuori dalla
    /// guardia. `None` = nessun provider rivendica il documento.
    ///
    /// Con `with_source` la sorgente si legge adesso dal disco, sotto la stessa
    /// fotografia: è il sorgente su cui il provider calcolerà gli edit.
    pub fn prepare_format_edit(
        &self,
        id: &DocId,
        with_source: bool,
    ) -> std::result::Result<Option<PreparedFormatEdit>, PluginError> {
        let id = fenced_doc_id(id)?;
        if self.docs.format_of(&id).is_none() {
            return Ok(None);
        }
        let parser = self.docs.prepare_parse(&id).map_err(PluginError::from)?;
        let source = if with_source {
            Some(self.docs.source_from_disk(&id).map_err(PluginError::from)?)
        } else {
            None
        };
        Ok(Some(PreparedFormatEdit { parser, source }))
    }

    /// [`VaultRead::format_link`](fub_abi::traits::VaultRead::format_link) per
    /// chi possiede già un `&Workspace`. Chi lo monta in una `Custody` usa
    /// [`prepare_format_edit`](Workspace::prepare_format_edit) e chiama il
    /// provider dopo aver rilasciato la guardia.
    pub fn format_link(
        &self,
        id: &DocId,
        link: &fub_abi::format::LinkInsert,
    ) -> std::result::Result<Option<String>, PluginError> {
        match self.prepare_format_edit(id, false)? {
            Some(prepared) => prepared.format_link(link),
            None => Ok(None),
        }
    }

    /// [`VaultRead::task_state_edit`](fub_abi::traits::VaultRead::task_state_edit),
    /// come [`format_link`](Workspace::format_link).
    pub fn task_state_edit(
        &self,
        id: &DocId,
        marker: &fub_abi::model::TaskMarker,
        done: bool,
    ) -> std::result::Result<Option<EditRequest>, PluginError> {
        match self.prepare_format_edit(id, true)? {
            Some(prepared) => prepared.task_state_edit(marker, done),
            None => Ok(None),
        }
    }

    /// Pubblica il modello soltanto se sorgente e regole sono ancora quelle
    /// fotografate da `prepare_detached_document_model`. Mutazioni di altri
    /// documenti e cambi ai soli renderer sono compatibili.
    pub fn finish_detached_document_model(
        &self,
        completed: CompletedDocumentModel,
    ) -> std::result::Result<DocumentModel, PluginError> {
        if completed.syntax_generation != self.syntax_generation {
            return Err(PluginError::Conflict(
                "la pipeline sintattica è cambiata durante la lettura del modello".into(),
            ));
        }
        let current = match self.docs.source_from_disk(&completed.id) {
            Ok(current) => current,
            Err(error) if error.is_missing() => {
                return Err(PluginError::Conflict(
                    format!(
                        "{} è stato rimosso durante la lettura del modello",
                        completed.id
                    )
                    .into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        if Revision::of_bytes(current.bytes()) != completed.source_revision {
            return Err(PluginError::Conflict(
                format!("{} è cambiato durante la lettura del modello", completed.id).into(),
            ));
        }
        Ok(completed.model)
    }

    /// Il modello parsato di un documento (§4.2): la metà kernel di
    /// [`VaultRead::read_model`](fub_abi::traits::VaultRead::read_model).
    ///
    /// **Rilegge e riparsa dal disco**, con le regole di sintassi registrate già
    /// applicate — è la stessa catena di `render_preview`, senza il rendering.
    /// La cache tiene i soli metadati (vedi `DocMeta`, interno), quindi il corpo non c'è
    /// e non si può servire da lì: chi vuole i metadati passa da
    /// [`query_index`](Workspace::query_index), che risponde senza toccare il
    /// disco.
    ///
    /// Un documento che il workspace non conosce è `NotFound`. Un file documento
    /// presente sul disco ma assente dai metadati può invece essere stato
    /// scartato perché il parse è fallito: in quel caso lo ripariamo comunque,
    /// così il chiamante riceve il `FormatError` reale (e non un falso
    /// `NotFound`). Asset, directory e file senza provider restano assenti.
    ///
    /// Questa è la comodità del kernel quando possiede già un `&Workspace`:
    /// chi lo monta in una `Custody` usa `prepare_detached_document_model` e
    /// `finish_detached_document_model`, perché soltanto il composition root
    /// può rilasciare la propria guardia prima del parse.
    pub fn read_model(&self, id: &DocId) -> Result<DocumentModel> {
        let indexed = self.indexes.core.metas.contains_key(id);
        let parseable_file =
            self.docs.vault.stat(id).is_some() && self.docs.provider_for(id).is_ok();
        if !indexed && !parseable_file {
            return Err(KernelError::NotFound(id.to_string()));
        }
        self.docs.parse_from_disk(id)
    }

    /// Di che formato è un documento, e che sintassi capirebbe (§4.3): la metà
    /// kernel di [`VaultRead::format_of`](fub_abi::traits::VaultRead::format_of).
    ///
    /// Non tocca il disco e non chiede che il documento esista: è una domanda
    /// sull'**estensione**, e il registro dei formati è l'unico che sa
    /// rispondere. `None` = nessun provider la rivendica.
    ///
    /// Le capacità sono quelle **effettive**: quelle del provider, sovrapposte
    /// da quelle che le [`SyntaxRule`] registrate
    /// gli innestano (§3.1). L'ordine della sovrapposizione dice chi vince su
    /// una chiave condivisa, ed è il provider: se sa fare `fub:math` per conto
    /// suo, il suo dettaglio è più informativo del semplice «acceso» che una
    /// regola può dichiarare.
    pub fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.docs.format_of(id)
    }

    /// Le sintassi di questo documento **con la loro forma**, per chi deve
    /// disegnare invece di parsare (§4.4).
    ///
    /// Vedi [`crate::documents::DocumentStore::syntax_forms`]: è `format_of`
    /// per una superficie di scrittura, che il modello non ce l'ha e non può
    /// averlo — il buffer che ha in mano è sporco, e un modello spedito di là
    /// sarebbe vero solo quando serve meno
    /// ([0018](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
    pub fn syntax_forms(&self, id: &DocId) -> Vec<SyntaxForm> {
        self.docs.syntax_forms(id)
    }

    /// Rende l'anteprima di un documento: l'HTML del provider, e le parti
    /// **dichiarative** che i renderer registrati hanno prodotto.
    ///
    /// Il corpo non sta in cache (split metadata/body): si rilegge e riparsa
    /// dal disco, nella forma che il provider ha dichiarato (§3.4). Il render è
    /// per-documento e on demand — è esattamente il tipo di lettura che il disco
    /// serve bene, mentre la cache calda serve le mutazioni.
    pub fn render_preview(&self, id: &DocId) -> Result<RenderedDocument> {
        self.render_document(id, RenderOptions::preview())
    }

    pub(super) fn render_document(
        &self,
        id: &DocId,
        options: RenderOptions,
    ) -> Result<RenderedDocument> {
        if !self.indexes.core.metas.contains_key(id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let source = self.docs.source_from_disk(id)?;
        let parser = self.docs.prepare_parse(id)?;
        let model = parser.invoke(source)?;
        parser.render(&model, &self.docs.renderers, &options)
    }

    /// Rende il contenuto di un embed `![[page#heading]]` o `![[page#^blocco]]`:
    /// risolve la pagina e rende l'intero documento, o la sola sezione del
    /// heading richiesto, o il solo blocco che porta quell'ancora.
    ///
    /// È il pezzo kernel della **transclusion**: `render_html` dei provider
    /// resta una funzione pura per-documento (emette solo un placeholder per
    /// gli embed); la composizione è del frontend, che chiama questo metodo e
    /// innesta l'HTML nel placeholder. Ricorsione, profondità massima e cicli
    /// sono gestiti dal chiamante, che conosce la catena di embed corrente
    /// (vedi `../../../docs/architecture/frontend-and-ipc.md`).
    ///
    /// # Chi vince fra i due, e perché non è una scelta di comodo
    ///
    /// Un `LinkTarget::Wiki` può portarli tutti e due, e allora **vince il
    /// blocco**: un'ancora di blocco è unica nel documento — è la chiave con cui
    /// [`canonical_anchor`] la risolve — mentre un heading nomina un intervallo
    /// che la contiene. Chiedere «la sezione X, e dentro il blocco b» e
    /// chiedere «il blocco b» sono la stessa domanda, e la seconda si risponde
    /// senza guardare la prima.
    pub fn render_embed(
        &self,
        page: &str,
        heading: Option<&str>,
        block: Option<&str>,
    ) -> Result<(DocId, RenderedDocument)> {
        let id = self
            .resolve_link(page)
            .ok_or_else(|| KernelError::NotFound(page.to_string()))?;
        if !self.indexes.core.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        // Come `render_preview`: il corpo si riparsa dal disco on demand.
        let source = self.docs.source_from_disk(&id)?;
        let parser = self.docs.prepare_parse(&id)?;
        let model = parser.invoke(source)?;
        let opts = RenderOptions::preview();
        let model =
            match (block, heading) {
                (Some(b), _) => block_of(&model, b)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#^{b}")))?,
                (None, Some(h)) => section_of(&model, h)
                    .ok_or_else(|| KernelError::NotFound(format!("{id}#{h}")))?,
                (None, None) => model,
            };
        // Anche un embed passa dai renderer: un diagramma dentro una nota
        // trascluso resta un diagramma. Gli slot delle parti sono numerati
        // dentro QUESTA composizione, e il frontend li monta dentro il
        // segnaposto dell'embed che ha appena idratato.
        Ok((id, parser.render(&model, &self.docs.renderers, &opts)?))
    }

    /// Backlink verso un documento.
    pub fn backlinks(&self, id: &DocId) -> Vec<BacklinkRef> {
        self.indexes.core.graph.backlinks(id)
    }

    /// Link uscenti risolti da un documento.
    pub fn outgoing(&self, id: &DocId) -> Vec<DocId> {
        self.indexes.core.graph.outgoing(id)
    }

    /// Risolve il nome di un wikilink a un documento esistente.
    ///
    /// È il comodo del kernel per sé e per i propri banchi di prova. Chi sta
    /// **fuori** — la shell, un provider — passa da
    /// [`IndexQuery::Resolve`](fub_abi::traits::IndexQuery::Resolve), che è la
    /// stessa risposta per tutti e le tre specie di bersaglio invece di una
    /// sola: finché questa era raggiungibile solo per un comando IPC scritto
    /// apposta, era un fatto sul vault che la shell conosceva e un plugin no.
    pub fn resolve_link(&self, page: &str) -> Option<DocId> {
        self.indexes.core.graph.resolve_wiki(page)
    }
}
