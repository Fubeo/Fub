# 0094 — Un tetto che si fa sentire, e un permesso che smette di travestirsi da dato

**Data:** 2026-08-04
**Voce:** [§23.12](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2312-un-troncamento-che-il-chiamante-non-può-vedere)
**Commit:** *(questo commit)*

## Il fatto

`random-bytes` era `func(n: u32) -> list<u8>`. La
[0039](0039-il-locale-e-il-caso.md) le aveva messo un tetto —
`MAX_RANDOM_BYTES = 1024` — e aveva scelto di applicarlo **zitto**: *«chi chiede
di più riceve mille byte e non un errore: una richiesta assurda non deve far
fallire la generazione di un id»*. Chi ne chiedeva quattromila ne riceveva mille,
e l'unico modo di saperlo era misurare la lunghezza di ciò che era tornato.

Adesso è `func(n: u32) -> result<list<u8>, plugin-error>`. **Chi riceve `ok`
riceve esattamente `n` byte**, e i due modi di non riceverli hanno un nome:
`bad-args` sopra il tetto, `permission-denied` senza la capacità `env`.

Il tetto resta una costante Rust e **non entra nel contratto**.

## La premessa incompleta: i significati erano tre, non due

La voce dichiarava un'ambiguità: un `list<u8>` corto poteva voler dire «ecco i
byte» o «ti ho troncato». I sorgenti ne dicevano una terza, e più grave.

`host/guard.rs` rispondeva `Vec::new()` quando il componente non aveva
`Capability::Env`, col commento *«il vuoto è la sola risposta onesta: dei byte
fissi sarebbero identità che collidono»*. L'argomento è giusto e resta giusto —
fra un vuoto e degli zeri, il vuoto. Ma il confronto era col nemico sbagliato: il
vuoto non competeva con gli zeri, competeva col **dire di no**, e arrivava a chi
chiama indistinguibile dal troncamento.

I due si correggono in modi **opposti**. «Hai chiesto troppo» si corregge
chiedendo meno, ed è una colpa di chi chiama. «Non ti è permesso» non si corregge
affatto: chiedere meno non serve a niente, e la risposta giusta è dirlo a chi
guarda. Un `Vec` vuoto che li rappresenta entrambi è una **politica travestita da
dato**, cioè la famiglia della [0013](0013-elenco-delle-capacita.md) e della
[0021](0021-il-confine.md) — non quella di un tetto — ed è il difetto che questa
voce non aveva nominato.

Il doppio dell'SDK lo aveva perfino istituzionalizzato: `MemoryHost` ha un
costruttore `senza_entropia()` che serviva a provare quel vuoto, con un doc che
lo argomentava. Un difetto con un presidio che lo conferma è un difetto che
sopravvive a una rilettura.

## Il censimento che era fermo dalla 0021

Cercando dove l'invariante fosse scritta è saltata fuori una cosa che nessuna
voce aveva notato. `host/guard.rs` intitolava un paragrafo *«Le cinque capacità
che non sanno dire di no»* e ne nominava cinque: `emit`, `free_name`,
`format_of`, `now_unix_millis`, `active_context`. `docs/architecture/traits.md`
ne diceva sei, aggiungendo `report_progress`.

Contando i metodi del contratto che non restituiscono un `Result`, erano
**sette**. Mancavano `user_locale` e `random_bytes` — le due capacità nate con la
0039, cioè **dopo** che quel conto era stato fatto dalla 0021, e mai aggiunte
all'elenco da nessuno.

La regola era scritta («una capacità nuova porti un esito anche quando non può
fallire») e il censimento che la faceva rispettare no. È lo stesso difetto che
`every_structural_capability_is_refused_by_the_same_gate` aveva già tolto alle
famiglie *negate* — sette nomi a mano, ciechi all'ottavo — e che qui non era stato
tolto. Un elenco scritto a mano che nessun presidio conta invecchia in silenzio.

Gli elenchi ora dicono sei e sette, e la riga sul perché sta accanto a entrambi.

## `user_locale` resta muta, e la differenza è l'argomento

Nel `Guard` i fallback senza esito erano due, ed è guardandoli insieme che si
vede cosa decide questa voce.

`user_locale` rende `Locale::default()`. È difendibile, e non per pigrizia: il
locale di default **è** la risposta che il contratto dà a «nessuno me l'ha
detto» — lingua indeterminata, UTC, ISO 8601 — quindi chi non ha la capacità
riceve ciò che riceverebbe da un host senza shell. Non è una bugia, è una
risposta vera più povera. La [0091](0091-un-orario-di-parete-non-e-un-intervallo.md)
ci ha lavorato sopra tre commit fa senza trovarci niente da correggere.

`random_bytes` rendeva il vuoto, e il vuoto **non** è la risposta del contratto a
niente: nessuna semantica dice «zero byte di caso». Era un valore inventato per
occupare il posto di un rifiuto che la firma non sapeva ospitare.

