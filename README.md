# FubMD

Un'app di note in markdown in stile Obsidian, scritta in Rust (Tauri v2), con
un'architettura pensata fin dall'inizio per i plugin.

## Idea architetturale

L'asse portante è: **core agnostico rispetto al formato** + un contratto di
trait definito **una volta sola**, di cui il markdown è solo il *primo*
provider. Le feature "native" sono implementazioni Rust di quei trait; il
runtime WASM per i plugin di terzi è un layer separato che arriverà più avanti
(Milestone 5) e implementerà **gli stessi trait** via proxy — il kernel non
distingue un provider nativo da uno WASM.

```
┌──────────────┐  contratto unico: modello documento comune + tutti i trait
│  fubmd-abi   │  di estensione. NIENTE markdown / tauri / wasm qui dentro.
└──────┬───────┘
       │
   ┌───┴───────────────┬──────────────────────┐
   ▼                   ▼                        ▼
┌────────────┐  ┌────────────┐          ┌────────────────────┐
│fubmd-kernel│  │ fubmd-sdk  │          │ fubmd-format-       │
│  (core)    │  │ (helper)   │          │   markdown (comrak) │  ← 1° provider
└─────┬──────┘  └────────────┘          └────────────────────┘
      │ vault, grafo link, registry, event bus (agnostico)
      ▼
┌───────────────┐    ┌──────────────┐        ┌──────────────────────────┐
│ fubmd-features│    │  fubmd-app   │        │ fubmd-wasm-host (M5)      │
│ backlink/…    │    │  (Tauri v2)  │        │ plugin di terzi via WASM  │
└───────────────┘    └──────┬───────┘        └──────────────────────────┘
                            │ IPC (comandi/eventi)
                            ▼
                    frontend/ (Vite + TS + CodeMirror 6)
```

**Invariante chiave (verificata in CI/test):** `fubmd-kernel` e `fubmd-abi` non
dipendono da `comrak`, `tauri` o `wasmtime`. Il core non sa cosa sia il markdown.

## Stato: Milestone 1 — app usabile ✅

- Vault compatibile Obsidian (`.md` + frontmatter YAML, `[[wikilink]]`, `#tag`,
  callout, embed `![[...]]`).
- Provider markdown nativo (comrak): parse → modello comune, render HTML per
  l'anteprima, serializzazione best-effort.
- Kernel: scansione vault, grafo dei link con risoluzione stile Obsidian
  (nome / alias / path, shortest-path fra omonimi), backlink, event bus,
  file watcher debounced.
- Frontend: file explorer, editor CodeMirror 6, anteprima live, navigazione
  `[[wikilink]]`, pannello backlink reso via il protocollo di **UI dichiarativa**.
- 33 test (unit + un end-to-end sul vault di esempio).

## Come si avvia

Prerequisiti: Rust ≥ 1.88, Node ≥ 20, e le dipendenze Tauri v2 per Linux
(`webkit2gtk-4.1`).

```bash
# 1. dipendenze frontend
cd frontend && npm install && cd ..

# 2. sviluppo (avvia Vite + finestra Tauri con hot-reload)
cargo tauri dev --config crates/fubmd-app/tauri.conf.json

# 3. build release (binario self-contained, frontend incluso)
cargo build --release -p fubmd-app   # → target/release/fubmd

# comodità: aprire un vault all'avvio senza dialog
FUBMD_VAULT="$PWD/tests/fixtures/sample-vault" target/release/fubmd
```

Test e lint:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets
```

## Roadmap

- **M2** — ricerca full-text (tantivy), graph view, outline, tag panel, "crea nota"
  per i link non risolti.
- **M3** — live preview *in-editor* alla Obsidian (decorazioni CodeMirror sugli
  `Span` del modello), command palette, settings via form dichiarativi.
- **M4** — congelamento della superficie dei trait + contratto WIT (`wit/`),
  primo "plugin" nativo che passa per il path `Plugin`/`HostApi`.
- **M5** — runtime WASM (wasmtime, component model): plugin di terzi in
  `wasm32-wasip2` che implementano gli stessi trait via proxy.
- **Futuro** — autocompletamento AI come plugin core con backend locale + cloud
  intercambiabili.

## Licenza

MIT OR Apache-2.0
