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
