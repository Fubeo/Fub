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
costosissime dopo; (§2) il protocollo `ViewProvider` da esercitare davvero;
(§3) i tre rilievi nuovi di questo giro; (§4) il debito già dichiarato, che ha un
milestone suo.

Nota di framing (non un TODO): non c'è "un trait unico" — sono **sette** trait
più la capability `HostApi`. La cosa singola è il *crate-contratto*
`fubmd-abi`. Dove i documenti o gli appunti dicono "trait unico", intendono
questo.

## 1. Decisioni che il freeze di M4 deve chiudere — costose dopo, gratis prima

Sono decisioni sulla **forma delle firme da congelare**, non righe di codice. Vanno
prese *insieme*: rispondono tutte alla stessa domanda — "cosa vede un plugin del
vault". Aggiungerle dopo il freeze è un breaking-bump del contratto.

- [ ] **`host-api.query-index`**: oggi un `ViewProvider` con l'`HostApi`
      attuale non può ottenere i backlink — `IndexQuery::Backlinks` la serve
      `Workspace::query_index`, che è del kernel, non una capacità del contratto.
      Decidere la forma della capacità di interrogazione e aggiungerla a
      `HostApi` (e al WIT) prima del freeze.
- [ ] **Documento attivo visibile a una view**: un `ViewProvider` non sa *quale
      documento è aperto*. Serve un meccanismo — un evento che la view segue, o
      un'azione dall'host. Deciderlo col freeze, non dopo.
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

## 2. `ViewProvider`: varco cablato, protocollo ancora non esercitato

Il punto di enforcement (`validate_untrusted`) esiste e il routing passa dal
kernel, ma le implementazioni del trait sono ancora **zero**: i backlink passano
dalla funzione libera `build_backlinks_view` e il frontend gestisce l'azione
`open:` ad-hoc invece del giro `on_action` → `ViewUpdate`. Sbloccabile solo dopo
§1 (le due capacità mancanti sono esattamente ciò che impedisce un dogfooding
vero, non finto).

- [ ] Le view di M2 ancora da fare (outline, tag panel, graph-data) **nascono**
      come `ViewProvider` — il piano M2 già lo prevede; il vincolo è: non
      cablarle ad-hoc "per fare prima".
- [ ] Migrare i backlink a `ViewProvider` insieme alla prima delle nuove view,
      chiudendo il giro azione→`ViewUpdate` nel renderer generico — **dopo** che
      §1 ha dato a una view il modo di interrogare l'indice e di sapere qual è il
      documento aperto. Migrarli prima significherebbe farsi passare i dati
      dall'app: un dogfooding finto, peggio del non averlo migrato.

## 3. Rilievi nuovi di questo giro

- [ ] **Buco d'ordine nel test di conformità**: l'ordine dei casi di un variant è
      confrontato con l'ordine in cui il *test* li elenca, non con quello
      dell'enum Rust. Riordinare il WIT è rosso; riordinare l'enum Rust senza
      toccare il test resta verde — ma l'ordine dei casi **è il discriminante
      ABI**. Chiudere il buco prima del freeze: derivare l'ordine atteso
      dall'enum Rust, così un riordino diventa rosso da entrambi i lati.
- [ ] **Drift dei mirror TS↔Rust**: `UiNode`, `Event` (`KernelEvent`), `Span`,
      `VersionRef` sono rispecchiati **a mano** in TypeScript, senza un test che
      leghi i due lati; la stessa lacuna del test gemello di `pageName` (aperta
      dal secondo giro). Manca del tutto un harness di test frontend
      (`package.json` ha solo `vite` e `tsc`). Introdurlo, e con esso i test che
      confrontano i tipi TS con la forma dei tipi Rust — è il confine che oggi
      può divergere in silenzio.
- [ ] **UI di produzione = IPC bespoke, non `UiNode`**: oggi il canale core→UI
      reale è fatto di ~24 comandi `#[tauri::command]` che restituiscono tipi
      propri (`search`, `render_preview`, `render_embed`, versioning…), più il
      bridge eventi `fubmd://event`; solo `backlinks_view` restituisce un
      `UiNode`. È una scelta legittima (la graph view e `Html`/`WebView` restano
      superfici privilegiate, ammesso in `ui-protocol.md`), ma è un debito che
      **cresce**: ogni feature di M2/M3 nata come comando ad-hoc è retrofit in
      più il giorno in cui deve diventare superficie plugin. Vincolo: le nuove
      superfici *rivendicate dal dogfooding* nascono come `UiNode`/`ViewProvider`;
      ciò che resta bespoke va marcato esplicitamente come privilegiato, non
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
- [ ] **Ponte byte UTF-8 ↔ code unit UTF-16** (M3): gli `Span` sono in byte
      UTF-8, CodeMirror 6 in UTF-16; il ponte non esiste ancora (`offsets.rs`
      copre solo riga/colonna→byte). Va costruito e testato su testo multibyte
      **prima** di cablare le decorazioni della live-preview.
- [ ] Cosmetico: chi ha già aperto un vault con una versione precedente si
      ritrova `.fubmd-data/index/` orfana (l'indice si è spostato nello spazio
      dati del plugin). È stato derivato e si può cancellare a mano; non vale una
      migrazione.
