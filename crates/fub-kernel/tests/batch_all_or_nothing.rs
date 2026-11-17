//! **Un piano su più documenti, tutto o niente** (A-10, T32a).
//!
//! Il lotto del kernel raggruppa ciò che si dice a chi ascolta, non ciò che si
//! scrive: un comando che scrive due file e cade sul secondo lasciava il primo
//! scritto. [`WritePlan`] è l'attrezzo che lo impedisce, e questi banchi lo
//! provano dal kernel vero — un comando registrato, l'host del kernel, le sue
//! guardie — su un supporto in memoria che sa dire di no a comando: il disco
//! pieno al secondo file, il ritorno che fallisce anche lui.
//!
//! I casi sono quelli del piano: una revisione cambiata su uno dei due file;
//! il disco pieno al secondo file; un file nuovo più una modifica; una rinomina
//! più una modifica; l'annulla dopo che un file è cambiato.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    AppliedPlan, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec, Reversal, UndoStep, WritePlan,
};
use fub_abi::edit::{EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::error::PluginError;
use fub_abi::event::{Actor, Event, EventKind};
use fub_abi::model::{DocId, Span};
use fub_abi::rules::plan::{PlanFailure, UNRESTORED_DIR};
use fub_abi::text::Text;
use fub_abi::traits::{CommandProvider, HostApi};
use fub_kernel::storage::{ConditionalWrite, DirEntry, Merge, Stat};
use fub_kernel::{
    FormatRegistry, MachineSettings, MemStorage, VaultStorage, Workspace, UNDO_STALE_ONE,
};
use fub_testkit::SampleText;

// ---------------------------------------------------------------------------
// Il supporto che dice di no
// ---------------------------------------------------------------------------

/// [`MemStorage`] che, su un path scelto, lascia passare `n` scritture e poi
/// risponde «disco pieno» a tutte le altre.
struct FlakyStorage {
    inner: MemStorage,
    /// `(path, scritture ancora concesse)`.
    budget: Mutex<Vec<(Utf8PathBuf, usize)>>,
}

impl FlakyStorage {
    fn refuse(&self, path: &Utf8Path) -> std::io::Result<()> {
        let mut budget = self.budget.lock().unwrap();
        for (watched, left) in budget.iter_mut() {
            if watched == path {
                if *left == 0 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::StorageFull,
                        "il disco è pieno",
                    ));
                }
                *left -= 1;
            }
        }
        Ok(())
    }
}

