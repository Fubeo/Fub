//! Il **protocollo** di import ed export, senza markdown in mezzo.
//!
//! Qui non si prova che un formato entri bene: si prova come il kernel sceglie
//! chi lo sa fare e cosa gli presta. Sotto esame ci sono le tre proprietà che
//! `transfer_e2e.rs` (nel crate markdown) non può vedere, perché lì c'è un
//! provider solo e fidato:
//!
//! 1. il dispatch dell'import è **il primo che riconosce**, e chi ha detto no
//!    non viene chiamato;
//! 2. gli eventi emessi dentro `import` arrivano **dopo** che la chiamata è
//!    tornata — la stessa semantica di consegna di `on_action` e `handle`, che
//!    a M5 il component model impone;
//! 3. il recinto del vault vale anche per un provider: un `DocId` che risale
//!    non è una scrittura fuori, è un `PermissionDenied`.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventMask, Notice};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{EventHandler, HostApi};
use fubmd_abi::transfer::{
    ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportSelection, ExportTarget,
    ImportOutcome, ImportProvider, ImportReport, ImportRequest, ImportSource, ImportedDocument,
};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Provider minimo: il documento è il suo testo.
struct PlainProvider;

impl FormatProvider for PlainProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "plain".into(),
            name: "Testo semplice (test)".into(),
            extensions: vec!["txt".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

type Log = Arc<Mutex<Vec<String>>>;

/// Un importer che riconosce una sola estensione e annota di essere stato
/// interpellato: è così che si vede chi il kernel chiama e chi no.
struct SpyImport {
    ext: &'static str,
    log: Log,
    /// Cosa scrive quando importa. `None` = non scrive (serve a provare che il
    /// dispatch avviene comunque).
    writes: Option<DocId>,
}

impl ImportProvider for SpyImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        self.log
            .lock()
            .unwrap()
            .push(format!("can_handle:{}", self.ext));
        source.extension().as_deref() == Some(self.ext)
    }

    fn import(
        &mut self,
        source: &ImportSource,
        _request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        self.log
            .lock()
            .unwrap()
            .push(format!("import:{}", self.ext));
        let mut report = ImportReport::new(_request.mode);
        let Some(doc) = self.writes.clone() else {
            return Ok(report);
        };
        let outcome = match host.write_document(&doc, source.text()?) {
            Ok(()) => ImportOutcome::Created,
            Err(e) => ImportOutcome::Failed(e.to_string()),
        };
        // Un evento emesso DENTRO la chiamata: gli handler lo devono vedere
        // dopo, non adesso.
        host.emit(Event::Custom {
            topic: "import.finito".into(),
            payload: serde_json::Value::Null,
        });
        self.log.lock().unwrap().push("emesso".into());
        report.documents.push(ImportedDocument {
            doc,
            outcome,
            entry: None,
        });
        Ok(report)
    }
}

/// Un exporter che restituisce i documenti che la selezione risolve, così il
/// test può guardare cosa il `ReadHost` gli fa vedere.
struct SpyExport;

impl ExportProvider for SpyExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: "spia.elenco".into(),
            name: "Elenco (test)".into(),
            extension: Some("txt".into()),
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn HostApi,
    ) -> Result<ExportReport, PluginError> {
        let docs = request.selection.resolve(host)?;
        let elenco = docs
            .iter()
            .map(|d| d.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(ExportReport {
            artifacts: vec![ExportArtifact {
                path: "elenco.txt".into(),
                media_type: "text/plain".into(),
                bytes: elenco.into_bytes(),
            }],
            log: Vec::new(),
        })
    }
}

/// Un handler che annota nello stesso giornale quando riceve un evento: è il
/// modo di vedere l'*ordine* fra la fine dell'import e la consegna.
struct SpyHandler(Log);

impl EventHandler for SpyHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let event = &notice.event;
        if let Event::Custom { topic, .. } = event {
            self.0.lock().unwrap().push(format!("consegnato:{topic}"));
        }
        Ok(())
    }
}

