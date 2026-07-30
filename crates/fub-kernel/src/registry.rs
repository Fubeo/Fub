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
            "`{}` rivendica l'estensione `{}`, che è già di `{}` \
             (per sostituirlo di proposito: `FormatRegistry::replace`)",
            self.challenger, self.extension, self.incumbent
        )
    }
}

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

    /// Registra un provider (nativo o proxy), o dice **perché no**.
    ///
    /// Le estensioni già rivendicate da un altro provider sono un conflitto e la
    /// registrazione **non avviene affatto** — nemmeno per le estensioni libere
    /// dello stesso provider: un provider registrato a metà è peggio di uno non
    /// registrato, perché funziona per alcuni file e non per altri.
    pub fn register(&mut self, provider: Box<dyn FormatProvider>) -> Result<(), RegistryConflict> {
        let descriptor = provider.descriptor();
        for ext in &descriptor.extensions {
            let ext = ext.to_lowercase();
            if let Some(&at) = self.by_ext.get(&ext) {
                return Err(RegistryConflict {
                    extension: ext,
                    incumbent: self.providers[at].descriptor().id,
                    challenger: descriptor.id,
                });
            }
        }
        self.insert(provider, &descriptor.extensions);
        Ok(())
    }

    /// Registra un provider **sostituendo** chi rivendicava le stesse
    /// estensioni. È l'operazione che `register` faceva prima senza dirlo:
    /// resta possibile, ma adesso chi la vuole la chiede per nome.
    pub fn replace(&mut self, provider: Box<dyn FormatProvider>) {
        let extensions = provider.descriptor().extensions;
        self.insert(provider, &extensions);
    }

    fn insert(&mut self, provider: Box<dyn FormatProvider>, extensions: &[String]) {
        let idx = self.providers.len();
        for ext in extensions {
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
    /// L'ordine di registrazione è una scelta di chi monta l'app (per Fub:
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

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::error::FormatError;
    use fub_abi::format::{
        DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
    };
    use fub_abi::model::{DocId, DocumentModel};

    struct Finto(&'static str, &'static str);

    impl FormatProvider for Finto {
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
            _o: &RenderOptions,
        ) -> Result<String, FormatError> {
            Ok(String::new())
        }
        fn serialize(&self, _m: &DocumentModel) -> Result<String, FormatError> {
            Ok(String::new())
        }
    }

    #[test]
    fn chi_registra_dopo_non_vince_piu_in_silenzio() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Finto("uno", "md"))).unwrap();
        let err = reg
            .register(Box::new(Finto("due", "md")))
            .expect_err("`md` è già rivendicata");
        assert_eq!(err.incumbent, "uno");
        assert_eq!(err.challenger, "due");
        // E il primo è ancora quello che serve i `.md`.
        assert_eq!(reg.provider_for_ext("md").unwrap().descriptor().id, "uno");
    }

    #[test]
    fn un_provider_in_conflitto_non_resta_registrato_a_meta() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Finto("uno", "md"))).unwrap();

        struct Due;
        impl FormatProvider for Due {
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
                _o: &RenderOptions,
            ) -> Result<String, FormatError> {
                Ok(String::new())
            }
            fn serialize(&self, _m: &DocumentModel) -> Result<String, FormatError> {
                Ok(String::new())
            }
        }
        assert!(reg.register(Box::new(Due)).is_err());
        assert!(
            reg.provider_for_ext("mdx").is_none(),
            "l'estensione libera non deve restare registrata dal perdente"
        );
    }

    #[test]
    fn sostituire_resta_possibile_ma_va_chiesto_per_nome() {
        let mut reg = FormatRegistry::new();
        reg.register(Box::new(Finto("uno", "md"))).unwrap();
        reg.replace(Box::new(Finto("due", "md")));
        assert_eq!(reg.provider_for_ext("md").unwrap().descriptor().id, "due");
    }
}
