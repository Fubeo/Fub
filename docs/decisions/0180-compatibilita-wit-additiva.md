# 0180 — Il WIT congelato cresce soltanto per aggiunta

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0002, 0059, 0060, 0102
- **Sostituita da:** —

## Contesto

Un plugin compilato non viene ricompilato quando cambia l'host. La compatibilità
non può essere dedotta confrontando soltanto Rust e WIT correnti: due forme
possono essere coerenti fra loro e, insieme, aver rotto la versione pubblicata.

## Decisione

Ogni versione ABI pubblicata ha uno snapshot in
`crates/fub-abi/wit/frozen/`. L'host accetta la stessa major e una minor del
plugin non superiore. Per la stessa major, la superficie viva deve servire
tutti gli snapshot compatibili senza rimozioni, rinomine, riordini o cambi di
forma. Le aggiunte entrano in coda o in nuove interfacce.

## Conseguenze

### Positive

- la promessa di compatibilità è meccanica;
- una rottura appare nella stessa revisione che la introduce;
- plugin più vecchi continuano a funzionare con host più nuovi;

### Negative

- l'ordine di campi e casi diventa parte del contratto;
- alcuni refactor richiedono nuovi tipi invece di modificare quelli esistenti;
- gli snapshot aumentano con le versioni pubblicate;

## Alternative scartate

### Usare soltanto SemVer dichiarativo

Un numero non rileva una rottura strutturale.

### Rigenerare lo snapshot a ogni modifica

Trasformerebbe la baseline nel presente e annullerebbe il confronto.

## Verifica

`wit_additivity.rs` confronta il WIT vivo con ogni snapshot della major.
`abi_compatible` e il test devono descrivere lo stesso insieme di versioni
accettate.
