# 15. Il disco: storage, durabilità, politiche

Una **seduta** della [roadmap infrastrutturale](../todo.md): il supporto, e le politiche di cosa ci finisce sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Cinque voci sul supporto e due sulle politiche di cosa ci finisce sopra; delle
politiche resta **una**, perché la 15.5 è chiusa con la
[0058](../decisions/0058-un-nome-che-nasce.md) — un nome che nasce e un nome che
c'è non si giudicano con la stessa regola, la sorgente di uno `Span` sono i byte
del file, e `text_policy` rileva senza convertire perché il catalogo (§2.4) chiede
fedeltà e non normalizzazione. La 15.4 era la P0 della seduta ed è **chiusa** con
la
[0048](../decisions/0048-una-radice-sola.md): dentro un vault la radice è una
sola (`.fub/`, coi derivati in `.fub/data/`), la mappa di chi scrive dove sta
in [architecture/on-disk-layout.md](../architecture/on-disk-layout.md), e delle
tre forme in cui la classe di un dato si può dichiarare è scelta la seconda
radice per plugin — additiva, quindi implementabile dopo M3. Ciò che scadeva col
freeze era **scegliere fra le tre**, perché il parametro su `data_write` dopo non
si sarebbe più preso. Il resto della seduta è P2, con un'avvertenza dal piano: la
**versione di schema** (15.3) costa un campo adesso e un formato da indovinare
dopo, quindi conviene anticiparla a ogni formato che nasce, invece di aspettare
il suo turno.

E un avvertimento di lessico, perché la seduta contiene due assi diversi che si
chiamano facilmente allo stesso modo: la **durabilità** è fsync e scrittura
atomica, ed è la 15.2; la **classe** di un dato è «si può buttare o no», ed è la
15.4. Chiamarle entrambe *durability* è l'errore che questa seduta deve evitare,
non commettere.

La 15.1 è chiusa con la [0064](../decisions/0064-il-supporto-sta-sotto.md): il
kernel tocca i byte di un vault da un posto solo — un `trait VaultStorage` con
`FsStorage` di default e un `MemStorage` che lo tiene onesto — e da lì passano il
vault, il cestino coi suoi sidecar e lo spazio dati dei plugin. Il trait è
**interno al kernel** e non tocca il contratto, e vale la pena ricordare perché:
la lettura esterna che voleva promuoverla a P0 aveva ragione sulla leva e torto
sulla scadenza — sono due assi, e [leva.md](leva.md) esiste per tenerli separati.

E l'ordine fra le due ha reso quel che prometteva. La 15.1 aveva lasciato una
casella indirizzata alla 15.2, e la
[0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) l'ha chiusa
insieme alla prima metà di questa voce: l'atomicità è **scesa dentro** il trait
invece di essere scritta due volte, che era la ragione per cui la 15.1 veniva
prima. La 15.2 resta aperta con l'altra metà, che non è la scrittura ma il
**recovery**: cosa si fa dopo.

Con la [0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md) la metà
*durabilità* è finita anche per l'unica riga che le restava e che recovery non
era: un **aggiornamento** dei tre file della macchina non è una scrittura, e
`update_atomic` rilegge sotto lock prima di comporre. Il prezzo non è stato il
lock — sono quattro righe — ma l'**MSRV**, salito a 1.89 perché
`std::fs::File::lock` è di lì: la voce ha pagato in una promessa verso chi
compila invece che in lavoro, ed è la ragione per cui la 0065 l'aveva chiamata
decisione e non casella.

Del **recovery** — l'altra metà, quella che resta — la prima delle tre caselle è
chiusa dalla
[0067](../decisions/0067-il-registro-di-cio-che-e-successo.md): il registro delle
mutazioni esiste, sta in `.fub/` perché la profondità dichiara la classe e un
registro non si rifà da niente, e non conserva il contenuto di prima ma
l'**inverso** — che è la [0045](../decisions/0045-l-undo-ha-due-pile.md) letta dal
disco. Il taglio della voce è quello che il suo titolo diceva già, ed è la terza
volta di fila che questa voce si chiude per pezzi senza che il criterio cambi: le
due restanti — il buffer di crash dell'editor e i comandi di manutenzione — sono
recovery come questa, e la seconda è un **cliente** del registro appena nato.

