# Sezioni generalizzabili di Fub

Questo rapporto individua blocchi ricorrenti che possono condividere una funzione, indicando il livello proprietario, le differenze da preservare e la prova necessaria prima dell'estrazione.

Analisi del 2 ottobre 2026 su `Fubeo/Fub`, branch `main`, commit `e0b70b537270ef294dc72a74bf3c9602946fa8fb`. Le firme proposte sono indicative e richiedono caratterizzazione e verifica nel rispettivo componente. La consegna consiste in questo rapporto; il comportamento del codice resta quello dello snapshot.

## Metodo e copertura

Ricerca trasversale con simboli, import, chiamanti e confronto di finestre di codice, seguita dalla lettura dei blocchi candidati, degli helper già presenti e dei test pertinenti. È una scansione ampia con approfondimenti mirati, non una review semantica integrale di ogni riga.

| Perimetro | Sorgenti Rust/TypeScript/JavaScript ricercati |
|---|---:|
| Client, editor, UI, stato, grafica, banco e configurazioni | 129 |
| Kernel, host e adattatore Tauri | 75 |
| ABI, SDK e testkit | 53 |
| Feature ufficiali | 17 |
| Formati Markdown e Sheet | 11 |
| Runtime WASM | 12 |
| Script CI e documentali | 21 |
| Esempi WASM e varco di conformità | 11 |
| Totale dello snapshot | 329 |

Sono stati esaminati anche i manifest, i confini canonici e test mirati del client e del backend. Asset, CSS, lockfile, baseline visuali, file generati e WIT frozen sono esclusi dalle proposte di estrazione. Le traduzioni e gli schemi sono stati considerati quando utili a distinguere una regola da dati dichiarativi.

Ogni candidato ha almeno due occorrenze concrete. **P1** indica un beneficio chiaro e un'estrazione circoscritta; **P2** richiede più caratterizzazione o interessa un confine delicato; **P3** è secondario, piccolo o limitato ai test. La priorità non misura il numero di righe eliminabili.

## Mappa dei candidati

| ID | Priorità | Funzione o helper | Owner |
|---|---|---|---|
| FE01 | P1 | Riuso di `highlighted` | UI client |
| FE02 | P1 | `tabIndexForKey` | UI client |
| FE03 | P2 | `createListCombobox` | UI client |
| FE04 | P2 | `openPaletteOverlay` | UI client |
| FE05 | P2 | `createSlider` | Pannello grafico |
| FE06 | P2 | `applyWindowSnapshot` | GridEngine |
| FE07 | P2 | `showSourceFallback` | GridEngine |
| FE08 | P2 | `registerInMap` | Stato client |
| FE09 | P2 | Riuso di `Queue.enqueue` | Mermaid e Grid |
| FE10 | P2 | `consumeStringTail` | Profilo formula |
| FE11 | P3 | `liveFakeHostModule` | Test client |
| KH01 | P1 | Riuso di `css_decode_escape` | Tema host |
| KH02 | P1 | `invalid_utf8` | Kernel |
| KH03 | P1 | `checked_extensions` | FormatRegistry |
| KH04 | P1 | Riuso di `list_authoritative` | Dati plugin kernel |
| KH05 | P2 | `ensure_command_not_active` | Workspace |
| KH06 | P1 | `finish_command_outcome` | Workspace |
| KH07 | P2 | `register_feature_providers` | Mount host |
| KH08 | P2 | `commit_prepared_document_write` | Host |
| KH09 | P2 | `agent_config` | Trasporto HTTP |
| KH10 | P2 | `run_host_blocking` | Adattatore Tauri |
| KH11 | P3 | Fixture disco e riuso di `Bench` | Test kernel/host |
| PR01 | P1 | `catalog_command` e `catalog_parameter` | Feature |
| PR02 | P2 | `run_and_redraw` | Feature |
| PR03 | P2 | `format_date_iso` | Locale o helper feature |
| PR04 | P3 | `navigate_from_payload` | Feature |
| PR05 | P2 | `with_instance` e `format_call` | Runtime WASM |
| PR06 | P2 | `analyse_dag` | Runtime WASM |
| PR07 | P2 | `narrow_span` con regola ABI | Traduttore WASM |
| PR08 | P1 | Riuso di due proiezioni WIT | Traduttore WASM |
| PR09 | P2 | `change_for_state` | Manager installazioni |
| PR10 | P2 | Budget comune di scrittura | Formato Sheet |
| PR11 | P2 | `writable_setting` | MemoryHost |
| PR12 | P3 | Riuso di `Bench/Mounted` | Test Markdown |
| CI01 | P1 | Enumerazione dei file e pagine canoniche | Script CI |
| CI02 | P1 | `sectionName` | Lettori Cargo CI |
| CI03 | P2 | `collectBracketedValue` | Lettori Cargo CI |
| CI04 | P2 | `markdownLinks` | Guard documentali |
| CI05 | P2 | `parseWorkspaceMembers` | Script workspace |
| CI06 | P2 | `forEachBenchScene` | Banco client |

## Client, editor e UI

### FE01 — Evidenziazione degli estratti UTF-8

