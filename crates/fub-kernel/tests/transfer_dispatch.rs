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
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::{Event, EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::traits::{EventHandler, HostApi, ReadApi};
use fub_abi::transfer::{
    ArtifactSink, ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, ImportOutcome, ImportProvider, ImportReport, ImportRequest, ImportSource,
    ImportedDocument,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::SampleText;

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
        let text = source.text(host)?;
        let outcome = match host.write_document(&doc, &text, WriteBase::Dictated) {
            Ok(_) => ImportOutcome::Created,
            Err(and) => ImportOutcome::Failed(and.to_string()),
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
        host: &dyn ReadApi,
        _out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        let docs = request.selection.resolve(host)?;
        let list = docs
            .iter()
            .map(|d| d.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(ExportReport {
            artifacts: vec![ExportArtifact {
                path: "elenco.txt".into(),
                media_type: "text/plain".into(),
                content: fub_abi::transfer::ArtifactContent::Bytes(list.into_bytes()),
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
    registry
        .register(SampleText::by_extension("txt").boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in ["spia.csv", "spia.txt", "spia.handler", "spia"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
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
    )
    .expect("registrato");
    ws.register_import_provider(
        "spia.txt",
        Box::new(SpyImport {
            ext: "txt",
            log: log.clone(),
            writes: Some(DocId::new("nuova.txt")),
        }),
    )
    .expect("registrato");

    ws.import(
        &ImportSource::text_source("dati.txt", "contenuto"),
        &ImportRequest::apply(),
    )
    .expect("import");

    let seen = log.lock().unwrap().clone();
    assert_eq!(
        seen.iter().filter(|c| c.starts_with("can_handle")).count(),
        2,
        "l'interrogazione si ferma al primo sì: csv dice no, txt dice sì"
    );
    assert!(
        seen.contains(&"import:txt".to_string()) && !seen.contains(&"import:csv".to_string()),
        "chi ha detto no non viene importato: {seen:?}"
    );
    assert!(ws.documents().contains(&DocId::new("nuova.txt")));
}

#[test]
fn events_emitted_during_an_import_arrive_after_it_returns() {
    let (_g, mut ws) = workspace();
    let log: Log = Arc::default();

    ws.register_event_handler("spia.handler", Box::new(SpyHandler(log.clone())))
        .expect("registrato");
    ws.register_import_provider(
        "spia.txt",
        Box::new(SpyImport {
            ext: "txt",
            log: log.clone(),
            writes: Some(DocId::new("nuova.txt")),
        }),
    )
    .expect("registrato");

    ws.import(
        &ImportSource::text_source("dati.txt", "contenuto"),
        &ImportRequest::apply(),
    )
    .expect("import");

    let seen = log.lock().unwrap().clone();
    let emitted = seen.iter().position(|c| c == "emesso").expect("emesso");
    let delivered = seen
        .iter()
        .position(|c| c == "consegnato:import.finito")
        .expect("l'evento arriva, prima o poi");
    assert!(
        emitted < delivered,
        "un provider non è mai rientrato nella propria istanza: l'evento \
         emesso dentro `import` si consegna a chiamata tornata ({seen:?})"
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
    )
    .expect("registrato");

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
    ws.register_export_provider("spia", Box::new(SpyExport))
        .expect("registrato");

    let report = ws
        .export(&ExportRequest::new(
            "spia.elenco",
            ExportSelection::default(),
        ))
        .expect("export");

    assert_eq!(
        std::str::from_utf8(report.artifacts[0].as_bytes().expect("in memoria")).unwrap(),
        "esistente.txt",
        "la selezione si risolve con le sole capacità del contratto"
    );
}

// ---------------------------------------------------------------------------
// I byte fuori dal record (decisione 0102)
// ---------------------------------------------------------------------------

/// Un importer che la sorgente la legge **a pezzi**, e mai tutta insieme.
///
/// Serve a provare la cosa che la §23.6 chiedeva: che un provider possa
/// lavorare su una sorgente più grande della memoria che ha. Legge sedici byte
/// per volta di proposito — se il ciclo si fidasse di una lettura sola, o se il
/// prologo venisse scambiato per il contenuto, qui il documento entrerebbe
/// troncato invece che sbagliato, che è il modo peggiore di sbagliare.
struct ChunkedImporter {
    /// Quanti giri di lettura ha fatto: è il conto che dice se ha davvero
    /// letto a pezzi o se ha barato leggendo tutto in un colpo.
    rounds: Arc<Mutex<usize>>,
}

impl ImportProvider for ChunkedImporter {
    fn can_handle(&self, source: &ImportSource) -> bool {
        // Il dispatch guarda l'**assaggio**, non i byte: per una sorgente a
        // handle i byte non ci sono, e `can_handle` non ha un host con cui
        // andarseli a prendere.
        source.prologue().starts_with(b"FUB1")
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let mut text = Vec::new();
        let mut offset = 0u64;
        loop {
            let piece = host.read_source(handle_of(source), offset, 16)?;
            if piece.is_empty() {
                break;
            }
            *self.rounds.lock().unwrap() += 1;
            offset += piece.len() as u64;
            text.extend_from_slice(&piece);
        }
        let doc = request.destination("a-pezzi.txt");
        let text =
            String::from_utf8(text).map_err(|and| PluginError::BadArgs(and.to_string().into()))?;
        host.write_document(&doc, &text, WriteBase::Dictated)?;
        let mut report = ImportReport::new(request.mode);
        report.documents.push(ImportedDocument {
            doc,
            outcome: ImportOutcome::Created,
            entry: None,
        });
        Ok(report)
    }
}

fn handle_of(source: &ImportSource) -> fub_abi::transfer::SourceHandle {
    match &source.content {
        fub_abi::transfer::SourceContent::Streamed(s) => s.handle,
        fub_abi::transfer::SourceContent::Bytes(_) => {
            panic!("questo banco vuole una sorgente a handle")
        }
    }
}

#[test]
fn a_source_more_grande_of_the_record_enters_the_same() {
    let (_g, mut ws) = workspace();
    let rounds: Arc<Mutex<usize>> = Arc::default();
    ws.register_import_provider("spia.txt", Box::new(ChunkedImporter { rounds: rounds.clone() }))
        .expect("registrato");

    // Molto più lungo del pezzo che l'importer chiede, così i giri sono tanti.
    let content = format!("FUB1{}", "x".repeat(500));
    let source = ws
        .open_source(
            "grande.fub",
            None,
            Box::new(fub_kernel::transfer::MemorySource(
                content.clone().into_bytes(),
            )),
        )
        .expect("aperta");

    assert_eq!(
        source.len(),
        content.len() as u64,
        "la lunghezza si sa prima di leggere: è la differenza fra sfogliare e \
         tenere in memoria"
    );
    assert!(
        source.bytes().is_none(),
        "i byte non sono nel record, ed è tutto il punto della voce"
    );

    let report = ws.import(&source, &ImportRequest::apply()).expect("import");
    assert_eq!(report.documents.len(), 1);
    assert_eq!(
        ws.read_source(&DocId::new("a-pezzi.txt")).expect("scritto"),
        content,
        "ciò che è entrato è la sorgente INTERA, non il suo assaggio"
    );
    assert!(
        *rounds.lock().unwrap() > 30,
        "l'importer ha letto in {} giri: se fosse uno, la sorgente gli \
         sarebbe arrivata tutta in mano e questa voce non avrebbe fatto niente",
        rounds.lock().unwrap()
    );

    // La chiave vale finché chi l'ha aperta non la chiude — non finisce con la
    // chiamata — così preview e apply sono due giri sulla stessa sorgente.
    let second = ws.import(&source, &ImportRequest::preview());
    assert!(
        second.is_ok(),
        "chiudere la sorgente alla fine di un import costringerebbe a \
         riaprirla fra la preview e l'applicazione, cioè a rileggerla"
    );

    ws.close_source(handle_of(&source));
    assert!(
        matches!(
            ws.import(&source, &ImportRequest::apply()),
            Err(PluginError::BadArgs(_))
        ),
        "dopo la chiusura la chiave non è di nessuno: leggere è BadArgs, non \
         i byte di qualcun altro"
    );
}

#[test]
fn a_export_can_end_on_the_disk_instead_that_in_a_vec() {
    let (_g, mut ws) = workspace();
    ws.register_export_provider("spia", Box::new(SpyExport))
        .expect("registrato");

    let outside = tempfile::tempdir().expect("tempdir");
    let mut sink = fub_kernel::transfer::DirectorySink::new(outside.path());
    let report = ws
        .export_to(
            &ExportRequest::new("spia.elenco", ExportSelection::default()),
            &mut sink,
        )
        .expect("export");

    // `SpyExport` riempie il rapporto a mano e non passa dal sink: è la prova
    // che le due strade convivono, cioè che un provider scritto prima della
    // 0102 continua a funzionare senza sapere che il sink esiste.
    assert_eq!(report.artifacts.len(), 1);
    assert!(
        report.artifacts[0].as_bytes().is_some(),
        "chi non usa il sink resta con i byte nel rapporto"
    );
}

#[test]
fn whoever_pours_into_the_sink_receives_a_receipt_and_leaves_a_file() {
    let outside = tempfile::tempdir().expect("tempdir");
    let mut sink = fub_kernel::transfer::DirectorySink::new(outside.path());
    let h = sink
        .open_artifact("sotto/nota.md", "text/markdown")
        .expect("aperto");
    sink.write_artifact(h, b"prima ").expect("versato");
    sink.write_artifact(h, b"e poi").expect("versato");
    let received = sink.close_artifact(h).expect("chiuso");

    assert_eq!(
        received.len(),
        11,
        "il conto è dei byte passati, non promesso"
    );
    assert!(
        received.as_bytes().is_none(),
        "un artefatto versato non porta i byte nel rapporto: sono già dove \
         l'utente li voleva, e portarli sarebbe tenerli in memoria un'altra volta"
    );
    assert_eq!(
        std::fs::read_to_string(outside.path().join("sotto/nota.md")).expect("scritto"),
        "prima e poi",
        "le cartelle intermedie le crea l'host: un provider non conosce il disco"
    );
}
