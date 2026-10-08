# Formato della scena, effetti e fusione

> **Ambito:** gli effetti degli oggetti di un disegno, le ombre, i bagliori
> e la sfocatura, e i modi di fusione: come li dice l'oggetto, il filtro che
> ne discende, la sua regione, quando un filtro è di FubDraw, e come escono
> nell'export. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/tools/effects.ts`
> per la grammatica, le primitive, la regione e il riconoscimento; lo
> `style` in `scene/values.ts` e `crates/fub-scene/src/values.rs`, letto da
> `scene/classify.ts` e `crates/fub-scene/src/classify.rs`; il disegno della
> fusione in `painter/svg-dom.ts`; la risoluzione del PDF in
> `crates/fub-features/src/draw.rs`.

Una parte del [formato della scena](scene-format.md), §4, e delle sue
[risorse](scene-format-resources.md): il filtro di un effetto è una
risorsa privata, come una sfumatura. Che cosa ne fa l'editor sta in
[Disegni, effetti e fusione](../product/drawing-effects.md). Le sezioni del
formato si citano come «formato della scena, §N»; quelle di questa pagina
col solo numero.

```xml
<defs id="fub-defs">
  <filter id="r8k2m4p1q" fub:role="private" x="-4" y="0" width="88" height="68"
    filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" result="b1" stdDeviation="4"/>
    <feOffset dx="0" dy="4" in="b1" result="o1"/>
    <feFlood flood-color="#000000" flood-opacity="0.25"/>
    <feComposite in2="o1" result="e1" operator="in"/>
    <feMerge>
      <feMergeNode in="e1"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>
<rect id="o1" x="10" y="10" width="60" height="40" fill="#ffffff"
  filter="url(#r8k2m4p1q)" fub:effect="shadow 0 4 8 #000000 0.25"/>
```

## 1. Gli effetti dell'oggetto

`fub:effect` dice gli effetti di un oggetto, nell'ordine in cui la lista li
mostra, separati da `;` e da spazi facoltativi:

| Effetto | Si scrive | Che cosa dicono i numeri |
|---|---|---|
| Ombra esterna | `shadow dx dy sfocatura #rrggbb opacità` | lo scostamento, la sfocatura, il colore e la sua opacità |
| Ombra interna | `inner-shadow dx dy sfocatura #rrggbb opacità` | come l'ombra esterna, dentro la forma |
| Bagliore esterno | `glow dimensione #rrggbb opacità` | quanto si allarga attorno alla forma |
| Bagliore interno | `inner-glow dimensione #rrggbb opacità` | quanto entra dal bordo |
| Sfocatura | `blur raggio` | quanto si sfoca l'oggetto, effetti compresi |

- **Un effetto nascosto** finisce con la parola `hidden`: resta nella lista,
  coi suoi valori, e non si disegna.
- **I numeri** sono numeri SVG con al più due decimali, nelle coordinate
  dell'oggetto: lo scostamento fra -2000 e 2000, la sfocatura, la dimensione
  e il raggio fra 0 e 500. L'opacità sta fra 0 e 1, con al più quattro
  decimali; il colore è `#` e sei cifre esadecimali minuscole.
- **Le misure sono quelle di CSS e di Figma.** La sfocatura di un'ombra, la
  dimensione di un bagliore e il raggio della sfocatura valgono il doppio
  della deviazione standard della gaussiana: `shadow 0 4 8 #000000 0.25` è
  il `box-shadow: 0 4px 8px` di CSS, con `stdDeviation="4"`.
- **Al più otto effetti** per oggetto, e una sola sfocatura: con otto ombre
  interne il filtro resta nelle 64 primitive del formato (§2 delle
  [risorse](scene-format-resources.md)).
- **Un valore che non si legge** per una sola di queste regole, o vuoto,
  non dice effetti: l'oggetto ha soltanto il suo `filter`, se ne ha uno, che
  si vede e si conserva come quello di un altro programma (§4).

## 2. Il filtro

