# FubMD — Piano di creazione

Documento di piano/architettura del progetto. È l'**indice**: cattura contesto,
decisioni e invarianti, e rimanda ai documenti di dettaglio per architettura e
milestone.

## Contesto

Obiettivo: un'app di note markdown **stile Obsidian, in Rust**, che Fabio vuole
usare davvero (non un prototipo). Requisito distintivo emerso in fase di
discovery: un **sistema di plugin** in cui i plugin siano "veloci quanto le
feature native", e in cui molte feature native siano di fatto plugin (nel senso
di *implementare gli stessi trait*, non di girare in sandbox WASM).

## Decisioni (con il perché)

| Tema | Decisione | Perché |
|---|---|---|
| Shell/UI | **Tauri v2** (core Rust + webview) | Massima fedeltà a Obsidian, editor maturi (CodeMirror 6). |
| Architettura core | **Core agnostico rispetto al formato** | Il kernel non sa cos'è il markdown; sa di documenti, link, tag, heading astratti. L'agnosticismo è **sintattico**: la *semantica* dei link (risoluzione stile Obsidian, alias) è vocabolario del kernel, e ogni provider vi si mappa — vedi [data-model.md](architecture/data-model.md). |
| Estensibilità | **Trait di estensione definiti una volta sola** in `fubmd-abi` | Un solo contratto; impl native e (a M5) proxy WASM condividono la stessa firma. |
| Formato | **`trait FormatProvider`**, markdown = primo provider nativo | Domani org-mode/AsciiDoc sono altri provider, zero modifiche al kernel. |
| Feature ufficiali | **Impl native dei trait**, non WASM | "Veloci quanto native" perché *sono* native; nessuna tassa di serializzazione. |
| Plugin di terzi | **WASM (wasmtime), solo al confine di fiducia → Milestone 5** | Sandbox + velocità quasi nativa, senza pagarla dove non serve. |
| UI dei plugin | **Dichiarativa + escape hatch** | Il plugin descrive la UI (`UiNode`), il core la disegna; web-view isolata solo se indispensabile. Le superfici canvas ad alte prestazioni (graph view) restano del core finché la `WebView` per plugin non ha asset story/CSP (M5) — il dogfooding vale per il dichiarativo. |
| Vault | **Compatibile Obsidian** | `.md` + frontmatter YAML, `[[wikilink]]`, `#tag`, callout, embed. Zero lock-in. |
| Verità del documento | **La sorgente sul disco**; `serialize` = generazione, mai round-trip | Il modello è lossy per costruzione; riscrivere un file da esso distruggerebbe la formattazione dell'utente. Modifiche programmatiche = patch via `Span`, e dalla [decisione 0008](decisions/0008-modifica-chirurgica.md) sono una primitiva del contratto (`apply_edit`) che porta la revisione su cui è stata calcolata. |
| Verità del documento **aperto** | **Il buffer dell'editor finché è sporco** | Il disco vale per i documenti chiusi; l'app flusha prima di cambiare documento, riallinea il buffer pulito su cambi esterni, e non lo sovrascrive mai da sporco (merge esplicito a M3) — vedi [data-model.md](architecture/data-model.md), "Le tre copie". |
| Rename | **Operazione di prima classe**: `DocumentRenamed` + riscrittura chirurgica dei link | L'identità è il path: remove+add perderebbe backlink e stato per-documento. |
| Delete | **Cestino `.trash/` dentro il vault**, non eliminazione (D1/D2) | È la cartella di Obsidian: un vault condiviso ha *un solo* cestino, zero lock-in. Cancellare è spostare; sulle collisioni il nome prende l'istante della cancellazione, mai una sovrascrittura. Il cestino è piatto, come quello di Obsidian, e il ripristino è un `write_document` normale. |
| Versioning | **Snapshot per-file + tombstone** nello storage per-plugin (`.fubmd-data/plugins/fubmd.versioning/`), come `EventHandler` (D4/D5/D8) | Cronologia per-nota e "vault al tempo T" con un meccanismo solo, senza portarsi in casa git. Ed è dogfooding: usa solo ciò che avrà un plugin di terzi. Il ripristino è una scrittura normale, quindi annullabile. |
| Versioning vs `Overflow` | **La perdita accettabile è quella dello _snapshot_, non quella dell'_evento strutturale_**: l'handler è abbonato anche a `EventKind::Overflow` e riconcilia | Perdere un `DocumentChanged` costa una versione in ritardo, e per un *campionatore* va bene — a differenza dell'indice, che per questo non passa dagli eventi. Ma perdere un `DocumentRenamed` spezzerebbe la storia in due chiavi per sempre, e perdere un `DocumentRemoved` lascerebbe "vault al tempo T" **a mentire** (nessun tombstone). Sull'`Overflow` la riconciliazione parte da `list_documents`: chi non c'è più prende un tombstone (l'istante della morte non si sposta), e di tutto ciò che c'è si rifotografa il contenuto — il dedup rende gratis gli immutati. La frattura da rename perso degrada a "nuova storia + tombstone della vecchia", che è onesto: i rename non si indovinano dal contenuto. |
| Spegnibilità | **Il versioning si spegne del tutto** (D7), e uno spegnimento è possibile anche **a runtime**: `Workspace::deactivate_plugin` ([decisione 0028](decisions/0028-come-un-componente-smette.md)) chiude gli indici di un plugin, toglie tutto ciò che ha registrato e ritira la sua dichiarazione | Principio non negoziabile ([funzionalita-future.md](appendix/funzionalita-future.md)): spento = l'handler non si registra, la UI non esiste, nel vault non compare nulla. |
| Ciclo di vita del vault | **`open` → `close`**, e la chiusura è tre momenti in quest'ordine: `Event::VaultClosed` mentre tutti sono ancora vivi, un flush di **tutti** gli indici, e poi ogni plugin che smette in ordine inverso di dichiarazione ([decisione 0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)) | Senza, `flush_indexes` aveva un solo chiamante in produzione — il callback del file watcher — cioè **la durabilità di un indice dipendeva da un componente opzionale**: su network share, cartelle cloud, CLI, e2e headless, PWA e mobile le scritture non diventavano durevoli mai, e il sintomo era solo una riapertura lenta. Il flush finale è il punto di consistenza che *non* è il watcher: il kernel non sa quando finisce un lotto (è dichiarato, ed è giusto), ma "l'app sta chiudendo" lo sa chi la chiude — l'app lo dice su `RunEvent::Exit`, non su `ExitRequested`, perché il secondo si annulla. `VaultClosed` arriva **prima** di spegnere chiunque perché è l'unico modo che ha chi non è un indice — un `EventHandler`, che un metodo di ciclo di vita non ha e non avrà — di rendere durevole ciò che teneva in memoria. |
| Vault aperti | **Una mappa, non uno slot**: `Host` tiene `root canonico → VaultSession`, ogni comando IPC accetta un `vault` opzionale, e il "corrente" è una comodità della shell ([decisione 0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)) | Prima aprire un vault **chiudeva** quello aperto: il corrente non era una comodità, era un'assunzione del backend, e ogni cosa che avrà due vault davanti (una finestra per vault, un confronto, un import fra vault, la CLI che ne interroga uno mentre l'app ne tiene un altro) sarebbe passata di lì a riscriverlo. La chiave è **canonica** perché due nomi dello stesso vault sarebbero due sessioni, e la seconda si fermerebbe — bloccando, senza errore — sul lock che l'indice della prima tiene sulla propria cartella. La metà shell (finestre, tab, layout) resta il §1.2. |
| Case dei path | `DocId` **byte-exact**, risoluzione wikilink **case-insensitive**, rename case-only supportato | Stessa semantica osservabile su FS case-sensitive (Linux) e case-insensitive (macOS/Windows) — vedi [data-model.md](architecture/data-model.md). |
| Lavoro lungo dei plugin | **Job fuori dal giro sincrono**: `HostApi::spawn_job` → `Plugin::run_job` (**con** l'`HostApi`, preso una chiamata alla volta) → `Event::JobDone` | I trait restano sincroni e **brevi**; rete, calcolo pesante e vault camminato per intero non bloccano mai il kernel. Il job vede il vault dalla [decisione 0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md), senza snapshot: fra due chiamate il vault può cambiare, e la guardia è la `base` della [0008](decisions/0008-modifica-chirurgica.md). Vedi [plugin-boundary.md](architecture/plugin-boundary.md). |
| Transclusion (embed) | **Placeholder dal provider, composizione kernel+frontend** | `render_html` resta puro per-documento; solo il kernel conosce la topologia del vault. |
| Indici (ricerca) | **Posseduti e alimentati dal kernel**, non dagli eventi; backlink serviti dal grafo | Un indice che perde un aggiornamento non tace: risponde *sbagliato*, in silenzio. La coda eventi ha un budget e può troncare, questo canale no. E i backlink hanno già una fonte di verità — il grafo — che conosce le ambiguità dell'intero vault: duplicarli creerebbe una seconda verità divergente. Vedi [M2](milestones/M2-search-graph.md). |
| Persistenza di un indice | **`HostApi` per-chiamata in `activate`, `flush` e `close`**, non altrove; registrazione = attivazione, con un id che assegna lo spazio dati | Senza host in nessuna firma, un index provider di terzi in WASM non potrebbe persistere *nulla* — lo stesso buco che il versioning ha fatto emergere per `EventHandler`, e l'unica voce del debito che toccava una **firma da congelare**. L'host arriva nei punti in cui lo stato attraversa il disco: `activate` per ritrovarlo, `flush` per scriverlo, `close` per lasciar andare ciò che si tiene — e quest'ultima è **obbligatoria** ([decisione 0028](decisions/0028-come-un-componente-smette.md)), perché un `Drop` non ha l'`HostApi` e a M5 un componente smontato non esegue niente affatto: senza, un indice di terzi non avrebbe modo di chiudersi bene, e uno che tiene un lock file lo terrebbe fino alla morte del processo. Non su `on_document_*` (mutazioni in memoria: costringerebbe il kernel a duplicare il modello a ogni salvataggio) né su `query` (che il kernel serve sotto prestito *condiviso*). Per-chiamata e non un handle: il kernel presta `&mut Workspace`, che `'static` non può essere. Il manifest di `SearchIndex` passa da `data_*`; la cartella mmap di tantivy da `Workspace::plugin_data_dir`, varco nativo dichiarato — vedi [traits.md](architecture/traits.md). |
| Risultati di ricerca | **`snippet` testo puro + `highlights: Vec<Span>`** | Un provider di terzi non deve poter iniettare markup nella webview privilegiata passando per i risultati (stessa regola di `UiNode::Html`); chi disegna avvolge gli intervalli con i propri elementi. |
| Quale ricerca ([decisione 0025](decisions/0025-la-ricerca-predefinita.md)) | **Di classe *omnisearch*, built-in e accesa di default** — non un plugin installabile | In Obsidian omnisearch è un plugin perché sotto c'è già una ricerca nativa; qui sotto non c'è niente, e due motori sullo stesso vault sono due ranking e due risposte alla stessa domanda — la stessa ragione per cui i backlink li serve **il grafo** e non un secondo indice. E la ricerca non è un pannello: è la strada per cui si arriva a tutto il resto (quick switcher, palette, `RunSearch` dal pannello tag, collezioni, `vault.replace`), quindi se il comportamento buono stesse in un plugin ognuna di quelle superfici dovrebbe sapere **se quel plugin c'è**. La conseguenza dura è che le parti che contano sono **firma**: `TextMode` non sa dire «a meno di un refuso» né, di conseguenza, «esattamente», e `DocumentMatch.highlights` sono span dentro `snippet` e non dentro il documento — quindi la ricerca dentro la nota aperta e il salto all'occorrenza sono *inesprimibili*, non stretti. Il fuzzy va nel contratto non perché sia importante ma perché deve poter essere **spento per singola query**: lo stesso `IndexQuery::Documents` serve la casella di ricerca e `vault.replace`, e un motore che indovina su un canale che poi scrive è un difetto. Tre **P0** nella [seduta 21](roadmap/21-la-ricerca-predefinita.md), tutte prima del freeze di M4. |
| Eventi | **Dispatch a coda anti-rientranza** + varco `Event::Custom` | Un handler che emette/scrive durante `handle` non rientra; i plugin comunicano via topic namespaced. Il budget anti-ping-pong tronca **rumorosamente**: `Event::Overflow { dropped }` avvisa chi deriva stato di riconciliare da zero — mai perdite silenziose. |
| Lotto ed origine ([decisione 0011](decisions/0011-il-lotto.md) + [decisione 0012](decisions/0012-origine-degli-eventi.md)) | **Un lotto è uno scope del kernel, non una transazione, e non lo apre un plugin**; un handler riceve `Notice { event, origin }` | Il lotto coalizza il solo `index-updated` — l'unico evento senza payload, quindi l'unico di cui N copie dicono quanto ne dice una — e chiude con `BatchEnded { batch, changed }`: una rinomina con 200 backlink passa da 201 ridisegni completi a 1, senza che gli eventi per-documento perdano un colpo. Non annulla niente e non si chiama come se lo facesse: il tutto-o-niente vuole il journal del §15.2, e un annullamento che non sopravvive alla morte del processo non è un annullamento. Non lo apre un plugin perché uno scope a chiusura garantita non attraversa il confine dei componenti: il lotto di un plugin è la sua invocazione di comando. `Origin.actor` è **chi ha chiesto**, non chi ha eseguito — è l'unica lettura per cui esiste («questa l'ho scritta io?»), e senza di essa l'automazione su-modifica di 16.2 si richiama da sola finché il budget non tronca. |
| Capacità dell'`HostApi` ([decisione 0013](decisions/0013-elenco-delle-capacita.md)) | **L'elenco è chiuso**: ventidue metodi, con le operazioni strutturali dentro e `storage_*` fuori | Dopo il freeze una capacità che manca è una feature che **non potrà mai essere un plugin**, quindi ogni voce è stata decisa a verbale — comprese quelle che non entrano, o «non ci avevamo pensato» diventerebbe indistinguibile da «è stata una scelta». Dentro: creare (che **rifiuta** un path occupato — è l'unica differenza con `write_document`, e senza di essa un template che sbaglia la data cancella una nota), rinominare (quella del kernel, che **riscrive i backlink**: non ce n'è una nuda, perché due semantiche sotto un nome sono una trappola), il giro del cestino, e `run_command`, che eredita modo, attore e lotto invece di prenderli come argomenti — una simulazione non diventa reale invocando qualcuno, e una macro di tre comandi resta una cosa sola. Fuori, con la ragione: allegati (§14.1), rete (i suoi due bloccanti, §9.1 e §7.3, sono **caduti** con la [0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md) e la [0021](decisions/0021-il-confine.md): resta che le allowlist dei permessi non sono ancora applicate), tempo differito (§8.3), cartelle (§14.3), e `notify`/`progress`/`log`, che informano senza aspettare risposta — cioè la definizione di un **evento**, non di una capacità. `storage_*` volatile è stato **tolto**: con `data_*` e le impostazioni non aveva più casi d'uso, e toglierlo dopo il freeze sarebbe stata una major. |
| Sicurezza UI | **`Html`/`WebView` riservati al codice fidato**, con un **punto di enforcement unico**: `Workspace::render_view`/`view_action`, dove ogni provider ha dichiarato il proprio `Trust` | Contenuto attivo nella webview privilegiata scavalcherebbe la sandbox WASM via UI. La regola era scritta e non applicata (`validate_untrusted` non aveva chiamanti): il varco esiste ora, con i suoi test, perché aggiungerlo al primo provider non fidato vorrebbe dire cercarlo fra N chiamanti. Vale anche per l'albero che torna da un'azione, non solo dal rendering. |
| AI autocomplete | **Rimandata**, futuro plugin core (locale + cloud) | Non blocca l'architettura; è un `CommandProvider`/`EventHandler`. |
| AI che *agisce* (centro di comando LLM, [FEATURES](FEATURES.md) 22.4) | **Rimandata come feature; il contratto è chiuso** ([decisione 0009](decisions/0009-registro-dei-comandi.md) + [decisione 0010](decisions/0010-comando-descritto-a-una-macchina.md)) | Un'AI che modifica N note o le impostazioni non è un provider in più: è il primo **chiamante non umano** del registro comandi — e i primi ad arrivare sono la CLI (27.1) e le automazioni (16.2). Un comando dichiara ora argomenti (`ParamSpec`), prosa (`description`) e raggio (`CommandScope`), e si invoca **senza applicare** (`InvokeMode::DryRun` → `CommandPlan`: i `DocId` impattati e un `EditRequest` per documento). Il consenso non è una capacità dell'host ma il giro *dry-run → piano → approvazione → apply*: un host chiamato *dalla* shell non può fermarsi a chiedere, e un piano si legge mentre «sei sicuro?» no. Ciò che l'host fa rispettare è il resto: argomenti convalidati contro la spec, e un `HostApi` in sola lettura a chi simula o si è dichiarato tale. |
| Piattaforme | Linux (primario, Arch) + Windows + macOS | Tauri le supporta; CI multi-OS da subito. |

