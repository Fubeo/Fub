//! Creare, eliminare e cestinare note e cartelle.

use super::*;

impl Workspace {
    /// Crea una nota vuota e restituisce il suo [`DocId`].
    ///
    /// Senza `name` nasce `Senza titolo` nella cartella configurata da
    /// `files.new-note-folder` — o nella radice se il valore è vuoto — e se il
    /// nome è già preso usa `Senza titolo 1`, `2`, … (D3). Con `name` è il
    /// flusso "crea nota da link non risolto": un nome semplice usa la stessa
    /// cartella configurata, mentre un path esplicito resta nel path indicato.
    /// Una collisione è un errore, non un nome aggiustato in silenzio.
    ///
    /// Il nome libero si calcola qui dentro, dove il workspace è preso in
    /// esclusiva: cercarlo dal chiamante e poi scrivere sarebbe una corsa fra
    /// la domanda e la risposta.
    pub fn create_notes(&mut self, name: Option<&str>) -> Result<DocId> {
        let id = match name {
            Some(name) => {
                let id = self.new_notes_id(name)?;
                if self.is_taken(&id) {
                    return Err(KernelError::AlreadyExists(id.to_string()));
                }
                id
            }
            None => self.free_name(&self.new_notes_id(UNTITLED)?),
        };
        // Una nota nuova è una scrittura come le altre: grafo, indici ed eventi
        // la vedono nascere per la via normale. `Dictated` perché il nome
        // appena scelto è libero — `free_name` o il controllo sopra l'hanno
        // appena stabilito — e una base sarebbe la revisione di un file che non
        // esiste.
        self.write_document(&id, "", WriteBase::Dictated)?;
        Ok(id)
    }

