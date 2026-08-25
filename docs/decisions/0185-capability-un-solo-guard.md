# 0185 — Un solo Guard applica capability e scope

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** sicurezza
- **Sostituisce:** 0013, 0021, 0064, 0071, 0081, 0097–0098, 0116, 0149, 0156, 0168
- **Sostituita da:** —

## Contesto

Provider nativi e WASM usano servizi host. Se ogni adattatore applica permessi
propri, due backend possono autorizzare richieste diverse e un nuovo servizio
può dimenticare la policy. Booleani per ogni capacità non rappresentano scope
o parametri.

## Decisione

Il manifest dichiara capability namespaced con parametri. Il kernel costruisce
un `HostApi` protetto da un solo `Guard`, che verifica fiducia, permesso, scope
del vault e argomenti. Runtime nativo e WASM ricevono l'API già protetta. Le
famiglie host non disponibili non vengono linkate.

## Conseguenze

### Positive

- la policy è identica per tutti i backend;
- nuove capability possono avere parametri senza cambiare record fissi;
- un permesso negato conserva un errore tipizzato;

### Negative

- il Guard è un punto critico che richiede test esaustivi;
- la granularità troppo fine rende i manifest difficili da usare;
- servizi opzionali devono dichiarare la propria assenza;

## Alternative scartate

### Controllo nel proxy WASM

Il backend nativo avrebbe una policy diversa.

### Booleano per capability

Non esprime path, host, quota o altri scope.

### Fiducia come autorizzazione totale

Un'etichetta di provenienza non sostituisce il minimo privilegio.

## Verifica

Ogni servizio ha test concesso, negato e fuori scope. I test di parità
confrontano host nativo e WASM. Il path fence resta nel livello autorevole.
