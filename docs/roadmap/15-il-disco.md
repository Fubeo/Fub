# 15. Il disco: storage, durabilità, politiche

Una **seduta** della [roadmap infrastrutturale](../todo.md): il supporto, e le politiche di cosa ci finisce sopra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Cinque voci sul supporto e due sulle politiche di cosa ci finisce sopra; **la
seduta è chiusa**, e le politiche sono cadute a coppia perché erano una domanda
sola guardata da due lati. La 15.5 è chiusa con la
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

Del **recovery** — l'altra metà — la prima delle tre caselle era stata chiusa
dalla
[0067](../decisions/0067-il-registro-di-cio-che-e-successo.md): il registro delle
mutazioni esiste, sta in `.fub/` perché la profondità dichiara la classe e un
registro non si rifà da niente, e non conserva il contenuto di prima ma
l'**inverso** — che è la [0045](../decisions/0045-l-undo-ha-due-pile.md) letta dal
disco. Il taglio della voce è quello che il suo titolo diceva già, ed è la terza
volta di fila che questa voce si è chiusa per pezzi senza che il criterio
cambiasse.

E le due restanti — il buffer di crash e i comandi di manutenzione — sono cadute
insieme con la [0088](../decisions/0088-cio-che-non-e-ancora-successo.md), che
**chiude la voce**. La lezione che vale oltre di lei è quella di metodo, ed è la
stessa del verbale precedente della roadmap: *una voce ferma va rimisurata prima
di essere eseguita*. Le due caselle erano scritte prima che esistessero il
supporto, la scrittura atomica e il journal, e rilette contro quel codice hanno
dato due esiti diversi. Il buffer di crash aveva la propria specifica **già
scritta altrove**: `journal.rs` dichiarava di non contenere il buffer sporco, e
quella frase diceva che le bozze sono il gemello del registro dall'altro verso —
l'uno conserva l'inverso e mai il testo di ciò che è successo, l'altro solo il
testo di ciò che non è ancora successo. I comandi di manutenzione invece
chiedevano una cosa **diventata impossibile nel modo in cui la chiedevano**: dei
quattro che elencavano, `vault_health` era nel frattempo diventato una query, che
è una terza forma che la casella non contemplava. Riformularla è costato una
domanda, ed è stata la mossa giusta: quella query non aveva **nessun lettore**,
e adesso ne ha uno.

La 15.7 sta qui e non fra i presidi perché è la stessa domanda della durabilità
vista all'apertura invece che alla scrittura: la verità non si rifiuta di aprire,
si apre segnalando cosa non ha letto. La sua **prima metà** è chiusa dalla
[0068](../decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md) — un
documento che non si legge o che il parser rifiuta non fa più fallire
l'apertura: finisce fra gli scarti di un'`Apertura`, che è la
[`Lettura`](../decisions/0067-il-registro-di-cio-che-e-successo.md) del registro
un piano più in su, coi nomi al posto del conto perché un documento ha un id e
una riga di journal rotta no. La **seconda** — la *forma* — è chiusa dalla
[0070](../decisions/0070-un-vault-si-apre-in-due-tempi.md): l'apertura si taglia
in due e la linea del taglio è la **scansione**, cioè la stessa riga con cui la
0068 aveva separato il fatale dal tollerato — *se il vault sappia ancora dire
quali documenti esistono* —, che separa allo stesso punto il sincrono dal
differito. La fase 2 è un **job** vero, quindi si racconta e si ferma dai pezzi
che c'erano già (0032, 0035), e `VaultStatus` guadagna il solo campo che serviva:
se ciò che l'indice risponde è tutto. **La voce è chiusa**, e le due metà non
erano scambiabili: la prima è il prerequisito della seconda. Di questa voce resta
fuori solo ciò che è di qualcun altro — se 512 documenti siano la fetta giusta lo
dirà il banco delle prestazioni del §17.1, che aspetta una macchina e non una
decisione.

E la 15.6 — l'ultima — è chiusa dalla
[0110](../decisions/0110-la-struttura-non-e-una-preferenza.md), che è la 0058
guardata dall'altro lato: quella diceva *quali nomi*, questa *quali file*. La
riga che vale oltre la voce è che le esclusioni sono **due specie** e non una
lista: `.fub/` e `.trash/` sono struttura — mostrarli è indicizzare l'indice e
riesumare il cestino — mentre `node_modules/` e i dotfile sono una preferenza di
chi possiede il vault. Tenerle insieme costava il peggio delle due, e a farlo
vedere è stato un presidio che questa voce rendeva falso senza toccarlo: il
temporaneo di una scrittura si nascondeva dietro il punto, cioè dietro il ramo
che un vault può adesso spegnere.

E la seduta si chiude su un fatto di cui vale la pena tenere il conto: **è la
quinta voce di fila che si chiude per pezzi**, e il criterio non è cambiato
nemmeno stavolta — anzi ne ha guadagnato un terzo, il taglio fra un
prerequisito e ciò che lo richiede, che sta in coda a
[decisions/README.md](../decisions/README.md).

