# I tasti e i gesti della lavagna

> **Ambito:** come la tela della lavagna prende la tastiera, il puntatore e
> la rotella: entrare in una scheda e uscirne, la rotella, il catalogo dei
> comandi e i loro tasti, la colonna degli strumenti, la riga delle opzioni
> e la banda di stato.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/engine.ts`
> (`#keydown`, `#wheel`, le schede attive) e le prove in
> `apps/client/src/editors/canvas/engine.test.ts` e
> `engine-cards.test.ts`; per i comandi,
> `apps/client/src/editors/canvas/chrome/commands.ts`, `command-search.ts`,
> `rail.ts`, `options.ts` e le loro prove; per la banda, `chrome/status.ts` e
> `engine-status.test.ts`.

Questa pagina viene da [Le schede della lavagna](canvas-cards.md), che tiene
il contratto dei renderer.

## Entrare e uscire

Una scheda scelta si guarda; una scheda **attiva** si usa: il suo contenuto
prende il puntatore, la tastiera e la rotella. Una sola scheda è attiva alla
volta. Lo decide la tela (`engine.ts`); il renderer risponde con `enter`,
`leave` e `key`.

- **Scegliere.** Un clic su una scheda la sceglie, anche se cade su un link
  del contenuto, e il link non si segue (A-12). Ctrl+clic (Cmd+clic su
  macOS) su un link lo segue subito, nella scheda attiva o no (D-18 (c));
  fuori da un link aggiunge la scheda alla scelta, o la toglie, come
  Maiuscolo; Ctrl con uno spostamento sposta la lavagna, come prima. Un
  pulsante della vista («Apri») risponde a un clic anche fuori.
- **Entrare.** Un clic dentro una scheda che era già la sola scelta, Invio
  con una scheda scelta che non è di testo, o il doppio clic su una nota, un
  documento o un foglio chiamano `enter()`. Una scheda ferma prima si
  accende (la scelta delle schede vive la accende con le altre), poi entra.
  Se `enter()` dice `true` la scheda è attiva: `data-card-active` sulla
  scheda, «Esc per uscire» (`canvas.card.exit_hint`, `.canvas-exit-hint`)
  nella testata, il fuoco nel corpo. Se dice `false`, o la vista non ha
  `enter`, Invio e il doppio clic fanno ciò che facevano (il campo della
  scheda). Si entra anche in sola lettura; non si entra in una scheda fuori
  dalla vista né con la penna giù.
- **Dentro.** I clic arrivano al contenuto (i link si seguono con un clic),
  la rotella sopra il corpo lo scorre (Ctrl+rotella e il pizzico ingrandiscono
  sempre la lavagna, A-11), i tasti sono del contenuto e la tela non li usa,
  salvo Esc. La scheda attiva resta viva anche se la regola delle schede vive
  la spegnerebbe (lo zoom sotto 0,35, il limite).
- **Uscire.** Esc (se il contenuto non lo usa da sé, per esempio per
  annullare un rettangolo di celle che si sta scegliendo: allora chiama
  `preventDefault`), un clic fuori dalla scheda, la scheda che esce dalla
  vista a fine gesto, la scheda tolta (un annulla, una modifica da fuori) o
  un documento nuovo chiamano `leave()`. Con Esc il fuoco torna sulla
  scheda. Uscita, la scheda torna alla regola: può diventare ferma.
- **Scelta e non attiva.** PgSu, PgGiù, Home e Fine vanno a `key()`; se
  dice `true` la tela non li usa (il PDF volta pagina). Gli altri tasti
  restano della tela.
- **Il doppio clic su un'immagine** apre il visore: lo ascolta la vista
  dell'immagine, la tela non apre il campo.

Il clic passa prima dalla tela (in cattura): fuori da una scheda attiva il
contenuto non lo riceve. Nel tema (`structure.css`) il contenuto di una
scheda non attiva non prende il puntatore e non scorre, salvo i link, i
pulsanti e l'immagine; dentro una scheda attiva il corpo scorre.

## La rotella

Fuori da una scheda attiva la rotella fa ciò che dice «La rotella del mouse»
(`canvas.wheel`, Impostazioni › Lavagna, di questo computer): `pan`, di
serie, sposta la lavagna come prima; `zoom` la ingrandisce intorno al
puntatore (A-11, D-17 (b)). La tela legge l'impostazione a ogni cambio: vale
dallo scatto dopo, senza riaprire la lavagna.

- **Ctrl+rotella** (Cmd su macOS) e il **pizzico** del touchpad, che arriva
  come Ctrl+rotella, ingrandiscono sempre, in `pan` e in `zoom`. Uno scatto
  senza parte verticale non ingrandisce.
