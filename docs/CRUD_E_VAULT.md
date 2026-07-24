# CRUD delle note + cestino + versioning del vault

Torna a [PIANO.md](PIANO.md). Piano di lavoro spuntabile: si aggiorna man mano
che i passaggi vengono completati (`[ ]` → `[x]`).

## Contesto (perché questo documento esiste)

Il piano è organizzato per **rischio architetturale** (confine WASM, core
agnostico, indici incrementali), e il CRUD non è rischioso: così non è mai
diventato una voce. L'audit di fine ricerca (2026-07-24) ha mostrato il
divario:

- **Read/Update**: fatti da M1 (lista, lettura, salvataggio con debounce).
- **Create**: il kernel c'è (`write_document` crea file e cartelle); mancano
  comando IPC e UI, e manca la *decisione sul nome* delle note nuove.
- **Rename**: la funzione meglio costruita e meno raggiungibile del progetto —
  kernel completo (riscrittura chirurgica dei wikilink), IPC cablato, **zero
  UI**.
- **Delete**: buco vero. `Vault` non sa cancellare (ha solo read/write/exists/
  rename) e `Workspace::remove_document` non tocca il disco: è nato per il
  watcher, reagisce a cancellazioni già avvenute altrove. Dall'app non si può
  cancellare una nota.

Decisioni di prodotto già prese da Fabio:
- **Il delete è un cestino**, non un'eliminazione (recuperabile dall'app).
- **Versioning del vault**: si salvano versioni nel tempo e l'utente può
  ripescare versioni vecchie.

