# 20. Quando qualcosa va storto, chi lo dice e a chi

Questa è una **seduta** (un raggruppamento tematico di task) della
[roadmap infrastrutturale](../todo.md). Il tema è il canale degli errori.
Riguarda chi omette di segnalare un problema, chi scarta la segnalazione e chi
manca di un posto per registrarla. **Tutte e cinque le voci sono chiuse.**

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

Il settimo giro ha posto una domanda aggiuntiva rispetto ai primi sei. L'analisi
identifica **cosa fallisce in modo silenzioso**. I fallimenti omettono segnali
per un test, per un log o per l'utente, causando danni prima della scoperta.
Questa analisi ha generato quattro voci. Le voci descrivono lo stesso percorso
interrotto in tre punti:
- **Segnalazione bloccata**: chi rileva il problema omette di comunicarlo (la
  firma omette il risultato, §20.1).
- **Scarto del messaggio**: l'ascoltatore elimina la segnalazione ricevuta
  (§20.3).
- **Mancanza di destinazione**: l'ascoltatore manca di un registro per l'errore.
  Il contratto omette la variante necessaria (§20.2). La shell (l'interfaccia
  utente) manca di una superficie visibile (§20.4).

Tre verbali (documenti di decisione) chiudono **quattro di quelle voci**. I
ragionamenti logici sono tre e non quattro:
- La decisione [0051](../decisions/0051-l-alimentazione-risponde.md) definisce
  un esito per l'alimentazione (l'inserimento dati). Gestisce i dati a lotti,
  fornendo una sola risposta per forma e grana.
- La decisione [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md)
  assegna una destinazione a questo esito. Risolve contemporaneamente la
  variante di evento e lo scarto del kernel (il nucleo del sistema). Deciderne
  una sola avrebbe creato un canale vuoto o una destinazione isolata.
- La decisione
  [0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md) risolve la
  quarta voce. Rappresenta la metà umana delle prime tre. Indirizza i
  quattordici avvisi generati dalla shell verso la stessa destinazione. Questi
  avvisi bypassano gli eventi del kernel. Il salvataggio ometteva un esito.
  Adesso ne possiede uno con quattro stati.

**Il progetto possedeva l'invariante (la regola fissa) presidiata su un canale
solo.** Il file [traits.md](../architecture/traits.md) lo descrive chiaramente
per `Event::Overflow`: segnala rumorosamente il troncamento. Il contratto vieta
le perdite silenziose. Questa regola limitata ora si applica su quattro canali:
- L'alimentazione degli indici.
- L'esito di un handler (il gestore di eventi).
- Il flush (lo svuotamento dei buffer).
- I guasti generati dalla shell, gestiti dalla 0080.

La regola copre anche il troncamento a budget esaurito. La 0052 ha scoperto
questo caso tramite misurazione. La decisione
[0111](../decisions/0111-il-budget-e-un-tetto-sul-lavoro.md) risolve il
problema. Questa è la quinta e ultima voce di questa seduta.

Rimaneva il problema strutturale. Sette giri hanno mancato queste voci per un
motivo preciso. Tra quelle quattro, **una sola scadeva col freeze (il blocco
delle modifiche)**. Le altre omettevano le firme. I criteri di scadenza le hanno
mantenute in basso. Il loro costo generava difetti complessi da diagnosticare,
anticipando la fase M4 (lo stadio di sviluppo avanzato). Questo applica
inversamente il criterio della [seduta 17](17-presidi-che-restano.md). Il costo
dell'attesa partiva dal livello massimo. Le due voci rimanenti presentavano
questa struttura. Il team le ha affrontate tramite analisi diretta,
anticipandone la scadenza. Il testo della seconda voce, il §20.5, rimane valido
fino alla misurazione conclusiva. La misurazione corregge il conteggio: un
evento sparisce da quattro posti, invece di tre. Corregge anche la scelta
finale. Le due soluzioni proposte risultano complementari. Il sistema richiede
tutt'e due in due punti diversi.

### 20.2 Ciò che va storto ha un canale nel contratto e nessuna destinazione

