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
/// Provenienza verificata della release installata, pubblicata nello stesso CAS
/// del manifest e del digest. Le installazioni manuali non ne hanno una.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogProvenance {
    /// Chiave attendibile che ha firmato il feed.
    pub key_id: String,
    /// Generazione firmata, in forma stringa anche oltre 2^53.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub generation: u64,
    /// Editore dichiarato nel feed firmato.
    pub publisher: String,
    /// Sorgente dichiarata dell'artefatto, mai aperta dallo store.
    pub url: String,
    /// Licenza dichiarata, informativa.
    pub license: String,
    /// Vincolo di compatibilità dichiarato.
    pub compatible: String,
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
    /// Assente per installazioni manuali; non concede capacità.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<CatalogProvenance>,
    /// Revoca firmata; nessun dato utente viene eliminato.
    #[serde(default)]
    pub revoked: bool,
    /// Feed che ha revocato questa release, distinto dal publisher originale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revocation: Option<CatalogProvenance>,
}

impl InstalledPlugin {
    /// La scelta permette di proporre il mount. Non certifica permessi,
    /// dipendenze, attivazione o presenza di un'istanza.
    pub fn requested_at_startup(&self) -> bool {
        self.enabled && !self.revoked && self.consent == Consent::Granted
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
        let bytes = self.read_candidate_bytes(source)?;
        self.install_bytes(base, &bytes, None)
    }

    /// I byte già verificati dal catalogo sono ricontrollati dal manifest qui,
    /// senza uno staging file modificabile fra verifica e pubblicazione.
    pub(crate) fn install_bytes(
        &self,
        base: &InventorySnapshot,
        bytes: &[u8],
        catalog: Option<CatalogProvenance>,
    ) -> Result<InstalledPlugin, InstallError> {
        self.ensure_base(base)?;
        let bundle = WasmBundle::from_bytes(bytes, Trust::Community)?;
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
            digest: Revision::of_bytes(bytes),
            enabled: false,
            consent: Consent::Undecided,
            catalog,
            revoked: false,
            revocation: None,
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
        self.publish_component(&path, bytes, plugin.installation)?;
        next.plugins.push(plugin.clone());
        self.commit(base, &next)?;
        Ok(plugin)
    }

    /// Sostituisce i byte di un'installazione esistente, senza montarla.
    ///
    /// La sorgente segue la stessa disciplina di [`Self::install`]: directory
    /// esplicita del chiamante, file regolare diretto, niente symlink o
    /// hardlink e nessuna scansione dei sibling. I byte candidati si leggono e
    /// verificano con `WasmBundle::from_bytes`, senza eseguire il guest.
    ///
    /// Il record mantiene la sua `installation`; manifest, digest e versione si
    /// aggiornano, `enabled` è preservato e `consent` torna sempre a
    /// [`Consent::Undecided`]: il consenso è legato a questi esatti byte e non
    /// si eredita fra digest diversi. L'id deve coincidere con quello del
    /// record (`Invalid` altrimenti), l'ABI deve restare compatibile e la
    /// versione deve differire (uguale → `AlreadyInstalled`, come in `install`).
    ///
    /// Il commit è CAS come in `install`: se fallisce, il nuovo blob resta
    /// orfano e invisibile all'inventario. Dopo un commit riuscito il vecchio
    /// blob si rimuove best-effort; se la pulizia fallisce resta un orfano
    /// invisibile, senza annullare l'aggiornamento già pubblicato.
    ///
    /// Il rollback è un update esplicito con la sorgente precedente salvata,
    /// manuale e controllato: prima di aggiornare, conservare i byte correnti
    /// (letti con [`Self::load`] o dal file della release precedente); per
    /// tornare indietro, chiamare `update` con quei byte. Anche il rollback
    /// azzera il consenso e preserva `enabled`: i byte precedenti vanno
    /// riapprovati come qualunque altra versione.
    /// Una revoca firmata non si cancella col percorso manuale: serve una
    /// release successiva in un feed firmato più recente della revoca.
    pub fn update(
        &self,
        base: &InventorySnapshot,
        installation: u64,
        source: &Utf8Path,
    ) -> Result<InstalledPlugin, InstallError> {
        let bytes = self.read_candidate_bytes(source)?;
        self.update_bytes(base, installation, &bytes, None)
    }

