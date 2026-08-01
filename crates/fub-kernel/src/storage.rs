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
//! # La durabilità è scesa qui dentro
//!
//! [`VaultStorage::write`] dice «questi byte, a questo path», **o niente**: chi
//! rilegge dopo un crash trova il contenuto di prima o quello nuovo, mai un file
//! a metà. Non era così quando questo modulo è nato — era una `std::fs::write` —
//! ed è l'ordine che la [seduta 15](../../../docs/roadmap/15-il-disco.md) aveva
//! dichiarato: il §15.1 fa il posto, il §15.2 ci mette dentro la proprietà
//! ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)),
//! invece di scriverla due volte — una accanto all'astrazione e una dentro.
//!
//! La promessa è di **una scrittura**, non di un aggiornamento: due processi che
//! ricompongono lo stesso file dalla propria copia in memoria atterrano ognuno
//! un file integro, e il secondo cancella le chiavi del primo. Quella è la *lost
//! update*, e chiede un'altra funzione — [`update_atomic`], che rilegge sotto
//! lock prima di comporre
//! ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
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
use std::io::Write as _;
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
/// Otto operazioni, e sono quelle che il kernel usa davvero. La regola con cui
/// questo trait è nato era «sette, e chi ne aggiunge un'ottava sta chiedendo al
/// supporto di sapere qualcosa sul contenuto»; l'ottava è arrivata
/// ([`VaultStorage::append`], con la
/// [0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md))
/// e quella frase è il metro con cui è stata giudicata invece che il veto che
/// sembrava: `append` non chiede di sapere **cosa** c'è nel file, chiede di
/// sapere **dove finisce**, che è l'unica cosa che un supporto sa già di ogni
/// file che tiene.
///
/// Il criterio vero per distinguere un'operazione da una comodità sta più sotto,
/// in [`VaultStorage::remove_dir_all`]: ciò che si **compone** dalle altre ha un
/// default e non è una capacità in più. `append` non si compone — leggi+riscrivi
/// costa l'intero file a ogni riga, e non è nemmeno la stessa cosa quando la si
/// paga — quindi è un'operazione.
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

    /// Scrive i byte, **creando le cartelle che mancano**, e **o c'è o non
    /// c'è**: chi rilegge dopo un crash trova questi byte o quelli di prima,
    /// mai una metà dei due (§15.2).
    ///
    /// La creazione dei genitori sta qui e non nei chiamanti di proposito: era
    /// ripetuta a ogni scrittura, e ripeterla è il modo in cui un giorno una
    /// scrittura se la dimentica. Vale identico per l'atomicità, ed è la ragione
    /// per cui non ci sono due scritture fra cui scegliere: una scelta offerta a
    /// ogni chiamante è una scelta che qualcuno un giorno fa storta, e la fa
    /// storta sul file dell'utente.
    ///
    /// Un supporto che non sa dare la proprietà non ha modo di dirlo in questa
    /// firma, e non è una svista: un supporto in memoria non ha niente a cui
    /// sopravvivere, e uno che scrive su un disco vero la deve. Vedi
    /// [`FsStorage::write`] per cosa costa darla e per i due casi in cui il
    /// prezzo si rifiuta di pagarlo.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()>;

    /// Aggiunge i byte **in coda** a ciò che c'è, creando il file e le cartelle
    /// se mancano.
    ///
    /// Non è una [`write`](VaultStorage::write) scritta diversamente, e le due
    /// promesse non si assomigliano: `write` dice «questi byte o quelli di
    /// prima», `append` dice «ciò che c'era resta dov'è». Un registro
    /// append-only riscritto per intero a ogni riga costerebbe l'intero file a
    /// ogni salvataggio — e la riscrittura di un file **autorevole** è anche
    /// l'unico momento in cui lo si può perdere tutto insieme.
    ///
    /// **L'atomicità di una `write` qui non c'è, ed è il chiamante a doverlo
    /// sapere**: un'aggiunta interrotta a metà lascia in coda dei byte
    /// incompleti. Il supporto non li può nascondere — non sa dove finisca un
    /// record, perché non sa cosa sia un record — quindi a renderli
    /// riconoscibili è il **formato** di chi scrive, e a scartarli è la sua
    /// lettura ([`crate::journal`]).
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()>;

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

