//! Lo **store di configurazione** (§11.1): chi tiene gli schemi dichiarati, i
//! valori scritti e la regola con cui i due si incontrano.
//!
//! # Un posto solo, e un'eccezione che si dichiara
//!
//! Un valore sta nel file del **vault** (`<root>/.fub/settings.json`), e basta:
//! è la [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md),
//! ed è la forma che ha Obsidian con `.obsidian/`. Un file solo, visibile e
//! copiabile, e nessuna regola di precedenza da tenere a mente per capire perché
//! ciò che si è scritto non si vede.
//!
//! L'eccezione è la **diagnostica** (`log.*`), dichiarata con
//! [`SettingScope::Machine`]: sta nel file della macchina (dove lo decide chi
//! monta — `fub_host::config_dir`) perché deve valere anche quando un vault non
//! si apre, che è precisamente il caso in cui il log serve. Per una chiave così
//! la precedenza resta **macchina → default dello schema**; per tutte le altre è
//! **vault → default**. Il default non è un file: è parte della dichiarazione,
//! ed è per questo che un valore c'è sempre.
//!
//! Il terzo livello che il §11.1 nominava — «profilo/portable» — non è un terzo
//! posto in cui cercare: è **dove sta** il livello macchina, e quella è una
//! decisione di chi monta, non di questo store.
//!
//! # Un vault non decide della macchina
//!
//! La regola che questo modulo applica e che nessun altro può applicare al posto
//! suo: una chiave di [`SettingScope::Machine`] scritta in un
//! `.fub/settings.json` **si ignora**. Con l'eccezione ridotta al log vuol dire
//! una cosa più stretta di prima — un vault non alza il livello di log di chi lo
//! apre — ma la riga vale lo stesso, perché è ciò che rende la dichiarazione di
//! scope una regola invece di un suggerimento. Ignorarla non è silenzioso: chi
//! carica il file raccoglie un avviso che nomina la chiave.
//!
//! # Un valore può essere **sospeso**, e chi lo sospende non è questo modulo
//!
//! Un file che viaggia col vault è un file che può arrivare da fuori, e ci sono
//! chiavi per cui il caso peggiore non è né una sottrazione né una cosa che si
//! vede: le **scorciatoie** (`keys.*`, [0077]) riprogrammano un gesto di chi
//! apre, e un gesto riprogrammato si scopre premendolo. Da qui
//! [`SettingsStore::suspend`]: un elenco di chiavi il cui valore del vault
//! **non si legge**, e sotto cui resta il default dello schema — cioè, per una
//! scorciatoia, la combinazione che il comando dichiara.
//!
//! Questo modulo tiene il **meccanismo** e non il criterio. Quali chiavi siano
//! sospese lo decide chi monta, perché per deciderlo serve una cosa che sta
//! fuori dal vault — cosa l'utente ha già guardato su questa macchina — e uno
//! store che leggesse il registro dei vault per rispondere a una `effective()`
//! sarebbe il kernel che conosce l'installazione. La regola sta in
//! `fub_host::settings`, la sospensione arriva qui già decisa, ed è la
//! [0100](../../../docs/decisions/0100-i-tasti-che-arrivano-da-fuori.md).
//!
//! Una sola cosa la decide questo modulo, perché è l'unico a saperla: **scrivere
//! una chiave sospesa la risveglia**. Chi scrive è una persona davanti al
//! pannello, e lasciare sospeso ciò che ha appena battuto vorrebbe dire un
//! valore nel file che nessuno leggerà mai — che è precisamente ciò che la 0076
//! esiste per non avere.
//!
//! [0077]: ../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md
//!
//! # Perché non è uno spazio chiave→valore
//!
//! Perché le chiavi le dichiara qualcuno: una chiave fuori schema non si legge e
//! non si scrive, e ciò che il file contiene senza che nessuno lo dichiari resta
//! lì senza essere letto. È la differenza con lo `storage_*` che la
//! [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md) ha
//! tolto, ed è ciò che rende questo store una **configurazione** invece di un
//! database di comodo.

