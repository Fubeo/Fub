//! **Il supporto**: il posto unico da cui il kernel tocca i byte di un vault
//! (§15.1).
//!
//! Un vault è una cartella sul filesystem, e per tutta la vita del progetto lo
//! è stata anche nel codice: `std::fs` chiamato dove serviva, in una dozzina di
//! punti fra il [`Vault`](crate::vault::Vault), lo spazio dati dei plugin e la
//! migrazione dello stato per-documento. Qui quella dozzina diventa **un
//! trait**, [`VaultStorage`], con [`FsStorage`] come implementazione di default
//! e [`MemStorage`] come seconda.
//!
//! # Perché non è un dettaglio di implementazione
//!
//! Perché cinque famiglie di FEATURES chiedono **cinque supporti diversi allo
//! stesso identico posto**: la cifratura at-rest (23.1), i vault remoti e il
//! sync (18.1), la PWA su OPFS (26.3), i vault read-only e su share di rete
//! (3.1), i drive rimovibili (2.3). Con `std::fs` sparso, ognuna di quelle
//! righe è un `if` in mezzo al kernel; con un trait, è un `impl` che nessun
//! cliente vede.
//!
//! La cifratura è il caso che decide, ed è la ragione per cui questo non poteva
//! essere un plugin: funziona solo se sta **sotto** `data_*` e `vault_*`, dove
//! nessun chiamante ha modo di dimenticarsene. Un plugin di cifratura farebbe
//! attraversare il confine a ogni byte del vault due volte, e l'indice di
//! ricerca — che persiste attraverso lo spazio dati come chiunque altro —
//! resterebbe in chiaro comunque.
//!
//! # Cosa questo trait **non** promette
//!
//! La **durabilità**. [`VaultStorage::write`] dice «questi byte, a questo
//! path», e non dice niente su cosa resta se la corrente va via a metà: oggi
//! [`FsStorage`] è una `std::fs::write`, e un crash lascia un file troncato
//! esattamente come prima. È deliberato ed è l'ordine della
//! [seduta 15](../../../docs/roadmap/15-il-disco.md): l'atomicità è il **§15.2**,
//! e scenderà *dentro* questa funzione. Metterla qui vorrebbe dire decidere di
//! straforo che un documento del vault si riscrive con una rename — cioè che
//! cambia inode a ogni salvataggio, con quel che comporta per gli hardlink, per
//! i symlink e per chi guarda la cartella da fuori. È una scelta con un prezzo,
//! e le scelte con un prezzo si mettono a verbale.
//!
//! L'altro asse — la **classe** di un dato, «si può buttare o no» — non è di
//! qui affatto: sta nel path, e l'ha deciso la
//! [0048](../../../docs/decisions/0048-una-radice-sola.md). Un supporto non sa
//! cosa sta scrivendo, e non deve saperlo.
//!
//! # Il recinto non è qui
//!
//! Un `VaultStorage` prende path **assoluti** e li usa. Chi decide che un
//! plugin non può nominare `../../etc/passwd` è
//! [`Workspace::plugin_data_path`](crate::Workspace), e resta lì: il recinto è
//! una regola sul *nome*, il supporto è il posto dove i byte finiscono. Tenerli
//! separati è ciò che permette allo stesso supporto di servire i documenti del
//! vault — che hanno un altro schema di nomi — senza conoscerne nessuno dei
//! due.

use std::collections::BTreeMap;
use std::io;
use std::sync::Mutex;

use camino::{Utf8Path, Utf8PathBuf};

/// Che cosa è una voce di directory: le due specie che la camminata sa
/// trattare, e **tutto il resto**.
///
/// [`EntryKind::Other`] c'è per i symlink, e con loro per le fifo e i socket.
/// Non è un di più: è la distinzione che `std::fs` nasconde, e che nasconderla
/// costava. Una voce di directory chiesta con `file_type()` non segue il
/// symlink e chiesta con `metadata()` sì, e le due risposte cambiano il
/// comportamento della scansione — la seconda, con un anello di symlink, non
/// torna. Scrivendo questo trait il modo più naturale di dire «specie» era la
/// seconda, cioè un cambiamento di comportamento senza nemmeno una riga di
/// diff che lo dicesse.
///
/// Quindi la specie di una **voce di elenco** ([`VaultStorage::list`]) è quella
/// che non segue il link, e un symlink arriva come `Other`; la specie di uno
/// [`stat`](VaultStorage::stat) — che si chiede su un path, non su una voce —
/// è quella che lo segue, come è sempre stata. Chi cammina salta gli `Other`,
/// che è ciò che il vault faceva già.
///
/// Decidere se seguirli è una **politica** e non un fatto sul supporto: è il
/// §15.6, che li ha avuti in consegna dalla
/// [0058](../../../docs/decisions/0058-un-nome-che-nasce.md). Questa variante
/// è il posto dove quella decisione atterrerà.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Other,
}

