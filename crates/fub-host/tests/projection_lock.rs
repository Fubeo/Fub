//! Le query locali `RenderPreview` e `RenderEmbed` di `Host` e `JobHost`
//! attraversano formato, sintassi e renderer senza una guardia di
//! `Custody<Workspace>` e non pubblicano fotografie ormai stantie.
//!
//! Non è un presidio per `ReadHost`/`KernelHost`, `read_model`, `format_of` o
//! `SyntaxForms`: quelle vie sono sotto-tranche distinte di `ARCH-001`.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{HostQuery, IndexQuery, IndexResult, PluginManifest};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::{FormatRegistry, Trust, Workspace};

const PLUGIN: &str = "fub.audit-projection-lock";
const CUSTOM_KIND: &str = "fub.audit-projection-lock:block";
const TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault(source: &str) -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note.md"), source).expect("seed note");
    Vault { _dir: dir, root }
}

fn preview() -> IndexQuery {
    IndexQuery::RenderPreview {
        doc: DocId::new("Note.md"),
    }
}

fn embed() -> IndexQuery {
    IndexQuery::RenderEmbed {
        page: "Note".into(),
        heading: None,
        block: None,
    }
}

fn assert_workspace_is_free(workspace: &Custody<Workspace>, callback: &str) {
    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    let mut read_progressed = false;
    let mut write_progressed = false;
    while std::time::Instant::now() < deadline && !(read_progressed && write_progressed) {
        let read = workspace.try_read();
        read_progressed |= read.is_some();
        drop(read);

        let write = workspace.try_write();
        write_progressed |= write.is_some();
        drop(write);
        std::thread::yield_now();
    }
    assert!(
        read_progressed,
        "{callback} held a write guard on Custody<Workspace>"
    );
    assert!(
        write_progressed,
        "{callback} held a read guard on Custody<Workspace>"
    );
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Parse,
    Render,
}

