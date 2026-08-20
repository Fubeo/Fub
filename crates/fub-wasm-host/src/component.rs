//! **Il componente, e i due tipi che lo fanno sembrare un plugin qualunque.**
//!
//! [`Component`] è il `.wasm` compilato e pronto a istanziarsi; [`WasmPlugin`]
//! è un [`Plugin`] che reinoltra ogni metodo a un'istanza; [`WasmBundle`] è la
//! porta da cui si monta, la stessa del §9.3 che monta le feature native.
//!
//! Che il kernel non abbia un ramo per distinguerli non è una gentilezza: è la
//! prova di M5. Il `BundleRegistry` chiama `manifest`, `trust`, `plugin` e
//! `register` senza sapere che dietro c'è una macchina virtuale, e il giorno in
//! cui gli servisse saperlo il «un trait, due backend» sarebbe finito.

use std::sync::{Arc, Mutex};

use camino::Utf8Path;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::traits::{CommandProvider, HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::Bundle;
use fub_kernel::{Trust, Workspace};
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component as WasmtimeComponent, InstancePre, Linker, ResourceType};
use wasmtime::{Engine, Store};

use crate::contract::exports::fub::abi::command as w_command;
use crate::contract::exports::fub::abi::plugin as w_plugin;
use crate::guest::add_to_linker;
use crate::borrow::{with_guest, State};
use crate::translate as tr;

/// Le famiglie del contratto che questo crate serve.
///
/// L'elenco è scritto a mano ed è il **prezzo dichiarato** del linker per
/// interfaccia: chi ne aggiunge una a [`add_to_linker`] la aggiunge anche
/// qui, o un componente che la importa verrebbe rifiutato pur essendo servito.
/// Le due liste divergono in un modo solo, e quel modo è un test che fallisce
/// (`una_famiglia_non_servita_si_fa_nominare`).
const FAMILIES_SERVED: &[&str] = &[
    "fub:abi/host-env",
    "fub:abi/host-vault-read",
    "fub:abi/host-events",
];

/// Il prefisso di una **famiglia di capacità** (§7.1).
///
/// `host-` e non `fub:abi/`: il contratto ha anche interfacce di soli tipi —
/// `json`, `text`, `errors`, `model`, `options`, `settings`, `ui`, `intl` — che
/// un componente importa per *nominare* i tipi che scambia, non per chiamare
/// niente. Non hanno una sola funzione, non c'è niente da linkare, e contarle
/// fra le famiglie non servite rifiuterebbe ogni componente esistente. Lo
/// abbiamo misurato al primo caricamento vero: il ping ne importava otto.
const HOST_FAMILY_PREFIX: &str = "fub:abi/host-";

// ---------------------------------------------------------------------------
// Gli errori del caricamento
// ---------------------------------------------------------------------------

/// Cosa può andare storto **prima** che il componente sia vivo.
///
/// Sta separato da [`PluginError`] perché parla di un'altra cosa: `PluginError`
/// è ciò che un plugin risponde, questo è ciò che succede a chi prova a
/// montarne uno. Un file che non è un componente non ha ancora un id con cui
/// firmarsi.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    /// Il file non si legge.
    #[error("the component cannot be read: {0}")]
    Read(#[from] std::io::Error),
    /// Il file non è un componente valido, o non si compila.
    #[error("the component fails to compile: {0}")]
    Compilation(String),
    /// Il componente importa una famiglia del contratto che questo host non
    /// serve. **Nominarla è metà del messaggio**: «manca una capacità» manda a
    /// cercare, «manca `fub:abi/host-net`» manda a leggere il §20.3.
    #[error("the component imports families that this host does not serve: {0}")]
    UnservedFamilies(String),
    /// Il componente non esporta `fub:abi/plugin`, cioè non è un plugin.
    #[error("the component does not export `fub:abi/plugin`: not a plugin ({0})")]
    NotAPlugin(String),
    /// L'istanziazione è fallita, o il `manifest` non risponde.
    #[error("the component cannot be instantiated: {0}")]
    Instantiation(String),
}

// ---------------------------------------------------------------------------
// Il componente
// ---------------------------------------------------------------------------

