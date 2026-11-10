# Inchiostro e strumenti

Questa pagina spiega come Fub raccoglie l'inchiostro e dove vivono penna,
evidenziatore e gomma, perché più prodotti possano usarli senza copiarli.

> **Ambito:** `crates/fub-ink`, `apps/client/src/ink/` e il loro uso da parte di
> FubDraw.
> **Fonte autorevole:** il codice e i test di quei percorsi.
> **Decisione:** [ADR 0204](../decisions/0204-nucleo-inchiostro.md).

## Regola

Penna, evidenziatore, gomma, gestione del puntatore e geometria dei tratti
sono **componenti di sistema**. Non appartengono a FubDraw né a un futuro
editor: ogni prodotto che raccoglie inchiostro li usa e nessuno ne ha una copia
propria. Un prodotto mette il suo: dove scrive il tratto, come lo annulla, che
cosa annuncia.

## Livelli

Il percorso va dall'evento del browser al tratto scritto. Ogni livello ignora
quelli a destra.

```mermaid
flowchart LR
    EVT["Eventi del puntatore"] --> ADA["Adattatore del browser"]
    ADA --> SES["Sessione dei campioni"]
    SES --> EFF["Effetti del tratto"]
    EFF --> PRO["Prodotto"]
    TOOL["Strumenti"] --> PRO
    GEO["Geometria e tratto"] --> PRO
    PRO --> OPS["Scena e annulla"]
```

Gli eventi arrivano all'adattatore, che riempie un campione per evento. La
sessione trasforma i campioni in effetti. Il prodotto sceglie lo strumento,
scrive il tratto nella sua scena e lo annulla con il suo storico. Gli strumenti
e la geometria sono funzioni che il prodotto chiama.

| Livello | Percorso | Contiene |
|---|---|---|
| nucleo, Rust | `crates/fub-ink` | campione, ruoli, pressione, inclinazione, stabilizzatore, sessione |
| nucleo, TypeScript | `apps/client/src/ink/input/` | le stesse regole, per il percorso caldo |
| formato dei campioni | `apps/client/src/ink/sample.ts` | `fub:ink`, quantizzazione, limite dei campioni |
| pennello | `apps/client/src/ink/brush.ts`, `pf1.ts`, `pf1-live.ts`, `nib1.ts` | `fub:brush`, contorno, contorno che cresce, punta piatta |
| penne | `apps/client/src/ink/pens.ts` | le sette ricette del pennello con un nome, misura, opacità, fusione |
| geometria | `apps/client/src/ink/geometry.ts` | trasformazioni dei campioni, tratto dritto |
| strumenti | `apps/client/src/ink/tools/` | contratto, registro, penna, evidenziatore, gomma, taglio dei tratti (`split.ts`) |
| adattatore del browser | `apps/client/src/ink/dom/` | `attachInkInput` |

## Un nucleo in due lingue

Il percorso caldo gira a ogni evento del puntatore. Un passaggio per IPC o per
WASM a ogni battuta è escluso dalle regole del frontend, e il client non ha una
toolchain WASM. Il nucleo è quindi scritto due volte.

- **Rust fa fede.** `fub-ink` non dipende da niente, nemmeno da `fub-abi`, e
  compila per `wasm32-wasip2`: è la forma di un nucleo che un giorno può
  diventare un componente.
- **TypeScript lo ripete.** Le due copie sono legate da una fixture generata:
  `apps/client/src/ink/__fixtures__/ink-samples.json`, scritta da
  `UPDATE_MIRROR=1 cargo test -p fub-ink --test ts_mirror`. Il test Vitest
  `mirror.test.ts` passa gli stessi scenari alla copia TypeScript e pretende
  le stesse risposte. Cambiare una regola da un lato solo rende rosso un test.

La fixture non si modifica a mano.

## Il campione e la sessione

L'unico tipo in ingresso è il `PointerSample`: posizione nella scena, tempo,
pressione, inclinazione, tasti, e la vista (angolo e scala) con cui è stato
letto. L'unico tipo in uscita è l'`Effect`. La `Session` è un riduttore puro:
lo stesso scenario dà gli stessi effetti.

Le regole che la sessione garantisce:

- i campioni nuovi si consegnano dentro l'evento che li porta;
- gli eventi coalescenti entrano tutti, nell'ordine in cui sono avvenuti; un
  doppione o un evento più vecchio dell'ultimo accettato si scarta;
