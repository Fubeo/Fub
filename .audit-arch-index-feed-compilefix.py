from pathlib import Path

p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
s = s.replace('self.set_entry(id, size, mtime, Some(fingerprint));', 'self.set_entry(id, size, mtime, Some(fingerprint.clone()));', 1)
s = s.replace('self.touch_entry(id, Some(fingerprint));', 'self.touch_entry(id, Some(fingerprint.clone()));', 1)
p.write_text(s)

# Dopo il passaggio degli index provider a handle condivisi non resta alcun
# consumer mutabile diretto della tabella. Rimuovere il metodo morto è parte
# del refactor; non sopprimere `dead_code`, perché Clippy -D warnings è un gate.
p = Path('crates/fub-kernel/src/providers.rs')
s = p.read_text()
old = '''    pub(crate) fn iter_mut(&mut self) -> std::slice::IterMut<'_, T> {
        self.entries.iter_mut()
    }

'''
assert old in s, 'ProviderTable::iter_mut non trovato'
s = s.replace(old, '', 1)
p.write_text(s)
