# 0113 — Il banco conta le operazioni, perché su una macchina condivisa il tempo non è un segnale

**Stato**: accolta **Data**: 2026-08-06 **Chiude**:
[§17.1](../roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni)
**Commit**: *(questo commit)*

---

## La domanda

La §17.1 era già chiusa in tre parti — il corpus e il fuzzing con la
[0060](0060-il-modello-dice-il-vero-sui-byte.md), il round-trip sul corpus con
la [0061](0061-un-giro-che-non-passa-dal-modello.md) — e restava la quarta,
scritta così:

> **Benchmark su vault sintetici grandi** (10k/100k note) in CI, con soglie:
> tempo di apertura, ricerca, memoria. Senza numeri, "supporto vault enormi" non
> è verificabile.

Più una casella che la accompagnava: il presidio della §8.4
([0026](0026-due-query-insieme.md)) — *due ricerche stanno nell'indice insieme*
— oggi `#[ignore]`, «*il primo abitante*» del banco che non c'era.

La domanda non era se il banco valesse la pena. Era **quale numero un banco
possa davvero difendere**, perché la riga della voce ne nomina tre e tutti e tre
sono tempi.

## La decisione, in una riga

> **Il banco misura operazioni, non tempi**: quante volte si attraversa il
> confine per aprire un vault, quanti parse costa riaprirlo, quante allocazioni
> costa una pagina di venti righe — e di quest'ultima non si guarda il valore ma
> se **cresce col vault**. Un conto è lo stesso su qualunque macchina; un tempo
> no, e in questo repo c'è già la misura che lo dimostra.

## Il verso ingenuo, scartato avendolo detto

La forma della [0109](0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md)
vuole che un'alternativa rifiutata si scriva. Questa è: **una soglia in
millisecondi in CI**, come la voce la chiedeva.

Non si scarta per prudenza, si scarta perché **il repo ha già provato quel verso
e lo ha visto fallire**. Il presidio della §8.4 confronta due tempi — le stesse
ricerche in parallelo e in fila, nella stessa corsa — ed è la forma *migliore*
di una misura di tempo, perché il termine di paragone sta sulla stessa macchina
e nello stesso binario. In CI il rapporto è venuto **0,97** su ubuntu e **0,89**
su windows con la suite verde in locale, e la ragione non è che quei runner
siano lenti: ogni colonna misurava una trentina di millisecondi, e a quella
scala il tempo se lo prendono lo spawn dei thread e lo scheduling. Il rapporto
aveva smesso di misurare la propria proprietà e aveva cominciato a misurare il
vicino di banco.

Se **quella** forma non tiene, una soglia assoluta tiene ancora meno: o è così
larga che non scatta mai — e allora è un presidio che passa a vuoto, la classe
di difetto che questo repo ha già incontrato undici volte — o scatta su un
runner carico, e la prima volta che qualcuno la sposta «per farla tacere» il
presidio è morto senza che nessuno lo dichiari.

Il criterio generale, che vale oltre questa voce:

> **Un presidio deve misurare qualcosa che la macchina non cambia.** Il tempo la
> macchina lo cambia; il numero di volte in cui si fa una cosa, no.

## Le premesse della voce, misurate

- **«Senza numeri, *supporto vault enormi* non è verificabile»** — vera nella
  prima metà, **falsa nella seconda**: i numeri che rendono verificabile quella
  promessa non sono millisecondi, sono **conti**. Che un'apertura costi
  `ceil(N/512)` attraversamenti e non `N` è una proprietà del kernel; che una
  pagina costi lo stesso su trecento e su seicento note è una proprietà del
  kernel. Quanti secondi ci metta questo portatile non è una proprietà di
  nessuno.
- **«Vault sintetici grandi (10k/100k note)»** — non serve, ed è la premessa la
  cui caduta ha reso la voce chiudibile *da qui*. Un conto esatto è esatto a
  qualunque taglia. Il banco semina **seicento** note, che è il minimo che
  attraversa il lotto due volte, cioè il minimo che distingue «a lotti» da
  «tutto insieme»; centomila note comprerebbero solo un numero di secondi.
