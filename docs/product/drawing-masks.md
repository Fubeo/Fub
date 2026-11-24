# Disegni, ritagli e maschere

> **Per chi:** chi apre un disegno con foto ritagliate, o con forme che si
> ritagliano o si sfumano a vicenda.
> **Risultato:** sapere che cosa fanno i ritagli e le maschere che un disegno
> porta, e che cosa ne fanno la selezione, gli altri comandi e l'export.

Un **ritaglio** mostra soltanto una parte di un'immagine, che resta intera
nel file. Le **maschere** fanno lo stesso con ogni oggetto: una forma
ritaglia gli oggetti di un gruppo, o ne fa la trasparenza col suo chiaro e il
suo scuro. Fuori dal livello Completo, Fub li mostra e li rispetta quando
un disegno li porta, scritti da un altro programma o da una versione
precedente, ma non li crea, non li cambia e non li toglie: i comandi
«Maschera» se ne sono andati col livello
Esperto, e «Ritaglia…» e «Togli il ritaglio» col livello Standard (decisione
0231). Il livello Completo crea e rilascia le maschere di ritaglio (sotto).
La parte che si vede, per la selezione e i riquadri, è in
`apps/client/src/editors/spatial/tools/clips.ts`.

## Maschere di ritaglio nel Completo

Con il livello Completo, **≡ › Oggetto › Maschera di ritaglio** torna a
crearle, in un passo di Annulla ciascuna:

- **Crea**: il tracciato più in alto fra gli oggetti scelti ritaglia gli
  altri, che vanno in un gruppo al suo posto. Servono almeno due oggetti, e
  quello in cima deve essere un tracciato o una forma: con un testo in cima
  la voce è spenta e dice perché;
- **Rilascia**: il gruppo perde il ritaglio, e il tracciato che ritagliava
  torna primo nel gruppo, senza colore, perché si possa riprendere;
- **Modifica contenuto**: sceglie gli oggetti dentro la maschera;
- **Modifica maschera**: sceglie il tracciato che ritaglia, dal gruppo o da
  un oggetto dentro. Si sposta, si ruota e si scala
  come ogni oggetto, e il ritaglio segue. Non si elimina da
  solo, perché il gruppo resterebbe con un ritaglio vuoto: lo dice e indica
  Rilascia. La voce è spenta, e dice perché, se il ritaglio viene da un
  altro programma o è condiviso: la sua forma allora non ha un id;
- **≡ › Selezione › Oggetto › Maschere di ritaglio** sceglie tutte le
  maschere del disegno.

Nel file la maschera è SVG semplice: un `<g clip-path="url(#…)">` con gli
oggetti e un `clipPath` fra le risorse col tracciato che ritaglia, quindi un
altro programma la legge com'è e Fub la riapre uguale. Si aprono e si
rilasciano anche le maschere scritte da Inkscape, col loro `clipPath` in
`<defs>`, che resta nel file. Un ritaglio scritto sull'oggetto stesso e non
su un gruppo, come lo scrive Illustrator, si vede e si tiene, ma Rilascia
non lo toglie ancora e lo dice. Il ritaglio di un livello non c'è ancora:
è spento e dice perché.

**Maschera di opacità.** Il comando Crea maschera di opacità, nel pannello
Trasparenza, prende il più alto dei due o più oggetti scelti come maschera
degli altri: la luminanza della maschera fa da opacità, e il file la scrive
con una `mask`. Con un oggetto solo, con una maschera che non ritaglia o
invertita, e con un oggetto bloccato il comando non parte e dice perché.
Rilascia, Disattiva, Scollega, le opzioni, la modifica della maschera e le
impostazioni delle nuove maschere non ci sono ancora (K6 T15 giro maschere).

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

Un ritaglio è un `clipPath` privato fra le risorse del disegno; maschera di
opacità è un `mask`. Come li scrive il file è in [Formato della scena,
risorse](../reference/scene-format-resources.md#i-ritagli-e-le-maschere).

## Spazi e parti

I ritagli e le maschere restano nel disegno in ogni spazio e per ogni
[parte](drawing-custom.md#che-cosa-porta-una-parte), si vedono e valgono per
la selezione.
