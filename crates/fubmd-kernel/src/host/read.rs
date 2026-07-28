//! [`ReadHost`]: il percorso di lettura, che non ha le altre capacità.

use fubmd_abi::edit::Revision;
use fubmd_abi::format::DocumentFormat;
use fubmd_abi::locale::Locale;
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::session::ViewContext;
use fubmd_abi::settings::SettingValue;
use fubmd_abi::traits::{
    DataRead, HostEnv, HostQuery, IndexQuery, IndexResult, Page, Paged, SettingsRead, TrashEntry,
    VaultRead, ViewStateRead,
};
use fubmd_abi::PluginError;

use crate::workspace::{collect_data_files, fenced_doc_id, Workspace};

/// L'host del percorso di **lettura** (`Workspace::render_view`, l'export):
/// presta `&Workspace`, non `&mut`.
///
/// Esiste perché una lettura deve poter girare sotto prestito condiviso — è il
/// carico che il futuro `RwLock` parallelizza — e un
/// [`KernelHost`](super::KernelHost) è per costruzione un prestito esclusivo.
///
/// **Implementa cinque famiglie e non le altre sette**, e prima del §7.1 non
/// era così: implementava l'`HostApi` intero, e le dodici capacità che non
/// poteva servire erano altrettanti `unreachable!()` con sopra un commento che
/// spiegava perché nessuno ci sarebbe arrivato. Il commento diceva il vero e
/// non era un tipo: adesso lo è, e chi riceve questo host lo riceve come
/// [`ReadApi`](fubmd_abi::traits::ReadApi) — dove le capacità di scrittura non
/// ci sono affatto.
pub(crate) struct ReadHost<'a> {
    pub(crate) ws: &'a Workspace,
    pub(crate) plugin: &'a str,
    /// L'esemplare di view per conto del quale si sta leggendo (§11.2), se ce
    /// n'è uno. Lo timbra il workspace, non lo passa il provider.
    pub(crate) instance: Option<&'a str>,
}

impl VaultRead for ReadHost<'_> {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.read_source(&id).map_err(PluginError::from)
    }

    /// Leggere una revisione è una lettura: una view che prepara una modifica
    /// (calcolare gli edit è la parte lunga) può farlo mentre disegna, e
    /// consegnarla poi da `on_action`, dove l'host sa scrivere.
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

    /// Il modello è una **lettura**, quindi arriva anche di qui: è ciò che
    /// permette a una view di guardare la struttura del documento che sta
    /// disegnando senza chiedere all'app di passargliela.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        self.ws.read_model(&id).map_err(PluginError::from)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        self.ws.format_of(id)
    }

    /// Elencare il cestino è una lettura: un pannello "cestino" è una view, e
    /// una view disegna dal percorso di render.
    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.ws.list_trash().map_err(PluginError::from)
    }
}

impl DataRead for ReadHost<'_> {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        if path.is_empty() {
            return Err(PluginError::BadArgs("nome del blob vuoto".into()));
        }
        let path = self.ws.plugin_data_path(self.plugin, path)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PluginError::Internal(format!("{path}: {e}").into())),
        }
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        let root = self.ws.plugin_data_root(self.plugin);
        let dir = self.ws.plugin_data_path(self.plugin, prefix)?;
        let mut out = Vec::new();
        collect_data_files(&root, &dir, &mut out);
        out.sort_unstable();
        Ok(out)
    }
}

/// Rileggere lo stato di vista è una **lettura**, e questo è il percorso che
/// serve davvero: una view rilegge il proprio scroll — o le sezioni che aveva
/// collassato — mentre si disegna, cioè da sotto il prestito condiviso, che è
/// esattamente il momento in cui le serve.
///
/// `instance` a `None` (nessun esemplare: non si sta disegnando una view) torna
/// `None` e non un errore, come dichiara il contratto: chi non sta disegnando
/// per conto di un'istanza non ha uno stato di vista da rileggere.
impl ViewStateRead for ReadHost<'_> {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        Ok(self
            .instance
            .and_then(|instance| self.ws.view_state(self.plugin, instance, key)))
    }
}

/// Leggere la configurazione è una **lettura**, e sta qui per il caso che l'ha
/// fatta nascere: una view che disegna diversamente a seconda di come è
/// configurata — il pannello di una feature che mostra ciò che quella feature
/// ha acceso — deve poterlo chiedere mentre disegna, cioè da sotto il prestito
/// condiviso.
impl SettingsRead for ReadHost<'_> {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.ws.setting(key)
    }
}

impl HostEnv for ReadHost<'_> {
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

impl HostQuery for ReadHost<'_> {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.ws.query_index(query)
    }
}
