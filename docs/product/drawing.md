# Disegni

> **Per chi:** chi disegna in un vault, o ne apre i disegni.
> **Risultato:** sapere come si apre, si modifica e si legge un file `.svg`, e
> che cosa resta del file dopo una modifica.

## Un disegno è un file SVG

Con la feature `draw` dell'host un file `.svg` ha il formato `svg` e si apre
come disegno: il profilo `vector` della famiglia `canvas`
(`apps/client/src/editors/spatial/surface.ts`). Senza la feature il file resta
testo con l'anteprima accanto, come descrive
[Editor e anteprima](editor-and-preview.md).

Il codice dell'editor si scarica la prima volta che un disegno si apre, e non
pesa su chi non ne apre. Se non arriva, il riquadro lo dice, e «Apri come
sorgente» mostra comunque il testo
(`apps/client/src/editors/spatial/lazy.ts`).

Il file resta un SVG che qualunque browser o editor apre. I dati che servono a
Fub stanno in pochi attributi del namespace `fub`; la forma esatta è nel
[formato della scena](../reference/scene-format.md), le modifiche che il
disegno ci scrive nelle [operazioni sulla scena](../reference/scene-operations.md),
il perché nell'[ADR 0203](../decisions/0203-superfici-spaziali.md).

## Modalità

Il disegno offre due modalità:

- **Disegno**, la predefinita: la barra degli strumenti e il foglio. Proietta
  sul ruolo `live_preview`, quindi il comando Live la raggiunge.
- **Lettura**: il documento intero come immagine, con lo zoom del visore.
  Proietta su `reading`, e `Mod-E` passa dall'una all'altra.

Il ruolo `source` non c'è: il testo del disegno si apre con «Apri come
sorgente». Il riquadro ricorda la modalità del disegno come quella di ogni
altra famiglia.

In Lettura il file non entra mai nel DOM della shell: è un `<img>` da un blob,
che non esegue script e non carica risorse. Se il disegno ha un titolo,
l'immagine si chiama col titolo; altrimenti col nome del file. Sotto
l'immagine ci sono la descrizione del disegno, che l'immagine annuncia come
sua, e «Oggetti del disegno», l'elenco degli oggetti in albero: chiuso finché
non lo si apre, e costruito soltanto allora.

## Disegnare

Il livello Essenziale ha sette strumenti, ciascuno con un tasto: selezione
(`V`), penna (`P`), gomma per oggetto (`E`), rettangolo (`R`), ellisse (`O`),
linea (`L`) e freccia (`A`). I colori sono gli otto della tavolozza di
Okabe–Ito, ognuno con una forma nel suo campione, così non si distinguono solo
dal colore; gli spessori sono tre. Il campo «Che cosa hai disegnato?» scrive il
titolo del disegno.

La barra è un solo punto di tabulazione e si percorre con le frecce. Tasto
centrale, due dita e rotella muovono la vista. Ogni gesto si annuncia a chi
usa un lettore di schermo.

## Il livello Standard

L'editor ha più livelli d'interfaccia: l'Essenziale, quello di partenza, e lo
Standard, che aggiunge strumenti alla stessa barra. Il livello filtra soltanto
ciò che si offre: un disegno si apre uguale a ogni livello, e cambiare livello
non lo modifica. Cambia dal vivo, senza riaprire il disegno e senza perdere la
selezione o la cronologia; chi monta l'editor lo sceglie con `level` e
`setLevel` (`apps/client/src/editors/spatial/tools/editor.ts`).

Lo Standard aggiunge:

- l'**evidenziatore** (`H`), dopo la penna: un tratto largo, di spessore
  costante e con le punte piatte, che lascia vedere ciò che copre. Si scrive
  come un tratto a penna, con `fub:tool="highlighter"` e
  `fill-opacity="0.4"`. Parte giallo e ha colore e spessori suoi, 8, 16 e 24
  unità, e la penna ritrova i propri quando la si riprende;
- **«Altro colore…»**, dopo la tavolozza: un codice come `#3a7bd5`, anche di
  tre cifre o senza `#`, oppure il selettore del sistema accanto. Il colore
  scelto resta come campione in più, un anello che ha per nome il suo codice;
  se sulla carta bianca sta sotto il contrasto 3:1, il nome lo dice.

Tornati all'Essenziale, ciò che lo Standard aggiunge sparisce dalla barra:
chi aveva in mano l'evidenziatore riprende la penna, e un colore a piacere
torna al colore di partenza.

