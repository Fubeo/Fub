# crates/fub-abi/wit/frozen/

Questa cartella contiene una copia del contratto per ogni versione pubblicata. Il nome del file coincide con la versione dichiarata nel package WIT.

Non è un archivio editoriale: è la baseline eseguibile contro cui [`wit_additivity.rs`](../../tests/wit_additivity.rs) verifica che il contratto, dopo il freeze, cresca soltanto per aggiunta.

La regola canonica e il lifecycle delle baseline sono descritti in [`docs/reference/wit-contract.md`](../../../../docs/reference/wit-contract.md).
