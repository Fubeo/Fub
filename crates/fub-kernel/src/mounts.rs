//! Mount esterni espliciti: configurazione autorevole, validazione e routing recintato.

use std::collections::BTreeMap;
use std::io;

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};
use fub_abi::rules::path_policy;

use crate::error::{KernelError, Result};
use crate::storage::{EntryKind, FileIdentity, VaultStorage};
use crate::vault::FUB_DIR;

pub const MOUNTS_SCHEMA_VERSION: u32 = 1;
pub const MOUNTS_FILE: &str = "mounts.json";

/// Il nome del mount è locale al vault; il namespace è l'identità stabile della rotta.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalMount {
    pub name: String,
    pub target: Utf8PathBuf,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MountRoute {
    pub name: String,
    pub namespace: String,
    pub target: Utf8PathBuf,
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct MountDiagnostic {
    pub name: String,
    pub target: Utf8PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredMount {
    mount: ExternalMount,
    identity: FileIdentity,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct MountDocument {
    schema: u32,
    mounts: Vec<StoredMount>,
}

/// In memoria ci sono solo le rotte che il backend ha rivalidato.
/// In memoria vengono pubblicate solo le rotte rivalidate. Le configurazioni
/// temporaneamente irraggiungibili restano inattive e diagnosticate: un disco
/// esterno scollegato non impedisce di aprire il vault e non viene dimenticato.
#[derive(Debug, Clone)]
pub struct MountRegistry {
    root: Utf8PathBuf,
    mounts: BTreeMap<String, ExternalMount>,
    identities: BTreeMap<String, FileIdentity>,
    inactive: BTreeMap<String, ExternalMount>,
    diagnostics: Vec<MountDiagnostic>,
}

fn bad_label(what: &str, value: &str) -> KernelError {
    KernelError::BadName {
        name: value.to_string(),
        why: format!("{what}: vuoto, con slash o `.`/`..` non e un nome di mount"),
    }
}

fn check_label(what: &str, value: &str) -> Result<()> {
    if value.trim().is_empty()
        || value.trim() != value
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
    {
        return Err(bad_label(what, value));
    }
    Ok(())
}

fn overlaps(a: &Utf8Path, b: &Utf8Path) -> bool {
    a == b || a.starts_with(b) || b.starts_with(a)
}

fn non_normalized(target: &Utf8Path) -> bool {
    !target.is_absolute()
        || target
            .as_str()
            .split(&['/', '\\'][..])
            .any(|part| part == "." || part == "..")
        || target.as_str().contains("//")
        || (target.as_str().ends_with('/') && target.as_str() != "/")
        || target
            .components()
            .any(|part| matches!(part, Utf8Component::CurDir | Utf8Component::ParentDir))
}

/// Ispeziona ogni componente del nome assoluto attraverso lo stesso supporto
/// che farà stat e I/O. Nessuna risposta del filesystem ambientale può quindi
/// divergere dal backend montato. `NotFound` è lasciato alla validazione finale.
fn reject_symlink_components(storage: &dyn VaultStorage, target: &Utf8Path) -> Result<()> {
    if non_normalized(target) {
        return Err(KernelError::BadName {
            name: target.to_string(),
            why: "il target deve essere assoluto e normalizzato, senza `.` o `..`".into(),
        });
    }
    let mut prefix = Utf8PathBuf::new();
    for component in target.components() {
        prefix.push(component.as_str());
        // `C:` è la cartella corrente di quel disco e `\\?\C:` il volume:
        // nessuno dei due è un componente che un link possa sostituire.
        if matches!(component, Utf8Component::Prefix(_)) {
            continue;
        }
        match storage.stat_no_follow(&prefix) {
            Ok(stat) if stat.kind == EntryKind::Other => {
                return Err(KernelError::Io {
                    path: prefix,
                    source: io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "symlink o reparse point nel target o in un antenato",
                    ),
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(source) => {
                return Err(KernelError::Io {
                    path: prefix,
                    source,
                })
            }
        }
    }
    Ok(())
}

fn identity_of(storage: &dyn VaultStorage, path: &Utf8Path) -> Result<FileIdentity> {
    storage
        .file_identity(path)
        .map_err(|source| KernelError::Io {
            path: path.to_owned(),
            source,
        })?
        .ok_or_else(|| KernelError::Io {
            path: path.to_owned(),
            source: io::Error::new(
                io::ErrorKind::Unsupported,
                "backend senza FileIdentity: mount rifiutato",
            ),
        })
}

fn refused_link(path: &Utf8Path, why: &str) -> KernelError {
    KernelError::Io {
        path: path.to_owned(),
        source: io::Error::new(io::ErrorKind::PermissionDenied, why.to_string()),
    }
}

/// Il nome reale della cartella scelta: gli antenati si risolvono, la cartella
/// no.
///
/// Un antenato che è un collegamento è quasi sempre del sistema (`/var` →
/// `/private/var` su macOS, `/tmp`, un profilo spostato): risolverlo una volta
/// lascia al controllo severo di [`MountRegistry::mount`] un nome che non ne
/// contiene. La cartella scelta che è essa stessa un collegamento, invece, è un
/// reindirizzamento deciso da chi controlla il link, e resta rifiutata anche
/// se penzola. Il nome reale della foglia porta comunque le maiuscole del
/// disco, così il confronto con la radice non si inganna su un filesystem
/// insensibile al caso.
fn real_target(storage: &dyn VaultStorage, chosen: &Utf8Path) -> Result<Utf8PathBuf> {
    if non_normalized(chosen) {
        return Err(KernelError::BadName {
            name: chosen.to_string(),
            why: "il target deve essere assoluto e normalizzato, senza `.` o `..`".into(),
        });
    }
    let io_at = |path: &Utf8Path, source| KernelError::Io {
        path: path.to_owned(),
        source,
    };
    let (Some(parent), Some(leaf)) = (chosen.parent(), chosen.file_name()) else {
        return storage
            .real_path(chosen)
            .map_err(|source| io_at(chosen, source));
    };
    let real_parent = storage
        .real_path(parent)
        .map_err(|source| io_at(parent, source))?;
    let in_place = real_parent.join(leaf);
    match storage.stat_no_follow(&in_place) {
        Ok(stat) if stat.kind == EntryKind::Other => {
            return Err(refused_link(
                chosen,
                "la cartella scelta è un symlink o un reparse point",
            ))
        }
        Ok(_) => {}
        Err(source) => return Err(io_at(chosen, source)),
    }
    let real = storage
        .real_path(&in_place)
        .map_err(|source| io_at(chosen, source))?;
    // Fra lo stat e la risoluzione la cartella può essere stata sostituita da
    // un link: il nome reale non starebbe più sotto lo stesso genitore.
    if real.parent() != Some(real_parent.as_path()) {
        return Err(refused_link(
            chosen,
            "la cartella scelta è cambiata durante la risoluzione",
        ));
    }
    Ok(real)
}

fn invalid_doc(config: &Utf8Path, error: impl std::fmt::Display) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("{config}: registro mount invalido, non sovrascritto: {error}"),
    )
}

fn decode(raw: &[u8], config: &Utf8Path) -> io::Result<Vec<StoredMount>> {
    let doc: MountDocument = serde_json::from_slice(raw).map_err(|e| invalid_doc(config, e))?;
    if doc.schema != MOUNTS_SCHEMA_VERSION {
        return Err(invalid_doc(
            config,
            format!("schema {} non supportato", doc.schema),
        ));
    }
    let root = config
        .parent()
        .and_then(Utf8Path::parent)
        .ok_or_else(|| invalid_doc(config, "path config senza radice"))?;
    let mut names = BTreeMap::new();
    let mut namespaces = std::collections::BTreeSet::new();
    for entry in &doc.mounts {
        let mount = &entry.mount;
        check_label("nome mount", &mount.name).map_err(|e| invalid_doc(config, e))?;
        check_label("namespace", &mount.namespace).map_err(|e| invalid_doc(config, e))?;
        if non_normalized(&mount.target)
            || overlaps(&mount.target, root)
            || names.insert(&mount.name, ()).is_some()
            || !namespaces.insert(&mount.namespace)
        {
            return Err(invalid_doc(
                config,
                "target non normalizzato, nome o namespace duplicato",
            ));
        }
    }
    for (i, a) in doc.mounts.iter().enumerate() {
        if doc.mounts[i + 1..]
            .iter()
            .any(|b| overlaps(&a.mount.target, &b.mount.target) || a.identity == b.identity)
        {
            return Err(invalid_doc(config, "target sovrapposti o identita alias"));
        }
    }
    Ok(doc.mounts)
}

fn encode(
    entries: impl IntoIterator<Item = StoredMount>,
    config: &Utf8Path,
) -> io::Result<Vec<u8>> {
    serde_json::to_vec_pretty(&MountDocument {
        schema: MOUNTS_SCHEMA_VERSION,
        mounts: entries.into_iter().collect(),
    })
    .map_err(|e| invalid_doc(config, e))
}

impl MountRegistry {
    pub fn new(root: &Utf8Path) -> Self {
        Self {
            root: root.to_owned(),
            mounts: BTreeMap::new(),
            identities: BTreeMap::new(),
            inactive: BTreeMap::new(),
            diagnostics: Vec::new(),
        }
    }

    pub fn config_path(root: &Utf8Path) -> Utf8PathBuf {
        root.join(FUB_DIR).join(MOUNTS_FILE)
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }
    pub fn get(&self, name: &str) -> Option<&ExternalMount> {
        self.mounts.get(name)
    }
    pub fn len(&self) -> usize {
        self.mounts.len()
    }
    pub fn is_empty(&self) -> bool {
        self.mounts.is_empty()
    }
    pub fn diagnostics(&self) -> &[MountDiagnostic] {
        &self.diagnostics
    }
    pub fn is_configured(&self, name: &str) -> bool {
        self.mounts.contains_key(name) || self.inactive.contains_key(name)
    }

    /// L'ingresso di chi sceglie una cartella: la risolve al suo nome reale
    /// ([`real_target`]), la prepara con [`mount`](Self::mount) e restituisce
    /// il nome che verrà salvato. Da lì in poi ogni controllo è severo.
    pub fn register(
        &mut self,
        storage: &dyn VaultStorage,
        name: &str,
        chosen: &Utf8Path,
        namespace: &str,
    ) -> Result<Utf8PathBuf> {
        let real = real_target(storage, chosen)?;
        self.mount(storage, name, &real, namespace)?;
        Ok(real)
    }

    /// Prepara senza pubblicare: nessuna route finché il commit non riesce.
    ///
    /// Il target è già reale: un collegamento in un suo componente lo fa
    /// rifiutare. È il controllo che [`load`](Self::load) ripete a ogni
    /// apertura.
    pub fn mount(
        &mut self,
        storage: &dyn VaultStorage,
        name: &str,
        target: &Utf8Path,
        namespace: &str,
    ) -> Result<()> {
        check_label("nome mount", name)?;
        check_label("namespace", namespace)?;
        if self.mounts.contains_key(name) || self.inactive.contains_key(name) {
            return Err(KernelError::AlreadyExists(name.to_string()));
        }
        if self
            .mounts
            .values()
            .chain(self.inactive.values())
            .any(|mount| mount.namespace == namespace)
        {
            return Err(KernelError::AlreadyExists(namespace.to_string()));
        }
        if self
            .mounts
            .values()
            .chain(self.inactive.values())
            .any(|mount| overlaps(target, &mount.target))
        {
            return Err(KernelError::OutsideVault(target.to_owned()));
        }
        reject_symlink_components(storage, target)?;
        // La radice può arrivare in una forma e il target nell'altra (`/var`
        // e `/private/var`, `C:\` e `\\?\C:\`): il recinto vale per entrambe.
        let real_root = storage
            .real_path(&self.root)
            .unwrap_or_else(|_| self.root.clone());
        if [&self.root, &real_root]
            .into_iter()
            .any(|root| overlaps(target, root) || target.starts_with(root.join(FUB_DIR)))
        {
            return Err(KernelError::OutsideVault(target.to_owned()));
        }
        if self.mounts.values().any(|m| overlaps(target, &m.target)) {
            return Err(KernelError::OutsideVault(target.to_owned()));
        }
        let stat = storage.stat(target).map_err(|source| KernelError::Io {
            path: target.to_owned(),
            source,
        })?;
        if stat.kind != EntryKind::Dir {
            return Err(KernelError::Io {
                path: target.to_owned(),
                source: io::Error::new(
                    io::ErrorKind::NotADirectory,
                    "target mount non e una cartella",
                ),
            });
        }
        let id = identity_of(storage, target)?;
        if id == identity_of(storage, &self.root)?
            || self.identities.values().any(|known| *known == id)
        {
            return Err(KernelError::AlreadyExists(format!(
                "mount {name}: alias/ciclo"
            )));
        }
        self.mounts.insert(
            name.into(),
            ExternalMount {
                name: name.into(),
                target: target.to_owned(),
                namespace: namespace.into(),
            },
        );
        self.identities.insert(name.into(), id);
        Ok(())
    }

    /// Toglie solo la rotta, senza toccare il filesystem esterno.
    pub fn unmount(&mut self, name: &str) -> bool {
        self.identities.remove(name);
        let active = self.mounts.remove(name).is_some();
        let inactive = self.inactive.remove(name).is_some();
        self.diagnostics
            .retain(|diagnostic| diagnostic.name != name);
        active || inactive
    }

    /// Risolve un path relativo nel namespace attraverso lo stesso supporto che
    /// ha autorizzato il mount, ricontrollando identità, recinto e collegamenti.
    pub fn resolve(
        &self,
        storage: &dyn VaultStorage,
        namespace: &str,
        rel: &str,
    ) -> Option<Utf8PathBuf> {
        let mount = self.mounts.values().find(|m| m.namespace == namespace)?;
        if rel.contains('\\') {
            return None;
        }
        path_policy::fenced(rel).ok()?;
        if identity_of(storage, &mount.target).ok()? != self.identities[&mount.name] {
            return None;
        }
        // Un componente alla volta: nella forma estesa di Windows `/` non
        // separa.
        let mut path = mount.target.clone();
        for part in rel.split('/') {
            path.push(part);
        }
        reject_symlink_components(storage, &path).ok()?;
        Some(path)
    }

    pub fn routing_table(&self) -> Vec<MountRoute> {
        let mut routes: Vec<_> = self
            .mounts
            .values()
            .map(|m| MountRoute {
                name: m.name.clone(),
                namespace: m.namespace.clone(),
                target: m.target.clone(),
            })
            .collect();
        routes.sort_by(|a, b| a.namespace.cmp(&b.namespace));
        routes
    }

    fn stored(&self, name: &str) -> StoredMount {
        StoredMount {
            mount: self.mounts[name].clone(),
            identity: self.identities[name],
        }
    }

    /// Il documento schema 1 (solo per ispezione; scrivere richiede `update`).
    pub fn config_doc(&self) -> String {
        let config = Self::config_path(&self.root);
        String::from_utf8(
            encode(self.mounts.keys().map(|n| self.stored(n)), &config).expect("serializzabile"),
        )
        .expect("JSON UTF-8")
    }

    /// Commit merge-aware di una sola aggiunta già preparata. Il callback di
    /// update legge soltanto `.fub/`: nessuno stat esterno attraversa il lock.
    pub fn persist_add(&self, storage: &dyn VaultStorage, name: &str) -> io::Result<()> {
        let config = Self::config_path(&self.root);
        let candidate = self
            .mounts
            .get(name)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "mount non preparato"))?;
        reject_symlink_components(storage, &candidate.target)
            .map_err(|e| invalid_doc(&config, e))?;
        if identity_of(storage, &candidate.target).map_err(|e| invalid_doc(&config, e))?
            != self.identities[name]
        {
            return Err(invalid_doc(
                &config,
                "identita del target cambiata prima del commit",
            ));
        }
        let entry = self.stored(name);
        storage.update(&config, &mut |current| {
            let mut entries = current
                .map(|raw| decode(raw, &config))
                .transpose()?
                .unwrap_or_default();
            if entries.iter().any(|old| {
                old.mount.name == entry.mount.name
                    || old.mount.namespace == entry.mount.namespace
                    || overlaps(&old.mount.target, &entry.mount.target)
                    || old.identity == entry.identity
            }) {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "mount sovrapposto, alias o namespace occupato",
                ));
            }
            entries.push(entry.clone());
            entries.sort_by(|a, b| a.mount.name.cmp(&b.mount.name));
            Ok(Some(encode(entries, &config)?))
        })?;
        let still_same = reject_symlink_components(storage, &candidate.target).is_ok()
            && identity_of(storage, &candidate.target).ok() == Some(self.identities[name]);
        if still_same {
            return Ok(());
        }
        let rollback = self.persist_remove(storage, name);
        Err(invalid_doc(
            &config,
            match rollback {
                Ok(()) => {
                    "identita del target cambiata durante il commit; aggiunta annullata".to_string()
                }
                Err(error) => format!(
                    "identita del target cambiata durante il commit; rollback fallito: {error}"
                ),
            },
        ))
    }

    /// Commit merge-aware della rimozione; non accede mai al target esterno.
    pub fn persist_remove(&self, storage: &dyn VaultStorage, name: &str) -> io::Result<()> {
        let config = Self::config_path(&self.root);
        storage.update(&config, &mut |current| {
            let mut entries = current
                .map(|raw| decode(raw, &config))
                .transpose()?
                .unwrap_or_default();
            let before = entries.len();
            entries.retain(|m| m.mount.name != name);
            if entries.len() == before {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("mount {name} assente"),
                ));
            }
            Ok(Some(encode(entries, &config)?))
        })
    }

    /// Config corrotta o futura non diventa mai registro vuoto e resta un
    /// errore di apertura. Una singola rotta valida ma temporaneamente
    /// irraggiungibile viene invece disattivata con diagnostica: nessun byte
    /// esterno viene esposto e il vault principale continua ad aprirsi.
    pub fn load(storage: &dyn VaultStorage, root: &Utf8Path) -> Result<Self> {
        let config = Self::config_path(root);
        let raw = match storage.read(&config) {
            Ok(raw) => raw,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Self::new(root)),
            Err(source) => {
                return Err(KernelError::Io {
                    path: config,
                    source,
                })
            }
        };
        let entries = decode(&raw, &config).map_err(|source| KernelError::Io {
            path: config.clone(),
            source,
        })?;
        let mut registry = Self::new(root);
        for entry in entries {
            let name = entry.mount.name.clone();
            let target = entry.mount.target.clone();
            let outcome = registry.mount(
                storage,
                &entry.mount.name,
                &entry.mount.target,
                &entry.mount.namespace,
            );
            let failure = match outcome {
                Err(error) => Some(error.to_string()),
                Ok(()) if registry.identities[&name] != entry.identity => {
                    registry.unmount(&name);
                    Some("identita mount cambiata".to_string())
                }
                Ok(()) => None,
            };
            if let Some(message) = failure {
                registry.inactive.insert(name.clone(), entry.mount);
                registry.diagnostics.push(MountDiagnostic {
                    name,
                    target,
                    message,
                });
            }
        }
        Ok(registry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemStorage;
    use fub_abi::Fnv1a;

    const TEST_VOL: u64 = 0x4944_4D45_4D00_0001;

    /// Un path assoluto su ogni piattaforma: su Windows sta sul disco `C:`.
    fn abs(path: &str) -> Utf8PathBuf {
        if cfg!(windows) {
            Utf8PathBuf::from(format!("C:{}", path.replace('/', "\\")))
        } else {
            path.into()
        }
    }

    fn denied(error: &KernelError) -> bool {
        matches!(error, KernelError::Io { source, .. } if source.kind() == io::ErrorKind::PermissionDenied)
    }

    /// MemStorage con identita dev+ino sintetica ma deterministica (FNV del
    /// path canonico) piu alias espliciti per dimostrare i cicli, e link
    /// simbolici simulati per i nomi che passano da un collegamento. Tutto il
    /// resto delega all'inner: e un doppio di prova, non un backend.
    struct IdMem {
        inner: MemStorage,
        extra: BTreeMap<Utf8PathBuf, Utf8PathBuf>,
        links: BTreeMap<Utf8PathBuf, Utf8PathBuf>,
    }

    impl IdMem {
        fn new() -> Self {
            Self {
                inner: MemStorage::new(),
                extra: BTreeMap::new(),
                links: BTreeMap::new(),
            }
        }

        /// Un link simbolico: `link` e ogni path sotto di lui portano a `real`.
        fn link(&mut self, link: &Utf8Path, real: &Utf8Path) {
            self.links.insert(link.to_owned(), real.to_owned());
        }

        fn follow(&self, path: &Utf8Path) -> Utf8PathBuf {
            self.links
                .iter()
                .find_map(|(link, real)| {
                    let rest = path.strip_prefix(link).ok()?;
                    Some(if rest.as_str().is_empty() {
                        real.clone()
                    } else {
                        real.join(rest)
                    })
                })
                .unwrap_or_else(|| path.to_owned())
        }

        fn mkdir(&self, dir: &Utf8Path) {
            self.inner
                .write(&dir.join(".keep"), b"")
                .expect("cartella di prova");
        }

        fn alias(&mut self, alias: &Utf8Path, canonical: &Utf8Path) {
            self.extra.insert(alias.to_owned(), canonical.to_owned());
        }

        fn canon(&self, path: &Utf8Path) -> Utf8PathBuf {
            let path = self.follow(path);
            self.extra.get(&path).cloned().unwrap_or(path)
        }
    }

    impl VaultStorage for IdMem {
        fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
            self.inner.read(&self.canon(path))
        }

        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<crate::storage::Stat> {
            self.inner.write(path, bytes)
        }

        fn update(&self, path: &Utf8Path, merge: crate::storage::Merge<'_>) -> io::Result<()> {
            self.inner.update(path, merge)
        }

        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
            self.inner.append(path, bytes)
        }

        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.inner.rename(from, to)
        }

        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.inner.rename_no_replace(from, to)
        }

        fn remove(&self, path: &Utf8Path) -> io::Result<()> {
            self.inner.remove(path)
        }

        fn list(&self, dir: &Utf8Path) -> io::Result<Vec<crate::storage::DirEntry>> {
            self.inner.list(dir)
        }

        fn stat(&self, path: &Utf8Path) -> io::Result<crate::storage::Stat> {
            self.inner.stat(&self.canon(path))
        }
        fn stat_no_follow(&self, path: &Utf8Path) -> io::Result<crate::storage::Stat> {
            if self.links.contains_key(path) {
                return Ok(crate::storage::Stat {
                    kind: EntryKind::Other,
                    size: 0,
                    mtime: 0,
                });
            }
            self.inner.stat(&self.canon(path))
        }
        fn real_path(&self, path: &Utf8Path) -> io::Result<Utf8PathBuf> {
            let real = self.follow(path);
            self.inner.stat(&real)?;
            Ok(real)
        }

        fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
            let canon = self.canon(path);
            if self.inner.stat(&canon).is_err() {
                return Ok(None);
            }
            Ok(Some(FileIdentity {
                volume: TEST_VOL,
                file: Fnv1a::hash(canon.as_str().as_bytes()),
            }))
        }

        fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
            self.inner.remove_empty_dir(dir)
        }
    }

    fn setup() -> (IdMem, Utf8PathBuf) {
        let mem = IdMem::new();
        let root = abs("/vault");
        mem.inner
            .write(&root.join("probe.md"), b"x")
            .expect("radice di prova");
        mem.mkdir(&abs("/ext/a"));
        mem.mkdir(&abs("/ext/b"));
        (mem, root)
    }

    #[test]
    fn mount_resolve_route_unmount() {
        let (mem, root) = setup();
        let mut reg = MountRegistry::new(&root);
        assert!(reg.is_empty());
        reg.mount(&mem, "foto", &abs("/ext/a"), "media")
            .expect("mount valido");
        assert_eq!(reg.len(), 1);
        assert_eq!(reg.get("foto").expect("presente").namespace, "media");

        let routed = reg
            .resolve(&mem, "media", "a/b.md")
            .expect("dentro il namespace");
        assert_eq!(routed, abs("/ext/a/a/b.md"));
        // La rotta e usabile davvero: ci si scrive e rilegge.
        mem.write(&routed, b"dati").expect("scrittura instradata");
        assert_eq!(mem.read(&routed).expect("rilettura"), b"dati");

        assert!(reg.resolve(&mem, "sconosciuto", "a.md").is_none());
        assert!(reg.resolve(&mem, "media", "../fuori.md").is_none());
        assert!(reg.resolve(&mem, "media", "/assoluto.md").is_none());
        assert!(reg.resolve(&mem, "media", "a\\..\\fuori.md").is_none());
        assert!(reg.resolve(&mem, "media", "").is_none());

        assert_eq!(
            reg.routing_table(),
            vec![MountRoute {
                name: "foto".into(),
                namespace: "media".into(),
                target: abs("/ext/a"),
            }]
        );

        assert!(reg.unmount("foto"));
        assert!(!reg.unmount("foto"));
        assert!(reg.resolve(&mem, "media", "a.md").is_none());
    }

    #[test]
    fn target_must_exist_and_be_dir_with_identity() {
        let (mem, root) = setup();
        let mut reg = MountRegistry::new(&root);
        let err = reg.mount(&mem, "x", &abs("/ext/manca"), "n").unwrap_err();
        assert!(
            matches!(err, KernelError::Io { .. }),
            "target assente: {err:?}"
        );

        mem.inner
            .write(&abs("/ext/file.txt"), b"f")
            .expect("file esterno");
        let err = reg
            .mount(&mem, "x", &abs("/ext/file.txt"), "n")
            .unwrap_err();
        assert!(
            matches!(err, KernelError::Io { .. }),
            "target non cartella: {err:?}"
        );

        // Backend senza FileIdentity: Err esplicito, mai falsa registrazione.
        let plain = MemStorage::new();
        plain.write(&abs("/vault2/p.md"), b"x").expect("radice");
        plain.write(&abs("/ext2/d/.keep"), b"").expect("target");
        let mut reg2 = MountRegistry::new(&abs("/vault2"));
        let err = reg2.mount(&plain, "x", &abs("/ext2/d"), "n").unwrap_err();
        assert!(
            matches!(err, KernelError::Io { .. }),
            "senza identita: {err:?}"
        );
        assert!(reg2.is_empty());
    }

    #[test]
    fn mounts_are_disjoint_from_root_and_each_other() {
        let (mem, root) = setup();
        let mut reg = MountRegistry::new(&root);

        assert!(matches!(
            reg.mount(&mem, "self", &root, "n0").unwrap_err(),
            KernelError::OutsideVault(_)
        ));
        mem.mkdir(&abs("/vault/sub"));
        assert!(matches!(
            reg.mount(&mem, "in", &abs("/vault/sub"), "n1").unwrap_err(),
            KernelError::OutsideVault(_)
        ));
        // La root dentro il target: "/" esiste in memoria come antenato.
        assert!(matches!(
            reg.mount(&mem, "over", &abs("/"), "n2").unwrap_err(),
            KernelError::OutsideVault(_)
        ));

        reg.mount(&mem, "a", &abs("/ext/a"), "n3")
            .expect("primo mount");
        mem.mkdir(&abs("/ext/a/sub"));
        assert!(matches!(
            reg.mount(&mem, "sub", &abs("/ext/a/sub"), "n4")
                .unwrap_err(),
            KernelError::OutsideVault(_)
        ));
        assert!(matches!(
            reg.mount(&mem, "over", &abs("/ext"), "n5").unwrap_err(),
            KernelError::OutsideVault(_)
        ));
        // Il primo mount resta l'unico registrato.
        assert_eq!(reg.len(), 1);
    }

    #[test]
    fn names_namespaces_targets_are_validated() {
        let (mem, root) = setup();
        let mut reg = MountRegistry::new(&root);
        reg.mount(&mem, "a", &abs("/ext/a"), "n1").expect("primo");
        assert!(matches!(
            reg.mount(&mem, "a", &abs("/ext/b"), "n2").unwrap_err(),
            KernelError::AlreadyExists(_)
        ));
        assert!(matches!(
            reg.mount(&mem, "b", &abs("/ext/b"), "n1").unwrap_err(),
            KernelError::AlreadyExists(_)
        ));
        for bad in ["", " ", "a/b", "..", "."] {
            assert!(
                reg.mount(&mem, bad, &abs("/ext/b"), "nx").is_err(),
                "nome {bad:?} accettato"
            );
            assert!(
                reg.mount(&mem, "ok", &abs("/ext/b"), bad).is_err(),
                "namespace {bad:?} accettato"
            );
        }
        assert!(matches!(
            reg.mount(&mem, "c", Utf8Path::new("ext/c"), "n3")
                .unwrap_err(),
            KernelError::BadName { .. }
        ));
    }

    #[test]
    fn internal_paths_are_refused() {
        let (mem, root) = setup();
        let mut reg = MountRegistry::new(&root);
        assert!(matches!(
            reg.mount(&mem, "f", &root.join(FUB_DIR), "n").unwrap_err(),
            KernelError::OutsideVault(_)
        ));
        assert!(matches!(
            reg.mount(&mem, "f", &root.join(FUB_DIR).join("data/x"), "n")
                .unwrap_err(),
            KernelError::OutsideVault(_)
        ));
    }

    #[test]
    fn cycles_via_identity_are_rejected() {
        let (mut mem, root) = setup();
        mem.mkdir(&abs("/ext/real"));
        mem.alias(&abs("/ext/alias"), &abs("/ext/real"));
        mem.alias(&abs("/vault-link"), &abs("/vault"));
        let mut reg = MountRegistry::new(&root);
        reg.mount(&mem, "a", &abs("/ext/real"), "n1")
            .expect("originale");
        // Stesso dev+ino con altro nome: disgiunto per prefisso, ciclo per identita.
        let err = reg.mount(&mem, "b", &abs("/ext/alias"), "n2").unwrap_err();
        assert!(
            matches!(err, KernelError::AlreadyExists(_)),
            "alias non rilevato: {err:?}"
        );
        // Alias della root: ciclo immediato.
        let err = reg.mount(&mem, "c", &abs("/vault-link"), "n3").unwrap_err();
        assert!(
            matches!(err, KernelError::AlreadyExists(_)),
            "ciclo su root non rilevato: {err:?}"
        );
        assert_eq!(reg.len(), 1);
    }

    /// Un antenato che è un link (su macOS `/var` → `/private/var`) si risolve
    /// alla registrazione: il nome salvato non ne contiene, e al caricamento
    /// il controllo severo lo accetta.
    #[test]
    fn an_ancestor_link_is_resolved_once_at_registration() {
        let (mut mem, root) = setup();
        mem.mkdir(&abs("/private/var/x"));
        mem.link(&abs("/var"), &abs("/private/var"));
        let mut reg = MountRegistry::new(&root);
        let err = reg.mount(&mem, "x", &abs("/var/x"), "n").unwrap_err();
        assert!(denied(&err), "il controllo severo resta: {err:?}");

        let real = reg
            .register(&mem, "x", &abs("/var/x"), "n")
            .expect("antenato risolto");
        assert_eq!(real, abs("/private/var/x"));
        reg.persist_add(&mem, "x").unwrap();
        let loaded = MountRegistry::load(&mem, &root).unwrap();
        assert!(
            loaded.diagnostics().is_empty(),
            "{:?}",
            loaded.diagnostics()
        );
        assert_eq!(loaded.routing_table()[0].target, real);
    }

    #[test]
    fn the_chosen_folder_that_is_a_link_stays_refused() {
        let (mut mem, root) = setup();
        mem.link(&abs("/ext/link"), &abs("/ext/a"));
        mem.link(&abs("/ext/dangling"), &abs("/ext/manca"));
        let mut reg = MountRegistry::new(&root);
        for chosen in [abs("/ext/link"), abs("/ext/dangling")] {
            let err = reg.register(&mem, "l", &chosen, "n").unwrap_err();
            assert!(denied(&err), "{chosen}: {err:?}");
        }
        assert!(reg.is_empty());
    }

    /// La radice nominata attraverso un link e il target reale sono due forme
    /// dello stesso albero: il recinto le confronta entrambe.
    #[test]
    fn the_fence_holds_when_the_root_is_named_through_a_link() {
        let mut mem = IdMem::new();
        mem.inner
            .write(&abs("/data/vault/probe.md"), b"x")
            .expect("radice di prova");
        mem.mkdir(&abs("/data/vault/sub"));
        mem.link(&abs("/lnk"), &abs("/data"));
        let mut reg = MountRegistry::new(&abs("/lnk/vault"));
        for chosen in [abs("/lnk/vault/sub"), abs("/lnk/vault/.fub"), abs("/data")] {
            mem.mkdir(&mem.follow(&chosen));
            let err = reg.register(&mem, "in", &chosen, "n").unwrap_err();
            assert!(
                matches!(err, KernelError::OutsideVault(_)),
                "{chosen}: {err:?}"
            );
        }
        assert!(reg.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_targets_are_refused_without_following() {
        use std::os::unix::fs::symlink;

        let vault = tempfile::tempdir().expect("vault");
        let tmp = tempfile::tempdir().expect("external");
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).expect("utf8");
        let base = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("utf8");
        let real = base.join("real");
        std::fs::create_dir_all(real.as_std_path()).expect("dir reale");
        let link = base.join("link");
        symlink(real.as_std_path(), link.as_std_path()).expect("symlink");
        // Anche penzolante: stat_no_follow non segue, rifiuta comunque.
        let dangling = base.join("dangling");
        symlink(
            base.join("inesistente").as_std_path(),
            dangling.as_std_path(),
        )
        .expect("symlink penzolante");

        let storage = crate::storage::FsStorage;
        let real_base = storage.real_path(&base).expect("base reale");
        let mut reg = MountRegistry::new(&root);
        for target in [&link, &dangling] {
            let err = reg.register(&storage, "s", target, "n").unwrap_err();
            assert!(denied(&err), "symlink scelto: {err:?}");
            let in_place = real_base.join(target.file_name().unwrap());
            let err = reg.mount(&storage, "s", &in_place, "n").unwrap_err();
            assert!(denied(&err), "symlink già reale: {err:?}");
        }
        assert!(reg.is_empty());
        // Controllo: una cartella vera sotto il link passa col suo nome reale.
        std::fs::create_dir(real.join("child")).expect("sottocartella");
        let registered = reg
            .register(&storage, "a", &link.join("child"), "n")
            .expect("controllo");
        assert_eq!(registered, real_base.join("real/child"));
    }

    #[test]
    fn config_roundtrip_merges_under_lock() {
        let (mem, root) = setup();
        let config = MountRegistry::config_path(&root);
        let mut first = MountRegistry::new(&root);
        first.mount(&mem, "a", &abs("/ext/a"), "n1").unwrap();
        first.persist_add(&mem, "a").unwrap();
        let mut second = MountRegistry::new(&root);
        second.mount(&mem, "b", &abs("/ext/b"), "n2").unwrap();
        second.persist_add(&mem, "b").unwrap();
        let loaded = MountRegistry::load(&mem, &root).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.resolve(&mem, "n1", "file"), Some(abs("/ext/a/file")));
        assert_eq!(loaded.resolve(&mem, "n2", "file"), Some(abs("/ext/b/file")));

        for broken in [b"{no".as_slice(), br#"{"schema":2,"mounts":[]}"#.as_slice()] {
            mem.write(&config, broken).unwrap();
            assert!(MountRegistry::load(&mem, &root).is_err());
            assert!(first.persist_remove(&mem, "a").is_err());
            assert!(first.persist_add(&mem, "a").is_err());
            assert_eq!(mem.read(&config).unwrap(), broken);
        }
    }

    #[cfg(unix)]
    #[test]
    fn real_fs_mount_reloads_rejects_ancestor_symlink_and_preserves_unmounted_files() {
        use std::os::unix::fs::symlink;
        let vault = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
        let chosen = Utf8PathBuf::from_path_buf(external.path().join("real")).unwrap();
        std::fs::create_dir(&chosen).unwrap();
        let storage = crate::storage::FsStorage;
        let mut prepared = MountRegistry::new(&root);
        assert!(prepared.routing_table().is_empty());
        let target = prepared
            .register(&storage, "external", &chosen, "photos")
            .unwrap();
        let file = target.join("treasure.txt");
        std::fs::write(&file, b"precious").unwrap();
        prepared.persist_add(&storage, "external").unwrap();
        let loaded = MountRegistry::load(&storage, &root).unwrap();
        let mut with_existing = loaded.clone();
        let child = target.join("child");
        std::fs::create_dir(&child).unwrap();
        assert!(with_existing
            .mount(&storage, "overlap", &child, "nested")
            .is_err());
        assert!(with_existing
            .mount(&storage, "cycle", &root, "cycle")
            .is_err());
        assert_eq!(
            loaded.resolve(&storage, "photos", "treasure.txt"),
            Some(file.clone())
        );
        let link = Utf8PathBuf::from_path_buf(external.path().join("alias")).unwrap();
        symlink(&target, &link).unwrap();
        assert!(MountRegistry::new(&root)
            .mount(&storage, "bad", &link, "bad")
            .is_err());
        assert!(MountRegistry::new(&root)
            .mount(&storage, "bad", &link.join("child"), "bad")
            .is_err());
        assert!(loaded.resolve(&storage, "photos", "../outside").is_none());
        let inside = target.join("nested");
        symlink(&root, &inside).unwrap();
        assert!(loaded.resolve(&storage, "photos", "nested/file").is_none());
        loaded.persist_remove(&storage, "external").unwrap();
        assert!(MountRegistry::load(&storage, &root)
            .unwrap()
            .routing_table()
            .is_empty());
        assert_eq!(std::fs::read(file).unwrap(), b"precious");
    }

    #[test]
    fn changed_target_identity_cannot_publish_a_prepared_route() {
        let vault = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
        let chosen = Utf8PathBuf::from_path_buf(external.path().join("chosen")).unwrap();
        std::fs::create_dir(&chosen).unwrap();
        let storage = crate::storage::FsStorage;
        let mut prepared = MountRegistry::new(&root);
        let target = prepared
            .register(&storage, "chosen", &chosen, "chosen")
            .unwrap();
        std::fs::rename(&target, target.with_file_name("original")).unwrap();
        std::fs::create_dir(&target).unwrap();
        assert!(prepared.persist_add(&storage, "chosen").is_err());
        assert!(MountRegistry::load(&storage, &root).unwrap().is_empty());
    }

    #[test]
    fn unavailable_target_is_inactive_without_blocking_vault_open() {
        let vault = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
        let chosen = Utf8PathBuf::from_path_buf(external.path().join("removable")).unwrap();
        std::fs::create_dir(&chosen).unwrap();
        let storage = crate::storage::FsStorage;
        let mut prepared = MountRegistry::new(&root);
        let target = prepared.register(&storage, "usb", &chosen, "usb").unwrap();
        prepared.persist_add(&storage, "usb").unwrap();
        std::fs::remove_dir(&target).unwrap();

        let loaded = MountRegistry::load(&storage, &root).expect("il vault resta apribile");
        assert!(loaded.routing_table().is_empty());
        assert!(loaded.is_configured("usb"));
        assert_eq!(loaded.diagnostics().len(), 1);
        assert_eq!(loaded.diagnostics()[0].name, "usb");
        loaded.persist_remove(&storage, "usb").unwrap();
        assert!(MountRegistry::load(&storage, &root)
            .unwrap()
            .diagnostics()
            .is_empty());
    }
}
