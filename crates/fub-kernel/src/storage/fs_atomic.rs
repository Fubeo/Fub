//! `impl FsStorage`, le rinomine che non sostituiscono (Unix e Windows), i
//! lock esclusivi, la sostituzione atomica e la lettura a pezzi.

use super::*;

impl FsStorage {
    /// Il giro `read` → `fondi` di [`VaultStorage::update`], **senza** il
    /// lucchetto: chi chiama decide se tenerlo, perché è la sola cosa che
    /// distingue i due passaggi di [`FsStorage::update`].
    fn reread_and_merge(
        &self,
        path: &Utf8Path,
        merge_entries: Merge<'_>,
    ) -> io::Result<Option<Vec<u8>>> {
        let current = match self.read(path) {
            Ok(bytes) => Some(bytes),
            Err(and) if and.kind() == io::ErrorKind::NotFound => None,
            Err(and) => return Err(and),
        };
        merge_entries(current.as_deref())
    }

    /// Il corpo di [`VaultStorage::update`], con la scrittura finale **scelta**:
    /// [`write`](VaultStorage::write) per chi aggiorna un file autorevole,
    /// [`write_derived`](VaultStorage::write_derived) per chi aggiorna un
    /// derivato.
    ///
    /// Le due vie condividono tutto — la rilettura sotto lucchetto, la fusione,
    /// il secondo giro quando la cartella non c'era — e differiscono solo
    /// nell'ultima riga, che è il prezzo della durabilità. È la stessa
    /// divisione di [`write_with`](FsStorage::write_with): il corpo sta qui una
    /// volta sola, e chi non paga il prezzo non copia le sessanta righe per
    /// dirlo.
    pub(super) fn update_with(
        &self,
        path: &Utf8Path,
        merge_entries: Merge<'_>,
        derived: bool,
    ) -> io::Result<()> {
        let folder_c_and = path.parent().map(Utf8Path::exists).unwrap_or(true);
        if folder_c_and {
            let _lock = exclusive_lock(path);
            return match self.reread_and_merge(path, &mut *merge_entries)? {
                Some(bytes) => self.write_updated(path, &bytes, derived),
                None => Ok(()),
            };
        }
        if self.reread_and_merge(path, &mut *merge_entries)?.is_none() {
            return Ok(());
        }
        let _lock = exclusive_lock(path);
        match self.reread_and_merge(path, &mut *merge_entries)? {
            Some(bytes) => self.write_updated(path, &bytes, derived),
            None => Ok(()),
        }
    }

    /// La scrittura finale di un [`update_con`]: durevole o derivata, a seconda
    /// di chi ha chiesto l'aggiornamento.
    fn write_updated(&self, path: &Utf8Path, bytes: &[u8], derived: bool) -> io::Result<()> {
        if derived {
            self.write_derived(path, bytes).map(|_| ())
        } else {
            self.write(path, bytes).map(|_| ())
        }
    }

