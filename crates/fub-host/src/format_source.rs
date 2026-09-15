//! Porta di preparazione dei provider di formato prima dell'apertura del vault.
//!
//! La sorgente non vede `Workspace` né `Custody`: prepara provider e risorse
//! possedute, che l'host consegna al `FormatRegistry` prima di costruire il
//! workspace e conserva fino alla chiusura della sessione.

use std::any::Any;

use fub_abi::{FormatProvider, PluginError};

/// Risorse possedute fino alla chiusura della sessione.
pub(crate) type FormatResources = Vec<Box<dyn Any + Send + Sync>>;

/// Risultato posseduto della preparazione fuori dal workspace.
pub struct PreparedFormatSource {
    providers: Vec<Box<dyn FormatProvider>>,
    resources: FormatResources,
}

impl PreparedFormatSource {
    pub fn empty() -> Self {
        Self {
            providers: Vec::new(),
            resources: Vec::new(),
        }
    }

    pub fn from_provider(provider: Box<dyn FormatProvider>) -> Self {
        Self {
            providers: vec![provider],
            resources: Vec::new(),
        }
    }

    pub fn with_provider(mut self, provider: Box<dyn FormatProvider>) -> Self {
        self.providers.push(provider);
        self
    }

    /// Conserva vivo uno stato posseduto dalla sorgente fino alla chiusura.
    pub fn retain<T: Any + Send + Sync>(mut self, resource: T) -> Self {
        self.resources.push(Box::new(resource));
        self
    }
    /// Merges another prepared source without exposing its owned parts.
    ///
    /// Providers and retained resources are moved into this source, preserving
    /// ownership until the eventual mount/session teardown.
    pub(crate) fn extend(&mut self, mut other: Self) {
        self.providers.append(&mut other.providers);
        self.resources.append(&mut other.resources);
    }

    pub(crate) fn into_parts(self) -> (Vec<Box<dyn FormatProvider>>, FormatResources) {
        (self.providers, self.resources)
    }

    /// Disposes providers before retained resources, isolating every destructor.
    pub(crate) fn dispose(self) -> Vec<PluginError> {
        let Self {
            providers,
            resources,
        } = self;
        let mut errors = Vec::new();
        for provider in providers {
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(provider))).is_err() {
                errors.push(PluginError::Internal(
                    "panic while disposing a prepared format provider".into(),
                ));
            }
        }
        errors.extend(dispose_format_resources(resources));
        errors
    }
}
/// Explicitly disposes retained resources without allowing one faulty drop to
/// prevent later resources from being released.
pub(crate) fn dispose_format_resources(resources: FormatResources) -> Vec<PluginError> {
    let mut errors = Vec::new();
    for resource in resources {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(resource))).is_err() {
            errors.push(PluginError::Internal(
                "panic while disposing a retained format resource".into(),
            ));
        }
    }
    errors
}

/// Origine generica dei provider installati per una nuova sessione.
pub trait FormatSource: Send + Sync {
    fn prepare(&self) -> Result<PreparedFormatSource, PluginError>;
}

impl<F> FormatSource for F
where
    F: Fn() -> Result<PreparedFormatSource, PluginError> + Send + Sync,
{
    fn prepare(&self) -> Result<PreparedFormatSource, PluginError> {
        self()
    }
}
