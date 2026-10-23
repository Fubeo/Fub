# ABI e WIT

> **Ambito:** contratto condiviso fra core, provider nativi, componenti WASM e
> proiezioni IPC.
> **Fonte autorevole:** `crates/fub-abi/`.

## Sorgenti

| Forma | Percorso | Ruolo |
|---|---|---|
| Rust | `crates/fub-abi/src/` | tipi e trait usati dai crate |
| WIT vivo | `crates/fub-abi/wit/fub/abi.wit` | component model |
| WIT congelato | `crates/fub-abi/wit/frozen/` | baseline di compatibilità |
| TypeScript | `apps/client/src/host/contract.ts` | forma serializzata verso la shell |
| enum TS | `apps/client/src/host/enums.generated.ts` | derivato dai tipi Rust |

Il package WIT corrente è:

```wit
package fub:abi@0.2.0;
```

## Superficie Rust

`fub-abi` espone famiglie per:

- modello, sorgente, parsing e rendering;
- comandi e undo;
- query e indici;
- view e UI dichiarativa;
- eventi e job;
- import ed export;
- sessione;
- impostazioni, locale e tema;
- servizi host;
- errori, regole e schema;
- capability e manifest.

La radice del crate ri-esporta la superficie pubblica. Un test confronta i tipi
pubblici con l'elenco per impedire esportazioni accidentali o dimenticate.

## Mappatura

| Rust | WIT | TypeScript |
|---|---|---|
| `String` | `string` | `string` |
| `Vec<T>` | `list<T>` | `T[]` |
| `Option<T>` | `option<T>` | `T \| null` quando serializzato |
| struct | `record` | `interface` |
| enum con payload | `variant` | union discriminata |
| enum senza payload | `enum` | union di stringhe generata |
| `BTreeMap<String, Value>` | lista di entry o JSON | `Record<string, unknown>` |
| `usize` di uno span | `u64` | numero controllato o forma IPC dedicata |
| `u64` identità/hash IPC | `u64` nel WIT | stringa via JSON |

La forma TypeScript dipende dalla serializzazione Tauri, non è una trascrizione
meccanica di ogni tipo WIT.

## JSON come escape hatch

WIT non ha una forma JSON libera. Frontmatter, attributi estensibili, argomenti
e storage attraversano alcune interfacce come stringa JSON.

La stringa non autorizza a evitare un tipo stabile. Si usa quando la coda del
dominio è deliberatamente aperta o il valore appartiene al plugin.

## Alberi ricorsivi

WIT non ammette ricorsione diretta. `Block`, `Inline` e `UiNode` diventano
arena:

- lista piatta dei nodi;
- riferimenti `u32`;
- radici esplicite;
- conversione controllata;
- limite di profondità;
- errore su indici fuori range.

La conversione canonica è `fub_abi::arena`.

## Host API

Il world importa le famiglie `host-api`. Un metodo Rust che riceve
`&mut dyn HostApi` non serializza l'oggetto come parametro: il guest usa le
funzioni importate.

Le famiglie vengono linkate in base ai servizi disponibili. Nessuna funzione
host implica accesso diretto a filesystem, rete o orologio.

## Famiglia `grid`

La famiglia `grid` è il contratto strutturato a finestre. Il binding negozia
prima `family = "grid"` e `protocol_version`; famiglia, versione ABI e
versione del formato restano indipendenti. L'unica versione servita è la 2:
la 1, su un sorgente di testo, è uscita dal contratto
([ADR 0218](../decisions/0218-via-il-fubsheet-e-la-versione-1-di-grid.md)), e
l'interfaccia WIT `grid` tiene soltanto i tipi comuni. Una shell che non
conosce la coppia esatta non invoca il provider: conserva gli altri binding e
dice che il foglio non si apre.

Le coordinate pubbliche sono sempre `SheetId + RowId + ColumnId`. Le finestre
rispettano 256 righe, 128 colonne e 32.768 coordinate. Un'operazione accetta
al massimo 16.384 patch e 4 MiB complessivi di preimmagini e nuovi input.
Risposta e envelope JSON sono limitati a 8 MiB. L'invalidazione elenca le
coordinate da rileggere fino a 32.768 elementi; oltre usa `all`.

Le patch sono input-only con preimmagine; il provider resta l'autorità per
stile, formule, valori e dipendenze. Provider nativo e proxy WASM usano gli
stessi tipi, limiti, errori e lifecycle. DOM, oggetti CodeMirror e callback
JavaScript non compaiono in Rust, WIT o mirror TypeScript; il testo resta
locale e nessuna battuta genera IPC o WASM.

La famiglia è una porta tipizzata del contratto, non una capability di
sicurezza. `query_index` resta il canale read-only per dati indicizzati; non è
il percorso delle finestre, delle patch o del lifecycle Grid.

### Una sorgente a byte

La versione 2 (`protocol_version = 2`, `fub_abi::grid_bytes`, interfaccia WIT
`grid-bytes`) apre una sorgente **a byte** che resta nella custodia dell'host:
la shell non vede mai i byte. Il trait `GridBytesProvider` ha `surfaces`,
`open`, `window`, `apply`, `bytes_to_write`, `close` e `shutdown`; nativo e
WASM lo implementano con gli stessi tipi, limiti, errori e lifecycle.

