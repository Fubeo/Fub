# 15. Il disco: storage, durabilità, politiche

Una **seduta** della [roadmap infrastrutturale](../todo.md): il supporto, e le politiche di cosa ci finisce sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Cinque voci sul supporto e due sulle politiche di cosa ci finisce sopra. Della
15.4 è **P0** la *decisione*, non l'implementazione: un dato persistito si può
classificare in tre forme — un parametro su `data_write`, un campo di manifest,
due radici distinte per plugin — e solo la prima è un ritaglio della linea di
base oggi e una major dopo il freeze. Le altre due sono additive. Ciò che scade
col freeze è **scegliere fra le tre**, perché dopo non si prendono più tutte. Il
resto è P2, con un'avvertenza dal piano: la **versione di schema** (15.3) costa
un campo adesso e un formato da indovinare dopo, quindi conviene anticiparla a
ogni formato che nasce, invece di aspettare il suo turno.

E un avvertimento di lessico, perché la seduta contiene due assi diversi che si
chiamano facilmente allo stesso modo: la **durabilità** è fsync e scrittura
atomica, ed è la 15.2; la **classe** di un dato è «si può buttare o no», ed è la
15.4. Chiamarle entrambe *durability* è l'errore che questa seduta deve evitare,
non commettere.

La 15.7 sta qui e non fra i presidi perché è la stessa domanda della durabilità
vista all'apertura invece che alla scrittura: la verità non si rifiuta di aprire,
si apre segnalando cosa non ha letto.

### 15.1 Astrazione sullo storage

*ex §2.1 · kernel · **P2** — sblocca cifratura, sync e PWA in un colpo solo; **non** è una voce sui test*

- [ ] **`trait VaultStorage`** (list, read, write atomico, rename, remove, stat,
      exists) con impl `FsStorage` di default; `Vault` e lo spazio dati dei
      plugin (`DocumentStore::plugin_data_root` in `documents.rs` per la radice,
      i `data_*` in `host/kernel.rs` e `host/read.rs`, più `collect_data_files`
      in `workspace.rs`) ci passano sopra invece di chiamare `std::fs`.
- [ ] **Un `MemStorage`, ma non come banco di prova dei test e2e.** Il movente
      «oggi ogni test e2e tocca il disco» era scritto qui e va tolto, perché
      **lavora contro il §15.2**: tutto il punto del §15.2 è temp+rename+fsync
      sulla directory, cioè durabilità che esiste solo su un filesystem vero. Un
      `MemStorage` per costruzione non la modella, quindi una suite spostata
      sopra di lui smetterebbe di esercitare **esattamente** la proprietà che il
      §15.2 esiste per aggiungere — e il presidio della durabilità diventerebbe
      verde su un supporto che non ha durabilità. Il `MemStorage` serve come
      **seconda impl** che tiene onesto il trait (un'astrazione con un solo
      cliente non è un'astrazione) e per i test *unitari* di chi ci sta sopra;
      i test di durabilità restano su `FsStorage`, e il banco condiviso è un
      altro problema — è il [§16.2](16-crate-sdk-banchi-di-prova.md#162-il-banco-di-prova-del-kernel-è-copiato-diciotto-volte).

*Sblocca, in un colpo solo:* 23.1 (cifratura at-rest = uno storage che cifra),
18.1 (vault remoti/sync), 26.3 (PWA su OPFS), 3.1 (vault read-only, vault su
network share), 2.3 (drive rimovibili).

### 15.2 Durabilità e recovery

*ex §2.5 · kernel · **P2** — il journal è il meccanismo di 13.3 e dell'audit trail di 0010*

- [ ] **Scrittura atomica vera**: `Vault::write` è `std::fs::write`
      (`vault.rs`) — un crash a metà lascia un file troncato. Serve
      temp+rename+fsync sulla directory. (Il test `write_atomicity` presidia
      un'altra cosa: l'ordine parse→scrittura.)
- [ ] **Due processi sulla stessa cartella di configurazione si cancellano le
      chiavi a vicenda.** `write_atomic` ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md))
      è l'atomicità di *un file*, non di un *aggiornamento*: chi la chiama
      compone il contenuto intero dalla propria copia in memoria, quindi la
      seconda installazione che salva atterra un file integro **senza** le chiavi
      che la prima aveva scritto dopo che lei aveva letto. Vale per i tre file
      della macchina (`settings.json`, `vaults.json`, `view-state.json`); dentro
      un processo il caso non esiste, perché il livello macchina è uno
      (`Arc<MachineSettings>`) e il sidecar si scrive per chiave
      ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)). È la stessa
      *lost update* che quelle due voci hanno chiuso un piano più in basso, ed è
      qui perché la risposta è di questo strato: un lock del file, o una
      rilettura sotto lock prima di ricomporre. Non è P0 — non scade col freeze e
      non tocca nessuna firma — ma è un dato **autorevole** che si perde in
      silenzio, che è il criterio della [seduta 20](20-quando-qualcosa-va-storto.md).