La 15.7 sta qui e non fra i presidi perché è la stessa domanda della durabilità
vista all'apertura invece che alla scrittura: la verità non si rifiuta di aprire,
si apre segnalando cosa non ha letto.

### 15.2 Durabilità e recovery

*ex §2.5 · kernel · **P2** — la **durabilità** è chiusa: la scrittura con la [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md), l'aggiornamento con la [0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md); del **recovery** è chiuso il journal con la [0067](../decisions/0067-il-registro-di-cio-che-e-successo.md), e restano **due** caselle: il buffer di crash e i comandi di manutenzione*

- [x] **Scrittura atomica vera**, chiusa dalla
      [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md): la promessa sta
      nella firma di `VaultStorage::write` — o ci sono questi byte o ci sono
      quelli di prima — e `FsStorage` la mantiene con temporaneo nascosto,
      `sync_all`, rename e fsync della cartella. Il prezzo che questa riga diceva
      di guardare prima di pagarlo è stato guardato, e pagato **tranne** nei due
      casi in cui l'inode non è solo nostro: su un symlink e su un file con più
      di un nome si scrive sul posto, perché lì la rename farebbe un danno certo
      e muto invece di uno raro e rumoroso. (Il test `write_atomicity` presidia
      un'altra cosa — l'ordine parse→scrittura — e non è stato toccato; i
      presidi di questa riga stanno in `kernel/tests/la_durabilita.rs`, su
      `FsStorage` soltanto.)
- [x] **Le tre righe di `.fub/`** — `workspace.json` (`organization.rs`),
      `settings.json` del vault (`settings.rs`) ed `entries.json`
      (`entries.rs`) — **sono salite sopra il supporto** con la stessa 0065, cioè
      nel momento in cui salirci non voleva più dire perdere l'atomicità che
      `write_atomic` gli dava. Era la casella residua della
      [0064](../decisions/0064-il-supporto-sta-sotto.md), ed è la prima che si
      chiude nella voce a cui era stata indirizzata. Con loro è salito un fatto
      che nessuno aveva scritto: dentro un workspace il supporto è **uno**, e lo
      condividono il vault e i tre store.
- [x] **Due processi sulla stessa cartella di configurazione si cancellano le
      chiavi a vicenda** — chiusa dalla
      [0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md):
      `update_atomic` rilegge sotto lock e fonde, e chi la chiama adotta lo stato
      fuso invece della propria copia. La riga che toglie la perdita è la
      **rilettura**; il lock — su un file accanto, perché la rename sostituisce
      l'inode — chiude la finestra che resta, ed è best-effort dove il filesystem
      non lo implementa. È costata l'**MSRV a 1.89**
      (`std::fs::File::lock`), preferito a una dipendenza in più: due promesse a
      due platee, e si è rotta quella a cui si può rispondere aggiornando la
      toolchain. Il difetto era l'atomicità di *un file* usata come atomicità di
      un *aggiornamento*
      ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)): dentro un
      processo non esisteva — il livello macchina è uno, e il sidecar si scrive
      per chiave ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)) —
      ed era un dato **autorevole** che si perdeva in silenzio, che è il criterio
      della [seduta 20](20-quando-qualcosa-va-storto.md). I tre file non
      perdevano la stessa cosa, e uno dei tre — `vaults.json` — non perdeva una
      traccia ma i **preferiti**.
- [ ] **Buffer di crash / autosave recovery**: il buffer sporco dell'editor deve
      sopravvivere a un crash (2.1, 24.2).
