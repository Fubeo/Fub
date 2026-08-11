# 14. Le entry, le cartelle, e la lista dei documenti

Una **seduta** della [roadmap infrastrutturale](../todo.md). È lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Quattro voci formano lo stesso lavoro visto da lati diversi. Questo lavoro richiede un approccio a coppie per evitare di aggiungere due volte gli stessi campi alla stessa scansione:
- **§14.2 e §14.1**: Il `VaultEntry` si applica ai documenti e agli asset. Queste voci vanno fatte nella stessa passata.
- **§14.3 e §14.4**: Definiscono la cartella e il canale per leggerla. Sono lo stesso lavoro visto da due lati.

**La prima coppia è chiusa** dalla decisione [0046](../decisions/0046-l-anagrafe-del-vault.md). L'implementazione utilizza una singola scansione descritta in un verbale solo.
* **Esistenza**: Un file esiste indipendentemente dal parsing.
* **Metadati**: Il sistema registra dimensione e data di ogni file.
* **Ottimizzazione**: `reindex` **chiede agli indici cosa hanno già** prima di leggere e parsare.
* **Controllo di salute**: Questo cliente distingue un allegato presente da uno mancante, superando il silenzio passato su tutti i file.
* **Albero della shell (interfaccia utente)**: Questo cliente usa `IndexQuery::Entries` come sorgente dati.

**Anche la seconda è chiusa** dalla decisione [0047](../decisions/0047-la-cartella-esiste-nel-kernel.md).
* **Esistenza**: Una cartella esiste come riflesso del disco, incluse le cartelle vuote.
* **Lettura**: Il sistema interroga un livello per volta con `IndexQuery::Folders`. `IndexQuery::Entries` riceve una cartella in input.
* **Architettura IPC**: Il sistema delega l'elenco del vault (la directory di lavoro) a queste query, superando i vecchi comandi `list_documents` e `VaultInfo`.

Restano **tre** caselle aperte del §14.1. Hanno una milestone propria:
1. L'impronta degli allegati.
2. La politica della cartella allegati.
3. Le derivate in `.fub/data/`.

L'[indice](../todo.md) indicava queste caselle come due, prima di un ricalcolo. Questo aggiornamento estende l'applicazione della regola [§16.8](16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio) al piano.

### 14.1 Il vault (cartella di progetto) include documenti e asset

*ex §2.2 · kernel (il modulo core rust) · **P2** — **decisa** con la [0046](../decisions/0046-l-anagrafe-del-vault.md), restano tre caselle*

- [x] **Struttura `VaultEntry { id, kind: Document | Asset | Unknown, size, mtime }`**. Una scansione elabora **tutti** i file presenti, superando il limite delle estensioni registrate. La specie del file è calcolata a runtime in base ai provider attivi. L'estensione determina il tipo: un file `.canvas` diventa un documento appena il provider rivendica, mantenendo inalterato ogni singolo byte.
- [x] **Metadata degli asset**.
  - **Dimensione e data**: Questi valori sono disponibili per tutti.
  - **MIME type**: Il MIME costituisce una **regola** (`rules::media::mime_of`). Questo approccio usa la funzione pura del nome e sostituisce un campo fisso, evitando una copia soggetta a obsolescenza.
  - **Impronta (`fingerprint`)**: Il campo è di tipo `Option`. Il sistema lo calcola con i byte già in memoria, ottimizzando l'accesso a un file.
- [ ] **Job dell'impronta degli allegati**.
  - **Funzione**: Il job calcola l'impronta per deduplicazione (13.1), rilevamento duplicati (3.2) e verifica d'integrità (24.2).
  - **Stato**: Il campo esiste e l'infrastruttura asincrona è pronta ([0032](../decisions/0032-il-runner-dei-job.md)). L'esecuzione effettiva è in attesa di sviluppo.
  - **Cliente attuale**: La decisione [0099](../decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md) definisce un **cliente** attivo, oltre a tre usi futuri.
  - **Ricongiungimento**: L'app abbina i documenti rinominati esternamente tramite l'impronta. Al momento, un allegato rinominato a Fub (l'applicazione) chiuso perde il collegamento in attesa del calcolo dell'impronta.
  - **Vantaggio**: L'implementazione permetterà il ricongiungimento automatico, risparmiando la stesura di una riga di codice extra. Come riporta [todo.md](../todo.md): *un indirizzo abilita l'azione futura*.
- [ ] **Politica della cartella allegati**.
  - **Configurazione**: Il sistema usa una chiave dichiarata nel manifest del lettore ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)).
  - **Riferimenti dinamici**: I percorsi si aggiornano durante rinomine o spostamenti. Spostare `foto.png` in `allegati/` aggiorna automaticamente i formati `![[foto.png]]` e `![alt](../foto.png)`.
- [ ] **Thumbnail e cache derivate**. Questi file in `.fub/data/` fungono da dati temporanei. Attendono il componente grafico per il rendering.

### 14.2 Metadati di entry: mtime, dimensione, impronta

*ex §2.20 · kernel (il modulo core) · **P2** — **chiusa** con la [0046](../decisions/0046-l-anagrafe-del-vault.md)*

- [x] **Integrazione `DocMeta` e ottimizzazione letture**.
  - **Struttura base**: `DocMeta` conserva id, frontmatter, outline e link (`index/core.rs`).
  - **Stato precedente**: Il componente `Vault` limitava l'uso di uno `stat` alle sole voci del cestino (`vault.rs`). Questo costringeva il comando `reindex` a rileggere e parsare il vault (la directory di progetto) a ogni apertura (`workspace.rs`).
  - **Problema di efficienza**: Il principio teorico per cui un indice persistente salta i file immutati si applicava solo all'indice. Il kernel (core) eseguiva comunque lettura e parsing completi.
  - **Soluzione anagrafica**: L'API introduce `IndexProvider::up_to_date`. L'anagrafe risiede stabilmente in `.fub/data/entries.json` come cache scartabile in caso di errore.
  - **Euristiche di salto**: I parametri `mtime + size` autorizzano il salto dell'operazione, seguendo la regola *racily clean* di git. L'impronta agisce da validatore definitivo. Questo strumento riconosce mille file con timestamp aggiornati da un `git checkout`, verificando l'assenza di variazioni nei contenuti e confermandone la stabilità, elaborandoli uno alla volta.
- [x] **Abilitazione di nuove funzionalità**.
  - L'anagrafe fornisce la base dati per un elenco di funzionalità correlate:
    - **Apertura rapida**: Supporto per vault (directory di progetto) grandi ed enormi (24.1).
    - **Gestione duplicati**: Rilevamento e deduplicazione (3.2, 13.1).
    - **Sincronizzazione**: Sync differenziale (18.1).
    - **Sicurezza**: Verifica d'integrità, checksum e corruption detection (2.1, 24.2).
    - **Manutenzione**: Gestione delle «stale notes» (7.2, 9.3).
    - **Viste utente**: Liste delle «note create di recente» e «note modificate di recente» (8.1).
  - **Stato attuale**: L'implementazione di `IndexQuery::Entries` distribuisce il valore `mtime` per ogni file. Le funzionalità hanno a disposizione i dati necessari per lo sviluppo futuro.
- [x] **Estensione del `VaultEntry`**. Il tipo `VaultEntry` definito nel §14.1 si applica ora ai **documenti** e agli asset. Le due voci condividono la medesima base tecnica e richiedono un'implementazione congiunta, parallelamente a quanto avviene per §14.3 e §14.4.
