# Le ancore di contenuto dell'inchiostro

> **Ambito:** le ancore `page` e `cell` dei tratti di una lavagna: un tratto
> attaccato alla pagina di un PDF o alla cella di un foglio. Versione 1.
> **Fonti autorevoli:** questa pagina e i vettori in
> `apps/client/src/__fixtures__/canvas-ink/`.

Il resto del formato dell'inchiostro (il livello, il tratto, le ancore
`card` e `free`, come si disegna) sta in [L'inchiostro della
lavagna](canvas-ink.md#lancora). Il perché delle ancore di contenuto sta
nell'[ADR 0243](../decisions/0243-le-ancore-di-contenuto.md).

## L'ancora di pagina

Un tratto scritto sulla pagina di una scheda PDF è della pagina, non della
scheda: si vede solo quando la scheda mostra quella pagina.

```json
{ "id": "s-7", "tool": "pen", "brush": "pf1 size=7.9 pen=ballpoint",
  "color": "#0072b2",
  "anchor": { "kind": "page", "page": 3, "width": 595, "height": 842 },
  "ink": "1 s100 cxy 9917,11900 120,40 95,-10" }
```

- **`page`:** la pagina, da 1, un intero per valore (`3`, `3.0`). Zero, un
  numero negativo o non intero, o un valore che non è un numero: l'ancora
  non vale.
- **`width`, `height`:** la misura della pagina in punti PDF (1/72 di
  pollice) quando il tratto si è scritto, la pagina come si vede, con la sua
  rotazione: una A4 ruotata è `842 × 595`. Numeri finiti maggiori di zero,
  anche decimali (`595.276`).
- **I punti** (e lo spessore del pennello) sono in punti PDF dall'angolo in
  alto a sinistra di quella pagina. Un programma che ha il PDF ritrova il
  posto senza sapere come Fub disegna la scheda.
- **Quando nasce:** un tratto che `anchorAt` dà a una scheda PDF e che
  comincia dentro la pagina che la scheda mostra, i bordi compresi. Sopra la
  scheda ma fuori dalla pagina (la testata) prende l'ancora `card`. Conta
  dove comincia: un tratto che parte sulla pagina e ne esce resta della
  pagina.
- **Come si disegna:** solo quando la scheda mostra la pagina `N`, da viva o
  da ferma (l'immagine ferma è quella di una pagina). La pagina `W × H` va
  sul rettangolo dove la scheda la mostra (`pageBox()`, nelle [schede della
  lavagna](canvas-cards.md#il-contratto)) con `s = min(w / W, h / H)`,
  dall'angolo in alto a sinistra: SVG con `viewBox="0 0 W H"` e
  `preserveAspectRatio="xMinYMin meet"`. Ciò che esce dalla pagina si vede
  fino al bordo della scheda, e lì si taglia. Voltata la pagina il tratto
  sparisce; tornati, ricompare. Il file non cambia.
- **Il PDF cambiato:** una pagina con un'altra misura scala il tratto sulla
  pagina nuova (la misura scritta serve a chi non ha il PDF); una pagina che
  non c'è più lascia il tratto nel file, e non si vede.
- **Il nucleo** non sa dove la pagina sta nella scheda: `move_strokes` e lo
  spessore di `restyle_strokes` su un tratto di pagina sono `Invalid`, e il
  Lazo non lo sceglie. La gomma lo prende dove si vede; il colore si cambia.

## L'ancora di cella

Un tratto scritto sopra la griglia di una scheda di foglio è della cella sotto
il centro del suo riquadro: segue la cella quando il foglio scorre.

```json
{ "anchor": { "kind": "cell", "sheet": "Conti 2025", "cell": "B3" } }
```

- **`sheet`:** il nome del foglio com'è nel file, un testo non vuoto, spazi e
  virgolette compresi, senza gli apici delle formule (`Conti 'Q1'`, non
  `'Conti ''Q1'''`). Vuoto o non testo: l'ancora non vale.
- **`cell`:** l'indirizzo in notazione A1, colonna da `A` a `XFD`, riga da 1
  a 1048576, solo maiuscole, senza `$` né zeri davanti: `B3`, `XFD1048576`.
  `A0`, `B`, `b3`, `$B$3`, `B03` o `XFE1`: l'ancora non vale.
- **I punti** (e lo spessore) sono in pixel del foglio al 100% dall'angolo in
  alto a sinistra della cella. Non c'è una misura: il tratto non si stira con
  la cella.
- **Quando nasce:** un tratto che `anchorAt` dà a una scheda di foglio, con
  il centro del suo riquadro su una cella della griglia (`cellAnchorAt`).
  Sopra le intestazioni o fuori dalla griglia prende l'ancora `card`. Sopra
  celle unite prende la cella in alto a sinistra dell'unione.
- **L'indirizzo, non il contenuto.** Il tratto segue il nome della cella. Un
  esempio: un tratto su `B3`; un altro programma inserisce una riga sopra la
  3, e il valore che era in `B3` ora sta in `B4`; il tratto resta su `B3`,
  sopra il valore nuovo. Un foglio rinominato o tolto, o una scheda che non
  è più un foglio: il tratto resta nel file e non si vede, finché un foglio
  con quel nome torna.
- **Come si disegna:** solo quando la scheda di foglio mostra la cella,
  da viva o da ferma (ferma, com'era nell'ultima vista viva). L'angolo della
  cella va dove la scheda la mostra adesso (`cellRect()`, nelle [schede
  della lavagna](canvas-cards.md#il-contratto)), e un pixel del foglio vale
  `zoom` unità della lavagna (1: la scheda mostra il foglio al 100%): SVG
  sul rettangolo della cella con `viewBox="0 0 w/zoom h/zoom"`, che non
  taglia. Ciò che esce dalla cella si vede fino al bordo della scheda, e lì
  si taglia, anche sopra le intestazioni. Di un'unione conta la cella in
  alto a sinistra, anche scorsa via mentre l'unione si vede ancora.
- **Il foglio che scorre:** la scheda dice che le celle si sono spostate
  (`cellsShown()`) dopo averle disegnate, e la tela ridisegna i tratti di
  cella della scheda subito: il tratto e la cella cambiano posto nello
  stesso fotogramma. Una cella scorsa via, su una riga o una colonna
  nascosta, o un altro foglio in vista: il tratto non si vede. Mentre si
  scrive nella scheda (la griglia vera al posto della resa) i tratti di
  cella non si vedono. Scorrere non cambia il file.
- **Il nucleo** non sa dove la cella sta nella scheda: come per la pagina,
  `move_strokes` e lo spessore di `restyle_strokes` sono `Invalid`, e il
  Lazo non lo sceglie. La gomma lo prende dove si vede; il colore si cambia.
