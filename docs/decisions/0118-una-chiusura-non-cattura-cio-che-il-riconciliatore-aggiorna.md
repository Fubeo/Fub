# 0118 — Una chiusura non cattura ciò che il riconciliatore aggiorna

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto *«i campi di
testo restano attaccati all'azione del primo disegno»* di
[«I difetti da correggere»](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

Un `text_input` disegnato da `frontend/src/ui/node.ts` registra due ascoltatori
alla costruzione: il `change` e il `keydown` dell'Invio. Tutti e due catturano
l'`ActionRef` del nodo dentro la chiusura. Il riconciliatore (§2.8) però quel
campo lo **riusa**: gli aggiorna il valore e l'etichetta, e non tocca gli
ascoltatori. Dal secondo giro in poi il campo mostra il nodo di adesso e manda
l'azione di ieri.

Non è un accumulo di ascoltatori, che è la diagnosi arrivata da fuori: è peggio.
Un ascoltatore accumulato fa **due volte** la cosa giusta, e si vede — il
provider riceve due azioni per un gesto. Un ascoltatore invecchiato fa **una
volta** la cosa sbagliata: il campo funziona, il payload è quello di un nodo che
non esiste più, e nessuno se ne accorge finché qualcuno non guarda cosa è
arrivato dall'altra parte.

## Cosa era vero della descrizione, e cosa no

Vero: gli ascoltatori si registrano una volta sola, l'`ActionRef` è catturato,
`collega` invece toglie e rimette il suo. Falso per difetto: **non sono i campi
di testo**. Lo stesso `scatta` — l'altra porta, quella del `change` — lo
chiamavano sette specie di nodo (`text_input`, `date_picker`, `text_area`,
`number`, `slider`, `checkbox`, `select`, più ogni bottone di un `radio`), e in
`aggiorna` **nessuna** delle sette rilegava l'azione. La riga di `todo.md`
nominava un campione, non l'insieme; il difetto era di tutti i campi del
protocollo.

E c'era una seconda metà, invisibile finché si guarda un campo solo: un campo
che **perde** l'azione (`action: null` al giro dopo) continuava a mandarla,
perché `scatta` con azione nulla non registrava niente ma nemmeno spegneva ciò
che era già registrato. È il gemello esatto della riga che `collega` ha in casa
dalla prima stesura — «se questo elemento era attivabile e viene riusato per un
nodo senza azione, resterebbe nel giro del tab senza fare niente» — applicata
all'azione invece che al focus.

## La decisione: la chiusura non ha niente da invecchiare

Le due riparazioni possibili non si equivalgono.

La prima è **estendere la forma di `collega`**: tenere l'ascoltatore in una
mappa, toglierlo e rimetterlo a ogni riconciliazione. Funziona, e ha il difetto
di funzionare: va rifatta a mano dal prossimo che aggiunge un ascoltatore a un
campo, e quel prossimo non ha modo di sapere che doveva.

La seconda è **togliere alla chiusura ciò che invecchia**. L'ascoltatore si
registra una volta sola e cattura solo l'elemento e il nome dell'evento — due
cose che non cambiano mai —; l'azione e l'handler stanno in una mappa
(`legami`), che la riconciliazione aggiorna. Una chiusura che legge lo stato
corrente non può essere vecchia, e chi ne aggiunge una la eredita giusta senza
saperlo.

Si è scelta la seconda, e le tre conseguenze sono più interessanti della scelta:

1. **`ascolta` è l'unica porta.** `collega` diventa un suo chiamante (con la
   parte di accessibilità che è sua e basta), `azioniDelCampo` un altro.
   Chiamarla due volte sullo stesso elemento e sullo stesso evento non accumula:
   la seconda aggiorna l'azione e torna. Questo è ciò che rende **sicuro**
   richiamarla dal riconciliatore con la stessa disinvoltura con cui la chiama
   il disegno, e senza quella proprietà la riparazione avrebbe prodotto davvero
   l'accumulo che la diagnosi esterna descriveva.
2. **`azioniDelCampo` è l'unico posto dove un campo prende i suoi ascoltatori**,
   e lo chiamano il disegno e la riconciliazione con la stessa riga. Il terzo
   ascoltatore che qualcuno vorrà — un `input` che manda a ogni battuta, un
   `blur` — si scrive lì dentro e vale in tutte e due le vite del campo.
