use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::DocumentModel;
use fub_abi::FormatProvider;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher, PreparedFormatSource};

struct ProbeProvider {
    id: &'static str,
    ext: &'static str,
    marker: &'static str,
}

impl FormatProvider for ProbeProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text(self.id, self.id, &[self.ext])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        _source: &DocumentSource,
        context: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(fub_abi::model::DocId::new(context.doc_id.clone()));
        model.text = self.marker.to_owned();
        Ok(model)
    }

    fn render_html(
        &self,
        _model: &DocumentModel,
        _options: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(self.marker.to_owned())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

struct DropProbe(Arc<AtomicUsize>);

impl Drop for DropProbe {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

fn vault() -> (tempfile::TempDir, camino::Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("temporary vault");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
    (dir, root)
}

#[test]
fn prepared_provider_is_used_by_normal_format_selection() {
    let (_dir, root) = vault();
    std::fs::write(root.join("note.txt"), "source ignored by probe\n").expect("seed document");
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_format_source(Arc::new(|| {
            Ok(PreparedFormatSource::from_provider(Box::new(
                ProbeProvider {
                    id: "test.probe",
                    ext: "txt",
                    marker: "prepared-provider-selected",
                },
            )))
        }));

    host.open(&root).expect("vault opens");
    host.wait_indexed(None).expect("indexing completes");
    let workspace = host.debug_workspace(None).expect("workspace is published");
    let model = workspace
        .read()
        .expect("workspace read")
        .read_model(&fub_abi::model::DocId::new("note.txt"))
        .expect("probe parsed note");
    assert_eq!(model.text, "prepared-provider-selected");
}

#[test]
fn source_error_does_not_publish_workspace_or_session() {
    let (_dir, root) = vault();
    let host =
        Host::new().with_format_source(Arc::new(|| Err(PluginError::Io("source failed".into()))));

    assert!(matches!(host.open(&root), Err(PluginError::Io(_))));
    assert!(host.vaults().is_empty());
    assert!(host.with_session(None, |_| ()).is_err());
}

#[test]
fn a_conflicting_provider_is_refused_alone_and_the_vault_opens() {
    let (_dir, root) = vault();
    std::fs::write(root.join("nota.txt"), "testo").expect("a text note");
    let dropped = Arc::new(AtomicUsize::new(0));
    let first_dropped = Arc::clone(&dropped);
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_format_source(Arc::new(move || {
            Ok(PreparedFormatSource::from_provider(Box::new(ProbeProvider {
                id: "test.canvas",
                ext: "canvas",
                marker: "canvas",
            }))
            .with_provider(Box::new(ProbeProvider {
                id: "test.first",
                ext: "txt",
                marker: "first",
            }))
            .with_provider(Box::new(ProbeProvider {
                id: "test.second",
                ext: "txt",
                marker: "second",
            }))
            .retain(DropProbe(Arc::clone(&first_dropped)))
            .retain(DropProbe(Arc::clone(&first_dropped))))
        }));

    host.open(&root)
        .expect("a conflicting provider does not take the vault down");
    let diagnostics: Vec<String> = host
        .startup_diagnostics(None)
        .expect("the vault is open")
        .iter()
        .map(ToString::to_string)
        .collect();
    for (challenger, incumbent) in [("test.canvas", "canvas"), ("test.second", "test.first")] {
        assert!(
            diagnostics
                .iter()
                .any(|message| message.contains(challenger) && message.contains(incumbent)),
            "the refusal names `{challenger}` and who keeps the extension: {diagnostics:?}"
        );
    }
    host.wait_indexed(None).expect("indexing completes");
    let model = host
        .debug_workspace(None)
        .expect("workspace is published")
        .read()
        .expect("workspace read")
        .read_model(&fub_abi::model::DocId::new("nota.txt"))
        .expect("the note parses");
    assert_eq!(
        model.text, "first",
        "the first claimant keeps the extension"
    );
    assert_eq!(dropped.load(Ordering::SeqCst), 0);

    host.close_vault(&root).expect("vault closes");
    assert_eq!(
        dropped.load(Ordering::SeqCst),
        2,
        "the prepared resources live until the vault closes"
    );
}

#[test]
fn retained_format_resource_lives_until_vault_close() {
    let (_dir, root) = vault();
    let dropped = Arc::new(AtomicUsize::new(0));
    let resource_dropped = Arc::clone(&dropped);
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_format_source(Arc::new(move || {
            Ok(PreparedFormatSource::from_provider(Box::new(ProbeProvider {
                id: "test.retained",
                ext: "retained",
                marker: "retained-resource",
            }))
            .retain(DropProbe(Arc::clone(&resource_dropped))))
        }));

    host.open(&root).expect("vault opens");
    assert_eq!(dropped.load(Ordering::SeqCst), 0);

    host.close_vault(&root).expect("vault closes");
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
}
