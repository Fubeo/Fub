# Fub

Un'app di note in markdown su file locali, scritta in Rust (Tauri v2), con
un'architettura pensata fin dall'inizio per i plugin. Apre vault nel formato di
Obsidian senza conversione — ma il markdown non è il formato dell'app: è il
primo provider di un contratto che non lo nomina.

## Idea architetturale

**Core agnostico rispetto al formato** + un contratto di trait definito **una
volta sola**, di cui il markdown è solo il *primo* provider. Le feature "native"
sono implementazioni Rust di quei trait; il runtime WASM per i plugin di terzi
(Milestone 5) implementerà **gli stessi trait** via proxy — il kernel non
distingue un provider nativo da uno WASM.

```
┌──────────────┐  contratto unico: modello documento comune + tutti i trait
│  fub-abi   │  di estensione. NIENTE markdown / tauri / wasm qui dentro.
└──────┬───────┘
       │
   ┌───┴───────────────┬──────────────────────┐
   ▼                   ▼                        ▼
┌────────────┐  ┌────────────┐          ┌────────────────────┐
│fub-kernel│  │ fub-sdk  │          │ fub-format-       │
│  (core)    │  │ (helper)   │          │   markdown (comrak) │  ← 1° provider
└─────┬──────┘  └────────────┘          └────────────────────┘
      │ vault, grafo link, registry, event bus (agnostico)
      ▼
┌───────────────┐    ┌──────────────┐        ┌──────────────────────────┐
│ fub-features│    │  fub-host  │        │ fub-wasm-host (M5)      │
│ backlink/…    │    │  (chi monta) │        │ plugin di terzi via WASM  │
└───────────────┘    └──────┬───────┘        └──────────────────────────┘
                            │
       fub-testkit ┈┈┈┈┈┈┈┤  il banco di prova del lato host: dipende dal
       (solo dev)           │  kernel, e per questo non è MAI dipendenza
                            │  normale di nessuno
                            │
                     ┌──────┴───────┐
                     │  fub-app   │  colla Tauri: comandi, finestre
                     │  (Tauri v2)  │
                     └──────┬───────┘
                            │ IPC (comandi/eventi)
                            ▼
                    frontend/ (Vite + TS + CodeMirror 6)
```

**Invarianti chiave (verificate in CI/test):** `fub-kernel` e `fub-abi` non
dipendono da `comrak`, `tauri` o `wasmtime`; `fub-host` non dipende da
`tauri`, perché chi monta deve poter essere preso da una CLI, da un'API locale o
da un e2e headless senza portarsi dietro un webview.

## Documentazione

Tutta in **[`docs/`](docs/)**, e si entra da
**[docs/README.md](docs/README.md)**. Le due scorciatoie usate più spesso: la
[mappa visuale dell'architettura](docs/architecture/mappa-visuale.md) e i
[verbali delle decisioni](docs/decisions/README.md).

## Cosa c'è già

Milestone 1 è chiusa dal 24/07/2026 e M2 è quasi finita:

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
cargo tauri dev --config crates/fub-app/tauri.conf.json

# 3. build release (binario self-contained, frontend incluso)
cargo build --release -p fub-app   # → target/release/fub

# comodità: aprire un vault all'avvio senza dialog
FUB_VAULT="$PWD/tests/fixtures/sample-vault" target/release/fub
```

Test e lint:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets
```

## Roadmap

- **M2** — ricerca full-text (tantivy), graph view, outline, tag panel, "crea
  nota" per i link non risolti. La ricerca è **built-in e di classe
  *omnisearch*** ([decisione 0025](docs/decisions/0025-la-ricerca-predefinita.md)).
  Ciò che le manca — refusi perdonati, prefisso mentre si digita, ricerca dentro
  la nota aperta — sta nella
  [seduta 21](docs/roadmap/21-la-ricerca-predefinita.md), con tre voci di
  **firma** che scadono col freeze di M4.
- **M3** — live preview *in-editor* alla Obsidian (decorazioni CodeMirror sugli
  `Span` del modello), command palette, settings via form dichiarativi.
- **M4** — congelamento della superficie dei trait + contratto WIT (`wit/`),
  primo "plugin" nativo che passa per il path `Plugin`/`HostApi`.
- **M5** — runtime WASM (wasmtime, component model): plugin di terzi in
  `wasm32-wasip2` che implementano gli stessi trait via proxy.
- **Futuro** — autocompletamento AI come plugin core con backend locale + cloud
  intercambiabili.

## Licenza

Doppia, a scelta di chi usa: **MIT** ([LICENSE-MIT](LICENSE-MIT)) **oppure**
**Apache-2.0** ([LICENSE-APACHE](LICENSE-APACHE)). È la convenzione
dell'ecosistema Rust, ed è dichiarata anche in `Cargo.toml`
(`license = "MIT OR Apache-2.0"`), che è ciò che
[`deny.toml`](deny.toml) usa come metro per le licenze delle dipendenze.

Un contributo aperto come pull request si intende rilasciato con la stessa
doppia licenza, senza condizioni aggiuntive.

## Contribuire, segnalare, versioni

- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — le invarianti che non si
  negoziano, il ciclo locale, la forma dei commit.
- [docs/SECURITY.md](docs/SECURITY.md) — come si segnala una vulnerabilità (in
  privato, non con una issue) e cos'è dentro il perimetro.
- [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [docs/versionamento.md](docs/versionamento.md) — i tre numeri di versione e
  cosa promette ciascuno.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — cosa cambia, versione per versione.

## Marchi

Obsidian è un marchio del suo titolare. **Fub non è affiliato a Obsidian, non
ne è approvato, e non è un clone né un rimpiazzo**: è un programma diverso, con
un'architettura diversa, che legge e scrive lo stesso formato su disco. Dove il
nome compare — nel codice, nei test, nei documenti — è per dire con quale
programma Fub va d'accordo e quale regola sta rispettando. Nient'altro.