/// Un `.wasm` compilato, con il proprio linker, pronto a fare istanze.
///
/// Compilare costa; istanziare no. È la ragione per cui questo tipo esiste
/// separato da [`WasmPlugin`]: un bundle si carica una volta e può fare più
/// istanze — una per montaggio — senza ricompilare niente.
pub struct Component {
    pre: InstancePre<State>,
    indices: w_plugin::GuestIndices,
    /// Gli indici dell'export `fub:abi/command`, **se c'è**.
    ///
    /// L'`Option` è il «mezzo plugin» del §9.3 scritto in un campo: il mondo
    /// dichiara undici export e nessun componente li implementa tutti, quindi
    /// l'assenza di un'interfaccia non è un guasto — è la forma normale. Si
    /// risolve una volta sola, qui, perché `GuestIndices::new` è una ricerca
    /// nel tipo del componente e ripeterla a ogni istanza sarebbe pagarla a
    /// ogni montaggio.
    command_indices: Option<w_command::GuestIndices>,
}

impl Component {
    /// Carica un componente da file.
    pub fn from_file(path: &Utf8Path) -> Result<Self, LoadError> {
        Self::from_bytes(&std::fs::read(path)?)
    }

    /// Carica un componente dai suoi byte.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, LoadError> {
        let engine = crate::limits::engine();
        let component = WasmtimeComponent::new(&engine, bytes)
            .map_err(|and| LoadError::Compilation(format!("{and:#}")))?;
        Self::load(engine, component)
    }

    fn load(engine: Engine, component: WasmtimeComponent) -> Result<Self, LoadError> {
        let mut linker: Linker<State> = Linker::new(&engine);
        add_to_linker(&mut linker)
            .map_err(|and| LoadError::Compilation(format!("{and:#}")))?;

        // Ciò che il componente chiede e questo host non dà. Le due specie
        // ricevono due trattamenti, e la differenza è il §16.1: una famiglia
        // **del contratto** non servita è un rifiuto subito, con il nome —
        // montare un plugin che si romperà a metà lavoro è peggio che non
        // montarlo. Tutto il resto è l'ambiente che il bersaglio `wasm32-wasip2`
        // si porta dietro (`wasi:cli`, `wasi:io`, …): non lo linkiamo, perché
        // un plugin di questo contratto non ha nessuna ragione di chiamarlo, e
        // chi lo chiamasse lo stesso trova un trap invece di una porta aperta
        // sul sistema operativo. È la sandbox nella sua forma più corta.
        let missing: Vec<String> = component
            .component_type()
            .imports(&engine)
            .map(|(name, _)| name.to_string())
            .filter(|name| name.starts_with(HOST_FAMILY_PREFIX))
            .filter(|name| !FAMILIES_SERVED.iter().any(|s| name.starts_with(s)))
            .collect();
        if !missing.is_empty() {
            return Err(LoadError::UnservedFamilies(missing.join(", ")));
        }
        cap_the_rest(&mut linker, &engine, &component)
            .map_err(|and| LoadError::Compilation(format!("{and:#}")))?;

        let pre = linker
            .instantiate_pre(&component)
            .map_err(|and| LoadError::Compilation(format!("{and:#}")))?;
        let indices = w_plugin::GuestIndices::new(&pre)
            .map_err(|and| LoadError::NotAPlugin(format!("{and:#}")))?;
        // `plugin` è obbligatorio — senza non è un plugin, ed è l'errore qui
        // sopra —, `command` no: `Ok` vuol dire «lo esporta», `Err` vuol dire
        // «non lo esporta» e non è un guasto da riportare. Sono le due righe in
        // cui si vede la differenza fra ciò che il contratto pretende e ciò che
        // offre.
        let command_indices = w_command::GuestIndices::new(&pre).ok();

        Ok(Component {
            pre,
            indices,
            command_indices,
        })
    }

    /// Una nuova istanza, viva e non ancora attivata.
    fn instantiate(&self) -> Result<Instance, LoadError> {
        let mut store = Store::new(self.pre.engine(), State::empty());
        crate::limits::arm(&mut store);
        let instance: wasmtime::component::Instance = self
            .pre
            .instantiate(&mut store)
            .map_err(|and| LoadError::Instantiation(format!("{and:#}")))?;
        let plugin = self
            .indices
            .load(&mut store, &instance)
            .map_err(|and| LoadError::Instantiation(format!("{and:#}")))?;
        let commands = match &self.command_indices {
            Some(the) => Some(
                the.load(&mut store, &instance)
                    .map_err(|and| LoadError::Instantiation(format!("{and:#}")))?,
            ),
            None => None,
        };
        Ok(Instance {
            store,
            interfaces: Interfaces {
                plugin,
                commands,
            },
        })
    }
}

