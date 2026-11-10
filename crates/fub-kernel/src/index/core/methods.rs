//! I metodi di `CoreIndex`: documenti, voci e cartelle, allegati, cambi di un
//! documento e risoluzione dei link.

use super::*;

impl CoreIndex {
    /// I formati di data che **questo vault dichiara** (§8.2), letti adesso.
    ///
    /// A ogni domanda e non una volta al montaggio, per la ragione per cui le
    /// impostazioni sono condivise e non copiate: chi cambia la dichiarazione
    /// cambia il valore di ogni proprietà data del vault, e un indice che
    /// rispondesse con com'era al montaggio direbbe che il filtro non trova
    /// **anche dopo** che l'utente ha riparato la causa.
    pub(crate) fn date_formats(&self) -> DateFormats {
        let declared = self
            .settings
            .read()
            .ok()
            .and_then(|s| s.effective(crate::properties::DATE_FORMAT).ok())
            .and_then(|(v, _)| match v {
                SettingValue::Text(s) => Some(s),
                _ => None,
            });
        crate::properties::date_formats(declared.as_deref())
    }

    /// La dichiarazione corrente, letta dallo stesso store condiviso delle
    /// date: nessun valore derivato resta in cache dopo una modifica dei tipi.
    pub(crate) fn property_types(&self) -> PropertyTypes {
        let declared = self
            .settings
            .read()
            .ok()
            .and_then(|s| s.effective(crate::properties::TYPES).ok())
            .and_then(|(v, _)| match v {
                SettingValue::Text(s) => Some(s),
                _ => None,
            });
        crate::properties::property_types(declared.as_deref())
    }

    /// La **coda** di una risposta `Documents`, con dentro le due cose che il
    /// kernel sa e [`properties::finish`] no: i formati che il vault dichiara e
    /// dove si legge il frontmatter.
    ///
    /// Esiste perché i chiamanti sono **due** — questo indice quando la domanda
    /// gli arriva intera, e il pianificatore quando la ricompone — e ognuno dei
    /// due passava i formati per conto suo. Due siti che devono passare lo
    /// stesso valore sono un sito che prima o poi passa l'altro: chi ricompone
    /// avrebbe ordinato le date come testo mentre chi risponde intero le
    /// ordinava per istante, sulla **stessa** domanda, e nessuno avrebbe
    /// confrontato le due risposte perché non si vedono fra loro. Con la coda
    /// qui, il terzo chiamante eredita la dichiarazione senza saperla.
    ///
    /// I punti da cui il kernel monta quella coda a mano sono
    /// **uno** [conta: code-delle-documents-nel-kernel], ed è un conto e non un
    /// test perché nessun test può vedere una rotta che ancora non esiste, e il
    /// compilatore non sa distinguere un `&DateFormats` giusto da uno sbagliato.
    pub(crate) fn finish_documents(
        &self,
        matches: Matches,
        sort: Option<&PropertySort>,
        select: &PropertySelect,
        page: Option<Page>,
    ) -> Paged<DocumentMatch> {
        properties::finish_with_types(
            matches,
            sort,
            select,
            page,
            &self.date_formats(),
            &self.property_types(),
            |id| self.frontmatter(id),
        )
    }

    pub(crate) fn new(
        registry: Arc<FormatRegistry>,
        settings: SharedSettings,
        organization: Arc<OrganizationStore>,
        drafts: Arc<Drafts>,
    ) -> Self {
        CoreIndex {
            metas: BTreeMap::new(),
            entries: BTreeMap::new(),
            names: EntryNames::default(),
            observed_in_the_own_instant: BTreeSet::new(),
            folders: BTreeSet::new(),
            tags: TagCounts::default(),
            graph: LinkGraph::with_prose(registry.prose_formats()),
            graph_update: GraphUpdate::default(),
            graph_epoch: 0,
            registry,
            watch: WatchState::default(),
            jobs: JobsState::default(),
            settings,
            organization,
            drafts,
        }
    }

    /// Registra un fallimento di sincronizzazione (§9.7).
    pub(crate) fn notes_sync_failure(&mut self, error: impl std::fmt::Display) {
        self.watch.notes(error);
    }

    pub(crate) fn contains(&self, id: &DocId) -> bool {
        self.metas.contains_key(id)
    }

