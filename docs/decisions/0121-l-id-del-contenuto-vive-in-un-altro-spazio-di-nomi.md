# 0121 — L'id del contenuto vive in un altro spazio di nomi

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto *«`id` e `class`
del contenuto di una nota entrano nel DOM della shell»* di
[«I difetti da correggere»](../todo.md) — l'ultimo della sezione, che con questo
verbale sparisce **Commit**: *(questo commit)*

---

## La domanda

Un `id` è **globale nel documento**, e nella webview il documento è uno solo.
Dentro ci stanno due inquilini che non si conoscono: la scocca della shell, che
cerca i propri elementi per nome (`document.getElementById("save-state")`,
`#context-menu`, `#toast`, `#activity-panel`), e il contenuto di una nota, che
per rendere indirizzabile un blocco un `id` ce l'ha per forza.

`getElementById` restituisce il **primo** elemento in ordine di documento con
quel nome. Quindi la domanda non è «l'`id` del contenuto è pericoloso?»: è che
due parti del programma pescano nomi dallo stesso sacchetto senza sapere che
l'altra esiste, e chi ci finisce sopra vince per posizione.

Non è un'esecuzione di codice e non arriva da un estraneo: arriva da un vault.
Ma un vault si scarica.

## Cosa è risultato vero, e cosa no

**Falso, ed era la premessa del difetto: «una nota che contenga HTML con uno di
quegli `id` glielo prende».** L'HTML grezzo dentro un markdown **non torna
markup**. Il parser lo mette nel modello come `custom_kind::HTML` con l'HTML nel
campo `attrs.html`, e il renderer lo degrada a un `<div class="block-…">` vuoto:
sta scritto in due posti (`parse.rs`, «resta **dato**, non markup: chi lo
disegna decide, e oggi nessuno lo disegna», e `render.rs`, «l'HTML grezzo di
`custom_kind::HTML` resta **dato** e non torna markup»). Un
`<div id="save-state">` scritto in una nota non arriva mai al sanitizzatore.

Sembrava vera per una ragione onesta: il sanitizzatore **esiste**, e l'unica
lettura naturale di un sanitizzatore è che stia lì perché dell'HTML non nostro
passa. Passa — ma da altri tre ingressi (un tema, un `UiNode::Html`, un blocco
custom di un plugin a M5), che è esattamente ciò che la sua testata dice dal
primo giorno.

**Vero, e per una via peggiore di quella descritta.** L'`id` del contenuto non
ha bisogno di HTML: lo emette il **nostro** provider markdown, e da due sorgenti
che sono entrambe testo che l'utente scrive.

- `anchor: Some(heading_slug(text))` in `parse.rs`: l'ancora di un heading **è
  il suo slug**. `## save-state` diventa `<h2 id="save-state">`.
- `trailing_anchor`: `^save-state` in coda a un paragrafo diventa
  `<p id="save-state">`.

Cioè il vettore non è un vault con dentro dell'HTML ostile: è un vault con
dentro un **titolo**. Il difetto era più facile da innescare di come era
scritto, e la riparazione richiesta era la stessa.

**Vero: il campione non era il censimento.** Il difetto nominava quattro `id`
(«`save-state`, `activity-panel`, `context-menu`, `key-pending`, …»). I nomi
della shell misurati — `index.html`, i `getElementById`, i
`querySelector("#…")`, i `.id = "…"` letterali e le famiglie che
`identificatore()` genera per l'accessibilità — sono **sessantuno**. Fra questi
ce ne sono di *generati* (`albero-1`, `campo-3`, `linguetta-2`), cioè nomi che
nessuno ha scelto e che una nota può contenere per caso: `^albero-1` è un'ancora
che un utente scriverebbe senza pensarci.

