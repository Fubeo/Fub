# Fub — Piano di creazione

Documento di piano e architettura. È l'**indice**: contesto, decisioni,
invarianti, struttura dei crate, e i rimandi ai documenti di dettaglio.

## Contesto

- Obiettivo: un'app di note markdown **in Rust**, su vault di file locali
  compatibili con quelli di Obsidian, da usare davvero (non un prototipo).
- Requisito distintivo: un **sistema di plugin** in cui i plugin siano veloci
  quanto le feature native.
- Conseguenza: molte feature native *sono* plugin, nel senso che implementano
  gli stessi trait — non che girano in sandbox WASM.

## Decisioni (con il perché)

| Tema | Decisione | Perché |
|---|---|---|
| Shell/UI | **Tauri v2** (core Rust + webview) | Fedeltà a Obsidian, editor maturi (CodeMirror 6). |
| Architettura core | **Core agnostico rispetto al formato** | Il kernel conosce documenti, link, tag e heading astratti, non il markdown. L'agnosticismo è **sintattico**: la semantica dei link (risoluzione Obsidian, alias) è vocabolario del kernel e ogni provider vi si mappa — [data-model.md](architecture/data-model.md). |
| Estensibilità | **Trait definiti una volta sola** in `fub-abi` | Un solo contratto: impl native e proxy WASM (M5) condividono la firma. |
| Formato | **`trait FormatProvider`**, markdown = primo provider | Domani org-mode o AsciiDoc sono altri provider, zero modifiche al kernel. |
| Feature ufficiali | **Impl native dei trait**, non WASM | Veloci quanto native perché *sono* native: nessuna serializzazione. |
| Plugin di terzi | **WASM (wasmtime), solo al confine di fiducia → M5** | Sandbox e velocità quasi nativa, senza pagarla dove non serve. |
| UI dei plugin | **Dichiarativa + escape hatch** | Il plugin descrive la UI (`UiNode`), il core la disegna. Le superfici canvas (graph view) restano del core finché la `WebView` per plugin non ha asset story e CSP (M5). |
| Vault | **Compatibile Obsidian** | `.md` + frontmatter YAML, `[[wikilink]]`, `#tag`, callout, embed. Zero lock-in. |
| Verità del documento | **La sorgente sul disco**; `serialize` = generazione, mai round-trip | Il modello è lossy per costruzione. Le modifiche programmatiche sono patch via `Span`: dalla [0008](decisions/0008-modifica-chirurgica.md) è la primitiva `apply_edit`, che porta la revisione su cui è stata calcolata. |
| Verità del documento **aperto** | **Il buffer dell'editor finché è sporco** | Il disco vale per i documenti chiusi. L'app flusha prima di cambiare documento, riallinea il buffer pulito sui cambi esterni e non lo sovrascrive mai da sporco (merge esplicito a M3) — [data-model.md](architecture/data-model.md), «Le tre copie». |
| Rename | **Operazione di prima classe**: `DocumentRenamed` + riscrittura chirurgica dei link | L'identità è il path: remove+add perderebbe backlink e stato per-documento. |
| Delete | **Cestino `.trash/` dentro il vault** (D1/D2) | È la cartella di Obsidian: un vault condiviso ha un solo cestino. Cancellare è spostare; sulle collisioni il nome prende l'istante della cancellazione. Cestino piatto, ripristino = `write_document` normale. |
| Versioning | **Snapshot per-file + tombstone** in `.fub/data/plugins/fub.versioning/`, come `EventHandler` (D4/D5/D8) | Cronologia per-nota e «vault al tempo T» con un meccanismo solo, senza git. È dogfooding: usa solo ciò che avrà un plugin di terzi. Il ripristino è una scrittura, quindi annullabile. |
| Versioning vs `Overflow` | L'handler è abbonato anche a `EventKind::Overflow` e **riconcilia** | Perdere un `DocumentChanged` costa una versione in ritardo; perdere un `DocumentRenamed` spezzerebbe la storia in due chiavi, e un `DocumentRemoved` lascerebbe «vault al tempo T» a mentire. La riconciliazione riparte da `list_documents`: tombstone per chi non c'è più, rifotografia per il resto (il dedup rende gratis gli immutati). |
| Spegnibilità | **Il versioning si spegne del tutto** (D7), anche **a runtime** con `Workspace::deactivate_plugin` ([0028](decisions/0028-come-un-componente-smette.md)) | Principio non negoziabile ([funzionalita-future.md](appendix/funzionalita-future.md)): spento = l'handler non si registra, la UI non esiste, nel vault non compare nulla. |
| Ciclo di vita del vault | **`open` → `close`**, e la chiusura è tre momenti in ordine: `Event::VaultClosed`, flush di **tutti** gli indici, poi ogni plugin che smette in ordine inverso ([0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)) | Prima `flush_indexes` aveva un solo chiamante in produzione — il file watcher —, quindi la durabilità di un indice dipendeva da un componente opzionale. Il flush finale è il punto di consistenza che *non* è il watcher; `VaultClosed` arriva prima di spegnere chiunque perché è l'unico modo che ha un `EventHandler` di rendere durevole ciò che teneva in memoria. |
| Modifiche esterne | **Il rilevamento si chiede**: `IndexQuery::VaultStatus` → `VaultStatus { watching, sync_failures, last_sync_error }` ([0030](decisions/0030-il-rilevamento-si-puo-chiedere.md)) | Il watcher è l'unico meccanismo con cui Fub sa che qualcun altro ha toccato il vault. La promessa è esplicita: le risposte riflettono il disco **solo quando `watching` è vero**; dove non lo è (network share, cloud, CLI, PWA, mobile) ciò che passa da fuori si vede alla riapertura. |
| Vault aperti | **Una mappa, non uno slot**: `Host` tiene `root canonico → VaultSession`, ogni comando IPC accetta un `vault` opzionale ([0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)) | Prima aprire un vault chiudeva quello aperto. La chiave è canonica perché due nomi dello stesso vault sarebbero due sessioni, e la seconda si bloccherebbe senza errore sul lock dell'indice. La metà shell (finestre, tab, layout) è il §1.2. |
| Case dei path | `DocId` **byte-exact**, risoluzione wikilink **case-insensitive**, rename case-only supportato | Stessa semantica osservabile su FS case-sensitive e non — [data-model.md](architecture/data-model.md). |
| Lavoro lungo dei plugin | **Job fuori dal giro sincrono**: `HostApi::spawn_job` → `Plugin::run_job` → `Event::JobDone` | I trait restano sincroni e brevi. Il job vede il vault ([0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md)) senza snapshot: fra due chiamate il vault può cambiare, e la guardia è la `base` della [0008](decisions/0008-modifica-chirurgica.md). Vedi [plugin-boundary.md](architecture/plugin-boundary.md). |
| Transclusion (embed) | **Placeholder dal provider, composizione kernel+frontend** | `render_html` resta puro per-documento; solo il kernel conosce la topologia del vault. |
| Indici (ricerca) | **Alimentati dal kernel**, non dagli eventi, **a lotti e con un esito** ([0051](decisions/0051-l-alimentazione-risponde.md)); backlink serviti dal grafo | Un indice che perde un aggiornamento risponde *sbagliato*, in silenzio. La coda eventi ha un budget e può troncare, questo canale no — ma il **destinatario** poteva rifiutare, e per un anno la firma ha reso quel rifiuto indicibile: adesso i tre metodi dell'alimentazione restituiscono `Vec<IndexLoss>`, che nomina il documento perduto. I backlink hanno già una fonte di verità — il grafo — e duplicarla creerebbe una seconda verità divergente. Vedi [M2](milestones/M2-search-graph.md). |
| Persistenza di un indice | **`HostApi` per-chiamata in `activate`, `flush` e `close`**, non altrove; registrazione = attivazione | Senza host in nessuna firma, un index provider WASM non potrebbe persistere nulla. L'host arriva dove lo stato attraversa il disco; `close` è **obbligatoria** ([0028](decisions/0028-come-un-componente-smette.md)) perché un `Drop` non ha l'`HostApi`. Non su `on_documents_*` (mutazioni in memoria) né su `query` (prestito condiviso). Per-chiamata e non un handle: il kernel presta `&mut Workspace`, che `'static` non può essere. Vedi [traits.md](architecture/traits.md). |
| Risultati di ricerca | **`snippet` testo puro + `highlights: Vec<Span>`** | Un provider di terzi non deve poter iniettare markup nella webview privilegiata (stessa regola di `UiNode::Html`); chi disegna avvolge gli intervalli. |
| Quale ricerca ([0025](decisions/0025-la-ricerca-predefinita.md)) | **Di classe *omnisearch*, built-in, accesa di default** | Due motori sullo stesso vault sono due ranking e due risposte alla stessa domanda. La ricerca non è un pannello: è la strada verso quick switcher, palette, `RunSearch`, collezioni, `vault.replace`, e se il comportamento buono stesse in un plugin ognuna di quelle superfici dovrebbe sapere se quel plugin c'è. Le conseguenze di firma sono state **decise**: `TextQuery` porta `tolerance` e `partial_last_term` ([0050](decisions/0050-cosa-si-chiede-a-una-ricerca.md)), e accanto a `highlights` — che restano span dentro `snippet`, perché servono a disegnare una riga — c'è `occurrences: list<DocPosition>`, byte del sorgente con la revisione ([0049](decisions/0049-una-posizione-dentro-un-documento.md)). Nella [seduta 21](roadmap/21-la-ricerca-predefinita.md) non resta nessuna **P0**: quel che resta è dove il comportamento si vede e cosa lo rende regolabile. |
| Eventi | **Dispatch a coda anti-rientranza** + varco `Event::Custom` | Un handler che emette o scrive durante `handle` non rientra. Il budget tronca **rumorosamente**: `Event::Overflow { dropped }` avvisa chi deriva stato — mai perdite silenziose. |
| Lotto e origine ([0011](decisions/0011-il-lotto.md), [0012](decisions/0012-origine-degli-eventi.md)) | **Un lotto è uno scope del kernel, non una transazione, e non lo apre un plugin**; un handler riceve `Notice { event, origin }` | Il lotto coalizza il solo `index-updated` e chiude con `BatchEnded { batch, changed }`: una rinomina con 200 backlink passa da 201 ridisegni a 1. Non annulla niente — il tutto-o-niente vuole il journal del §15.2, che dalla [0067](decisions/0067-il-registro-di-cio-che-e-successo.md) c'è: restano da scrivere i clienti che lo ripercorrono. Il lotto di un plugin è la sua invocazione di comando. `Origin.actor` è **chi ha chiesto**, non chi ha eseguito: senza, l'automazione su-modifica di 16.2 si richiama da sola. |
| Capacità dell'`HostApi` ([0013](decisions/0013-elenco-delle-capacita.md)) | **Elenco chiuso alla sottrazione**: ventidue metodi alla chiusura, **trentaquattro** oggi; operazioni strutturali dentro, `storage_*` fuori | Dopo il freeze, una capacità mancante è una feature che non potrà mai essere un plugin: ogni voce è decisa a verbale, comprese quelle escluse. Dentro: creare (che **rifiuta** un path occupato), rinominare (quella del kernel, che riscrive i backlink), il giro del cestino, `run_command`. Fuori con ragione: allegati (§14.1 — il modello ora c'è con la [0046](decisions/0046-l-anagrafe-del-vault.md), la capacità sarà additiva), rete (§9.1, §7.3), tempo differito (§8.3), cartelle (§14.3) e `notify`/`progress`/`log`, che informano senza aspettare risposta — cioè eventi. `report_progress` sembra l'eccezione e non lo è: è la **porta** di un evento ([0035](decisions/0035-il-lavoro-lungo-si-racconta.md)) e non riapre la regola. La distanza fra ventidue e trentaquattro è tutta di **aggiunte**, cioè di minor — l'elenco si è chiuso a ciò che si toglie, non a ciò che cresce. |
| Sicurezza UI | **`Html`/`WebView` riservati al codice fidato**, con **un punto di enforcement**: `Workspace::render_view`/`view_action` | Contenuto attivo nella webview privilegiata scavalcherebbe la sandbox WASM via UI. La regola era scritta e non applicata; il varco esiste ora coi suoi test, e vale anche per l'albero che torna da un'azione. |
| AI autocomplete | **Rimandata**, futuro plugin core (locale + cloud) | Non blocca l'architettura: è un `CommandProvider`/`EventHandler`. |
| AI che *agisce* ([FEATURES](FEATURES.md) 22.4) | **Feature rimandata, contratto chiuso** ([0009](decisions/0009-registro-dei-comandi.md), [0010](decisions/0010-comando-descritto-a-una-macchina.md)) | Un'AI che modifica N note è il primo **chiamante non umano** del registro comandi; i primi ad arrivare sono la CLI (27.1) e le automazioni (16.2). Un comando dichiara argomenti (`ParamSpec`), prosa e raggio (`CommandScope`), e si invoca senza applicare (`InvokeMode::DryRun` → `CommandPlan`). Il consenso non è una capacità dell'host ma il giro dry-run → piano → approvazione → apply. |
| Piattaforme | Linux (primario, Arch) + Windows + macOS | Tauri le supporta; CI multi-OS da subito. |