    /// Gli id indicizzati, in ordine. L'ordine non è una cortesia: è ciò che
    /// rende stabile una risposta paginata.
    pub(crate) fn ids(&self) -> impl Iterator<Item = &DocId> {
        self.metas.keys()
    }

    pub(crate) fn documents(&self) -> Vec<DocId> {
        self.metas.keys().cloned().collect()
    }

    pub(crate) fn clear(&mut self) {
        self.metas.clear();
        self.entries.clear();
        self.names.clear();
        self.folders.clear();
        self.tags.clear();
        self.graph_epoch = 0;
    }

    /// Rimette in cache i metadati di un documento **senza riaprirlo** (§14.2):
    /// è la strada che l'anagrafe apre, e l'unica differenza con
    /// [`on_documents_indexed`](IndexProvider::on_documents_indexed) è che qui il
    /// modello non c'è — non è stato parsato, perché il file non è stato letto.
    ///
    /// Il grafo non si tocca: chi chiama è `reindex` / `finish_index`, che lo
    /// ricostruisce in blocco alla fine (un `upsert` per documento, a caldo,
    /// vedrebbe un insieme ancora incompleto). L'epoca avanza lo stesso: i
    /// metadati da cui il grafo si ricostruisce sono cambiati.
    pub(crate) fn restore(&mut self, id: &DocId, metadata: StoredMeta) {
        self.graph_epoch = self.graph_epoch.wrapping_add(1);
        self.tags
            .upsert_names(id, metadata.tags.iter().map(String::as_str));
        self.metas.insert(
            id.clone(),
            DocMeta {
                id: id.clone(),
                frontmatter: metadata.frontmatter,
                outline: metadata.outline,
                links: metadata.links,
                anchors: metadata.anchors,
            },
        );
    }

    /// Ciò che di un documento va scritto nell'anagrafe perché la prossima
    /// apertura non debba riaprirlo.
    pub(crate) fn stored_metadata(&self, id: &DocId) -> Option<StoredMeta> {
        let metadata = self.metas.get(id)?;
        Some(StoredMeta {
            frontmatter: metadata.frontmatter.clone(),
            outline: metadata.outline.clone(),
            links: metadata.links.clone(),
            anchors: metadata.anchors.clone(),
            tags: self.tags.names_of(id),
        })
    }

