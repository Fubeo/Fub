# 14. Le entry, le cartelle, e la lista dei documenti

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Quattro voci che il piano dichiara essere **lo stesso lavoro visto da lati
diversi**, a coppie: §14.2 e §14.1 «vanno fatte nella stessa passata» (il
`VaultEntry` esteso ai documenti, non solo agli asset), §14.3 e §14.4 «sono lo
stesso lavoro visto da due lati» (la cartella come cittadino, e il canale con cui
si chiede cosa c'è dentro). Farle separate significa aggiungere due volte gli
stessi campi alla stessa scansione.

**La prima coppia è chiusa** con la
[0046](../decisions/0046-l-anagrafe-del-vault.md), in un verbale solo perché era
una scansione sola: un file esiste anche se nessuno lo sa parsare, di ogni file
si sa dimensione e data, e `reindex` **chiede agli indici cosa hanno già** prima
di leggere e parsare. Il cliente vero è il controllo di salute, che adesso
distingue un allegato che c'è da uno che manca invece di tacere su tutti; il
cliente visibile è l'albero della shell, che si alimenta da `IndexQuery::Entries`
invece che da `list_documents`.

Restano la §14.3 e la §14.4: l'albero delle cartelle vive ancora solo in
`organizer.ts`, e la lista non si chiede per cartella.

### 14.1 Il vault non è solo documenti

*ex §2.2 · kernel · **P2** — **decisa** con la [0046](../decisions/0046-l-anagrafe-del-vault.md), restano due caselle*

- [x] **`VaultEntry { id, kind: Document | Asset | Unknown, size, mtime }`** e
      una scansione che vede **tutti** i file, non solo le estensioni dei
      provider registrati. La specie **non si persiste**: è una proprietà del
      file *dato chi è registrato adesso*, e un `.canvas` diventa un documento il
      giorno che qualcuno rivendica quell'estensione, senza che un byte cambi.
- [x] **Metadata degli asset**: dimensione e data ci sono per tutti, il MIME è
      una **regola** (`rules::media::mime_of`) e non un campo — è funzione pura
      del nome, e copiarla per file sarebbe una copia che invecchia. Il campo
      `fingerprint` c'è ed è `Option`: si calcola dove i byte sono già in mano,
      mai aprendo un file apposta.
- [ ] **Chi riempie l'impronta degli allegati** — cioè il job che la calcola per
      dedup (13.1), rilevamento duplicati (3.2) e verifica d'integrità (24.2). Il
      campo c'è, il lavoro lungo ha il suo posto
      ([0032](../decisions/0032-il-runner-dei-job.md)), e nessuno lo fa ancora.
- [ ] **Politica cartella allegati** — configurabile, e adesso si sa come: una
      chiave dichiarata nel manifest di chi la legge
      ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)). I
      **riferimenti aggiornati su rinomina/spostamento** invece ci sono già:
      spostare `foto.png` in `allegati/` riscrive sia i `![[foto.png]]` sia i
      `![alt](../foto.png)` di chi la mostra.
- [ ] **Thumbnail/cache derivate** in `.fubmd-data/` (mai autorevoli): aspettano
      chi le disegna.

### 14.2 Nessun metadato di entry: né mtime, né dimensione, né impronta

*ex §2.20 · kernel · **P2** — **chiusa** con la [0046](../decisions/0046-l-anagrafe-del-vault.md)*

- [x] **`DocMeta` tiene id, frontmatter, outline e link** (`index/core.rs`)
      e il `Vault` non espone uno `stat`: mtime e dimensione li legge già, ma solo
      per le voci del cestino (`vault.rs`), e per i documenti non li tiene
      nessuno. Quindi `reindex` **rilegge e riparsa l'intero vault a ogni
      apertura** (`workspace.rs`): «un indice
      persistente riconosce e salta gli immutati» è vero per l'indice, non per
      il kernel, che paga comunque lettura + parse di tutto prima ancora di
      chiedere all'indice se gli interessa.
      → La domanda che mancava è `IndexProvider::up_to_date`, e l'anagrafe è
      durevole in `.fubmd-data/entries.json` (derivata: illeggibile si butta).
      `mtime + size` basta a **saltare** e non a **credere**, con la regola
      *racily clean* di git; l'impronta è ciò che riconosce mille file che un
      `git checkout` ha ritimbrato senza cambiarne uno.
