//! Il frame dei comandi **di sola lettura**
//! ([`Workspace::prepare_read_only_provider_command`]).
//!
//! Un comando che si è dichiarato di sola lettura si prepara senza toccare lo
//! stato condiviso del workspace: niente batch, niente attore scambiato,
//! niente pila dei comandi, niente rinvio degli eventi. È ciò che permette
//! all'host di eseguirlo senza il turno di scrittura (PA T3): chi scrive nel
//! frattempo vede i propri eventi consegnati subito, due letture convivono, e
//! la fine non lascia niente dietro di sé.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, Undo};
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::{EventMask, Notice};
use fub_abi::model::DocId;
use fub_abi::traits::{CommandProvider, EventHandler, HostApi};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::SampleExtractor;

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("note.md"), "prima").expect("seed");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleExtractor::by_extension("md").boxed())
        .expect("no extension conflict");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    for plugin in ["test", "recorder"] {
        ws.register_core_feature(plugin, plugin).expect("declared");
    }
    ws.reindex().expect("reindex");
    ws.register_command_provider("test", Box::new(Reader))
        .expect("registered");
    (dir, ws)
}

/// Due comandi: `test.read` legge e dichiara perfino un undo (che non deve
/// arrivare alla pila), `test.write` scrive e non è per questa porta.
struct Reader;

impl CommandProvider for Reader {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new("test.read", "Read")
                .describing("Reads a note.")
                .with_scope(CommandScope::read_only()),
            CommandSpec::new("test.write", "Write")
                .describing("Writes a note.")
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
        if command == "test.write" {
            host.write_document(&DocId::new("note.md"), "scritto", WriteBase::Dictated)?;
            return Ok(CommandOutcome::done());
        }
        let text = host.read_document(&DocId::new("note.md"))?;
        Ok(CommandOutcome::notify(text).undoable(Undo::by_command(
            "nothing to undo",
            "test.write",
            serde_json::Value::Null,
        )))
    }
}

type Log = Arc<Mutex<Vec<String>>>;

struct Recorder(Log);

impl EventHandler for Recorder {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0
            .lock()
            .unwrap()
            .push(format!("{:?}", notice.event.kind()));
        Ok(())
    }
}

fn read(ws: &Workspace, outer: &[String]) -> fub_kernel::PreparedReadOnlyCommand {
    ws.prepare_read_only_provider_command(
        "test.read",
        serde_json::Value::Null,
        InvokeMode::Apply,
        outer,
    )
    .expect("prepares")
    .expect("a read-only command takes this door")
}

#[test]
fn a_read_opens_no_batch_and_a_write_meanwhile_is_delivered_at_once() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registered");

    let mut prepared = read(&ws, &[]);
    assert_eq!(prepared.host_mode(), InvokeMode::DryRun);
    assert_eq!(
        prepared.read_only_reason(),
        "il comando si è dichiarato di sola lettura"
    );

    // Con la lettura preparata e non ancora finita, chi scrive vede i propri
    // eventi consegnati subito: nessun batch e nessun rinvio sono aperti.
    log.lock().unwrap().clear();
    ws.write_document(&DocId::new("note.md"), "dopo", WriteBase::Dictated)
        .expect("writes");
    let events = log.lock().unwrap().clone();
    assert!(
        events.iter().any(|e| e.contains("DocumentChanged")),
        "the write is delivered while the read is prepared: {events:?}"
    );

    let outcome = ws.with_host("test", |host| prepared.invoke(host));
    log.lock().unwrap().clear();
    let outcome = ws
        .finish_read_only_provider_command(prepared, outcome)
        .expect("finishes");
    assert!(
        format!("{:?}", outcome.notify).contains("dopo"),
        "the read saw the write: {:?}",
        outcome.notify
    );
    assert!(
        log.lock().unwrap().is_empty(),
        "the end of a read queues no event"
    );
}

