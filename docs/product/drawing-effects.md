# Disegni, effetti e fusione

> **Per chi:** chi apre un disegno con ombre, bagliori, sfocature o modi di
> fusione, e chi vuole cambiare al volo l'opacità degli oggetti.
> **Risultato:** sapere che cosa Fub disegna degli effetti e della fusione
> che un disegno porta, dov'è l'opacità nella barra, e che cosa ne fanno i
> comandi e l'export.

Un disegno può portare degli **effetti**, come l'Aspetto di Illustrator o gli
Effetti di Figma: ombre e bagliori, fuori e dentro la forma, e una sfocatura,
uno sopra l'altro; e un **modo di fusione**, che dice come l'oggetto si
mescola coi colori sotto di lui, Moltiplica o Scolora come in Photoshop. Fub
li disegna e li conserva quando un disegno li porta, scritti da una versione
precedente o da un altro programma, ma non li aggiunge e non li cambia: la
sezione «Effetti» e il campo «Fusione» se ne sono andati col livello Esperto
(decisione 0231). Spostare, ridimensionare o cambiare il contorno di un
oggetto porta con sé i suoi effetti. Nello spazio Completo la barra
«Disponi» ha l'**opacità** degli oggetti scelti. Il modello è in
`apps/client/src/editors/spatial/tools/effects.ts`, l'opacità in
`tools/look.ts`.

## Gli effetti

| Effetto | Che cosa fa | Di partenza |
|---|---|---|
| Ombra esterna | l'ombra della forma, spostata e sfocata, sotto l'oggetto | 0, 4 · 8 · nero al 25% |
| Ombra interna | un'ombra dentro la forma, dal bordo | 0, 2 · 4 · nero al 25% |
| Bagliore esterno | un alone del suo colore attorno alla forma | 8 · giallo al 75% |
| Bagliore interno | un alone del suo colore dal bordo verso l'interno | 6 · bianco al 75% |
| Sfocatura | sfoca l'oggetto, coi suoi altri effetti | 4 |

- **Le misure sono quelle di CSS e di Figma.** Un'ombra «0, 4 · 8» è il
  `box-shadow: 0 4px 8px` di una pagina web: lo scostamento in X e in Y, poi
  la sfocatura. La dimensione di un bagliore e il raggio della sfocatura si
  misurano allo stesso modo.
- **L'ordine conta.** Gli effetti esterni stanno sotto l'oggetto, il primo
  della lista più in basso; quelli interni sopra il suo riempimento, nello
  stesso ordine; la sfocatura vale per tutto.
- **Al più otto effetti**, e una sola sfocatura.
- **Un effetto nascosto** resta nel file coi suoi valori e non si disegna;
  con tutti nascosti l'oggetto non ha filtro, e
  non costa niente a chi lo disegna.
- **Sono nelle coordinate dell'oggetto,** come lo spessore del contorno: un
  oggetto ingrandito dalle maniglie ha l'ombra più grande e più sfocata, e
  uno ruotato la gira con sé.

## La fusione

I sedici modi, coi nomi e nei gruppi di Illustrator e di Photoshop:

| Modi | Che cosa fanno |
|---|---|
| Normale | l'oggetto copre ciò che sta sotto |
| Scurisci, Moltiplica, Brucia colore | scuriscono; il bianco non cambia niente |
| Schiarisci, Scolora, Scherma colore | schiariscono; il nero non cambia niente |
| Sovrapponi, Luce soffusa, Luce intensa | alzano il contrasto; il grigio medio non cambia niente |
| Differenza, Escludi | tolgono un colore dall'altro |
| Tonalità, Saturazione, Colore, Luminosità | prendono una parte del colore dell'oggetto, il resto da sotto |

- **Ciò che sta sotto** è il disegno sotto l'oggetto, carta compresa,
  attraverso i livelli: un oggetto in Moltiplica sulla carta bianca resta
  com'è, sopra una foto la scurisce. Mai l'editor o la pagina attorno al
  disegno.
