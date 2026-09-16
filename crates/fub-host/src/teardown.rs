//! Teardown della sessione e del toggle utente, senza callback sotto guard.

use fub_abi::PluginError;
use fub_kernel::{RegistryError, Workspace};

use crate::custody::Custody;
use crate::jobs::{drain_events, JobHost};
use crate::registry::{BundleRegistry, StoppedBundle};

pub(crate) fn flush_indexes(
    workspace: &Custody<Workspace>,
) -> Result<Vec<PluginError>, PluginError> {
    let _turn = workspace.write_turn();
    let prepared = { workspace.write()?.prepare_index_flush() };
    let errors = prepared.invoke(|id, invoke| {
        let mut host = JobHost::new(workspace.clone(), id);
        invoke(&mut host)
    });
    let finalized = {
        let mut ws = workspace.write()?;
        ws.finish_index_flush(prepared, errors)
    };
    let retired = finalized.map_err(|(_, error)| error)?;
    let mut errors = retired.dispose();
    errors.extend(drain_events(workspace).err());
    Ok(errors)
}

pub(crate) fn unmount(
    workspace: &Custody<Workspace>,
    registry: &Custody<BundleRegistry>,
    id: &str,
) -> Result<Vec<PluginError>, PluginError> {
    let _turn = workspace.write_turn();
    let prepared = { workspace.write()?.prepare_plugin_teardown(id) };
    let mut prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            let unknown = matches!(error, RegistryError::UnknownPlugin(_));
            let mut errors = vec![PluginError::Internal(error.to_string().into())];
            // Un corpo rimasto dopo un ritiro kernel legacy va comunque
            // rilasciato. Non gli inventiamo un host autorizzato: deactivate
            // richiede la dichiarazione. Busy conserva invece il corpo in uso.
            if unknown {
                match registry.write() {
                    Ok(mut registry) => {
                        let body = registry.prepare_stop(id);
                        drop(registry);
                        errors.extend(dispose_body(body, id));
                    }
                    Err(error) => errors.push(error),
                }
            }
            return Ok(errors);
        }
    };
    // Un registry avvelenato vieta di recuperare i corpi, ma non impedisce
    // al kernel sano di ritirare provider e dichiarazioni.
    let (mut body, mut errors) = match registry.write() {
        Ok(mut registry) => (registry.prepare_stop(id), Vec::new()),
        Err(error) => (None, vec![error]),
    };
    let mut host = JobHost::new(workspace.clone(), id);
    if let Some(body) = body.as_mut() {
        errors.extend(body.invoke(&mut host));
    }
    {
        let mut ws = workspace.write()?;
        errors.extend(ws.finish_plugin_body_deactivation(&mut prepared).err());
    }
    // Nel close gli eventi del corpo raggiungono ancora i suoi handler; il
    // toggle conserva invece la deferral dell'intera modifica impostazioni.
    errors.extend(drain_events(workspace).err());
    // Anche il disposer del corpo viene eseguito fuori dai due guard.
    errors.extend(dispose_body(body, id));
    let extracted = {
        let mut ws = workspace.write()?;
        ws.take_plugin_teardown_indexes(&mut prepared)
    };
    match extracted {
        Ok(()) => errors.extend(prepared.invoke_indexes(&mut host)),
        Err(error) => errors.push(error),
    }
    let finalized = {
        let mut ws = workspace.write()?;
        ws.finish_plugin_teardown(prepared, errors)
    };
    let retired = finalized.map_err(|(_, error)| error)?;
    let mut errors = retired.dispose();
    errors.extend(drain_events(workspace).err());
    Ok(errors)
}

fn dispose_body(body: Option<StoppedBundle>, id: &str) -> Option<PluginError> {
    fub_kernel::safety::external(
        &format!("plugin disposer of `{id}`"),
        |message| PluginError::Internal(message.into()),
        || {
            drop(body);
            Ok(())
        },
    )
    .err()
}
