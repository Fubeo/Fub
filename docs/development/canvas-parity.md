# La parità della lavagna

> **Per chi:** chi aggiunge un gesto, un menu, un tasto o un'operazione alla
> lavagna, e chi porta in `main` una fonte (N4, N6).
> **Risultato:** sapere che cosa misura l'inventario della parità, quali test
> lo controllano e che cosa fare quando una voce cambia.
> **Fonte autorevole:** i file in `apps/client/src/__fixtures__/canvas-parity/`
> e i test che li leggono, elencati sotto.

La parità conta le azioni della GUI che hanno anche una forma in codice.
L'inventario dice dove sta ciascuna, se scrive il file e quale operazione la
fa. Due test lo leggono: una voce tolta li fa diventare rossi.

## Che cosa misura

Una voce descrive un'azione che una persona fa dalla GUI: una voce di menu, un
tasto, un gesto, un campo, un'azione degli appunti. Ha un `id` che comincia
con la fonte, un `name`, la `source`, la lista `gui`, `writes` (`file`,
`nothing` o `other-file`) e uno `state`.

| Stato | Vuol dire | Campi |
|---|---|---|
| `code` | un'operazione la fa con la stessa regola | `ops` |
| `composed` | operazioni più un'altra porta | `ops`, `port` |
| `port` | la fa un'altra porta, per esempio l'annulla | `port` |
| `by_hand` | si fa con le operazioni, ma chi scrive calcola a mano ciò che la GUI decide | `ops`, `computes`, `target_ops`, `task` |
| `missing` | nessuna operazione la fa | `computes`, `target_ops`, `task` |
| `view` | non scrive il file | nessuno; `writes` è `nothing` |
| `exception` | resta fuori dalla parità | `note` dice perché |

`ops` sono le operazioni che il nucleo già compila. `target_ops` è la forma che
porterà il task `task`. `computes` dice che cosa la GUI decide.

## I file

| File | Contenuto |
|---|---|
| `board.json` | la lavagna di prova, le fonti in `merged` e le operazioni senza un gesto (`ops_without_gui`) |
| `main.json`, `n4.json`, `n6.json` | le voci di una fonte ciascuna; `max_missing` è il numero delle voci `by_hand` e `missing` del file |

Una fonte è in `merged` quando è già in `main`. Le sue voci hanno i `gui` veri.
Una fonte fuori da `merged` ha `plan`, il task del piano che la porterà.

