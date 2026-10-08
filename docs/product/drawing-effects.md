# Disegni, effetti e fusione

> **Per chi:** chi vuole dare a un oggetto un'ombra, un bagliore o una
> sfocatura, fonderlo coi colori sotto di lui, o cambiarne l'opacità al
> volo.
> **Risultato:** sapere come si danno e si cambiano gli effetti nel pannello
> delle proprietà, come si sceglie un modo di fusione, dov'è l'opacità nella
> barra, e che cosa ne fanno i comandi e l'export.

All'[Esperto](drawing-expert.md) un oggetto ha i suoi **effetti**, come
l'Aspetto di Illustrator o gli Effetti di Figma: ombre e bagliori, fuori e
dentro la forma, e una sfocatura, uno sopra l'altro nell'ordine della lista.
Ogni effetto si cambia coi numeri, si nasconde senza perderlo e si toglie, e
l'oggetto resta quello che era: spostarlo, ridimensionarlo o cambiarne il
contorno porta con sé i suoi effetti. Il **modo di fusione** dice come
l'oggetto si mescola coi colori sotto di lui, Moltiplica o Scolora come in
Photoshop. Dallo Standard la barra «Disponi» ha l'**opacità** degli oggetti
scelti. Il modello è in `apps/client/src/editors/spatial/tools/effects.ts`,
la sezione in `tools/effects-panel.ts`, la fusione e l'opacità in
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
- **Un effetto nascosto** resta nella lista coi suoi valori, pronto a
  tornare, e non si disegna; con tutti nascosti l'oggetto non ha filtro, e
  non costa niente a chi lo disegna.
- **Sono nelle coordinate dell'oggetto,** come lo spessore del contorno: un
  oggetto ingrandito dalle maniglie ha l'ombra più grande e più sfocata, e
  uno ruotato la gira con sé.

## La sezione «Effetti»

All'Esperto il [pannello delle proprietà](drawing-properties.md) ha la
sezione «Effetti» dopo «Sfumatura», con oggetti scelti che prendono effetti:
le forme, anche le frecce, i poligoni e le stelle, i tratti a penna, le linee
a spessore variabile, i testi, le immagini, i gruppi e i collegamenti.
Nell'intestazione **«Aggiungi effetto»**, anche a sezione chiusa, apre il
menu dei cinque effetti, col clic o con la freccia in giù; la sfocatura è
spenta se c'è già, e ogni voce con otto effetti, e la voce dice perché.
L'effetto nuovo entra in fondo alla lista coi suoi valori di partenza,
aperto, e la sezione si apre.

Ogni effetto è una riga della lista:

- **l'occhio**, «Mostra ombra esterna», è premuto quando l'effetto si vede,
  e lo nasconde o lo mostra; nascosto, l'occhio è sbarrato e il nome
  barrato, così la riga lo dice anche senza colore;
- **il nome** apre e chiude i suoi campi; chiuso, accanto al nome c'è il
  riassunto dei valori, «0, 4 · 8 · 25%», così la lista si legge senza
  aprirla. Una riga sola è aperta alla volta, e resta aperta finché la
  selezione è la stessa. Le frecce in su e in giù, `Inizio` e `Fine` passano
  da un nome all'altro;
- **«Togli»**, o `Canc` sulla riga, lo toglie; il fuoco va alla riga che
  segue, o alla precedente, o ad «Aggiungi effetto».

I campi della riga aperta sono quelli dell'effetto: per un'ombra X, Y,
Sfocatura, Colore e Opacità; per un bagliore Dimensione, Colore e Opacità;
per la sfocatura Raggio. Le misure sono nell'unità dello spessore del
contorno, i punti, o i pixel in un documento in pixel; l'opacità in
percentuale. Si scrivono come gli altri campi del pannello: un valore si
calcola, «4+2» o «50%»; le frecce cambiano di 1, con `Maiusc` di 10, e i
passi di fila fanno un passo solo nella cronologia; `Invio` o lasciare il
campo applica, `Esc` torna al valore di prima e poi al foglio. Un valore che
non si legge resta scritto, segnato col suo perché. Lo scostamento sta fra
-2000 e 2000, la sfocatura, la dimensione e il raggio fra 0 e 500. Il colore
si scrive come codice, come nome o col nome di un campione, di cui prende il
colore: l'effetto non resta legato al campione.

Ogni cambio è un passo di annulla col nome di ciò che fa: «Aggiungi ombra
esterna», «Togli bagliore interno», «Nascondi sfocatura», «Ombra esterna»
per un campo. Lo screen reader sente che cosa è cambiato.