*settimo giro · contratto · **P1** — **chiusa** con la
[0052](../decisions/0052-cio-che-va-storto-e-un-evento.md); rimane una singola
casella di adozione strutturale*

- [x] **La [decisione 0013](../decisions/0013-elenco-delle-capacita.md)
      definisce la forma**. Il rinvio deriva dalla mancanza di clienti. La nota
      specifica l'arrivo futuro come `Event` additivo. Lo sviluppo segue questa
      linea. `Event::Trouble { severity, subject, error }` aggiunge una variante
      **in coda**. Mantiene intatta la linea di base.
- [x] **Il sistema possiede tutte e due le dipendenze richieste**. Una delle due
      affermazioni ostacolanti risulta **morta**. Il payload attende il §12.2.
      La decisione
      [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) chiude
      il §12.2 da quattro sedute. Ogni payload di `PluginError` è un `Text` (una
      chiave con i suoi argomenti). La vecchia riga menzionava la prosa italiana
      composta e classificava la priorità come P0. Questo testo descrive un repo
      superato.
- [x] **La severità e il soggetto risolvono la domanda centrale**. Il sistema
      usa due gradini strutturati. **La classe del dato perso definisce la
      severità** ([0048](../decisions/0048-una-radice-sola.md)). I dati derivati
      si ricostruiscono aprendo il vault (la cartella di lavoro) e generano un
      avviso. I dati autorevoli persi causano un guasto. Il soggetto indica il
      documento. Il campo `origin.actor` identifica l'autore del fallimento,
      introdotto dalla [0012](../decisions/0012-origine-degli-eventi.md). Il
      record omette il campo `plugin`.
- [x] **La destinazione esiste e risulta attiva**. Corrisponde al centro
      notifiche ([0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)).
      L'arrivo della variante sostituisce venti chiamanti col router degli
      eventi. Il codice risiede in `ascoltaIGuasti()` dentro `ui/notify.ts`.
- [ ] **Integrazione dei ventisette punti**. La forma esiste, l'adozione
      richiede lavoro. Il backend scrive su `stderr` in **ventisette** punti. La
      decisione 0052 definisce il criterio di conteggio. Il vecchio numero 25
      risultava obsoleto di due giri. La conversione procede uno a uno. Alcuni
      punti mancano del workspace. Il caso limite riguarda la regola sintattica
      in panico dentro `kernel/syntax.rs` (fase di **parse**). L'integrazione
      fornisce un esito a `DocumentStore::parse` e ai suoi otto chiamanti.
      Questa conseguenza strutturale richiede esecuzione obbligatoria.

*Sblocca:*
- 10.5 (notification center, alert stale notes / broken links / sync errors /
  backup errors / plugin errors — ~28 voci fornite di una sorgente).
- 24.2 (error reporting chiaro, diagnostica).
- 16.3 (automation error handling, retries, notifications).
- 18.1 (errori di sync dettagliati, stato sync visibile).

### 20.4 La shell non ha una superficie dove dire niente, e il salvataggio non ha esito

*settimo giro · shell · **P1** — **chiusa** con la
[0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md); rappresenta
la metà umana del §20.2. Il caso peggiore causa una perdita di dati*

- [x] **La funzione `saveCurrent` manca di `catch` e la shell omette uno stato
      di salvataggio.** Un `setTimeout` invoca
      `await api.writeDocument(currentDoc, text)` in `panels/document.ts`. I
      fallimenti (vault in sola lettura, disco pieno, file bloccato da un'altra
      app, permessi invalidi) causano il rifiuto della promise in un contesto
      privo di gestore. L'interfaccia utente (UI) rimane inalterata. Il sistema
      possiede una superficie per un messaggio (`notify`, `ui/notify.ts`), ma il
      salvataggio la ignora. Il sistema omette uno **stato di salvataggio**
      (mancano le etichette «salvato», «salvataggio in corso», «non salvato»).
      L'utente scrive per un'ora in una nota ignorata dal disco.
