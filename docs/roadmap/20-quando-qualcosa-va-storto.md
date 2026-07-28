# 20. Quando qualcosa va storto, chi lo dice e a chi

Una **seduta** della [roadmap infrastrutturale](../todo.md): il canale che dice cosa è andato storto, visto da chi non può dirlo, da chi lo butta via e da chi non ha dove scriverlo.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il settimo giro ha fatto una domanda che i primi sei non avevano fatto: **cosa
fallisce senza produrre nessun segnale** — né per un test, né per un log, né per
l'utente, finché il danno non è già fatto. Le quattro voci qui sotto sono la
risposta, e stanno insieme perché sono lo stesso percorso interrotto in tre
punti diversi: chi ha visto il problema **non può dirlo** (la firma non
restituisce niente, §20.1), chi lo dice trova un ascoltatore che **lo butta
via** (§20.3), e chi lo ascolta non ha **dove scriverlo** perché nel contratto
la variante non c'è (§20.2) e nella shell la superficie non c'è (§20.4).
Decidere una metà sola dà un canale senza destinazione o una destinazione senza
niente da metterci dentro.

**Il progetto ha già l'invariante, e la presidia su un canale solo.**
[traits.md](../architecture/traits.md) lo scrive per esteso a proposito
dell'`Event::Overflow`: *«è la versione rumorosa del troncamento: perdite
silenziose non esistono per contratto»*. È vero, ed è vero soltanto lì. Sulla
coda eventi il troncamento è rumoroso; su ogni altro canale del contratto la
perdita è o **indicibile** (§20.1) o **scartata** (§20.3) o **detta a uno stream
che in un'app impacchettata nessuno legge** (§20.4). Questa seduta non introduce
un principio nuovo: estende ai tre canali rimasti quello che il contratto
dichiara già di garantire su uno.

Il fatto strutturale, e la ragione per cui sette giri non le hanno trovate: di
queste quattro voci **una sola scade col freeze**. Le altre tre non sono firme,
quindi nessun criterio di scadenza le ha mai messe in cima — e intanto il loro
costo non si paga a M4, si sta pagando adesso, in difetti che non si diagnosticano.
È il criterio di [seduta 17](17-presidi-che-restano.md) applicato al contrario: qui il costo
dell'attesa non cresce, è già massimo.

### 20.1 L'alimentazione dell'indice non ha un esito, e un indice che perde un documento non ha modo di dirlo

*settimo giro · contratto · **P0** — leva alta: **rende inesprimibile**, ed è una firma che il freeze congela*

- [ ] **Tre metodi su cinque di `IndexProvider` restituiscono `()`**:
      `on_document_indexed`, `on_document_removed` e `reconcile`
      (`abi/traits.rs`). Gli altri due — `activate` e `flush`
      (stesso file) — restituiscono `Result`. L'asimmetria è dentro lo stesso
      trait, e cade esattamente sui tre metodi da cui passa **tutto il dato**:
      il ciclo di vita può fallire e dirlo, l'alimentazione no.
- [ ] **Non è teorico, ed è già scritto in repo con il suo commento.**
      `SearchIndex::on_document_indexed` (`features/src/search.rs`):

      if inner.writer.add_document(td).is_err() {
          // Il writer è andato: l'indice non è più affidabile, e mentire è
          // peggio che perdere il documento. Si dimentica l'impronta, così
          // il prossimo passaggio riproverà.
          inner.fingerprints.remove(&doc.id);
          return;
      }

      Il provider **sa** di avere perso il documento, scrive che mentire è
      peggio, e poi non ha nessuno a cui dirlo: la firma non gli lascia un
      valore di ritorno. Il ripiego — dimenticare l'impronta — funziona solo
      alla riapertura del vault, perché `reindex` è l'unico percorso che
      rialimenta un documento **immutato** (`kernel/workspace.rs`). Per
      tutta la sessione corrente quella nota non c'è nella ricerca, e «nessun
      risultato» è indistinguibile da «nessuna corrispondenza».
