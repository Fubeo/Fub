from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: atteso 1 match, trovati {count}: {old[:100]!r}")
    p.write_text(source.replace(old, new, 1))


def insert_before_once(path: str, marker: str, text: str) -> None:
    p = Path(path)
    source = p.read_text()
    count = source.count(marker)
    if count != 1:
        raise SystemExit(f"{path}: marker non univoco ({count}): {marker[:100]!r}")
    p.write_text(source.replace(marker, text + marker, 1))


def replace_public_function(path: str, signature: str, replacement: str) -> None:
    p = Path(path)
    source = p.read_text()
    start = source.find(signature)
    if start < 0:
        raise SystemExit(f"{path}: funzione non trovata: {signature!r}")
    if source.find(signature, start + 1) >= 0:
        raise SystemExit(f"{path}: funzione non univoca: {signature!r}")
    # Le funzioni pubbliche di Workspace sono separate dalla doc-comment della
    # successiva. In call_service non ci sono doc-comment interni.
    end = source.find("\n    ///", start + len(signature))
    if end < 0:
        raise SystemExit(f"{path}: fine funzione non trovata")
    p.write_text(source[:start] + replacement.rstrip() + "\n" + source[end:])


# ---------------------------------------------------------------------------
# Kernel: il provider di servizio è Arc, quindi si prepara il frame sotto lock
# e si porta fuori soltanto ciò che serve alla callback.
# ---------------------------------------------------------------------------
workspace = "crates/fub-kernel/src/workspace.rs"
insert_before_once(
    workspace,
    "pub struct Workspace {\n",
    r'''/// Una chiamata a [`ServiceProvider`] preparata sotto lock e invocabile
/// senza tenere `Custody<Workspace>`.
pub struct PreparedService {
    owner: String,
    service: String,
    method: String,
    args: Option<serde_json::Value>,
    provider: Arc<dyn ServiceProvider>,
    previous_provider_call: bool,
}

impl PreparedService {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Esegue soltanto il codice esterno. Stack e flag sono già stati impostati
    /// da `prepare_service_call` e verranno chiusi da `finish_service_call`.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let args = self.args.take().ok_or_else(|| {
            PluginError::Internal("una chiamata di servizio preparata è stata invocata due volte".into())
        })?;
        crate::safety::calling(
            &self.owner,
            Gate::Service,
            &format!("{}.{}", self.service, self.method),
            || self.provider.call(&self.service, &self.method, args, host),
        )
    }
}

''',
)

replace_public_function(
    workspace,
    "    pub fn call_service(\n",
    r'''    pub fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        let mut prepared = self.prepare_service_call(service, method, args)?;
        let owner = prepared.owner().to_string();
        let outcome = {
            let mut host = self.host_for(&owner, InvokeMode::Apply);
            prepared.invoke(&mut host)
        };
        self.finish_service_call(prepared, outcome)
    }

    /// Risolve e apre il frame di una chiamata a servizio senza eseguire codice
    /// esterno. Chi riceve il valore deve sempre riconsegnarlo a
    /// [`finish_service_call`](Self::finish_service_call).
    pub fn prepare_service_call(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> std::result::Result<PreparedService, PluginError> {
        let owner = self
            .providers
            .plugins
            .provider_of(service)
            .ok_or_else(|| {
                PluginError::Unserved(format!("nessun plugin offre il servizio `{service}`").into())
            })?
            .to_string();
        let at = self
            .providers
            .services
            .position(|(id, _)| *id == owner)
            .ok_or_else(|| {
                PluginError::Unserved(
                    format!("`{owner}` dichiara `{service}` e non ha registrato chi lo serve")
                        .into(),
                )
            })?;

        if self.providers.service_stack.iter().any(|s| s == service) {
            let mut round = self.providers.service_stack.clone();
            round.push(service.to_string());
            return Err(PluginError::BadArgs(
                format!(
                    "un servizio non può chiamare sé stesso: {}",
                    round.join(" → ")
                )
                .into(),
            ));
        }

        let provider = Arc::clone(&self.providers.services[at].1);
        self.providers.service_stack.push(service.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();
        Ok(PreparedService {
            owner,
            service: service.to_string(),
            method: method.to_string(),
            args: Some(args),
            provider,
            previous_provider_call,
        })
    }

    /// Chiude il frame aperto da [`prepare_service_call`](Self::prepare_service_call)
    /// nello stesso ordine del vecchio percorso sincrono: flag, stack, dispatch.
    pub fn finish_service_call(
        &mut self,
        prepared: PreparedService,
        outcome: std::result::Result<serde_json::Value, PluginError>,
    ) -> std::result::Result<serde_json::Value, PluginError> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.service_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.service.as_str()));
        self.dispatch_pending();
        outcome
    }
''',
)

