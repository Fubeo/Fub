# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md). Questo documento sostituisce il piano di
aggiustamento del quarto audit (chiuso: §1–§4 fatti, il residuo è riportato qui
al §5) e cambia domanda. L'audit chiedeva *«dove il codice è sbagliato»*;
qui si chiede: **[FEATURES.md](FEATURES.md) elenca ~3000 voci — quali pezzi di
infrastruttura mancano perché quelle voci si possano costruire senza riscrivere
il kernel, il contratto e la shell ogni volta?**

Un secondo giro sulla stessa domanda ha aggiunto §§1.9–1.13, §§2.8–2.14, §3.8 e
§§4.6–4.7. La differenza fra i due gruppi: il primo elenca **pezzi che mancano**,
il secondo **forme sbagliate di pezzi che ci sono già** — e sono proprio quelle
che il freeze di M4 rende definitive, perché una firma esistente si cambia solo
con una migrazione.

Un terzo giro ha aggiunto §§1.14–1.20, §§2.15–2.17, §§3.9–3.11 e §4.8, ed è di
nuovo il secondo tipo: **enum chiusi troppo presto** (le superfici della UI, i
tipi di evento, le opzioni di parse), **primitive che non esistono** (modificare
un pezzo di documento invece di riscriverlo, annullare un'operazione) e
**cuciture che perdono** (il montaggio dentro un comando Tauri, il dialogo di
sistema importato da `main.ts`). Il criterio per distinguerle dalle voci dei
primi due giri: qui non manca una capacità, manca il *posto* dove una famiglia
intera di FEATURES potrebbe atterrare — e finché non c'è, ogni voce di quella
famiglia si ritaglia il proprio.

Un quarto giro ha aggiunto §§1.21–1.27, §§2.18–2.20, §3.12 e §4.9, ed è un tipo
ancora diverso: **varchi che il contratto dichiara aperti e che non reggono il
primo cliente vero**. Il job esiste ma non vede il vault; `Block::Custom` esiste
ma nessuno lo disegna; `IndexQuery::Custom` esiste ma il dispatch prova gli
indici a tentativi; `UiNode` è dichiarativo ma il renderer è uno `switch`
compilato dentro la shell; il `FormatProvider` si sostituisce ma non si estende.
Il criterio che le distingue dai tre giri precedenti: qui il posto c'è, ed è la
sua **forma** a non reggere — che è il caso peggiore dei quattro, perché un
varco che sembra aperto non lo si va a riguardare.

## Il criterio

FEATURES.md è impossibile da implementare a mano una voce alla volta. È
possibile solo se **la stragrande maggioranza di quelle voci è un provider** —
un `ViewProvider`, un `CommandProvider`, un `IndexProvider`, un
`FormatProvider`, un `EventHandler` — che si registra e sparisce dal kernel.
Ogni voce che oggi *non può* essere un provider diventa un comando Tauri
bespoke, un pannello cablato in `main.ts` e un ramo `if` nel kernel: è il debito
che il piano ha già dichiarato ("UI di produzione = IPC bespoke") e che con la
scala di FEATURES diventa il progetto stesso.

Quindi il lavoro infrastrutturale è di tre tipi, in quest'ordine di urgenza:

1. **Allargare il potere espressivo del contratto** — prima del freeze di M4,
   perché dopo ogni aggiunta è una migrazione (§1).
2. **Togliere al kernel le assunzioni che lo legano a "un vault markdown
   locale"** — storage, allegati, sessioni, concorrenza, durabilità (§2).
3. **Trasformare la shell da applicazione a piattaforma** — comandi, temi,
   sanitizzazione, notifiche, virtualizzazione (§3).

### Dove il contratto si strozza, capitolo per capitolo

| Famiglia FEATURES | Cosa serve | Cosa manca oggi |
|---|---|---|
| 4.2 slash/hotkey, 16.2 automazioni, 27.1 CLI, 20.1 comandi plugin | `CommandProvider` vivo | il trait esiste (`abi/traits.rs:179`) ma **nessuno lo registra**: `Workspace` non ha una tabella comandi |
| 8.2 proprietà, 11 database, 16.1 template, 19.3 form, 28 settings | `UiNode` con **input** | 8 varianti sole, tutte in sola lettura: nessun campo, select, checkbox, tabella, albero |
| 20.1 impostazioni plugin, 28 config/profili, D7 spegnibilità | store di configurazione + schema dichiarativo | interruttori a **variabili d'ambiente** (`app/lib.rs:66`, `:270`) |
| 13 allegati, 12 canvas, 11.4 CSV/JSON, 6.1 media | entry di vault che non sono documenti | `Vault::list_documents` filtra per estensione dei `FormatProvider` (`vault.rs:101`): un PNG **non esiste** |
| 18 sync, 23.1 cifratura at-rest, 26.3 PWA/OPFS, 3.1 vault read-only | astrazione sullo storage | `std::fs` diretto in `vault.rs` e in `workspace.rs` (storage plugin) |
| 10 task, 5.2 id di blocco, 7.1 link a blocco | modello con task e ancore stabili | `Block::List` non porta lo stato di spunta; nessun `^block-id` |
| 9.1 faceted/field search, 9.2 query engine, 8.4 collezioni | canale query su **proprietà** | `IndexQuery` ha full-text, backlink, outline, tag — niente frontmatter, niente archi del grafo |
| 17 import/export/migration (~120 voci) | trait `ImportProvider`/`ExportProvider` | non esistono: ogni formato sarebbe codice nell'app |
| 24.1 task manager, 22 AI, 14.2 clipper | lavoro in background reale | `take_pending_jobs` (`workspace.rs:1312`) **non ha chiamanti fuori dai test**: `spawn_job` in produzione non esegue nulla |
| 3.1 vault multipli, 3.3 finestre multiple, 26 piattaforme | sessioni multiple | `AppState` tiene **una** `Option<VaultSession>` (`app/lib.rs:39`) |
| 5.3 sicurezza markdown, 23 privacy | sanitizzazione e CSP in un punto | `ui.ts:63-67` fa `innerHTML` su `UiNode::Html`; nessun sanitizer, nessuna policy contenuti remoti |
| 25 accessibilità e localizzazione | tema a token + catalogo stringhe | stringhe italiane cablate **anche dentro i provider** (le view producono testo di UI) |
| 2.1 recovery/journaling, 24.2 affidabilità | scrittura durevole | `Vault::write` è `std::fs::write` (`vault.rs:146`): niente temp+rename, niente fsync |
| 3.3 split/finestre, 4.2-4.3 azioni sulla selezione, 13.3, 22.2 | contesto per-pane e **selezione** nel contratto | `HostApi::active_document()` è **una** `Option<DocId>` (`traits.rs:159`); la selezione non attraversa il confine |
| 7.2 bulk fix, 11.3 editing bulk, 16.3 undo, 17.3 rollback | scrittura **a lotti** | il kernel muta un documento alla volta: N scritture = N eventi (`workspace.rs:735`) |
| 3.2 cartelle, 8.2 metadata di cartella, 6.2 CSS per cartella | la cartella come cittadino del kernel | `metas` è una mappa piatta (`workspace.rs:163`): l'albero esiste solo in `organizer.ts` |
| 20.1 enable/disable, 20.2 hot reload, 24.2 safe mode | disattivare un provider | `register_*` fa solo `push`: `unregister` non esiste |
| 20.3 sandbox e permessi, 23.1 permessi file/rete | un punto di applicazione dei permessi | `PluginPermissions` non ha lettori; `KernelHost` porta solo un id (`workspace.rs:1485`) |
| 6.1 anteprima interattiva, 5.3 sanitizzazione | il **modello** al confine, non solo HTML | `render_preview` restituisce una `String`; nessun comando restituisce il `DocumentModel` |
| 24.2 error reporting, 25.2 localizzazione, 16.3 retry | errori tipizzati al confine | i 28 comandi restituiscono `Result<_, String>`: la shell indovina (`main.ts:856`) |
| 27.3 test utilities, 21.1 moduli Suite | un SDK usabile da fuori | `MemoryHost` è `#[cfg(test)]` dentro `fubmd-features` (`features/src/lib.rs:31`) |
| 2.2 config, 27.4 upgrade migration | versione di schema sui formati persistiti | ce l'ha il solo indice di ricerca (`search.rs:59`), che è **derivato** |
| 20.1 ribbon/status bar/menu/settings tab, 11-12 database e canvas, 7.3 grafo | superfici di UI oltre le sidebar | `ViewPlacement` ha **3 varianti** (`traits.rs:195`) e l'area principale non è nel contratto |
| 11.2 viste multiple, 8.3 viste salvate, 9.2 query embed, 3.3 split | view **istanziabili** con parametri | `views()` è un elenco statico e `view_owner` risolve per id (`workspace.rs:1196`) |
| 4.3, 7.2, 8.2, 10.1, 11.3, 16.1, 19.2, 22.2 | modificare **un pezzo** di documento | esiste solo `write_document(id, source)`: ogni modifica riscrive il file intero |
| 4.2 undo illimitato, 11.3, 16.3, 17.3 rollback, 3.3 undo toast | un proprietario dell'undo | vive solo in CodeMirror, su **un** `EditorView` riusato per tutte le note |
| 16.2 trigger, 18 sync, 19.2 collaborazione | origine e causalità sugli eventi | `DocumentChanged { id }` non dice chi ha scritto: la shell indovina (`main.ts:1360`) |
| 21.2 moduli Suite che si parlano, 24.1 vault grandi | abbonamento a grana fine | maschera su 8 `EventKind`; a `Event::Custom` ci si abbona **tutto o niente** |
| 5.2 (~50 estensioni), 6.2 per nota/cartella | opzioni di parse aperte | `ParseContext` sono **due booleani** (`format.rs:41`) |
| 12 canvas, 11.4 CSV/JSON, 13.2 PDF, 2.3 encoding | documenti non-testo | `parse(source: &str)` e `Vault::read -> String`: un formato binario non entra |
| 27.1 CLI, 27.2 API locale, 26.2-26.3 mobile/PWA, 27.4 e2e | un montaggio riusabile | il composition root è dentro `#[tauri::command] open_vault` (`app/lib.rs:109`) |
| 3.1 ignore, 3.2 nascosti, 9.1, 18.1, 23.2 esclusioni | politica di esclusione come dato | `IGNORED_DIRS` è una costante di compilazione (`vault.rs:20`) |
| 9.2 query builder/explain, 9.1 operatori e faccette | la query come AST nel contratto | `FullText { query: String }` va dritta al `QueryParser` di tantivy |
| 28 settings, 8.2 proprietà, 11.3 editing, 19.3 form | riconciliazione e **chiave** dei nodi | `mountView` fa `innerHTML = ""` a ogni ridisegno (`main.ts:1198`): un input perde il focus |
| 3.3 workspace salvabili, 8.3 viste salvate, 20.1 settings | tre stati distinti (settings/vista/layout) | nessuno dei tre ha un contenitore: `storage_*` è volatile e a chiave→valore |
| 17 import/export, 18 sync/backup, 22 AI e RAG, 19.4 publishing, 13.4 trascrizione | lavoro lungo che **vede** il vault | `Plugin::run_job` è senza `HostApi` (`abi/traits.rs:476`): l'input deve stare tutto nel payload |
| 5.2 (~50 estensioni), 20.1 markdown extensions, 27.3 custom blocks | innestare sintassi su un formato esistente | `FormatRegistry::by_ext` è estensione→**un** provider (`registry.rs:13`): si sostituisce, non si estende |
| 6.1 mermaid/math/chart, 5.2 callout personalizzati | un renderer per `Block::Custom` | è un `if custom_kind == "callout"` dentro il provider markdown (`render.rs:62`) |
| 21.1 API condivise, 21.2 moduli che si parlano, 20.1 dipendenze/conflitti | chiamate **tipizzate** fra plugin | solo `Event::Custom` (senza risposta) e `IndexQuery::Custom` |
| 9.2 query engine, 22.1 vettoriale, 8.2 proprietà, 11 database, 15.1 citazioni | routing delle query verso gli indici | `query_index` li prova **in ordine** finché uno non dice `BadArgs` (`workspace.rs:1064`) |
| 2.2 UUID, 8.3 Zettelkasten ID, 10.4 calendario, 25.2 collazione | caso, fuso orario, locale come capacità | l'`HostApi` ha `now_unix_millis` e nient'altro (`abi/traits.rs:131`) |
| 6.3 stampa/PDF, 19.4 pubblicazione, 6.2 CSS per nota, 5.3 sanitizzazione | opzioni di rendering | `RenderOptions` è **un** booleano (`abi/format.rs:62`), ed è argomento di `render_html` |
| 8.1 note recenti, 24.1 apertura rapida, 18.1 sync differenziale, 3.2 duplicati | mtime, dimensione, impronta per entry | `DocMeta` non li ha (`workspace.rs:125`) e `reindex` riparsa **tutto** (`:341`) |
| 27.1 CLI, 27.2 API locale, 26.2-26.3 mobile/PWA, 27.4 e2e | un pezzo riusabile più piccolo di "tutto" | `Workspace` è 1750 righe e ~20 campi dietro un lock solo |
| 20.1 UI di plugin, 21.1 moduli installabili separatamente | far entrare un renderer di terzi nella shell | `renderUiNode` è uno `switch` esaustivo compilato nel bundle (`ui.ts`) |
| 23.3 SBOM/licenze/CVE, 20.3 reproducible builds, dependency audit | tooling di supply chain | la CI non ha `cargo-deny` né generazione SBOM |

---

## 1. Contratto (`fubmd-abi`) — gratis ora, breaking dopo M4

Il freeze di M4 è la scadenza vera: ogni voce di questa sezione costa oggi un
campo e domani una migrazione di versione. Vanno decise **insieme**, perché sono
tutte risposte alla stessa domanda: *cosa può dire e fare un plugin?*

### 1.1 Comandi — il trait più importante che nessuno usa

- [ ] **Registro comandi nel `Workspace`**: `register_command_provider(id, trust,
      Box<dyn CommandProvider>)`, `commands()` e `invoke_command(id, args)` con
      la stessa disciplina delle view (`in_provider_call` alzato, dispatch
      differito, `Trust` per l'albero di ritorno).
- [ ] **Comandi sull'IPC**: `list_commands` / `invoke_command`, gemelli di
      `list_views` / `view_action`. Da qui in poi una feature nuova **non deve
      poter aggiungere un comando Tauri** (§4.2).
- [ ] **`CommandOutcome` sufficiente**: oggi ha solo `notify`. Servono almeno
      `ViewUpdate`-like (navigare, rivelare, cercare) e la richiesta di input —
      altrimenti "rinomina nota" da palette non può chiedere il nome nuovo.
- [ ] **Migrare a comandi le azioni già cablate nella shell** (crea/rinomina/
      cestina nota, apri ricerca, toggle pannelli): è il dogfooding che dice se
      la firma regge, e va fatto *prima* del freeze.

*Sblocca:* 4.2 (slash commands, scorciatoie), 16.2 (macro, catene, trigger),
20.1 (comandi/hotkey plugin), 27.1 (CLI: la CLI è un client dello stesso
registro), 3.3 (quick actions, command palette).

### 1.2 `UiNode` — senza input, metà di FEATURES non è dichiarativa

- [ ] **Nodi di input**: `TextInput`, `TextArea`, `Number`, `Checkbox`,
      `Select`, `Radio`, `Slider`, `DatePicker`, `Form { fields, submit }`. Con
      essi `UiAction` deve portare **valori** (oggi `payload` è JSON libero: va
      formalizzato lo stato del form).
- [ ] **Nodi strutturali**: `Table { columns, rows }`, `Tree`, `Tabs`,
      `Section/Collapsible`, `Badge`, `Icon`, `Progress`, `Separator`,
      `EmptyState`, `KeyValue`. Sono ciò che serve a database, task, dashboard,
      health check, diagnostica.
- [ ] **`UiNode::Custom { ns, payload, fallback }`**: la shell che conosce `ns`
      disegna il widget suo (grafo, canvas, chart), chi non lo conosce disegna
      il `fallback` dichiarativo. È il modo di far entrare le superfici
      privilegiate nel protocollo invece di tenerle fuori come oggi.
- [ ] **Feedback dell'host**: `ViewUpdate::Notify`, `ViewUpdate::Confirm`
      (o meglio: la conferma come capacità `HostApi`, §1.4) e
      `ViewUpdate::Patch { path, node }` per non ridisegnare tutto — un
      pannello task con 500 righe non può fare `Replace` a ogni spunta.
- [ ] **Regola di fiducia invariata**: `Html`/`WebView` restano riservati; i
      nodi nuovi devono essere tutti sicuri per costruzione (nessuna stringa
      interpretata come markup) e `validate_untrusted` va esteso ai figli nuovi
      con il suo test.

*Sblocca:* 28 (impostazioni), 8.2 (editor proprietà), 11.2-11.3 (viste e
editing database), 10.3 (viste task), 11.5 (dashboard/widget), 19.3 (form),
16.1 (prompt dei template), 24.2 (health/repair wizard).

### 1.3 Impostazioni e spegnibilità — oggi sono variabili d'ambiente

- [ ] **`SettingsProvider`** (o `PluginManifest.settings_schema`): il provider
      dichiara uno **schema** di impostazioni (chiave, tipo, default, etichetta,
      gruppo); la shell genera il form dai nodi del §1.2; i valori tornano al
      provider via `HostApi`.
- [ ] **Store di configurazione nel kernel**, su tre livelli con precedenza
      dichiarata: globale (cartella di configurazione utente) → vault
      (`.fubmd/settings.json`, autorevole, viaggia col vault) → profilo/portable.
      Oggi il livello globale **non esiste affatto**: non c'è dove tenere vault
      recenti, preferiti, tema, hotkey.
- [ ] **Interruttore di feature nel registry**: `FUBMD_VERSIONING` diventa una
      impostazione; "spento = non registrato" resta la semantica (D7), ma
      decisa a runtime e non da `std::env`.
- [ ] **Import/export/reset delle impostazioni** come comandi (§1.1), non come
      codice dell'app.

*Sblocca:* 28 per intero, 20.1 (impostazioni plugin), 3.1 (impostazioni per
vault), 1.1 (telemetria opt-in ha bisogno di un posto dove stare spenta).

### 1.4 `HostApi` — chiudere l'elenco delle capacità prima del freeze

Ogni capacità che manca qui è una feature che **non potrà mai essere un
plugin**. Da decidere una per una, con la risposta a verbale:

- [ ] **Operazioni strutturali** (`create_document`, `rename_document`,
      `delete_document`, `create_folder`): oggi kernel-owned e fuori dal
      contratto. Senza, nessun plugin può fare template, daily note, import,
      auto-archiviazione, cleanup wizard — cioè i capitoli 16, 17, 8.3, 7.2.
      Sotto permesso `write_vault`, con la validazione dei path già centralizzata
      in `valid_doc_id`.
- [ ] **Allegati/asset** (`read_asset`, `write_asset`, `list_assets`): §2.2 dà
      il modello, qui va il varco.
- [ ] **Notifiche e progresso** (`notify(level, message)`,
      `progress(job, done, total)`): 10.5 e 24.1 non esistono senza.
- [ ] **Invocare comandi** (`run_command`): è ciò che rende componibili macro e
      automazioni (16.2, 16.3) senza che ogni plugin conosca gli altri.
- [ ] **Tempo differito** (`schedule_at` / `schedule_every`): i trigger su
      orario/intervallo (16.2) e i promemoria (10.5) sono altrimenti impossibili
      dentro il giro sincrono.
- [ ] **Rete sotto permesso** (`http_fetch`, solo dentro un job): 14.2 clipper,
      15.1 DOI/Zotero, 22 AI cloud, 17.1 import da URL. Il permesso c'è già in
      `PluginPermissions.network` e non ha implementazione.
- [ ] **Log per-plugin** (`log(level, msg)`): 20.2 developer mode, 24.2
      diagnostica.
- [ ] Rivalutare `storage_*` volatile vs `data_*`: con le impostazioni (§1.3)
      il primo perde quasi ogni caso d'uso — decidere se sopravvive al freeze.

### 1.5 Modello del documento — le lacune che si vedono solo a valle

- [ ] **Task come cittadini di prima classe**: `Block::List` deve portare
      `checked: Option<bool>` per voce (e lo `Span` del marcatore). Oggi una
      task list è una lista di paragrafi: tutto il capitolo 10 (~90 voci)
      ricomincerebbe dal parsing.
- [ ] **Ancore stabili**: `^block-id` e id di heading nel modello
      (`Block::anchor: Option<String>`), con la regola di generazione nel
      contratto come `canonical_tag`. Servono a 7.1 (link a blocco), 5.2 (embed
      di blocchi), 13.3 (deep link ad annotazione), 18.3 (diff a blocchi).
- [ ] **Footnote, definition list, tabella** promosse da `Custom` a varianti (o
      decidere esplicitamente che restano `Custom` con `custom_kind` registrati
      e documentati — la decisione manca, non la variante).
- [ ] **`LinkTarget` per gli allegati**: oggi un'immagine è `Path`/`Url` e nulla
      distingue "risorsa del vault" da "url esterno" — 13.1 (riferimenti su
      rinomina, orfani, dedup) parte da qui.
- [ ] **Proprietà tipizzate**: il frontmatter è `serde_json::Map` piatto. 8.2
      chiede tipi (data, rating, relazione, formula): serve almeno un
      `PropertyValue` normalizzato nel contratto, o ogni consumatore
      reinventerà il parsing delle date.

### 1.6 `IndexQuery` — il canale dati verso le view

- [ ] **Grafo**: `IndexQuery::Neighbors { doc, direction, depth }` — il grafo è
      già nel kernel ma esce solo da un comando Tauri ad hoc (`graph_data`).
      Senza variante, il grafo resta per sempre superficie privilegiata (7.3).
- [ ] **Proprietà**: `IndexQuery::Properties { filter, sort, limit }` e
      `IndexQuery::PropertyValues { key }` — è la base di 9.1 (field-specific,
      faceted), 8.4 (collezioni), 11 (database su file), 16 (template con query).
- [ ] **Full-text con filtri**: la variante attuale prende solo `query: String`.
      Servono ambito (cartella, tag, tipo nota) e faccette, o il query engine
      nascerà fuori dal contratto.
- [ ] **Salute del vault**: link rotti, orfane, allegati inutilizzati — 7.2 ha
      ~30 voci che sono tutte interrogazioni sullo stesso grafo già in memoria.
- [ ] **Paginazione** in `IndexResult`: `Vec` nudi non reggono un vault grande
      (24.1).

### 1.7 Import/export come trait, non come codice dell'app

- [ ] **`ImportProvider`** (`can_handle(descriptor) -> bool`, `import(source,
      host) -> Result<ImportReport>`) e **`ExportProvider`**
      (`targets() -> Vec<ExportTarget>`, `export(selection, target, host)`).
- [ ] **`ImportReport`/`MigrationPlan`** nel contratto: 17.3 chiede preview,
      rollback, log, resume — se il primo importer li inventa per sé, il secondo
      li reinventa.
- [ ] Primo cliente: import/export Markdown (già banale) come prova della firma.

*Sblocca:* 17 (~120 voci), 6.3 (export PDF/Pandoc/Typst), 15.1 (BibTeX/CSL),
14.3 (email/EML), 11.4 (CSV/JSON).

### 1.8 Stringhe e localizzazione al confine — decisione, non implementazione

- [ ] **Decidere ora chi localizza**: oggi un `ViewProvider` restituisce
      `UiNode::Text { content: "Nessun backlink" }` — testo italiano cablato
      dentro il provider. Con la localizzazione (25.2) o i provider ricevono un
      `locale` e traducono, o restituiscono **chiavi** che la shell risolve. È
      una scelta di forma dei tipi: dopo il freeze si cambia solo con una minor.

### 1.9 Contesto di una view — `active_document()` non regge tab, split né selezione

- [ ] **Decidere la forma del contesto**: `HostApi::active_document() -> Option<DocId>`
      (`abi/traits.rs:159`) è servito da **una** `Option<DocId>` nel workspace
      (`workspace.rs:218`) e da **una** `currentDoc` nella shell (`main.ts:53`).
      Con schede, split e finestre multiple (3.3, 4.1) "il documento attivo"
      smette di essere una variabile globale, e ogni provider già scritto contro
      quella firma diventa ambiguo: *quale* dei due pannelli backlink?
      L'alternativa è un `ViewContext { pane, doc, selection, mode }` che la view
      chiede all'host — e va scelta ora, perché cambiare il tipo di ritorno di
      `active_document` dopo il freeze è una migrazione di ogni provider.
- [ ] **La selezione deve attraversare il confine**: oggi il contratto non ha
      modo di nominarla, quindi **nessuna** di queste può essere un provider —
      slash command sul testo selezionato (4.2), commenti e highlight inline
      (4.3), annotazioni (13.3), "chat con la selezione" (22.2), variabile
      `selection` dei template (16.1), "nota da selezione PDF" (13.2). Dipende
      dal ponte code unit → byte del §3.7: senza quello, uno `Span` di selezione
      non si sa nemmeno costruire.
- [ ] **Chi imposta il contesto resta la shell** (come oggi `set_active_document`),
      ma la chiave diventa il pane: senza, due split mostrano lo stesso backlink.

*Sblocca:* 3.3 (tab, split, finestre, note history per pane), 4.1 (modalità
per-nota e per-pane), 4.2-4.3 (azioni sulla selezione), 13.3, 22.2.

### 1.10 Identità del documento — il path, e l'eventuale seconda chiave

- [ ] **Mettere a verbale la scelta**: `DocId` è il path, ed è una decisione
      dichiarata (PIANO, "l'identità è il path"). Ma FEATURES chiede "UUID
      opzionale per nota" (2.2), "Stable note ID" e "Redirect da note rinominate"
      (7.1), "ID univoco nota" e Zettelkasten ID (8.3). Ogni firma del contratto
      prende `DocId`: o si dichiara che il path è **per sempre** la chiave e i
      redirect sono una feature sopra (tabella di alias persistente, come i
      tombstone del versioning), o si introduce ora un `DocRef` a due forme.
      Dopo il freeze la seconda strada è una major. Il §1.5 copre le ancore
      *dentro* il documento; questa è l'identità *del* documento.

### 1.11 Errori tipizzati al confine, non `String`

- [ ] **Un errore con codice e parametri**: i 28 comandi Tauri restituiscono
      `Result<_, String>` con la prosa italiana del kernel. Il costo è già
      visibile: `restoreFromTrash` (`main.ts:856`) intercetta **qualunque**
      errore e assume "path di nuovo occupato", quindi un errore di I/O o di
      permessi produce all'utente la domanda sbagliata.
- [ ] **`PluginError`/`KernelError` sono nel contratto**, quindi la forma scade
      col freeze; ed è il gemello della decisione del §1.8 — chi localizza le
      stringhe localizza anche gli errori, e un messaggio già composto non si
      traduce.

*Sblocca:* 24.2 (error reporting chiaro, repair), 10.5 (alert e notifiche),
16.3 (automation error handling, retry), 25.2.

### 1.12 Il lotto — il kernel muta **un documento alla volta**

- [ ] **`Workspace::batch(|tx| …)` con un evento terminale**: il caso reale c'è
      già. `rename_document` scrive N sorgenti e ognuna emette `DocumentChanged`
      + `IndexUpdated` drenando la coda (`workspace.rs:735`); sul confine una
      rinomina con 200 backlink sono ~400 eventi, e la shell reagisce a
      **ciascun** `index_updated` con un `list_documents` più il ridisegno di
      ogni view iscritta (`main.ts:1299`). Non è un problema di UI: è che il
      kernel non ha modo di dire "queste N scritture sono una cosa sola".
- [ ] **Semantica di annullamento**: `rename_document` applica tutto il piano
      anche se una sorgente fallisce — scelta dichiarata e giusta *per il
      rename*. Per import, bulk fix e migrazioni serve quella opposta, ed è il
      punto in cui il journal del §2.5 diventa il meccanismo e non un extra.
- [ ] **Variante di evento nel contratto** (`BatchEnded { changed }` o
      equivalente): è ciò che permette a una view di ridisegnarsi **una volta**
      invece di N, e a `ViewSpec.refresh` di dichiararlo. Additivo: costa oggi
      una variante, dopo il freeze una minor.

*Sblocca:* 7.2 (bulk fix, cleanup wizard, ~30 voci), 11.3 (editing bulk, undo
database), 16.3 (undo delle automazioni), 17.3 (rollback, resume), 24.1.

### 1.13 Il canale del rendering — stringa HTML o modello?

- [ ] **Decidere se il modello arriva alla shell**: `render_preview` restituisce
      una `String` che il frontend innesta con `innerHTML` (`main.ts:1008`), e
      **nessun comando restituisce un `DocumentModel`** — il modello parsato dal
      Rust non attraversa mai il confine. Sopra quella stringa opaca il capitolo
      6.1 vuole lazy loading, lightbox, hover popover, scroll sync
      editor↔anteprima, copy button, rendering incrementale, mermaid/math
      sicuri; il 5.3 vuole sanitizzazione.
- [ ] L'alternativa da mettere a verbale: `render_html` resta la **fast-path**
      per la lettura, e il modello con gli `Span` diventa il canale di ciò che è
      interattivo. È la stessa decisione del §3.8 (due parser) vista dal lato del
      contratto: finché il modello non ha un canale, il secondo livello di
      decorazione del §3.7 resta un'intenzione.

### 1.14 Le superfici della UI sono tre, e chiuse

- [ ] **`ViewPlacement` deve smettere di essere un enum a tre casi**:
      `LeftSidebar`, `RightSidebar`, `Bottom` (`abi/traits.rs:195`) sono tutto
      ciò che un provider può occupare. Il capitolo 20.1 chiede alla lettera
      *ribbon*, *status bar*, *settings tab*, *menu* e *context menu* di
      plugin: cinque superfici che oggi non hanno nome nel contratto, quindi
      cinque cose che una feature ufficiale può cablare nella shell e un plugin
      no.
- [ ] **L'area principale non esiste nel contratto**: l'editor è cablato in
      `main.ts` e nessun provider può prendersi quello spazio. È lì che vivono
      database (11), canvas e slide (12), grafo (7.3), viste task (10.3),
      dashboard (11.5), calendario (10.4) — cioè i capitoli più grossi di
      FEATURES. La prova che il buco è reale è già in repo: il grafo è uscito
      con un comando bespoke (`graph_data`, `app/lib.rs:642`) e un renderer
      privato (`graph.ts`). Non perché il grafo sia speciale — perché **non
      c'era un posto dove metterlo**. Con tre placement, ogni capitolo grande
      ripete quella scappatoia.
- [ ] **Superficie ≠ disegno**: allargare `ViewPlacement` (o sostituirlo con un
      `ViewSurface` che nomini area principale, modale, status bar, ribbon,
      menu contestuale, scheda di impostazioni) è ciò che dà l'**ancoraggio**;
      cosa ci si disegni dentro è il `UiNode::Custom` del §1.2. Le due voci
      vanno decise insieme, o si ottiene metà del varco.

*Sblocca:* 20.1 per intero, 11 (database), 12 (canvas, diagrammi,
presentazioni), 7.3 (il grafo smette di essere privilegiato), 10.3-10.4, 11.5,
28 (le impostazioni come scheda, non come finestra dell'app).

### 1.15 Le view non si istanziano

- [ ] **`ViewSpec` con parametri e identità d'istanza**: `views()` restituisce
      un elenco **statico** e `view_owner` risolve per id esatto
      (`workspace.rs:1196`). Non c'è modo di dire "questa view, con questo
      parametro". Servono a 11.2 (viste multiple per database), 8.3 (viste
      salvate, smart folder), 9.2 (query embed, query salvate, parametriche),
      11.5 (una dashboard per progetto), 12 (un canvas per file), 10.3 (task
      per tag / per cartella / per data: la stessa view, filtri diversi).
- [ ] **È l'altra metà del §1.9**: quello risolve *quale documento* guarda una
      view, questo *quale istanza* è. Due split con due pannelli backlink hanno
      bisogno di entrambe le risposte, e oggi non ne hanno nessuna.
- [ ] Firma da decidere ora: `render_view(view, instance, host)` +
      `open_view(spec, params)` come esito di comando (§1.1). Dopo il freeze è
      una migrazione di **ogni** `ViewProvider` scritto nel frattempo.

### 1.16 Modificare un pezzo di documento — la primitiva che non c'è

- [ ] **`HostApi::write_document(id, source)` è l'unico modo di cambiare un
      documento**, nel contratto, nel kernel (`workspace.rs:406`) e sull'IPC:
      non esiste `apply_edit(doc, [(span, testo)])` da nessuna parte. Ogni
      modifica riscrive il file intero.
- [ ] **Il costo è già visibile**: una scrittura del kernel torna alla shell
      come testo nuovo e `setDoc` sostituisce tutto il documento
      (`editor.ts:74`) — cursore, selezione e cronologia di undo saltano;
      `reloadIfClean` e il confronto `editor.getDoc() !== source`
      (`main.ts:1360`) esistono per limitare i danni, non per risolverli.
- [ ] **Ora moltiplicalo**: 4.3 (commenti e highlight inline), 7.2 (fix
      automatico dei link rotti, bulk fix), 8.2 (scrivere una proprietà), 10.1
      (spuntare un task), 11.3 (editing inline), 16.1 (template con cursor
      placement), 19.2 (suggestions, track changes), 22.2 (riscrittura AI della
      selezione), 18.1 (merge, CRDT). Tutte riscriverebbero il file intero, con
      la stessa perdita, e **nessuna potrebbe comporsi con un'altra**.
- [ ] **La firma deve dire su cosa si applica**: una lista di `(Span, String)`
      più il riferimento alla revisione su cui è stata calcolata, o due edit
      concorrenti (un'automazione e l'utente che scrive) si sovrascrivono in
      silenzio. È la stessa primitiva su cui poggiano §1.12 (il lotto è una
      lista di edit), §1.9 (la selezione è uno `Span`) e §1.17 (l'inverso di un
      edit è un edit).

### 1.17 L'undo non ha un proprietario

- [ ] **Oggi l'undo vive solo dentro CodeMirror**, su un **unico** `EditorView`
      riusato per tutte le note (`editor.ts:50`): dopo un cambio nota un Ctrl-Z
      riporta il contenuto della nota *precedente*. È un bug, ma il bug è il
      sintomo: non c'è un modello di undo, c'è l'undo di una libreria.
- [ ] **Nessuna mutazione del kernel è annullabile**: rename con riscrittura di
      N sorgenti (`workspace.rs:696`), ripristino di versione, e domani bulk
      fix, automazioni, import. FEATURES lo chiede in cinque punti: 4.2 (undo
      illimitato, cronologia per sessione), 3.3 (undo toast), 11.3 (undo
      database), 16.3 (undo delle automazioni), 17.3 (rollback dell'import).
- [ ] **Decidere i due livelli e chi vince dove**: undo del *testo* nell'editor
      (per-documento, e per-pane col §1.9) e undo delle *operazioni* nel kernel
      (il journal del §2.5 come meccanismo, l'inverso dichiarato dal lotto del
      §1.12). È di forma: senza la decisione, `CommandOutcome` e il lotto
      nascono privi del campo con cui un'operazione dichiara di essere
      annullabile.

### 1.18 Gli eventi non dicono chi li ha causati

- [ ] **`Event::DocumentChanged { id }` non porta origine né causalità**
      (`abi/event.rs:17`). La shell già ci gira intorno: confronta il testo per
      non resettare il cursore sull'eco del proprio salvataggio
      (`main.ts:1360`).
- [ ] **Con i trigger diventa un requisito**: 16.2 chiede trigger su creazione,
      modifica, salvataggio, tag aggiunto, proprietà cambiata, task completato;
      18 il sync; 19.2 la collaborazione. Un'automazione su-modifica che scrive
      si richiama da sola, e l'unica difesa oggi è il `DISPATCH_BUDGET` che
      tronca (`workspace.rs:100`) — una rete di sicurezza, non una semantica.
- [ ] **Un campo `origin` (utente, watcher, plugin `id`, kernel) e l'id di
      lotto del §1.12**: costano un campo adesso, e sono ciò che permette a un
      handler di dire "questa l'ho scritta io, non reagisco" senza tenere una
      contabilità privata.

### 1.19 L'abbonamento agli eventi non filtra

- [ ] **La maschera è un `Vec<EventKind>` su 8 varianti**, e a
      [`Event::Custom`] ci si abbona a grana `EventKind::Custom`
      (`abi/event.rs:42`, consegna in `workspace.rs:1288`): con i moduli
      FubSuite che si parlano fra loro (21.2), ogni handler si sveglia per
      **ogni** custom di **ogni** plugin.
- [ ] **Manca la grana del soggetto**: nessuno può abbonarsi a "i cambiamenti
      di questa cartella" o "di questo documento", quindi l'evento più caldo
      (`DocumentChanged`) sveglia tutti, N feature × M documenti. Prefisso di
      topic per i custom e filtro per documento/cartella per gli altri: la
      forma della maschera è contratto, e va allargata prima che le famiglie di
      provider si moltiplichino.

### 1.20 `ParseContext` è chiuso, e `parse` vuole per forza del testo

- [ ] **Due booleani** (`parse_tags`, `parse_wikilinks`, `format.rs:41`) contro
      le ~50 estensioni sintattiche del capitolo 5.2 — callout, footnote,
      definition list, math, mermaid, apici/pedici, tabs, timeline — ognuna
      accendibile per vault (28) o per nota (6.2, classi da frontmatter). Con
      questa forma ogni estensione è un campo nuovo nel contratto: una minor a
      testa. Da decidere ora se porta una mappa di opzioni con namespace, come
      `IndexQuery::Custom`.
- [ ] **`parse(source: &str)` e `Vault::read -> String` escludono i documenti
      non-testo**: un `.canvas`, un CSV grande, un PDF trattato come documento
      (12, 11.4, 13.2) o un file con encoding da rilevare (2.3) non entrano. Il
      §2.2 dà `VaultEntry`/asset lato kernel; questo è il varco nel
      **contratto**, e `FormatProvider` è una firma che M4 congela.

### 1.21 Il lavoro lungo non vede il vault

- [ ] **`Plugin::run_job` è deliberatamente senza `HostApi`** — «input nel
      `payload`, output nel risultato» (`abi/traits.rs:476-483`). Per un
      calcolo puro è la firma giusta. Ma l'unico modo di dare input a un job
      diventa che il **chiamante** legga il vault dentro il giro sincrono:
      cioè faccia lì, in esclusiva sul workspace, esattamente il lavoro che il
      job doveva togliere da lì.
- [ ] **Il conto di ciò che con questa firma non è esprimibile**: import ed
      export (17, ~120 voci), embedding e RAG locale (22.1-22.3), sync (18.1),
      backup e snapshot (18.2), sito statico (19.4), OCR e trascrizione (13.4),
      health check e diagnostic bundle (24.2), reindicizzazione (24.1). Tutte
      camminano il vault, e quasi tutte ci scrivono.
- [ ] **Il §1.4 ci sta già costruendo sopra**: `http_fetch` «solo dentro un
      job». Ma un web clipper (14.2) fa fetch *e* scrive una nota *e* scarica
      gli allegati: con la firma attuale la sola parte che può stare nel job è
      la fetch, e il resto torna nel giro sincrono. Idem per «import da URL»
      (17.1) e per i modelli scaricabili (22.3).
- [ ] **Le due strade, da scegliere ora**: un `JobHost` in **sola lettura** su
      uno snapshot coerente del vault, oppure scritture differite al `JobDone`
      con una semantica dichiarata di cosa succede se il vault è cambiato nel
      frattempo. La seconda domanda è la stessa del §1.16 (l'edit calcolato su
      una revisione), e va risolta una volta per entrambi. È forma di firma di
      un trait: dopo il freeze si cambia con una major.

*Sblocca:* 17 per intero, 18.1-18.2, 19.4, 22, 13.4, 14.2, 24.1-24.2, e il
runner dei job del §2.3, che oggi eseguirebbe soltanto funzioni pure.

### 1.22 Il parser è sostituibile, non estendibile

- [ ] **`FormatRegistry::by_ext` è una mappa estensione → *un* indice**
      (`kernel/registry.rs:13`) e `register` fa `insert`: chi registra dopo
      **vince in silenzio** (`:22-28`). Non esiste alcun modo di innestare una
      regola sintattica su un provider esistente — si può solo rimpiazzarlo.
- [ ] **Quindi un'estensione di sintassi non può essere un plugin**, ed è
      l'unico punto in cui l'invariante del progetto — «una feature ufficiale è
      ciò che scriverà un plugin di terzi» — è **già falsa oggi**. Le ~50
      estensioni del 5.2 (callout, footnote, definition list, math, mermaid,
      apici/pedici, tabs, timeline, stepper…), «Plugin markdown extensions»
      (20.1) e «Custom markdown blocks» (27.3) richiedono un fork di
      `fubmd-format-markdown`.
- [ ] **Serve una firma per l'innesto** (`SyntaxExtension`/`BlockRule`
      registrata contro un `FormatDescriptor`, con l'ordine di applicazione
      dichiarato) e la regola dei conflitti: due estensioni che rivendicano la
      stessa sintassi oggi non hanno nemmeno un posto dove collidere.
- [ ] **È l'altra metà del §1.20**: quello apre le *opzioni* di parse
      (`ParseContext` chiuso), questo dice **chi aggiunge la sintassi**. Vanno
      decise insieme, o si ottiene un `ParseContext` aperto che nessun terzo
      può popolare.

### 1.23 `Block::Custom` non ha un renderer

- [ ] **L'escape hatch del modello esiste, il suo disegno no.** Il rendering di
      un blocco custom è `if custom_kind == "callout"` dentro il provider
      markdown (`format-markdown/src/render.rs:62-67`): un `custom_kind` che
      quel provider non conosce **non produce nulla**, in silenzio.
- [ ] **La famiglia è grande e ha tutta la stessa forma** — un blocco che il
      core sa delimitare e non sa disegnare: mermaid, PlantUML, Graphviz, D2,
      math, chart, embed di database e di query, tabs, accordion, timeline,
      stepper, file tree (6.1 e 5.2), più «Plugin custom renderers» (20.1).
- [ ] **Serve un punto d'innesto per `custom_kind`**, registrato come gli altri
      provider, e va deciso **insieme al §1.13**: se il modello arriva alla
      shell, una parte di questi si disegna di là (con gli `Span`, quindi
      interattiva); se resta la stringa HTML, si disegnano tutti di qua, e
      allora il §3.4 (sanitizzazione) deve coprire anche loro.

### 1.24 I plugin non hanno un canale per parlarsi

- [ ] **Gli unici canali fra provider sono `Event::Custom`** — fire-and-forget,
      senza risposta — **e `IndexQuery::Custom`**, che è il canale *indice* e
      passa dal dispatch a tentativi del §2.18. Non esiste una **chiamata**: A
      non può chiedere qualcosa a B e ricevere un risultato.
- [ ] **Il capitolo 21 lo dà per scontato a ogni riga**: 21.1 promette «plugin
      Suite con API condivise»; 21.2 ha FubCharts che disegna dati di FubDB,
      FubForms che scrive in FubDB, FubCalendar che legge da FubTasks,
      FubFlashcards che legge blocchi di note. Il 20.1 chiede «dipendenze
      plugin» e «conflitti plugin», il 20.3 «conflict detection».
- [ ] **Serve la terna, e va decisa insieme**: `provides`/`requires` nel
      `PluginManifest` (che oggi ha id, nome, versione, abi, permessi —
      `abi/traits.rs:426-441`); un `HostApi::call_service(ns, method, args)`
      sotto permesso; e l'**ordine di attivazione** che ne discende, con la
      semantica dichiarata del requisito mancante (il dipendente si disattiva?
      si attiva degradato?). Il §2.3 nomina il registry come tabella di
      montaggio: qui diventa anche un risolutore di dipendenze.
- [ ] Senza, i moduli Suite non saranno plugin: saranno crate linkati che si
      vedono a compile time — cioè il contrario del §4.7.

*Sblocca:* 21.1-21.2 (i moduli Suite come plugin veri), 20.1 (dipendenze,
conflitti, lifecycle), 11 (colonne e funzioni di query di terzi), 27.2 (API
plugin), 16.2 (automazioni che compongono feature diverse).

### 1.25 Caso, tempo civile e locale — le capacità che il dogfooding non ha ancora toccato

Il versioning ha trovato `now_unix_millis` con l'argomento giusto: sotto sandbox
un componente non ha orologio, e uno che chiamasse `SystemTime::now` sarebbe non
testabile e non funzionante (`abi/traits.rs:125-131`). Lo stesso argomento, non
applicato, lascia fuori tre cose:

- [ ] **Il caso e gli UUID**: «UUID opzionale per nota» (2.2), Zettelkasten ID e
      «ID univoco nota» (8.3), id di blocco (5.2, e il §1.5), «ID univoco
      annotazione» (13.3). Sotto WASI il caso non c'è di default: è
      letteralmente lo stesso buco dell'orologio, un metodo più in là.
- [ ] **Il tempo civile e il fuso**: `now_unix_millis` dà millisecondi UTC. Note
      periodiche e naming automatico (8.3), calendario con «first day of week»,
      «regional holidays» e «workweek localization» (10.4), promemoria relativi
      e ricorrenze (10.5, 10.1), «ricerca per date assolute e relative» (9.1)
      hanno bisogno del fuso e del calendario **dell'utente**, che un
      componente non può dedurre e che un plugin non deve indovinare.
- [ ] **Il locale**: è il gemello della decisione del §1.8. Qualunque risposta
      si dia sulle stringhe di UI, un provider ne ha comunque bisogno per
      l'ordinamento e la collazione («locale-aware sorting/collation», 25.2) e
      per formattare numeri, date, valute e unità.

### 1.26 Gli altri enum chiusi — e l'unico che rompe una firma

Il §1.14 ha visto il caso più grosso (`ViewPlacement`). La stessa forma si
ripete su quattro tipi del contratto, e uno dei quattro **non è additivo**:

- [ ] **`RenderOptions` è un booleano** (`abi/format.rs:61-66`) ed è
      **argomento di `FormatProvider::render_html`**: allargarlo dopo il freeze
      rompe la firma di ogni provider, non aggiunge un campo. Ma il rendering
      ha almeno tre bersagli distinti — schermo/lettura, stampa e PDF (6.3),
      pubblicazione statica (19.4) — più tema, livello di sanitizzazione (5.3),
      risoluzione degli asset (13.1) e CSS per nota/cartella/tipo (6.2). È la
      più urgente delle quattro voci di questa sezione.
- [ ] **`FormatCapabilities` sono 5 booleani** (`abi/format.rs:30-37`) contro le
      ~50 sintassi del 5.2: stessa forma del `ParseContext` del §1.20 e stessa
      risposta (una mappa di capacità con namespace), da decidere con lui e con
      il §1.22.
- [ ] **`Trust` ha due varianti** (`kernel/workspace.rs:86-94`) mentre 20.2 e
      20.3 chiedono verificato, community, locale in sviluppo, revocato — e il
      §2.10 nota già che si applica alle sole view.
- [ ] **`PluginPermissions` sono tre booleani** (`abi/traits.rs:414-419`) contro
      clipboard, camera/microfono, filesystem esterno e rete con allowlist
      (20.1, 23.1, 20.3 «network allowlist», «file allowlist»).

### 1.27 `list_documents` e `views()` — le metà nel contratto di §2.13 e §1.15

Due voci già nel piano hanno una metà **dentro** il contratto, e quella metà
scade col freeze mentre l'altra no:

- [ ] **`HostApi::list_documents() -> Vec<DocId>`** (`abi/traits.rs:93`) è il
      §2.13 visto dal contratto: clona **tutto** il vault a ogni chiamata, e
      `Workspace::documents` lo riordina ogni volta
      (`kernel/workspace.rs:380-384`). È il metodo con cui un provider si
      guarda intorno — il versioning lo chiama a ogni riconciliazione, e ogni
      feature che riparte da `VaultOpened` lo chiamerà. La paginazione del §1.6
      va decisa **anche qui**, non solo sull'IPC.
- [ ] **`ViewProvider::views()` è interrogato a ogni giro**: `view_owner` chiama
      `p.views()` su *ogni* provider registrato per risolvere un id
      (`kernel/workspace.rs:1196-1201`), e ogni chiamata rialloca l'elenco. È
      il gemello del §1.15: con le view istanziabili questa risoluzione
      lineare-e-riallocante diventa il percorso caldo di ogni render. La
      domanda di forma: le spec sono **dato di registrazione** (il kernel le
      tiene, il provider le invalida) o restano una chiamata al provider?

---

## 2. Kernel — da "un vault markdown locale" a piattaforma

### 2.1 Astrazione sullo storage

- [ ] **`trait VaultStorage`** (list, read, write atomico, rename, remove, stat,
      exists) con impl `FsStorage` di default; `Vault` e lo storage dei plugin
      (`workspace.rs:1530-1560`) ci passano sopra invece di chiamare `std::fs`.
- [ ] Impl `MemStorage` per i test (oggi ogni test e2e tocca il disco).

*Sblocca, in un colpo solo:* 23.1 (cifratura at-rest = uno storage che cifra),
18.1 (vault remoti/sync), 26.3 (PWA su OPFS), 3.1 (vault read-only, vault su
network share), 2.3 (drive rimovibili), e i test veloci.

### 2.2 Il vault non è solo documenti

- [ ] **`VaultEntry { id, kind: Document | Asset | Unknown, size, mtime }`** e
      una scansione che vede **tutti** i file, non solo le estensioni dei
      provider registrati. Oggi un PNG nel vault semplicemente non esiste per
      FubMD.
- [ ] **Metadata degli asset**: MIME, hash/checksum, dimensione — con il
      checksum arrivano gratis dedup (13.1), rilevamento duplicati (3.2) e
      verifica d'integrità (24.2).
- [ ] **Politica cartella allegati** (configurabile, §1.3) e riferimenti
      aggiornati su rinomina/spostamento, come già si fa per i wikilink.
- [ ] **Thumbnail/cache derivate** in `.fubmd-data/` (mai autorevoli).

### 2.3 Registry di plugin/feature e runner dei job

- [ ] **Una tabella di montaggio unica**: oggi le feature sono cablate a mano in
      `open_vault` (`app/lib.rs:128-178`). Serve un registry che, dato un
      manifest, attivi/disattivi un bundle (`Plugin` + i suoi provider), assegni
      lo spazio dati, applichi `Trust` e `abi_compatible`. È il pezzo che a M5
      il caricatore WASM riuserà tale e quale.
- [ ] **Runner dei job**: un pool che draina `take_pending_jobs`, esegue
      `run_job` fuori dal lock e riconsegna con `complete_job`. Esiste il giro,
      esiste il test, **non esiste il chiamante in produzione**: oggi
      `spawn_job` accoda e basta.
- [ ] **Namespace per-plugin sullo `storage_*`** ora che il registry esiste
      (era rimandato "a quando ci sarà il registry").
- [ ] **Safe mode / isolamento**: un provider che pania non deve portarsi via il
      vault (`catch_unwind` al confine, disattivazione con avviso) — 24.2, 20.3.

### 2.4 Concorrenza

- [ ] **`RwLock` sul `Workspace`** con `render_view`/`query_index`/`render_*` in
      prestito condiviso (il percorso `&self` è già stato preparato). Misurare
      prima, ma il carico è già identificato: le letture sono le view.
- [ ] **Lavoro lungo fuori dal lock**: reindicizzazione, scansione iniziale,
      import, export, embedding — con eventi di progresso (§1.4) e un centro
      attività (§3.5).
- [ ] **Cancellazione**: un job che non si può fermare è un job che blocca la
      chiusura dell'app.

### 2.5 Durabilità e recovery

- [ ] **Scrittura atomica vera**: `Vault::write` è `std::fs::write`
      (`vault.rs:146`) — un crash a metà lascia un file troncato. Serve
      temp+rename+fsync sulla directory. (Il test `write_atomicity` presidia
      un'altra cosa: l'ordine parse→scrittura.)
- [ ] **Buffer di crash / autosave recovery**: il buffer sporco dell'editor deve
      sopravvivere a un crash (2.1, 24.2).
- [ ] **Journal delle mutazioni** (append-only in `.fubmd-data/`): base di
      rollback dell'import (17.3), undo delle automazioni (16.3), audit (23.3).
- [ ] **Comandi di manutenzione**: `rebuild_index`, `vault_health`,
      `diagnostic_bundle`, `repair` — come `CommandProvider` (§1.1), non come
      comandi Tauri.

### 2.6 Politica dei path e del testo, in un modulo solo

- [ ] **`path_policy`**: normalizzazione NFC (già fatta per i link, va estesa ai
      nomi), caratteri invalidi per OS, nomi riservati Windows (`CON`, `NUL`…),
      lunghezza massima, case-sensitivity, symlink, file nascosti. Sono ~15 voci
      di 2.3 che oggi non hanno un posto dove stare.
- [ ] **`text_policy`**: rilevamento encoding, BOM, CRLF/LF, enforcement UTF-8 —
      e un corpus di file ostili come test, sul modello di
      `docid_page_name_agrees_with_the_frontend_on_hostile_names`.

### 2.7 Sessioni multiple

- [ ] **`AppState` con una mappa di sessioni** (`vault_id -> VaultSession`) e i
      comandi IPC che portano il vault di riferimento; il vault "corrente" resta
      una comodità della shell, non un'assunzione del backend.
- [ ] **Registro dei vault** (recenti, preferiti, icone) nella configurazione
      globale (§1.3).

### 2.8 Una disciplina dei provider sola, non una per famiglia

- [ ] **`ProviderTable<T>`**: `deliver_to_handlers` (`workspace.rs:1284`),
      `flush_indexes` (`:1088`) e `view_action` (`:1167`) implementano **tre
      volte** lo stesso protocollo sottile — `mem::take` dei provider →
      `with_provider_call` → ripristino → `extend(registered_meanwhile)` →
      `dispatch_pending`. Non è codice di servizio: è la semantica di consegna
      che il component model impone a M5, ed è già triplicata. §1.1 (comandi),
      §1.3 (settings) e §1.7 (import/export) ne aggiungerebbero altre tre copie.
- [ ] Una tabella sola è anche il posto in cui atterrano §2.9 (disattivazione),
      §2.10 (permessi e trust) e il `catch_unwind` del §2.3 — e a M5 il
      caricatore WASM la riusa invece di scrivere la quarta copia.

### 2.9 Disattivazione — oggi si può solo *non registrare*

- [ ] **`unregister`/`deactivate` nel workspace**: `register_event_handler`,
      `register_index_provider` e `register_view_provider` fanno solo `push`.
      D7 ("spento = non registrato") funziona perché la decisione si prende
      all'avvio da una variabile d'ambiente; con le impostazioni del §1.3 va
      presa a runtime, e senza un modo di togliere un provider "spento" non
      significa più niente.
- [ ] **Definire la semantica nei casi scomodi**: `view_owner` restituisce
      **posizioni** in un `Vec` e i provider sono estratti per la durata di una
      chiamata — una disattivazione che arrivi in quel momento va decisa, non
      scoperta a runtime.

*Sblocca:* 20.1 (enable/disable, lifecycle), 20.2 (hot reload, developer mode),
20.3 (crash isolation, rollback, permission revocation), 24.2 (safe mode), 28.

### 2.10 Permessi e manifest — il punto di applicazione non esiste

- [ ] **Il registry tiene `(manifest, permessi, trust)`** e `KernelHost` si
      costruisce da quella voce: oggi `PluginPermissions` esiste nel contratto e
      **nessuno lo legge**, e `KernelHost` porta solo `plugin: &str`
      (`workspace.rs:1485`) — non sa di chi siano le capacità che sta prestando.
      Il kernel non conserva manifest: `register_*` prende una stringa.
- [ ] **`Trust` va oltre le view**: oggi è un parametro del solo
      `register_view_provider`. Un `IndexProvider` di terzi riceverebbe *ogni*
      documento del vault via `on_document_indexed` senza che `read_vault` sia
      mai consultato.
- [ ] Ogni capacità del §1.4 (`http_fetch` sotto `network`, le operazioni
      strutturali sotto `write_vault`, `run_command`) presuppone un controllo che
      non ha casa. Se non nasce qui finirà sparso nei punti di chiamata — il
      contrario dell'enforcement in un punto solo già ottenuto per la UI.

### 2.11 Le cartelle non esistono nel kernel

- [ ] **La cartella come cittadino**: `metas` è una mappa piatta
      (`workspace.rs:163`) e l'albero vive solo in `organizer.ts::buildTree`.
      Quindi non si può creare una cartella vuota (le directory nascono per
      effetto collaterale di `Vault::write`), rinominarne una sarebbe N rename
      senza atomicità (§1.12) e senza un `FolderRenamed`, e icone/ordinamenti di
      cartella nel sidecar non li migra nessuno — `migrateMeta` (`main.ts:638`)
      gestisce i soli documenti.

*Sblocca:* 3.2 (crea/rinomina/sposta cartella, drag & drop), 8.2 (folder-level
metadata, inherited metadata), 8.3 (cartella default per tipo nota, regole di
auto-spostamento), 6.2 (CSS per cartella), 11.3 (database da cartella), 19.2
(permessi per cartella).

### 2.12 Una versione di schema su ogni formato persistito

- [ ] Ce l'ha il solo `SearchIndex` (`search.rs:59`), con la regola giusta
      ("versione diversa → butto e ricostruisco") — ma quello è **derivato**.
      Non ce l'hanno lo store del versioning, i sidecar del cestino,
      `.fubmd/workspace.json`, e domani impostazioni, allegati, canvas, database:
      dati **autorevoli**, che se non si leggono non si ricostruiscono. Costa un
      campo per formato oggi; domani è un formato da indovinare a valle di una
      segnalazione utente.

*Sblocca:* 27.4 (upgrade migration test), 2.1 (corruption detection), 24.2
(vault repair, checksum verification).

### 2.13 Il canale della lista documenti

- [ ] **`list_documents` non è nel contratto e non scala**: restituisce
      `Vec<String>` con **tutto** il vault, ricostruito e riordinato a ogni
      chiamata (`workspace.rs:380`), e la shell ne ricostruisce l'albero intero a
      ogni `index_updated`. È il canale più usato dell'app e l'unico fuori da
      `IndexQuery`: la paginazione del §1.6 non lo tocca, la virtualizzazione del
      §3.6 mitiga il disegno ma non il trasferimento. Va ripensato per-cartella e
      paginato, insieme al §2.2 (`VaultEntry`) e al §2.11.

### 2.14 Il sidecar dell'organizzazione, da assorbire

- [ ] **`.fubmd/workspace.json` è un precedente fuori da ogni disciplina**: lo
      legge e scrive l'app con `std::fs` (`app/lib.rs:596-615`). Sono dati
      **autorevoli** — icone, appuntate, ordinamenti, spazi — senza scrittura
      atomica, senza versione di schema (§2.12), fuori dal cestino e dal
      versioning, con la migrazione sui rename in TypeScript (`main.ts:638`):
      una nota rinominata da un'altra app **a FubMD chiusa** orfanizza icona,
      pin e ordinamento in silenzio, perché quell'evento non lo vede nessuno.
- [ ] Lo store di configurazione del §1.3 deve **assorbirlo**, non affiancarlo:
      spazio dati proprio, migrazione della chiave lato kernel sull'evento
      `DocumentRenamed`, stessa disciplina del resto.

### 2.15 Il montaggio dell'app vive dentro un comando Tauri

- [ ] **`open_vault` (`app/lib.rs:109-208`) È il composition root**: registry
      dei formati, indice di ricerca, versioning, le tre view, il watcher, il
      ponte eventi e la sessione si montano lì dentro, in un
      `#[tauri::command]`, in un crate che dipende da tauri e notify.
- [ ] **Ma quel montaggio ha già cinque clienti previsti**: la CLI (27.1),
      l'API/REST locale (27.2), l'headless degli e2e (§4.4 e 27.4), il mobile
      (26.2) e il PWA (26.3). Nessuno di loro può riusarlo, e ognuno finirebbe
      per ricopiarlo — cioè per avere una propria idea di quali feature
      esistono e in che ordine si registrano.
- [ ] **Serve un crate `fubmd-host`** (sessione, registry del §2.3, runner dei
      job, watcher dietro un trait, storage del §2.1) con `fubmd-app` ridotto a
      colla Tauri: comandi IPC, dialoghi, finestre. È il §4.7 visto dall'altro
      lato — quello divide le feature, questo separa *chi le monta* da *chi
      disegna*.

### 2.16 La politica di esclusione è una costante di compilazione

- [ ] **`IGNORED_DIRS` (`vault.rs:20`) è un `&[&str]` nel sorgente**, e la
      regola sta bene in un punto solo (`is_ignored_name`, usata da scansione e
      watcher). Il problema non è dove sta: è che è **una** politica quando ne
      servono cinque, e come **codice** quando serve come dato per-vault (§1.3).
- [ ] **Le cinque, tutte su uno stesso albero**: ignore configurabile e
      `.gitignore` (3.1), file nascosti visibili su richiesta (3.2), esclusione
      cartelle dalla ricerca (9.1), esclusione dal sync (18.1), esclusione dal
      contesto AI (23.2). Sono componibili e hanno scopi diversi: o nascono
      come un `IgnorePolicy` valutabile e parametrizzato per scopo, o ognuna
      verrà cablata dove capita, e "questa cartella è esclusa" significherà
      cinque cose diverse.
- [ ] È il gemello del §2.6 sul lato **quali file**, non **quali nomi**.

### 2.17 La query è una stringa in un linguaggio di terzi

- [ ] **`IndexQuery::FullText { query: String }` finisce dritta nel
      `QueryParser` di tantivy** (`search.rs`), e la shell interpreta l'errore
      come "Query incompleta" (`main.ts:1131`): la sintassi di ricerca che
      l'utente digita **è** quella di una dipendenza.
- [ ] Il §1.6 chiede di aggiungere ambito e faccette; il punto più profondo è
      che finché la query è una stringa opaca non hanno su cosa poggiare né il
      query builder visuale (9.2), né le query salvate/parametriche/preparate,
      né l'explain plan e il profiler (9.2), né la possibilità di cambiare
      motore. Serve un **AST di query nel contratto**, con il full-text come
      foglia e la stringa libera confinata dentro quella foglia.

### 2.18 Il dispatch delle query è per tentativi

- [ ] **`query_index` prova gli indici in ordine di registrazione finché uno non
      risponde `BadArgs`** (`workspace.rs:1064-1073`), e l'errore
      dell'**ultimo interpellato** è quello che arriva al chiamante. Con un
      indice funziona benissimo. Con quelli che FEATURES chiede — full-text,
      semantico e vettoriale (22.1), proprietà (8.2), task (10), database (11),
      citazioni (15.1) — ogni query gira su tutti, e due indici che rivendicano
      la stessa variante si oscurano a vicenda **in silenzio**.
- [ ] **Manca un routing dichiarato alla registrazione**: quali varianti e
      quali `ns` un indice serve. È esattamente la forma che manca al
      `FormatRegistry` (§1.22, ultimo registrato vince) e alla tabella dei
      provider (§2.8), ed è il presupposto del §1.6 e del §2.17 — quelli dicono
      *quali* query esistono e che forma hanno, mai **a chi vanno**.
- [ ] Con il routing arriva gratis anche la diagnostica che oggi non c'è:
      «nessuno serve questa query» distinto da «chi la serve ha fallito» — che
      è il §1.11 applicato al canale più usato dopo la lista documenti.

### 2.19 `Workspace` è un oggetto-dio, e ogni voce di questo piano gli aggiunge un campo

- [ ] **1750 righe e ~20 campi**, che mettono insieme: I/O del vault, registry
      dei formati, cache dei metadati, grafo, conteggi tag, event bus, coda e
      dispatcher, **tre** tabelle di provider, storage dei plugin, stato di
      sessione (`active`), coda dei job. Il §2.8 (`ProviderTable`) e il §2.4
      (`RwLock`) ne sono le due conseguenze già viste; la causa no, e ha due
      effetti che il resto del piano dà per risolti:
      - il `RwLock` del §2.4 **non potrà essere a grana fine**: un lettore che
        rende una view e uno scrittore che tocca il grafo sono lo stesso
        `struct` dietro lo stesso lock, quindi "le letture sono le view" resta
        vero e inutile;
      - il crate host del §2.15 sarebbe riusabile **tutto o niente**: CLI
        (27.1), API locale (27.2), e2e headless (27.4), mobile (26.2) e PWA
        (26.3) prenderebbero comunque il `Workspace` intero, col suo grafo
        delle dipendenze — che è il §4.7 perso dal lato del kernel.
- [ ] **E i sottosistemi che questo piano aggiunge sono dodici**: comandi
      (§1.1), impostazioni (§1.3), lotti (§1.12), edit (§1.16), undo (§1.17),
      storage (§2.1), allegati (§2.2), registry e job (§2.3), sessioni (§2.7),
      permessi (§2.10), cartelle (§2.11), ignore policy (§2.16). Dodici campi
      in più sullo stesso `struct`, e dodici ragioni in più per prendere lo
      stesso lock.
- [ ] **La scomposizione va decisa prima di aggiungerli**, non dopo:
      `DocumentStore` (vault + cache + parse), `MetadataIndex` (grafo + tag +
      outline), `ProviderRegistry` (§2.8 + §2.9 + §2.10), `Dispatcher` (coda +
      budget + origine del §1.18), `Session` (attivo + pane del §1.9). È anche
      il modo di dare al §2.15 un pezzo riusabile che non sia "tutto".
- [ ] **Ordine**: viene **prima** del §2.15 e del §2.4, o quei due nascono
      attorno all'oggetto-dio e lo rendono definitivo.

### 2.20 Nessun metadato di entry: né mtime, né dimensione, né impronta

- [ ] **`DocMeta` tiene id, frontmatter, outline e link** (`workspace.rs:125-130`)
      e il `Vault` non espone uno `stat`. Quindi `reindex` **rilegge e riparsa
      l'intero vault a ogni apertura** (`workspace.rs:341-351`): «un indice
      persistente riconosce e salta gli immutati» è vero per l'indice, non per
      il kernel, che paga comunque lettura + parse di tutto prima ancora di
      chiedere all'indice se gli interessa.
- [ ] **Ed è la fonte che manca a un elenco di feature che sembrano
      indipendenti**: apertura rapida di vault grandi ed enormi (24.1),
      rilevamento duplicati e deduplicazione (3.2, 13.1), sync differenziale
      (18.1), verifica d'integrità, checksum e corruption detection (2.1,
      24.2), «stale notes» (7.2, 9.3) e — le più banali e le più visibili —
      «note create di recente» e «note modificate di recente» (8.1), che oggi
      **non hanno alcuna fonte nel kernel**.
- [ ] È il `VaultEntry` del §2.2 esteso ai **documenti**, non solo agli asset:
      le due voci sono lo stesso lavoro e vanno fatte insieme, come §2.11 e
      §2.13.

---

## 3. Shell — da `main.ts` a piattaforma UI

`frontend/src/main.ts` è a 1365 righe e cresce di ~100 per feature; è il posto
dove il debito si vede a occhio nudo.

### 3.1 Smontare il monolite

- [ ] **Un modulo per dominio** (`explorer`, `search`, `trash`, `history`,
      `graph`, `tabs`) con un piccolo store condiviso e un router di eventi
      kernel: oggi `handleKernelEvent` conosce privatamente ogni pannello.
- [ ] **Un solo modo di montare un pannello**: il view host (`mountDeclaredViews`)
      esiste già ed è generico — cestino, cronologia, ricerca e grafo devono
      passare da lì (o come `ViewProvider`, o almeno come pannelli con la stessa
      interfaccia). Finché convivono due modi, il secondo vince per pigrizia.
- [ ] **Migrare la cronologia del versioning a `ViewProvider`** (dogfooding già
      pianificato): è il caso "view con stato per-documento, input e azioni che
      scrivono" — cioè il collaudo dei nodi del §1.2.
- [ ] **Modello di layout**: tab, split, pane, workspace salvabili (3.3, 4.1).
      Oggi c'è un editor solo e un documento solo: tutto il capitolo 3.3 è
      bloccato da questa mancanza, non dalla UI.

### 3.2 Comandi e tastiera

- [ ] **Registro comandi nel frontend** alimentato da `list_commands` +
      command palette fuzzy + hotkey configurabili (con chord) + conflitti
      segnalati. È la superficie con cui l'utente raggiunge tutto il resto.

### 3.3 Tema, token, accessibilità

- [ ] **Token CSS** (colore, spaziatura, tipografia) e temi chiaro/scuro/sistema
      al posto degli stili sparsi; è il prerequisito di 6.2 (temi, snippet CSS,
      CSS per nota/cartella) e di 25.1 (alto contrasto, reduced motion,
      dimensioni testo, font per dislessia).
- [ ] **Passata di accessibilità strutturale**: ruoli ARIA, focus visibile,
      focus trap nei modali, navigazione da tastiera nei pannelli, skip link.
      Farla ora costa poco; rifarla su 30 pannelli costa trenta volte.
- [ ] **Catalogo stringhe** e `t()` (dipende dalla decisione del §1.8).

### 3.4 Sanitizzazione e CSP in un punto solo

- [ ] **Sanitizer per l'HTML che entra nella webview**: `ui.ts:63-67` fa
      `innerHTML` diretto su `UiNode::Html`, e l'anteprima innesta l'HTML del
      provider. Il rendering è già escapato lato Rust, ma la regola deve valere
      per *chiunque* produca HTML (embed, plugin fidati, temi).
- [ ] **CSP stretta** in `tauri.conf.json` + `rel="noopener"` sui link esterni +
      blocco di default delle immagini/font remoti con consenso esplicito
      (5.3, 23.2).
- [ ] **Sandbox degli embed** (iframe, SVG, PDF) con la stessa policy.

### 3.5 Notifiche e attività in background

- [ ] **Toast/notification center** alimentato da `HostApi::notify` (§1.4) —
      oggi gli errori finiscono in `eprintln!` e l'utente non li vede.
- [ ] **Centro attività**: job in corso, progresso, cancellazione (24.1).

### 3.6 Prestazioni della UI

- [ ] **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
      tabelle: senza, "vault enormi" (24.1) è una promessa che la UI rompe prima
      del kernel.
- [ ] **Rendering incrementale dell'anteprima** e lazy loading di immagini/embed.

### 3.7 Editor

- [ ] **Ponte inverso code unit → byte** (`offsets.ts`): la direzione byte→UTF-16
      c'è ed è testata; senza l'inversa, nessuna azione dell'editor può parlare
      di `Span` al kernel (selezione → comando, patch, annotazioni).
- [ ] **Due livelli di decorazione dichiarati**: sintassi dal tree Lezer
      (già fatto), semantica dagli `Span` del modello (embed risolti, callout,
      math) — con la regola di chi vince dove.
- [ ] **Invariante del buffer sporco** irrobustita (oggi custodita da un flag TS)
      e conflitto buffer↔disco esplicito: è lavoro M3 già dichiarato.

### 3.8 Due parser per la stessa sintassi

- [ ] **Decidere quanto durano due grammatiche**: il Rust parsa con comrak per
      l'anteprima, il frontend parsa **di nuovo** con Lezer + regex per la live
      preview (wikilink, `#tag`, `==evidenziato==` e checkbox riconosciuti per
      riga in `livepreview.ts`). Per le decorazioni **sintattiche** è una scelta
      dichiarata e buona — il tree Lezer è già in code unit e non costa IPC — ma
      le estensioni del capitolo 5.2 sono ~50 (callout, footnote, definition
      list, embed, apici/pedici, tabs, timeline, stepper, math…) e ognuna
      andrebbe scritta due volte, in due linguaggi, con due nozioni di offset.
- [ ] Il secondo livello del §3.7 (semantica dagli `Span` del modello) **non ha
      un canale**: nessun comando restituisce il modello (§1.13). Finché non
      c'è, "le decorazioni semantiche vengono dal modello" resta un'intenzione e
      la sintassi nuova continua a nascere due volte.

### 3.9 Il view host ridisegna tutto, e i nodi non hanno una chiave

- [ ] **`mountView` fa `target.innerHTML = ""` e ricostruisce**
      (`main.ts:1198`), e `renderUiNode` crea elementi nuovi a ogni giro
      (`ui.ts`). Oggi si nota poco: le view sono liste in sola lettura. Con gli
      input del §1.2 è fatale — un campo di testo perde focus e contenuto a
      **ogni** `IndexUpdated`, cioè a ogni salvataggio.
- [ ] **La chiave è contratto, quindi è P0**: il §1.2 nomina
      `ViewUpdate::Patch { path, node }`, ma un patch indirizzato per *path* si
      rompe al primo riordino di lista — ed è esattamente il caso che il §1.2
      cita, il pannello task con 500 righe. Serve una chiave stabile sui nodi
      (`UiNode.key`), che è ciò su cui un riconciliatore può lavorare.
- [ ] **Lato shell**: un riconciliatore che aggiorna invece di ricostruire, e
      la conservazione dello stato di vista (focus, scroll, selezione, sezioni
      aperte) attraverso il ridisegno. Senza, il §1.2 consegna nodi di input
      che nella pratica non si possono usare.

### 3.10 Tre stati diversi, zero contenitori

- [ ] **Un `ViewProvider` non ha dove tenere il proprio stato di vista**:
      scroll, sezioni collassate, filtro corrente, tab attiva. `storage_*` è
      volatile e a chiave→valore (e senza namespace per-view), `data_*` è per i
      dati che durano.
- [ ] **Sono tre cose distinte, e vanno decise insieme o nasceranno con tre
      meccanismi incompatibili**: le **impostazioni** (durano e viaggiano col
      vault — §1.3), lo **stato di vista/sessione** (per-macchina, per-pane —
      §1.9), il **layout** (salvabile e ripristinabile: 3.3 chiede *workspace
      salvabili*, *switch rapido*, *restore layout all'avvio*). Oggi lo stato di
      vista della shell sta in `localStorage` (spazio attivo, cartelle
      espanse), quello dei provider non sta da nessuna parte, e il layout non
      esiste.

### 3.11 La cucitura con l'host perde da `main.ts`

- [ ] **`api.ts` è l'unica cucitura verso Tauri — tranne `main.ts:2`**, che
      importa `@tauri-apps/plugin-dialog` per le conferme e il file picker.
      Basta una riga perché la shell smetta di essere portabile.
- [ ] **Serve un `host.ts`** (o l'allargamento di `api.ts`) che copra dialoghi,
      notifiche, clipboard, filesystem e finestre: è il prerequisito del PWA
      (26.3), del mobile (26.2) e degli e2e della shell (§4.4), che girano
      contro un host finto. La regola da presidiare con un test è semplice:
      **nessun modulo della shell importa `@tauri-apps` fuori dalla cucitura**
      — la versione UI della dieta dell'IPC del §4.2.

### 3.12 La UI di un plugin non ha modo di entrare nella shell

- [ ] **`renderUiNode` è uno `switch` esaustivo su un union chiuso** (`ui.ts`),
      compilato dentro il bundle. Il §1.2 propone
      `UiNode::Custom { ns, payload, fallback }` con «la shell che conosce `ns`
      disegna il widget suo» — ma non dice **come** un `ns` di terzi ci arriva.
      Senza quella risposta, `Custom` significa "riservato a chi è già nel
      bundle", cioè la superficie privilegiata del §1.14 con un altro nome.
- [ ] **Il conto è dirimente**: il 21.1 promette che ogni modulo Suite è
      «installabile separatamente» e «disattivabile», e i moduli che hanno
      bisogno di un renderer proprio sono FubCanvas, FubDB, FubCharts, FubMaps,
      FubForms (21.2). Se i loro renderer stanno nel bundle della shell, quella
      promessa è falsa — e lo è **già** per il grafo (`graph.ts`, §1.14).
- [ ] **Le tre opzioni non sono equivalenti**, e vanno scelte prima che venti
      moduli si scrivano contro l'ipotesi implicita:
      - un registro di web component caricati da un bundle di plugin — è la più
        potente e sbatte contro «no eval policy» (20.3) e la CSP del §3.4;
      - un iframe sandboxato con un protocollo di messaggi — regge 20.3 e §3.4,
        costa un confine in più e una storia di temi/asset per i plugin;
      - solo prima parte, e tutto il resto dichiarativo — allora il §1.2 deve
        arrivare fino a tabella, albero, canvas e chart, e `UiNode::Custom`
        serve al solo core.
- [ ] È il terzo lato della stessa domanda dei §1.22 e §1.23 — **chi disegna
      ciò che il core non conosce** — e le tre risposte devono essere coerenti:
      un plugin che può aggiungere la sintassi ma non il renderer, o il
      renderer Rust ma non quello della shell, è mezzo plugin.

---

## 4. Presidi e tooling — perché il resto non marcisca

### 4.1 Mirror TS↔Rust generati, non scritti

- [ ] **Generare `api.ts` dai tipi Rust** (`ts-rs` o `schemars` + generatore) al
      posto della fixture: oggi il legame è un test che confronta campioni, e
      copre i tipi che qualcuno si è ricordato di aggiungere. Con 30 tipi nuovi
      in arrivo (task, proprietà, asset, comandi) la fixture non scala.

### 4.2 Dieta dell'IPC

- [ ] **Test che presidia la superficie**: l'elenco dei comandi Tauri
      (`app/lib.rs:676-705`, 28 oggi) è una **allowlist** in un test; aggiungerne
      uno richiede di dire perché non poteva essere un comando/una view/una
      query. È il modo meccanico di non tornare al bespoke.
- [ ] **Migrare i bespoke esistenti** dove il §1 lo rende possibile: versioning
      (3 comandi), cestino (4), organizzazione (2), grafo (1).

### 4.3 Corpus, fuzzing, prestazioni

- [ ] **Fuzzing del parser** markdown (e dell'HTML in ingresso): 5.3 lo chiede
      esplicitamente, e un parser che pania è un vault che non si apre.
- [ ] **Corpus di conformità** CommonMark/GFM + snapshot Obsidian-flavored.
- [ ] **Benchmark su vault sintetici grandi** (10k/100k note) in CI, con soglie:
      tempo di apertura, ricerca, memoria. Senza numeri, "supporto vault enormi"
      non è verificabile.
- [ ] **Round-trip import/export** appena i trait del §1.7 esistono.

### 4.4 Test della shell

- [ ] **E2E** dell'app reale (tauri-driver/Playwright) sui flussi critici:
      apri vault, scrivi, rinomina, cerca, ripristina.
- [ ] **Check di accessibilità** automatico sui pannelli.

### 4.5 Osservabilità

- [ ] **`tracing` al posto di `eprintln!`** con log su file, livelli
      configurabili e log per-plugin; il diagnostic bundle (§2.5) lo raccoglie.

### 4.6 L'SDK come superficie di riuso — oggi è quasi vuoto

- [ ] **`fubmd-sdk` contiene un re-export e `scan`**, e il pezzo che conta sta
      altrove: il `MemoryHost` — l'unico modo di provare un provider **contro il
      contratto** invece che contro il kernel — è `#[cfg(test)] mod testing`
      dentro `fubmd-features` (`features/src/lib.rs:31`). Nessun autore di
      plugin, e nemmeno un futuro modulo FubSuite in un crate a parte, può
      usarlo.
- [ ] **Promuoverlo a `fubmd-sdk::testing`** insieme a ciò che ogni provider
      riscriverebbe: costruttori di `UiNode`, parsing degli `ActionId`, e una
      **conformance suite** che verifichi le proprietà che il contratto promette
      (un `IndexProvider` che non perde documenti fra `on_document_*` e `flush`;
      un `ViewProvider` che non muta durante `render_view`). È la differenza fra
      "il contratto è documentato" e "il contratto è verificabile da chi lo
      implementa".

*Sblocca:* 27.3 (unit/e2e test utilities, template progetto plugin, type
definitions, plugin linting), 21.1 (moduli Suite con API condivise).

### 4.7 Un crate per bundle di feature

- [ ] **`fubmd-features` è un crate solo**: tantivy è dipendenza dell'intero
      crate, quindi compilare il pannello outline compila un motore di ricerca.
      Con i moduli di 21.2 (FubTasks, FubDB, FubCanvas, FubCalendar, FubAI,
      FubMaps…) diventa un monolite con il grafo di dipendenze di venti feature,
      non disattivabile a compile time e senza confini contro l'accoppiamento
      feature↔feature — l'invariante "una feature ufficiale è ciò che scriverà un
      plugin" resterebbe vera nel documento e falsa nel `Cargo.toml`. Un crate
      per bundle (o almeno una cargo feature per bundle, con tantivy dietro la
      sua) è il minimo perché il confine sia reale.

### 4.8 Il contratto si scrive quattro volte a mano

- [ ] **Ogni tipo nuovo tocca quattro posti**: Rust (`fubmd-abi`), WIT
      (`wit/fubmd/abi.wit`), arena (`abi/src/arena.rs`, per i tipi ricorsivi) e
      mirror TS (`frontend/src/api.ts` + la fixture). Che non divergano è
      presidiato — `wit_conformance.rs` parsa il WIT e confronta nomi e tipi
      nelle due direzioni, ed è uno dei test migliori del repo — ma il presidio
      verifica il costo, non lo riduce.
- [ ] **Il conto delle P0 lo rende un collo di bottiglia**: il §1.2 porta una
      ventina di varianti `UiNode` nuove (in gran parte ricorsive, quindi con
      l'arena da estendere), più §1.5, §1.6, §1.7, §1.14 e §1.15. Il §4.1 chiede
      di generare il mirror TS; la stessa domanda va posta **ora** per WIT e
      arena — generare l'uno dall'altro, o almeno gli scheletri — o la
      generazione arriverà dopo il lavoro che doveva alleggerire.

### 4.9 Supply chain e compliance — la sola parte che non si recupera dopo

- [ ] **La CI è buona e non copre questo**: invarianti abi↔WIT e grafo delle
      dipendenze in un minuto, build e test su tre OS, toolchain pinnata
      all'MSRV, frontend con type-check + test + build. Il §4 aggiunge fuzzing,
      corpus, benchmark, e2e e tracing. Nessuno dei due tocca il 23.3: **SBOM,
      identificatori SPDX, license compliance, dependency audit e advisory
      CVE** — né il 20.3 (reproducible builds, firma, dependency audit).
- [ ] **`cargo-deny`** (licenze, advisory, duplicati, sorgenti consentite) e la
      **generazione dell'SBOM** in CI costano mezz'ora adesso. È l'unico punto
      di quel capitolo che non si recupera a posteriori: le licenze delle
      dipendenze entrate nel frattempo si riesaminano una per una, e una
      incompatibile scoperta a valle si toglie riscrivendo ciò che ci stava
      sopra. Vale doppio con l'albero che sta per arrivare (tantivy c'è già;
      §4.7 ne prevede uno per bundle).

*Sblocca:* 23.3 per intero, 20.3 (SBOM plugin, dependency audit, advisory), e
il capitolo 1.2 di FEATURES — la «licenza chiara» promessa dai principi fondanti
è verificabile solo se lo è quella delle dipendenze.

---

## 5. Debito riportato dal quarto audit

Voci ancora aperte, con il loro milestone.

- [ ] **Mutex unico sul `Workspace`** → assorbito dal §2.4 (misurare prima).
- [ ] **UI di produzione = IPC bespoke** → assorbito da §1.1, §1.2, §3.1, §4.2;
      il caso concreto resta la UI del versioning.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3): rivalutare alla
      superficie plugin di M5 — con i nodi `Tree`/`Custom` del §1.2 la scelta
      cambia natura.
- [ ] **"Tre copie" custodite da un flag TS**: merge esplicito a M3 (§3.7).
- [~] **Ponte byte↔UTF-16**: direzione byte→code unit fatta e testata; l'inversa
      resta (§3.7).
- [ ] Cosmetico: `.fubmd-data/index/` orfana per chi ha aperto il vault con
      versioni precedenti; si cancella a mano.

---

## 6. Ordine consigliato

**P0 — prima del freeze di M4** (costano un campo oggi, una migrazione dopo):
§1.1 comandi, §1.2 `UiNode` con input, §1.4 capacità `HostApi`, §1.5 modello
(task e ancore), §1.6 `IndexQuery`, §1.7 trait import/export, §1.8 decisione
sulle stringhe, §1.9 contesto della view (pane e selezione), §1.10 identità del
documento, §1.11 errori tipizzati, §1.12 il lotto, §1.13 canale del rendering.
Dal terzo giro, con lo stesso statuto: §1.14 superfici della UI, §1.15 view
istanziabili, §1.16 la primitiva di edit, §1.17 undo, §1.18 origine degli
eventi, §1.19 grana dell'abbonamento, §1.20 `ParseContext` e parse non-testo,
§2.17 la query come AST, e la **chiave dei nodi** del §3.9 (che è shell nel
titolo ma contratto nella firma). Sono tutte **decisioni di forma**:
l'implementazione può seguire, la firma no.

Dal quarto giro, con lo stesso statuto: §1.21 il job che vede il vault, §1.22
l'estendibilità del parser, §1.23 il renderer dei blocchi custom, §1.24 i
servizi e le dipendenze fra plugin, §1.25 caso/fuso/locale fra le capacità,
§1.26 gli altri enum chiusi e §1.27 (`list_documents` e `views()`, le metà nel
contratto di §2.13 e §1.15). Più §2.18, che è kernel nel titolo ma
**registrazione — cioè firma** — nella sostanza. Due avvertenze sull'ordine
interno: dentro §1.26, `RenderOptions` viene per primo perché è l'unico dei
quattro che **rompe una firma** invece di aggiungere un campo; e §1.22, §1.23 e
§3.12 sono una decisione sola vista da tre lati (chi disegna ciò che il core non
conosce), quindi vanno prese nella stessa seduta o due terzi della risposta
saranno inutilizzabili.

**P1 — insieme a M3** (l'editor e la palette sono i primi clienti del §1):
§1.3 impostazioni, §2.3 registry + runner dei job, §2.8 tabella dei provider
unica, §2.9 disattivazione, §2.10 permessi e manifest, §2.15 il crate host,
§3.1 smontaggio di `main.ts`, §3.2 registro comandi, §3.4 sanitizzazione/CSP,
§3.7 editor, §3.8 decisione sui due parser, §3.9 (la metà shell: il
riconciliatore), §3.11 la cucitura con l'host. Più §4.1, §4.2, §4.6 (SDK), §4.7
(crate per bundle) e §4.8 (generazione del contratto), che vanno messi *mentre*
la superficie cresce, non dopo: §2.8-§2.10 in particolare vanno **prima** dei
provider nuovi del §1, o li si scrive tre volte, e §4.8 va **prima** delle P0
del terzo giro, o quelle si scrivono quattro volte.

Dal quarto giro si aggiungono §2.19 (la scomposizione del `Workspace`) e §3.12
(come la UI di un plugin entra nella shell). Il §2.19 ha una precedenza dura:
va **prima** del §2.15 e del §2.4, o il crate host nasce attorno all'oggetto-dio
e il `RwLock` non potrà mai essere a grana fine. Il §3.12 va deciso insieme a
§1.2, §1.22 e §1.23, anche se si implementa dopo.

**P2 — quando la scala lo chiede** (nessuno blocca il contratto):
§2.1 `VaultStorage`, §2.2 allegati, §2.5 durabilità, §2.6 politiche path/testo,
§2.7 sessioni multiple, §2.11 cartelle, §2.12 versioni di schema, §2.13 canale
della lista documenti, §2.14 sidecar dell'organizzazione, §2.16 ignore policy,
§3.3 temi/a11y, §3.5 notifiche, §3.6 virtualizzazione, §3.10 i tre stati,
§4.3-§4.5, più §2.20 (i metadati di entry). Quattro avvertenze: §2.12 costa un
campo adesso e un formato da indovinare dopo, quindi conviene anticiparlo a ogni
formato che nasce; §2.11 e §2.13 sono lo stesso lavoro visto da due lati; §2.20
e §2.2 pure, e vanno fatte nella stessa passata; §3.10 va deciso *insieme* a
§1.3 e §1.9, anche se si implementa dopo, o i tre stati nascono con tre
meccanismi che non si parlano.

**Fuori dall'ordine, perché costa mezz'ora e non si recupera dopo:** §4.9
(`cargo-deny` + SBOM in CI). Non blocca niente e non sblocca niente — è solo
l'unica voce del piano il cui costo cresce con il numero di dipendenze già
entrate.

Nota di rotta: le voci con l'effetto leva più alto sono **§1.1 (comandi)**,
**§1.2 (input in `UiNode`)** e **§2.3 (registry + job)** — insieme spostano dal
"cablato nell'app" al "registrato" praticamente ogni capitolo di FEATURES dal 4
al 22, e sono le tre che il freeze di M4 rende definitive. Accanto a quelle, dal
secondo giro: **§1.9 (contesto e selezione)**, senza cui metà dei capitoli 4, 13
e 22 non potrà mai essere un provider; **§1.12 (il lotto)**, prerequisito
silenzioso di bulk fix, import, automazioni e database; e **§2.8 + §2.10**, che
sono il posto dove ogni famiglia di provider futura atterra senza portarsi
dietro la propria copia della disciplina.

Dal terzo giro se ne aggiungono due dello stesso peso. **§1.14 (le superfici)**:
senza area principale, status bar, ribbon e menu nel contratto, i capitoli 11,
12, 7.3, 10.3 e 11.5 — cioè la metà di FEATURES per volume — non hanno un posto
dove atterrare, e ognuno ripeterà la scappatoia che il grafo ha già fatto.
**§1.16 (la primitiva di edit)**: finché l'unico modo di cambiare un documento è
riscriverlo tutto, ogni feature che tocca il testo perde cursore, selezione e
undo, e due di loro non si possono comporre — è il prerequisito silenzioso del
§1.9 (la selezione), del §1.12 (un lotto è una lista di edit) e del §1.17
(l'inverso di un edit è un edit).

Dal quarto giro se ne aggiungono due dello stesso peso, e vanno sopra tutte le
altre perché non allargano una capacità: ne rendono una **inesprimibile**.
**§1.21 (il job che vede il vault)**: finché il lavoro lungo non può leggere il
vault, i capitoli 17, 18, 22 e 19.4 — cioè il volume maggiore di FEATURES dopo
l'11 e il 12 — non hanno un posto dove girare, e l'unica alternativa è farli nel
giro sincrono, con il workspace preso in esclusiva. **§1.22 (il parser
estendibile)**: è l'unico punto in cui l'invariante «una feature ufficiale è ciò
che scriverà un plugin» è già falsa oggi — un'estensione di sintassi non può
essere un plugin, e con le ~50 del capitolo 5.2 in arrivo la falsità diventa la
regola. Accanto, di poco sotto: **§1.24 (i servizi fra plugin)**, senza cui il
capitolo 21 descrive crate linkati e non moduli installabili separatamente, e
**§2.19 (la scomposizione del `Workspace`)**, che è il posto dove tutte le altre
voci di questo piano andranno ad atterrare — una alla volta, come campi.