- [ ] **Contraddice una promessa scritta due volte.**
      [PIANO.md](../PIANO.md) motiva così la scelta di alimentare gli indici dal
      kernel invece che dagli eventi: *«un indice che perde un aggiornamento non
      tace: risponde sbagliato, in silenzio. La coda eventi ha un budget e può
      troncare, questo canale no»*; [traits.md](../architecture/traits.md) lo
      ripete quasi parola per parola. L'argomento è giusto e la conclusione è
      mezza: il **canale** non tronca, ma il **destinatario** può rifiutare, e la
      firma rende quel rifiuto indicibile. È la forma della
      [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) e della
      [0019](../decisions/0019-il-canale-dati.md) — una promessa che vale a metà, in silenzio — applicata
      al punto in cui il piano dichiarava di averla già mantenuta.
- [ ] **Il conto è già cresciuto.** Non c'è più un solo `IndexProvider` in
      produzione: con la [decisione 0019](../decisions/0019-il-canale-dati.md) lo
      sono anche le risposte del kernel (grafo, proprietà, outline, tag, salute
      del vault), quindi da questa firma passa **tutto il canale dati** e non
      solo il full-text. La voce non è cambiata di forma — è cambiata di
      **portata**, e in peggio: adesso un'alimentazione che fallisce in silenzio
      può falsare anche ciò di cui il kernel è l'unica fonte.
- [ ] La forma da decidere ora, e non è ovvia: un `Result<(), PluginError>` su
      ognuno dei tre (semplice, ma obbliga il kernel a decidere cosa fare di un
      errore per-documento in mezzo a `reindex`, che è il §15.7), oppure un
      esito **cumulativo** raccolto dal `flush` che c'è già — l'unico punto in
      cui l'indice sa se ciò che ha accettato è davvero durevole. La seconda è
      più piccola e dice meno: non nomina *quale* documento. Chi la sceglie deve
      dire come si nomina il documento perso, perché «l'indice ha perso qualcosa»
      senza un `DocId` non fa agire nessuno.

*Sblocca:* 9.1 (ricerca, ~74 voci) e 9.2 nel senso stretto che oggi possono
mentire; e ogni indice futuro — 22.1 (semantico e vettoriale), 10 (indice dei
task), 11 (database), 15.1 (citazioni), 8.2 (proprietà calcolate e rollup) —
che nascerebbe con lo stesso buco — e, dalla
[decisione 0019](../decisions/0019-il-canale-dati.md), anche le risposte del
kernel.

### 20.2 Ciò che va storto ha un canale nel contratto e nessuna destinazione

*settimo giro · contratto · **P1** — additiva, quindi non scade: è la ragione per cui rischia di non farsi mai*

- [ ] **La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha già deciso la forma, e ha rimandato per mancanza di
      clienti.** La regola messa a verbale è netta — *«una capacità è ciò di cui
      il chiamante ha bisogno della risposta per proseguire; ciò che si limita a
      informare è un evento»* — e la conclusione era: `notify` e `progress`
      saranno varianti di `Event`, *«non sono state aggiunte in questo giro
      perché non hanno un cliente»*. Questa voce non riapre la decisione: porta
      **il cliente**, che è la condizione che il verbale stesso aveva posto
      (*«quando arriveranno, arriveranno come Event, ed è additivo»*).
