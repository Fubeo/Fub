# I tasti e i gesti della lavagna

> **Ambito:** come la tela della lavagna prende la tastiera, il puntatore e
> la rotella: entrare in una scheda e uscirne, la rotella, muoversi, il catalogo dei
> comandi e i loro tasti, i fili, le maniglie, la lavagna vuota, la colonna
> degli strumenti, la riga delle opzioni, la banda di stato e l'ispettore.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/engine.ts`
> (`#keydown`, `#wheel`, le schede attive) e le prove in
> `apps/client/src/editors/canvas/engine.test.ts` e
> `engine-cards.test.ts`; per i comandi,
> `apps/client/src/editors/canvas/chrome/commands.ts`, `command-search.ts`,
> `rail.ts`, `options.ts` e le loro prove; per la lavagna vuota,
> `chrome/empty.ts` ed `chrome/empty.test.ts`; per la banda, `chrome/status.ts` e
> `engine-status.test.ts`; per l'ispettore, `chrome/inspector.ts`,
> `reading-order.ts` e le loro prove; per i fili, `edges.ts` ed
> `edges.test.ts`.

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
- **Ai limiti** lo zoom (da 0,05 a 4) resta fermo, senza salto: il punto
  sotto il puntatore non si sposta.
- **Sopra una scheda non attiva** la rotella è della lavagna. **Dentro una
  scheda attiva** scorre la scheda, e Ctrl+rotella ingrandisce la lavagna.

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
  (`#jumpCamera`).
- **Spazio tenuto** e trascina sposta la vista con qualsiasi strumento, anche
  sopra una scheda e col mouse che scrive; la mano viene dal tema
  (`data-space-pan`). Mentre si scrive in una scheda, o dentro la scheda
  attiva, Spazio è uno spazio; con la penna giù non vale (la penna vince).
