"""Temporary verification entry point, removed before the final PR."""
from pathlib import Path

path = Path('.github/scripts/m5-current.py')
source = path.read_text()
old = r'"fub-kernel.workspace = true", "fub-kernel.workspace = true\nfub-wasm-host.workspace = true"'
new = r'"fub-kernel = { workspace = true }", "fub-kernel = { workspace = true }\nfub-wasm-host = { workspace = true }"'
assert source.count(old) == 1
source = source.replace(old, new, 1)
# Both the import validator and the fallback linker match a family. They must
# apply the same exact/versioned-name rule, rather than an arbitrary prefix.
source = source.replace('if text.count(old) != 1:', 'if text.count(old) != (2 if old == ".any(|s| name.starts_with(s))" else 1):', 1)
source = source.replace('p.write_text(text.replace(old, new, 1))', 'p.write_text(text.replace(old, new))', 1)
exec(compile(source, str(path), 'exec'))
