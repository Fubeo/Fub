//! [`KernelHost`]: l'host che fa davvero le cose.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, InvokeMode};
use fub_abi::edit::{EditReport, EditRequest, Revision};
use fub_abi::format::DocumentFormat;
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::text::Text;
use fub_abi::traits::{
    DataRead, DataWrite, HostCommands, HostEnv, HostEvents, HostQuery, HostServices, IndexQuery,
    IndexResult, JobId, JobSpec, Page, Paged, SettingsRead, SettingsWrite, TrashEntry, VaultRead,
    VaultStructure, VaultWrite, ViewStateRead, ViewStateWrite,
};
use fub_abi::{Event, PluginError, Severity};

use crate::error::KernelError;
use crate::workspace::{collect_data_files, fenced_doc_id, new_doc_id, Workspace};

/// L'[`HostApi`](fub_abi::traits::HostApi) del kernel: chiamate dirette,
/// costo zero.
///
/// È l'unica implementazione che *fa* qualcosa — le altre due leggono di meno
/// ([`ReadHost`](super::ReadHost)) o rifiutano di più
/// ([`Guard`](super::Guard)) — e per questo è anche l'unica che vale la pena
/// scrivere per intero.
pub(crate) struct KernelHost<'a> {
    pub(crate) ws: &'a mut Workspace,
    /// Chi sta usando queste capacità: determina lo spazio dati `data_*`.
    pub(crate) plugin: &'a str,
    /// In che modo sta girando chi ha in mano questo host.
    ///
    /// Serve a una capacità sola — [`HostCommands::run_command`] — ed è ciò che
    /// impedisce a una simulazione di diventare reale invocando qualcuno. Fuori
    /// dal percorso dei comandi (dispatch di un evento, azione di una view,
    /// import) è [`InvokeMode::Apply`], che è la verità: lì non si sta
    /// simulando niente.
    pub(crate) mode: InvokeMode,
    /// L'esemplare di view per conto del quale si sta agendo (§11.2), se ce n'è
    /// uno. Lo timbra il workspace, non lo passa il provider.
    pub(crate) instance: Option<&'a str>,
}

impl KernelHost<'_> {
    /// Path assoluto di un blob: come `Workspace::plugin_data_path`, ma il
    /// nome vuoto non è la radice — è una richiesta malformata.
    fn data_blob(&self, rel: &str) -> Result<Utf8PathBuf, PluginError> {
        if rel.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        self.ws.plugin_data_path(self.plugin, rel)
    }

    /// Il secondo cancello della scrittura di un'impostazione (§11.1): il primo
    /// è il permesso e lo applica il [`Guard`](super::Guard), questo è la
    /// chiave e lo applica qui l'unico che ha lo schema davanti.
    fn program_writable(&self, key: &str) -> Result<(), PluginError> {
        match self.ws.setting_is_program_writable(key) {
            Some(true) => Ok(()),
            Some(false) => Err(PluginError::PermissionDenied(
                format!(
                    "l'impostazione `{key}` non si è dichiarata scrivibile da un \
                 programma: la cambia chi la sta guardando"
                )
                .into(),
            )),
            None => Err(PluginError::BadArgs(
                format!("nessuno ha dichiarato l'impostazione `{key}`").into(),
            )),
        }
    }
}

impl VaultRead for KernelHost<'_> {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.read_source(&id).map_err(PluginError::from)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.document_revision(&id).map_err(PluginError::from)
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        Ok(self.ws.documents_page(page))
    }

    fn free_name(&self, id: &DocId) -> DocId {
        self.ws.free_name(id)
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.read_model(&id).map_err(PluginError::from)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        // Nessun recinto da applicare: non si legge niente, e un id che esce dal
        // vault non ha comunque un formato da dichiarare — l'estensione di un
        // path che non nomina un documento è una domanda senza risposta, non un
        // varco.
        self.ws.format_of(id)
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.ws.list_trash().map_err(PluginError::from)
    }
}

impl VaultWrite for KernelHost<'_> {
    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        // Il recinto del vault, sul confine dei plugin e in un punto solo. Fino
        // alla decisione 0006 l'unico input esterno che diventava un `DocId` arrivava dai
        // comandi IPC, che lo sanitizzano; un `ImportProvider` invece nomina i
        // documenti a partire dal **nome di una sorgente**, cioè da una stringa
        // che l'utente non ha scritto (un'entrata di zip, un campo di JSON).
        // `../../.ssh/authorized_keys` non è un `DocId` fantasma: è una
        // scrittura fuori dal vault.
        let id = fenced_doc_id(id)?;
        self.ws
            .write_document(&id, source)
            .map_err(PluginError::from)
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.apply_edit(&id, request).map_err(PluginError::from)
    }
}

