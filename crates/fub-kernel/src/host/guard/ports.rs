//! Il guard davanti a ogni porta dell'host: lettura, scrittura, struttura, dati, impostazioni, comandi.

use super::*;

impl<H: VaultRead, P: Policy> VaultRead for Guard<H, P> {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading `{id}`")
        })?;
        self.inner.read_document(id)
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        // Stesso permesso della lettura di testo, e non uno suo: vedi la firma
        // nel contratto — i byte non sono un grado di fiducia in più.
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading bytes of `{id}`")
        })?;
        self.inner.read_document_bytes(id)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading revision of `{id}`")
        })?;
        self.inner.document_revision(id)
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.check(Capability::VaultRead, || "listing documents".into())?;
        let mut page = self.inner.list_documents(page)?;
        let before = page.items.len();
        page.items.retain(|id| {
            self.policy
                .denies_path(Capability::VaultRead, id.as_str())
                .is_none()
        });
        if page.items.len() != before {
            page.total = page.items.len() as u32;
        }
        Ok(page)
    }

    fn free_name(&self, id: &DocId) -> DocId {
        // Senza esito: la risposta nulla è l'id che è stato passato — «nessun
        // nome è noto come libero». Chi lo usa per creare riceve comunque un
        // rifiuto da `create_document`, che un esito ce l'ha.
        if self.allows_path(Capability::VaultRead, id.as_str()) {
            self.inner.free_name(id)
        } else {
            id.clone()
        }
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading model of `{id}`")
        })?;
        self.inner.read_model(id)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        // Senza esito: `None` qui significa già «nessuno lo rivendica», ed è la
        // risposta nulla più vicina al vero che questa firma sappia dare.
        self.allows_path(Capability::VaultRead, id.as_str())
            .then(|| self.inner.format_of(id))
            .flatten()
    }

    fn format_link(&self, doc: &DocId, link: &LinkInsert) -> Result<Option<String>, PluginError> {
        self.check_path(Capability::VaultRead, doc.as_str(), || {
            format!("asking the format of `{doc}` for a link")
        })?;
        self.inner.format_link(doc, link)
    }

    /// Il piano legge i documenti che linkano `from`, che possono essere
    /// ovunque nel vault: serve la lettura di tutto il vault, come la
    /// riscrittura dei backlink di una rinomina chiede la scrittura di tutto.
    fn link_retarget_edits(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Vec<PlannedEdit>, PluginError> {
        self.check_path(Capability::VaultRead, "", || {
            format!("planning the links of `{from}` onto `{to}`")
        })?;
        self.inner.link_retarget_edits(from, to)
    }

    fn task_state_edit(
        &self,
        doc: &DocId,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        self.check_path(Capability::VaultRead, doc.as_str(), || {
            format!("asking the format of `{doc}` for a task edit")
        })?;
        self.inner.task_state_edit(doc, marker, done)
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.check(Capability::VaultRead, || "listing trash".into())?;
        let entries = self
            .inner
            .list_trash()?
            .into_iter()
            .filter(|entry| {
                self.policy
                    .denies_path(Capability::VaultRead, entry.original.as_str())
                    .is_none()
            })
            .collect();
        Ok(entries)
    }
}

impl<H: VaultWrite, P: Policy> VaultWrite for Guard<H, P> {
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.check_path(Capability::VaultWrite, id.as_str(), || {
            format!("writing `{id}`")
        })?;
        self.inner.write_document(id, source, base)
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.check_path(Capability::VaultWrite, id.as_str(), || {
            format!("editing `{id}`")
        })?;
        self.inner.apply_edit(id, request)
    }

    fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        // Stessa famiglia della scrittura testuale: i byte non sono un grado
        // di fiducia in più — vedi `read_document_bytes` sopra.
        self.check_path(Capability::VaultWrite, id.as_str(), || {
            format!("writing bytes of `{id}`")
        })?;
        self.inner.write_document_bytes(id, bytes, expected)
    }
}

