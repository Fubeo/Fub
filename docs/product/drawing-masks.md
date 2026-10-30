# Disegni, ritagli e maschere

> **Per chi:** chi apre un disegno con foto ritagliate, o con forme che si
> ritagliano o si sfumano a vicenda.
> **Risultato:** sapere che cosa fanno i ritagli e le maschere che un disegno
> porta, e che cosa ne fanno la selezione, gli altri comandi e l'export.

Un **ritaglio** mostra soltanto una parte di un'immagine, che resta intera
nel file. Le **maschere** fanno lo stesso con ogni oggetto: una forma
ritaglia gli oggetti di un gruppo, o ne fa la trasparenza col suo chiaro e il
suo scuro. Fub li mostra e li rispetta quando un disegno li porta, scritti da
un altro programma o da una versione precedente, ma non li crea, non li
cambia e non li toglie: i comandi «Maschera» se ne sono andati col livello
Esperto, e «Ritaglia…» e «Togli il ritaglio» col livello Standard (decisione
0231). La parte che si vede, per la selezione e i riquadri, è in
`apps/client/src/editors/spatial/tools/clips.ts`.

## Ciò che si vede è ciò che si tocca

La selezione, la cornice, l'aggancio, la gomma e l'export della selezione
guardano la **parte che si vede**: un clic sulla parte nascosta di un'immagine
ritagliata non la sceglie, e la sua cornice è quella del ritaglio, girata con
l'immagine. Lo stesso vale dentro un gruppo mascherato isolato, dove ogni
oggetto è ritagliato dalla maschera del gruppo, per un livello con un ritaglio
scritto da un altro programma, e per le punte di una linea ritagliata. Una
maschera d'opacità conta per la sua area, anche dove è nera. Un oggetto
nascosto del tutto si sceglie dall'albero degli oggetti.

## Con gli altri comandi

- **Duplicare, copiare e incollare** portano il ritaglio e la maschera con
  l'oggetto, ognuno coi suoi.
- **In Lettura e nell'[export](drawing-export.md)**, in PNG, JPEG, PDF e
  SVG pulito, i ritagli e le maschere sono quelli del foglio.

## Nel file

Un ritaglio è un `clipPath` fra le [risorse](drawing-resources.md) del
disegno, suo e di nessun altro, con un rettangolo nelle coordinate
dell'immagine.

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

I ritagli e le maschere restano nel disegno in ogni spazio e per ogni
[parte](drawing-custom.md#che-cosa-porta-una-parte), si vedono e valgono per
la selezione.
