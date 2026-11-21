# Le porte del disegno

> **Ambito:** le sei porte IPC con cui il client guida il motore del disegno
> nei disegni `.svg` (profilo «vector»): forme, limiti e chi le usa.
> **Fonti autorevoli:** `crates/fub-abi/src/drawing.rs`,
> `crates/fub-host/src/drawing.rs`, `crates/fub-app/src/lib.rs`,
> `crates/fub-disegno/src/gesti/strumento.rs`,
> `apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`,
> `apps/client/src/editors/spatial/motore/sessione.ts`.

Il resto del confine IPC è nel [contratto IPC](ipc-contract.md); chi
possiede che cosa nel disegno è nel [disegno sul motore](../architecture/disegno.md).

Nei disegni (`.svg`, profilo «vector») gli strumenti Selezione, forme e Testo
passano dal motore del disegno, che gira nell'host. Il client resta lo
scrittore del file: il motore tiene una copia del disegno, ci fa girare i
suoi strumenti e risponde con le [operazioni di scena](scene-operations.md)
che il client applica in un passo di annullamento. I tipi sono quelli di
`fub_abi::drawing`, rispecchiati in `host/contract.ts`; le revisioni sono
`u64` e viaggiano come stringhe (in lettura si accetta anche il numero).

Sei porte tipate, come quelle della griglia, registrate dall'app
(`crates/fub-app/src/lib.rs`) e servite dall'host (`crates/fub-host/src/drawing.rs`):

- `open_drawing` riceve il documento e il suo testo e risponde un
  `DrawingOpen`: l'istanza, la revisione della copia, quanti elementi il motore
  sa modificare e quanti no, e le parti che restano come sono
  (`DrawingLoss`: id o percorso dell'elemento, specie `unmapped`,
  `approximated` o `unsupported`, dettaglio);
- `drawing_sync` riceve un `DrawingSync`: la revisione e il cambio, come
  differenza (`edits`, con `length_before` e `length_after`; ogni `DrawingEdit`
  in unità UTF-16 sul testo LF, gli intervalli in ordine e senza
  sovrapporsi, come `TextEdit` del client) o come testo intero (`text`), e
  risponde `DrawingSynced`;
- `drawing_gesture` riceve un `DrawingGesture` (revisione, fase `preview`,
  `commit` o `cancel`, strumento, livello, selezione, zoom, griglia, stile, la
  riga del testo nuovo per lo strumento `text`, la cornice tenuta, gli eventi
  nuovi in coordinate di scena) e risponde un `DrawingOutcome`: l'anteprima
  (`DrawingPreview`: la forma nuova come `Elem`, la matrice della selezione,
  il riquadro `[x, y, larghezza, altezza]`, i segni di uno strumento del
  motore), il JSON delle operazioni, la selezione dopo, le parti toccate che
  restano come sono, il rifiuto (`stale`, `unmapped`, `empty`, `unsupported`,
  `too_large`, `closed`, `not_ready`, `locked`, `hidden`, `no_memory`,
  `no_preview`, `unknown_tool`), la cornice da tenere, lo stato dello
  strumento del motore e la lettura di un comando (vedi
  [gli strumenti del motore](#gli-strumenti-del-motore));
- la **cornice tenuta** (`frame`, un `DrawingFrame` o `null`, in
  `DrawingGesture` e in `DrawingOutcome`) è la cornice di trasformazione che
  il client tiene per più oggetti scelti dopo averli girati o ridimensionati
  (`ctx.kept`): la matrice dalle sue coordinate alla scena `[a, b, c, d, e,
  f]`, il riquadro col contorno `bounds` e quello della geometria `geometry`,
  `[x0, y0, x1, y1]` nelle sue coordinate. I riquadri viaggiano con la
  matrice perché sono quelli di quando la cornice è nata: rifatti dagli
  oggetti, con le `transform` scritte a quattro decimali, darebbero una
  misura appena diversa da quella del client. La Selezione la manda se la
  tiene per la selezione di adesso; il motore la usa se la selezione è
  ancora quella (con un oggetto solo vale la sua cornice) e rimanda quella
  di dopo: trasformata dal gesto per più oggetti girati o ridimensionati,
  spostata con loro se era tenuta, `null` altrimenti, e il client tiene ciò
  che arriva. Il campo può mancare (vale `null`);
- `drawing_commands` riceve la selezione e risponde i `DrawingCommandInfo`
  (id, acceso, e perché è spento);
- `drawing_command` riceve un `DrawingCommandRequest` (revisione, id,
  selezione, valore, anteprima) e risponde un `DrawingOutcome`. I comandi sono
  `disegno.colore-tratto` (un colore), `disegno.colore-riempimento` (un colore
  o `null`), `disegno.spessore` (un numero, zero o più),
  `disegno.strumento.opzione` e `disegno.famiglia.prepara`;
- `close_drawing` chiude l'istanza.

Dal lato del client le sei porte sono `openDrawing`, `drawingSync`,
`drawingGesture`, `drawingCommands`, `drawingCommand` e `closeDrawing` di
`host/ipc.ts`, con il vault in coda; le usa soltanto la sessione del motore
(`editors/spatial/motore/sessione.ts`), che tiene la copia allineata alla
`DocumentSession`, manda le richieste in fila con un tempo limite di 10 s e,
a un `stale`, rimanda il testo intero e riprova una volta.

Gli errori escono dalle sei porte nella lingua della shell, `{kind,
message}` con `message` già una frase (`drawing_port` di
`crates/fub-app/src/lib.rs`, che li passa da `for_the_shell`): l'host dice il
motore spento con una chiave del suo catalogo, e il client riconosce un
errore del contratto solo da un messaggio stringa (`asPluginError` di
`host/errors.ts`). Gli errori che il client legge come «il motore manca»:

- `unserved` **all'apertura**: il motore è spento in questo vault (la riga
  `fub.motore-vettoriale` della pagina Componenti, o i disegni spenti con
  `fub.draw` in `plugins.disabled`) e l'host non costruisce niente; oppure il
  motore non c'è in questa build (l'host senza la feature `engine-drawing`).
  La sessione dà il motore spento e gli strumenti del disegno fanno da sé.
