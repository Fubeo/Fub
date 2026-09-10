//! Registry dei bundle: dichiarazione, attivazione, registrazione dei provider
//! e teardown condividono una sola strada per bundle nativi e WASM.
//!
//! Il punto importante è l'atomicità: un bundle o entra per intero oppure non
//! lascia dichiarazioni/provider dietro. I warning recuperabili devono essere
//! dichiarati esplicitamente; un errore del vecchio `register -> Vec<String>` è
//! invece conservativamente un fallimento di montaggio.

use std::sync::Arc;

use fub_abi::settings::{permission_of_key, SettingSource, SettingValue};
use fub_abi::traits::{abi_compatible, HostApi, IndexQuery, IndexResult, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_kernel::workspace::{
    BeforeWriteHook, PermissionInitialization, PreparedIndexRegistration, PreparedRegistration,
    RegistrationPermit,
};
use fub_kernel::{RegistryError, Trust, Workspace};

#[cfg(feature = "search")]
use fub_features::SEARCH_ID;

use crate::{Custody, JobHost};

/// Di che famiglia è un bundle nell'inventario.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BundleKind {
    Component,
    Theme,
}

/// Esito strutturato della registrazione dei provider.
#[derive(Debug, Default)]
pub struct RegistrationReport {
    warnings: Vec<String>,
    failure: Option<String>,
}

impl RegistrationReport {
    pub fn complete() -> Self {
        Self::default()
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self {
            warnings: vec![message.into()],
            failure: None,
        }
    }

    pub fn with_warning(mut self, message: impl Into<String>) -> Self {
        self.warnings.push(message.into());
        self
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            warnings: Vec::new(),
            failure: Some(message.into()),
        }
    }

    fn from_legacy(failures: Vec<String>) -> Self {
        if failures.is_empty() {
            Self::complete()
        } else {
            Self::failed(failures.join("; "))
        }
    }

    fn into_parts(self) -> (Vec<String>, Option<String>) {
        (self.warnings, self.failure)
    }
}

type RegistrationStep<'a> = Box<dyn FnOnce(&mut Registrar<'_>) -> RegistrationReport + 'a>;

enum RegistrationWorkspace<'a> {
    Direct(&'a mut Workspace),
    Guarded(&'a Custody<Workspace>),
}

/// The only workspace surface exposed while a bundle publishes providers.
/// Every declaration callback runs before this type takes a workspace guard;
/// publication then validates the mount's opaque permit.
pub struct Registrar<'a> {
    workspace: RegistrationWorkspace<'a>,
    permit: RegistrationPermit,
}

