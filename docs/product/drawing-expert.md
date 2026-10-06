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

Gli attributi sono il tag dell'oggetto scelto come lo scrive il file, una
riga per attributo, in una sezione del [pannello delle
proprietà](drawing-properties.md), chiusa di partenza: `Ctrl+Maiusc+X`, come
l'editor XML di Inkscape, la apre e le porta il fuoco, e di nuovo torna al
foglio. Nel Personalizzato senza il pannello, «Attributi», nella barra, apre
accanto al foglio un pannello loro, sotto l'albero degli oggetti se è aperto
anche quello. È il modo più corto di dare un valore preciso, e per chi non
vede il foglio una tabella da leggere, col nome dell'attributo come nome del
campo. Le regole
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
  foglio, e `Ctrl+G` e `Ctrl+Maiusc+G` raggruppano e separano.

Un documento in sola lettura si legge tutto e non si scrive. Scendendo
dall'Esperto la sezione se ne va dal pannello delle proprietà.

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
di Inkscape), porta il fuoco alla sezione «Trasforma» del [pannello delle
proprietà](drawing-properties.md), che ruota, scala e inclina gli oggetti
scelti di quanto si scrive, con «Applica»; nel Personalizzato senza il
pannello apre una finestra con gli stessi campi. I campi partono da ciò che
non cambia niente: rotazione e inclinazioni a zero, scale al cento per cento,
e dopo «Applica» restano come sono, così un secondo «Applica» ripete la
trasformazione. Le regole stanno in
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

## Oggetto in tracciato

«Oggetto in tracciato», nella barra della selezione, fa degli oggetti scelti
dei tracciati (`path`), che si leggono e si cambiano punto per punto. Le
regole stanno in `apps/client/src/editors/spatial/tools/topath.ts`.

- **Ciò che si vede resta.** Rettangoli, ellissi, cerchi, linee, spezzate e
  poligoni diventano il tracciato con cui SVG 2 li definisce, dallo stesso
  punto e nello stesso verso: anche un tratteggio comincia dove cominciava.
  Gli angoli arrotondati di un rettangolo e le ellissi diventano archi.
- **Una freccia, un poligono regolare e una stella** perdono la loro
  geometria (`fub:shape` e `fub:geom`), e **un tratto a penna** l'inchiostro, il pennello, lo strumento e l'ora: resta il
  `d` che si vedeva. Il tratto diventa una figura piena, che la penna non
  ridisegna più.
- **L'oggetto resta lui**: stesso id, stesso posto fra gli altri, stessi
  colori, contorno, trasformazione, titolo e attributi di altri programmi.
- **Un gruppo o un collegamento** passano il comando alle parti. Un blocco
  estraneo dentro un gruppo resta com'è, come ovunque.
- **Testi e immagini non hanno un tracciato**, e nemmeno una forma vuota, come
  un rettangolo largo zero: restano come sono, e il comando lo dice. Resta
  com'è anche un oggetto con l'attributo di un altro programma il cui
  prefisso è dichiarato sull'oggetto stesso, perché un'operazione non sa
  dichiararlo di nuovo.
- **È un passo solo**, «Oggetto in tracciato», e la selezione resta quella.

## Operazioni booleane

«Operazioni booleane», nella barra della selezione, apre un menu con
l'unione, la differenza, l'intersezione, l'esclusione e la divisione delle
forme scelte, come il menu Tracciato di Inkscape. Le regole stanno in
`apps/client/src/editors/spatial/tools/combine.ts`, e il calcolo in
`boolean.ts`, accanto.

- **Le forme sono le aree che riempiono**: tracciati, rettangoli, ellissi,
  cerchi, linee, spezzate, poligoni, frecce e tratti a penna, ciascuno con la
  regola con cui lo si dipinge, nonzero. Gruppi, collegamenti, testi e
  immagini non sono forme: se ce n'è uno fra gli oggetti scelti le voci si
  spengono, e dicono perché.
