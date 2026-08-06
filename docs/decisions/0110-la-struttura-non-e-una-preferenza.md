# 0110 — Cosa c'è nel vault lo dichiara il vault, e la struttura non è una preferenza

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§15.6](../roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione)
**Commit**: *(questo commit)*

---

## La domanda

Quali file di una cartella sono il vault? Fino a qui la risposta era un `&[&str]`
nel sorgente — `IGNORED_DIRS` — più una riga che ci aggiungeva «e tutto ciò che
comincia per punto», in una funzione (`is_ignored_name`) che scansione e watcher
chiamavano tutt'e due. La voce diceva che il difetto era la **costante**, e che
la 0036 aveva finalmente dato a quel dato un posto dove stare.

La costante però non è il difetto: è il sintomo. Il difetto è che quella lista
metteva nella **stessa specie** due esclusioni che non si somigliano affatto.

## La decisione, in una riga

> Ci sono **due** politiche di esclusione, non una: quella che l'utente dichiara
> e quella che nessuno può dichiarare. Finché erano una lista sola, «escluso»
> voleva dire insieme *ciò che nessuno può cambiare* e *ciò che nessuno può
> scegliere* — cioè il peggio delle due.

- **La struttura.** `.fub/` è dove Fub scrive; `.trash/` è il cestino condiviso
  con Obsidian; il temporaneo di una scrittura atomica vive dentro il vault per
  una frazione di secondo. Mostrarli vuol dire indicizzare l'indice, riesumare
  come documenti le note appena cestinate, e dare un `DocId` a un file che fra
  un istante non esiste più. Nessuna impostazione li rivela: è `e_struttura`, ed
  è il primo `if` di ogni domanda.
- **La preferenza.** Che `node_modules/` o `.git/` non siano note è vero quasi
  sempre e non è vero *per costruzione*; che i dotfile si vedano o no è una
  domanda con due risposte legittime. Sono **dato**, per-vault, e adesso sono
  due chiavi dichiarate: `files.excluded-folders` (una `List`, di cui la
  [0036](0036-le-impostazioni-e-i-tre-stati.md) scriveva già nel commento «*gli
  id dei plugin spenti, le cartelle escluse*») e `files.show-hidden`.

Il nuovo modulo è [`fub_kernel::ignore`](../../crates/fub-kernel/src/ignore.rs).
`IgnorePolicy` è un **valore** — l'elenco delle cartelle *più* la risposta sui
nascosti — e non un elenco: le due metà insieme sono ciò che una costante scrive
in una lista sola. La si risolve dalle impostazioni **a ogni domanda** e non al
montaggio, per la ragione della [0108](0108-una-data-la-dichiara-chi-possiede-il-vault.md):
chi cambia la dichiarazione cambia cosa il vault contiene, e una politica
risolta all'apertura direbbe di no anche dopo che l'utente ha riparato la causa.
Chi non ha impostazioni — un banco, un kernel montato senza il bundle del core —
prende il default, che è **esattamente** il comportamento di prima.

Di livello **vault** e non di macchina, e per la ragione della
[0076](0076-le-impostazioni-vivono-nel-vault.md) presa alla lettera: la politica
descrive *questi file*. Un vault che contiene un repo git lo contiene su tutti i
computer da cui lo si apre, e nasconderlo su una macchina sola sarebbe due idee
di cosa c'è dentro. Nessuna delle due è `program_writable`, e qui la ragione è
più stretta di quella del tema: un componente che potesse aggiungere una
cartella all'elenco **toglierebbe dal vault le note che ci stanno dentro**,
senza toccare un file e con l'unico segnale di un elenco che si accorcia.

## Il difetto peggiore stava fuori dalla voce — ed è la voce stessa a crearlo

