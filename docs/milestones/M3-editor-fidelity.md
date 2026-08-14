# M3 — Fedeltà editor

Torna a [../PIANO.md](../PIANO.md) · segue [M2](M2-search-graph.md) · precede
[M4](M4-wit-hardening.md).

## Obiettivo

Chiudere il divario di UX con Obsidian **dentro l'editor**: live-preview in-editor
(non più solo pannello HTML separato), command palette, settings via form
dichiarativi, e **rendering ricco di callout/embed/math** (oggi relegati
all'escape hatch `Custom`).

## Design

### Live-preview in-editor (decorazioni CodeMirror sugli `Span`) — **fatto**

La live preview è in `frontend/src/editor/livepreview.ts` e decora l'editor
CodeMirror: wikilink cliccabili inline, `#tag`, enfasi, heading, code, checkbox.

- **Il ponte byte→UTF-16 non è stato costruito: è stato evitato, e la nota di
  revisione della voce lo dichiara.** Le decorazioni leggono **l'albero Lezer**
  di `lang-markdown`, non gli `Span` del modello Rust: il tree è già in code
  unit UTF-16 (la valuta di CodeMirror), si aggiorna a ogni battuta senza IPC, e
  il problema byte↔UTF-16 non esiste proprio. Gli `Span` restano per le
  decorazioni semantiche di M3 — e per il `Reveal` dell'outline, che il ponte
  lo fa in `frontend/src/rules/offsets.ts` (byte UTF-8 → code unit UTF-16,
  verificato su testo accentato+emoji).
- **La sintassi che il parser non conosce** (wikilink, i tratti fra
  delimitatori, tag, checkbox) si riconosce **per riga**, non per albero.
- **L'anteprima HTML resta** come modalità Lettura del pannello e come oracolo
  visivo ([decisione 0007](../decisions/0007-contesto-di-sessione.md)): la
  live-preview è "meccanica" perché non richiede nuovi dati, solo proiezione.

### Conflitti buffer ↔ disco — **fatto, a due vie**

La politica delle **tre copie** è decisa e cablata (vedi
[data-model.md](../architecture/data-model.md), "Le tre copie"): flush del
buffer al cambio documento, reload del buffer pulito su cambio esterno, buffer
sporco mai sovrascritto. Il caso rimasto aperto — **documento aperto e sporco
che cambia su disco** (watcher, riscrittura link da un rename altrui) — si
risolveva con "il buffer vince, con warning". M3 lo ha chiuso:

- **conflitto esplicito, a due vie e non a tre**: `shell.doc.conflict.mine`
  («vince il mio testo», si detta) e `shell.doc.conflict.theirs` («vince il
  loro», si scarta il mio) in `frontend/src/panels/document.ts`. Sono **comandi
  e non un dialogo** per la ragione della
  [0088](../decisions/0088-cio-che-non-e-ancora-successo.md): la decisione è
  dell'utente, e un modale che scatta durante un autosave con debounce la
  chiede in un momento che l'utente non ha scelto. Il buffer sporco resta lì e
  aspetta, come una bozza recuperata. Il «confronta» del design resta una
  casella, non un criterio: la voce stessa diceva di valutare lo **span-shift**
  solo se il conflitto si rivela frequente nell'uso reale, e non lo è stato.
- **flush-before-patch esteso alla palette**: un comando che scrive documenti
  (`spec.scope.writes`) flussa i buffer prima di calcolare le patch — la stessa
  guardia di `nonInSalvo` dell'esploratore, ora anche in `frontend/src/ui/palette.ts`
  (via `PaletteHost.flushPendingSave`, iniettata da `main.ts`). I comandi di
  sola lettura non pagano il giro. Presidiato da due e2e in
  `frontend/src/shell.e2e.test.ts` (buffer sporco + `note.create` → il flush
  arriva prima dell'invocazione; `search.open` → nessun flush).

### Rendering ricco di callout / embed / math — **fatto, meno la resa TeX**

Il provider markdown emette callout/embed/math come `Block::Custom`
(agnosticità del modello). M3 ha aggiunto **l'interpretazione** lato resa,
senza togliere l'escape hatch:

- **Callout — fatto.** `crates/fub-format-markdown/src/render.rs` riconosce
  `custom_kind::CALLOUT` e produce la resa ricca; i `custom_kind` sconosciuti
  degradano a blocco generico senza crash.
- **Embed — fatto.** Il protocollo di transclusion era già cablato: il provider
  emette il placeholder `.embed`, il kernel serve `render_embed(page, heading?,
  block?)` (anche per sezione e per blocco `^id`, via `Span` — dalla
  [0049](../decisions/0049-una-posizione-dentro-un-documento.md)), e il
  frontend idrata in `frontend/src/panels/preview.ts` con guardia su cicli
  (catena dei documenti già aperti) e profondità (`MAX_EMBED_DEPTH = 5`), più
  un memo per chiedere ogni pagina una volta sola (§2.9). M3 ha esteso la resa —
  non il meccanismo.
- **Math — parziale, chiuso dalla [0158](../decisions/0158-la-matematica-e-sorgente-a-vista-per-ora.md).**
  `custom_kind::MATH` porta il sorgente (`crates/fub-abi/src/model.rs:1046`,
  carico `Corpo("source")`), `MathRenderer` in
  `crates/fub-features/src/blocks.rs` emette `<div class="math-block"
  data-tex=…>` con la sorgente escapata, e `render.rs` non ha un ramo math: il
  blocco c'è, il compositore no, e si vede. Niente KaTeX/MathJax nel bundle
  (una dipendenza nuova è una decisione di supply chain, [0001](../decisions/0001-supply-chain-e-sbom.md)):
  la resa vera resta una casella di
  [06-rendering-preview-temi.md](../features/06-rendering-preview-temi.md), col
  gancio `data-tex` già scritto.

### Command palette (`CommandProvider`) — **fatto** (anticipata a M2)

Il registro, la palette e il dry-run sono stati fatti a M2 insieme alla
[decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): il
motivo è che `CommandSpec` e `invoke` sono **firme**, e le firme costano un
campo prima del freeze e una migrazione dopo. Cosa c'è:
`register_command_provider`/`commands`/`invoke_command` nel kernel,
`list_commands`/`invoke_command` sull'IPC, `CoreCommands` in `fub-features`, la
palette in `frontend/src/ui/palette.ts` (filtro fuzzy, form dai `ParamSpec`,
anteprima del piano prima di applicare, scorciatoie **dichiarate** dai comandi).

Cosa M3 ha chiuso:

- **I comandi strutturali** (crea/rinomina/cestina nota, ripristina/svuota
  cestino): migrati nel registro con scope `writing` — la
  [decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha dato
  all'`HostApi` le capacità che mancavano, e senza di esse un comando ufficiale
  le otterrebbe per una via privilegiata che un plugin non ha. `note.create` è
  il chiamante che la voce «crea nota» di M2 aspettava dal principio.
- **La mappa dei tasti come dato**: la shell onora il `keybinding` dichiarato e
  la mappa configurabile è nei settings — la
  [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) ha fatto di una
  scorciatoia una chiave come le altre, dentro il vault.

Cosa resta:

- **I comandi della shell** (toggle pannelli, cambio modalità): il registro vive
  nel kernel e il frontend non può registrarvisi (§18.2) — restano comandi di
  shell, senza accordo.
- **Il form dei parametri con i nodi di input**: la palette disegna i campi da
  sé dai `ParamSpec`; i nodi input `UiNode` esistono (li usa il form dei
  settings) ma non sono la resa dei `ParamSpec` — la casella resta, e non è un
  criterio di accettazione.

### Settings via form dichiarativi — **fatto**

- I settings (del core e dei futuri plugin) sono descritti come **form
  dichiarativi** nel protocollo `UiNode`; i nodi input necessari (text, toggle,
  select, number) sono in `crates/fub-abi/src/ui.rs` e il form in
  `frontend/src/panels/settings.ts` li disegna dallo schema del canale dati
  (`impostazioni()`, `IndexQuery::Settings`) — nessun id cablato nel pannello.
- I nodi input hanno **`id` stabile** e il renderer **riconcilia per id**: lo
  stato locale (focus, digitazione in corso) sopravvive a `ViewUpdate::Replace`
  — decisione già presa, vedi [ui-protocol.md](../architecture/ui-protocol.md).
- Persistenza via `HostApi.storage_get/set` (namespace per plugin/core); le
  scorciatoie e i permessi (§23.17) sono impostazioni come le altre, con la
  stessa forma.

## Trait/API coinvolti

- `CommandProvider` (prima impl) e `HostApi` (storage per settings) — **fatti**.
- `FormatProvider::render_html` esteso (interpretazione dei `custom_kind`) —
  **fatto** per callout; la resa TeX resta scoperta (0158).
- Nuovi `UiNode` input per i form (estensione del protocollo) — **fatti**.
- Proiezione "decorazioni" dal `DocumentModel` verso il frontend — **non
  servita**: la live preview legge l'albero Lezer, non una proiezione IPC.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| Live-preview via **decorazioni sugli `Span`** | Gli `Span` esistono da M1; niente nuovo modello, solo proiezione. **Riveduta in corso d'opera**: le decorazioni leggono l'albero Lezer (già UTF-16) e il ponte byte↔UTF-16 non serve — gli `Span` restano per il `Reveal` e per le decorazioni semantiche. |
| Callout/embed/math **a M3, non M2** | Sono "fedeltà di resa": stanno con la live-preview, non con ricerca/grafo. |
| Interpretazione dei `custom_kind` **nella resa**, non nel modello | Il modello resta agnostico; solo il layer di rendering conosce i callout. |
| Settings come **form dichiarativi** `UiNode` | Stesso protocollo dei plugin; niente UI ad hoc; congelabile in WIT. |
| Conflitto a **due vie** (mine/theirs), non tre | Il «confronta» è una casella, non un criterio: la voce stessa diceva di valutare lo span-shift solo se il conflitto si rivela frequente, e non lo è stato. |
| Math **sorgente a vista** ([0158](../decisions/0158-la-matematica-e-sorgente-a-vista-per-ora.md)) | Il blocco c'è, il compositore no, e si vede: `data-tex` è il gancio per il motore futuro, e una dipendenza nuova è una decisione di supply chain (0001). |

## Criteri di accettazione

- Aprendo una nota, wikilink/tag/heading/enfasi sono resi inline nell'editor; la
  riga sotto cursore resta editabile come sorgente. **Fatto** (livepreview.ts).
- Callout ed embed sono resi correttamente nell'anteprima; un `custom_kind`
  sconosciuto degrada a blocco generico senza crash. **Fatto** (render.rs +
  preview.ts). La resa TeX è **sorgente a vista** (0158): il `math-block` con
  `data-tex` si vede come formula, non composta.
- Command palette apre, filtra, invoca; i comandi base funzionano e notificano;
  un comando che scrive flussa i buffer prima di partire. **Fatto** (palette +
  flush-before-patch, presidiato da e2e).
- I settings si modificano da form e persistono tra riavvii. **Fatto**
  (settings.ts + `setSetting`).
- Nessuna regressione sui test M1/M2. **Fatto** (suite verde).

## Piano di test

- **Snapshot** del rendering ricco su un corpus di fixture Obsidian (callout tipi
  diversi, embed risolto/non risolto, tabelle) — la resa TeX resta fuori (0158).
- **Unit** sul mapping `Span`→posizione CM (round-trip byte↔riga/colonna, casi
  multibyte UTF-8) — `frontend/src/rules/offsets.ts`, verificato su testo
  accentato+emoji.
- **Unit** su `CommandProvider`: registrazione, invoke, `UnknownCommand`.
- **E2e**: invoca "crea nota" dalla palette; modifica un setting e verifica la
  persistenza; buffer sporco + comando che scrive → flush prima dell'invocazione
  (`frontend/src/shell.e2e.test.ts`).
- `cargo test --workspace` + `cargo clippy` verdi (vedi
  [../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Fedeltà live-preview** (edge case markdown, cursore, IME) → pannello HTML come
  fallback; corpus di fixture + snapshot.
- **Math/embed pesanti** → rendering lazy fuori viewport resta scoperto (buco
  dichiarato della [0112](../decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md)):
  gli embed hanno guardia anti-ciclo e profondità, e il memo toglie i viaggi
  ripetuti; la resa TeX è rimandata (0158).
- **Estensione del protocollo `UiNode`** → ogni nuovo nodo deve restare
  WIT-esprimibile (tabella in [../architecture/traits.md](../architecture/traits.md));
  congelamento a M4.
