//! Lo stato ripiegato dei vault tenuto in memoria, con il disco come unica
//! autorità.
//!
//! Prima ogni push, pull e status rileggeva, deserializzava e rivalidava tutto
//! `state.json` (testi cifrati compresi) e ogni push rileggeva tre volte la
//! coda `.jsonl` della replica. Qui lo stato letto resta in memoria fra una
//! richiesta e l'altra, insieme a ciò che serve per non riaprire la coda e per
//! riprendere un pull a pagine dal punto in cui si era fermato.
//!
//! Perché è sicuro:
//! - **un solo processo** scrive la data dir: il lease esclusivo
//!   ([`crate::lease`]) fa uscire il secondo. Dentro il processo il lavoro su
//!   un vault gira sotto il lock del vault ([`super::VaultWork`]).
//! - **il disco resta l'autorità.** Ogni apertura confronta l'impronta del
//!   file (dimensione, mtime, ctime, inode e device) con quella registrata
//!   quando lo stato è entrato in memoria; se il file è cambiato, o non si
//!   riesce a leggerne i metadati, lo stato si rilegge e si rivalida da capo.
//!   Ogni salvataggio passa da `atomic_write` (temporaneo, fsync, rename), che
//!   cambia inode: un file sostituito non ha mai l'impronta di prima.
//! - **una modifica non salvata non resta in memoria.** Chi modifica lo stato
//!   lo prende fuori dalla mappa ([`VaultState::open`]); se il salvataggio
//!   fallisce, o la richiesta esce prima, lo stato modificato si butta e la
//!   richiesta seguente rilegge il valore di prima dal disco.
//! - **niente letture sporche**: lo stato preso da una richiesta non è nella
//!   mappa finché la richiesta non lo restituisce; un'altra che arrivasse
//!   senza il lock del vault (solo i test lo fanno) rilegge il disco.
//!
//! La memoria ha un tetto ([`CACHE_BUDGET_BYTES`], misurato sulla dimensione
//! di `state.json`): oltre, si lasciano andare i vault usati meno di recente.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

use parking_lot::Mutex;

use super::causality::VersionVector;
use super::versions::{self, SyncState};

/// Tetto della memoria per gli stati tenuti: la somma delle dimensioni dei
/// loro `state.json`. Un vault più grande del tetto non si tiene.
pub const CACHE_BUDGET_BYTES: u64 = 512 * 1024 * 1024;

/// Cursori di pull ricordati per vault: bastano per qualche replica che
/// scarica in parallelo; il più vecchio lascia il posto.
const MAX_PULL_CURSORS: usize = 32;

/// L'impronta di un file: cambia quando il file è sostituito o riscritto.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    unix: (u64, u64, i64, i64),
}

