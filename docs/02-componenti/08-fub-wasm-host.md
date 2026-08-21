# `fub-wasm-host` — L'ambiente per plugin WebAssembly

Per chi è: studenti che vogliono capire come Fub esegue codice di terze parti in modo sicuro e isolato usando WebAssembly.

---

## A cosa serve

[`crates/fub-wasm-host`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-wasm-host) è il modulo (in sviluppo attivo per la Milestone 5) che consente di caricare ed eseguire plugin compilati in formato WebAssembly (`.wasm`).

Usa lo standard **Wasmtime Component Model** e l'interfaccia **WASI 0.2**:
- Fornisce una **sandbox sicura**: un plugin WASM non può accedere ai file o a internet a meno che l'utente non gli conceda i permessi espliciti.
- Traduce i tipi di dati tra la memoria protetta del modulo WASM e le strutture Rust di `fub-abi`.

---

## Dipendenze

- **Dipendenze interne**: [`fub-abi`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi), [`fub-kernel`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-kernel), [`fub-host`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host).
- **Dipendenze esterne**: `wasmtime` (il motore di runtime WebAssembly).
- **Invariante**: la libreria `wasmtime` è utilizzata **solo ed esclusivamente qui**.

---

## File chiave del modulo

- [`crates/fub-wasm-host/src/component.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-wasm-host/src/component.rs): caricamento del file `.wasm` e istanziazione del componente WASM.
- [`crates/fub-wasm-host/src/translate.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-wasm-host/src/translate.rs): conversione bidirezionale dei tipi di dati definiti nel file WIT.
- [`crates/fub-wasm-host/src/events.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-wasm-host/src/events.rs): recapito degli eventi di Fub al componente WASM.
- [`crates/fub-wasm-host/src/model.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-wasm-host/src/model.rs): adattamento del modello del documento per il passaggio attraverso il varco WebAssembly.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/01-nativo-vs-wasm.md`](file:///home/fubeo/Files/Progetti/Fub/docs/04-plugin/01-nativo-vs-wasm.md) per capire come funziona l'esecuzione sicura dei plugin.
- Guarda il plugin di esempio in [`esempi/ping-wasm/`](file:///home/fubeo/Files/Progetti/Fub/esempi/ping-wasm).
