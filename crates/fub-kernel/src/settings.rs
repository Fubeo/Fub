//! Lo **store di configurazione** (§11.1): chi tiene gli schemi dichiarati, i
//! valori scritti e la regola con cui i due si incontrano.
//!
//! # Due livelli, una precedenza, e nessun terzo posto
//!
//! Un valore può stare in due file: quello del **vault**
//! (`<root>/.fub/settings.json`, che viaggia col vault) e quello della
//! **macchina** (dove lo decide chi monta — `fub_host::config_dir`). La
//! precedenza è dichiarata e va in un verso solo: **vault → macchina →
//! default dello schema**. Il default non è un file: è parte della
//! dichiarazione, ed è per questo che un valore c'è sempre.
//!
//! Il terzo livello che il §11.1 nominava — «profilo/portable» — non è un terzo
//! posto in cui cercare: è **dove sta** il livello macchina, e quella è una
//! decisione di chi monta, non di questo store. Un terzo strato di merge
//! avrebbe voluto dire un terzo posto in cui la stessa chiave può valere
//! un'altra cosa, e nessuno dei tre in grado di dire da solo chi ha vinto.
//!
//! # Un vault non decide della macchina
//!
//! La regola che questo modulo applica e che nessun altro può applicare al posto
//! suo: una chiave di [`SettingScope::Machine`] scritta in un
//! `.fub/settings.json` **si ignora**. Un vault è dato che arriva da fuori — si
//! scarica, si sincronizza, lo passa un collega — e senza questa riga aprire un
//! vault altrui sarebbe un modo di cambiare la configurazione della propria
//! macchina. Ignorarla non è silenzioso: chi carica il file raccoglie un avviso
//! che nomina la chiave.
//!
//! # Perché non è uno spazio chiave→valore
//!
//! Perché le chiavi le dichiara qualcuno: una chiave fuori schema non si legge e
//! non si scrive, e ciò che il file contiene senza che nessuno lo dichiari resta
//! lì senza essere letto. È la differenza con lo `storage_*` che la
//! [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md) ha
//! tolto, ed è ciò che rende questo store una **configurazione** invece di un
//! database di comodo.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::{SettingEntry, SettingScope, SettingSource, SettingSpec, SettingValue};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

use crate::storage::{update_atomic, VaultStorage};

/// La versione di schema del file (§15.3): un numero scritto **dal primo
/// giorno**, perché il file che non ce l'ha è quello che poi non si sa da che
/// versione viene.
const SCHEMA_VERSION: u32 = 1;

/// Il file di un livello, com'è su disco.
#[derive(Default, Serialize, Deserialize)]
struct SettingsFile {
    version: u32,
    #[serde(default)]
    values: BTreeMap<String, SettingValue>,
}

/// Legge un file di livello. **Assente = mai configurato**, che è un esito
/// normale e non un errore; **malformato è un errore**, e ciò che si fa dopo lo
/// decide chi legge — sovrascriverlo col default in silenzio butterebbe via la
/// configurazione dell'utente, che è la stessa regola del sidecar
/// dell'organizzazione.
///
/// Chi legge i byte è un parametro, e non è pignoleria: il livello del **vault**
/// li prende dal supporto (§15.1) e quello della **macchina** dal filesystem,
/// perché sta fuori da ogni vault. La regola con cui si giudica ciò che si è
/// letto è però la stessa, e scriverla due volte sarebbe due idee di cosa vuol
/// dire «configurazione illeggibile».
fn load_from(
    path: &Utf8Path,
    read: impl FnOnce(&Utf8Path) -> std::io::Result<Vec<u8>>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    match read(path) {
        Ok(raw) => {
            let file: SettingsFile = serde_json::from_slice(&raw)
                .map_err(|e| format!("{path} non è un settings.json valido: {e}"))?;
            if file.version > SCHEMA_VERSION {
                return Err(format!(
                    "{path} è scritto nella versione {} di questo formato, e questa \
                     copia di Fub legge fino alla {SCHEMA_VERSION}",
                    file.version
                ));
            }
            Ok(file.values)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("non riesco a leggere {path}: {e}")),
    }
}

