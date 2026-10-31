# Disegni

> **Per chi:** chi disegna in un vault, o ne apre i disegni.
> **Risultato:** sapere come si apre, si modifica e si legge un file `.svg`, e
> che cosa resta del file dopo una modifica.

## Un disegno è un file SVG

Con la feature `draw` dell'host, accesa nel build predefinito, un `.svg` ha il
formato `svg` e si apre come disegno: il profilo `vector` della famiglia
`canvas` (`apps/client/src/editors/spatial/surface.ts`). Senza la feature resta
testo con l'anteprima accanto ([Editor e anteprima](editor-and-preview.md)).
Un disegno nuovo nasce vuoto o da un modello: [Nuovo disegno](drawing-new.md).

Il codice dell'editor si scarica la prima volta che un disegno si apre, e non
pesa su chi non ne apre. Se non arriva, il riquadro lo dice, e «Apri come
sorgente» mostra comunque il testo (`apps/client/src/editors/spatial/lazy.ts`).

Le annotazioni di un PDF usano lo stesso editor, con le pagine del PDF sotto:
le descrive [Annotazioni dei PDF](pdf-annotations.md).

Il file resta un SVG che qualunque browser o editor apre; «Esporta…» ne fa un
PNG, un JPEG, un SVG pulito o un PDF ([Disegni, esportare](drawing-export.md)).
I dati che servono a Fub stanno in pochi attributi del namespace `fub`: la
forma esatta è nel [formato della scena](../reference/scene-format.md), le
modifiche che il disegno ci scrive nelle [operazioni sulla scena](../reference/scene-operations.md),
il perché nell'[ADR 0203](../decisions/0203-superfici-spaziali.md).

## Modalità

Il disegno offre due modalità:

- **Disegno**, la predefinita: la barra degli strumenti e il foglio. Proietta
  sul ruolo `live_preview`, quindi il comando Live la raggiunge.
- **Lettura**: il documento intero come immagine, con lo zoom del visore.
  Proietta su `reading`, e `Mod-E` passa dall'una all'altra.

Il ruolo `source` non c'è: il testo del disegno si apre con «Apri come
sorgente». Il riquadro ricorda la modalità, come per ogni altra famiglia.

In Lettura il file non entra mai nel DOM della shell: è un `<img>` da un blob,
che non esegue script e non carica risorse; i caratteri dell'app e del vault
e le immagini del vault vi entrano coi loro byte ([immagini](drawing-images.md), [caratteri](drawing-fonts.md)). Se il disegno ha un
titolo, l'immagine si chiama col titolo; altrimenti col nome del file. Sotto
l'immagine ci sono la descrizione del disegno, che l'immagine annuncia come
sua, i collegamenti del disegno, uno per pulsante (vedi «Collegamenti»), e
«Oggetti del disegno», l'elenco degli oggetti in albero: chiuso finché non lo
si apre, e costruito soltanto allora.

## Disegnare

