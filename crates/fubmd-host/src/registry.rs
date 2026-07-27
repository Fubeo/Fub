//! Il **registry dei bundle**: chi monta un plugin coi suoi provider, e chi lo
//! possiede finché è vivo (§9.3,
//! [decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md)).
//!
//! # Perché sta qui e non nel kernel
//!
//! Perché l'`HostApi` **non ha capacità di registrazione**, e non ne avrà: la
//! [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md) ha
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
//! I primi tre sono **tutto-o-niente**: se uno fallisce il bundle non è montato
//! e non resta niente dietro — un `activate` fallito si porta via anche la
//! dichiarazione. Il quarto no, e la differenza è deliberata: un bundle a cui
//! una view si contende il nome è un bundle che funziona meno una view, e
//! smontarlo per intero vorrebbe dire che un id doppio in un plugin di terzi
//! spegne l'indice di ricerca. Ciò che non entra torna come **avviso**.

use std::sync::Arc;

use fubmd_abi::traits::{abi_compatible, HostApi, Plugin, PluginManifest};
use fubmd_abi::PluginError;
use fubmd_kernel::{RegistryError, Trust, Workspace};

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

    /// Registra i provider del bundle: view, comandi, indici, handler, regole
    /// sintattiche, renderer, servizi.
    ///
    /// Chiamata **dopo** [`Plugin::activate`] e con l'id già dichiarato, quindi
    /// ogni `register_*` qui dentro trova il proprio proprietario. Ciò che torna
    /// sono **avvisi** già composti: un pezzo che non entra non smonta il
    /// bundle, e chi monta ha un canale per dirlo (oggi `stderr`, §20.2).
    fn register(&self, ws: &mut Workspace) -> Vec<String>;
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
    /// [`Plugin::activate`] è fallita. La dichiarazione appena fatta è stata
    /// **ritirata**: un bundle che non si è attivato non resta nell'inventario
    /// del §7.6, o «dichiarato» smetterebbe di voler dire «montato».
    Activation { id: String, error: PluginError },
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::Abi { id, declared } => write!(
                f,
                "`{id}` parla il contratto `{declared}`, e questo host parla \
                 `{}`: non si monta",
                fubmd_abi::traits::ABI_VERSION
            ),
            BundleError::Declaration(e) => write!(f, "{e}"),
            BundleError::Activation { id, error } => {
                write!(f, "`{id}` non si è attivato: {error}")
            }
        }
    }
}

impl std::error::Error for BundleError {}

/// Un bundle montato: l'id con cui è dichiarato, e il suo plugin.
///
/// Il plugin è un `Arc` e non un `Box` dalla
/// [0032](../../../docs/decisions/0032-il-runner-dei-job.md): il runner esegue
/// `run_job` su un thread suo e per tutta la durata del job, quindi ha bisogno
/// di **tenere** il corpo senza tenere il lock di questo registry — o chiudere
/// il vault aspetterebbe la fine di un export. `Arc<dyn Plugin>` è la forma di
/// quel prestito, e regge perché `run_job` prende `&self`.
struct MountedBundle {
    id: String,
    plugin: Arc<dyn Plugin>,
}

/// **Chi possiede i bundle** di un workspace, in ordine di montaggio.
///
/// Possedere il plugin è tutto il mestiere di questo tipo, e da lì
/// vengono le due cose che prima non avevano un posto dove stare:
/// [`Plugin::deactivate`], che non aveva un chiamante
/// ([decisione 0028](../../../docs/decisions/0028-come-un-componente-smette.md)),
/// e [`Plugin::run_job`], che è il corpo di un job e che il runner del §9.3
/// dovrà pur chiedere a qualcuno.
#[derive(Default)]
pub struct BundleRegistry {
    mounted: Vec<MountedBundle>,
}