/// Il livello della macchina, che un supporto non ce l'ha.
fn load(path: &Utf8Path) -> Result<BTreeMap<String, SettingValue>, String> {
    load_from(path, |p| std::fs::read(p))
}

/// I byte di un file di livello.
///
/// Che poi si scrivano **atomicamente** non è più una scelta di questa funzione:
/// lo sono entrambe le scritture che la usano, quella del supporto (§15.1) e
/// quella della macchina, perché l'atomicità è scesa sotto tutte e due
/// ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)). E
/// qui conta: questo file si riscrive a ogni interruttore toccato, e un JSON
/// troncato da un crash è una configurazione che al riavvio è *malformata* —
/// cioè, per la regola di [`load_from`], un errore che blocca la lettura di
/// tutte le altre chiavi.
fn encode(values: &BTreeMap<String, SettingValue>) -> Result<Vec<u8>, String> {
    let file = SettingsFile {
        version: SCHEMA_VERSION,
        values: values.clone(),
    };
    serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())
}

/// Scrive **una chiave** del livello della macchina, fondendola con ciò che sul
/// disco c'è adesso.
///
/// Non prende la mappa del chiamante e non è un dettaglio: la sua copia è
/// vecchia dall'apertura, e ricomporre il file da lì cancella le chiavi che
/// un'altra installazione ha scritto nel frattempo. Ciò che si scrive è la
/// **chiave toccata**, applicata al file riletto sotto lock
/// ([`update_atomic`], [0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)),
/// e la mappa che torna è quella fusa — che il chiamante adotta al posto della
/// propria.
fn store(
    path: &Utf8Path,
    key: &str,
    value: Option<SettingValue>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    update_atomic(
        path,
        || load(path),
        |disco| {
            match value {
                Some(v) => {
                    disco.insert(key.to_string(), v);
                }
                None => {
                    disco.remove(key);
                }
            }
            encode(disco)
        },
    )
}

/// Il rifiuto di sovrascrivere un file che all'apertura non si è potuto leggere.
///
/// È la seconda metà della regola di [`load`], e senza di essa la prima non vale
/// niente: leggere un file malformato e tenersi un livello vuoto salva la
/// configurazione dell'utente per il tempo di **una** scrittura, perché la prima
/// che arriva riscrive il file intero dalla mappa vuota. Chi ha sbagliato una
/// virgola perderebbe tutto al primo interruttore toccato — cioè il danno che
/// «non sovrascriverlo col default in silenzio» esiste per evitare, arrivato per
/// un'altra strada.
fn non_lo_sovrascrivo(path: &Utf8Path) -> String {
    format!(
        "{path} non si è potuto leggere all'apertura: Fub non lo sovrascrive, o \
         la configurazione che contiene andrebbe persa. Correggilo o spostalo, e \
         riapri."
    )
}

/// Il livello **macchina**, condiviso da tutti i vault aperti.
///
/// Condiviso e non copiato: i vault aperti insieme sono N
/// ([decisione 0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md))
/// e la configurazione della macchina è **una**. N copie sarebbero N idee del
/// tema, e la seconda finestra che scrive vincerebbe sulla prima senza che
/// nessuna delle due lo sappia.
///
/// `path: None` è il livello macchina **in memoria**: è ciò che usa un test —
/// e un e2e headless — per non scrivere nella cartella di configurazione di chi
/// esegue la suite. Un livello che non ha un file non lo scrive, e lo dice
/// rispondendo `Ok` senza fare niente: non è un errore, è un host che ha detto
/// di non averne uno.
pub struct MachineSettings {
    path: Option<Utf8PathBuf>,
    /// Il file si è letto? Se no **non lo si riscrive**: vedi
    /// [`non_lo_sovrascrivo`].
    readable: bool,
    values: RwLock<BTreeMap<String, SettingValue>>,
}

