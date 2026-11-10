//! La scrittura e la struttura del vault in memoria: `VaultWrite` e
//! `VaultStructure`.

use super::*;

impl VaultWrite for MemoryHost {
    /// La scrittura intera come la fa l'host vero, **guardia compresa**: se chi
    /// scrive dice da cosa era partito e il testo non è più quello, `Conflict` e
    /// non si scrive niente. Vale qui la ragione scritta sotto per `apply_edit`
    /// — un doppio che accettasse qualunque base non proverebbe niente proprio
    /// della cosa che questa firma esiste per rendere impossibile.
    ///
    /// Il parse invece non c'è, per la ragione scritta su `models`: un
    /// sorgente che il provider del formato rifiuterebbe qui si scrive. Chi
    /// prova che una feature scrive un sorgente valido lo prova col kernel.
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        let mut docs = self.docs.lock().unwrap();
        let id = if matches!(&base, WriteBase::Dictated) && !docs.contains_key(id.as_str()) {
            // `Dictated` creates when the document is absent, so it must obey
            // the same portability rule as `create_document`. Existing
            // imported names remain addressable verbatim.
            born_here(&id)?
        } else {
            id
        };
        // **Nessuno serve questo formato.** Nel kernel è il primo modo in cui
        // una scrittura può finire senza che il chiamante abbia sbagliato
        // niente — il parse che precede il disco non trova un provider per
        // quell'estensione (`KernelError::NoProvider`), e la faccia è
        // `unserved` —, e qui non c'era: chi scriveva `appunti.txt` contro il
        // doppio lo scriveva, e sul vault vero no (difetto 0222).
        if self.format_of(&id).is_none() {
            return Err(PluginError::Unserved(
                format!("nessun provider serve il formato di `{id}`").into(),
            ));
        }
        if let WriteBase::DescendsFrom(wait_for) = base {
            // Sui byte grezzi, come il kernel che confronta col disco: la
            // `from_utf8_lossy` di prima fondeva byte diversi nello stesso
            // testo, e una guardia che non distingue non protegge.
            let now = docs.get(id.as_str()).map(|b| Revision::of_bytes(b));
            if now.as_ref() != Some(&wait_for) {
                return Err(PluginError::Conflict(
                    format!("`{id}` è cambiato da sotto").into(),
                ));
            }
        }
        docs.insert(id.to_string(), source.as_bytes().to_vec());
        Ok(Revision::of(source))
    }
    /// Deposita byte grezzi senza conversioni: `None` crea solo se assente
    /// (atomico), `Some` confronta l'impronta dei byte attuali e risponde
    /// `Conflict` senza scrivere se non coincide. Niente fallback UTF-8, niente
    /// variante dettata implicita: la revisione è dei byte grezzi prodotti.
    /// A differenza della via testuale, qui nessun cancello di formato: un file
    /// opaco senza provider si deposita comunque, come nel kernel — che per lui
    /// emette `EntryChanged` senza inventare un modello — e non `Unserved`.
    fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        let id = if expected.is_none() && !self.docs.lock().unwrap().contains_key(id.as_str()) {
            // Come `write_document` dettato: creare è far nascere un nome, e un
            // nome che nasce passa la portabilità. Chi esiste resta com'è.
            born_here(&id)?
        } else {
            id
        };
        let mut docs = self.docs.lock().unwrap();
        match (&expected, docs.get(id.as_str())) {
            (None, Some(_)) => {
                return Err(PluginError::AlreadyExists(id.to_string().into()));
            }
            (None, None) => {}
            (Some(_), None) => {
                return Err(PluginError::Conflict(
                    format!("`{id}` non esiste più").into(),
                ));
            }
            (Some(wait_for), Some(now)) => {
                if &Revision::of_bytes(now) != wait_for {
                    return Err(PluginError::Conflict(
                        format!("`{id}` è cambiato da sotto").into(),
                    ));
                }
            }
        }
        docs.insert(id.to_string(), bytes.to_vec());
        Ok(Revision::of_bytes(bytes))
    }

    /// La modifica chirurgica come la fa l'host vero: la base si verifica, gli
    /// edit si applicano tutti o nessuno, e il documento nuovo è una scrittura
    /// normale. Un doppio che qui accettasse qualunque base non proverebbe
    /// niente proprio della cosa che questa firma esiste per rendere
    /// impossibile.
    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        let source = self.read_document(id)?;
        let (next, report) = request.apply_to(&source)?;
        if report.is_empty() {
            return Ok(report);
        }
        // La base è quella appena letta, e dirlo qui non è cerimonia: questo
        // doppio *discende* dal sorgente su cui ha calcolato gli edit, e un
        // `Dictated` direbbe il falso in una firma che esiste per non farlo.
        self.write_document(id, &next, WriteBase::DescendsFrom(Revision::of(&source)))?;
        Ok(report)
    }
}

