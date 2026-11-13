//! `FsStorage` e i suoi attrezzi: nomi temporanei, bit di scrittura, lock,
//! nomi dei file, identità e timbro di cambiamento (con i rami `cfg` per
//! Unix e Windows).

use super::*;

/// Il supporto di default: il filesystem, come è sempre stato.
///
/// Non ha stato — è un token — e per questo si passa per valore o dentro un
/// `Arc` senza pensarci.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsStorage;

/// L'mtime in millisecondi UNIX. Vedi
/// [`VaultEntry::mtime`](fub_abi::traits::VaultEntry::mtime) per il perché dei
/// millisecondi e non dei secondi né dei nanosecondi.
fn mtime_millis(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

pub(super) fn stat_of(metadata: &std::fs::Metadata) -> Stat {
    stat_with(
        if metadata.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        },
        metadata,
    )
}

pub(super) fn stat_with(kind: EntryKind, metadata: &std::fs::Metadata) -> Stat {
    Stat {
        kind,
        size: if kind == EntryKind::File {
            metadata.len()
        } else {
            0
        },
        mtime: mtime_millis(metadata),
    }
}

/// Il contatore che rende **unico** il nome del temporaneo di
/// [`FsStorage::write`].
///
/// Col processo, distingue due scritture qualunque: due thread di Fub, e due
/// installazioni sulla stessa cartella. Con un `.tmp` fisso si scriverebbero
/// addosso sul temporaneo, e ciò che la rename fa atterrare sarebbe metà
/// dell'uno e metà dell'altro — cioè il file troncato che l'atomicità esiste per
/// non produrre, prodotto dalla sua implementazione.
pub(super) static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Il path del temporaneo di una scrittura: **accanto** al file, e con un nome
/// che comincia per punto.
///
/// Accanto perché una rename attraverso due filesystem non è una rename, e una
/// cartella di temporanei altrove sarebbe un secondo posto da tenere pulito.
/// Nascosto perché quel file esiste per una frazione di secondo **dentro il
/// vault**, e chi guarda il vault in quella frazione non deve vederlo: un
/// `Nota.tmp1234-5` accanto a `Nota.md` sarebbe un documento nuovo per chiunque
/// stia guardando — il nostro watcher, o Obsidian aperto sulla stessa cartella.
///
/// Che cominci per punto **non basta più a nasconderlo**, ed è la §15.6: da
/// quando un vault può dichiarare che i nascosti sono documenti, l'esclusione
/// del temporaneo non può essere un effetto collaterale di quella preferenza.
/// La forma del nome è perciò una regola, e la dice
/// [`is_write_temporary`] qui accanto.
pub(super) fn tmp_path(path: &Utf8Path) -> Utf8PathBuf {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    dir.join(temp_name(path.file_name().unwrap_or("senza-nome")))
}

