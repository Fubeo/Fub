//! Le radici dell'automazione: che cosa un agente legge e che cosa scrive.
//!
//! Gli stessi flag delle app Craft, `--automation-read-root` e
//! `--automation-write-root`, ripetibili. Una radice è una cartella del disco;
//! qui diventa la parte del vault che copre, come cartelle relative alla sua
//! radice, una volta sola all'avvio.
//!
//! - **Senza radici di scrittura non si scrive.** Ogni strumento che scrive
//!   è rifiutato: l'MCP è in sola lettura.
//! - **Senza radici di lettura si legge tutto il vault.** Con almeno una, si
//!   legge soltanto sotto di loro e sotto le radici di scrittura: per scrivere
//!   una nota bisogna averne letto la revisione.
//! - **Una radice fuori dal vault non copre niente**, e una che contiene il
//!   vault lo copre intero. Una radice che non esiste ferma l'avvio: meglio
//!   un errore subito che un agente che non può fare ciò che si credeva.

use camino::{Utf8Path, Utf8PathBuf};

use crate::commands::Failure;

/// Quale parte del vault: tutto, o le cartelle elencate (vuoto = niente).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Scope {
    All,
    Folders(Vec<String>),
}

impl Scope {
    pub fn contains(&self, doc: &str) -> bool {
        match self {
            Scope::All => true,
            Scope::Folders(folders) => folders.iter().any(|folder| {
                doc == folder
                    || doc
                        .strip_prefix(folder.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
            }),
        }
    }

    pub fn is_all(&self) -> bool {
        matches!(self, Scope::All)
    }

    pub fn is_empty(&self) -> bool {
        matches!(self, Scope::Folders(folders) if folders.is_empty())
    }

    fn union(self, other: Scope) -> Scope {
        match (self, other) {
            (Scope::All, _) | (_, Scope::All) => Scope::All,
            (Scope::Folders(mut a), Scope::Folders(b)) => {
                for folder in b {
                    if !a.contains(&folder) {
                        a.push(folder);
                    }
                }
                Scope::Folders(a)
            }
        }
    }
}

/// Ciò che le radici concedono in questo vault.
#[derive(Clone, Debug)]
pub struct Access {
    pub read: Scope,
    pub write: Scope,
}

impl Access {
    pub fn new(
        read_roots: &[String],
        write_roots: &[String],
        vault: &Utf8Path,
    ) -> Result<Access, Failure> {
        let vault = canonical(vault.as_str(), "vault")?;
        let write = scope_of(write_roots, &vault, "--automation-write-root")?;
        let read = if read_roots.is_empty() {
            Scope::All
        } else {
            scope_of(read_roots, &vault, "--automation-read-root")?.union(write.clone())
        };
        Ok(Access { read, write })
    }

    pub fn check_read(&self, doc: &str) -> Result<(), Failure> {
        if self.read.contains(doc) {
            return Ok(());
        }
        Err(Failure::new(
            4,
            "denied",
            format!("`{doc}` è fuori dalle radici di lettura (--automation-read-root)"),
        ))
    }

    /// Si scrive da qualche parte? Senza radici di scrittura che coprono il
    /// vault, l'MCP è in sola lettura.
    pub fn check_writer(&self) -> Result<(), Failure> {
        if self.write.is_empty() {
            return Err(Failure::new(
                4,
                "denied",
                "sola lettura: nessuna --automation-write-root copre il vault",
            ));
        }
        Ok(())
    }

    pub fn check_write(&self, doc: &str) -> Result<(), Failure> {
        self.check_writer()?;
        if self.write.contains(doc) {
            return Ok(());
        }
        Err(Failure::new(
            4,
            "denied",
            format!("`{doc}` è fuori dalle radici di scrittura (--automation-write-root)"),
        ))
    }
}

fn canonical(raw: &str, what: &str) -> Result<Utf8PathBuf, Failure> {
    if raw.trim().is_empty() {
        return Err(Failure::bad_args(format!("{what}: path vuoto")));
    }
    let path = std::fs::canonicalize(raw)
        .map_err(|error| Failure::bad_args(format!("{what} `{raw}`: {error}")))?;
    if !path.is_dir() {
        return Err(Failure::bad_args(format!(
            "{what} `{raw}`: non è una cartella"
        )));
    }
    Utf8PathBuf::from_path_buf(path)
        .map_err(|_| Failure::bad_args(format!("{what} `{raw}`: non è UTF-8")))
}

fn scope_of(roots: &[String], vault: &Utf8Path, flag: &str) -> Result<Scope, Failure> {
    let mut scope = Scope::Folders(Vec::new());
    for raw in roots {
        let root = canonical(raw, flag)?;
        if vault.starts_with(&root) {
            return Ok(Scope::All);
        }
        if let Ok(rest) = root.strip_prefix(vault) {
            let folder = rest
                .components()
                .map(|part| part.as_str())
                .collect::<Vec<_>>()
                .join("/");
            scope = scope.union(Scope::Folders(vec![folder]));
        }
    }
    Ok(scope)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (tempfile::TempDir, Utf8PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let vault = Utf8PathBuf::from_path_buf(tmp.path().join("vault")).unwrap();
        std::fs::create_dir_all(vault.join("Agente/Bozze")).unwrap();
        std::fs::create_dir_all(vault.join("Note")).unwrap();
        std::fs::create_dir_all(tmp.path().join("altrove")).unwrap();
        (tmp, vault)
    }

    #[test]
    fn senza_radici_si_legge_tutto_e_non_si_scrive_niente() {
        let (_tmp, vault) = tree();
        let access = Access::new(&[], &[], &vault).unwrap();
        assert!(access.read.is_all());
        assert!(access.check_read("Note/a.md").is_ok());
        assert_eq!(
            access.check_write("Agente/a.md").unwrap_err().kind,
            "denied"
        );
    }

    #[test]
    fn una_cartella_del_vault_copre_se_stessa_e_niente_accanto() {
        let (_tmp, vault) = tree();
        let access = Access::new(
            &[vault.join("Note").to_string()],
            &[vault.join("Agente").to_string()],
            &vault,
        )
        .unwrap();
        assert!(access.check_write("Agente/Bozze/a.md").is_ok());
        assert!(access.check_write("Agente.md").is_err());
        assert!(access.check_write("Agenteria/a.md").is_err());
        assert!(access.check_write("Note/a.md").is_err());
        // Si legge sotto le radici di lettura e sotto quelle di scrittura.
        assert!(access.check_read("Note/a.md").is_ok());
        assert!(access.check_read("Agente/a.md").is_ok());
        assert!(access.check_read("Diario/a.md").is_err());
    }

    #[test]
    fn una_radice_che_contiene_il_vault_lo_copre_e_una_fuori_niente() {
        let (tmp, vault) = tree();
        let parent = tmp.path().to_str().unwrap().to_string();
        let outside = tmp.path().join("altrove").to_str().unwrap().to_string();
        let all = Access::new(&[], &[parent], &vault).unwrap();
        assert!(all.write.is_all());
        let outside = [outside];
        let none = Access::new(&outside, &outside, &vault).unwrap();
        assert!(none.write.is_empty());
        assert!(none.check_read("Note/a.md").is_err());
    }

    #[test]
    fn una_radice_che_non_esiste_ferma_l_avvio() {
        let (tmp, vault) = tree();
        let missing = tmp.path().join("manca").to_str().unwrap().to_string();
        assert_eq!(
            Access::new(&[], &[missing], &vault).unwrap_err().kind,
            "bad_args"
        );
    }
}
