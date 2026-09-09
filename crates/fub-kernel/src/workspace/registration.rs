//! Provider declarations cross the external-call boundary as owned data.
//!
//! Construct a token without a workspace guard. Committing only consults the
//! host's admission policy and stored declarations; it never calls the provider.
//! Rejection leaves ownership in the token, so its destructor also runs after
//! the caller releases the guard.

use super::*;
use fub_abi::custom::{CustomRendererSpec, SyntaxRuleSpec};

/// Authority to publish providers for one live plugin declaration.
///
/// The workspace identity prevents cross-vault reuse. The declaration
/// generation prevents an old mount from publishing after the same owner was
/// retired and declared again.
pub struct RegistrationPermit {
    workspace_id: u64,
    owner: String,
    generation: u64,
}

impl RegistrationPermit {
    pub fn owner(&self) -> &str {
        &self.owner
    }
}

enum Declaration {
    Commands(Vec<CommandSpec>, Box<dyn CommandProvider>),
    Views(Vec<ViewSpec>, Box<dyn ViewProvider>),
    Export(Vec<String>, Box<dyn ExportProvider>),
    Import(Box<dyn ImportProvider>),
    Handler(Box<dyn EventHandler>),
    Service(Vec<String>, Box<dyn ServiceProvider>),
    Syntax(SyntaxRuleSpec, Option<Box<dyn SyntaxRule>>),
    Renderer(CustomRendererSpec, Option<Box<dyn CustomRenderer>>),
}

/// A provider and its declarations, obtained outside `Custody<Workspace>`.
/// The opaque payload cannot be altered between admission and publication.
pub struct PreparedRegistration {
    declaration: Option<Declaration>,
}

impl PreparedRegistration {
    fn new(declaration: Declaration) -> Self {
        Self {
            declaration: Some(declaration),
        }
    }

    /// Calls `commands` exactly once, without borrowing a workspace.
    pub fn commands(provider: Box<dyn CommandProvider>) -> std::result::Result<Self, PluginError> {
        let (specs, provider) = capture(provider, |provider| provider.commands())?;
        Ok(Self::new(Declaration::Commands(specs, provider)))
    }

    /// Calls `views` and each declared instance's `interests` outside a guard.
    pub fn views(provider: Box<dyn ViewProvider>) -> std::result::Result<Self, PluginError> {
        let (specs, provider) = capture(provider, |provider| {
            crate::providers::declared_specs(provider)
        })?;
        Ok(Self::new(Declaration::Views(specs, provider)))
    }

    /// Calls `targets` exactly once, without borrowing a workspace.
    pub fn export(provider: Box<dyn ExportProvider>) -> std::result::Result<Self, PluginError> {
        let (ids, provider) = capture(provider, |provider| {
            provider
                .targets()
                .into_iter()
                .map(|target| target.id)
                .collect()
        })?;
        Ok(Self::new(Declaration::Export(ids, provider)))
    }

    pub fn syntax(provider: Box<dyn SyntaxRule>) -> std::result::Result<Self, PluginError> {
        let (spec, provider) = capture(provider, |provider| provider.spec())?;
        Ok(Self::new(Declaration::Syntax(spec, Some(provider))))
    }

    pub fn renderer(provider: Box<dyn CustomRenderer>) -> std::result::Result<Self, PluginError> {
        let (spec, provider) = capture(provider, |provider| provider.spec())?;
        Ok(Self::new(Declaration::Renderer(spec, Some(provider))))
    }

    pub fn import(provider: Box<dyn ImportProvider>) -> Self {
        Self::new(Declaration::Import(provider))
    }

    pub fn event_handler(provider: Box<dyn EventHandler>) -> Self {
        Self::new(Declaration::Handler(provider))
    }

    pub fn service(provides: Vec<String>, provider: Box<dyn ServiceProvider>) -> Self {
        Self::new(Declaration::Service(provides, provider))
    }
}

