# 0218 — Il `.fubsheet` non si modifica più e si converte in Excel, e la versione 1 di `grid` esce dal contratto

- **Stato:** accolta
- **Data:** 2026-10-22
- **Ambito:** contratto
- **Sostituisce:** 0217; 0201 per la versione 1 del protocollo `grid`
- **Sostituita da:** —

## Contesto

Con l'[ADR 0216](0216-protocollo-grid-2-sorgente-a-byte.md) Fub ha due fogli
di calcolo e due protocolli: il `.fubsheet`, un JSON con il modello e il
valutatore di `fub-format-sheet` sulla versione 1 di `grid` (sorgente testuale,
patch sul testo), e la cartella di Excel, sui suoi byte con la versione 2 e il
motore di GridCraft. Tenerli entrambi costa:

- due semantiche delle formule, che danno valori diversi sulla stessa
  formula (l'[ADR 0217](0217-copia-in-excel-di-un-fubsheet.md) le misura);
- due protocolli nel WIT, nell'IPC, nel mirror TypeScript, nel banco di
  `MemoryHost` e nella superficie della shell, con i loro test;
- un formato che nessun altro programma apre, mentre la cartella di Excel è
  il formato con cui i fogli si scambiano.

Il `.fubsheet` non ha utenti fuori da Fub e la versione 1 non è in nessun WIT
congelato. Il salvataggio di un `.fubsheet` era inoltre rotto in `main`: il
formato è di sola sorgente nel kernel, senza parser, e la scrittura falliva.

## Decisione

- **Il `.fubsheet` non si modifica più.** Il kernel lo conosce ancora come
  formato di sola sorgente, e ora una sorgente di sola lettura:
  `write_document` e `write_document_bytes` rifiutano un'estensione che ha un
  descrittore e nessun provider (`NoProvider`), invece di scriverne i byte
  opachi. Il file resta nel vault, si sposta, si rinomina e va nel cestino
  come ogni altro.
- **La shell lo dice e offre la conversione.** La famiglia `grid` ha il
  profilo `retired` per il formato `fubsheet`: una frase e un pulsante che
  avvia il comando `xlsx.convert` con il documento già scelto. Il buffer resta
  il testo del file e niente lo cambia, quindi il foglio non si sporca e non
  si salva.
- **La conversione è un comando, non un export.** `fub-format-xlsx` registra
  `xlsx.convert` («Converti in Excel»), un comando di scrittura nel vault con
  il solo parametro del documento. Scrive accanto al `.fubsheet` una cartella
  nuova con un nome libero (`Bilancio.xlsx`, poi `Bilancio 1.xlsx`), la apre e
  dice ciò che non porta. In prova (`DryRun`) dice il nome e non scrive. La
  copia, i nomi dei fogli, le formule nella sintassi di Excel, i valori di
  GridCraft e la perdita misurata sono quelli decisi nella 0217; cambia
  soltanto dove va la copia. Il `.fubsheet` va nel cestino soltanto se
  l'utente lo chiede, con i comandi di sempre.
- **La versione 1 di `grid` esce.** Il trait `GridProvider`, i tipi della
  sessione e della finestra sul testo, le porte IPC `open_grid`,
  `grid_window`, `apply_grid`, `reload_grid` e `close_grid`, l'export `grid`
  del mondo WIT, il bundle `fub.sheet` e il profilo `sheet` della shell non
  esistono più. Restano i tipi che la versione 2 usa (`grid-surface-spec`,
  `grid-sheet`, righe, colonne, chiavi, stili, richieste, patch, commit) e
  l'interfaccia `grid-bytes`. Un componente che dichiara una famiglia o una
  versione che l'host non serve si monta senza la griglia, come prima.
- `fub-format-sheet` diventa il **lettore** del `.fubsheet` per la
  conversione: modello, formule e valutatore, senza provider, indici né
  sessioni, e senza dipendere da `fub-abi`.

## Conseguenze

### Positive

- Un solo foglio di calcolo, un solo motore e un solo protocollo: la cartella
  di Excel sulla versione 2.
- Il contratto perde cinque porte IPC e un'interfaccia WIT senza rompere una
  versione congelata.
- Nessun `.fubsheet` si perde: resta leggibile e convertibile, con le perdite
  dette.

### Negative

- Un `.fubsheet` non si modifica più in Fub; chi lo vuole modificare lo
  converte, e la cartella non torna indietro.
- Il contenuto di un `.fubsheet` non entra più nella ricerca, nell'indice e
  nella struttura: li dava il bundle `fub.sheet`.
- I link alle celle di un `.fubsheet` non puntano alla copia.

## Alternative scartate

### Tenere la versione 1 per il solo `.fubsheet`

Il `.fubsheet` sarebbe rimasto modificabile, ma con un secondo protocollo e un
secondo motore da mantenere, per un formato che nessun altro programma apre.

### Convertire ogni `.fubsheet` all'apertura del vault

Una riscrittura che nessuno ha chiesto: il vault cambierebbe sotto chi lo
sincronizza o lo versiona, e la perdita non sarebbe stata vista da nessuno.

### Mettere la copia fuori dal vault, come un export

Era la forma della 0217. Una copia che si apre in Fub deve stare nel vault, e
un export con la finestra di salvataggio non ha senso per un file che va
accanto al suo originale.

## Verifica

- `crates/fub-kernel/tests/source_only.rs`: una sorgente di sola lettura non
  si scrive né come testo né come byte;
- `crates/fub-host/tests/xlsx_workbooks.rs`: la prova non scrive, la
  conversione scrive accanto e apre la cartella, il `.fubsheet` resta, una
  seconda conversione prende un nome libero, una nota o una cartella si
  rifiutano, spento il bundle il comando sparisce e il foglio resta leggibile;
- `crates/fub-format-xlsx/tests/fubsheet.rs`: valori, formule, stili e
  perdite della copia;
- `crates/fub-wasm-host/tests/grid_bytes_crosses.rs`: una famiglia
  sconosciuta resta un binding facoltativo;
- `apps/client/src/editors/core/registry.test.ts`: il `.fubsheet` va al
  profilo `retired`, e il pulsante avvia `xlsx.convert` sul documento.
