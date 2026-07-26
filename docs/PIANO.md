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
| Spegnibilità | **Il versioning si spegne del tutto** (D7) | Principio non negoziabile ([funzionalita-future.md](appendix/funzionalita-future.md)): spento = l'handler non si registra, la UI non esiste, nel vault non compare nulla. |
| Case dei path | `DocId` **byte-exact**, risoluzione wikilink **case-insensitive**, rename case-only supportato | Stessa semantica osservabile su FS case-sensitive (Linux) e case-insensitive (macOS/Windows) — vedi [data-model.md](architecture/data-model.md). |
| Lavoro lungo dei plugin | **Job fuori dal giro sincrono**: `HostApi::spawn_job` → `Plugin::run_job` (senza `HostApi`) → `Event::JobDone` | I trait restano sincroni e **brevi**; rete e calcolo pesante non bloccano mai il kernel; a M5 la deadline tronca solo chi sfora nel giro sincrono — vedi [plugin-boundary.md](architecture/plugin-boundary.md). |
| Transclusion (embed) | **Placeholder dal provider, composizione kernel+frontend** | `render_html` resta puro per-documento; solo il kernel conosce la topologia del vault. |
| Indici (ricerca) | **Posseduti e alimentati dal kernel**, non dagli eventi; backlink serviti dal grafo | Un indice che perde un aggiornamento non tace: risponde *sbagliato*, in silenzio. La coda eventi ha un budget e può troncare, questo canale no. E i backlink hanno già una fonte di verità — il grafo — che conosce le ambiguità dell'intero vault: duplicarli creerebbe una seconda verità divergente. Vedi [M2](milestones/M2-search-graph.md). |
| Persistenza di un indice | **`HostApi` per-chiamata in `activate` e `flush`**, non altrove; registrazione = attivazione, con un id che assegna lo spazio dati | Senza host in nessuna firma, un index provider di terzi in WASM non potrebbe persistere *nulla* — lo stesso buco che il versioning ha fatto emergere per `EventHandler`, e l'unica voce del debito che toccava una **firma da congelare**. L'host arriva nei due punti in cui lo stato attraversa il disco: `activate` per ritrovarlo, `flush` per scriverlo. Non su `on_document_*` (mutazioni in memoria: costringerebbe il kernel a duplicare il modello a ogni salvataggio) né su `query` (che il kernel serve sotto prestito *condiviso*). Per-chiamata e non un handle: il kernel presta `&mut Workspace`, che `'static` non può essere. Il manifest di `SearchIndex` passa da `data_*`; la cartella mmap di tantivy da `Workspace::plugin_data_dir`, varco nativo dichiarato — vedi [traits.md](architecture/traits.md). |
| Risultati di ricerca | **`snippet` testo puro + `highlights: Vec<Span>`** | Un provider di terzi non deve poter iniettare markup nella webview privilegiata passando per i risultati (stessa regola di `UiNode::Html`); chi disegna avvolge gli intervalli con i propri elementi. |
| Eventi | **Dispatch a coda anti-rientranza** + varco `Event::Custom` | Un handler che emette/scrive durante `handle` non rientra; i plugin comunicano via topic namespaced. Il budget anti-ping-pong tronca **rumorosamente**: `Event::Overflow { dropped }` avvisa chi deriva stato di riconciliare da zero — mai perdite silenziose. |
| Lotto ed origine ([decisione 0011](decisions/0011-il-lotto.md) + [decisione 0012](decisions/0012-origine-degli-eventi.md)) | **Un lotto è uno scope del kernel, non una transazione, e non lo apre un plugin**; un handler riceve `Notice { event, origin }` | Il lotto coalizza il solo `index-updated` — l'unico evento senza payload, quindi l'unico di cui N copie dicono quanto ne dice una — e chiude con `BatchEnded { batch, changed }`: una rinomina con 200 backlink passa da 201 ridisegni completi a 1, senza che gli eventi per-documento perdano un colpo. Non annulla niente e non si chiama come se lo facesse: il tutto-o-niente vuole il journal del §15.2, e un annullamento che non sopravvive alla morte del processo non è un annullamento. Non lo apre un plugin perché uno scope a chiusura garantita non attraversa il confine dei componenti: il lotto di un plugin è la sua invocazione di comando. `Origin.actor` è **chi ha chiesto**, non chi ha eseguito — è l'unica lettura per cui esiste («questa l'ho scritta io?»), e senza di essa l'automazione su-modifica di 16.2 si richiama da sola finché il budget non tronca. |
| Capacità dell'`HostApi` ([decisione 0013](decisions/0013-elenco-delle-capacita.md)) | **L'elenco è chiuso**: ventidue metodi, con le operazioni strutturali dentro e `storage_*` fuori | Dopo il freeze una capacità che manca è una feature che **non potrà mai essere un plugin**, quindi ogni voce è stata decisa a verbale — comprese quelle che non entrano, o «non ci avevamo pensato» diventerebbe indistinguibile da «è stata una scelta». Dentro: creare (che **rifiuta** un path occupato — è l'unica differenza con `write_document`, e senza di essa un template che sbaglia la data cancella una nota), rinominare (quella del kernel, che **riscrive i backlink**: non ce n'è una nuda, perché due semantiche sotto un nome sono una trappola), il giro del cestino, e `run_command`, che eredita modo, attore e lotto invece di prenderli come argomenti — una simulazione non diventa reale invocando qualcuno, e una macro di tre comandi resta una cosa sola. Fuori, con la ragione: allegati (§14.1), rete (§9.1 + §7.3), tempo differito (§8.3), cartelle (§14.3), e `notify`/`progress`/`log`, che informano senza aspettare risposta — cioè la definizione di un **evento**, non di una capacità. `storage_*` volatile è stato **tolto**: con `data_*` e le impostazioni non aveva più casi d'uso, e toglierlo dopo il freeze sarebbe stata una major. |
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
  ├─ fubmd-app         Tauri v2: IPC comandi/eventi, file watcher
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

