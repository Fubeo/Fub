# Specifiche delle funzionalità

Questa cartella descrive **requisiti di prodotto**: cosa una funzionalità dovrebbe offrire, quali casi deve coprire e quali criteri ne definiscono la qualità.

Non è una roadmap, un backlog o un report automatico sul codice.

## Come leggere i file

- ogni documento raccoglie una famiglia coerente di capacità;
- le caselle `[ ]` rappresentano requisiti, comportamenti o criteri da coprire;
- una casella non selezionata non dimostra, da sola, che il comportamento manchi nel codice;
- una casella selezionata non sostituisce test, documentazione tecnica o stato di milestone.

Per conoscere la situazione reale usa:

- [`../STATO.md`](../STATO.md) per la fotografia verificata del repository;
- [`../PIANO.md`](../PIANO.md) per milestone e priorità;
- [`../todo.md`](../todo.md) per il lavoro ancora aperto.

## Ordine di lettura

Parti da [`01-principi-fondanti.md`](01-principi-fondanti.md), poi apri il documento della famiglia interessata. Non è necessario leggere il catalogo in sequenza per contribuire a un singolo componente.

## Regola di manutenzione

Quando una specifica diventa implementazione:

1. codice e test restano la fonte di verità;
2. [`STATO.md`](../STATO.md) viene aggiornato con il comportamento verificato;
3. questa cartella conserva i requisiti, senza trasformarsi in changelog;
4. il lavoro concreto entra in [`todo.md`](../todo.md), non in una seconda roadmap;
5. le decisioni non ovvie vengono registrate in [`decisions/`](../decisions/README.md).

Le sedute in [`roadmap/`](../roadmap/README.md) sono memoria storica del ragionamento, non priorità operative.