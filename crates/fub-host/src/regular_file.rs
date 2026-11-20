//! Aprire un file di stato della macchina che deve essere un file regolare:
//! un lock, un elenco di abbinamenti.
//!
//! Guardare il path con `symlink_metadata` e poi aprirlo lascia una finestra:
//! fra le due cose un collegamento può prendere il posto del file, e si apre
//! (o si blocca, o si scrive) quello a cui porta. Qui la regola vale
//! **all'apertura**: l'ultimo componente non si segue (`O_NOFOLLOW` su Unix,
//! `FILE_FLAG_OPEN_REPARSE_POINT` su Windows), una FIFO non blocca
//! (`O_NONBLOCK`, tolto di nuovo dal descrittore che si restituisce), e sul
//! file aperto si controlla che sia regolare e, su Unix, che sia ancora quello
//! che il path nomina.
//!
//! Il rifiuto è lo stesso su ogni sistema: quando l'apertura fallisce perché
//! al path c'è altro (Unix dice `ELOOP` o `EISDIR`, Windows dice soltanto
//! «accesso negato» per una cartella), si guarda che cosa c'è, e una cartella
//! o un collegamento sono [`NotRegular`], non un guasto di I/O.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

/// Il rifiuto: al path non c'è un file regolare (un collegamento, una
/// cartella, una FIFO, un dispositivo), o il file ha continuato a cambiare
/// mentre si apriva.
#[derive(Debug)]
pub struct NotRegular;

impl std::fmt::Display for NotRegular {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("not a regular file")
    }
}

impl std::error::Error for NotRegular {}

/// L'errore è il rifiuto di [`open_regular`], non un guasto di I/O?
pub fn is_not_regular(error: &io::Error) -> bool {
    error
        .get_ref()
        .is_some_and(|inner| inner.is::<NotRegular>())
}

fn refused() -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, NotRegular)
}

/// Come si apre il file. Le opzioni le possiede [`open_regular`]: i flag che
/// rendono vera la regola non si mescolano con quelli di un chiamante.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Soltanto lettura; un file assente è `NotFound`.
    Read,
    /// Lettura e scrittura, creato se manca e mai troncato: un file di lock.
    Lock,
}

/// Quante volte si riapre un file che cambia o sparisce fra l'apertura e il
/// controllo, prima di rifiutarlo.
const ATTEMPTS: usize = 3;

/// Apre `path` soltanto se è un file regolare, senza seguire un collegamento
/// al suo posto. Il rifiuto è un `PermissionDenied` che [`is_not_regular`]
/// riconosce; un file assente resta `NotFound` (o si crea, con
/// [`Access::Lock`]).
pub fn open_regular(path: &Path, access: Access) -> io::Result<File> {
    open_checked(path, access, &|| {})
}

/// [`open_regular`] con `between` chiamato fra l'apertura e il controllo del
/// nome: i test vi mettono la corsa.
fn open_checked(path: &Path, access: Access, between: &dyn Fn()) -> io::Result<File> {
    for _ in 0..ATTEMPTS {
        let file = match options(access).open(path) {
            Ok(file) => file,
            Err(error) => return Err(open_error(path, error)),
        };
        let opened = file.metadata()?;
        if !opened.is_file() || opened.file_type().is_symlink() {
            return Err(refused());
        }
        between();
        // Il nome porta ancora al file aperto? Se nel frattempo è sparito o
        // porta altrove, si riapre: un `NotFound` qui direbbe «assente» di un
        // file appena aperto (o creato).
        if still_named(path, &opened)? {
            restore_blocking(&file)?;
            return Ok(file);
        }
    }
    Err(refused())
}

