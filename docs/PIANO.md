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
| Architettura core | **Core agnostico rispetto al formato** | Il kernel non sa cos'è il markdown; sa di documenti, link, tag, heading astratti. |
| Estensibilità | **Trait di estensione definiti una volta sola** in `fubmd-abi` | Un solo contratto; impl native e (a M5) proxy WASM condividono la stessa firma. |
| Formato | **`trait FormatProvider`**, markdown = primo provider nativo | Domani org-mode/AsciiDoc sono altri provider, zero modifiche al kernel. |
| Feature ufficiali | **Impl native dei trait**, non WASM | "Veloci quanto native" perché *sono* native; nessuna tassa di serializzazione. |
| Plugin di terzi | **WASM (wasmtime), solo al confine di fiducia → Milestone 5** | Sandbox + velocità quasi nativa, senza pagarla dove non serve. |
| UI dei plugin | **Dichiarativa + escape hatch** | Il plugin descrive la UI (`UiNode`), il core la disegna; web-view isolata solo se indispensabile. |
| Vault | **Compatibile Obsidian** | `.md` + frontmatter YAML, `[[wikilink]]`, `#tag`, callout, embed. Zero lock-in. |
| Verità del documento | **La sorgente sul disco**; `serialize` = generazione, mai round-trip | Il modello è lossy per costruzione; riscrivere un file da esso distruggerebbe la formattazione dell'utente. Modifiche programmatiche = patch via `Span`. |
| Rename | **Operazione di prima classe**: `DocumentRenamed` + riscrittura chirurgica dei link | L'identità è il path: remove+add perderebbe backlink e stato per-documento. |
| Transclusion (embed) | **Placeholder dal provider, composizione kernel+frontend** | `render_html` resta puro per-documento; solo il kernel conosce la topologia del vault. |
| Eventi | **Dispatch a coda anti-rientranza** + varco `Event::Custom` | Un handler che emette/scrive durante `handle` non rientra; i plugin comunicano via topic namespaced. |
| Sicurezza UI | **`Html`/`WebView` riservati al codice fidato** (`validate_untrusted`) | Contenuto attivo nella webview privilegiata scavalcherebbe la sandbox WASM via UI. |
| AI autocomplete | **Rimandata**, futuro plugin core (locale + cloud) | Non blocca l'architettura; è un `CommandProvider`/`EventHandler`. |
| Piattaforme | Linux (primario, Arch) + Windows + macOS | Tauri le supporta; CI multi-OS da subito. |

**Invariante non negoziabile:** `fubmd-kernel` e `fubmd-abi` non dipendono da
`comrak`, `tauri` o `wasmtime`. Verificata coi test / `cargo tree`.

**Regola d'oro (dal primo giorno):** ogni argomento e ogni valore di ritorno dei
trait è un tipo di `fubmd-abi`, `Serialize + Deserialize`, esprimibile come record
WIT — niente reference con lifetime, trait object o closure nelle firme. Così
l'impl nativa è veloce e il proxy WASM (M5) è meccanico. Dettaglio e verifica in
[architecture/traits.md](architecture/traits.md).

## Struttura dei crate

```
fubmd-abi              contratto: modello documento comune + tutti i trait
  ├─ fubmd-kernel      core agnostico: vault, grafo link, registry, event bus
  ├─ fubmd-sdk         helper per scrivere provider (scan #tag / [[wikilink]])
  ├─ fubmd-format-markdown   1° FormatProvider nativo (comrak)
  ├─ fubmd-features    feature ufficiali (backlink; poi ricerca, graph)
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

**Appendici**:
- [appendix/ai-autocomplete.md](appendix/ai-autocomplete.md) — design (non milestone) dell'autocompletamento AI.
- [appendix/platforms-ci.md](appendix/platforms-ci.md) — matrice OS e CI multi-piattaforma.

## Roadmap (sintesi)

- **M1 — App usabile ✅ (2026-07-24)**
  Core agnostico + `FormatProvider` + provider markdown + editor/vault + feature
  native (anteprima, wikilink, backlink) + file watcher. 33 test verdi, niente WASM.
- **M2 — Ricerca + graph + rifiniture** → [dettaglio](milestones/M2-search-graph.md)
  Full-text (tantivy) via `IndexProvider`, grafo+indice incrementali, graph view
  (Canvas/WebGL), outline/tag panel, flusso "crea nota".
- **M3 — Fedeltà editor** → [dettaglio](milestones/M3-editor-fidelity.md)
  Live preview in-editor (decorazioni CodeMirror sugli `Span`), command palette
  (`CommandProvider`), settings dichiarativi, rendering callout/embed/math.
- **M4 — Hardening del contratto + WIT** → [dettaglio](milestones/M4-wit-hardening.md)
  Freeze della superficie dei trait; `wit/fubmd/*.wit` (già vivo da M2) rispecchia
  `fubmd-abi`; test di conformità; primo plugin nativo via `Plugin`/`HostApi`.
- **M5 — Runtime WASM per plugin di terzi** → [dettaglio](milestones/M5-wasm-runtime.md)
  `fubmd-wasm-host` (wasmtime, component model); proxy per ogni trait; host
  function per `HostApi`; plugin di esempio in `wasm32-wasip2`.
- **Futuro** — autocompletamento AI come plugin core → [appendice](appendix/ai-autocomplete.md).

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
  `wit/` vivente introdotto a M2 (vedi [traits.md](architecture/traits.md)).
- **Live-preview in-editor (M3)** — de-rischiato tenendo un pannello anteprima HTML
  in M1; gli `Span` nel modello rendono M3 meccanico.
- **Edge case markdown Obsidian** — corpus di fixture + snapshot test.
- **Rientranza del dispatch eventi** — risolto per costruzione: coda + budget nel
  `Workspace` (vedi [traits.md](architecture/traits.md), "Dispatch").
- **Memoria su vault grandi** — oggi il `Workspace` tiene i `DocumentModel`
  completi (albero + testo) di tutto il vault; a M2, insieme all'indice, la cache
  va sdoppiata: metadata (link/tag/outline, globale) vs body parsato (solo
  documenti aperti) — vedi [M2](milestones/M2-search-graph.md).
- **Concorrenza** — tutto il `Workspace` è `&mut` dietro un `Mutex` nell'app: un
  reindex blocca le query. Accettato per ora; se morde, split lettura/scrittura
  a M2/M3 (misura prima di agire).
