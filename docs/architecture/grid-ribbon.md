# Barra multifunzione dei fogli

> **Domanda:** come la cartella mostra e dà i suoi comandi nella barra
> multifunzione, in «Comandi» e nel menu del tasto destro?
> **Fonti autorevoli:** `apps/client/src/editors/grid/ribbon/`,
> `apps/client/src/editors/grid/menu-comandi.ts`, `apps/client/src/kit/ribbon/`.
> **Decisioni:** [ADR 0219](../decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md).

Il resto della superficie (griglia, celle, selezione, appunti, finestre,
tavolozza, oggetti, stampa) è nella [superficie dei fogli](grid-surface.md).

## La barra

Sopra la barra della formula di una cartella a comandi sta la barra
multifunzione (`apps/client/src/editors/grid/ribbon/`), che il bootstrap
carica a parte. La barra è quella del kit (`kit/ribbon/`); la griglia le dà
la sua vista, le sue schede e le due specie di controllo sue, la tavolozza e
le gallerie. `tabs.ts` descrive schede, gruppi e controlli (pulsanti,
pulsanti divisi, menu, colori, elenchi, caselle, gallerie, campi); ogni
controllo nomina un id del catalogo del provider, e la barra mostra
soltanto quelli che il catalogo serve, spegne quelli spenti con il motivo
nel suggerimento e dà il comando con i parametri della facciata. Lo stato
viene dallo stile della cella attiva, dalle tabelle e dalla vista del foglio
e dal libro della cartella; la scheda della tabella compare con la selezione
dentro una tabella. La tavolozza disegna i colori del tema con le sfumature
di ECMA-376 (`palette.ts`), le gallerie gli stili di tabella e di cella.

La forma e la pelle della barra sono del kit: ogni pezzo porta
`kit-ribbon-<pezzo>` accanto a `grid-ribbon-<pezzo>`, vestito da
`structure.css` e da «Barra a schede» in `skin/kit.css` (sezioni come le
schede dell'ispettore, vassoio `--bar-tray`), che vengono prima; ai
`.grid-ribbon-…` restano tavolozza, gallerie, campioni, «Comandi» e i piani
della formula e della griglia.

La barra si percorre con le frecce (un solo controllo per scheda sta nel
Tab), Esc torna alla griglia, Alt o F10 mostrano le lettere di Excel. Quando
la barra è stretta i pulsanti piccoli perdono il nome, poi i gruppi si
raccolgono da destra in un pulsante col disegno e il nome: due raccolti di
fila stanno a pila, uno rimasto solo è alto quanto un foglietto aperto. Nei
fogli il gruppo raccolto si apre sul posto, nella barra (l'opzione
`openInPlace` del kit): clic, Invio, Spazio, ↓ o la sua lettera di Alt lo
aprono col fuoco sul primo comando, gli altri si raccolgono per fargli
posto, e se nemmeno così la fila ci sta i pulsanti perdono il nome
(`data-dense`). Ne è aperto uno alla volta; Esc lo richiude e torna al suo
pulsante, un secondo Esc torna alla griglia, e una scheda cambiata o una
larghezza che basta a tutti lo richiudono. Il testo della barra è in un
catalogo suo (`strings.ts`), in italiano e in inglese.

Nei fogli la barra si muove (l'opzione `motion` del kit, che soltanto la
griglia accende; il padrone è `kit/ribbon/ribbon-motion.ts`, con `moto/`):
i foglietti di una sezione nuova entrano uno dopo l'altro dal suo verso,
Ctrl+F1 ritira il vassoio, che svanisce mentre la formula e la griglia gli
salgono sopra come una tenda (e ridiscendono riaprendolo; durante la corsa
la griglia tiene la sua altezza e passa sotto la barra dei fogli, così il
bordo di sotto non salta, e la rende a corsa finita), il foglietto che
si apre sul posto si alza di un gradino e gli altri scivolano, e la scheda
della tabella compare e svanisce con la selezione. Un gesto nuovo a metà
corsa riparte da posa e velocità correnti; ciò che cambia forma o se ne va
mentre era ancora in corsa lascia un'immagine che svanisce da dove si
vedeva. Con «ridotto» resta soltanto la dissolvenza del vassoio che torna.

Il primo pulsante della fila dell'accesso rapido, prima delle schede, è
«Comandi» (`editors/grid/menu-comandi.ts`): un gettone pieno, con
`aria-haspopup="menu"` e `aria-expanded`, che clic, Invio, Spazio, ↓ o Alt e
poi C aprono, ed Esc richiude rendendogli il fuoco. Apre un menu di Fub
(`ui/menu.ts`) con tutti i comandi della cartella, nell'ordine delle schede
del catalogo: in ogni gruppo prima i controlli della barra, con le loro voci,
spunte e scelte, poi «Altri comandi del gruppo», quelli del catalogo che la
barra non mostra, dati come li dà la tavolozza. Le schede contestuali
(tabella, grafico, oggetto, tabella pivot) stanno sotto «Per ciò che hai
selezionato»: accese col nome di ciò che è selezionato («Tabella «Vendite»»),
altrimenti coi controlli della barra spenti e il perché
(`fogli.motivo.context.*`). Una voce spenta dice il suo motivo: la sola
lettura per i comandi che cambiano, il contesto che manca, o quello del
motore. Lo stato si legge all'apertura e, a menu aperto, ogni rilettura della
barra aggiorna le voci; la cartella che non dà più comandi chiude il menu.
Scrivendo si cerca in tutte le voci, anche nei sottomenu chiusi, col
percorso, senza tetto (l'opzione `fullSearch` del menu): prima le accese,
poi le spente col perché, e il piede conta le voci. Sotto i 560 px del foglio
il gettone perde il nome, che resta nel suggerimento e nel nome accessibile.

Il tasto destro sceglie come Excel: fuori dalla selezione sceglie la cella,
la riga o la colonna sotto il puntatore, dentro la lascia. `ribbon/context.ts`
dichiara le voci per cella, intestazione di riga e di colonna, angolo,
scheda del foglio e oggetto con gli stessi controlli di `tabs.ts`, e
`GridRibbon.contextMenu` le dà al menu dell'editor (`editors/grid/menu.ts`),
che aggiunge gli appunti in TSV e «Copia il riferimento». Una voce che il
catalogo non serve non si vede. La mini-barra sopra il menu
(`MINI_CONTROLS`) riusa i controlli della scheda Home: carattere,
dimensione, grassetto, corsivo, percentuale, separatore delle migliaia e
decimali. In sola lettura restano le voci che non scrivono.

## Dove si trova

- `apps/client/src/editors/grid/ribbon/` (`ribbon.ts`, `tabs.ts`, `tabs/`,
  `context.ts`, `palette.ts`, `strings.ts`), `editors/grid/menu-comandi.ts`,
  `editors/grid/menu.ts`
- `apps/client/src/kit/ribbon/` (`ribbon-motion.ts`); la pelle in
  `theme/scrittoio/structure.css` e `skin/kit.css`
