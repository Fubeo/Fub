# M4 — Hardening del contratto + WIT

Torna a [../PIANO.md](../PIANO.md) · segue [M3](M3-editor-fidelity.md) · precede
[M5](M5-wasm-runtime.md).

## Obiettivo

**Congelare** la superficie dei trait di `fubmd-abi` e certificarla esprimibile in
WIT, così che il runtime WASM di [M5](M5-wasm-runtime.md) sia un lavoro *meccanico*
e non una rincorsa a firme non serializzabili. Provare l'intero confine con un
**primo plugin nativo** che usa `Plugin`/`HostApi`.

## Contesto: il `wit/` è già vivo da M2

Decisione presa: `wit/fubmd/*.wit` **non** nasce a M4 — è mantenuto vivo fin da M2,
con un test di conformità abi↔WIT che gira ad ogni commit. Così la "regola d'oro"
(vedi [../architecture/traits.md](../architecture/traits.md)) è verificata in
continuazione, non asserita. M4 è il punto in cui quel WIT viene **congelato** e
promosso a contratto stabile.

Stato repo: la cartella `wit/fubmd/` esiste già (vuota); `plugins/README.md` prevede
componenti `wasm32-wasip2` compilati con `cargo component`.

## Design

### Freeze della superficie dei trait

- Revisione finale dei 7 trait e di tutti i tipi che ne attraversano le firme
  (tabella di esprimibilità in [../architecture/traits.md](../architecture/traits.md)).
- Da qui: **cambi additivi versionati**; le modifiche breaking richiedono un bump di
  versione del contratto. Documentare la policy di compatibilità.
- Consolidare le estensioni introdotte in corso d'opera: `PluginPermissions.vault_scope`
  (vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)), i
  nodi input di `UiNode` aggiunti a [M3](M3-editor-fidelity.md), e il modello dei
  **job** (`JobSpec`/`JobId`, `spawn_job`/`run_job`, `Event::JobDone`/`Overflow`)
  già nel contratto e nel `wit/` da M2. Prima del freeze va deciso se ai job
  serve un canale di **progresso** (streaming) o se `JobDone` basta.

### `wit/fubmd/*.wit` che rispecchia `fubmd-abi`

- File WIT organizzati per area: `model`, `format`, `ui`, `index`, `events`,
  `command`, `plugin`, `host-api`.
- Mapping secondo la tabella in [traits.md](../architecture/traits.md): record,
  variant, enum, `list<..>`, `result<_, error>`; i valori JSON liberi (`attrs`,
  `args`, storage) come `type json = string`.
- Il component world del plugin (import: `host-api`; export: i provider
  implementati) è definito qui.

### Test di conformità abi↔WIT

**È fatta** (vedi [todo.md](../todo.md), punti 1–2 del secondo giro, e
[wit/README.md](../../wit/README.md)): il test parsa `abi.wit` con `wit-parser` e
confronta nelle due direzioni — contratto morto incluso — **nomi e tipi**: campi
dei record in ordine, payload dei casi di variant, destinazioni degli alias,
firme complete delle funzioni, ed elisione di `host`. I tipi attesi non sono
scritti a mano: si deducono dai tipi Rust (`wit(&campo)` sul campo destrutturato,
`WitFn` sul puntatore a funzione, che è un cast del metodo del trait), quindi una
divergenza di forma **non compila** — la proprietà che si voleva da `wit-bindgen`
+ `From`/`Into`, senza generare codice. Ha il proprio test del test (quattordici
mutazioni) e gira in CI.

Resta a M4, sulla conformità:

- rivalutare se i valori JSON liberi (`attrs`, `args`, storage) restano
  `type json = string` al freeze (vedi "Punto di attenzione noto" in
  [traits.md](../architecture/traits.md));
- il tooling continua a vivere al confine, **mai** fra le dipendenze normali di
  `fubmd-abi`/`fubmd-kernel` (`wit-parser` è una dev-dependency, che l'invariante
  non tocca).

### Primo plugin nativo (`Plugin`/`HostApi`)

- Un plugin **nativo** (non WASM) che implementa `Plugin` + almeno un provider
  (candidato: un `CommandProvider` utile, es. "inserisci data", o un `ViewProvider`
  semplice), attivato tramite il percorso di
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md).
- Esercita: manifest, permessi (booleani + eventuale `vault_scope`), `activate`/
  `deactivate`, registrazione presso il registry, uso di `HostApi`.
- Il registry di M4 porta anche il **runner dei job**: un pool di thread che
  drena `Workspace::take_pending_jobs`, esegue `Plugin::run_job` fuori dal lock
  e riconsegna con `complete_job` (il giro `spawn_job` → `JobDone` è già
  implementato e testato nel kernel: `tests/rename_and_events.rs`). Il plugin
  nativo dovrebbe esercitare anche un job end-to-end.
- Valore: mette alla prova il confine **prima** di aggiungere WASM. Se `HostApi` è
  scomoda, si corregge qui (ultimo momento prima del freeze duro per M5).
