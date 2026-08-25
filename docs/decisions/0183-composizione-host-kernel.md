# 0183 — L'host compone, il kernel applica le regole

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** host
- **Sostituisce:** 0023, 0027–0032, 0070
- **Sostituita da:** —

## Contesto

Il kernel deve poter funzionare senza Tauri e senza sapere quali feature sono
incluse nel binario. Allo stesso tempo, sessioni, watcher, job, bundle e servizi
hanno bisogno di un owner che vive più a lungo di una singola chiamata.

## Decisione

`fub-kernel` possiede workspace, storage, registri e policy. `fub-host` è il
composition root: apre sessioni, monta bundle, collega provider, custodisce il
workspace e coordina job e shutdown. `fub-app` adatta Tauri all'host. Le
sessioni aperte sono una mappa dell'host e la sessione corrente è una scelta
separata dal registro persistente dei vault.

## Conseguenze

### Positive

- il core è testabile e riusabile senza desktop;
- le feature sono scelte in un solo punto;
- l'ownership delle risorse lunghe è esplicita;

### Negative

- esiste uno strato in più fra app e kernel;
- l'host deve evitare di diventare un secondo kernel;
- alcuni flussi richiedono oggetti di custodia e teardown;

## Alternative scartate

### Montare tutto in fub-app

Le regole diventerebbero specifiche di Tauri.

### Far scegliere i provider al kernel

Il core conoscerebbe build, feature e runtime esterni.

## Verifica

I manifest e i test di dipendenza impediscono import Tauri nell'host e import
host nel kernel. I test headless montano la stessa composizione senza webview.