- **Maiusc+rotella** sposta di lato, in tutte e due. Dove il sistema non
  manda `deltaX` (WebKitGTK), vale il `deltaY` dello scatto.
- **In `zoom`** uno scatto solo verticale ingrandisce. Un evento con una
  parte orizzontale (le due dita sul touchpad) sposta come in `pan`, così il
  touchpad resta usabile.
- **Unità.** Una riga di `deltaMode` 1 vale 16 px, una pagina di `deltaMode`
  2 la misura della vista. Sono valori di partenza, non misure.
- **Ai limiti** lo zoom (da 0,1 a 4) resta fermo, senza salto: il punto
  sotto il puntatore non si sposta.
- **Sopra una scheda non attiva** la rotella è della lavagna. **Dentro una
  scheda attiva** scorre la scheda, e Ctrl+rotella ingrandisce la lavagna.

## Comandi e tasti

Ogni cosa che la tela sa fare è un comando di `CANVAS_COMMANDS`
(`editors/canvas/chrome/commands.ts`): un id stabile che comincia con
`canvas.`, il nome, il posto e i tasti. Il menu del tasto destro ne prende il
nome, il tasto e il perché di una voce spenta; sceglie solo quali voci, in che
ordine e su che cosa. `Ctrl+/` apre la ricerca dei comandi
(`chrome/command-search.ts`) in un popover, con `rankCommands` e l'aspetto del
disegno: un comando spento si vede col perché; i cinque usati da poco in quella
lavagna stanno in cima (stato di vista `canvas.commands:<documento>`; se non si
scrive, valgono quelli della sessione). `Esc` torna dov'eri, anche in un campo.

| Comandi | Tasti |
|---|---|
| `canvas.tool.select`, `.hand`, `.pen`, `.highlighter`, `.eraser`, `.text`, `.connect` | `V`, `H`, `P`, `Maiusc+P`, `E`, `T`, `C` |
| `canvas.escape` (toglie la scelta; senza scelta torna alla Selezione) | `Esc` |
| `canvas.undo`, `canvas.redo` | `Ctrl+Z`; `Ctrl+Maiusc+Z`, `Ctrl+Y` |
| `canvas.commands`, `canvas.select_all`, `canvas.duplicate` | `Ctrl+/`, `Ctrl+A`, `Ctrl+D` |
| `canvas.enter` (col fuoco sulla tela o su una scheda), `canvas.delete` | `Invio`; `Canc`, `Backspace` |
| `canvas.nudge.<lato>`, `canvas.nudge.<lato>.far` | frecce; `Maiusc`+frecce |
| `canvas.bring_front`, `canvas.send_back` | `Ctrl+]`, `Ctrl+[` |
| `canvas.fit`, `canvas.fit_selection` | `Maiusc+1`, `Ctrl+0`; `Maiusc+2` |
| `canvas.zoom_in`, `canvas.zoom_out` | `+`, `Ctrl+=`; `-`, `Ctrl+-` |
| `canvas.add.*`, `canvas.edit`, `canvas.open`, `canvas.open_url`, `canvas.edge.reverse`, `canvas.color.*`, `canvas.align.*`, `canvas.distribute_*` | nessuno |
| `canvas.pen_menu`, `canvas.color_menu`, `canvas.align_menu`, `canvas.tips.none`, `.start`, `.end` (la riga delle opzioni) | nessuno |

I tasti sono quelli della tabella «Tasti» della lavagna dove fanno la stessa
cosa (ADR 0223), e nessuno è di due comandi. Un tasto senza `Ctrl` né `Alt`
non vale mentre si scrive; vale solo coi modificatori scritti (`Alt+←` resta
dello Scrittoio); prima vince il segno scritto, poi il posto del tasto
(`Maiusc+1`). Dello Scrittoio la tela prende solo lo zoom (`Ctrl+=`, `Ctrl+-`,
`Ctrl+0`, `CANVAS_DECLARED_SHELL_KEYS`), com'era già. Restano com'erano e
diversi dalla tabella: `Ctrl+0` mostra tutto, le frecce spostano di 8
(`Maiusc` 32). Come nel disegno, i tasti della lavagna non si cambiano ancora.

## La colonna degli strumenti

