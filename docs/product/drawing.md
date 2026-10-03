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