/// Ciò che il supporto sa dire di un path **senza aprirlo**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    pub kind: EntryKind,
    /// Byte. Per ciò che non è un file semplice non significa niente e vale `0`.
    pub size: u64,
    /// Millisecondi UNIX; `0` se il supporto non sa dire la data. Zero non è
    /// «1970», è «non lo so», e la conseguenza è quella giusta: una data che non
    /// si conosce non combacia mai con quella di prima, quindi quel file si
    /// rilegge invece di essere dato per immutato
    /// ([0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)).
    pub mtime: u64,
}

impl Stat {
    pub fn is_dir(&self) -> bool {
        self.kind == EntryKind::Dir
    }

    pub fn is_file(&self) -> bool {
        self.kind == EntryKind::File
    }
}

/// Una voce restituita da [`VaultStorage::list`]: il path, **e** i suoi
/// metadati.
///
/// I metadati arrivano insieme al nome e non con una `stat` dopo, ed è ciò che
/// rende gratis l'anagrafe del vault: la camminata ha già in mano ogni voce di
/// directory, e un secondo giro per chiederne dimensione e data sarebbe un
/// secondo giro sul disco. Un supporto che non li avesse in mano li mette a
/// zero — che è già ciò che il campo significa.
#[derive(Debug, Clone)]
pub struct DirEntry {
    pub path: Utf8PathBuf,
    pub stat: Stat,
}

/// Il supporto su cui vive un vault.
///
/// Sette operazioni, e sono quelle che il kernel usa davvero: chi ne aggiunge
/// un'ottava sta chiedendo al supporto di sapere qualcosa sul contenuto.
///
/// # Gli errori sono `io::Error` e non `KernelError`
///
/// Perché un supporto non conosce il vault: non sa se il path che gli hanno
/// passato è un documento, un blob di un plugin o un sidecar, e un errore che
/// nominasse la cosa sbagliata sarebbe peggio di uno generico. A dare un nome
/// al guasto è chi chiama, che quel contesto ce l'ha —
/// `KernelError::Io { path, source }` — e lo fa già.
///
/// # `Send + Sync`
///
/// Perché il vault lo attraversano i job (§9.3), che girano su altri thread.
/// Non è una richiesta di questo modulo: è il posto in cui si vede.
pub trait VaultStorage: Send + Sync {
    /// I byte a questo path.
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>>;

    /// Scrive i byte, **creando le cartelle che mancano**.
    ///
    /// La creazione dei genitori sta qui e non nei chiamanti di proposito: era
    /// ripetuta a ogni scrittura, e ripeterla è il modo in cui un giorno una
    /// scrittura se la dimentica. Sulla durabilità vedi il modulo: non è di
    /// questa firma, è del §15.2.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()>;

    /// Sposta, **creando le cartelle di destinazione che mancano**. Funziona
    /// per un file come per una cartella.
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()>;

    /// Toglie un **file**. Per una cartella c'è [`VaultStorage::remove_dir_all`].
    fn remove(&self, path: &Utf8Path) -> io::Result<()>;

    /// Le voci direttamente dentro `dir` — non ricorsivo, in ordine di path.
    ///
    /// L'ordine è del supporto e non di chi chiama, perché chi chiama sarebbe
    /// costretto a riordinare comunque: `read_dir` restituisce l'ordine del
    /// filesystem, che cambia fra due macchine e fra due corse.
    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>>;

    /// Specie, dimensione e data di **un** path.
    fn stat(&self, path: &Utf8Path) -> io::Result<Stat>;

    /// C'è qualcosa a questo path?
    ///
    /// Ha un default perché è [`VaultStorage::stat`] con la risposta buttata
    /// via, e un supporto che sapesse rispondere più in fretta lo sovrascrive.
    fn exists(&self, path: &Utf8Path) -> bool {
        self.stat(path).is_ok()
    }

