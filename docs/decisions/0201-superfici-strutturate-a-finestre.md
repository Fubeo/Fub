# 0201 — Le superfici strutturate usano sessioni, finestre e patch coordinate

- **Stato:** accolta
- **Data:** 2026-09-15
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La vertical slice `.fubsheet` ha reso misurabile il primo confine strutturato.
Il comando provvisorio `evaluate_sheet` invia l'intera sorgente a ogni commit e
restituisce tutte le celle persistite e tutte le dipendenze dirette, anche se la
shell ne mostra soltanto una finestra.

La misura in build release sullo stesso valutatore Rust ha prodotto:

| Workbook | Sorgente | Risposta | Celle restituite | Dipendenze | Valutazione |
|---|---:|---:|---:|---:|---:|
| sparse 120×60 | 12 963 byte | 308 byte | 2 | 1 | 33 µs |
| dense 120×60 | 696 785 byte | 625 368 byte | 7 200 | 120 | 12 310 µs |
| dense 1 000×50 | 4 864 946 byte | 4 402 308 byte | 50 000 | 1 000 | 89 079 µs |

I tempi caratterizzano quella macchina e non sono una soglia. I byte invece
mostrano la forma del protocollo: la risposta densa cresce quasi quanto il file.
Nel caso 120×60 lo smoke ha disegnato da 390 a 528 celle; la risposta corrente
ne trasporta 7 200. Modificare `A1` nel workbook misurato cambia soltanto `A1` e
la dipendente `B1`, ma il comando restituisce ancora tutte le 7 200 celle.

Su una sorgente canonica sparse 120×60 una singola patch coordinata occupa 106
byte, mentre la `GridOperation` interna completa occupa 238 byte e la sorgente
reinviata 12 963 byte. Un incolla TSV 2×2 occupa 385 byte di patch, 955 byte come
operazione interna e produce una sorgente da 13 335 byte. Sul primo edit di una
sorgente valida ma non canonica, la serializzazione pretty rende invece
l'operazione testuale da 23 689 byte: pubblicare il diff testuale come
semantica della griglia legherebbe il costo al layout JSON e non alle celle
cambiate.

## Decisione

La shell pubblica famiglie di superficie; il provider pubblica un binding
`format-id` → `family + protocol-version` e alimenta la famiglia, senza
trasferire DOM, JavaScript o oggetti del framework frontend.

Le decisioni del primo protocollo grid sono:

1. La risoluzione usa il `format-id` esatto e la `source-kind`; non richiede di
   parsare il documento. Un override esplicito della vista può precedere il
   binding.
2. Il bundle che registra il binding ne è l'owner. Il registro della shell
   valida collisioni, versione e presenza della famiglia e restituisce il
   disposer; il formato su disco resta registrato separatamente nel kernel.
3. La registrazione è globale al mount del bundle, la scelta è per riquadro e
   documento, il buffer autorevole resta unico nella `DocumentSession` e ogni
   istanza conserva il proprio stato visuale e undo.
4. Ogni binding dichiara una versione intera del protocollo della famiglia.
   Questa versione è distinta dalla versione ABI e dalla versione del formato.
   La shell monta soltanto versioni che dichiara di servire.
5. Il fallback segue l'ordine già osservabile nel registro: override, formato,
   specie della sorgente, testo per UTF-8, viewer read-only per byte, errore
   esplicito. L'indisponibilità del valutatore grid mostra gli input grezzi e
   non attiva un secondo interprete formule.
6. Il provider apre una sessione con sorgente e revisione complete soltanto al
   mount o al reload autorevole. La shell chiede finestre per foglio e indici di
   riga/colonna; la risposta porta gli id stabili degli assi e soltanto le celle
   materializzate. I commit portano patch atomiche `SheetId + RowId + ColumnId`
   con preimmagine e nuovo input. Il diff testuale resta una conseguenza di
   serializzazione restituita dal provider alla `DocumentSession`, non la
   semantica pubblica della griglia.
7. Dopo un commit il provider restituisce una invalidazione delle celle
   modificate e delle dipendenti transitive. Se l'elenco supera il limite,
   restituisce `all`; ogni istanza richiede di nuovo soltanto la propria
   finestra. Non viaggia l'intero workbook e non si mantiene una seconda
   semantica delle dipendenze nel client.
8. Cella attiva, selezione, scroll, zoom e modalità sono stato locale della
   superficie, versionato e indicizzato da riquadro, documento e superficie.
   Non entrano nel `.fubsheet` e non appartengono al provider del formato.
