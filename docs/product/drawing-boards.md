# Disegni, tavole

> **Per chi:** chi apre un disegno fatto di più pagine: le schermate di
> un'app, le pagine di una presentazione, la copertina e i fogli di un
> quaderno.
> **Risultato:** sapere che cos'è una tavola, che cosa ne fa l'editor e
> come una nota ne mostra una sola.

Un [disegno](drawing.md) può avere più **tavole**: pagine sulla stessa tela,
ognuna col suo nome e la sua carta, una accanto all'altra. Gli oggetti restano
nei livelli, e una tavola non li contiene: è un rettangolo sulla tela. Ciò che
le sta sopra però è suo: è ciò che mostra una nota che incorpora soltanto lei.
Un disegno senza tavole è una pagina sola. Come il file le scrive sta in
[formato della scena, tavole](../reference/scene-format-boards.md).

L'editor non crea più tavole e non le cambia: lo strumento Tavola, l'elenco
delle tavole, la sezione «Tavola» delle proprietà, i loro tasti e la
presentazione se ne sono andati col livello Standard (decisione 0231). Le
tavole che un file ha già restano dove sono, si vedono e si visitano, e un
disegno aperto e salvato senza modifiche resta uguale byte per byte.

## Sul foglio

- **La tela.** Con le tavole il foglio mostra le loro carte, ognuna col suo
  nome sopra l'angolo in alto a sinistra, e non più la carta della pagina. La
  pagina resta il riquadro del disegno intero, quello che mostra la Lettura:
  copre le tavole, e si allarga da sola quando ciò che porta una tavola ne
  esce. Il nome gira col foglio; una tavola troppo stretta sullo schermo non
  lo mostra. È un'etichetta del foglio: nell'immagine del disegno non c'è.
- **Fuori dalle tavole** si disegna come sempre. Ciò che non sta su nessuna
  tavola resta nel disegno, nel file e nella Lettura, ma non nell'immagine di
  una tavola.
- **Una tavola non è un oggetto.** La Selezione non la prende, l'albero degli
  oggetti non la elenca, e non si blocca né si nasconde. Spostare gli oggetti
  che le stanno sopra non sposta la tavola.
- **Esportare.** La finestra «Esporta» sa ancora esportare le tavole, una per
  file ([Disegni, esportare](drawing-export.md)).

## Le tavole nelle note

Ogni tavola è una sezione del disegno, come un titolo in una nota:

- **`[[disegno#Copertina]]`** apre il disegno sulla tavola «Copertina»: la
  sceglie e la inquadra, e la selezione resta com'era. Lo stesso fanno le
  voci delle tavole nella vista Struttura, dopo il titolo del disegno, e la
  ricerca trova il disegno anche per i nomi delle sue tavole.
- **`![[disegno#Copertina]]`** incorpora soltanto quella tavola, ritagliata
  sul suo rettangolo, coi caratteri e le immagini del vault come il disegno
  intero; di un oggetto a cavallo del bordo si vede la parte dentro. La
  didascalia dice il titolo del disegno e la tavola: «Quaderno di viaggio ·
  Copertina».
- **Il titolo** del disegno resta il disegno intero: dopo il `#` mostra
  tutto, come senza.
- **I nomi si confrontano come sono scritti**: «copertina» non è
  «Copertina». Un nome che non è né il titolo né una tavola non è una
  sezione del disegno, e l'embed non si risolve; rinominare una tavola non
  riscrive i riferimenti al nome di prima. Una tavola senza nome si chiama
  col suo id.
- **Lo stesso nome due volte.** Due tavole con lo stesso nome, o una col nome
  del disegno, si possono avere: il nome porta alla prima, il titolo prima
  delle tavole, e la diagnostica lo segnala (S016).

Il banco di fedeltà (`apps/client/bench/fidelity.mjs`) confronta il foglio,
la Lettura e il PNG anche su tre tavole, con la carta bianca, colorata e
senza, e guarda una tavola sola come il suo embed, ritagliata sulla tavola.

## Il file

```xml
<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1122.52" height="793.7" fill="#ffffff"/>
<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 1122.52 793.7">
  <title>Copertina</title>
</view>
```

Una tavola è un `view` di SVG, figlio della radice, col suo rettangolo nel
`viewBox` e il nome nel primo `title`; la sua carta è un `rect` con la stessa
geometria, che un altro programma disegna come un foglio sulla tela; qui è
la carta della pagina, presa dalla tavola 1. Il file resta un SVG: un browser
che apre `disegno.svg#b1a2b3c4d`, con l'id di una tavola, mostra soltanto il
suo rettangolo. L'ordine, i limiti, le operazioni e la diagnostica stanno in
[formato della scena, tavole](../reference/scene-format-boards.md).
