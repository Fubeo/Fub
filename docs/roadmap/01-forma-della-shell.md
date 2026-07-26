# 1. La forma della shell — la precondizione di tutto il resto

Una **seduta** della [roadmap infrastrutturale](../todo.md): dove sta cosa, prima che la superficie cresca.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Sta per prima perché è l'unica cosa che *tutte* le altre presuppongono e
nessuna dichiara. Il capitolo successivo riversa una ventina di nodi nuovi su un
`ui.ts` da 78 righe, il §2.2 cinque superfici su un `main.ts` da 1622, il §18.2
un registro comandi, il §10.3 un centro notifiche: senza un albero dichiarato la
divisione la decide chi tocca il file per ultimo, che è come sono nati i
quattordici file piatti di oggi. La precedenza è dura e sta scritta nel sesto
giro: **§1.1 prima del §2.1**.

Le tre voci sono una seduta sola perché rispondono a *dove sta cosa*: l'albero
(1.1), cosa ci si mette dentro (1.2) e qual è l'unico modulo che ha diritto di
parlare con Tauri (1.3).

### 1.1 La shell non ha un'alberatura, e il §1.2 dice cosa dividere ma non dove

*ex §3.13 · shell · **P1** — precedenza dura: precede il capitolo 2*

- [ ] **Quattordici file piatti in `frontend/src/`**, `main.ts` a 1622 righe con
      81 funzioni di primo livello e 18 variabili globali mutabili. Il §1.2
      chiede «un modulo per dominio» e ha ragione, ma senza un albero dichiarato
      la divisione la decide chi tocca il file per ultimo — che è come sono nate
      le quattordici.
- [ ] **Le voci in arrivo scrivono tutte negli stessi due file**: il §2.1 riversa
      una ventina di nodi su `ui.ts` (78 righe oggi), il §2.8 ci mette accanto un
      riconciliatore, il §2.2 aggiunge cinque superfici a `main.ts`, il §18.2 un
      registro comandi, il §10.3 un centro notifiche. Farlo dopo costa il triplo,
      ed è il §1.2 a dirlo — questa voce gli dà solo la forma.
- [ ] **E due contenitori non esistono affatto**: `style.css` è 950 righe con
      **18** custom property in tutto, cioè nessun sistema di token (6.2 chiede
      temi, snippet CSS, CSS per nota/cartella/tipo; 25.1 alto contrasto e
      reduced motion), e il catalogo stringhe del §12.1 non ha una cartella
      perché non ha ancora una decisione.
- [ ] L'albero da dichiarare adesso, così che ogni voce successiva sappia dove
      atterrare:

```
frontend/src/
  host/      la cucitura Tauri, e nient'altro (§1.3): dialoghi, clipboard,
             finestre, filesystem — nessun altro modulo importa @tauri-apps
  state/     lo store condiviso e il router degli eventi kernel (§1.2)
  ui/        renderer UiNode, riconciliatore e chiavi (§2.8), primitive comuni
  panels/    explorer, search, trash, history, graph (§1.2)
  editor/    editor, livepreview, completions, editor-commands
  rules/     le regole condivise col Rust (§6.2)
  theme/     token, chiaro/scuro/sistema, snippet (6.2, 25.1)
  i18n/      catalogo e t() (dipende dal §12.1)
```

- [ ] **Temi e stringhe hanno bisogno anche di un posto come *dato*** — nel
      vault, nella configurazione utente, o entrambi con una precedenza
      dichiarata. È la stessa domanda a tre livelli del §11.1 e la stessa mappa
      del §15.4: va risposta lì, non inventata da chi scriverà il primo tema.

### 1.2 Smontare il monolite

*ex §3.1 · shell · **P1** — dice **cosa** dividere; il **dove** è la 1.1*

- [ ] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`,
      `graph`, `tabs`) con un piccolo store condiviso e un router di eventi
      kernel: oggi `handleKernelEvent` conosce privatamente ogni pannello.
- [ ] **Un solo modo di montare un pannello**: il view host (`mountDeclaredViews`)
      esiste già ed è generico — cestino, cronologia, ricerca e grafo devono
      passare da lì (o come `ViewProvider`, o almeno come pannelli con la stessa
      interfaccia). Finché convivono due modi, il secondo vince per pigrizia.
- [ ] **Migrare la cronologia del versioning a `ViewProvider`** (dogfooding già
      pianificato): è il caso "view con stato per-documento, input e azioni che
      scrivono" — cioè il collaudo dei nodi del §2.1.
- [ ] **Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).
      Oggi c'è un editor solo e un documento solo: tutto il capitolo 3.3 è
      bloccato da questa mancanza, non dalla UI.
- [ ] **Questa voce dice *cosa* dividere; l'albero delle cartelle è il §1.1**,
      e va dichiarato prima, o la divisione la decide chi tocca il file per
      ultimo — che è come sono nati i quattordici file piatti di oggi.

### 1.3 La cucitura con l'host perde da `main.ts`

*ex §3.11 · shell · **P1** — prerequisito di PWA (26.3), mobile (26.2) e degli e2e*

- [ ] **`api.ts` è l'unica cucitura verso Tauri — tranne `main.ts:2`**, che
      importa `@tauri-apps/plugin-dialog` per le conferme e il file picker.
      Basta una riga perché la shell smetta di essere portabile.
- [ ] **Serve un `host.ts`** (o l'allargamento di `api.ts`) che copra dialoghi,
      notifiche, clipboard, filesystem e finestre: è il prerequisito del PWA
      (26.3), del mobile (26.2) e degli e2e della shell (§17.2), che girano
      contro un host finto. La regola da presidiare con un test è semplice:
      **nessun modulo della shell importa `@tauri-apps` fuori dalla cucitura**
      — la versione UI della dieta dell'IPC del §16.6.
