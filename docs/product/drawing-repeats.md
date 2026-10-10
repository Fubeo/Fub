# Disegni, ripetizioni e simmetria

> **Per chi:** chi disegna ciò che si ripete con una regola: i petali di un
> fiore, le sedie di una sala, le due metà di un volto, un mandala.
> **Risultato:** sapere come si ripete un oggetto intorno a un centro, in
> griglia o allo specchio, come si cambia, si espande e si separa una
> ripetizione, e come la penna e l'evidenziatore disegnano in simmetria.

Due modi di ripetere, per due bisogni diversi:

- **La ripetizione**, dal [livello Esperto](drawing-expert.md), mostra un
  oggetto più volte con una regola: le copie sono vive, e cambiare
  l'originale le cambia tutte. Le operazioni sono in
  `apps/client/src/editors/spatial/tools/repeat-ops.ts`; il file in
  [formato della scena, ripetizioni](../reference/scene-format-repeats.md).
- **La penna in simmetria**, dal [livello Standard](drawing.md#il-livello-standard),
  scrive con ogni tratto anche le sue copie, riflesse o girate: inchiostro
  vero, che dopo si modifica da solo. La simmetria è dello strumento, non del
  disegno, ed è in `tools/symmetry.ts`.

## Ripetere un oggetto

Il menu **«Ripeti»**, nella barra «Disponi», in «Selezione avanzata» e col
tasto destro, ha tre tipi e «Espandi la ripetizione»:

- **«Ripetizione radiale»:** l'originale otto volte intorno a un centro
  sotto di lui, lontano quanto basta perché le copie non si tocchino.
- **«Ripetizione a griglia»:** tre colonne per tre righe, coi passi di un
  quarto più larghi dell'originale.
- **«Ripetizione a specchio»:** l'originale e il suo riflesso sull'asse
  verticale per il suo bordo destro.

L'oggetto scelto va in un gruppo nuovo, al suo posto, e dopo di lui le
copie, che si disegnano sopra; più oggetti vanno prima in un gruppo, che
diventa l'originale. La ripetizione nuova resta scelta, ed è un passo
d'annulla: «Ripetizione radiale: l’originale 8 volte intorno al centro.»,
«Ripetizione a griglia: l’originale in 3 colonne per 3 righe.»,
«Ripetizione a specchio: l’originale e il suo riflesso.».

Su una ripetizione scelta, o sui suoi originali dentro la ripetizione
aperta, il menu segna il suo tipo; un altro tipo la rifà coi valori di
partenza, lo stesso non cambia niente. Un tipo che adesso non si può
scegliere resta sbiadito e dice perché:

- «Gli oggetti scelti non disegnano niente: per una ripetizione serve
  qualcosa da vedere.»;
- «Il contenitore degli oggetti scelti ha una trasformazione che li
  schiaccia: lì non si ripete niente.»;
- «Un originale non esce dalla sua ripetizione: per ripeterlo insieme ad
  altro, scegli la ripetizione intera.».

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
- **«Applica trasformazione»** lascia alla ripetizione la sua, e le copie
  vedono la geometria nuova dell'originale.
- **Il conto** del disegno conta l'originale una volta, e le copie no: un
  fiore di dodici petali ha una forma.

Il file resta un SVG che ogni programma apre: le copie sono `use`, e ogni
lettore di SVG le disegna.

## La sezione «Ripetizione»

Nel [pannello delle proprietà](drawing-properties.md), dopo «Forma», quando
è scelta una ripetizione, o un suo originale dentro la ripetizione aperta. Il
**«Tipo»** ha il menu dei tre tipi ed «Espandi la ripetizione»; sotto, i
valori del tipo, nell'unità del documento:

- **radiale:** «Volte», da 2 a 100; «Raggio», che allontana l'originale dal
  centro, e le copie lo seguono; «Centro X» e «Centro Y»;
- **a griglia:** «Colonne», «Righe», «Passo delle colonne» e «Passo delle
  righe»; le celle, colonne per righe, sono da 2 a 1000, e un valore che le
  porterebbe fuori lo dice nel campo: «Una griglia ha da 2 a 1000 celle,
  colonne per righe.»;
- **a specchio:** «Angolo dell’asse», in gradi, e «Distanza dell’asse», tutti
  e due dal centro dell'originale.

Ogni valore è un passo d'annulla, «Modifica della ripetizione», e la
selezione resta. Più volte aggiungono copie dopo le altre, meno volte tolgono
quelle in fondo; le copie che restano uguali non si riscrivono.

## Espandere e separare

- **«Espandi la ripetizione»**, nel menu «Ripeti» e nel «Tipo», mette al
  posto di ogni copia un duplicato del suo originale: id nuovi, la
  trasformazione che la copia gli dava, le risorse private copiate come per
  un duplicato. Resta un gruppo qualunque, scelto, che si vede uguale: «1
  ripetizione espansa: ogni copia ora è un oggetto, che si modifica da
  solo.». Un originale con parti di un altro programma non si espande,
  perché FubDraw non le sa copiare, e lo si dice.
- **«Separa»** (`Ctrl+Maiusc+G`) fa lo stesso e porta fuori gli oggetti come
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

Ogni comando dice che cosa ha fatto, e un tipo che non vale dice perché. Il
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

## Livelli e parti

Nel [Personalizzato](drawing-custom.md):

- **«Ripetizioni»**, dall'Esperto, portano il menu «Ripeti» e la sezione
  «Ripetizione». Senza, le ripetizioni restano nel disegno, si vedono e si
  scelgono come un oggetto; si aprono dove si isola un gruppo e si separano
  come un gruppo.
- **«Simmetria della penna»**, dallo Standard, porta la sezione «Simmetria».
  Senza, la penna scrive un tratto solo; la simmetria scelta torna con la
  parte. Le annotazioni dei PDF non l'hanno.
