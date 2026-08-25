# Sviluppare un provider o un plugin

## Stato del percorso esterno

Il contratto per componenti WASM esiste ed è verificato, ma il runtime e il flusso completo di distribuzione per plugin di terzi sono ancora in sviluppo. Non presentare l'attuale API come stabile o pubblicata.

## Le due forme

- Un **provider nativo** è compilato insieme a Fub e implementa i trait di `fub-abi`.
- Un **guest WASM** implementa il world descritto in [`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit) e riceve soltanto le capacità importate dall'host.

Le funzionalità ufficiali in `fub-features` sono il banco di prova del modello: devono usare lo stesso contratto pubblico e non possono dipendere normalmente da `fub-kernel`.

## Da dove partire

1. leggi [il confine dei plugin](../architecture/plugin-boundary.md);
2. consulta i trait in [`06-contratto/01-i-trait-in-rust.md`](../06-contratto/01-i-trait-in-rust.md);
3. usa [`fub-sdk`](../../crates/fub-sdk/) per gli adattatori e le utilità lato provider;
4. guarda [`esempi/ping-wasm`](../../esempi/ping-wasm/) per il componente di prova;
5. verifica il contratto con i test di conformità disponibili nel repository.

## Regole essenziali

- dichiara soltanto le capacità necessarie;
- non accedere direttamente al filesystem del vault;
- passa attraverso `HostApi` per letture, scritture, query e servizi concessi;
- restituisci errori espliciti e dati serializzabili;
- non dipendere da Tauri o dalla shell;
- non dare per disponibile una funzione che non compare nella versione del contratto dichiarata dal guest.

Le decisioni di compatibilità del WIT sono in [`06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md).