/// Il **nome** del temporaneo di `name`, senza la cartella in cui va.
///
/// Sta scorporato perché la forma ha due scrittori e uno solo dei due lavora in
/// UTF-8: l'esportazione posa i suoi artefatti in una cartella che l'utente ha
/// scelto nel dialogo di sistema, cioè in un `Path` qualunque, e ha bisogno di
/// questa forma senza poter passare da un [`Utf8Path`]. Il nome del file però è
/// suo — glielo dà il provider — quindi ciò che attraversa è una `&str`, e la
/// regola resta scritta una volta sola (difetto 0183).
pub(crate) fn temp_name(name: &str) -> String {
    format!(
        ".{name}.tmp{}-{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// Ciò che serve sapere di un file che c'è già per dire se Fub lo può
/// **sovrascrivere** (PA T59).
///
/// La scrittura atomica crea un temporaneo accanto e lo rinomina sopra il
/// file: la rename chiede il permesso della **cartella**, non quello del file,
/// quindi su Linux e macOS un file senza il permesso di scrittura veniva
/// sostituito lo stesso, e su Windows il rifiuto arrivava come un errore di
/// I/O qualunque. Chi ha tolto il permesso di scrittura a un file ha detto
/// «questo non si tocca»: il controllo va fatto qui, prima del temporaneo,
/// ed è esplicito perché il sistema non lo fa per noi.
#[derive(Clone, Copy, Debug)]
pub(crate) struct WriteBits {
    /// I bit `rwx` del file (le tre classi) e il suo proprietario.
    #[cfg(unix)]
    mode: u32,
    #[cfg(unix)]
    uid: u32,
    #[cfg(unix)]
    gid: u32,
    /// L'attributo di sola lettura (Windows) o `readonly()` dove non c'è altro.
    #[cfg(not(unix))]
    read_only: bool,
}

impl WriteBits {
    pub(crate) fn of_std(metadata: &std::fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            WriteBits {
                mode: metadata.mode(),
                uid: metadata.uid(),
                gid: metadata.gid(),
            }
        }
        #[cfg(not(unix))]
        {
            WriteBits {
                read_only: metadata.permissions().readonly(),
            }
        }
    }

    pub(crate) fn of_cap(metadata: &cap_std::fs::Metadata) -> Self {
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt as _;
            WriteBits {
                mode: metadata.mode(),
                uid: metadata.uid(),
                gid: metadata.gid(),
            }
        }
        #[cfg(not(unix))]
        {
            WriteBits {
                read_only: metadata.permissions().readonly(),
            }
        }
    }

    /// Se il processo che fa girare Fub può scrivere il file.
    ///
    /// Su Unix non basta `Permissions::readonly()`, che è vero solo quando
    /// **nessuna** delle tre classi ha il bit di scrittura: un file `0644`
    /// di un altro utente è «scrivibile» per `readonly()` e non lo è per noi.
    /// Si sceglie quindi la classe che il sistema applicherebbe al processo —
    /// il proprietario se l'utente effettivo è il suo, il gruppo se il
    /// gruppo del file è il gruppo effettivo o uno dei supplementari, gli
    /// altri altrimenti — e si guarda il suo bit, come fa `access(2)`.
    ///
    /// **Root**: il sistema gli lascia scrivere tutto, e `access(2)` gli
    /// risponderebbe sempre sì. Qui no, perché la domanda non è «il sistema
    /// lo permette» ma «qualcuno ha segnato il file come da non toccare»: per
    /// root un file è in sola lettura quando nessuna delle tre classi ha il
    /// bit di scrittura. Le ACL restano fuori: sono rare nei vault, e un
    /// file che le usa per *dare* la scrittura ha comunque un bit di classe.
    ///
    /// Su Windows è l'attributo di sola lettura, che vale per tutti.
    pub(crate) fn writable(self) -> bool {
        #[cfg(unix)]
        {
            // SAFETY: `geteuid` e `getegid` non prendono argomenti e non
            // possono fallire.
            let euid = unsafe { libc::geteuid() };
            let egid = unsafe { libc::getegid() };
            unix_writable(
                self.mode,
                self.uid,
                self.gid,
                euid,
                egid,
                &supplementary_groups(),
            )
        }
        #[cfg(not(unix))]
        {
            !self.read_only
        }
    }
}

/// La regola di [`WriteBits::writable`] su Unix, senza chiedere niente al
/// sistema: così si prova anche il caso di root e quello del gruppo.
#[cfg(unix)]
pub(super) fn unix_writable(
    mode: u32,
    uid: u32,
    gid: u32,
    euid: u32,
    egid: u32,
    groups: &[u32],
) -> bool {
    if euid == 0 {
        return mode & 0o222 != 0;
    }
    let bit = if euid == uid {
        0o200
    } else if egid == gid || groups.contains(&gid) {
        0o020
    } else {
        0o002
    };
    mode & bit != 0
}

