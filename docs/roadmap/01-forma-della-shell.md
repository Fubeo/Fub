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

Resta la seconda, e ne resta sempre meno. Dei suoi quattro punti **tre sono
fatti**: l'albero dei moduli, il modo unico di montare un pannello, e — con la
[decisione 0016](../decisions/0016-cosa-e-una-view.md) — il protocollo di
disegno che la seduta 2 le bloccava. Il quarto, il modello di layout, non
aspetta un'altra seduta: è una **feature** (FEATURES 3.3) e va decisa con
`PaneId` e le sessioni multiple.

### 1.2 Smontare il monolite

*ex §3.1 · shell · **P1** — il resto dipende dalla seduta 2 e da FEATURES 3.3*

- [x] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`,
      `graph`) con un piccolo store condiviso e un router di eventi kernel:
      `handleKernelEvent` conosceva privatamente ogni pannello, e ora chi ha
      interesse dichiara l'evento che lo riguarda. `main.ts` è passato da 1622 a
      137 righe (decisione 0015).
- [x] **Un solo modo di montare un pannello**: fatto, per la metà che non
      dipendeva dalla seduta 2 — cioè l'**interfaccia**, non il protocollo di
      disegno. Il registro sta in `ui/panel-host.ts`: un pannello dichiara chi
      è, dove sta, cosa lo fa invecchiare (`refresh`, `followsDoc`) e quando è
      visibile; l'host decide quando chiamarlo. Explorer, ricerca, cestino,
      cronologia e grafo passano da lì insieme alle view dichiarate, di cui
      `ui/views.ts` è ora solo l'adattatore `ViewSpec`→`Panel`. Ciò che il
      secondo modo costava era già misurabile: la terna
      `index_updated`/`batch_ended`/`overflow` copiata in tre pannelli, e
      `overflow` che ora si tratta in un posto solo perché non è un fatto del
      dominio ma la coda troncata. La mappa è la regola 5 di
      [architecture/shell.md](../architecture/shell.md).
- [ ] **Migrare cestino e cronologia a `ViewProvider`** (dogfooding già
      pianificato): la cronologia è il caso "view con stato per-documento,
      input e azioni che scrivono". Era **bloccata dalla seduta 2**, e non lo è
      più: la [decisione 0016](../decisions/0016-cosa-e-una-view.md) le dà i nodi
      di input, lo stato su `on_action`, il «sto caricando» e il riconciliatore
      che rende usabile un campo di testo. Migrarla prima avrebbe dato una view
      che sa mostrare la lista e non sa offrire il bottone «Ripristina» se non
      come `list_item` cliccabile — cioè il protocollo collaudato su un caso
      ammorbidito per farlo passare. Ora il caso non è più ammorbidito, e resta
      solo da farlo. Il grafo non è in attesa: è un'eccezione **decisa** —
      superficie privilegiata fuori da `UiNode`, per il piano M2 — e sta nel
      registro come `overlay`; il giorno che rientrerà nel protocollo sarà come
      `UiKind::Custom` sull'area principale, che ora esistono tutti e due.
- [ ] **Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).
      Oggi c'è un editor solo e un documento solo: tutto il capitolo 3.3 è
      bloccato da questa mancanza, non dalla UI.
      **Non è un refactor, è una feature**, e va decisa insieme a `PaneId` e alle
      sessioni multiple ([§9.6](09-il-lavoro-lungo-e-lo-spegnimento.md#96-sessioni-multiple)).
      Ciò che è già pronto: il contesto di sessione pubblicato porta l'identità
      del pannello, quindi il giorno che i pannelli saranno due nessuno dovrà
      inventarsi da dove viene la risposta.
