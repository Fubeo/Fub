from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{path}: atteso 1 match, trovati {count}: {old[:80]!r}")
    p.write_text(s.replace(old, new, 1))


def insert_before_once(path: str, marker: str, text: str) -> None:
    p = Path(path)
    s = p.read_text()
    count = s.count(marker)
    if count != 1:
        raise SystemExit(f"{path}: marker non univoco ({count}): {marker[:80]!r}")
    p.write_text(s.replace(marker, text + marker, 1))


# ---------------------------------------------------------------------------
# Custody: un turno di scrittura rientrante separato dal RwLock.
# ---------------------------------------------------------------------------
path = "crates/fub-host/src/custody.rs"
replace_once(
    path,
    "use std::ops::{Deref, DerefMut};\nuse std::sync::atomic::{AtomicU32, Ordering};\nuse std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};\nuse std::time::{Duration, Instant};\n",
    "use std::marker::PhantomData;\nuse std::ops::{Deref, DerefMut};\nuse std::rc::Rc;\nuse std::sync::atomic::{AtomicU32, Ordering};\nuse std::sync::{Arc, Condvar, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};\nuse std::thread::ThreadId;\nuse std::time::{Duration, Instant};\n",
)
replace_once(
    path,
    "struct Inner<T> {\n",
    "#[derive(Default)]\nstruct WriterTurnState {\n    owner: Option<ThreadId>,\n    depth: usize,\n}\n\nstruct Inner<T> {\n",
)
replace_once(
    path,
    "    lock: RwLock<T>,\n",
    "    lock: RwLock<T>,\n    /// Serializza i **turni di mutazione**, ma non le letture. Un turno può\n    /// sopravvivere al rilascio del `RwLock` mentre gira codice esterno: così\n    /// un provider non tiene `Custody<Workspace>` e, nello stesso tempo, un\n    /// secondo writer non entra nel batch/attore lasciato aperto dal primo.\n    writer_turn: Mutex<WriterTurnState>,\n    writer_turn_ready: Condvar,\n",
)
replace_once(
    path,
    "                lock: RwLock::new(value),\n",
    "                lock: RwLock::new(value),\n                writer_turn: Mutex::new(WriterTurnState::default()),\n                writer_turn_ready: Condvar::new(),\n",
)
marker = "    /// Il prestito **esclusivo**. Chi lo prende e pania è chi avvelena: è il\n"
turn_methods = r'''    /// Prenota il **turno di scrittura** senza prendere il dato in esclusiva.
    ///
    /// Il turno è rientrante per il thread che lo possiede: una callback può
    /// quindi rientrare attraverso un host che prende `write()` per una singola
    /// capacità. Gli altri writer aspettano il turno; i reader non lo guardano
    /// e continuano a progredire mentre il callback gira fuori dal `RwLock`.
    pub fn write_turn(&self) -> WriteTurn<'_, T> {
        let me = std::thread::current().id();
        let mut state = self
            .inside
            .writer_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loop {
            match state.owner.as_ref() {
                None => {
                    state.owner = Some(me.clone());
                    state.depth = 1;
                    return WriteTurn::new(&self.inside);
                }
                Some(owner) if owner == &me => {
                    state.depth += 1;
                    return WriteTurn::new(&self.inside);
                }
                Some(_) => {
                    state = self
                        .inside
                        .writer_turn_ready
                        .wait(state)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                }
            }
        }
    }

    /// Come [`write_turn`](Self::write_turn), ma senza mettersi in fila.
    fn try_write_turn(&self) -> Option<WriteTurn<'_, T>> {
        let me = std::thread::current().id();
        let mut state = self
            .inside
            .writer_turn
            .try_lock()
            .ok()?;
        match state.owner.as_ref() {
            None => {
                state.owner = Some(me);
                state.depth = 1;
                Some(WriteTurn::new(&self.inside))
            }
            Some(owner) if owner == &me => {
                state.depth += 1;
                Some(WriteTurn::new(&self.inside))
            }
            Some(_) => None,
        }
    }

'''
insert_before_once(path, marker, turn_methods)
replace_once(
    path,
    "    pub fn write(&self) -> Result<Hold<'_, T>, PluginError> {\n        match self.inside.lock.write() {\n            Ok(g) => Ok(Hold::new(g, &self.inside)),\n            Err(_) => Err(self.report()),\n        }\n    }\n",
    "    pub fn write(&self) -> Result<Hold<'_, T>, PluginError> {\n        let turn = self.write_turn();\n        match self.inside.lock.write() {\n            Ok(g) => Ok(Hold::new(g, &self.inside, turn)),\n            Err(_) => Err(self.report()),\n        }\n    }\n",
)
replace_once(
    path,
    "    pub fn try_write(&self) -> Option<Hold<'_, T>> {\n        self.inside\n            .lock\n            .try_write()\n            .ok()\n            .map(|g| Hold::new(g, &self.inside))\n    }\n",
    "    pub fn try_write(&self) -> Option<Hold<'_, T>> {\n        let turn = self.try_write_turn()?;\n        self.inside\n            .lock\n            .try_write()\n            .ok()\n            .map(|g| Hold::new(g, &self.inside, turn))\n    }\n",
)
insert_before_once(
    path,
    "pub struct Hold<'a, T> {\n",
    r'''/// Il turno di un writer, separato dal prestito esclusivo del dato.
///
/// Non è `Send`: la rientranza è definita dall'identità del thread e il turno
/// deve essere lasciato dallo stesso thread che l'ha preso.
pub struct WriteTurn<'a, T> {
    inside: &'a Inner<T>,
    _not_send: PhantomData<Rc<()>>,
}

impl<'a, T> WriteTurn<'a, T> {
    fn new(inside: &'a Inner<T>) -> Self {
        Self {
            inside,
            _not_send: PhantomData,
        }
    }
}

impl<T> Drop for WriteTurn<'_, T> {
    fn drop(&mut self) {
        let me = std::thread::current().id();
        let mut state = self
            .inside
            .writer_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert_eq!(state.owner.as_ref(), Some(&me));
        debug_assert!(state.depth > 0);
        state.depth -= 1;
        if state.depth == 0 {
            state.owner = None;
            drop(state);
            self.inside.writer_turn_ready.notify_one();
        }
    }
}

''',
)
replace_once(
    path,
    "    guard: Option<RwLockWriteGuard<'a, T>>,\n    inside: &'a Inner<T>,\n",
    "    guard: Option<RwLockWriteGuard<'a, T>>,\n    turn: Option<WriteTurn<'a, T>>,\n    inside: &'a Inner<T>,\n",
)
replace_once(
    path,
    "    fn new(guard: RwLockWriteGuard<'a, T>, inside: &'a Inner<T>) -> Self {\n        Hold {\n            guard: Some(guard),\n            inside,\n",
    "    fn new(\n        guard: RwLockWriteGuard<'a, T>,\n        inside: &'a Inner<T>,\n        turn: WriteTurn<'a, T>,\n    ) -> Self {\n        Hold {\n            guard: Some(guard),\n            turn: Some(turn),\n            inside,\n",
)
replace_once(
    path,
    "        let duration = self.taken.elapsed();\n        drop(self.guard.take());\n        if duration >= self.inside.threshold {\n",
    "        let duration = self.taken.elapsed();\n        drop(self.guard.take());\n        drop(self.turn.take());\n        if duration >= self.inside.threshold {\n",
)