impl Workspace {
    pub fn registration_permit(
        &self,
        owner: &str,
    ) -> std::result::Result<RegistrationPermit, RegistryError> {
        let generation = self
            .providers
            .plugins
            .generation_of(owner)
            .ok_or_else(|| RegistryError::UnknownPlugin(owner.to_owned()))?;
        if self.providers.plugins.is_retiring(owner) {
            return Err(RegistryError::RegistrationPhase(owner.to_owned()));
        }
        Ok(RegistrationPermit {
            workspace_id: self.workspace_id,
            owner: owner.to_owned(),
            generation,
        })
    }

    fn validate_registration_permit(
        &self,
        permit: &RegistrationPermit,
    ) -> std::result::Result<(), RegistryError> {
        self.validate_permit_identity(permit)?;
        if self.providers.plugins.is_retiring(&permit.owner) {
            return Err(RegistryError::RegistrationPhase(permit.owner.clone()));
        }
        Ok(())
    }

    fn validate_permit_identity(
        &self,
        permit: &RegistrationPermit,
    ) -> std::result::Result<(), RegistryError> {
        if permit.workspace_id != self.workspace_id
            || self.providers.plugins.generation_of(&permit.owner) != Some(permit.generation)
        {
            return Err(RegistryError::RegistrationPhase(permit.owner.clone()));
        }
        Ok(())
    }

    pub fn registration_services(
        &self,
        permit: &RegistrationPermit,
    ) -> std::result::Result<Vec<String>, RegistryError> {
        self.validate_registration_permit(permit)?;
        let provides = self
            .providers
            .plugins
            .get(permit.owner())
            .expect("validated owner")
            .manifest
            .provides
            .clone();
        if provides.is_empty() {
            return Err(RegistryError::NothingProvided(permit.owner().to_owned()));
        }
        Ok(provides)
    }

    /// Publishes the singleton write hook for the permit's owner. The owner is
    /// derived from the permit so a registrar cannot attach code to another
    /// plugin's lifecycle.
    pub fn commit_before_write_hook(
        &mut self,
        permit: &RegistrationPermit,
        hook: &mut Option<BeforeWriteHook>,
    ) -> std::result::Result<(), RegistryError> {
        self.validate_registration_permit(permit)?;
        if self.before_write.is_some() {
            return Err(RegistryError::RegistrationPhase(permit.owner.clone()));
        }
        self.before_write = Some((
            permit.owner.clone(),
            hook.take()
                .ok_or_else(|| RegistryError::RegistrationPhase(permit.owner.clone()))?,
        ));
        Ok(())
    }

