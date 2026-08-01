# 0068 — Un vault si apre per quel che si legge, e dice cosa non ha letto

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.7 (seduta 15) — la **prima metà**: il lavoro deve poter fallire in parte |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [il registro](0067-il-registro-di-cio-che-e-successo.md) · [l'alimentazione risponde](0051-l-alimentazione-risponde.md) · [ciò che va storto è un evento](0052-cio-che-va-storto-e-un-evento.md) · [chi legge non aspetta chi legge](0024-chi-legge-non-aspetta-chi-legge.md)

---

Il §15.7 dice due cose, e le dice come se fossero una: che l'apertura di un vault
deve poter **fallire in parte**, e che deve cambiare **forma** — da funzione che
ritorna un vault a operazione a fasi, con progresso e cancellazione.

Questo verbale chiude la prima e lascia la seconda scritta, con il perché. Il
criterio è quello della [0031](0031-chi-possiede-i-bundle.md): un verbale può
chiudere mezza voce quando quel pezzo è una decisione intera. E qui la metà non
è arbitraria — è **il prerequisito dell'altra**. Un'apertura a fasi che si
interrompe al primo documento illeggibile non è un'apertura a fasi: è la stessa
apertura tutto-o-niente con una barra di avanzamento sopra, e la barra
arriverebbe al 40% per poi dire che non si apre niente.

## La decisione

`Workspace::reindex` smette di restituire `Result<()>` e restituisce
`Result<Apertura>`. L'`Apertura` porta gli **scarti**: i documenti che la
scansione ha trovato e di cui non si è potuto vedere il contenuto, ognuno col
proprio errore
([`kernel/workspace.rs`](../../crates/fub-kernel/src/workspace.rs)).

E la riga che decide il resto: **il confine fra ciò che si tollera e ciò che no
non è lettura-contro-parse. È se il vault sappia ancora dire *quali* documenti
esistono.**

## Le decisioni prese, da NON ridiscutere senza motivo

### La forma è quella della `Lettura`, e i nomi al posto del conto non la fanno diversa

La voce chiedeva «errori raccolti per-documento e un esito consultabile», che
sono due parole per una struttura da inventare. Non c'era da inventarla: la
[0067](0067-il-registro-di-cio-che-e-successo.md), un turno fa e nello stesso
kernel, ha risolto lo stesso problema — *la verità non si rifiuta di aprire, si
apre segnalando cosa non ha letto* — restituendo una `Lettura` che porta il
**conto** di ciò che ha scartato invece di un `Result` che si rifiuta.

`Apertura` è quella forma un piano più in su, e la differenza va detta perché
sembra una divergenza e non lo è: là si conta, qui si nomina. Una riga di
journal rotta **non ha un nome** — è byte che non si parsano, e l'unica cosa
vera che se ne può dire è quante erano. Un documento ha un [`DocId`], e il §15.7
non chiede di aprire dicendo *quanto* non si è letto: chiede di aprire
**segnalando cosa**. La forma è la stessa — un esito che porta ciò che ha
scartato — e cambia esattamente dove cambia la materia. Due forme diverse per lo
stesso principio sarebbero state un debito che nasceva oggi; una forma sola che
si adatta al suo soggetto no.

### Uno scarto non è un `IndexLoss`, e i due non si fondono

La tentazione era riusare il tipo che c'è: la [0051](0051-l-alimentazione-risponde.md)
ha già `IndexLoss { id, why }`, che è campo per campo la stessa cosa.

Sono due specie diverse, e la prova non è estetica — è che la
[0052](0052-cio-che-va-storto-e-un-evento.md) le manda a **due severità
diverse**, con una regola che non lascia scelta a chi emette. Un `IndexLoss` è
un **derivato** che non ha preso un documento *che il kernel aveva in mano*: il
vault sa ancora tutto, ricostruire è gratis, ed esce `Warning`. Uno scarto è il
kernel che quel documento non ce l'ha affatto: la nota dell'utente non è in
nessun indice, non ha archi nel grafo, non la trova la ricerca, e nessuno la
ricostruisce finché il file non torna leggibile. Esce `Failure`.

Fonderli avrebbe voluto dire scegliere una delle due severità per entrambi, cioè
disfare la sola riga che la 0052 aveva scritto per non lasciarla a giudizio di
chi emette.

### Dove finisce l'esito: nella coda eventi **e** nel valore di ritorno, e non in `VaultStatus`

Tre destinazioni possibili, e vale la pena scrivere perché la risposta è due su
tre.

**La coda eventi, sì.** Il canale c'è già ed è quello giusto: `Event::Trouble`
con `subject: Some(id)` nomina il documento, e ha un consumatore vero —
`ascoltaIGuasti()` nel centro notifiche. Non serviva niente di nuovo.

**`IndexQuery::VaultStatus`, no**, e la riga che lo dice era già scritta, nel doc
di `store_entries`: *«allargarlo a "e poi non ho scritto una cache" renderebbe
quel numero la somma di due incidenti diversi»*. `VaultStatus` risponde a *questo
vault vede le scritture altrui*; «non ho letto tre note all'apertura» è un
incidente di un'altra specie, e la riga che avvertiva di non allargarlo vale
identica qui. Averla trovata scritta da un turno precedente, e averla applicata a
un caso che il suo autore non aveva in mente, è il modo in cui una frase in
prosa in testa a un modulo fa il suo lavoro — la stessa lezione che la 0067 ha
tratto da `storage.rs`.

Se un giorno l'esito dell'apertura dovrà essere **interrogabile**, sarà una
query sua, e la si scriverà quando ci sarà un cliente: aggiungerne una adesso
senza nessuno che la chiama è la firma disegnata da un lato solo che la
[0063](0063-la-maschera-e-dell-esemplare.md) ha appena rifiutato di fare due
volte.

**Il valore di ritorno, sì**, e questa è la scelta che costa qualcosa, quindi
va argomentata. `VaultInfo` guadagna un campo `unread`. La ragione non è la
comodità: è che **la coda eventi è best-effort proprio sotto questo carico**. La
0052 ha lasciato aperto il §20.5 — il budget del dispatch svuota la coda
ignorando `is_recoverable`, quindi un `Trouble` si può perdere sotto pressione —
e aprire un vault *è* la pressione. Contare sul solo evento vorrebbe dire che il
caso in cui l'apertura è andata peggio è anche quello in cui è più probabile non
saperlo.

E c'è una differenza di natura, non solo di affidabilità: «questo vault si è
aperto intero» è una proprietà dell'**operazione**, e chi la chiama la deve
poter leggere dal proprio esito invece di ricostruirla da una sequenza di
incidenti a cui potrebbe non aver assistito.

Il campo sta in `VaultInfo` e **non** nel contratto, ed è per questo che non è il
caso che la 0063 ha rifiutato: `VaultInfo` è un record dell'host, non una firma
WIT. Non scade col freeze, non impone una major a chi lo cambia, e i suoi
clienti sono nominati nel modulo che lo definisce — l'IPC di oggi, l'API locale
del 27.2, la CLI del 27.1 che «stamperebbe i primi due» e stamperebbe anche
questo. Il costo di sbagliarlo è una riga; il costo di sbagliare una variante di
contratto è una versione.

### Un documento illeggibile **esiste**, e da qui nascono due righe che non erano ovvie

Il file c'è: è la scansione ad averlo trovato, con dimensione e data. Non
saperne il contenuto non lo fa sparire, e la sua voce resta in **anagrafe**.
Toglierla avrebbe voluto dire far sparire dalla vista dell'utente esattamente la
nota che ha un problema — nascondere il guasto invece di segnalarlo, che è
l'opposto del principio di questa voce.

Ne seguono due cose che scrivere i presidi ha trovato, e che il ragionamento a
tavolino non aveva:

**Anagrafe e documenti indicizzati adesso divergono.** `IndexQuery::Entries` dice
cosa c'è nel vault, `Workspace::documents()` dice cosa è arrivato agli indici, e
prima di questa voce non potevano dire due cose diverse: o un documento si
leggeva e si parsava, o il vault non si apriva. Uno scarto è precisamente il caso
in cui divergono, ed è una proprietà nuova del kernel — non un effetto
collaterale. Chi scriverà un `vault_health` (§15.2) troverà lì la sua prima
domanda.

**`reconcile` riceve anche gli scarti.** Era il difetto che stava per nascere e
che il presidio ha reso visibile: `reconcile` dichiara agli indici l'insieme
**completo** dei documenti che esistono, e ognuno cancella ciò che non c'è
dentro. Costruirlo dai soli documenti indicizzati avrebbe detto agli indici che
la nota illeggibile è sparita — e alla prima apertura andata storta quella nota
sarebbe uscita dalla ricerca, in silenzio, senza che nessuno l'avesse toccata.
È la famiglia della [0004](0004-il-grafo-e-i-link-non-wiki.md) vista prima di
farla.

### La scansione resta fatale, e non è una tolleranza dimenticata

Una cartella che non si lista fa ancora fallire l'intera apertura. Sembra la
stessa cosa che questa voce toglie, un livello più in su, e non lo è — la riga
precedente spiega perché.

Un documento che non si legge lascia il vault capace di dire **quali** documenti
esistono: l'elenco è intero, è il contenuto di una voce a mancare. Una cartella
che non si lista no: di ciò che c'è sotto non si sa niente, e `reconcile`
dichiarerebbe completo un insieme a cui manca un sottoalbero — cioè direbbe a
ogni indice di dimenticare tutto quello che c'era in quella cartella. Aprire
così vorrebbe dire potare gli indici sulla base di una verità parziale, in
silenzio, e lasciare all'utente un vault che sembra intero e ha una cartella in
meno.

Meglio non aprire. È il verso della [0065](0065-una-scrittura-o-c-e-o-non-c-e.md)
fra un danno raro e rumoroso e uno certo e muto, e non è chiuso per sempre:
renderla tollerante è possibile il giorno in cui `reconcile` saprà dire
«completo **tranne** sotto questo ramo», che è una firma del contratto e quindi
una decisione sua.

Questa metà ha un presidio più debole delle altre, e va detto: il caso vero — una
directory illeggibile per i permessi — non si provoca in modo portatile, e i test
girano anche su Windows e macOS. Il presidio che c'è
(`un_vault_che_non_si_scandisce_non_si_apre_a_meta`) usa una radice che non
esiste, quindi fissa il confine — un fallimento di scansione non diventa
un'apertura vuota — senza coprire il caso del sottoalbero.

### La forma dell'apertura non cambia, e il perché non è «non c'era tempo»

La seconda metà della voce — l'operazione a fasi, il progresso, la cancellazione
— resta aperta, e i tre pezzi hanno tre ragioni diverse.

**Il progresso** non è rimandato per fatica: oggi non arriverebbe a schermo. La
[0035](0035-il-lavoro-lungo-si-racconta.md) lo ha già scritto — `reindex` gira
dentro il prestito **esclusivo** del workspace, cioè quando nessuno può
disegnare — e ha anche scritto che il giorno in cui l'apertura diventerà
incrementale «*quella sarà una domanda vera, e la porta c'è già*». La porta c'è;
ciò che manca è togliere la scansione da sotto il `write()`, e quello è il lavoro
vero.

**La cancellazione** è dove il riuso sembra gratis e non lo è. Il runner
([0032](0032-il-runner-dei-job.md)) ha la cancellazione a bandiera, e se
l'apertura diventasse un job la erediterebbe senza aggiungere niente al
contratto. Ma la 0032 dichiara anche il proprio limite: la bandiera la scopre chi
**chiama l'host**, perché un job non interroga niente — è `JobHost` a rifiutare
di servirlo. Una scansione che cammina il disco senza toccare l'host arriverebbe
in fondo lo stesso. Quindi anche a metà voce fatta, «annullare l'apertura di un
vault enorme» resta da decidere, e non è la stessa decisione di «l'apertura è un
job».

**La forma a fasi** è la decisione grossa, e ha un prezzo misurato che nessuno ha
ancora deciso di pagare. La [0024](0024-chi-legge-non-aspetta-chi-legge.md) ha
misurato che `reindex` tiene il workspace in esclusiva ~780 ms su 2000 note, e ha
notato che oggi quel lock non affama nessuno **solo** perché `Host::open` lo
chiama su un `Workspace` che possiede ancora, prima di avvolgerlo nell'`Arc`.
Quella proprietà è ciò che cade nel momento esatto in cui l'apertura diventa
osservabile: se qualcuno può chiedere a che punto è, il workspace è già
condiviso, e la scansione entra in contesa con chi legge — e un `RwLock` che si
avvelena sotto un prestito esclusivo che pania si porta via il vault.

Tutto questo è una decisione intera, e va presa guardando quel numero. Non è
questa.

## Cosa NON è cambiato, e perché è la parte da guardare

**Nessuna variante di contratto e nessun ponte IPC nuovo** — i ponti restano
sei, e `dieta_ipc` non ha avuto niente da dire. L'`Apertura` è un tipo del
kernel, `unread` è un campo di un record dell'host che passa da un comando che
c'era già: il freeze di M4 non ne sa niente e `wit_additivity` non aveva niente
da guardare. È lo stesso confine su cui stava la 0064 col supporto, e per la
stessa ragione — ciò che non attraversa il contratto non paga il prezzo del
contratto.

**`IndexProvider` non è stato toccato.** La tentazione era dare agli indici un
modo di sapere che questa alimentazione è un'apertura parziale. La 0051 ha già
chiuso quella porta con una riga che vale ancora: la dimensione del lotto è
politica dell'host e un indice non deve dedurne niente. Un indice non ha bisogno
di sapere perché un documento non gli è arrivato — non gli è arrivato, e
`reconcile` gli dice che esiste lo stesso.

**L'ordine parse-prima-di-mutare è rimasto, e il commento che lo spiegava è
cambiato.** Quella riga esisteva per tenere il tutto-o-niente: «un parse fallito
a metà lascia il workspace com'era». Adesso che un parse fallito non è più
fatale, quel perché è morto — ma la riga vale ancora, per un motivo diverso: gli
indici si svuotano una volta sola, a lettura finita, invece di restare vuoti per
tutto il tempo in cui si cammina il disco. Riscrivere il commento invece di
lasciarlo era il minimo: era prosa che sarebbe diventata falsa senza che niente
diventasse rosso.

**I presidi si sono verificati rossi**, come la 0066 col lock e la 0067 con sei
sabotaggi: **otto su otto**. Rimettere il `?` sulla lettura (quattro test rossi);
rimetterlo sul parse; togliere l'emissione dei guasti; emettere `Warning` invece
di `Failure`; emettere i guasti **dopo** `VaultOpened`; togliere gli scarti
dall'insieme di `reconcile`; far tornare un'apertura vuota quando la scansione
fallisce; far arrivare a `VaultInfo` una lista vuota. I due che contano di più
sono il quinto e il sesto: il quinto perché l'ordine degli eventi è il genere di
cosa che un test scritto male non guarda, e il sesto perché è il difetto che il
presidio ha **trovato** invece che confermare.

## Cosa resta scoperto

**La seconda metà del §15.7**, con le tre ragioni scritte qui sopra. La voce
resta aperta, e chi la prenderà trova il prerequisito fatto.

**La shell non ha ancora dove dirlo**, ed è il §20.4. Il campo `unread`
attraversa l'IPC e il mirror TS ce l'ha — la fixture pretende che i due lati
combacino — ma nessuna superficie lo disegna: un vault che si apre a metà si
racconta oggi solo attraverso il centro notifiche, cioè attraverso gli eventi
`trouble`, con l'avvertenza del §20.5 che li rende best-effort. Il campo c'è
perché chi chiama possa distinguere i due casi, che è ciò che il §15.7 chiede al
kernel; mostrarli è di un'altra voce, che esiste e ha un numero.

**`EventMask::all()` non nomina `EventKind::Trouble`**, e l'ha trovato il
presidio: un `EventHandler` che chiede *tutto* non riceve i guasti. Il centro
notifiche funziona perché il ponte verso la shell prende i `Notice` dal bus e non
passa da una maschera, quindi non è un difetto vivo — ma è una promessa che vale
a metà e in silenzio, e nel posto peggiore: la parola «all». Non si tocca qui —
è `fub-abi`, è materia della 0052, e cambiare cosa riceve un handler che ha già
scritto `all()` è una decisione con un verbale suo — e resta segnalata.

**Un documento illeggibile perde il `meta` che l'anagrafe ne ricordava**, cioè
il frontmatter e l'outline. La sua voce resta, con dimensione e data; l'impronta
la conserva solo se l'anagrafe ne aveva già una che descrive ancora quel file —
altrimenti non si è potuta calcolare, perché calcolarla vuol dire avere avuto i
byte in mano. Il `meta` invece si perde in ogni caso, perché la strada che lo
rimetterebbe passa dal confronto fra l'impronta nota e quella di adesso.

È coerente — quei metadati descrivevano un contenuto che stavolta nessuno ha
visto — ma vuol dire che una nota illeggibile all'apertura perde anche il titolo
che il pannello mostrava ieri. Chi vorrà tenerlo dovrà decidere se un'anagrafe
possa portare avanti ciò che sapeva di un file la cui dimensione e data non sono
cambiate: è una domanda del §15.2 sul recovery, non di questa voce, e nessun
presidio la copre — i test di questa voce usano file nuovi, che un'impronta nota
non ce l'hanno.
