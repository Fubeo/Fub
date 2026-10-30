# Disegni, penne

> **Per chi:** chi scrive e disegna a mano, con la penna di una tavoletta, col
> dito o col mouse.
> **Risultato:** sapere quali penne ci sono e come si scelgono, come si
> regolano punta, misura, levigatura e pressione, come si cancella una parte
> di un tratto, come si riscrive un tratto con un'altra penna, come si
> riproduce un disegno e come si scrive lungo il righello.

La **Penna** (`P`) e l'**Evidenziatore** (`Maiusc+P`) del
[disegno](drawing.md) scrivono tratti a mano libera. Ogni tratto tiene i suoi
campioni grezzi, posizione, pressione, inclinazione e tempo, in `fub:ink`, e
il pennello con cui è nato in `fub:brush` (il formato è in
[`scene-format-pens.md`](../reference/scene-format-pens.md)): per questo un tratto si
può ridisegnare dopo, con un'altra penna, senza perdere niente.

## Le penne

La Penna ha sei penne, l'Evidenziatore una:

| Penna | Com'è | Misura di serie |
|---|---|---|
| **Sfera** | sottile, appena più stretta ai capi; la penna di serie | 2 |
| **Stilografica** | segue molto la pressione, con capi affilati | 3 |
| **Pennello** | molto morbido, capi lunghi e senza estremi tondi | 10 |
| **Pennarello** | spessore costante, quasi pieno; non segue la pressione | 6 |
| **Matita** | sottile e un po' trasparente | 1,5 |
| **Calligrafia** | punta piatta girata di 35°, o come la penna se la tavoletta lo dice: il tratto è largo o stretto secondo la direzione | 12 |
| **Evidenziatore** | largo, a capi piatti, metà trasparente e con la fusione Moltiplica: il nero sotto resta nero | 16 |

Le penne sono ricette del pennello (`apps/client/src/ink/pens.ts`): sei
sono il pennello `pf1` con altri numeri, la Calligrafia è il pennello a punta
piatta `nib1`. Il pennello scrive la penna con cui è nato come `pen=<id>`;
chi non conosce le penne tiene la chiave e mostra il tratto uguale. Una penna
che segue la pressione la segue soltanto quando il dispositivo la dà: un
tratto del mouse non la finge.

## Scegliere la penna

Con la Penna, la riga delle opzioni comincia col nome della penna. Il
pulsante apre la **galleria**: le sei penne con l'anteprima del tratto, poi
**«Le mie penne»** e **«Salva come penna…»**. Una penna salvata ha un nome e
tiene penna, misura, colore e opacità; le penne salvate sono di questa
macchina (`draw.pens`), non del disegno.

Accanto stanno:

- la **misura**, da 0,25 a 200 unità, con un campo e un cursore
  logaritmico: fra 0,25 e 2 conta ogni decimo, fra 100 e 200 no. `[` e `]`
  stringono e allargano la punta di 0,8× e 1,25×;
- l'**opacità**, da 1 a 100 %;
- **«Mano»**: la levigatura del tratto e la curva della pressione, gli stessi
  gruppi della finestra «Penna e dita» ([vista e gesti](drawing-view.md));
- **«Uscita»**: **Inchiostro** (il tratto coi suoi campioni), o
  **Tracciato fedele**, **Tracciato** e **Tracciato leggero**, che al
  rilascio trasformano il tratto in una linea di Bézier, con lo spessore della
  pressione in una linea a spessore variabile
  ([formato](../reference/scene-format-width.md)). Il tracciato non tiene i campioni: non si
  ripenna, non si leviga e non si riproduce.

La penna, il modo della gomma e l'uscita sono della macchina e si ritrovano
in ogni disegno; misura e opacità valgono finché il disegno è aperto. Nello spazio Semplice la riga tiene soltanto il
colore e i tre spessori.

