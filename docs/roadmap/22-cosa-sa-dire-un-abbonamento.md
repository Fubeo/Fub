# 22. Cosa sa dire un abbonamento

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md). Un abbonamento (una dichiarazione di interesse) mantiene il lavoro fuori dal confine. Qui si trovano le tre capacità mancanti.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta nasce da una verifica.** È la seconda verifica dopo la [§21.10](21-la-ricerca-predefinita.md). Il metodo si basa su una lettura esterna di [FEATURES.md](../FEATURES.md). Questa lettura ha prodotto nove affermazioni sull'architettura di questo repo.

Risultati del controllo sui sorgenti:
- **Sei affermazioni confermate e già scritte:**
  - La cifratura at-rest poggia sulla [§15.1](../decisions/0064-il-supporto-sta-sotto.md).
  - L'`Origin` ferma le chiamate ricorsive delle automazioni ([0012](../decisions/0012-origine-degli-eventi.md)).
  - Il kernel (il nucleo del sistema) valuta la maschera ([0033](../decisions/0033-la-grana-di-un-abbonamento.md)).
- **Tesi centrale errata:** *«§15.1 e §15.2 non sono più P2, sono il pavimento»*.
  - **P0 indica la scadenza.**
  - **P2 indica l'importanza.**
  - [`todo.md`](../todo.md) e [`leva.md`](leva.md) spiegano la convivenza di questi valori.
- **Prova di funzionamento dalla seduta 15:**
  - La metà di firma §15.4 (P0) è chiusa dalla [0048](../decisions/0048-una-radice-sola.md) prima del freeze (il blocco delle modifiche all'interfaccia).
  - Il `trait VaultStorage` resta P2 poiché costituisce un componente interno al kernel esente da scadenze.

Tre elementi mancavano all'appello. Oggi risultano **tutti e tre chiusi**:
- La terza voce è chiusa dalla [0063](../decisions/0063-la-maschera-e-dell-esemplare.md) (lasciando aperta una casella).
- Le prime due voci sono chiuse dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md).
- La [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) ha aperto la quarta voce (§22.4 sull'orario di parete).
- La §22.4 è chiusa dalla [0091](../decisions/0091-un-orario-di-parete-non-e-un-intervallo.md) (lasciando aperta una casella).

**La seduta presenta zero voci aperte.**

**Avvertimento.** La definizione originaria «tre estensioni della stessa maschera» risulta superata dai fatti. Le decisioni hanno preso strade diverse:
- La §22.3 diventa una funzione su `ViewProvider` ([0063](../decisions/0063-la-maschera-e-dell-esemplare.md)).
- La §22.1 diventa un campo del manifest (il file di configurazione del plugin) ([0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md)).
- La maschera filtra gli eventi, omettendo azioni causali.

L'accorpamento originario rimane valido in base alla regola introdotta dalla 0063. Il testo mantiene la forma iniziale per illustrare il criterio della [0054](../decisions/0054-il-banco-del-lato-provider.md): un cappello illustra un'affermazione. L'affermazione può rivelarsi errata mantenendo valida la propria conclusione.

**Motivo dell'accorpamento.** Un **abbonamento** raggruppa ogni dichiarazione di interesse (inclusa `subscriptions()`). Questo contratto mantiene il lavoro fuori dal confine. Il flusso funziona secondo la [0033](../decisions/0033-la-grana-di-un-abbonamento.md):
1. L'ascoltatore dichiara l'interesse.
2. Il kernel valuta.
3. Il guest (il plugin ospitato) si sveglia solo alla corrispondenza.

Le tre voci indicano i limiti espressivi della dichiarazione. La dichiarazione omette:
- **Il tempo** (§22.1).
- **Le variazioni** (§22.2).
- **L'esemplare interessato** (§22.3).

L'analisi separata produrrebbe tre estensioni disgiunte della stessa maschera, ognuna con una valutazione isolata.

**Validità post-freeze.** Tutte e quattro le voci mantengono validità dopo il freeze. Chiamarle P0 per importanza ripropone un errore già contestato. Analisi basata su [`architecture/wit-congelato.md`](../architecture/wit-congelato.md):
- Il timer impiega un campo di manifest, un campo di maschera o una nuova interfaccia (elementi in coda).
- Il parametro sulle variazioni usa un campo in fondo a un record (la struttura dati) e uno in fondo alla maschera.
- La maschera per esemplare richiede una nuova funzione su un'interfaccia esistente.

**Gli elementi pubblicati mantengono le proprie posizioni.** Le voci classificate P1 seguono M3. Il creatore della prima automazione pagherà il costo implementativo. La §22.3 offriva una via verso P0. La [0063](../decisions/0063-la-maschera-e-dell-esemplare.md) ha adottato il percorso additivo, garantendo la persistenza della voce.

**Tentativi precedenti.** Le due voci rimanenti presentano un tentativo pregresso ritirato. I campi esistevano (`document-changes` e `schedule` nella maschera, un `changes` in `event-document-changed`, un `timer-fired` in coda al variant) ma restavano ignorati:
- `mask_wants` ometteva i filtri.
- `ingest_model` assegnava `None`.
- Il timer restava inattivo.

La dichiarazione rappresenta il passaggio semplice ma isolato. Il kernel deve valutare la maschera per trasformare la promessa in realtà.

### 22.1 Un abbonamento non sa dire quando

*chiusa dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) — la dichiarazione risiede nel manifest. La maschera agisce come filtro. Da qui nasce la §22.4*

