# Disegni, connettori

> **Per chi:** chi apre schemi, diagrammi di flusso o mappe di idee con linee
> che restano attaccate agli oggetti.
> **Risultato:** sapere che cosa fa l'editor dei connettori che un disegno ha
> già, come la linea segue gli oggetti, e che cosa ne fanno la Lettura e
> l'export.

Un connettore unisce due oggetti con una linea che li segue: se uno si
sposta, si ridimensiona o si gira, la linea si ricalcola e resta attaccata.
L'editor non ne crea più e non ne cambia il tipo, gli agganci o l'etichetta:
lo strumento Connettore, la sezione «Connettore» del pannello delle proprietà
e «Collega le forme scelte» se ne sono andati col livello Standard
(decisione 0231). I connettori che un file ha già restano, si vedono e
continuano a seguire gli oggetti: è un fatto del file. Il percorso e il
seguire gli oggetti sono in
`apps/client/src/editors/spatial/tools/connectors.ts`, la geometria e gli
agganci in `scene/connectors.ts`.

## I tre tipi

| Tipo | Percorso |
|---|---|
| Dritto | sulla linea fra i centri, o dal punto scelto |
| A gomito | tratti orizzontali e verticali |
| Curvo | una curva che esce da ogni capo agganciato perpendicolare al lato |

- **Il gomito gira attorno ai due oggetti che unisce,** non agli altri, e fra
  due oggetti vicini passa in mezzo. Ogni curva costa: sceglie il percorso
  con meno curve e, a parità, quello per la via di mezzo.

## Dove si aggancia

- **Il capo tocca il bordo che si vede,** non il riquadro: di un cerchio o di
  un triangolo, il contorno vero, più mezzo spessore del contorno.
- **Un gruppo vale come un oggetto solo,** col contorno di ciò che disegna.
- **Ci si aggancia** a forme, tracciati, testi, immagini, gruppi e
  collegamenti. Non ci si aggancia a livelli, tavole, altri connettori, né a
  un oggetto che contiene il connettore.
- **I lati sono quelli dell'oggetto:** se è girato, girano con lui.

## Seguire gli oggetti

- **Un oggetto agganciato che cambia** fa ricalcolare i suoi connettori,
  mentre lo si trascina e nello stesso passo di annulla. Vale per spostarlo,
  ridimensionarlo e girarlo, e per cambiarne la misura dal pannello.
- **Un connettore spostato, girato o ridimensionato da solo,** con la
  Selezione o dal pannello, si stacca, e l'annuncio lo dice: i due capi
  diventano liberi e la linea resta dove la si è messa. Spostato insieme agli
  oggetti che unisce, resta agganciato.
- **Togliere un oggetto** lascia libero il capo che vi era agganciato, e la
  linea resta com'era.
- **In un livello o in un gruppo bloccato** un connettore non si ricalcola.

Mentre si trascina, il percorso si ricalcola a ogni movimento solo per i
connettori degli oggetti che si muovono, e le frecce della tastiera spostano
oggetti e connettori nello stesso passo.

## L'etichetta

Un connettore può avere un testo che lo accompagna, come «sì» e «no» in un
diagramma di flusso, a metà della linea o dove lo si è messo. Il testo segue
la linea quando la linea si ricalcola.

## Con gli altri comandi

- **Duplicare, copiare e incollare** oggetti coi loro connettori unisce le
  copie fra loro. Un connettore copiato senza uno dei suoi oggetti ha quel
  capo libero ([Disegni, appunti](drawing-clipboard.md)).
- **Le punte** si cambiano come a ogni linea ([Disegni, punte delle
  linee](drawing-tips.md)).
- **Un gruppo fatto di una forma e della sua etichetta** si aggancia col
  contorno della forma ([Disegni, etichette nelle forme](drawing-labels.md)).

## In Lettura e nell'export

- **L'albero degli oggetti** dice «Connettore da «Ingresso» a «Verifica»», coi
  nomi degli oggetti o, se non ne hanno, il loro genere: «Connettore da
  Rettangolo a «Verifica»». Con un capo libero dice «Connettore da
  «Ingresso»» o «Connettore verso «Verifica»». Un connettore senza titolo
  prende il nome dalla sua prima etichetta: «Connettore «sì» da «Verifica» a
  «Fine»».
- **In Lettura,** sotto i collegamenti e sopra gli oggetti del disegno, la
  sezione «Connessioni» elenca i connettori agganciati a due oggetti, «Ingresso
  → Verifica: sì». Il lettore di schermo non legge la freccia, e dice «da
  Ingresso a Verifica, sì».
- **Nell'export** un altro programma vede un tracciato qualunque e lo disegna
  uguale. L'SVG pulito toglie gli attributi di FubDraw. Nel PDF la linea è
  vettoriale ([Disegni, esportare](drawing-export.md)).

## Nel file

Un connettore è un `path` con `fub:shape="connector"`: `fub:geom` dice il
tipo e i punti del percorso già calcolato, `d` ne viene, e `fub:from` e
`fub:to` dicono a quali oggetti è agganciato e a che punto. L'etichetta è un
`text` con `fub:along`. La punta è un marcatore fra le
[risorse](drawing-resources.md), come per ogni linea.

```xml
<marker id="r5n2p8w3k" fub:role="shared" fub:marker="triangle medium end"
  refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto">
  <path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#000000"/>
</marker>
…
<path id="o7k2m9x4q" fub:shape="connector" fub:geom="elbow 200 220 200 310 600 310 600 400" fub:from="o2b3c4d5e auto" fub:to="o3c4d5e6f auto" d="M200 220 L200 310 L600 310 L600 400" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#r5n2p8w3k)"/>
<text id="o8m3n4p5r" fub:along="o7k2m9x4q 0.5 4" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 400 302)"><tspan x="0" dy="0">sì</tspan></text>
```

Il connettore unisce due rettangoli, `o2b3c4d5e` e `o3c4d5e6f`, e il testo
«sì» è la sua etichetta. Un altro programma vede un tracciato qualunque, e
non ricalcola la linea quando un oggetto si sposta. La grammatica, gli
agganci e il percorso sono in [Formato della scena,
connettori](../reference/scene-format-connectors.md).
