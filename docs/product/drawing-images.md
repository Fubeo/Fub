# Disegni, immagini

> **Per chi:** chi mette fotografie, schermate o figure in un disegno.
> **Risultato:** sapere come un'immagine entra in un [disegno](drawing.md),
> quanto pesa e dove si vede.

Un'immagine entra in un disegno in due modi. Incollata, porta i suoi byte nel
file, che resta uno solo e si apre uguale dovunque. Dal vault, il disegno la
nomina col percorso e resta leggero, ma la mostra soltanto dove il vault c'è.

## Incollate

Un'immagine incollata con `Ctrl+V` o `⌘V`, o un file lasciato sul foglio,
entra nel disegno come `<image>` con i byte nell'attributo `href`, in un data
URI: il file resta uno solo, e si apre uguale su un altro computer. Entrano
PNG, JPEG, GIF e WebP così come sono; un altro formato che il browser sa
leggere diventa PNG, e un JPEG girato dall'EXIF si ricodifica diritto, perché
non tutti i programmi che leggono un SVG seguono l'EXIF. Un SVG entra coi suoi
elementi, come dice [Disegni, appunti](drawing-clipboard.md).

L'immagine va dove sono il puntatore o il cursore, se sono nella vista, e
altrimenti al centro della vista. Ogni pixel misura un'unità, finché
l'immagine non supera i quattro quinti della vista: allora si rimpicciolisce
fino a starci. Più immagini insieme si dispongono a scala, sono un passo solo
di annulla, e restano scelte con lo strumento selezione.

Un'immagine pesa al più 5 MiB, e quelle incollate insieme se li dividono.
Oltre, la finestra propone di ridurle: una foto senza trasparenza diventa
JPEG, una con la trasparenza resta PNG e perde pixel, e sul foglio la misura
resta la stessa. Una GIF ridotta perde l'animazione. Un disegno vicino al
limite oltre il quale si aprirebbe in sola lettura riceve soltanto le immagini
che ci stanno.

Le regole stanno in `apps/client/src/editors/spatial/tools/images.ts`.

## Dal vault

