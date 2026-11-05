# Piano: La lavagna in codice

Branch: piano/lavagna-in-codice
Obiettivo: tutto ciò che una persona fa sulla lavagna con il mouse, la penna
o la tastiera si scrive anche in codice, in poche righe di JSON senza
coordinate obbligatorie. Un assistente IA legge la lavagna come codice,
controlla le sue operazioni (gli errori dicono come correggerle), ne vede
l'anteprima e le applica con le stesse regole della GUI. Un test conta ciò
che manca e non lascia entrare un gesto nuovo senza la sua forma in codice.
Perché: l'utente vuole il massimo dell'integrazione con i modelli che
scrivono codice: «attraverso il codice si deve poter fare esattamente ciò che
una persona fa con l'interfaccia». Le operazioni ci sono già (`canvas.apply`,
`fub_canvas_apply`), ma chiedono coordinate, misure e id calcolati a mano, e
l'inchiostro è una stringa opaca. Contate in `PLAN-parita.json`, 36 delle 72
azioni della GUI (main, N4, N6) si fanno solo calcolando a mano ciò che la
GUI decide da sé (31), o non si fanno affatto (5).
Fuori scope:
- l'editor dei disegni SVG e la sua forma in codice: è di K6, qui c'è solo
  «Per K6»;
- un linguaggio di testo nuovo (DSL) o un motore JavaScript nel nucleo: la
  forma è JSON, una lista di operazioni;
- il formato su disco: `.canvas` resta JSON Canvas 1.0, e `fub:ink`,
  `fub:parts` e le ancore restano come li scrivono N4 e N6. Nessun campo
  nuovo nel file;
- la vista (zoom, scorrimento, selezione, navigatore, lettore): non cambia il
  file. La fa la GUI, e il codice ha `canvas.read`;
- porte IPC nuove: tutto passa dai comandi registrati
  (`list_commands`/`invoke_command`) e dal server MCP;
- un sottocomando nuovo della CLI: bastano `fub exec` e `fub mcp`;
- scrivere dentro il file di una scheda (nota, foglio): è dell'editor di quel
  formato (voce `N6.card.write_inside`, stato `port`);
- guide e griglia durante il gesto, impostazioni della lavagna: sono
  eccezioni con nome nell'inventario;
- la collaborazione dal vivo fra più scrittori; gli altri formati spaziali;
- la misura del testo con le metriche vere del font: il nucleo stima con una
  regola fissa (vedi «Misure e posti»).