impl Registrar<'_> {
    fn direct(workspace: &mut Workspace, permit: RegistrationPermit) -> Registrar<'_> {
        Registrar {
            workspace: RegistrationWorkspace::Direct(workspace),
            permit,
        }
    }

    fn guarded(workspace: &Custody<Workspace>, permit: RegistrationPermit) -> Registrar<'_> {
        Registrar {
            workspace: RegistrationWorkspace::Guarded(workspace),
            permit,
        }
    }

    pub fn owner(&self) -> &str {
        self.permit.owner()
    }

    fn with_read<R>(&self, read: impl FnOnce(&Workspace) -> R) -> Result<R, RegistryError> {
        match &self.workspace {
            RegistrationWorkspace::Direct(workspace) => Ok(read(workspace)),
            RegistrationWorkspace::Guarded(workspace) => workspace
                .read()
                .map(|guard| read(&guard))
                .map_err(RegistryError::External),
        }
    }

    fn publish(&mut self, mut prepared: PreparedRegistration) -> Result<(), RegistryError> {
        match &mut self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                workspace.commit_registration(&self.permit, &mut prepared)
            }
            RegistrationWorkspace::Guarded(workspace) => workspace
                .write()
                .map_err(RegistryError::External)?
                .commit_registration(&self.permit, &mut prepared),
        }
    }

    pub fn register_command_provider(
        &mut self,
        provider: Box<dyn fub_abi::traits::CommandProvider>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::commands(provider).map_err(RegistryError::External)?)
    }

    pub fn register_view_provider(
        &mut self,
        provider: Box<dyn fub_abi::traits::ViewProvider>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::views(provider).map_err(RegistryError::External)?)
    }

    pub fn register_event_handler(
        &mut self,
        provider: Box<dyn fub_abi::traits::EventHandler>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::event_handler(provider))
    }

    pub fn register_service_provider(
        &mut self,
        provider: Box<dyn fub_abi::traits::ServiceProvider>,
    ) -> Result<(), RegistryError> {
        let provides = match &self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                workspace.registration_services(&self.permit)?
            }
            RegistrationWorkspace::Guarded(workspace) => workspace
                .read()
                .map_err(RegistryError::External)?
                .registration_services(&self.permit)?,
        };
        self.publish(PreparedRegistration::service(provides, provider))
    }

    pub fn register_import_provider(
        &mut self,
        provider: Box<dyn fub_abi::transfer::ImportProvider>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::import(provider))
    }

    pub fn register_export_provider(
        &mut self,
        provider: Box<dyn fub_abi::transfer::ExportProvider>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::export(provider).map_err(RegistryError::External)?)
    }

    pub fn register_syntax_rule(
        &mut self,
        provider: Box<dyn fub_abi::custom::SyntaxRule>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::syntax(provider).map_err(RegistryError::External)?)
    }

    pub fn register_custom_renderer(
        &mut self,
        provider: Box<dyn fub_abi::custom::CustomRenderer>,
    ) -> Result<(), RegistryError> {
        self.publish(PreparedRegistration::renderer(provider).map_err(RegistryError::External)?)
    }

    pub fn register_index_provider(
        &mut self,
        provider: Box<dyn fub_abi::traits::IndexProvider>,
    ) -> Result<(), RegistryError> {
        let mut prepared =
            PreparedIndexRegistration::new(provider).map_err(RegistryError::External)?;
        match &self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                workspace.admit_index_registration(&self.permit, &prepared)?
            }
            RegistrationWorkspace::Guarded(workspace) => workspace
                .read()
                .map_err(RegistryError::External)?
                .admit_index_registration(&self.permit, &prepared)?,
        }
        // A recoverable activation error is retained in the token and becomes
        // `RegistryError::Activate` only after the index has been published.
        let _ = self.with_host(|host| prepared.activate(host));
        let committed = match &mut self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                workspace.commit_index_registration(&self.permit, &mut prepared)
            }
            RegistrationWorkspace::Guarded(workspace) => match workspace.write() {
                Ok(mut workspace) => {
                    workspace.commit_index_registration(&self.permit, &mut prepared)
                }
                Err(error) => Err(RegistryError::External(error)),
            },
        };
        if committed.is_err() {
            let _ = self.with_host(|host| Ok(prepared.dispose_uncommitted(host)));
        }
        committed
    }

    /// Opens the one native filesystem gap required by Tantivy's mmap index.
    ///
    /// Keep this surface search-specific: a generic bundle data-directory
    /// accessor would silently grant every native bundle ambient filesystem
    /// access outside `VaultStorage`.
    #[cfg(feature = "search")]
    pub(crate) fn search_data_dir(&self) -> Result<camino::Utf8PathBuf, PluginError> {
        self.with_read(|workspace| workspace.plugin_data_dir(SEARCH_ID))
            .map_err(|error| PluginError::Internal(error.to_string().into()))?
    }

    pub fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.with_read(|workspace| workspace.setting(key))
            .map_err(|error| PluginError::Internal(error.to_string().into()))?
    }

    pub fn set_before_write_hook(&mut self, hook: BeforeWriteHook) -> Result<(), RegistryError> {
        let mut hook = Some(hook);
        match &mut self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                workspace.commit_before_write_hook(&self.permit, &mut hook)
            }
            RegistrationWorkspace::Guarded(workspace) => match workspace.write() {
                Ok(mut workspace) => workspace.commit_before_write_hook(&self.permit, &mut hook),
                Err(error) => Err(RegistryError::External(error)),
            },
        }
    }

    pub fn with_host<R>(
        &mut self,
        call: impl FnOnce(&mut dyn HostApi) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        match &mut self.workspace {
            RegistrationWorkspace::Direct(workspace) => {
                let owner = self.permit.owner().to_owned();
                workspace.with_host(&owner, call)
            }
            RegistrationWorkspace::Guarded(workspace) => {
                let mut host = JobHost::new((*workspace).clone(), self.permit.owner());
                call(&mut host)
            }
        }
    }
}

/// Plugin e registrazione provider appartenenti alla **stessa istanza** di un
/// montaggio.
///
/// Il tipo esiste soprattutto per i bundle WASM: plugin e provider devono
/// condividere l'istanza esplicitamente, non comunicare attraverso un campo
/// temporaneo del bundle fra due chiamate separate.
pub struct BundleMount<'a> {
    plugin: Box<dyn Plugin>,
    register: RegistrationStep<'a>,
}

