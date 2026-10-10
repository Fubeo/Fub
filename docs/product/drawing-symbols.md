# Disegni, simboli

> **Per chi:** chi ripete lo stesso disegno piccolo molte volte, una presa in
> una pianta, un'icona in uno schema, un albero in un giardino, e vuole
> cambiarli tutti insieme; e chi tiene nel vault i propri simboli, per usarli
> in ogni disegno.
> **Risultato:** sapere che cos'è un simbolo e un'istanza, come si crea, si
> modifica e si scollega un simbolo, che cosa fa la riga «Simbolo» del
> pannello delle proprietà, come si usano il pannello «Simboli» e le librerie
> del vault, e che cosa succede ai simboli negli appunti.

Dal [livello Esperto](drawing-expert.md) un disegno ha i suoi **simboli**:
disegni piccoli con un nome, che si mostrano tante volte quante servono. Ogni
volta che un simbolo compare è un'**istanza**, che lo mostra dov'è, girata e
grande come lei; cambiare il simbolo cambia tutte le istanze. Le operazioni
sono in `apps/client/src/editors/spatial/tools/symbols.ts`, le librerie in
`symbol-library.ts` e `symbol-libraries.ts`, il pannello in
`symbols-panel.ts`, accanto; il file in [formato della scena,
simboli](../reference/scene-format-symbols.md).

## Simboli e istanze

- **Il simbolo** sta fra le risorse del disegno e non si vede da solo: lo
  mostrano le sue istanze. Il suo contenuto sono oggetti come gli altri,
  forme, testi, immagini, gruppi, anche istanze di altri simboli; mai di sé
  stesso, nemmeno attraverso altri.
- **L'istanza** è un oggetto: si sceglie, si sposta, si gira, si ridimensiona,
  ha la sua opacità, la sua fusione, i suoi effetti, il suo ritaglio e la sua
  maschera. Il riempimento e il contorno sono del contenuto, e un'istanza non
  ha nodi: le forme si cambiano dentro il simbolo.
- **Il nome.** Un'istanza senza nome si chiama come il suo simbolo
  nell'albero degli oggetti, nella Lettura e negli annunci, «Presa»; con un
  nome suo, quello.
- **Un simbolo resta** anche quando nessuna istanza lo usa, finché non lo si
  elimina dal pannello «Simboli».
- **Il conto** del disegno conta il contenuto di un simbolo una volta sola:
  una presa usata cento volte ha le sue forme una volta.

Il file resta un SVG che ogni programma apre: il simbolo è un `symbol`,
l'istanza un `use`, e ogni lettore di SVG la disegna.

## Creare un simbolo

**«Crea simbolo»**, nella barra «Disponi», in «Selezione avanzata» e col
tasto destro, mette gli oggetti scelti in un simbolo nuovo, com'erano
scritti, e al loro posto, dov'era il più alto, lascia una sua istanza, che
resta scelta. Il disegno si vede come prima: l'origine del simbolo è il
centro di ciò che si vede degli oggetti, a numeri interi, e l'istanza ce lo
riporta. Gli oggetti di un altro livello vi entrano con la trasformazione che
li lascia dov'erano, come in un gruppo. Il nome è il primo libero, «Simbolo»,
«Simbolo 2»; lo si cambia dalla riga «Simbolo».

- **Gli agganci restano veri.** Un connettore fuori dal simbolo agganciato a
  un oggetto che vi entra resta agganciato all'istanza, se un capo solo vi
  entra; dentro, un capo agganciato a ciò che resta fuori si stacca.
- **A parole:** «Simbolo «Simbolo 2» creato: al posto degli oggetti scelti
  c’è una sua istanza.» Se gli oggetti non disegnano niente, il simbolo non si fa,
  e lo si dice: «Gli oggetti scelti non disegnano niente: per un simbolo serve
  qualcosa da vedere.».

## Modificare un simbolo

