# Dove il contratto si strozza, capitolo per capitolo

Una riga per **famiglia di FEATURES**: cosa servirebbe perché quelle voci siano provider, e cosa lo impedisce oggi. È l'indice inverso della roadmap — si entra dal capitolo di FEATURES invece che dalla seduta.

[← indice](../todo.md)

---

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
| ~~3.3 split/finestre, 4.2-4.3 azioni sulla selezione, 13.3, 22.2~~ | ~~contesto per-pane e **selezione** nel contratto~~ | **chiuso ([decisione 0007](../decisions/0007-contesto-di-sessione.md))**: `HostApi::active_context() -> Option<ViewContext>` con pannello, documento, selezione e modalità |
| 7.2 bulk fix, 11.3 editing bulk, 16.3 undo, 17.3 rollback | scrittura **a lotti** | il kernel muta un documento alla volta: N scritture = N eventi (`workspace.rs:735`) |
| 3.2 cartelle, 8.2 metadata di cartella, 6.2 CSS per cartella | la cartella come cittadino del kernel | `metas` è una mappa piatta (`workspace.rs:163`): l'albero esiste solo in `organizer.ts` |
| 20.1 enable/disable, 20.2 hot reload, 24.2 safe mode | disattivare un provider | `register_*` fa solo `push`: `unregister` non esiste |
| 20.3 sandbox e permessi, 23.1 permessi file/rete | un punto di applicazione dei permessi | `PluginPermissions` non ha lettori; `KernelHost` porta solo un id (`workspace.rs:1485`) |
| 6.1 anteprima interattiva, 5.3 sanitizzazione | il **modello** al confine, non solo HTML | `render_preview` restituisce una `String`; nessun comando restituisce il `DocumentModel` |
| 24.2 error reporting, 25.2 localizzazione, 16.3 retry | errori tipizzati al confine | i comandi IPC restituiscono `Result<_, String>`: la shell indovina (`main.ts:856`) |
| 27.3 test utilities, 21.1 moduli Suite | un SDK usabile da fuori | `MemoryHost` è `#[cfg(test)]` dentro `fubmd-features` (`features/src/lib.rs:31`) |
| 2.2 config, 27.4 upgrade migration | versione di schema sui formati persistiti | ce l'ha il solo indice di ricerca (`search.rs:59`), che è **derivato** |
| 20.1 ribbon/status bar/menu/settings tab, 11-12 database e canvas, 7.3 grafo | superfici di UI oltre le sidebar | `ViewPlacement` ha **3 varianti** (`traits.rs:195`) e l'area principale non è nel contratto |
| 11.2 viste multiple, 8.3 viste salvate, 9.2 query embed, 3.3 split | view **istanziabili** con parametri | `views()` è un elenco statico e `view_owner` risolve per id (`workspace.rs:1196`) |
| ~~4.3, 7.2, 8.2, 10.1, 11.3, 16.1, 19.2, 22.2~~ | ~~modificare **un pezzo** di documento~~ | **chiuso ([decisione 0008](../decisions/0008-modifica-chirurgica.md))**: `HostApi::apply_edit(id, EditRequest { base, edits })`, con la revisione nella firma e `Conflict` invece della sovrascrittura silenziosa |
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
| 13.3 annotazioni, 10 task, 11 database, 4.3 commenti | stato **per-documento** migrato dal kernel | ogni feature lo rifà da sé (versioning, `main.ts:638`), col buco del §11.3 |
| 20.1 pannello plugin, 28 settings, 24.2 diagnostica | inventario delle feature attive | `VaultInfo.versioning` è **un booleano per feature** (`app/lib.rs:57`) |
| 9.1-9.2 ogni query nuova, 7.3 grafo, 8.4 collezioni | la query sull'**IPC** | quattro comandi Tauri avvolgono lo stesso `query_index` (`app/lib.rs:411`, `:484`, `:505`, `:642`) |
| 27.3 version compatibility, 20.1 versioning plugin | presidio dell'additività del contratto | `wit_conformance` confronta abi↔WIT **oggi**, mai con la versione precedente |
| ~~22.4 centro di comando LLM, 27.1 CLI, 27.2 API locale, 16.2 automazioni~~ | ~~comandi descritti a una **macchina**~~ | **chiuso ([decisione 0009](../decisions/0009-registro-dei-comandi.md) + [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md))**: `CommandSpec { id, title, description, keybinding, params, scope }`, e l'host convalida gli argomenti contro la spec prima di chiamare il comando |
| ~~22.4 anteprima del piano, 7.2 bulk fix, 17.3 rollback, 16.3 undo~~ | ~~invocare **senza applicare** (dry-run)~~ | **chiuso ([decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md))**: `invoke(…, InvokeMode::DryRun)` → `CommandPlan` (i `DocId` impattati e un `EditRequest` per documento), con l'host che presta un `HostApi` in sola lettura — il non-scrivere è garantito, non promesso |
| 22.4 approvazione per operazione, 20.3 sandbox, 23.1 | il **consenso** dell'utente distinto dal permesso | il giro dry-run→piano→apply c'è ([decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md)) e la shell lo usa; ciò che manca è chi lo **impone** a un chiamante che non vuole simulare — è una policy del §7.3 sopra la firma |
| ~~7.2 bulk fix, 17.3 import, 11.3 editing bulk, 24.1 progresso~~ | ~~N scritture che sono **una cosa sola**~~ | **chiuso ([decisione 0011](../decisions/0011-il-lotto.md))**: `Workspace::batch(\|ws\| …)` coalizza `index-updated` e chiude con `Event::BatchEnded { batch, changed }` — una rinomina con 200 backlink passa da 201 ridisegni completi a 1, e gli eventi per-documento passano tutti. Non è una transazione: il tutto-o-niente resta al journal del §15.2 |
| ~~16.2 trigger su-modifica, 18 sync, 19.2 collaborazione~~ | ~~un evento che dice **chi lo ha causato**~~ | **chiuso ([decisione 0012](../decisions/0012-origine-degli-eventi.md))**: `handle` riceve un `Notice { event, origin }` con `Origin { actor, batch }`; `Actor::is_plugin(id)` è come un'automazione che scrive evita di richiamarsi da sola — prima l'unica difesa era il `DISPATCH_BUDGET` che tronca |
| 7.3 grafo, 8.2 proprietà, 7.2 salute del vault, 10 task, 15.1 citazioni | un canale dati che un provider possa **servire** | `query_index` risponde da sé a **sette varianti su nove** e ritorna prima del ciclo sui provider (`workspace.rs:1352-1425`) |
| 9.2 query di terzi, 22.1 indici semantici, 11 colonne, 21.2 | le regole del contratto raggiungibili da chi lo implementa | `properties`, `pathlink`, `health`, `tag_counts` sono `mod` **privati** del kernel (`kernel/src/lib.rs:19-23`) |
| ogni capacità futura, 20.3 permessi, M5 (proxy WASM) | **una** implementazione di `HostApi` più le politiche | 22 metodi × **4** impl scritte a mano (`workspace.rs:2339`, `:2535`, `:2720`, `features/src/testing.rs:179`) |
| 18.1 esclusioni dal sync, 18.2 backup, 24.2 rebuild, 2.2 portabilità | sapere se un dato persistito è derivato o autorevole | `data_write` non lo chiede, e sotto `.fubmd-data/` stanno entrambe le specie |
| 4.2 live preview, 8.3 naming, 2.3 path policy, 25.2 collazione | le regole condivise fra kernel e shell in un posto solo | sei regole già scritte due volte in due linguaggi; **una** ha un test che le lega |
| 21.2 venti bundle, 27.3 test utilities, 27.4 | un banco di prova del kernel riusabile | 18 helper `vault()`/`workspace()` e 14 `FormatProvider` giocattolo copiati nei test |
| 6.2 temi e snippet, 25.1 accessibilità, 20.1 UI di plugin | una shell con una struttura | 14 file piatti in `frontend/src/`, `main.ts` a 1622 righe, **18** custom property in 950 righe di CSS |
| 9.1 ricerca, e ogni indice futuro (22.1, 10, 11, 15.1, 8.2) | un esito sull'alimentazione dell'indice | `on_document_indexed`, `on_document_removed` e `reconcile` restituiscono `()` (`abi/traits.rs:928-936`): il provider di ricerca **sa** di aver perso un documento e non ha come dirlo (`search.rs:603-609`) |
| 10.5 notification center e alert, 24.2 error reporting, 16.3 automation errors, 18.1 errori di sync | una destinazione per «cosa è andato storto» | 14 `eprintln!` su `stderr` e 12 `console.warn/error` nella console della webview — nessuno dei due ha un lettore in un'app impacchettata; tre commenti del kernel rimandano a «M4: notifica» |
| 18.2 versioning, 16.2-16.3 automazioni, 20.2 log plugin | che qualcuno legga l'esito di un handler | `let _ = handler.handle(notice, &mut host)` (`workspace.rs:2094`): uno snapshot del versioning che non si scrive lascia il pannello cronologia identico a quando funzionava |
| 2.1 autosave e crash recovery, 24.2 error reporting, 3.1 vault read-only | uno stato di salvataggio e una superficie per un messaggio | `saveCurrent` non ha `catch` (`main.ts:1103`) e in `index.html` non esiste un elemento di stato: una scrittura fallita non cambia niente sullo schermo |
| 2.3 modifiche esterne, 3.1 tool di sync esterni, 18.1 per-file status, 24.2 file lock | sapere se il rilevamento delle scritture altrui funziona | il watcher è l'unico rilevatore, i suoi esiti per-path sono scartati (`app/lib.rs:266`, `:272`) e nessuno chiede mai se sia vivo |
| 27.4 testing, 27.3 plugin linting, 20.3 permission revocation | presidi esaustivi per costruzione, non a memoria | `view_refresh_masks.rs` elenca quattro view a mano e `TriesEverything` cinque capacità: la quinta view e la sesta capacità entrano restando verdi |
