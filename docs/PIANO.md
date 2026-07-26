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
| Verità del documento | **La sorgente sul disco**; `serialize` = generazione, mai round-trip | Il modello è lossy per costruzione; riscrivere un file da esso distruggerebbe la formattazione dell'utente. Modifiche programmatiche = patch via `Span`, e dal §1.16 sono una primitiva del contratto (`apply_edit`) che porta la revisione su cui è stata calcolata. |
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
| Lotto ed origine ([todo.md](todo.md) §1.12 + §1.18) | **Un lotto è uno scope del kernel, non una transazione, e non lo apre un plugin**; un handler riceve `Notice { event, origin }` | Il lotto coalizza il solo `index-updated` — l'unico evento senza payload, quindi l'unico di cui N copie dicono quanto ne dice una — e chiude con `BatchEnded { batch, changed }`: una rinomina con 200 backlink passa da 201 ridisegni completi a 1, senza che gli eventi per-documento perdano un colpo. Non annulla niente e non si chiama come se lo facesse: il tutto-o-niente vuole il journal del §2.5, e un annullamento che non sopravvive alla morte del processo non è un annullamento. Non lo apre un plugin perché uno scope a chiusura garantita non attraversa il confine dei componenti: il lotto di un plugin è la sua invocazione di comando. `Origin.actor` è **chi ha chiesto**, non chi ha eseguito — è l'unica lettura per cui esiste («questa l'ho scritta io?»), e senza di essa l'automazione su-modifica di 16.2 si richiama da sola finché il budget non tronca. |
| Capacità dell'`HostApi` ([todo.md](todo.md) §1.4) | **L'elenco è chiuso**: ventidue metodi, con le operazioni strutturali dentro e `storage_*` fuori | Dopo il freeze una capacità che manca è una feature che **non potrà mai essere un plugin**, quindi ogni voce è stata decisa a verbale — comprese quelle che non entrano, o «non ci avevamo pensato» diventerebbe indistinguibile da «è stata una scelta». Dentro: creare (che **rifiuta** un path occupato — è l'unica differenza con `write_document`, e senza di essa un template che sbaglia la data cancella una nota), rinominare (quella del kernel, che **riscrive i backlink**: non ce n'è una nuda, perché due semantiche sotto un nome sono una trappola), il giro del cestino, e `run_command`, che eredita modo, attore e lotto invece di prenderli come argomenti — una simulazione non diventa reale invocando qualcuno, e una macro di tre comandi resta una cosa sola. Fuori, con la ragione: allegati (§2.2), rete (§1.21 + §2.10), tempo differito (§2.4), cartelle (§2.11), e `notify`/`progress`/`log`, che informano senza aspettare risposta — cioè la definizione di un **evento**, non di una capacità. `storage_*` volatile è stato **tolto**: con `data_*` e le impostazioni non aveva più casi d'uso, e toglierlo dopo il freeze sarebbe stata una major. |
| Sicurezza UI | **`Html`/`WebView` riservati al codice fidato**, con un **punto di enforcement unico**: `Workspace::render_view`/`view_action`, dove ogni provider ha dichiarato il proprio `Trust` | Contenuto attivo nella webview privilegiata scavalcherebbe la sandbox WASM via UI. La regola era scritta e non applicata (`validate_untrusted` non aveva chiamanti): il varco esiste ora, con i suoi test, perché aggiungerlo al primo provider non fidato vorrebbe dire cercarlo fra N chiamanti. Vale anche per l'albero che torna da un'azione, non solo dal rendering. |
| AI autocomplete | **Rimandata**, futuro plugin core (locale + cloud) | Non blocca l'architettura; è un `CommandProvider`/`EventHandler`. |
| AI che *agisce* (centro di comando LLM, [FEATURES](FEATURES.md) 22.4) | **Rimandata come feature; il contratto è chiuso** ([todo.md](todo.md) §1.1 + §1.36) | Un'AI che modifica N note o le impostazioni non è un provider in più: è il primo **chiamante non umano** del registro comandi — e i primi ad arrivare sono la CLI (27.1) e le automazioni (16.2). Un comando dichiara ora argomenti (`ParamSpec`), prosa (`description`) e raggio (`CommandScope`), e si invoca **senza applicare** (`InvokeMode::DryRun` → `CommandPlan`: i `DocId` impattati e un `EditRequest` per documento). Il consenso non è una capacità dell'host ma il giro *dry-run → piano → approvazione → apply*: un host chiamato *dalla* shell non può fermarsi a chiedere, e un piano si legge mentre «sei sicuro?» no. Ciò che l'host fa rispettare è il resto: argomenti convalidati contro la spec, e un `HostApi` in sola lettura a chi simula o si è dichiarato tale. |
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
  └─ fubmd-wasm-host   (M5) host wasmtime per plugin di terzi
