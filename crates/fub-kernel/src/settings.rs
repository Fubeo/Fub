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

use crate::storage::{do_not_overwrite, update_atomic, Durable, VaultStorage};
use crate::poison::Shelter;
use fub_abi::schema::SchemaVersion;
/// La cartella in cui la shell deposita e cerca gli allegati del vault.
///
/// La chiave è dichiarata dal bundle core (`fub-host`) ma il kernel la legge
/// quando risolve un wikilink a un allegato.
pub const ATTACHMENT_FOLDER: &str = "files.attachment-folder";

/// La versione di schema del file (§15.3): un numero scritto **dal primo
/// giorno**, perché il file che non ce l'ha è quello che poi non si sa da che
/// versione viene.
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Il file di un livello, com'è su disco.
#[derive(Default, Serialize, Deserialize)]
struct SettingsFile {
    version: SchemaVersion,
    #[serde(default, deserialize_with = "values_without_duplicates")]
    values: BTreeMap<String, SettingValue>,
}

/// Le chiavi del file, **una per nome** (difetto 0174).
///
/// JSON non vieta di scrivere la stessa chiave due volte, e la libreria che lo
/// legge la fa vincere all'ultima senza dire niente: un file scritto a mano — o
/// da una versione che numerava le chiavi diversamente — perdeva una delle due
/// righe al primo interruttore toccato, perché la scrittura ricompone il file
/// dalla mappa e nella mappa ce n'è rimasta una. Il danno è quello della 0036
/// arrivato per una porta più stretta: la configurazione dell'utente sparisce
/// da un file che nessuno gli aveva detto di guardare.
///
/// La risposta è quella che questa casa dà già a un file che non si capisce:
/// **non lo si capisce, e quindi non lo si sovrascrive**. Due valori per una
/// chiave non sono un valore da scegliere — sceglierlo vorrebbe dire decidere
/// per l'utente quale delle sue due righe buttare — quindi il file è
/// malformato come lo è per una virgola di troppo, e da lì in poi eredita tutto
/// ciò che c'è già: l'avviso all'apertura, il rifiuto di riscriverlo, e da oggi
/// il fatto che correggerlo basti (difetto 0170).
///
/// Sta in [`load_from`] e non nei due livelli perché la domanda «cosa vuol dire
/// illeggibile» ha un autore solo: il livello della macchina e quello del vault
/// la ereditano insieme, e il nome della chiave ripetuta esce nel messaggio,
/// che è l'unica cosa che serve per andare a togliere la riga di troppo.
fn values_without_duplicates<'de, D>(d: D) -> Result<BTreeMap<String, SettingValue>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct Visitor;

    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = BTreeMap<String, SettingValue>;

        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("le impostazioni, una per chiave")
        }

        fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::MapAccess<'de>,
        {
            let mut values = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, SettingValue>()? {
                if values.insert(key.clone(), value).is_some() {
                    return Err(serde::de::Error::custom(format!(
                        "la chiave `{key}` è scritta due volte, e quale delle \
                         due valga non lo dice nessuno"
                    )));
                }
            }
            Ok(values)
        }
    }

    d.deserialize_map(Visitor)
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
                .map_err(|and| format!("{path} non è un settings.json valido: {and}"))?;
            if file.version > SCHEMA_VERSION {
                return Err(format!(
                    "{path} è scritto nella versione {} di questo formato, e questa \
                     copia di Fub legge fino alla {SCHEMA_VERSION}",
                    file.version
                ));
            }
            Ok(file.values)
        }
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(and) => Err(format!("non riesco a leggere {path}: {and}")),
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
    serde_json::to_vec_pretty(&file).map_err(|and| and.to_string())
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
        // La rilettura è il cancello: ciò che non si capisce adesso non si
        // sovrascrive adesso.
        || load(path).map_err(|and| do_not_overwrite(&and, LOSS)),
        |disk| {
            match value {
                Some(v) => {
                    disk.insert(key.to_string(), v);
                }
                None => {
                    disk.remove(key);
                }
            }
            encode(disk)
        },
    )
}

