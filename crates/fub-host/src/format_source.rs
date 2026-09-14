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

    pub(crate) fn into_parts(self) -> (Vec<Box<dyn FormatProvider>>, FormatResources) {
        (self.providers, self.resources)
    }
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
