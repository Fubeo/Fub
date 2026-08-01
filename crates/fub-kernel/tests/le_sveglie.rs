//! **Un abbonamento non sa dire quando** (§22.1,
//! [decisione 0069](../../../docs/decisions/0069-cosa-sa-dire-un-abbonamento.md)).
//!
//! Il no della [0013](../../../docs/decisions/0013-elenco-delle-capacita.md) al
//! tempo differito resta giusto e la sua ragione no: «il kernel è sincrono e non
//! possiede thread» era vera fino alla
//! [0032](../../../docs/decisions/0032-il-runner-dei-job.md). A tenere in piedi
//! la conclusione è l'**altra** regola della 0013 — *ciò che si limita a
//! informare è un evento* — e una sveglia informa.
//!
//! Ciò che mancava non era lo scheduler: era **dove scriverlo**. Queste prove
//! guardano la metà che è contratto, cioè la dichiarazione e chi la valuta; che
//! il tempo passi davvero è affare del pool, e lo prova
//! `crates/fub-host/tests/il_runner.rs`.
//!
//! La prova che conta più di tutte è la terza: una dichiarazione che il kernel
//! non valuta è **peggio della sua assenza**, perché mente al plugin che ci ha
//! creduto — ed è esattamente l'errore per cui questa voce era stata ritirata
//! una volta ([0063](../../../docs/decisions/0063-la-maschera-e-dell-esemplare.md)).

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::error::PluginError;
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::traits::{
    EventHandler, HostApi, PluginManifest, PluginPermissions, TimerSchedule, TimerSpec,
};
use fub_kernel::{FormatRegistry, Trust, Workspace};
use fub_testkit::TestoDiProva;

type Log = Arc<Mutex<Vec<String>>>;

struct Spia(Log);

impl EventHandler for Spia {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::TimerFired])
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if let Event::TimerFired { owner, timer } = &notice.event {
            self.0.lock().unwrap().push(format!("{owner}/{timer}"));
        }
        Ok(())
    }
}

const SPIA: &str = "test.spia";
const ACME: &str = "com.acme.tasks";

fn ogni(secondi: u64, nome: &str) -> TimerSpec {
    TimerSpec {
        id: nome.to_string(),
        schedule: TimerSchedule::Every { seconds: secondi },
    }
}

fn vault(timers: Vec<TimerSpec>) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("txt").boxed())
        .expect("formato");
    let mut ws = Workspace::new(&root, registry);
    ws.register_core_feature(SPIA, SPIA).expect("dichiarato");
    ws.register_plugin(
        PluginManifest::new(ACME, ACME)
            .granting(PluginPermissions::core())
            .waking(timers),
        Trust::Community,
    )
    .expect("dichiarato");
    let log: Log = Arc::default();
    ws.register_event_handler(SPIA, Box::new(Spia(log.clone())))
        .expect("registrato");
    (dir, ws, log)
}

/// Il posto dove un plugin dichiara un timer c'è, e chi lo legge lo trova.
#[test]
fn a_declared_timer_is_visible_to_whoever_schedules() {
    let (_dir, ws, _log) = vault(vec![ogni(3600, "sync"), ogni(60, "check")]);
    let mut viste: Vec<String> = ws
        .declared_timers()
        .into_iter()
        .map(|(owner, spec)| format!("{owner}/{}", spec.id))
        .collect();
    viste.sort();
    assert_eq!(
        viste,
        vec![
            "com.acme.tasks/check".to_string(),
            "com.acme.tasks/sync".to_string()
        ]
    );
}

/// Una sveglia che suona è un **evento**, e arriva a chi si è abbonato alla sua
/// specie come qualunque altro.
#[test]
fn a_timer_that_rings_is_an_event_like_any_other() {
    let (_dir, mut ws, log) = vault(vec![ogni(3600, "sync")]);
    assert!(ws.fire_timer(ACME, "sync"));
    assert_eq!(
        *log.lock().unwrap(),
        vec!["com.acme.tasks/sync".to_string()]
    );
}

