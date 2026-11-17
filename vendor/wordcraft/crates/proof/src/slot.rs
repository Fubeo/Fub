//! A dictionary kept in memory between uses that can be released: the Hunspell dictionaries read
//! from disk and the bundled hyphenation data. Released, it is read (or decoded) again on next use.
//!
//! Readers share the dictionary through an `Arc`, so a release never takes a dictionary away from
//! a check in progress: that check finishes with it, and the memory goes when the last holder
//! drops it. Reading happens outside the slot's lock, so a release or a size query never waits for
//! a load; one thread loads while the others that need the dictionary wait for that load instead
//! of repeating it. A dictionary given in memory ([`Slot::install`]) can't be read again and is
//! never released.

use std::collections::HashMap;
use std::hash::BuildHasher;
use std::mem::size_of;
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// Estimated heap bytes of a structure: the capacity of its buffers and tables, element sizes
/// included, not what is in use. Allocator overhead isn't counted, nor data the structure only
/// borrows (bundled text stays in the binary).
pub(crate) trait HeapBytes {
    fn heap_bytes(&self) -> usize;
}

/// Heap bytes of the table of a `HashMap` with this capacity and `T`-sized entries: an entry and a
/// control byte per bucket (the buckets are the capacity over the 7/8 load factor) plus one group
/// of control bytes. The entries' own buffers are the caller's to add.
pub(crate) fn table_bytes<T>(capacity: usize) -> usize {
    let buckets = match capacity {
        0 => return 0,
        1..7 => capacity + 1,
        _ => capacity / 7 * 8,
    };
    buckets * (size_of::<T>() + 1) + 16
}

/// [`table_bytes`] of a map, plus its keys' and values' buffers measured by `extra`.
pub(crate) fn map_bytes<K, V, S: BuildHasher>(map: &HashMap<K, V, S>, extra: impl Fn(&K, &V) -> usize) -> usize {
    table_bytes::<(K, V)>(map.capacity()) + map.iter().map(|(k, v)| extra(k, v)).sum::<usize>()
}

struct State<T> {
    dict: Option<Arc<T>>,
    /// [`HeapBytes::heap_bytes`] of `dict` when it was loaded (0 for one given in memory).
    bytes: usize,
    /// `dict` was given with [`Slot::install`], not loaded: it can't be read again.
    in_memory: bool,
}

pub(crate) struct Slot<T> {
    state: RwLock<State<T>>,
    loading: Mutex<()>,
}

impl<T: HeapBytes> Slot<T> {
    pub(crate) const fn new() -> Self {
        Slot { state: RwLock::new(State { dict: None, bytes: 0, in_memory: false }), loading: Mutex::new(()) }
    }

    fn read(&self) -> RwLockReadGuard<'_, State<T>> {
        self.state.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, State<T>> {
        self.state.write().unwrap_or_else(PoisonError::into_inner)
    }

    /// The dictionary, loaded with `load` first when there is none. Another thread's install (or
    /// load) that lands first wins.
    pub(crate) fn get(&self, load: impl FnOnce() -> T) -> Arc<T> {
        if let Some(d) = self.read().dict.clone() {
            return d;
        }
        let _loading = self.loading.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(d) = self.read().dict.clone() {
            return d;
        }
        let loaded = Arc::new(load());
        let bytes = loaded.heap_bytes();
        let mut state = self.write();
        if let Some(d) = &state.dict {
            return d.clone();
        }
        *state = State { dict: Some(loaded.clone()), bytes, in_memory: false };
        loaded
    }

    /// Use `dict` from now on; it stays until [`Slot::forget`].
    pub(crate) fn install(&self, dict: T) {
        *self.write() = State { dict: Some(Arc::new(dict)), bytes: 0, in_memory: true };
    }

    /// Drop the dictionary, even one given in memory, so the next use loads one again.
    pub(crate) fn forget(&self) {
        *self.write() = State { dict: None, bytes: 0, in_memory: false };
    }

    /// Drop a loaded dictionary (one given in memory stays), returning its estimated bytes.
    pub(crate) fn release(&self) -> usize {
        let mut state = self.write();
        if state.in_memory || state.dict.is_none() {
            return 0;
        }
        let bytes = state.bytes;
        let held = std::mem::replace(&mut *state, State { dict: None, bytes: 0, in_memory: false });
        drop(state);
        drop(held);
        bytes
    }

    /// Estimated heap bytes of the loaded dictionary ([`Slot::release`] would drop them); 0 when
    /// none is loaded or it was given in memory.
    pub(crate) fn loaded_bytes(&self) -> usize {
        self.read().bytes
    }

