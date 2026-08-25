# `fub-app` — gli adattatori Tauri

[`crates/fub-app/`](../../crates/fub-app) è l'eseguibile desktop e il solo crate
che conosce Tauri. Non monta direttamente la logica di prodotto: espone alla
webview le operazioni dell'host e collega gli eventi alla shell.

## Responsabilità

- registrare i comandi `#[tauri::command]`;
- tradurre i parametri IPC nei tipi usati da `fub-host` e `fub-kernel`;
- restituire errori strutturati come `PluginError`, non frasi da analizzare;
- inoltrare le notifiche dell'host alla webview come evento `fub://event`;
- aprire dialoghi nativi attraverso il plugin Tauri dedicato;
- configurare e avviare il processo desktop.

Se una funzione può essere spiegata senza nominare Tauri o la webview, in genere
appartiene all'host, al kernel o all'ABI invece che a questo crate.

## Struttura

| Percorso | Ruolo |
|---|---|
| [`src/main.rs`](../../crates/fub-app/src/main.rs) | Punto di ingresso minimo del binario `fub`. |
| [`src/lib.rs`](../../crates/fub-app/src/lib.rs) | Comandi IPC, ponte degli eventi, setup e avvio di Tauri. |
| [`tauri.conf.json`](../../crates/fub-app/tauri.conf.json) | Configurazione della finestra, del frontend e del packaging desktop. |

## Dipendenze interne

Il crate dipende da:

- `fub-host`, con le funzionalità ufficiali abilitate;
- `fub-kernel`, per alcuni tipi e accessi del confine;
- `fub-abi`, per i record e gli errori serializzati.

Non dipende direttamente da `fub-features`: il montaggio passa attraverso
`fub-host`. Non dipende da `fub-wasm-host`: il runtime WASM è collaudato come
backend separato, ma il percorso desktop di scoperta e installazione non è
ancora collegato.

## Confine con il frontend

La shell TypeScript non importa Rust. Usa il contratto in
`frontend/src/host/`, che rispecchia le forme serializzate dall'app. Le chiamate
Tauri restano nei moduli di confine; pannelli ed editor dipendono da
un'interfaccia sostituibile nei test.

I messaggi e gli eventi sono descritti in
[`../07-ui/03-comandi-eventi-ipc.md`](../07-ui/03-comandi-eventi-ipc.md).
