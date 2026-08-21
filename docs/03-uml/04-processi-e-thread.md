# Processi e thread a runtime

Per chi è: studenti che vogliono capire come è organizzata la memoria, quali processi sono in esecuzione e quanti thread lavorano mentre Fub è aperto.

---

## Struttura dell'esecuzione

Fub gira come **un unico processo** di sistema operativo, all'interno del quale convivono l'interfaccia grafica (la webview di Tauri) e i vari thread di lavoro in Rust.

```mermaid
flowchart TB
    classDef proc  fill:#7c2d12,stroke:#ea580c,stroke-width:2px,color:#fff
    classDef ui    fill:#374151,stroke:#9ca3af,stroke-width:2px,color:#fff
    classDef core  fill:#2d3748,stroke:#718096,stroke-width:2px,color:#fff
    classDef th    fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    classDef disk  fill:#276749,stroke:#38a169,stroke-width:2px,color:#fff

    subgraph PROC ["Processo dell'applicazione (fub-app)"]
        direction TB
        subgraph WV ["Webview (Frontend)"]
            Shell["Shell TypeScript<br>UI, Editor, Pannelli"]:::ui
        end

        Main["Thread Principale (Tauri IPC)<br>Riceve invoke, emette eventi"]:::proc

        subgraph Session ["Sessione del Vault aperto (VaultSession)"]
            direction TB
            WS["Custodia di Workspace<br>Protetto da RwLock"]:::core
            Bridge["Thread del Ponte<br>Inoltra gli eventi alla UI"]:::th
            Watcher["Thread del Rilevatore<br>Osserva modifiche esterne su disco"]:::th
            Jobs["Thread dei Job (2 di default)<br>Operazioni pesanti in background"]:::th
        end
    end

    subgraph Disco ["File System Locale"]
        Notes["Cartella del Vault (file .md)"]:::disk
        Meta[".fub/ e .fub/data/"]:::disk
    end

    Shell <==>|"invoke / fub://event"| Main
    Main <==> Session
    Session <==> Disco
```

---

## Chi fa cosa

| Elemento | Tipo | Descrizione |
|---|---|---|
| **Webview** | Render UI | Mostra l'interfaccia web (HTML/CSS/JS) compilata con Vite e gestita con CodeMirror 6. |
| **Thread Principale** | Gestore IPC | Riceve i comandi inviati dalla shell e coordina le risposte. |
| **Custodia (`RwLock`)** | Sincronizzazione | Consente a più letture contemporanee di avvenire in parallelo, mentre le scritture ottengono accesso esclusivo per evitare corruzioni. |
| **Thread del Ponte** | Notifiche | Prende gli eventi generati dal kernel e li invia in modo ordinato alla webview. |
| **Thread del Rilevatore** | File Watcher | Usa la libreria `notify` per accorgersi se un file nel vault viene modificato da un programma esterno (per esempio da Obsidian o da Git). |
| **Thread dei Job** | Background Pool | Esegue compiti che richiedono tempo (come indicizzare migliaia di file o fare ricerche complesse) senza bloccare l'interfaccia utente. |

---

## Se vuoi il dettaglio

- Guarda [`crates/fub-host/src/session.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host/src/session.rs) per la struttura `VaultSession`.
- Guarda [`crates/fub-host/src/custodia.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host/src/custodia.rs) per il meccanismo di protezione concorrente.
- Guarda [`crates/fub-host/src/bridge.rs`](file:///home/fubeo/Files/Progetti/Fub/crates/fub-host/src/bridge.rs) per il funzionamento del ponte eventi.