/// Tappa con un trap ogni import che il linker non ha già servito.
///
/// Wasmtime ne ha una versione sua, `Linker::define_unknown_imports_as_traps`,
/// e non la usiamo: davanti a un'istanza non guarda se c'è già — chiama
/// `linker.instance(name)` comunque, e su una famiglia che abbiamo appena
/// linkato risponde «*map entry `fub:abi/host-env@0.1.1` defined twice*».
/// L'abbiamo scoperto al primo caricamento vero. Quella funzione serve a chi
/// non linka niente; qui il linker è per interfaccia, e per interfaccia va
/// anche il tappo.
///
/// Ciò che resta da tappare, dopo il filtro delle famiglie, è di due specie e
/// nessuna delle due è una capacità di questo contratto: le interfacce di soli
/// tipi (nessuna funzione dentro, quindi un'istanza vuota) e l'ambiente WASI
/// che il bersaglio `wasm32-wasip2` si porta dietro. Il trap è deliberato: un
/// plugin di questo contratto non chiama `wasi:cli/environment`, e chi lo
/// chiamasse lo stesso non deve trovare una porta aperta sul sistema
/// operativo. È la sandbox nella sua forma più corta — e il messaggio nomina
/// l'import, perché chi la trova sappia cosa aveva chiesto.
fn cap_the_rest(
    linker: &mut Linker<State>,
    engine: &Engine,
    component: &WasmtimeComponent,
) -> wasmtime::Result<()> {
    let ty = component.component_type();
    for (name, item) in ty.imports(engine) {
        if FAMILIES_SERVED.iter().any(|s| name.starts_with(s)) {
            continue;
        }
        let ComponentItem::ComponentInstance(iface) = item.ty else {
            // Un import che non è un'interfaccia non esiste in un componente
            // scritto contro questo contratto: il WIT non ha funzioni alla
            // radice del mondo. Se un giorno ci fosse, l'istanziazione lo dirà
            // per nome invece che tacere qui.
            continue;
        };
        let mut functions: Vec<String> = Vec::new();
        let mut resources: Vec<String> = Vec::new();
        for (entry, and) in iface.exports(engine) {
            match and.ty {
                ComponentItem::ComponentFunc(_) => functions.push(entry.to_string()),
                ComponentItem::Resource(_) => resources.push(entry.to_string()),
                _ => {}
            }
        }
        let mut inst = linker.instance(name)?;
        // Una risorsa importata non è una funzione e non si tappa con un trap:
        // il tipo dev'esserci comunque, o l'istanziazione si ferma dicendo
        // «*resource implementation is missing*» — è `wasi:io/poll` con la sua
        // `pollable`, che il bersaglio si porta dietro. Le diamo un tipo host
        // vuoto: nessun componente di questo contratto ne fabbrica una, perché
        // le sole funzioni che la restituirebbero sono già tappate.
        for resource in resources {
            inst.resource(&resource, ResourceType::host::<()>(), |_, _| Ok(()))?;
        }
        for function in functions {
            let label = format!("{name}#{function}");
            inst.func_new(&function, move |_, _, _, _| {
                Err(wasmtime::Error::msg(format!(
                    "this host does not serve `{label}`"
                )))
            })?;
        }
    }
    Ok(())
}

