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
use fub_abi::settings::{SettingSpec, SettingValue};
use fub_abi::traits::{
    DataRead, DataWrite, HostQuery, IndexQuery, IndexResult, PluginManifest, PluginPermissions,
    SettingsRead, SettingsWrite, VaultRead, VaultStructure,
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

fn assert_restore_detached_with_writer_turn(workspace: &Custody<Workspace>, callback: &str) {
    assert!(
        workspace.try_read().is_some(),
        "{callback} held a write guard on Custody<Workspace>"
    );
    assert!(
        workspace.try_write().is_none(),
        "{callback} did not preserve the restore writer turn"
    );
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Parse,
    Syntax,
    TrashList,
    TrashRemove,
    TrashRename,
    DraftDiscard,
    JournalAppend,
    SourceRead,
    DataRead,
    DataList,
    DataWrite,
    DataRemove,
    SettingsWrite,
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
    data_probe: Mutex<Option<(Stage, Utf8PathBuf)>>,
    data_hits: AtomicUsize,
    data_skip: AtomicUsize,
    workspace_probe: Mutex<Option<Custody<Workspace>>>,
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

    fn arm_data(&self, stage: Stage, path: Utf8PathBuf, blocking: bool) {
        self.arm_data_after(stage, path, 0, blocking);
    }

    fn arm_data_after(&self, stage: Stage, path: Utf8PathBuf, skip: usize, blocking: bool) {
        *self
            .data_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((stage, path));
        self.data_hits.store(0, Ordering::SeqCst);
        self.data_skip.store(skip, Ordering::SeqCst);
        self.blocking.store(blocking, Ordering::SeqCst);
        self.armed.store(true, Ordering::SeqCst);
    }
    fn assert_workspace_is_free(&self, callback: &str) {
        if let Some(workspace) = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned()
        {
            assert_workspace_is_free(&workspace, callback);
        }
    }

    fn observe_data(&self, stage: Stage, path: &Utf8Path) {
        if !self.armed.load(Ordering::SeqCst) {
            return;
        }
        self.data_hits.fetch_add(1, Ordering::SeqCst);
        let matches = self
            .data_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|probe| probe == &(stage, path.to_owned()));
        if matches
            && self
                .data_skip
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |skip| {
                    skip.checked_sub(1)
                })
                .is_err()
        {
            self.traverse(stage);
        }
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
            Stage::TrashRename
            | Stage::DraftDiscard
            | Stage::JournalAppend
            | Stage::TrashRemove
            | Stage::DataRead
            | Stage::DataList
            | Stage::DataWrite
            | Stage::DataRemove
            | Stage::SettingsWrite => {}
        }
        if self.blocking.load(Ordering::SeqCst) {
            self.entered
                .send(stage)
                .expect("storage probe observes I/O");
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv_timeout(TIMEOUT)
                .expect("storage I/O probe is released");
        }
        if matches!(
            stage,
            Stage::SourceRead
                | Stage::TrashRemove
                | Stage::DataRead
                | Stage::DataList
                | Stage::DataWrite
                | Stage::DataRemove
                | Stage::SettingsWrite
        ) {
            let data_probe_pending = self
                .data_probe
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_some();
            if stage == Stage::SourceRead && data_probe_pending {
                *self
                    .source
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            } else {
                self.armed.store(false, Ordering::SeqCst);
            }
        }
    }
}