- un evento con posizione o tempo non finiti non diventa un campione, nemmeno
  il primo, un predetto o quello dell'alzata: un tempo infinito farebbe
  scartare come vecchi gli eventi dopo;
- gli eventi predetti vanno solo all'anteprima, ogni volta al posto dei
  precedenti, e non entrano mai nel tratto;
- un tratto si conclude alzando il puntatore o chiudendosi al limite dei
  campioni; ogni altra fine lo annulla per intero, con un motivo
  (`pointercancel`, perdita della cattura, finestra senza fuoco, pagina
  nascosta, palmo, secondo dito, richiesta esplicita, distruzione);
- una penna con pressione 0 non comincia un tratto, e una penna sospesa non
  disegna;
- mouse e dito non hanno il canale di pressione, e il pennello la simula;
- un tocco senza movimento è un segno di due campioni nello stesso punto;
- oltre il limite dei campioni il tratto si chiude e ne comincia un altro dallo
  stesso punto, senza buchi: l'ultimo campione del primo è il primo del
  secondo, con tempo 0. Il primo finisce con `split`, il secondo comincia con
  `continued`.

### Chi disegna

`roles` decide che cosa fa ogni puntatore: disegna, muove la vista o è
ignorato. La punta della penna disegna; la penna girata (`button` 5) e il
tasto laterale (`button` 2) fanno anch'essi un tratto, coi ruoli `erase` e
`barrel`, che `StrokeStart.role` porta a chi disegna. Ogni tratto vive finché
è premuto il suo bit di `buttons` (1, 32, 2). Il tasto centrale del mouse
muove la vista; il principale segue la politica del mouse, che sceglie il
prodotto (`mouse` nella configurazione, `setMousePolicy` mentre vive): `ink`,
quella di serie, disegna, `ignore` lo lascia a chi sta sotto, per esempio a
una lavagna dove il mouse seleziona. Vale dal prossimo appoggio: un tratto
in corso finisce com'è. Un tipo di puntatore sconosciuto (`""`) segue il
mouse: un driver che manda la penna così, con `ignore`, non scrive.
Un dito non disegna mentre una penna tocca lo schermo o è sospesa: è il palmo, e
un suo tratto già cominciato si annulla quando la penna arriva. Con due dita
giù il gesto è di navigazione. Altrimenti decide la politica del tocco
(`auto`, `ink`, `navigate`): `auto` fa disegnare il dito finché su quella
superficie non si è vista una penna.

### Pressione, inclinazione, stabilizzatore

- La **curva della pressione** ha tre manopole (morbidezza, minimo, pieno) ed è
  della macchina, non del documento: il file conserva la pressione già
  curvata, e lo stesso disegno si vede uguale ovunque.
- L'**inclinazione** si riduce ad altitudine e azimut; l'azimut si misura dall'asse
  x della scena, e su un foglio girato si toglie l'angolo della vista. Un
  tratto senza inclinazione vera non la porta.
- Lo **stabilizzatore** è la media pesata dal tempo o la corda tirata, derivato
  da codice MIT di terzi (vedi
  [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)). Quando è acceso i
  campioni del tratto sono quelli del pennino e non quelli del puntatore, e la
  predizione non si consegna. L'adattatore lo legge a ogni `pointerdown`
  (`stabilizer`, con `scale` per la corda in pixel dello schermo). In FubDraw si
  sceglie in «Penna e dita» (levigatura e corda), è della macchina come la curva
  e vive nella griglia ricordata (`steady`); assente, è spento.

## L'adattatore del browser

`attachInkInput(element, options, owner)` è l'unico punto che conosce il DOM.
Ascolta in fase di cattura, così ruoli e stato sono aggiornati quando gli
ascoltatori della camera, in bolla sullo stesso elemento, li leggono. Ogni
ascoltatore ha un owner e un disposer (`ui/lifetime`).

Le callback del prodotto possono rientrare: una `onSamples` può chiamare
`cancel()`. La sessione calcola tutti gli effetti prima di consegnarli;
l'adattatore tiene un contatore di generazione, e un'interruzione dentro una
consegna rende non più valida la lista in corso, di cui esegue solo i
`release`. Il prodotto non riceve mai un tratto annullato come concluso né due
volte lo stesso tratto.