    /// Il corpo di [`VaultStorage::write`], col **rilevatore passato** invece
    /// che nominato.
    ///
    /// Non è un gancio di prova travestito da API. Il rilevamento dei nomi di un
    /// file è la sola parte di questa scrittura che cambia con la piattaforma, e
    /// finché stava dentro il corpo *tutto* il corpo cambiava con lei: su una
    /// macchina che non sa contare gli hardlink non c'era modo di esercitare il
    /// ramo «sul posto», quindi la suite di durabilità là si **svuotava** —
    /// compilata a metà, verde, e indistinguibile da una suite che passa (§23.16).
    /// Passandolo, la regola si prova per intero su qualunque piattaforma con un
    /// rilevatore che risponde ciò che serve.
    ///
    /// Restituisce la strada presa perché è l'unica cosa osservabile della
    /// scelta che non richieda di guardare un inode — cioè l'unica che un banco
    /// possa presidiare anche dove gli inode non ci sono. Accanto le va lo
    /// [`Stat`] di **ciò che si è scritto**, preso dal descrittore ancora aperto
    /// e non dal path: sul ramo che sostituisce, quel descrittore è il
    /// temporaneo prima della rename, cioè il solo file che nessun altro
    /// processo può aver già tolto (difetto 0179).
    ///
    /// **Anche `what_c_and` è passato**, per la ragione del rilevatore portata
    /// fino in fondo: la lettura di ciò che sta già al path è l'altra syscall di
    /// questo corpo che può fallire *senza che il file manchi* — un permesso
    /// negato sulla cartella, un nome troppo lungo, un disco che non risponde —
    /// e finché era nominata qui dentro non c'era modo di farla fallire in un
    /// banco senza rompere un disco. È esattamente il caso che contava: un
    /// errore letto come «non c'è niente lì» manda la scrittura sul ramo
    /// [`ComeScrivere::Sostituendo`], cioè stacca un nome che poteva esserci.
    ///
    /// **`fsync` è il prezzo della durabilità, e chi scrive un derivato non lo
    /// paga**: `false` salta il `sync_all` del file e il `fsync` delle cartelle
    /// dopo la rename, lasciando intatto il resto — temp+rename, permessi
    /// ereditati, temporaneo tolto. È la metà che [`write_derived`] non paga, e
    /// sta qui dentro e non in una seconda copia del corpo perché le due
    /// scritture condividono tutto il resto: duplicare sessanta righe per
    /// togliere due `fsync` sarebbe il modo in cui le due copie divergono un
    /// giorno su una riga che conta.
    pub fn write_with(
        &self,
        path: &Utf8Path,
        bytes: &[u8],
        fsync: bool,
        what_c_and: impl Fn(&Utf8Path) -> io::Result<std::fs::Metadata>,
        names: impl Fn(&Utf8Path, &std::fs::Metadata) -> FileNames,
    ) -> io::Result<(WriteMode, Stat)> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // `optional` e non `.ok()`: **non c'è** è una risposta, «non si è potuto
        // guardare» no — e da qui dipende la scelta di come scrivere.
        let existing = crate::error::optional(what_c_and(path))?;
        let link = existing
            .as_ref()
            .is_some_and(|metadata| metadata.file_type().is_symlink());
        let count = match (&existing, link) {
            (None, _) => FileNames::None,
            // Su un collegamento il conteggio non si chiede: la risposta non
            // cambierebbe la decisione, e su Windows costerebbe un'apertura che
            // seguirebbe il collegamento invece di guardarlo.
            (Some(_), true) => FileNames::Unknown,
            (Some(metadata), false) => names(path, metadata),
        };
        // Un file in sola lettura non si sovrascrive, né sul posto né con la
        // rename (PA T59). Su un collegamento i bit sono quelli del link, che
        // non dicono niente: lì la scrittura sul posto apre il file vero, e il
        // permesso lo controlla il sistema.
        if let (Some(metadata), false) = (&existing, link) {
            refuse_read_only(path, WriteBits::of_std(metadata))?;
        }
        let how = how_to_write(link, count);
        if how == WriteMode::InPlace {
            let mut file = std::fs::File::create(path)?;
            file.write_all(bytes)?;
            if fsync {
                file.sync_all()?;
            }
            return Ok((how, stat_with(EntryKind::File, &file.metadata()?)));
        }

