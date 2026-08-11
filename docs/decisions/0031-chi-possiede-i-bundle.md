# 0031 — Chi possiede i bundle: una strada sola per montare, e chi smette avvisato mentre è ancora intero

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.3 (seduta 9) — **prima metà** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

**Questo verbale chiude mezza voce, ed è una novità di processo.** Finora un
verbale ne ha chiuse una o più; il §9.3 ne chiede quattro cose — il registry, il
runner dei job, la cancellazione e il safe mode — e le ultime tre vanno decise
insieme, perché «un pool che non nasce cancellabile si riscrive per diventarlo».
Qui c'è la prima: **chi possiede i bundle**. La voce resta aperta fino alla
[0032](0032-il-runner-dei-job.md), che è il runner con la cancellazione e
l'isolamento.

`mount` (in `fub-host`) era una tabella **cablata**: otto
`register_core_feature`, e poi diciotto registrazioni scritte a mano una per
una. La [0023](0023-chi-monta-il-kernel.md) l'aveva tolta da dentro un
`#[tauri::command]` e messa in un posto solo — che era la precondizione di
questa voce, non il suo rimpiazzo. Ciò che restava senza un proprietario era tre
cose, e sono le tre che questo verbale sistema:

- **nessuno possedeva un `Plugin`.** Il trait c'è dal principio — `manifest`,
  `activate`, `deactivate`, `run_job` — e **nessuna feature del repo lo
  implementava**. Ne seguiva che `Plugin::deactivate` non avesse un solo
  chiamante (la [0028](0028-come-un-componente-smette.md) lo dichiara, e spiega
  perché rimandarlo qui era giusto) e che `Plugin::run_job` non avesse nessuno a
  cui essere chiesto: la coda dei job porta l'id del plugin dalla 0028, e non
  c'era una mappa da quell'id a un corpo da eseguire;
