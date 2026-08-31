from pathlib import Path

p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
old = '''                let now = current.as_ref().map(|s| Revision::of(s));
                if now.as_ref() != Some(&expected) {
                    return Err(KernelError::Stale(id.to_string()));
                }
'''
new = '''                let now = current.as_ref().map(|s| Revision::of(s));
                if !current
                    .as_deref()
                    .is_some_and(|source| expected.matches(source))
                {
                    return Err(KernelError::Stale(id.to_string()));
                }
'''
if s.count(old) != 1:
    raise SystemExit(f'atteso un solo confronto legacy, trovati {s.count(old)}')
p.write_text(s.replace(old, new))
