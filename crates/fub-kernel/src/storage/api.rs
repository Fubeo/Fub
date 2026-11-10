//! I tipi del supporto (`EntryKind`, `Stat`, `DirEntry`, `ConditionalWrite`) e
//! il trait `VaultStorage`.

use super::*;

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
/// [0058](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md). Questa variante
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
    /// ([0046](../../../docs/decisions/0188-identita-path-e-rename.md)).
    pub mtime: u64,
}

/// Identità del file fornita dal filesystem: device/inode su Unix, volume/file
/// index su Windows. Non è un'identità di contenuto e non viene mai usata da
/// sola: il rejoin richiede anche il digest dei byte.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct FileIdentity {
    pub volume: u64,
    pub file: u64,
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
/// Dieci operazioni, e sono quelle che il kernel usa davvero. La regola con cui
/// questo trait è nato era «sette, e chi ne aggiunge un'ottava sta chiedendo al
/// supporto di sapere qualcosa sul contenuto»; l'ottava è arrivata
/// ([`VaultStorage::append`], con la
/// [0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md))
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
/// ([0066](../../../docs/decisions/0195-versioni-indipendenti.md)).
///
/// La decima ([`VaultStorage::rename_no_replace`]) ha la stessa ragione:
/// `exists` più `rename` lascia fra le due un concorrente, mentre il supporto
/// può creare il nome nuovo e rifiutarsi se c'è già in una sola operazione.
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
pub type Merge<'a> = &'a mut dyn FnMut(Option<&[u8]>) -> io::Result<Option<Vec<u8>>>;

/// Esito di una scrittura condizionale sul contenuto che il chiamante aveva
/// letto. `Changed` non è un errore I/O: significa che un altro writer ha
/// avanzato il file e la scrittura non è stata eseguita.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionalWrite {
    Written(Stat),
    Changed,
}

pub trait VaultStorage: Send + Sync {
    /// I byte a questo path.
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>>;

