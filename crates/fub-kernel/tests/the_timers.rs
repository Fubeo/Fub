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
use fub_abi::locale::Weekday;
use fub_abi::traits::{
    CivilTime, EventHandler, HostApi, PluginManifest, PluginPermissions, TimerSchedule, TimerSpec,
    WallClock,
};
use fub_kernel::{FormatRegistry, Trust, Workspace};
use fub_testkit::SampleExtractor;

type Log = Arc<Mutex<Vec<String>>>;

struct Spy(Log);

impl EventHandler for Spy {
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

const SPY: &str = "test.spy";
const ACME: &str = "com.acme.tasks";

fn every(seconds: u64, name: &str) -> TimerSpec {
    TimerSpec {
        id: name.to_string(),
        schedule: TimerSchedule::Every { seconds },
    }
}

fn vault(timers: Vec<TimerSpec>) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleExtractor::by_extension("txt").boxed())
        .expect("format");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    ws.register_core_feature(SPY, SPY).expect("declared");
    ws.register_plugin(
        PluginManifest::new(ACME, ACME)
            .granting(PluginPermissions::core())
            .waking(timers),
        Trust::Community,
    )
    .expect("declared");
    let log: Log = Arc::default();
    ws.register_event_handler(SPY, Box::new(Spy(log.clone())))
        .expect("registered");
    (dir, ws, log)
}

