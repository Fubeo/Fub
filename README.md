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
│ fubmd-features│    │  fubmd-host  │        │ fubmd-wasm-host (M5)      │
│ backlink/…    │    │  (chi monta) │        │ plugin di terzi via WASM  │
└───────────────┘    └──────┬───────┘        └──────────────────────────┘
                            │
                     ┌──────┴───────┐
                     │  fubmd-app   │  colla Tauri: comandi, finestre
                     │  (Tauri v2)  │
                     └──────┬───────┘
                            │ IPC (comandi/eventi)
                            ▼
                    frontend/ (Vite + TS + CodeMirror 6)
```

**Invarianti chiave (verificate in CI/test):** `fubmd-kernel` e `fubmd-abi` non
dipendono da `comrak`, `tauri` o `wasmtime` — il core non sa cosa sia il
markdown; e `fubmd-host` non dipende da `tauri`, perché chi monta deve poter
essere preso da una CLI, da un'API locale o da un e2e headless senza portarsi
dietro un webview.

## Documentazione

Tutta in **[`docs/`](docs/)**, e si entra da
**[docs/README.md](docs/README.md)**: da lì partono i quattro percorsi — capire
il progetto, scrivere codice, sapere perché una cosa è così, sapere cosa manca.

Le due scorciatoie usate più spesso: la
[mappa visuale dell'architettura](docs/architecture/mappa-visuale.md) per il
colpo d'occhio, e i [verbali delle decisioni](docs/decisions/README.md) per il
perché.

## Cosa c'è già

Milestone 1 è chiusa dal 24/07/2026 e M2 è quasi finita. In concreto, oggi
l'app fa questo:

- Vault compatibile Obsidian (`.md` + frontmatter YAML, `[[wikilink]]`, `#tag`,
  callout, embed `![[...]]`).
- Provider markdown nativo (comrak): parse → modello comune, render HTML per
  l'anteprima, serializzazione best-effort.
- Kernel: scansione vault, grafo dei link con risoluzione stile Obsidian
  (nome / alias / path, shortest-path fra omonimi), backlink, event bus,
  file watcher debounced.
- Ricerca full-text incrementale su tantivy, CRUD con cestino e versioning,
  organizzazione del vault, otto feature ufficiali montate come provider.
- Frontend: file explorer, editor CodeMirror 6, anteprima live, navigazione
  `[[wikilink]]`, graph view, e i pannelli resi via il protocollo di **UI
  dichiarativa**.

Lo stato preciso — cosa è aperto, con che priorità — sta in
[docs/todo.md](docs/todo.md), che è l'unico posto dove si aggiorna.

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
  per i link non risolti. La ricerca è **built-in e di classe *omnisearch***
  ([decisione 0025](docs/decisions/0025-la-ricerca-predefinita.md)): non un
  plugin da installare ma *la* ricerca dell'app. Ciò che le manca ancora — refusi
  perdonati, prefisso mentre si digita, ricerca dentro la nota aperta — sta nella
  [seduta 21](docs/roadmap/21-la-ricerca-predefinita.md), e tre di quelle voci
  sono **firma**: scadono col freeze di M4.
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
