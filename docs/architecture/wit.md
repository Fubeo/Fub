# Contratto WIT

Il file vivo è [`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit). Rispecchia `fub-abi` nella lingua dei componenti WASM.

Questa pagina serve da ingresso stabile per i documenti architetturali. La guida completa, inclusi mapping, arene per gli alberi ricorsivi e procedura di aggiornamento, è in [`06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md).

Tre controlli distinti proteggono il confine:

1. il WIT deve essere valido e conforme ai tipi Rust;
2. il contratto vivo deve restare additivo rispetto alle baseline pubblicate;
3. il world del plugin deve generare binding compilabili per il target WASM previsto.