/// Il posto dove un plugin dichiara un timer c'è, e chi lo legge lo trova.
/// Il posto dove un plugin dichiara un timer c'è, e chi lo legge lo trova.
#[test]
fn a_declared_timer_is_visible_to_whoever_schedules() {
    let (_dir, ws, _log) = vault(vec![every(3600, "sync"), every(60, "check")]);
    let mut seen: Vec<String> = ws
        .declared_timers()
        .into_iter()
        .map(|(owner, spec)| format!("{owner}/{}", spec.id))
        .collect();
    seen.sort();
    assert_eq!(
        seen,
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
    let (_dir, mut ws, log) = vault(vec![every(3600, "sync")]);
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
    let (_dir, mut ws, log) = vault(vec![every(3600, "sync")]);
    assert!(
        !ws.fire_timer(ACME, "made_up"),
        "a name the manifest carries does not ring"
    );
    assert!(
        !ws.fire_timer("com.other.notes", "sync"),
        "and neither does the right name of a component that did not declare it"
    );
    assert!(
        log.lock().unwrap().is_empty(),
        "and no event came out: received {:?}",
        log.lock().unwrap()
    );
}

/// Un componente che se ne va si porta via le proprie sveglie, e non c'è un
/// secondo registro da ricordarsi di ripulire.
#[test]
fn a_component_that_leaves_takes_its_alarms_with_it() {
    let (_dir, mut ws, log) = vault(vec![every(3600, "sync")]);
    assert!(ws.fire_timer(ACME, "sync"));
    ws.deactivate_plugin(ACME).expect("deactivated");
    assert!(
        ws.declared_timers().is_empty(),
        "the source is the manifest, and the manifest left with it"
    );
    assert!(
        !ws.fire_timer(ACME, "sync"),
        "and the alarm of a deactivated component does not ring"
    );
    assert_eq!(log.lock().unwrap().len(), 1);
}

/// Due sveglie omonime sarebbero due eventi indistinguibili da chi li riceve, e
/// una senza nome non sarebbe riconoscibile affatto: si rifiutano alla
/// dichiarazione, che è l'unico momento in cui c'è qualcuno a cui dirlo.
/// dichiarazione, che è l'unico momento in cui c'è qualcuno a cui dirlo.
#[test]
fn two_alarms_with_the_same_name_are_refused() {
    for timers in [
        vec![every(60, "sync"), every(3600, "sync")],
        vec![every(60, "")],
    ] {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        let mut ws =
            Workspace::new(&root, FormatRegistry::new()).expect("the vault opens");
        let result = ws.register_plugin(
            PluginManifest::new(ACME, ACME).waking(timers),
            Trust::Community,
        );
        assert!(result.is_err(), "it was supposed to refuse");
    }
}

/// La regola di **quando** suona sta nel contratto, e non nell'host: due host
/// non devono avere due idee di cosa voglia dire «ogni ora».
#[test]
fn the_contract_says_when_the_nth_ring_is_two() {
    let every_hour = TimerSchedule::Every { seconds: 3600 };
    assert_eq!(every_hour.nth_after(0), Some(3600));
    assert_eq!(every_hour.nth_after(2), Some(10800));

    // Una sveglia sola suona una volta sola, e poi non ha una prossima: è la
    // differenza fra le due forme, e chi la ignorasse la farebbe suonare per
    // sempre.
    let in_ten_minutes = TimerSchedule::After { seconds: 600 };
    assert_eq!(in_ten_minutes.nth_after(0), Some(600));
    assert_eq!(in_ten_minutes.nth_after(1), None);

    // Zero secondi non è «mai» e non è un ciclo stretto infinito: è un secondo.
    // Una divisione per zero qui sarebbe un pool che gira a vuoto su un numero
    // che qualcuno ha scritto per sbaglio nel proprio manifest.
    assert_eq!(TimerSchedule::Every { seconds: 0 }.nth_after(0), Some(1));
}

// ---------------------------------------------------------------------------
// **Un orario di parete non è un intervallo** (§22.4, decisione 0091).
//
// Le prove qui sotto guardano la metà che è **contratto**: quali occorrenze
// esistono. *Quando* accadono — cioè il fuso e l'ora legale — è dell'host, e lo
// prova `crates/fub-host/src/wall.rs`.
// ---------------------------------------------------------------------------

/// **La trappola vera di questa voce, resa un test.**
///
/// `nth_after` è una firma di forma «tempo trascorso»: quanti secondi manchino
/// alle nove non è una funzione di *quante volte ha già suonato*, è una funzione
/// di *che ore sono adesso*, che quella firma non riceve. Un orario di parete
/// che ci passasse dentro sarebbe una sveglia dichiarata e non onorata — la
/// specie di bugia che la 0077 rifiuta nel registro dei comandi e la 0090 ha
/// rifiutato per le scorciatoie.
///
/// La risposta non è stata cambiare la firma: è stata **dichiararne una seconda
/// accanto**, che l'ora civile la riceve. Questo test tiene ferme le due metà
/// della risposta: che `nth_after` dica `None`, e che ci sia una domanda con cui
/// distinguere quel `None` da quello di un `after` che ha finito.
#[test]
fn a_wall_clock_is_not_an_elapsed_time_and_says_so() {
    let at_nine = TimerSchedule::AtWallClock(WallClock::daily(9, 0));
    assert_eq!(
        at_nine.nth_after(0),
        None,
        "the elapsed-time rule cannot express a wall clock"
    );

    // E il `None` non si confonde con quello di chi ha finito: c'è una domanda
    // fatta apposta, e le due famiglie si distinguono senza dedurre.
    // fatta apposta, e le due famiglie si distinguono senza dedurre.
    assert!(at_nine.wall_clock().is_some());
    assert!(TimerSchedule::After { seconds: 600 }.wall_clock().is_none());
    assert!(TimerSchedule::Every { seconds: 60 }.wall_clock().is_none());
}

/// La regola dell'ora civile è **pura** come la sorella, e sta nel contratto per
/// la stessa ragione: due host non devono avere due idee di quando siano le nove
/// del prossimo lunedì.
#[test]
fn the_contract_says_which_occurrences_exist() {
    // Il 15 gennaio 2026 è un giovedì.
    let now = CivilTime {
        year: 2026,
        month: 1,
        day: 15,
        hour: 10,
        minute: 30,
        second: 0,
    };

    // Ogni giorno alle 9: le nove di oggi sono passate, quindi è domani.
    let daily_at_9 = WallClock::daily(9, 0);
    let p = daily_at_9.next_after(now).expect("a next exists");
    assert_eq!((p.day, p.hour, p.minute), (16, 9, 0));
    // E l'ultima a oggi o prima è quella di stamattina.
    let u = daily_at_9.latest_upto(now).expect("a past one exists");
    assert_eq!((u.day, u.hour), (15, 9));

    // Più tardi oggi: è ancora oggi.
    let p = WallClock::daily(18, 45)
        .next_after(now)
        .expect("a next exists");
    assert_eq!((p.day, p.hour, p.minute), (15, 18, 45));

    // **Elenco vuoto = ogni giorno**, ed è la ragione per cui `daily` e `weekly`
    // sono un caso solo: la differenza è un campo, non un'aritmetica.
    let mondays_only = WallClock::daily(9, 0).on([Weekday::Monday]);
    let p = mondays_only.next_after(now).expect("a next exists");
    assert_eq!((p.day, p.weekday()), (19, Weekday::Monday));
    let u = mondays_only.latest_upto(now).expect("a past one exists");
    assert_eq!((u.day, u.weekday()), (12, Weekday::Monday));
}

/// Il calendario non si ferma alla fine del mese, né a quella dell'anno, né al
/// 28 febbraio di un anno bisestile: è aritmetica gregoriana vera, e questi sono
/// i tre punti in cui una scritta a mano si rompe.
/// i tre punti in cui una scritta a mano si rompe.
#[test]
fn the_calendar_rolls_over_months_years_and_leap_days() {
    let at_nine = WallClock::daily(9, 0);
    let evening = |year, month, day| CivilTime {
        year,
        month,
        day,
        hour: 23,
        minute: 0,
        second: 0,
    };

    let p = at_nine.next_after(evening(2026, 1, 31)).expect("next");
    assert_eq!((p.year, p.month, p.day), (2026, 2, 1));

    let p = at_nine.next_after(evening(2026, 12, 31)).expect("next");
    assert_eq!((p.year, p.month, p.day), (2027, 1, 1));

    // Il 2028 è bisestile: dopo il 28 febbraio viene il 29.
    let p = at_nine.next_after(evening(2028, 2, 28)).expect("next");
    assert_eq!((p.year, p.month, p.day), (2028, 2, 29));
    // Il 2026 non lo è.
    let p = at_nine.next_after(evening(2026, 2, 28)).expect("next");
    assert_eq!((p.year, p.month, p.day), (2026, 3, 1));

    // E all'indietro allo stesso modo.
    let morning = CivilTime {
        hour: 1,
        ..evening(2027, 1, 1)
    };
    let u = at_nine.latest_upto(morning).expect("past");
    assert_eq!((u.year, u.month, u.day), (2026, 12, 31));
}

/// Un orario che non sta su un orologio **non suona**, e non fa fallire la
/// registrazione del componente che l'ha scritto.
///
/// È la scelta deliberata di dove mettere l'errore: un manifest si legge quando
/// il componente entra, e rifiutare un componente intero per una sveglia storta
/// sarebbe sproporzionato — mentre non suonare è osservabile e ha un nome
/// (`WallClock::valid`).
#[test]
fn an_impossible_time_does_not_ring_and_does_not_refuse_the_component() {
    let broken = WallClock::daily(25, 0);
    assert!(!broken.valid());
    assert_eq!(broken.next_after(midnight()), None);
    assert_eq!(broken.latest_upto(midnight()), None);
    assert!(!WallClock::daily(9, 60).valid());

    let (_dir, ws, _log) = vault(vec![TimerSpec {
        id: "broken".into(),
        schedule: TimerSchedule::AtWallClock(broken),
    }]);
    assert_eq!(
        ws.declared_timers().len(),
        1,
        "the component still entered: the error belongs to the alarm, not to it"
    );
}

/// Una sveglia di parete è una sveglia come le altre: si dichiara nel manifest,
/// si trova in `declared_timers`, e quando suona è un evento.
#[test]
fn a_wall_clock_alarm_is_declared_and_fired_like_any_other() {
    let (_dir, mut ws, log) = vault(vec![TimerSpec {
        id: "digest".into(),
        schedule: TimerSchedule::AtWallClock(
            WallClock::daily(9, 0)
                .anchored("Europe/Rome")
                .catching_up(3600),
        ),
    }]);
    let declared = ws.declared_timers();
    assert_eq!(declared.len(), 1);
    let alarm = declared[0].1.schedule.wall_clock().expect("wall clock");
    assert_eq!(alarm.zone.as_deref(), Some("Europe/Rome"));
    assert_eq!(alarm.catch_up_seconds, 3600);

    assert!(ws.fire_timer(ACME, "digest"));
    assert_eq!(
        *log.lock().unwrap(),
        vec!["com.acme.tasks/digest".to_string()]
    );
}

fn midnight() -> CivilTime {
    CivilTime {
        year: 2026,
        month: 1,
        day: 15,
        hour: 0,
        minute: 0,
        second: 0,
    }
}
