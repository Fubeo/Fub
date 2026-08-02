# 0070 — Un vault si apre in due tempi, e il secondo è un job

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §15.7 (seduta 15) — la **seconda metà**: la forma dell'apertura |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [la prima metà](0068-un-vault-si-apre-per-quel-che-si-legge.md) · [il runner dei job](0032-il-runner-dei-job.md) · [il lavoro lungo si racconta](0035-il-lavoro-lungo-si-racconta.md) · [chi legge non aspetta chi legge](0024-chi-legge-non-aspetta-chi-legge.md)

---

La [0068](0068-un-vault-si-apre-per-quel-che-si-legge.md) ha tolto all'apertura
il tutto-o-niente e ha lasciato scritto, con tre ragioni distinte, ciò che
restava: la **forma**. `Host::open` faceva scansione, lettura, parse di ogni
documento, grafo, riconciliazione e flush **in una chiamata sincrona**, e finché
è così «avvio rapido», «indexing progress» e «supporto vault enormi» (FEATURES
24.1) non hanno dove attaccarsi.

Questo verbale chiude il §15.7.

## La decisione

**L'apertura si taglia in due, e la linea del taglio è la scansione.**

- **Fase 1 — `Workspace::scan_vault`**, sincrona, e l'unica che può fallire.
  Cammina il disco, costruisce l'anagrafe e le cartelle, svuota gli indici,
  emette `VaultOpened`. Al suo ritorno il vault è **utilizzabile**: l'albero c'è,
  una nota si apre, si scrive. `Host::open` aspetta questa e basta.
- **Fase 2 — `Workspace::index_batch`**, a fette, ripetuta da chi ha i thread.
  Legge, parsa, alimenta gli indici. Fra una fetta e l'altra il workspace è
  libero, la bandiera dell'annullamento si guarda e un progresso si timbra.
- **Chiusura — `Workspace::finish_index`**: grafo, `reconcile`, flush, e i
  guasti di ciò che non si è letto.

`reindex()` resta, ed è **la composizione delle tre**: scansiona, cicla, chiude.
Non è un residuo di compatibilità — è il giro sincrono, quello che serve a chi
non ha thread (i test del kernel, e ogni uso da libreria), e tenerlo come
composizione è ciò che rende le tre funzioni provate dai presidi che c'erano già.

E la seconda riga, che decide il resto: **la fase 2 è un job**, con un `JobId`
vero, e non un meccanismo accanto ai job.

## Le decisioni prese, da NON ridiscutere senza motivo

### La linea del taglio non è «quanto costa», è «cosa il vault sa dire»

La divisione ovvia sarebbe stata per costo: da una parte quel che è veloce,
dall'altra quel che è lento. Sarebbe stata una divisione che cambia col disco.

La linea vera l'aveva già tracciata la 0068 decidendo cosa resta fatale: **il
confine è se il vault sappia ancora dire *quali* documenti esistono**. Da un lato
la scansione, che a quella domanda risponde e senza la quale non c'è vault; dopo,
tutto ciò che serve a sapere *cosa dicono* i documenti, che è derivato e si
ricostruisce. Quella riga era stata scritta per separare il fatale dal tollerato,
e separa esattamente allo stesso punto il **sincrono** dal **differito** — perché
è la stessa domanda: ciò che è indispensabile perché un vault sia un vault.

Ne segue anche la risposta a una domanda che nessuno aveva posto: perché
`VaultOpened` esce alla fine della fase 1. Non è «il primo momento comodo»: è il
momento in cui *questo vault è aperto* diventa vero.

### La fase 2 è un job perché il centro attività non deve sapere che l'apertura esiste

Con un `JobId` del kernel, l'indicizzazione compare in `IndexQuery::Jobs`, emette
`JobStarted`/`JobProgress`/`JobDone`, si ferma dal pulsante che ferma gli altri
(§10.3) e ha un esito. Nessuna di queste cose è stata costruita qui: sono la
0032, la 0035 e la 0033 già a posto.