impl MachineSettings {
    /// Apre (o crea al primo salvataggio) il file della macchina. Un file
    /// illeggibile non impedisce di aprire un vault: torna l'avviso, e il
    /// livello resta vuoto — perché la configurazione della macchina è la meno
    /// autorevole delle due, e perdere il tema non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Arc<Self>, Option<String>) {
        let (values, warning) = match load(path) {
            Ok(values) => (values, None),
            Err(e) => (BTreeMap::new(), Some(e)),
        };
        (
            Arc::new(MachineSettings {
                path: Some(path.to_owned()),
                readable: warning.is_none(),
                values: RwLock::new(values),
            }),
            warning,
        )
    }

    /// Un livello macchina che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(MachineSettings {
            path: None,
            readable: true,
            values: RwLock::new(BTreeMap::new()),
        })
    }

    fn get(&self, key: &str) -> Option<SettingValue> {
        self.values
            .read()
            .expect("livello macchina")
            .get(key)
            .cloned()
    }

    /// Scrive **prima su disco e poi in memoria**, e l'ordine è la riga: al
    /// contrario, una scrittura fallita (disco pieno, permessi, cartella
    /// sparita) lascerebbe il valore nuovo in memoria e quello vecchio nel file,
    /// con l'evento *non* emesso perché il chiamante ha ricevuto un errore —
    /// cioè tre verità per una chiave, e la terza torna al riavvio.
    ///
    /// E ciò che finisce in memoria è il file **fuso**, non la mappa di prima
    /// con la chiave nuova sopra: se un'altra installazione ha scritto altre
    /// chiavi dopo la nostra apertura, quelle sono nel file e da questo momento
    /// sono anche qui.
    fn write(&self, key: &str, value: Option<SettingValue>) -> Result<(), String> {
        let mut values = self.values.write().expect("livello macchina");
        let Some(path) = &self.path else {
            match value {
                Some(v) => {
                    values.insert(key.to_string(), v);
                }
                None => {
                    values.remove(key);
                }
            }
            return Ok(());
        };
        if !self.readable {
            return Err(non_lo_sovrascrivo(path));
        }
        *values = store(path, key, value)?;
        Ok(())
    }
}

/// Una chiave **dichiarata**: lo schema, e di chi è.
///
/// Il proprietario non sta nella `SettingSpec` e non ci deve stare: la spec è
/// ciò che il plugin dichiara di sé, il proprietario è ciò che l'host sa di lui
/// — la stessa distinzione di [`Trust`](crate::Trust), che non sta nel manifest
/// per la stessa ragione. Serve a rispondere a
/// [`IndexQuery::Settings { plugin }`](fub_abi::traits::IndexQuery::Settings)
/// senza dedurre il proprietario dal prefisso della chiave: le chiavi del core
/// un prefisso non ce l'hanno.
struct Declared {
    spec: SettingSpec,
    plugin: String,
}

/// Lo store di configurazione di **un vault**.
pub struct SettingsStore {
    specs: BTreeMap<String, Declared>,
    vault_path: Utf8PathBuf,
    /// Il supporto del vault (§15.1). `settings.json` sta dentro `.fub/`, cioè
    /// **dentro il vault**: passa da qui e non da `std::fs`, o il giorno in cui
    /// un vault vive su un supporto che cifra la sua configurazione resterebbe
    /// in chiaro accanto ai documenti cifrati
    /// ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)).
    storage: Arc<dyn VaultStorage>,
    vault: BTreeMap<String, SettingValue>,
    /// Il file del vault si è letto? Se no **non lo si riscrive**: vedi
    /// [`non_lo_sovrascrivo`].
    vault_readable: bool,
    machine: Arc<MachineSettings>,
    /// Cosa è andato storto **leggendo**: un file malformato, una chiave di
    /// macchina scritta dentro un vault. Chi monta le stampa; il canale vero è
    /// il §20.2.
    warnings: Vec<String>,
}

impl SettingsStore {
    /// Apre lo store di un vault: carica il livello del vault e si aggancia a
    /// quello della macchina.
    pub fn open(
        root: &Utf8Path,
        storage: Arc<dyn VaultStorage>,
        machine: Arc<MachineSettings>,
    ) -> Self {
        let vault_path = root.join(crate::vault::FUB_DIR).join("settings.json");
        let (vault, warnings) = match load_from(&vault_path, |p| storage.read(p)) {
            Ok(values) => (values, Vec::new()),
            // Come per la macchina: un file rotto non impedisce di aprire il
            // vault. La differenza è che qui la perdita è più grave — è la
            // configurazione **autorevole** — e per questo l'avviso resta a
            // disposizione di chi lo sa mostrare invece di finire su stderr e
            // basta.
            Err(e) => (BTreeMap::new(), vec![e]),
        };
        SettingsStore {
            specs: BTreeMap::new(),
            vault_path,
            storage,
            vault,
            vault_readable: warnings.is_empty(),
            machine,
            warnings,
        }
    }