### 15.2 Durabilità e recovery

*ex §2.5 · kernel · **P2** — **chiusa** con la [0088](../decisions/0088-cio-che-non-e-ancora-successo.md), in quattro tempi: la scrittura ([0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)), l'aggiornamento ([0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md)), il journal ([0067](../decisions/0067-il-registro-di-cio-che-e-successo.md)) e infine il buffer di crash con i comandi di manutenzione*

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
- [x] **Buffer di crash / autosave recovery**, chiuso dalla
      [0088](../decisions/0088-cio-che-non-e-ancora-successo.md): le bozze
      stanno in `.fub/drafts/`, **una per documento**, e sono il **gemello del
      journal dall'altro verso** — quello conserva l'inverso e mai il testo di
      ciò che è *successo*, queste conservano soltanto il testo di ciò che *non
      è ancora successo*. La specifica era già scritta in testa a `journal.rs`,
      che dichiarava di non contenere il buffer sporco. Profondità uno, cioè
      classe **autorevole** ([0048](../decisions/0048-una-radice-sola.md)): un
      testo mai salvato è per definizione l'unica copia, e `.fub/data/` lo
      avrebbe dichiarato buttabile. Lo stato di vista è scartato perché è la
      [0086](../decisions/0086-una-cronologia-e-la-sua-porta.md)
      **all'incontrario** — là decideva che il dato non deve viaggiare, qui che
      deve. Un file per bozza e non uno solo, o ogni autosave sarebbe stato un
      *aggiornamento* di un documento condiviso, cioè il difetto che la
      [0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md) aveva
      appena tolto; così invece ogni salvataggio è una **scrittura** e la
      atomicità arriva dal supporto senza scriverla due volte. La tensione di
      strato che la voce portava — dichiarata *kernel*, per metà lavoro di shell
      — è **nominata** e non risolta di straforo: *la shell decide quando una
      bozza esiste, il kernel decide cosa vuol dire tenerla*. La scrittura ha due
      porte IPC e non un comando del registro, e la capacità manca **per sempre**
      invece che «in attesa di un cliente»: il testo non salvato è il dato più
      privato di un vault. La lettura sta sul canale di tutti
      (`IndexQuery::Drafts`) e manda i **fatti** — `base`, `current`, `exists` —
      tacendo sul giudizio, perché *tenere il mio testo o quello sul disco* è una
      domanda che si fa a una persona. Una bozza **orfana** non si raccoglie: è
      l'unica copia rimasta.
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
- [x] **Comandi di manutenzione**, chiusi dalla
      [0088](../decisions/0088-cio-che-non-e-ancora-successo.md) — e la casella è
      stata **riformulata** prima di essere eseguita, perché uno dei quattro era
      già altrove e non nel posto sbagliato. `vault_health` è una `IndexQuery`
      che risponde `Paged<HealthIssue>`: la salute del vault **è una lettura**, e
      una lettura che risponde con dati non può essere un comando
      ([0013](../decisions/0013-elenco-delle-capacita.md)). Resta dov'è, e
      guadagna il suo primo lettore — il rapporto diagnostico — perché non ne
      aveva **nessuno**: era una porta aperta su una stanza dove non entrava
      nessuno. Gli altri tre sono mutazioni e sono comandi del registro
      ([0009](../decisions/0009-registro-dei-comandi.md)) con la regola che
      generalizza la [0086](../decisions/0086-una-cronologia-e-la-sua-porta.md):
      **la dichiarazione sta nel registro, l'esecuzione sta dove sta il potere**.
      Le `CommandSpec` passano dalla porta di tutti — ammesse, convalidate, con
      la loro chiave di scorciatoia — e a separarsi è solo chi le esegue, perché
      rifare l'indice non è una capacità da prestare a ogni plugin montato. Così
      i tre sono in palette, rimappabili e raggiungibili dalla CLI (27.1) senza
      che una capacità nuova compaia sul confine — che è il prezzo che la 0086
      aveva dovuto pagare. `vault.repair` **dice ciò che non ripara**, o avrebbe
      avuto lo stesso corpo di `vault.rebuild-index` con un altro nome.

### 15.3 Una versione di schema su ogni formato persistito

*ex §2.12 · kernel · **P2** — **chiusa** dalla [0106](../decisions/0106-un-formato-si-presenta.md): i formati versionati erano
**dieci** e non nove, l'undicesimo è il sidecar del cestino, e l'elenco che li
dichiara adesso lo riconta un presidio*

- [x] **Ce l'hanno due formati, e uno dei due è il precedente da imitare.** Il
      `SearchIndex` (`search.rs`) con la regola giusta ("versione diversa →
      butto e ricostruisco"), ma quello è **derivato**: buttarlo è gratis. Lo
      store del versioning ce l'ha pure (`versioning.rs`, campo nel manifest e
      controllo al caricamento) ed è **autorevole** — quindi la disciplina esiste già
      in repo, applicata al caso difficile. Non è un buco: è il modello.
