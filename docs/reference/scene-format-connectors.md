# Formato della scena, connettori

> **Ambito:** il connettore, la linea che unisce due oggetti e li segue:
> grammatica di `fub:geom` e del `d` che ne viene, gli agganci `fub:from` e
> `fub:to` e il loro significato, il percorso che FubDraw calcola, come la
> linea segue gli oggetti, l'etichetta con `fub:along`, lettura e scrittura.
> Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/connectors.ts`,
> `crates/fub-scene/src/connectors.rs` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-connectors/cases.json`, che valgono per
> tutte e due le letture; il percorso lo calcola soltanto la superficie, in
> `apps/client/src/editors/spatial/tools/connectors.ts`, come il `d` della
> freccia; i vettori di prova 78 e 79 ([operazioni sulla
> scena](scene-operations.md), §9); il modo di dire un connettore a parole in
> `apps/client/src/editors/spatial/describe.ts`.

Una forma sintetica del [formato della scena](scene-format.md), §6: un `path`
con `fub:shape="connector"` e `fub:geom`, il suo `d` calcolato dalla
geometria, e due agganci che dicono a quali oggetti la linea è attaccata. Un
altro programma vede un tracciato qualunque e lo disegna uguale; FubDraw legge
gli agganci, e quando un oggetto agganciato cambia riscrive la geometria e il
`d` del connettore. Come si disegna è in [Disegni,
connettori](../product/drawing-connectors.md). Le sezioni del formato si
citano come «formato della scena, §N»; quelle di questa pagina col solo
numero.

```xml
<rect id="o2b3c4d5e" x="100" y="100" width="200" height="120" fill="#e69f00"/>
<rect id="o3c4d5e6f" x="500" y="400" width="200" height="120" fill="#009e73"/>
<path id="o7k2m9x4q" fub:shape="connector" fub:geom="elbow 200 220 200 310 600 310 600 400" fub:from="o2b3c4d5e auto" fub:to="o3c4d5e6f auto" d="M200 220 L200 310 L600 310 L600 400" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<text id="o8m3n4p5r" fub:along="o7k2m9x4q 0.5 4" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 400 302)"><tspan x="0" dy="0">sì</tspan></text>
```

Due rettangoli uniti da un connettore a gomito, agganciato a tutti e due con
`auto`: FubDraw sceglie i lati che si guardano, e la linea esce da sotto il
primo, scende, corre in orizzontale ed entra da sopra il secondo. Il testo
«sì» è la sua etichetta: sta a metà della linea, appena sopra il tratto
orizzontale.

## 1. La geometria

`fub:geom` è il tipo della linea e i punti del suo percorso.

- **Il tipo** è la prima parola: `straight`, `elbow` o `curved`, scritta
  esatta e minuscola. Dai numeri la separano spazi di SVG; gli spazi
  all'inizio sono ammessi, una virgola dopo il tipo no.
- **I punti** sono una lista di numeri SVG, come in `points`, separati da
  spazi o virgole: coppie `x y` nelle coordinate del connettore, cioè prima
  del suo `transform`. Tutti i numeri devono essere finiti.
- **Dritto:** `straight`, esattamente 2 punti, cioè 4 numeri: l'inizio e la
  fine.
- **Curvo:** `curved`, esattamente 4 punti, cioè 8 numeri: l'inizio, il primo
  punto di controllo, il secondo e la fine di una curva di Bézier cubica.
- **A gomito:** `elbow`, da 2 a 64 vertici, cioè da 4 a 128 numeri, dal primo
  all'ultimo. I tratti vanno da un vertice al successivo; FubDraw li fa
  orizzontali e verticali (§4).

## 2. Il `d`

- **La geometria scritta è quella che si vede:** `fub:geom` porta i punti del
  percorso già calcolato, non gli agganci da cui viene. Chi non sa niente
  degli agganci rigenera `d` da lì, e un altro programma vede la linea in `d`.
- **Dritto e a gomito:** `M x0 y0 L x1 y1 …`, un `L` per ogni punto dopo il
  primo. **Curvo:** `M x0 y0 C x1 y1 x2 y2 x3 y3`.