**Occorrenze:** [helper UI:20–38](apps/client/src/ui/highlight.ts#L20-L38) e [copia nel pannello search:418–433](apps/client/src/panels/search.ts#L418-L433). Il corpo codifica UTF-8, filtra span vuoti/sovrapposti/fuori limite e costruisce testo più `mark`. `doc-search` usa già l'helper condiviso.
**Estrazione:** importare `highlighted(snippet, highlights): DocumentFragment` nel pannello search e rimuovere la copia.
**Invarianti e prova:** conservare offset in byte, ordine degli span e `textContent`. Riusare `ui/highlight.test.ts` e verificare il percorso reale dei due pannelli con accenti e markup nel testo.

### FE02 — Movimento da tastiera delle tab

**Occorrenze:** [document:671–679](apps/client/src/panels/document.ts#L671-L679), [settings:162–170](apps/client/src/panels/settings.ts#L162-L170), [views:807–815](apps/client/src/ui/views.ts#L807-L815); [node:1577–1601](apps/client/src/ui/node.ts#L1577-L1601) esprime la stessa regola.
**Estrazione:** `tabIndexForKey(current: number, key: string, count: number): number | null`, puro in `ui/`; ogni chiamante mantiene focus, click e attivazione.
**Invarianti e prova:** lista vuota, rotazione Left/Right, Home/End, tasti estranei; l'indice corrente viene da fonti diverse nei consumer. Tabella parametrizzata della regola e test DOM dei quattro ingressi.

### FE03 — Combobox di palette e quick switcher

**Occorrenze:** [palette:348–456](apps/client/src/ui/palette.ts#L348-L456), [quick switcher:154–249](apps/client/src/panels/quick-switcher.ts#L154-L249) e [tastiera:359–376](apps/client/src/panels/quick-switcher.ts#L359-L376).
**Estrazione:** `createListCombobox<T>({ lifetime, itemId, renderItem, onActivate, onEscape })` con input, lista e `setItems`. Riusa identificatori a11y e `Lifetime`; filtro, ranking, richieste host e azioni restano nei consumer.
**Invarianti e prova:** focus sull'input, `aria-activedescendant`, opzione vuota disabilitata, rotazione e scroll. Preservare bottoni nativi del quick switcher e passi multipli della palette. Usare entrambe le suite DOM per filtro, vuoto, Enter/Escape e chiusura.

### FE04 — Apertura della modale palette

**Occorrenze:** [palette:313–343](apps/client/src/ui/palette.ts#L313-L343) e [quick switcher:385–408](apps/client/src/panels/quick-switcher.ts#L385-L408), due `openOverlay`.
**Estrazione:** `openPaletteOverlay({ id, label, onClose })`, in `ui/`, per dialog, backdrop, box, etichetta, animazione e focus trap; riusa `trapFocus`, `enterSurface` e `exitSurface`.
**Invarianti e prova:** il nodo in uscita può essere riusato alla riapertura; timer, ricerca e avanzamento passi mantengono i propri owner. Testare riapertura rapida, backdrop, Escape e ritorno del focus. Modali settings/view hanno lifecycle distinti.

### FE05 — Costruzione dei due gruppi di slider del grafo

**Occorrenze:** [slider fisica:163–194](apps/client/src/graph/physics-panel.ts#L163-L194) e [slider grafica:224–251](apps/client/src/graph/physics-panel.ts#L224-L251).
**Estrazione:** `createSlider(field, initial, onChange)`, locale al pannello; restituisce elementi e riferimenti per aggiornare nome/valore. Riusa `formatValue` e la gestione dei listener, come fa già `createToggle`.
**Invarianti e prova:** la fisica sostituisce l'oggetto e rende custom il preset; la grafica muta lo stesso riferimento usato dal painter. Lasciare queste azioni nei callback. Verificare preset, identità graphics, cambio lingua e unmount nella suite physics-panel.

### FE06 — Installazione dello snapshot delle finestre Grid

**Occorrenze:** [apertura:1231–1244](apps/client/src/editors/grid/engine.ts#L1231-L1244), [viewport:1328–1339](apps/client/src/editors/grid/engine.ts#L1328-L1339), [reload:1384–1396](apps/client/src/editors/grid/engine.ts#L1384-L1396).
**Estrazione:** metodo privato `applyWindowSnapshot(session, windows)` per values/workbook, sheet attivo, clamp della selezione, layout e formula bar; riusa le funzioni pure già presenti.
**Invarianti e prova:** chiamare solo dopo il guard specifico di generazione/istanza/sessione. Assegnazioni di revisione, provider e dataset possono restare nel chiamante per preservarne l'ordine. Verificare apertura/reload/viewport, sheet attivo e risultati obsoleti con i test Grid.

### FE07 — Ripristino della visualizzazione Grid dal sorgente

**Occorrenze:** [fallback viewport:1349–1357](apps/client/src/editors/grid/engine.ts#L1349-L1357) e [fallback reload:1405–1413](apps/client/src/editors/grid/engine.ts#L1405-L1413).
**Estrazione:** `showSourceFallback(source: string)`, privato, per parseWorkbook, values vuoti, selezione, layout, formula bar, dataset e render.
**Invarianti e prova:** chiusura provider e invalidazione delle generazioni restano fuori; il chiamante sceglie il sorgente corretto. Caratterizzare guasto durante viewport e reload, selezione visibile e risultato tardivo. Il fallback successivo a un commit ha una sequenza differente.

### FE08 — Registrazione su mappa con disposer idempotente

**Occorrenze:** [store.on:71–87](apps/client/src/state/store.ts#L71-L87) e [kernel.onEvent:45–62](apps/client/src/state/kernel.ts#L45-L62).
**Estrazione:** `registerInMap<K, R>(map: Map<K, R[]>, key: K, registration: R): Teardown`, in `state/`; registra un oggetto distinto, lo rimuove una volta e pota la chiave vuota.
**Invarianti e prova:** due iscrizioni della stessa callback devono poter essere rimosse separatamente. Il dispatch dei due bus conserva ordine, snapshot e gestione errori propri. Esercitare disposer ripetuto e modifica delle iscrizioni durante la consegna.

### FE09 — Serializzazione dei lavori con Queue già disponibile

**Occorrenze:** [coda manuale Mermaid:98–144](apps/client/src/ui/mermaid.ts#L98-L144) e [coda commit Grid:1103–1106](apps/client/src/editors/grid/engine.ts#L1103-L1106). [Queue.enqueue:144–169](apps/client/src/ui/race.ts#L144-L169) implementa già FIFO e continuazione dopo un errore.
**Estrazione:** usare `Queue.enqueue<T>(job): Promise<T>`, globale per Mermaid e per istanza Grid.
**Invarianti e prova:** serializzare insieme initialize/theme/render; mantenere notifica sul diagramma corrente e guard/clone delle patch Grid. Preservare la politica di cattura degli errori dei consumer. Testare guasto seguito da lavoro valido e due commit ravvicinati; Race e CoalescingQueue hanno semantiche diverse.

### FE10 — Lettura della coda di una stringa formula

**Occorrenze:** [streamString:138–152](apps/client/src/editors/text/profiles/formula.ts#L138-L152) e [ramo inString:159–170](apps/client/src/editors/text/profiles/formula.ts#L159-L170).
**Estrazione:** `consumeStringTail(stream, state): "formulaString"` nello stesso profilo. L'apertura consuma prima la virgoletta; la continuazione passa direttamente al loop comune.
**Invarianti e prova:** conservare escape `""`, fine riga e stato multilinea. Caratterizzare stringa chiusa/aperta, continuazione e fine documento con il parser incrementale. Lo scanner su testo intero ha un contratto diverso.

### FE11 — Modulo fake IPC che segue l'host corrente

**Occorrenze:** [redraw.test:45–72](apps/client/src/redraw.test.ts#L45-L72) e [shell.e2e.test:74–105](apps/client/src/shell.e2e.test.ts#L74-L105), factory del mock IPC.
**Estrazione:** `liveFakeHostModule(current: () => FakeHost | null)`, in test-support, per proxy API/eventi/close e controlli finestra neutri. Riusa `createFakeHost`.
**Invarianti e prova:** il getter va valutato a ogni chiamata; catturare il primo host invalida i test dopo reset/swap. Preservare hoisting delle factory e teardown per suite. Verificare che una funzione recuperata prima dello swap usi il nuovo host e che l'assenza di host fallisca chiaramente.

## Kernel, host e adattatore Tauri

### KH01 — Decoder degli escape CSS

**Occorrenze:** [css_decode_escape:590–620](crates/fub-host/src/theme.rs#L590-L620) e [decode_css_escapes:843–887](crates/fub-host/src/theme.rs#L843-L887).
**Estrazione:** riusare `css_decode_escape(chars, start) -> (String, usize)` nel ciclo dell'intera stringa, nello stesso modulo.
**Invarianti e prova:** sei cifre, whitespace, newline e backslash terminale. Esiste una divergenza concreta: il primo usa U+FFFD per un surrogate, il secondo usa `expect` dopo `char::from_u32`. Il possibile panic è dedotto staticamente, senza riproduzione runtime. Caratterizzare D800/DFFF, zero, oltre 10FFFF e i percorsi url/image-set prima di decidere il comportamento comune.

### KH02 — Diagnostica dei byte UTF-8 invalidi

**Occorrenze:** [gitignore:41–54](crates/fub-kernel/src/vault.rs#L41-L54), [Vault.read:847–860](crates/fub-kernel/src/vault.rs#L847-L860), [sync:1610–1624](crates/fub-kernel/src/workspace.rs#L1610-L1624).
**Estrazione:** `invalid_utf8(bytes: &[u8], at: usize) -> io::Error`, privato nel kernel, per InvalidData, offset e byte esadecimale; i chiamanti scelgono path e wrapper.
**Invarianti e prova:** `rules::text_policy::decode` resta autorità della decodifica. Preservare BOM, CRLF, fallback del byte assente e tipo dell'errore. Usare text_fidelity e la stessa sequenza invalida su gitignore, read e sync.

### KH03 — Preparazione delle estensioni nel registro

**Occorrenze:** [register:67–79](crates/fub-kernel/src/registry.rs#L67-L79) e [register_source:93–104](crates/fub-kernel/src/registry.rs#L93-L104).
**Estrazione:** `checked_extensions(&self, descriptor) -> Result<Vec<String>, RegistryConflict>` in FormatRegistry; `insert_normalized` centralizza già l'inserimento.
**Invarianti e prova:** lowercase, primo conflitto nell'ordine originale e nessuna mutazione parziale. `replace` è sostituzione esplicita e mantiene il proprio percorso. Testare case misto e conflitto dopo un'estensione libera tramite entrambe le porte.

### KH04 — Elenco dei dati autorevoli dei plugin

**Occorrenze:** [ReadHost.data_list:104–118](crates/fub-kernel/src/host/read.rs#L104-L118) e [KernelHost.data_list:232–246](crates/fub-kernel/src/host/kernel.rs#L232-L246).
**Estrazione:** riusare [PreparedPluginDataIo.list_authoritative:3003–3013](crates/fub-kernel/src/workspace.rs#L3003-L3013), ottenuto da `prepare_plugin_data_io(plugin, prefix)`. `collect_data_files` resta algoritmo unico.
**Invarianti e prova:** canonical/legacy, prefix vuoto/nidificato, ordinamento e cache marker. Verificare la validazione dei path nei due ingressi prima della sostituzione. Letture byte, scritture e cancellazioni mantengono errori e regole proprie. Riusare la suite plugin_data con entrambe le implementazioni.

### KH05 — Rilevazione del ciclo dei comandi

**Occorrenze:** [prepare provider:9451–9461](crates/fub-kernel/src/workspace.rs#L9451-L9461), [prepare maintenance:9520–9530](crates/fub-kernel/src/workspace.rs#L9520-L9530), [invoke:9709–9719](crates/fub-kernel/src/workspace.rs#L9709-L9719).
**Estrazione:** `ensure_command_not_active(&self, command: &str) -> Result<(), PluginError>`, privata, per membership nella pila e percorso diagnostico del ciclo.
**Invarianti e prova:** controllo prima del push, pila invariata all'errore. Actor, batch e frame restano nei chiamanti; owner e argomenti hanno già helper. Testare ciclo diretto/A→B→A, sincrono/detached e successiva invocazione valida.

### KH06 — Trattamento comune dell'esito comando

**Occorrenze:** [maintenance:9563–9577](crates/fub-kernel/src/workspace.rs#L9563-L9577), [provider deferred:9604–9618](crates/fub-kernel/src/workspace.rs#L9604-L9618), [invoke:9791–9828](crates/fub-kernel/src/workspace.rs#L9791-L9828).
**Estrazione:** `finish_command_outcome(&mut self, owner, mode, outcome) -> Result<CommandOutcome, PluginError>`, per completare il piano, localizzare e aggiungere undo/partial.
**Invarianti e prova:** il frame deve essere già rimosso; undo solo Apply e profondità zero, localizzazione una sola volta. Drain eventi e chiusura batch mantengono le proprie porte. Esercitare i tre ingressi con piano incompleto, errore localizzato, annidamento e DryRun.

### KH07 — Registrazione di view e comandi opzionali

**Occorrenze:** [bundle normale:306–314](crates/fub-host/src/mount.rs#L306-L314) e [versioning:476–485](crates/fub-host/src/mount.rs#L476-L485).
**Estrazione:** `register_feature_providers(registrar, view_factory, commands_factory) -> Vec<String>`, privata in mount, componendo `register_view` e `register_commands`.
**Invarianti e prova:** ordine view→comandi; versioning prepara hook/store prima e pubblica lo store dopo successo. Feature assenti restano assenti. Testare combinazioni delle due factory e doppio fallimento nell'ordine stabile; il degrado speciale di search resta distinto.

### KH08 — Finalizzazione della scrittura detached già preparata

**Occorrenze:** [JobHost:355–365](crates/fub-host/src/jobs.rs#L355-L365) e [Host:2820–2830](crates/fub-host/src/session.rs#L2820-L2830).
**Estrazione:** `commit_prepared_document_write(workspace, prepared, source, model, before_write) -> Result<Revision, PluginError>`, helper host ristretto al token preparato: commit sotto lock, indici fuori lock, finish sotto lock ed eventi tramite la porta esistente.
**Invarianti e prova:** writer turn posseduto dal chiamante per tutta l'operazione; autorizzazione, cancellazione, parse e hook restano nei rispettivi percorsi. Servono test reali di lettura durante callback, due writer, hook fallito e indice fallito dopo scrittura. L'estrazione è subordinata a queste prove; edit chirurgici hanno journal/esiti differenti.

### KH09 — Configurazione base dei due agent HTTP

**Occorrenze:** [agent normale:111–121](crates/fub-host/src/net.rs#L111-L121) e [agent cancellabile:122–133](crates/fub-host/src/net.rs#L122-L133).
**Estrazione:** `agent_config(recv_body_timeout: Option<Duration>)` o builder privato, per timeout connect/global, zero redirect e PlatformVerifier; verificare il tipo ureq esatto nell'implementazione.
**Invarianti e prova:** solo il secondo agent ha polling del body. Policy URL e CancellationReader restano separati. Verificare configurazione comune, unica differenza body e cancellazione di una risposta in corso senza cambiare timeout totali.

### KH10 — Wrapper Tauri del lavoro bloccante

**Occorrenze:** [run_installed:117–126](crates/fub-app/src/lib.rs#L117-L126) e [set_plugin_enabled:933–947](crates/fub-app/src/lib.rs#L933-L947).
**Estrazione:** `run_host_blocking<T>(app, context, action) -> Result<T, PluginError>`, async e privato, per spawn_blocking, `State<Host>`, await e join error tipizzato.
**Invarianti e prova:** il ticket InstalledOperation resta vivo nella closure; begin_operation, fallback legacy e manager opzionale rimangono nei wrapper. Preservare contesto dell'errore e aspettativa di shutdown. Caratterizzare errore restituito e panic della closure; lean_ipc e mirror non provano da soli il join.

### KH11 — Fixture filesystem dei test kernel e host

**Occorrenze:** [entry_store:203–212](crates/fub-kernel/tests/entry_store.rs#L203-L212) e [index_feeding:148–167](crates/fub-kernel/tests/index_feeding.rs#L148-L167), per root temporanea e write con mkdir; [host corrente:21–31](crates/fub-host/tests/the_current_vault.rs#L21-L31) e [runner:35–45](crates/fub-host/src/legacy_tests/the_runner.rs#L35-L45), per vault con Nota.md.
**Estrazione:** helper `TestVault::new/write` locale a `kernel/tests/support`; nell'host valutare prima `fub_testkit::Bench::new().with_file(...)`, già disponibile.
**Invarianti e prova:** lifetime TempDir, fixture disco distinta dal mount, dati essenziali visibili nel test. Il kernel non prende testkit come dipendenza perché testkit dipende dal kernel. Migrare i test reali, incluso file nidificato; storage bloccante per concorrenza conserva le fixture specifiche.

## Feature, ABI, formati e runtime

### PR01 — Convenzione dei cataloghi comando/parametro

**Occorrenze:** [commands:121–130](crates/fub-features/src/commands.rs#L121-L130), [properties:495–503](crates/fub-features/src/properties.rs#L495-L503), [backup:255–263](crates/fub-features/src/backup.rs#L255-L263), [queries:473–481](crates/fub-features/src/queries.rs#L473-L481), [template:238–246](crates/fub-features/src/template.rs#L238-L246).
**Estrazione:** `catalog_command(id) -> CommandSpec` e `catalog_parameter(command, name, kind) -> ParamSpec` in un modulo neutro privato, usando i builder ABI e le chiavi title/desc già adottate.
**Invarianti e prova:** required, scope, reach e permessi restano alle feature. Il guard [independent_modules:193–239](crates/fub-features/tests/independent_modules.rs#L193-L239) richiede helper indipendenti dichiarati nel vocabolario ROOT con motivazione; evitare import da un'altra feature. Verificare cataloghi e build isolate di ogni feature interessata.

### PR02 — Comando seguito da ridisegno della view

**Occorrenze:** [backup:153–174](crates/fub-features/src/backup.rs#L153-L174), [properties:246–265](crates/fub-features/src/properties.rs#L246-L265), [queries:255–276](crates/fub-features/src/queries.rs#L255-L276), tre `command_then_tree`.
**Estrazione:** `run_and_redraw(host, command, args, warning_key, render) -> Result<ViewUpdate, PluginError>`, helper neutro: run_command, eventuale avviso localizzato, Replace dell'albero.
**Invarianti e prova:** catalogo e albero restano specifici; queries cattura la propria view. L'errore comando diventa avviso, l'errore render continua a propagarsi. Esercitare successo/fallimento dei tre consumer, render una sola volta e corretta collection/view.

### PR03 — Data ISO nel locale dell'host

**Occorrenze:** [backup.today:355–362](crates/fub-features/src/backup.rs#L355-L362) e [template.today:357–364](crates/fub-features/src/template.rs#L357-L364), identiche; [Locale:228–236](crates/fub-abi/src/locale.rs#L228-L236) contiene già la conversione civile.
**Estrazione:** helper comune `today(host: &dyn ReadApi) -> String`; se utile ad altri consumer, valutare `Locale::format_date_iso(utc_millis)` riusando to_civil_millis/civil_from_days.
**Invarianti e prova:** clock e locale arrivano dall'host, divisione euclidea e offset corrente restano quelli del contratto. Evitare UTC implicito o slicing del timestamp con ora. Testare passaggio di giorno, offset negativo, epoca e fine mese/anno con MemoryHost controllato.

### PR04 — Navigazione dal payload di un'azione

**Occorrenze:** [backlinks:103–109](crates/fub-features/src/backlinks.rs#L103-L109), [graph:178–184](crates/fub-features/src/graph.rs#L178-L184), [dashboard:92–99](crates/fub-features/src/dashboard.rs#L92-L99), [queries:242–248](crates/fub-features/src/queries.rs#L242-L248).
**Estrazione:** `navigate_from_payload(payload, field) -> ViewUpdate`, piccolo helper privato per campo stringa→Navigate, altrimenti None.
**Invarianti e prova:** dispatch dell'action id, validazione dei path e altri esiti restano ai consumer. Conservare stringa vuota se accettata. Testare campo assente/numerico, doc esatto e action sconosciuta. Beneficio modesto: evitare di trasformarlo in un framework per tutte le view.

### PR05 — Accesso protetto all'istanza WASM

**Occorrenze:** [call/call_read/grid_call:415–466](crates/fub-wasm-host/src/component.rs#L415-L466) e [metodi formato:807–867](crates/fub-wasm-host/src/component.rs#L807-L867).
**Estrazione:** `with_instance(inner, access_error, callback)` privato per enter_instance, lock, poison e Store/interfacce; eventualmente `format_call` per export formato, rinnovo limiti e mapping Parse/Render/Serialize.
**Invarianti e prova:** prestiti mutabile/read-only restano porte tipizzate diverse. with_guest rinnova già i limiti: evitare doppio rinnovo o omissione. Preservare guard RAII e categorie errore. Usare componenti reali per rientranza, trap, timeout, rilascio del borrow e le tre chiamate formato.

### PR06 — Macchina di visita dei DAG document/UI

**Occorrenze:** [model.preflight:455–574](crates/fub-wasm-host/src/model.rs#L455-L574) e [ui.preflight:312–402](crates/fub-wasm-host/src/ui.rs#L312-L402).
**Estrazione:** `analyse_dag(node_count, roots, limits, children, local_cost, error)` interno, limitato a colori, stack entrata/uscita, cicli, altezza e costo saturante delle occorrenze.
**Invarianti e prova:** payload, span, JSON e limiti restano specifici. Document ha due arene/più root; UI una arena/root e costo wire anche degli irraggiungibili. Testare nodi condivisi a profondità diverse, occorrenze ripetute, cicli/dangling irraggiungibili e budget. Rischio alto: caratterizzare entrambe le suite prima di estrarre; rebuild ricorsivo ABI non sostituisce questo preflight.

### PR07 — Riduzione controllata degli span WIT

**Occorrenze:** [translate.from_span:486–498](crates/fub-wasm-host/src/translate.rs#L486-L498) e [ui.span:35–42](crates/fub-wasm-host/src/ui.rs#L35-L42). La regola condivisa esiste in [arena:143–159](crates/fub-abi/src/arena.rs#L143-L159).
**Estrazione:** `narrow_span(wit_span) -> Result<model::Span, ArenaError>`, privata nel traduttore, usando `arena::Span::try_into`, già adottato dal decoder model.
**Invarianti e prova:** UI/edit mantengono BadArgs, model Parse. Narrowing non sostituisce controlli di ordine, limite sorgente o UTF-8. Verificare roundtrip, overflow a 32 bit e diagnostiche ai confini UI/edit/model; nessun troncamento di u64.

### PR08 — Proiezioni WIT già disponibili nel traduttore

**Occorrenze:** [from_ui_option:193–198](crates/fub-wasm-host/src/translate.rs#L193-L198) e [ui.option:53–58](crates/fub-wasm-host/src/ui.rs#L53-L58); [from_doc_change:807–816](crates/fub-wasm-host/src/translate.rs#L807-L816) e [events.from_aspect:276–285](crates/fub-wasm-host/src/events.rs#L276-L285).
**Estrazione:** rendere `pub(crate)` e riusare `translate::from_ui_option` e `translate::from_doc_change`. Le firme e il verso WIT→Rust sono già adeguati.
**Invarianti e prova:** adattare nel chiamante il wrapper Result infallibile della UI; mantenere direzioni inverse e famiglie errore separate. Verificare Choice/input value-label e tutte le varianti DocChange attraverso EventMask e DocChanges, conservando conformance WIT.

### PR09 — Cambio enabled/consent di un'installazione

**Occorrenze:** [set_enabled_for_state:274–300](crates/fub-wasm-host/src/managed.rs#L274-L300), [set_consent_inner:310–337](crates/fub-wasm-host/src/managed.rs#L310-L337); [store:373–398](crates/fub-wasm-host/src/installed.rs#L373-L398) ripete aggiornamento inventory/record/commit.
**Estrazione:** `change_for_state(host, installation, state, change)` nel manager, con enum privato Enabled/Consent; un eventuale `update_record` nello store conserva la CAS e la propria persistenza.
**Invarianti e prova:** turn per-installazione già acquisito, commit prima dell'invalidazione, reconcile anche se invariato e Vec di errori runtime dopo scelta persistita. Evitare riacquisizione del turn e inclusione della rimozione. Testare CAS, disable/consent, attivazione fallita, snapshot invalidato e race sulla stessa installazione.

### PR10 — Budget byte durante la serializzazione Sheet

**Occorrenze:** [ByteBudget:334–361](crates/fub-format-sheet/src/session.rs#L334-L361) e [SourceBudget:274–307](crates/fub-format-sheet/src/session/commit.rs#L274-L307).
**Estrazione:** prima una funzione privata `consume_budget(remaining, exceeded, bytes)`; un `LimitedWriter<W>` è un'alternativa solo se gestisce scritture parziali/errori del writer. Uno usa sink, l'altro raccoglie bytes.
**Invarianti e prova:** tetti 8 MiB risposta e 16 MiB sorgente distinti, errore limite distinto da serde, newline finale e rifiuto prima di estendere Vec. Testare limite esatto/+1, overflow, escape UTF-8, output borrowed/owned e degrado invalidazione Cells→All.

### PR11 — Accesso a una setting scrivibile nel MemoryHost

**Occorrenze:** [set_setting:1060–1075](crates/fub-sdk/src/testing/mod.rs#L1060-L1075) e [reset_setting:1078–1091](crates/fub-sdk/src/testing/mod.rs#L1078-L1091).
**Estrazione:** `writable_setting(settings, key)`, privato al doppio di test, per get_mut, errore chiave assente e program_writable; lock posseduto dal chiamante.
**Invarianti e prova:** set valida il valore, reset rimuove l'override e ripristina il default. Preservare BadArgs/PermissionDenied e assenza di mutazione su errore. Verificare matrice chiave assente/non scrivibile/valore invalido/reset già vuoto; il Guard kernel rimane indipendente.

### PR12 — Impalcatura delle integrazioni Markdown

**Occorrenze:** [vault_e2e.open:15–23](crates/fub-format-markdown/tests/vault_e2e.rs#L15-L23), [transfer.workspace_on:31–45](crates/fub-format-markdown/tests/transfer_e2e.rs#L31-L45), [index_queries.vault:75–82](crates/fub-format-markdown/tests/index_queries_e2e.rs#L75-L82), [parsed_model:75–82](crates/fub-format-markdown/tests/parsed_model_e2e.rs#L75-L82).
**Estrazione:** riusare [Bench:141–166](crates/fub-testkit/src/lib.rs#L141-L166) con `Bench::on(root).with_format(MarkdownProvider::boxed()).mounts()`; transfer conserva without_scan/plugin e registrazione locale. Aggiungere testkit soltanto come dev-dependency, assente dal manifest Markdown dello snapshot.
**Invarianti e prova:** provider Markdown reale, lifetime root esterna, prima scansione e isolamento scratch delle sonde. Corpus e scenari restano nelle suite. Verificare stessi documenti/entry, query/modelli e roundtrip byte dei transfer.

## Script del repository e banco

### CI01 — Enumerazione ricorsiva e perimetro delle pagine

**Occorrenze:** [doc-links:16–27](.github/scripts/check-doc-links.mjs#L16-L27), [doc-orphans:9–14](.github/scripts/check-doc-orphans.mjs#L9-L14), [doc-size:9–14](.github/scripts/check-doc-size.mjs#L9-L14), [markdown-style:7–27](.github/scripts/check-markdown-style.mjs#L7-L27) e [tables:89–94](.github/scripts/check-tables.mjs#L89-L94). [counts.walk:6–12](.github/scripts/counts.mjs#L6-L12) è già condivisibile; mermaid/prose hanno altre copie.
**Estrazione:** `walkFiles(dir, { missing })` e `canonicalMarkdownFiles(root)`, in modulo privo di side effect a import. Riunire l'elenco root canonico copiato in tre guard.
**Invarianti e prova:** directory obbligatoria/assente distinta da opzionale; politica su symlink/ordine esplicita. I sourceFiles di races/listeners/CodeMirror differiscono su test, tsx e node_modules: i filtri restano specifici. Confrontare insiemi di path e diagnostiche su directory annidate/root assente.

### CI02 — Riconoscimento delle sezioni Cargo

**Occorrenze:** [workspace-members:44–47](.github/scripts/workspace-members.mjs#L44-L47), [feature-default:58–61](.github/scripts/check-cargo-feature-default.mjs#L58-L61), [crate-type:62–65](.github/scripts/check-crate-type.mjs#L62-L65), [dev-profile:69–72](.github/scripts/check-dev-profile.mjs#L69-L72), [cargo-versions:64–67](.github/scripts/check-cargo-versions.mjs#L64-L67).
**Estrazione:** `sectionName(line): string | null`, puro in un modulo `cargo-lines.mjs`; le cinque copie hanno la stessa regex.
**Invarianti e prova:** conservare diagnostica fail-closed e regole delle singole sezioni nei consumer. Testare tabella, array di tabelle, spazi, commento e forma non leggibile. Una piccola funzione comune basta senza aggiungere un parser TOML completo.

### CI03 — Raccolta delle liste Cargo multilinea

**Occorrenze:** [feature-default:90–102](.github/scripts/check-cargo-feature-default.mjs#L90-L102), [crate-type:94–105](.github/scripts/check-crate-type.mjs#L94-L105), [workspace-members:79–86](.github/scripts/workspace-members.mjs#L79-L86).
**Estrazione:** `collectBracketedValue(lines, start): { text, nextIndex, closed }`, per bilanciamento e continuazioni; regex di interpretazione e diagnostica restano nei consumer.
**Invarianti e prova:** riga iniziale, commenti interni/finali e lista non chiusa. Caratterizzare parentesi nei commenti/stringhe prima di ampliare la grammatica. Il lettore di dipendenze con graffe ha gestione distinta e non entra automaticamente nell'helper.

### CI04 — Scanner comune dei link Markdown

**Occorrenze:** [doc-links:29–46](.github/scripts/check-doc-links.mjs#L29-L46), [decode/scanner:73–95](.github/scripts/check-doc-links.mjs#L73-L95), [doc-orphans:16–38](.github/scripts/check-doc-orphans.mjs#L16-L38).
**Estrazione:** `markdownLinks(text): Array<{ raw, target, line }>` e risoluzione locale del target, per fence, link, titolo e decode URI.
**Invarianti e prova:** links controlla anche reference e marker coerente; orphans usa inline e toggle più semplice. Prima caratterizzare questa differenza. Anchor/confini repo restano nel primo guard, raggiungibilità dei soli Markdown nel secondo. Testare fence, reference, titoli, percent-encoding, URL esterni e percorso fuori root.

### CI05 — Lettura unica dei membri del workspace

**Occorrenze:** [counts:18–23](.github/scripts/counts.mjs#L18-L23) rilegge members con regex, mentre [workspace-members:62–94](.github/scripts/workspace-members.mjs#L62-L94) possiede già un lettore esplicito della sezione.
**Estrazione:** `parseWorkspaceMembers(text): string[] | null`, puro, usato dal conteggio e dalla verifica. `crateDelWorkspace` continua a confrontare dichiarazioni e filesystem.
**Invarianti e prova:** lista assente distinta da vuota; commenti non sono membri, exclude non è members. Confrontare due consumer su fixture inline/multilinea, voce commentata e sezione mancante, conservando il conteggio dichiarato distinto dalle violazioni.

### CI06 — Ciclo delle scene nelle due luci del banco

**Occorrenze:** [a11y:37–46](apps/client/bench/a11y.mjs#L37-L46) e [photos:113–122](apps/client/bench/photos.mjs#L113-L122), apertura pagina per luce, visita scene, raccolta risultati e chiusura context.
**Estrazione:** `forEachBenchScene(stage, visit)` in supporto bench, con callback specifica per axe o fotografia. `openStage/openPage/prepareScene` sono già condivisi e restano tali.
**Invarianti e prova:** ordine LIGHTS/SCENE, pagina riusata nella stessa luce, context chiuso anche se visit fallisce, stage posseduto dal caller. Caratterizzare eventuali errori di chiusura per conservare l'errore principale. Verificare cleanup delle due suite senza cambiare baseline o soglie.

## Confini da preservare e casi scartati

- **Indici e storage:** planner e porte di scrittura atomica hanno già helper comuni. RootedStorage/FsStorage, dati autorevoli/cache, no-follow e journal hanno invarianti differenti; le syscall simili non giustificano un runner unico.
- **Grid nativo/WASM:** `host/sheet.rs` e `esempi/grid-wasm` traducono verso tipi ABI Rust e tipi WIT generati diversi. La semantica SheetSession/Window/Commit è già condivisa nel formato; evitare una nuova dipendenza ABI nel formato per ridurre mapping. Preferire prove di parità.
- **Contratti e generati:** mirror Rust/TypeScript, WIT frozen, modelli ricorsivi/arena e fixture di conformità mantengono rappresentazioni distinte. Ogni modifica ai generati passa dalla sorgente/generatore; la somiglianza dei dati non implica un helper eseguibile.
- **Concorrenza:** writer turn, cancellazione, sessione documento/superficie e salvataggi mantengono owner e sequenze propri. Le ultime fasi read-model in Host/JobHost si somigliano, ma Host può risolvere il vault corrente in due accessi separati: caratterizzare il cambio vault prima di valutare un'ulteriore estrazione.
- **Test e feature:** MemoryHost prova il provider contro il contratto, Bench/Mounted prova il kernel reale. Le feature devono compilare isolate; un helper condiviso non deve rendere obbligatoria un'altra feature. Le fixture WASM ostili e i piccoli componenti autonomi restano comprensibili e indipendenti.
- **Contenuto dichiarativo:** traduzioni, ricette CSS/tema, wrapper IPC tipizzati e molti match del parser Markdown esprimono contenuto o confini differenti. Una factory DOM o un visitatore universale richiede una regola comune dimostrata oltre alla forma del codice.

## Uso del rapporto e verifica

I primi interventi più circoscritti sono FE01, FE02, KH03, KH04, PR08 e CI02: riusano una regola esistente o estraggono un calcolo puro. KH01 merita caratterizzazione immediata della divergenza Unicode. KH08, PR05, PR06 e PR09 richiedono prove reali di lock, lifecycle, dati ostili e persistenza prima dell'estrazione.

Le proposte sono osservazioni sullo snapshot e firme candidate; attività approvate e ownership operativa vanno tracciate nelle GitHub Issues secondo le regole del repository. Non si attribuiscono risparmi di prestazioni o correttezza a un refactor ancora da implementare.

Per questa consegna sono stati verificati riferimenti e intervalli di righe contro i blob dello snapshot, oltre a link, stile, tabelle e guard documentali, includendo esplicitamente questo file root. Test/build Rust e frontend non sono stati eseguiti perché il cambiamento è esclusivamente documentale. La verifica Mermaid è strutturale: il rendering dei diagrammi canonici preesistenti richiede una CLI assente dal runtime; questo rapporto non contiene diagrammi.
