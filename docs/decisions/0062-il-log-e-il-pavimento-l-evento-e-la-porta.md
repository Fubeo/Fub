# 0062 — Il log è il pavimento, l'evento è la porta

|  |  |
|---|---|
| **Decisa** | 2026-07-30 |
| **Origine** | `todo.md` §17.3 ([seduta 17](../roadmap/17-presidi-che-restano.md)) — `tracing` al posto di `eprintln!`, con log su file, livelli configurabili e log per-plugin. La riga del diagnostic bundle (§15.2) resta dichiarata fuori |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/17-presidi-che-restano.md) · [ciò che va storto è un evento, 0052](0052-cio-che-va-storto-e-un-evento.md) · [il locale è un caso, 0036](0036-le-impostazioni-e-i-tre-stati.md) · [le maglie della 0061](0061-un-giro-che-non-passa-dal-modello.md)

---

Il §17.3 chiede una cosa sola, scritta a metà riga: *«`tracing` al posto di
`eprintln!` con log su file, livelli configurabili e log per-plugin; il
diagnostic bundle (§15.2) lo raccoglie»*. Due parti, e il cappello della
[seduta 17](../roadmap/17-presidi-che-restano.md) le divide — non con il suo
criterio (*se il costo cresce con l'attesa*, che qui per il tracing non vale:
lo dice lei stessa, *«per gli e2e e per il tracing no»*) ma con uno più
semplice: la prima parte è questa casella, la seconda — *il diagnostic bundle*
— è la [§15.2](../roadmap/15-il-disco.md) e aspetta lei.

Qui si chiude la prima, e nel chiuderla si è scoperto che la frase di partenza
era una domanda mal posta: una cosa sola erano **due**.

## Pavimento e porta: una cosa erano due

La [0052](0052-cio-che-va-storto-e-un-evento.md) ha dato a ciò che va storto un
**canale** — `Event::Trouble` — e nel farlo ha contato i suoi clienti: ventisette
`eprintln!` nel backend, più due commenti del kernel che nominavano quel canale
per nome. La casella residua di quella voce
([§20.2](../roadmap/20-quando-qualcosa-va-storto.md)) aveva il compito di portarli
dentro. Farlo, però, ha costretto a chiedersi *quali* dei ventisette ci andassero
— e la risposta è stata che non era una domanda sui punti: era una domanda sui
due lettori che un guasto ha.

*Chi sviluppa Fub* vuole sapere **tutto** ciò che è andato storto, anche ciò che
non ha perso niente: una cartella non creata, un indice ricostruito, un
componente non montato. *Chi legge le note* vuole sapere una cosa sola: **ciò
che ha perso qualcosa di suo** — una versione, un ripristino nel posto sbagliato,
un rilevamento che è morto e con lui la promessa di vedere i cambiamenti esterni.
Mischiare le due destinazioni avrebbe avuto due modi di sbagliare, simmetrici:
un guasto spariva nel silenzio (pavimento rotto), oppure il centro notifiche si
riempiva di diagnosi per chi sviluppa (porta spalancata). Il criterio che le tiene
separate è una riga:

> **Il log è il pavimento, l'evento è la porta.** Ogni guasto lascia una riga di
> log — sempre, per chi sviluppa — e solo quelli che raccontano una **perdita**
> aprono anche la porta del canale degli eventi, che è rivolto a chi legge.

Dove passa la perdita, allora, non è un'alternativa al log: è una riga **in più**.
Il sidecar del cestino non scritto, il flush dell'indice fallito, la versione non
salvata scrivono una riga di `tracing` **e** emettono un `Event::Trouble`; la
potatura riuscita, l'indice ricostruito, il bundle non montato scrivono la riga e
basta. È la conseguenza diretta del criterio della
[0052](0052-cio-che-va-storto-e-un-evento.md): l'evento è *l'unica copia di un
fatto*, e un fatto che nessuno ha perso non è l'unica copia di niente — lo sa già
chi sviluppa dal log.

