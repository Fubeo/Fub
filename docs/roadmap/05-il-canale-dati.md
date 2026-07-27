# 5. Il canale dati: chi risponde, e chi instrada

Una **seduta** della [roadmap infrastrutturale](../todo.md): chi risponde a una query, e chi la instrada. La risposta è nella [decisione 0019](../decisions/0019-il-canale-dati.md); qui non resta niente.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Cinque voci su cinque sono chiuse dalla
[decisione 0019](../decisions/0019-il-canale-dati.md), e l'ordine che questo
capitolo dichiarava vincolante è stato rispettato — **5.1 prima di 5.2**, perché
un routing dichiarato messo su un canale in cui sette varianti su nove non
arrivavano a nessuno sarebbe nato per tre quarti inutilizzabile.

Quell'ordine, però, ha retto solo perché le due voci sono state prese **insieme**
alla 5.3, e la seduta esiste per questo. Il motivo si vede in una riga: appena la
query diventa un albero, «quali varianti serve un indice» smette di bastare —
una domanda ha *foglie*, e le foglie hanno proprietari diversi. Il routing che il
§5.2 chiedeva è quindi a due specie (una famiglia ha un padrone, una foglia può
averne più d'uno), e non lo si sarebbe potuto disegnare guardando la 5.2 da sola.

Le precedenze verso l'esterno, per come sono state onorate:

- **La 5.4 andava prima della 16.6**, ed è andata: la dieta dell'IPC può
  cominciare senza dover dire di no a feature che non hanno altra strada.
- **La 5.1 andava con l'8.1**, e ne ha fatta la metà: il canale dati è stato il
  primo sottosistema con un confine (`kernel/src/index/`). L'altra metà — gli
  altri sottosistemi — è arrivata con la
  [decisione 0022](../decisions/0022-il-kernel-a-pezzi.md): `Indexes` è uno dei
  **cinque** proprietari del `Workspace`, accanto a `DocumentStore`,
  `ProviderRegistry`, `Dispatcher` e `Session`.
- **Le faccette** che la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)
  aveva dichiarato fuori portata sono arrivate senza costare niente: il
  sottoinsieme è una query, e i tag li conta chi li ha in cache.
