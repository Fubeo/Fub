# 0182 — Comandi, query e view attraversano registri generici

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0005, 0016–0019, 0025–0026, 0082–0083
- **Sostituita da:** —

## Contesto

Una porta IPC o un metodo del kernel per ogni feature lega shell e core
all'elenco corrente delle capacità. Plugin e feature ufficiali diventerebbero
due architetture: le prime dietro registri, le seconde cablate nel prodotto.

## Decisione

Le letture estensibili passano da `IndexProvider` e `query_index`; le azioni
da `CommandProvider`; le superfici da `ViewProvider`. Specifiche, contesti,
argomenti ed esiti sono tipizzati nel contratto. Il composition root registra
le implementazioni. Porte dedicate restano soltanto per operazioni autorevoli
del workspace, come apertura, scritture e bozze.

## Conseguenze

### Positive

- una nuova feature può comparire senza nuova API Tauri;
- provider ufficiali e di terzi usano lo stesso percorso;
- la shell può scoprire capacità da specifiche;

### Negative

- i protocolli generici richiedono id stabili e validazione;
- una porta troppo generica può degradare in JSON non tipizzato;
- debug e telemetria devono conservare il provider proprietario;

## Alternative scartate

### Comando IPC per feature

Moltiplica i seam e rende la shell consapevole dei crate.

### Un'unica porta JSON universale

Perde tipi, compatibilità e autorizzazione per famiglia.

## Verifica

I guard `lean_ipc` e i test dei registri impediscono porte dedicate ridondanti.
Ogni nuova capacità deve essere esercitata attraverso il proprio provider.
