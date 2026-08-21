# 0165 — Un comando di un componente è un comando

**Stato**: accolta **Data**: 2026-08-15 **Prosegue**: [M5](../milestones/M5-wasm-runtime.md)
**Commit**: *(questo commit)*

---

## La domanda

La [0164](0164-il-secondo-backend-una-interfaccia-alla-volta.md) ha portato di là
dal confine un plugin che risponde, e ha dichiarato per intero ciò che non aveva
portato. Quattro voci di quell'elenco sono la ragione di questo verbale, e non
sono quattro cose diverse: sono quattro modi in cui un componente non era ancora
un cittadino come gli altri.

- `Bundle::register` tornava una lista vuota. Di tutti i trait del contratto
  attraversava solo `Plugin`: un componente sapeva **rispondere a un job**, cioè
  a una domanda che il suo stesso codice aveva chiesto di ricevere, e non sapeva
  offrire niente a chi non lo conosceva.
- `host-events` non era linkata: «un componente parla quando gli si parla».
- `read-model` rispondeva `unserved`, col proprio perché.
- Niente scadenza e niente tetto: un `loop {}` di là dal confine teneva il thread
  del job finché l'app non moriva.

La domanda di questo passo è la prima delle quattro, e le altre tre le vengono
dietro perché sono ciò che serve a renderla vera: **che cosa deve succedere
perché la palette, la tastiera, una macro e la CLI chiamino il comando di un
componente senza avere un ramo che lo distingua da una feature nativa?**

## Il provider e il plugin sono la stessa istanza

**`WasmCommandProvider` tiene un `Arc<Mutex<Istanza>>`, e quell'`Arc` è lo stesso
del `WasmPlugin`.** È la scelta che regge tutto il resto, ed è meno ovvia di
quanto sembri: i quattro passi del montaggio del §9.3 chiamano `plugin()` al
terzo e `register()` al quarto, sullo stesso bundle e in fila, ma entrambe le
firme sono `&self` — non c'è nessun valore che passi dall'una all'altra. Da qui
il campo `ultima`, che è il filo fra i due passi: `plugin()` ci lascia una copia
dell'`Arc`, `register()` viene a **prenderla** e lo svuota.

Lo svuotamento non è pulizia: è la riga che impedisce a un `register` senza il
suo `plugin` di registrare i comandi di un'istanza di un montaggio di prima.
Chi non trova niente lo **dice**, invece di registrare la cosa sbagliata.

L'alternativa era istanziare due volte — un componente per il `Plugin` e un
altro per il provider — ed è la forma che si sceglie senza accorgersene, perché
istanziare costa poco e ogni copia è più semplice da ragionare. Sarebbe stata
sbagliata per una ragione che non è di costo: **un plugin ha uno stato**, e uno
stato in due copie è due plugin che si somigliano. Un comando che scrive un
contatore e un job che lo legge vedrebbero due numeri diversi, e la differenza
non si vedrebbe da nessuna parte tranne che dai sintomi.

Il prezzo è il `Mutex`: le chiamate a uno stesso componente si serializzano. È il
prezzo giusto — un'istanza wasmtime non è `Sync` e non lo sarebbe comunque —, ed
è dichiarato qui perché è anche la premessa della sezione sulla rientranza, più
sotto.

## Le spec si leggono una volta, come il manifest

`commands()` restituisce ciò che il componente ha dichiarato **al momento della
registrazione**, non ciò che risponderebbe adesso. Non è per risparmiare una
chiamata: è il registro che deve restare vero. Al momento della registrazione gli
id sono stati ammessi — namespace del plugin, nessun doppione — e le scorciatoie
sono già diventate impostazioni; un `commands()` che il secondo giorno
rispondesse un elenco diverso lascerebbe il kernel a governare comandi che non
esistono e il componente a offrirne che nessuno ha ammesso.