/// I gruppi supplementari del processo; vuoto se il sistema non risponde
/// (allora vale il gruppo effettivo, e al più si rifiuta un file che si
/// sarebbe potuto scrivere: il verso sicuro).
#[cfg(unix)]
fn supplementary_groups() -> Vec<libc::gid_t> {
    // SAFETY: con 0 `getgroups` non scrive niente e dice quanti sono.
    let count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if count <= 0 {
        return Vec::new();
    }
    let mut groups: Vec<libc::gid_t> = vec![0; count as usize];
    // SAFETY: il buffer ha `count` elementi, e `getgroups` non ne scrive di più.
    let filled = unsafe { libc::getgroups(count, groups.as_mut_ptr()) };
    if filled < 0 {
        return Vec::new();
    }
    groups.truncate(filled as usize);
    groups
}

/// Il rifiuto di sovrascrivere un file in sola lettura: `PermissionDenied`,
/// col nome del file, prima di creare qualunque temporaneo.
pub(crate) fn refuse_read_only(path: &Utf8Path, bits: WriteBits) -> io::Result<()> {
    if bits.writable() {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        ReadOnlyFile(path.to_owned()),
    ))
}

/// L'errore dentro l'`io::Error` di [`refuse_read_only`]: dice **quale**
/// permesso negato è, senza leggere la prosa.
///
/// Un `PermissionDenied` del sistema può voler dire molte cose — una cartella
/// che non si elenca all'apertura, una che non si scrive — e ognuna ha già la
/// sua faccia nel contratto. Questo è il solo che il kernel porta a
/// [`PluginError::PermissionDenied`](fub_abi::PluginError::PermissionDenied):
/// il file c'è, e chi lo ha messo in sola lettura ha detto di non toccarlo.
#[derive(Debug)]
pub(crate) struct ReadOnlyFile(pub(crate) Utf8PathBuf);

impl std::fmt::Display for ReadOnlyFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "il file è in sola lettura: {}", self.0)
    }
}

impl std::error::Error for ReadOnlyFile {}

/// Quanto vecchio dev'essere un temporaneo di scrittura perché nessuno lo stia
/// più scrivendo: **un giorno**.
///
/// Un temporaneo vive una frazione di secondo — il file si crea, i byte
/// atterrano, la rename lo porta al suo nome — e le vie d'errore lo tolgono
/// tutte. L'unica cosa che gliene lascia uno per terra è un **crash** fra la
/// creazione e la rename: da lì in poi quel file non ha più nessuno che lo
/// scriva e nessuno che lo veda, perché la politica di esclusione lo nasconde
/// apposta (§15.6), e ogni crash ne aggiunge un altro.
///
/// La soglia è generosa perché i due errori non si pagano uguale: tenersi un
/// residuo un giorno di troppo costa un file invisibile su un disco, toglierne
/// uno vivo costa la scrittura di qualcuno, che si ritrova la rename senza
/// sorgente. Ed è l'**età** e non il pid che il nome pure porta: un pid è un
/// fatto di *una* macchina — su un vault condiviso non vuol dire niente, e chi
/// lo riusa fa scambiare per vivo un temporaneo morto — mentre un giorno fa è
/// un giorno fa dappertutto.
pub(crate) const TEMP_FILE_EXPIRY_MS: u64 = 24 * 60 * 60 * 1000;

/// Il path del compagno di lock di un file: **accanto**, e con un nome che
/// comincia per punto.
///
/// È la gemella di [`tmp_path`] e sta qui per la stessa ragione: chi conosce
/// una forma è chi la scrive, e la forma la rilegge
/// [`is_write_lock`] qui accanto.
pub(super) fn lock_path(path: &Utf8Path) -> Utf8PathBuf {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let name = path.file_name().unwrap_or("senza-nome");
    dir.join(format!(".{name}.lock"))
}

