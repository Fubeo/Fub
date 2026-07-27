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
- [ ] **Non ce l'hanno i due che scrivono JSON nudo**: il sidecar del cestino
      (`vault.rs`, un `serde_json::to_string` senza campo di versione) e
      `.fubmd/workspace.json` (§11.3). E non l'avranno per imitazione — di quale
      dei due precedenti? — impostazioni, allegati, canvas e database: dati
      **autorevoli**, che se non si leggono non si ricostruiscono. Costa un campo
      per formato oggi; domani è un formato da indovinare a valle di una
      segnalazione utente.

*Sblocca:* 27.4 (upgrade migration test), 2.1 (corruption detection), 24.2
(vault repair, checksum verification).

### 15.4 I dati persistiti non hanno né una mappa né una classe

*ex §2.29 · kernel · **P0** — è P0 la **scelta della forma**, non il parametro; la metà documentale è P2*

- [ ] **Quattro posti, quattro discipline diverse, nessun documento che li
      elenchi**: `<vault>/.fubmd/workspace.json` (autorevole, scritto dall'app
      con `std::fs` — è il §11.3), `.fubmd-data/plugins/<id>/` (assegnato dal
      kernel, recintato dalla firma), `.fubmd-data/index/` (derivato),
      `<vault>/.trash/`. E stanno per arrivarne almeno otto: configurazione
      globale e profili (§11.1, cap. 28), temi e snippet (6.2), plugin installati
      (20.2), journal (§15.2), thumbnail e cache derivate (§14.1), crash buffer
      (§15.2), backup (18.2), layout salvati (§11.2).
- [ ] **Il punto nuovo non è dove stanno: è che `data_*` non dichiara se ciò che
      scrive è derivato o autorevole.** Gli snapshot del versioning non si
      ricostruiscono da niente e vivono sotto `.fubmd-data/`, che il codice
      descrive come dati derivati (`host/records.rs`: «A differenza di
      `.fubmd-data` questi dati sono autorevoli»). Oggi non fa danno perché
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
      servono cinque, e come **codice** quando serve come dato per-vault (§11.1).
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
      esito consultabile. Il §8.3 sposta il lavoro fuori dal lock; questa dice
      che il lavoro deve poter **fallire in parte**.
