# Piano di aggiustamento (audit architetturale 2026-07-24, terzo giro)

Torna a [PIANO.md](PIANO.md). Esito del terzo audit codice↔documenti (i punti
1–5 del secondo giro sono chiusi e vengono ritirati da questa lista). Verdetto:
**architettura solida, nessun difetto strutturale.** Il grafo delle crate è
aciclico e converge su `fubmd-abi` (foglia pura, verificato in CI); le tre
dipendenze pesanti — `comrak`, `tantivy`, `tauri` — sono ciascuna reclusa in una
crate di bordo dietro un trait; il confine WASM è già de-rischiato in codice
testato (`arena` per gli alberi ricorsivi, `HostApi` eliso come capability, 14
mutazioni-spia nel test di conformità); il dogfooding è reale (le feature
ufficiali implementano gli stessi trait di un plugin di terzi, invariante
testato).

**Il rischio non è la struttura: è il momento del freeze.** Il contratto si
congela a [M4](milestones/M4-wit-hardening.md); da lì i breaking costano un bump
di versione. Le voci qui sotto sono, nell'ordine, (§1) le decisioni di
*superficie del contratto* che il freeze deve chiudere — gratis adesso,
costosissime dopo (le due che sbloccavano le view sono prese; restano le
strutturali e di forma); (§2) il protocollo `ViewProvider`, ora esercitato dal
primo provider vero; (§3) i tre rilievi nuovi di questo giro; (§4) il debito già
dichiarato, che ha un milestone suo.

Nota di framing (non un TODO): non c'è "un trait unico" — sono **sette** trait
più la capability `HostApi`. La cosa singola è il *crate-contratto*
`fubmd-abi`. Dove i documenti o gli appunti dicono "trait unico", intendono
questo.

## 1. Decisioni che il freeze di M4 deve chiudere — costose dopo, gratis prima

Sono decisioni sulla **forma delle firme da congelare**, non righe di codice. Vanno
prese *insieme*: rispondono tutte alla stessa domanda — "cosa vede un plugin del
vault". Aggiungerle dopo il freeze è un breaking-bump del contratto.

**Le due che sbloccavano il dogfooding delle view sono prese e in codice**
(2026-07-25); restano le decisioni strutturali e di forma, che non hanno un
consumatore che le pretenda *ora* ma vanno confermate al freeze.

- [x] **`host-api.query-index`**: aggiunta a `HostApi` (e al WIT, con
      `use index.{index-query, index-result}`) come
      `query_index(&self, IndexQuery) -> Result<IndexResult, PluginError>`.
      Delega a `Workspace::query_index`: stesso dispatch (backlink dal grafo,
      resto ai provider), `&self` perché una query non muta. Una view vede
      esattamente ciò che vede il kernel, sotto lo stesso prestito condiviso.
- [x] **Documento attivo visibile a una view**: risolto come *capacità di
      lettura*, non evento — `HostApi::active_document(&self) -> Option<DocId>`.
      Il kernel tiene `Workspace::active`, la shell lo imposta con
      `set_active_document` a ogni navigazione, la view lo **chiede** quando ne
      ha bisogno. Niente gemello che scrive: "quale nota guardo" è una scelta
      dell'utente sull'app, non una capacità da concedere a un plugin. Scelto
      contro l'evento perché `render_view(&self)` è immutabile — una view non
      può accumulare stato dagli eventi senza interior mutability — e contro un
      argomento di `render_view` perché costringerebbe *ogni* view (grafo,
      settings) a portarsi un contesto che non usa.
- [ ] **Operazioni strutturali e parità plugin↔nativo**: rename, `create_note`,
      trash sono kernel-owned e fuori da `HostApi` (scelta deliberata). La
      "parità plugin↔native" non le copre: decidere a M4 se e quali esporre come
      capacità del contratto. È la stessa domanda delle due capacità qui sopra.
