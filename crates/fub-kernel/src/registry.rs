//! Registry dei [`FormatProvider`]. Il kernel seleziona il provider per
//! estensione; non gli importa se dietro c'è un'impl nativa o (a M5) un proxy
//! WASM — vede solo `Box<dyn FormatProvider>`.
//!
//! **Chi registra dopo non vince più in silenzio.** `register` faceva `insert`
//! su una mappa estensione → un indice, e la seconda registrazione della stessa
//! estensione sostituiva la prima senza che nessuno potesse accorgersene: era
//! metà del §3.1 — l'altra metà è che non esisteva modo di *innestare* una
//! sintassi invece che rimpiazzare un provider, ed è la
//! [`SyntaxRegistry`](crate::syntax::SyntaxRegistry).
//!
//! Sostituire un provider resta lecito, ma va **detto**:
//! [`FormatRegistry::replace`].

use std::collections::HashMap;
use std::sync::Arc;

use fub_abi::format::FormatDescriptor;
use fub_abi::FormatProvider;

/// Due provider si contendono la stessa estensione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryConflict {
    pub extension: String,
    /// L'id del provider che ce l'aveva già.
    pub incumbent: String,
    /// L'id di quello che è arrivato dopo, e **non** si è registrato.
    pub challenger: String,
}

impl std::fmt::Display for RegistryConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "`{}` claims extension `{}`, which already belongs to `{}` \
             (to replace intentionally: `FormatRegistry::replace`)",
            self.challenger, self.extension, self.incumbent
        )
    }
}

struct RegisteredFormat {
    descriptor: FormatDescriptor,
    provider: Arc<dyn FormatProvider>,
}

#[derive(Default)]
pub struct FormatRegistry {
    providers: Vec<RegisteredFormat>,
    /// estensione (minuscola) → indice in `providers`.
    by_ext: HashMap<String, usize>,
}

