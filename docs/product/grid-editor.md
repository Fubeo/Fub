# La griglia dei fogli di calcolo

> **Per chi:** chi apre una cartella di Excel in Fub.
> **Risultato:** sapere come si muove la griglia, come arrivano i valori e
> quali preferenze cambiano i suoi segni.

La griglia mostra intestazioni, celle e selezione rettangolare in una viewport
virtualizzata. Supporta tastiera, schede dei fogli, formula bar e copia TSV
(celle multilinea fra virgolette, come in Excel). Tab e Maiusc+Tab percorrono
le celle visibili; raggiunti i due estremi, lasciano la griglia e proseguono
verso gli altri controlli della shell. Nessuna battuta attraversa IPC.

Una cartella di Excel si apre con i valori salvati nel file, senza ricalcolo,
e si modifica a comandi; la forma è descritta nel [modello del
documento](../architecture/document-model.md). Il protocollo Grid a byte (la
versione 2) porta finestre, patch e giornale fra la shell e un provider nativo
o WASM; famiglia, versione e fallback sono negoziati prima dell'invocazione.
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