- [x] **Journal delle mutazioni**, chiuso dalla
      [0067](../decisions/0067-il-registro-di-cio-che-e-successo.md): una riga
      per mutazione del kernel in `.fub/journal.jsonl`, con la versione di schema
      **su ogni riga** e non in testa al file — un derivato di una versione ignota
      si butta, questo no, quindi sopravvive agli aggiornamenti e la versione dopo
      ci appende le proprie righe sotto. Il registro **non conserva il contenuto
      di prima, conserva l'inverso**: quello di una modifica chirurgica è nella
      riga ([0008](../decisions/0008-modifica-chirurgica.md)), quello delle quattro
      mutazioni strutturali si deduce, e la sola variante senza inverso — la
      riscrittura integrale, cioè il salvataggio dell'editor — è la riga che la
      [0045](../decisions/0045-l-undo-ha-due-pile.md) aveva già tenuto fuori dalla
      pila, e adesso lo **dichiara**. La riga di questa voce diceva
      `.fub/data/` ed era la classe sbagliata: la profondità la dichiara
      ([0048](../decisions/0048-una-radice-sola.md)), e un registro non si rifà da
      niente. È costato l'**ottava operazione** sul supporto (`append`), argomentata
      contro la frase in testa a `storage.rs` invece che scavalcandola, e la
      politica di potatura è **dichiarata**: diecimila record, si pota
      all'apertura, il taglio rispetta il confine di un lotto. Il rollback vero —
      import (17.3), automazioni (16.3), audit (23.3) e la **transazione atomica
      per operazione batch** del 22.4 — non è scritto, ed è di chi lo userà:
      quello che questa casella doveva rendere possibile è che sia **scrivibile**,
      e il lotto ([0011](../decisions/0011-il-lotto.md)) resta ciò che ne segna i
      confini senza esserne la transazione.
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
      due: `.fub/workspace.json` ce l'ha dal §11.3
      ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)), insieme alla
      scrittura atomica e al rifiuto di sovrascrivere ciò che non si è letto —
      quindi il modello adesso ha tre esempi e questa voce ne ha uno solo da
      raggiungere. **Quattro**, da quando esiste l'anagrafe
      ([0046](../decisions/0046-l-anagrafe-del-vault.md)):
      `.fub/data/entries.json` nasce col campo di versione, e non perché serva
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

*ex §2.29 · kernel · **P0** — **chiusa** con la [0048](../decisions/0048-una-radice-sola.md); resta una casella, che è additiva*

- [x] **Quattro posti, quattro discipline diverse, nessun documento che li
      elenchi.** Adesso il documento c'è ed è
      [architecture/on-disk-layout.md](../architecture/on-disk-layout.md): per
      ogni posto, chi lo scrive, con quale classe, con quale versione di schema
      (§15.3) e se la scrittura è atomica (§15.2). Ci sono anche le tre righe che
      contraddicono la regola, chiamate per nome — gli snapshot del versioning
      sotto la radice dei derivati, il sidecar del cestino che non è di nessuna
      delle due classi, e — quando quel documento è stato scritto — tutto ciò che
      passava da `data_write` senza atomicità: quella terza riga se n'è andata
      con la [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md), che ha
      dato l'atomicità a chiunque passi dal supporto.
      Erano quattro posti e ne stavano arrivando otto; i primi tre sono arrivati
      con la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) e un
      quarto con la [0046](../decisions/0046-l-anagrafe-del-vault.md), ognuno con
      la classe scritta **in prosa in testa al proprio modulo**. È la ripetizione
      che questa voce esisteva per togliere.
- [x] **Le radici erano due, e una basta**: una per l'autorevole e una, separata,
      per il derivato. Adesso è una — `.fub/`, coi derivati in `.fub/data/` — e
      la deduzione per radice resta vera un livello più in basso, che è la
      ragione per cui la forma è annidata e non piatta. Il rename all'apertura
      che portava avanti un vault scritto prima è vissuto fino al rename del
      progetto, e se n'è andato col nome che traduceva: fuori da questa macchina
      un vault di quella forma non è mai esistito. `.trash/` **resta fuori**,
      perché non è roba di Fub: è il cestino condiviso con Obsidian, e dentro ci
      sono file dell'utente.
