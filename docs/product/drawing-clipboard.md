# Disegni, appunti

> **Per chi:** chi porta oggetti da un disegno all'altro, o fra un disegno e
> un altro programma.
> **Risultato:** sapere che cosa va negli appunti, come rientra un SVG e come
> si copia lo stile.

Gli appunti di un [disegno](drawing.md) parlano SVG: ciò che si copia è un
documento SVG completo, e un SVG incollato entra coi suoi elementi. Copiare,
tagliare e incollare ci sono a ogni livello, anche senza nessuna parte del
Personalizzato; copiare e incollare lo stile vengono dallo Standard.

## Copiare e tagliare

`Ctrl+C` o `⌘C` copia gli oggetti scelti, `Ctrl+X` o `⌘X` li taglia; dallo
Standard i comandi sono anche nel menu della selezione. Negli appunti va un
documento SVG che si apre anche da solo: ha un `viewBox` attorno a ciò che si
vede della selezione, `width` e `height` nell'unità del disegno, e ogni
elemento col suo testo, com'è scritto nel file. Un oggetto dentro un gruppo
trasformato porta con sé la trasformazione e lo stile che ereditava; un
gradiente, un motivo o la forma di un `use` a cui rimanda va in un `defs`.

Dove il sistema lo consente, accanto all'SVG va un PNG dello stesso disegno,
a due pixel per unità, coi caratteri dell'app e con le immagini del vault
dentro: un programma che non legge l'SVG, come una chat, riceve l'immagine. Il
PNG arriva poco dopo la copia; se nel frattempo si è copiato altro, o la
finestra ha perso il fuoco, non sostituisce niente.

Copiare si può anche in un documento in sola lettura, tagliare no; tagliare è
un passo di annulla. Nei campi, come il titolo, i tasti restano del campo, e
senza oggetti scelti la copia lo dice.

## Incollare

`Ctrl+V` o `⌘V` incolla nel livello che riceve, al cursore se è nella vista e
altrimenti al centro della vista; gli oggetti restano scelti, con lo strumento
selezione. Incollare di nuovo nello stesso punto scosta ogni copia di un
passo, come «Duplica», e con l'aggancio alla griglia l'angolo in alto a
sinistra va sull'incrocio più vicino. `Ctrl+Maiusc+V` o `⌘⇧V`, «Incolla nello
stesso punto», rimette gli oggetti alle coordinate da cui vengono. Un incolla
è un passo di annulla, anche di molti oggetti.

Ogni oggetto incollato ha un id nuovo, e i riferimenti interni lo seguono: un
gradiente, un `use`, gli attributi ARIA, i selettori di un foglio di stile.
Fra due disegni con le stesse unità un giro di copia e incolla riporta gli
stessi byte, id a parte, e un livello copiato torna come un gruppo col nome
del livello. Le immagini e i collegamenti del vault copiati da un disegno
aperto nell'app, e incollati in uno di un'altra cartella, portano dove
portavano: il percorso si riscrive dal disegno nuovo. Lo stesso SVG che arriva
da fuori resta com'è.

Dal menu della selezione «Incolla» e «Incolla nello stesso punto» leggono gli
appunti dove il sistema lo consente, che la prima volta può chiedere il
permesso; dove non si può lo dicono, e i tasti funzionano sempre.

## Un SVG di un altro programma

Un SVG incollato, o un file `.svg` lasciato sul foglio, entra in un gruppo
nuovo, alla sua misura e col nome del file per titolo. Ciò che il formato dei
disegni ammette resta modificabile; il resto entra in blocchi estranei, che si
spostano e si eliminano interi. Più file lasciati insieme sono un passo solo,
e le immagini lasciate con loro entrano dopo, coi loro byte
([Disegni, immagini](drawing-images.md)).

Un foglio di stile dell'SVG vale soltanto dentro il suo gruppo e non si
riscrive, e nessuna risorsa esterna si carica. Script e gestori di eventi
restano testo del file: non eseguono niente, né sul foglio né in Lettura, e
la diagnostica li segnala (S005). Le entità di un `DOCTYPE` si sostituiscono
col loro testo. Un SVG malformato, senza niente da incollare o più grande di un
disegno modificabile non entra, e lo si dice.