impl VaultStructure for KernelHost<'_> {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        // Due letture dello stesso nome, e sono due domande diverse (§15.5): il
        // recinto — sta dentro il vault? — e la portabilità, che vale solo perché
        // qui il nome **nasce**. Un `ImportProvider` che estrae un'entrata di zip
        // chiamata `aux.md` scriverebbe un file che su Windows non esiste, e lo
        // scoprirebbe chi sincronizza.
        let id = fenced_doc_id(id)?;
        let id = new_doc_id(id.as_str()).map_err(PluginError::from)?;
        // Il rifiuto È la capacità: `write_document` sovrascrive, e se questa
        // facesse lo stesso non ci sarebbe motivo di averla.
        if self.ws.is_taken(&id) {
            return Err(PluginError::from(KernelError::AlreadyExists(
                id.to_string(),
            )));
        }
        self.ws
            .write_document(&id, source)
            .map_err(PluginError::from)?;
        Ok(())
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let from = fenced_doc_id(from)?;
        let to = fenced_doc_id(to)?;
        self.ws
            .rename_document(&from, &to)
            .map_err(PluginError::from)
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.delete_document(&id).map_err(PluginError::from)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        // `entry` nomina un file **dentro** `.trash/`, non un documento del
        // vault: il recinto che vale qui è quello del cestino, e lo applica
        // `restore_from_trash` cercando la voce fra quelle che esistono — un id
        // che non è nel cestino è `NotFound`, non un path da spazzolare. Il
        // `to`, che invece atterra nel vault, lo valida il kernel.
        self.ws
            .restore_from_trash(entry, to)
            .map_err(PluginError::from)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.ws
            .empty_trash()
            .map(|n| n as u64)
            .map_err(PluginError::from)
    }
}

impl DataRead for KernelHost<'_> {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        let path = self.data_blob(path)?;
        match self.ws.storage().read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            // Mancare non è un errore: chi legge uno store vuoto lo scopre così.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}").into())),
        }
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        let root = self.ws.plugin_data_root(self.plugin);
        let dir = self.ws.plugin_data_path(self.plugin, prefix)?;
        let mut out = Vec::new();
        collect_data_files(self.ws.storage().as_ref(), &root, &dir, &mut out);
        out.sort_unstable();
        Ok(out)
    }
}

impl DataWrite for KernelHost<'_> {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        let path = self.data_blob(path)?;
        // Le cartelle che mancano le crea il supporto (§15.1): erano create
        // qui, e la stessa riga stava anche dentro `Vault::write`.
        self.ws
            .storage()
            .write(&path, bytes)
            .map_err(|e| PluginError::Internal(format!("{path}: {e}").into()))
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        let path = self.data_blob(path)?;
        match self.ws.storage().remove(&path) {
            Ok(()) => Ok(()),
            // Idempotente: cancellare ciò che non c'è è già il risultato voluto.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}").into())),
        }
    }
}

impl SettingsRead for KernelHost<'_> {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.ws.setting(key)
    }
}

impl ViewStateRead for KernelHost<'_> {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        Ok(self
            .instance
            .and_then(|instance| self.ws.view_state(self.plugin, instance, key)))
    }
}

impl ViewStateWrite for KernelHost<'_> {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        // Fuori da un esemplare è un **errore** e non un silenzio: leggere a
        // vuoto è il caso normale di chi non ha ancora salvato niente, scrivere
        // nel vuoto è invece qualcuno che crede di ricordare e non ricorderà.
        let instance = self.instance.ok_or_else(|| {
            PluginError::BadArgs(
                "lo stato di vista è di un esemplare di view: qui non se ne sta \
                 disegnando né servendo nessuno"
                    .into(),
            )
        })?;
        self.ws
            .set_view_state(self.plugin, instance, key, value)
            .map_err(|e| PluginError::Internal(e.into()))
    }
}

