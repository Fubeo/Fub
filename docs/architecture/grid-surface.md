# Superficie dei fogli

> **Domanda:** come la shell apre, mostra e modifica una cartella di Excel,
> e che cosa resta al provider?
> **Fonti autorevoli:** `apps/client/src/editors/grid/`,
> `crates/fub-format-xlsx/`.
> **Decisioni:** [ADR 0219](../decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md),
> [ADR 0220](../decisions/0220-gli-oggetti-dei-fogli-viaggiano-con-le-finestre.md).

## La griglia

La famiglia `grid` ha un profilo, `workbook`, che apre una cartella di Excel
con la versione 2 del protocollo: la sorgente a byte resta nell'host, e il
testo della `DocumentSession` è il **giornale** della cartella, con le celle
cambiate e i comandi dati. `GridEngine`
(`apps/client/src/editors/grid/engine.ts`) sceglie la prima superficie
dichiarata con famiglia, versione e formato giusti, apre una sessione sul
giornale e sulla revisione dei byte, e chiede soltanto le finestre che lo
schermo mostra, al massimo 256 righe per 128 colonne l'una. Righe e colonne
sono virtualizzate; le coordinate stabili `SheetId + RowId + ColumnId`
vengono dalle finestre.

Editor in-cell e formula bar usano due istanze di `TextEngine` con
`FormulaProfile`, e nessuna battuta attraversa IPC. Un commit scrive le voci
nel giornale, lo pubblica subito alla sessione e lo consegna al provider, che
controlla le preimmagini sulla revisione, rifiuta le celle bloccate e risponde
con le celle da rileggere. Le modifiche in coda partono una dopo l'altra.
Finché il giornale ha soltanto celle l'undo è locale alla superficie; in
modalità a comandi annulla e ripeti sono del documento (`edit.undo`,
`edit.redo`). Un giornale cambiato altrove (un altro
riquadro, un salvataggio, una ricarica) riapre la sessione, chiude la
precedente e annulla la bozza aperta. Se non c'è una superficie compatibile,
la sessione non si apre o una finestra fallisce, la superficie dichiara
`data-grid-protocol="unavailable"`, lo dice nell'avviso e non scrive; il
linguaggio delle formule non si duplica in TypeScript.

La shell non riceve DOM, callback JavaScript o oggetti CodeMirror: possiede
rendering, input, clipboard, selezione e stato visuale, mentre il provider
possiede lettura, formule, blocchi e innesto. Limiti, coordinate, fallback e
parità nativo/WASM sono normati in [ABI e WIT](../reference/abi-and-wit.md) e
nel [contratto IPC](../reference/ipc-contract.md).

Nei tre strati
([ADR 0222](../decisions/0222-tre-strati-e-l-aspetto-del-contenuto.md)) le
intestazioni di righe e colonne e la barra sono cornice, la griglia e le celle
contenuto. La modalità `sheet` non dichiara ancora i suoi aspetti, e vale
`tema`: il testo automatico di una cella prende l'inchiostro del tema.

## La selezione e il riempimento

Il puntatore seleziona trascinando: da una cella un intervallo, da
un'intestazione colonne o righe intere, dall'angolo il foglio; Maiuscolo
estende dall'àncora. Fuori dal bordo la griglia scorre da sé, più svelta
quanto più il puntatore è lontano. Con righe o colonne intere la cella
attiva resta sulla prima colonna o sulla prima riga.

In una cartella a comandi che serve `edit.autoFill` la selezione ha il
quadratino di riempimento nell'angolo in basso a destra. Tirato fuori dalla
selezione mostra il bersaglio lungo l'asse su cui il puntatore è uscito di
più e, al rilascio, dà un solo `edit.autoFill` con sorgente e bersaglio
(con Ctrl tenuto, nel modo alternato di Excel). Il doppio clic riempie in giù
fin dove arriva la colonna accanto, nelle righe che la griglia ha letto. Le
serie le calcola il provider; Ctrl+D e Ctrl+R restano i riempimenti da
tastiera.

## La barra multifunzione

Sopra la barra della formula di una cartella a comandi sta la barra
multifunzione (`apps/client/src/editors/grid/ribbon/`), che il bootstrap
carica a parte. `tabs.ts` descrive schede, gruppi e controlli (pulsanti,
pulsanti divisi, menu, colori, elenchi, caselle, gallerie, campi); ogni
controllo nomina un id del catalogo del provider, e `ribbon.ts` mostra
soltanto quelli che il catalogo serve, spegne quelli spenti con il motivo
nel suggerimento e dà il comando con i parametri della facciata. Lo stato
viene dallo stile della cella attiva, dalle tabelle e dalla vista del foglio
e dal libro della cartella; la scheda della tabella compare con la selezione
dentro una tabella. La tavolozza disegna i colori del tema con le sfumature
di ECMA-376 (`palette.ts`), le gallerie gli stili di tabella e di cella.

La barra si percorre con le frecce (un solo controllo per scheda sta nel
Tab), Esc torna alla griglia, Alt o F10 mostrano le lettere di Excel. Quando
la barra è stretta i pulsanti piccoli perdono il nome, poi i gruppi si
raccolgono da destra in un pulsante che li apre in un riquadro. Il testo
della barra è in un catalogo suo (`strings.ts`), in italiano e in inglese.

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

## Le finestre dei fogli