    /// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
    /// a partire da un [`DocId`] qualsiasi. Se `id` è già libero, è lui.
    ///
    /// È la convenzione D3, e vive **qui** perché il workspace è l'unico a
    /// sapere cosa è occupato — in memoria e su disco. La usa `create_notes` per
    /// la nota senza titolo, e la usa l'app quando il ripristino dal cestino
    /// trova il path di nuovo occupato e deve proporre un'alternativa. Due
    /// implementazioni della stessa convenzione (una nel kernel, una nel
    /// frontend) divergerebbero al primo ritocco.
    ///
    /// Non prenota niente: fra la domanda e la scrittura il nome può diventare
    /// occupato, e a quel punto è la scrittura a dirlo. Per questo `create_notes`
    /// lo calcola dentro di sé e non lo chiede a un chiamante.
    pub fn free_name(&self, id: &DocId) -> DocId {
        let (stem, ext) = match id.as_str().rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.contains('/') => {
                (stem, format!(".{ext}"))
            }
            _ => (id.as_str(), String::new()),
        };
        (0u32..)
            .map(|n| match n {
                0 => id.clone(),
                n => DocId::new(format!("{stem} {n}{ext}")),
            })
            .find(|candidate| !self.is_taken(candidate))
            .expect("la sequenza dei candidati è infinita")
    }

    /// Questo path è già di qualcuno? Vale sia l'indicizzato sia ciò che sta
    /// sul disco e il workspace non ha ancora visto.
    pub(crate) fn is_taken(&self, id: &DocId) -> bool {
        self.indexes.core.metas.contains_key(id) || self.docs.vault.exists(id)
    }

    /// Crea una cartella vuota nel vault e la fa comparire nell'albero (§14.3).
    ///
    /// Il nome passa dalla stessa regola di un documento che nasce
    /// ([`new_doc_id`]): recinto, spazio macchina, caratteri riservati e forma
    /// NFC. Una cartella esclusa dalla politica del vault è rifiutata: la
    /// scansione non la vedrebbe, e l'albero mostrerebbe una voce che alla
    /// riapertura sparisce. Una voce già presente — cartella o file — è
    /// [`KernelError::AlreadyExists`] e il disco resta com'era.
    ///
    /// Torna il path normalizzato, che è quello che l'albero mostrerà.
    pub fn create_folder(&mut self, name: &str) -> Result<String> {
        let id = self.check_new_folder(name)?;
        self.docs.vault.create_folder(id.as_str())?;
        self.indexes.core.ensure_folders_of(&id);
        self.indexes.core.set_folder(id.as_str());
        self.emit_event(Event::IndexUpdated);
        Ok(id.as_str().to_string())
    }

    /// Toglie dal disco una cartella **vuota** e la fa sparire dall'albero.
    ///
    /// È la metà che chiude una rinomina o un cestinamento di cartella: le
    /// voci si spostano una per una, con la loro storia e i loro link, e alla
    /// fine resta il guscio. Vuota vuol dire vuota sul disco e non nell'indice:
    /// un file nascosto o escluso dal vault che sta ancora lì dentro tiene in
    /// piedi la cartella, e l'errore lo dice invece di cancellarlo.
    pub fn remove_empty_folder(&mut self, folder: &str) -> Result<()> {
        let folder = fub_abi::rules::folders::normalized(folder).to_string();
        if folder.is_empty() {
            return Err(KernelError::BadName {
                name: folder,
                why: "la radice del vault non si toglie".to_string(),
            });
        }
        let path = self.docs.vault.path_for(&DocId::new(folder.as_str()))?;
        let storage = Arc::clone(self.docs.vault.storage());
        let io = |path: &Utf8Path, source: std::io::Error| match source.kind() {
            std::io::ErrorKind::NotFound => KernelError::NotFound(folder.clone()),
            _ => KernelError::Io {
                path: path.to_owned(),
                source,
            },
        };
        // Il supporto tiene accanto a ogni file il suo compagno di lock
        // (`.nota.md.lock`), stabile per costruzione: non si toglie al rilascio,
        // ed è lui a restare indietro quando la nota se ne va. Un lock il cui
        // file non c'è più non protegge niente, e lasciarlo vorrebbe dire una
        // cartella che non si svuota mai. Tutto il resto — anche un solo file
        // nascosto — la tiene in piedi.
        let listed = storage.list(&path).map_err(|source| io(&path, source))?;
        let names: std::collections::HashSet<&str> = listed
            .iter()
            .filter_map(|entry| entry.path.file_name())
            .collect();
        let mut orphans = Vec::new();
        for entry in &listed {
            let orphan = entry.stat.kind == crate::storage::EntryKind::File
                && entry
                    .path
                    .file_name()
                    .and_then(|name| name.strip_prefix('.'))
                    .and_then(|name| name.strip_suffix(".lock"))
                    .is_some_and(|owner| !owner.is_empty() && !names.contains(owner));
            if !orphan {
                return Err(KernelError::Io {
                    path,
                    source: std::io::Error::new(
                        std::io::ErrorKind::DirectoryNotEmpty,
                        "la cartella contiene ancora dei file",
                    ),
                });
            }
            orphans.push(entry.path.clone());
        }
        for orphan in orphans {
            storage
                .remove(&orphan)
                .map_err(|source| io(&orphan, source))?;
        }
        storage
            .remove_empty_dir(&path)
            .map_err(|source| io(&path, source))?;
        self.indexes.core.forget_folder(&folder);
        self.emit_event(Event::IndexUpdated);
        Ok(())
    }

    /// Ciò che l'organizzazione tiene per path di cartella — icona, spazio,
    /// ordinamento dei figli — segue una cartella che cambia path. Chi sposta
    /// una cartella voce per voce lo chiama **prima** delle voci
    /// ([`OrganizationStore::migrate_folder`](crate::organization::OrganizationStore::migrate_folder)).
    pub fn migrate_folder_organization(&mut self, from: &str, to: &str) -> Result<()> {
        let from = fub_abi::rules::folders::normalized(from);
        let to = new_doc_id(fub_abi::rules::folders::normalized(to))?;
        if from.is_empty() {
            return Err(KernelError::BadName {
                name: from.to_string(),
                why: "la radice del vault non si sposta".to_string(),
            });
        }
        if self
            .organization
            .migrate_folder(from, to.as_str())
            .map_err(|error| KernelError::Io {
                path: Utf8PathBuf::from(".fub/workspace.json"),
                source: std::io::Error::other(error),
            })?
        {
            self.emit_event(Event::IndexUpdated);
        }
        Ok(())
    }

    /// Il preflight di [`create_folder`](Workspace::create_folder), senza
    /// scrivere: lo stesso giudizio che darebbe la creazione adesso, e il path
    /// normalizzato che nascerebbe. Serve alla prova a vuoto di un comando;
    /// fra la domanda e la scrittura il nome può ancora occuparsi, e a quel
    /// punto è la creazione a dirlo.
    pub fn check_new_folder(&self, name: &str) -> Result<DocId> {
        let id = new_doc_id(name)?;
        let abs = self.docs.vault.path_for(&id)?;
        if self.docs.vault.is_ignored(&abs) {
            return Err(KernelError::BadName {
                name: name.to_string(),
                why: "la cartella è esclusa dal vault".to_string(),
            });
        }
        if self.docs.vault.exists(&id) {
            return Err(KernelError::AlreadyExists(id.to_string()));
        }
        Ok(id)
    }

    /// Il [`DocId`] di una nota che nasce col nome dato: separatori normalizzati
    /// e, se il nome non porta già un'estensione gestita, quella di default.
    /// Un nome semplice viene collocato nella cartella configurata; un path
    /// esplicito non viene mai ribasato.
    pub(super) fn new_notes_id(&self, name: &str) -> Result<DocId> {
        // Un nome che nasce: la tolleranza stretta del §15.5.
        let mut id = new_doc_id(name)?;
        if !id.as_str().contains('/') {
            let folder = self
                .settings
                .read()
                .expect("store di configurazione")
                .effective(crate::settings::NEW_NOTE_FOLDER)
                .ok()
                .and_then(|(value, _)| value.as_text().map(str::to_owned))
                .unwrap_or_default();
            // Una cartella con `./` segue la nota aperta: è la shell a saperla,
            // e la passa come cartella. Chi crea senza (la riga di comando, un
            // nome nudo) parte dalla radice.
            let folder = fub_abi::rules::folders::for_note(&folder, "");
            if !folder.is_empty() {
                id = new_doc_id(&format!("{folder}/{}", id.as_str()))?;
            }
        }
        if self.docs.has_provider_for(&id) {
            return Ok(id);
        }
        // L'estensione scelta nelle impostazioni, se un provider la serve;
        // altrimenti quella del primo provider registrato.
        let chosen = self
            .settings
            .read()
            .expect("store di configurazione")
            .effective(crate::settings::NEW_NOTE_EXTENSION)
            .ok()
            .and_then(|(value, _)| value.as_text().map(str::to_owned))
            .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
            .filter(|ext| !ext.is_empty() && !ext.contains(['/', '.']))
            .filter(|ext| self.docs.registry.has_doc_ext(ext));
        let ext = match chosen {
            Some(ext) => ext,
            None => self
                .docs
                .registry
                .default_extension()
                .ok_or(KernelError::NoDefaultFormat)?,
        };
        Ok(DocId::new(format!("{}.{ext}", id.as_str())))
    }

    /// Cancella un documento **spostandolo nel cestino** del vault, e
    /// restituisce il [`DocId`] che vi ha assunto.
    ///
    /// È il delete dell'app, ed è un metodo a sé: [`remove_document`] è il
    /// percorso del *watcher*, che reagisce a un file già sparito dal disco e
    /// non ha nulla da cestinare. Qui il file c'è, e viene spostato prima che i
    /// modelli lo dimentichino — se lo spostamento fallisce, il workspace non
    /// si è mosso e la nota è ancora dov'era.
    ///
    /// Modelli, grafo, indici ed evento sono esattamente il lavoro di
    /// [`remove_document`]: un secondo percorso di rimozione da tenere allineato
    /// sarebbe un secondo modo di divergere.
    ///
    /// [`remove_document`]: Workspace::remove_document
    pub fn delete_document(&mut self, id: &DocId) -> Result<DocId> {
        let completed = self.prepare_document_deletion(id)?.invoke()?;
        let committed = match self.commit_document_deletion(completed) {
            Ok(committed) => committed,
            Err(failure) => {
                let (error, completed) = *failure;
                completed.rollback()?;
                return Err(error);
            }
        };
        let finalized = committed.invoke();
        let trashed = match self.finish_document_deletion(finalized) {
            Ok(trashed) => trashed,
            Err(_) => unreachable!("il commit ha già validato l'identità del workspace"),
        };
        Ok(trashed)
    }

    pub(super) fn finish_deleted_document(
        &mut self,
        id: &DocId,
        trashed: DocId,
        sidecar_fault: Option<KernelError>,
        draft_fault: Option<String>,
        journal_fault: Option<String>,
    ) -> DocId {
        // **E la bozza non salvata se ne va con la nota** (§15.2). Sta qui per
        // la ragione per cui `migrate_side_data` la fa seguire una rinomina —
        // una bozza è indicizzata per `DocId`, e un `DocId` che non nomina più
        // niente è una bozza che nessuna vista raggiunge — ma con la risposta
        // opposta, perché opposto è il gesto: chi rinomina vuole quel testo al
        // nome nuovo, chi cestina ha appena detto che quella nota non la vuole.
        // La bozza rimasta sotto la chiave vecchia non è un residuo innocuo: è
        // ciò che il recupero all'avvio ripesca e rimette in un buffer sporco,
        // cioè una nota cestinata che risorge alla prima scrittura di chi non ha
        // chiesto niente (difetto 0208).
        //
        // `delete_document` e non `remove_document`, e la differenza è tutta:
        // questo è il cestino dell'app, dove l'utente ha confermato: quello è il
        // percorso del **watcher**, che reagisce a un file sparito dal disco per
        // mano d'altri — ed è precisamente il momento in cui la bozza è l'unica
        // copia di ciò che si era scritto, quindi lì non si tocca.
        // I callback di storage per bozza e registro sono già avvenuti dal
        // finalizzatore owned. Qui si trasformano soltanto i loro esiti in
        // avvisi e fatti del workspace.
        if let Some(and) = draft_fault {
            self.organization.warn(format!(
                "la bozza non salvata di {id} è rimasta dietro alla nota cestinata: {and}"
            ));
        }
        if let Some(and) = journal_fault {
            self.report_trouble(
                Severity::Failure,
                None,
                PluginError::Internal(format!("registro: {and}").into()),
                None,
            );
        }
        // Il sidecar del cestino non si è scritto e la cancellazione è
        // riuscita lo stesso: la nota veniva dalla radice, dove il nome basta
        // a riportarla, oppure non è riuscita a tornare indietro. La voce
        // perde comunque la data della cancellazione e il timbro che la
        // distingue da un omonimo: è la perdita di un dato autorevole (0052
        // la conta come `Failure`), e `delete_document` è il primo chiamante
        // con il workspace in mano — quindi è qui che il guasto esce sia nel
        // log che nel canale (0062).
        if let Some(fault) = sidecar_fault {
            tracing::warn!(target: "fub.kernel", "cestino: sidecar di {trashed} non scritto: {fault}");
            // Stringa letterale e non chiave di catalogo: è il precedente dei
            // guasti del kernel (`report_losses` passa i messaggi di panico di
            // `safety::reporting`), e il giorno che il centro notifiche vorrà
            // tradurli tutti, li raccoglie insieme.
            self.report_trouble(
                Severity::Failure,
                Some(trashed.clone()),
                PluginError::Internal(
                    format!("cestino: sidecar di {trashed} non scritto: {fault}").into(),
                ),
                None,
            );
        }
        trashed
    }

    /// Elenca il contenuto del cestino, inclusi allegati e voci straniere.
    ///
    /// Il ripristino non ha un gemello sincrono su `Workspace`: parser e indici
    /// devono attraversare il protocollo staged di `workspace::restore`, così
    /// l'host può invocarli dopo aver rilasciato `Custody<Workspace>`.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        self.docs.vault.list_trash()
    }

    /// Prepara lo sweep del cestino senza accedere allo storage.
    pub fn prepare_empty_trash(&self) -> PreparedTrashSweep {
        self.docs.vault.prepare_empty_trash()
    }

    /// Svuota il cestino. Restituisce quante voci ha cancellato: da qui in poi
    /// non sono più recuperabili, e chi chiama deve poterlo dire.
    pub fn empty_trash(&mut self) -> Result<usize> {
        self.docs.vault.empty_trash()
    }
}
