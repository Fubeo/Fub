# Formato della scena, risorse

> **Ambito:** le risorse di un disegno: sfumature, campioni, motivi e
> campiture, marcatori, ritagli, maschere, filtri e i tracciati che i testi seguono;
> dove stanno, come si leggono e si scrivono, come gli oggetti le usano e
> come le operazioni tengono veri i riferimenti. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo; i
> valori in `scene/values.ts` e `crates/fub-scene/src/values.rs`; la
> scrittura in `scene/serialize.ts`, le operazioni in `scene/engine.ts`, con
> i vettori di prova da 50 a 59, 63, 64, 76 e 77 ([operazioni sulla
> scena](scene-operations.md), §9), il disegno in `painter/paint.ts`, e le
> punte delle linee in `tools/tips.ts`, coi vertici in `scene/markers.ts`;
> le campiture in `tools/hatches.ts`, i motivi in `tools/patterns.ts`.

Una parte del [formato della scena](scene-format.md), §4. Una risorsa è un
elemento che non si disegna da solo e che gli oggetti usano per riferimento:
una sfumatura nel riempimento, un colore con un nome, una punta di freccia
alla fine di una linea, un ritaglio, una maschera, un filtro, il tracciato
che un testo segue. Che cosa ne fa l'editor sta in [Disegni,
risorse](../product/drawing-resources.md) e, per i campioni, in [Disegni,
colori](../product/drawing-colors.md). Le sezioni del formato si citano come
«formato della scena, §N»; quelle di questa pagina col solo numero.

```xml
<defs id="fub-defs">
  <linearGradient id="r1a2b3c4d" fub:role="private" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#0072b2"/>
    <stop offset="1" stop-color="#56b4e9" stop-opacity="0.5"/>
  </linearGradient>
</defs>
…
<rect id="o5e6f7g8h" x="100" y="100" width="300" height="200" fill="url(#r1a2b3c4d) #4593ce"/>
```

Un rettangolo riempito da una sfumatura che va da sinistra a destra, dal blu
pieno all'azzurro mezzo trasparente; chi non sa disegnare la sfumatura lo
riempie del colore dopo il riferimento.

## 1. Dove stanno

- **La `defs` della radice:** un `defs` figlio della radice, che fra gli
  attributi SVG ha soltanto un `id` non vuoto, è un contenitore
  modificabile: i suoi figli si giudicano uno per uno, come in un livello.
  Ognuno è una risorsa, un `title`, un `desc` o un blocco estraneo. La `defs`
  può stare in qualunque punto fra i figli della radice: Inkscape la scrive
  in cima, Figma in fondo. Non si blocca e non si nasconde. Anche una `defs`
  senza id, o fatta tutta di figli estranei, resta una `defs`.
- **Le risorse nuove** vanno nella `<defs id="fub-defs">`, che FubDraw crea
  dopo `title` e `desc` e prima della carta; se il documento non ce l'ha,
  nella prima `defs` della radice che ha un id.
- **Altrove le risorse sono estranee:** una `defs` dentro un livello, un
  gruppo o un'altra `defs`, e una sfumatura accanto agli oggetti, come la
  scrive Illustrator, sono contenuto estraneo, e così gli oggetti che le
  usano.
- **Una risorsa è un'unità** coi suoi figli: tutta modificabile o tutta
  estranea, come un `text`.

## 2. Le risorse

| Elemento | Attributi | Figli |
|---|---|---|
| `linearGradient` | `x1 y1 x2 y2`, `gradientUnits`, `gradientTransform`, `spreadMethod` | `stop`, al più 256 |
| `radialGradient` | `cx cy r fx fy`, `gradientUnits`, `gradientTransform`, `spreadMethod` | `stop`, al più 256 |
| `stop` | `offset`, `stop-color`, `stop-opacity` | nessuno |
| `pattern` | `x y width height`, `patternUnits`, `patternContentUnits`, `patternTransform`, `viewBox`, `preserveAspectRatio` | il contenuto (§5) |
| `marker` | `refX refY markerWidth markerHeight`, `markerUnits`, `orient`, `viewBox`, `preserveAspectRatio` | il contenuto |
| `clipPath` | `clipPathUnits`, `transform`, `clip-rule` | forme e testi, senza `g` |
| `mask` | `x y width height`, `maskUnits`, `maskContentUnits` | il contenuto |
| `filter` | `x y width height`, `filterUnits`, `primitiveUnits`, `color-interpolation-filters` | le primitive (§4), al più 64 |
| `path` | `d` | nessuno |

