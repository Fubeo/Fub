# Formule in Live

In Live, con la presenza `mai`, una formula si modifica toccandola: si scrive
sulla formula disegnata, come in un editor di equazioni, e il LaTeX non si
vede. Il file resta Markdown: quello che si scrive diventa il TeX fra `$…$` o
`$$…$$`. Il codice sta in `apps/client/src/editors/text/profiles/markdown/`
(`math-live.ts` per la nota, `math/` per l'editor, le regole e i punti del
cursore).

## Dove si scrive

- **Formula in riga.** Un clic sulla formula, o → e ← che ci entrano, aprono
  sotto di lei un riquadro con la formula in grande: si scrive lì, e la
  formula nella frase cambia mentre si scrive, evidenziata.
- **Formula a blocco.** Un blocco `$$` sulle sue righe si modifica sul posto,
  con un bordo del colore d'accento. Un blocco dentro una citazione o un
  elenco resta sorgente.
- **Formula con un errore.** Si apre col suo LaTeX a vista, e sotto il campo
  c'è subito che cosa non va (vedi «Gli errori»); si corregge lì.

## Il cursore

- Il clic mette il cursore nel punto toccato; l'altezza decide fra numeratore
  e denominatore, esponente e base.
- ← e → vanno un pezzo alla volta; ↑ e ↓ passano fra numeratore e
  denominatore, poi fra le righe della formula; oltre il bordo si esce nella
  nota.
- Gli spazi vuoti sono quadratini: Tab va al seguente, Maiusc Tab al
  precedente. Spazio esce dal pezzo in cui si scrive.
- Un comando scritto per nome (`\frac`, `\alpha`) entra quando è finito, con
  spazio, Tab o Invio; Esc lo toglie.
- Backspace e Canc non rompono mai la formula: tolgono un pezzo intero o ne
  escono. Tolto tutto, sparisce anche `$…$`; scrivere lo rimette.
- Ctrl Z e Ctrl Y tornano indietro dentro la formula; Invio ed Esc escono. Da
  un blocco in fondo alla nota si esce su una riga nuova.
- Il lettore di schermo sente dove sta il cursore («numeratore», «esponente di
  x», «fine della formula»), una volta per posto.

Una formula aperta e chiusa senza scrivere resta byte per byte com'era.

## I simboli per nome

