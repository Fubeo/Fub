# Disegni, ripetizioni e simmetria

> **Per chi:** chi disegna ciò che si ripete con una regola: i petali di un
> fiore, le sedie di una sala, le due metà di un volto, un mandala.
> **Risultato:** sapere che cosa fa una ripetizione che il disegno porta,
> come si separa, e come la penna e l'evidenziatore disegnano in simmetria.

Due modi di ripetere, per due bisogni diversi:

- **La ripetizione** mostra un oggetto più volte con una regola: le copie
  sono vive, e cambiare l'originale le cambia tutte. Fub le mostra e le tiene
  vive quando un disegno le porta, scritte da una versione precedente, ma non
  ne crea di nuove e non le cambia: il menu «Ripeti» e la sezione
  «Ripetizione» se ne sono andati col livello Esperto (decisione 0231). Ciò
  che le tiene vive è in `apps/client/src/editors/spatial/tools/repeat-ops.ts`;
  il file in [formato della scena, ripetizioni](../reference/scene-format-repeats.md).
- **La penna in simmetria**, nello spazio [Completo](drawing.md#completo-e-semplice),
  scrive con ogni tratto anche le sue copie, riflesse o girate: inchiostro
  vero, che dopo si modifica da solo. La simmetria è dello strumento, non del
  disegno, ed è in `tools/symmetry.ts`.

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

## La penna in simmetria

Con la penna o l'evidenziatore in mano e niente di scelto, il pannello delle
proprietà ha la sezione **«Simmetria»**, dopo «Forma». Il **«Tipo»**:

- **«Nessuna»**, di partenza: un tratto è un tratto.
- **«Asse verticale»** e **«Asse orizzontale»:** il tratto e la sua immagine
  allo specchio sull'asse per il centro.
- **«Radiale»:** da 2 a 12 **«Spicchi»** uguali intorno al centro, ognuno
  con una copia del tratto girata. **«Specchiata»**, come in un
  caleidoscopio, dà a ogni spicchio anche l'immagine riflessa, e i tratti
  sono il doppio degli spicchi; il primo asse dello specchio è verticale,
  così due spicchi specchiati sono i quattro quadranti. Accesa la prima
  volta, la radiale ha otto spicchi specchiati.

Sotto, **«Centro X»** e **«Centro Y»**; con la simmetria accesa il menu del
tipo ha anche **«Rimetti al centro»**. Niente di questo cambia il disegno né
la sua cronologia: «Simmetria» è un'impostazione dello strumento, che dura
finché il disegno è aperto, per la penna e l'evidenziatore insieme. Scelta
la penna, si sente anche come disegna: «Strumento: Penna. Simmetria radiale
a 8 spicchi specchiati.».

### I tratti

Ogni tratto scrive le sue copie dopo di sé, nello stesso livello e nello
stesso passo d'annulla: «Tratto aggiunto. Con 15 copie in simmetria. Il
disegno ha 16 oggetti.». Sono tratti come gli altri, con la pressione e il
pennello del tratto; la direzione in cui la penna è inclinata gira e si
specchia con loro.
Mentre si disegna, le copie si vedono già.

- **Le forme dal tratto:** un tratto tenuto fermo diventa la forma a cui
  somiglia, e così le sue copie, in un passo; annulla riporta l'inchiostro
  con le sue copie ([Disegni, forme dal tratto](drawing-ink-shapes.md)).
- **Una copia che uscirebbe dai numeri dell'inchiostro,** molto lontano,
  non si scrive.
- **Dopo** le copie si scelgono, si spostano e si cancellano da sole, come
  ogni tratto.

### Il centro e le guide

Con la simmetria accesa, il foglio mostra gli assi o i raggi, tratteggiati
dal centro fino al bordo della vista, e il centro come un anello: una
radiale ha un raggio per ogni bordo di spicchio, specchiata uno per ogni
asse dello specchio.

- **Il centro parte** dal centro della tavola che si guarda, o della prima;
  senza tavole, della pagina; senza pagina, di ciò che si vede.
  «Rimetti al centro» ce lo riporta, e un altro disegno aperto nello stesso
  editor lo rimette al suo posto.
- **Si prende e si tira** con il mouse, la penna o il dito: sopra il centro
  il cursore lo dice, e mentre lo si tira un'etichetta dice dove sta, e i
  campi lo seguono. Un tocco fermo non lo sposta e non disegna.
- **Si aggancia** al centro di una tavola o, senza tavole, della pagina,
  tranne tenendo `Ctrl` o `⌘`; `Esc` lo rimette dov'era. Lasciato, lo si
  dice: «Centro della simmetria al centro della pagina: x 200, y 200.».

## Accessibilità

Ogni comando dice che cosa ha fatto. Il
centro della simmetria si scrive anche coi campi, che si raggiungono con la
tastiera; le guide e l'anello non sono il solo modo di sapere com'è la
simmetria, che lo strumento scelto dice a parole. La [verifica
dell'accessibilità](drawing-accessibility.md) misura il contrasto di un testo
sull'originale dov'è; sopra una copia il fondo non si sa, come sopra
un'istanza di un [simbolo](drawing-symbols.md), e il contrasto non si misura.

## Esportare e altri programmi

L'SVG pulito tiene le copie come `use` e lascia `fub:repeat` con gli altri
attributi di FubDraw; il PNG, il JPEG e il PDF disegnano ogni copia
([Disegni, esportare](drawing-export.md)). I tratti della penna in
simmetria sono tratti come gli altri, anche fuori da FubDraw.

## Spazi e parti

Per chi monta l'editor con le sue [parti](drawing-custom.md#che-cosa-porta-una-parte):

- **Le ripetizioni** restano nel disegno in ogni spazio, si vedono e si
  scelgono come un oggetto; si aprono dove si isola un gruppo e si separano
  come un gruppo.
- **«Simmetria della penna»**, nello spazio Completo, porta la sezione «Simmetria».
  Senza, la penna scrive un tratto solo; la simmetria scelta torna con la
  parte. Le annotazioni dei PDF non l'hanno.
