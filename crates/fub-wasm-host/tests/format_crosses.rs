//! Prova end-to-end del provider di formato WASM attraverso il composition root.

mod common;

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions, RenderTarget,
};
use fub_abi::model::{Block, DocId, DocumentModel, Frontmatter, Inline, Span};
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher, StartupSnapshot, StartupSource, StartupValidity};
use fub_kernel::{KernelError, Trust};
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::InstalledPluginManager;

struct NativeExampleFormat;

impl FormatProvider for NativeExampleFormat {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: ID.to_string(),
            name: "Example Format".to_string(),
            extensions: vec!["fubfmt".to_string()],
            source: fub_abi::format::SourceKind::Text,
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().ok_or_else(|| FormatError::Unsupported {
            format: ID.into(),
            got: source.kind(),
        })?;
        let span = Span {
            start: 0,
            end: text.len(),
        };
        Ok(DocumentModel {
            id: DocId::new(ctx.doc_id.clone()),
            frontmatter: Frontmatter::default(),
            body: vec![Block::Paragraph {
                inlines: vec![Inline::Text(text.to_string())],
                anchor: None,
                span,
            }],
            outline: vec![],
            links: vec![],
            tags: vec![],
            anchors: vec![],
            text: text.to_string(),
            frontmatter_present: false,
        })
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        let target = match opts.target {
            RenderTarget::Screen => "screen",
            RenderTarget::Print => "print",
            RenderTarget::Pdf => "pdf",
            RenderTarget::StaticSite => "static-site",
        };
        let text = match model.body.as_slice() {
            [Block::Paragraph { inlines, .. }] => match inlines.as_slice() {
                [Inline::Text(text)] => text,
                _ => return Err(FormatError::Render("unsupported paragraph".to_string())),
            },
            _ => return Err(FormatError::Render("unsupported body".to_string())),
        };
        Ok(format!(
            "<p data-format=\"example-format\" data-target=\"{target}\">{}</p>",
            fub_abi::html::escape(text)
        ))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(format!("fubfmt:{}", model.text))
    }
}
use fub_wasm_host::WasmBundle;
const ID: &str = "example.format";
const FILE: &str = "nota.fubfmt";
const SOURCE: &str = "ciao <mondo> & formato\n";

struct BlockingStartupSource {
    manager: Arc<InstalledPluginManager>,
    prepared: Mutex<Option<mpsc::SyncSender<Arc<StartupValidity>>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl StartupSource for BlockingStartupSource {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        let snapshot = self.manager.prepare()?;
        let validity = Arc::clone(
            snapshot
                .validity
                .as_ref()
                .expect("manager snapshots carry validity"),
        );
        self.prepared
            .lock()
            .expect("prepared channel")
            .take()
            .expect("prepare is called once")
            .send(validity)
            .expect("snapshot validity is observed");
        self.release
            .lock()
            .expect("release channel")
            .recv()
            .expect("opening is released");
        Ok(snapshot)
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    _config: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        Self::with_source(SOURCE)
    }

    fn with_source(source: &str) -> Self {
        let dir = tempfile::tempdir().expect("vault tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("vault utf8");
        std::fs::write(root.join(FILE), source).expect("format fixture");
        let config = tempfile::tempdir().expect("config tempdir");
        Self {
            _dir: dir,
            _config: config,
            root,
        }
    }
}

fn host_with_manager(manager: Arc<InstalledPluginManager>) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1)
        .with_startup_source(manager)
}

/// Le decisioni installate diventano effettive al successivo startup: prima si
/// apre una sessione per dare al manager l'istanza posseduta, poi si richiude e
/// si riapre. In questo modo il provider di formato viene preparato prima del
/// workspace, non montato direttamente dal test.
fn enabled_manager(vault: &Vault) -> (Arc<InstalledPluginManager>, Host) {
    enabled_manager_variant(vault, "")
}

