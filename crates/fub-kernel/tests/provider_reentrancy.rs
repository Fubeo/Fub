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
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::{EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::traits::{
    EventHandler, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::SampleText;

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
            "Writing",
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
        self.0.lock().unwrap().push("on_action:start".into());
        host.write_document(
            &DocId::new("nota.md"),
            "written by the provider",
            WriteBase::Dictated,
        )?;
        self.0.lock().unwrap().push("on_action:end".into());
        Ok(ViewUpdate::None)
    }
}

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("md").inside_pre().boxed())
        .expect("no extension conflict");
    let mut ws = Workspace::new(&root, registry).expect("vault opens successfully");
    for plugin in ["recorder", "scrivente", "prova.plugin"] {
        ws.register_core_feature(plugin, plugin)
            .expect("declared");
    }
    (dir, ws)
}

#[test]
fn events_emitted_inside_on_action_are_delivered_after_the_call_returns() {
    let (_dir, mut ws) = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registered");
    ws.register_view_provider("scrivente", Box::new(WritingView(log.clone())))
        .expect("registered");

    ws.view_action(&ViewInstance::only("scrivente"), UiAction::new("scrivi"))
        .expect("action succeeds");

    let log = log.lock().unwrap();
    let end = log
        .iter()
        .position(|r| r == "on_action:end")
        .expect("the provider reached the end");
    let handler_records: Vec<usize> = log
        .iter()
        .enumerate()
        .filter(|(_, r)| r.starts_with("handler:"))
        .map(|(the, _)| the)
        .collect();
    assert!(
        !handler_records.is_empty(),
        "the write emitted events and the handler must receive them: {log:?}"
    );
    assert!(
        handler_records.iter().all(|&the| the > end),
        "events must arrive AFTER `on_action` has returned, never inside its \
         frame (at M5 instance reentrance traps): {log:?}"
    );
}

#[test]
fn events_emitted_through_with_host_are_delivered_after_the_closure_returns() {
    let (_dir, mut ws) = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registered");

    ws.with_host("prova.plugin", |host| {
        host.write_document(
            &DocId::new("altra.md"),
            "via with_host",
            WriteBase::Dictated,
        )
        .unwrap();
        assert!(
            log.lock().unwrap().is_empty(),
            "inside the closure the queue does not drain"
        );
    });

    assert!(
        !log.lock().unwrap().is_empty(),
        "once the closure returns the queued events are delivered"
    );
}
