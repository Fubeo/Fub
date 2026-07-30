# 0021 — Il confine: quante volte si scrive la disciplina

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §7.1–§7.6 (seduta 7, *ex* §1.38, §2.8, §2.10, §1.34, §1.24, §2.25) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/07-il-confine.md)

---

Sei voci, e una domanda sola: **quante volte si scrive la disciplina del
confine?** Il sesto giro le aveva viste come la stessa cosa guardata da lati
diversi — da chi il confine lo attraversa (i provider), da chi lo presta
(l'host), da chi ci vive dietro (i plugin) — e chiedeva di deciderle insieme
perché deciderle separate significa deciderle male: ogni risposta parziale
diventa il moltiplicatore della successiva.

Le sei voci sono chiuse.

## La risposta, in una frase

**Il confine ha dieci famiglie di capacità, una disciplina di prestito, un
registro di chi c'è, e una regola per i nomi.**

- **§7.1** — l'`HostApi` è la **somma** di dieci trait
  ([`fub_abi::traits`](../../crates/fub-abi/src/traits.rs)), e al confine WIT
  dieci `interface` che il `plugin-world` importa una per una. Il rifiuto è un
  wrapper generico ([`Guard<H, P: Policy>`](../../crates/fub-kernel/src/host/guard.rs)),
  non una impl gemella.
- **§7.2** — la disciplina di consegna (`take` → chiamata → ripristino con in
  coda chi si è registrato nel frattempo) è
  [`Workspace::lend`](../../crates/fub-kernel/src/workspace.rs), scritta una
  volta; i registri sono
  [`ProviderTable`](../../crates/fub-kernel/src/providers.rs).
- **§7.3** — c'è un [registro dei plugin](../../crates/fub-kernel/src/plugins.rs):
  chi registra si **dichiara** (manifest, permessi, fiducia), e ogni host nasce
  con davanti la politica del suo plugin.
- **§7.4** — un id ha un proprietario, e la regola è una sola per tutti e otto
  gli spazi di nomi: [`fub_abi::rules::ids`](../../crates/fub-abi/src/rules/ids.rs).
- **§7.5** — i plugin si chiamano: `provides`/`requires` nel manifest,
  `HostServices::call_service`, e un `ServiceProvider` che risponde.
- **§7.6** — c'è un inventario: `Workspace::plugins()`, e `VaultInfo.versioning:
  bool` non c'è più.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Le due strade del §7.1 non erano alternative: erano due metà.** La seduta le
  poneva come una scelta — il `Guard` nel kernel *oppure* la scomposizione in
  sotto-trait — e sono state prese entrambe, perché risolvono due problemi
  diversi che si somigliano. Il `Guard` toglie la impl gemella che serve a dire
  di no (`ReadOnlyHost` diceva no a dieci metodi e per dirlo ne riscriveva
  ventiquattro); la scomposizione toglie i **rifiuti che non sono nemmeno rifiuti** —
  i dodici `unreachable!()` di `ReadHost`, che dicevano il vero e non erano un
  tipo. Prendere solo la prima avrebbe lasciato il percorso di lettura a
  implementare capacità che non può avere; prendere solo la seconda avrebbe
  lasciato ogni politica del §7.3 a costare una impl.
- **Il criterio delle dieci famiglie è: cosa vuol dire negarne una.** Non
  «quante ne stanno comode insieme». Per questo la lettura del vault è separata
  dalla scrittura di testo *e* dalle operazioni strutturali (chi scrive una nota
  cambia ciò che l'utente ha, chi la cestina gliela toglie: un host può voler
  concedere l'uno e negare l'altro, e finché erano un trait solo quella
  distinzione non era esprimibile); per questo i blob del plugin si dividono
  nello stesso modo, e ciò che l'host sa e il guest no — l'orologio, il pannello
  attivo — è una famiglia sua invece di un residuo.
- **Al confine WIT la scomposizione smette di essere una comodità di tipi.** Un
  `world` che non importa `host-vault-write` non è un mondo che la rifiuta a
  runtime: è un mondo in cui **quella funzione non esiste**. È l'argomento che
  ha deciso di farla anche nel WIT e non solo in Rust, ed è anche perché andava
  fatta adesso: dopo il freeze una funzione non si sposta più da un'interfaccia
  all'altra.
- **`HostApi` e `ReadApi` sono somme con una impl generica, e nessuno le
  implementa a mano.** Chi le riceve continua a scrivere `&mut dyn HostApi` come
  prima: la scomposizione si paga solo dove serve — chi *implementa* un host, e
  chi vuole dire «questo non scrive».
- **Il costo ergonomico c'è, ed è dichiarato: i metodi di un trait si vedono se
  il trait è in scope.** Un test che chiama `host.read_document(...)` su un
  doppio adesso importa `VaultRead`. È il prezzo della scomposizione, si paga
  una riga alla volta, e non è nascosto da un prelude — un prelude
  rimetterebbe insieme proprio ciò che questa voce ha separato.
- **Cinque capacità non sanno dire di no, e la cosa è ora scritta dove si
  legge.** `emit`, `free_name`, `format_of`, `now_unix_millis`,
  `active_context` non restituiscono un `Result`: una politica che le nega può
  solo dare la **risposta nulla** (nessun evento, il nome che le è stato
  passato, nessun formato, il tempo a zero, nessun contesto). Non è una
  scappatoia del `Guard`: è una proprietà di quelle firme, ed è la lezione che
  questa seduta lascia alla decisione 0013 — **una capacità nuova dovrebbe
  portare un esito anche quando "non può fallire"**, perché non potendo fallire
  non può nemmeno essere negata.
- **Chi registra si dichiara, e un id non dichiarato è un errore.** Era la
  scelta più invasiva della seduta — tocca ogni `register_*` e ogni banco di
  prova — e l'alternativa era creare un plugin al volo dalla stringa, con
  permessi pieni. Sarebbe stata la regola opposta a quella che lo stesso kernel
  già applica: `Trust::default()` è il grado **più restrittivo fra quelli che
  girano**, «deliberato che ciò che si ottiene dimenticandosi di dichiararlo sia
  il più stretto». Concedere `Trust::Core` a chi non si è presentato avrebbe
  messo le due regole nello stesso file.
- **Le feature ufficiali si dichiarano come si dichiarerà un plugin.**
  `PluginManifest::core(id, nome)` è zucchero, non un percorso privilegiato:
  stesso registro, stesso manifest, stessi rifiuti. E i permessi che concede
  **non sono tutti** — leggere e scrivere il vault, invocare comandi, chiamare
  servizi; non la rete, non gli appunti, non la camera. Se il core avesse un
  permesso in bianco, il punto di applicazione del §7.3 sarebbe provato solo
  contro plugin che non esistono ancora.
- **Il `Trust` si è spostato dalla registrazione al plugin.** Era un parametro
  del solo `register_view_provider`, e la conseguenza la nomina il §7.3: un
  `IndexProvider` di terzi avrebbe ricevuto *ogni* documento del vault senza che
  nessuno gli avesse dato un grado. Adesso è una proprietà di chi si dichiara, e
  vale per tutto ciò che registra — view, renderer, indici.
- **Anche il percorso di lettura passa dal punto di applicazione.** `render_view`
  ed `export` ricevono un `Guard<ReadHost, Granted>`: un provider senza
  `read_vault` non legge il vault **mentre disegna** più di quanto lo legga da
  un'azione. Che il guard avvolga un `ReadHost` invece di un `KernelHost` non
  cambia niente per la politica, che non sa cosa ci sia sotto — ed è
  precisamente ciò che un wrapper generico compra.
- **La regola dei nomi: il core nomina anche nudo, gli altri solo dentro il
  proprio id.** `backlinks` e `note.create` restano quello che sono — sono i
  nomi che l'utente vede nella palette e nelle hotkey — e `fub:diagrams` è del
  core perché `fub` è il suo namespace. Un terzo scrive `com.acme.tasks:board`
  e nessun altro ci può entrare: ne segue la proprietà che serviva, **due plugin
  non possono collidere**, e il solo spazio conteso resta quello del core con sé
  stesso, dove una collisione è un errore di questo repo che un test vede.
- **Il separatore è `:` perché era già quello di `OptionMap`.** Le chiavi di
  opzione sono uno degli otto spazi di nomi: un secondo separatore avrebbe
  voluto dire una seconda regola con un secondo modo di sbagliarla. Si spezza
  sul **primo** `:`, che è ciò che permette a un id di plugin di essere un nome
  a domini rovesciati.
- **Una registrazione è tutto-o-niente.** Un provider che offre tre view e ne
  nomina bene due non ne registra due: `admit` prende **tutti** i nomi in una
  volta. Una registrazione a metà è uno stato che nessuno ha chiesto e che
  nessun test guarda.
- **Sostituire si chiede per nome.** `replace_view_provider` accanto a
  `replace_index_provider`: è la stessa disciplina della decisione 0019 e della
  0017, portata all'ultima famiglia che risolveva un id per tentativi. La
  differenza fra scavalcare qualcuno e farlo per sbaglio è che la prima si
  scrive.
- **La terna del §7.5 va insieme, e la terza domanda ha una risposta secca.**
  «Il dipendente si disattiva? Si attiva degradato?» — **non si dichiara
  affatto**. `register_plugin` rifiuta chi ha requisiti che nessuno offre, e chi
  monta legge quale manca. Ne segue che l'ordine di dichiarazione dev'essere
  topologico, e a M5 sarà il caricatore a ordinarlo: il kernel non riordina ciò
  che gli si passa, dice che non sta in piedi. «Attivo ma degradato» è uno stato
  che nessuno prova e che ogni feature dovrebbe poi gestire.
- **Un servizio gira con le capacità di chi lo offre.** Non presta i propri
  permessi a chi lo chiama, e chi lo chiama non presta i propri a lui. È la
  differenza fra una superficie fra pari e una scala per scavalcare i permessi —
  ed è per la stessa ragione che `call_service` è **negata in simulazione**
  mentre `run_command` passa: la catena dei comandi la governa l'host (il
  comando invocato riceve a sua volta un host simulato), un servizio di terzi
  no.
- **`provides` sta nel manifest e non in un metodo del provider.** L'host deve
  poterlo leggere *prima* di montarlo: è ciò con cui risolve le dipendenze di
  chi arriva dopo. In un metodo, per saperlo bisognerebbe averlo già montato.
- **L'inventario ha fatto sparire un booleano prima che diventasse venti.**
  `VaultInfo.versioning: bool` era un campo **per feature** dentro un record IPC;
  con i moduli del capitolo 21 sarebbero stati venti campi, ognuno una modifica
  al record, al mirror TS e alla fixture. La shell adesso non chiede «il
  versioning è acceso?»: chiede chi c'è (`hasPlugin`), ed è la stessa domanda che
  faranno il pannello plugin (20.1), il developer mode (20.2) e la diagnostica
  (24.2) senza aggiungere un campo a testa.

## Trovato per strada, e chiuso

**Le copie della disciplina di consegna erano quattro, non tre.** Il §7.2 ne
nominava tre — `deliver_to_handlers`, `flush_indexes`, `view_action` — e la
quarta era in `Workspace::import`, con sopra un commento che diceva «stessa
disciplina di `view_action`». Il commento era vero: era la dichiarazione della
duplicazione al posto del suo presidio, come il test scritto a mano che la
decisione 0020 aveva ritirato. Adesso sono quattro chiamate a `lend`, e il passo
che è facile sbagliare — rimettere i provider **in testa** invece che in coda a
chi si è registrato nel frattempo — è scritto in un posto solo.

**I topic degli `Event::Custom` non erano imposti da niente, e il §7.4 lo
sospettava senza averlo provato.** La convenzione (`"<plugin-id>/<nome>"`) stava
in un commento; un plugin poteva emettere sotto il nome di un altro e far
reagire i suoi handler. Adesso è la stessa regola degli altri nomi, e la fa
rispettare l'host **quando l'evento passa** — che è il solo momento in cui esiste,
non avendo una registrazione. Il rifiuto è una riga su stderr e non un errore,
perché `emit` non ha esito: è la quinta capacità senza risposta, e il suo posto
definitivo è il canale del §20.2.

**Le regole sintattiche e i renderer avevano una regola dei nomi *propria*, e
chiedeva la cosa sbagliata.** `SyntaxConflict::UnnamespacedId` pretendeva un
`ns:nome` da chiunque — anche dal core — e non chiedeva a nessuno che il
namespace fosse il **suo**: `terzi:mermaid` da parte del core sarebbe passato.
Erano l'unica famiglia con una regola scritta, e la scriveva a metà. Adesso
passano da `admit` come tutte, con un proprietario.

## Cosa NON è stato fatto, e perché

- **`ProviderTable` non è la tabella che il §7.2 immaginava, ed è meno.** Il
  §7.2 la disegnava come `ProviderTable<T>` con dentro anche la disattivazione
  (§9.4) e il `catch_unwind` (§9.3). Qui c'è la parte che era **quattro volte
  scritta** — il prestito — e non quelle due, che appartengono a una seduta che
  non è ancora stata fatta. Aggiungerle adesso avrebbe voluto dire progettarle
  senza la loro domanda davanti.
- **Il `Workspace` non è stato scomposto.** L'oggetto-dio del §8.1 guadagna tre
  campi (`plugins`, `services`, `service_stack`) e ne perde zero. È esattamente
  ciò che il §8.1 prevede — «ogni voce di questo piano gli aggiunge un campo» —
  e resta suo.
- **Le allowlist dei permessi non sono applicate.** `read_vault` e `write_vault`
  hanno un **parametro** (un elenco di prefissi di path) e la politica di oggi
  legge solo la presenza della chiave: un plugin con `read-vault` ristretto a
  `Progetti/` legge tutto. La forma c'è (è la decisione 0017), il punto di
  applicazione c'è (è questa), e il filtro per path non c'è: è additivo dentro
  `Granted`, e vuole il §15.5 (la politica dei path in un modulo solo) per non
  nascere con due idee di cosa sia un prefisso.
- **`network`, `clipboard`, `camera`, `external-fs` non governano niente**, e
  non è una dimenticanza: non c'è ancora una capacità che li userebbe. Il §7.3
  chiedeva il registro, non l'`if`; il giorno che `http_fetch` entrerà,
  `Capability::permission()` è la riga che le dà un permesso.
- **La regola dei nomi la fa rispettare chi registra, e non tutti i nomi si
  registrano.** `admit` prende gli id di chi si presenta — view, comandi, regole
  sintattiche, renderer, export, servizi, e i `ns` delle rotte di un indice — e
  `owns_name` prende il topic di un `Event::Custom`, che una registrazione non
  ce l'ha: lì è l'host a guardare, quando l'evento passa. Restano fuori i nomi
  che nascono **dentro una risposta**, dove non passano da nessuno: il `ns` di
  `UiNode::Custom`, di `ViewUpdate::Custom` e di `CommandOutcome::Custom` — un
  provider può rispondere sotto il namespace di un altro, e la shell che quel
  `ns` lo riconosce gli dà retta; i `custom_kind` del §3.2, da tutte e due le
  parti, perché `SyntaxRuleSpec::produces` non è guardato da niente e
  `CustomRendererSpec::kinds` ha una contesa a chi arriva primo
  (`RendererConflict::Claimed`) ma nessun **proprietario**, così un terzo che
  rivendica `fub:callout` e si registra per primo chiude fuori il core; e
  `JobSpec::job`, che un proprietario non ce l'ha affatto — `enqueue_job` accoda
  `(JobId, JobSpec)` senza registrare **chi** l'ha chiesto. Per i primi due il
  posto è quello di `emit` (l'host, al passaggio) ed è additivo, perché
  `owns_name` c'è già; per i job la domanda arriva col §9.3, che è dove qualcuno
  comincerà a drenare la coda — oggi `Plugin::run_job` è senza chiamanti come
  `activate`.
- **Nessun `deactivate`, nessun `unregister`.** Togliere un provider è il §9.4, e
  con la §7.4 chiusa adesso ha ciò che gli mancava: un id che è di qualcuno.
- **`Plugin::activate`/`deactivate` restano senza chiamanti.** Il registro tiene
  i manifest, non guida un ciclo di vita: quello è il §9.3, e la sua metà kernel
  è ciò che questo modulo prepara.

## Verifica

`cargo test --workspace`: **543 verdi** (erano 523), di cui 15 nuovi in
[`tests/il_confine.rs`](../../crates/fub-kernel/tests/il_confine.rs) — il
plugin senza `write_vault` che legge e non scrive, il revocato che non fa
niente, l'id non dichiarato che non riceve niente in bianco, le risposte nulle
delle capacità senza esito, l'id di view conteso, l'id nudo di un terzo (col
messaggio che porta l'id giusto), la sostituzione chiesta per nome, la chiamata
fra plugin, il servizio che nessuno offre, il requisito mancante, il servizio
rivendicato due volte, il giro nominato, e l'inventario.

`cargo clippy --workspace --all-targets` pulito, `cargo fmt` pulito. `npx tsc`
pulito, **172 test vitest**, `vite build` ok.

Linea di base del WIT **ritagliata** (pre-freeze) con la ragione dentro
`crates/fub-abi/wit/frozen/0.1.0.wit` e la riga in `docs/architecture/wit-congelato.md`: è la rottura più
larga fatta finora — ventiquattro funzioni cambiano nome qualificato e un record
si sposta — ed è l'ultima che riguarda l'`host-api`.

**Non verificato visivamente nell'app Tauri.** Due cose meriterebbero un occhio
quando qualcuno la aprirà: che il pannello cronologia compaia (adesso dipende da
`hasPlugin(info, "fub.versioning")` invece che da un booleano del backend), e
che nessuna delle sette feature ufficiali stampi «feature non dichiarata» o
«view non registrata» all'apertura del vault — che sarebbe il segno di un id
sbagliato in `open_vault`.
