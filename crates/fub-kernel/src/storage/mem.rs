//! `MemStorage`: il vault in memoria, seconda implementazione del trait.

use super::*;

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
/// ([0046](../../../docs/decisions/0188-identita-path-e-rename.md)), e un
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
const MEMORY_TEMP_FILE_EXPIRY: u64 = 16;

#[derive(Debug, Default)]
pub struct MemStorage {
    inner: Shelter<Mem>,
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
    fn now(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    /// Fa nascere le cartelle che mancano, e **si ferma se una di esse è già un
    /// file**: `create_dir_all` sul disco risponde un errore, e un doppio che
    /// invece accettasse si ritroverebbe uno stesso path elencato come file e
    /// come cartella, cioè uno stato che il filesystem non sa rappresentare.
    fn make_dirs(&mut self, path: &Utf8Path, now: u64) -> io::Result<()> {
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
                self.dirs.insert(cur.clone(), now);
                // Una cartella nuova cambia quella che la contiene.
                if let Some(parent) = cur.parent() {
                    self.touches(parent, now);
                }
            }
        }
        Ok(())
    }

    /// Data la cartella che contiene `path`, se è una cartella conosciuta.
    fn touches_the_parent(&mut self, path: &Utf8Path, now: u64) {
        if let Some(parent) = path.parent() {
            self.touches(parent, now);
        }
    }

    fn touches(&mut self, dir: &Utf8Path, now: u64) {
        if let Some(when) = self.dirs.get_mut(dir) {
            *when = now;
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
    /// La politica non è scritta qui: è quella del [`Shelter`], che è la porta
    /// del kernel per un dato che un panico a metà non rende incredibile
    /// ([0126](../../../docs/decisions/0184-eventi-accodati-e-job.md)).
    /// Ed è il caso: `fondi` non riceve niente della mappa, e l'unica mutazione
    /// dell'`update` avviene **dopo** che è tornato, quindi ciò che il panico
    /// lascia dietro di sé è lo stato di prima — esattamente ciò che lascia il
    /// disco.
    fn lock(&self) -> MutexGuard<'_, Mem> {
        self.inner.acquire()
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

    /// Fetta `[start..end)` sui byte in memoria: `start` è `offset` saturato
    /// sulla lunghezza, `end` è `start+len` saturato. Nessuna apertura, nessuna
    /// lettura intera oltre la copia del pezzo.
    fn read_at(&self, path: &Utf8Path, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        if len == 0 {
            if !self.lock().files.contains_key(path) {
                return Err(not_found(path));
            }
            return Ok(Vec::new());
        }
        let mem = self.lock();
        let (bytes, _) = mem.files.get(path).ok_or_else(|| not_found(path))?;
        let start = offset.min(bytes.len() as u64) as usize;
        let end = start.saturating_add(len).min(bytes.len());
        Ok(bytes[start..end].to_vec())
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
        let now = mem.now();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, now)?;
        }
        mem.files.insert(path.to_owned(), (bytes.to_vec(), now));
        // Anche una riscrittura data la cartella: di là è una rename dentro di
        // essa (§15.2), e una rename è una voce di directory che cambia.
        mem.touches_the_parent(path, now);
        Ok(Stat {
            kind: EntryKind::File,
            size: bytes.len() as u64,
            mtime: now,
        })
    }

    /// Qui l'aggiornamento è atomico **davvero**, e non per modo di dire come
    /// l'atomicità della `write`: il lucchetto della mappa si tiene per tutto il
    /// giro, quindi fra la rilettura e la scrittura non ci si infila nessuno. È
    /// anche la ragione per cui `fondi` non deve rientrare nel supporto — questo
    /// `Mutex` non è rientrante.
    fn update(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.dirs.contains_key(path) {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("{path}: è una cartella"),
            ));
        }
        let current = mem.files.get(path).map(|(bytes, _)| bytes.clone());
        let Some(new) = merge_entries(current.as_deref())? else {
            return Ok(());
        };
        let now = mem.now();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, now)?;
        }
        mem.files.insert(path.to_owned(), (new, now));
        mem.touches_the_parent(path, now);
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
        let now = mem.now();
        if let Some(parent) = path.parent() {
            mem.make_dirs(parent, now)?;
        }
        let born_now = !mem.files.contains_key(path);
        let entry = mem
            .files
            .entry(path.to_owned())
            .or_insert_with(|| (Vec::new(), now));
        entry.0.extend_from_slice(bytes);
        entry.1 = now;
        // Aggiungere in coda a un file che c'è già non tocca la cartella: di là
        // è una scrittura sull'inode, non una voce di directory in più.
        if born_now {
            mem.touches_the_parent(path, now);
        }
        Ok(())
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        let now = mem.now();
        if let Some(parent) = to.parent() {
            mem.make_dirs(parent, now)?;
        }
        if let Some(entry) = mem.files.remove(from) {
            // La data del file non si tocca — una rename non riscrive l'inode,
            // ed è la proprietà su cui poggia il timbro del cestino — ma le due
            // cartelle sì: una voce se ne va di là e ne arriva una di qua.
            mem.files.insert(to.to_owned(), entry);
            mem.touches_the_parent(from, now);
            mem.touches_the_parent(to, now);
            return Ok(());
        }
        if !mem.dirs.contains_key(from) {
            return Err(not_found(from));
        }
        // Una cartella si sposta con tutto ciò che ha dentro, e i path dentro
        // sono chiavi: si riscrivono. È l'unica operazione che in memoria costa
        // più che sul filesystem, e vale la pena perché il chiamante che sposta
        // uno spazio per-documento (§13.2) sposta esattamente una cartella.
        let relocate = |old: &Utf8Path| -> Option<Utf8PathBuf> {
            old.strip_prefix(from).ok().map(|rest| {
                if rest.as_str().is_empty() {
                    to.to_owned()
                } else {
                    to.join(rest)
                }
            })
        };
        let files: Vec<_> = mem
            .files
            .keys()
            .filter_map(|k| relocate(k).map(|new| (k.clone(), new)))
            .collect();
        for (old, new) in files {
            let entry = mem.files.remove(&old).expect("appena elencato");
            mem.files.insert(new, entry);
        }
        let dirs: Vec<_> = mem
            .dirs
            .iter()
            .filter_map(|(k, when)| relocate(k).map(|new| (k.clone(), new, *when)))
            .collect();
        for (old, new, when) in dirs {
            mem.dirs.remove(&old);
            mem.dirs.insert(new, when);
        }
        mem.touches_the_parent(from, now);
        mem.touches_the_parent(to, now);
        Ok(())
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if from == to {
            return mem
                .files
                .contains_key(from)
                .then_some(())
                .ok_or_else(|| not_found(from));
        }
        if mem.files.contains_key(to) || mem.dirs.contains_key(to) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{to}: esiste già"),
            ));
        }
        let now = mem.now();
        if let Some(entry) = mem.files.remove(from) {
            if let Some(parent) = to.parent() {
                if let Err(error) = mem.make_dirs(parent, now) {
                    mem.files.insert(from.to_owned(), entry);
                    return Err(error);
                }
            }
            mem.files.insert(to.to_owned(), entry);
            mem.touches_the_parent(from, now);
            mem.touches_the_parent(to, now);
            return Ok(());
        }
        if !mem.dirs.contains_key(from) {
            return Err(not_found(from));
        }
        if let Some(parent) = to.parent() {
            mem.make_dirs(parent, now)?;
        }
        let relocate = |old: &Utf8Path| -> Option<Utf8PathBuf> {
            old.strip_prefix(from).ok().map(|rest| {
                if rest.as_str().is_empty() {
                    to.to_owned()
                } else {
                    to.join(rest)
                }
            })
        };
        let files: Vec<_> = mem
            .files
            .keys()
            .filter_map(|path| relocate(path).map(|new| (path.clone(), new)))
            .collect();
        for (old, new) in files {
            let entry = mem.files.remove(&old).expect("appena elencato");
            mem.files.insert(new, entry);
        }
        let dirs: Vec<_> = mem
            .dirs
            .iter()
            .filter_map(|(path, when)| relocate(path).map(|new| (path.clone(), new, *when)))
            .collect();
        for (old, new, when) in dirs {
            mem.dirs.remove(&old);
            mem.dirs.insert(new, when);
        }
        mem.touches_the_parent(from, now);
        mem.touches_the_parent(to, now);
        Ok(())
    }

    /// Qui il tempo è un contatore di operazioni e non un orologio (vedi la
    /// nota sul tempo di [`MemStorage`]), quindi la soglia si legge in
    /// operazioni: [`SCADENZA_DEL_TEMPORANEO_IN_MEMORIA`].
    fn is_left_behind(&self, stat: &Stat) -> bool {
        self.lock().tick.saturating_sub(stat.mtime) >= MEMORY_TEMP_FILE_EXPIRY
    }

    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.files.remove(path).is_none() {
            return Err(not_found(path));
        }
        let now = mem.now();
        mem.touches_the_parent(path, now);
        Ok(())
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let mem = self.lock();
        if !mem.dirs.contains_key(dir) {
            return Err(not_found(dir));
        }
        let child = |path: &Utf8Path| path.parent() == Some(dir);
        let mut out: Vec<DirEntry> = mem
            .files
            .iter()
            .filter(|(path, _)| child(path))
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
                    .filter(|(path, _)| child(path))
                    .map(|(path, when)| DirEntry {
                        path: path.clone(),
                        stat: Stat {
                            kind: EntryKind::Dir,
                            size: 0,
                            mtime: *when,
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
        if let Some(when) = mem.dirs.get(path) {
            return Ok(Stat {
                kind: EntryKind::Dir,
                size: 0,
                mtime: *when,
            });
        }
        Err(not_found(path))
    }
    fn stat_no_follow(&self, path: &Utf8Path) -> io::Result<Stat> {
        self.stat(path)
    }
    /// In memoria non ci sono collegamenti: un path che esiste è già reale.
    fn real_path(&self, path: &Utf8Path) -> io::Result<Utf8PathBuf> {
        self.stat(path)?;
        Ok(path.to_owned())
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
        let child = |path: &Utf8Path| path.parent() == Some(dir);
        if mem.files.keys().any(|p| child(p)) || mem.dirs.keys().any(|p| child(p)) {
            return Err(io::Error::new(
                io::ErrorKind::DirectoryNotEmpty,
                format!("{dir}: non è vuota"),
            ));
        }
        mem.dirs.remove(dir);
        let now = mem.now();
        mem.touches_the_parent(dir, now);
        Ok(())
    }

    fn create_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        let mut mem = self.lock();
        if mem.files.contains_key(dir) || mem.dirs.contains_key(dir) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{dir}: esiste già"),
            ));
        }
        let now = mem.now();
        mem.make_dirs(dir, now)
    }
}
