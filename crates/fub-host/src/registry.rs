//! Registry dei bundle: dichiarazione, attivazione, registrazione dei provider
//! e teardown condividono una sola strada per bundle nativi e WASM.
//!
//! Il punto importante è l'atomicità: un bundle o entra per intero oppure non
//! lascia dichiarazioni/provider dietro. I warning recuperabili devono essere
//! dichiarati esplicitamente; un errore del vecchio `register -> Vec<String>` è
//! invece conservativamente un fallimento di montaggio.

use std::sync::Arc;

use fub_abi::traits::{abi_compatible, HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_kernel::{RegistryError, Trust, Workspace};

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

/// Plugin e registrazione provider appartenenti alla **stessa istanza** di un
/// montaggio.
///
/// Il tipo esiste soprattutto per i bundle WASM: plugin e provider devono
/// condividere l'istanza esplicitamente, non comunicare attraverso un campo
/// temporaneo del bundle fra due chiamate separate.
pub struct BundleMount<'a> {
    plugin: Box<dyn Plugin>,
    register: Box<dyn FnOnce(&mut Workspace) -> RegistrationReport + 'a>,
}

impl<'a> BundleMount<'a> {
    pub fn new(
        plugin: Box<dyn Plugin>,
        register: impl FnOnce(&mut Workspace) -> RegistrationReport + 'a,
    ) -> Self {
        Self {
            plugin,
            register: Box::new(register),
        }
    }

    fn into_parts(
        self,
    ) -> (
        Box<dyn Plugin>,
        Box<dyn FnOnce(&mut Workspace) -> RegistrationReport + 'a>,
    ) {
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
    fn register(&self, ws: &mut Workspace) -> Vec<String>;

    /// I bundle con degradi realmente recuperabili sovrascrivono questo metodo.
    fn registration(&self, ws: &mut Workspace) -> RegistrationReport {
        RegistrationReport::from_legacy(self.register(ws))
    }

    /// Prepara una singola transazione di montaggio.
    ///
    /// Il default adatta i bundle nativi esistenti. I bundle in cui plugin e
    /// provider condividono stato (per esempio WASM) sovrascrivono questo metodo
    /// e portano quello stato nella closure di registrazione.
    fn prepare(&self) -> BundleMount<'_> {
        BundleMount::new(self.plugin(), move |ws| self.registration(ws))
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

#[derive(Default)]
pub struct BundleRegistry {
    /// Tutto ciò che questo host conosce. Un bundle conosciuto ma non in
    /// `mounted` è spento, non assente.
    known: Vec<Arc<dyn Bundle>>,
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

impl BundleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Monta un bundle in quattro passi: ABI, dichiarazione, attivazione,
    /// provider. Gli ultimi tre vengono ritirati se un passo successivo fallisce.
    pub fn mount(&mut self, bundle: &dyn Bundle, ws: &mut Workspace) -> Result<(), BundleError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();

        if !abi_compatible(&manifest.abi_version) {
            return Err(BundleError::Abi {
                id,
                declared: manifest.abi_version,
            });
        }

        ws.register_plugin(manifest, bundle.trust())
            .map_err(BundleError::Declaration)?;

        // `prepare` viene dopo la dichiarazione come il vecchio `plugin()`: la
        // costruzione può essere specifica del backend, ma non ha ancora accesso
        // alle capacità del vault.
        let (mut plugin, register) = bundle.prepare().into_parts();
        if let Err(error) = ws.with_host(&id, |host| plugin.activate(host)) {
            let _ = ws.deactivate_plugin(&id);
            return Err(BundleError::Activation { id, error });
        }

        let (warnings, failure) = register(ws).into_parts();
        if let Some(mut error) = failure {
            // Il plugin vede ancora il proprio host e i provider già entrati;
            // poi il kernel ritira provider e dichiarazione.
            if let Err(rollback) = ws.with_host(&id, |host| plugin.deactivate(host)) {
                error.push_str(&format!("; rollback deactivate failed: {rollback}"));
            }
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
        let id = bundle.manifest().id;
        self.known.retain(|known| known.manifest().id != id);
        self.known.push(bundle);
    }

    pub fn inventory(&self) -> Vec<BundleInfo> {
        self.known
            .iter()
            .map(|bundle| {
                let manifest = bundle.manifest();
                BundleInfo {
                    mounted: self.mounted.iter().any(|item| item.id == manifest.id),
                    trust: bundle.trust(),
                    permissions: manifest.permissions.granted,
                    id: manifest.id,
                    name: manifest.name,
                    kind: bundle.kind(),
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
            .find(|bundle| bundle.manifest().id == id)
            .cloned()
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
            || self.known.iter().any(|bundle| bundle.manifest().id == id)
    }

    pub fn body(&self, id: &str) -> Option<Arc<dyn Plugin>> {
        self.mounted
            .iter()
            .find(|bundle| bundle.id == id)
            .map(|bundle| Arc::clone(&bundle.plugin))
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