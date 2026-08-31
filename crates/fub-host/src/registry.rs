//! Il **registry dei bundle**: chi monta un plugin coi suoi provider, e chi lo
//! possiede finché è vivo (§9.3,
//! [decisione 0031](../../../docs/decisions/0183-composizione-host-kernel.md)).
//!
//! # Perché sta qui e non nel kernel
//!
//! Perché l'`HostApi` **non ha capacità di registrazione**, e non ne avrà: la
//! [decisione 0013](../../../docs/decisions/0185-capability-un-solo-guard.md) ha
//! chiuso l'elenco, e nessun `register_*` ci compare. Ne segue una cosa sola,
//! ed è la forma di questo modulo: **un plugin non può registrarsi da sé**.
//! Qualcuno deve leggere il suo manifest, dichiararlo, chiamare il suo
//! `activate` e mettere i suoi provider nelle mani del kernel — e quel qualcuno
//! è dalla parte dell'host, perché è l'unico che ha un `&mut Workspace`.
//!
//! È anche ciò che rende vera la frase del §9.3, «il pezzo che a M5 il
//! caricatore WASM riuserà tale e quale»: a M5 il caricatore è host-side per
//! costruzione, e ciò che cambia è **come si costruisce un [`Plugin`]** (un
//! componente istanziato invece di un `Box` nativo), non chi lo dichiara né in
//! che ordine.
//!
//! # La strada del montaggio, e cosa è tutto-o-niente
//!
//! Un bundle si monta in quattro passi, sempre gli stessi:
//!
//! 1. **la versione del contratto** — [`abi_compatible`] sul `abi_version` del
//!    manifest. Prima di questa decisione quella funzione esisteva e non la
//!    chiamava nessuno in produzione;
//! 2. **la dichiarazione** — [`Workspace::register_plugin`], che è dove il §7.3,
//!    il §7.4 e il §7.5 dicono la loro (permessi, namespace, requisiti);
//! 3. **[`Plugin::activate`]**, con l'host intestato all'id appena dichiarato;
//! 4. **i provider**, che il bundle registra da sé perché è lui a sapere quali
//!    sono.
//!
//! Tutti e quattro i passi sono **tutto-o-niente**. Un warning recuperabile è
//! una cosa diversa da una registrazione fallita e va dichiarato come tale con
//! [`RegistrationReport`]. Per compatibilità, i bundle che implementano ancora
//! il vecchio [`Bundle::register`] sono conservativi: qualunque messaggio
//! restituito da quel metodo è considerato un fallimento e provoca rollback.

use std::sync::Arc;

use fub_abi::traits::{abi_compatible, HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_kernel::{RegistryError, Trust, Workspace};

/// Di che famiglia è un bundle: come lo presenta l'inventario.
///
/// La distinzione serve a chi disegna un elenco — componenti e temi non si
/// accendono dalla stessa riga, e il tema non offre un interruttore nel senso
/// dei componenti — e nasce qui e non nel manifest perché è ciò che l'host sa
/// del bundle, non ciò che il bundle dice di sé (la stessa riga di
/// [`Trust`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BundleKind {
    /// Un componente: un plugin con provider da montare.
    Component,
    /// Un tema: solo la pelle, dichiarata da un [`ThemeManifest`](fub_abi::theme::ThemeManifest).
    Theme,
}

/// Esito della fase di registrazione dei provider di un bundle.
///
/// Un warning dice «il bundle è intero ma qualcosa di recuperabile è successo»;
/// un failure dice invece «il bundle non è quello dichiarato dal manifest» e
/// obbliga il registry a ritirare provider, dichiarazione e plugin attivato.
#[derive(Debug, Default)]
pub struct RegistrationReport {
    warnings: Vec<String>,
    failure: Option<String>,
}

impl RegistrationReport {
    /// Nessun problema e nessun warning.
    pub fn complete() -> Self {
        Self::default()
    }

    /// Montaggio riuscito con un warning esplicitamente recuperabile.
    pub fn warning(message: impl Into<String>) -> Self {
        Self {
            warnings: vec![message.into()],
            failure: None,
        }
    }

    /// Aggiunge un warning recuperabile a un report riuscito.
    pub fn with_warning(mut self, message: impl Into<String>) -> Self {
        self.warnings.push(message.into());
        self
    }

    /// La registrazione non è completa: il bundle deve essere ritirato.
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            warnings: Vec::new(),
            failure: Some(message.into()),
        }
    }

    /// Adatta il vecchio contratto `Vec<String>` in modo conservativo: se una
    /// registrazione ha restituito anche un solo errore, il bundle non resta a
    /// metà. I warning davvero recuperabili usano [`warning`](Self::warning).
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