`il_temporaneo_di_una_scrittura_non_e_un_documento`
([`storage.rs`](../../crates/fub-kernel/src/storage.rs)) dichiarava nel proprio
commento di presidiare **l'incastro fra due moduli**: *il nome del temporaneo lo
compone `storage.rs`, la regola che lo rende invisibile è
`vault::is_ignored_name`, e sono lontani abbastanza perché un giorno qualcuno
cambi il nome senza sapere che c'era una regola da rispettare.* L'insieme che
esercitava era però più piccolo della promessa: chiedeva alla **funzione pura**
se quel nome fosse ignorato, e il `true` che riceveva arrivava dal ramo
«comincia per punto».

Il giorno in cui un vault dichiara che i nascosti sono documenti — cioè questa
voce — quel ramo si spegne, il temporaneo di ogni salvataggio diventa un
documento per la scansione e per il watcher, e **il presidio che avrebbe dovuto
accorgersene resta verde**, perché interroga la regola invece della politica
risolta. Adesso interroga la politica **più permissiva che un vault possa
dichiarare** (`IgnorePolicy::declaring(Vec::new(), true)`), che è l'unico
insieme su cui quella promessa significhi qualcosa.

E perché resti vero, il temporaneo ha smesso di nascondersi dietro il punto: la
sua forma intera — punto, nome, `.tmp`, pid, sequenza — è una regola, e la dice
`e_temporaneo_di_scrittura` **accanto a chi compone il nome**, perché chi
conosce una forma è chi la scrive. La politica chiede *se* partecipa; il modulo
che lo crea risponde *qual è*.

## Le premesse della voce, misurate

- **VERA**: `IGNORED_DIRS` era una costante, la regola stava in un punto solo, e
  quel punto solo era la cosa giusta — non è cambiato: la politica sta in un
  posto e le due porte d'ingresso (scansione e watcher) la chiedono a lui.
- **FALSA**: «*un `IgnorePolicy` che non li nomina lascerà il comportamento dei
  symlink a `std::fs`, che li segue senza chiedere*». Non li segue: la
  [0058](0058-un-nome-che-nasce.md) ha fatto chiedere la specie con
  `file_type()`, che **non** segue il link, e un collegamento arriva come
  `EntryKind::Other`. Il comportamento era già quello giusto; ciò che mancava
  era che fosse **deciso** invece che *successo*.
- **FALSA nel puntatore**: i numeri di riga di `vault.rs` erano quelli di prima
  della [0106](0106-un-formato-si-presenta.md). Rimisurati.
- **Vera e più grande di com'era scritta**: «la stessa stringa letta per due
  domande». Le domande sono due davvero, e la seconda —
  [`NameFault::Hidden`](../../crates/fub-abi/src/rules/path_policy.rs) — resta
  **asimmetrica**, di proposito: un vault che mostra i nascosti mostra i file
  che *ci sono già*, e non autorizza Fub a **crearne** uno. La preferenza si
  ribalta in un clic, e le note create mentre era accesa resterebbero
  invisibili senza che nessuno le nomini. Il modulo `path_policy` diceva che i
  due si toccano; adesso dice anche dove **non** si toccano.

## I collegamenti: scartati avendolo detto

La 0058 ha consegnato i symlink a questa voce, e la voce chiede di decidere
invece di ereditare. La decisione è **non si seguono**, e la ragione non è la
prudenza: seguirli si può solo sapendo riconoscere un nodo già visitato, cioè
avendone l'identità (`dev`+`ino` su Unix, l'indice del file su Windows). Il
`VaultStorage` non ce l'ha, e non ce l'ha **di proposito** — il §15.1 esiste
perché un supporto possa essere una memoria, un archivio, un servizio. Senza
identità, `a/collegamento -> a` è una camminata che non torna: un interruttore
che accendesse quel caso sarebbe la facoltà di appendere l'apertura del vault, e
una facoltà così non è una facoltà. Il giorno in cui un supporto sa dire «questi
due path sono lo stesso nodo», la chiave si aggiunge accanto alle altre due.

Il presidio non è un `assert` su una costante:
`un_anello_di_collegamenti_non_ferma_la_scansione` costruisce l'anello sul
filesystem vero. Se qualcuno li facesse seguire, quel banco non fallirebbe —
**non tornerebbe affatto**, che è il modo in cui questa decisione si sbaglia.

