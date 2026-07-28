# crates/fubmd-abi/wit/frozen/

Una copia del contratto per ogni versione **pubblicata**, col nome del file
uguale alla versione (`0.1.0.wit` ↔ `package fubmd:abi@0.1.0`).

Non è un archivio: è la linea di base contro cui
[`wit_additivity.rs`](../../tests/wit_additivity.rs) verifica la promessa su cui
poggia il freeze di M4 — post-freeze il contratto cresce solo per aggiunta.

**La regola in prosa, col ciclo di vita della cartella, sta in `docs/`:**
[docs/architecture/wit-congelato.md](../../../../docs/architecture/wit-congelato.md).
