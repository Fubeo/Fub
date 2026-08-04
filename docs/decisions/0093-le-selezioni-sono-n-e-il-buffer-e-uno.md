# 0093 — Le selezioni sono N, e il buffer è uno

**Data:** 2026-08-04
**Voce:** [§23.4](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#234-selection-ne-porta-una-sola-e-il-tipo-di-un-campo-non-è-additivo)
**Commit:** *(questo commit)*

## Il fatto

`ViewContext.selection` era un `Option<Selection>` e `Selection` ne descriveva
**una**: uno span facoltativo e un testo. Il multi-cursore (FEATURES 4.2) ne
vuole N, e da uno a molti è un **campo ritipato** su un record pubblicato — la
rottura che [`wit_additivity`](../architecture/wit-congelato.md) elenca per
prima, e che dopo il freeze di M4 costa una major.

Adesso il campo si chiama `selections`, è un `Option<SelectionSet>`, e
`SelectionSet` è un `variant` a due casi: `Anchored(AnchoredSelections)` e
`Floating(FloatingSelections)`. Ognuno dei due porta una **primaria** e una
lista di **secondarie**.

## La premessa che non reggeva

La voce offriva un argomento comodo: «la primaria è la prima della lista per
convenzione — che è la regola di CodeMirror e non costa niente al confine».

Non è la regola di CodeMirror. `EditorSelection` ha `ranges` **e** `mainIndex`,
cioè un indice a parte, e `state.selection.main` è `ranges[mainIndex]`, non
`ranges[0]`. La sua documentazione dice di più: quell'indice è *«usually the
range that was added last»*
([`@codemirror/state/dist/index.d.ts:435`](../../frontend/node_modules/@codemirror/state/dist/index.d.ts)).
Di norma la primaria è **l'ultima aggiunta**, ed è esattamente ciò che succede
col gesto per cui il multi-cursore esiste: si tiene Alt e si clicca il punto
nuovo, e quello nuovo è quello su cui si sta lavorando.

Quindi «la prima per convenzione» non era gratis: era una **conversione** che la
shell avrebbe dovuto fare, e una conversione che **perde** l'informazione di
quale fosse la primaria. Il conto vero era all'incontrario — nominare la primaria
costa un campo, dedurla costa un dato.

È la sesta volta di fila (0087–0093) che rileggere una voce contro il sorgente la
cambia prima di progettarla, e la terza volta che la premessa **non era mai stata
vera**.

## Il fatto che ha spostato tutto il resto

Il multi-cursore **non era una funzione da costruire**. L'editor della shell lo
porta acceso da sempre: `basicSetup` di CodeMirror include
`EditorState.allowMultipleSelections`, la selezione rettangolare, il cursore a
mirino e — via `searchKeymap` — `Mod-d`, cioè «seleziona anche la prossima
occorrenza». Chi usa Fub oggi i tre cursori li fa, li vede disegnati, ci scrive
dentro.

A non esserci era la sola facoltà di **dirlo**: `paneContext()` leggeva
`view.state.selection.main` e pubblicava quella. Gli altri due cursori morivano
lì, in una riga di shell, e ogni provider del contratto ha sempre visto un
utente con un cursore solo.

Questo cambia cosa chiude la voce. Non è una firma preparata per una funzione
futura — che sarebbe il caso dichiarato e non onorato che la
[0077](0077-una-scorciatoia-e-una-chiave.md), la
[0090](0090-una-sequenza-e-una-modalita-che-scade.md), la
[0091](0091-un-orario-di-parete-non-e-un-intervallo.md) e la
[0092](0092-una-base-si-dichiara.md) hanno rifiutato quattro volte di fila. È una
firma che **recupera** ciò che l'app già faceva e il confine buttava via.

## Le tre decisioni di forma

### La primaria è un campo

`AnchoredSelections { primary, secondary }`, non `list` più indice, non `list`
con una regola sul primo elemento.

L'argomento è quello che le ultime tre decisioni hanno applicato di fila
(0007 → 0091 → 0092): **ciò che si sceglie si nomina**. Ma qui non è solo
igiene, perché rende vero per costruzione un fatto che nessuna delle altre forme
regge: un insieme di selezioni **non è mai vuoto**. Un `list` più `mainIndex`
rappresenta due stati che non esistono — la lista vuota, e l'indice fuori range —
e chi legge deve difendersi da entrambi in ogni linguaggio in cui il confine
verrà attraversato.

«Nessun cursore» resta ciò che era: l'`Option` che la 0007 aveva già scelto.
Lista vuota e assenza non diventano due modi di dire la stessa cosa, perché la
lista vuota smette di esistere.

### Lo span sale sopra la lista

La casella 2 della voce aveva ragione, e la sua conseguenza è più larga di quanto
la casella 1 lasciasse pensare.

Lo span di una selezione c'è solo quando le sue coordinate valgono anche per il
sorgente che il kernel ha in mano. La condizione che lo annulla è *il buffer ha
modifiche non salvate* — che è una proprietà del **buffer**, cioè una sola per
pannello. Lo si vede nella shell: `paneContext()` legge `dirty` **una volta** e
lo applica alla selezione. Con N selezioni, la forma di prima —
`span: Option<Span>` dentro ognuna — direbbe che possono cadere una alla volta, e
non è vero.

Quindi la scelta sta **sopra l'insieme**. `SelectionSet` è ancorato o
fluttuante; nel caso ancorato lo `span` non è facoltativo, c'è. Un insieme con
due selezioni posizionate e una no non è rappresentabile, ed è il punto: un
provider che agisse solo sulle posizionate agirebbe su due dei tre punti che
l'utente vede — cioè farebbe **metà** di ciò che gli è stato chiesto, che è
peggio del rifiutare.

Il prezzo è dichiarato: cinque tipi al confine dove ce n'era uno, e chi vuole il
solo testo (il pannello statistiche) deve passare per due casi invece che per
uno. Vale, e la ragione è nei numeri dei clienti: dei cinque consumatori della
selezione, **tre** vogliono le coordinate (`selection.wikilink`, `note.task.toggle`,
l'outline) e per loro il `variant` è un guadagno — una domanda sola invece di N
controlli —, e **uno** vuole il solo testo. Il quinto le azzera tutte.

### Il campo si chiama `selections`

Un campo chiamato `selection` che ne porta N sarebbe la stessa bugia riscritta.
Rinominarlo non è una rottura in più: il campo è già ritipato, e chi lo legge non
compila comunque.

## I cinque consumatori, uno per uno

Passarli uno per uno era il lavoro vero della voce, e due di loro avevano una
domanda di prodotto dentro.

**`selection.wikilink`** avvolge **ogni** punto selezionato. Con tre selezioni
scrive tre riferimenti, in una `EditRequest` sola — quindi tutti o nessuno, e un
solo passo indietro li disfa tutti e tre. Agire sulla sola primaria vorrebbe dire
lasciare all'utente due dei tre punti che ha appena scelto, cioè disfare col
comportamento ciò che il tipo ha appena reso dicibile. I cursori **vuoti** non
hanno niente da avvolgere e restano fuori — ma non in silenzio: il messaggio dice
*quante* selezioni sono diventate riferimenti, che è la differenza fra saltare un
punto e saltarlo di nascosto.

**`note.task.toggle`** legge la **primaria**, e non è la stessa sottrazione. La
posizione di quel comando è un *argomento* — `at`, uno scalare in una
`CommandSpec` pubblicata — e il comando è «spunta il task sotto il cursore», al
singolare per costruzione. Spuntarne N vorrebbe dire un `at` che è una lista,
cioè una seconda decisione di firma su un record pubblicato: non la si prende di
straforo dentro questa.

**Il pannello statistiche** somma, e dice **quanti punti** sta sommando:
`Selezione (3 punti) — parole: 5 · caratteri: 27`. Chi seleziona in più punti lo
fa per agire su un insieme, e la domanda è «quanto ho preso», non «quanto ho
preso qui, e qui, e qui»; tre righe che cambiano a ogni battuta sarebbero un
pannello che si legge peggio proprio quando c'è più da leggere. Il numero dei
punti però va detto, perché un totale senza di lui è misterioso. I testi si
contano uno per uno e **poi** si sommano: concatenarli e contare dopo
attaccherebbe l'ultima parola di una alla prima dell'altra.

**L'outline** evidenzia la sezione della **primaria**. In tre punti si
*seleziona*; in uno solo si *sta*, e segnare tre sezioni direbbe una cosa vera
della selezione e falsa di dove sta guardando chi legge la struttura.

**`Session::invalidate`** le azzera tutte, come prima. A cambiare non è una
selezione: è il testo sotto tutte.

## `changes()`: la maschera guarda l'insieme

`ViewContext::changes` confronta `selections` per uguaglianza, quindi muovere uno
solo di N cursori conta come «la selezione è cambiata». È ciò che si vuole, e la
voce chiedeva giustamente che fosse **scritto** invece che lasciato succedere:
chi segue la selezione la segue per sapere dove si sta lavorando, e con più
cursori si lavora in più punti — un pannello statistiche che conta tutte, o una
view che evidenzia i punti attivi, invecchiano allo stesso modo se a muoversi è
il terzo cursore o il primo.

## Il difetto un piano sopra, e il suo costo misurato

Come per la 0092 — dove `Buffer.base` ripeteva nella shell il difetto di
`write_document` — il posto omologo qui è `paneContext()`, e ci ripeteva la parte
peggiore: buttava via N−1 selezioni. Adesso sceglie il caso **una volta**, dallo
stato del buffer, e pubblica tutte le selezioni che l'editor ha.

Quel «tutte» ha un costo che la voce chiedeva di **misurare invece che
dichiarare**, perché `paneContext()` gira a ogni `selectionSet`, cioè a ogni
battuta di tastiera. `charToByteIndex` è una scansione dall'inizio del testo:
costa quanto l'offset che converte. Con N selezioni le estremità da convertire
sono 2N, e con dieci cursori in fondo a una nota lunga sarebbero dieci
attraversamenti dello stesso documento a ogni tasto premuto.

Quindi non si chiama 2N volte: `charToByteIndices` ordina gli indici una volta e
percorre il testo **una** volta. N cursori costano quanto uno, e il presidio è un
test che confronta la versione a batteria con quella singola su ogni indice del
documento — perché la funzione nuova esiste per il costo, non per la semantica, e
il giorno che le due divergessero le selezioni pubblicate sarebbero sbagliate
senza che nulla lo dica.

## Il ritaglio

`selection` e `view-context` erano nella linea di base congelata, identici ai
vivi. Quindi si ritaglia, e lo si scrive:
[wit-congelato.md](../architecture/wit-congelato.md) ha la sua riga, e
`frozen/0.1.0.wit` porta il paragrafo che dice cosa c'era e cosa gli ha preso il
posto.

C'è una cosa che quel paragrafo dice e che vale più della facciata: la 0007 aveva
**previsto** questo ritaglio e lo aveva previsto più piccolo di com'è — «la
seconda sarebbe `list<selection>`, cioè additiva solo cambiando il tipo del
campo». La dichiarazione era giusta, la stima no. Una lista sola non bastava,
perché nel passaggio da uno a molti sono cambiate due cose che nella forma di
prima non si vedevano: quale sia la primaria, e che la regola dello span
riguarda il buffer e non la selezione. **Una rinuncia dichiarata non è una
rinuncia dimensionata**, e questa voce è il posto in cui la differenza si è
vista.

## Cosa resta fuori

- **`note.task.toggle` su N cursori**: vuole un `at` che sia una lista, cioè una
  decisione di firma sua. È una **casella residua** di questa voce e sta contata.
- Nessuna nuova capacità, nessun permesso spostato: `ContextMask` e
  `ContextKind::Selection` non cambiano forma.

## Il presidio

- `wit_additivity` resta verde **con ragione**: la linea di base porta il
  ritaglio, quindi il confronto non ha niente da dire. La rottura resta reale per
  chi avesse compilato contro l'`abi.wit` di ieri, ed è scritta dove si va a
  cercarla.
- `wit_conformance` rispecchia i cinque tipi nuovi e l'ordine dei due casi del
  `variant`, che è il discriminante ABI.
- `commands_e2e.rs` mette in scena tre cursori con la primaria **non** prima per
  posizione, e prova che i riferimenti sono tre e che un solo passo indietro li
  disfa; accanto, il caso misto (un cursore vuoto fra due selezioni) prova che il
  numero detto è due e non tre.
- `stats.rs` prova la somma, il conteggio dei punti e il fatto che due parole
  selezionate separatamente restano due.
- `session_context.rs` prova che una riscrittura fa cadere **l'insieme**, non la
  primaria.
- `editor.test.ts` prova sull'editor vero che la primaria è `main` e non
  `ranges[0]`, e che le estremità sono in byte anche su testo accentato.
- `offsets.test.ts` prova che la conversione a batteria dice ciò che direbbe
  quella singola.