- [x] **La shell rileva la distruzione di lavoro di un'altra applicazione e
      avvisa la console.** La funzione `reloadIfClean` (`panels/document.ts`)
      con buffer sporco e `origin.actor == watcher` stampa un avviso chiaro.
      Segnala la perdita della modifica esterna a favore del buffer locale. La
      diagnosi risulta corretta e completa. La
      [decisione 0012](../decisions/0012-origine-degli-eventi.md) permette di
      distinguere i casi gravi da quelli innocui. Il messaggio finisce in un log
      invisibile. Il file [data-model.md](../architecture/data-model.md)
      definisce il conflitto segnalato e visibile. L'attuale superficie rende
      indistinguibili le segnalazioni dai silenzi. Il **dialogo di conflitto**
      fa parte dei lavori M3 (§18.1). Questa voce fornisce la base preventiva.
      Questo intervento risolve altri undici avvisi indipendenti da un dialogo
      di conflitto.
- [x] **Un'organizzazione congelata invalida una sessione di lavoro.** Il
      sistema preserva il file `.fub/workspace.json` illeggibile. Questa
      decisione corretta ricalca la logica della configurazione. Il sistema
      omette di avvisare l'utente. Dal §11.3
      ([0038](../decisions/0038-il-kernel-possiede-il-sidecar.md)), il rifiuto
      ritorna al chiamante. Il kernel nega ogni scrittura una per una,
      abbandonando i fallimenti silenziosi della shell. La shell registra
      l'errore in console. La console di un'app impacchettata rimane
      inaccessibile. La mancanza di una superficie fa accettare, disegnare e
      perdere ogni icona e ogni riordino senza un segno visibile all'utente.
- [x] **I punti mancanti nella shell si distribuiscono in varie aree**:
  - Una view difettosa mantiene visibile l'albero precedente
    (`ui/panel-host.ts`). Mostra un pannello **stantio identico a uno vivo**. Il
    test del lotto ([decisione 0011](../decisions/0011-il-lotto.md)) previene
    questo sintomo diversamente.
  - Un ascoltatore di eventi del kernel registra gli errori solo alla console
    (`state/kernel.ts`).
  - Una rinomina rifiutata, una conversione in cartella e uno spostamento
    falliti omettono i motivi del rifiuto (`panels/explorer.ts`).
  - L'organizzazione fallisce il salvataggio silenziosamente
    (`state/organization.ts`).
  - La nota da wikilink mancante annulla la creazione (`panels/preview.ts`).
  
  **Il conteggio verificato dalla
  [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) stabilisce il
  criterio per i controlli futuri**. I richiami a `console.warn` e
  `console.error` fuori dai `.test.ts` ammontano a **quattordici**, distribuiti
  in nove file. Uno dei quattordici (l'avvio in `main.ts`) raggiunge l'utente
  tramite la barra del vault. Gli altri tredici rimangono invisibili. Un punto
  aggiuntivo omette perfino la console:
  `state.commandSpecs = await api.listCommands().catch(() => [])`
  (`state/vault.ts`). Il fallimento nel recupero dei comandi all'apertura del
  vault svuota la palette. Rende **morta ogni scorciatoia dichiarata**, senza
  una riga da nessuna parte. Esistono quindi **quattordici punti da far
  emergere**. Questo non è un numero da fidarsi a memoria. La documentazione
  precedente riportava «tredici» in un posto e «quattordici» in un altro.
  L'aggiunta di un pannello incrementa il numero. (La palette esegue un `notify`
  durante la ricarica autonoma dei comandi: `ui/palette.ts`.)