Le finestre della cartella (`apps/client/src/editors/grid/dialogs/`, elencate
in `catalog.ts`) si aprono da un controllo della barra, spento con il comando
che la finestra darebbe, o dall'esito di un comando che chiede una finestra
(`GridDialog`). Ognuna legge con le letture del provider (`cell.get`,
`formulas.nameManager`…) e, confermata, dà un solo comando del catalogo
(la finestra di un commento uno per ciò che è cambiato); un rifiuto resta
scritto nella finestra aperta. Formato celle dà soltanto ciò
che è cambiato, e l'esempio del formato lo calcola il provider con `TEXT`.

## Gli oggetti dei fogli

Grafici, grafici sparkline, immagini e forme arrivano con le finestre che
toccano (`GridObject`), e la griglia li disegna sopra le celle, nell'ordine
del file (`apps/client/src/editors/grid/objects.ts`). Un grafico arriva già
disegnato in SVG dal provider (GridCraft, patch 0009) e si mostra in un
`<img>`, che non esegue niente; un'immagine arriva con la sua impronta, una
volta sola: la shell la tiene in `GridMediaCache` e la richiesta della
finestra elenca le impronte che ha (`known_media`). Una forma arriva come
aspetto (figura, colori, testo) e la disegna la shell in SVG.

Gli oggetti sono `aria-hidden`: un riassunto nascosto, legato al viewport,
li elenca con il tipo e il testo alternativo, e la selezione si annuncia.
Un clic o Ctrl+Alt+5 seleziona un oggetto, Tab passa al successivo, Esc
torna alle celle. Un oggetto selezionato si sposta con le frecce (Maiuscolo
per dieci pixel) o trascinandolo, si misura con le maniglie, si cancella con
Canc; Invio o F2 aprono il testo di una casella di testo, che Ctrl+Invio o
l'uscita scrivono ed Esc lascia. Lo spostamento si mostra subito e diventa un
solo comando `object.move` (cella dell'angolo, scarto e misura nei pixel del
file); se il comando non entra l'oggetto torna dov'era. Con un oggetto
selezionato la barra mostra le schede contestuali del grafico e della forma.

## La revisione

Una cella con una nota o un commento ha il segno nell'angolo (spento per un
thread risolto) e, al passaggio del puntatore, la scheda di
`apps/client/src/editors/grid/comment-card.ts`: il thread con gli autori e,
se la griglia accetta comandi, Rispondi, Risolvi o Riapri, Modifica,
Mostra/Nascondi per una nota ed Elimina. Ogni gesto è un comando del catalogo
(`review.*`) con la cella nei parametri, perché vale per la cella indicata e
non per quella attiva. A chi usa la tastiera il thread lo dice la cella attiva
(`aria-description`), e Maiusc+F2 apre la finestra della nota o del commento,
che mostra le risposte e con lo stesso OK cambia il testo, risponde e risolve.
Una finestra aperta su una cella che ha già l'altro tipo apre quello: una nota
scritta su un commento lo sostituirebbe. Modificare il testo tiene le
risposte, lo stato e la casella della nota (GridCraft, patch 0010).

Proteggi foglio e Proteggi cartella chiedono la password due volte; Rimuovi
protezione, e Proteggi cartella su una cartella protetta, provano senza
password e la chiedono soltanto se il provider ne vuole una.

## La stampa

Le impostazioni di pagina sono del provider: la scheda Layout di pagina dà i
comandi di GridCraft (`pageLayout.*`), e Imposta pagina
(`dialogs/page.ts`) legge `pageLayout.pageSetup` dato senza parametri, che non
cambia niente, e scrive le quattro schede di Excel con un solo comando; i
margini si mostrano in centimetri, e uno non toccato torna in pollici con il
valore del file. L'anteprima di stampa legge `file.printPreview` (le pagine) e
`file.exportPdf` senza percorso (il PDF in base64), due comandi che il
provider serve anche se GridCraft li mette nel gruppo File e che non entrano
nel giornale; la finestra disegna una pagina alla volta con il lettore dei PDF
della shell, intera o con lo zoom. Un PDF oltre 1 MiB di risultato non
arriva: la finestra lo dice e lascia l'esportazione.

L'esportazione in PDF è l'export dell'host `xlsx.copy.pdf`
(`crates/fub-format-xlsx/src/export.rs`, bundle `fub.xlsx`), che la
superficie dichiara fra i suoi export: il pulsante della barra e il menu del
riquadro salvano, chiedono `export.run` e aprono il centro attività. Stampa i
byte salvati, non la sessione, e il rapporto conta ciò che il PDF non porta.

## Dove si trova

- `apps/client/src/editors/grid/engine.ts`
- `apps/client/src/editors/grid/workbook.ts`
- `apps/client/src/editors/grid/objects.ts`
- `apps/client/src/editors/grid/comment-card.ts`
- `apps/client/src/editors/grid/ribbon/ribbon.ts`
- `apps/client/src/editors/grid/ribbon/tabs.ts`
- `apps/client/src/editors/grid/dialogs/host.ts`
- `apps/client/src/editors/grid/dialogs/catalog.ts`
- `apps/client/src/editors/grid/dialogs/page.ts`
- `apps/client/src/editors/grid/dialogs/notes.ts`
- `apps/client/src/editors/grid/dialogs/protect.ts`
- `crates/fub-format-xlsx/src/grid.rs`
- `crates/fub-format-xlsx/src/export.rs`
- `crates/fub-format-xlsx/src/objects.rs`
