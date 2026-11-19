# Le schede vive nella nota

> **Per chi:** chi mette in una nota un PDF, un foglio, un documento, un
> disegno o un file Craft.
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
immagini, i suoni, i video e le Basi, che la nota mostra già a modo suo; per ora neanche le lavagne, che restano la resa di sempre. Un embed in mezzo a una frase resta un embed.

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
- Di Notte la pagina bianca è un poco più scura, per non abbagliare.

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

## La scheda di disegno

Un disegno (`.svg`) incorporato da solo nel paragrafo è una scheda
([ADR 0248](../decisions/0248-il-disegno-nella-nota-si-modifica-sul-posto.md)).
A riposo mostra il disegno fermo, intero e al centro, come un'immagine. Da
attiva, se è un disegno fatto con Fub, si disegna **sul posto**: in una fila
sopra il foglio la penna, l'evidenziatore, la gomma, le forme, il testo, la
mano e la lente, con il menu, Annulla e Ripeti e le opzioni dello strumento;
scegliendo degli oggetti compare la barra della selezione. Il pannello delle
proprietà si apre sopra il foglio quando serve (un testo da scrivere). Si
scrive nel `.svg`, sulla stessa sessione della sua linguetta, e il
salvataggio va al disegno, mai alla nota.

- **A tutta pagina** offre il resto degli strumenti: lo spazio Completo, con
  la stessa fila.
- Nella scheda lo spazio di lavoro e la colonna scelti per i disegni non
  cambiano, «Esporta» non c'è e i pannelli non vanno nell'ispettore: per
  quelli si apre il disegno con **Apri**.
- Un SVG fatto altrove resta un'immagine ferma: si rende modificabile
  aprendolo, perché adottarlo riscrive la sua radice.
- Un disegno oltre 64 MiB resta un'immagine ferma che dice di essere troppo
  grande; uno oltre 20 MiB si apre ma si guarda soltanto, come in un
  riquadro.
- Col componente dei disegni spento la scheda resta il disegno fermo.
- Sulla lavagna un `.svg` resta una scheda d'immagine.
- Da attiva, Esc annulla prima il gesto in corso o toglie la scelta, poi esce
  dalla scheda.

La specie è `editors/core/cards/kinds/drawing.ts`, che compone la scheda
d'immagine (`kinds/image.ts`) con l'editor dei disegni compatto
(`editors/spatial/surface.ts` con `compact`, la cromatura `cardChrome` di
`editors/spatial/tools/editor/chrome/hosts.ts`).

## La zona lavagna

Una lavagna (`.canvas`) incorporata da sola nel paragrafo è una **zona
lavagna**: un pezzo di nota dove lo spazio è libero, alto quanto dice
l'embed (`![[Percorso della visita.canvas|640x300]]`). La nota resta una
colonna che si legge dall'alto in basso; posizioni, fili e tratti stanno nel
`.canvas`, la nota tiene solo l'embed.

- **A riposo** si vede tutta la lavagna, inquadrata nella zona; la testata
  dice quante schede ha. La rotella scorre la nota, un clic attiva la zona.
- **Da attiva** è la lavagna vera, sulla stessa sessione della sua
  linguetta: si spostano le schede, si tirano i fili, si scrive nelle
  schede, e la penna c'è (il tasto P e il menu radiale); scegliendo delle
  schede compare la barra della selezione. La testata, la barra dei comandi,
  la colonna degli strumenti e il navigatore non ci sono: tornano **A tutta
  pagina**. Si scrive nel `.canvas`, mai nella nota; Esc esce e la zona
  torna a mostrare tutta la lavagna.
- **«Lavagna»** nel menu «/» chiede il nome (di base «Lavagna», poi
  «Lavagna 2», …), crea una lavagna vuota accanto alla nota, scrive l'embed
  e apre la zona già attiva. Se la lavagna non si crea la nota resta
  com'era. C'è solo col componente della lavagna acceso.
- Una lavagna vuota mostra la griglia; una grandissima si guarda intera,
  rimpicciolita fino al limite dello zoom.
- Una lavagna che contiene la nota che la contiene si annida al più per tre
  livelli: oltre, la zona dice perché non si apre e offre **Apri**.
- Col componente della lavagna spento, o in una nota che si guarda soltanto,
  la zona si guarda e basta.