- [x] Il lavoro richiede l'utilizzo del centro notifiche esistente. Il centro
      **esiste già** (§10.3,
      [decisione 0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)).
      Fornisce toast (avvisi a scomparsa), storico, raggruppamento, due toni
      visivi e una singola porta d'accesso (`notify`). Possiede una **sorgente**
      dati dal backend
      ([decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md):
      `Event::Trouble` vi approda automaticamente). L'obiettivo richiede
      l'integrazione dei quattordici eventi locali. Questi nascono direttamente
      nella shell, eludendo un evento del kernel. Serve inoltre uno **stato di
      salvataggio** accanto al documento. L'ordine di implementazione risulta
      invertito rispetto alla pianificazione iniziale. La superficie minima
      esisteva in precedenza, sbloccando subito i lavori estetici.
      L'implementazione attuale nel repository stabilisce la regola. L'unico
      fallimento visibile all'utente deriva dall'avvio. Questo fallimento scrive
      nella barra del vault (`main.ts`, in coda). Costituisce il posto più
      visibile della shell. Questa regola corretta trova applicazione **una
      volta su quattordici**.

**Risultati e scoperte durante l'esecuzione**. Il lavoro ha rivelato alcuni
aspetti:
- **Prima scoperta**: la superficie esisteva dal §10.3. Il salvataggio la
  ignorava per la mancanza di **un esito**. La comunicazione copriva metà
  dell'attività. L'altra metà ha separato due stati confusi in un singolo campo:
  «c'è qualcosa da scrivere» e «ciò che ho scritto è arrivato». In caso di
  coesistenza, il guasto ha la priorità per evitare l'occultamento causato da
  una battuta successiva.
