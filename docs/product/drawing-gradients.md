# Disegni, sfumature

> **Per chi:** chi vuole un riempimento o un contorno che passa da un colore
> all'altro, e lo cambia col puntatore, coi numeri o dalla tastiera.
> **Risultato:** sapere come nasce una sfumatura, come si cambiano i suoi
> punti nel pannello delle proprietà e sul foglio, e che cosa ne fanno i
> comandi.

Dal livello Standard il riempimento e il contorno di un oggetto possono
essere una **sfumatura**: lineare, lungo una linea da un capo all'altro, o
radiale, dal centro al bordo di un cerchio o di un'ellisse. I suoi **punti**
dicono quale colore, e quanto opaco, sta dove. La sezione «Sfumatura» del
[pannello delle proprietà](drawing-properties.md) la fa e la cambia coi
numeri; lo strumento **Sfumatura** (`G`) la mostra sul foglio, dove la si
traccia e la si trascina. Il modello è in
`apps/client/src/editors/spatial/tools/gradients.ts`, la sezione in
`gradient-panel.ts`.

## Ogni oggetto ha la sua

Una sfumatura sta fra le [risorse](drawing-resources.md) del disegno, e
FubDraw ne dà una a ogni oggetto, nelle coordinate dell'oggetto: spostarlo,
ruotarlo o ridimensionarlo la porta con sé. Chi la usa scrive anche un
colore di ripiego, la media dei suoi colori pesata sull'opacità, per chi
non sa disegnare le sfumature.

```xml
<linearGradient id="r4k9m2x7q" fub:role="private" x1="40" y1="100" x2="240" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
…
<rect id="o3c5e7g9j" x="40" y="40" width="200" height="120" fill="url(#r4k9m2x7q) #80b9d9"/>
```

- **Cambiare la sfumatura di un oggetto** la cambia sul posto, in un passo
  di annulla col nome di ciò che fa, «Punto della sfumatura spostato» o
  «Angolo della sfumatura».
- **Una sfumatura che non è soltanto sua** resta com'è per gli altri, e chi
  la cambia ne riceve una copia: quella che usano anche altri oggetti, o
  l'altro colore dello stesso oggetto, quella scritta da un altro programma,
  e quella che eredita dal gruppo.
- **Un campione** è una sfumatura di un colore solo, e resta un colore: la
  sezione lo mostra come «Pieno» ([Disegni, colori](drawing-colors.md)).