## Le altre quattro, e come si compongono

Sullo stesso albero ne servono cinque: questa, l'esclusione dalla ricerca
(§9.1), dal sync (§18.1), dal contesto dell'AI (§23.2), e la lettura del
`.gitignore` (§3.1). La riga che impedisce a «questa cartella è esclusa» di
significare cinque cose diverse si scrive **adesso**, perché adesso c'è la
prima: **si compongono per sottrazione.** Quella del vault dice cosa *è un file
del vault*, e le altre possono solo togliere ancora — una cartella che non è nel
vault non può essere nel sync, e nessuna ricerca ripesca ciò che il vault non
contiene. Ognuna dichiarerà la propria chiave e costruirà il proprio
`IgnorePolicy` con questo valutatore: il valore è parametrico, la lista arriva
da chi chiede, e nessuna di loro può ridefinire cos'è la struttura.

**Il campo su una query di listing, che la voce temeva come «la parte da
decidere prima del freeze», non serve.** Mettere la politica sul **vault**
risponde alla domanda invece di rimandarla: un plugin vede lo stesso vault che
vede l'utente. Un flag per-chiamata vorrebbe dire due idee di cosa la cartella
contiene, e la prima volta che le due divergono è quando un plugin scrive
qualcosa a un path che per lui esiste e per l'indice no. Il WIT congelato non si
tocca in nessun punto: due chiavi su `setting-spec`, e niente altro.

## Il rosso, e la zona cieca che ha trovato