- **Seconda scoperta**: il conteggio escludeva alcuni elementi. Il quindicesimo
  punto (l'elenco comandi assente e le scorciatoie morte) mancava di una
  `console` per il tracciamento. La sedicesima riga («nessuno lo disegna»)
  risiedeva in `VaultInfo.unread`. Un conteggio rileva le tracce esistenti. La
  lettura diretta scopre le omissioni totali.
- **Una terza scoperta derivante dall'uso**: l'utilizzo ha svelato la frequenza
  dei tre conflitti su un buffer sporco. I due casi documentati risultavano
  rari. Il terzo caso (la scrittura respinta dal nostro stesso autosave)
  colpisce frequentemente ogni nota estesa. Un avviso generato senza eventi
  reali non costituisce un avviso utile. Questo diseduca l'utente, spingendolo a
  ignorare gli allarmi veri.

*Sblocca:*
- 2.1 (autosave, crash recovery, gestione conflitti file).
- 24.2 (error reporting chiaro, autosave recovery).
- 3.1 (vault read-only, vault su cloud drive: la versione attuale fallisce
  silenziosamente).
- 4.2.
- 3.3 (undo toast e quick actions richiedono la stessa superficie).
- 10.5.

### 20.5 Il budget del dispatch tronca senza guardare cosa sta troncando

*nata misurando la
[decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) · kernel ·
**P2** — **chiusa** dalla
[0111](../decisions/0111-il-budget-e-un-tetto-sul-lavoro.md), concludendo la
seduta intera: il budget funge da tetto sul lavoro, preservando i fatti. Gli
eventi sparivano da quattro posti, invece di tre*

- [x] **Il codice smentisce le affermazioni di un documento.** La funzione
      `Event::is_recoverable` (`abi/event.rs`) descrive la classificazione a
      fondamento di **ogni freno del canale** (§10.2,
      [decisione 0034](../decisions/0034-il-freno-e-il-raggruppamento.md)). La
      classificazione risiede nel tipo di evento e non nel freno perché i freni
      ammontano a **due** (il tetto del bus, che è il canale di comunicazione
      interno, e il raggruppamento del ponte). Una seconda idea di
      sacrificabilità causerebbe un evento perso in silenzio da uno dei due
      freni. I file `bus.rs` e `host/bridge.rs` confermano l'esistenza di due
      freni attenti a questa proprietà. I posti da cui un evento **sparisce**
      ammontano a tre. Il terzo risiede in `Dispatcher::next_to_deliver`
      (`kernel/dispatcher.rs`). A budget esaurito, esegue
      `self.pending.clear()`, svuotando l'intera coda e ignorando
      `is_recoverable`.

      I punti di sparizione risultavano **quattro, non tre**. Il quarto si
      trovava a quattro righe dal terzo: `drop_pending`. Questo metodo scartava
      i dati emessi dagli handler durante la gestione dell'`Overflow`. Scartava
      anche un guasto, omettendo di contarlo. L'analisi precedente focalizzava
      l'attenzione sul decisore del troncamento, ignorando l'esecutore
      materiale. Per questo motivo il quarto punto sfuggiva.

      L'architettura aggiungeva dettagli espliciti. Il file
      [traits.md](../architecture/traits.md) elencava le **tre** sorgenti di
      `Overflow` (il budget del dispatch per lo smistamento dei messaggi, il
      tetto degli arretrati di un subscriber del bus, il tetto della raffica del
      ponte). Concludeva affermando il passaggio garantito per il secondo
      gruppo. Il passaggio si verifica solo da due sorgenti su tre. La verifica
      ha corretto la riga errata. Questo costituisce il terzo caso di questa
      famiglia, dopo il §21.10 e la riga morta del §20.2. **La validazione di un
      documento richiede il confronto col codice, ignorando la coerenza interna
      del testo**.
- [x] **La visibilità del problema emerge ora.** Finché le procedure scartavano
      solo `document-changed` e `index-updated`, il troncamento a budget
      funzionava come rete contro le cascate. Produceva un `Overflow` imponente
      la riconciliazione da zero. L'`Overflow` risulta più forte di ognuno dei
      singoli eventi scartati. L'introduzione della
      [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) inserisce
      `Event::Trouble` nella coda. Questa variante omette il recupero perché
      trasporta l'unica copia di un fatto. La direttiva "riconcilia da zero"
      fallisce la ricostruzione, omettendo i dati iniziali. Un guasto emesso
      durante la saturazione della coda impedisce l'arrivo a un `EventHandler`.
      Questo oblio colpisce il sistema nel momento di massima criticità. La
      variante esiste appositamente per gestire queste crisi.
- [x] **Misurazione oggettiva della portata del problema.** L'impatto esclude la
      shell. Il ponte verso la webview (il componente di visualizzazione)
      origina dal **bus**. Il bus controlla `is_recoverable`. Il centro
      notifiche riceve comunque le informazioni. Il problema colpisce gli
      `EventHandler` (i plugin). Il primo plugin esiste già. Un gestore di
      diagnostica, un log su file, un'automazione reattiva ai guasti (16.3)
      rappresentano i clienti diretti di questa variante. Risiedono tutti oltre
      la barriera del troncamento.
- [x] L'intervento impone una scelta fra due strade. Prima opzione: il
      troncamento **conserva** i dati irrecuperabili evitando lo svuotamento. Il
      budget resta un tetto sul lavoro, preservando i fatti. Seconda opzione:
      l'`Overflow` **dichiara quanti** elementi irrecuperabili ha scartato. Il
      lettore identifica la perdita di dati impossibili da riconciliare. La
      prima soluzione richiede una partizione della coda. La seconda aggiunge un
      campo strutturale omettendo la riparazione. L'analisi impone di rispondere
      a una domanda fondamentale: se un budget ferma una cascata, perché
      distrugge i dati estranei all'origine del sovraccarico?

  La soluzione richiede **l'implementazione di tutt'e due le opzioni in due
  punti diversi**. La prima gestisce i dati presenti in coda all'esaurimento del
  budget. La coda rappresenta una fotografia statica, interamente consegnabile.
  La seconda conta le emissioni degli handler durante la ricezione del tratto
  finale. Il sistema interrompe la consegna (la coda deve terminare) garantendo
  il conteggio. L'applicazione esclusiva della prima opzione **spegne il
  segnale**. Un ping-pong di eventi `custom` (irrecuperabili) blocca gli scarti.
  Questo elimina la generazione di `Overflow` e produce un troncamento muto. Un
  test fallito (diventato rosso) conferma questo comportamento.

*Sblocca:*
- 16.3 (automation error handling, retries, notifications: il primo consumatore
  non-shell di `trouble`).
- 24.2 (diagnostica).
- Ogni handler attualmente ostacolato dalla passata mancanza del canale.