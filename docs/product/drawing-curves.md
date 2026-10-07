# Disegni, curve e tagli

> **Per chi:** chi disegna curve morbide senza tirare maniglie, e chi
> ritaglia e ricuce i tracciati come in Illustrator.
> **Risultato:** sapere come la Curvatura fa passare un tracciato per i
> punti, che cosa tagliano le Forbici e il Coltello e dove vanno i pezzi, e
> come «Unisci» e lo strumento Nodi ricuciono i tracciati.

Dal [livello Esperto](drawing-expert.md) ci sono quattro modi di lavorare
sui tracciati oltre ai nodi: la **Curvatura**, il secondo modo della penna
di Bézier; le **Forbici**, che con un trascinamento sono il **Coltello**;
**«Unisci»**, nel menu [«Tracciato»](drawing-paths.md); e, nello strumento
Nodi, l'unione dei capi di due forme e **«Distribuisci»**. Ogni comando è un
passo solo di annulla, e ciò che scrive lo strumento Nodi lo ritrova.

## Curvatura

`B` premuto di nuovo passa dalla penna di Bézier alla Curvatura, e ritorno:
il pulsante della barra prende il suo nome e la sua icona. Si posano
soltanto i punti, e la curva passa morbida per tutti, come con lo strumento
Curvatura di Illustrator. Il tracciato si scrive quando si conclude, come
quello della penna, sul livello corrente e col colore e lo spessore della
barra. Le regole stanno in `apps/client/src/editors/spatial/tools/curvature.ts`.

- **Un punto liscio** prende la direzione dai due vicini, con la
  Catmull-Rom centripeta: niente cappi né punte anche fra punti a distanze
  molto diverse. Le maniglie si allungano quanto gira il tracciato, perché
  dei punti a passi uguali su un cerchio diano il cerchio: tre punti fanno un
  arco, quattro chiusi un cerchio, a meno di tre decimillesimi del raggio.
- **Uno spigolo** si posa con `Alt` tenuto, o col doppio tocco subito dopo
  aver posato il punto; fra due spigoli c'è una linea. Un tocco su un punto
  in mezzo lo fa spigolo o liscio, e trascinarlo lo sposta: cambiano
  soltanto i segmenti attorno a lui e ai suoi vicini lisci.
- **Chiudere e concludere**, come con la penna: un tocco sul primo punto
  chiude il tracciato; uno sull'ultimo, `Invio` o `Esc` lo concludono, ma
  non il tocco che segue subito il punto posato, che è il doppio tocco dello
  spigolo. `Canc` toglie l'ultimo punto, e Annulla percorre i passi del
  tracciato in corso.
- **Su un tracciato scelto** la Curvatura lavora sui suoi nodi: trascinare un
  nodo lo sposta, e le curve dei vicini lisci lo seguono; trascinare da un
  segmento vi posa un punto, e la curva lo segue. Un tocco sul segmento posa
  un punto senza cambiare la forma; due tocchi su un punto lo fanno spigolo,
  un tocco lo sceglie e `Canc` lo toglie, e fra due spigoli resta una linea.
  Lo spigolo di un rettangolo si sposta coi suoi lati diritti.
- **I punti si agganciano** come i nodi della penna: alla griglia, e con le
  [guide intelligenti](drawing-guides.md) in linea con gli oggetti e con gli
  altri punti.
- **Dalla tastiera** `Spazio` e di nuovo `Spazio` posano un punto liscio
  dove sta il cursore, e su un punto in mezzo lo fanno liscio o spigolo.
  `Maiusc+C` e `Maiusc+S` fanno spigolo o liscio il punto sotto il cursore,
  o l'ultimo posato. Ogni punto si dice col numero, il tipo e la posizione:
  «Nodo 2, liscio: x 100, y 100.»
- **Si scrivono cubiche**, e i nodi hanno il tipo che si vede. Mentre si
  disegna non ci sono maniglie da tirare: la curva dipende soltanto dai
  punti, e le maniglie si modificano poi con lo strumento Nodi.

## Forbici

Le Forbici (`C`, la lettera di Illustrator) stanno nella barra accanto al
Costruttore di forme. Le regole stanno in
`apps/client/src/editors/spatial/tools/cut.ts` e
`apps/client/src/editors/spatial/tools/scissors.ts`.

- **Un tocco sul contorno** di un tracciato o di una forma lo taglia lì, e
  vicino a un nodo nel nodo. Il puntatore sopra un contorno mostra il
  contorno, i nodi e una croce dove taglierebbe.