Assunzioni:
1. N4 (PR #298, fino a T19 fatto) e N6 (PR #302, a T25 in corso), letti il
   2026-11-05, finiscono come sono scritti. Ogni task che aspetta un loro
   task lo nomina in «Dipende da». Se cambiano, cambia la voce
   dell'inventario, non la forma di questo piano.
2. A1 (`piano/a1-base-per-ai`, T1–T8 fatti, T11 no, niente in main al
   2026-11-05). Se il suo `crates/fub-features/tests/command_conformance.rs`
   (A1 T3) è in main, i comandi di T8 e T21 ci passano da soli. A1 T11
   tocca gli stessi file di T22 (`mcp.rs`, `tools.rs`, `mcp-server.md`):
   chi arriva secondo riparte dall'altro. Nessun task aspetta A1.
3. Il testo si misura con una stima fissa, uguale in Rust e in TypeScript
   («Misure e posti»). La GUI di N6 misura il DOM quando la scheda è a
   schermo; il codice non ha il DOM. Scelgo la stima perché è deterministica,
   non chiede font nel nucleo e funziona da riga di comando.
4. L'inchiostro scritto dal codice usa le unità della lavagna, come se si
   scrivesse a zoom 100%. Lo spessore è quello della penna in quelle unità.
5. Il prossimo ADR libero, al 2026-11-05, è 0240 (0238 è di N4, 0239 di K5).
   T9 prende il primo numero libero quando parte.
6. Le scelte tecniche, mie. Ognuna ha il suo motivo in «La forma»: JSON e non
   un DSL; operazioni d'intento con default calcolati dal nucleo, e non
   JSON Canvas grezzo da calcolare a mano (il grezzo resta possibile); niente
   script da eseguire.
7. La guida per i modelli (`guida.md`) è in italiano, come la
   documentazione. Le parole chiave (nomi di operazioni e campi, codici
   d'errore) sono in inglese, come nel file JSON Canvas.
Ondate: T1 T2 | T3 T4 T5 | T6 | T7 | T8 | T9 | T10 T15 | T11 T17 | T12 T21 | T13 T22 | T16 | T18 | T20 T23 | T14 T24 | T19 T25 | T26
Prototipo: nessuno. Questo piano non decide nessuna schermata. T25 aggiunge
tre voci di menu con i pezzi del kit che ci sono, e solo se D6 lo approva.
L'anteprima di T21 è un'immagine per il modello, non una parte della GUI.

## Modifiche

nessuna

## Domande per l'utente (raccolte, non bloccano)

Ogni domanda ha le opzioni, la raccomandazione per prima, e i task che
aspettano. Fino alla risposta quei task non partono. Gli altri sì.

### D1 · Le operazioni nuove e i loro default (aspettano T9–T14)

- **(a) consigliata:** le forme brevi di `add_card` e `connect`, con misure,
  posti e lati calcolati dal nucleo (le stesse regole di N6), più `color`,
  `align`, `distribute`, `duplicate`, `reverse`, `group`, `layout`,
  `insert`, `convert`, `spread_pages` ed `excerpt`. `move` di un gruppo
  resta «il gruppo da solo», e `contents: true` lo sposta con le schede
  dentro, come il trascinamento. `duplicate` copia anche gli archi fra le
  schede copiate (come «Copia» di N6 T68), quindi con T23 anche Ctrl+D lo
  farà, mentre su main (638358da) non lo fa.
  Perché: si arriva alla parità senza cambiare il senso di un'operazione già
  pubblicata in `canvas-operations.md`.
- (b) come (a), ma `move` di un gruppo porta con sé le schede dentro per
  default: è più simile al gesto, ma cambia un'operazione che gli agenti
  usano già.
- (c) solo le forme brevi (T9). Il resto si fa con `set` e le coordinate:
  la parità non arriva.

### D2 · Comandi e strumenti MCP (aspettano T8, T22)

- **(a) consigliata:** tre comandi che leggono soltanto (`canvas.read`,
  `canvas.check`, `canvas.guide`) e, con D5, `canvas.preview`. Due strumenti
  MCP nuovi, `fub_canvas_read` e `fub_canvas_guide`. `fub_canvas_apply`
  controlla sempre prima di scrivere e prende `preview`. Tre risorse,
  `fub-guida://lavagna`, `fub-guida://lavagna/schema` e
  `fub-guida://lavagna/esempi`. Nessun sottocomando nuovo della CLI.
  Perché: un modello trova da solo, fra gli strumenti, come leggere, come
  provare e dove sta la guida.
- (b) solo i comandi, e da MCP si passa per `fub_invoke`: meno strumenti,
  ma un modello li trova meno.
- (c) un solo strumento `fub_canvas` con un campo `action`: è la porta
  universale senza tipi che `CLAUDE.md` chiede di evitare.

### D3 · L'inchiostro scritto dal codice (aspettano T15, T16, T18)

- **(a) consigliata:** `draw` con i punti o con una forma (linea, freccia,
  rettangolo, ellisse, poligono, stella), con la penna e il colore per nome:
  il nucleo scrive `fub:ink`. `erase_along` taglia come la gomma precisa: la
  regola di N4 T22 portata in Rust, con i vettori in comune.
  Perché: l'inchiostro è metà della lavagna, e senza questo un modello non
  lo può scrivere.
- (b) solo `draw`. La gomma che taglia resta della GUI, come dice il «Fuori
  scope» di N4: manca una voce alla parità.
- (c) né l'uno né l'altro. Il modello scrive `add_strokes` con la stringa
  codificata, che in pratica non sa fare.

### D4 · Da Mermaid e da una scaletta (aspetta T20)

- **(a) consigliata:** `from_mermaid` (una parte di `flowchart`: nodi, archi
  con etichetta, `subgraph` che diventa un gruppo, TD/LR/BT/RL) e
  `from_outline` (un elenco rientrato che diventa un albero). Il lettore sta
  nel nucleo, senza dipendenze nuove, e ciò che non capisce lo dice in un
  avviso: niente inventato.
  Perché: è la strada di Excalidraw, e un modello scrive già Mermaid bene.
- (b) solo `from_outline`.
- (c) nessuno dei due.

### D5 · L'anteprima (aspetta T21)

- **(a) consigliata:** `canvas.preview`, e `preview: true` in
  `fub_canvas_apply`, danno un PNG schematico. Le schede sono rettangoli coi
  loro colori, poi archi, gruppi e tratti, e su ogni scheda il numero della
  riga di `canvas.read`. Il numero è disegnato a segmenti, senza font.
  Perché: l'immagine è sempre uguale su ogni macchina e non porta font nel
  nucleo. Il testo lo dà la lettura.
- (b) un'immagine con il testo vero, con un font incluso (centinaia di KB in
  più, e la resa cambia col font).
- (c) nessuna anteprima: il modello si fida della lettura.

### D6 · Nella GUI: copia e incolla come codice, «Disponi» (aspetta T25)

- **(a) consigliata:** nel menu della lavagna «Copia come codice» (la
  selezione come operazioni, per darla a un assistente) e «Incolla codice»
  (le operazioni prese dagli appunti, controllate, col riassunto prima, e un
  solo annulla). Il sottomenu «Disponi» ha griglia, riga, colonna e albero
  (l'operazione `layout`).
  Perché: il codice diventa anche la via per passare un pezzo di lavagna fra
  la persona e l'assistente.
- (b) solo «Disponi».
- (c) niente di visibile: la parità va solo dalla GUI al codice.

## La forma

Una lavagna in codice è **una lista di operazioni JSON**, quella che
`canvas.apply` accetta già. Il piano non aggiunge una seconda strada: aggiunge
operazioni alla stessa lista, e campi facoltativi alle operazioni che ci sono.

Ho confrontato i candidati. Il motivo della scelta è nella seconda colonna.

| Candidato | Come va con un modello | Esito |
|---|---|---|
| JSON Canvas grezzo | lo sa scrivere, ma deve calcolare posti, misure, lati, id e la stringa `fub:ink` | resta possibile (`node`, `edge`, `set`) |
| scheletro con default, come `convertToExcalidrawElements` | scrive solo ciò che sceglie, il resto lo calcola il nucleo | **sì**: le forme brevi di `add_card` e `connect` |
| operazioni d'intento | una riga per gesto (allinea, raggruppa, disegna): la stessa parola della GUI | **sì**: la lista di `canvas.apply` |
| un DSL di testo | un secondo linguaggio da imparare, da validare e da tenere allineato | no |
| Mermaid, scaletta | il modello li conosce, ma descrivono solo nodi e archi | **sì, come import** (`from_mermaid`, `from_outline`), con D4 |
| uno script TS/JS | un motore da eseguire nel nucleo, con la sicurezza e il determinismo che costano | no |

Le regole della forma:

- **Un solo padrone.** Le regole stanno in `fub-canvas-core`. La GUI (via
  WebAssembly), i comandi di `fub-features`, il server MCP e la CLI le usano
  tutte allo stesso modo. Nessuna copia nella shell.
- **Gli argomenti sono ciò che una persona sceglie.** Il resto lo calcola il
  nucleo con la regola della GUI: misure di nascita, posti, lati, rettangolo
  del gruppo, campioni dell'inchiostro.
- **Si legge come si scrive.** `canvas.read` in forma `code` dà la lista che
  ricrea la lavagna: compilata su una lavagna vuota, ridà la stessa
  lavagna.
- **Si aggiunge e basta.** Le operazioni e i campi che ci sono restano validi
  con lo stesso senso: `node` ed `edge` interi, `set` con qualunque campo.
- **Tutte o nessuna, sempre deterministiche.** Lo stesso modello, le stesse
  operazioni e lo stesso seme danno le stesse toppe.

### Prima e dopo

Con le operazioni di main, una piccola mappa chiede di calcolare tutto:

```json
[
  { "op": "add_card", "node": { "id": "a", "type": "text", "text": "Ciclo dell'acqua", "x": 0, "y": 0, "width": 320, "height": 160 } },
  { "op": "add_card", "node": { "id": "b", "type": "text", "text": "Evaporazione", "x": 368, "y": 0, "width": 320, "height": 160 } },
  { "op": "add_card", "node": { "type": "file", "file": "Scienze/nuvole.png", "x": 368, "y": 184, "width": 480, "height": 360 } },
  { "op": "connect", "edge": { "fromNode": "a", "toNode": "b", "fromSide": "right", "toSide": "left", "toEnd": "arrow" } },
  { "op": "set", "id": "b", "fields": { "color": "5" } }
]
```

Con questo piano si scrive ciò che si vuole, e l'ellisse a pennarello non si
poteva scrivere affatto:

```json
[
  { "op": "add_card", "id": "a", "text": "Ciclo dell'acqua" },
  { "op": "add_card", "id": "b", "text": "Evaporazione", "near": "a", "color": "cyan" },
  { "op": "add_card", "file": "Scienze/nuvole.png", "near": "b", "side": "bottom" },
  { "op": "connect", "from": "a", "to": "b", "sides": "auto" },
  { "op": "draw", "on": "b", "shape": { "kind": "ellipse", "x": 8, "y": 8, "width": 304, "height": 144 }, "pen": "marker", "color": "vermilion" }
]
```

Le misure dell'immagine vengono dal file (`content_size`, letto da
`canvas.apply`). La stessa mappa da Mermaid, con D4:

```json
[{ "op": "from_mermaid", "text": "flowchart LR\n  A[Evaporazione] --> B[Condensazione] --> C[Precipitazione] --> A" }]
```

### Il ciclo di un assistente

1. `canvas.read` (forma `outline`): che cosa c'è, con gli id, e la revisione.
2. `canvas.check`: i problemi tipizzati con la correzione, gli avvisi, il
   riassunto di ciò che cambierebbe e la lettura di dopo.
3. `canvas.preview` (facoltativo): l'immagine di dopo.
4. `canvas.apply` con la revisione letta: scrive tutto o niente, e un
   annulla lo disfa.

### Le operazioni, alla fine del piano

Le prime sette ci sono già. Le due d'inchiostro sono di N4, le due del lazo di
N6. Le altre sono di questo piano.

| Operazione | Che cosa fa | Task |
|---|---|---|
| `add_card` | una scheda; forma breve: `text`, `file`, `url`, `label`, `type`, `subpath`, `id`, `x`+`y`, `width`, `height`, `color`, `near`, `side`, `gap`, `content_size` | main, T9 |
| `move` | sposta; `contents: true` porta le schede dentro al gruppo | main, T10 |
| `resize` | misure date, o `fit: "content"` | main, T10 |
| `connect` | un arco; forma breve: `from`, `to`, `label`, `color`, `sides`, `ends`, `id` | main, T9 |
| `remove` | toglie schede e archi | main |
| `set` | cambia campi; `color` accetta i nomi | main, T10 |
| `reorder` | porta sopra; `to: "back"` porta sotto | main, T10 |
| `add_strokes`, `erase_strokes` | i tratti già codificati | N4 |
| `move_strokes`, `restyle_strokes` | il lazo | N6 T86 |
| `color` | colora più schede o archi, coi nomi | T10 |
| `align`, `distribute` | come i bottoni della barra | T11 |
| `duplicate` | copia le schede e gli archi fra loro, sfalsate di 32 | T11 |
| `reverse` | inverte gli archi | T11 |
| `group` | un gruppo attorno alle schede, sotto di loro | T11 |
| `layout` | griglia, riga, colonna, albero | T12 |
| `insert` | un frammento `{version, nodes, edges}` con id nuovi | T13 |
| `convert` | una scheda di testo diventa una scheda di file | T13 |
| `spread_pages` | le pagine di un PDF in fila | T14 |
| `excerpt` | l'estratto di una scheda (`fub:parts`) | T14 |
| `draw` | un tratto da punti o da una forma | T16, T19 |
| `erase_along` | la gomma che taglia | T18 |
| `from_mermaid`, `from_outline` | import | T20 |

## Misure e posti

Le regole stanno in `crates/fub-canvas-core/src/layout.rs` (T2). Le usano le
forme brevi, `layout`, `group`, `duplicate`, le letture e, con T23 e T24, la
GUI. I vettori `apps/client/src/__fixtures__/canvas-layout.json` le fissano
in Rust (T2). In TypeScript non si riscrivono: la GUI chiama il nucleo, e i
vettori di `canvas-ops/` passano già dal `.wasm` (`wasm/vectors.test.ts`).

- **Aggancio:** `snap(v) = floor(v / 8 + 0.5) * 8`, come `Math.round` di
  `engine.ts` (`CANVAS_SNAP`).
- **Specie di una scheda** (`card_kind`): `text` e `group` sono loro stessi,
  `link` è `web`. Per `file` conta l'estensione in minuscolo, senza
  `subpath`: `md`, `markdown` → `note`; `docx`, `doc`, `dot`, `rtf`, `odt` →
  `document`; `xlsx`, `xlsm`, `xltx`, `xltm` → `sheet`; `pdf` → `pdf`; `png`,
  `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `avif`, `heic`, `tif`,
  `tiff` → `image`; tutto il resto → `file`. Le estensioni Craft di N6 T18
  (→ `craft`) entrano con T23, che aspetta N6 in main.
- **Misure di nascita** (N6 T9, D-11): testo 320 di larghezza e l'altezza
  stimata (sotto); `note`, `document` 320×240; `sheet` 480×304; `pdf` 360×480,
  oppure 360 di larghezza con l'altezza `snap(360·h/w)` se si conosce la
  pagina; `image` col lato lungo 480 e l'altro `snap(480·corto/lungo)`, o
  480×360 se la misura non si conosce; `web` 320×120; `craft`, `file`
  320×160; `group` 480×320. Ogni lato almeno 40.
- **Stima del testo:** caratteri per riga `cpl = max(8, floor((w − 32) / 8))`.
  La larghezza di nascita è 320 se ogni riga ha al più 36 caratteri, se no
  480. Le righe sono la somma, su ogni riga separata da `\n` (o `\r\n`), di
  `max(1, ceil(caratteri / cpl))`, contando i punti di codice Unicode.
  L'altezza è `clamp(snap(24 · righe + 32), 160, 1600)`.
- **Posto automatico** (senza `x`/`y` e senza `near`): su una lavagna vuota
  0,0. Se no, la prima scheda va a destra del contenuto (`x = destra + 48`,
  `y = alto`), e le schede automatiche dopo, nella stessa lista, sotto la
  precedente a 24.
- **Vicino a** (`near`, `side`): `right` (di serie) a 48, `bottom` a 24,
  `left` a 48, `top` a 24 (`gap` lo cambia). Un testo sopra o sotto prende
  la larghezza di `near`, come Ctrl+Invio di N6. Se il posto tocca un'altra
  scheda che non è un gruppo, scivola sull'asse perpendicolare fino al
  primo posto libero (a 24 dalla scheda toccata), al più 1000 passi.
- **Dentro un gruppo:** una scheda è dentro se il suo rettangolo sta tutto
  nel rettangolo del gruppo (la regola del trascinamento in `engine.ts`).
- **Lati più vicini** (`sides: "auto"`): si confrontano i centri. Se
  `|dx| ≥ |dy|`, `right`→`left` (o `left`→`right` se `dx < 0`), se no
  `bottom`→`top` (o `top`→`bottom`).
- **Gruppo attorno** (`group`, la griglia oltre 12): il rettangolo delle
  schede allargato di 24 per lato, agganciato.

## I colori

- Schede e archi: `red`, `orange`, `yellow`, `green`, `cyan`, `purple` →
  `"1"`…`"6"` (i colori di JSON Canvas). I nove colori delle note di N6 T47:
  `note-grey` `#5e626b`, `note-brown` `#84573e`, `note-orange` `#984b00`,
  `note-yellow` `#795f00`, `note-green` `#007231`, `note-blue` `#0064b0`,
  `note-purple` `#7847a6`, `note-pink` `#9e366f`, `note-red` `#b7191c`. Un
  `#rrggbb` si scrive in minuscolo; `null` toglie il colore.
- Inchiostro: i nomi di `apps/client/src/ink/palette.ts` (`black`, `blue`,
  `vermilion`, `green`, `purple`, `orange`, `sky`, `yellow`) o un `#rrggbb`.
- Un nome sconosciuto è il problema `bad_value`, coi nomi più vicini come
  suggerimento. I due vocabolari sono separati: `blue` è un colore
  d'inchiostro, non di scheda.

## L'inchiostro in codice

- `draw` scrive **un** tratto. `on` dice di chi è e in che coordinate sono i
  punti:
  - `"auto"` (di serie): la lavagna. Il tratto va alla scheda come quando si
    scrive (la regola dell'ancora di N4 e di N6 T69);
  - `"board"`: la lavagna, tratto libero;
  - un id di scheda: le coordinate della scheda, con 0,0 in alto a sinistra;
  - `{ "card", "page", "page_size"? }`: la pagina di un PDF in punti PDF (N6
    T19), con l'ancora `{"kind":"page","page":3,"width":595,"height":842}`;
  - `{ "card", "sheet", "cell" }`: la cella di un foglio, nelle coordinate
    della cella (N6 T37), con l'ancora `{"kind":"cell","sheet":"Foglio1","cell":"B3"}`.
- `points` (`[[x, y], …]`, oppure `[[x, y, pressione], …]` con la pressione
  da 0 a 1), oppure `shape`: `line` `{x1, y1, x2, y2}`, `arrow` (uguale),
  `rect` ed `ellipse` `{x, y, width, height}`, `polygon` `{points}`, `star`
  `{cx, cy, r, tips}`. Le sei forme sono quelle di N6 T87.
- `pen` (i sette di `apps/client/src/ink/pens.ts`, `ballpoint` di serie),
  `size` (da 0,25 a 200, quello della penna di serie), `color`. Il pennello
  e lo strumento (`pen` o `highlighter`) li dà la penna, con la stessa
  ricetta della GUI (`pens.rs`, T15).
- Il tempo dei campioni è sintetico: 8 ms per campione, così `fub:at` e
  l'ordine restano veri.
- `erase_along` `{points, size, on?}` taglia ogni tratto che il cammino tocca
  con raggio `size / 2`, come la gomma precisa di N4 T22.

## Leggere e controllare

- `canvas.read`, forme:
  - `outline` (di serie): una riga per scheda, per arco e per gruppo, con
    id, specie, posto, misure, colore, tratti e testo accorciato (T4);
  - `code`: la lista che ricrea la lavagna (T4, forme brevi da T9);
  - `json`: il modello.
  `ids` limita la lettura a quelle schede e agli archi fra loro.
  `max_chars` taglia lo schema con una riga finale che dice quante righe
  restano.
- `canvas.check`: i problemi sono `{code, index, path, message,
  suggestion?, fix?}`. I codici: `unknown_op`, `unknown_field`,
  `missing_field`, `wrong_type`, `bad_value`, `unknown_node`,
  `unknown_edge`, `duplicate_id`, `too_many`, `invalid`, `stale_base`, e
  con N4 `unknown_stroke` e `foreign_layer`. `fix` c'è solo quando la
  correzione è certa: per esempio un campo con un solo nome vicino. Gli
  avvisi sono `overlap`, `half_in_group` e `text_overflow`, con gli id. Poi
  il riassunto e la lettura di dopo.
- `canvas.guide`: la guida (`crates/fub-features/src/lavagna/guida.md`), i
  nomi delle operazioni, lo schema JSON e gli esempi. Schema ed esempi
  vengono da `spec.rs` (T6), quindi non si scrivono due volte.

## La parità

La misura è l'inventario, `PLAN-parita.json`. T1 lo sposta in
`apps/client/src/__fixtures__/canvas-parity/` (`board.json`, `main.json`,
`n4.json`, `n6.json`: un file per fonte, così due task che toccano fonti
diverse non si pestano). Lo controllano due test: uno Rust, uno Vitest.

**Le voci.** Ognuna ha `id` (che comincia con la fonte), `name`, `source`
(`main`, `N4`, `N6`), `gui` (dove sta nella GUI: `menu`, `toolbar`, `field`,
`key`, `gesture`, `clipboard`, oppure `plan` finché la fonte non è in main),
`writes` (`file`, `nothing`, `other-file`) e `state`:

| Stato | Vuol dire | Campi |
|---|---|---|
| `code` | un'operazione lo fa con la stessa regola | `ops` |
| `composed` | operazioni più un'altra porta | `ops`, `port` |
| `port` | lo fa un'altra porta (annulla, scrivere in una nota) | `port` |
| `by_hand` | si fa, ma chi scrive calcola a mano ciò che la GUI decide | `ops`, `computes`, `target_ops`, `task` |
| `missing` | nessuna operazione lo fa | `computes`, `target_ops`, `task` |
| `view` | non scrive il file | nessuno |
| `exception` | resta fuori, `note` dice perché | `note` |

**I conti al 2026-11-05:** 72 voci, `node PLAN-parita.mjs` dà `ok`.

| Fonte | code | port | by_hand | missing | view | exception |
|---|---|---|---|---|---|---|
| main | 15 | 1 | 12 | 1 | 7 | 0 |
| N4 | 1 | 0 | 3 | 1 | 2 | 0 |
| N6 | 5 | 1 | 16 | 3 | 2 | 2 |

Da fare per task: T9 14 voci, T10 6, T11 5, T12 1, T13 3, T14 2, T16 5, T18 1,
T19 2.

**Le regole.**

- **R1** (vocabolario): id unici col prefisso della fonte, stati, fonti e
  `gui` dai vocabolari sopra.
- **R2** (le forme compilano): le `ops` delle fonti in `merged` compilano su
  `board` col seme 1 (`applied`).
- **R3** (campi per stato): come la tabella sopra; `view` scrive `nothing`.
- **R4** (cricchetto): se le `target_ops` di una voce compilano, il test
  fallisce e dice di spostarle in `ops` e di cambiare stato. Così un task
  che porta un'operazione non può dimenticare la voce.
- **R5** (il conto): `max_missing` di ogni file è uguale alle voci
  `by_hand` più `missing`. Scende soltanto.
- **R6** (ogni operazione ha una voce): ogni operazione del nucleo compare
  in `ops` o `target_ops` di una voce, o in `ops_without_gui`. Fino a T6 i
  nomi vengono dall'errore di serde per `{"op":"__nessuna__"}` («expected one
  of …»), da T6 da `spec::OPS`.
- **R7** (la GUI, Vitest): monta la tela negli stati vuoto, `t1`, `f1`,
  `l1`, `t1+t2`, `t1+t2+f1`, `e1` e `g1` sulla lavagna di `board.json`.
  Raccoglie `[data-canvas-action]`, `[data-canvas-field]` e gli id di
  `contextMenu` (anche annidati). Ogni id deve avere una voce di una fonte in
  `merged`, e ogni voce deve trovare il suo id. Ogni tasto delle voci si
  preme in `t1`: cambia il documento se e solo se la voce dice `writes:
  "file"`. I gesti non si scoprono dal DOM: la costante `GESTURES` del test
  li elenca, e il test li confronta con le voci `gesture`. Quando N6 T48 è
  in main, R7 legge anche il catalogo dei comandi
  (`chrome/commands.ts`).
- **R8** (la stessa porta, Vitest, da T23): ogni voce `code` o `composed`
  che ha un posto nella GUI si fa con la GUI e con le sue `ops`, e le due
  lavagne che ne escono sono uguali. T23 lo porta per menu, barra, campi e
  tasti, T24 per i gesti e gli appunti.

**Quando arriva una fonte.** Chi porta in main N4 o N6, o porta main su un
ramo dove ci sono, aggiorna lo stesso commit: aggiunge la fonte a
`merged`, scrive i veri `gui` al posto di `plan`, aggiunge le voci dei gesti
nuovi. R2 e R7 lo obbligano. Se N4 o N6 entrano prima di T1, T1 scrive già
le voci vere.

**Aggiungere un gesto alla GUI**, dopo questo piano: una voce nel file della
fonte, con la sua forma in codice, o un'eccezione con il perché. Senza la
voce R7 fallisce. La pagina `docs/development/canvas-parity.md` (T1) lo
spiega in cinque righe.

## Regole che valgono per ogni task

- Un'operazione nuova è sempre: la variante di `CanvasOp` in `ops.rs` (solo
  la variante e la chiamata), la logica in `crates/fub-canvas-core/src/ops/<nome>.rs`
  (nuovo), la voce in `spec.rs` (da T6) con almeno un esempio, almeno due
  vettori in `apps/client/src/__fixtures__/canvas-ops/` (uno `applied`, uno
  `rejected`), le voci dell'inventario spostate (R4), la riga in
  `docs/reference/canvas-code.md` «Le operazioni», e i `needs` del corpus
  aggiornati (T3).
- Mai due task con un'operazione nuova insieme: `ops.rs` e `spec.rs` sono di
  tutti. La catena è T9 → T10 → T11 → T12 → T13, poi T16, T18, T20, T14 e
  T19 man mano che sono pronti, uno alla volta.
- Nessuna regola nella shell: TypeScript chiama il nucleo. `operation.ts` non
  cresce.
- Gli errori restano tipizzati. Un errore nuovo di `fub-features` è una
  chiave del catalogo di `lavagna.rs` in italiano e in inglese, mai un
  letterale (`check-error-literals.mjs`).