- `unserved` **a metà sessione**: il motore si è spento nel vault
  (`apply_components`, dall'app, dalla CLI o dall'MCP) e l'host ha chiuso le
  istanze del vault, dopo il gesto in corso. Se non resta nessuna istanza in
  nessun vault, il motore si libera e la memoria torna al sistema. Riacceso,
  l'host non riapre niente: riapre il client, con un'istanza nuova.
- `internal`: il motore non si costruisce o si è fermato a metà di una
  chiamata, col motivo nel log; si può riprovare, e un nuovo tentativo lo
  ricostruisce.

Le istanze sono per vault: la chiusura del vault chiude le sue, e un'istanza
che il vault non ha (chiusa, o mai aperta) è `not_found`, come un'istanza
della griglia; con il motore spento nel vault è `unserved`.

Ogni richiesta passa da `validate()` prima di arrivare al motore, e un
rifiuto è `BadArgs` col nome del campo. Il testo è al massimo di 20 MiB,
una richiesta di gesto porta al più 100.000 eventi, un esito al più 10.000
operazioni in 8 MiB di JSON (lo controlla chi lo scrive) e 50.000 parti che
restano come sono; una selezione ha al più 10.000 id, nessuno vuoto o
ripetuto; un colore è al più di 64 byte. I numeri sono finiti, `zoom` e il
passo della griglia sono sopra zero, la pressione sta fra 0 e 1, lo spessore
è zero o più. La matrice di una cornice ha un'inversa finita e i suoi
riquadri non finiscono prima di cominciare. Un gesto senza `revision` o `phase` (come i
[vettori dei gesti](scene-gestures.md)) vale revisione 0 e `commit`.

## Gli strumenti del motore

Oltre ai sei strumenti di K5 (`select`, `rect`, `ellipse`, `line`, `arrow`,
`text`), un gesto può guidare uno strumento del motore per id. Il ponte
(`gesti/strumento.rs` di `fub-disegno`) tiene lo strumento attivo per istanza:
gli passa i puntatori, poi i tasti, il testo e l'IME della stessa richiesta,
e fa passare ciò che cambia per la differenza di K5. Un gesto è un passo
della cronologia, anche un tracciato della penna fatto di più clic; un gesto
annullato (`cancel`) non lascia operazioni. Uno strumento cambiato a metà
gesto annulla prima il gesto vecchio. La carta (`fub:role="paper"`) è
bloccata per gli strumenti del motore come un `fub:locked`. Ogni campo nuovo
può mancare, e vale vuoto, `null` o `false`: le richieste e gli esiti di K5 si
leggono come prima.

- **Lo strumento** è `{"engine": {"id": "pen"}}`: l'id ha da 1 a 64 byte di
  lettere e cifre ASCII, `_` o `-` (`BadArgs` sul campo `tool.engine.id`); un
  id che il motore non ha è il rifiuto `unknown_tool`.