impl<'a> BundleMount<'a> {
    pub fn new(
        plugin: Box<dyn Plugin>,
        register: impl FnOnce(&mut Registrar<'_>) -> RegistrationReport + 'a,
    ) -> Self {
        Self {
            plugin,
            register: Box::new(register),
        }
    }

    fn into_parts(self) -> (Box<dyn Plugin>, RegistrationStep<'a>) {
        (self.plugin, self.register)
    }
}

/// Un plugin e i provider che gli appartengono.
pub trait Bundle: Send + Sync {
    fn manifest(&self) -> PluginManifest;

    fn kind(&self) -> BundleKind {
        BundleKind::Component
    }

    fn trust(&self) -> Trust {
        Trust::default()
    }

    /// Costruisce il corpo del plugin. Le implementazioni semplici possono
    /// continuare a usare questa firma storica.
    fn plugin(&self) -> Box<dyn Plugin>;

    /// Contratto storico di registrazione. Qualunque messaggio restituito è un
    /// fallimento, non un permesso a lasciare il bundle montato a metà.
    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String>;

    /// I bundle con degradi realmente recuperabili sovrascrivono questo metodo.
    fn registration(&self, registrar: &mut Registrar<'_>) -> RegistrationReport {
        RegistrationReport::from_legacy(self.register(registrar))
    }

    /// Prepara una singola transazione di montaggio.
    ///
    /// Il default adatta i bundle nativi esistenti. I bundle in cui plugin e
    /// provider condividono stato (per esempio WASM) sovrascrivono questo metodo
    /// e portano quello stato nella closure di registrazione.
    fn prepare(&self) -> BundleMount<'_> {
        BundleMount::new(self.plugin(), move |registrar| self.registration(registrar))
    }
}

/// Perché un bundle non è montato.
#[derive(Debug)]
pub enum BundleError {
    Abi { id: String, declared: String },
    Declaration(RegistryError),
    Unknown(String),
    Activation { id: String, error: PluginError },
    Registration { id: String, error: String },
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::Abi { id, declared } => write!(
                f,
                "`{id}` speaks contract `{declared}`, but this host speaks `{}`: will not mount",
                fub_abi::traits::ABI_VERSION
            ),
            BundleError::Declaration(error) => write!(f, "{error}"),
            BundleError::Unknown(id) => {
                write!(f, "`{id}` is not a bundle this host knows how to mount")
            }
            BundleError::Activation { id, error } => {
                write!(f, "`{id}` did not activate: {error}")
            }
            BundleError::Registration { id, error } => {
                write!(f, "`{id}` did not register atomically: {error}")
            }
        }
    }
}

impl std::error::Error for BundleError {}

impl From<BundleError> for PluginError {
    fn from(error: BundleError) -> Self {
        match error {
            BundleError::Abi { .. } => PluginError::Unserved(error.to_string().into()),
            BundleError::Unknown(_) => PluginError::NotFound(error.to_string().into()),
            BundleError::Declaration(_) | BundleError::Registration { .. } => {
                PluginError::Internal(error.to_string().into())
            }
            BundleError::Activation { .. } => error.into_activation_error(),
        }
    }
}

impl BundleError {
    fn into_activation_error(self) -> PluginError {
        let BundleError::Activation { id, mut error } = self else {
            unreachable!("called only for activation errors")
        };
        let message = error.message_mut();
        *message = format!("`{id}` non si è attivato: {message}").into();
        error
    }
}

struct MountedBundle {
    id: String,
    plugin: Arc<dyn Plugin>,
}

struct KnownBundle {
    manifest: PluginManifest,
    kind: BundleKind,
    trust: Trust,
    bundle: Arc<dyn Bundle>,
}