La specie è `editors/core/cards/kinds/canvas.ts`, che monta la superficie
della lavagna (`editors/canvas/surface.ts`) in forma compatta: due editor
dalla porta degli editor, quello di sola lettura a riposo e quello che scrive
da attiva. La pelle sta nella sezione T47 di
`theme/scrittoio/skin/live-cards.css`.

## Dalla nota alla lavagna, e ritorno

Blocchi e schede passano da una nota a una lavagna e indietro. Sono sempre
due file con **un annulla solo**: la nota e la lavagna si scrivono tutte e
due o nessuna, e l'annulla le rimette com'erano tutte e due (se uno dei due
è cambiato dopo, non tocca niente e lo dice). Andata e ritorno danno lo
stesso testo.

- **«Porta su una lavagna»** nel menu di una scheda viva (o di una scelta
  di blocchi che ne ha una), e nella palette sulla selezione o sul blocco del
  cursore, crea una lavagna accanto alla nota, col suo nome
  («Mostra.canvas», poi «Mostra 1.canvas», …), con una scheda per blocco
  nello stesso ordine, una sotto l'altra, e la apre a lato. I blocchi
  lasciano la nota.
  - Un titolo porta con sé la sua sezione, fino al titolo dopo dello stesso
    livello o più alto: è una scheda sola.
  - Una voce di primo livello di un elenco è una scheda; due voci una dopo
    l'altra tornano un elenco solo.
  - Un embed da solo nel suo blocco è una scheda di file sullo **stesso**
    file, con la parte e la misura dell'embed: niente si copia. Un embed che
    non si risolve resta una scheda di testo.
  - Il resto è una scheda di testo col suo Markdown com'è scritto.
- **Trascinare** un blocco su una lavagna aperta a lato lo porta lì, a
  destra di ciò che la lavagna ha: il riquadro si accende col bordo
  dell'accento e il cartellino dice «Porta sulla lavagna «…»». Con
  <kbd>Ctrl</kbd> al rilascio il blocco si copia e resta anche nella nota.