impl VaultStructure for MemoryHost {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        // Due letture dello stesso nome, come le fa `KernelHost`: il recinto —
        // sta dentro il vault? — e la portabilità, che vale solo perché qui il
        // nome **nasce**.
        let id = fenced_doc_id(id)?;
        let id = born_here(&id)?;
        if self.docs.lock().unwrap().contains_key(id.as_str()) {
            return Err(PluginError::AlreadyExists(id.to_string().into()));
        }
        // Il nome è libero — la riga sopra l'ha appena verificato — quindi non
        // c'è nessuna revisione da cui discendere.
        self.write_document(&id, source, WriteBase::Dictated)
            .map(|_| ())
    }

    /// Sposta il sorgente e basta: questo doppio non ha un grafo, quindi non
    /// riscrive i backlink entranti. Che la rinomina *li* riscriva è una
    /// proprietà del kernel e si prova contro il kernel (`tests/`); qui si
    /// prova che una feature sappia chiederla.
    ///
    /// La destinazione però è un nome che **nasce**, e va giudicata come tale:
    /// rinominare *verso* `aux.md` è creare un file che su Windows non si apre,
    /// e il kernel lo rifiuta con `bad-args` prima di guardare qualunque altra
    /// cosa. Qui non lo faceva nessuno, e la stessa rinomina riusciva contro il
    /// doppio e falliva sul vault vero (difetto 0222). Si giudica `to` e non
    /// `from` per la ragione scritta là: rinominare *via da* `aux.md` è
    /// precisamente il modo di sistemarlo.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let from = &fenced_doc_id(from)?;
        let to = &born_here(&fenced_doc_id(to)?)?;
        let mut docs = self.docs.lock().unwrap();
        if from == to {
            return Ok(());
        }
        if docs.contains_key(to.as_str()) {
            return Err(PluginError::AlreadyExists(to.to_string().into()));
        }
        // **Un documento resta un documento.** Rinominare `nota.md` in
        // `nota.txt` nel kernel non riesce: la rinomina riparsa ciò che ha
        // spostato, e per `.txt` non c'è nessun provider — `unserved`, la stessa
        // faccia della scrittura. Un allegato invece si sposta senza che nessuno
        // lo parsi, e qui la differenza fra i due si legge dove la legge il
        // kernel: chi ha un formato deve atterrare su un formato (difetto 0222).
        if self.format_of(from).is_some() && self.format_of(to).is_none() {
            return Err(PluginError::Unserved(
                format!("nessun provider serve il formato di `{to}`").into(),
            ));
        }
        let source = docs
            .remove(from.as_str())
            .ok_or_else(|| PluginError::NotFound(from.to_string().into()))?;
        docs.insert(to.to_string(), source);
        Ok(())
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        let id = &fenced_doc_id(id)?;
        // Byte grezzi: come il disco del kernel, un allegato cestinato non è
        // testo e non deve passare da `read_document` — che lo rifiuterebbe.
        let bytes = self.read_document_bytes(id)?;
        self.docs.lock().unwrap().remove(id.as_str());
        // La forma dell'id la dà la regola del contratto, la stessa che usa il
        // kernel: un cestino piatto, il timbro prima dell'estensione, e il
        // contatore solo sulle collisioni (0219). Il timbro qui è un contatore
        // travestito da istante — questo doppio non ha un orologio — ma la
        // *forma* dell'id è quella vera, ed è la sola cosa su cui chi sviluppa
        // contro il doppio scrive del codice.
        let n = self.trashed.fetch_add(1, Ordering::Relaxed);
        let stamp = format!("2026-01-01T00-00-{n:02}");
        let occupied = self.trash.lock().unwrap();
        let trashed = DocId::new(trash::trashed_id(id.as_str(), &stamp, &mut |c| {
            occupied.contains_key(c)
        }));
        drop(occupied);
        self.trash.lock().unwrap().insert(
            trashed.to_string(),
            (
                TrashEntry {
                    id: trashed.clone(),
                    original: id.clone(),
                    deleted_at: self.now_unix_millis() / 1000,
                    size: bytes.len() as u64,
                },
                bytes,
            ),
        );
        Ok(trashed)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        let (entry, bytes) = self
            .trash
            .lock()
            .unwrap()
            .get(entry.as_str())
            .cloned()
            .ok_or_else(|| PluginError::NotFound(entry.to_string().into()))?;
        // `entry` nomina un file dentro `.trash/`, che il recinto dei
        // documenti rifiuta apposta: chi lo valida è la ricerca fra le voci del
        // cestino, appena sopra. Il `to` invece atterra nel vault, ed è un nome
        // che **nasce**: senza `to` torna quello che c'era, e quello non si
        // rigiudica (è la stessa asimmetria del protocollo staged del kernel).
        let target = match to {
            Some(to) => born_here(&fenced_doc_id(&to)?)?,
            None => entry.original,
        };
        if self.docs.lock().unwrap().contains_key(target.as_str()) {
            return Err(PluginError::AlreadyExists(target.to_string().into()));
        }
        // Byte grezzi senza passare dal testo né rigiudicare chi torna a casa:
        // `None` rimette l'originale com'era (stessa asimmetria del protocollo
        // staged del kernel), anche se è un allegato che nessuna porta di
        // scrittura servirebbe. Solo il `to` esplicito è un nome che nasce e
        // si giudica come tale, già fatto sopra.
        self.docs.lock().unwrap().insert(target.to_string(), bytes);
        self.trash.lock().unwrap().remove(entry.id.as_str());
        Ok(target)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        let mut trash = self.trash.lock().unwrap();
        let count = trash.len() as u64;
        trash.clear();
        Ok(count)
    }
}