fn enabled_manager_variant(vault: &Vault, variant: &str) -> (Arc<InstalledPluginManager>, Host) {
    let config_path =
        Utf8PathBuf::from_path_buf(vault._config.path().to_path_buf()).expect("config utf8");
    let manager = Arc::new(InstalledPluginManager::open(&config_path).expect("manager opens"));
    let installed = manager
        .install(&common::component("format-wasm", "format_wasm", variant))
        .expect("format component installs");

    let host = host_with_manager(Arc::clone(&manager));
    host.open(&vault.root).expect("initial session opens");
    host.wait_indexed(None).expect("initial indexing completes");
    manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled choice persists")
        .is_empty()
        .then_some(())
        .expect("enabling has no diagnostic");
    manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("consent persists")
        .is_empty()
        .then_some(())
        .expect("consent has no diagnostic");
    host.close_vault(&vault.root)
        .expect("initial session closes");
    host.open(&vault.root).expect("managed session reopens");
    host.wait_indexed(None).expect("managed indexing completes");
    (manager, host)
}

#[test]
fn invalidated_format_snapshot_is_not_published() {
    let vault = Vault::new();
    let (manager, configured_host) = enabled_manager(&vault);
    let installation = manager
        .list(&configured_host, None)
        .expect("installed format is listed")
        .into_iter()
        .next()
        .expect("format installation exists")
        .installation;
    assert!(
        configured_host.close().is_empty(),
        "configured session closes cleanly"
    );

    let (prepared_tx, prepared_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let source = Arc::new(BlockingStartupSource {
        manager: Arc::clone(&manager),
        prepared: Mutex::new(Some(prepared_tx)),
        release: Mutex::new(release_rx),
    });
    let host = Arc::new(
        Host::new()
            .with_watcher(Box::new(NoWatcher))
            .with_job_threads(1)
            .with_startup_source(source),
    );
    let opening_host = Arc::clone(&host);
    let opening_root = vault.root.clone();
    let opening = std::thread::spawn(move || opening_host.open(&opening_root));
    let validity = match prepared_rx.recv() {
        Ok(validity) => validity,
        Err(error) => {
            let opening_result = opening.join();
            assert!(opening_result.is_ok(), "opening thread joins");
            panic!("prepared validity was not observed: {error}");
        }
    };

    let (mutation_started_tx, mutation_started_rx) = mpsc::sync_channel(0);
    let mutating_manager = Arc::clone(&manager);
    let mutating_host = Arc::clone(&host);
    let mutation = std::thread::spawn(move || {
        mutation_started_tx.send(()).expect("mutation starts");
        mutating_manager.set_enabled(&mutating_host, installation, false)
    });
    if let Err(error) = mutation_started_rx.recv() {
        let _ = release_tx.send(());
        let opening_result = opening.join();
        let mutation_result = mutation.join();
        assert!(opening_result.is_ok(), "opening thread joins");
        assert!(mutation_result.is_ok(), "mutation thread joins");
        panic!("mutation thread did not start: {error}");
    }

    let mut unexpected_validity_error = false;
    loop {
        match validity.acquire() {
            Err(PluginError::Conflict(_)) => break,
            Ok(lease) => drop(lease),
            Err(_) => {
                unexpected_validity_error = true;
                break;
            }
        }
        std::thread::yield_now();
    }

    let release_result = release_tx.send(());
    let opening_result = opening.join();
    let mutation_result = mutation.join();
    assert!(release_result.is_ok(), "prepared snapshot is released");
    assert!(opening_result.is_ok(), "opening thread joins");
    assert!(mutation_result.is_ok(), "mutation thread joins");
    assert!(
        !unexpected_validity_error,
        "validity acquisition reports only conflict after invalidation"
    );
    let opening_result = opening_result.expect("opening thread joins");
    let mutation_result = mutation_result.expect("mutation thread joins");

    assert!(
        matches!(opening_result, Err(PluginError::Conflict(_))),
        "invalidated format snapshot must not publish"
    );
    assert!(
        mutation_result.expect("disable succeeds").is_empty(),
        "disable has no diagnostics"
    );
    assert!(
        host.with_session(None, |_| ()).is_err(),
        "invalidated opening leaves no published session"
    );
}
#[test]
fn shutdown_revokes_before_closing_open_format_session() {
    let vault = Vault::new();
    let (manager, host) = enabled_manager(&vault);

    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let shutting_down = Arc::clone(&manager);
    let shutdown = std::thread::spawn(move || {
        done_tx
            .send(shutting_down.begin_shutdown())
            .expect("shutdown result observed");
    });

    let result = match done_rx.recv_timeout(Duration::from_secs(1)) {
        Ok(result) => result,
        Err(error) => {
            let close_errors = host.close();
            assert!(
                close_errors.is_empty(),
                "host close errors: {close_errors:?}"
            );
            let _ = shutdown.join();
            panic!("begin_shutdown blocked on the open format session: {error}");
        }
    };
    let token = result.expect("manager shutdown begins");
    shutdown.join().expect("shutdown thread joins");

    assert!(
        matches!(
            manager.begin_operation(),
            Err(fub_abi::PluginError::Cancelled(_))
        ),
        "shutdown must close the operation admission window"
    );

    let close_errors = host.close();
    assert!(
        close_errors.is_empty(),
        "host close errors: {close_errors:?}"
    );
    token.finish().expect("startup lease drain completes");
}

#[test]
fn host_open_is_cancelled_before_publishing_when_manager_shuts_down() {
    let vault = Vault::new();
    let config_path =
        Utf8PathBuf::from_path_buf(vault._config.path().to_path_buf()).expect("config utf8");
    let manager = Arc::new(InstalledPluginManager::open(&config_path).expect("manager opens"));
    let host = host_with_manager(Arc::clone(&manager));
    let token = manager.begin_shutdown().expect("manager shutdown begins");

    assert!(
        matches!(host.open(&vault.root), Err(PluginError::Cancelled(_))),
        "startup must observe manager cancellation"
    );
    assert!(
        host.with_session(None, |_| ()).is_err(),
        "cancelled startup must not publish a vault"
    );

    token.finish().expect("startup lease drain completes");
}

#[test]
fn installed_wasm_format_crosses_parse_and_render_routes() {
    let vault = Vault::new();
    let (_manager, host) = enabled_manager(&vault);
    let workspace = host.debug_workspace(None).expect("workspace is published");
    let workspace = workspace.write().expect("workspace write");

    let format = workspace
        .format_of(&DocId::new(FILE))
        .expect("installed provider claims extension");
    assert_eq!(format.descriptor.id, ID);
    assert_eq!(format.descriptor.name, "Example Format");
    assert_eq!(format.descriptor.extensions, vec!["fubfmt"]);
    assert_eq!(format.descriptor.source, fub_abi::format::SourceKind::Text);

    let model = workspace
        .read_model(&DocId::new(FILE))
        .expect("WASM provider parses source");
    assert_eq!(model.id, DocId::new(FILE));
    assert_eq!(model.text, SOURCE);
    assert!(matches!(
        model.body.as_slice(),
        [Block::Paragraph { inlines, .. }]
            if matches!(inlines.as_slice(), [Inline::Text(text)] if text == SOURCE)
    ));

    let rendered = workspace
        .render_preview(&DocId::new(FILE))
        .expect("WASM provider renders preview");
    assert!(
        rendered.html.contains("example-format"),
        "target marker: {}",
        rendered.html
    );
    assert!(
        rendered.html.contains("ciao &lt;mondo&gt; &amp; formato"),
        "rendered HTML: {}",
        rendered.html
    );
    drop(workspace);
    host.close();
}

#[test]
fn stateful_wasm_format_observes_plugin_activation_on_same_opening() {
    let vault = Vault::new();
    let (_manager, host) = enabled_manager_variant(&vault, "stateful-activation");
    let workspace = host.debug_workspace(None).expect("workspace is published");
    let workspace = workspace.write().expect("workspace write");

    let model = workspace
        .read_model(&DocId::new(FILE))
        .expect("format instance observes activation from plugin instance");
    assert_eq!(model.text, SOURCE);

    drop(workspace);
    assert!(host.close().is_empty(), "stateful session closes cleanly");
}

#[test]
fn guest_declared_parse_error_crosses_host_as_format_parse() {
    let vault = Vault::with_source("PARSE_ERROR");
    let (_manager, host) = enabled_manager(&vault);
    let workspace = host.debug_workspace(None).expect("workspace is published");
    let workspace = workspace.write().expect("workspace write");

    let error = workspace
        .read_model(&DocId::new(FILE))
        .expect_err("guest-declared parse error must reach the host");
    assert!(
        matches!(
            &error,
            KernelError::Format(FormatError::Parse(message))
                if message == "declared example parse error"
        ),
        "expected typed guest parse error, got {error:?}"
    );
    drop(workspace);
    host.close();
}

#[test]
fn real_wasm_format_provider_serializes_document_model() {
    let wasm = common::component("format-wasm", "format_wasm", "");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");
    let provider = bundle
        .format_provider()
        .expect("il provider si prepara")
        .expect("il componente dichiara un provider di formato");
    let mut model = DocumentModel::empty(DocId::new(FILE));
    model.text = "testo generato".to_string();

    assert_eq!(
        provider
            .serialize(&model)
            .expect("il provider serializza il modello"),
        "fubfmt:testo generato"
    );
}

fn assert_bad_variant_is_recoverable(variant: &str) {
    let vault = Vault::new();
    let config_path =
        Utf8PathBuf::from_path_buf(vault._config.path().to_path_buf()).expect("config utf8");
    let manager = Arc::new(InstalledPluginManager::open(&config_path).expect("manager opens"));
    let installed = manager
        .install(&common::component("format-wasm", "format_wasm", variant))
        .expect("format component installs");
    let host = host_with_manager(Arc::clone(&manager));

    host.open(&vault.root).expect("initial session opens");
    host.wait_indexed(None).expect("initial indexing completes");
    manager
        .set_enabled(&host, installed.installation, true)
        .expect("enabled choice persists");
    manager
        .set_consent(&host, installed.installation, Consent::Granted)
        .expect("consent persists");

    host.close_vault(&vault.root)
        .expect("initial session closes");
    host.open(&vault.root).expect("variant session opens");
    host.wait_indexed(None).expect("variant indexing completes");

    let workspace = host
        .debug_workspace(None)
        .expect("workspace remains published");
    let workspace = workspace.write().expect("workspace write");
    assert!(workspace.read_model(&DocId::new(FILE)).is_err());
    assert!(workspace.render_preview(&DocId::new(FILE)).is_err());
    drop(workspace);
    host.close_vault(&vault.root)
        .expect("variant session closes");
    assert!(
        host.with_session(None, |_| ()).is_err(),
        "close releases session ownership"
    );
}

#[test]
fn malformed_wasm_model_is_a_recoverable_format_failure() {
    assert_bad_variant_is_recoverable("malformed-model");
}

#[test]
fn trapped_wasm_parser_is_a_recoverable_format_failure() {
    assert_bad_variant_is_recoverable("trap-on-parse");
}
#[test]
fn native_and_wasm_format_providers_have_observable_parity() {
    let wasm = common::component("format-wasm", "format_wasm", "");
    let wasm_bundle =
        WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");
    let wasm_provider = wasm_bundle
        .format_provider()
        .expect("il provider si prepara")
        .expect("il componente dichiara un provider di formato");
    let native_provider = NativeExampleFormat;
    let native: &dyn FormatProvider = &native_provider;
    let wasm: &dyn FormatProvider = wasm_provider.as_ref();
    let source = DocumentSource::Text(SOURCE.to_string());
    let context = ParseContext::obsidian(FILE);
    let options = RenderOptions {
        target: RenderTarget::StaticSite,
        ..RenderOptions::default()
    };

    let native_model = native
        .parse(&source, &context)
        .expect("il provider nativo esegue il parse");
    let wasm_model = wasm
        .parse(&source, &context)
        .expect("il provider WASM esegue il parse");
    assert_eq!(
        native_model, wasm_model,
        "il modello attraversa invariato il confine WASM"
    );
    let native_html = native
        .render_html(&native_model, &options)
        .expect("il provider nativo esegue il render");
    let wasm_html = wasm
        .render_html(&native_model, &options)
        .expect("il provider WASM esegue il render");
    assert_eq!(
        native_html, wasm_html,
        "il target e il contenuto HTML restano invariati"
    );
    let native_source = native
        .serialize(&native_model)
        .expect("il provider nativo serializza il modello");
    let wasm_source = wasm
        .serialize(&native_model)
        .expect("il provider WASM serializza il modello");
    assert_eq!(
        native_source, wasm_source,
        "la serializzazione resta invariata"
    );
}
