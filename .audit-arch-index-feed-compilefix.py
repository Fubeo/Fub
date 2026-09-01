from pathlib import Path

p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
s = s.replace('self.set_entry(id, size, mtime, Some(fingerprint));', 'self.set_entry(id, size, mtime, Some(fingerprint.clone()));', 1)
s = s.replace('self.touch_entry(id, Some(fingerprint));', 'self.touch_entry(id, Some(fingerprint.clone()));', 1)
p.write_text(s)