## Invarianti presidiate

Girano in CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)), insieme
alla conformità abi↔WIT.

- **`fub-kernel` e `fub-abi` non dipendono da `comrak`, `tauri`, `wasmtime`
  o `tantivy`.** `crates/fub-abi/tests/dependency_invariant.rs` interroga
  `cargo metadata` e fallisce se una di quelle famiglie compare fra le
  dipendenze normali, transitive incluse. Su `fub-abi` la chiusura transitiva
  è **elencata per intero**: una denylist per prefisso non vedrebbe un parser
  markdown con un nome nuovo.
- **`fub-features` non dipende da `fub-kernel`.** Le feature ufficiali sono
  impl dei trait, cioè quel che scriverà un plugin di terzi — e un plugin di
  terzi il kernel non ce l'ha. Il kernel sta nei `[dev-dependencies]`, per i
  soli test end-to-end.
- Conseguenza: **il banco di prova del kernel non può stare in `fub-sdk`**.
  L'SDK è ciò che un guest WASM importerà; ma la ragione stringente è già qui
  oggi, ed è che `fub-sdk` è dipendenza **normale** di
  `fub-format-markdown` — il kernel là dentro finirebbe nella libreria di un
  provider che esiste, e una cargo feature non lo eviterebbe (l'unificazione la
  accende per tutti). Sono due crate, e adesso lo presidiano due test
  ([0054](decisions/0054-il-banco-del-lato-provider.md),
  [0055](decisions/0055-il-banco-del-lato-host.md)).