- **«Questo banco ha già un abitante che aspetta»** — **falsa**, e va detto
  senza giri: quel presidio misura un **rapporto fra due tempi**, e un banco che
  ha deciso di non misurare tempi non lo ospita. Il verso in cui la casella era
  scritta — «serve una macchina» — è vero e resta vero, e per questo diventa un
  buco dichiarato invece di una casella (sotto).

## Cosa misura il banco

`crates/fub-kernel/tests/il_banco.rs`, tre conti, dentro
`cargo test --workspace` come tutto il resto.

**Uno. L'apertura si conta in attraversamenti del confine.** Aprire N note
chiama `on_documents_indexed` `ceil(N / 512)` volte, non N. È il numero che la
[0051](0051-l-alimentazione-risponde.md) ha scelto e che **nessuno verificava**:
delle nove spie che implementano quel metodo nei test del repo, nessuna conta le
chiamate — o ignorano `docs`, o lo iterano registrando una riga **per
documento**, appiattendo esattamente il confine del lotto che il §20.1 esiste
per rendere raro. Con quelle spie `FEED_BATCH = 1` è indistinguibile da
`FEED_BATCH = 512`, e la frase scritta accanto alla costante — «*riduce di tre
ordini di grandezza gli attraversamenti di un reindex da 100k note*» — era una
promessa senza nessuno che la tenesse. A M5 ogni attraversamento è una
serializzazione: è *questo* il numero che vale, non quanti modelli ci passano
dentro.

**Due. La riapertura si conta in parse.** Riaprire un vault che nessuno ha
toccato costa **zero** parse: l'impronta in anagrafe combacia, gli indici dicono
di avere già tutto, e i modelli non si ricostruiscono. È «apri in fretta un
vault grande» detto in un numero invece che in millisecondi, e il numero non è
una frazione: è zero.

**Tre. La memoria si conta in allocazioni.** Il banco installa un
`#[global_allocator]` che conta le chiamate **per thread** — per thread perché
`cargo test` gira in parallelo, e un contatore condiviso misurerebbe il vicino,
che è precisamente il difetto da cui questo banco nasce. Il valore assoluto non
si asserisce mai e non vuol dire niente: si asserisce che **raddoppiando il
vault il prezzo di una pagina non cambi**. È un rapporto fra due misure sulla
stessa macchina, cioè l'unica forma in cui una misura di memoria sopravvive a
una macchina che non si conosce.

## Il difetto peggiore stava fuori dalla voce: `Page` prometteva e non faceva

Il doc di `Page` dice, da sempre:

> *Sta nella **domanda** e non solo nella risposta perché chi serve la query deve
> poter troncare prima di costruire il risultato: un vault con centomila note non
> deve materializzare centomila righe per mostrarne venti.*

**«Deve poter» non è «lo fa»**, e nessuno aveva mai guardato. Misurato con
l'allocatore: una pagina di venti righe dell'anagrafe costava **seicentotto**
allocazioni su trecento note e **milleduecentonove** su seicento — due per nota,
cioè esattamente la linearità che la finestra doveva togliere. Il difetto non
era nascosto: `Paged::window` è documentato lui stesso come «*ritaglia una
risposta già in memoria*», e le **nove** famiglie paginate dell'indice del
kernel passano tutte di lì, con un `.collect()` appena fatto davanti. Due prose
che si contraddicono a sessanta righe di distanza nello stesso file, e nessun
presidio in mezzo.

La riparazione è una terza strada accanto alle due che c'erano, scritta nel
posto che tutti attraversano: **`Paged::from_source`** conta la sorgente e
costruisce **solo la finestra**, in una passata sola. Il dettaglio che decide la
sua firma: `make` è un **argomento** e non un `.map()` sull'iteratore, perché
`from_source` arriva in fondo per contare e un `.map()` verrebbe applicato a
tutti — sarebbe la stessa linearità con un nome nuovo. E il `total` resta quello
vero: uno `skip`/`take` da solo darebbe la finestra giusta e un conteggio
sbagliato, cioè una barra di scorrimento che mente.