**Invariante non negoziabile:** `fubmd-kernel` e `fubmd-abi` non dipendono da
`comrak`, `tauri`, `wasmtime` o `tantivy`. Ora è davvero **presidiata**, e non
solo affermata: `crates/fubmd-abi/tests/dependency_invariant.rs` interroga
`cargo metadata` e fallisce se una di quelle famiglie compare nel grafo delle
dipendenze normali — transitive incluse — o se i due crate ne dichiarano una
diretta fuori dall'elenco previsto. Su `fubmd-abi`, che ha tre dipendenze, la
maglia è più fine: la chiusura transitiva è **elencata per intero**, perché una
denylist per prefisso non vedrebbe un parser markdown con un nome nuovo.

**Invariante gemella:** `fubmd-features` (la libreria) non dipende da
`fubmd-kernel`. Le feature ufficiali sono impl dei trait del contratto, cioè
esattamente ciò che scriverà un plugin di terzi — e un plugin di terzi il kernel
non lo ha. Era affermata e non verificata; ora il kernel sta nei
`[dev-dependencies]`, dove lo usano i soli test end-to-end, ed è lo stesso test a
presidiarla.

Entrambe girano in CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)),
insieme alla conformità abi↔WIT.

Una conseguenza della gemella che vale la pena scrivere prima di scoprirla: **il
banco di prova del kernel non può stare in `fubmd-sdk`**. L'SDK è ciò che un
guest WASM importa, e metterci `fubmd-kernel` — foss'anche dietro una cargo
feature — significherebbe metterlo nel grafo di chi per definizione non lo ha.
Sono due crate, non due moduli ([todo.md](todo.md) §16.2).

