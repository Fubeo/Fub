# Il disegno completo

> **Domanda:** come lo spazio di lavoro Completo raggiunge ogni funzione del
> motore vettoriale, che cosa vuol dire parità, che cosa arriva tardi e chi
> possiede che cosa?
> **Fonti autorevoli:** `crates/fub-disegno/`, `crates/fub-motori/`,
> `crates/fub-host/src/drawing.rs`, `apps/client/vite.config.ts`.
> **Decisioni:** [ADR 0250](../decisions/0250-il-disegno-completo-sul-motore.md),
> [ADR 0239](../decisions/0239-il-disegno-sul-motore-vettoriale.md),
> [ADR 0248](../decisions/0248-il-disegno-nella-nota-si-modifica-sul-posto.md).

Il disegno completo è lo spazio Completo dei disegni (`.svg`) quando passa
tutto dal motore: strumenti, comandi, effetti e pannelli, con l'interfaccia
di Fub. Si appoggia al giro di [Il disegno sul motore](disegno.md): il
motore calcola su una copia, il client scrive il file.

Il disegno completo arriva a pezzi. Ciò che non c'è ancora porta accanto
«(arriva con T…)», il task del piano che lo porta, e quel task toglie la
nota quando lo fonde. Un percorso di un file che non esiste ancora è scritto
in codice, senza link.

## Che cosa vuol dire parità

La parità è con il motore alla revisione fissa `cfb30d81` di
`vendor/vectorcraft/`. Il suo contratto è la mappa,
`crates/fub-disegno/mappa.tsv` (arriva con T2): una riga per ogni strumento,
comando, voce dell'interfaccia, effetto e pannello del motore, con la sua
`famiglia`, il suo `posto` in Fub e il suo stato.

| Stato | Vuol dire | Lo prova |
|---|---|---|
| fatto | si raggiunge dal suo posto (menu, colonna, ispettore, finestra, banda o tasto), fa sul disegno ciò che fa nel motore e si annulla con un passo | il suo caso in `crates/fub-disegno/tests/famiglie/` (arriva con T5) |
| fub | la serve una funzione di Fub (Salva, le schede, le Impostazioni, i recenti), scritta nella colonna `fub` | la funzione di Fub |
| escluso | non entra, con il suo perché nella riga | la guardia della mappa |
| da fare | non è ancora fatto | la guardia lo conta |

La guardia `.github/scripts/check-disegno-mappa.mjs` (arriva con T2)
confronta le righe con quelle estratte dal motore: una funzione nuova senza
riga, o una riga che sparisce, la fa cadere. Con `--finale` vuole anche che
nessuna riga resti da fare.

Un motore più nuovo arriva con l'aggiornamento dei motori: la mappa si
rigenera, e le sue righe nuove nascono da fare.

## Il percorso di un comando

Un comando del motore, per esempio «Sposta…» o «Ombra esterna…», passa da
questi pezzi:

1. **La voce.** Il menu ≡, Ctrl+/, la fila delle opzioni o una sezione
   dell'ispettore mostrano la voce dall'indice,
   `apps/client/src/editors/spatial/completo/indice.generated.json`
   (arriva con T5), generato dal Rust: etichetta, posto, tasto e famiglia.
   Nel client non c'è un elenco scritto a mano.
2. **Il pezzo del client.** `completo/carica.ts` (arriva con T5) importa con
   `import()` il chunk `drawing-fam-<id>` della famiglia, se non c'è già. Un
   comando con parametri apre la sua finestra del kit, con l'anteprima
   (arriva con T6).
3. **L'IPC.** Il client chiama `drawing_command` con l'id
   `disegno.<id del motore>` (le forme in `crates/fub-abi/src/drawing.rs`,
   [le porte del disegno](../reference/drawing-ipc.md)). Con `preview` il
   comando gira su una copia e non entra nella cronologia (arriva con T4).
4. **La famiglia.** In `fub-disegno` il comando trova la sua famiglia
   (`crates/fub-disegno/src/famiglie/`, arriva con T3), che nasce al primo
   uso, poi il motore lo esegue sulla copia.
5. **La differenza.** Il motore confronta la copia prima e dopo
   (`crates/fub-disegno/src/differenza.rs`) e rende le operazioni di scena.
   Ciò che l'SVG non sa dire va nella ricetta in `<metadata>` (arriva con
   T27).
6. **Il file.** Il client applica le operazioni con `ctx.commit`, in un solo
   passo di annullamento, e la `DocumentSession` le porta al file come ogni
   altra modifica.

Un comando di sola lettura (un pannello che mostra dati) rende una lettura
invece delle operazioni (arriva con T4). Una famiglia che non trova memoria
nel `Budget` rifiuta il comando con `NoMemory` (arriva con T4), e il disegno
resta com'era.

## Il percorso di uno strumento del motore

