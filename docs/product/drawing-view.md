# Disegni, vista ruotata, gesti e menu radiale

> **Per chi:** chi disegna con la penna o con le dita, su una tavoletta o su
> uno schermo che si tocca, e vuole girare il foglio come un quaderno,
> annullare con un tocco e avere gli strumenti sotto la mano.
> **Risultato:** sapere come si gira la vista e la si raddrizza, che cosa
> fanno i tocchi di due e di tre dita, come si sceglie dal menu radiale col
> mouse, con la penna, col dito e da tastiera, e come si regola la pressione
> della penna.

Dal [livello Standard](drawing.md#il-livello-standard) il foglio gira come un
quaderno sul tavolo, le dita annullano e ripetono, e un menu attorno al
puntatore porta gli strumenti e i colori di prima. Niente di tutto questo
cambia il disegno: l'angolo è della vista, e il file resta quello che sarebbe
stato col foglio dritto.

## Girare il foglio

La vista si gira:

- coi tasti **`4`** e **`6`**, a sinistra e a destra di 15° per volta,
  attorno al centro di ciò che si vede; **`5`** la raddrizza;
- con la rotella tenendo **`Ctrl+Maiusc`** (o `⌘+Maiusc`): 15° per scatto,
  attorno al puntatore;
- con **due dita** che ruotano sul foglio, insieme allo zoom e allo
  spostamento. Il foglio comincia a girare quando le dita hanno ruotato di
  8°, così un pizzico per lo zoom non lo gira per sbaglio, e parte da dov'è,
  senza scatti. Lasciato a meno di 5° da un angolo retto, ci si posa;
- con **Ruota la vista a sinistra**, **Ruota la vista a destra** e
  **Raddrizza la vista**, in «Pagina e griglia».

L'angolo va da −180° a 180°, in senso orario. Sul foglio girato, accanto allo
zoom, un pulsante lo dice, «30°: raddrizza la vista», e un clic lo raddrizza.
Ogni passo si annuncia: «Vista ruotata di 30°.», «Vista diritta.». Girare la
vista non è un passo di annulla e non modifica il documento.

Sul foglio girato si disegna come sul quaderno girato: il tratto va dove va
la penna, un rettangolo ha i lati lungo quelli del disegno, e il testo si
scrive nel verso delle sue righe. Il resto si adatta allo schermo:

- la cornice della selezione gira con gli oggetti, ma le maniglie, i nodi, le
  misure accanto e le scritte restano diritti, e il cursore di ogni maniglia
  punta dove la maniglia tira sullo schermo;
- il clic, l'aggancio alla griglia, alle guide e agli oggetti sono esatti a
  ogni angolo, perché si fanno nel disegno;
- il riquadro tirato sul vuoto è un rettangolo dello schermo: di sbieco
  sceglie con la regola del [Lazo](drawing-selection.md), ciò che racchiude
  per intero;
- le frecce spostano la selezione lungo l'asse del disegno che si vede più
  vicino al loro verso, e con `Ctrl` o `⌘` allargano con `→` e `↓` e
  stringono con `←` e `↑` la misura che si vede in quel verso; il cursore del
  foglio va dove la freccia punta sullo schermo, come il puntatore, e con
  l'aggancio alla griglia di riga in riga;
- la griglia gira col foglio; i righelli aspettano, con una freccia che segna
  l'alto del disegno, e le guide se ne tirano lo stesso
  ([Disegni, righelli e guide](drawing-rulers.md));
- un'immagine messa nel disegno sta in ciò che si vede del foglio.

Tornati all'Essenziale, o tolta la parte nel Personalizzato, la vista si
raddrizza.

## I tocchi delle dita

Un tocco di **due dita** annulla l'ultimo passo, uno di **tre dita** lo
ripete, come sulle tavolette. È un tocco se le dita si appoggiano e si alzano
entro 300 millisecondi e nessuna scorre più di 12 pixel: un pizzico, uno
scorrimento, un tocco lungo e la mano appoggiata mentre la penna è vicina non
lo sono. Se non c'è niente da annullare o da ripetere lo si annuncia,
«Niente da annullare.», perché il dito non vede succedere niente. In sola
lettura i tocchi non fanno niente.

## Il menu radiale

Con uno strumento che disegna, il clic destro sul foglio apre attorno al
puntatore il **menu radiale**: otto voci in cerchio, sempre allo stesso
posto, così la mano impara la direzione e non deve leggere.

- In alto **Annulla**, in basso **Ripeti**, spenti se non c'è niente da fare.
- A destra gli ultimi tre strumenti usati prima di quello in mano: il più
  recente in orizzontale, il secondo sopra, il terzo sotto.
- A sinistra, allo stesso modo, gli ultimi tre colori.

Al centro c'è l'icona dello strumento in mano, in un anello del colore di
adesso. Lo strumento e il colore in mano non sono fra le voci, perché ci sono
già. Finché se ne sono usati meno di tre, completano le voci gli strumenti che
si alternano di più alla penna, a partire da gomma, selezione ed
evidenziatore, e i colori della tavolozza nel loro ordine. L'editor ricorda gli
strumenti e i colori finché il disegno è aperto.

Il menu si apre:

- col **clic destro**. Col tasto ancora giù si va verso la voce e si
  rilascia; rilasciato subito, come fa Windows, il menu resta aperto e si
  sceglie con un clic;
- col **tasto laterale della penna**: tenendolo premuto si appoggia la penna,
  e il menu si apre lì. Si va verso la voce e si alza la penna;
- col **tocco lungo di un dito**, sui sistemi che lo fanno valere come clic
  destro. Il tocco non lascia un punto sul foglio, e il menu resta aperto per
  il tocco che sceglie;
- da tastiera, con **`Maiusc+F10`** o il tasto del menu, al cursore del
  foglio.

Mentre il puntatore è giù conta la direzione: oltre 28 pixel dal centro, la
voce è quella verso cui punta, anche lontano dalle voci, così il gesto può
essere rapido e largo. Rilasciato al centro, o su una voce spenta, il menu
resta aperto. Sopra il cerchio una scritta dice la voce sotto il puntatore,
col suo tasto: «Gomma · E».

`Esc`, un clic fuori, che non arriva al foglio, o un altro clic destro
chiudono il menu senza scegliere; si chiude anche se la finestra cambia
misura o perde il fuoco. Scelta una voce, il menu si chiude e il fuoco torna
dov'era.

Da tastiera il fuoco va alla prima voce che si può scegliere. Le frecce
girano attorno al cerchio, `→` e `↓` in senso orario, `←` e `↑` al
contrario, `Home` e `Fine` vanno alla prima e all'ultima voce, e `Invio` o
`Spazio` sceglie. Le cifre scelgono la voce nella direzione che hanno sul
tastierino numerico: `8` in alto, `9` in alto a destra, `6` a destra, fino a
`7` in alto a sinistra; `5` chiude. Il lettore di schermo legge un menu con le
sue voci e le loro scorciatoie.

Il menu radiale lascia il posto agli altri menu del clic destro: sui righelli
e sulle guide si aprono i loro, con la Selezione e il Lazo quello della
selezione ([Disegni, selezione](drawing-selection.md)), e `Maiusc+F10` apre
quello della selezione anche con gli altri strumenti, quando c'è qualcosa di
scelto. In sola lettura il menu radiale non c'è.

Il menu resta diritto anche sul foglio girato. Compare crescendo appena dal
centro; col movimento ridotto del sistema compare e sparisce senza
animazione.

## Penna e dita

**«Penna e dita…»**, in «Pagina e griglia», apre la finestra con le due
caselle delle dita, **Due dita che ruotano girano il foglio** e **Un tocco di
due dita annulla, uno di tre ripete**, accese di partenza, e la curva della
pressione della penna, con tre manopole:

- **Morbidezza**, da −100% a 100%: sopra lo zero una pressione leggera dà già
  molto, sotto ne serve di più;
- **Pressione minima**, fino al 50%: quella che dà anche il tocco più
  leggero, perché un tratto leggero non sparisca;
- **Pieno da**, dal 50% al 100%: da dove la penna dà già tutto, per chi non
  vuole premere fino in fondo.

Accanto alle manopole si vede la curva, e sotto c'è il riquadro di prova: la
penna ci disegna con la curva scelta, e un punto sulla curva dice quanto si
sta premendo. Senza prove il riquadro mostra un tratto d'esempio, sottile ai
capi e pieno a metà. **Ripristina la curva** torna alla diagonale, la
pressione come la dà la penna, e **Pulisci la prova** toglie i tratti di
prova. Le scelte valgono con **OK**: «Penna e dita aggiornate.».

Come la griglia, sono scelte di questo dispositivo, perché ogni tavoletta e
ogni mano premono a modo loro: non entrano nel file e si ricordano su questa
macchina, per tutti i disegni. La curva vale soltanto per la penna, l'unica
che misura la pressione. Il tratto scritto nel file ha la pressione già
curvata, quella che si è vista, così chi lo apre altrove lo vede uguale.

## Nel file

L'angolo della vista, i tocchi e il menu non entrano nel file. Un tratto
disegnato sul foglio girato è scritto come sul foglio dritto, nelle
coordinate del disegno, e l'azimut della penna si misura dall'asse x del
disegno, non dello schermo ([Formato della scena](../reference/scene-format.md)).

## Chi monta l'editor

La vista girata sta in `apps/client/src/editors/spatial/view.ts`, coi conti
fra lo schermo e il disegno a ogni angolo; il menu radiale in
`tools/radial.ts`, la curva della pressione in `pen/pressure.ts`, la finestra
«Penna e dita» in `tools/touch-dialog.ts`, i gesti in `editor.ts`. Le due
caselle e la curva sono `twist`, `taps` e `pen` nella griglia che l'editor
riceve e restituisce con `onGridChange`.

Non c'è niente da montare: la vista ruotata, i gesti e il menu radiale
vengono col livello Standard, e nel Personalizzato sono la parte «Vista
ruotata, gesti e menu radiale» ([Disegni, livello Personalizzato](drawing-custom.md)).
