# Comunicazione IPC: Comandi ed Eventi

Per chi è: studenti che vogliono capire come viaggiano i messaggi tra l'interfaccia grafica in TypeScript e il backend in Rust.

---

## Il doppio canale IPC

La comunicazione tra il frontend (webview) e il backend (Rust) avviene attraverso due direzioni ben distinte:

```mermaid
flowchart LR
    subgraph Frontend ["Frontend (TypeScript)"]
        UI["Interfaccia Utente"]
    end

    subgraph Backend ["Backend (Rust: fub-app + fub-host)"]
        Core["Logica di Fub"]
    end

    UI -->|"1. invoke(comando, argomenti)<br>(Richiesta sincrona: 'fai X')"| Core
    Core -->|"Risposta o Errore"| UI

    Core -->|"2. fub://event<br>(Notifica asincrona: 'è successo Y')"| UI
```

---

## 1. I Comandi (`invoke`: da Frontend a Backend)

Quando l'utente compie un'azione (apre un file, salva una nota, esegue una ricerca), il frontend invia un comando IPC:

```typescript
// Esempio: chiamata dal frontend
import { invoke } from '@tauri-apps/api/core';

const risultato = await invoke('write_document', {
    id: 'Appunti.md',
    text: '# Titolo aggiornato'
});
```

Nel backend, il comando è gestito in [`crates/fub-app/src/lib.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app/src/lib.rs):

```rust
#[tauri::command]
pub async fn write_document(
    state: tauri::State<'_, AppState>,
    id: String,
    text: String
) -> Result<(), CommandError> {
    // Chiama il kernel tramite la custodia di fub-host
    // ...
}
```

---

## 2. Gli Eventi (`fub://event`: da Backend a Frontend)

Quando qualcosa cambia nel vault (per esempio un file viene salvato o modificato all'esterno da un altro programma), il backend emette un evento:

- Il thread del ponte (`bridge.rs`) preleva l'evento dal kernel.
- Tauri trasmette l'evento alla webview attraverso il canale dedicato `fub://event`.
- Lo store del frontend riceve il payload e aggiorna i pannelli coinvolti.

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-app/src/lib.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-app/src/lib.rs) per tutti i comandi IPC disponibili.
- Guarda [`frontend/src/host/`](file:///home/fubeo/Files/Progetti/Fub/frontend/src/host) per i wrapper TypeScript che chiamano questi comandi.
