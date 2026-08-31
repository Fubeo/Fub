from pathlib import Path

p = Path('crates/fub-kernel/src/vault.rs')
s = p.read_text()
old = 'use crate::storage::{EntryKind, FsStorage, Stat, VaultStorage};\n'
new = 'use crate::storage::{EntryKind, Stat, VaultStorage};\n'
if s.count(old) != 1:
    raise SystemExit(f'atteso un solo import FsStorage, trovati {s.count(old)}')
p.write_text(s.replace(old, new))
