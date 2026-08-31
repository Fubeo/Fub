from pathlib import Path

# --- storage: identità stabile del file ------------------------------------
p = Path('crates/fub-kernel/src/storage.rs')
s = p.read_text()
stat_marker = '''pub struct Stat {
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
'''
identity = '''pub struct Stat {
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
'''
if 'pub struct FileIdentity' not in s:
    if s.count(stat_marker) != 1:
        raise SystemExit('Stat marker non trovato')
    s = s.replace(stat_marker, identity)

same = '''    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        a == b
    }
'''
with_identity = '''    /// Identità del file, quando il supporto può dirla senza seguire il nome
    /// ambientale oltre il capability montato. `None` vuol dire «non lo so» e
    /// impedisce inferenze di rename, non le rende più permissive.
    fn file_identity(&self, _path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        Ok(None)
    }

    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        matches!(
            (self.file_identity(a), self.file_identity(b)),
            (Ok(Some(a)), Ok(Some(b))) if a == b
        )
    }
'''
if 'fn file_identity(&self' not in s:
    if s.count(same) != 1:
        raise SystemExit('VaultStorage::same_file default non trovato')
    s = s.replace(same, with_identity)
p.write_text(s)

# Export pubblico del tipo usato dal trait pubblico.
p = Path('crates/fub-kernel/src/lib.rs')
s = p.read_text()
s = s.replace(
'''    ConditionalWrite, DirEntry, EntryKind, FsStorage, MemStorage, RootedFsStorage, Stat,
    VaultStorage,
''',
'''    ConditionalWrite, DirEntry, EntryKind, FileIdentity, FsStorage, MemStorage, RootedFsStorage,
    Stat, VaultStorage,
''')
p.write_text(s)

# RootedFsStorage: estrai la stessa identità che same_file calcolava già.
p = Path('crates/fub-kernel/src/storage/rooted.rs')
s = p.read_text()
s = s.replace(
'''    same_parent_resolution_name, temp_name, ConditionalWrite, DirEntry, EntryKind, Merge, Stat,
    VaultStorage,
''',
'''    same_parent_resolution_name, temp_name, ConditionalWrite, DirEntry, EntryKind, FileIdentity,
    Merge, Stat, VaultStorage,
''')
helper_marker = '''    fn rel_buf(&self, path: &Utf8Path) -> io::Result<std::path::PathBuf> {
        Ok(self.rel(path)?.to_owned())
    }
'''
helper = helper_marker + '''
    fn identity(&self, path: &Utf8Path) -> io::Result<FileIdentity> {
        #[cfg(unix)]
        {
            use cap_std::fs::MetadataExt;
            let metadata = self.dir.metadata(self.rel(path)?)?;
            Ok(FileIdentity {
                volume: metadata.dev(),
                file: metadata.ino(),
            })
        }
        #[cfg(windows)]
        {
            use std::mem::MaybeUninit;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };
            let file = self.dir.open(self.rel(path)?)?;
            let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
            // SAFETY: l'handle resta vivo e il puntatore indica storage valido.
            let ok = unsafe {
                GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr())
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: un ritorno non-zero inizializza la struttura.
            let info = unsafe { info.assume_init() };
            Ok(FileIdentity {
                volume: info.dwVolumeSerialNumber as u64,
                file: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            })
        }
    }
'''
if 'fn identity(&self, path: &Utf8Path)' not in s:
    if s.count(helper_marker) != 1:
        raise SystemExit('Rooted rel_buf marker non trovato')
    s = s.replace(helper_marker, helper)
old_same_start = s.find('    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {')
old_same_end = s.find('\n    fn mount_fence(', old_same_start)
if old_same_start < 0 or old_same_end < 0:
    raise SystemExit('Rooted same_file non trovato')
new_same = '''    fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        self.identity(path).map(Some)
    }

    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        matches!((self.identity(a), self.identity(b)), (Ok(a), Ok(b)) if a == b)
    }
'''
s = s[:old_same_start] + new_same + s[old_same_end:]
p.write_text(s)