# ---------------------------------------------------------------------------
# JobHost: conserva la modalità del provider che sta servendo.
# ---------------------------------------------------------------------------
path = "crates/fub-host/src/jobs.rs"
replace_once(
    path,
    "use fub_abi::command::CommandOutcome;\n",
    "use fub_abi::command::{CommandOutcome, InvokeMode};\n",
)
replace_once(
    path,
    "    plugin: String,\n",
    "    plugin: String,\n    /// Modalità effettiva delle capacità annidate (`Apply` o simulazione).\n    mode: InvokeMode,\n",
)
replace_once(
    path,
    "            plugin: plugin.into(),\n            job: None,\n",
    "            plugin: plugin.into(),\n            mode: InvokeMode::Apply,\n            job: None,\n",
)
insert_before_once(
    path,
    "    /// Dice a questo host **di quale job** è l'host, che è tutto ciò che serve\n",
    r'''    /// Usa `mode` per le capacità annidate. I job normali restano `Apply`;
    /// un provider staccato dal lock usa `DryRun` quando il suo recinto è di
    /// sola lettura, così una macro simulata non rientra in `Apply`.
    pub fn in_mode(mut self, mode: InvokeMode) -> Self {
        self.mode = mode;
        self
    }

''',
)
replace_once(
    path,
    "        Ok(ws.with_host(&self.plugin, f))\n",
    "        Ok(ws.with_host_mode(&self.plugin, self.mode, f))\n",
)