- Si aggiunge e basta: un vettore di `canvas-ops/` che c'è non cambia esito.
- Determinismo: niente orologio né caso nel nucleo, il tempo dei campioni è
  sintetico, gli id vengono dal seme.
- I limiti sono dati, non speranze. Le operazioni che crescono hanno il
  loro limite, oltre il quale c'è `TooMany`: `spread_pages` 1000 pagine,
  `insert` 10 000 schede, `draw` 10 000 punti, `from_mermaid` e
  `from_outline` 2000 nodi e 256 KiB di testo. Restano i limiti di
  `MAX_NODES` e `MAX_EDGES`.
- Prove: Rust `cargo test -p fub-canvas-core` (e `-p fub-features --features
  lavagna`, `-p fub-cli` dove si tocca), Vitest accanto al modulo. Sempre
  `scripts/check.sh --rapido` per chiudere.
- La documentazione cambia nello stesso task. Le operazioni vanno in
  `canvas-code.md`, l'inchiostro in `canvas-ink.md` di N4 «In codice», i
  comandi in `canvas-operations.md` «Comandi», MCP in `mcp-server.md`. I
  limiti delle pagine: 550 righe per `reference/`, 450 per `development/`,
  180 per un ADR.
- Nelle pagine le date sono assolute, mai relative al giorno in cui si scrive.

## Chi aspetta chi

| Task | Parte quando | Aspetta fuori dal piano | Domanda |
|---|---|---|---|
| T1 · l'inventario e i test della parità | subito | nessuno | — |
| T2 · `layout.rs` | subito | nessuno | — |
| T3 · il corpus | dopo T1 | nessuno | — |
| T4 · `describe.rs` | dopo T2 | nessuno | — |
| T5 · `layout/arrange.rs` | dopo T2 | nessuno | — |
| T6 · `spec.rs` | dopo T4 | nessuno | — |
| T7 · `summary.rs` | dopo T6 | nessuno | — |
| T8 · `canvas.read`, `check`, `guide` | dopo T7 | nessuno | D2 |
| T9 · le forme brevi | dopo T8 | nessuno | D1 |
| T10 · colori, ordine, gruppo, misura | dopo T9 | nessuno | D1 |
| T11 · allinea, distribuisci, duplica, inverti, raggruppa | dopo T10, T5 | nessuno | D1 |
| T12 · `layout` | dopo T11 | nessuno | D1 |
| T13 · `insert`, `convert` | dopo T12 | nessuno | D1 |
| T14 · `spread_pages`, `excerpt` | dopo T13 | N6 T72, T73 in main | D1 |
| T15 · `pens.rs` | dopo T9 | N4 in main | D3 |
| T16 · `draw` | dopo T15, T13 | N4 in main | D3 |
| T17 · la lettura dell'inchiostro | dopo T9 | N4 in main | — |
| T18 · `erase_along` | dopo T16 | N4 T22 in main | D3 |
| T19 · pagina e cella | dopo T16 | N6 T19, T37 in main | D3 |
| T20 · Mermaid e scaletta | dopo T12 | nessuno | D4 |
| T21 · l'anteprima | dopo T7 | nessuno | D5 |
| T22 · MCP | dopo T8 (e T21, se c'è) | nessuno (A1 T11 tocca gli stessi file) | D2, D5 |
| T23 · la GUI scrive con le operazioni: menu e tasti | dopo T13 | N6 in main | — |
| T24 · la GUI scrive con le operazioni: gesti e appunti | dopo T23, T18 | N6 in main | — |
| T25 · copia e incolla come codice, «Disponi» | dopo T24 | nessuno | D6 |
| T26 · chiusura | per ultimo | — | — |

## Che cosa ho verificato nel codice

Su `origin/main` @ 638358da, il 2026-11-05:

- `crates/fub-canvas-core`: moduli `commit`, `js`, `model`, `ops`, `patch`,
  `read`, `source`. Dipende solo da `serde`, `serde_json` (`float_roundtrip`)
  e `thiserror`. `dependency_invariant.rs` fissa le sue dirette
  (`CANVAS_CORE_ALLOWED_DIRECT`) e chi dipende da lui.
- `CanvasOp` ha sette varianti (`#[serde(tag = "op", rename_all =
  "snake_case", deny_unknown_fields)]`). `compile(canvas, ops, seed)` dà
  `Compiled { patches, created }`. `OpError` ha `UnknownNode`,
  `UnknownEdge`, `DuplicateId`, `TooMany` e `Invalid { reason: String }`. Gli
  id vengono da SplitMix64 in 16 cifre esadecimali.
- `tests/op_vectors.rs` legge `apps/client/src/__fixtures__/canvas-ops/*.json`
  (`about`, `before`, `seed?`, `ops`, `expect`) e ne vuole almeno 20.
- La facciata WebAssembly (`crates/fub-canvas-wasm/src/api.rs`) ha già
  `compile`, e `apps/client/src/editors/canvas/wasm/core.ts` la espone. La
  tela non la usa: scrive toppe costruite in TypeScript (`operation.ts`,
  `upsertNodePatch` e le sorelle, 20 chiamate in `engine.ts`).
- Le regole della GUI di main, in `engine.ts`: aggancio a 8
  (`CANVAS_SNAP`); allinea e distribuisci (`#layoutSelection`, righe
  1102–1135); duplica a +32 senza archi (`#duplicateSelection`); il gruppo
  trascinato porta le schede tutte dentro (riga 1619); collegare scrive
  `toEnd: "arrow"` senza lati e non collega una scheda a sé stessa (riga
  1713); invertire scambia estremi, lati e punte (riga 1494).
- `crates/fub-features/src/lavagna/apply.rs`: `canvas.apply` (controllo del
  documento, operazioni, seme `Fnv1a(revision)` di serie, base, `Core::open`,
  compile, commit, prova o scrittura con annulla). Le chiavi del catalogo
  stanno in `lavagna.rs` (italiano e inglese, una tabella). `draw` porta
  `resvg`, `imagesize` e `lopdf`. `encode_png` di `draw.rs` è privata;
  `draw/annotated/geometry.rs` ha `Geometry::of(doc, page).size()`
  (`pub(crate)`). `ReadApi::read_document_bytes` c'è.
- `crates/fub-cli/src/mcp/tools.rs`: `fub_canvas_create`, `fub_canvas_apply`
  (la descrizione elenca le sette operazioni a mano), `fub_preview` (solo
  Craft), `fub_create`. `mcp.rs`: `INSTRUCTIONS`, `resources_list` (pagine
  da 100), `resources_read` (solo `fub://open?note=`).
- `docs/reference/canvas-operations.md` ha 513 righe su 550: per questo le
  operazioni nuove vanno in una pagina nuova (`canvas-code.md`).
  `docs/README.md` ne ha 139 su 150.
- Le penne (`apps/client/src/ink/pens.ts`, sette, misure da 0,25 a 200) e i
  colori (`palette.ts`, otto) sono solo in TypeScript.
  `ink/tools/split.ts` (`splitInk`, `cutBrush`) taglia i tratti, solo in
  TypeScript.
- Su `origin/piano/n4-inchiostro`: il crate `fub-ink-codec` (`ink.rs`,
  `brush.rs`), `fub-canvas-core/src/ink.rs`, le varianti `AddStrokes`,
  `EraseStrokes` e gli errori `UnknownStroke`, `ForeignLayer`.
- Su `origin/piano/n6-lavagna`: `drop-layout.ts` (T9 fatto: misure di
  nascita, griglia, gruppo oltre 12), il catalogo dei comandi (T48, da
  fare), gli appunti `application/x-fub-canvas+json`
  `{version: 1, nodes, edges}` (T68), `fub:parts` come oggetto (T73).

## Differenze da N6/N4

Non tocco i loro piani. Ecco dove questo piano li vede diversi, e che cosa
succede.

1. **N6 T86** scrive `move-strokes` e `restyle-strokes`, e chiama così anche
   le sorelle. Le operazioni sono in `snake_case` (`add_strokes`,
   `move_strokes`, `restyle_strokes`), come vuole `rename_all`.
2. **N6 T48**, il catalogo dei comandi: con T23 ogni comando che scrive ha
   anche `op`, le operazioni che compila. N6 non lo prevede.
3. **Regole in due posti.** Le misure di N6 T9 (`drop-layout.ts`), i lati
   più vicini di T67 («non ancora esatti»), le forme di T87 e l'ancora di N4
   sono in TypeScript. Con questo piano la regola è del nucleo, e la GUI la
   chiama (T23, T24). L'ordine dei file trascinati resta della GUI
   (`Intl.Collator` numerico): `layout` mette le schede nell'ordine che
   riceve.
4. **Le scritture di N6 passano da `compile`** dopo T23 e T24, non da toppe
   costruite in TypeScript. Le toppe che escono sono le stesse; cambia chi le
   calcola.
5. **Il gruppo trascinato.** Il gesto porta le schede tutte dentro, mentre
   `move` in `canvas-operations.md` dice «il gruppo si sposta da solo».
   `contents` (T10) rende esplicita la differenza, e D1 decide il default.
6. **Gli id dei tratti.** N4 usa `newNodeId("s")` (casuale), il codice usa il
   seme. Tutti e due sono unici. La GUI passa un seme casuale per gesto, e
   così gli id restano come quelli di Obsidian.
7. **Il «Fuori scope» di N4** esclude un'operazione che taglia i tratti.
   D3 (a) la porta (`erase_along`, T18), con la stessa regola di N4 T22.
8. **N6 lascia fuori gli agenti** dalla lavagna v1. Questo piano li porta
   dentro, ma con le stesse regole, senza cambiare nulla di ciò che N6 fa.
9. **L'inchiostro dal codice è a zoom 100%.** La GUI scrive allo zoom del
   momento: il file è lo stesso, solo lo spessore è nelle unità della
   lavagna.
10. **Il foglio nasce 480×304, non 480×300:** l'aggancio a 8 vince su D-11.
    La regola del nucleo usa 304, come `drop-layout.ts`.
11. **Ctrl+D e gli archi.** Duplica di main non copia gli archi, «Copia» di
    N6 T68 sì. `duplicate` li copia (D1), e con T23 Ctrl+D fa lo stesso.
12. **Se questo piano entra prima.** Chi porta N4 o N6 in main aggiorna
    l'inventario nello stesso commit (R2 e R7 lo chiedono). Il loro
    «Fatto quando» non lo dice: l'orchestratore lo sa da qui.

## Per K6: i disegni

Lo stesso principio vale per l'editor SVG che pianifica K6: ogni gesto del
disegno ha la sua forma in codice, e un inventario con le regole R1–R8
(adattate) lo misura. Che cosa può prendere da qui, senza sovrapporsi:

- la stessa forma: una lista di operazioni JSON d'intento, con default
  calcolati dal padrone delle regole, e `read`, `check`, `guide` e
  `preview` come comandi che leggono soltanto;
- lo stesso `draw` per l'inchiostro (`points` o `shape`, `pen`, `size`,
  `color`), con le penne e i colori da `fub-ink-codec/src/pens.rs` (T15).
  Una penna ha un solo nome in tutta Fub;
- l'inventario a file per fonte e il cricchetto R4.

Il disegno ha però le operazioni solo in TypeScript
(`apps/client/src/editors/spatial/scene/ops.ts`): prima della parità gli
serve un ingresso in Rust o un comando che le esegua. È una scelta di K6.

## Le pagine di docs che cambiano

| Pagina | Che cosa | Task |
|---|---|---|
| `docs/development/canvas-parity.md` (nuova) | l'inventario, le regole, come si aggiunge un gesto; «Il corpus» | T1, T3 |
| `docs/reference/canvas-code.md` (nuova) | «La forma», «Leggere», «Misure e posti», «Le operazioni» (T4); «Lo schema» (T6); «Il controllo» (T7); le operazioni nuove (T9–T14); «Da Mermaid e da una scaletta» (T20) | T4, T6, T7, T9–T14, T20 |
| `docs/reference/canvas-operations.md` | «Operazioni» si sposta in `canvas-code.md` (T4); «Comandi» cresce: `canvas.read`, `check`, `guide` (T8), `canvas.preview` (T21) | T4, T8, T21 |
| `docs/reference/canvas-ink.md` (di N4) | «In codice»: `draw`, `erase_along`, la lettura | T16–T19 |
| `docs/reference/mcp-server.md` | strumenti, risorse, istruzioni | T22 |
| `docs/reference/canvas-cards.md` (di N6) | «Comandi e tasti»: `op`, Ctrl+D con gli archi (T23); i gesti che compilano (T24); le voci nuove (T25) | T23–T25 |
| `docs/decisions/0240-…` (nuovo) | perché questa forma | T9 |
| `docs/README.md`, `docs/map/dove-sta-x.md` | i collegamenti e le righe | T1, T4, T26 |
| `DECISIONS.md` | le righe del registro | T26 |

## T1 · L'inventario della parità e i suoi test

Perché: la parità si misura. Senza un test che conta, un gesto nuovo entra
senza la sua forma in codice e il conto non scende mai.
Tocca: `apps/client/src/__fixtures__/canvas-parity/board.json`, `main.json`,
`n4.json`, `n6.json` (nuovi, da `PLAN-parita.json`),
`crates/fub-canvas-core/tests/parity.rs` (nuovo),
`apps/client/src/editors/canvas/parity.test.ts` (nuovo),
`apps/client/src/editors/canvas/test-mount.ts` (nuovo),
`docs/development/canvas-parity.md` (nuovo), `docs/README.md` (una riga),
`docs/map/dove-sta-x.md` (una riga), `PLAN-parita.json` e
`PLAN-parita.mjs` (si tolgono dal ramo del piano).
Non toccare: `engine.ts` ed `engine.test.ts` (N6 li cambia in molti task:
il test li usa e basta); `ops.rs`; le voci (si spostano, non si
riscrivono).
Dipende da: nessuno
Cosa fare:
- Dividere `PLAN-parita.json`: `board.json` è `{version: 1, about, merged:
  ["main"], board, ops_without_gui}`, gli altri tre sono `{version: 1,
  source, max_missing, entries}` con le voci di quella fonte, nello stesso
  ordine. Se N4 o N6 sono già in main, entrano in `merged` e le loro voci
  prendono i `gui` veri («Quando arriva una fonte»).
- `parity.rs` legge i quattro file come `op_vectors.rs` legge i suoi
  (`CARGO_MANIFEST_DIR` più il percorso relativo) e controlla R1–R6 come li
  scrive «La parità». Raccoglie tutti gli errori, non solo il primo, e
  ognuno nomina la voce e la regola. Il messaggio di R4 è «`<id>`: le
  target_ops compilano: spostale in ops e cambia lo stato». R6 legge i nomi
  dall'errore di serde per `{"op":"__nessuna__"}`, e un'asserzione vuole
  almeno 7 nomi, così un messaggio cambiato fallisce subito.
- `test-mount.ts` copia l'aiuto che monta la tela in `engine.test.ts`
  (righe 55–110) senza toccare quel file.