fn options(access: Access) -> OpenOptions {
    let mut options = OpenOptions::new();
    match access {
        Access::Read => {
            options.read(true);
        }
        Access::Lock => {
            options.read(true).write(true).create(true).truncate(false);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let flags = (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits();
        options.custom_flags(flags as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
}

/// Il path nomina ancora il file aperto? Su Unix dispositivo e inode; un nome
/// sparito è «no». Su Windows l'ultimo componente non si è seguito e il tipo
/// si è guardato sull'handle: non c'è un'identità più forte da confrontare
/// senza riaprire il path.
fn still_named(path: &Path, opened: &std::fs::Metadata) -> io::Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match std::fs::symlink_metadata(path) {
            Ok(named) => Ok(!named.file_type().is_symlink()
                && (named.dev(), named.ino()) == (opened.dev(), opened.ino())),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (path, opened);
        Ok(true)
    }
}

/// Toglie `O_NONBLOCK` dal descrittore: serviva soltanto a non restare fermi
/// sull'apertura di una FIFO, e chi riceve il file si aspetta un descrittore
/// normale.
fn restore_blocking(file: &File) -> io::Result<()> {
    #[cfg(unix)]
    {
        let to_io = |errno: rustix::io::Errno| io::Error::from_raw_os_error(errno.raw_os_error());
        let flags = rustix::fs::fcntl_getfl(file).map_err(to_io)?;
        if flags.contains(rustix::fs::OFlags::NONBLOCK) {
            rustix::fs::fcntl_setfl(file, flags - rustix::fs::OFlags::NONBLOCK).map_err(to_io)?;
        }
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

/// L'errore dell'apertura. Un collegamento non seguito (`ELOOP`) o una FIFO
/// senza lettori aperta per scrivere (`ENXIO`) sono il rifiuto; per ogni altro
/// errore, se al path c'è una cartella o un collegamento (`EISDIR` su Unix,
/// «accesso negato» su Windows) è il rifiuto lo stesso, uguale ovunque.
fn open_error(path: &Path, error: io::Error) -> io::Error {
    #[cfg(unix)]
    {
        let raw = error.raw_os_error();
        if raw == Some(rustix::io::Errno::LOOP.raw_os_error())
            || raw == Some(rustix::io::Errno::NXIO.raw_os_error())
        {
            return refused();
        }
    }
    if error.kind() == io::ErrorKind::NotFound {
        return error;
    }
    match std::fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => refused(),
        _ => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un file regolare si apre, e uno assente si crea se si chiede; senza
    /// creare resta `NotFound`, non un rifiuto.
    #[test]
    fn a_regular_file_opens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stato");
        let missing = open_regular(&path, Access::Read).unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
        assert!(!is_not_regular(&missing));
        open_regular(&path, Access::Lock).expect("si crea");
        open_regular(&path, Access::Read).expect("si apre");
    }

    /// Una cartella al posto del file si rifiuta, per leggere e per scrivere,
    /// con lo stesso errore su ogni sistema.
    #[test]
    fn a_directory_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        for access in [Access::Read, Access::Lock] {
            let error = open_regular(dir.path(), access).unwrap_err();
            assert!(is_not_regular(&error), "{access:?}: {error:?}");
        }
    }

    /// Il rifiuto dopo un errore dell'apertura guarda che cosa c'è al path: è
    /// la strada di Windows, dove una cartella è soltanto «accesso negato».
    #[test]
    fn an_open_error_over_a_directory_is_the_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(is_not_regular(&open_error(dir.path(), denied)));
        let file = dir.path().join("file");
        std::fs::write(&file, b"").unwrap();
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(!is_not_regular(&open_error(&file, denied)));
        let missing = io::Error::from(io::ErrorKind::NotFound);
        let kept = open_error(&dir.path().join("nessuno"), missing);
        assert_eq!(kept.kind(), io::ErrorKind::NotFound);
    }

    /// Un collegamento al posto del file non si segue, nemmeno verso un file
    /// regolare, e il file a cui porta resta com'era.
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_refused_even_towards_a_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("altro");
        std::fs::write(&target, b"intatto").unwrap();
        let link = dir.path().join("stato");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        for access in [Access::Read, Access::Lock] {
            let error = open_regular(&link, access).unwrap_err();
            assert!(is_not_regular(&error), "{error:?}");
        }
        let dangling = dir.path().join("pendente");
        std::os::unix::fs::symlink(dir.path().join("nessuno"), &dangling).unwrap();
        let error = open_regular(&dangling, Access::Lock).unwrap_err();
        assert!(is_not_regular(&error), "{error:?}");
        assert!(
            !dir.path().join("nessuno").exists(),
            "si è creato il bersaglio"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"intatto");
    }

    /// Una FIFO al posto del file non blocca l'apertura: si rifiuta subito.
    /// La FIFO la crea `mkfifo`, che c'è su Linux e su macOS: rustix non
    /// espone `mkfifoat` né `mknodat` per i sistemi Apple.
    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_blocking() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("stato");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo c'è su Linux e su macOS");
        assert!(made.success());
        for access in [Access::Read, Access::Lock] {
            let error = open_regular(&fifo, access).unwrap_err();
            assert!(is_not_regular(&error), "{error:?}");
        }
    }

    /// Il descrittore restituito è normale: `O_NONBLOCK` serviva soltanto
    /// all'apertura.
    #[cfg(unix)]
    #[test]
    fn the_returned_descriptor_blocks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stato");
        for access in [Access::Lock, Access::Read] {
            let file = open_regular(&path, access).unwrap();
            let flags = rustix::fs::fcntl_getfl(&file).unwrap();
            assert!(!flags.contains(rustix::fs::OFlags::NONBLOCK), "{access:?}");
        }
    }

    /// Un file tolto fra l'apertura e il controllo del nome non è «assente»:
    /// si riapre (e un lock si ricrea). Un nome che continua a cambiare, dopo
    /// pochi tentativi, è il rifiuto.
    #[cfg(unix)]
    #[test]
    fn a_file_removed_while_opening_is_opened_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stato");
        let removals = std::cell::Cell::new(0);
        let once = || {
            if removals.get() == 0 {
                std::fs::remove_file(&path).unwrap();
            }
            removals.set(removals.get() + 1);
        };
        let file = open_checked(&path, Access::Lock, &once).expect("si riapre");
        assert_eq!(removals.get(), 2);
        assert!(path.is_file());
        drop(file);

        let always = || {
            let _ = std::fs::remove_file(&path);
        };
        let error = open_checked(&path, Access::Lock, &always).unwrap_err();
        assert!(is_not_regular(&error), "{error:?}");

        std::fs::write(&path, br#"{"pairs":[]}"#).unwrap();
        let gone = || {
            let _ = std::fs::remove_file(&path);
        };
        let error = open_checked(&path, Access::Read, &gone).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound, "{error:?}");
    }
}