## Regola d'oro

Ogni argomento e ogni valore di ritorno dei trait è un tipo di `fub-abi`,
`Serialize + Deserialize`, esprimibile come record WIT — niente reference con
lifetime, trait object o closure nelle firme. Così l'impl nativa è veloce e il
proxy WASM (M5) è meccanico.

La verifica non si ferma ai nomi: il test di conformità confronta **tipi e firme
complete** dedotti dai tipi Rust, e le tre conversioni del confine
(albero↔arena, `usize`↔`u64`, elisione di `host`) sono codice con dei test —
`fub_abi::arena` e `tests/wit_conformance.rs`. Dettaglio in
[architecture/traits.md](architecture/traits.md).

## Struttura dei crate

```
fub-abi              contratto: modello documento comune + tutti i trait
  │                    (+ `arena`: la forma dei tipi AL CONFINE e le conversioni)
  ├─ fub-kernel      core agnostico: vault, grafo link, registry, event bus
  ├─ fub-sdk         helper per scrivere provider (scan #tag / [[wikilink]])
  ├─ fub-format-markdown   1° FormatProvider nativo (comrak)
  ├─ fub-features    feature ufficiali (backlink, ricerca full-text, versioning)
  │                    NON dipende dal kernel: solo dal contratto, come un plugin
  ├─ fub-host        chi MONTA: tabella delle feature, sessione, watcher
  │                    dietro un trait, ponte eventi. NON dipende da tauri
  ├─ fub-app         colla Tauri v2: IPC comandi/eventi, finestre, dialoghi
  ├─ fub-testkit     banco di prova del KERNEL: `Banco`, un builder sui cinque
  │                    assi che i test variano davvero. Crate a sé e non
  │                    `fub-sdk::testing`, che è il banco dei PROVIDER (0055)
  └─ fub-wasm-host   (M5) host wasmtime per plugin di terzi
frontend/              Vite + TS + CodeMirror 6 (+ renderer UiNode)
crates/fub-abi/wit/  contratto WIT che rispecchia fub-abi (vivo da M2, freeze M4)
plugins/               (M5) plugin di esempio (wasm32-wasip2)
```