- **«Porta in una nota»** dalla palette, sulla lavagna aperta, fa il
  contrario: crea una nota accanto alla lavagna col suo nome, con le schede
  in colonna da in alto a sinistra a in basso a destra, e le schede lasciano
  la lavagna.
  - Le schede di un gruppo stanno insieme, sotto il nome del gruppo scritto
    come titolo.
  - Una scheda di testo dà il suo testo, una di file il suo embed, una di
    link il suo indirizzo.
  - I fili diventano link, in una riga `→ …` sotto la scheda da cui partono:
    verso una scheda di testo un link al blocco (`[[#^id]]`, che le dà l'id
    se non ce l'ha), verso un file un link al file, verso un gruppo un link
    al suo titolo. L'etichetta del filo è il testo del link.
- Se la nota o la lavagna è cambiata da quando si sono scelti i blocchi o le
  schede, non si muove niente e si dice di sceglierli di nuovo.

I comandi sono `canvas.from_note` e `canvas.to_note` di
`crates/fub-features/src/lavagna/note.rs`: le regole stanno lì, e i
parametri `to`, `at`, `keep` (lasciare dove stava: la copia) e `base` li
rendono usabili anche da un plugin o da un agente. Il client chiede il
primo dal menu e dal trascinamento (`blocks/to-board.ts`,
`state/board-from-note.ts`); le lavagne a lato le offre il controllore dei
documenti come bersagli (`SurfaceBoardOffer` in `editors/core/registry.ts`).

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

## Un valore nel testo

`![[Conti.xlsx#Budget!C7]]` in mezzo a una frase non è una scheda: è il
valore della cella, col formato del foglio («2.520 €»), sottolineato da un
tratteggio d'accento. La parte è una cella sola, col foglio
(`Budget!C7`, `'Conti 2025'!$B$2`) o senza (`C7`, sul foglio attivo); un
intervallo, un nome o un foglio intero restano la scheda.

- **Il clic** apre il foglio nella sua linguetta, sulla cella. Il cursore che
  arriva con le frecce mostra l'embed scritto, come per un'immagine.
- **Segue il file**: quando il foglio cambia (salvato da Fub, da un'altra
  app, rinominato o tolto) il valore si rilegge, per evento e mai a tempo.
  Il valore è quello salvato nel file: aprire la nota non ricalcola e non
  scrive; un valore che Fub non ha ricalcolato lo dice al passaggio.
- **I casi limite**: una cella vuota mostra «—»; un errore di formula il suo
  segno (`#DIV/0!`) nel colore dell'errore; un file mancante o una cella che
  non c'è il riferimento («Conti.xlsx › Budget!C7»), nel colore dell'errore,
  e il perché al passaggio.
- **In Lettura** il valore è testo come il resto, senza tratteggio.
- **Da solo nel paragrafo** l'embed di una cella è la scheda di foglio. Il
  menu della scheda, **Mostra come → Valore nel testo**, scrive `|value`
  (`![[Conti.xlsx#Budget!C7|value]]`) e il valore resta in riga; **Scheda**
  lo toglie.

I valori di una nota si leggono insieme: un'apertura di sola lettura per
file, una finestra per blocco della griglia, un ascolto per file. Il lettore
è `apps/client/src/editors/grid/cell-reader.ts` (la stessa porta della
scheda di foglio, con `fub.part`); il widget, l'elenco dei valori e la resa
in Lettura sono `apps/client/src/editors/text/profiles/markdown/cell-value.ts`.
Cento valori in una nota non pesano sulla battuta: lo misura la nota
`battuta-valori-100` di `node bench/interaction.mjs --only=battuta`.

## I grafici

**Il grafico di un foglio.** `![[Conti.xlsx#Grafico spese]]` da solo nel
paragrafo mostra il grafico che nel file ha il titolo «Grafico spese»: lo
disegna GridCraft, lo stesso SVG del foglio aperto, intero e nella sua
proporzione (nella nota la scheda è alta quanto la proporzione chiede alla
sua larghezza). Il titolo si confronta senza badare alle maiuscole né agli
spazi; un foglio, un nome definito o una tabella con lo stesso nome vengono
prima. Un grafico senza titolo non si può nominare: il nome che Excel dà
alla cornice («Grafico 4») non arriva a Fub.

- **Segue i dati**: quando il foglio cambia la scheda riapre la cartella e il
  disegno si rifà sui valori salvati, per evento e mai a tempo.
- Un grafico non ha celle: la scheda non si attiva e non si scrive. Il
  grafico si cambia nel foglio aperto, con **Apri**.
- Un titolo che il file non ha dice «Intervallo non trovato», e **Scegli di
  nuovo** elenca anche i grafici della cartella («Grafico Vendite»). Un
  grafico che il file ha ma che non si disegna (oltre la misura di una
  finestra) dice «Il grafico non si può disegnare qui: aprilo nel foglio»,
  con **Apri**.

`fub.part` risponde, per un grafico, `{found: true, kind: "chart", sheet,
range, chart}`: `range` sono le celle che il grafico copre, `chart` il suo id
nel file. La scheda legge la finestra di quelle celle e ne mostra soltanto
il disegno del grafico (`objects` della finestra). I grafici come parti sono
`chart_named` in `crates/fub-format-xlsx/src/objects.rs`.

**Il grafico da una tabella.** Nel menu di una tabella Markdown (il tasto
destro su una cella), **Grafico da questa tabella** scrive sotto la tabella
un recinto Mermaid normale coi valori di adesso: una torta (`pie`) per una
sola colonna di numeri, al più otto righe, tutte piene e mai negative;
altrimenti le barre di `xychart-beta`, e una linea per colonna quando le
colonne di numeri sono più d'una. Le etichette sono la prima colonna che non
è di numeri.

- **Non è un grafico vivo**, e lo dice: un commento `%%` dentro il recinto
  porta la data dei valori, e l'avviso lo ripete. Sulla stessa tabella la
  voce diventa **Rigenera il grafico dalla tabella** e riscrive il recinto al
  suo posto (lo ritrova dal segno `%% fub:table-chart`, subito sotto la
  tabella); un recinto scritto a mano non si tocca. Un passo d'annullamento.
- Una colonna è di numeri se ogni sua cella piena è un numero, letto nella
  lingua della nota come la somma della banda: «1.240,50 €» in italiano,
  `(120)` negativo, «12,5%» si disegna 12,5. Una cella barrata non conta.
- Una tabella senza numeri, o in una nota di sola lettura, non ha la voce.

Il recinto lo fa `apps/client/src/editors/text/profiles/markdown/table-chart.ts`;
la voce sta nel menu di `table-grid.ts`, la scrittura in `table-widget.ts`.

Le scene `grafici-*` del banco (`live=grafici&workbook=1`) mostrano il grafico
del foglio, quello che il file non ha, la torta scritta da una tabella e il
menu con la voce.

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