#[derive(Default)]
pub struct BundleRegistry {
    /// Tutto ciò che questo host conosce. Un bundle conosciuto ma non in
    /// `mounted` è spento, non assente.
    known: Vec<KnownBundle>,
    mounted: Vec<MountedBundle>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct BundleInfo {
    pub id: String,
    pub name: String,
    pub mounted: bool,
    pub kind: BundleKind,
    pub trust: Trust,
    pub permissions: fub_abi::options::OptionMap,
}

/// Materializza il **default-deny** dei permessi esterni prima che il plugin
/// riceva il suo primo `HostApi`.
///
/// Il manifest dice ciò che il componente *chiede*, non ciò che la persona ha
/// approvato. Per i bundle non-core una chiave ancora al default viene quindi
/// scritta `false`; una decisione già presente nel livello macchina — `true` o
/// `false` — resta invece intatta. Le chiavi dei permessi sono machine-scoped,
/// quindi un `.fub/settings.json` arrivato con un vault non può portarsi dietro
/// un proprio consenso.
fn initialize_external_permissions(
    ws: &mut Workspace,
    id: &str,
    trust: Trust,
) -> Result<Vec<PermissionInitialization>, String> {
    if trust == Trust::Core {
        return Ok(Vec::new());
    }

    let entries = match ws.query_index(IndexQuery::Settings {
        plugin: Some(id.to_string()),
    }) {
        Ok(IndexResult::Settings(entries)) => entries,
        Ok(other) => {
            return Err(format!(
                "permission settings query for `{id}` answered off-topic: {other:?}"
            ));
        }
        Err(error) => {
            return Err(format!(
                "cannot read permission settings for `{id}` before activation: {error}"
            ));
        }
    };

    let mut initialized = Vec::new();
    for entry in entries {
        let Some((owner, _permission)) = permission_of_key(&entry.spec.key) else {
            continue;
        };
        if owner != id || entry.source != SettingSource::Default {
            continue;
        }
        let initialized_now = match ws.initialize_permission_denial(&entry.spec.key) {
            Ok(initialized) => initialized,
            Err(error) => {
                let mut reason = format!(
                    "cannot initialize external permission `{}` as denied: {error}",
                    entry.spec.key
                );
                append_permission_rollback(ws, &initialized, &mut reason);
                return Err(reason);
            }
        };
        if let Some(receipt) = initialized_now {
            initialized.push(receipt);
        }
    }
    Ok(initialized)
}

/// Ritira le sole decisioni `false` create dal tentativo di mount corrente.
/// Una scelta dell'utente già esistente non entra mai in `initialized`, quindi
/// il rollback non può cancellarla.
fn append_permission_rollback(
    ws: &mut Workspace,
    initialized: &[PermissionInitialization],
    reason: &mut String,
) {
    for receipt in initialized.iter().rev() {
        if let Err(error) = ws.rollback_permission_denial(receipt) {
            reason.push_str(&format!("; permission rollback failed: {error}"));
        }
    }
}

impl BundleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enables a known bundle while keeping both custody guards away from all
    /// bundle, plugin and provider code. Writer turns serialize the transaction
    /// across the unlocked phases.
    pub fn enable_guarded(
        registry: &Custody<Self>,
        workspace: &Custody<Workspace>,
        id: &str,
    ) -> Result<(), BundleError> {
        let _workspace_turn = workspace.write_turn();
        let _registry_turn = registry.write_turn();
        let bundle = {
            let registry = registry.read().map_err(|error| BundleError::Registration {
                id: id.to_owned(),
                error: error.to_string(),
            })?;
            if registry.mounted.iter().any(|bundle| bundle.id == id) {
                return Ok(());
            }
            registry
                .known
                .iter()
                .map(|known| (known.manifest.id.clone(), Arc::clone(&known.bundle)))
                .collect::<Vec<_>>()
        }
        .into_iter()
        .find(|(known_id, _)| known_id == id)
        .map(|(_, bundle)| bundle)
        .ok_or_else(|| BundleError::Unknown(id.to_owned()))?;

        Self::mount_guarded(registry, workspace, bundle.as_ref())
    }

    fn mount_guarded(
        registry: &Custody<Self>,
        workspace: &Custody<Workspace>,
        bundle: &dyn Bundle,
    ) -> Result<(), BundleError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();
        let trust = bundle.trust();
        if !abi_compatible(&manifest.abi_version) {
            return Err(BundleError::Abi {
                id,
                declared: manifest.abi_version,
            });
        }

        let permit = {
            let mut ws = workspace
                .write()
                .map_err(|error| BundleError::Registration {
                    id: id.clone(),
                    error: error.to_string(),
                })?;
            ws.register_plugin(manifest, trust)
                .map_err(BundleError::Declaration)?;
            ws.registration_permit(&id)
                .map_err(BundleError::Declaration)?
        };

        let initialized_permissions =
            match initialize_external_permissions_guarded(workspace, &id, trust) {
                Ok(initialized) => initialized,
                Err(mut error) => {
                    rollback_declaration_guarded(workspace, &permit, &mut error);
                    return Err(BundleError::Registration { id, error });
                }
            };

