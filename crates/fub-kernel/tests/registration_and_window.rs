//! Le due metà del §5.5: **cosa un provider ha dichiarato** e **quanto vault si
//! porta via chi si guarda intorno**.
//!
//! Sono la stessa domanda a due distanze — quante volte il kernel richiede una
//! cosa che gli è già stata detta — e stanno insieme perché la risposta è la
//! stessa: una volta, alla registrazione, e poi si legge ciò che si è tenuto.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{Choice, CommandOutcome, CommandSpec, InvokeMode, ParamKind, ParamSpec};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    CommandProvider, HostApi, Page, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_abi::edit::Revision;
use fub_abi::grid::{
    GridApplyRequest, GridCommit, GridProvider, GridSession, GridSheet, GridSurfaceSpec, GridWindow,
    GridWindowRequest,
};
use fub_kernel::{FormatRegistry, RegistryError, Workspace};

// --- un provider che conta quante volte gli si chiede cosa offre ------------

#[derive(Default)]
struct Counter {
    views: Arc<Mutex<u32>>,
    commands: Arc<Mutex<u32>>,
    /// La seconda view compare solo dopo che qualcuno l'ha annunciata.
    second: Arc<Mutex<bool>>,
}


#[derive(Clone)]
struct IncompatibleGrid {
    calls: Arc<Mutex<u32>>,
}

impl IncompatibleGrid {
    fn unexpected(&self) -> PluginError {
        *self.calls.lock().unwrap() += 1;
        PluginError::Internal("incompatible grid provider was invoked".into())
    }
}

impl GridProvider for IncompatibleGrid {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec {
            id: "future.sheet".into(),
            format: "future-format".into(),
            family: "future-grid".into(),
            protocol_version: 2,
        }]
    }

    fn open(
        &mut self,
        _surface: &str,
        _source: &str,
        _revision: Revision,
    ) -> Result<GridSession, PluginError> {
        Err(self.unexpected())
    }

    fn window(
        &mut self,
        _instance: &str,
        _request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        Err(self.unexpected())
    }

    fn apply(
        &mut self,
        _instance: &str,
        _request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        Err(self.unexpected())
    }

    fn reload(
        &mut self,
        _instance: &str,
        _expected: Revision,
        _source: &str,
        _revision: Revision,
    ) -> Result<GridSession, PluginError> {
        Err(self.unexpected())
    }

    fn close(&mut self, _instance: &str) -> Result<(), PluginError> {
        Err(self.unexpected())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        Err(self.unexpected())
    }
}

struct OwnedGrid {
    surface: String,
}

impl OwnedGrid {
    fn new(surface: &str) -> Self {
        Self { surface: surface.to_owned() }
    }

    fn instance(&self) -> String {
        format!("{}:instance", self.surface)
    }
}

impl GridProvider for OwnedGrid {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::new(self.surface.clone(), "fubsheet")]
    }

    fn open(
        &mut self,
        surface: &str,
        _source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        if surface != self.surface {
            return Err(PluginError::Unserved("surface owner mismatch".into()));
        }
        Ok(GridSession {
            instance: self.instance(),
            revision,
            sheets: vec![GridSheet {
                id: "main".into(),
                name: "Main".into(),
                row_count: 1,
                column_count: 1,
            }],
        })
    }

    fn window(
        &mut self,
        _instance: &str,
        _request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        Err(PluginError::NotFound("test window not implemented".into()))
    }

    fn apply(
        &mut self,
        _instance: &str,
        _request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        Err(PluginError::NotFound("test apply not implemented".into()))
    }

    fn reload(
        &mut self,
        _instance: &str,
        _expected: Revision,
        _source: &str,
        _revision: Revision,
    ) -> Result<GridSession, PluginError> {
        Err(PluginError::NotFound("test reload not implemented".into()))
    }

    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        if instance == self.instance() {
            Ok(())
        } else {
            Err(PluginError::NotFound("instance belongs to another surface".into()))
        }
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        Ok(())
    }
}
impl Counter {
    fn spec(id: &str) -> ViewSpec {
        ViewSpec::new(id, id, ViewSurface::RightSidebar)
    }
}