impl<H: VaultStructure, P: Policy> VaultStructure for Guard<H, P> {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, id.as_str(), || {
            format!("creating `{id}`")
        })?;
        self.inner.create_document(id, source)
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, from.as_str(), || {
            format!("renaming `{from}`")
        })?;
        self.check_path(Capability::VaultStructure, to.as_str(), || {
            format!("renaming to `{to}`")
        })?;
        self.check_path(Capability::VaultWrite, "", || {
            format!("rewriting backlinks after renaming `{from}`")
        })?;
        self.inner.rename_document(from, to)
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.check_path(Capability::VaultStructure, id.as_str(), || {
            format!("trashing `{id}`")
        })?;
        self.inner.trash_document(id)
    }

    fn trash_document_if(&mut self, id: &DocId, expected: &Revision) -> Result<DocId, PluginError> {
        self.check_path(Capability::VaultStructure, id.as_str(), || {
            format!("trashing `{id}`")
        })?;
        self.inner.trash_document_if(id, expected)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.check(Capability::VaultStructure, || {
            format!("restoring `{entry}`")
        })?;
        // La voce si risolve dal cestino anche con una destinazione
        // esplicita: è sulla sua origine che la regola giudica.
        let (_, target) = authorize_restore(&self.policy, entry, to.as_ref(), || {
            self.list_trash()?
                .into_iter()
                .find(|candidate| &candidate.id == entry)
                .ok_or_else(|| PluginError::NotFound(entry.to_string().into()))
        })?;
        self.inner.restore_document(entry, Some(target))
    }
    fn create_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, folder, || {
            format!("creating folder `{folder}`")
        })?;
        self.inner.create_folder(folder)
    }
    fn remove_empty_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, folder, || {
            format!("removing folder `{folder}`")
        })?;
        self.inner.remove_empty_folder(folder)
    }
    fn migrate_folder_organization(&mut self, from: &str, to: &str) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, from, || {
            format!("moving folder `{from}`")
        })?;
        self.check_path(Capability::VaultStructure, to, || {
            format!("moving folder to `{to}`")
        })?;
        self.inner.migrate_folder_organization(from, to)
    }
    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.check_path(Capability::VaultStructure, "", || "emptying trash".into())?;
        self.inner.empty_trash()
    }
}

impl<H: DataRead, P: Policy> DataRead for Guard<H, P> {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.check(Capability::DataRead, || format!("reading blob `{path}`"))?;
        self.inner.data_read(path)
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.check(Capability::DataRead, || "listing blobs".into())?;
        self.inner.data_list(prefix)
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.check(Capability::DataRead, || {
            format!("reading cache blob `{path}`")
        })?;
        self.inner.cache_read(path)
    }
}

impl<H: DataWrite, P: Policy> DataWrite for Guard<H, P> {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || format!("writing blob `{path}`"))?;
        self.inner.data_write(path, bytes)
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || format!("removing blob `{path}`"))?;
        self.inner.data_remove(path)
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || {
            format!("writing cache blob `{path}`")
        })?;
        self.inner.cache_write(path, bytes)
    }
}

impl<H: SettingsRead, P: Policy> SettingsRead for Guard<H, P> {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.check(Capability::SettingsRead, || {
            format!("reading setting `{key}`")
        })?;
        self.inner.setting(key)
    }
}

impl<H: SettingsWrite, P: Policy> SettingsWrite for Guard<H, P> {
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("writing setting `{key}`")
        })?;
        self.inner.set_setting(key, value)
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("resetting setting `{key}`")
        })?;
        self.inner.reset_setting(key)
    }
}

impl<H: ViewStateRead, P: Policy> ViewStateRead for Guard<H, P> {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        self.check(Capability::ViewStateRead, || {
            format!("re-reading view state `{key}`")
        })?;
        self.inner.view_state(key)
    }
}

impl<H: ViewStateWrite, P: Policy> ViewStateWrite for Guard<H, P> {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.check(Capability::ViewStateWrite, || {
            format!("writing view state `{key}`")
        })?;
        self.inner.set_view_state(key, value)
    }
}

impl<H: HostEnv, P: Policy> HostEnv for Guard<H, P> {
    fn now_unix_millis(&self) -> u64 {
        // Senza esito. Zero è l'epoca UNIX: una data che nessun vault contiene
        // e che chi la stampa riconosce, invece di un tempo plausibile e falso.
        if self.allows(Capability::Env) {
            self.inner.now_unix_millis()
        } else {
            0
        }
    }