        let prepared = fub_kernel::safety::external(
            "bundle preparation",
            |message| PluginError::Internal(message.into()),
            || Ok(bundle.prepare()),
        );
        let (mut plugin, register) = match prepared {
            Ok(prepared) => prepared.into_parts(),
            Err(error) => {
                let mut reason = error.to_string();
                append_permission_rollback_guarded(
                    workspace,
                    &initialized_permissions,
                    &mut reason,
                );
                rollback_declaration_guarded(workspace, &permit, &mut reason);
                return Err(BundleError::Registration { id, error: reason });
            }
        };

        let activation = fub_kernel::safety::external(
            "plugin activation",
            |message| PluginError::Internal(message.into()),
            || {
                let mut host = JobHost::new(workspace.clone(), &id);
                plugin.activate(&mut host)
            },
        );
        if let Err(mut error) = activation {
            let mut rollback = String::new();
            append_permission_rollback_guarded(workspace, &initialized_permissions, &mut rollback);
            rollback_declaration_guarded(workspace, &permit, &mut rollback);
            if !rollback.is_empty() {
                let message = error.message_mut();
                *message = format!("{message};{rollback}").into();
            }
            drop_external(plugin, "failed plugin drop");
            return Err(BundleError::Activation { id, error });
        }

        let mut registrar = Registrar::guarded(workspace, permit);
        let registration = fub_kernel::safety::external(
            "bundle registration",
            |message| PluginError::Internal(message.into()),
            || Ok(register(&mut registrar)),
        );
        let (warnings, failure) = match registration {
            Ok(report) => report.into_parts(),
            Err(error) => (Vec::new(), Some(error.to_string())),
        };
        if let Some(mut error) = failure {
            let deactivation = fub_kernel::safety::external(
                "plugin rollback deactivation",
                |message| PluginError::Internal(message.into()),
                || {
                    let mut host = JobHost::new(workspace.clone(), &id);
                    plugin.deactivate(&mut host)
                },
            );
            if let Err(rollback) = deactivation {
                error.push_str(&format!("; rollback deactivate failed: {rollback}"));
            }
            append_permission_rollback_guarded(workspace, &initialized_permissions, &mut error);
            rollback_declaration_guarded(workspace, &registrar.permit, &mut error);
            drop(registrar);
            drop_external(plugin, "rolled back plugin drop");
            return Err(BundleError::Registration { id, error });
        }

