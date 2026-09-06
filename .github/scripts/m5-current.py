"""Temporary branch-only development patch; removed before final PR."""
from pathlib import Path
import runpy

if not Path("crates/fub-wasm-host/src/view.rs").exists():
    runpy.run_path(".github/scripts/m5-driver.py")

p = Path("esempi/vault-view-wasm/src/lib.rs")
text = p.read_text()
text = text.replace("list_documents()", "list_documents(None)")
text = text.replace("let mut ids = fub::abi::host_vault_read::list_documents(None)?;", "let mut ids = fub::abi::host_vault_read::list_documents(None)?.items;")
text = text.replace("fn single(kind:", "#[cfg(feature = \"adversarial\")]\nfn single(kind:")
p.write_text(text)