Questo elenco è di **destinazione**: nomina `fub-wasm-host`, che non esiste, e
l'indentazione raggruppa per ruolo, non per dipendenza. Chi
dipende davvero da chi sta in
[architecture/mappa-visuale.md](architecture/mappa-visuale.md#il-grafo-delle-dipendenze-e-il-test-che-lo-legge),
dove un test rilegge il disegno e lo confronta con `cargo metadata`.

Il meccanismo «un trait, due backend»: il trait vive in `fub-abi`,
`fub-format-markdown` lo implementa nativo, `fub-wasm-host` lo implementerà
come proxy. Il kernel vede solo `dyn Trait`.

Stato delle due divisioni dichiarate dal piano:

- **Fatta** — `fub-host` esiste e `fub-app` è ridotto a colla Tauri
  ([0023](decisions/0023-chi-monta-il-kernel.md)): quel montaggio ha cinque
  clienti previsti (CLI, API locale, e2e headless, mobile, PWA) e nessuno poteva
  riusare un composition root dentro un `#[tauri::command]`. Nello stesso crate
  stanno il **registry dei bundle** ([0031](decisions/0031-chi-possiede-i-bundle.md))
  e il **runner dei job** ([0032](decisions/0032-il-runner-dei-job.md), §9.3).
- **Da fare** — **un crate per bundle di feature** (§16.3): oggi compilare il
  pannello outline compila un motore di ricerca. La sua precondizione — il §16.2,
  cioè il banco condiviso — è **soddisfatta** dalla
  [0055](decisions/0055-il-banco-del-lato-host.md).

`frontend/` è un albero, non un elenco di file: la mappa sta in
[architecture/shell.md](architecture/shell.md), il perché nella
[0015](decisions/0015-la-forma-della-shell.md), cosa ci è atterrato sopra nella
[0016](decisions/0016-cosa-e-una-view.md).

## Mappa dei documenti

Mappa **di dettaglio**, documento per documento. La porta di `docs/` — percorsi
di lettura, convenzioni, dove va un file nuovo — è [README.md](README.md).

**Architettura** (trasversale ai milestone):
- [architecture/mappa-visuale.md](architecture/mappa-visuale.md) — l'intera architettura in tre disegni: quello disposto a mano (gli otto crate, la shell, il disco, e tratteggiato ciò che non esiste ancora), il grafo delle dipendenze presidiato da un test, e dove gira cosa mentre l'app è accesa.
- [architecture/data-model.md](architecture/data-model.md) — `DocumentModel`, `Block`/`Inline`, `Span`, `LinkTarget`, escape hatch `Custom`.
- [architecture/traits.md](architecture/traits.md) — i trait del contratto, chi li implementa e a quale milestone, la tabella di esprimibilità WIT.
- [architecture/ui-protocol.md](architecture/ui-protocol.md) — protocollo `UiNode`, mapping sul frontend, regola dell'escape hatch web-view.
- [architecture/plugin-boundary.md](architecture/plugin-boundary.md) — `Plugin`/`HostApi`/`PluginManifest`, modello capability ibrido, sandbox WASM.
- [architecture/shell.md](architecture/shell.md) — l'albero del frontend, la cucitura unica con l'host, i due bus.
- [architecture/wit.md](architecture/wit.md) — il contratto nella lingua dei componenti WASM: perché l'albero `wit/` esiste e cosa presidia.
- [architecture/wit-congelato.md](architecture/wit-congelato.md) — la linea di base versione per versione, e la promessa di additività su cui poggia il freeze di M4.

**Milestone**:
- [milestones/M2-search-graph.md](milestones/M2-search-graph.md) — ricerca (tantivy), grafo/indice incrementali, graph view, outline/tag panel, "crea nota".
- [milestones/M3-editor-fidelity.md](milestones/M3-editor-fidelity.md) — live-preview in-editor, command palette, settings dichiarativi, rendering callout/embed/math.
- [milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md) — freeze del contratto, WIT, conformità abi↔WIT, primo plugin nativo.
- [milestones/M5-wasm-runtime.md](milestones/M5-wasm-runtime.md) — `fub-wasm-host`, proxy WASM, applicazione delle capability, plugin di esempio.

**Piani di lavoro**:
- [todo.md](todo.md) — la **roadmap infrastrutturale**: quali pezzi mancano
  perché la massa di [FEATURES.md](FEATURES.md) sia implementabile *come
  provider* invece che come codice dell'app. Le voci sono raggruppate per
  **seduta** (un file in [roadmap/](roadmap/)) e non per strato: una seduta è un
  insieme di voci che conviene decidere in una volta sola. Lo **strato**
  (contratto, kernel, shell, presidi) resta come etichetta perché fissa la
  **scadenza**: *contratto* vuol dire freeze di M4, ed è il criterio che fa di
  una voce una **P0**. Conteggi, priorità e stato stanno lì, non qui.
- [decisions/](decisions/README.md) — **i verbali delle decisioni chiuse**, un
  file per decisione (`NNNN-<slug>.md`) più l'indice. Sono la parte del repo che
  fra sei mesi non si ricostruisce dal diff — il *perché*, non il *cosa* — e
  stanno fuori da `todo.md` per la [0014](decisions/0014-i-verbali-fuori-da-todo.md),
  che porta con sé anche il **check dei link interni** in CI
  (`.github/scripts/check-doc-links.mjs`).

**Il lessico**:
- [glossario.md](glossario.md) — le parole di questo repo che non sono standard, sette famiglie, una voce per termine: cos'è in due righe, il tipo Rust da cercare, il file in cui vive (link vero, quindi presidiato) e il verbale che l'ha deciso. Non spiega l'architettura: rimanda a chi la spiega.

**Il repo come progetto pubblico** (primo livello di `docs/`, perché la prosa sta
in un posto solo; i nomi sono in inglese perché GitHub li cerca **per nome** — la
ragione per esteso è in [README.md](README.md)):
- [CONTRIBUTING.md](CONTRIBUTING.md) — le quattro invarianti presidiate, il ciclo locale, i sei job della CI, la forma dei commit, come si chiude una decisione.
- [SECURITY.md](SECURITY.md) — il canale privato per una vulnerabilità, il perimetro (dentro: il contenuto dei file come input non fidato; fuori: il sandbox WASM, che a M5 non esiste ancora), e i presidi già in piedi.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1, traduzione ufficiale italiana, ripreso parola per parola.
- [versionamento.md](versionamento.md) — i **tre** numeri di versione: i crate (SemVer, un numero solo per il workspace), il contratto (`ABI_VERSION` + `package fub:abi@…`, con la regola di caricamento) e i sette `SCHEMA_VERSION` su disco. L'additività del contratto non si ripete lì: rimanda a [architecture/wit-congelato.md](architecture/wit-congelato.md).
- [CHANGELOG.md](CHANGELOG.md) — cosa cambia per chi usa Fub, alla grana della milestone finché non esiste un rilascio.

**Appendici**:
- [appendix/ai-autocomplete.md](appendix/ai-autocomplete.md) — design (non milestone) dell'autocompletamento AI.
- [appendix/funzionalita-future.md](appendix/funzionalita-future.md) — funzionalità post-M5 (mobile, sync, flashcard, export editoriale…) dalle interviste alle personas; include il principio della **spegnibilità totale**.
- [appendix/platforms-ci.md](appendix/platforms-ci.md) — matrice OS e CI multi-piattaforma.

Nota storica: `ORGANIZZAZIONE_VAULT.md` è stato **cancellato** con la
[0003](decisions/0003-modello-del-documento.md) (commit `0a4ee40`). La feature
c'è ed è spedita (sidebar ad albero, icone, folder notes, spazi, appuntate,
ordinamento drag & drop, cartella come radice, sidecar `.fub/workspace.json`);
il design vive nel codice (`frontend/src/rules/organizer.ts`,
`panels/explorer.ts`), e il sidecar è rientrato nella disciplina col §11.3
([0038](decisions/0038-il-kernel-possiede-il-sidecar.md)). Il testo si recupera
con `git show 0a4ee40^:docs/ORGANIZZAZIONE_VAULT.md`.

