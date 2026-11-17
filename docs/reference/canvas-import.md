# Da Mermaid e da una scaletta

> **Ambito:** le operazioni `from_mermaid` e `from_outline`: quale parte di
> Mermaid e delle scalette si legge, come diventa schede, gruppi e archi, come si
> dispone, e che cosa dicono le note quando qualcosa non si tiene.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/import/` (i lettori e la
> disposizione), `crates/fub-canvas-core/src/ops/import.rs` (gli id, il posto e
> le toppe), i test in `crates/fub-canvas-core/tests/import_vectors.rs`, e le
> coppie testo → lavagna in `apps/client/src/__fixtures__/canvas-import/`.

Un modello scrive già Mermaid e le scalette: queste due operazioni li fanno
diventare una lavagna vera, disposta, con gruppi e frecce. Le altre operazioni
stanno nella [lavagna come codice](canvas-code.md#le-operazioni), il loro schema
in [Lo schema delle operazioni](canvas-schema.md).

## La forma

```json
{ "op": "from_mermaid", "text": "flowchart LR\n  A[Evaporazione] --> B[Condensazione] --> A", "near": "t1", "side": "bottom", "prefix": "m-" }
{ "op": "from_outline", "text": "Progetto\n  Ricerca\n  Sviluppo", "direction": "right", "x": 0, "y": 600 }
```

Il risultato è un **blocco**: l'angolo in alto a sinistra del tutto va in `x`,
`y` (insieme, senza aggancio), se no accanto a `near` sul lato `side` (di serie
`right`), se no nel posto automatico, con le regole di
[`insert`](canvas-code.md#insert). Ogni nodo è una scheda di testo con la misura
di nascita di [«Misure e posti»](canvas-code.md#misure-e-posti); ogni blocco
`subgraph` è un gruppo con il suo titolo come etichetta. I gruppi entrano prima
delle schede, il più esterno per primo, così stanno sotto di loro; gli archi
vanno in fondo alla lista. `created` dice gli id nell'ordine delle toppe: gruppi,
schede, archi.

**Gli id.** In `from_mermaid` l'id di una scheda o di un gruppo è quello di
Mermaid, con `prefix` davanti (di serie nessuno): è il nome che il modello ha
scelto. In `from_outline` l'id è `prefix` più il numero della riga (da 1), o,
senza `prefix`, viene dal seme. Un id già preso è `DuplicateId`, e il
[controllo](canvas-check.md) suggerisce un `prefix` libero. Gli archi prendono
sempre l'id dal seme.

## Mermaid

Si legge `flowchart` o `graph` (anche `flowchart-elk`), con il verso
dell'intestazione: `TD` o `TB` (dall'alto, di serie), `BT`, `LR` o `RL`. Un
altro diagramma (`sequenceDiagram`, `classDiagram`…) è `Invalid`: si legge solo
flowchart. Le righe finiscono a `\n` o `\r\n`; un `;` fuori da virgolette e
parentesi separa due istruzioni (`graph TD; A-->B;`); una riga che comincia con
`%%` è un commento.

**I nodi.** `A` (il testo è l'id), `A[testo]`, `A(testo)`, `A([testo])`,
`A{testo}`, `A((testo))`, `A[[testo]]`, `A>testo]`, e anche `A[(testo)]`,
`A{{testo}}`, `A[/testo/]`, `A(((testo)))`. Il testo può stare fra virgolette
(`A["Ciao (mondo)"]`), e allora può contenere i segni che chiudono la forma. Le
entità `#quot;`, `#amp;`, `#lt;`, `#gt;`, `#apos;` e `#35;` (un numero) diventano
il loro carattere, e `<br>` va a capo. Una forma che non è il rettangolo `[…]`
diventa un rettangolo con la nota `shape_dropped`; `:::classe` lascia la nota
`style_dropped`. Un id è fatto di lettere, cifre, `_`, e `-` fra due di loro.
Un nodo si può nominare prima di definirlo: vale, e il testo arriva dopo
(l'ultimo testo scritto vince).

**Gli archi.**

| Scritto | Arco |
|---|---|
| `A --> B` | una punta all'arrivo |
| `A --- B` | nessuna punta (`toEnd: none`) |
| `A <--> B` | una punta a ciascun capo |
| `A -.-> B`, `A ==> B` | una punta all'arrivo, e la nota `style_dropped` (tratteggiato, spesso) |
| `A --o B`, `A --x B` | una punta all'arrivo, e la nota `style_dropped` |
| `A -- testo --> B`, `A -->\|testo\| B` | con l'etichetta; anche `-. testo .->` e `== testo ==>` |
| `A ~~~ B` | nessun arco (è invisibile), e la nota `style_dropped` |

Gli archi vanno in catena (`A --> B --> C`) e con `&`: `A & B --> C & D` va da
ogni nodo di sinistra a ogni nodo di destra. Un trattino in più (`--->`) non
cambia niente.

**I blocchi.** `subgraph id [titolo]` … `end`, anche annidati. Senza titolo
(`subgraph id`) il titolo è l'id; con un titolo di più parole senza id
(`subgraph Le fasi`, o `subgraph "Le fasi"`) l'id è `subGraph` più il numero del
blocco. `direction LR` dentro un blocco dà il verso di quel blocco; senza, vale
quello del blocco che lo contiene. Un nodo sta nel blocco più interno in cui è
nominato per la prima volta dentro un blocco; un nodo nominato solo fuori è
libero. Un arco verso l'id di un blocco va al gruppo. Lo stesso id aperto due
volte è `Invalid`; un `subgraph` senza `end` si chiude alla fine del testo; un
`end` di troppo è una riga saltata.

**Ciò che si salta.** Le righe `classDef`, `class`, `style`, `linkStyle` e
`click` non si tengono: la nota `line_skipped`. Una riga che non si capisce si
salta tutta, con la nota `line_skipped`, e il resto vale finché resta almeno un
nodo; senza nodi è `Invalid`, con la prima riga sbagliata.

## La scaletta

Una riga è una scheda, e le righe vuote non contano. Un livello è 2 spazi o un
tab; i segni `-`, `*`, `+`, `1.` e `1)` all'inizio, seguiti da uno spazio, si
tolgono. Un arco va dal genitore a ogni figlio. Un rientro che non cade su un
livello vale il livello sotto (3 spazi sono il livello 1), e un rientro che salta
più di un livello vale un livello solo: in tutti e due i casi una nota
`indent_rounded` lo dice. Una riga con il solo segno è saltata (`line_skipped`).
Senza nessuna riga di testo è `Invalid`.

## La disposizione

Ogni blocco si dispone come un albero dentro di sé, con le schede e i blocchi che
contiene, e diventa un gruppo con un margine di 24 per lato; un blocco vuoto ha
la misura di nascita di un gruppo (480 × 320). I blocchi e le schede libere si
dispongono come un albero di primo livello. Un arco fra due elementi di blocchi
diversi conta, nel loro primo blocco comune, come un arco fra i due elementi che
li contengono; un arco fra un blocco e una scheda che sta dentro di lui non
dispone niente. L'albero è quello di [`layout`](canvas-code.md#layout) con
`kind: tree`: le radici sono gli elementi senza arco in arrivo, un ciclo si
spezza, fra due fratelli ci sono 24 e fra due strati 96, e una posizione a metà
pixel si arrotonda. Gli elementi di un blocco vanno nell'ordine in cui il testo
li nomina.

Il verso di Mermaid viene dall'intestazione (`TD` è `down`, `LR` è `right`, `BT`
è `up`, `RL` è `left`). Quello di una scaletta è `direction`, di serie `right`:
la radice a sinistra e i figli in colonna alla sua destra, così una scaletta
senza rientri è una colonna.

