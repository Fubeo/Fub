# 0194 — Ogni proiezione del contratto ha una sorgente dichiarata

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0053, 0128, 0130, 0147, 0159–0160
- **Sostituita da:** —

## Contesto

Rust, WIT e TypeScript descrivono confini diversi. Trattarli come copie
identiche induce generatori che non possono esprimere semantiche specifiche;
scriverli tutti a mano senza fixture lascia derive silenziose.

## Decisione

La forma Rust è la sorgente dei tipi nativi. Il WIT vivo è scritto
deliberatamente per il component model e verificato contro Rust. Gli enum
TypeScript senza payload sono generati; le forme IPC con semantica propria sono
rispecchiate e verificate da fixture. Gli artefatti generati dichiarano comando
e sorgente e non si modificano a mano.

## Conseguenze

### Positive

- ogni differenza fra confini è intenzionale;
- la generazione viene usata dove la mappatura è totale;
- fixture rilevano derive nelle parti manuali;

### Negative

- non esiste un singolo file capace di generare tutto;
- alcune modifiche toccano più sorgenti deliberate;
- i generatori diventano parte della toolchain;

## Alternative scartate

### Generare WIT dal Rust

La proiezione non esprime automaticamente ownership, arena e world.

### Generare TypeScript dal WIT

L'IPC Tauri ha forme e regole diverse dal component model.

### Tutto manuale

La coerenza dipenderebbe dalla memoria del contributore.

## Verifica

Conformità WIT, fixture serde, generatori e verifica byte-per-byte rendono
esplicita ogni proiezione. Un file generato divergente rende rossa la CI.