## Disporre

Dal livello Standard, finché c'è qualcosa di scelto, in cima al foglio
galleggia la barra «Disponi»: compare senza spostare il foglio, `Alt+F10` ci
porta il fuoco ed `Esc` lo riporta al foglio. Ogni comando è un passo di
annulla, e la selezione segue ciò che ha fatto.

- **Duplica** (`Ctrl+D`) mette le copie sopra gli originali, 24 pixel più in
  basso a destra, con id nuovi; la selezione passa alle copie, e un secondo
  `Ctrl+D` prosegue la fila.
- **Raggruppa** (`Ctrl+G`) mette due o più oggetti in un gruppo nuovo, al
  posto del più alto; un oggetto di un livello trasformato vi entra con la
  trasformazione che lo lascia dov'era. **Separa** (`Ctrl+Maiusc+G`) porta i
  figli al posto del gruppo, ciascuno con la trasformazione del gruppo, con lo
  stile che ne ereditava e con l'opacità moltiplicata dalla sua. Il titolo e
  la descrizione del gruppo se ne vanno con lui.
- **Ordine** porta in primo piano (`Ctrl+Maiusc+]`), avanti di un posto
  (`Ctrl+]`), indietro di un posto (`Ctrl+[`) o in secondo piano
  (`Ctrl+Maiusc+[`), nel livello di ciascun oggetto. Sul foglio fanno lo
  stesso `PagSu` e `PagGiù`, con `Maiusc` agli estremi. Le parentesi valgono
  per posizione: su una tastiera italiana sono `è` e `+`. Il menu spegne la
  voce che non cambierebbe niente.
- **Allinea e distribuisci** allinea i bordi o i centri della selezione al
  suo riquadro, o alla pagina se l'oggetto è uno solo; distribuire lascia
  fermi il primo e l'ultimo e mette spazi uguali fra tre o più oggetti.

Ordine, gruppi e separazione spostano gli elementi del file come sono
scritti; solo ciò che cambia davvero, come la trasformazione di un figlio,
si riscrive. Una parte che FubDraw non sa scrivere, come un `<use>` di un
altro programma, non si copia, e un gruppo che la contiene si separa solo se
non ha niente da portarle.

## Da tastiera

Ogni strumento funziona senza puntatore. Sul foglio le frecce muovono un
cursore, 10 pixel per volta, 50 con `Maiusc` e 1 con `Ctrl` o `⌘`; `Spazio`
preme e, di nuovo, rilascia, e `Invio` rilascia anche lui. In mezzo il cursore
traccia: un rettangolo, un tratto a penna, la gomma su ciò che attraversa, un
trascinamento con la selezione. `Esc` annulla il gesto. Il cursore dice dove
si trova e che cosa c'è sotto, per esempio «x 120, y 80: Rettangolo, Blu».

Con una selezione le frecce la spostano di 1, 10 con `Maiusc`, e con `Ctrl` o
`⌘` la ridimensionano dall'angolo in alto a sinistra. `Tab` e `Maiusc+Tab`
passano all'oggetto dopo e a quello prima, e lo dicono col nome e la
posizione; oltre l'ultimo il fuoco esce dal foglio, che non lo trattiene mai.
`Home` e `Fine` scelgono il primo e l'ultimo oggetto. `Invio` apre posizione e
misure della selezione, da scrivere coi numeri; senza selezione apre le
proprietà del disegno: titolo, descrizione e misure della pagina. `?` elenca
tutti i tasti.

Ridimensionare scrive un `transform`: anche lo spessore del contorno segue la
scala, e il riquadro che si chiede è quello che l'oggetto occupa.

«Oggetti», nella barra, apre accanto al foglio l'albero degli oggetti: i
livelli e i loro oggetti, con la stessa selezione del foglio. Le frecce
scelgono la riga a cui arrivano, `Ctrl` o `⌘` le fanno soltanto arrivare,
`Spazio` aggiunge o toglie, `Invio` apre le proprietà, `Canc` elimina ed `Esc`
torna al foglio. Un oggetto di un livello bloccato o nascosto c'è, in corsivo,
ma non si sceglie. Oltre 500 righe l'albero disegna soltanto quelle che si
vedono.

