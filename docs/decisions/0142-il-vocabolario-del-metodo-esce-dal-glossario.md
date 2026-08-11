# 0142. Il vocabolario del metodo esce dal glossario

Data: 2026-08-11

## Contesto

Il glossario di Fub (`docs/glossario.md`) conteneva sia il vocabolario del
**prodotto** (termini come `lotto`, `anagrafe`, `sidecar`, `revisione`, che
hanno un tipo Rust corrispondente e un verbale associato) sia il vocabolario del
**metodo** di lavoro (termini come `seduta`, `strozzatura`, `voce`, che
descrivono come gestiamo lo sviluppo ma non corrispondono ad artefatti nel
codice).

Questa mescolanza creava confusione. Il lettore nuovo faticava a distinguere le
parole chiave dell'architettura dalle convenzioni interne di progetto.

## Decisione

La sezione `## Il metodo`, che contava 21 voci, è stata **rimossa interamente
dal glossario**. Il glossario rimane l'unica fonte di verità per il vocabolario
del prodotto.

Il vocabolario del metodo è stato consolidato e trasferito nella tabella
dedicata in `docs/leggimi-prima.md` (alla sezione "Il dizionario del dialetto"),
in italiano normale e in forma molto più schematica. La voce eccezionale
`buco dichiarato`, che conteneva l'inventario dei buchi del contratto e il
rispettivo marcatore `[conta: buchi-dichiarati]`, è stata spostata in
`docs/architecture/plugin-boundary.md`, accanto ai concetti che definisce.

## Conseguenze

- Il glossario (`docs/glossario.md`) contiene ora solo sei famiglie di termini
  (anziché sette), tutte strettamente legate al codice e all'architettura.
- `docs/leggimi-prima.md` diventa il punto d'ingresso principale per comprendere
  i termini metodologici e operativi (es. cos'è un `banco`, un `difetto`, una
  `seduta`).
- I conteggi automatici e i link sono stati preservati: il marcatore
  `[conta: buchi-dichiarati]` non si è perso ed è tracciato correttamente da
  `conteggi.mjs` nella sua nuova collocazione.