**Regola d'oro (dal primo giorno):** ogni argomento e ogni valore di ritorno dei
trait è un tipo di `fubmd-abi`, `Serialize + Deserialize`, esprimibile come record
WIT — niente reference con lifetime, trait object o closure nelle firme. Così
l'impl nativa è veloce e il proxy WASM (M5) è meccanico. La verifica non si ferma
ai nomi: il test di conformità confronta **tipi e firme complete** dedotti dai
tipi Rust, e le tre conversioni load-bearing del confine (albero↔arena,
`usize`↔`u64`, elisione di `host`) sono codice con dei test — `fubmd_abi::arena`
e `tests/wit_conformance.rs` — e non più prosa nei commenti. Dettaglio in
[architecture/traits.md](architecture/traits.md).

## Struttura dei crate

```
fubmd-abi              contratto: modello documento comune + tutti i trait
  │                    (+ `arena`: la forma dei tipi AL CONFINE e le conversioni)
  ├─ fubmd-kernel      core agnostico: vault, grafo link, registry, event bus
  ├─ fubmd-sdk         helper per scrivere provider (scan #tag / [[wikilink]])
  ├─ fubmd-format-markdown   1° FormatProvider nativo (comrak)
  ├─ fubmd-features    feature ufficiali (backlink, ricerca full-text, versioning)
  │                    NON dipende dal kernel: solo dal contratto, come un plugin
  ├─ fubmd-host        chi MONTA: tabella delle feature, sessione, watcher
  │                    dietro un trait, ponte eventi. NON dipende da tauri
  ├─ fubmd-app         colla Tauri v2: IPC comandi/eventi, finestre, dialoghi
  ├─ fubmd-testkit     (§16.2) banco di prova del KERNEL: vault temporaneo,
  │                    provider minimo, asserzioni sugli eventi. Crate a sé e
  │                    non `fubmd-sdk::testing`, che è il banco dei PROVIDER
  └─ fubmd-wasm-host   (M5) host wasmtime per plugin di terzi
frontend/              Vite + TS + CodeMirror 6 (+ renderer UiNode)
wit/                   contratto WIT che rispecchia fubmd-abi (vivo da M2, freeze M4)
plugins/               (M5) plugin di esempio (wasm32-wasip2)
```