Due divisioni ulteriori sono **decise nel piano e non ancora fatte**, e stanno
qui perché sono l'unico posto in cui si vedono insieme: `fubmd-host`
([todo.md](todo.md) §8.2) — sessione, registry, runner dei job, watcher dietro
un trait — con `fubmd-app` ridotto a colla Tauri, perché quel montaggio ha già
cinque clienti previsti (CLI, API locale, e2e headless, mobile, PWA) e nessuno
di loro può riusare un composition root che vive dentro un `#[tauri::command]`;
e **un crate per bundle di feature** (§16.3), perché oggi compilare il pannello
outline compila un motore di ricerca. La seconda va dopo il §16.2, o i venti
bundle di 21.2 si portano dietro venti copie del banco di prova.

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
  codice dell'app. Sei giri sulla stessa domanda hanno prodotto ottantanove
  voci; le quattordici chiuse sono uscite di lì e stanno in
  [decisions/](decisions/README.md).
  Le voci **non** sono raggruppate per strato ma per **seduta**: diciotto
  sedute più il debito del quarto audit, e una seduta è un insieme di voci che
  conviene decidere in una volta sola, perché sono la stessa domanda vista da
  lati diversi e deciderle separate significa deciderle male. Ogni seduta è un
  file in [roadmap/](roadmap/), con in testa la ragione per cui quelle voci
  stanno insieme; `todo.md` è l'**indice** — le sedute, le settantanove voci con
  strato e priorità, e gli allegati. Il piano lo diceva già, sparso in una
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
  parsato»** — il parser è sostituibile e non estendibile, e il `DocumentModel`
  non attraversa il contratto: le ~50 estensioni di 5.2, e chiunque voglia
  toccare il contenuto *strutturato* (spuntare un task, scrivere una proprietà,
  estrarre una citazione, esportare, fare chunking), oggi non possono essere un
  plugin, ed è l'unico punto in cui l'invariante «una feature ufficiale è ciò che
  scriverà un plugin» è **già falsa**; **«Il canale dati»** — `query_index`
  risponde da sé a sette varianti su nove, quindi grafo, proprietà e salute del
  vault sono kernel-owned e a 7.3, 8.2, 10 e 15.1 resta solo `IndexQuery::Custom`;
  **«Il confine: quante volte si scrive la disciplina»** — il punto di
  applicazione dei permessi, gli spazi di nomi degli id (l'unica voce che non
  riguarda ciò che scriveremo ma ciò che abbiamo già pubblicato) e una capacità
  dell'`HostApi` implementata quattro volte a mano; **«Il lavoro lungo, e come un
  componente smette»** — un job non vede il vault, quindi 17, 18, 19.4 e 22 non
  hanno un posto dove girare, e niente si disattiva; **«La forma della shell»**,
  che sta per prima perché è la precondizione che tutte le altre presuppongono e
  nessuna dichiara. Fuori da quei capitoli restano P0, e per la stessa ragione,
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
  fuori dal grafo, e poi il §5.1); e, dal **sesto giro**, **quante volte è
  scritto e da cosa cresce quel numero** — il moltiplicatore invece della
  migrazione, che non si paga aggiungendo la voce ma a ogni voce successiva: le
  regole del contratto chiuse in `mod` privati del kernel (§6.1), l'`HostApi`
  scritta quattro volte a mano (§7.1), i dati persistiti senza mappa né classe di
  durabilità (§15.4), le regole duplicate in TypeScript senza il presidio che
  hanno i tipi (§6.2) e il banco di prova copiato diciotto volte (§16.2).
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
  file per decisione (`NNNN-<slug>.md`) più l'indice; quattordici a oggi. Sono
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
  che il §5.1 estenderà a tutto il canale dati.
