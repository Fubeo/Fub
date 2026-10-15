//! **Chi sta dentro un componente non resta in fila per un turno che lo aspetta**
//! (FUB-019).
//!
//! Il job di un componente tiene l'istanza per tutta la chiamata. Se un
//! salvataggio ha il turno di scrittura e aspetta quella stessa istanza (per il
//! parser, un hook, l'indice o un handler), il job che chiede il turno e il
//! salvataggio si aspettano a vicenda per sempre. Qui il salvataggio e l'istanza
//! sono finti a mano — nel grafo delle attese di [`fub_host::waits`] — perché
//! ciò che si prova è la porta del job, non un componente: con un componente
//! vero la prova sta in `fub-wasm-host/tests/the_instance_and_the_turn.rs`.
//!
//! Le capacità **senza esito** (`emit`, `report-progress`) non possono dire di
//! no: in un ciclo tornano senza aver fatto niente, e quelle con un esito
//! (`spawn-job`) dicono perché.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::text::Text;
use fub_abi::traits::{HostEvents, JobId, JobProgress, JobSpec};
use fub_abi::{Event, PluginError};
use fub_host::waits;
use fub_host::{Custody, Host, JobHost, NoWatcher};
use fub_kernel::Workspace;

const TOKEN: usize = 0xFB19;
const TIMEOUT: Duration = Duration::from_secs(10);

fn vault() -> (tempfile::TempDir, Host) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("semina");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("apertura");
    (dir, host)
}

fn spec() -> JobSpec {
    JobSpec {
        job: "demo.job:vuoto".to_string(),
        payload: serde_json::json!({}),
    }
}

fn is_cycle(error: &PluginError) -> bool {
    matches!(
        error,
        PluginError::Conflict(Text::Message(message)) if message.key == "host.turn.cycle"
    )
}

/// Le tre capacità che prendono il turno e che un job può chiamare da dentro un
/// componente. L'esito è quello di `spawn-job`, l'unica che ne ha uno.
fn the_job_asks_for_the_turn(workspace: Custody<Workspace>) -> Result<JobId, PluginError> {
    let mut host = JobHost::new(workspace, "demo.job").for_job(JobId(7));
    host.emit(Event::Custom {
        topic: "demo.job:dentro".to_string(),
        payload: serde_json::json!({}),
    });
    host.report_progress(JobProgress {
        done: 1,
        total: None,
        label: None,
    });
    host.spawn_job(spec())
}

/// Il salvataggio: tiene il turno e aspetta l'istanza `TOKEN`, finché il banco
/// non lo lascia andare.
fn a_save_that_waits_for_the_instance(
    workspace: &Custody<Workspace>,
) -> (mpsc::Sender<()>, thread::JoinHandle<()>) {
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let workspace = workspace.clone();
    let handle = thread::spawn(move || {
        let _turn = workspace.write_turn();
        let _wait = waits::wait_instance(TOKEN);
        ready_tx.send(()).expect("il banco aspetta");
        let _ = release_rx.recv();
    });
    ready_rx
        .recv_timeout(TIMEOUT)
        .expect("il salvataggio ha il turno e aspetta l'istanza");
    (release_tx, handle)
}

