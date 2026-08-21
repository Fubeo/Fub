# Esempi e strumenti di supporto

## Gli esempi pratici (`esempi/`)

Nella cartella [`esempi/`](../../esempi) si trovano quattro progetti completi che dimostrano l'implementazione pratica del contratto WebAssembly Component Model (`fub:abi@0.1.1`):

| Progetto | Focus Architetturale | Descrizione |
|---|---|---|
| [`esempi/ping-wasm`](../../esempi/ping-wasm) | Manifest & HostApi | Plugin minimale che dichiara il manifest, richiede permessi (`fub:read-vault`, `fub:network`) e invoca `now_unix_millis` e `read_document`. |
| [`esempi/ciclo-wasm`](../../esempi/ciclo-wasm) | Ciclo di Vita | Mostra la sequenza di attivazione (`activate`) e disattivazione (`deactivate`) controllata con inizializzazione e rilascio dello stato locale. |
| [`esempi/eventi-wasm`](../../esempi/eventi-wasm) | Gestione Eventi | Mostra come sottoscrivere una maschera di eventi (`EventMask`) e gestire le notifiche asincrone dal bus del vault (`EventHandler`). |
| [`esempi/modello-wasm`](../../esempi/modello-wasm) | AST del Documento | Manipolazione della struttura del modello ad albero (`DocumentModel`, `Block`, `Inline`) attraverso il varco WASM Component Model. |

---

## Come compilare gli esempi WASM

Tutti i plugin nella cartella `esempi/` compilano come componenti WebAssembly WASI 0.2 usando il target `wasm32-wasip2` e `wit-bindgen`:

```bash
# 1. Assicurarsi di aver aggiunto il target wasm
rustup target add wasm32-wasip2

# 2. Compilazione release del plugin ping
cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2 --release

# Il componente risultante si trova in:
# esempi/ping-wasm/target/wasm32-wasip2/release/ping_wasm.wasm
```

---

## Gli strumenti di verifica (`tools/`)

La cartella [`tools/`](../../tools) contiene utility di presidio e validazione statica dei contratti:

### `tools/varco-wasm`
- **Scopo**: Compila il contratto WIT (`fub/abi.wit`) per il target WebAssembly per verificare che l'interfaccia sia sempre serializzabile e priva di tipi Rust-centric non supportati dal Component Model.
- **Invariante**: Se un cambiamento in `fub-abi` rompe l'ABI WebAssembly, la compilazione di `tools/varco-wasm` fallisce immediatamente in CI.
- **Esecuzione**:
  ```bash
  cargo check --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-wasip2
  ```

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/04-esempio-ping.md`](../04-plugin/04-esempio-ping.md) per l'analisi riga per riga del codice sorgente di `esempi/ping-wasm`.
- Guarda [`docs/04-plugin/05-creare-un-plugin.md`](../04-plugin/05-creare-un-plugin.md) per la guida alla creazione di un nuovo plugin partendo da zero.
- Guarda [`docs/06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md) per le specifiche del formato WIT e la regola del freeze.
