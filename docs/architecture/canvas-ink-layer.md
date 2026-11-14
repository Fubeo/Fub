# L'inchiostro sulla lavagna

> **Ambito:** come la lavagna (`.canvas`) usa il nucleo dell'inchiostro: lo
> strato che porta la penna sul viewport, chi ferma gli eventi, e come il
> motore della lavagna decide la scheda e scrive il tratto finito.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/ink-layer.ts`,
> `apps/client/src/editors/canvas/engine.ts` e le loro prove.

Il nucleo, gli strumenti, l'adattatore del browser e l'uso in FubDraw stanno in
[Inchiostro e strumenti](ink-and-tools.md); il formato del tratto sulla
lavagna in [reference/canvas-ink.md](../reference/canvas-ink.md).

## Lo strato della lavagna

`editors/canvas/ink-layer.ts` (`mountInkLayer`) porta la penna sulla lavagna
(`.canvas`). Attacca `attachInkInput` al viewport con il dito `navigate` e il
mouse `ignore`: i loro eventi restano alla lavagna, che li usa come prima.
`setMouse("ink")` fa scrivere il mouse dal prossimo appoggio. La gomma
non fa scia: `onEraseStart` (col tipo del puntatore), `onErase` coi punti in
coordinate della lavagna e `onEraseEnd`.

- **Chi ferma l'evento.** Un ascoltatore `pointerdown` in cattura sul
  viewport, registrato dopo l'adattatore, legge il ruolo appena deciso
  (`roleOf`). Se il puntatore scrive o cancella (`ink`, `erase`, `barrel`), o
  è una penna, chiama `stopImmediatePropagation()` e `preventDefault()`:
  `stopPropagation` da solo non basterebbe quando il bersaglio è il viewport
  stesso. La lavagna non seleziona, non sposta, non prende il fuoco e non
  seleziona testo; la penna scrive anche sulla testata, sulla maniglia e su
  una scheda in modifica, il cui campo resta com'è. Il `click` e il
  `dblclick` del puntatore (`detail` > 0) dopo un tratto, fino al
  `pointerdown` seguente, si fermano allo stesso modo: il doppio tocco della
  penna non crea una scheda.
- **La scia.** Un `<svg class="canvas-ink-wet">` nel viewport, fuori dallo
  stage, con la trasformazione della camera (`setCamera`); un percorso per
  tratto, rifatto con `StrokePreview` in `onSettled`. Il tratto finito va a
  `onStroke` in coordinate della lavagna, con pennello, colore e strumento
  letti all'inizio (`look`); la scia resta finché la lavagna non chiama
  `settle(id)` nello stesso giro in cui aggiunge l'asciutto. Un tratto
  annullato (palmo, pagina nascosta, `pointercancel`) toglie subito la scia;
  uno chiuso dalla cattura persa o dalla finestra che perde il fuoco si salva
  come un rilascio, all'ultimo punto (N6 T20a).
  La sessione fa un tratto alla volta: una seconda penna non scrive e non
  arriva alla lavagna.
- **L'asciutto.** `editors/canvas/ink-paint.ts`: `paintCard` mette nella
  scheda un `<svg class="canvas-ink-card">` largo e alto quanto lei, con un
  `<svg>` per ogni misura di riferimento nel modo della scheda
  (`editors/canvas/ink-fit.ts`, D-9): `scale` per immagini e PDF (largo
  quanto la scheda, `viewBox` e `xMidYMid meet`), `fixed` per le altre
  (largo `W` e alto `H`, senza scala); spostare o ridimensionare la scheda
  porta l'inchiostro senza ridisegnarlo. `paintBoard` disegna l'inchiostro libero
  sullo stage dopo le schede. Ridisegnare tratti uguali tiene i percorsi;
  `InkPathCache` tiene i contorni per id, inchiostro e pennello e lascia
  andare a ogni giro (`sweep`) quelli non più chiesti.
- **Il silenzio della penna.** Ogni tratto chiama `quiet.enter()` all'inizio
  e `quiet.leave()` una volta sola alla fine o all'annullamento. `PenQuiet`
  (`ink/quiet.ts`) rimanda per chiave il lavoro pesante (`defer("render",
  …)`): con una penna giù resta in coda e una richiesta nuova prende il posto
  della vecchia; all'ultimo `leave` la coda va una volta allo scheduler di
  `ink/dom/idle.ts`, che la fa girare quando il thread è libero
  (`requestIdleCallback` con un `timeout`, altrimenti `setTimeout(0)`). Una
  penna che torna giù prima annulla la consegna.
- **Le preferenze.** `editors/canvas/preferences.ts` legge le dodici
  impostazioni di `fub.lavagna` (`lavagna.rs`). `watchPreferences` le segue
  con `setting_changed` e torna il disposer. Una cartella dei file trascinati
  non valida vale `Allegati` (`dropFolderPathOf`); dove vanno i file dal
  computer lo dice `canvas.drop_folder` (`dropFolderFor`, in
  `state/canvas-intake.ts`). `canvas.toolbar` è una casella per strumento
  (`toolbar-field.ts`). L'ultimo «Scrivi col mouse» è lo stato di vista
  `canvas.ink_mouse`, uno per computer: `saveInkMouse` lo scrive a ogni
  cambio, `readInkMouse` lo ridà solo con «Ricorda» acceso, altrimenti spento.

## Come lo usa la lavagna

`editors/canvas/engine.ts` (`CanvasEngine`) apre una `Lifetime` quando nasce
e la chiude in `destroy`: dentro ci sono `PenQuiet` con `idleSchedule` e lo
strato, che si monta solo se la lavagna si può cambiare. Sola lettura del
pannello, sola lettura della tela (un testo che il nucleo non sa riscrivere)
o scena troppo grande smontano lo strato, e il tratto in corso si annulla;
quando se ne vanno lo strato torna. L'asciutto si vede dove si vedono le
schede.

- **Chi decide la scheda.** Il tratto finito sceglie la scheda sul documento
  del momento in cui la penna si alza: `anchorAt` col riquadro di
  `strokeBounds`, e un livello che il nucleo dice estraneo non tiene il
  tratto (`foreignInkLayer`). Fuori da ogni scheda, o con `Alt` tenuto, è
  libero, nella radice; se anche quella è estranea non si scrive e la barra
  lo dice ([l'etichetta](../reference/canvas-input.md#mentre-la-penna-scrive)
  lo mostra prima). I livelli li dà il nucleo (`CanvasCore.inkLayers()`) una
  volta per testo; `mediaKindOfId` decide `data-media-kind` e `inkFitMode`.
- **Il passo di annulla.** Un tratto è `strokeRecord`, `addStrokePatch` e un
  commit solo, senza ridisegnare le schede: nello stesso giro si aggiunge
  l'asciutto del livello toccato e la scia va via (`settle`). Prima si
  registra il testo in sospeso di una scheda, che resta aperta: sono due
  passi. I pezzi di un tratto spezzato al limite dei campioni si salvano uno
  alla volta e si fondono in un passo solo. Annulla e ripeti seguono le due
  vie della tela (il testo esatto o le toppe inverse); un passo fatto solo di
  tratti ridisegna soltanto l'inchiostro. Con una penna giù non fanno niente.
- **La modifica da fuori a penna giù.** `syncDoc` aggiorna subito modello,
  sorgente e nucleo; il ridisegno passa da `quiet.defer("render", …)` e
  aspetta che la penna si alzi. Anche il testo in sospeso aspetta, perché
  il suo commit ridisegna le schede. Il tratto in corso non si perde; se la
  sua scheda non c'è più diventa libero.
- **Il menu della penna.** `pen-menu.ts` sceglie strumento, penna, colore,
  spessore in pixel dello schermo e modo della gomma, dal tratto dopo
  (`inkLook`; `penLook` dà la copertura, `fill-opacity`). Lo stato di vista
  `canvas.pen` (versione 1; un campo rotto vale il suo di serie) lo ricorda.
  Sta nella riga delle opzioni (`chrome/options.ts`, T50).
- **La gomma.** Il retro della penna, il tasto laterale e la punta con la
  Gomma del menu (`tipErases`) tolgono il tratto intero (A20). `EraseSweep`
  cerca nei tratti disegnati portati in coordinate della lavagna
  (`ink-erase.ts`, con `ink-fit.ts`): prende il tratto dove si vede, non uno
  non disegnato o di un livello estraneo. I presi si attenuano
  (`fadeInkStroke`, 0,25); alla fine un commit con una `eraseStrokePatches`
  per livello, un passo solo; niente preso, niente commit. «Solo il pezzo»
  taglia ciò che si strofina: `cutInk` usa `splitInk` e `cutBrush` nelle
  unità del tratto, sopra il tratto attenuato restano pieni i pezzi
  (`cutInkStroke`) e alla fine `cutStrokePatches` li mette al suo posto in
  un commit; un rifiuto del nucleo non cambia niente e lo dice l'avviso.
- **Il tasto D.** D da solo sul viewport, fuori dai campi, fa scrivere il
  mouse (`data-ink="pen"`) finché non si alza, o la finestra perde il fuoco
  o si nasconde; un tratto già giù finisce. «Scrivi col mouse»
  (`setInkMouse`, `saveInkMouse`, `readInkMouse` all'apertura) è lo stato
  di Penna, Evidenziatore e Gomma della [colonna](../reference/canvas-input.md).
- **La croce.** Il mouse che scrive mostra la croce (la cella con la Gomma)
  su un velo, `.canvas-pen-veil`, sopra le schede e le prese dei fili, non
  con `cursor` sul viewport: `cursor` si eredita, e cambiarlo lì ricalcolava
  lo stile di tutta la lavagna a ogni D (62–80 ms col foglio vivo). Il velo
  si mostra togliendo `data-idle`, solo col mouse o la penna sospesa sopra
  la vista; un dito che si appoggia o la penna che esce dal raggio lo
  tolgono (il mouse che esce no: ogni volta che il velo compare, la scheda
  sotto il puntatore perde `:hover` e si ridipinge). Il
  bersaglio del tratto si cerca per coordinate e non cambia; il menu, il
  dito, il doppio clic e la rotella vedono ciò che c'è sotto il velo
  (`#targetOf`, `#elementAt`), e sotto il velo nessun filo si scurisce.