- **L'unione** fa un'area sola di quelle di tutte le forme, e anche di una
  forma sola, che così si ripulisce di sovrapposizioni e contorni che si
  incrociano. **La differenza** toglie dalla forma più in basso l'area delle
  altre; **l'intersezione** tiene l'area che hanno tutte; **l'esclusione**
  quella coperta da un numero dispari di forme. Queste ultime chiedono
  almeno due forme, e la voce spenta lo dice.
- **La divisione** taglia la forma più in basso lungo i contorni delle
  altre, anche aperti, come quello di una linea: ogni pezzo diventa un
  tracciato. Il primo prende il posto della forma; gli altri le stanno
  sopra, coi suoi colori e il suo contorno, e sono scelti con lei.
- **La forma più in basso resta lei**, come in «Oggetto in tracciato»:
  diventa il tracciato del risultato con lo stesso id, lo stesso posto fra
  gli altri, gli stessi colori, la stessa trasformazione, il titolo e gli
  attributi di altri programmi. Le altre forme se ne vanno. Il risultato si
  scrive nelle sue coordinate, dove le altre arrivano con le loro
  trasformazioni e quelle dei loro livelli e gruppi.
- **Le curve restano curve.** Un lato che passa intero nel risultato si
  riscrive com'era; un pezzo di curva torna il pezzo della cubica, della
  quadratica o dell'arco da cui viene, coi capi sugli incroci veri. Dove due
  forme hanno un lato in comune vale quello della forma più in basso, e ogni
  anello gira nel suo verso e comincia da un nodo, se può: dai suoi prima
  che da quelli delle altre.
- **I contorni vicini si toccano.** Due punti a meno di un centesimo e mezzo
  sono lo stesso punto, perché i numeri si scrivono al centesimo: i bordi in
  comune, i contatti e le tangenze non lasciano fessure né schegge, e ciò
  che è più sottile di così sparisce.
- **Un risultato vuoto non cambia niente**, e nemmeno una divisione che non
  divide: le forme restano, e il comando lo dice. Così una forma con un
  attributo di un altro programma il cui prefisso è dichiarato sulla forma
  stessa, come in «Oggetto in tracciato».
- **È un passo solo**, col nome dell'operazione, e dopo è scelto il
  risultato, o i pezzi della divisione. Le operazioni non hanno tasti: si
  trovano nel menu.

## Nodi

Lo strumento Nodi (`N`, come in Inkscape) modifica i nodi degli oggetti
scelti: i punti per cui passano, i segmenti fra loro e le maniglie delle
curve. Come con la Selezione diretta di Illustrator, ogni forma ha i suoi
nodi: un tracciato, un rettangolo, un'ellisse, un cerchio, una linea, una
spezzata, un poligono, una stella, una freccia e un tratto a penna. Un testo
e un'immagine non ne hanno, e nemmeno una parte di un altro programma, che
FubDraw lascia com'è: lo strumento dice perché. I nodi di più oggetti si
modificano insieme; di un gruppo si vedono quelli di tutte le sue forme,
finché se ne tocca una. Le regole stanno in `apps/client/src/editors/spatial/tools/nodes.ts` e, per
le forme che non sono tracciati, in `nodable.ts` accanto.

- **Col puntatore** si trascina un nodo, coi nodi scelti insieme a lui anche
  di altre forme, una maniglia o un punto di un segmento, che si piega.
  Dentro una forma, lontano da nodi e segmenti, si prendono tutti i suoi
  nodi, che si trascinano insieme. Un tocco su un nodo lo sceglie da solo,
  con la sua forma; con `Maiusc` lo aggiunge o lo toglie. Un tocco su un
  segmento sceglie i suoi due nodi, e due tocchi ci aggiungono un nodo. Un
  trascinamento sul vuoto sceglie i nodi nel riquadro, di tutte le forme del
  disegno, coi loro oggetti, e gli oggetti senza nodi che racchiude interi;
  con `Maiusc` li aggiunge. Un tocco sul vuoto toglie la scelta dei nodi,
  poi quella degli oggetti. Su un altro oggetto, o su un'altra forma dello
  stesso gruppo, il punto passa a quella, o con `Maiusc` la aggiunge, e
  prende subito ciò che tocca: un suo nodo si trascina in un gesto solo.