- **I numeri:** FubDraw scrive quelli di `fub:geom` con due decimali, e
  calcola `d` dalla geometria così come la rilegge da quel testo. Chi rigenera
  `d` da `fub:geom` ottiene quindi lo stesso testo, in forma canonica
  (formato della scena, §7, punti 3 e 4).
- **Gli altri attributi** sono quelli di ogni linea: nell'esempio `fill="none"`
  e un contorno nero largo 2, con estremi e angoli tondi.

Il dritto che va da `0 0` a `100.126 50.5` si scrive coi due decimali, e il
curvo di quattro punti ha il suo `C`:

```text
fub:geom="straight 0 0 100.13 50.5"
d="M0 0 L100.13 50.5"

fub:geom="curved 0 0 40 0 60 100 100 100"
d="M0 0 C40 0 60 100 100 100"
```

## 3. Gli agganci

`fub:from` è il capo da cui parte la linea e `fub:to` quello a cui arriva: il
verso in cui l'ha tirata chi l'ha disegnata. Ciascuno è fatto di due parole
separate da spazi di SVG: l'id dell'oggetto e il punto d'aggancio, uno fra
`auto`, `center`, `top`, `right`, `bottom` e `left`, scritto esatto e
minuscolo.

- **Un capo libero** è quello senza l'attributo: la linea finisce dove dice la
  geometria.
- **Fuori grammatica,** con parole in più o in meno o un aggancio che non è
  uno dei sei, il capo vale libero e l'attributo resta com'è.
- **Un id che il documento non ha** vale libero, e così quello di un oggetto
  a cui non ci si aggancia.
- **A che cosa ci si aggancia:** forme, testi, immagini, gruppi e collegamenti.
  Non a livelli, carta, tavole, risorse, altri connettori, né a un gruppo che
  contiene il connettore stesso. Il contorno di un gruppo è quello dei suoi
  oggetti visibili.

I punti d'aggancio:

- **`top`, `right`, `bottom`, `left`:** il centro di quel lato del riquadro
  dell'oggetto, nel verso dell'oggetto: un oggetto ruotato ruota i suoi lati.
  Il capo sta dove il raggio che va dal centro dell'oggetto a quel punto esce
  dal contorno disegnato, più mezzo spessore del contorno: la linea tocca il
  bordo che si vede, anche di un cerchio o di un triangolo.
- **`center`:** la linea punta al centro dell'oggetto e si ferma sul contorno.
- **`auto`:** lo sceglie FubDraw. Per una linea dritta vale `center`, verso
  l'altro capo. Per un gomito o una curva è il lato rivolto verso l'altro capo:
  le diagonali dividono il riquadro in quattro triangoli, uno per lato, e vale
  quello in cui cade la direzione dell'altro capo.

## 4. Il percorso

Il formato non fissa come si calcola il percorso: la lettura prende la
geometria com'è scritta. Così lo calcola FubDraw.

- **Dritto:** dal capo al capo.
- **Curvo:** i due punti di controllo escono da ciascun capo nella direzione
  dell'aggancio, a 0,4 volte la distanza fra i capi, ma non meno di 30 unità;
  se i capi distano meno di 30, a quella distanza. Con un capo libero, il
  suo punto di controllo punta verso l'altro.
- **A gomito:** tratti orizzontali e verticali. La linea esce dritta da ogni
  oggetto per 20 unità e gira attorno ai due oggetti che unisce, non agli
  altri. Fra i percorsi possibili preferisce quello con meno curve e, a parità,
  la via di mezzo fra i due oggetti. Se gli oggetti sono troppo vicini,
  l'uscita si accorcia.

## 5. Seguire gli oggetti

- **Quando un oggetto agganciato cambia:** si sposta, cambia misura o forma,
  anche dentro un gruppo che si sposta. FubDraw ricalcola `fub:geom` e `d` del
  connettore nella stessa operazione, e un annulla li riporta insieme.
- **Un connettore spostato da solo,** senza gli oggetti a cui è agganciato,
  perde i due agganci: la linea resta dove la si è messa. Spostato insieme a
  uno dei suoi oggetti, resta agganciato a tutti e due.
- **Togliere un oggetto** stacca il capo che vi era agganciato, togliendo
  l'attributo; la linea tiene l'ultima geometria.
