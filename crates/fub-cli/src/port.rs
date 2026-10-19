//! L'host della CLI: il suo, o quello dell'app che tiene aperto il vault.
//!
//! Quando il vault è occupato dall'app, la CLI non apre un secondo writer: le
//! porte che riguardano il vault vanno all'app per il canale di controllo
//! ([`fub_host::control`]), e l'app le esegue con le sue regole e i suoi
//! eventi. Ciò che non riguarda il vault (configurazione, vault noti, temi)
//! resta all'host locale, che non ha vault aperti.
//!
//! I metodi qui hanno il nome e la firma di quelli di [`fub_host::Host`]:
//! gli altri passano dal `Deref` all'host locale.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocumentModel;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{IndexQuery, IndexResult, ViewInstance, ViewSpec};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::{DocId, Notice, PluginError, Text};
use fub_host::control::{Call, Endpoint};
use fub_host::Host;

pub struct HostPort {
    local: Host,
    /// Il vault che l'app tiene aperto, e dove raggiungerla.
    app: Option<(Endpoint, Utf8PathBuf)>,
}

impl std::ops::Deref for HostPort {
    type Target = Host;
    fn deref(&self) -> &Host {
        &self.local
    }
}

fn not_through_app(what: &str) -> PluginError {
    PluginError::Unserved(Text::from(format!(
        "{what}: il vault è aperto nell'app, e questo si fa dall'app (o con l'app chiusa)"
    )))
}

impl HostPort {
    pub fn new(local: Host) -> HostPort {
        HostPort { local, app: None }
    }

    /// Il vault che l'app tiene aperto, se la CLI ci lavora attraverso l'app.
    pub fn app_root(&self) -> Option<&Utf8Path> {
        self.app.as_ref().map(|(_, root)| root.as_path())
    }

    /// Cerca l'app che tiene aperto `root`: un endpoint che risponde e che fra
    /// i suoi vault ha proprio questa cartella. Se c'è, da qui in poi le porte
    /// del vault vanno a lei. Altrimenti `false`, e il vault resta occupato da
    /// chi lo ha.
    pub fn through_app(&mut self, root: &str) -> bool {
        let Some(config) = self.local.configuration_root() else {
            return false;
        };
        let Some(endpoint) = Endpoint::read(config) else {
            return false;
        };
        let Ok(wanted) = std::path::Path::new(root).canonicalize() else {
            return false;
        };
        let Ok(open) = endpoint.call_as::<Vec<String>>(Call::Vaults) else {
            return false;
        };
        let Some(found) = open.into_iter().find(|candidate| {
            std::path::Path::new(candidate)
                .canonicalize()
                .is_ok_and(|path| path == wanted)
        }) else {
            return false;
        };
        self.app = Some((endpoint, Utf8PathBuf::from(found)));
        true
    }

    /// Il vault della chiamata, se va all'app: quello nominato o il suo.
    fn app(&self, vault: Option<&str>) -> Option<(&Endpoint, Option<String>)> {
        self.app.as_ref().map(|(app, root)| {
            (
                app,
                Some(
                    vault
                        .map(str::to_string)
                        .unwrap_or_else(|| root.to_string()),
                ),
            )
        })
    }

    pub fn has_current_vault(&self) -> bool {
        self.app.is_some() || self.local.has_current_vault()
    }

    pub fn current(&self) -> Option<Utf8PathBuf> {
        match &self.app {
            Some((_, root)) => Some(root.clone()),
            None => self.local.current(),
        }
    }

    pub fn vaults(&self) -> Vec<Utf8PathBuf> {
        match &self.app {
            Some((_, root)) => vec![root.clone()],
            None => self.local.vaults(),
        }
    }

    pub fn root(&self, vault: Option<&str>) -> Result<Utf8PathBuf, PluginError> {
        match &self.app {
            Some((_, root)) => Ok(root.clone()),
            None => self.local.root(vault),
        }
    }

    pub fn open(&self, path: &Utf8Path) -> Result<fub_host::VaultInfo, PluginError> {
        match self.app {
            Some(_) => Err(not_through_app("aprire un altro vault")),
            None => self.local.open(path),
        }
    }

    pub fn close_vault(&self, root: &Utf8Path) -> Result<Vec<PluginError>, PluginError> {
        match self.app {
            Some(_) => Err(not_through_app("chiudere il vault")),
            None => self.local.close_vault(root),
        }
    }

    pub fn bundles(
        &self,
        vault: Option<&str>,
    ) -> Result<Vec<fub_host::registry::BundleInfo>, PluginError> {
        match self.app {
            Some(_) => Err(not_through_app("elencare i plugin")),
            None => self.local.bundles(vault),
        }
    }

    pub fn session_notice(&self) -> Option<Notice> {
        match self.app(None) {
            None => self.local.session_notice(),
            Some((app, _)) => app.call_as(Call::SessionNotice).ok().flatten(),
        }
    }

    pub fn startup_diagnostics(
        &self,
        vault: Option<&str>,
    ) -> Result<Vec<PluginError>, PluginError> {
        match self.app(vault) {
            None => self.local.startup_diagnostics(vault),
            Some((app, vault)) => app.call_as(Call::StartupDiagnostics { vault }),
        }
    }

    pub fn wait_indexed_for(
        &self,
        vault: Option<&str>,
        timeout: std::time::Duration,
    ) -> Result<bool, PluginError> {
        match self.app(vault) {
            None => self.local.wait_indexed_for(vault, timeout),
            Some((app, vault)) => app.call_as(Call::WaitIndexed {
                vault,
                timeout_ms: timeout.as_millis() as u64,
            }),
        }
    }