3. **`invia` non prende più un `ActionRef`.** Prende l'elemento e il nome
   dell'evento, e l'azione la risolve dalla mappa. È il presidio del
   compilatore: un'azione qui **non si può passare**, quindi non si può
   catturare in una chiusura, quindi non può invecchiare. La forma è quella di
   `SENZA_FINESTRA` nella [0114](0114-una-finestra-non-si-omette.md) — ciò che
   non si vuole più scrivere si rende non scrivibile, invece di scrivere accanto
   che non si fa.

## La regola

**In un riconciliatore, un ascoltatore non cattura ciò che il riconciliatore
aggiorna: lo legge quando l'evento scatta.**

Vale oltre i campi, e oltre questo file: la stessa forma è ciò che la testata di
`node.ts` dice già dei *valori* — «leggerli dal DOM e non da uno stato parallelo
è deliberato: lo stato parallelo è la seconda verità che diverge appena il
riconciliatore tocca un nodo». Un `ActionRef` catturato in una chiusura **è**
uno stato parallelo, solo scritto in un posto dove non sembra uno stato. La
regola che questo file applicava ai valori dal primo giorno non era mai stata
applicata alle azioni.

Il corollario operativo, per chi tocca un renderer riconciliato: se una chiusura
registrata una volta sola legge un dato che il riconciliatore aggiorna, il dato
va in un posto vivo — e la porta che lo aggiorna dev'essere **la stessa** che
registra l'ascoltatore, o le due cose divergono al primo che se ne dimentica.

Dove Invio vale come «ho finito» non è più un `if` scritto in un ramo: è
`accettaInvio`, cioè un `<input>` di testo o di data. In un `<textarea>` Invio è
un a capo, su una casella di spunta è la spunta, su un `number` non è niente: la
regola stava già nel codice, distribuita fra i rami che il `keydown` non
l'avevano.

## Il rosso

Il presidio è un test unitario sul riconciliatore
(`frontend/src/ui/node.test.ts`, con `happy-dom`) e **non** un caso del banco
e2e, per la ragione dichiarata dalla
[0116](0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md): là
`document` è uno per file, nessuno smonta ciò che monta, e un presidio è passato
verde anche togliendo la riga che difendeva. Qui ogni caso costruisce il suo
contenitore, monta con l'azione *A*, riconcilia con l'azione *B*, scatta
l'evento e guarda cosa è arrivato.

Rimesso il file vecchio, quattro casi su cinque diventano rossi, e i due rami
del difetto sono rossi separatamente:

- `change`: `[ 'prima' ]` invece di `[ 'dopo' ]`;
- `keydown` con Invio: `[ 'prima' ]` invece di `[ 'dopo' ]`;
- tre riconciliazioni di fila: `[ 'uno', 'uno' ]` invece di
  `[ 'quattro', 'quattro' ]` — che è il caso in cui si vede insieme che l'azione
  non invecchia **e** che gli ascoltatori non si moltiplicano;
- il campo che perde l'azione: `[ 'prima', 'prima' ]` invece di `[]`.

Il quinto — un tasto che non è Invio non manda niente — resta verde anche col
codice vecchio, ed è giusto così: non presidia il difetto, presidia la forma
nuova, cioè il predicato che ha preso il posto dell'`if` dentro la chiusura.

Ogni caso verifica **anche** che l'elemento dopo la riconciliazione sia lo
stesso di prima. Senza quella riga il presidio passerebbe a vuoto il giorno in
cui qualcuno facesse ricostruire i campi invece di riusarli — che è la forma di
fallimento silenzioso che la
[0116](0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md) ha
misurato altrove.

## Cosa resta scoperto

Due cose, nominate e non fatte.

L'`ActionHandler` di un sottoalbero riusato resta quello del **primo**
montaggio: `handlers` si scrive solo in `renderUiNode`, e `handlerDi`
(`frontend/src/ui/node.ts:129`) risale a quello quando arriva un `Patch`. Oggi
non morde, perché la chiusura che `views.ts` passa cattura `id` e `montata`, che
sono stabili per tutta la vita del pannello — cioè è vecchia ma identica. È la
stessa specie di difetto di questa voce, un piano più in su, e non morde per una
coincidenza che nessuno ha dichiarato.

E: nessun attore vede un ascoltatore registrato domani con un `addEventListener`
scritto a mano dentro un ramo di `disegna`. Il compilatore prende chi prova a
passare un'azione a `invia`; non prende chi si scrive la chiamata a `onAction`
per conto suo.
