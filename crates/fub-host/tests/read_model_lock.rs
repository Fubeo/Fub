//! Il modello letto da un [`JobHost`] viene parsato senza una guardia di
//! `Custody<Workspace>`. Le interrogazioni sui metadati (`format_of` e
//! `SyntaxForms`) usano invece la fotografia presa quando il formato viene
//! registrato e non richiamano il provider da un workspace già montato.
//!
//! `FormatProvider` e `SyntaxRule` non ricevono un `HostApi`: la prova di
//! re-entry non è applicabile a questi due trait. La prova osservabile è la
//! disponibilità, durante le callback, di entrambe le guardie della custodia.

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
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::options::{permission, syntax};
use fub_abi::traits::{
    HostQuery, IndexQuery, IndexResult, PluginManifest, PluginPermissions, VaultRead,
};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, JobHost};
use fub_kernel::{FormatRegistry, Trust, Workspace};

const PLUGIN: &str = "fub.audit-model-lock";
const CUSTOM_KIND: &str = "fub.audit-model-lock:block";
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
    Syntax,
}

struct BlockingFormat {
    armed: Arc<AtomicBool>,
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
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
        if self.armed.load(Ordering::SeqCst) {
            self.entered
                .send(Stage::Parse)
                .map_err(|_| FormatError::Parse("model probe receiver disappeared".into()))?;
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(TIMEOUT)
                .map_err(|_| FormatError::Parse("model probe was not released".into()))?;
        }
        MarkdownProvider::new().parse(source, context)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        options: &RenderOptions,
    ) -> Result<String, FormatError> {
        MarkdownProvider::new().render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        MarkdownProvider::new().serialize(model)
    }
}

struct BlockingSyntax {
    armed: Arc<AtomicBool>,
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl SyntaxRule for BlockingSyntax {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PLUGIN}:syntax"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-model".into()],
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
        if self.armed.load(Ordering::SeqCst) {
            self.entered
                .send(Stage::Syntax)
                .map_err(|_| FormatError::Parse("syntax probe receiver disappeared".into()))?;
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(TIMEOUT)
                .map_err(|_| FormatError::Parse("syntax probe was not released".into()))?;
        }
        Ok(Some(SyntaxProduct::Block {
            custom_kind: CUSTOM_KIND.into(),
            attrs: serde_json::Value::Null,
            blocks: Vec::new(),
        }))
    }
}

fn blocking_workspace(
    vault: &Vault,
) -> (
    Custody<Workspace>,
    Arc<AtomicBool>,
    mpsc::Receiver<Stage>,
    mpsc::SyncSender<()>,
    mpsc::SyncSender<()>,
) {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (parse_release_tx, parse_release_rx) = mpsc::sync_channel(1);
    let (syntax_release_tx, syntax_release_rx) = mpsc::sync_channel(1);
    let armed = Arc::new(AtomicBool::new(false));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(BlockingFormat {
            armed: Arc::clone(&armed),
            entered: entered_tx.clone(),
            release: Mutex::new(parse_release_rx),
        }))
        .expect("format registers");
    let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Audit model lock"),
            Trust::Core,
        )
        .expect("model caller declares");
    workspace
        .register_syntax_rule(
            PLUGIN,
            Box::new(BlockingSyntax {
                armed: Arc::clone(&armed),
                entered: entered_tx,
                release: Mutex::new(syntax_release_rx),
            }),
        )
        .expect("syntax registers");
    (
        Custody::new("the model workspace", workspace),
        armed,
        entered_rx,
        parse_release_tx,
        syntax_release_tx,
    )
}

fn start_read(
    workspace: Custody<Workspace>,
) -> (
    std::thread::JoinHandle<()>,
    mpsc::Receiver<Result<DocumentModel, PluginError>>,
) {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = JobHost::new(workspace, PLUGIN).read_model(&DocId::new("Note.md"));
        let _ = done_tx.send(outcome);
    });
    (call, done_rx)
}

fn release_parse_and_syntax(
    workspace: &Custody<Workspace>,
    entered: &mpsc::Receiver<Stage>,
    parse_release: &mpsc::SyncSender<()>,
    syntax_release: &mpsc::SyncSender<()>,
) {
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    assert_workspace_is_free(workspace, "FormatProvider::parse");
    parse_release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Syntax
    );
    assert_workspace_is_free(workspace, "SyntaxRule::apply");
    syntax_release.send(()).expect("release syntax");
}