Il guadagno non è il risparmio di righe — è che **il centro attività disegna
l'apertura senza avere un ramo per l'apertura**, e il pulsante «annulla» funziona
senza una seconda implementazione. Un meccanismo parallelo avrebbe voluto dire un
secondo modo di raccontare un progresso e un secondo modo di annullare, e il
secondo di ognuna delle due è quello che si dimentica di aggiornare.

### Ma il job **non entra nella coda**, e non ha un bundle

`take_pending_jobs` consegna dei `PendingJob`, e un `PendingJob` dice *quale
plugin*: il registry ne cerca il corpo, e `Plugin::run_job` lo esegue
([0031](0031-chi-possiede-i-bundle.md)). Il corpo dell'indicizzazione non sta in
nessun bundle — è il kernel — e i due modi di farcelo stare erano entrambi
peggio della cosa da evitare: **un bundle finto**, cioè una bugia nel registro
di chi è montato; oppure **una capacità** con cui «alimenta gli indici» sia
esprimibile al confine, cioè aprire a un plugin la porta che il canale dati
tiene chiusa dalla [0019](0019-il-canale-dati.md).

Quindi `Workspace::begin_index_job` dà **l'identità senza la coda**: il job è
vivo e visibile, e chi lo esegue lo sa perché glielo si è messo in mano. Il
contatore degli id resta **uno solo**, e non è un dettaglio: un id lo si annulla
dal centro attività senza sapere chi lo esegue, e due contatori vorrebbero dire
due job vivi con lo stesso numero.

### Il piano di lavoro sta **fuori** dal kernel, lo stato osservabile **dentro**

`Indicizzazione` — la lista di ciò che resta, il cursore, gli scarti raccolti — è
un valore che chi ha i thread si passa di fetta in fetta. Non è uno stato del
`Workspace`, ed è ciò che rende l'apertura interrompibile *senza aggiungere un
modo di essere a metà* a un oggetto che ne ha già abbastanza.

Ma «a che punto è» deve poterlo chiedere chiunque, e quello sta nel kernel:
tre stati in `WatchState`, serviti da `VaultStatus`. È la stessa divisione della
bandiera del rilevamento ([0030](0030-il-rilevamento-si-puo-chiedere.md)) e del
campanello dei job ([0032](0032-il-runner-dei-job.md)): **il kernel non fa il
mestiere, ma è l'unico posto da cui la domanda si può fare.**

### `VaultStatus` guadagna `indexing`, e la 0068 aveva detto di non allargarlo

Va guardato in faccia, perché è un verbale precedente che sembra dire il
contrario. La 0068 ha rifiutato di mettere in `VaultStatus` l'**esito**
dell'apertura — gli scarti — con una ragione che resta buona: «non ho letto tre
note» è un *incidente*, e sommarlo a `sync_failures` renderebbe quel numero la
somma di due cose diverse.

`indexing` non è quell'esito. Gli scarti stanno dove la 0068 li ha messi
(`VaultInfo::unread` e `Event::Trouble`), e questo campo dice un'altra cosa:
**se ciò che l'indice risponde è tutto**. È della stessa specie di `watching` —
una proprietà del rapporto fra questo vault e ciò che se ne sa *adesso*, non un
incidente contato — ed è servita dallo stesso posto per la stessa ragione.

E ha il cliente che la 0068 chiedeva di aspettare: `frontend/src/panels/search.ts`
scriveva «Nessun risultato» dove la risposta vera era *non lo so ancora*. Su un
vault grande quella frase è falsa per i primi secondi, ed è falsa nel modo
peggiore — manda a cercare altrove chi aveva cercato bene.

**Non porta numeri.** A che punto è lo racconta il job, e un `done`/`total` anche
qui sarebbe una seconda sorgente per la stessa barra.

### Interrotta ≠ finita: **chi smette a metà non riconcilia**

