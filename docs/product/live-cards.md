# Le schede vive nella nota

> **Per chi:** chi mette in una nota un PDF, un foglio o un file Craft.
> **Risultato:** sapere come si guarda e come si usa il file dentro la nota,
> che cosa succede ai tasti e all'annulla, e che cosa si vede quando il file
> manca.

## Che cosa si vede

Un file incorporato da solo nel suo paragrafo (`![[Contratto.pdf#page=3]]`,
`![[Conti.xlsx]]`) si mostra in Scrittura con la **scheda della lavagna**: le
stesse specie, la stessa resa, lo stesso modo di scrivere dentro. In testata
l'icona della specie, il nome del file e la parte mostrata («p. 3»); al
passaggio, da attiva e al tocco **Apri** (il file nella sua linguetta, alla
parte) e **A tutta pagina** (la scheda alta quanto la vista; «Torna alla nota»
la riporta com'era).

Non sono schede le note (la [trasclusione viva](editor-transclusion.md)), le
immagini, i suoni, i video, le Basi e i disegni SVG, che la nota mostra già a
modo suo; per ora neanche le lavagne, che restano la resa di sempre. Un embed in mezzo a una frase resta un embed.

## Tre stati

- **A riposo**: la scheda si vede e basta. La rotella scorre la nota, mai la
  scheda; niente si calcola o si scrive da solo.
- **Scelta**: un clic sulla testata, o le frecce coi Blocchi accesi, la
  scelgono come ogni blocco. **Invio** la attiva; **Canc** toglie l'embed
  dalla nota, mai il file. Scelta è un oggetto, non testo: niente mini-barra
  del testo sopra di lei (`objectsChosen` in `markdown/live-cards.ts`, letto
  da `selectionBox` della superficie). Le colonne con dentro delle schede,
  scelte, restano rese. Un secondo **Esc** torna al testo col cursore nella
  riga dopo la scheda (o in quella prima, se è l'ultima), e la scheda resta
  scheda.
- **Attiva**: un clic dentro, Invio, o un tocco. Il bordo è d'accento e la
  testata dice «Esc per uscire» (al tocco c'è **Fine**). Tasti, rotella e
  selezione sono della scheda; la riga dei suggerimenti dice i suoi tasti.
  **Esc** esce e la lascia scelta; un clic fuori esce. Una sola scheda è
  attiva alla volta.

Dove la specie sa scrivere (un foglio), da attiva si scrive nel suo file, con
la sua barra sotto la testata. L'annulla dentro la scheda attiva è del file
della scheda; fuori, è della nota. In una nota in sola lettura le schede si
guardano e si attivano, ma non si scrive.

Il gruppo **Scheda** del menu del blocco ha **Apri**, **Attiva**, **Mostra
come**, **Larghezza**, **Affianca** e **Togli dalla nota** (le voci che
cambiano la nota solo dove si scrive).

## Misura, «Mostra come», affiancare

La misura sta nell'embed, scritta come la capisce Obsidian:
`![[Conti.xlsx|640x300]]` (larghezza e altezza in px) o `![[Conti.xlsx|640]]`
(solo la larghezza). Una misura assurda (`|0x0`) non conta, e una fuori dai
limiti si porta dentro (da 160 px di larghezza, da 120 a 2400 di altezza). Le
immagini tengono la misura di sempre: non sono schede.

- **Larghezza**: la colonna del testo; **Larga**, 64 px oltre a destra, come
  la Base; **Tutta la pagina**, 64 px anche a sinistra. Quando la finestra è
  stretta (sotto 1180 px, poi sotto 940) la scheda torna nella colonna.
- **Altezza**: quella della specie; si cambia trascinando il bordo in basso
  (o, col fuoco sul bordo, con le frecce). Esc durante il trascinamento la
  riporta com'era; al rilascio la nota scrive la misura, un passo
  d'annullamento. **Altezza normale** la toglie.
- **Mostra come**: **Scheda**; **Link**, che diventa `[[Conti.xlsx]]`;
  **Riga**, solo icona e nome (`![[Conti.xlsx|row]]`).
- **Affianca**: la scheda va accanto a quella subito sotto (o sopra) in un
  riquadro `[!columns]`, da due a quattro colonne; lo stesso trascinando una
  scheda accanto a un'altra. Con quattro colonne la voce è spenta e dice
  perché. Le schede nelle colonne sono vive come le altre; togliendone una
  resta la colonna dell'altra, e con una sola si torna all'embed da solo. Sul
  telefono le colonne stanno una sotto l'altra.

## La scheda PDF

Un PDF mostra una pagina intera, in alto al centro sulla carta della scheda,
e sotto «2 / 6»: la pagina e quante sono. La pagina di partenza è la parte
dell'embed (`![[Contratto.pdf#page=3]]`); senza parte, o con una pagina oltre
la fine, è la prima. La testata dice sempre la pagina in vista («p. 3»).

- **Sfogliare**: al passaggio e da attiva compaiono **‹** e **›** accanto al
  numero; da attiva anche **PgSu**, **PgGiù**, le frecce a sinistra e a
  destra, **Home** e **Fine**. La riga dei suggerimenti lo ricorda.
- **Scegliere il testo**: da attiva il testo della pagina si sceglie col
  puntatore e si copia, come in un visore. A riposo il clic attiva la scheda.
- **Stato della vista**: la pagina dove sei non si scrive da nessuna parte.
  L'embed resta com'era (`#page=3` è la pagina di partenza), e il PDF non
  cambia. Finché la nota è aperta la scheda ricorda la pagina: uscita dalla
  vista e tornata, riparte da lì.
- Un PDF protetto da una password dice che Fub non lo apre, col suo nome;
  un PDF rotto dice che non si può mostrare. Un PDF di mille pagine ne
  disegna una sola, quella in vista.

## La scheda di documento

Un documento (`.docx`, `.odt`) incorporato da solo nel paragrafo è una scheda
anche lui. A riposo mostra il testo reso in continuo, senza pagine, nel
carattere di lettura: titoli, paragrafi, elenchi e tabelle. Da attiva si
scrive **nel documento**, con l'editor dei documenti in Scrittura (compatto:
senza barra delle pagine né pannello) sulla stessa sessione della sua
linguetta; stili e impaginazione restano quelli del file, e il salvataggio va
al documento, mai alla nota. La barra della scheda è quella dei documenti.

- Una parte (`![[Relazione.docx#Bilancio]]`) resta scritta nell'embed e nella
  testata, ma la scheda mostra il documento intero: il modello dei documenti
  non tiene le posizioni dei titoli, e una sezione non si ritaglia.
- Un documento lungo si ferma a 200 blocchi: in fondo «Il documento continua»,
  con **Apri**.
- Sulla lavagna la scheda di documento si guarda e non si scrive.
- Da attiva, Esc chiude prima ciò che l'editor dei documenti ha aperto (il
  pennello, il taglio fra le celle), poi esce dalla scheda
  (`escapePassesThrough` in `editors/rich/engine.ts`).

La specie è `editors/core/cards/kinds/document.ts`, che riusa il corpo della
scheda di nota (`kinds/note.ts`) con l'editor compatto dei documenti.

## Il foglio nella nota

`![[Conti.xlsx#Budget!A1:E7]]` mostra soltanto quella parte del foglio. La
parte può essere un intervallo (`Budget!A1:E7`, o `A1:E7` sul foglio attivo),
un nome definito della cartella, una tabella o un foglio intero; senza parte
si vede il foglio attivo dalla sua prima cella usata. Solo un nome o una
tabella seguono un intervallo che cresce: un intervallo scritto resta quello.

- **A riposo** si vedono i valori salvati nel file: aprire la nota non
  ricalcola e non scrive. Un valore che Fub non ha ricalcolato ha il filo a
  puntini del foglio. La scheda è alta quanto le righe della parte (oltre
  sedici righe si scorre dentro), senza lettere né numeri.
- **Da attiva** compaiono le lettere delle colonne e i numeri delle righe, e
  si scrive nelle celle come nel foglio: Invio, F2, il doppio clic o un
  carattere aprono la cella, la selezione si copia con Ctrl+C come testo a
  tabulazioni. Confermata la cella, il foglio ricalcola e il file si salva.
  La griglia comincia dalla prima cella della parte. Il gruppo **Foglio**
  della barra di formato dice la cella attiva e la sua formula, e ha
  **Apri**. Righe, colonne, formati e grafici si cambiano nel foglio aperto.
- Una parte che non c'è più dice «Intervallo non trovato: Budget!A1:E7»;
  **Scegli di nuovo** elenca i fogli, i nomi e le tabelle della cartella e
  riscrive la parte nell'embed (un passo d'annullamento). In sola lettura il
  pulsante non c'è.

