# La vista della lavagna

> **Ambito:** come ci si muove sulla lavagna (lo zoom, i salti, Indietro e
> Avanti, Spazio, il bordo, l'inerzia), la griglia e le guide, il navigatore
> e la vista che torna quando la lavagna si riapre; il menu radiale e i gesti
> delle dita; come si vedono le schede da lontano; Cerca nella lavagna; la
> lavagna da tastiera e col lettore di schermo; «Apri a lato per questo»;
> lo spazio di lavoro (Completo e Semplice) e l'interfaccia nascosta.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/engine.ts`
> (`#jumpCamera`, `#paintGrid`, `#refreshDetail`, `#keydown`), `jumps.ts`, `guides.ts`,
> `chrome/navigator.ts`, `chrome/radial.ts`, `view-state.ts`, `lod.ts`, `find.ts`,
> `chrome/find-bar.ts`, `chrome/workspace.ts` e `a11y.ts`, con le loro prove;
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
  titolo; col fuoco su una scheda Alt+← e Alt+→ vanno invece alla scheda
  vicina, sotto) chiedono prima alla lavagna col fuoco: ricordano i salti (anche il
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
- **Spazio toccato** (giù e su entro 0,3 s, `READER_TAP_MS`, dal primo tasto
  giù e non dalla ripetizione del sistema, col puntatore fermo entro 3 px e
  senza premere) con una sola scheda di nota scelta apre il lettore
  ([Il lettore](canvas-parts.md#il-lettore)). Lo spostamento non aspetta il
  tocco: la vista si muove subito, e un tocco si riconosce solo al rilascio.
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

## Il menu radiale e i gesti

Il menu radiale della lavagna è quello del disegno (`openRadial` di
`editors/spatial/tools/radial.ts`, con l'aspetto, i tasti e il bordo della
finestra di
[Disegni, vista, gesti e menu radiale](../product/drawing-view.md#il-menu-radiale)),
con le voci di `chrome/radial.ts`: Annulla in alto e Ripeti in basso; a
destra gli ultimi tre strumenti, il più recente a est, poi nord-est e
sud-est; a sinistra, allo stesso modo, gli ultimi tre colori della penna.
Nel mezzo lo strumento di adesso col colore della penna, che non si ripete
fra le voci. I recenti sono della seduta, in memoria finché la lavagna è
aperta; con meno di tre il menu si riempie con Testo, Selezione,
Evidenziatore… e con Vermiglio, Verde, Blu, Nero. Le voci sono i comandi del
catalogo, col nome, il tasto e se si può; in sola lettura Annulla e Ripeti
sono spenti.

- **Il tasto laterale della penna** fa ciò che dice «Il tasto della penna»
  (`canvas.pen_button`, letto a ogni appoggio): `radial` (di serie) apre il
  menu dove si appoggia, e la penna che lascia il tasto sopra una voce la
  sceglie; `eraser` cancella come il retro della penna; `pan` sposta la
  lavagna; `lasso` fa un giro che sceglie come il Lazo, e lo strumento di
  prima resta. Il tasto che non cancella non scrive e non cancella
  (`barrelErases` dello strato della penna, `ink-layer.ts`); vale anche in
  sola lettura.
- **Il tocco lungo** di un dito fermo per 500 ms (`LONG_PRESS_MS`, entro
  8 px) apre il menu radiale nel vuoto, e sopra una scheda il menu della
  scheda nel punto del dito. Un secondo dito, la penna giù o la mano
  appoggiata lo fermano.
- **Due dita** che toccano senza muoversi, giù e su entro 250 ms
  (`FINGERS_TAP_MS`), annullano; **tre** ripetono. Se non c'è niente, la
  regione `status` nascosta `.canvas-gesture-said` lo dice («Niente da
  annullare.»). Due dita che si muovono sono il pizzico e non annullano.
- **Il doppio tocco** di un dito nel vuoto (entro 300 ms e 24 px) mette lì
  una scheda di testo già in scrittura, come il doppio clic; sopra una
  scheda, un filo o un controllo no.
- **Dalla tastiera** «Menu radiale» (`canvas.radial`, in fondo al menu del
  tasto destro nel vuoto: `Maiusc+F10`) lo apre al centro della vista, col
  fuoco sulla prima voce; col mouse nel punto del clic.

Il clic destro che il sistema manda dopo il tasto laterale o dopo il tocco
lungo non apre un secondo menu. Un documento nuovo e la lavagna chiusa
chiudono il menu.

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
  Nello spazio Semplice è chiuso di serie, e con `Ctrl+.` sparisce con il
  resto dell'interfaccia ([lo spazio di lavoro](#lo-spazio-di-lavoro)).
- **La tastiera.** F6 dalla lavagna ci arriva (`EditorSurface.zone`: la
  vista, poi il navigatore se si vede, poi la colonna e la riga); le frecce spostano il riquadro di un
  decimo della vista, con Maiusc di metà.
- **Il disegno.** Una sola `<canvas>`, mai un elemento per scheda; si
  ridipinge a fine gesto e al cambio del documento, se la lavagna o la vista
  sono cambiate. I colori sono variabili della pelle
  (`--canvas-navigator-card`, `-group`, `-view`, `-view-fill`), lette una
  volta per disegno.

## Lo spazio di lavoro

`canvas.workspace` (`chrome/workspace.ts`) sceglie fra due spazi, scritti
sulla superficie come `data-workspace`:

- **`auto`** (di serie) è Semplice solo su un dispositivo che ha soltanto il
  tocco (le media query `any-pointer`: nessun puntatore fine), Completo
  altrimenti: un portatile col tocco e il mouse resta Completo. Un mouse che
  si attacca o si stacca cambia lo spazio dal vivo; la larghezza della
  finestra non conta (una finestra stretta resta Completa). **`full`** e
  **`simple`** lo fissano. Un cambio dell'impostazione, anche da un'altra
  finestra, vale subito nelle lavagne aperte.
- **Semplice:** la colonna ha sei strumenti (Selezione, Mano, Penna,
  Evidenziatore, Gomma, Testo), ognuno nella sua casella senza tendine, da
  44 px (`data-size="large"` del kit); il Lazo e Collega restano nei tasti, in
  `Ctrl+/` e nel menu radiale, e `canvas.toolbar`
  ([la colonna](canvas-input.md#la-colonna-degli-strumenti)) vale solo nel
  Completo. Con Penna, Evidenziatore e Gomma la riga delle opzioni ha solo il
  menu della penna, senza la Vista; i pulsanti della riga e della barra della selezione
  sono da 44 px. Il navigatore è chiuso: «Mostra il navigatore» lo apre per
  questa apertura, senza toccare la scelta ricordata nella vista. In fondo
  alla colonna «Completo» porta allo spazio Completo e scrive `full`.
- **Senza interfaccia:** `Ctrl+.` (`canvas.bare`, lo stesso tasto del disegno)
  toglie la testata, la barra di N4, la colonna, la barra della selezione e
  il navigatore (`data-bare`), e li riporta, in tutti e due gli spazi. Vale
  da ogni punto della lavagna; mentre si scrive in una scheda il tasto va
  prima all'editor, e alla lavagna solo se l'editor non lo usa. Il fuoco dentro ciò
  che sparisce torna alla lavagna, e F6 salta ciò che non si vede.

L'ispettore è della shell: la lavagna non lo apre mai da sé, in nessuno spazio.

## Da lontano

Da lontano la lavagna si legge ancora (`lod.ts`, N6 T54). `detailLevel(zoom)`
dà il livello, con le soglie incluse nel livello di sopra:

| Zoom | Livello | Che cosa si vede |
| --- | --- | --- |
| da `FAR_ZOOM_MAX` (= `LIVE_ZOOM_MIN`, 0,35) in su | `live` | la scheda com'è; le vive le sceglie `liveCardIds` |
| da `BLOCK_ZOOM_MAX` (0,15) a 0,35 | `far` | una scheda vista da vicino in questa seduta mostra l'ultima immagine ferma (`still`); le altre, testi e gruppi compresi, il titolo grande |
| sotto 0,15 | `block` | un blocco del colore della scheda (il grigio senza colore) col titolo su una riga |

La tela scrive il risultato in `data-card-detail` sul nodo (`still`, `far`,
`block`; niente da vicino) quando sceglie le schede vive
([Quando la tela cambia il modo](canvas-cards.md#quando-la-tela-cambia-il-modo)):
a fine gesto, dopo una resa, al cambio di misura, mai durante un gesto. Un
solo giro sulle schede (`applyCardDetails`), che tocca il DOM solo dove
l'attributo cambia; la tela tiene l'attributo di ogni scheda e non rilegge
il DOM. «Vista da vicino» vuol dire che la sua vista è stata viva da quando
la tela c'è; perdere la vista (la scheda tolta, il file cambiato) lo
dimentica. La scheda attiva, quella in cui si entra, quella che scrive e
quella col campo aperto restano come da vicino a ogni livello.

Il titolo grande (`.canvas-node-far`, `farTitle`) è sempre nel nodo,
nascosto finché il livello non lo mostra: il nome del file senza cartella
(con la sezione, se la scheda ne mostra una), l'indirizzo senza schema, il
nome di un testo (`textCardName`, in `card-name.ts`), il nome del gruppo.
Il nome di un testo è la sua prima riga non vuota senza i segni del
Markdown: il titolo `#`, la citazione `>`, l'elenco e la casella davanti;
in linea il grassetto, il corsivo, il barrato, l'evidenziato, il codice, i
link e i wikilink (`[[nota|alias]]` dice `alias`). Le parole restano come
sono: `snake_case`, `2*3*4` e un `*` da solo non cambiano. La stessa regola dà il nome
nella testata del menu, nell'avviso del Lazo, nell'etichetta della penna e
nell'ispettore. Si taglia coi puntini (tre righe al più in `far`, una nel blocco). La sua
misura sullo schermo non cambia con lo zoom: la pelle divide per
`--canvas-detail-zoom`, che la tela scrive sulla scena insieme agli
attributi, quindi anche lei solo a fine gesto; durante un gesto il titolo
scala con la lavagna e niente si rimpagina. Da lontano la testata, le
maniglie e le prese non ci sono; l'inchiostro della scheda sta dopo il
titolo nel nodo e resta disegnato a ogni livello. Con l'alto contrasto i
blocchi hanno un bordo.

## Cercare

Ctrl+F (il comando `shell.doc.search`, che chiede prima `find()` alla
superficie col fuoco) apre la barra «Cerca nella lavagna» in alto a destra
della vista (`chrome/find-bar.ts`, N6 T60): il campo, il contatore
(«3 di 12», «Nessun risultato»), ‹ ›, la ×. Nel Sorgente cerca la shell.

- **Dove cerca.** Nel file della lavagna (`find.ts`): il testo intero delle
  schede di testo, l'etichetta dei gruppi e dei fili, il nome dei file (non la
  cartella), l'indirizzo delle schede di link. Nel contenuto delle note: una
  richiesta `documents` all'indice con `searchExpression` (la sintassi della
  ricerca del vault) e il predicato `docs` delle sole note della lavagna, una
  per ricerca, 200 ms dopo l'ultimo tasto (`FIND_NOTES_DELAY_MS`), senza
  estratti; una risposta di una ricerca vecchia, o arrivata a barra chiusa, si
  scarta. Una lavagna senza note non chiede niente. Se la richiesta fallisce
  (il vault senza indice) i risultati sono quelli del file, e la barra dice
  «Solo la lavagna, non le note».
- **Maiuscole e accenti** come la ricerca del vault: le maiuscole non contano,
  gli accenti sì, NFC e NFD sono uguali (`resolutionKey`).
- **I risultati** sono schede e fili, ognuno una volta, in ordine di lettura
  (`readingOrder`); un filo viene dopo la scheda da cui parte. Il file si
  legge una volta per documento (`boardFindIndex`): un tasto è un `includes`
  per scheda. Le note trovate restano finché non si cerca di nuovo (anche se
  la nota cambia); le schede del file si rileggono a ogni modifica.
- **Il velo.** Con una ricerca scritta, le schede che non c'entrano hanno
  `data-card-veiled` (velate, senza puntatore), quelle trovate
  `data-card-found` (`current` per il risultato del contatore, `match` le
  altre); i due capi di un filo trovato restano liberi. Un solo giro sulle
  schede che scrive solo dove il segno cambia (`applyFindMarks`), come
  `applyCardDetails`; convive con `data-card-detail`, e da lontano l'anello
  resta della stessa misura sullo schermo. La ricerca vuota non vela niente.
- **Invio** porta la vista al risultato del contatore, poi al seguente (e
  gira); **Maiusc+Invio** al precedente; ‹ e › lo stesso. Scrivere non muove
  la vista. Ogni risultato è un salto (`#jumpCamera`): le sue schede al
  centro con lo zoom di adesso, o più lontano se non ci stanno; col movimento
  ridotto senza volo; Indietro torna da dove si era partiti.
- **Esc** e la × chiudono: il velo se ne va, la vista resta dov'è arrivata e
  il fuoco torna alla lavagna. Riaperta, la barra rifà la ricerca di prima.

## Da tastiera e col lettore di schermo

Le regole pure stanno in `a11y.ts`; il motore le chiama da `#keydown` e
scrive i nomi sulle schede.

- **Tab e Maiusc+Tab**, col fuoco sulla lavagna o su una scheda, vanno alla
  scheda dopo o prima nell'ordine di lettura dell'ispettore (`readingOrder`):
  il fuoco e la scelta la seguono e, se non è tutta in vista, la vista vola
  fino a metterla al centro col zoom di adesso (col movimento ridotto arriva
  subito). Non è un salto: Indietro non ci torna. Dalla lavagna Tab va alla
  scheda scelta o alla prima, e Maiusc+Tab esce come sempre; prima della
  prima scheda si torna alla lavagna, dopo l'ultima il fuoco esce dalla vista.
  Dentro una scheda attiva o in un campo il Tab è loro (Esc prima); senza
  schede va ai pulsanti della lavagna vuota.
- **Alt+frecce** vanno alla scheda più vicina da quella parte: il centro
  più vicino dentro un cono di 90°, a pari distanza la prima in ordine di
  lettura; se non c'è niente lo dice la regione viva. Alt+↑ e Alt+↓ valgono
  anche dalla lavagna (senza scheda scelta, la prima in ordine di lettura);
  Alt+← e Alt+→ solo col fuoco su una scheda, e il tasto non arriva alla
  shell: sulla lavagna senza una scheda a fuoco, e fuori, restano Indietro e
  Avanti dello Scrittoio. Le frecce da sole spostano di 8,
  con Maiusc di 32 e con Alt+Maiusc di 1 (`canvas.nudge.<lato>.fine`).
- **F6 e Maiusc+F6** (`EditorSurface.zone`): la lavagna, il navigatore se si
  vede, la colonna degli strumenti, la riga delle opzioni; poi la shell passa
  all'ispettore. **Maiusc+F10** apre il menu della scheda scelta.
- **Il nome di una scheda** (`cardLabel`, l'`aria-label` del nodo) dice la
  specie e il nome come la testata del menu, il gruppo che la contiene più da
  vicino, le schede collegate con l'etichetta del filo e il colore: «Scheda di
  nota Varianza, nel gruppo Media e varianza, collegata a 2 schede: Media
  aritmetica, vedi; istogramma, si vede qui.» Più fili verso la stessa scheda
  la contano una volta; oltre 6 schede dice solo «collegata a 200 schede» e
  l'elenco sta nell'ispettore. I nomi si riscrivono solo quando cambia il
  documento o la lingua, a thread libero, 250 schede per passo, e solo dove il
  testo cambia; la scheda che prende il fuoco ha subito il suo.
- **La regione viva** della tela (quella di «Niente da annullare.») dice ciò
  che un commit ha cambiato: «Hai tolto dalla lavagna: …», «Hai collegato … a
  …», «Hai spostato: …» (una frase, in quest'ordine), o quante schede. Testo,
  colore e misura non si annunciano.

## Apri a lato per questo

Ciò che una scheda non fa (righe e colonne di un foglio, un documento Word,
la nota intera) si fa nell'editor del file, aperto accanto allo stesso punto:
`canvas.open_beside_here` (`#besideHere` in `engine.ts`). Vale per la scheda
di file attiva, anche in sola lettura (aprire è guardare); senza, è spento
col perché. Il punto, e il nome che lo dice:

| Dove si è | Il percorso | Il nome |
|---|---|---|
| una cella che si scrive (il contesto della scheda, T42) | `/Conti/voti.xlsx#B3` | «Apri a lato su B3» |
| un PDF (la pagina che mostra, `CardView.page`) | `/Libri/manuale.pdf#page=3` | «Apri a lato alla pagina 3» |
| una scheda di nota con una sezione (il suo `subpath`) | `/Note/Fisica.md#Scopo` | «Apri a lato su «Scopo»» |
| altrove | il file col `subpath` della scheda | «Apri a lato per questo» |

Il percorso va a `onOpenPathBeside`, come «Apri a lato» del menu della
scheda (`openPathBeside` in `state/document-controller.ts`): la shell lo
risolve come un link (`resolvedReference`); `#page=N` di un PDF arriva alla
pagina, un punto che la risoluzione porta si rivela (`reveal`), e un altro
frammento apre il file in cima con l'avviso «Questa vista di … non sa portare
a quel punto.». È il caso della cella: la griglia non riceve un punto da un
link. Se il riquadro vicino, quello che la divisione metterebbe
a destra, mostra già il file, si torna lì invece di dividere
(`openDocumentBeside` con `reuse`; un `fub://open` divide sempre). Nella
finestra stretta (`data-narrow`) va invece a `onOpenPath`, nello stesso
riquadro come «Apri», e il nome lo dice: «Apri qui su B3», «Apri qui per
questo».
Il comando sta in `Ctrl+/`, in testa al menu del tasto destro dato dentro il
contenuto della scheda attiva (una cella, la nota che si scrive, la pagina;
sulla testata resta il menu della scheda) e nella riga delle opzioni, un
pulsante col nome scritto (`[data-option="beside"]`) dopo la barra di chi
scrive o prima della Vista. Il nome segue la cella e la pagina.

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
