# `fub-abi` — Il contratto comune

Per chi è: studenti che vogliono capire come è definito il linguaggio comune con cui comunicano tutti i componenti di Fub.

---

## A cosa serve

[`crates/fub-abi`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi) è la libreria fondamentale di Fub. Definisce:
- Le strutture dati del documento (`DocumentModel`, `Block`, `Inline`).
- I trait (le interfacce) che i plugin possono implementare.
- I tipi di eventi, comandi e query.
- Le regole condivise di convalida dei percorsi, dei tag e delle proprietà.

Questo modulo **non compie alcuna operazione di input/output** (non legge file su disco, non apre finestre, non fa chiamate di rete). È puro codice di definizione tipi.

---

## Dipendenze

- **Dipendenze interne**: nessuna (è alla radice del grafo).
- **Dipendenze esterne**: pochissime e leggere (`serde`, `serde_json`, `thiserror`, `unicode-normalization`).
- **Invariante**: non dipende mai da parser Markdown (`comrak`), runtime grafici (`tauri`) o motori WebAssembly (`wasmtime`).

---

## File chiave del modulo

- [`crates/fub-abi/src/traits.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/src/traits.rs): contiene le definizioni dei trait principali (`Plugin`, `FormatProvider`, `ViewProvider`, `IndexProvider`, `HostApi`).
- [`crates/fub-abi/src/model.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/src/model.rs): il modello unificato del documento ad albero.
- [`crates/fub-abi/src/event.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/src/event.rs): tipi di evento emessi dal sistema.
- [`crates/fub-abi/src/schema.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/src/schema.rs): definizione del tipo `SchemaVersion` per i formati persistenti su disco.
- [`crates/fub-abi/src/rules/`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/src/rules/): cartella con le regole di risoluzione dei percorsi (`path_policy.rs`), estrazione proprietà (`properties.rs`), e convalida del testo (`text_policy.rs`).
- [`crates/fub-abi/wit/fub/abi.wit`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi/wit/fub/abi.wit): definizione del contratto espressa nel formato standard WIT (*WebAssembly Interface Types*) per i plugin WASM.

---

## Se vuoi il dettaglio

- Guarda [`docs/06-contratto/01-i-trait-in-rust.md`](file:///home/fubeo/Files/Progetti/Fub/docs/06-contratto/01-i-trait-in-rust.md) per l'analisi approfondita dei singoli trait.