- `parity.test.ts` fa R7. Monta la tela con la lavagna di `board.json`, e
  per ogni stato (vuoto, `t1`, `f1`, `l1`, `t1+t2`, `t1+t2+f1`, `e1`, `g1`)
  raccoglie `[data-canvas-action]`, `[data-canvas-field]` e gli id di
  `engine.contextMenu({x, y})`, anche nei sottomenu, aperto su una scheda,
  su un arco e sul vuoto. Poi preme i tasti delle voci (`Mod+Z`,
  `Mod+Shift+Z` e `Mod+Y` dopo una mossa, gli altri in `t1`). Infine
  confronta la costante `GESTURES` (id della voce → una riga che dice il
  gesto) con le voci `gesture` delle fonti in `merged`.
- `canvas-parity.md`: che cosa misura l'inventario, gli stati, le regole,
  come si aggiunge un gesto e che cosa fa chi porta in main una fonte. Al
  più 120 righe.
Casi limite: una voce di una fonte non in `merged` (R2 e R7 la saltano,
R1, R3 e R5 no); un id di menu a modello (`canvas.color.${value}`), che
nel DOM è già espanso; un tasto che la tela non sente perché il fuoco è
in un campo (si preme col fuoco sulla tela); `max_missing` più alto del
conto (fallisce: il conto scende soltanto se si scrive giusto).
Fatto quando: `cargo test -p fub-canvas-core --test parity` passa, e
fallisce se si toglie una voce, se si cambia lo stato di una voce in
`code` senza `ops` o se `max_missing` non torna; `parity.test.ts` passa, e
fallisce se si toglie una voce di menu dall'inventario.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
parity; cd apps/client && npx vitest run src/editors/canvas/parity.test.ts;
node .github/scripts/check-doc-links.mjs
Stato: [ ] da fare

## T2 · Le misure e i posti nel nucleo

Perché: le forme brevi, `layout`, `group`, le letture e la GUI devono
decidere misure e posti con una regola sola, del nucleo.
Tocca: `crates/fub-canvas-core/src/layout.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs` (`pub mod layout`),
`apps/client/src/__fixtures__/canvas-layout.json` (nuovo, scritto a mano),
`crates/fub-canvas-core/tests/layout_vectors.rs` (nuovo).
Non toccare: `ops.rs` (le operazioni le usano da T9); `drop-layout.ts` di
N6 (la GUI passa al nucleo con T24); la documentazione (la pagina nasce
con T4: qui solo rustdoc).
Dipende da: nessuno
Cosa fare:
- Funzioni pure, sul modello di `model.rs`: `snap(f64) -> f64`;
  `card_kind(&CanvasNode) -> CardKind` (`text`, `note`, `document`,
  `sheet`, `pdf`, `image`, `web`, `craft`, `file`, `group`);
  `born_size(kind, text: Option<&str>, content: Option<(f64, f64)>) ->
  (f64, f64)`; `estimate_text_height(text, width) -> f64`;
  `auto_place(&Canvas, size, after: Option<Rect>) -> (f64, f64)`;
  `place_near(&Canvas, near: &str, side, gap: Option<f64>, size) ->
  (f64, f64)`; `inside(&CanvasNode, group: &CanvasNode) -> bool`;
  `nearest_sides(a, b) -> (Side, Side)`; `group_rect(&[Rect], margin) ->
  Rect`. Le regole sono quelle di «Misure e posti», numero per numero.
- `CardKind::Craft` c'è già, ma nessuna estensione ci porta finché N6 T18
  non è in main: le estensioni le porta T23, che aspetta N6.
- Ogni regola ha i suoi casi in `canvas-layout.json`, `{about, fn, args,
  expect}`, almeno 40: ogni specie, il testo lungo e quello corto, una riga
  di 37 caratteri, il CRLF, l'emoji di 4 byte, il posto su una lavagna
  vuota e su una piena, lo scivolare, i quattro lati.
Casi limite: testo vuoto (160 di altezza); 10 000 righe (1600, il tetto);
`content` con un lato 0 o non finito (le misure di serie); un'estensione
in maiuscolo (`.PNG`); un `subpath` con un punto (`a.md#b.c`); `near` che
non c'è (lo dice il chiamante: qui `Option`); una lavagna di 5000 schede
dove ogni posto è preso (il tetto di 1000 passi, poi il primo posto sotto
tutto).
Fatto quando: `cargo test -p fub-canvas-core --test layout_vectors` passa
su tutti i vettori; ogni funzione pubblica ha il suo rustdoc in italiano.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
layout_vectors
Stato: [ ] da fare

## T3 · Il corpus dei compiti

Perché: «semplice» va misurato su compiti veri, gli stessi per noi e per i
modelli. Il corpus dice quanto costa ogni compito con le operazioni di
main e con quelle del piano, e che cosa manca ancora.
Tocca: `apps/client/src/__fixtures__/canvas-tasks/` (nuovo: 20 file),
`crates/fub-canvas-core/tests/task_corpus.rs` (nuovo),
`docs/development/canvas-parity.md` (da T1: la sezione «Il corpus»).
Non toccare: `ops.rs`; l'inventario (il corpus non è la parità).
Dipende da: T1
Cosa fare:
- Un compito è `{about, prompt, before, ops_today, ops, needs?, checks}`.
  `prompt` è la richiesta come la scriverebbe una persona, in italiano.
  `ops_today` è la soluzione con le operazioni di main (`null` se non si
  può), e `ops` quella con il piano. `needs` sono le operazioni o i campi
  che `ops` usa e il nucleo non ha ancora. `checks` è una lista di
  controlli: `has_card {text | file}`, `has_edge {from_text, to_text,
  label?}`, `no_overlap {texts?}`, `aligned {texts, axis}`, `count {kind,
  n}`, `in_group {label, texts}`, `strokes {on_text?, n}`. Le schede si
  nominano per testo, non per id.
- I 20 compiti: mappa di un argomento (5 idee); una scaletta da un
  elenco; un diagramma di flusso da Mermaid; un PDF sparso in pagine;
  sottolineare un titolo a pennarello; cerchiare una scheda; una freccia a
  mano fra due schede; allineare a sinistra; distribuire; raggruppare con
  un titolo; colorare per argomento; duplicare una parte; invertire una
  freccia; una griglia di immagini; una lavagna di riepilogo con note e
  link; incollare un frammento; trasformare un testo in nota; cancellare
  metà di un tratto; un albero da una scaletta con rientri; un
  cronoprogramma in riga.
- Il runner: `ops_today` compila su `before` e passa i controlli. Se
  `needs` è vuoto, anche `ops`. Se un nome di `needs` ora compila, fallisce
  e dice di toglierlo (il cricchetto). Stampa una tabella con il compito e
  i caratteri di `ops_today` e di `ops` (JSON compatto).
- Con `FUB_CANVAS_ESITI=<cartella>` legge `<compito>.json` scritti da un
  modello fuori dal test, li applica a `before` e dice quali passano.
  Nessun modello in CI.
Casi limite: un compito con l'inchiostro prima di N4 (`ops_today` `null`,
`needs` con `draw`); un controllo che nomina un testo ripetuto (fallisce:
i testi del corpus sono unici); `FUB_CANVAS_ESITI` senza un file per un
compito (lo salta e lo dice).
Fatto quando: `cargo test -p fub-canvas-core --test task_corpus` passa con
20 compiti, e la tabella dei caratteri esce con `-- --nocapture`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
task_corpus -- --nocapture
Stato: [ ] da fare

## T4 · Leggere la lavagna come codice

Perché: un modello deve sapere che cosa c'è prima di cambiarlo. Lo schema,
la lista di operazioni che ricrea la lavagna e il modello devono uscire
dal nucleo, uguali per tutti.
Tocca: `crates/fub-canvas-core/src/describe.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs`,
`crates/fub-canvas-core/tests/describe.rs` (nuovo),
`docs/reference/canvas-code.md` (nuovo: «La forma», «Leggere», «Misure e
posti», «Le operazioni»), `docs/reference/canvas-operations.md`
(«Operazioni» si sposta), `docs/README.md` (una riga, accanto a «Le
operazioni della lavagna»).
Non toccare: `read.rs` (legge il sorgente, non lo descrive); `ops.rs`;
le altre sezioni di `canvas-operations.md`.
Dipende da: T2
Cosa fare:
- `outline(&Canvas, &DescribeOptions) -> String`. Una riga per scheda,
  nell'ordine del modello, col numero d'ordine da 1, per esempio `1 t1 text
  "Ciclo dell'acqua" 0 0 320×160 color=5 in=g1`. Le specie sono quelle di
  `card_kind`, il testo è accorciato a 60 caratteri con «…», e per i file
  si scrive il percorso. Poi gli archi (`e1 t1 -> t2 "usa"`, con i lati e
  le punte se non sono quelli di serie). La prima riga dà i conti e il
  riquadro: `cards 3 edges 1 groups 0 bounds 0 0 688×544`. Nessuna parola
  in una lingua: le chiavi sono i nomi dei campi.
- `code(&Canvas, &DescribeOptions) -> Vec<CanvasOp>`: `add_card {node}` e
  `connect {edge}`, nell'ordine del modello, `x` e `y` sempre. Le forme
  brevi arrivano con T9.
- `json`: il modello com'è (`serde_json::to_value`).
- `DescribeOptions { ids: Option<Vec<String>>, max_chars: Option<usize> }`.
  `ids` tiene quelle schede e gli archi fra loro, e `max_chars` taglia
  l'outline a una riga intera con l'ultima riga `…+N`.
- Il giro: per ogni vettore di `canvas-ops/` e di `canvas-read/` che si
  apre, `compile(vuota, code(c), 1)` dà un modello uguale a `c` come
  valore JSON. Conta l'ordine di schede e archi, non quello delle chiavi.
- `canvas-code.md` comincia come `canvas-operations.md`, con «Ambito» e
  «Fonti autorevoli». Poi «La forma» (la scelta, le regole, il prima e dopo),
  «Leggere» (le tre forme, con un esempio) e «Misure e posti» (le regole di
  T2, con i numeri).
- «Operazioni» si sposta da `canvas-operations.md` (righe 179–309) a
  `canvas-code.md` «Le operazioni», com'è. In `canvas-operations.md` resta
  una riga che rimanda. I link che puntavano a quella sezione si
  aggiornano (`check-doc-links.mjs` li trova). Così `canvas-operations.md`
  ha posto per i comandi (T8, T21): ha 513 righe su 550.
Casi limite: lavagna vuota (la riga dei conti, `bounds -`); un testo con
`"` e a capo (si scrive come JSON); campi sconosciuti (`code` li porta in
`node`: il giro li conserva); `ids` con un id che non c'è (si ignora, e i
conti dicono quante schede); `max_chars` minore della prima riga (esce la
prima riga).
Fatto quando: `cargo test -p fub-canvas-core --test describe` passa, con
il giro su tutti i vettori; la pagina è collegata e passa i controlli.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
describe; node .github/scripts/check-doc-links.mjs; node
.github/scripts/check-doc-orphans.mjs
Stato: [ ] da fare

## T5 · Disporre: allineare, distribuire, griglia, albero

Perché: allinea, distribuisci, `layout` e l'import vogliono la stessa
geometria, pura e provata una volta.
Tocca: `crates/fub-canvas-core/src/layout/arrange.rs` (nuovo),
`crates/fub-canvas-core/src/layout.rs` (da T2: `pub mod arrange;`),
`apps/client/src/__fixtures__/canvas-layout.json` (da T2: casi nuovi),
`crates/fub-canvas-core/tests/layout_vectors.rs` (da T2).
Non toccare: `ops.rs`; `engine.ts` (le sue formule si copiano, non si
cambiano).
Dipende da: T2
Cosa fare:
- `align(&[Rect], to: Align) -> Vec<(f64, f64)>` e `distribute(&[Rect],
  axis) -> Vec<(f64, f64)>` con le formule di `#layoutSelection`
  (`engine.ts` 1102–1135), compreso l'aggancio. Con meno di 2 schede, o
  meno di 3 per distribuire, non cambia niente.
- `grid(sizes, gap, origin) -> Vec<(f64, f64)>`: `ceil(√n)` colonne, celle
  larghe quanto la più larga della colonna e alte quanto la più alta della
  riga, a 24. `row` e `column` sono una riga o una colonna, a 24.
- `tree(nodes, edges, direction, gap)`: a strati (lo strato è la distanza
  più lunga da una radice), con le radici nell'ordine dato. Un figlio è del
  primo genitore che lo nomina, e un ciclo si spezza sull'arco che torna
  indietro nella visita in profondità. In ogni strato i figli stanno
  centrati sotto il genitore, e i sottoalberi non si sovrappongono (il
  metodo «tidy»). Fra gli strati 96, fra i fratelli 24.
- Casi in `canvas-layout.json`: gli otto bottoni della barra con le stesse
  risposte di `engine.ts`, una griglia di 1, 2, 5 e 13, un albero con un
  ciclo, una foresta, un nodo con due genitori.
Casi limite: rettangoli uguali (distribuire non sposta); misure enormi
(nessun `NaN`, nessun `Infinity`); 2000 nodi in fila (l'albero resta
lineare nel tempo: niente quadratico oltre `n log n`).
Fatto quando: `cargo test -p fub-canvas-core --test layout_vectors` passa
con i casi nuovi, e i casi dei bottoni coincidono con `engine.ts`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
layout_vectors
Stato: [ ] da fare

## T6 · Lo schema delle operazioni

Perché: un modello impara le operazioni dallo schema e dagli esempi, e un
errore gli serve solo se dice dove ha sbagliato e come si corregge. Lo
schema deve venire dal nucleo e coincidere con serde, sempre.
Tocca: `crates/fub-canvas-core/src/spec.rs` (nuovo),
`crates/fub-canvas-core/src/ops.rs` (solo `CanvasOp::name()`),
`crates/fub-canvas-core/src/lib.rs`,
`crates/fub-canvas-core/tests/spec.rs` (nuovo),
`crates/fub-canvas-core/tests/parity.rs` (da T1: R6 legge `spec::OPS`),
`docs/reference/canvas-code.md` (da T4: «Lo schema»).
Non toccare: il comportamento delle operazioni; i vettori.
Dipende da: T1, T4
Cosa fare:
- `pub struct OpSpec { name, summary_it, fields: &[FieldSpec], examples:
  &[&str] }` e `FieldSpec { name, kind: FieldKind, required, default:
  Option<&str>, doc_it }`. `FieldKind` è `Id`, `Ids`, `Number`, `Text`,
  `Bool`, `Enum(&[&str])`, `Node`, `Edge`, `Object`, `Points`, `Any`.
  `pub const OPS: &[OpSpec]`, una voce per variante.
- `CanvasOp::name(&self) -> &'static str`, con un `match` senza `_`: una
  variante nuova senza nome non compila.
- `json_schema() -> serde_json::Value`: JSON Schema 2020-12, un `oneOf` con
  `op` costante e `additionalProperties: false`.