Il criterio che ne esce, e che vale oltre questa capacità: **un fallback muto è
onesto quando la risposta nulla è già un caso del dominio, e disonesto quando è
un valore inventato per occupare il posto di un errore.** Il locale sta nel primo
insieme, i byte stavano nel secondo.

## Le tre strade, e perché la prima

**Un `result` che rifiuta sopra il tetto.** Scelta. È la sola forma che chi
chiama **non può non guardare**: la domanda di metodo della 0092 — *come si
sbaglia?* — qui ha una risposta netta, «non si sbaglia, semplicemente non si
misura la lunghezza», e ciò che protegge da un controllo che nessuno fa è un tipo,
non una convenzione.

**Il tetto nel contratto, lista nuda.** Scartata, e per due ragioni indipendenti.
Non risolve il permesso negato, che resterebbe un vuoto muto — cioè lascerebbe in
piedi il peggiore dei due difetti mentre ne sistema il minore. E congela il
numero: il WIT non ha costanti, quindi servirebbe comunque una `func() -> u32`, e
da lì in poi 1024 sarebbe una promessa pubblica per sempre.

**L'additivo (`max-random-bytes: func() -> u32`).** Scartata con l'argomento che
la voce stessa portava: chi non controlla la lunghezza non chiederà nemmeno il
massimo. Sarebbe la firma preparata senza chiamante che la 0077, la 0090, la
0091, la 0092 e la 0093 hanno rifiutato cinque volte di fila.

**Una quarta, valutata e scartata:** un `variant random-error { too-much(u32),
denied }`, che avrebbe reso il tetto leggibile a macchina senza prometterlo a
priori. È elegante e costa un vocabolario d'errore **parallelo** a quello che
c'è: dalla [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) in poi un errore
è testo che qualcuno legge, e un tipo suo avrebbe voluto la sua localizzazione e
il suo rendering per due casi che `bad-args` e `permission-denied` già dicono
esattamente. Il vocabolario d'errore resta uno.

## Il numero, e perché non attraversa il confine

La trappola dichiarata era: se il tetto entra nel contratto, 1024 va argomentato
o cambiato consapevolmente, non copiato. La risposta è che **non ci entra**, e
questa è la metà della decisione che si vede meno.

Un limite dell'host non deve essere **interrogabile**, deve essere **visibile
quando morde**. È già la forma che questo progetto ha scelto altrove: la
[0034](0034-il-freno-e-il-raggruppamento.md) pubblica `Event::Overflow` — la
perdita — e **non** pubblica la soglia del bus né quella della raffica; i tetti
della [0049](0049-una-posizione-dentro-un-documento.md) si dicono nella risposta,
non in una funzione che li annunci. La §23.12 chiedeva quale delle due forme
fosse la regola: la regola è questa, e `random-bytes` era il solo posto del
confine in cui era falsa.

Il vantaggio pratico è che 1024 resta **alzabile**. Un numero pubblicato prima
del freeze sarebbe mille byte per sempre; un numero privato è una politica
dell'host, e il giorno che qualcuno avesse un caso d'uso per quattromila si alza
senza toccare il contratto.

## I chiamanti, uno per uno

`fub_sdk::ids` è il cliente vero, e le tre forme non rispondono nello stesso
modo.

- **`uuid_v4` e `uuid_v7`** chiedono 16 e 10 byte: sotto il tetto per due ordini
  di grandezza, quindi il rifiuto che possono ricevere è **solo** quello del
  permesso. Rendevano `Option<String>`, e il `None` era la parte debole di
  un'ottima decisione — *«un id che non si è potuto generare non è un id di
  zeri»* resta vero, ma la **ragione** la sapeva l'host e si perdeva un livello
  prima di chi avrebbe dovuto mostrarla. Ora rendono `Result<String,
  PluginError>`.
- **`short_id`** è l'unica con una lunghezza variabile, quindi la sola che il
  tetto possa davvero mordere — un `len` che venisse da un'impostazione o da un
  argomento di comando. Aveva già un `if bytes.len() < len { return None }`, e
  vale correggere qui la voce: la protezione **non** era assente, era
  indistinta. Prendeva il caso e poi buttava via quale fosse.
- Il `try_into` verso `[u8; 16]` resta, spostato in un `esatti::<N>()`, ma cambia
  mestiere: non è più la protezione — quella ora è la firma — è il **presidio di
  un host che mentisse**, e rende `Internal` perché a quel punto la colpa non è
  di chi chiama né del permesso, è di un'implementazione che ha detto `ok`
  rendendo meno di quanto il contratto le impone.

`journal.rs` chiede otto byte per l'id dello scrittore: `expect` con la frase che
dice **quale invariante** lo rende irraggiungibile, non «speriamo».

## Un guadagno che non era nel piano: la cancellazione arriva anche qui

