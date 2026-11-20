//! Le cartelle guardate **una per una**, scelte dalla politica del vault.
//!
//! inotify, il backend di `notify` su Linux, non guarda un albero: mette un
//! osservatore su ogni cartella, e `RecursiveMode::Recursive` li metteva su
//! **tutte**, comprese `.git/objects/*` e `node_modules`. Il budget degli
//! osservatori è dell'utente intero e condiviso con gli altri programmi; quando
//! finisce il rilevatore muore (difetto IMP-156: un vault che è anche un repo
//! git spendeva 446 osservatori su 1038 dentro `.git`). Qui la ricorsione la fa
//! Fub, e scende soltanto dove il [`WatchScope`] del kernel dice che il vault
//! conta qualcosa.
//!
//! Gli altri backend (Windows, macOS) guardano un albero con un handle solo e
//! restano ricorsivi: lì una cartella esclusa non costa niente, e questo modulo
//! non entra in gioco.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use camino::Utf8Path;
use fub_kernel::ignore::WatchScope;
use notify::ErrorKind;

/// Chi riceve gli osservatori: il debouncer vero, o un registro nei test.
pub(super) trait FolderWatches {
    /// Guarda `dir` da sola, senza le sue sottocartelle.
    fn watch_folder(&mut self, dir: &Path) -> notify::Result<()>;
    /// Smette di guardare `dir`. Una cartella che il backend ha già lasciato
    /// (spostata o tolta) non è un errore.
    fn unwatch_folder(&mut self, dir: &Path);
}

/// Le cartelle guardate, e il recinto con cui sono state scelte.
pub(super) struct PerFolder {
    root: PathBuf,
    scope: WatchScope,
    /// Ciò che Fub ha chiesto di guardare. Serve a sapere cosa lasciare quando
    /// il recinto si stringe; può contenere una cartella che il backend ha già
    /// lasciato da sé (il backend toglie l'osservatore di una cartella spostata
    /// o rimossa), e lasciarla due volte non costa niente.
    watched: BTreeSet<PathBuf>,
}

impl PerFolder {
    pub(super) fn new(root: &Path, scope: WatchScope) -> Self {
        PerFolder {
            root: root.to_path_buf(),
            scope,
            watched: BTreeSet::new(),
        }
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(test)]
    pub(super) fn watched(&self) -> &BTreeSet<PathBuf> {
        &self.watched
    }

    /// Guarda `from` e le cartelle sotto di lei che il recinto ammette.
    ///
    /// L'osservatore si mette **prima** di elencare: una sottocartella nata
    /// dopo l'elenco arriva come evento della cartella appena guardata, e una
    /// nata prima sta nell'elenco. I collegamenti non si seguono, come nella
    /// scansione del vault.
    ///
    /// Un errore ferma la camminata soltanto se il rilevatore non può più
    /// mantenere ciò che promette: il limite degli osservatori raggiunto, o la
    /// radice che non si lascia guardare. Una cartella sparita nel frattempo
    /// non è niente; una che rifiuta l'osservatore per altro (i permessi) resta
    /// fuori con un avviso nel log, come faceva `notify` da sé.
    pub(super) fn cover(
        &mut self,
        target: &mut impl FolderWatches,
        from: &Path,
    ) -> notify::Result<()> {
        let mut pending = vec![from.to_path_buf()];
        while let Some(dir) = pending.pop() {
            let Some(rel) = relative(&self.root, &dir) else {
                continue;
            };
            let descends = self.scope.descends(rel);
            if !descends && !self.scope.watches_alone(rel) {
                continue;
            }
            match target.watch_folder(&dir) {
                Ok(()) => {
                    self.watched.insert(dir.clone());
                }
                Err(error) if matches!(error.kind, ErrorKind::MaxFilesWatch) => return Err(error),
                Err(error) if dir == self.root => return Err(error),
                Err(error) if matches!(error.kind, ErrorKind::PathNotFound) => continue,
                Err(error) => {
                    tracing::warn!(
                        target: "fub.host",
                        "cartella non guardata, {}: {error}",
                        dir.display()
                    );
                    continue;
                }
            }
            if !descends {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    pending.push(entry.path());
                }
            }
        }
        Ok(())
    }

    /// `gone` non è più una cartella guardata: è stata spostata o tolta, e il
    /// backend ha già lasciato il suo osservatore e quelli sotto di lei.
    pub(super) fn forget(&mut self, gone: &Path) {
        if self.watched.contains(gone) {
            self.watched.retain(|dir| !dir.starts_with(gone));
        }
    }

    /// Porta le cartelle guardate al recinto `scope`, se è cambiato.
    ///
    /// Lascia le cartelle che il nuovo recinto esclude e guarda quelle che
    /// ammette adesso. Risponde `true` se ha camminato il vault intero.
    pub(super) fn realign(
        &mut self,
        target: &mut impl FolderWatches,
        scope: WatchScope,
    ) -> notify::Result<bool> {
        if scope == self.scope {
            return Ok(false);
        }
        self.scope = scope;
        let left: Vec<PathBuf> = self
            .watched
            .iter()
            .filter(|dir| {
                relative(&self.root, dir)
                    .is_none_or(|rel| !self.scope.descends(rel) && !self.scope.watches_alone(rel))
            })
            .cloned()
            .collect();
        for dir in left {
            target.unwatch_folder(&dir);
            self.watched.remove(&dir);
        }
        let root = self.root.clone();
        self.cover(target, &root)?;
        Ok(true)
    }
}