/// Le interfacce che **questa** istanza esporta, già risolte.
///
/// Non è un elenco di ciò che il mondo dichiara: è ciò che il componente ha
/// davvero. Ogni campo che si aggiunge qui è un trait del contratto che
/// attraversa il confine, e un `Option` in più è un pezzo di «mezzo plugin» in
/// più.
struct Interfaces {
    plugin: w_plugin::Guest,
    commands: Option<w_command::Guest>,
}

/// Un'istanza viva: lo store con dentro il prestito, e le sue interfacce.
struct Instance {
    store: Store<State>,
    interfaces: Interfaces,
}

/// Apre una chiamata al componente prestandogli l'host di **questa** chiamata.
///
/// Sta fuori da [`WasmPlugin`] perché da qui in poi le porte sul componente
/// sono due — il plugin e il provider dei comandi — e la disciplina del
/// prestito è la stessa per tutte: prendere il lucchetto dell'istanza, mettere
/// l'host nello store per la durata della chiamata, toglierlo comunque vada.
/// Scriverla due volte vorrebbe dire poterla scrivere due volte diversa.
fn call<R>(
    inner: &Mutex<Instance>,
    host: &mut dyn HostApi,
    f: impl FnOnce(&Interfaces, &mut Store<State>) -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    let mut inner = inner
        .lock()
        .map_err(|_| PluginError::Internal("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *inner;
    // `interfaces` a prestito immutabile, `store` mutabile: sono due campi
    // diversi, e il `let … = &mut *inner` è ciò che lo dice al compilatore in
    let interfaces = &*interfaces;
    with_guest(store, host, |store| f(interfaces, store))
}

/// Un guasto di wasmtime raccontato al contratto.
///
/// Ogni trap arriva qui, e ogni trap diventa [`PluginError::Internal`]. Che sia
/// *interno* e non *permission-denied* è una scelta: il rifiuto di una capacità
/// non passa mai da un trap (vedi il doc di `crate::contract`), quindi tutto
/// ciò che trappa è davvero un guasto del componente — memoria finita, un
/// `unwrap` di là dal confine, un'istanza già morta.
///
/// Con un'eccezione, che è l'unica trap che **non** è del componente: la
/// scadenza a epoche (vedi `crate::limits`) è l'host che lo ha fermato, e il
/// messaggio di wasmtime la chiama `interrupt` — una parola che non dice
/// all'utente che il plugin ha finito il tempo, e che non si distingue da un
/// `unwrap` di là dal confine. Qui la si nomina una volta, invece di lasciare
/// che ogni lettore la riconosca da sé.
fn failure(and: wasmtime::Error) -> PluginError {
    if and.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::Interrupt) {
        return PluginError::Internal(
            "the component did not respond within the allotted time and was stopped".into(),
        );
    }
    PluginError::Internal(format!("the component crashed: {and:#}").into())
}

// ---------------------------------------------------------------------------
// Il proxy del trait `Plugin`
// ---------------------------------------------------------------------------

/// Un [`Plugin`] che sta dentro un componente WASM.
///
/// Il `Mutex` non è concorrenza: è ciò che serve a dare a wasmtime lo `&mut
/// Store` che vuole partendo dai `&self` che il contract dà (`manifest`,
/// `run_job`). Un'istanza WASM non è rientrante — due chiamate insieme sulla
/// stessa istanza sarebbero due `&mut` sullo stesso store — e il `Mutex` è
/// esattamente la disciplina che il modello dei componenti pretende, scritta
/// dove si vede.
///
/// L'`Arc` è nuovo, ed è ciò che rende **una** l'istanza di un componente che
/// ha più di un'interfaccia: il plugin e il suo [`WasmCommandProvider`]
/// tengono lo stesso lucchetto sulla stessa memoria lineare. Non è economia di
/// istanze — è l'unico modo in cui `activate` vuol dire qualcosa: un
/// componente che si configura all'attivazione e poi esegue un comando in
/// un'istanza diversa troverebbe la propria configurazione vuota, e nessuno
/// glielo avrebbe detto.
///
/// # Il giorno in cui il lucchetto morde
///
/// Una capacità che facesse **rientrare** l'host nella stessa istanza —
/// `host-commands.run-command` su un comando di questo stesso componente —
/// prenderebbe un lucchetto già preso da questo thread, cioè si fermerebbe per
/// sempre. Oggi non è raggiungibile: `host-commands` non è fra le
/// [`FAMILIES_SERVED`], e nessuna di quelle che ci sono torna al chiamante. Il
/// giorno che ci entra, la risposta giusta non è un lucchetto rientrante (due
/// `&mut Store` annidati non esistono) ma un `plugin-error` che dice cosa è
/// successo — la stessa scelta per cui `trappable_imports` resta spento.
pub struct WasmPlugin {
    inner: Arc<Mutex<Instance>>,
}

impl Plugin for WasmPlugin {
    fn manifest(&self) -> PluginManifest {
        // Senza host: un manifest è una dichiarazione, e un componente che per
        // dichiararsi avesse bisogno di leggere il vault starebbe già
        // rispondendo a una domanda che nessuno gli ha fatto. Se ci prova,
        // `crate::borrow` gli risponde `internal`.
        let mut inner = match self.inner.lock() {
            Ok(the) => the,
            Err(_) => return PluginManifest::new("", ""),
        };
        let Instance { store, interfaces } = &mut *inner;
        // Una delle due porte sul componente che non passano da `with_guest`
        // — l'altra è `declared_commands` — ed è da lì che il budget di tempo
        // si rinnova: senza questa riga il manifest girerebbe sulla scadenza
        // armata dalla chiamata precedente, e chiesto qualche secondo dopo il
        // montaggio trapperebbe per aver fatto niente.
        crate::limits::renew(&mut *store);
        match interfaces.plugin.call_manifest(&mut *store) {
            Ok(m) => tr::from_manifest(m).unwrap_or_else(|_| PluginManifest::new("", "")),
            Err(_) => PluginManifest::new("", ""),
        }
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        call(&self.inner, host, |the, store| {
            the.plugin
                .call_activate(store)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        call(&self.inner, host, |the, store| {
            the.plugin
                .call_deactivate(store)
                .map_err(failure)?
                .map_err(tr::from_error)
        })
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let payload = tr::to_json(&payload);
        call(&self.inner, host, |the, store| {
            let answer = the
                .plugin
                .call_run_job(store, job, &payload)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            tr::from_json(&answer)
        })
    }
}

// ---------------------------------------------------------------------------
// Il proxy del trait `CommandProvider`
// ---------------------------------------------------------------------------

/// Un [`CommandProvider`] che sta dentro un componente WASM.
///
/// È il secondo trait del contratto che attraversa il confine, ed è quello che
/// rende il §16.1 una frase verificabile invece che un'intenzione: da qui in
/// poi la palette, la tastiera, una macro e la CLI chiamano un componente
/// senza avere un ramo che lo distingua da una feature nativa.
pub struct WasmCommandProvider {
    inner: Arc<Mutex<Instance>>,
    /// Ciò che il componente ha dichiarato **al momento della registrazione**.
    ///
    /// Non si richiede a ogni apertura della palette, e non è per risparmiare
    /// una chiamata: è il registro che deve restare vero. Gli id sono già stati
    /// ammessi da `register_command_provider` — namespace del plugin, nessun
    /// doppione — e le scorciatoie sono già diventate impostazioni; un
    /// `commands()` che rispondesse un elenco diverso il secondo giorno
    /// lascerebbe il kernel a governare comandi che non esistono e il
    /// componente a offrirne che nessuno ha ammesso. La dichiarazione si legge
    specs: Vec<CommandSpec>,
}

impl CommandProvider for WasmCommandProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        self.specs.clone()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let args = tr::to_json(&args);
        let mode = tr::to_invoke_mode(mode);
        call(&self.inner, host, |the, store| {
            // `commands` è `Some` per costruzione: questo tipo lo fabbrica solo
            // `WasmBundle::register`, e solo dopo averlo trovato. L'`ok_or_else`
            // è la riga che lo dice senza `unwrap`, perché il giorno che
            // qualcun altro lo fabbrichi la risposta sia una frase e non un
            // panico dentro il kernel.
            let commands = the.commands.as_ref().ok_or_else(|| {
                PluginError::Internal("the component does not export `fub:abi/command`".into())
            })?;
            let outcome = commands
                .call_invoke(store, command, &args, mode)
                .map_err(failure)?
                .map_err(tr::from_error)?;
            tr::from_command_outcome(outcome)
        })
    }
}

// ---------------------------------------------------------------------------
// Il bundle
// ---------------------------------------------------------------------------

/// Un componente montabile dalla porta di [`Bundle`].
pub struct WasmBundle {
    component: Component,
    manifest: PluginManifest,
    trust: Trust,
    /// L'istanza fabbricata dall'ultima [`Bundle::plugin`], in attesa che
    /// [`Bundle::register`] venga a prenderla.
    ///
    /// I quattro passi del montaggio (§9.3) chiamano `plugin()` al terzo e
    /// `register()` al quarto, sullo **stesso** bundle e in fila: questo campo è
    /// il filo che li lega. Serve perché entrambe le firme sono `&self` — non
    /// c'è un valore che passi dall'una all'altra — e perché l'istanza dev'essere
    /// una sola: il plugin e i suoi provider sono lo stesso componente, non due
    /// copie che si somigliano.
    ///
    /// È `Option` e si **svuota** quando la si prende: un `register` senza il
    /// `plugin` che lo precede non trova niente e lo dice, invece di registrare
    /// i comandi di un'istanza di un montaggio di prima.
    last: Mutex<Option<Arc<Mutex<Instance>>>>,
}

/// Chi è, non com'è fatto: l'istanza e il linker non hanno niente da dire a
/// chi legge un log o un `expect_err`. Il `Debug` c'è perché senza di lui un
/// `Result<WasmBundle, _>` non si sa nemmeno spacchettare in un test.
/// `Result<WasmBundle, _>` non si sa nemmeno spacchettare in un test.
impl std::fmt::Debug for WasmBundle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WasmBundle")
            .field("id", &self.manifest.id)
            .field("version", &self.manifest.version)
            .field("abi", &self.manifest.abi_version)
            .field("trust", &self.trust)
            .finish()
    }
}