    pub fn query_index(
        &self,
        vault: Option<&str>,
        query: IndexQuery,
    ) -> Result<IndexResult, PluginError> {
        match self.app(vault) {
            None => self.local.query_index(vault, query),
            Some((app, vault)) => app.call_as(Call::QueryIndex { vault, query }),
        }
    }

    pub fn commands(&self, vault: Option<&str>) -> Result<Vec<CommandSpec>, PluginError> {
        match self.app(vault) {
            None => self.local.commands(vault),
            Some((app, vault)) => app.call_as(Call::Commands { vault }),
        }
    }

    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        match self.app(vault) {
            None => self.local.invoke_user_command(vault, command, args, mode),
            Some((app, vault)) => app.call_as(Call::InvokeCommand {
                vault,
                command: command.to_string(),
                args,
                mode,
            }),
        }
    }

    pub fn invoke_job(
        &self,
        vault: Option<&str>,
        plugin: &str,
        job: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        match self.app(vault) {
            None => self.local.invoke_job(vault, plugin, job, payload),
            Some((app, vault)) => app.call(Call::InvokeJob {
                vault,
                plugin: plugin.to_string(),
                job: job.to_string(),
                payload,
            }),
        }
    }

    pub fn read_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<(String, Revision), PluginError> {
        match self.app(vault) {
            None => self.local.read_document(vault, id),
            Some((app, vault)) => app.call_as(Call::ReadDocument {
                vault,
                doc: id.clone(),
            }),
        }
    }

    pub fn read_model(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<DocumentModel, PluginError> {
        match self.app(vault) {
            None => self.local.read_model(vault, id),
            Some((app, vault)) => app.call_as(Call::ReadModel {
                vault,
                doc: id.clone(),
            }),
        }
    }

    pub fn write_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        match self.app(vault) {
            None => self.local.write_document(vault, id, source, base),
            Some((app, vault)) => app.call_as(Call::WriteDocument {
                vault,
                doc: id.clone(),
                source: source.to_string(),
                base,
            }),
        }
    }

    pub fn write_document_bytes(
        &self,
        vault: Option<&str>,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        use base64::Engine;
        match self.app(vault) {
            None => self.local.write_document_bytes(vault, id, bytes, expected),
            Some((app, vault)) => app.call_as(Call::WriteBytes {
                vault,
                doc: id.clone(),
                bytes: base64::engine::general_purpose::STANDARD.encode(bytes),
                expected,
            }),
        }
    }

    pub fn views(&self, vault: Option<&str>) -> Result<Vec<ViewSpec>, PluginError> {
        match self.app(vault) {
            None => self.local.views(vault),
            Some((app, vault)) => app.call_as(Call::Views { vault }),
        }
    }

    pub fn render_view(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<UiNode, PluginError> {
        match self.app(vault) {
            None => self.local.render_view(vault, instance),
            Some((app, vault)) => app.call_as(Call::RenderView {
                vault,
                instance: instance.clone(),
            }),
        }
    }

    pub fn view_action(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
        action: UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        match self.app(vault) {
            None => self.local.view_action(vault, instance, action),
            Some((app, vault)) => app.call_as(Call::ViewAction {
                vault,
                instance: instance.clone(),
                action,
            }),
        }
    }

    pub fn set_plugin_enabled(
        &self,
        vault: Option<&str>,
        id: &str,
        enabled: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        match self.app(vault) {
            None => self.local.set_plugin_enabled(vault, id, enabled),
            Some((app, vault)) => app.call_as(Call::SetPluginEnabled {
                vault,
                id: id.to_string(),
                enabled,
            }),
        }
    }

    pub fn set_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
        value: SettingValue,
    ) -> Result<(), PluginError> {
        match self.app(vault) {
            None => self.local.set_setting_for_user(vault, key, value),
            Some((app, vault)) => app
                .call(Call::SetSetting {
                    vault,
                    key: key.to_string(),
                    value,
                })
                .map(|_| ()),
        }
    }

    pub fn reset_setting_for_user(
        &self,
        vault: Option<&str>,
        key: &str,
    ) -> Result<(), PluginError> {
        match self.app(vault) {
            None => self.local.reset_setting_for_user(vault, key),
            Some((app, vault)) => app
                .call(Call::ResetSetting {
                    vault,
                    key: key.to_string(),
                })
                .map(|_| ()),
        }
    }

    /// La cattura, con il comando dell'host `capture.apply`: in locale o
    /// nell'app.
    pub fn capture(
        &self,
        vault: Option<&str>,
        payload: &fub_host::automation::CapturePayloadV1,
    ) -> Result<DocId, PluginError> {
        match self.app(vault) {
            None => fub_host::capture::apply(self, vault, payload, None),
            Some((app, vault)) => app.call_as(Call::Capture {
                vault,
                payload: payload.clone(),
            }),
        }
    }

    /// La nota di `fub://new`, in locale o nell'app.
    pub fn new_note(
        &self,
        vault: Option<&str>,
        note: &fub_host::capture::NewNote<'_>,
        mode: InvokeMode,
    ) -> Result<DocId, PluginError> {
        match self.app(vault) {
            None => fub_host::capture::new_note(self, vault, note, mode),
            Some((app, vault)) => app.call_as(Call::NewNote {
                vault,
                folder: note.folder.map(str::to_string),
                name: note.name.map(str::to_string),
                title: note.title.map(str::to_string),
                template: note.template.map(str::to_string),
                mode,
            }),
        }
    }
}