- `\` e le prime lettere mostrano sotto la formula al più cinque proposte, col
  simbolo disegnato e il nome nella lingua dell'app; il nome scritto resta in
  una pastiglia finché non si sceglie, e la nota non cambia.
- ↑ e ↓ scelgono; Invio, Tab o spazio mettono la proposta scelta, e così il
  clic. Esc chiude le proposte (tornano con la lettera dopo); un secondo Esc
  toglie il nome.
- Si trova col comando (`\fr`), col nome in italiano o in inglese
  (`\radice`, `\arrow`) e con altre parole (`\somma`); un nome che non
  esiste propone il più vicino (`\alfa`, `\alpah` danno α).
- I pezzi entrano coi loro spazi vuoti, anche con le proposte chiuse:
  frazione `\frac{}{}`, radice `\sqrt{}`, sommatoria `\sum_{}^{}`, integrale
  `\int_{}^{}`, limite `\lim_{}`, testo `\text{}`; potenza e pedice coi loro
  tasti, `^` e `_`. Il cursore va nel primo spazio vuoto.
- Ctrl Z dopo un simbolo torna a prima della `\`.

Il catalogo (`math/symbols.ts`) dà a ogni simbolo il disegno, ciò che entra
nella formula, il nome in italiano e in inglese, le parole con cui si trova e
la sua scrittura veloce. Le proposte si scelgono in memoria, senza chiamate al
programma a ogni tasto.

## La tavolozza

- Sotto la formula toccata, in riga e a blocco, ci sono gli otto pezzi più
  usati (frazione, potenza, pedice, radice, sommatoria, integrale, limite,
  testo) e «Tutti». Un clic mette il pezzo dove sta il cursore, coi suoi spazi
  vuoti, e il fuoco resta nella formula.
- «Tutti» apre la ricerca, i sette gruppi del catalogo (struttura, lettere
  greche, operatori, relazioni, frecce, insiemi e logica, parentesi e matrici)
  e la griglia del gruppo scelto.
- La ricerca trova a parole, in italiano e in inglese, senza badare ad
  accenti e maiuscole: «radice», «alfa», «freccia», «minore», `root`,
  `\alpha`. Più parole restringono («freccia sin»); prima vengono i simboli
  che si chiamano così, poi quelli descritti con quella parola. Invio mette il
  primo. Senza risultati lo dice, e suggerisce di provare in inglese o di
  descrivere il simbolo.
- In fondo, il nome del simbolo sotto il puntatore o col fuoco, e la sua
  scrittura veloce («veloce: `sqrt`»); col LaTeX a vista anche ciò che entra
  (`\sqrt{}`). Ogni simbolo ha il suo nome anche per il lettore di schermo.
- Da tastiera: Alt ↓ dalla formula porta ai pezzi, che si scorrono con ← e →
  (un solo Tab per la fila). «Tutti» con Invio va alla ricerca; ↓ dalla
  ricerca porta alla griglia, che si percorre con le quattro frecce; ↑ dalla
  prima riga torna ai gruppi, che si scelgono con ← e →. Invio o spazio
  mettono il simbolo e il fuoco torna nella formula; Esc, o Maiusc Tab dai
  pezzi, ci torna senza mettere niente.
- Al telefono il riquadro è largo quanto lo schermo e la griglia ha otto
  colonne; a una finestra stretta i pezzi si stringono prima che «Tutti» esca
  dalla fila.
- Una formula con un errore non mostra la tavolozza; col LaTeX a vista la
  decidono gli aiuti (sotto).

La tavolozza (`math/palette.ts`) legge lo stesso catalogo delle proposte e
cerca in memoria: nessuna chiamata al programma a ogni tasto, e una ricerca
sta ben sotto un fotogramma.

## La scrittura veloce

Quello che si scrive com'è diventa LaTeX. Backspace subito dopo una
trasformazione la annulla e rimette ciò che si era scritto; la prima volta un
avviso lo spiega.

| Si scrive | Diventa |
| --- | --- |
| `a/`, `(a+b)/` | una frazione col numeratore (`\frac{a}{}`), il cursore al denominatore |
| `^`, `_` | l'esponente e il pedice (nella formula che si tocca); `x^10` diventa `x^{10}` |
| `*` | il punto del prodotto `\cdot` (nella formula che si tocca) |
| `(`, `[` | la coppia di parentesi, col cursore in mezzo; `)` scavalca quella chiusa, Backspace fra due vuote le toglie |
| `->`, `<->`, `=>`, `<=`, `>=`, `!=`, `+-`, `~=`, `...` | `\to`, `\leftrightarrow`, `\Rightarrow`, `\le`, `\ge`, `\ne`, `\pm`, `\approx`, `\dots` |
| `pi`, `alpha`, `sin`, `sum`, `inf`… seguiti da uno spazio o da un segno | `\pi`, `\alpha`, `\sin`, `\sum`, `\infty`; `sqrt` apre la radice |
| `3,14` | `3{,}14`, la virgola decimale; solo con l'app in italiano: in inglese la virgola separa |
| `"due parole"` | `\text{due parole}`; nella formula che si tocca `"` apre il testo e la seconda lo chiude |
| `α`, `×`, `≤`, `²`… già disegnati | il loro comando |

Nel testo (`\text{…}`) niente si trasforma, `->` compreso; una parola dentro
un'altra (`pin`) resta com'è. Il testo di un IME (cinese, giapponese, coreano)
entra com'è, senza scrittura veloce. Le regole stanno in `math/edit.ts`, senza
DOM: ogni tasto lavora sul TeX della formula aperta, in memoria.

## Quando si vede il LaTeX

La preferenza «Mostra il LaTeX delle formule» (`editor.math.source`, spenta di
partenza) mette sotto la formula, in riga e a blocco, il campo del suo LaTeX:
si scrive lì, e la formula sopra ne è l'anteprima. Il clic sulla formula porta
soltanto agli spazi vuoti; Tab va da uno spazio vuoto al seguente e fuori
dall'ultima graffa, poi segue il riquadro: i tre puntini, la tavolozza, la
nota. Le proposte dopo `\` dicono anche il comando.

Col campo valgono tre misure di aiuto (`editor.math.help`, «Pieni» di
partenza):

| | Pieni | Discreti | Spenti |
| --- | --- | --- | --- |
| Parentesi che si chiudono | sì | sì | no |
| Proposte dopo la barra rovescia | sì | sì | no |
| Scrittura veloce | sì | solo i segni già disegnati e le cifre di un esponente | no |
| Tavolozza | sempre | a richiesta: il pulsante «Simboli» o Alt ↓ | no |

Con «Spenti» restano il LaTeX e la sua anteprima, nient'altro. Nella formula
che si tocca gli aiuti sono sempre pieni.

I tre puntini del riquadro (in cima a destra della formula in riga, accanto al
campo, in fondo alla fila dei pezzi di un blocco; da tastiera Maiusc F10 o il
tasto del menu) cambiano «Mostra il LaTeX» e gli aiuti: la scelta vale subito
per tutte le formule aperte e si scrive nelle Impostazioni, sulla macchina. Se
non si può scrivere, torna la scelta di prima e un avviso lo dice. Un valore
degli aiuti scritto a mano che non è fra i tre vale «Pieni».

Con Vim resta il riquadro di prima, col TeX e l'anteprima; in sola lettura e
con la presenza `elemento` si vede la sorgente col cursore dentro.

## Gli errori

Nella formula che si tocca il TeX resta sempre leggibile: gli errori nascono
nel campo del LaTeX, e in una formula già rotta nel file. Mentre si scrive non
lampeggia niente: l'ultima resa buona resta com'è. Dopo 450 ms dall'ultimo
tasto la resa si attenua e sotto il campo compare una frase in chiaro, nella
lingua dell'interfaccia; una formula rotta nel file la mostra subito, perché
nessuno sta scrivendo. Il messaggio grezzo di KaTeX non si vede mai.

Quando la correzione è una sola, accanto alla frase c'è il suo pulsante:

| Che cosa non va | La frase | Il pulsante |
| --- | --- | --- |
| Graffe aperte | Manca una `}` di chiusura. | Chiudi |
| Graffe in più | C'è una `}` in più. | Toglila |
| Un nome che non c'è | Non conosco `\alfa`. Forse volevi `\alpha`? | Usa `\alpha` (tutti gli `\alfa`) |
| Un esponente, un pedice o un argomento vuoto | Dopo `^` manca l'esponente. · A `\frac` manca un pezzo. | Aggiungi lo spazio |
| `\left` senza `\right` | A `\left(` manca il suo `\right)`. | Chiudi |
| `\begin` senza `\end` | Manca `\end{matrix}`, che chiude `\begin{matrix}`. | Chiudi |
| `\begin` e `\end` diversi | `\begin{matrix}` si chiude con `\end{pmatrix}`. | Usa `\end{matrix}` |
| `$`, `#`, `%` nudi | In una formula `$` si scrive `\$`. | Usa `\$` |
| `\(` `\)` `\[` `\]` incollati | `\(` apre o chiude una formula: qui dentro non serve. | Toglilo (tutti) |
| Una lettera accentata | La lettera `à` in una formula va in un testo: `\text{à}`. | Mettila nel testo |

