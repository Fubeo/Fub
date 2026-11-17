//! Il percorso sul disco di una voce del vault, per chi la passa a un altro
//! programma: «Mostra nel file manager», «Apri con l'app di sistema»
//! (`fub-app/src/reveal.rs`) e «Apri con» un'app Craft ([`crate::open_with`]).
//!
//! La voce arriva come percorso relativo alla radice del vault, e resta dentro
//! il vault: niente `..`, niente percorsi assoluti, e un collegamento che porta
//! fuori si riconosce dopo averlo seguito. Il percorso che esce è quello
//! canonico, assoluto: comincia con `/` o con la lettera del disco, quindi chi
//! lo riceve come argomento non lo prende mai per un'opzione, nemmeno quando
//! il nome del file comincia con `-`.

use std::path::{Path, PathBuf};

use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;

/// Il percorso sul disco della voce `relative`, se è dentro `root` e c'è.
///
/// Fuori dal vault (un `..`, un `.`, una `\` o un `:` in un pezzo, un
/// collegamento che porta fuori) è `PermissionDenied` con la chiave
/// `host.reveal.outside`; una voce che non c'è è `NotFound` col percorso
/// relativo.
pub fn inside(root: &Path, relative: &str) -> Result<PathBuf, PluginError> {
    let refused = || {
        PluginError::PermissionDenied(Text::message(
            "host.reveal.outside",
            vec![Arg::text("path", relative)],
        ))
    };
    let mut path = root.to_path_buf();
    for part in relative.split('/').filter(|part| !part.is_empty()) {
        if matches!(part, "." | "..") || part.contains(['\\', ':']) {
            return Err(refused());
        }
        path.push(part);
    }
    let found = path
        .canonicalize()
        .map_err(|_| PluginError::NotFound(relative.to_string().into()))?;
    let root = root.canonicalize().map_err(|error| {
        PluginError::Io(Text::message(
            "host.reveal.root",
            vec![Arg::text("reason", error.to_string())],
        ))
    })?;
    if !found.starts_with(&root) {
        return Err(refused());
    }
    Ok(plain(found))
}

/// Il percorso come lo legge chi lo riceve: su Windows `canonicalize` dà la
/// forma `\\?\C:\…`, che `explorer.exe` non apre.
pub fn plain(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        let text = path.to_string_lossy();
        if let Some(rest) = text
            .strip_prefix(r"\\?\")
            .filter(|rest| !rest.starts_with("UNC\\"))
        {
            return PathBuf::from(rest);
        }
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_stays_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        std::fs::create_dir_all(root.join("cartella")).unwrap();
        std::fs::write(root.join("cartella/nota.md"), "x").unwrap();
        std::fs::write(dir.path().join("fuori.md"), "x").unwrap();
        let found = inside(&root, "cartella/nota.md").unwrap();
        assert!(found.ends_with("cartella/nota.md"), "{found:?}");
        assert!(found.is_absolute(), "{found:?}");
        assert!(inside(&root, "").is_ok(), "the root itself");
        for escape in [
            "../fuori.md",
            "cartella/../../fuori.md",
            "./nota.md",
            "a\\b",
        ] {
            assert!(
                matches!(inside(&root, escape), Err(PluginError::PermissionDenied(_))),
                "{escape}"
            );
        }
        assert!(matches!(
            inside(&root, "manca.md"),
            Err(PluginError::NotFound(_))
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("fuori.md"), root.join("ponte.md")).unwrap();
            assert!(
                matches!(
                    inside(&root, "ponte.md"),
                    Err(PluginError::PermissionDenied(_))
                ),
                "a link that leads out is outside"
            );
        }
    }

    #[test]
    fn a_plain_path_keeps_everything_but_the_verbatim_prefix() {
        let unix = PathBuf::from("/v/nota.md");
        assert_eq!(plain(unix.clone()), unix);
        if cfg!(windows) {
            assert_eq!(
                plain(PathBuf::from(r"\\?\C:\v\nota.md")),
                PathBuf::from(r"C:\v\nota.md")
            );
            let unc = PathBuf::from(r"\\?\UNC\server\v");
            assert_eq!(plain(unc.clone()), unc);
        }
    }
}