    /// Was the dictionary given in memory with [`Slot::install`]?
    pub(crate) fn in_memory(&self) -> bool {
        self.read().in_memory
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Words(Vec<String>);

    impl HeapBytes for Words {
        fn heap_bytes(&self) -> usize {
            self.0.capacity() * size_of::<String>() + self.0.iter().map(String::capacity).sum::<usize>()
        }
    }

    fn words() -> Words {
        Words(vec!["kot".to_string(), "pies".to_string()])
    }

    #[test]
    fn a_released_dictionary_is_loaded_again() {
        let slot = Slot::<Words>::new();
        assert_eq!((slot.loaded_bytes(), slot.release()), (0, 0));
        let held = slot.get(words);
        let bytes = slot.loaded_bytes();
        assert!(bytes > 0);
        // A check holding it keeps a working dictionary; the slot is empty.
        assert_eq!(slot.release(), bytes);
        assert_eq!(slot.loaded_bytes(), 0);
        assert_eq!(held.0[1], "pies");
        assert_eq!(slot.release(), 0, "releasing twice is harmless");
        let again = slot.get(words);
        assert!(!Arc::ptr_eq(&held, &again) && again.0[0] == "kot");
        assert_eq!(slot.loaded_bytes(), bytes);
        // Nothing installed on the system: an empty dictionary, which holds nothing.
        slot.forget();
        assert!(slot.get(|| Words(Vec::new())).0.is_empty());
        assert_eq!(slot.loaded_bytes(), 0);
    }

    #[test]
    fn a_dictionary_given_in_memory_is_not_released() {
        let slot = Slot::<Words>::new();
        slot.install(words());
        assert_eq!((slot.release(), slot.loaded_bytes()), (0, 0));
        assert!(slot.in_memory());
        assert_eq!(slot.get(|| Words(Vec::new())).0.len(), 2, "still the installed one");
        slot.forget();
        assert!(!slot.in_memory() && slot.get(|| Words(Vec::new())).0.is_empty());
    }

    #[test]
    fn concurrent_first_uses_load_once() {
        let slot = Slot::<Words>::new();
        let loads = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    slot.get(|| {
                        loads.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        std::thread::sleep(std::time::Duration::from_millis(20));
                        words()
                    })
                });
            }
        });
        assert_eq!(loads.into_inner(), 1);
    }

    #[test]
    fn a_hunspell_dictionary_read_from_disk_is_measured_released_and_read_again() {
        let dir = std::env::temp_dir().join(format!("wordcraft-slot-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (aff, dic) = (dir.join("it_IT.aff"), dir.join("it_IT.dic"));
        std::fs::write(&aff, crate::it::test_dict::AFF).unwrap();
        std::fs::write(&dic, crate::it::test_dict::DIC).unwrap();
        let slot = Slot::<crate::affix::AffixDict>::new();
        let read = || crate::hunspell::load(&aff, &dic).unwrap();
        assert!(crate::it::is_correct_with(&slot.get(read), "amico"));
        let bytes = slot.loaded_bytes();
        assert!(bytes > crate::it::test_dict::DIC.len(), "{bytes}");
        assert_eq!(slot.release(), bytes);
        assert_eq!(slot.loaded_bytes(), 0);
        let again = slot.get(read);
        assert!(crate::it::is_correct_with(&again, "amico") && !crate::it::is_correct_with(&again, "amicco"));
        assert_eq!(slot.loaded_bytes(), bytes);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn hyphenation_data_is_measured_released_and_decoded_again() {
        let slot = Slot::<crate::patterns::Patterns>::new();
        let pl = || crate::patterns::Patterns::parse(include_str!("../../../assets/hyphenation/pl.pat"));
        let held = slot.get(pl);
        let bytes = slot.loaded_bytes();
        assert!(bytes > 10_000, "{bytes}");
        assert_eq!(slot.release(), bytes);
        assert_eq!(slot.loaded_bytes(), 0);
        assert_eq!(slot.get(pl).len(), held.len());
        assert_eq!(slot.loaded_bytes(), bytes);
        let en = Slot::<crate::dict::Dictionary>::new();
        en.get(|| (*crate::dict::Dictionary::en_us()).clone());
        assert!(en.loaded_bytes() > 150_000 * 12, "{}", en.loaded_bytes());
    }

    #[test]
    fn table_bytes_follow_the_load_factor() {
        assert_eq!(table_bytes::<u64>(0), 0);
        assert_eq!(table_bytes::<u64>(3), 4 * 9 + 16);
        assert_eq!(table_bytes::<u64>(7), 8 * 9 + 16);
        assert_eq!(table_bytes::<u64>(14), 16 * 9 + 16);
        let mut m: HashMap<u64, u64> = HashMap::new();
        m.extend((0..100).map(|i| (i, i)));
        assert_eq!(map_bytes(&m, |_, _| 0), table_bytes::<(u64, u64)>(m.capacity()));
        assert!(m.capacity() >= 100 && table_bytes::<(u64, u64)>(m.capacity()) >= 128 * 17);
    }
}