Da cui anche la separazione delle due domande dentro `register`. «Non esporta
`command`» è la forma normale del mezzo plugin e non si dice a nessuno; «lo
esporta e non sa elencarli» è un guasto e diventa un avviso con l'id davanti. E
gli avvisi restano **avvisi**: un provider che non entra non smonta il bundle,
perché il plugin resta montato con le sue altre interfacce e la riga di log dice
quale pezzo manca.

### Il namespace del §7.4, trovato dall'esempio

L'esempio nominava i propri comandi `demo.ping.conta`, col punto. È una cosa che
si legge bene e che il kernel rifiuta: la regola del §7.4 (`fub_abi::rules::ids`)
vuole `<plugin-id>:<nome>`, e un nome col punto è un nome **nudo** —
`demo.ping.conta` non è «conta di demo.ping», è una stringa che comincia per
caso con l'id di qualcuno. `admit` lo avrebbe respinto prima della
registrazione, e `register` lo avrebbe scritto in un avviso: un plugin montato,
senza i suoi comandi, e una riga di log da leggere.

Il difetto è dell'esempio e non dell'host, ed è per questo che va scritto qui: il
primo componente di terzi scritto contro questo contratto ha sbagliato la
prima cosa che poteva sbagliare, e a trovarla non è stato il tipo — un `String` è
un `String` — ma il presidio del kernel, dall'altra parte del confine, addosso a
un `.wasm` che non conosce `fub-abi`. È esattamente il giro che una prova
statica non fa.

## L'albero passa in un'arena piatta, e ha un tetto

`read-model` adesso risponde. `document-model` è l'albero più grande del
contratto e il WIT non ha tipi ricorsivi — un `record` non può contenere sé
stesso —, quindi il contratto lo risolve come lo risolvono i compilatori: **arena
piatta più indici**. Tutti i blocchi in una lista, tutti gli inline in un'altra,
le radici in ordine di lettura, e ogni figlio è un `u32`. La conseguenza pratica
è che si deposita in **post-ordine**: un padre non si può scrivere prima di
conoscere gli indici dei figli.

**Il tetto è 64 livelli di annidamento** (`modello::PROFONDITA_MASSIMA`), e la sua
ragione non è di gusto. La conversione è ricorsiva perché l'albero lo è, e quanto
un documento sia profondo non lo decide l'host: lo decide chi scrive il file.
Diecimila `>` in testa a una riga sono venti kilobyte di file e diecimila
`Block::Quote` annidati; senza tetto, tradurli è uno stack overflow del thread
del job — e uno stack overflow non è un errore che si legge, è il processo che
muore, cioè l'app dell'utente portata giù da un documento. Sessantaquattro perché
è oltre il doppio di ciò che una prosa umana annida davvero e perché
sessantaquattro frame di questa ricorsione stanno in una manciata di kilobyte
anche sullo stack di un thread del pool.

Il presidio sta nella traduzione e non nel provider markdown perché il modello
può arrivare da chiunque implementi `FormatProvider`: chi traduce è l'ultimo a
poter dire di no prima che la ricorsione parta davvero.

Qui c'è solo `in_*`, e non è una dimenticanza: è ciò che il contratto dice di
questo albero oggi. `read-model` lo passa a un guest e nessuna interfaccia
servita dall'host lo riceve indietro. Il `da_*` servirà quando `format.parse`
attraverserà, e sarà un altro passo con le sue domande — gli indici fuori range,
che di qua sono impossibili per costruzione e di là sarebbero dato di un
estraneo.

## Un componente parla anche mentre gli si parla

`host-events` è linkata: `emit`, `report_progress`, `spawn_job`. È l'unica
famiglia in cui la chiamata va nel verso opposto a tutte le altre — dal guest
verso l'host **mentre** l'host lo sta chiamando —, e per questo il suo `impl` sta
in un modulo suo e non con le altre due.