- [ ] **`create_note` in una cartella** ("crea nota qui"): oggi `create_note`
      crea solo nella radice; il caso "in questa cartella" tocca il kernel. Se
      diventa capacità di plugin, è parte della stessa decisione strutturale.
- [ ] **Escape hatch `type json = string`**: `serde_json::Value` attraversa il
      confine come stringa JSON opaca (frontmatter, `attrs` di `Custom`, args
      comandi, payload job, storage). Nessuno schema è validato al confine.
      Confermare al freeze che l'opacità è accettabile per ciascun uso, o
      promuovere a record WIT tipati i punti dove non lo è.
- [ ] **Canale progresso/streaming dei job**: decidere prima del freeze se a un
      job serve un canale di avanzamento/streaming o se `Event::JobDone` basta.
      Aggiungere un canale a `HostApi`/al world dopo è breaking.

## 2. `ViewProvider`: primo provider vero, protocollo esercitato

Il punto di enforcement (`validate_untrusted`) esisteva e il routing passava dal
kernel, ma le implementazioni del trait erano **zero**. Ora ce n'è una vera:
`fubmd_features::BacklinksView` (2026-07-25), sbloccata dalle due capacità del §1.

- [x] Migrati i backlink a `ViewProvider`, chiudendo il giro azione→`ViewUpdate`
      nel renderer generico. `BacklinksView` non riceve dati dall'app: prende il
      documento attivo con `active_document` e i backlink con `query_index` — è
      il dogfooding vero che prima era impossibile. La vecchia
      `build_backlinks_view` resta come pura trasformazione dati→UI (usata dal
      provider e testabile senza host); scompaiono il comando ad-hoc
      `backlinks_view` e il parsing `open:` nel frontend, sostituiti dai comandi
      generici `render_view`/`view_action`/`set_active_document`. La prova che il
      giro passa dal contratto e non dall'app è
      `crates/fubmd-features/tests/backlinks_view_e2e.rs` (kernel vero,
      `KernelHost` vero: render legge attivo+grafo, il click torna `Navigate`).
- [x] **Outline** è la seconda view vera (`fubmd_features::OutlineView`,
      2026-07-25) e la prima a usare il **canale metadata**: una view non ha un
      `FormatProvider`, quindi non può parsare un documento per ricavarne gli
      heading. Decisione: li chiede al kernel con `IndexQuery::Outline`, servita
      dai `DocumentModel` che il kernel già tiene — la stessa porta dei backlink,
      nessun nuovo metodo `HostApi`. Il salto a un heading è un nuovo
      `ViewUpdate::Reveal { doc_id, span }` (span in byte UTF-8); il frontend lo
      esegue convertendo byte→code unit UTF-16 (`frontend/src/offsets.ts`, il
      ponte che §4 dava per M3 — anticipato qui perché lo scroll lo pretendeva, e
      verificato su testo accentato+emoji). Prova e2e:
      `crates/fubmd-features/tests/outline_view_e2e.rs`.
- [ ] Le view M2 restanti (tag panel, graph-data) **nascono** come `ViewProvider`
      sullo stesso giro — vincolo invariato: non cablarle ad-hoc. Il tag panel
      riuserà il canale metadata (una query sui tag del vault); il graph-data è
      fuori da `UiNode` (Canvas), superficie privilegiata dichiarata.

## 3. Rilievi nuovi di questo giro

- [ ] **Buco d'ordine nel test di conformità**: l'ordine dei casi di un variant è
      confrontato con l'ordine in cui il *test* li elenca, non con quello
      dell'enum Rust. Riordinare il WIT è rosso; riordinare l'enum Rust senza
      toccare il test resta verde — ma l'ordine dei casi **è il discriminante
      ABI**. Chiudere il buco prima del freeze: derivare l'ordine atteso
      dall'enum Rust, così un riordino diventa rosso da entrambi i lati.