- [x] **Non ce l'ha chi scrive JSON nudo**: il sidecar del cestino
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

*Sblocca:* 27.4 (upgrade migration test), 24.2 (vault repair, checksum
verification). La **corruption detection** (2.1) qui non c'entrava e non c'entra:
un numero di schema dice quale formato sono quei byte, non se quei byte sono
integri.

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

*ex §2.16 · kernel · **P2** — **chiusa dalla [0110](../decisions/0110-la-struttura-non-e-una-preferenza.md)**: ci sono due politiche di esclusione, non una — quella che l'utente dichiara (`files.excluded-folders`, `files.show-hidden`, per-vault) e quella che nessuno può dichiarare (`.fub/`, `.trash/`, il temporaneo di una scrittura), e finché erano una lista sola «escluso» voleva dire insieme *ciò che nessuno può cambiare* e *ciò che nessuno può scegliere*. Restano due caselle: leggere il `.gitignore`, e un modo di cambiare l'elenco delle cartelle escluse dall'app*

- [x] **`IGNORED_DIRS` (`vault.rs`) era un `&[&str]` nel sorgente**, e la voce
      aveva ragione sul dove e torto sul cosa: la costante era il sintomo. Quella
      lista metteva nella **stessa specie** due esclusioni che non si somigliano
      — la cartella di Fub e `node_modules` — e adesso sono due: `e_struttura`,
      che nessuna impostazione ribalta, e due chiavi dichiarate per-vault
      ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)). Un vault che
      non dichiara niente si comporta **esattamente** come prima.
- [x] **Le cinque, tutte su uno stesso albero**: ignore configurabile e
      `.gitignore` (3.1), file nascosti visibili su richiesta (3.2), esclusione
      cartelle dalla ricerca (9.1), esclusione dal sync (18.1), esclusione dal
      contesto AI (23.2). `IgnorePolicy` è il valutatore parametrico che tutte
      useranno — la lista e la risposta sui nascosti arrivano da chi chiede — e
      la riga che impedisce a «questa cartella è esclusa» di significare cinque
      cose diverse è scritta adesso che c'è la prima: **si compongono per
      sottrazione**, e nessuna può ridefinire cos'è la struttura. Il
      `.gitignore` resta **casella residua**: un file come sorgente di politica
      ha una sintassi propria, una precedenza propria e un proprietario che non
      è Fub.
- [x] **I symlink**, che arrivavano da qui, e la premessa era falsa: `std::fs`
      **non** li segue, perché dalla
      [0058](../decisions/0058-un-nome-che-nasce.md) la specie si chiede con
      `file_type()`. Ciò che mancava era che fosse **deciso** invece che
      *successo*. Decisione: non si seguono, e il verso opposto è scartato
      avendolo detto — seguirli vuole l'identità di un nodo (`dev`+`ino`), che
      il `VaultStorage` non ha di proposito (§15.1), e senza quella un anello di
      collegamenti è una camminata che non torna. Il presidio costruisce
      l'anello sul filesystem vero, perché quel difetto non fallisce: si pianta.
- [x] **L'altra metà dei file nascosti.** `files.show-hidden` mostra i dotfile
      che ci sono; [`NameFault::Hidden`](../decisions/0058-un-nome-che-nasce.md)
      continua a vietare di **crearne** uno, e l'asimmetria è voluta e adesso
      scritta in `path_policy`: la preferenza si ribalta in un clic, e le note
      create mentre era accesa resterebbero invisibili senza che nessuno le
      nomini. Il campo su una query di listing che la voce temeva prima del
      freeze **non serve**: la politica sta sul vault, quindi un plugin vede lo
      stesso vault che vede l'utente.
- [ ] **Casella residua, nata dal collaudo**: `files.excluded-folders` è una
      `SettingKind::List`, e la shell disegna le liste **in sola lettura** —
      chi le cambia è il comando che le scrive, e per questa chiave quel comando
      **non esiste**. È una preferenza per-vault che l'utente non può muovere
      dall'app, mentre la sua descrizione gli spiega da quando vale un
      cambiamento. Non è una svista da due righe: la chiave non è
      `program_writable` di proposito — un componente che aggiungesse una
      cartella toglierebbe dal vault le note che ci stanno dentro — quindi ciò
      che manca è un gesto **dell'utente** su una lista, cioè un pezzo di shell
      e la decisione su chi lo scrive. Vale per ogni `List` che nascerà, non
      solo per questa.
- [x] È il gemello del §15.5, chiuso dalla
      [0058](../decisions/0058-un-nome-che-nasce.md), sul lato **quali file** e
      non **quali nomi** — e il difetto peggiore stava **fuori**, in un presidio
      che questa voce stessa rendeva falso: il temporaneo di una scrittura era
      invisibile perché comincia per punto, cioè per il ramo che un vault può
      ora spegnere.
