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
- **Formula con un errore.** Si apre col suo LaTeX a vista, con una nota che lo
  dice; quando torna leggibile si corregge lì.

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

## Quando si vede il LaTeX

La preferenza «Mostra il LaTeX delle formule» (`editor.math.source`, spenta di
partenza) torna al riquadro col TeX e l'anteprima. Lo stesso vale con Vim, in
sola lettura e con la presenza `elemento`, che mostra la sorgente col cursore
dentro.

## Limiti

La resa per scrivere usa KaTeX con i soli segni `data-fub*` ammessi; la resa
di lettura resta senza fiducia. Ogni tasto tocca solo la formula aperta: la
nota cambia con una modifica, la formula si ridisegna al fotogramma dopo.