Il meccanismo "un trait, due backend": il trait vive in `fubmd-abi`;
`fubmd-format-markdown` lo implementa nativo; `fubmd-wasm-host` lo implementerà
come proxy. Il kernel vede solo `dyn Trait`.

La prima delle due divisioni che il piano aveva dichiarato è **fatta**:
`fubmd-host` esiste, e con lui `fubmd-app` è ridotto a colla Tauri
([decisione 0023](decisions/0023-chi-monta-il-kernel.md)) — quel montaggio ha
cinque clienti previsti (CLI, API locale, e2e headless, mobile, PWA) e nessuno
di loro poteva riusare un composition root che viveva dentro un
`#[tauri::command]`. Il registry dei bundle e il runner dei job, che la voce
elencava, restano aperti come §9.3: `fubmd-host` è dove atterreranno, ed è dove
il `JobHost` della [0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md) è già
atterrato. La
seconda è ancora da fare — **un crate per bundle di feature** (§16.3), perché
oggi compilare il pannello outline compila un motore di ricerca; va dopo il
§16.2, o i venti bundle di 21.2 si portano dietro venti copie del banco di
prova.

Anche `frontend/` è un albero, non un elenco di file, ed è stato dichiarato
**prima** che la seduta 2 ci riversasse venticinque specie di nodo nuove: la
mappa sta in [architecture/shell.md](architecture/shell.md), il perché nella
[decisione 0015](decisions/0015-la-forma-della-shell.md), e cosa ci è atterrato
sopra nella [decisione 0016](decisions/0016-cosa-e-una-view.md).

## Mappa dei documenti

**Architettura** (trasversale ai milestone):
- [architecture/data-model.md](architecture/data-model.md) — `DocumentModel`, `Block`/`Inline`, `Span`, `LinkTarget`, escape hatch `Custom`.
- [architecture/traits.md](architecture/traits.md) — i 7 trait del contratto, chi li implementa e a quale milestone, la tabella di esprimibilità WIT.
- [architecture/ui-protocol.md](architecture/ui-protocol.md) — protocollo `UiNode`, mapping sul frontend, regola dell'escape hatch web-view.
- [architecture/plugin-boundary.md](architecture/plugin-boundary.md) — `Plugin`/`HostApi`/`PluginManifest`, modello capability ibrido, sandbox WASM.
- [architecture/shell.md](architecture/shell.md) — l'albero del frontend, la cucitura unica con l'host, i due bus.

**Milestone**:
- [milestones/M2-search-graph.md](milestones/M2-search-graph.md) — ricerca (tantivy), grafo/indice incrementali, graph view, outline/tag panel, "crea nota".
- [milestones/M3-editor-fidelity.md](milestones/M3-editor-fidelity.md) — live-preview in-editor, command palette, settings dichiarativi, rendering callout/embed/math.
- [milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md) — freeze del contratto, WIT, conformità abi↔WIT, primo plugin nativo.
- [milestones/M5-wasm-runtime.md](milestones/M5-wasm-runtime.md) — `fubmd-wasm-host`, proxy WASM, applicazione delle capability, plugin di esempio.