- Un anticipo lo ha già dato il **versioning**, che è un `EventHandler` scritto
  con le sole capacità di un plugin: ha fatto emergere che l'`HostApi` non
  bastava a tenere uno store su disco né a sapere l'ora, e il contratto è stato
  allargato di conseguenza (`data_*`, `now_unix_millis`, `list_documents` —
  vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)).
  Resta da decidere **qui** la stessa domanda per `IndexProvider`, le cui firme
  non portano un host: `SearchIndex` scrive ancora con `std::fs`, e un indice di
  terzi a M5 non potrebbe.

## Checklist del freeze

Le decisioni "gratis prima, breaking dopo" del §1 di [todo.md](../todo.md), che
è l'elenco autorevole e per intero (§1.1–§1.13, tutte P0); qui stanno quelle che
hanno una **domanda aperta** e una risposta da mettere a verbale prima di
chiudere. Le prime sono **già chiuse** in corso d'opera (il costo era una riga
oggi, una migrazione domani); le altre restano al freeze.

**Chiuse prima del freeze:**

- **Semantica di consegna eventi**: gli eventi arrivano *dopo che la chiamata
  del provider è tornata*, mai dentro il suo frame (`in_provider_call` nel
  kernel; contratto documentato su `EventHandler`). Identica a ciò che il
  proxy WASM può onorare: un plugin che è insieme view e handler non rientra
  mai nella propria istanza.
- **`abi_version` nel `PluginManifest`** + regola scritta (`abi_compatible`):
  major diversa → rifiuto; minor del plugin ≤ minor dell'host → accetto.
- **`ViewUpdate::Custom { ns, payload }`**: il varco di estensione degli
  intenti, con degrado garbato ("la shell che non riconosce non fa nulla").
  L'enum si può dichiarare chiuso al freeze: gli intenti nuovi nascono nel
  varco e vengono promossi solo se universali.
- **Discovery e invalidazione delle view**: comando `list_views`, montaggio
  per `placement`, dichiarazione di interesse `ViewSpec.refresh: EventMask`
  esercitata dalle tre feature ufficiali.
- **u64 sull'IPC JSON**: gli u64 identità/impronta attraversano il terzo
  confine come **stringhe** (`fubmd_abi::ipc`); presidiato dalle fixture dei
  mirror TS (contratto e app).

**Da chiudere al freeze:**

- [x] **Il grafo nel contratto** — fatto col §1.6: `IndexQuery::Neighbors { doc,
      direction, depth, page }` risponde dal `LinkGraph`, e `NeighborRef` porta
      il `via` con cui si ricostruiscono gli archi oltre il primo passo. Il
      comando `graph_data` non è più superficie privilegiata: è il **primo
      cliente** della variante, e prende gli archi una nota alla volta come farà
      una vista a grafo di terzi.
- [x] **Import ed export nel contratto** — fatto col §1.7:
      `ImportProvider`/`ExportProvider` in `abi/transfer.rs`, con
      `MarkdownImport`/`MarkdownExport` come **primo cliente** vero attraverso
      il kernel. La decisione che il freeze avrebbe reso definitiva è la forma
      della sorgente: **byte, non path** (`ImportSource.bytes`,
      `ExportArtifact.bytes`), che è ciò per cui il capitolo 17 non chiede
      nessuna capacità filesystem e la sandbox di M5 non deve concedere niente.
      Con essa: `ImportMode::Preview` invece di un `MigrationPlan` gemello, e
      `HostApi::free_name` — una capacità in più nell'elenco del §1.4, trovata
      da un cliente vero. Restano aperti sopra questa firma il §1.12 (rollback e
      lotto), il §1.21 (l'import come lavoro lungo) e il §1.28 (il modello a un
      exporter).
- [ ] **Operazioni strutturali e parità plugin↔nativo**: rename,
      `create_note`, cestino sono kernel-owned e fuori da `HostApi` (scelta
      deliberata). Decidere se e quali esporre come capacità con permesso
      dedicato (`write_vault` non basta: un rename riscrive file di terzi).
- [ ] **`create_note` in una cartella**: oggi la nota senza nome nasce nella
      radice; se la creazione diventa capacità di plugin, la firma va decisa
      insieme al punto sopra (path completo vs cartella+nome).
- [ ] **Escape hatch `type json = string`**: confermare al freeze, uso per
      uso (frontmatter, `attrs`, args dei comandi, payload dei job, storage),
      che l'opacità è accettabile — o promuovere a record WIT tipati dove non
      lo è. Il costo di tenerla: nessun controllo di forma al confine; il
      costo di toglierla: il contratto esplode a ogni formato nuovo.
- [ ] **Canale progresso/streaming dei job**: decidere se `Event::JobDone`
      basta. Aggiungere un canale dopo è breaking; l'alternativa ponte è un
      `Event::Custom` con topic convenzionale (`<plugin>/job-progress`), che
      il varco già permette senza toccare il contratto — se basta quella, la
      decisione è "JobDone + convenzione documentata".