fn workspace() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("esistente.txt"), "ciao").unwrap();
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(PlainProvider));
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

#[test]
fn the_first_provider_that_claims_the_source_takes_it() {
    let (_g, mut ws) = workspace();
    let log: Log = Arc::default();

    ws.register_import_provider(
        "spia.csv",
        Box::new(SpyImport {
            ext: "csv",
            log: log.clone(),
            writes: None,
        }),
    );
    ws.register_import_provider(
        "spia.txt",
        Box::new(SpyImport {
            ext: "txt",
            log: log.clone(),
            writes: Some(DocId::new("nuova.txt")),
        }),
    );

    ws.import(
        &ImportSource::text_source("dati.txt", "contenuto"),
        &ImportRequest::apply(),
    )
    .expect("import");

    let visto = log.lock().unwrap().clone();
    assert_eq!(
        visto.iter().filter(|c| c.starts_with("can_handle")).count(),
        2,
        "l'interrogazione si ferma al primo sì: csv dice no, txt dice sì"
    );
    assert!(
        visto.contains(&"import:txt".to_string()) && !visto.contains(&"import:csv".to_string()),
        "chi ha detto no non viene importato: {visto:?}"
    );
    assert!(ws.documents().contains(&DocId::new("nuova.txt")));
}

#[test]
fn events_emitted_during_an_import_arrive_after_it_returns() {
    let (_g, mut ws) = workspace();
    let log: Log = Arc::default();

    ws.register_event_handler("spia.handler", Box::new(SpyHandler(log.clone())));
    ws.register_import_provider(
        "spia.txt",
        Box::new(SpyImport {
            ext: "txt",
            log: log.clone(),
            writes: Some(DocId::new("nuova.txt")),
        }),
    );

    ws.import(
        &ImportSource::text_source("dati.txt", "contenuto"),
        &ImportRequest::apply(),
    )
    .expect("import");

    let visto = log.lock().unwrap().clone();
    let emesso = visto.iter().position(|c| c == "emesso").expect("emesso");
    let consegnato = visto
        .iter()
        .position(|c| c == "consegnato:import.finito")
        .expect("l'evento arriva, prima o poi");
    assert!(
        emesso < consegnato,
        "un provider non è mai rientrato nella propria istanza: l'evento \
         emesso dentro `import` si consegna a chiamata tornata ({visto:?})"
    );
}

#[test]
fn a_provider_cannot_name_a_document_outside_the_vault() {
    let (_g, mut ws) = workspace();
    ws.register_import_provider(
        "spia.txt",
        Box::new(SpyImport {
            ext: "txt",
            log: Arc::default(),
            writes: Some(DocId::new("../fuori.txt")),
        }),
    );

    let report = ws
        .import(
            &ImportSource::text_source("dati.txt", "contenuto"),
            &ImportRequest::apply(),
        )
        .expect("l'import in sé è andato: è il documento a non essere entrato");

    assert!(
        matches!(&report.documents[0].outcome, ImportOutcome::Failed(why) if why.contains("path relativo")),
        "il recinto sta sul confine delle capacità, non nella buona fede del \
         provider: {:?}",
        report.documents[0].outcome
    );
    assert!(!std::path::Path::new(ws.root().as_str())
        .parent()
        .unwrap()
        .join("fuori.txt")
        .exists());
}

#[test]
fn an_export_sees_the_whole_world_through_a_read_only_host() {
    let (_g, mut ws) = workspace();
    ws.register_export_provider("spia", Box::new(SpyExport));

    let report = ws
        .export(&ExportRequest::new(
            "spia.elenco",
            ExportSelection::default(),
        ))
        .expect("export");

    assert_eq!(
        std::str::from_utf8(&report.artifacts[0].bytes).unwrap(),
        "esistente.txt",
        "la selezione si risolve con le sole capacità del contratto"
    );
}
