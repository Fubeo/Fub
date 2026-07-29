# 20. Quando qualcosa va storto, chi lo dice e a chi

Una **seduta** della [roadmap infrastrutturale](../todo.md): il canale che dice cosa è andato storto, visto da chi non può dirlo, da chi lo butta via e da chi non ha dove scriverlo.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il settimo giro ha fatto una domanda che i primi sei non avevano fatto: **cosa
fallisce senza produrre nessun segnale** — né per un test, né per un log, né per
l'utente, finché il danno non è già fatto. Le quattro voci nate da lì erano lo
stesso percorso interrotto in tre punti: chi ha visto il problema **non poteva
dirlo** (la firma non restituiva niente, §20.1), chi lo diceva trovava un
ascoltatore che **lo buttava via** (§20.3), e chi lo ascoltava non aveva **dove
scriverlo** perché nel contratto la variante non c'era (§20.2) e nella shell la
superficie non c'è (§20.4).

**Tre sono chiuse**, e in due verbali perché sono due ragionamenti e non quattro:
la [0051](../decisions/0051-l-alimentazione-risponde.md) ha dato un esito
all'alimentazione — a lotti, perché forma e grana avevano una risposta sola — e
la [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) ha dato a quell'esito
una destinazione, chiudendo insieme la variante di evento e il kernel che
scartava. Deciderne una sola avrebbe dato un canale senza destinazione o una
destinazione senza niente da metterci dentro.

**Il progetto aveva già l'invariante, e la presidiava su un canale solo.**
[traits.md](../architecture/traits.md) lo scrive per esteso a proposito
dell'`Event::Overflow`: *«è la versione rumorosa del troncamento: perdite
silenziose non esistono per contratto»*. Era vero, ed era vero soltanto lì.
Adesso vale su tre canali: l'alimentazione degli indici, l'esito di un handler e
il flush. Resta falso sull'ultimo, quello che va dal backend allo **schermo**
(§20.4), e su un caso di troncamento che la 0052 ha scoperto misurandosi
(§20.5).

Restava anche il fatto strutturale, e la ragione per cui sette giri non avevano
trovato queste voci: di quelle quattro **una sola scadeva col freeze**. Le altre
non erano firme, quindi nessun criterio di scadenza le aveva mai messe in cima —
e intanto il loro costo non si pagava a M4, si stava pagando in difetti che non
si diagnosticavano. È il criterio di [seduta 17](17-presidi-che-restano.md)
applicato al contrario: il costo dell'attesa non cresceva, era già massimo. Le due
che restano hanno esattamente quella forma, ed è la ragione per cui vanno prese
guardandole e non aspettando che scadano.

### 20.2 Ciò che va storto ha un canale nel contratto e nessuna destinazione

*settimo giro · contratto · **P1** — **chiusa** con la [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md); resta una casella, che è adozione e non forma*

- [x] **La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) aveva
      già deciso la forma, e rimandato per mancanza di clienti** — *«quando
      arriveranno, arriveranno come Event, ed è additivo»*. È andata esattamente
      così: `Event::Trouble { severity, subject, error }` è una variante **in
      coda**, additiva, e non ha toccato la linea di base.
- [x] **Le due cose che questa voce aspettava c'erano tutte e due**, e una delle
      due righe che lo negavano era **morta**: il payload doveva aspettare il
      §12.2, ma il §12.2 è chiuso dalla
      [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) da
      quattro sedute — ogni payload di `PluginError` è già un `Text`, cioè una
      chiave e i suoi argomenti. La riga *«oggi è prosa italiana composta …
      quella è P0 mentre questa no»* descriveva un repo che non esiste più.
- [x] **La severità e il soggetto, che erano la domanda vera.** Due gradini, e
      il criterio del taglio non è a occhio: **la classe del dato perso dice la
      severità** ([0048](../decisions/0048-una-radice-sola.md)) — un derivato si
      ricostruisce riaprendo il vault ed è un avviso, ciò che era autorevole non
      torna ed è un guasto. Il soggetto è il documento; **chi** ha fallito lo
      dice `origin.actor`, che c'era già dalla
      [0012](../decisions/0012-origine-degli-eventi.md), quindi nessun campo
      `plugin` nel record.
- [x] **Il posto dove atterra c'era ed è vivo**: il centro notifiche
      ([0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)), il cui commento
      diceva *«il giorno che quella variante arriva le si attacca il router degli
      eventi invece di venti chiamanti»*. È `ascoltaIGuasti()` in
      `ui/notify.ts`.
