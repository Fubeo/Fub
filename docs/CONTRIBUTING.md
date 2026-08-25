# Contribuire a Fub

Questa guida contiene soltanto ciò che serve per modificare il repository senza violarne i confini o scoprire in CI un controllo non documentato.

## Prima di scrivere

| Obiettivo | Documento |
|---|---|
| capire cosa è implementato | [`STATO.md`](STATO.md) |
| orientarsi nel sistema | [`architecture/`](architecture/README.md) |
| trovare il crate corretto | [`riferimento/componenti.md`](riferimento/componenti.md) |
| cambiare ABI, tipi o WIT | [`06-contratto/`](06-contratto/README.md) |
| modificare la shell | [`frontend/`](frontend/README.md) |
| aggiungere un provider | [`guida/creare-un-plugin.md`](guida/creare-un-plugin.md) |
| capire una scelta passata | [`decisions/`](decisions/README.md) |
| vedere il lavoro aperto | [`todo.md`](todo.md) |

Leggi `AGENTS.md` nella radice prima di modificare codice.

## Invarianti

- `fub-abi` e `fub-kernel` restano indipendenti da UI, formato Markdown e runtime WASM.
- `fub-features` usa il contratto pubblico e non dipende normalmente dal kernel.
- `fub-host` assembla il sistema senza dipendere da Tauri.
- Rust e WIT descrivono la stessa superficie.
- dopo il freeze il contratto cresce soltanto per aggiunta.
- il grafo in [`03-uml/03-componenti-e-dipendenze.md`](03-uml/03-componenti-e-dipendenze.md) corrisponde ai manifest.

I test rendono queste regole eseguibili. Non aggirarli spostando una dipendenza o spegnendo una feature.

## Preparazione

```bash
npm --prefix frontend ci
```

Su Linux installa le dipendenze indicate in [`guida/installazione-e-avvio.md`](guida/installazione-e-avvio.md).

## Il ciclo locale

Esegui i comandi npm dentro `frontend/`; gli altri dalla radice.

```bash
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# frontend
npx tsc --noEmit
npm test
npm run build
npm run bench:a11y
npm run bench:verify

# shell
node .github/scripts/check-listeners.mjs
node .github/scripts/check-races.mjs
node .github/scripts/check-npm-copies.mjs

# documenti
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs

# manifest e invarianti
node .github/scripts/check-cargo-versions.mjs
node .github/scripts/check-cargo-feature-default.mjs
node .github/scripts/check-crate-type.mjs
node .github/scripts/check-dev-profile.mjs

# build minime delle feature ufficiali
cargo build -p fub-features --no-default-features
cargo build -p fub-features --no-default-features --features outline
cargo build -p fub-host --no-default-features --features outline,notify-watcher

# il documento e la CI descrivono lo stesso ciclo
node .github/scripts/check-locale-loop.mjs

# supply-chain; richiede cargo-deny
cargo deny check
```

### Le eccezioni al ciclo

I comandi seguenti sono eseguiti dalla CI ma richiedono target o ambienti aggiuntivi:

- `cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc` — compila da Linux il ramo Windows del kernel.
- `cargo build --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-unknown-unknown` — attraversa il contratto con il target WASM core.
- `cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2` — costruisce il componente usato dai test del runtime.

`check-locale-loop.mjs` confronta questo blocco con `.github/workflows/ci.yml`: un comando aggiunto soltanto da una parte rende la CI rossa.

## Documentazione

- aggiorna la pagina canonica, non crearne una copia;
- usa nomi minuscoli e descrittivi;
- marca chiaramente specifiche, piani e storico;
- collega le affermazioni instabili al codice responsabile;
- esegui i tre controlli dei documenti prima del commit.

## Commit e pull request

Formato consigliato: `tipo(scope): frase`.

Tipi comuni: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`. Lo scope usa il crate senza prefisso `fub-`, oppure `wit`, `frontend`, `docs` o `ci`.

Ogni commit deve lasciare il repository coerente. Una decisione architetturale non ovvia richiede un verbale in [`decisions/`](decisions/README.md).