## Cosa si è sostituito, ed è sceso a zero

I ventisette `eprintln!` che la [0052](0052-cio-che-va-storto-e-un-evento.md)
aveva contato in codice di produzione sono oggi **zero**. Dei nove che il `grep`ANCORA trova, nessuno è codice che un'app impacchettata esegue: cinque sono
doc-comment che lo citano storicamente (e questo verbale ne corregge uno),
tre sono righe di un `example` di contesa sui lock, una è dentro il test
`#[ignore]` della §8.4. L'unico `stderr` rimasto in Fub è il sink del log quando
non c'è un posto dove scrivere — un ambiente senza `HOME` — ed è lui, non un
`eprintln!` perso, a tener vivo il fatto che là il canale giusto è e resta
`stderr`, perché non ce n'è nessun altro.

Di quei ventisette, **sette aprono la porta**. Sono le perdite: il sidecar del
cestino non scritto (chi ripristina tornerebbe nel posto sbagliato), il topic
rubato da un plugin che emetteva su un nome non suo, il flush dell'indice fallito
(chi cerca riceve una risposta incompleta fino alla riapertura), il rilevamento
morto (il vault drifta in silenzio finché non lo si riallaccia a mano), e tre del
versioning — la versione non salvata, il documento che non si è potuto leggere,
il tombstone non scritto. Gli altri venti restano nel pavimento, e sono il
racconto che serve a chi sviluppa dopo, senza che nessuno di loro sia una cosa
che chi legge le note ha perso.

## Fatto

- [x] **`fub_kernel::log`**, in
      [`crates/fub-kernel/src/log.rs`](../../crates/fub-kernel/src/log.rs): il
      vocabolario del log — `Level`, `Levels`, il `trait Sink`, `FileSink`,
      `StderrSink`, `CapturingSink` — e il `Collector` di sessanta righe. È il
      crate del kernel e non un crate a sé: la facciata è `tracing` (vedi sotto),
      il collettore è codice our di sessanta righe, e separarli vorrebbe dire un
      crate in più per due file che si parlano.
- [x] **`stamp_iso_millis`**, in
      [`crates/fub-kernel/src/time.rs`](../../crates/fub-kernel/src/time.rs): la
      gemella leggibile di `stamp_from_unix`. I `:` che quella toglie per stare
      in un nome di file qui restano, perché una riga di log si legge con l'occhio
      e con `grep`, e le virgole dei millisecondi servono a mettere in ordine due
      righe nello stesso secondo — che è la norma quando un guasto ne tira un
      altro.
- [x] **Livelli configurabili e log per-plugin come impostazioni di macchina**,
      `log.level` e `log.verbose`, dichiarati dal bundle di core in
      [`crates/fub-host/src/settings.rs`](../../crates/fub-host/src/settings.rs).
      Le opzioni della tendina nascono da `Level::ALL` e non da un elenco a mano
      — la stessa ragione dell'inventario delle view: due elenchi della stessa
      cosa sono due elenchi che nessuno confronta, e il giorno che si aggiunge un
      gradino quello qui sotto sarebbe l'unico a non saperlo.
- [x] **Il collettore si installa prima del vault**: `install_logging` lo mette
      come `Subscriber` globale in
      [`fub_app::run`](../../crates/fub-app/src/lib.rs), l'`Arc` dei livelli
      passa all'host, e il montaggio — primo momento in cui `log.level` esiste
      come impostazione — lo applica. Le righe che `Host::installed` scrive
      aprendo i file della macchina hanno da subito un posto dove andare.
- [x] **Il file ruota**, una generazione sola: oltre dieci mega il corrente
      diventa `<fub.log>.1`, se ne ricomincia uno vuoto. Una e non cinque perché
      il cliente di questo file è il bundle diagnostico, e a una segnalazione
      serve *poco fa*, non *il mese scorso*.