- [x] **Ed è la fonte che manca a un elenco di feature che sembrano
      indipendenti**: apertura rapida di vault grandi ed enormi (24.1),
      rilevamento duplicati e deduplicazione (3.2, 13.1), sync differenziale
      (18.1), verifica d'integrità, checksum e corruption detection (2.1,
      24.2), «stale notes» (7.2, 9.3) e — le più banali e le più visibili —
      «note create di recente» e «note modificate di recente» (8.1).
      → La fonte adesso c'è: `IndexQuery::Entries` porta `mtime` per ogni file.
      Le feature restano da scrivere, ma non aspettano più un dato che non
      esiste.
- [x] È il `VaultEntry` del §14.1 esteso ai **documenti**, non solo agli asset:
      le due voci sono lo stesso lavoro e vanno fatte insieme, come §14.3 e
      §14.4.

### 14.3 Le cartelle non esistono nel kernel

*ex §2.11 · kernel · **P2** — stesso lavoro della 14.4; sblocca `create_folder`, tenuto fuori da 0013*

- [ ] **La cartella come cittadino**: `metas` è una mappa piatta
      (`index/core.rs`) e l'albero vive solo in `organizer.ts::buildTree`.
      È anche la ragione per cui la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha lasciato `create_folder` **fuori**
      dall'`HostApi`: una capacità che creasse una directory vuota produrrebbe
      qualcosa che nessun'altra capacità vede — `list_documents` non la mostra,
      nessun evento la annuncia, nessuna query la interroga. Quando questa voce
      darà alle cartelle un modello, la capacità sarà additiva.
      Quindi non si può creare una cartella vuota (le directory nascono per
      effetto collaterale di `Vault::write`), rinominarne una sarebbe N rename
      senza atomicità ([decisione 0011](../decisions/0011-il-lotto.md)) e senza un `FolderRenamed`, e icone/ordinamenti di
      cartella nel sidecar non li migra nessuno — `migrateOrganization`
      (`state/organization.ts`) gestisce i soli documenti.

*Sblocca:* 3.2 (crea/rinomina/sposta cartella, drag & drop), 8.2 (folder-level
metadata, inherited metadata), 8.3 (cartella default per tipo nota, regole di
auto-spostamento), 6.2 (CSS per cartella), 11.3 (database da cartella), 19.2
(permessi per cartella).

### 14.4 Il canale della lista documenti

*ex §2.13 · kernel · **P2** — il canale più usato dell'app, e l'unico fuori da `IndexQuery`*

- [ ] **`list_documents` è nel contratto, ma fuori da `IndexQuery`, e sull'IPC
      non scala.** La finestra al confine è arrivata con la
      [decisione 0019](../decisions/0019-il-canale-dati.md) (§5.5): la capacità
      prende una `Page` (`abi/traits.rs`) e il kernel taglia la pagina dalla
      cache dei metadati, ordinata per costruzione, senza materializzare il
      resto (`documents_page`, `workspace.rs`). Restano due metà: un **filtro**
      non lo prende, e **il comando IPC la `Page` non la usa** — restituisce un
      `Vec<String>` con tutto il vault (`list_documents`, `app/lib.rs`), e la shell ne
      ricostruisce l'albero intero a ogni `index_updated`. È il canale più usato
      dell'app e l'unico dato che si chiede fuori da `IndexQuery`, e la
      virtualizzazione del §2.9 mitiga il disegno ma non il trasferimento. Va
      ripensato per-cartella e chiesto a pagine anche di là dall'IPC, insieme al
      §14.1 (`VaultEntry`) e al §14.3.
- [ ] **Il §14.1 ne ha già tolto una metà** ([0046](../decisions/0046-l-anagrafe-del-vault.md)):
      `IndexQuery::Entries` prende una `Page`, e l'albero della shell si alimenta
      da lì invece che da `list_documents` — un giro solo, e dentro `IndexQuery`.
      Resta ciò che questa voce chiede davvero: una lista **per cartella**, così
      che aprire un vault da diecimila note non trasferisca diecimila righe per
      disegnarne venti.