    fn user_locale(&self) -> Locale {
        // Senza esito. Il locale di default è già la risposta del contratto per
        // «nessuno me l'ha detto»: lingua indeterminata, UTC, ISO 8601. Chi non
        // ha la capacità riceve quindi ciò che riceverebbe un host senza shell,
        // non un locale plausibile e falso.
        if self.allows(Capability::Env) {
            self.inner.user_locale()
        } else {
            Locale::default()
        }
    }

    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        // L'unico dei quattro che ha un esito, e l'unico che ne aveva bisogno.
        // Rendeva il vuoto — che è ancora, come diceva la 0039, meglio di byte
        // fissi che collidono — ma il vuoto è una *politica travestita da dato*:
        // arrivava a chi chiama indistinguibile dal troncamento sopra il tetto,
        // e i due si correggono in modi opposti (chiedere meno serve nel primo
        // caso, non serve a niente nel secondo). Adesso il rifiuto dice anche
        // PERCHÉ, che è ciò che il `Guard` sa e nessun'altra risposta poteva
        // portare (decisione 0094).
        self.check(Capability::Env, || format!("requesting {n} random bytes"))?;
        self.inner.random_bytes(n)
    }

    fn active_context(&self) -> Option<ViewContext> {
        // **Il solo metodo del `Guard` con due cancelli**, e li ha perché
        // pubblica due cose dell'utente che si concedono separatamente
        // (decisione 0095). Senza `Session` non c'è contesto; con `Session` e
        // senza `SessionSelection` c'è il contesto e non il testo.
        //
        // Senza esito, quindi il rifiuto è muto in entrambi i casi, e in
        // entrambi la risposta nulla è già una frase del dominio: `None` = «la
        // shell non ne ha ancora pubblicato uno», `selections: None` = «nessun
        // cursore» (modalità di lettura, o nessun documento). Non è la risposta
        // *vera* — questo è il punto in cui si va oltre il criterio della 0094 —
        // ma chi la riceve sa da sé perché la riceve: **è nel proprio
        // manifest**, e un permesso che non si è dichiarato non è una sorpresa
        // che arriva a tempo d'esecuzione.
        let mut context = self
            .allows(Capability::Session)
            .then(|| self.inner.active_context())
            .flatten()?;
        if context.doc.as_ref().is_some_and(|doc| {
            self.policy
                .denies_path(Capability::Session, doc.as_str())
                .is_some()
        }) {
            return None;
        }
        if context
            .doc
            .as_ref()
            .is_none_or(|doc| !self.allows_path(Capability::SessionSelection, doc.as_str()))
        {
            context.selections = None;
        }
        Some(context)
    }
}

impl<H: HostEvents, P: Policy> HostEvents for Guard<H, P> {
    fn emit(&mut self, event: Event) {
        // Senza esito: il silenzio è il no. Un `DocumentChanged` emesso da una
        // simulazione farebbe ricaricare l'editor su una modifica che non è
        // avvenuta.
        if self.allows(Capability::Events) {
            self.inner.emit(event);
        }
    }

    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.check(Capability::Events, || "spawning a job".into())?;
        self.inner.spawn_job(spec)
    }
}

impl<H: HostQuery, P: Policy> HostQuery for Guard<H, P> {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let cap = authorize_query(&self.policy, &query.kind())?;
        let result = self.inner.query_index(query)?;
        Ok(filter_query_result(&self.policy, cap, result))
    }
}

/// Applica lo stesso cancello di [`Guard`] a un piano che deve essere eseguito
/// fuori dalla guardia del workspace. È pubblico perché il composition root
/// stacca la callback, non perché esista una seconda politica.
pub fn authorize_query<P: Policy>(
    policy: &P,
    kind: &fub_abi::traits::QueryKind,
) -> Result<Capability, PluginError> {
    let (cap, what) = Guard::<(), P>::query_capability(kind);
    match policy.denies(cap) {
        None => Ok(cap),
        Some(why) => Err(PluginError::PermissionDenied(
            format!("{what}: {why}").into(),
        )),
    }
}

/// Il cancello di [`HostServices::run_export`], condiviso fra il [`Guard`] e
/// chi stacca l'export dal workspace.
///
/// Il provider legge con le proprie capacità, attraverso un host di sola
/// lettura; chi chiede riceve però i byte di ciò che la selezione nomina,
/// quindi la domanda è la **sua** lettura: ogni documento nominato, la
/// cartella, o il vault intero (più l'interrogazione) quando la selezione è
/// una query. Non serve [`Capability::Services`]: un export non scrive.
pub fn authorize_export<P: Policy>(
    policy: &P,
    request: &fub_abi::transfer::ExportRequest,
) -> Result<(), PluginError> {
    use fub_abi::transfer::ExportSelection;
    let what = || format!("exporting to `{}`", request.target);
    match &request.selection {
        ExportSelection::Documents(ids) => {
            for id in ids {
                authorize_path(policy, Capability::VaultRead, id.as_str(), what)?;
            }
        }
        ExportSelection::Folder(folder) => {
            authorize_path(policy, Capability::VaultRead, folder, what)?;
        }
        ExportSelection::Query(query) => {
            authorize_path(policy, Capability::VaultRead, "", what)?;
            authorize_query(policy, &query.kind())?;
        }
    }
    Ok(())
}

