# 0125 — Un albero riusato riceve una porta, non un handler

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: la prima delle due zone
cieche dichiarate dalla
[0118](0118-una-chiusura-non-cattura-cio-che-il-riconciliatore-aggiorna.md) —
*«l'`ActionHandler` di un sottoalbero riusato resta quello del primo montaggio»*
**Commit**: *(questo commit)*

---

## La coincidenza, che è la parte che interessa

La 0118 aveva lasciato scritto che il difetto c'era e non mordeva «per una
coincidenza che nessuno ha dichiarato», senza dire quale. Eccola.

`frontend/src/ui/views.ts` · `disegna` fabbrica **una chiusura nuova a ogni
ridisegno** e la passa a `mountTree`. Sono oggetti diversi — la funzione è
letteralmente costruita da capo a ogni giro — e sono tutti **intercambiabili**,
perché ognuno cattura solo `id` e `montata`: il primo è una stringa, il secondo
un riferimento a un record che vive nella mappa `montate` e i cui campi si
leggono **al momento della chiamata** (`montata.view`, `montata.instance`,
`montata.params`). Il record non viene mai sostituito finché il contenitore è lo
stesso, e `params` non è mai stato scritto da nessuno: è `null` alla creazione e
`null` per sempre. L'altro cliente, `panels/preview.ts`, passa `async () => {}`:
una chiusura nuova ogni volta anche lei, e vuota.

Quindi: **la shell ha oggi, per ogni contenitore, N handler distinti che si
comportano tutti allo stesso modo.** Chiamare quello del primo montaggio o
quello dell'ultimo produce lo stesso effetto. Questa è la coincidenza — e nel
codice non c'è una riga che la chieda, né un attore che se ne accorga il giorno
che smette di valere. Basta che qualcuno catturi nella chiusura una cosa che
cambia (un parametro di query, un token, un contatore di ridisegno, un
`AbortController`) perché il difetto passi da innocuo a silenzioso.

Un'osservazione che vale la coincidenza stessa: **la premessa della 0118 era
vera per la ragione sbagliata**. Là sta scritto «è vecchia ma identica» — la
parola *identica* suggerisce *la stessa*. Non è la stessa: è un'altra che fa la
stessa cosa. La differenza non si vede finché non si mettono due handler diversi
sullo stesso contenitore, che è esattamente ciò che nessun caso della 0118 fa —
tutti e cinque riusano **lo stesso** `onAction` fra i due montaggi, e per
costruzione non potevano vedere niente.

## Cosa è stato contato

Il sito dichiarato era uno: `handlerDi`. Le catture di un `ActionHandler` fatte
al primo montaggio e lette dopo, misurate, sono **due**, e la seconda è fuori
dal file nominato:

1. **`handlers` / `handlerDi`** (il dichiarato). Si scriveva solo in
   `renderUiNode`, cioè solo sul percorso del *disegno*: dal secondo montaggio
   in poi è vecchio, sempre, per ogni albero. Lo legge `patchTree` — e qui c'è
   la parte che nessuno aveva guardato: l'handler ripescato non viene solo
   *usato* per quel giro, viene passato a `riconcilia`, che lo **riscrive nei
   `legami`** di tutto il sottoalbero patchato. Un patch, cioè, disfa la
   riparazione della 0118 su un pezzo di albero, e da lì in poi quei campi
   mandano al primo handler anche fuori dal patch. Il difetto peggiore stava
   dentro la voce, ma un piano sotto la frase che la descriveva.

2. **Il renderer custom.** `disegna` · caso `custom` passa `onAction` a
   `customRenderer(ns)`, e il renderer se lo tiene per la vita del widget
   (`panels/graph.ts` · `disegnaGrafo` lo chiude dentro il gestore di click del
   canvas). Questa cattura è **la più longeva del file**: la riconciliazione di
   un `custom` con un `ns` noto non tocca l'elemento finché il payload non
   cambia, quindi un grafo aperto sopravvive a un numero illimitato di ridisegni
   della view attorno tenendosi l'handler del giorno in cui è nato.

