//! I comandi di import/export scelgono fra i provider che l'host ha
//! registrato, non fra una lista che il bundle degli importer si porta dietro.
//!
//! Il montaggio è quello vero, con un bundle in più che registra un importer
//! per `.zz` e un exporter con la destinazione `test.zz`. Se il job di
//! transfer consultasse ancora la sua lista statica, `import.prepare`
//! risponderebbe «nessun importer» e `export.run` «destinazione ignota».

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::model::DocId;
use fub_abi::traits::{HostApi, Plugin, PluginManifest, ReadApi};
use fub_abi::transfer::{
    ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportSelection, ExportTarget,
    ImportOutcome, ImportProvider, ImportReport, ImportRequest, ImportSource, ImportedDocument,
};
use fub_abi::PluginError;
use fub_host::registry::Registrar;
use fub_host::{Bundle, BundleClaim, Host, OnlyProviders, StartupBundle};
use fub_kernel::Trust;

const OWNER: &str = "test.zz";
const TARGET: &str = "test.zz";
const IMPORTERS: &str = "fub.importers";
const TRANSFER_JOB: &str = "import.transfer";

/// Un `.zz` è una nota di una riga: diventa `<nome>.md` con quella riga.
struct ZzImport;

impl ImportProvider for ZzImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        source.extension().as_deref() == Some("zz")
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = String::from_utf8(source.read_all(host)?)
            .map_err(|_| PluginError::BadArgs("not text".into()))?;
        let doc = DocId::new(format!("{}.md", source.stem().unwrap_or_default()));
        if request.mode == fub_abi::transfer::ImportMode::Apply {
            host.create_document(&doc, &format!("zz: {text}"))?;
        }
        Ok(ImportReport {
            mode: request.mode,
            documents: vec![ImportedDocument {
                doc,
                outcome: ImportOutcome::Created,
                entry: None,
            }],
            log: Vec::new(),
        })
    }
}

/// Un artefatto per documento selezionato, col suo testo.
struct ZzExport;

impl ExportProvider for ZzExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: TARGET.to_string(),
            name: "ZZ".to_string(),
            extension: Some("zz".to_string()),
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        let mut report = ExportReport::default();
        for doc in request.selection.resolve(host)? {
            let text = host.read_document(&doc)?;
            let handle = out.open_artifact(&format!("{doc}.zz"), "text/plain")?;
            out.write_artifact(handle, text.as_bytes())?;
            report.artifacts.push(out.close_artifact(handle)?);
        }
        Ok(report)
    }
}

struct ZzBundle;

impl Bundle for ZzBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, "ZZ")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        if let Err(error) = registrar.register_import_provider(Box::new(ZzImport)) {
            failures.push(error.to_string());
        }
        if let Err(error) = registrar.register_export_provider(Box::new(ZzExport)) {
            failures.push(error.to_string());
        }
        failures
    }
}

fn open(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf, Host) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (name, text) in files {
        std::fs::write(root.join(name), text).unwrap();
    }
    let bundles = vec![StartupBundle::new(
        Arc::new(ZzBundle),
        true,
        BundleClaim::new(),
    )];
    let host = Host::without_watcher().with_startup_source(Arc::new(bundles));
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    (dir, root, host)
}

#[test]
fn a_registered_importer_is_chosen_by_the_staged_import() {
    let (_dir, root, host) = open(&[]);
    let source = ImportSource::text_source("Kant.zz", "critica");
    let prepared = host
        .invoke_job(
            None,
            IMPORTERS,
            TRANSFER_JOB,
            serde_json::json!({
                "op": "prepare", "job": "zz", "source": source,
                "request": ImportRequest::apply(),
            }),
        )
        .expect("l'importer registrato riconosce la sorgente");
    assert_eq!(
        prepared["preview"]["documents"][0]["doc"], "Kant.md",
        "{prepared}"
    );
    assert!(!root.join("Kant.md").exists(), "l'anteprima non scrive");

    host.invoke_job(
        None,
        IMPORTERS,
        TRANSFER_JOB,
        serde_json::json!({"op": "commit", "job": "zz"}),
    )
    .expect("il commit riusa lo stesso importer");
    assert_eq!(
        std::fs::read_to_string(root.join("Kant.md")).unwrap(),
        "zz: critica"
    );
}