9. L'unload ritira prima binding e nuove aperture, distrugge tutte le istanze
   possedute e infine rilascia il provider. `suspend` non equivale a `destroy`;
   nessuna istanza può lasciare timer, observer, renderer o listener globali.
10. Usare una famiglia grid conosciuta non è un permesso di sicurezza. Un
    provider puro che parsa e valuta la sorgente non richiede capability host;
    eventuali letture, rete o storage restano nei permessi del manifest e nel
    solo `Guard` esistente.
11. Errori formula e località di cella attraversano codici chiusi e coordinate.
    Errori operativi attraversano `PluginError`; fallback e versioni mancanti
    sono localizzati dalla shell, che possiede quelle frasi. Nessun provider
    invia prosa non localizzabile per uno stato che la shell può derivare.
12. Una shell che non conosce famiglia o versione non chiama il provider della
    superficie, conserva attive le altre registrazioni del bundle e applica il
    fallback. Il mancato binding è visibile come notice, non come selezione
    silenziosa di una versione simile.

Il primo contratto impone i limiti seguenti: sorgente iniziale o di reload al
massimo 16 MiB; finestra al massimo 256 righe, 128 colonne e 32 768 coordinate;
operazione al massimo 16 384 patch e 4 MiB complessivi di input; risposta al
massimo 8 MiB; invalidazione esplicita al massimo 32 768 celle, oltre le quali
si usa `all`. Il superamento viene rifiutato prima dell'allocazione
proporzionale.

Il contratto nasce soltanto insieme a due consumatori conformi: il provider
nativo `.fubsheet` e un componente WASM di esempio. Entrambi attraversano gli
stessi tipi e la stessa semantica; il valutatore Rust rimane l'unica autorità
del linguaggio formule.

Due guard rendono meccanica questa decisione. Nel client una registrazione di
superficie deve dichiarare profili e fallback, e ogni binding deve riferirsi a
un profilo registrato. Nel repository il guard delle famiglie pubbliche deriva
i `*_FAMILY` da `fub-abi` e pretende, per ciascuno, shell, fallback, mirror
TypeScript, nativo e WASM. La completezza non dipende quindi da una checklist
temporanea.

## Conseguenze

### Positive

- Il traffico ordinario cresce con viewport, patch e dipendenti interessate,
  non con il workbook intero.
- La shell conserva rendering, accessibilità, tastiera e CodeMirror senza
  concedere accesso alla webview al provider.
- Identità di cella, fallback, limiti e lifecycle hanno la stessa semantica per
  provider nativi e WASM.
- `DocumentModel` resta agnostico rispetto a celle e fogli.

### Negative

- Il provider deve conservare una sessione derivata e gestire un reload
  autorevole dopo conflitto o modifica esterna.
- Un edit che canonicalizza per la prima volta una sorgente può ancora produrre
  un diff testuale grande; il limite di risposta lo rende un errore esplicito
  invece di un'allocazione illimitata.
- Un'invalidazione `all` richiede una nuova lettura per ogni finestra visibile.
- Famiglia e ABI hanno versioni indipendenti da mantenere e verificare.

## Alternative scartate

### Sorgente completa e valutazione completa a ogni commit

È semplice e ha permesso la vertical slice, ma i byte misurati crescono quasi
linearmente con tutte le celle persistite anche quando cambiano due celle.

### Diff testuale come operazione grid pubblica

Su sorgenti canoniche è spesso piccolo, ma la misura sulla prima
canonicalizzazione cresce oltre la sorgente perché contiene preimmagine e
inserimento. Inoltre espone il layout JSON invece dell'identità delle celle.

### Valutatore formule duplicato in TypeScript

Riduce le chiamate ma crea due autorità per valori, errori, cicli e dipendenze.
Il fallback corretto è input grezzo e stato indisponibile.

### Bundle che fornisce direttamente il renderer

Trasferirebbe DOM o codice JavaScript non rappresentabile nel WIT, aggirerebbe
il sistema dei temi e renderebbe accessibilità e lifecycle responsabilità di
ogni plugin.

## Verifica

I test di conformità Rust↔WIT↔TypeScript verificano forma, versioni e limiti. I
banchi nativo e WASM eseguono apertura, finestra, patch, invalidazione, reload e
chiusura sugli stessi casi. I test del registro verificano collisione, versione
sconosciuta, fallback e unload; lo smoke della shell verifica che la tastiera
resti locale e che il DOM contenga soltanto la finestra con overscan.
