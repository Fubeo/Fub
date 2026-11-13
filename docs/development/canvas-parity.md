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

## Che cosa non misura

- Il significato di una forma in codice: R2 dice che compila, non che faccia la
  cosa giusta. Questo lo provano i vettori in `apps/client/src/__fixtures__/canvas-ops/`.
- Il significato di un tasto: R7 dice soltanto se il file cambia quando la voce
  lo dice.
- Le voci di una fonte fuori da `merged`, che R7 non legge. Ogni voce di una
  fonte in `merged` ha almeno un `gui` che R7 controlla.
