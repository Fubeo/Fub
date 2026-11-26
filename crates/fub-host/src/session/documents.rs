//! Leggere e scrivere i documenti (testo, byte, fogli, documenti ricchi) e le bozze.

use super::*;

impl Host {
    /// Sorgente, revisione e formato dalla stessa fotografia del workspace:
    /// una **lettura semplice**.
    ///
    /// Per un documento di videoscrittura la sorgente è la sua proiezione, per
    /// una cartella di Excel il suo giornale vuoto; la revisione è quella dei
    /// byte del file ([`crate::rich`], [`crate::workbook`]): i byte si leggono
    /// nella fotografia, la proiezione si calcola fuori. Il documento non
    /// conta come aperto, e la prova a vuoto della proiezione non resta
    /// ricordata ([`crate::engines`]): è la lettura dell'anteprima, della CLI,
    /// della cattura e dei lavori. Chi lo tiene aperto per salvarlo lo apre
    /// con [`Host::open_document_with_format`].
    pub fn read_document_with_format(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<(String, Revision, Option<DocumentFormat>), PluginError> {
        self.read_document_as(vault, id, None)
    }

    /// **Apre** un documento sotto la chiave di apertura di una sessione della
    /// shell: la stessa proiezione, la stessa revisione e lo stesso formato di
    /// [`Host::read_document_with_format`], ma un documento di videoscrittura
    /// conta come aperto, la sua revisione si segna sotto la chiave e la prova
    /// a vuoto dei suoi byte resta ricordata per il salvataggio, finché la
    /// shell non chiude la chiave ([`Host::document_closed`]). Un documento
    /// che non è di videoscrittura si legge e non segna niente; una lettura
    /// che fallisce non apre la chiave.
    pub fn open_document_with_format(
        &self,
        vault: Option<&str>,
        id: &DocId,
        key: &OpenKey,
    ) -> Result<(String, Revision, Option<DocumentFormat>), PluginError> {
        self.read_document_as(vault, id, Some(key))
    }

    pub(super) fn read_document_as(
        &self,
        vault: Option<&str>,
        id: &DocId,
        key: Option<&OpenKey>,
    ) -> Result<(String, Revision, Option<DocumentFormat>), PluginError> {
        enum Read {
            Source(String),
            Rich(crate::rich::Codec, Vec<u8>),
            Workbook(Vec<u8>),
        }
        // Il registro dei documenti ricchi aperti si prende dalla stessa
        // sessione della lettura, e si usa fuori dal prestito.
        let (read, format, open_rich) = self.in_session(vault, |session| {
            let workspace = session.workspace.read()?;
            let format = workspace.format_of(id);
            let bytes = || workspace.read_source_bytes(id).map_err(PluginError::from);
            let read = match crate::rich::codec(format.as_ref()) {
                Some(codec) => Read::Rich(codec, bytes()?),
                None if crate::workbook::is_workbook(format.as_ref()) => Read::Workbook(bytes()?),
                None => Read::Source(workspace.read_source(id).map_err(PluginError::from)?),
            };
            Ok((read, format, Arc::clone(&session.open_rich)))
        })?;
        match read {
            Read::Source(source) => {
                let revision = Revision::of(&source);
                Ok((source, revision, format))
            }
            Read::Rich(codec, bytes) => {
                let revision = Revision::of_bytes(&bytes);
                let Some(key) = key else {
                    let projection =
                        crate::rich::open(codec, id, &bytes, crate::rich::Opening::Plain)?;
                    return Ok((projection, revision, format));
                };
                let opened = crate::rich::open(codec, id, &bytes, crate::rich::Opening::Kept);
                drop(bytes);
                let projection = match opened {
                    Ok(projection) => projection,
                    Err(error) => {
                        // La chiave non si apre: una prova che l'apertura
                        // avesse ricordato prima di fallire non resta senza
                        // chi la tiene.
                        self.forget_unheld(&[revision]);
                        return Err(error);
                    }
                };
                let closed = open_rich.hold(key, std::slice::from_ref(&revision));
                self.forget_unheld(&closed);
                Ok((projection, revision, format))
            }
            // Il testo di una cartella è il suo giornale, vuoto finché la shell
            // non cambia una cella: i valori li dà la griglia, sui byte.
            Read::Workbook(bytes) => {
                crate::workbook::check(id, &bytes)?;
                Ok((String::new(), Revision::of_bytes(&bytes), format))
            }
        }
    }

    /// Il formato che il vault riconosce a `id`, anche per un nome che non
    /// esiste ancora: chi sta per scrivere in un documento nuovo chiede al
    /// formato prima di crearlo, non dopo.
    pub(crate) fn format_of(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<Option<DocumentFormat>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.format_of(id)))
    }

    /// Una frase del catalogo del core resa nella lingua del vault, per il
    /// testo che l'host scrive **dentro** una nota e non in un esito.
    pub(crate) fn core_phrase(
        &self,
        vault: Option<&str>,
        mut text: Text,
    ) -> Result<String, PluginError> {
        self.read_workspace(vault, |workspace| {
            workspace.localize_as(crate::settings::CORE_ID, &mut text);
            Ok(text.as_literal().unwrap_or_default().to_string())
        })
    }

    /// Sorgente e revisione dalla stessa lettura.
    pub fn read_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<(String, Revision), PluginError> {
        self.read_document_with_format(vault, id)
            .map(|(source, revision, _format)| (source, revision))
    }

    /// Reads the parsed model through a detached prepare/call/finalize cycle.
    pub fn read_model(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<fub_abi::model::DocumentModel, PluginError> {
        let prepared = self.read_workspace(vault, |workspace| {
            workspace.prepare_detached_document_model(id)
        })?;
        let completed = prepared.invoke()?;
        self.read_workspace(vault, |workspace| {
            workspace.finish_detached_document_model(completed)
        })
    }

    /// Renders a document preview through the detached projection planner.
    pub fn render_preview(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<fub_kernel::RenderedDocument, PluginError> {
        let result = query_workspace(
            &self.session_workspace(vault)?,
            fub_abi::traits::IndexQuery::RenderPreview { doc: id.clone() },
        )?;
        match result {
            fub_abi::traits::IndexResult::RenderPreview(rendered) => Ok(rendered.into()),
            other => Err(PluginError::Internal(
                format!("preview query returned {}", other.kind_name()).into(),
            )),
        }
    }

    pub fn grid_surfaces(&self, vault: Option<&str>) -> Result<Vec<GridSurfaceSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.grid_surfaces()))
    }

    pub(super) fn with_grid_bytes<R>(
        &self,
        vault: Option<&str>,
        surface: &str,
        call: impl FnOnce(&fub_kernel::workspace::PreparedGridBytesCall) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        let workspace = self.session_workspace(vault)?;
        let prepared = {
            let workspace = workspace.read()?;
            workspace.prepare_grid_bytes_call(surface)?
        };
        call(&prepared)
    }

    /// Apre la superficie `surface` della versione 2 sui byte di `doc`, con il
    /// giornale `journal` della sua `DocumentSession`.
    ///
    /// I byte li legge l'host, non la shell: la revisione `base` è quella su
    /// cui la sessione del documento ha il giornale, e byte diversi sono un
    /// conflitto da ricaricare. La superficie apre soltanto un documento del
    /// formato che dichiara.
    pub fn grid_bytes_open(
        &self,
        vault: Option<&str>,
        surface: &str,
        doc: &DocId,
        journal: &str,
        base: Revision,
    ) -> Result<GridBytesSession, PluginError> {
        let journal = GridJournal::parse(journal)?;
        let workspace = self.session_workspace(vault)?;
        let (bytes, prepared) = {
            let ws = workspace.read()?;
            let prepared = ws.prepare_grid_bytes_call(surface)?;
            let declared = ws
                .grid_surfaces()
                .into_iter()
                .find(|spec| spec.id == surface)
                .map(|spec| spec.format);
            let format = ws.format_of(doc).map(|known| known.descriptor.id);
            if declared.is_none() || declared != format {
                return Err(PluginError::BadArgs(Text::message(
                    "host.grid.surface_format",
                    vec![
                        Arg::text("surface", surface),
                        Arg::text("doc", doc.as_str()),
                    ],
                )));
            }
            (
                ws.read_source_bytes(doc).map_err(PluginError::from)?,
                prepared,
            )
        };
        let revision = Revision::of_bytes(&bytes);
        if revision != base {
            return Err(PluginError::from(fub_kernel::KernelError::Stale(
                doc.to_string(),
            )));
        }
        prepared.open(surface, &bytes, revision, &journal)
    }

    pub fn grid_bytes_window(
        &self,
        vault: Option<&str>,
        surface: &str,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError> {
        self.with_grid_bytes(vault, surface, |provider| {
            provider.window(instance, request)
        })
    }

    pub fn grid_bytes_apply(
        &self,
        vault: Option<&str>,
        surface: &str,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        self.with_grid_bytes(vault, surface, |provider| provider.apply(instance, request))
    }

    pub fn grid_bytes_commands(
        &self,
        vault: Option<&str>,
        surface: &str,
        instance: &str,
        selection: GridSelection,
    ) -> Result<Vec<GridCommandState>, PluginError> {
        self.with_grid_bytes(vault, surface, |provider| {
            provider.commands(instance, selection)
        })
    }

    /// Dà un comando del catalogo alla sessione grid `instance`. L'esito
    /// porta il diff del giornale, che la shell applica al buffer della
    /// `DocumentSession` come quello di `grid_bytes_apply`.
    pub fn grid_bytes_command(
        &self,
        vault: Option<&str>,
        surface: &str,
        instance: &str,
        request: GridCommandRequest,
    ) -> Result<GridCommandOutcome, PluginError> {
        self.with_grid_bytes(vault, surface, |provider| {
            provider.command(instance, request)
        })
    }

    pub fn grid_bytes_close(
        &self,
        vault: Option<&str>,
        surface: &str,
        instance: &str,
    ) -> Result<(), PluginError> {
        self.with_grid_bytes(vault, surface, |provider| provider.close(instance))
    }

    /// Scrive un documento intero da `source`, dichiarando da che cosa parte.
    ///
    /// Senza chiave di apertura: le prove a vuoto che il salvataggio di un
    /// documento di videoscrittura ha lasciato nel motore, e che nessuna
    /// chiave aperta tiene, si dimenticano subito ([`crate::engines`]). È la
    /// scrittura della CLI, della cattura e dei lavori; la shell, che tiene il
    /// documento aperto, scrive con [`Host::write_open_document`].
    pub fn write_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.write_document_as(vault, id, source, base, None)
    }

    /// [`Host::write_document`] sotto la chiave di apertura di una sessione
    /// della shell: per un documento di videoscrittura, la revisione dei byte
    /// sovrascritti e quella dei byte nuovi si segnano sotto la chiave, che si
    /// apre se non lo era (una sessione nuova può scrivere prima di leggere).
    /// Una scrittura che fallisce non apre la chiave, e non lascia prove che
    /// nessuna chiave tiene.
    pub fn write_open_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
        key: &OpenKey,
    ) -> Result<Revision, PluginError> {
        self.write_document_as(vault, id, source, base, Some(key))
    }

    pub(super) fn write_document_as(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
        key: Option<&OpenKey>,
    ) -> Result<Revision, PluginError> {
        let (workspace, open_rich) = self.with_session(vault, |session| {
            (session.workspace.clone(), Arc::clone(&session.open_rich))
        })?;
        let mut trace = RichWrite::default();
        let written = self.write_document_in(workspace, id, source, base, &mut trace);
        if let (Ok(revision), Some(key), Some(overwritten)) = (&written, key, &trace.overwritten) {
            // Sotto la chiave, i byte sovrascritti e quelli nuovi: la prova
            // dei primi l'ha fatta il salvataggio, quella dei secondi la farà
            // il prossimo.
            let mut held: Vec<Revision> = overwritten.iter().cloned().collect();
            held.push(revision.clone());
            trace.left.extend(open_rich.hold(key, &held));
        }
        self.forget_unheld(&trace.left);
        written
    }

    /// Dimentica le prove a vuoto di queste revisioni che nessuna chiave
    /// aperta, in nessun vault, tiene ([`crate::engines`]). I registri si
    /// prendono sotto il prestito delle sessioni, e si leggono e si
    /// dimenticano dopo averlo lasciato. Vero se non resta aperta nessuna
    /// chiave in nessun vault.
    pub(super) fn forget_unheld(&self, left: &[Revision]) -> bool {
        let registers = self.open_registers();
        crate::engines::forget_proofs(left, &registers);
        registers.iter().all(|register| register.is_empty())
    }

    /// I registri delle chiavi di ogni vault aperto.
    pub(super) fn open_registers(&self) -> Vec<Arc<crate::engines::OpenRich>> {
        self.sessions
            .read()
            .map(|sessions| open_registers(&sessions))
            .unwrap_or_default()
    }

    /// Scalda in sottofondo il motore che apre questa estensione (`"docx"`,
    /// `".XLSX"`), se un vault aperto ha un provider attivo per lei: la shell
    /// lo chiede quando il puntatore si ferma su un file o una cartella si
    /// apre ([`crate::engines`]). Un motore già acceso, o già in costruzione,
    /// non rifà niente. Non apre nessun file.
    ///
    /// Vero se un motore si sta preparando o è pronto. Un'estensione senza
    /// motore, senza provider attivo o malformata dà falso, senza errore:
    /// scaldare è un suggerimento, e non c'è niente da dire alla shell.
    pub fn warm_engine(&self, extension: &str) -> bool {
        let Some(extension) = crate::engines::extension(extension) else {
            tracing::debug!(extension, "scaldare: non è un'estensione");
            return false;
        };
        // Le custodie si prendono sotto il prestito delle sessioni; i
        // workspace si leggono dopo averlo lasciato.
        let workspaces: Vec<Custody<Workspace>> = self
            .sessions
            .read()
            .map(|sessions| {
                sessions
                    .slots
                    .values()
                    .filter_map(|slot| match slot {
                        SessionSlot::Open(session) => Some(session.workspace.clone()),
                        SessionSlot::Closing(_) | SessionSlot::Applying(_) => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let served = workspaces.iter().any(|workspace| {
            workspace
                .read()
                .is_ok_and(|workspace| crate::engines::serves(&workspace, &extension))
        });
        if !served {
            tracing::debug!(%extension, "scaldare: nessun vault aperto ha un provider attivo");
            return false;
        }
        // Fuori da ogni lucchetto dell'host: il registro prende la voce e la
        // scalda, e la costruzione va sul gruppo di thread dei motori.
        match fub_motori::Motori::processo().scalda_per(&extension) {
            Ok(warming) => {
                if !warming {
                    tracing::debug!(%extension, "scaldare: nessun motore apre l'estensione");
                }
                warming
            }
            Err(error) => {
                tracing::debug!(%extension, %error, "scaldare: il registro dei motori non risponde");
                false
            }
        }
    }

    /// La shell ha chiuso la sessione di documento della chiave `key`.
    ///
    /// La chiave si toglie, e si dimenticano le prove a vuoto delle sue
    /// revisioni che nessun'altra chiave aperta, in nessun vault, tiene; se
    /// non resta aperta nessuna chiave in nessun vault, si svuota la cache del
    /// motore dei documenti ([`crate::engines`]). Una chiave sconosciuta, già
    /// chiusa o di un vault non aperto (o di un nome che non si risolve) non
    /// fa niente e non è un errore. Il disco non si legge.
    pub fn document_closed(&self, vault: Option<&str>, key: &OpenKey) -> Result<(), PluginError> {
        let open_rich = match self.with_session(vault, |session| Arc::clone(&session.open_rich)) {
            Ok(open_rich) => open_rich,
            // Un vault che non è aperto, o un nome che non si risolve: non
            // c'è niente di aperto da chiudere.
            Err(PluginError::NotFound(_) | PluginError::Io(_)) => return Ok(()),
            Err(error) => return Err(error),
        };
        let Some(closed) = open_rich.close(key) else {
            return Ok(());
        };
        if self.forget_unheld(&closed) {
            crate::engines::empty_document_caches();
        }
        Ok(())
    }

    /// Quante chiavi di apertura sono aperte nel vault (`None`: il corrente).
    /// Un vault non aperto non ne ha.
    pub fn open_keys(&self, vault: Option<&str>) -> usize {
        self.with_session(vault, |session| session.open_rich.len())
            .unwrap_or(0)
    }

    /// Deposita byte grezzi: creazione esclusiva oppure CAS della revisione raw.
    /// Parser, hook e indici attraversano il loro confine senza custodia.
    pub fn write_document_bytes(
        &self,
        vault: Option<&str>,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        Self::write_bytes_in(&workspace, id, bytes, expected)
    }

    /// Cerca fra i file del vault (`None`: il vault corrente) quello che ha
    /// questi byte e lo stesso tipo di `target`, il nome che si vorrebbe
    /// scrivere, anche con un altro nome: vedi [`SameContent`].
    ///
    /// Il vault si risolve **una volta**: la domanda e le impronte imparate
    /// rispondendo vanno alla stessa custodia anche se nel frattempo il vault
    /// corrente cambia. I candidati vengono dall'indice vivo, presi sotto la
    /// custodia per un attimo; il confronto si fa fuori da essa, sui byte già
    /// in memoria. Nessuna chiamata a un provider col lucchetto preso, e
    /// nessuna scrittura di `entries.json` fuori dall'anagrafe.
    ///
    /// Un «non so» per budget finito ([`UnknownReason::BudgetExhausted`]) non è
    /// stabile come gli altri: le impronte che quel giro ha imparato rendono il
    /// giro dopo più economico, e il giro dopo può arrivare a un candidato che
    /// il primo non ha letto. Allora, e solo se il primo giro ha davvero
    /// insegnato qualcosa all'indice, si fa **un** secondo giro, qui dentro:
    /// chi chiede fa sempre una domanda sola, e nessuna per nome occupato.
    ///
    /// [`UnknownReason::BudgetExhausted`]: fub_kernel::same_content::UnknownReason::BudgetExhausted
    pub fn same_content(
        &self,
        vault: Option<&str>,
        target: &DocId,
        bytes: &[u8],
    ) -> Result<SameContent, PluginError> {
        let workspace = self.session_workspace(vault)?;
        let (answer, kept) = Self::same_content_round(&workspace, target, bytes)?;
        let exhausted = matches!(
            answer,
            SameContent::Unknown {
                reason: fub_kernel::same_content::UnknownReason::BudgetExhausted
            }
        );
        if exhausted && kept > 0 {
            return Ok(Self::same_content_round(&workspace, target, bytes)?.0);
        }
        Ok(answer)
    }

    /// Un giro della domanda di [`same_content`](Self::same_content): la
    /// risposta, e quante impronte imparate l'indice ha tenuto.
    ///
    /// Le impronte tornano all'indice con [`Custody::write`], che **prende il
    /// turno di scrittura** prima del lucchetto (la presa lo porta con sé fino
    /// al rilascio): se un altro writer ha il turno aperto attraverso il codice
    /// di un provider (decisione 0120), la consegna aspetta che lo chiuda e non
    /// entra a metà del suo lavoro. Non si drenano eventi: imparare
    /// un'impronta non ne produce, e l'indice non ha un lucchetto suo fuori dal
    /// workspace. L'indice le ricontrolla contro l'anagrafe; un'impronta che
    /// non si riesce a riportare costa solo una rilettura la prossima volta.
    pub(super) fn same_content_round(
        workspace: &Custody<Workspace>,
        target: &DocId,
        bytes: &[u8],
    ) -> Result<(SameContent, usize), PluginError> {
        let prepared = workspace
            .read()?
            .prepare_same_content(target, bytes.len() as u64);
        let fub_kernel::same_content::SameContentOutcome { answer, learned } =
            prepared.invoke(bytes);
        let mut kept = 0;
        if !learned.is_empty() {
            match workspace.write() {
                Ok(mut workspace) => {
                    kept = workspace.learn_fingerprints(learned);
                }
                Err(and) => {
                    tracing::warn!(target: "fub.host", "impronte non riportate nell'indice: {and}");
                }
            }
        }
        Ok((answer, kept))
    }

    /// Scrive la proiezione `source` di un documento di videoscrittura.
    ///
    /// Tutto dentro il turno di scrittura, che è rientrante: i byte su cui la
    /// shell ha lavorato si leggono e si confrontano con la base, il codec
    /// salva fuori dal lucchetto, e i byte nuovi passano dal CAS della stessa
    /// revisione. Una proiezione che descrive il file com'è non scrive niente.
    ///
    /// `trace` dice che il documento è di videoscrittura, quali byte si sono
    /// sovrascritti e di quali revisioni il codec può aver ricordato la prova,
    /// anche quando il salvataggio fallisce: chi scrive le dimentica se nessuna
    /// chiave le tiene ([`crate::engines`]).
    pub(super) fn write_rich_in(
        &self,
        workspace: &Custody<Workspace>,
        codec: crate::rich::Codec,
        id: &DocId,
        source: &str,
        base: WriteBase,
        trace: &mut RichWrite,
    ) -> Result<Revision, PluginError> {
        let _turn = workspace.write_turn();
        let current = {
            let ws = workspace.read()?;
            fub_kernel::error::optional(ws.read_source_bytes(id)).map_err(PluginError::from)?
        };
        let revision = current.as_deref().map(Revision::of_bytes);
        trace.overwritten = Some(revision.clone());
        if let Some(want) = base.expected() {
            if revision.as_ref() != Some(want) {
                return Err(PluginError::from(fub_kernel::KernelError::Stale(
                    id.to_string(),
                )));
            }
        }
        trace.left.extend(revision.iter().cloned());
        let bytes = match current.as_deref() {
            None => crate::rich::create(codec, id, source, &mut trace.left)?,
            Some(current) => match crate::rich::save(codec, id, current, source)? {
                crate::rich::Save::Unchanged => return Ok(Revision::of_bytes(current)),
                crate::rich::Save::Bytes(bytes) => bytes,
            },
        };
        Self::write_bytes_in(workspace, id, &bytes, revision)
    }

    /// Scrive il giornale `source` di una cartella di Excel.
    ///
    /// Come per la videoscrittura, tutto dentro il turno di scrittura: i byte
    /// su cui la shell ha lavorato si leggono e si confrontano con la base, il
    /// provider della griglia registrato innesta il giornale fuori dal
    /// lucchetto, e i byte nuovi passano dal CAS della stessa revisione. Una
    /// voce in conflitto scrive il suo input: la base dice che la shell l'ha
    /// mostrata su questi byte. Un giornale vuoto, o tutto già applicato, non
    /// scrive niente.
    pub(super) fn write_workbook_in(
        &self,
        workspace: &Custody<Workspace>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        let _turn = workspace.write_turn();
        let journal = crate::workbook::journal(id, source)?;
        let surface = crate::workbook::surface(id)?;
        let (current, call) = {
            let ws = workspace.read()?;
            let current =
                fub_kernel::error::optional(ws.read_source_bytes(id)).map_err(PluginError::from)?;
            let call = if journal.is_empty() {
                None
            } else {
                Some(ws.prepare_grid_bytes_call(surface)?)
            };
            (current, call)
        };
        let Some(current) = current else {
            return Err(crate::workbook::missing(id));
        };
        let revision = Revision::of_bytes(&current);
        if let Some(want) = base.expected() {
            if want != &revision {
                return Err(PluginError::from(fub_kernel::KernelError::Stale(
                    id.to_string(),
                )));
            }
        }
        let Some(call) = call else {
            return Ok(revision);
        };
        crate::workbook::check(id, &current)?;
        let session = call.open(surface, &current, revision.clone(), &journal)?;
        let bytes = call.bytes_to_write(&session.instance, session.revision);
        // L'istanza serviva soltanto a questo salvataggio: si chiude anche
        // quando l'innesto fallisce, e un errore di chiusura non cambia l'esito.
        let _ = call.close(&session.instance);
        let bytes = bytes?;
        if bytes == current {
            return Ok(revision);
        }
        Self::write_bytes_in(workspace, id, &bytes, Some(revision))
    }

    /// [`Host::write_document_bytes`] sul workspace già risolto.
    pub(super) fn write_bytes_in(
        workspace: &Custody<Workspace>,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        let _turn = workspace.write_turn();
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_document_bytes_write(id, expected)
                .map_err(PluginError::from)?
        };
        let model = prepared.parse(bytes).map_err(PluginError::from)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut detached = JobHost::new(workspace.clone(), hook.owner());
            hook.invoke(&mut detached)
        });
        // Il disco si scrive fuori dal prestito esclusivo e sotto il turno
        // (IMP-1805): la CAS resta quella preparata, e il prestito serve solo
        // alle tabelle.
        let placed = prepared
            .place(bytes, before_write)
            .map_err(PluginError::from)?;
        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_placed_document_bytes_write(placed, model)
        };
        let pending = pending.invoke_indexes();
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_document_write_deferred(pending)
        };
        finish_events(workspace, deferred)
    }

    /// Scrive sul vault già risolto dal chiamante. Le operazioni composte
    /// (come il ripristino di una versione) usano questa porta per non
    /// risolvere due volte il vault corrente fra lettura e scrittura.
    pub(super) fn write_document_in(
        &self,
        workspace: Custody<Workspace>,
        id: &DocId,
        source: &str,
        base: WriteBase,
        trace: &mut RichWrite,
    ) -> Result<Revision, PluginError> {
        let _turn = workspace.write_turn();
        let format = workspace.read()?.format_of(id);
        if let Some(codec) = crate::rich::codec(format.as_ref()) {
            return self.write_rich_in(&workspace, codec, id, source, base, trace);
        }
        // Il testo di una cartella è il suo giornale, e scriverlo è innestarlo.
        if crate::workbook::is_workbook(format.as_ref()) {
            return self.write_workbook_in(&workspace, id, source, base);
        }
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_document_write(id, base)
                .map_err(PluginError::from)?
        };
        let model = prepared.parse(source).map_err(PluginError::from)?;
        let before_write = prepared.before_write().try_for_each(|hook| {
            let mut detached = JobHost::new(workspace.clone(), hook.owner());
            hook.invoke(&mut detached)
        });
        // Il disco si scrive fuori dal prestito esclusivo e sotto il turno
        // (IMP-1805): la CAS resta quella preparata, e il prestito serve solo
        // alle tabelle.
        let placed = prepared
            .place(source, before_write)
            .map_err(PluginError::from)?;
        let pending = {
            let mut ws = workspace.write()?;
            ws.commit_placed_document_write(placed, model)
        };
        let pending = pending.invoke_indexes();
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_document_write_deferred(pending)
        };
        finish_events(&workspace, deferred)
    }

    /// Scrive la bozza di un documento **senza il turno di scrittura** (#485).
    ///
    /// La bozza esiste per coprire il tempo in cui il disco non ha ancora il
    /// testo: se aspettasse il turno, aspetterebbe proprio il salvataggio lento
    /// che deve coprire, e un crash in quei secondi perderebbe l'ultimo testo.
    /// Le bozze non toccano lo stato del workspace, quindi se ne prende la porta
    /// con un prestito condiviso e la si usa dopo averlo lasciato; l'ordine fra
    /// le bozze di un documento lo tiene la coda delle bozze della shell.
    pub fn save_draft(
        &self,
        vault: Option<&str>,
        id: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> Result<(), PluginError> {
        self.draft_port(vault)?
            .save(id, text, base)
            .map_err(|error| PluginError::Internal(format!("draft not written: {error}").into()))
    }

    /// Butta la bozza di un documento, senza il turno come [`Self::save_draft`].
    pub fn discard_draft(&self, vault: Option<&str>, id: &DocId) -> Result<(), PluginError> {
        self.draft_port(vault)?
            .discard(id)
            .map_err(|error| PluginError::Internal(format!("draft not discarded: {error}").into()))
    }

    /// La porta delle bozze del vault, presa con un prestito condiviso breve:
    /// i reader non guardano il turno, quindi un salvataggio in volo non la
    /// ferma se non nei tratti in cui tiene il workspace in esclusiva.
    pub(super) fn draft_port(
        &self,
        vault: Option<&str>,
    ) -> Result<fub_kernel::drafts::DraftPort, PluginError> {
        let workspace = self.session_workspace(vault)?;
        let port = workspace.read()?.draft_port();
        Ok(port)
    }

    pub fn set_active_context(
        &self,
        vault: Option<&str>,
        context: Option<ViewContext>,
    ) -> Result<Vec<String>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.set_active_context(context)))
    }
}