        let tmp = tmp_path(path);
        let written = (|| -> io::Result<Stat> {
            let mut file = std::fs::File::create(&tmp)?;
            file.write_all(bytes)?;
            if let Some(metadata) = &existing {
                // Best-effort: un filesystem che non sa di permessi (FAT su una
                // chiavetta) non è una ragione per non salvare la nota.
                let _ = std::fs::set_permissions(&tmp, metadata.permissions());
            }
            if fsync {
                file.sync_all()?;
            }
            // La data si chiede **al descrittore, prima della rename**: dopo, il
            // path può già essere di qualcun altro, e la rename non cambia
            // l'mtime del file che porta con sé.
            Ok(stat_with(EntryKind::File, &file.metadata()?))
        })();
        let stat = match written {
            Ok(stat) => stat,
            Err(and) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(and);
            }
        };
        if let Err(and) = atomic_replace(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(and);
        }
        if fsync {
            for dir in folders_to_sync(&tmp, Some(path)) {
                sync_folder(&dir);
            }
        }
        Ok((how, stat))
    }

    /// Fallback esplicito per i sistemi che non offrono una syscall
    /// no-replace. Il lock è obbligatorio: senza di esso `exists` e `rename`
    /// avrebbero di nuovo la finestra che questa API deve chiudere.
    #[cfg(not(windows))]
    pub(super) fn rename_no_replace_with_lock(
        &self,
        from: &Utf8Path,
        to: &Utf8Path,
    ) -> io::Result<()> {
        let _lock = exclusive_lock_required(to)?;
        match std::fs::symlink_metadata(to) {
            Ok(_) => {
                if same_parent_resolution_name(from, to) && self.same_file(from, to) {
                    return self.rename(from, to);
                }
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("{to}: esiste già"),
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        std::fs::rename(from, to)?;
        for dir in folders_to_sync(from, Some(to)) {
            sync_folder(&dir);
        }
        Ok(())
    }
}

/// Il path di una voce di directory, se il suo nome si scrive in UTF-8
/// (vedi [`VaultStorage::list`]). Un nome che non si scrive non è una voce, e
/// lo dice il log.
pub(crate) fn utf8_entry_path(dir: &Utf8Path, name: &std::ffi::OsStr) -> Option<Utf8PathBuf> {
    match name.to_str() {
        Some(name) => Some(dir.join(name)),
        None => {
            tracing::warn!(
                target: "fub.storage",
                %dir,
                name = %name.to_string_lossy(),
                "nome non rappresentabile in UTF-8: resta fuori dal vault"
            );
            None
        }
    }
}

pub(super) fn not_utf8(path: &std::path::Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("path non rappresentabile in UTF-8: {}", path.display()),
    )
}

/// **Può chi gira scrivere dentro questa cartella?**
///
/// È la metà «scrivibile» della verifica che l'apertura fa sulla radice
/// (difetto 0160), e la risposta è della piattaforma: i bit di permesso
/// mentono per le ACL, i mount di sola lettura e chi gira da root, quindi non
/// si leggono — si chiede.
///
/// La domanda non crea nulla: un file di prova sarebbe visibile a chiunque
/// cammini la radice mentre l'apertura è in corso, cioè un fantasma di pochi
/// microsecondi, la specie di rumore che la verifica all'ingresso esiste per
/// togliere.
pub(super) fn writable_folder(root: &Utf8Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        // `access(2)` applica i bit, le ACL e lo stato del mount, ed è la
        // stessa domanda che il sistema risponde a chiunque altro voglia
        // creare un file qui.
        let c = std::ffi::CString::new(root.as_str()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "una radice non può contenere NUL",
            )
        })?;
        // SAFETY: `access` non trattiene il puntatore oltre la chiamata, e
        // `c` resta vivo per tutto il tempo della chiamata.
        if unsafe { libc::access(c.as_ptr(), libc::W_OK) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        // Senza `access(2)` non resta che la prova vera: si scrive un file
        // e lo si toglie subito. Il fantasma è il prezzo della piattaforma.
        let test = root.join(format!(".fub-prova-{}", std::process::id()));
        let outcome = std::fs::write(&test, b"");
        let _ = std::fs::remove_file(&test);
        outcome.map(|_| ())
    }
}

pub(super) fn same_parent_resolution_name(from: &Utf8Path, to: &Utf8Path) -> bool {
    from != to
        && from.parent() == to.parent()
        && matches!(
            (from.file_name(), to.file_name()),
            (Some(a), Some(b))
                if fub_abi::rules::path::resolution_key(a)
                    == fub_abi::rules::path::resolution_key(b)
        )
}