    /// Gli avvisi raccolti finora, e li **svuota**: chi li legge se ne fa
    /// carico, e un avviso mostrato due volte è peggio di uno mostrato una.
    pub fn take_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.warnings)
    }

    /// Dichiara le chiavi di un plugin. Un doppione è un errore **del
    /// chiamante**, e chi lo riceve non dichiara il plugin: due schemi sulla
    /// stessa chiave sono due default e due specie, e chi legge prenderebbe
    /// quello che l'ordine di montaggio gli ha lasciato.
    pub fn declare(&mut self, plugin: &str, specs: &[SettingSpec]) -> Result<(), String> {
        // Il doppione si cerca in due posti, e il secondo è quello che si
        // dimentica: fra ciò che è già dichiarato, e **dentro lo stesso
        // manifest**. Confrontare solo con `self.specs` lascia passare un
        // manifest che nomina due volte la stessa chiave, e a vincere sarebbe
        // l'ultima — che è la forma peggiore dello stesso errore, perché non la
        // vede nemmeno chi ha scritto il plugin.
        let mut viste = std::collections::BTreeSet::new();
        for spec in specs {
            if let Some(incumbent) = self.specs.get(&spec.key) {
                return Err(format!(
                    "l'impostazione `{}` è già dichiarata da `{}`",
                    spec.key, incumbent.plugin
                ));
            }
            if !viste.insert(spec.key.as_str()) {
                return Err(format!(
                    "`{plugin}` dichiara due volte l'impostazione `{}`",
                    spec.key
                ));
            }
        }
        for spec in specs {
            // Il valore del vault che non regge lo schema si scarta **qui**,
            // cioè nel momento in cui esiste qualcuno che sa dire cosa
            // quella chiave accetta. Prima di questa dichiarazione era solo una
            // riga in un file.
            for (level, present) in [
                (SettingSource::Vault, self.vault.get(&spec.key)),
                (SettingSource::Machine, self.machine.get(&spec.key).as_ref()),
            ] {
                if let Some(value) = present {
                    if let Some(why) = spec.kind.rejects(value) {
                        self.warnings.push(format!(
                            "impostazione `{}` ignorata (livello {level:?}): {why}",
                            spec.key
                        ));
                    }
                }
            }
            if spec.scope == SettingScope::Machine && self.vault.contains_key(&spec.key) {
                self.warnings.push(format!(
                    "l'impostazione `{}` è della macchina: il valore scritto nel \
                     vault non viene applicato",
                    spec.key
                ));
            }
            self.specs.insert(
                spec.key.clone(),
                Declared {
                    spec: spec.clone(),
                    plugin: plugin.to_string(),
                },
            );
        }
        Ok(())
    }

    /// Ritira le chiavi di un plugin che smette (`deactivate_plugin`).
    ///
    /// I **valori restano scritti**, ed è il punto: spegnere una feature non
    /// cancella come l'avevi configurata, o riaccenderla vorrebbe dire
    /// riconfigurarla. Sparisce lo schema, cioè la possibilità di leggerla e di
    /// scriverla — che è esattamente ciò che vuol dire «quella feature non c'è».
    pub fn withdraw(&mut self, plugin: &str) {
        self.specs.retain(|_, d| d.plugin != plugin);
    }

    fn declared(&self, key: &str) -> Result<&Declared, PluginError> {
        self.specs.get(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })
    }

    /// Il valore che vale adesso, e da dove viene.
    pub fn effective(&self, key: &str) -> Result<(SettingValue, SettingSource), PluginError> {
        let declared = self.declared(key)?;
        Ok(self.resolve(declared))
    }

    fn resolve(&self, declared: &Declared) -> (SettingValue, SettingSource) {
        let spec = &declared.spec;
        // Un valore che non regge lo schema non è un valore: si scende al
        // livello sotto, come se non ci fosse. La sua diagnosi è già un avviso
        // (vedi `declare`), e restituirlo qui vorrebbe dire dare a chi legge un
        // `bool` dove il suo codice si aspetta un numero.
        if spec.scope == SettingScope::Vault {
            if let Some(value) = self.vault.get(&spec.key) {
                if spec.kind.rejects(value).is_none() {
                    return (value.clone(), SettingSource::Vault);
                }
            }
        }
        if let Some(value) = self.machine.get(&spec.key) {
            if spec.kind.rejects(&value).is_none() {
                return (value, SettingSource::Machine);
            }
        }
        (spec.kind.default_value(), SettingSource::Default)
    }

    /// Lo schema di una chiave dichiarata.
    pub fn spec(&self, key: &str) -> Option<&SettingSpec> {
        self.specs.get(key).map(|d| &d.spec)
    }

    /// Tutte le righe risolte, o quelle di un plugin, in ordine di chiave.
    pub fn entries(&self, plugin: Option<&str>) -> Vec<SettingEntry> {
        self.entries_by_owner(plugin)
            .into_iter()
            .map(|(_, e)| e)
            .collect()
    }

    /// Le stesse, **con chi le ha dichiarate**: il proprietario non sta nella
    /// [`SettingSpec`] (e non ci deve stare, vedi [`Declared`]), ma è ciò che
    /// dice quale catalogo di stringhe risolve le sue etichette (§12.1).
    pub fn entries_by_owner(&self, plugin: Option<&str>) -> Vec<(String, SettingEntry)> {
        self.specs
            .values()
            .filter(|d| plugin.is_none_or(|p| d.plugin == p))
            .map(|d| {
                let (value, source) = self.resolve(d);
                (
                    d.plugin.clone(),
                    SettingEntry {
                        spec: d.spec.clone(),
                        value,
                        source,
                    },
                )
            })
            .collect()
    }

    /// Scrive una chiave nel livello che il suo scope dichiara.
    ///
    /// Torna lo scope in cui ha scritto: è ciò che finisce dentro
    /// [`Event::SettingChanged`](fub_abi::Event::SettingChanged), e chi lo
    /// riceve lo legge per sapere se il cambio riguarda questo vault o la
    /// macchina intera.
    pub fn set(&mut self, key: &str, value: SettingValue) -> Result<SettingScope, PluginError> {
        let spec = self.declared(key)?.spec.clone();
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.write(&spec, Some(value))
    }

    /// Dimentica ciò che era stato deciso: la chiave ricade al livello sotto.
    pub fn reset(&mut self, key: &str) -> Result<SettingScope, PluginError> {
        let spec = self.declared(key)?.spec.clone();
        self.write(&spec, None)
    }

    fn write(
        &mut self,
        spec: &SettingSpec,
        value: Option<SettingValue>,
    ) -> Result<SettingScope, PluginError> {
        match spec.scope {
            SettingScope::Machine => self
                .machine
                .write(&spec.key, value)
                .map_err(|e| PluginError::Internal(e.into()))?,
            SettingScope::Vault => {
                if !self.vault_readable {
                    return Err(PluginError::Internal(
                        non_lo_sovrascrivo(&self.vault_path).into(),
                    ));
                }
                // Su disco prima, in memoria dopo: la ragione è la stessa
                // scritta su `MachineSettings::write`.
                let mut next = self.vault.clone();
                match value {
                    Some(v) => {
                        next.insert(spec.key.clone(), v);
                    }
                    None => {
                        next.remove(&spec.key);
                    }
                }
                let bytes = encode(&next).map_err(|e| PluginError::Internal(e.into()))?;
                self.storage.write(&self.vault_path, &bytes).map_err(|e| {
                    PluginError::Internal(format!("{}: {e}", self.vault_path).into())
                })?;
                self.vault = next;
            }
        }
        Ok(spec.scope)
    }

    /// Il livello macchina, per chi apre un secondo vault sulla stessa
    /// installazione.
    pub fn machine(&self) -> &Arc<MachineSettings> {
        &self.machine
    }
}