/// Il contatore che rende **unico** il nome del temporaneo di
/// [`FsStorage::write`].
///
/// Col processo, distingue due scritture qualunque: due thread di Fub, e due
/// installazioni sulla stessa cartella. Con un `.tmp` fisso si scriverebbero
/// addosso sul temporaneo, e ciò che la rename fa atterrare sarebbe metà
/// dell'uno e metà dell'altro — cioè il file troncato che l'atomicità esiste per
/// non produrre, prodotto dalla sua implementazione.
static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Il path del temporaneo di una scrittura: **accanto** al file, e con un nome
/// che comincia per punto.
///
/// Accanto perché una rename attraverso due filesystem non è una rename, e una
/// cartella di temporanei altrove sarebbe un secondo posto da tenere pulito.
/// Nascosto perché quel file esiste per una frazione di secondo **dentro il
/// vault**, e chi guarda il vault in quella frazione non deve vederlo: la
/// scansione e il rilevatore saltano già ogni nome che comincia per punto
/// (`is_ignored_name`), quindi la regola c'è e basta usarla. Un `Nota.tmp1234-5`
/// accanto a `Nota.md` sarebbe invece un documento nuovo per chiunque stia
/// guardando — il nostro watcher, o Obsidian aperto sulla stessa cartella.
fn tmp_path(path: &Utf8Path) -> Utf8PathBuf {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let name = path.file_name().unwrap_or("senza-nome");
    dir.join(format!(
        ".{name}.tmp{}-{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ))
}

/// Il file a questo path è **condiviso**: un symlink, o un inode con più di un
/// nome.
///
/// Sono i due casi in cui sostituire il file invece del suo contenuto cambia una
/// cosa che non è nostra — vedi [`FsStorage::write`]. `Err` (il file non c'è
/// ancora) è `false`: non c'è niente da conservare.
fn condiviso(meta: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.nlink() > 1
    }
    #[cfg(not(unix))]
    {
        // Windows sa avere hardlink e sa contarli, ma non attraverso
        // `std::fs::Metadata`: chiederlo vorrebbe dire una syscall a mano per
        // ogni scrittura. Il caso resta scoperto, e questa riga è il posto dove
        // si vede — non un `else` implicito.
        let _ = meta;
        false
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

    /// Temporaneo accanto, `fsync`, rename, `fsync` della cartella — **salvo**
    /// quando il file che sostituirebbe è condiviso.
    ///
    /// Le tre righe che rendono la promessa vera e non solo dichiarata:
    ///
    /// - il temporaneo ha un nome **unico e nascosto** (vedi [`tmp_path`]);
    /// - il temporaneo si **sincronizza prima della rename**. Temp+rename dà
    ///   atomicità *rispetto a chi legge*, non durabilità rispetto a un crash:
    ///   senza `sync_all` il nome nuovo può atterrare con dietro un contenuto
    ///   che non è ancora sceso, cioè esattamente il file troncato che questa
    ///   funzione esiste per non produrre;
    ///   e la **cartella** si sincronizza dopo, perché è lei a portare il nome:
    ///   a farlo si prova soltanto, che su Windows una cartella non si apre come
    ///   file e la rename ha un'altra semantica.
    /// - il temporaneo **eredita i permessi** del file che sostituisce. Un file
    ///   nuovo nasce con la umask di chi scrive, e un salvataggio che
    ///   trasformasse un `600` in un `644` avrebbe reso leggibile a tutti una
    ///   nota che l'utente aveva chiuso — una modifica ai permessi senza che
    ///   nessuno l'abbia chiesta.
    ///
    /// # I due casi in cui **non** si sostituisce il file
    ///
    /// Una rename cambia l'inode, e ci sono due situazioni in cui quell'inode
    /// non è solo nostro:
    ///
    /// - il path **è un symlink**: la rename sostituirebbe il collegamento, e da
    ///   quel momento il file vero non riceverebbe più niente. È il modo in cui
    ///   una nota tenuta altrove e collegata dentro il vault smette in silenzio
    ///   di essere la stessa nota;
    /// - il file ha **più di un nome** (hardlink): la rename ne staccherebbe uno
    ///   solo, e l'altro resterebbe fermo al contenuto di prima.
    ///
    /// In entrambi si scrive **sul posto** — `create` + `sync_all` — che
    /// conserva l'inode e perde l'atomicità: un crash a metà lascia il file
    /// troncato, come prima di questa voce. È il verso giusto della scelta,
    /// perché i due danni non sono uguali: il troncamento richiede un crash
    /// *durante* la scrittura ed è visibile, la sostituzione di un collegamento
    /// avviene a ogni salvataggio e non la vede nessuno.
    ///
    /// Il costo è una `symlink_metadata` per scrittura, cioè la stessa syscall
    /// che `std::fs::write` fa comunque aprendo il file.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let esistente = std::fs::symlink_metadata(path).ok();
        let sul_posto = esistente
            .as_ref()
            .is_some_and(|meta| meta.file_type().is_symlink() || condiviso(meta));
        if sul_posto {
            let mut file = std::fs::File::create(path)?;
            file.write_all(bytes)?;
            return file.sync_all();
        }

        let tmp = tmp_path(path);
        let scritto = (|| -> io::Result<()> {
            let mut file = std::fs::File::create(&tmp)?;
            file.write_all(bytes)?;
            if let Some(meta) = &esistente {
                // Best-effort: un filesystem che non sa di permessi (FAT su una
                // chiavetta) non è una ragione per non salvare la nota.
                let _ = std::fs::set_permissions(&tmp, meta.permissions());
            }
            file.sync_all()
        })();
        if let Err(e) = scritto {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        if let Some(dir) = path.parent() {
            if let Ok(dir) = std::fs::File::open(dir) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    }

    /// `O_APPEND` e **nessun `fsync`**: la scelta è a verbale
    /// ([0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md)),
    /// e sta tutta nell'ordine in cui le due scritture avvengono. Chi appende lo
    /// fa **dopo** che la mutazione è riuscita, quindi un crash può far perdere
    /// la coda del registro — le ultime operazioni non si potranno annullare — e
    /// mai il contrario, una riga che racconta qualcosa che non è successo. Un
    /// `fsync` per riga metterebbe un secondo giro sul disco dentro il percorso
    /// del salvataggio, che la
    /// [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) ha
    /// appena fatto pagare una volta, per proteggere un dato il cui smarrimento
    /// costa un annullamento e non una nota.
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        file.write_all(bytes)
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

/// La scrittura del supporto **per chi un supporto non ce l'ha**: i tre file
/// della macchina.
///
/// `settings.json`, `vaults.json` e `view-state.json` stanno nella cartella di
/// configurazione dell'utente, cioè **fuori da ogni vault**: non c'è un
/// [`VaultStorage`] a cui chiederlo, perché non sono roba di un vault — e il
/// giorno in cui un vault vive su OPFS o dentro una share cifrata, la
/// configurazione della macchina resta dov'è. Passano quindi da qui, che è
/// [`FsStorage::write`] con l'errore vestito da stringa per i chiamanti che
/// portano avvisi e non `io::Error`.
///
/// Fino alla [0064](../../../docs/decisions/0064-il-supporto-sta-sotto.md) era
/// il contrario: questa funzione era l'unica scrittura atomica del kernel, e i
/// file *del vault* venivano qui a prendersela scavalcando il supporto. Adesso
/// l'implementazione è **una**, e sta sotto il trait dove ogni supporto la
/// eredita o la sostituisce.
pub fn write_atomic(path: &Utf8Path, bytes: &[u8]) -> Result<(), String> {
    FsStorage
        .write(path, bytes)
        .map_err(|e| format!("non riesco a scrivere {path}: {e}"))
}

/// L'**aggiornamento** di un file della macchina: rileggi sotto lock, fondi,
/// scrivi.
///
/// [`write_atomic`] è l'atomicità di *un file* e non di un *aggiornamento*: chi
/// la chiama ricompone il contenuto intero dalla propria copia in memoria,
/// quindi la seconda installazione che salva atterra un file integro **senza**
/// le chiavi che la prima aveva scritto dopo che lei aveva letto. Nessuna
/// quantità di `fsync` la risolve, perché non è un file a metà: è un file
/// intero e vecchio.
///
/// Le due metà di questa funzione non fanno la stessa cosa, e conviene tenerle
/// distinte:
///
/// - **`rileggi` è ciò che toglie la perdita.** La copia in memoria del
///   chiamante è vecchia per definizione — l'ha letta all'apertura — e ciò che
///   si scrive va composto su quella che c'è sul disco *adesso*, non su quella.
///   Per questo `fondi` riceve lo stato **riletto** e non quello del chiamante,
///   e per questo la funzione restituisce lo stato fuso: chi la chiama deve
///   adottarlo, o la sua copia resterebbe l'unica a non sapere;
/// - **il lock stringe la finestra.** Fra la rilettura e la scrittura resta un
///   istante in cui un altro processo può infilarsi, e il lock del file lo
///   toglie. È **best-effort** di proposito: dove il lock non c'è — una share
///   di rete che non lo implementa — la rilettura vale lo stesso, e rifiutarsi
///   di salvare sarebbe un danno certo al posto di uno improbabile.
///
/// Non ci sono un `write_atomic` e un `update_atomic` fra cui il chiamante
/// sceglie per i file che si aggiornano: chi prende il lock e poi ricompone
/// dalla copia vecchia non ha risolto niente, e la forma giusta si ripeterebbe
/// tre volte. È la ragione della
/// [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) sul
/// perché la scrittura del supporto è una sola.
///
/// `fondi` serializza ciò che ha appena mutato, invece di lasciarlo fare a chi
/// chiama: fra la mutazione e i byte non deve poterci stare una riga.
pub fn update_atomic<T>(
    path: &Utf8Path,
    rileggi: impl FnOnce() -> Result<T, String>,
    fondi: impl FnOnce(&mut T) -> Result<Vec<u8>, String>,
) -> Result<T, String> {
    let _lock = lock_esclusivo(path);
    let mut stato = rileggi()?;
    let bytes = fondi(&mut stato)?;
    write_atomic(path, &bytes)?;
    Ok(stato)
}

/// Il lock esclusivo che accompagna un [`update_atomic`], finché il valore vive.
///
/// Sta su un file **accanto** e non sul file stesso, e non è una preferenza:
/// [`write_atomic`] sostituisce l'inode, quindi un lock preso sul file che si
/// sta per rimpiazzare è un lock su un inode che fra un istante non è più a quel
/// nome — e il processo che arriva dopo la rename ne aprirebbe un altro,
/// prendendoselo senza aspettare nessuno. Il compagno di lock non si rinomina
/// mai, quindi è lo stesso oggetto per tutti.
///
/// Il nome comincia per punto per la ragione del temporaneo di
/// [`tmp_path`]: è un file di servizio, e chi guarda la cartella non lo deve
/// vedere.
///
/// `Err` non si propaga — vedi [`update_atomic`] — quindi qui il tipo di ritorno
/// è un `Option`: o si ha il lock, o si procede senza.
fn lock_esclusivo(path: &Utf8Path) -> Option<std::fs::File> {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let name = path.file_name().unwrap_or("senza-nome");
    let lock_path = dir.join(format!(".{name}.lock"));
    std::fs::create_dir_all(dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .ok()?;
    // `File::lock` è bloccante e si rilascia alla chiusura del file, cioè
    // quando il chiamante lascia cadere ciò che questa funzione ha restituito.
    file.lock().ok()?;
    Some(file)
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

    /// L'atomicità che [`VaultStorage::write`] promette qui è gratis e non
    /// significa niente: la mappa si aggiorna sotto il lucchetto, quindi non
    /// esiste un lettore che veda una scrittura a metà — e non esiste niente a
    /// cui sopravvivere, perché non c'è un crash che lasci indietro questa
    /// memoria. È la ragione per cui i test di durabilità stanno su
    /// [`FsStorage`] e non qui: vedi il modulo di
    /// `crates/fub-kernel/tests/il_supporto.rs`.
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

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
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
        let voce = mem
            .files
            .entry(path.to_owned())
            .or_insert_with(|| (Vec::new(), tick));
        voce.0.extend_from_slice(bytes);
        voce.1 = tick;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Il temporaneo di una scrittura vive dentro il vault per una frazione di
    /// secondo, e in quella frazione **non deve essere un documento**.
    ///
    /// Il presidio è sull'incastro fra due moduli, non su una stringa: il nome
    /// del temporaneo lo compone `storage.rs`, la regola che lo rende invisibile
    /// è `vault::is_ignored_name`, e sono lontani abbastanza perché un giorno
    /// qualcuno cambi il nome del temporaneo senza sapere che c'era una regola
    /// da rispettare. Se succede, questo diventa rosso.
    #[test]
    fn il_temporaneo_di_una_scrittura_non_e_un_documento() {
        for path in [
            "/vault/Nota.md",
            "/vault/note/Idea.md",
            "/vault/senza-punto",
        ] {
            let tmp = tmp_path(Utf8Path::new(path));
            let nome = tmp.file_name().expect("il temporaneo ha un nome");
            assert!(
                crate::vault::is_ignored_name(nome),
                "{nome}: la scansione lo vedrebbe come un documento nuovo"
            );
        }
    }

    /// E sta **accanto** al file, perché una rename fra due filesystem non è una
    /// rename.
    #[test]
    fn il_temporaneo_sta_nella_cartella_di_destinazione() {
        let tmp = tmp_path(Utf8Path::new("/vault/note/Idea.md"));
        assert_eq!(tmp.parent(), Some(Utf8Path::new("/vault/note")));
    }

    /// Due scritture non si scrivono addosso sul temporaneo: se lo facessero,
    /// ciò che la rename fa atterrare sarebbe metà dell'una e metà dell'altra —
    /// il file troncato che l'atomicità esiste per non produrre, prodotto dalla
    /// sua implementazione.
    #[test]
    fn due_scritture_non_hanno_lo_stesso_temporaneo() {
        let a = tmp_path(Utf8Path::new("/vault/Nota.md"));
        let b = tmp_path(Utf8Path::new("/vault/Nota.md"));
        assert_ne!(a, b);
    }
}