struct BlockingFormat {
    armed: Arc<AtomicBool>,
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl BlockingFormat {
    fn stop(&self, stage: Stage) -> Result<(), FormatError> {
        if !self.armed.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.entered
            .send(stage)
            .map_err(|_| FormatError::Render("projection probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| FormatError::Render("projection probe was not released".into()))
    }
}

impl FormatProvider for BlockingFormat {
    fn descriptor(&self) -> FormatDescriptor {
        MarkdownProvider::new().descriptor()
    }

    fn capabilities(&self) -> FormatCapabilities {
        MarkdownProvider::new().capabilities()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        context: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.stop(Stage::Parse)?;
        MarkdownProvider::new().parse(source, context)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        options: &RenderOptions,
    ) -> Result<String, FormatError> {
        self.stop(Stage::Render)?;
        MarkdownProvider::new().render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        MarkdownProvider::new().serialize(model)
    }
}

fn blocking_workspace(
    vault: &Vault,
) -> (
    Custody<Workspace>,
    Arc<AtomicBool>,
    mpsc::Receiver<Stage>,
    mpsc::SyncSender<()>,
) {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let armed = Arc::new(AtomicBool::new(false));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(BlockingFormat {
            armed: Arc::clone(&armed),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }))
        .expect("format registers");
    let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
    workspace.reindex().expect("workspace indexes");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Audit projection lock"),
            Trust::Core,
        )
        .expect("query caller declares");
    (
        Custody::new("the projection workspace", workspace),
        armed,
        entered_rx,
        release_tx,
    )
}

#[test]
fn job_host_releases_the_workspace_for_preview_and_embed_parse_and_render() {
    let vault = vault("# Note\n\nbody\n");
    let (workspace, armed, entered, release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    for query in [preview(), embed()] {
        let job = JobHost::new(workspace.clone(), PLUGIN);
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let call = std::thread::spawn(move || {
            let outcome = job.query_index(query);
            let _ = done_tx.send(outcome);
        });
        assert_eq!(
            entered.recv_timeout(TIMEOUT).expect("parse entered"),
            Stage::Parse
        );
        assert_workspace_is_free(&workspace, "FormatProvider::parse");
        release.send(()).expect("release parse");

        assert_eq!(
            entered.recv_timeout(TIMEOUT).expect("render entered"),
            Stage::Render
        );
        assert_workspace_is_free(&workspace, "FormatProvider::render_html");
        release.send(()).expect("release render");

        let outcome = done_rx
            .recv_timeout(TIMEOUT)
            .expect("projection query completes");
        call.join().expect("completed query thread does not panic");
        assert!(matches!(
            outcome,
            Ok(IndexResult::RenderPreview(_) | IndexResult::RenderEmbed(_))
        ));
    }
}

struct BlockingSyntax {
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl SyntaxRule for BlockingSyntax {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PLUGIN}:syntax"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-projection".into()],
            },
            order: 0,
            option: None,
            produces: vec![CUSTOM_KIND.into()],
        }
    }

    fn apply(
        &self,
        _: &SyntaxMatch,
        _: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        self.entered
            .send(Stage::Parse)
            .map_err(|_| FormatError::Parse("syntax probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| FormatError::Parse("syntax probe was not released".into()))?;
        Ok(Some(SyntaxProduct::Block {
            custom_kind: CUSTOM_KIND.into(),
            attrs: serde_json::Value::Null,
            blocks: Vec::new(),
        }))
    }
}

struct BlockingRenderer {
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl CustomRenderer for BlockingRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: format!("{PLUGIN}:renderer"),
            kinds: vec![CUSTOM_KIND.into()],
        }
    }

    fn render(&self, _: &CustomBlock, _: &RenderOptions) -> Result<CustomRendering, FormatError> {
        self.entered
            .send(Stage::Render)
            .map_err(|_| FormatError::Render("renderer probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(TIMEOUT)
            .map_err(|_| FormatError::Render("renderer probe was not released".into()))?;
        Ok(CustomRendering::Fallback)
    }
}

#[test]
fn host_releases_the_workspace_for_syntax_and_custom_rendering() {
    let vault = vault("```audit-projection\npayload\n```\n");
    let host = Arc::new(Host::new().with_watcher(Box::new(NoWatcher)));
    host.open(&vault.root).expect("host opens");
    host.wait_indexed(None).expect("host indexes");
    let workspace = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let (rendered_tx, rendered_rx) = mpsc::sync_channel(1);
    let (render_release_tx, render_release_rx) = mpsc::sync_channel(1);
    {
        let mut workspace = workspace.write().expect("workspace lives");
        workspace
            .register_plugin(
                PluginManifest::new(PLUGIN, "Audit projection lock"),
                Trust::Community,
            )
            .expect("plugin declares");
        workspace
            .register_syntax_rule(
                PLUGIN,
                Box::new(BlockingSyntax {
                    entered: entered_tx,
                    release: Mutex::new(release_rx),
                }),
            )
            .expect("syntax registers");
        workspace
            .register_custom_renderer(
                PLUGIN,
                Box::new(BlockingRenderer {
                    entered: rendered_tx,
                    release: Mutex::new(render_release_rx),
                }),
            )
            .expect("renderer registers");
    }

    let query_host = Arc::clone(&host);
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = query_host.query_index(None, preview());
        let _ = done_tx.send(outcome);
    });
    assert_eq!(
        entered_rx.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Parse
    );
    assert_workspace_is_free(&workspace, "SyntaxRule::apply");
    release_tx.send(()).expect("release syntax");

    assert_eq!(
        rendered_rx
            .recv_timeout(TIMEOUT)
            .expect("custom renderer entered"),
        Stage::Render
    );
    assert_workspace_is_free(&workspace, "CustomRenderer::render");
    {
        let mut workspace = workspace.write().expect("workspace is free");
        assert!(
            workspace
                .deactivate_plugin(PLUGIN)
                .expect("renderer owner retires")
                .is_empty(),
            "the renderer owner has no lifecycle errors"
        );
    }
    render_release_tx.send(()).expect("release renderer");

    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("host projection completes");
    call.join()
        .expect("completed host query thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));
    assert!(matches!(
        host.query_index(None, preview()),
        Ok(IndexResult::RenderPreview(_))
    ));
}

#[test]
fn a_projection_of_a_changed_document_is_rejected_as_stale() {
    let vault = vault("# Before\n");
    let (workspace, armed, entered, release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = job.query_index(preview());
        let _ = done_tx.send(outcome);
    });
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    std::fs::write(vault.root.join("Note.md"), "# After\n").expect("concurrent write");
    release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("render entered"),
        Stage::Render
    );
    release.send(()).expect("release render");

    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("stale document projection completes");
    call.join()
        .expect("completed stale document query thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));
    armed.store(false, Ordering::SeqCst);
    assert!(matches!(
        JobHost::new(workspace, PLUGIN).query_index(preview()),
        Ok(IndexResult::RenderPreview(_))
    ));
}