        for warning in warnings {
            tracing::warn!(target: "fub.host", "{id}: {warning}");
        }
        match registry.write() {
            Ok(mut registry) => {
                registry.mounted.push(MountedBundle {
                    id,
                    plugin: Arc::from(plugin),
                });
                Ok(())
            }
            Err(publication) => {
                let mut error = format!("cannot publish mounted bundle: {publication}");
                let deactivation = fub_kernel::safety::external(
                    "plugin publication rollback deactivation",
                    |message| PluginError::Internal(message.into()),
                    || {
                        let mut host = JobHost::new(workspace.clone(), &id);
                        plugin.deactivate(&mut host)
                    },
                );
                if let Err(rollback) = deactivation {
                    error.push_str(&format!("; rollback deactivate failed: {rollback}"));
                }
                append_permission_rollback_guarded(workspace, &initialized_permissions, &mut error);
                rollback_declaration_guarded(workspace, &registrar.permit, &mut error);
                drop(registrar);
                drop_external(plugin, "unpublished plugin drop");
                Err(BundleError::Registration { id, error })
            }
        }
    }

    /// Stops and removes a bundle without executing plugin/provider code or a
    /// final destructor under either custody guard.
    pub fn unmount_guarded(
        registry: &Custody<Self>,
        workspace: &Custody<Workspace>,
        id: &str,
    ) -> Vec<PluginError> {
        let _workspace_turn = workspace.write_turn();
        let _registry_turn = registry.write_turn();
        let mut mounted = match registry.write() {
            Ok(mut registry) => {
                let Some(at) = registry.mounted.iter().position(|bundle| bundle.id == id) else {
                    return Vec::new();
                };
                registry.mounted.remove(at)
            }
            Err(error) => return vec![error],
        };

        let mut errors = Vec::new();
        match Arc::get_mut(&mut mounted.plugin) {
            Some(plugin) => {
                let result = fub_kernel::safety::external(
                    "plugin deactivation",
                    |message| PluginError::Internal(message.into()),
                    || {
                        let mut host = JobHost::new(workspace.clone(), id);
                        plugin.deactivate(&mut host)
                    },
                );
                if let Err(error) = result {
                    errors.push(error);
                }
            }
            None => errors.push(PluginError::Internal(
                format!("`{id}` still has an in-flight job: its `deactivate` was not called")
                    .into(),
            )),
        }

        let permit = match workspace.read().and_then(|ws| {
            ws.registration_permit(id)
                .map_err(|error| PluginError::Internal(error.to_string().into()))
        }) {
            Ok(permit) => permit,
            Err(error) => {
                errors.push(error);
                drop_external(mounted, "unmounted bundle drop");
                return errors;
            }
        };
        errors.extend(retire_guarded(workspace, &permit));
        drop_external(mounted, "unmounted bundle drop");
        errors
    }

    /// Monta un bundle in quattro passi: ABI, dichiarazione, attivazione,
    /// provider. Gli ultimi tre vengono ritirati se un passo successivo fallisce.
    pub fn mount(&mut self, bundle: &dyn Bundle, ws: &mut Workspace) -> Result<(), BundleError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();
        let trust = bundle.trust();

        if !abi_compatible(&manifest.abi_version) {
            return Err(BundleError::Abi {
                id,
                declared: manifest.abi_version,
            });
        }

        ws.register_plugin(manifest, trust)
            .map_err(BundleError::Declaration)?;
        let permit = ws
            .registration_permit(&id)
            .map_err(BundleError::Declaration)?;

        // Prima di `activate`: un componente esterno non deve avere neppure una
        // finestra di una chiamata in cui il permesso richiesto sia già attivo.
        let initialized_permissions = match initialize_external_permissions(ws, &id, trust) {
            Ok(keys) => keys,
            Err(mut error) => {
                match ws.deactivate_plugin(&id) {
                    Ok(errors) => {
                        for rollback in errors {
                            error.push_str(&format!("; declaration rollback failed: {rollback}"));
                        }
                    }
                    Err(rollback) => {
                        error.push_str(&format!("; declaration rollback failed: {rollback}"));
                    }
                }
                return Err(BundleError::Registration { id, error });
            }
        };

        // `prepare` viene dopo la dichiarazione come il vecchio `plugin()`: la
        // costruzione può essere specifica del backend, ma non ha ancora accesso
        // alle capacità del vault.
        let (mut plugin, register) = bundle.prepare().into_parts();
        let activation = fub_kernel::safety::external(
            "plugin activation",
            |message| PluginError::Internal(message.into()),
            || ws.with_host(&id, |host| plugin.activate(host)),
        );
        if let Err(mut error) = activation {
            let mut rollback = String::new();
            append_permission_rollback(ws, &initialized_permissions, &mut rollback);
            if !rollback.is_empty() {
                let message = error.message_mut();
                *message = format!("{message};{rollback}").into();
            }
            let _ = ws.deactivate_plugin(&id);
            return Err(BundleError::Activation { id, error });
        }

        let mut registrar = Registrar::direct(ws, permit);
        let registration = fub_kernel::safety::external(
            "bundle registration",
            |message| PluginError::Internal(message.into()),
            || Ok(register(&mut registrar)),
        );
        let (warnings, failure) = match registration {
            Ok(report) => report.into_parts(),
            Err(error) => (Vec::new(), Some(error.to_string())),
        };
        drop(registrar);
        if let Some(mut error) = failure {
            // Il plugin vede ancora il proprio host e i provider già entrati;
            // poi si ritirano le sole decisioni create da questo tentativo e,
            // infine, il kernel ritira provider e dichiarazione.
            if let Err(rollback) = ws.with_host(&id, |host| plugin.deactivate(host)) {
                error.push_str(&format!("; rollback deactivate failed: {rollback}"));
            }
            append_permission_rollback(ws, &initialized_permissions, &mut error);
            match ws.deactivate_plugin(&id) {
                Ok(errors) => {
                    for rollback in errors {
                        error.push_str(&format!("; rollback provider close failed: {rollback}"));
                    }
                }
                Err(rollback) => error.push_str(&format!("; rollback failed: {rollback}")),
            }
            return Err(BundleError::Registration { id, error });
        }

        for warning in warnings {
            tracing::warn!(target: "fub.host", "{id}: {warning}");
        }
        self.mounted.push(MountedBundle {
            id,
            plugin: Arc::from(plugin),
        });
        Ok(())
    }

    pub fn ids(&self) -> Vec<&str> {
        self.mounted
            .iter()
            .map(|bundle| bundle.id.as_str())
            .collect()
    }

    pub fn remember(&mut self, bundle: Arc<dyn Bundle>) {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();
        let known = KnownBundle {
            manifest,
            kind: bundle.kind(),
            trust: bundle.trust(),
            bundle,
        };
        self.known.retain(|known| known.manifest.id != id);
        self.known.push(known);
    }

    pub fn remember_guarded(
        registry: &Custody<Self>,
        bundle: Arc<dyn Bundle>,
    ) -> Result<(), PluginError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();
        let known = KnownBundle {
            manifest,
            kind: bundle.kind(),
            trust: bundle.trust(),
            bundle,
        };
        let replaced = {
            let mut registry = registry.write()?;
            let replaced = registry
                .known
                .iter()
                .position(|entry| entry.manifest.id == id)
                .map(|at| registry.known.remove(at));
            registry.known.push(known);
            replaced
        };
        if let Some(replaced) = replaced {
            drop_external(replaced, "replaced bundle drop");
        }
        Ok(())
    }

    pub fn inventory(&self) -> Vec<BundleInfo> {
        self.known
            .iter()
            .map(|bundle| {
                let manifest = &bundle.manifest;
                BundleInfo {
                    mounted: self.mounted.iter().any(|item| item.id == manifest.id),
                    trust: bundle.trust,
                    permissions: manifest.permissions.granted.clone(),
                    id: manifest.id.clone(),
                    name: manifest.name.clone(),
                    kind: bundle.kind,
                }
            })
            .collect()
    }

    pub fn enable(&mut self, ws: &mut Workspace, id: &str) -> Result<(), BundleError> {
        if self.mounted.iter().any(|bundle| bundle.id == id) {
            return Ok(());
        }
        let Some(bundle) = self
            .known
            .iter()
            .find(|bundle| bundle.manifest.id == id)
            .map(|known| Arc::clone(&known.bundle))
        else {
            return Err(BundleError::Unknown(id.to_string()));
        };
        self.mount(bundle.as_ref(), ws)
    }

    /// Accende un insieme di bundle senza affidare le dipendenze all'ordine
    /// dell'inventario. Solo `MissingRequirement` viene rimesso in coda; ogni
    /// altro errore è definitivo. Se un giro intero non monta niente, i
    /// requisiti rimasti sono realmente irrisolvibili.
    pub fn enable_in_dependency_order<I, S>(
        &mut self,
        ws: &mut Workspace,
        ids: I,
    ) -> Vec<(String, BundleError)>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut pending: Vec<String> = ids.into_iter().map(Into::into).collect();
        let mut failures = Vec::new();

        while !pending.is_empty() {
            let mut deferred_ids = Vec::new();
            let mut deferred_errors = Vec::new();
            let mut progressed = false;

            for id in pending {
                let was_mounted = self.mounted.iter().any(|bundle| bundle.id == id);
                match self.enable(ws, &id) {
                    Ok(()) => {
                        if !was_mounted {
                            progressed = true;
                        }
                    }
                    Err(
                        error @ BundleError::Declaration(RegistryError::MissingRequirement {
                            ..
                        }),
                    ) => {
                        deferred_ids.push(id);
                        deferred_errors.push(error);
                    }
                    Err(error) => failures.push((id, error)),
                }
            }

            if deferred_ids.is_empty() {
                break;
            }
            if !progressed {
                failures.extend(deferred_ids.into_iter().zip(deferred_errors));
                break;
            }
            pending = deferred_ids;
        }

        failures
    }

    pub fn knows(&self, id: &str) -> bool {
        self.mounted.iter().any(|bundle| bundle.id == id)
            || self.known.iter().any(|bundle| bundle.manifest.id == id)
    }

    pub fn body(&self, id: &str) -> Option<Arc<dyn Plugin>> {
        self.mounted
            .iter()
            .find(|bundle| bundle.id == id)
            .map(|bundle| Arc::clone(&bundle.plugin))
    }

    /// Estrae il corpo senza chiamarlo e senza mantenere il guard del registry.
    pub(crate) fn prepare_stop(&mut self, id: &str) -> Option<StoppedBundle> {
        let at = self.mounted.iter().position(|bundle| bundle.id == id)?;
        Some(StoppedBundle(self.mounted.remove(at)))
    }

    /// Ferma solo il corpo del plugin, lasciando ancora vivi host e provider.
    pub fn stop(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let Some(at) = self.mounted.iter().position(|bundle| bundle.id == id) else {
            return Vec::new();
        };
        let mut bundle = self.mounted.remove(at);
        let error = match Arc::get_mut(&mut bundle.plugin) {
            Some(plugin) => ws.with_host(id, |host| plugin.deactivate(host)).err(),
            None => Some(PluginError::Internal(
                format!(
                    "`{id}` still has an in-flight job: its `deactivate` was not called (whoever turns off a bundle stops its jobs first)"
                )
                .into(),
            )),
        };
        drop(bundle);
        error.into_iter().collect()
    }

    pub fn unmount(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let mut errors = self.stop(ws, id);
        match ws.deactivate_plugin(id) {
            Ok(provider_errors) => errors.extend(provider_errors),
            Err(error) => errors.push(PluginError::Internal(error.to_string().into())),
        }
        errors
    }

    pub fn close(&mut self, ws: &mut Workspace) -> Vec<PluginError> {
        ws.close_with(|ws, id| self.stop(ws, id))
    }
}

