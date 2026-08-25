# Fub

Fub è un workspace di scrittura **local-first**: apre una cartella di file
Markdown, mantiene i dati sul disco dell'utente e aggiunge ricerca, collegamenti,
grafo, editor e funzionalità estendibili tramite plugin.

Il progetto usa un workspace Rust, una shell desktop Tauri v2 e un frontend
Vite/TypeScript con CodeMirror 6. Il kernel non dipende da Markdown, Tauri o
Wasmtime: formati e funzionalità entrano attraverso i contratti di `fub-abi`.

## Stato del progetto

| Area | Stato | Nota |
|---|---|---|
| Vault locale e provider Markdown | **Implementato** | Lettura, scrittura e indicizzazione dei file del vault. |
| Ricerca, backlink, tag, outline e grafo | **Implementato** | Funzionalità ufficiali montate come provider. |
| Editor e shell desktop | **Implementato** | CodeMirror 6, anteprima, navigazione e pannelli dichiarativi. |
| Contratto Rust/WIT | **Implementato** | `fub:abi@0.1.1` è la base comune per provider nativi e WASM. |
| Runtime per plugin WASM | **Parziale** | Il runtime e i primi adattatori esistono; la parità fra tutte le famiglie di provider è ancora in lavorazione. |

Lo stato operativo completo è in [`docs/PIANO.md`](docs/PIANO.md); il lavoro
ancora aperto è in [`docs/todo.md`](docs/todo.md).

## Architettura in breve

```text
frontend/src
  -> crates/fub-app       adattatori IPC e finestra Tauri
  -> crates/fub-host      composizione, sessioni, bundle, job e watcher
  -> crates/fub-kernel    workspace, policy, indici ed eventi
  -> dyn fub-abi          provider nativi o proxy WASM
  -> disco e indici
```

Crate principali:

| Crate | Responsabilità |
|---|---|
| `fub-abi` | Tipi condivisi, trait, errori, WIT e rappresentazioni IPC. |
| `fub-kernel` | Core indipendente da formato, UI e runtime dei plugin. |
| `fub-sdk` | Strumenti per autori di provider e test double in memoria. |
| `fub-testkit` | Banco di integrazione host/kernel, solo per sviluppo. |
| `fub-format-markdown` | Primo `FormatProvider`; è il crate che conosce Markdown. |
| `fub-features` | Funzionalità ufficiali montabili come plugin nativi. |
| `fub-host` | Sessioni del vault, bundle, impostazioni, job e watcher. |
| `fub-wasm-host` | Runtime Wasmtime e adattatori dal component model ai trait Rust. |
| `fub-app` | Binario Tauri e adattatori IPC. |

Le dipendenze devono continuare a puntare verso il contratto, mai verso una
implementazione concreta. La guida dettagliata è in
[`docs/02-componenti/01-panoramica.md`](docs/02-componenti/01-panoramica.md).

## Avvio locale

Prerequisiti:

- Rust 1.89;
- Node.js 22 e npm;
- Tauri CLI e dipendenze di sistema richieste da Tauri v2.

```bash
# frontend riproducibile dal lockfile
cd frontend
npm ci
cd ..

# applicazione desktop in sviluppo
cargo tauri dev
```

Controlli essenziali:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

cd frontend
npm run typecheck
npm test
npm run build
```

Il ciclo completo, inclusi i controlli architetturali e documentali, è descritto
in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## Documentazione

L'ingresso unico è [`docs/README.md`](docs/README.md).

- [`docs/00-inizia-qui/`](docs/00-inizia-qui/01-cos-e-fub.md): panoramica, avvio e struttura del repository.
- [`docs/01-concetti/`](docs/01-concetti/01-il-vault.md): concetti fondamentali.
- [`docs/02-componenti/`](docs/02-componenti/01-panoramica.md): responsabilità dei componenti.
- [`docs/04-plugin/`](docs/04-plugin/01-nativo-vs-wasm.md): modello di estensione.
- [`docs/06-contratto/`](docs/06-contratto/01-i-trait-in-rust.md): contratto Rust e WIT.
- [`docs/07-ui/`](docs/07-ui/01-la-shell-e-il-frontend.md): shell, protocollo UI e temi.

## Contribuire e sicurezza

- [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/CODE_OF_CONDUCT.md`](docs/CODE_OF_CONDUCT.md)
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- [`docs/versionamento.md`](docs/versionamento.md)

## Licenza

Fub è distribuito, a scelta, con licenza
[MIT](LICENSE-MIT) oppure [Apache-2.0](LICENSE-APACHE), come dichiarato anche in
`Cargo.toml`.

## Compatibilità del formato

Fub può leggere e scrivere vault compatibili con il formato usato da Obsidian.
Obsidian è un marchio del rispettivo titolare; Fub non è affiliato, approvato o
sponsorizzato da Obsidian.