## Roadmap (sintesi)

- **M1 — App usabile ✅ (2026-07-24)** — core agnostico + `FormatProvider` +
  provider markdown + editor/vault + feature native (anteprima, wikilink,
  backlink) + file watcher. 33 test verdi, niente WASM.
- **M2 — Ricerca + graph + rifiniture** (in corso) →
  [dettaglio](milestones/M2-search-graph.md). Fatti:
  - grafo incrementale con full-rebuild come oracolo;
  - full-text (tantivy) via `IndexProvider`, persistente e incrementale;
  - CRUD completo dall'app (creazione, «crea nota» da link non risolto, rename,
    cestino) e versioning del vault (D1–D8 nella tabella sopra);
  - organizzazione della sidebar stile make.md: albero, icone, folder notes, spazi;
  - backlink, outline, tag e statistiche come `ViewProvider` veri, con
    `query_index` (canale metadata) e `active_context`, e il giro
    azione→`ViewUpdate` chiuso (`Navigate`, `Reveal`, `RunSearch`);
  - **registro dei comandi** con palette ([0009](decisions/0009-registro-dei-comandi.md),
    [0010](decisions/0010-comando-descritto-a-una-macchina.md)) — anticipo di M3;
  - **lotto e origine** ([0011](decisions/0011-il-lotto.md),
    [0012](decisions/0012-origine-degli-eventi.md));
  - **capacità chiuse** ([0013](decisions/0013-elenco-delle-capacita.md)): le
    azioni strutturali della shell sono diventate comandi, e sei comandi Tauri
    sono spariti;
  - **cache sdoppiata** metadata/body e **graph view** su Canvas.

  Resta il §5 del quarto audit, che ha un milestone suo. La ricerca spedita è
  dichiarata *la* ricerca dell'app ([0025](decisions/0025-la-ricerca-predefinita.md)),
  e quella dichiarazione apre la [seduta 21](roadmap/21-la-ricerca-predefinita.md).