# ---------------------------------------------------------------------------
# Workspace: prepared command + finalize, senza cambiare il percorso interno.
# ---------------------------------------------------------------------------
path = "crates/fub-kernel/src/workspace.rs"
insert_before_once(
    path,
    "pub struct Workspace {\n",
    r'''/// Una chiamata a `CommandProvider` preparata sotto lock e invocabile fuori.
///
/// Contiene anche il frame da ripristinare al rientro: attore, batch, pila e
/// flag di provider restano una singola transazione logica anche se il `RwLock`
/// non attraversa codice esterno.
pub struct PreparedCommand {
    owner: String,
    command: String,
    args: Option<serde_json::Value>,
    mode: InvokeMode,
    provider: Arc<dyn CommandProvider>,
    read_only_reason: Option<&'static str>,
    previous_actor: Actor,
    owns_batch: bool,
    previous_provider_call: bool,
}

impl PreparedCommand {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Modalità che il proxy deve usare per le capacità annidate.
    pub fn host_mode(&self) -> InvokeMode {
        if self.read_only_reason.is_some() {
            InvokeMode::DryRun
        } else {
            self.mode
        }
    }

    /// Il recinto addizionale da mettere davanti al proxy, se serve.
    pub fn read_only_reason(&self) -> Option<&'static str> {
        self.read_only_reason
    }

    /// Esegue **soltanto** il codice del provider. Nessun `Workspace` è
    /// necessario qui: chi chiama deve aver già rilasciato la sua guardia.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let args = self.args.take().ok_or_else(|| {
            PluginError::Internal("una chiamata preparata è stata invocata due volte".into())
        })?;
        crate::safety::calling(&self.owner, Gate::Command, &self.command, || {
            self.provider
                .invoke(&self.command, args, self.mode, host)
        })
    }
}

''',
)
replace_once(
    path,
    "    pub fn with_host<R>(&mut self, plugin: &str, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {\n        // ciò che `f` emette arriva agli handler quando `f` è tornata.\n        // Presta un [`ReadApi`] intestato a un plugin, per la durata di una\n        let result = self.with_provider_call(|ws| {\n            let mut host = ws.host_for(plugin, InvokeMode::Apply);\n            f(&mut host)\n        });\n        self.dispatch_pending();\n        result\n    }\n",
    "    pub fn with_host<R>(&mut self, plugin: &str, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {\n        self.with_host_mode(plugin, InvokeMode::Apply, f)\n    }\n\n    /// Come [`with_host`](Self::with_host), conservando la modalità della\n    /// chiamata esterna. Serve ai proxy che rientrano per una singola capacità.\n    pub fn with_host_mode<R>(\n        &mut self,\n        plugin: &str,\n        mode: InvokeMode,\n        f: impl FnOnce(&mut dyn HostApi) -> R,\n    ) -> R {\n        // ciò che `f` emette arriva agli handler quando `f` è tornata.\n        let result = self.with_provider_call(|ws| {\n            let mut host = ws.host_for(plugin, mode);\n            f(&mut host)\n        });\n        self.dispatch_pending();\n        result\n    }\n",
)
old_invoke = '''    pub fn invoke_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.as_actor(by, |ws| {
            ws.batch(|ws| ws.invoke_command_here(command, args, mode))
        })
    }
'''
new_invoke = old_invoke + r'''
    /// Prepara il ramo **esterno** di un comando provider. `None` significa che
    /// il comando è manutenzione del kernel e va eseguito dal percorso interno.
    ///
    /// Dopo `Some`, il chiamante deve invocare [`PreparedCommand::invoke`] senza
    /// una guardia del workspace e riconsegnare sempre l'esito a
    /// [`finish_provider_command`](Self::finish_provider_command).
    pub fn prepare_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        let at = self.command_owner(command)?;
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando")
            .clone();
        spec.validate_args(&args)?;

        if self.providers.command_stack.iter().any(|c| c == command) {
            let mut round = self.providers.command_stack.clone();
            round.push(command.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un comando non può invocare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        if self.providers.commands[at].id == crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }

        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        let read_only_reason = if spec.scope.writes && mode == InvokeMode::Apply {
            None
        } else if mode.is_dry_run() {
            Some("una simulazione non scrive")
        } else {
            Some("il comando si è dichiarato di sola lettura")
        };

        let previous_actor = self.dispatch.swap_actor(by);
        let owns_batch = self.dispatch.open_batch();
        self.providers.command_stack.push(command.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();

        Ok(Some(PreparedCommand {
            owner,
            command: command.to_string(),
            args: Some(args),
            mode,
            provider,
            read_only_reason,
            previous_actor,
            owns_batch,
            previous_provider_call,
        }))
    }

    /// Rientra dopo una [`PreparedCommand`] e riproduce l'epilogo del percorso
    /// sincrono: ripristino del flag, pila, localizzazione, undo, batch, dispatch
    /// e infine attore. Il provider non gira in questa funzione.
    pub fn finish_provider_command(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));

        let result = match outcome {
            Err(and) => Err(self.localized(&prepared.owner, and)),
            Ok(mut outcome) => {
                if let CommandEffect::Plan(plan) = &mut outcome.effect {
                    plan.complete();
                }
                self.localize(&prepared.owner, &mut outcome);
                if prepared.mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
                    if let Some(undo) = outcome.undo.clone() {
                        self.undo.push(undo, outcome.partial.clone());
                    }
                }
                // Come `invoke_command_here`: dentro un batch questo è un no-op;
                // resta qui perché nel caso annidato non siamo proprietari della
                // chiusura e non dobbiamo anticipare la consegna.
                self.dispatch_pending();
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
            self.dispatch_pending();
        }
        self.dispatch.restore_actor(prepared.previous_actor);
        result
    }
'''
replace_once(path, old_invoke, new_invoke)