- **Il tasto centrale** trascina e sposta, senza scegliere. Ctrl, Cmd e Alt
  con un trascinamento nel vuoto spostano come prima; Alt dal corpo di una
  scheda tira un filo ([I fili](#i-fili)).
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

## Il navigatore

In basso a destra della vista, 168 × 120 px: la mappa dei gruppi (il filo) e
delle schede (piene, del loro colore, `--canvas-color` come i fili) col
riquadro di ciò che si vede (`chrome/navigator.ts`). L'inquadratura è
`navigatorBox` del disegno: la lavagna e la vista, con un margine; una scheda
lontanissima ci sta.

- **Un clic** porta il centro della vista lì: è un salto (`#jumpCamera`), che
  vola come `Maiusc+1`, o arriva subito col movimento ridotto.
- **Trascinare** sposta la vista sotto la mano, subito, senza volo; preso
  dentro il riquadro, il riquadro non salta. È un gesto: le schede vive, la
  banda e la mappa si rifanno al rilascio.
- **Sparisce da solo** quando tutta la lavagna sta già nella vista, e su una
  lavagna vuota. «Nascondi il navigatore» (`canvas.navigator.hide`, nel
  gruppo Vista del catalogo e nel menu del vuoto) lo spegne per questa
  lavagna, ricordato nella vista (`"navigator": false`, [Riaprire dove
  eri](canvas-cards.md#riaprire-dove-eri)); «Mostra il navigatore»
  (`canvas.navigator.show`) lo riaccende. C'è sempre una sola delle due.
- **La tastiera.** F6 dalla lavagna ci arriva (`EditorSurface.zone`: la
  vista, poi il navigatore se si vede); le frecce spostano il riquadro di un
  decimo della vista, con Maiusc di metà.
- **Il disegno.** Una sola `<canvas>`, mai un elemento per scheda; si
  ridipinge a fine gesto e al cambio del documento, se la lavagna o la vista
  sono cambiate. I colori sono variabili della pelle
  (`--canvas-navigator-card`, `-group`, `-view`, `-view-fill`), lette una
  volta per disegno.

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
| `canvas.enter` (col fuoco sulla tela o su una scheda), `canvas.delete` («Togli dalla lavagna») | `Invio`; `Canc`, `Backspace` |
| `canvas.nudge.<lato>`, `canvas.nudge.<lato>.far` | frecce; `Maiusc`+frecce |
| `canvas.bring_front`, `canvas.send_back` | `Ctrl+]`, `Ctrl+[` |
| `canvas.fit`, `canvas.fit_selection` | `Maiusc+1`, `Ctrl+0`; `Maiusc+2` |
| `canvas.zoom_in`, `canvas.zoom_out`, `canvas.zoom_reset` | `+`, `Ctrl+=`; `-`, `Ctrl+-`; `0` |
| `canvas.add.*`, `canvas.edit`, `canvas.open`, `canvas.open_url`, `canvas.edge.reverse`, `canvas.color.*`, `canvas.align.*`, `canvas.distribute_*` | nessuno |
| `canvas.open_beside`, `canvas.open_viewer`, `canvas.web_preview`, `canvas.connect`, `canvas.trash_file` (il menu della scheda) | nessuno (`canvas.connect` anche con `C`, vedi sotto) |
| `canvas.pen_menu`, `canvas.color_menu`, `canvas.align_menu`, `canvas.tips.none`, `.start`, `.end` (la riga delle opzioni) | nessuno |

I tasti sono quelli della tabella «Tasti» della lavagna dove fanno la stessa
cosa (ADR 0223), e nessuno è di due comandi. Un tasto senza `Ctrl` né `Alt`
non vale mentre si scrive; vale solo coi modificatori scritti (`Alt+←` resta
dello Scrittoio); prima vince il segno scritto, poi il posto del tasto
(`Maiusc+1`). Dello Scrittoio la tela prende solo lo zoom (`Ctrl+=`, `Ctrl+-`,
`Ctrl+0`, `CANVAS_DECLARED_SHELL_KEYS`), com'era già. Restano com'erano e
diversi dalla tabella: `Ctrl+0` mostra tutto, le frecce spostano di 8
(`Maiusc` 32). Come nel disegno, i tasti della lavagna non si cambiano ancora.
Sulla tastiera italiana le quadre non hanno un tasto loro: `Ctrl+[` si preme
con `Ctrl+è`, dal posto del tasto; `Ctrl+]` non c'è, perché al suo posto sta
`+` e `Ctrl++` resta lo zoom. Porta davanti si fa dal menu o da `Ctrl+/`.

### Il menu della scheda

Il tasto destro su una scheda (non un gruppo, che tiene il suo menu) apre
«Scheda della lavagna»: la testata dice «Scheda di {specie}» col nome (il file,
l'host della pagina, la prima riga del testo), o «{n} schede». Le voci, tutte
comandi del catalogo col loro nome e il loro tasto:

1. la riga degli appunti; Apri (Modifica il testo per una scheda di testo,
   Apri nel visore per un'immagine, Apri la pagina web e Mostra l'anteprima
   per una pagina); Apri a lato, per una scheda di file, se l'host la dà
   (`onOpenPathBeside`); Collega… · `C`;
2. Colore › come scelte esclusive: Nessuno, i sei di JSON Canvas col
   pallino, «Colori delle note ›» coi nove, «Altro…», che apre il selettore
   del kit (i colori in `canvas-format.md`); Disponi › (Porta davanti,
   Porta dietro, Allinea ›, Distribuisci ›); Duplica;
3. in fondo, in rosso: Togli dalla lavagna · `Canc`; Sposta anche il file nel
   cestino, solo con schede di file e se l'host dà `onTrashPath`.

Con più schede non ci sono Apri né Collega…; in sola lettura le voci che
cambiano la lavagna sono spente col perché, non nascoste.

- **`C`** con una scheda scelta comincia il filo da lei, come «Collega…» e il
  pulsante → della testata: il prossimo clic su un'altra scheda lo chiude e la
  colonna torna alla Selezione; `Esc` rinuncia. Con due schede scelte le
  collega, dalla prima alla seconda (D-19 (a)). Senza scheda `C` sceglie lo
  strumento Collega. Mentre si scrive in una scheda, `C` è una lettera.
- **Togli dalla lavagna** (e `Canc`, `Backspace`, e il pulsante della scheda
  mancante) toglie le schede, mai i file, e lo dice nel posto degli avvisi:
  «Tolta dalla lavagna. Il file resta.», «{n} schede tolte dalla lavagna. I
  file restano.», o «Scheda tolta.» senza schede di file. «Annulla» accanto fa
  ciò che fa `Ctrl+Z`; la modifica dopo spegne l'avviso, così «Annulla» annulla
  sempre il togliere e niente altro.
- **Sposta anche il file nel cestino** manda ogni file scelto nel cestino col
  gesto dell'albero (`note.trash`, la domanda del cestino di sistema, l'avviso
  della shell con «Annulla»), una volta per file; poi toglie ogni scheda di
  quel file, anche non scelta, e lo dice («2 schede tolte dalla lavagna.
  «Idee.md» è nel cestino.»). Un file che l'host rifiuta lascia le sue schede e
  l'errore dell'host nel posto degli avvisi. Non è mai la conseguenza di un
  tasto: il comando non ne ha.

## I fili

La geometria è pura, in `editors/canvas/edges.ts`; i gesti li fa `engine.ts`.
Il filo è una curva che esce e arriva in orizzontale (quella che segue i
lati è D6, v2).

- **Tirare.** Passando sopra una scheda compaiono quattro punti a metà dei lati
  (`.canvas-port`, `data-side`). Da un punto, dal pulsante → della testata, con
  `Alt` trascinando il corpo di una scheda o con lo strumento Collega si tira un
  filo (`.canvas-edge-draft`); si rilascia su qualsiasi parte di un'altra
  scheda, quella più in alto se due si coprono (`data-connect-target` mentre si
  tira). Il lato d'arrivo lo sceglie `edges.ts`: i punti di mezzo più vicini;
  partito da un punto, il lato di partenza è quello. `Alt` nel vuoto sposta
  ancora la vista.
- **Nel vuoto** nasce una scheda di testo col lato verso l'altro capo sotto il
  puntatore, collegata e già in scrittura: un commit e un solo `Ctrl+Z`. Un clic
  fermo su un punto, o il rilascio sulla scheda di partenza, non fanno niente.
  `Esc` durante il tiro lo lascia senza traccia.
- **Riattaccare.** Il filo scelto ha due prese (`.canvas-edge-reconnect`): una
  trascinata su un'altra scheda cambia scheda e lato; nel vuoto il filo torna
  dov'era e niente si cancella.
- **Prendere.** Un filo si prende entro 8 px sullo schermo, a ogni zoom, e
  al passaggio si scurisce (`data-hover`); la ricerca guarda solo i fili in
  vista. Sopra una scheda il filo vince solo dove si vede, fuori dalla scheda;
  altrove vince la scheda. Un clic lo sceglie, `Canc` lo toglie con la patch
  `remove-edge` che dice `at`, e `Ctrl+Z` lo rimette al suo posto.
- In sola lettura non ci sono punti né prese, `Alt` non collega, e i fili si
  scelgono per leggerli. La penna scrive e non collega mai (D3 è v2).

## Le maniglie

La scheda scelta ha quattro maniglie agli angoli (`.canvas-resize` con
`data-corner`): un quadratino di 10 px col filo d'accento, dentro un'area di
presa di 20 px centrata sull'angolo. Le due misure restano quelle sullo
schermo a ogni zoom: la tela scrive lo zoom in `--canvas-zoom` sulla scena e
la pelle ci divide le misure. Il cursore dice la direzione (`nwse-resize`,
`nesw-resize`). Le schede non scelte non hanno maniglie; in sola lettura
nessuna scheda ne ha.

- **Tirare un angolo** sposta quell'angolo; l'opposto resta fermo. La misura
  si aggancia a 8 px e non scende sotto 40 px (`CANVAS_MIN_SIZE`).
- **Maiusc** tiene le proporzioni di partenza: vince il lato che cresce di
  più, e l'aggancio non c'è. **Alt** tiene fermo il centro e cambia la misura
  dai due lati. Tutti e due insieme valgono insieme. I tasti si leggono mentre
  si tira: Alt su una maniglia non sposta la lavagna.
- **Un clic** sulla maniglia, senza muovere più di 3 px, non cambia niente.
- **Doppio clic** su una maniglia adatta la scheda al suo contenuto:
  una scheda di testo prende la larghezza del testo senza andare a capo,
  fino a 480 px, e l'altezza che allora le serve, testata compresa (per
  eccesso, sulla griglia di 8 px); un'immagine o un PDF tengono la larghezza
  e prendono le proporzioni del contenuto disegnato; le altre non cambiano.
  L'angolo in alto a sinistra resta.
- **Più schede scelte** hanno una cornice tratteggiata attorno a tutte
  (`.canvas-selection-frame`), con le sue quattro maniglie; quelle delle
  schede si nascondono. Tirarla scala posizioni e misure di tutte, Maiusc e
  Alt compresi, senza aggancio e senza che una scheda scenda sotto 40 px; il
  doppio clic adatta ognuna.
- **Una scheda piccolissima sullo schermo** (un lato sotto 24 px) tiene solo la
  maniglia in basso a destra (`data-handles="one"`), perché le quattro si
  coprirebbero; così anche la cornice.
- **Il dito** prende un angolo della scheda scelta, o della cornice, entro
  22 px sullo schermo: un'area di 44 px. Lo decide il tipo di puntatore
  (`touch`); un pulsante sotto il dito resta suo.

Ogni ridimensionamento, e ogni doppio clic, è un commit e un annulla.
L'inchiostro attaccato a una scheda sta nella scheda e la segue: il file non
cambia, cambia la resa ([L'inchiostro della lavagna](canvas-ink.md)).

## Mentre la penna scrive

Si sa prima di alzare la penna a che cosa si attaccherà il tratto (T69).
Dal primo movimento la scheda che lo terrebbe se finisse adesso ha quattro
lati tratteggiati (`.canvas-ink-frame`, in `.canvas-ink-frames` sullo
stage) e accanto alla punta,
sopra a destra e mai sotto, l'etichetta `.canvas-ink-label` dice «Si attacca a
{nome}» o «Libero sulla lavagna». La regola è quella dell'alzata
(`anchorAt` di `anchor.ts`, col riquadro che cresce in `StrokeBox`), quindi
il tratto si attacca a ciò che l'etichetta diceva; a cavallo di due schede,
dove nessuna ha metà del riquadro, è libero. Con `Alt` tenuto il tratto resta
libero, e l'etichetta lo dice subito anche a punta ferma.

- La lavagna legge i `pointermove` dopo lo strato della penna, uno per
  fotogramma, senza `requestAnimationFrame`: rifà la regola solo quando il
  riquadro cresce o `Alt` cambia, e il testo e i lati solo quando cambia
  l'ancora. La scia e `ink/` non si toccano.
- Etichetta e lati nascono al primo tratto e restano per i tratti dopo,
  nascosti a penna su: un tratto che comincia non crea nodi. La misura
  dell'etichetta (per girarla a sinistra o sotto vicino al bordo) arriva da
  un `ResizeObserver` dopo il layout, mai da una lettura forzata.
- I lati non sono il contorno della scheda: mostrarlo e toglierlo ridipinge
  tutta la scheda, e su una scheda grande (S8) la penna rallentava.
- All'alzata, o se il tratto si annulla, etichetta e lati si nascondono. Il
  lettore di schermo non sente l'etichetta (`aria-hidden`): una regione
  `status` nascosta dice l'ancora del tratto scritto, solo se è cambiata.
  Niente si anima, nemmeno col movimento pieno. La gomma non ha etichetta.

## La lavagna vuota

Una lavagna senza schede, collegamenti né inchiostro mostra al centro tre
righe e tre pulsanti (`chrome/empty.ts`). **Scrivi una scheda** mette una
scheda di testo al centro della vista, già in scrittura. **Aggiungi file…**
apre il selettore del sistema e manda i file scelti al deposito, come un
rilascio; c'è solo dove la lavagna può depositare i file. **Incolla** fa ciò
che fa Ctrl+V, e legge gli appunti solo al clic. Un gruppo vuoto o l'inchiostro
sulla lavagna non la rendono vuota. Alla prima scheda i pulsanti spariscono, e
tornano quando la lavagna torna vuota, annulla compreso. In sola lettura
restano solo le tre righe.

Appunti vuoti, o che il sistema nega, dicono con un avviso normale che non c'è
niente da incollare: non è un errore. Un selettore annullato non fa nulla.

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
  lavagna, con la regola del deposito (`dropFolderFor`, T34): con
  `canvas.drop_folder` su «notes» la cartella degli allegati delle note
  (`files.attachment-folder`, di serie `attachments` alla radice; un nome che
  comincia con `./` sta accanto alla lavagna), su «board» il percorso accanto
  alla lavagna, su «folder» dalla radice del vault. Un clic apre le
  Impostazioni su `canvas.drop_folder`. La scelta della lavagna si segue dal
  vivo; `files.attachment-folder` si legge quando la lavagna si apre.

La banda si rilegge a fine gesto: una rotella che gira non la tocca finché non
si ferma, e una panoramica non ne cambia le voci.

## L'ispettore

La lavagna porta nell'ispettore dello Scrittoio le sue linguette
(`EditorSurface.panels`, `chrome/inspector.ts`), come il disegno. Per ora ce
n'è una, «Schede»; «Scheda», «Fili» e «Fonti» non ci sono ancora. Si offre
solo con la tela in vista: nel Sorgente, o senza nucleo, l'ispettore non ha
linguette della lavagna. Titoli, note a piè di pagina e proprietà, che di una
lavagna non dicono niente, restano fuori (`covers`).

«Schede» elenca tutte le schede in **ordine di lettura** (`readingOrder` in
`reading-order.ts`, una regola pura):

- una scheda sta in un gruppo se il suo rettangolo è tutto dentro quello del
  gruppo, come quando la tela sposta un gruppo; conta il gruppo più piccolo che
  la contiene. Due gruppi identici non si contengono a vicenda: quello sotto
  (prima nell'array) contiene l'altro;
- a ogni livello vengono prima i gruppi, poi le altre schede; dopo un gruppo
  il suo contenuto, rientrato, con le stesse regole;
- le schede vanno in righe, dall'alto in basso, e ogni riga da sinistra a
  destra. Due schede stanno sulla stessa riga se si sovrappongono in altezza
  per più di metà della più bassa; la riga la apre la scheda più in alto. A
  parità di tutto viene prima quella sotto.

Ogni riga ha la figura, il nome (l'etichetta del gruppo, la prima riga del
testo, il file senza cartelle, l'host della pagina web) e la specie. Il filtro
tiene le schede col nome che contiene ciò che si scrive (senza badare a
maiuscole e accenti) e della specie scelta (note, testi, gruppi, PDF), coi
gruppi che le contengono. Un clic, Invio o Spazio porta la vista sulla scheda
e la sceglie (`revealSource` della tela, al byte dove comincia l'oggetto della
scheda); la riga resta segnata finché la scelta della lavagna non cambia per
un'altra strada. Le frecce, Inizio, Fine e PagSu/PagGiù muovono il fuoco fra
le righe, con una sola fermata del Tab.

L'elenco si rilegge a fine gesto (ogni commit) e quando arriva un testo nuovo.
Oltre 500 righe disegna solo quelle che si vedono, più la fermata del Tab.