- `validate(&Value) -> Vec<Problem>`, con `Problem { code, index, path,
  message, suggestion, fix }`. Prima della lista: non è un array
  (`wrong_type`) o è vuoto (`invalid`). Poi per ogni operazione: manca `op`
  o il nome non c'è (`unknown_op`, il nome più vicino), un campo che
  l'operazione non ha (`unknown_field`), un campo obbligatorio che manca
  (`missing_field`), un tipo sbagliato (`wrong_type`), un valore fuori
  dall'elenco (`bad_value`). Il nome più vicino si trova con la distanza
  di Levenshtein, al più 2. `fix` è l'operazione intera corretta, e c'è
  solo quando la correzione è una sola. `message` è in inglese, breve e
  fisso, come gli errori di `OpError`: le frasi per le persone le fa
  `fub-features` con il catalogo.
- I test: ogni esempio compila sulla lavagna d'esempio di `spec.rs`; per
  ogni vettore di `canvas-ops/` e per ogni compito del corpus, `validate`
  non trova problemi se e solo se serde legge la lista; ogni variante ha
  la sua voce in `OPS`, con almeno un esempio.
- R6 di `parity.rs` legge i nomi da `OPS` invece che dall'errore di serde.
- «Lo schema» in `canvas-code.md`: i codici dei problemi, un esempio con
  `fix`.
Casi limite: `{"op": "add-card"}` (`unknown_op` con `add_card` e il `fix`);
`ids` come stringa invece che lista (`wrong_type`, e il `fix` con la
lista); due campi sconosciuti (due problemi); 100 000 operazioni
(`validate` resta lineare; un tetto al numero di operazioni non c'è, e
non lo aggiunge questo task); un numero non finito.
Fatto quando: `cargo test -p fub-canvas-core --test spec` passa; togliendo
una voce da `OPS`, il test fallisce; R6 passa leggendo `OPS`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test spec
--test parity
Stato: [ ] da fare

## T7 · Il controllo e il riassunto

Perché: prima di scrivere, il modello e la persona devono vedere che cosa
cambierebbe, con gli avvisi che la GUI farebbe vedere a occhio
(sovrapposizioni, una scheda a metà in un gruppo, un testo che non ci
sta).
Tocca: `crates/fub-canvas-core/src/check.rs` (nuovo),
`crates/fub-canvas-core/src/summary.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs`,
`crates/fub-canvas-core/tests/check.rs` (nuovo),
`docs/reference/canvas-code.md` (da T4: «Il controllo»).
Non toccare: `compile` (il controllo lo chiama e basta).
Dipende da: T6
Cosa fare:
- `check(&Canvas, raw: &Value, seed) -> CheckReport { ok, problems,
  warnings, summary, outline_after }`. Prima `validate`, poi serde, poi
  `compile`. Un `OpError` diventa un problema con il suo `index` e il codice
  (`unknown_node`, `unknown_edge`, `duplicate_id`, `too_many`, `invalid`),
  con i nomi più vicini fra gli id della lavagna come suggerimento. Si
  ferma al primo problema di `compile`, come `compile`.
- `summarize(&Canvas, &Compiled) -> Summary`, letto dalle toppe: schede e
  archi nati, tolti, spostati, ridimensionati, i campi cambiati, l'ordine.
  Ogni voce porta gli id e, per le schede, il testo accorciato.
- Gli avvisi, solo sulle schede che le operazioni toccano: `overlap` (due
  schede che non sono gruppi si coprono), `half_in_group` (una scheda è in
  parte in un gruppo e in parte fuori), `text_overflow` (la stima di T2
  vuole più altezza di quella data).
- «Il controllo» in `canvas-code.md`: la forma del rapporto, con un
  esempio.
Casi limite: nessuna operazione valida (`ok: false`, senza riassunto né
lettura); un avviso su una scheda che c'era già e nessuno tocca (non si
dice); 2000 schede nuove (gli avvisi si cercano con una griglia di
secchi, non tutte con tutte).
Fatto quando: `cargo test -p fub-canvas-core --test check` passa con un
caso per codice e per avviso.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test check
Stato: [ ] da fare

## T8 · I comandi che leggono: `canvas.read`, `canvas.check`, `canvas.guide`

