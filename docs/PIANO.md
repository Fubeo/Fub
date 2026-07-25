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
| Verità del documento | **La sorgente sul disco**; `serialize` = generazione, mai round-trip | Il modello è lossy per costruzione; riscrivere un file da esso distruggerebbe la formattazione dell'utente. Modifiche programmatiche = patch via `Span`. |
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
| Sicurezza UI | **`Html`/`WebView` riservati al codice fidato**, con un **punto di enforcement unico**: `Workspace::render_view`/`view_action`, dove ogni provider ha dichiarato il proprio `Trust` | Contenuto attivo nella webview privilegiata scavalcherebbe la sandbox WASM via UI. La regola era scritta e non applicata (`validate_untrusted` non aveva chiamanti): il varco esiste ora, con i suoi test, perché aggiungerlo al primo provider non fidato vorrebbe dire cercarlo fra N chiamanti. Vale anche per l'albero che torna da un'azione, non solo dal rendering. |
| AI autocomplete | **Rimandata**, futuro plugin core (locale + cloud) | Non blocca l'architettura; è un `CommandProvider`/`EventHandler`. |
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
- [todo.md](todo.md) — piano di aggiustamento dopo il secondo audit
  architetturale: conformità abi↔WIT sui tipi, `IndexProvider` dogfoodabile,
  versioning vs `Overflow`, presidi cablati. Punti 1–5 chiusi; il `ViewProvider`
  è ora esercitato dal primo provider vero (`BacklinksView`), con le due capacità
  che gli mancavano — `query_index` e `active_document` — aggiunte all'`HostApi`.
  Restano le decisioni strutturali/di forma del freeze (§1) e il debito già
  dichiarato.
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
  `active_document`) e il giro azione→`ViewUpdate` chiuso (`Navigate`, `Reveal`,
  `RunSearch`). Restano: cache metadata/body, graph view (Canvas/WebGL).
- **M3 — Fedeltà editor** → [dettaglio](milestones/M3-editor-fidelity.md)
  Live preview in-editor (decorazioni CodeMirror sugli `Span`), command palette
  (`CommandProvider`), settings dichiarativi, rendering callout/embed/math.
- **M4 — Hardening del contratto + WIT** → [dettaglio](milestones/M4-wit-hardening.md)
  Freeze della superficie dei trait; `wit/fubmd/*.wit` (già vivo da M2) rispecchia
  `fubmd-abi`; test di conformità; primo plugin nativo via `Plugin`/`HostApi`.
- **M5 — Runtime WASM per plugin di terzi** → [dettaglio](milestones/M5-wasm-runtime.md)
  `fubmd-wasm-host` (wasmtime, component model); proxy per ogni trait; host
  function per `HostApi`; plugin di esempio in `wasm32-wasip2`.
- **Futuro** — autocompletamento AI come plugin core → [appendice](appendix/ai-autocomplete.md);
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
- **Live-preview in-editor (M3)** — de-rischiato tenendo un pannello anteprima HTML
  in M1; gli `Span` nel modello rendono M3 meccanico.
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
