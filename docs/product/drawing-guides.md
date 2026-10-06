# Disegni, guide intelligenti

> **Per chi:** chi sposta, ridimensiona o disegna, e vuole le cose in linea
> senza contare.
> **Risultato:** sapere quando le guide agganciano, che cosa mostrano e
> dicono, e come si spengono o si scavalcano.

Dal livello Standard, mentre si sposta, si ridimensiona o si disegna, ciò che
si muove si ferma in linea con gli altri oggetti e con la pagina, e una linea
sottile lo mostra. Come la griglia, le guide sono un aiuto della vista e non
entrano nel file del [disegno](drawing.md)
(`apps/client/src/editors/spatial/tools/guides.ts`).

## Dove agganciano

- **Spostando** con la Selezione, i bordi e il centro della geometria scelta
  si fermano sui bordi e sui centri degli altri oggetti e della pagina, ogni
  asse per conto suo. Conta la geometria, senza il contorno, come con la
  griglia.
- Spostando, ci si ferma anche **a distanze uguali**: dove lo spazio dal
  vicino è uguale a quello fra due oggetti della stessa fila, o a metà fra i
  due vicini. A pari scarto vince la linea. Un oggetto su cui la selezione
  sta, come lo sfondo di una scheda, non è un vicino.
- **Ridimensionando**, a cornice dritta, il bordo tirato si ferma sul
  bersaglio più vicino. Con le proporzioni tenute si ferma il bordo che, sullo
  schermo, arriva più vicino a un bersaglio, e l'altro lo segue. Un bersaglio
  oltre il bordo fermo non vale: l'oggetto non si ribalta.
- **Disegnando** una forma, il primo punto e quello che si tira.
- Con lo strumento **Nodi**, il nodo trascinato si ferma in linea con gli
  altri oggetti e coi nodi del tracciato che restano fermi; una maniglia anche
  col suo nodo.
- Con la penna di **Bézier**, il nodo nuovo e la maniglia che si tira si
  fermano in linea con gli oggetti, con la pagina e coi nodi già posati, anche
  prima del tocco, nel segmento che verrebbe.

I bersagli sono la pagina e gli oggetti che si vedono nella vista, anche
quelli dei livelli bloccati, che non si scelgono ma si guardano; quelli dei
livelli nascosti no, e nemmeno ciò che sta fuori dalla vista. Un valore si
aggancia entro 6 pixel dello schermo col mouse, 8 con la penna e 12 col dito,
uguali a ogni zoom.

Con l'aggancio alla griglia acceso, lungo ciascun asse vince il più vicino fra
la riga e il bersaglio; a pari distanza il bersaglio.

## Che cosa si vede e si sente

- Una linea per ogni bordo o centro in linea, da ciò che si muove fino al
  bersaglio, con una piccola croce dove passa per un bordo o per un centro.
- Sulla linea, la distanza dal bersaglio, scritta una volta sola per
  bersaglio: sulla linea dei centri, se c'è.
- A distanze uguali, ogni spazio uguale ha la sua misura, e la distanza dal
  bersaglio in linea non si ripete.

Le linee sono nette, sul mezzo pixel, nel colore d'accento, sopra a tutto; col
contrasto forzato prendono il colore di sistema della selezione. Se ne vanno
quando il gesto finisce, o con `Esc`.

Alla fine del gesto l'annuncio dice anche, per ciascun asse, a che cosa ci si
è agganciati, un oggetto prima della pagina: «1 oggetto spostato. Agganciato:
il bordo superiore in linea con quello di Rettangolo, Arancione.», o
«Agganciato: a distanze uguali in orizzontale, 60; …».

## Misurare con Alt

Con la Selezione e qualcosa di scelto, tenendo premuto `Alt` senza
trascinare, si leggono le distanze fra la geometria scelta e quella
dell'oggetto sotto il puntatore, bloccati compresi, o della pagina, se il
puntatore ci sta sopra fuori dagli oggetti. Il riquadro misurato si vede
tratteggiato. Una misura sta a metà della parte che i due riquadri hanno in
comune sull'altro asse; se non ne hanno, all'altezza del centro della
selezione, e il bordo dell'altro la raggiunge tratteggiato. Se i riquadri si
sovrappongono, si misura fra i bordi dello stesso lato. Lasciato `Alt`, le
misure se ne vanno. Valgono anche con le guide spente.

## Accenderle e scavalcarle

«Pagina e griglia» ha la casella **Guide intelligenti**, accesa la prima
volta. Si ricorda con la griglia, su questa macchina, e una griglia ricordata
prima che le guide ci fossero le ha accese. Il cambiamento si annuncia,
«Guide intelligenti accese.» o «Guide intelligenti spente.», e chi monta
l'editor lo legge e lo sceglie in `grid.guides`, con `grid`, `setGrid` e
`onGridChange`.

Tenendo premuto `Ctrl` o `⌘` mentre si trascina, si posa libero, senza la
griglia e senza le guide. Le frecce non agganciano alle guide, e nemmeno il
tocco che apre un testo nuovo: senza trascinare non c'è una linea che mostri
dove si andrebbe.

All'Essenziale le guide non ci sono. Nel Personalizzato sono la parte «Guide
intelligenti», anche senza «Pagina e griglia»: il pulsante, allora, ha
soltanto la loro casella. `?` elenca i loro tasti.