Ogni elemento di `gui` ha un solo campo: `menu` (l'id del menu), `toolbar`
(il `data-canvas-action` della barra), `field` (il `data-canvas-field`), `key`
(il tasto), `gesture` (il nome del gesto), `clipboard` (l'azione degli appunti)
o `plan`.

## Le regole

- **R1, il vocabolario.** Gli `id` sono unici e cominciano con la fonte. Stati,
  fonti, `writes`, tipi di `gui` e nomi di operazione vengono dai vocabolari. Un
  `task` è `T` seguito da un numero.
- **R2, le forme compilano.** Le `ops` delle fonti in `merged` compilano su
  `board` col seme 1. Una fonte in `merged` non ha più voci `plan`.
- **R3, i campi per stato.** Ogni stato ha i suoi campi, come nella tabella.
  Una voce `view` scrive `nothing`.
- **R4, il cricchetto.** Se le `target_ops` di una voce compilano, la voce va
  spostata: le operazioni vanno in `ops` e lo stato cambia.
- **R5, il conto.** `max_missing` di ogni file è uguale alle sue voci `by_hand`
  e `missing`. Il conto scende soltanto.
- **R6, ogni operazione ha una voce.** Ogni operazione del nucleo compare in
  `ops` o `target_ops` di una voce, o in `ops_without_gui`. I nomi si leggono
  dall'errore di serde per un'operazione che non esiste: se il messaggio
  cambia, il test fallisce subito.
- **R7, la GUI.** `parity.test.ts` monta la tela in più stati: il vuoto, le
  schede `t1`, `f1` e `l1` da sole, due o tre schede insieme, un arco e un
  gruppo. Raccoglie gli id di menu (anche nei sottomenu), barra, campi e
  appunti. Ogni id ha una voce, e ogni voce trova il suo id. I gesti sono
  quelli della costante `GESTURES`, i tasti quelli di `KEYS`. Ogni tasto delle
  voci si preme su `t1`, e dopo una mossa per l'annulla: il file cambia se e
  solo se la voce dice `writes: file`.

## Dove stanno i test

| Test | Regole | Comando |
|---|---|---|
| `crates/fub-canvas-core/tests/parity.rs` | R1–R6 | `cargo test -p fub-canvas-core --test parity` |
| `apps/client/src/editors/canvas/parity.test.ts` | R7 | `npx vitest run src/editors/canvas/parity.test.ts`, da `apps/client/` |
| `crates/fub-canvas-core/tests/task_corpus.rs` | il corpus: forma, `needs` e controlli | `cargo test -p fub-canvas-core --test task_corpus -- --nocapture` |

`apps/client/src/editors/canvas/test-mount.ts` monta la tela come
`engine.test.ts`. È una copia: chi cambia il montaggio lì lo cambia anche qui.

## Aggiungere un gesto

Un gesto nuovo della tela entra in tre passi:

1. una voce `gesture` nel file della sua fonte, con `ops` (la forma in codice)
   oppure con `exception` e una `note` che dice perché resta fuori;
2. il suo nome in `GESTURES` in `parity.test.ts`, con una riga che dice che
   cosa fa;
3. se il gesto ha un menu, una barra o un campo, la voce lo dichiara, e R7
   controlla che la tela lo mostri.

Un gesto nella lista senza una voce fa fallire R7. Un gesto nuovo della GUI
senza la sua riga in `GESTURES` non fa fallire nulla: il DOM non lo mostra, e
la lista si tiene a mano. Vale lo stesso per `KEYS`.

## Quando una fonte arriva in main

Chi porta in `main` N4 o N6, o porta `main` su un ramo dove ci sono, aggiorna
lo stesso commit:

1. aggiunge la fonte a `merged` in `board.json`;
2. sostituisce i `plan` con i `gui` veri: menu, barra, campo, tasto, gesto,
   appunti;
3. aggiunge le voci dei gesti nuovi, con la loro forma in codice o con
   l'eccezione.

R2 fallisce se una fonte in `merged` ha ancora un `plan`; R7 se una voce non
trova il suo id. Fuori da `merged` una voce è letta da R1, R3 e R5 soltanto.

## Il corpus

Il corpus misura quanto costa un compito con le operazioni di `main` e con
quelle del piano. Sono venti file in `apps/client/src/__fixtures__/canvas-tasks/`,
un compito ciascuno, letti da `task_corpus.rs`.

Un compito è un oggetto con questi campi:

| Campo | Vuol dire |
|---|---|
| `about` | che cosa prova, in una riga |
| `prompt` | la richiesta come la scriverebbe una persona, in italiano |
| `before` | la lavagna di partenza |
| `ops_today` | la soluzione con le operazioni di `main`, o `null` se con `main` non si può |
| `ops` | la soluzione con le operazioni del piano |
| `needs` | facoltativo: le operazioni e i campi che `ops` usa e il nucleo non ha ancora |
| `checks` | i controlli sul modello di dopo |

Le regole del runner:

- `ops_today`, se c'è, compila su `before` e passa i `checks`.
- Con `needs` vuoto, anche `ops` compila e passa.
- `needs` è esatto. Un nome che le `ops` usa e il nucleo non ha manca: fallisce.
  Un nome che il nucleo ha già fallisce e dice di toglierlo (il cricchetto). Un
  nome che le `ops` non usano fallisce. Un nome è un'operazione (`align`) o un
  campo (`add_card.near`); un'operazione sconosciuta conta col suo solo nome.
- `ops_today` a `null` richiede un `needs` non vuoto: serve dire che cosa manca.
- Le `ops` del piano sono proposte. La forma di ogni operazione la decide il task
  che la porta, e il cricchetto obbliga a riallinearle quando arriva.

Una scheda si nomina per testo, per file con il sottopercorso (`Dispensa.pdf#page=1`),
o per indirizzo; un gruppo per `label`. Un nome deve identificare una scheda
sola: due schede con lo stesso testo fanno fallire il controllo. Per questo i
testi del corpus sono unici.

| Controllo | Regge se |
|---|---|
| `has_card` | `{text}` o `{file}`: c'è una scheda con quel nome |
| `has_edge` | `{from_text, to_text, label?}`: c'è un arco dal primo nome al secondo |
| `no_overlap` | `{texts?}`: nessuna coppia di schede si sovrappone (senza `texts`, tutte le schede tranne i gruppi) |
| `aligned` | `{texts, axis}`: il bordo o il centro scelto è uguale; `axis` è `left`, `right`, `top`, `bottom`, `center_x` o `center_y` |
| `spaced` | `{texts, axis}`: lo spazio fra i bordi è uguale fra le schede in ordine, lungo `x` o `y` (almeno tre) |
| `count` | `{kind, n}`: `kind` è `edge`, `card` (le schede tranne i gruppi), `group` o una specie di `card_kind` (`text`, `note`, `document`, `sheet`, `pdf`, `image`, `web`, `craft`, `file`) |
| `in_group` | `{label, texts}`: il gruppo con quell'etichetta contiene le schede |
| `color` | `{texts, color}`: il colore è `red`…`purple`, `"1"`…`"6"` o `#rrggbb` |
| `strokes` | `{on_text?, n}`: quanti tratti ha la scheda, o senza `on_text` tutta la lavagna |

`strokes` conta l'array `strokes` del livello `fub:ink`, nella forma che N4
documenta, senza leggerne i campioni. Quando il lettore di N4 entra nel nucleo,
il controllo va verificato contro di lui.

Il runner stampa la tabella dei caratteri (`ops_today`, `ops` in JSON compatto)
e quanti nomi mancano al nucleo: `cargo test -p fub-canvas-core --test task_corpus
-- --nocapture`.

Le risposte di un modello si provano così, fuori dalla CI:
`FUB_CANVAS_ESITI=<cartella> cargo test -p fub-canvas-core --test task_corpus
esiti_di_un_modello_se_richiesti -- --nocapture`. La cartella ha un file
`<compito>.json` per compito: la lista delle operazioni, come `ops`. Il test
le applica a `before` e dice quali passano; un compito senza file salta, e lo
dice. Senza la variabile non fa nulla, e in CI non gira nessun modello.

## Che cosa non misura

- Il significato di una forma in codice: R2 dice che compila, non che faccia la
  cosa giusta. Questo lo provano i vettori in `apps/client/src/__fixtures__/canvas-ops/`.
- Il significato di un tasto: R7 dice soltanto se il file cambia quando la voce
  lo dice.
- Le voci di una fonte fuori da `merged`, che R7 non legge. Ogni voce di una
  fonte in `merged` ha almeno un `gui` che R7 controlla.
