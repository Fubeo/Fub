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

Un quinto giro ha aggiunto §§1.28–1.35, §§2.21–2.27 e §4.10, e nasce da tre
domande che i primi quattro non pongono: **chi vede il modello parsato**, **che
cosa è una view mentre è viva** e **come si spegne il tutto**. Le risposte di
oggi sono, nell'ordine: solo il kernel; una funzione pura e sincrona senza
stato; non si spegne. Il criterio: qui non manca un varco e non è sbagliata una
forma — manca la *risposta a una domanda che nessuno ha ancora fatto*, e le tre
sono già decise nelle firme che il freeze di M4 congela. Il quinto giro porta
anche il primo caso in cui una promessa del prodotto è **falsa oggi e in
silenzio** (i link markdown non entrano nel grafo: §2.21) e il primo in cui una
correttezza dichiarata non ha presidio meccanico (§4.10).

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
| ~~3.3 split/finestre, 4.2-4.3 azioni sulla selezione, 13.3, 22.2~~ | ~~contesto per-pane e **selezione** nel contratto~~ | **chiuso (§1.9)**: `HostApi::active_context() -> Option<ViewContext>` con pannello, documento, selezione e modalità |
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
| ~~4.3, 7.2, 8.2, 10.1, 11.3, 16.1, 19.2, 22.2~~ | ~~modificare **un pezzo** di documento~~ | **chiuso (§1.16)**: `HostApi::apply_edit(id, EditRequest { base, edits })`, con la revisione nella firma e `Conflict` invece della sovrascrittura silenziosa |
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
| 10 task, 8.2 proprietà, 15.1 citazioni, 17.2 export, 22.1 chunking | il **modello parsato** in mano a un provider | `HostApi` dà solo la sorgente; il `FormatProvider` sta nel kernel (`workspace.rs:1335`) |
| 12 canvas, 11.4 CSV/JSON, 13.2 PDF, 8.3 tipi nota | sapere **che formato è** un documento | nessuna capacità restituisce il `FormatDescriptor` di un `DocId` |
| 11.2-11.3 database, 10.3 task, 9.2 query, 28 settings | una view che tiene lo **stato** | `render_view` **e** `on_action` sono `&self` (`abi/traits.rs:222-228`) |
| 22 AI, 18 sync, 11.5 dashboard, 24.1 progresso | una view che si fa **ridisegnare** | `refresh` filtra eventi del kernel; nessun push dal provider, nessuno stato "in caricamento" |
| 3.3 sidebar personalizzabili, 20.1 venti pannelli di plugin | metadati di presentazione di una view | `ViewSpec` ha id, titolo, placement, refresh (`abi/traits.rs:201`) — niente icona, ordine, default |
| 19.3 form, 8.2 editor proprietà, 11.3 editing | le azioni portano **valori** | `UiAction.payload` non è mai popolato (`main.ts:1197`): i dati stanno dentro l'`ActionId` |
| 20.1 conflitti plugin, 21.2 moduli che convivono | una regola sugli **spazi di nomi** | `view_owner` prende il primo id che combacia (`workspace.rs:1196`): il secondo è muto |
| 24.2 safe mode/recovery, 3.1 switch vault, 26.2-26.3 | uno **spegnimento** | `flush_indexes` ha un solo chiamante: il watcher (`app/lib.rs:252`); `deactivate` non ne ha nessuno |
| 7.1 link markdown/relativi, 7.2 link rotti, 13.1 riferimenti allegati | un grafo che risolve **tutti** i link | `LinkGraph` scarta ogni `LinkTarget` che non sia `Wiki` (`graph.rs:266`) |
| 24.1 vault enormi, 2.1 corruption detection, 24.2 repair | apertura a fasi e tolleranza per-documento | `reindex` è tutto-o-niente (`workspace.rs:341`): una nota che non parsa chiude il vault |
| 13.3 annotazioni, 10 task, 11 database, 4.3 commenti | stato **per-documento** migrato dal kernel | ogni feature lo rifà da sé (versioning, `main.ts:638`), col buco del §2.14 |
| 20.1 pannello plugin, 28 settings, 24.2 diagnostica | inventario delle feature attive | `VaultInfo.versioning` è **un booleano per feature** (`app/lib.rs:57`) |
| 9.1-9.2 ogni query nuova, 7.3 grafo, 8.4 collezioni | la query sull'**IPC** | quattro comandi Tauri avvolgono lo stesso `query_index` (`app/lib.rs:411`, `:484`, `:505`, `:642`) |
| 27.3 version compatibility, 20.1 versioning plugin | presidio dell'additività del contratto | `wit_conformance` confronta abi↔WIT **oggi**, mai con la versione precedente |
| ~~22.4 centro di comando LLM, 27.1 CLI, 27.2 API locale, 16.2 automazioni~~ | ~~comandi descritti a una **macchina**~~ | **chiuso (§1.1 + §1.36)**: `CommandSpec { id, title, description, keybinding, params, scope }`, e l'host convalida gli argomenti contro la spec prima di chiamare il comando |
| ~~22.4 anteprima del piano, 7.2 bulk fix, 17.3 rollback, 16.3 undo~~ | ~~invocare **senza applicare** (dry-run)~~ | **chiuso (§1.36)**: `invoke(…, InvokeMode::DryRun)` → `CommandPlan` (i `DocId` impattati e un `EditRequest` per documento), con l'host che presta un `HostApi` in sola lettura — il non-scrivere è garantito, non promesso |
| 22.4 approvazione per operazione, 20.3 sandbox, 23.1 | il **consenso** dell'utente distinto dal permesso | il giro dry-run→piano→apply c'è (§1.36) e la shell lo usa; ciò che manca è chi lo **impone** a un chiamante che non vuole simulare — è una policy del §2.10 sopra la firma |
| ~~7.2 bulk fix, 17.3 import, 11.3 editing bulk, 24.1 progresso~~ | ~~N scritture che sono **una cosa sola**~~ | **chiuso (§1.12)**: `Workspace::batch(\|ws\| …)` coalizza `index-updated` e chiude con `Event::BatchEnded { batch, changed }` — una rinomina con 200 backlink passa da 201 ridisegni completi a 1, e gli eventi per-documento passano tutti. Non è una transazione: il tutto-o-niente resta al journal del §2.5 |
| ~~16.2 trigger su-modifica, 18 sync, 19.2 collaborazione~~ | ~~un evento che dice **chi lo ha causato**~~ | **chiuso (§1.18)**: `handle` riceve un `Notice { event, origin }` con `Origin { actor, batch }`; `Actor::is_plugin(id)` è come un'automazione che scrive evita di richiamarsi da sola — prima l'unica difesa era il `DISPATCH_BUDGET` che tronca |

---

## 1. Contratto (`fubmd-abi`) — gratis ora, breaking dopo M4

Il freeze di M4 è la scadenza vera: ogni voce di questa sezione costa oggi un
campo e domani una migrazione di versione. Vanno decise **insieme**, perché sono
tutte risposte alla stessa domanda: *cosa può dire e fare un plugin?*

### 1.1 Comandi — il trait più importante che nessuno usa

- [x] **Registro comandi nel `Workspace`**: `register_command_provider(id,
      provider)`, `commands()` e `invoke_command(id, args, mode)` con la stessa
      disciplina delle view (`in_provider_call` alzato, dispatch differito,
      provider estratto per la durata della chiamata).
- [x] **Comandi sull'IPC**: `list_commands` / `invoke_command`, gemelli di
      `list_views` / `view_action`. Da qui in poi una feature nuova **non deve
      poter aggiungere un comando Tauri** (§4.2).
- [x] **`CommandOutcome` sufficiente**: `{ notify, effect }` con
      `CommandEffect { Done, Navigate, Reveal, RunSearch, Plan, Custom }`.
- [x] **Un cliente vero nello stesso giro**: `CoreCommands` (`search.open`,
      `selection.wikilink`, `vault.replace`) e la **palette** nella shell, che
      non cabla nessun id — legge le spec, chiede i parametri dichiarati, mostra
      il piano quando il raggio lo merita, e onora le scorciatoie che i comandi
      dichiarano.

*Sblocca:* 4.2 (slash commands, scorciatoie), 16.2 (macro, catene, trigger),
20.1 (comandi/hotkey plugin), 27.1 (CLI: la CLI è un client dello stesso
registro), 3.3 (quick actions, command palette).

**Fatto insieme al §1.36, con tre decisioni e un residuo dichiarato.**

*Niente `Trust` nel registro.* Le view lo hanno perché da esse passa **contenuto
attivo** (`Html`/`WebView`), e il varco di validazione esiste prima del primo
provider non fidato. Da un comando non passa un albero: l'unica stringa che
arriva all'utente (`notify`) è testo semplice, come lo snippet di una ricerca.
Ciò che a un comando serve è un *permesso* — «questo componente può scrivere nel
vault?» — che è il §2.10, un'altra domanda con un altro posto. Un campo `trust`
qui sarebbe stato registrato da tutti e letto da nessuno.

*La richiesta di input non è un esito, è una dichiarazione.* Il §1.1 la chiedeva
come variante di `CommandOutcome` («rinomina nota da palette non può chiedere il
nome nuovo»); con i `params` del §1.36 la palette **chiede prima di invocare**, e
un chiamante non interattivo — che a una domanda a metà esecuzione non saprebbe
rispondere — compila e basta. Il prezzo dichiarato: un comando non può porre una
seconda domanda che dipende dalla prima; quel dialogo è del §1.2 (i form) e del
16.1 (i prompt dei template), non di questa firma.

*Le azioni migrate sono quelle che le capacità permettono.* «Apri la ricerca» è
diventata `search.open` (effetto per la shell, nessuna scrittura). Crea, rinomina
e cestina **non** sono migrate, e non per fretta: l'`HostApi` non ha le capacità
strutturali, che il §1.4 vuole decidere una per una a verbale. Un comando
ufficiale che le ottenesse per una via privilegiata avrebbe provato che il
registro funziona *per chi non è un plugin*, cioè l'unica cosa che non c'era
bisogno di provare.

*Resta fuori, dichiarato:* i **comandi strutturali** (§1.4); i **comandi della
shell** (toggle dei pannelli, cambio modalità): il registro vive nel kernel e il
frontend non può registrarvisi — è il §3.2, e finché non c'è, quelle azioni
restano bottoni; la **tastiera configurabile** (§3.2: oggi la shell onora il
`keybinding` *dichiarato*, e ignora quelli senza modificatori perché ruberebbero
una lettera a chi scrive); **chi possiede un id** (§1.34: due provider che
dichiarano lo stesso comando sono risolti dall'ordine di registrazione, come per
le view).

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

- [x] **Task come cittadini di prima classe**: `Block::List` deve portare
      `checked: Option<bool>` per voce (e lo `Span` del marcatore). Oggi una
      task list è una lista di paragrafi: tutto il capitolo 10 (~90 voci)
      ricomincerebbe dal parsing.
- [x] **Ancore stabili**: `^block-id` e id di heading nel modello
      (`Block::anchor: Option<String>`), con la regola di generazione nel
      contratto come `canonical_tag`. Servono a 7.1 (link a blocco), 5.2 (embed
      di blocchi), 13.3 (deep link ad annotazione), 18.3 (diff a blocchi).
- [x] **Footnote, definition list, tabella** promosse da `Custom` a varianti (o
      decidere esplicitamente che restano `Custom` con `custom_kind` registrati
      e documentati — la decisione manca, non la variante).
- [x] **`LinkTarget` per gli allegati**: oggi un'immagine è `Path`/`Url` e nulla
      distingue "risorsa del vault" da "url esterno" — 13.1 (riferimenti su
      rinomina, orfani, dedup) parte da qui.
- [x] **Proprietà tipizzate**: il frontmatter è `serde_json::Map` piatto. 8.2
      chiede tipi (data, rating, relazione, formula): serve almeno un
      `PropertyValue` normalizzato nel contratto, o ogni consumatore
      reinventerà il parsing delle date.

**Fatto, e con una decisione a verbale per ciascuna.** Il dettaglio sta in
`docs/architecture/data-model.md`; qui il perché, che è ciò che fra sei mesi non
si ricostruisce dal diff.

*La task porta il simbolo, non un booleano.* `ListItem { blocks, task, span }`
con `TaskMarker { symbol: Option<char>, span }` e `checked()` per la lettura
binaria (`x`/`X`, regola di Obsidian). Gli stati personalizzati — `[/]` in
corso, `[-]` cancellato, `[>]` rimandato — sono una richiesta esplicita di 10.1,
e un `bool` avrebbe chiuso quella famiglia al primo parse; comrak li vede solo
con `relaxed_tasklist_matching`, quindi il modello li apriva e il parser li
buttava. Lo `span` è quello del **simbolo** e non delle parentesi: spuntare
diventa la sostituzione di un carattere, che è la patch più piccola scrivibile
per il gesto più frequente che ci sia.