**Falso: che la risoluzione delle ancore fosse codice nostro da cambiare.** Il
difetto chiedeva «la risoluzione delle ancore che lo applica dalla stessa
parte», e la prima ipotesi è stata che ci fosse un pezzo di shell che cerca un
blocco per `id`. Non c'è: `openWikilink` risolve `[[Nota#^blocco]]` col kernel e
ci arriva con `revealByteOffset`, cioè per **offset in byte**, che è la scelta
della [0049](0049-una-posizione-dentro-un-documento.md). Chi risolve l'ancora
nel DOM è il **browser**, quando in una nota c'è un `[testo](#sezione)` e
l'utente lo clicca.

Il che rende la riparazione più piccola e molto più forte di come sembrava:
entrambe le metà stanno **dentro il sanitizzatore**.

## La decisione

**Ogni nome che viene dal contenuto vive sotto un prefisso, e a metterlo è il
varco unico che tutto il contenuto attraversa.**

Il prefisso è `fub-contenuto-` e sta scritto in un posto, `SPAZIO_CONTENUTO` in
`frontend/src/ui/sanitize.ts`. Non lo legge nessuno fuori da quel file.

**Perché il sanitizzatore e non i produttori.** Perché è la forma che il §3.6 ha
già scelto: c'è un solo punto in cui dell'HTML entra nella webview, e ciò che
vale per *ogni* HTML si scrive lì. Metterlo nel provider markdown lo avrebbe
messo per il produttore di oggi e non per il tema, l'embed di terzi, il blocco
custom di un plugin — cioè avrebbe riaperto la crepa che il varco unico era nato
per chiudere. Un `id` che entra dal contenuto **non può** essere nudo, perché
non c'è una strada che non passi di qui.

**Perché una funzione e non una costante usata due volte.** Le metà sono due —
l'`id` che si **scrive** e il `#frammento` che lo **cerca** — e sono la classe
di difetti in cui *si aggiorna il lato che si stava guardando*. Prefissare solo
la prima spegne ogni link interno di ogni nota; prefissare solo la seconda non
ripara niente. Quindi il prefisso non è una costante che due rami si copiano:
sopra ci sta **una** funzione, `valoreDellAttributo(nome, valore)`, che prende
il nome dell'attributo e decide — identità per tutti tranne i due che nominano
un identificatore. Il cammino sul DOM la chiama **una volta sola**, per ogni
attributo, senza sapere quali riguardi:

```ts
nuovo.setAttribute(nome, valoreDellAttributo(nome, attr.value));
```

I due lati non possono divergere perché non sono due posti. Non è un tipo — una
stringa resta una stringa — ma è la cosa più vicina che questo linguaggio
concede: non c'è una seconda espressione da tenere allineata.

**Il `#` nudo non si tocca.** `href="#"` è il segnaposto che il provider mette
sui wikilink, con la navigazione presa dai `data-*`: prefissarlo lo
trasformerebbe in un salto verso un blocco inesistente. Un `#` solo non nomina
niente, e la condizione è nella funzione con la sua riga.

**`class` resta com'è.** Il difetto la nominava nel titolo, ma una `class` non è
un nome globale e nessuno cerca la shell per classe: il selettore di un tema è
già dentro il suo albero. Restringerla avrebbe spento il contratto col provider
markdown (`.callout`, `.wikilink`, `.embed`, `.task`) senza riparare niente.

## La regola

**Due parti che non si conoscono non condividono uno spazio di nomi globale, e a
separarle è il punto che entrambe attraversano — non quello che si ricorda di
farlo.**

E il corollario che ha deciso la forma: **quando una separazione ha due metà che
si contraddicono se divergono, non si scrivono due volte le stesse regole — si
scrive una funzione che le produce entrambe.**

## Il rosso

Tre presidi, e ognuno è stato reso rosso in un modo diverso, perché si rompono
in modi diversi.

**Il verso della collisione** — `frontend/src/ui/sanitize.dom.test.ts`,
`happy-dom`. Il contenuto entra per primo nel documento e la barra di stato
dopo: l'ordine è quello **cattivo** di proposito, perché `getElementById` dà il
primo, e con l'ordine inverso il presidio passerebbe anche senza riparazione.
Tolta la riscrittura:

```
FAIL … una nota che porta il nome di un elemento della shell non se lo prende
AssertionError: expected <p id="save-state"></p> to be <div id="save-state"></div>
FAIL … vale per ogni nome, non per quello che avevamo in mente
AssertionError: expected 'context-menu' not to be 'context-menu'
```

**Il verso dell'ancora**, che è quello che si dimentica. Prefissato l'`id` e
**non** il frammento — cioè la riparazione fatta a metà, che è la forma in cui
questo difetto si sarebbe ripresentato:

```
FAIL … un link interno atterra sul blocco che nomina
AssertionError: expected null not to be null
FAIL … lo slug di un titolo è un'ancora come le altre
FAIL … le due metà del prefisso sono la stessa espressione, non due
AssertionError: expected 'fub-contenuto-blocco-1' to be 'blocco-1'
```

L'ultimo dei tre sta in `sanitize.test.ts` e non tocca il DOM: è l'**identità**
fra i due lati
(`valoreDellAttributo("id", x) === valoreDellAttributo("href", "#"+x).slice(1)`),
cioè la cosa che si rompe per prima e prima che qualcosa si veda a schermo.

**Il conto** — perché i due presidi sopra poggiano su una premessa che va tenuta
vera: che nessun nome della shell viva sotto il prefisso. È un conto e non un
test di comportamento perché la domanda è su un **elenco**, che è la divisione
della [0110](0110-la-struttura-non-e-una-preferenza.md). L'elenco non è scritto
a mano: si leggono `index.html` e ogni modulo con `?raw` e si tirano fuori i
nomi da tutte le forme in cui la shell ne pronuncia uno — un elenco a mano
sarebbe invecchiato al primo pannello nuovo, che è esattamente il modo in cui
questo difetto era nato. Il conto ha una soglia (`> 50`) perché un conto che
smettesse di trovare i nomi passerebbe a vuoto; misurato: sessantuno. Cambiato
il prefisso in `save-`:

```
FAIL … nessun nome della shell vive nello spazio del contenuto
AssertionError: un nome della shell è finito sotto il prefisso del contenuto:
expected [ 'save-state' ] to deeply equal []
```

I presidi del DOM stanno in un **file a sé** e non in un `describe` di
`sanitize.test.ts`: l'ambiente di vitest è per file, e la politica pura gira
senza DOM apposta. Il commento che in quel file diceva «il cammino sul DOM non è
testato perché questa shell non ha un ambiente DOM» era una delle righe che la
[0112](0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md) ha misurato
false, ed è stato riscritto.

## Cosa resta scoperto

- **Un `id` del contenuto può ancora collidere con un altro `id` del
  contenuto.** Due note trascluse nella stessa pagina con lo stesso slug erano
  ambigue prima e restano ambigue adesso, spostate di un prefisso. È un difetto
  di HTML, non della separazione: chiuderlo vorrebbe dire un nome per esemplare
  di embed, e non c'è un cliente che lo chieda.
- **La shell non ha un attore che le impedisca di scegliere domani un `id` che
  cominci col prefisso.** Il conto lo *scopre*, non lo impedisce — ma lo scopre
  su ogni nome, comprese le famiglie generate, che era il buco vero.
- **`aria-labelledby` e `for` non sono nell'allowlist**, quindi oggi non c'è un
  secondo attributo del contenuto che nomini un identificatore. Se ce ne
  aggiungessero uno, il posto dove ricordarsene è `valoreDellAttributo` — che è
  perché è una funzione con uno `switch` di casi e non due `if` sparsi nel
  cammino.
- **Il prefisso è invisibile all'utente ma non a chi apre gli strumenti di
  sviluppo.** Un `id` in una nota non è più l'`id` che si legge nel DOM, e la
  cosa va detta a chi scriverà un tema.