/// Il contrario, per vedere che il test sopra distingue: il frame condiviso di
/// [`Workspace::prepare_provider_command`] rimanda gli eventi di chi scrive
/// fino alla sua fine.
#[test]
fn the_shared_frame_instead_holds_the_events_back_until_its_end() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registered");

    let prepared = ws
        .prepare_provider_command(
            "test.write",
            serde_json::Value::Null,
            InvokeMode::Apply,
            fub_abi::event::Actor::User,
        )
        .expect("prepares")
        .expect("a provider command");
    log.lock().unwrap().clear();
    ws.write_document(&DocId::new("note.md"), "dopo", WriteBase::Dictated)
        .expect("writes");
    assert!(
        log.lock().unwrap().is_empty(),
        "the shared frame defers the events"
    );
    ws.finish_provider_command(prepared, Ok(CommandOutcome::done()))
        .expect("finishes");
    assert!(log
        .lock()
        .unwrap()
        .iter()
        .any(|e| e.contains("DocumentChanged")));
}

#[test]
fn two_reads_of_the_same_command_live_together() {
    let (_dir, mut ws) = vault();
    let mut first = read(&ws, &[]);
    let mut second = read(&ws, &[]);

    // Si finiscono in ordine inverso: nessuna pila condivisa da rispettare.
    let outcome = ws.with_host("test", |host| second.invoke(host));
    ws.finish_read_only_provider_command(second, outcome)
        .expect("the second finishes");
    let outcome = ws.with_host("test", |host| first.invoke(host));
    ws.finish_read_only_provider_command(first, outcome)
        .expect("the first finishes");

    // E il percorso condiviso, dopo, è intatto.
    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::Apply,
        fub_abi::event::Actor::User,
    )
    .expect("a write still runs");
}

#[test]
fn a_command_that_invokes_itself_is_still_refused() {
    let (_dir, ws) = vault();
    let outer = read(&ws, &[]);
    assert_eq!(outer.chain(), ["test.read".to_string()]);

    let again = ws.prepare_read_only_provider_command(
        "test.read",
        serde_json::Value::Null,
        InvokeMode::Apply,
        outer.chain(),
    );
    match again {
        Err(PluginError::BadArgs(why)) => {
            let why = format!("{why:?}");
            assert!(why.contains("sé stesso"), "{why}");
        }
        Err(other) => panic!("wrong refusal: {other:?}"),
        Ok(_) => panic!("a command that invokes itself must be refused"),
    }
}

#[test]
fn writing_commands_and_unknown_commands_do_not_take_this_door() {
    let (_dir, ws) = vault();
    for mode in [InvokeMode::Apply, InvokeMode::DryRun] {
        let prepared = ws
            .prepare_read_only_provider_command("test.write", serde_json::Value::Null, mode, &[])
            .expect("no error");
        assert!(
            prepared.is_none(),
            "a writing command stays on the shared frame, even in {mode:?}"
        );
    }
    assert!(ws
        .prepare_read_only_provider_command(
            "test.nobody",
            serde_json::Value::Null,
            InvokeMode::Apply,
            &[]
        )
        .is_err());
}

#[test]
fn a_read_never_pushes_an_undo() {
    let (_dir, mut ws) = vault();
    let mut prepared = read(&ws, &[]);
    let outcome = ws.with_host("test", |host| prepared.invoke(host));
    let outcome = ws
        .finish_read_only_provider_command(prepared, outcome)
        .expect("finishes");
    assert!(
        outcome.undo.is_some(),
        "the provider declared one: it is in the outcome"
    );
    assert!(
        ws.prepare_undo_replay().is_none(),
        "but nothing reached the undo stack"
    );
}

#[test]
fn a_read_that_fails_reports_its_error() {
    let (_dir, ws) = vault();
    let prepared = read(&ws, &[]);
    let refused =
        ws.finish_read_only_provider_command(prepared, Err(PluginError::NotFound("gone".into())));
    assert!(
        matches!(refused, Err(PluginError::NotFound(_))),
        "{refused:?}"
    );
}

#[test]
fn the_outcome_of_a_read_does_not_land_on_a_closed_vault() {
    let (_dir, mut ws) = vault();
    let mut prepared = read(&ws, &[]);
    let outcome = ws.with_host("test", |host| prepared.invoke(host));
    let errors = ws.close();
    assert!(errors.is_empty(), "{errors:?}");

    let late = ws.finish_read_only_provider_command(prepared, outcome);
    assert!(matches!(late, Err(PluginError::Cancelled(_))), "{late:?}");
    assert!(
        ws.prepare_read_only_provider_command(
            "test.read",
            serde_json::Value::Null,
            InvokeMode::Apply,
            &[]
        )
        .is_err(),
        "a closed vault starts no read"
    );
}
