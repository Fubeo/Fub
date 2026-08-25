# Flusso di una richiesta

> **Stato:** implementato  
> **Fonte di verità:** seam IPC, shell host e dispatcher del kernel

Una richiesta parte dalla shell, attraversa un numero ridotto di adattatori e raggiunge un canale generico del backend.

## Comando

```mermaid
sequenceDiagram
    participant UI as Shell
    participant App as fub-app
    participant Host as fub-host
    participant Kernel as fub-kernel
    participant Provider as Provider

    UI->>App: invoke tipizzato
    App->>Host: traduzione IPC
    Host->>Kernel: comando o query
    Kernel->>Provider: dispatch attraverso trait
    Provider-->>Kernel: risultato tipizzato
    Kernel-->>Host: esito
    Host-->>App: risposta serializzabile
    App-->>UI: risultato o errore
```

## Eventi di ritorno

```mermaid
flowchart LR
    Kernel["Kernel"] --> Bus["EventBus"]
    Bus --> Sink["EventSink host"]
    Sink --> Tauri["fub://event"]
    Tauri --> Router["Router frontend"]
    Router --> State["Stato interessato"]
```

## Regole

- query per ottenere dati;
- comandi per chiedere mutazioni;
- view per UI dichiarativa;
- eventi per fatti osservabili;
- porte dedicate solo quando il canale generico non esprime la semantica;
- nessun IPC specifico per una singola feature se esiste già un registro.

## Fallimenti

Gli errori vengono tradotti una sola volta al confine e mantengono una variante riconoscibile. La shell decide come presentare il testo localizzato, senza analizzare stringhe arbitrarie.
