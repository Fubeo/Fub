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
Sono tutte **decisioni di forma**: l'implementazione può seguire, la firma no.

**P1 — insieme a M3** (l'editor e la palette sono i primi clienti del §1):
§1.3 impostazioni, §2.3 registry + runner dei job, §2.8 tabella dei provider
unica, §2.9 disattivazione, §2.10 permessi e manifest, §3.1 smontaggio di
`main.ts`, §3.2 registro comandi, §3.4 sanitizzazione/CSP, §3.7 editor, §3.8
decisione sui due parser. Più §4.1, §4.2, §4.6 (SDK) e §4.7 (crate per bundle),
che vanno messi *mentre* la superficie cresce, non dopo: §2.8-§2.10 in
particolare vanno **prima** dei provider nuovi del §1, o li si scrive tre volte.

**P2 — quando la scala lo chiede** (nessuno blocca il contratto):
§2.1 `VaultStorage`, §2.2 allegati, §2.5 durabilità, §2.6 politiche path/testo,
§2.7 sessioni multiple, §2.11 cartelle, §2.12 versioni di schema, §2.13 canale
della lista documenti, §2.14 sidecar dell'organizzazione, §3.3 temi/a11y,
§3.5 notifiche, §3.6 virtualizzazione, §4.3-§4.5. Due avvertenze: §2.12 costa un
campo adesso e un formato da indovinare dopo, quindi conviene anticiparlo a ogni
formato che nasce; §2.11 e §2.13 sono lo stesso lavoro visto da due lati.

Nota di rotta: le voci con l'effetto leva più alto sono **§1.1 (comandi)**,
**§1.2 (input in `UiNode`)** e **§2.3 (registry + job)** — insieme spostano dal
"cablato nell'app" al "registrato" praticamente ogni capitolo di FEATURES dal 4
al 22, e sono le tre che il freeze di M4 rende definitive. Accanto a quelle, dal
secondo giro: **§1.9 (contesto e selezione)**, senza cui metà dei capitoli 4, 13
e 22 non potrà mai essere un provider; **§1.12 (il lotto)**, prerequisito
silenzioso di bulk fix, import, automazioni e database; e **§2.8 + §2.10**, che
sono il posto dove ogni famiglia di provider futura atterra senza portarsi
dietro la propria copia della disciplina.
