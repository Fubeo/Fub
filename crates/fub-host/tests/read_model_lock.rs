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

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
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
    VaultStructure,
};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, JobHost};
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Trust, Workspace};

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
    TrashList,
    SourceRead,
}

struct BlockingRestoreStorage {
    inner: FsStorage,
    trash_dir: Utf8PathBuf,
    source: Mutex<Option<Utf8PathBuf>>,
    armed: AtomicBool,
    blocking: AtomicBool,
    list_hits: AtomicUsize,
    read_hits: AtomicUsize,
    entered: mpsc::SyncSender<Stage>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl BlockingRestoreStorage {
    fn arm(&self, source: Utf8PathBuf, blocking: bool) {
        *self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(source);
        self.list_hits.store(0, Ordering::SeqCst);
        self.read_hits.store(0, Ordering::SeqCst);
        self.blocking.store(blocking, Ordering::SeqCst);
        self.armed.store(true, Ordering::SeqCst);
    }

    fn traverse(&self, stage: Stage) {
        match stage {
            Stage::TrashList => {
                self.list_hits.fetch_add(1, Ordering::SeqCst);
            }
            Stage::SourceRead => {
                self.read_hits.fetch_add(1, Ordering::SeqCst);
            }
            Stage::Parse | Stage::Syntax => unreachable!("storage stage"),
        }
        if self.blocking.load(Ordering::SeqCst) {
            self.entered
                .send(stage)
                .expect("restore probe observes I/O");
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(TIMEOUT)
                .expect("restore I/O probe is released");
        }
        if stage == Stage::SourceRead {
            self.armed.store(false, Ordering::SeqCst);
        }
    }
}

impl VaultStorage for BlockingRestoreStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        let source = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if self.armed.load(Ordering::SeqCst) && source.as_deref() == Some(path) {
            self.traverse(Stage::SourceRead);
        }
        self.inner.read(path)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }

    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }

    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        if self.armed.load(Ordering::SeqCst) && dir == self.trash_dir {
            self.traverse(Stage::TrashList);
        }
        self.inner.list(dir)
    }

    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
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
struct CountingFormat {
    parses: Arc<AtomicUsize>,
}

impl FormatProvider for CountingFormat {
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
        self.parses.fetch_add(1, Ordering::SeqCst);
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

struct BlockingWorkspace {
    workspace: Custody<Workspace>,
    armed: Arc<AtomicBool>,
    entered: mpsc::Receiver<Stage>,
    parse_release: mpsc::SyncSender<()>,
    syntax_release: mpsc::SyncSender<()>,
}

fn blocking_workspace(vault: &Vault) -> BlockingWorkspace {
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
            Trust::Community,
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
    BlockingWorkspace {
        workspace: Custody::new("the model workspace", workspace),
        armed,
        entered: entered_rx,
        parse_release: parse_release_tx,
        syntax_release: syntax_release_tx,
    }
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
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        syntax_release,
    } = blocking_workspace(&vault);
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
fn restore_releases_both_workspace_guards_for_format_parse() {
    let vault = vault("# Restored\n");
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        ..
    } = blocking_workspace(&vault);
    let trash_id = {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.reindex().expect("seed note enters the workspace");
        ws.delete_document(&DocId::new("Note.md"))
            .expect("seed note enters trash")
    };
    armed.store(true, Ordering::SeqCst);

    let workspace_for_call = workspace.clone();
    let call = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN).restore_document(&trash_id, None)
    });
    assert_eq!(
        entered
            .recv_timeout(TIMEOUT)
            .expect("restore parse entered"),
        Stage::Parse
    );
    assert_workspace_is_free(&workspace, "restore FormatProvider::parse");
    parse_release.send(()).expect("release restore parse");
    let restored = call
        .join()
        .expect("restore thread does not panic")
        .expect("restore succeeds");

    assert_eq!(restored, DocId::new("Note.md"));
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Note.md")).unwrap(),
        "# Restored\n"
    );
}