#[test]
fn job_host_releases_both_workspace_guards_for_model_parse_and_syntax() {
    let vault = vault("```audit-model\npayload\n```\n");
    let (workspace, armed, entered, parse_release, syntax_release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let (call, done) = start_read(workspace.clone());
    release_parse_and_syntax(&workspace, &entered, &parse_release, &syntax_release);
    let model = done
        .recv_timeout(TIMEOUT)
        .expect("model read completes")
        .expect("model read succeeds");
    call.join().expect("completed model thread does not panic");
    assert_eq!(model.id, DocId::new("Note.md"));
}

#[test]
fn a_model_from_a_changed_source_is_rejected_as_stale_and_the_workspace_is_reusable() {
    let vault = vault("```audit-model\nbefore\n```\n");
    let (workspace, armed, entered, parse_release, syntax_release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let (call, done) = start_read(workspace.clone());
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    std::fs::write(vault.root.join("Note.md"), "```audit-model\nafter\n```\n")
        .expect("concurrent source change");
    parse_release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Syntax
    );
    syntax_release.send(()).expect("release syntax");
    let outcome = done.recv_timeout(TIMEOUT).expect("stale read completes");
    call.join().expect("completed stale thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));

    armed.store(false, Ordering::SeqCst);
    assert!(JobHost::new(workspace, PLUGIN)
        .read_model(&DocId::new("Note.md"))
        .is_ok());
}

#[test]
fn a_model_from_a_removed_source_is_rejected_as_stale_and_the_workspace_is_reusable() {
    let vault = vault("```audit-model\nbefore\n```\n");
    let (workspace, armed, entered, parse_release, syntax_release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let (call, done) = start_read(workspace.clone());
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    std::fs::remove_file(vault.root.join("Note.md")).expect("concurrent source removal");
    parse_release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Syntax
    );
    syntax_release.send(()).expect("release syntax");
    let outcome = done.recv_timeout(TIMEOUT).expect("stale read completes");
    call.join().expect("completed stale thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));

    armed.store(false, Ordering::SeqCst);
    std::fs::write(
        vault.root.join("Note.md"),
        "```audit-model\nrestored\n```\n",
    )
    .expect("restore source");
    assert!(JobHost::new(workspace, PLUGIN)
        .read_model(&DocId::new("Note.md"))
        .is_ok());
}

struct LaterSyntax;

impl SyntaxRule for LaterSyntax {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PLUGIN}:later-syntax"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-later".into()],
            },
            order: 1,
            option: None,
            produces: vec![format!("{PLUGIN}:later-block")],
        }
    }

    fn apply(
        &self,
        _: &SyntaxMatch,
        _: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(None)
    }
}

#[test]
fn a_model_from_a_changed_syntax_pipeline_is_rejected_as_stale() {
    let vault = vault("```audit-model\npayload\n```\n");
    let (workspace, armed, entered, parse_release, syntax_release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let (call, done) = start_read(workspace.clone());
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    assert_workspace_is_free(
        &workspace,
        "FormatProvider::parse before syntax replacement",
    );
    workspace
        .write()
        .expect("workspace is free")
        .register_syntax_rule(PLUGIN, Box::new(LaterSyntax))
        .expect("syntax pipeline changes");
    parse_release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Syntax
    );
    syntax_release.send(()).expect("release syntax");
    let outcome = done.recv_timeout(TIMEOUT).expect("stale read completes");
    call.join().expect("completed stale thread does not panic");
    assert!(matches!(outcome, Err(PluginError::Conflict(_))));
}

struct LaterRenderer;

impl CustomRenderer for LaterRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: format!("{PLUGIN}:later-renderer"),
            kinds: vec![format!("{PLUGIN}:later-block")],
        }
    }

    fn render(&self, _: &CustomBlock, _: &RenderOptions) -> Result<CustomRendering, FormatError> {
        Ok(CustomRendering::Fallback)
    }
}

#[test]
fn a_renderer_change_is_compatible_with_a_model_read() {
    let vault = vault("```audit-model\npayload\n```\n");
    let (workspace, armed, entered, parse_release, syntax_release) = blocking_workspace(&vault);
    armed.store(true, Ordering::SeqCst);
    let (call, done) = start_read(workspace.clone());
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("parse entered"),
        Stage::Parse
    );
    assert_workspace_is_free(
        &workspace,
        "FormatProvider::parse before renderer registration",
    );
    workspace
        .write()
        .expect("workspace is free")
        .register_custom_renderer(PLUGIN, Box::new(LaterRenderer))
        .expect("renderer registers");
    parse_release.send(()).expect("release parse");
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("syntax entered"),
        Stage::Syntax
    );
    syntax_release.send(()).expect("release syntax");
    done.recv_timeout(TIMEOUT)
        .expect("compatible read completes")
        .expect("renderer does not invalidate a model");
    call.join()
        .expect("completed compatible thread does not panic");
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
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            if self.panic {
                panic!("intentional format parse panic");
            }
            return Err(FormatError::Parse("intentional format parse error".into()));
        }
        MarkdownProvider::new().parse(source, context)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        options: &RenderOptions,
    ) -> Result<String, FormatError> {
        MarkdownProvider::new().render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        MarkdownProvider::new().serialize(model)
    }
}

