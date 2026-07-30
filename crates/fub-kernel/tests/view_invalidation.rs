//! L'invito a ridisegnare che arriva da un **provider** (§2.5), e il giro che
//! deve fare per arrivare a chi disegna.
//!
//! Prima della seduta 2 il protocollo di view era pull-only: `ViewSpec::refresh`
//! è una maschera sugli eventi *del kernel* e `ViewUpdate` esiste solo come
//! risposta a `on_action`, quindi un provider che finiva un lavoro lungo — un
//! job, una risposta dalla rete, un calcolo — non aveva **modo di dire
//! «ridisegnami»** se non emettendo un `Event::Custom`, cioè svegliando ogni
//! handler e ogni view del sistema.
//!
//! Che sia un evento e non una capacità `invalidate_view` è la regola della
//! decisione 0013: *una capacità è ciò di cui il chiamante ha bisogno della
//! risposta per proseguire; ciò che si limita a informare è un evento.* Questo
//! test prova le tre conseguenze di quella scelta: l'invito **passa** dal bus,
//! porta l'**origine** (che una capacità si sarebbe dovuta far dichiarare da
//! chi la chiama), e rispetta la consegna differita — arriva **dopo** che la
//! chiamata del provider è tornata.
//!
//! Sull'origine, la conseguenza che val la pena aver visto in un test: l'attore
//! è **chi ha chiesto**, non chi ha emesso (decisione 0012). Un invito che nasce
//! dal click di qualcuno porta `User` anche se a scriverlo è stato il provider —
//! *invocare non è entrare*. Chi disegna non ne ha bisogno per ridisegnare, ma
//! chi un giorno vorrà capire perché una view si ridisegna venti volte al minuto
//! ha in mano la risposta, e non l'avrebbe avuta da un metodo.

use std::sync::{Arc, Mutex};

use fub_abi::error::PluginError;
use fub_abi::event::{Actor, Event, EventKind, EventMask, Notice};
use fub_abi::traits::{
    EventHandler, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_testkit::{Banco, Montato};

type Log = Arc<Mutex<Vec<String>>>;

/// Una view che, finito ciò che stava facendo, chiede di essere ridisegnata.
/// È il gesto che il §2.5 esiste per rendere possibile.
struct LavoroLungo(Log);

impl ViewProvider for LavoroLungo {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new("lenta", "Lenta", ViewSurface::RightSidebar)]
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
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        self.0.lock().unwrap().push("provider:inizio".into());
        host.emit(Event::ViewInvalidated {
            view: instance.view.clone(),
            // «tutte» = un dato che vale per ogni istanza è cambiato; altrimenti
            // si nomina la propria e le sorelle non pagano il ridisegno.
            instance: (action.action.0 != "tutte").then(|| instance.instance.clone()),
        });
        self.0.lock().unwrap().push("provider:fine".into());
        // Non c'è niente da rimpiazzare *adesso*: il senso dell'invito è
        // proprio che il ridisegno avviene fuori dal giro dell'azione.
        Ok(ViewUpdate::None)
    }
}

/// Chi ascolta gli inviti, e con essi l'origine.
struct Ascoltatore(Log);

impl EventHandler for Ascoltatore {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::ViewInvalidated])
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let Event::ViewInvalidated { view, instance } = &notice.event else {
            panic!("la maschera dice che arriva solo questo")
        };
        let attore = match &notice.origin.actor {
            Actor::Plugin { id } => format!("plugin:{id}"),
            altro => format!("{altro:?}"),
        };
        self.0
            .lock()
            .unwrap()
            .push(format!("invito:{view}/{instance:?} da {attore}"));
        Ok(())
    }
}

fn vault() -> Montato {
    Banco::nuovo()
        .senza_formato()
        .senza_scansione()
        .con_plugins(["ascoltatore", "test.lenta"])
        .monta()
}

#[test]
fn a_provider_can_ask_for_a_redraw_and_the_invitation_carries_its_origin() {
    let mut ws = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("ascoltatore", Box::new(Ascoltatore(log.clone())))
        .expect("registrato");
    ws.register_view_provider("test.lenta", Box::new(LavoroLungo(log.clone())))
        .expect("registrato");

    let istanza = ViewInstance::only("lenta");
    ws.view_action(&istanza, UiAction::new("vai"))
        .expect("l'azione va a buon fine");

    let righe = log.lock().unwrap().clone();
    assert_eq!(
        righe,
        vec![
            "provider:inizio".to_string(),
            "provider:fine".to_string(),
            // L'attore è chi ha CHIESTO — il click che è entrato nel kernel —
            // non il provider che ha emesso: la decisione 0012 letta da qui. E
            // *quale* view sia invecchiata sta nel payload dell'evento, quindi
            // non c'è nessun campo «mittente» da riempire a mano né da
            // riempire male.
            "invito:lenta/Some(\"lenta\") da User".to_string(),
        ],
        "l'invito passa dal bus, e passa DOPO che la chiamata del provider è \
         tornata — la stessa consegna differita di ogni altro evento"
    );
}

/// Un invito senza istanza vale per **tutte** le istanze di quella view: è ciò
/// che serve a chi ha ricalcolato un dato che vale per tutte, e chi ne ha
/// invecchiata una sola la nomina.
#[test]
fn an_invitation_without_an_instance_means_all_of_them() {
    let mut ws = vault();
    let log: Log = Arc::default();
    ws.register_event_handler("ascoltatore", Box::new(Ascoltatore(log.clone())))
        .expect("registrato");
    ws.register_view_provider("test.lenta", Box::new(LavoroLungo(log.clone())))
        .expect("registrato");

    ws.view_action(&ViewInstance::only("lenta"), UiAction::new("tutte"))
        .expect("l'azione va a buon fine");

    assert!(
        log.lock()
            .unwrap()
            .contains(&"invito:lenta/None da User".to_string()),
        "l'istanza assente attraversa il confine come assenza, non come stringa vuota"
    );
}