    /// Il **file** che un riferimento nomina, se il vault ce l'ha — di
    /// qualunque specie (§14.1).
    pub(crate) fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in_folder(
            &self.entries,
            &self.names,
            source,
            target,
            self.attachment_folder().as_deref(),
        )
    }

    /// La cartella degli allegati che il vault dichiara, se ne dichiara una.
    pub(super) fn attachment_folder(&self) -> Option<String> {
        self.settings
            .read()
            .ok()
            .and_then(|settings| settings.effective(crate::settings::ATTACHMENT_FOLDER).ok())
            .and_then(|(value, _)| value.as_text().map(str::to_owned))
    }

    /// Gli allegati che `doc` nomina, col contesto di ogni riferimento: i link
    /// che il grafo non porta a un documento e l'anagrafe porta a un file che
    /// non ha un modello (§14.1), cioè `![[foto.png]]` e `[pdf](doc.pdf)`.
    ///
    /// Il grafo tiene solo documenti, e la risoluzione sull'anagrafe dipende
    /// dalla cartella degli allegati, che è un'impostazione: per questo si
    /// chiede qui, al momento della domanda, e costa i link di `doc`.
    fn attachments_of(&self, doc: &DocId, folder: Option<&str>) -> Vec<(DocId, Option<String>)> {
        let Some(metadata) = self.metas.get(doc) else {
            return Vec::new();
        };
        metadata
            .links
            .iter()
            .filter_map(|link| {
                let by_graph = match &link.target {
                    target if target.names_host() => return None,
                    LinkTarget::Wiki { page, .. } => self.graph.resolve_wiki(page),
                    LinkTarget::Path(raw) => self.graph.resolve_path(doc, raw),
                    LinkTarget::Url(_) => return None,
                };
                if by_graph.is_some() {
                    return None;
                }
                let entry =
                    resolve_entry_in_folder(&self.entries, &self.names, doc, &link.target, folder)?;
                (!self.metas.contains_key(&entry)).then(|| (entry, link.context.clone()))
            })
            .collect()
    }

    /// I vicini di `seed` con gli allegati: ogni documento a meno di `depth`
    /// passi porta i suoi un passo più in là. Un allegato non ha link, quindi è
    /// una foglia e il cammino non prosegue da lui. L'ordine resta quello del
    /// grafo: distanza, poi id.
    pub(super) fn with_attachments(
        &self,
        seed: &DocId,
        mut near: Vec<NeighborRef>,
        depth: u8,
        folder: Option<&str>,
    ) -> Vec<NeighborRef> {
        let mut seen: BTreeSet<DocId> = near.iter().map(|n| n.doc.clone()).collect();
        seen.insert(seed.clone());
        let sources: Vec<(DocId, u8)> = std::iter::once((seed.clone(), 0))
            .chain(
                near.iter()
                    .filter(|n| n.depth < depth)
                    .map(|n| (n.doc.clone(), n.depth)),
            )
            .collect();
        let mut added = false;
        for (source, at) in sources {
            for (attachment, _) in self.attachments_of(&source, folder) {
                if seen.insert(attachment.clone()) {
                    near.push(NeighborRef {
                        doc: attachment,
                        via: source.clone(),
                        depth: at + 1,
                    });
                    added = true;
                }
            }
        }
        if added {
            near.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.doc.cmp(&b.doc)));
        }
        near
    }

    /// Chi nomina un allegato, un riferimento per voce come per i documenti.
    /// Nessun indice lo tiene (vedi [`attachments_of`](Self::attachments_of)):
    /// la risposta passa i link del vault, una volta, in ordine di sorgente.
    pub(super) fn attachment_backlinks(&self, target: &DocId) -> Vec<BacklinkRef> {
        let folder = self.attachment_folder();
        let mut refs = Vec::new();
        for source in self.metas.keys() {
            for (attachment, context) in self.attachments_of(source, folder.as_deref()) {
                if attachment == *target {
                    refs.push(BacklinkRef {
                        source: source.clone(),
                        context,
                    });
                }
            }
        }
        refs
    }

    /// Mette (o aggiorna) una voce dell'anagrafe.
    /// **Cosa cambia** se questo modello sostituisce quello che c'è (§22.2,
    /// decisione 0069).
    ///
    /// Si chiama **prima** di [`on_documents_indexed`](IndexProvider::on_documents_indexed)
    /// e prima che l'anagrafe sia toccata, ed è l'unico momento in cui il
    /// vecchio e il nuovo esistono insieme: il modello è appena arrivato, i
    /// metadati di prima sono ancora in `metas` e i tag di prima ancora in
    /// `tags`. Costa zero letture dal disco — è l'esito che la §22.2 dice
    /// «si ha in mano e si butta».
    ///
    /// Un documento che **nasce** non ha un prima, e per lui tutto è nuovo:
    /// [`DocChanges::everything`], che è la risposta vera e non una comodità —
    /// chi si è abbonato ai cambi di tag vuole sapere della nota che nasce
    /// con un tag.
    pub(crate) fn changes_for(&self, model: &DocumentModel, new: &Revision) -> DocChanges {
        let Some(before) = self.metas.get(&model.id) else {
            return DocChanges::everything();
        };
        let mut changes = DocChanges::default();
        // Il corpo non sta in cache (è lo split metadata/body): a rispondere è
        // l'impronta che l'anagrafe teneva del giro prima. Se non ce l'ha —
        // una voce entrata senza fingerprint — la risposta onesta è «sì»:
        // dire di no vorrebbe dire far perdere un risveglio a chi ha ragione.
        let body_changed = match self
            .entries
            .get(&model.id)
            .and_then(|and| and.fingerprint.as_ref())
        {
            Some(old) => old != new,
            None => true,
        };
        if body_changed {
            changes.aspects.push(DocChange::Body);
        }
        let keys = changed_properties(&before.frontmatter, &model.frontmatter);
        if !keys.is_empty() {
            changes.aspects.push(DocChange::Frontmatter);
            changes.properties = keys;
        }
        let (added, removed) = tag_diff(&self.tags.names_of(&model.id), &document_tag_names(model));
        if !added.is_empty() || !removed.is_empty() {
            changes.aspects.push(DocChange::Tags);
            changes.tags_added = added;
            changes.tags_removed = removed;
        }
        if before.links != model.links {
            changes.aspects.push(DocChange::Links);
        }
        if before.outline != model.outline {
            changes.aspects.push(DocChange::Outline);
        }
        if before.anchors != model.anchors {
            changes.aspects.push(DocChange::Anchors);
        }
        changes
    }

    pub(crate) fn set_entry(&mut self, entry: VaultEntry) {
        self.set_entry_observed(entry, crate::time::now_unix_millis());
    }

    /// Come [`set_entry`](Self::set_entry), per chi ha guardato il disco
    /// **prima** di adesso: `observed_at` è l'orologio letto prima di guardare.
    pub(crate) fn set_entry_observed(&mut self, entry: VaultEntry, observed_at: u64) {
        // **La regola *racily clean*, posta dove si osserva** (difetto 0187).
        //
        // Una data che non è strettamente nel passato rispetto al momento in
        // cui la si è letta è una data che può ancora cambiare senza cambiare:
        // il file può essere riscritto in quello stesso millisecondo, dopo che
        // l'abbiamo guardato, e `mtime + size` direbbe lo stesso di prima.
        // Quella voce si tiene in memoria — dove è vera, perché il contenuto lo
        // si è appena letto — e **non si scrive** in anagrafe, così la prossima
        // apertura la rilegge invece di crederle.
        //
        // Sta qui e non nei chiamanti perché qui ci passano tutti: la
        // scansione, il rilevatore, la scrittura che sa cosa ha scritto. E la
        // soglia è l'osservazione, non questa riga né la scrittura della
        // tabella: la scansione guarda il disco in `prepare_scan_vault` e
        // arriva qui solo in `finalize_scan_vault`, dopo gli indici; un
        // orologio letto qui avrebbe dichiarato pulito ciò che là poteva
        // ancora cambiare. Leggerlo prima di guardare sbaglia solo per
        // eccesso: rilegge qualche voce in più, mai una in meno.
        if entry.mtime < observed_at {
            self.observed_in_the_own_instant.remove(&entry.id);
        } else {
            self.observed_in_the_own_instant.insert(entry.id.clone());
        }
        self.install_entry(entry);
    }

    /// Installa il risultato della scansione dopo che il piano ha letto il
    /// contenuto, senza rivalutare l'orologio.
    ///
    /// È la seconda applicazione della stessa osservazione di
    /// [`set_entry`](Self::set_entry): il marker racily-clean appartiene alla
    /// scansione iniziale e deve sopravvivere anche se il parsing ha richiesto
    /// più tempo della soglia. Questo metodo non va usato per eventi o nuove
    /// osservazioni dal disco.
    pub(crate) fn set_entry_from_scan(&mut self, entry: VaultEntry) {
        self.install_entry(entry);
    }

    fn install_entry(&mut self, entry: VaultEntry) {
        self.names.insert_entry(&entry.id, entry.kind);
        self.entries.insert(entry.id.clone(), entry);
    }

    /// Se di questa voce **non ci si può fidare fino alla prossima apertura**:
    /// la sua data non era nel passato quando la si è letta, quindi una
    /// scrittura arrivata subito dopo sarebbe indistinguibile da nessuna
    /// scrittura (difetto 0187). Chi scrive l'anagrafe la salta.
    pub(crate) fn observed_at_the_same_instant(&self, id: &DocId) -> bool {
        self.observed_in_the_own_instant.contains(id)
    }

    /// Mette una cartella fra quelle che ci sono (§14.3).
    pub(crate) fn set_folder(&mut self, path: impl Into<String>) {
        let path = path.into();
        if !path.is_empty() {
            self.folders.insert(path);
        }
    }

    /// Toglie una cartella, e le sue discendenti, da quelle che ci sono.
    ///
    /// Solo per chi l'ha appena tolta dal disco: le voci dentro di lei se ne
    /// sono già andate per la loro strada, e una cartella sparita che l'albero
    /// continuasse a mostrare sarebbe una cartella che nessuno può aprire.
    pub(crate) fn forget_folder(&mut self, path: &str) {
        let inside = format!("{path}/");
        self.folders
            .retain(|folder| folder != path && !folder.starts_with(&inside));
    }

    /// Registra le cartelle che un path **attraversa**, dalla radice in giù.
    ///
    /// Serve a chi tocca un file solo (il rilevatore, una scrittura): un file
    /// che nasce in `a/b/c.md` dice che `a` e `a/b` esistono, e senza questa
    /// riga l'albero non le vedrebbe fino alla riapertura del vault. Il
    /// contrario non vale — cancellare l'ultimo file di una cartella **non**
    /// toglie la cartella, perché sul disco c'è ancora.
    pub(crate) fn ensure_folders_of(&mut self, id: &DocId) {
        for folder in fub_abi::query::folders_of(id) {
            self.set_folder(folder);
        }
    }

    /// Le cartelle chieste, col conto di cosa contengono.
    ///
    /// I conti si fanno qui e non si tengono scritti: le due mappe sono
    /// ordinate, quindi contare i figli diretti di una cartella costa il suo
    /// sottoalbero e non il vault, e un conto ricavato non può divergere da ciò
    /// da cui è ricavato.
    pub(super) fn folders_under(&self, under: Option<&FolderScope>) -> Vec<VaultFolder> {
        self.folders
            .iter()
            .filter(|path| match under {
                Some(scope) => within_folder(parent_folder(path), &scope.path, scope.descendants),
                None => true,
            })
            .map(|path| {
                let from = subtree_start(path);
                VaultFolder {
                    folders: count_direct(
                        self.folders.range(from.clone()..).map(String::as_str),
                        path,
                    ),
                    entries: count_direct(
                        self.entries
                            .range(DocId::new(from)..)
                            .map(|(id, _)| id.as_str()),
                        path,
                    ),
                    path: path.clone(),
                }
            })
            .collect()
    }

    /// Toglie una voce dall'anagrafe, e dice **cosa era**: è l'unico momento in
    /// cui la sua specie si può ancora sapere, ed è ciò che un evento di
    /// sparizione deve portare con sé.
    pub(crate) fn remove_entry(&mut self, id: &DocId) -> Option<EntryKind> {
        self.names.remove_entry(id);
        self.observed_in_the_own_instant.remove(id);
        self.entries.remove(id).map(|and| and.kind)
    }

    pub(crate) fn rebuild_graph(&mut self) {
        let _phase = tracing::info_span!(target: "fub.apertura", "rebuild_graph").entered();
        self.graph = LinkGraph::build_with(self.metas.values(), self.graph.prose().clone());
    }

    /// Il frontmatter di un documento, per chi compone una riga di risposta.
    pub(crate) fn frontmatter(&self, id: &DocId) -> Option<&Frontmatter> {
        self.metas.get(id).map(|m| &m.frontmatter)
    }

    /// Cosa nomina un riferimento: **quale** documento e, quando il riferimento
    /// porta un punto, **dove dentro** (decisione 0049).
    ///
    /// Prima di quella firma la risposta era un `DocId` e basta, e questo è il
    /// punto in cui si vedeva: `heading` e `block` di un `LinkTarget::Wiki`
    /// venivano scartati con un `..` — non per dimenticanza, ma perché non
    /// c'era dove metterli. Il modello li parsa dalla
    /// [0003](../../../../docs/decisions/0181-modello-documento-e-arene.md), il
    /// confine li trasporta, la shell li rispecchia, e si perdevano nell'ultimo
    /// centimetro.
    ///
    /// I due spazi di nomi restano due, come li ha separati la 0003: `^blocco`
    /// si cerca fra le ancore, `#Sezione` fra gli heading dell'outline. Se il
    /// riferimento nomina un punto che non c'è più, la risposta resta il
    /// documento con `at: None` — un heading rinominato apre la nota in cima,
    /// che è più di quel che faceva prima e meno di una bugia.
    pub(super) fn resolve(&self, target: &LinkTarget, from: Option<&DocId>) -> Option<ResolvedRef> {
        let doc = match target {
            // `[[#Sezione]]` e `[[#^blocco]]` nominano il documento che li
            // ospita, e senza un ospite non nominano niente: è la stessa
            // ragione per cui `from` esiste per i path relativi — la domanda
            // non è intera finché non si dice da dove la si fa.
            _ if target.names_host() => {
                let host = from?;
                self.metas.contains_key(host).then(|| host.clone())?
            }
            LinkTarget::Wiki { page, .. } => self
                .graph
                .resolve_wiki(page)
                .or_else(|| self.resolve_entry(from.unwrap_or(&DocId::new("")), target))?,
            // Un path relativo senza un documento che lo ospiti è relativo alla
            // radice: `DocId("")` è la cartella da cui `resolve_against` parte.
            LinkTarget::Path(raw) => self
                .graph
                .resolve_path(from.unwrap_or(&DocId::new("")), raw)
                .or_else(|| self.resolve_entry(from.unwrap_or(&DocId::new("")), target))?,
            // Il mondo esterno non è nel vault, e dirlo è una risposta: chi
            // passa qui l'esito di `classify` senza filtrarlo prima riceve
            // `None` invece di un errore.
            LinkTarget::Url(_) => return None,
        };
        let at = match target {
            LinkTarget::Wiki { heading, block, .. } => {
                self.position_in(&doc, heading.as_deref(), block.as_deref())
            }
            LinkTarget::Path(raw) => {
                // I frammenti URI condividono la ricerca di heading e blocchi
                // con i wikilink, dopo la decodifica del percent-encoding.
                let (_, fragment) = fub_abi::rules::path::split_fragment(raw);
                let point = fragment.strip_prefix('#').unwrap_or("");
                let decoded;
                let point = if point.contains('%') {
                    decoded = fub_abi::rules::path::percent_decode(point);
                    decoded.as_str()
                } else {
                    point
                };
                let (head, block) = match point.split_once('^') {
                    Some((h, b)) => (h, Some(b)),
                    None => (point, None),
                };
                let heading = if head.trim().is_empty() {
                    None
                } else {
                    Some(head.trim())
                };
                let block = block.map(|b| b.trim());
                self.position_in(&doc, heading, block)
            }
            _ => None,
        };
        Some(ResolvedRef { doc, at })
    }

    /// Il punto che un `[[Nota#Sezione]]` o un `[[Nota#^blocco]]` nomina dentro
    /// `doc`.
    ///
    /// La revisione arriva dall'anagrafe (§14.1) e non da una lettura fatta
    /// apposta: l'impronta di un documento è già lì, calcolata quando il kernel
    /// ne ha letto i byte per parsarlo. Senza impronta non si produce una
    /// posizione — una coordinata che non sa dire *di quando* è una coordinata
    /// che chi la usa dovrebbe indovinare, e il contratto ha deciso di non
    /// permetterlo (`DocPosition::revision` non è opzionale).
    fn position_in(
        &self,
        doc: &DocId,
        heading: Option<&str>,
        block: Option<&str>,
    ) -> Option<DocPosition> {
        let metadata = self.metas.get(doc)?;
        let (span, anchor) = match (block, heading) {
            (Some(id), _) => {
                let wanted = canonical_anchor(id);
                let found = metadata.anchors.iter().find(|a| a.id == wanted)?;
                (found.span, wanted)
            }
            // La regola sta nel contratto (`heading_matches`) e non qui: chi
            // **scrive** l'ancora di un titolo e chi la **cerca** sono la
            // stessa cosa in due versi, e due copie non saprebbero nominare la
            // seconda di due sezioni omonime allo stesso modo. L'ancora che
            // torna è quella del titolo trovato, non quella ricalcolata sulla
            // domanda: `#Ciao, Mondo!` trova `ciao-mondo`, e il chiamante ha
            // diritto all'id vero.
            (None, Some(text)) => {
                let found = metadata.outline.iter().find(|h| heading_matches(text, h))?;
                (found.span, found.slug.clone())
            }
            (None, None) => return None,
        };
        let revision = self.entries.get(doc)?.fingerprint.clone()?;
        Some(DocPosition::at(span, revision).with_anchor(anchor))
    }

    /// I documenti in relazione di link con `doc`, secondo il verso chiesto.
    ///
    /// Una volta ciascuno: [`LinkGraph::linked`] risponde con un insieme, e
    /// prima che quella firma esistesse questa funzione elencava *link* e non
    /// *documenti* — una nota che ne citava un'altra due volte compariva due
    /// volte. Non si vedeva perché a valle c'è il `BTreeMap` di [`Matches`], che
    /// li assorbiva: il difetto era coperto da un dettaglio d'implementazione di
    /// qualcun altro, ed è il modo in cui un difetto sopravvive a un refactor.
    pub(super) fn linked(&self, doc: &DocId, direction: LinkDirection) -> BTreeSet<DocId> {
        self.graph.linked(doc, direction)
    }
}
