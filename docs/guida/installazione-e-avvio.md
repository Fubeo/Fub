# Installazione e avvio

## Requisiti

La configurazione verificata dalla CI usa:

- Rust 1.89;
- Node.js 22 con npm;
- Tauri CLI 2, cioè il comando `cargo tauri`;
- i tool di compilazione della piattaforma.

Su Ubuntu e derivate servono anche:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libgtk-3-dev
```

Su Windows servono i Microsoft C++ Build Tools e WebView2. Su macOS servono Xcode Command Line Tools.

Se `cargo tauri` non è disponibile, installa la CLI della serie 2:

```bash
cargo install tauri-cli --version '^2' --locked
```

## Preparare il repository

Dalla radice del progetto:

```bash
npm --prefix frontend ci
```

Si usa `npm ci`, non `npm install`: in questo modo le dipendenze corrispondono esattamente a `frontend/package-lock.json`.

## Avviare Fub in sviluppo

```bash
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Tauri esegue automaticamente il server Vite dichiarato in `tauri.conf.json` e apre la finestra desktop.

Per aprire direttamente una cartella:

```bash
FUB_VAULT="/percorso/assoluto/del/vault" \
  cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Su PowerShell:

```powershell
$env:FUB_VAULT = "C:\percorso\del\vault"
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

## Creare un bundle desktop

```bash
cargo tauri build --config crates/fub-app/tauri.conf.json
```

Questo comando costruisce il frontend e genera gli artefatti previsti da Tauri per il sistema operativo corrente. Un semplice `cargo build --release -p fub-app` compila il binario Rust, ma non sostituisce il processo di packaging.

Non trattare gli artefatti locali come un rilascio ufficiale: al momento la repository non pubblica release.

## Verifica minima

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Il ciclo completo usato dal progetto è in [`CONTRIBUTING.md`](../CONTRIBUTING.md).