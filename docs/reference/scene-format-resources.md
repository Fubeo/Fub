# Formato della scena, risorse

> **Ambito:** le risorse di un disegno: sfumature, campioni, motivi,
> marcatori, ritagli, maschere, filtri e i tracciati che i testi seguono;
> dove stanno, come si leggono e si scrivono, come gli oggetti le usano e
> come le operazioni tengono veri i riferimenti. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo; i
> valori in `scene/values.ts` e `crates/fub-scene/src/values.rs`; la
> scrittura in `scene/serialize.ts`, le operazioni in `scene/engine.ts`, con
> i vettori di prova da 50 a 59, 63, 64, 76 e 77 ([operazioni sulla
> scena](scene-operations.md), §9), e il disegno in `painter/paint.ts`.

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
- **`swatch`:** un campione (§2), un colore del documento. Resta anche
  quando nessuno lo usa, e duplicare chi lo usa lo condivide. Un campione
  eliminato che qualcuno usa ancora, e che FubDraw non riscrive, diventa
  `shared` e perde il nome: se ne va col suo ultimo riferimento. Nell'SVG
  pulito dell'[export](scene-format-export.md) un campione usato resta una
  sfumatura di un colore, senza ruolo e senza nome, e uno che nessuno usa se
  ne va.
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
  anche estraneo, e da un foglio di stile. I campioni non si raccolgono.
- **La raccolta fa parte dell'operazione:** quella in avanti che il motore
  restituisce, e che la sessione rimanda, è un `batch` con l'operazione e
  poi i `remove`, con l'etichetta dell'operazione; l'inversa rimette prima
  le risorse e poi annulla l'operazione.
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
- **`symbol` e `use`** restano estranei. Entreranno nel formato
  con gli strumenti che li creano e li spostano: così la superficie non
  incontra un oggetto modificabile che non sa misurare.