`reconcile` dichiara agli indici l'insieme **completo** dei documenti che
esistono, e ognuno cancella ciò che non c'è dentro. Chiamarlo dopo
un'indicizzazione fermata a metà direbbe a ogni indice di dimenticare tutto ciò
che l'annullamento non ha fatto in tempo a nominare: **trasformerebbe «ho smesso
di indicizzare» in «cancella»**.

È la stessa riga con cui la 0068 tiene fatale la scansione — *un insieme
incompleto non si dichiara completo* — applicata a un insieme bucato da un
pulsante invece che da un permesso. Il resto di `finish_index` si fa comunque:
ciò che è stato alimentato è buono, e buttarlo perché non è tutto vorrebbe dire
che annullare costa più che non aver cominciato.

### La cancellazione la guarda **chi affetta**, non chi chiama l'host

La 0032 aveva dichiarato il proprio limite, e la 0068 lo aveva citato come
ostacolo: la bandiera la scopre chi **chiama l'host**, perché è `JobHost` a
rifiutare di servire un job annullato; un job puro che non tocca mai l'host
arriva in fondo lo stesso, e una scansione che cammina il disco è esattamente
quel caso.

L'ostacolo cade perché **l'esecutore non è il job**: qui è il runner a fare una
fetta alla volta, e fra una fetta e l'altra la bandiera la legge lui. Il limite
della 0032 resta vero dov'era — per il codice di un plugin — e non si applica a
un lavoro che l'host affetta da sé. Il che dice anche quanto vale il limite in
generale: non è «i job non si annullano», è «un job si annulla dove qualcuno lo
interrompe», e affettare è un modo di interromperlo.

### L'apertura ha la precedenza sui job, e non è fame

Un thread del pool guarda l'apertura prima della coda. Un job chiesto da un
provider all'apertura vedrebbe un indice che si sta popolando, e farlo aspettare
è il verso che gli fa vedere di più. Non affama nessuno: una fetta è limitata, e
fra due fette la coda si drena.

### Il ponte si accende **fra** le due fasi

Prima si accendeva dopo `reindex`, con la ragione scritta: gli eventi della
scansione sono il vault che si popola, non il vault che cambia, e la shell li
leggerebbe come un temporale di modifiche. Adesso c'è una seconda ragione, e
tira nel verso opposto: il racconto dell'indicizzazione **deve** passare, o si
mostrerebbe un lavoro che progredisce e finisce senza averlo mai visto
cominciare.

Le due stanno insieme perché fra loro c'è la linea del taglio: dopo la fase 1 e
prima della fase 2. Ed è la ragione per cui `begin_index_job` si chiama lì e non
tre righe più su, dove sarebbe stato più naturale scriverlo.

## Il difetto che i presidi hanno trovato

`VersioningHandler` fa la **prima fotografia del vault** su `VaultOpened`:
fotografa ciò che non ha ancora una storia, perché la prima modifica a una nota
mai versionata cancellerebbe per sempre lo stato in cui l'utente l'ha trovata.
Chiedeva l'elenco a `HostApi::list_documents`, che risponde dai documenti
**indicizzati** — e all'arrivo di `VaultOpened` adesso non ne è indicizzato
nessuno. La fotografia sarebbe stata di zero note: cioè esattamente il danno
contro cui quella passata esiste, in silenzio, il giorno dell'apertura.

La riparazione non è un'attesa: è la **domanda giusta**. Quali documenti
esistono lo dice l'anagrafe (`IndexQuery::Entries`, [0046](0046-l-anagrafe-del-vault.md)),
che dopo la fase 1 è intera — e per una passata che legge dal **disco** è anche
la sorgente giusta nel merito.

Che le due liste potessero divergere lo aveva già scritto la 0068 («anagrafe e
documenti indicizzati adesso divergono»), ma là la divergenza era rara e piccola:
uno scarto. Qui è la normalità per tutta la durata dell'indicizzazione, ed è ciò
che ha reso **osservabile** un errore che era già scritto nel codice.

