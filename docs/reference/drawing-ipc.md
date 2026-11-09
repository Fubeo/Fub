# Le porte del disegno

> **Ambito:** le sei porte IPC con cui il client guida il motore del disegno
> nei disegni `.svg` (profilo «vector»): forme, limiti e chi le usa.
> **Fonti autorevoli:** `crates/fub-abi/src/drawing.rs`,
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

Sei porte tipate, come quelle della griglia (arrivano con T19; i nomi sono da
confermare, D-4):

- `open_drawing` riceve il documento e il suo testo e risponde un
  `DrawingOpen`: l'istanza, la revisione della copia, quanti elementi il motore
  sa modificare e quanti no, e le parti che restano come sono
  (`DrawingLoss`: id o percorso dell'elemento, specie `unmapped`,
  `approximated` o `unsupported`, dettaglio) (arriva con T19);
- `drawing_sync` riceve un `DrawingSync`: la revisione e il cambio, come
  differenza (`edits`, con `length_before` e `length_after`; ogni `DrawingEdit`
  in unità UTF-16 sul testo LF, gli intervalli in ordine e senza
  sovrapporsi, come `TextEdit` del client) o come testo intero (`text`), e
  risponde `DrawingSynced` (arriva con T19);
- `drawing_gesture` riceve un `DrawingGesture` (revisione, fase `preview`,
  `commit` o `cancel`, strumento, livello, selezione, zoom, griglia, stile, la
  riga del testo nuovo per lo strumento `text`, gli eventi nuovi in
  coordinate di scena) e risponde un `DrawingOutcome`: l'anteprima
  (`DrawingPreview`: la forma nuova come `Elem`, la matrice della selezione,
  il riquadro `[x, y, larghezza, altezza]`), il JSON delle operazioni, la
  selezione dopo, le parti toccate che restano come sono, e il rifiuto
  (`stale`, `unmapped`, `empty`, `unsupported`, `too_large`, `closed`,
  `not_ready`, `locked`, `hidden`) (arriva con T19);
- `drawing_commands` riceve la selezione e risponde i `DrawingCommandInfo`
  (id, acceso) (arriva con T19);
- `drawing_command` riceve un `DrawingCommandRequest` (revisione, id,
  selezione, valore) e risponde un `DrawingOutcome`. I comandi sono
  `disegno.colore-tratto` (un colore), `disegno.colore-riempimento` (un colore
  o `null`) e `disegno.spessore` (un numero, zero o più) (arriva con T19);
- `close_drawing` chiude l'istanza (arriva con T19).

Dal lato del client le sei porte sono `openDrawing`, `drawingSync`,
`drawingGesture`, `drawingCommands`, `drawingCommand` e `closeDrawing` di
`host/ipc.ts`, con il vault in coda; le usa soltanto la sessione del motore
(`editors/spatial/motore/sessione.ts`), che tiene la copia allineata alla
`DocumentSession`, manda le richieste in fila con un tempo limite di 10 s e,
a un `stale`, rimanda il testo intero e riprova una volta. Finché l'app non
registra i sei comandi (T19), le porte di `host/ipc.ts` rispondono
`unserved` senza chiamare l'app, come l'host senza il motore: la sessione dà
il motore spento e gli strumenti del disegno fanno da sé.

Ogni richiesta passa da `validate()` prima di arrivare al motore, e un
rifiuto è `BadArgs` col nome del campo. Il testo è al massimo di 20 MiB,
una richiesta di gesto porta al più 100.000 eventi, un esito al più 10.000
operazioni in 8 MiB di JSON (lo controlla chi lo scrive) e 50.000 parti che
restano come sono; una selezione ha al più 10.000 id, nessuno vuoto o
ripetuto; un colore è al più di 64 byte. I numeri sono finiti, `zoom` e il
passo della griglia sono sopra zero, la pressione sta fra 0 e 1, lo spessore
è zero o più. Un gesto senza `revision` o `phase` (come i
[vettori dei gesti](scene-gestures.md)) vale revisione 0 e `commit`.
