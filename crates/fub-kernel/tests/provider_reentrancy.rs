//! La semantica di consegna degli eventi durante le chiamate ai provider:
//! **gli eventi arrivano dopo che la tua chiamata è tornata**, mai dentro il
//! suo frame.
//!
//! Il caso che ha motivato la regola è il plugin che è insieme view e handler
//! (il versioning): il provider scrive un documento dentro `on_action`, la
//! scrittura emette eventi, e senza la guardia `in_provider_call` gli handler
//! girerebbero *sincronamente dentro il frame di `on_action`* — in nativo
//! funziona, ma a M5 il component model vieta la rientranza di un'istanza e
//! quel plugin trapperebbe a runtime. La semantica va inchiodata prima del
//! freeze, e questo test la inchioda.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::error::PluginError;
use fub_abi::event::{EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::traits::{
    EventHandler, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::TestoDiProva;

type Log = Arc<Mutex<Vec<String>>>;

/// Handler che annota ogni evento ricevuto: se un suo record compare fra
/// "prima" e "dopo" del provider, la consegna è rientrata nel frame.
struct Recorder(Log);

impl EventHandler for Recorder {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let event = &notice.event;
        self.0
            .lock()
            .unwrap()
            .push(format!("handler:{:?}", event.kind()));
        Ok(())
    }
}

/// View il cui `on_action` scrive un documento via `HostApi` — il gesto del
/// versioning — e mette a verbale l'inizio e la fine della propria chiamata.
struct WritingView(Log);

impl ViewProvider for WritingView {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            "scrivente",
            "Scrivente",
            ViewSurface::RightSidebar,
        )]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("ok"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        self.0.lock().unwrap().push("on_action:inizio".into());
        host.write_document(&DocId::new("nota.md"), "scritto dal provider", None)?;
        self.0.lock().unwrap().push("on_action:fine".into());
        Ok(ViewUpdate::None)
    }
}

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("md").dentro_un_pre().boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    for plugin in ["recorder", "scrivente", "prova.plugin"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
    (dir, ws)
}

#[test]
fn events_emitted_inside_on_action_are_delivered_after_the_call_returns() {
    let (_dir, mut ws) = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registrato");
    ws.register_view_provider("scrivente", Box::new(WritingView(log.clone())))
        .expect("registrato");

    ws.view_action(&ViewInstance::only("scrivente"), UiAction::new("scrivi"))
        .expect("l'azione riesce");

    let log = log.lock().unwrap();
    let fine = log
        .iter()
        .position(|r| r == "on_action:fine")
        .expect("il provider è arrivato in fondo");
    let handler_records: Vec<usize> = log
        .iter()
        .enumerate()
        .filter(|(_, r)| r.starts_with("handler:"))
        .map(|(i, _)| i)
        .collect();
    assert!(
        !handler_records.is_empty(),
        "la scrittura ha emesso eventi e l'handler deve riceverli: {log:?}"
    );
    assert!(
        handler_records.iter().all(|&i| i > fine),
        "gli eventi devono arrivare DOPO che `on_action` è tornata, mai dentro \
         il suo frame (a M5 la rientranza di un'istanza trappa): {log:?}"
    );
}

#[test]
fn events_emitted_through_with_host_are_delivered_after_the_closure_returns() {
    let (_dir, mut ws) = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registrato");

    ws.with_host("prova.plugin", |host| {
        host.write_document(&DocId::new("altra.md"), "via with_host", None)
            .unwrap();
        assert!(
            log.lock().unwrap().is_empty(),
            "dentro la chiusura la coda non si drena"
        );
    });

    assert!(
        !log.lock().unwrap().is_empty(),
        "a chiusura tornata gli eventi accodati vengono consegnati"
    );
}