Dopo gli effetti di un evento l'adattatore chiama `onSettled(id)` una volta, se
il tratto aperto `id` ha ricevuto campioni o una predizione, anche vuota: è il
momento di rifare l'anteprima, una volta per evento anche quando l'evento porta
molti coalescenti. Al limite dei campioni arriva al tratto che continua. Non
arriva dopo la fine o l'annullamento del tratto, né dopo una consegna
interrotta.

Dove il browser lo dà, l'adattatore ascolta anche `pointerrawupdate`, che
arriva prima del `pointermove` del fotogramma: i suoi campioni vanno subito
alla sessione, e il `pointermove` che segue non ripete quelli già arrivati.
L'anteprima resta incrementale (`pf1-live.ts`) e non usa
`requestAnimationFrame` (DEC-26).

Un evento nello stesso punto dello schermo dell'ultimo evento vero dello stesso
puntatore riprende il suo punto nella scena, invece di rileggere la vista con
`toScene`. Se la vista si muove sotto un puntatore fermo, alzarlo non aggiunge
un tratto che non ha fatto, e la gomma non cancella ciò che non ha toccato.

L'elemento deve avere `touch-action: none` e `user-select: none`: sono regole
di presentazione e le mette la superficie.

## Gli strumenti

Uno strumento è **dati più funzioni pure**: un id stabile, ciò che sa fare e la
ricetta del tratto. Non ha stato, non conosce scena, camera o formato di file.

| Genere | Campi | Strumenti |
|---|---|---|
| `stroke` | `id`, `opacity`, `capabilities`, `brush(width, input, pen?)` | `pen`, `highlighter` |
| `erase` | `id`, `radius(pointer)` | `eraser` |

Le capacità (`pressure`, `straightWithModifier`, `symmetry`, `holdsToShape`,
`stabilizes`) sono le domande che un prodotto si faceva con
`if (tool === "pen")`. Lo spessore dell'evidenziatore non segue la pressione e
il suo tratto va dritto con il tasto di raddrizzamento. La gomma è più larga
con il dito.

`InkToolRegistry` registra gli strumenti. Rifiuta un id che il file non
scriverebbe, un'opacità fuori da (0, 1] e un id già presente; ogni
registrazione torna un disposer. `INK_TOOLS` è il pacchetto di sistema: penna,
evidenziatore e gomma, registrati all'avvio, in sola lettura. Non sono un
plugin installabile. Il contratto non tocca il DOM e passa solo numeri e oggetti
semplici, quindi può un giorno stare dietro un componente senza cambiare forma.

Il registro degli strumenti dell'inchiostro dice **che cosa fa** uno strumento.

### Le penne

Una penna (`ink/pens.ts`) è una ricetta del pennello con un nome: sei sono
`pf1` con altri numeri, la Calligrafia è `nib1`, la punta piatta
([ADR 0227](../decisions/0227-le-penne-e-la-punta-piatta.md)). Lo strumento
`stroke` riceve la penna scelta in `brush(width, input, pen)` e scrive il suo
nome nel pennello come `pen=<id>`; una penna che non segue la pressione non la
simula nemmeno col mouse. La penna dice anche quanto copre e come si fonde
(`penLook`): l'evidenziatore moltiplica. La forma è in
[`scene-format-pens.md`](../reference/scene-format-pens.md).

La gomma precisa usa `ink/tools/split.ts`: i campioni di un tratto si tagliano
dove il cerchio della gomma tocca l'inchiostro, e ogni pezzo resta un tratto
coi suoi campioni, il suo pennello senza rastremazione ai tagli e il suo tempo.
Il registro della barra di FubDraw (`editors/spatial/tools/registry.ts`) dice
**come lo offre**: icona, etichetta, tasto, livello. Usano gli stessi id e il
test `ink-tools.test.ts` li lega: uno strumento presente da una parte sola è
un pulsante senza comportamento o un comportamento senza pulsante.

### Tratto e gomma

In `ink/tools/stroke.ts` due funzioni pure e una classe valgono per ogni
strumento che scrive:

- `previewOutline` è il contorno del tratto in corso, a ogni movimento. Non
  lancia mai: un campione che l'inchiostro non scrive dà un'anteprima vuota.
  Rifà il contorno intero, quindi il suo costo cresce con la lunghezza del
  tratto: è la definizione, non il percorso caldo.