# ---------------------------------------------------------------------------
# Host per-capability: il servizio usa lo stesso writer-turn dei comandi, ma la
# callback gira senza RwLock e riceve un host intestato al provider del servizio.
# ---------------------------------------------------------------------------
jobs = "crates/fub-host/src/jobs.rs"
old_service = r'''impl HostServices for JobHost {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.write_result(|h| h.call_service(service, method, args))
    }
}
'''
new_service = r'''impl HostServices for JobHost {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.stopped()?;
        let workspace = self.workspace.clone();
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            ws.prepare_service_call(service, method, args)?
        };

        let owner = prepared.owner().to_string();
        let mut host = self.for_provider(owner, InvokeMode::Apply);
        let outcome = prepared.invoke(&mut host);

        let mut ws = workspace.write()?;
        ws.finish_service_call(prepared, outcome)
    }
}
'''
replace_once(jobs, old_service, new_service)

# ---------------------------------------------------------------------------
# Test deterministico: command provider -> HostApi::call_service -> service.
# Il servizio rientra davvero sul vault e resta fermo mentre un altro reader
# deve acquisire Custody. Con il vecchio write_result il try_read è None.
# ---------------------------------------------------------------------------
concurrency = "crates/fub-host/tests/concurrency.rs"
replace_once(
    concurrency,
    "use fub_abi::command::{CommandOutcome, CommandScope, CommandSpec, InvokeMode};\n",
    "use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};\n",
)
replace_once(
    concurrency,
    "    CommandProvider, HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,\n",
    "    CommandProvider, HostApi, PluginManifest, ReadApi, ServiceProvider, ViewInstance,\n    ViewProvider, ViewSpec, ViewSurface,\n",
)
replace_once(
    concurrency,
    "use fub_kernel::{FormatRegistry, Workspace};\n",
    "use fub_kernel::{FormatRegistry, Trust, Workspace};\n",
)
insert_before_once(
    concurrency,
    "/// Una view che pania mentre disegna.\n",
    r'''const SERVICE_LOCK_PROBE: &str = "fub.audit-service";
const SERVICE_CALLER: &str = "fub.audit-service-caller.run";

struct ServiceLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ServiceProvider for ServiceLockProbe {
    fn call(
        &self,
        _service: &str,
        _method: &str,
        _args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "service re-entry read returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("service probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("service probe was not released".into()))?;
        Ok(serde_json::Value::String("ok".into()))
    }
}

struct ServiceCaller;

impl CommandProvider for ServiceCaller {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(SERVICE_CALLER, "Service caller")
            .with_scope(CommandScope::writing(CommandReach::Session))]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let answer = host.call_service(SERVICE_LOCK_PROBE, "probe", serde_json::Value::Null)?;
        if answer != serde_json::Value::String("ok".into()) {
            return Err(PluginError::Internal("service returned the wrong answer".into()));
        }
        Ok(CommandOutcome::done())
    }
}

/// `ServiceProvider::call` deve essere staccato anche quando vi si arriva da
/// una capacità annidata di un comando. Il provider è fermo *dopo* una vera
/// re-entry sul vault: in quel punto un reader estraneo deve ancora avanzare.
#[test]
fn a_service_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_plugin(
            PluginManifest::core(SERVICE_LOCK_PROBE, "Audit service")
                .providing(&[SERVICE_LOCK_PROBE]),
            Trust::Core,
        )
        .expect("service declares");
        w.register_service_provider(
            SERVICE_LOCK_PROBE,
            Box::new(ServiceLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("service registers");
        w.register_core_feature("fub.audit-service-caller", "Audit service caller")
            .expect("caller declares");
        w.register_command_provider("fub.audit-service-caller", Box::new(ServiceCaller))
            .expect("caller registers");
    }

    let call = std::thread::spawn(move || {
        host.invoke_user_command(
            None,
            SERVICE_CALLER,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("service entered after a successful host re-entry");
    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    release_tx.send(()).expect("release service provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "HostApi::call_service held Custody<Workspace> across ServiceProvider::call"
    );
    outcome.expect("service provider completes through its per-capability host");
}

''',
)