fn assert_parse_recovers(panic: bool) {
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
        workspace
            .register_plugin(
                PluginManifest::core(PLUGIN, "Audit model lock"),
                Trust::Core,
            )
            .expect("model caller declares");
        let workspace = Custody::new("the model workspace", workspace);
        let job = JobHost::new(workspace.clone(), PLUGIN);

        let first = job.read_model(&DocId::new("Note.md"));
        let message = match first {
            Err(PluginError::Internal(message)) => message,
            other => panic!("the first parse must fail, got {other:?}"),
        };
        if panic {
            let message = message.to_string();
            assert!(
                message.contains("`markdown`")
                    && message.contains("parsando `Note.md`")
                    && message.contains("intentional format parse panic"),
                "the parse boundary names owner, document and panic: {message}"
            );
        } else {
            assert!(
                message
                    .to_string()
                    .contains("intentional format parse error"),
                "the ordinary format error propagates: {message}"
            );
        }
        assert_workspace_is_free(&workspace, "failed FormatProvider::parse");
        job.read_model(&DocId::new("Note.md"))
            .expect("the next model read succeeds");
        let _ = done_tx.send(());
    });

    done_rx
        .recv_timeout(TIMEOUT)
        .expect("error cleanup and recovery complete before the timeout");
    call.join()
        .expect("completed recovery thread does not panic");
}

#[test]
fn a_format_parse_error_propagates_and_the_next_model_read_works() {
    assert_parse_recovers(false);
}

#[test]
fn a_format_parse_panic_is_contained_and_the_next_model_read_works() {
    assert_parse_recovers(true);
}

struct FailsOnceSyntax {
    calls: Arc<AtomicUsize>,
    panic: bool,
}

impl SyntaxRule for FailsOnceSyntax {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PLUGIN}:syntax-failure"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-syntax-failure".into()],
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
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            if self.panic {
                panic!("intentional syntax rule panic");
            }
            return Err(FormatError::Parse("intentional syntax rule error".into()));
        }
        Ok(Some(SyntaxProduct::Block {
            custom_kind: CUSTOM_KIND.into(),
            attrs: serde_json::Value::Null,
            blocks: Vec::new(),
        }))
    }
}

fn assert_syntax_recovers(panic: bool) {
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let vault = vault("```audit-syntax-failure\npayload\n```\n");
        let mut formats = FormatRegistry::new();
        formats
            .register(Box::new(MarkdownProvider::new()))
            .expect("format registers");
        let calls = Arc::new(AtomicUsize::new(0));
        let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
        workspace
            .register_plugin(
                PluginManifest::core(PLUGIN, "Audit syntax recovery"),
                Trust::Core,
            )
            .expect("model caller declares");
        workspace
            .register_syntax_rule(
                PLUGIN,
                Box::new(FailsOnceSyntax {
                    calls: Arc::clone(&calls),
                    panic,
                }),
            )
            .expect("syntax registers");
        let workspace = Custody::new("the syntax recovery workspace", workspace);
        let job = JobHost::new(workspace.clone(), PLUGIN);

        let first = job
            .read_model(&DocId::new("Note.md"))
            .expect("a failing syntax rule degrades to the base model");
        assert!(
            matches!(first.body.first(), Some(Block::CodeBlock { .. })),
            "the failed match must not be finalized partially: {:?}",
            first.body
        );
        assert_workspace_is_free(&workspace, "failed SyntaxRule::apply");

        let next = job
            .read_model(&DocId::new("Note.md"))
            .expect("the next model read succeeds");
        assert!(
            matches!(
                next.body.first(),
                Some(Block::Custom { custom_kind, .. }) if custom_kind == CUSTOM_KIND
            ),
            "the same syntax rule remains usable: {:?}",
            next.body
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_workspace_is_free(&workspace, "reused SyntaxRule::apply");
        let _ = done_tx.send(());
    });

    done_rx
        .recv_timeout(TIMEOUT)
        .expect("syntax cleanup and recovery complete before the timeout");
    call.join()
        .expect("completed syntax recovery thread does not panic");
}