Gli strumenti stanno nella colonna a sinistra, a gruppi; i più rari nelle
tendine, che si aprono tenendo premuta la casella, col tasto destro o con la
freccia a destra. Ogni strumento ha un tasto: selezione (`V`), penna (`P`),
evidenziatore (`Maiusc+P`), gomma per oggetto (`E`), rettangolo (`R`),
ellisse (`O`), linea (`L`) e freccia (`Maiusc+L`); la
**Mano** (`H`) e lo **Zoom** (`Z`) muovono la vista in tutti e due gli spazi
([Disegni, vista](drawing-view.md#muovere-e-ingrandire-la-vista)). Il colore
si sceglie col selettore, gli otto colori consigliati in cima, tondi e col
nome ([Disegni, colori](drawing-colors.md)); gli spessori sono tre.

Tasto centrale, due dita, rotella e `Spazio` tenuto col mouse sul foglio
muovono la vista. Ogni gesto si annuncia a chi usa un lettore di schermo.

Con la selezione gli oggetti scelti stanno in una cornice, con le maniglie
che li ridimensionano e li ruotano: [Disegni, trasformare](drawing-transform.md).
Copia, taglia e incolla parlano SVG, fra i disegni e con gli altri programmi
([Disegni, appunti](drawing-clipboard.md)); un'immagine entra coi suoi byte, o
dal vault per riferimento ([Disegni, immagini](drawing-images.md)).

## Completo e Semplice

L'editor ha due spazi di lavoro: **Completo**, quello di partenza, offre
tutto; **Semplice** offre gli strumenti per disegnare a mano o col dito, con
caselle grandi, e il pulsante «Completo» in fondo alla colonna. Si sceglie dal
menu ≡ «Disegno», con «Spazio di lavoro», o nelle Impostazioni, nel gruppo
«Disegni»: è un'impostazione del vault, `draw.workspace`. «Personalizza la
barra…», nello stesso menu, sceglie quali strumenti stanno nella colonna e in
che ordine ([Disegni, spazio di lavoro e barra](drawing-custom.md)). Lo spazio
filtra soltanto ciò che si offre: un disegno si apre uguale nei due, e
cambiare spazio non lo modifica.

Chi monta l'editor senza uno spazio sceglie ancora un livello delle versioni
precedenti con `level` e `setLevel`
(`apps/client/src/editors/spatial/tools/editor.ts`).

Oltre agli strumenti per disegnare, il Completo ha:

- la **«Selezione avanzata»**: i simili, i gruppi isolati, gli oggetti bloccati e nascosti ([Disegni, selezione](drawing-selection.md));
- nelle «Proprietà» le **punte delle linee** ([Disegni, punte delle linee](drawing-tips.md)), e nella barra «Disponi» l'**«Opacità»** ([Disegni, effetti e fusione](drawing-effects.md#lopacità-nella-barra));
- l'**evidenziatore** (`Maiusc+P`), dopo la penna: un tratto largo, costante e a
  punte piatte, che lascia vedere ciò che copre senza ingrigirlo, scritto come
  un tratto a penna con `fub:tool="highlighter"`, `fill-opacity="0.5"` e la
  fusione Moltiplica ([penne](drawing-pen.md)). Parte giallo, con colore
  e spessori suoi, 8, 16 e 24 unità, e la penna ritrova i propri quando torna;
- le **forme dal tratto**: un tratto a penna tenuto fermo alla fine diventa
  una forma pulita ([Disegni, forme dal tratto](drawing-ink-shapes.md));
- **«Altro colore…»**, dopo la tavolozza: un codice come `#3a7bd5`, anche di
  tre cifre o senza `#`, o il selettore del sistema. Il colore resta come un
  anello in più col codice per nome, che dice se sul bianco sta sotto il 3:1;
- **«Immagine dal vault…»** (`Ctrl+I`), nel gruppo «Inserisci»: un'immagine
  che è già nel vault ([Disegni, immagini](drawing-images.md));
- **«Copia lo stile»** e **«Incolla lo stile»** (`Ctrl+Alt+C`, `Ctrl+Alt+V`),
  da un oggetto agli altri ([Disegni, appunti](drawing-clipboard.md));
- il pannello delle **«Proprietà»**, accanto al foglio, per scrivere coi
  numeri com'è fatta la selezione: [Disegni, proprietà](drawing-properties.md);
- l'albero degli oggetti come **pannello dei livelli**: i nomi, il filtro, le
  miniature e le righe da trascinare ([Disegni, pannello dei livelli](drawing-layers.md));
- la **vista ruotata**, i **gesti** delle dita, il **menu radiale** e la curva
  della penna ([Disegni, vista, gesti e menu radiale](drawing-view.md));
- la **«Cronologia»**, accanto al foglio: i passi, per tornare a uno qualsiasi
  in un colpo, e i segni ([Disegni, cronologia](drawing-history.md));
- la verifica dell'**«Accessibilità»**, accanto al foglio: i problemi, ognuno
  con la sua correzione, e l'ordine di lettura ([Disegni, accessibilità](drawing-accessibility.md)).

Di queste il Semplice tiene l'evidenziatore, «Altro colore…», «Immagine dal
vault…», il pannello delle proprietà e la vista ruotata coi gesti; il resto
sparisce dalla colonna.

Il Lazo, la Tavola, il Contagocce, la Sfumatura, il Connettore, il Poligono e
il Testo se ne sono andati con lo Standard di FubDraw (decisione 0231), con i
colori e gli stili del documento, le campiture, le guide, i righelli e le
misure, la simmetria della penna, il ritaglio delle immagini, le raccolte di
forme e la presentazione. Ciò che hanno scritto nei file resta e si vede:
[tavole](drawing-boards.md), [connettori](drawing-connectors.md), che seguono
ancora gli oggetti a cui sono agganciati, [sfumature](drawing-gradients.md),
[campiture e motivi](drawing-patterns.md), [stili](drawing-styles.md),
[ritagli](drawing-masks.md), [testi](drawing-typography.md) ed
[etichette](drawing-labels.md). Non si creano e non si cambiano più; un
oggetto che li porta si sceglie, si sposta, si trasforma e si elimina come
gli altri.

## Disporre

Nello spazio Completo, finché c'è qualcosa di scelto, accanto alla selezione
galleggia la barra «Disponi», o in cima al foglio se lo si sceglie nelle
proprietà: `Alt+F10` ci porta il fuoco ed `Esc` lo riporta al foglio. Ogni
comando è un passo di annulla, e la selezione segue ciò che ha fatto.

- **Duplica** (`Ctrl+D`) mette le copie sopra gli originali, 24 pixel più in
  basso a destra, con id nuovi; la selezione passa alle copie, e un secondo
  `Ctrl+D` prosegue la fila.
- **Raggruppa** (`Ctrl+G`) mette due o più oggetti in un gruppo nuovo, al
  posto del più alto; un oggetto di un livello trasformato vi entra con la
  trasformazione che lo lascia dov'era. **Separa** (`Ctrl+Maiusc+G`) porta i
  figli al posto del gruppo, ciascuno con la trasformazione del gruppo, con lo
  stile che ne ereditava e con l'opacità moltiplicata dalla sua; titolo e
  descrizione del gruppo se ne vanno con lui. Senza selezione i tasti lo dicono.
- **Ordine** porta in primo piano (`Ctrl+Maiusc+]`), avanti di un posto
  (`Ctrl+]`), indietro di un posto (`Ctrl+[`) o in secondo piano
  (`Ctrl+Maiusc+[`), nel livello di ciascun oggetto. Sul foglio fanno lo
  stesso `PagSu` e `PagGiù`, con `Maiusc` agli estremi. Le parentesi valgono
  per posizione: su una tastiera italiana sono `è` e `+`. Il menu spegne la
  voce che non cambierebbe niente.
- **Allinea e distribuisci** allinea i bordi o i centri della selezione al
  suo riquadro, o alla pagina se l'oggetto è uno solo; distribuire lascia
  fermi il primo e l'ultimo e mette spazi uguali fra tre o più oggetti.

Ordine, gruppi e separazione spostano gli elementi come sono scritti, e
riscrivono solo ciò che cambia davvero. Una parte che FubDraw non sa scrivere,
come un `<use>` estraneo, si sposta com'è e riceve ciò che il gruppo le dava;
se un foglio del disegno sceglierebbe altri elementi, a chi cambierebbe
aspetto si scrive lo stile di prima ([Disegni, appunti](drawing-clipboard.md)).

## Livelli

Un livello del disegno è un gruppo figlio della radice con `fub:layer`, che
ne porta il nome. Nello spazio Completo la barra ha il pulsante «Livelli»: mostra
il livello in cui si disegna, quello corrente, col suo nome e, a parole, il suo
stato, «bloccato» o «nascosto». Il suo menu elenca i livelli dalla cima, e
sceglierne uno lo rende corrente; poi ha i comandi su quello corrente:

- **Nuovo livello** ne crea uno vuoto sopra quello corrente, che diventa lui,
  col primo nome libero fra «Livello 2», «Livello 3» e così via;
- **Rinomina…** chiede il nome, che non resta vuoto né fatto di soli spazi e
  ha al più 80 caratteri;
- **Nascondi** e **Mostra** scrivono e tolgono `display="none"`, che lo
  nasconde anche negli altri programmi; **Blocca** e **Sblocca** scrivono e
  tolgono `fub:locked="true"`. Gli oggetti di un livello nascosto o bloccato
  non si scelgono e non si cancellano, ed escono dalla selezione;
- **Sposta su** e **Sposta giù** lo portano sopra il livello che ha sopra, o
  sotto quello che ha sotto; ciò che sta alla radice fra i due resta dov'era;
- **Elimina** lo toglie con ciò che contiene, e diventa corrente il livello
  sotto, o quello sopra. L'unico livello e uno bloccato non si eliminano, e la
  voce spenta dice perché.

Penna, evidenziatore, forme, testi e immagini, incollate o dal vault, vanno nel
livello corrente. Se è nascosto o bloccato il gesto non scrive, e un annuncio
dice perché e che cosa fare. Scegliere oggetti tutti in un livello lo rende
corrente, e l'albero degli oggetti lo dice: «Livello «Note», corrente».

Nella barra «Disponi», **Sposta in un livello** porta gli oggetti scelti in cima
a un altro livello, nell'ordine in cui stavano, dove si vedevano e con lo stile
che ereditavano. Il menu spegne il livello che li ha già tutti e quelli nascosti
o bloccati; senza un altro livello dove portarli il pulsante non c'è.

Ogni comando è un passo di annulla, e annullarlo rende corrente il livello
che ha toccato, se c'è ancora. Nel Semplice il pulsante non c'è, e il
disegno va nel livello più alto che si vede e non è bloccato.

## Griglia e pagina

Nello spazio Completo la barra ha il pulsante «Pagina e griglia». La griglia è
un aiuto della vista e non entra nel file: un disegno si apre uguale con la
griglia e senza. Resta l'ultima scelta, su questa macchina: un disegno aperto
dopo, anche dopo un riavvio, ha la griglia com'era nell'ultimo. Non entra
nemmeno nelle impostazioni del vault, così su un vault condiviso ognuno ha la
sua. Il menu ha:

- **Mostra la griglia** (`#`): righe sottili sopra la carta e sotto il
  disegno, su tutto il foglio, con una riga più marcata ogni cinque. Le righe
  stanno sui multipli del passo contati dall'origine della scena, l'angolo
  della pagina di un documento nuovo, e restano lì quando la pagina cresce.
  Quando lo zoom le avvicina sotto gli 8 pixel se ne vede una ogni cinque, poi
  una ogni venticinque;
- **Aggancia alla griglia** (`%`), che vale anche con la griglia nascosta;
- il **passo**: 5, 10, 20, 50 o 100 pixel, che dividono tutti la pagina di un
  documento nuovo. La prima volta si parte da 20, con la griglia nascosta e
  l'aggancio spento. In un documento che misura in un'altra unità i passi
  sono di quell'unità, e ciascuna ricorda il suo;
- **Adatta la pagina al disegno**.

`#` e `%` valgono come si scrivono, anche con `AltGr`. Ogni cambiamento si
annuncia, per esempio «Griglia visibile.» o «Passo della griglia: 50.», e chi
monta l'editor lo legge e lo sceglie con `grid`, `setGrid` e `onGridChange`.

Con l'aggancio:

- le forme vanno da un incrocio all'altro;
- uno spostamento col puntatore porta sull'incrocio più vicino l'angolo della
  geometria più vicino al punto preso. Il contorno resta fuori, perché esce
  dalla griglia anche in una forma disegnata agganciata;
- tenendo premuto `Ctrl` o `⌘` mentre si trascina, si posa libero;
- con una selezione, le frecce portano l'angolo in alto a sinistra della
  geometria alla riga seguente, cinque righe più in là con `Maiusc`; con `Ctrl`
  o `⌘` portano il lato destro o quello in basso alla riga seguente, ferma
  l'angolo in alto a sinistra, ma non oltre la prima riga dopo il lato opposto;
- senza selezione le frecce portano il cursore all'incrocio seguente, cinque
  righe più in là con `Maiusc`; con `Ctrl` o `⌘` lo muovono libero di un pixel;
- **Duplica** scosta le copie di un numero intero di passi, e un'immagine
  incollata ha l'angolo in alto a sinistra sull'incrocio più vicino.

L'unità del documento si sceglie nella sezione «Documento» delle proprietà
([Disegni, proprietà](drawing-properties.md)).

**Adatta la pagina al disegno** porta la pagina attorno a tutto il disegno,
livelli nascosti e bloccati compresi, con 20 unità di margine, e la allarga
fino a numeri interi. Riscrive `viewBox`, `width` e `height` della radice e la
carta, gli oggetti restano dove sono, ed è un passo di annulla. La voce si
spegne, e dice perché, quando il disegno è vuoto o la pagina è già adattata.

Nel Semplice il pulsante non c'è, la griglia non si vede e non aggancia; le
scelte restano, e tornano con lo spazio Completo.

## Testo

Un testo che il disegno porta, scritto da FubDraw o da un altro programma, si
vede col suo carattere, il suo corpo, il suo colore e la sua trasformazione, e
si sceglie, si sposta, si trasforma e si elimina come gli altri oggetti; i
campi della sezione «Testo» delle proprietà ne cambiano il carattere, il corpo
e l'allineamento. Il testo non si scrive più sul posto: lo strumento Testo e il
campo in cui si scriveva se ne sono andati con lo Standard di FubDraw
(decisione 0231), e le parole si cambiano con «Apri come sorgente». In Lettura
e in una nota, dove il disegno è un'immagine, il testo ha i caratteri del
foglio: l'immagine li porta dentro, fino a 384 KB, e il file non cambia. Come
il file scrive un testo è in [Disegni, tipografia](drawing-typography.md).

## Collegamenti

Un collegamento del disegno è un `a` attorno ad alcuni oggetti, con un `href`
verso un documento del vault: una nota, un altro disegno, un PDF. Gli altri
programmi lo seguono come un link, e in Fub backlink e grafo contano i
collegamenti dei disegni come quelli delle note.

Nello spazio Completo, nella barra «Disponi»:

- **Collega a una nota…** (`Ctrl+K`) chiede il documento in un elenco dei
  file del vault, da filtrare per nome o percorso, e mette gli oggetti scelti
  in un collegamento nuovo, al posto del più alto. La selezione passa al
  collegamento. Un collegamento non ne contiene un altro: se fra gli oggetti
  scelti ce n'è già uno il pulsante è spento, e `Ctrl+K` dice perché.
- Con un collegamento scelto da solo lo stesso pulsante è **Cambia il
  collegamento…**: l'elenco parte dal documento a cui porta adesso, e la
  scelta riscrive soltanto l'`href`, insieme a un `xlink:href` accanto.
- **Togli il collegamento** (`Ctrl+Maiusc+K`) porta gli oggetti al posto del
  collegamento, dove si vedevano e con lo stile che ne ereditavano, e la
  selezione passa a loro. Come per Separa, le parti che FubDraw non sa
  scrivere si spostano come sono, con ciò che il collegamento dava loro.

Ognuno è un passo di annulla. L'`href` è relativo alla cartella del disegno e si
scrive come lo scrive Fub quando un documento cambia nome: le lettere accentate
restano, gli spazi e gli altri caratteri che un URL non ammette diventano codici
`%`, per esempio `../Note/Perché%20piove.md`, e un nome il cui primo segmento
sembra uno schema (`nota:1.md`) prende `./` davanti. Quando il documento cambia
nome o cartella, Fub riscrive il collegamento del disegno come quelli delle note
([formato della scena](../reference/scene-format.md), §9).

In tutti e due gli spazi, ogni collegamento che si vede ha un segno sopra l'angolo in alto
a destra, anche dentro un gruppo o in un livello bloccato. Con la Selezione, o
in un disegno che non si modifica, un tocco sul segno apre il documento; con gli
altri strumenti il segno si vede soltanto, e il foglio resta di chi disegna.
`Alt+Invio` apre il documento del collegamento scelto da solo, e nella barra
«Disponi» lo fa «Apri», col suo nome. L'albero degli oggetti dice dove porta un
collegamento: «Collegamento a «Ciclo dell'acqua», 2 oggetti».

In Lettura l'immagine non si tocca: sotto la descrizione la riga «Collegamenti» ha
un pulsante per ogni documento a cui il disegno porta, col suo nome. Un indirizzo
del web non porta nel vault, e non ha segno né pulsante. Un documento che non si
apre, per esempio perché non c'è più, lo dice con un avviso.

Chi monta l'editor sceglie e apre i documenti con `links`; senza, il disegno
non ha segni né «Collega a una nota…», e un collegamento si toglie lo stesso.

## Ciò che il disegno porta

Un disegno può portare ciò che Fub disegna ma non crea più da quando il
livello Esperto se n'è andato (decisione 0231): le maschere, gli effetti e la
fusione, i simboli, le ripetizioni, i testi in area e su tracciato, le linee a
spessore variabile, i caratteri del vault. Si vedono, si scelgono, si
spostano e si esportano come gli altri oggetti: [maschere](drawing-masks.md),
[effetti e fusione](drawing-effects.md), [simboli](drawing-symbols.md),
[ripetizioni](drawing-repeats.md), [caratteri del vault](drawing-fonts.md).

## Da tastiera

Ogni strumento funziona senza puntatore. Sul foglio le frecce muovono un
cursore, 10 pixel per volta, 50 con `Maiusc` e 1 con `Ctrl` o `⌘`; `Spazio`
preme e, di nuovo, rilascia, e `Invio` rilascia anche lui. In mezzo il cursore
traccia: un rettangolo, un tratto a penna, la gomma su ciò che attraversa, un
trascinamento con la selezione. `Esc` annulla il gesto. Il cursore dice dove
si trova e che cosa c'è sotto, per esempio «x 120, y 80: Rettangolo, Blu».

Con una selezione le frecce la spostano di 1, 10 con `Maiusc`, e con `Ctrl` o
`⌘` la ridimensionano dall'angolo in alto a sinistra; con l'aggancio alla
griglia vanno di riga in riga, come dice «Griglia e pagina». `[` e `]` la
ruotano di 15°, `{` e `}` di 90°. `Tab` e `Maiusc+Tab` passano all'oggetto
dopo e a quello prima, e lo dicono col nome e la posizione; oltre l'ultimo il
fuoco esce dal foglio, che non lo trattiene mai. `Home` e `Fine` scelgono il
primo e l'ultimo oggetto. `Invio` porta al pannello delle proprietà;
senza il pannello apre posizione e misure della selezione, o senza selezione
titolo, descrizione e pagina. `?` elenca i tasti, e `Ctrl+/` cerca fra i
comandi ([come](drawing-view.md#cercare-un-comando)). Ridimensionare scrive un
`transform`: anche lo spessore del contorno segue la scala, e il riquadro che
si chiede è quello che l'oggetto occupa.

«Oggetti», nella barra, apre accanto al foglio l'albero degli oggetti: i
livelli e i loro oggetti, con la stessa selezione del foglio. Le frecce
scelgono la riga a cui arrivano, `Ctrl` o `⌘` le fanno soltanto arrivare,
`Spazio` aggiunge o toglie, `Invio` apre le proprietà, `Canc` elimina ed `Esc`
torna al foglio. Un oggetto bloccato, o di un livello bloccato o nascosto,
c'è, in corsivo, ma non si sceglie, e un segno dice che cosa è bloccato e
nascosto. Oltre 500 righe l'albero disegna soltanto quelle che si vedono.

La scelta non si legge mai dal solo colore: lo strumento, il colore e lo
spessore scelti hanno un filo sotto, le righe scelte la spunta. La vista non
si anima: ogni inquadratura è subito quella nuova, e non c'è moto da ridurre.

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

La scelta è della linguetta. Resta col layout dopo un riavvio, e non passa alle
altre linguette: un altro disegno nello stesso riquadro si apre come disegno.

«Apri come sorgente accanto», negli stessi due posti, apre il testo in un
riquadro nuovo a destra e lascia il disegno dov'è: ogni gesto si legge subito
nel testo, e il testo scritto a mano si vede subito nel disegno. Il testo si
apre senza anteprima, perché l'anteprima è il disegno accanto, e prende il
fuoco. Se un altro riquadro mostra già il testo dello stesso disegno, il
comando porta lì invece di aprirne un altro.

## Più riquadri sullo stesso disegno

Due riquadri possono mostrare lo stesso disegno, anche uno come disegno e uno
come testo. Ogni gesto arriva agli altri riquadri senza ricaricare, e una
modifica fatta nel testo si vede subito nel disegno. Ogni riquadro annulla
soltanto i suoi gesti; un testo arrivato da fuori, da un altro riquadro o dal
disco, ricostruisce il disegno senza svuotarne la cronologia. Anche un tablet
può scrivere sul disegno aperto: [Disegni, sessione live](drawing-live.md).

## Il file su disco

Un gesto è una modifica del testo, non una riscrittura del file. Il resto del
documento resta identico byte per byte: commenti, attributi di altri
programmi, blocchi che Fub non sa modificare e i terminatori delle righe non
toccate, anche quando il file mescola CRLF e LF.

## Selezione e rimandi

Gli oggetti scelti sono, per la shell, gli intervalli del file che li
contengono: le funzioni che lavorano sulla selezione ricevono il testo dei
loro elementi. Un rimando a un punto del file, come quello di una ricerca,
sceglie l'oggetto che lo contiene e lo porta in vista; un punto fuori dagli
oggetti, come il titolo, lo dice con un avviso. In Lettura non c'è selezione.