- **Passando col puntatore**, senza premere, la forma sotto mostra il suo
  contorno e i suoi nodi, più piccoli e più tenui di quelli che si
  modificano: si vede dove sono prima di toccarli.
- **Ogni nodo scelto mostra le sue maniglie**, come nella Selezione diretta
  di Illustrator, anche dove il segmento non ne scrive: una linea ha quelle
  della cubica dritta che è, a un terzo e a due terzi, e un arco quelle delle
  cubiche che lo approssimano. Una maniglia ritirata sul suo nodo, come
  quelle della penna di Bézier accanto a uno spigolo, si vede accanto al
  nodo, con la linea tratteggiata. Trascinarne una curva il segmento, che
  prima diventa le cubiche che si vedono uguali; un tocco sulla maniglia di
  una linea vale come sulla linea. Su un lato molto corto la maniglia
  coprirebbe il nodo, e si vede ingrandendo; l'asta di una freccia non ne ha.
- **Con `Alt`** trascinare un nodo ne tira fuori le maniglie, come con lo
  strumento Punto di ancoraggio di Illustrator: quella sotto il puntatore è
  del lato verso cui si comincia, l'altra le sta opposta, e il nodo diventa
  simmetrico; un capo ne ha una sola. Trascinare una maniglia con `Alt` la
  sposta da sola, e il suo nodo diventa uno spigolo. Col dito, o dalla
  tastiera, «Nodi lisci» e «Nodi simmetrici» tirano fuori le maniglie di uno
  spigolo.
- **La barra dei nodi** prende il posto di quella della selezione, coi tasti
  di Inkscape: «Aggiungi nodi» (`Ins`) a metà dei segmenti fra due nodi
  scelti, «Elimina nodi» (`Canc`), «Nodi a spigolo», «Nodi lisci» e «Nodi
  simmetrici» (`Maiusc+C`, `S`, `Y`), «Segmenti in linee» e «Segmenti in
  curve» (`Maiusc+L` e `U`), «Spezza ai nodi» (`Maiusc+B`), «Unisci i capi»
  (`Maiusc+J`) e «Allinea i nodi», sul bordo o sul centro del loro riquadro,
  o della pagina per un nodo solo. `Alt+F10` ci va, ed `Esc` torna al foglio.
- **Dalla tastiera** `Tab` e `Maiusc+Tab` passano di nodo in nodo, anche da
  una forma all'altra, e oltre l'ultimo all'oggetto dopo; `Home` e `Fine`
  vanno al primo e all'ultimo nodo. `Ctrl+A` sceglie tutti i nodi delle
  forme, e la seconda volta tutti gli oggetti coi loro nodi; `Esc` toglie la
  scelta dei nodi, poi quella degli oggetti. Ogni nodo si dice col numero, il
  tipo e la posizione, «Nodo 2 di 3, spigolo: x 50, y 10», e con più forme
  prima la sua; i nodi scelti di più oggetti si contano: «2 nodi scelti in 2
  oggetti». Le frecce spostano i nodi scelti di 1,
  10 con `Maiusc` e un pixel dello schermo con `Ctrl` o `⌘`, di riga in riga
  con l'aggancio alla griglia; senza nodi scelti muovono il cursore, mai
  l'oggetto. `Invio` apre la posizione dei nodi scelti, da scrivere coi
  numeri.
- **Ogni segmento resta del suo tipo:** linea, quadratica, cubica o arco.
  Spostare un nodo porta con lui le maniglie delle sue cubiche; un arco
  tiene raggi e rotazione. Piegare una linea la fa diventare la cubica
  dritta che è; un arco piegato resta un arco.
- **Il tipo di un nodo si legge dalle direzioni**, perché SVG non ha dove
  scriverlo: liscio se i due segmenti vi passano allineati, simmetrico se
  anche le maniglie sono lunghe uguali, spigolo altrimenti. Un nodo liscio
  resta liscio mentre si trascinano lui, i vicini o le sue maniglie. Il tipo
  scelto con la barra, o con `Alt`, vale finché il tracciato resta scelto, e
  annullare o ripetere lo riporta com'era; i capi di un tracciato aperto non
  ne hanno.