I sei strumenti della 0239 hanno ognuno il suo gesto in
`crates/fub-disegno/src/gesti/`. Gli altri strumenti del motore passano da
un ponte solo (arriva con T4):

1. il client apre un gesto con `DrawingTool::Engine { id }`, dove `id` è
   l'id dello strumento nel motore; un id che il motore non ha è rifiutato
   con `UnknownTool`;
2. `drawing_gesture` porta i puntatori, come per gli strumenti della 0239,
   e in un campo accanto i tasti, il testo scritto e la composizione dell'IME;
3. il ponte, `crates/fub-disegno/src/gesti/strumento.rs`, tiene lo strumento
   attivo per sessione e gli passa gli eventi; le azioni che lo strumento
   rende passano per la differenza;
4. l'anteprima rende le sovrapposizioni dello strumento (punti, maniglie,
   misure, guide), colorate dal client con i suoi token, e lo stato dello
   strumento (il cursore, le opzioni, se aspetta testo); il client ne chiede
   al più una per fotogramma;
5. il rilascio fa un passo della cronologia di Fub; Esc o la perdita del
   fuoco annullano lo strumento e non lasciano operazioni.

## Chi possiede che cosa

| Che cosa | Chi lo possiede | Perché |
|---|---|---|
| la mappa | `crates/fub-disegno/mappa.tsv` e la sua guardia (arriva con T2) | è il contratto della parità; una riga cambia stato solo con la sua prova |
| l'indice | `fub-disegno`, che lo genera nel client come un mirror (arriva con T5) | il client non nomina il motore e non ha un elenco scritto a mano |
| le famiglie | nel processo `fub-disegno` (arriva con T3), nel client i chunk `drawing-fam-<id>` (arriva con T5) | sono le unità pigre; una famiglia non importa un'altra |
| il `Budget` | lo strato dei motori, `crates/fub-motori/src/memoria.rs` | libera le cache delle famiglie quando serve ([Lo strato dei motori](motori.md)) |
| le librerie dell'utente | il kernel, in `.fub/plugins/fub.draw/librerie/` del vault (arriva con T30) | il motore non tocca il disco; le librerie viaggiano con il vault |
| il disco | il kernel; il motore lo ha negato per tutto il processo (arriva con T28) | ogni byte del motore passa da Fub |
| il file `.svg` e la cronologia | il client, come nella 0239 | il motore rende operazioni e non usa la sua cronologia |

## La mappa delle funzioni e la mappa degli id

In `fub-disegno` ci sono due mappe che non si toccano:

- `crates/fub-disegno/mappa.tsv` (arriva con T2) è un file di dati: le
  funzioni del motore, la loro famiglia e il loro posto in Fub. Cambia
  quando cambia il motore o quando una riga diventa fatta;
- `crates/fub-disegno/src/mappa.rs` è codice: lega ogni oggetto della copia
  del motore all'id del suo elemento nel file, per ogni disegno aperto (vedi
  [la copia e la differenza](disegno.md#la-copia-e-la-differenza)).

## Che cosa arriva tardi

Nel client, la regola `NOT_AT_STARTUP` di `apps/client/vite.config.ts` fa
cadere `npm run build` se un chunk `drawing-*` o un modulo di
`editors/spatial/` entra nel grafo statico di una pagina. Le regole del
Completo si aggiungono lì (arriva con T5): fuori da
`editors/spatial/completo/` si importa solo `completo/index.ts`, e solo con
`import()`; l'indice e le famiglie arrivano da lì, e una famiglia non ne
importa un'altra. All'avvio e nel Semplice non arriva niente del Completo;
passando al Completo arrivano la sua cornice, l'indice e il nucleo; ogni
altra famiglia al suo primo uso.

Nel processo il codice del Completo è compilato, e pigro è lo stato: il
motore nasce al primo disegno aperto (o con `warm_engine`), una famiglia al
suo primo uso o quando uno spazio di lavoro la prepara, e mai con il suo
componente spento. Lo stato di una famiglia sta in un `Pigro` dello strato
dei motori, e le sue cache nel `Budget`, che le libera (arriva con T3).

## Le due strade

Il componente «Disegno completo» (arriva con T3) richiede il «Motore del
disegno» e si spegne con lui. Con il componente spento il Completo è quello
nativo, scritto in TypeScript, e il file si apre e si salva come prima. Con
il motore spento valgono gli strumenti semplici, come dice
[quando il motore manca](disegno.md#quando-il-motore-manca).

Un disegno incorporato in una nota resta quello della
[0248](../decisions/0248-il-disegno-nella-nota-si-modifica-sul-posto.md): la
superficie compatta sta nel Semplice e non carica niente del Completo; «A
tutta pagina» apre il Completo.

Per il giro di un gesto, la copia e i comandi IPC vedi
[Il disegno sul motore](disegno.md); per il motore pigro, il `Budget` e i
caratteri [Lo strato dei motori](motori.md).
