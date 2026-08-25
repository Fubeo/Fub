//! Lo **stato di vista** visto dal kernel (§11.2,
//! [decisione 0037](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md)): chi
//! compone la chiave, chi non la può nominare, e cosa risponde chi lo chiede
//! fuori da una view.
//!
//! Le regole dello *store* — la potatura, il file dal futuro, quello illeggibile
//! che non si riscrive — stanno nei test di modulo di `viewstate.rs`, dove si
//! costruisce senza un workspace. Qui c'è ciò che si vede solo **attraverso il
//! contratto**: che l'esemplare lo timbra l'host, che due esemplari non si
//! mescolano, e che chi non sta disegnando non ha uno stato di vista.

use std::sync::{Arc, Mutex};

use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::traits::{
    CommandProvider, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiKind, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_kernel::{ViewStates, Workspace};
use fub_testkit::{Bench, Mounted};

fn vault() -> Mounted {
    // I plugin di prova si dichiarano prima di registrare (§7.3): il kernel non
    // presta capacità a una stringa — `con_plugin` è quella dichiarazione.
    Bench::new()
        .without_format()
        .without_scan()
        .with_plugin("test")
        .mounts()
}

const VIEW: &str = "test.panel";
/// L'azione con cui il pannello ricorda ciò che sta guardando.
const REMEMBER: &str = "remember";

/// Un pannello che **ricorda**: scrive nello stato di vista quando gli si
/// chiede, e disegna ciò che ci trova. Non tiene niente in un campo suo — è
/// esattamente il punto.
struct Panel;

impl ViewProvider for Panel {
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
        vec![ViewSpec::new(VIEW, "Test", ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        // Nessun esemplare → `None`, che qui si legge come «niente di ricordato»:
        // è il caso normale del primo disegno, non un errore.
        let remembered = host
            .view_state("scroll")?
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "nothing".into());
        Ok(UiNode::empty_state(remembered))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if action.action.0 != REMEMBER {
            return Ok(ViewUpdate::None);
        }
        host.set_view_state("scroll", Some(action.payload.clone()))?;
        Ok(ViewUpdate::None)
    }
}

/// Ciò che il pannello disegna, cioè ciò che ha ricordato.
fn drawn(ws: &Workspace, instance: &str) -> String {
    let inst = ViewInstance::new(VIEW, instance, serde_json::Value::Null);
    let node = ws.render_view(&inst).expect("render");
    let UiKind::EmptyState { title, .. } = &node.kind else {
        panic!("this panel draws an empty-state")
    };
    title.to_string()
}

fn remember(ws: &mut Workspace, instance: &str, what: &str) -> Result<ViewUpdate, PluginError> {
    let inst = ViewInstance::new(VIEW, instance, serde_json::Value::Null);
    ws.view_action(
        &inst,
        UiAction::new(REMEMBER).with_payload(serde_json::json!(what)),
    )
}

fn with_panel(ws: &mut Workspace) {
    ws.register_view_provider("test", Box::new(Panel))
        .expect("registered");
}

/// Il giro intero, dal disegno all'azione e ritorno: un pannello che ricorda
/// ritrova ciò che ha ricordato, **senza tenere un campo suo**.
#[test]
fn a_panel_finds_what_it_remembered() {
    let mut ws = vault();
    with_panel(&mut ws);

    assert_eq!(drawn(&ws, VIEW), "nothing", "the first draw has nothing");
    remember(&mut ws, VIEW, "line 40").expect("remember");
    assert_eq!(drawn(&ws, VIEW), "line 40");
}

/// La ragione per cui la chiave porta **l'esemplare** e non solo la view: lo
/// stesso pannello aperto due volte ha due stati, ed è il «per-pannello» che il
/// §11.2 chiedeva. Togli l'esemplare dalla chiave e questa prova cade.
#[test]
fn two_instances_of_the_same_panel_do_not_mix() {
    let mut ws = vault();
    with_panel(&mut ws);

    remember(&mut ws, "one", "line 40").expect("remember");
    assert_eq!(drawn(&ws, "one"), "line 40");
    assert_eq!(
        drawn(&ws, "two"),
        "nothing",
        "the second panel does not inherit the scroll of the first"
    );

    remember(&mut ws, "two", "line 900").expect("remember");
    assert_eq!(
        drawn(&ws, "one"),
        "line 40",
        "…and the second does not overwrite the first"
    );
}

/// Un comando non disegna una view: scrivere lo stato di vista da lì è un
/// errore, e non un silenzio. Leggere invece è `None` — la differenza è
/// scritta nel contratto, e la ragione è che una lettura a vuoto è il caso
/// normale di chi non ha mai salvato, mentre una scrittura nel vuoto è qualcuno
/// che crede di ricordare e non ricorderà.
struct Command {
    results: Arc<Mutex<Vec<String>>>,
}

impl CommandProvider for Command {
    fn commands(&self) -> Vec<CommandSpec> {
        // **Scrivente**, o non si arriverebbe nemmeno a chiedersi di chi sia lo
        // stato di vista: un comando che si dichiara di sola lettura riceve un
        // host che gli rifiuta la scrittura prima, e il rifiuto dice quello. È
        // il cancello del §7.1, e vale anche per il ricordo di uno scroll.
        vec![CommandSpec::new("test.command", "Test")
            .with_scope(CommandScope::writing(CommandReach::Vault))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let read = host.view_state("scroll").expect("reading is not an error");
        self.results.lock().unwrap().push(format!("read: {read:?}"));
        let written = host.set_view_state("scroll", Some(serde_json::json!("line 1")));
        self.results.lock().unwrap().push(match written {
            Err(and) => format!("written: {and}"),
            Ok(()) => "written: passed".into(),
        });
        Ok(CommandOutcome::done())
    }
}

#[test]
fn not_drawing_a_view_means_no_view_state() {
    let mut ws = vault();
    let results = Arc::new(Mutex::new(Vec::new()));
    ws.register_command_provider(
        "test",
        Box::new(Command {
            results: results.clone(),
        }),
    )
    .expect("registered");

    ws.invoke_command(
        "test.command",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("the command runs");

    let results = results.lock().unwrap().clone();
    assert_eq!(
        results[0], "read: None",
        "reading into nothing is the normal case"
    );
    assert!(
        results[1].contains("instance"),
        "writing into nothing explains why: {}",
        results[1]
    );
}

/// Il recinto fra proprietari: due provider che usano **la stessa chiave** non
/// si vedono, perché l'id di chi scrive non è un parametro ma lo timbra l'host.
/// si vedono, perché l'id di chi scrive non è un parametro ma lo timbra l'host.
#[test]
fn two_providers_with_the_same_key_do_not_see_each_other() {
    let ws = vault();
    ws.set_view_state("one", "i", "scroll", Some(serde_json::json!(1)))
        .expect("writes");
    assert_eq!(
        ws.view_state("other", "i", "scroll"),
        None,
        "one owner's key is not another's"
    );
}

/// Lo stato di vista **non viaggia col vault**, e non è nemmeno del vault: sta
/// nel file della macchina, e lo stesso esemplare in due vault ha due stati.
/// nel file della macchina, e lo stesso esemplare in due vault ha due stati.
#[test]
fn the_same_panel_in_two_vaults_remembers_two_things() {
    let mut one = vault();
    let mut two = vault();
    // Un file solo, condiviso: è come li apre l'host vero.
    let states = ViewStates::in_memory();
    one = one.adapt(|ws| ws.with_view_states(Arc::clone(&states)));
    two = two.adapt(|ws| ws.with_view_states(states));
    with_panel(&mut one);
    with_panel(&mut two);

    remember(&mut one, VIEW, "line 40").expect("remember");
    assert_eq!(drawn(&one, VIEW), "line 40");
    assert_eq!(
        drawn(&two, VIEW),
        "nothing",
        "the vault root is the first key: two vaults, two states"
    );
}