- [ ] **Buffer di crash / autosave recovery**: il buffer sporco dell'editor deve
      sopravvivere a un crash (2.1, 24.2).
- [ ] **Journal delle mutazioni** (append-only in `.fubmd-data/`): base di
      rollback dell'import (17.3), undo delle automazioni (16.3), audit (23.3).
- [ ] **Comandi di manutenzione**: `rebuild_index`, `vault_health`,
      `diagnostic_bundle`, `repair` — come `CommandProvider` ([decisione 0009](../decisions/0009-registro-dei-comandi.md)), non come
      comandi Tauri.

### 15.3 Una versione di schema su ogni formato persistito

*ex §2.12 · kernel · **P2** — da anticipare a **ogni formato che nasce***

- [ ] **Ce l'hanno due formati, e uno dei due è il precedente da imitare.** Il
      `SearchIndex` (`search.rs`) con la regola giusta ("versione diversa →
      butto e ricostruisco"), ma quello è **derivato**: buttarlo è gratis. Lo
      store del versioning ce l'ha pure (`versioning.rs`, campo nel manifest e
      controllo al caricamento) ed è **autorevole** — quindi la disciplina esiste già
      in repo, applicata al caso difficile. Non è un buco: è il modello.
- [ ] **Non ce l'ha chi scrive JSON nudo**: il sidecar del cestino
      (`vault.rs`, un `serde_json::to_string` senza campo di versione). Erano
      due: `.fubmd/workspace.json` ce l'ha dal §11.3
      ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)), insieme alla
      scrittura atomica e al rifiuto di sovrascrivere ciò che non si è letto —
      quindi il modello adesso ha tre esempi e questa voce ne ha uno solo da
      raggiungere. **Quattro**, da quando esiste l'anagrafe
      ([0046](../decisions/0046-l-anagrafe-del-vault.md)):
      `.fubmd-data/entries.json` nasce col campo di versione, e non perché serva
      a migrare — un derivato non si migra, si rifà — ma perché senza un numero
      in testa la versione dopo dovrebbe *indovinare* che un file senza campo
      viene da prima. È l'avvertenza di questa seduta applicata: la versione si
      anticipa a ogni formato che nasce, invece di aspettare il turno della
      voce. E non l'avranno per imitazione — di quale
      dei precedenti? — allegati, canvas e database: dati
      **autorevoli**, che se non si leggono non si ricostruiscono. Costa un campo
      per formato oggi; domani è un formato da indovinare a valle di una
      segnalazione utente.

*Sblocca:* 27.4 (upgrade migration test), 2.1 (corruption detection), 24.2
(vault repair, checksum verification).

### 15.4 I dati persistiti non hanno né una mappa né una classe

*ex §2.29 · kernel · **P0** — è P0 la **scelta della forma**, non il parametro; la metà documentale è P2*