- **Un livello o un gruppo bloccato:** il connettore che vi sta dentro non si
  riscrive, e resta com'era finché non lo si sblocca.

## 6. L'etichetta

L'etichetta di un connettore è un `text` con `fub:along`, tre parole separate
da spazi di SVG: l'id del connettore, `t` e la distanza.

- **`t`:** un numero da 0 a 1 compresi, la frazione della lunghezza della
  linea dal suo inizio. FubDraw lo scrive con 4 decimali.
- **La distanza:** quella fra la linea e il bordo più vicino del riquadro
  dell'etichetta, con 2 decimali. È positiva dalla parte della linea che guarda
  in alto a destra, cioè sopra una linea orizzontale, a destra di una
  verticale, e di una obliqua dove la perpendicolare va più verso l'alto a
  destra; negativa dall'altra. Una linea parallela alla diagonale che sale
  verso destra ha le due perpendicolari alla pari: vale quella in alto a
  sinistra. Così la parte positiva non dipende dal verso della linea.
- **Il posto** dell'etichetta è il suo `transform`. Quando la linea si sposta,
  FubDraw le aggiunge davanti uno spostamento, così il centro dell'etichetta
  va dove dice `fub:along`; quando si sposta l'etichetta, FubDraw riscrive
  `fub:along` dal suo posto nuovo.
- **Fuori grammatica:** parole diverse da tre, un `t` fuori da 0..1 o numeri
  che non si leggono. Il `fub:along` non si usa e resta com'è.
- **Se il connettore viene tolto,** il `fub:along` delle sue etichette si
  toglie.
- **Un'etichetta nuova** nasce con `text-anchor="middle"`, a metà della linea
  (`t` 0,5) e a distanza 4.
- **Più etichette:** un connettore può averne quante ne servono; per il suo
  nome conta la prima, in ordine di documento, che ha parole.

`fub:along` conta soltanto su un `text`.

## 7. Lettura e scrittura

- **Fuori grammatica,** per `fub:geom`: un tipo sconosciuto, un numero di
  valori sbagliato o dispari, un valore che non è un numero o non è finito. Il
  connettore è allora un tracciato normale (§6): la geometria si legge da `d`
  e gli attributi si conservano, `fub:from` e `fub:to` compresi.
- **Nella scena letta** il ruolo è `connector`, con la geometria e i due capi
  letti; un capo libero o fuori grammatica è `null`. La lettura non confronta
  `d` con la geometria. Il posto di un'etichetta si legge nel suo `text`.
- **Scrittura:** `fub:geom` con i numeri a due decimali, `fub:from` e `fub:to`
  come «id aggancio», `fub:along` come «id t distanza», con `t` riportato
  dentro 0..1. Nell'ordine canonico (formato della scena, §7, punto 2) gli
  attributi vengono dopo `fub:shape`: `fub:geom`, `fub:from`, `fub:to`, poi
  `fub:along` sul testo.
- **Quando si riscrive `d`:** quando cambia `fub:geom`.
- **Analisi e accessibilità:** il connettore conta fra le forme; il suo
  riquadro e ciò che dipinge si leggono da `d`, come per la freccia. Si
  nomina col suo `title` o, in mancanza, con le parole della sua prima
  etichetta, e l'albero degli oggetti e la Lettura dicono da che cosa a che
  cosa va ([accessibilità](scene-format-accessibility.md)).

## 8. Compatibilità

Un lettore che non conosce i connettori vede un tracciato e un testo
qualunque: la linea si disegna dal suo `d` e l'etichetta dove la mette il suo
`transform`. Gli attributi `fub:geom`, `fub:from`, `fub:to` e `fub:along` sono
`fub:*`: un lettore di FubDraw che non conosce i connettori li conserva
(formato della scena, §10) ma non ricalcola la linea quando un oggetto si
sposta, e un programma estraneo può non conservarli, lasciando la linea che
dice `d`.

L'SVG pulito dell'export non li scrive: toglie ogni attributo di un
namespace che non è quello vuoto, XLink o XML, e il connettore esce come un
`path` con il suo `d` e l'etichetta come un `text`
([export, §3](scene-format-export.md#3-lsvg-pulito)).