- **Gli ingressi** (`DrawingGesture.inputs`, solo con uno strumento del
  motore, al più 10.000):

  ```json
  [{"kind": "key", "key": "Enter", "code": "Enter",
    "mods": {"shift": false, "alt": false, "cmd": false, "ctrl": false}, "pressed": true},
   {"kind": "text", "text": "Ciao"},
   {"kind": "ime", "preedit": "かな", "active": [0, 2]}]
  ```

  `key` e `code` sono quelli di `KeyboardEvent`, al più 64 byte; un `preedit`
  vuoto chiude la composizione. `active` è `[da, a)` in **caratteri Unicode**
  di `preedit`, come li conta il motore: il client converte dagli indici
  UTF-16 di JavaScript.
- **I segni** (`DrawingPreview.overlays`, al più 10.000, in coordinate di
  scena, nell'ordine in cui si disegnano; `width` e `size` in pixel dello
  schermo):

  ```json
  [{"kind": "marquee", "rect": [10, 10, 50, 30]},
   {"kind": "path", "d": "M10 10 L60 40", "role": "preview", "width": 1, "dashed": false},
   {"kind": "anchor", "at": [60, 40], "role": "selection", "filled": true, "size": 7}]
  ```

  Le specie sono dodici, una per ogni segno del motore: `marquee`, `path`,
  `line`, `anchor`, `curve_point`, `handle`, `label`, `measure`, `distance`,
  `highlight`, `swatch` (un colore vero, `#rrggbbaa`) e `grid_line`. Il ruolo
  (`selection`, `guide`, `preview`, `measure`, `perspective`) viene dal colore
  che il motore dà al segno, e il client lo colora coi suoi token; un colore
  che il ponte non conosce è `preview`. I testi di `label`, `measure` e
  `distance` sono quelli del motore, al più 1024 byte; `d` al più 1 MiB.
- **Lo stato** (`DrawingOutcome.state`, `null` per gli strumenti di K5 e per
  i comandi):

  ```json
  {"busy": true, "transforming": false, "wants_text": false,
   "composing": false, "cursor": "pen_close", "options": null}
  ```

  `busy` dice un'interazione in corso (anche un tracciato aperto fra due
  clic), `wants_text` che le scorciatoie a un tasto non partono, `composing`
  che un IME compone e tasti, scorciatoie e annulla aspettano. `cursor` è il
  nome del cursore del motore in `snake_case`: uno che il client non conosce
  è la freccia. `options` sono le opzioni dello strumento.
- **La lettura** (`DrawingOutcome.reading`) è il JSON di un comando che legge
  e non cambia niente, per i pannelli; `null` per gli altri.
- **Perché un comando è spento** (`DrawingCommandInfo.disabled_reason`,
  `null` se è acceso): `no_selection`, `needs_path`, `needs_text`,
  `needs_group`, `needs_two`, `read_only`, `unmapped`, oppure
  `{"other": {"text": "…"}}` col testo del motore. Il client lo dice coi suoi
  testi.
- **L'anteprima di un comando** (`DrawingCommandRequest.preview: true`): il
  comando gira su una copia e le operazioni non entrano nella cronologia; un
  comando che non ne sa dare risponde `no_preview`.
- **L'opzione di uno strumento**, `disegno.strumento.opzione`:

  ```json
  {"strumento": "pen", "chiave": "rubber_band", "valore": true}
  ```

  `chiave` ha da 1 a 64 byte, `valore` è qualsiasi JSON e nessun altro campo
  è ammesso. L'opzione resta allo strumento, che diventa quello attivo (un
  gesto di un altro strumento in corso si annulla); l'esito non ha operazioni
  e porta lo `state` con le opzioni nuove. Senza anteprima: con `preview` è
  `no_preview`.
- **La famiglia**, `disegno.famiglia.prepara`, è `{"famiglia": "testo"}` con
  una delle 26 famiglie della mappa del motore (`DRAWING_FAMILIES`). La
  famiglia nasce in un lavoro in sottofondo e la risposta arriva subito:
  una lettura `{"famiglia": "testo", "stato": "pronta" | "in-corso"}`, o il
  rifiuto `no_memory`; una preparazione fallita lo dice una volta, come
  `Internal`. Senza anteprima: con `preview` è `no_preview`.
- **Gli altri comandi del motore**, `disegno.<id del motore>`: le righe
  «fatto» della mappa, che `drawing_commands` elenca dopo i tre di K5. Rende
  le operazioni se il documento cambia, la `reading` se il comando legge
  soltanto; argomenti che il motore rifiuta sono `BadArgs`, una riga «da
  fare» è `Unserved`, un id che il motore non serve qui `unsupported`. Con
  il Disegno completo spento nel vault, o senza la feature
  `drawing-complete`, ogni comando tranne i tre di K5 è `Unserved`.

Dal lato del client gli strumenti del motore li usa per ora soltanto l'host
finto (`host/fake.ts`): senza risposte del banco, uno strumento del motore
rende un `marquee` e un `anchor` in anteprima (`strumentoFinto`).