Il filtro discende da `fub:effect`, come il `d` di una forma da `fub:geom`:
chi cambia gli effetti riscrive il filtro, e un filtro cambiato a mano non è
più di FubDraw (§4). È un `filter` privato (`fub:role="private"`), suo
soltanto, in `filterUnits="userSpaceOnUse"` e in
`color-interpolation-filters="sRGB"`, i colori in cui disegnano le ombre di
CSS, di Figma e di Illustrator. Con gli effetti tutti nascosti il filtro non
c'è, e `filter` neppure: l'oggetto non costa niente a chi lo disegna.

Le primitive sono soltanto di SVG 1.1, e il loro ordine è fisso. Per
l'`n`-esimo effetto visibile, che non sia la sfocatura:

1. un effetto interno parte dall'alfa capovolto, `feColorMatrix` su
   `SourceAlpha` con `values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1"` e
   `result="a<n>"`; uno esterno parte da `SourceAlpha`;
2. `feGaussianBlur` con la metà della sfocatura, a tre decimali, e
   `result="b<n>"`, se la sfocatura non è zero;
3. `feOffset` con `dx` e `dy`, e `result="o<n>"`, se lo scostamento non è
   zero;
4. `feFlood` col colore e l'opacità;
5. `feComposite operator="in"` col risultato di prima, e `result="e<n>"`;
   un effetto interno ne ha un secondo con `in2="SourceAlpha"`, che lo
   tiene dentro la forma, e il `result` va su quello.

Una sfocatura di zero e uno scostamento di zero non si scrivono:
`stdDeviation="0"` non vale allo stesso modo per tutti i lettori. Poi un
`feMerge` mette sotto gli effetti esterni, nell'ordine della lista, sopra
`SourceGraphic` e sopra ancora gli effetti interni; la sfocatura, se c'è e
non è zero, è un `feGaussianBlur` sull'unione. Un oggetto con la sola
sfocatura ha un `feGaussianBlur` su `SourceGraphic`, e con una sfocatura di
zero un `feOffset` su `SourceGraphic`, che lo lascia com'è.

## 3. La regione

La regione `x y width height` è il riquadro di ciò che l'oggetto disegna
nelle sue coordinate, prima del suo `transform`, allargato di quanto arrivano
gli effetti e di 2 unità, e portato ai centesimi per eccesso: la regione
scritta contiene sempre quella calcolata.

- **Ciò che l'oggetto disegna:** la geometria; il contorno, con due volte lo
  spessore per gli angoli netti fino al limite di 4 di SVG, o lo spessore per
  √½ con gli angoli tondi o smussati; le punte, per la diagonale del loro
  riquadro; un testo misurato coi suoi caratteri, con mezzo corpo ai lati,
  un corpo e un quarto sopra la linea di base e mezzo sotto, e un testo su
  tracciato col riquadro del tracciato e un corpo e mezzo attorno. Un gruppo
  è l'unione dei figli, coi loro effetti e i loro filtri.
- **Quanto arrivano gli effetti:** un'ombra esterna arriva a tre deviazioni
  standard, una volta e mezza la sfocatura, più lo scostamento dal suo lato;
  un bagliore esterno a una volta e mezza la dimensione; la sfocatura
  dell'oggetto aggiunge una volta e mezza il suo raggio su ogni lato. Un
  effetto interno non dipinge fuori, ma legge fuori: il suo alfa capovolto
  vale uno fino al bordo della regione, che dunque sta oltre lo scostamento
  più una volta e mezza la sfocatura.
- **La regione segue l'oggetto.** Dopo ogni operazione le regioni che non
  sono più quelle che si scriverebbero si riscrivono nello stesso passo e
  nello stesso annulla: cambiare la geometria, il contorno, il testo o il
  carattere di un oggetto, o di ciò che contiene, cambia la sua regione;
  spostarlo o girarlo cambia soltanto il suo `transform`. Il file resta lo
  stesso, comunque ci si arrivi.

## 4. Quando un filtro è di FubDraw

Gli effetti di un oggetto sono di FubDraw se:

- `fub:effect` si legge (§1) e ha almeno un effetto visibile;
- `filter` rimanda a un `filter` privato, usato soltanto da questo oggetto;
- quel `filter` ha `x y width height` scritti ed è, primitiva per
  primitiva e attributo per attributo, quello che il §2 scrive per
  `fub:effect`, con quella regione.