## Le note

Ciò che un'operazione non ha potuto tenere non è un errore: `Compiled` porta
`notes`, una lista di `{index, code, detail}` (`index` è l'operazione, `detail`
dice che cosa e in quale riga, in inglese come gli errori), al più 100, e
`notes_omitted`, quante ne restano fuori. Il [controllo](canvas-check.md) le
mostra come avvisi, per prime, e `canvas.apply` le mette nell'esito
([`notes`, `notes_omitted`](canvas-operations.md#comandi)).

| Codice | Quando |
|---|---|
| `shape_dropped` | un nodo con una forma che non è il rettangolo; un testo dato a un id che è un blocco (vale il titolo del blocco) |
| `style_dropped` | un arco tratteggiato, spesso, con una punta tonda o a croce, o invisibile; un nodo con `:::classe` |
| `line_skipped` | una riga `classDef`, `class`, `style`, `linkStyle` o `click`; una riga che non si capisce; un verso dell'intestazione sconosciuto (vale `TB`); un `end` di troppo; una riga della scaletta col solo segno |
| `indent_rounded` | un rientro della scaletta che non cade su un livello, o che salta più di un livello |

## I limiti e gli errori

| Errore | Quando |
|---|---|
| `TooMany` | un testo di più di 256 KiB; più di 2000 schede e gruppi; più di 10 000 archi (un `&` li moltiplica, e si conta prima di farli); più di 64 `subgraph` uno dentro l'altro; la lavagna oltre 100 000 schede o 200 000 archi |
| `DuplicateId` | un id (con il suo `prefix`) che la lavagna ha già |
| `UnknownNode` | `near` non è una scheda |
| `Invalid` | un diagramma che non è flowchart, o senza intestazione; nessun nodo (con la prima riga che non si capisce); un `subgraph` aperto due volte; una scaletta senza testo; un posto dato due volte o `side` senza `near` |

`tests/import_vectors.rs` fa girare le coppie di
`apps/client/src/__fixtures__/canvas-import/` (`about`, `before?`, `seed?`, `op`,
`expect`: la lavagna di dopo, gli id, le note, o l'errore), controlla che
l'inversa ridia la lavagna di prima, e prova i limiti, il tetto delle note e il
suggerimento del `prefix`. `UPDATE_MIRROR=1` riscrive `expect` di ogni coppia:
il diff si rilegge prima di tenerlo.
