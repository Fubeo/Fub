# 0097 — Un recinto che vale anche quando nessuno guarda

**Data:** 2026-08-04
**Voce:** [§23.3](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#233-due-bloccanti-caduti-e-la-rete-non-se-nè-accorta)
**Commit:** *(questo commit)*

## Il fatto

La [0013](0013-elenco-delle-capacita.md) ha tenuto `http_fetch` fuori
dall'elenco delle capacità con **due bloccanti nominati**, ed è la forma
migliore in cui un no si possa scrivere: *«servono prima §9.1 (un lavoro lungo
che vede il vault) perché sia utile e §7.3 (`network` letto da qualcuno) perché
sia sicura. Due bloccanti, entrambi nominati; dopo, additiva.»*

Sono caduti tutti e due — il primo con la
[0027](0027-il-lavoro-lungo-vede-il-vault.md), il secondo con la
[0021](0021-il-confine.md), che aveva scritto perfino la riga d'innesto — e
**nessuno se n'era accorto per settantasei verbali**. Adesso c'è
`HostNetwork::fetch`, quindicesima famiglia del contratto e **diciottesima** del
`Guard`, con `fub:network` a governarla.

Ma la riga che vale il verbale non è quella. È questa: **`fub:network` porta
come parametro una allowlist di host, e da questo commit quell'elenco si
legge.** È il primo parametro di permesso che questo repo onori — la
[0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) gli aveva dato la forma
nel 2026, e per ottanta verbali è rimasto un dato che nessuno interrogava.

## Perché si è cominciato da qui e non dai prefissi di path

La casella del [§7.1](../roadmap/07-il-confine.md#la-casella-rimasta) dice che
*«le allowlist dei permessi non filtrano»* e il caso che nomina è `read-vault`
ristretto a `Progetti/`. Quella casella è più vecchia, più citata e ferma da
trentadue verbali: la scelta di non partire da lì va argomentata invece che
subita.

L'argomento è che **i due divari non sono la stessa cosa**. Un `read-vault`
ristretto a `Progetti/` che legge tutto il vault è un recinto che perde: brutto,
additivo, e con un criterio già scritto. Un manifest che dice *«mi connetto solo
a api.acme.com»*, **mostrato all'utente**, **accettato dall'utente**, e che poi
consenta qualunque host non è un recinto che perde — è una **frase falsa scritta
dall'app**. La differenza sta in chi ha letto la promessa: un prefisso di path è
una restrizione che un plugin si dà, un host è una destinazione che l'utente ha
approvato. La seconda ha un firmatario, e mentire a un firmatario è di un'altra
specie.

C'è poi una ragione di sequenza: qui la capacità **nasce adesso**. Farla nascere
col parametro già onorato costa quanto farla nascere senza, mentre onorarlo dopo
vorrebbe dire che per un tempo indefinito è esistito un permesso di rete che
prometteva un recinto inesistente. Un difetto che non si è mai spedito non è un
difetto.

## `Policy::denies_host`, e perché è stretta di proposito

La politica sapeva rispondere a una domanda sola — *questa famiglia, sì o no* —
e adesso ne sa due. La seconda è `denies_host(&str)`, e la tentazione era
scriverla generica: *«questo bersaglio, per questa famiglia»*, così che il
giorno dei prefissi di path la firma ci fosse già.

È stata **scartata**, e per due ragioni che si sommano. La prima è la regola che
questo repo applica da otto verbali (0077, 0090, 0091, 0092, 0093, 0094, 0095,
0096): una firma preparata per un chiamante che non esiste è una bugia
strutturale, e qui il chiamante generico non esisterebbe proprio — c'è una sola
famiglia il cui parametro si onori.

La seconda è più interessante, perché dice che la firma generica sarebbe stata
anche **sbagliata**. Un path e un host non si confrontano allo stesso modo: un
path si confronta **per prefisso, dentro una radice che è dell'utente**, dove
`Progetti/` che copre `Progetti/2026/` è ciò che chiunque si aspetta; un host si
confronta **per nome, dentro uno spazio che non è di nessuno**, dove `acme.com`
che copre `evil-acme.com` è una consegna del dominio di qualcun altro. Una
funzione sola avrebbe avuto due semantiche, che è precisamente il timore che la
0021 scrive nel suo bloccante — *non nascere con due idee di cosa sia un
filtro*. Il timore non si applica a due funzioni su due domini disgiunti; si
sarebbe applicato in pieno alla firma generica che sembrava prepararlo.

Il default di `denies_host` è `None`, e va detto perché sembra permissivo: una
politica che non sa niente di host non deve **inventarsi** un no. Chi il recinto
ce l'ha è `Granted`, che è l'unica che legga un manifest.

## Le tre righe che rendono l'allowlist vera invece che decorativa

Un'allowlist si scavalca in modi che non hanno niente a che fare col permesso, e
sono la parte del lavoro che la voce non nominava.

**I redirect non si seguono**, ed è la riga su cui poggia tutto il resto. Un
host dichiarato che risponde `302` verso uno che non lo è porterebbe fuori dal
recinto **senza che nessuno l'abbia deciso** — e un client che li segue lo
farebbe **in silenzio**, perché l'allowlist non ce l'ha e non deve averla. Qui
il `3xx` torna a chi ha chiesto col suo `Location`
(`HttpResponse::redirect_to`), e seguirlo è una **seconda chiamata**, che
ripassa dal cancello. Il test si chiama
`a_redirect_out_of_the_fence_is_a_second_call_and_is_stopped`, e senza questa
riga l'intera voce sarebbe stata una decorazione.

**`*.acme.com` è obbligatorio per i sottodomini.** Una `ends_with` nuda
regalerebbe a chi dichiara `acme.com` anche `evil-acme.com`, che è il dominio di
qualcun altro registrato apposta. Il `*.` chiede un livello **proprio** in più,
quindi `acme.com` sotto quella forma non copre nemmeno sé stesso: *«voglio anche
i sottodomini»* diventa una cosa che si **dice** invece di una che succede.

**Le credenziali si scartano.** `https://api.acme.com@evil.example/` ha un
«host» che un umano legge come dichiarato e una macchina risolve altrove: è il
modo più vecchio che esista di far leggere due indirizzi diversi a due lettori
diversi. `split_url` prende ciò che sta dopo l'**ultima** `@`.

## `http` in chiaro è rifiutato, e l'eccezione è una scelta di prodotto

In chiaro l'allowlist promette un host e la rete ne consegna un altro: chiunque
stia in mezzo può rispondere al posto di `api.acme.com`, e il recinto che
l'utente ha approvato non vale più niente. Quindi `https` o niente.

L'eccezione è l'anello locale, e **non è una comodità**.
`http://localhost:11434` è dove gira un **modello locale** — è l'indirizzo di
Ollama, e non per caso — cioè l'unico modo di usare l'AI senza mandare le
proprie note a qualcuno. Negarlo avrebbe tolto dal contratto proprio la strada
più privata, obbligando chi vuole un assistente a passare per un servizio
remoto: la regola scritta per proteggere l'utente lo avrebbe spinto verso la
scelta peggiore per lui. Verso sé stessi non c'è rete da attraversare, quindi
l'argomento del TLS non si applica e l'eccezione non costa niente.

## `fub:network` senza parametro è *qualunque host*, e la tentazione di ribaltarlo

C'è stata, ed è stata scartata **per iscritto**. Ribaltarla — *«senza elenco,
nessun host»* — sembra la scelta prudente, e sarebbe la sola chiave del
contratto la cui **assenza di parametro significa il contrario che altrove**. La
regola di `OptionMap` è uniforme: presente = acceso, il valore è il parametro. È
la sola proprietà per cui una mappa sola governa quattro sedi — *chi ne impara
una le sa tutte* — e romperla per una chiave costa più di quanto renda.

Ciò che cambia **resta dove deve**, cioè nella frase che l'utente legge
accettando: *«può connettersi a qualunque host»* non è la stessa frase di *«può
connettersi a api.acme.com»*, e la differenza la deve vedere chi decide, non il
cancello. Che oggi quella frase non gliela mostri nessuno è il debito che questo
verbale conta invece di dichiarare (in fondo).

## Una `DryRun` che scarica non è una simulazione

`ReadOnly` **nega** `Network`, e l'argomento sta nel registro che il `Guard`
tiene già per `Services`: là un servizio può uscire dalla simulazione perché
gira con le capacità di chi lo offre; qui **l'effetto non è nell'host**. Un
`POST` crea qualcosa dall'altra parte. E perfino un `GET` viene contato,
fatturato e registrato da chi risponde — cioè è la sola specie di effetto che
questo processo non può ritirare **nemmeno volendo**.

`run_command` invece resta concesso in simulazione, e la differenza è esatta: il
comando invocato riceve a sua volta un host simulato, quindi è una **catena che
l'host governa**; una `fetch` è un **mondo che l'host non conosce**.

## I tipi: byte, e un `404` che è un `Ok`

**Byte e non testo**, ed è la
[0087](0087-il-testo-che-sta-dentro-gli-allegati.md) letta **al contrario** per
una differenza vera. La 0087 dice che per i documenti il testo è il default
perché *«chi legge del testo non deve poter dimenticare di decodificare»*. Per
una risposta HTTP la stessa regola dà il risultato opposto: un file sul disco
non dice di che codifica è, **una risposta HTTP sì**. Ma metà della rete
risponde `image/png` o `application/pdf`, e un corpo `string` costringerebbe
l'host a decidere per tutti e a sbagliare per chi scarica un allegato. Il
`content-type` sta **fra gli header**, dove HTTP lo mette, e non c'è un campo
accanto: sarebbe lo stesso dato in due posti che possono non essere d'accordo —
la trappola che la [0007](0007-contesto-di-sessione.md) descrive per
`active-document`. `HttpResponse::content_type()` è **codice** e non contratto,
quindi non può divergere.

**Un `4xx` o un `5xx` sono `Ok`.** L'errore è *non aver potuto chiedere*, e
arriva come `PluginError::Io`. Le due si correggono in modi opposti — a un `404`
si risponde guardando la risposta, a un guasto riprovando o dicendolo a chi
guarda — ed è la stessa distinzione che la
[0041](0041-un-errore-e-testo-che-qualcuno-legge.md) fa fra un errore e un
esito, applicata al filo.

**`Unserved` e non `Internal`** su un host montato senza client: non è un
permesso che manca, è che di qua non ci passa nessun filo, e chi lo riceve deve
poterlo dire diversamente. **Il tetto di tempo e quello del corpo non
attraversano il confine**, per la regola della
[0094](0094-un-tetto-che-si-fa-sentire.md) — *un limite dell'host dev'essere
visibile quando morde, non interrogabile* — quindi stanno in
`fub-host/src/net.rs` e superarli è un `Io` che lo dice, col numero che resta
alzabile.

## I tre ritrovamenti

Sono le cose che la voce non diceva e che il lavoro ha trovato.

### 1. La prima capacità la cui durata non la governa l'host

Ogni riga di `fub-host/src/jobs.rs` delega dentro `reading` o `writing`, cioè
**tenendo il lock del workspace per il tempo della chiamata** — microscopico per
una lettura di documento. Una `fetch` dura quanto la rete.

Tenere il prestito condiviso per quel tempo affamerebbe **chi scrive**, che è
precisamente il difetto contro cui la
[0024](0024-chi-legge-non-aspetta-chi-legge.md) ha scelto l'`RwLock` — e lo
farebbe su una chiamata **che il vault non lo tocca affatto**. Quindi
`JobHost::fetch` prende il lock per un istante (il permesso e il filo) e poi lo
**molla**, e monta lo stesso `Guard` di tutti gli altri fuori: il cancello resta
uno solo, e chi gira dentro un job non ne attraversa uno più largo.

Il permesso si **rilegge adesso** invece di catturarlo all'avvio del job, così
un plugin revocato mentre una richiesta è in volo trova il cancello chiuso alla
successiva. `&self` e non `&mut self` su `fetch` — a differenza di
`call_service`, che pure è un effetto — è la proprietà che rende tutto questo
possibile.

**Resta una casella, ed è contata**: fermare la richiesta **già partita** è
un'altra domanda e non ha risposta qui. Chi annulla non aspetta la rete, aspetta
il tetto di tempo dell'host — fino a sessanta secondi, cioè un tempo che un
utente che ha premuto «annulla» **vede**. È contata e non solo dichiarata perché
ha le due proprietà che distinguono una casella da una riga di prosa: è lavoro
**già deciso** nella sua direzione (il `CancellationToken` della
[0032](0032-il-runner-dei-job.md) esiste, manca il filo che lo porti dentro il
client) e ha un sintomo che l'utente sente.

### 2. Il presidio ha preteso la riga da solo

`every_structural_capability_is_refused_by_the_same_gate` è diventato **rosso da
solo** appena `ReadOnly` ha cominciato a negare `Network`, dicendo esattamente
cosa aggiungere e dove — la chiamata a `fetch` dentro `TriesEverything` in
`kernel/tests/invoke_command.rs`.

Vale scriverlo perché è la **seconda volta in due commit** che un presidio
scritto da un verbale precedente fa il proprio mestiere prima del danno: nella
0096 era stato l'`assert` sui bit dell'`u16`. E soprattutto perché quel presidio
funziona così solo dalla 0094, che lo aveva riscritto perché calcolasse
l'insieme atteso da `Capability::ALL` invece di tenerne una copia. **Questo è il
primo giro in cui quella riscrittura ha pagato**: con la copia, aggiungere una
famiglia avrebbe lasciato il test verde e il buco aperto.

### 3. `reqwest` era già nel lockfile, e si è scelto `ureq` lo stesso

Ce lo porta `tauri`, quindi sta in `fub-app` e non in `fub-host`. Riusarlo
costerebbe meno righe di lock e **di più in tutto il resto**: è asincrono,
quindi vorrebbe `tokio` dentro `fub-host`, che oggi non ha un runtime e non ne
vuole uno per una capacità sola. `ureq` è bloccante, ed è la forma giusta per
questo posto — una `fetch` gira dentro un job, cioè su un thread del pool che
sta lì **apposta per aspettare**.

Il conto è **venti pacchetti** (551 → 571), il doppio di `jiff`: è la dipendenza
più cara che questo workspace abbia preso, e sta scritta nel `Cargo.toml` come
vuole quel precedente. Otto dei venti sono `platform-verifier`, e la scelta è
deliberata e va nel verso di chi usa l'app: con le radici imbarcate
(`webpki-roots`, dodici pacchetti) un utente dietro una CA aziendale scoprirebbe
che **«solo Fub» non si connette**, senza nessun modo di rimediare dall'app.
Otto pacchetti per non togliergli una decisione che ha già preso sul proprio
computer.

Le feature si dichiarano per esteso invece di ereditare i default, così quali si
prendono è **scelto**: `gzip` c'è, e non è la comodità che sembra — senza,
`ureq` non chiede la compressione **e non la sa disfare**, quindi un plugin che
si scrivesse da sé l'header `accept-encoding` riceverebbe byte che nel contratto
non ha modo di decodificare, perché una capacità che decomprime non esiste.
Costa **zero pacchetti** (`flate2` è già nel lockfile) e il tetto di `MAX_BODY`
si applica a valle della decompressione, cioè dal lato giusto. Restano fuori
`json`, `charset`, `brotli` e soprattutto **`cookies`**, che in un client
condiviso da tutti i plugin sarebbe uno stato che passa **fra plugin diversi**
senza che nessuno l'abbia dichiarato.

## Nessun ritaglio

La voce è **additiva** in senso stretto: un'interfaccia nuova (`net`,
`host-network`), quattro tipi nuovi, un `import` nel `world`, e **nessuna firma
esistente toccata**. La tabella dei ritagli di
[wit-congelato](../architecture/wit-congelato.md) registra le **sottrazioni** e
i cambi di forma su ciò che era già pubblicato; qui non ce ne sono, e
`wit_additivity` è verde — che è il segnale ma non l'argomento. L'argomento è
che il freeze di M4 chiude l'elenco delle capacità **alla sottrazione, non alla
crescita**: aggiungere una famiglia dopo il freeze costa una minor, e la 0013 lo
dice nella riga in cui chiude l'elenco.

## Non è una difesa contro un plugin ostile

Registro della seduta 22, tenuto dalla 0095 e dalla 0096 e che vale qui più che
mai: a M4 un plugin nativo gira **in-process**, e la rete del processo ce l'ha
comunque — `std::net` non passa dal `Guard`. Il valore del cancello è la
**dichiarazione**: che un plugin debba scrivere dove va, e che l'utente possa
vederlo e negarlo. Il giorno del confine WASM (M5) la stessa dichiarazione
diventa anche imposizione, e il fatto che la forma sia già decisa è metà del
lavoro; ma dire oggi che questo *protegge* da un plugin ostile sarebbe il
difetto che la seduta 22 ha contestato a chi l'aveva aperta.

## Cosa resta fuori

- **La cancellazione di una richiesta in volo** — casella residua contata, vedi
  il primo ritrovamento.
- **`external-fs`**, l'altra metà del punto elenco di
  [plugin-boundary](../architecture/plugin-boundary.md) che parlava di «rete e
  filesystem esterno»: quel punto descriveva due cose che non esistevano, e
  adesso ne descrive una vera e una ancora da fare.
- **I prefissi di path di `read-vault`/`write-vault`**, che restano la casella
  del [§7.1](../roadmap/07-il-confine.md#la-casella-rimasta). Quella casella si
  è **ristretta invece di chiudersi**: non si può più dire che *«le allowlist
  dei permessi non filtrano»*, perché una filtra.
- **Il punycode**: `normalized_host` non lo fa, quindi un host
  internazionalizzato va dichiarato nella forma in cui l'URL lo porterà. È un
  limite scritto invece che scoperto.

E **il pannello che i permessi li mostra**, che è la voce nuova qui sotto.

## Il debito che smette di essere dichiarato e comincia a essere contato

`fub:network` con la sua allowlist è comparso in `PluginInfo` da solo — cioè nel
dato che l'inventario porta alla shell — e **nessuna superficie lo rende
leggibile a chi deve accettarlo**. Finché è così, la frase del manifest è vera e
non la legge nessuno.

È la **terza volta di fila** che questo si dichiara in un «cosa resta fuori»: la
0095 per `fub:read-session` e `fub:read-selection`, la 0096 per
`fub:read-drafts`, questa per `fub:network`. Tre permessi nuovi in tre commit,
tutti invisibili a chi dovrebbe deciderli.

Qui pesa più che nelle altre due, e per una ragione che si può scrivere: quelli
della 0095 e della 0096 sono permessi **binari** — vederli o no cambia se
l'utente sa; questo ha un **parametro che è il permesso stesso**. La differenza
fra `fub:network` verso `api.acme.com` e `fub:network` verso qualunque host non
è una sfumatura, è la differenza fra un plugin che parla con un servizio e uno
che può mandare le note dell'utente ovunque — e sta **dentro** un dato che
nessuna schermata legge.

Quindi smette di essere una riga in fondo a un verbale e diventa la **§23.17**,
contata in [todo.md](../todo.md). È il momento in cui questo repo di solito
smette di dichiarare e comincia a contare, e la sua sede naturale è proprio la
seduta 23, il cui sottotitolo dice *«prezzi dichiarati da un verbale, ognuno in
una riga, che nessun elenco ha poi sommato»*: questo è letteralmente quello.

## Il presidio

- `the_manifest_says_where_and_it_is_true` — la voce intera in un nome.
- `a_redirect_out_of_the_fence_is_a_second_call_and_is_stopped` — la riga senza
  la quale l'allowlist sarebbe una decorazione.
- `credentials_do_not_borrow_an_allowed_name`,
  `a_wildcard_does_not_hand_over_someone_elses_domain` — i due modi di
  scavalcarla che non passano dal permesso.
- `no_allowlist_means_anywhere_and_that_is_the_uniform_rule` — la regola che si
  è scelto di non ribaltare.
- `without_the_permission_the_refusal_names_the_permission` — l'ordine dei due
  cancelli, che è il motivo per cui chi sbaglia legge la frase utile.
- `plaintext_is_refused_except_towards_this_machine` — la regola e la sua
  eccezione, che è una scelta di prodotto.
- `a_simulation_does_not_reach_the_network` — il varco della
  [0010](0010-comando-descritto-a-una-macchina.md).
- `il_client_nasce_senza_seguire_i_redirect` — perché un agent configurato male
  passerebbe da tutti gli altri restando verde, e i redirect sono metà del
  recinto.
- `un_guasto_del_trasporto_e_io` — e non ha bisogno di rete: la porta 1
  dell'anello locale non ascolta, quindi il test non diventa rosso su una
  macchina scollegata.
