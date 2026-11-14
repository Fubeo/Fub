# 0241 — La lavagna si scrive in operazioni con la forma breve

- **Stato:** accolta
- **Data:** 2026-11-14
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Una lavagna si cambia con una lista di operazioni d'intento (`canvas.apply`,
`CanvasOp` in `fub-canvas-core`): la lista si applica per intero o per niente.
Su main ogni operazione chiede ciò che la GUI decide da sé: per aggiungere una
scheda serve la sua posizione, le sue misure e il suo id; per collegare due
schede servono i lati e le punte. Un modello che scrive la lavagna deve
calcolare questi numeri, e il piano di inventario della parità conta quanti
gesti della GUI restano così: al 2026-11-05 erano 36 delle 72 azioni, su main,
N4 e N6.

Il vincolo è la parità: ciò che la GUI fa con il mouse deve poter stare in
codice, con le stesse regole, senza una seconda copia delle regole nella shell.
Il formato su disco non cambia (`.canvas` resta JSON Canvas 1.0), e le porte
IPC non crescono: la forma passa dai comandi che esistono già.

## Decisione

La lavagna in codice è la lista di `CanvasOp` che `canvas.apply` accetta già.
Le operazioni `add_card` e `connect` hanno una **forma breve** accanto a quella
intera, e i campi che mancano li calcola il nucleo, con le sue regole:

- `add_card` accetta o `node` (la scheda come nel file), o la forma breve:
  il tipo viene da `text`, `file`, `url` o `label` (`type` se serve); il posto
  da `x` e `y` insieme, da `near` con `side` e `gap`, o dalla lista automatica;
  le misure da `width` e `height`, altrimenti quelle di nascita; il colore da
  una tavola di nomi, da `"1"`…`"6"` o da `#rrggbb`.
- `connect` accetta o `edge`, o `from` e `to` con `sides` (`"auto"` o
  `{from, to}`) ed `ends` (`arrow` di serie, `none`, `both`).
- Le due forme non si mescolano nella stessa operazione. Un campo che non va
  col tipo, o un posto dato in due modi, è `Invalid`: il nucleo non sceglie
  quale vince.
- Le regole di nascita, di posto e di lato sono quelle di `layout.rs`
  (`born_size`, `place_near`, `auto_place`, `nearest_sides`): le usano le forme
  brevi e la lettura, e le altre operazioni (`layout`, `group`, `duplicate`) le
  useranno. Nessuna copia nella shell.
- `describe::code` scrive la forma breve dove ogni campo ci sta, e la forma
  intera dove non ci sta (un campo sconosciuto, un colore che la tavola non
  scrive, un gruppo senza etichetta). Compilato su una lavagna vuota, dà la
  stessa lavagna.

Restano obbligatori: la lista è JSON, niente script; un solo proprietario
(`fub-canvas-core`), letto da GUI, comandi, server MCP e CLI; ogni numero che
il nucleo calcola è deterministico, senza orologio e senza caso.

## Conseguenze

### Positive

- Un modello scrive una scheda con il testo e il posto, e una freccia con i due
  nomi: il resto lo decide la stessa regola della GUI.
- La forma intera non cambia: ogni lista scritta prima ha lo stesso esito. Si
  aggiunge e basta.
- Il giro `code` → compila resta la prova che la lettura non perde nulla.

### Negative

- Due forme per la stessa operazione. Chi scrive una lista deve sapere che le
  due non si mescolano, e la guida (`canvas.guide`) lo dice.
- La stima del testo è fissa: l'altezza di nascita di un testo non è quella
  del font vero. È la scelta del piano («Misure e posti»), per avere lo stesso
  numero in Rust, in WebAssembly e da riga di comando.
- Con una misura scritta a mano, una scheda a sinistra o sopra `near` tocca
  `near` ancora a `gap`, ma lo scivolamento per evitare un posto preso usa la
  misura di nascita: una scheda può sfiorare un'altra, e `check` lo segnala con
  `overlap`.

## Alternative scartate

### Solo JSON Canvas grezzo

Resta possibile (`node`, `edge`, `set`), ma chi scrive deve calcolare ogni
posto, misura, lato e id: è il costo che il piano voleva togliere.

### Uno scheletro con default, scritto a parte

Un formato separato, con default propri, avrebbe una seconda copia delle
regole. Le forme brevi stanno invece nelle stesse operazioni, con gli stessi
campi e la stessa validazione.

### Un linguaggio di testo (DSL)

Un secondo linguaggio da imparare, validare e tenere allineato al JSON. Un
modello sa scrivere JSON, e `canvas.check` dà già gli errori con la correzione.

### Uno script TypeScript o JavaScript nel nucleo

Un motore da eseguire dentro il nucleo, con la sicurezza, il determinismo e i
limiti di tempo che costano. Non serve: le operazioni d'intento bastano.

### `#[serde(flatten)]` per i campi della forma breve

Con `deny_unknown_fields` serde non regge `flatten`: i campi sono espliciti nella
struttura dell'operazione, e la validazione (`spec`) li elenca uno per uno.

## Verifica

- `crates/fub-canvas-core/tests/op_vectors.rs` e i vettori di
  `apps/client/src/__fixtures__/canvas-ops/` (le forme `add-card-*` e
  `connect-*`): esito, posto, misure, colore, id e inversa delle toppe. Gli
  stessi vettori girano nella build WebAssembly (`wasm/vectors.test.ts`).
- `crates/fub-canvas-core/tests/spec.rs`: `validate` dà un problema se e solo
  se serde non legge la lista, sui vettori e sul corpus.
- `crates/fub-canvas-core/tests/short_forms.rs` e i test di `describe.rs`: il
  limite del testo, la misura scritta a mano accanto a `near`, la correzione
  dei nomi sbagliati, il `null` come assente, e il giro di `code`.
- `crates/fub-canvas-core/tests/parity.rs` (il cricchetto R4) e
  `tests/task_corpus.rs` (il cricchetto di `needs`): una voce o un compito che
  compila con la forma breve non può restare in «da fare».