impl ViewProvider for Counter {
    /// Dichiarare non è rileggersi: questa non passa da `views()`, o il
    /// conteggio che questo banco tiene direbbe due dove il kernel ha chiesto
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        *self.views.lock().unwrap() += 1;
        // una volta sola.
        let mut all = vec![Counter::spec("prova.view")];
        if *self.second.lock().unwrap() {
            all.push(Counter::spec("prova.altra"));
        }
        all
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("hello"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}
#[derive(Clone)]
struct InterestProbe {
    panic_next: Arc<Mutex<bool>>,
    calls: Arc<Mutex<u32>>,
}

impl ViewProvider for InterestProbe {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        *self.calls.lock().unwrap() += 1;
        if *self.panic_next.lock().unwrap() {
            *self.panic_next.lock().unwrap() = false;
            panic!("interests exploded");
        }
        ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new("prova.interessi", "Interessi", ViewSurface::RightSidebar).with_params(
                vec![ParamSpec::new(
                    "mode",
                    "Mode",
                    ParamKind::Choice(vec![Choice::new("ok", "OK")]),
                )
                .required()],
            ),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("interessi"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

impl CommandProvider for Counter {
    fn commands(&self) -> Vec<CommandSpec> {
        *self.commands.lock().unwrap() += 1;

        vec![CommandSpec::new("prova.command", "Command")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::done())
    }
}

struct Text;

impl FormatProvider for Text {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.txt", "Text", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut m = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        m.text = source.text().unwrap_or_default().to_string();
        Ok(m)
    }
    fn render_html(&self, _m: &DocumentModel, _or: &RenderOptions) -> Result<String, FormatError> {
        Ok(String::new())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

fn workspace(docs: &[&str]) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    for name in docs {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "body").unwrap();
    }
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(Text)).expect("registration");
    let mut ws = Workspace::new(&root, registry).expect("vault opens successfully");
    // --- un formato finto, per avere dei documenti ------------------------------
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    ws.register_core_feature("prova", "prova")
        .expect("declared");
    ws.reindex().expect("reindex");
    (dir, ws)
}

// kernel non presta capacità a una stringa.
/// Le spec si chiedono **una volta**, alla registrazione.
///
/// Prima `view_owner` interrogava ogni provider registrato per risolvere un id,
/// e `check_params` richiamava il vincitore per convalidare i parametri: due
#[test]
fn specs_are_queried_only_once() {
    let (_g, mut ws) = workspace(&[]);
    let provider = Counter::default();
    let views = Arc::clone(&provider.views);
    let commands = Arc::clone(&provider.commands);
    let second = Arc::clone(&provider.second);

    ws.register_view_provider(
        "prova",
        Box::new(Counter {
            views: Arc::clone(&views),
            commands: Arc::clone(&commands),
            second: Arc::clone(&second),
        }),
    )
    .expect("registered");
    ws.register_command_provider(
        "prova",
        Box::new(Counter {
            views: Arc::clone(&views),
            commands: Arc::clone(&commands),
            second: Arc::clone(&second),
        }),
    )
    .expect("registered");
    drop(provider);
    assert_eq!(*views.lock().unwrap(), 1, "once at registration");
    assert_eq!(*commands.lock().unwrap(), 1);

    let instance = ViewInstance::only("prova.view");
    for _ in 0..5 {
        assert_eq!(ws.views().len(), 1);
        ws.render_view(&instance).expect("render");
        ws.view_action(&instance, UiAction::new("click"))
            .expect("action");
        assert_eq!(ws.commands().len(), 1);
        ws.invoke_command(
            "prova.command",
            serde_json::Value::Null,
            InvokeMode::Apply,
            fub_abi::Actor::User,
        )
        .expect("invocation");
    }
    assert_eq!(
        (*views.lock().unwrap(), *commands.lock().unwrap()),
        (1, 1),
        "five renders, five actions, five invocations: and nobody asked the \
         provider for what it had already said"
    );
}

#[test]
fn view_interests_validates_params_and_contains_provider_panic() {
    let (_g, mut ws) = workspace(&[]);
    let panic_next = Arc::new(Mutex::new(false));
    let calls = Arc::new(Mutex::new(0));
    let probe = InterestProbe {
        panic_next: Arc::clone(&panic_next),
        calls: Arc::clone(&calls),
    };
    ws.register_view_provider("prova", Box::new(probe))
        .expect("registered");
    *panic_next.lock().unwrap() = true;
    *calls.lock().unwrap() = 0;

    let invalid = ViewInstance::new(
        "prova.interessi",
        "invalid",
        serde_json::json!({"mode": "not-an-option"}),
    );
    assert!(matches!(
        ws.view_interests(&invalid),
        Err(PluginError::BadArgs(_))
    ));
    assert_eq!(
        *calls.lock().unwrap(),
        0,
        "invalid params never reach interests"
    );

    let valid = ViewInstance::new(
        "prova.interessi",
        "valid",
        serde_json::json!({"mode": "ok"}),
    );
    assert!(matches!(
        ws.view_interests(&valid),
        Err(PluginError::Internal(_))
    ));
    assert_eq!(*calls.lock().unwrap(), 1);
    ws.view_interests(&valid).expect("workspace remains usable");
    assert_eq!(*calls.lock().unwrap(), 2);
}

/// giri per azione, e con le istanze quel percorso è quello di ogni click.
/// Chi cambia idea **lo dice**: è l'altra metà di «le spec sono dato di
#[test]
fn a_provider_that_changes_its_mind_declares_it() {
    let (_g, mut ws) = workspace(&[]);
    let provider = Counter::default();
    let second = Arc::clone(&provider.second);
    ws.register_view_provider("prova", Box::new(provider))
        .expect("registered");

    // registrazione», ed è ciò che impedisce alla verità di stare in due posti.
    assert_eq!(
        ws.views().len(),
        1,
        "the kernel responds what was declared to it, not what the provider \
         thinks now"
    );
    assert!(matches!(
        ws.render_view(&ViewInstance::only("prova.altra")),
        Err(PluginError::UnknownView(_))
    ));

    *second.lock().unwrap() = true;
    ws.refresh_specs("prova").expect("the new names are its");
    assert_eq!(ws.views().len(), 2);
    ws.render_view(&ViewInstance::only("prova.altra"))
        .expect("now it exists");
}

/// La lista dei documenti è **a finestra**, e l'ordine ce l'ha per costruzione.
///
/// È il metodo con cui un provider si guarda intorno: senza finestra clona
/// tutto il vault a ogni chiamata, e chi ne vuole venti paga comunque
#[test]
fn the_document_list_has_a_page_and_a_total() {
    let (_g, mut ws) = workspace(&["b.txt", "a.txt", "sub/c.txt", "d.txt"]);

    let all = ws.with_host("prova", |host| host.list_documents(None).expect("listing"));
    assert_eq!(
        all.items.iter().map(|d| d.0.as_str()).collect::<Vec<_>>(),
        ["a.txt", "b.txt", "d.txt", "sub/c.txt"],
        "in id order, and the order does not impose itself on every call: the \
         cache is sorted by construction"
    );
    assert_eq!(all.total, 4);

    let mut walked = Vec::new();
    for offset in [0, 2] {
        let page = ws.with_host("prova", |host| {
            host.list_documents(Some(Page::new(offset, 2)))
                .expect("page")
        });
        assert_eq!(page.total, 4, "the total is of the vault, not the page");
        assert_eq!(page.offset, offset);
        walked.extend(page.items);
    }
    assert_eq!(walked, all.items, "two pages reconstruct the listing");

    let beyond = ws.with_host("prova", |host| {
        host.list_documents(Some(Page::new(99, 5)))
            .expect("beyond the end")
    });
    assert!(
        beyond.items.is_empty(),
        "beyond the end is empty, not an error"
    );
    assert_eq!(beyond.total, 4);
}

#[test]
fn incompatible_grid_surface_falls_back_without_invoking_provider() {
    let (_g, mut ws) = workspace(&[]);
    let calls = Arc::new(Mutex::new(0));
    let permit = ws.registration_permit("prova").expect("declared");
    let mut prepared = fub_kernel::workspace::PreparedRegistration::grid(Box::new(
        IncompatibleGrid {
            calls: Arc::clone(&calls),
        },
    ))
    .expect("surface declaration is structurally valid");
    ws.commit_registration(&permit, &mut prepared)
        .expect("grid provider registered");

    let surface = ws
        .grid_surfaces()
        .into_iter()
        .find(|surface| surface.id == "future.sheet")
        .expect("surface retained for negotiation");
    assert_eq!(surface.family, "future-grid");
    assert!(matches!(
        ws.prepare_grid_call("future.sheet"),
        Err(PluginError::Unserved(_))
    ));
    assert_eq!(
        *calls.lock().unwrap(),
        0,
        "incompatible family/version must not reach provider"
    );
}
#[test]
fn grid_surface_owner_collision_and_cross_surface_instance_are_rejected() {
    let (_g, mut ws) = workspace(&[]);
    ws.register_core_feature("second", "second").expect("declared");

    let first_permit = ws.registration_permit("prova").expect("declared");
    let mut first = fub_kernel::workspace::PreparedRegistration::grid(Box::new(
        OwnedGrid::new("prova.sheet"),
    ))
    .expect("first surface is valid");
    ws.commit_registration(&first_permit, &mut first)
        .expect("first provider registered");

    let second_permit = ws.registration_permit("second").expect("declared");
    let mut duplicate = fub_kernel::workspace::PreparedRegistration::grid(Box::new(
        OwnedGrid::new("prova.sheet"),
    ))
    .expect("duplicate declaration is structurally valid");
    let error = ws
        .commit_registration(&second_permit, &mut duplicate)
        .expect_err("a surface has one owner");
    assert!(matches!(error, RegistryError::Claimed { id, .. } if id == "prova.sheet"));

    let mut second = fub_kernel::workspace::PreparedRegistration::grid(Box::new(
        OwnedGrid::new("second.sheet"),
    ))
    .expect("second surface is valid");
    ws.commit_registration(&second_permit, &mut second)
        .expect("second provider registered under its own surface");

    let revision = Revision::of("grid source");
    let first_call = ws.prepare_grid_call("prova.sheet").expect("first owner");
    let second_call = ws.prepare_grid_call("second.sheet").expect("second owner");
    let session = first_call
        .open("prova.sheet", "grid source", revision)
        .expect("first provider opens");
    assert!(matches!(
        second_call.close(&session.instance),
        Err(PluginError::NotFound(_))
    ));
    first_call
        .close(&session.instance)
        .expect("the owning surface closes its instance");
}
