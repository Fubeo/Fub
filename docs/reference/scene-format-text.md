# Formato della scena, testo

> **Ambito:** il testo di un disegno: le righe, i pezzi di una riga con uno
> stile loro, il corsivo, la spaziatura delle lettere, il sottolineato e il
> barrato; come si leggono, come si scrivono e come li cambia l'operazione
> `text`. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo; i
> valori in `scene/values.ts` e `crates/fub-scene/src/values.rs`; la
> scrittura dei pezzi in `scene/serialize.ts` e l'operazione `text` in
> `scene/engine.ts`, con i vettori di prova da 46 a 49
> ([operazioni sulla scena](scene-operations.md), §9).

Una parte del [formato della scena](scene-format.md), §4: un `text` è un
oggetto modificabile, e ogni suo `tspan` è una riga. Una riga può avere,
oltre al suo testo, dei pezzi con un aspetto loro: una parola in grassetto,
un'altra in corsivo o di un altro colore. Come si scrive e si cambia il
testo è in [Disegni, tipografia](../product/drawing-typography.md). Le
sezioni del formato si citano come «formato della scena, §N»; quelle di
questa pagina col solo numero.

```xml
<text id="o9i0j1k2l" x="720" y="460" fill="#000000" font-family="Inter, sans-serif" font-size="32">
  <tspan x="720" dy="0">Evaporazione</tspan>
  <tspan x="720" dy="40" font-style="italic" letter-spacing="1.5">in <tspan fill="#0072b2" font-weight="bold" text-decoration="underline">pioggia</tspan></tspan>
</text>
```

Due righe: la seconda scende di 40, è in corsivo con le lettere un po' più
larghe, e la parola «pioggia» è blu, in grassetto e sottolineata.

## 1. Le righe

- **Il testo** ha `x` e `y`, il punto dove comincia la prima riga, e gli
  attributi di presentazione del formato della scena, §4, che le righe
  ereditano.
- **Ogni figlio `tspan` è una riga**, con la sua `x` e il suo `dy`: quanto
  scende dalla riga prima. Il `dy` della prima riga è di solito 0; quello
  delle altre è l'interlinea. Una riga può scrivere gli stessi attributi di
  presentazione, e prende quelli del testo che non scrive.
- **Fra le righe** il file può avere spazi e a capo, che non sono testo:
  sono i nodi di soli spazi che il formato conserva. Il testo fuori dai
  `tspan` rende estraneo il `text`.

## 2. I pezzi di una riga

- **Un pezzo** è un `tspan` dentro una riga: il testo della riga e i pezzi
  si alternano come vogliono, e il pezzo dipinge il suo testo col suo
  aspetto.
- **Un livello solo:** un pezzo contiene soltanto dati di carattere. Un pezzo
  dentro un pezzo, un commento, una sezione CDATA o un riferimento a
  un'entità del DTD in un pezzo rendono estraneo il `text`.
- **Gli attributi di un pezzo** sono quelli di presentazione, tranne
  quelli che spettano alla riga o all'oggetto: `id`, `x`, `dy`,
  `text-anchor`, `display`, `opacity` e `transform` rendono estraneo il
  `text`. Un pezzo non è un oggetto e non si nomina; la posizione e
  l'allineamento sono della riga, che SVG divide in blocchi dove una
  posizione ricomincia; e l'opacità o la visibilità di un pezzo i programmi
  non le disegnano tutti allo stesso modo. Gli attributi degli altri
  namespace, come `xml:space`, si conservano come altrove.
- **Il testo di una riga** sono i suoi dati di carattere e quelli dei pezzi,
  in ordine, uniti senza aggiungere niente: `Eva<tspan>pora</tspan>zione` è
  la parola «Evaporazione». È il testo che la scena dà per la riga, che
  l'indice legge e che si cerca.

## 3. Gli attributi tipografici

Valgono sul `text`, su una riga e su un pezzo, e si aggiungono a
`font-family`, `font-size`, `font-weight` e `text-anchor` del formato della
scena, §4.

- **`font-style`:** `normal`, `italic` o `oblique`, e niente altro: un angolo
  dopo `oblique`, o `inherit`, rendono estraneo l'elemento. Si eredita, ed è
  ammesso anche sui gruppi.