use std::collections::{BTreeMap, BTreeSet};
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
    /// Le chiavi il cui valore del vault **non si legge** finché qualcuno non
    /// lo guarda (§23.13): vedi [`SettingsStore::suspend`] e la nota in testa al
    /// modulo. Vuoto per quasi ogni vault, ed è la forma giusta — una
    /// sospensione è un'eccezione con un elenco, non uno stato.
    sospese: BTreeSet<String>,
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
            sospese: BTreeSet::new(),
            warnings,
        }
    }

    /// Le scorciatoie che il file **di questo vault** dichiara, come chiave →
    /// accordo (§23.13).
    ///
    /// Guarda il file e non gli schemi, e non è un dettaglio: chi deve decidere
    /// se sospenderle è chi monta, e chiama **prima** che i provider di comandi
    /// si registrino — cioè prima che quelle chiavi siano dichiarate da
    /// qualcuno. Una scorciatoia scritta per un comando che questo montaggio non
    /// ha esce di qui lo stesso, ed è giusto: il giorno che quel componente si
    /// accende, il valore che stava lì ad aspettarlo non deve diventare attivo
    /// senza che nessuno l'abbia mai visto.
    ///
    /// I valori che non sono testo non ci sono: una chiave di scorciatoia con un
    /// numero dentro è un file scritto male, che `declare` diagnostica e
    /// `resolve` scarta già per conto suo.
    pub fn vault_keybindings(&self) -> BTreeMap<String, String> {
        self.vault
            .iter()
            .filter(|(key, _)| fub_abi::settings::command_of_keybinding_key(key).is_some())
            .filter_map(|(key, value)| match value {
                SettingValue::Text(chord) => Some((key.clone(), chord.clone())),
                _ => None,
            })
            .collect()
    }

    /// Sospende il valore *del vault* di queste chiavi: [`resolve`] le tratta
    /// come se il file non ne parlasse, e sotto resta il default dello schema.
    ///
    /// Sostituisce l'elenco invece di aggiungersi, perché una sospensione è la
    /// risposta a una domanda fatta tutta insieme — *cosa, di ciò che questo
    /// file porta, non è ancora stato guardato* — e due chiamate che si
    /// sommassero lascerebbero sospesa una chiave a cui qualcuno ha già detto di
    /// sì.
    ///
    /// Non tocca il file. Una sospensione che cancellasse sarebbe irreversibile
    /// dove il caso è **il dubbio**, ed è la riga della
    /// [0099](../../../docs/decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md):
    /// delle due mosse si sospende quella che non si disfa.
    ///
    /// [`resolve`]: SettingsStore::resolve
    pub fn suspend(&mut self, keys: BTreeSet<String>) {
        self.sospese = keys;
    }

    /// Le chiavi sospese adesso.
    pub fn suspended(&self) -> &BTreeSet<String> {
        &self.sospese
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
            // E si guarda **il livello che la chiave dichiara**, non tutti e
            // due: da quando `resolve` non scala più (0076), un valore nel file
            // sbagliato non è un valore scartato — è un valore che nessuno
            // leggerà mai, e dirlo come se fosse stato *ignorato per la sua
            // forma* manderebbe a cercare il difetto dalla parte opposta.
            let (level, present) = match spec.scope {
                SettingScope::Vault => (SettingSource::Vault, self.vault.get(&spec.key).cloned()),
                SettingScope::Machine => (SettingSource::Machine, self.machine.get(&spec.key)),
            };
            if let Some(value) = present {
                if let Some(why) = spec.kind.rejects(&value) {
                    self.warnings.push(format!(
                        "impostazione `{}` ignorata (livello {level:?}): {why}",
                        spec.key
                    ));
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

    /// Il livello che una chiave dichiara, e **nient'altro sotto di lui**.
    ///
    /// Fino alla 0076 una chiave di vault non trovata nel vault scendeva al file
    /// della macchina, e quella era la precedenza. Adesso non c'è: una chiave ha
    /// un posto, e sotto quel posto c'è il default dello schema. Ciò che si
    /// guadagna è la domanda a cui si può rispondere guardando un file solo —
    /// *perché questo vault è chiaro?* — e ciò che si perde è nominato nel
    /// verbale: un vault nuovo riparte dalle impostazioni di fabbrica.
    ///
    /// Un valore che non regge lo schema non è un valore: si ricade sul default,
    /// come se non ci fosse. La sua diagnosi è già un avviso (vedi [`declare`]),
    /// e restituirlo qui vorrebbe dire dare a chi legge un `bool` dove il suo
    /// codice si aspetta un numero.
    ///
    /// Una chiave **sospesa** (§23.13) si legge come se il file del vault non ne
    /// parlasse: torna il default dello schema, e `SettingSource::Default` dice
    /// il vero — nessuno *che valga* ha deciso quel valore. La sospensione non
    /// è una quarta provenienza perché non dura: o la si scioglie guardandola, o
    /// la si scioglie scrivendo, e un vocabolario nel contratto per uno stato
    /// che finisce sarebbe firma pagata per un'attesa.
    ///
    /// [`declare`]: SettingsStore::declare
    fn resolve(&self, declared: &Declared) -> (SettingValue, SettingSource) {
        let spec = &declared.spec;
        let (trovato, source) = match spec.scope {
            SettingScope::Vault if self.sospese.contains(&spec.key) => {
                (None, SettingSource::Default)
            }
            SettingScope::Vault => (self.vault.get(&spec.key).cloned(), SettingSource::Vault),
            SettingScope::Machine => (self.machine.get(&spec.key), SettingSource::Machine),
        };
        if let Some(value) = trovato {
            if spec.kind.rejects(&value).is_none() {
                return (value, source);
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
                // **Scrivere risveglia**, e sta qui perché qui passano tutti e
                // due i modi di scrivere — il valore e l'azzeramento. A scrivere
                // un'impostazione è una persona davanti al pannello (la via dei
                // programmi ha il suo cancello, `program_writable`, e le
                // scorciatoie non lo aprono), quindi ciò che esce da questa riga
                // è un valore che qualcuno ha appena guardato. Lasciarlo sospeso
                // vorrebbe dire scrivere in un file una riga che nessuno
                // leggerà, che è la cosa che la 0076 esiste per non avere.
                //
                // **Una chiave alla volta**, e non l'elenco: chi rimappa *una*
                // scorciatoia non ha guardato le altre cinque che quel vault
                // portava, e adottargliele tutte al primo gesto sarebbe
                // esattamente il sì che questa voce esiste per non far dare per
                // sbaglio.
                self.sospese.remove(&spec.key);
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

    /// Uno store con una scorciatoia già scritta nel file del vault.
    fn store_con_un_tasto(dir: &Utf8Path, chord: &str) -> SettingsStore {
        let mut store = store_su(dir);
        store
            .declare(
                "fub.core",
                &[SettingSpec::new(
                    "keys.note.create",
                    "Nuova nota",
                    SettingKind::Text {
                        default: String::new(),
                    },
                )],
            )
            .unwrap();
        store
            .set("keys.note.create", SettingValue::Text(chord.into()))
            .unwrap();
        store
    }

    /// Una chiave sospesa si legge come se il file non ne parlasse (§23.13). E
    /// la provenienza dice il vero: `Default`, perché nessuna decisione che
    /// valga è stata presa.
    #[test]
    fn una_chiave_sospesa_vale_il_default_e_il_file_non_si_tocca() {
        let (_tmp, dir) = tempdir();
        let mut store = store_con_un_tasto(&dir, "Mod-Alt-k");
        assert_eq!(
            store.effective("keys.note.create").unwrap(),
            (SettingValue::Text("Mod-Alt-k".into()), SettingSource::Vault)
        );

        store.suspend(BTreeSet::from(["keys.note.create".to_string()]));
        assert_eq!(
            store.effective("keys.note.create").unwrap(),
            (SettingValue::Text(String::new()), SettingSource::Default)
        );

        // Il valore è **sospeso**, non cancellato: si legge ancora dal file, che
        // è ciò che permette di adottarlo dopo. Sospendere è la mossa che si
        // disfa, ed è la ragione per cui è quella che si fa nel dubbio.
        assert_eq!(
            store.vault_keybindings().get("keys.note.create"),
            Some(&"Mod-Alt-k".to_string())
        );
    }

    /// **Scrivere risveglia**, ed è l'unica cosa che questo modulo decide da sé:
    /// chi scrive un'impostazione è una persona, e un valore che ha appena
    /// battuto non può restare fra quelli che nessuno leggerà mai.
    #[test]
    fn scrivere_una_chiave_sospesa_la_risveglia() {
        let (_tmp, dir) = tempdir();
        let mut store = store_con_un_tasto(&dir, "Mod-Alt-k");
        store.suspend(BTreeSet::from(["keys.note.create".to_string()]));

        store
            .set("keys.note.create", SettingValue::Text("Mod-j".into()))
            .unwrap();
        assert!(store.suspended().is_empty());
        assert_eq!(
            store.effective("keys.note.create").unwrap(),
            (SettingValue::Text("Mod-j".into()), SettingSource::Vault)
        );
    }

    /// E **azzerare** la risveglia allo stesso modo: è la strada del «tieni le
    /// mie», e se non risvegliasse resterebbe una sospensione appesa a una
    /// chiave che nel file non c'è più.
    #[test]
    fn azzerare_una_chiave_sospesa_la_risveglia() {
        let (_tmp, dir) = tempdir();
        let mut store = store_con_un_tasto(&dir, "Mod-Alt-k");
        store.suspend(BTreeSet::from(["keys.note.create".to_string()]));

        store.reset("keys.note.create").unwrap();
        assert!(store.suspended().is_empty());
        assert!(store.vault_keybindings().is_empty());
    }

    /// Il file si guarda **prima** che gli schemi esistano, ed è il momento in
    /// cui chi monta deve decidere: una scorciatoia scritta per un comando che
    /// questo montaggio non ha esce lo stesso da `vault_keybindings`, o il
    /// giorno che quel componente si accende il suo accordo diventerebbe attivo
    /// senza che nessuno l'abbia mai visto.
    #[test]
    fn i_tasti_del_file_si_leggono_anche_senza_nessuno_che_li_dichiari() {
        let (_tmp, dir) = tempdir();
        write_atomic(
            &dir.join(crate::vault::FUB_DIR).join("settings.json"),
            br#"{"version":1,"values":{
                "keys.note.create":"Mod-Alt-k",
                "com.acme:keys.tasks.add":"Mod-t",
                "appearance.theme":"dark",
                "keys.rotto": 12
            }}"#,
        )
        .unwrap();
        let store = store_su(&dir);
        let tasti = store.vault_keybindings();

        assert_eq!(tasti.len(), 2, "{tasti:?}");
        assert_eq!(tasti.get("com.acme:keys.tasks.add").unwrap(), "Mod-t");
        // Il tema non è una scorciatoia, e un accordo che non è testo è un file
        // scritto male — che `declare` diagnostica e `resolve` scarta già.
        assert!(!tasti.contains_key("appearance.theme"));
        assert!(!tasti.contains_key("keys.rotto"));
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

    /// Una chiave di vault legge **solo** il file del vault (0076): il livello
    /// macchina non è più il gradino sotto di lei, ed è la prova che la
    /// precedenza è sparita davvero e non solo dalla prosa.
    #[test]
    fn una_chiave_del_vault_non_guarda_il_file_della_macchina() {
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

        // Un valore rimasto nel file della macchina — da una versione di prima
        // della 0076, o da una chiave che allora era di macchina — non parla
        // più per una chiave di vault.
        machine
            .write("editor.font-size", Some(SettingValue::Number(16.0)))
            .unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(14.0), SettingSource::Default)
        );

        store
            .set("editor.font-size", SettingValue::Number(18.0))
            .unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(18.0), SettingSource::Vault)
        );

        // E azzerare riporta al **default dello schema**, perché sotto non c'è
        // più niente.
        store.reset("editor.font-size").unwrap();
        assert_eq!(
            store.effective("editor.font-size").unwrap(),
            (SettingValue::Number(14.0), SettingSource::Default)
        );
    }

    /// La diagnostica è l'eccezione dichiarata, e continua a vivere nel file
    /// della macchina: è ciò che deve valere anche quando un vault non si apre.
    #[test]
    fn il_log_resta_della_macchina() {
        let (_tmp, dir) = tempdir();
        let machine = MachineSettings::in_memory();
        let mut store =
            SettingsStore::open(&dir, Arc::new(crate::storage::FsStorage), machine.clone());
        store
            .declare(
                "fub.core",
                &[SettingSpec::toggle("log.verbose", "Verboso", false).per_machine()],
            )
            .unwrap();
        store
            .set("log.verbose", SettingValue::Toggle(true))
            .unwrap();
        assert_eq!(
            store.effective("log.verbose").unwrap(),
            (SettingValue::Toggle(true), SettingSource::Machine)
        );
        assert_eq!(
            machine.get("log.verbose"),
            Some(SettingValue::Toggle(true)),
            "ed è finita nel file della macchina, non in quello del vault"
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