#[test]
fn in_a_cycle_the_capabilities_of_a_job_answer_instead_of_waiting() {
    let (_dir, host) = vault();
    let workspace = host.debug_workspace(None).expect("il vault corrente");

    // Il job: tiene l'istanza, e quando il banco glielo dice chiede il turno.
    let (held_tx, held_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let (outcome_tx, outcome_rx) = mpsc::channel();
    let job = {
        let workspace = workspace.clone();
        thread::spawn(move || {
            let _held = waits::hold_instance(TOKEN);
            held_tx.send(()).expect("il banco aspetta");
            go_rx.recv().expect("il banco lo lascia andare");
            outcome_tx
                .send(the_job_asks_for_the_turn(workspace))
                .expect("il banco aspetta l'esito");
        })
    };
    held_rx
        .recv_timeout(TIMEOUT)
        .expect("il job tiene l'istanza");

    let (release, save) = a_save_that_waits_for_the_instance(&workspace);
    go_tx.send(()).expect("il job c'è");

    let outcome = outcome_rx
        .recv_timeout(TIMEOUT)
        .expect("il job doveva uscire dalla chiamata invece di aspettare per sempre");
    release.send(()).expect("il salvataggio c'è");
    save.join().expect("il salvataggio finisce");
    job.join().expect("il job finisce");

    let error = outcome.expect_err("il turno era dentro un ciclo: spawn-job doveva cedere");
    assert!(
        is_cycle(&error),
        "il conflitto doveva dire perché: {error:?}"
    );
}

/// Il controllo: stesse chiamate, nessun ciclo. `spawn-job` non cede (la ragione
/// per cui l'esito non è un conflitto di ciclo è la sola cosa che cambia).
#[test]
fn without_a_cycle_the_same_calls_do_not_yield() {
    let (_dir, host) = vault();
    let workspace = host.debug_workspace(None).expect("il vault corrente");
    let _held = waits::hold_instance(TOKEN);

    // Il turno è libero: il job lo prende, anche se tiene un'istanza.
    let outcome = the_job_asks_for_the_turn(workspace);
    assert!(
        !outcome.as_ref().err().is_some_and(is_cycle),
        "nessuno aspettava l'istanza: cedere qui sarebbe un rifiuto senza ragione: {outcome:?}"
    );
}

#[test]
fn a_cancelled_job_stops_queueing_for_the_turn() {
    let (_dir, host) = vault();
    let workspace = host.debug_workspace(None).expect("il vault corrente");
    // Il banco tiene il turno per tutto il tempo: il job non può riuscire, e se
    // torna è perché ha visto la bandiera. Prima l'attesa era nativa e un job
    // annullato restava in fila finché il turno non si liberava.
    let _turn = workspace.write_turn();
    let flag = Arc::new(AtomicBool::new(false));

    let waiting = {
        let workspace = workspace.clone();
        let flag = Arc::clone(&flag);
        thread::spawn(move || {
            let mut host = JobHost::new(workspace, "demo.job").cancelled_by(flag);
            host.spawn_job(spec())
        })
    };
    flag.store(true, Ordering::Relaxed);

    let outcome = waiting.join().expect("il job");
    assert!(
        matches!(outcome, Err(PluginError::Cancelled(_))),
        "il job annullato doveva smettere di aspettare: {outcome:?}"
    );
}

/// **Una capacità nuova di `JobHost` non può prendere il turno senza poter
/// cedere.**
///
/// I tre banchi sopra provano `emit`, `report-progress` e `spawn-job`; ciò che
/// non possono provare è la quarta capacità scritta domani. Un `write_turn()`
/// nudo in `jobs.rs` è un'attesa che non sa dire di no, e il solo punto dove è
/// giusto è `with_event_drain`, che **rientra** in un turno già preso da chi lo
/// chiama (la porta che cede: `JobHost::turn`, o `writing_until`).
#[test]
fn the_job_host_takes_the_turn_only_through_the_door_that_can_yield() {
    let source = include_str!("../jobs.rs");
    let drain = source
        .find("pub(crate) fn with_event_drain")
        .expect("with_event_drain sta in jobs.rs");
    let drain_end = drain + source[drain..].find("\n}\n").expect("fine della funzione");

    let mut offenders = Vec::new();
    let mut at = 0;
    for line in source.lines() {
        let start = at;
        at += line.len() + 1;
        let code = line.split("//").next().unwrap_or("");
        if code.contains(".write_turn()") && !(drain..drain_end).contains(&start) {
            offenders.push(line.trim().to_string());
        }
    }
    assert!(
        offenders.is_empty(),
        "una capacità di un job prende il turno con `write_turn()`, che non può dire di no: \
         usa `self.turn(..)` o `writing_until(..)`:\n{}",
        offenders.join("\n")
    );
}
