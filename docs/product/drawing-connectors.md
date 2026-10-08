# Disegni, connettori

> **Per chi:** chi disegna schemi, diagrammi di flusso o mappe di idee, e
> vuole linee che restino attaccate agli oggetti quando questi si spostano.
> **Risultato:** sapere come si tira un connettore, a che cosa si aggancia e
> come lo segue la linea, che cosa dice il pannello delle proprietà, e che
> cosa ne fanno i comandi, la Lettura e l'export.

Dallo Standard lo strumento **Connettore** (`X`, la lettera di FigJam) unisce
due oggetti con una linea che li segue: se uno si sposta, si ridimensiona o
si gira, la linea si ricalcola e resta attaccata. Sta nel gruppo delle
forme, e porta con sé la sezione «Connettore» del [pannello delle
proprietà](drawing-properties.md) e il comando «Collega le forme scelte». Il
percorso e il seguire gli oggetti sono in
`apps/client/src/editors/spatial/tools/connectors.ts`, la geometria e gli
agganci in `scene/connectors.ts`.

## Tirare un connettore

- **Passando su un oggetto** se ne illumina il contorno e compaiono cinque
  punti: il centro dei quattro lati e il centro. Vicino a un punto, entro una
  decina di pixel sullo schermo, il capo si aggancia lì; altrove sull'oggetto
  l'aggancio è «automatico»: FubDraw sceglie il lato rivolto verso l'altro
  capo.
- **Si preme su un oggetto e si trascina su un altro:** la linea segue il
  puntatore. Rilasciando su un oggetto il capo si aggancia, sul vuoto resta
  libero. Si può anche partire dal vuoto, con un capo libero. `Esc` annulla il
  gesto, e un trascinamento cortissimo non fa niente.
- **Il connettore nuovo** è del tipo scelto per ultimo nel pannello,
  all'inizio «A gomito», con una punta a triangolo media alla fine, il colore
  e lo spessore del contorno dello stile di disegno e nessun riempimento. È un
  passo di annulla, «Connettore». Resta scelto, così il pannello lo mostra, e
  lo strumento resta il Connettore.
- **Un tocco** con lo strumento sceglie ciò che tocca, come con la Selezione.
- **Un capo si riaggancia** con lo stesso strumento: i capi di un connettore
  scelto hanno una maniglia quadrata, e trascinarla aggancia quel capo a un
  altro oggetto o lo lascia libero, con l'altro capo dov'è. È un passo di
  annulla, «Aggancio del connettore».

## I tre tipi

| Tipo | Percorso |
|---|---|
| Dritto | sulla linea fra i centri, o dal punto scelto |
| A gomito | tratti orizzontali e verticali |
| Curvo | una curva che esce da ogni capo agganciato perpendicolare al lato |

- **Il gomito gira attorno ai due oggetti che unisce,** non agli altri. Ogni
  curva costa: sceglie il percorso con meno curve e, a parità, quello per la
  via di mezzo.
- **Il tipo si cambia** nel pannello, in ogni momento. Il connettore che si
  tira dopo ha il tipo scelto per ultimo.

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
  ridimensionarlo e girarlo, e per cambiarne la geometria dal pannello o coi
  nodi.
- **Un connettore spostato, girato o ridimensionato da solo,** con la
  Selezione o dal pannello, si stacca, e l'annuncio lo dice: i due capi
  diventano liberi e la linea resta dove la si è messa. Spostato insieme agli
  oggetti che unisce, resta agganciato.
- **Togliere un oggetto** lascia libero il capo che vi era agganciato, e la
  linea resta com'era.
- **In un livello o in un gruppo bloccato** un connettore non si ricalcola.

