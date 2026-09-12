//! Fasi di teardown: il token conserva identità e frame, mai un guard host.

use super::*;

/// Provider già ritirati dal kernel. Il proprietario li distrugge fuori guard;
/// un disposer difettoso non impedisce il rilascio degli altri.
#[must_use = "i provider ritirati devono essere distrutti fuori dal guard del workspace"]
pub struct RetiredPlugin {
    owner: Box<str>,
    errors: Vec<PluginError>,
    resources: RetiredResources,
}

impl RetiredPlugin {
    pub fn dispose(mut self) -> Vec<PluginError> {
        for (kind, resource) in self.resources.0 {
            self.errors.extend(
                crate::safety::external(
                    &format!("{kind} disposer of `{}`", self.owner),
                    |message| PluginError::Internal(message.into()),
                    || {
                        drop(resource);
                        Ok(())
                    },
                )
                .err(),
            );
        }
        self.errors
    }
}

#[derive(Default)]
pub(super) struct RetiredResources(Vec<(&'static str, Box<dyn Send>)>);

impl RetiredResources {
    pub(super) fn push(&mut self, kind: &'static str, resource: impl Send + 'static) {
        self.0.push((kind, Box::new(resource)));
    }

    pub(super) fn take<T: Send + 'static>(
        &mut self,
        kind: &'static str,
        table: &mut ProviderTable<T>,
        mut retiring: impl FnMut(&T) -> bool,
    ) {
        let mut retained = Vec::new();
        for entry in table.take() {
            if retiring(&entry) {
                self.push(kind, entry);
            } else {
                retained.push(entry);
            }
        }
        table.restore(retained);
    }
}

/// Diritto monouso a ritirare una precisa dichiarazione di plugin.
pub struct PreparedPluginTeardown {
    workspace_id: u64,
    owner: Box<str>,
    generation: u64,
    previous_provider_call: bool,
    indexes: Option<Vec<(String, SharedIndexProvider)>>,
    removed_indexes: bool,
    indexes_closed: bool,
    frame_active: bool,
}

impl PreparedPluginTeardown {
    /// Flush e close restano distinti: un errore o panic del primo non salta
    /// il secondo, né gli indici successivi.
    pub fn invoke_indexes(&mut self, host: &mut dyn HostApi) -> Vec<PluginError> {
        let mut errors = Vec::new();
        if let Some(indexes) = &mut self.indexes {
            for (id, handle) in std::mem::take(indexes) {
                for closing in [false, true] {
                    let operation = if closing { "close" } else { "flush" };
                    let outcome = if closing {
                        let mut index = handle.write();
                        crate::safety::external(
                            &format!("IndexProvider::{operation} of `{id}`"),
                            |message| PluginError::Internal(message.into()),
                            || index.close(host),
                        )
                    } else {
                        match crate::index::IndexCall::enter(&id, &handle) {
                            Ok(_call) => {
                                let mut index = handle.write();
                                crate::safety::external(
                                    &format!("IndexProvider::{operation} of `{id}`"),
                                    |message| PluginError::Internal(message.into()),
                                    || index.flush(host),
                                )
                            }
                            Err(error) => Err(error),
                        }
                    };
                    errors.extend(outcome.err());
                }
                errors.extend(
                    crate::safety::external(
                        &format!("index disposer of `{id}`"),
                        |message| PluginError::Internal(message.into()),
                        || {
                            drop(handle);
                            Ok(())
                        },
                    )
                    .err(),
                );
            }
        }
        self.indexes_closed = self.indexes.is_some();
        errors
    }
}

/// Snapshot del flush globale, legato al workspace e agli handle effettivi.
pub struct PreparedIndexFlush {
    workspace_id: u64,
    providers: Vec<(String, SharedIndexProvider)>,
    previous_provider_call: bool,
}

impl PreparedIndexFlush {
    pub fn invoke(
        &self,
        mut with_host: impl FnMut(
            &str,
            &mut dyn FnMut(&mut dyn HostApi) -> std::result::Result<(), PluginError>,
        ) -> std::result::Result<(), PluginError>,
    ) -> Vec<PluginError> {
        let mut errors = Vec::new();
        for (id, index) in &self.providers {
            let mut invoke = |host: &mut dyn HostApi| {
                let _call = crate::index::IndexCall::enter(id, index)?;
                let mut index = index.write();
                crate::safety::external(
                    &format!("IndexProvider::flush of `{id}`"),
                    |message| PluginError::Internal(message.into()),
                    || index.flush(host),
                )
            };
            errors.extend(with_host(id, &mut invoke).err());
        }
        errors
    }
}

impl Workspace {
    pub fn prepare_plugin_teardown(
        &mut self,
        owner: &str,
    ) -> std::result::Result<PreparedPluginTeardown, RegistryError> {
        if self.dispatch.in_provider_call() {
            return Err(RegistryError::Busy(owner.to_string()));
        }
        let entry = self
            .providers
            .plugins
            .get(owner)
            .ok_or_else(|| RegistryError::UnknownPlugin(owner.to_string()))?;
        let generation = entry.generation;
        Ok(PreparedPluginTeardown {
            workspace_id: self.workspace_id,
            owner: owner.into(),
            generation,
            previous_provider_call: self.dispatch.enter_provider_call(),
            indexes: None,
            removed_indexes: false,
            indexes_closed: false,
            frame_active: true,
        })
    }

    fn valid_teardown(&self, prepared: &PreparedPluginTeardown) -> bool {
        prepared.workspace_id == self.workspace_id
            && self
                .providers
                .plugins
                .get(&prepared.owner)
                .is_some_and(|entry| entry.generation == prepared.generation)
    }

    /// Conclude soltanto il frame del corpo, prima di consegnare i suoi eventi
    /// con dichiarazione e provider ancora vivi. Il token resta dell'owner.
    pub fn finish_plugin_body_deactivation(
        &mut self,
        prepared: &mut PreparedPluginTeardown,
    ) -> std::result::Result<(), PluginError> {
        if prepared.workspace_id != self.workspace_id || !prepared.frame_active {
            return Err(PluginError::Conflict(
                "stale plugin deactivation frame".into(),
            ));
        }
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        prepared.frame_active = false;
        if !self.valid_teardown(prepared) {
            return Err(PluginError::Conflict("stale plugin declaration".into()));
        }
        Ok(())
    }

    /// Dopo Plugin::deactivate: prima il plugin vede il bundle intero, poi le
    /// rotte spariscono e gli indici ricevono il loro ultimo host.
    pub fn take_plugin_teardown_indexes(
        &mut self,
        prepared: &mut PreparedPluginTeardown,
    ) -> std::result::Result<(), PluginError> {
        if !self.valid_teardown(prepared) || prepared.indexes.is_some() {
            return Err(PluginError::Conflict("stale plugin teardown".into()));
        }
        if !prepared.frame_active {
            prepared.previous_provider_call = self.dispatch.enter_provider_call();
            prepared.frame_active = true;
        }
        let indexes = self.indexes.remove(&prepared.owner);
        prepared.removed_indexes = !indexes.is_empty();
        prepared.indexes = Some(indexes);
        Ok(())
    }

    pub fn finish_plugin_teardown(
        &mut self,
        prepared: PreparedPluginTeardown,
        errors: Vec<PluginError>,
    ) -> std::result::Result<RetiredPlugin, (PreparedPluginTeardown, PluginError)> {
        if prepared.workspace_id != self.workspace_id {
            return Err((
                prepared,
                PluginError::Conflict("teardown belongs to another workspace".into()),
            ));
        }
        if prepared.frame_active {
            self.dispatch
                .restore_provider_call(prepared.previous_provider_call);
        }
        if !self.valid_teardown(&prepared) || !prepared.indexes_closed {
            let mut errors = errors;
            errors.push(PluginError::Conflict(
                "stale or incomplete plugin teardown".into(),
            ));
            let mut resources = RetiredResources::default();
            if let Some(indexes) = prepared.indexes {
                for (_, index) in indexes {
                    resources.push("unfinished index", index);
                }
            }
            return Ok(RetiredPlugin {
                owner: prepared.owner,
                errors,
                resources,
            });
        }
        let deferred = self.defer_event_dispatch();
        let resources = self.retire_plugin(&prepared.owner, prepared.removed_indexes);
        self.restore_event_dispatch(deferred);
        Ok(RetiredPlugin {
            owner: prepared.owner,
            errors,
            resources,
        })
    }

    pub fn prepare_index_flush(&mut self) -> PreparedIndexFlush {
        PreparedIndexFlush {
            workspace_id: self.workspace_id,
            providers: self
                .indexes
                .providers
                .iter()
                .map(|(id, provider)| (id.clone(), Arc::clone(provider)))
                .collect(),
            previous_provider_call: self.dispatch.enter_provider_call(),
        }
    }

    pub fn finish_index_flush(
        &mut self,
        prepared: PreparedIndexFlush,
        mut errors: Vec<PluginError>,
    ) -> std::result::Result<RetiredPlugin, (PreparedIndexFlush, PluginError)> {
        if prepared.workspace_id != self.workspace_id {
            return Err((
                prepared,
                PluginError::Conflict("flush belongs to another workspace".into()),
            ));
        }
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        if prepared.providers.iter().any(|(id, old)| {
            !self
                .indexes
                .providers
                .iter()
                .any(|(current_id, current)| current_id == id && Arc::ptr_eq(old, current))
        }) {
            errors.push(PluginError::Conflict("index retired during flush".into()));
        }
        for error in errors.iter().cloned() {
            self.report_trouble(Severity::Warning, None, error, None);
        }
        let mut resources = RetiredResources::default();
        for (_, index) in prepared.providers {
            resources.push("index snapshot", index);
        }
        Ok(RetiredPlugin {
            owner: "index flush".into(),
            errors,
            resources,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "test.teardown";

    fn workspace() -> Workspace {
        let mut workspace = Workspace::on(
            "/vault",
            crate::FormatRegistry::new(),
            Arc::new(crate::MemStorage::new()),
            MachineSettings::in_memory(),
        )
        .expect("memory workspace");
        workspace
            .register_core_feature(OWNER, "Teardown token")
            .expect("owner");
        workspace
    }

    fn complete_indexes(workspace: &mut Workspace, prepared: &mut PreparedPluginTeardown) {
        workspace
            .take_plugin_teardown_indexes(prepared)
            .expect("take once");
        let mut host = workspace.host_for(OWNER, InvokeMode::Apply);
        assert!(prepared.invoke_indexes(&mut host).is_empty());
    }

    #[test]
    fn teardown_rejects_another_workspace_even_at_the_same_root() {
        let mut original = workspace();
        let mut other = workspace();
        let mut prepared = original.prepare_plugin_teardown(OWNER).expect("prepare");
        complete_indexes(&mut original, &mut prepared);
        let Err((prepared, error)) = other.finish_plugin_teardown(prepared, Vec::new()) else {
            panic!("wrong workspace accepted");
        };
        assert!(matches!(error, PluginError::Conflict(_)));
        assert!(other.providers.plugins.get(OWNER).is_some());
        assert!(!other.dispatch.in_provider_call());
        assert!(original
            .finish_plugin_teardown(prepared, Vec::new())
            .map_err(|(_, error)| error)
            .expect("correct workspace")
            .dispose()
            .is_empty());
        assert!(original.providers.plugins.get(OWNER).is_none());
        assert!(!original.dispatch.in_provider_call());
    }

    #[test]
    fn stale_declaration_is_not_retired_and_the_frame_is_restored() {
        let mut workspace = workspace();
        let mut prepared = workspace.prepare_plugin_teardown(OWNER).expect("prepare");
        complete_indexes(&mut workspace, &mut prepared);
        // Simula la sostituzione della dichiarazione, non la mutazione di un
        // suo valore: un id uguale non autorizza a spegnere il nuovo owner.
        workspace.providers.plugins.retire(OWNER);
        workspace
            .providers
            .plugins
            .declare(PluginManifest::new(OWNER, "Replacement"), Trust::Core)
            .expect("replacement generation");
        let errors = workspace
            .finish_plugin_teardown(prepared, Vec::new())
            .map_err(|(_, error)| error)
            .expect("same workspace finalizes its frame")
            .dispose();
        assert!(matches!(errors.as_slice(), [PluginError::Conflict(_)]));
        assert_eq!(
            workspace
                .providers
                .plugins
                .get(OWNER)
                .unwrap()
                .manifest
                .name,
            "Replacement"
        );
        assert!(!workspace.dispatch.in_provider_call());
    }

    #[test]
    fn incomplete_teardown_does_not_retire_the_owner_or_leak_its_frame() {
        let mut workspace = workspace();
        let prepared = workspace.prepare_plugin_teardown(OWNER).expect("prepare");
        let errors = workspace
            .finish_plugin_teardown(prepared, Vec::new())
            .map_err(|(_, error)| error)
            .expect("same workspace")
            .dispose();
        assert!(matches!(errors.as_slice(), [PluginError::Conflict(_)]));
        assert!(workspace.providers.plugins.get(OWNER).is_some());
        assert!(!workspace.dispatch.in_provider_call());
        assert!(workspace
            .deactivate_plugin(OWNER)
            .expect("subsequent teardown")
            .is_empty());
    }
}
