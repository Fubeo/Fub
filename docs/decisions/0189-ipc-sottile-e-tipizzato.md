# 0189 — L'IPC è un adattatore sottile e tipizzato

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** frontend
- **Sostituisce:** 0037, 0057, 0090, 0093–0095, 0118
- **Sostituita da:** —

## Contesto

Tauri usa JSON e la shell usa TypeScript. Se ogni pannello chiama `invoke`,
l'infrastruttura entra nell'interfaccia, i test richiedono il desktop e i tipi
si duplicano senza presidio. JSON perde precisione per alcuni `u64`.

## Decisione

La shell dipende da un'interfaccia in `apps/client/src/host/`. Soltanto
`host/ipc.ts` e `host/dialog.ts` importano Tauri. `fub-app` traduce forme IPC e
delega all'host. Errori mantengono `kind` e `message`; identità e hash `u64`
viaggiano come stringhe. Enum semplici e fixture vengono generati o verificati
contro Rust.

## Conseguenze

### Positive

- la shell è testabile con un fake host;
- Tauri resta sostituibile al seam;
- precisione ed errori non si perdono;

### Negative

- esiste una proiezione TypeScript da mantenere;
- forme IPC e forme WIT non sono sempre identiche;
- il seam può crescere se non si usano porte generiche;

## Alternative scartate

### Import Tauri ovunque

Accoppia test e componenti al desktop.

### Numeri JavaScript per ogni u64

Corrompe silenziosamente valori oltre 2^53.

### Errori come stringhe

Costringe la UI a interpretare la prosa.

## Verifica

Guard sugli import, fixture mirror, test `lean_ipc` e test della shell
presidiano il confine. Type-check e build sono controlli distinti.
