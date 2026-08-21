# `fub-app` — L'applicazione desktop (Colla Tauri)

Per chi è: studenti che vogliono capire come l'interfaccia grafica web comunica con il backend Rust dell'applicazione desktop.

---

## A cosa serve

[`crates/fub-app`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app) è il punto di ingresso dell'applicazione desktop basata sul framework **Tauri v2**.

Il suo scopo principale è fare da "colla":
- Riceve le richieste `invoke` inviate da JavaScript/TypeScript nella webview e chiama la funzione corrispondente in `fub-host`.
- Gestisce le finestre dell'applicazione, le finestre di dialogo native del sistema operativo (es. "Scegli cartella vault") e il ciclo di vita del processo.
- Converte gli eventi interni di Fub in eventi della webview (`fub://event`).

---

## Dipendenze

- **Dipendenze interne**: [`fub-abi`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-abi), [`fub-kernel`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-kernel), [`fub-host`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host).
- **Dipendenze esterne**: `tauri` (v2), `tauri-plugin-dialog`, `serde`, `serde_json`, `camino`.
- **Invariante**: la libreria `tauri` è utilizzata **soltanto in questo crate**.

---

## File chiave del modulo

- [`crates/fub-app/src/main.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app/src/main.rs): l'eseguibile principale, punto di avvio del programma.
- [`crates/fub-app/src/lib.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app/src/lib.rs): registrazione di tutti i comandi `#[tauri::command]` esposti alla shell.
- [`crates/fub-app/tauri.conf.json`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app/tauri.conf.json): configurazione di Tauri (titolo finestra, permessi di sicurezza, percorso dei file compilati del frontend).

---

## Se vuoi il dettaglio

- Guarda [`docs/07-ui/03-comandi-eventi-ipc.md`](file:///home/fubeo/Files/Progetti/Fub/docs/07-ui/03-comandi-eventi-ipc.md) per l'elenco completo dei messaggi scambiati tra frontend e backend.
