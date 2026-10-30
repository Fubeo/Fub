# Disegni, ritagli e maschere

> **Per chi:** chi vuole mostrare soltanto una parte di una foto, e chi apre
> un disegno con forme che si ritagliano o si sfumano a vicenda.
> **Risultato:** sapere come si ritaglia un'immagine, che cosa fanno le
> maschere che un disegno porta, e che cosa ne fanno la selezione, gli altri
> comandi e l'export.

Nello spazio Completo un'immagine si **ritaglia** sul foglio, come in
Illustrator o in PowerPoint: se ne sceglie la parte da mostrare, e l'immagine
resta intera nel file, pronta a mostrarne un'altra. Le **maschere** fanno lo
stesso con ogni oggetto: una forma ritaglia gli oggetti di un gruppo, o ne fa
la trasparenza col suo chiaro e il suo scuro. Fub le mostra e le rispetta
quando un disegno le porta, scritte da un altro programma o da una versione
precedente, ma non le crea e non le rilascia: i comandi «Maschera» se ne sono
andati col livello Esperto (decisione 0231). Il ritaglio è in
`apps/client/src/editors/spatial/tools/crop.ts`; la parte che si vede, per la
selezione e i riquadri, in `tools/clips.ts`.

## Ritagliare un'immagine

Con un'immagine scelta da sola, **«Ritaglia…»** nella barra «Disponi» apre il
ritaglio; con la Selezione bastano anche due tocchi sull'immagine. Il foglio
mostra l'immagine intera, attenuata, e sopra la parte che resta, coi suoi
segni ai lati e agli angoli; mentre si tira, la griglia dei terzi aiuta a
comporre. Finché il ritaglio è aperto, i gesti sul foglio sono suoi.

- **Tirare un segno** sposta quel lato, o i due di quell'angolo. Con `Maiusc`
  il ritaglio tiene le proporzioni che ha, con `Alt` resta attorno al suo
  centro; i due tasti si premono e si lasciano anche a metà del gesto, e il
  ritaglio si rifà subito, anche col puntatore fermo. Quando il segno si
  lascia vale ciò che i tasti dicono in quel momento. Il ritaglio non esce mai
  dall'immagine.
- **Tirare dentro** sposta l'immagine sotto il ritaglio, che resta fermo: si
  sceglie che cosa mostrare senza cambiare dove sta. L'immagine si ferma
  quando un suo bordo arriva al ritaglio. Le frecce la spostano di un'unità,
  con `Maiusc` di dieci.
- **La barra** sopra il foglio ha i quattro margini, «In alto», «A destra»,
  «In basso» e «A sinistra», nell'unità del documento, e dice quanto si
  vede: «Si vede 30 × 15 di 40 × 20». Un margine scritto cambia l'anteprima
  subito; uno che lascerebbe troppo poco dell'immagine lo dice, e non
  cambia niente. Un campo vuoto o che non si legge non cambia niente
  neppure: la barra dice di scrivere un valore, e lasciato il campo torna
  al margine che vale. Un margine non va sotto lo zero.

Il ritaglio si **applica** con `Invio`, con «Applica», con due tocchi dentro,
con un tocco fuori, che sceglie anche ciò che tocca come un tocco della
Selezione (con `Maiusc` lo aggiunge a ciò che era scelto, con `Ctrl` o `⌘`
sceglie dentro i gruppi), cambiando strumento o selezione, e prima di ogni
comando che cambia il disegno, come duplicare, eliminare o scrivere un valore
nel pannello delle proprietà. È un passo di annulla, «Ritaglio», e l'immagine
resta scelta, con la cornice sulla parte che si vede; un comando che cambia
il disegno ne fa due, il ritaglio e il suo, e lo vede già ritagliato. Si
**annulla** con `Esc`, con «Annulla» e con un annulla, che non annulla altro,
e quando cambiano il documento o il livello: il file resta com'era. Un
ripeti chiude il ritaglio e poi ripete come sempre.

Un ritaglio che c'è si riapre e si cambia allo stesso modo; portato
all'immagine intera, se ne va. **«Togli il ritaglio»**, nella barra
«Disponi», rende intere tutte le immagini scelte in un passo, qualunque
ritaglio abbiano. Un'immagine ritagliata da un altro programma con una forma
che non è un rettangolo mostra «Ritaglia…», che spiega di togliere prima quel
ritaglio.

Quando il ritaglio si apre, lo screen reader sente che cosa fanno i segni, le
frecce, `Invio` ed `Esc`; la barra mostra i margini e quanto si vede, e `?`
elenca i tasti del ritaglio. Poi dice la misura che si vede quando un segno si
lascia, e i margini quando l'immagine si sposta.

## Ciò che si vede è ciò che si tocca

La selezione, la cornice, l'aggancio, le guide intelligenti, il lazo, la
gomma e l'export della selezione guardano la **parte che si vede**: un clic
sulla parte nascosta di un'immagine ritagliata non la sceglie, e la sua
cornice è quella del ritaglio, girata con l'immagine. Lo stesso vale dentro un
gruppo mascherato isolato, dove ogni oggetto è ritagliato dalla maschera del
gruppo, per un livello con un ritaglio scritto da un altro programma, e per le
punte di una linea ritagliata. Una maschera d'opacità conta per la sua area,
anche dove è nera. Un oggetto nascosto del tutto si sceglie dall'albero degli
oggetti.

## Con gli altri comandi

- **Duplicare, copiare e incollare** portano il ritaglio e la maschera con
  l'oggetto, ognuno coi suoi: cambiare il ritaglio di una copia non tocca
  l'originale.
- **In Lettura e nell'[export](drawing-export.md)**, in PNG, JPEG, PDF e
  SVG pulito, i ritagli e le maschere sono quelli del foglio.

## Nel file

Un ritaglio è un `clipPath` fra le [risorse](drawing-resources.md) del
disegno, suo e di nessun altro, con un rettangolo nelle coordinate
dell'immagine; spostare l'immagine sotto il ritaglio cambia soltanto `x` e `y`.

```xml
<clipPath id="c1" fub:role="private">
  <rect x="20" y="20" width="40" height="36"/>
</clipPath>
<image id="o1" x="12" y="12" width="64" height="64"
  clip-path="url(#c1)" href="data:image/png;base64,…"/>
```

Una maschera di ritaglio è un `clipPath` con la forma, una d'opacità una
`mask`, e il gruppo li usa con `clip-path` o `mask`. «Separa» su un gruppo
mascherato non lo separa, e dice perché. Come li scrive il file è
in [Formato della scena,
risorse](../reference/scene-format-resources.md#i-ritagli-e-le-maschere).

## Spazi e parti

Il ritaglio delle immagini viene nello spazio Completo. Per chi monta
l'editor con le sue [parti](drawing-custom.md#che-cosa-porta-una-parte) lo
porta la parte «Ritaglia immagine». In uno spazio che non l'ha, e per le
maschere sempre, i ritagli e le maschere restano nel disegno, si vedono e
valgono per la selezione; mancano i comandi. In un documento in sola lettura
non ci sono.