impl FormatRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra un provider (nativo o proxy), o dice **perché no**.
    ///
    /// Le estensioni già rivendicate da un altro provider sono un conflitto e la
    /// registrazione **non avviene affatto** — nemmeno per le estensioni libere
    /// dello stesso provider: un provider registrato a metà è peggio di uno non
    /// registrato, perché funziona per alcuni file e non per altri.
    pub fn register(&mut self, provider: Box<dyn FormatProvider>) -> Result<(), RegistryConflict> {
        let descriptor = provider.descriptor();
        let mut extensions = Vec::with_capacity(descriptor.extensions.len());
        for ext in &descriptor.extensions {
            let ext = ext.to_lowercase();
            if let Some(&at) = self.by_ext.get(&ext) {
                return Err(RegistryConflict {
                    extension: ext,
                    incumbent: self.providers[at].descriptor.id.clone(),
                    challenger: descriptor.id,
                });
            }
            extensions.push(ext);
        }
        self.insert_normalized(provider, descriptor, extensions);
        Ok(())
    }

    /// Registra un provider **sostituendo** chi rivendicava le stesse
    /// estensioni. È l'operazione che `register` faceva prima senza dirlo:
    /// resta possibile, ma adesso chi la vuole la chiede per nome.
    pub fn replace(&mut self, provider: Box<dyn FormatProvider>) {
        let descriptor = provider.descriptor();
        let extensions = descriptor.extensions.clone();
        self.insert_normalized(
            provider,
            descriptor,
            extensions
                .into_iter()
                .map(|ext| ext.to_lowercase())
                .collect(),
        );
    }

    fn insert_normalized(
        &mut self,
        provider: Box<dyn FormatProvider>,
        descriptor: FormatDescriptor,
        extensions: Vec<String>,
    ) {
        let idx = self.providers.len();
        for ext in extensions {
            self.by_ext.insert(ext, idx);
        }
        self.providers.push(RegisteredFormat {
            descriptor,
            provider: Arc::from(provider),
        });
    }

    pub fn provider_for_ext(&self, ext: &str) -> Option<&dyn FormatProvider> {
        if let Some(&at) = self.by_ext.get(ext) {
            return Some(self.providers[at].provider.as_ref());
        }
        self.by_ext
            .get(&ext.to_lowercase())
            .map(|&at| self.providers[at].provider.as_ref())
    }

    /// Lo stesso lookup di `provider_for_ext`, ma con ownership condivisa: chi
    /// prepara una callback clona l'`Arc` sotto lock e poi può eseguirla dopo
    /// aver rilasciato il workspace.
    pub(crate) fn provider_arc_for_ext(&self, ext: &str) -> Option<Arc<dyn FormatProvider>> {
        let at = self
            .by_ext
            .get(ext)
            .copied()
            .or_else(|| self.by_ext.get(&ext.to_lowercase()).copied())?;
        Some(Arc::clone(&self.providers[at].provider))
    }

    /// Descriptor congelato al momento della registrazione. Consultarlo non è
    /// una callback del provider.
    pub(crate) fn descriptor_for_ext(&self, ext: &str) -> Option<&FormatDescriptor> {
        let at = self
            .by_ext
            .get(ext)
            .copied()
            .or_else(|| self.by_ext.get(&ext.to_lowercase()).copied())?;
        Some(&self.providers[at].descriptor)
    }

    /// Tutte le estensioni conosciute, per la scansione del vault.
    pub fn all_extensions(&self) -> Vec<String> {
        self.by_ext.keys().cloned().collect()
    }

    /// La domanda che [`all_extensions`](Self::all_extensions) serviva, senza
    /// costruire l'elenco per farla: quest'estensione è di un documento? Il
    /// confronto resta disarmato sul caso, com'è in `kind_of` — le chiavi di
    /// `by_ext` sono già minuscole, ma la risposta dev'essere quella di sempre.
    pub fn has_doc_ext(&self, ext: &str) -> bool {
        if self.by_ext.contains_key(ext) {
            return true;
        }
        ext.bytes().any(|b| b.is_ascii_uppercase())
            && self.by_ext.contains_key(&ext.to_ascii_lowercase())
    }

    /// L'estensione con cui nasce una nota nuova a cui nessuno ne ha data una:
    /// la prima del **primo provider registrato**.
    ///
    /// L'ordine di registrazione è una scelta di chi monta l'app (per Fub:
    /// markdown), non un dettaglio — per questo non si guarda `by_ext`, che è
    /// una mappa e non ha un primo.
    pub fn default_extension(&self) -> Option<String> {
        self.providers
            .first()?
            .descriptor
            .extensions
            .first()
            .map(|and| and.to_lowercase())
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::error::FormatError;
    use fub_abi::format::{
        DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
    };
    use fub_abi::model::{DocId, DocumentModel};

    struct Fake(&'static str, &'static str);

    impl FormatProvider for Fake {
        fn descriptor(&self) -> FormatDescriptor {
            FormatDescriptor::text(self.0, self.0, &[self.1])
        }
        fn capabilities(&self) -> FormatCapabilities {
            FormatCapabilities::default()
        }
        fn parse(
            &self,
            _source: &DocumentSource,
            ctx: &ParseContext,
        ) -> Result<DocumentModel, FormatError> {
            Ok(DocumentModel::empty(DocId::new(ctx.doc_id.clone())))
        }
        fn render_html(
            &self,
            _m: &DocumentModel,
            _or: &RenderOptions,
        ) -> Result<String, FormatError> {
            Ok(String::new())
        }
        fn serialize(&self, _m: &DocumentModel) -> Result<String, FormatError> {
            Ok(String::new())
        }
    }

    #[test]
    fn who_registers_after_not_wins_more_in_silence() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Fake("uno", "md"))).unwrap();
        let err = reg
            .register(Box::new(Fake("due", "md")))
            .expect_err("`md` is already claimed");
        assert_eq!(err.incumbent, "uno");
        assert_eq!(err.challenger, "due");
        // E il primo è ancora quello che serve i `.md`.
        assert_eq!(reg.provider_for_ext("md").unwrap().descriptor().id, "uno");
    }

    #[test]
    fn a_provider_in_conflict_not_remains_registered_a_metadata() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Fake("uno", "md"))).unwrap();

        struct Two;
        impl FormatProvider for Two {
            fn descriptor(&self) -> FormatDescriptor {
                // Una libera e una contesa.
                FormatDescriptor::text("due", "due", &["mdx", "md"])
            }
            fn capabilities(&self) -> FormatCapabilities {
                FormatCapabilities::default()
            }
            fn parse(
                &self,
                _s: &DocumentSource,
                ctx: &ParseContext,
            ) -> Result<DocumentModel, FormatError> {
                Ok(DocumentModel::empty(DocId::new(ctx.doc_id.clone())))
            }
            fn render_html(
                &self,
                _m: &DocumentModel,
                _or: &RenderOptions,
            ) -> Result<String, FormatError> {
                Ok(String::new())
            }
            fn serialize(&self, _m: &DocumentModel) -> Result<String, FormatError> {
                Ok(String::new())
            }
        }
        assert!(reg.register(Box::new(Two)).is_err());
        assert!(
            reg.provider_for_ext("mdx").is_none(),
            "l'estensione libera non deve restare registrata dal perdente"
        );
    }

    #[test]
    fn extension_lookups_use_normalized_hash_keys() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Fake("markdown", "md"))).unwrap();

        assert_eq!(
            reg.provider_for_ext("md").unwrap().descriptor().id,
            "markdown"
        );
        assert_eq!(
            reg.provider_for_ext("MD").unwrap().descriptor().id,
            "markdown"
        );
        assert!(reg.has_doc_ext("md"));
        assert!(reg.has_doc_ext("MD"));
        assert!(!reg.has_doc_ext("txt"));
    }

    #[test]
    fn replace_remains_possible_but_goes_asked_for_name() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Fake("uno", "md"))).unwrap();
        reg.replace(Box::new(Fake("due", "md")));
        assert_eq!(reg.provider_for_ext("md").unwrap().descriptor().id, "due");
    }
}