# Vault: una porta stretta per chiedere l'identità senza far uscire il path.
p = Path('crates/fub-kernel/src/vault.rs')
s = p.read_text()
s = s.replace(
'use crate::storage::{EntryKind, Stat, VaultStorage};',
'use crate::storage::{EntryKind, FileIdentity, Stat, VaultStorage};')
stat_method = '''    pub fn stat(&self, id: &DocId) -> Result<Stat> {
        let path = self.path(id);
        self.storage
            .stat(&path)
            .map_err(|source| KernelError::Io { path, source })
    }
'''
stat_plus = stat_method + '''
    /// Identità filesystem della voce, se il backend la conosce. Un errore o un
    /// backend senza identità diventano `None`: il chiamante deve rinunciare a
    /// inferire una rinomina, mai inventarne una.
    pub fn file_identity(&self, id: &DocId) -> Option<FileIdentity> {
        self.storage.file_identity(&self.path(id)).ok().flatten()
    }
'''
if 'pub fn file_identity(&self, id: &DocId)' not in s:
    if s.count(stat_method) != 1:
        raise SystemExit('Vault::stat marker non trovato')
    s = s.replace(stat_method, stat_plus)
p.write_text(s)

# --- EntryStore: schema v5, identità persistita, cache solo dopo digest ------
p = Path('crates/fub-kernel/src/entries.rs')
s = p.read_text()
s = s.replace('use crate::storage::{Durable, VaultStorage};', 'use crate::storage::{Durable, FileIdentity, VaultStorage};')
s = s.replace('const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(4);', 'const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(5);')
if '/// v5:' not in s:
    anchor = '''/// v4: la coda di record (difetto 0112). La tabella intera si riscriveva a ogni
/// voce cambiata, e su un vault grande il prezzo si pagava a ogni salvataggio.
/// Il file diventa una coda di [`Mutazione`] — `upsert`, `remove`, `snapshot` —
/// e la riscrittura integrale resta solo per la compattazione. Un file v3 non
/// si converte: non comincia con `\\n`, quindi [`decodifica`] risponde `None` e
/// il primo [`EntryStore::store`] lo sostituisce con una fotografia — la regola
/// di sempre, «un derivato di una versione che non si conosce si rifà».
'''
    extra = anchor + '''///
/// v5: ogni voce può portare l'identità filesystem. Il ricongiungimento di una
/// rinomina fatta ad app chiusa richiede identità **e** digest: una copia seguita
/// da cancellazione ha gli stessi byte e un file diverso, quindi non eredita mai
/// bozza, versioni o side-data della sorgente.
'''
    if s.count(anchor) != 1:
        raise SystemExit('doc schema v4 non trovato')
    s = s.replace(anchor, extra)
stored = '''pub(crate) struct StoredEntry {
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fingerprint: Option<Revision>,
'''
stored_new = '''pub(crate) struct StoredEntry {
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) identity: Option<FileIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fingerprint: Option<Revision>,
'''
if 'pub(crate) identity: Option<FileIdentity>' not in s:
    if s.count(stored) != 1:
        raise SystemExit('StoredEntry marker non trovato')
    s = s.replace(stored, stored_new)
old_enrich = '''        if !previous.describes(entry.size, entry.mtime) {
            continue;
        }
        if entry.fingerprint.is_none() {
            entry.fingerprint = previous.fingerprint.clone();
        }
        if entry.metadata.is_none() {
            entry.metadata = previous.metadata.clone();
        }
'''
new_enrich = '''        if !previous.describes(entry.size, entry.mtime)
            || entry.fingerprint.is_none()
            || entry.fingerprint != previous.fingerprint
        {
            continue;
        }
        if entry.identity.is_none() {
            entry.identity = previous.identity;
        }
        if entry.metadata.is_none() {
            entry.metadata = previous.metadata.clone();
        }
'''
if s.count(old_enrich) != 1:
    raise SystemExit('enrich legacy non trovato')
s = s.replace(old_enrich, new_enrich)
p.write_text(s)