- **`abi_compatible` era una regola senza applicazione.** La funzione esiste dal
  freeze e la sua regola è scritta («major diversa → rifiuto; minor del plugin ≤
  minor dell'host → accetto»), ma in produzione non la chiamava **nessuno**:
  `grep` la trova solo nel test che la definisce e nei due presidi del WIT.
  `Workspace::register_plugin` verifica il namespace dei servizi (§7.4) e i
  requisiti (§7.5), e la versione del contratto no;
- **la strada del montaggio era scritta una volta per feature.** Dichiarare,
  attivare, registrare: otto volte a mano, con l'ordine da ricordarsi. Chi a M5
  monta un plugin che arriva da un file ne avrebbe scritta una **nona**, e due
  idee della stessa strada non si accorgono mai di essere diverse.

## La risposta, in una frase

**Un bundle si monta host-side e in quattro passi sempre uguali — la versione
del contratto, la dichiarazione, `Plugin::activate`, i provider — perché
l'`HostApi` non ha capacità di registrazione e un plugin non può registrarsi da
sé; e chi lo monta lo *possiede*, perché è l'unico che può dirgli che sta
smettendo mentre è ancora intero.**

## Le decisioni prese, da NON ridiscutere senza motivo

- **Il registry è host-side, e non è una scelta di comodo: è l'unica
  possibile.** L'elenco delle capacità è **chiuso** dalla
  [0013](0013-elenco-delle-capacita.md) e nessun `register_*` ci compare. Ne
  segue una cosa sola, ed è la forma di tutto il resto: un plugin **non può
  registrarsi da sé**. Qualcuno deve leggergli il manifest, dichiararlo,
  chiamargli `activate` e mettere i suoi provider nelle mani del kernel — e quel
  qualcuno sta dalla parte dell'host, perché è l'unico che ha un
  `&mut Workspace`. È anche ciò che rende vera la frase del §9.3, «il pezzo che
  a M5 il caricatore WASM riuserà tale e quale»: a M5 il caricatore è host-side
  **per costruzione**, e ciò che cambia è *come si costruisce un `Plugin`* (un
  componente istanziato invece di un `Box` nativo), non chi lo dichiara né in
  che ordine.
- **Quattro passi, e i primi tre sono tutto-o-niente.** Versione del contratto,
  dichiarazione, attivazione: se uno dice di no il bundle non c'è e non ha
  lasciato niente dietro — un `activate` fallito si porta via anche la
  dichiarazione appena fatta. È la disciplina che `RegistryError` ha già dentro
  («ogni variante vuol dire *non è registrato*, non *è registrato a metà*»), un
  livello più in su.
- **Il quarto passo no, e l'asimmetria è deliberata.** I provider che non
  entrano sono **avvisi**: un bundle a cui una view si contende il nome è un
  bundle che funziona meno una view, e smontarlo per intero vorrebbe dire che un
  id doppio in un plugin di terzi spegne l'indice di ricerca. È anche il
  comportamento che c'era — «si dice su stderr e si tira dritto» — che qui
  smette di essere una riga ripetuta otto volte e diventa il valore di ritorno
  di un passo.
- **`abi_compatible` si applica per prima, prima della dichiarazione.** Non
  dopo: un plugin che parla un'altra major non deve comparire nell'inventario
  del §7.6 **nemmeno per un istante**, e un rifiuto che arrivasse dopo la
  dichiarazione dovrebbe disfarla — cioè sarebbe un caso in più da provare, per
  ottenere lo stesso stato che non dichiarare ottiene per costruzione.
- **`Plugin::deactivate` va PRIMA di `Workspace::deactivate_plugin`, e non è una
  preferenza: è l'unico ordine in cui quel metodo significhi qualcosa.** Dopo,
  la dichiarazione non c'è più e l'host intestato a quell'id è
  `Granted::undeclared`, che nega tutto: un `deactivate` chiamato lì riceverebbe
  un rifiuto su ogni capacità, cioè l'`host` nella sua firma non servirebbe a
  niente. La prova al contrario lo dice con le parole del diario — invertendo i
  due passi la spia scrive `smetto (host=false, provider=false)` invece di
  `(host=true, provider=true)`.
- **Ed è la stessa forma della
  [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md): si dice a chi c'è
  ancora.** Là `VaultClosed` arriva mentre tutti sono vivi e possono ancora
  scrivere; qui `deactivate` arriva mentre il bundle è **intero** — i suoi
  provider sono ancora registrati, e un bundle che nel proprio commiato invoca
  un proprio comando lo trova. Non è l'inverso *esatto* della strada di
  registrazione, e va detto: l'inverso esatto sarebbe togliere i provider, poi
  `deactivate`, poi ritirare la dichiarazione. Il kernel fonde gli ultimi due in
  un passo solo, e fra i due non esiste un momento osservabile da fuori.
- **L'ordine della chiusura resta del kernel: un gancio, non una seconda
  chiusura scritta host-side.** `Workspace::close_with` è `close` con un passo
  in più su ogni plugin, e `close()` è quel gancio con la funzione vuota. Il
  registry **non** riscrive «evento, flush, tutti a rovescio»: sarebbe una
  seconda idea di come si chiude un vault, e le due non si accorgerebbero mai di
  essere diverse — che è esattamente l'argomento con cui il §8.2 ha portato il
  montaggio in un posto solo.
- **La tabella resta una tabella: otto valori, non otto implementazioni del
  trait.** Le otto righe ufficiali hanno in comune tutto tranne *cosa
  registrano* — manifest di core, `Trust::Core`, nessuna risorsa propria da
  attivare — quindi `CoreBundle` è un valore con dentro una funzione, e `mount`
  continua a leggersi come l'elenco di ciò che esiste. Il trait resta quello
  generale, per il bundle che a M5 arriva da un file con un manifest letto e un
  grado di fiducia deciso dall'host.
- **Il grado di fiducia lo dice il bundle, e il default è il restrittivo.**
  `Trust` non sta nel manifest e non ci starà mai (è ciò che l'host pensa del
  plugin, non ciò che il plugin dice di sé): `Bundle::trust` ha come default
  `Trust::default()`, cioè `Community`, e le otto righe ufficiali scrivono
  `Trust::Core` a mano. È la stessa ragione per cui lo è in `register_plugin`:
  ciò che si ottiene dimenticandosi di dichiararlo non può essere più di ciò che
  si ottiene dichiarando.
- **Costruire un plugin non è attivarlo, e `Bundle::plugin()` non riceve il
  workspace.** Tutto ciò che ha bisogno del vault sta in `Plugin::activate`
  (roba del plugin) o in `Bundle::register` (roba di chi lo monta), che sono i
  due momenti in cui l'id è già dichiarato e quindi le capacità hanno un
  proprietario. A M5 quel metodo è l'istanziazione di un componente WASM, che il
  vault non lo vede nemmeno lei.
- **Il versioning spento resta dichiarato.** Era già così e resta così, ma
  adesso ha un nome: «dichiarato con zero registrazioni» è uno stato vero e
  **diverso** da «non c'è», ed è la frase che `PluginRegistry::retire` scriveva
  già per spiegare perché una disattivazione toglie la riga intera. Chi legge
  l'inventario del §7.6 distingue una feature spenta da una che non esiste.

## Trovato per strada

- **Quasi nessun bundle ha qualcosa da attivare, e non è un difetto del
  disegno.** Sette righe su otto hanno un `Plugin` che non fa niente
  (`OnlyProviders`), e la ragione è che il capitolo 7 aveva già ottenuto ciò che
  serviva: un provider si registra e sparisce dentro il kernel, che sa
  attivarlo, interrogarlo e chiuderlo da sé (`IndexProvider::close`, la 0028).
  Ciò che resta a un `Plugin` è precisamente quel che il kernel **non** può
  sapere: risorse proprie del bundle, e il corpo dei suoi job. Il conto vero si
  farà a M5, dove un componente WASM ha uno stato che il kernel non vede
  nemmeno.
- **Le due metà del versioning hanno trovato un posto invece di una nota.** Lo
  store si apriva dentro `mount` e usciva per un campo di ritorno; adesso lo
  apre la riga del suo bundle, e chi monta riceve ciò che quella riga ha aperto.
  Nessuna scorciatoia è cambiata: lo store si apre con l'`HostApi` intestato a
  `fub.versioning`, non con `std::fs`, perché chi monta non ha un canale
  privilegiato che un plugin non avrebbe.
- **La regola «dichiarati prima di registrare» ha smesso di essere un ordine da
  rispettare.** Era un commento in testa a `mount` («le feature vanno dichiarate
  prima di registrare qualunque cosa») e una cosa da ricordarsi scrivendo il
  ciclo; adesso è l'ordine dei passi dentro `BundleRegistry::mount`, uguale per
  la feature ufficiale e per il plugin di terzi. Una regola che vive nella forma
  non si dimentica alla riga scritta di fretta — è lo stesso argomento della
  [0030](0030-il-rilevamento-si-puo-chiedere.md) sugli esiti registrati dentro
  il kernel.
- **Un id dichiarato fuori dal registry esiste, e la chiusura non deve
  inciamparci.** `Workspace::register_core_feature` resta pubblico e i test lo
  usano parecchio: un id che non è un bundle di questo registry passa da `stop`
  senza che succeda niente. Ha un presidio dentro la prova della chiusura,
  perché è il genere di cosa che diventa un `unwrap` la seconda volta che si
  tocca.

## Cosa NON è stato fatto, e perché

- **Il runner dei job, la cancellazione e il safe mode.** Sono l'altra metà del
  §9.3 e vanno insieme: la voce lo dice per la cancellazione («va disegnata
  *con* il runner, non dopo»), e il safe mode è il confine di dove i job girano.
  Stanno nella [0032](0032-il-runner-dei-job.md) — e questa decisione ne è la
  precondizione, perché senza qualcuno che possieda i `Box<dyn Plugin>` non c'è
  nessuno a cui chiedere `run_job`. `BundleRegistry::plugin` è la porta, e oggi
  non la usa nessuno: è l'unica cosa qui dentro che aspetta un chiamante, e lo
  aspetta dal verbale successivo.
- **Nessun caricamento da file, nessun manifest letto da disco, nessun ordine
  topologico calcolato.** Il trait è la forma; chi legge un `.wasm` e ne ricava
  un manifest è M5. L'ordine di dichiarazione dev'essere topologico (§7.5) e a
  ordinarlo sarà il caricatore: il kernel non riordina ciò che gli si passa,
  dice che non sta in piedi — e il registry non ha ragione di saperne di più.
- **Gli avvisi sono stringhe già composte, e non è un rimando.** Vale la stessa
  frase della [0030](0030-il-rilevamento-si-puo-chiedere.md) per
  `last_sync_error`: quando l'errore al confine avrà codice e parametri (§12.2)
  l'avranno anche questi, e il canale dove mostrarli invece di `eprintln!` è il
  §20.2. Inventare qui una forma strutturata vorrebbe dire decidere la forma
  dell'errore per tutto il contratto con un cliente solo davanti.
- **Niente disattivazione a runtime dalle impostazioni.**
  `BundleRegistry::unmount` è la strada — `Plugin::deactivate` e poi il kernel —
  e adesso c'è; il pulsante che la chiama e lo stato che se ne ricorda sono il
  §11.1.
- **Il registry non è dietro un lock proprio, e oggi non serve.** Vive nella
  `VaultSession` accanto al workspace, e chi lo tocca passa già dal `Mutex`
  delle sessioni. Il giorno in cui N thread cercano il corpo di un job la
  domanda si rifà, ed è una domanda della 0032: deciderla adesso vorrebbe dire
  scegliere la forma del prestito senza avere davanti chi lo prende.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fub-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **59 suite, 0 fallimenti**. Sono le 58 della
  [0030](0030-il-rilevamento-si-puo-chiedere.md) più
  `fub-host/tests/montaggio.rs`, che ha quattro prove: un bundle che parla un
  altro contratto e non si monta, un `activate` fallito che non lascia un plugin
  dichiarato, chi smette che ha ancora l'host e i propri provider, e la chiusura
  che ferma i bundle a rovescio dopo aver annunciato a tutti. La spia è un
  **bundle intero** — un `Plugin`, un `CommandProvider` e un `EventHandler` — e
  il suo `deactivate` non segna di essere stato chiamato: *prova* a scrivere e a
  invocare un proprio comando, e scrive nel diario com'è andata. Un diario che
  dicesse «chiamato» passerebbe anche nell'ordine sbagliato.
- **Provate al contrario, tutte e quattro le righe che contano:**
  - togliendo il controllo di `abi_compatible`, il bundle che dichiara `0.2.0`
    si monta e la prova fallisce sul proprio `expect_err` («una minor più nuova
    di quella dell'host non si serve»);
  - togliendo il ritiro della dichiarazione dopo un `activate` fallito, fallisce
    con «la dichiarazione appena fatta è stata ritirata: *dichiarato* vuol dire
    *montato*»;
  - invertendo i due passi in `unmount` (prima il kernel, poi il plugin), il
    diario scrive `smetto (host=false, provider=false)` e la prova lo mostra
    riga per riga;
  - spostando `stopping` **dopo** `deactivate_plugin` dentro
    `Workspace::close_with`, la chiusura produce le stesse due righe con
    `host=false, provider=false`. È la prova che l'ordine della 0029 e questo
    passo nuovo non sono indipendenti. Il presidio dell'ordine della 0029 in
    `fub-kernel/tests/disattivazione.rs` non è stato toccato e resta verde:
    `close()` è `close_with` con la funzione vuota.
- **Contratto: non toccato.** Nessun tipo attraversa l'IPC in modo diverso —
  `Bundle`, `BundleRegistry` e `BundleError` vivono in `fub-host` e non
  compaiono in nessun record — quindi niente mirror TS da rigenerare e niente da
  rifare nel frontend.
- `cargo fmt --all` — pulita.