    /// Publishes a declaration without invoking or dropping external code.
    /// On rejection the token still owns the provider. On success it is empty
    /// and cannot be committed a second time.
    pub fn commit_registration(
        &mut self,
        permit: &RegistrationPermit,
        prepared: &mut PreparedRegistration,
    ) -> std::result::Result<(), RegistryError> {
        self.validate_registration_permit(permit)?;
        let plugin = permit.owner();
        let declaration = prepared
            .declaration
            .as_mut()
            .ok_or_else(|| RegistryError::RegistrationPhase(plugin.to_owned()))?;
        let (kind, ids) = match declaration {
            Declaration::Commands(specs, _) => (
                RegistrationKind::Command,
                specs.iter().map(|s| s.id.clone()).collect(),
            ),
            Declaration::Views(specs, _) => (
                RegistrationKind::View,
                specs.iter().map(|s| s.id.clone()).collect(),
            ),
            Declaration::Export(ids, _) => (RegistrationKind::Export, ids.clone()),
            Declaration::Import(_) => (RegistrationKind::Import, Vec::new()),
            Declaration::Handler(_) => (RegistrationKind::EventHandler, Vec::new()),
            Declaration::Service(provides, _) => (RegistrationKind::Service, provides.clone()),
            Declaration::Syntax(spec, _) => (RegistrationKind::Syntax, vec![spec.id.clone()]),
            Declaration::Renderer(spec, _) => (RegistrationKind::Renderer, vec![spec.id.clone()]),
        };
        self.providers.plugins.admit(plugin, kind, &ids)?;
        if let Declaration::Commands(specs, _) = declaration {
            // Keybindings are synthesized by the host, after name admission
            // and before publication: a rejected command must not declare keys.
            let keys = self.keybinding_specs(specs);
            self.settings
                .write()
                .expect("store di configurazione")
                .declare(plugin, &keys)
                .map_err(RegistryError::Setting)?;
        }
        let trust = self.providers.plugins.trust_of(plugin).unwrap_or_default();
        match declaration {
            Declaration::Syntax(spec, provider) => {
                self.providers.plugins.check_names(plugin, &spec.produces)?;
                self.docs
                    .syntax
                    .register_prepared(spec.clone(), provider)
                    .map_err(RegistryError::Syntax)?;
                self.projection_generation = self.projection_generation.wrapping_add(1);
                self.syntax_generation = self.syntax_generation.wrapping_add(1);
            }
            Declaration::Renderer(spec, provider) => {
                self.docs
                    .renderers
                    .register_prepared(trust, spec.clone(), provider)
                    .map_err(RegistryError::Renderer)?;
                self.projection_generation = self.projection_generation.wrapping_add(1);
            }
            _ => {}
        }
        self.providers.plugins.record(plugin, kind, &ids);
        match prepared.declaration.take().expect("checked above") {
            Declaration::Syntax(_, _) | Declaration::Renderer(_, _) => {}
            Declaration::Commands(specs, provider) => {
                self.providers.commands.push(RegisteredCommand {
                    id: plugin.to_owned(),
                    specs,
                    provider: Arc::from(provider),
                })
            }
            Declaration::Views(specs, provider) => self.providers.views.push(RegisteredView {
                id: plugin.to_owned(),
                specs,
                provider: Arc::new(SharedShelter::new(provider)),
                generation: Arc::new(()),
                trust,
            }),
            Declaration::Export(_, provider) => {
                self.providers.exports.push((plugin.to_owned(), provider))
            }
            Declaration::Import(provider) => {
                self.providers.imports.push((plugin.to_owned(), provider))
            }
            Declaration::Handler(provider) => {
                self.providers.handlers.push((plugin.to_owned(), provider))
            }
            Declaration::Service(_, provider) => self
                .providers
                .services
                .push((plugin.to_owned(), Arc::from(provider))),
        }
        Ok(())
    }
}

enum RetiredProvider {
    Command(Arc<dyn CommandProvider>),
    View(Arc<SharedShelter<Box<dyn ViewProvider>>>),
    Handler(Box<dyn EventHandler>),
    Service(Arc<dyn ServiceProvider>),
    Import(Box<dyn ImportProvider>),
    Export(Box<dyn ExportProvider>),
    Syntax(Arc<dyn SyntaxRule>),
    Renderer(Arc<dyn CustomRenderer>),
    BeforeWrite(BeforeWriteHook),
}

/// Provider ownership removed from a workspace but kept alive until the host
/// has released its custody guard. Index shutdown is an explicit external
/// phase while the owner declaration and its `Guard` are still alive.
pub struct PreparedPluginDeactivation {
    owner: String,
    workspace_id: u64,
    generation: u64,
    indexes: Vec<(String, crate::index::SharedIndexProvider)>,
    providers: Vec<RetiredProvider>,
    removed_indexes: bool,
}

impl PreparedPluginDeactivation {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn close_indexes(&self, host: &mut dyn HostApi) -> Vec<PluginError> {
        let mut errors = Vec::new();
        for (_, provider) in &self.indexes {
            let mut provider = provider.write();
            for (phase, close) in [("index flush", false), ("index close", true)] {
                let result = crate::safety::external(
                    phase,
                    |message| PluginError::Internal(message.into()),
                    || {
                        if close {
                            provider.close(host)
                        } else {
                            provider.flush(host)
                        }
                    },
                );
                if let Err(error) = result {
                    errors.push(error);
                }
            }
        }
        errors
    }