    /// Come `update`, con provenance firmata nello stesso commit atomico.
    pub(crate) fn update_bytes(
        &self,
        base: &InventorySnapshot,
        installation: u64,
        bytes: &[u8],
        catalog: Option<CatalogProvenance>,
    ) -> Result<InstalledPlugin, InstallError> {
        self.ensure_base(base)?;
        let current = base
            .plugins()
            .iter()
            .find(|plugin| plugin.installation == installation)
            .ok_or(InstallError::Missing(installation))?
            .clone();
        if current.revoked
            && catalog.as_ref().is_none_or(|candidate| {
                current
                    .revocation
                    .as_ref()
                    .is_none_or(|revocation| candidate.generation <= revocation.generation)
            })
        {
            return Err(InstallError::Invalid(
                "una release revocata richiede un feed firmato più recente della revoca".into(),
            ));
        }
        let bundle = WasmBundle::from_bytes(bytes, Trust::Community)?;
        let manifest = bundle.manifest();
        validate_manifest(&manifest)?;
        if manifest.id != current.manifest.id {
            return Err(InstallError::Invalid(format!(
                "l'aggiornamento non cambia l'identità: atteso `{}`, candidato `{}`",
                current.manifest.id, manifest.id
            )));
        }
        if manifest.version == current.manifest.version {
            return Err(InstallError::AlreadyInstalled {
                id: manifest.id,
                installed: current.manifest.version.clone(),
                candidate: manifest.version,
            });
        }
        self.ensure_base(base)?;
        let old_path = self.component_path(&current);
        let mut next = base.inventory.clone();
        let updated = {
            let record = record_mut(&mut next, installation)?;
            record.manifest = manifest;
            record.digest = Revision::of_bytes(bytes);
            record.consent = Consent::Undecided;
            record.catalog = catalog;
            record.revoked = false;
            record.revocation = None;
            record.clone()
        };
        let new_path = self.component_path(&updated);
        self.publish_component(&new_path, bytes, installation)?;
        self.commit(base, &next)?;
        if new_path != old_path {
            // Best-effort dopo un commit già pubblicato: un fallimento lascia
            // un blob orfano invisibile all'inventario, come i byte di
            // un'installazione fallita, senza annullare l'aggiornamento.
            let _ = self.storage.remove(&old_path);
        }
        Ok(updated)
    }

    /// Legge i byte candidati con la disciplina capability della sorgente:
    /// directory esplicita del chiamante, file regolare diretto, niente
    /// symlink o hardlink e nessuna scansione dei sibling.
    fn read_candidate_bytes(&self, source: &Utf8Path) -> Result<Vec<u8>, InstallError> {
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
        Ok(bytes)
    }

    /// Pubblica il blob sotto lock CAS senza mai reinterpretare un orfano:
    /// un contenuto preesistente diverso è `Integrity`, una corsa persa è
    /// `Conflict`. La scrittura rifiuta symlink, hardlink e target non regolari.
    fn publish_component(
        &self,
        path: &Utf8Path,
        bytes: &[u8],
        installation: u64,
    ) -> Result<(), InstallError> {
        let first = self
            .storage
            .write_if_unchanged(path, None, bytes)
            .map_err(|source| InstallError::Operation {
                operation: "publish-component",
                source,
            })?;
        if first == ConditionalWrite::Changed {
            let existing = match self.storage.read(path) {
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
            if existing.as_slice() != bytes {
                return Err(InstallError::Integrity(installation));
            }
            if self
                .storage
                .write_if_unchanged(path, Some(&existing), bytes)
                .map_err(|source| InstallError::Operation {
                    operation: "publish-component",
                    source,
                })?
                == ConditionalWrite::Changed
            {
                return Err(InstallError::Conflict);
            }
        }
        Ok(())
    }

    /// Revoca ed enabled=false sono un solo CAS: byte ritirati non ripartono
    /// tramite un toggle e nessun dato utente è toccato.
    pub(crate) fn revoke(
        &self,
        base: &InventorySnapshot,
        installation: u64,
        provenance: CatalogProvenance,
    ) -> Result<(), InstallError> {
        self.ensure_base(base)?;
        let mut next = base.inventory.clone();
        let record = record_mut(&mut next, installation)?;
        if record.revoked
            && record
                .revocation
                .as_ref()
                .is_some_and(|prior| provenance.generation <= prior.generation)
        {
            return Ok(());
        }
        record.revoked = true;
        record.revocation = Some(provenance);
        record.enabled = false;
        self.commit(base, &next)
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
        let record = record_mut(&mut next, installation)?;
        if enabled && record.revoked {
            return Err(InstallError::Invalid(
                "il componente è revocato: serve una nuova release firmata".into(),
            ));
        }
        record.enabled = enabled;
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
        if plugin.revoked != plugin.revocation.is_some() || (plugin.revoked && plugin.enabled) {
            return Err(InstallError::Invalid(
                "revoca incoerente con provenance o abilitazione".into(),
            ));
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
