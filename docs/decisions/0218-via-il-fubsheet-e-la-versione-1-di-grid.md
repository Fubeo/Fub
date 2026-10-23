# 0218 — Il `.fubsheet` e la versione 1 di `grid` escono da Fub

- **Stato:** accolta
- **Data:** 2026-10-23
- **Ambito:** contratto
- **Sostituisce:** 0201 per la versione 1 del protocollo `grid`
- **Sostituita da:** —

## Contesto

Con l'[ADR 0216](0216-protocollo-grid-2-sorgente-a-byte.md) Fub ha due fogli
di calcolo e due protocolli: il `.fubsheet`, un JSON con il modello e il
valutatore di `fub-format-sheet` sulla versione 1 di `grid` (sorgente testuale,
patch sul testo), e la cartella di Excel, sui suoi byte con la versione 2 e il
motore di GridCraft. Tenerli entrambi costa:

- due semantiche delle formule, che danno valori diversi sulla stessa
  formula;
- due protocolli nel WIT, nell'IPC, nel mirror TypeScript, nel banco di
  `MemoryHost` e nella superficie della shell, con i loro test;
- un formato che nessun altro programma apre, mentre la cartella di Excel è
  il formato con cui i fogli si scambiano.

Il `.fubsheet` non ha utenti fuori da Fub, la versione 1 non è in nessun WIT
congelato, e il salvataggio di un `.fubsheet` in `main` falliva sempre: il
formato era di sola sorgente nel kernel, senza parser.

## Decisione

- **Il `.fubsheet` esce.** Il crate `fub-format-sheet`, il bundle
  `fub.sheet`, il descrittore di sola sorgente nel kernel e il profilo `sheet`
  della shell non esistono più. Un file `.fubsheet` in un vault è un file
  qualunque senza formato, come ogni estensione che nessun provider dichiara.
  Fub non lo converte: il proprietario del progetto sceglie di trattare il
  formato come se non fosse mai stato di Fub.
- **Il kernel non ha più formati di sola sorgente.** Senza il `.fubsheet`
  nessuno li usa: il registro dei formati porta soltanto descrittori con il
  loro provider.
- **La versione 1 di `grid` esce.** Il trait `GridProvider`, i tipi della
  sessione e della finestra sul testo, le porte IPC `open_grid`,
  `grid_window`, `apply_grid`, `reload_grid` e `close_grid` e l'export `grid`
  del mondo WIT non esistono più. Restano i tipi che la versione 2 usa
  (`grid-surface-spec`, `grid-sheet`, righe, colonne, chiavi, stili,
  richieste, patch, commit) e l'interfaccia `grid-bytes`. Un componente che
  dichiara una famiglia o una versione che l'host non serve si monta senza la
  griglia, come prima.

## Conseguenze

### Positive

- Un solo foglio di calcolo, un solo motore e un solo protocollo: la cartella
  di Excel sulla versione 2.
- Il contratto perde cinque porte IPC e un'interfaccia WIT senza rompere una
  versione congelata.
- Il kernel perde il ramo dei formati senza provider.

### Negative

- Un `.fubsheet` esistente non si apre più come foglio, né si converte: chi
  ne ha uno lo porta in Excel con un altro strumento, o lo legge come file.
- Il suo contenuto non entra più nella ricerca, nell'indice e nella
  struttura.

## Alternative scartate

### Tenere la versione 1 per il solo `.fubsheet`

Il `.fubsheet` sarebbe rimasto modificabile, ma con un secondo protocollo e un
secondo motore da mantenere, per un formato che nessun altro programma apre.

### Convertire un `.fubsheet` in una cartella di Excel

Un comando di conversione avrebbe tenuto in Fub il lettore, il valutatore e la
misura della perdita soltanto per un formato che esce. Il proprietario lo ha
scartato.

## Verifica

- `crates/fub-kernel/src/registry.rs`: ogni formato registrato ha il suo
  provider, e le estensioni si dichiarano minuscole e una volta sola;
- `crates/fub-wasm-host/tests/grid_bytes_crosses.rs`: una famiglia
  sconosciuta resta un binding facoltativo;
- `apps/client/src/editors/core/registry.test.ts`: una cartella di Excel va
  alla griglia.
