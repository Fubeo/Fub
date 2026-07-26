//! Un host in memoria per i test delle feature.
//!
//! Serve a provare le feature **contro il contratto** e non contro il kernel:
//! una feature scritta come la scriverebbe un plugin non deve avere altro modo
//! di toccare il mondo che l'[`HostApi`], e un doppio in memoria lo dimostra
//! meglio di un vault vero (i test e2e col kernel vero ci sono comunque, in
//! `tests/`).
//!
//! Il pezzo che conta è l'**orologio che si muove a comando**: è il guadagno di
//! aver messo il tempo nel contratto, e permette di invecchiare le fasce di
//! ritenzione del versioning senza piantare timestamp finti dentro lo store.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use fubmd_abi::command::CommandOutcome;
use fubmd_abi::edit::{EditReport, EditRequest, Revision};
use fubmd_abi::event::Event;
use fubmd_abi::format::DocumentFormat;
use fubmd_abi::model::{DocId, DocumentModel, Heading, Span};
use fubmd_abi::session::{PaneMode, Selection, ViewContext};
use fubmd_abi::traits::{
    BacklinkRef, HostApi, IndexQuery, IndexResult, JobId, JobSpec, Paged, TagCount, TrashEntry,
};
use fubmd_abi::PluginError;

/// Storage dei blob e dei documenti in memoria, più un orologio pilotabile.
#[derive(Default)]
pub struct MemoryHost {
    blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    docs: Mutex<BTreeMap<String, String>>,
    now: AtomicU64,
    /// Il contesto servito da [`HostApi::active_context`], come lo
    /// pubblicherebbe la shell.
    context: Mutex<Option<ViewContext>>,
    /// Backlink finti per [`HostApi::query_index`], seminati per target. Il
    /// doppio non ha un grafo: risponde solo a ciò che gli è stato messo dentro,
    /// ed è quanto basta a provare una view contro il contratto.
    backlinks: Mutex<BTreeMap<String, Vec<BacklinkRef>>>,
    /// Outline finti per [`HostApi::query_index`], seminati per documento: il
    /// doppio non parsa, come non parsa il kernel dietro `IndexQuery::Outline`.
    outlines: Mutex<BTreeMap<String, Vec<Heading>>>,
    /// Aggregazione dei tag finta per [`IndexQuery::Tags`].
    tags: Mutex<Vec<TagCount>>,
    /// Modelli finti per [`HostApi::read_model`], seminati per documento. Il
    /// doppio **non parsa** — come non parsa per l'outline — e la ragione è la
    /// stessa: un host in memoria che si portasse dentro un `FormatProvider`
    /// proverebbe la feature contro *quel* provider invece che contro il
    /// contratto. Chi vuole il parse vero ha i test end-to-end col kernel.
    models: Mutex<BTreeMap<String, DocumentModel>>,
    /// Formati finti per [`HostApi::format_of`], seminati per **estensione**
    /// senza il punto — che è la chiave con cui risponde anche il registro vero.
    formats: Mutex<BTreeMap<String, DocumentFormat>>,
    /// Il cestino: id nel cestino → (voce, sorgente). È in memoria come il
    /// resto, ma ha la stessa forma di quello vero — due id per voce, e il
    /// ripristino che rifiuta un path occupato — perché è quella forma che le
    /// feature provano.
    trash: Mutex<BTreeMap<String, (TrashEntry, String)>>,
    /// Contatore per timbrare le voci del cestino con id distinti.
    trashed: AtomicU64,
}

impl MemoryHost {
    pub fn new() -> Self {
        let host = MemoryHost::default();
        host.now.store(1_700_000_000_000, Ordering::Relaxed);
        host
    }

    /// Sposta l'orologio in avanti di `ms`.
    pub fn avanza(&self, ms: u64) {
        self.now.fetch_add(ms, Ordering::Relaxed);
    }

    /// Sposta l'orologio **indietro** di `ms`: è ciò che fa NTP, un cambio di
    /// fuso o una VM ripresa — e ciò contro cui il versioning deve difendersi.
    pub fn arretra(&self, ms: u64) {
        self.now.fetch_sub(ms, Ordering::Relaxed);
    }

