# 0188 — DocId è il path canonico e rename è un'operazione di dominio

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** storage
- **Sostituisce:** 0043–0048, 0122–0124, 0135–0136
- **Sostituita da:** —

## Contesto

Il file è identificato nel vault dal proprio path. Un rename tocca sessioni,
bozze, indici, organizzazione, versioni ed eventi; una semplice chiamata
filesystem lascia copie divergenti. Path assoluti e relativi possono aggirare
la radice se canonicalizzati in punti diversi.

## Decisione

`DocId` è un path relativo canonico con separatore `/`. La recinzione del vault,
la validazione dei nomi e le regole di collisione vivono nel core. Rename e
move sono operazioni atomiche di dominio: aggiornano o invalidano tutti i
derivati e producono un esito e un evento ricongiunti.

## Conseguenze

### Positive

- tutti i componenti parlano della stessa identità;
- la shell non applica regole filesystem;
- watcher e operazioni interne possono essere riconciliati;

### Negative

- rinominare cambia l'identità pubblica;
- case-only rename richiede attenzione ai filesystem;
- feature che mantengono storia devono gestire la transizione;

## Alternative scartate

### UUID indipendente dal path

Richiede un registro autorevole aggiuntivo e non elimina la semantica dei path.

### Rename solo nel frontend

Bypassa indici, sessioni e policy.

### Canonicalizzazione per chiamante

Produce risultati diversi e falle di recinzione.

## Verifica

I test coprono path traversal, symlink, collisioni, rename case-only, sessioni
aperte, watcher e aggiornamento dei derivati.
