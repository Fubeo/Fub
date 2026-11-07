//! I comandi in sola lettura **non tengono il turno di scrittura** (PA T3).
//!
//! Un comando che si è dichiarato di sola lettura gira col suo frame
//! ([`fub_kernel::PreparedReadOnlyCommand`]): mentre legge, chi salva salva, i
//! suoi eventi arrivano subito, e due letture girano insieme. Un comando che
//! scrive tiene invece il turno come prima.
//!
//! I comandi di prova si fermano su un cancello che apre il test: nessun
//! orologio fa da sincronizzazione. I limiti di tempo qui sotto sono larghi e
//! servono solo a non restare appesi quando il codice regredisce.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fub_abi::event::{EventMask, Notice};
use fub_abi::traits::{CommandProvider, EventHandler, HostApi, Plugin, PluginManifest};
use fub_abi::{DocId, PluginError, WriteBase};
use fub_host::registry::Registrar;
use fub_host::{Bundle, BundleClaim, Host, OnlyProviders, StartupBundle};
use fub_kernel::Trust;

const OWNER: &str = "test.turn";
/// Legge la nota e si ferma al cancello.
const READ: &str = "test.turn.read";
/// Di sola lettura: invoca [`READ`] da dentro, cioè per `HostApi::run_command`.
const OUTER: &str = "test.turn.outer";
/// Scrive la nota e si ferma al cancello, col turno in mano.
const WRITE: &str = "test.turn.write";
/// Di sola lettura, ma prova a scrivere.
const TRIES: &str = "test.turn.tries";
/// Di sola lettura, e finisce in errore.
const FAILS: &str = "test.turn.fails";
/// Di sola lettura, e invoca sé stesso.
const SELF: &str = "test.turn.self";

const NOTE: &str = "nota.md";
/// Quanto può metterci un salvataggio mentre una lettura è ferma: largo.
const SAVE_LIMIT: Duration = Duration::from_secs(1);
/// Quanto si aspetta un fatto che deve accadere: largo, solo per non appendersi.
const WATCHDOG: Duration = Duration::from_secs(10);

/// Il cancello dei comandi di prova, e il canale che dice chi ci è arrivato.
struct Gate {
    open: Mutex<bool>,
    opened: Condvar,
    arrived: Mutex<mpsc::Sender<&'static str>>,
}

impl Gate {
    fn new() -> (Arc<Gate>, mpsc::Receiver<&'static str>) {
        let (tx, rx) = mpsc::channel();
        let gate = Gate {
            open: Mutex::new(false),
            opened: Condvar::new(),
            arrived: Mutex::new(tx),
        };
        (Arc::new(gate), rx)
    }

    /// Dice che `who` è arrivato e aspetta che il test apra.
    fn wait(&self, who: &'static str) -> Result<(), PluginError> {
        let _ = self.arrived.lock().unwrap().send(who);
        let open = self.open.lock().unwrap();
        let (open, timeout) = self
            .opened
            .wait_timeout_while(open, WATCHDOG, |open| !*open)
            .unwrap();
        if timeout.timed_out() && !*open {
            return Err(PluginError::Internal("the gate never opened".into()));
        }
        Ok(())
    }

    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.opened.notify_all();
    }
}

struct Probe {
    gate: Arc<Gate>,
}

impl CommandProvider for Probe {
    fn commands(&self) -> Vec<CommandSpec> {
        let read = CommandScope::read_only();
        vec![
            CommandSpec::new(READ, "Read").with_scope(read),
            CommandSpec::new(OUTER, "Outer read").with_scope(read),
            CommandSpec::new(TRIES, "Tries to write").with_scope(read),
            CommandSpec::new(FAILS, "Fails").with_scope(read),
            CommandSpec::new(SELF, "Invokes itself").with_scope(read),
            CommandSpec::new(WRITE, "Write")
                .with_scope(CommandScope::writing(CommandReach::Document)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let note = DocId::new(NOTE);
        match command {
            READ => {
                let text = host.read_document(&note)?;
                self.gate.wait(READ)?;
                Ok(CommandOutcome::notify(text))
            }
            OUTER => host.run_command(READ, serde_json::Value::Null),
            WRITE => {
                host.write_document(&note, "dal comando", WriteBase::Dictated)?;
                self.gate.wait(WRITE)?;
                Ok(CommandOutcome::done())
            }
            TRIES => {
                host.write_document(&note, "di nascosto", WriteBase::Dictated)?;
                Ok(CommandOutcome::done())
            }
            FAILS => Err(PluginError::NotFound("on purpose".into())),
            SELF => host.run_command(SELF, serde_json::Value::Null),
            _ => Err(PluginError::BadArgs("unknown".into())),
        }
    }
}

/// Annota i documenti cambiati, per vedere **quando** arrivano.
struct Changes(Arc<Mutex<Vec<String>>>);

impl EventHandler for Changes {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let kind = format!("{:?}", notice.event.kind());
        if kind.contains("DocumentChanged") {
            self.0.lock().unwrap().push(kind);
        }
        Ok(())
    }
}

struct ProbeBundle {
    gate: Arc<Gate>,
    changes: Arc<Mutex<Vec<String>>>,
}

impl Bundle for ProbeBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(OWNER, "Turn probe")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        let mut failures = Vec::new();
        let probe = Probe {
            gate: Arc::clone(&self.gate),
        };
        if let Err(error) = registrar.register_command_provider(Box::new(probe)) {
            failures.push(error.to_string());
        }
        let changes = Changes(Arc::clone(&self.changes));
        if let Err(error) = registrar.register_event_handler(Box::new(changes)) {
            failures.push(error.to_string());
        }
        failures
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
    gate: Arc<Gate>,
    arrived: Mutex<mpsc::Receiver<&'static str>>,
    changes: Arc<Mutex<Vec<String>>>,
}