- `StrokePreview` dà, per gli stessi argomenti, lo stesso contorno di
  `previewOutline`, ed è ciò che un prodotto usa mentre il tratto cresce.
  Quantizza ogni campione una volta sola e affida il contorno a `Pf1Live`
  (`ink/pf1-live.ts`), che ripete i due passi di `getStroke` di
  perfect-freehand (avviso in
  [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)) e congela il
  prefisso che nessun campione futuro cambia. Una chiamata rifà la coda e copia
  il poligono in un vettore che si riusa. `local` può soltanto crescere in
  coda: se si accorcia, o se cambia l'ultimo campione già letto, l'anteprima
  ricomincia. I campioni più indietro non si ricontrollano, e chi ne cambia
  uno crea uno `StrokePreview` nuovo. Il contorno vale fino alla chiamata dopo,
  che può riscriverlo. L'uguaglianza è esatta, numero per numero, e dipende
  dagli interni della versione fissata della libreria: `pf1-live.test.ts` la
  prova a ogni prefisso.
- `buildStroke` è il tratto finito: inchiostro quantizzato, contorno e le
  copie portate da altre trasformazioni. FubDraw non ne chiede più (la penna
  in simmetria se n'è andata, decisione 0231), e il passaggio resta del
  nucleo. Una copia che esce dai numeri dell'inchiostro non c'è, le altre sì. Il fallimento ha due motivi:
  `failed` (campioni non scrivibili) ed `empty` (nessun contorno).

`EraseSweep` in `ink/tools/sweep.ts` è il gesto della gomma: percorre il
cammino a segmenti e segna una volta sola ogni unità che il prodotto trova a
meno del raggio. Il prodotto implementa `EraseSource` con il suo indice e
cancella ciò che è stato segnato quando il puntatore si alza. A ogni segmento
`EraseSource.along` riceve anche ciò che la gomma ha già segnato (`marked`):
un'unità che vi sta sotto la sua chiave, lo stesso oggetto, il prodotto può
non riprovarla.

## Come lo usa FubDraw

FubDraw è il primo consumatore e non il proprietario.

- `tools/editor/curvature-tool.ts` attacca `attachInkInput` alla superficie,
  passa la curva della pressione, l'angolo della vista e la politica del tocco,
  e rifà l'anteprima in `onSettled`, una volta per evento.
- `tools/editor/gesture-begin.ts` (`begin`, `drawInk`) sceglie lo strumento da
  `INK_TOOLS`, ne prende il pennello e crea per ogni tratto uno
  `StrokePreview`, con cui `drawInk` rifà l'anteprima e la disegna subito
  sullo strato sopra la scena (`painter/overlay.ts`), dentro il gestore
  dell'evento e senza aspettare il fotogramma.
- `tools/editor/sheet-cursor.ts`, il cursore da tastiera, chiama gli stessi
  gestori senza l'adattatore, e chiama da sé `onSettled` dopo i campioni.
- `tools/editor/ink-gestures.ts` (`writeInk`, `eraseAlong`) costruisce il
  tratto con `buildStroke`, lo scrive in un'unica operazione nello storico e fa
  correre la gomma con `EraseSweep` sull'indice della scena.
- `tools/hit.ts` (`SceneIndex.along`) è la fonte della gomma e non riprova ciò
  che `marked` ha già segnato. Da 256 oggetti in su (`TREE_FROM`) prova
  soltanto quelli che l'albero dei riquadri (`tools/box-tree.ts`) dà
  vicini al segmento. L'albero è un R-tree impacchettato una volta per indice,
  alla prima domanda, e dà gli oggetti che il confronto dei riquadri darebbe:
  il risultato è quello della scansione.
- `tools/edit.ts` (`strokeElem`) scrive nel file l'opacità dello strumento.

Restano del prodotto il livello di destinazione, gli id, gli annunci per lo screen reader, il passo di annulla e il formato della scena.

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
  annullato (palmo, cattura persa, finestra nascosta) toglie subito la scia.
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
  tratto (`foreignInkLayer`). Fuori da ogni scheda il tratto è libero, nel
  livello della radice; se anche quello è estraneo non si scrive e la barra
  lo dice. Lo stato dei livelli viene dal nucleo (`CanvasCore.inkLayers()`),
  una volta per testo; il tipo della scheda (`mediaKindOfId`) decide insieme
  `data-media-kind` e il modo dell'inchiostro (`inkFitMode`).
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
- **Il dito.** Un dito sposta la vista, anche sopra le schede; testata,
  maniglie, `[data-connect]` e controlli fanno come col mouse (in sola
  lettura la testata sposta la vista). Due dita pizzicano (`pinchCamera` di
  `touch.ts`); un tocco breve sceglie come un clic. Con «Il dito sposta le
  schede» il dito su una scheda la sposta, letta al primo dito. Il palmo
  (per la sessione, `roleOf` dello strato: un dito con la penna giù o
  sospesa) non fa niente, e un dito già giù si ferma quando arriva la penna.

## Confini e verifica

| Regola | Chi la verifica |
|---|---|
| `fub-ink` non dipende da niente e compila per `wasm32-wasip2` | `dependency_invariant.rs` e la CI |
| Rust e TypeScript rispondono uguale | `ts_mirror` e `ink/mirror.test.ts` |
| `src/ink/` non importa prodotti, editor, Tauri o CodeMirror | `ink/boundary.test.ts` |
| il nucleo non usa globali del DOM | `ink/boundary.test.ts` |
| ogni ascoltatore ha owner e disposer | `check-listeners.mjs` |
| barra e registro dell'inchiostro coincidono | `tools/ink-tools.test.ts` |
| l'anteprima che cresce dà il contorno di `getStroke` | `ink/pf1-live.test.ts`, `ink/tools/stroke.test.ts` |
| con l'albero dei riquadri la gomma prende ciò che prenderebbe la scansione | `tools/box-tree.test.ts`, `tools/hit.test.ts` |
| la gomma non riprova ciò che ha già segnato | `ink/tools/sweep.test.ts`, `tools/hit.test.ts` |
| un ridisegno per evento | `ink/dom/pointer-adapter.test.ts` |
| la penna della lavagna non arriva alla lavagna; il mouse sì | `editors/canvas/ink-layer.test.ts` |
| l'inchiostro di una scheda la segue senza ridisegnare | `editors/canvas/ink-paint.test.ts` |
| un tratto è una toppa, un commit e un passo; il ridisegno aspetta la penna | `editors/canvas/engine-ink.test.ts` |
| la gomma prende il tratto dove si vede, cancella o taglia in un passo; D fa scrivere il mouse; il menu vale dal tratto dopo | `editors/canvas/ink-erase.test.ts`, `editors/canvas/engine-ink.test.ts`, `editors/canvas/pen-menu.test.ts` |
| il dito sposta e pizzica la lavagna; la penna, anche sospesa, lo ferma | `editors/canvas/touch.test.ts`, `editors/canvas/engine-touch.test.ts` |
| Rust e client nominano, ordinano e danno gli stessi default alle dodici impostazioni della lavagna; un valore sbagliato vale il default | `editors/canvas/settings-mirror.test.ts`, `editors/canvas/preferences.test.ts`, `fub-host/tests/lavagna_feature.rs` |
| un puntatore fermo resta fermo nella scena se la vista si muove | `ink/dom/pointer-adapter.test.ts`, `tools/editor.test.ts` |

Il percorso caldo ha due banchi:

```bash
cargo bench -p fub-ink
npm run bench:ink      # da apps/client/
```

Misurano nanosecondi per evento e non asseriscono tempi. Il budget è quello
dell'input: a 240 Hz un evento ha circa quattro millisecondi. Il riduttore ne
costa una piccola frazione. `StrokePreview` costa pochi microsecondi a cento
campioni e decine a novemila, dove il contorno intero di `previewOutline` costa
millisecondi: ordini di grandezza da confrontare fra versioni. I banchi non
misurano il riempimento sul canvas, che cresce col tratto.
La procedura manuale per mouse, tocco e penna è in [Prova manuale
dell'inchiostro](../development/ink-input-smoke-test.md).

## Aggiungere uno strumento

1. Definisci l'oggetto dello strumento in `ink/tools/` con id, capacità e
   ricetta, e registralo in `systemInkTools()`.
2. Aggiungi la voce alla barra del prodotto con lo stesso id.
3. Scrivi i test della ricetta e, se cambia il byte scritto nel file, quelli
   dell'editor.
4. Se cambia un confine, aggiorna questa pagina e l'ADR.

Uno strumento non ha il suo ciclo di vita del puntatore, la sua curva della
pressione o la sua geometria. Se gli serve una regola nuova di questi livelli,
la regola va nel nucleo.

## Fuori dall'ambito

Nessun prodotto ha una penna propria. Le annotazioni dei PDF (il profilo
`pdf` della famiglia `canvas`) usano questi stessi strumenti di sistema, senza
rotte di inchiostro proprie, e un prodotto futuro userà gli stessi.
