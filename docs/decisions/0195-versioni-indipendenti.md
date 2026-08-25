# 0195 — Prodotto, ABI e schemi hanno versioni indipendenti

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0066, 0096
- **Sostituita da:** —

## Contesto

La versione dell'app parla a chi installa o compila; l'ABI parla a plugin già
compilati; uno schema parla a file persistenti. Far avanzare un solo numero per
tutti produce migrazioni inutili o promesse ambigue. Anche l'MSRV influenza chi
può compilare il prodotto.

## Decisione

Il workspace usa la versione prodotto, l'ABI usa il package `fub:abi` e ogni
formato su disco usa `SchemaVersion`. Le regole di compatibilità sono
documentate separatamente. L'MSRV è dichiarato nel manifest e pinna la CI; un
aumento è deliberato. Il changelog parla di cambiamenti osservabili, non di
commit interni.

## Conseguenze

### Positive

- ogni consumatore riceve una promessa adatta;
- uno schema può migrare senza cambiare l'ABI;
- un'aggiunta ABI non obbliga a rinumerare ogni cache;

### Negative

- la release deve coordinare più numeri;
- gli autori devono sapere quale versione stanno cambiando;
- la documentazione deve evitare di chiamarli genericamente versione;

## Alternative scartate

### Un solo numero globale

Confonde compatibilità di build, plugin e dati.

### Nessuna versione pre-1.0

I plugin e i file persistenti hanno bisogno di rifiuti espliciti anche prima di 1.0.

## Verifica

Manifest, `ABI_VERSION`, package WIT e costanti `SchemaVersion` sono fonti
eseguibili. I test di release e documentazione ne verificano la coerenza.