Due tocchi su un'istanza, `Ctrl+Invio` o `⌘Invio` con un'istanza scelta da
sola, e **«Modifica simbolo»** nel menu, nella riga «Simbolo» o nel pannello
aprono il simbolo dove quell'istanza sta, come un [gruppo
isolato](drawing-selection.md#isolare-un-gruppo): il resto si attenua, la
barra dell'isolamento dice «Simbolo «Presa»», l'albero mostra il contenuto
del simbolo. Ciò che si cambia o si disegna lì cambia il simbolo, e lo si
vede subito in tutte le istanze, anche mentre si trascina. Il contenuto si
sceglie nelle coordinate dell'istanza, con ciò che lei gli dà, l'opacità e i
ritagli.

`Esc` o «Esci dal simbolo» tornano fuori, con l'istanza scelta. Entrando lo
si dice: «Simbolo «Presa»: cambiarlo cambia tutte le sue istanze. Si sceglie
solo qui dentro; Esc esce.».

Un'operazione che farebbe contenere sé stesso a un simbolo, come incollarvi
una sua istanza, non si fa: «Modifica non applicata: un simbolo conterrebbe
sé stesso.».

## Scollegare

**«Scollega dal simbolo»**, nella barra «Disponi» quando fra gli oggetti
scelti c'è un'istanza, in «Selezione avanzata», col tasto destro e nella riga
«Simbolo», mette al posto di ogni istanza scelta un gruppo con una copia del
contenuto del simbolo: gli stessi oggetti, con id nuovi, la trasformazione,
l'opacità e gli effetti dell'istanza, e il suo nome o quello del simbolo. Le
risorse che il contenuto usa da solo si copiano come per un duplicato; i
connettori agganciati all'istanza restano agganciati al gruppo. Il simbolo
resta, con le altre istanze. «1 istanza scollegata: ora è un gruppo, che si
modifica da solo.»

Un simbolo con parti di un altro programma non si scollega, perché FubDraw
non le sa copiare, e lo si dice.

## La riga «Simbolo»

In testa alla sezione «Forma» del [pannello delle
proprietà](drawing-properties.md), quando fra gli oggetti scelti c'è
un'istanza. È un pulsante col suo menu, come la riga «Stile»
([Disegni, stili](drawing-styles.md)), e mostra il simbolo delle istanze
scelte, o «Misto» se sono di simboli diversi.

- **I simboli del disegno,** in cima al menu, ognuno con quante istanze ha.
  Sceglierne uno lo dà alle istanze scelte, al posto e con la trasformazione
  che hanno: «2 istanze ora mostrano «Presa».». Un simbolo che conterrebbe sé
  stesso, perché le istanze scelte stanno nel suo contenuto, resta sbiadito:
  «Conterrebbe sé stesso.».
- **«Modifica simbolo»**, con un'istanza sola.
- **«Rinomina simbolo…»** apre sotto la riga un modulo col nome di adesso,
  come quello degli stili; vale quando le istanze sono dello stesso simbolo.
- **«Scollega dal simbolo».**

**I nomi** si scrivono puliti, come gli altri: gli spazi raccolti, al più 200
caratteri. Due simboli non hanno lo stesso nome, con le maiuscole a parte:
«C’è già un simbolo «Presa»: scegline un altro.».

## Il pannello «Simboli»

Il pulsante **«Simboli»**, nel gruppo «Vista» dopo «Forme», apre accanto al
foglio il pannello dei simboli, e gli porta il fuoco; di nuovo, lo chiude. In
cima il campo **«Cerca un simbolo»** e quanti simboli si vedono, «12
simboli»; poi le sezioni:

- **«In questo disegno»**, i simboli del disegno, ognuno col numero delle
  istanze sotto l'anteprima, «3 istanze», «nessuna istanza». Senza simboli la
  sezione dice come averne: «Ancora nessun simbolo: scegli degli oggetti e
  usa «Crea simbolo», o inseriscine uno da una libreria.».
- **una sezione per ogni libreria** del vault, col nome del suo file
  ([Le librerie](#le-librerie)).
- **in fondo**, una riga che dice dove si cercano le librerie.

**I riquadri.** Ognuno ha l'anteprima del simbolo, fatta quando il riquadro
sta per vedersi, con le immagini e i [caratteri del vault](drawing-fonts.md)
del simbolo, e il nome sotto. Lo stato si dice a parole nel nome del
pulsante, «Presa, 3 istanze, la libreria ne ha una versione nuova», e un
segno lo ripete, mai il solo colore: il segno dell'aggiornamento su un
simbolo che la sua libreria ha cambiato, la spunta su un simbolo di una
libreria che il disegno ha già.

**La ricerca** guarda il nome del simbolo e quello della libreria, per pezzi
di parola, senza badare alle maiuscole né agli accenti; una sezione senza
risultati sparisce, e se non ne resta nessuna una riga dice «Nessun simbolo
per «xyz».».

**La tastiera.** Le frecce passano da un simbolo all'altro, anche da una
sezione all'altra; `Home` e `Fine` vanno al primo e all'ultimo. Dal campo,
`↓` porta al primo simbolo, e da lì `↑` torna al campo. `Maiusc+F10`, il
tasto del menu o il clic destro aprono i comandi del simbolo; `Esc` svuota il
campo, e a campo vuoto torna al foglio.

### Inserire

Un **clic**, **`Invio`** o **`Spazio`** inseriscono un'istanza **al centro
della vista**; **tirato sul foglio**, il simbolo si mostra dove andrebbe, con
la sua anteprima, e si aggancia come un oggetto spostato, alla griglia e alle
guide; lasciato, entra lì. Col dito, lo si solleva tenendolo fermo un
momento. `Esc`, o lasciarlo fuori dal foglio, non inserisce niente:
«Inserimento annullato.».

L'istanza entra dove entrerebbe una forma del pannello «Forme» ([Disegni,
raccolte di forme](drawing-library.md)): nel gruppo isolato, se c'è, o nel
livello corrente. È scelta, con lo strumento Selezione, e lo si dice:
«Simbolo inserito: Presa.». In un disegno in sola lettura i riquadri si
guardano, ma non inseriscono, e il pannello dice perché.

### I comandi

Per un simbolo del disegno, ognuno un passo di annulla:

- **«Inserisci»**, come il clic.
- **«Scegli le istanze»** sceglie le istanze del simbolo che si scelgono
  adesso, nel gruppo isolato o in tutto il disegno, a ogni profondità, e le
  porta in vista.
- **«Modifica simbolo»** apre il simbolo da una sua istanza, quella che si
  vede se ce n'è una.
- **«Rinomina simbolo…»** chiede il nome in una finestra, che torna col
  perché finché il nome non va.
- **«Aggiorna dalla libreria…»**, per un simbolo che viene da una libreria
  ([Aggiornare](#aggiornare)).
- **«Elimina simbolo»** lo toglie dal disegno; c'è quando il simbolo non ha
  istanze: «Ha delle istanze: si elimina quando non ne ha più.».

Per un simbolo di una libreria, «Inserisci»; se il disegno lo ha già, anche
«Scegli le istanze» e **«Aggiorna nel disegno…»**. Un comando che adesso non
vale resta, sbiadito, e dice perché.

## Le librerie

Una **libreria** è un disegno del vault coi suoi simboli. Le librerie stanno
nella cartella che l'impostazione del vault **`draw.symbols`**, «Cartella
delle librerie di simboli», dice; vale `Symbols`, e vuota è la radice del
vault. Ogni disegno che sta direttamente in quella cartella è una libreria;
per farne una basta disegnare dei simboli e salvarla lì. Il disegno aperto
non è una libreria per sé stesso: i suoi simboli stanno già in cima.

- **Si leggono quando servono:** la prima volta che il pannello si apre, poi
  quando cambiano la cartella, un suo file o l'impostazione. Un file che non
  è cambiato non si rilegge.
- **Una libreria che non va lo dice** al posto della griglia: «Si legge…»,
  «Non si legge: è più grande di 20 MiB.», «Non è un disegno di FubDraw.»,
  «Non si è riusciti a leggerla.», «Non ha simboli.». La riga in fondo dice
  dove si cercano, o che la cartella è vuota o non c'è, e come rimediare.

**Il primo inserimento** porta nel disegno una copia del simbolo con ciò che
usa: gli altri simboli, le sfumature, i motivi, le immagini. Il disegno non
rimanda mai al file della libreria, e si apre anche senza. La copia ricorda
da dove viene: la libreria, il simbolo e la sua **impronta**, che dice com'era
il simbolo con ciò che usa. Le immagini del simbolo arrivano con indirizzi
che valgono dal disegno. Se il disegno ha già un altro simbolo con lo stesso
nome, la copia prende il primo nome libero, «Presa 2».

**Dopo**, inserire lo stesso simbolo della libreria mette un'istanza di quello
del disegno: un simbolo di una libreria entra una volta sola. Se intanto la
libreria l'ha cambiato, lo si dice: «La libreria ne ha una versione diversa:
la porta nel disegno «Aggiorna nel disegno…», nel menu del simbolo.».

## Aggiornare

«Aggiorna dalla libreria…» e «Aggiorna nel disegno…» danno al simbolo del
disegno il contenuto che ha adesso nella libreria. Valgono quando la libreria
ha cambiato il simbolo dalla copia, o quando lo si è cambiato nel disegno, e
allora lo riportano com'è nella libreria. Sotto il comando una riga dice
com'è: «La libreria «Impianti» ne ha una versione nuova.», «È cambiato in
questo disegno: torna com’è nella libreria «Impianti».», «È uguale a quello
della libreria «Impianti».».

Prima di aggiornare, una finestra mostra il simbolo **com'è adesso** e **com'è
nella libreria**, uno accanto all'altro, e una frase dice che cosa succede:
quante istanze cambiano, e se le modifiche fatte nel disegno si perdono. Le
anteprime sono per chi le vede; la frase dice tutto anche a chi usa un
lettore di schermo. Confermato, il simbolo cambia in un passo di annulla e
tiene l'id, il nome e le istanze, che restano dove sono: «Il simbolo «Presa»
ora è come nella libreria.».

Che il simbolo sia cambiato nel disegno lo si sa provando l'aggiornamento su
una copia piccola, col simbolo e ciò che usa, senza badare agli id. Se è
cambiata anche la libreria la prova non dice niente, e la frase lo dice
così: «Se il simbolo è stato modificato in questo disegno, quelle modifiche
si perdono.».

## Appunti e duplica

- **Duplicare** un'istanza fa un'altra istanza dello stesso simbolo.
- **Copiare** porta negli appunti i simboli che le istanze usano, con ciò che
  usano loro.
- **Incollare** riconosce i simboli che il disegno ha già: un simbolo che
  arriva è quello del disegno con lo stesso nome e lo stesso contenuto, a
  parte gli id. Nello stesso disegno l'istanza incollata è del simbolo che
  c'era; in un altro disegno che lo ha già non si copia due volte. Un simbolo
  diverso con un nome preso arriva col primo nome libero, «Presa 2»
  ([Disegni, appunti](drawing-clipboard.md)).

## Esportare e altri programmi

L'SVG pulito tiene i simboli che un'istanza disegna, anche attraverso un
altro simbolo, e lascia gli altri; il PNG, il JPEG e il PDF disegnano ogni
istanza col suo simbolo ([Disegni, esportare](drawing-export.md)). Un
programma che non conosce i simboli di FubDraw vede `symbol` e `use`, che
ogni lettore di SVG disegna.

## Accessibilità

Il pannello è una griglia di pulsanti col nome e lo stato a parole; ogni
comando dice che cosa ha fatto. La [verifica
dell'accessibilità](drawing-accessibility.md) non misura il contrasto dentro
un simbolo, che in ogni istanza ha un fondo diverso. Un testo troppo piccolo
o un'immagine senza descrizione dentro un simbolo li segnala una volta sola,
nelle coordinate del simbolo, qualunque sia l'istanza.

## Livelli e parti

I simboli sono la parte «Simboli» del [Personalizzato](drawing-custom.md),
dall'Esperto: portano «Crea simbolo» e «Scollega dal simbolo», la riga
«Simbolo» e il pannello «Simboli». Senza, i simboli restano nel disegno e le
istanze si vedono, si scelgono e si spostano come ogni oggetto; un'istanza
apre il suo simbolo dove si isola un gruppo, con la selezione avanzata.