Non sono catture, e sono state guardate una per una: gli ascoltatori delle
linguette (`intestazioniSchede` ricostruisce i bottoni a ogni giro, quindi le
chiusure sono fresche), `frecceFraSchede` (idempotente per `dataset.frecce`, e
cattura due elementi stabili), `disposizioni` (il disposer è legato all'elemento
che lo ha prodotto, e se l'elemento si rifà si rifà anche lui).

## La decisione: il tipo che gira dentro il renderer non è un handler

Le due riparazioni sono le stesse due della 0118, e si equivalgono ancora meno.

La prima è **riassegnare al riuso**: scrivere `handlers.set` anche in
`riconcilia`. Funziona, ha due siti invece di uno, e il secondo cliente — quello
di domani — non la eredita: il renderer custom continuerebbe a tenersi un
handler nudo, perché non risale nessuna mappa, ce l'ha in una variabile.

La seconda è **togliere di mezzo l'oggetto che invecchia**. Un contenitore ha
una **porta**: una funzione sola, creata al primo `mountTree` e mai più
sostituita, che a ogni chiamata inoltra all'handler dell'ultimo montaggio
(`Montaggio.corrente`). Dentro il renderer non circola altro. Chi la cattura —
un ascoltatore, una linguetta, il canvas di un renderer custom — cattura un
rinvio e non una destinazione, e la eredita giusta senza saperlo: è la prova del
secondo chiamante, ed è il motivo per cui il difetto n. 2 si è chiuso senza che
`custom.ts` o `graph.ts` cambiassero **una riga**.

Si è scelta la seconda, e ha tre conseguenze.

1. **`Porta` è un tipo, non una convenzione.**
   `type Porta = ActionHandler & { readonly [PORTA]: true }` con `PORTA` un
   `unique symbol` dichiarato e mai costruito: l'unica fabbrica è `instrada`, e
   un `ActionHandler` nudo passato a `riconcilia`, `disegna`, `collega`,
   `ascolta` o `azioniDelCampo` **non compila**. È la stessa forma della
   [0114](0114-una-finestra-non-si-omette.md) e del `SENZA_FINESTRA`, e la
   ragione per cui è un simbolo e non un nome per comodità è quella misurata
   nella 0117: *una costante di stringa non è un tipo*, e ciò che si può
   riscrivere a mano il compilatore non lo vede.
2. **`renderUiNode` non è più esportata.** Prendeva un `ActionHandler` da
   chiunque: lasciata pubblica sarebbe stata la porta di servizio da cui rientra
   esattamente ciò che si è appena tolto. Nessuno la usava da fuori — è stata
   misurata, non supposta.
3. **`patchTree` non risale più niente.** La porta la prende dal contenitore,
   che è dove sta la verità su chi instrada *adesso*. `handlers` e `handlerDi`
   spariscono: il difetto non si ripara, si cancella insieme al meccanismo che
   lo ospitava. Effetto laterale dichiarato: `patchTree` non può più tornare
   `false` per «non ho trovato l'handler», che era un modo di fallire che non
   voleva dire niente per il chiamante.

## La regola

**In un riconciliatore non gira un handler, gira una porta.** La 0118 lo diceva
dei dati che un ascoltatore legge quando l'evento scatta; qui è lo stesso, un
piano più in su e su un tipo invece che su una mappa: ciò che il riconciliatore
aggiorna non si passa per valore a chi sopravvive a un ridisegno.

Il corollario per chi tocca questo file: se una funzione del renderer avrà
bisogno di sapere «chi instrada», la riceverà come `Porta` — e se qualcuno prova
a darle l'handler vero, lo scopre dal compilatore invece che dall'utente.

## Il rosso

Due casi nuovi in `frontend/src/ui/node.test.ts` (unitari con `happy-dom`, per
la zona cieca del banco e2e dichiarata dalla
[0116](0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)), e
tutti e due montano lo stesso contenitore **due volte con due handler diversi**
in due registri separati — la cosa che nessun caso della 0118 fa, e senza la
quale non c'è niente da vedere.

Rimesso `node.ts` com'era, quattordici casi restano verdi e i due nuovi sono
rossi separatamente, uno per difetto:

- *un patch instrada al montaggio di adesso*: il click dopo il patch arriva al
  **primo** handler — `nuovo` è `[]` dove doveva dire `['tre']`;
- *un renderer custom che sopravvive alla riconciliazione*: la porta che il
  renderer si è tenuto chiama il **primo** handler — stesso conto, `[]` invece
  di `['tocca']`.

Ogni caso verifica anche che l'elemento sia lo stesso di prima del secondo
montaggio (e il secondo che il renderer sia stato chiamato **una volta sola**):
senza quelle righe il presidio passerebbe a vuoto il giorno in cui il
riconciliatore ricostruisse invece di riusare, che è la forma di fallimento
silenzioso misurata dalla 0116.

Il marchio è stato provato per conto suo: rimesso `onAction` al posto di
`montaggio.porta` in una sola chiamata di `mountTree`, `tsc` dice *«Argument of
type 'ActionHandler' is not assignable to parameter of type 'Porta'»*. Un
presidio che vive nel compilatore va visto rosso come gli altri.

## Cosa resta scoperto

Tre cose, nominate e non fatte.

La seconda zona cieca della 0118 resta aperta: nessun attore vede un
`addEventListener` scritto a mano dentro un ramo di `disegna` che chiami la
porta per conto suo. Il marchio impedisce di far circolare l'handler, non di
usare male la porta.

`intestazioniSchede` ricostruisce **tutte** le linguette a ogni riconciliazione
(`barra.replaceChildren()`), quindi una barra di schede che si ridisegna mentre
l'utente ci sta sopra col tab perde il focus. È il difetto che il §2.8 esiste
per evitare, sopravvissuto in un angolo dove i figli non passano da `figli`.

`disegna` · casi `select` e `radio` registrano il lettore del valore (`valore`)
una volta sola, e quella chiusura cattura `node` — mentre `aggiorna` non lo
rilega. Un `select` che passa da `multiple: false` a `true` fra due ridisegni
continua a riportare un `{ type: "text" }`. È la specie della 0118 applicata al
**valore** invece che all'azione: piccola, vera, e fuori dalla frase di questa
voce.