In tutti e due gli spazi di [lavoro](drawing.md#completo-e-semplice), **«Immagine dal
vault…»** (`Ctrl+I` o `⌘I`) mette nel disegno un'immagine che è già nel vault,
senza copiarla: l'`<image>` la nomina col percorso, scritto come l'`href` di un
[collegamento](drawing.md#collegamenti), e il disegno resta leggero. La
finestra elenca le immagini del vault, le più recenti prima e ciascuna con la
sua miniatura, da filtrare per nome o percorso; oltre le prime 500 le altre si
contano in fondo. Gli SVG non ci sono: nel vault sono
disegni, e a un disegno si porta un collegamento. L'immagine scelta va dove
andrebbe incollata, con la sua misura in pixel, e resta scelta con lo
strumento selezione; un'immagine che non si apre più, o che il browser non sa
leggere, lo dice.

Un'immagine del vault si vede sul foglio e in Lettura finché il suo file c'è, e
quando il file cambia nome o cartella Fub riscrive il percorso nel disegno,
come per un collegamento. Una che non si trova, o un indirizzo del web, è un
riquadro tratteggiato: il disegno non carica niente dalla rete. In Lettura le
immagini del vault entrano nell'`<img>` coi loro byte, fino a 64 MiB per
disegno, e oltre restano riquadri; il file non cambia. Lo stesso vale per
l'[export](drawing-export.md), dove al posto del riquadro non c'è niente e
l'SVG pulito tiene il percorso. Una nota che mostra il disegno, con
`![[casa.svg]]`, fa lo stesso, fino a 16 MiB di immagini e per un disegno fino
a 16 MiB: oltre, lo mostra dal file. Un altro programma vede l'immagine se vi
si risolve il percorso, per esempio aprendo il disegno dalla cartella del
vault; un disegno che deve viaggiare da solo, con le immagini dentro, le
riceve incollate, o esce in SVG pulito, che le porta coi loro byte.

Chi monta l'editor apre, legge e sceglie le immagini del vault con `images`;
senza, un'immagine del vault è un riquadro e «Immagine dal vault…» non c'è.
Le regole della Lettura stanno in `apps/client/src/editors/spatial/read-images.ts`,
la copia che si vede da sola, coi caratteri, in `picture.ts` accanto.

## La descrizione

Nello spazio [Completo](drawing.md#completo-e-semplice) un'immagine che entra,
incollata, lasciata sul foglio o presa dal vault, chiede che cosa mostra: una
barra in fondo al foglio ne scrive la descrizione, ciò che uno screen reader
dice al posto dei pixel, oppure la dichiara decorativa, da saltare. Si può
anche lasciarla senza, e ritrovarla poi fra i problemi della verifica:
[Disegni, accessibilità](drawing-accessibility.md#la-descrizione-allinserimento).

## Ritagli

Un'immagine ritagliata da una versione precedente o da un altro programma
mostra soltanto la parte del ritaglio, e resta intera nel file. Nello spazio
Semplice l'editor non ritaglia (decisione 0231); nel Disegno completo sì, con
Ritaglia immagine. Come stanno i ritagli e le maschere è in
[Disegni, ritagli e maschere](drawing-masks.md).

## Nel Disegno completo

Le voci delle immagini del Disegno completo fanno quello che fanno in
VectorCraft. Le fa l'editor, non il motore: solo l'editor legge i file del
vault e sa decodificare le immagini. Il motore, se le riceve, le rifiuta come
non supportate.

| Voce | Che cosa fa |
|---|---|
| File › Inserisci… | Sceglie un'immagine del vault e la mette dove è il cursore, collegata al file: è la stessa cosa di Ctrl+I ([Dal vault](#dal-vault)). |
| Oggetto › Ritaglia immagine | Apre un riquadro sulla prima immagine scelta, e la scelta si stringe a lei. |
| Incorpora immagine | Le immagini scelte collegate a un file ricevono i byte di quel file: il disegno non dipende più dal vault. |

### Ritaglia immagine

Il riquadro parte da ciò che dell'immagine si vede: tutta, o il ritaglio che
ha già.

- **Maniglie**: le otto maniglie lo tirano. Con Maiusc tiene le proporzioni,
  con Alt cresce dal centro.
- **Interno**: trascinare dentro il riquadro lo sposta.
- **Limiti**: il riquadro resta sempre dentro l'immagine, con almeno un punto
  per lato.
- **Fuori dal riquadro**: l'immagine è scurita, compresa la parte che un
  ritaglio precedente aveva tolto. Un clic lì non fa niente.

Per finire:

- Invio, il doppio clic o di nuovo Ritaglia immagine ritagliano, in un passo
  di annulla.
- Un riquadro uguale a ciò che si vede non cambia niente.
- Esc lascia l'immagine com'era.
- Cambiare la scelta, aprire un altro disegno o passare alla sola lettura
  chiudono il riquadro senza scrivere.

Un'immagine ruotata o inclinata gira insieme al suo riquadro.

Il ritaglio si scrive in modo diverso da VectorCraft, per non perdere dati.
VectorCraft riscrive i pixel; qui il ritaglio è il `clipPath` dell'immagine,
come in [Disegni, ritagli e maschere](drawing-masks.md). Quindi:

- i byte e il collegamento al file restano;
- la misura sul foglio resta;
- un altro ritaglio può ridare la parte tolta.

Un'immagine con un ritaglio che l'editor non sa cambiare (una forma che non è
un rettangolo, o una maschera) lo dice: prima si toglie con Oggetto ›
Maschera di ritaglio › Rilascia. Il codice dello strumento è in
`apps/client/src/editors/spatial/tools/editor/ritaglio-immagine.ts`.

### Incorpora immagine

Legge ogni file collegato. Per i byte valgono il peso massimo e la riduzione
delle immagini [incollate](#incollate): oltre il limite, l'editor chiede prima
di ridurre l'immagine. La misura sul foglio non cambia. Il nuovo contenuto
sostituisce `href`, `xlink:href` o tutti e due, come li aveva l'immagine.

Se un file non si legge, nessuna immagine cambia, e l'editor dice quale file
manca. Il disegno non cambia neanche se, mentre si legge, viene aperto un altro
disegno o passa alla sola lettura. Tutte le immagini incorporate insieme si
annullano con un solo passo.