- [ ] **Portarci dentro i ventisette.** La forma c'è; l'adozione no. I punti che
      oggi scrivono su `stderr` nel backend sono **ventisette** (contati col
      criterio scritto nella 0052 — il numero che questa voce riportava, 25, era
      vecchio di due giri) e vanno convertiti uno a uno. Non è gratis per tutti:
      alcuni non hanno il workspace fra le mani, e il caso limite è la regola
      sintattica che pania (`kernel/syntax.rs`), che sta dentro il **parse** —
      portarla dentro il canale vuol dire dare un esito a `DocumentStore::parse`
      e ai suoi otto chiamanti. Non è una decisione: è la sua conseguenza, ed è
      qui perché non deve sparire senza essere stata fatta.

*Sblocca:* 10.5 (notification center, alert stale notes / broken links / sync
errors / backup errors / plugin errors — ~28 voci che ora **hanno** una
sorgente), 24.2 (error reporting chiaro, diagnostica), 16.3 (automation error
handling, retries, notifications), 18.1 (errori di sync dettagliati, stato sync
visibile).

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
      Se `.fubmd/workspace.json` non si legge, non lo si sovrascrive: la
      decisione è giusta, ed è la stessa della configurazione. Ciò che manca è
      **dirlo a chi sta lavorando**. Dal §11.3
      ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)) il rifiuto
      almeno *torna al chiamante* — è il kernel a negare ogni scrittura, una per
      una, invece di una shell che smetteva di salvare in silenzio — e la shell
      lo scrive in console. Ma la console di un'app impacchettata non si apre:
      finché non c'è una superficie, ogni icona e ogni riordino continuano a
      essere accettati, disegnati e persi senza un segno che l'utente veda.
- [ ] **Gli altri punti dello stesso buco**, sparsi per la shell: una view che
      non si ridisegna lascia montato l'albero precedente (`ui/panel-host.ts`) —
      cioè un pannello **stantio identico a uno vivo**, che è il sintomo che il
      test del lotto ([decisione 0011](../decisions/0011-il-lotto.md)) esiste per prevenire in un altro modo; un ascoltatore
      di eventi del kernel che lancia lo scrive alla console (`state/kernel.ts`);
      una rinomina rifiutata, una conversione in cartella e uno spostamento
      falliti tornano indietro senza dire perché (`panels/explorer.ts`);
      l'organizzazione non salvata (`state/organization.ts`); la nota da
      wikilink mancante non creata (`panels/preview.ts`).

      **Il conto, ricontato dalla [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md)
      e col criterio scritto perché il prossimo lo rifaccia**: `console.warn` e
      `console.error` fuori dai `.test.ts` sono **quattordici**, in nove file. Uno
      dei quattordici — l'avvio, in `main.ts` — arriva **già** all'utente, perché
      scrive anche nella barra del vault; gli altri tredici no. A questi si
      aggiunge un punto che non ha nemmeno la console, ed è peggiore di tutti:
      `state.commandSpecs = await api.listCommands().catch(() => [])`
      (`state/vault.ts`) — se l'elenco dei comandi non arriva all'apertura del
      vault, la palette è vuota e **ogni scorciatoia dichiarata è morta**, senza
      una riga da nessuna parte. **Quattordici punti da portare a galla**, quindi,
      e non è un numero da fidarsi a memoria: il precedente diceva «tredici» in
      un posto e «quattordici» in un altro, e cresce da sé a ogni pannello nuovo.
      (La palette, quando è lei a ricaricare i comandi, un `notify` lo fa:
      `ui/palette.ts`.)
- [ ] Cosa serve, e non è più costruire un centro notifiche: **quello c'è**
      (§10.3, [decisione 0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)
      — toast, storico, raggruppamento, due toni, e una porta sola, `notify`), e
      adesso ha anche una **sorgente** dal backend
      ([decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md):
      `Event::Trouble` arriva lì dentro da sé). Quel che manca è portarci i
      quattordici **di questa parte del confine** — che non passano da un evento
      del kernel, perché nascono di qua — e uno **stato di salvataggio** accanto
      al documento. L'ordine si è invertito rispetto a come questa voce se lo
      aspettava, e non cambia niente di ciò che le resta da fare: la superficie
      minima esisteva già, quindi la voce che doveva farla bella non ha dovuto
      aspettare. Il precedente è già in repo e vale come regola: l'unico
      fallimento che oggi arriva all'utente è quello dell'avvio, che scrive nella
      barra del vault perché *«è il posto più visibile che la shell ha»*
      (`main.ts`, in coda). La regola è scritta, è giusta, ed è applicata **una
      volta su quattordici**.