- **Un oggetto con una sfumatura che il formato non conosce**, come una che
  ne eredita un'altra, resta estraneo: si vede com'è, e si sposta e si
  elimina intero ([Disegni, risorse](drawing-resources.md#che-cosa-resta-modificabile)).

## La sezione «Sfumatura»

La sezione viene dopo «Aspetto», con oggetti scelti che hanno un
riempimento o un contorno. In cima **«Applica a»** dice a quale dei due va,
ed è lo stesso della sezione «Colori del documento»: sceglierlo in una lo
sceglie anche nell'altra.

- **Tipo**: Pieno, Lineare o Radiale. Da un colore pieno, Lineare e Radiale
  ne fanno la dissolvenza, dal colore pieno al trasparente; da un campione,
  dal suo colore; da una [campitura](drawing-patterns.md), dal suo fondo, o
  dal colore delle righe se non ne ha; da un motivo, dal suo colore di
  ripiego; senza colore, una sfumatura dal bianco al nero. Una lineare
  nasce da sinistra a destra a metà altezza, una radiale nel cerchio o
  nell'ellisse dentro il riquadro dell'oggetto. Cambiare tipo tiene il
  posto: il mezzo della linea diventa il centro, e viceversa. Pieno torna
  al colore del primo punto, e la sfumatura se ne va.
- **La barra dei punti** mostra la sfumatura su una scacchiera, che fa
  vedere la trasparenza, coi punti sotto. Un clic sulla barra aggiunge un
  punto del colore che si vede lì; un punto si trascina lungo la barra e,
  trascinato lontano da lei, si toglie, se ne restano almeno due. Mentre si
  trascina il disegno lo mostra; lasciato, è un passo di annulla.
- **I campi del punto scelto**: Colore, scritto come codice, come nome o
  col nome di un campione, o dal selettore del sistema, che il disegno
  mostra mentre lo si muove; Posizione e Opacità, in percentuale, che si
  calcolano come gli altri campi del pannello. «Aggiungi un punto» lo mette
  a metà fra il punto scelto e il seguente, «Togli il punto» toglie quello
  scelto.
- **«Inverti»** rovescia i punti, e **«Sfumature pronte»** ne offre sei:
  Dissolvenza, il primo colore da pieno a trasparente, Dal bianco al nero,
  Cielo, Tramonto, Prato e Crepuscolo.
- **Angolo**, in gradi fra -180 e 180: gira la linea attorno al suo mezzo,
  o una radiale attorno al centro.
- **Oltre i capi**, all'Esperto: come continua la sfumatura prima del primo
  punto e dopo l'ultimo. «Estendi» tiene il colore dei capi, «Rifletti» va
  avanti e indietro, «Ripeti» ricomincia.

Con più oggetti la sezione mostra ciò che hanno in comune, e ogni cambio
vale per tutti in un passo. Se le loro sfumature sono diverse restano il
tipo, le sfumature pronte, «Inverti» e l'angolo, che ciascuna applica coi
suoi colori, e una nota lo dice.

Da tastiera ogni punto è un cursore, col suo posto nel giro di `Tab`: le
frecce lo spostano dell'1%, con `Maiusc`, `PagSu` e `PagGiù` del 10%;
`Inizio` e `Fine` lo portano ai capi. `Canc` lo toglie, `Ins` o `+` ne
aggiungono uno a metà col seguente. Il punto col fuoco è il punto scelto,
lo stesso sul foglio. Il lettore di schermo legge «Punto 2 di 3» col colore,
col nome della tavolozza o il codice, l'opacità se non è piena, e la
posizione.

## Lo strumento Sfumatura

La **Sfumatura** (`G`, la lettera di Illustrator) viene dopo il Contagocce.
Con oggetti scelti mostra sul foglio la sfumatura di ciascuno, nel colore
che dice «Applica a»: la linea, i capi e un quadratino per punto, appeso a
destra della linea per chi va dall'inizio alla fine, sotto una linea che va
da sinistra a destra, così da non coprire i capi. Una lineare ha l'inizio,
tondo, e la fine, quadrata; una radiale il bordo tratteggiato, il centro,
il raggio, il secondo raggio e il fuoco, a rombo. Più oggetti con la stessa
sfumatura nello stesso posto ne mostrano una, e la cambiano insieme. Sopra
un capo, un punto o la linea il puntatore dice che li sposta.

- **Trascinata sul foglio** traccia una sfumatura nuova per tutti gli
  oggetti scelti, da dove parte a dove la si lascia: radiale se lo sono già
  tutte, col centro dove parte, altrimenti lineare, coi punti di ciascuno.
  Senza niente di scelto sceglie l'oggetto da cui parte.
- **I capi si trascinano.** Uno gira e allunga la linea attorno all'altro.
  Il centro di una radiale la sposta, il raggio la gira e la allarga, il
  secondo raggio la allunga soltanto; il fuoco si sposta dentro il bordo, e
  si prende con `Alt` premendo sul centro. La linea sposta la sfumatura
  intera.
- **Un punto scorre lungo la linea**, e trascinato lontano da lei si toglie,
  se ne restano almeno due.
- **I capi si agganciano** alla griglia e alle guide, e `Ctrl` o `⌘` li
  lascia liberi; con `Maiusc` la linea va di 45° in 45°. Mentre si trascina
  il disegno mostra la sfumatura nuova, e un'etichetta l'angolo, il raggio o
  la posizione del punto; lasciata, è un passo di annulla, ed `Esc` prima di
  lasciare la tiene com'era.
- **Un tocco** su un capo o su un punto lo sceglie e lo dice: il punto
  scelto è lo stesso della sezione. Due tocchi sulla linea aggiungono un
  punto del colore che si vede lì, due su un punto portano al suo colore nel
  pannello. Un tocco altrove sceglie l'oggetto sotto, con `Maiusc` lo
  aggiunge o lo toglie, e sul vuoto toglie la selezione.

Da tastiera `Tab` e `Maiusc+Tab` vanno di capo in capo e di punto in punto,
`Inizio` e `Fine` agli estremi, ed `Esc` lascia ciò che è scelto. Le frecce
spostano il capo scelto come un nodo, di 1, di 10 con `Maiusc` e di un
pixel con `Ctrl` o `⌘`, o di riga in riga con l'aggancio alla griglia; il
punto scelto lungo la linea, dell'1% e del 10% con `Maiusc`. Senza niente di
scelto muovono il cursore, che dice il capo, il punto o la linea sotto di
sé: `Spazio`, le frecce e `Spazio` tracciano una sfumatura dal cursore, o
spostano ciò che c'è sotto. `Ins` aggiunge un punto a metà fra quello scelto
e il seguente e `Canc` lo toglie; nessuno dei due tocca l'oggetto. `Invio`
porta al colore del punto scelto nel pannello, o alla sezione da un capo.
Con più sfumature ciò che si dice nomina quale, «Sfumatura 2 di 3».

## Con gli altri comandi

- **Duplicare, copiare e incollare** danno alla copia la sua sfumatura, con
  un nome nuovo: cambiare l'una non cambia l'altra ([Disegni,
  risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile» e il contagocce** danno a ogni oggetto la sua copia;
  il contagocce con `Maiusc` prende il colore che la sfumatura ha in quel
  punto ([Disegni, colori](drawing-colors.md#il-contagocce)).
- **Separa, il costruttore di forme e le forbici** lasciano agli oggetti che
  nascono la stessa sfumatura, che usano insieme finché uno di loro non la
  cambia.
- **«Applica trasformazione»**, all'Esperto, riscrive la sfumatura nelle
  coordinate nuove, e la si vede dov'era ([Disegni, livello
  Esperto](drawing-expert.md#applica-trasformazione)).
- **In Lettura e nell'export** la sfumatura è quella del file, uguale a
  quella del foglio.

## Livelli e parti

All'Essenziale le sfumature restano nel disegno e si vedono, ma la sezione e
lo strumento non ci sono. Nel [Personalizzato](drawing-custom.md) la parte
«Sfumatura» porta insieme lo strumento e la sezione, e «Oltre i capi» c'è
come all'Esperto. Senza la parte chi aveva in mano lo strumento riprende la
Selezione. `?` elenca i tasti della Sfumatura nella sua tabella, dopo quella
del Contagocce.

In un documento in sola lettura la sezione mostra la sfumatura, e ogni gesto
dice perché non cambia.