#[test]
fn a_projection_of_a_removed_document_is_rejected_as_stale() {
    let vault = vault("# Before\n");
    let (workspace, armed, entered, release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = job.query_index(preview());
        let _ = done_tx.send(outcome);
    });
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    std::fs::remove_file(vault.root.join("Note.md")).expect("concurrent removal");
    release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("render entered"),
        Stage::Render
    );
    release.send(()).expect("release render");

    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("removed document projection completes");
    call.join()
        .expect("completed removed document query thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));

    armed.store(false, Ordering::SeqCst);
    std::fs::write(vault.root.join("Note.md"), "# Restored\n").expect("restore note");
    assert!(matches!(
        JobHost::new(workspace, PLUGIN).query_index(preview()),
        Ok(IndexResult::RenderPreview(_))
    ));
}

struct PassiveRenderer;

impl CustomRenderer for PassiveRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: format!("{PLUGIN}:later-renderer"),
            kinds: vec![format!("{PLUGIN}:later-kind")],
        }
    }

    fn render(&self, _: &CustomBlock, _: &RenderOptions) -> Result<CustomRendering, FormatError> {
        Ok(CustomRendering::Fallback)
    }
}

#[test]
fn a_projection_from_a_changed_pipeline_is_rejected_as_stale() {
    let vault = vault("# Before\n");
    let (workspace, armed, entered, release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let job = JobHost::new(workspace.clone(), PLUGIN);

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = job.query_index(preview());
        let _ = done_tx.send(outcome);
    });
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("render entered"),
        Stage::Render
    );
    {
        let mut workspace = workspace.write().expect("workspace is free");
        workspace
            .register_custom_renderer(PLUGIN, Box::new(PassiveRenderer))
            .expect("pipeline changes");
    }
    release.send(()).expect("release render");

    let outcome = done_rx
        .recv_timeout(TIMEOUT)
        .expect("stale pipeline projection completes");
    call.join()
        .expect("completed stale pipeline query thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));
    armed.store(false, Ordering::SeqCst);
    assert!(matches!(
        JobHost::new(workspace, PLUGIN).query_index(preview()),
        Ok(IndexResult::RenderPreview(_))
    ));
}

struct FailsOnce {
    calls: AtomicUsize,
    panic: bool,
}

impl FormatProvider for FailsOnce {
    fn descriptor(&self) -> FormatDescriptor {
        MarkdownProvider::new().descriptor()
    }

    fn capabilities(&self) -> FormatCapabilities {
        MarkdownProvider::new().capabilities()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        context: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        MarkdownProvider::new().parse(source, context)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        options: &RenderOptions,
    ) -> Result<String, FormatError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            if self.panic {
                panic!("intentional format render panic");
            }
            return Err(FormatError::Render(
                "intentional format render error".into(),
            ));
        }
        MarkdownProvider::new().render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        MarkdownProvider::new().serialize(model)
    }
}

fn assert_format_render_recovers(panic: bool) {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let vault = vault("# Note\n");
        let mut formats = FormatRegistry::new();
        formats
            .register(Box::new(FailsOnce {
                calls: AtomicUsize::new(0),
                panic,
            }))
            .expect("format registers");
        let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
        workspace.reindex().expect("workspace indexes");
        workspace
            .register_core_feature(PLUGIN, "Audit projection panic")
            .expect("query caller declares");
        let workspace = Custody::new("the projection workspace", workspace);
        let job = JobHost::new(workspace.clone(), PLUGIN);

        let first = job.query_index(preview());
        let message = match first {
            Err(PluginError::Internal(message)) => message,
            other => panic!("the first format render must fail, got {other:?}"),
        };
        if panic {
            let message = message.to_string();
            assert!(
                message.contains("`markdown`")
                    && message.contains("parsando `Note.md`")
                    && message.contains("intentional format render panic"),
                "the format-provider boundary names owner, document and panic: {message}"
            );
        } else {
            assert!(
                message
                    .to_string()
                    .contains("intentional format render error"),
                "the ordinary format error must propagate unchanged: {message}"
            );
        }
        assert_workspace_is_free(&workspace, "panicking FormatProvider::render_html");
        assert!(matches!(
            job.query_index(preview()),
            Ok(IndexResult::RenderPreview(_))
        ));
        let _ = done_tx.send(());
    });

    done_rx
        .recv_timeout(TIMEOUT)
        .expect("error cleanup and recovery complete before the timeout");
    call.join()
        .expect("completed recovery thread does not panic");
}

#[test]
fn a_format_render_error_propagates_and_the_next_projection_works() {
    assert_format_render_recovers(false);
}

#[test]
fn a_format_render_panic_is_contained_and_the_next_projection_works() {
    assert_format_render_recovers(true);
}