/// Scrive **una chiave** del livello del vault, fondendola con ciò che sul
/// supporto c'è adesso. Torna la mappa fusa.
///
/// È la gemella di [`store`] — stessa regola, altro livello — e per un pezzo non
/// lo è stata: il livello del vault ricomponeva il file intero dalla copia presa
/// **all'apertura**, cioè la *lost update* che la 0066 aveva tolto alla macchina
/// e lasciata dove pesa di più. La macchina è di una installazione sola; il file
/// del vault lo condividono due finestre sullo stesso vault e due macchine che
/// lo sincronizzano, ed è lì che «l'altra ha scritto dopo che io avevo letto»
/// smette di essere teorico.
///
/// **Il file riletto è anche il cancello**: se adesso è malformato non lo si
/// sovrascrive ([`do_not_overwrite`]), e la domanda si fa qui perché qui c'è
/// la risposta vera — fra l'apertura e questa scrittura il file può essere stato
/// rotto da un editor di testo o da una sincronizzazione a metà, e può essere
/// stato **rimesso a posto** dalla stessa mano (difetto 0170).
fn store_vault(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
    key: &str,
    value: Option<SettingValue>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    // Il valore **non si consuma**, e la ragione non è di stile. `fondi` è una
    // `FnMut`: il supporto la può chiamare due volte, ed è ciò che farebbe un
    // supporto che riprova quando qualcun altro gli ha cambiato il file sotto.
    // Prima qui c'era un `Option::take` con un `expect` accanto — «il supporto
    // fonde una volta sola» — cioè una promessa che nella firma non c'è: chi
    // avesse montato un supporto suo l'avrebbe scoperta con un panico, e un
    // panico uccide il processo (0032). Rileggerlo a ogni giro è anche l'unica
    // cosa *giusta* da fare: la seconda fusione parte da byte diversi.
    let mut zone = None;
    // Il guasto di *dominio* viaggia di fianco invece che dentro l'`io::Error`,
    // o la sua frase uscirebbe da qui avvolta in un «non riesco a scrivere» che
    // dice la cosa sbagliata: il file non si è potuto **leggere**.
    let mut failure = None;
    let outcome = storage.update(path, &mut |current| {
        let new = load_from(path, |_| match current {
            Some(bytes) => Ok(bytes.to_vec()),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "mai configurato",
            )),
        });
        let mut disk = match new {
            Ok(disk) => disk,
            Err(and) => {
                failure = Some(do_not_overwrite(&and, LOSS));
                return Err(std::io::Error::other("il file non si è potuto leggere"));
            }
        };
        match &value {
            Some(v) => {
                disk.insert(key.to_string(), v.clone());
            }
            None => {
                disk.remove(key);
            }
        }
        let bytes = match encode(&disk) {
            Ok(bytes) => bytes,
            Err(and) => {
                failure = Some(and);
                return Err(std::io::Error::other("il file non si è potuto comporre"));
            }
        };
        zone = Some(disk);
        Ok(Some(bytes))
    });
    match (outcome, failure) {
        (_, Some(failure)) => Err(failure),
        (Err(and), None) => Err(format!("non riesco a scrivere {path}: {and}")),
        // Un supporto che dice di aver scritto senza aver fuso niente non
        // lascia una mappa da adottare, e qui c'era un `expect`: la stessa
        // promessa non scritta di sopra, dall'altro lato. Adesso è un errore
        // come tutti gli altri — chi ha montato quel supporto legge una frase e
        // la sua configurazione in memoria resta quella di prima, invece di
        // perdere il processo.
        (Ok(()), None) => zone.ok_or_else(|| {
            format!("{path}: il supporto ha detto di aver scritto senza fondere niente")
        }),
    }
}

/// Ciò che si perderebbe sovrascrivendo un file di livello che non si rilegge:
/// il testo che [`do_not_overwrite`] mette dopo la ragione, uguale per i due
/// livelli perché la perdita è la stessa.
const LOSS: &str = "la configurazione che contiene andrebbe persa";