- **Un gruppo che isola la fusione** tiene le fusioni dei suoi oggetti
  dentro di lui: si fondono fra loro, e il gruppo si posa intero su ciò che
  sta sotto.
- **Un filtro scritto da un altro programma** si vede e si conserva come gli
  effetti di FubDraw.

## L'opacità nella barra

Nello spazio Completo la barra «Disponi», accanto alla selezione, ha il campo
**«Opacità»**, come il pannello Controllo di Illustrator: la stessa opacità
della sezione «Aspetto», in percentuale, senza aprire il pannello. Con
opacità diverse è vuoto e dice «Misto».

- Le frecce in su e in giù cambiano di 1, con `Maiusc`, `PagSu` e `PagGiù`
  di 10; `Inizio` e `Fine` portano a 0 e a 100. Ogni passo vale subito, e i
  passi di fila fanno un passo solo nella cronologia, «Opacità».
- Un valore scritto vale con `Invio` o lasciando il campo, e si calcola come
  nel pannello: «50», «50%», «40+10». Uno che non si legge è detto, e il
  campo torna all'opacità che vale. `Esc` torna al valore di prima, e poi al
  foglio.
- Le frecce a destra e a sinistra muovono il cursore nel campo; dagli altri
  pulsanti della barra ci arrivano come a un pulsante.

## Con gli altri comandi

- **La selezione, la cornice, l'aggancio e il riquadro** restano sulla geometria dell'oggetto, come in Illustrator e
  in Figma: un'ombra non si sceglie, e non sposta la cornice.
- **L'export della selezione e «Adatta la pagina al disegno»** contengono
  ciò che gli effetti dipingono fuori dalla geometria: un'ombra non esce
  tagliata. La pagina che cresce da sé, quando un oggetto ne esce, guarda
  la geometria: un'ombra che sfiora il bordo non la allarga.
- **Duplicare, copiare e incollare** danno alla copia i suoi effetti e il
  suo filtro ([Disegni, risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile»** porta gli effetti e il modo di fusione, con
  l'opacità. Un oggetto
  che non prende effetti tiene i suoi, e prende il resto dello stile.
  L'isolamento della fusione no: dice come è fatto un gruppo, non come si
  vede.
- **Separa e «Togli il collegamento»** lasciano interi un gruppo o un
  collegamento con degli effetti, anche nascosti, e lo dicono: valgono per
  tutto ciò che contengono.

## In Lettura e nell'export

In Lettura, in PNG, in JPEG e nell'SVG pulito gli effetti e la fusione sono
quelli del foglio. Nel PDF la fusione resta vettoriale; gli effetti, che il
PDF non ha, si dipingono in un'immagine a 300 punti per pollice, con
l'oggetto che li porta, e il resto della pagina resta vettoriale. Un disegno
con effetti molto grandi li dipinge a una risoluzione più bassa, e l'export
si fa comunque ([Disegni, esportare](drawing-export.md)).

## Nel file

Gli effetti stanno in `fub:effect`, e un filtro di SVG 1.1, privato, ne
discende, come una sfumatura fra le [risorse](drawing-resources.md); la
fusione sta in `style`, perché i browser leggono soltanto lì
`mix-blend-mode` e `isolation`.

```xml
<rect id="o1" x="10" y="10" width="60" height="40" fill="#ffffff"
  filter="url(#r8k2m4p1q)" fub:effect="shadow 0 4 8 #000000 0.25"/>
<circle id="o2" cx="80" cy="40" r="20" fill="#e69f00"
  style="mix-blend-mode: multiply"/>
```

La grammatica, il filtro e quando un filtro è di FubDraw sono in [Formato
della scena, effetti e fusione](../reference/scene-format-effects.md).

## Spazi e parti

L'opacità nella barra viene nello spazio Completo, con la barra «Disponi». Gli
effetti e le fusioni restano nel disegno e si vedono in ogni spazio e in sola
lettura.
