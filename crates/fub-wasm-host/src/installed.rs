//! Componenti installati e scelte della macchina, separati dal mount.
//!
//! La shell consegna una directory di configurazione già esistente. Dopo il
//! bootstrap ogni accesso è relativo alla sua capability. Solo l'inventario
//! pubblicato è autorevole: file temporanei e blob orfani non sono candidati.

use std::collections::BTreeSet;
use std::io::{self, Read as _};
use std::sync::atomic::{AtomicU64, Ordering};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::schema::SchemaVersion;
use fub_abi::traits::{abi_compatible, PluginManifest};
use fub_host::registry::Bundle;
use fub_kernel::{ConditionalWrite, RootedFsStorage, Trust, VaultStorage};
use serde::{Deserialize, Serialize};

use crate::{LoadError, WasmBundle};

const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);
const DIRECTORY: &str = "wasm-plugins";
const INVENTORY: &str = "inventory.json";
static STORE_IDS: AtomicU64 = AtomicU64::new(1);

/// Consenso all'esecuzione di questi esatti byte, non concessione di capability.
/// Le capability effettive continuano a passare dal `Guard` del kernel.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Consent {
    /// Nessuna decisione: l'host non deve montare il componente.
    #[default]
    Undecided,
    /// Esecuzione rifiutata esplicitamente.
    Denied,
    /// Esecuzione approvata; i permessi restano una decisione separata.
    Granted,
}

/// Un'installazione persistita. Non rappresenta un'istanza montata.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InstalledPlugin {
    /// Identità monotona dell'installazione; non viene riusata dopo la rimozione.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub installation: u64,
    /// Manifest letto dal componente in sandbox prima della pubblicazione.
    pub manifest: PluginManifest,
    /// Impronta SHA-256 degli esatti byte installati.
    pub digest: Revision,
    /// Scelta persistente della persona, indipendente dallo stato runtime.
    pub enabled: bool,
    /// Consenso legato a questa installazione e al suo digest.
    pub consent: Consent,
}

impl InstalledPlugin {
    /// La scelta permette di proporre il mount. Non certifica permessi,
    /// dipendenze, attivazione o presenza di un'istanza.
    pub fn requested_at_startup(&self) -> bool {
        self.enabled && self.consent == Consent::Granted
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Inventory {
    schema_version: SchemaVersion,
    #[serde(with = "fub_abi::ipc::u64_string")]
    next_installation: u64,
    plugins: Vec<InstalledPlugin>,
}

impl Default for Inventory {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            next_installation: 1,
            plugins: Vec::new(),
        }
    }
}

/// Fotografia e revisione base per una scelta esplicita della shell.
/// Una mutazione usa gli stessi byte come precondizione CAS.
#[derive(Debug)]
pub struct InventorySnapshot {
    store_id: u64,
    bytes: Option<Vec<u8>>,
    inventory: Inventory,
}

impl InventorySnapshot {
    /// Record in ordine di installazione, comprese le scelte disabilitate.
    pub fn plugins(&self) -> &[InstalledPlugin] {
        &self.inventory.plugins
    }
}