- [ ] **Quattro posti, quattro discipline diverse, nessun documento che li
      elenchi**: `<vault>/.fubmd/workspace.json` (autorevole, e dal §11.3
      scritto dal **kernel** con la disciplina degli altri suoi file),
      `.fubmd-data/plugins/<id>/` (assegnato dal
      kernel, recintato dalla firma), `.fubmd-data/index/` (derivato),
      `<vault>/.trash/`. E ne stavano per arrivare almeno otto: i primi tre sono
      **arrivati** con la
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) —
      `<vault>/.fubmd/settings.json` (autorevole, viaggia col vault) e, nella
      cartella di configurazione della macchina, `settings.json` e `vaults.json`
      (il registro dei vault). Sono anche i primi che nascono con la disciplina
      invece che senza: versione di schema in testa al file e scrittura atomica
      (`fubmd_kernel::settings::write_atomic`). Restano da arrivare temi e
      snippet (6.2), plugin installati (20.2), journal (§15.2), thumbnail e cache
      derivate (§14.1), crash buffer (§15.2), backup (18.2), layout salvati
      (§11.2) — e restano da mettere in fila con i primi quattro, che è la voce.
      Nel frattempo ne è arrivato un altro, `.fubmd-data/entries.json`
      ([0046](../decisions/0046-l-anagrafe-del-vault.md)), ed è il caso che mostra
      **perché** questa voce serve: è **derivato** — illeggibile si butta e si
      ricostruisce, all'opposto del sidecar dell'organizzazione che si rifiuta di
      sovrascrivere ciò che non ha potuto leggere — e la classe è scritta **in
      prosa in testa al modulo**, dedotta dalla radice in cui il file sta.
      Finché la classe non è dicibile nel contratto, ogni posto nuovo la ripete a
      parole e chi arriva dopo la deduce per imitazione: che è esattamente ciò
      che questa voce esiste per togliere.
- [ ] **Il punto nuovo non è dove stanno: è che `data_*` non dichiara se ciò che
      scrive è derivato o autorevole.** Gli snapshot del versioning non si
      ricostruiscono da niente e vivono sotto `.fubmd-data/`, che il codice
      descrive come dati derivati (`abi/organization.rs`: «Un `.fubmd-data/` si
      può cancellare e si rifà con una scansione; questo no»). Oggi non fa danno perché
      nessuno ha ancora scritto il codice che agisce su quella distinzione;
      domani la stessa distinzione la chiedono, ognuno per conto proprio,
      «ricostruisci i dati derivati» (24.2), «cosa entra nel backup» (18.2),
      «cosa si esclude dal sync» (18.1), «cosa si porta dietro un vault che si
      copia» (2.2) e «cosa si cancella per liberare spazio» (3.1). Cinque
      risposte indovinate, e la peggiore cancella la cronologia.
- [ ] **Il nome «durabilità» designa un'altra cosa, e va scartato prima di
      scegliere la forma**: la durabilità è fsync e scrittura atomica, ed è il
      **§15.2**, due voci più su nella stessa seduta. Qui si classifica il dato —
      derivato o autorevole, cioè buttabile o no — che è un asse diverso e
      ortogonale (un dato derivato può volere una scrittura atomica, un dato
      autorevole può accontentarsi di meno). Un nome solo per due assi dentro la
      stessa seduta si sbaglia al primo lettore: `DataClass`, `Persistence` o
      `Recoverability`, non `Durability`.
- [ ] **E la classe è proprietà del path, non della singola scrittura.** Con
      `data_write(path, bytes, class)` la stessa chiave si può dichiarare
      derivata a una scrittura e autorevole a quella dopo — il contratto
      permetterebbe di contraddirsi — e ogni chiamante ripete a ogni chiamata un
      tag che non cambia mai. Le forme che la dichiarano **una volta sola** sono
      due: per **prefisso nel manifest**, o **due radici** distinte per plugin
      (`data/` autorevole, `cache/` derivata, recintate dalla firma come già
      succede oggi). La seconda ha il pregio che la classe diventa
      inconfondibile: sbagliarla vuol dire scrivere nel posto sbagliato, non
      passare l'enum sbagliato.
- [ ] **Quindi è P0 la scelta, e le tre forme non costano lo stesso.** Il
      parametro su `data_write` (`abi/traits.rs`) è oggi un ritaglio della linea
      di base e dopo il freeze una major — quello sì scade. Il campo di manifest
      e la seconda radice sono **additivi**: `HostApi` la implementa l'host, non
      il guest, quindi una coppia `cache_read`/`cache_write` in più non rompe
      nessun plugin, e un campo di manifest nemmeno. Il che vuol dire che *se* la
      risposta è una delle ultime due, l'implementazione può seguire M3 senza
      costare niente; ma **decidere** resta P0, perché una delle tre dopo il
      freeze non si prende più, e sceglierla implicitamente non-scegliendo
      significa averla esclusa. È il gemello del §15.3 (la *versione* di uno
      schema) su un altro asse: quello dice come si legge un dato vecchio, questo
      se il dato si può buttare.
