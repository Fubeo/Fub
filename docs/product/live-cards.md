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
modo suo; per ora neanche i documenti di Word e le lavagne, che restano la
resa di sempre. Un embed in mezzo a una frase resta un embed.

## Tre stati

- **A riposo**: la scheda si vede e basta. La rotella scorre la nota, mai la
  scheda; niente si calcola o si scrive da solo.
- **Scelta**: un clic sulla testata, o le frecce coi Blocchi accesi, la
  scelgono come ogni blocco. **Invio** la attiva; **Canc** toglie l'embed
  dalla nota, mai il file.
- **Attiva**: un clic dentro, Invio, o un tocco. Il bordo è d'accento e la
  testata dice «Esc per uscire» (al tocco c'è **Fine**). Tasti, rotella e
  selezione sono della scheda; la riga dei suggerimenti dice i suoi tasti.
  **Esc** esce e la lascia scelta; un clic fuori esce. Una sola scheda è
  attiva alla volta.

Dove la specie sa scrivere (un foglio), da attiva si scrive nel suo file, con
la sua barra sotto la testata. L'annulla dentro la scheda attiva è del file
della scheda; fuori, è della nota. In una nota in sola lettura le schede si
guardano e si attivano, ma non si scrive.

Il gruppo **Scheda** del menu del blocco ha **Apri**, **Attiva** e **Togli
dalla nota**.

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
