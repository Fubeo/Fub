# 0069 — Cosa sa dire un abbonamento: una dichiarazione che nessuno valuta mente a chi la scrive

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §22.1 + §22.2 ([seduta 22](../roadmap/22-cosa-sa-dire-un-abbonamento.md)) — chiude tutte e due le voci e ne **apre una**, la §22.4: un orario di parete non è un intervallo |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/22-cosa-sa-dire-un-abbonamento.md) ·
[la grana di un abbonamento, 0033](0033-la-grana-di-un-abbonamento.md) ·
[la maschera è dell'esemplare, 0063](0063-la-maschera-e-dell-esemplare.md) ·
[l'elenco delle capacità, 0013](0013-elenco-delle-capacita.md) ·
[il runner dei job, 0032](0032-il-runner-dei-job.md)

---

Un **abbonamento** è il modo con cui questo contratto tiene il lavoro fuori dal
confine: chi ascolta dichiara prima, il kernel valuta, e il guest si sveglia
solo a corrispondenza avvenuta ([0033](0033-la-grana-di-un-abbonamento.md)). Le
due voci che restavano sono due cose che quella dichiarazione non sapeva dire —
**quando** (§22.1) e **cosa è cambiato** (§22.2) — ed erano già state tentate
una volta, insieme alla [0063](0063-la-maschera-e-dell-esemplare.md), e
**ritirate**.

Vale ripartire da lì, perché il ritiro è la cosa più utile che questa voce ha
ereditato. I campi c'erano: `document-changes` e `schedule` in fondo alla
maschera, un `changes` in fondo a `event-document-changed`, un `timer-fired` in
coda al variant. E non li guardava nessuno — `mask_wants` non filtrava,
`ingest_model` riempiva `None`, il timer non lo faceva scattare niente.
**Aggiungere la dichiarazione è la parte facile di tutte e due queste voci, ed è
la parte che non serve a nulla da sola.** Il costo di quel ritiro fu zero perché
nessuno ci si era ancora abbonato; dopo M4 non lo sarebbe più.

## Un verbale solo, e la ragione non è quella che sembra

Il cappello della seduta afferma che le tre voci sono «tre estensioni della
stessa maschera, disegnate da tre lati». Letta per **cosa afferma** — che è il
criterio della [0054](0054-il-banco-del-lato-provider.md)/[0055](0055-il-banco-del-lato-host.md),
*un cappello va letto per cosa afferma, non per quante voci nomina* — quella
frase è già stata smentita una volta: la §22.3 non è finita in un campo di
`EventMask`, è diventata `ViewProvider::interests()`, cioè una funzione su
un'altra interfaccia.

Quindi ciò che lega queste due voci non è il **record**. È la **regola** che il
ritiro della 0063 ha messo a verbale: *una dichiarazione che il kernel non
valuta mente a chi la scrive*. Applicata una volta sola a entrambe, quella
regola dà due case **diverse** — la §22.2 è un campo di maschera, la §22.1 non
lo è affatto — e questo non contraddice l'accorpamento: lo **giustifica**.
Deciderle separate avrebbe voluto dire rispondere due volte alla domanda «dove
va una dichiarazione, e chi la guarda», e la seconda volta contro la prima. È il
caso della [0053](0053-il-contratto-ha-una-sorgente.md) — due voci, lo stesso
ragionamento — con una differenza che vale la pena: là l'accorpamento lo
dichiarava il cappello, qui il cappello dice una cosa **sbagliata** e
l'accorpamento regge lo stesso, per una ragione che il cappello non aveva visto.

## La regola, applicata: dove va una dichiarazione

**Una maschera filtra, non causa.** È la frase che risolve la §22.1, ed è la
ragione per cui il tentativo ritirato non poteva trovare un valutatore nemmeno
volendo. Una `EventMask` si applica **agli eventi che accadono**: dice, di ciò
che è successo, cosa mi interessa. Un timer invece dice *fa' succedere questo*,
e un evento che nessuno ha fatto partire non c'è da filtrare. Mettere `schedule`
in fondo alla maschera non era «un campo che nessuno aveva ancora cablato»: era
un **errore di categoria**, e nessuna quantità di lavoro l'avrebbe cablato.

Da qui le due risposte, che sono diverse perché le due domande lo sono:

- **§22.2 — cosa è cambiato** è una proprietà di un evento che è già successo.
  Quindi: un campo in coda a `event-document-changed`, e un quarto asse in coda
  a `event-mask` che lo filtra. Due record, due aggiunte in coda, esattamente
  come la voce prevedeva.
- **§22.1 — quando** è una dichiarazione che precede l'evento. Quindi va dove
  stanno le dichiarazioni che si leggono **prima** di montare: il
  `PluginManifest`. Il precedente è `settings`
  ([0036](0036-le-impostazioni-e-i-tre-stati.md)), e il criterio è lo stesso
  letto su un asse diverso — là la dichiarazione doveva precedere `activate`
  perché il primo lettore di un'impostazione è proprio un `activate`; qui perché
  una sveglia è ciò che fa esistere l'evento.

E la **sveglia in sé** resta un evento e non una capacità, che è il no della
[0013](0013-elenco-delle-capacita.md) confermato con l'altra sua ragione. La
premessa che quella decisione aveva scritto — «il kernel è sincrono e non
possiede thread: `spawn_job` accoda e chi ha i thread (l'app) drena» — **non è
più vera** dalla [0032](0032-il-runner-dei-job.md). La conclusione regge per la
regola che la 0013 aveva scritto nella stessa pagina: *una capacità è ciò di cui
il chiamante ha bisogno della risposta per proseguire; ciò che si limita a
informare è un evento.* Una sveglia informa. La 0013 lo aveva anche previsto per
iscritto — «quando arriveranno, arriveranno come `Event`, ed è additivo» — e
questa è la riga che rende vera quella previsione.

È la terza specie di **premessa sbagliata** che una voce può contenere, e la
distinzione dalle due che la [0067](0067-il-registro-di-cio-che-e-successo.md)
elenca è netta: la [0053](0053-il-contratto-ha-una-sorgente.md) ha smentito un
*fatto sull'architettura* che era sbagliato quando fu scritto, la 0067 una
*classificazione* nata falsa; qui la premessa era **vera quando è stata
scritta** e l'ha resa falsa una decisione successiva, presa da un'altra voce e
senza sapere di toccarla. Non è un errore di chi scrisse la 0013: è la specie di
riga che invecchia perché il repo si muove sotto di lei. Da tenere come
criterio: **una voce che cita la premessa di un verbale cita un'affermazione su
ieri**, e va verificata contro il repo di oggi prima di ereditarne la
conclusione — che è quello che questa voce ha fatto, e che l'ha portata alla
stessa conclusione per una strada diversa.

## Chi valuta, e da dove si vede

È la parte che il ritiro della 0063 pretende, ed è la sola che distingue questa
voce da quel tentativo. Per ciascuna delle due dichiarazioni:

**§22.2.** Il valutatore è `mask_wants` (`crates/fub-abi/src/rules/events.rs`),
che ha guadagnato il quarto asse; e la sua gemella TS `maskWants`
(`frontend/src/rules/mirrored.ts`), che è il **secondo** applicatore vero — la
shell decide da sé quando ridisegnare — e che senza la stessa regola avrebbe
lasciato la promessa vera nel kernel e falsa in finestra. Le due non possono
divergere in silenzio: le lega la fixture generata di `rules_mirror.rs`.

Chi **riempie** il campo è `Workspace::ingest_model`, che chiama
`CoreIndex::changes_for` **prima** di toccare qualunque cosa. È l'unico momento
in cui il vecchio e il nuovo esistono insieme — il modello è arrivato, i
metadati di prima sono ancora in `metas`, i tag di prima ancora in `tags`,
l'impronta di prima ancora nell'anagrafe — ed è l'esito che la voce chiama «si
ha in mano e si butta». Il diff costa **zero letture dal disco**.

**§22.1.** I valutatori sono due, e sono di due strati:

- il kernel, con `Workspace::fire_timer(owner, timer)`, che **rifiuta** di far
  suonare una sveglia che quel componente non dichiara (più). È la riga che
  rende la dichiarazione valutata invece che decorativa: senza, uno scheduler
  che si tiene una copia dell'elenco resterebbe l'unica autorità su chi si
  sveglia, e il contratto direbbe che la sveglia è del manifest mentre in realtà
  è di chi l'ha copiata. Ne segue gratis la cosa giusta alla disattivazione — un
  componente che se ne va si porta via le proprie sveglie, e non c'è un secondo
  registro da ricordarsi di ripulire, perché **il registro è il manifest**;
- l'host, con lo scheduler dentro il pool dei job
  (`crates/fub-host/src/runner.rs`), che riallinea i propri quadranti a
  `Workspace::declared_timers()` a ogni giro e chiama `fire_timer` per ciò che è
  scaduto.

## Il kernel non legge l'orologio, e il contratto porta la regola

Lo scheduler è dell'host — la voce lo diceva, e la
[0032](0032-il-runner-dei-job.md) aveva già stabilito che i thread sono suoi. Ma
«è dell'host» non vuol dire «è tutto suo»: se ogni host decidesse da sé cosa
vuol dire «ogni ora», due host farebbero suonare due sveglie diverse per lo
stesso manifest. Quindi il contratto porta **la regola**
(`TimerSchedule::nth_after(n)` — fra quanti secondi dalla registrazione suona la
n-esima volta) e l'host porta **l'orologio**. `declared_timers()` non ha un
`Instant` da nessuna parte, ed è deliberato: è la stessa disciplina con cui il
kernel non conosce `tauri` né `comrak`.

Lo scheduler misura in **tempo trascorso** (`Instant`) e non in orario di
sistema, e ne segue che «ogni ora» resta un'ora anche se qualcuno sposta
l'orologio della macchina. Il quadrante si avanza dall'**ancora** e non dal
risveglio: contare da adesso farebbe slittare in avanti ogni giro di quanto il
pool ha tardato, e dopo un giorno la sveglia sarebbe di un quarto d'ora più
tardi senza che nessuno abbia cambiato niente.

## La grana del *cosa è cambiato*: si filtra per aspetto, si legge per nome

È la domanda su cui questa voce poteva sbagliare in due modi opposti — troppo
fine costa un diff a ogni scrittura, troppo grosso e l'automazione si risveglia
per niente — e la risposta è che **le due metà non hanno la stessa forma**:

- **`DocChange`** è l'insieme **chiuso dal contratto** degli aspetti — `body`,
  `frontmatter`, `tags`, `links`, `outline`, `anchors` — ed è l'unico asse su
  cui la maschera filtra. Chi applica una maschera lo fa per ogni handler a ogni
  evento (`deliver_to_handlers` la interroga a ogni consegna, non memoizzata):
  deve poter rispondere sì o no confrontando due liste corte di valori senza
  payload, che è la stessa proprietà per cui la 0033 aveva scelto tre campi in
  and invece di una maschera per specie;
- **`DocChanges`** porta in più i **nomi** — quali chiavi di frontmatter, quali
  tag aggiunti, quali tolti — che si **leggono** e non si filtrano.

Il taglio non è un compromesso, è ciò che toglie il conto vero. La voce descrive
il danno così: un'automazione su «la scadenza è cambiata» si sveglia a ogni
scrittura di ogni nota del suo soggetto «e **rilegge** per scoprire che non la
riguardava». Con questa forma non rilegge mai: si sveglia sul solo aspetto
`frontmatter` e guarda `properties`. Il risveglio resta più largo di quanto
potrebbe essere un filtro per chiave; la **rilettura**, che è la parte cara e
quella che obbligava ogni automazione a tenersi una copia di ieri per
confrontarla, sparisce del tutto. E il diff che produce quei nomi è già in mano
a chi emette l'evento: metterli nell'evento costa zero, metterli nella maschera
sarebbe costato un asse il cui dominio è dato dell'utente.

**Perché non un filtro per chiave.** Perché sarebbe un asse illimitato in un
posto che si valuta a ogni consegna, e perché la risposta precisa c'è già
nell'evento: chi la vuole la legge, invece di farla calcolare al kernel per
tutti. È la stessa forma dell'argomento con cui la 0033 ha tenuto fuori dai
soggetti le query — *un abbonamento non è una query* — su un asse diverso.

**E il terzo trigger che la 16.2 chiede.** «Trigger su tag aggiunto» è
`tags_added`, «su proprietà cambiata» è `properties`; **«su task completato» non
ha un campo nel modello**. `DocumentModel` non ha i task, quindi oggi un task
completato è indistinguibile da un cambio di `body`, e nominarlo in `DocChange`
sarebbe stato promettere una grana che il kernel non sa produrre — cioè
esattamente ciò che il ritiro della 0063 aveva punito. È un **buco dichiarato**
nel senso della [0064](0064-il-supporto-sta-sotto.md): non è lavoro rimandato, è
un fatto sulla forma del modello, e il giorno che il modello avrà i task
`DocChange` cresce **in coda**, che è additivo.

## I due stati di `changes`, e perché sono due

`changes` è un `option<doc-changes>`, e i suoi due stati dicono cose diverse:

- **assente = *non lo so*.** L'evento non viene dalla coda di una scrittura del
  kernel. Passa qualunque filtro, ed è la stessa regola per cui la 0033 lascia
  passare ciò che non nomina nessun documento: filtrare via ciò di cui non si sa
  niente vuol dire perdere in silenzio, e perderlo proprio a chi si è abbonato
  stretto, cioè a chi ha fatto la cosa giusta;
- **presente e vuoto = *niente è cambiato*.** Una riscrittura con lo stesso
  contenuto. **Non** passa un filtro per aspetto, ed è la risposta giusta: se
  passasse, il filtro non toglierebbe niente proprio nel caso in cui ha la
  risposta più precisa.

Confonderli sarebbe stato il difetto vero di questa voce, e sta a verbale perché
la lettura plausibile — «vuoto vuol dire non filtro, come per gli altri tre
campi» — è quella sbagliata: quella regola vale per i campi della **maschera**,
e qui il vuoto è di un campo dell'**evento**.

## Trovato per strada

- **Il ponte raggruppava, e adesso raggruppare perde un fatto.** Il doc di
  `coalesce` (`crates/fub-host/src/bridge.rs`) diceva che le quattro grane
  raggruppabili non portano «un fatto che le altre copie non portino», e che «un
  `document-changed` dice *rileggi questo* e due volte dice la stessa cosa». Con
  `changes` **non è più vero**: due `document-changed` della stessa nota nella
  stessa raffica possono dire uno «è cambiato un tag» e l'altro «è cambiata una
  proprietà», e tenere l'ultimo butterebbe metà del racconto — in silenzio, e
  proprio a chi si è abbonato stretto. Adesso il ponte **fonde** invece di
  buttare (`DocChanges::merge`), e `None` vince su `Some` perché se di una delle
  due copie non si sa niente, dell'unione non si sa niente. È il genere di
  difetto che questa voce introduceva senza toccare una riga di quel file, e che
  si vede solo rileggendo le frasi che il contratto rendeva vere — l'argomento
  della [0067](0067-il-registro-di-cio-che-e-successo.md) sulle frasi in testa
  ai moduli, qui su una frase in testa a una funzione.
- **Un evento emesso fuori dal giro sincrono resta in coda.** `fire_timer` è
  chiamata dal pool, cioè da fuori: senza `dispatch_pending` l'evento sarebbe
  rimasto in coda fino alla prossima scrittura di qualcun altro, e la sveglia
  sarebbe arrivata quando il vault si muoveva — cioè mai, in un'app ferma, che è
  l'unico momento in cui una sveglia serve. È la stessa riga che `complete_job`
  ha per la stessa ragione, e a trovarla è stato il test.
- **Chi dorme non sa che è arrivata una sveglia.** Il pool aspetta senza
  scadenza finché nessuno dichiara timer — è la promessa fatta a chi non ne
  dichiara — e un componente montato *dopo* che i thread si sono addormentati
  sarebbe rimasto senza sveglia fino al primo job di qualcun altro. Dichiarare
  un timer adesso **suona il campanello**, che è la stessa mossa con cui `stop`
  sveglia i dormienti: la campana non annuncia un job, annuncia che c'è da
  ricontare.
- **`EventMask::all()` non nomina `Trouble`**, e adesso nomina `TimerFired`.
  Aggiungere il caso nuovo è stata una decisione e non un modo di far tornare
  verde un test: chi chiede *tutto* riceve una sveglia, perché una sveglia è un
  evento come gli altri. Il buco di `Trouble` resta, è vero, ed è **di un'altra
  voce** (§20.2): non lo si allarga e non lo si chiude di straforo qui. Ma va
  detto che «all» è una parola che promette, e che il posto in cui la promessa è
  vera a metà è il peggiore possibile.
- **Il diff non poteva usare la cache per il corpo.** `DocMeta` non tiene il
  testo — è lo split metadata/body — quindi `DocChange::Body` non si poteva
  calcolare da lì. A rispondere è l'**impronta** che l'anagrafe teneva del giro
  prima (§14.1), che è già in memoria: il corpo entra nel diff senza che nessuno
  rilegga niente e senza che la cache ingrassi. E se quell'impronta manca — una
  voce entrata senza fingerprint — la risposta è «sì»: dire di no farebbe
  perdere un risveglio a chi ha ragione.

## Cosa NON è stato fatto, e perché

- **Un orario di parete** («ogni giorno alle 9»), che la §22.1 nomina per primo
  fra i tre esempi. `TimerSchedule` ha `every` e `after`, che sono le due forme
  misurabili in tempo trascorso; «alle 9» vuole un **fuso** e una regola
  sull'**ora legale**, cioè decidere da dove viene il fuso (il sistema? le
  impostazioni? il locale della [0039](0039-il-locale-e-il-caso.md)?) e cosa
  succede al giro che cade dentro un'ora che non esiste. È una decisione, non un
  pezzo di lavoro — quindi per il criterio di questa cartella non è una casella
  residua ma una **voce nuova**, la §22.4, ed è il caso della
  [0056](0056-un-elenco-che-e-la-sorgente.md). Il `variant` cresce in coda il
  giorno che si prende, e chi ha dichiarato `every` non se ne accorge.
- **Un asse *quando* nella maschera.** Vedi sopra: una maschera filtra, non
  causa.
- **Un filtro per chiave di frontmatter o per nome di tag.** Vedi sopra: la
  precisione la dà l'evento.
- **Una capacità `schedule_at`.** Vedi sopra: la 0013 aveva ragione, per l'altra
  sua regola.
- **Un settimo ponte IPC.** Non ne è stato aggiunto nessuno, e non è stato
  difficile: `changes` viaggia dentro un evento che il ponte già trasporta, e le
  sveglie non hanno un cliente nella shell. `i_ponti_restano_sei` è verde senza
  essere stato toccato.
- **Un filtro sui timer per proprietario.** `TimerFired` è broadcast e chi si
  riconosce lo fa da `owner`, che è la stessa forma di `JobDone` e la stessa
  ragione. Va detto che è il verso *largo*: chi si abbona a `timer-fired` riceve
  anche le sveglie degli altri. Con i timer il moltiplicatore che la 0033
  esisteva per togliere non morde — sono pochi per installazione e suonano al
  minuto, non a ogni scrittura — e inventare un asse per un conto che non c'è
  sarebbe stato aggiungere una dichiarazione prima di avere il difetto che la
  giustifica.

## Verifica

- `cargo build --workspace`, `cargo clippy --workspace --all-targets` e
  `cargo fmt --all --check` — pulite, zero warning.
- `cargo test --workspace` — **96 suite, 0 fallimenti**, di cui due nuove:
  - `crates/fub-kernel/tests/cosa_e_cambiato.rs` (§22.2), quattro prove scritte
    **in coppia** come quelle della 0033 — la maschera stretta che non riceve e
    la stessa storia con la larga che riceve, perché una prova che mostra il
    solo silenzio non distingue un filtro che funziona da un handler mai
    chiamato. Ha un formato di prova suo, perché `TestoDiProva` mette tutto in
    `text` e contro di lui ogni scrittura sarebbe un solo `Body`;
  - `crates/fub-kernel/tests/le_sveglie.rs` (§22.1), sei prove sulla metà che è
    contratto — la dichiarazione, chi la valuta, e il componente che se ne va;
  - più due in `crates/fub-host/tests/il_runner.rs` (la sveglia che suona **da
    sola**, senza che nessuno la chieda) e due nelle unità di `bridge.rs` (il
    raggruppamento che fonde).
- **Provate al contrario — nove sabotaggi, nove rossi**, ed erano nove per
  coprire i due valutatori di ciascuna voce:
  1. tolto il quarto asse da `mask_wants` (**il sabotaggio che conta**: è il
     tentativo ritirato riscritto alla lettera — il campo c'è e nessuno lo
     valuta) → `a_mask_on_an_aspect_does_not_wake_up_for_the_others` e
     `rewriting_the_same_bytes…` falliscono;
  2. `ingest_model` che riempie `None` invece del diff (l'altra metà dello
     stesso ritiro) → tutte e quattro le prove della §22.2 falliscono;
  3. tolta da `fire_timer` la verifica che la sveglia sia dichiarata →
     `nobody_rings_a_bell_that_was_not_declared` e
     `a_component_that_leaves_takes_its_alarms_with_it` falliscono;
  4. il pool che torna ad aspettare senza scadenza →
     `una_sveglia_dichiarata_suona_da_sola` fallisce;
  5. il ponte che butta invece di fondere → le due prove nuove di `bridge.rs`
     falliscono;
  6. `maskWants` di là senza il quarto asse → `rules-mirror.test.ts` diventa
     rosso: le due implementazioni non possono divergere in silenzio;
  7. `None` trattato come `Some(vuoto)`, cioè *non lo so* filtrato via → la
     fixture di `rules_mirror` e
     `not_knowing_passes_and_knowing_nothing_does_not` falliscono. Il primo giro
     di questo sabotaggio ha mostrato che a coprirlo era la **sola** fixture, e
     la prova di unità è stata scritta per quello;
  8. tolto il `ring()` alla dichiarazione di un timer →
     `una_sveglia_dichiarata_suona_da_sola` fallisce (il pool resta
     addormentato);
  9. `wit_conformance` non è stato sabotato di proposito perché lo ha fatto da
     sé: il suo destructuring esaustivo **non compila** finché i campi nuovi non
     sono dichiarati al confine, che è il modo in cui un presidio chiede di
     essere aggiornato invece di lasciarsi aggirare.
- **Contratto:** tutto in coda, e `crates/fub-abi/wit/frozen/0.1.0.wit` **non è
  stato toccato** — `wit_additivity` è verde con ragione, non per un ritaglio.
  Le aggiunte sono: `doc-change` (enum nuovo), `doc-changes` (record nuovo),
  `event-timer-fired` (record nuovo), `timer-spec`/`timer-schedule` (record e
  variant nuovi), un campo in fondo a `event-document-changed`, uno in fondo a
  `event-mask`, uno in fondo a `plugin-manifest`, un caso in fondo al
  `variant event` e uno in fondo all'`enum event-kind`. Sul caso in più al
  `variant`, [`wit-congelato.md`](../architecture/wit-congelato.md) va guardato
  in faccia: quella pagina scrive che «nel component model aggiungere un caso a
  un `variant` non è nemmeno additivo davvero», e che la regola che questo
  progetto ha scelto dice che lo è. Questa voce non inventa un'eccezione:
  applica quella regola come l'ha applicata la
  [0041](0041-un-errore-e-testo-che-qualcuno-legge.md), che ha aggiunto tre
  varianti in coda a `plugin-error` chiamandole additive. Il minimo che la
  pagina chiede — che il discriminante di ciò che c'era non si muova — è
  rispettato, e `wit_additivity` lo verifica.
- **Mirror rigenerati** (`UPDATE_MIRROR=1` su `ts_mirror`, `rules_mirror` e
  `ts_enums`) e i gemelli di là aggiornati: `npx tsc --noEmit` pulito e
  `npx vitest run` **22 file, 343 test**. Il campione di maschera **stretta** di
  `ts_mirror` ha guadagnato un `on_changes`, per la ragione con cui la 0033 gli
  aveva dato un topic e due soggetti: senza, `changes` sarebbe stata una lista
  vuota in ogni campione e il mirror sarebbe rimasto verde senza aver mai visto
  un aspetto.
- **Il costo per scrittura, misurato.** Il banco delle prestazioni non c'è — è
  la metà aperta della §17.1, e aspetta una macchina
  ([0060](0060-il-modello-dice-il-vero-sui-byte.md)) — quindi la misura è ad hoc
  e va letta per l'ordine di grandezza. Su una scrittura intera
  (`write_document` su una nota di 40 righe) il costo del diff **non è
  separabile dal rumore**: ~10,5 µs per scrittura, con una dispersione fra corse
  del ±20%. Misurato invece il diff da solo, in `--release`, con 200.000
  ripetizioni: **0,375 µs** con 3 chiavi di frontmatter e 10 tag, **1,03 µs**
  con 30 chiavi, **8,2 µs** con 300. Su una nota vera (le prime due righe) sono
  il 3–10% di una scrittura, dominata dal disco e dal parse; la terza riga non è
  una nota, è il punto in cui la forma di questo diff smetterebbe di essere
  gratis, e sta qui perché quel punto si sappia dov'è. Il pavimento dei 0,375 µs
  sono le due `BTreeSet` che il diff dei tag alloca: si abbasserebbe
  confrontando due liste ordinate, e non è stato fatto perché ottimizzare sotto
  il rumore di ciò che lo contiene è lavoro che non si può nemmeno verificare.