*Sblocca:* 2.1 (autosave, crash recovery, gestione conflitti file), 24.2
(error reporting chiaro, autosave recovery), 3.1 (vault read-only, vault su
cloud drive: oggi falliscono senza dirlo), 4.2, 3.3 (undo toast e quick actions
vogliono la stessa superficie), 10.5.

### 20.5 Il budget del dispatch tronca senza guardare cosa sta troncando

*nata misurando la [decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) · kernel · **P2** — non è una firma, ed è la seconda volta che questa classificazione viene creduta invece che verificata*

- [ ] **Un documento dice una cosa che il codice smentisce.**
      `Event::is_recoverable` (`abi/event.rs`) si presenta così: *«è la
      classificazione su cui poggia **ogni freno del canale** (§10.2,
      [decisione 0034](../decisions/0034-il-freno-e-il-raggruppamento.md)) …
      sta qui e non in chi frena perché i freni sono **due** — il tetto del bus
      e il raggruppamento del ponte — e una seconda idea di cosa sia
      sacrificabile sarebbe un evento perso in silenzio da uno dei due»*. I
      freni che la guardano sono davvero due, ed è verificato
      (`bus.rs`, `host/bridge.rs`). Ma i posti da cui un evento **sparisce**
      sono tre: il terzo è `Dispatcher::next_to_deliver` (`kernel/dispatcher.rs`),
      che a budget esaurito fa `self.pending.clear()` — tutta la coda, senza
      leggere `is_recoverable`.

      E l'architettura diceva di più, e più esplicitamente:
      [traits.md](../architecture/traits.md) elencava le **tre** sorgenti di
      `Overflow` — «il budget del dispatch, il tetto degli arretrati di un
      subscriber del bus e il tetto della raffica del ponte» — e concludeva che
      *«il secondo gruppo passa sempre»*. Passa sempre da due su tre. La riga è
      stata corretta nel giro in cui è stata verificata, ed è il terzo caso di
      questa famiglia dopo il §21.10 e la riga morta del §20.2: **un documento
      che afferma una proprietà del codice va riletto contro il codice, non
      contro sé stesso**.
- [ ] **Perché adesso si vede, e prima no.** Finché ciò che poteva essere
      buttato erano `document-changed` e `index-updated`, il troncamento a
      budget era ciò che dice di essere: una rete contro le cascate, con un
      `Overflow` che dice «riconcilia da zero» ed è più forte di ognuno dei
      singoli eventi buttati. Con la
      [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) nella coda
      passa `Event::Trouble`, che è dichiarato **non recuperabile** perché porta
      l'unica copia di un fatto: «riconcilia da zero» non lo ricostruisce, non
      c'è niente da riconciliare. Un guasto emesso mentre la coda è satura può
      quindi non arrivare mai a un `EventHandler`, ed è il caso in cui le cose
      stanno già andando male — cioè quello per cui la variante esiste.
- [ ] **La portata, misurata e non temuta.** Non riguarda la shell: il ponte
      verso la webview parte dal **bus**, che `is_recoverable` la guarda, quindi
      il centro notifiche riceve comunque. Riguarda gli `EventHandler` — cioè i
      plugin, e il primo è già scritto: un handler di diagnostica, un log su
      file, un'automazione che reagisce ai guasti (16.3) sono esattamente i
      clienti di questa variante, e sono tutti dall'altra parte del troncamento.
- [ ] Cosa serve, ed è una scelta fra due: che il troncamento **conservi** ciò
      che non è recuperabile invece di svuotare (il budget resta un tetto sul
      lavoro, non sui fatti), oppure che l'`Overflow` **dica quanti** ne ha
      buttati di non recuperabili, così che chi legge sappia di aver perso
      qualcosa che non può riconciliare. La prima costa una partizione della
      coda; la seconda costa un campo e non ripara niente. Da decidere insieme
      alla domanda che nessuno ha posto: *se un budget esiste per fermare una
      cascata, perché la ferma buttando via anche ciò che la cascata non ha
      causato?*

*Sblocca:* 16.3 (automation error handling, retries, notifications: il primo
consumatore non-shell di `trouble`), 24.2 (diagnostica), e ogni handler che
oggi non esiste perché il canale non c'era.
