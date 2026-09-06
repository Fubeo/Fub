//! Percorso autore riprodotto dai test: installare non significa attivare.
use camino::Utf8Path;
use fub_abi::{traits::ViewInstance, PluginError};
use fub_host::Host;
use fub_wasm_host::{ComponentDirectory, WasmSource};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), PluginError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["inspect", source] => println!("{:#?}", ComponentDirectory::inspect(Utf8Path::new(source))?),
        ["install", config, source] => {
            let manifest = ComponentDirectory::new(Utf8Path::new(config)).install(Utf8Path::new(source))?;
            println!("{} installato; resta spento fino all'attivazione esplicita", manifest.id);
        }
        ["list", config] => {
            let found = ComponentDirectory::new(Utf8Path::new(config)).discover()?;
            for bundle in found.components {
                use fub_host::Bundle;
                println!("{} (spento)", bundle.manifest().id);
            }
            if !found.errors.is_empty() {
                for error in &found.errors { eprintln!("{error}"); }
                return Err(PluginError::BadArgs("discovery con pacchetti rifiutati".into()));
            }
        }
        ["remove", config, id] => {
            ComponentDirectory::new(Utf8Path::new(config)).remove(id)?;
            println!("{id}: rimosso il pacchetto, conservati i dati del plugin");
        }
        ["run-view", config, vault, id, view] => {
            let host = Host::new().with_config_dir(Utf8Path::new(config))
                .with_bundle_source(Box::new(WasmSource));
            let result = (|| {
                host.open(Utf8Path::new(vault))?;
                host.wait_indexed(None)?;
                let warnings = host.set_plugin_enabled(None, id, true)?;
                if let Some(error) = warnings.into_iter().next() { return Err(error); }
                let tree = host.with_session(None, |session| {
                    session.workspace().read()?.render_view(&ViewInstance::only(*view))
                })??;
                println!("{}", serde_json::to_string_pretty(&tree).map_err(|e| PluginError::Internal(e.to_string().into()))?);
                let warnings = host.set_plugin_enabled(None, id, false)?;
                if let Some(error) = warnings.into_iter().next() { return Err(error); }
                Ok(())
            })();
            let close_errors = host.close();
            result?;
            if let Some(error) = close_errors.into_iter().next() { return Err(error); }
        }
        _ => return Err(PluginError::BadArgs(concat!(
            "Uso: components inspect FILE | install CONFIG FILE | list CONFIG | ",
            "remove CONFIG ID | run-view CONFIG VAULT ID VIEW. ",
            "Chiudere tutte le sessioni prima di remove; l'installazione non autorizza l'esecuzione."
        ).into())),
    }
    Ok(())
}