- [x] **I ventisette punti di stderr distribuiti**: pavimento per le diagnosi,
      porta per le perdite. Sotto, nelle decisioni, perché ognuno va dove va.
- [x] **L'invariante delle dipendenze**,
      [`crates/fub-abi/tests/dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs):
      `tracing` entra fra i permessi diretti di `fub-kernel`, con la ragione
      accanto. `fub-abi` non lo prende: la facciata del log sta nel kernel, e il
      contratto resta puro.

## Le decisioni

*Perché `tracing` e non un `log!` scritto in casa.* Perché non siamo i soli a
parlare. `tracing` è **già nell'albero** — 0.1.44, tirato da `tauri` — e con lui
ci sono i suoi emittenti: `tauri`, `wry` e ciò che si portano dietro. Un `log!`
nostro avrebbe raccolto solo le nostre righe, e il giorno che una finestra non si
apre la riga che lo spiega sarebbe stata l'unica a mancare. Prenderlo come
dipendenza **diretta** non aggiunge un albero nuovo: aggiunge un nome in un
`Cargo.toml` che descrive una cosa che c'era già.

*Perché il collettore invece è scritto in casa.* `tracing-subscriber` **non** è
nell'albero, e portarlo dentro costa almeno quattro crate nuovi
(`tracing-subscriber`, `sharded-slab`, `thread_local`, `tracing-log`) più
`matchers` e un motore di regex se si vuole `env-filter` — che è precisamente la
cosa che **non** vogliamo: la [0036](0036-le-impostazioni-e-i-tre-stati.md) ha
tolto la configurazione dalle variabili d'ambiente, e `RUST_LOG` sarebbe stata la
terza rientrata dalla finestra. Ciò che resta di `tracing-subscriber` una volta
tolto il filtro da variabile d'ambiente è un formattatore, e il formattatore lo
vogliamo nostro comunque: una riga di log di Fub è prosa italiana come tutto il
resto.

*`default-features = false`, e non è prudenza generica.* Le feature di default di
`tracing` sono `std` + `attributes`, e la seconda tira `tracing-attributes`, il
proc-macro di `#[instrument]`. Misurato: con i default, `cargo` dice «Adding
tracing-attributes v0.1.31» — un crate nuovo davvero, e che questa non è una
dipendenza già nell'albero. Span non ne apriamo, quindi `#[instrument]` non serve,
e senza di lui il conto torna: zero.

*Gli span si accettano e si buttano.* Non ne apriamo nessuno, e quelli che
arrivano da `tauri` direbbero a chi legge dove si trovava `tauri`, non dove si
trovava Fub. Gli **eventi** dentro quegli span invece si scrivono: è la metà che
serve. Il giorno che un lavoro lungo ([0035](0035-il-lavoro-lungo-si-racconta.md))
volesse comparire nel log come un blocco con dentro le sue righe, gli span
diventano il modo di ottenerlo, e questo è il posto dove si aggiungono.

*`max_level_hint` torna `None`, ed è una scelta.* Un hint viene **messo in cache**
da `tracing` al primo callsite, e il livello di Fub si può cambiare dal pannello
delle impostazioni mentre l'app gira: un hint accurato avrebbe congelato al primo
avvio la risposta a una domanda che l'utente può rifare. Il prezzo è che ogni
callsite chiama `enabled`, che è un `load` atomico — ed è il prezzo giusto per
non dover chiedere un riavvio per riprodurre un difetto.

*Il default è `Info`, non `Warn`.* La domanda a cui il default risponde non è
*«quanto rumore tolleri»*: è *«cosa vuoi trovare nel file il giorno che qualcuno
ti scrive che una versione è sparita»*. La risposta è la riga che dice *l'ho
potata io, per la fascia di ritenzione* — che è un `Info`, perché niente è andato
storto. Un default a `Warn` avrebbe tenuto solo i guasti, cioè esattamente le righe
che l'utente ha **già** visto passare dal centro notifiche, e buttato quelle che
spiegano ciò che non ha visto.

*«Verboso» è una lista di id, non una mappa `id=livello`.* È la forma del «log
per-plugin», e la sua casa è una lista per la stessa ragione di
`plugins.disabled` ([0036](0036-le-impostazioni-e-i-tre-stati.md)): una mappa
dentro una stringa è un formato dentro un formato, e la domanda che qualcuno si
pone davvero è *voglio vedere tutto di questo componente*, che ha una risposta
booleana. «Verboso» vuol dire **almeno**, mai esattamente: alza la soglia di un
target a `Debug` e non la abbassa a nessuno — se il globale è a `Trace`, essere
verbosi non toglie niente.

*Una generazione di storico, non cinque.* Il cliente del file è il bundle
diagnostico, che lo allega a una segnalazione: ciò che serve a una segnalazione è
*poco fa*, e cinque generazioni sarebbero state cinque volte il disco per una
domanda che nessuno ha posto. La rotazione sposta il corrente su `<fub.log>.1`
sovrascrivendolo, e non rinomina a cascata: una sola è la forma semplice.

*Il test passa da `with_default`, non dal globale.* `install` mette il collettore
per tutto il processo e torna `Err` se qualcuno l'ha già fatto — che in un binario
è un difetto e in una suite di test è la normalità, perché i test girano insieme
nello stesso processo. Per quello c'è `captured`, che usa `with_default` di
`tracing`: è *thread-local*, quindi due test che girano insieme non si vedono le
righe a vicetta. Senza questo, presidiare il log avrebbe voluto dire un test che
gira da solo — cioè un presidio che la suite non esegue come esegue gli altri.

## La prova che diventa rossa quando deve

Il rito è quello della [0060](0060-il-modello-dice-il-vero-sui-byte.md): ogni
riga è stata vista rossa guastando di proposito il codice che presidia.

| asserzione | come | cosa ha detto |
|---|---|---|
| una riga dice quando, quanto e chi prima di dire cosa | rotta: le tre colonne scambiate | `WARN 1970-01-01T00:00:00.000Z fub.versioning` — il bersaglio prima del livello |
| il livello globale taglia | `Levels` senza `set_global` | un `Info` passa col default che già lo negherebbe |
| un target verboso alza e non abbassa | rotta: `verbose` che abbassa chi è già alto | un `Trace` globale viene negato a un target verboso |
| spento vuol dire spento | rotta: `Off` che lascia passare l'errore | un errore passa con il livello a `Off` |
| i gradini si rileggono dal nome che scrivono | rotta: `parse` che restituisce `Warn` per `off` | `Level::parse("off")` non è `Off` |
| il collettore scrive ciò che passa e solo quello | rotta: `event` che ignora `enabled` | tre righe su tre, e non due su tre |
| il file ruota e non perde la generazione di prima | rotta: `rotate` che non rinomina (marker `// BREAK:`) | `la generazione di prima: No such file or directory` — `.1` non compare |
| il pavimento spento non chiude la porta | rotta: il log emette anche con `Off` | una riga di log col livello a `Off`, e la porta conta zero |
| una perdita apre la porta, una non-perdita no | rotta: il `tracing::info!` apre la porta | la porta conta uno per una potatura, cioè per qualcosa che non ha perso niente |

La riga del `// BREAK:` è la prima di questo giro che è stata trovata già rossa
e non rossa per colpa sua: il collettore era stato lasciato con `rotate` che non
rinominava, e il test della rotazione rosso era lo stato in cui il lavoro era
stato interrotto. La riparazione è il caso più semplice di *provata rompendola*:
il guasto era già lì, e tirar via il marker è stato farlo diventare verde.

L'ultima è la proprietà cardine della voce — *pavimento e porta sono
indipendenti* — ed è quella che ha voluto un test a sé:
[`crates/fub-kernel/tests/il_pavimento_e_la_porta.rs`](../../crates/fub-kernel/tests/il_pavimento_e_la_porta.rs).
Guasta il pavimento e la porta continua a parlare; guasta la distinzione e una
non-perdita apre la porta. È l'unica rete che prende il criterio intero della
0062: le altre ne presiedono i pezzi, questa ne presidia la **relazione**.

## Le maglie che lasciano passare

- **`max_level_hint` è `None`**, quindi ogni callsite chiama `enabled`. È il
  prezzo di un livello che si cambia a caldo, dichiarato sopra; il ribaltamento è
  che rinunciarvi vorrebbe dire scegliere un hint da congelare al primo avvio.
- **Le righe di `tauri` e `wry` finiscono nello stesso file**, e con i loro
  target: non sono nostre, e il collettore le passa tale e quali. È la ragione
  per cui il collettore è in casa: il formattatore le scrive nella nostra forma,
  ma la decisione di scriverle è di `enabled`, e il loro livello è il loro.
  Toglierle vorrebbe dire un filtro per target, cioè il `matchers` di
  `tracing-subscriber` che questa voce ha scelto di non portare.
- **`StderrSink` è l'unico `stderr` rimasto**, e vale solo quando non c'è un
  `config_dir`. Un giorno in cui il log si volesse sempre e comunque, là è il
  posto dove si decide — non un `eprintln!` di ritorno.
- **Gli span si buttano**. Un lavoro lungo che volesse apparire come un blocco
  nel log non ha oggi la forma per farlo, perché non ne apriamo. È la maglia
  dichiarata aperta della testa del modulo, e il posto dove si stringe se
  [0035](0035-il-lavoro-lungo-si-racconta.md) lo chiede.
- **Il livello si legge dopo il bundle di core**. È il primo momento in cui
  `log.level` è un'impostazione: prima di lui non è nemmeno uno schema, e chi lo
  cambiasse prima del montaggio non avrebbe dove scriverlo. Le righe che precedono
  il montaggio — `Host::installed` che apre i file della macchina — girano al
  default, ed è giusto così: sono la manovra di accensione, non il difetto.
- **Il `verbose` si confronta per stringa esatta**, non per prefisso. È la stessa
  forma di `plugins.disabled`, e condivide la maglia: `fub.versioning` non rende
  verboso `fub.versioning.sub`. È la forma semplice, e dichiarata.
- **Il test `il_pavimento_e_la_porta` fa `std::mem::forget` sulla `TempDir`** del
  vault, come già i test che girano su un `Workspace` vivo: lasciarla cadere
  distruggerebbe la radice mentre un handler la legge. È la convenzione dei test
  end-to-end del kernel, non un'innovazione di questo giro.

## Cosa si è scartato

- **`tracing-subscriber` / `env-filter`.** Sopra, con la sua ragione: quattro
  crate nuovi per un formattatore che riscriveremmo e un filtro da variabile
  d'ambiente che la [0036](0036-le-impostazioni-e-i-tre-stati.md) ha deciso di
  non volere.
- **`tracing-attributes` (`#[instrument]`).** Span non ne apriamo, quindi il
  proc-macro non serve; `default-features = false` lo tiene fuori, e
  l'assenza è presidiata dalla dipendenza dichiarata.
- **Cinque generazioni di storico.** Il cliente è il bundle diagnostico, e a una
  segnalazione serve *poco fa*. Cinque volte il disco per una domanda che nessuno
  ha posto.
- **Un crate a sé per il log.** La facciata è `tracing`, il collettore è sessanta
  righe in casa: separarli vorrebbe dire un crate in più per due file che si
  parlano, e un confine in più da presidiare.
- **Una mappa `id=livello` per il log per-plugin.** È il gesto che si ripete in
  `plugins.disabled` e qui si ripete la risposta: la domanda è *voglio vedere
  tutto di questo componente*, e la sua risposta è booleana. Una mappa dentro una
  stringa è un formato dentro un formato, che è ciò che `vaults.json` esiste per
  non fare.
- **Trasportare nel canale anche le non-perdite.** Sarebbe stato il modo di
  spalancare la porta: il centro notifiche si riempie di diagnosi per chi
  sviluppa, e la proprietà della [0052](0052-cio-che-va-storto-e-un-evento.md) —
  *l'evento è l'unica copia di un fatto che una persona ha diritto di sapere* —
  si diluisce fino a non dire più niente.
- **Spento il log solo per un vault.** `log.level` è di macchina e non di vault
  per la stessa ragione del tema: il log è uno strumento di chi guarda Fub, e un
  vault che decidesse quanto raccontare di sé sarebbe un file che cambia il
  comportamento di chi lo apre.

## Cosa resta fuori, dichiarato

- **Il diagnostic bundle (§15.2).** La riga del §17.3 lo nomina, ed è la parte che
  resta: raccogliere il file di log in una segnalazione è mestiere del bundle, e
  il bundle è la [§15.2](../roadmap/15-il-disco.md). Qui il file c'è, ruota, sta
  accanto alla configurazione e non nel vault; il giorno che il bundle esiste, lo
  trova. È la stessa forma con cui la [0060](0060-il-modello-dice-il-vero-sui-byte.md)
  ha lasciato il banco delle prestazioni: una cosa dichiarata fuori perché aspetta
  un'altra voce, non una decisione.
- **Le due caselle del banco delle prestazioni** della §17.1, che aspettano una
  macchina che non divida i core. Non toccate da questo giro, e non c'entrano: la
  seduta 17 le tiene aperte perché il loro costo **non** cresce con l'attesa.
- **La **§17.2** resta aperta**: gli e2e della shell
  (tauri-driver/Playwright) non sono questo giro. La seduta le tiene per lo stesso
  criterio delresto — il costo non cresce con l'attesa — e l'osservabilità non ne
  era la precondizione.
- **I nove `eprintln!` che il grep ancora trova** non sono codice di produzione:
  cinque doc-comment storici (uno corretto qui), tre in `examples/contesa.rs`,
  uno nel test `#[ignore]` della §8.4. L'esempio della contesa è un benchmark
  manuale sui lock, e i suoi `eprintln!` parlano a chi lo sta lanciando da un
  terminale — che è `stderr` usato bene, non un guasto zittito.
- **La casella residua della §20.2 si chiude.** *Portare dentro il canale i
  ventisette punti che scrivono su `stderr`* aveva un "canale" singolo implicito;
  questo giro ha mostrato che i ventisette hanno **due** destinazioni, e che la
  domanda non era *quali ci vanno* ma *quali vanno dove*. Le perdite aprono la
  porta, le diagnosi restano nel pavimento, e `stderr` di produzione è vuoto. La
  casella scende da ventisette a zero, e le caselle residue di `todo.md` da nove
  a otto.
- **Le divergenze dichiarate della 0060/0061 non sono riparate.** Sono ancora
  tredici, e il loro presidente è il verbale che le prenderà.
- **Le caselle di [FEATURES.md](../FEATURES.md) restano senza spunta**, come
  tutte le altre e per la ragione che la [0060](0060-il-modello-dice-il-vero-sui-byte.md)
  ha già scritto: quel file è il catalogo di cosa l'app farà, non un tracciato di
  avanzamento.

## I numeri e i nomi che erano sbagliati

Contati col comando accanto, perché il prossimo possa ricontarli — è la
disciplina della [0052](0052-cio-che-va-storto-e-un-evento.md).

| dove | diceva | è |
|---|---|---|
|[event.rs](../../crates/fub-abi/src/event.rs), doc di `Event::Trouble`, «sono ventisette `eprintln!` nel backend» al presente | 27 (al presente, come se fossero ancora lì) | **0** in codice di produzione — `grep -rn "eprintln!" crates --include="*.rs" \| grep -v "/tests/" \| grep -v "examples/"` poi tolti i doc-comment. La prosa è stata girata al passato e rinvia qui per la distribuzione |
| [leva.md](../roadmap/leva.md), «**ventisette** messaggi vanno a `stderr`» | 27 | **0** in produzione — stesso comando. La riga racconta lo stato che la [0052](0052-cio-che-va-storto-e-un-evento.md) misurò, e va letta come la sua foto |
| [todo.md](../todo.md), la casella residua della §20.2, «portare dentro il canale i ventisette punti che scrivono su `stderr`» | una casella residua | **chiusa** — vedi sopra; le caselle residue da nove a otto |

Il primo è di un'altra specie dai numeri diconto della
[0052](0052-cio-che-va-storto-e-un-evento.md), e va distinto: era un'affermazione
**storica** scritta al presente, e non un numero invecchiato. La [0052](0052-cio-che-va-storto-e-un-evento.md)
l'aveva contato giusto al suo tempo; ciò che è invecchiato è il tempo del verbo.
Correggerlo è girare «sono» in «erano» e rinvii qui, non cambiarne il numero —
perché il ventisette è la foto che quella decisione fece di sé, e resta vera come
storia. È lo stesso criterio con cui la [0061](0061-un-giro-che-non-passa-dal-modello.md)
ha trattato i numeri di `data-model.md`: una prosa che non diventa rossa va
aggiornata dov'è, e non promossa a verbale.

## Verifica

`cargo fmt --all --check`: pulito. `cargo clippy --workspace --all-targets -- -D
warnings`: pulito.

`cargo test --workspace`: **948 test verdi, 0 falliti, 3 ignorati.** Erano 938
alla [0061](0061-un-giro-che-non-passa-dal-modello.md) in 89 binari; i dieci nuovi
sono sette in `fub-kernel/src/log.rs` (il modulo), uno in `time.rs`
(`stamp_iso_millis`), due nel binario nuovo `il_pavimento_e_la_porta` — più i
test del rito del `// BREAK:` ora verdi. La rotazione è l'unica di questo giro
che è stata trovata già rossa, e la riga della sua tabella lo dice.

I `eprintln!` in codice di produzione: **27 → 0**. Misurato con
`grep -rn "eprintln!" crates --include="*.rs" | grep -v "/tests/" | grep -v
"examples/"` e poi scartando i doc-comment: in HEAD erano ventisette, oggi
nessuno. I sette che aprono la porta sono
`grep -rn "Event::Trouble" crates --include="*.rs" | grep -v "/tests/"` sulle
sole emissioni nuove, tolte la guardia anti-ciclo del kernel e il bridge del
centro notifiche che la [0052](0052-cio-che-va-storto-e-un-evento.md) aveva già
messo.

Il file di log ruota a dieci mega: `ROTATE_AT = 10 * 1024 * 1024`, una
generazione. Il livello di default è `Info`; il `verbose` è una lista e
`log.level` è di macchina.

`node .github/scripts/check-doc-links.mjs`: **134 file, 2553 link, 0 rotti**
— il valore di un clone pulito, perché lo script cammina il disco e un `.md`
non tracciato in radice lo conta. Era 2500 link alla
[0061](0061-un-giro-che-non-passa-dal-modello.md): i cinquantatré nuovi sono
questo verbale e i suoi rimandi — la [riga della §16.8](../roadmap/16-crate-sdk-banchi-di-prova.md)
che il conteggio tiene è corretta per la **nona** volta.

Le righe nuove di codice: `log.rs` 610, `il_pavimento_e_la_porta.rs` 127; le
modifiche ai ventidue file toccati stanno nei loro diff, e ognuna porta nella
testa o nel commento la ragione di andare nel pavimento o nella porta.