/// Il cancello di [`HostServices::run_import`]: chi chiede deve poter
/// scrivere nella cartella di destinazione, o leggerla per un'anteprima.
///
/// Un import vero chiede anche [`Capability::Services`], per la stessa ragione
/// di [`call_service`](HostServices::call_service): il provider scrive con le
/// capacità di chi lo ha registrato. Un'anteprima no, perché chi la esegue le
/// passa l'host della chiamata, e in una simulazione quell'host non scrive.
pub fn authorize_import<P: Policy>(
    policy: &P,
    source: &fub_abi::transfer::ImportSource,
    request: &fub_abi::transfer::ImportRequest,
) -> Result<(), PluginError> {
    let what = || format!("importing `{}`", source.name);
    match request.mode {
        fub_abi::transfer::ImportMode::Apply => {
            authorize_path(policy, Capability::Services, "", what)?;
            authorize_path(policy, Capability::VaultWrite, &request.folder, what)
        }
        fub_abi::transfer::ImportMode::Preview => {
            authorize_path(policy, Capability::VaultRead, &request.folder, what)
        }
    }
}

/// Rifinisce una risposta con le regole dipendenti dalla politica. Oggi la
/// sola è il recinto delle bozze; tenerla qui impedisce che il percorso
/// staccato e il `Guard` imparino due semantiche diverse.
pub fn filter_query_result<P: Policy>(
    policy: &P,
    cap: Capability,
    result: IndexResult,
) -> IndexResult {
    if cap == Capability::Drafts {
        if let IndexResult::Drafts(mut page) = result {
            let before = page.items.len();
            page.items.retain(|draft| {
                policy
                    .denies_path(Capability::Drafts, draft.doc.as_str())
                    .is_none()
            });
            if page.items.len() != before {
                page.total = page.items.len() as u32;
            }
            return IndexResult::Drafts(page);
        }
    }
    result
}

impl<H, P: Policy> Guard<H, P> {
    /// Quale famiglia governa **questa** domanda, e cosa si stava facendo.
    ///
    /// Il `match` è **esaustivo di proposito**, e senza un `_`: una famiglia di
    /// query nuova non compila finché qualcuno non ha detto sotto quale
    /// permesso passa. Con un ramo di scarto la variante nuova sarebbe
    /// atterrata su [`Capability::Query`] restando verde — che è esattamente il
    /// modo in cui [`IndexQuery::Drafts`] ci è atterrata, e ci è restata per
    /// otto verbali.
    ///
    /// È anche il primo punto in cui il `Guard` legge un **argomento** e non
    /// solo il metodo. Non spacca il canale dati della
    /// [0019](../../../../docs/decisions/0182-provider-e-porte-generiche.md) — resta una
    /// domanda sola con un instradamento solo — e non allarga la [`Policy`],
    /// che continua a rispondere a nomi e a non sapere niente di query: è la
    /// stessa mossa di `undo_last`, che da un metodo ricava più famiglie perché
    /// più d'una sono le cose che fa.
    pub(super) fn query_capability(
        kind: &fub_abi::traits::QueryKind,
    ) -> (Capability, &'static str) {
        use fub_abi::traits::QueryKind;
        match kind {
            QueryKind::Drafts => (Capability::Drafts, "reading drafts"),
            QueryKind::Documents
            | QueryKind::Backlinks
            | QueryKind::Outline
            | QueryKind::Tags
            | QueryKind::Neighbors
            | QueryKind::PropertyValues
            | QueryKind::VaultHealth
            | QueryKind::Custom(_)
            | QueryKind::VaultStatus
            | QueryKind::Jobs
            | QueryKind::Settings
            | QueryKind::Organization
            | QueryKind::Resolve
            | QueryKind::Entries
            | QueryKind::Folders
            | QueryKind::RenderPreview
            | QueryKind::RenderEmbed
            | QueryKind::RenderPrint
            | QueryKind::SyntaxForms => (Capability::Query, "querying the index"),
        }
    }
}