/// Un **bundle**: un [`Plugin`] e i provider che registra, visti da chi li
/// monta.
///
/// È il trait che il §9.3 chiedeva, ed è host-side per la ragione scritta in
/// testa al modulo. Un'implementazione risponde a quattro domande e nessuna di
/// più: chi sei, quanto ti si crede, qual è il tuo plugin, e cosa registri.
pub trait Bundle: Send + Sync {
    /// Chi è: id, versione, versione di ABI, permessi, servizi offerti e
    /// richiesti. È ciò che il registry **dichiara** al kernel.
    fn manifest(&self) -> PluginManifest;

    /// Di che famiglia è, per l'inventario. Il default è
    /// [`BundleKind::Component`]: i componenti erano l'unica famiglia prima
    /// dei temi, e un'implementazione che non dice niente resta quella di
    /// prima — ciò che si ottiene dimenticandosi di dichiararlo non può essere
    /// più di ciò che si otteneva dichiarando.
    fn kind(&self) -> BundleKind {
        BundleKind::Component
    }

    /// Quanto l'host si fida di lui.
    ///
    /// Non sta nel manifest e non ci starà mai: è ciò che l'host pensa del
    /// bundle, non ciò che il bundle dice di sé
    /// ([`Workspace::register_plugin`]). Il default è
    /// [`Trust::default`] — il grado più restrittivo fra quelli che girano — per
    /// la stessa ragione per cui lo è là: ciò che si ottiene dimenticandosi di
    /// dichiararlo non può essere più di ciò che si ottiene dichiarando.
    fn trust(&self) -> Trust {
        Trust::default()
    }

    /// Il plugin del bundle. **Costruirlo non è attivarlo**: qui non c'è il
    /// workspace, e non è una svista.
    ///
    /// Tutto ciò che ha bisogno del vault sta in [`Plugin::activate`] (roba del
    /// plugin) o in [`register`](Bundle::register) (roba di chi lo monta), che
    /// sono i due momenti in cui l'id è già dichiarato e quindi le capacità
    /// hanno un proprietario. A M5 questo metodo è l'istanziazione di un
    /// componente WASM, che il vault non lo vede nemmeno lei.
    fn plugin(&self) -> Box<dyn Plugin>;

    /// Registra i provider del bundle.
    ///
    /// Questo è il contratto storico. Da ora qualunque elemento restituito è un
    /// **fallimento di registrazione**: il registry ritira l'intero bundle. Chi
    /// ha davvero un warning recuperabile sovrascrive [`registration`](Self::registration)
    /// e lo dichiara esplicitamente con [`RegistrationReport`].
    fn register(&self, ws: &mut Workspace) -> Vec<String>;

    /// Esito strutturato della registrazione.
    ///
    /// Il default rende sicuri anche i bundle non ancora migrati: un vecchio
    /// `Vec<String>` non può più lasciare un componente montato a metà.
    fn registration(&self, ws: &mut Workspace) -> RegistrationReport {
        RegistrationReport::from_legacy(self.register(ws))
    }
}

/// Perché un bundle **non** è montato.
///
/// Ogni variante vuol dire "non c'è, e non ha lasciato niente dietro": è la
/// stessa disciplina di [`RegistryError`], un livello più in su.
#[derive(Debug)]
pub enum BundleError {
    /// Il manifest dichiara una versione del contratto che questo host non
    /// serve ([`abi_compatible`]).
    Abi { id: String, declared: String },
    /// La dichiarazione è stata rifiutata dal kernel: id doppio, nome fuori dal
    /// proprio namespace, requisito che nessuno offre.
    Declaration(RegistryError),
    /// Si è chiesto di accendere un bundle che questo host non sa montare
    /// (§11.1).
    Unknown(String),
    /// [`Plugin::activate`] è fallita. La dichiarazione appena fatta è stata
    /// ritirata.
    Activation { id: String, error: PluginError },
    /// Il plugin si è attivato ma uno dei provider obbligatori non si è
    /// registrato. Il registry ha eseguito il rollback prima di restituire.
    Registration { id: String, error: String },
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::Abi { id, declared } => write!(
                f,
                "`{id}` speaks contract `{declared}`, but this host speaks \
                 `{}`: will not mount",
                fub_abi::traits::ABI_VERSION
            ),
            BundleError::Declaration(and) => write!(f, "{and}"),
            BundleError::Activation { id, error } => {
                write!(f, "`{id}` did not activate: {error}")
            }
            BundleError::Registration { id, error } => {
                write!(f, "`{id}` did not register atomically: {error}")
            }
            BundleError::Unknown(id) => {
                write!(f, "`{id}` is not a bundle this host knows how to mount")
            }
        }
    }
}