**Piani di lavoro**:
- [todo.md](todo.md) — **roadmap infrastrutturale**: l'elenco delle voci
  **aperte**, cioè quali pezzi mancano perché la massa di
  [FEATURES.md](FEATURES.md) sia implementabile *come provider* invece che come
  codice dell'app. Sette giri sulla stessa domanda hanno prodotto novantanove
  voci, la centesima l'ha trovata una **misura** (la §8.4, dalla
  [decisione 0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e le
  ultime nove non le ha trovate nessuna delle due: le ha **aperte** una decisione
  di prodotto, la [0025](decisions/0025-la-ricerca-predefinita.md); le
  quarantotto chiuse sono uscite di lì e stanno in
  [decisions/](decisions/README.md).
  Le voci **non** sono raggruppate per strato ma per **seduta**: venti
  sedute più quella nata dalla 0025, e una seduta è un insieme di voci che
  conviene decidere in una volta sola, perché sono la stessa domanda vista da
  lati diversi e deciderle separate significa deciderle male. Ogni seduta è un
  file in [roadmap/](roadmap/), con in testa la ragione per cui quelle voci
  stanno insieme; `todo.md` è l'**indice** — le sedute, le sessantuno voci
  ancora aperte con strato e priorità, e gli allegati. Il piano lo diceva già, sparso in una
  ventina di note («vanno decise insieme», «va prima di», «o due terzi della
  risposta saranno inutilizzabili»): questa è quella conoscenza messa nella
  struttura invece che nelle note. Lo **strato** resta come etichetta su ogni
  voce, perché è ciò che ne fissa la **scadenza** — *contratto* vuol dire freeze
  di M4, cioè oggi un campo e domani una migrazione di versione, ed è il criterio
  che fa di una voce una **P0**; *kernel*, *shell* e *presidi* possono seguire
  (**P1** con M3, **P2** quando la scala lo chiede), e sono P0 solo per la metà
  che è firma.
  I capitoli che pesano di più: **«Cosa è una view»** — nove voci, otto P0, e
  insieme dicono che oggi una view è una funzione pura, sincrona,
  senza stato, che disegna in sola lettura su una delle tre superfici che
  esistono: senza input in `UiNode`, superfici oltre quelle tre, istanze,
  stato e chiave dei nodi, i capitoli 8.2 (proprietà), 11 (database), 16.1
  (template), 19.3 (form) e 28 (settings) non hanno dove atterrare;
  **«Chi disegna ciò che il core non conosce»** e **«Chi vede il modello
  parsato»** — erano il punto in cui l'invariante «una feature ufficiale è ciò
  che scriverà un plugin» era **già falsa**: il parser si poteva solo
  *sostituire*, e il `DocumentModel` non si poteva *chiedere*, quindi le ~50
  estensioni di 5.2 e chiunque volesse toccare il contenuto *strutturato*
  (spuntare un task, scrivere una proprietà, estrarre una citazione, esportare,
  fare chunking) non potevano essere un plugin. Sono chiuse con la
  [0017](decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) (una sintassi
  si **innesta** su un provider che non la conosce, e il blocco che ne esce
  arriva a schermo senza una riga nella shell) e con la
  [0018](decisions/0018-chi-vede-il-modello-parsato.md) (il modello **si
  chiede**, un documento alla volta); di quelle due sedute resta la coda shell —
  il grafo come ultimo pannello nativo, e la sintassi che nasce ancora due volte; **«Il canale dati»** — `query_index`
  risponde da sé a sette varianti su nove, quindi grafo, proprietà e salute del
  vault sono kernel-owned e a 7.3, 8.2, 10 e 15.1 resta solo `IndexQuery::Custom`;
  **«Il confine: quante volte si scrive la disciplina»** — il punto di
  applicazione dei permessi, gli spazi di nomi degli id (l'unica voce che non
  riguardava ciò che scriveremo ma ciò che abbiamo già pubblicato) e una
  capacità dell'`HostApi` implementata quattro volte a mano, tutti chiusi con la
  [0021](decisions/0021-il-confine.md); **«Il lavoro lungo, e come un
  componente smette»** — un job non vedeva il vault, quindi 17, 18, 19.4 e 22 non
  avevano un posto dove girare (chiuso con la
  [0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md)), e niente si
  disattiva; **«La forma della shell»**,
  che sta per prima perché è la precondizione che tutte le altre presuppongono e
  nessuna dichiara; e **«La ricerca predefinita»**, che non nasce da un giro ma
  dalla [0025](decisions/0025-la-ricerca-predefinita.md) — deciso che la ricerca
  è built-in e di classe *omnisearch*, le sue prime tre voci sono lo stesso
  record (`TextQuery`, `DocumentMatch`) e la stessa scadenza: oggi il contratto
  non sa dire «a meno di un refuso» né, di conseguenza, «esattamente», e gli
  estratti sono ancorati allo snippet e non al documento, quindi cercare *dentro*
  la nota aperta è inesprimibile. Fuori da quei capitoli restano P0, e per la stessa ragione,
  l'identità del documento (§13.1: il path è per sempre la chiave?), gli errori
  tipizzati al confine (§12.2) e la decisione sulle stringhe e sul locale
  (§12.1), che nessun contenitore della shell può prendere al posto del
  contratto. Chiudono l'elenco i presidi (l'SDK come superficie di riuso,
  il banco di prova del kernel copiato diciotto volte, le regole scritte due
  volte in due linguaggi, un crate per bundle di feature) e il **debito**
  riportato dal quarto audit, che ha un milestone suo.
  Le quattro domande con cui i sei giri hanno cercato le voci restano il modo di
  trovarne di nuove, e vanno fatte in quest'ordine: **cosa manca**; **cosa c'è
  con la forma sbagliata** — la famiglia che il freeze di M4 rende definitiva,
  perché una firma che manca si aggiunge e una firma sbagliata si migra; **cosa
  c'è e non mantiene**, cioè una promessa vera a metà e in silenzio (la
  [decisione 0004](decisions/0004-il-grafo-e-i-link-non-wiki.md), i link markdown
  fuori dal grafo, e poi il canale dati della
  [0019](decisions/0019-il-canale-dati.md)); e, dal **sesto giro**, **quante volte è
  scritto e da cosa cresce quel numero** — il moltiplicatore invece della
  migrazione, che non si paga aggiungendo la voce ma a ogni voce successiva: le
  regole del contratto chiuse in `mod` privati del kernel e le stesse regole
  duplicate in TypeScript senza il presidio che hanno i tipi (§6.1 e §6.2,
  chiusi con la [decisione 0020](decisions/0020-le-regole-in-un-posto-solo.md)),
  l'`HostApi` scritta quattro volte a mano (§7.1, chiusa con la
  [decisione 0021](decisions/0021-il-confine.md)), i dati persistiti senza mappa
  né classe di durabilità (§15.4) e il banco di prova copiato diciotto volte
  (§16.2).
  Dal **settimo giro**, una quinta domanda: **cosa fallisce senza produrre nessun
  segnale** — né per un test, né per un log, né per l'utente, finché il danno non
  è già fatto. Ha aperto una seduta sua (la 20) e ha una proprietà che le altre
  non hanno: quasi nulla di ciò che trova **scade col freeze**, quindi nessun
  criterio di scadenza l'avrebbe mai portata in cima, mentre il suo costo si sta
  pagando adesso. L'unica firma è l'alimentazione degli indici (§20.1); il resto
  è un canale che il kernel scarta (§20.3), una superficie che la shell non ha
  (§20.4) e una variante di evento già decisa a verbale e rimandata per mancanza
  di clienti (§20.2) — clienti che ci sono, e sono ventisei messaggi già
  scritti che nessun essere umano può leggere.
  In fondo al documento stanno le voci a **leva più alta** — la leva non è la
  scadenza — e la **tabella di corrispondenza** fra la numerazione vecchia e
  questa, che è l'unico posto del repo dove i vecchi `§X.Y` restano validi.
