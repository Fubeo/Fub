from pathlib import Path

p = Path('crates/fub-kernel/src/entries.rs')
s = p.read_text()
old = '''        StoredEntry {
            size,
            mtime,
            fingerprint: None,
            metadata: None,
        }
'''
new = '''        StoredEntry {
            size,
            mtime,
            identity: None,
            fingerprint: None,
            metadata: None,
        }
'''
if s.count(old) != 1:
    raise SystemExit(f'atteso un solo initializer di test StoredEntry, trovati {s.count(old)}')
p.write_text(s.replace(old, new))
