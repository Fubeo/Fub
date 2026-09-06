"""Temporary verification entry point, removed before the final PR."""
from pathlib import Path

path = Path('.github/scripts/m5-current.py')
source = path.read_text()
old = r'"fub-kernel.workspace = true", "fub-kernel.workspace = true\nfub-wasm-host.workspace = true"'
new = r'"fub-kernel = { workspace = true }", "fub-kernel = { workspace = true }\nfub-wasm-host = { workspace = true }"'
assert source.count(old) == 1
source = source.replace(old, new, 1)
source = source.replace('if text.count(old) != 1:', 'if text.count(old) != (2 if old == ".any(|s| name.starts_with(s))" else 1):', 1)
source = source.replace('p.write_text(text.replace(old, new, 1))', 'p.write_text(text.replace(old, new))', 1)
exec(compile(source, str(path), 'exec'))

p = Path('crates/fub-wasm-host/tests/views_cross_the_boundary.rs')
text = p.read_text()
old = 'impl fub_abi::traits::ViewProvider for NativeView {'
new = '''impl fub_abi::traits::ViewProvider for NativeView {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        use fub_abi::event::{EventKind, EventMask};
        fub_abi::traits::ViewInterests {
            refresh: EventMask {
                kinds: vec![EventKind::DocumentChanged, EventKind::DocumentRemoved, EventKind::DocumentRenamed],
                ..Default::default()
            },
            follows: Default::default(),
        }
    }
'''
assert text.count(old) == 1
p.write_text(text.replace(old, new, 1))