    /// Toglie una cartella e tutto ciò che contiene.
    ///
    /// Ha un default composto dalle altre — si cammina e si toglie — perché
    /// **non è una capacità in più**: è un'operazione che chiunque implementi le
    /// sette può fare, e chiederla come ottava vorrebbe dire farla scrivere
    /// daccapo a ogni supporto. [`FsStorage`] la sovrascrive perché il
    /// filesystem la sa fare in un colpo solo.
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        for entry in self.list(dir)? {
            match entry.stat.kind {
                EntryKind::Dir => self.remove_dir_all(&entry.path)?,
                // Un symlink si toglie, non si segue: togliere ciò a cui punta
                // vorrebbe dire cancellare fuori dal vault.
                EntryKind::File | EntryKind::Other => self.remove(&entry.path)?,
            }
        }
        self.remove_empty_dir(dir)
    }

    /// Toglie una cartella **vuota**. Esiste solo per dare un fondo al default
    /// di [`VaultStorage::remove_dir_all`]: chi la sovrascrive non la usa.
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()>;
}

// --- il filesystem ---------------------------------------------------------

/// Il supporto di default: il filesystem, come è sempre stato.
///
/// Non ha stato — è un token — e per questo si passa per valore o dentro un
/// `Arc` senza pensarci.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsStorage;

/// L'mtime in millisecondi UNIX. Vedi
/// [`VaultEntry::mtime`](fub_abi::traits::VaultEntry::mtime) per il perché dei
/// millisecondi e non dei secondi né dei nanosecondi.
fn mtime_millis(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn stat_of(meta: &std::fs::Metadata) -> Stat {
    stat_con(
        if meta.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        },
        meta,
    )
}

fn stat_con(kind: EntryKind, meta: &std::fs::Metadata) -> Stat {
    Stat {
        kind,
        size: if kind == EntryKind::File {
            meta.len()
        } else {
            0
        },
        mtime: mtime_millis(meta),
    }
}

fn non_utf8(path: &std::path::Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("path non rappresentabile in UTF-8: {}", path.display()),
    )
}

impl VaultStorage for FsStorage {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(from, to)
    }

    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        std::fs::remove_file(path)
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path =
                Utf8PathBuf::from_path_buf(entry.path()).map_err(|raw| non_utf8(raw.as_path()))?;
            let file_type = entry.file_type()?;
            let kind = if file_type.is_dir() {
                EntryKind::Dir
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            // I metadati si chiedono solo a ciò che si sa già cosa sia. Un
            // symlink rotto non ne ha, e chiederglieli farebbe fallire
            // l'elenco intero per una voce che chi cammina salta comunque.
            let stat = match kind {
                EntryKind::Other => Stat {
                    kind,
                    size: 0,
                    mtime: 0,
                },
                _ => stat_con(kind, &entry.metadata()?),
            };
            out.push(DirEntry { path, stat });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
        std::fs::metadata(path).map(|meta| stat_of(&meta))
    }

    fn exists(&self, path: &Utf8Path) -> bool {
        path.exists()
    }

    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir_all(dir)
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir(dir)
    }
}

// --- la memoria ------------------------------------------------------------

/// Un vault in memoria: la **seconda implementazione** che tiene onesto il
/// trait.
///
/// # Non è il banco di prova dei test e2e
///
/// Il §15.1 nasceva col movente «oggi ogni test e2e tocca il disco», e quel
/// movente è stato **tolto** perché lavora contro il §15.2: tutto il punto della
/// durabilità è temp+rename+fsync sulla directory, cioè una proprietà che esiste
/// solo su un filesystem vero. Una suite spostata qui sopra smetterebbe di
/// esercitare esattamente ciò che il §15.2 esiste per aggiungere, e il presidio
/// della durabilità diventerebbe verde su un supporto che non ha durabilità.
///
/// Serve a due cose, e sono altre: essere il secondo cliente di
/// [`VaultStorage`] — un'astrazione con un cliente solo non è un'astrazione, è
/// un rinvio — e reggere i test *unitari* di chi ci sta sopra. I test di
/// durabilità restano su [`FsStorage`].
///
/// # Le cartelle esistono
///
/// Non si deducono dai path dei file, e non è pignoleria: è la stessa
/// differenza fra una cartella e un prefisso che il §14.3 ha già pagato una
/// volta. Una cartella vuota non compare in nessun path e c'è lo stesso.
///
/// # Il tempo
///
/// L'mtime è un contatore che avanza di uno a ogni scrittura, non un orologio.
/// Chi ci sta sopra guarda se la data è **cambiata**, non che ora fosse
/// ([0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)), e un
/// contatore risponde a quella domanda in modo deterministico — cioè senza la
/// risoluzione dell'orologio di mezzo, che sui filesystem veri è il motivo per
/// cui mtime+size bastano a saltare un file e non a crederci.
#[derive(Debug, Default)]
pub struct MemStorage {
    inner: Mutex<Mem>,
}

