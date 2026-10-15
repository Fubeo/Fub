# Disegni, spessore variabile

> **Per chi:** chi vuole un contorno che si assottiglia e si allarga, come
> la linea di un pennino o di un pennello, senza disegnarne i bordi a mano.
> **Risultato:** sapere come lo strumento Spessore allarga e stringe un
> contorno dove si vuole, che cosa fanno i profili del menu «Contorno», e
> come la linea vive con gli altri comandi.

Dal [livello Esperto](drawing-expert.md) lo strumento **Spessore** e i
**profili** del menu «Contorno» fanno di un contorno una **linea a spessore
variabile**: una linea centrale, con un profilo di larghezze lungo il
percorso, a sinistra e a destra. Nel file è una forma piena del colore del
contorno, che ogni programma mostra uguale, e FubDraw ne ritrova la linea e
il profilo: [Formato della scena, spessore
variabile](../reference/scene-format-width.md). Fra due punti del profilo la
larghezza cambia morbida, senza scalini, e non esce mai dai valori dei due
punti. Ogni cambio è un passo solo di annulla.

## Lo strumento Spessore

Lo Spessore (`W`, la lettera dello strumento Larghezza di Illustrator, che
là vuole `Maiusc`) sta nella barra dopo le Forbici. Le regole stanno in
`apps/client/src/editors/spatial/tools/width.ts` e
`apps/client/src/editors/spatial/tools/profile.ts`.

- **Trascinare da un contorno** lo allarga o lo stringe lì: dove si preme
  nasce un punto dello spessore, e i due lati cambiano insieme di quanto il
  puntatore si allontana dalla linea o le si avvicina. Con `Alt` cambia
  soltanto il lato che si tira. Chi preme su un lato e va verso la linea lo
  stringe, fino a zero e non oltre; chi preme proprio sulla linea tira la
  parte verso cui va.
- **La forma diventa una linea a spessore variabile** al primo cambio, con
  gli estremi e gli angoli del suo contorno. Senza riempimento la linea
  prende il posto della forma e il suo id; con il riempimento la forma
  diventa un gruppo, come con [«Contorno in
  tracciato»](drawing-paths.md#contorno-in-tracciato): il riempimento sotto,
  la linea sopra. La linea di un rettangolo, di un'ellisse o di un poligono
  fa il giro e comincia dove comincia il loro tracciato, come in SVG.
- **I punti dello spessore** si vedono sulla linea sotto il puntatore: un
  rombo sulla linea e una maniglia per lato. Trascinare una maniglia allarga
  o stringe quel punto, con le stesse regole; trascinare il rombo di un punto
  in mezzo lo sposta lungo la linea, fra i suoi vicini. I punti ai capi
  restano ai capi: preso al centro, un capo si allarga.
- **Mentre si trascina** il foglio mostra il contorno nuovo, la linea
  centrale coi suoi punti, e accanto al puntatore la larghezza del punto che
  cambia.
- **Un tocco su un punto lo sceglie**, e lo si dice: «Punto 2 di 3 scelto:
  6 a sinistra, 6 a destra.» `Canc` lo toglie, mai l'oggetto; i punti ai capi
  restano, e anche l'ultima larghezza della linea. `Esc` lo lascia. Un tocco
  sulla linea non aggiunge un punto: per quello si trascina.
- **Le misure del punto scelto**: `Invio` o un doppio tocco aprono la
  finestra «Punto dello spessore», con le larghezze a sinistra e a destra
  nell'unità del documento e, per un punto in mezzo, dove sta lungo la
  linea, in percentuale. Un campo non toccato resta esatto, e se non cambia
  niente la linea resta com'è.
- **Sinistra e destra** sono di chi percorre la linea dal suo inizio: per
  una linea disegnata verso destra la sinistra è sopra.
- **Dove non si può lo si dice**: una forma senza un contorno che si vede,
  un contorno tratteggiato, un tracciato di più pezzi, una freccia, un tratto
  a penna, un testo, un'immagine e le parti di altri programmi restano come
  sono.
- **Dalla tastiera** il cursore dice dove lavora: «Contorno di Linea, Nero,
  largo 4 qui», o il punto che c'è. `Spazio`, le frecce e `Spazio` allargano
  o stringono come un trascinamento, e su un punto in mezzo lo spostano; `Esc`
  a metà lascia tutto com'era.

## I profili

Nel menu «Contorno» della barra della selezione, dopo gli angoli, i profili
pronti cambiano tutte le linee scelte in una volta, e dentro i gruppi le
loro forme:

- **Uniforme**: la stessa larghezza lungo tutta la linea. La linea torna un
  contorno qualunque, spesso quanto il suo punto più largo, del suo colore,
  con gli estremi e gli angoli che aveva.
- **Affusolato**: pieno all'inizio, a punta alla fine.
- **A goccia**: dalla punta cresce fino alla fine, che diventa tonda.
- **A fuso**: a punta ai due capi, pieno a metà.

Il profilo nuovo è largo quanto il punto più largo di quello di prima, e un
contorno uniforme diventa la linea del profilo con il suo spessore. Il menu
segna il profilo che le linee scelte hanno tutte, e niente se sono diverse
o se una ha punti suoi. **«Rovescia lungo la linea»** porta l'inizio del
profilo alla fine, e **«Scambia i lati»** la sinistra a destra; tutte e due
sono spente se nessuna linea scelta ha un profilo che cambi. Ogni scelta è
un passo, «Profilo dello spessore», e dice quante linee ha cambiato e
quante ne ha lasciate.

## Con gli altri comandi

- **Lo spessore e il colore**: nel [pannello delle
  proprietà](drawing-properties.md) lo spessore di una linea è il suo punto
  più largo, e cambiarlo allarga o stringe tutto il profilo nella stessa
  proporzione. Il colore è quello del contorno, anche se nel file riempie la
  forma.
- **Estremi e angoli** del menu «Contorno» valgono anche per le linee a
  spessore variabile; il tratteggio no: quando sono scelte soltanto loro il
  menu lo spegne, e il pannello non lo mostra.
- **Lo strumento Nodi** modifica la linea centrale, e il profilo la segue:
  ogni punto resta alla stessa frazione della lunghezza. La linea resta di un
  pezzo: spezzarla ai nodi non si fa.
- **Le Forbici e il Coltello** non la tagliano: prima «Oggetto in
  tracciato».
- **«Applica trasformazione»** porta la trasformazione nella linea centrale,
  e le larghezze crescono o calano con la scala; uno specchio scambia i
  lati, così il contorno resta quello che si vedeva.
- **«Oggetto in tracciato»** e **«Contorno in tracciato»** ne fanno il
  tracciato pieno che si vede, senza la linea e il profilo; **«Semplifica…»**
  semplifica la linea centrale, e il contorno si rifà; lo **Scostamento** e
  le **operazioni booleane** la trattano come la forma piena che è.
- **Nell'albero e per chi legge col lettore di schermo** si chiama «Linea a
  spessore variabile», col suo colore.