/// Il path di `dir` relativo alla radice, se ne ha uno che il vault sa dire.
///
/// Un nome che non è UTF-8 non può essere un [`DocId`](fub_abi::DocId): la
/// scansione non lo conta, e non lo guarda nemmeno il rilevatore.
fn relative<'a>(root: &Path, dir: &'a Path) -> Option<&'a Utf8Path> {
    Utf8Path::from_path(dir.strip_prefix(root).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_kernel::ignore::IgnorePolicy;

    /// Un backend che si limita a ricordare cosa gli è stato chiesto.
    #[derive(Default)]
    struct Recorder {
        watching: BTreeSet<PathBuf>,
        refuse_after: Option<usize>,
    }

    impl FolderWatches for Recorder {
        fn watch_folder(&mut self, dir: &Path) -> notify::Result<()> {
            if self
                .refuse_after
                .is_some_and(|limit| self.watching.len() >= limit)
            {
                return Err(notify::Error::new(ErrorKind::MaxFilesWatch).add_path(dir.into()));
            }
            self.watching.insert(dir.to_path_buf());
            Ok(())
        }

        fn unwatch_folder(&mut self, dir: &Path) {
            self.watching.remove(dir);
        }
    }

    /// Un vault che è anche un repo git, con un `node_modules` e la cartella
    /// di Fub: la forma del vault che ha esaurito gli osservatori.
    fn a_vault_that_is_a_repository() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a vault");
        for folder in [
            ".git/objects/aa",
            ".git/objects/bb",
            ".git/refs/heads",
            "node_modules/pacchetto/lib",
            ".fub/index",
            ".trash",
            "note/sotto",
            "Progetti",
        ] {
            std::fs::create_dir_all(dir.path().join(folder)).expect("a folder");
        }
        std::fs::write(dir.path().join("note/a.md"), "# a").expect("a note");
        dir
    }

    fn set(root: &Path, rels: &[&str]) -> BTreeSet<PathBuf> {
        rels.iter()
            .map(|rel| {
                if rel.is_empty() {
                    root.to_path_buf()
                } else {
                    root.join(rel)
                }
            })
            .collect()
    }

    #[test]
    fn excluded_folders_get_no_watch() {
        let vault = a_vault_that_is_a_repository();
        let root = vault.path();
        let mut backend = Recorder::default();
        let mut folders = PerFolder::new(root, WatchScope::new(IgnorePolicy::default()));
        folders
            .cover(&mut backend, root)
            .expect("the vault is watched");

        let expected = set(root, &["", "note", "note/sotto", "Progetti", ".fub"]);
        assert_eq!(backend.watching, expected);
        assert_eq!(folders.watched(), &expected);
    }

    /// Accendere i nascosti e togliere `.git` dalla lista rimette `.git` nel
    /// vault: da quel momento si guarda, e rispegnerli lo lascia di nuovo.
    #[test]
    fn a_changed_policy_widens_and_narrows_what_is_watched() {
        let vault = a_vault_that_is_a_repository();
        let root = vault.path();
        let mut backend = Recorder::default();
        let mut folders = PerFolder::new(root, WatchScope::new(IgnorePolicy::default()));
        folders
            .cover(&mut backend, root)
            .expect("the vault is watched");

        let same = WatchScope::new(IgnorePolicy::default());
        assert!(!folders.realign(&mut backend, same).expect("no change"));

        let revealing = WatchScope::new(IgnorePolicy::declaring(Vec::new(), true));
        assert!(folders.realign(&mut backend, revealing).expect("widened"));
        for rel in [
            ".git/objects/aa",
            ".git/refs/heads",
            "node_modules/pacchetto/lib",
        ] {
            assert!(backend.watching.contains(&root.join(rel)), "{rel}");
        }
        // La struttura resta fuori qualunque cosa dica l'utente.
        assert!(!backend.watching.contains(&root.join(".trash")));
        assert!(!backend.watching.contains(&root.join(".fub/index")));
        assert!(backend.watching.contains(&root.join(".fub")));

        let narrowing = WatchScope::new(IgnorePolicy::default());
        assert!(folders.realign(&mut backend, narrowing).expect("narrowed"));
        let expected = set(root, &["", "note", "note/sotto", "Progetti", ".fub"]);
        assert_eq!(backend.watching, expected);
        assert_eq!(folders.watched(), &expected);
    }

    /// Il limite del sistema non diventa silenzioso: la camminata si ferma e
    /// lo riferisce, perché chi la chiama deve abbassare la bandiera.
    #[test]
    fn the_watch_limit_is_reported_not_swallowed() {
        let vault = a_vault_that_is_a_repository();
        let root = vault.path();
        let mut backend = Recorder {
            refuse_after: Some(2),
            ..Recorder::default()
        };
        let mut folders = PerFolder::new(root, WatchScope::new(IgnorePolicy::default()));
        let error = folders
            .cover(&mut backend, root)
            .expect_err("the limit stops the walk");
        assert!(matches!(error.kind, ErrorKind::MaxFilesWatch));
    }

    #[test]
    fn a_folder_that_left_is_forgotten_with_what_it_held() {
        let vault = a_vault_that_is_a_repository();
        let root = vault.path();
        let mut backend = Recorder::default();
        let mut folders = PerFolder::new(root, WatchScope::new(IgnorePolicy::default()));
        folders
            .cover(&mut backend, root)
            .expect("the vault is watched");
        folders.forget(&root.join("note"));
        assert_eq!(
            folders.watched(),
            &set(root, &["", "Progetti", ".fub"]),
            "the folder and the ones below it are gone"
        );
        // Un file, o una cartella mai guardata, non toglie niente.
        folders.forget(&root.join("Progetti/nota.md"));
        assert_eq!(folders.watched().len(), 3);
    }
}