#[test]
fn a_registered_export_target_is_accepted_and_run() {
    let (_dir, _root, host) = open(&[("Nota.md", "# Nota\n")]);
    let request = ExportRequest::new(
        TARGET,
        ExportSelection::Documents(vec![DocId::new("Nota.md")]),
    );
    host.invoke_user_command(
        None,
        "export.run",
        serde_json::json!({"request_json": serde_json::to_string(&request).unwrap()}),
        InvokeMode::DryRun,
    )
    .expect("la destinazione registrata è nota al comando");

    let report = host
        .invoke_job(
            None,
            IMPORTERS,
            TRANSFER_JOB,
            serde_json::json!({"op": "export", "request": request}),
        )
        .expect("l'exporter registrato esporta");
    let report: ExportReport = serde_json::from_value(report).unwrap();
    assert_eq!(report.artifacts.len(), 1);
    assert_eq!(report.artifacts[0].path, "Nota.md.zz");
}

/// Il comando non si ferma alla prova: accoda davvero il job, e l'esito porta
/// l'artefatto. Dichiarato di sola lettura, girava su un host in simulazione e
/// il guardiano gli negava il job.
#[test]
fn export_run_queues_the_job_for_real() {
    let (_dir, _root, host) = open(&[("Nota.md", "# Nota\n")]);
    let events = host.subscribe(None).unwrap();
    let request = ExportRequest::new(
        TARGET,
        ExportSelection::Documents(vec![DocId::new("Nota.md")]),
    );
    host.invoke_user_command(
        None,
        "export.run",
        serde_json::json!({"request_json": serde_json::to_string(&request).unwrap()}),
        InvokeMode::Apply,
    )
    .expect("the export is queued");
    let result = loop {
        let notice = events
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("the job ends");
        if let fub_abi::Event::JobDone { job, result, .. } = notice.event {
            if job == TRANSFER_JOB {
                break result;
            }
        }
    };
    let report: ExportReport = serde_json::from_value(result.expect("the export runs")).unwrap();
    assert_eq!(report.artifacts[0].path, "Nota.md.zz");
}

#[test]
fn an_unknown_target_is_still_refused() {
    let (_dir, _root, host) = open(&[("Nota.md", "# Nota\n")]);
    let request = ExportRequest::new("nessuno.sa", ExportSelection::default());
    let refused = host.invoke_user_command(
        None,
        "export.run",
        serde_json::json!({"request_json": serde_json::to_string(&request).unwrap()}),
        InvokeMode::DryRun,
    );
    assert!(
        matches!(refused, Err(PluginError::BadArgs(_))),
        "{refused:?}"
    );
}

/// Il flusso della shell: `import.prepare` dice quale job ha accodato, e chi
/// aspetta riconosce il suo `job_done` dall'id e non da una frase. I byte
/// arrivano al job dallo spazio privato, non dentro il payload.
#[test]
fn prepare_and_commit_name_their_jobs_and_import_for_real() {
    let (_dir, root, host) = open(&[]);
    let events = host.subscribe(None).unwrap();
    let run = |command: &str, args: serde_json::Value| -> serde_json::Value {
        let outcome = host
            .invoke_user_command(None, command, args, InvokeMode::Apply)
            .unwrap_or_else(|e| panic!("{command}: {e}"));
        let fub_abi::command::CommandEffect::Custom { ns, payload } = outcome.effect else {
            panic!("{command}: l'esito porta il job");
        };
        assert_eq!(ns, "fub.transfer.queued");
        let id = payload["job_id"]
            .as_str()
            .expect("id come stringa")
            .to_owned();
        loop {
            let notice = events
                .recv_timeout(std::time::Duration::from_secs(30))
                .expect("the job ends");
            if let fub_abi::Event::JobDone {
                id: done, result, ..
            } = notice.event
            {
                if done.0.to_string() == id {
                    break result.unwrap_or_else(|e| panic!("{command}: {e}"));
                }
            }
        }
    };
    let source = ImportSource::text_source("Hegel.zz", "fenomenologia");
    let manifest = run(
        "import.prepare",
        serde_json::json!({
            "job": "shell-1",
            "source_json": serde_json::to_string(&source).unwrap(),
            "request_json": serde_json::to_string(&ImportRequest::apply()).unwrap(),
        }),
    );
    assert_eq!(
        manifest["preview"]["documents"][0]["doc"], "Hegel.md",
        "{manifest}"
    );
    assert!(!root.join("Hegel.md").exists(), "l'anteprima non scrive");
    run("import.commit", serde_json::json!({ "job": "shell-1" }));
    assert_eq!(
        std::fs::read_to_string(root.join("Hegel.md")).unwrap(),
        "zz: fenomenologia"
    );
    run("import.rollback", serde_json::json!({ "job": "shell-1" }));
    assert!(
        !root.join("Hegel.md").exists(),
        "il rollback toglie ciò che è entrato"
    );
}