- [x] **La conclusione della [0013](../decisions/0013-elenco-delle-capacita.md) rimane valida per un motivo diverso.** `schedule_at`/`schedule_every` mancavano perché il kernel sincrono usava `spawn_job` per accodare e delegava lo svuotamento all'app. 
      La [0032](../decisions/0032-il-runner-dei-job.md) introduce un pool di thread per vault (l'archivio dei documenti) gestito dall'host (l'applicazione principale). Questo pool attende il campanello `JobBell` prestato dal kernel (uguale alla bandiera di cancellazione). 
      La conclusione regge in base alla regola parallela della 0013: 
      - Una capacità richiede la risposta per proseguire. 
      - Un evento si limita a informare. 
      Una sveglia informa tramite un evento. La [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md) dimostra questo approccio informando sul progresso.

      *Riscontro: la [0032](../decisions/0032-il-runner-dei-job.md) garantisce la presenza dei thread. L'altra regola supporta la conclusione. La 0013 aveva previsto la forma `Event`. `Event::TimerFired { owner, timer }` concretizza la previsione usando un approccio additivo.*
- [x] **Necessità della dichiarazione.** `EventMask` definisce tre elementi (le specie, il prefisso di topic, il soggetto in `event.rs`). Il momento temporale manca all'appello. Un plugin manca di un luogo per registrare sveglie. 
      Lo scheduler appartiene all'host. Il luogo di dichiarazione del timer richiede un intervento sottoposto al freeze.

      *Soluzione: il `PluginManifest` accoglie i timer (`timers: list<timer-spec>`). La maschera richiede l'esistenza degli eventi. Un timer inattivo produce zero eventi. L'errore di categoria bloccava la valutazione nel tentativo ritirato. Lo scheduler risiede nell'host. Il contratto stabilisce la regola di attivazione (`TimerSchedule::nth_after`). Il kernel delega la lettura dell'orologio. Gli host condividono l'interpretazione per espressioni come «ogni ora».*
- [x] **Richieste collegate.** FEATURES 16.2 (trigger (l'evento scatenante) su orario, data, intervallo), 16.3 (schedule, delay, retry), 10.5 (promemoria, notifiche), 18.1 (sync periodico), 24.2 (background sync). Questa famiglia di trigger del 16.2 ha origine esterna al vault. Gli altri trigger sfruttano canali esistenti per l'ascolto.

      *Risultato: richieste soddisfatte, escluso l'orario di parete. I parametri `every` e `after` gestiscono il tempo trascorso («ogni ora» e «fra dieci minuti»). Il caso «alle 9» confluisce nella §22.4.*
- [x] **Classificazione diversa da P0.** Le tre opzioni di dichiarazione sono additive: un campo in `PluginManifest` (come `settings`, [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)), un campo in coda a `EventMask`, o una nuova interfaccia. Il caso `Event` per la sveglia risulta additivo secondo le regole del progetto. Il documento [`wit-congelato.md`](../architecture/wit-congelato.md) precisa un limite del component model: l'aggiunta a un `variant` rompe la compatibilità.

      *Soluzione adottata: campo in manifest. Il caso in coda al `variant` rimane presente. `frozen/0.1.0.wit` resta intatto. La [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) fornisce il precedente, avendo aggiunto tre casi a `plugin-error` classificandoli come additivi.*

### 22.2 Un evento dice quale documento, non cosa è cambiato

*chiusa dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) — il filtro sfrutta l'aspetto, la lettura sfrutta il nome*

- [x] **Struttura di `DocumentChanged { id }`** (`abi.wit`, `event-document-changed`). 
      L'ascoltatore rileva la modifica della nota ignorando le variazioni interne. Il controllo dei tag richiede la rilettura del modello e il confronto con lo stato precedente.

      *Aggiornamento: l'evento espone i dettagli tramite `changes: option<doc-changes>`. I due stati dell'`option` assumono significati distinti:*
      - *Assente significa "ignoto" e supera ogni filtro.*
      - *Presente e vuoto significa "invariato" e subisce il blocco.*
- [x] **Richieste della 16.2.** Le funzionalità includono: «trigger su tag aggiunto», «su proprietà cambiata», «su task completato». 
      Questi elementi mancano di una propria specie di evento. La maschera fallisce nel filtrarli. Un'automazione sulle scadenze si attiva a **ogni** scrittura di **ogni** nota del soggetto. L'automazione richiede una rilettura per determinare l'irrilevanza. Questa famiglia genera il carico maggiore dell'intero capitolo 16.

      *Risultati: i primi due trigger usano i nomi (`tags_added`/`tags_removed` e `properties`). Il terzo («task completato») manca di un campo nel modello, risultando indistinguibile da un cambio di corpo. `DocChange` omette questo campo per evitare promesse impossibili al kernel. Questo vuoto esplicito anticipa l'estensione dell'enum all'arrivo dei task in `DocumentModel`.*
- [x] **Argomento della [0033](../decisions/0033-la-grana-di-un-abbonamento.md).** La sola grana delle specie attivava ogni handler (il gestore dell'evento) per N feature × M documenti. L'aggiunta di topic e soggetto alla maschera riduce il carico di due ordini. 
      Il parametro *cosa* rappresenta la terza grana. L'assenza di questo parametro ripristina il moltiplicatore sull'evento più frequente del contratto.

      *Soluzione: `DocChange` copre sei aspetti definiti dal contratto. Il moltiplicatore residuo impatta unicamente sul **risveglio**, escludendo la **rilettura** (l'operazione costosa). I nomi nell'evento indicano subito la pertinenza all'ascoltatore risvegliato.*
- [x] **Luogo di calcolo della differenza.** L'operazione avviene in un unico punto: `Workspace::ingest_model` (`workspace.rs`), in coda a ogni scrittura. 
      In quella fase l'host possiede il nuovo modello e conserva i vecchi metadati in cache. La riga `on_document_indexed(&model)` sostituisce i dati. L'estrazione delle variazioni evita ricalcoli: basta analizzare i dati prima della sovrascrittura. L'omissione di questa analisi genera uno spreco equivalente a quello della [seduta 20](20-quando-qualcosa-va-storto.md), spostato sul canale degli eventi.

      *Conferma: il diff richiede **zero letture dal disco**. Il calcolo avviene in `ingest_model` prima di alterare i dati. Il corpo risiedeva fuori dalla cache (split metadata/body). L'impronta mantenuta dall'anagrafe dal giro precedente (§14.1) risponde per il corpo direttamente dalla memoria.*
- [x] **Esclusione da P0.** Le modifiche implicano un campo in fondo a `event-document-changed` e uno in fondo a `EventMask`. Entrambi configurano aggiunte in coda a dei record.

      *Risultato: aggiunta di tre tipi nuovi (`doc-change`, `doc-changes`) conservando la linea di base intatta.*

### 22.3 La maschera di ridisegno è della view, non dell'esemplare

*chiusa dalla [0063](../decisions/0063-la-maschera-e-dell-esemplare.md) — resta una casella, l'unica metà priva di soluzione nel contratto delle view*

`ViewProvider` possiede `interests(&ViewInstance) -> ViewInterests { refresh, follows }`. Il record si trova nel WIT accanto a `view-spec` (la specifica della vista). 
I due campi della spec gestiscono il caso generale e il default. La decisione ha natura additiva, mantenendo aperta la §22.3. 

La risoluzione delle maschere avviene **durante la richiesta delle spec**, alla registrazione (`specs_dichiarate`). Il registro detiene la verità sulle offerte del provider. 
L'apertura di un esemplare con parametri interroga `Workspace::view_interests`. L'operazione evita l'IPC (la comunicazione tra processi) poiché `list_views` ([0057](../decisions/0057-la-dieta-dell-ipc.md)) contiene già la risposta per la shell (l'interfaccia utente).

- [ ] **Il secondo cliente esula dal concetto di view.** Una query **incorporata in una nota** (9.2, «query embed») differisce da un esemplare di `ViewSpec`. Costituisce un blocco generato dal renderer (il motore di visualizzazione) all'interno del documento aperto. 
      Questo blocco manca completamente di un canale di invalidazione. Il ridisegno conseguente alla variazione dei dati resta un problema ignorato dalle voci. 
      Le due metà richiedono una decisione congiunta per evitare meccanismi discordanti. Il meccanismo stabilito prevede una dichiarazione di interesse per esemplare, valutata dal possessore dell'evento. L'obiettivo consiste nell'adottare questo meccanismo universale.
      Un blocco nel documento manca di un id di view per la spec. La dipendenza deriva dal testo contenitore: la soluzione richiede l'analisi del testo, lontano da `ViewSpec`.

### 22.4 Un orario di parete non è un intervallo

*chiusa dalla [0091](../decisions/0091-un-orario-di-parete-non-e-un-intervallo.md) — la regola della sveglia autonoma nasce **accanto** a quella esistente · resta una casella*

`TimerSchedule` definiva `every` e `after`. Queste forme misurano il **tempo trascorso** («ogni ora», «fra dieci minuti»). La §22.1 aggiungeva un terzo caso («alle 9») basato su principi separati.

- [x] **Gestione del fuso orario.** Un orario di parete richiede un fuso di origine ignota. 
      Fonti ipotizzate:
      - Il sistema.
      - Un'impostazione (§11.1).
      - Il locale della [0039](../decisions/0039-il-locale-e-il-caso.md) (l'host conosce il formato dell'ora omettendo il fuso di residenza).
      Queste opzioni generano comportamenti diversi per un vault sincronizzato tra macchine geograficamente distanti. Questo rappresenta il caso operativo tipico.

      *Risultato: la misurazione conferma la soluzione esistente nel `Locale`. Il modulo dichiara `locale.timezone` come nome IANA, prescrivendo l'uso di `Locale::timezone` per l'aritmetica sulle date. Il sistema applica la scala vault → macchina → default (il valore vuoto interroga il sistema). I tre candidati formano **tre strati integrati**, evitando chiavi duplicate.*
      *Il fuso default corrisponde alla **macchina** («alle 9» indica l'inizio del lavoro locale). Il caso geografico guadagna un **terzo strato nuovo**: `zone: option<string>`. La sveglia dichiara il fuso quando vincolata a un luogo («il digest delle 9 dell'ufficio di Roma»). Un fuso implicito omette questa informazione. Un nome ignoto al database ferma la sveglia ed evita il ripiego su UTC.*
- [x] **Regola sull'ora legale.** All'ingresso dell'ora legale le 2:30 spariscono; all'uscita si duplicano. 
      La sveglia salta un giro o esegue due giri in base al compito (un promemoria salta, un backup esegue). Questa decisione richiede visibilità per evitare implementazioni nascoste.

      *Risultato: la soluzione rifiuta l'uso del campo previsto. Le 2:30 duplicate suonano una sola volta per un invariante: l'occorrenza usa la **data civile** invece dell'istante esatto. Le 2:30 mancanti avanzano della durata del salto (disambiguazione `compatible` della RFC 5545). La sveglia di parete preserva tutti i giorni.*
      *Il campo aggiunto gestisce le occorrenze passate durante l'inattività (macchina in sospensione, pool occupato, app chiusa), un problema ignorato dalla voce. `catch_up_seconds` definisce una **finestra** in opposizione alle bandiere binarie. Una macchina riaccesa dopo due giorni suona **zero** volte, evitando i recuperi multipli.*
- [x] **Richieste collegate.** FEATURES 16.2 (trigger su orario e data) e 10.5 (promemoria e notifiche). Questa metà completa la famiglia della §22.1. Le sveglie a intervalli funzionavano, le sveglie fisse restavano scoperte.

      *Soluzione: `at-wall-clock` gestisce casi come «ogni giorno alle 9» e «il lunedì alle 7:30». Un singolo caso accomuna queste forme: l'elenco dei giorni vuoto indica «ogni giorno». Questa scelta previene l'uso di discriminanti multiple (`daily`, `weekly`) per la medesima aritmetica.*
- [x] **Esclusione da P0.** Il `variant` `timer-schedule` nasce con la [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) e resta inedito. Un caso in coda ha natura additiva e preserva la compatibilità per chi usa `every`. Il freeze controlla il luogo della dichiarazione nel manifest.

      *Conferma totale. La firma `nth_after` mantiene la forma originale. La regola dell'ora civile nasce **accanto** alla precedente. Il file `frozen/0.1.0.wit` rimane intatto e privo di `timer-schedule`.*
- [ ] **Recupero post-riavvio dell'app.** `catch_up_seconds` agisce durante la sessione e la sospensione della macchina, escludendo le chiusure dell'app. 
      Lo scheduler dimentica l'ultimo stato salvato. L'occorrenza passata si **consuma in silenzio** al primo giro, bloccando il recupero. L'apertura dell'app alle dieci evita l'attivazione automatica della sveglia delle nove. 
      Questa limitazione ferma il recupero dei backup notturni ad ampia finestra se l'app risultava chiusa (il caso d'uso principale della finestra larga). 
      Il recupero completo richiede la memorizzazione dell'ultima occorrenza onorata (per sveglia e macchina). Il file di stato della macchina della [0037](../decisions/0037-lo-stato-di-vista.md) ospiterà questo meccanismo dedicato.