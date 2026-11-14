//! Aprire un file di stato della macchina che deve essere un file regolare:
//! un lock, un elenco di abbinamenti.
//!
//! Guardare il path con `symlink_metadata` e poi aprirlo lascia una finestra:
//! fra le due cose un collegamento può prendere il posto del file, e si apre
//! (o si blocca, o si scrive) quello a cui porta. Qui la regola vale
//! **all'apertura**: l'ultimo componente non si segue (`O_NOFOLLOW` su Unix,
//! `FILE_FLAG_OPEN_REPARSE_POINT` su Windows), una FIFO non blocca
//! (`O_NONBLOCK`), e sul file aperto si controlla che sia regolare e, su Unix,
//! che sia ancora quello che il path nomina.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

/// Il rifiuto: al path non c'è un file regolare (un collegamento, una
/// cartella, una FIFO, un dispositivo), o il file è cambiato mentre si apriva.
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

/// Apre `path` con `options` soltanto se è un file regolare, senza seguire un
/// collegamento al suo posto. Il rifiuto è un `PermissionDenied` che
/// [`is_not_regular`] riconosce; un file assente resta `NotFound` (o si crea,
/// se `options` lo chiede).
pub fn open_regular(path: &Path, options: &mut OpenOptions) -> io::Result<File> {
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
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) => return Err(open_error(error)),
    };
    let opened = file.metadata()?;
    if !opened.is_file() || opened.file_type().is_symlink() {
        return Err(refused());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let named = std::fs::symlink_metadata(path)?;
        if named.file_type().is_symlink()
            || (named.dev(), named.ino()) != (opened.dev(), opened.ino())
        {
            return Err(refused());
        }
    }
    Ok(file)
}

/// L'errore dell'apertura: un collegamento non seguito (`ELOOP`) o una
/// cartella aperta per scrivere (`EISDIR`) sono il rifiuto, non un guasto.
fn open_error(error: io::Error) -> io::Error {
    #[cfg(unix)]
    {
        let raw = error.raw_os_error();
        if raw == Some(rustix::io::Errno::LOOP.raw_os_error())
            || raw == Some(rustix::io::Errno::ISDIR.raw_os_error())
            || raw == Some(rustix::io::Errno::NXIO.raw_os_error())
        {
            return refused();
        }
    }
    error
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read() -> OpenOptions {
        let mut options = OpenOptions::new();
        options.read(true);
        options
    }

    fn lock() -> OpenOptions {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        options
    }

    /// Un file regolare si apre, e uno assente si crea se si chiede; senza
    /// creare resta `NotFound`, non un rifiuto.
    #[test]
    fn a_regular_file_opens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stato");
        let missing = open_regular(&path, &mut read()).unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
        assert!(!is_not_regular(&missing));
        open_regular(&path, &mut lock()).expect("si crea");
        open_regular(&path, &mut read()).expect("si apre");
    }

    /// Una cartella al posto del file si rifiuta, per leggere e per scrivere.
    #[test]
    fn a_directory_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        for options in [&mut read(), &mut lock()] {
            let error = open_regular(dir.path(), options).unwrap_err();
            assert!(is_not_regular(&error), "{error:?}");
        }
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
        for options in [&mut read(), &mut lock()] {
            let error = open_regular(&link, options).unwrap_err();
            assert!(is_not_regular(&error), "{error:?}");
        }
        let dangling = dir.path().join("pendente");
        std::os::unix::fs::symlink(dir.path().join("nessuno"), &dangling).unwrap();
        let error = open_regular(&dangling, &mut lock()).unwrap_err();
        assert!(is_not_regular(&error), "{error:?}");
        assert!(
            !dir.path().join("nessuno").exists(),
            "si è creato il bersaglio"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"intatto");
    }

    /// Una FIFO al posto del file non blocca l'apertura: si rifiuta subito.
    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_blocking() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("stato");
        rustix::fs::mkfifoat(
            rustix::fs::CWD,
            &fifo,
            rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        )
        .unwrap();
        for options in [&mut read(), &mut lock()] {
            let error = open_regular(&fifo, options).unwrap_err();
            assert!(is_not_regular(&error), "{error:?}");
        }
    }
}