impl WasmBundle {
    /// Carica il componente e **gli chiede subito chi è**.
    ///
    /// Il manifest si legge qui, in un'istanza che poi si butta, perché
    /// `Bundle::manifest` non può fallire e chi monta lo legge prima di tutto
    /// il resto: il primo passo del montaggio è `abi_compatible`, e per fare
    /// quel confronto la versione del contratto deve essere già in mano. Un
    /// componente che non sa dire il proprio manifest non è un bundle, e lo si
    /// scopre qui invece che a metà montaggio.
    pub fn from_file(path: &Utf8Path, trust: Trust) -> Result<Self, LoadError> {
        let component = Component::from_file(path)?;
        let manifest = {
            let mut inst = component.instantiate()?;
            let m = inst
                .interfaces
                .plugin
                .call_manifest(&mut inst.store)
                .map_err(|and| LoadError::Instantiation(format!("{and:#}")))?;
            tr::from_manifest(m)
                .map_err(|and| LoadError::Instantiation(format!("manifest: {and}")))?
        };
        Ok(WasmBundle {
            component,
            manifest,
            trust,
            last: Mutex::new(None),
        })
    }

    /// Cosa il componente dichiara di saper fare.
    ///
    /// Senza host, per la ragione di `manifest`: un elenco di comandi è una
    /// dichiarazione, e un componente che per dirla dovesse leggere il vault
    /// starebbe rispondendo a una domanda che nessuno gli ha fatto. Se ci prova,
    /// `crate::borrow` gli risponde `internal` — e l'elenco che ne esce è
    /// vuoto o parziale, il che è esattamente ciò che deve succedere.
    ///
    /// `Ok(vec![])` vuol dire due cose che qui vanno bene tutte e due: non
    /// esporta `command`, oppure lo esporta e non offre niente. `Err` è la
    /// terza, che è un guasto: lo esporta e cade quando glielo si chiede.
    fn declared_commands(&self, inner: &Mutex<Instance>) -> Result<Vec<CommandSpec>, String> {
        let mut inst = inner
            .lock()
            .map_err(|_| "component instance is poisoned".to_string())?;
        let Instance { store, interfaces } = &mut *inst;
        let Some(commands) = interfaces.commands.as_ref() else {
            return Ok(Vec::new());
        };
        // L'altra porta che non passa da `with_guest` (vedi `manifest`), e per
        // la stessa ragione rinnova da sé: qui il budget residuo sarebbe quello
        // che `activate` ha lasciato indietro un istante fa, e un `activate`
        // lento farebbe scadere l'elenco dei comandi per colpa sua. La
        // dichiarazione dei comandi è una chiamata, e ogni chiamata ha il suo
        // tempo intero.
        crate::limits::renew(&mut *store);
        let specs = commands
            .call_commands(&mut *store)
            .map_err(|and| format!("commands not declared: the component crashed: {and:#}"))?;
        Ok(specs.into_iter().map(tr::from_command_spec).collect())
    }
}