/// Esegue una mossa no-replace usando la primitiva del sistema quando
/// disponibile. `Ok(false)` è deliberato: significa che il kernel in esecuzione
/// non ha quella primitiva o il filesystem non la implementa, e autorizza solo
/// il fallback sotto lock — mai `hard_link` seguito da `unlink`.
#[cfg(unix)]
pub(super) fn rename_no_replace_at(
    from_dir: std::os::unix::io::RawFd,
    from: &std::path::Path,
    to_dir: std::os::unix::io::RawFd,
    to: &std::path::Path,
) -> io::Result<bool> {
    #[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
    {
        let _ = (from_dir, from, to_dir, to);
        return Ok(false);
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let from = CString::new(from.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "un path non può contenere NUL")
        })?;
        let to = CString::new(to.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "un path non può contenere NUL")
        })?;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let result = unsafe {
            libc::renameat2(
                from_dir,
                from.as_ptr(),
                to_dir,
                to.as_ptr(),
                libc::RENAME_NOREPLACE as libc::c_uint,
            )
        };
        #[cfg(target_vendor = "apple")]
        let result = unsafe {
            libc::renameatx_np(
                from_dir,
                from.as_ptr(),
                to_dir,
                to.as_ptr(),
                libc::RENAME_EXCL,
            )
        };

        if result == 0 {
            return Ok(true);
        }
        let error = io::Error::last_os_error();
        if rename_no_replace_unsupported(&error) {
            Ok(false)
        } else {
            Err(error)
        }
    }
}
/// Variante per path ambienti già validati (`FsStorage`). Su Apple si usa
/// `renamex_np` direttamente; la variante `at` sopra resta quella necessaria
/// per `RootedFsStorage`, che passa directory handle invece di riaprire la root.
#[cfg(unix)]
pub(super) fn rename_no_replace_paths(
    from: &std::path::Path,
    to: &std::path::Path,
) -> io::Result<bool> {
    #[cfg(target_vendor = "apple")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let from = CString::new(from.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "un path non può contenere NUL")
        })?;
        let to = CString::new(to.as_os_str().as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "un path non può contenere NUL")
        })?;
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(true)
        } else {
            let error = io::Error::last_os_error();
            if rename_no_replace_unsupported(&error) {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        rename_no_replace_at(libc::AT_FDCWD, from, libc::AT_FDCWD, to)
    }
}

#[cfg(unix)]
fn rename_no_replace_unsupported(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::Unsupported
        || matches!(
            error.raw_os_error(),
            Some(code)
                if code == libc::ENOSYS
                    || code == libc::EINVAL
                    || code == libc::ENOTSUP
                    || code == libc::EOPNOTSUPP
        )
}

#[cfg(windows)]
pub(super) fn rename_no_replace_move_file(from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let from: Vec<u16> = from
        .as_std_path()
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let to: Vec<u16> = to
        .as_std_path()
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // Omission of MOVEFILE_REPLACE_EXISTING is the no-replace contract:
    // MoveFileExW fails with ERROR_ALREADY_EXISTS instead of touching `to`.
    let result = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Acquisisce il lock del protocollo senza il fallback best-effort usato dalle
/// scritture storiche. Protegge il fallback senza syscall no-replace e, su
/// Windows, impedisce che due aperture della stessa sorgente producano due
/// successi. Un errore del lock impedisce sempre la mossa.
pub(super) fn exclusive_lock_required(path: &Utf8Path) -> io::Result<std::fs::File> {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let lock_path = lock_path(path);
    std::fs::create_dir_all(dir)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)?;
    let expiration = std::time::Instant::now() + LOCK_RETRY_INTERVAL;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) => {
                if std::time::Instant::now() >= expiration {
                    return Err(io::Error::new(
                        io::ErrorKind::WouldBlock,
                        format!("lock occupato per {path}"),
                    ));
                }
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(error),
        }
        std::thread::sleep(RETRY_LOCK);
    }
}