    /// Aggiunge un documento al vault finto (stile builder).
    pub fn con_documento(self, id: &str, source: &str) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.to_string());
        self
    }

    /// Fa sparire un documento **senza emettere eventi**: è ciò che accade
    /// quando un `DocumentRemoved` va perso in un troncamento della coda.
    pub fn dimentica_documento(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }

    /// Sposta un documento **senza emettere eventi**: il rename perso.
    pub fn rinomina_di_nascosto(&self, from: &str, to: &str) {
        let mut docs = self.docs.lock().unwrap();
        if let Some(source) = docs.remove(from) {
            docs.insert(to.to_string(), source);
        }
    }

    /// Imposta il documento attivo, come farebbe la shell su una navigazione:
    /// pannello principale, nessuna selezione, modalità normale.
    pub fn set_active(&self, id: Option<&str>) {
        *self.context.lock().unwrap() =
            id.map(|id| ViewContext::new("main").with_doc(Some(DocId::new(id))));
    }

    /// Pubblica un contesto intero: è la forma con cui si provano le view che
    /// seguono la selezione o la modalità.
    pub fn set_context(&self, context: Option<ViewContext>) {
        *self.context.lock().unwrap() = context;
    }

    /// Sposta il cursore (senza testo selezionato) nel documento attivo.
    /// `None` = il buffer è sporco, quindi nessuno span sarebbe vero.
    pub fn set_caret(&self, byte: Option<usize>) {
        self.map_context(|c| {
            c.selection = Some(Selection::caret(byte.map(|b| Span::new(b, b))));
        });
    }

    /// Seleziona `text` a partire da `start` byte nel documento attivo.
    pub fn set_selection(&self, start: usize, text: &str) {
        self.map_context(|c| {
            c.selection = Some(Selection {
                span: Some(Span::new(start, start + text.len())),
                text: text.to_string(),
            });
        });
    }

    /// Cambia la modalità del pannello attivo.
    pub fn set_mode(&self, mode: PaneMode) {
        self.map_context(|c| c.mode = mode);
    }

    fn map_context(&self, f: impl FnOnce(&mut ViewContext)) {
        let mut ctx = self.context.lock().unwrap();
        let mut context = ctx.take().unwrap_or_else(|| ViewContext::new("main"));
        f(&mut context);
        *ctx = Some(context);
    }

    /// Semina i backlink che [`HostApi::query_index`] restituirà per `target`
    /// (stile builder).
    pub fn con_backlink(self, target: &str, sorgenti: &[&str]) -> Self {
        let refs = sorgenti
            .iter()
            .map(|s| BacklinkRef {
                source: DocId::new(*s),
                context: None,
            })
            .collect();
        self.backlinks
            .lock()
            .unwrap()
            .insert(target.to_string(), refs);
        self
    }

    /// Semina l'outline che [`HostApi::query_index`] restituirà per `doc`
    /// (stile builder).
    pub fn con_outline(self, doc: &str, headings: &[Heading]) -> Self {
        self.outlines
            .lock()
            .unwrap()
            .insert(doc.to_string(), headings.to_vec());
        self
    }

    /// Semina l'aggregazione dei tag che [`IndexQuery::Tags`] restituirà
    /// (stile builder): coppie nome→conteggio.
    pub fn con_tags(self, tags: &[(&str, u32)]) -> Self {
        *self.tags.lock().unwrap() = tags
            .iter()
            .map(|(name, count)| TagCount {
                name: name.to_string(),
                count: *count,
            })
            .collect();
        self
    }

    /// Semina il modello che [`HostApi::read_model`] restituirà per `doc`
    /// (stile builder).
    pub fn con_modello(self, doc: &str, model: DocumentModel) -> Self {
        self.models.lock().unwrap().insert(doc.to_string(), model);
        self
    }

    /// Semina il formato che [`HostApi::format_of`] restituirà per i documenti
    /// con questa estensione (stile builder).
    pub fn con_formato(self, ext: &str, format: DocumentFormat) -> Self {
        self.formats.lock().unwrap().insert(ext.to_string(), format);
        self
    }
}