# ---------------------------------------------------------------------------
# Host: per il top-level usa prepare -> call (senza lock) -> finalize.
# ---------------------------------------------------------------------------
path = "crates/fub-host/src/session.rs"
replace_once(
    path,
    "use fub_kernel::{MachineSettings, SystemLocale, ViewStates, Workspace};\n",
    "use fub_kernel::{Guard, MachineSettings, ReadOnly, SystemLocale, ViewStates, Workspace};\n",
)
insert_before_once(
    path,
    "use crate::mount::mount;\n",
    "use crate::jobs::JobHost;\n",
)
old_host_invoke = '''    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.invoke_command(command, args, mode, Actor::User)
        })
    }
'''
new_host_invoke = r'''    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        // La sessione si risolve prima e si conserva soltanto la Custody: il
        // registro delle sessioni non attraversa codice del provider.
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        // Il turno serializza gli altri writer ma **non** è il RwLock del
        // workspace: fra prepare e finalize i reader possono entrare, e il
        // callback può rientrare sullo stesso thread per singola capacità.
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_provider_command(command, args.clone(), mode, Actor::User)? {
                Some(prepared) => prepared,
                None => return ws.invoke_command(command, args, mode, Actor::User),
            }
        };

        let owner = prepared.owner().to_string();
        let host_mode = prepared.host_mode();
        let outcome = if let Some(why) = prepared.read_only_reason() {
            let host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = JobHost::new(workspace.clone(), owner).in_mode(host_mode);
            prepared.invoke(&mut host)
        };

        let mut ws = workspace.write()?;
        ws.finish_provider_command(prepared, outcome)
    }
'''
replace_once(path, old_host_invoke, new_host_invoke)

# ---------------------------------------------------------------------------
# Regressione: callback attiva, re-entry via HostApi e reader concorrente.
# ---------------------------------------------------------------------------
path = "crates/fub-host/tests/concurrency.rs"
replace_once(
    path,
    "use fub_abi::edit::WriteBase;\n",
    "use fub_abi::command::{CommandOutcome, CommandScope, CommandSpec, InvokeMode};\nuse fub_abi::edit::WriteBase;\n",
)
replace_once(
    path,
    "use fub_abi::traits::{ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface};\n",
    "use fub_abi::traits::{\n    CommandProvider, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,\n};\n",
)
insert_before_once(
    path,
    "/// Una view che pania mentre disegna.\n",
    r'''const LOCK_PROBE: &str = "audit.lock-probe";

/// Un comando che prima **rientra** su una capacità di lettura e poi resta
/// dentro `invoke` finché il test non gli dà il via. Il fermo rende osservabile
/// il punto esatto in cui la callback è attiva senza usare tempo/scheduler.
struct LockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl CommandProvider for LockProbe {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(LOCK_PROBE, "Lock probe")
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        // Questa lettura deve riacquisire la Custody dal proxy: è la prova che
        // uscire dal lock non ha tolto al provider le sue capacità.
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal("re-entry read returned the wrong note".into()));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("probe was not released".into()))?;
        Ok(CommandOutcome::done())
    }
}

/// `ARCH-001`: il codice di un provider **non** gira mentre è detenuto il
/// `Custody<Workspace>`. Il test fallisce con il vecchio `write_workspace`:
/// mentre `LockProbe::invoke` è fermo, `try_read()` risponde `None`.
#[test]
fn a_command_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature("fub.audit-lock-probe", "Audit lock probe")
            .expect("probe declares");
        w.register_command_provider(
            "fub.audit-lock-probe",
            Box::new(LockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("probe registers");
    }

    // L'invocazione possiede l'Host; al thread principale basta la Custody già
    // estratta. Così il test non dipende dal fatto che `Host` sia `Sync`.
    let call = std::thread::spawn(move || {
        host.invoke_user_command(None, LOCK_PROBE, serde_json::Value::Null, InvokeMode::Apply)
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("provider entered after a successful host re-entry");

    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    // Liberare prima degli assert evita di lasciare un thread appeso anche nel
    // caso regressivo, in cui `reader_progressed` è false.
    release_tx.send(()).expect("release provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "a reader could not enter while CommandProvider::invoke was active: \
         the provider is still running under Custody<Workspace>"
    );
    outcome.expect("the provider keeps working through its per-capability host");
}

''',
)
