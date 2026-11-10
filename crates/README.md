# `crates/` — il workspace Rust

I 25 crate in gruppi; la descrizione è il campo `description` del `Cargo.toml`
di ciascuno. La mappa con aree, percorsi e prove è in
[`docs/map/repo.md`](../docs/map/repo.md); il grafo delle dipendenze (con i
marcatori letti dal test `dependency_invariant`) in
[`docs/architecture/overview.md`](../docs/architecture/overview.md).
Le frecce delle dipendenze puntano sempre verso `fub-abi`.

## Contratto e nucleo

- `fub-abi` — il contratto: modello documento comune e trait di estensione,
  definito una volta sola, senza markdown, Tauri o WASM.
- `fub-kernel` — il nucleo agnostico: vault, grafo dei link, registro dei
  provider, bus degli eventi; niente markdown, WASM o Tauri.
- `fub-host` — l'host: registro delle feature, sessione del vault aperto e
  watcher dietro un trait; niente Tauri.
- `fub-app` — il binario Tauri v2: comandi ed eventi IPC, finestre, dialoghi.
- `fub-componenti` — il risolutore dei componenti: cosa è acceso, chi lo
  richiede, cosa non serve più; puro, senza I/O.
- `fub-motori` — lo strato dei motori: costruzione alla prima richiesta, gruppo
  di thread e budget delle cache, senza nominare alcun motore.

## Formati

- `fub-format-markdown` — il primo `FormatProvider` nativo (stile Obsidian).
- `fub-format-canvas` — provider JSON Canvas 1.0 (`.canvas`).
- `fub-format-base` — il formato nativo `.base`: viste YAML sulle proprietà.
- `fub-format-rich` — documenti di videoscrittura con WordCraft.
- `fub-format-xlsx` — cartelle Excel con GridCraft.
- `fub-format-svg` — provider delle scene FubDraw.
- `fub-format-craft` — file delle app Craft in sola lettura.

## Domini

- `fub-features` — le feature ufficiali come implementazioni di trait native.
- `fub-importers` — import/export ufficiali (parser locali e connettori API).
- `fub-services` — backend da ospitare in proprio per account, sincronizzazione
  e pubblicazione.
- `fub-ink` — nucleo condiviso dell'inchiostro: campioni, pressione,
  stabilizzatore; puro, niente DOM.
- `fub-scene` — lettura delle scene FubDraw e diagnostica; puro.
- `fub-canvas-core` — nucleo della lavagna: modello JSON Canvas 1.0 con i
  campi sconosciuti conservati; compila per `wasm32-unknown-unknown`.
- `fub-canvas-wasm` — la facciata WebAssembly del nucleo lavagna per la WebView.
- `fub-live` — sessione di disegno live PC–tablet: protocollo, abbinamento, TLS.

## Composizione e binari

- `fub-sdk` — API comode per scrivere provider, con `MemoryHost` per le prove.
- `fub-wasm-host` — il runtime WASM per i plugin di terzi (l'unico crate che
  dipende da Wasmtime).
- `fub-cli` — automazione da riga di comando e server MCP, sopra `fub-host`.
- `fub-testkit` — banco di integrazione host/kernel, solo dev-dependency.