- [ ] **Drift dei mirror TS↔Rust**: `UiNode`, `ViewUpdate`, `Event`
      (`KernelEvent`), `Span`, `VersionRef` sono rispecchiati **a mano** in
      TypeScript, senza un test che leghi i due lati; la stessa lacuna del test
      gemello di `pageName` (aperta dal secondo giro). Manca del tutto un harness
      di test frontend (`package.json` ha solo `vite` e `tsc`). Introdurlo, e con
      esso i test che confrontano i tipi TS con la forma dei tipi Rust — è il
      confine che oggi può divergere in silenzio. (La migrazione dei backlink ha
      aggiunto `ViewUpdate` a questo elenco.)
- [ ] **UI di produzione = IPC bespoke + canale view generico**: il canale
      core→UI reale è ancora fatto in gran parte di ~24 comandi
      `#[tauri::command]` con tipi propri (`search`, `render_preview`,
      `render_embed`, versioning…) più il bridge eventi `fubmd://event`. Ma ora
      esiste anche il **canale generico dei `ViewProvider`** —
      `render_view`/`view_action`/`set_active_document` — e il pannello backlink
      ci passa (non più `backlinks_view` ad-hoc). È il varco su cui nascono le
      nuove superfici dichiarative. Resta il debito che **cresce**: ogni feature
      nata come comando bespoke è retrofit in più il giorno in cui deve diventare
      superficie plugin. Vincolo invariato: le superfici *rivendicate dal
      dogfooding* nascono come `UiNode`/`ViewProvider`; ciò che resta bespoke
      (graph view, `Html`/`WebView` privilegiate) va marcato come tale, non
      lasciato ambiguo.

## 4. Debito già dichiarato (confermato, resta in agenda col suo milestone)

- [ ] **Cache metadata/body da sdoppiare** (M2): confermato confinato —
      `Workspace::model()` senza chiamanti esterni, grafo autosufficiente,
      ~1–2 giornate dentro `workspace.rs`. Il `Workspace` oggi tiene i
      `DocumentModel` completi di tutto il vault: è il punto di pressione su
      vault grandi.
- [ ] **Mutex unico sul `Workspace`**: misurare prima di agire.
      `Mutex→RwLock` è quasi gratis (le firme separano già `&self`/`&mut self`);
      il pezzo vero è `reindex` non bloccante (snapshot) e il watcher che tiene
      il lock per l'intero lotto debounced. Nota: `render_view`/`view_action`
      prendono `&mut self` perché prestano un `HostApi` — vanno contati fra le
      scritture quando si sceglie dove passa la linea lettura/scrittura.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3 consapevole):
      rivalutare quando si progetta la superficie plugin di M5; il sidecar
      `.fubmd/workspace.json` autoritativo non è un semplice redirect su `data_*`.
- [ ] **"Tre copie" custodite da un flag TS**: adeguato con una sola superficie
      di editing; il merge esplicito di M3 è il momento in cui l'invariante del
      buffer sporco va irrobustito (ed eventualmente rappresentato fuori dal
      client).
- [~] **Ponte byte UTF-8 ↔ code unit UTF-16** (M3): gli `Span` sono in byte
      UTF-8, CodeMirror 6 in UTF-16. La direzione **byte→code unit** ora esiste
      (`frontend/src/offsets.ts`, `byteToCharIndex`), tirata avanti dallo scroll
      dell'outline e verificata su testo accentato+emoji. Restano per M3 la
      direzione inversa (code unit→byte, per mappare le selezioni dell'editor) e
      soprattutto un **test cablato in CI**: la verifica di `offsets.ts` oggi è
      stata fatta a mano (manca ancora l'harness frontend, §3), e le decorazioni
      della live-preview non vanno cablate prima che quel test esista.
- [ ] Cosmetico: chi ha già aperto un vault con una versione precedente si
      ritrova `.fubmd-data/index/` orfana (l'indice si è spostato nello spazio
      dati del plugin). È stato derivato e si può cancellare a mano; non vale una
      migrazione.