Sei rami di produzione, tolti uno alla volta, tutti rossi: la struttura (quattro
banchi), il ramo dei nascosti (tre), la lettura di `files.show-hidden` (due),
quella di `files.excluded-folders` (uno), la forma intera del temporaneo
(quattro), e i collegamenti (uno — l'anello).

La domanda che è valsa il giro è però l'altra: **esiste un modo di fare la cosa
sbagliata che resta verde?** Sì, e non era nella voce. Togliendo da
`core_settings()` la riga che monta una famiglia di impostazioni del kernel —
`ignore_settings()`, ma vale identico per `properties`, `journal`, `locale` —
**non diventa rosso niente**: le chiavi spariscono dal pannello, chi le legge
prende il default in silenzio (che è la regola giusta per un vault che non ha
dichiarato niente), e il catalogo di stringhe resta lì senza che nessuno lo
citi. I due banchi dei cataloghi guardano **dalle chiavi verso le frasi**, mai
al contrario, quindi una famiglia intera che nessuno monta non li disturba.
Adesso c'è `ogni_chiave_che_il_kernel_dichiara_e_montata_dal_core`.

E siccome il rimedio è a sua volta un elenco scritto a mano — lo stesso difetto
per cui `maintenance` è stato fuori da `cataloghi_del_core()` a lungo, segnalato
dalla [0105](0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) e ancora
aperto — i due elenchi hanno adesso il loro attore: i conti
`cataloghi-del-kernel` (**cinque**) e `impostazioni-del-kernel` (**quattro**).
Una famiglia nuova nel kernel fa scendere il numero scritto accanto all'elenco e
`check-prosa` diventa rosso, che è la sola specie di presidio che vede un
**catalogo mancante** invece di una chiave mancante.

## Cosa non è chiuso, e va detto

- **Il `.gitignore` non si legge**, ed è del §3.1: un *file* come sorgente di
  politica ha una sintassi propria (i pattern, non i nomi), una precedenza
  propria e un proprietario che non è Fub. Questa voce gli lascia il posto dove
  atterrare — un terzo modo di costruire un `IgnorePolicy` — e non gliene
  inventa la forma. È una **casella residua**.
- **Un cambiamento vale dalla prossima scansione**, cioè dall'apertura o da
  `vault.rebuild-index`. Sta scritto nella descrizione delle due chiavi, che è
  il posto dove lo legge chi sposta l'interruttore. Rifare l'indice da sé al
  cambio della politica è una decisione della §24.2, non di qui.
- **La politica confronta i nomi, a qualunque profondità.** Una cartella
  dell'utente che si chiamasse `.fub` in fondo a un ramo è struttura per questa
  regola pur non essendo di Fub, ed è il comportamento di prima (`IGNORED_DIRS`
  faceva lo stesso). Conservativo nel verso giusto: sbagliando si esclude un
  file, non si scrive dentro la cartella di qualcun altro.
- **La zona cieca del presidio nuovo**: chi aggiungesse una famiglia al kernel,
  vedesse il conto rosso e **aggiornasse il numero** senza aggiungere la riga
  all'elenco resterebbe verde. Il conto lo costringe a mettere le mani nel
  commento che sta sopra l'elenco, e questo è quanto un conto può fare.

## Cosa la verifica ha trovato dopo (aggiunto il 2026-08-06)

Questa sezione si **aggiunge** e non riscrive niente di quanto sta sopra: un
verbale racconta cosa si è deciso quel giorno, non cosa si è scoperto poi.

Il collaudo del giro ha misurato che `IgnorePolicy` confrontava i nomi per
**uguaglianza di byte** — un `BTreeSet<String>` interrogato col nome di
directory grezzo che la scansione riceve dal supporto — mentre la
[0107](0107-il-caso-di-una-lettera.md), decisa nello stesso giro e tre commit
prima, aveva appena stabilito *quando due path sono lo stesso path*
(`resolution_key`: trim, NFC, minuscolo). Le due firme non si conoscevano, e il
buco stava dove si toccano: questa decisione ha perfino **modificato la prosa**
di `path_policy` — la riga che dice «la normalizzazione Unicode è la stessa
NFC di `resolution_key`, applicata ai nomi» — senza usarne la funzione.

Le due riproduzioni, misurate sulla funzione pura: `files.excluded-folders`
dichiarato `Café` in NFC non escludeva la stessa cartella scritta in NFD, che è
come macOS la scrive sul disco; e `node_modules` non escludeva `Node_Modules`
su un filesystem insensibile al caso, dove le due sono **la stessa cartella**.
È il difetto che la voce si vietava da sola: la riga *«un vault che nasconde una
cartella su una macchina sola sarebbe due idee di cosa c'è dentro»* è la ragione
per cui la chiave è di livello vault, e una dichiarazione che esclude su Linux e
non su macOS produce esattamente quelle due idee. Il caso non era nemmeno nuovo:
stava in `docs/issues.md` come 0005, scritto quando la politica era ancora
`IGNORED_DIRS`, e questa voce l'ha portato dentro la forma nuova insieme al
resto.

La riparazione sta nel commit che nomina questo verbale, e ha una forma sola: il
nome diventa una chiave **una volta e in cima a `esclude`**, dove il nome grezzo
smette di essere raggiungibile, e i nomi dichiarati diventano chiavi in
`declaring`. `e_struttura` riceve la chiave e non il nome, così `.Fub` su un
filesystem insensibile al caso è la cartella dove sta l'indice. Le quattro
politiche che erediteranno il valutatore (§9.1, §18.1, §23.2, §3.1) ereditano
anche questo, che è il punto: la regola sta nel posto che tutti attraversano.

**Fra i due errori possibili si è preferito quello largo, e lo si dice.**
Piegare il caso vuol dire che su Linux, dove `Build` e `build` possono
coesistere davvero, dichiararne una esclude entrambe. Si preferisce perché
un'esclusione mancata è silenziosa e dipende dalla macchina, mentre
un'esclusione di troppo si vede nell'elenco dei file; perché un vault che
contiene `Build` e `build` non è portabile a prescindere da noi, ed è ciò che
`HealthCheck::CollidingPaths` è lì per dire; e perché la regola opposta sarebbe
incoerente col grafo, dove `[[Nota]]` e `[[nota]]` sono già lo stesso
riferimento.
