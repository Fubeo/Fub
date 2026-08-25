# 0187 — Ogni formato su disco dichiara autorità e schema

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** storage
- **Sostituisce:** 0038, 0058, 0065–0068, 0085–0089, 0092, 0099, 0127, 0154–0155
- **Sostituita da:** —

## Contesto

La cartella `.fub/` contiene sia stato non ricostruibile sia cache. Trattarla
tutta come eliminabile perde bozze, organizzazione o snapshot; trattarla tutta
come autorevole impedisce la ricostruzione semplice degli indici. Schemi
diversi cambiano in momenti diversi.

## Decisione

Ogni formato persistente usa `SchemaVersion`, dichiara proprietario,
autorità, comportamento su versione futura e strategia di migrazione. I
derivati incompatibili vengono ricostruiti. I dati autorevoli vengono migrati
atomicamente o rifiutati. Lo storage plugin è classificato dal plugin, non
dalla directory che lo contiene.

## Conseguenze

### Positive

- backup e ripristino possono includere ciò che conta;
- una cache corrotta non blocca il prodotto se può essere ricostruita;
- le migrazioni sono locali al formato;

### Negative

- il catalogo degli schemi deve restare verificato;
- un plugin può possedere sia indice derivato sia contenuto autorevole;
- alcune versioni future richiedono un rifiuto esplicito;

## Alternative scartate

### Una versione globale di .fub

Costringe migrazioni non collegate.

### Tutta .fub/data è cache

Il versioning dimostra che il path non basta.

### Lettura tollerante di versioni future

Può riscrivere e cancellare campi sconosciuti.

## Verifica

I test confrontano le costanti `SchemaVersion` con il riferimento su disco e
provano ricostruzione, rifiuto in avanti, scrittura atomica e dati corrotti.