fn bench() -> Bench {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join(NOTE), "prima").expect("seed");
    let (gate, arrived) = Gate::new();
    let changes = Arc::new(Mutex::new(Vec::new()));
    let bundle = ProbeBundle {
        gate: Arc::clone(&gate),
        changes: Arc::clone(&changes),
    };
    let bundles = vec![StartupBundle::new(
        Arc::new(bundle),
        true,
        BundleClaim::new(),
    )];
    let host = Host::without_watcher().with_startup_source(Arc::new(bundles));
    host.open(&root).expect("the vault opens");
    host.wait_indexed(None).expect("indexed");
    Bench {
        _dir: dir,
        root,
        host,
        gate,
        arrived: Mutex::new(arrived),
        changes,
    }
}

fn invoke(host: &Host, command: &str) -> Result<CommandOutcome, PluginError> {
    host.invoke_user_command(None, command, serde_json::Value::Null, InvokeMode::Apply)
}

/// Salva la nota da un altro thread e dice se ha finito entro [`SAVE_LIMIT`].
/// Se non ha finito, apre il cancello prima di rispondere: così il thread del
/// comando e quello del salvataggio finiscono comunque, e il test fallisce
/// invece di restare appeso.
fn save_meanwhile<'s>(
    scope: &'s std::thread::Scope<'s, '_>,
    bench: &'s Bench,
    text: &'s str,
) -> Result<Result<(), PluginError>, RecvTimeoutError> {
    let (done_tx, done_rx) = mpsc::channel();
    scope.spawn(move || {
        let saved = bench
            .host
            .write_document(None, &DocId::new(NOTE), text, WriteBase::Dictated)
            .map(|_| ());
        let _ = done_tx.send(saved);
    });
    let outcome = done_rx.recv_timeout(SAVE_LIMIT);
    if outcome.is_err() {
        bench.gate.release();
    }
    outcome
}

fn arrived(bench: &Bench, who: &str) {
    let got = bench
        .arrived
        .lock()
        .unwrap()
        .recv_timeout(WATCHDOG)
        .expect("the command reaches its gate");
    assert_eq!(got, who);
}

#[test]
fn a_save_finishes_while_a_read_only_command_is_stopped() {
    let bench = bench();
    std::thread::scope(|scope| {
        let read = scope.spawn(|| invoke(&bench.host, READ));
        arrived(&bench, READ);

        bench.changes.lock().unwrap().clear();
        let saved = save_meanwhile(scope, &bench, "salvata durante la lettura");
        let changes = bench.changes.lock().unwrap().clone();
        bench.gate.release();
        let outcome = read.join().expect("the command thread");

        saved
            .expect("the save finished while the read was stopped")
            .expect("the save succeeded");
        assert!(
            !changes.is_empty(),
            "the events of the save arrived before the read ended"
        );
        let outcome = outcome.expect("the read finishes well");
        assert!(
            format!("{:?}", outcome.notify).contains("prima"),
            "the read saw the note as it was: {:?}",
            outcome.notify
        );
    });
}

#[test]
fn two_reads_run_together() {
    let bench = bench();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| invoke(&bench.host, READ));
        let second = scope.spawn(|| invoke(&bench.host, READ));
        let both = (0..2)
            .map(|_| bench.arrived.lock().unwrap().recv_timeout(WATCHDOG))
            .collect::<Result<Vec<_>, _>>();
        bench.gate.release();
        let first = first.join().expect("first thread");
        let second = second.join().expect("second thread");

        both.expect("both reads were at the gate at the same time");
        first.expect("the first read finishes");
        second.expect("the second read finishes");
    });
}