- **Plugin lenti nel giro sincrono** — risolto per contratto: il lavoro lungo
  passa dai **job** (`spawn_job`/`run_job`/`JobDone`), eseguiti fuori dal lock
  del workspace; il giro sincrono resta breve per definizione (vedi
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
- **Il canale dati è servito dal kernel, non instradato** — `query_index`
  risponde da sé a **sette varianti su nove** e ritorna prima del ciclo sui
  provider: grafo, proprietà, outline, tag e salute del vault sono kernel-owned
  e non scavalcabili, quindi ogni famiglia che vorrebbe estenderli (7.3, 8.2,
  7.2, 10, 15.1) ha una strada sola, `IndexQuery::Custom`. È la forma del
  «parser sostituibile e non estendibile» applicata al canale dati, ed è la
  seconda promessa che vale a metà **in silenzio** dopo i link markdown fuori
  dal grafo. Mitigazione: le risposte del kernel diventano un `IndexProvider`
  registrato come gli altri ([todo.md](todo.md) §5.1), **insieme** alla
  scomposizione del `Workspace` (§8.1) e **prima** del routing (§5.2).
- **Il costo di una capacità non è la firma, è il numero di host** — `HostApi`
  ha ventidue metodi e **quattro** implementazioni scritte a mano (`KernelHost`,
  `ReadHost`, `ReadOnlyHost`, `MemoryHost`); a M5 sono cinque, e i permessi del
  §7.3 vogliono politiche combinatorie, cioè N. È un moltiplicatore, quindi
  invisibile finché il fattore è basso: non lo si paga aggiungendo una capacità,
  lo si paga a ogni host successivo. Mitigazione in [todo.md](todo.md) §7.1 —
  il rifiuto come **wrapper generico** invece che come impl gemella, e la
  domanda (P0, pre-freeze) se `HostApi` vada spezzata in sotto-trait, perché
  spostare una funzione fra interface WIT vale come rottura.
- **Le stesse regole scritte due volte** — sei regole vivono già in Rust e in
  TypeScript (nome pagina di un `DocId`, spunta di un task, risoluzione
  case-insensitive, offset byte↔code unit, grammatica di wikilink e tag,
  collazione), e **una** ha un test che le lega. I tipi al confine hanno una
  fixture generata; le regole no. Mitigazione a due livelli
  ([todo.md](todo.md) §6.2): la fixture di conformità sul modello di
  `mirror-samples.json` adesso, `fubmd-abi` compilato a `wasm32-unknown-unknown`
  come fine corsa — praticabile solo perché l'invariante del crate è stata
  tenuta. Gemella dal lato Rust: le regole che il contratto promette stanno in
  `mod` privati del kernel e un secondo provider le rifà a occhio (§6.1).
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
