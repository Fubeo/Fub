//! **Il componente, e i due tipi che lo fanno sembrare un plugin qualunque.**
//!
//! [`Componente`] è il `.wasm` compilato e pronto a istanziarsi; [`WasmPlugin`]
//! è un [`Plugin`] che reinoltra ogni metodo a un'istanza; [`WasmBundle`] è la
//! porta da cui si monta, la stessa del §9.3 che monta le feature native.
//!
//! Che il kernel non abbia un ramo per distinguerli non è una gentilezza: è la
//! prova di M5. Il `BundleRegistry` chiama `manifest`, `trust`, `plugin` e
//! `register` senza sapere che dietro c'è una macchina virtuale, e il giorno in
//! cui gli servisse saperlo il «un trait, due backend» sarebbe finito.

use std::sync::Mutex;

use camino::Utf8Path;
use fub_abi::traits::{HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_host::registry::Bundle;
use fub_kernel::{Trust, Workspace};
use wasmtime::component::types::ComponentItem;
use wasmtime::component::{Component, Instance, InstancePre, Linker, ResourceType};
use wasmtime::{Engine, Store};

use crate::contratto::exports::fub::abi::plugin as w_plugin;
use crate::ospite::aggiungi_al_linker;
use crate::prestito::{con_ospite, Stato};
use crate::traduzione as tr;

/// Le famiglie del contratto che questo crate serve.
///
/// L'elenco è scritto a mano ed è il **prezzo dichiarato** del linker per
/// interfaccia: chi ne aggiunge una a [`aggiungi_al_linker`] la aggiunge anche
/// qui, o un componente che la importa verrebbe rifiutato pur essendo servito.
/// Le due liste divergono in un modo solo, e quel modo è un test che fallisce
/// (`una_famiglia_non_servita_si_fa_nominare`).
const FAMIGLIE_SERVITE: &[&str] = &["fub:abi/host-env", "fub:abi/host-vault-read"];

/// Il prefisso di una **famiglia di capacità** (§7.1).
///
/// `host-` e non `fub:abi/`: il contratto ha anche interfacce di soli tipi —
/// `json`, `text`, `errors`, `model`, `options`, `settings`, `ui`, `intl` — che
/// un componente importa per *nominare* i tipi che scambia, non per chiamare
/// niente. Non hanno una sola funzione, non c'è niente da linkare, e contarle
/// fra le famiglie non servite rifiuterebbe ogni componente esistente. Lo
/// abbiamo misurato al primo caricamento vero: il ping ne importava otto.
const CONTRATTO: &str = "fub:abi/host-";

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
pub enum ErroreDiCaricamento {
    /// Il file non si legge.
    #[error("il componente non si legge: {0}")]
    Lettura(#[from] std::io::Error),
    /// Il file non è un componente valido, o non si compila.
    #[error("il componente non si compila: {0}")]
    Compilazione(String),
    /// Il componente importa una famiglia del contratto che questo host non
    /// serve. **Nominarla è metà del messaggio**: «manca una capacità» manda a
    /// cercare, «manca `fub:abi/host-net`» manda a leggere il §20.3.
    #[error("il componente importa famiglie che questo host non serve: {0}")]
    FamiglieNonServite(String),
    /// Il componente non esporta `fub:abi/plugin`, cioè non è un plugin.
    #[error("il componente non esporta `fub:abi/plugin`: non è un plugin ({0})")]
    NonEUnPlugin(String),
    /// L'istanziazione è fallita, o il `manifest` non risponde.
    #[error("il componente non si istanzia: {0}")]
    Istanziazione(String),
}

// ---------------------------------------------------------------------------
// Il componente
// ---------------------------------------------------------------------------

/// Un `.wasm` compilato, con il proprio linker, pronto a fare istanze.
///
/// Compilare costa; istanziare no. È la ragione per cui questo tipo esiste
/// separato da [`WasmPlugin`]: un bundle si carica una volta e può fare più
/// istanze — una per montaggio — senza ricompilare niente.
pub struct Componente {
    pre: InstancePre<Stato>,
    indici: w_plugin::GuestIndices,
}

impl Componente {
    /// Carica un componente da file.
    pub fn da_file(path: &Utf8Path) -> Result<Self, ErroreDiCaricamento> {
        Self::da_bytes(&std::fs::read(path)?)
    }

    /// Carica un componente dai suoi byte.
    pub fn da_bytes(bytes: &[u8]) -> Result<Self, ErroreDiCaricamento> {
        let engine = Engine::default();
        let component = Component::new(&engine, bytes)
            .map_err(|e| ErroreDiCaricamento::Compilazione(format!("{e:#}")))?;
        Self::carica(engine, component)
    }

    fn carica(engine: Engine, component: Component) -> Result<Self, ErroreDiCaricamento> {
        let mut linker: Linker<Stato> = Linker::new(&engine);
        aggiungi_al_linker(&mut linker)
            .map_err(|e| ErroreDiCaricamento::Compilazione(format!("{e:#}")))?;

        // Ciò che il componente chiede e questo host non dà. Le due specie
        // ricevono due trattamenti, e la differenza è il §16.1: una famiglia
        // **del contratto** non servita è un rifiuto subito, con il nome —
        // montare un plugin che si romperà a metà lavoro è peggio che non
        // montarlo. Tutto il resto è l'ambiente che il bersaglio `wasm32-wasip2`
        // si porta dietro (`wasi:cli`, `wasi:io`, …): non lo linkiamo, perché
        // un plugin di questo contratto non ha nessuna ragione di chiamarlo, e
        // chi lo chiamasse lo stesso trova un trap invece di una porta aperta
        // sul sistema operativo. È la sandbox nella sua forma più corta.
        let mancanti: Vec<String> = component
            .component_type()
            .imports(&engine)
            .map(|(nome, _)| nome.to_string())
            .filter(|nome| nome.starts_with(CONTRATTO))
            .filter(|nome| !FAMIGLIE_SERVITE.iter().any(|s| nome.starts_with(s)))
            .collect();
        if !mancanti.is_empty() {
            return Err(ErroreDiCaricamento::FamiglieNonServite(mancanti.join(", ")));
        }
        tappa_il_resto(&mut linker, &engine, &component)
            .map_err(|e| ErroreDiCaricamento::Compilazione(format!("{e:#}")))?;

        let pre = linker
            .instantiate_pre(&component)
            .map_err(|e| ErroreDiCaricamento::Compilazione(format!("{e:#}")))?;
        let indici = w_plugin::GuestIndices::new(&pre)
            .map_err(|e| ErroreDiCaricamento::NonEUnPlugin(format!("{e:#}")))?;

        Ok(Componente { pre, indici })
    }

    /// Una nuova istanza, viva e non ancora attivata.
    fn istanzia(&self) -> Result<Istanza, ErroreDiCaricamento> {
        let mut store = Store::new(self.pre.engine(), Stato::vuoto());
        let instance: Instance = self
            .pre
            .instantiate(&mut store)
            .map_err(|e| ErroreDiCaricamento::Istanziazione(format!("{e:#}")))?;
        let guest = self
            .indici
            .load(&mut store, &instance)
            .map_err(|e| ErroreDiCaricamento::Istanziazione(format!("{e:#}")))?;
        Ok(Istanza { store, guest })
    }
}

/// Tappa con un trap ogni import che il linker non ha già servito.
///
/// Wasmtime ne ha una versione sua, `Linker::define_unknown_imports_as_traps`,
/// e non la usiamo: davanti a un'istanza non guarda se c'è già — chiama
/// `linker.instance(nome)` comunque, e su una famiglia che abbiamo appena
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
fn tappa_il_resto(
    linker: &mut Linker<Stato>,
    engine: &Engine,
    component: &Component,
) -> wasmtime::Result<()> {
    let tipo = component.component_type();
    for (nome, voce) in tipo.imports(engine) {
        if FAMIGLIE_SERVITE.iter().any(|s| nome.starts_with(s)) {
            continue;
        }
        let ComponentItem::ComponentInstance(interfaccia) = voce.ty else {
            // Un import che non è un'interfaccia non esiste in un componente
            // scritto contro questo contratto: il WIT non ha funzioni alla
            // radice del mondo. Se un giorno ci fosse, l'istanziazione lo dirà
            // per nome invece che tacere qui.
            continue;
        };
        let mut funzioni: Vec<String> = Vec::new();
        let mut risorse: Vec<String> = Vec::new();
        for (voce, e) in interfaccia.exports(engine) {
            match e.ty {
                ComponentItem::ComponentFunc(_) => funzioni.push(voce.to_string()),
                ComponentItem::Resource(_) => risorse.push(voce.to_string()),
                _ => {}
            }
        }
        let mut istanza = linker.instance(nome)?;
        // Una risorsa importata non è una funzione e non si tappa con un trap:
        // il tipo dev'esserci comunque, o l'istanziazione si ferma dicendo
        // «*resource implementation is missing*» — è `wasi:io/poll` con la sua
        // `pollable`, che il bersaglio si porta dietro. Le diamo un tipo host
        // vuoto: nessun componente di questo contratto ne fabbrica una, perché
        // le sole funzioni che la restituirebbero sono già tappate.
        for risorsa in risorse {
            istanza.resource(&risorsa, ResourceType::host::<()>(), |_, _| Ok(()))?;
        }
        for funzione in funzioni {
            let etichetta = format!("{nome}#{funzione}");
            istanza.func_new(&funzione, move |_, _, _, _| {
                Err(wasmtime::Error::msg(format!(
                    "questo host non serve `{etichetta}`"
                )))
            })?;
        }
    }
    Ok(())
}

/// Un'istanza viva: lo store con dentro il prestito, e l'export `plugin`.
struct Istanza {
    store: Store<Stato>,
    guest: w_plugin::Guest,
}

/// Un guasto di wasmtime raccontato al contratto.
///
/// Ogni trap arriva qui, e ogni trap diventa [`PluginError::Internal`]. Che sia
/// *interno* e non *permission-denied* è una scelta: il rifiuto di una capacità
/// non passa mai da un trap (vedi il doc di `crate::contratto`), quindi tutto
/// ciò che trappa è davvero un guasto del componente — memoria finita, un
/// `unwrap` di là dal confine, un'istanza già morta.
fn guasto(e: wasmtime::Error) -> PluginError {
    PluginError::Internal(format!("il componente è caduto: {e:#}").into())
}

// ---------------------------------------------------------------------------
// Il proxy del trait `Plugin`
// ---------------------------------------------------------------------------

/// Un [`Plugin`] che sta dentro un componente WASM.
///
/// Il `Mutex` non è concorrenza: è ciò che serve a dare a wasmtime lo `&mut
/// Store` che vuole partendo dai `&self` che il contratto dà (`manifest`,
/// `run_job`). Un'istanza WASM non è rientrante — due chiamate insieme sulla
/// stessa istanza sarebbero due `&mut` sullo stesso store — e il `Mutex` è
/// esattamente la disciplina che il modello dei componenti pretende, scritta
/// dove si vede.
pub struct WasmPlugin {
    interno: Mutex<Istanza>,
}

impl WasmPlugin {
    /// Apre una chiamata al componente prestandogli l'host di questa chiamata.
    fn chiamata<R>(
        &self,
        host: &mut dyn HostApi,
        f: impl FnOnce(&w_plugin::Guest, &mut Store<Stato>) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        let mut interno = self
            .interno
            .lock()
            .map_err(|_| PluginError::Internal("l'istanza del componente è avvelenata".into()))?;
        let Istanza { store, guest } = &mut *interno;
        // `guest` è preso a prestito immutabile, `store` mutabile: sono due
        // campi diversi, e il `let … = &mut *interno` è ciò che lo dice al
        // compilatore in una riga sola.
        let guest = &*guest;
        con_ospite(store, host, |store| f(guest, store))
    }
}

impl Plugin for WasmPlugin {
    fn manifest(&self) -> PluginManifest {
        // Senza host: un manifest è una dichiarazione, e un componente che per
        // dichiararsi avesse bisogno di leggere il vault starebbe già
        // rispondendo a una domanda che nessuno gli ha fatto. Se ci prova,
        // `crate::prestito` gli risponde `internal`.
        let mut interno = match self.interno.lock() {
            Ok(i) => i,
            Err(_) => return PluginManifest::new("", ""),
        };
        let Istanza { store, guest } = &mut *interno;
        match guest.call_manifest(&mut *store) {
            Ok(m) => tr::da_manifest(m).unwrap_or_else(|_| PluginManifest::new("", "")),
            Err(_) => PluginManifest::new("", ""),
        }
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.chiamata(host, |guest, store| {
            guest
                .call_activate(store)
                .map_err(guasto)?
                .map_err(tr::da_errore)
        })
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.chiamata(host, |guest, store| {
            guest
                .call_deactivate(store)
                .map_err(guasto)?
                .map_err(tr::da_errore)
        })
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let payload = tr::in_json(&payload);
        self.chiamata(host, |guest, store| {
            let risposta = guest
                .call_run_job(store, job, &payload)
                .map_err(guasto)?
                .map_err(tr::da_errore)?;
            tr::da_json(&risposta)
        })
    }
}

// ---------------------------------------------------------------------------
// Il bundle
// ---------------------------------------------------------------------------

/// Un componente montabile dalla porta di [`Bundle`].
pub struct WasmBundle {
    componente: Componente,
    manifest: PluginManifest,
    trust: Trust,
}

/// Chi è, non com'è fatto: l'istanza e il linker non hanno niente da dire a
/// chi legge un log o un `expect_err`. Il `Debug` c'è perché senza di lui un
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
    pub fn da_file(path: &Utf8Path, trust: Trust) -> Result<Self, ErroreDiCaricamento> {
        let componente = Componente::da_file(path)?;
        let manifest = {
            let mut istanza = componente.istanzia()?;
            let m = istanza
                .guest
                .call_manifest(&mut istanza.store)
                .map_err(|e| ErroreDiCaricamento::Istanziazione(format!("{e:#}")))?;
            tr::da_manifest(m)
                .map_err(|e| ErroreDiCaricamento::Istanziazione(format!("manifest: {e}")))?
        };
        Ok(WasmBundle {
            componente,
            manifest,
            trust,
        })
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
        match self.componente.istanzia() {
            Ok(istanza) => Box::new(WasmPlugin {
                interno: Mutex::new(istanza),
            }),
            // `plugin()` non può fallire, e inventare un plugin muto sarebbe
            // montarne uno che non c'è. Questo invece è un plugin che dice di
            // no al primo passo che lo interroga davvero — `activate`, il terzo
            // del montaggio — e il montaggio è tutto-o-niente fino a lì: si
            // disfa da sé, e chi monta legge perché.
            Err(e) => Box::new(PluginGuasto {
                manifest: self.manifest.clone(),
                errore: e.to_string(),
            }),
        }
    }

    fn register(&self, _ws: &mut Workspace) -> Vec<String> {
        // Nessun provider, per ora: il quarto passo del montaggio è vuoto
        // finché `CommandProvider` non attraversa il confine. È il prossimo
        // passo di M5, ed è dichiarato nel verbale invece di essere un `todo!`
        // che qualcuno scopre in produzione.
        Vec::new()
    }
}

/// Il plugin che non è mai nato: risponde il proprio guasto a chi lo attiva.
struct PluginGuasto {
    manifest: PluginManifest,
    errore: String,
}

impl Plugin for PluginGuasto {
    fn manifest(&self) -> PluginManifest {
        self.manifest.clone()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Err(PluginError::Internal(self.errore.clone().into()))
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
        Err(PluginError::Internal(self.errore.clone().into()))
    }
}