Un nome con più simboli vicini (`\s`) li elenca senza pulsante: la scelta è
di chi scrive. Gli altri errori noti (due esponenti di fila, un `&` fuori da
una matrice, una macro che si richiama, un ambiente che non c'è…) hanno la
loro frase senza pulsante; uno che KaTeX non spiega dice «Qui c'è qualcosa che
non torna:» col pezzo di TeX dove capita, o «C'è qualcosa che non torna nella
formula.».

La correzione non entra mai da sola: il TeX cambia solo col clic (o Invio,
o lo spazio) sul pulsante, ed è un passo solo dell'annulla. Se intanto il TeX
è cambiato, il pulsante non applica la proposta vecchia: la frase si rifà sul
TeX di adesso. Da tastiera il pulsante si raggiunge con Tab dopo l'ultimo
spazio vuoto, e Esc torna al campo. Le regole stanno in `math/errors.ts`,
senza DOM: `diagnose` legge l'errore di KaTeX e il TeX, `explain` lo mette in
parole.

## Limiti

La resa per scrivere usa KaTeX con i soli segni `data-fub*` ammessi; la resa
di lettura resta senza fiducia. Ogni tasto tocca solo la formula aperta: la
nota cambia con una modifica, la formula si ridisegna al fotogramma dopo.