    fn permit(&self) -> RegistrationPermit {
        RegistrationPermit {
            workspace_id: self.workspace_id,
            owner: self.owner.clone(),
            generation: self.generation,
        }
    }

    /// Drops each retired owner independently. One hostile destructor cannot
    /// turn a later hostile destructor into a double-panic abort.
    pub fn dispose(mut self) -> Vec<PluginError> {
        let mut errors = Vec::new();
        for (_, provider) in self.indexes.drain(..) {
            if let Err(error) = crate::safety::external(
                "retired index drop",
                |message| PluginError::Internal(message.into()),
                || {
                    drop(provider);
                    Ok(())
                },
            ) {
                errors.push(error);
            }
        }
        for provider in self.providers.drain(..) {
            if let Err(error) = crate::safety::external(
                "retired provider drop",
                |message| PluginError::Internal(message.into()),
                || {
                    match provider {
                        RetiredProvider::Command(provider) => drop(provider),
                        RetiredProvider::View(provider) => drop(provider),
                        RetiredProvider::Handler(provider) => drop(provider),
                        RetiredProvider::Service(provider) => drop(provider),
                        RetiredProvider::Import(provider) => drop(provider),
                        RetiredProvider::Export(provider) => drop(provider),
                        RetiredProvider::Syntax(provider) => drop(provider),
                        RetiredProvider::Renderer(provider) => drop(provider),
                        RetiredProvider::BeforeWrite(provider) => drop(provider),
                    }
                    Ok(())
                },
            ) {
                errors.push(error);
            }
        }
        errors
    }
}

impl Workspace {
    /// Marks the declaration as retiring and extracts its indexes without
    /// invoking or dropping external code. Other providers stay reachable
    /// until index shutdown has completed; neither an old nor a freshly
    /// requested permit can publish more providers meanwhile.
    pub fn prepare_plugin_deactivation(
        &mut self,
        permit: &RegistrationPermit,
    ) -> std::result::Result<PreparedPluginDeactivation, RegistryError> {
        self.validate_registration_permit(permit)?;
        if self.dispatch.in_provider_call() {
            return Err(RegistryError::Busy(permit.owner.clone()));
        }
        self.providers.plugins.begin_retirement(&permit.owner);

        let indexes = self.indexes.remove(&permit.owner);
        let removed_indexes = !indexes.is_empty();
        Ok(PreparedPluginDeactivation {
            owner: permit.owner.clone(),
            workspace_id: permit.workspace_id,
            generation: permit.generation,
            indexes,
            providers: Vec::new(),
            removed_indexes,
        })
    }