Le strade sono adesso **tre**, e quale sia percorsa è un fatto che il banco
misura invece di una promessa: paginare alla sorgente (tantivy), `from_source`
(chi ha una mappa e un filtro), `window` (chi deve **ordinare** o **aggregare**
prima di tagliare — un `sort` per proprietà deve vedere tutte le righe per
sapere quali sono le prime venti, e lì la linearità non è uno spreco: è la
domanda).

Convertita **una** famiglia, e la ragione per cui è una sola è la parte più
utile di questo verbale. `Entries` è l'anagrafe — la famiglia più grande che il
kernel serva, una riga per file del vault, allegati compresi — la fonte è un
iteratore, l'ordine è quello della fonte, e la clonazione sta dentro `make` e
non in un `.cloned()` sulla catena: dopo, quarantaquattro allocazioni su
trecento note e quarantaquattro su seicento.

Le altre due che sembravano candidate non lo erano, e a dirlo è stata la misura:

- **`Drafts`**: convertita e poi **rimessa com'era**. La linearità di quella
  famiglia sta *a monte* — `drafts.read()` apre e deserializza ogni bozza del
  disco prima che la finestra entri in scena — e il `map` che compone le
  `DraftInfo` **sposta** il testo invece di copiarlo, quindi costruirlo fuori
  dalla finestra non alloca. Il guadagno era zero, e un ramo di produzione che
  non guadagna niente è un ramo che nessun presidio può difendere: la verifica
  del rosso lo ha confermato togliendolo, e non è diventato rosso **niente** in
  centoundici binari. Chi vorrà rendere costante il prezzo di quella pagina deve
  paginare la **lettura**, che sta dall'altra parte.
- **`Folders`**: misurata, e resta dov'era. Costa **otto allocazioni per nota**
  — duemilaquattrocentotto su trecento note, quattromilaottocentonove su
  seicento — e `from_source` non la salverebbe, perché il prezzo non sta nel
  costruire ciò che si butta: sta dentro `make`, che per ogni cartella conta il
  proprio sottoalbero. È il caso che dice qual è il **limite** di questa forma:
  la finestra toglie ciò che si costruisce di troppo, non ciò che costa
  costruire ciò che si tiene.

## Il secondo difetto l'ha trovato il banco contando

Il conto della riapertura a caldo diceva *zero parse* e *due attraversamenti*.
Due attraversamenti di cosa: ogni fetta chiamava `on_documents_indexed` con un
lotto **vuoto**, perché tutti i suoi documenti erano stati ripresi dalla cache.
Un lotto vuoto non porta nessuna notizia a nessuno, e a M5 è una serializzazione
per dire niente. Una riga in `index_batch`, e adesso il conto è zero anche lì.

Nessun altro presidio poteva vederlo, e non per distrazione: **per vederlo
bisogna contare le chiamate**, e nel repo le chiamate non le contava nessuno.

## Il presidio che resta fuori, e perché è un buco dichiarato

`due_ricerche_stanno_nell_indice_insieme` resta `#[ignore]`, e questo verbale
smette di prometterle un banco che verrà.

La proprietà è vera e vale un presidio: `IndexProvider::query` prende `&self` e
il kernel la serve sotto prestito condiviso, quindi due ricerche possono essere
in volo insieme. Ma **non è esprimibile come conto**, e la ragione sta già
scritta nel test: contare chi è *dentro* `query` non distingue il caso buono da
quello cattivo, perché con un `Mutex` interno ci starebbero in due lo stesso,
uno dei quali fermo ad aspettare. Il compilatore non la vede (`Send + Sync`
chiede che chiamare da N thread sia *lecito*, non che sia *parallelo*); un conto
sui lock del sorgente prenderebbe la variante sbagliata, perché `query` un lock
lo prende davvero ed è giusto che lo prenda — la `RwLock::read` sui pesi dei
campi, che è condivisa e non serializza niente. Resta il tempo, e il tempo su
una macchina condivisa è ciò che questo verbale scarta.

Quindi: **buco dichiarato n. 6** — *la sovrapposizione di due ricerche non è
osservabile senza una macchina che non divida i core*. Si lancia a mano
(`cargo test -p fub-features --lib due_ricerche -- --ignored`), la soglia non si
sposta per farlo tacere, e dichiararlo è chiudere la voce invece di lasciarla
aperta (forma della [0064](0064-il-supporto-sta-sotto.md) e della
[0104](0104-la-superficie-di-scrittura-si-presta.md)). Un buco dichiarato non è
una casella e non entra in nessun totale.