/// L'impronta di `path`; `None` se il file non c'è. Un errore dei metadati
/// (permessi, disco) è un errore: un file che non si sa dire non è assente.
pub(super) fn stamp_of(path: &Path) -> std::io::Result<Option<Stamp>> {
    match std::fs::metadata(path) {
        Ok(meta) => Ok(Some(Stamp {
            len: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            unix: {
                use std::os::unix::fs::MetadataExt;
                (meta.dev(), meta.ino(), meta.ctime(), meta.ctime_nsec())
            },
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Ciò che si sa della coda di una replica senza rileggerla.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct QueueMemo {
    /// Impronta del file quando il conteggio è stato fatto.
    pub stamp: Option<Stamp>,
    /// Op in attesa di ack.
    pub pending: usize,
    /// Byte che il tetto della coda misura: per ogni op la riga JSON più il
    /// fine riga, come [`super::queue::enforce_cap`].
    pub bytes: u64,
    /// Ogni op della coda è già ripiegato nello stato tenuto insieme: il
    /// ripasso di recupero del push non ha niente da fare.
    pub folded: bool,
}

/// Dove riprende un pull: la pagina che finisce a `offset`, per quel vettore
/// di partenza, quel vault e quell'epoca di chiave.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PullCursorKey {
    pub since_vv: VersionVector,
    pub vault_id: String,
    pub active_epoch: u32,
    pub offset: u64,
}

/// La prima versione non ancora servita: chiave della catena e indice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PullCursor {
    pub doc_key: String,
    pub index: usize,
}

struct Entry {
    /// Impronta di `state.json` per questo stato (`None`: file assente).
    stamp: Option<Stamp>,
    state: SyncState,
    queues: HashMap<String, QueueMemo>,
    cursors: VecDeque<(PullCursorKey, PullCursor)>,
    used: u64,
}

impl Entry {
    fn size(&self) -> u64 {
        self.stamp.map_or(0, |stamp| stamp.len)
    }
}

#[derive(Default)]
struct Cache {
    entries: HashMap<PathBuf, Entry>,
    clock: u64,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Mutex::default);

/// Lo stato di un vault preso per una richiesta. Si legge con [`Self::state`];
/// [`Self::state_mut`] lo segna modificato, e uno stato modificato torna in
/// memoria solo se [`Self::save`] riesce.
pub(super) struct VaultState {
    dir: PathBuf,
    entry: Option<Entry>,
    dirty: bool,
}

impl VaultState {
    /// Lo stato del vault in `dir`: quello in memoria se il file non è
    /// cambiato, altrimenti riletto e validato dal disco.
    pub fn open(dir: &Path) -> Result<Self, String> {
        let path = versions::state_path(dir);
        let cached = CACHE.lock().entries.remove(dir);
        let stamp = stamp_of(&path).map_err(|e| format!("sync state read: {e}"))?;
        let entry = match cached {
            Some(entry) if entry.stamp == stamp => entry,
            _ => {
                // Impronta prima della lettura: se il file cambiasse nel
                // mezzo, la prossima apertura vedrebbe un'impronta diversa e
                // rileggerebbe, mai il contrario.
                let state = versions::load(dir)?;
                Entry {
                    stamp,
                    state,
                    queues: HashMap::new(),
                    cursors: VecDeque::new(),
                    used: 0,
                }
            }
        };
        Ok(Self {
            dir: dir.to_path_buf(),
            entry: Some(entry),
            dirty: false,
        })
    }

    fn entry(&self) -> &Entry {
        self.entry.as_ref().expect("vault state present until drop")
    }

    fn entry_mut(&mut self) -> &mut Entry {
        self.entry.as_mut().expect("vault state present until drop")
    }

    pub fn state(&self) -> &SyncState {
        &self.entry().state
    }

    /// Lo stato da modificare: da qui in poi torna in memoria solo salvato.
    pub fn state_mut(&mut self) -> &mut SyncState {
        self.dirty = true;
        &mut self.entry_mut().state
    }

    /// Scrive lo stato (temporaneo, fsync, rename) e, se la scrittura riesce,
    /// lo tiene in memoria con la nuova impronta. Se fallisce, il disco ha il
    /// valore di prima e la memoria lo rileggerà.
    pub fn save(&mut self) -> Result<(), String> {
        versions::write(&self.dir, self.state())?;
        let stamp = stamp_of(&versions::state_path(&self.dir));
        let entry = self.entry_mut();
        // Le posizioni dei pull valgono per lo stato di prima.
        entry.cursors.clear();
        match stamp {
            Ok(stamp) => {
                entry.stamp = stamp;
                self.dirty = false;
            }
            // Scritto, ma senza impronta non si può riconoscere: si rilegge.
            Err(_) => self.dirty = true,
        }
        Ok(())
    }

    /// Il conteggio della coda di `replica_id`, se il file è ancora quello
    /// contato.
    pub fn queue(&self, queue_path: &Path, replica_id: &str) -> Option<QueueMemo> {
        let memo = *self.entry().queues.get(replica_id)?;
        let now = stamp_of(queue_path).ok()?;
        (now == memo.stamp).then_some(memo)
    }

    pub fn set_queue(&mut self, replica_id: &str, memo: QueueMemo) {
        self.entry_mut().queues.insert(replica_id.to_string(), memo);
    }

    pub fn pull_cursor(&self, key: &PullCursorKey) -> Option<PullCursor> {
        self.entry()
            .cursors
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, cursor)| cursor.clone())
    }

    pub fn set_pull_cursor(&mut self, key: PullCursorKey, cursor: PullCursor) {
        let cursors = &mut self.entry_mut().cursors;
        cursors.retain(|(k, _)| *k != key);
        if cursors.len() >= MAX_PULL_CURSORS {
            cursors.pop_front();
        }
        cursors.push_back((key, cursor));
    }
}

impl Drop for VaultState {
    fn drop(&mut self) {
        let Some(mut entry) = self.entry.take() else {
            return;
        };
        if self.dirty {
            return;
        }
        let mut cache = CACHE.lock();
        if entry.size() > CACHE_BUDGET_BYTES {
            return;
        }
        cache.clock += 1;
        entry.used = cache.clock;
        // Un'altra richiesta senza lock può aver già rimesso uno stato più
        // nuovo: quello resta.
        if cache.entries.contains_key(&self.dir) {
            return;
        }
        let mut total = cache.entries.values().map(Entry::size).sum::<u64>() + entry.size();
        while total > CACHE_BUDGET_BYTES {
            let Some(oldest) = cache
                .entries
                .iter()
                .min_by_key(|(_, e)| e.used)
                .map(|(dir, _)| dir.clone())
            else {
                break;
            };
            if let Some(evicted) = cache.entries.remove(&oldest) {
                total -= evicted.size();
            }
        }
        cache.entries.insert(self.dir.clone(), entry);
    }
}

/// Lo stato del vault in `dir` non vale più (scritto da fuori della memoria).
pub(super) fn forget(dir: &Path) {
    CACHE.lock().entries.remove(dir);
}

/// La coda di `replica_id` è stata riscritta senza alcuni op già ripiegati
/// (ack): il conteggio in memoria segue il file nuovo. Se lo stato non è in
/// memoria non c'è niente da aggiornare.
pub(super) fn note_queue_rewrite(
    dir: &Path,
    queue_path: &Path,
    replica_id: &str,
    pending: usize,
    bytes: u64,
) {
    let mut cache = CACHE.lock();
    let Some(entry) = cache.entries.get_mut(dir) else {
        return;
    };
    let Some(memo) = entry.queues.get_mut(replica_id) else {
        return;
    };
    match stamp_of(queue_path) {
        Ok(stamp) => {
            *memo = QueueMemo {
                stamp,
                pending,
                bytes,
                folded: memo.folded,
            };
        }
        Err(_) => {
            entry.queues.remove(replica_id);
        }
    }
}

/// Solo per i test: dimentica tutto, come un processo che riparte.
#[cfg(test)]
pub(super) fn forget_all() {
    CACHE.lock().entries.clear();
}

/// Solo per i test: lo stato di `dir` è in memoria.
#[cfg(test)]
pub(super) fn cached(dir: &Path) -> bool {
    CACHE.lock().entries.contains_key(dir)
}