    /// Retires the declaration after external index shutdown. Every remaining
    /// provider is moved into `prepared`, so its destructor runs only after the
    /// caller releases the workspace guard.
    pub fn finish_plugin_deactivation(
        &mut self,
        prepared: &mut PreparedPluginDeactivation,
    ) -> std::result::Result<(), RegistryError> {
        let permit = prepared.permit();
        self.validate_permit_identity(&permit)?;
        if !self.providers.plugins.is_retiring(&prepared.owner) {
            return Err(RegistryError::RegistrationPhase(prepared.owner.clone()));
        }

        prepared.providers.extend(
            self.providers
                .commands
                .extract(|entry| entry.id == permit.owner)
                .into_iter()
                .map(|entry| RetiredProvider::Command(entry.provider)),
        );
        prepared.providers.extend(
            self.providers
                .views
                .extract(|entry| entry.id == permit.owner)
                .into_iter()
                .map(|entry| RetiredProvider::View(entry.provider)),
        );
        prepared.providers.extend(
            self.providers
                .handlers
                .extract(|(owner, _)| owner == &permit.owner)
                .into_iter()
                .map(|(_, provider)| RetiredProvider::Handler(provider)),
        );
        prepared.providers.extend(
            self.providers
                .services
                .extract(|(owner, _)| owner == &permit.owner)
                .into_iter()
                .map(|(_, provider)| RetiredProvider::Service(provider)),
        );
        prepared.providers.extend(
            self.providers
                .imports
                .extract(|(owner, _)| owner == &permit.owner)
                .into_iter()
                .map(|(_, provider)| RetiredProvider::Import(provider)),
        );
        prepared.providers.extend(
            self.providers
                .exports
                .extract(|(owner, _)| owner == &permit.owner)
                .into_iter()
                .map(|(_, provider)| RetiredProvider::Export(provider)),
        );

        let mut syntax_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(&permit.owner, RegistrationKind::Syntax)
        {
            if let Some(provider) = self.docs.syntax.take(&id) {
                syntax_changed = true;
                prepared.providers.push(RetiredProvider::Syntax(provider));
            }
        }
        let mut renderer_changed = false;
        for id in self
            .providers
            .plugins
            .ids_of(&permit.owner, RegistrationKind::Renderer)
        {
            if let Some(provider) = self.docs.renderers.take(&id) {
                renderer_changed = true;
                prepared.providers.push(RetiredProvider::Renderer(provider));
            }
        }
        if syntax_changed {
            self.syntax_generation = self.syntax_generation.wrapping_add(1);
        }
        if syntax_changed || renderer_changed {
            self.projection_generation = self.projection_generation.wrapping_add(1);
        }
        if self
            .before_write
            .as_ref()
            .is_some_and(|(owner, _)| owner == &permit.owner)
        {
            let (_, hook) = self.before_write.take().expect("owner checked above");
            prepared.providers.push(RetiredProvider::BeforeWrite(hook));
        }
        self.providers.plugins.retire(&prepared.owner);
        self.settings
            .write()
            .expect("store di configurazione")
            .withdraw(&prepared.owner);
        for job in self.dispatch.take_jobs_of(&prepared.owner) {
            self.complete_job(
                job.id,
                job.spec.job.clone(),
                Err(PluginError::Internal(
                    format!(
                        "`{}` è stato disattivato prima che il job `{}` partisse",
                        prepared.owner, job.spec.job
                    )
                    .into(),
                )),
            );
        }
        if prepared.removed_indexes {
            self.as_actor(Actor::Kernel, |ws| {
                ws.emit_event(Event::IndexUpdated);
                ws.dispatch_pending();
            });
        }
        Ok(())
    }
}

/// An index's captured routes and unregistered body. Activation and cleanup
/// are explicit external phases; commit publishes only data and ownership.
pub struct PreparedIndexRegistration {
    routes: Vec<QueryRoute>,
    provider: Option<Box<dyn IndexProvider>>,
    activated: Option<std::result::Result<(), PluginError>>,
}

impl PreparedIndexRegistration {
    pub fn new(provider: Box<dyn IndexProvider>) -> std::result::Result<Self, PluginError> {
        let (routes, provider) = capture(provider, |provider| provider.routes())?;
        Ok(Self {
            routes,
            provider: Some(provider),
            activated: None,
        })
    }

    /// Activate once, outside the workspace guard. A recoverable failure is
    /// retained for the same `RegistryError::Activate` publication contract.
    pub fn activate(&mut self, host: &mut dyn HostApi) -> std::result::Result<(), PluginError> {
        if self.activated.is_some() {
            return Err(PluginError::Conflict(
                "index activation already attempted".into(),
            ));
        }
        let provider = self
            .provider
            .as_mut()
            .ok_or_else(|| PluginError::Conflict("index already published".into()))?;
        let result = crate::safety::external(
            "index activate",
            |message| PluginError::Internal(message.into()),
            || provider.activate(host),
        );
        self.activated = Some(result.clone());
        result
    }