#[derive(Debug, Default)]
struct Mem {
    files: BTreeMap<Utf8PathBuf, (Vec<u8>, u64)>,
    dirs: std::collections::BTreeSet<Utf8PathBuf>,
    tick: u64,
}

impl Mem {
    fn make_dirs(&mut self, path: &Utf8Path) {
        let mut cur = Utf8PathBuf::new();
        for comp in path.components() {
            cur.push(comp);
            self.dirs.insert(cur.clone());
        }
    }
}

fn not_found(path: &Utf8Path) -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, format!("{path}: non esiste"))
}

impl MemStorage {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Mem> {
        self.inner.lock().expect("supporto in memoria")
    }
}

impl VaultStorage for MemStorage {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        self.lock()
            .files
            .get(path)
            .map(|(bytes, _)| bytes.clone())
            .ok_or_else(|| not_found(path))
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.dirs.contains(path) {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("{path}: è una cartella"),
            ));
        }
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent);
        }
        mem.tick += 1;
        let tick = mem.tick;
        mem.files.insert(path.to_owned(), (bytes.to_vec(), tick));
        Ok(())
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if let Some(parent) = to.parent() {
            mem.make_dirs(parent);
        }
        if let Some(entry) = mem.files.remove(from) {
            mem.files.insert(to.to_owned(), entry);
            return Ok(());
        }
        if !mem.dirs.contains(from) {
            return Err(not_found(from));
        }
        // Una cartella si sposta con tutto ciò che ha dentro, e i path dentro
        // sono chiavi: si riscrivono. È l'unica operazione che in memoria costa
        // più che sul filesystem, e vale la pena perché il chiamante che sposta
        // uno spazio per-documento (§13.2) sposta esattamente una cartella.
        let sposta = |vecchio: &Utf8Path| -> Option<Utf8PathBuf> {
            vecchio.strip_prefix(from).ok().map(|resto| {
                if resto.as_str().is_empty() {
                    to.to_owned()
                } else {
                    to.join(resto)
                }
            })
        };
        let files: Vec<_> = mem
            .files
            .keys()
            .filter_map(|k| sposta(k).map(|nuovo| (k.clone(), nuovo)))
            .collect();
        for (vecchio, nuovo) in files {
            let entry = mem.files.remove(&vecchio).expect("appena elencato");
            mem.files.insert(nuovo, entry);
        }
        let dirs: Vec<_> = mem
            .dirs
            .iter()
            .filter_map(|k| sposta(k).map(|nuovo| (k.clone(), nuovo)))
            .collect();
        for (vecchio, nuovo) in dirs {
            mem.dirs.remove(&vecchio);
            mem.dirs.insert(nuovo);
        }
        Ok(())
    }

    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        self.lock()
            .files
            .remove(path)
            .map(|_| ())
            .ok_or_else(|| not_found(path))
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let mem = self.lock();
        if !mem.dirs.contains(dir) {
            return Err(not_found(dir));
        }
        let figlio = |path: &Utf8Path| path.parent() == Some(dir);
        let mut out: Vec<DirEntry> = mem
            .files
            .iter()
            .filter(|(path, _)| figlio(path))
            .map(|(path, (bytes, tick))| DirEntry {
                path: path.clone(),
                stat: Stat {
                    kind: EntryKind::File,
                    size: bytes.len() as u64,
                    mtime: *tick,
                },
            })
            .chain(
                mem.dirs
                    .iter()
                    .filter(|path| figlio(path))
                    .map(|path| DirEntry {
                        path: path.clone(),
                        stat: Stat {
                            kind: EntryKind::Dir,
                            size: 0,
                            mtime: 0,
                        },
                    }),
            )
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
        let mem = self.lock();
        if let Some((bytes, tick)) = mem.files.get(path) {
            return Ok(Stat {
                kind: EntryKind::File,
                size: bytes.len() as u64,
                mtime: *tick,
            });
        }
        if mem.dirs.contains(path) {
            return Ok(Stat {
                kind: EntryKind::Dir,
                size: 0,
                mtime: 0,
            });
        }
        Err(not_found(path))
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if !mem.dirs.remove(dir) {
            return Err(not_found(dir));
        }
        Ok(())
    }
}
