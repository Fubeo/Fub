//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::rules::path_policy::Naming;
use fub_abi::rules::{path_policy, text_policy};
use fub_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::ignore::{parse_gitignore, GitignoreRules, IgnorePolicy, Kind, GITIGNORE_FILE};
use crate::settings::SharedSettings;
use crate::storage::{EntryKind, Stat, VaultStorage};
use crate::time::{now_unix, stamp_from_unix};
use fub_abi::schema::SchemaVersion;

fn is_absent_path_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
    ) || matches!(error.raw_os_error(), Some(2 | 3 | 123))
}

fn read_gitignore(storage: &dyn VaultStorage, root: &Utf8Path) -> Result<GitignoreRules> {
    let path = root.join(GITIGNORE_FILE);
    let bytes = match storage.read(&path) {
        Ok(bytes) => bytes,
        Err(source)
            if source.kind() == std::io::ErrorKind::NotFound
                || matches!(source.raw_os_error(), Some(2 | 3)) =>
        {
            return Ok(GitignoreRules::default());
        }
        Err(source) => return Err(KernelError::Io { path, source }),
    };
    match text_policy::decode(&bytes) {
        Ok(text) => Ok(parse_gitignore(text)),
        Err(at) => Err(KernelError::Io {
            path,
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("gitignore non UTF-8 a byte {at}"),
            ),
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    pub id: DocId,
    pub kind: EntryKind,
    pub size: u64,
    pub modified: u64,
}

#[derive(Clone)]
pub struct Vault {
    root: Utf8PathBuf,
    storage: Arc<dyn VaultStorage>,
    ignore: IgnorePolicy,
    settings: SharedSettings,
    schema: SchemaVersion,
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault")
            .field("root", &self.root)
            .field("ignore", &self.ignore)
            .field("schema", &self.schema)
            .finish_non_exhaustive()
    }
}

impl Vault {
    pub fn new(root: &Utf8Path, settings: SharedSettings) -> Result<Self> {
        Self::with_storage(
            root,
            Arc::new(crate::storage::RootedFsStorage::open(root).map_err(|source| {
                KernelError::Io {
                    path: root.to_owned(),
                    source,
                }
            })?),
            settings,
        )
    }

    pub fn with_storage(
        root: &Utf8Path,
        storage: Arc<dyn VaultStorage>,
        settings: SharedSettings,
    ) -> Result<Self> {
        let root = root.to_owned();
        let gitignore = read_gitignore(storage.as_ref(), &root)?;
        let ignore = IgnorePolicy::new(&settings.read(), gitignore);
        let schema = crate::schema::read_schema(storage.as_ref(), &root)?;
        Ok(Vault {
            root,
            storage,
            ignore,
            settings,
            schema,
        })
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    pub fn storage(&self) -> &Arc<dyn VaultStorage> {
        &self.storage
    }

    pub fn schema(&self) -> SchemaVersion {
        self.schema
    }

    pub fn set_schema(&mut self, version: SchemaVersion) {
        self.schema = version;
    }

    pub fn refresh_policy(&mut self) -> Result<()> {
        let gitignore = read_gitignore(self.storage.as_ref(), &self.root)?;
        self.ignore = IgnorePolicy::new(&self.settings.read(), gitignore);
        Ok(())
    }

    pub fn is_ignored(&self, id: &DocId) -> bool {
        self.ignore.is_ignored(id.as_str(), Kind::File)
    }

    pub fn list(&self) -> Result<Vec<VaultEntry>> {
        let mut entries = Vec::new();
        for entry in self.storage.walk_files(&self.root)? {
            let rel = entry
                .path
                .strip_prefix(&self.root)
                .map_err(|_| KernelError::PathOutsideVault(entry.path.clone()))?;
            let id = DocId::new(rel.as_str().replace('\\', "/"));
            if self.ignore.is_ignored(id.as_str(), Kind::File) {
                continue;
            }
            entries.push(VaultEntry {
                id,
                kind: entry.kind,
                size: entry.stat.size,
                modified: entry.stat.modified,
            });
        }
        entries.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        Ok(entries)
    }

    pub fn read(&self, id: &DocId) -> Result<Vec<u8>> {
        if self.ignore.is_ignored(id.as_str(), Kind::File) {
            return Err(KernelError::Ignored(id.to_string()));
        }
        self.storage
            .read(&self.path(id))
            .map_err(|source| KernelError::Io {
                path: self.path(id),
                source,
            })
    }

    pub fn read_text(&self, id: &DocId) -> Result<String> {
        let bytes = self.read(id)?;
        text_policy::decode(&bytes)
            .map(str::to_owned)
            .map_err(|at| KernelError::Io {
                path: self.path(id),
                source: std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("file non UTF-8 a byte {at}"),
                ),
            })
    }

    pub fn write(&self, id: &DocId, bytes: &[u8]) -> Result<()> {
        if self.ignore.is_ignored(id.as_str(), Kind::File) {
            return Err(KernelError::Ignored(id.to_string()));
        }
        let path = self.path(id);
        if let Some(parent) = path.parent() {
            self.storage
                .create_dir_all(parent)
                .map_err(|source| KernelError::Io {
                    path: parent.to_owned(),
                    source,
                })?;
        }
        self.storage
            .atomic_write(&path, bytes)
            .map_err(|source| KernelError::Io { path, source })
    }

    pub fn write_if_unchanged(
        &self,
        id: &DocId,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> Result<()> {
        if self.ignore.is_ignored(id.as_str(), Kind::File) {
            return Err(KernelError::Ignored(id.to_string()));
        }
        let path = self.path(id);
        if let Some(parent) = path.parent() {
            self.storage
                .create_dir_all(parent)
                .map_err(|source| KernelError::Io {
                    path: parent.to_owned(),
                    source,
                })?;
        }
        self.storage
            .atomic_write_if_unchanged(&path, expected, bytes)
            .map_err(|source| KernelError::Io { path, source })
    }

    pub fn remove(&self, id: &DocId) -> Result<()> {
        let path = self.path(id);
        self.storage
            .remove_file(&path)
            .map_err(|source| KernelError::Io { path, source })
    }

    pub fn rename(&self, from: &DocId, to: &DocId) -> Result<()> {
        if self.ignore.is_ignored(to.as_str(), Kind::File) {
            return Err(KernelError::Ignored(to.to_string()));
        }
        let from_path = self.path(from);
        let to_path = self.path(to);
        if let Some(parent) = to_path.parent() {
            self.storage
                .create_dir_all(parent)
                .map_err(|source| KernelError::Io {
                    path: parent.to_owned(),
                    source,
                })?;
        }
        self.storage
            .rename(&from_path, &to_path)
            .map_err(|source| KernelError::Io {
                path: from_path,
                source,
            })
    }

    pub fn stat(&self, id: &DocId) -> Result<Stat> {
        let path = self.path(id);
        self.storage
            .stat(&path)
            .map_err(|source| KernelError::Io { path, source })
    }

    pub fn exists(&self, id: &DocId) -> Result<bool> {
        let path = self.path(id);
        match self.storage.stat(&path) {
            Ok(_) => Ok(true),
            Err(source) if is_absent_path_error(&source) => Ok(false),
            Err(source) => Err(KernelError::Io { path, source }),
        }
    }

    pub fn create_dir(&self, raw: &str) -> Result<Utf8PathBuf> {
        let normalized = path_policy::normalize(raw, Naming::New).map_err(|error| {
            KernelError::BadPath {
                path: raw.into(),
                reason: error.to_string(),
            }
        })?;
        let path = self.root.join(&normalized);
        self.storage
            .create_dir(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        Ok(path)
    }

    pub fn create_dir_all(&self, raw: &str) -> Result<Utf8PathBuf> {
        let normalized = path_policy::normalize(raw, Naming::New).map_err(|error| {
            KernelError::BadPath {
                path: raw.into(),
                reason: error.to_string(),
            }
        })?;
        let path = self.root.join(&normalized);
        self.storage
            .create_dir_all(&path)
            .map_err(|source| KernelError::Io {
                path: path.clone(),
                source,
            })?;
        Ok(path)
    }

    pub fn remove_dir(&self, raw: &str) -> Result<()> {
        let normalized = path_policy::normalize(raw, Naming::Existing).map_err(|error| {
            KernelError::BadPath {
                path: raw.into(),
                reason: error.to_string(),
            }
        })?;
        let path = self.root.join(&normalized);
        self.storage
            .remove_dir(&path)
            .map_err(|source| KernelError::Io { path, source })
    }

    pub fn rename_dir(&self, from: &str, to: &str) -> Result<()> {
        let from = path_policy::normalize(from, Naming::Existing).map_err(|error| {
            KernelError::BadPath {
                path: from.into(),
                reason: error.to_string(),
            }
        })?;
        let to = path_policy::normalize(to, Naming::New).map_err(|error| KernelError::BadPath {
            path: to.into(),
            reason: error.to_string(),
        })?;
        let from_path = self.root.join(from);
        let to_path = self.root.join(to);
        self.storage
            .rename(&from_path, &to_path)
            .map_err(|source| KernelError::Io {
                path: from_path,
                source,
            })
    }

    pub fn path(&self, id: &DocId) -> Utf8PathBuf {
        self.root.join(id.as_str())
    }
}