#[test]
fn a_syntax_rule_error_degrades_and_the_next_model_read_works() {
    assert_syntax_recovers(false);
}

#[test]
fn a_syntax_rule_panic_is_contained_and_the_next_model_read_works() {
    assert_syntax_recovers(true);
}

struct CountedMetadata {
    descriptor_calls: Arc<AtomicUsize>,
    capability_calls: Arc<AtomicUsize>,
}

impl FormatProvider for CountedMetadata {
    fn descriptor(&self) -> FormatDescriptor {
        self.descriptor_calls.fetch_add(1, Ordering::SeqCst);
        MarkdownProvider::new().descriptor()
    }

    fn capabilities(&self) -> FormatCapabilities {
        self.capability_calls.fetch_add(1, Ordering::SeqCst);
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
        MarkdownProvider::new().render_html(model, options)
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        MarkdownProvider::new().serialize(model)
    }
}

#[test]
fn format_metadata_is_not_called_by_job_read_or_borrowed_kernel_hosts() {
    let vault = vault("# Note\n");
    let descriptor_calls = Arc::new(AtomicUsize::new(0));
    let capability_calls = Arc::new(AtomicUsize::new(0));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(CountedMetadata {
            descriptor_calls: Arc::clone(&descriptor_calls),
            capability_calls: Arc::clone(&capability_calls),
        }))
        .expect("format registers");
    let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Audit model lock"),
            Trust::Core,
        )
        .expect("metadata caller declares");
    let workspace = Custody::new("the model workspace", workspace);
    let descriptors_before = descriptor_calls.load(Ordering::SeqCst);
    let capabilities_before = capability_calls.load(Ordering::SeqCst);
    assert_eq!(
        descriptors_before, 1,
        "the descriptor is photographed exactly once at registration"
    );
    assert_eq!(
        capabilities_before, 1,
        "the capabilities are photographed exactly once at registration"
    );
    let id = DocId::new("Note.md");

    let job = JobHost::new(workspace.clone(), PLUGIN);
    assert!(job
        .format_of(&id)
        .expect("cached format metadata exists")
        .capabilities
        .supports(syntax::WIKILINKS));
    assert!(matches!(
        job.query_index(IndexQuery::SyntaxForms { doc: id.clone() }),
        Ok(IndexResult::SyntaxForms(forms))
            if forms
                .iter()
                .any(|form| form.name.as_str() == syntax::WIKILINKS)
    ));
    {
        let workspace = workspace.read().expect("workspace lives");
        assert!(workspace
            .with_read_host(PLUGIN, |host| host.format_of(&id))
            .is_some());
        assert!(matches!(
            workspace.with_read_host(PLUGIN, |host| {
                host.query_index(IndexQuery::SyntaxForms { doc: id.clone() })
            }),
            Ok(IndexResult::SyntaxForms(forms))
                if forms
                    .iter()
                    .any(|form| form.name.as_str() == syntax::WIKILINKS)
        ));
    }
    {
        let mut workspace = workspace.write().expect("workspace lives");
        assert!(workspace
            .with_host(PLUGIN, |host| host.format_of(&id))
            .is_some());
        assert!(matches!(
            workspace.with_host(PLUGIN, |host| {
                host.query_index(IndexQuery::SyntaxForms { doc: id.clone() })
            }),
            Ok(IndexResult::SyntaxForms(forms))
                if forms
                    .iter()
                    .any(|form| form.name.as_str() == syntax::WIKILINKS)
        ));
    }

    assert_eq!(
        descriptor_calls.load(Ordering::SeqCst),
        descriptors_before,
        "descriptor metadata is frozen before the workspace is mounted"
    );
    assert_eq!(
        capability_calls.load(Ordering::SeqCst),
        capabilities_before,
        "capability metadata is frozen before the workspace is mounted"
    );
}

#[test]
fn detached_model_reads_preserve_the_vault_read_gate() {
    let vault = vault("# Note\n");
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(MarkdownProvider::new()))
        .expect("format registers");
    let mut workspace = Workspace::new(&vault.root, formats).expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::new(PLUGIN, "Audit model lock").granting(PluginPermissions::of(&[])),
            Trust::Community,
        )
        .expect("model caller declares");
    let workspace = Custody::new("the model workspace", workspace);
    let outcome = JobHost::new(workspace, PLUGIN).read_model(&DocId::new("Note.md"));
    assert!(matches!(
        outcome,
        Err(PluginError::PermissionDenied(message))
            if message.to_string().contains(permission::READ_VAULT)
    ));
}