- **M3 — Fedeltà editor** → [dettaglio](milestones/M3-editor-fidelity.md).
  Live preview in-editor (decorazioni CodeMirror sugli `Span`), settings
  dichiarativi, rendering callout/embed/math. La command palette è già a M2.
- **M4 — Hardening del contratto + WIT** →
  [dettaglio](milestones/M4-wit-hardening.md). Freeze della superficie dei
  trait; `crates/fub-abi/wit/fub/*.wit` (vivo da M2) rispecchia
  `fub-abi`; test di conformità; primo plugin nativo. La **checklist del
  freeze** vive lì e rimanda alle voci **P0** di [todo.md](todo.md), che è
  l'elenco autorevole.
- **M5 — Runtime WASM** → [dettaglio](milestones/M5-wasm-runtime.md).
  `fub-wasm-host` (wasmtime, component model), proxy per ogni trait, host
  function per `HostApi`, plugin di esempio in `wasm32-wasip2`.
- **Futuro** — autocompletamento AI come plugin core
  ([appendice](appendix/ai-autocomplete.md)); centro di comando LLM
  ([FEATURES](FEATURES.md) 22.4), che è un chiamante del registro e non una
  superficie in più; candidati post-M5 dalle interviste
  ([appendice](appendix/funzionalita-future.md)). Principio per tutto ciò che è
  oltre il core: **spegnibilità totale**.