- [ ] **Contesto di una view: `active_document()` o `ViewContext`?**
      ([todo.md §1.9](../todo.md)) Oggi l'host serve **una** `Option<DocId>`, e
      con schede/split/finestre multiple (3.3, 4.1) ogni provider scritto contro
      quella firma diventa ambiguo. Nello stesso pacchetto: la **selezione**, che
      il contratto non ha modo di nominare — senza, slash command sul testo
      selezionato, commenti inline, annotazioni e "chat con la selezione" non
      potranno mai essere provider. Cambiare il tipo di ritorno dopo il freeze è
      una migrazione di ogni provider esistente.
- [ ] **Identità del documento: il path è per sempre la chiave?**
      ([todo.md §1.10](../todo.md)) FEATURES chiede uuid opzionale (2.2), stable
      note ID e redirect da note rinominate (7.1), Zettelkasten ID (8.3), mentre
      ogni firma prende `DocId` = path. O si dichiara che il path resta la chiave
      e i redirect sono una feature sopra (tabella di alias persistente), o si
      introduce ora un `DocRef` a due forme: la seconda strada, dopo, è una major.
- [ ] **Forma dell'errore al confine** ([todo.md §1.11](../todo.md)):
      `PluginError`/`KernelError` sono nel contratto e finiscono in `String` su
      tutti i comandi IPC. Decidere se l'errore porta **codice + parametri** —
      prerequisito della localizzazione (25.2, §1.8), delle notifiche (10.5) e
      dei retry delle automazioni (16.3). Un messaggio già composto non si
      traduce e non si discrimina: la shell oggi indovina.
- [ ] **Il lotto: serve una variante di evento?** ([todo.md §1.12](../todo.md))
      Il kernel muta un documento alla volta e ogni scrittura emette i suoi
      eventi: una rinomina con 200 backlink sono ~400 eventi e altrettanti giri
      della shell. Decidere se il contratto acquista un `BatchEnded { changed }`
      (che `ViewSpec.refresh` può dichiarare, e che fa ridisegnare **una** volta
      invece di N) o se il lotto resta un fatto interno del kernel. Additivo
      adesso, minor dopo.
- [ ] **Canale del rendering: solo HTML, o anche il modello?**
      ([todo.md §1.13](../todo.md)) `render_html` è puro per-documento e la shell
      riceve una `String`; nessun canale porta il `DocumentModel` al frontend.
      Sopra la stringa opaca stanno lazy loading, hover popover, scroll sync,
      rendering incrementale e sanitizzazione (6.1, 5.3), e la sintassi nuova
      nasce due volte (Rust + Lezer, §3.8). Decidere se l'HTML resta la
      fast-path e il modello con gli `Span` diventa il canale dell'interattivo.

## Trait/API coinvolti

- `Plugin`, `HostApi` (prima impl reale end-to-end).
- Tutti i trait, in sola lettura, per il freeze e il WIT.
- Registry del kernel: caricamento/attivazione plugin nativi.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| WIT **vivo da M2**, freeze a M4 | La regola d'oro diventa verificabile ad ogni commit, non un atto di fede a fine corsa. |
| Primo plugin **nativo** prima del WASM | Separa "il confine è giusto?" da "il runtime WASM funziona?"; M5 resta meccanico. |
| JSON libero come `string` in WIT | Preserva l'escape hatch (`attrs`/`args`/storage) senza esplodere il contratto. |
| Cambi additivi versionati post-freeze | Stabilità per i plugin di terzi senza bloccare l'evoluzione. |

## Criteri di accettazione

- `wit/fubmd/*.wit` copre l'intera superficie dei trait; il test di conformità
  abi↔WIT è verde e **rompe** su una divergenza introdotta ad arte.
- Il primo plugin nativo si attiva, registra i suoi provider, funziona end-to-end e
  rispetta i permessi (un accesso fuori `vault_scope` è negato con
  `PermissionDenied`).
- La superficie dei trait è dichiarata **congelata**; policy di versioning documentata.

## Piano di test

- **Conformità:** test abi↔WIT (fallimento indotto verificato).
- **Plugin nativo:** unit sul provider; e2e su attivazione/uso/disattivazione;
  test negativo sui permessi.
- **Regressione:** l'intera suite M1–M3 resta verde.
- `cargo test --workspace` + `cargo clippy` su tutti gli OS
  ([../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Scoperta tardiva di una firma non-WIT** → mitigata a monte dal `wit/` vivo di M2;
  a M4 dovrebbero restare solo rifiniture.
- **Freeze prematuro** → il plugin nativo è l'ultima prova d'uso reale prima di
  chiudere; eventuali correzioni entrano prima del freeze.
- **Mapping del JSON libero** → confermare che `string`/`json` regga i casi reali di
  `attrs` (callout M3) e `args` (comandi).
