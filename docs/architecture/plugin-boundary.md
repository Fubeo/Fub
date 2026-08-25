# Confine dei plugin

## Un solo contratto, due esecuzioni

Un provider può essere compilato nativamente con l'applicazione oppure eseguito come componente WASM. In entrambi i casi implementa il vocabolario di `fub-abi`; cambia il modo in cui il confine viene attraversato.

## Cosa esporta un provider

Il contratto può esporre, secondo il tipo di provider:

- parsing e serializzazione di un formato;
- query di indice;
- comandi;
- viste dichiarative e azioni delle viste;
- impostazioni e metadati di manifest;
- lavori con progresso e cancellazione.

## Cosa importa da Fub

Un guest non riceve accesso generale al processo. L'host importa soltanto le funzioni concesse dalla sua capacità: letture del vault, scritture, query, storage, log o altri servizi espliciti.

Negare una famiglia di capacità significa non esporre le relative funzioni al componente, non affidarsi a un controllo tardivo dentro una funzione già disponibile.

## Regole del confine

- niente accesso diretto al filesystem del vault;
- niente dipendenza da Tauri o dalla shell;
- niente tipi non serializzabili nel contratto;
- errori espliciti invece di panic attraverso il confine;
- limiti e cancellazione per operazioni costose;
- versione ABI dichiarata e verificata prima dell'uso.

## Stato attuale

Il WIT vivo e le baseline congelate sono presenti e sotto test. `fub-wasm-host` contiene il runtime, ma il flusso pubblico completo di installazione e distribuzione dei plugin non è ancora un'API stabile.

Per iniziare consulta [`guida/creare-un-plugin.md`](../guida/creare-un-plugin.md), [`06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md) e la milestone [`M5`](../milestones/M5-wasm-runtime.md).