impl std::error::Error for BundleError {}

/// Perché un bundle non è montato, **come lo vede chi l'ha chiesto** (§12.2).
impl From<BundleError> for PluginError {
    fn from(and: BundleError) -> Self {
        match and {
            BundleError::Abi { .. } => PluginError::Unserved(and.to_string().into()),
            BundleError::Unknown(_) => PluginError::NotFound(and.to_string().into()),
            BundleError::Declaration(_) | BundleError::Registration { .. } => {
                PluginError::Internal(and.to_string().into())
            }
            BundleError::Activation { .. } => and.into_activation_error(),
        }
    }
}

impl BundleError {
    /// L'errore di un'attivazione fallita, con l'id di chi non si è attivato
    /// premesso al messaggio.
    fn into_activation_error(self) -> PluginError {
        let BundleError::Activation { id, mut error } = self else {
            unreachable!("called only on the Activation branch")
        };
        let message = error.message_mut();
        *message = format!("`{id}` non si è attivato: {message}").into();
        error
    }
}

/// Un bundle montato: l'id con cui è dichiarato, e il suo plugin.
struct MountedBundle {
    id: String,
    plugin: Arc<dyn Plugin>,
}

/// **Chi possiede i bundle** di un workspace, in ordine di montaggio.
#[derive(Default)]
pub struct BundleRegistry {
    /// I bundle che questo host sa montare, in ordine di tabella. Chi è qui e
    /// non in `mounted` è **spento**, non assente.
    known: Vec<Arc<dyn Bundle>>,
    mounted: Vec<MountedBundle>,
}

/// Una riga dell'inventario dei bundle: chi c'è, come si chiama, e se è acceso.
#[derive(Clone, Debug, serde::Serialize)]
pub struct BundleInfo {
    /// Chi è: l'id con cui il bundle è dichiarato nel kernel.
    pub id: String,
    /// Come si chiama, per gli elenchi.
    pub name: String,
    /// Se è acceso.
    pub mounted: bool,
    /// Di che famiglia è: un componente o un tema.
    pub kind: BundleKind,
    /// Quanto l'host si fida di chi lo ha prodotto.
    pub trust: Trust,
    /// I permessi che il suo manifest dichiara, coi loro parametri (§23.17).
    pub permissions: fub_abi::options::OptionMap,
}

