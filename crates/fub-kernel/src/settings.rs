//! Lo **store di configurazione** (§11.1): chi tiene gli schemi dichiarati, i
//! valori scritti e la regola con cui i due si incontrano.
//!
//! # Un posto solo, e un'eccezione che si dichiara
//!
//! Un valore sta nel file del **vault** (`<root>/.fub/settings.json`), e basta:
//! è la [0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md),
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
//! [0100](../../../docs/decisions/README.md).
//!
//! Una sola cosa la decide questo modulo, perché è l'unico a saperla: **scrivere
//! una chiave sospesa la risveglia**. Chi scrive è una persona davanti al
//! pannello, e lasciare sospeso ciò che ha appena battuto vorrebbe dire un
//! valore nel file che nessuno leggerà mai — che è precisamente ciò che la 0076
//! esiste per non avere.
//!
//! [0077]: ../../../docs/decisions/README.md
//!
//! # Perché non è uno spazio chiave→valore
//!
//! Perché le chiavi le dichiara qualcuno: una chiave fuori schema non si legge e
//! non si scrive, e ciò che il file contiene senza che nessuno lo dichiari resta
//! lì senza essere letto. È la differenza con lo `storage_*` che la
//! [decisione 0013](../../../docs/decisions/0185-capability-un-solo-guard.md) ha
//! tolto, ed è ciò che rende questo store una **configurazione** invece di un
//! database di comodo.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::{SettingEntry, SettingScope, SettingSource, SettingSpec, SettingValue};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

use crate::poison::Shelter;
use crate::storage::{do_not_overwrite, update_atomic, Durable, VaultStorage};
use fub_abi::schema::SchemaVersion;

mod machine;
mod persist;
mod store;

pub(crate) use machine::MachineSettingRevision;
pub use machine::MachineSettings;
use persist::{
    change_vault_profiles, encode, load_from, load_raw_from, store, store_vault, supported_values,
    undeclared, LOSS,
};
pub use store::SettingsStore;

/// La cartella in cui la shell deposita e cerca gli allegati del vault.
///
/// La chiave è dichiarata dal bundle core (`fub-host`) ma il kernel la legge
/// quando risolve un wikilink a un allegato.
pub const ATTACHMENT_FOLDER: &str = "files.attachment-folder";
/// Cartella predefinita per le note create senza un path esplicito.
///
/// Il valore vuoto significa radice del vault. La chiave è dichiarata dal
/// bundle core; il kernel la applica insieme alla scelta del nome, sotto la
/// custodia esclusiva del workspace.
pub const NEW_NOTE_FOLDER: &str = "files.new-note-folder";
/// L'estensione di una nota creata senza estensione.
///
/// La dichiara il bundle core. La leggono il kernel, quando crea una nota
/// senza nome completo, e le feature che nominano note nuove: una regola sola
/// invece di due convenzioni. Vale solo se un provider la rivendica.
pub const NEW_NOTE_EXTENSION: &str = "files.new-note-extension";

/// La versione di schema del file (§15.3): un numero scritto **dal primo
/// giorno**, perché il file che non ce l'ha è quello che poi non si sa da che
/// versione viene.
pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(2);

/// Il file di un livello, com'è su disco.
#[derive(Clone, Default, Serialize, Deserialize)]
struct SettingsFile {
    version: SchemaVersion,
    #[serde(default, deserialize_with = "values_without_duplicates")]
    values: BTreeMap<String, serde_json::Value>,
    #[serde(default = "default_profile_name")]
    active_profile: String,
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "unique_map"
    )]
    active_profile_extra: BTreeMap<String, serde_json::Value>,
    #[serde(default, deserialize_with = "unique_map")]
    profiles: BTreeMap<String, SettingsProfile>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

fn default_profile_name() -> String {
    "Default".into()
}

/// Portable snapshot. Unknown keys and values remain JSON, never coerced into a SettingKind.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingsProfile {
    pub version: SchemaVersion,
    pub name: String,
    #[serde(deserialize_with = "unique_map")]
    pub values: BTreeMap<String, serde_json::Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn check_profile(profile: &SettingsProfile) -> Result<(), String> {
    if profile.version > SCHEMA_VERSION {
        return Err(format!(
            "profile version {} is newer than supported {SCHEMA_VERSION}",
            profile.version
        ));
    }
    if profile.name.trim().is_empty() || profile.name != profile.name.trim() {
        return Err("profile name must not be empty or padded".into());
    }
    Ok(())
}

impl SettingsFile {
    fn profile(&self, name: &str) -> Option<SettingsProfile> {
        if name == self.active_profile {
            Some(SettingsProfile {
                version: SCHEMA_VERSION,
                name: name.into(),
                values: self.values.clone(),
                extra: self.active_profile_extra.clone(),
            })
        } else {
            self.profiles.get(name).cloned()
        }
    }

    fn switch_profile(&mut self, name: &str) -> Result<(), String> {
        if name == self.active_profile {
            return Ok(());
        }
        let target = self
            .profiles
            .remove(name)
            .ok_or_else(|| format!("unknown profile `{name}`"))?;
        check_profile(&target)?;
        let previous = self
            .profile(&self.active_profile)
            .ok_or_else(|| "active profile is missing".to_string())?;
        self.profiles.insert(self.active_profile.clone(), previous);
        self.values = target.values;
        self.active_profile_extra = target.extra;
        self.active_profile = name.into();
        Ok(())
    }
}

fn profile_names(file: &SettingsFile) -> Vec<String> {
    let mut names: Vec<String> = file.profiles.keys().cloned().collect();
    names.push(file.active_profile.clone());
    names.sort();
    names
}

fn add_profile(file: &mut SettingsFile, profile: SettingsProfile) -> Result<(), String> {
    check_profile(&profile)?;
    if file.profile(&profile.name).is_some() {
        return Err(format!("profile `{}` already exists", profile.name));
    }
    file.profiles.insert(profile.name.clone(), profile);
    Ok(())
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
fn values_without_duplicates<'de, D>(d: D) -> Result<BTreeMap<String, serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    unique_map(d)
}

/// La stessa regola per ogni mappa del file, non soltanto per i valori attivi:
/// un profilo inattivo con una chiave scritta due volte, o due profili con lo
/// stesso nome, sparirebbero alla prima riscrittura senza che nessuno l'abbia
/// scelto (difetto 0170).
fn unique_map<'de, D, V>(d: D) -> Result<BTreeMap<String, V>, D::Error>
where
    D: serde::Deserializer<'de>,
    V: serde::Deserialize<'de>,
{
    use serde::de::{MapAccess, Visitor};
    struct Unique<V>(std::marker::PhantomData<V>);
    impl<'de, V: serde::Deserialize<'de>> Visitor<'de> for Unique<V> {
        type Value = BTreeMap<String, V>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a map with unique keys")
        }
        fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, V>()? {
                if result.insert(key.clone(), value).is_some() {
                    return Err(serde::de::Error::custom(format!(
                        "`{key}` è scritta due volte"
                    )));
                }
            }
            Ok(result)
        }
    }
    d.deserialize_map(Unique(std::marker::PhantomData))
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
mod tests;