impl Bundle for WasmBundle {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn trust(&self) -> Trust {
        self.trust
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        match self.component.instantiate() {
            Ok(inst) => {
                let inner = Arc::new(Mutex::new(inst));
                // La copia che `register` verrà a prendere fra un passo. Un
                // `plugin()` senza il `register()` che lo segue la lascia qui e
                // la fa buttare dal prossimo: è un `Arc` in più che vive quanto
                // il bundle, non una perdita.
                if let Ok(mut last) = self.last.lock() {
                    *last = Some(Arc::clone(&inner));
                }
                Box::new(WasmPlugin { inner })
            }
            // `plugin()` non può fallire, e inventare un plugin muto sarebbe
            // montarne uno che non c'è. Questo invece è un plugin che dice di
            // no al primo passo che lo interroga davvero — `activate`, il terzo
            // del montaggio — e il montaggio è tutto-o-niente fino a lì: si
            // disfa da sé, e chi monta legge perché.
            Err(and) => Box::new(FailedPlugin {
                manifest: self.manifest.clone(),
                error: and.to_string(),
            }),
        }
    }

    /// Il quarto passo: i provider del componente.
    ///
    /// Ciò che torna sono **avvisi**, non errori: un provider che non entra non
    /// smonta il bundle (il doc di [`Bundle::register`]), e chi monta li scrive
    /// nel log con l'id davanti. Vale anche per il caso più brutto — il
    /// componente esporta `command` e cade appena glielo si chiede: il plugin
    /// resta montato con le sue altre interfacce, e la riga di log dice quale
    /// pezzo manca.
    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut warnings = Vec::new();
        let inner = match self.last.lock().map(|mut u| u.take()) {
            Ok(Some(the)) => the,
            Ok(None) => {
                warnings
                    .push("no instance to register: `plugin()` was not called".into());
                return warnings;
            }
            Err(_) => {
                warnings.push("component instance is poisoned".into());
                return warnings;
            }
        };

        // I comandi. Le due domande sono separate perché sono due risposte
        // diverse: «non esporta `command`» è la forma normale di un mezzo
        // plugin e non si dice a nessuno, «li esporta e non sa elencarli» è un
        // guasto e va detto.
        let specs = match self.declared_commands(&inner) {
            Ok(s) => s,
            Err(warning) => {
                warnings.push(warning);
                return warnings;
            }
        };
        if !specs.is_empty() {
            let provider = WasmCommandProvider { inner, specs };
            if let Err(and) = ws.register_command_provider(&self.manifest.id, Box::new(provider)) {
                warnings.push(format!("commands not registered: {and}"));
            }
        }
        warnings
    }
}

/// Il plugin che non è mai nato: risponde il proprio guasto a chi lo attiva.
/// Il plugin che non è mai nato: risponde il proprio guasto a chi lo attiva.
struct FailedPlugin {
    manifest: PluginManifest,
    error: String,
}

impl Plugin for FailedPlugin {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Err(PluginError::Internal(self.error.clone().into()))
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        _job: &str,
        _payload: serde_json::Value,
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        Err(PluginError::Internal(self.error.clone().into()))
    }
}