fn initialize_external_permissions_guarded(
    workspace: &Custody<Workspace>,
    id: &str,
    trust: Trust,
) -> Result<Vec<PermissionInitialization>, String> {
    crate::jobs::with_event_drain(workspace, |ws| {
        initialize_external_permissions(ws, id, trust)
    })
    .map_err(|error| error.to_string())?
}

fn append_permission_rollback_guarded(
    workspace: &Custody<Workspace>,
    initialized: &[PermissionInitialization],
    reason: &mut String,
) {
    match crate::jobs::with_event_drain(workspace, |ws| {
        append_permission_rollback(ws, initialized, reason)
    }) {
        Ok(()) => {}
        Err(error) => reason.push_str(&format!("; permission rollback failed: {error}")),
    }
}

fn rollback_declaration_guarded(
    workspace: &Custody<Workspace>,
    permit: &RegistrationPermit,
    reason: &mut String,
) {
    for error in retire_guarded(workspace, permit) {
        reason.push_str(&format!("; declaration rollback failed: {error}"));
    }
}

fn retire_guarded(workspace: &Custody<Workspace>, permit: &RegistrationPermit) -> Vec<PluginError> {
    let mut prepared = match workspace
        .write()
        .map_err(RegistryError::External)
        .and_then(|mut ws| ws.prepare_plugin_deactivation(permit))
    {
        Ok(prepared) => prepared,
        Err(error) => return vec![PluginError::Internal(error.to_string().into())],
    };
    let mut host = JobHost::new(workspace.clone(), prepared.owner());
    let mut errors = prepared.close_indexes(&mut host);
    let finalized =
        crate::jobs::with_event_drain(workspace, |ws| ws.finish_plugin_deactivation(&mut prepared));
    match finalized {
        Ok(Ok(())) => {}
        Ok(Err(error)) => errors.push(PluginError::Internal(error.to_string().into())),
        Err(error) => errors.push(error),
    }
    errors.extend(prepared.dispose());
    errors
}

