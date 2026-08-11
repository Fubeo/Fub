# 5. Il canale dati: chi risponde, e chi instrada

Questa **seduta** (incontro di pianificazione) della [roadmap infrastrutturale](../todo.md) stabilisce i ruoli di risposta e instradamento delle query (richieste di dati). La soluzione risiede nella [decisione 0019](../decisions/0019-il-canale-dati.md). Il documento è svuotato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La [decisione 0019](../decisions/0019-il-canale-dati.md) chiude cinque voci su cinque. L'ordine vincolante è rispettato.

**Sequenza eseguita**:
- **5.1 prima di 5.2**.

**Motivazione**:
- Un routing (instradamento) dichiarato richiede canali funzionanti.
- La dispersione di sette varianti su nove rende il sistema difettoso per tre quarti.

L'ordine funziona unendo le due voci **insieme** alla 5.3. La seduta esiste per questo scopo. Il motivo emerge in una riga.

**Evoluzione in albero delle query**:
- La determinazione degli indici per le varianti risulta insufficiente.
- Una domanda ha *foglie* (nodi terminali).
- Le foglie appartengono a proprietari diversi.

**Tipologie di routing richieste dal §5.2**:
Il routing necessita di due specie:
- Una **famiglia**: ha un padrone.
- Una **foglia**: possiede più d'uno.

L'analisi isolata della 5.2 precludeva il disegno del sistema.

**Precedenze verso l'esterno onorate**:

| Precedenza | Stato | Dettagli |
|---|---|---|
| **La 5.4 andava prima della 16.6** | Completata | La dieta (riduzione) dell'IPC (Inter-Process Communication) procede accogliendo le feature con percorsi vincolati. |
| **La 5.1 andava con l'8.1** | Completata a metà | Il canale dati (sistema di trasmissione) è il primo sottosistema con un confine (`kernel/src/index/`). |
| **L'altra metà dei sottosistemi** | Introdotta | La [decisione 0022](../decisions/0022-il-kernel-a-pezzi.md) rende `Indexes` uno dei **cinque** proprietari del `Workspace`, accanto a `DocumentStore`, `ProviderRegistry`, `Dispatcher` e `Session`. |
| **Le faccette** (categorie di filtri per la ricerca) | Implementate | La [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) le considerava irraggiungibili. L'implementazione avviene gratuitamente. Il sottoinsieme costituisce una query. I possessori della cache contano i tag. |
