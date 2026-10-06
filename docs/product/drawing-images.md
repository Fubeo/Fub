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

Dal [livello Standard](drawing.md#il-livello-standard), **«Immagine dal
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
disegno, e oltre restano riquadri; il file non cambia. Un altro programma vede
l'immagine se vi si risolve il percorso, per esempio aprendo il disegno dalla
cartella del vault; un disegno che deve viaggiare da solo, con le immagini
dentro, le riceve incollate.

Chi monta l'editor apre, legge e sceglie le immagini del vault con `images`;
senza, un'immagine del vault è un riquadro e «Immagine dal vault…» non c'è.
Le regole della Lettura stanno in `apps/client/src/editors/spatial/read-images.ts`.