### Più oggetti

Con più oggetti che hanno gli stessi effetti, uguali in tutto, la sezione
li mostra e ogni cambio vale per tutti. Se sono diversi dice «Effetti
diversi», con due pulsanti: **«Usa questi effetti per tutti»** dà a ognuno
gli effetti del primo oggetto scelto che ne ha, **«Togli gli effetti»** li
toglie a tutti. «Aggiungi effetto» aggiunge l'effetto alla lista di
ciascuno.

### Quando non si può

- **Un oggetto ritagliato o mascherato** non prende effetti: SVG ritaglia
  dopo il filtro, e l'ombra sparirebbe. La sezione lo dice, e suggerisce di
  raggrupparlo e dare gli effetti al gruppo, come in Illustrator.
- **Un gruppo con parti di un altro programma**, di cui non si sa la misura,
  neppure: la sezione dice perché.
- **I livelli, la carta e le tavole** non prendono effetti, e con soltanto
  loro la sezione non c'è.
- **Un filtro scritto da un altro programma** si vede e si conserva: la
  sezione dice «Un filtro di un altro programma», con «Togli il filtro»; un
  effetto aggiunto lo sostituisce.

## La fusione

All'Esperto la sezione «Aspetto» ha, dopo «Opacità», **«Fusione»**: come i
colori dell'oggetto si mescolano con ciò che sta sotto. I sedici modi, coi
nomi e nei gruppi di Illustrator e di Photoshop:

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
- **«Isola la fusione»**, per un gruppo o un collegamento scelti, tiene le
  fusioni dei suoi oggetti dentro di lui: si fondono fra loro, e il gruppo
  si posa intero su ciò che sta sotto.
- Ogni scelta è un passo di annulla, «Fusione», «Isola la fusione» o «Non
  isolare la fusione». «Normale» toglie la fusione dal file; con modi
  diversi il campo dice «Misto».

## L'opacità nella barra

Dallo Standard la barra «Disponi», accanto alla selezione, ha il campo
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

- **La selezione, la cornice, l'aggancio, le guide intelligenti, il lazo e
  il riquadro** restano sulla geometria dell'oggetto, come in Illustrator e
  in Figma: un'ombra non si sceglie, e non sposta la cornice.
- **L'export della selezione e «Adatta la pagina al disegno»** contengono
  ciò che gli effetti dipingono fuori dalla geometria: un'ombra non esce
  tagliata. La pagina che cresce da sé, quando un oggetto ne esce, guarda
  la geometria: un'ombra che sfiora il bordo non la allarga.
- **Duplicare, copiare e incollare** danno alla copia i suoi effetti e il
  suo filtro: cambiare quelli della copia non tocca l'originale
  ([Disegni, risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile» e il contagocce** portano gli effetti e il modo di
  fusione, con l'opacità, come il contagocce di Illustrator prende
  l'aspetto ([Disegni, colori](drawing-colors.md#il-contagocce)). Un oggetto
  che non prende effetti tiene i suoi, e prende il resto dello stile.
  L'isolamento della fusione no: dice come è fatto un gruppo, non come si
  vede.
- **Separa e «Togli il collegamento»** lasciano interi un gruppo o un
  collegamento con degli effetti, anche nascosti, e lo dicono: valgono per
  tutto ciò che contengono.
- **«Applica trasformazione»** lascia la sua trasformazione a un oggetto con
  degli effetti, anche nascosti: sono nelle sue coordinate, e riscriverli
  cambierebbe com'è l'ombra ([Disegni, livello
  Esperto](drawing-expert.md#applica-trasformazione)).
- **«Ritaglia…»** non ritaglia un'immagine con degli effetti, che il
  ritaglio taglierebbe, e lo dice; per un'immagine ritagliata con l'ombra si
  raggruppa l'immagine e si dà l'ombra al gruppo.
- **Le maschere:** un oggetto con degli effetti che si vedono non fa da
  maschera, e il comando lo dice; con gli effetti nascosti sì, e «Rilascia
  maschera» glieli rende ([Disegni, ritagli e
  maschere](drawing-masks.md)).

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

## Livelli e parti

L'opacità nella barra viene dallo Standard, con la barra «Disponi». Gli
effetti e la fusione vengono dall'Esperto; nel
[Personalizzato](drawing-custom.md) li portano le parti «Ombre, bagliori e
sfocatura» e «Metodi di fusione». A un livello che non li ha gli effetti e
le fusioni restano nel disegno e si vedono; mancano la sezione e il campo.
In un documento in sola lettura la sezione mostra gli effetti, e non li
cambia.
