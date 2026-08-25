# 0191 — Le view producono UI dichiarativa e la shell possiede i renderer

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** frontend
- **Sostituisce:** 0050, 0104–0106, 0163–0164
- **Sostituita da:** —

## Contesto

Un plugin non può inviare DOM o codice eseguibile attraverso Rust, IPC e WIT.
Una serie di pannelli cablati nella shell impedirebbe a nuovi provider di
presentare dati. Renderer custom senza ownership lascerebbero listener e stato
dopo lo smontaggio.

## Decisione

`ViewProvider` restituisce `UiNode` con chiavi stabili, contenuto e azioni
opache. La shell rende i nodi e mantiene un registro namespaced di renderer
custom. Il bundle proprietario registra e rimuove renderer e disposer.
Contenuto WASM passa dalla validazione non fidata e non può usare HTML o
webview.

## Conseguenze

### Positive

- le view attraversano backend e IPC senza DOM;
- la shell conserva accessibilità e tema;
- renderer specializzati restano sostituibili e smontabili;

### Negative

- il vocabolario dichiarativo deve restare limitato;
- una UI complessa può richiedere un renderer custom;
- diff e chiavi stabili diventano parte del comportamento;

## Alternative scartate

### HTML dal provider

Espone script, sanitizzazione e tema a ogni plugin.

### Pannello TypeScript per feature

Cabla la feature nella shell.

### Renderer globale senza owner

Non definisce collisioni o teardown.

## Verifica

Test di resa, azioni, chiavi, collisioni e teardown verificano il registro. I
componenti non fidati hanno test negativi per HTML, webview e profondità.