- [ ] **E prima ancora: le radici sono due, e una basterebbe.** Un vault oggi
      porta tre cartelle nostre — `<vault>/.fubmd/` (autorevole),
      `<vault>/.fubmd-data/` (derivato) e `<vault>/.trash/` — e la domanda,
      posta da fuori guardando un vault e non il codice, è perché mai debbano
      essere tre. La direzione preferita è **una radice sola**: `.fubmd/` con
      `.fubmd/data/` dentro. Va decisa **qui** e non come rinomina a parte, per
      una ragione precisa: oggi la classe di un dato si deduce da una cosa sola,
      la **radice in cui il file sta**, e spostare le radici senza dire cosa
      significano è togliere l'unico indizio esistente prima di aver messo
      quello vero.
      - *Perché la forma `.fubmd/data/` è compatibile con questa voce e un
        `.fubmd/` piatto no*: annidare conserva la deduzione per radice — solo
        un livello più in basso — e resta vera anche quando la classe diventerà
        esplicita, perché un path che dice già la classe non contraddice un
        manifest che la dichiara. Fondere tutto in un `.fubmd/` senza
        sottocartella, invece, la cancella e basta.
      - *L'argomento contrario, e perché pesa meno di quanto sembri*: due radici
        distinte rendono banale escludere i derivati da un backup o da un sync
        con una regola sola. Ma quella promessa **è già falsa**: gli snapshot del
        versioning non si ricostruiscono e stanno sotto `.fubmd-data/`, che è il
        difetto scritto due punti più su. Si perde una comodità che non c'era.
      - *Cosa costa davvero, misurato*: nel codice **una riga** — la costante
        `DATA_DIR` (`kernel/vault.rs`), da cui passa tutta la produzione — più
        nove `.join(".fubmd-data")` scritti a mano in sette file di test, che
        già oggi dovrebbero usare la costante. Il resto è prosa: una quarantina
        di menzioni fra commenti e documenti. Due presidi vanno toccati insieme:
        `.gitignore`, che **ignora già entrambe** le cartelle (una conferma che
        due sono di troppo), e il marcatore con cui `check-doc-links.mjs`
        riconosce un vault — che diventerebbe `.fubmd/` ed è un **miglioramento**,
        perché oggi un vault aperto e mai indicizzato non ha un `.fubmd-data/` e
        quindi non viene riconosciuto.
      - *Ciò che non si riscrive, e va detto una volta sola*: quattro verbali
        ([0025](../decisions/0025-la-ricerca-predefinita.md),
        [0038](../decisions/0038-il-kernel-possiede-il-sidecar.md),
        [0044](../decisions/0044-lo-stato-per-documento.md),
        [0046](../decisions/0046-l-anagrafe-del-vault.md)) e la linea di base
        congelata continueranno a dire `.fubmd-data/`, perché sono fotografie e
        non si toccano. Serve la stessa cura di [numerazione.md](numerazione.md)
        per i numeri vecchi: **un punto solo** che traduce, e non una nota
        ripetuta in venti file.
      - *E la migrazione non è gratis*: sotto `.fubmd-data/` non c'è solo
        l'indice. Ci sono gli snapshot del versioning e lo stato per-documento
        della [0044](../decisions/0044-lo-stato-per-documento.md), che non si
        rigenerano da niente. Un rename all'apertura, con la regola del rifiuto
        in avanti già in uso — non «se non c'è, si ricostruisce».
      - *Resta aperta una terza*: se `.trash/` debba entrare nella radice unica o
        restare fuori. È l'unica delle tre che l'utente apre di proposito, e un
        cestino che si trova è metà del suo valore.
- [ ] **La metà documentale**: `docs/architecture/on-disk-layout.md` come mappa
      unica — chi scrive dove, con quale disciplina, con quale classe, con quale
      versione di schema (§15.3) e con quale scrittura (atomica o no, §15.2). Non
      è burocrazia: oggi la risposta si ricostruisce leggendo quattro crate, e
      la prossima feature che deve scrivere qualcosa sceglierà il posto per
      imitazione dell'ultima che ha guardato.

*Sblocca:* 18.1-18.2 (cosa si sincronizza e cosa si salva), 24.2 (rebuild,
repair, diagnostic bundle), 2.2 e 3.1 (vault portabile, relocation), 28
(portable mode, config nella cartella vault o fuori).

