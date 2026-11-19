# La griglia dei fogli di calcolo

> **Per chi:** chi apre una cartella di Excel in Fub.
> **Risultato:** sapere come si muove la griglia, come arrivano i valori e
> quali preferenze cambiano i suoi segni.

La griglia mostra intestazioni, celle e selezione rettangolare in una viewport
virtualizzata. Supporta tastiera, schede dei fogli, formula bar e copia TSV
(celle multilinea fra virgolette, come in Excel). Tab e Maiusc+Tab percorrono
le celle visibili; raggiunti i due estremi, lasciano la griglia e proseguono
verso gli altri controlli della shell. Nessuna battuta attraversa IPC.

Una cartella di Excel si apre con i valori salvati nel file e si modifica a
comandi; la forma è descritta nel [modello del
documento](../architecture/document-model.md).

Le formule si ricalcolano come in Excel, con il motore di GridCraft
(`crates/fub-format-xlsx/src/ricalcolo.rs`):

- **dopo un cambio**, ogni formula che legge la cella, direttamente o
  attraverso altre formule, anche su un altro foglio, mostra subito il valore
  nuovo; il salvataggio lo scrive nel file come valore della formula, che
  resta com'era (lo leggono così un altro programma, una scheda del foglio in
  una nota e l'anteprima). Il file chiede comunque a Excel e LibreOffice di
  ricalcolare all'apertura (`fullCalcOnLoad`);
- **all'apertura** una formula che un altro programma ha salvato senza valore
  si calcola e si mostra; il file non cambia finché non lo si modifica, e la
  prima modifica salva anche quei valori. Una data corrente o un numero casuale
  (`NOW`, `RAND`) resta quello del file fino alla prima cella cambiata;
- **una formula che il motore non sa calcolare** (una funzione che non
  conosce o di una macro, un riferimento a un'altra cartella, una formula
  matrice o che versa in altre celle, un riferimento circolare) tiene il
  valore del file ed è segnata come non aggiornata, con ogni formula che la
  legge; una formula salvata senza valore che il motore non sa calcolare resta
  vuota, e l'avviso lo dice;
- **con il calcolo manuale** della cartella niente si ricalcola, come in
  Excel: le formule toccate restano segnate.

Il ricalcolo si fa alla conferma della cella, mai a ogni tasto: su un foglio
di 10.000 celle con 1.000 formule in catena costa circa 3–8 ms, e il
salvataggio circa 20 ms (build di rilascio, `cargo test --release -p
fub-format-xlsx --test tempi -- --ignored ricalcolo`).

Il protocollo Grid a byte (la versione 2) porta finestre, patch e giornale
fra la shell e un provider nativo o WASM; famiglia, versione e fallback sono negoziati prima dell'invocazione.
Limiti, coordinate e invalidazione sono normati in [ABI e
WIT](../reference/abi-and-wit.md).

Il salvataggio automatico scrive le celle confermate e lascia aperta, col
fuoco, la cella in cui si sta scrivendo: la sua bozza entra soltanto nella
copia di recupero, e si scrive quando la si conferma (o quando si chiude il
foglio). Una formula entra anche in una cartella che l'innesto ha segnato da
ricalcolare all'apertura (`fullCalcOnLoad`): la riscrittura tiene il segno.

Le formule si scrivono con i nomi inglesi delle funzioni (`SUM`, `AVERAGE`),
come stanno nel file e come li elenca «Inserisci funzione»; i numeri si
scrivono col separatore decimale della lingua. I nomi italiani (`SOMMA`,
`MEDIA`) non sono ancora riconosciuti: la cella mostra `#NAME?`.

Due preferenze dell'editor dicono come si muovono i
segni della griglia, e una scelta vale dal gesto dopo, in tutte le griglie
aperte, senza riaprire il foglio. **Segno della copia nei fogli di calcolo**
(`editor.grid.copy-mark`): «Tratteggio e battito» (di norma), «Solo il
tratteggio» o «Solo il battito»; il taglio resta un tratteggio fitto.
**Velocità della selezione nei fogli di calcolo**
(`editor.grid.selection-speed`): «Svelta», «Come di norma» (di norma),
«Morbida» o «A scatti», coi tasti, coi comandi e col puntatore. Col moto
ridotto la selezione si ferma subito con ogni scelta.

## Dove si trova

- `apps/client/src/editors/grid/`
- `crates/fub-format-xlsx/src/grid.rs`