impl HostApi for MemoryHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.docs
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::BadArgs(format!("{id} non esiste")))
    }

    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.to_string());
        Ok(())
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        Ok(Revision::of(&self.read_document(id)?))
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
        self.write_document(id, &next)?;
        Ok(report)
    }

    fn list_documents(&self) -> Result<Vec<DocId>, PluginError> {
        Ok(self.docs.lock().unwrap().keys().map(DocId::new).collect())
    }

    /// Il modello **seminato**, non uno parsato: un documento che esiste ma di
    /// cui nessuno ha seminato il modello risponde come uno che non esiste — chi
    /// prova una feature sul modello deve dire quale modello sta provando.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.models
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::Internal(format!("{id}: nessun modello seminato")))
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        let ext = id
            .as_str()
            .rsplit_once('.')
            .map(|(_, e)| e.to_lowercase())?;
        self.formats.lock().unwrap().get(&ext).cloned()
    }

    /// La convenzione D3 su ciò che questo host ha in memoria: `nome.md`,
    /// `nome 1.md`, … Nel kernel la stessa risposta guarda anche il disco
    /// (`Workspace::free_name`), che qui non c'è.
    fn free_name(&self, id: &DocId) -> DocId {
        let docs = self.docs.lock().unwrap();
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
            .find(|c| !docs.contains_key(c.as_str()))
            .expect("la sequenza dei candidati è infinita")
    }

    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        if self.docs.lock().unwrap().contains_key(id.as_str()) {
            return Err(PluginError::BadArgs(format!("{id} esiste già")));
        }
        self.write_document(id, source)
    }

    /// Sposta il sorgente e basta: questo doppio non ha un grafo, quindi non
    /// riscrive i backlink entranti. Che la rinomina *li* riscriva è una
    /// proprietà del kernel e si prova contro il kernel (`tests/`); qui si
    /// prova che una feature sappia chiederla.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        let mut docs = self.docs.lock().unwrap();
        if from == to {
            return Ok(());
        }
        if docs.contains_key(to.as_str()) {
            return Err(PluginError::BadArgs(format!("{to} esiste già")));
        }
        let source = docs
            .remove(from.as_str())
            .ok_or_else(|| PluginError::BadArgs(format!("{from} non esiste")))?;
        docs.insert(to.to_string(), source);
        Ok(())
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        let source = self.read_document(id)?;
        self.docs.lock().unwrap().remove(id.as_str());
        let stamp = self.trashed.fetch_add(1, Ordering::Relaxed);
        let trashed = DocId::new(format!(".trash/{id}.{stamp}"));
        self.trash.lock().unwrap().insert(
            trashed.to_string(),
            (
                TrashEntry {
                    id: trashed.clone(),
                    original: id.clone(),
                    deleted_at: self.now_unix_millis() / 1000,
                    size: source.len() as u64,
                },
                source,
            ),
        );
        Ok(trashed)
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        let trash = self.trash.lock().unwrap();
        let mut voci: Vec<TrashEntry> = trash.values().map(|(e, _)| e.clone()).collect();
        voci.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.id.cmp(&b.id)));
        Ok(voci)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        let (voce, source) = self
            .trash
            .lock()
            .unwrap()
            .get(entry.as_str())
            .cloned()
            .ok_or_else(|| PluginError::BadArgs(format!("{entry} non è nel cestino")))?;
        let target = to.unwrap_or(voce.original);
        self.create_document(&target, &source)?;
        self.trash.lock().unwrap().remove(entry.as_str());
        Ok(target)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        let mut trash = self.trash.lock().unwrap();
        let quante = trash.len() as u64;
        trash.clear();
        Ok(quante)
    }

    fn emit(&mut self, _event: Event) {}

    fn spawn_job(&mut self, _spec: JobSpec) -> Result<JobId, PluginError> {
        Ok(JobId(0))
    }

    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        Ok(self.blobs.lock().unwrap().get(path).cloned())
    }

    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        Ok(())
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.blobs.lock().unwrap().remove(path);
        Ok(())
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        // Semantica di *cartella*, come l'host vero (`KernelHost`), non di
        // prefisso testuale: un finto che si comporta diversamente dal vero è
        // una trappola che scatta il giorno che si cambia chiamante.
        Ok(self
            .blobs
            .lock()
            .unwrap()
            .keys()
            .filter(|k| prefix.is_empty() || k.starts_with(&format!("{prefix}/")))
            .cloned()
            .collect())
    }

    fn now_unix_millis(&self) -> u64 {
        self.now.load(Ordering::Relaxed)
    }

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
            IndexQuery::Tags { page } => Ok(IndexResult::Tags(Paged::window(
                self.tags.lock().unwrap().clone(),
                page,
            ))),
            // Il doppio non ha né indice né grafo né frontmatter: tutto il resto
            // è "non roba mia", che è la risposta che darebbe un provider vero.
            _ => Err(PluginError::BadArgs(
                "MemoryHost serve solo backlink, outline e tag seminati a mano".into(),
            )),
        }
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.context.lock().unwrap().clone()
    }

    /// Il doppio non ha un registro dei comandi: comporre comandi si prova
    /// contro il kernel, che è l'unico ad averlo. Rispondere `unknown-command`
    /// è la stessa risposta che darebbe l'host vero per un id inesistente, e
    /// non è un finto successo.
    fn run_command(
        &mut self,
        command: &str,
        _args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        Err(PluginError::UnknownCommand(command.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::format::{FormatCapabilities, FormatDescriptor};

    /// Il doppio risponde per **estensione**, che è la stessa chiave del
    /// registro vero: una feature che si prova qui e poi gira sul kernel deve
    /// trovare la stessa regola, o il doppio starebbe provando un'altra cosa.
    #[test]
    fn the_double_answers_the_format_by_extension_and_none_for_what_nobody_claims() {
        let host = MemoryHost::new().con_formato(
            "md",
            DocumentFormat {
                descriptor: FormatDescriptor::text("markdown", "Markdown", &["md"]),
                capabilities: FormatCapabilities::default(),
            },
        );

        let markdown = host
            .format_of(&DocId::new("Progetti/Nota.md"))
            .expect("`.md` è seminato");
        assert_eq!(markdown.descriptor.id, "markdown");
        assert!(
            host.format_of(&DocId::new("allegato.pdf")).is_none(),
            "nessuno rivendica `.pdf`: `none` è una risposta, non un errore"
        );
        assert!(
            host.format_of(&DocId::new("LICENSE")).is_none(),
            "un nome senza estensione non ha niente da chiedere al registro"
        );
    }

    /// Un modello non seminato è un errore, non un modello vuoto: chi prova una
    /// feature sul modello deve dire **quale** modello sta provando, o proverebbe
    /// il caso «documento vuoto» credendo di provare il proprio.
    #[test]
    fn the_double_refuses_to_invent_a_model_nobody_seeded() {
        let host = MemoryHost::new().con_documento("nota.md", "# c'è");
        let esito = host.read_model(&DocId::new("nota.md"));
        assert!(matches!(esito, Err(PluginError::Internal(msg)) if msg.contains("nota.md")));
    }
}