- **Ogni risorsa ha un `id`** non vuoto; senza è estranea, e con lei chi la
  usa. Può avere `title`, `desc` e gli attributi `fub:*` e degli altri
  namespace, che si conservano come altrove.
- **Fuori dal formato:** `href` e `xlink:href`, cioè una sfumatura che ne
  eredita un'altra, `style`, `class`, `fr`, `mask-type`, un `url(` in un
  attributo della risorsa, ogni attributo o elemento SVG che la tabella non
  dice, e ogni primitiva fuori dall'elenco di §4, come `feImage` o
  `feTurbulence`, rendono estranea la risorsa. Un riferimento a un altro
  file non c'è mai.
- **Il tracciato** è il `path` che un [testo su
  tracciato](scene-format-text.md#5-il-testo-su-tracciato) segue: un `d`
  nella grammatica del formato, anche vuoto, e nessun altro attributo SVG o
  `xlink`; un `transform` o un `fill` lo rendono estraneo, e con lui il
  testo. Non si disegna da solo: dice soltanto dove scorre il testo.
- **Il campione** è un colore del documento con un nome: una
  `linearGradient` con `fub:role="swatch"` (§7) e il nome in `fub:name`, non
  vuoto; di SVG soltanto `id` e `gradientUnits`, e un solo `stop`, con uno
  `stop-color` che è un colore, non `none`, e senza `stop-opacity` o con 1.
  Può avere un `title` e gli attributi di altri namespace, come
  `inkscape:swatch`. Ogni lettore di SVG lo disegna come il suo colore.
  FubDraw lo scrive in `userSpaceOnUse`, così colora anche una linea
  orizzontale, il cui riquadro è alto zero e in `objectBoundingBox` non si
  dipingerebbe:

  ```xml
  <linearGradient id="r7k2m9q4x" fub:role="swatch" fub:name="Blu mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>
  ```

  Con `fub:role="swatch"` e un'altra forma è una risorsa senza ciclo di
  vita, come senza `fub:role`.

## 3. I valori

- **Le unità:** `gradientUnits`, `patternUnits`, `patternContentUnits`,
  `clipPathUnits`, `maskUnits`, `maskContentUnits` e `filterUnits` valgono
  `userSpaceOnUse` o `objectBoundingBox`; `markerUnits` `strokeWidth` o
  `userSpaceOnUse`; `primitiveUnits` soltanto `userSpaceOnUse`, che è anche
  il valore di partenza.
- **Le coordinate** (`x1 y1 x2 y2 cx cy r fx fy` delle sfumature,
  `x y width height` di motivi, maschere e filtri): in `objectBoundingBox`
  un numero o una percentuale, senza unità di misura; in `userSpaceOnUse`
  una lunghezza del formato della scena, §4, senza percentuali. `r`, `width`
  e `height` non sono negativi.
- **Le coordinate da scrivere:** in `userSpaceOnUse` va scritta ogni
  coordinata che, mancando, SVG prenderebbe in percentuale della finestra:
  `x2` della lineare; `cx`, `cy` e `r` della radiale; `x y width height` di
  maschera e filtro. Altrimenti la risorsa è estranea, perché la finestra di
  chi la disegna non è sempre quella del file. Una sfumatura con un solo
  `stop`, o nessuno, è un colore pieno, o niente: le sue coordinate non
  contano, e non ne va scritta nessuna.
- **`offset`:** un numero o una percentuale, che SVG porta fra 0 e 1; se
  manca vale 0. **`stop-color`** e **`flood-color`:** un colore del formato
  della scena, §4, non `none`. **`stop-opacity`** e **`flood-opacity`:**
  un'opacità.
- **`gradientTransform`**, **`patternTransform`** e il `transform` di
  `clipPath` seguono la grammatica di `transform`.
- **Le parole chiave:** `spreadMethod` `pad`, `reflect` o `repeat`;
  `color-interpolation-filters` `auto`, `sRGB` o `linearRGB`; `clip-rule`
  `nonzero` o `evenodd`.
- **`viewBox`:** quattro numeri separati da spazi o virgole, larghezza e
  altezza non negative. **`preserveAspectRatio`:** come su `image`.
- **Il marcatore:** `refX` e `refY` sono lunghezze, `markerWidth` e
  `markerHeight` lunghezze non negative; `orient` vale `auto`,
  `auto-start-reverse` o un angolo, un numero seguito facoltativamente da
  `deg`, `grad` o `rad`.

## 4. Le primitive dei filtri

Un elenco chiuso: le primitive di SVG 1.1 che i lettori comuni disegnano
tutti allo stesso modo, e l'ombra di Filter Effects, che i browser, resvg e
le esportazioni di Mermaid usano.

| Primitiva | Attributi suoi |
|---|---|
| `feGaussianBlur` | `in`, `stdDeviation`: uno o due numeri non negativi |
| `feOffset` | `in`, `dx`, `dy`: numeri |
| `feFlood` | `flood-color`, `flood-opacity` |
| `feDropShadow` | `in`, `dx`, `dy`, `stdDeviation`, `flood-color`, `flood-opacity`, come sopra |
| `feColorMatrix` | `in`, `type` (`matrix`, `saturate`, `hueRotate`, `luminanceToAlpha`), `values` |
| `feComposite` | `in`, `in2`, `operator` (`over`, `in`, `out`, `atop`, `xor`, `arithmetic`), `k1 k2 k3 k4`: numeri |
| `feBlend` | `in`, `in2`, `mode` (`normal`, `multiply`, `screen`, `darken`, `lighten`) |
| `feMorphology` | `in`, `operator` (`erode`, `dilate`), `radius`: uno o due numeri non negativi |
| `feMerge` | figli `feMergeNode`, ciascuno con `in` |

- **Ogni primitiva** può avere `id`, `result`, `color-interpolation-filters`
  e la sottoregione `x y width height`, in lunghezze; un `feMergeNode`
  soltanto `id` e `in`. Le 64 primitive di un filtro contano anche i
  `feMergeNode`.
- **`values` di `feColorMatrix`:** venti numeri per `matrix`, che è anche il
  tipo di partenza; uno, non negativo, per `saturate`; uno per `hueRotate`;
  nessuno per `luminanceToAlpha`.
- **Gli ingressi:** `result` è un nome senza spazi. `in` e `in2` valgono
  `SourceGraphic`, `SourceAlpha` o il `result` di una primitiva che viene
  prima nello stesso filtro; senza `in`, la primitiva prende il risultato
  della precedente, o `SourceGraphic` se è la prima. `feComposite` e
  `feBlend` vogliono `in2`. Ogni altro ingresso, come `BackgroundImage`,
  `FillPaint` o un nome che non c'è o che viene dopo, rende estraneo il
  filtro: i lettori non lo trattano tutti allo stesso modo.

## 5. Il contenuto

- **Di un motivo, un marcatore e una maschera:** le forme del formato della
  scena, §4 (`path`, `rect`, `ellipse`, `circle`, `line`, `polyline`,
  `polygon`), i `text` e i `g` che le contengono, fino a 32 livelli.
  **Di un ritaglio:** le forme e i testi, senza `g`, ciascuno anche con
  `clip-rule`. Niente `image`, `a`, livelli o carta.
- **Attributi e valori** sono quelli del formato della scena, §4, e l'`id`
  è facoltativo. Il contenuto non è fatto di oggetti: non si sceglie, non
  entra nell'albero degli oggetti e cambia soltanto con la sua risorsa.
- **I riferimenti nel contenuto** sono soltanto `fill` e `stroke` verso una
  sfumatura. Un motivo, un marcatore, un ritaglio, una maschera o un filtro
  nel contenuto rendono estranea la risorsa: così le risorse non si
  rimandano in cerchio, e la catena è lunga al più due.

## 6. I riferimenti

- **`fill` e `stroke`:** oltre a `none` e ai colori del formato della scena,
  §4, `url(#id)` seguito facoltativamente, dopo uno spazio, da un ripiego:
  `none` o un colore. L'id è di una sfumatura o di un motivo. Vale su forme,
  testi, immagini, gruppi, collegamenti e livelli, non sulle righe e sui
  pezzi di un testo, il cui riquadro i lettori non misurano tutti allo
  stesso modo. FubDraw scrive sempre il ripiego, un colore: lo disegna chi
  non sa disegnare la risorsa. Il ripiego di un campione è il suo colore.
- **`marker-start`, `marker-mid`, `marker-end`:** `none` o `url(#id)` di un
  `marker`, su `path`, `line`, `polyline` e `polygon`, dove i browser li
  disegnano. Su ogni altro elemento rendono estraneo l'elemento.
- **`href` e `xlink:href` di un `textPath`:** `#id` di un tracciato delle
  risorse, e uno solo dei due ([testo](scene-format-text.md), §5).
- **`clip-path`, `mask`, `filter`:** `none` o `url(#id)` di un `clipPath`, di
  una `mask` o di un `filter`, su forme, testi, immagini, gruppi,
  collegamenti e livelli. Le funzioni dei filtri di CSS, come `blur(4px)`,
  rendono estraneo l'elemento.
- **La forma di `url(`:** `url` in qualunque combinazione di maiuscole, `(`,
  spazi facoltativi, l'id dopo `#` fra virgolette doppie, singole o senza,
  spazi facoltativi, `)`. L'id non ha spazi, virgolette, parentesi né `\`:
  gli escape di CSS non si leggono.
- **Modificabile:** un riferimento lo è se l'id è di una risorsa
  modificabile del tipo giusto, in una `defs` della radice dello stesso
  documento. Altrimenti l'elemento resta estraneo, e ogni altro `url(`
  rende estraneo l'elemento come nel formato della scena, §4.
- **S014**, un avviso: un `url(#id)` in un attributo senza prefisso o
  `xlink`, o un `href="#id"` su un elemento SVG che non è un collegamento,
  rimanda a un id che il documento non ha. Uno per id e per attributo,
  sull'elemento che lo scrive, anche estraneo; si disegna senza la risorsa.
- **Il controllo di accessibilità** legge un campione come il suo colore,
  qualunque sia il ripiego. Non misura un testo o un tratto che usa un'altra
  risorsa, o che sta in un contenitore con un ritaglio, una maschera o un
  filtro: i colori che si vedono non si sanno, e S009 tace
  ([accessibilità](scene-format-accessibility.md)).

## 7. Il ciclo di vita

`fub:role` su una risorsa dice come vive:

- **`private`:** è di un oggetto, o di un'altra risorsa. Se ne va con il suo
  ultimo riferimento, e duplicare l'oggetto la copia con un id nuovo.
- **`shared`:** è di chi usa la stessa cosa, come un marcatore. Se ne va con
  il suo ultimo riferimento, e duplicare la condivide.
- **`swatch`:** un campione (§2), un colore del documento, o un motivo del
  documento (§8). Resta anche quando nessuno lo usa, e duplicare chi lo usa
  lo condivide. Un campione
  eliminato che qualcuno usa ancora, e che FubDraw non riscrive, diventa
  `shared` e perde il nome: se ne va col suo ultimo riferimento. Nell'SVG
  pulito dell'[export](scene-format-export.md) un campione usato resta una
  sfumatura di un colore, senza ruolo e senza nome, e uno che nessuno usa se
  ne va.
- **`style`:** uno [stile](scene-format-styles.md), un `text` o una
  `polyline` che gli oggetti seguono. Non si raccoglie mai, e le risorse
  private che usa sono sue.
- **Senza `fub:role`, o con un altro valore:** non è di FubDraw. Resta anche
  quando nessuno la usa, e duplicare la condivide.
- **La `fub-defs`** che resta senza figli se ne va con l'ultima risorsa: un
  oggetto che riceve una sfumatura e la perde lascia il file com'era. Una
  `defs` con un altro id resta.

## 8. La scrittura

- **Gli id:** una risorsa nuova ha `r` seguito da 8 caratteri base36
  casuali, come gli oggetti (formato della scena, §7). I punti, le
  primitive e il contenuto di una risorsa non ne hanno bisogno; se l'hanno,
  è nella stessa forma. La `defs` che FubDraw crea è `fub-defs`.
- **L'ordine degli attributi** è quello del formato della scena, §7: dopo
  la geometria, che comprende `offset`, `refX`, `refY`, `markerWidth`,
  `markerHeight`, `orient` e `viewBox`, vengono le unità e le trasformazioni
  delle risorse e gli attributi delle primitive, poi la presentazione, dove
  `marker-*`, `clip-path`, `clip-rule`, `mask` e `filter` seguono il
  contorno e `stop-*`, `flood-*` e `color-interpolation-filters` seguono
  `display`.
- **Le sfumature che FubDraw scrive** stanno nelle coordinate dell'oggetto
  che le usa, in `userSpaceOnUse`, così che una trasformazione dell'oggetto
  le porti con sé: i capi di una lineare, il centro, il raggio e il fuoco di
  una radiale come stanno, con una `gradientTransform` soltanto per
  un'ellisse o uno scorrimento. Il ripiego di chi le usa è la media dei
  loro colori lungo la sfumatura, pesata sull'opacità.
- **Una risorsa riscritta** da un `set` si scrive intera in forma canonica,
  figli compresi, e resta al suo posto.

### Le punte delle linee

Una punta che FubDraw scrive è un `marker` condiviso, `fub:role="shared"`,
con `fub:marker`: la forma (`triangle`, `vee`, `circle`, `square`,
`diamond`, `bar`), la misura (`small`, `medium`, `large`) e il capo
(`start`, `end`), separati da uno spazio. Il colore non c'è: sta nel
contenuto ([Disegni, punte delle linee](../product/drawing-tips.md)).

- **La geometria:** niente `viewBox` e niente `markerUnits`, che resta
  `strokeWidth`: la punta cresce con lo spessore della linea. `orient` è
  `auto`, e l'estremo della linea sta nel punto di riferimento. La misura è
  di 3,5, 5 o 7 spessori: la larghezza del triangolo, della punta aperta e
  della barra e la lunghezza del rombo; il cerchio ne è largo 0,8, il
  quadrato 0,7 e il rombo 0,6. La punta d'inizio è il capovolto di quella
  di fine, un marcatore a sé, perché `auto-start-reverse` di SVG 2 non lo
  leggono tutti. Il contenuto sta mezzo spessore dentro la finestra, che lo
  ritaglia.
- **Il verso** è quello di SVG 2, che FubDraw usa per toccare le punte e
  per «Contorno in tracciato»: dopo un tratto lungo zero a un capo, quello
  del tratto vicino. Chromium e WebKit girano invece quella punta verso
  destra.
- **Il colore** del contenuto è quello del contorno della linea che la usa,
  con la sua opacità in `fill-opacity` o `stroke-opacity`, al più quattro
  decimali: un `#rrggbb`, un campione come `url(#id) #rrggbb`, il colore
  che una sfumatura ha nel vertice, con l'opacità dei suoi punti per quella
  del contorno, il ripiego di un motivo, o `none`. Le
  linee con la stessa punta dello stesso colore usano lo stesso marcatore.
- **Riconoscerla:** è una punta della raccolta soltanto un marcatore
  modificabile identico, attributi e contenuto, a quello che FubDraw
  scriverebbe per il suo `fub:marker` col colore e l'opacità del suo
  contenuto. Ogni altro marcatore, anche con un `fub:marker`, si legge, si
  disegna e resta com'è.
- **Il seguito:** un'operazione che cambia il contorno di una linea con una
  punta della raccolta, quello del gruppo che glielo passa, un campione o
  una sfumatura porta con sé, nello stesso passo, i `set` di `marker-start`
  e `marker-end` verso il marcatore del colore nuovo, e prima gli `add` di
  quelli che mancano (§9).

### I ritagli e le maschere

Un ritaglio d'immagine che FubDraw scrive è un `clipPath` privato con un
`rect` solo, in `userSpaceOnUse` e senza `transform`, nelle coordinate
dell'immagine: quelle di `x y width height`, dopo il suo `transform`
([Disegni, ritagli e maschere](../product/drawing-masks.md)).

- **Il rettangolo** sta dentro il riquadro dell'immagine, a due decimali
  come la geometria, e dopo l'arrotondamento si riporta dentro: il file non
  mostra mai un margine vuoto fuori dall'immagine. Spostare l'immagine sotto
  il ritaglio cambia soltanto `x` e `y`. Un ritaglio senza margini non c'è:
  `clip-path` si toglie, e con lui il `clipPath` privato.
- **Riconoscerlo:** è un ritaglio d'immagine un `clipPath` che ha tutte
  queste condizioni, e basta una a mancare perché non lo sia:
  - nessun `transform` sul `clipPath`, e `clipPathUnits` assente o
    `userSpaceOnUse`;
  - un solo figlio che disegna, un `rect` (un titolo e una descrizione non
    contano), senza `rx`, `ry`, `transform` e `display`;
  - `x` e `y` che si leggono, o assenti e allora 0, e `width` e `height`
    scritti, che si leggono e sono positivi;
  - un rettangolo che tocca il riquadro dell'immagine con un'area: quello
    che si legge è la parte comune.

  Un ritaglio così si cambia come un ritaglio: sul posto se è privato e
  soltanto dell'immagine; altrimenti l'immagine ne riceve uno suo, e l'altro
  resta com'è. Ogni altro ritaglio di un'immagine si toglie soltanto.
- **Le maschere:** una maschera di ritaglio è un `clipPath` privato con la
  forma che ritaglia; una maschera d'opacità è una `mask` privata con la
  forma o il gruppo che la fa, in `maskUnits="userSpaceOnUse"`. Le usa il
  gruppo nuovo che contiene gli oggetti mascherati, con `clip-path` o
  `mask`, e il contenuto sta nelle sue coordinate, con la trasformazione che
  lo lascia dov'era.
- **La regione** di una `mask` è per eccesso: `maskUnits="userSpaceOnUse"`
  ritaglia, e fuori da dove il contenuto disegna la luminanza è nulla,
  dunque una regione più larga non costa niente e una più stretta taglierebbe
  il contenuto. Contiene il riquadro di ogni forma, con la sua trasformazione
  e quelle dei gruppi, allargato del contorno: metà spessore, per il limite
  delle punte di una giunzione a spigolo (`stroke-miterlimit`, 4 se non è
  scritto; per un rettangolo, che ha angoli retti, √2) o per √2 se i capi sono
  squadrati. Un testo vale un corpo di larghezza per carattere, più la
  spaziatura, un corpo sopra la linea di base e 0,35 sotto, a partire
  dall'ancora; il contorno si somma. La regione si arrotonda in fuori ai
  centesimi.
- **Il contenuto** non ha id, e scrive lo stile che ereditava, perché una
  risorsa non eredita niente da chi la usa. In un `clipPath` scrive anche
  `fill="#000000"` quando non aveva riempimento; i motivi diventano il loro
  ripiego e i marcatori se ne vanno. In una `mask` non entrano motivi,
  marcatori, ritagli, maschere e filtri.
- **I contenitori da cui la forma esce:** l'opacità di quelli fra la forma
  e il gruppo nuovo passa al contenuto di una `mask`, moltiplicata, come
  `opacity` della radice del contenuto a quattro decimali: la forma si vede
  con la stessa forza. Un ritaglio guarda solo la geometria e non la porta.
  Se uno di quei contenitori ha un ritaglio, una maschera o un filtro la
  maschera non si crea, perché la forma fuori da lì si vedrebbe diversa. Gli
  altri oggetti entrano nel gruppo come con «Raggruppa»: si compensa la
  trasformazione, e un contenitore che resta vuoto resta.
- **Con un foglio di stile o un `style`** il contenuto si confronta con la
  forma, con la cascata di CSS: ciò che una regola dava alla forma e dentro
  la risorsa non arriverebbe, come il riempimento, il contorno o l'opacità,
  si scrive sul contenuto come attributo. Se una regola vale anche dentro la
  risorsa e cambierebbe il contenuto, o se la trasformazione la dà una
  regola, la maschera non si crea. Il comando passa poi dal controllo che
  tutto si veda com'era, come ogni comando che sposta elementi: gli
  attributi `clip-path` e `mask` che scrive da sé sul gruppo nuovo, o che
  toglie al gruppo che si scioglie, non contano come un effetto del foglio,
  salvo che una regola dia proprio quella proprietà al gruppo, e allora
  l'attributo non vincerebbe e il comando non si fa.
- **Rilasciare** fa di ogni pezzo del contenuto un oggetto con id nuovi,
  subito sopra chi lo usava, con la trasformazione di chi lo usava,
  quella della risorsa e quella delle sue unità. Un pezzo di ritaglio senza
  riempimento riceve `fill="none"`, e `clip-rule` se ne va. Il pezzo si vede
  com'era dentro la risorsa: se i contenitori di chi lo usava gli darebbero
  per eredità un altro stile, o una regola del foglio un'altra proprietà, si
  scrive quello che aveva; se non si sa (la famiglia dei caratteri, o una
  regola che un attributo non batte) il rilascio non si fa.
- **Il riquadro** di una risorsa in `objectBoundingBox` è quello di chi la
  usava, e vale soltanto se è esatto: lo è per le forme, le immagini e i
  gruppi che le contengono, con le trasformazioni dei figli, senza il titolo,
  la descrizione e ciò che è nascosto. Per un testo, che ha un ingombro che
  si può solo stimare, o per parti di un altro programma, il rilascio non si
  fa: i pezzi finirebbero fuori posto. Il rilascio è tutto o niente.

### Le campiture e i motivi

Una campitura che FubDraw scrive è un `pattern` privato con `fub:pattern`,
sei parole separate da spazi: il genere (`lines`, `cross`, `dots`), l'angolo
in gradi in senso orario, fra -180 escluso e 180, il passo, lo spessore (il
diametro, per i puntini), il colore e il fondo, che può mancare. I numeri
hanno al più due decimali; il passo sta fra 0,5 e 1000, lo spessore fra 0,1
e il passo; i colori sono `#rrggbb` minuscoli ([Disegni, campiture e
motivi](../product/drawing-patterns.md)).

```xml
<pattern id="r3h8k2m5q" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #000000 #56b4e9">
  <rect width="8" height="8" fill="#56b4e9"/>
  <rect y="3.25" width="8" height="1.5" fill="#000000"/>
</pattern>
```

- **Il contenuto discende da `fub:pattern`:** una mattonella quadrata di
  lato il passo, in `userSpaceOnUse`, con `patternTransform="rotate(a)"` se
  l'angolo non è zero; il fondo, un `rect` che la copre; per `lines` un
  `rect` alto lo spessore a metà altezza, per `cross` anche quello
  verticale, per `dots` un `circle` nel centro. I numeri del contenuto hanno
  al più quattro decimali. Come le sfumature, la campitura sta nelle
  coordinate dell'oggetto e si sposta, gira e scala con lui.
- **Il ripiego** di chi la usa è il colore delle righe mescolato in sRGB al
  fondo secondo la parte che le righe coprono: lo spessore sul passo per
  `lines`, due volte meno l'incrocio per `cross`, il cerchio sul quadrato
  per `dots`. Senza fondo è il colore delle righe.
- **Riconoscerla:** è una campitura soltanto un `pattern` privato o
  condiviso identico, attributi e contenuto, a quello che FubDraw
  scriverebbe per il suo `fub:pattern`. Ogni altro `pattern`, anche con un
  `fub:pattern`, è un motivo che si legge, si disegna e resta com'è.
- **Cambiarla:** con un `set` sul posto, se è privata, la usa soltanto il
  riempimento scritto di un oggetto, e il genere e il fondo, o la sua
  assenza, restano; altrimenti l'oggetto ne riceve una nuova, subito dopo,
  e la raccolta toglie quella che nessuno usa più (§9).
- **Un motivo del documento** è un `pattern` con `fub:role="swatch"` e il
  nome in `fub:name`, non vuoto: come un campione resta anche quando nessuno
  lo usa, e il suo nome è diverso da quelli dei campioni e degli altri
  motivi. «Motivo dalla selezione» lo scrive in `userSpaceOnUse`, con
  `x y width height` il riquadro di ciò che gli oggetti disegnano,
  arrotondato in fuori ai centesimi, e una copia di ciascuno, in ordine di
  documento, con la trasformazione che la tiene dov'era: un oggetto
  riempito col motivo mostra gli originali al loro posto, ripetuti. Il
  contenuto è quello di una maschera d'opacità, senza id, titoli e
  descrizioni, con lo stile ereditato e l'opacità dei contenitori; le
  sfumature private entrano in copia, mentre un oggetto con un motivo o una
  campitura non entra, perché il contenuto usa soltanto sfumature (§5).
- **Il ripiego di un motivo** è il colore medio del contenuto: i riempimenti
  pesati sull'area del loro riquadro e sull'opacità; senza, i contorni,
  pesati sulla diagonale; altrimenti il nero. Eliminarlo riporta chi lo usa
  al ripiego che scrive, o a quel colore, e lo toglie; se lo usa ancora
  qualcosa che FubDraw non riscrive diventa `shared` e perde il nome, come
  un campione (§7).

## 9. Le operazioni

Le regole che tengono veri i riferimenti
([operazioni sulla scena](scene-operations.md)). Una risorsa e chi la usa
non cambiano mai natura per un'operazione su un altro elemento.

- **`add`** mette una risorsa in una `defs` modificabile della radice, con
  `elem` o `raw`. Una `defs` nuova è la `fub-defs`, e va sotto la radice, di
  solito con `first`, che per lei vuol dire subito dopo `title` e `desc`;
  ogni altro id è `invalid-elem`. Un elemento che
  rimanda a una risorsa che non c'è, o che non è del tipo giusto, è
  `invalid-elem`, come ogni elemento che scritto sarebbe estraneo: in un
  `batch` la risorsa viene prima di chi la usa. Una risorsa il cui id ha già
  dei riferimenti, anche da contenuto estraneo, è `duplicate-id`.
- **`remove`** di una risorsa, o di una `defs`, a cui rimanda qualcosa fuori
  da ciò che si toglie, che siano oggetti, altre risorse o contenuto
  estraneo, è `in-use`. Le risorse estranee si tolgono come ogni blocco
  estraneo.
- **`set`** su una risorsa la riscrive (§8) e deve lasciarla modificabile;
  non ne cambia il tag; un `set` del `d` di un tracciato sposta i testi che
  lo seguono. **`move`** sposta una risorsa soltanto fra le `defs`
  modificabili della radice: altrove cambierebbe ruolo, ed è `invalid-elem`.
  **`ident`** non toglie l'id a una risorsa usata, `in-use`; a una che non
  lo è sì, e la risorsa diventa estranea.
- **La raccolta:** alla fine di ogni operazione applicata, che venga
  dall'utente, dall'annulla o dalla rete, ogni risorsa `private` o `shared`
  a cui l'operazione ha tolto l'ultimo riferimento se ne va, poi quelle
  rimaste sole per questo, e infine la `fub-defs` vuota. Una risorsa che era
  già senza riferimenti resta: la raccolta tocca soltanto ciò che
  l'operazione ha lasciato solo. Un riferimento conta da qualunque elemento,
  anche estraneo, e da un foglio di stile. I campioni e gli stili non si
  raccolgono.
- **La raccolta fa parte dell'operazione,** come il seguito delle punte
  (§8): quella in avanti che il motore restituisce, e che la sessione
  rimanda, è un `batch` con l'operazione, il seguito e poi i `remove`, con
  l'etichetta dell'operazione; l'inversa rimette prima le risorse, poi
  disfa il seguito e l'operazione. Un seguito che il motore rifiuterebbe
  non c'è.
- **Il limite:** un documento ha al più 10 000 risorse modificabili. Un
  `add` che lo supererebbe è `limit`; un documento che ne ha di più si apre
  e si modifica, e un annulla rimette anche oltre il limite.

## 10. Il disegno

Nella superficie di modifica le risorse modificabili vivono in una `defs`
viva, rifatta elemento per elemento coi soli elementi e attributi del
formato: ciò che il formato non conosce non entra. Gli id prendono un
prefisso proprio di ogni superficie, e di ogni miniatura dell'albero, perché
due disegni aperti insieme non si scambino le risorse; i riferimenti degli
oggetti vivi sono riscritti allo stesso modo, e `fill` e `stroke` tengono il
colore di ripiego. Una risorsa che non cambia resta com'è, una che cambia si
rifà. Le risorse estranee restano negli strati immagine (formato della
scena, §8), che portano con sé le risorse che usano, anche quelle chiamate
da un'altra risorsa. In Lettura e nell'export il file è quello che è, senza
riscritture.

## 11. Lettori più vecchi e ciò che manca

- **Un lettore che non conosce le risorse** vede estranee la `defs` e gli
  oggetti che la usano, li disegna come strati immagine e li conserva byte
  per byte: per questo la versione resta 1.
- **Un lettore che conosce le risorse ma non i tracciati** vede estranei il
  `path` nella `defs` e il testo che lo segue, e li conserva byte per byte.
- **Un lettore che non conosce i campioni** vede estraneo un campione in
  `userSpaceOnUse` senza `x2`, come FubDraw lo scrive, e con lui chi lo usa,
  e li conserva byte per byte; un campione senza `gradientUnits` lo legge
  come una risorsa senza ciclo di vita.
- **Un lettore che non conosce i motivi del documento** legge un motivo
  come una risorsa senza ciclo di vita: resta, e duplicare chi lo usa lo
  condivide. Una campitura è un `pattern` privato come gli altri.
- **`symbol` e `use`** restano estranei. Entreranno nel formato
  con gli strumenti che li creano e li spostano: così la superficie non
  incontra un oggetto modificabile che non sa misurare.
