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
use std::sync::MutexGuard;

use crate::veleno::Ricovero;

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
/// Nove operazioni, e sono quelle che il kernel usa davvero. La regola con cui
/// questo trait è nato era «sette, e chi ne aggiunge un'ottava sta chiedendo al
/// supporto di sapere qualcosa sul contenuto»; l'ottava è arrivata
/// ([`VaultStorage::append`], con la
/// [0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md))
/// e quella frase è il metro con cui è stata giudicata invece che il veto che
/// sembrava: `append` non chiede di sapere **cosa** c'è nel file, chiede di
/// sapere **dove finisce**, che è l'unica cosa che un supporto sa già di ogni
/// file che tiene.
///
/// La nona ([`VaultStorage::update`]) passa lo stesso metro dall'altro verso:
/// non chiede al supporto di sapere cosa ci sia nel file — a saperlo è la
/// [`Fusione`], che il chiamante porta con sé — ma di **stare fermo** fra la
/// lettura e la scrittura, che è l'unica cosa che il supporto sa e chi chiama
/// non può sapere. Fuori di qui quella fermata non si può ottenere: chi legge,
/// compone e riscrive dall'esterno perde ciò che un altro ha scritto nel mezzo,
/// e lo perde in silenzio
/// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
///
/// Il criterio vero per distinguere un'operazione da una comodità sta più sotto,
/// in [`VaultStorage::remove_dir_all`]: ciò che si **compone** dalle altre ha un
/// default e non è una capacità in più. `append` non si compone — leggi+riscrivi
/// costa l'intero file a ogni riga, e non è nemmeno la stessa cosa quando la si
/// paga — quindi è un'operazione. `update` nemmeno, e per un motivo più netto:
/// composta da `read` e `write` sarebbe la stessa firma **senza la sola cosa
/// che promette**.
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
/// **La fusione** che [`VaultStorage::update`] chiama fra la rilettura e la
/// scrittura: riceve i byte che ci sono sul supporto *adesso* — `None` se il
/// file non c'è — e restituisce i byte da scrivere, oppure `None` per «non
/// scrivere affatto».
///
/// Ha un nome suo perché è un **parametro di protocollo** e non un dettaglio di
/// firma: chi implementa il supporto deve poterla nominare per riscriverla
/// uguale, e i quattro doppioni di prova nei test la nominano.
pub type Fusione<'a> = &'a mut dyn FnMut(Option<&[u8]>) -> io::Result<Option<Vec<u8>>>;

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
    ///
    /// # Perché torna uno [`Stat`] e non `()`
    ///
    /// Perché **chi ha appena scritto sa già cosa c'è a quel path**, e chi lo
    /// richiedesse con una [`stat`](VaultStorage::stat) non otterrebbe la stessa
    /// risposta: fra la scrittura e la domanda ci sta la cancellazione di un
    /// altro processo, e chi teneva un elenco di ciò che esiste si sentiva dire
    /// «non c'è» di un file che aveva appena posato — dopo aver risposto `Ok` e
    /// aver annunciato la modifica (difetto 0179). La dimensione la sanno i
    /// byte; la **data** la sa solo il supporto, e solo mentre il file che ha
    /// scritto è ancora quello suo.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat>;

    /// **Rilegge, fonde, riscrive** — sotto un lucchetto che tiene fuori chi sta
    /// aggiornando lo stesso file.
    ///
    /// Non è una [`write`](VaultStorage::write) con un passo in più, ed è la
    /// stessa distinzione che [`append`](VaultStorage::append) fa dall'altro
    /// lato: `write` promette «questi byte o quelli di prima», e chi la chiama
    /// ricompone il contenuto intero dalla **propria copia in memoria**, che è
    /// vecchia dall'apertura. La seconda finestra che salva atterra così un file
    /// integro e senza ciò che la prima aveva scritto nel frattempo — una *lost
    /// update*, che nessuna quantità di `fsync` risolve perché non è un file a
    /// metà: è un file intero e vecchio
    /// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
    ///
    /// `fondi` riceve i byte **che stanno sul supporto adesso** (`None` se il
    /// file non c'è) e torna quelli da scrivere, oppure `None` per non scrivere
    /// affatto — che è come si dice «niente è cambiato» senza toccare il disco.
    ///
    /// Non ha un default composto da `read` + `write`, e la ragione è la
    /// differenza con [`remove_dir_all`](VaultStorage::remove_dir_all): là il
    /// default *è* l'operazione, qui sarebbe l'operazione **meno la sua unica
    /// garanzia**. Un supporto che non sa prendere un lucchetto lo deve dire
    /// scrivendolo, non ereditandolo.
    ///
    /// **`fondi` non deve rientrare in questo supporto**: il lucchetto è già
    /// preso, e chiedergli qualcosa da dentro è come minimo un giro inutile e su
    /// [`MemStorage`] un blocco.
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> io::Result<()>;

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

    /// Questi due path nominano **lo stesso file**?
    ///
    /// È la domanda che [`exists`](VaultStorage::exists) non sa fare, e senza la
    /// quale ogni guardia «la destinazione è occupata?» sbaglia sulla rinomina
    /// che corregge una maiuscola: `nota.md` → `Nota.md` trova sé stessa dove il
    /// supporto non distingue il caso (APFS, NTFS), e trova un file davvero
    /// diverso dove lo distingue (ext4). Chi risponde guardando il **nome** —
    /// un `to_lowercase`, o la chiave di risoluzione — risponde per la
    /// piattaforma di chi ha scritto la riga, non per quella su cui gira; e la
    /// differenza fra le due risposte è una bozza cancellata di là e un
    /// documento seppellito di qua (difetti 0165 e 0182).
    ///
    /// Il default è l'uguaglianza dei path, che è la risposta **giusta** per
    /// ogni supporto che tratti un path come una chiave esatta — [`MemStorage`]
    /// e ogni supporto che ci si appoggi. Chi piega i nomi lo deve dire qui,
    /// come lo dice in `read` e in `write`: un supporto che risponde a due nomi
    /// con lo stesso contenuto e a questa domanda con «sono due» è un supporto
    /// che si contraddice.
    ///
    /// Non risale un errore: «non lo so» e «no» sono la stessa cosa per chi
    /// chiama, perché la guardia che ne segue è comunque quella prudente — si
    /// crede che siano due file, e la rinomina si ferma invece di sovrascrivere.
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        a == b
    }

    /// Su questa radice può stare un vault?
    ///
    /// È la domanda che [`Vault::on`](crate::Vault::on) fa **all'ingresso**, e
    /// la risposta è del supporto: solo lui sa cosa significhi «esiste» e
    /// «scrivibile» nel suo mondo (difetto 0160). Un supporto che rispondesse
    /// di sì a una radice impossibile consegnerebbe un vault il cui primo
    /// errore arriva a giro avanzato, con eventi già emessi.
    ///
    /// Il default è la semantica di un supporto che crea le cartelle alla
    /// prima scrittura — [`MemStorage`] e chi ci si appoggia: una radice
    /// mancante è un vault che sta per nascere, una radice che è un **file** è
    /// un vault che non può stare. Un supporto su un disco vero
    /// ([`FsStorage`]) la sovrascrive con la verità del disco: lì una radice
    /// mancante è un errore di chi ha scelto, e va detto subito.
    fn radice_valida(&self, root: &Utf8Path) -> io::Result<()> {
        match self.stat(root) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
            Ok(s) if s.kind == EntryKind::Dir => Ok(()),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("la radice {root} non è una cartella"),
            )),
        }
    }

    /// Da quanto nessuno tocca questa voce — cioè: è **rimasta indietro**?
    ///
    /// La domanda è del supporto per la ragione di
    /// [`radice_valida`](VaultStorage::radice_valida): la risposta si legge sul
    /// **suo** orologio, ed è quello con cui lui data ciò che scrive
    /// ([`Stat::mtime`]). Il default è il tempo di un disco vero, millisecondi
    /// dall'epoca; [`MemStorage`], dove il tempo è un contatore di operazioni,
    /// lo sovrascrive con la stessa forma letta nella sua unità.
    ///
    /// Serve a una cosa sola, e sta sul trait perché quella cosa la fa il
    /// kernel su qualunque supporto: riconoscere il temporaneo di una scrittura
    /// che non finirà mai (difetto 0155, [`SCADENZA_DEL_TEMPORANEO_MS`]).
    fn e_rimasto_indietro(&self, stat: &Stat) -> bool {
        crate::time::now_unix_millis().saturating_sub(stat.mtime) >= SCADENZA_DEL_TEMPORANEO_MS
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
/// vault**, e chi guarda il vault in quella frazione non deve vederlo: un
/// `Nota.tmp1234-5` accanto a `Nota.md` sarebbe un documento nuovo per chiunque
/// stia guardando — il nostro watcher, o Obsidian aperto sulla stessa cartella.
///
/// Che cominci per punto **non basta più a nasconderlo**, ed è la §15.6: da
/// quando un vault può dichiarare che i nascosti sono documenti, l'esclusione
/// del temporaneo non può essere un effetto collaterale di quella preferenza.
/// La forma del nome è perciò una regola, e la dice
/// [`e_temporaneo_di_scrittura`] qui accanto.
fn tmp_path(path: &Utf8Path) -> Utf8PathBuf {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let name = path.file_name().unwrap_or("senza-nome");
    dir.join(format!(
        ".{name}.tmp{}-{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ))
}

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
pub(crate) const SCADENZA_DEL_TEMPORANEO_MS: u64 = 24 * 60 * 60 * 1000;

/// Il path del compagno di lock di un file: **accanto**, e con un nome che
/// comincia per punto.
///
/// È la gemella di [`tmp_path`] e sta qui per la stessa ragione: chi conosce
/// una forma è chi la scrive, e la forma la rilegge
/// [`e_lock_di_scrittura`] qui accanto.
fn lock_path(path: &Utf8Path) -> Utf8PathBuf {
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
pub(crate) fn e_lock_di_scrittura(name: &str) -> bool {
    name.strip_prefix('.')
        .and_then(|resto| resto.strip_suffix(".lock"))
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
pub(crate) fn e_temporaneo_di_scrittura(name: &str) -> bool {
    let Some(resto) = name.strip_prefix('.') else {
        return false;
    };
    let Some((base, coda)) = resto.rsplit_once(".tmp") else {
        return false;
    };
    let Some((pid, seq)) = coda.split_once('-') else {
        return false;
    };
    let cifre = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    !base.is_empty() && cifre(pid) && cifre(seq)
}

/// Quanti nomi ha il file a un path — **e il quarto valore, che è il punto**.
///
/// Un conteggio di hardlink sembra un numero e invece è una risposta a una
/// domanda che su qualche piattaforma non si può porre. Finché il tipo era un
/// `bool`, «ne ha uno solo» e «non lo so» erano lo stesso valore, e su Windows
/// era sempre il secondo travestito da primo: `false` costante, con un commento
/// accanto che lo ammetteva. Un commento non prende nessuna decisione — la
/// prende [`come_scrivere`], e per prenderla ha bisogno che i casi siano
/// distinti (§23.16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomiDelFile {
    /// Il file non c'è ancora: zero nomi, e niente da conservare.
    Nessuno,
    /// Un nome solo. L'inode è nostro, e sostituirlo non toglie niente a
    /// nessuno.
    Uno,
    /// Più di uno: un hardlink. Sostituire l'inode ne staccherebbe **uno**, e
    /// gli altri resterebbero fermi al contenuto di prima.
    PiuDiUno,
    /// **Non lo sappiamo**, e non è la stessa cosa di [`NomiDelFile::Uno`]. È il
    /// valore di una piattaforma che gli hardlink li sa avere ma non li sa
    /// contare, o di una syscall che è fallita.
    Ignoto,
}

/// Le due strade di una scrittura: si sostituisce il file, o gli si scrive
/// dentro.
///
/// È il tipo di ritorno di [`FsStorage::write_con`] perché la strada presa è
/// l'unica cosa osservabile di questa scelta che non richieda di guardare un
/// inode — cioè l'unica che si possa presidiare su **ogni** piattaforma.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComeScrivere {
    /// Temporaneo accanto, `fsync`, rename: atomica, e cambia l'inode.
    Sostituendo,
    /// `create` + `sync_all` sull'inode che c'è: conserva i titolari, e perde
    /// l'atomicità.
    SulPosto,
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
/// [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md), preso
/// sul serio fino in fondo: i due danni non sono uguali — il file troncato vuole
/// un crash *durante* la scrittura ed è visibile, il nome staccato avviene a
/// ogni salvataggio e non lo vede nessuno. Davanti a un dubbio si paga quello
/// che si vede.
pub fn come_scrivere(collegamento: bool, nomi: NomiDelFile) -> ComeScrivere {
    if collegamento {
        // La rename sostituirebbe il collegamento, e da quel momento il file
        // vero non riceverebbe più niente. Non serve contare: un symlink ha
        // già un altro titolare per definizione, ed è l'unico ramo che non è
        // mai dipeso dalla piattaforma.
        return ComeScrivere::SulPosto;
    }
    match nomi {
        NomiDelFile::Nessuno | NomiDelFile::Uno => ComeScrivere::Sostituendo,
        NomiDelFile::PiuDiUno | NomiDelFile::Ignoto => ComeScrivere::SulPosto,
    }
}

/// Cosa c'è **già** a questo path, senza seguire un eventuale collegamento.
///
/// Una riga sola con un nome, ed è la metà vera di [`FsStorage::write_con`] che
/// tocca il disco: passandola invece di nominarla, un banco può far rispondere
/// «permesso negato» a questa domanda senza rompere niente. Vedi il doc di
/// `write_con`.
pub fn cosa_c_e(path: &Utf8Path) -> io::Result<std::fs::Metadata> {
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
pub fn nomi_del_file(path: &Utf8Path, meta: &std::fs::Metadata) -> NomiDelFile {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = path;
        if meta.nlink() > 1 {
            NomiDelFile::PiuDiUno
        } else {
            NomiDelFile::Uno
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };

        let _ = meta;
        // L'apertura in sola lettura è il prezzo del conteggio su questa
        // piattaforma, e si paga **una volta per salvataggio** — accanto a una
        // scrittura, a un `fsync` e a una rename. Un file che non si riesce ad
        // aprire non è un file con un nome solo: è un file di cui non sappiamo
        // niente, e la differenza la porta `Ignoto`.
        let Ok(file) = std::fs::File::open(path) else {
            return NomiDelFile::Ignoto;
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: l'handle è vivo per tutta la chiamata (`file` non cade prima),
        // e `info` è una struttura del chiamante che la funzione riempie.
        let esito = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
        if esito == 0 {
            return NomiDelFile::Ignoto;
        }
        if info.nNumberOfLinks > 1 {
            NomiDelFile::PiuDiUno
        } else {
            NomiDelFile::Uno
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        // Non è un `else` di comodo: è la dichiarazione che su questa
        // piattaforma la domanda non ha risposta, e `come_scrivere` sa cosa
        // farne. Prima qui c'era `false`, cioè la risposta sbagliata detta con
        // sicurezza.
        let _ = (path, meta);
        NomiDelFile::Ignoto
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
/// Segue i collegamenti di proposito, al contrario di [`cosa_c_e`]: la domanda è
/// «dove si finisce a scrivere», e chi scrive attraverso un symlink scrive nel
/// file puntato.
pub fn identita_del_file(path: &Utf8Path) -> Option<Identita> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(path).ok()?;
        Some(Identita {
            volume: meta.dev() as u64,
            file: meta.ino(),
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };

        // Come per il conteggio dei nomi (§23.16), su questa piattaforma
        // l'identità sta dietro un handle: i metadati di `std` non la portano.
        let file = std::fs::File::open(path).ok()?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: l'handle è vivo per tutta la chiamata (`file` non cade prima),
        // e `info` è una struttura del chiamante che la funzione riempie.
        let esito = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
        if esito == 0 {
            return None;
        }
        Some(Identita {
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

/// L'identità di un file: il volume e il numero che lo distingue là dentro.
///
/// Due path con la stessa [`Identita`] sono lo stesso file, comunque siano
/// scritti; due path con identità diverse sono due file, anche se i byte dentro
/// sono gli stessi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identita {
    /// Il volume: `st_dev` su unix, il numero di serie del volume su Windows.
    /// Senza, due file su due dischi diversi possono avere lo stesso numero.
    pub volume: u64,
    /// Il file dentro il volume: l'inode su unix, l'indice del file su Windows.
    pub file: u64,
}

impl FsStorage {
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
    /// **Anche `cosa_c_e` è passato**, per la ragione del rilevatore portata
    /// fino in fondo: la lettura di ciò che sta già al path è l'altra syscall di
    /// questo corpo che può fallire *senza che il file manchi* — un permesso
    /// negato sulla cartella, un nome troppo lungo, un disco che non risponde —
    /// e finché era nominata qui dentro non c'era modo di farla fallire in un
    /// banco senza rompere un disco. È esattamente il caso che contava: un
    /// errore letto come «non c'è niente lì» manda la scrittura sul ramo
    /// [`ComeScrivere::Sostituendo`], cioè stacca un nome che poteva esserci.
    pub fn write_con(
        &self,
        path: &Utf8Path,
        bytes: &[u8],
        cosa_c_e: impl Fn(&Utf8Path) -> io::Result<std::fs::Metadata>,
        nomi: impl Fn(&Utf8Path, &std::fs::Metadata) -> NomiDelFile,
    ) -> io::Result<(ComeScrivere, Stat)> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // `se_c_e` e non `.ok()`: **non c'è** è una risposta, «non si è potuto
        // guardare» no — e da qui dipende la scelta di come scrivere.
        let esistente = crate::error::se_c_e(cosa_c_e(path))?;
        let collegamento = esistente
            .as_ref()
            .is_some_and(|meta| meta.file_type().is_symlink());
        let quanti = match (&esistente, collegamento) {
            (None, _) => NomiDelFile::Nessuno,
            // Su un collegamento il conteggio non si chiede: la risposta non
            // cambierebbe la decisione, e su Windows costerebbe un'apertura che
            // seguirebbe il collegamento invece di guardarlo.
            (Some(_), true) => NomiDelFile::Ignoto,
            (Some(meta), false) => nomi(path, meta),
        };
        let come = come_scrivere(collegamento, quanti);
        if come == ComeScrivere::SulPosto {
            let mut file = std::fs::File::create(path)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            return Ok((come, stat_con(EntryKind::File, &file.metadata()?)));
        }

        let tmp = tmp_path(path);
        let scritto = (|| -> io::Result<Stat> {
            let mut file = std::fs::File::create(&tmp)?;
            file.write_all(bytes)?;
            if let Some(meta) = &esistente {
                // Best-effort: un filesystem che non sa di permessi (FAT su una
                // chiavetta) non è una ragione per non salvare la nota.
                let _ = std::fs::set_permissions(&tmp, meta.permissions());
            }
            file.sync_all()?;
            // La data si chiede **al descrittore, prima della rename**: dopo, il
            // path può già essere di qualcun altro, e la rename non cambia
            // l'mtime del file che porta con sé.
            Ok(stat_con(EntryKind::File, &file.metadata()?))
        })();
        let stat = match scritto {
            Ok(stat) => stat,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        };
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        for dir in cartelle_da_sincronizzare(&tmp, Some(path)) {
            sincronizza_la_cartella(&dir);
        }
        Ok((come, stat))
    }
}

fn non_utf8(path: &std::path::Path) -> io::Error {
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
fn cartella_scrivibile(root: &Utf8Path) -> io::Result<()> {
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
        let prova = root.join(format!(".fub-prova-{}", std::process::id()));
        let esito = std::fs::write(&prova, b"");
        let _ = std::fs::remove_file(&prova);
        esito.map(|_| ())
    }
}

/// Le cartelle la cui **voce** cambia quando qualcosa si sposta o si toglie, e
/// che quindi vanno sincronizzate perché la mossa sopravviva a un crash
/// (difetto 0153).
///
/// La [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)
/// aveva già trovato la riga che conta — *è la cartella a portare il nome*, e
/// senza il suo `fsync` un rename può sparire dopo un `Ok` — e l'aveva scritta
/// dentro la sola scrittura. Ma le operazioni che muovono o tolgono l'**unica
/// copia** di una nota sono le altre: cestinare, ripristinare, spostare,
/// buttare una bozza. Lì un `Ok` che non è sceso lascia una voce di cestino che
/// punta al nulla, o una nota che risorge dov'era, con il registro che dice il
/// contrario — e il registro, per la
/// [0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md),
/// si scrive *dopo* la mossa proprio per non raccontare mai ciò che non è
/// successo: una mossa che torna indietro da sola gli toglie quella garanzia.
///
/// Sta qui, pura e restituita come elenco, per la ragione di
/// [`come_scrivere`]: la regola è una tabella — *quali* cartelle, e quante
/// volte — e una tabella si legge tutta insieme e si presidia dove gli inode
/// non ci sono. Le due righe che dice:
///
/// - una mossa dentro la stessa cartella la sincronizza **una volta sola**. Non
///   è un'ottimizzazione: è un `fsync` in più per ogni rinomina, che è il costo
///   più caro che un disco sappia fare;
/// - una radice senza genitore — un path relativo di un solo segmento — non
///   produce niente da sincronizzare invece di produrre la cartella vuota, che
///   non si apre.
pub fn cartelle_da_sincronizzare(da: &Utf8Path, a: Option<&Utf8Path>) -> Vec<Utf8PathBuf> {
    let mut out: Vec<Utf8PathBuf> = Vec::with_capacity(2);
    for path in std::iter::once(da).chain(a) {
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
pub fn sincronizza_la_cartella(dir: &Utf8Path) -> bool {
    std::fs::File::open(dir).and_then(|d| d.sync_all()).is_ok()
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
    /// # I tre casi in cui **non** si sostituisce il file
    ///
    /// Una rename cambia l'inode, e ci sono tre situazioni in cui quell'inode
    /// non è solo nostro — o non si sa se lo sia:
    ///
    /// - il path **è un symlink**: la rename sostituirebbe il collegamento, e da
    ///   quel momento il file vero non riceverebbe più niente. È il modo in cui
    ///   una nota tenuta altrove e collegata dentro il vault smette in silenzio
    ///   di essere la stessa nota;
    /// - il file ha **più di un nome** (hardlink): la rename ne staccherebbe uno
    ///   solo, e l'altro resterebbe fermo al contenuto di prima;
    /// - **non si sa quanti nomi abbia** ([`NomiDelFile::Ignoto`]). Il terzo caso
    ///   è nato con la §23.16: prima era il secondo detto male, perché su Windows
    ///   il conteggio rispondeva `false` sempre, cioè «un nome solo» a un file
    ///   che poteva averne dieci.
    ///
    /// In tutti si scrive **sul posto** — `create` + `sync_all` — che
    /// conserva l'inode e perde l'atomicità: un crash a metà lascia il file
    /// troncato, come prima di questa voce. È il verso giusto della scelta,
    /// perché i due danni non sono uguali: il troncamento richiede un crash
    /// *durante* la scrittura ed è visibile, la sostituzione di un collegamento
    /// avviene a ogni salvataggio e non la vede nessuno.
    ///
    /// Il costo è una `symlink_metadata` per scrittura, cioè la stessa syscall
    /// che `std::fs::write` fa comunque aprendo il file.
    ///
    /// Il corpo sta in [`FsStorage::write_con`], che prende il rilevatore invece
    /// di nominarlo: qui si passa quello vero.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_con(path, bytes, cosa_c_e, nomi_del_file)
            .map(|(_, stat)| stat)
    }

    /// Il lucchetto di [`lock_esclusivo`] tenuto per il tempo della rilettura e
    /// della scrittura, che è la sola cosa che questo supporto aggiunge al giro
    /// `read` → `fondi` → `write`. È **best-effort** di proposito: dove il lock
    /// non c'è — una share di rete che non lo implementa — la rilettura vale lo
    /// stesso, e rifiutarsi di salvare sarebbe un danno certo al posto di uno
    /// improbabile.
    ///
    /// Il lucchetto si prende **solo se la cartella c'è già**, perché
    /// [`lock_esclusivo`] la creerebbe per posarci accanto il proprio file: un
    /// aggiornamento che non trova niente da aggiornare non deve lasciare
    /// dietro di sé la cartella di un vault che nessuno ha ancora aperto — è la
    /// differenza fra una radice che non si legge, e che quindi non si apre, e
    /// una radice che l'apertura stessa ha fatto esistere vuota. Senza cartella
    /// non c'è nemmeno il file, quindi non c'è nessun contenuto che un altro
    /// processo possa perdere: `fondi` riceve `None` e, se decide di scrivere,
    /// è [`write`](VaultStorage::write) a creare l'albero.
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> io::Result<()> {
        let cartella_c_e = path.parent().map(Utf8Path::exists).unwrap_or(true);
        let _lock = cartella_c_e.then(|| lock_esclusivo(path));
        let attuale = match self.read(path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(e),
        };
        match fondi(attuale.as_deref())? {
            Some(bytes) => self.write(path, &bytes).map(|_| ()),
            None => Ok(()),
        }
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

    /// La mossa, e poi il `fsync` delle cartelle che hanno cambiato voce: senza,
    /// un rename può sparire dopo aver risposto `Ok`
    /// ([`cartelle_da_sincronizzare`]). Si sincronizza **dopo il `?`**, cioè
    /// solo se la mossa è riuscita: non c'è niente da far scendere di una mossa
    /// che non è avvenuta, e chiederlo lo stesso trasformerebbe un errore in un
    /// errore più lento.
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(from, to)?;
        for dir in cartelle_da_sincronizzare(from, Some(to)) {
            sincronizza_la_cartella(&dir);
        }
        Ok(())
    }

    /// Togliere è una mossa come le altre: la voce che sparisce sta in una
    /// cartella, e finché quella non è scesa il file può tornare.
    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        std::fs::remove_file(path)?;
        for dir in cartelle_da_sincronizzare(path, None) {
            sincronizza_la_cartella(&dir);
        }
        Ok(())
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

    /// **Qui il default non basta**, ed è l'unico supporto per cui non basta:
    /// il filesystem è l'unico che decide da sé se due nomi siano un posto o
    /// due, e lo dice con [`identita_del_file`]. Due path uguali sono lo stesso
    /// file senza chiedere niente — anche se non c'è niente là — e per gli altri
    /// si va a guardare l'inode.
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        match (identita_del_file(a), identita_del_file(b)) {
            (Some(a), Some(b)) => a == b,
            // Un file che non c'è, o un'identità che la piattaforma non sa
            // dare: vedi il doc di `identita_del_file`, due «non lo so» non
            // sono lo stesso file.
            _ => false,
        }
    }

    /// **Qui il default non basta**: sul disco una radice mancante non è un
    /// vault che sta per nascere, è un errore di chi ha scelto — e va detto
    /// all'ingresso, non alla prima operazione che tocca il disco (0160).
    ///
    /// La `stat` segue i link, come sempre nel kernel: una radice che è un
    /// collegamento a una cartella è una cartella, e una radice che non c'è
    /// fallisce già qui con `NotFound`.
    fn radice_valida(&self, root: &Utf8Path) -> io::Result<()> {
        let s = self.stat(root)?;
        if s.kind != EntryKind::Dir {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("la radice {root} non è una cartella"),
            ));
        }
        // «Scrivibile» non si legge dai permessi del file: si chiede al
        // sistema se chi gira può scriverci, e la domanda non crea nulla —
        // un file di prova sarebbe visibile a chiunque cammini la radice
        // mentre l'apertura è in corso, cioè un fantasma di pochi
        // microsecondi, la specie di rumore che la verifica all'ingresso
        // esiste per togliere (0160).
        cartella_scrivibile(root).map_err(|e| {
            if e.kind() == io::ErrorKind::PermissionDenied {
                io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("non si ha permesso di scrivere su {root}"),
                )
            } else {
                e
            }
        })
    }

    /// Le voci di dentro se ne vanno con la cartella che le conteneva, quindi
    /// ciò che resta da far scendere è la voce **della cartella**, che sta in
    /// quella sopra.
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir_all(dir)?;
        for sopra in cartelle_da_sincronizzare(dir, None) {
            sincronizza_la_cartella(&sopra);
        }
        Ok(())
    }

    /// Anche una cartella vuota, che non porta via dati e non per questo può
    /// risorgere: chi la toglie lo fa per un motivo — un ramo rimasto vuoto dopo
    /// uno spostamento — e ritrovarla al riavvio è la stessa incoerenza fra ciò
    /// che il registro dice e ciò che c'è.
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir(dir)?;
        for sopra in cartelle_da_sincronizzare(dir, None) {
            sincronizza_la_cartella(&sopra);
        }
        Ok(())
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
        .map(|_| ())
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
///
/// **Il compagno non si toglie all'uscita, ed è voluto** (difetto 0151).
/// Cancellarlo è la riparazione che sembra ovvia e che rompe il lock: fra
/// l'`unlink` di chi esce e la `open` di chi arriva ci sta un terzo che crea un
/// file *nuovo* a quel nome e se lo prende, mentre il secondo tiene ancora il
/// lock sull'inode scollegato — due che scrivono, ciascuno convinto di essere
/// solo, che è esattamente ciò che il lock esisteva per impedire. E non c'è
/// niente da guadagnare: il compagno è **uno per file protetto**, e i file
/// protetti sono un insieme fisso e piccolo — non cresce con le note, non
/// cresce con l'uso, non cresce affatto. Ciò che va tolto è il fatto che si
/// **veda**, e a toglierlo è [`e_lock_di_scrittura`].
/// Quanto si aspetta il compagno prima di scrivere **senza** (difetto 0152).
///
/// Un `update_atomic` onesto tiene il lock per una lettura e una scrittura, cioè
/// per millisecondi: due secondi sono mille volte tanto, e chi arriva mentre un
/// altro sta davvero salvando lo aspetta senza accorgersene. Chi ci arriva
/// contro è invece un lock che **non si libererà**: un processo morto male che
/// il sistema non ha ripulito, una share di rete che tiene il lock di un client
/// che non c'è più, un'altra installazione appesa dentro il proprio `update`.
const ATTESA_DEL_LOCK: std::time::Duration = std::time::Duration::from_secs(2);

/// Ogni quanto si riprova. Non è una misura di niente: è il passo con cui
/// l'attesa si controlla, corto abbastanza da non aggiungere ritardo a un lock
/// che si libera subito e lungo abbastanza da non essere un giro a vuoto.
const RIPROVA_IL_LOCK: std::time::Duration = std::time::Duration::from_millis(10);

fn lock_esclusivo(path: &Utf8Path) -> Option<std::fs::File> {
    lock_esclusivo_entro(path, ATTESA_DEL_LOCK)
}

/// Il corpo di [`lock_esclusivo`] con l'attesa **detta**, perché è il solo modo
/// di presidiare la rinuncia senza far durare un banco quanto dura la pazienza
/// di un utente.
///
/// Il difetto che questa attesa toglie non è la lentezza: è che
/// [`lock_esclusivo`] dichiarava **due** esiti — «o si ha il lock, o si procede
/// senza» — e ne aveva un terzo che non aveva nome. `File::lock` è bloccante e
/// non ha scadenza, quindi chi salvava un'impostazione dietro un lock che
/// nessuno rilascia non riceveva né il lock né il permesso di procedere: restava
/// lì, senza errore, senza messaggio e senza niente che dicesse **che cosa**
/// stesse aspettando. E rinunciare è la risposta giusta per la ragione già
/// scritta in [`update_atomic`]: il lock stringe una finestra, non la toglie —
/// a togliere la perdita è la rilettura, che vale lo stesso — e rifiutarsi di
/// salvare sarebbe un danno certo al posto di uno improbabile. Restare fermi
/// per sempre è il danno certo scritto peggio: nemmeno l'utente sa che c'è.
///
/// La rinuncia **si dice**, e si dice col nome del file: un salvataggio andato
/// a buon fine senza il lock è ciò che si voleva, ma il giorno che quella riga
/// compare a ogni scrittura vuol dire che su quella macchina c'è un lock morto,
/// e chi legge il log deve poterlo trovare.
fn lock_esclusivo_entro(path: &Utf8Path, attesa: std::time::Duration) -> Option<std::fs::File> {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let lock_path = lock_path(path);
    std::fs::create_dir_all(dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .ok()?;
    // Il lock si rilascia alla chiusura del file, cioè quando il chiamante
    // lascia cadere ciò che questa funzione ha restituito.
    let scadenza = std::time::Instant::now() + attesa;
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            // Non è un guasto: è qualcun altro che sta salvando, ed è il caso
            // per cui il lock esiste.
            Err(std::fs::TryLockError::WouldBlock) => {}
            // Un supporto che il lock non lo sa fare — una share di rete — è il
            // caso «best-effort» di sempre: si procede senza, subito.
            Err(std::fs::TryLockError::Error(_)) => return None,
        }
        if std::time::Instant::now() >= scadenza {
            tracing::warn!(
                target: "fub.kernel",
                "{lock_path} è tenuto da qualcun altro da più di {attesa:?}: \
                 si scrive senza il lock"
            );
            return None;
        }
        std::thread::sleep(RIPROVA_IL_LOCK);
    }
}

// --- la copia in memoria di un file ----------------------------------------

/// **Ciò che si tiene in memoria di un file, e che si cambia solo scrivendo.**
///
/// # Il difetto che questo tipo toglie
///
/// «Su disco prima, in memoria dopo» era scritto in **cinque** posti — le
/// impostazioni di vault, quelle di macchina, l'organizzazione, il registro dei
/// vault, lo stato di vista — ognuno con la sua frase, e in nessuno dei cinque
/// c'era qualcosa che lo tenesse fermo. Il sesto posto
/// ([`EntryStore`](crate::entries)) ha scritto le due righe nell'ordine opposto
/// e nessuno se n'è accorto per un anno: la regola era una **convenzione**, e
/// una convenzione non si eredita — si ricopia, finché qualcuno non la ricopia
/// male.
///
/// Qui l'ordine non è più una scelta di chi scrive la funzione: è l'unico
/// ordine che il tipo sa esprimere. Il valore sta dentro, non se ne consegna
/// mai un `&mut`, e l'unico modo di sostituirlo è [`Durevole::scrivi`], che
/// sostituisce **dopo** che la scrittura è tornata `Ok`. Un guasto a metà
/// lascia memoria e disco d'accordo su ciò che c'era prima, che è l'unico stato
/// che chi ha ricevuto l'errore può presumere.
///
/// # Perché il verso è questo e non l'altro
///
/// Perché delle due mosse **solo una può fallire**. Assegnare un campo non
/// fallisce; scrivere un file sì. Mettere per ultima quella che non fallisce
/// vuol dire che non esiste un istante in cui una è avvenuta e l'altra no, ed è
/// la stessa ragione per cui un ripristino dal cestino è un `rename` e non un
/// «scrivi e poi cancella».
///
/// # L'altra forma della stessa regola
///
/// [`update_atomic`] è questo tipo per i file che si **fondono** invece di
/// ricomporsi: là il valore nuovo non ce l'ha il chiamante — lo produce la
/// fusione con ciò che sul disco c'è adesso — quindi la scrittura *restituisce*
/// la memoria da adottare invece di riceverla. Le due sono la stessa promessa
/// («la memoria è ciò che il disco ha accettato») per i due modi di comporre un
/// file, e chi ne apre un settimo sceglie fra queste due e non fra due ordini.
pub struct Durevole<T>(T);

impl<T> Durevole<T> {
    /// Ciò che si è appena letto dal file — o il vuoto, per un file che non
    /// c'era.
    pub fn letto(iniziale: T) -> Self {
        Durevole(iniziale)
    }

    /// Scrive `nuovo` e **solo se il disco lo ha accettato** lo adotta.
    ///
    /// `su_disco` riceve un prestito di ciò che sta per diventare la memoria, e
    /// non una copia: è il valore stesso che va a finire nel file, quindi le due
    /// idee di «cosa si sa» non possono divergere nemmeno per il tempo di una
    /// serializzazione.
    pub fn scrivi<E>(
        &mut self,
        nuovo: T,
        su_disco: impl FnOnce(&T) -> Result<(), E>,
    ) -> Result<(), E> {
        su_disco(&nuovo)?;
        self.0 = nuovo;
        Ok(())
    }

    /// **Aggiorna**: adotta ciò che la scrittura ha prodotto, invece di dettarlo.
    ///
    /// È la gemella di [`scrivi`](Durevole::scrivi) per i file che si fondono
    /// invece di sostituirsi ([`VaultStorage::update`]): là il chiamante sa già
    /// cosa andrà nel file, qui no — il valore nuovo nasce mettendo il proprio
    /// cambiamento sopra ciò che sul disco c'è *adesso*, e chi lo compone è la
    /// scrittura. Adottare la propria copia mutata al posto di quella fusa
    /// vorrebbe dire tenere in memoria l'unico stato che non è di nessuno.
    ///
    /// L'ordine resta quello del tipo: se `su_disco` fallisce la memoria non si
    /// muove.
    pub fn aggiorna<E>(&mut self, su_disco: impl FnOnce() -> Result<T, E>) -> Result<(), E> {
        self.0 = su_disco()?;
        Ok(())
    }
}

impl<T> std::ops::Deref for Durevole<T> {
    type Target = T;

    /// Si legge come il valore che porta. **Non** c'è il `DerefMut`, ed è tutto
    /// il punto: un `&mut` consegnato qui rimetterebbe in circolazione
    /// esattamente la mossa che questo tipo esiste per non far più scrivere.
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for Durevole<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
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
///
/// **Anche una cartella ha una data**, e cambia quando cambia ciò che le sta
/// dentro *direttamente* — nasce un file, se ne va, ne arriva uno da un rename.
/// Un doppio che rispondesse sempre zero direbbe «non è cambiata» dove il disco
/// dice «è cambiata», e questo è il verso in cui una divergenza fa male: rende
/// verde qui un banco che sul disco sarebbe rosso.
///
/// # Il doppio sbaglia dove sbaglia il disco
///
/// Un path non è insieme un file e una cartella, un `update` che va in panico
/// non lascia il supporto inservibile, e scrivere dove non si può è un errore
/// e non un `Ok`: sono le tre righe che [`FsStorage`] ottiene dal sistema
/// operativo senza scriverle, e che qui vanno scritte a mano perché nessuno le
/// regala. Il presidio è appaiato — le stesse asserzioni sui due supporti — e
/// sta in `crates/fub-kernel/tests/il_supporto.rs`.
/// La [`SCADENZA_DEL_TEMPORANEO_MS`] letta nell'unità di [`MemStorage`], dove il
/// tempo non è un orologio ma un contatore di operazioni: **sedici operazioni
/// fa**.
const SCADENZA_DEL_TEMPORANEO_IN_MEMORIA: u64 = 16;

#[derive(Debug, Default)]
pub struct MemStorage {
    inner: Ricovero<Mem>,
}

#[derive(Debug, Default)]
struct Mem {
    files: BTreeMap<Utf8PathBuf, (Vec<u8>, u64)>,
    /// Le cartelle, ognuna con la sua data: vedi la nota sul tempo di
    /// [`MemStorage`].
    dirs: BTreeMap<Utf8PathBuf, u64>,
    tick: u64,
}

impl Mem {
    /// Il prossimo istante. Si prende **prima** di toccare qualunque cosa,
    /// perché una sola operazione può datare più posti — il file e la cartella
    /// che lo contiene — e devono portare la stessa data.
    fn ora(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    /// Fa nascere le cartelle che mancano, e **si ferma se una di esse è già un
    /// file**: `create_dir_all` sul disco risponde un errore, e un doppio che
    /// invece accettasse si ritroverebbe uno stesso path elencato come file e
    /// come cartella, cioè uno stato che il filesystem non sa rappresentare.
    fn make_dirs(&mut self, path: &Utf8Path, ora: u64) -> io::Result<()> {
        let mut cur = Utf8PathBuf::new();
        for comp in path.components() {
            cur.push(comp);
            if self.files.contains_key(&cur) {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("{cur}: è un file, non una cartella"),
                ));
            }
            if !self.dirs.contains_key(&cur) {
                self.dirs.insert(cur.clone(), ora);
                // Una cartella nuova cambia quella che la contiene.
                if let Some(parent) = cur.parent() {
                    self.tocca(parent, ora);
                }
            }
        }
        Ok(())
    }

    /// Data la cartella che contiene `path`, se è una cartella conosciuta.
    fn tocca_il_genitore(&mut self, path: &Utf8Path, ora: u64) {
        if let Some(parent) = path.parent() {
            self.tocca(parent, ora);
        }
    }

    fn tocca(&mut self, dir: &Utf8Path, ora: u64) {
        if let Some(quando) = self.dirs.get_mut(dir) {
            *quando = ora;
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

    /// Il prestito, **avvelenato o no**.
    ///
    /// Un `fondi` che va in panico dentro [`VaultStorage::update`] unwinda con
    /// la guardia in mano e avvelena il lucchetto; su [`FsStorage`] lo stesso
    /// panico rilascia il lucchetto del file e lascia il supporto usabile, e chi
    /// raccoglie il panico continua a leggere. Un `Mutex` nudo con un `expect`
    /// farebbe morire ogni accesso successivo — cioè il doppio si romperebbe
    /// dove il disco regge.
    ///
    /// La politica non è scritta qui: è quella del [`Ricovero`], che è la porta
    /// del kernel per un dato che un panico a metà non rende incredibile
    /// ([0126](../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md)).
    /// Ed è il caso: `fondi` non riceve niente della mappa, e l'unica mutazione
    /// dell'`update` avviene **dopo** che è tornato, quindi ciò che il panico
    /// lascia dietro di sé è lo stato di prima — esattamente ciò che lascia il
    /// disco.
    fn lock(&self) -> MutexGuard<'_, Mem> {
        self.inner.prendi()
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
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        let mut mem = self.lock();
        if mem.dirs.contains_key(path) {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("{path}: è una cartella"),
            ));
        }
        let ora = mem.ora();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, ora)?;
        }
        mem.files.insert(path.to_owned(), (bytes.to_vec(), ora));
        // Anche una riscrittura data la cartella: di là è una rename dentro di
        // essa (§15.2), e una rename è una voce di directory che cambia.
        mem.tocca_il_genitore(path, ora);
        Ok(Stat {
            kind: EntryKind::File,
            size: bytes.len() as u64,
            mtime: ora,
        })
    }

    /// Qui l'aggiornamento è atomico **davvero**, e non per modo di dire come
    /// l'atomicità della `write`: il lucchetto della mappa si tiene per tutto il
    /// giro, quindi fra la rilettura e la scrittura non ci si infila nessuno. È
    /// anche la ragione per cui `fondi` non deve rientrare nel supporto — questo
    /// `Mutex` non è rientrante.
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.dirs.contains_key(path) {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("{path}: è una cartella"),
            ));
        }
        let attuale = mem.files.get(path).map(|(bytes, _)| bytes.clone());
        let Some(nuovi) = fondi(attuale.as_deref())? else {
            return Ok(());
        };
        let ora = mem.ora();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, ora)?;
        }
        mem.files.insert(path.to_owned(), (nuovi, ora));
        mem.tocca_il_genitore(path, ora);
        Ok(())
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.dirs.contains_key(path) {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("{path}: è una cartella"),
            ));
        }
        let ora = mem.ora();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, ora)?;
        }
        let nato_adesso = !mem.files.contains_key(path);
        let voce = mem
            .files
            .entry(path.to_owned())
            .or_insert_with(|| (Vec::new(), ora));
        voce.0.extend_from_slice(bytes);
        voce.1 = ora;
        // Aggiungere in coda a un file che c'è già non tocca la cartella: di là
        // è una scrittura sull'inode, non una voce di directory in più.
        if nato_adesso {
            mem.tocca_il_genitore(path, ora);
        }
        Ok(())
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        let ora = mem.ora();
        if let Some(parent) = to.parent() {
            mem.make_dirs(parent, ora)?;
        }
        if let Some(entry) = mem.files.remove(from) {
            // La data del file non si tocca — una rename non riscrive l'inode,
            // ed è la proprietà su cui poggia il timbro del cestino — ma le due
            // cartelle sì: una voce se ne va di là e ne arriva una di qua.
            mem.files.insert(to.to_owned(), entry);
            mem.tocca_il_genitore(from, ora);
            mem.tocca_il_genitore(to, ora);
            return Ok(());
        }
        if !mem.dirs.contains_key(from) {
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
            .filter_map(|(k, quando)| sposta(k).map(|nuovo| (k.clone(), nuovo, *quando)))
            .collect();
        for (vecchio, nuovo, quando) in dirs {
            mem.dirs.remove(&vecchio);
            mem.dirs.insert(nuovo, quando);
        }
        mem.tocca_il_genitore(from, ora);
        mem.tocca_il_genitore(to, ora);
        Ok(())
    }

    /// Qui il tempo è un contatore di operazioni e non un orologio (vedi la
    /// nota sul tempo di [`MemStorage`]), quindi la soglia si legge in
    /// operazioni: [`SCADENZA_DEL_TEMPORANEO_IN_MEMORIA`].
    fn e_rimasto_indietro(&self, stat: &Stat) -> bool {
        self.lock().tick.saturating_sub(stat.mtime) >= SCADENZA_DEL_TEMPORANEO_IN_MEMORIA
    }

    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.files.remove(path).is_none() {
            return Err(not_found(path));
        }
        let ora = mem.ora();
        mem.tocca_il_genitore(path, ora);
        Ok(())
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let mem = self.lock();
        if !mem.dirs.contains_key(dir) {
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
                    .filter(|(path, _)| figlio(path))
                    .map(|(path, quando)| DirEntry {
                        path: path.clone(),
                        stat: Stat {
                            kind: EntryKind::Dir,
                            size: 0,
                            mtime: *quando,
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
        if let Some(quando) = mem.dirs.get(path) {
            return Ok(Stat {
                kind: EntryKind::Dir,
                size: 0,
                mtime: *quando,
            });
        }
        Err(not_found(path))
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if !mem.dirs.contains_key(dir) {
            return Err(not_found(dir));
        }
        // **Vuota vuol dire vuota**: `remove_dir` di là si rifiuta, e un doppio
        // che invece togliesse la cartella lascerebbe dentro la mappa dei file
        // che nessun `list` sa più raggiungere — cioè renderebbe verde qui la
        // camminata che di là si ferma.
        let figlio = |path: &Utf8Path| path.parent() == Some(dir);
        if mem.files.keys().any(|p| figlio(p)) || mem.dirs.keys().any(|p| figlio(p)) {
            return Err(io::Error::new(
                io::ErrorKind::DirectoryNotEmpty,
                format!("{dir}: non è vuota"),
            ));
        }
        mem.dirs.remove(dir);
        let ora = mem.ora();
        mem.tocca_il_genitore(dir, ora);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La data di una cartella **avanza** quando cambia ciò che le sta dentro.
    ///
    /// Sta qui e non nel banco appaiato di `tests/il_supporto.rs` per la
    /// ragione che rende utile un contatore: di là c'è un orologio vero, e due
    /// scritture nello stesso millisecondo non si distinguono senza una
    /// `sleep`. Il banco appaiato prova ciò che i due sanno promettere insieme
    /// — una data c'è, e non torna indietro — questo prova il modello.
    #[test]
    fn la_data_di_una_cartella_segue_cio_che_ci_sta_dentro() {
        let mem = MemStorage::new();
        let dir = Utf8Path::new("/vault/note");
        mem.write(&dir.join("a.md"), b"a").unwrap();
        let nascita = mem.stat(dir).unwrap().mtime;
        assert_ne!(nascita, 0, "una cartella nasce con una data");

        mem.write(&dir.join("b.md"), b"b").unwrap();
        let con_due = mem.stat(dir).unwrap().mtime;
        assert!(con_due > nascita, "un file nuovo data la cartella");

        // Appendere a un file che c'è già non è una voce di directory in più.
        mem.append(&dir.join("b.md"), b"bb").unwrap();
        assert_eq!(
            mem.stat(dir).unwrap().mtime,
            con_due,
            "appendere non tocca la cartella"
        );

        // Togliere sì, e la data del file che trasloca non si muove con lui.
        let quando_del_file = mem.stat(&dir.join("a.md")).unwrap().mtime;
        mem.rename(&dir.join("a.md"), Utf8Path::new("/vault/altrove/a.md"))
            .unwrap();
        assert!(mem.stat(dir).unwrap().mtime > con_due, "l'uscita data");
        assert_eq!(
            mem.stat(Utf8Path::new("/vault/altrove/a.md"))
                .unwrap()
                .mtime,
            quando_del_file,
            "una rename non riscrive il file"
        );
    }

    /// Il temporaneo di una scrittura vive dentro il vault per una frazione di
    /// secondo, e in quella frazione **non deve essere un documento**.
    ///
    /// Il presidio è sull'incastro fra due moduli, non su una stringa: il nome
    /// del temporaneo lo compone `storage.rs`, la regola che lo rende invisibile
    /// è la politica di esclusione, e sono lontani abbastanza perché un giorno
    /// qualcuno cambi il nome del temporaneo senza sapere che c'era una regola
    /// da rispettare. Se succede, questo diventa rosso.
    ///
    /// **E si interroga la politica più permissiva che un vault possa
    /// dichiarare**, non la funzione pura: prima della §15.6 questo banco
    /// chiedeva a `is_ignored_name`, e il `true` che riceveva arrivava dal ramo
    /// «comincia per punto». Il giorno in cui un vault dichiara che i nascosti
    /// sono documenti — cioè la voce stessa che lo ha riscritto — quel ramo si
    /// spegne, il temporaneo diventa un documento per la scansione, e il banco
    /// che avrebbe dovuto accorgersene resta verde.
    #[test]
    fn il_temporaneo_di_una_scrittura_non_e_un_documento() {
        let tutto = crate::ignore::IgnorePolicy::declaring(Vec::new(), true);
        for path in [
            "/vault/Nota.md",
            "/vault/note/Idea.md",
            "/vault/senza-punto",
        ] {
            let tmp = tmp_path(Utf8Path::new(path));
            let nome = tmp.file_name().expect("il temporaneo ha un nome");
            assert!(
                tutto.esclude(nome, crate::ignore::Specie::File),
                "{nome}: la scansione lo vedrebbe come un documento nuovo"
            );
        }
    }

    /// L'altro verso della stessa regola: la forma si riconosce **intera**, e un
    /// file dell'utente che comincia per punto non è un temporaneo di nessuno —
    /// se lo fosse, un vault che mostra i nascosti continuerebbe a non mostrare
    /// proprio i suoi.
    #[test]
    fn un_nascosto_qualunque_non_e_un_temporaneo() {
        for nome in [
            ".gitignore",
            ".bozza.md",
            ".Nota.md.tmp",
            ".Nota.md.tmp12",
            ".Nota.md.tmp-3",
            ".Nota.md.tmpaaa-3",
            ".tmp12-3",
            "Nota.md.tmp12-3",
        ] {
            assert!(!e_temporaneo_di_scrittura(nome), "{nome}");
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

    /// Una cartella vera e il file da proteggere dentro. I banchi del lock
    /// stanno qui e non nel banco appaiato perché `lock_esclusivo_entro` è del
    /// modulo: di là si vedrebbe solo `update_atomic`, che l'attesa non la sa
    /// dire e quindi la farebbe durare quanto la pazienza di un utente.
    fn cartella() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let radice = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let protetto = radice.join("impostazioni.json");
        (dir, protetto)
    }

    /// Un lock libero **si prende**: l'attesa che questo modulo si è dato non
    /// deve aver trasformato il lock in un ornamento.
    #[test]
    fn un_lock_libero_si_prende() {
        let (_dir, protetto) = cartella();
        assert!(
            lock_esclusivo_entro(&protetto, std::time::Duration::from_millis(50)).is_some(),
            "un lock che nessuno tiene non è stato preso: chi salva \
             un'impostazione non è più solo mentre lo fa"
        );
    }

    /// Chi salva un'impostazione dietro un lock che **nessuno rilascia** ci
    /// rinuncia e scrive lo stesso (difetto 0152).
    ///
    /// Il banco tiene il lock e non lo lascia mai, che è il processo morto male
    /// o la share di rete visti da dentro un solo processo. Il tentativo gira in
    /// un thread a parte con un canale, perché il difetto che presidia non è un
    /// esito sbagliato ma un esito che **non arriva**: senza il canale, un banco
    /// che vede il difetto resterebbe appeso e il verde di tutti gli altri non
    /// si vedrebbe mai. La soglia del canale è cinquanta volte l'attesa detta,
    /// cioè non è una misura di quanto ci mette: è la riga che distingue
    /// «rinuncia» da «per sempre».
    #[test]
    fn chi_aspetta_un_lock_morto_non_aspetta_per_sempre() {
        let (_dir, protetto) = cartella();
        let attesa = std::time::Duration::from_millis(100);
        let tenuto = lock_esclusivo_entro(&protetto, attesa).expect("il primo lock si prende");

        let (tx, rx) = std::sync::mpsc::channel();
        let p = protetto.clone();
        std::thread::spawn(move || {
            let _ = tx.send(lock_esclusivo_entro(&p, attesa).is_some());
        });

        match rx.recv_timeout(attesa * 50) {
            Ok(preso) => assert!(
                !preso,
                "il lock è stato dato a due insieme: la rinuncia si è mangiata \
                 anche l'esclusione"
            ),
            Err(_) => panic!(
                "chi salva un'impostazione aspetta per sempre un lock che \
                 nessuno rilascia: nessun esito, nessun errore e niente che \
                 dica che cosa sta aspettando"
            ),
        }
        drop(tenuto);
    }

    /// Un lock tenuto **per un momento** si aspetta: la rinuncia è per chi non
    /// rilascia mai, non per chiunque arrivi secondo.
    ///
    /// È la metà che impedisce alla riparazione di diventare «al primo occupato
    /// si scrive senza», cioè di togliere il lock fingendo di tenerlo. Il banco
    /// conta i tentativi e non i millisecondi: il lock si libera dopo un tempo
    /// più corto dell'attesa detta, quindi o il giro riprova o non lo prende.
    #[test]
    fn un_lock_tenuto_per_un_momento_si_aspetta() {
        let (_dir, protetto) = cartella();
        let attesa = std::time::Duration::from_secs(2);
        let tenuto = lock_esclusivo_entro(&protetto, attesa).expect("il primo lock si prende");

        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            drop(tenuto);
        });

        assert!(
            lock_esclusivo_entro(&protetto, attesa).is_some(),
            "il lock non è stato aspettato: chi arriva mentre un altro sta \
             davvero salvando scrive senza, e il lock non protegge più niente"
        );
    }
}