Nello stesso giro è caduta una frase falsa che quel file dichiarava: il doc di
`commit` diceva di essere «l'unico punto in cui una query tocca un lock», mentre
`text_query` prende i pesi a ogni ricerca di testo — e il commento accanto ai
pesi chiudeva con «*il banco della seduta è lì per smentirmi se sbaglio*». Il
banco c'è, e ha smentito.

## Il ritaglio

**Zero WIT.** `Paged::from_source` è un costruttore su un tipo esistente: non
cambia nessun record, nessuna variante, nessuna firma del contratto — `paged`
resta quello che è nel frozen. **Zero dipendenze nuove**: l'allocatore che conta
sono venti righe di `std`, e il criterio della
[0001](0001-supply-chain-e-sbom.md) non ha niente da valutare.

## La verifica del rosso

Un ramo alla volta, sull'intero workspace e con `--no-fail-fast` — perché
`cargo test --workspace` si ferma al primo binario rosso, e «quanti presidi lo
vedono» è la domanda a cui un fermarsi presto risponde male.

- **`Entries` rimessa a `window` su un `.collect()`**: rosso, e **solo** il
  banco. Seicentotto contro milleduecentonove.
- **`make` applicato a tutti** invece che alla sola finestra (cioè il caso «un
  `.map()` caro sulla sorgente»): rosso, e il messaggio del banco è stato
  riscritto per questo — la prima versione diceva «è `window` dove andava
  `from_source`», che in quel caso manda a cercare la cosa sbagliata.
- **Il `total` che mente** (il conteggio della finestra al posto di quello della
  sorgente): rosso in **tre** presidi, e i due dell'anagrafe dicono i numeri
  meglio del mio — corretto anche quello.
- **`Drafts` rimessa a `window`**: **nessun test diventa rosso**, in centoundici
  binari. È l'informazione che ha cambiato il progetto, ed è per quello che il
  ramo non c'è più.
- **Tolto il `models.is_empty()`**: rosso, e solo il banco (`due` invece di
  `zero`).
- **`FEED_BATCH` a uno, e poi a diecimila**: in tutti e due i casi un solo
  presidio rosso in tutto il repo, e è il banco. Zero altri lo vedono, che è
  esattamente ciò che questo verbale afferma quando dice che le spie contano i
  documenti.
- **`up_to_date` ignorata**: rosso in tre presidi, mio compreso. Lì non era
  solo, e il banco lo distingue dall'altro guasto perché i due assert sono due.

**Le due zone cieche, cercate costruendo il caso.** La prima: il banco interroga
una famiglia sola, e le altre otto restano invisibili — è la misura di `Folders`
qui sopra, fatta apposta per vedere se il verde nascondesse qualcosa, e
nascondeva. La seconda è del contatore: se il lavoro caro emigra su un altro
thread la misura non lo segue — stesso lavoro identico, milleduecento
allocazioni sul thread del test e **sei** su un figlio. Non è un'attenuazione, è
una sparizione, e in verde. Sta scritta in testa al banco, perché il giorno che
una risposta venisse servita da un pool quella misura va **spostata** dove il
lavoro è andato, non allargata.

## Cosa resta

La voce si chiude, e con lei la **seduta 17**: le sue tre voci sono tutte
chiuse. Restano due caselle, che è un'altra cosa — quella della §17.3 sul `Gate`
dentro `Event::Trouble`, che è una decisione di firma e sta dove si guardano le
firme, e quella che questo verbale apre qui sotto.

Il banco è un posto, non un test: le **otto** famiglie dell'indice del kernel
che restano oggi non hanno una riga di banco, e di una — `Folders`, otto
allocazioni per nota — sappiamo già che è lineare e che `from_source` non
basterebbe. È una **casella nuova**, ed è onesto che sia una casella e non un
buco: si può fare, costa, e adesso ha anche il primo indirizzo dove guardare.