## Verifica (M1)

- Automatica: `cargo test --workspace` (parser markdown, grafo agnostico, e2e
  sul vault di esempio: risoluzione wikilink nome/alias/path, backlink,
  anteprima, modifica→aggiornamento grafo) + `cargo clippy`.
- Manuale: `cargo tauri dev` (da `crates/fub-app`) o il binario release con
  `FUB_VAULT` puntato a un vault: aprire note, editare, navigare
  `[[wikilink]]`, vedere i backlink.

I criteri di accettazione e i piani di test di M2–M5 stanno nei rispettivi
documenti milestone.

## Rischi / punti difficili (trasversali)

| Rischio | Stato | Come |
|---|---|---|
| Mantenere il core agnostico | presidiato | invariante di dipendenze in CI |
| Confine WASM (M5) | de-rischiato | regola d'oro + `wit/` vivente da M2 + confronto sui **tipi** + conversioni già testate in `fub_abi::arena`: il proxy di M5 le chiamerà, non le inventerà |
| Live-preview in-editor (M3) | de-rischiato | anteprima HTML fin da M1 e `Span` nel modello. Dalla [0007](decisions/0007-contesto-di-sessione.md) l'anteprima non è un pannello sempre acceso ma **la modalità Lettura** (`PaneMode::Reading`): due superfici sullo stesso documento erano due verità da allineare |
| Edge case markdown Obsidian | mitigato | corpus di fixture + snapshot test |
| Rientranza del dispatch eventi | risolto per costruzione | coda + budget nel `Workspace`; l'esaurimento emette `Event::Overflow` — [traits.md](architecture/traits.md), «Dispatch» |
| «Perdite silenziose non esistono per contratto» vale su un canale solo | **mitigato** | l'invariante era vera della sola coda eventi. Adesso vale su quattro canali: l'alimentazione degli indici **nomina** ciò che non ha preso ([0051](decisions/0051-l-alimentazione-risponde.md)), e l'esito di un handler, il flush e il panico di un provider diventano un `Event::Trouble` che il centro notifiche mostra ([0052](decisions/0052-cio-che-va-storto-e-un-evento.md)). Resta **detta a nessuno** la parte che non è ancora stata convertita — **27** `eprintln!` nel backend, che adesso hanno un canale dove andare (§20.2, casella residua) — e la shell, che di canali non ne ha: **14** `console.warn/error` (§20.4). Un caso di troncamento scoperto misurando la 0052 è il §20.5 |
| Plugin lenti nel giro sincrono | risolto per contratto | il lavoro lungo passa dai **job**, fuori dal lock del workspace e con l'`HostApi` in mano ([0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md)) |
| Buffer editor vs disco | politica decisa | flush al cambio documento, reload del buffer pulito, buffer sporco mai sovrascritto; il merge esplicito è lavoro M3 — [data-model.md](architecture/data-model.md) |
| Memoria su vault grandi | in corso | cache sdoppiata metadata (globale) vs body parsato (documenti aperti) — [M2](milestones/M2-search-graph.md) |
| Concorrenza | mitigato | da `Mutex` a `RwLock` con la [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md), e due query che girano insieme con la [0026](decisions/0026-due-query-insieme.md) |
| Il canale dati era servito dal kernel, non instradato | **risolto** | [0019](decisions/0019-il-canale-dati.md): le risposte del kernel sono un `IndexProvider` registrato per primo, chi serve cosa è dichiarato alla registrazione, e la query è un albero del contratto invece di una stringa nella sintassi di una dipendenza |
| Il costo di una capacità non è la firma, è il numero di host | **mitigato** | [0021](decisions/0021-il-confine.md): il rifiuto è un wrapper generico (`Guard<H, P: Policy>`) e `HostApi` è una **somma di famiglie** — dieci quando la 0021 ha tagliato, quattordici oggi — così «sola lettura» è un tipo che non ha le scritture invece di un tipo che ne rifiuta dodici |
| Le stesse regole scritte due volte | **mitigato** | [0020](decisions/0020-le-regole-in-un-posto-solo.md): le regole del contratto stanno in `fub_abi::rules`, e ciò che resta duplicato in TS è legato da una fixture generata (`rules_mirror.rs` → `rules-samples.json` → `rules-mirror.test.ts`). Fine corsa possibile: `fub-abi` compilato a `wasm32-unknown-unknown` |
| Il freeze arriva prima delle firme che FEATURES richiede | presidiato | è ciò che le voci **P0** di [todo.md](todo.md) esistono per chiudere: è P0 tutto ciò che ha una forma di **contratto**, in qualunque capitolo. Con la [0051](decisions/0051-l-alimentazione-risponde.md) **non ne resta nessuna aperta**, il che sposta il rischio dove è sempre stato davvero: non nel chiudere quelle trovate, ma nel trovare quelle che nessun giro ha ancora visto. Le decisioni con una domanda aperta sono nella checklist di [M4](milestones/M4-wit-hardening.md); il dogfooding resta lo strumento che le scopre |