impl<H: HostCommands, P: Policy> HostCommands for Guard<H, P> {
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.check(Capability::Commands, || format!("invoking `{command}`"))?;
        self.inner.run_command(command, args)
    }

    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError> {
        // **Due cancelli**, e non è pignoleria. Annullare è invocare — i passi
        // di un annullamento sono per metà comandi — ma è anche, sempre e per
        // definizione, **scrivere**: e ciò che scrive non passa dal recinto del
        // chiamante, perché a eseguirlo è il kernel. Senza il secondo un host di
        // sola lettura avrebbe una scala per riscrivere il vault, e un plugin
        // senza `write-vault` un modo di disfare il lavoro di qualcuno.
        //
        // # Il secondo cancello non è più largo di quello che ha ammesso l'operazione
        //
        // Chiedeva [`Capability::VaultWrite`] e basta, cioè *il testo di un
        // documento*, mentre i passi che sta per far girare disfano ciò che una
        // rinomina, una creazione o un cestinamento avevano fatto — e quelle
        // sono passate da [`Capability::VaultStructure`]. Chi aveva il permesso
        // per una sola delle due famiglie disfaceva anche l'altra: il cancello
        // dell'annullamento era più largo di quello dell'operazione, il che è il
        // solo modo in cui un recinto può perdere restando scritto.
        //
        // La specie **qui non si sa**, e non è una svista di questa riga: la
        // pila è privata del kernel (vedi
        // [`HostCommands::undo_last`](fub_abi::traits::HostCommands::undo_last)),
        // il `Guard` sta davanti a un host e non dentro, e la voce in cima la
        // vede solo chi la esegue. Non sapendo quale delle due sia, si chiedono
        // **tutte e due**: un cancello che indovina è un cancello che sbaglia
        // metà delle volte, e la metà in cui sbaglia lascia passare. Il prezzo è
        // per chi avesse una delle due famiglie e non l'altra — che oggi non è
        // nessuno, perché `write-vault` le concede insieme
        // ([`Capability::permission`]) e `ReadOnly` le nega insieme.
        //
        // L'elenco non è scritto qui: lo dà [`Capability::writes_the_vault`], il
        // cui `match` esaustivo obbliga una famiglia nuova a dichiararsi. Così
        // il giorno che il vault avesse una terza specie di scrittura, questo
        // cancello la eredita senza che nessuno se ne debba ricordare.
        // L'undo non nomina un documento: uno scope di path non può quindi
        // provarne la copertura e deve fallire chiuso prima di avviare il replay.
        self.check(Capability::Commands, || "undoing".into())?;
        for cap in Capability::ALL.into_iter().filter(|c| c.writes_the_vault()) {
            self.check(cap, || "undoing".into())?;
        }
        authorize_path(&self.policy, Capability::VaultWrite, "", || {
            "undoing".into()
        })?;
        self.inner.undo_last()
    }
}

impl<H: TransferRead, P: Policy> TransferRead for Guard<H, P> {
    /// Un cancello solo: *dove* qui non si pone, perché un handle non nomina un
    /// posto che si possa scegliere — nomina la sorgente che l'host ha aperto.
    /// È la differenza con `fub:network`, che di cancelli ne ha due.
    fn read_source(
        &self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        self.check(Capability::Transfer, || "reading import source".to_string())?;
        self.inner.read_source(handle, offset, len)
    }
}

impl<H: HostServices, P: Policy> HostServices for Guard<H, P> {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.check(Capability::Services, || {
            format!("calling `{service}.{method}`")
        })?;
        self.inner.call_service(service, method, args)
    }

    fn export_targets(&self) -> Result<Vec<fub_abi::transfer::ExportTarget>, PluginError> {
        // Elencare le destinazioni non legge il vault: è il registro, come
        // l'elenco dei comandi.
        self.inner.export_targets()
    }

    fn run_export(
        &mut self,
        request: &fub_abi::transfer::ExportRequest,
    ) -> Result<fub_abi::transfer::ExportReport, PluginError> {
        authorize_export(&self.policy, request)?;
        self.inner.run_export(request)
    }

    fn run_import(
        &mut self,
        source: &fub_abi::transfer::ImportSource,
        request: &fub_abi::transfer::ImportRequest,
    ) -> Result<fub_abi::transfer::ImportReport, PluginError> {
        authorize_import(&self.policy, source, request)?;
        self.inner.run_import(source, request)
    }
}
