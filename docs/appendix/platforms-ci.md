# Appendice — Piattaforme e CI

Torna a [../PIANO.md](../PIANO.md).

## Matrice di supporto

| OS | Ruolo | Verifica |
|---|---|---|
| Linux (Arch) | **Primario** — sviluppo quotidiano di Fabio | build + test + uso manuale |
| Windows | Supportato | build + test in CI |
| macOS | Supportato | build + test in CI |

Tauri v2 supporta i tre OS; l'obiettivo è **evitare che una regressione cross-OS
resti nascosta** finché il progetto è ancora piccolo (perciò CI multi-OS **da
subito**, non un hardening tardivo).

## CI (GitHub Actions, build + test su 3 OS)

Workflow con matrice `os: [ubuntu-latest, windows-latest, macos-latest]`, per ogni
push/PR:

1. Toolchain Rust pinnata (`rust-version = "1.88"` dal workspace) + cache.
2. `cargo build --workspace`.
3. `cargo test --workspace` (unit + e2e, incluso `vault_e2e`).
4. `cargo clippy --workspace -- -D warnings`.
5. `cargo fmt --check`.
6. Frontend: install + `vite build` (type-check TS) su almeno un OS.

Dipendenze di sistema per Tauri (WebKitGTK/librerie su Linux, ecc.) installate nel
job Linux; Windows/macOS usano i toolchain nativi.

### Estensioni per milestone

- **[M2](../milestones/M2-search-graph.md):** i test di proprietà (incrementale vs
  rebuild) girano nella matrice; attenzione ai path dell'indice tantivy
  (`.fubmd-data/`) su Windows (separatori, lock file).
- **[M5](../milestones/M5-wasm-runtime.md):** job aggiuntivo che compila il plugin di
  esempio con `cargo component` (target `wasm32-wasip2`) e lo carica in un test
  d'integrazione dell'host.

## Invarianti verificati in CI

- **Dipendenze del core:** un check (`cargo tree`/deny) che `fubmd-abi` e
  `fubmd-kernel` non tirino dentro `comrak`, `tauri`, `wasmtime` — l'invariante non
  negoziabile del [PIANO](../PIANO.md).
- **Conformità abi↔WIT** (da [M2](../milestones/M2-search-graph.md), obbligatoria da
  [M4](../milestones/M4-wit-hardening.md)): il test rompe se `fubmd-abi` e `wit/`
  divergono.

## Rischi / note

- **Costo/tempi CI** su 3 OS → cache aggressiva di cargo e degli artifact; i job
  pesanti (WASM) solo dove servono.
- **Differenze di path/filesystem** (Windows) → usare `camino`/`Utf8Path` (già in
  uso) e coprire i casi con i test e2e nella matrice.
- **Packaging/release** (bundle Tauri per OS) → fuori scope M2–M5; da definire quando
  si punta a una distribuzione.
