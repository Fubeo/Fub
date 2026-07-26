# 14. Le entry, le cartelle, e la lista dei documenti

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Quattro voci che il piano dichiara essere **lo stesso lavoro visto da lati
diversi**: §14.2 e §14.1 «vanno fatte nella stessa passata» (il `VaultEntry`
esteso ai documenti, non solo agli asset), §14.3 e §14.4 «sono lo stesso lavoro
visto da due lati» (la cartella come cittadino, e il canale con cui si chiede
cosa c'è dentro). Farle separate significa aggiungere due volte gli stessi campi
alla stessa scansione.

Oggi un PNG nel kernel **non esiste**, l'albero delle cartelle vive solo in
`organizer.ts`, `reindex` riparsa tutto a ogni apertura, e «note modificate di
recente» non ha alcuna fonte.

### 14.1 Il vault non è solo documenti

*ex §2.2 · kernel · **P2** — stessa passata della 14.2*

- [ ] **`VaultEntry { id, kind: Document | Asset | Unknown, size, mtime }`** e
      una scansione che vede **tutti** i file, non solo le estensioni dei
      provider registrati. Oggi un PNG nel vault semplicemente non esiste per
      FubMD.
- [ ] **Metadata degli asset**: MIME, hash/checksum, dimensione — con il
      checksum arrivano gratis dedup (13.1), rilevamento duplicati (3.2) e
      verifica d'integrità (24.2).
- [ ] **Politica cartella allegati** (configurabile, §11.1) e riferimenti
      aggiornati su rinomina/spostamento, come già si fa per i wikilink.
- [ ] **Thumbnail/cache derivate** in `.fubmd-data/` (mai autorevoli).

### 14.2 Nessun metadato di entry: né mtime, né dimensione, né impronta

*ex §2.20 · kernel · **P2** — il `VaultEntry` esteso ai **documenti***

- [ ] **`DocMeta` tiene id, frontmatter, outline e link** (`workspace.rs:125-130`)
      e il `Vault` non espone uno `stat`. Quindi `reindex` **rilegge e riparsa
      l'intero vault a ogni apertura** (`workspace.rs:341-351`): «un indice
      persistente riconosce e salta gli immutati» è vero per l'indice, non per
      il kernel, che paga comunque lettura + parse di tutto prima ancora di
      chiedere all'indice se gli interessa.
- [ ] **Ed è la fonte che manca a un elenco di feature che sembrano
      indipendenti**: apertura rapida di vault grandi ed enormi (24.1),
      rilevamento duplicati e deduplicazione (3.2, 13.1), sync differenziale
      (18.1), verifica d'integrità, checksum e corruption detection (2.1,
      24.2), «stale notes» (7.2, 9.3) e — le più banali e le più visibili —
      «note create di recente» e «note modificate di recente» (8.1), che oggi
      **non hanno alcuna fonte nel kernel**.
- [ ] È il `VaultEntry` del §14.1 esteso ai **documenti**, non solo agli asset:
      le due voci sono lo stesso lavoro e vanno fatte insieme, come §14.3 e
      §14.4.

### 14.3 Le cartelle non esistono nel kernel

*ex §2.11 · kernel · **P2** — stesso lavoro della 14.4; sblocca `create_folder`, tenuto fuori da 0013*

- [ ] **La cartella come cittadino**: `metas` è una mappa piatta
      (`workspace.rs:163`) e l'albero vive solo in `organizer.ts::buildTree`.
      È anche la ragione per cui la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha lasciato `create_folder` **fuori**
      dall'`HostApi`: una capacità che creasse una directory vuota produrrebbe
      qualcosa che nessun'altra capacità vede — `list_documents` non la mostra,
      nessun evento la annuncia, nessuna query la interroga. Quando questa voce
      darà alle cartelle un modello, la capacità sarà additiva.
      Quindi non si può creare una cartella vuota (le directory nascono per
      effetto collaterale di `Vault::write`), rinominarne una sarebbe N rename
      senza atomicità ([decisione 0011](../decisions/0011-il-lotto.md)) e senza un `FolderRenamed`, e icone/ordinamenti di
      cartella nel sidecar non li migra nessuno — `migrateMeta` (`main.ts:638`)
      gestisce i soli documenti.

*Sblocca:* 3.2 (crea/rinomina/sposta cartella, drag & drop), 8.2 (folder-level
metadata, inherited metadata), 8.3 (cartella default per tipo nota, regole di
auto-spostamento), 6.2 (CSS per cartella), 11.3 (database da cartella), 19.2
(permessi per cartella).

### 14.4 Il canale della lista documenti

*ex §2.13 · kernel · **P2** — il canale più usato dell'app, e l'unico fuori da `IndexQuery`*

- [ ] **`list_documents` non è nel contratto e non scala**: restituisce
      `Vec<String>` con **tutto** il vault, ricostruito e riordinato a ogni
      chiamata (`workspace.rs:380`), e la shell ne ricostruisce l'albero intero a
      ogni `index_updated`. È il canale più usato dell'app e l'unico fuori da
      `IndexQuery`: la paginazione della [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) non lo tocca, la virtualizzazione del
      §2.9 mitiga il disegno ma non il trasferimento. Va ripensato per-cartella e
      paginato, insieme al §14.1 (`VaultEntry`) e al §14.3.