Niente di tutto ciò tocca il contratto di `fubmd-abi`: sono operazioni del
kernel/app, non trait dei provider (il freeze M4 non c'entra). Il versioning è
anzi un'occasione di **dogfooding**: si implementa come `EventHandler`, cioè
con gli stessi strumenti che avrà un plugin di terzi.

## Decisioni di design (con il perché)

| # | Decisione | Perché | Stato |
|---|---|---|---|
| D1 | Cestino in **`.trash/` dentro il vault** | È la cartella che usa Obsidian per "Move to Obsidian trash": un vault condiviso fra le due app ha **un solo cestino**. Zero lock-in, come da principio. | proposta |
| D2 | Collisione nel cestino → **suffisso timestamp** (`Nota.2026-07-24T15-30-00.md`) | Cancellare due volte "Nota.md" non deve né fallire né sovrascrivere la prima copia. | proposta |
| D3 | Nota nuova = **`Senza titolo.md`** nella radice; se esiste, `Senza titolo 1.md`, `2`, … | Convenzione nota (Obsidian: "Untitled"); l'utente rinomina subito col rename che già funziona. | proposta |
| D4 | Versioning = **snapshot per-file** in `.fubmd-data/versions/` + **tombstone** alla cancellazione | Con ogni snapshot timestampato e i tombstone, "il vault al tempo T" è ricostruibile: ultima versione ≤ T di ogni file, esclusi i morti. Si ottengono **entrambe** le cose — cronologia per-nota e ripristino del vault a un istante — con un solo meccanismo, senza portarsi in casa git. | proposta |
| D5 | Versioning come **`EventHandler`** (`DocumentChanged`/`Renamed`/`Removed` → snapshot via `host.read_document`) | Dogfooding del contratto. Un `Overflow` può fargli perdere uno snapshot intermedio: per un *campionatore* è accettabile (la versione successiva arriva al prossimo salvataggio) — a differenza dell'indice, che per questo non passa dagli eventi. | proposta |
| D6 | Retention: **dedup per contenuto** (niente snapshot se identico all'ultimo) + potatura a fasce (tutto < 24h, orario < 7gg, giornaliero < 90gg) | Limita la crescita senza perdere la storia recente, che è quella che si ripesca davvero. Parametri regolabili nei settings (M3). | proposta |
| D7 | Il versioning è **spegnibile totalmente** | Principio non negoziabile ([funzionalita-future.md](appendix/funzionalita-future.md)): spento = l'handler non si registra, la UI non esiste. | vincolo |
| D8 | Ripristino di una versione = **scrittura normale** (`write_document`), mai un bypass | Passa da grafo, indici, eventi, watcher come ogni altra modifica: nessun percorso speciale da tenere coerente. Il ripristino stesso genera uno snapshot (si può "annullare il ripristino"). | proposta |

Aperto, da decidere strada facendo:
- **Trigger degli snapshot**: a ogni `DocumentChanged` (con dedup D6 il costo è
  basso) oppure con un debounce proprio (es. max 1/minuto per file)? Partire
  semplice: ogni evento + dedup, misurare.
- **UI della cronologia**: pannello per-documento ("versioni di questa nota")
  subito; "vault al tempo T" può aspettare una seconda passata.

## Fase 0 — Prerequisiti (bug latenti che il cestino renderebbe reali)

- [ ] `sync_path` deve rispettare `IGNORED_DIRS` e i path nascosti: oggi il
      filtro vive solo in `walk()`, quindi un file comparso in `.trash/` o
      `.obsidian/` verrebbe **reindicizzato dal watcher**. Spostare il check in
      un punto solo (es. `Vault::is_ignored(path)`) usato da entrambi.
- [ ] Aggiungere `.trash` a `IGNORED_DIRS`.
- [ ] Test: un file creato in `.trash/`/`.obsidian/` non produce eventi, non
      entra nei modelli, non entra nell'indice (spia + watcher).

## Fase 1 — Delete col cestino

- [ ] `Vault::trash(id) -> Result<DocId>`: sposta il file in `.trash/`
      (creandola se manca), gestisce la collisione (D2), restituisce il path
      nel cestino. Niente `std::fs::remove_file` in questa fase: il delete
      dell'app **è** lo spostamento.
- [ ] `Workspace::delete_document(id)`: `Vault::trash` + il lavoro che già fa
      `remove_document` (modelli, grafo, indici, `Event::DocumentRemoved`).
      `remove_document` resta com'è: è il percorso del *watcher* (file già
      sparito dal disco, nulla da cestinare).
- [ ] Cestino: elenco e ripristino nel kernel — `Workspace::list_trash()`,
      `Workspace::restore_from_trash(trash_id)` (il ripristino è un
      `write_document` sul path originale ricavato dal nome, con dialogo se il
      path è di nuovo occupato).
- [ ] Svuota cestino (`Workspace::empty_trash`, qui sì `remove_file`).
- [ ] IPC: `delete_document`, `list_trash`, `restore_from_trash`,
      `empty_trash`.
- [ ] Frontend: voce "Elimina" nel menu contestuale della lista file (con
      conferma), vista cestino minimale (lista + ripristina + svuota).
- [ ] Frontend: cancellazione del documento aperto → editor svuotato e
      selezione della prima nota (il buffer sporco di un documento cancellato
      muore col documento: è stata un'azione esplicita dell'utente).
- [ ] Test kernel (`index_feeding.rs` + nuovo `trash.rs`): il delete alimenta
      `on_document_removed`; il file esiste in `.trash/`; restore reindicizza;
      il watcher che vede sparire il file originale non fa doppio lavoro.
- [ ] Test e2e: delete → non più cercabile, backlink verso la nota diventano
      non risolti; restore → tutto torna.

## Fase 2 — Create + Rename in UI (chiude il CRUD)

- [ ] `Workspace::create_untitled() -> DocId` (D3: nome libero calcolato senza
      race, dentro il lock del workspace) — oppure parametro `name` opzionale
      per il flusso "crea nota da link non risolto".
- [ ] IPC `create_note`, frontend: pulsante "Nuova nota" in cima alla sidebar
      → crea, seleziona, focus sull'editor.
- [ ] Frontend rename: voce "Rinomina" nel menu contestuale (input inline o
      prompt), con `flushPendingSave()` **prima** di chiamare l'IPC — il
      rename riscrive file di terzi, il buffer va messo in salvo (stessa
      regola flush-before-patch di [M3](milestones/M3-editor-fidelity.md)).
- [ ] "Crea nota da link non risolto" (chiude la voce M2): click su wikilink
      non risolto → `create_note` col nome del `page` + navigazione. Due righe
      ora che il caso generale esiste.
- [ ] Test: collisioni di nome (`Senza titolo 1`), creazione da link non
      risolto → il backlink compare (`vault_e2e.rs`, era già nel piano M2).

## Fase 3 — Versioning del vault

- [ ] Store: `.fubmd-data/versions/<hash-del-doc-id>/<timestamp>.md` +
      indice `versions.json` (doc_id → lista `{ts, hash, size}` + tombstone).
      Hash del contenuto per il dedup (D6), FNV o simile — stessa filosofia
      del manifest dell'indice: nel dubbio si ricostruisce l'indice delle
      versioni leggendo lo store, mai il contrario.
- [ ] `VersioningHandler` (`fubmd-features`): `EventHandler` su
      `DocumentChanged`/`DocumentRenamed`/`DocumentRemoved` (D5) —
      `Changed` → snapshot se contenuto nuovo; `Renamed` → migra la chiave;
      `Removed` → tombstone. Lettura via `host.read_document`.
- [ ] Potatura a fasce (D6), eseguita a fine snapshot; **loggare** quante
      versioni ha potato (niente sparizioni silenziose).
- [ ] API kernel/IPC: `list_versions(doc_id)`, `read_version(doc_id, ts)`,
      `restore_version(doc_id, ts)` (D8: è un `write_document`).
- [ ] Frontend: pannello "Cronologia" per il documento aperto — lista
      versioni con data, anteprima del contenuto, pulsante "Ripristina".
      Se il buffer è sporco: flush prima del ripristino.
- [ ] Interruttore on/off (D7): spento = handler non registrato, pannello e
      voci di menu assenti. Fino ai settings di M3, una env/`config` basta.
- [ ] Test: snapshot su modifica, dedup su contenuto identico, migrazione su
      rename, tombstone su delete, potatura, ripristino che genera a sua
      volta uno snapshot; ricostruzione di `versions.json` da store corrotto.
- [ ] (seconda passata) "Vault al tempo T": vista che ricostruisce l'elenco
      dei file a un istante (ultima versione ≤ T + tombstone) e ripristino
      selettivo o totale.

## Fase 4 — Chiusura

- [ ] `cargo test --workspace` + clippy + `tsc` verdi; bench invariati.
- [ ] Docs: aggiornare [PIANO.md](PIANO.md) (decisioni D1–D8 in tabella se
      confermate), [M2](milestones/M2-search-graph.md) (la voce "crea nota" si
      spunta), [data-model.md](architecture/data-model.md) (il cestino e le
      versioni nel discorso "verità del documento").
- [ ] Aggiornare questo file: spuntare tutto o annotare cosa è slittato e
      perché.

## Criteri di accettazione

- Dall'app si può: creare una nota, rinominarla, cancellarla nel cestino,
  ripristinarla dal cestino, svuotare il cestino.
- Una nota cancellata sparisce da ricerca/grafo/backlink; ripristinata,
  ricompare ovunque. Il tutto senza riavvii e senza full-rebuild.
- Un vault condiviso con Obsidian usa lo stesso `.trash/` (una nota cestinata
  di là si ripristina di qua).
- Con versioning acceso: ogni salvataggio significativo è ripescabile; il
  ripristino di una versione è a sua volta annullabile. Spento: nessuna
  traccia in UI, nessuna scrittura in `.fubmd-data/versions/`.
- Il watcher non indicizza mai `.trash/` né `.fubmd-data/`.

## Non-obiettivi (per non allargarsi)

- Sync fra dispositivi (post-M5, [funzionalita-future.md](appendix/funzionalita-future.md)).
- Merge/conflitti buffer↔disco (resta a [M3](milestones/M3-editor-fidelity.md)).
- Versioning basato su git: D4 lo copre con meno macchinario; se un giorno
  servisse la storia *condivisibile*, si rivaluta.
- Cestino di sistema (XDG Trash): il cestino del vault è portabile e
  Obsidian-compatibile, quello di sistema no.