impl BundleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Monta un bundle su un workspace: i quattro passi in testa al modulo.
    ///
    /// Torna gli **avvisi** dei provider che non sono entrati (il bundle è
    /// montato lo stesso), o l'errore di uno dei tre passi che non ammettono un
    /// mezzo montaggio.
    pub fn mount(
        &mut self,
        bundle: &dyn Bundle,
        ws: &mut Workspace,
    ) -> Result<Vec<String>, BundleError> {
        let manifest = bundle.manifest();
        let id = manifest.id.clone();

        // 1. La versione del contratto, prima di ogni altra cosa: un plugin che
        //    parla un'altra major non deve nemmeno comparire nell'inventario.
        if !abi_compatible(&manifest.abi_version) {
            return Err(BundleError::Abi {
                id,
                declared: manifest.abi_version,
            });
        }

        // 2. La dichiarazione. È qui che il kernel applica il §7.3 (permessi e
        //    fiducia), il §7.4 (i nomi dei servizi) e il §7.5 (i requisiti).
        ws.register_plugin(manifest, bundle.trust())
            .map_err(BundleError::Declaration)?;

        // 3. L'attivazione, con le capacità del manifest davanti. Fallire qui
        //    non lascia un plugin dichiarato: il bundle non c'è.
        let mut plugin = bundle.plugin();
        if let Err(error) = ws.with_host(&id, |host| plugin.activate(host)) {
            let _ = ws.deactivate_plugin(&id);
            return Err(BundleError::Activation { id, error });
        }

        // 4. I provider. Da qui in poi ciò che va storto è un avviso.
        let warnings = bundle.register(ws);
        self.mounted.push(MountedBundle {
            id,
            // Dopo l'attivazione, e non prima: `activate` vuole `&mut self`, e
            // il momento in cui il plugin è ancora solo di chi lo ha costruito è
            // proprio questo.
            plugin: Arc::from(plugin),
        });
        Ok(warnings)
    }

    /// Gli id dei bundle montati, in ordine di montaggio.
    pub fn ids(&self) -> Vec<&str> {
        self.mounted.iter().map(|m| m.id.as_str()).collect()
    }

    /// **Il corpo di un job.** Chi drena `take_pending_jobs` sa a quale plugin
    /// chiederlo (è il campo che la
    /// [0028](../../../docs/decisions/0028-come-un-componente-smette.md) ha
    /// messo in `PendingJob`) e lo trova qui.
    ///
    /// Rende un `Arc` clonato e non un prestito, ed è il punto: chi esegue un
    /// job lo tiene per minuti, e un prestito lo terrebbe legato a questo
    /// registry per tutto quel tempo.
    pub fn body(&self, id: &str) -> Option<Arc<dyn Plugin>> {
        self.mounted
            .iter()
            .find(|m| m.id == id)
            .map(|m| Arc::clone(&m.plugin))
    }

    /// **Chi smette lo sa mentre è ancora intero**: chiama
    /// [`Plugin::deactivate`] e lascia cadere il plugin, senza toccare il
    /// kernel.
    ///
    /// È il passo che va infilato dentro la chiusura del vault
    /// ([`Workspace::close_with`]) e dentro [`unmount`](BundleRegistry::unmount),
    /// e non può stare da nessun'altra parte: dopo che il kernel ha ritirato la
    /// dichiarazione, l'host intestato a quell'id nega tutto — un `deactivate`
    /// chiamato lì riceverebbe rifiuti su ogni capacità, cioè il contrario
    /// esatto di ciò per cui quel metodo ha un `host` nella firma.
    ///
    /// Un id che non è un bundle di questo registry non fa niente: il kernel
    /// accetta anche dichiarazioni che non vengono da qui (una feature montata a
    /// mano in un test), e quelle un plugin da spegnere non ce l'hanno.
    pub fn stop(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let Some(at) = self.mounted.iter().position(|m| m.id == id) else {
            return Vec::new();
        };
        let mut bundle = self.mounted.remove(at);
        // `deactivate` prende `&mut self`, quindi vuole che il plugin sia di
        // **uno solo**: lo è, perché chi chiude ferma il pool prima di arrivare
        // qui (`JobRunner::stop`, decisione 0032) e un job in volo è l'unico
        // altro che potrebbe tenerne una copia. Se un giorno qualcuno invertisse
        // i due passi, il commiato non verrebbe chiamato e questo lo **dice**,
        // invece di aspettare in silenzio la fine di un export.
        let out = match Arc::get_mut(&mut bundle.plugin) {
            Some(plugin) => ws.with_host(id, |host| plugin.deactivate(host)).err(),
            None => Some(PluginError::Internal(format!(
                "`{id}` ha un job ancora in volo: il suo `deactivate` non è stato chiamato                  (chi spegne un bundle ferma prima i suoi job)"
            ))),
        };
        // Qui l'ultima copia cade, ed è il momento in cui un bundle nativo
        // lascia andare ciò che il `deactivate` non ha saputo lasciare.
        drop(bundle);
        out.into_iter().collect()
    }

    /// Spegne **un** bundle per intero: [`Plugin::deactivate`] mentre ha ancora
    /// tutto, e poi il kernel che gli toglie i provider e la dichiarazione
    /// ([`Workspace::deactivate_plugin`]).
    ///
    /// È l'inverso esatto di [`mount`](BundleRegistry::mount), e sarà la strada
    /// di chi spegne una feature dalle impostazioni (§11.1).
    pub fn unmount(&mut self, ws: &mut Workspace, id: &str) -> Vec<PluginError> {
        let mut errors = self.stop(ws, id);
        match ws.deactivate_plugin(id) {
            Ok(errs) => errors.extend(errs),
            Err(e) => errors.push(PluginError::Internal(e.to_string())),
        }
        errors
    }

    /// **Chiude il vault**: l'ordine della
    /// [0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)
    /// — l'evento mentre tutti sono ancora vivi, il flush di tutti gli indici,
    /// e poi ognuno che smette a rovescio — con `Plugin::deactivate` di ogni
    /// bundle infilato al proprio posto.
    ///
    /// L'ordine resta del kernel e non si duplica qui: sarebbe una seconda idea
    /// di come si chiude un vault, e le due non si accorgerebbero mai di essere
    /// diverse.
    pub fn close(&mut self, ws: &mut Workspace) -> Vec<PluginError> {
        ws.close_with(|ws, id| self.stop(ws, id))
    }
}

/// Il [`Plugin`] di un bundle che **non possiede niente**: tutto ciò che ha sono
/// i suoi provider, e quelli li toglie il kernel.
///
/// È il caso di quasi tutte le feature ufficiali, e non è un difetto del
/// disegno: è ciò che il capitolo 7 aveva già ottenuto — un provider si registra
/// e sparisce dentro il kernel, che sa attivarlo, interrogarlo e chiuderlo
/// ([`IndexProvider::close`](fubmd_abi::traits::IndexProvider::close), decisione
/// 0028). Ciò che resta a un `Plugin` è quel che il kernel *non* può sapere:
/// risorse proprie del bundle, e il corpo dei suoi job.
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
