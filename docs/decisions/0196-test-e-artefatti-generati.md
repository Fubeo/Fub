# 0196 — I guard verificano proprietà e gli artefatti derivano da una sorgente

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0054–0056, 0072, 0112–0115, 0145, 0166
- **Sostituita da:** —

## Contesto

Dipendenze, file generati, mirror e invarianti documentali non sempre
falliscono durante una compilazione normale. Conteggi e snapshot senza una
derivazione stabile diventano una seconda implementazione della repository.

## Decisione

Ogni guard nomina una proprietà architetturale e include un'autoprova quando
il proprio parser può spegnersi silenziosamente. Artefatti generati hanno una
sorgente, un comando e una verifica byte-per-byte. I conteggi restano soltanto
quando esprimono una proprietà utile e derivabile. I test di integrazione
costruiscono gli artefatti eseguibili dai sorgenti.

## Conseguenze

### Positive

- la deriva strutturale diventa un errore vicino alla causa;
- un file generato non può invecchiare inosservato;
- i test non dipendono da binari committati;

### Negative

- gli script sono codice e richiedono test;
- guard troppo specifici possono ostacolare refactor legittimi;
- la CI esegue controlli oltre la compilazione;

## Alternative scartate

### Review manuale

Non è ripetibile e perde derive piccole.

### Committare binari di esempio

Possono smettere di corrispondere ai sorgenti.

### Registrare ogni numero nella prosa

Moltiplica marker e manutenzione senza valore.

## Verifica

I generatori vengono eseguiti e confrontati. I guard hanno fixture negative e
positive. La documentazione non contiene conteggi che il codice non deriva.
