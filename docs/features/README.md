# Specifiche delle funzionalità

I documenti di questa cartella descrivono **requisiti di prodotto**: cosa una funzionalità dovrebbe offrire, quali casi deve coprire e quali criteri ne definiscono la qualità.

Non sono una lista affidabile delle funzioni già disponibili. Una casella non selezionata non è automaticamente un'attività approvata; una descrizione completa non prova che il codice esista.

Per lo stato reale usa:

- [`STATO.md`](../STATO.md) per la fotografia verificata del repository;
- [`todo.md`](../todo.md) per le voci tecniche aperte;
- [`milestones/`](../milestones/README.md) per i traguardi;
- [`roadmap/`](../roadmap/README.md) per i piani discussi.

## Regola di manutenzione

Quando una specifica diventa implementazione:

1. il codice e i test restano la fonte di verità;
2. `STATO.md` viene aggiornato con il comportamento verificato;
3. questa pagina conserva i requisiti, senza trasformarsi in changelog;
4. le decisioni non ovvie vengono registrate in [`decisions/`](../decisions/README.md).

Le specifiche sono utili soltanto se distinguono chiaramente “richiesto”, “deciso” e “disponibile”.