impl BundleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Monta un bundle su un workspace: i quattro passi in testa al modulo.
    pub fn mount(&mut self, bundle: &dyn Bundle, ws: &mut Workspace) -> Result<(), BundleError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();

        // 1. La versione del contratto, prima di ogni altra cosa.
        if !abi_compatible(&manifest.abi_version) {
            return Err(BundleError::Abi {
                id,
                declared: manifest.abi_version,
            });
        }

        // 2. La dichiarazione.
        ws.register_plugin(manifest, bundle.trust())
            .map_err(BundleError::Declaration)?;

        // 3. L'attivazione. Fallire qui ritira la dichiarazione.
        let mut plugin = bundle.plugin();
        if let Err(error) = ws.with_host(&id, |host| plugin.activate(host)) {
            let _ = ws.deactivate_plugin(&id);
            return Err(BundleError::Activation { id, error });
        }

        // 4. I provider. A differenza del vecchio montaggio, una registrazione
        // obbligatoria fallita non lascia il bundle a metà: prima si dà al
        // plugin il commiato mentre il suo host e gli eventuali provider già
        // entrati sono ancora vivi, poi il kernel ritira tutto ciò che porta
        // quell'id. Non passa da `unmount`: il bundle non è mai entrato in
        // `mounted`, quindi non fingiamo che un montaggio riuscito sia esistito.
        let (warnings, failure) = bundle.registration(ws).into_parts();
        if let Some(mut error) = failure {
            if let Err(and) = ws.with_host(&id, |host| plugin.deactivate(host)) {
                error.push_str(&format!("; rollback deactivate failed: {and}"));
            }
            match ws.deactivate_plugin(&id) {
                Ok(errors) => {
                    for and in errors {
                        error.push_str(&format!("; rollback provider close failed: {and}"));
                    }
                }
                Err(and) => error.push_str(&format!("; rollback failed: {and}")),
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

    /// Gli id dei bundle montati, in ordine di montaggio.
    pub fn ids(&self) -> Vec<&str> {
        self.mounted.iter().map(|m| m.id.as_str()).collect()
    }

    /// Aggiunge un bundle ai **conosciuti**, senza montarlo.
    pub fn remember(&mut self, bundle: Arc<dyn Bundle>) {
        let id = bundle.manifest().id;
        self.known.retain(|b| b.manifest().id != id);
        self.known.push(bundle);
    }

    pub fn inventory(&self) -> Vec<BundleInfo> {
        self.known
            .iter()
            .map(|b| {
                let manifest = b.manifest();
                BundleInfo {
                    mounted: self.mounted.iter().any(|m| m.id == manifest.id),
                    trust: b.trust(),
                    permissions: manifest.permissions.granted,
                    id: manifest.id,
                    name: manifest.name,
                    kind: b.kind(),
                }
            })
            .collect()
    }

    /// **Accende** un bundle conosciuto.
    pub fn enable(&mut self, ws: &mut Workspace, id: &str) -> Result<(), BundleError> {
        if self.mounted.iter().any(|m| m.id == id) {
            return Ok(());
        }
        let Some(bundle) = self.known.iter().find(|b| b.manifest().id == id).cloned() else {
            return Err(BundleError::Unknown(id.to_string()));
        };
        self.mount(bundle.as_ref(), ws)
    }

    /// Accende più bundle in ordine **deterministico ma non dipendente
    /// dall'ordine dell'inventario**.
    ///
    /// Un `MissingRequirement` viene rimesso in coda e riprovato dopo che le
    /// righe successive hanno avuto la possibilità di montare i servizi che
    /// offre. Tutti gli altri errori sono definitivi. Se un giro intero non fa
    /// alcun progresso, i requisiti rimasti sono realmente irrisolvibili e
    /// vengono restituiti al chiamante nello stesso ordine in cui erano stati
    /// richiesti.
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
            let mut deferred = Vec::new();
            let mut deferred_errors = Vec::new();
            let mut progressed = false;

            for id in pending {
                let was_mounted = self.mounted.iter().any(|m| m.id == id);
                match self.enable(ws, &id) {
                    Ok(()) => {
                        if !was_mounted {
                            progressed = true;
                        }
                    }
                    Err(
                        error @ BundleError::Declaration(RegistryError::MissingRequirement { .. }),
                    ) => {
                        deferred.push(id);
                        deferred_errors.push(error);
                    }
                    Err(error) => failures.push((id, error)),
                }
            }

            if deferred.is_empty() {
                break;
            }
            if !progressed {
                failures.extend(deferred.into_iter().zip(deferred_errors));
                break;
            }
            pending = deferred;
        }

        failures
    }

    /// **Sa montare questo id?** — cioè: è fra i conosciuti, o è già montato.
    pub fn knows(&self, id: &str) -> bool {
        self.mounted.iter().any(|m| m.id == id) || self.known.iter().any(|b| b.manifest().id == id)
    }

    /// **Il corpo di un job.**
    pub fn body(&self, id: &str) -> Option<Arc<dyn Plugin>> {
        self.mounted
            .iter()
            .find(|m| m.id == id)
            .map(|m| Arc::clone(&m.plugin))
    }

    /// **Chi smette lo sa mentre è ancora intero**: chiama
    /// [`Plugin::deactivate`] e lascia cadere il plugin, senza toccare il
    /// kernel.
    pub fn stop(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let Some(at) = self.mounted.iter().position(|m| m.id == id) else {
            return Vec::new();
        };
        let mut bundle = self.mounted.remove(at);
        let out = match Arc::get_mut(&mut bundle.plugin) {
            Some(plugin) => ws.with_host(id, |host| plugin.deactivate(host)).err(),
            None => Some(PluginError::Internal(
                format!(
                    "`{id}` still has an in-flight job: its `deactivate` was not \
                 called (whoever turns off a bundle stops its jobs first)"
                )
                .into(),
            )),
        };
        drop(bundle);
        out.into_iter().collect()
    }

    /// Spegne **un** bundle per intero.
    pub fn unmount(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let mut errors = self.stop(ws, id);
        match ws.deactivate_plugin(id) {
            Ok(errs) => errors.extend(errs),
            Err(and) => errors.push(PluginError::Internal(and.to_string().into())),
        }
        errors
    }

    /// **Chiude il vault** rispettando l'ordine del kernel.
    pub fn close(&mut self, ws: &mut Workspace) -> Vec<PluginError> {
        ws.close_with(|ws, id| self.stop(ws, id))
    }
}

/// Il [`Plugin`] di un bundle che **non possiede niente**: tutto ciò che ha sono
/// i suoi provider, e quelli li toglie il kernel.
pub struct OnlyProviders(PluginManifest);

impl OnlyProviders {
    pub fn boxed(manifest: PluginManifest) -> Box<dyn Plugin> {
        Box::new(OnlyProviders(manifest))
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