impl SettingsWrite for KernelHost<'_> {
    /// Scrive, **se la chiave si è dichiarata scrivibile da un programma**.
    ///
    /// Il cancello sta qui e non su [`Workspace::set_setting`], ed è la riga che
    /// separa le due autorità: da questo host passano i *programmi* — un
    /// comando, un plugin, una macro — mentre la persona davanti allo schermo
    /// passa dalla shell, che scrive sul workspace. È la stessa distinzione
    /// dell'origine (decisione 0012), applicata alla configurazione: un
    /// componente che potesse allargarsi i permessi da sé non ha permessi, e
    /// «da sé» vuol dire proprio *senza che nessuno abbia cliccato*.
    ///
    /// Il rifiuto nomina la chiave e dice cosa manca: chi scrive un plugin deve
    /// capire in un colpo che la chiave non è sua da toccare, non che ha
    /// sbagliato permesso.
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.program_writable(key)?;
        self.ws.set_setting(key, value)
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.program_writable(key)?;
        self.ws.reset_setting(key)
    }
}

impl HostEnv for KernelHost<'_> {
    fn now_unix_millis(&self) -> u64 {
        crate::time::now_unix_millis()
    }

    fn user_locale(&self) -> Locale {
        self.ws.locale()
    }

    fn random_bytes(&self, n: u32) -> Vec<u8> {
        crate::random::random_bytes(n)
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.ws.active_context().cloned()
    }
}

impl HostEvents for KernelHost<'_> {
    /// Emette, **se il topic è suo**.
    ///
    /// I topic degli `Event::Custom` sono uno degli otto spazi di nomi del
    /// §7.4, e l'unico senza un momento di registrazione in cui verificarli:
    /// avevano una convenzione scritta in un commento (`"<plugin-id>/<nome>"`)
    /// e nessuno che la imponesse, quindi un plugin poteva emettere sotto il
    /// nome di un altro e far reagire i suoi handler.
    ///
    /// Un topic altrui **non si emette**. Che il rifiuto sia un guasto e non un
    /// errore è il limite di questa firma — `emit` non ha esito, ed è l'unica
    /// capacità del contratto che non ne ha (vedi `crate::host`). Il canale giusto
    /// dove mandarlo c'è ([decisione 0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)),
    /// e adesso ci va: un plugin che ruba il topic di un altro è una cosa che
    /// l'utente ha il diritto di sapere — ma **senza** poterla dire a chi ha
    /// emesso, perché la firma non ha esito. Il guasto esce a nome dell'attore
    /// (`self.plugin`, decisione 0012), e il pavimento del log lo raccoglie
    /// comunque ([decisione 0062](../../../docs/decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)):
    /// ogni guasto lascia una riga, e questo racconta una perdita — un evento
    /// che qualcuno si aspettava di ricevere non è arrivato — quindi apre anche
    /// la porta.
    fn emit(&mut self, event: Event) {
        if let Event::Custom { topic, .. } = &event {
            if let Err(fault) = self.ws.owns_name(self.plugin, topic) {
                tracing::warn!(target: "fub.kernel", "evento non emesso: {fault}");
                self.ws.report_trouble(
                    Severity::Warning,
                    None,
                    PluginError::Internal(format!("evento non emesso: {fault}").into()),
                );
                return;
            }
        }
        self.ws.emit_event(event);
    }

    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        Ok(self.ws.enqueue_job(self.plugin, spec))
    }
}

impl HostQuery for KernelHost<'_> {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        // Stesso dispatch di `Workspace::query_index`: chi ha dichiarato la
        // rotta risponde. Una view vede esattamente ciò che vedrebbe il kernel.
        self.ws.query_index(query)
    }
}

impl HostCommands for KernelHost<'_> {
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        // Il modo è quello dell'host, non della chiamata: vedi `mode`.
        self.ws.invoke_command_nested(command, args, self.mode)
    }

    fn undo_last(&mut self) -> Result<Option<Text>, PluginError> {
        // In simulazione non si annulla: `Guard` lo nega già con la politica
        // `ReadOnly`, e qui c'è la seconda metà della stessa regola per quando
        // l'host gira senza politiche (il core, i banchi). Un annullamento
        // dentro un `dry-run` sarebbe la scala per uscire dalla simulazione, e
        // ci uscirebbe **scrivendo**.
        if self.mode.is_dry_run() {
            return Err(PluginError::PermissionDenied(
                "annullare: una simulazione non scrive".into(),
            ));
        }
        self.ws.undo_last()
    }
}

impl HostServices for KernelHost<'_> {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.ws.call_service(service, method, args)
    }
}