frontend/              Vite + TS + CodeMirror 6 (+ renderer UiNode)
wit/                   contratto WIT che rispecchia fubmd-abi (vivo da M2, freeze M4)
plugins/               (M5) plugin di esempio (wasm32-wasip2)
```

Il meccanismo "un trait, due backend": il trait vive in `fubmd-abi`;
`fubmd-format-markdown` lo implementa nativo; `fubmd-wasm-host` lo implementerà
come proxy. Il kernel vede solo `dyn Trait`.

## Mappa dei documenti

**Architettura** (trasversale ai milestone):
- [architecture/data-model.md](architecture/data-model.md) — `DocumentModel`, `Block`/`Inline`, `Span`, `LinkTarget`, escape hatch `Custom`.
- [architecture/traits.md](architecture/traits.md) — i 7 trait del contratto, chi li implementa e a quale milestone, la tabella di esprimibilità WIT.
- [architecture/ui-protocol.md](architecture/ui-protocol.md) — protocollo `UiNode`, mapping sul frontend, regola dell'escape hatch web-view.
- [architecture/plugin-boundary.md](architecture/plugin-boundary.md) — `Plugin`/`HostApi`/`PluginManifest`, modello capability ibrido, sandbox WASM.

**Milestone**:
- [milestones/M2-search-graph.md](milestones/M2-search-graph.md) — ricerca (tantivy), grafo/indice incrementali, graph view, outline/tag panel, "crea nota".
- [milestones/M3-editor-fidelity.md](milestones/M3-editor-fidelity.md) — live-preview in-editor, command palette, settings dichiarativi, rendering callout/embed/math.
- [milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md) — freeze del contratto, WIT, conformità abi↔WIT, primo plugin nativo.
- [milestones/M5-wasm-runtime.md](milestones/M5-wasm-runtime.md) — `fubmd-wasm-host`, proxy WASM, applicazione delle capability, plugin di esempio.

**Piani di lavoro**:
- [todo.md](todo.md) — **roadmap infrastrutturale**: quali pezzi mancano perché
  la massa di [FEATURES.md](FEATURES.md) sia implementabile *come provider*
  invece che come codice dell'app — e, dal secondo giro, quali pezzi **esistono
  con la forma sbagliata**, che è la famiglia che il freeze di M4 rende
  definitiva (una firma che manca si aggiunge, una firma sbagliata si migra).
  §1 le decisioni di contratto da prendere prima del freeze: comandi vivi,
  `UiNode` con input, capacità dell'`HostApi`, task/ancore nel modello,
  `IndexQuery`, import/export, stringhe — più il contesto di una view con la
  **selezione** (§1.9), l'identità del documento (§1.10), gli errori tipizzati
  al confine (§1.11), la scrittura **a lotti** (§1.12 — chiuso, insieme
  all'origine degli eventi del §1.18), l'elenco delle **capacità** (§1.4 —
  chiuso: è la superficie più esposta del contratto, e dopo il freeze una
  capacità mancante non si aggiunge senza una minor né si toglie senza una
  major) e il canale del rendering (§1.13). §2 il kernel: storage astratto, allegati, registry + runner dei job,
  concorrenza, durabilità, politiche path/testo, sessioni — più una disciplina
  dei provider sola invece di una per famiglia (§2.8), la disattivazione
  (§2.9), il punto di applicazione dei permessi (§2.10), le cartelle (§2.11),
  le versioni di schema dei formati persistiti (§2.12), il canale della lista
  documenti (§2.13) e il sidecar dell'organizzazione da assorbire (§2.14) —
  più, dal capitolo 22.4 di FEATURES, il comando descritto a una **macchina**
  (§1.36: schema dei parametri, dry-run, consenso — chiuso col §1.1).
  §3 la shell, più i due parser per la stessa sintassi (§3.8); §4 presidi e
  tooling, più l'SDK come superficie di riuso (§4.6) e un crate per bundle di
  feature (§4.7); §5 il debito riportato dai quattro giri di audit, i cui piani
  di aggiustamento sono chiusi; §6 l'ordine consigliato (P0 = tutto il §1).
- [ORGANIZZAZIONE_VAULT.md](ORGANIZZAZIONE_VAULT.md) — organizzazione stile
  make.md nell'app base: sidebar ad albero, icone, folder notes, spazi
  (appuntate, ordinamento drag & drop, cartella come radice), sidecar
  `.fubmd/workspace.json`.

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
  make.md — albero, icone, folder notes, spazi
  ([ORGANIZZAZIONE_VAULT.md](ORGANIZZAZIONE_VAULT.md)); backlink, **outline** e
  **tag** sono ora `ViewProvider` veri, con le capacità host che mancavano
  (`query_index` — col canale metadata `IndexQuery::Outline`/`Tags` —,
  `active_context`: pannello, documento, **selezione** e modalità) e il giro
  azione→`ViewUpdate` chiuso (`Navigate`, `Reveal`, `RunSearch`). Il quarto
  provider, le **statistiche**, è il primo cliente della selezione. Col §1.1 +
  §1.36 è vivo anche il **registro dei comandi** — spec con argomenti, prosa e
  raggio dichiarati, invocazione che può **simulare** senza scrivere, palette
  nella shell — e con esso l'anticipo della command palette che stava a M3.
  Col §1.12 + §1.18 il kernel sa dire che N scritture sono **una cosa sola**
  (`Workspace::batch`, `Event::BatchEnded`: una rinomina con 200 backlink è un
  ridisegno invece di 201) e ogni evento porta **chi lo ha chiesto**
  (`Origin { actor, batch }`), che è ciò su cui un'automazione riconosce le
  proprie scritture invece di richiamarsi da sola.
  Col §1.4 l'elenco delle **capacità** è chiuso, e le azioni strutturali della
  shell — crea, rinomina, cestina, ripristina, svuota — sono diventate comandi
  serviti da quelle capacità: **sei comandi Tauri in meno**, ed è quella
  sparizione a rendere vera la regola «una feature nuova non aggiunge un comando
  Tauri» anche per le feature che toccano il vault.
  Restano: cache metadata/body, graph view (Canvas/WebGL).
- **M3 — Fedeltà editor** → [dettaglio](milestones/M3-editor-fidelity.md)
  Live preview in-editor (decorazioni CodeMirror sugli `Span`), settings
  dichiarativi, rendering callout/embed/math. La command palette
  (`CommandProvider`) è **anticipata a M2** col §1.1.
- **M4 — Hardening del contratto + WIT** → [dettaglio](milestones/M4-wit-hardening.md)
  Freeze della superficie dei trait; `wit/fubmd/*.wit` (già vivo da M2) rispecchia
  `fubmd-abi`; test di conformità; primo plugin nativo via `Plugin`/`HostApi`.
  La **checklist del freeze** vive lì e rimanda al §1 di [todo.md](todo.md), che
  è l'elenco autorevole: sul documento di milestone restano le sole decisioni con
  una domanda ancora aperta e una risposta da mettere a verbale.
- **M5 — Runtime WASM per plugin di terzi** → [dettaglio](milestones/M5-wasm-runtime.md)
  `fubmd-wasm-host` (wasmtime, component model); proxy per ogni trait; host
  function per `HostApi`; plugin di esempio in `wasm32-wasip2`.
- **Futuro** — autocompletamento AI come plugin core → [appendice](appendix/ai-autocomplete.md);
  centro di comando LLM ([FEATURES](FEATURES.md) 22.4), che è la stessa famiglia
  ma con la scrittura: feature di Fase 4, con il contratto già chiuso
  ([todo.md](todo.md) §1.1 + §1.36) — un centro di comando è un chiamante del
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
  M1; gli `Span` nel modello rendono M3 meccanico. Da §1.9 quell'anteprima non è
  più un pannello sempre acceso di fianco all'editor ma **la modalità Lettura**
  (`PaneMode::Reading`): le modalità sono esclusive, e due superfici sullo stesso
  documento erano due verità da tenere allineate.
- **Edge case markdown Obsidian** — corpus di fixture + snapshot test.
- **Rientranza del dispatch eventi** — risolto per costruzione: coda + budget nel
  `Workspace`; l'esaurimento del budget emette `Event::Overflow` (mai troncamenti
  silenziosi) — vedi [traits.md](architecture/traits.md), "Dispatch".
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
- **Il freeze arriva prima delle firme che FEATURES richiede** — è il rischio che
  [todo.md](todo.md) §1 esiste per chiudere: una capacità che manca al contratto
  è una famiglia di voci che *non potrà mai* essere un plugin, e dopo M4 si
  aggiunge solo per minor (o non si aggiunge). Mitigazione: il §1 per intero è
  P0, e le decisioni con una domanda aperta sono nella checklist di
  [M4](milestones/M4-wit-hardening.md). Il dogfooding resta lo strumento che le
  scopre — è così che sono arrivati `data_*`, `now_unix_millis`, `query_index`,
  `free_name` e `active_context`, ognuno da una feature ufficiale scritta come la
  scriverebbe un plugin.