A sinistra della lavagna sta la colonna degli strumenti
(`chrome/rail.ts`, sulla colonna del kit come quella del disegno): Selezione,
Mano, Penna (con l'Evidenziatore in tendina), Gomma, Testo e Collega. Ogni
casella è il comando `canvas.tool.<id>`; i tasti valgono sulla lavagna e col
fuoco sulla colonna, mai mentre si scrive. La Mano sposta la lavagna anche
sopra le schede; il Testo mette una scheda di testo dove si fa clic, col campo
aperto, e torna alla Selezione; Collega tira un filo da una scheda a un'altra.
Penna, Evidenziatore e Gomma fanno scrivere il mouse con la penna del menu di
N4: sono lo stesso stato dell'interruttore «Scrivi col mouse», e la scelta
passa al menu della penna. `D` tenuto presta la penna a ogni strumento.

`canvas.toolbar` sceglie quali strumenti stanno nella colonna e in che ordine
(`canvasRailLayout`): vuota è quella di serie; un nome che la lavagna non
conosce si salta, la Selezione sta sempre in cima, uno strumento tolto resta
nei tasti e in `Ctrl+/`. In sola lettura gli strumenti che scrivono si vedono
spenti col perché nel nome; Selezione e Mano restano. Con la finestra fino a
700 px, o un riquadro fino a 480, la colonna va sotto la lavagna, in riga.

## La riga delle opzioni

Sopra la lavagna, nella testata (`.canvas-header`), sta la riga delle opzioni
(`chrome/options.ts`, sulla barra delle opzioni del kit come quella del
disegno). Che cosa mostra lo dice `canvasOptionsMode`, dallo strumento e dalle
schede scelte:

- **Penna, Evidenziatore, Gomma:** il pulsante del menu della penna di N4
  (`pen-menu.ts`, il contenuto com'è); passare fra i tre dal menu non lo
  chiude. `canvas.pen_menu` lo apre anche da `Ctrl+/`: con un altro
  strumento prima sceglie quello della penna.
- **Selezione con delle schede scelte:** il colore (un pozzo col colore e il
  nome, «Colori diversi» se non sono uguali, che apre i colori
  `canvas.color.*`) e Disponi: davanti, dietro, «Allinea e distribuisci»
  (`canvas.align_menu`, spento con meno di due schede).
- **Selezione senza schede, Testo, Collega:** una riga che spiega il gesto;
  Collega ha le punte del filo che tira (`canvas.tips.*`: nessuna, all'inizio,
  alla fine, quella di serie, che scrive `toEnd: "arrow"` come prima). La
  punta scelta vale finché la lavagna resta aperta.
- **In ogni riga** la Vista: riduci, ingrandisci, mostra tutto.

Ogni controllo è un comando del catalogo: il nome e il tasto vengono da lì,
uno spento si vede col perché (`aria-disabled`) e il clic non fa niente.
Cambiando riga si chiudono il menu della penna e i menu che la riga ha
aperto. Quando non c'è posto i controlli vanno in «…», prima la Vista. La
riga è una `toolbar` con un solo punto di tabulazione e le frecce.

Mentre si scrive dentro una scheda, chi scrive dà la sua barra con
`CanvasEngine.setCardOptions(items)` e la riga la mostra al posto delle
opzioni dello strumento; con `null` torna allo strumento. È il posto della
barra di formato della nota (T41) e della formula della cella (T42).

La barra di sotto, quella di N4, tiene ciò che non è ancora passato altrove:
«Scrivi col mouse», aggiungi, duplica, togli, inquadra la selezione, i fili e
il colore esatto (`#rrggbb`) delle schede.

## La banda di stato

La banda di stato dello Scrittoio dice della lavagna quattro cose. La shell la
disegna da `EditorSurface.status`; le voci vengono da `engine.statusItems()`
(`chrome/status.ts`).

- **Zoom**: la percentuale di adesso, per esempio `140%`. Un clic apre il menu
  dello zoom, accanto all'angolo in basso a destra della lavagna: 50%, 100% e
  200% (quella di adesso è segnata, se è una di queste), poi «Mostra tutta la
  lavagna» e «Inquadra la selezione». Quest'ultima è spenta senza una scheda
  scelta, e dice perché.
- **Schede scelte**: «N schede scelte», o «Una scheda scelta». Compare solo con
  una scelta.
- **Sola lettura**: compare quando la lavagna non si cambia, per il pannello in
  sola lettura o perché il file ha una chiave doppia. Il suggerimento dice
  perché.
- **Cartella dei file trascinati**: dove finiscono i file trascinati sulla
  lavagna, con la regola del deposito: `files.attachment-folder`, di serie
  `attachments` alla radice del vault; un nome che comincia con `./` sta accanto
  alla lavagna. Un clic apre le Impostazioni su `files.attachment-folder`. Il
  nome si legge quando la lavagna si apre: se l'impostazione cambia mentre la
  lavagna è aperta, si vede alla prossima apertura.

La banda si rilegge a fine gesto: una rotella che gira non la tocca finché non
si ferma, e una panoramica non ne cambia le voci.
