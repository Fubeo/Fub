# Capitolato delle funzionalità

Questa cartella descrive ciò che Fub deve saper fare dal punto di vista del
prodotto. È un **capitolato**, non una roadmap e non un report automatico sul
codice.

## Come leggere i file

- Ogni documento raccoglie una famiglia coerente di capacità.
- Le caselle `[ ]` rappresentano requisiti, comportamenti o criteri da coprire.
- Una casella non spuntata non dimostra, da sola, che il comportamento manchi nel codice.
- Una casella spuntata non sostituisce test, documentazione tecnica o stato di milestone.

Per conoscere lo stato reale usare:

- [`../FEATURES.md`](../FEATURES.md) per la sintesi del prodotto;
- [`../PIANO.md`](../PIANO.md) per milestone e priorità;
- [`../todo.md`](../todo.md) per il lavoro ancora aperto.

## Ordine di lettura

Si parte da [`01-principi-fondanti.md`](01-principi-fondanti.md), poi si apre il
documento della famiglia interessata. Non è necessario leggere il catalogo in
sequenza per contribuire a un singolo componente.

Quando un requisito diventa lavoro concreto, non si aggiunge una seconda
roadmap qui: si collega il requisito al piano o al backlog. Quando viene presa
una decisione architetturale, il suo perché va in un ADR.