La parte la trova il provider del foglio col comando composto `fub.part`
(`{part?: "Budget!A1:E7"}`, `crates/fub-format-xlsx/src/parts.rs`), che legge
la cartella mostrata e basta: niente facciata, giornale e revisione come
prima. Risponde `{found: true, kind, sheet, range}` con l'id del foglio della
sessione, o `{found: false, parts}` con i fogli visibili, i nomi e le tabelle;
un nome definito vale se è un solo rettangolo. La scheda lo chiede a ogni
apertura della sua sessione: è `apps/client/src/editors/grid/card.ts`. Venti
fogli vivi in una nota non pesano sulla battuta: lo misura la nota
`battuta-schede-20` di `node bench/interaction.mjs --only=battuta`.

## I limiti

- Fuori dalla vista le schede sono immagini ferme; vive ce ne sono al più
  quante ne tiene la lavagna, le più vicine al centro, e quella attiva sempre.
- Un file che non c'è dice «File mancante: …», con **Ritrova…** (un file del
  vault al suo posto: l'embed lo nomina, con la parte e il testo dopo la
  barra) e **Togli dalla nota**.
- Un formato senza vista (un componente spento, un plugin che manca) dice la
  specie e il percorso, con **Apri**.
- Il file è lo stesso che si apre nella sua linguetta: le modifiche fatte da
  una parte si vedono dall'altra, anche quelle non ancora salvate.

## Dove sta

L'ospite è `apps/client/src/editors/text/profiles/markdown/live-cards.ts`, che
monta le specie di `editors/core/cards/` come widget di blocco; arriva con un
`import()` alla prima scheda, mai all'apertura dell'app. Il file Markdown non
cambia: l'embed si legge e si scrive com'è.

La scheda PDF è quella della lavagna (`editors/core/cards/kinds/pdf.ts`). Il
testo della pagina in vista lo stende pdf.js (`renderText` del motore in
`editors/media/pdf-view.ts`) in uno strato trasparente sopra la pagina,
`canvas-card-pdf-text`, quando il puntatore o il fuoco arrivano sulla scheda;
si sceglie solo nella scheda attiva della nota, e sulla lavagna resta inerte.
La pagina ricordata sta nell'ospite della superficie (`LiveCards`), per file
e parte, e se ne va con la nota.