*L'ancora è indirizzo, non contenuto.* Ogni blocco porta `anchor`, con due
sintassi e due spazi di nomi: per un heading è lo slug generato (`heading_slug`,
salito nel contratto da funzione privata del provider — due provider potevano
dare due id allo stesso titolo), per gli altri l'id esplicito `^abc`
(`canonical_anchor` + `valid_anchor`, e il `^` va preceduto da spazio o `2^10`
diventa un'ancora). La tabella piatta `anchors` porta **due** span, blocco e
marcatore, perché servono a due mestieri (ritagliare un embed / riscrivere l'id).
Il marcatore sparisce da testo indicizzato e resa, e diventa un `id=` in HTML.
La forma su riga propria (`^abc` da solo) non è un blocco: appartiene a quello
che la precede, ed è l'unico modo di indirizzare una lista o una tabella.

*Solo la tabella diventa variante.* Il criterio, dichiarato: serve (a) un
consumatore trasversale al formato che ne interroghi la struttura e (b) una
forma che `Custom` non regga. La tabella ha entrambi — 11, 11.4, 17, 6.3, 22.1
vogliono righe/celle/allineamento come tipo, e `Custom { blocks }` porta solo
blocchi mentre una cella porta inline. Non era "rappresentata alla grossa": era
**persa**, `Custom("table")` di `Custom("block")` senza allineamento né celle.
Footnote e definition list non hanno né l'uno né l'altro e restano `Custom`, con
i `custom_kind` registrati come costanti nel contratto (`custom_kind::*`) e
documentati; il parser ora le produce davvero, che è la parte senza la quale la
decisione sarebbe stata a vuoto. Promuoverle resta additivo; per la tabella no,
perché lì era già un bug.

*L'embed è del riferimento, non del bersaglio.* `embed` esce da
`LinkTarget::Wiki` e sale su `Link`/`Inline::Link`: la stessa nota si linka e si
incorpora nella stessa pagina, e finché il flag stava nella variante wiki
`![](immagine.png)` non aveva modo di dirlo — infatti **le immagini non entravano
affatto in `links`**, e il §2.21 lasciava 13.1 fuori portata non perché il path
non fosse un arco ma perché quell'arco non veniva raccolto. Ora ci entrano. E la
specie del bersaglio la decide il contratto (`LinkTarget::classify`), non
`url.contains("://")` dentro un provider: `mailto:` non ha `//`, `C:\foto\a.png`
sembra avere uno schema, e un secondo provider poteva rispondere un'altra cosa
sulla stessa stringa.

*Le proprietà non indovinano.* `PropertyValue` (+ `PropertyScalar` per le voci
di elenco, perché il confine non ammette tipi ricorsivi e per le proprietà
l'arena sarebbe sproporzionata) normalizza il frontmatter senza sostituirlo: la
verità grezza resta il JSON. Solo l'ISO-8601 a larghezza fissa è una data
(`2026-7-5` no: un parser tollerante trasformerebbe in date le stringhe
dell'utente), la data è scomposta perché 10.4 raggruppa per giorno, il fuso è
quello scritto — convertirlo vuole una capacità dell'host (§1.4) — e l'unica
stringa che cambia specie è il wikilink, che è la "proprietà relazione" di 8.2.
Un URL resta `Text`: 8.2 ha sia "proprietà URL" sia "proprietà testo", e
sceglierle è lo schema per tipo nota, non un indovinello del parser.

*Il presidio.* `wit_conformance` non compila su divergenza (i match sono
esaustivi e i tipi attesi li deduce il compilatore) e confronta abi↔WIT nelle
due direzioni; il round-trip dell'arena copre le forme nuove; venti casi sul
parser vero misurano span e simboli sulla sorgente. `wit_additivity` è diventato
rosso — come deve, perché questo commit **cambia la forma di cose già
pubblicate** (l'ancora dentro ogni record di blocco, `items` della lista,
`thematic-break` da payload nudo a record, `embed` fuori da `link-target-wiki`)
— e la linea di base `wit/frozen/0.1.0.wit` è ritagliata qui dentro, che
pre-freeze è la procedura dichiarata: la rottura si vede in review invece di non
vedersi affatto. Dopo M4 questa stessa voce sarebbe stata una major.

*Resta fuori, dichiarato:* il kernel non risolve ancora `[[Nota#^ancora]]`
contro `anchors` (è §1.6/§2.x: qui c'è il dato, non la query), l'HTML grezzo
entra nel modello come dato ma nessuno lo disegna (5.3), e l'anteprima di un
allegato resta un segnaposto finché non c'è il modello degli asset (§2.2).

### 1.6 `IndexQuery` — il canale dati verso le view

- [x] **Grafo**: `IndexQuery::Neighbors { doc, direction, depth, page }` —
      camminata in ampiezza sul `LinkGraph`, con `NeighborRef { doc, via, depth }`
      (il `via` è l'anello precedente: senza, oltre il primo passo la risposta è
      un sacchetto di nodi invece di un albero). Primo cliente: `graph_data`, che
      non prende più gli archi da `Workspace::outgoing` — cioè da una scorciatoia
      che un plugin non ha (7.3).
- [x] **Proprietà**: `IndexQuery::Properties { filter, sort, select, page }` e
      `PropertyValues { key, filter, page }`, servite dal kernel dal frontmatter
      già in cache. `PropertyTest` è un variant (`exists`, `missing`, `equals`,
      `not_equals`, `contains`, `>`, `<`) su `PropertyValue` del §1.5; le
      faccette contano **sul sottoinsieme filtrato** e un elenco conta per ogni
      suo elemento. Regole in un posto solo (`kernel/properties.rs`): specie
      diverse non si confrontano (falso, non errore), chi non ha la chiave
      ordina in fondo in entrambi i versi, la parità la rompe il `DocId` — o una
      risposta paginata non è stabile.
- [x] **Full-text con ambito**: `FullText { query, scope, page }` con
      `SearchScope { folders, tags }` applicato **dentro tantivy** (nuovo campo
      `folder` con ogni cartella antenata, schema v3), non post-filtrato: il
      totale e le pagine restano veri.
- [x] **Salute del vault**: `VaultHealth { check, page }` con `broken_links` e
      `orphan_documents` dal grafo e dai link in cache; `HealthIssue` porta la
      destinazione **com'era scritta** e lo span, che è ciò che serve per
      correggerla.
- [x] **Paginazione**: `Page { offset, limit }` nella domanda, `Paged { items,
      offset, total }` nella risposta, `None` = tutto. Chi sa paginare alla
      sorgente lo fa (tantivy: collector con offset + `Count`); il kernel
      ritaglia con `Paged::window`. Fuori solo `Outline`, che cresce con un
      documento e non col vault.

*Trovato per strada e chiuso:* gli enum del contratto con tag interno e variante
a scalare (`PropertyValue::Text`, `LinkTarget::Url`, `Inline::Text`) **non erano
serializzabili** in JSON — `serde_json` fallisce a runtime su un newtype
taggato. Latente finché nessuno li metteva sul filo; questa voce li ci mette.
Ora il tag è adiacente (`kind` + `value`) e un round-trip in `abi/model.rs`
elenca ogni variante.

*Resta fuori, dichiarato:* le **faccette sul risultato full-text** (contare i
tag di un insieme di hit) — servono un campo facet in tantivy e la decisione di
chi le calcola, e oggi la stessa domanda si fa con `Tags`/`PropertyValues`; il
**join fra full-text e proprietà** ("le note `tipo: progetto` che parlano di
rust"), che è il query engine del §2.17/9.2 e non un campo in più qui; gli
**allegati inutilizzati** di 7.2, che presuppongono il modello degli asset
(§2.2) — oggi un PNG nel kernel non esiste, e infatti un riferimento a un
allegato non viene contato fra i link rotti (sarebbe un falso positivo per
immagine); le **ancore rotte** (`[[Nota#^blocco]]` verso un blocco sparito), che
sono la coda del §1.5.

### 1.7 Import/export come trait, non come codice dell'app

- [x] **`ImportProvider`** (`can_handle(source) -> bool`, `import(source,
      request, host) -> Result<ImportReport>`) e **`ExportProvider`**
      (`targets() -> Vec<ExportTarget>`, `export(request, host)`), in
      `abi/transfer.rs` e rispecchiati nel WIT (`transfer`, `importer`,
      `exporter`, più due export del world: tutto additivo, la linea di base non
      si tocca).
- [x] **`ImportReport` nel contratto, e niente `MigrationPlan`**: il piano *è*
      il rapporto di una prova a vuoto (`ImportMode::Preview`). Log
      (`TransferNote { level, message, entry }`), esiti per documento
      (`ImportOutcome`) e politica dei duplicati (`ConflictPolicy`) stanno qui e
      non nel primo importer. Rollback e resume no: sono §1.12 + §2.5.
- [x] Primo cliente vero: `MarkdownImport`/`MarkdownExport` in
      `fubmd-format-markdown`, registrati nel `Workspace`
      (`register_import_provider` / `register_export_provider`) e provati
      end-to-end contro il kernel — preview che non scrive, tre politiche di
      conflitto, selezione per cartella e per query, export con e senza
      metadati, round-trip vault→artefatti→vault.

*Sblocca:* 17 (~120 voci), 6.3 (export PDF/Pandoc/Typst), 15.1 (BibTeX/CSL),
14.3 (email/EML), 11.4 (CSV/JSON).

**Fatto, con quattro decisioni che valgono per tutte e centoventi le voci.**

*Il confine è di byte, non di path.* Una sorgente arriva **già letta**
(`ImportSource { name, media_type, bytes }`) e un export esce come
`ExportArtifact { path, media_type, bytes }`, dove `path` è il posto *dentro
l'esito*. Chi apre il dialogo di sistema e chi posa i byte è l'host — che è già
l'unico a sapere dov'è il vault. La conseguenza è quella che conta: il capitolo
che in ogni altra applicazione tocca il filesystem più di tutti **non chiede
nessuna capacità filesystem**, e a M5 la sandbox non deve concedere niente. Un
`path: String` nella firma sarebbe stato il contrario: una porta da richiudere
con una major. Prezzo dichiarato: sorgente e artefatti stanno in memoria, e uno
`stream` al confine resta additivo.

*Il piano è il rapporto di una prova a vuoto.* 17.3 chiede preview, validation e
pre-migration report; la risposta non è un `MigrationPlan` gemello di
`ImportReport` — due tipi che dicono la stessa cosa in due momenti divergono al
primo campo aggiunto a uno solo — ma `ImportMode { Preview, Apply }`, con lo
stesso rapporto in uscita e la modalità dentro, così chi lo legge non deve
ricordarsi la domanda. Il rapporto non porta un conteggio (`documents` lo è già)
né un id di lotto: `changed()` nomina i documenti toccati, che è l'input di cui
il rollback avrà bisogno, e il rollback è §1.12.

*L'errore è «non ho potuto cominciare».* Sorgente illeggibile o destinazione
ignota sono `PluginError`; un documento saltato per conflitto, una riga di CSV
malformata, un allegato che non c'è sono `ImportOutcome`/`TransferNote` dentro
un rapporto valido. Un import di 4000 note che ne perde 3 è riuscito con tre
problemi, e chiamarlo fallito costringerebbe ogni importer a inventarsi il
proprio modo di dirlo.

*L'import scrive, l'export legge, e si vede dalla firma.* `import` è `&mut self`
(17.3 chiede resume e retry: un provider che riprende ricorda — con `&self`
quella famiglia sarebbe chiusa dalla firma, che è il difetto imputato a
`ViewProvider` nel §1.30); `export` è `&self` con un host in sola lettura,
quindi il kernel lo serve sotto prestito **condiviso** come `render_view`: un
export lungo non mette in coda le letture dell'app. Il dispatch dell'import
chiede esplicitamente `can_handle` invece di dedurlo da un `BadArgs` come fa
`query_index`, perché una sorgente si riconosce **senza** provare a importarla —
e provare, qui, vuol dire scrivere. I byte stanno dentro `ImportSource` e non
solo nel parametro di `import` perché `.docx`, `.epub`, `.odt` e mezzo mondo dei
backup sono lo stesso contenitore zip: un dispatch sul solo nome sceglie il
provider sbagliato.

*Trovato per strada e chiuso:* `KernelHost::read_document`/`write_document`
**non validavano il `DocId`**. Fino a qui l'unico input esterno che diventava un
`DocId` passava dai comandi IPC, che lo sanitizzano; un importer invece nomina i
documenti a partire dal nome di una sorgente, cioè da una stringa che l'utente
non ha scritto — e `../../.ssh/authorized_keys` non sarebbe stato un `DocId`
fantasma, sarebbe stata una scrittura fuori dal vault. Ora il confine delle
capacità applica `valid_doc_id` e risponde `PermissionDenied` come fa `data_*`,
e `ImportSource::stem()` riduce il nome a un componente solo perché non ci si
arrivi per distrazione.

*Chiesta dall'import, e concessa:* `HostApi::free_name`. La convenzione D3
(`nome`, `nome 1`, …) la sa solo il vault, che conosce l'occupato in memoria
**e** sul disco; un importer che risolvesse `ConflictPolicy::Rename` rifacendola
darebbe nomi diversi da `create_note` e dal ripristino dal cestino. Con ~50
importer nel solo 17.1, l'alternativa erano cinquanta convenzioni. È una voce in
più nell'elenco del §1.4, trovata come il §1.4 dice che si trovano: da un
cliente vero.

*Resta fuori, dichiarato:* **rollback e resume** (§1.12 + §2.5: senza lotto e
senza journal, un `batch_id` qui sarebbe un campo che nessuno consuma — e un
import di N documenti emette oggi N eventi, che è esattamente il debito del
§1.12); il **lavoro lungo** (§1.21: un import gira nel giro sincrono, quindi un
vault Obsidian da 4 GiB non entra — e non deve, finché un job non vede il
vault); il **modello parsato** a un exporter (§1.28: l'export markdown vuole la
sorgente com'è, ma un export PDF/Typst dovrebbe riparsare per conto proprio); i
**contenitori** (zip, cartelle: una sorgente per volta — la firma regge N
documenti in un rapporto, il primo cliente non ne ha bisogno); e la
**superficie IPC**, perché senza il dialogo di sistema sarebbero due comandi
Tauri senza chiamanti — cioè la scorciatoia bespoke contro cui è scritto il
piano. La quarta copia del protocollo di dispatch nel `Workspace` è il prezzo
già previsto dal §2.8.

### 1.8 Stringhe e localizzazione al confine — decisione, non implementazione

- [ ] **Decidere ora chi localizza**: oggi un `ViewProvider` restituisce
      `UiNode::Text { content: "Nessun backlink" }` — testo italiano cablato
      dentro il provider. Con la localizzazione (25.2) o i provider ricevono un
      `locale` e traducono, o restituiscono **chiavi** che la shell risolve. È
      una scelta di forma dei tipi: dopo il freeze si cambia solo con una minor.

### 1.9 Contesto di una view — `active_document()` non regge tab, split né selezione

- [x] **Forma del contesto decisa**: `HostApi::active_context() -> Option<ViewContext>`
      con `ViewContext { pane: PaneId, doc: Option<DocId>, selection:
      Option<Selection>, mode: PaneMode }` (`abi/session.rs`, interface `session`
      nel WIT). `active_document` non esiste più: due firme per la stessa
      domanda sarebbero state la trappola che questa voce descrive.
- [x] **La selezione attraversa il confine**: `Selection { span: Option<Span>,
      text: String }`. Il ponte inverso code unit → byte del §3.7
      (`charToByteIndex` in `frontend/src/offsets.ts`) è stato scritto qui, con
      i suoi test: era il prerequisito, e senza di esso lo `Span` non si sapeva
      nemmeno costruire.
- [x] **Chi imposta il contesto resta la shell**, e la chiave è il pannello:
      `Workspace::set_active_context(Option<ViewContext>) -> Vec<String>` (gli id
      delle view da ridisegnare), comando IPC `set_active_context`. Il
      `PaneId` è nel contesto anche se questa shell ha un pannello solo: quando
      ne avrà due, il contratto non cambia.
- [x] **`ViewSpec.follows: ContextMask`**: la metà mancante del protocollo.
      Senza, "la shell ridisegna al cambio di nota attiva" diventa "ridisegna a
      ogni battuta di tasto" appena il contesto porta la selezione.
- [x] Clienti veri nello stesso giro: l'**outline** segna la sezione in cui sta
      il cursore, il pannello **statistiche** (`fubmd-features/src/stats.rs`,
      quarto `ViewProvider` ufficiale) conta le parole della selezione e cambia
      faccia in lettura. La shell pubblica il contesto vero: tre modalità
      (Sorgente / Live / Lettura) commutabili dalla barra.

*Sblocca:* 3.3 (tab, split, finestre, note history per pane), 4.1 (modalità
per-nota e per-pane), 4.2-4.3 (azioni sulla selezione), 13.3, 22.2.

**Fatto, con cinque decisioni e un debito dichiarato.**

*Il contesto è un record, quindi si riempie adesso.* Un caso in fondo a un enum
dopo il freeze è una minor; **un campo in più a un record è una migrazione di
ogni provider che lo riceve**. I quattro campi sono perciò tutti qui — pannello,
documento, selezione, modalità — e non un sottoinsieme da completare dopo. È la
stessa ragione per cui `select` è entrato in `IndexQuery::Properties` al §1.6.

*La regola dello span: `text` sempre, `span` solo se vero.* Una selezione ha
coordinate del **buffer**; il kernel conosce il **file salvato**. Finché
coincidono lo span c'è; appena il buffer è sporco lo span sparisce e resta il
testo. Non è prudenza: un contratto che desse sempre lo span inviterebbe ogni
consumatore a fare `read_document` + ritaglio, cioè a tagliare i byte sbagliati
**proprio mentre l'utente scrive** — che è l'unico momento in cui la selezione
serve. Scartato un `dirty: bool` accanto allo span: un flag che chiunque può
dimenticare di leggere protegge meno di un campo che, quando non è vero, non
c'è. L'invariante è tenuta dai due lati: la shell non pubblica lo span a buffer
sporco, il kernel lo lascia cadere quando il sorgente sotto cambia, viene
rinominato o sparisce (`invalidate_context`), e la shell lo ripubblica al
salvataggio successivo.

*Le maschere sono due perché i fatti sono di due specie.* `refresh: EventMask`
sono gli eventi del **vault**; `follows: ContextMask` (documento, selezione,
modalità) sono i fatti della **sessione**. Tenere il contesto fuori dall'event
bus non è pulizia: farlo passare di là significherebbe consegnare ogni movimento
del cursore a ogni `EventHandler` registrato — versioning compreso. Nessun caso
per il pannello: cambiare pannello vale come cambio di tutto, e un caso a parte
inviterebbe a dichiarare di seguire il pannello senza seguirne il contenuto. La
prova che la maschera serve è il pannello tag, che dichiara **niente**: la
distribuzione dei tag del vault è la stessa da ogni punto di ogni nota.

*Chi ridisegna cosa lo dice il kernel.* `set_active_context` restituisce gli id
delle view da ridisegnare. Il conto poteva stare nella shell — ha già il
contesto precedente — ma la regola sarebbe esistita in due copie, una in
TypeScript e una a M5 in qualunque altro host, e sarebbero divergite. La shell
resta padrona del *quando* (pubblica lei, con un debounce di 150 ms sul cursore)
e ignara del *chi*: `refreshAllViews()` a ogni salvataggio è sparito dal
frontend, ed era il ridisegno cieco che il §1.2 imputa alla shell.

*La modalità è un enum chiuso a tre.* Sorgente, Live Preview, Lettura: le tre
esclusive di 4.1. Focus mode, zen, typewriter, schermo intero non sono modalità
ma disposizioni della shell — non cambiano *cosa* un provider deve fare. Una
quarta esclusiva (WYSIWYG, block editor) è un caso in fondo, cioè additiva. Per
non lasciare il campo senza produttore vero, la shell ha ora il commutatore a
tre: Sorgente spegne la resa inline (un `Compartment` di CodeMirror, niente
editor ricostruito), Lettura mette il documento **reso** al posto dell'editor,
nello stesso spazio. Con questo il **pannello anteprima sparisce dalla colonna
di destra**: era una seconda superficie sullo stesso documento, sempre accesa e
sempre da tenere allineata, mentre "esclusive" è ciò che `PaneMode` dichiara.
Entrare in lettura fa prima un flush del buffer, perché il documento reso lo
produce il kernel dal sorgente salvato e leggere la nota di un minuto fa non
sarebbe leggerla. E i colori sono **gli stessi** — fondo, testo e titoli: la
tavolozza della superficie
del documento (`--doc-*` in `style.css`) è ora l'unico posto dove sono scritti,
e la legge sia la resa di Lettura sia il tema della live preview sia il fondo
dell'editor — tre modalità della stessa nota non possono essere di tre colori
diversi, e due copie degli stessi hex divergono al primo ritocco.

*Trovato per strada e chiuso (guardando l'app girare):* riaprire **lo stesso
vault** dal dialogo piantava l'app per sempre. `open_vault` costruiva la
sessione nuova e solo alla fine sostituiva la vecchia, ma l'indice di ricerca
tiene un lock esclusivo di scrittura sulla propria cartella e tantivy quel lock
lo aspetta *bloccando*: nessun errore, nessun log, la finestra a metà. Ora la
sessione vecchia si chiude prima che la nuova si apra — col prezzo dichiarato
che se l'apertura fallisce non si torna indietro. Nello stesso giro: un avvio
che fallisce non muore più in silenzio (`init().catch`), e la **modalità del
pannello** si ricorda fra le sessioni in `localStorage`, come le cartelle aperte
e lo spazio selezionato (è stato di vista, non organizzazione del vault).

*Trovato per strada e chiuso:* il **ponte inverso** del §3.7 non c'era.
`offsets.ts` sapeva solo byte → code unit; senza l'inversa nessuna azione
dell'editor può nominare uno `Span`, ed è per questo che il §1.9 aveva quel
prerequisito. Ora c'è (`charToByteIndex`), con i test che provano l'andata e il
ritorno su accenti ed emoji.

*Resta fuori, dichiarato:* **legare una view a un pannello** (due pannelli
backlink affiancati) è il §1.15 — questo giro dà l'identità del pannello nel
contesto, non le istanze di view; l'**evidenziazione** della sezione corrente
nell'outline usa il sottotitolo di un `ListItem` perché `UiNode` non ha una
nozione di elemento corrente, ed è roba del §1.2/§3.9; il **multi-cursore e le
selezioni multiple** (4.2) — `Selection` ne porta una, e la seconda sarebbe
`list<selection>`, cioè additiva solo cambiando il tipo del campo: qui la scelta
è dichiarata, non dimenticata (una shell con più cursori pubblica quello
primario finché non arriva 4.2); il **conflitto buffer↔disco** (§3.7), che resta
custodito da un flag della shell — il contesto ne subisce l'effetto (niente
span) ma non lo risolve.

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

- [x] **`Workspace::batch(|ws| …)` con un evento terminale**: il caso reale c'è
      già. `rename_document` scriveva N sorgenti e ognuna emetteva
      `DocumentChanged` + `IndexUpdated` drenando la coda; sul confine una
      rinomina con 200 backlink erano ~400 eventi, e la shell reagiva a
      **ciascun** `index_updated` con un `list_documents` più il ridisegno di
      ogni view iscritta. Non è un problema di UI: è che il kernel non aveva
      modo di dire "queste N scritture sono una cosa sola".
- [x] **Semantica di annullamento**: decisa, ed è *nessuna* — a verbale, sotto.
- [x] **Variante di evento nel contratto**: `Event::BatchEnded { batch, changed }`
      + `EventKind::BatchEnded` (additivi, in coda), che `ViewSpec.refresh`
      dichiara come ogni altro.
- [x] **Un cliente vero nello stesso giro**: `rename_document` (che *è* un
      lotto), ogni `invoke_command(…, Apply)` — quindi `vault.replace` su N note
      — e la shell, che ridisegna una volta.

*Sblocca:* 7.2 (bulk fix, cleanup wizard, ~30 voci), 11.3 (editing bulk, undo
database), 16.3 (undo delle automazioni), 17.3 (rollback, resume), 24.1.

**Fatto insieme al §1.18, con quattro decisioni e un residuo dichiarato.**

*Un lotto è uno scope del kernel, non una capacità del confine.* `Workspace::batch(|ws| …)`
c'è; `HostApi::batch` no, e non per parsimonia: uno scope a chiusura garantita
**non attraversa il confine dei componenti**. Un plugin che aprisse un lotto e
non lo chiudesse — perché sbaglia, perché trappa, perché a M5 la sua istanza
muore — lo lascerebbe aperto per sempre, e con esso ogni evento del vault
sospeso in attesa di un terminale che non arriva. Il lotto di un plugin è quindi
la sua **invocazione di comando**, che l'host apre e chiude per lui: è anche la
risposta giusta nel merito, perché «una cosa che qualcuno ha chiesto» è
esattamente cosa significa invocare un comando. Chi lo apre, oggi: il kernel per
sé (`rename_document`) e `invoke_command` per ogni `Apply`. Annidato, un lotto
**entra** in quello che c'è invece di aprirne un secondo — chiudere l'interno
farebbe arrivare un `batch-ended` mentre l'operazione esterna è ancora in corso.

*Il lotto coalizza `index-updated` e nient'altro.* È l'unico evento del contratto
**senza payload**, cioè l'unico di cui N copie dicono esattamente quanto ne dice
una; gli eventi per-documento continuano a passare tutti, quindi **nessun
handler esistente deve cambiare una riga**. La misura sul caso vero: una rinomina
con 200 backlink passa da ~401 eventi e **201 ridisegni completi** a 201 eventi e
**1 ridisegno**. Non è "400 eventi → 1", ed è giusto che non lo sia: i 200
`document-changed` sono l'unica cosa che dice a chi tiene stato per-documento
*quale* documento; a costare erano i ridisegni, e quelli sono uno.

Il prezzo, ed è l'unico punto non additivo di tutta la voce: chi si era abbonato
al **solo** `index-updated`, dentro un lotto non riceve più niente — e il sintomo
sarebbe il peggiore possibile, un pannello che smette di aggiornarsi *soltanto*
dopo una rinomina con backlink o una sostituzione in blocco. L'alternativa
(emettere tutti e due) avrebbe fatto costare a ogni lotto due ridisegni completi,
cioè il costo che la voce esiste per togliere. Perciò la regola è una sola —
*chi dichiara `index-updated` dichiara anche `batch-ended`* — e non è una nota
nella prosa: è `EventMask::misses_batches()` nel contratto e un test su ogni view
ufficiale (`fubmd-features/tests/view_refresh_masks.rs`), con la stessa funzione
che un plugin chiama sulla propria maschera.

*Un lotto non è una transazione, e non si chiama come una.* Niente `tx`, niente
`rollback`: se una delle N scritture fallisce le altre restano fatte, e chi ha
aperto il lotto se ne accorge dal **proprio valore di ritorno**, che `batch` gli
passa intatto. La ragione non è che il tutto-o-niente non serva — serve a import,
bulk fix e migrazioni, e il §1.12 lo diceva — ma che **non è promettibile senza
il journal del §2.5**: un annullamento che non sopravvive alla morte del processo
non è un annullamento, e prometterlo con un nome significherebbe farlo credere a
chi legge solo la firma. Chi sceglie, quindi, resta chi apre il lotto e conosce
il proprio caso: `rename_document` applica tutto e nomina i falliti (giusto per
lui: abortire a metà lascia link misti senza retry), e il giorno che l'importer
vorrà l'opposto avrà il journal, non un `bool` qui. Il materiale c'è già —
`EditReport::inverse()` del §1.16 — e la decisione di chi lo conservi è il §1.17.

*Il dispatch è rimandato alla chiusura, e questo ha cambiato un comportamento
esistente.* Dentro un lotto il vault è a metà di un'operazione, e un handler che
vi reagisse vedrebbe uno stato che non è mai esistito per nessuno. La conseguenza
si vede su un test del §1.16 che ora dice l'opposto di prima
(`apply_edit.rs`): un handler che scriveva in una sorgente mentre la rinomina non
l'aveva ancora riscritta ne rendeva stantia la `base`, e la rinomina falliva *per
quella sorgente*. Era il comportamento giusto per il contratto di allora — la
corsa esisteva davvero, e il §1.16 la rendeva visibile invece di far sparire una
riga in silenzio. Il lotto la toglie **a monte**: le due scritture adesso
riescono tutte e due invece di dover scegliere. La guardia della `base` non è
diventata inutile — copre chi scrive *fuori* dal giro (un'altra app, un job che
rientra) — e resta provata.

*Un lotto troncato dall'`Overflow` non ha una garanzia in più.* Il terminale sta
in coda come ogni altro evento, e se il budget del dispatch si esaurisce può
essere fra i persi. L'`Overflow` che arriva al suo posto dice «riconcilia da
zero», che è una richiesta **più forte** di «ridisegna questi documenti»: una
garanzia speciale per il solo `batch-ended` sarebbe una seconda promessa più
debole accanto a una che già copre il caso.

*Resta fuori, dichiarato:* l'**annullamento** e il **resume** (§2.5 + §1.17: il
journal è il meccanismo, e questa voce ne prepara la forma senza prenderne la
decisione); il **lotto aperto da un plugin** (vedi sopra: è la sua invocazione di
comando); il **lotto che attraversa il giro sincrono** (§1.21: un import gira
dentro una chiamata, e un lotto che durasse quanto un job terrebbe gli eventi
sospesi per minuti); lo **snapshot per lotto** del versioning (§1.17 — oggi il
versioning fa uno snapshot per `document-changed`, che dentro un lotto sono
ancora N: raggrupparli in una voce sola di cronologia vuole un campo nel formato
persistito, cioè una `SCHEMA_VERSION` nuova, e non è una firma).

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

- [x] **La primitiva c'è**: `HostApi::apply_edit(id, EditRequest)` con
      `EditRequest { base: Revision, edits: Vec<TextEdit> }` e
      `TextEdit { span, text }` (`abi/edit.rs`, interface `edit` nel WIT).
      Accanto, `HostApi::document_revision(id)`: la base la si **chiede**,
      perché la revisione è opaca e derivarla è affare dell'host.
- [x] **La firma dice su cosa si applica**, e non come campo opzionale: senza
      base non si scrive. Chi arriva secondo riceve `PluginError::Conflict` —
      caso nuovo del contratto, additivo — rilegge e ricalcola, invece di
      cancellare il lavoro di chi ha scritto per primo.
- [x] **Un cliente vero nello stesso giro**: la riscrittura dei wikilink su
      rename. `link_rewrite_plan` calcolava già gli span dei link e poi ne
      ricomponeva la sorgente intera; ora produce un `EditRequest` per sorgente
      e `rename_document` lo applica. Il guadagno è visibile in un test: se un
      handler scrive in una delle sorgenti del piano mentre il piano è in corso,
      la sua riga **resta** e il rename nomina la sorgente che non ha potuto
      riscrivere, invece di sovrascriverla in silenzio.
- [x] **L'inverso di un edit è un edit**: `EditReport { revision, applied }`
      torna nelle coordinate del testo nuovo e porta ciò che era stato
      sostituito, quindi `inverse()` è una `EditRequest` come le altre — con per
      base la revisione appena prodotta.

*Sblocca:* 4.3, 7.2 (bulk fix), 8.2, 10.1, 11.3, 16.1 (cursor placement), 19.2,
22.2; ed è la primitiva su cui poggiano §1.12 (il lotto è una lista di edit) e
§1.17 (l'undo).

**Fatto, con quattro decisioni e un debito dichiarato.**

*La base non è opzionale.* Poteva esserlo — un `Option<Revision>` con `None` =
«applica e basta» avrebbe fatto contenti i chiamanti che il documento l'hanno
appena letto. Ma la corsa che questa voce descrive è **invisibile**: chi
sovrascrive il lavoro di un altro non se ne accorge, e un campo che si può
omettere lo si omette proprio nel caso lungo (l'automazione che calcola per un
minuto), che è l'unico in cui serve. Il prezzo dichiarato: una chiamata in più
(`document_revision`) per chi vuole scrivere in fondo a una nota senza averla
letta.

*La revisione è un'impronta del contenuto, ed è opaca.* Opaca perché di essa è
contratto **solo l'uguaglianza**: un host che la derivasse da un digest o da
`mtime+size` sarebbe conforme uguale, e per questo un provider la chiede invece
di calcolarla (`Revision::of` esiste, ma è come la deriva *questo* host — sta
nell'abi perché kernel e doppi dei test ne abbiano una sola implementazione).
Impronta e non contatore perché la domanda vera è "*è ancora quel testo?*", non
"*quante volte è stato scritto?*": chi digita una lettera e la cancella riporta
il documento a com'era, e un edit calcolato allora è ancora valido. Il caso non
è teorico — è la stessa proprietà per cui il piano di rename, calcolato sul
sorgente al path vecchio, si applica al path nuovo: un rename sposta il file, non
lo cambia.

*Gli edit sono un insieme in coordinate della base.* Non una sequenza di passi:
chi li calcola non deve tenere il conto di quanto il testo si sposta per via
degli altri — li elenca in qualunque ordine, l'host ordina e applica in un colpo
solo. Ciò che non sta in piedi (fuori dal sorgente, **a metà di un carattere**,
sovrapposti, due nello stesso punto) è `BadArgs`, mai un documento modificato a
metà: un taglio dentro un UTF-8 non produce un documento sbagliato, produce byte
che non sono testo e una nota che non si riapre.

*Il conflitto è un errore, non un campo del rapporto.* La stessa ragione del
`dirty: bool` scartato al §1.9: un `applied: false` dentro un esito riuscito si
dimentica di leggere. Ed è un caso a sé di `PluginError` e non un `BadArgs`
perché è l'unico errore del confine che **non è una colpa di chi chiama** — gli
argomenti erano giusti quando li ha calcolati, e la risposta giusta è
ricalcolare, non correggere. Chi non li distingue riprova all'infinito una
richiesta malformata, o rinuncia a una che sarebbe riuscita.

*Resta fuori, dichiarato:* il **lotto su più documenti** (§1.12 — una richiesta
nomina un documento solo, e N documenti restano N scritture con N eventi: il
rename ne è la prova, e il lotto sarà una lista di edit *sopra* questa firma);
la **proprietà dell'undo** (§1.17 — qui c'è la forma dell'inverso, non chi la
usa); l'**edit sull'evento** (§1.18), e con esso il costo che questa voce
descriveva dal lato della shell: finché `DocumentChanged` dice *che* un
documento è cambiato e non *come*, l'editor che lo ha aperto deve ricaricarlo
intero (`reloadIfClean`) e il cursore salta lo stesso — la primitiva non basta
da sola, serve che il kernel racconti la modifica; la **superficie IPC**, perché
i clienti di shell che ci sarebbero (spuntare un task, correggere un link
dall'anteprima) chiedono al modello lo stato di spunta (§1.5) e alla UI dei
campi di input con un payload vero (§1.2/§3.9), e nessuno dei due c'è; la
**fusione** di due edit concorrenti (18.1): qui il conflitto si dichiara, non si
risolve.

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
- [ ] Il §1.16 ha già dato la **forma dell'inverso** di una modifica al testo
      (`EditReport::inverse()` è una `EditRequest` come le altre, con per base la
      revisione appena prodotta): quello che manca è chi la conserva, per quanto,
      e chi vince fra le due pile.

### 1.18 Gli eventi non dicono chi li ha causati

- [x] **`Event::DocumentChanged { id }` non portava origine né causalità.** Ora
      un handler riceve un `Notice { event, origin }`, e la shell l'origine la
      **legge**: `document_changed` con `actor: watcher` significa «un'altra
      applicazione ha scritto questo file», che col buffer sporco è un avviso
      diverso da «l'abbiamo riscritto noi».
- [x] **Con i trigger diventa un requisito**: la difesa non è più il
      `DISPATCH_BUDGET` che tronca. `Actor::is_plugin(id)` risponde alla domanda
      «questa l'ho scritta io?», ed è provata su un'automazione che senza di essa
      si richiama da sola fino al troncamento
      (`fubmd-kernel/tests/batch_and_origin.rs`).
- [x] **Un campo `origin`**: `Origin { actor: Actor, batch: Option<BatchId> }`,
      con `Actor { User, Watcher, Kernel, Plugin { id } }` — l'elenco che questa
      voce chiedeva — e l'id di lotto del §1.12 sullo stesso record.

*Sblocca:* 16.2 (trigger su-modifica che non si richiamano da soli), 18 (sync),
19.2 (collaborazione), 22.4 (l'attribuzione, di cui questo è il primo pezzo).

**Fatto insieme al §1.12, con tre decisioni e una firma pubblicata ritagliata.**

*L'origine viaggia su OGNI evento, in un record accanto ad esso.* Non solo sul
terminale del lotto: il requisito di 16.2 è che un handler decida **mentre
reagisce**, e un'origine che arrivasse solo alla fine gli direbbe chi è stato
dopo che ha già riscritto. E in un `Notice { event, origin }` invece che in un
campo dentro ogni variante, perché l'origine è ortogonale a *cosa* è successo:
ripeterla in nove casi avrebbe costretto ogni `match` a destrutturarla anche dove
non la guarda.

*L'attore è chi ha CHIESTO, non chi ha eseguito.* È la decisione che dà al campo
il suo unico lettore vero. Quando un'automazione invoca `vault.replace`, i
documenti li scrive il comando — ma se l'origine dicesse "il comando", quella
automazione non riconoscerebbe le proprie scritture e si richiamerebbe da sola,
che è esattamente il caso per cui il campo esiste. Perciò: un `EventHandler` che
scrive di propria iniziativa è `Plugin { id }`; un comando invocato è l'attore
del **chiamante**; il watcher è `Watcher` perché quella scrittura non è passata
da noi; e ciò che il kernel fa per conto suo (apertura, `job-done`, `overflow`) è
`Kernel` — intestarlo a chi stava scrivendo direbbe a un'automazione «questa
l'hai causata tu» proprio nel momento in cui le si chiede di riconciliare.

*L'origine accompagna l'invocazione di un comando — e sì, si fa adesso.* Era la
quinta domanda, quella che tocca una firma già pubblicata:
`invoke_command(command, args, mode, by: Actor)`. Sì, per la ragione del
paragrafo sopra: senza, ogni invocazione sarebbe attribuita a chi la esegue o a
un default, e la CLI (27.1), l'API locale (27.2) e le automazioni (16.2) —
cioè i chiamanti per cui il registro del §1.1 esiste — nascerebbero tutti
travestiti da utente. Che sia un parametro e non un default è la stessa scelta di
`InvokeMode`: un'attribuzione implicita è l'errore che il tipo esiste per rendere
impossibile. Sul confine Tauri l'attore **non** è un parametro dell'IPC ma è
fissato a `User`: da quel canale passa la webview, e un chiamante che potesse
firmarsi come vuole avrebbe aggirato l'unica difesa che 16.2 ha.

Ciò che invece **non** cambia è `CommandProvider::invoke`: l'origine è ciò che
l'host *appone*, non ciò che il comando *legge*, e un comando che si comportasse
diversamente a seconda di chi lo chiama sarebbe una policy (§2.10) nascosta
dentro un'implementazione. Il giorno che servirà leggerla, è un metodo additivo
sull'`HostApi` — non una firma da riaprire.

*La linea di base è stata ritagliata, e si vede in review.* `event-handler.handle`
prendeva un `event` nudo e adesso prende un `notice`: è l'unica rottura del giro,
sta in `wit/frozen/0.1.0.wit` con la ragione accanto, e il test di additività la
tratta come tale. Aggiungerla dopo il freeze sarebbe costata una major, o una
seconda funzione accanto alla prima con la stessa semantica e un argomento in
più. Tutto il resto è additivo: `batch-ended` in coda a `event` e a `event-kind`,
e i tipi nuovi (`notice`, `origin`, `actor`, `batch-id`, `event-batch-ended`).

*Resta fuori, dichiarato:* **quale comando** ha causato l'operazione, e con esso
il **prompt** e il **modello** di 22.4 — `Origin` porta l'attore e il lotto, non
l'id del comando: sono i campi di un audit trail, e un audit trail vuole un posto
che li **conservi** (il journal del §2.5), mentre un campo che nessuno rilegge
dopo la fine del giro è una decorazione. Additivo il giorno che il posto c'è, ed
è la ragione per cui la voce «attribuzione» del §1.36 resta aperta a metà: il
campo ha un lettore vero (l'automazione che salta le proprie scritture), l'audit
no. Fuori anche la **causalità a catena** (quale evento ha causato quale: `Origin`
dice chi, non da cosa) e l'**edit sull'evento** (chi riceve `document-changed` sa
che il documento è cambiato, non *come*).

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

### 1.28 Il modello parsato non arriva a nessun provider

- [ ] **Un provider vede la sorgente, mai la struttura.** L'`HostApi` dà
      `read_document -> String` (`abi/traits.rs:83`) e `query_index`; il
      `FormatProvider` vive nel kernel e non è raggiungibile da fuori
      (`kernel/workspace.rs:1335-1346`). Le uniche briciole di struttura che
      escono sono `IndexQuery::Outline` (gli heading) e `IndexQuery::Tags`
      (l'aggregato). **Il `DocumentModel` non attraversa il contratto in
      nessuna direzione.**
- [ ] **Quindi ogni feature che tocca il contenuto strutturato deve
      riscriversi un parser markdown**, cioè non può essere un plugin: task e
      spunte (10, ~90 voci), scrittura di una proprietà (8.2), flashcard da
      blocchi (21.2 FubFlashcards), citazioni e bibliografia (15.1), chunking
      per l'embedding (22.1), export in qualunque formato (17.2, ~45 voci),
      TOC e indici automatici (5.2), linting e statistiche (4.3). È lo stesso
      argomento del §1.22 — un'estensione di sintassi non può essere un plugin
      — applicato al **consumo** invece che alla produzione.
- [ ] **È il gemello lato provider del §1.13**, che pone la stessa domanda dal
      lato della shell: *chi vede il modello?* Oggi la risposta è «solo il
      kernel», e le due metà vanno decise insieme o si ottiene un modello che
      arriva alla webview e non al provider che deve lavorarci.
- [ ] La forma da scegliere ora: `HostApi::document_model(id)` oppure
      `IndexQuery::Model { doc }` — e con essa la risposta a *quale* modello,
      visto che la cache tiene i soli metadati (`workspace.rs:125-130`) e il
      corpo si riparsa dal disco. Un canale che riparsa a ogni chiamata è una
      firma diversa da uno che serve una cache, e la differenza si vede solo
      quando il chiamante cammina l'intero vault — cioè in ogni voce del 17.

*Sblocca:* 10 per intero, 8.2, 15.1-15.2, 17.2, 22.1-22.2, 5.2 (TOC, indici),
4.3, e il §1.7 (un `ExportProvider` senza modello esporta testo grezzo).

### 1.29 Il contratto non dice di che formato è un documento

- [ ] **Nessuna capacità restituisce il `FormatDescriptor` o le
      `FormatCapabilities` di un `DocId`.** Un provider che riceve una lista da
      `list_documents` non ha modo di distinguere una nota da un canvas, un
      CSV, un PDF o un allegato: non può decidere se sa lavorarci, e nemmeno se
      *deve* ignorarlo.
- [ ] Oggi non si vede perché il formato è uno solo. Serve appena ne esiste un
      secondo (12 canvas, 11.4 CSV/JSON, 13.2 PDF) e appena il vault contiene
      cose che documenti non sono (§2.2), cioè esattamente quando il §1.20
      aprirà `parse` ai formati non-testo.
- [ ] Va deciso con il §1.26 (`FormatCapabilities` come mappa con namespace) e
      con il §1.20: sono la stessa domanda — *cosa so di questo documento senza
      averlo aperto* — vista dal lato del vault invece che del parser.

### 1.30 Un `ViewProvider` non può avere stato: la firma glielo vieta

- [ ] **`render_view` *e* `on_action` prendono `&self`**
      (`abi/traits.rs:222-228`). Non è una svista del percorso di lettura: **un
      provider di view non può mutare sé stesso nemmeno in risposta a un
      click**. Filtro corrente, tab attiva, pagina, ordinamento, selezione,
      sezioni aperte, esito di un calcolo: niente ha dove stare, se non dietro
      interior mutability — cioè un `Mutex` che ogni autore di provider si
      inventa per conto suo, con la sua idea di cosa succede se il lock è preso
      durante un render.
- [ ] **È distinto dal §3.10**, che chiede *dove* vive lo stato di vista
      (settings, sessione, layout): questo dice che la **firma** lo esclude a
      monte, e che l'unico contenitore offerto dal contratto — `storage_*` — è
      volatile, a chiave→valore, senza namespace per-view e **irraggiungibile
      in scrittura da `render_view`** (che ha un `&dyn HostApi`, non `&mut`).
- [ ] Con tre pannelli in sola lettura non si nota; con i nodi di input del
      §1.2 è il caso normale. Le tre strade, da scegliere ora perché `&self` è
      la firma che il freeze congela: **`&mut self` su `on_action`** — che non
      costa il prestito condiviso del render, perché `render_view` può restare
      `&self` (il percorso di lettura del §2.4 resta parallelizzabile) ma
      richiede al kernel di estrarre il provider come già fa in `view_action`
      (`workspace.rs:1173`); **uno stato di vista esplicito** passato dall'host
      a ogni chiamata e restituito modificato, che è la forma più amica del
      component model di M5; oppure **interior mutability dichiarata come
      contratto**, con la sua regola di rientranza scritta accanto a quella
      degli eventi. La terza è ciò che succede da sé se non si sceglie.

### 1.31 Una view non può chiedere di essere ridisegnata, né dire "sto caricando"

- [ ] **Il protocollo di view è pull-only e sincrono.** `ViewSpec.refresh` è una
      maschera sugli eventi *del kernel* e `ViewUpdate` esiste solo come
      risposta a `on_action`: un provider che finisce un job (§1.21), riceve
      dati dalla rete o completa un calcolo **non ha modo di dire
      «ridisegnami»**. L'unica strada è emettere un `Event::Custom` e
      dichiararsi interessato a `EventKind::Custom` — cioè svegliare ogni
      handler e ogni view del sistema (§1.19).
- [ ] **E non esiste uno stato intermedio**: `render_view` deve rispondere
      subito con un albero, quindi una view che dipende da lavoro lungo non è
      esprimibile — né "in caricamento", né "fallito, riprova", né parziale.
      Con il §1.21 che manda il lavoro lungo nei job, la coppia
      job→view è **il** percorso normale di 11 (database), 12 (canvas), 22
      (AI), 18 (stato del sync), 11.5 (dashboard), 24.1 (progresso), e oggi non
      esiste.
- [ ] Serve la terna, decisa insieme: un `HostApi::invalidate_view(view)` (o un
      `ViewUpdate` emesso fuori da `on_action`), una variante di stato nel
      protocollo (`UiNode::Pending`/`Error`, o `render_view` che può
      rispondere "non ancora"), e la regola di coalescing — venti inviti a
      ridisegnare in un giro sono un ridisegno.

*Sblocca:* 22 per intero, 11, 12, 11.5, 18.1 (stato sync visibile), 24.1
(indexing progress, task manager), 14.2 (il clipper che mostra cosa sta
scaricando).

### 1.32 `ViewSpec` non dice come si presenta

- [ ] **Id, titolo, placement, refresh** (`abi/traits.rs:201-217`) e nient'altro:
      niente icona, ordine o priorità, stato di default (aperta/chiusa),
      dimensione preferita, possibilità di essere nascosta e richiamata a
      comando. Con tre pannelli decide la shell per conoscenza privata; con i
      venti di 20.1 e le sidebar personalizzabili, collassabili e a gruppi di
      3.3, la shell non ha su cosa decidere.
- [ ] È additivo — un campo oggi, una minor domani — ma è **lo stesso record**
      che §1.14 (superfici) e §1.15 (istanze) devono toccare, e quei due lo
      riscrivono: va deciso nella stessa seduta o si aggiunge due volte.

### 1.33 `UiAction.payload` esiste e non lo usa nessuno

- [ ] **La shell non popola mai il payload**: `mountView` chiama
      `api.viewAction(view, action)` senza (`main.ts:1197-1201`), e le tre
      feature ufficiali codificano i dati **dentro l'id dell'azione** —
      `open:a/Uno.md` (`features/src/backlinks.rs:30`), `tag:rust`
      (`features/src/tags.rs:23`). Funziona, ed è una convenzione privata che
      sta diventando contratto de facto: il prossimo provider farà string-concat
      anche lui, perché è ciò che vede fare.
- [ ] **Il §1.2 dà per scontato che le azioni portino valori** (lo stato di un
      form). Il canale c'è già ed è inerte: o si formalizza adesso — chi mette
      cosa nel payload, come si serializza lo stato di un form, chi lo valida —
      o i nodi di input nasceranno sopra una convenzione che nessuno ha scritto.
- [ ] Va con il §4.6: il parsing degli `ActionId` è già nell'elenco di ciò che
      «ogni provider riscriverebbe», e la ragione per cui lo riscrive è questa.

### 1.34 Gli id non sono di nessuno: nessuna regola di namespace, nessuna collisione

- [ ] **`view_owner` risolve un id cercando su tutti i provider e prende il
      primo** (`kernel/workspace.rs:1196-1201`): due view con lo stesso id e la
      seconda è irraggiungibile, **in silenzio**. È lo stesso difetto già visto
      per `FormatRegistry` (§1.22: l'ultimo registrato vince) e per il dispatch
      delle query (§2.18: per tentativi) — ma quelle sono due istanze di un
      problema che è generale.
- [ ] **Gli spazi di nomi del contratto sono otto e nessuno ha una regola**: id
      di view, `ActionId`, id di comando (§1.1), `custom_kind` dei blocchi
      (§1.23), topic degli `Event::Custom`, `ns` delle `IndexQuery::Custom` e dei
      `ViewUpdate::Custom`, chiavi di impostazione (§1.3), nomi dei job. Solo
      per gli eventi custom c'è una convenzione scritta (`"<plugin-id>/<nome>"`,
      `abi/event.rs:39-41`), e non è imposta da nulla.
- [ ] **La decisione è una sola**: l'id è namespaced sull'id del plugin, il
      kernel lo impone alla registrazione e la collisione è un errore
      dichiarato — oppure ogni famiglia se lo inventa. Costa una regola adesso;
      dopo il freeze costa rinominare ogni id già pubblicato, cioè rompere le
      hotkey, le impostazioni salvate e i link a view di chiunque abbia
      scritto un plugin nel frattempo. È anche il presupposto di §2.9 (togliere
      un provider: per id) e §2.18 (routing: per `ns`).

### 1.35 Non c'è un ciclo di vita: si apre e basta

- [ ] **Il contratto non ha uno spegnimento.** `IndexProvider` ha `activate` e
      `flush` ma **nessun `close`/`deactivate`** (`abi/traits.rs:355-388`);
      `Plugin::deactivate` esiste (`abi/traits.rs:469`) e **non ha chiamanti**
      in tutto il repo. Un indice che possiede risorse esterne — tantivy tiene
      segmenti, lock file e thread di merge — non ha un punto in cui chiuderle,
      e il kernel non ha modo di chiedergliele.
- [ ] **L'asimmetria è di firma, quindi scade col freeze**: `activate` senza il
      suo gemello è un ciclo di vita monco che ogni provider di terzi eredita.
      La metà implementativa — chi chiama, quando, e cosa succede a metà — è il
      §2.22.
- [ ] Va deciso con il §2.9 (disattivazione a runtime) e il §1.21 (un job in
      volo mentre il provider si spegne): sono tre facce del momento in cui un
      componente smette, e oggi nessuna delle tre ha una risposta.

*Sblocca:* 24.2 (safe mode, crash recovery, plugin isolation), 3.1 (switch fra
vault senza perdere scritture), 20.1 (lifecycle, enable/disable), 20.2 (hot
reload), 26.2-26.3 (dove il watcher non c'è).

### 1.36 Un comando si descrive a un umano, non a una macchina

Il capitolo 22.4 (centro di comando LLM) chiede una cosa che nessun'altra voce
di FEATURES chiede: che un **chiamante non umano** scelga fra i comandi
disponibili, li invochi con argomenti che non gli sono stati insegnati, e lo
faccia su *più note insieme* o sulle impostazioni. Il §1.1 gli dà il registro;
quello che manca è tutto ciò che rende un registro utilizzabile da chi non ha
letto il codice.

- [x] **`CommandSpec` descrive gli argomenti**: `{ id, title, description,
      keybinding, params: Vec<ParamSpec>, scope }` in `abi/command.rs`, con
      `ParamKind { Text, Number, Bool, Document, Documents, Choice }`. Uno
      schema a sé e **non** i nodi del §1.2: dichiarare *cosa serve* e disegnare
      *come lo si chiede* sono due domande, e solo la prima ha senso per una CLI
      o per un modello, che non disegnano niente.
- [x] **Un comando dichiara il proprio raggio**: `CommandScope { writes, reach:
      CommandReach, reversible }`, con `reach` ordinato (`session` < `document`
      < `documents` < `vault` < `settings`) perché chi decide se chiedere
      conferma confronta.
- [x] **La simulazione è un modo di invocare**: `invoke(…, InvokeMode::DryRun)`
      → `CommandEffect::Plan(CommandPlan { summary, docs, edits })`, un
      `EditRequest` per documento (§1.16). E non è una cortesia di chi
      implementa: durante un dry-run l'host presta un `HostApi` in **sola
      lettura**, quindi un comando che ci prova riceve `PermissionDenied`. La
      stessa leva vale per `writes: false`.
- [x] **Il consenso non è il permesso** — ma non è nemmeno una capacità: è il
      giro *dry-run → piano → approvazione → apply*, e chi decide *quando*
      chiederlo è chi invoca, sul raggio dichiarato (vedi il verbale sotto).
- [ ] **Le impostazioni scrivibili da un programma sono un sottoinsieme
      dichiarato**: lo schema del §1.3 deve dire quali chiavi sono modificabili
      da un comando e quali no. La riga non negoziabile è che le impostazioni di
      privacy e dell'AI stessa non siano fra quelle: un componente che può
      allargarsi i permessi da sé non ha permessi. *(Il vocabolario c'è —
      `CommandReach::Settings` — lo schema no: non ci sono ancora impostazioni.)*
- [ ] **L'attribuzione va nel lotto, non nel log dell'app**: chi ha chiesto
      l'operazione (utente, comando, modello, prompt) è il §1.18 (origine degli
      eventi) applicato al §1.12 (il lotto). L'audit trail di 22.4 è quel campo
      più il journal del §2.5; senza il campo, «cosa ha cambiato l'AI ieri» si
      può solo indovinare dai timestamp.
      *Metà fatta (§1.12 + §1.18), e la spunta resta giù apposta.* Fatto: chi
      invoca lo dichiara (`invoke_command(…, by: Actor)`) e ogni evento che
      l'invocazione genera porta `Origin { actor, batch }` — con un lettore vero
      e provato, l'automazione che salta le proprie scritture
      (`fubmd-kernel/tests/batch_and_origin.rs`) e la shell che distingue
      un'altra applicazione da sé. Non fatto: **quale** comando, con quale
      modello e quale prompt. E ciò che manca lì non è un campo, è un **posto**:
      l'origine vive quanto il giro sincrono, e «cosa ha cambiato l'AI ieri»
      chiede che qualcuno l'abbia scritta da qualche parte — il journal del §2.5.
      Metterli in `Origin` adesso sarebbe stato aggiungere due campi scritti da
      chi invoca e riletti da nessuno, cioè l'errore che questa stessa voce
      nominava prima che il §1.18 esistesse.

Nessuna di queste è "infrastruttura per l'AI": sono la differenza fra un
registro comandi leggibile e uno **eseguibile da terzi**, e i primi clienti
sono la CLI (27.1), l'API locale (27.2) e le automazioni (16.2) — l'LLM è
l'ultimo ad arrivare e il primo a rendere il buco visibile, perché è l'unico
chiamante che non si può correggere leggendo il codice.

*Sblocca:* 22.4 per intero, 27.1 (una CLI che scopre i comandi invece di
elencarli a mano), 27.2 (API locale), 16.2-16.3 (automazioni con anteprima e
undo), 7.2 (bulk fix con dry-run), 17.3 (rollback dell'import).

**Fatto insieme al §1.1, con quattro decisioni e due voci ancora aperte.**

*Uno schema di parametri a sé, non i nodi del §1.2.* Riusare i nodi di input
avrebbe tenuto una definizione sola di "campo tipato" nel contratto, ed è
l'argomento che sembra più forte finché non si guarda chi legge: una CLI, uno
script, un modello non disegnano niente e non hanno bisogno di sapere *come* si
chiede un valore — hanno bisogno di sapere *cosa* è. Legare la descrizione di un
comando all'evoluzione di `UiNode` avrebbe fatto dipendere il primo dal secondo
senza che il secondo servisse. Quando i nodi arriveranno saranno la **resa** di
un `ParamSpec`; il contrario no. Il prezzo dichiarato: il vocabolario è piccolo
(sei specie), e ciò che non esprime viaggia come testo con il comando che lo
interpreta — cioè fuori dalla convalida dell'host.

*Il modo sta nella firma, e rompe `invoke`.* Era la scelta che il M4 chiamava
"della famiglia di `RenderOptions`: da fare per prima o mai", e va fatta adesso
(linea di base ritagliata in `wit/frozen/0.1.0.wit`). La ragione non è
l'eleganza: con il modo nella firma, il non-scrivere lo può garantire l'**host**,
prestando un `HostApi` in sola lettura. Un `CommandOutcome::Plan` da solo avrebbe
lasciato il dry-run alla buona volontà di chi implementa, cioè a una convenzione
che un comando di terzi non onora — e proprio nel momento in cui il chiamante si
fida di lui (l'anteprima prima di toccare 40 note). La stessa leva rende
`writes: false` vincolante invece che decorativo: chi si dichiara innocuo riceve
lo stesso host e fallisce se ci prova. È l'unica parte del raggio che si può far
rispettare: quante note un comando tocchi si sa solo eseguendolo, e "reversibile"
è una promessa sul mondo, non sul confine.

*Il consenso non è una capacità dell'`HostApi`.* Il §1.36 lo dava per scontato
(«è una capacità dell'`HostApi`, §1.4: la conferma»), e questo giro dice di no,
per due ragioni. La prima è che **questo host non può fermarsi a chiedere**: il
kernel è chiamato *dalla* shell e ne tiene il lock, quindi una conferma sincrona
dovrebbe risalire nella webview che sta aspettando la risposta — e una capacità
che ogni host dovrà onorare e nessuno onora è peggio che assente. La seconda è
che **un piano si legge e una domanda no**: «approvi queste 40 note?» mostra ciò
che il comando sceglie di dire, un `CommandPlan` mostra i `DocId` e gli edit, e
li mostra prima. Il consenso è quindi il giro dry-run → piano → approvazione →
apply; *quando* chiederlo lo decide chi invoca dal raggio dichiarato (`needsPlan`
nella palette: più di una nota, o non reversibile). Una CLI in uno script può
avere un'altra politica sullo stesso dato — è per questo che il raggio sta nella
spec e la politica no. Ciò che resta scoperto, e va detto: nessuno **obbliga** un
chiamante a simulare prima. L'obbligo, se sarà, è una policy del §2.10 sopra
questa firma, non un pezzo di firma in più.

*L'insieme impattato lo completa l'host.* `CommandPlan.docs` è la verità che
l'utente approva, e un piano che tocca una nota senza nominarla sarebbe un
consenso strappato: l'host ci aggiunge i documenti degli `edits` invece di
fidarsi che chi ha scritto il piano se ne sia ricordato. E le `base` delle
richieste sono le revisioni di **adesso**: se un documento cambia fra il piano e
l'approvazione, applicarlo fallisce con `Conflict` (§1.16) invece di
sovrascrivere — l'anteprima non è un'ipotesi vaga, è una promessa verificabile.

*Resta fuori, dichiarato:* le **impostazioni scrivibili da un programma** (§1.3:
c'è il vocabolario, non lo schema); l'**attribuzione** (§1.18 + §1.12: un campo
`origin` scritto da chi invoca e letto da nessuno non è un audit trail); il
**limite massimo di note per operazione** e la **conferma rafforzata** di 22.4,
che sono politiche sopra il raggio dichiarato, non firme; l'**esecuzione
parziale** e l'**interruzione a metà** (22.4), che chiedono il lotto (§1.12).

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

### 2.21 Il grafo conosce solo i wikilink — e la promessa vale a metà, in silenzio

- [x] **`LinkGraph::register_links` scarta ogni `LinkTarget` che non sia
      `Wiki`** (`kernel/graph.rs:266`), e `link_rewrite_plan` fa lo stesso
      (`kernel/workspace.rs:893`). Quindi per un link markdown ordinario —
      `[testo](note/altra.md)`, che il 7.1 mette sullo stesso piano del
      wikilink, insieme a «link relativi» e «link a file allegato» — **non ci
      sono backlink, non c'è riscrittura su rinomina, non c'è arco nel grafo**.
- [x] **È la prima voce di questo piano che rende falsa una promessa già fatta,
      senza dirlo**: «aggiornamento link su rinomina» e «spostamento sicuro»
      (3.2, 7.2) oggi valgono per una parte dei link e non per l'altra, e la
      differenza la scopre l'utente quando un link si rompe. Non è un buco di
      capacità futura: è un comportamento sbagliato adesso.
- [x] **E senza di esso non esiste tutta la famiglia della salute del vault**:
      link rotti e loro report, note orfane, allegati inutilizzati, fix
      automatico (7.2, ~30 voci) — sono tutte interrogazioni sullo stesso grafo,
      e sono tutte cieche su metà degli archi. Idem 13.1 (riferimenti aggiornati
      su rinomina di un allegato, orfani, dedup), che non è nemmeno
      rappresentabile finché un `Path` non è un arco.
- [x] **La metà nel contratto è il §1.5** (`LinkTarget` che distingua "risorsa
      del vault" da "url esterno") e va decisa prima; questa è la metà kernel —
      risoluzione di un `Path` relativo a `DocId` (con le sue regole: relativo a
      cosa, con o senza estensione, case), archi nel grafo, e riscrittura al
      rename con la stessa disciplina chirurgica già scritta per i wikilink.

**Fatta la metà kernel.** `crates/fubmd-kernel/src/pathlink.rs` è il posto — e
l'unico — dove sta scritto cosa significa un path dentro un documento: relativo
alla **cartella** del sorgente (con lo slash iniziale, alla radice del vault),
`.` e `..` risolti lì, un `..` di troppo che esce dal vault e quindi non risolve;
percent-encoding decodificato, così `[t](nota%20uno.md)` e `[t](<nota uno.md>)`
sono lo stesso arco; frammento (`#heading`, `#^blocco`) staccato prima di
risolvere e riattaccato dopo. Sull'estensione la regola è **prima l'esatto, poi
il senza**: `note/a.md` è `note/a.md` e non il `note/a.txt` che gli sta accanto,
`note/a` ricade sulla chiave dei wikilink, e `note/a.png` che non esiste **non**
ricade su `note/a.md` — chi scrive un'estensione l'ha scritta apposta. Il caso
passa dalla stessa `normalize` dei wikilink (trim, NFC, minuscolo), perché il
vault sincronizzato fra macOS e Linux è lo stesso vault.

Nel grafo la seconda specie di arco entra **senza un secondo meccanismo**: un
`LinkRef` porta il suo `RefKind`, il path si risolve alla registrazione (da lì in
poi la chiave è assoluta nel vault e nessuno deve più sapere da dove veniva), e
`watchers`/`refs_by_key` restano quelli — le due risoluzioni dipendono dallo
stesso paio di chiavi d'indice, quindi l'invalidazione incrementale non cambia di
una riga. Con una differenza di sostanza: un link markdown **non ricade su nome e
alias**. `[t](Mario)` non pesca l'alias "Mario"; è un path, e nei path non ci
sono alias.

La riscrittura al rename ha un caso in più del wikilink, e non è un dettaglio: un
path è relativo a chi lo scrive, quindi si rompe anche quando a spostarsi è la
**sorgente** — muovere `a.md` in `sub/` invalida ogni `[t](altra.md)` che
conteneva, e nessun backlink lo segnala perché il documento che si rompe è quello
che si è mosso. Quindi il documento rinominato è sempre fra le sorgenti del
piano, e i suoi link relativi si ri-basano sulla cartella nuova (quelli dalla
radice no: la radice non si muove). Il riferimento riscritto è relativo a *ogni*
sorgente — lo stesso bersaglio diventa `archivio/X.md` da uno e `../archivio/X.md`
da un altro — è percent-encoded per stare dentro `[]()` senza rompersi, e
riacquista sempre l'estensione: un path senza è ambiguo per costruzione, e
riscrivere un link vuol dire garantire che dopo punti ancora dove puntava. Un
link già rotto non si tocca: riscriverlo sarebbe indovinare.

Le prove: il test di proprietà `graph_incremental.rs` ora genera **entrambe le
specie** e osserva anche `resolve_path` per ogni coppia (sorgente, destinazione)
— incrementale e full-rebuild restano indistinguibili su 200 sequenze casuali più
una da 2 000 passi; dieci casi end-to-end sul rename in `rename_and_events.rs`; e
uno sul parser vero in `format-markdown/tests/vault_e2e.rs`, perché gli `Span`
dentro cui la sostituzione ritaglia sono quelli di comrak, non quelli di un
provider giocattolo.

*Sblocca:* 7.2 e 13.1 sul lato grafo (link rotti, orfani, riferimenti su
rinomina) — che ora vedono tutti gli archi, non metà.

**Resta aperta la metà modello (§1.5), e non è un residuo formale.** Un
`LinkTarget::Path` continua a essere una stringa che il kernel interpreta:
l'unica cosa che distingue una risorsa del vault da un url esterno è
`classify_url` nel provider markdown (`://` o `mailto:`), e un provider terzo può
non fare la stessa cosa. Soprattutto: **le immagini non entrano affatto in
`links`** (`parse.rs:281`), quindi 13.1 sugli allegati — riferimenti su rinomina
di un allegato, orfani, dedup — resta fuori portata: non perché il `Path` non sia
un arco, ma perché quell'arco non viene nemmeno raccolto. E in anteprima un
`.internal-path` porta già il suo `data-path`, ma nessuno lo clicca: la shell non
naviga né quelli né i wikilink (§3.x). L'arco adesso è vero; il clic no.

### 2.22 Nessuno spegne niente: la durabilità dipende dal watcher

- [ ] **`flush_indexes` ha un solo chiamante in produzione**: il callback del
      file watcher (`app/lib.rs:249-254`), più `reindex` all'apertura. Nessun
      altro percorso lo chiama — né `write_document` dall'IPC, né la chiusura
      del vault, né la chiusura dell'app.
- [ ] **Quindi la durabilità di un indice dipende da un componente
      *opzionale***. Dove il watcher non c'è o non funziona — network share e
      cartelle cloud (2.3, 3.1), PWA (26.3), CLI (27.1), e2e headless (27.4),
      mobile (26.2) — le scritture dell'indice **non diventano mai durevoli**, e
      il sintomo è solo una riapertura lenta che reindicizza tutto: nessuno se
      ne accorge finché non conta.
- [ ] **E cambiare vault o chiudere l'app non chiude niente**: nessun flush
      finale, nessun `Plugin::deactivate` (che non ha chiamanti), nessun
      `close` sugli indici (che non esiste — §1.35). tantivy resta con segmenti
      non committati e con i suoi lock; un journal (§2.5) resterebbe aperto; un
      sync (18) resterebbe a metà.
- [ ] Serve un **ciclo di vita esplicito del workspace** — `open` → `close` —
      con flush e deactivate di tutti i provider, la semantica di cosa succede
      se uno fallisce, e un punto di consistenza che **non sia il watcher**: il
      kernel non sa quando finisce un lotto (è dichiarato, ed è giusto), ma
      "l'app sta chiudendo" lo sa chi la chiude. Va con §2.7 (sessioni multiple:
      chiuderne una) e §2.3 (il registry è chi possiede i bundle).

### 2.23 L'apertura del vault è tutto-o-niente, sincrona e senza ritorno

- [ ] **`reindex` fallisce l'intera apertura per un solo documento**: legge e
      parsa tutto con `?` su ogni passo (`kernel/workspace.rs:341-351`). Una
      nota illeggibile per i permessi, un file troncato da un crash, un
      documento che il parser rifiuta — e **il vault non si apre**. È l'opposto
      di ciò che chiedono 2.1 (corruption detection), 24.2 (vault repair, health
      check) e del principio per cui il vault è la verità: la verità non si
      rifiuta di aprire, si apre segnalando cosa non ha letto.
- [ ] **E succede dentro un comando IPC** (`app/lib.rs:109-208`): scansione,
      parse di ogni documento, grafo, riconciliazione e flush in una chiamata
      sincrona che ritorna un `VaultInfo`. Niente progresso, niente
      cancellazione, niente apertura parziale — «avvio rapido», «indexing
      progress», «supporto vault enormi» (24.1) non hanno dove attaccarsi.
- [ ] Le due cose vanno insieme e cambiano la **forma dell'apertura**: da
      funzione che ritorna un vault a operazione a fasi (vault utilizzabile →
      indicizzazione in corso → pronto) con errori raccolti per-documento e un
      esito consultabile. Il §2.4 sposta il lavoro fuori dal lock; questa dice
      che il lavoro deve poter **fallire in parte**.

### 2.24 Lo stato per-documento: ogni feature se lo migra da sé

- [ ] **Il rename è già un rito che ognuno celebra per conto proprio**: il
      versioning migra la sua chiave sull'evento `DocumentRenamed`, il sidecar
      dell'organizzazione la migra in TypeScript (`main.ts:638`), e le prossime
      — annotazioni (13.3), task (10), commenti (4.3, 19.2), database (11),
      flashcard (21.2) — la migreranno una terza e una quarta volta, ognuna col
      proprio buco già annotato al §2.14 (il rename fatto ad app chiusa non lo
      vede nessuno).
- [ ] **E nessuno raccoglie**: cancellata una nota per sempre (svuota cestino),
      chi cancella i dati che la nominavano? Oggi il versioning tiene tombstone
      per scelta propria; per tutti gli altri lo spazio dati cresce con chiavi
      morte che nessun GC visita.
- [ ] **Manca la primitiva**: uno spazio dati **per-documento** namespaced per
      plugin, che il kernel migra sul rename e ripulisce sulla cancellazione
      definitiva, con la sua politica di raccolta. Il §2.14 chiede di assorbire
      *un* sidecar concreto; questa è la forma generale, e va decisa insieme al
      §1.10 (se l'identità resta il path, la migrazione della chiave è per
      sempre un problema del kernel; con un id stabile diventa un non-problema).

### 2.25 Nessun inventario di ciò che è attivo

- [ ] **`VaultInfo.versioning: bool`** (`app/lib.rs:57`, mirror in `api.ts:14`)
      è un booleano **per feature** dentro un record IPC. Con i moduli del 21.2
      diventano venti booleani, e ognuno è una modifica al record, al mirror e
      alla fixture (§4.8).
- [ ] **E la shell non sa comunque nulla del resto**: quali provider, indici,
      handler e comandi siano registrati, con quale manifest, quale versione,
      quali permessi, quale `Trust`. Il kernel non conserva i manifest
      (`register_*` prende una stringa, §2.10), quindi la domanda non ha proprio
      un destinatario.
- [ ] Serve un `capabilities()`/`list_plugins` sul confine, alimentato dal
      registry del §2.3: è ciò su cui poggiano la scheda impostazioni (§1.3), il
      pannello plugin con enable/disable (20.1), il developer mode (20.2), la
      diagnostica e il diagnostic bundle (24.2) — e il modo di far sparire i
      booleani prima che diventino venti.

### 2.26 La query non esiste sull'IPC

- [ ] **Quattro comandi Tauri avvolgono lo stesso `query_index`**: `backlinks`
      (`app/lib.rs:411`), `search` (`:484`), `list_tags` (`:505`) e — con un
      canale tutto suo — `graph_data` (`:642`). Un provider può fare qualunque
      query; **la shell no**: ogni variante nuova del §1.6 (proprietà, faccette,
      vicinato del grafo, salute del vault) richiederebbe un comando in più.
- [ ] **Manca il gemello di `render_view`/`view_action`**: un `query_index`
      generico sull'IPC, con la stessa disciplina (dispatch del §2.18, errori
      del §1.11, paginazione del §1.6). È la voce che rende **praticabile** la
      dieta dell'IPC del §4.2: senza, l'allowlist si troverebbe a dire di no a
      feature legittime che non hanno altra strada.
- [ ] Con essa i quattro comandi diventano tre righe di `api.ts` e il grafo
      smette di avere un canale privilegiato (§1.14).

### 2.27 Il ponte degli eventi non ha né freno né raggruppamento

- [ ] **`EventBus` usa canali `std::mpsc` illimitati** (`kernel/bus.rs:14`) e il
      ponte verso la webview emette **un messaggio IPC per evento**
      (`app/lib.rs:184-188`). Un subscriber lento non rallenta nessuno: accumula
      memoria, in silenzio, senza un tetto — l'opposto del `DISPATCH_BUDGET`
      che protegge gli handler.
- [ ] **E ogni evento costa un giro di shell**: a ogni `index_updated` (o
      `batch_ended`) la shell rifà `list_documents` e ridisegna ogni view
      iscritta. Il §1.12 ha ridotto gli eventi *che costano un ridisegno* —
      dentro un lotto ne arriva uno solo, e una rinomina con 200 backlink è
      passata da 201 giri a 1 — ma non ha toccato il **numero di messaggi IPC**:
      i 200 `document_changed` attraversano il ponte lo stesso, uno per uno.
      Resta che il ponte non ha una politica sua — coalescing per tipo, finestra
      temporale, tetto oltre il quale si degrada a "riconcilia tutto", che è poi
      ciò che `Event::Overflow` già significa per gli handler.
- [ ] Va con §2.4 (il lavoro lungo emette progresso: sarà il canale più caldo di
      tutti) e §3.5 (il centro attività è il suo primo cliente).

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

- [x] **Ponte inverso code unit → byte** (`offsets.ts`): fatto col §1.9
      (`charToByteIndex`, testato su accenti ed emoji in andata e ritorno), che
      ne aveva bisogno per far attraversare il confine alla selezione. Le due
      direzioni stanno in un punto solo.
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
- [ ] **Round-trip import/export**: il primo giro c'è col §1.7
      (`transfer_e2e.rs`: un vault esce in artefatti e rientra identico), ma su
      un vault scritto a mano. Resta da farlo **sul corpus** di qui sopra, dove
      la proprietà smette di essere un esempio e diventa una misura.

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
- [ ] La duplicazione non è ipotetica: **le tre feature ufficiali costruiscono
      già lo stesso albero tre volte** — una lista di `ListItem` con azione, e
      uno `Stack` con un `Text` come segnaposto vuoto
      (`features/src/backlinks.rs:96`, `outline.rs`, `tags.rs:77`) — e ognuna ha
      reinventato la codifica dei dati dentro l'`ActionId` (§1.33). Su tre
      provider è una convenzione; su venti moduli Suite è un dialetto per
      modulo.

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

- [x] **La CI è buona e non copre questo**: invarianti abi↔WIT e grafo delle
      dipendenze in un minuto, build e test su tre OS, toolchain pinnata
      all'MSRV, frontend con type-check + test + build. Il §4 aggiunge fuzzing,
      corpus, benchmark, e2e e tracing. Nessuno dei due tocca il 23.3: **SBOM,
      identificatori SPDX, license compliance, dependency audit e advisory
      CVE** — né il 20.3 (reproducible builds, firma, dependency audit).
- [x] **`cargo-deny`** (licenze, advisory, duplicati, sorgenti consentite) e la
      **generazione dell'SBOM** in CI costano mezz'ora adesso. È l'unico punto
      di quel capitolo che non si recupera a posteriori: le licenze delle
      dipendenze entrate nel frattempo si riesaminano una per una, e una
      incompatibile scoperta a valle si toglie riscrivendo ciò che ci stava
      sopra. Vale doppio con l'albero che sta per arrivare (tantivy c'è già;
      §4.7 ne prevede uno per bundle).

**Fatto.** `deny.toml` alla radice (politica e motivazioni ci stanno dentro) e il
job `supply-chain` in CI, che gira anche **a settimana**, perché un advisory
nuovo non aspetta il prossimo push. Le quattro verifiche sono verdi oggi:
licenze da elenco chiuso (`MPL-2.0` ammessa consapevolmente — copyleft per file,
entra con `cssparser`/`selectors` via tauri), advisory e crate yanked rossi,
duplicati come avviso (con tauri nell'albero non dipendono da noi), sorgenti
limitate a crates.io. L'SBOM è **SPDX 2.3** (`cargo-sbom`), caricato come
artefatto: 510 pacchetti con identificatore SPDX e `purl`.

Un difetto latente emerso strada facendo, e chiuso: le dipendenze interne erano
`{ path = … }` **senza versione**, cioè dipendenze `*` — build non riproducibile
per chi non ha questo albero, e nessuno dei crate pubblicabile. Il che avrebbe
reso irraggiungibile proprio ciò che deve esserlo da fuori (`fubmd-abi` e
`fubmd-sdk`, §4.6). Ora portano `version = "0.1.0"` accanto al path: la
risoluzione locale non cambia (il path vince sempre).

*Sblocca:* 23.3 per intero, 20.3 (SBOM plugin, dependency audit, advisory), e
il capitolo 1.2 di FEATURES — la «licenza chiara» promessa dai principi fondanti
è verificabile solo se lo è quella delle dipendenze.

### 4.10 L'additività del contratto è una promessa senza presidio

- [x] **Nessuno confronta il contratto con la versione precedente.**
      `abi_compatible` applica la regola a runtime (`abi/traits.rs:453-464`) e
      `wit_conformance.rs` verifica che Rust e WIT dicano la stessa cosa —
      **oggi**, fra di loro. Ma la promessa del freeze è un'altra: *post-M4 il
      contratto cresce solo per aggiunta*. Nessun test la controlla, e non c'è
      da nessuna parte una copia del contratto com'era.
- [x] **Il costo di scoprirlo tardi è asimmetrico**: una variante rimossa, un
      campo rinominato o un enum riordinato non rompono la build del repo —
      rompono i plugin di terzi, a valle, dopo il rilascio, e la regola
      `abi_compatible` li avrebbe accettati perché la minor è compatibile. Cioè
      la rete di sicurezza dice "sì" proprio nel caso che dovrebbe fermare.
- [x] Serve poco: uno **snapshot del WIT per ogni versione pubblicata** in
      `wit/frozen/`, e un test che confronti il contratto attuale con l'ultimo
      snapshot rifiutando rimozioni, rinomine e cambi di forma (le aggiunte
      passano). Va messo **prima** del freeze, perché è il freeze a fissare la
      prima riga di base — e va con §4.8, che genererebbe da uno solo dei
      quattro posti ciò che questo test presidia in tutti e quattro.

**Fatto.** `wit/frozen/0.1.0.wit` è la prima linea di base e
`crates/fubmd-abi/tests/wit_additivity.rs` il presidio: parsa il contratto
attuale e ogni snapshot, e verifica che il primo sappia ancora servire ognuno di
quelli **di cui `abi_compatible` direbbe di sì** (stessa major, minor non
superiore) — così la regola a runtime e il test guardano lo stesso insieme di
versioni, invece di due insiemi diversi. La forma di ciò che era pubblicato deve
essere intatta *e nella stessa posizione*; il nuovo può stare solo in coda. Un
tipo spostato da un'interfaccia a un'altra conta come rinomina. Regole complete e
ciclo di vita della cartella in `wit/frozen/README.md`.

Tre proprietà che il test si autopresidia, perché è un presidio che si spegne da
solo se non ci si bada: **diciannove** rotture introdotte ad arte sul modello
parsato (tipo rimosso o spostato, campo rinominato/ritipato/riordinato/tolto/
inserito in mezzo, caso di variant rimosso o riordinato, payload cambiato, alias
ridiretto, funzione sparita, parametro in più o rinominato, risultato cambiato,
package rinominato, import di world sparito) devono tutte farlo diventare rosso;
**sette** aggiunte vere — fra cui proprio quelle che il §1 dovrà fare: una
superficie in più in `view-placement` (§1.14), una variante in più in
`index-query` (§1.6), una capacità in più sull'`host-api` (§1.4) — devono
passare; e `wit/frozen/` vuota, o senza una base con la major corrente, è rossa,
perché zero snapshot significherebbe zero confronti e quindi verde.

Pre-freeze la superficie resta libera di evolvere: il test non lo impedisce, lo
rende **visibile** — una rottura deliberata si fa con un commit che tocca
`wit/frozen/0.1.0.wit`, e in review si vede. Dopo M4 quel file non si tocca più.

*Sblocca:* 27.3 (version compatibility, deprecation policy), 20.1 (versioning
plugin), 20.2 (canali di aggiornamento) — e rende vera, non sperata, la promessa
su cui poggia l'intero §1.

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
documento, §1.11 errori tipizzati, ~~§1.12 il lotto~~ (**fatto**), §1.13 canale
del rendering.
Dal terzo giro, con lo stesso statuto: §1.14 superfici della UI, §1.15 view
istanziabili, §1.16 la primitiva di edit, §1.17 undo, ~~§1.18 origine degli
eventi~~ (**fatta, col §1.12**), §1.19 grana dell'abbonamento, §1.20 `ParseContext` e parse non-testo,
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

Dal quinto giro, con lo stesso statuto: §1.28 il modello parsato in mano ai
provider, §1.29 il formato di un documento, §1.30 lo stato di una view (`&self`
sulle sue due firme), §1.31 invalidazione e stato di caricamento, §1.32 i
metadati di `ViewSpec`, §1.33 il payload delle azioni, §1.34 la regola degli
spazi di nomi, §1.35 il gemello di `activate`. Più la **metà modello** del §2.21
(un `LinkTarget` che il grafo possa risolvere), che è §1.5 visto dal lato degli
archi. Tre raggruppamenti da decidere in una seduta sola, non voce per voce:
§1.28 con §1.13 e §1.29 (*chi vede il modello*); §1.30, §1.31, §1.32 e §1.33 con
§1.2, §1.14 e §1.15 (*cosa è una view*); §1.35 con §2.9 e §1.21 (*come smette un
componente*). Il §1.34 sta da solo ed è il più urgente in senso stretto: è
l'unico che non riguarda ciò che scriveremo, ma ciò che avremo **già
pubblicato**.

Fuori dai giri, dallo stesso statuto P0 perché è firma: **§1.36** (un comando
descritto a una macchina: schema dei parametri, raggio dichiarato, dry-run,
consenso). Nasce dal capitolo 22.4 di FEATURES, ma va deciso **nella stessa
seduta del §1.1** — è `CommandSpec` e `invoke` visti dal lato di un chiamante
che non ha letto il codice, e dopo il freeze il descrittore di un comando non si
allarga più. Le sue due metà implementative sono il §2.10 (permessi) e il §2.5
(journal per l'audit). — **Fatti entrambi, nella stessa seduta**: il verbale in
fondo a §1.1 e a §1.36; restano aperte le due voci che dipendono da firme che
non ci sono (impostazioni scrivibili → §1.3) e la voce dell'attribuzione, ora
mezza chiusa dal §1.18 + §1.12: il campo c'è e ha un lettore, il *posto* dove
conservarlo è il journal del §2.5.

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

Dal quinto giro: §2.21 (la metà kernel: il grafo che risolve i link non-wiki —
**fatta**, il dettaglio in fondo alla voce; resta la metà modello, che è §1.5),
§2.22 (lo spegnimento, cioè l'implementazione del §1.35), §2.23 (l'apertura a
fasi e tollerante), §2.25 (l'inventario di ciò che è attivo, che nasce dal
registry del §2.3) e §2.26 (la query sull'IPC). Due precedenze: §2.26 va
**prima** del §4.2, o l'allowlist dei comandi si troverebbe a dire di no a
feature che non hanno altra strada; §2.22 va con §2.7, perché "chiudere una
sessione" e "chiuderle tutte" sono lo stesso codice.

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

Dal quinto giro si aggiungono §2.24 (lo stato per-documento come primitiva, da
decidere però *insieme* a §1.10 e §2.14: sono la stessa domanda vista da tre
distanze) e §2.27 (freno e raggruppamento sul ponte degli eventi, il cui primo
cliente vero sarà il progresso dei job del §2.4).

**Fuori dall'ordine, perché costa mezz'ora e non si recupera dopo:** §4.9
(`cargo-deny` + SBOM in CI). Non blocca niente e non sblocca niente — è solo
l'unica voce del piano il cui costo cresce con il numero di dipendenze già
entrate. Accanto, con lo stesso statuto e per la stessa ragione, §4.10 (lo
snapshot del contratto e il test di additività): costa poco adesso, ma la prima
riga di base la fissa il freeze — dopo, non c'è più un "prima" con cui
confrontarsi. — **Entrambe fatte**: il dettaglio in fondo a §4.9 e §4.10.

Nota di rotta: le voci con l'effetto leva più alto sono **§1.1 (comandi —
fatto)**, **§1.2 (input in `UiNode`)** e **§2.3 (registry + job)** — insieme
spostano dal "cablato nell'app" al "registrato" praticamente ogni capitolo di
FEATURES dal 4 al 22, e sono le tre che il freeze di M4 rende definitive. Accanto a quelle, dal
secondo giro: **§1.9 (contesto e selezione)**, senza cui metà dei capitoli 4, 13
e 22 non potrà mai essere un provider; **§1.12 (il lotto — fatto, col §1.18)**,
prerequisito silenzioso di bulk fix, import, automazioni e database; e **§2.8 + §2.10**, che
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

Dal quinto giro se ne aggiungono tre, e la prima ha lo stesso statuto delle due
del quarto — rende inesprimibile, non stretto. **§1.28 (il modello parsato in
mano ai provider)**: finché il `DocumentModel` non attraversa il contratto,
chiunque voglia toccare il contenuto *strutturato* — spuntare un task, scrivere
una proprietà, estrarre una citazione, esportare, fare chunking — deve
riscriversi un parser markdown, cioè non può essere un plugin. È il §1.22 visto
dal lato del consumo, ed è insieme a lui il secondo punto in cui l'invariante del
progetto è già falsa. **§1.30 + §1.31 (una view che non ha stato e non può
chiedere di ridisegnarsi)**: sono due firme che insieme dicono che una view è una
funzione pura sincrona, e su quella forma non regge nulla di interattivo né di
asincrono — cioè i capitoli 11, 12, 11.5 e 22, gli stessi che il §1.14 sta
cercando un posto dove mettere. **§1.34 (gli spazi di nomi degli id)**: non è la
più grande, è la più **datata** — è l'unica voce dell'intero piano che non
riguarda ciò che scriveremo ma ciò che avremo già pubblicato, e il suo costo non
si misura in lavoro ma in id di terzi da rinominare.

Un'ultima nota, che vale come criterio più che come voce: **§2.21** (i link
markdown fuori dal grafo) è il primo caso in cui questo piano non descrive un
limite ma un **difetto** — «aggiornamento link su rinomina» è promesso, spedito,
e vero solo per metà dei link. Le quattro passate precedenti guardavano cosa non
si potrà costruire; questa dice di guardare anche cosa è già costruito e non fa
quello che dice. — Il difetto è **chiuso** (la metà kernel; il dettaglio in fondo
alla voce), ma il criterio resta, ed è la parte che vale: nei prossimi giri la
domanda «cosa manca» va accompagnata da «cosa c'è e non mantiene».
