# Le porte della griglia

> **Ambito:** la famiglia IPC `grid` con cui la shell apre, legge e cambia i
> fogli di calcolo sui byte del documento: porte, tipi, comandi e limiti.
> **Fonti autorevoli:** `crates/fub-abi/src/grid_bytes.rs`,
> `crates/fub-abi/src/grid.rs`, `crates/fub-app/src/lib.rs`,
> `apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`.

Il resto del confine IPC è nel [contratto IPC](ipc-contract.md); le cartelle
di Excel, che servono questa famiglia, sono nella
[sezione omonima](ipc-contract.md#cartelle-di-excel).


## Famiglia e porte

La famiglia Grid usa porte strettamente tipate, con i record `Grid*` del
mirror: `list_grid_surfaces` elenca i binding, e una superficie con
`protocol_version` 2 si apre sui byte di un documento con `open_grid_bytes`,
`grid_bytes_window`, `apply_grid_bytes`, `grid_bytes_commands`,
`grid_bytes_command` e `close_grid_bytes`. La shell
negozia famiglia, versione e formato prima di aprire; un binding sconosciuto
o incompatibile non viene chiamato e la superficie dice che il foglio non si
apre. `query_index` non applica patch e non possiede lifecycle.

`open_grid_bytes` riceve `surface`, `doc`, `journal` e `base`: la shell non
trasporta i byte, ma il giornale canonico delle celle cambiate (il testo
della sessione documento) e la revisione dei byte da cui parte. L'host legge
il documento, controlla che il formato sia quello della superficie (`BadArgs`
altrimenti) e risponde `Conflict` se i byte non sono più quelli di `base`. La
sessione è un `GridBytesSession` (fogli, foglio attivo, fogli nascosti, avvisi
`GridNotice`, celle in conflitto e il libro `GridBook`: i dodici colori del
tema in `#RRGGBB`, i nomi definiti visibili, il modo di calcolo
`GridCalculation`, la struttura protetta e il carattere dello stile Normale,
nome e punti, che lo stile di una cella tace); la finestra è un `GridBytesWindow`, la cui
cella porta `GridValue`, il testo formattato, blocco, `stale`, `conflict`,
l'indice del suo stile e i segni (barra di dati, icona, commento,
collegamento). La finestra porta gli stili delle sue celle, ognuno una volta
(`GridCellStyle`: carattere, colori, bordi, allineamenti, rientro, a capo,
rotazione), le unioni e le tabelle che la toccano (`GridMerge`, `GridTable`
con le opzioni e il nome dello stile) e la vista del foglio (`GridSheetView`:
riquadri bloccati, griglia, intestazioni, zoom, da destra a sinistra, la
modalità `GridViewMode`, le formule mostrate, la protezione, griglia e
intestazioni in stampa). La finestra porta anche gli oggetti che la toccano,
nell'ordine in cui si disegnano (`GridObject`: tipo `GridObjectKind`, id,
cella dell'angolo, scarto e misura in pixel a zoom 100, testo alternativo):
un grafico o un grafico sparkline con il suo disegno in SVG, un'immagine con
i suoi byte (`GridMedia`: tipo, impronta `key` e base64), una forma con il
suo aspetto (`GridShape`), che disegna la shell; `missing` dice perché un
oggetto non porta ciò che mostra (`too_large`, `unsupported`). La richiesta
della finestra elenca in `known_media` le impronte che la shell ha già: di
quelle immagini la finestra porta la chiave senza i byte. Il
commit è un `GridCommit` il cui `edit` è il diff del testo del giornale, da
applicare al buffer della sessione documento.

La sessione porta anche il catalogo dei comandi che serve
(`GridCommandState`: id, acceso, perché è spento). `grid_bytes_commands`
riceve una `GridSelection` (foglio, intervalli A1, cella attiva) e ridà il
catalogo su quella selezione; `grid_bytes_command` riceve un
`GridCommandRequest` (la revisione e un `GridCommand` con i parametri come
testo di un oggetto JSON) e ridà un `GridCommandOutcome`: il commit del
giornale, che resta alla revisione se il comando non cambia la cartella, i
fogli, la selezione nuova, il risultato come testo JSON, la finestra di
dialogo chiesta, il catalogo aggiornato e il libro. Il risultato è sempre un
oggetto: un valore che non lo è sta sotto `value`, i messaggi del comando
sotto `messages`. I parametri della finestra chiesta portano anche ciò che la
finestra mostra all'apertura e che la shell non legge da sé (la regola di
convalida della cella attiva per `dataValidation`). Un comando che il provider non
serve, spento o con parametri che non tornano è `BadArgs`. Il provider delle
cartelle di Excel serve un sottoinsieme del catalogo di GridCraft, più
`edit.undo` ed `edit.redo` del documento
([ADR 0219](../decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md),
in proposta); su una cartella che la riscrittura perderebbe i comandi che la
cambiano sono spenti, e darne uno è `PermissionDenied` con `xlsx.rewrite.loses`.

## Limiti e semantica Grid

Le coordinate sono `SheetId + RowId + ColumnId`; una sessione apre la
sorgente nell'host, e le letture sono finestre fino a 256×128 e 32.768
coordinate. Un commit accetta 16.384 patch e
4 MiB di preimmagini e nuovi input; la risposta, envelope compreso, è al
massimo 8 MiB. L'invalidazione restituisce le coordinate da rileggere fino a
32.768 elementi, poi `all`. Il diff del giornale usa offset in byte UTF-8.
Una finestra porta fino a 1.024 tabelle; il libro fino a 4.096 nomi; un nome
di tabella, di stile o definito è al massimo di 255 byte. Una finestra porta
fino a 1.024 oggetti; il disegno di un grafico è al massimo di 1 MiB, i byte
di un'immagine di 3 MiB in base64 (soltanto PNG, JPEG, GIF, BMP, WebP e SVG),
il testo di una forma di 64 KiB; la richiesta elenca fino a 256 impronte di
64 byte al più.

Il registro conserva ownership e disposer per ogni binding. L'unload ritira il
binding, distrugge le istanze e soltanto dopo rilascia il provider. Nessuna
battuta attraversa IPC: la shell consegna una sola richiesta al commit.
Provider nativo e proxy WASM devono osservare la stessa famiglia/versione,
limiti, fallback ed errori.