Sospesa sopra il foglio, la penna mostra la sua **punta** alla misura vera:
un cerchio, l'ellisse girata della Calligrafia, il rettangolo
dell'evidenziatore, il cerchio tratteggiato della gomma. Durante il tratto
la punta sparisce e si vede l'inchiostro. Il dito non ha punta.

## Gesti e tasti

- **Maiusc** tenuto durante il tratto lo fa dritto dal primo punto
  all'ultimo, a passi di 15°; lasciato Maiusc, resta dritto fino al rilascio.
- **Maiusc+clic** tira una linea dritta dalla fine dell'ultimo tratto.
- **Alt** tenuto fa della penna un contagocce: il tocco prende il colore di
  ciò che sta sotto.
- La **penna girata** cancella con qualunque strumento, come la gomma
  scelta.
- Il **tasto laterale** fa ciò che si sceglie in «Penna e dita»: apre il
  menu radiale, sceglie col lazo, cancella, o niente.

## Cancellare

La **Gomma** (`E`) ha due modi, nella riga delle opzioni:

- **Tratto intero**: toglie i tratti che tocca;
- **Precisa**: taglia i tratti dove passa, e i pezzi restano tratti, coi loro
  campioni e la loro penna. Un oggetto che non è un tratto a mano, o un tratto
  che non si ridisegna, si toglie intero come con l'altro modo.

## Ripennare e levigare

Con dei tratti scelti, cambiare penna, misura, colore o opacità nella riga
delle opzioni li ridisegna dai loro campioni. Dal menu col tasto destro, in
**Tracciato**, ci sono anche:

- **«Ripenna con la Penna di adesso»**: i tratti scelti prendono penna e
  misura di adesso;
- **«Leviga i tratti»**: i campioni ripassano dallo stabilizzatore.

Ognuno è un passo di Annulla. L'evidenziatore resta evidenziatore: un'altra
penna va soltanto ai tratti della Penna. Un tratto già in tracciato resta com'è,
e l'editor dice quanti ne ha lasciati.

## Riprodurre

Nel menu **Vista**, **«Riproduci a 1×»**, **2×** e **4×** riscrivono il
disegno sul foglio coi tempi veri dei campioni, nell'ordine in cui i tratti
sono nati (`fub:at`). Le pause più lunghe di 0,4 secondi si accorciano. Gli
oggetti che non sono tratti a mano si vedono sempre. Un tasto o un tocco
ferma la riproduzione; il file non cambia. Col movimento ridotto la
riproduzione non parte.

## Il righello

Nel menu **Vista** la casella **«Righello»**, o «righello» nella palette
(`Ctrl+/`), mette un righello sul foglio: una riga larga, dritta sullo
schermo, coi gradi scritti sopra. Un tratto della Penna o dell'Evidenziatore
che comincia vicino a un bordo lo segue, a mezza punta dal bordo. Il
righello:

- si sposta prendendolo in mezzo, con qualunque strumento;
- si gira con la rotella sopra, a gradi, o con Maiusc a passi di 15°;
- si sposta e si gira con due dita appoggiate sopra; alzate le dita, l'angolo
  si arrotonda al grado;
- dal menu Vista si gira di 15° o si raddrizza.

A ogni cambio l'editor dice l'angolo. Il righello è della sessione: non entra
nel file e non si ricorda.

## Nei documenti di Word

La scheda «Disegna» dei documenti di Word ha le stesse sei penne, nel menu
**«Tipo di penna»** ([ADR 0226](../decisions/0226-inchiostro-e-disegni-nei-documenti.md)).
Nel file la penna diventa ciò che Word sa di un pennello: la Calligrafia una
punta rettangolare, il Pennarello la pressione ignorata, l'evidenziatore una
punta rettangolare trasparente; la penna stessa resta in `fubPen`, che Word
ignora ([`rich-projection.md`](../reference/rich-projection.md)). Le penne
salvate non ci sono.
