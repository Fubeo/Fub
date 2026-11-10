# La vista della lavagna

> **Ambito:** come ci si muove sulla lavagna (lo zoom, i salti, Indietro e
> Avanti, Spazio, il bordo, l'inerzia), la griglia e le guide, il navigatore
> e la vista che torna quando la lavagna si riapre.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/engine.ts`
> (`#jumpCamera`, `#paintGrid`), `jumps.ts`, `guides.ts`,
> `chrome/navigator.ts` e `view-state.ts`, con le loro prove;
> i conti della camera in `apps/client/src/editors/spatial/camera.ts`.

Questa pagina viene da [I tasti e i gesti della lavagna](canvas-input.md),
che tiene i tasti, i comandi e i gesti sulle schede, e da
[Le schede della lavagna](canvas-cards.md), che tiene il contratto dei
renderer.

## Muoversi

La vista si sposta e si ingrandisce dal 5% al 400% (`ZOOM_LIMITS`, 0,05–4),
con la rotella, i tasti, il pizzico e la banda di stato. I conti della camera
sono quelli di `spatial/camera.ts` (`zoomAtPoint`, `fit`, `stepCamera`).

- **`+` e `-`** ingrandiscono e riducono a passi di 1,25 (`CANVAS_ZOOM_STEP`,
  il passo del disegno) intorno al centro della vista, o al punto del menu.
- **I salti.** `Maiusc+1` mostra tutte le schede, `Maiusc+2` la selezione
  (senza selezione niente), `0` porta al 100% sul centro della vista. Mostra
  tutto non va oltre il 100% e lascia 80 unità per lato. Il salto vola con
  `stepCamera`; col movimento ridotto (di sistema o delle Impostazioni, letto
  anche a lavagna aperta) arriva subito. Passa tutto da un solo punto
  (`#jumpCamera`), che ricorda il salto per Indietro e Avanti.
- **Indietro e Avanti.** Alt+← e Alt+→ (i comandi della shell
  `shell.pane.back` e `shell.pane.forward`, come le frecce della barra del
  titolo) chiedono prima alla lavagna col fuoco: ricordano i salti (anche il
  link seguito a una scheda della lavagna, «Seguire un link» in
  [canvas-input.md](canvas-input.md)), non lo zoom a passi né lo spostamento
  a mano. La storia (`jumps.ts`) sta in memoria,
  per la lavagna aperta: al più 50 salti, un salto dopo un Indietro perde
  l'Avanti, una lavagna riaperta riparte vuota e due riquadri con la stessa
  lavagna hanno due storie. Con la storia vuota vale la cronologia del riquadro.
  Il volo è quello dei salti, o arriva subito col movimento ridotto.
- **Spazio tenuto** e trascina sposta la vista con qualsiasi strumento, anche
  sopra una scheda e col mouse che scrive; la mano viene dal tema
  (`data-space-pan`). Mentre si scrive in una scheda, o dentro la scheda
  attiva, Spazio è uno spazio; con la penna giù non vale (la penna vince).
- **Il tasto centrale** trascina e sposta, senza scegliere. Ctrl, Cmd e Alt
  con un trascinamento nel vuoto spostano come prima; Alt dal corpo di una
  scheda tira un filo ([I fili](canvas-input.md#i-fili)).
- **Al bordo.** Tirando una scheda, una maniglia o un filo a meno di 40 px dal
  bordo della vista (`EDGE_SCROLL_ZONE`), la vista scorre da sola, più veloce
  più si è vicini, fino a 1,2 px al ms sul bordo e fuori dalla finestra; ciò
  che si tira resta sotto il puntatore. Si ferma al rilascio, con Esc, quando
  il puntatore torna dentro e quando la finestra perde il fuoco.
- **L'inerzia.** Il dito lasciato in corsa fa andare avanti la vista alla sua
  velocità (gli ultimi 100 ms), che rallenta con `stepCamera`; col movimento
  ridotto niente. Il touchpad arriva come rotella, con l'inerzia del sistema
  dove il sistema la dà: la tela non ne aggiunge un'altra. Un appoggio, la rotella, un tasto
  di zoom e la finestra che perde il fuoco fermano l'inerzia e il volo; la
  lavagna chiusa li spegne.

## La griglia e le guide

La griglia aggancia ogni 8 unità della lavagna (`CANVAS_SNAP`, A-23), ma i
suoi punti si vedono ogni 32 (`CANVAS_GRID_DOT_STEPS`), su incroci
dell'aggancio: lo sfondo resta calmo. Sta sotto le schede e segue la vista.
Sotto il 50% di zoom, dove i punti sarebbero più fitti di 16 px, non si
disegna.

- **`canvas.grid`** (Impostazioni) mostra la griglia; è accesa di serie.
- **Ctrl+'** (`canvas.grid_toggle`, lo stesso tasto del disegno) la mostra o
  la nasconde per questa lavagna. La scelta si ricorda con la vista della
  lavagna, come il navigatore, e vale finché non si cambia.
- **`canvas.snap`** (Impostazioni) accende l'aggancio. Spento, una scheda va
  in unità intere, senza griglia e senza guide.
- **Le guide.** Mentre si sposta una scheda, o si tira un angolo di una scheda
  sola, il bordo e il centro della scheda si agganciano ai bordi e ai centri
  delle altre schede in vista, entro 6 px sullo schermo. Spostando più schede
  insieme conta il riquadro di tutte. Contano solo le schede in vista, anche
  con duemila schede sulla lavagna.
- **Spazi uguali.** Tre schede in fila (sovrapposte sull'altro asse): la scheda
  che si muove si mette dopo, prima o in mezzo, con due spazi uguali a quello
  fra le altre due; due trattini chiudono lo spazio.
- **Precedenza.** Su ogni asse vince la guida più vicina; a parità, il bordo o
  il centro prima dello spazio. Dove una guida vince, la griglia non si applica
  su quell'asse; sull'altro, sì.
- **Come si vedono.** Le guide sono linee sottili dell'accento sopra le schede,
  in un solo elemento (`.canvas-guides`) che non prende il puntatore. Spariscono
  al rilascio e con `Esc`.
- **Alt** tenuto mentre si sposta o si tira spegne l'aggancio per quel gesto:
  niente guide e niente griglia, la scheda va dove la porta il puntatore. Premuto
  sul corpo di una scheda, Alt tira invece un filo ([I fili](canvas-input.md#i-fili)).

Spostare e ridimensionare restano un commit e un annulla, come prima.

## Il navigatore

In basso a destra della vista, 168 × 120 px: la mappa dei gruppi (il filo) e
delle schede (piene, del loro colore, `--canvas-color` come i fili) col
riquadro di ciò che si vede (`chrome/navigator.ts`). L'inquadratura è
`navigatorBox` del disegno: la lavagna e la vista, con un margine; una scheda
lontanissima ci sta.

- **Un clic** porta il centro della vista lì: è un salto (`#jumpCamera`), che
  vola come `Maiusc+1`, o arriva subito col movimento ridotto, e Indietro lo
  ricorda.
- **Trascinare** sposta la vista sotto la mano, subito, senza volo; preso
  dentro il riquadro, il riquadro non salta. È un gesto: le schede vive, la
  banda e la mappa si rifanno al rilascio.
- **Sparisce da solo** quando tutta la lavagna sta già nella vista, e su una
  lavagna vuota. «Nascondi il navigatore» (`canvas.navigator.hide`, nel
  gruppo Vista del catalogo e nel menu del vuoto) lo spegne per questa
  lavagna, ricordato nella vista (`"navigator": false`, [Riaprire dove
  eri](#riaprire-dove-eri)); «Mostra il navigatore»
  (`canvas.navigator.show`) lo riaccende. C'è sempre una sola delle due.
- **La tastiera.** F6 dalla lavagna ci arriva (`EditorSurface.zone`: la
  vista, poi il navigatore se si vede); le frecce spostano il riquadro di un
  decimo della vista, con Maiusc di metà.
- **Il disegno.** Una sola `<canvas>`, mai un elemento per scheda; si
  ridipinge a fine gesto e al cambio del documento, se la lavagna o la vista
  sono cambiate. I colori sono variabili della pelle
  (`--canvas-navigator-card`, `-group`, `-view`, `-view-fill`), lette una
  volta per disegno.

## Riaprire dove eri

Riaprendo una lavagna tornano la vista di prima, le schede scelte e la
pagina di ogni scheda PDF. Le ricorda Fub su questo computer, negli stati di
vista; il file `.canvas` non cambia (niente `fub:page`, nessun campo nuovo).
Il codice sta in `view-state.ts`; la tela lo usa se ha l'opzione
`viewMemory` e un `documentId`, e la superficie della shell (`surface.ts`)
gliela dà sopra `api.viewState` e `api.setViewState`, una sola per tutte le
lavagne.

Lo stato sta nella chiave `canvas.view:<documentId>`:

```json
{ "version": 1, "camera": { "x": 0, "y": 0, "zoom": 1 },
  "selection": ["id"], "pages": { "id": 3 }, "navigator": false }
```

- Al più 500 schede scelte (le prime della scelta) e 1000 pagine (le più
  recenti). Le schede scelte sono solo schede: i fili scelti non si
  ricordano.
- Una `version` diversa da 1 è di un'altra versione: la lavagna parte come
  se lo stato non ci fosse e non lo riscrive mai. Uno stato rotto (non un
  oggetto, senza `version`) vale nessuno stato, e la prima scrittura lo
  sostituisce. Dentro la versione 1 un campo che non si legge vale vuoto, e
  i campi in più (la griglia, il tema per scheda) si conservano a ogni
  riscrittura. `"navigator": false` c'è solo col navigatore nascosto.
- **All'apertura** (`setDoc`) la tela inquadra tutto come prima, poi legge
  lo stato: la camera ricordata vale se almeno una scheda cade nella vista
  che dava, sennò resta «inquadra tutto»; la scelta torna con le sole schede
  che ci sono ancora. Arriva solo ciò che nessuno ha cambiato nel frattempo:
  una vista già spostata, o una scelta già fatta, restano. Le schede PDF
  già montate su un'altra pagina si rimontano sulla loro.
- **La pagina di una scheda PDF** è quella ricordata (`initialPage`), sennò
  il `#page=N` del `subpath`, sennò la prima; una pagina ricordata oltre la
  fine del file vale la prima. La scheda dice ogni pagina voltata con
  `pageChanged`, anche quando corregge da sé una pagina che non c'è più.
  Una scheda tolta e rimessa ha un id nuovo, e parte dalla prima.
- **La scrittura** aspetta 500 ms dopo l'ultimo cambio della camera, della
  scelta o di una pagina; alla chiusura della tela, e prima di un nuovo
  `setDoc`, parte subito. Prima che la lettura sia arrivata non si scrive
  niente, e dopo la chiusura nessuna scrittura parte più. Lo stesso stato
  non si riscrive. Le letture e le scritture di una lavagna vanno in fila:
  la lavagna riaperta legge dopo l'ultima scrittura di quella chiusa. Due
  finestre sulla stessa lavagna: vince l'ultima scrittura.
- Una scrittura che non riesce lascia una riga nel registro e la lavagna va
  avanti. Una lettura che non riesce fa partire la lavagna come prima, e
  quella lavagna non scrive (non si sa che cosa coprirebbe).
- La shell non porta gli stati di vista con il nome: una lavagna rinominata
  riparte dalla vista intera.