Perché: lettura, controllo e guida devono arrivare a chiunque usi i
comandi (MCP, CLI, la tavolozza, un componente), senza una porta nuova.
Tocca: `crates/fub-features/src/lavagna.rs` (tre `CommandSpec`, le
chiavi in `STRINGS`), `crates/fub-features/src/lavagna/read.rs` (nuovo),
`crates/fub-features/src/lavagna/check.rs` (nuovo),
`crates/fub-features/src/lavagna/guide.rs` (nuovo),
`crates/fub-features/src/lavagna/guida.md` (nuovo),
`crates/fub-features/src/lavagna/apply.rs` (l'errore `E_OPS_JSON`),
`crates/fub-features/tests/lavagna.rs`,
`docs/reference/canvas-operations.md` («Comandi»).
Non toccare: `fub-cli` (T22); il nucleo (qui si usa); la forma
dell'esito di `canvas.apply`.
Dipende da: T7; D2
Cosa fare:
- Tre comandi con `CommandScope::read_only()`, e l'esito
  `CommandEffect::Custom { ns: LAVAGNA_NS, payload }` come `canvas.apply`:
  - `canvas.read {doc, form?, ids?, max_chars?}` → `{version: 1, kind:
    "read", doc, revision, form, text | model, counts, bounds}`. `form` è
    `outline` (di serie), `code` o `json`; `ids` è una lista JSON in un
    parametro di testo, come `ops`;
  - `canvas.check {doc, ops, base?, seed?}` → `{version: 1, kind: "check",
    ok, problems, warnings, summary, outline_after}`. Il seme di serie è
    quello di `canvas.apply`, così gli id del controllo sono quelli della
    scrittura. Una `base` diversa dalla revisione è il problema
    `stale_base`, non un errore;
  - `canvas.guide {topic?}` → `{version: 1, kind: "guide", text, ops,
    schema, examples}`. Senza `topic` dà tutta la guida, con il nome di
    un'operazione solo quella voce. Un `topic` sconosciuto è un errore con
    i nomi vicini.
- I messaggi dei problemi li rende il catalogo (`canvas.check.p_<code>`,
  italiano e inglese). La notifica del controllo è il riassunto per una
  persona (`canvas.check.n_summary`, con i conti), e il payload resta
  strutturato.
- `guida.md` (con `include_str!`), al più 150 righe: il ciclo (leggi,
  controlla, guarda, scrivi), gli id e la revisione, «tutte o nessuna», i
  colori, come si leggono i problemi. Le operazioni non si scrivono qui:
  le dà `spec`.
- `canvas.apply`: quando la lista non si legge (`E_OPS_JSON`), l'errore
  porta anche il primo problema di `validate` (codice, posizione,
  suggerimento) come argomento della stessa chiave.
- «Comandi» in `canvas-operations.md`: i tre comandi, i parametri e la
  forma dell'esito, con un esempio per uno. La forma del rapporto rimanda
  a «Il controllo» di `canvas-code.md`.
Casi limite: un documento che non è una lavagna (l'errore di
`canvas.apply`); un `.canvas` che non si apre (lo stesso errore tipizzato);
`ids` che non è una lista; `max_chars` 0; una lavagna di 100 000 schede
(`outline` con `max_chars` di serie 20 000, `json` intero solo se chiesto).
Fatto quando: `cargo test -p fub-features --features lavagna --test
lavagna` prova i tre comandi, un problema per codice, `stale_base` e
l'errore di `canvas.apply` con il problema; `check-error-literals.mjs`
passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-features --features
lavagna --test lavagna; node .github/scripts/check-error-literals.mjs
Stato: [ ] da fare

## T9 · Le forme brevi di `add_card` e `connect`

Perché: una scheda e una freccia sono la metà dei gesti, e su main chiedono
coordinate, misure e lati calcolati a mano (14 voci dell'inventario).
Tocca: `crates/fub-canvas-core/src/ops.rs` (i campi nuovi delle due
varianti), `crates/fub-canvas-core/src/ops/card.rs` (nuovo),
`crates/fub-canvas-core/src/ops/connect.rs` (nuovo),
`crates/fub-canvas-core/src/spec.rs`, `crates/fub-canvas-core/src/describe.rs`
(`code` con le forme brevi), `apps/client/src/__fixtures__/canvas-ops/`
(vettori nuovi), `apps/client/src/__fixtures__/canvas-parity/main.json`,
`n6.json`, `apps/client/src/__fixtures__/canvas-tasks/` (`needs`),
`crates/fub-features/src/lavagna/guida.md` («Le forme brevi»),
`docs/reference/canvas-code.md` («Le operazioni»),
`docs/decisions/0240-la-lavagna-si-scrive-in-operazioni.md`
(nuovo, o il primo numero libero), `docs/decisions/README.md`.
Non toccare: le altre cinque operazioni; il significato di `node` ed
`edge`; i vettori che ci sono.
Dipende da: T8; D1
Cosa fare:
- `AddCard` prende, accanto a `node` (ora facoltativo), i campi `id`,
  `text`, `file`, `url`, `label`, `type`, `subpath`, `x`, `y`, `width`,
  `height`, `color`, `near`, `side`, `gap` e `content_size` (`[w, h]`: i
  pixel di un'immagine, o i punti della prima pagina di un PDF), tutti
  `Option`. Niente `#[serde(flatten)]`: con `deny_unknown_fields` serde non
  lo regge, quindi i campi sono espliciti.
- Le regole di `add_card`: o `node` o la forma breve, mai tutte e due
  (`Invalid`). Il tipo viene da `text` (testo), `file`, `url` (`link`) o
  `type: "group"` (`label` senza altro fa un gruppo). `x` senza `y` è
  `Invalid`. Le misure vengono da `born_size`, il posto da `place_near` o
  da `auto_place`, il colore dai nomi di «I colori». La scheda nasce come
  la scriverebbe la GUI: gli stessi campi, nello stesso ordine.
- `Connect` prende, accanto a `edge`, i campi `from`, `to`, `id`, `label`,
  `color`, `sides` (`"auto"` o `{from, to}`) ed `ends` (`arrow` di serie,
  `none`, `both`). Di serie l'arco è quello della GUI: niente lati e
  `toEnd: "arrow"`. `sides: "auto"` usa `nearest_sides`. Un arco da una
  scheda a sé stessa è valido in codice, come in JSON Canvas.
- `describe::code` scrive la forma breve quando ogni campo della scheda ci
  sta (`x` e `y` sempre, `width` e `height` solo se diverse da quelle di
  nascita), se no `node`. Il giro di T4 resta vero.
- Ogni regola ha i suoi vettori in `canvas-ops/` (almeno 12: ogni tipo, i
  quattro lati, lo scivolare, `content_size`, gli errori). Girano anche
  nella build WebAssembly (`wasm/vectors.test.ts`).
- Le 14 voci di T9 passano a `code` (R4 lo chiede).
- L'ADR, al più 180 righe: le alternative di «La forma» e perché
  operazioni d'intento con i default del nucleo, perché JSON e niente
  script, perché un padrone solo.
- «Le operazioni» in `canvas-code.md` (spostata da T4) cresce delle
  forme brevi.
Casi limite: `text` e `file` insieme (`Invalid`); `near` che non c'è
(`UnknownNode`); `side` sconosciuto (`bad_value` dallo schema); un `id`
già preso (`DuplicateId`); `content_size` `[0, 0]` (le misure di serie);
un testo di 1 MiB (`MAX_TEXT_BYTES`); `ends: "both"` con
`sides: "auto"` e due schede sovrapposte (i centri uguali: `right`→`left`).
Fatto quando: `cargo test -p fub-canvas-core` passa con i vettori nuovi;
`parity` dice 14 voci in meno; nel corpus i compiti delle schede e delle
frecce non hanno più `needs`; Vitest dei vettori passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas/wasm
Stato: [ ] da fare

## T10 · Colori, ordine, gruppi che portano, misure che si adattano

Perché: colorare con un nome, portare sotto, spostare un gruppo col suo
contenuto e adattare una scheda al contenuto sono gesti della GUI che il
codice fa solo calcolando (6 voci).
Tocca: `crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/ops/color.rs`
(nuovo), `crates/fub-canvas-core/src/ops/adjust.rs` (nuovo: `move`
con `contents`, `reorder` con `to`, `resize` con `fit`),
`crates/fub-canvas-core/src/spec.rs`, `apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/main.json`, `n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`crates/fub-features/src/lavagna/prefill.rs` (nuovo),
`crates/fub-features/src/lavagna/apply.rs`,
`crates/fub-features/src/lavagna/check.rs` (da T8),
`crates/fub-features/src/draw.rs` (una funzione `pub(crate)`),
`crates/fub-features/tests/lavagna.rs`,
`docs/reference/canvas-code.md`.
Non toccare: il significato di `move`, `reorder` e `resize` senza i campi
nuovi; `set` con un colore già scritto come `"1"` o `#rrggbb`.
Dipende da: T9; D1
Cosa fare:
- `color {ids, color}`: schede e archi, con i nomi di «I colori» o
  `null`. Anche `set` con `fields.color` accetta i nomi e scrive il valore
  di JSON Canvas.
- `reorder {ids, to?}`: `front` di serie (com'è), `back` porta sotto,
  nell'ordine dato.
- `move {ids, dx, dy, contents?}`: con `contents: true` un gruppo porta le
  schede tutte dentro di lui (`inside` di T2), una volta sola anche se
  sono anche in `ids`.
- `resize {id, width?, height?, fit?}`: `fit: "content"` tiene la
  larghezza e calcola l'altezza: per un testo con la stima di T2, per
  un'immagine o un PDF con `content_size` (dato, o dal riempimento). Senza
  la misura del contenuto è `Invalid`, e la ragione lo dice.
- Il riempimento (`prefill.rs`, con `cfg(all(feature = "lavagna", feature
  = "draw"))`): prima di compilare, per ogni `add_card` con `file` e senza
  `content_size`, e per ogni `resize` con `fit` su una scheda di file, si
  leggono i byte (`read_document_bytes`, al più 32 MiB). Le immagini si
  misurano con `imagesize`. Per i PDF, `draw.rs` espone `pub(crate) fn
  pdf_pages(bytes) -> Option<PdfPages { count, first: (f64, f64) }>`, con
  `lopdf` e `Geometry::of(doc, id).size()` della prima pagina: `annotated`
  e `geometry` restano moduli privati. Un
  file che non c'è o non si legge lascia l'operazione com'è: decidono le
  misure di serie. Senza `draw` il riempimento non fa niente. Lo usano
  `canvas.apply` e `canvas.check`.
- I vettori, le 6 voci, i `needs`, «Le operazioni».
Casi limite: un colore `"7"` (fuori da JSON Canvas: `bad_value`);
`#ABC` (`bad_value`: solo sei cifre); `contents` su una scheda che non è
un gruppo (vale `false`); un gruppo dentro un gruppo (porta anche le
schede del gruppo interno, se sono dentro); un PDF cifrato o un'immagine
rotta (le misure di serie); un file di 40 MiB (non si legge).
Fatto quando: `cargo test -p fub-canvas-core` e `cargo test -p
fub-features --features lavagna,draw --test lavagna` passano, e c'è un
caso con un'immagine vera piccola nel vault di prova; `parity` dice 6 voci
in meno.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo
test -p fub-features --features lavagna,draw --test lavagna
Stato: [ ] da fare

## T11 · Allinea, distribuisci, duplica, inverti, raggruppa

Perché: sono i bottoni della barra e le voci del menu. In codice ognuno è
una riga, con la stessa regola (5 voci).
Tocca: `crates/fub-canvas-core/src/ops.rs`,
`crates/fub-canvas-core/src/ops/align.rs`, `ops/duplicate.rs`,
`ops/reverse.rs`, `ops/group.rs` (nuovi), `crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/main.json`, `n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-code.md`.
Non toccare: `engine.ts` (passa a queste operazioni con T23);
`layout/arrange.rs` (si usa).
Dipende da: T10, T5; D1
Cosa fare:
- `align {ids, to}` (`left`, `center`, `right`, `top`, `middle`,
  `bottom`) e `distribute {ids, axis}` (`x`, `y`), con `arrange::align` e
  `arrange::distribute`. Con troppe poche schede non escono toppe, e non è
  un errore.
- `duplicate {ids, dx?, dy?}`: le schede e gli archi che hanno tutti e due
  gli estremi fra loro. Gli id sono nuovi, dal seme. Lo spostamento di
  serie è 32 e 32, agganciato. `created` dà prima le schede, poi gli
  archi, nell'ordine dato.
- `reverse {ids}`: scambia `fromNode`/`toNode`, `fromSide`/`toSide` e
  `fromEnd`/`toEnd`, come `engine.ts` (riga 1494). Una punta che manca
  vale quella di serie di JSON Canvas (`fromEnd` `none`, `toEnd` `arrow`)
  prima di scambiare.
- `group {ids, label?, id?, color?}`: il rettangolo è `group_rect` con
  margine 24. Il gruppo nasce nell'ordine appena sotto la più bassa delle
  schede raggruppate (`UpsertNode` con `at`).
- I vettori (almeno 2 per operazione, e le formule della barra), le 5
  voci, i `needs`, «Le operazioni».
Casi limite: `align` con una sola scheda (niente toppe); `duplicate` di
un gruppo senza le schede dentro (si copia il gruppo e basta, come la
GUI); `duplicate` che supera `MAX_NODES` (`TooMany`); `reverse` di un id
che è una scheda (`UnknownEdge`); `group` di schede già in un gruppo (il
gruppo nuovo sta sopra quello vecchio, sotto le schede).
Fatto quando: `cargo test -p fub-canvas-core` passa; i vettori di
`align` e `distribute` danno le posizioni che dà la barra di `engine.ts`
(gli stessi casi di T5); `parity` dice 5 voci in meno.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas/wasm
Stato: [ ] da fare

## T12 · Disponi: `layout`

Perché: mettere in griglia, in riga, in colonna o ad albero è ciò che un
modello vuole più spesso, e la GUI lo fa quando si trascinano tanti file.
Tocca: `crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/ops/layout.rs`
(nuovo), `crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-code.md`.
Non toccare: `drop-layout.ts` di N6 (passa al nucleo con T24).
Dipende da: T11; D1
Cosa fare:
- `layout {ids?, kind, gap?, x?, y?, direction?}`. `kind` è `grid`,
  `row`, `column` o `tree`; `direction` (`down` di serie, `right`, `up`,
  `left`) vale solo per `tree`. Senza `ids` sono tutte le schede che non
  sono in un gruppo. L'origine di serie è l'angolo in alto a sinistra
  delle schede date.
- Le schede si mettono nell'ordine dato: chi vuole un altro ordine lo dà
  (la GUI ordina i file con `Intl.Collator` prima di compilare). Un gruppo
  nella lista si muove come un blocco, con le schede tutte dentro.
- `tree` usa gli archi fra le schede date.
- I vettori, la voce, i `needs`.
Casi limite: una scheda sola (va nell'origine); `ids` vuoto (niente
toppe); un albero senza archi (una riga di radici); 2000 schede (sotto il
secondo nel test, in build di debug).
Fatto quando: `cargo test -p fub-canvas-core` passa; i compiti del corpus
con la griglia e l'albero non hanno `needs`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
op_vectors --test task_corpus
Stato: [ ] da fare

## T13 · Incolla un frammento, trasforma un testo in file

Perché: incollare schede e trasformare un testo in nota sono gesti di N6
che il codice non sa fare (3 voci).
Tocca: `crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/ops/insert.rs`
e `ops/convert.rs` (nuovi), `crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-code.md`.
Non toccare: gli appunti della GUI (`application/x-fub-canvas+json` di N6
T68: la forma si usa, il codice della GUI passa a `insert` con T24).
Dipende da: T12; D1
Cosa fare:
- `insert {fragment, x?, y?, near?, side?}`: `fragment` è la forma degli
  appunti di N6 T68, `{version: 1, nodes, edges}`. Ogni scheda e ogni arco
  prende un id nuovo dal seme, e gli archi seguono le schede. Il
  frammento si sposta come un blocco: l'angolo del suo riquadro va in
  `x`, `y`, se no in `near`, se no nel posto automatico. `created` è
  nell'ordine del frammento.
- `convert {id, file}`: una scheda di testo diventa una scheda di file con
  `file`, e tiene posto, misure e colore. Il file lo scrive un'altra porta
  (`fub_create`, la GUI): la voce è `composed`.
- I vettori, le 3 voci, i `needs`.
Casi limite: un arco del frammento con un estremo fuori (`Invalid`, con
l'id); `version` 2 (`Invalid`); 10 000 schede (il limite di `insert`,
oltre `TooMany`); `convert` di una scheda che non è un testo (`Invalid`);
un `file` vuoto (`Invalid`).
Fatto quando: `cargo test -p fub-canvas-core` passa; `parity` dice 3 voci
in meno.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core
Stato: [ ] da fare

## T14 · Spargi le pagine, estratti

Perché: spargere le pagine di un PDF e fare un estratto sono di N6 (T72,
T73, T75), e in codice devono avere la stessa forma (2 voci).
Tocca: `crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/ops/pages.rs`
(nuovo), `crates/fub-canvas-core/src/spec.rs`,
`crates/fub-features/src/lavagna/prefill.rs` (da T10: il numero delle
pagine), `apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-code.md`.
Non toccare: `parts.rs` di N6 T73 (si usa); il formato di `fub:parts`.
Dipende da: T13; N6 T72 e T73 in main; D1
Cosa fare:
- `spread_pages {id, pages?, page_count?}`: `pages` come la GUI («3-7, 9»,
  «20-») o come lista. Il numero delle pagine lo dà il riempimento (con
  `lopdf`) o `page_count`. Una scheda per pagina, con `subpath` `#page=N`
  e le misure di nascita del PDF, in riga a destra della scheda (a 48),
  a capo dopo 10 (a 24), e oltre 12 dentro un gruppo. Al più 1000 pagine.
- `excerpt {id, part, near?, side?}`: una scheda nuova sullo stesso file,
  con `subpath` e `fub:parts` scritti dalle regole di `parts.rs`, accanto a
  `id`. Le misure vengono dalla parte: una pagina come il PDF, una
  regione con le proporzioni del suo rettangolo, sezioni come una nota,
  un'immagine con le proporzioni del ritaglio.
- I vettori, le 2 voci, i `needs`.
Casi limite: un intervallo fuori dalle pagine (si taglia, e il riassunto
lo dice); `pages` senza `page_count` e senza riempimento (`Invalid`); 1001
pagine (`TooMany`); una parte non valida (`Invalid`, con la ragione di
`parts.rs`).
Fatto quando: `cargo test -p fub-canvas-core` passa; il compito del corpus
con il PDF sparso non ha `needs`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo
test -p fub-features --features lavagna,draw --test lavagna
Stato: [ ] da fare

## T15 · Le penne in Rust

Perché: `draw` deve scrivere lo stesso pennello che scrive la GUI con la
stessa penna, e le penne sono solo in TypeScript.
Tocca: `crates/fub-ink-codec/src/pens.rs` (nuovo, di N4 il crate),
`crates/fub-ink-codec/src/lib.rs`, `crates/fub-ink-codec/tests/pens_mirror.rs`
(nuovo), `apps/client/src/__fixtures__/ink-pens.json` (nuovo, generato),
`apps/client/src/ink/pens-mirror.test.ts` (nuovo).
Non toccare: `apps/client/src/ink/pens.ts` e `palette.ts` (fanno fede:
Rust li segue); il formato del pennello di N4.
Dipende da: T9; N4 in main; D3
Cosa fare:
- `pens.rs`: i sette `PenSpec { id, tool, size, opacity, blend, pressure }`
  di `PENS`, `MIN_PEN_SIZE` e `MAX_PEN_SIZE`, e `pen_brush(pen, size,
  pressure) -> Brush`, che dà lo stesso pennello di `penBrush` (la ricetta
  `pf1Pen` o quella della calligrafia, la chiave della penna, e `sim` solo
  per le penne che seguono la pressione). Poi la tavolozza:
  `INK_PALETTE` con gli otto `{id, color}`, e `ink_color(name) ->
  Option<&str>`.
- Lo specchio: `pens_mirror.rs` scrive `ink-pens.json` con
  `UPDATE_MIRROR=1 cargo test -p fub-ink-codec --test pens_mirror` (e
  senza la variabile la confronta). Contiene, per ogni penna e per le
  misure 0,25, 1, quella di serie e 200, con e senza pressione, il
  pennello codificato, più la tavolozza. `pens-mirror.test.ts` vuole le
  stesse risposte da `penBrush` e da `INK_PALETTE`. L'intestazione del
  file generato dice il comando.
Casi limite: una misura fuori da 0,25…200 (si stringe, come la GUI); la
calligrafia con `tip` più grande della misura; un nome di colore in
maiuscolo (non vale: i nomi sono in minuscolo).
Fatto quando: lo specchio passa in Rust e in Vitest; cambiando una cifra
di `pens.ts`, Vitest fallisce.
Prova: scripts/check.sh --rapido; cargo test -p fub-ink-codec; cd
apps/client && npx vitest run src/ink/pens-mirror.test.ts
Stato: [ ] da fare

## T16 · Disegnare in codice: `draw`

Perché: l'inchiostro è metà della lavagna, e un modello non sa scrivere
la stringa codificata di `fub:ink`. Con `draw` scrive punti o una forma
(5 voci).
Tocca: `crates/fub-canvas-core/src/ops.rs`, `crates/fub-canvas-core/src/ops/draw.rs`
(nuovo), `crates/fub-canvas-core/src/ops/anchor.rs` (nuovo),
`crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/ink-anchor.json` (nuovo, scritto a mano),
`apps/client/src/editors/canvas/anchor-vectors.test.ts` (nuovo),
`apps/client/src/__fixtures__/canvas-parity/n4.json`, `n6.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-ink.md` (di N4: «In codice»).
Non toccare: `anchor.ts` di N4 (fa fede: il nucleo lo segue); il formato
di `fub:ink`; `add_strokes` (`draw` lo usa dentro).
Dipende da: T15, T13; N4 in main; D3
Cosa fare:
- `draw {on?, points?, shape?, pen?, size?, color?, id?}`, con `points`
  o `shape` (uno solo). `on` e le forme sono quelli di «L'inchiostro in
  codice».
- `ops/anchor.rs` porta `strokeBounds` e `anchorAt` di `anchor.ts` riga
  per riga (le stesse guardie sui numeri non finiti), con `can_hold` per
  specie di `card_kind`, la stessa regola che la tela passa ad `anchorAt`.
  I casi in `ink-anchor.json` girano in Rust e in Vitest contro
  `anchor.ts`.
- Le forme diventano punti con passo 4 (in unità della lavagna o della
  scheda). `rect` e `polygon` sono chiusi, `ellipse` ha almeno 64
  campioni, e `arrow` è un tratto solo: l'asta, poi la punta a 30° lunga
  `max(12, 3 · size)`, fino alla cima e indietro. La pressione è 0,5, se
  non è data. Il tempo è sintetico: 8 ms per campione.
- I punti si convertono nelle unità dell'ancora: `card` alla misura della
  scheda in quel momento, `free` alla lavagna. Poi si codificano con
  `fub-ink-codec`, col pennello di `pen_brush` e il colore di
  `ink_color`, e il tratto entra come farebbe `add_strokes`: lo stesso
  livello e lo stesso ordine dei campi. L'id viene dal seme, o è `id`.
- I vettori (ogni forma, ogni `on`, il caso libero, gli errori), le 5
  voci, i `needs`, «In codice» in `canvas-ink.md`.
Casi limite: un punto solo (un tocco: vale); 10 001 punti (`TooMany`);
`on` su un gruppo (non regge l'inchiostro: `Invalid`); `on: "auto"` sopra
due schede (vale quella più in alto, se lo prende: la regola di
`anchorAt`); `star` con meno di 3 punte (`Invalid`); un colore di scheda
come `cyan` (`bad_value`, con i nomi d'inchiostro vicini); `size` 0
(`bad_value`).
Fatto quando: `cargo test -p fub-canvas-core` passa; i vettori di
`ink-anchor.json` passano in Rust e in Vitest; i compiti del corpus con
l'inchiostro non hanno `needs` se non `erase_along`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas/anchor-vectors.test.ts
src/editors/canvas/wasm
Stato: [ ] da fare

## T17 · Leggere l'inchiostro

Perché: un modello deve sapere dove sono i tratti prima di aggiungerne o
di cancellarli, e il giro di `code` deve restare vero con l'inchiostro.
Tocca: `crates/fub-canvas-core/src/describe.rs`,
`crates/fub-canvas-core/tests/describe.rs`, `docs/reference/canvas-ink.md`
(di N4: «In codice», la lettura).
Non toccare: `ops.rs`; il formato di `fub:ink`.
Dipende da: T9; N4 in main
Cosa fare:
- `outline`: su ogni riga di una scheda, `ink=N` con il riquadro dei
  tratti nelle coordinate della scheda. Una riga `ink board N` con il
  riquadro dei tratti liberi. Una riga per arco con l'inchiostro, se ce
  l'ha.
- `json`: i tratti decodificati (`{id, color, size, tool, pen?, bounds,
  points}`), con i punti arrotondati a 0,1. `max_chars` vale anche qui.
- `code`: i tratti con `add_strokes` (la stringa esatta), così il giro
  resta esatto. `draw` è per scrivere, non per rileggere.
- Il giro di T4 con i vettori d'inchiostro di N4 (`canvas-ink/`).
Casi limite: un tratto che non si decodifica (la riga dice `ink=N bad=M`,
il giro lo porta com'è); 100 000 campioni (`json` li taglia con
`max_chars`); un'ancora fuori posto (si conta, non si disegna).
Fatto quando: `cargo test -p fub-canvas-core --test describe` passa con i
vettori d'inchiostro.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
describe
Stato: [ ] da fare

## T18 · La gomma che taglia: `erase_along`

Perché: cancellare metà di un tratto è un gesto di N4 (T22). Senza questa
operazione, in codice si toglie solo il tratto intero (1 voce).
Tocca: `crates/fub-ink-codec/src/cut.rs` (nuovo),
`crates/fub-ink-codec/src/lib.rs`, `crates/fub-canvas-core/src/ops.rs`,
`crates/fub-canvas-core/src/ops/erase.rs` (nuovo),
`crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/ink-cut.json` (nuovo, scritto a mano),
`apps/client/src/ink/tools/split-vectors.test.ts` (nuovo),
`crates/fub-ink-codec/tests/cut_vectors.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/n4.json`,
`apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-ink.md`.
Non toccare: `apps/client/src/ink/tools/split.ts` (fa fede: Rust lo
segue); `erase_strokes`.
Dipende da: T16; N4 T22 in main; D3
Cosa fare:
- `cut.rs` porta `splitInk` e `cutBrush` di `split.ts`: un tratto toccato
  dal cammino con raggio `size / 2` si spezza nei pezzi che restano. Ogni
  pezzo ha un id nuovo, e il pennello è tagliato come in TypeScript.
- `erase_along {points, size, on?}`: i punti nelle coordinate di `on`,
  come `draw` (di serie la lavagna, che tocca i tratti liberi e quelli
  delle schede sotto il cammino). Le toppe tolgono i tratti toccati e
  aggiungono i pezzi, tutte o nessuna.
- I casi in `ink-cut.json` (un taglio a metà, all'inizio, alla fine, un
  tratto intero, nessun tocco, un tocco solo) girano in Rust e in Vitest
  contro `split.ts`.
- I vettori, la voce, i `needs`, «In codice».
Casi limite: un cammino che non tocca niente (niente toppe); un tratto che
sparisce tutto (si toglie); 10 001 punti (`TooMany`); un tratto che non si
decodifica (non si tocca, e il riassunto lo dice).
Fatto quando: `ink-cut.json` passa in Rust e in Vitest;
`cargo test -p fub-canvas-core` passa; il compito del corpus «cancellare
metà di un tratto» non ha `needs`.
Prova: scripts/check.sh --rapido; cargo test -p fub-ink-codec; cargo test
-p fub-canvas-core; cd apps/client && npx vitest run
src/ink/tools/split-vectors.test.ts
Stato: [ ] da fare

## T19 · Disegnare sulla pagina e sulla cella

Perché: N6 attacca l'inchiostro alla pagina di un PDF (T19) e alla cella
di un foglio (T37). In codice serve la stessa ancora (2 voci).
Tocca: `crates/fub-canvas-core/src/ops/draw.rs` (da T16),
`crates/fub-canvas-core/src/ops/erase.rs` (da T18),
`crates/fub-canvas-core/src/spec.rs`,
`crates/fub-features/src/lavagna/prefill.rs` (la misura della pagina),
`apps/client/src/__fixtures__/canvas-ops/`,
`apps/client/src/__fixtures__/canvas-parity/n6.json`,
`docs/reference/canvas-ink.md`.
Non toccare: il formato delle ancore `page` e `cell` (di N6).
Dipende da: T16; N6 T19 e T37 in main; D3
Cosa fare:
- `on: {card, page, page_size?}`: i punti in punti PDF dall'angolo in alto
  a sinistra della pagina, e l'ancora `{"kind": "page", "page", "width",
  "height"}`. Se manca, `page_size` lo dà il riempimento (`pdf_pages` di
  T10, esteso alla pagina N).
- `on: {card, sheet, cell}`: i punti in pixel del foglio al 100%
  dall'angolo della cella, e l'ancora `{"kind": "cell", "sheet",
  "cell"}`. Serve una scheda di foglio, e la cella deve essere A1 valida.
- Gli stessi `on` valgono per `erase_along`.
- I vettori, le 2 voci, «In codice».
Casi limite: una pagina oltre l'ultima (`Invalid`, quando il numero è
noto); `XFD1048576` (vale); `A0` (`bad_value`); un foglio con spazi nel
nome; `on.page` su una scheda che non è un PDF (`Invalid`).
Fatto quando: `cargo test -p fub-canvas-core` passa, e i tratti scritti si
leggono con le regole di N6 T19 e T37 (i loro vettori, con i tratti di
`draw`).
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo
test -p fub-features --features lavagna,draw --test lavagna
Stato: [ ] da fare

## T20 · Da Mermaid e da una scaletta

Perché: un modello scrive già Mermaid e le scalette. Diventano una lavagna
vera, disposta, con gruppi e frecce, e ciò che si perde si dice.
Tocca: `crates/fub-canvas-core/src/import/mod.rs`,
`import/mermaid.rs`, `import/outline.rs` (nuovi),
`crates/fub-canvas-core/src/ops.rs` (le due varianti e
`Compiled::notes`), `crates/fub-canvas-core/src/check.rs` (le note come
avvisi), `crates/fub-canvas-core/src/spec.rs`,
`apps/client/src/__fixtures__/canvas-import/` (nuovo: coppie testo →
lavagna), `crates/fub-canvas-core/tests/import_vectors.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-parity/board.json`
(`ops_without_gui`, se cambia), `apps/client/src/__fixtures__/canvas-tasks/`,
`docs/reference/canvas-code.md` («Da Mermaid e da una scaletta»).
Non toccare: le dipendenze del nucleo (`CANVAS_CORE_ALLOWED_DIRECT`: il
lettore si scrive a mano); `layout/arrange.rs` (si usa).
Dipende da: T12; D4
Cosa fare:
- `from_mermaid {text, x?, y?, near?, side?, prefix?}`. Si legge
  `flowchart` o `graph` con `TD`, `TB`, `LR`, `BT` o `RL`. I nodi sono `A`,
  `A[testo]`, `A(testo)`, `A([testo])`, `A{testo}`, `A((testo))`,
  `A[[testo]]`, `A>testo]`, anche fra virgolette. Gli archi sono `-->`,
  `---`, `-.->`, `==>`, `<-->`, `-- testo -->` e `-->|testo|`, anche in
  catena (`A --> B --> C`) e con `&`. Poi `subgraph id [titolo]` … `end`,
  anche annidati, e i commenti `%%`.
- Ogni nodo è una scheda di testo, con la stima di T2. L'id è quello di
  Mermaid, con `prefix` davanti: è il nome che il modello ha scelto. Un id
  già preso è `DuplicateId`, e il suggerimento è un `prefix`. `---` non ha
  punte, `<-->` ne ha due.
- La disposizione: ogni `subgraph` è un blocco disposto ad albero dentro
  di sé, e il blocco diventa un gruppo con il titolo e margine 24. I
  blocchi e i nodi liberi si dispongono come un albero, dove un arco fra
  due blocchi conta come un arco fra i blocchi. La direzione viene
  dall'intestazione. Il tutto va nel posto dato, se no in quello
  automatico.
- `from_outline {text, direction?, x?, y?, near?, side?, prefix?}`: una
  riga è una scheda. Un livello è 2 spazi o un tab, e i segni `-`, `*`,
  `+` e `1.` si tolgono. Un arco va dal genitore al figlio, e il tutto si
  dispone con `tree`. Gli id sono `prefix` più il numero della riga, o
  dal seme.
- `Compiled` ha in più `notes: Vec<CompileNote { index, code, detail }>`:
  ciò che un'operazione non ha potuto tenere (`shape_dropped`,
  `style_dropped`, `line_skipped` per `classDef`, `style`, `linkStyle`,
  `click`). `check` le mostra come avvisi, `canvas.apply` le mette
  nell'esito.
- I limiti: 256 KiB di testo, 2000 nodi, oltre `TooMany`. Una riga che non
  si capisce è `line_skipped`, non un errore, finché resta almeno un nodo.
  Senza nodi è `Invalid` con la prima riga sbagliata.
Casi limite: `sequenceDiagram` (`Invalid`: «solo flowchart»); un nodo
nominato prima di essere definito (vale, e il testo arriva dopo); un
`subgraph` vuoto (un gruppo con la misura di nascita); un ciclo; un testo
con `"` e `#quot;`; righe con CRLF; una scaletta con rientri incoerenti
(3 spazi: vale il livello più vicino, e una nota lo dice).
Fatto quando: `cargo test -p fub-canvas-core --test import_vectors`
passa su almeno 15 coppie; il compito del corpus con Mermaid non ha
`needs`; `dependency_invariant` passa senza cambiare.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cargo
test -p fub-abi --test dependency_invariant
Stato: [ ] da fare

## T21 · L'anteprima

Perché: un modello che vede l'immagine si accorge da solo di una freccia
storta o di due schede una sopra l'altra.
Tocca: `crates/fub-canvas-core/src/preview.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs`, `crates/fub-canvas-core/tests/preview.rs`
(nuovo), `crates/fub-features/src/lavagna/preview.rs` (nuovo),
`crates/fub-features/src/lavagna.rs` (il comando, le chiavi),
`crates/fub-features/src/draw.rs` (`encode_png` diventa `pub(crate)`),
`crates/fub-features/tests/lavagna.rs`,
`docs/reference/canvas-operations.md` («Comandi»: `canvas.preview`).
Non toccare: la tela (l'anteprima non è una vista della GUI); `resvg`
(c'è già con `draw`).
Dipende da: T7; D5
Cosa fare:
- `sketch_svg(&Canvas, &SketchOptions { size, ordinals }) -> String`, senza
  font. Le schede sono rettangoli col loro colore (i sei di JSON Canvas a
  valori fissi, l'esadecimale com'è, grigio senza colore), i gruppi
  tratteggiati, gli archi linee dai centri dei lati (o dai centri delle
  schede) con le punte. I tratti, quando N4 è in main, sono polilinee col
  loro colore e spessore. Su ogni scheda c'è il suo numero d'ordine,
  quello di `outline`, disegnato a sette segmenti. Il riquadro è quello
  del contenuto più 32.
- `canvas.preview {doc, ops?, base?, seed?, size?}` → `{version: 1, kind:
  "preview", doc, revision, image: {media_type, width, height, data},
  outline}`. Con `ops` disegna la lavagna di dopo, senza scriverla. Con
  `draw` dà un PNG (`resvg`, lato lungo `size`: di serie 1024, al più
  2048) in base64, senza `draw` l'SVG come testo.
- `CommandScope::read_only()`, come T8.
Casi limite: lavagna vuota (un'immagine 64×64 vuota); una lavagna larga
100 000 e alta 10 (la misura minima di un lato è 64); 10 000 schede (sotto
i due secondi in release, i numeri d'ordine solo se la scheda è larga
almeno 16 pixel nell'immagine); `size` 10 000 (si stringe a 2048).
Fatto quando: `cargo test -p fub-canvas-core --test preview` confronta
l'SVG di tre lavagne con il suo atteso; `cargo test -p fub-features
--features lavagna,draw --test lavagna` prova il PNG (misure, firma PNG) e
l'SVG senza `draw`.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core --test
preview; cargo test -p fub-features --features lavagna,draw --test lavagna
Stato: [ ] da fare

## T22 · MCP: leggere, guidare, controllare prima di scrivere

Perché: un modello arriva a Fub quasi sempre da MCP. Fra gli strumenti deve
trovare da solo come si legge una lavagna e dove sta la guida, e non deve
poter scrivere una lista che il controllo rifiuta.
Tocca: `crates/fub-cli/src/mcp.rs` (`INSTRUCTIONS`, `resources_list`,
`resources_read`), `crates/fub-cli/src/mcp/tools.rs` (due strumenti nuovi,
`fub_canvas_apply`, `fub_preview`), `crates/fub-cli/tests/mcp.rs`,
`docs/reference/mcp-server.md` («Strumenti», «Risorse», «Regole di
scrittura»).
Non toccare: `fub-canvas-core` (`fub-cli` non lo può nominare:
`CANVAS_CORE_ALLOWED_DIRECT` in `dependency_invariant.rs`), quindi tutto
passa dai comandi con `invoke_user_command`; `parse_fub_uri` di
`fub-host` (non cresce: le guide hanno il loro schema); i comandi di
`fub-features` (T8, T21: qui si chiamano e basta).
Dipende da: T8 (T21 per `preview`); D2, D5
Cosa fare:
- `fub_canvas_read {doc, form?, ids?, max_chars?}` chiama `canvas.read`, e
  `fub_canvas_guide {topic?}` chiama `canvas.guide`. Tutti e due
  `readOnlyHint: true`; `fub_canvas_read` passa da `access.check_read`.
  `ids` è una lista, riscritta come testo per il comando (come `ops`).
- `fub_canvas_apply` chiama prima `canvas.check` con gli stessi `doc`,
  `ops`, `base`:
  - se `ok` è falso non chiama `canvas.apply`, neanche in prova. Risponde
    `{doc, written: false, ok: false, problems, warnings, summary}`, e il
    testo comincia col numero dei problemi e il primo;
  - se l'unico problema è `stale_base`, risponde il `conflict` di adesso,
    con lo stesso codice e lo stesso tipo: un client che lo gestisce non
    cambia;
  - con `ok` vero: senza `apply` `{doc, dry_run: true, check, outcome}`,
    con `apply` la risposta di adesso più `warnings`;
  - `preview: true` (nuovo campo dello schema) aggiunge l'immagine di
    `canvas.preview {doc, ops, base}`, la lavagna di dopo, con
    `preview_image` come `fub_preview`. Un SVG (senza `draw`) resta nel
    testo, perché `PREVIEW_MEDIA` lascia passare solo PNG e JPEG.
- La descrizione di `fub_canvas_apply` nomina ogni operazione e rimanda a
  `fub_canvas_guide` per i campi. Resta un testo fisso in `tools.rs`, e un
  test lo confronta con `ops` di `canvas.guide`: un'operazione nuova senza
  il suo nome nella descrizione fa fallire il test.
- Risorse. Quando `canvas.guide` risponde (componente `lavagna` acceso), la
  prima pagina di `resources/list` (senza `cursor`) comincia con tre
  risorse: `fub-guida://lavagna` (`text/markdown`, la guida),
  `fub-guida://lavagna/schema` e `fub-guida://lavagna/esempi`
  (`application/json`). Il `cursor` resta l'offset delle note, e le pagine
  delle note restano da 100. `resources/read` riconosce le tre stringhe
  esatte prima di `parse_fub_uri`; ogni altro `fub-guida://` è
  `invalid_params`. Lo schema è a parte perché `fub://` è il link dell'app,
  e il suo parser rifiuta le rotte che non conosce.
- `INSTRUCTIONS`, una frase in più: una lavagna si legge con
  fub_canvas_read, la guida è fub_canvas_guide, fub_canvas_apply controlla
  prima di scrivere e con `preview` mostra il dopo.
- `fub_preview` su un `.canvas` chiama `canvas.preview` (`small` 512,
  `large` 1024), con `origin: "canvas"` e la stessa forma di risposta. Gli
  altri file vanno a `craft.preview` come adesso.
- Se A1 T11 è già in main, si riparte dal suo `INSTRUCTIONS` e dai suoi
  strumenti: si aggiunge, non si riscrive.
Casi limite: `lavagna` spento (gli strumenti nuovi rispondono
`unavailable` come `fub_preview` senza Craft, e le tre risorse non ci
sono); un server senza radici di scrittura (`fub_canvas_read` e
`fub_canvas_guide` funzionano, `fub_canvas_apply` resta `denied` prima del
controllo); una lavagna fuori dalle radici di lettura (rifiutata come
`fub_read`); `preview: true` senza `draw` (testo, nessuna immagine); una
lista con 500 problemi (il testo ne dice uno, il payload tutti); una lista
non JSON (il problema di `canvas.check`, non un errore del protocollo).
Fatto quando: `cargo test -p fub-cli --test mcp` prova i due strumenti
nuovi, il rifiuto senza scrittura (il file ha gli stessi byte), il
`conflict` di `stale_base`, l'immagine di `preview`, le tre risorse in
testa alla prima pagina e assenti sulla seconda, l'URI `fub-guida://` che
non esiste, e la descrizione contro `canvas.guide`. L'elenco di
`tools/list` del test cresce dei due nomi.
Prova: scripts/check.sh --rapido; cargo test -p fub-cli --test mcp
Stato: [ ] da fare

## T23 · La GUI scrive con le operazioni: menu, barra, campi e tasti

Perché: «esattamente come la GUI» si prova solo se la GUI e il codice
passano dalla stessa porta. Oggi `engine.ts` costruisce le toppe da sé:
con questo task chiama `compile`, e un test confronta ogni azione con la
sua forma in codice.
Tocca: `apps/client/src/editors/canvas/engine.ts` (le azioni di menu,
barra, campi e tasti), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/chrome/commands.ts` e `commands.test.ts`
(di N6 T48: il campo `op`), `apps/client/src/editors/canvas/operation.ts`
(solo per togliere le funzioni che restano senza chiamate),
`apps/client/src/editors/canvas/parity.test.ts` (da T1: R8),
`crates/fub-canvas-core/src/layout.rs` (le estensioni Craft in
`card_kind`), `apps/client/src/__fixtures__/canvas-layout.json` (i loro
casi), `apps/client/src/__fixtures__/canvas-ops/` (un vettore con una
scheda Craft), `docs/reference/canvas-cards.md` (di N6: «Comandi e
tasti»).
Non toccare: i gesti, il trascinamento e gli appunti (T24); i file
dell'inventario (`canvas-parity/*.json`: R8 li legge e basta); il nucleo
oltre `card_kind`; la vista (zoom, selezione).
Dipende da: T13; N6 in main (T48 compreso)
Cosa fare:
- `CanvasEngineOptions` prende `seed?: () => bigint`. Di serie è un numero
  casuale per gesto (`crypto.getRandomValues`), e i test lo fissano.
- Ogni azione che scrive dal menu, dalla barra, da un campo o da un tasto
  costruisce la sua lista di `CanvasIntentOp`, chiama
  `core.compile(ops, seed)` e passa le toppe a `#commit(patches,
  "input")`. Un'azione è un passo di annulla. Un rifiuto del nucleo non
  scrive niente e si vede come gli altri errori della tela.
- `CanvasCommand` di N6 prende `op?: (ctx) => CanvasIntentOp[]`. Ogni
  comando che scrive lo ha, e il suo `run` è compila e scrivi.
  `commands.test.ts` controlla che ogni comando con `writes: "file"`
  nell'inventario abbia `op`.
- Ctrl+D diventa `duplicate {ids}`, e così copia anche gli archi fra le
  schede (D1). La pagina lo dice.
- R8 in `parity.test.ts`. Per ogni voce `code` o `composed` di una fonte
  in `merged`, con un `gui` di tipo `menu`, `toolbar`, `field` o `key`:
  - si monta la tela su `board.json` con `seed: () => 1n`;
  - si selezionano gli id che le `ops` della voce nominano, o quelli della
    tabella `SETUP` del test (che dà anche il valore di un campo o il
    colore scelto);
  - si fa l'azione, poi si confronta il modello con quello di
    `compile(entry.ops, 1)` su un secondo nucleo aperto sulla stessa
    lavagna. Un annulla torna a `board.json`.
  Una voce che non si confronta va in `SETUP` con `skip` e il perché, e il
  test conta gli `skip` (al più 5).
- `card_kind`: le estensioni Craft di N6 T18 vanno a `craft`, con i loro
  casi in `canvas-layout.json` e un vettore in `canvas-ops/`.
- Le funzioni di `operation.ts` che restano senza chiamate si tolgono.
  `operation.ts` non cresce.
Casi limite: un comando con la selezione vuota (spento, nessuna
compilazione); una lavagna troppo grande per il nucleo
(`#isSceneOversized`: le azioni si spengono come adesso); un campo con un
valore che il nucleo rifiuta (niente scrittura, il campo torna com'era);
due azioni di fila (due passi di annulla); il nucleo non ancora pronto
(l'azione aspetta o si spegne, come adesso).
Fatto quando: R8 passa su ogni voce di menu, barra, campi e tasti, con al
più 5 `skip`; `commands.test.ts` passa; i test di `engine.test.ts` sui
menu e sui tasti passano; `wasm/vectors.test.ts` passa col vettore Craft;
`cargo test -p fub-canvas-core --test layout_vectors` passa.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas && npm run typecheck
Stato: [ ] da fare

## T24 · La GUI scrive con le operazioni: gesti, trascinamenti, appunti

Perché: i gesti sono metà della GUI. Finché costruiscono toppe in
TypeScript, la regola sta in due posti (D-11 in `drop-layout.ts`, il gruppo
trascinato, i lati di un arco).
Tocca: `apps/client/src/editors/canvas/engine.ts` (i gesti),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/drop-layout.ts` e `drop-layout.test.ts`
(di N6 T9: resta solo ciò che non è regola),
`apps/client/src/editors/canvas/operation.ts` (solo togliere),
`apps/client/src/editors/canvas/parity.test.ts` (R8 per i gesti),
`docs/reference/canvas-cards.md` (di N6: le misure di nascita e la
griglia sono del nucleo).
Non toccare: i file dell'inventario; il nucleo (le regole ci sono già, da
T2 a T13); `ink/tools/split.ts` di N4 (resta: T18 lo tiene d'accordo con
`cut.rs`); il formato degli appunti di N6 T68.
Dipende da: T23; T18; N6 in main
Cosa fare:
- Trascinare schede: al rilascio una `move {ids, dx, dy}`; un gruppo
  trascinato è `move` con `contents: true` (T10). Mentre si trascina la
  tela mostra le posizioni da sé, come adesso: è vista.
- Ridimensionare: al rilascio `resize {id, width, height}` con le misure
  del gesto.
- Collegare: il filo lasciato sul corpo di una scheda è `connect {from,
  to, sides: "auto"}`; lasciato su un lato, i lati sono quelli.
- File lasciati cadere: la GUI li ordina (`Intl.Collator` numerico), poi
  una lista sola: un `add_card` per file con il suo `id` (dalla
  `newId` delle opzioni, di serie `newNodeId()`) e `content_size` quando
  la misura si sa, poi `layout {ids, kind: "grid", x, y}` nel punto del
  rilascio, poi `group` oltre 12. Il riquadro tratteggiato si calcola una
  volta all'entrata (una `compile` che non scrive) e mentre si trascina si
  sposta di `snap(puntatore) − snap(origine)`: nessuna chiamata al `.wasm`
  per ogni movimento. Di `drop-layout.ts` restano i tipi e la tabella
  Markdown delle celle copiate.
- Incollare: il frammento di N6 T68 è `insert {fragment, x, y}`; un testo
  è `add_card` con la forma breve di T9.
- Inchiostro: dove N4 e N6 scrivono ancora toppe a mano, la fine di un
  tratto passa da `add_strokes`, la gomma da `erase_strokes` o
  `erase_along`, il lazo da `move_strokes`. La codifica dei punti resta di
  N4.
- R8 cresce: la costante `GESTURES` del test dà, per ogni gesto, la
  sequenza di puntatore o di appunti. Il confronto è quello di T23.
Casi limite: un rilascio fuori dalla lavagna (niente); 200 file lasciati
cadere (una lista, un annulla, il gruppo); un file con un nome già in una
scheda (una scheda in più, come adesso); un trascinamento annullato con
Esc (niente scrittura); un frammento incollato con un arco senza
estremo (`insert` lo rifiuta, e la tela lo dice); lo zoom al 25% e al 400%
(le misure del gesto sono in unità della lavagna).
Fatto quando: R8 passa su ogni voce `gesture` e `clipboard` di `merged`;
`drop-layout.test.ts` non prova più misure né griglie (le provano i
vettori del nucleo); `engine.test.ts` passa; `npm run typecheck` passa.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas && npm run typecheck
Stato: [ ] da fare

## T25 · Copia e incolla come codice, «Disponi»

Perché: il codice diventa il modo di passare un pezzo di lavagna fra la
persona e l'assistente: la persona copia, l'assistente cambia, la persona
incolla e vede prima che cosa succede.
Tocca: `crates/fub-canvas-wasm/src/api.rs` e `abi.rs` (due esportazioni:
`canvas_describe`, `canvas_check`), `crates/fub-canvas-wasm/tests/`,
`apps/client/src/editors/canvas/wasm/core.ts` e `core.test.ts`,
`apps/client/src/editors/canvas/chrome/commands.ts` (tre comandi e il
sottomenu), `apps/client/src/editors/canvas/engine.ts` (il menu
contestuale), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`,
`apps/client/src/__fixtures__/canvas-parity/main.json` (le voci nuove),
`apps/client/src/__fixtures__/canvas-parity/board.json` (`layout` esce
da `ops_without_gui`), `docs/reference/canvas-cards.md`.
Non toccare: il nucleo (`describe` e `check` ci sono da T4 e T7); i
comandi di `fub-features`; il kit (si usano `kit/dialog.ts` e il menu che
c'è); le baseline del banco.
Dipende da: T24; D6
Cosa fare:
- `canvas_describe(handle, {form: "code", ids?})` e `canvas_check(handle,
  {ops, seed?})` nel `.wasm`, con gli stessi errori tipizzati delle altre
  esportazioni, e i metodi `describe` e `check` di `CanvasCore`.
- «Copia come codice» (`canvas.copy_code`): la selezione, o tutta la
  lavagna senza selezione, come lista di operazioni negli appunti di testo.
  Non scrive niente.
- «Incolla codice» (`canvas.paste_code`): legge il testo degli appunti,
  `check`. Con problemi mostra il primo, col suggerimento, e non scrive.
  Senza problemi una finestra (`openDialog`) dà il riassunto («3 schede
  nuove, 1 arco, 2 schede spostate») e chiede conferma. Poi compila e
  scrive: un passo di annulla.
- «Disponi» (`canvas.layout.grid`, `.row`, `.column`, `.tree`): `layout`
  sulla selezione, o su tutte le schede fuori dai gruppi.
- Le chiavi nel catalogo, in italiano e in inglese. Le voci in
  `main.json`: «Copia come codice» `view`, «Incolla codice» `code`, le
  quattro di «Disponi» `code`.
- La misura del `.wasm` prima e dopo (la riga `fub-canvas-wasm: … KiB, …
  compressi` della build) va nel report. Se cresce più di 64 KiB
  compressi, il coder si ferma e lo dice.
- Le voci compaiono nel menu che già c'è, con i pezzi del kit. Se una
  scena del banco le mostra, la baseline viene dal runner (skill `banco`),
  mai rigenerata qui.
Casi limite: appunti vuoti o non JSON (il problema di `check`, nessuna
finestra); una lista che crea 10 000 schede (il riassunto, poi un annulla
solo); «Incolla codice» con una lista che nomina una scheda che non c'è
(`unknown_node`, il primo problema); «Copia come codice» su una lavagna con
tratti (le forme di T17); la finestra chiusa con Esc (niente scrittura).
Fatto quando: `cargo test -p fub-canvas-wasm` prova le due esportazioni;
`core.test.ts` prova `describe` e `check` attraverso il `.wasm`;
`engine.test.ts` prova copia, incolla con e senza problemi, conferma e
annulla, e i quattro «Disponi»; R7 e R8 passano con le voci nuove.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-wasm; cd
apps/client && npx vitest run src/editors/canvas && npm run typecheck
Stato: [ ] da fare

## T26 · Chiusura: il conto a zero e le misure del corpus

Perché: il piano è finito quando l'inventario dice zero, o quando ogni
voce che resta è un'eccezione che l'utente ha approvato.
Tocca: `apps/client/src/__fixtures__/canvas-parity/*.json` (solo
`max_missing` e le eccezioni approvate),
`docs/development/canvas-parity.md` («Il corpus»: i numeri),
`docs/map/dove-sta-x.md` (le righe), `docs/README.md` (se un link manca).
Non toccare: `PLAN.md` e `DECISIONS.md` (li chiude l'orchestratore); il
codice (un rosso qui torna al task che l'ha lasciato).
Dipende da: tutti gli altri
Cosa fare:
- `max_missing` è 0 in ogni file. Se una voce resta `by_hand` o
  `missing`, il coder la elenca nel report con il perché, e l'orchestratore
  chiede all'utente se diventa un'eccezione. Nessuna eccezione senza il
  suo sì.
- Il corpus (T3): quanti compiti si risolvono, con quante operazioni e
  quante righe di JSON in media, prima (le forme di main) e dopo. I numeri
  vanno in «Il corpus», con la data.
- `dove-sta-x.md`: le righe per `layout.rs`, `describe.rs`, `spec.rs`,
  `check.rs`, `preview.rs`, i comandi di `lavagna/`, gli strumenti MCP,
  `canvas-code.md`.
- `scripts/check.sh` completo, non `--rapido`. Ogni `SALTA` va nel
  report.
Casi limite: N4 o N6 non ancora in main (le loro voci restano `plan` e
contano: il conto a zero aspetta loro, e il report lo dice).
Fatto quando: `cargo test -p fub-canvas-core --test parity` e
`npx vitest run src/editors/canvas/parity.test.ts` passano con
`max_missing` 0 (o con le eccezioni approvate); `check-doc-links.mjs` e le
altre guardie dei documenti passano; `scripts/check.sh` è verde.
Prova: scripts/check.sh
Stato: [ ] da fare
