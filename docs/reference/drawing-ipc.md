# Le porte del disegno

> **Ambito:** le sei porte IPC con cui il client guida il motore del disegno
> nei disegni `.svg` (profilo «vector»): forme, limiti e chi le usa.
> **Fonti autorevoli:** `crates/fub-abi/src/drawing.rs`,
> `crates/fub-host/src/drawing.rs`, `crates/fub-app/src/lib.rs`,
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
  il riquadro `[x, y, larghezza, altezza]`), il JSON delle operazioni, la
  selezione dopo, le parti toccate che restano come sono, il rifiuto
  (`stale`, `unmapped`, `empty`, `unsupported`, `too_large`, `closed`,
  `not_ready`, `locked`, `hidden`) e la cornice da tenere;
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
  (id, acceso);
- `drawing_command` riceve un `DrawingCommandRequest` (revisione, id,
  selezione, valore) e risponde un `DrawingOutcome`. I comandi sono
  `disegno.colore-tratto` (un colore), `disegno.colore-riempimento` (un colore
  o `null`) e `disegno.spessore` (un numero, zero o più);
- `close_drawing` chiude l'istanza.

Dal lato del client le sei porte sono `openDrawing`, `drawingSync`,
`drawingGesture`, `drawingCommands`, `drawingCommand` e `closeDrawing` di
`host/ipc.ts`, con il vault in coda; le usa soltanto la sessione del motore
(`editors/spatial/motore/sessione.ts`), che tiene la copia allineata alla
`DocumentSession`, manda le richieste in fila con un tempo limite di 10 s e,
a un `stale`, rimanda il testo intero e riprova una volta. `unserved` vuol
dire che il motore non c'è in questa build (l'host senza la feature
`engine-drawing`): la sessione dà il motore spento e gli strumenti del disegno
fanno da sé. Un motore che non si costruisce è `internal`, col motivo nel log,
e un nuovo tentativo lo ricostruisce. Le istanze sono per vault: la chiusura
del vault chiude le sue, e un'istanza che il vault non ha è `not_found`, come
un'istanza della griglia.

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