- [decisions/](decisions/README.md) — **i verbali delle decisioni chiuse**, un
  file per decisione (`NNNN-<slug>.md`) più l'indice; venticinque a oggi. Sono
  la parte di questo repo che fra sei mesi non si ricostruisce dal diff — il
  *perché*, non il *cosa* — e finché stavano dentro `todo.md` erano archiviati
  nel posto in cui si va a cercare *cosa resta da fare*, dove non li rilegge
  nessuno; è la [decisione 0014](decisions/0014-i-verbali-fuori-da-todo.md), che
  porta con sé anche il **check dei link interni** in CI
  (`scripts/check-doc-links.mjs`), perché spostare i file crea una promessa
  nuova ogni volta e una promessa senza presidio meccanico decade.
- `ORGANIZZAZIONE_VAULT.md` — **cancellato con la [decisione 0003](decisions/0003-modello-del-documento.md)** (commit `0a4ee40`), e
  questa riga ha continuato a linkarlo insieme a quella di M2 qui sotto: è il
  sintomo con cui la [decisione 0014](decisions/0014-i-verbali-fuori-da-todo.md) apre, e il tipo di cosa che un check dei link in CI
  vede subito. La feature invece c'è ed è spedita (sidebar ad albero, icone,
  folder notes, spazi, appuntate, ordinamento drag & drop, cartella come radice,
  sidecar `.fubmd/workspace.json`); il suo design vive nel codice
  (`frontend/src/rules/organizer.ts`, `panels/explorer.ts`) e il debito che si porta dietro è il
  §11.3 (il sidecar da assorbire nello store di configurazione). Il testo si
  recupera da git (`git show 0a4ee40^:docs/ORGANIZZAZIONE_VAULT.md`), quindi la
  scelta è fra riscriverlo e togliere la voce — non fra tenerlo e perderlo.

**Appendici**:
- [appendix/ai-autocomplete.md](appendix/ai-autocomplete.md) — design (non milestone) dell'autocompletamento AI.
- [appendix/funzionalita-future.md](appendix/funzionalita-future.md) — funzionalità post-M5 (app mobile, sync, flashcard, export editoriale…) raccolte dalle interviste alle personas (`docs/personas/`); include il principio della **spegnibilità totale**.
- [appendix/platforms-ci.md](appendix/platforms-ci.md) — matrice OS e CI multi-piattaforma.

## Roadmap (sintesi)

- **M1 — App usabile ✅ (2026-07-24)**
  Core agnostico + `FormatProvider` + provider markdown + editor/vault + feature
  native (anteprima, wikilink, backlink) + file watcher. 33 test verdi, niente WASM.