- **Eliminare un nodo** unisce i suoi segmenti: due linee in una linea, se
  no in una curva che passa vicino a dov'erano e tiene i versi ai capi, così
  un nodo liscio accanto resta liscio. Ai capi di un tracciato aperto il
  segmento se ne va. Una forma rimasta senza nodi se ne va con loro, e
  `Canc` non elimina mai l'oggetto: lo fa «Elimina la selezione».
- **Spezzare** fa di un nodo due nodi nello stesso punto, scelti: un
  tracciato chiuso si apre, uno aperto si divide. **Unire** due capi scelti
  chiude il tracciato, se sono i suoi, o ne fa uno solo; due capi nello
  stesso punto diventano un nodo solo, se no li unisce una linea.
- **Ogni modifica riscrive il `d` intero**, in coordinate assolute con due
  decimali, in un passo che si annulla col suo nome; il resto del tracciato
  non si tocca. La pagina si allarga se il tracciato ne esce.
- **Più forme cambiano in un passo solo**, che un annulla toglie: un
  trascinamento, le frecce, la posizione e i comandi della barra valgono per
  i nodi scelti di ogni forma. Se una forma non può prendere la modifica, le
  altre la prendono e lo strumento dice perché. Si uniscono due capi della
  stessa forma, non di due.
- **Una forma resta la sua finché i nodi la disegnano.** Un rettangolo coi
  lati ancora dritti e in squadra, anche più largo o più alto, una linea, una
  spezzata o un poligono coi segmenti dritti riscrivono solo i loro
  attributi; un'ellisse, un cerchio, un poligono regolare e una stella
  restano loro se si spostano interi. Altrimenti la forma diventa un
  tracciato, come con «Oggetto in tracciato», nello stesso passo: stesso id,
  stessi colori, stesso tratteggio, e lo strumento lo dice.
- **Una freccia** ha i due capi dell'asta: spostarli la ridisegna, con la
  punta che segue il suo capo. L'asta non si piega e non prende altri nodi:
  un punto sull'asta porta tutta la freccia, e per curvarla serve prima
  «Oggetto in tracciato».
- **Un tratto a penna** ha i nodi della sua spina: pochi nodi su una curva
  che passa per l'inchiostro, a meno di metà dello spessore del pennello.
  Spostarli porta l'inchiostro con loro: ogni campione tiene la pressione,
  il tempo, l'inclinazione della penna e lo scarto dalla spina, cioè il
  tremolio della mano, e la penna ridisegna il contorno. Dove la spina si
  allunga, con la pressione vera, arrivano campioni in mezzo. Il tratto
  resta uno e aperto: non si spezza e non si chiude.

## Costruttore di forme

Il Costruttore di forme (`M`), come il Generatore forme di Illustrator, unisce,
toglie e separa le regioni delle forme scelte: i pezzi in cui i loro contorni
si dividono a vicenda. Le regole stanno in
`apps/client/src/editors/spatial/tools/builder.ts`, e il calcolo in
`boolean.ts`, accanto, con le operazioni booleane.

- **Le regioni** sono i pezzi dentro almeno una forma; una forma che non si
  riempie e non ha contorni chiusi, come una linea, taglia soltanto. Gruppi,
  testi e immagini scelti restano come sono, e lo si dice. Ogni regione ha un
  contorno tenue, e quella sotto il puntatore si colora.
- **Trascinare attraverso le regioni** le unisce in una forma sola, subito
  sopra la forma più in alto che copre la prima e col suo stile; con `Alt` le
  toglie, e si vedono tratteggiate. Un tocco su una regione ne fa una forma a
  sé, e con `Alt` la toglie. Fuori dalle regioni, o con `Maiusc`, si scelgono
  le forme come con la Selezione.
- **Le forme che coprivano le regioni le perdono**: diventano tracciati, con
  le loro curve dove restano, e quella rimasta vuota se ne va. Una forma che
  finisce tutta nell'unione la diventa, con lo stesso id e lo stesso posto.