    /// Clean up an activated index rejected at publication. No workspace guard
    /// may be held; each callback and the destructor has its own panic boundary.
    pub fn dispose_uncommitted(mut self, host: &mut dyn HostApi) -> Vec<PluginError> {
        let mut errors = Vec::new();
        if let Some(mut provider) = self.provider.take() {
            if self.activated.is_some() {
                for close in [false, true] {
                    let result = crate::safety::external(
                        "uncommitted index cleanup",
                        |message| PluginError::Internal(message.into()),
                        || {
                            if close {
                                provider.close(host)
                            } else {
                                provider.flush(host)
                            }
                        },
                    );
                    if let Err(error) = result {
                        errors.push(error);
                    }
                }
            }
            if let Err(error) = crate::safety::external(
                "uncommitted index drop",
                |message| PluginError::Internal(message.into()),
                || {
                    drop(provider);
                    Ok(())
                },
            ) {
                errors.push(error);
            }
        }
        errors
    }
}

impl Workspace {
    /// Validate captured routes before activation, without publishing them.
    pub fn admit_index_registration(
        &self,
        permit: &RegistrationPermit,
        prepared: &PreparedIndexRegistration,
    ) -> std::result::Result<(), RegistryError> {
        self.validate_registration_permit(permit)?;
        let plugin = permit.owner();
        if prepared.provider.is_none() {
            return Err(RegistryError::RegistrationPhase(plugin.to_owned()));
        }
        let namespaces = plugins::custom_namespaces(&prepared.routes);
        self.providers
            .plugins
            .admit(plugin, RegistrationKind::Index, &namespaces)?;
        let mut routes = self.indexes.routes.clone();
        routes
            .declare(
                crate::index::Target::Provider(self.indexes.providers.len()),
                &prepared.routes,
            )
            .map_err(|mut error| {
                error.challenger = plugin.to_owned();
                RegistryError::Route(error)
            })
    }

    /// Revalidate after activation. Rejection retains the body for explicit
    /// external cleanup; a recoverable activation error still publishes it.
    pub fn commit_index_registration(
        &mut self,
        permit: &RegistrationPermit,
        prepared: &mut PreparedIndexRegistration,
    ) -> std::result::Result<(), RegistryError> {
        self.validate_registration_permit(permit)?;
        let plugin = permit.owner();
        if prepared.activated.is_none() {
            return Err(RegistryError::RegistrationPhase(plugin.to_owned()));
        }
        self.admit_index_registration(permit, prepared)?;
        self.indexes
            .declare_routes(plugin, &prepared.routes)
            .map_err(RegistryError::Route)?;
        let namespaces = plugins::custom_namespaces(&prepared.routes);
        self.providers
            .plugins
            .record(plugin, RegistrationKind::Index, &namespaces);
        self.indexes.providers.push((
            plugin.to_owned(),
            Arc::new(SharedShelter::new(
                prepared.provider.take().expect("admitted provider"),
            )),
        ));
        prepared
            .activated
            .take()
            .expect("activation checked")
            .map_err(RegistryError::Activate)
    }
}

// Keep ownership outside the callback's unwind boundary. If both a declaration
// and its destructor panic, cleanup is a second caught call, never a double panic.
fn capture<T: ?Sized, R>(
    provider: Box<T>,
    call: impl FnOnce(&T) -> R,
) -> std::result::Result<(R, Box<T>), PluginError> {
    match crate::safety::external(
        "provider declaration",
        |message| PluginError::Internal(message.into()),
        || Ok(call(provider.as_ref())),
    ) {
        Ok(declaration) => Ok((declaration, provider)),
        Err(error) => {
            let cleanup = crate::safety::external(
                "rejected provider drop",
                |message| PluginError::Internal(message.into()),
                || {
                    drop(provider);
                    Ok(())
                },
            );
            match cleanup {
                Ok(()) => Err(error),
                Err(cleanup) => Err(PluginError::Internal(format!("{error}; {cleanup}").into())),
            }
        }
    }
}