- **`letter-spacing`:** `normal`, che vale 0, oppure una lunghezza del
  formato, anche negativa, con le stesse unità assolute: lo spazio in più
  dopo ogni carattere. Percentuali ed `em` rendono estraneo l'elemento. Si
  eredita, ed è ammesso anche sui gruppi.
- **`text-decoration`:** `none`, oppure una o più fra `underline`,
  `overline` e `line-through`, ciascuna al più una volta, separate da spazi.
  Ogni altra parola, come `blink` o un colore, rende estraneo l'elemento.
  Non si eredita: vale soltanto su `text` e `tspan`, e su un gruppo o una
  forma rende estraneo l'elemento, perché lì i programmi non la disegnano
  tutti allo stesso modo. SVG dipinge la linea col riempimento dell'elemento
  che la scrive: sotto un pezzo di un altro colore resta del colore della
  riga, se è la riga a scriverla.

## 4. La scrittura

- **L'ordine degli attributi** è quello del formato della scena, §7, con
  `font-style`, `letter-spacing` e `text-decoration` subito dopo
  `font-weight`, prima di `text-anchor`.
- **Una riga sta su una riga del file**, coi suoi pezzi: il testo della riga
  e ogni pezzo uno dopo l'altro, senza spazi o a capo in mezzo, che sarebbero
  testo. Il testo della riga e quello dei pezzi seguono gli escape del testo
  dei `tspan`.
- **La spaziatura** si scrive in unità utente con al più due decimali, come
  la geometria; `normal` resta `normal`.
- **Una riga letta e copiata**, come nella riscrittura di un `text` che
  cambia un attributo, porta il suo contenuto così com'è scritto, pezzi
  compresi.

## 5. L'operazione `text`

`lines` è la lista delle righe. Una riga è una stringa, oppure la lista delle
sue parti: il testo della riga, una stringa, e i pezzi, ciascuno
`{ "text": "…", "attrs": { "nome": "valore" } }`, con gli attributi come in
un `Elem` ([operazioni sulla scena](scene-operations.md), §2).

```json
{ "op": "text", "id": "o9i0j1k2l", "lines": ["Evaporazione", ["in ", { "text": "pioggia", "attrs": { "font-weight": "bold" } }]] }
```

- **La forma canonica:** le parti vuote si tolgono, due stringhe vicine si
  uniscono, e così due pezzi vicini con gli stessi attributi; un pezzo senza
  attributi è testo della riga, e una riga che resta senza pezzi si scrive
  come una stringa. Così un'operazione e la sua inversa danno gli stessi byte.
- **Il rifiuto:** un a capo o un carattere che XML non ammette, in una riga o
  in un pezzo, una parte che non è né una stringa né un pezzo, un pezzo
  senza `text` o senza `attrs`, un valore che non è una stringa, e un testo
  che dopo la scrittura sarebbe estraneo per §2 o §3 sono `invalid-elem`.
- **L'inversa** porta le righe di prima coi loro pezzi, letti dal file.
- **Le righe nuove** copiano gli attributi della riga prima, tranne `id` e
  `dy`, come per le righe di sole stringhe; i pezzi non si copiano.
- **`add` ed `Elem`:** un `tspan` figlio di un `text` può portare `runs`, le
  parti della riga nella stessa forma, al posto di `text`; tutti e due
  insieme sono `invalid-elem`. È la forma con cui si duplica e si incolla un
  testo coi suoi pezzi.

## 6. Ciò che si legge

- **Il contrasto e la grandezza** del [controllo di
  accessibilità](scene-format-accessibility.md) guardano ogni pezzo col suo
  colore, il suo corpo e il suo peso, nel punto d'inizio della riga: senza i
  caratteri non si sa dove cade il pezzo. Un pezzo piccolo e chiaro in una
  riga grande vuole il contrasto di un testo normale; il corpo più piccolo
  fra le righe e i pezzi è quello di S013. Un pezzo vuoto, di soli spazi o
  senza riempimento non si legge.
- **L'indice** legge ogni riga intera, coi suoi pezzi uniti senza spazi
  (formato della scena, §9).
- **La scena** dà per ogni riga il suo testo; i pezzi e i loro attributi
  restano nel documento, e la superficie li legge da lì.