- `open(surface, source, revision, journal)` riceve i byte, la loro
  revisione e il **giornale** delle celle cambiate (`GridJournal`), e dà un
  `GridBytesSession`: fogli, foglio attivo, fogli nascosti, avvisi in codici
  chiusi (`GridNotice`) e voci del giornale in conflitto con i byte.
- `window` dà un `GridBytesWindow`: ogni cella porta l'input, l'indice dello
  stile, il valore (`GridValue`), il testo formattato dal provider, il codice
  del blocco (`lock`), `stale` (il valore del file non segue una cella
  cambiata), `conflict` e i segni già risolti: barra di dati, icona,
  commento con le risposte e collegamento. La finestra porta gli stili
  (`grid-cell-style`, non più delle celle), le unioni che la
  toccano, mai di una cella sola, e la vista del foglio, con lo zoom da 10 a
  400 e i riquadri bloccati dentro il foglio. Uno stile ha il carattere fino
  a 256 byte, la dimensione fra 0 e 409 punti, colori fino a 32 byte e la
  rotazione fra -90 e 90 gradi, o 255 per il testo in colonna.
- `apply` riceve le patch di `GridApplyRequest`; il `GridCommit` porta il diff del
  **testo del giornale**, e l'invalidazione.
- `commands(instance, selection)` dà il catalogo (`GridCommandState`, fino a
  1.024 comandi con id unici; il perché, fino a 1 KiB, soltanto per un comando
  spento) sulla `GridSelection`. Di serie è vuoto.
- `command(instance, request)` dà un comando del catalogo e ridà un
  `GridCommandOutcome`: il `GridCommit` del giornale, i fogli, la selezione
  nuova, il risultato (un oggetto JSON fino a 1 MiB), la `GridDialog` chiesta
  e il catalogo. L'host controlla che la revisione vada avanti se e soltanto
  se il diff non è vuoto. Di serie è `BadArgs`; l'esempio `esempi/grid-wasm`
  dà il catalogo vuoto e rifiuta ogni comando.
- `bytes_to_write(instance, expected)` dà i byte con il giornale innestato. La
  chiama soltanto l'host, per salvare.

Il giornale ha una sola forma canonica, il cui testo vuoto è il giornale
vuoto: JSON `{"version": 1, "cells": [...]}`, voci `{"sheet", "row",
"column", "before", "after"}` in ordine di chiave confrontata come byte, id
di ASCII stampabile fino a 64 byte, nessuna chiave due volte e nessuna voce
con `after` uguale a `before`. `GridJournal::rebase` lo riporta sui byte di un
salvataggio; la shell ne ha il mirror, legato dalla fixture
`GridJournalRebase`. La sorgente arriva fino a 256 MiB
(`MAX_GRID_BYTES_SOURCE`); il giornale ha i limiti di un'operazione (16.384
voci, 4 MiB di input); una sessione porta al più 64 avvisi. Il perché è
nell'[ADR 0216](../decisions/0216-protocollo-grid-2-sorgente-a-byte.md).

`GridJournal` legge e scrive anche una seconda forma, mai insieme alla prima:
il **giornale di comandi**, `{"version": 2, "commands": [...]}`, con almeno un
comando `{"id", "params", "sheet", "selection", "active"}` (`GridCommand`) in
ordine di applicazione. `params` è il testo di un oggetto JSON fino a 64 KiB,
portato com'è; la selezione è in riferimenti A1 separati da virgola, la cella
attiva è un riferimento solo. Fino a 16.384 comandi e 16 MiB di testo. Il
rebase toglie i comandi in comune con il salvataggio dall'inizio, e
`reverted_by` conta quelli salvati che il giornale non ha più. Nessun provider
serve ancora questa forma: è il primo passo dell'[ADR
0219](../decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md),
in proposta.

## Errori

`PluginError` conserva una specie e un messaggio. Le famiglie comprendono
errori come:

- comando o view sconosciuti;
- argomenti errati;
- permesso negato;
- conflitto;
- servizio non disponibile;
- cancellazione;
- non trovato;
- già esistente;
- I/O;
- errore interno.

Un adattatore non stringifica un errore perdendo la variante.

## Compatibilità

L'host accetta:

- stessa major;
- minor del plugin non superiore a quella dell'host.

Gli snapshot congelati rendono meccanica l'additività. Sono incompatibili:

- rimozione o rinomina;
- cambio di tipo;
- cambio d'ordine di campi o casi pubblicati;
- inserimento nel mezzo di una forma congelata;
- spostamento fra interfacce;
- modifica della firma.

Sono compatibili, quando aggiunte in coda o in una nuova superficie:

- nuovo record o alias;
- nuovo caso;
- nuovo campo;
- nuova funzione;
- nuova interfaccia.

La patch non cambia la superficie.

## Verifica

I test pertinenti sono in `crates/fub-abi/tests/` e nei crate che proiettano il
contratto. Una modifica completa verifica:

1. compilazione Rust;
2. conformità WIT;
3. additività frozen;
4. round-trip delle arena;
5. fixture TypeScript;
6. componente WASM reale quando la firma viene eseguita;
7. documentazione e ADR, se la decisione è architetturale.

## Regole di modifica

- definire una volta il tipo condiviso;
- non generare una forma da una sorgente che non può esprimere la stessa
  semantica;
- non aggiornare frozen WIT per far passare una rottura;
- non aggiungere un booleano per ogni futura capacità: usare mappe namespaced
  quando il dominio è aperto;
- mantenere il contratto indipendente da Tauri, Wasmtime e Markdown.