Un `fub:effect` coi soli effetti nascosti e senza `filter` è di FubDraw
anche lui; uno con effetti visibili e senza `filter` non dice niente, e
l'oggetto non ha effetti. Ogni altro `filter` è di un altro programma: si vede, si
conserva, si toglie, e un effetto nuovo lo sostituisce, come una punta della
raccolta un marcatore estraneo.

Chi può avere effetti: forme, testi, immagini, gruppi e collegamenti. Non i
livelli, la carta e le tavole; non un oggetto con un `clip-path` o una
`mask` suoi, perché SVG ritaglia dopo il filtro e l'ombra sparirebbe; non un
gruppo con parti di un altro programma, di cui non si sa la misura.

## 5. La fusione

Un oggetto si fonde con ciò che sta sotto col modo di `mix-blend-mode`, e un
gruppo o un collegamento possono isolare la fusione di ciò che contengono
con `isolation`. Tutt'e due stanno in `style`, perché i browser non leggono
gli attributi di presentazione con lo stesso nome:

```xml
<g id="g1" style="isolation: isolate">
  <rect id="o2" x="0" y="0" width="40" height="40" fill="#56b4e9"/>
  <circle id="o3" cx="36" cy="36" r="20" fill="#e69f00" style="mix-blend-mode: multiply"/>
</g>
```

- **`style` è del formato** soltanto con queste dichiarazioni: un
  `mix-blend-mode` con uno dei sedici modi di Compositing and Blending
  (`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`,
  `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`,
  `exclusion`, `hue`, `saturation`, `color`, `luminosity`) e, su un gruppo, un
  collegamento o un livello, un `isolation` con `isolate` o `auto`; ognuna
  al più una volta, con un `;` facoltativo in fondo, in minuscolo. Ogni
  altro `style` lascia estraneo l'elemento (formato della scena, §8).
- **FubDraw scrive** `mix-blend-mode: multiply`, `isolation: isolate`, o le
  due in quest'ordine, separate da `; `. Il modo `normal` e `isolation`
  spento non si scrivono, e uno `style` vuoto se ne va.
- **Il disegno è isolato:** ciò che si fonde si fonde con ciò che sta sotto
  di sé nel disegno, carta compresa, attraverso i livelli, come in un SVG
  solo; mai con ciò che sta attorno al disegno, l'editor o la pagina che lo
  mostra.

## 6. Il disegno e l'export

- **Il foglio, la Lettura e l'export in PNG e JPEG** disegnano effetti e
  fusioni allo stesso modo; la scena «effetti» del banco di fedeltà lo prova
  al pixel, con una soglia di colore sua, più stretta, per le sfocature: il
  banco diventa rosso senza i filtri, senza le fusioni, e con le sfocature
  di un decimo più corte.
- **Nell'SVG pulito** il filtro resta, e `fub:effect` se ne va con gli altri
  attributi `fub:*`: un altro programma vede un filtro di SVG 1.1.
- **Nel PDF** la fusione è vettoriale. Gli effetti non hanno un equivalente
  nel PDF: ogni gruppo con un filtro si dipinge in un'immagine, a 300 punti
  per pollice sulla pagina, anche dentro un gruppo ingrandito. Una scala
  vale per tutta la pagina: se a 300 punti l'effetto più grande passasse i
  4096 × 4096 pixel, la pagina li dipinge tutti a una risoluzione più bassa,
  e l'export si fa. Le annotazioni di un PDF, che sono in punti, hanno la
  stessa regola.
- **L'export della selezione e «Adatta la pagina al disegno»** contengono
  ciò che gli effetti dipingono fuori dalla geometria; la selezione, la
  cornice e l'aggancio restano sulla geometria.

## 7. Lettori più vecchi

`fub:effect` è un attributo `fub:*` su un oggetto, che un lettore della
versione 1 conserva senza leggerlo; il filtro è una risorsa privata, che un
lettore che conosce le risorse conserva e disegna. Lo `style` con la sola
fusione è nuovo: un lettore che non lo conosce lascia estraneo l'elemento, e
lo disegna com'è. La versione resta 1.