### 15.5 Politica dei path e del testo, in un modulo solo

*ex §2.6 · kernel · **P2** — porta con sé sei regole nuove: nascano con la fixture della 6.2*

- [ ] **`path_policy`**: normalizzazione NFC (già fatta per i link, va estesa ai
      nomi), caratteri invalidi per OS, nomi riservati Windows (`CON`, `NUL`…),
      lunghezza massima, case-sensitivity, symlink, file nascosti. Sono ~15 voci
      di 2.3 che oggi non hanno un posto dove stare.
- [ ] **`text_policy`**: rilevamento encoding, BOM, CRLF/LF, enforcement UTF-8 —
      e un corpus di file ostili come test, sul modello di
      `docid_page_name_agrees_with_the_frontend_on_hostile_names`.

### 15.6 La politica di esclusione è una costante di compilazione

*ex §2.16 · kernel · **P2** — il gemello della 15.5 sul lato *quali file* invece che *quali nomi**

- [ ] **`IGNORED_DIRS` (`vault.rs`) è un `&[&str]` nel sorgente**, e la
      regola sta bene in un punto solo (`is_ignored_name`, usata da scansione e
      watcher). Il problema non è dove sta: è che è **una** politica quando ne
      servono cinque, e come **codice** quando serve come dato per-vault — che
      adesso ha dove stare: una chiave dichiarata, per-vault
      ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)).
- [ ] **Le cinque, tutte su uno stesso albero**: ignore configurabile e
      `.gitignore` (3.1), file nascosti visibili su richiesta (3.2), esclusione
      cartelle dalla ricerca (9.1), esclusione dal sync (18.1), esclusione dal
      contesto AI (23.2). Sono componibili e hanno scopi diversi: o nascono
      come un `IgnorePolicy` valutabile e parametrizzato per scopo, o ognuna
      verrà cablata dove capita, e "questa cartella è esclusa" significherà
      cinque cose diverse.
- [ ] È il gemello del §15.5 sul lato **quali file**, non **quali nomi**.

### 15.7 L'apertura del vault è tutto-o-niente, sincrona e senza ritorno

*ex §2.23 · kernel · **P1** — il lavoro deve poter **fallire in parte***

- [ ] **`reindex` fallisce l'intera apertura per un solo documento**: legge e
      parsa tutto con `?` su ogni passo (`kernel/workspace.rs`). Una
      nota illeggibile per i permessi, un file troncato da un crash, un
      documento che il parser rifiuta — e **il vault non si apre**. Il precedente
      giusto è nella stessa funzione, dieci righe sotto: il flush degli indici è
      già tollerato con un `let _ =`, perché «un indice è derivato, il vault è la
      verità». Read e parse sono i due passi rimasti fatali. È l'opposto
      di ciò che chiedono 2.1 (corruption detection), 24.2 (vault repair, health
      check) e del principio per cui il vault è la verità: la verità non si
      rifiuta di aprire, si apre segnalando cosa non ha letto.
- [ ] **E succede in una chiamata sola** (`Host::open`, `host/session.rs`, che
      l'IPC si limita a inoltrare): scansione, parse di ogni documento, grafo,
      riconciliazione e flush in una chiamata sincrona che ritorna un
      `VaultInfo`. Niente progresso, niente
      cancellazione, niente apertura parziale — «avvio rapido», «indexing
      progress», «supporto vault enormi» (24.1) non hanno dove attaccarsi.
- [ ] Le due cose vanno insieme e cambiano la **forma dell'apertura**: da
      funzione che ritorna un vault a operazione a fasi (vault utilizzabile →
      indicizzazione in corso → pronto) con errori raccolti per-documento e un
      esito consultabile. Chi sposta il lavoro fuori dal lock è la firma dei
      job — chiusa con la
      [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md) — col
      §9.3, il runner, chiuso dalla
      [0032](../decisions/0032-il-runner-dei-job.md) — il §8.3 ha messo il `RwLock`
      ([decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e
      ha misurato quanto costa tenercelo dentro: `reindex` tiene il workspace in
      esclusiva ~780 ms su 2000 note. Questa voce dice l'altra cosa ancora: che
      il lavoro deve poter **fallire in parte**.