/// Il rifiuto di chi non trova lo schema di una chiave, detto **una volta** per
/// tutti e due gli store: il livello macchina e quello di un vault rispondono
/// alla stessa domanda, e due frasi diverse per lo stesso guasto manderebbero a
/// cercare la differenza dove non c'è.
fn undeclared(key: &str) -> PluginError {
    PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
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
///
/// # Perché tiene anche uno **schema**
///
/// Perché una chiave di macchina esiste quando un vault non c'è, e fino alla
/// [0116](../../../docs/decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
/// esisteva solo il suo *valore*: lo schema stava nello [`SettingsStore`] di un
/// vault, cioè nell'unico posto che sparisce proprio nel caso per cui lo scope
/// `Machine` era nato. `log.level` si poteva leggere e scrivere **solo con un
/// vault aperto**, che è il contrario di ciò che il suo doc-comment prometteva.
///
/// Lo schema qui dentro è quello del **core** e di nessun altro: chi dichiara
/// vive quanto ciò che dichiara, e un plugin si registra per vault. Una spec di
/// scope [`SettingScope::Vault`] viene **rifiutata**, o questo livello
/// risponderebbe per una chiave che non gli appartiene.
pub struct MachineSettings {
    path: Option<Utf8PathBuf>,
    /// **Il turno di chi scrive.** Non protegge un dato — lo protegge
    /// [`values`](Self::values) — ma l'ordine di due scritture: vedi
    /// [`MachineSettings::write`], dove serve perché il lucchetto dei valori
    /// non copre più l'andata al disco.
    ///
    /// Un [`Shelter`] e non un `Mutex` nudo perché la domanda «e se è
    /// avvelenato?» ha una porta sola nel kernel (0126): qui poi la risposta è
    /// la più facile di tutte — ciò che c'è dentro è `()`, e un ordine non si
    /// corrompe.
    write: Shelter<()>,
    values: RwLock<BTreeMap<String, SettingValue>>,
    /// Lo schema delle chiavi di macchina. Dietro un lock come i valori, e per
    /// la stessa ragione: l'`Arc` è condiviso da ogni vault aperto, e chi
    /// dichiara è l'host una volta sola all'avvio.
    specs: RwLock<BTreeMap<String, SettingSpec>>,
}

impl MachineSettings {
    /// Apre (o crea al primo salvataggio) il file della macchina. Un file
    /// illeggibile non impedisce di aprire un vault: torna l'avviso, e il
    /// livello resta vuoto — perché la configurazione della macchina è la meno
    /// autorevole delle due, e perdere il tema non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Arc<Self>, Option<String>) {
        let (values, warning) = match load(path) {
            Ok(values) => (values, None),
            Err(and) => (BTreeMap::new(), Some(and)),
        };
        (
            Arc::new(MachineSettings {
                path: Some(path.to_owned()),
                write: Shelter::new(()),
                values: RwLock::new(values),
                specs: RwLock::new(BTreeMap::new()),
            }),
            warning,
        )
    }

    /// Un livello macchina che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(MachineSettings {
            path: None,
            write: Shelter::new(()),
            values: RwLock::new(BTreeMap::new()),
            specs: RwLock::new(BTreeMap::new()),
        })
    }

    /// Dichiara le chiavi di macchina del core.
    ///
    /// Una spec di scope [`SettingScope::Vault`] è un errore del chiamante e
    /// non un valore da ignorare: chi la passa crede di aver dichiarato
    /// qualcosa, e un livello che accettasse in silenzio risponderebbe per una
    /// chiave che vive altrove — cioè con un default, dove il vault ha il valore
    /// vero. Un doppione è un errore per la stessa ragione dello
    /// [`SettingsStore::declare`]: due schemi sulla stessa chiave sono due
    /// default, e a vincere sarebbe l'ordine di montaggio.
    pub fn declare(&self, specs: &[SettingSpec]) -> Result<(), String> {
        let mut declared = self.specs.write().expect("schema della macchina");
        for spec in specs {
            if spec.scope != SettingScope::Machine {
                return Err(format!(
                    "l'impostazione `{}` è del vault: il livello macchina non la tiene",
                    spec.key
                ));
            }
            if declared.contains_key(&spec.key) {
                return Err(format!(
                    "l'impostazione `{}` è già dichiarata nel livello macchina",
                    spec.key
                ));
            }
            declared.insert(spec.key.clone(), spec.clone());
        }
        Ok(())
    }

    /// Questa chiave è dichiarata qui? È la domanda con cui chi riceve una
    /// scrittura **senza nessun vault aperto** distingue «non c'è vault» da
    /// «questa chiave un vault non le serve».
    pub fn declares(&self, key: &str) -> bool {
        self.specs
            .read()
            .expect("schema della macchina")
            .contains_key(key)
    }

    /// Tutte le righe di macchina risolte, in ordine di chiave.
    ///
    /// La stessa forma di [`SettingsStore::entries`], e i valori sono gli stessi
    /// che vede un vault aperto: la mappa è una sola.
    pub fn entries(&self) -> Vec<SettingEntry> {
        self.specs
            .read()
            .expect("schema della macchina")
            .values()
            .map(|spec| {
                let (value, source) = self.resolve(spec);
                SettingEntry {
                    spec: spec.clone(),
                    value,
                    source,
                }
            })
            .collect()
    }

    /// Il valore che vale adesso per una chiave di macchina, e da dove viene.
    pub fn effective(&self, key: &str) -> Result<(SettingValue, SettingSource), PluginError> {
        let specs = self.specs.read().expect("schema della macchina");
        let spec = specs.get(key).ok_or_else(|| undeclared(key))?;
        Ok(self.resolve(spec))
    }

    /// Scrive una chiave di macchina, con lo stesso cancello dello store di un
    /// vault: dichiarata, e di una forma che lo schema accetta.
    pub fn set(&self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        let spec = self.spec_of(key)?;
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.write(key, Some(value))
            .map_err(|and| PluginError::Internal(and.into()))
    }

    /// Dimentica ciò che era stato deciso: la chiave ricade sul default dello
    /// schema, che per una chiave di macchina è l'unico livello sotto.
    pub fn reset(&self, key: &str) -> Result<(), PluginError> {
        self.spec_of(key)?;
        self.write(key, None)
            .map_err(|and| PluginError::Internal(and.into()))
    }

    fn spec_of(&self, key: &str) -> Result<SettingSpec, PluginError> {
        self.specs
            .read()
            .expect("schema della macchina")
            .get(key)
            .cloned()
            .ok_or_else(|| undeclared(key))
    }

    /// Il valore scritto se regge lo schema, altrimenti il default — la stessa
    /// regola di [`SettingsStore::resolve`], che per un livello solo si scrive
    /// in quattro righe.
    fn resolve(&self, spec: &SettingSpec) -> (SettingValue, SettingSource) {
        if let Some(value) = self.get(&spec.key) {
            if spec.kind.rejects(&value).is_none() {
                return (value, SettingSource::Machine);
            }
        }
        (spec.kind.default_value(), SettingSource::Default)
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
    ///
    /// # Due lucchetti, e coprono due cose diverse
    ///
    /// **La sezione critica di [`values`](Self::values) è la sostituzione in
    /// memoria, tutta e sola.** L'andata al disco — il lock del file, la
    /// rilettura, la fusione, la scrittura, la rename — sta **fuori**: questo
    /// `Arc` è condiviso da ogni vault aperto e da chi disegna il pannello, e
    /// tenerlo in scrittura per la durata di un'operazione di I/O vuol dire che
    /// chiunque legga *un'altra* impostazione — il livello di log, il tema —
    /// aspetta il disco per una cosa che non lo riguarda. Su un supporto lento
    /// quell'attesa è la shell ferma.
    ///
    /// Il turno di [`write`](Self::write) è ciò che quel restringimento
    /// costa, e non è un di più: **due scritture devono adottare nell'ordine in
    /// cui il disco le ha accettate**. Senza il turno, la fusione più vecchia
    /// può tornare per seconda e posarsi sopra la più recente, lasciando in
    /// memoria una mappa che sul disco non c'è più — cioè la *lost update* che
    /// la [0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)
    /// aveva tolto al file, rientrata dalla porta della memoria. Il lock del
    /// file serializza le installazioni; questo serializza i thread, che quel
    /// lock non li vede nemmeno.
    fn write(&self, key: &str, value: Option<SettingValue>) -> Result<(), String> {
        let _turn = self.write.acquire();
        let Some(path) = &self.path else {
            let mut values = self.values.write().expect("livello macchina");
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
        let zone = store(path, key, value)?;
        *self.values.write().expect("livello macchina") = zone;
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
    /// Il livello del vault, che è **anche** ciò che sta nel file: un
    /// [`Durable`] perché «su disco prima, in memoria dopo» smettesse di
    /// essere una frase in un commento e diventasse l'unico ordine scrivibile.
    vault: Durable<BTreeMap<String, SettingValue>>,
    machine: Arc<MachineSettings>,
    /// Le chiavi il cui valore del vault **non si legge** finché qualcuno non
    /// lo guarda (§23.13): vedi [`SettingsStore::suspend`] e la nota in testa al
    /// modulo. Vuoto per quasi ogni vault, ed è la forma giusta — una
    /// sospensione è un'eccezione con un elenco, non uno stato.
    suspended: BTreeSet<String>,
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
            Err(and) => (BTreeMap::new(), vec![and]),
        };
        SettingsStore {
            specs: BTreeMap::new(),
            vault_path,
            storage,
            vault: Durable::new(vault),
            machine,
            suspended: BTreeSet::new(),
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
        self.suspended = keys;
    }

    /// Le chiavi sospese adesso.
    pub fn suspended(&self) -> &BTreeSet<String> {
        &self.suspended
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
        let mut seen = std::collections::BTreeSet::new();
        for spec in specs {
            if let Some(incumbent) = self.specs.get(&spec.key) {
                return Err(format!(
                    "l'impostazione `{}` è già dichiarata da `{}`",
                    spec.key, incumbent.plugin
                ));
            }
            if !seen.insert(spec.key.as_str()) {
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
        self.specs.get(key).ok_or_else(|| undeclared(key))
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
        let (found, source) = match spec.scope {
            SettingScope::Vault if self.suspended.contains(&spec.key) => {
                (None, SettingSource::Default)
            }
            SettingScope::Vault => (self.vault.get(&spec.key).cloned(), SettingSource::Vault),
            SettingScope::Machine => (self.machine.get(&spec.key), SettingSource::Machine),
        };
        if let Some(value) = found {
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
            .map(|(_, and)| and)
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
                .map_err(|and| PluginError::Internal(and.into()))?,
            SettingScope::Vault => {
                // Su disco prima, in memoria dopo: non più perché lo dica
                // questo commento, ma perché `Durable` non sa esprimere
                // l'altro ordine — la ragione sta là sopra.
                //
                // E **ciò che si adotta è la fusione, non la propria copia
                // mutata**: la chiave che si scrive è una, il file può averne
                // altre che qualcun altro ha messo dopo la nostra apertura, e
                // tenersi la propria mappa vorrebbe dire essere l'unico a non
                // sapere che ci sono (vedi [`store_vault`]).
                let (path, storage) = (&self.vault_path, self.storage.as_ref());
                let key = spec.key.clone();
                self.vault
                    .update(|| store_vault(storage, path, &key, value))
                    .map_err(|and| PluginError::Internal(and.into()))?;
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
                self.suspended.remove(&spec.key);
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
    use crate::storage::{write_atomic, FsStorage, Stat};
    use fub_abi::settings::SettingKind;

    fn store_on(dir: &Utf8Path) -> SettingsStore {
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
    fn store_with_key(dir: &Utf8Path, chord: &str) -> SettingsStore {
        let mut store = store_on(dir);
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

    /// **Un supporto che fonde due volte non è un panico**, è un supporto.
    ///
    /// `Merge` è una `FnMut`: il protocollo permette di chiamarla più di una
    /// volta, ed è ciò che fa un supporto che riprova quando qualcun altro gli
    /// ha cambiato il file sotto. Il `FsStorage` non lo fa, quindi il secondo
    /// giro non lo vedeva nessuno finché il solo supporto montabile era lui.
    struct SupportThatMergesTwice(crate::storage::FsStorage);

    impl VaultStorage for SupportThatMergesTwice {
        fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
            self.0.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
            self.0.write(path, bytes)
        }
        fn update(
            &self,
            path: &Utf8Path,
            merge: crate::storage::Merge<'_>,
        ) -> std::io::Result<()> {
            // Il primo giro si butta via, come lo butterebbe via chi riprova
            // dopo essersi accorto che il file è cambiato: ciò che conta è che
            // il secondo parta dai byte di adesso e dia lo stesso risultato.
            let before = self.0.read(path).ok();
            let _ = merge(before.as_deref())?;
            self.0.update(path, merge)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
            self.0.append(path, bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.0.rename(from, to)
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.0.rename_no_replace(from, to)
        }
        fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
            self.0.remove(path)
        }
        fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<crate::storage::DirEntry>> {
            self.0.list(dir)
        }
        fn stat(&self, path: &Utf8Path) -> std::io::Result<crate::storage::Stat> {
            self.0.stat(path)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
            self.0.remove_empty_dir(dir)
        }
    }

    /// Un supporto che dice di sì **senza fondere niente**: il caso limite
    /// dell'altro lato, e l'altro `expect` che stava qui.
    struct SupportThatDoesNotMerge(crate::storage::FsStorage);

    impl VaultStorage for SupportThatDoesNotMerge {
        fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
            self.0.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
            self.0.write(path, bytes)
        }
        fn update(
            &self,
            _path: &Utf8Path,
            _merge: crate::storage::Merge<'_>,
        ) -> std::io::Result<()> {
            Ok(())
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
            self.0.append(path, bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.0.rename(from, to)
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
            self.0.rename_no_replace(from, to)
        }
        fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
            self.0.remove(path)
        }
        fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<crate::storage::DirEntry>> {
            self.0.list(dir)
        }
        fn stat(&self, path: &Utf8Path) -> std::io::Result<crate::storage::Stat> {
            self.0.stat(path)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
            self.0.remove_empty_dir(dir)
        }
    }

    fn store_with_support(dir: &Utf8Path, storage: Arc<dyn VaultStorage>) -> SettingsStore {
        let mut store = SettingsStore::open(dir, storage, MachineSettings::in_memory());
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
    }

    /// **Chi monta un supporto suo riceve una risposta, non un panico.**
    ///
    /// Erano due `expect` in `store_vault`, che promettevano al posto della
    /// firma: «il supporto fonde una volta sola» e «una fusione riuscita ha
    /// lasciato la mappa». Nessuna delle due sta nel tratto, e la 0032 dice cosa
    /// costa scoprirlo: un panico uccide il processo, cioè il vault di chi stava
    /// scrivendo.
    #[test]
    fn a_support_that_not_and_the_disk_receives_a_error_and_not_a_panic() {
        let (_tmp, dir) = tempdir();
        let mut store = store_with_support(&dir, Arc::new(SupportThatMergesTwice(FsStorage)));
        // Non pania (se paniasse il banco morirebbe qui), e ciò che resta è il
        // valore giusto: la seconda fusione ha rifatto il lavoro, non l'ha
        // raddoppiato.
        store
            .set("keys.note.create", SettingValue::Text("Mod-j".into()))
            .expect("scrive");
        assert_eq!(
            store.vault_keybindings().get("keys.note.create"),
            Some(&"Mod-j".to_string())
        );

        let mut store = store_with_support(&dir, Arc::new(SupportThatDoesNotMerge(FsStorage)));
        let outcome = store.set("keys.note.create", SettingValue::Text("Mod-k".into()));
        assert!(
            outcome.is_err(),
            "un supporto che dice di aver scritto senza fondere non lascia \
             niente da adottare: la risposta è una frase, non un processo morto"
        );
    }

    /// Una chiave sospesa si legge come se il file non ne parlasse (§23.13). E
    /// la provenienza dice il vero: `Default`, perché nessuna decisione che
    /// valga è stata presa.
    #[test]
    fn a_key_suspended_equals_the_default_and_the_file_not_is_touches() {
        let (_tmp, dir) = tempdir();
        let mut store = store_with_key(&dir, "Mod-Alt-k");
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
    fn write_a_key_suspended_the_wakes() {
        let (_tmp, dir) = tempdir();
        let mut store = store_with_key(&dir, "Mod-Alt-k");
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
    fn clear_a_key_suspended_the_wakes() {
        let (_tmp, dir) = tempdir();
        let mut store = store_with_key(&dir, "Mod-Alt-k");
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
    fn the_keys_of_the_file_is_read_also_without_no_one_that_them_declare() {
        let (_tmp, dir) = tempdir();
        write_atomic(
            &dir.join(crate::vault::FUB_DIR).join("settings.json"),
            br#"{"version":1,"values":{
                "keys.notes.create":"Mod-Alt-k",
                "com.acme:keys.tasks.add":"Mod-t",
                "appearance.theme":"dark",
                "keys.broken": 12
            }}"#,
        )
        .unwrap();
        let store = store_on(&dir);
        let keys = store.vault_keybindings();

        assert_eq!(keys.len(), 2, "{keys:?}");
        assert_eq!(keys.get("com.acme:keys.tasks.add").unwrap(), "Mod-t");
        // Il tema non è una scorciatoia, e un accordo che non è testo è un file
        // scritto male — che `declare` diagnostica e `resolve` scarta già.
        assert!(!keys.contains_key("appearance.theme"));
        assert!(!keys.contains_key("keys.rotto"));
    }

    #[test]
    fn without_no_value_equals_the_default_of_the_schema() {
        let (_tmp, dir) = tempdir();
        let mut store = store_on(&dir);
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
    fn a_vault_key_does_not_watch_the_machine_file() {
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
    fn the_log_remains_of_the_machine() {
        let (_tmp, dir) = tempdir();
        let machine = MachineSettings::in_memory();
        let mut store =
            SettingsStore::open(&dir, Arc::new(crate::storage::FsStorage), machine.clone());
        store
            .declare(
                "fub.core",
                &[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()],
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

    /// **Chi legge un'impostazione non aspetta il disco** (0172).
    ///
    /// Il fatto è uno — il lucchetto dei valori non copre l'andata al file — e
    /// si osserva dal verso che si può fermare a comando invece che col
    /// cronometro: un lettore tiene la sua guardia, e la scrittura arriva
    /// **lo stesso** fino al disco. Se la sezione critica coprisse l'I/O quel
    /// lettore la starebbe bloccando, il file resterebbe vuoto finché non
    /// molla, e questo banco girerebbe fino alla scadenza — che è la stessa
    /// cosa, letta dall'altro capo, del pannello che aspetta il disco per una
    /// chiave che non sta scrivendo nessuno.
    ///
    /// Il cronometro qui non misura niente: è solo il modo di far fallire
    /// un'attesa infinita con una frase invece che con un test appeso.
    #[test]
    fn who_reads_not_waits_the_disk() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("settings.json");
        let (machine, warning) = MachineSettings::open(&path);
        assert!(warning.is_none(), "un file che non c'è non è un guasto");
        machine
            .declare(&[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()])
            .unwrap();

        // Un lettore fermo in mezzo alla sua lettura.
        let reader = machine.values.read().expect("livello macchina");

        let writer = {
            let machine = Arc::clone(&machine);
            std::thread::spawn(move || machine.set("log.verbose", SettingValue::Toggle(true)))
        };

        let expiration = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while load(&path).expect("leggibile").is_empty() {
            assert!(
                std::time::Instant::now() < expiration,
                "la scrittura non è arrivata al disco finché un lettore teneva il \
                 lucchetto: la sezione critica copre l'I/O invece della sola \
                 sostituzione in memoria"
            );
            std::thread::yield_now();
        }

        // E l'ordine resta quello di sempre: sul disco c'è già, in memoria non
        // ancora, perché adottare è l'unica cosa che aspetta questo lettore.
        assert!(
            reader.get("log.verbose").is_none(),
            "la memoria non si muove prima del disco"
        );
        drop(reader);
        writer.join().expect("il thread di scrittura").unwrap();
        assert_eq!(
            machine.get("log.verbose"),
            Some(SettingValue::Toggle(true)),
            "e ciò che si adotta è ciò che il disco ha accettato"
        );
    }

    /// La riga di sicurezza: un vault non decide della macchina.
    #[test]
    fn a_key_of_machine_written_in_the_vault_not_is_apply() {
        let (_tmp, dir) = tempdir();
        let vault_file = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
        std::fs::write(
            &vault_file,
            r#"{"version":1,"values":{"privacy.telemetry":true}}"#,
        )
        .unwrap();

        let mut store = store_on(&dir);
        store
            .declare(
                "fub.privacy",
                &[SettingSpec::toggle("privacy.telemetry", "Telemetria", false).for_machine()],
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
    fn a_key_not_declared_not_is_reads_and_not_is_writes() {
        let (_tmp, dir) = tempdir();
        let mut store = store_on(&dir);
        assert!(store.effective("boh").is_err());
        assert!(store.set("boh", SettingValue::Toggle(true)).is_err());
    }

    #[test]
    fn a_value_outside_kind_written_a_hand_is_discards_with_default_under() {
        let (_tmp, dir) = tempdir();
        let vault_file = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
        std::fs::write(&vault_file, r#"{"version":1,"values":{"a.b":"on"}}"#).unwrap();

        let mut store = store_on(&dir);
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
    fn withdraw_a_schema_not_deletes_the_value() {
        let (_tmp, dir) = tempdir();
        let mut store = store_on(&dir);
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
    fn two_schemas_on_the_same_key_not_coexist() {
        let (_tmp, dir) = tempdir();
        let mut store = store_on(&dir);
        store
            .declare("a", &[SettingSpec::toggle("x.y", "Y", false)])
            .unwrap();
        let and = store
            .declare("b", &[SettingSpec::toggle("x.y", "Y", true)])
            .expect_err("la seconda dichiarazione non passa");
        assert!(and.contains("`a`"), "{and}");
    }

    /// Il doppione **dentro lo stesso manifest**: è l'altra metà della prova
    /// qui sopra, e senza di essa a vincere sarebbe l'ultima delle due — cioè
    /// due default e due specie per una chiave, decisi dall'ordine di un `Vec`.
    #[test]
    fn not_even_the_same_manifest_can_declare_two_times_a_key() {
        let (_tmp, dir) = tempdir();
        let mut store = store_on(&dir);
        let and = store
            .declare(
                "a",
                &[
                    SettingSpec::toggle("x.y", "Y", false),
                    SettingSpec::toggle("x.y", "Y di nuovo", true),
                ],
            )
            .expect_err("un manifest che si contraddice non si dichiara");
        assert!(and.contains("due volte") && and.contains("`x.y`"), "{and}");
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
    fn a_malformed_file_does_not_overwrite_the_first_write() {
        let (_tmp, dir) = tempdir();
        let path = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let broken = "{ \"version\": 1, \"values\": { \"a.b\": true,, } }";
        std::fs::write(&path, broken).unwrap();

        let mut store = store_on(&dir);
        assert_eq!(
            store.take_warnings().len(),
            1,
            "il file rotto si dice, e non impedisce di aprire il vault"
        );
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        let and = store
            .set("a.b", SettingValue::Toggle(true))
            .expect_err("scrivere su un livello che non si è letto è un rifiuto");
        assert!(format!("{and:?}").contains("non lo sovrascrive"), "{and:?}");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            broken,
            "e il file è ancora quello che l'utente aveva scritto"
        );
    }

    /// **E un file corretto a mano non aspetta una riapertura** (difetto 0170).
    ///
    /// La faccia opposta di quello di sopra, ed è la faccia che una bandiera
    /// letta all'apertura sbagliava: chi ha dimenticato una virgola la rimette —
    /// con l'editor che ha già aperto, mentre Fub è lì — e da quel momento il
    /// file si legge. Un rifiuto che continua è un rifiuto che parla di ieri, e
    /// lascia come unica via d'uscita da un file **già a posto** il riavvio
    /// dell'app.
    ///
    /// Che poi la chiave scritta a mano si ritrovi non è un di più: dice che si
    /// è ripartiti da quei byte, cioè che la fusione ha letto il file corretto e
    /// non se n'è tenuto uno vuoto in tasca dall'apertura.
    #[test]
    fn a_file_correct_a_hand_not_waits_a_reopening() {
        let (_tmp, dir) = tempdir();
        let path = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ \"version\": 1, \"values\": { \"a.b\": true,, } }").unwrap();

        let mut store = store_on(&dir);
        assert_eq!(store.take_warnings().len(), 1, "il file rotto si dice");
        store
            .declare(
                "a",
                &[
                    SettingSpec::toggle("a.b", "B", false),
                    SettingSpec::toggle("a.c", "C", false),
                ],
            )
            .unwrap();

        // La stessa mano che l'aveva rotto lo rimette a posto, e Fub non si è
        // chiuso in mezzo.
        std::fs::write(&path, "{ \"version\": 1, \"values\": { \"a.b\": true } }").unwrap();

        store.set("a.c", SettingValue::Toggle(true)).expect(
            "il file adesso si legge: rifiutare vorrebbe dire chiedere di \
             riaprire l'app per un file che è già a posto",
        );
        assert_eq!(
            store.effective("a.b").unwrap().0,
            SettingValue::Toggle(true),
            "e si è ripartiti dai byte corretti, non dalla mappa vuota \
             dell'apertura"
        );
    }

    /// Lo stesso dall'altro livello, e tutte e due le facce in un banco solo: il
    /// file della macchina rotto **resta** rotto finché lo è, e smette di
    /// esserlo nel momento in cui smette (difetto 0170).
    #[test]
    fn also_the_level_machine_returns_a_read_from_if() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("settings.json");
        std::fs::write(&path, "{ \"version\": 1, \"values\": {,} }").unwrap();

        let (machine, warning) = MachineSettings::open(&path);
        assert!(warning.is_some(), "il file rotto si dice");
        machine
            .declare(&[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()])
            .unwrap();

        let and = machine
            .set("log.verbose", SettingValue::Toggle(true))
            .expect_err("finché è rotto non lo si sovrascrive");
        assert!(format!("{and:?}").contains("non lo sovrascrive"), "{and:?}");

        std::fs::write(&path, "{ \"version\": 1, \"values\": {} }").unwrap();
        machine
            .set("log.verbose", SettingValue::Toggle(true))
            .expect("corretto il file, la scrittura non aspetta un riavvio");
        assert_eq!(
            machine.effective("log.verbose").unwrap().0,
            SettingValue::Toggle(true)
        );
    }

    /// **La stessa chiave scritta due volte non è un valore da scegliere**
    /// (difetto 0174).
    ///
    /// JSON permette di scriverla due volte e la libreria fa vincere l'ultima in
    /// silenzio: il file arriva da una mano o da una versione che numerava le
    /// chiavi in un altro modo, e la prima scrittura lo ricompone dalla mappa —
    /// dove di righe ne è rimasta una. Sparisce una riga di configurazione da un
    /// file che nessuno aveva detto all'utente di guardare, e non c'è un momento
    /// in cui lo scopre.
    #[test]
    fn a_key_written_two_times_not_is_resolves_from_if() {
        let (_tmp, dir) = tempdir();
        let path = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let a_hand = "{ \"version\": 1, \"values\": { \"a.b\": true, \"a.b\": false } }";
        std::fs::write(&path, a_hand).unwrap();

        let mut store = store_on(&dir);
        let warnings = store.take_warnings();
        assert_eq!(warnings.len(), 1, "il doppione si dice: {warnings:?}");
        assert!(
            warnings[0].contains("`a.b` è scritta due volte"),
            "e dice **quale**, che è l'unica cosa che serve per andare a \
             togliere la riga di troppo: {warnings:?}"
        );

        store
            .declare(
                "a",
                &[
                    SettingSpec::toggle("a.b", "B", false),
                    SettingSpec::toggle("a.c", "C", false),
                ],
            )
            .unwrap();
        store
            .set("a.c", SettingValue::Toggle(true))
            .expect_err("un file che non si capisce non lo si sovrascrive");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            a_hand,
            "una delle due righe è sparita, e a dirlo non è stato nessuno"
        );
    }

    /// E il livello della macchina la eredita senza che nessuno se ne ricordi:
    /// la regola sta in `load_from`, che è il solo posto in cui è scritto cosa
    /// vuol dire «illeggibile» (difetto 0174).
    #[test]
    fn also_the_level_machine_not_chooses_between_two_keys_equal() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            "{ \"version\": 1, \"values\": { \"log.verbose\": true, \"log.verbose\": false } }",
        )
        .unwrap();

        let (_machine, warning) = MachineSettings::open(&path);
        assert!(
            warning
                .expect("il doppione si dice anche qui")
                .contains("`log.verbose` è scritta due volte"),
            "e con il nome della chiave"
        );
    }

    /// `write_atomic` non lascia dietro di sé il temporaneo, e il nome che usa
    /// è unico: due scritture di fila non si contendono lo stesso `.tmp`.
    #[test]
    fn the_write_atomic_not_leaves_residue() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("stato.json");
        write_atomic(&path, b"{\"a\":1}").unwrap();
        write_atomic(&path, b"{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        let leftovers: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|and| and.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n != "stato.json")
            .collect();
        assert!(leftovers.is_empty(), "temporanei rimasti: {leftovers:?}");
    }
}
