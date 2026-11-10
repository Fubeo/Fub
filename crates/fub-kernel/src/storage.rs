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
//! ed è l'ordine che la seduta 15 della vecchia roadmap aveva
//! dichiarato: il §15.1 fa il posto, il §15.2 ci mette dentro la proprietà
//! ([0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)),
//! invece di scriverla due volte — una accanto all'astrazione e una dentro.
//!
//! La promessa è di **una scrittura**, non di un aggiornamento: due processi che
//! ricompongono lo stesso file dalla propria copia in memoria atterrano ognuno
//! un file integro, e il secondo cancella le chiavi del primo. Quella è la *lost
//! update*, e chiede un'altra funzione — [`update_atomic`], che rilegge sotto
//! lock prima di comporre
//! ([0066](../../../docs/decisions/0195-versioni-indipendenti.md)).
//!
//! L'altro asse — la **classe** di un dato, «si può buttare o no» — non è di
//! qui affatto: sta nel path, e l'ha deciso la
//! [0048](../../../docs/decisions/0188-identita-path-e-rename.md). Un supporto non sa
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
use std::io::{Read as _, Write as _};
use std::sync::MutexGuard;

use crate::poison::Shelter;

use camino::{Utf8Path, Utf8PathBuf};

mod rooted;
pub use rooted::RootedFsStorage;

mod api;
mod durable;
mod fs_atomic;
mod fs_storage;
mod fs_trait;
mod mem;

pub use api::{ConditionalWrite, DirEntry, EntryKind, FileIdentity, Merge, Stat, VaultStorage};
#[cfg(test)]
use durable::exclusive_lock_entro;
pub use durable::{do_not_overwrite, update_atomic, write_atomic, Durable};
use durable::{exclusive_lock, LOCK_RETRY_INTERVAL, RETRY_LOCK};
pub(crate) use fs_atomic::{atomic_replace, rename_no_replace_path, utf8_entry_path};
#[cfg(windows)]
use fs_atomic::{exclusive_lock_required, rename_no_replace_move_file};
pub use fs_atomic::{folders_to_sync, sync_folder};
use fs_atomic::{
    not_utf8, read_bounded, read_in_pieces, same_parent_resolution_name, writable_folder,
};
#[cfg(unix)]
use fs_atomic::{rename_no_replace_at, rename_no_replace_paths};
#[cfg(unix)]
pub(crate) use fs_storage::unix_change_stamp;
#[cfg(all(unix, test))]
use fs_storage::unix_writable;
#[cfg(windows)]
pub(crate) use fs_storage::windows_change_stamp;
use fs_storage::{change_stamp_of_file, lock_path, stat_of, stat_with, tmp_path, TMP_SEQ};
pub use fs_storage::{
    file_names, how_to_write, identity_of_the_file, what_c_and, FileNames, FsStorage, Identity,
    WriteMode,
};
pub(crate) use fs_storage::{
    is_write_lock, is_write_temporary, refuse_read_only, temp_name, ReadOnlyFile, WriteBits,
    TEMP_FILE_EXPIRY_MS,
};
pub use mem::MemStorage;

#[cfg(test)]
mod tests;
