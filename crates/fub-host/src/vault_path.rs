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
//!
//! Qui sta anche la forma normale di un percorso canonico ([`plain`],
//! [`plain_text`]): su Windows senza il prefisso `\\?\`, per ogni percorso che
//! l'host mostra alla persona (i temi, il rapporto di supporto) o passa a un
//! altro programma.

use std::borrow::Cow;
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
        if let Some(normal) = path.to_str().and_then(without_verbatim_prefix) {
            return PathBuf::from(normal);
        }
    }
    path
}

/// Il percorso da mostrare alla persona, o da passare a un altro programma:
/// su Windows senza il prefisso `\\?\` che `canonicalize` aggiunge
/// ([`without_verbatim_prefix`]), altrove com'è. Chi confronta dei percorsi
/// lo fa sempre sulla forma canonica, mai su questa.
pub fn plain_text(text: &str) -> Cow<'_, str> {
    match cfg!(windows)
        .then(|| without_verbatim_prefix(text))
        .flatten()
    {
        Some(normal) => Cow::Owned(normal),
        None => Cow::Borrowed(text),
    }
}

/// La forma normale di un percorso esteso di Windows, se ne ha una:
/// `\\?\C:\…` è `C:\…`, `\\?\UNC\server\…` è `\\server\…`. Le altre forme
/// estese (un volume per GUID, `\\?\GLOBALROOT…`) non hanno una forma normale
/// che si legga uguale, e restano come sono (`None`); così un percorso che non
/// comincia col prefisso.
///
/// È una regola sulle stringhe, uguale su ogni sistema, così le prove girano
/// anche fuori da Windows; chi la applica solo su Windows è [`plain_text`].
pub fn without_verbatim_prefix(text: &str) -> Option<String> {
    let rest = text.strip_prefix(r"\\?\")?;
    if let Some(share) = rest.strip_prefix(r"UNC\") {
        return (!share.is_empty()).then(|| format!(r"\\{share}"));
    }
    // Solo `X:\`: senza la barra, `C:` è la cartella corrente di quel disco,
    // non la sua radice.
    let bytes = rest.as_bytes();
    let disk =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    disk.then(|| rest.to_string())
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

    /// La regola sulle stringhe, provata su ogni sistema (#482).
    #[test]
    fn the_normal_form_drops_only_the_verbatim_prefix_of_a_disk_or_a_share() {
        for (extended, normal) in [
            (r"\\?\C:\Users\Anna\temi", r"C:\Users\Anna\temi"),
            (r"\\?\d:\v\nota.md", r"d:\v\nota.md"),
            (r"\\?\C:\", r"C:\"),
            (r"\\?\UNC\server\condivisa\v", r"\\server\condivisa\v"),
        ] {
            assert_eq!(
                without_verbatim_prefix(extended).as_deref(),
                Some(normal),
                "{extended}"
            );
        }
        for kept in [
            r"C:\Users\Anna",
            r"\\server\condivisa",
            "/home/anna/temi",
            r"\\?\Volume{0b1c}\temi",
            r"\\?\GLOBALROOT\Device\x",
            r"\\?\UNC\",
            r"\\?\C:temi",
            r"\\?\C:",
            r"\\?\",
            "",
        ] {
            assert_eq!(without_verbatim_prefix(kept), None, "{kept}");
        }
    }

    #[test]
    fn a_plain_path_keeps_everything_but_the_verbatim_prefix() {
        let unix = PathBuf::from("/v/nota.md");
        assert_eq!(plain(unix.clone()), unix);
        assert_eq!(plain_text("/v/nota.md"), "/v/nota.md");
        // Fuori da Windows `\\?\` è un nome come un altro: resta com'è.
        #[cfg(not(windows))]
        assert_eq!(plain_text(r"\\?\C:\v"), r"\\?\C:\v");
        #[cfg(windows)]
        {
            assert_eq!(
                plain(PathBuf::from(r"\\?\C:\v\nota.md")),
                PathBuf::from(r"C:\v\nota.md")
            );
            assert_eq!(
                plain(PathBuf::from(r"\\?\UNC\server\v")),
                PathBuf::from(r"\\server\v")
            );
            assert_eq!(plain_text(r"\\?\C:\v"), r"C:\v");
        }
    }
}