Lo stesso difetto stava un secondo posto, nel verso più pericoloso:
`reconcile_after_overflow` chiamava «vivi» i documenti che `list_documents`
nomina, e a tutti gli altri metteva un **tombstone**. Un documento che esiste e
che l'indice non ha — uno scarto, o una nota non ancora raggiunta — sarebbe stato
dichiarato morto dal versioning. Corretto con la stessa riga.

## Cosa NON è cambiato

**Nessun ponte IPC nuovo**, e una sola aggiunta al contratto: l'`enum`
`indexing-state` e il campo che lo porta, additivi — `wit_additivity` è verde.

**`IndexProvider` non è stato toccato**, e la tentazione era la stessa che la
0068 aveva già rifiutato: dire a un indice che questa alimentazione è un'apertura
parziale. Un indice non deve dedurre niente dalla dimensione o dall'origine di un
lotto (0051). L'unica cosa che cambia per lui è che `up_to_date` gli viene
chiesta **per fetta** invece che una volta, ed è la stessa cosa che vale per
`on_documents_indexed` da sempre: una domanda pura non cambia risposta perché la
si fa in dieci volte.

**Il progresso non ha una superficie nuova**: è il `JobProgress` di chiunque, con
il `total` valorizzato — l'apertura è il caso per cui quel campo è opzionale, cioè
quello in cui una barra può dire il vero.

## Il prezzo, dichiarato

**Fra `scan_vault` e `finish_index` la ricerca risponde poco e poi di più.**
Era la proprietà che la 0068 aveva salvato riscrivendo il commento sull'ordine
parse-prima-di-mutare — «gli indici non restano vuoti per il tempo in cui si
cammina il disco» — e qui si perde: gli indici si svuotano all'inizio della fase
1. Si paga in questo verso perché l'alternativa lo fa pagare tutto a chi apre,
che aspetta a schermo fermo, invece che a chi cerca nei primi secondi, che vede
l'app viva e i risultati arrivare. E chi guarda non deve indovinarlo: c'è
`indexing`.

**Gli scarti non sono più nello stesso lotto di `VaultOpened`.** La 0068 aveva
chiesto che lo fossero, perché chi disegna il vault appena aperto avesse già in
mano ciò che non si è letto. Con le fasi quel lotto non può esistere — scoprire
uno scarto vuol dire aver già letto — e la promessa che resta è più debole e
vera: ogni scarto esce comunque, sulla stessa superficie, prima che
l'indicizzazione si dica finita.

**`VaultInfo::unread` al ritorno di `open` non è più l'esito.** È «cosa non si è
letto **finora**», e le due frasi coincidono solo da `IndexUpdated` in poi.
L'esito si consulta dopo, che è ciò che la voce chiedeva con «un esito
consultabile».

**Il numero della 0024 non è stato rimisurato.** La 0024 aveva misurato ~780 ms
di prestito esclusivo su 2000 note e aveva scritto che quel lock non affama
nessuno *solo* perché `Host::open` lo prende su un `Workspace` che possiede
ancora — proprietà che cade nel momento in cui l'apertura diventa osservabile.
Adesso è caduta: il workspace è condiviso, e la fase 2 lo prende in esclusiva
**una fetta alla volta** invece che per l'intera apertura. Che sia il verso
giusto è argomentabile e non misurato: quanto duri una fetta da 512 documenti, e
se 512 sia il numero, lo dirà il banco delle prestazioni del §17.1 — che aspetta
una macchina, non una decisione.

## I presidi

Sei sabotaggi, **eseguiti uno per uno** nella forma delle 0066/0067/0068 — e due
dei sei sono la ragione per cui questa sezione si scrive dopo averli fatti e non
prima:

- rimettere `reconcile` su un'indicizzazione interrotta → **rosso**
  (`un_indicizzazione_interrotta_non_dichiara_completo_niente`);