`JobHost` delega le quattro capacità di `HostEnv` con `reading(…)`, che prende il
prestito e basta. Le capacità che possono rifiutare passano invece da
`read_result(…)`, che guarda **prima** la bandiera della cancellazione: è così che
la [0032](0032-il-runner-dei-job.md) fa valere la sua regola — *la cancellazione
non aggiunge una capacità, toglie le altre*.

`random_bytes` non poteva starci, perché non aveva un posto in cui dire di no: un
job annullato che chiedeva byte li riceveva. Da oggi ci sta. È la stessa lezione
della 0021 vista dall'altro verso — una capacità senza esito non è solo una che
non si può negare, è una che non si può **fermare**.

## Il ritaglio

`frozen/0.1.0.wit` portava la firma identica alla viva, quindi la linea di base è
stata ritagliata e il paragrafo che lo dice sta **accanto** a quelli che c'erano,
non al loro posto. La riga in
[`wit-congelato.md`](../architecture/wit-congelato.md) è la terza di questa
seduta, dopo la 0092 e la 0093.

È la più semplice delle venti rotture che
[`wit_additivity`](../architecture/wit-congelato.md) elenca — *un tipo di ritorno
cambiato* — e la più piccola dei tre ritagli di firma della seduta 23: nessun
tipo nuovo entra al confine, perché le due frasi giuste c'erano già. Il presidio
è diventato rosso da solo prima che lo si toccasse, che è il suo mestiere.

## Quanto pesa davvero, detto senza gonfiarlo

Poco, e va detto. Nessun chiamante di oggi supera il tetto; la
[0039](0039-il-locale-e-il-caso.md) dichiara che il flusso non è di qualità
crittografica e **quella decisione non è in discussione**, quindi ciò che si
perdeva non era un segreto forte — era un chiamante convinto di avere N byte
quando ne aveva mille. Trasformarla in una voce sulla crittografia sarebbe il
difetto che la seduta 22 ha contestato a chi l'aveva aperta.

Sta qui perché è **P0 per il tipo e non per l'importanza**, che è il criterio di
questa roadmap. Il guadagno vero non è nel tetto, è nelle due cose che si sono
trovate strada facendo: il permesso che smette di travestirsi da dato, e un
censimento fermo da settantatré verbali.

## Il criterio della 0039 non è stato rovesciato

Vale fermarcisi perché sembra il contrario. La 0039 scriveva *«una richiesta
assurda non deve far fallire la generazione di un id»*, e oggi una richiesta
assurda fallisce.

Ciò che quel criterio proteggeva era che **un id legittimo non smettesse di
nascere**, e nessun id legittimo ha smesso: le tre forme chiedono 16, 10 e `len`
byte, tutte sotto il tetto, e i test lo asseriscono compreso il caso esatto di
`MAX_RANDOM_BYTES`. Ciò che il criterio confondeva era «non fallire» con «non
dirlo». Una richiesta di quattromila byte non è un'identità che non deve fallire:
è un difetto di chi chiama, e riceverla troncata lo lascia convinto di aver
ottenuto ciò che ha chiesto.

## Il presidio

Il test che il tetto reggeva si chiamava
`the_ceiling_holds_and_does_not_fail`, e asseriva **la frase esatta che la voce
contesta**: che il tetto reggesse senza fallire. Un `assert` sulla lunghezza
sarebbe rimasto verde con il difetto in piedi per sempre. È diventato
`the_ceiling_says_no_instead_of_truncating`, e presidia il contrario.

- `random.rs` — il rifiuto sopra il tetto è `BadArgs` e **dice quanto era stato
  chiesto**; il confine fra l'ultimo `ok` e il primo rifiuto sta esattamente sul
  tetto (`the_ceiling_itself_is_still_granted`), non uno di qua o uno di là.
- `host/guard.rs` — due test nuovi, con una politica che nega una famiglia sola:
  il caso negato dice `PermissionDenied` **e nomina cosa si stava facendo**, e
  negare un'altra famiglia lascia passare l'entropia. Serviva scriverli qui
  perché `ReadOnly` **concede** `Capability::Env` — leggere che ore sono non è un
  effetto — quindi il presidio delle capacità simulate non la esercita e non la
  eserciterà.
- `ids.rs` — `asking_too_much_is_not_the_same_as_being_denied` è il test che dice
  tutta la voce in un nome: i due esiti sono due varianti diverse, e la richiesta
  **grande ma legittima** (esattamente `MAX_RANDOM_BYTES`) riesce, perché il tetto
  rifiuta ciò che è assurdo e non ciò che è grande.
- Il doppio porta il tetto anche lui: un banco che concedesse ciò che l'host vero
  rifiuta lascerebbe verde un test scritto sopra una richiesta che in produzione
  non riesce.

## Cosa resta fuori

`user_locale` resta senza esito, per l'argomento scritto sopra. Se un giorno
saltasse fuori che il locale di default *è* una bugia in qualche contesto, è una
voce nuova con una decisione sua — non un extra di questa.
