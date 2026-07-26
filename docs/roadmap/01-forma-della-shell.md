# 1. La forma della shell — la precondizione di tutto il resto

Una **seduta** della [roadmap infrastrutturale](../todo.md): dove sta cosa, prima che la superficie cresca.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Stava per prima perché è l'unica cosa che *tutte* le altre presuppongono e
nessuna dichiara. La precedenza dura del sesto giro — **la forma della shell
prima dei nodi di `UiNode`** — è stata rispettata: l'albero era dichiarato e
abitato quando la seduta 2 è arrivata, e le venticinque specie di nodo nuove
hanno trovato un file dove atterrare invece di un `main.ts` da 1622 righe.

Le tre voci rispondevano a *dove sta cosa*: l'albero (1.1), cosa ci si mette
dentro (1.2) e qual è l'unico modulo che ha diritto di parlare con Tauri (1.3).
La prima e la terza sono chiuse con la [decisione 0015](../decisions/0015-la-forma-della-shell.md);
la mappa dell'albero — quella da consultare scrivendo un file nuovo — sta in
[architecture/shell.md](../architecture/shell.md).

**Non resta niente da decidere.** Della seconda voce restano due punti di
esecuzione — migrare cestino e cronologia a `ViewProvider`, e il modello di
layout — e sono **shell**: stanno nella
[§1.2 in coda alla seduta 18](18-editor-e-tastiera.md#12-smontare-il-monolite),
dove verranno fatti, insieme alle altre tre code delle sedute chiuse. Il numero
resta il suo: si trasferisce, non si rinomina.

Il modello di layout è ciò che sblocca il grafo nell'area principale
([§3.3](18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell)),
ed è anche l'unico dei due che non è un refactor ma una **feature** (FEATURES
3.3): la sua metà kernel va decisa con `PaneId` e le sessioni multiple
([§9.6](09-il-lavoro-lungo-e-lo-spegnimento.md#96-sessioni-multiple)).