fn drop_external<T>(value: T, phase: &'static str) {
    let _ = fub_kernel::safety::external(
        phase,
        |message| PluginError::Internal(message.into()),
        || {
            drop(value);
            Ok(())
        },
    );
}

/// Corpo esclusivo del teardown, posseduto dall'orchestratore fuori dai lock.
pub(crate) struct StoppedBundle(MountedBundle);

impl StoppedBundle {
    pub(crate) fn invoke(&mut self, host: &mut dyn HostApi) -> Vec<PluginError> {
        let id = &self.0.id;
        let outcome = match Arc::get_mut(&mut self.0.plugin) {
            Some(plugin) => fub_kernel::safety::external(
                &format!("Plugin::deactivate of `{id}`"),
                |message| PluginError::Internal(message.into()),
                || plugin.deactivate(host),
            ),
            None => Err(PluginError::Internal(
                format!("`{id}` still has an in-flight job: its `deactivate` was not called")
                    .into(),
            )),
        };
        outcome.err().into_iter().collect()
    }
}

/// Plugin vuoto usato dai bundle che possiedono solo provider del kernel.
pub struct OnlyProviders(PluginManifest);

impl OnlyProviders {
    pub fn boxed(manifest: PluginManifest) -> Box<dyn Plugin> {
        Box::new(Self(manifest))
    }
}

impl Plugin for OnlyProviders {
    fn manifest(&self) -> PluginManifest {
        self.0.clone()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}