Mentre si trascina, il percorso si ricalcola a ogni movimento solo per i
connettori degli oggetti che si muovono, e le frecce della tastiera spostano
oggetti e connettori nello stesso passo. Il banco dei connettori
(`apps/client/bench/connectors.mjs`) apre nell'app vera un disegno di 200
forme e 300 connettori, dritti, a gomito e curvi, con punte, etichette e forme
«nodo» con molti connettori. Trascina un nodo col mouse, poi le forme tutte
insieme e tutto il disegno, e li sposta con le frecce. A ogni gesto vuole i
capi sul contorno delle forme che uniscono, ancora 300 connettori, il file
salvato uguale a ciò che si vede, e Ctrl+Z che rimette tutto com'era; ogni
movimento si dipinge entro 150 ms e ogni passo che scrive entro un secondo.

## L'etichetta

Un connettore può avere un testo che lo accompagna, come «sì» e «no» in un
diagramma di flusso.

- **Il campo «Etichetta»** del pannello scrive un testo a metà della linea, 4
  unità sopra, o a destra di una linea verticale. Il testo segue la linea.
- **Spostata da sola,** con la Selezione, l'etichetta prende il posto nuovo
  lungo la linea: il punto più vicino, a che frazione della lunghezza e a che
  distanza.
- **Il testo si cambia** anche con lo strumento Testo, come ogni testo.
- **Eliminare il connettore** elimina le sue etichette. Togliere il connettore
  in altro modo lascia l'etichetta come un testo qualunque.
- **Un connettore può avere più etichette:** il campo mostra e cambia la
  prima.

## La sezione «Connettore»

La sezione del pannello delle proprietà viene con un connettore fra gli
oggetti scelti:

- **Tipo** ha tre pulsanti: Dritto, A gomito e Curvo.
- **Aggancio d’inizio** e **Aggancio di fine** scelgono il punto: Automatico,
  Al centro, In alto, A destra, In basso o A sinistra, nel verso
  dell'oggetto, cioè girato con lui. Un capo libero dice «Libero», e si
  aggancia trascinandolo.
- **Etichetta** è il campo del testo.
- **Inverti** scambia inizio e fine: la punta di fine va al capo nuovo, e
  la freccia indica l'altro oggetto.

Con più connettori la sezione mostra ciò che hanno in comune, e un valore
diverso dice «Misto». Ogni cambio è un passo di annulla.

## Collega le forme scelte

Il comando sta nella barra «Disponi», nel menu «Selezione avanzata» e col
tasto destro. Unisce ogni oggetto scelto al seguente, ed è il modo di fare
connettori senza puntatore.

- **L'ordine** non è quello dei clic, che la selezione non ricorda, ma quello
  in cui gli oggetti stanno sul foglio: da sinistra a destra se i loro centri
  sono più distesi in larghezza che in altezza, altrimenti dall'alto in
  basso.
- **I connettori** hanno il tipo scelto per ultimo e gli agganci automatici.
- **Due oggetti già uniti** da un connettore, in un verso o nell'altro, non si
  uniscono di nuovo, e il comando dice quanti connettori ha fatto.
- **Servono almeno due oggetti** che si possono agganciare; i connettori fra
  gli scelti non contano.

Il comando è un passo di annulla, anche se fa più connettori.

## Con gli altri comandi

- **Duplicare, copiare e incollare** oggetti coi loro connettori unisce le
  copie fra loro. Un connettore copiato senza uno dei suoi oggetti ha quel
  capo libero ([Disegni, appunti](drawing-clipboard.md)).
- **I Nodi non cambiano un connettore:** il suo percorso lo calcola FubDraw, e
  lo strumento lo dice. Si cambia il tipo o gli agganci. All'Esperto la
  tabella degli attributi mostra il `d` del connettore, e dice lo stesso.
- **Le punte** si danno come a ogni linea ([Disegni, punte delle
  linee](drawing-tips.md)); con «Inverti» passano all'altro capo.

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

## Livelli e parti

Il Connettore viene dallo Standard; nel [Personalizzato](drawing-custom.md) la
parte è lo strumento «Connettore», che porta con sé la sezione del pannello e
«Collega le forme scelte». A un livello che non l'ha, i connettori restano nel
disegno, si vedono e continuano a seguire gli oggetti: è un fatto del file.
Mancano il modo di farne e quello di cambiarli. In un documento in sola
lettura la sezione mostra i connettori, e non li cambia.