/// **La riga che rende la dichiarazione valutata.**
///
/// Il kernel non fa suonare una sveglia che nessuno ha dichiarato: né di un
/// nome inventato, né di un componente che non c'è. Senza questo controllo il
/// manifest sarebbe un posto dove *scrivere* un timer e non il posto da cui il
/// timer viene — e uno scheduler che si tiene una copia dell'elenco resterebbe
/// l'unica autorità su chi si sveglia.
#[test]
fn nobody_rings_a_bell_that_was_not_declared() {
    let (_dir, mut ws, log) = vault(vec![ogni(3600, "sync")]);
    assert!(
        !ws.fire_timer(ACME, "inventata"),
        "un nome che il manifest non porta non suona"
    );
    assert!(
        !ws.fire_timer("com.altro.note", "sync"),
        "e nemmeno il nome giusto di un componente che non l'ha dichiarato"
    );
    assert!(
        log.lock().unwrap().is_empty(),
        "e non ne è uscito nessun evento: ricevuti {:?}",
        log.lock().unwrap()
    );
}

/// Un componente che se ne va si porta via le proprie sveglie, e non c'è un
/// secondo registro da ricordarsi di ripulire.
#[test]
fn a_component_that_leaves_takes_its_alarms_with_it() {
    let (_dir, mut ws, log) = vault(vec![ogni(3600, "sync")]);
    assert!(ws.fire_timer(ACME, "sync"));
    ws.deactivate_plugin(ACME).expect("disattivato");
    assert!(
        ws.declared_timers().is_empty(),
        "la sorgente è il manifest, e il manifest se n'è andato con lui"
    );
    assert!(
        !ws.fire_timer(ACME, "sync"),
        "e la sveglia di un componente disattivato non suona"
    );
    assert_eq!(log.lock().unwrap().len(), 1);
}

/// Due sveglie omonime sarebbero due eventi indistinguibili da chi li riceve, e
/// una senza nome non sarebbe riconoscibile affatto: si rifiutano alla
/// dichiarazione, che è l'unico momento in cui c'è qualcuno a cui dirlo.
#[test]
fn two_alarms_with_the_same_name_are_refused() {
    for timers in [
        vec![ogni(60, "sync"), ogni(3600, "sync")],
        vec![ogni(60, "")],
    ] {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        let mut ws = Workspace::new(&root, FormatRegistry::new());
        let esito = ws.register_plugin(
            PluginManifest::new(ACME, ACME).waking(timers),
            Trust::Community,
        );
        assert!(esito.is_err(), "doveva rifiutare");
    }
}

/// La regola di **quando** suona sta nel contratto, e non nell'host: due host
/// non devono avere due idee di cosa voglia dire «ogni ora».
#[test]
fn the_contract_says_when_the_nth_ring_is_due() {
    let ogni_ora = TimerSchedule::Every { seconds: 3600 };
    assert_eq!(ogni_ora.nth_after(0), Some(3600));
    assert_eq!(ogni_ora.nth_after(2), Some(10800));

    // Una sveglia sola suona una volta sola, e poi non ha una prossima: è la
    // differenza fra le due forme, e chi la ignorasse la farebbe suonare per
    // sempre.
    let fra_dieci_minuti = TimerSchedule::After { seconds: 600 };
    assert_eq!(fra_dieci_minuti.nth_after(0), Some(600));
    assert_eq!(fra_dieci_minuti.nth_after(1), None);

    // Zero secondi non è «mai» e non è un ciclo stretto infinito: è un secondo.
    // Una divisione per zero qui sarebbe un pool che gira a vuoto su un numero
    // che qualcuno ha scritto per sbaglio nel proprio manifest.
    assert_eq!(TimerSchedule::Every { seconds: 0 }.nth_after(0), Some(1));
}