- **M2 — Ricerca + graph + rifiniture** (in corso) → [dettaglio](milestones/M2-search-graph.md)
  Fatti: grafo incrementale con full-rebuild come oracolo; full-text (tantivy)
  via `IndexProvider`, persistente e incrementale, con ricerca nel frontend;
  CRUD completo dall'app — creazione (incluso il flusso "crea nota" da link non
  risolto), rename, cestino — e versioning del vault (le decisioni D1–D8 sono
  nella tabella qui sopra); organizzazione della sidebar stile
  make.md — albero, icone, folder notes, spazi (il documento di dettaglio non
  esiste più: vedi la mappa qui sopra); backlink, **outline** e
  **tag** sono ora `ViewProvider` veri, con le capacità host che mancavano
  (`query_index` — col canale metadata `IndexQuery::Outline`/`Tags` —,
  `active_context`: pannello, documento, **selezione** e modalità) e il giro
  azione→`ViewUpdate` chiuso (`Navigate`, `Reveal`, `RunSearch`). Il quarto
  provider, le **statistiche**, è il primo cliente della selezione. Con la [decisione 0009](decisions/0009-registro-dei-comandi.md) +
  [decisione 0010](decisions/0010-comando-descritto-a-una-macchina.md) è vivo anche il **registro dei comandi** — spec con argomenti, prosa e
  raggio dichiarati, invocazione che può **simulare** senza scrivere, palette
  nella shell — e con esso l'anticipo della command palette che stava a M3.
  Con la [decisione 0011](decisions/0011-il-lotto.md) + [decisione 0012](decisions/0012-origine-degli-eventi.md) il kernel sa dire che N scritture sono **una cosa sola**
  (`Workspace::batch`, `Event::BatchEnded`: una rinomina con 200 backlink è un
  ridisegno invece di 201) e ogni evento porta **chi lo ha chiesto**
  (`Origin { actor, batch }`), che è ciò su cui un'automazione riconosce le
  proprie scritture invece di richiamarsi da sola.
  Con la [decisione 0013](decisions/0013-elenco-delle-capacita.md) l'elenco delle **capacità** è chiuso, e le azioni strutturali della
  shell — crea, rinomina, cestina, ripristina, svuota — sono diventate comandi
  serviti da quelle capacità: **sei comandi Tauri in meno**, ed è quella
  sparizione a rendere vera la regola «una feature nuova non aggiunge un comando
  Tauri» anche per le feature che toccano il vault.
  Fatti anche i due che restavano: la **cache sdoppiata** metadata/body
  (`DocMeta` tiene identità, frontmatter, outline e link; il corpo si riparsa dal
  disco su richiesta) e la **graph view** su Canvas. Resta il §5 del quarto
  audit, che ha un milestone suo.
  Con la [decisione 0025](decisions/0025-la-ricerca-predefinita.md) la ricerca
  che M2 ha spedito è dichiarata **la** ricerca dell'app — built-in e di classe
  *omnisearch* — e quella dichiarazione apre la
  [seduta 21](roadmap/21-la-ricerca-predefinita.md): la parte che scade col
  freeze sono tre voci di firma (la tolleranza ai refusi che non è dicibile, il
  prefisso mentre si digita, gli estratti senza coordinate nel documento), il
  resto è superficie e misura.
- **M3 — Fedeltà editor** → [dettaglio](milestones/M3-editor-fidelity.md)
  Live preview in-editor (decorazioni CodeMirror sugli `Span`), settings
  dichiarativi, rendering callout/embed/math. La command palette
  (`CommandProvider`) è **anticipata a M2** con la [decisione 0009](decisions/0009-registro-dei-comandi.md).
- **M4 — Hardening del contratto + WIT** → [dettaglio](milestones/M4-wit-hardening.md)
  Freeze della superficie dei trait; `wit/fubmd/*.wit` (già vivo da M2) rispecchia
  `fubmd-abi`; test di conformità; primo plugin nativo via `Plugin`/`HostApi`.
  La **checklist del freeze** vive lì e rimanda alle voci marcate **P0** in
  [todo.md](todo.md), che è l'elenco autorevole: sul documento di milestone
  restano le sole decisioni con una domanda ancora aperta e una risposta da
  mettere a verbale.
- **M5 — Runtime WASM per plugin di terzi** → [dettaglio](milestones/M5-wasm-runtime.md)
  `fubmd-wasm-host` (wasmtime, component model); proxy per ogni trait; host
  function per `HostApi`; plugin di esempio in `wasm32-wasip2`.
- **Futuro** — autocompletamento AI come plugin core → [appendice](appendix/ai-autocomplete.md);
  centro di comando LLM ([FEATURES](FEATURES.md) 22.4), che è la stessa famiglia
  ma con la scrittura: feature di Fase 4, con il contratto già chiuso
  ([decisione 0009](decisions/0009-registro-dei-comandi.md) + [decisione 0010](decisions/0010-comando-descritto-a-una-macchina.md)) — un centro di comando è un chiamante del
  registro, non una superficie in più;
  candidati post-M5 dalle interviste utente (mobile, sync, flashcard, export…) →
  [appendice](appendix/funzionalita-future.md). Principio per tutto ciò che è oltre
  il core: **spegnibilità totale** — feature disattivata = feature che non esiste
  nell'app (l'architettura a plugin/registry lo garantisce per costruzione).

## Verifica (M1)

- Automatica: `cargo test --workspace` (parser markdown, grafo agnostico, e2e sul
  vault di esempio: risoluzione wikilink nome/alias/path, backlink, anteprima,
  modifica→aggiornamento grafo) + `cargo clippy`.
- Manuale: `cargo tauri dev` (da `crates/fubmd-app`) oppure il binario release con
  `FUBMD_VAULT` puntato a un vault; aprire note, editare, navigare `[[wikilink]]`,
  vedere i backlink.

I criteri di accettazione e i piani di test di M2–M5 vivono nei rispettivi
documenti milestone.

## Rischi / punti difficili (trasversali)

- **Mantenere il core agnostico** — presidiato dall'invariante di dipendenze.
- **Confine WASM (M5)** — de-rischiato dalla regola d'oro, resa *verificabile* dal
  `wit/` vivente introdotto a M2, dal confronto sui **tipi** (non solo sui nomi) e
  dalle conversioni del confine già scritte e testate in `fubmd_abi::arena`: il
  proxy di M5 le chiamerà, non le inventerà (vedi
  [traits.md](architecture/traits.md)).
- **Live-preview in-editor (M3)** — de-rischiato tenendo un'anteprima HTML dalla
  M1; gli `Span` nel modello rendono M3 meccanico. Da [decisione 0007](decisions/0007-contesto-di-sessione.md) quell'anteprima non è
  più un pannello sempre acceso di fianco all'editor ma **la modalità Lettura**
  (`PaneMode::Reading`): le modalità sono esclusive, e due superfici sullo stesso
  documento erano due verità da tenere allineate.
- **Edge case markdown Obsidian** — corpus di fixture + snapshot test.
- **Rientranza del dispatch eventi** — risolto per costruzione: coda + budget nel
  `Workspace`; l'esaurimento del budget emette `Event::Overflow` (mai troncamenti
  silenziosi) — vedi [traits.md](architecture/traits.md), "Dispatch".