impl VaultStorage for BlockingRestoreStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.observe_data(Stage::DataRead, path);
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
        self.observe_data(Stage::DataWrite, path);
        self.inner.write(path, bytes)
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        if let Some(workspace) = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned()
        {
            assert_workspace_is_free(&workspace, "VaultStorage during JobHost setting I/O");
        }
        self.observe_data(Stage::SettingsWrite, path);
        self.inner.update(path, merge)
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        let probing = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if probing && path.file_name() == Some("journal.jsonl") {
            self.assert_workspace_is_free("VaultStorage::append during trash");
            self.traverse(Stage::JournalAppend);
        }
        self.inner.append(path, bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        let source = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let probing = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if probing && source.as_deref() == Some(from) {
            self.assert_workspace_is_free("VaultStorage::rename during trash");
            self.traverse(Stage::TrashRename);
        }
        self.inner.rename(from, to)
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        let probing = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if probing && from.starts_with(&self.trash_dir) {
            self.assert_workspace_is_free("VaultStorage::rename_no_replace during restore");
            self.traverse(Stage::TrashRename);
        }
        self.inner.rename_no_replace(from, to)
    }

    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        let probing = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if probing && path.parent().and_then(Utf8Path::file_name) == Some("drafts") {
            self.assert_workspace_is_free("VaultStorage::remove draft during trash");
            self.traverse(Stage::DraftDiscard);
        }
        self.observe_data(Stage::DataRemove, path);
        let source = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if self.armed.load(Ordering::SeqCst) && source.as_deref() == Some(path) {
            self.assert_workspace_is_free("VaultStorage::remove during empty_trash");
            self.traverse(Stage::TrashRemove);
        }
        self.inner.remove(path)
    }

    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.observe_data(Stage::DataList, dir);
        let source_armed = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if self.armed.load(Ordering::SeqCst) && source_armed && dir == self.trash_dir {
            self.assert_workspace_is_free("VaultStorage::list during empty_trash");
            self.traverse(Stage::TrashList);
        }
        self.inner.list(dir)
    }

    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.observe_data(Stage::DataRead, path);
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
    workspace_probe: Arc<Mutex<Option<Custody<Workspace>>>>,
    stale_during_parse: Arc<AtomicBool>,
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
        let workspace = self
            .workspace_probe
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned();
        if let Some(workspace) = workspace {
            assert_workspace_is_free(&workspace, "FormatProvider::parse during rename");
            if self.stale_during_parse.swap(false, Ordering::SeqCst) {
                workspace
                    .try_write()
                    .expect("the parser callback can re-enter the workspace")
                    .register_syntax_rule(PLUGIN, Box::new(LaterSyntax))
                    .expect("the parser callback changes the syntax generation");
            }
        }
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
    format_workspace_probe: Arc<Mutex<Option<Custody<Workspace>>>>,
    stale_during_parse: Arc<AtomicBool>,
}

fn blocking_workspace(vault: &Vault) -> BlockingWorkspace {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (parse_release_tx, parse_release_rx) = mpsc::sync_channel(1);
    let (syntax_release_tx, syntax_release_rx) = mpsc::sync_channel(1);
    let armed = Arc::new(AtomicBool::new(false));
    let format_workspace_probe = Arc::new(Mutex::new(None));
    let stale_during_parse = Arc::new(AtomicBool::new(false));
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(BlockingFormat {
            armed: Arc::clone(&armed),
            entered: entered_tx.clone(),
            release: Mutex::new(parse_release_rx),
            workspace_probe: Arc::clone(&format_workspace_probe),
            stale_during_parse: Arc::clone(&stale_during_parse),
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
        format_workspace_probe,
        stale_during_parse,
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
        ..
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
fn rename_parse_is_detached_and_a_stale_source_is_not_moved() {
    let vault = vault("# Original\n");
    let BlockingWorkspace {
        workspace,
        armed,
        entered,
        parse_release,
        format_workspace_probe,
        stale_during_parse,
        ..
    } = blocking_workspace(&vault);
    workspace
        .write()
        .expect("the vault is alive")
        .reindex()
        .expect("seed note enters the workspace");
    *format_workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    stale_during_parse.store(true, Ordering::SeqCst);
    armed.store(true, Ordering::SeqCst);

    let workspace_for_call = workspace.clone();
    let call = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN)
            .rename_document(&DocId::new("Note.md"), &DocId::new("Renamed.md"))
    });
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("rename parse entered"),
        Stage::Parse
    );
    parse_release.send(()).expect("release rename parse");
    let outcome = call.join().expect("rename thread does not panic");
    *format_workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;

    assert!(matches!(outcome, Err(PluginError::Conflict(_))));
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Note.md")).unwrap(),
        "# Original\n"
    );
    assert!(
        !vault.root.join("Renamed.md").exists(),
        "a stale parse must not move the source"
    );
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
    assert_restore_detached_with_writer_turn(&workspace, "restore FormatProvider::parse");
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
        data_probe: Mutex::new(None),
        data_hits: AtomicUsize::new(0),
        data_skip: AtomicUsize::new(0),
        workspace_probe: Mutex::new(None),
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
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    // Dopo la mossa, l'osservazione stabile fa stat, read, stat: si blocca
    // sulla lettura centrale.
    storage.arm_data_after(Stage::DataRead, root.join(original.as_str()), 1, true);
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
    assert_restore_detached_with_writer_turn(&workspace, "VaultStorage::list during restore");
    release_tx.send(()).expect("release trash listing");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash source read entered"),
        Stage::SourceRead
    );
    assert_restore_detached_with_writer_turn(&workspace, "VaultStorage::read during restore");
    release_tx.send(()).expect("release trash source read");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash restore rename entered"),
        Stage::TrashRename
    );
    assert_restore_detached_with_writer_turn(
        &workspace,
        "VaultStorage::rename_no_replace during restore",
    );
    release_tx.send(()).expect("release trash restore rename");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("post-feed target read entered"),
        Stage::DataRead
    );
    assert_restore_detached_with_writer_turn(
        &workspace,
        "VaultStorage::read after the restore index feed",
    );
    release_tx.send(()).expect("release post-feed target read");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("restore journal append entered"),
        Stage::JournalAppend
    );
    assert_restore_detached_with_writer_turn(
        &workspace,
        "VaultStorage::append after restore events",
    );
    release_tx.send(()).expect("release restore journal append");
    assert_eq!(
        call.join()
            .expect("restore thread does not panic")
            .expect("restore succeeds"),
        original
    );
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;

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
fn empty_trash_lists_and_removes_without_workspace_guards() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note.md"), "# Trash\n").expect("seed note");
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
        data_probe: Mutex::new(None),
        data_hits: AtomicUsize::new(0),
        data_skip: AtomicUsize::new(0),
        workspace_probe: Mutex::new(None),
    });
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(MarkdownProvider::new()))
        .expect("format registers");
    let mut workspace = Workspace::on(
        &root,
        formats,
        storage.clone(),
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Detached empty trash"),
            Trust::Community,
        )
        .expect("trash caller declares");
    workspace.reindex().expect("seed note enters workspace");
    let trash_id = workspace
        .delete_document(&DocId::new("Note.md"))
        .expect("seed note enters trash");
    let trashed_path = root.join(trash_id.as_str());
    let workspace = Custody::new("the detached trash workspace", workspace);
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    storage.arm(trashed_path.clone(), true);

    let workspace_for_call = workspace.clone();
    let call = std::thread::spawn(move || JobHost::new(workspace_for_call, PLUGIN).empty_trash());
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash listing entered"),
        Stage::TrashList
    );
    release_tx.send(()).expect("release trash listing");
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("trash removal entered"),
        Stage::TrashRemove
    );
    release_tx.send(()).expect("release trash removal");

    assert_eq!(
        call.join()
            .expect("empty trash thread does not panic")
            .expect("empty trash succeeds"),
        1
    );
    assert!(!trashed_path.exists());
}