impl VaultStorage for FlakyStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.refuse(path)?;
        self.inner.write(path, bytes)
    }
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> std::io::Result<ConditionalWrite> {
        self.refuse(path)?;
        self.inner.write_if_unchanged(path, expected, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.refuse(path)?;
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.refuse(to)?;
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.refuse(to)?;
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

// ---------------------------------------------------------------------------
// Il comando che scrive il piano
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Slots {
    /// Il piano da scrivere alla prossima `test.plan`.
    plan: Option<WritePlan>,
    /// Com'è andata l'ultima `test.plan`.
    applied: Option<Result<AppliedPlan, PlanFailure>>,
}

/// `test.plan` scrive il piano e dichiara l'annullamento di
/// [`AppliedPlan::undo`]; `test.trash` e `test.rename` sono i passi
/// strutturali di quell'annullamento; `test.undo` lo chiede all'host.
struct Planner(Arc<Mutex<Slots>>);

const PLUGIN: &str = "test";

impl CommandProvider for Planner {
    fn commands(&self) -> Vec<CommandSpec> {
        let writes = CommandScope::writing(CommandReach::Documents);
        vec![
            CommandSpec::new("test.plan", "Plan").with_scope(writes),
            CommandSpec::new("test.trash", "Trash")
                .with_param(ParamSpec::new("doc", "Doc", ParamKind::Text).required())
                .with_scope(writes),
            CommandSpec::new("test.rename", "Rename")
                .with_param(ParamSpec::new("from", "From", ParamKind::Text).required())
                .with_param(ParamSpec::new("to", "To", ParamKind::Text).required())
                .with_scope(writes),
            CommandSpec::new("test.undo", "Undo").with_scope(writes),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let text = |key: &str| DocId::new(args[key].as_str().unwrap_or_default());
        match command {
            "test.plan" => {
                let plan = self.0.lock().unwrap().plan.take().expect("a plan to write");
                let outcome = plan.apply(host);
                self.0.lock().unwrap().applied = Some(outcome.clone());
                let applied = outcome.map_err(PluginError::from)?;
                let undo = applied.undo("the plan", |reversal| match reversal {
                    Reversal::Trash { doc } => UndoStep::Command {
                        command: "test.trash".into(),
                        args: serde_json::json!({ "doc": doc.as_str() }),
                    },
                    Reversal::Rename { from, to } => UndoStep::Command {
                        command: "test.rename".into(),
                        args: serde_json::json!({ "from": from.as_str(), "to": to.as_str() }),
                    },
                });
                Ok(CommandOutcome::notify("written").undoable(undo))
            }
            "test.trash" => host
                .trash_document(&text("doc"))
                .map(|_| CommandOutcome::done()),
            "test.rename" => host
                .rename_document(&text("from"), &text("to"))
                .map(|()| CommandOutcome::done()),
            "test.undo" => match host.undo_last()? {
                Some(_) => Ok(CommandOutcome::notify("undone")),
                None => Ok(CommandOutcome::notify("nothing")),
            },
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

// ---------------------------------------------------------------------------
// Il banco
// ---------------------------------------------------------------------------

struct Bench {
    ws: Workspace,
    storage: Arc<FlakyStorage>,
    root: Utf8PathBuf,
    slots: Arc<Mutex<Slots>>,
}

const A: &str = "Partenza.md";
const B: &str = "Arrivo.md";
const A_TEXT: &str = "uno\nil blocco\ndue\n";
const B_TEXT: &str = "tre\n";

fn doc(id: &str) -> DocId {
    DocId::new(id)
}

impl Bench {
    /// Due note: la partenza col blocco, l'arrivo senza.
    fn open() -> Bench {
        let root = Utf8PathBuf::from("/vault-piano");
        let inner = MemStorage::new();
        inner.write(&root.join(A), A_TEXT.as_bytes()).unwrap();
        inner.write(&root.join(B), B_TEXT.as_bytes()).unwrap();
        let storage = Arc::new(FlakyStorage {
            inner,
            budget: Mutex::new(Vec::new()),
        });
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleText::by_extension("md").boxed())
            .expect("no extension conflict");
        let mut ws = Workspace::on(
            &root,
            registry,
            Arc::clone(&storage) as Arc<dyn VaultStorage>,
            MachineSettings::in_memory(),
        )
        .expect("the vault opens");
        ws.register_core_feature(PLUGIN, PLUGIN).expect("declared");
        ws.reindex().expect("reindex");
        let slots = Arc::new(Mutex::new(Slots::default()));
        ws.register_command_provider(PLUGIN, Box::new(Planner(Arc::clone(&slots))))
            .expect("registered");
        Bench {
            ws,
            storage,
            root,
            slots,
        }
    }

    fn text(&self, id: &str) -> Option<String> {
        self.storage
            .inner
            .read(&self.root.join(id))
            .ok()
            .map(|bytes| String::from_utf8(bytes).unwrap())
    }

    /// Da adesso, su `id` passano ancora `n` scritture.
    fn disk_full(&self, id: &str, after: usize) {
        self.storage
            .budget
            .lock()
            .unwrap()
            .push((self.root.join(id), after));
    }

    fn run(&mut self, command: &str) -> Result<CommandOutcome, PluginError> {
        self.ws.invoke_command(
            command,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
    }

    fn write_plan(&mut self, plan: WritePlan) -> Result<CommandOutcome, PluginError> {
        self.slots.lock().unwrap().plan = Some(plan);
        self.run("test.plan")
    }

    fn failure(&self) -> PlanFailure {
        match self.slots.lock().unwrap().applied.clone() {
            Some(Err(failure)) => failure,
            other => panic!("the plan should have failed, got {other:?}"),
        }
    }

    fn undo_is_on_the_stack(&mut self) -> bool {
        match self.ws.prepare_undo_replay() {
            Some(replay) => {
                // Lo si rimette com'era: nessun passo fatto, voce in pila.
                let deferred = self.ws.finish_undo_replay_deferred(replay);
                let _ = self.ws.finish_undo_replay(deferred);
                true
            }
            None => false,
        }
    }
}

/// Toglie «il blocco\n» dalla partenza.
fn take_block() -> EditRequest {
    let start = A_TEXT.find("il blocco").unwrap();
    EditRequest::new(
        Revision::of(A_TEXT),
        vec![TextEdit::delete(Span::new(
            start,
            start + "il blocco\n".len(),
        ))],
    )
}

/// Mette «il blocco\n» in fondo all'arrivo.
fn put_block(base: &str) -> EditRequest {
    EditRequest::new(
        Revision::of(base),
        vec![TextEdit::insert(base.len(), "il blocco\n")],
    )
}

fn move_block() -> WritePlan {
    WritePlan::new()
        .edit(doc(A), take_block())
        .edit(doc(B), put_block(B_TEXT))
}

// ---------------------------------------------------------------------------
// I casi
// ---------------------------------------------------------------------------

#[test]
fn batch_two_files_are_written_together_and_undone_in_one_step() {
    let mut bench = Bench::open();
    let rx = bench.ws.bus().subscribe();

    bench.write_plan(move_block()).expect("the plan is written");

    assert_eq!(bench.text(A).as_deref(), Some("uno\ndue\n"));
    assert_eq!(bench.text(B).as_deref(), Some("tre\nil blocco\n"));
    let events: Vec<_> = rx.try_iter().collect();
    let ended = events
        .iter()
        .filter(|n| n.kind() == EventKind::BatchEnded)
        .count();
    assert_eq!(
        ended, 1,
        "two files, one batch: the events go out once, after"
    );
    let Some(Event::BatchEnded { batch, changed }) = events
        .iter()
        .find(|n| n.kind() == EventKind::BatchEnded)
        .map(|n| n.event.clone())
    else {
        panic!("the batch terminal")
    };
    assert!(changed.contains(&doc(A)) && changed.contains(&doc(B)));
    assert!(
        events
            .iter()
            .filter(|n| n.kind() != EventKind::BatchEnded)
            .all(|n| n.origin.batch == Some(batch)),
        "every event of the plan belongs to the command's batch"
    );

    bench.run("test.undo").expect("the undo runs");
    assert_eq!(bench.text(A).as_deref(), Some(A_TEXT));
    assert_eq!(bench.text(B).as_deref(), Some(B_TEXT));
    assert!(
        !bench.undo_is_on_the_stack(),
        "one undo puts back both files: nothing is left on the stack"
    );
}

#[test]
fn batch_a_revision_changed_on_one_file_writes_nothing() {
    let mut bench = Bench::open();
    // L'arrivo cambia dopo che il piano è stato calcolato.
    bench
        .ws
        .write_document(&doc(B), "tre\nscritto da un altro\n", WriteBase::Dictated)
        .unwrap();
    let rx = bench.ws.bus().subscribe();

    let error = bench.write_plan(move_block()).expect_err("a stale base");

    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    let failure = bench.failure();
    assert!(failure.rolled_back());
    assert_eq!(failure.failed, Some(doc(B)));
    assert_eq!(
        bench.text(A).as_deref(),
        Some(A_TEXT),
        "the check comes before any write: the first file is untouched"
    );
    assert_eq!(bench.text(B).as_deref(), Some("tre\nscritto da un altro\n"));
    assert!(
        rx.try_iter()
            .all(|n| n.kind() != EventKind::DocumentChanged),
        "nothing written, nothing announced"
    );
    assert!(!bench.undo_is_on_the_stack(), "a failed plan has no undo");
}

#[test]
fn batch_disk_full_on_the_second_file_puts_the_first_back() {
    let mut bench = Bench::open();
    bench.disk_full(B, 0);

    let error = bench
        .write_plan(move_block())
        .expect_err("the disk is full");

    let failure = bench.failure();
    assert!(failure.rolled_back(), "{failure:?}");
    assert_eq!(failure.failed, Some(doc(B)));
    assert!(
        !matches!(error, PluginError::Conflict(_)),
        "the error is the disk's, with its kind: {error:?}"
    );
    assert_eq!(
        bench.text(A).as_deref(),
        Some(A_TEXT),
        "the first file was written and then put back as it was"
    );
    assert_eq!(bench.text(B).as_deref(), Some(B_TEXT));
    assert!(!bench.undo_is_on_the_stack());
}

#[test]
fn batch_a_failed_put_back_keeps_a_copy_and_names_the_file() {
    let mut bench = Bench::open();
    // La partenza si scrive una volta (il piano) e poi non più (il ritorno);
    // l'arrivo non si scrive affatto.
    bench.disk_full(A, 1);
    bench.disk_full(B, 0);

    let error = bench
        .write_plan(move_block())
        .expect_err("the disk is full");

    let failure = bench.failure();
    assert!(!failure.rolled_back());
    assert_eq!(failure.unrestored.len(), 1);
    let left = &failure.unrestored[0];
    assert_eq!(left.doc, doc(A));
    let copy = left.copy.clone().expect("the copy of before was kept");
    assert!(copy.starts_with(UNRESTORED_DIR), "{copy}");
    let kept = bench
        .storage
        .inner
        .read(&bench.root.join(".fub/plugins").join(PLUGIN).join(&copy))
        .expect("the copy is under .fub/");
    assert_eq!(kept, A_TEXT.as_bytes(), "the copy is the file as it was");
    let PluginError::Io(message) = &error else {
        panic!("a plan not put back is not a conflict: {error:?}")
    };
    let message = message.as_literal().unwrap_or_default().to_string();
    assert!(
        message.contains(A) && message.contains(&copy),
        "the error names the file and its copy: {message}"
    );
}

#[test]
fn batch_a_new_file_and_an_edit() {
    let mut bench = Bench::open();
    let plan = || {
        WritePlan::new()
            .create(doc("Nuova.md"), "il blocco\n")
            .edit(doc(A), take_block())
    };

    // Il nome è occupato: niente di scritto, neanche la modifica.
    let mut busy = Bench::open();
    busy.ws
        .write_document(&doc("Nuova.md"), "c'era già", WriteBase::Dictated)
        .unwrap();
    let error = busy.write_plan(plan()).expect_err("the name is taken");
    assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
    assert_eq!(busy.text(A).as_deref(), Some(A_TEXT));
    assert_eq!(busy.text("Nuova.md").as_deref(), Some("c'era già"));

    // Il disco si riempie sulla modifica: la nota nuova va nel cestino, non
    // resta nel vault e non è distrutta.
    let mut full = Bench::open();
    full.disk_full(A, 0);
    full.write_plan(plan()).expect_err("the disk is full");
    assert!(full.failure().rolled_back(), "{:?}", full.failure());
    assert_eq!(full.text("Nuova.md"), None);
    assert!(
        full.ws
            .list_trash()
            .unwrap()
            .iter()
            .any(|entry| entry.original == doc("Nuova.md")),
        "the new note went to the trash, not into nothing"
    );
    assert_eq!(full.text(A).as_deref(), Some(A_TEXT));

    // Tutto va: due file, e un annulla li rimette tutti e due.
    bench.write_plan(plan()).expect("the plan is written");
    assert_eq!(bench.text("Nuova.md").as_deref(), Some("il blocco\n"));
    assert_eq!(bench.text(A).as_deref(), Some("uno\ndue\n"));
    bench.run("test.undo").expect("the undo runs");
    assert_eq!(bench.text("Nuova.md"), None);
    assert_eq!(bench.text(A).as_deref(), Some(A_TEXT));
}

#[test]
fn batch_a_rename_and_an_edit() {
    let plan = || {
        WritePlan::new()
            .rename(doc(B), doc("Arrivo nuovo.md"), Revision::of(B_TEXT))
            .edit(doc("Arrivo nuovo.md"), put_block(B_TEXT))
            .edit(doc(A), take_block())
    };

    // La terza scrittura non passa: la modifica e la rinomina tornano indietro.
    let mut full = Bench::open();
    full.disk_full(A, 0);
    full.write_plan(plan()).expect_err("the disk is full");
    assert!(full.failure().rolled_back(), "{:?}", full.failure());
    assert_eq!(full.text(B).as_deref(), Some(B_TEXT));
    assert_eq!(full.text("Arrivo nuovo.md"), None);
    assert_eq!(full.text(A).as_deref(), Some(A_TEXT));

    let mut bench = Bench::open();
    bench.write_plan(plan()).expect("the plan is written");
    assert_eq!(bench.text(B), None);
    assert_eq!(
        bench.text("Arrivo nuovo.md").as_deref(),
        Some("tre\nil blocco\n")
    );
    assert_eq!(bench.text(A).as_deref(), Some("uno\ndue\n"));

    bench.run("test.undo").expect("the undo runs");
    assert_eq!(bench.text(B).as_deref(), Some(B_TEXT));
    assert_eq!(bench.text("Arrivo nuovo.md"), None);
    assert_eq!(bench.text(A).as_deref(), Some(A_TEXT));
}

#[test]
fn batch_undo_after_a_file_changed_touches_nothing_and_says_so() {
    let mut bench = Bench::open();
    bench.write_plan(move_block()).expect("the plan is written");
    // Dopo il piano, qualcuno scrive nella partenza. L'annullamento disfa
    // l'arrivo per primo: senza il controllo di tutte le revisioni prima del
    // primo passo, l'arrivo tornerebbe indietro da solo.
    bench
        .ws
        .write_document(&doc(A), "uno\ndue\ncinque\n", WriteBase::Dictated)
        .unwrap();

    let error = bench.run("test.undo").expect_err("a file changed after");
    assert!(
        matches!(error, PluginError::Conflict(_)),
        "a changed file is a conflict: {error:?}"
    );

    // Il perché, prima che il catalogo di chi annulla lo traduca: una chiave
    // (la frase sta accanto a `vault.undo`), col file come argomento.
    let replay = bench.ws.prepare_undo_replay().expect("the entry is back");
    let deferred = bench.ws.finish_undo_replay_deferred(replay);
    let Err(PluginError::Conflict(Text::Message(message))) = bench.ws.finish_undo_replay(deferred)
    else {
        panic!("the refusal is a catalog sentence, not a literal")
    };
    assert_eq!(message.key, UNDO_STALE_ONE);
    assert!(
        format!("{:?}", message.arg("doc")).contains(A),
        "the undo names the changed file: {message:?}"
    );
    assert_eq!(
        bench.text(B).as_deref(),
        Some("tre\nil blocco\n"),
        "the other file is not put back alone"
    );
    assert_eq!(bench.text(A).as_deref(), Some("uno\ndue\ncinque\n"));
    assert!(
        bench.undo_is_on_the_stack(),
        "nothing was undone, so the entry is still there to try again"
    );
}

#[test]
fn batch_undo_after_a_new_file_changed_does_not_trash_it() {
    let mut bench = Bench::open();
    bench
        .write_plan(
            WritePlan::new()
                .create(doc("Nuova.md"), "il blocco\n")
                .edit(doc(A), take_block()),
        )
        .expect("the plan is written");
    bench
        .ws
        .write_document(&doc("Nuova.md"), "il blocco\naltro\n", WriteBase::Dictated)
        .unwrap();

    bench
        .run("test.undo")
        .expect_err("the new file changed after");

    assert_eq!(
        bench.text("Nuova.md").as_deref(),
        Some("il blocco\naltro\n")
    );
    assert_eq!(bench.text(A).as_deref(), Some("uno\ndue\n"));
}

#[test]
fn batch_a_document_twice_is_refused_before_writing() {
    let mut bench = Bench::open();
    let plan = WritePlan::new()
        .edit(doc(A), take_block())
        .edit(doc(A), put_block(A_TEXT));

    let error = bench.write_plan(plan).expect_err("one write per document");

    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(bench.text(A).as_deref(), Some(A_TEXT));
}
