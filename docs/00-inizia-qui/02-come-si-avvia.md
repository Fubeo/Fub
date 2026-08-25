# Come si avvia Fub

## Prerequisiti

- Rust 1.89 con Cargo;
- Node.js 22 con npm;
- Tauri CLI;
- dipendenze di sistema richieste da Tauri v2 per il sistema operativo usato.

La CI usa queste versioni come riferimento. Non sostituire npm con altri package
manager: il repository include `frontend/package-lock.json` e usa `npm ci`.

## Preparazione

Dalla radice del repository:

```bash
cd frontend
npm ci
cd ..
```

`npm ci` installa esattamente le versioni del lockfile e fallisce quando
`package.json` e lockfile non sono coerenti.

## Avvio dell'app desktop

```bash
cargo tauri dev
```

Il comando avvia il server Vite e la finestra Tauri con ricaricamento durante lo
sviluppo.

Per lavorare soltanto sul frontend:

```bash
cd frontend
npm run dev
```

## Build

```bash
cargo build -p fub-app

cd frontend
npm run build
```

Per una build Rust ottimizzata:

```bash
cargo build --release -p fub-app
```

## Controlli rapidi

Dalla radice:

```bash
cargo fmt --all --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Dal frontend:

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

## Controlli della documentazione

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```

Il ciclo completo e autorevole, inclusi i controlli architetturali, è in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Problemi comuni

### `cargo tauri` non esiste

La Tauri CLI non è installata o non è disponibile nel `PATH`.

### La finestra non parte su Linux

Manca una dipendenza di sistema della webview richiesta da Tauri v2. Installare
il pacchetto previsto dalla propria distribuzione e ripetere il comando.

### Il frontend compila ma TypeScript ha errori

Vite non sostituisce il typecheck. Eseguire sempre `npm run typecheck`.

### `npm ci` fallisce per il lockfile

Non correggere installando dipendenze “a mano”. Rendere coerenti
`frontend/package.json` e `frontend/package-lock.json`, poi rieseguire `npm ci`.