#[test]
fn trash_storage_and_sidecars_run_without_workspace_guards() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let id = DocId::new("Note.md");
    std::fs::write(root.join(id.as_str()), "# Trash\n").expect("seed note");
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
        data_probe: Mutex::new(None),
        data_hits: AtomicUsize::new(0),
        data_skip: AtomicUsize::new(0),
        workspace_probe: Mutex::new(None),
    });
    let mut formats = FormatRegistry::new();
    formats
        .register(Box::new(MarkdownProvider::new()))
        .expect("format registers");
    let mut workspace = Workspace::on(
        &root,
        formats,
        storage.clone(),
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Detached document trash"),
            Trust::Community,
        )
        .expect("trash caller declares");
    workspace.reindex().expect("seed note enters workspace");
    workspace
        .save_draft(&id, "# Unsaved\n", None)
        .expect("seed draft");
    let workspace = Custody::new("the detached document trash workspace", workspace);
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    storage.arm(root.join(id.as_str()), true);

    let workspace_for_call = workspace.clone();
    let id_for_call = id.clone();
    let call = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN).trash_document(&id_for_call)
    });
    for stage in [
        Stage::SourceRead,
        Stage::TrashRename,
        Stage::DraftDiscard,
        Stage::JournalAppend,
    ] {
        assert_eq!(
            entered_rx
                .recv_timeout(TIMEOUT)
                .expect("trash callback entered"),
            stage
        );
        release_tx.send(()).expect("release trash callback");
    }
    let trashed = call
        .join()
        .expect("trash thread does not panic")
        .expect("trash succeeds");
    assert!(root.join(trashed.as_str()).exists());
    assert!(workspace
        .read()
        .expect("workspace remains alive")
        .drafts()
        .expect("drafts remain readable")
        .drafts
        .is_empty());
}
fn assert_data_storage_detached(
    workspace: &Custody<Workspace>,
    storage: &Arc<BlockingRestoreStorage>,
    entered: &mpsc::Receiver<Stage>,
    release: &mpsc::SyncSender<()>,
    stage: Stage,
    path: Utf8PathBuf,
) {
    storage.arm_data(stage, path, true);
    let workspace_for_call = workspace.clone();
    let worker = std::thread::spawn(move || {
        let mut host = JobHost::new(workspace_for_call, PLUGIN);
        match stage {
            Stage::DataRead => {
                assert_eq!(host.data_read("read.bin")?, Some(b"read".to_vec()));
                Ok(())
            }
            Stage::DataList => {
                assert!(host.data_list("")?.contains(&"read.bin".to_string()));
                Ok(())
            }
            Stage::DataWrite => host.data_write("write.bin", b"write"),
            Stage::DataRemove => host.data_remove("remove.bin"),
            _ => unreachable!("JobHost data stage"),
        }
    });
    assert_eq!(
        entered.recv_timeout(TIMEOUT).expect("data I/O entered"),
        stage
    );
    assert_workspace_is_free(workspace, "VaultStorage during JobHost data I/O");
    release.send(()).expect("release data I/O");
    worker
        .join()
        .expect("data I/O thread does not panic")
        .expect("data I/O succeeds");
}