/// Il percorso dei comandi annidati (`JobHost::run_command`): una lettura
/// invocata da una lettura non prende il turno nemmeno lei.
#[test]
fn a_nested_read_does_not_take_the_turn_either() {
    let bench = bench();
    std::thread::scope(|scope| {
        let outer = scope.spawn(|| invoke(&bench.host, OUTER));
        arrived(&bench, READ);

        let saved = save_meanwhile(scope, &bench, "salvata durante la lettura annidata");
        bench.gate.release();
        let outcome = outer.join().expect("the command thread");

        saved
            .expect("the save finished while the nested read was stopped")
            .expect("the save succeeded");
        outcome.expect("the nested read finishes well");
    });
}

/// Il controllo negativo: chi scrive tiene ancora il turno, e una seconda
/// scrittura aspetta che finisca.
#[test]
fn a_writing_command_still_holds_the_turn() {
    let bench = bench();
    std::thread::scope(|scope| {
        let write = scope.spawn(|| invoke(&bench.host, WRITE));
        arrived(&bench, WRITE);
        assert!(
            bench.host.is_write_turn_held(None).expect("open"),
            "a writing command holds the write turn"
        );

        let (done_tx, done_rx) = mpsc::channel();
        let host = &bench.host;
        scope.spawn(move || {
            let saved = host
                .write_document(None, &DocId::new(NOTE), "dopo", WriteBase::Dictated)
                .map(|_| ());
            let _ = done_tx.send(saved);
        });
        let early = done_rx.recv_timeout(Duration::from_millis(200));
        bench.gate.release();
        write
            .join()
            .expect("the command thread")
            .expect("the writing command finishes");
        let late = done_rx.recv_timeout(WATCHDOG);

        assert!(
            matches!(early, Err(RecvTimeoutError::Timeout)),
            "the second write waited for the writing command: {early:?}"
        );
        late.expect("the second write finishes after the command")
            .expect("the second write succeeds");
    });
    let (text, _) = bench
        .host
        .read_document(None, &DocId::new(NOTE))
        .expect("reads");
    assert_eq!(text, "dopo", "the waiting write came last");
}

#[test]
fn a_read_only_command_that_tries_to_write_is_refused() {
    let bench = bench();
    let refused = invoke(&bench.host, TRIES);
    assert!(
        matches!(refused, Err(PluginError::PermissionDenied(_))),
        "{refused:?}"
    );
    let (text, _) = bench
        .host
        .read_document(None, &DocId::new(NOTE))
        .expect("reads");
    assert_eq!(text, "prima", "the note did not change");
}

#[test]
fn a_read_only_command_that_fails_leaves_the_vault_writable() {
    let bench = bench();
    let failed = invoke(&bench.host, FAILS);
    assert!(
        matches!(failed, Err(PluginError::NotFound(_))),
        "{failed:?}"
    );
    bench
        .host
        .write_document(None, &DocId::new(NOTE), "dopo", WriteBase::Dictated)
        .expect("the next write works");
}

#[test]
fn a_read_only_command_that_invokes_itself_is_refused() {
    let bench = bench();
    let refused = invoke(&bench.host, SELF);
    match refused {
        Err(PluginError::BadArgs(why)) => {
            let why = format!("{why:?}");
            assert!(why.contains(SELF), "{why}");
        }
        other => panic!("a command that invokes itself is refused: {other:?}"),
    }
}

#[test]
fn a_command_that_does_not_exist_is_refused() {
    let bench = bench();
    assert!(invoke(&bench.host, "test.turn.nobody").is_err());
}

#[test]
fn the_vault_closed_while_a_read_runs_does_not_take_its_outcome() {
    let bench = bench();
    std::thread::scope(|scope| {
        let read = scope.spawn(|| invoke(&bench.host, READ));
        arrived(&bench, READ);

        let (closed_tx, closed_rx) = mpsc::channel();
        let (host, root) = (&bench.host, &bench.root);
        scope.spawn(move || {
            let _ = closed_tx.send(host.close_vault(root));
        });
        let closed = closed_rx.recv_timeout(WATCHDOG);
        bench.gate.release();
        let outcome = read.join().expect("the command thread");

        let errors = closed
            .expect("the vault closes while the read is stopped")
            .expect("close");
        assert!(errors.is_empty(), "{errors:?}");
        assert!(
            matches!(outcome, Err(PluginError::Cancelled(_))),
            "the outcome of a closed vault is not applied: {outcome:?}"
        );
    });
}