Il verso opposto ha una domanda sola, e grossa: le tre funzioni girano col
`Mutex` dell'istanza già in mano a chi ci ha chiamati, e un `Mutex` di `std` non
è rientrante. Qualunque strada che da lì tornasse nella **stessa** istanza non
sarebbe una ricorsione: sarebbe un blocco definitivo. Le tre strade sono state
percorse una per una.

- `spawn_job` **accoda e non esegue**. Il corpo lo prenderà un thread del pool
  più tardi; se è dello stesso plugin, quel thread aspetta il `Mutex` — un'attesa
  e non un blocco, perché chi lo tiene lo lascia tornando da `run-job` e non
  aspetta niente da chi ha lanciato. Che sia davvero così si vede dal banco: in
  `un_componente_che_parla` il `job-started` del figlio arriva **prima** del
  `job-done` del padre, cioè il lavoro è stato accettato mentre il padre teneva
  ancora l'istanza. L'ordine inverso sarebbe il primo segno che qualcuno ha
  cominciato a eseguire lì dentro.
- `emit` scrive sul bus e accoda agli handler senza drenare: nessun codice di
  terzi gira dentro la nostra chiamata.
- `report_progress` è l'unica che drena, perché `note_job_progress` consegna agli
  `EventHandler` registrati prima di tornare. Oggi il giro si chiude fuori da
  noi, perché `register` registra i comandi e nient'altro e un `CommandProvider`
  non è un `EventHandler`. **È la casella da riguardare** il giorno in cui un
  `EventHandler` attraverserà: quel giorno un job che si racconta sveglierebbe
  l'handler del proprio plugin passando dal `Mutex` che il job sta tenendo. Il
  posto in cui difendersi non sarà quel modulo — sarà il `Mutex`, che dovrà saper
  dire «sono già dentro» con un `plugin-error` invece di fermarsi, come
  `trappable_imports` spento dice ogni altro rifiuto.

Chi può cosa continua a non deciderlo il modulo: l'`HostApi` che arriva è già
incappucciato dal `Guard` ([0021](0021-il-confine.md)), e rileggere i permessi di
qua sarebbe il secondo punto di enforcement che quel verbale esiste per non
avere.

## Tre numeri, e la ragione di ciascuno

L'interruzione c'è, e sta in `src/limiti.rs`. Le scelte sono tre.

**Le epoche e non il carburante.** Wasmtime sa fermare il codice ospite in due
modi. Il carburante conta le istruzioni: è deterministico e costa, perché ogni
blocco decrementa un contatore locale. Le epoche contano un numero che qualcun
altro incrementa, e il codice ospite si limita a confrontarlo con una scadenza.
Serve il secondo, perché la domanda a cui questo modulo risponde non è «quante
istruzioni può eseguire un plugin» — nessuno la fa e nessuno saprebbe dire il
numero — ma «per quanti **secondi** l'app può restare senza risposta prima che
sia un guasto». Il determinismo che si perde non lo stava usando nessuno: due
plugin diversi hanno comunque due tempi diversi.

**Un `Engine` solo per processo, e quindi un battito solo.** Il contatore delle
epoche appartiene all'`Engine`; un `Engine` per componente — com'era prima —
vorrebbe dire un thread per plugin caricato, cioè un costo che cresce con
l'utente e non con il lavoro. Il prezzo dichiarato è l'altro verso: il battito
**non si spegne**, e finché il processo vive un thread si sveglia ogni 100 ms
anche a riposo. Scartata l'alternativa di farlo nascere e morire con la prima e
l'ultima chiamata: sarebbe un thread creato e distrutto a ogni giro di job, cioè
il costo spostato dal riposo al lavoro, dove dà fastidio davvero.

I tre numeri, con la loro ragione accanto — e stanno nei doc delle costanti, che
è dove li cerca chi dovrà cambiarli:

| numero | valore | perché |
| --- | --- | --- |
| `BATTITO` | 100 ms | Il costo a riposo (dieci somme atomiche al secondo, che una macchina ferma non nota) e insieme la **grana** della scadenza: più fine di così non si può misurare. |
| `SCADENZA_IN_BATTITI` | 50 (≈5 s) | Sopra qualunque chiamata legittima di questo contratto — leggere una nota, tradurla, rispondere: millisecondi — e sotto il punto in cui una persona decide che l'app è bloccata. È il **numero di battiti** e non solo il prodotto: con 50 l'incertezza della grana è il 2% del budget, con 5 battiti da un secondo sarebbe stata il 20%, cioè una scadenza che promette cinque secondi e ne concede quattro. |
| `TETTO_DI_MEMORIA` | 64 MiB | Senza tetto il massimo è quello del bersaglio, 4 GiB: un plugin che alloca in un ciclo non muore lui, fa morire l'app. È un **massimo e non una prenotazione** — la memoria lineare cresce a pagine —, quindi dieci plugin montati costano ciò che usano. Il conto che conta è quanto può prendersi *uno* prima che qualcuno se ne accorga. |

**La scadenza è per chiamata, non per istanza.** La scadenza di wasmtime è
assoluta (`set_epoch_deadline(n)` vuol dire «all'epoca corrente più n») e il
conto scorre anche mentre nessuno esegue niente: armarla una volta sola
all'istanziazione darebbe un plugin montato all'avvio e già morto cinque secondi
dopo, senza aver fatto nulla. La parentesi di una chiamata in questo crate ha già
un nome — `prestito::con_ospite`, che presta l'host per la durata di un
`activate`, di un `deactivate`, di un `run-job`, di un `invoke` e di niente
altro —, ed è lì che il cronometro riparte. Le porte che non passano di lì sono
le due che si fanno **senza** host, `manifest` e la dichiarazione dei comandi, e
tutt'e due rinnovano per conto proprio: senza quelle due righe il manifest
chiesto qualche secondo dopo il montaggio trapperebbe per aver fatto niente, e
l'elenco dei comandi girerebbe su ciò che un `activate` lento gli ha lasciato
indietro, cioè scadrebbe per colpa d'un altro.

Il tetto, invece, si arma **prima** di `instantiate`, perché la prima cosa che un
componente esegue è la propria funzione di avvio, ed è già codice ospite. Un
componente che si impicca nel proprio `start` non deve poter tenere il thread che
lo sta montando.

`trap_on_grow_failure` resta spento, per la stessa ragione di
`trappable_imports`: un `memory.grow` che non riesce restituisce `-1` come dice
la specifica, e il plugin ha la sua occasione di rispondere «non c'è posto» con
un valore del contratto. Chi quell'occasione non la sa usare — ed è il caso
dell'allocatore di default di Rust — trappa da sé una riga dopo, con lo stesso
esito.

### La scadenza si chiama col suo nome

Wasmtime chiama `interrupt` il trap della scadenza, ed è l'**unica** trap che non
è del componente: è l'host che lo ha fermato. Lasciata passare com'è, arriva
all'utente come una parola che non dice niente e che non si distingue da un
`unwrap` di là dal confine. Viene riconosciuta una volta, in `guasto`, e tradotta
in «il componente non ha risposto entro il tempo concesso ed è stato fermato».
Il presidio è il test del ciclo infinito, che asserisce sulla frase e non sul
tipo.

## Le prove

Cinque binari, e ognuno prova una cosa che gli altri non provano.

- `i_comandi_attraversano.rs` è il verbale in forma eseguibile: le spec di un
  componente stanno nel registro del kernel con titolo, scope e parametri
  (`Choice` compreso, coi suoi valori e i suoi titoli); un comando legge il vault
  e risponde con un `notify` e un `reveal` che nomina documento e span; l'esito
  ricco torna **intero** — piano con la revisione di base, `TextEdit`, passo di
  undo, applicazione parziale con tre tentati, due fatti e un `Conflict` che
  nomina il documento; un argomento obbligatorio che manca non arriva al
  componente ma si ferma su `BadArgs` col nome del parametro; e smontato il
  componente i suoi comandi non ci sono più.
- `il_modello_attraversa.rs` non guarda la traduzione da casa: la fa **camminare
  a un guest**. Un `.wasm` che non conosce `fub-abi` chiede il modello di una
  nota vera, scende nell'arena seguendo gli indici e risponde in JSON con ciò che
  ci ha trovato — frontmatter per nome, outline, link, tag, voci di lista e task,
  lingua del blocco di codice, e il testo del primo paragrafo ricostruito
  seguendo gli `inline-ref`. Se i numeri fossero zeri, l'albero sarebbe arrivato
  vuoto: è la differenza che uno stub avrebbe nascosto. Il rovescio è un
  documento con duecento livelli di annidamento, che riceve un rifiuto **che si
  legge** — e l'istanza resta viva, perché il no è passato come valore.
- `un_componente_che_parla.rs` prova il verso opposto, e l'ordine degli eventi è
  l'asserzione.
- `il_tempo_di_un_componente.rs` monta un componente con un `loop {}` dentro: il
  job torna con la frase della scadenza, e lo **stesso host** risponde ancora a
  un altro componente. Un'interruzione che portasse giù il thread non lo farebbe.
- `il_primo_componente.rs` è quello della 0164, e continua a essere il gemello
  riga per riga del banco nativo.

Il banco che compila gli esempi è uno solo, in `tests/comune/mod.rs`, e ci è
arrivato dopo essere stato scritto in quattro copie. Misurato sul ping: con una
`--target-dir` per variante l'albero delle dipendenze si compilava tre volte
(~62 s), con una sola una volta (~19 s). Il prezzo è un lucchetto, perché due
`cargo` sulla stessa cartella si sovrascriverebbero il `.wasm` a vicenda; il
lucchetto è per processo, e che i binari di prova girino uno alla volta è ciò che
copre il resto — detto nel modulo, perché il giorno in cui qualcuno li lancerà in
parallelo il sintomo sarà un `.wasm` della variante sbagliata, che non somiglia a
una corsa fra processi.

## Il numero che mancava

La [0146](0146-il-contratto-attraversa-il-confine.md) aveva lasciato aperto il
costo del **passaggio**, e la 0164 lo aveva lasciato aperto una seconda volta,
scrivendo che adesso un host che esegue c'era e che «dire un numero non misurato
sarebbe peggio che non averlo». Il numero adesso c'è, e a produrlo è
`crates/fub-wasm-host/examples/il-costo-del-passaggio.rs`: lo stesso vault, lo
stesso id `demo.ping`, lo stesso job `ping`, una volta col bundle nativo e una
volta col `.wasm`, con cinquanta giri buttati prima di ogni cronometro. Si rifà
con `cargo run --release -p fub-wasm-host --example il-costo-del-passaggio`, e i
numeri qui sotto sono di una macchina sola — Intel N150, quattro thread, Linux
x86_64 — che è il modo giusto di leggerli: contano i **rapporti**, non le cifre.

| misura | nativo (mediana) | WASM (mediana) | rapporto |
| --- | --- | --- | --- |
| caricare il bundle | 47,0 ns | 177 ms | *(due cose diverse)* |
| montare (istanza + `activate`) | 4,20 µs | 52,1 µs | 12,4× |
| `run_job "ping"` al confine | 7,25 µs | 7,69 µs | 1,06× |
| lo stesso job, visto dal pool | 28,0 µs | 20,0 µs | — |

La prima riga confronta due cose diverse, ed è ciò che ha da dire: per il
bundle nativo «caricare» vuol dire costruire una `struct`, perché il codice del
plugin sta già dentro l'eseguibile. I 177 ms del WASM sono quasi tutti la
**compilazione** del componente, si pagano una volta per plugin al primo
caricamento, e sono il posto dove guardare il giorno in cui l'avvio dovesse
sembrare lento — non le chiamate.

La riga che conta è la terza. **Il confine costa 440 ns in più per chiamata**, su
un job che di lavoro vero ne fa quasi niente: legge una nota di sette caratteri e
li conta. È il peggior caso possibile per il backend WASM, ed è l'unico modo
onesto di leggere quel numero — il sovrapprezzo è quasi fisso, quindi si diluisce
in ciò che il job fa davvero: un job che duri più di 44 µs paga il passaggio meno
dell'un percento del proprio tempo.

La quarta riga è quella che chiude il discorso, e va letta per ciò che **non**
dice. Visto dal pool — accodare, svegliare un thread, tornare — il sovrapprezzo
del confine è il 2,2% del totale, e le due colonne finiscono così vicine che
quella WASM esce perfino sotto quella nativa. Non è un backend più veloce: è la
coda che costa già più del confine, e da lì in poi chi paga non è più wasmtime.
Ciò che il §16.1 promette — «veloci quasi quanto le feature native» — su questo
banco è vero con un margine che non serve difendere.

Un'ultima cifra, perché era della 0146: il ping compilato pesa 153 462 byte, cioè
il 56% dei 275 073 byte del varco a vuoto. Il contratto intero costa più del
plugin che lo usa, ed è la forma normale di un contratto grande.

## Le forme scartate

- **Due istanze, una per il `Plugin` e una per il provider.** Più semplice da
  ragionare e sbagliata: un plugin ha uno stato, e uno stato in due copie è due
  plugin che si somigliano.
- **`commands()` che richiede l'elenco al componente.** Un registro che cambia
  sotto chi lo governa. La dichiarazione si legge una volta, come il manifest.
- **Un provider che non entra fa fallire il montaggio.** Contraddirebbe il doc di
  `Bundle::register` e il mezzo plugin: un componente senza i suoi comandi è un
  componente a cui manca un pezzo, non un componente da buttare.
- **Il carburante al posto delle epoche.** Determinismo che nessuno stava usando,
  pagato 2-3× sul lavoro vero.
- **Un `Engine` per componente.** Un thread di battito per plugin caricato.
- **Un battito che nasce e muore con le chiamate.** Il costo del riposo spostato
  sul lavoro.
- **Nessun tetto all'annidamento, contando sul fatto che i documenti veri sono
  bassi.** I documenti veri lo sono; il file che porta giù l'app lo scrive
  qualcuno apposta.
- **`trap_on_grow_failure` acceso.** Toglierebbe a un plugin educato l'occasione
  di dire «non c'è posto» senza dare niente in cambio a quello che non la sa
  usare.

## Cosa resta fuori

- **Gli altri nove export del mondo.** Attraversano `plugin` e `command`;
  `format`, `index`, `view`, `event-handler` e gli altri no. `register` registra
  ciò che sa registrare, e il resto è dichiarato lì.
- **`UiNode::validate_untrusted`.** Ancora il primo debito da saldare il giorno
  in cui `view` sarà fra gli export risolti — e resta debito, perché nessun
  albero di UI attraversa ancora.
- **I prefissi di path del §7.1.** Il `vault_scope` non ritaglia ancora niente:
  ciò che il `Guard` concede, lo concede intero.
- **La rientranza di `report_progress`.** Chiusa oggi da un fatto — nessun
  `EventHandler` di questa istanza sta nel registro — e non da una difesa. La
  difesa è il `Mutex` che sa dire «sono già dentro», e si scriverà il giorno in
  cui servirà, che è il giorno in cui un `EventHandler` attraverserà.
- **Il tetto per-memoria e non per-componente.** `memory_size` vale per memoria
  lineare, quindi un componente con due memorie può arrivare a due volte il
  tetto. È vero, è dichiarato, e non cambia l'ordine di grandezza: ciò che il
  tetto impedisce è il ciclo che alloca finché c'è RAM, e quello lo impedisce
  comunque.
