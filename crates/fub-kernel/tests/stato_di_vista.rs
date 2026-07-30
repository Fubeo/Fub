//! Lo **stato di vista** visto dal kernel (§11.2,
//! [decisione 0037](../../../docs/decisions/0037-lo-stato-di-vista.md)): chi
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
use fub_testkit::{Banco, Montato};

fn vault() -> Montato {
    // I plugin di prova si dichiarano prima di registrare (§7.3): il kernel non
    // presta capacità a una stringa — `con_plugin` è quella dichiarazione.
    Banco::nuovo()
        .senza_formato()
        .senza_scansione()
        .con_plugin("prova")
        .monta()
}

const VIEW: &str = "prova.pannello";
/// L'azione con cui il pannello ricorda ciò che sta guardando.
const RICORDA: &str = "ricorda";

/// Un pannello che **ricorda**: scrive nello stato di vista quando gli si
/// chiede, e disegna ciò che ci trova. Non tiene niente in un campo suo — è
/// esattamente il punto.
struct Pannello;

impl ViewProvider for Pannello {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(VIEW, "Prova", ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        // Nessun esemplare → `None`, che qui si legge come «niente di ricordato»:
        // è il caso normale del primo disegno, non un errore.
        let ricordato = host
            .view_state("scroll")?
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "niente".into());
        Ok(UiNode::empty_state(ricordato))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if action.action.0 != RICORDA {
            return Ok(ViewUpdate::None);
        }
        host.set_view_state("scroll", Some(action.payload.clone()))?;
        Ok(ViewUpdate::None)
    }
}

/// Ciò che il pannello disegna, cioè ciò che ha ricordato.
fn disegnato(ws: &Workspace, instance: &str) -> String {
    let istanza = ViewInstance::new(VIEW, instance, serde_json::Value::Null);
    let node = ws.render_view(&istanza).expect("render");
    let UiKind::EmptyState { title, .. } = &node.kind else {
        panic!("questo pannello disegna un empty-state")
    };
    title.to_string()
}

fn ricorda(ws: &mut Workspace, instance: &str, cosa: &str) -> Result<ViewUpdate, PluginError> {
    let istanza = ViewInstance::new(VIEW, instance, serde_json::Value::Null);
    ws.view_action(
        &istanza,
        UiAction::new(RICORDA).with_payload(serde_json::json!(cosa)),
    )
}

fn con_pannello(ws: &mut Workspace) {
    ws.register_view_provider("prova", Box::new(Pannello))
        .expect("registrato");
}

/// Il giro intero, dal disegno all'azione e ritorno: un pannello che ricorda
/// ritrova ciò che ha ricordato, **senza tenere un campo suo**.
#[test]
fn un_pannello_ritrova_cio_che_ha_ricordato() {
    let mut ws = vault();
    con_pannello(&mut ws);

    assert_eq!(
        disegnato(&ws, VIEW),
        "niente",
        "il primo disegno non ha nulla"
    );
    ricorda(&mut ws, VIEW, "riga 40").expect("ricorda");
    assert_eq!(disegnato(&ws, VIEW), "riga 40");
}

/// La ragione per cui la chiave porta **l'esemplare** e non solo la view: lo
/// stesso pannello aperto due volte ha due stati, ed è il «per-pannello» che il
/// §11.2 chiedeva. Togli l'esemplare dalla chiave e questa prova cade.
#[test]
fn due_esemplari_dello_stesso_pannello_non_si_mescolano() {
    let mut ws = vault();
    con_pannello(&mut ws);

    ricorda(&mut ws, "uno", "riga 40").expect("ricorda");
    assert_eq!(disegnato(&ws, "uno"), "riga 40");
    assert_eq!(
        disegnato(&ws, "due"),
        "niente",
        "il secondo pannello non eredita lo scroll del primo"
    );

    ricorda(&mut ws, "due", "riga 900").expect("ricorda");
    assert_eq!(
        disegnato(&ws, "uno"),
        "riga 40",
        "…e il secondo non sovrascrive il primo"
    );
}

/// Un comando non disegna una view: scrivere lo stato di vista da lì è un
/// errore, e non un silenzio. Leggere invece è `None` — la differenza è
/// scritta nel contratto, e la ragione è che una lettura a vuoto è il caso
/// normale di chi non ha mai salvato, mentre una scrittura nel vuoto è qualcuno
/// che crede di ricordare e non ricorderà.
struct Comando {
    esiti: Arc<Mutex<Vec<String>>>,
}

impl CommandProvider for Comando {
    fn commands(&self) -> Vec<CommandSpec> {
        // **Scrivente**, o non si arriverebbe nemmeno a chiedersi di chi sia lo
        // stato di vista: un comando che si dichiara di sola lettura riceve un
        // host che gli rifiuta la scrittura prima, e il rifiuto dice quello. È
        // il cancello del §7.1, e vale anche per il ricordo di uno scroll.
        vec![CommandSpec::new("prova.comando", "Prova")
            .with_scope(CommandScope::writing(CommandReach::Vault))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let letto = host.view_state("scroll").expect("leggere non è un errore");
        self.esiti.lock().unwrap().push(format!("letto: {letto:?}"));
        let scritto = host.set_view_state("scroll", Some(serde_json::json!("riga 1")));
        self.esiti.lock().unwrap().push(match scritto {
            Err(e) => format!("scritto: {e}"),
            Ok(()) => "scritto: passata".into(),
        });
        Ok(CommandOutcome::done())
    }
}

#[test]
fn chi_non_sta_disegnando_una_view_non_ha_uno_stato_di_vista() {
    let mut ws = vault();
    let esiti = Arc::new(Mutex::new(Vec::new()));
    ws.register_command_provider(
        "prova",
        Box::new(Comando {
            esiti: esiti.clone(),
        }),
    )
    .expect("registrato");

    ws.invoke_command(
        "prova.comando",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("il comando gira");

    let esiti = esiti.lock().unwrap().clone();
    assert_eq!(esiti[0], "letto: None", "leggere a vuoto è il caso normale");
    assert!(
        esiti[1].contains("esemplare"),
        "scrivere nel vuoto dice perché: {}",
        esiti[1]
    );
}

/// Il recinto fra proprietari: due provider che usano **la stessa chiave** non
/// si vedono, perché l'id di chi scrive non è un parametro ma lo timbra l'host.
#[test]
fn due_provider_con_la_stessa_chiave_non_si_vedono() {
    let ws = vault();
    ws.set_view_state("uno", "i", "scroll", Some(serde_json::json!(1)))
        .expect("scrive");
    assert_eq!(
        ws.view_state("altro", "i", "scroll"),
        None,
        "la chiave di un proprietario non è quella di un altro"
    );
}

/// Lo stato di vista **non viaggia col vault**, e non è nemmeno del vault: sta
/// nel file della macchina, e lo stesso esemplare in due vault ha due stati.
#[test]
fn lo_stesso_pannello_in_due_vault_ricorda_due_cose() {
    let mut uno = vault();
    let mut due = vault();
    // Un file solo, condiviso: è come li apre l'host vero.
    let states = ViewStates::in_memory();
    uno = uno.adatta(|ws| ws.with_view_states(Arc::clone(&states)));
    due = due.adatta(|ws| ws.with_view_states(states));
    con_pannello(&mut uno);
    con_pannello(&mut due);

    ricorda(&mut uno, VIEW, "riga 40").expect("ricorda");
    assert_eq!(disegnato(&uno, VIEW), "riga 40");
    assert_eq!(
        disegnato(&due, VIEW),
        "niente",
        "il root del vault è la prima chiave: due vault, due stati"
    );
}