- **Ogni pezzo diventa un oggetto a sé**, da spostare da solo: il primo
  prende il posto della forma, col suo id e i sottotracciati che il taglio
  non tocca; gli altri le stanno sopra, uno sull'altro, col suo aspetto e la
  sua trasformazione. I pezzi restano scelti; di una forma in un gruppo resta
  scelto il gruppo.
- **Una forma chiusa tagliata una volta si apre**: il punto tagliato diventa
  i due capi, e l'oggetto resta uno, aperto. Un secondo taglio la divide.
  Un rettangolo, un'ellisse o un poligono diventano tracciati.
- **Le curve restano esatte**: una cubica si divide nelle due che disegnano
  la stessa curva, un arco in due archi.
- **Dove non si taglia lo si dice**: su un capo di un tracciato aperto non
  c'è niente da tagliare; fuori dai contorni le Forbici non toccano niente;
  una freccia e una linea a spessore variabile chiedono prima «Oggetto in
  tracciato»; un tratto a penna, un testo e un'immagine non hanno un
  contorno da tagliare. Sopra una forma che non si taglia, le Forbici trovano
  il contorno di quella sotto.
- **Dalla tastiera** il cursore dice dove taglierebbe, «x 250, y 150:
  Contorno di Rettangolo, Verde, Spazio taglia qui», o in quale nodo; `Spazio`
  e di nuovo `Spazio` tagliano lì.

## Coltello

Trascinare con le Forbici è il Coltello, che in Illustrator è uno strumento
a parte: la scia segue il puntatore, e il taglio si fa quando si rilascia.

- **Divide le forme chiuse** che il tratto attraversa da parte a parte,
  lungo il tratto: ogni parte è una forma chiusa col suo aspetto, e la prima
  tiene l'id. Un tratto che entra e non esce non divide niente, e lo si dice.
- **Taglia i tracciati aperti** dove il tratto li incrocia, come tanti tocchi
  delle Forbici.
- **Con `Alt`** il taglio è dritto, dal primo punto all'ultimo, e la scia lo
  mostra.
- **Taglia gli oggetti scelti**, o senza selezione tutti quelli che
  attraversa; i pezzi sono la selezione dopo. Frecce, linee a [spessore
  variabile](drawing-width.md), tratti a penna, testi, immagini e parti di
  altri programmi restano interi, e lo si dice: «1
  oggetto attraversato resta intero». Resta intera anche una forma con
  sottotracciati chiusi e aperti insieme.
- **Dalla tastiera** `Spazio` preme, le frecce tirano il tratto, `Spazio`
  lo rilascia ed `Esc` lo annulla.

## Unisci

«Unisci» (`Ctrl+J`, o `⌘J`), nel menu «Tracciato», fa dei tracciati aperti
scelti uno solo, come in Illustrator.

- **Ogni volta i due capi più vicini** di due tracciati diversi, finché ne
  resta uno. Due capi che sullo schermo stanno entro 2 pixel diventano un
  nodo solo, a metà strada; altrimenti li unisce una linea, e lo si dice: «1
  linea nuova unisce capi lontani.» Alla fine il tracciato si chiude se i
  suoi capi si toccano.
- **Un tracciato solo si chiude**, con una linea se i capi sono lontani. Una
  linea sola non ha niente da chiudere.
- **Resta il tracciato più in basso**, col suo id, il suo aspetto e la sua
  trasformazione, come nelle operazioni booleane: gli altri arrivano nelle
  sue coordinate e se ne vanno. Una linea o una spezzata diventano un
  tracciato.
- **Si uniscono soltanto i capi aperti**: un tracciato chiuso, un gruppo, un
  testo, un'immagine, una freccia o un tratto a penna fra gli scelti fermano
  il comando, che dice perché. Senza un tracciato aperto fra gli scelti la
  voce del menu è spenta, e lo dice.

## Nello strumento Nodi

- **«Unisci i capi»** (`Maiusc+J`, o `Ctrl+J` come «Unisci») unisce anche i
  capi di due forme: scelto un capo dell'una e uno dell'altra, il
  sottotracciato della seconda passa nella prima, la più in basso, e la
  seconda se ne va se resta vuota. Due capi entro 2 pixel dello schermo
  diventano un nodo solo, a metà strada, anche di un tracciato solo.
- **«Distribuisci orizzontalmente» e «Distribuisci verticalmente»**, nel
  menu «Allinea i nodi», mettono i nodi scelti a passi uguali fra il primo e
  l'ultimo, che restano dove sono. Chiedono almeno tre nodi, anche di forme
  diverse; con meno le voci sono spente, e lo dicono.