#[test]
fn restore_lists_and_reads_without_workspace_guards_and_denial_precedes_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::create_dir(root.join("notes")).expect("notes folder");
    let original = DocId::new("notes/Note.md");
    std::fs::write(root.join(original.as_str()), "# Detached\n").expect("seed note");
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let storage = Arc::new(BlockingRestoreStorage {
        inner: FsStorage,
        trash_dir: root.join(".trash"),
        source: Mutex::new(None),
        armed: AtomicBool::new(false),
        blocking: AtomicBool::new(false),
        list_hits: AtomicUsize::new(0),
        read_hits: AtomicUsize::new(0),
        entered: entered_tx,
        release: Mutex::new(release_rx),
    });
    let parses = Arc::new(AtomicUsize::new(0));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(CountingFormat {
            parses: Arc::clone(&parses),
        }))
        .expect("format registers");
    let mut workspace = Workspace::on(
        &root,
        formats,
        storage.clone(),
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    let mut permissions = PluginPermissions::of(&[]);
    permissions
        .granted
        .set(permission::READ_VAULT, serde_json::json!(["notes/"]));
    permissions
        .granted
        .set(permission::WRITE_VAULT, serde_json::json!(["notes/"]));
    workspace
        .register_plugin(
            PluginManifest::new(PLUGIN, "Detached restore").granting(permissions),
            Trust::Community,
        )
        .expect("restore caller declares");
    workspace.reindex().expect("seed note enters workspace");
    let trash_id = workspace
        .delete_document(&original)
        .expect("seed note enters trash");
    let workspace = Custody::new("the detached restore workspace", workspace);
    storage.arm(root.join(trash_id.as_str()), true);

    let workspace_for_call = workspace.clone();
    let call = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN).restore_document(&trash_id, None)
    });
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash listing entered"),
        Stage::TrashList
    );
    assert_workspace_is_free(&workspace, "VaultStorage::list during restore");
    release_tx.send(()).expect("release trash listing");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash source read entered"),
        Stage::SourceRead
    );
    assert_workspace_is_free(&workspace, "VaultStorage::read during restore");
    release_tx.send(()).expect("release trash source read");
    assert_eq!(
        call.join()
            .expect("restore thread does not panic")
            .expect("restore succeeds"),
        original
    );

    let denied_entry = workspace
        .write()
        .expect("workspace remains alive")
        .delete_document(&original)
        .expect("restored note enters trash again");
    storage.arm(root.join(denied_entry.as_str()), false);
    let parses_before = parses.load(Ordering::SeqCst);
    assert!(matches!(
        JobHost::new(workspace, PLUGIN)
            .restore_document(&denied_entry, Some(DocId::new("outside/Note.md"))),
        Err(PluginError::PermissionDenied(_))
    ));
    assert_eq!(
        storage.list_hits.load(Ordering::SeqCst),
        0,
        "a denied explicit target is rejected before listing trash"
    );
    assert_eq!(
        storage.read_hits.load(Ordering::SeqCst),
        0,
        "a denied explicit target is rejected before reading its source"
    );
    assert_eq!(
        parses.load(Ordering::SeqCst),
        parses_before,
        "a denied explicit target never reaches the parser"
    );
}

#[test]
fn scoped_restore_authorizes_the_destination_before_parsing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::create_dir(root.join("notes")).expect("notes folder");
    let original = DocId::new("notes/Note.md");
    std::fs::write(root.join(original.as_str()), "# Scoped\n").expect("seed note");
    let parses = Arc::new(AtomicUsize::new(0));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(CountingFormat {
            parses: Arc::clone(&parses),
        }))
        .expect("format registers");
    let mut workspace = Workspace::new(&root, formats).expect("workspace opens");
    let mut permissions = PluginPermissions::of(&[]);
    permissions
        .granted
        .set(permission::READ_VAULT, serde_json::json!(["notes/"]));
    permissions
        .granted
        .set(permission::WRITE_VAULT, serde_json::json!(["notes/"]));
    workspace
        .register_plugin(
            PluginManifest::new(PLUGIN, "Scoped restore").granting(permissions),
            Trust::Community,
        )
        .expect("scoped caller declares");
    workspace.reindex().expect("seed note enters the workspace");
    let workspace = Custody::new("the scoped restore workspace", workspace);

    let direct_entry = workspace
        .write()
        .expect("workspace is alive")
        .delete_document(&original)
        .expect("seed note enters trash");
    let before_direct = parses.load(Ordering::SeqCst);
    let direct_restored = workspace
        .write()
        .expect("workspace is alive")
        .with_host(PLUGIN, |host| {
            let entries = host.list_trash().expect("scoped trash is visible");
            assert_eq!(entries[0].id, direct_entry);
            host.restore_document(&direct_entry, None)
        })
        .expect("direct guard restores to the visible original");
    assert_eq!(direct_restored, original);
    assert!(parses.load(Ordering::SeqCst) > before_direct);

    let job_entry = workspace
        .write()
        .expect("workspace is alive")
        .delete_document(&original)
        .expect("restored note enters trash again");
    let mut job = JobHost::new(workspace.clone(), PLUGIN);
    assert_eq!(
        job.list_trash().expect("job sees scoped trash")[0].id,
        job_entry
    );
    assert_eq!(
        job.restore_document(&job_entry, None)
            .expect("job restores to the visible original"),
        original
    );

    let denied_entry = workspace
        .write()
        .expect("workspace is alive")
        .delete_document(&original)
        .expect("note enters trash for denied overrides");
    let outside = DocId::new("outside/Note.md");
    let before_denials = parses.load(Ordering::SeqCst);
    std::fs::remove_file(root.join(denied_entry.as_str()))
        .expect("remove the trash source behind the denied path");
    let direct_denied = workspace
        .write()
        .expect("workspace is alive")
        .with_host(PLUGIN, |host| {
            host.restore_document(&denied_entry, Some(outside.clone()))
        });
    assert!(matches!(
        direct_denied,
        Err(PluginError::PermissionDenied(_))
    ));
    assert!(matches!(
        JobHost::new(workspace.clone(), PLUGIN)
            .restore_document(&denied_entry, Some(outside.clone())),
        Err(PluginError::PermissionDenied(_))
    ));
    assert_eq!(
        parses.load(Ordering::SeqCst),
        before_denials,
        "neither denied path reads the missing source or reaches the format parser"
    );
    assert!(!root.join(outside.as_str()).exists());

    std::fs::create_dir(root.join("outside")).expect("outside folder");
    let hidden = DocId::new("outside/Hidden.md");
    std::fs::write(root.join(hidden.as_str()), "# Hidden\n").expect("seed hidden note");
    let hidden_entry = {
        let mut ws = workspace.write().expect("workspace is alive");
        ws.reindex().expect("hidden note enters the workspace");
        ws.delete_document(&hidden)
            .expect("hidden note enters trash")
    };
    let before_hidden = parses.load(Ordering::SeqCst);
    assert!(matches!(
        workspace
            .write()
            .expect("workspace is alive")
            .with_host(PLUGIN, |host| host.restore_document(&hidden_entry, None)),
        Err(PluginError::NotFound(_))
    ));
    assert!(matches!(
        JobHost::new(workspace.clone(), PLUGIN).restore_document(&hidden_entry, None),
        Err(PluginError::NotFound(_))
    ));
    assert_eq!(
        parses.load(Ordering::SeqCst),
        before_hidden,
        "an inferred destination outside the scoped trash view reaches neither source nor parser"
    );
    assert!(
        root.join(hidden_entry.as_str()).exists(),
        "the hidden trash entry remains untouched"
    );

    let missing = DocId::new(".trash/missing.md");
    assert!(matches!(
        JobHost::new(workspace.clone(), PLUGIN)
            .in_mode(InvokeMode::DryRun)
            .restore_document(&missing, None),
        Err(PluginError::PermissionDenied(_))
    ));
    assert!(matches!(
        workspace
            .write()
            .expect("workspace is alive")
            .with_host(PLUGIN, |host| host.restore_document(&missing, None)),
        Err(PluginError::NotFound(_))
    ));
    assert!(matches!(
        JobHost::new(workspace, PLUGIN).restore_document(&missing, None),
        Err(PluginError::NotFound(_))
    ));
}

