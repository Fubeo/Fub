# Disegni, livello Esperto

> **Per chi:** chi disegna in un vault e vuole il file sotto il disegno.
> **Risultato:** sapere che cosa aggiunge il livello Esperto a un disegno, e
> come si legge e si cambia un oggetto attributo per attributo.

Il livello Esperto è il terzo dei livelli d'interfaccia dell'editor dei
[disegni](drawing.md), dopo l'Essenziale e lo Standard, e comprende tutto ciò
che offrono loro. Si sceglie come gli altri, nelle Impostazioni, con «Livello
d'interfaccia». Come gli altri filtra soltanto ciò che si offre: un disegno si
apre uguale a ogni livello.

## Attributi

«Attributi», nella barra (`Ctrl+Maiusc+X`, come l'editor XML di Inkscape),
apre accanto al foglio il tag dell'oggetto scelto come lo scrive il file, una
riga per attributo; sotto l'albero degli oggetti, se è aperto anche quello. È
il modo più corto di dare un valore preciso, e per chi non vede il foglio una
tabella da leggere, col nome dell'attributo come nome del campo. Le regole
stanno in `apps/client/src/editors/spatial/tools/attributes.ts`, il pannello
in `apps/client/src/editors/spatial/tools/inspector.ts`.

- **Le righe** sono l'id e gli attributi scritti, nell'ordine canonico del
  formato, coi valori come sono scritti: le entità risolte, le unità
  com'erano.
- **Un valore si cambia** scrivendolo e premendo `Invio`, o lasciando il
  campo; una scelta, come `stroke-linecap` o il carattere di un testo, parte
  quando si fa. Si scrive come lo scrive FubDraw: un colore `#rrggbb` o
  `none`, anche se lo si è scritto `#F00` o `red`; le lunghezze in unità
  utente con al più due decimali e le opacità con quattro; una `transform`
  come una `matrix` sola, tolta se è l'identità; un `d` coi comandi assoluti.
  Ogni cambio è un passo, che si annulla col suo nome.
- **Un valore che il formato non ammette non parte.** Resta scritto, il campo
  è segnato e sotto c'è che cosa ci vuole; `Invio` lo dice anche a voce.
  `Esc` riporta il valore com'era e, di nuovo, torna al foglio. In un elenco
  di punti o in un percorso `Maiusc+Invio` va a capo.
- **Si toglie** col pulsante della riga, e **si aggiunge** dal riquadro in
  fondo: il nome si sceglie fra quelli che servono all'oggetto, niente
  contorno su un tratto a penna, che è tutto riempimento, e niente carattere
  su un rettangolo. Il valore parte da quello iniziale di SVG, che non cambia
  niente.
- **Il carattere di un testo** si sceglie fra Inter, Literata e JetBrains
  Mono, che Fub porta con sé. Un altro carattere, scritto da un altro
  programma, resta fra le scelte finché non lo si cambia.
- **Ciò che ha un padrone si legge soltanto**, con la ragione accanto: il `d`
  di un tratto, che viene dall'inchiostro, e quello di una freccia, che viene
  dalla sua geometria; gli attributi `fub:*`, che scrive FubDraw; quelli di
  altri programmi, che FubDraw conserva; gli `href` di collegamenti e
  immagini, che hanno i loro comandi; un valore oltre i 100 000 caratteri.
  Cambiare lo spessore di una freccia ne ridisegna la punta.
- **L'id si cambia** nella prima riga. Un nome comincia con una lettera o `_`
  e continua con lettere, cifre, `_`, `.` e `-`, fino a 64 caratteri; è unico
  nel disegno, e gli id che cominciano con `fub-` sono del formato. Un id che
  una parte di un altro programma cita, come un gradiente o un `use`, non si
  cambia: il riferimento si romperebbe. Un oggetto senza id ne riceve uno al
  primo cambio, e resta scelto.
- **Il disegno può cambiare mentre si scrive**, per un annulla o per chi
  lavora insieme: le righe si aggiornano, e il campo che ha il fuoco tiene ciò
  che c'è scritto, come un valore che non è partito.
- **I tasti del foglio non partono dal pannello**: un `?` o un `Canc` scritti
  in un valore restano lì, e `Canc` sul pulsante che toglie un attributo non
  toglie l'oggetto. Fuori da un campo di testo `Ctrl+Z` annulla come sul
  foglio.

Un documento in sola lettura si legge tutto e non si scrive. Scendendo
dall'Esperto il pannello si chiude e «Attributi» sparisce dalla barra.

## Contorno

«Contorno», nella barra della selezione, cambia il contorno degli oggetti
scelti. Le scelte sono di tre gruppi:

- il tratteggio: continuo, tratteggiato, punteggiato, tratto e punto;
- gli estremi: piatti, arrotondati, quadrati;
- gli angoli: vivi, arrotondati, smussati.

Le regole stanno in `apps/client/src/editors/spatial/tools/outline.ts`.

- **Un contorno è di una forma**: rettangoli, ellissi, cerchi, linee,
  spezzate, poligoni, percorsi e frecce, con un `stroke` che si vede. Un
  gruppo o un collegamento passano la scelta alle forme che contengono. Un
  tratto a penna è tutto riempimento, e un testo o un'immagine non hanno
  contorno; se fra gli oggetti scelti non c'è un contorno, il menu lo dice.
- **Il menu segna ciò che i contorni scelti hanno tutti**, e niente dove sono
  diversi. Un tratteggio che non è del menu, scritto da un altro programma o
  dagli attributi, c'è come «Su misura», segnato e spento, col suo valore.
- **Il tratteggio si misura in spessori**, così è uguale su un contorno
  sottile e su uno grosso: trattini di quattro spessori e spazi di tre, punti
  di uno spessore ogni tre. Un estremo arrotondato o quadrato allunga ogni
  trattino di mezzo spessore per parte, e il tratteggio lo toglie: i punti
  diventano tondi o quadrati, e la misura che si vede resta. Per la stessa
  ragione cambiare gli estremi riscrive un tratteggio del menu; uno su misura
  resta com'è.
- **Il file resta corto**: un valore che l'oggetto prenderebbe comunque, dal
  gruppo che lo contiene o da SVG, si toglie invece di scriversi.
- **Ogni scelta è un passo**, che si annulla col suo nome: «Tratteggio»,
  «Estremi del contorno» o «Angoli del contorno».

## Trasforma

«Trasforma…», nella barra della selezione (`Ctrl+Maiusc+M`, come la finestra
di Inkscape), ruota, scala e inclina gli oggetti scelti di quanto si scrive.
La finestra parte da ciò che non cambia niente: rotazione e inclinazioni a
zero, scale al cento per cento. Le regole stanno in
`apps/client/src/editors/spatial/tools/transform.ts`.

- **Attorno al centro degli oggetti scelti**, cioè del riquadro che si vede,
  contorno compreso. La selezione si trasforma come un insieme, come quando
  la si ridimensiona dalle proprietà.
- **In un ordine fisso:** prima la scala, poi l'inclinazione orizzontale e
  quella verticale, infine la rotazione.
- **La rotazione va in senso orario**, in gradi, come `rotate()` di SVG e
  come si vede sullo schermo. Le inclinazioni sono quelle di `skewX` e
  `skewY`, fra −89° e 89°.
- **Le scale sono percentuali**, fino a mille volte. Una scala negativa
  rispecchia: −100 % in orizzontale scambia la sinistra con la destra. Zero
  no: schiaccerebbe gli oggetti su una linea.
- **Cambia solo `transform`**, come spostare e ridimensionare: la geometria
  resta com'è scritta e il contorno si trasforma con l'oggetto. Ogni oggetto
  riceve la stessa trasformazione, composta con quella che aveva, e un
  oggetto che resterebbe scritto com'è non si tocca: un giro intero non
  cambia il file.
- **Niente che il file perderebbe.** `transform` si scrive con quattro
  decimali: una trasformazione che rimpicciolirebbe un oggetto al punto da
  deformarlo, scritta, non parte, e lo si dice.
- **È un passo solo**, «Trasformazione», e la pagina si allarga se gli
  oggetti ne escono.

## Applica trasformazione

«Applica trasformazione», nella barra della selezione, porta la `transform`
degli oggetti scelti nella loro geometria: punti, estremi, angoli e raggi si
riscrivono dove si vedono, e la `transform` si toglie. Serve per leggere e
cambiare negli attributi le coordinate vere, o per dare il disegno a un
programma che tratta male le trasformazioni. Le regole stanno in
`apps/client/src/editors/spatial/tools/apply.ts`.

- **Ciò che si vede resta.** Ogni forma prende della trasformazione ciò che
  sa scrivere e tiene il resto come `transform`; lo spostamento va sempre
  nella geometria.
- **Percorsi, linee, spezzate, poligoni e frecce prendono tutto.** Un arco
  cambia raggi, rotazione e verso; uno che va da un capo all'altro della sua
  ellisse, come le due metà di un cerchio, si scrive coi raggi appena più
  piccoli, così il centro resta nel mezzo degli estremi scritti con due
  decimali. La punta di una freccia si ridisegna con la sua regola.
- **Rettangoli ed ellissi prendono la scala lungo gli assi**, e i quarti di
  giro e i ribaltamenti, che li lasciano dritti; un cerchio prende anche le
  rotazioni, e la scala uguale nei due versi. Ciò che li storcerebbe, come un
  rettangolo girato di 30°, resta nella `transform`. I raggi degli angoli di
  un rettangolo scalano con lui.
- **Con un tratteggio** un rettangolo, un'ellisse o un cerchio tengono quarti
  di giro e ribaltamenti: il tratteggio comincerebbe da un altro punto, e
  andrebbe nell'altro verso.
- **Un'immagine** prende la scala lungo gli assi; se tiene le proporzioni
  (`preserveAspectRatio` diverso da `none`), solo quella uguale nei due
  versi. Rotazioni e ribaltamenti restano.
- **Un tratto a penna** prende rotazioni, ribaltamenti e una scala uguale nei
  due versi, o niente: l'inchiostro si riscrive, la direzione della penna
  gira con lui, il pennello scala e il tratto si ridisegna. Un tratto che la
  trasformazione deformerebbe, o il cui inchiostro riscritto sarebbe troppo
  lungo, la tiene.
- **Un testo tiene la sua**: le sue righe non si riscrivono.
- **Il contorno scala con l'oggetto**, spessore e tratteggio, della radice
  del fattore dell'area: una scala di due raddoppia lo spessore. Un contorno
  che viene dal gruppo si scrive sull'oggetto, già scalato; su un'immagine o
  un testo, che non hanno contorno, niente.
- **Un gruppo o un collegamento passano la loro trasformazione** alle parti,
  e la tolgono, se tutte la sanno prendere; se no la tengono, e le parti
  applicano solo la loro. Le parti di un altro programma fermano il
  passaggio.
- **Niente che il file non sappia scrivere.** Un oggetto che, scritto,
  uscirebbe dai numeri del formato, si deformerebbe o perderebbe il
  contorno, tiene la sua trasformazione com'è; così un percorso con una forma
  che questa versione non conosce.
- **È un passo solo**, «Applicazione della trasformazione», e la selezione
  resta quella. Si dice quanti oggetti cambiano e quanti conservano una
  trasformazione; se non c'è niente da applicare, lo si dice.