/// Le cartelle la cui **voce** cambia quando qualcosa si sposta o si toglie, e
/// che quindi vanno sincronizzate perché la mossa sopravviva a un crash
/// (difetto 0153).
///
/// La [0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
/// aveva già trovato la riga che conta — *è la cartella a portare il nome*, e
/// senza il suo `fsync` un rename può sparire dopo un `Ok` — e l'aveva scritta
/// dentro la sola scrittura. Ma le operazioni che muovono o tolgono l'**unica
/// copia** di una nota sono le altre: cestinare, ripristinare, spostare,
/// buttare una bozza. Lì un `Ok` che non è sceso lascia una voce di cestino che
/// punta al nulla, o una nota che risorge dov'era, con il registro che dice il
/// contrario — e il registro, per la
/// [0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md),
/// si scrive *dopo* la mossa proprio per non raccontare mai ciò che non è
/// successo: una mossa che torna indietro da sola gli toglie quella garanzia.
///
/// Sta qui, pura e restituita come elenco, per la ragione di
/// [`how_to_write`]: la regola è una tabella — *quali* cartelle, e quante
/// volte — e una tabella si legge tutta insieme e si presidia dove gli inode
/// non ci sono. Le due righe che dice:
///
/// - una mossa dentro la stessa cartella la sincronizza **una volta sola**. Non
///   è un'ottimizzazione: è un `fsync` in più per ogni rinomina, che è il costo
///   più caro che un disco sappia fare;
/// - una radice senza genitore — un path relativo di un solo segmento — non
///   produce niente da sincronizzare invece di produrre la cartella vuota, che
///   non si apre.
pub fn folders_to_sync(from: &Utf8Path, a: Option<&Utf8Path>) -> Vec<Utf8PathBuf> {
    let mut out: Vec<Utf8PathBuf> = Vec::with_capacity(2);
    for path in std::iter::once(from).chain(a) {
        if let Some(dir) = path.parent().filter(|d| !d.as_str().is_empty()) {
            if !out.iter().any(|c| c == dir) {
                out.push(dir.to_owned());
            }
        }
    }
    out
}

/// Il `fsync` di una cartella, **best-effort**: rende `false` dove non si è
/// potuto fare, e non è un guasto della mossa che l'ha chiesto.
///
/// A provarci soltanto c'è la ragione già scritta nella 0065: su Windows una
/// cartella non si apre come file e la rename ha un'altra semantica. Una mossa
/// che fallisse perché la sua cartella non si è lasciata aprire rifiuterebbe di
/// cestinare una nota su una piattaforma dove il difetto che questa riga cura
/// non esiste — un danno certo al posto di uno improbabile, che è la stessa
/// misura con cui `update` tratta il proprio lock.
pub fn sync_folder(dir: &Utf8Path) -> bool {
    std::fs::File::open(dir).and_then(|d| d.sync_all()).is_ok()
}

/// Sostituisce il nome di un file con un temporaneo già sincronizzato.
///
/// `std::fs::rename` sostituisce atomicamente su Unix ma fallisce su Windows
/// quando la destinazione esiste; questa primitive mantiene la stessa promessa
/// su entrambe le famiglie.
pub(crate) fn atomic_replace(from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let from: Vec<u16> = from
            .as_std_path()
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        let to: Vec<u16> = to
            .as_std_path()
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(from, to)
    }
}

/// Pubblica un file o una cartella soltanto se il nome destinazione è libero.
pub(crate) fn rename_no_replace_path(from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use std::ffi::CString;

        let from = CString::new(from.as_str())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path con NUL"))?;
        let to = CString::new(to.as_str())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path con NUL"))?;
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE as _,
            )
        };
        if result == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use std::ffi::CString;

        let from = CString::new(from.as_str())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path con NUL"))?;
        let to = CString::new(to.as_str())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path con NUL"))?;
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let from: Vec<u16> = from
            .as_std_path()
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        let to: Vec<u16> = to
            .as_std_path()
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect();
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "ios",
        windows
    )))]
    {
        let _ = (from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "rename no-replace non disponibile su questa piattaforma",
        ))
    }
}

/// Quanto di un file tiene in memoria [`VaultStorage::read_pieces`].
const PIECE_BYTES: usize = 1 << 20;

pub(super) fn read_in_pieces(
    mut file: impl io::Read,
    piece: &mut dyn FnMut(&[u8]),
) -> io::Result<()> {
    let mut buffer = vec![0u8; PIECE_BYTES];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(read) => piece(&buffer[..read]),
            Err(and) if and.kind() == io::ErrorKind::Interrupted => {}
            Err(and) => return Err(and),
        }
    }
}

pub(super) fn read_bounded(
    mut file: impl io::Read + io::Seek,
    size: u64,
    offset: u64,
    len: usize,
) -> io::Result<Vec<u8>> {
    if offset >= size {
        return Ok(Vec::new());
    }
    let len = (size - offset).min(len as u64) as usize;
    file.seek(io::SeekFrom::Start(offset))?;
    let mut out = Vec::with_capacity(len);
    file.take(len as u64).read_to_end(&mut out)?;
    Ok(out)
}