/// Questo nome è il compagno di lock di un file?
///
/// Il punto davanti **non basta a nasconderlo**, ed è la §15.6 nella stessa
/// forma in cui vale per il temporaneo: da quando un vault può dichiarare che i
/// nascosti sono documenti, un file di servizio nascosto dal punto è un
/// documento appena qualcuno accende quella casella. Oggi ogni file protetto
/// sta dentro `.fub/` o fuori dal vault, quindi il danno non si vede — ma a
/// tenerlo lontano è *dove stanno quei file*, non una regola, e il giorno che
/// qualcuno prende il lock su qualcosa che sta nella radice il suo compagno
/// prende un [`DocId`](fub_abi::DocId), entra in anagrafe e si cerca. È il
/// difetto 0151, e la riparazione è dichiarare la forma invece di fidarsi della
/// posizione.
///
/// Riconosce `.qualcosa.lock` e non «finisce per `.lock`»: `Cargo.lock` e
/// `flake.lock` sono note di nessuno ma sono file che uno può volersi tenere nel
/// vault, e non cominciano per punto.
pub(crate) fn is_write_lock(name: &str) -> bool {
    name.strip_prefix('.')
        .and_then(|rest| rest.strip_suffix(".lock"))
        .is_some_and(|base| !base.is_empty())
}

/// Questo nome è il temporaneo di una scrittura in corso?
///
/// Sta qui e non nella politica di esclusione perché il nome lo compone
/// [`tmp_path`], e chi conosce una forma è chi la scrive: la §15.6 chiede alla
/// politica *se* il temporaneo partecipa, e la politica chiede a questo modulo
/// *qual è*. Riconosce la forma intera — punto davanti, `.tmp`, il pid e il
/// numero di sequenza — e non solo il punto, perché il punto da solo è la
/// preferenza sui nascosti, che un vault può ribaltare.
pub(crate) fn is_write_temporary(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.') else {
        return false;
    };
    let Some((base, queue)) = rest.rsplit_once(".tmp") else {
        return false;
    };
    let Some((pid, seq)) = queue.split_once('-') else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    !base.is_empty() && digits(pid) && digits(seq)
}

/// Quanti nomi ha il file a un path — **e il quarto valore, che è il punto**.
///
/// Un conteggio di hardlink sembra un numero e invece è una risposta a una
/// domanda che su qualche piattaforma non si può porre. Finché il tipo era un
/// `bool`, «ne ha uno solo» e «non lo so» erano lo stesso valore, e su Windows
/// era sempre il secondo travestito da primo: `false` costante, con un commento
/// accanto che lo ammetteva. Un commento non prende nessuna decisione — la
/// prende [`how_to_write`], e per prenderla ha bisogno che i casi siano
/// distinti (§23.16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileNames {
    /// Il file non c'è ancora: zero nomi, e niente da conservare.
    None,
    /// Un nome solo. L'inode è nostro, e sostituirlo non toglie niente a
    /// nessuno.
    One,
    /// Più di uno: un hardlink. Sostituire l'inode ne staccherebbe **uno**, e
    /// gli altri resterebbero fermi al contenuto di prima.
    MoreThanOne,
    /// **Non lo sappiamo**, e non è la stessa cosa di [`FileNames::One`]. È il
    /// valore di una piattaforma che gli hardlink li sa avere ma non li sa
    /// contare, o di una syscall che è fallita.
    Unknown,
}

/// Le due strade di una scrittura: si sostituisce il file, o gli si scrive
/// dentro.
///
/// È il tipo di ritorno di [`FsStorage::write_con`] perché la strada presa è
/// l'unica cosa osservabile di questa scelta che non richieda di guardare un
/// inode — cioè l'unica che si possa presidiare su **ogni** piattaforma.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Temporaneo accanto, `fsync`, rename: atomica, e cambia l'inode.
    Replacing,
    /// `create` + `sync_all` sull'inode che c'è: conserva i titolari, e perde
    /// l'atomicità.
    InPlace,
}

