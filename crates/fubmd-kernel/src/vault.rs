//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::DocId;

use crate::error::{KernelError, Result};

/// Directory ignorate durante la scansione del vault.
const IGNORED_DIRS: &[&str] = &[".obsidian", ".git", ".fubmd-data", "node_modules"];

pub struct Vault {
    root: Utf8PathBuf,
}

impl Vault {
    pub fn open(root: impl AsRef<Utf8Path>) -> Self {
        Vault {
            root: root.as_ref().to_owned(),
        }
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// [`DocId`] (path relativo al vault, separatori `/`) per un path assoluto.
    pub fn doc_id_for_path(&self, abs: &Utf8Path) -> Result<DocId> {
        let rel = abs
            .strip_prefix(&self.root)
            .map_err(|_| KernelError::OutsideVault(abs.to_owned()))?;
        Ok(DocId::new(rel.as_str().replace('\\', "/")))
    }

    /// Path assoluto per un [`DocId`].
    pub fn path_for(&self, id: &DocId) -> Utf8PathBuf {
        self.root.join(id.as_str())
    }

    /// Elenca i documenti del vault le cui estensioni sono tra quelle date
    /// (senza punto, minuscole). Salta le directory ignorate e i file nascosti.
    pub fn list_documents(&self, extensions: &[String]) -> Result<Vec<DocId>> {
        let mut out = Vec::new();
        self.walk(&self.root, extensions, &mut out)?;
        out.sort();
        Ok(out)
    }

    fn walk(&self, dir: &Utf8Path, exts: &[String], out: &mut Vec<DocId>) -> Result<()> {
        let entries = std::fs::read_dir(dir).map_err(|e| KernelError::Io {
            path: dir.to_owned(),
            source: e,
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| KernelError::Io {
                path: dir.to_owned(),
                source: e,
            })?;
            let path = entry.path();
            let path = Utf8PathBuf::from_path_buf(path).map_err(KernelError::NonUtf8Path)?;
            let name = path.file_name().unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            let file_type = entry.file_type().map_err(|e| KernelError::Io {
                path: path.clone(),
                source: e,
            })?;
            if file_type.is_dir() {
                if IGNORED_DIRS.contains(&name) {
                    continue;
                }
                self.walk(&path, exts, out)?;
            } else if file_type.is_file() {
                if let Some(ext) = path.extension() {
                    if exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                        out.push(self.doc_id_for_path(&path)?);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn read(&self, id: &DocId) -> Result<String> {
        let path = self.path_for(id);
        std::fs::read_to_string(&path).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn write(&self, id: &DocId, source: &str) -> Result<()> {
        let path = self.path_for(id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| KernelError::Io {
                path: parent.to_owned(),
                source: e,
            })?;
        }
        std::fs::write(&path, source).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn exists(&self, id: &DocId) -> bool {
        self.path_for(id).exists()
    }
}