- [x] **Il nome «durabilità» designa un'altra cosa, e va scartato prima di
      scegliere la forma**: la durabilità è fsync e scrittura atomica, ed è il
      **§15.2**, due voci più su nella stessa seduta. Qui si classifica il dato —
      derivato o autorevole, cioè buttabile o no — che è un asse diverso e
      ortogonale (un dato derivato può volere una scrittura atomica, un dato
      autorevole può accontentarsi di meno).
- [x] **La classe è proprietà del path, non della singola scrittura**, e delle
      tre forme è scelta la **seconda radice per plugin**: `data_*` resta la
      famiglia dell'autorevole e una `cache_*` porta il derivato. Con
      `data_write(path, bytes, class)` la stessa chiave si sarebbe potuta
      dichiarare derivata a una scrittura e autorevole a quella dopo, e ogni
      chiamante avrebbe ripetuto a ogni chiamata un tag che non cambia mai; col
      campo di manifest la dichiarazione sta lontano dalla scrittura e un
      prefisso sbagliato non fa rumore. Con due radici sbagliare la classe vuol
      dire scrivere nel posto sbagliato, non passare l'enum sbagliato — ed è la
      stessa regola che il layout applica un livello più in su.
- [ ] **Implementarla.** Due capacità in più su `HostApi` (`cache_read`,
      `cache_write`, più le compagne di `data_list`/`data_remove` se servono) e
      lo spazio autorevole di un plugin che sale di un livello, da
      `.fub/data/plugins/<id>/` a `.fub/plugins/<id>/`, con la stessa
      disciplina di rename della 0048. È **additiva** — `HostApi` la implementa
      l'host, non il guest — quindi non scade col freeze e può seguire M3; e va
      fatta **prima di M5**, perché finché i plugin sono i nostri otto gli
      inquilini di quello spazio si contano su una mano. I due che si muovono
      sono noti: gli snapshot del versioning salgono, l'indice di ricerca scende
      in `cache_*` e al peggio si ricostruisce.

*Sblocca:* 18.1-18.2 (cosa si sincronizza e cosa si salva), 24.2 (rebuild,
repair, diagnostic bundle), 2.2 e 3.1 (vault portabile, relocation), 28
(portable mode, config nella cartella vault o fuori).

### 15.6 La politica di esclusione è una costante di compilazione

*ex §2.16 · kernel · **P2** — il gemello della [0058](../decisions/0058-un-nome-che-nasce.md) sul lato *quali file* invece che *quali nomi**

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
- [ ] **I symlink**, che arrivano da qui. Erano nell'elenco del §15.5 e non sono
      una domanda sul *nome*: «seguire un symlink» è «questa voce di directory
      partecipa», cioè esattamente la domanda di questa voce. La
      [0058](../decisions/0058-un-nome-che-nasce.md) li ha consegnati qui invece
      di lasciarli come casella residua di una voce chiusa, perché un elenco che
      perde una riga senza darla a nessuno è il difetto del
      [§16.7](16-crate-sdk-banchi-di-prova.md). Da decidere insieme alle altre
      cinque: seguirli o no è una politica come le altre, e un `IgnorePolicy` che
      non li nomina lascerà il comportamento a `std::fs`, che li segue senza
      chiedere — con un ciclo di symlink la scansione non torna.
- [ ] **L'altra metà dei file nascosti.** Che una nota nuova non possa chiamarsi
      `.nota.md` è deciso ([`NameFault::Hidden`](../decisions/0058-un-nome-che-nasce.md));
      **mostrare** i dotfile che ci sono, su richiesta (3.2), è di qui. È la
      stessa stringa (`is_ignored_name`) letta per due domande diverse.
- [ ] È il gemello del §15.5, chiuso dalla
      [0058](../decisions/0058-un-nome-che-nasce.md), sul lato **quali file** e
      non **quali nomi**.

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
