# 0199 — History nativa CodeMirror e gate conservativo sugli overlap

- **Stato:** accolta
- **Data:** 2026-08-27
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

[0190](0190-sessioni-documento-e-undo.md) stabilisce che il buffer è condiviso
fra le superfici, mentre cursore, selezione e undo appartengono a ciascun
riquadro. Non stabilisce quale componente debba possedere la meccanica della
history. La history nativa di CodeMirror offre già raggruppamento, composizione,
inversione, rami undo/redo, history della selezione, keymap e `beforeinput`.
Duplicare queste responsabilità nella shell crea due semantiche da mantenere
allineate.

La sola history nativa non basta però a decidere se l'inverso di una modifica
locale può ancora essere applicato dopo un cambio esterno. Il controesempio
minimo è `abc→local→external; native undo=>externalabc`: l'undo nativo può
resuscitare una parte del contenuto precedente invece di riconoscere che la
sostituzione esterna è ambigua.

## Decisione

`TextEngine` possiede una `history()` nativa in un `historyCompartment`, con
`minDepth: 100` e `newGroupDelay: 500`, e monta il `historyKeymap` completo. Le
API native possiedono stack, raggruppamento, composizione, inversione, mapping
dei rami e history della selezione. `undo()` e `redo()` dell'engine sono soltanto
adapter dei comandi pubblici; non leggono `historyField`, JSON o altre strutture
private.

Ogni sincronizzazione costruisce la transazione effettiva dopo i filtri del
profilo e usa insieme `Transaction.addToHistory.of(false)` e
`Transaction.remote.of(true)`. Il cambio esterno viene quindi applicato e
mappato sui rami senza diventare un evento della history locale. Il seam
`TextOperation` resta invece il tipo interno che valida preimmagine, dimensioni
e testo obiettivo contro il `Buffer` autorevole.

La shell conserva una sola metadata di sicurezza, `HistoryFootprints`. Essa
trattiene al massimo 512 intervalli non vuoti e anchor di cancellazione in
coordinate UTF-16; non trattiene testo, inversi, frame o un'altra pila. La
metadata viene mappata con le API pubbliche `ChangeDesc`; il cambio esterno
viene confrontato con la metadata prima del dispatch.

Per un intervallo locale `[a,b)` e un intervallo esterno non vuoto `[x,y)` c'è
overlap quando `a < y && x < b`. Un'inserzione esterna coincide con l'overlap
soltanto se cade strettamente dentro l'intervallo; i due bordi restano fratelli.
Un anchor di cancellazione è invece protetto da un'inserzione nella stessa
posizione e da un cambio non vuoto che lo tocca, inclusi i bordi. Overflow,
coordinate non valide o errore di mapping rendono la metadata sconosciuta e
attivano la stessa protezione conservativa.

In caso di overlap o metadata sconosciuta, `TextEngine` rimuove la history con
`historyCompartment.reconfigure([])` e, in una transazione pubblica distinta,
reinserisce la `history()` nativa. Ricostruisce la transazione di sync contro lo
stato risultante e la applica soltanto dopo il reset. Questo scarta entrambi i
rami nativi, compresa la history della selezione, prima di mostrare il cambio
esterno; se una delle due fasi fallisce, il sync viene interrotto. Un reset
conservativo può quindi perdere undo/redo non correlati, ma non può permettere a
un inverso stantio di ripristinare testo sovrascritto.

La sola lettura blocca undo e redo del contenuto secondo la policy nativa senza
cancellare i rami; tornando in scrittura, la history è ancora disponibile. I
comandi separati della history della selezione mantengono la propria semantica.
Non viene introdotto un limite custom sui byte dei payload della history nativa.

## Conseguenze

### Positive

- [0190](0190-sessioni-documento-e-undo.md) mantiene la distinzione fra buffer
  condiviso e history per superficie senza una seconda macchina di stack;
- raggruppamento, composizione, selezione, keymap e `beforeinput` seguono una
  sola implementazione nativa;
- il gate impedisce la resurrezione dopo una sostituzione esterna ambigua;
- `TextOperation` resta un seam tipizzato interno e il `Buffer` conserva la
  propria autorità.

### Negative

- un falso positivo nell'overlap scarta entrambi i rami della superficie,
  inclusa la history della selezione;
- il limite di 512 record riguarda soltanto la metadata di sicurezza, mentre la
  history nativa non espone un cap pubblico sui byte del payload;
- la semantica dipende dalle API pubbliche della versione CodeMirror adottata e
  il reset richiede due transazioni sincrone.

## Alternative scartate

### Pila custom completa `LocalHistory`

Era plausibile perché poteva rappresentare preimmagini e conflitti nello stesso
posto. È scartata perché replica inversione, raggruppamento, mapping, rami,
selezione e lifecycle già posseduti da CodeMirror, oltre a non fornire da sola
la parità con `beforeinput` e il keymap completo.

### Solo history nativa

È scartata dal controesempio del contesto. `addToHistory: false` preserva il
ramo durante un cambio esterno disgiunto, ma le API native pubbliche non
espongono la decisione di conflitto necessaria per una sostituzione ambigua.

### Internals o JSON privato della history

Leggere `historyField`, `HistoryState` o la serializzazione interna potrebbe
sembrare un modo per recuperare i frame, ma vincolerebbe la shell a dettagli
non contrattuali e replicherebbe i payload. Il reset pubblico a due fasi e la
metadata bounded evitano quel vincolo.

## Verifica

La decisione è osservabile tramite il comportamento, non tramite snapshot di
cronologia o conteggi interni. `engine.test.ts` esercita la history nativa
montata, il raggruppamento, la composizione, le selezioni, il keymap completo,
`beforeinput`, il sync fra superfici, la modalità di sola lettura e il reset su
overlap. `history-footprints.test.ts` verifica bordi, anchor, mapping,
incertezza e limite bounded. `text-operation.test.ts` verifica preimmagine,
dimensioni, conversione e fallback del seam tipizzato.

La sequenza a due superfici prova che un cambio esterno disgiunto non entra nei
rami locali e che undo/redo restano indipendenti. Il controesempio
`abc→local→external` prova invece che l'overlap azzera entrambi i rami e lascia
visibile il testo esterno. I guard del confine CodeMirror, dei link documentali
e dello stile verificano che i nomi e i path correnti restino coerenti.