# --- Workspace: verifica digest, persiste identity, rejoin su coppia ---------
p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
old_scan = '''                let known = self
                    .entry_store
                    .known(&file.id)
                    .filter(|known| known.describes(file.size, file.mtime));
                let entry = VaultEntry {
                    fingerprint: known.as_ref().and_then(|known| known.fingerprint.clone()),
'''
new_scan = '''                let known = self
                    .entry_store
                    .known(&file.id)
                    .filter(|known| known.describes(file.size, file.mtime))
                    .filter(|known| {
                        let Some(fingerprint) = known.fingerprint.as_ref() else {
                            return false;
                        };
                        self.docs
                            .vault
                            .read_bytes(&file.id)
                            .is_ok_and(|bytes| fingerprint.matches_bytes(&bytes))
                    });
                let entry = VaultEntry {
                    fingerprint: known.as_ref().and_then(|known| known.fingerprint.clone()),
'''
if s.count(old_scan) != 1:
    raise SystemExit('scan_vault known marker non trovato')
s = s.replace(old_scan, new_scan)

old_store = '''                    StoredEntry {
                        size: entry.size,
                        mtime: entry.mtime,
                        fingerprint: entry.fingerprint.clone(),
                        metadata: self.indexes.core.stored_metadata(&entry.id),
                    },
'''
new_store = '''                    StoredEntry {
                        size: entry.size,
                        mtime: entry.mtime,
                        identity: self.docs.vault.file_identity(&entry.id),
                        fingerprint: entry.fingerprint.clone(),
                        metadata: self.indexes.core.stored_metadata(&entry.id),
                    },
'''
if s.count(old_store) != 1:
    raise SystemExit('store_entries StoredEntry marker non trovato')
s = s.replace(old_store, new_store)

# Durante la finestra fra scan e watcher, size+mtime non bastano neppure qui.
old_catch = '''            let unchanged = self
                .indexes
                .core
                .entries
                .get(&file.id)
                .is_some_and(|and| and.size == file.size && and.mtime == file.mtime);
'''
new_catch = '''            let unchanged = self
                .indexes
                .core
                .entries
                .get(&file.id)
                .filter(|entry| entry.size == file.size && entry.mtime == file.mtime)
                .and_then(|entry| entry.fingerprint.as_ref())
                .is_some_and(|fingerprint| {
                    self.docs
                        .vault
                        .read_bytes(&file.id)
                        .is_ok_and(|bytes| fingerprint.matches_bytes(&bytes))
                });
'''
if s.count(old_catch) != 1:
    raise SystemExit('plan_catch_up unchanged marker non trovato')
s = s.replace(old_catch, new_catch)

# Anche l'entry watcher non conserva un digest basandosi sui soli metadati.
old_sync = '''                    (Some(and), Some((size, mtime))) if and.size == size && and.mtime == mtime => {
                        and.fingerprint.clone()
                    }
'''
new_sync = '''                    (Some(and), Some((size, mtime))) if and.size == size && and.mtime == mtime => {
                        and.fingerprint.as_ref().and_then(|fingerprint| {
                            ws.docs
                                .vault
                                .read_bytes(id)
                                .ok()
                                .filter(|bytes| fingerprint.matches_bytes(bytes))
                                .map(|_| fingerprint.clone())
                        })
                    }
'''
if s.count(old_sync) != 1:
    raise SystemExit('sync_entry_here fingerprint marker non trovato')
s = s.replace(old_sync, new_sync)

# Rejoin: chiave composta, mai solo digest.
old_old_map = '''        let mut disappeared_by_fp: BTreeMap<Revision, Vec<DocId>> = BTreeMap::new();
        for (id, stored) in old {
            if current.contains(&id) || stored.size == 0 || self.is_in_trash(&id) {
                continue;
            }
            if let Some(fp) = stored.fingerprint {
                disappeared_by_fp.entry(fp).or_default().push(id);
            }
        }
'''
new_old_map = '''        let mut disappeared_by_identity: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
            BTreeMap::new();
        for (id, stored) in old {
            if current.contains(&id) || stored.size == 0 || self.is_in_trash(&id) {
                continue;
            }
            if let (Some(identity), Some(fp)) = (stored.identity, stored.fingerprint) {
                disappeared_by_identity
                    .entry((identity, fp))
                    .or_default()
                    .push(id);
            }
        }
'''
if s.count(old_old_map) != 1:
    raise SystemExit('rejoin old map marker non trovato')