/// La decisione, **pura**: dato cosa c'è già a quel path, come si scrive.
///
/// Sta fuori da [`FsStorage::write`] e non è una scomposizione di comodo: è la
/// sola metà della §15.2 che non dipende dal filesystem sotto, quindi è la sola
/// che un banco possa esercitare intera su qualunque piattaforma. Il rilevamento
/// — [`nomi_del_file`] — resta l'altra metà, e quella la piattaforma se la tiene.
///
/// [`NomiDelFile::Ignoto`] sceglie **sul posto**, ed è la riga che vale la voce.
/// L'argomento è quello della
/// [0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md), preso
/// sul serio fino in fondo: i due danni non sono uguali — il file troncato vuole
/// un crash *durante* la scrittura ed è visibile, il nome staccato avviene a
/// ogni salvataggio e non lo vede nessuno. Davanti a un dubbio si paga quello
/// che si vede.
pub fn how_to_write(link: bool, names: FileNames) -> WriteMode {
    if link {
        // La rename sostituirebbe il collegamento, e da quel momento il file
        // vero non riceverebbe più niente. Non serve contare: un symlink ha
        // già un altro titolare per definizione, ed è l'unico ramo che non è
        // mai dipeso dalla piattaforma.
        return WriteMode::InPlace;
    }
    match names {
        FileNames::None | FileNames::One => WriteMode::Replacing,
        FileNames::MoreThanOne | FileNames::Unknown => WriteMode::InPlace,
    }
}

/// Cosa c'è **già** a questo path, senza seguire un eventuale collegamento.
///
/// Una riga sola con un nome, ed è la metà vera di [`FsStorage::write_with`] che
/// tocca il disco: passandola invece di nominarla, un banco può far rispondere
/// «permesso negato» a questa domanda senza rompere niente. Vedi il doc di
/// `write_with`.
pub fn what_c_and(path: &Utf8Path) -> io::Result<std::fs::Metadata> {
    std::fs::symlink_metadata(path)
}

