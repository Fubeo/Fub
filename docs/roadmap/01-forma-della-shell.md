# 1. La forma della shell — la precondizione di tutto il resto

Una **seduta** della [roadmap infrastrutturale](../todo.md): dove sta cosa, prima che la superficie cresca.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Stava per prima perché è l'unica cosa che *tutte* le altre presuppongono e
nessuna dichiara. La precedenza dura del sesto giro — **§1.1 prima del §2.1** —
è **soddisfatta**: l'albero è dichiarato e abitato, e la seduta 2 ha dove
atterrare.

Le tre voci rispondevano a *dove sta cosa*: l'albero (1.1), cosa ci si mette
dentro (1.2) e qual è l'unico modulo che ha diritto di parlare con Tauri (1.3).
La prima e la terza sono chiuse con la [decisione 0015](../decisions/0015-la-forma-della-shell.md);
la mappa dell'albero — quella da consultare scrivendo un file nuovo — sta in
[architecture/shell.md](../architecture/shell.md).

Resta la seconda, e resta per una ragione che vale la pena tenere scritta:
**ciò che ne manca dipende da altre sedute**, non dal tempo.

### 1.2 Smontare il monolite

*ex §3.1 · shell · **P1** — il resto dipende dalla seduta 2 e da FEATURES 3.3*

- [x] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`,
      `graph`) con un piccolo store condiviso e un router di eventi kernel:
      `handleKernelEvent` conosceva privatamente ogni pannello, e ora chi ha
      interesse dichiara l'evento che lo riguarda. `main.ts` è passato da 1622 a
      137 righe (decisione 0015).
- [ ] **Un solo modo di montare un pannello**: il view host
      (`mountDeclaredViews`) esiste già ed è generico — cestino, cronologia,
      ricerca e grafo devono passare da lì (o come `ViewProvider`, o almeno come
      pannelli con la stessa interfaccia). Finché convivono due modi, il secondo
      vince per pigrizia.
      **Bloccata dalla seduta 2**: il protocollo dichiarativo non ha i nodi di
      input del [§2.1](02-cosa-e-una-view.md#21-uinode--senza-input-metà-di-features-non-è-dichiarativa)
      né un modo di dire "sto caricando" ([§2.5](02-cosa-e-una-view.md#25-una-view-non-può-chiedere-di-essere-ridisegnata-né-dire-sto-caricando)).
      Il grafo è invece un'eccezione **decisa**: superficie privilegiata fuori
      da `UiNode`, per il piano M2.
- [ ] **Migrare la cronologia del versioning a `ViewProvider`** (dogfooding già
      pianificato): è il caso "view con stato per-documento, input e azioni che
      scrivono" — cioè il collaudo dei nodi del §2.1.
      Ed è proprio per questo che **va dopo** il §2.1 e non prima: migrarla oggi
      darebbe una view che sa mostrare la lista e non sa offrire il bottone
      «Ripristina» se non come `list_item` cliccabile, cioè il protocollo
      collaudato su un caso ammorbidito per farlo passare.
- [ ] **Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).
      Oggi c'è un editor solo e un documento solo: tutto il capitolo 3.3 è
      bloccato da questa mancanza, non dalla UI.
      **Non è un refactor, è una feature**, e va decisa insieme a `PaneId` e alle
      sessioni multiple ([§9.6](09-il-lavoro-lungo-e-lo-spegnimento.md#96-sessioni-multiple)).
      Ciò che è già pronto: il contesto di sessione pubblicato porta l'identità
      del pannello, quindi il giorno che i pannelli saranno due nessuno dovrà
      inventarsi da dove viene la risposta.