- far tornare `VaultOpened` in fondo invece che alla fine della fase 1 → **rosso**
  (`ogni_scarto_esce_come_guasto_dopo_che_il_vault_si_e_detto_aperto`);
- accendere il ponte dopo la fase 2 → **rosso**
  (`the_event_bridge_starts_after_the_scan_and_before_anything_else`);
- rimettere `list_documents` nella prima fotografia del versioning → **rosso**,
  due presidi (`the_state_a_note_was_found_in_is_recoverable_after_the_first_edit`
  e `a_real_overflow_reaches_the_handler_and_it_reconciles`). È il difetto che i
  presidi hanno trovato, e questo è il sabotaggio che rimette il difetto;
- togliere il controllo della bandiera fra una fetta e l'altra → **verde**;
- togliere l'esito all'apertura che il pool si lascia dietro chiudendo →
  **verde**.

Gli ultimi due sono le due promesse centrali della voce — *un'indicizzazione si
ferma*, *chi la ferma riceve comunque un esito* — e non le presidiava **niente**:
i presidi dell'host le attraversavano tutte e due senza asserirle, perché su un
pool acceso la differenza fra «la bandiera ha fermato l'indicizzazione» e «il
disco è arrivato in fondo prima che la si alzasse» è un istante da indovinare.
Un presidio che si indovina non presidia, ed è la ragione scritta in testa al
modulo `runner` per cui le bandiere si provano su `Flags` e non su dei thread.

Quindi ne sono nati due, dalla stessa parte — `con_la_bandiera_alzata_nessuna_fetta_parte`
e `fermare_il_pool_da_un_esito_all_apertura_rimasta` —, unit test che
mettono in scena il momento invece di aspettarlo: il primo chiama
`avanza_apertura` a mano con la bandiera già su, il secondo ferma un pool
**senza thread**, che è esattamente il caso da coprire (un worker che vede
`stopping` in cima al ciclo ed esce senza passare dall'apertura). Rifatti i due
sabotaggi, adesso sono rossi.

E i presidi che sono stati **riscritti**, che è la parte da guardare: due
dell'host e uno del kernel dicevano una promessa che questa voce cambia —
l'ordine guasti/`VaultOpened`, il ponte che non vede niente, l'esito nel valore
di ritorno. Riscriverli con la ragione nuova, invece di indebolirli, è ciò che
distingue una promessa cambiata da una promessa persa.

E due presidi di **altre voci** hanno dovuto imparare ad aspettare, il che dice
il prezzo di questa in un modo che nessuna frase di questo verbale dice meglio.
`headless.rs` chiedeva i documenti indicizzati subito dopo `open`, e
`lavoro_lungo.rs` chiedeva se il prestito del workspace fosse libero: la prima
adesso è una domanda a cui il vault risponde «non ancora», la seconda trova il
prestito in mano all'indicizzazione, che è **un altro** che lo tiene rispetto a
quello che quel test sta guardando. Tutti e due chiamano `wait_indexed` prima di
chiedere, e nessuno dei due ha allargato una tolleranza per farlo. Erano rossi
una corsa su dieci, cioè il modo in cui una corsa nuova si presenta: non come un
errore, come un'intermittenza.

## Cosa resta scoperto

**Il §15.7 è chiuso.** Restano fuori, e sono già voci di qualcun altro:

- **Il banco delle prestazioni** (§17.1), che è chi può dire se 512 è il numero
  giusto per una fetta.
- **La shell non ha ancora una superficie per l'apertura parziale** (§20.4): il
  centro attività mostra il job perché mostra tutti i job, e la ricerca adesso
  dice «indicizzazione in corso», ma `unread` continua a non essere disegnato da
  nessuna parte.
- **Annullare l'indicizzazione lascia il vault con indici parziali fino alla
  riapertura**, ed è dichiarato nel messaggio dell'esito. Rimetterla in moto
  senza chiudere il vault è un comando di manutenzione, cioè la casella che resta
  al §15.2.