I comandi che spostano gli elementi non riscrivono i fogli di stile del
disegno, incollati o già nel file: riscrivono gli elementi. Se dopo un comando
un foglio sceglierebbe altri elementi, ciascuno che cambierebbe aspetto riceve
il valore che aveva, in un attributo di presentazione o, dove il foglio lo
vincerebbe, nel suo `style`, anche con `!important`; il comando lo dice, con
quanti elementi ha riscritto. Succede per esempio separando un diagramma di
Mermaid, il cui foglio dà lo stile alle forme passando dal gruppo che le
contiene. Vale per i gruppi, l'ordine, i collegamenti, i livelli e gli
spostamenti in «Oggetti», ed è lo stesso passo di annulla. Si confrontano il
colore, il contorno, il carattere, l'opacità e la trasformazione che si
vedono, con l'eredità, `currentColor`, le variabili, `@layer` e le misure in
`em`; chi entra in un altro livello o in un altro gruppo ne prende l'opacità e
la visibilità, come gli oggetti di FubDraw, e tiene il resto.

Il comando non si fa, e dice perché, quando non si può sapere o non si può
rifare l'aspetto di prima: un selettore che FubDraw non legge; una regola che
dipende da dove si guarda il disegno, come `@media (min-width: …)` o la stampa
(`:hover` invece non vale mai, perché il disegno è fermo); un gruppo che dà a
ciò che contiene un effetto d'insieme, come un filtro o una maschera, che
senza di lui andrebbe perso; un foglio che darebbe un effetto al gruppo nuovo;
una copia collegata (`<use>`) che cambierebbe aspetto; un `@import` che non
sia di un servizio di caratteri. Un foglio che sceglie per classe, come quelli
di Illustrator, di solito non chiede niente.

## Incolli grandi

Un incolla lavora a fette, e intanto l'app risponde. Oltre un MiB di testo, o
dopo un quinto di secondo, una barra in cima al foglio dice che cosa fa e
quanto manca; «Interrompi» o `Esc` lo fermano, e il disegno non cambia. Se il
disegno cambia mentre l'incolla lavora, l'incolla non entra e lo dice.

## Lo stile

Dal [livello Standard](drawing.md#il-livello-standard), **«Copia lo stile»**
(`Ctrl+Alt+C` o `⌘⌥C`) prende lo stile del primo oggetto scelto, e **«Incolla
lo stile»** (`Ctrl+Alt+V` o `⌘⌥V`) lo dà agli oggetti scelti, in un passo; i
comandi sono anche nel menu della selezione. Lo stile è il riempimento, il
contorno con spessore, tratteggio, estremi e angoli, l'opacità e, per un
testo, il carattere del suo primo carattere che si vede: famiglia, corpo,
peso, corsivo, spaziatura e decorazioni, e l'interlinea di un testo di più
righe, che tutto il testo prende ([Disegni,
tipografia](drawing-typography.md)). Ogni parte prende ciò che ha: una
linea non riceve un riempimento. Un testo e un tratto a penna hanno un colore
solo, e prendono quello che si vede dell'oggetto copiato; una freccia ridisegna
la sua punta col contorno nuovo. Gli oggetti bloccati dentro un gruppo restano
come sono.

Lo stile copiato vale per tutti i disegni aperti, finché se ne copia un altro;
senza, «Incolla lo stile» dice come copiarlo.

## Chi monta l'editor

Le regole stanno in `apps/client/src/editors/spatial/tools/clipboard.ts`, lo
stile in `look.ts` e il PNG in `png.ts`. Chi monta l'editor gli dice dove sta
il disegno con `place`, che riscrive i percorsi del vault fra un disegno e
l'altro. Gli appunti di sistema passano dalla porta della shell,
`apps/client/src/platform/clipboard.ts`.
