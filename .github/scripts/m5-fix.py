"""Temporary verification entry point, removed before the final PR."""
from pathlib import Path

path = Path('.github/scripts/m5-current.py')
source = path.read_text()
old = r'"fub-kernel.workspace = true", "fub-kernel.workspace = true\nfub-wasm-host.workspace = true"'
new = r'"fub-kernel = { workspace = true }", "fub-kernel = { workspace = true }\nfub-wasm-host = { workspace = true }"'
assert source.count(old) == 1
source = source.replace(old, new, 1)
exec(compile(source, str(path), 'exec'))
