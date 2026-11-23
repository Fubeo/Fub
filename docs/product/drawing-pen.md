# Disegni, penne

> **Per chi:** chi scrive e disegna a mano, con la penna di una tavoletta, col
> dito o col mouse.
> **Risultato:** sapere quali penne ci sono e come si scelgono, come si
> regolano punta, misura, levigatura e pressione, come si cancella una parte
> di un tratto, come si riscrive un tratto con un'altra penna, come si
> riproduce un disegno e come si scrive lungo il righello.

L'**Inchiostro** (`P`) e l'**Evidenziatore** (`Maiusc+P`) del
[disegno](drawing.md) scrivono tratti a mano libera. Nel Disegno completo
c'è anche la **Penna** di Bézier del motore, che fa tracciati punto per punto
([più sotto](#la-penna-di-bézier-disegno-completo)); qui «la penna» senza
altro è sempre l'Inchiostro. Ogni tratto tiene i suoi
campioni grezzi, posizione, pressione, inclinazione e tempo, in `fub:ink`, e
il pennello con cui è nato in `fub:brush` (il formato è in
[`scene-format-pens.md`](../reference/scene-format-pens.md)): per questo un tratto si
può ridisegnare dopo, con un'altra penna, senza perdere niente.

## Le penne

L'Inchiostro ha sei penne, l'Evidenziatore una:

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
- La **penna girata** cancella con qualunque strumento, come la gomma
  scelta.
- Il **tasto laterale** fa ciò che si sceglie in «Penna e dita»: apre il
  menu radiale, cancella, o niente.

## Cancellare

La **Gomma** (`E`) ha due modi, nella riga delle opzioni:

- **Tratto intero**: toglie i tratti che tocca;
- **Precisa**: taglia i tratti dove passa, e i pezzi restano tratti, coi loro
  campioni e la loro penna. Un oggetto che non è un tratto a mano, o un tratto
  che non si ridisegna, si toglie intero come con l'altro modo.

Dentro un gruppo o un collegamento la gomma prende soltanto ciò che tocca: un
livello di Inkscape con tutto il disegno dentro non sparisce perché la gomma
ha sfiorato una parola. Il gruppo se ne va soltanto quando la gomma ne tocca
tutti i figli, e i figli bloccati restano.

Una parte di un altro programma che il disegno conserva com'è, come un testo
senza righe di Inkscape o un collegamento a un indirizzo `mailto:`, non si
sceglie, ma la gomma che la attraversa la toglie intera, in tutti e due i
modi. Mentre la gomma passa non sbiadisce, perché si disegna insieme alle
parti estranee vicine: se ne va quando la gomma si alza.

La **Gomma dei punti** (la casella con la gomma, «Pennello gomma punti di
ancoraggio») toglie i punti di ancoraggio dei tracciati scelti che il tratto
tocca. Si trascina: il segno tratteggiato dice dove passa, e al rilascio il
motore riceve un solo comando con tutto il tratto. Esc a metà, o uno strumento
diverso, non cambia niente. Un clic senza movimento non fa niente. Senza un
tracciato scelto l'editor dice «Scegli un tracciato.». Se il tratto non tocca
nessun punto, lo dice e non scrive.

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

## La Penna di Bézier (Disegno completo)

Nel Disegno completo il gruppo «disegnare» della colonna ha tre caselle, come
gli altri programmi di disegno vettoriale. Gli strumenti vengono dal motore
(la famiglia `tracciati`, `crates/fub-disegno/src/famiglie/tracciati.rs`) e
scrivono tracciati veri, `<path>`, non tratti a mano:

| Casella | Strumenti |
|---|---|
| **Penna** | Penna, Penna intelligente, Curvatura, Aggiungi e Elimina punto di ancoraggio, Punto di ancoraggio, Angoli, Fai scorrere il punto di ancoraggio, Estendi tracciato |
| **Matita** | Matita, poi l'Inchiostro e l'Evidenziatore di Fub, Smussa, Unisci, Fondi bordo condiviso |
| **Gomma** | Gomma (Completo), poi la gomma di Fub, Gomma tracciato, Pennello gomma punti, Forbici, Coltello, Specchia e taglia, Taglio linea, Taglio rettangolare |

La tendina di una casella dà i nomi corti degli strumenti anche prima che la
famiglia sia caricata. Gli strumenti del motore non hanno un tasto: la tendina
non ne mostra. Con uno strumento del motore scelto, le opzioni dell'Inchiostro
e della gomma di Fub lasciano la riga: restano il colore, lo spessore e le
opzioni dello strumento, prima di Modifica.

**La Penna** fa un tracciato clic dopo clic: ogni clic mette un punto,
trascinare tira le maniglie. Fra un clic e l'altro il tracciato è aperto e si
vedono i suoi punti, nel colore d'accento del tema; il file non cambia ancora.
Lo chiudono:

- **Invio** o **Esc**: il tracciato finisce come lo finisce il motore;
- **un altro strumento**: il tracciato resta com'è, aperto;
- **il disegno che cambia sotto**, da un altro riquadro o dal file riletto:
  il tracciato si chiude com'è, aperto, prima che il cambio arrivi al
  motore, e i punti messi restano.

In tutti i casi il tracciato è **un passo** di Annulla. Un secondo Esc,
senza niente di aperto, torna alla Selezione. Lo stesso vale per la Penna
intelligente e la Curvatura.

Gli strumenti dei tracciati non toccano i tratti dell'**Inchiostro**
(`fub:ink`): Forbici, Coltello o Gomma su un tratto a mano sono spenti, e il
disegno resta com'è. Per tagliare un tratto a mano c'è la gomma di Fub,
**Precisa**.

### I punti scelti

Con la **Selezione diretta** o il **Punto di ancoraggio**, i punti scelti
sul foglio danno la riga delle opzioni:

- **Converti**: **Angolo** o **Morbido**;
- **Punto**: **Taglia il tracciato nel punto**, **Unisci i due punti** (due
  punti finali, di uno o due tracciati aperti), **Elimina il punto**;
- **Posizione del punto**: X e Y del punto, quando ne è scelto uno solo.

Un pulsante che adesso non vale resta raggiungibile e dice perché: «Scegli
prima i punti con la Selezione diretta.», o per unire «Scegli i due punti
finali da unire.». Con un punto solo scelto, X e Y si scrivono: Invio porta il
punto lì; con più punti i campi si leggono e basta, e dicono di sceglierne uno.
**Canc** coi punti scelti toglie quei punti, non l'oggetto intero. Ogni comando è un passo di Annulla. I comandi ci
sono anche nella palette (`Ctrl+/`) e nel menu ≡: con un tracciato scelto e
nessun punto, Converti e Unisci valgono sul tracciato intero, Taglia ed
Elimina chiedono i punti. Non toccano i tratti dell'Inchiostro né la carta.

Col Disegno completo acceso, la scheda **Design** dell'ispettore ha anche la
sezione **Punto di ancoraggio**, con un oggetto o dei punti scelti: lì
**Converti** in **Angolo** o **Morbido** manda lo stesso comando della riga
delle opzioni sui punti scelti, e senza punti resta spento col perché. Il
raggio dell'angolo e l'Elaborazione tracciati del prototipo non ci sono
ancora: non hanno un comando del motore.

Come ci arrivano i punti, nel contratto: `DrawingToolState.anchors` e il
`value` dei comandi ([IPC del disegno](../reference/drawing-ipc.md)).

**Angoli** arrotonda un angolo e lo tiene vivo: il raggio si cambia dopo.
Nel file il tracciato è quello arrotondato, che ogni programma vede, e il
raggio sta nella ricetta del motore in `<metadata>`
([ADR del Disegno completo](../architecture/disegno-completo.md)); un
programma che cambia il tracciato perde solo la ricetta.

### Oggetto › Tracciato

Con dei tracciati scelti, il sottomenu **≡ › Oggetto › Tracciato** (e la
palette, `Ctrl+/`) fa, in un passo di Annulla e senza finestre. Le voci
stanno in quattro file, separate da una riga:

- il tracciato intero: **Unisci** e **Rimuovi punti di ancoraggio** (i
  [punti scelti](#i-punti-scelti)), **Inverti direzione tracciato**,
  **Contorna tratto**, che fa del tratto una forma piena, **Aggiungi punti
  di ancoraggio**, uno a metà di ogni segmento, **Dividi oggetti
  sottostanti**, che taglia ciò che sta sotto col tracciato scelto, che se
  ne va;
- il sottomenu **Tracciato composto**, con **Crea** e **Rilascia**: due
  tracciati diventano uno solo, col buco dove si sovrappongono, e tornano
  separati;
- gli strumenti di precisione: **Rendi arrotondato**, **Rendi angolo**,
  **Uguaglia maniglie**, **Rimuovi punti, mantieni forma** (sui punti
  scelti), **Chiudi tracciato**, **Aggiungi punti agli incroci** (dove due
  tracciati si incrociano), **Espandi trattini in tracciati** (un tracciato
  per trattino);
- **Chiudi o unisci** della Penna intelligente.

Le file e il sottomenu sono del client (`FILE_TRACCIATO` e
`RACCOLTE_DEI_MENU` in
`apps/client/src/editors/spatial/completo/comandi.ts`); il posto
`menu/oggetto/tracciato` è nella mappa del motore.

Il buco di un tracciato composto viene dal verso dei suoi pezzi, come vuole
la regola `nonzero` di SVG: Inverti e Rilascia lo rispettano, e il file torna
uguale dopo due Inverti. Un tracciato di un altro programma con la regola
`evenodd` resta com'è: questi comandi non lo cambiano e lo dicono. Un
comando che non trova niente da fare (Dividi gli oggetti sotto senza niente
sotto, Angolo su punti già angoli) non cambia il file e lo dice. Come gli
strumenti, i comandi non toccano i tratti dell'Inchiostro: con un tratto a
mano scelto sono spenti e dicono «Un tratto dell'Inchiostro di Fub non si
cambia da qui.».

Cinque voci aprono una finestra, con l'anteprima sul foglio:

- **Sposta tracciato…**: un tracciato nuovo, parallelo, alla distanza
  scritta (un numero negativo lo porta dentro), con le giunzioni ad angolo
  vivo, arrotondate o smussate e il limite dell'angolo vivo;
- **Semplifica…**: meno punti di ancoraggio, con la soglia degli angoli e
  la scelta dei soli segmenti dritti;
- **Smussa…**: curve morbide al posto delle linee spezzate;
- **Dividi in trattini**: trattini della lunghezza scritta, con lo spazio
  fra l'uno e l'altro;
- **≡ › Oggetto › Espandi…**: il riempimento e il tratto diventano forme
  piene, su ogni oggetto scelto e non solo sui tracciati.

L'anteprima mostra i contorni nuovi mentre si cambiano i valori: parte
quando un campo prende il valore (Invio, Tab o un clic fuori), non a ogni
tasto, e non cambia il file. OK fa il comando in un passo di Annulla;
Annulla ed Esc chiudono la finestra e lasciano il file com'era. Anche qui un
tratto dell'Inchiostro scelto spegne le voci. I campi, i valori di partenza
e i limiti vengono dal motore (`FINESTRE_SCRITTE` in
`crates/fub-disegno/src/catalogo.rs`); le parole della finestra sono della
famiglia (`completo/famiglie/tracciati/testi.ts`).

**Media…** e **Media e unisci…** stanno nella prima fila di ≡ › Oggetto ›
Tracciato, dopo Unisci, e aprono anche loro una finestra:

- **Media…** porta i punti nel loro punto medio, sull'asse scelto
  (orizzontale, verticale o tutti e due). Con i punti scelti con la
  Selezione diretta muove solo quelli; senza, tutti i punti dei tracciati
  scelti. Se tutti i punti di un tracciato finirebbero in uno solo, il file
  non cambia e lo dice;
- **Media e unisci…** porta due estremi aperti nel loro punto medio e li
  unisce lì, con un angolo o un punto morbido: i due estremi scelti, o i due
  tracciati aperti scelti, o un tracciato aperto che si chiude. Altrimenti è
  spenta e dice «Scegli due tracciati aperti, o un tracciato aperto da
  chiudere.».

Le altre voci con una finestra (Pulisci, Dividi in griglia…) non ci sono
ancora: sono spente e dicono perché. Le maschere di ritaglio sono in
[Ritagli e maschere](drawing-masks.md#maschere-di-ritaglio-nel-completo).

### Elaborazione tracciati

Con due oggetti scelti o più, **≡ › Oggetto › Elaborazione tracciati** (e
la palette, `Ctrl+/`) combina le loro forme in un passo di Annulla, senza
finestre. Le voci stanno in due file:

- i **metodi forma**: **Unione**, **Meno davanti** (toglie dalla forma
  dietro quelle davanti), **Intersezione** (resta solo la parte comune),
  **Escludi** (resta tutto tranne la parte comune);
- le **operazioni**: **Dividi** (un pezzo per ogni zona), **Rifila** (toglie
  le parti coperte), **Fondi** (come Rifila, e unisce i pezzi dello stesso
  colore), **Ritaglia** (tiene ciò che sta dentro la forma davanti),
  **Contorno** (le linee dei pezzi), **Meno dietro** (toglie dalla forma
  davanti quelle dietro).

Le stesse dieci voci sono nella sezione **Elaborazione tracciati** della
scheda Design, con un oggetto scelto o più: due barre di pulsanti con le
figure, nello stesso ordine. Con un oggetto solo i pulsanti restano
raggiungibili col Tab ma sono spenti, e la nota sotto dice «Servono due
oggetti.»; le frecce si muovono fra i pulsanti di una barra.

Gli oggetti scelti se ne vanno e il risultato prende il posto del più alto,
con un id nuovo. Un metodo forma dà un tracciato solo (composto, con
la regola `nonzero`, se ha più pezzi), con lo stile della forma davanti
(della forma dietro per Meno davanti); un'operazione dà un gruppo di
tracciati. Un testo entra col contorno delle sue lettere, un gruppo con le
forme che ha. Il comando non parte, e il file non cambia, quando non
avrebbe niente di sicuro da fare:

- un oggetto bloccato nella selezione: lo dice, e chiede di sbloccarlo o di
  toglierlo;
- un'immagine, una guida, una maschera di ritaglio, un gruppo vuoto o un
  testo senza i suoi caratteri: se ne andrebbero senza entrare nel
  risultato;
- un tratto dell'Inchiostro di Fub;
- un risultato vuoto (Intersezione di due forme che non si toccano): niente
  sparisce, e lo dice.

Le voci e il pannello `pathfinder` sono nella mappa del motore
(`crates/fub-disegno/mappa.tsv`); le file del menu sono del client
(`FILE_ELABORAZIONE` in `apps/client/src/editors/spatial/completo/comandi.ts`),
la sezione è `completo/elaborazione.ts`. Trapping e Opzioni di elaborazione
non ci sono ancora: sono spente e dicono perché.

**Ripeti Elaborazione tracciati** rifà sugli oggetti scelti adesso l'ultima
voce delle due file andata a buon fine (dal menu, dalla sezione o dai
tasti), finché il disegno resta aperto nel Completo. Prima della prima è
spenta e dice «Nessuna elaborazione da ripetere: fanne prima una.». Le forme
composte non contano.

#### Forme composte

Una **forma composta** tiene i suoi oggetti e li mostra combinati: si può
cambiare il metodo o rimetterli com'erano. Si fa in due modi:

- un metodo forma con **Alt** nella sezione Elaborazione tracciati: gli
  oggetti scelti diventano una forma composta in quel metodo (il titolo del
  pulsante lo dice);
- **≡ › Oggetto › Elaborazione tracciati › Forma composta › Crea forma
  composta**, che la fa in Unione.

Con una forma composta fra gli oggetti scelti, anche sola, i metodi forma
della sezione cambiano il suo metodo invece di toglierne gli oggetti. Nel
sottomenu **Forma composta** ci sono anche **Metodo forma…** (una finestra
con il metodo: Unione, Meno davanti, Intersezione, Escludi), **Rilascia
forma composta** (rimette gli oggetti, ognuno con un id nuovo) ed **Espandi
forma composta** (lascia il tracciato che si vede). **≡ › Oggetto › Espandi
forma** fa lo stesso con una forma viva (un rettangolo arrotondato, un
poligono): diventa un tracciato semplice.

Ogni comando è un passo di Annulla. La forma composta si salva come un
gruppo col disegno già combinato e la sua ricetta (`scene-format-recipe.md`):
riaperta nel Completo resta composta, coi metodi dei suoi oggetti; il
Semplice e gli altri programmi vedono il gruppo. Un comando che non ha
niente da fare (Crea con un oggetto solo, lo stesso metodo che ha già, un
risultato vuoto) non parte e dice perché. Il motore è
`crates/fub-disegno/src/famiglie/forme.rs`; ogni elemento del gruppo salvato
ha il suo id, come vuole il formato della scena.