s = s.replace(old_old_map, new_old_map)
old_new_map = '''        let mut appeared_by_fp: BTreeMap<Revision, Vec<DocId>> = BTreeMap::new();
        for entry in self.indexes.core.entries.values() {
            if self.entry_store.known(&entry.id).is_some() || entry.size == 0 {
                continue;
            }
            if let Some(fp) = &entry.fingerprint {
                appeared_by_fp
                    .entry(fp.clone())
                    .or_default()
                    .push(entry.id.clone());
            }
        }
'''
new_new_map = '''        let mut appeared_by_identity: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =
            BTreeMap::new();
        for entry in self.indexes.core.entries.values() {
            if self.entry_store.known(&entry.id).is_some() || entry.size == 0 {
                continue;
            }
            if let (Some(identity), Some(fp)) =
                (self.docs.vault.file_identity(&entry.id), &entry.fingerprint)
            {
                appeared_by_identity
                    .entry((identity, fp.clone()))
                    .or_default()
                    .push(entry.id.clone());
            }
        }
'''
if s.count(old_new_map) != 1:
    raise SystemExit('rejoin new map marker non trovato')
s = s.replace(old_new_map, new_new_map)
old_loop = '''        for (fp, old_ids) in disappeared_by_fp {
            let Some(new_ids) = appeared_by_fp.get(&fp) else {
                continue;
            };
'''
new_loop = '''        for (identity_and_digest, old_ids) in disappeared_by_identity {
            let Some(new_ids) = appeared_by_identity.get(&identity_and_digest) else {
                continue;
            };
'''
if s.count(old_loop) != 1:
    raise SystemExit('rejoin loop marker non trovato')
s = s.replace(old_loop, new_loop)
p.write_text(s)

# --- test: metadati uguali ma byte diversi devono invalidare la cache --------
p = Path('crates/fub-kernel/tests/entry_store.rs')
s = p.read_text()
test = r'''
#[test]
fn same_size_and_mtime_do_not_hide_changed_bytes() {
    let f = Fixture::new();
    f.write("nota.txt", "AAAA");
    beyond_the_millisecondo();
    drop(f.open(false));
    let parsed_before = f.parses();

    let path = f.root.join("nota.txt");
    let modified = std::fs::metadata(&path)
        .unwrap()
        .modified()
        .unwrap();
    std::fs::write(&path, "BBBB").unwrap();
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();

    let ws = f.open(false);
    assert_eq!(
        f.parses() - parsed_before,
        1,
        "stessa size e stesso mtime non autorizzano il riuso: il digest dei byte è cambiato"
    );
    assert_eq!(ws.read_source(&DocId::new("nota.txt")).unwrap(), "BBBB");
}
'''
if 'same_size_and_mtime_do_not_hide_changed_bytes' not in s:
    s += test
p.write_text(s)

# --- test: copia+cancellazione non è rename ---------------------------------
p = Path('crates/fub-kernel/tests/rejoin.rs')
s = p.read_text()
test = r'''
#[test]
fn copy_then_delete_with_the_same_bytes_is_not_a_rename() {
    let f = Fixture::new();
    f.write("a.txt", "gli stessi byte");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza");
    ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    drop(ws);

    let bytes = std::fs::read(f.root.join("a.txt")).unwrap();
    std::fs::write(f.root.join("b.txt"), bytes).unwrap();
    std::fs::remove_file(f.root.join("a.txt")).unwrap();

    let ws = f.open();
    assert!(
        draft_of(&ws, "b.txt").is_none(),
        "una copia con gli stessi byte ha un'identità filesystem diversa: non eredita la bozza"
    );
    assert!(
        ws.organization().icons.get("b.txt").is_none(),
        "e non eredita lo stato per-documento della sorgente"
    );
}
'''
if 'copy_then_delete_with_the_same_bytes_is_not_a_rename' not in s:
    s += test
p.write_text(s)