#[test]
fn job_data_io_runs_without_workspace_guards_and_denial_precedes_storage() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
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
        data_probe: Mutex::new(None),
        data_hits: AtomicUsize::new(0),
        data_skip: AtomicUsize::new(0),
        workspace_probe: Mutex::new(None),
    });
    let mut workspace = Workspace::on(
        &root,
        FormatRegistry::new(),
        storage.clone(),
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Detached data I/O"),
            Trust::Community,
        )
        .expect("data caller declares");
    let workspace = Custody::new("the detached data workspace", workspace);
    let canonical = root.join(".fub/plugins").join(PLUGIN);
    let cache = root.join(".fub/data/plugins").join(PLUGIN);
    let mut seed = JobHost::new(workspace.clone(), PLUGIN);
    seed.data_write("read.bin", b"read").expect("seed data");
    seed.data_write("remove.bin", b"remove")
        .expect("seed removable data");

    for (stage, path) in [
        (Stage::DataRead, canonical.join("read.bin")),
        (Stage::DataList, canonical.clone()),
        (Stage::DataWrite, canonical.join("write.bin")),
        (Stage::DataRemove, canonical.join("remove.bin")),
    ] {
        assert_data_storage_detached(&workspace, &storage, &entered_rx, &release_tx, stage, path);
    }

    storage.arm_data(Stage::DataRead, canonical.join("denied.bin"), false);
    assert!(matches!(
        JobHost::new(workspace.clone(), "unknown").data_read("denied.bin"),
        Err(PluginError::PermissionDenied(_))
    ));
    assert_eq!(
        storage.data_hits.load(Ordering::SeqCst),
        0,
        "an unknown caller reaches no storage operation"
    );
    storage.arm_data(Stage::DataWrite, cache.join("dry-run.bin"), false);
    assert!(matches!(
        JobHost::new(workspace, PLUGIN)
            .in_mode(InvokeMode::DryRun)
            .cache_write("dry-run.bin", b"forbidden"),
        Err(PluginError::PermissionDenied(_))
    ));
    assert_eq!(
        storage.data_hits.load(Ordering::SeqCst),
        0,
        "DryRun is rejected before cache namespace and marker I/O"
    );
}

#[test]
fn job_setting_write_runs_without_workspace_guards() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
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
        data_probe: Mutex::new(None),
        data_hits: AtomicUsize::new(0),
        data_skip: AtomicUsize::new(0),
        workspace_probe: Mutex::new(None),
    });
    let key = format!("{PLUGIN}:enabled");
    let mut workspace = Workspace::on(
        &root,
        FormatRegistry::new(),
        storage.clone(),
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    workspace
        .register_plugin(
            PluginManifest::core(PLUGIN, "Detached setting I/O").configuring(vec![
                SettingSpec::toggle(&key, "Enabled", true).program_writable(),
            ]),
            Trust::Community,
        )
        .expect("setting caller declares");
    let workspace = Custody::new("the detached setting workspace", workspace);
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    storage.arm_data(Stage::SettingsWrite, root.join(".fub/settings.json"), true);

    let workspace_for_call = workspace.clone();
    let key_for_call = key.clone();
    let worker = std::thread::spawn(move || {
        JobHost::new(workspace_for_call, PLUGIN)
            .set_setting(&key_for_call, SettingValue::Toggle(false))
    });
    assert_eq!(
        entered_rx
            .recv_timeout(TIMEOUT)
            .expect("setting I/O entered"),
        Stage::SettingsWrite
    );
    // La prova delle due guardie gira sul thread che possiede il writer turn:
    // così misura il lock del workspace, non la serializzazione fra writer.
    release_tx.send(()).expect("release setting I/O");
    worker
        .join()
        .expect("setting I/O thread does not panic")
        .expect("setting I/O succeeds");
    *storage
        .workspace_probe
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    assert_eq!(
        JobHost::new(workspace, PLUGIN)
            .setting(&key)
            .expect("setting remains readable"),
        SettingValue::Toggle(false)
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
    assert_restore_detached_with_writer_turn(&workspace, "stale restore FormatProvider::parse");
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
        ..
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
        ..
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
        ..
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
        ..
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