/// Errore tipizzato senza conversione degli errori I/O in semplici stringhe.
#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    /// Accesso alla capability o scrittura falliti.
    #[error("accesso allo store plugin fallito: {0}")]
    Io(#[from] io::Error),
    /// Operazione fallita dopo il bootstrap, con errore I/O originale.
    #[error("{operation}: {source}")]
    Operation {
        /// Operazione che possiede il fallimento.
        operation: &'static str,
        /// Errore del filesystem, con specie e codice OS preservati.
        source: io::Error,
    },
    /// Componente non compilabile, non collegabile o manifest non traducibile.
    #[error(transparent)]
    Component(#[from] LoadError),
    /// JSON non leggibile: lo stato precedente non viene sostituito.
    #[error("inventario plugin non leggibile: {0}")]
    Json(#[from] serde_json::Error),
    /// Schema sconosciuto, anche se il JSON è sintatticamente valido.
    #[error("schema inventario {0} non supportato")]
    Schema(u32),
    /// Invariante del manifest o dell'inventario violata.
    #[error("inventario o manifest non valido: {0}")]
    Invalid(String),
    /// La regola ABI condivisa rifiuta la versione dichiarata.
    #[error("ABI `{0}` non supportata")]
    Abi(String),
    /// Lo stesso plugin è già installato; non viene scelto un vincitore.
    #[error("plugin `{id}` già installato: versione `{installed}`, candidato `{candidate}`")]
    AlreadyInstalled {
        /// Id conteso.
        id: String,
        /// Versione già presente.
        installed: String,
        /// Versione proposta.
        candidate: String,
    },
    /// Un altro writer ha cambiato l'inventario dalla fotografia fornita.
    #[error("inventario cambiato: rileggere prima di decidere")]
    Conflict,
    /// L'installazione richiesta non appartiene alla fotografia.
    #[error("installazione {0} assente")]
    Missing(u64),
    /// Blob diverso da quello verificato all'installazione.
    #[error("componente dell'installazione {0} alterato")]
    Integrity(u64),
}

/// Risultato della rimozione già pubblicata nell'inventario.
#[derive(Debug)]
pub struct Removal {
    /// Installazione ritirata; nessun dato del vault viene rimosso.
    pub removed: InstalledPlugin,
    /// Se presente, resta un blob eseguibile orfano, invisibile all'inventario.
    /// L'errore non trasforma la rimozione già committata in un fallimento ambiguo.
    pub cleanup_error: Option<io::Error>,
}
/// Byte di un'installazione verificati contro digest e inventario, senza
/// compilare o eseguire il guest.
pub struct LoadedPlugin {
    installed: InstalledPlugin,
    bytes: Vec<u8>,
}

impl LoadedPlugin {
    /// Record autorevole a cui appartengono questi byte.
    pub fn installed(&self) -> &InstalledPlugin {
        &self.installed
    }

    /// Esatti byte verificati del componente.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Valida esplicitamente componente e manifest e produce il bundle.
    ///
    /// Questa è un'operazione attiva: può istanziare il guest per leggerne il
    /// manifest. Listing e [`InstalledPluginStore::load`] non la invocano.
    pub fn validate(&self) -> Result<WasmBundle, InstallError> {
        let bundle = WasmBundle::from_bytes(&self.bytes, Trust::Community)?;
        if bundle.manifest() != self.installed.manifest {
            return Err(InstallError::Integrity(self.installed.installation));
        }
        Ok(bundle)
    }
}

/// Store di una macchina; non conosce né possiede workspace o istanze montate.
pub struct InstalledPluginStore {
    id: u64,
    storage: RootedFsStorage,
    directory: Utf8PathBuf,
}

impl InstalledPluginStore {
    /// Apre la capability della configurazione scelta dalla shell.
    /// La directory deve esistere; nessuna posizione viene dedotta dal guest.
    pub fn open(config: &Utf8Path) -> Result<Self, InstallError> {
        Ok(Self {
            id: STORE_IDS.fetch_add(1, Ordering::Relaxed),
            storage: RootedFsStorage::open(config)?,
            directory: config.join(DIRECTORY),
        })
    }

    fn inventory_path(&self) -> Utf8PathBuf {
        self.directory.join(INVENTORY)
    }

    fn component_path(&self, plugin: &InstalledPlugin) -> Utf8PathBuf {
        // L'id guest non diventa mai un percorso. Il contatore non viene
        // riusato: il cleanup di una rimozione non può eliminare una reinstallazione.
        self.directory.join("components").join(format!(
            "{}-{}.wasm",
            plugin.installation,
            plugin.digest.0.trim_start_matches("sha256:")
        ))
    }

    /// Rilegge lo stato autorevole. Assenza è vuoto, errori e corruzione no.
    pub fn snapshot(&self) -> Result<InventorySnapshot, InstallError> {
        let bytes = match self.storage.read(&self.inventory_path()) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let inventory = match &bytes {
            Some(bytes) => {
                let mut ignored = Vec::new();
                let mut deserializer = serde_json::Deserializer::from_slice(bytes);
                let inventory: Inventory = serde_ignored::deserialize(&mut deserializer, |path| {
                    ignored.push(path.to_string());
                })?;
                deserializer.end()?;
                if inventory.schema_version != SCHEMA_VERSION {
                    return Err(InstallError::Schema(inventory.schema_version.number()));
                }
                if !ignored.is_empty() {
                    return Err(InstallError::Invalid(format!(
                        "campi sconosciuti nell'inventario: {}",
                        ignored.join(", ")
                    )));
                }
                inventory
            }
            None => Inventory::default(),
        };
        validate_inventory(&inventory)?;
        Ok(InventorySnapshot {
            store_id: self.id,
            bytes,
            inventory,
        })
    }

    /// Installa un singolo componente, senza montarlo. La sorgente viene
    /// letta tramite la capability del genitore autorizzato dal chiamante.
    /// Un id presente richiede rimozione esplicita: nessun upgrade implicito.
    pub fn install(
        &self,
        base: &InventorySnapshot,
        source: &Utf8Path,
    ) -> Result<InstalledPlugin, InstallError> {
        self.ensure_base(base)?;
        let parent = source
            .parent()
            .filter(|p| !p.as_str().is_empty())
            .ok_or_else(|| {
                InstallError::Invalid(
                    "la sorgente richiede un percorso con directory esplicita".into(),
                )
            })?;
        let input = cap_std::fs::Dir::open_ambient_dir(parent, cap_std::ambient_authority())?;
        let name = source
            .file_name()
            .ok_or_else(|| InstallError::Invalid("sorgente senza nome".into()))?;
        let metadata = input
            .symlink_metadata(name)
            .map_err(|source| InstallError::Operation {
                operation: "source-metadata",
                source,
            })?;
        if !metadata.is_file() {
            return Err(InstallError::Invalid(
                "la sorgente non è un file regolare diretto".into(),
            ));
        }
        // Nessuna scansione dei sibling: un nome o un file concorrente non
        // pertinente non può cambiare l'esito della sorgente scelta.
        let mut file = input.open(name).map_err(|source| InstallError::Operation {
            operation: "source-open",
            source,
        })?;
        if !file.metadata()?.is_file() {
            return Err(InstallError::Invalid(
                "la sorgente aperta non è un file regolare".into(),
            ));
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|source| InstallError::Operation {
                operation: "source-read",
                source,
            })?;
        let bundle = WasmBundle::from_bytes(&bytes, Trust::Community)?;
        let manifest = bundle.manifest();
        validate_manifest(&manifest)?;
        if let Some(existing) = base.plugins().iter().find(|p| p.manifest.id == manifest.id) {
            return Err(InstallError::AlreadyInstalled {
                id: manifest.id,
                installed: existing.manifest.version.clone(),
                candidate: manifest.version,
            });
        }
        self.ensure_base(base)?;
        let mut next = base.inventory.clone();
        let plugin = InstalledPlugin {
            installation: next.next_installation,
            manifest,
            digest: Revision::of_bytes(&bytes),
            enabled: false,
            consent: Consent::Undecided,
        };
        next.next_installation = next
            .next_installation
            .checked_add(1)
            .ok_or_else(|| InstallError::Invalid("identità delle installazioni esaurite".into()))?;
        // Anche un blob orfano è preservato se non corrisponde esattamente.
        // Se invece coincide, una seconda CAS con quei byte come precondizione
        // passa comunque dalla scrittura normale: è lei a rifiutare symlink,
        // hardlink e target non regolari prima di sostituire l'orfano sicuro.
        let path = self.component_path(&plugin);
        let first = self
            .storage
            .write_if_unchanged(&path, None, &bytes)
            .map_err(|source| InstallError::Operation {
                operation: "publish-component",
                source,
            })?;
        if first == ConditionalWrite::Changed {
            let existing = match self.storage.read(&path) {
                Ok(existing) => existing,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Err(InstallError::Conflict);
                }
                Err(source) => {
                    return Err(InstallError::Operation {
                        operation: "publish-component",
                        source,
                    });
                }
            };
            if existing != bytes {
                return Err(InstallError::Integrity(plugin.installation));
            }
            if self
                .storage
                .write_if_unchanged(&path, Some(&existing), &bytes)
                .map_err(|source| InstallError::Operation {
                    operation: "publish-component",
                    source,
                })?
                == ConditionalWrite::Changed
            {
                return Err(InstallError::Conflict);
            }
        }
        next.plugins.push(plugin.clone());
        self.commit(base, &next)?;
        Ok(plugin)
    }

    /// Aggiorna soltanto la scelta enabled; non rappresenta un mount riuscito.
    pub fn set_enabled(
        &self,
        base: &InventorySnapshot,
        installation: u64,
        enabled: bool,
    ) -> Result<(), InstallError> {
        self.ensure_base(base)?;
        let mut next = base.inventory.clone();
        record_mut(&mut next, installation)?.enabled = enabled;
        self.commit(base, &next)
    }

    /// Registra il consenso all'esecuzione per l'identità installata esatta.
    /// Non modifica le impostazioni macchina dei permessi del kernel.
    pub fn set_consent(
        &self,
        base: &InventorySnapshot,
        installation: u64,
        consent: Consent,
    ) -> Result<(), InstallError> {
        self.ensure_base(base)?;
        let mut next = base.inventory.clone();
        record_mut(&mut next, installation)?.consent = consent;
        self.commit(base, &next)
    }

    /// Legge gli esatti byte e ne verifica il digest senza compilare,
    /// istanziare o chiamare il guest. Non decide consenso o mount.
    pub fn load(&self, plugin: &InstalledPlugin) -> Result<LoadedPlugin, InstallError> {
        let current = self.snapshot()?;
        let actual = current
            .plugins()
            .iter()
            .find(|p| p.installation == plugin.installation)
            .ok_or(InstallError::Missing(plugin.installation))?;
        if actual != plugin {
            return Err(InstallError::Conflict);
        }
        let bytes = self.storage.read(&self.component_path(actual))?;
        if Revision::of_bytes(&bytes) != actual.digest {
            return Err(InstallError::Integrity(actual.installation));
        }
        Ok(LoadedPlugin {
            installed: actual.clone(),
            bytes,
        })
    }

    /// Ritira la voce prima di eliminare il suo blob. Il chiamante deve aver
    /// completato il teardown delle istanze: questo store non ne possiede.
    /// I dati `.fub/plugins/<id>` non sono mai nominati né eliminati qui.
    pub fn remove(
        &self,
        base: &InventorySnapshot,
        installation: u64,
    ) -> Result<Removal, InstallError> {
        self.ensure_base(base)?;
        let mut next = base.inventory.clone();
        let index = next
            .plugins
            .iter()
            .position(|p| p.installation == installation)
            .ok_or(InstallError::Missing(installation))?;
        let removed = next.plugins.remove(index);
        self.commit(base, &next)?;
        let cleanup_error = match self.storage.remove(&self.component_path(&removed)) {
            Ok(()) => None,
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => Some(error),
        };
        Ok(Removal {
            removed,
            cleanup_error,
        })
    }

    fn ensure_base(&self, base: &InventorySnapshot) -> Result<(), InstallError> {
        if self.id != base.store_id {
            return Err(InstallError::Conflict);
        }
        Ok(())
    }

    fn commit(&self, base: &InventorySnapshot, inventory: &Inventory) -> Result<(), InstallError> {
        let bytes = serde_json::to_vec_pretty(inventory)?;
        match self
            .storage
            .write_if_unchanged(&self.inventory_path(), base.bytes.as_deref(), &bytes)
            .map_err(|source| InstallError::Operation {
                operation: "publish-inventory",
                source,
            })? {
            ConditionalWrite::Written(_) => Ok(()),
            ConditionalWrite::Changed => Err(InstallError::Conflict),
        }
    }
}

fn record_mut(
    inventory: &mut Inventory,
    installation: u64,
) -> Result<&mut InstalledPlugin, InstallError> {
    inventory
        .plugins
        .iter_mut()
        .find(|p| p.installation == installation)
        .ok_or(InstallError::Missing(installation))
}

fn validate_inventory(inventory: &Inventory) -> Result<(), InstallError> {
    let mut identities = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for plugin in &inventory.plugins {
        if plugin.installation == 0
            || plugin.installation >= inventory.next_installation
            || !identities.insert(plugin.installation)
            || !ids.insert(&plugin.manifest.id)
        {
            return Err(InstallError::Invalid(
                "identità duplicate o contatore incoerente".into(),
            ));
        }
        let digest = plugin.digest.0.strip_prefix("sha256:").unwrap_or_default();
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err(InstallError::Invalid("digest non canonico".into()));
        }
        validate_manifest(&plugin.manifest)?;
    }
    if inventory.next_installation == 0 {
        return Err(InstallError::Invalid("contatore nullo".into()));
    }
    Ok(())
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), InstallError> {
    if !abi_compatible(&manifest.abi_version) {
        return Err(InstallError::Abi(manifest.abi_version.clone()));
    }
    if manifest.id.is_empty()
        || manifest.id.contains(':')
        || manifest.name.is_empty()
        || manifest.version.is_empty()
    {
        return Err(InstallError::Invalid(
            "id, nome o versione non validi".into(),
        ));
    }
    let owner = fub_abi::rules::ids::Owner::Plugin(&manifest.id);
    for name in manifest
        .provides
        .iter()
        .chain(manifest.settings.iter().map(|s| &s.key))
    {
        fub_abi::rules::ids::check(name, owner)
            .map_err(|error| InstallError::Invalid(error.to_string()))?;
    }
    let mut settings = BTreeSet::new();
    for spec in &manifest.settings {
        if !settings.insert(&spec.key) || fub_abi::settings::permission_of_key(&spec.key).is_some()
        {
            return Err(InstallError::Invalid(
                "impostazione duplicata o riservata ai permessi".into(),
            ));
        }
    }
    let mut timers = BTreeSet::new();
    if manifest
        .timers
        .iter()
        .any(|timer| timer.id.is_empty() || !timers.insert(&timer.id))
    {
        return Err(InstallError::Invalid("timer vuoto o duplicato".into()));
    }
    Ok(())
}