/// Quanti nomi ha il file a questo path, **chiedendolo alla piattaforma**.
///
/// Riceve i metadati che il chiamante ha già letto *e* il path, perché le due
/// piattaforme rispondono a domande diverse: su unix il conteggio è già dentro i
/// metadati (`nlink`), su Windows sta dietro un **handle** e va aperto il file.
/// Una firma `fn(&Metadata) -> …` — la forma che sembrava ovvia — non può
/// esprimere il caso Windows, ed è la ragione per cui la funzione prende due
/// argomenti invece di uno.
pub fn file_names(path: &Utf8Path, metadata: &std::fs::Metadata) -> FileNames {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = path;
        if metadata.nlink() > 1 {
            FileNames::MoreThanOne
        } else {
            FileNames::One
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };

        let _ = metadata;
        // L'apertura in sola lettura è il prezzo del conteggio su questa
        // piattaforma, e si paga **una volta per salvataggio** — accanto a una
        // scrittura, a un `fsync` e a una rename. Un file che non si riesce ad
        // aprire non è un file con un nome solo: è un file di cui non sappiamo
        // niente, e la differenza la porta `Ignoto`.
        let Ok(file) = std::fs::File::open(path) else {
            return FileNames::Unknown;
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: l'handle è vivo per tutta la chiamata (`file` non cade prima),
        // e `info` è una struttura del chiamante che la funzione riempie.
        let outcome = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
        if outcome == 0 {
            return FileNames::Unknown;
        }
        if info.nNumberOfLinks > 1 {
            FileNames::MoreThanOne
        } else {
            FileNames::One
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        // Non è un `else` di comodo: è la dichiarazione che su questa
        // piattaforma la domanda non ha risposta, e `how_to_write` sa cosa
        // farne. Prima qui c'era `false`, cioè la risposta sbagliata detta con
        // sicurezza.
        let _ = (path, metadata);
        FileNames::Unknown
    }
}

/// **Chi è** il file a questo path, secondo la piattaforma: il volume e il
/// numero che lo distinguono dagli altri file dello stesso volume.
///
/// È la sola risposta possibile alla domanda «questi due path nominano lo stesso
/// file?», e nessun confronto fra stringhe la sostituisce: se `nota.md` e
/// `Nota.md` siano un posto o due lo decide **il filesystem** — APFS e NTFS
/// dicono uno, ext4 due, e sullo stesso volume APFS può dire l'una o l'altra
/// perché la sensibilità al caso si sceglie a formattazione. Un `to_lowercase()`
/// scritto al posto di questa funzione risponderebbe per la piattaforma su cui
/// gira chi lo ha scritto.
///
/// `None` è «non lo so», e comprende il file che non c'è: chi la chiama non deve
/// poterlo confondere con un'identità: due `None` **non** sono lo stesso file.
/// È la stessa distinzione di [`NomiDelFile::Ignoto`] e per la stessa ragione —
/// davanti a un dubbio si paga ciò che si vede, e ciò che si vede è un file
/// seppellito.
///
/// Segue i collegamenti di proposito, al contrario di [`what_c_and`]: la domanda è
/// «dove si finisce a scrivere», e chi scrive attraverso un symlink scrive nel
/// file puntato.
pub fn identity_of_the_file(path: &Utf8Path) -> Option<Identity> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(path).ok()?;
        Some(Identity {
            volume: metadata.dev(),
            file: metadata.ino(),
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
        };

        // Come per il conteggio dei nomi (§23.16), su questa piattaforma
        // l'identità sta dietro un handle: i metadati di `std` non la portano.
        // L'handle chiede solo gli attributi, e il flag lo apre anche su una
        // cartella (la radice di un mount): senza, una cartella risponde
        // «accesso negato» e non ha identità. Segue i link, come `metadata`.
        let file = std::fs::OpenOptions::new()
            .access_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
            .ok()?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: l'handle è vivo per tutta la chiamata (`file` non cade prima),
        // e `info` è una struttura del chiamante che la funzione riempie.
        let outcome = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
        if outcome == 0 {
            return None;
        }
        Some(Identity {
            volume: info.dwVolumeSerialNumber as u64,
            file: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

#[cfg(unix)]
pub(crate) fn unix_change_stamp(seconds: i64, nanos: i64) -> u64 {
    let ticks = (seconds as i128)
        .saturating_mul(1_000_000_000)
        .saturating_add(nanos as i128);
    ticks.clamp(0, u64::MAX as i128) as u64
}

#[cfg(windows)]
pub(crate) fn windows_change_stamp(handle: std::os::windows::io::RawHandle) -> io::Result<u64> {
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, GetFileInformationByHandleEx, FILE_BASIC_INFO,
    };

    let mut info: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
    // SAFETY: l'handle resta vivo nel chiamante per tutta la syscall e `info`
    // è un buffer della dimensione esatta che Windows riempie soltanto.
    let outcome = unsafe {
        GetFileInformationByHandleEx(
            handle as _,
            FileBasicInfo,
            (&mut info as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    };
    if outcome == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info.ChangeTime.max(0) as u64)
}

pub(super) fn change_stamp_of_file(path: &Utf8Path) -> io::Result<Option<u64>> {
    #[cfg(unix)]
    let stamp = {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(path)?;
        Some(unix_change_stamp(metadata.ctime(), metadata.ctime_nsec()))
    };
    #[cfg(windows)]
    let stamp = {
        use std::os::windows::io::AsRawHandle;
        let file = std::fs::File::open(path)?;
        Some(windows_change_stamp(file.as_raw_handle())?)
    };
    #[cfg(not(any(unix, windows)))]
    let stamp = {
        let _ = path;
        None
    };
    Ok(stamp)
}

/// L'identità di un file: il volume e il numero che lo distingue là dentro.
///
/// Due path con la stessa [`Identita`] sono lo stesso file, comunque siano
/// scritti; due path con identità diverse sono due file, anche se i byte dentro
/// sono gli stessi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    /// Il volume: `st_dev` su unix, il numero di serie del volume su Windows.
    /// Senza, due file su due dischi diversi possono avere lo stesso numero.
    pub volume: u64,
    /// Il file dentro il volume: l'inode su unix, l'indice del file su Windows.
    pub file: u64,
}
