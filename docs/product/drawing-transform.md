# Disegni, trasformare

> **Per chi:** chi ridimensiona o ruota gli oggetti di un disegno.
> **Risultato:** sapere che cosa fanno le maniglie della cornice e i tasti
> che le accompagnano, e che cosa resta scritto nel file del
> [disegno](drawing.md).

Con lo strumento Selezione, a ogni livello, gli oggetti scelti stanno in una
cornice: otto maniglie quadrate, una per angolo e una per lato, e sopra una
maniglia tonda, legata al lato in alto, che ruota. La cornice comprende il
contorno. Si vede finché il disegno si modifica, e si toglie di mezzo mentre
si sposta la selezione o si sceglie col riquadro
(`apps/client/src/editors/spatial/tools/frame.ts`).

## La cornice

- Un oggetto solo ha la sua cornice, che ruota con lui: un rettangolo girato
  di 30° si ridimensiona lungo i suoi lati, senza inclinarsi.
- Più oggetti hanno il riquadro che li contiene tutti. Dopo una rotazione la
  cornice resta girata con loro, e uno spostamento la porta con sé, finché la
  selezione o il disegno non cambiano in altro modo: rotazioni di fila girano
  attorno allo stesso centro.
- Le maniglie dei lati si nascondono quando la cornice, sullo schermo, è più
  corta di 32 pixel, così gli angoli restano facili da prendere. Una linea
  dritta, alta zero, ha soltanto le maniglie alle estremità e quella tonda.
- Sopra una maniglia il puntatore mostra il verso in cui ridimensiona,
  girato con la cornice, o la mano che ruota. Fuori dalla cornice una
  maniglia si prende entro 8 pixel dal suo centro col mouse, 10 con la penna
  e 22 col dito; dentro, entro 6. Dentro una cornice più corta di 24 pixel
  vince l'oggetto, che si sposta.
- Il segno di un collegamento scelto si scosta in alto a destra, per lasciare
  libera la maniglia del suo angolo.

## Ridimensionare

- Una maniglia d'angolo tira due bordi, una di lato un bordo solo; il bordo
  opposto resta fermo, e con `Alt` resta fermo il centro.
- Gli angoli tengono le proporzioni dei gruppi, dei collegamenti, dei tratti
  a penna, dei testi e delle immagini, che deformati non sarebbero più loro.
  Le forme le tengono con `Maiusc`; per gli altri `Maiusc` le lascia libere.
- Un [testo in area](drawing-typography.md#il-testo-in-area) scelto da solo,
  con la parte «Testo in area e su tracciato» dell'Esperto, cambia la
  larghezza del suo riquadro, non il corpo: le maniglie tirano di lato, il
  bordo opposto resta dov'è e il testo va di nuovo a capo mentre si
  trascina. Senza quella parte la cornice lo scala come ogni oggetto.
- Con l'aggancio alla griglia, a cornice dritta, il bordo tirato va sulla
  riga più vicina. Conta la geometria, senza il contorno, come negli
  spostamenti; `Ctrl` o `⌘` lascia libero.
- Dal livello Standard il bordo tirato si ferma anche in linea con gli altri
  oggetti e con la pagina, e una linea lo mostra: [Disegni, guide
  intelligenti](drawing-guides.md).
- Un lato non scende sotto un'unità, e l'oggetto non si ribalta tirando oltre
  il bordo opposto.
- Mentre si tira, sotto la cornice si leggono le misure, contorno compreso;
  alla fine si annunciano, per esempio «Misure: 150 × 75.».

## Ruotare

- La maniglia tonda ruota la selezione attorno al centro della cornice.
- L'angolo si ferma da solo su un angolo retto quando ci passa a meno di
  1,5°; `Ctrl` o `⌘` lo lascia libero, a decimi di grado.
- Con `Maiusc` l'angolo che l'oggetto avrà va a multipli di 15°, contati
  dall'orizzontale e non da dove si è partiti.
- Mentre si ruota, sotto la cornice si legge quell'angolo; alla fine si
  annuncia di quanto si è ruotato e in che senso, per esempio «Rotazione di
  90° in senso orario.».

## Da tastiera

`]` ruota la selezione di 15° in senso orario e `[` in senso antiorario; `}` e
`{` di 90°. Valgono come si scrivono, anche con `AltGr`: su una tastiera
italiana sono `AltGr++` e `AltGr+è`, con `Maiusc` per le graffe. Con `Ctrl` le
parentesi restano all'ordine, come dice «Disporre» in [Disegni](drawing.md).
Come per le frecce, i colpi di fila si annullano insieme.

## Che cosa si scrive

Ogni gesto è un passo di annulla, «Ridimensionamento» o «Rotazione», e scrive
un `transform` sugli oggetti, come la trasformazione in numeri del livello
Esperto: la forma resta scritta com'era, lo spessore del contorno segue la
scala, e la pagina cresce se un oggetto ne esce. Un tocco su una maniglia,
senza tirarla, non cambia niente, ed `Esc` a metà del gesto lascia tutto
com'era. Se un oggetto diventerebbe troppo piccolo per scriverne la
trasformazione, niente cambia, e lo si sente dire.
