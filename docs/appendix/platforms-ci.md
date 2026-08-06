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

1. Toolchain Rust pinnata (`rust-version = "1.89"` dal workspace) + cache.
2. `cargo build --workspace`.
3. `cargo test --workspace` (unit + e2e, incluso `vault_e2e`).
4. `cargo clippy --workspace -- -D warnings`.
5. `cargo fmt --check`.
6. Frontend: install + `vite build` (type-check TS) su almeno un OS.
7. `cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc`,
   **dal job Linux** — vedi qui sotto.

Dipendenze di sistema per Tauri (WebKitGTK/librerie su Linux, ecc.) installate nel
job Linux; Windows/macOS usano i toolchain nativi.

### Cosa una matrice a tre OS **non** verifica

La riga «build + test in CI» accanto a Windows è vera e per anni ha detto meno di
quanto sembrasse. Un test sotto `#[cfg(unix)]` su Windows non fallisce: **non
viene compilato**, e una suite che si svuota in silenzio è indistinguibile da una
suite verde. È il difetto che la
[0109](../decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md) ha
misurato sui presidi della durabilità (§15.2), dove i quattro che interrogavano
il caso erano tutti gated e il job Windows passava **proprio per quello**.

Da lì due abitudini, e valgono per qualunque codice che cambi con la piattaforma:

- il ramo che dipende dall'OS si **passa** invece di essere nominato, così la
  regola che ci sta sopra si prova ovunque, e ciò che resta gated è solo la parte
  che la piattaforma deve davvero fornire;
- quanti test di un file restano fuori da `#[cfg(unix)]` è un **numero**, e si
  scrive accanto a come lo si ricava (`conteggi.mjs`, conto
  `durabilita-su-ogni-piattaforma`). Nessun `cargo test` può accorgersi di un
  presidio che non è stato compilato; un conto che legge il sorgente da fuori sì.

E il passo 7: `clippy` e `fmt` girano sul job Linux, il job `windows-latest`
compila ma non ha né l'uno né l'altro, quindi il codice `#[cfg(windows)]` del
kernel — il conteggio dei nomi di un file — resterebbe l'unico pezzo del repo che
nessuno legge finché non rompe. Sei secondi da Linux lo portano sotto il
compilatore: **una FFI che non compila è una FFI che non è stata scritta.**

### Estensioni per milestone

- **[M2](../milestones/M2-search-graph.md):** i test di proprietà (incrementale vs
  rebuild) girano nella matrice; attenzione ai path dell'indice tantivy
  (`.fub/data/`) su Windows (separatori, lock file).
- **[M5](../milestones/M5-wasm-runtime.md):** job aggiuntivo che compila il plugin di
  esempio con `cargo component` (target `wasm32-wasip2`) e lo carica in un test
  d'integrazione dell'host.

## Invarianti verificati in CI

- **Dipendenze del core:** un check (`cargo tree`/deny) che `fub-abi` e
  `fub-kernel` non tirino dentro `comrak`, `tauri`, `wasmtime` — l'invariante non
  negoziabile del [PIANO](../PIANO.md).
- **Conformità abi↔WIT** (da [M2](../milestones/M2-search-graph.md), obbligatoria da
  [M4](../milestones/M4-wit-hardening.md)): il test rompe se `fub-abi` e `wit/`
  divergono.

## Rischi / note

- **Costo/tempi CI** su 3 OS → cache aggressiva di cargo e degli artifact; i job
  pesanti (WASM) solo dove servono.
- **Differenze di path/filesystem** (Windows) → usare `camino`/`Utf8Path` (già in
  uso) e coprire i casi con i test e2e nella matrice.
- **Packaging/release** (bundle Tauri per OS) → fuori scope M2–M5; da definire quando
  si punta a una distribuzione.
