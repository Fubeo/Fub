# Disegni e ripetizioni

> **Per chi:** chi apre un disegno con ciò che si ripete con una regola: i
> petali di un fiore, le sedie di una sala, un mandala.
> **Risultato:** sapere che cosa fa una ripetizione che il disegno porta e
> come si separa.

La **ripetizione** mostra un oggetto più volte con una regola: le copie sono
vive, e cambiare l'originale le cambia tutte. Fub le mostra e le tiene vive
quando un disegno le porta, scritte da una versione precedente, ma non ne
crea di nuove e non le cambia: il menu «Ripeti» e la sezione «Ripetizione»
se ne sono andati col livello Esperto, e la penna in simmetria col livello
Standard (decisione 0231). Ciò che le tiene vive è in
`apps/client/src/editors/spatial/tools/repeat-ops.ts`; il file in
[formato della scena, ripetizioni](../reference/scene-format-repeats.md).

## Copie vive

Ogni copia mostra l'originale com'è: cambiarlo, spostarlo o ingrandirlo
cambia tutte le copie, e lo si vede subito, anche mentre si trascina. Il
centro, i passi e l'asse non dipendono dall'originale.

- **La ripetizione è un oggetto solo.** Un clic su una copia, e `Ctrl+A`,
  scelgono la ripetizione intera; le copie non si scelgono da sole. Nell'albero
  degli oggetti la ripetizione ha il suo tipo e quanti originali ha,
  «Ripetizione a specchio, 1 oggetto», e si apre sui suoi originali, non
  sulle copie.
- **L'originale si modifica dentro la ripetizione,** che si apre come un
  [gruppo isolato](drawing-selection.md#isolare-un-gruppo): due tocchi,
  `Ctrl+Invio` o `⌘Invio`. Ciò che vi si disegna, vi si incolla o vi si
  sposta è un originale anche lui, e riceve le sue copie nello stesso passo
  d'annulla.
- **Eliminare l'ultimo originale** toglie la ripetizione intera.
- **Duplicare, copiare e incollare** una ripetizione ne fanno un'altra, con
  le copie rivolte al suo originale ([Disegni, appunti](drawing-clipboard.md)).
- **Il conto** del disegno conta l'originale una volta, e le copie no: un
  fiore di dodici petali ha una forma.

Il file resta un SVG che ogni programma apre: le copie sono `use`, e ogni
lettore di SVG le disegna.

## Separare

**«Separa»** (`Ctrl+Maiusc+G`) mette al posto di ogni copia un duplicato del
suo originale, con id nuovi, la trasformazione che la copia gli dava e le
risorse private copiate come per un duplicato, e porta fuori gli oggetti come
da ogni gruppo, con la trasformazione, lo stile e l'opacità della
ripetizione: «1 gruppo separato.».

## Accessibilità

Ogni comando dice che cosa ha fatto. La [verifica
dell'accessibilità](drawing-accessibility.md) misura il contrasto di un testo
sull'originale dov'è; sopra una copia il fondo non si sa, come sopra
un'istanza di un [simbolo](drawing-symbols.md), e il contrasto non si misura.

## Esportare e altri programmi

L'SVG pulito tiene le copie come `use` e lascia `fub:repeat` con gli altri
attributi di FubDraw; il PNG, il JPEG e il PDF disegnano ogni copia
([Disegni, esportare](drawing-export.md)).

## Spazi e parti

Per chi monta l'editor con le sue [parti](drawing-custom.md#che-cosa-porta-una-parte):

- **Le ripetizioni** restano nel disegno in ogni spazio, si vedono e si
  scelgono come un oggetto; si aprono dove si isola un gruppo e si separano
  come un gruppo.
