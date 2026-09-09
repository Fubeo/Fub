//! Banco nativo per gli autori: directory esplicita, un plugin e un comando.
//! Non installa nel desktop e non modifica la scelta persistente dei plugin.

use std::collections::BTreeSet;
use std::process::ExitCode;
use std::sync::Arc;

use camino::Utf8Path;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_host::{Bundle, Host, NoWatcher};
use fub_wasm_host::{discover, WasmBundle};

fn select(directory: &Utf8Path, selected: &str) -> Result<WasmBundle, String> {
    let mut ids = BTreeSet::new();
    let mut chosen = None;
    for candidate in discover(directory).map_err(|error| error.to_string())? {
        let bundle = candidate
            .bundle
            .map_err(|error| format!("{}: {error}", candidate.path))?;
        let id = bundle.manifest().id;
        if !ids.insert(id.clone()) {
            return Err(format!("id duplicato nella directory: {id}"));
        }
        if id == selected {
            chosen = Some(bundle);
        }
    }
    chosen.ok_or_else(|| format!("plugin non trovato nella directory: {selected}"))
}

fn run(args: &[String]) -> Result<(), String> {
    let [vault, directory, selected, command] = args else {
        return Err(
            "uso: installed-plugin <vault> <directory-plugin> <id-plugin> <id-comando>".into(),
        );
    };
    let bundle = select(Utf8Path::new(directory), selected)?;
    let manifest = bundle.manifest();
    eprintln!(
        "Plugin richiesto: {}; permessi: {:?}",
        manifest.id, manifest.permissions
    );
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(Utf8Path::new(vault))
        .map_err(|error| error.to_string())?;

    // Dopo open, ogni uscita passa da close, compresi gli errori del guest.
    let result = (|| -> Result<(), String> {
        host.wait_indexed(None).map_err(|error| error.to_string())?;
        host.with_session(None, |session| -> Result<(), String> {
            let mut ws = session.workspace().write().map_err(|e| e.to_string())?;
            let mut registry = session.bundles().write().map_err(|e| e.to_string())?;
            if registry.knows(selected) || ws.plugins().iter().any(|p| p.id == *selected) {
                return Err(format!("id già occupato nell'host: {selected}"));
            }
            registry.remember(Arc::new(bundle));
            registry
                .enable(&mut ws, selected)
                .map_err(|e| e.to_string())?;
            let outcome = ws.invoke_command(
                command,
                serde_json::json!({}),
                InvokeMode::Apply,
                Actor::User,
            );
            let errors = registry.unmount(&mut ws, selected);
            for error in &errors {
                eprintln!("teardown: {error}");
            }
            let outcome = outcome.map_err(|error| error.to_string())?;
            println!("{outcome:?}");
            if !errors.is_empty() {
                return Err("teardown concluso con errori del componente".into());
            }
            Ok(())
        })
        .map_err(|error| error.to_string())?
    })();
    host.close();
    result
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