/// Lo store come lo vedono insieme il workspace (che scrive) e l'indice del
/// kernel (che risponde alla query).
///
/// Un `Arc<RwLock<…>>` **dentro** un workspace che sta già dietro un `RwLock`
/// non è un lock in più sul percorso caldo: è la stessa forma di
/// `WatchState::watching` e di `CoreIndex::registry` — un pezzo di verità che
/// due proprietari devono vedere uguale — e il prestito interno lo si tiene per
/// il tempo di una lettura di mappa.
pub type SharedSettings = Arc<RwLock<SettingsStore>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::write_atomic;
    use fub_abi::settings::SettingKind;

    fn store_su(dir: &Utf8Path) -> SettingsStore {
        SettingsStore::open(
            dir,
            Arc::new(crate::storage::FsStorage),
            MachineSettings::in_memory(),
        )
    }

    /// La `TempDir` va **tenuta**: cade con lei la cartella, e uno store che
    /// scrive dentro una cartella già cancellata fallirebbe per una ragione che
    /// non c'entra con ciò che si sta provando.
    fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
        (dir, path)
    }

    #[test]
    fn senza_nessun_valore_vale_il_default_dello_schema() {
        let (_tmp, dir) = tempdir();
        let mut store = store_su(&dir);
        store
            .declare(
                "fub.versioning",
                &[SettingSpec::toggle("versioning.enabled", "V", true)],
            )
            .unwrap();
        let (value, source) = store.effective("versioning.enabled").unwrap();
        assert_eq!(value, SettingValue::Toggle(true));
        assert_eq!(source, SettingSource::Default);
    }

    #[test]
    fn il_vault_vince_sulla_macchina_che_vince_sul_default() {
        let (_tmp, dir) = tempdir();
        let machine = MachineSettings::in_memory();
        let mut store =
            SettingsStore::open(&dir, Arc::new(crate::storage::FsStorage), machine.clone());
        let spec = SettingSpec::new(
            "editor.font-size",
            "Corpo",
            SettingKind::Number {
                default: 14.0,
                min: None,
                max: None,
            },
        );
        store.declare("fub.editor", &[spec]).unwrap();

        machine
            .write("editor.font-size", Some(SettingValue::Number(16.0)))
            .unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(16.0), SettingSource::Machine)
        );

        store
            .set("editor.font-size", SettingValue::Number(18.0))
            .unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(18.0), SettingSource::Vault)
        );

        // E azzerare **ricade**, non riporta al default: è la differenza fra
        // «smetto di decidere» e «decido il default».
        store.reset("editor.font-size").unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(16.0), SettingSource::Machine)
        );
    }

    /// La riga di sicurezza: un vault non decide della macchina.
    #[test]
    fn una_chiave_di_macchina_scritta_nel_vault_non_si_applica() {
        let (_tmp, dir) = tempdir();
        let vault_file = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
        std::fs::write(
            &vault_file,
            r#"{"version":1,"values":{"privacy.telemetry":true}}"#,
        )
        .unwrap();

        let mut store = store_su(&dir);
        store
            .declare(
                "fub.privacy",
                &[SettingSpec::toggle("privacy.telemetry", "Telemetria", false).per_machine()],
            )
            .unwrap();

        let (value, source) = store.effective("privacy.telemetry").unwrap();
        assert_eq!(
            value,
            SettingValue::Toggle(false),
            "il vault non è stato ascoltato"
        );
        assert_eq!(source, SettingSource::Default);
        let warnings = store.take_warnings();
        assert!(
            warnings.iter().any(|w| w.contains("privacy.telemetry")),
            "e non in silenzio: {warnings:?}"
        );
    }

    #[test]
    fn una_chiave_non_dichiarata_non_si_legge_e_non_si_scrive() {
        let (_tmp, dir) = tempdir();
        let mut store = store_su(&dir);
        assert!(store.effective("boh").is_err());
        assert!(store.set("boh", SettingValue::Toggle(true)).is_err());
    }

    #[test]
    fn un_valore_fuori_specie_scritto_a_mano_si_scarta_col_default_sotto() {
        let (_tmp, dir) = tempdir();
        let vault_file = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
        std::fs::write(&vault_file, r#"{"version":1,"values":{"a.b":"acceso"}}"#).unwrap();

        let mut store = store_su(&dir);
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        assert_eq!(
            store.effective("a.b").unwrap(),
            (SettingValue::Toggle(false), SettingSource::Default)
        );
        assert!(!store.take_warnings().is_empty());
    }

    #[test]
    fn ritirare_uno_schema_non_cancella_il_valore() {
        let (_tmp, dir) = tempdir();
        let mut store = store_su(&dir);
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        store.set("a.b", SettingValue::Toggle(true)).unwrap();
        store.withdraw("a");
        assert!(store.effective("a.b").is_err(), "lo schema non c'è più");

        // Riaccendere la feature ritrova la configurazione di prima.
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        assert_eq!(
            store.effective("a.b").unwrap(),
            (SettingValue::Toggle(true), SettingSource::Vault)
        );
    }

    #[test]
    fn due_schemi_sulla_stessa_chiave_non_convivono() {
        let (_tmp, dir) = tempdir();
        let mut store = store_su(&dir);
        store
            .declare("a", &[SettingSpec::toggle("x.y", "Y", false)])
            .unwrap();
        let e = store
            .declare("b", &[SettingSpec::toggle("x.y", "Y", true)])
            .expect_err("la seconda dichiarazione non passa");
        assert!(e.contains("`a`"), "{e}");
    }

    /// Il doppione **dentro lo stesso manifest**: è l'altra metà della prova
    /// qui sopra, e senza di essa a vincere sarebbe l'ultima delle due — cioè
    /// due default e due specie per una chiave, decisi dall'ordine di un `Vec`.
    #[test]
    fn nemmeno_lo_stesso_manifest_puo_dichiarare_due_volte_una_chiave() {
        let (_tmp, dir) = tempdir();
        let mut store = store_su(&dir);
        let e = store
            .declare(
                "a",
                &[
                    SettingSpec::toggle("x.y", "Y", false),
                    SettingSpec::toggle("x.y", "Y di nuovo", true),
                ],
            )
            .expect_err("un manifest che si contraddice non si dichiara");
        assert!(e.contains("due volte") && e.contains("`x.y`"), "{e}");
        assert!(
            store.spec("x.y").is_none(),
            "e non ne resta metà: il rifiuto è del manifest, non della seconda riga"
        );
    }

    /// La prova che tiene insieme le due metà della regola sui file malformati.
    ///
    /// Leggere un file rotto e tenersi un livello vuoto salva la configurazione
    /// per il tempo di **una** scrittura: la prima riscrive il file intero dalla
    /// mappa vuota. Chi ha sbagliato una virgola perderebbe tutto al primo
    /// interruttore toccato.
    #[test]
    fn un_file_malformato_non_lo_sovrascrive_la_prima_scrittura() {
        let (_tmp, dir) = tempdir();
        let path = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let rotto = "{ \"version\": 1, \"values\": { \"a.b\": true,, } }";
        std::fs::write(&path, rotto).unwrap();

        let mut store = store_su(&dir);
        assert_eq!(
            store.take_warnings().len(),
            1,
            "il file rotto si dice, e non impedisce di aprire il vault"
        );
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        let e = store
            .set("a.b", SettingValue::Toggle(true))
            .expect_err("scrivere su un livello che non si è letto è un rifiuto");
        assert!(format!("{e:?}").contains("non lo sovrascrive"), "{e:?}");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            rotto,
            "e il file è ancora quello che l'utente aveva scritto"
        );
    }

    /// `write_atomic` non lascia dietro di sé il temporaneo, e il nome che usa
    /// è unico: due scritture di fila non si contendono lo stesso `.tmp`.
    #[test]
    fn la_scrittura_atomica_non_lascia_scorie() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("stato.json");
        write_atomic(&path, b"{\"a\":1}").unwrap();
        write_atomic(&path, b"{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        let residui: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n != "stato.json")
            .collect();
        assert!(residui.is_empty(), "temporanei rimasti: {residui:?}");
    }
}
