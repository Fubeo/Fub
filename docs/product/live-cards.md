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

## I limiti

- Fuori dalla vista le schede sono immagini ferme; vive ce ne sono al più
  quante ne tiene la lavagna, le più vicine al centro, e quella attiva sempre.
- Un file che non c'è dice «File mancante: …», con **Ritrova…** (un file del
  vault al suo posto: l'embed lo nomina, con la parte e il testo dopo la
  barra) e **Togli dalla nota**.
- Un formato senza vista (un componente spento, un plugin che manca) dice la
  specie e il percorso, con **Apri**.
- Il file è lo stesso che si apre nella sua linguetta: le modifiche fatte da
  una parte si vedono dall'altra.

## Dove sta

L'ospite è `apps/client/src/editors/text/profiles/markdown/live-cards.ts`, che
monta le specie di `editors/core/cards/` come widget di blocco; arriva con un
`import()` alla prima scheda, mai all'apertura dell'app. Il file Markdown non
cambia: l'embed si legge e si scrive com'è.