#[test]
fn a_stale_restore_result_moves_nothing_and_records_no_fact() {
    let vault = vault("# Before\n");
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        ..
    } = blocking_workspace(&vault);
    let trash_id = {
        let mut ws = workspace.write().expect("the vault is alive");
        ws.reindex().expect("seed note enters the workspace");
        ws.delete_document(&DocId::new("Note.md"))
            .expect("seed note enters trash")
    };
    let journal_before = workspace
        .read()
        .expect("the vault is alive")
        .journal()
        .expect("journal is readable")
        .records
        .len();
    armed.store(true, Ordering::SeqCst);

    let workspace_for_call = workspace.clone();
    let entry = trash_id.clone();
    let call = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN).restore_document(&entry, None)
    });
    assert_eq!(
        entered
            .recv_timeout(TIMEOUT)
            .expect("restore parse entered"),
        Stage::Parse
    );
    assert_workspace_is_free(&workspace, "stale restore FormatProvider::parse");
    std::fs::write(vault.root.join(trash_id.as_str()), "# After\n")
        .expect("concurrent trash change");
    parse_release.send(()).expect("release restore parse");

    let error = call
        .join()
        .expect("restore thread does not panic")
        .expect_err("the stale parse result is rejected");
    assert!(matches!(error, PluginError::Conflict(_)), "{error}");
    assert!(
        !vault.root.join("Note.md").exists(),
        "a stale result did not move the trash entry"
    );
    assert_eq!(
        std::fs::read_to_string(vault.root.join(trash_id.as_str())).unwrap(),
        "# After\n"
    );
    assert_eq!(
        workspace
            .read()
            .expect("the vault is alive")
            .journal()
            .expect("journal is readable")
            .records
            .len(),
        journal_before,
        "a rejected stale result is not a Restored fact"
    );
}

#[test]
fn a_model_from_a_changed_source_is_rejected_as_stale_and_the_workspace_is_reusable() {
    let vault = vault("```audit-model\nbefore\n```\n");
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        syntax_release,
    } = blocking_workspace(&vault);
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
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        syntax_release,
    } = blocking_workspace(&vault);
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
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        syntax_release,
    } = blocking_workspace(&vault);
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
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        syntax_release,
    } = blocking_workspace(&vault);
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
                Trust::Community,
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
                Trust::Community,
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
            Trust::Community,
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
