# 0198 — Le feature ufficiali restano moduli indipendenti

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** host
- **Sostituisce:** 0073, 0129
- **Sostituita da:** —

## Contesto

Ricerca, grafo, backlink, versioning e altre capacità ufficiali condividono il
binario ma non devono diventare dipendenze obbligatorie l'una dell'altra. Un
crate unico può essere modulare; dividerlo prematuramente aumenta manifest e
API senza ridurre accoppiamento.

## Decisione

`fub-features` mantiene una feature Cargo indipendente per capacità. Ogni
modulo registra provider attraverso il contratto e può essere escluso senza
rompere il workspace. Il crate viene diviso soltanto quando esiste un
accoppiamento reale di dipendenze, release o ownership che le feature Cargo non
risolvono.

## Conseguenze

### Positive

- build minime e test di indipendenza restano possibili;
- logica ufficiale usa lo stesso modello dei plugin;
- la struttura non moltiplica crate senza necessità;

### Negative

- un crate grande richiede confini interni rigorosi;
- helper condivisi possono creare dipendenze nascoste;
- la composizione deve gestire combinazioni di feature;

## Alternative scartate

### Un crate per feature subito

Aggiunge pubblicazione e API prima di un bisogno reale.

### Tutto sempre abilitato

Nasconde accoppiamenti e rende le feature non sostituibili.

### Import diretti fra moduli

Fa dipendere una feature dalla presenza di un'altra.

## Verifica

Test compilano combinazioni e controllano l'assenza di riferimenti incrociati.
Il composition root registra soltanto le feature abilitate.