La scelta non si legge mai dal solo colore: lo strumento, il colore e lo
spessore scelti hanno un filo sotto, le righe scelte la spunta. La vista non
si anima: ogni inquadratura è subito quella nuova, quindi non c'è moto da
ridurre.

## Immagini

Un'immagine incollata con `Ctrl+V` o `⌘V`, o un file lasciato sul foglio,
entra nel disegno come `<image>` con i byte nell'attributo `href`, in un data
URI: il file resta uno solo, e si apre uguale su un altro computer. Entrano
PNG, JPEG, GIF e WebP così come sono; un altro formato che il browser sa
leggere diventa PNG, e un JPEG girato dall'EXIF si ricodifica diritto, perché
non tutti i programmi che leggono un SVG seguono l'EXIF. Un SVG non entra come
immagine.

L'immagine va dove sono il puntatore o il cursore, se sono nella vista, e
altrimenti al centro della vista. Ogni pixel misura un'unità, finché
l'immagine non supera i quattro quinti della vista: allora si rimpicciolisce
fino a starci. Più immagini insieme si dispongono a scala, sono un passo solo
di annulla, e restano scelte con lo strumento selezione.

Un'immagine pesa al più 5 MiB, e quelle incollate insieme se li dividono.
Oltre, la finestra propone di ridurle: una foto senza trasparenza diventa
JPEG, una con la trasparenza resta PNG e perde pixel, e sul foglio la misura
resta la stessa. Una GIF ridotta perde l'animazione. Un disegno vicino al
limite oltre il quale si aprirebbe in sola lettura riceve soltanto le immagini
che ci stanno.

## Documenti che non si modificano subito

La modalità del riquadro non cambia con il documento: è il disegno a dire
perché non si modifica, in un avviso in cima.

- **SVG estraneo.** Un file senza `fub:version` sulla radice, per esempio un
  logo esportato da un altro programma, si mostra come immagine del documento
  intero. «Modifica» lo adotta: aggiunge `xmlns:fub` e `fub:version` alla
  radice e lascia il resto com'è. L'adozione è un passo di annulla; annullarla
  riporta all'immagine.
- **Sola lettura.** Una dichiarazione DOCTYPE, una codifica diversa da UTF-8,
  una versione non valida o più recente, due elementi con lo stesso id, un file
  oltre i limiti dell'editor (`MAX_EDIT_BYTES` e `MAX_ELEMENTS` in
  `apps/client/src/editors/spatial/scene/read.ts`): il disegno si guarda come
  immagine, e l'avviso dice il motivo.
- **Illeggibile.** Un file che non è XML ben formato, con il byte dell'errore,
  o la cui radice non è `svg`: l'avviso dice il motivo e non mostra altro.

In tutti e tre i casi «Apri come sorgente» mostra il testo, per correggerlo.

## Apri come sorgente

«Apri come sorgente», nella palette e nel menu del riquadro, mostra lo stesso
documento come testo SVG, con l'anteprima accanto. È la stessa sessione: le
modifiche non salvate restano e il disco non si rilegge. «Chiudi la vista
sorgente» torna al disegno.

La scelta è della linguetta. Resta salvata con il layout dopo un riavvio, e non
passa alle altre linguette: un altro disegno aperto nello stesso riquadro si
apre come disegno.

## Più riquadri sullo stesso disegno

Due riquadri possono mostrare lo stesso disegno, anche uno come disegno e uno
come testo. Ogni gesto arriva agli altri riquadri senza ricaricare, e una
modifica fatta nel testo si vede subito nel disegno. Ogni riquadro annulla
soltanto i suoi gesti; un testo arrivato da fuori, da un altro riquadro o dal
disco, ricostruisce il disegno senza svuotarne la cronologia.

## Il file su disco

Un gesto è una modifica del testo, non una riscrittura del file. Il resto del
documento resta identico byte per byte: commenti, attributi di altri
programmi, blocchi che Fub non sa modificare e i terminatori delle righe non
toccate, anche quando il file mescola CRLF e LF.

## Selezione e rimandi

Gli oggetti scelti sono, per la shell, gli intervalli del file che li
contengono: le funzioni che lavorano sulla selezione ricevono il testo dei
loro elementi. Un rimando a un punto del file, per esempio da un risultato di
ricerca, sceglie l'oggetto che lo contiene e lo porta in vista; un punto fuori
dagli oggetti, come il titolo, lo dice con un avviso. In Lettura non c'è
selezione.
