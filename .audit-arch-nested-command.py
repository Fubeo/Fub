from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{path}: atteso 1 match, trovati {n}: {old[:100]!r}")
    p.write_text(s.replace(old, new, 1))


def insert_before_once(path: str, marker: str, text: str) -> None:
    p = Path(path)
    s = p.read_text()
    n = s.count(marker)
    if n != 1:
        raise SystemExit(f"{path}: marker non univoco ({n}): {marker[:100]!r}")
    p.write_text(s.replace(marker, text + marker, 1))


# Workspace: il frame preparato distingue ingresso top-level e annidato.
path = "crates/fub-kernel/src/workspace.rs"
replace_once(path, "    previous_actor: Actor,\n", "    previous_actor: Option<Actor>,\n")

old_prepare = r'''    pub fn prepare_provider_command(
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
'''
new_prepare = r'''    pub fn prepare_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, Some(by))
    }

    /// Versione per [`HostCommands::run_command`](fub_abi::traits::HostCommands::run_command):
    /// apre un batch se non ce n'è già uno, ma **non cambia attore**. Il
    /// chiamante resta chi è entrato nel kernel; annidare non è un nuovo ingresso.
    pub fn prepare_nested_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, None)
    }

    fn prepare_provider_command_here(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Option<Actor>,
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

        let previous_actor = by.map(|by| self.dispatch.swap_actor(by));
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
'''
replace_once(path, old_prepare, new_prepare)
replace_once(
    path,
    "        self.dispatch.restore_actor(prepared.previous_actor);\n        result\n",
    "        if let Some(previous_actor) = prepared.previous_actor {\n            self.dispatch.restore_actor(previous_actor);\n        }\n        result\n",
)

# JobHost: run_command orchestra prepare/call/finalize invece di tenere write().
path = "crates/fub-host/src/jobs.rs"
replace_once(path, "use fub_kernel::Workspace;\n", "use fub_kernel::{ReadOnly, Workspace};\n")
insert_before_once(
    path,
    "    /// Il rifiuto da dare a chi è stato annullato, se lo è stato.\n",
    r'''    /// Host figlio per un provider invocato da questo contesto. Condivide la
    /// cancellazione, ma non l'identità del job: un comando annidato non può
    /// attribuirsi il progresso del job che lo ha chiamato.
    fn for_provider(&self, plugin: impl Into<String>, mode: InvokeMode) -> Self {
        JobHost {
            workspace: self.workspace.clone(),
            plugin: plugin.into(),
            mode,
            job: None,
            cancelled: Arc::clone(&self.cancelled),
        }
    }

''',
)
old_run = r'''    /// Il comando gira **dentro** il prestito esclusivo, cioè nel giro sincrono
    /// del kernel come se lo avesse invocato la shell: un job non porta i comandi
    /// fuori dal kernel, ci entra.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.write_result(|h| h.run_command(command, args))
    }
'''
new_run = r'''    /// Un comando annidato conserva il turno di mutazione ma **rilascia il
    /// `RwLock`** durante `CommandProvider::invoke`, come il percorso top-level.
    /// Il proxy figlio riacquisisce capacità strette una chiamata alla volta.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            match ws.prepare_nested_provider_command(command, args.clone(), self.mode)? {
                Some(prepared) => prepared,
                None => return ws.invoke_command_nested(command, args, self.mode),
            }
        };

        let owner = prepared.owner().to_string();
        let host_mode = prepared.host_mode();
        let outcome = if let Some(why) = prepared.read_only_reason() {
            let host = self.for_provider(owner, host_mode);
            let mut host = Guard::new(host, ReadOnly { why });
            prepared.invoke(&mut host)
        } else {
            let mut host = self.for_provider(owner, host_mode);
            prepared.invoke(&mut host)
        };

        let mut ws = workspace.write()?;
        ws.finish_provider_command(prepared, outcome)
    }
'''
replace_once(path, old_run, new_run)

# Test: outer -> HostApi::run_command -> inner provider, reader while inner active.
path = "crates/fub-host/tests/concurrency.rs"
insert_before_once(
    path,
    "/// `ARCH-001`: il codice di un provider **non** gira mentre è detenuto il\n",
    r'''const NESTED_LOCK_PROBE: &str = "audit.nested-lock-probe";

struct NestedLockProbe;

impl CommandProvider for NestedLockProbe {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(NESTED_LOCK_PROBE, "Nested lock probe")
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        host.run_command(LOCK_PROBE, serde_json::Value::Null)?;
        Ok(CommandOutcome::done())
    }
}

''',
)
insert_before_once(
    path,
    "/// Una view che pania mentre disegna.\n",
    r'''/// Anche il **secondo** provider di una macro deve essere staccato: il primo
/// è già fuori lock, ma `JobHost::run_command` prima rientrava con `write()` e
/// teneva la guardia per tutta la callback interna.
#[test]
fn a_nested_command_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature("fub.audit-lock-probe", "Audit lock probe")
            .expect("inner declares");
        w.register_command_provider(
            "fub.audit-lock-probe",
            Box::new(LockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("inner registers");
        w.register_core_feature("fub.audit-nested-probe", "Audit nested probe")
            .expect("outer declares");
        w.register_command_provider("fub.audit-nested-probe", Box::new(NestedLockProbe))
            .expect("outer registers");
    }

    let call = std::thread::spawn(move || {
        host.invoke_user_command(
            None,
            NESTED_LOCK_PROBE,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("inner provider entered through HostApi::run_command");
    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    release_tx.send(()).expect("release inner provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "HostApi::run_command held Custody<Workspace> across the nested provider"
    );
    outcome.expect("nested provider completes through the detached host");
}

''',
)