- [ ] **I clienti ci sono già, e sono scritti.** Venticinque `eprintln!` nel
      backend, ognuno su un fatto che l'utente ha diritto di sapere e non saprà:
      indice di ricerca non disponibile e versioning non disponibile
      (`host/mount.rs`), flush dell'indice fallito ed errore del watcher
      (`host/watcher.rs`), sidecar del cestino non scritto
      (`kernel/vault.rs` — cioè: **il ripristino di quella nota tornerà nel
      posto sbagliato**), versione non salvata, nota illeggibile, tombstone non
      scritto, potatura fallita, indice del versioning ricostruito
      (`features/src/versioning.rs`). In un'app impacchettata **stderr non ha
      un lettore**: lo dice la shell stessa, nel commento che protegge l'unico
      caso in cui si è posto il problema (`frontend/src/main.ts`, in coda, «la
      console della webview, che in un'app impacchettata non si apre»).
- [ ] **Due commenti nel kernel rimandano tutti e due alla stessa cosa che non
      esiste** (`workspace.rs`): «gli errori di flush non fanno fallire
      l'apertura del vault: un indice è stato *derivato*, il vault è la verità
      (M4: notifica)» in `reindex`, e «l'errore di un handler non deve far
      fallire l'operazione che ha emesso l'evento: si ignora (M4:
      log/notifica)» in `deliver_to_handlers`. Il terzo posto che nomina lo
      stesso canale mancante è il doc di `flush_indexes` — *«perché chi ha un
      canale di notifica possa mostrarli»* — ed è la voce §20.3 qui sotto. Non è
      un debito ignoto: è un debito **nominato tre volte** che aspetta una
      decisione già presa e mai implementata.
- [ ] **Il payload è in comune con il §12.2, e va deciso lì.** Qualunque
      variante porti «cosa è andato storto» porta un `PluginError`, che oggi è
      prosa italiana composta. Un avviso che l'utente deve leggere e una shell
      che deve decidere se mostrarlo hanno bisogno di un codice e di parametri,
      non di una frase: **§12.2 e questa voce hanno lo stesso tipo dentro**, e
      quella è P0 mentre questa no.
- [ ] Da decidere insieme, e nella stessa seduta perché sono lo stesso record:
      la **severità** (avviso o guasto: un flush fallito e una versione non
      salvata non chiedono la stessa cosa a chi legge), il **soggetto** (quale
      documento, quale plugin — l'`Origin` c'è già e porta l'attore), e se
      `progress` sia la stessa variante con un contatore o una seconda.
      **Le ultime due domande hanno già risposta**, e la porta la
      [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md): il progresso è
      una variante **sua** (`job-progress`, col suo record `job-progress { done,
      total, label }`), perché parla di un lavoro che ha un'identità e una fine,
      mentre un avviso parla di un fatto e basta; e il suo consumatore — il
      centro attività del §10.3 — c'è ed è vivo. Resta quindi la sola prima
      metà: severità e soggetto di **ciò che va storto**, con dentro il tipo del
      §12.2. Il posto dove atterrerà, invece, adesso esiste: il centro notifiche
      ha storico, raggruppamento e tono, e aspetta solo di essere alimentato da
      un evento invece che da venti chiamanti della shell.

*Sblocca:* 10.5 (notification center, alert stale notes / broken links / sync
errors / backup errors / plugin errors — ~28 voci che oggi non hanno una
sorgente), 24.2 (error reporting chiaro, diagnostica), 16.3 (automation error
handling, retries, notifications), 18.1 (errori di sync dettagliati, stato sync
visibile), 20.2 (log plugin).

### 20.3 Il kernel butta via gli esiti che ha già in mano

*settimo giro · kernel · **P1** — non è una firma: il canale c'è, ed è il kernel a scartarlo*

- [ ] **`let _ = handler.handle(notice, &mut host);`** (`workspace.rs`,
      `deliver_to_handlers`).
      `EventHandler::handle` restituisce `Result<(), PluginError>`
      (`abi/traits.rs`) — il contratto il canale ce l'ha — e il dispatch lo
      scarta con un commento che nomina il debito («si ignora (M4:
      log/notifica)»).
- [ ] **La rete di sicurezza si spegne nella forma esatta del funzionare.** Il
      versioning è un `EventHandler` e nient'altro; il suo `handle` propaga
      l'errore di `store.snapshot(...)` (`features/src/versioning.rs`).
      Disco pieno, `.fubmd-data/` in sola lettura, vault su una cartella cloud
      che rifiuta la scrittura: gli snapshot **smettono**, il pannello
      cronologia resta al suo posto ed elenca le versioni vecchie, nessuna riga
      cambia colore. La sola feature che esiste per esserci quando qualcosa va
      storto fallisce in modo indistinguibile dal funzionare, e lo si scopre
      quando serve ripristinare.
- [ ] **E lo stesso vale per le automazioni di 16.2**, che sono la famiglia
      grande di questa firma: un trigger su-modifica che fallisce non riprova,
      non avvisa e non compare da nessuna parte — «Automation logs»,
      «Automation error handling», «Automation retries» e «Automation
      notifications» (16.3) hanno tutte come primo requisito che qualcuno
      **guardi** quel `Result`.
- [ ] **Gli altri due esiti già raccolti e mai letti**: `flush_indexes`
      restituisce `Vec<PluginError>` proprio *«perché chi ha un canale di
      notifica possa mostrarli»* (`workspace.rs`) — e i suoi chiamanti in
      produzione sono un `eprintln!` nel watcher (`host/watcher.rs`), un
      `let _ =` in `reindex` (`workspace.rs`) e, dalla
      [0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md), la
      chiusura del vault — che li **risale** fino al comando IPC e fino a chi
      spegne l'app, dove diventano un `eprintln!` in più. Il canale è stato
      costruito e collegato a metà: adesso arrivano fino al confine, e lì
      finiscono ancora dove non li legge nessuno.
- [ ] **Un precedente, ed è quello da imitare.** La
      [0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md) ha chiuso una
      delle occorrenze di questa firma — `let _ = ws.sync_path(…)` nel watcher —
      **senza** chiedere ai chiamanti di stare attenti: `sync_path` registra da
      sé il proprio fallimento (`VaultStatus.sync_failures`) e restituisce
      quello che restituiva. La lezione è nella forma: un `Result` che dipende
      dall'attenzione di chi lo riceve è un `Result` che si perde, e il posto
      dove metterlo al sicuro è **dentro** chi lo produce.
- [ ] Cosa serve: che `deliver_to_handlers` raccolga e risalga (l'operazione che
      ha emesso l'evento **non** deve fallire — quella parte del commento è
      giusta e va tenuta), e un unico posto in cui quegli esiti diventano ciò
      che il §20.2 decide. Costa poco adesso e costa poco dopo — non è una firma
      — ma ogni giorno in più è un giorno in cui un difetto reale non lascia
      traccia. Va deciso **con** il §20.2, o si raccoglie in un `Vec` che non ha
      dove andare.

### 20.4 La shell non ha una superficie dove dire niente, e il salvataggio non ha esito

*settimo giro · shell · **P1** — la metà umana del §20.2; il caso peggiore è una perdita di dati*

- [ ] **`saveCurrent` non ha un `catch`, e la shell non ha uno stato di
      salvataggio.** `await api.writeDocument(currentDoc, text)`
      (`panels/document.ts`) è invocato da un `setTimeout`: se la scrittura
      fallisce — vault in sola lettura, disco pieno, file bloccato da un'altra
      app, permessi cambiati — la promise rifiuta in un contesto senza
      gestore, e nella UI **non cambia niente**. Una superficie per un
      messaggio adesso c'è (`notify`, `ui/notify.ts`) e il salvataggio non la
      usa; uno **stato di salvataggio** non esiste proprio — non c'è «salvato»,
      non c'è «salvataggio in corso», non c'è «non salvato». L'utente continua
      a scrivere per un'ora dentro una nota che nessuno sta scrivendo su disco.
- [ ] **La shell sa già di stare per distruggere il lavoro di un'altra
      applicazione, e lo dice alla console.** `reloadIfClean`
      (`panels/document.ts`) col buffer sporco e `origin.actor == watcher`
      stampa, testualmente, *«è stato cambiato da un'altra applicazione mentre
      il buffer è sporco: il buffer vince e quella modifica andrà persa al
      prossimo salvataggio»*. La diagnosi è giusta, è completa, distingue il
      caso grave da quello innocuo grazie alla [decisione 0012](../decisions/0012-origine-degli-eventi.md) — e va in un posto
      che non ha lettori. [data-model.md](../architecture/data-model.md)
      descrive quel comportamento così: *«il conflitto è segnalato (warn), non
      silenzioso»*. Con la superficie che c'è oggi, «segnalato» e «silenzioso»
      sono la stessa cosa. Il **dialogo di conflitto** è lavoro dichiarato di M3
      (§18.1); questa voce è ciò che serve **prima** e comunque, perché lo stesso
      buco copre altri undici avvisi che un dialogo di conflitto non riguarda.
- [ ] **Un'organizzazione congelata è una sessione di lavoro buttata.**
      Se `.fubmd/workspace.json` non si legge, la shell alza `metaBroken` e
      **smette di salvare** per non sovrascrivere ciò che c'è
      (`state/organization.ts`). La decisione è giusta. Ciò che manca è dirlo:
      da quel momento
      ogni icona, ogni nota appuntata, ogni riordino e ogni spazio vengono
      accettati, disegnati e scartati, per tutta la sessione, senza un segno.
      È il §11.3 (il sidecar da assorbire, oggi scritto senza atomicità) visto
      dal lato di chi lo usa.
- [ ] **Gli altri punti dello stesso buco**, sparsi per la shell: una view che
      non si ridisegna lascia montato l'albero precedente (`ui/panel-host.ts`) —
      cioè un pannello **stantio identico a uno vivo**, che è il sintomo che il
      test del lotto ([decisione 0011](../decisions/0011-il-lotto.md)) esiste per prevenire in un altro modo; un ascoltatore
      di eventi del kernel che lancia lo scrive alla console (`state/kernel.ts`);
      una rinomina rifiutata, una conversione in cartella e uno spostamento
      falliti tornano indietro senza dire perché (`panels/explorer.ts`);
      l'organizzazione non salvata (`state/organization.ts`); la nota da
      wikilink mancante non creata (`panels/preview.ts`). In tutto tredici
      `console.warn`/`console.error`, e uno peggiore degli altri perché non ha
      nemmeno la console: `state.commandSpecs = await api.listCommands().catch(() => [])`
      (`state/vault.ts`) — se l'elenco dei comandi non arriva all'apertura del
      vault, la palette è vuota e **ogni scorciatoia dichiarata è morta**, senza
      una riga da nessuna parte. (La palette, quando è lei a ricaricarli, un
      `notify` lo fa: `ui/palette.ts`.)
- [ ] Cosa serve, e non è più costruire un centro notifiche: **quello c'è**
      (§10.3, [decisione 0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)
      — toast, storico, raggruppamento, due toni, e una porta sola, `notify`).
      Quel che manca è **portarci dentro i quattordici**, e uno **stato di
      salvataggio** accanto al documento. L'ordine si è invertito rispetto a come
      questa voce se lo aspettava, e non cambia niente di ciò che le resta da
      fare: la superficie minima esisteva già, quindi la voce che doveva farla
      bella non ha dovuto aspettare. Il precedente è già
      in repo e vale come regola: l'unico fallimento che oggi arriva all'utente è
      quello dell'avvio, che scrive nella barra del vault perché *«è il posto
      più visibile che la shell ha»* (`main.ts`, in coda). La regola è scritta,
      è giusta, ed è applicata **una volta su quattordici**.

*Sblocca:* 2.1 (autosave, crash recovery, gestione conflitti file), 24.2
(error reporting chiaro, autosave recovery), 3.1 (vault read-only, vault su
cloud drive: oggi falliscono senza dirlo), 4.2, 3.3 (undo toast e quick actions
vogliono la stessa superficie), 10.5.
