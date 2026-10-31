# 0233 — I motori arrivano in edizioni, non in librerie a runtime

- **Stato:** accolta
- **Data:** 2026-10-31
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub prende i motori delle app Craft (VectorCraft, PdfCraft, PhotoCraft,
LightCraft, WordCraft, GridCraft) e li accende come componenti. Un componente
spento non deve costare memoria, e questo già vale: il sistema legge dal
disco soltanto le funzioni che girano. Resta il disco, cioè il peso
dell'installazione.

Il piano dei componenti ha tre livelli di consegna: dati scaricabili
(modelli, dizionari, caratteri), edizioni (lo stesso Fub compilato con
feature Cargo diverse) e librerie a runtime (ogni motore in una libreria
dinamica, caricata quando serve). K0 doveva decidere il terzo coi numeri.

I numeri sono in [I sei motori da soli](../misure/motori-2026-10-31-linux-ryzen.md)
e in [Le librerie a runtime](../misure/librerie-runtime-2026-10-31.md):

- un motore pesa fra 6,5 MiB (GridCraft) e 64,6 MiB (VectorCraft), senza
  simboli; è il codice che un'edizione toglie a chi non lo usa;
- la prova del livello 3 (due componenti `dylib`, una libreria comune, un
  ospite che li carica con `libloading`) passa su Linux, macOS (firma ad hoc
  compresa) e Windows;
- ma la consegna dinamica costa 5,5 MiB su Linux, 1,8 su macOS e 1,1 su
  Windows, contro 0,5, 0,5 e 0,3 MiB dello stesso programma statico: quasi
  tutto è la libreria standard di Rust in forma dinamica (5,2, 1,4 e
  0,8 MiB), che si paga una volta per consegna;
- Rust non ha un'ABI stabile: ogni libreria deve uscire dallo stesso
  compilatore e dalla stessa release di Fub e della libreria comune, quindi
  un componente non si aggiorna da solo;
- il compilatore non ottimizza attraverso il confine fra due librerie
  (niente inlining né LTO fra un motore e ciò che usa).

## Decisione

1. I motori arrivano col **livello 2, le edizioni**: lo stesso codice
   compilato con feature Cargo diverse per profilo. Accendere un componente
   che l'edizione non contiene scarica l'edizione che lo contiene. Il
   lavoro è di K4.
2. I dati grandi arrivano col **livello 1**: scaricati al primo uso, a
   indirizzo fisso e con impronta sha256, e tolti con «Rimuovi».
3. Il **livello 3 non si adotta**. La prova resta in `tools/librerie-runtime`
   e nel job `librerie-runtime` della CI, perché la decisione si possa
   rivedere coi numeri di un'altra versione di Rust.
4. Il modello dei componenti non cambia: un componente dice soltanto se è
   dentro l'edizione o si scarica, e una consegna futura si aggiunge senza
   riscrivere quelle che ci sono.

## Conseguenze

### Positive

- ogni motore resta ottimizzato insieme al resto del programma, con LTO;
- un'edizione toglie dal disco proprio il codice che pesa (fino a 64,6 MiB
  per motore), senza la libreria standard dinamica;
- una sola firma per programma su macOS e Windows, come per Fub senza motori.

### Negative

- più build nella CI e più pacchetti da pubblicare, uno per edizione;
- accendere un componente fuori dall'edizione vuol dire scaricare e
  riavviare, non aggiungere un file;
- chi vuole un motore solo paga comunque il resto della sua edizione.

## Alternative scartate

### Librerie a runtime (livello 3)

Funzionano sui tre sistemi, ma la libreria standard dinamica pesa più di
quanto toglie un motore piccolo, i componenti non si aggiornano uno per uno
e il confine fra le librerie toglie le ottimizzazioni. Si rivede se Rust
avrà un'ABI stabile o se un motore dovrà aggiornarsi da solo.

### Un programma solo con tutto dentro

È il più semplice da costruire, ma chi usa solo le note scaricherebbe
centinaia di MiB di motori che non accende.

### Motori in WebAssembly

Restano per i componenti leggeri di terzi. Per i motori mancano la
scheda grafica e i thread, e sono più lenti dove conta.

## Verifica

- `tools/librerie-runtime/prova.mjs` e il job `librerie-runtime` della CI
  tengono viva la prova del livello 3 sui tre sistemi;
- `tools/motori-prova/budgets.json` scrive per ogni motore il tetto di peso
  senza simboli, di librerie nuove e di librerie doppie con Fub, e
  `misura.mjs` fallisce quando uno lo supera;
- le edizioni e i loro tetti per profilo nascono in K4.