- **«Perdite silenziose non esistono per contratto» vale su un canale solo** —
  l'invariante è scritta ([traits.md](architecture/traits.md), `Overflow`) ed è
  vera della coda eventi. Sugli altri canali la perdita è **indicibile**
  (`IndexProvider::on_document_*` restituisce `()`, e il provider di ricerca ha
  già in repo il caso in cui sa di aver perso un documento e non può dirlo),
  **scartata** (`let _ = handler.handle(…)`: uno snapshot del versioning che non
  si scrive lascia il pannello cronologia identico a quando funzionava) o
  **detta a nessuno** (14 `eprintln!` su `stderr` e 12 `console.warn` nella
  console della webview, che l'app stessa dichiara di non poter aprire quando è
  impacchettata). Mitigazione in [todo.md](todo.md), seduta 20 — con l'unica
  metà che scade col freeze, l'esito sull'alimentazione degli indici (§20.1),
  che la [decisione 0019](decisions/0019-il-canale-dati.md) ha già esteso a tutto
  il canale dati.
- **Plugin lenti nel giro sincrono** — risolto per contratto: il lavoro lungo
  passa dai **job** (`spawn_job`/`run_job`/`JobDone`), eseguiti fuori dal lock
  del workspace e con l'`HostApi` in mano
  ([0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md)); il giro sincrono
  resta breve per definizione (vedi
  [plugin-boundary.md](architecture/plugin-boundary.md), "Lavoro lungo: i job").
- **Buffer editor vs disco** — politica decisa (flush al cambio documento,
  reload del buffer pulito, buffer sporco mai sovrascritto); il merge esplicito
  dei conflitti è lavoro M3 (vedi [data-model.md](architecture/data-model.md)).
- **Memoria su vault grandi** — oggi il `Workspace` tiene i `DocumentModel`
  completi (albero + testo) di tutto il vault; a M2, insieme all'indice, la cache
  va sdoppiata: metadata (link/tag/outline, globale) vs body parsato (solo
  documenti aperti) — vedi [M2](milestones/M2-search-graph.md).
- **Concorrenza** — tutto il `Workspace` è `&mut` dietro un `Mutex` nell'app: un
  reindex blocca le query. Accettato per ora; se morde, split lettura/scrittura
  a M2/M3 (misura prima di agire).
- **Il canale dati era servito dal kernel, non instradato** — **risolto** con la
  [decisione 0019](decisions/0019-il-canale-dati.md). `query_index` rispondeva da
  sé a **sette varianti su nove** e ritornava prima del ciclo sui provider:
  grafo, proprietà, outline, tag e salute del vault erano kernel-owned e non
  scavalcabili, quindi ogni famiglia che volesse estenderli (7.3, 8.2, 7.2, 10,
  15.1) aveva una strada sola, `IndexQuery::Custom`. Era la forma del «parser
  sostituibile e non estendibile» applicata al canale dati, ed è stata la seconda
  promessa che valeva a metà **in silenzio** dopo i link markdown fuori dal
  grafo. Adesso le risposte del kernel sono un `IndexProvider` registrato per
  primo, chi serve cosa è dichiarato alla registrazione, e la query è un albero
  del contratto invece di una stringa nella sintassi di una dipendenza. La metà
  della scomposizione del `Workspace` che quella voce doveva accompagnare è
  arrivata con la [decisione 0022](decisions/0022-il-kernel-a-pezzi.md).
- **Il costo di una capacità non è la firma, è il numero di host** —
  **mitigato**, con la [decisione 0021](decisions/0021-il-confine.md). `HostApi`
  aveva ventiquattro metodi e **quattro** implementazioni scritte a mano
  (`KernelHost`, `ReadHost`, `ReadOnlyHost`, `MemoryHost`); a M5 cinque, e i
  permessi volevano politiche combinatorie, cioè N. Era un moltiplicatore,
  quindi invisibile finché il fattore è basso: non lo si pagava aggiungendo una
  capacità, lo si pagava a ogni host successivo. Adesso il rifiuto è un
  **wrapper generico** (`Guard<H, P: Policy>`) e una politica nuova costa dieci
  righe; e `HostApi` è la **somma di dieci famiglie**, in Rust e nel WIT, così
  che «sola lettura» sia un tipo che non ha le capacità di scrittura invece di
  un tipo che ne rifiuta dodici. La domanda P0 pre-freeze era se spezzarla,
  perché spostare una funzione fra interface WIT vale come rottura: si è fatto,
  ritagliando la linea di base.
- **Le stesse regole scritte due volte** — **mitigato**, con la
  [decisione 0020](decisions/0020-le-regole-in-un-posto-solo.md). Sei regole
  vivevano già in Rust e in TypeScript (nome pagina di un `DocId`, spunta di un
  task, risoluzione case-insensitive, offset byte↔code unit, grammatica di
  wikilink e tag, collazione) e **una** aveva un test che le legava, scritto a
  mano. Adesso le regole del contratto stanno in `fubmd_abi::rules` — raggiungibili
  da chi implementa un indice, che è la metà §6.1 — e ciò che resta scritto due
  volte è legato da una fixture generata (`rules_mirror.rs` →
  `rules-samples.json` → `rules-mirror.test.ts`), nei due versi. Due delle sei
  non ci sono per ragioni dichiarate: la grammatica di wikilink e tag è la scelta
  del §4.4 (decorare mentre si digita), la collazione è **due requisiti che
  devono divergere**. Resta la fine corsa: `fubmd-abi` compilato a
  `wasm32-unknown-unknown`, che toglierebbe la duplicazione invece di
  presidiarla — praticabile solo perché l'invariante del crate è stata tenuta, e
  non urgente proprio perché il presidio c'è.
- **Il freeze arriva prima delle firme che FEATURES richiede** — è il rischio che
  le voci **P0** di [todo.md](todo.md) esistono per chiudere: una capacità che
  manca al contratto è una famiglia di voci che *non potrà mai* essere un plugin,
  e dopo M4 si aggiunge solo per minor (o non si aggiunge). Mitigazione: è la
  marcatura stessa a dirlo — è P0 tutto ciò che ha una **forma di contratto**,
  qualunque capitolo lo ospiti — e le decisioni con una domanda aperta sono nella
  checklist di [M4](milestones/M4-wit-hardening.md). Il dogfooding resta lo strumento che le
  scopre — è così che sono arrivati `data_*`, `now_unix_millis`, `query_index`,
  `free_name` e `active_context`, ognuno da una feature ufficiale scritta come la
  scriverebbe un plugin.
