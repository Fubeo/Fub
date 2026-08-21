# 0107 — Il caso di una lettera: chi è candidato, chi ha ragione, e chi non può avere ragione

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§23.8](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#238-due-file-che-differiscono-per-una-maiuscola-sono-lo-stesso-arco)
**Commit**: *(questo commit)*

---

## La domanda

La [0004](0004-il-grafo-e-i-link-non-wiki.md) ha deciso che la chiave con cui
due nomi si scoprono lo stesso nome fa `trim`, NFC e **minuscolo**, e l'ha
motivata con una riga difficile da contestare: *«il vault sincronizzato fra
macOS e Linux è lo stesso vault»*. Un link scritto su un Mac deve risolvere su
Linux, e il caso è l'unica cosa che li separa.

Il prezzo sta dall'altra parte e il verbale non lo nomina. Su un filesystem
case-sensitive `Nota.md` e `nota.md` sono **due file veri**, che un utente può
avere e che un client di sync può creare senza chiedere. Per il grafo erano una
chiave sola: i backlink dell'uno finivano sull'altro, e una rinomina riscriveva
riferimenti che puntavano altrove. Non è un link che non risolve — è un link che
risolve **al file sbagliato**, che è il modo peggiore in cui questa famiglia
possa rompersi, perché non lascia traccia.

## Cosa la misura ha cambiato, prima di progettare

**Il nesso su cui la voce si reggeva è falso.** La voce diceva: *«è la stessa
forma della regola che la 0004 ha già scritto per l'estensione — prima l'esatto,
poi il senza»*, e chiedeva di applicarla al caso. Ma il ramo «esatto» di
`resolve_path_key` confrontava `resolution_key(id) == key`, cioè **due chiavi
già minuscolate**: quella forma non poteva distinguere il caso nemmeno in linea
di principio. Non c'era una regola da riusare, c'era una funzione che non
esisteva — e la sua assenza spiega perché nessuno avesse mai chiuso questa voce
prendendola per una riga.

**La seconda premessa falsa è di verso opposto e vale di più.** La voce
proponeva di dire la collisione «come la
[0090](0090-una-sequenza-e-una-modalita-che-scade.md) dice i conflitti di
scorciatoia all'avvio». Quella forma è **interamente di shell**: si calcola dal
registro statico dei comandi, non passa da nessun evento né da nessuna
diagnostica di kernel, e la shell non ha l'anagrafe. Il modello non era
riusabile per un fatto che vive nel kernel — ma il posto giusto c'era già ed è
migliore: `IndexQuery::VaultHealth`, che chiede al grafo e ai modelli in memoria
e che dalla [0046](0046-l-anagrafe-del-vault.md) ha accanto anche l'anagrafe.

**E `graph_incremental.rs` non presidiava niente di tutto questo.** Il suo
oracolo è il full-rebuild: se incrementale e rebuild sbagliano **allo stesso
modo** — che è esattamente il caso del collasso di maiuscole — resta verde. La
voce lo indicava come il presidio contro cui misurare il rischio; è invece il
presidio strutturalmente cieco a questa specie di difetto.

## La decisione, in tre pezzi

### 1. Una seconda chiave accanto alla prima, non al suo posto

`resolution_key` non cambia di una riga, e non deve: la ragione della 0004 regge
per intero. Accanto nasce `exact_key` — trim e NFC, **senza** il minuscolo — e
la differenza fra le due si scrive in una riga:

> `resolution_key` dice **chi è candidato**, `exact_key` dice **chi ha ragione fra
> i candidati**.

Da qui la forma del codice. Gli indici del grafo restano indicizzati **per
chiave**, quindi `watchers`, `refs_by_key`, `dep_keys` e tutta l'invalidazione
incrementale non cambiano; ciò che cambia è la **scelta fra i candidati di una
chiave**, che prima era `first()` — l'ordine ASCII — e adesso è: chi combacia
esattamente, e in sua assenza il primo per priorità, cioè la regola di prima
intera. Con un candidato solo le due si comportano identiche, ed è la ragione
per cui `[[nOtA]]` continua a trovare `sub/Nota.md`: la case-insensitivity non
si è ristretta, si è **ordinata**.

**Gli alias restano fuori, ed è una scelta.** Dietro un path e un nome pagina
c'è un **file**, che il filesystem distingue e la chiave no: lì «chi ha ragione»
è una domanda con una risposta sul disco. Un alias è una dichiarazione dentro un
frontmatter, e due documenti che dichiarano `NASA` e `nasa` non sono due file
omonimi: sono due rivendicazioni ugualmente valide, e nessun fatto dice quale
l'utente intendesse. Lì l'ambiguità è **genuina**, e la priorità resta la
risposta.

### 2. La riscrittura al rename verifica la condizione invece di affermarla

Il difetto peggiore stava **fuori dalla voce**, per l'ottava volta di fila, e
non è una risoluzione a schermo: è il riferimento che Fub **scrive su disco
dentro i documenti di terzi**, cioè quello che un altro programma leggerà fra un
anno.

`link_rewrite_plan` sceglieva fra due forme — il nome pagina se nessuno lo
contende, altrimenti il path senza estensione — e giustificava la seconda con un
commento: *«che è sempre univoco»*. **Falso.** La chiave di `path_index` è
`resolution_key(strip_ext(…))`, quindi `sub/Altra.md` e `sub/Altra.txt` la
condividono: il path senza estensione è una chiave, e una chiave si contende
esattamente come si contende un nome. Adesso le forme sono tre, e la seconda
condizione si **verifica** invece di affermarla.

**La strada elegante non è percorribile, e lo si scopre solo provandoci.** La
risposta giusta non sarebbe una regola affatto: sarebbe **provare** il
riferimento, chiedendo al grafo se quella stringa torna davvero a `to`. Non si
può — questo piano si calcola *prima* che il rename sia applicato, quindi il
grafo conosce ancora `from` e non ha mai sentito nominare `to`; ogni candidato
risulterebbe sbagliato e la riscrittura scriverebbe sempre la forma più lunga.
Resta una regola, e ciò che è cambiato è che la condizione adesso la si misura.
Va scritto qui perché è la specie di ostacolo in cui **la prima strada che
compila sarebbe stata peggiore della regola che sostituiva**.

### 3. Dove nessuna regola può avere ragione, si dice

È il pezzo che trasforma «un difetto silenzioso più piccolo» in una voce chiusa,
e il fatto che lo rende indispensabile nessuno l'aveva scritto:

> **In radice, il collasso del caso non è esprimibile con un wikilink.**

`resolve_key` consulta l'indice dei path solo se la chiave contiene `/`. Per
`Nota.md` e `nota.md` nella radice del vault non esiste **nessun wikilink** che
disambigui: la terza forma della riscrittura non ha un path da scrivere che sia
diverso dal nome, e `exact_key` aiuta chi ha scritto la forma giusta ma non ha
niente da dire a chi scriverà `[[nota]]` domani intendendo l'altro. Quando
l'ambiguità non è esprimibile nella lingua dei link, l'unica risposta possibile
all'utente è **dirgliela**.

Da qui `HealthCheck::CollidingPaths`, terzo caso in coda a un enum che ne aveva
due — additivo, `health-check` è nel frozen e un caso in fondo passa
`wit_additivity`; `HealthIssue` aveva già la forma giusta (`doc` più un `detail`
leggibile), quindi **nessun record cambia**. L'implementazione sta in
`kernel/health.rs`, l'unico posto con grafo e anagrafe insieme, e cammina
**l'anagrafe** e non i documenti: `foto.PNG` e `foto.png` collidono esattamente
come due note, e se l'elenco fossero le note nessuno li vedrebbe. Due dettagli
che sono decisioni: la chiave è quella del path **intero, con estensione** —
`nota.md` e `nota.txt` sono due file che si distinguono benissimo e segnalarli
sarebbe il rumore che rende inutile un controllo di salute —, e si emette una
issue per **ogni** membro del gruppo, perché appenderla a uno solo vorrebbe dire
sceglierlo, che è la stessa asimmetria arbitraria che questa voce è venuta a
togliere.

## Le due bugie riparate, e perché erano bugie

`rules/path_policy.rs` dichiarava, sotto il titolo «Cosa NON è duplicato qui»:
*«un vault che contiene `Nota.md` e `nota.md` è già ambiguo per il grafo prima
di esserlo per il filesystem, e la risposta è una sola perché la domanda è una
sola»*. È il tipo di riga peggiore che un modulo possa contenere: dichiara
**coperto** ciò che non lo è, e chi la legge smette di guardare.
`resolution_key` non *rileva* l'ambiguità, la **collassa in silenzio**. E la
domanda non era una: erano tre, e adesso hanno tre risposte diverse — quali nomi
sono candidati, chi ha ragione fra i candidati, e cosa si fa quando nessuno può
avere ragione.

L'altra è il commento di `link_rewrite_plan` già detto sopra. Le due si
somigliano e la somiglianza è la lezione: **entrambe affermavano un'univocità, e
in entrambi i casi l'univocità era la conclusione che si voleva, non un fatto
misurato.**

## La verifica del rosso, e cosa ha cambiato

Nove guasti, uno alla volta. Sette hanno prodotto il rosso atteso, e due no:

**Il ramo di produzione senza presidio.** Togliendo la terza forma della
riscrittura — cioè rimettendo esattamente la bugia appena riparata — la suite
resta **verde su 110 banchi**. Il caso non era raggiungibile con un solo formato
registrato, perché due documenti `.md` che condividono lo stem differiscono solo
per il caso e lì `exact_key` risolve: serve un **secondo formato**, che è la
normalità appena un plugin ne porta uno.
`rename_to_a_contended_path_writes_the_whole_path` registra due provider e prova
che il riferimento scritto è il path intero. Senza questa verifica, questo
commit avrebbe riparato una bugia sostituendola con un ramo che nessuno
esercitava.

**La zona cieca del presidio nuovo, costruita apposta.** `HealthCheck::ALL`
porta il presidio dei discriminanti della
[0104](0104-la-superficie-di-scrittura-si-presta.md), e la prima stesura ne
aveva solo le due metà ovvie — lunghezza e posizione. Costruito il caso,
`ALL = [BrokenLinks, BrokenLinks, CollidingPaths]` **passava**: la lunghezza
torna, e il giro visita `BrokenLinks` due volte trovandola al suo posto tutte e
due le volte. È il modo in cui un elenco si accorcia senza accorciarsi — si
perde una riga e si fa tornare il conto con un doppione — e lo prende solo
l'aritmetica dei discriminanti, che è stata aggiunta.

**Un secondo difetto fuori dalla voce, trovato dal terzo guasto.** L'elenco dei
controlli che il rapporto diagnostico esegue era **tre righe scritte a mano** in
`workspace.rs`, e il presidio che lo guardava pretendeva
`json["health"].is_array()` — cioè un array con dentro un controllo su tre lo
soddisfaceva. Un controllo di salute nuovo che qualcuno si fosse dimenticato di
elencare lì non avrebbe reso rosso niente: il rapporto sarebbe restato valido,
con una riga in meno. Adesso il rapporto itera `HealthCheck::ALL` e il presidio
confronta la lunghezza con quella dell'enum. **È la forma della 0104 e della
0105 su un terzo insieme**, e vale la regola stretta che ne esce: *un presidio
che chiede «è della specie giusta?» a una risposta che è un elenco non sta
guardando l'elenco.*

## Cosa non si è fatto, e perché

**Il mirror TypeScript di `resolution_key` non cambia.**
`frontend/src/rules/mirrored.ts` la reimplementa, ma la shell non risolve link:
chiede `IndexQuery::Resolve` ([0043](0043-il-path-e-la-chiave.md)). Aggiungere
lì una `exact_key` senza un cliente sarebbe stato codice da tenere allineato per
niente.

**Non si è scritto «è raro, si lascia»**, e non per scrupolo: la
[§23.16](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2316-su-windows-un-hardlink-si-stacca-in-silenzio)
usa questa voce come **precedente sulla parola «raro»**, e chiuderla così avrebbe
reso falsa quella riga e la voce con lei. Qui «raro» vuol dire *raro finché il
vault sta su un disco solo*, ed è la famiglia del sync, dove due macchine con due
filesystem diversi sono il presupposto e non l'eccezione.

**Nessuna riparazione automatica.** Rinominare uno dei due file è una decisione
dell'utente sui suoi dati, e sceglierla per lui vorrebbe dire scegliere **quale
dei due** ha il nome sbagliato — che è la domanda a cui nessuno ha una risposta.
Il controllo dice *dove*; cosa farne resta di chi possiede il vault.
