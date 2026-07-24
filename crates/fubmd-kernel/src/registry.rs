//! Registry dei [`FormatProvider`]. Il kernel seleziona il provider per
//! estensione; non gli importa se dietro c'è un'impl nativa o (a M5) un proxy
//! WASM — vede solo `Box<dyn FormatProvider>`.

use std::collections::HashMap;

use fubmd_abi::FormatProvider;

#[derive(Default)]
pub struct FormatRegistry {
    providers: Vec<Box<dyn FormatProvider>>,
    /// estensione (minuscola) → indice in `providers`.
    by_ext: HashMap<String, usize>,
}

impl FormatRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra un provider (nativo o proxy). Le sue estensioni vengono mappate.
    pub fn register(&mut self, provider: Box<dyn FormatProvider>) {
        let idx = self.providers.len();
        for ext in provider.descriptor().extensions {
            self.by_ext.insert(ext.to_lowercase(), idx);
        }
        self.providers.push(provider);
    }

    pub fn provider_for_ext(&self, ext: &str) -> Option<&dyn FormatProvider> {
        self.by_ext
            .get(&ext.to_lowercase())
            .map(|&i| self.providers[i].as_ref())
    }

    /// Tutte le estensioni conosciute, per la scansione del vault.
    pub fn all_extensions(&self) -> Vec<String> {
        self.by_ext.keys().cloned().collect()
    }

    /// L'estensione con cui nasce una nota nuova a cui nessuno ne ha data una:
    /// la prima del **primo provider registrato**.
    ///
    /// L'ordine di registrazione è una scelta di chi monta l'app (per FubMD:
    /// markdown), non un dettaglio — per questo non si guarda `by_ext`, che è
    /// una mappa e non ha un primo.
    pub fn default_extension(&self) -> Option<String> {
        self.providers
            .first()?
            .descriptor()
            .extensions
            .first()
            .map(|e| e.to_lowercase())
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}