- **Dalla tastiera** `Tab` e `Maiusc+Tab` passano di regione in regione, e
  `Home` e `Fine` vanno alla prima e all'ultima; ognuna si dice col numero e
  le forme che la coprono, «Regione 2 di 3, di Rettangolo, Blu e Rettangolo,
  Vermiglio.» `Spazio` la sceglie, `Invio` unisce quelle scelte, o separa
  quella a cui si è, e `Canc` le toglie; `Esc` lascia le regioni scelte, poi
  la selezione.
- **È un passo solo**, «Unione di regioni», «Separazione di una regione» o
  «Eliminazione di regioni», e dopo restano scelti gli oggetti di prima che
  ci sono ancora, con la forma nuova. Le regioni si rifanno a ogni scelta: su
  forme troppe o troppo complesse, come centinaia di cerchi sovrapposti, il
  Costruttore lo dice e non le calcola.

## Bézier

La penna di Bézier (`B`, come in Inkscape), nella barra dopo le forme,
disegna un tracciato nodo per nodo: i punti per cui passa e le maniglie delle
sue curve. Il tracciato si scrive quando si conclude, sul livello corrente,
col colore e lo spessore della barra. Le regole stanno in
`apps/client/src/editors/spatial/tools/bezier.ts`.

- **Col puntatore** un tocco mette uno spigolo, e un trascinamento un nodo
  simmetrico: la maniglia verso cui il tracciato riparte segue il puntatore,
  quella da cui arriva le sta opposta. Fra due spigoli il segmento è una
  linea, altrimenti una curva. Mentre si disegna il segmento che verrebbe
  segue il puntatore, le maniglie dell'ultimo nodo si vedono, e il nodo che
  un tocco prenderebbe è pieno.
- **Chiudere e concludere:** un tocco sul primo nodo chiude il tracciato, e
  trascinato da lì ne fa un nodo simmetrico, così il tracciato vi passa senza
  spigolo. Un tocco sull'ultimo nodo conclude il tracciato aperto, e così
  due tocchi, `Invio` ed `Esc`, che tiene il lavoro fatto; trascinare
  dall'ultimo nodo tira solo la sua maniglia verso il nodo dopo, e riportata
  sul nodo la toglie. Cambiare strumento o livello conclude il tracciato. Un
  tracciato con un nodo solo non si scrive, e lo si dice. Su un livello che
  non riceve, perché bloccato o nascosto, lo si dice e il tracciato resta, da
  concludere quando riceverà; cambiare strumento allora lo butta.
- **`Maiusc`** porta il nodo nuovo a passi di 15° dall'ultimo, e la maniglia
  a passi di 15° dal suo nodo. Con l'aggancio alla griglia nodi e maniglie
  vanno sugli incroci, e `Ctrl` o `⌘` li lascia liberi.
- **Annulla e Ripeti** percorrono i passi del tracciato in corso, i nodi, le
  maniglie e le eliminazioni, poi quelli del disegno; `Canc` e `⌫` eliminano
  l'ultimo nodo. Il tracciato concluso entra nel disegno in un passo solo,
  «Tracciato».
- **Dalla tastiera** le frecce muovono il cursore anche con una selezione, e
  `Spazio` mette un nodo dove sta: `Spazio` di nuovo lo lascia spigolo, le
  frecce in mezzo ne tirano le maniglie. Il cursore sul primo nodo dice che
  `Spazio` chiude il tracciato, sull'ultimo che lo conclude; ogni nodo messo
  si dice col numero, il tipo e la posizione: «Nodo 2, simmetrico: x 50,
  y 0.»
- **Si scrive un `path`** senza riempimento, coi giunti arrotondati e, se è
  aperto, i capi arrotondati, nelle coordinate del livello e coi due decimali
  di ogni `d`. La pagina si allarga se il tracciato ne esce. Lo strumento
  Nodi ritrova i nodi col tipo che avevano mentre si disegnavano.

## Il file accanto

Il file intero, mentre si disegna, sta nel riquadro accanto: «Apri come
sorgente accanto», nella palette e nel menu del riquadro, apre il testo SVG a
destra del disegno, sullo stesso documento. Ogni gesto si legge subito nel
testo, e ciò che si scrive nel testo si vede subito nel disegno. Il comando è
della shell e c'è a ogni livello, come [«Apri come
sorgente»](drawing.md#apri-come-sorgente).