    /// I byte `[offset..offset+len)` a questo path, senza leggere il resto.
    ///
    /// Seek + lettura limitata reale: mai l'intero file in memoria, mai oltre
    /// `len` + overhead costante. `len == 0` torna vuoto senza aprire il file;
    /// `offset` oltre la fine torna vuoto, non un errore; a fine file il
    /// risultato si ritaglia. Il default è `Err(Unsupported)` esplicito — mai
    /// un full-read travestito, mai falsa apertura: ogni backend concreto
    /// implementa seek/read limitato reale.
    fn read_at(&self, path: &Utf8Path, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        let _ = (path, offset, len);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "read_at non supportato dal backend",
        ))
    }

    /// I byte a questo path, consegnati a `piece` a pezzi e in ordine, da un
    /// file aperto una volta sola: chi li consuma al volo — un'impronta — non
    /// tiene mai il file intero in memoria.
    ///
    /// Il default legge tutto e consegna un pezzo solo: va bene a un supporto
    /// che il file lo tiene già in memoria. Un supporto su disco lo
    /// sovrascrive, ed è lì che la promessa vale.
    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        piece(&self.read(path)?);
        Ok(())
    }

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
    /// Perché torna uno [`Stat`] e non `()`
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

    /// Scrive soltanto se i byte presenti sono ancora `expected`.
    ///
    /// Il default eredita la serializzazione di [`update`](VaultStorage::update)
    /// e basta ai supporti di test. Il backend di produzione la sovrascrive: il
    /// confronto e la pubblicazione restano sotto **lo stesso lock capability**.
    /// La garanzia è esatta fra writer cooperativi che usano questo protocollo;
    /// un processo esterno che ignora il lock resta, per definizione,
    /// best-effort e non va descritto come CAS universale.
    fn write_if_unchanged(
        &self,
        path: &Utf8Path,
        expected: Option<&[u8]>,
        bytes: &[u8],
    ) -> io::Result<ConditionalWrite> {
        let mut matches = false;
        self.update(path, &mut |current| {
            if current != expected {
                return Ok(None);
            }
            matches = true;
            Ok(Some(bytes.to_vec()))
        })?;
        if matches {
            self.stat(path).map(ConditionalWrite::Written)
        } else {
            Ok(ConditionalWrite::Changed)
        }
    }

    /// Scrive un **dato derivato**: la stessa [`write`](VaultStorage::write),
    /// senza la promessa che i byte sopravvivano a un crash.
    ///
    /// Non è la seconda scrittura che la
    /// [0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
    /// ha scartato. Quella era una seconda via per gli **stessi** file — un
    /// modo di scrivere i documenti senza pagarne il prezzo — e offrirla a ogni
    /// chiamante era il modo in cui un giorno qualcuno la sceglieva storta sul
    /// file dell'utente. Questa è un'operazione **diversa**, come
    /// [`append`](VaultStorage::append), per una classe di file che la 0065
    /// non conosceva: i **derivati** (§15.4), che si ricostruiscono da ciò che
    /// li genera. Per loro il `fsync` non compra niente — un derivato perso
    /// costa una riapertura lenta, non una nota — e il suo prezzo si paga a
    /// ogni scrittura, cioè a ogni chiusura del vault.
    ///
    /// La classe non sta nel path ma in **chi chiama**: il supporto non sa cosa
    /// sta scrivendo, e non deve saperlo — è la stessa divisione della 0048.
    /// Per questo il default è [`write`](VaultStorage::write): un supporto che
    /// non sa distinguere le due classi scrive tutto durevole, che è il
    /// comportamento di prima, e chi sa di avere un derivato in mano sceglie
    /// di non pagare il prezzo.
    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write(path, bytes)
    }

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
    /// ([0066](../../../docs/decisions/0195-versioni-indipendenti.md)).
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
    fn update(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()>;

    /// L'[`update`](VaultStorage::update) di un **dato derivato**: la fusione
    /// sotto lucchetto resta, la scrittura finale passa da
    /// [`write_derived`](VaultStorage::write_derived) invece che da
    /// [`write`](VaultStorage::write).
    ///
    /// È la stessa distinzione di [`write_derived`](VaultStorage::write_derived)
    /// e per la stessa ragione: la fusione toglie la *lost update* — che è un
    /// danno anche per un derivato, perché due installazioni che si
    /// sovrascrivono le fotografie si rimettono a rileggere il vault — mentre
    /// il `fsync` finale compra la sopravvivenza a un crash, che per un file
    /// ricostruibile non vale il suo prezzo. Il default è
    /// [`update`](VaultStorage::update), come per la scrittura: chi non sa di
    /// avere un derivato in mano si comporta come prima.
    fn update_derived(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()> {
        self.update(path, merge_entries)
    }

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

    /// Sposta un file o una cartella soltanto se la destinazione non esiste. L'unica
    /// eccezione è una correzione del caso sullo stesso nome (`nota` → `Nota`),
    /// che alcuni filesystem espongono come destinazione già esistente.
    ///
    /// La verifica e la creazione della destinazione sono una sola operazione:
    /// un `exists` seguito da [`rename`](VaultStorage::rename) lascia fra le due
    /// una finestra in cui un altro processo può posare un file che verrebbe
    /// sovrascritto.
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()>;

    /// Toglie un **file**. Per una cartella c'è [`VaultStorage::remove_dir_all`].
    fn remove(&self, path: &Utf8Path) -> io::Result<()>;

    /// Le voci direttamente dentro `dir` — non ricorsivo, in ordine di path.
    ///
    /// L'ordine è del supporto e non di chi chiama, perché chi chiama sarebbe
    /// costretto a riordinare comunque: `read_dir` restituisce l'ordine del
    /// filesystem, che cambia fra due macchine e fra due corse.
    ///
    /// Un nome che non si scrive in UTF-8 **non è una voce**: si salta e si
    /// annota nel log, e l'elenco resta completo. Nessun [`DocId`] lo sa
    /// nominare, quindi nessuna voce del vault può stare lì sotto, e chi ne
    /// ricava un'assenza non perde niente che conoscesse. Farlo fallire
    /// voleva dire che un solo file in Latin-1, in una cartella qualunque,
    /// fermava l'apertura del vault intero.
    ///
    /// [`DocId`]: fub_abi::DocId
    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>>;

    /// Specie, dimensione e data di **un** path.
    fn stat(&self, path: &Utf8Path) -> io::Result<Stat>;
    /// Specie di un path senza seguire collegamenti o reparse point.
    ///
    /// È una capacità di sicurezza: chi deve dimostrare che nessun componente
    /// di un target esterno reindirizza altrove non può ricostruirla da
    /// [`stat`](VaultStorage::stat), che segue i collegamenti. Il default
    /// rifiuta esplicitamente invece di trasformare «non lo so» in «sicuro».
    fn stat_no_follow(&self, path: &Utf8Path) -> io::Result<Stat> {
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "stat senza seguire collegamenti non supportato dal backend",
        ))
    }
    /// Il nome reale di un path che esiste: assoluto, con ogni collegamento
    /// risolto e le maiuscole del disco.
    ///
    /// Serve a chi registra un nome che poi controllerà in modo severo: un
    /// antenato di sistema (`/var` → `/private/var` su macOS) si risolve una
    /// volta, all'ingresso, invece di far rifiutare ogni path sotto di lui.
    /// Il default rifiuta, come [`stat_no_follow`](VaultStorage::stat_no_follow).
    fn real_path(&self, path: &Utf8Path) -> io::Result<Utf8PathBuf> {
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "risoluzione del path reale non supportata dal backend",
        ))
    }

    /// C'è qualcosa a questo path?
    ///
    /// Ha un default perché è [`VaultStorage::stat`] con la risposta buttata
    /// via, e un supporto che sapesse rispondere più in fretta lo sovrascrive.
    fn exists(&self, path: &Utf8Path) -> bool {
        self.stat(path).is_ok()
    }

    /// Identità del file, quando il supporto può dirla senza seguire il nome
    /// ambientale oltre il capability montato. `None` vuol dire «non lo so» e
    /// impedisce inferenze di rename, non le rende più permissive.
    fn file_identity(&self, _path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        Ok(None)
    }

    /// Timbro opaco di **cambiamento** del file, se il supporto ne ha uno.
    ///
    /// Non è un'identità e non si usa per ricongiungere rinomine: serve solo a
    /// distinguere due osservazioni dello stesso path quando size e mtime sono
    /// uguali. `None` vuol dire che il backend non sa dare questa garanzia; in
    /// quel caso chi chiama degrada alla regola storica size+mtime.
    fn change_stamp(&self, _path: &Utf8Path) -> io::Result<Option<u64>> {
        Ok(None)
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
    /// Il default è l'uguaglianza dei path, più la stessa
    /// [`file_identity`](VaultStorage::file_identity) quando il supporto la sa
    /// dire. Senza identità è la risposta **giusta** per ogni supporto che
    /// tratti un path come una chiave esatta — [`MemStorage`] e ogni supporto
    /// che ci si appoggi. Chi piega i nomi lo deve dire qui,
    /// come lo dice in `read` e in `write`: un supporto che risponde a due nomi
    /// con lo stesso contenuto e a questa domanda con «sono due» è un supporto
    /// che si contraddice.
    ///
    /// Non risale un errore: «non lo so» e «no» sono la stessa cosa per chi
    /// chiama, perché la guardia che ne segue è comunque quella prudente — si
    /// crede che siano due file, e la rinomina si ferma invece di sovrascrivere.
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        matches!(
            (self.file_identity(a), self.file_identity(b)),
            (Ok(Some(a)), Ok(Some(b))) if a == b
        )
    }

    /// Fissa/valida la radice all'ingresso del vault. Un backend a capability
    /// usa questa porta per verificare **l'handle già aperto**, non per risolvere
    /// di nuovo il nome ambientale.
    fn mount_fence(&self, root: &Utf8Path) -> io::Result<()> {
        self.root_validates(root)
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
    fn root_validates(&self, root: &Utf8Path) -> io::Result<()> {
        match self.stat(root) {
            Err(and) if and.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(and) => Err(and),
            Ok(s) if s.kind == EntryKind::Dir => Ok(()),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("the root {root} is not a directory"),
            )),
        }
    }

    /// Da quanto nessuno tocca questa voce — cioè: è **rimasta indietro**?
    ///
    /// La domanda è del supporto per la ragione di
    /// [`root_validates`](VaultStorage::root_validates): la risposta si legge sul
    /// **suo** orologio, ed è quello con cui lui data ciò che scrive
    /// ([`Stat::mtime`]). Il default è il tempo di un disco vero, millisecondi
    /// dall'epoca; [`MemStorage`], dove il tempo è un contatore di operazioni,
    /// lo sovrascrive con la stessa forma letta nella sua unità.
    ///
    /// Serve a una cosa sola, e sta sul trait perché quella cosa la fa il
    /// kernel su qualunque supporto: riconoscere il temporaneo di una scrittura
    /// che non finirà mai (difetto 0155, [`SCADENZA_DEL_TEMPORANEO_MS`]).
    fn is_left_behind(&self, stat: &Stat) -> bool {
        crate::time::now_unix_millis().saturating_sub(stat.mtime) >= TEMP_FILE_EXPIRY_MS
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

    /// Crea una cartella **vuota**, con le cartelle mancanti sopra di lei.
    ///
    /// L'ultimo segmento deve essere libero: se c'è già una voce — cartella o
    /// file — la risposta è `AlreadyExists` e niente cambia. Una cartella già
    /// presente non è un successo silenzioso, perché chi chiede di crearla sta
    /// scegliendo un nome e merita di sapere che era occupato.
    ///
    /// Il default è `Unsupported`: un supporto che non sa rappresentare una
    /// cartella senza file dentro lo dice, invece di inventarne una che
    /// sparisce alla prossima camminata.
    fn create_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("{dir}: il supporto non crea cartelle vuote"),
        ))
    }
}

// --- il filesystem ---------------------------------------------------------