- **L'inizio del tratto senza pittura.** Il bordo tratteggiato della scheda
  bersaglio (`.canvas-ink-frames`) è uno strato composto suo
  (`will-change: opacity`), sopra ogni scheda dello stage (`z-index: 2`) e
  portato sull'angolo della scheda con `transform`: un tratto che comincia
  sulla scheda del tratto prima cambia solo `data-idle`, cioè l'opacità
  dello strato, e la lavagna sotto non si ridipinge; `#placeInkFrame`
  scrive le misure solo quando cambiano. Il velo che compare e la cattura
  del tratto tolgono `:hover` alla scheda sotto il puntatore: la scheda che
  l'aveva (letta ai `pointerover`, mai a ogni movimento) tiene l'aspetto del
  passaggio con `data-hover-held` finché il puntatore non passa davvero
  altrove, così le prese, → e i pulsanti della scheda viva non cambiano e la
  scheda non si ridipinge. Sotto il velo il puntatore può lasciarla senza
  saperlo: all'alzata di un tratto che non era suo la scheda la lascia.
- **Il dito.** Un dito sposta la vista, anche sopra le schede; testata,
  maniglie, `[data-connect]` e controlli fanno come col mouse (in sola
  lettura la testata sposta la vista). Due dita pizzicano (`pinchCamera` di
  `touch.ts`); un tocco breve sceglie come un clic. Con «Il dito sposta le
  schede» il dito su una scheda la sposta, letta al primo dito. Il palmo
  (per la sessione, `roleOf` dello strato: un dito con la penna giù o
  sospesa) non fa niente, e un dito già giù si ferma quando arriva la penna.
