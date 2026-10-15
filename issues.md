# Astrazioni mancanti o aggirate

Ricognizione del 25 settembre 2026 sul branch `feat/workspace-revisione`
(HEAD `b75d1161`, con file non tracciati preesistenti). Cerca i punti in cui
Fub non tiene fede alla propria idea di modularità: il formato come
`FormatProvider`, le superfici risolte dal registro, le porte generiche, la
parità nativo/WASM, la shell mobile come confine.

Questo file è un elenco di lavoro, non architettura corrente né tracker: le
voci da eseguire vanno aperte come GitHub Issue collegate a
[#77](https://github.com/Fubeo/Fub/issues/77).

## Metodo e grado di prova

Ogni voce è stata prima trovata da una ricognizione statica, poi verificata una
seconda volta in modo indipendente, affermazione per affermazione. I numeri di
riga sono quelli verificati su HEAD.

- **Riprodotto:** confermato eseguendo codice reale. `fub-cli` su un vault
  temporaneo (`--no-watcher --format json --yes`), oppure una sonda Rust
  costruita fuori dal repo.
- **Verificato:** confermato leggendo il codice e seguendo il percorso di
  chiamata.
- **Corretto:** la prima formulazione era in parte sbagliata; qui compare la
  versione verificata. Le parti smentite sono riassunte in fondo.

Non sono stati eseguiti test della suite né l'app Tauri. Nessun file del repo è
stato modificato oltre a questo.

Le voci I48–I88 vengono da una seconda ricognizione, fatta nello stesso modo.
Le prove eseguite sono di tre tipi:

- sonde Vitest temporanee che usano la shell reale con `host/fake.ts`,
  cancellate subito dopo l'esecuzione;
- `cargo check` su combinazioni di feature;
- un server `fub-services` locale.

Le riproduzioni più gravi (I48, I55, I61, I62, I71) sono state ripetute una
seconda volta a mano.

Le voci I89–I91 vengono da una terza ricognizione, fatta senza subagent. Una
prova che dipende dagli indici va fatta nel `repl` di `fub-cli`, o dopo
`wait_indexed`: un comando secco li interroga prima che siano pronti (I90).

Le voci I92–I103 vengono da una quarta ricognizione condotta tramite subagent
specializzati su aree ad alto rischio: sicurezza della sandbox, persistenza,
atomicità dello storage, deadlock di concorrenza, crash per ricorsione
illimitata e perdita dati nel frontend.

## Priorità 0: dati dell'utente

### I01. `note.property.set/remove` corrompono i file `.base`

**Riprodotto.**

- `crates/fub-features/src/properties.rs` non verifica mai il formato: non
  compaiono `format_of`, `capabilities()` o `supports(FRONTMATTER)`.
- `set` (`:1066`) e `remove` (`:1110`) passano per `rewrite` (`:1161`) e
  `edit_property_frontmatter` (`:1601`). Se il documento non ha frontmatter
  chiamano `edit_frontmatter` (`:1719`), che scrive `format!("---\n{yaml}---\n")`
  (`:1791`).

Prova su un vault temporaneo:

```text
tab.base prima:  views:\n  - name: Tutto\n    type: table\n
fub-cli ... command note.property.set --args '{"doc":"tab.base","key":"status","value":"x"}'
→ ok: true, "Proprietà «status» in tab.base"
tab.base dopo:   ---\nstatus: x\n---\n\nviews:\n  - name: Tutto\n    type: table\n
```

Conseguenze:

- Il modello passa da `views:["Tutto"]` a `views:[]`: la definizione della vista
  è persa, e il comando risponde comunque con successo.
- `note.property.remove` non la toglie, perché il modello Base non espone
  frontmatter. Si recupera solo con l'undo.
- Il kernel accetta la scrittura perché `BaseProvider::parse`
  (`crates/fub-format-base/src/lib.rs:54-91`) non fallisce mai: se la
  definizione è invalida produce `views:[]`.

Sul `.canvas` la scrittura viene respinta, ma solo per caso:

- La blocca il reparse prima della scrittura
  (`Workspace::apply_edit` → `write_source` → `self.docs.parse`,
  `crates/fub-kernel/src/workspace.rs:6158`, `:6171`, `:5967`).
- L'errore non è tipizzato: `"internal plugin error: parse failed: invalid
  .canvas JSON"`.
- Il `--plan` propone comunque di inserire `---\nstatus: x\n---\n\n` in 0..0.
- `property.key.rename` non tocca `.canvas` e `.base`: seleziona i documenti con
  un predicato `Property Exists` (`properties.rs:1283-1296`).
- Lo stesso difetto si vede con `note.create` e `properties` su un nome `.base`:
  scrive un frontmatter che viene accettato (vedi I03).

**Direzione.** Mettere una guardia di capability: Markdown dichiara
`syntax::FRONTMATTER` (`crates/fub-format-markdown/src/lib.rs:53`), Canvas e
Base no. Restituire un errore tipizzato "formato non supportato". Valutare se un
`.base` invalido debba fallire il parse invece di degradare in silenzio.

### I02. `import.normalize` e `import.convert_legacy` riscrivono ogni formato

**Riprodotto, corretto.**

- `target_docs` usa `host.list_documents(None)` senza filtro di formato
  (`crates/fub-importers/src/normalize.rs:38-43`).
- `normalize_source` (`:58`) converte CRLF/CR in LF e toglie lo spazio finale da
  ogni riga.
- `convert_legacy_source` (`:79`) sostituisce `bear://` e `craftdocs://` in
  tutto il testo.
- Nessuno dei due cerca frontmatter: la prima formulazione era sbagliata su
  questo punto.

Prova: `import.normalize` riporta "3 updated" e ha riscritto `board.canvas` e
`tab.base`. `import.convert_legacy` ha cambiato il testo di una card canvas da
`vedi bear://x` a `vedi [bear-link]x`.

- Sul JSON l'effetto è semanticamente innocuo.
- Sugli scalari a blocco YAML di un `.base` togliere lo spazio finale può
  cambiare il significato.

**Direzione.** Filtrare per formato e capability. Sono trasformazioni del
testo Markdown importato.

## Priorità 1: sintassi Markdown scritta fuori dal provider (Rust)

### I03. Il formato di default è deciso in due posti, entrambi impliciti

**Verificato; l'effetto su `.base` è riprodotto.**

- `crates/fub-features/src/commands.rs:102`: `DEFAULT_EXTENSION = "md"`, usato
  da `with_extension` (`:1436-1443`) e per `Untitled` (`:1535`).
  - `initial_properties` (`:1457`) serializza il frontmatter YAML a `:1512`
    senza sapere il formato del file.
  - Con `note.create {"name":"x.base","properties":…}` il `.base` riceve un
    frontmatter che viene accettato. Sul `.canvas` è respinto dal parse.
- `crates/fub-kernel/src/registry.rs:216-223`: `default_extension()` restituisce
  la prima estensione del *primo* provider registrato.
  - L'ordine lo decide l'array in `crates/fub-host/src/mount.rs:225-229`
    (Markdown, Canvas, Base).
  - Lo usa solo `Workspace::new_notes_id` (`workspace.rs:7441`).

Ci sono quindi due fonti di verità, e nessuna è una porta. **Direzione:** una
porta `HostApi` per il formato preferito delle note nuove, che la feature
interroga.

### I04. Link e task sono scritti con sintassi Markdown dalle feature

**Verificato.**

| Punto | Cosa scrive |
|---|---|
| `crates/fub-features/src/commands.rs:1202`, `:1247` (`selection.wikilink`) | `[[{selected}]]`, senza controllo di formato |
| `commands.rs:2139`, `:2227-2228` (task toggle) | `"x"` / `" "`. La posizione del marcatore viene correttamente dal modello (`task_at`, `:2292`): è solo il simbolo a essere Markdown |
| `crates/fub-features/src/backlinks.rs:285`, `:316`, `:318` (`convert_to_link`) | `[[{reference}]]` / `[[{reference}\|{mention}]]` |
| `crates/fub-features/src/template.rs:1816`, `:1867`, `:1869` (`note.extract`) | `![[…]]` / `[[…]]` |

### I05. Template e diario dipendono da Markdown

**Verificato.**

- `crates/fub-features/src/template.rs:57`: `DAILY_TEMPLATE =
  "Templates/Daily.md"`.
- `template.rs:58`: `EXTENSION = "md"`, usato a `:968`, `:1205` e `:1439`.
- `template.rs:1735`: `split_frontmatter` scritto a mano.

### I06. Le note a piè di pagina di Outline chiamano direttamente il crate Markdown

**Verificato.**

- `crates/fub-features/src/outline.rs:31` importa
  `fub_format_markdown::collect_footnotes`.
- `:124-127` controlla `descriptor.id == "markdown"`, e `:132` chiama la
  funzione sul sorgente grezzo.
- `crates/fub-features/Cargo.toml:41`: `outline = ["dep:fub-format-markdown"]`.
- La parte titoli dell'outline invece passa correttamente da
  `IndexQuery::Outline` (`:137`).

Il modello ABI ha già `custom_kind::FOOTNOTE_DEFINITION/REFERENCE`.

### I07. I comandi di import/export non consultano il registro che l'host riempie

**Verificato.**

- `crates/fub-importers/src/transfer_commands.rs:165-176`: `import_provider()`
  prova prima `fub_format_markdown::MarkdownImport`, poi la lista statica
  `crate::import_providers()`.
- `:177-181`: `export_providers()` restituisce `MarkdownExport` più la lista
  statica.
- L'host però registra gli import/export provider nel kernel:
  - `mount.rs:165-172` e `register_markdown_transfer` (`:612-621`);
  - passano da `Registrar::register_import/export_provider`
    (`crates/fub-host/src/registry.rs:178-190`);
  - arrivano in `Workspace::register_import_provider` / `…export_provider`
    (`workspace.rs:10620`, `:10635`).
- I dispatcher `Workspace::import` (`:10720`) ed `export_to` (`:10777`) non
  hanno chiamanti fuori dai test.

Un `ImportProvider` registrato, nativo o futuro WASM, non viene mai scelto.
Inoltre `crates/fub-importers/src/export_pdf.rs:161` (`markdown_to_lines`) fa
da sé il parsing Markdown del sorgente grezzo (`:73`): frontmatter a `:171-186`,
fence a `:192-199`, e toglie `.md` dai titoli a `:168`.

### I08. Publish tratta Markdown e Canvas come casi speciali

**Verificato, corretto.**

- `crates/fub-host/src/publish/site.rs:938-940` esclude dalle pagine ogni
  documento con `descriptor.id != "markdown"`.
  - Correzione: i `.canvas` raggiunti come asset vengono pubblicati come
    `{path}.html` (`:1025-1041`).
- `crates/fub-host/src/publish/projection.rs:197-211` risolve i wikilink
  aggiungendo `.md`, poi cerca in `page_paths`, che è indicizzato per id
  completo (`site.rs:997-1000`).
  - Conseguenza: un link a nome breve verso `dir/Nota.md` fallisce con
    `"wikilink target is not published"`.
  - In `publish/` non si usa mai `IndexQuery::Resolve`.
- `projection.rs:306` (`canvas()`, parsing a `:310-400`) è un secondo parser
  JSON Canvas scritto a mano.
  - `fub-format-canvas` esporta già `parse_canvas` (`lib.rs:30`) e
    `render_html` (`lib.rs:79`), e `fub-host` ne dipende già.
  - A parziale giustificazione: il proiettore applica una politica più severa,
    perché rifiuta le card remote (`:414-420`).

### I09. La cattura rapida esiste in quattro copie divergenti

**Verificato.** Nessuna copia chiama le altre. In comune hanno solo il tipo di
payload di `fub_host::automation`. Nemmeno la validazione è davvero condivisa:
la copia mobile ne ha una sua, senza il controllo del vault (vedi I77).

| Copia | Corpo | Nome |
|---|---|---|
| `crates/fub-app/src/mobile.rs` | `titled_body` `:612-623` (`# {title}` `:613`, `Fonte:` `:616`) | `Untitled.md` a `:714` e `:744`; ha un suo `with_extension` (`:625-632`); supporta i template |
| `crates/fub-cli/src/capture.rs` | `titled_body` `:138-150` | `:201-211`, aggiunge sempre `.md` |
| `crates/fub-cli/src/native_host.rs` | `titled_body` `:605-616` | `:421-431`, aggiunge sempre `.md` |
| `apps/client/src/shells/mobile/capture.ts` | `captureBody` `:66-72`, aggiunge `#segnalibro` | `Untitled.md` a `:92`, il nome non deriva dal titolo |

Altre varianti: `crates/fub-cli/src/capture.rs:697-699` e `:727` (percorso
`uri`), e `crates/fub-cli/src/local.rs:311`. La stringa `"Fonte:"` è italiana e
non passa dai cataloghi.

**Direzione.** Un unico comando host, ad esempio `capture.apply`.

### I10. `FormatProvider` non ha operazioni di scrittura mirata

**Verificato.** È la causa comune di I03, I04 e I05.

- Il trait (`crates/fub-abi/src/format.rs:306`) ha `descriptor`,
  `capabilities`, `parse`, `render_html`, `serialize` e `rewrite_links`
  (opzionale, `Ok(None)` di default, `:379-386`).
- `serialize` è documentato come "mai per file esistenti" (`:360-365`).
- Non esiste un'operazione per scrivere proprietà, inserire link o cambiare lo
  stato di un task.

**Direzione.** Aggiungere operazioni di modifica mirata sullo stesso modello di
`rewrite_links`, ad esempio `edit_properties`, `format_link(target, alias,
embed)` e `set_task_state`. Nel frattempo usare
`capabilities().supports(...)` come guardia.

## Priorità 2: superfici dell'editor (frontend)

Tutti i path di questa sezione sono relativi ad `apps/client/src/`.

### I11. Il contratto `EditorSurface` è centrato sul buffer di testo

**Verificato, corretto.**

- `editors/core/registry.ts:4-8` importa (solo come tipi) `DocumentUpdate`,
  `EditorChange` ed `EditorSelections` da `../text/engine`.
- Richiede `setDoc(text)` (`:49`), `syncDoc(DocumentUpdate | string)` (`:50`) e
  `getDoc(): string` (`:51`).

Correzione: grid, canvas e base non fingono. Il loro file è davvero testo, e le
patch strutturate sono sottotipi di `TextOperation` (`grid/operation.ts:31`,
`canvas/operation.ts:16`).

Chi finge davvero:

- La superficie media: `setDoc` e `syncDoc` vuoti, e `getDoc()` restituisce la
  stringa `"view"` (`editors/media/media-surface.ts:126-134`).
- `staticSurface` (`editors/core/bootstrap.ts:152-160`).

Una superficie binaria o strutturata non trova posto nel contratto.

### I12. La navigazione passa solo per `revealByteOffset`, un no-op silenzioso

**Verificato.**

- Implementano `revealByteOffset` solo la superficie Markdown
  (`bootstrap.ts:110` → `editor/editor.ts:360`) e quella plain-text
  (`bootstrap.ts:237`).
- Grid, canvas, base, media e static non lo implementano.
- L'unico punto d'ingresso è `panels/document.ts:2642-2644`,
  `panes.get(layout.focus)?.surface?.revealByteOffset?.(byteOffset)`: nessun
  avviso, nessun fallback.
- Ci arrivano:
  - `ui/intents.ts:69` (`reveal` delle viste outline e backlink);
  - `state/shell-commands.ts:40` (segnalibri);
  - `panels/document.ts:349`, `:359`, `:2402` (wikilink `#heading`/`^block`);
  - `panels/search.ts:518`;
  - `panels/doc-search.ts:225`.
- Il caso si presenta davvero sul canvas, che ha un modello con titoli e link
  con span (`crates/fub-format-canvas/src/parse.rs:113`, `:145`, `:163`).
- Sullo sheet per ora è latente: è un formato solo sorgente, senza modello.

**Manca:** una destinazione opaca (`SurfaceLocation` / `reveal(target)`) che
ogni superficie interpreti.

### I13. Le modalità Markdown sono nel contratto ABI e nel WIT congelato

**Verificato.**

- `host/enums.generated.ts:108`: `PaneMode = "source" | "live_preview" |
  "reading"`.
- Il tipo viene da `fub_abi::session::PaneMode`
  (`crates/fub-abi/src/session.rs:94`).
- Nel WIT è `enum pane-mode` (`abi.wit:2759`), presente anche in
  `wit/frozen/0.1.0.wit:1949`.
- Le altre superfici si adattano alle modalità Markdown:
  - sheet, canvas, base ed error mappano su `source` (`bootstrap.ts:76`,
    `canvas/surface.ts:91-92`, `base/data.ts:265`, `bootstrap.ts:85`);
  - media e viewer statico mappano su `reading` (`media-surface.ts:26`,
    `bootstrap.ts:80`).

Cambiarlo richiede un'aggiunta compatibile col WIT congelato.

### I14. `isMarkdownSurface` sostituisce le capability

**Verificato, corretto sulla stampa.**

La guardia è `editors/core/bootstrap.ts:34`. In `panels/document.ts` decide:

- drag, drop e incolla (`:260`, chiamata a `:1841`);
- gli allegati: `attachmentMarkdown()` (`editors/media/attachment-target.ts:134`)
  produce `![](…)` / `[name](…)` dentro il pacchetto *media*;
- il drop di una nota, che produce `[[${reference}]]` (`:297`);
- le slide: `presentSlides` (`:2069-2088`) legge `.pane-preview` dal DOM della
  superficie (`:2074`);
- le voci registratore, slide e stampa del menu (`:2120-2127`).

Correzione sulla stampa: il contratto `IndexQuery::RenderPrint` è neutro, ma il
risultato dipende dal formato (`workspace.rs:9079`, `documents.rs:470-482`):

- **canvas:** funzionerebbe (`CanvasProvider::render_html`);
- **base:** stampa il YAML in un `<pre>`;
- **sheet:** fallirebbe con `NoProvider`, perché non ha un provider.

Quindi solo il canvas perde la stampa senza motivo.

### I15. Il registro delle superfici è chiuso: nessun plugin può registrarne una

**Verificato.** È emerso durante la verifica ed è più grave del routing dei
media.

- `SurfaceFamily` è un'unione chiusa di sei valori
  (`editors/core/registry.ts:10`).
- `bootstrap.ts` le registra tutte e sei (`:189`, `:246`, `:263`, `:300`,
  `:323`, `:339`).
- Il registro ammette un solo proprietario per famiglia (`registry.ts:154-156`)
  e per source kind (`:164-169`).
- Nessuno fuori da `bootstrap.ts` chiama `register`. Il commento "plugins use
  the same registry seam" (`bootstrap.ts:182`) oggi non vale.

Il routing dei media aggiunge un secondo vincolo:

- `panels/document.ts:1759-1763` passa dal registro, ma forza
  `{ formatId: null, sourceKind: "bytes" }` in base alla tabella MIME della
  shell, prima di leggere il descrittore del backend. Un binding di formato per
  un'estensione media non è quindi raggiungibile.
- `panels/explorer.ts:617-625` (`fileRow`) per i file "other" mostra solo una
  notifica e non consulta il registro.
- `selectSourceProfile` ripete la stessa classificazione (`bootstrap.ts:317-318`).

### I16. `editor/` non è codice legacy, ma è nel posto sbagliato

**Verificato, corretto sugli shim.**

- `editor/editor.ts` è la vera superficie Markdown: tre modalità (`:32`), la
  resa di lettura `.pane-preview` (`:170-171`), la slash palette (`:125-156`).
  Vive fuori da `editors/text/profiles/markdown/`.
- `bootstrap.ts:90-116` (`markdownSurface`) la avvolge una seconda volta: il
  doppio adapter è `Editor` → `MarkdownEditorSurface`.
- Shim di una riga:
  - `editor/livepreview.ts` non ha importatori.
  - `editor/completions.ts` è importato solo da `bootstrap.ts:2`.
  - `editor/theme.ts` è importato da `theme/typography.test.ts:7` con `?raw`.
    Il test legge il testo dello shim, che non contiene `var(--…)`, quindi la
    metà "editor" del controllo "ogni token tipografico è usato" è vuota. Va
    puntato a `../editors/text/theme.ts?raw` prima di rimuovere lo shim.
- `editor/text-operation.ts` è il modello condiviso da `state/document-session.ts`,
  `state/document-bridge.ts`, `editors/grid/*`, `editors/canvas/*`,
  `editors/text/engine.ts:69` e `ui/markdown-resources.ts`. Il pacchetto
  `editors/` dipende quindi all'indietro da `editor/`.

### I17. La resa Markdown è divisa fra `ui/` e il profilo

**Verificato, corretto.**

- La generazione HTML sta nel profilo (`editors/text/profiles/markdown/render.ts`).
- `ui/markdown.ts` (`mountMarkdown`, `:297`) è lo strato di montaggio:
  sanitizzazione, embed, mermaid, matematica, media ed evidenziazione.
- Le dipendenze vanno in tutti e due i sensi fra le cartelle:
  - `profiles/markdown/livepreview.ts:30-31` importa `ui/markdown` e `ui/math`;
  - `ui/markdown.ts:6` importa `profiles/markdown/highlight-code`.
- Correzione: non c'è un ciclo fra moduli. `highlight-code.ts` importa solo
  `ui/race` e `ui/lifetime`, verificato con uno script sul grafo degli import.

Il problema è di collocazione: la resa non si sostituisce insieme al profilo.

### I18. La finestra documento staccata scavalca registro e temi

**Verificato.**

- `shells/document/entry.ts:70`: `new TextEngine(host, {…})` senza
  `extensions`, quindi senza nessun profilo (`engine.ts:551`).
  - Anche `.md` si apre come testo semplice, senza live preview né
    evidenziazione.
  - `.canvas`, `.fubsheet` e `.base` si aprono come JSON/YAML modificabili.
- `openCurrentInNewWindow` (`state/document-windows.ts:85`) non filtra per
  formato. Ci arrivano il menu della tab (`panels/document.ts:1421-1423`) e il
  quick switcher (`desktop-shell.ts:768-769`).
- Importa `theme/serie/skin.css` direttamente (`entry.ts:1-2`), quindi i temi
  installati non arrivano nella finestra.
- Dedotto dal codice, non eseguito: i media binari falliscono con
  `windows.open_failed`.

### I19. Il titolo della finestra toglie solo `.md`

**Verificato.**

- `desktop-shell.ts:598`: `.replace(/\.md$/i, "")`.
- `.canvas`, `.fubsheet` e `.base` restano nel titolo.
- Esistono già `pageName` (`rules/mirrored.ts:40`) e `docTitle`
  (`panels/document.ts:1722`), che le tab usano.

## Priorità 2: composition root (Rust)

### I20. Lo storage del vault non è iniettabile

**Verificato, corretto sui canali laterali.**

- Esistono `VaultStorage` (`crates/fub-kernel/src/storage.rs:213`) e
  `Workspace::on(root, registry, storage, machine)` (`workspace.rs:3394`).
- La produzione non li usa:
  - `mount.rs:256` chiama `Workspace::with_machine_settings`, che fissa
    `RootedFsStorage::open` (`workspace.rs:3364-3381`);
  - `Host` non ha `with_storage`;
  - ogni `Workspace::on` in `fub-host` è nei test.
- Su mobile `open_vault` restituisce `Unserved(...SystemStorage)` da una
  guardia esplicita `#[cfg(mobile)]` (`crates/fub-app/src/lib.rs:362-368`).

Canali laterali:

- `MountRegistry::load(&fub_kernel::FsStorage, …)` usa l'`FsStorage` ambientale
  (`crates/fub-host/src/session.rs:1616`, `:3434`, `:3449-3450`).
- Il lock di scrittura dell'automazione usa `std::fs` dentro
  `<vault>/.fub/` (`automation.rs:20-57`).
  - Lo prendono le shell (`fub-app/src/lib.rs:344`, `fub-cli/src/commands.rs:175`,
    `native_host.rs:165`), non l'host.
- Lo stato di sync usa `std::fs`, ma in `config_root/sync`
  (`remote/bundle.rs:20`, `:77`). È configurazione della macchina, non il vault.

### I21. Il watcher non è iniettabile

**Verificato.**

- `WatcherFactory` è `pub(crate)` (`watcher.rs:77`), il modulo è privato
  (`lib.rs:115`) e la ri-esportazione è `#[cfg(test)]` (`lib.rs:118-119`).
- `Host::with_watcher` è `#[cfg(test)] pub(crate)` (`session.rs:1182-1186`),
  mentre `with_os_trash_backend` è pubblico (`:1104`).
- Le uniche scelte pubbliche sono Notify o nessun watcher (`:1079-1084`,
  `:1176-1180`).

### I22. La rete non è iniettabile

**Verificato.**

- Esistono `HostNetwork` (`crates/fub-abi/src/traits.rs:1182`) e
  `Workspace::set_network` (`workspace.rs:4313`).
- Ma:
  - `mount.rs:268-269` fissa `UreqNetwork::new()`;
  - non esiste `Host::with_network`;
  - `viewer_save` crea `UreqNetwork` direttamente
    (`crates/fub-app/src/lib.rs:598`);
  - la sync costruisce un proprio `ureq::Agent` (`remote/mod.rs:881-898`), fuori
    da `HostNetwork`.

### I23. Il kernel legge l'orologio di sistema senza iniezione

**Verificato.**

- `crate::time::now_unix()` e `now_unix_millis()` sono `SystemTime::now()`
  (`crates/fub-kernel/src/time.rs:27`, `:39`).
- Anche l'implementazione `HostEnv` del kernel vi delega (`host/kernel.rs:368-369`,
  `host/read.rs:177-178`).
- Punti di uso:
  - journal: `journal.rs:506`, `:648`;
  - cestino: `vault.rs:1166`, `:1225`, `os_trash.rs:97`;
  - indici: `index/core.rs:557`, `:853`;
  - storage: `storage.rs:536`;
  - workspace: `workspace.rs:6107`, `:12075`;
  - `snapshot.rs:1422`.

Un orologio finto del testkit non può quindi guidare la ritenzione del journal
o i nomi nel cestino.

### I24. I formati built-in sono una lista fissa, e un conflitto fa fallire l'apertura

**Verificato.**

- `mount.rs:225-236` registra Markdown, Canvas e Base; `:237-246` registra
  `.fubsheet` come sola sorgente.
- In `crates/fub-host/Cargo.toml:16-19` i quattro crate di formato non sono
  opzionali.
- I formati esterni, via `with_format_source` (`session.rs:1350`) o plugin WASM
  installati (`fub-wasm-host/src/managed.rs:1107`), si registrano dopo.
- `FormatRegistry::register` (`registry.rs:66-83`) segnala il conflitto
  sull'estensione (testo a `mount.rs:232`, `:250`).

Un plugin per `.canvas` fa quindi fallire l'apertura dell'intero vault, non solo
il plugin. I test esistenti lo fissano: `legacy_tests/mounting.rs:958-980`,
`legacy_tests/format_source.rs:104`.

### I25. L'adapter dello sheet vive nell'host

**Verificato.**

- `SheetGridProvider` (`crates/fub-host/src/sheet.rs:90`, impl `:113`) e
  `SheetIndex` (`sheet/index.rs:28`, impl `:30`) sono montati in
  `mount.rs:305-323`.
- `crates/fub-format-sheet` contiene solo `lib.rs`, `formula.rs` e `session*`,
  e nessun `FormatProvider`.

### I26. Il ciclo di mount delle feature contiene casi speciali per id

**Verificato, corretto.**

- In `mount.rs` ci sono sette rami `if feature.id == …`: `SEARCH_ID` (`:334`),
  `VERSIONING_ID` (`:342`), `BASE_ID` (`:355`), `BLOCKS_ID` (`:359`),
  `TEMPLATE_ID` (`:394`), `COMMANDS_SERVICE` (`:404`) e `TRASH_ID` (`:407`).
- Correzione: `OfficialFeature` (`crates/fub-features/src/inventory.rs:129-152`)
  ha già `view` e `commands` dichiarativi, consumati dal ramo generico
  (`mount.rs:369-381`).
- Mancano invece campi per impostazioni, servizi forniti e richiesti, indici,
  ricerca e hook.

### I27. Template dipende da Properties senza dichiararlo

**Verificato, corretto.**

- `template.rs:99`: `PROP_SET = "note.property.set"`.
- La feature Cargo `template` (`fub-features/Cargo.toml:44`) non include
  `properties`, e `mount.rs` dichiara `.providing`/`.requiring` solo per
  commands e trash.
- Correzione: l'errore è ignorato con `let _ =` solo in `link_daily_property`
  (`template.rs:1009`), dove è documentato come best-effort (`:995-999`).
- `insert_template` (`:1671-1682`) raccoglie invece gli errori e restituisce un
  avviso di esito parziale.

### I28. `before_write_hook` ha un solo slot ed è solo nativo

**Verificato.**

- `commit_before_write_hook` (`crates/fub-kernel/src/workspace/registration.rs:413-428`)
  rifiuta una seconda registrazione.
- La registrazione passa da `Registrar::set_before_write_hook`
  (`crates/fub-host/src/registry.rs:257`).
- Non esiste nel WIT, e l'unico utente è il versioning (`mount.rs:570`).

Un plugin di backup o versioning di terze parti non può agganciarsi.

### I29. I comandi intercettati dall'host non sono raggiungibili dai plugin

**Riprodotto.**

- `Host::invoke_user_command` (`crates/fub-host/src/session.rs:3730-3799`)
  intercetta per stringa, prima del registro:
  - `vault.snapshot.*` (`:3738`);
  - `mount.add/remove/list` (`:3746`);
  - `trash.os` (`:3750`);
  - `folder.create` (`:3754`).
- `Host::commands()` (`:3406-3425`) li elenca e nasconde eventuali omonimi nel
  registro.
- Dai plugin nativi `run_command` passa per `JobHost::run_command`
  (`jobs.rs:1326-1352`) o `KernelHost::run_command` (`host/kernel.rs:436-442`)
  fino a `command_owner` (`providers.rs:375-378`).

Sonda: un bundle nativo montato con `Host::mount_bundle` e con
`fub:run-command` concesso.

- Riceve `UnknownCommand("folder.create")`, e lo stesso per `mount.list`,
  `trash.os` e `vault.snapshot.create`.
- Il controllo `note.create` raggiunge il registro.
- Lo stesso `folder.create` via `invoke_user_command` riesce.
- CLI e app li raggiungono.

Per i plugin WASM il limite è più ampio: `host-commands` non è servito
(`FAMILIES_SERVED`, `crates/fub-wasm-host/src/component.rs:85-91`). Un
componente che lo importa è rifiutato al caricamento con `UnservedFamilies`
(`:223-234`), quindi nessun plugin WASM può invocare comandi.

### I30. Il kernel conosce il formato Base

**Verificato.**

- `crates/fub-kernel/src/workspace.rs:12764`, in `section_of` (`:12756`):
  `model.id.0.ends_with(".base") && custom_kind == "base"`.
- È l'unico letterale di estensione nel codice non di test del kernel.

**Direzione.** Sezioni o ancore nominate dichiarate dal provider.

## Priorità 2: parità nativo/WASM

### I31. Alcuni export del `plugin-world` sono ignorati in silenzio

**Verificato leggendo il codice, non eseguito; confidenza alta.**

- `plugin-world` (`crates/fub-abi/wit/fub/abi.wit:4382-4424`) esporta `syntax`,
  `renderer`, `service`, `importer` ed `exporter`.
- `fub-wasm-host` non ha adapter per nessuno dei cinque:
  - la registrazione (`component.rs:1262-1297`) copre grid, command, view,
    index ed event-handler;
  - format e format-links passano da `WasmFormatProvider`.
- Il percorso di caricamento non rifiuta questi export:
  - `unsupported_versioned_export` (`:146-150`, applicato a `:238-253`)
    controlla solo la versione di format, format-links, view, index, grid ed
    event-handler;
  - `instantiate_pre` ignora gli export.

Un componente che esporta `syntax` o `renderer` si carica e si monta senza
errori né diagnostica. Anche un export `command` con versione incompatibile
viene scartato in silenzio (`.ok()`, e command manca dal controllo di versione).
Nessun esempio e nessun test copre il caso.

## Priorità 3: la shell ha un'interfaccia implicita (frontend)

Tutti i path di questa sezione sono relativi ad `apps/client/src/`.

### I32. Le capability di piattaforma sono dichiarate ma mai interrogate

**Verificato.**

- `supports()` (`platform/capabilities.ts:50`) non ha chiamanti.
- `DESKTOP_SHELL` e `MOBILE_SHELL` vengono letti solo per `.id`
  (`shells/desktop/bootstrap.ts:4`, `shells/mobile/bootstrap.ts:46`).
- La shell quasi non si adatta: un solo controllo su `clientShell`
  (`desktop-shell.ts:113`), più il CSS di `shells/mobile/mobile.css`.

### I33. Mobile monta la cornice desktop

**Verificato.**

- `entrypoints/mobile.ts:15` importa tutto `desktop-shell.ts`.
- `mountTitlebar` (`desktop-shell.ts:693`) non ha guardia, `mobile.html:78-82`
  contiene `#win-min`/`#win-max`/`#win-close` (cablati in `ui/titlebar.ts:63-74`),
  e niente li nasconde su mobile.
- I divisori (`desktop-shell.ts:260-338`, montati a `:493-494`) sono nascosti
  sotto 960px (`theme/structure.css:828-831`). Da 960px in su (tablet,
  orizzontale) sono visibili e trascinabili.

### I34. `mobile.html` è rimasto indietro rispetto a `index.html`

**Verificato, corretto.**

- `mobile.html` non ha `#pane-status`. `hostPaneStatus`
  (`panels/document.ts:2039-2044`) esce senza fare nulla.
- Correzione: lo stato di salvataggio compare comunque. `drawSave`
  (`:2448-2460`) ripiega sul `#save-state` del footer `#statusbar`
  (`mobile.html:259`, `:267`).
- Effetto collaterale: l'impostazione `chrome.status.visible` agisce solo su
  `#pane-status` (`structure.css:442`), quindi su mobile non ha effetto.
- Anche i pulsanti attività e notifiche stanno in posti diversi nei due HTML.

### I35. Il multi-finestra è offerto senza controllare la capability

**Verificato.**

- Le voci sono tre:
  - menu della tab (`panels/document.ts:1421-1424`);
  - quick switcher (`panels/quick-switcher.ts:250`, `:421`);
  - `desktop-shell.ts:767-771`.
- Nessuna controlla `multipleWindows`.
- Su mobile la chiamata arriva a `open_document_window`
  (`crates/fub-app/src/document_windows.rs:211-277`), che non ha guardia
  `cfg(mobile)`.
- L'esito a runtime non è stato verificato.

### I36. I menu contestuali si aprono solo con l'evento `contextmenu`

**Verificato.**

- I chiamanti di `showContextMenu` (`ui/menu.ts:48`) ascoltano `contextmenu`:
  - `panels/explorer.ts` (vari punti);
  - `panels/document.ts:1324`;
  - `panels/rail.ts:176`;
  - `state/bookmarks-ui.ts:152`, `:214`;
  - `state/workspaces-ui.ts:120`.
- L'unica alternativa è la tastiera (tasto ContextMenu, Shift+F10).
- `shells/mobile/` non ha pressione lunga. `swipeTarget` (`touch.ts:91`) non è
  collegato.
- Non verificato: se Android WebView emetta `contextmenu` alla pressione lunga.
  iOS WKWebView non lo fa.

### I37. Su mobile non c'è un modo funzionante per aprire un vault

**Verificato, corretto.**

- La prima formulazione diceva che l'apertura scavalcava il grant. Non lo fa:
  il backend respinge `open_vault` su mobile (`crates/fub-app/src/lib.rs:356-370`),
  e `initial_vault` restituisce `None` (`:425-433`).
- `pickFolder()` → `openVaultPath` (`desktop-shell.ts:471-477`, `:1058-1062`)
  quindi fallisce sempre.
- Il vero flusso di grant non è collegato:
  - `entrypoints/mobile-main.ts:5` chiama `startupMobile(nativeMobileBridge())`
    senza porte `storage`;
  - per questo `mountMobileStorageStatus` (`shells/mobile/storage-ui.ts:51-56`)
    disabilita i pulsanti e mostra `mobile.storage.not_connected`.

### I38. L'effetto `open_view` non è gestito

**Verificato, corretto.**

- `host/contract.ts:696` lo dichiara. Lo `switch` di `applyIntent`
  (`ui/intents.ts:56-106`) non ha il caso `open_view` né un `default`, quindi
  l'effetto viene scartato in silenzio.
- Anche gli altri consumatori di `CommandEffect` lo ignorano.
- Lo produce solo la traduzione WASM (`crates/fub-wasm-host/src/translate.rs:714`).
  `crates/fub-features/src/dashboard.rs:7-10` lo riconosce esplicitamente.
- Correzione: una vista `main` si apre comunque da segnalibri, workspace e
  layout persistito (`openViewIn`, `state/layout.ts:326`).
- Però `primaryViews()` (`ui/views.ts:104`) non ha chiamanti fuori dai test,
  quindi nessuna interfaccia generica elenca le viste principali.

### I39. Il grafo ha un posto privilegiato nella shell

**Verificato.**

- Ha un pulsante `#show-graph` nel rail (`panels/rail.ts:222-229`, `:43`).
- Ha un comando `shell.graph` (`panels/graph.ts:99-105`) e una voce nel menu
  dell'app (`ui/app-menu.ts:82`).
- La toolbar (`panels/graph.ts:600-676`) cabla le azioni del provider: `seed`,
  `depth`, `direction`, `group_by`, `filter` (con `show_orphans` e
  `show_attachments`) e `refresh`. Corrispondono alle costanti di
  `crates/fub-features/src/graph.rs:111-143`.
- Sono cablati anche `GRAPH_NS` e `GRAPH_VIEW` (`panels/graph.ts:53`, `:61`).

### I40. Segnalibri e workspace scavalcano `panel-host`

**Verificato.**

- `state/bookmarks-ui.ts:37-48` e `state/workspaces-ui.ts:53-64` aggiungono
  sezioni direttamente in `#sidebar`, senza `registerPanel`.
- Si iscrivono agli eventi da soli (`bookmarks-ui.ts:317-321`,
  `workspaces-ui.ts:206`): è lo schema che l'intestazione di
  `ui/panel-host.ts:1-20` dice di evitare.
- La visibilità è un flag privato (`bookmarks-ui.ts:295-300`).

### I41. Tasti e azioni contestuali fuori dal registro dei comandi

**Verificato.**

- In `panels/explorer.ts:451-466` F2 e Canc sono gestori locali.
- Le voci del menu contestuale sono closure con un suggerimento testuale
  (`:629-636`, `:640-656`), e per rinomina e cestino non esiste un comando.
- `panels/document.ts:1337-1349` gestisce Alt+Shift+Frecce localmente.
- `shell.tab.move.left/right` esistono come comandi
  (`state/shell-commands.ts:115-132`) con binding nullo
  (`ui/shell-keys.generated.ts:38-39`): il tasto aggira il registro e il suo
  rilevamento dei conflitti.
- Lo spostamento in un altro pannello non ha un comando.

### I42. La slash palette usa un elenco fisso di comandi

**Verificato, corretto.**

- `state/slash.ts:8-12` ha l'allowlist `p05Commands`, e `selection.wikilink` ha
  un caso a parte (`:16`, `:30`).
- L'allowlist salta il controllo dei parametri obbligatori (`:38`).
- Correzione: un plugin può comparire comunque, tramite un'euristica sui nomi
  dei parametri (`find`, `text`, `selection`, `at`, a `:17-19`).
- Non c'è un flag dichiarato su `CommandSpec`.

### I43. Nessuna porta per gli appunti

**Verificato.** `navigator.clipboard.writeText` è chiamato direttamente in:

- `panels/search.ts:285`, `:289`;
- `panels/document.ts:406`, `:1433`;
- `ui/markdown.ts:90`;
- `ui/intents.ts:117`, `:135`;
- `editors/media/print-view.ts:97`;
- `editors/base/surface.ts:554`.

`platform/` contiene solo `capabilities.ts`.

### I44. Due sistemi di conferma

**Verificato.**

- `host/dialog.ts:24-31` usa il dialogo del plugin Tauri. Lo chiamano trash,
  document, settings e onboarding.
- `ui/dialogs.ts:130` (`confirmInShell`, modale nel DOM) è usato da
  `state/shell-commands.ts:295`, dai segnalibri e dai workspace.

### I45. `localStorage` per stato di vista della macchina, con doppia scrittura

**Verificato, corretto.**

- Le preferenze della barra laterale e dell'inspector
  (`desktop-shell.ts:163-166`, `:208`) e il rail (`panels/rail.ts:85-98`) stanno
  in `localStorage`.
- Correzione: nessun commento dice che questi siano stati migrati.
- La motivazione della migrazione (`host/ipc.ts:409-416`, `state/store.ts:180-191`)
  però copre esattamente questo tipo di stato.
- L'ordine del rail è scritto due volte, in `localStorage` e nell'impostazione
  `chrome.rail.order` (`rail.ts:151-153`). All'avvio `applyRailMachineSettings`
  (`rail.ts:80`) sovrascrive la copia locale, quindi da `localStorage` resta
  solo `hidden`.

### I46. Le icone sono un insieme chiuso, e il nodo `icon` non disegna nulla

**Verificato.**

- `ui/icons.ts:28` definisce `SVG` come mappa chiusa, e `ALIASES` sta a `:82`.
  Non esiste un'API di registrazione.
- I nomi sconosciuti ricadono su icone generiche (`ui/views.ts:703`) o su
  `outline` (`panels/rail.ts:338`).
- Il nodo `UiNode` `{node:"icon"}` (`contract.ts:304`) diventa uno `<span
  class="ui-icon">` vuoto (`ui/node.ts:819-827`): non chiama `icon()` e non c'è
  CSS per `.ui-icon`.

### I47. Locale `"it"` cablata invece di `CORE_DEFAULT_LOCALE`

**Verificato.**

- `CORE_DEFAULT_LOCALE` è definita in `crates/fub-host/src/settings.rs:934`.
- Il letterale `"it"` compare invece in `crates/fub-host/src/mount.rs:399`,
  `publish/commands.rs:83`, `:381` e `remote/bundle.rs:111`, `:173`.

## Seconda ricognizione: dati dell'utente

### I48. Altri comandi modificano byte grezzi senza guardia di formato

**Riprodotto.** Allarga I01 ad altri comandi.

La protezione comune è il reparse del kernel prima della scrittura
(`crates/fub-kernel/src/workspace.rs:5967`):

- sul `.canvas` ferma il JSON invalido, con un errore generico;
- sul `.base` non protegge niente, perché `BaseProvider::parse` non fallisce mai.

**`note.merge`** (`crates/fub-features/src/template.rs:2007-2200`: lettura
`:2036`, `format!` `:2119`, `apply_edit` `:2132`, `trash_document` `:2141`):

- Con `from:[b.md] into:tab.base`, il `.base` diventa
  `views:…\n\n\n# B\n\n…`, il modello legge `views: []`, e `b.md` finisce nel
  cestino.
- Con `from:[board.canvas, tab.base] into:b.md`, la seconda ricognizione
  riporta che JSON e YAML grezzi vengono incollati nella nota e i due file
  spostati nel cestino.

**`note.insert_datetime`** (`template.rs:1524-1576`) su un `.base` accoda la
data al YAML e il modello legge `views: []`.

**`note.insert_template`** (`template.rs:1625-1730`) su un `.base` inserisce il
corpo e, tramite `note.property.set`, un frontmatter.

**`vault.replace`** (`crates/fub-features/src/commands.rs:1310-1420`) agisce su
tutti i documenti (`list_documents(None)`, `:1336`) confrontando i byte del
file serializzato (`:2333-2360`):

- `nodes→nodi` svuota il canvas; il JSON resta valido e la chiave finisce in
  `extra`.
- `name→nome` in un `.base` dà `views: []`.
- Una sostituzione che tocca le sequenze di escape JSON (`\n`) altera il testo.
- Se la modifica di un canvas fallisce, la notifica la conta comunque.

**`note.rename` e `trash.restore` con un nome senza estensione** usano
`with_extension` (`commands.rs:1436-1443`, `:1575`, `:1662`), che aggiunge `.md`:

- `note.rename {"doc":"board.canvas","to":"Lavagna"}` produce
  `«board.canvas» rinominata in «Lavagna.md»`, e il JSON diventa una nota
  Markdown.
- La rinomina inline dell'explorer conserva l'estensione
  (`apps/client/src/panels/explorer.ts:1222-1227`). Palette, CLI e automazioni
  no.

**Direzione.** La stessa guardia di capability di I01, con un errore tipizzato.
Un nome senza estensione eredita quella del documento. Un `.base` invalido
viene rifiutato al momento della scrittura.

### I49. Canvas e grid lanciano da `syncDoc` su un sorgente invalido: la superficie si disallinea e le modifiche si perdono

**Riprodotto** (sonda Vitest sulla shell reale).

- `editors/canvas/engine.ts:206` (`parseCanvas`) e `editors/grid/engine.ts:559`
  (`parseWorkbook`) lanciano un'eccezione dentro `syncDoc`.
- Il percorso: `DocumentSession.#applyCleanReload`
  (`state/document-session.ts:469`) → `#fanOut` (`:359-364`, ciclo senza
  `try`) → `applySurfaceUpdate` (`panels/document.ts:1904-1908`).
- `read_document` restituisce il sorgente senza parse
  (`crates/fub-host/src/session.rs:3118-3128`). Un file rotto da un'altra app, da
  una sync o da un merge arriva quindi fino alla superficie.

Esito dopo una scrittura esterna invalida su un `.canvas` aperto:

- la sessione contiene `{rotto`;
- la superficie mostra ancora i nodi vecchi, e nessuna superficie d'errore;
- aggiungendo un nodo, questo compare a schermo, ma la sessione lo rifiuta e il
  riallineamento rilancia l'eccezione (`SyntaxError: canvas JSON non valido`,
  `dirty false`);
- l'utente crede di modificare, ma non viene salvato niente.

Con un `.fubsheet` succede lo stesso. Le superfici che seguono nel `#fanOut` non
vengono sincronizzate.

**Direzione.** `syncDoc` non deve mai lanciare, ma passare a uno stato
d'errore. `#fanOut` deve isolare ogni superficie.

### I50. Il writer lock si può aggirare, rompere o lasciare appeso

**Riprodotto** (sonda Rust e CLI).

- Il lock è un `flock` su `<vault>/.fub/automation-writer.lock`
  (`crates/fub-host/src/automation.rs:20-57`), con la regola "il file non si
  rimuove mai".
- `open_demo` e `reset_demo` (`crates/fub-app/src/support.rs:40-51`, `:84-97`,
  che portano a `crates/fub-host/src/support.rs:188-195`, `:247-277`) aprono
  senza lock.
  - `reset_demo` esegue `remove_dir_all` sulla radice.
  - `close_demo` (`:62-81`) non rilascia la voce in `WriterLocks`.
- Dopo `reset_demo` un secondo scrittore ottiene il lock, mentre l'app crede di
  averlo ancora (l'inode è cambiato).
- `vault.snapshot.apply` sostituisce `.fub`, e con lui l'inode del lock: prima
  dell'apply un secondo scrittore riceve `WouldBlock`, dopo lo ottiene.

Il writer lock non è documentato. Conseguenza: due scrittori (app più CLI o
automazione) possono modificare lo stesso vault. Completa I20: il lock è preso
dalle shell, non dall'host.

**Direzione.** Prendere il lock dentro l'apertura dell'host, tenere il file
fuori da ciò che snapshot e reset sostituiscono, e rilasciarlo alla chiusura.

### I51. Lo stato di sync è condiviso da tutti i vault della macchina

**Verificato con sonda; latente per I59.**

- `JobState::open` (`crates/fub-host/src/remote/bundle.rs:1298-1318`) usa un solo
  abbinamento del vault, e un solo outbox, cursore e archivio conflitti, sotto
  `config_root/sync` (`remote/mod.rs:780-811`).
- La sonda: il passaggio di sync del vault B ha accettato l'abbinamento del
  vault A, e si è fermato solo alla rete.
- Modalità e credenziali arrivano solo da variabili d'ambiente
  (`bundle.rs:55-62`, `:1339-1390`; `remote/mod.rs:403-418`). L'app desktop non
  ha modo di fornirle.

Corretto I59, due vault condividerebbero identità remota e outbox.

**Direzione.** Stato di sync per vault, e credenziali in impostazioni o in un
archivio di segreti.

### I52. La cattura scrive la nota prima delle proprietà: non è atomica e un nuovo tentativo duplica

**Riprodotto dalla seconda ricognizione.**

- `crates/fub-cli/src/capture.rs:245-252` accoda il testo, poi
  `apply_properties` (`:373-398`) chiama `note.property.set`. Le copie in
  `native_host.rs` e `mobile.rs` seguono lo stesso schema.
- Se le proprietà falliscono (feature spenta, valore invalido), il blocco resta
  e il comando riporta un errore. Ripetendo, il blocco viene accodato due volte.

**Direzione.** Validare prima, o applicare testo e proprietà in un'unica
operazione host (vedi I09).

### I53. Il server di sync disattiva la copia di conflitto per note utente con `settings/` nel percorso

**Verificato leggendo il codice; server non eseguito.**

- `crates/fub-services/src/sync/causality.rs:174`:
  `lower.ends_with(".settings.json") || lower.contains("settings/")` classifica
  come `Settings`.
- `needs_conflict_copy` è falso solo per `Settings` (`:206-208`).
- Il client invia il percorso in chiaro come `doc_id`
  (`crates/fub-host/src/remote/bundle.rs:868`) ed esclude `.fub/`
  (`remote/sync.rs:611-635`). Le impostazioni vere quindi non viaggiano mai: la
  regola colpisce solo file dell'utente, come `Casa/Router settings/wifi.md`.
  - Vale l'ultima scrittura, senza nessun record di conflitto.
  - La versione perdente resta nella catena delle versioni, ma l'utente non
    viene avvisato.
- Le stesse righe classificano `.canvas.json` e `.sheet.json`, estensioni che
  non esistono (quelle vere sono `.canvas` e `.fubsheet`). Ricadono in `Other`,
  quindi cambia solo il testo del motivo.
- L'unico test usa un inventato `settings/app.settings.json`
  (`tests/sync_invariants.rs:466-473`).

### I54. Le versioni oltre 90 giorni si cancellano senza che sia documentato, e i backup non ruotano

**Verificato leggendo il codice.**

- `crates/fub-features/src/versioning.rs:365-373` definisce le fasce: tutto per
  un giorno, orario per 7 giorni, giornaliero per 90.
- `:1107-1130`: oltre l'ultima fascia `continue; // … non si conserva`. Resta
  solo la versione più recente.
- Non è configurabile e nessuna pagina di prodotto o di riferimento lo cita,
  mentre la ritenzione del journal è un'impostazione
  (`crates/fub-kernel/src/journal.rs:193`).
- `crates/fub-features/src/backup.rs` non ha rotazione: i backup crescono dentro
  il vault.

## Seconda ricognizione: comportamenti sbagliati

### I55. Un wikilink con estensione non si risolve mai, e gli omonimi di formati diversi si risolvono in ordine alfabetico

**Riprodotto.**

- `EntryNames::insert_entry` (`crates/fub-kernel/src/index/core.rs:362-371`)
  mette in `by_name` solo le voci che non sono documenti.
- `Graph::resolve_key` (`graph.rs:551-590`) cerca una chiave senza `/` in
  `name_index`, indicizzato per `page_name()` cioè senza estensione (`:666`).
- Gli omonimi sono ordinati per `(depth, id)` (`graph.rs:869-898`).

Prove:

- `query --resolve '[[board.canvas]]'` → `resolved: null`, e lo stesso per
  `[[b.md]]`. Invece `[[board]]` → `board.canvas`.
- Con `Progetto.{md,canvas,base}`, `[[Progetto]]` → `Progetto.base`.
- `note.rename board.canvas → Lavagna` riscrive `[[board]]` in `[[Lavagna]]` ma
  lascia rotto `[[board.canvas]]`.
- Fub stesso scrive link che non si risolvono:
  - l'azione `convert_to_link` dei backlink, con omonimi di formati diversi,
    scrive `[[Progetto.md|Progetto]]` (`crates/fub-features/src/backlinks.rs:335-359`,
    ripiego sul percorso completo), che si risolve a `null`;
  - `wikiReference` nella shell (`apps/client/src/panels/document.ts:238-247`)
    usa lo stesso ripiego.

Impatto:

- Obsidian scrive i link ai canvas come `[[X.canvas]]`: in un vault Obsidian
  sono link morti per clic, backlink, grafo e rinomina.
- La pagina `docs/product/search-links-and-graph.md:63-75` promette che il
  riferimento scritto "manda davvero alla nota".

I test del grafo coprono l'estensione esplicita solo con una `/`.

### I56. `reveal` scorre il pannello a fuoco anche quando il documento bersaglio è un altro

**Riprodotto** (sonda Vitest).

- `apps/client/src/ui/intents.ts:64-69`:
  `if (!isOpen(doc)) await openDocument(doc); revealByteOffset(intent.span.start);`.
- `isOpen` è vero per qualsiasi tab, anche in background e in qualsiasi
  pannello (`panels/document.ts:2365`, `state/layout.ts:226-229`).
- `revealByteOffset` agisce sul pannello a fuoco (`panels/document.ts:2642-2643`).

Prove:

- Due pannelli, B a fuoco, `reveal` su A aperto nell'altro: il cursore di B si
  sposta all'offset 20, calcolato su A.
- Un pannello con tab `[Benvenuto, Riunione]`, `reveal` su Benvenuto: si sposta
  il cursore di Riunione.

Possono puntare a un altro documento:

- la sorgente delle proprietà (`crates/fub-features/src/properties.rs:387-400`);
- `CommandEffect::Reveal` da `commands.rs:1295`, `:2257` e da `template.rs:1566`,
  `:1719`, `:1919`;
- i plugin WASM (`translate.rs:704`).

L'outline invece rivela solo il documento attivo. **Direzione:** un
`reveal(doc, span)` che sceglie o attiva il pannello giusto. È legato a I12.

### I57. Se un documento che non è un canvas fallisce il mount, si blocca l'intero ciclo di render

**Riprodotto** (sonda Vitest). Estende I15.

- Solo il canvas ripiega sulla superficie d'errore:
  - `panels/document.ts:1780` (`tab.doc.toLowerCase().endsWith(".canvas")`);
  - `:1807` e `:1829` (`source.formatId !== "canvas"` → `throw`).
- `render()` (`:872-891`) esegue `await show(...)` su ogni pannello senza
  isolamento.

Prove:

- **`.fubsheet` corrotto:** `openDocument` fallisce e il pannello resta vuoto,
  senza superficie d'errore.
- **`.canvas` corrotto:** compare la superficie d'errore.
- **Due pannelli:** con il primo su un `.fubsheet` rotto, aprire una nota nel
  secondo lascia a video il documento vecchio, e `state.currentDoc` resta
  sbagliato. I comandi agiscono quindi sulla nota sbagliata finché la tab non
  viene chiusa.

**Direzione.** Una politica d'errore generica (sempre la superficie d'errore) e
render isolato per pannello.

### I58. La modalità è una stringa unica per pannello, condivisa fra famiglie di superfici

**Riprodotto** (sonda Vitest).

- `selectedMode` (`panels/document.ts:1938-1942`) cerca `paneState.mode` fra le
  modalità della superficie. Canvas dichiara `canvas|source`
  (`editors/canvas/surface.ts:89-92`); Markdown `source|live_preview|reading`.
- Con un `.md` in Source, aprire un `.canvas` nello stesso pannello lo mostra
  come JSON grezzo (`surfaceMode source`).
- Dopo `setMode("canvas")`, una nota `.md` si apre in Source invece che nella
  modalità preferita.

Contraddice `docs/product/editor-and-preview.md:9-23`, dove ogni superficie
dichiara le proprie modalità. Legato a I13.

### I59. Sync e publish non ottengono mai `fub:network`

**Riprodotto** (sonda sull'host reale e server `fub-services` locale).

- I manifest sono `PluginManifest::core("fub.sync", …)`
  (`crates/fub-host/src/remote/bundle.rs:110-112`) e `("fub.publish", …)`
  (`publish/commands.rs:82`, `:380`).
- `PluginPermissions::core()` (`crates/fub-abi/src/traits.rs:3950-3970`) non
  include `fub:network`.
- I job chiedono la rete passando per la Guard.

Prove:

- `publish.pass` → `PermissionDenied(... fub.publish non ha dichiarato il
  permesso fub:network)`.
- `sync.pass` → `PermissionDenied("sync network denied")`.
- CLI `publish dry-run` e `publish commit` negati (exit 4). `publish status`
  raggiunge il server perché usa un client proprio.

Entrambi i bundle sono montati nella build predefinita (`http-client` è una
feature di default, `mount.rs:413-421`), quindi comandi e viste compaiono ma non
possono riuscire. I test usano `MemoryHost`, che non passa dalla Guard.

La documentazione non è coerente: `docs/product/overview.md:25-38` dice che
nell'app non c'è un client HTTP.

### I60. `sync status`, `sync once` e `sync watch` della CLI falliscono sempre

**Riprodotto.**

- `crates/fub-cli/src/remote.rs:14-20` (`vault_root`) restituisce il percorso
  assoluto, e `:143` lo passa come `vault_id`.
- `valid_vault_id` (`crates/fub-host/src/remote/mod.rs:806-811`) accetta solo
  caratteri alfanumerici, `-` e `_`.
- Gli esiti: `invalid sync vault pairing` e `sync vault pairing unavailable`.

### I61. Spegnere `versioning.enabled` rende irraggiungibile la storia, contro la descrizione dell'impostazione

**Riprodotto.**

- La descrizione dice: "Spento, la storia già registrata resta leggibile"
  (`crates/fub-host/src/settings.rs:1418-1432`).
- `register_versioning` (`crates/fub-host/src/mount.rs:546-593`) però non monta
  né la vista né i comandi se l'impostazione non è `Toggle(true)`.
- Prova CLI: dopo `config --set versioning.enabled=false`, la vista `history` e
  `version.restore` spariscono da `views --list` e `command --list`, mentre i
  dati restano in `.fub/plugins/fub.versioning`.
- Il cambio agisce solo alla riapertura: `setting_requires_reopen`
  (`settings.rs:650-652`) riconosce solo le chiavi `chrome.*`, e l'interfaccia
  non lo segnala.

### I62. `fub-cli create NOME` senza estensione crea una nota vuota e poi fallisce

**Riprodotto.**

- `crates/fub-cli/src/local.rs:308-345` calcola `id = foo`, invoca
  `note.create` (che aggiunge `.md`), poi legge e scrive `foo`.
- `create foo --text hello` → `not_found …/foo`, exit 1. Resta `foo.md` vuoto e
  il testo è perso.
- È il danno visibile delle due fonti di verità di I03. `capture.rs` ha già un
  helper `created_doc(&outcome)`.

### I63. Il filtro "mostra allegati" del grafo non fa niente

**Riprodotto.**

- Il grafo prende gli archi solo da `IndexQuery::Neighbors`
  (`crates/fub-features/src/graph.rs:477-523`).
- Il kernel risponde con i soli documenti analizzati
  (`crates/fub-kernel/src/index/core.rs:1364-1378`, `graph.rs:505-539`).
- Una nota che incorpora `pic.png`, `clip.mov` e `doc.docx` produce gli stessi
  archi prima e dopo `filter show_attachments`, e `query --backlinks pic.png`
  restituisce vuoto.
- `is_note` (`graph.rs:560-587`, lista di estensioni) è quindi codice morto
  contro l'host reale.
- L'unico test (`:923-936`) costruisce l'arco a mano.
- La pagina `docs/product/search-links-and-graph.md:126` descrive il filtro.

### I64. I segnaposto i18n non corrispondono al catalogo: l'utente vede `{nome}` e `{motivo}`

**Riprodotto** (sonda Vitest).

- `apps/client/src/panels/explorer.ts:1242` passa `{ name, reason }`, ma il
  modello è `"«{nome}» non si può usare: {motivo}"` (`i18n/strings.ts:349`).
- `ui/views.ts:370-373` passa `reason` a un modello che usa `{motivo}`
  (`strings.ts:1038`).
- `expand()` lascia intatti i nomi sconosciuti, e `t()` accetta un
  `Record<string, …>` non tipizzato.
- Il test confronta i segnaposto fra lingue, mai con i punti di chiamata.

Una rinomina invalida nell'explorer mostra quindi un messaggio senza il nome del
file e senza il motivo.

### I65. `String(error)` sugli errori del backend mostra `[object Object]`

**Riprodotto** (sonda Vitest).

Il backend rifiuta con `{kind, message}`, e `host/errors.ts:10-14` offre
`errorText()` proprio per questo. Non lo usano:

- `apps/client/src/ui/notify.ts:346`: tutte le azioni dei toast, per esempio
  "Ricrea la nota";
- `panels/rail.ts:159`;
- `state/document-windows.ts:29`, `:122`, `:214`;
- `editors/media/recorder-surface.ts:45-100`;
- `shells/mobile/opened.ts:157`, `:170-171`;
- `shells/mobile/storage-ui.ts:91`, `:114`, `:123`;
- `shells/mobile/bootstrap.ts:62`, `:71`, `:129`.

Prova: un'azione di toast rifiutata con
`{kind:"already_exists", message:"Il file esiste già"}` notifica
`"[object Object]"`. Inoltre `document-windows.ts:99-229` lancia 16
`new Error(...)` in italiano, mostrati come `"Error: …"` in ogni lingua.

### I66. I comandi host con un solo effetto custom girano in silenzio dalla palette

**Verificato, con sonda su `applyIntent`.**

- `mount.add/remove/list` (`crates/fub-host/src/session.rs:3500-3509`) e
  `trash.os` (`:285-297`) restituiscono `CommandOutcome::done()` senza `notify`,
  con un effetto `Custom` (`fub.mount.routes`, `fub.trash.os`).
- La palette li elenca, poi `deliverOutcome` (`ui/palette.ts:1185-1187`) notifica
  solo se c'è `outcome.notify`.
- `applyIntent` gestisce tre soli namespace (`ui/intents.ts:75-96`) e manda gli
  altri a `console.info`.

Conseguenze:

- `mount.list` dalla palette non mostra niente, anche se
  `docs/product/vault-and-files.md:157-160` dice che "restituisce rotte
  tipizzate".
- `trash.os` dalla palette perde l'avviso di ripiego sul cestino interno, che
  legge solo `state/vault.ts:103`.

### I67. `note.random` e il pannello Template ignorano i file `.markdown`

**Riprodotto.**

- `crates/fub-features/src/template.rs:1450` e `:697` filtrano con
  `ends_with(".md")`, mentre il descrittore Markdown dichiara `md` e `markdown`.
- In un vault con solo `nota.markdown` e `Templates/T.markdown`:
  - `note.random` → `Nessuna nota nel vault.`;
  - il pannello Template è vuoto;
  - invece `fub-cli templates --list` li elenca, quindi CLI e pannello non
    concordano.

Estende I05.

### I68. Le statistiche contano la sintassi del sorgente di `.canvas` e `.base`

**Riprodotto.**

- `crates/fub-features/src/stats.rs:231-236` conta su `read_document`.
- Il commento (`:84-88`) giustifica la scelta con un modello parsato "che
  ancora non c'è", ma `read_model` e `DocumentModel.text` esistono già.
- Un canvas con 2 nodi conta 53 parole, mentre il suo `model.text` ne ha 2.
- Su Markdown lo scarto è piccolo e dichiarato.

### I69. Un format provider WASM non viene ritirato né montato finché il vault non si riapre

**Verificato leggendo il codice, non eseguito.**

- Il provider di formato arriva solo dall'istantanea di avvio
  (`crates/fub-wasm-host/src/managed.rs:1089-1124`).
- `reconcile` (`~870-915`) non tocca i formati.
- `FormatRegistry` non ha `unregister` (`crates/fub-host/src/registry.rs:56-225`).
- Il commento di test in `tests/format_crosses.rs:163-166` lo ammette.

Contraddice `docs/architecture/plugin-runtime.md:367-370` e
`docs/project/m5-wasm-runtime.md:174`: un parser disabilitato o revocato
continua ad analizzare i documenti dei vault aperti.

### I70. Nel runtime WASM `wasi:random` restituisce sempre gli stessi otto byte

**Verificato leggendo il codice.**

- `crates/fub-wasm-host/src/component.rs:433-444`: `get-random-bytes`
  restituisce sempre `[0x13, 0x37, 0x5a, 0x7d, 0x91, 0xb4, 0xd6, 0xf8]` e
  ignora la lunghezza richiesta.
- Il commento (`:423-424`) parla di import "chiusi senza aprire WASI".
- Un guest che usa `getrandom` o `uuid` ottiene valori prevedibili senza
  errore, mentre esiste un `random_bytes` vero dell'host (`guest.rs:98-103`).

Differenze di parità collegate:

- WASM dichiara comandi, viste e griglie prima di `activate`
  (`component.rs:1235-1237`), il nativo dopo.
- Delle famiglie `host-*` del WIT ne sono servite solo cinque
  (`FAMILIES_SERVED`), e non è documentato. Si aggiunge a I29.

## Seconda ricognizione: confini e struttura

### I71. Le feature `commands` e `trash` non compilano da sole

**Riprodotto.**

- `cargo check -p fub-features --no-default-features --features commands`
  (oppure `--features trash`, che implica `commands`) fallisce con
  `E0433 serde_yaml_ng`.
- La causa è `crates/fub-features/src/commands.rs:1505`, senza gate.
- `Cargo.toml:57` ha `commands = []`.
- La CI compila solo l'insieme vuoto e `outline` (`.github/workflows/ci.yml:52-54`).

Contraddice la regola "ogni feature è indipendente".

### I72. Dipendenze non dichiarate fra feature

**Base → Properties (riprodotto).**

- Modificare una cella Base chiama `note.property.set/remove`
  (`crates/fub-features/src/base.rs:1009-1013`).
- Con properties spento fallisce con "unknown command".

**Backlinks → Search (verificato leggendo il codice).**

- Le menzioni non collegate usano `QueryPredicate::Text`
  (`backlinks.rs:788-800`), servito solo da search.
- `part()` (`:566-577`) appiattisce il tipo di errore.

Si aggiunge a I27.

### I73. Decisioni prese confrontando il testo dei messaggi d'errore

**Riprodotto per T2 e T3.** Contraddice la regola sugli errori tipizzati.

- **T1:** `crates/fub-cli/src/login.rs:184` controlla
  `message.contains("409") || … "account exists"`. Il server risponde 422, quindi
  il ramo non scatta mai.
- **T2:** `crates/fub-importers/src/archive.rs:176` controlla
  `contains("bomb") || contains("budget")`, e i messaggi interpolano i nomi delle
  voci. Una voce corrotta chiamata `budget.md` interrompe l'intero import invece
  di saltare la sola voce.
- **T3:** `crates/fub-importers/src/connectors.rs:183` controlla
  `to_string().contains("HTTP 404")`, ma il messaggio include il corpo della
  risposta. Un 502 che nel corpo cita "HTTP 404" attiva il ripiego sbagliato.
- **T4, latente:** `fub-services` mappa gli errori di autenticazione a 401/403
  confrontando stringhe esatte (`server.rs:125-128`, `sync/mod.rs:477-480`).

### I74. `JobHost::restore_document` applica regole di capability diverse dalla Guard

**Verificato leggendo il codice.**

- `crates/fub-host/src/jobs.rs:1009-1066` richiede sempre `VaultRead` e filtra
  il cestino per `VaultRead`, anche quando la destinazione `to` è esplicita.
- `Guard::restore_document` (`crates/fub-kernel/src/host/guard.rs:976-993`), con
  `to` esplicita, richiede solo `VaultStructure`.
- La stessa chiamata di un plugin può quindi essere consentita in modo sincrono
  e negata dentro un job.

Contraddice "la policy passa da un solo `Guard`".

### I75. Regole di supporto e ripristino dentro l'adattatore IPC

**Verificato leggendo il codice.**

- `crates/fub-app/src/support.rs:122-167` (`support_export`):
  - ripete `consent.check()`;
  - aggiunge un'esclusione della radice demo che l'host non ha;
  - conserva un controllo su `tmp-fub-support` che non può più scattare
    (l'host usa `NamedTempFile`).
- `:175-194`: l'allowlist dei tre file di `recover_config` vive nell'app, mentre
  `recover_config_file` dell'host (`crates/fub-host/src/support.rs:731+`) accetta
  qualsiasi percorso.

Per ogni altro chiamante (CLI, mobile, test) queste regole non valgono.

### I76. `fub-app` possiede formati su disco non documentati

**Verificato leggendo il codice.**

- File senza documentazione:
  - `catalog-trust.json` e `catalog-feed.json` (`crates/fub-app/src/lib.rs:173-209`);
  - `installed-limited.json` (`:1522-1559`);
  - `mobile-storage.json` (`mobile.rs:351-435`).
- Nessuno compare in `docs/reference/on-disk-layout.md`.
- `catalog_artifact` (`lib.rs:1356-1368`) legge i byte del plugin con `std::fs`,
  seguendo i symlink. L'installazione diretta usa invece cap-std senza symlink
  (`crates/fub-wasm-host/src/installed.rs:449-490`).

### I77. La validazione della cattura mobile è una copia senza il controllo del vault

**Verificato leggendo il codice.** Corregge I09.

- `validate_mobile_capture` (`crates/fub-app/src/mobile.rs:533-610`) copia
  `automation::validate_capture_v1` ma omette `validate_vault_field`
  (`crates/fub-host/src/automation.rs:461`).
- Poi usa `target.vault` (`mobile.rs:700`).

### I78. Le card di testo del canvas non ricevono la sintassi del vault

**Riprodotto sul modello.**

- `crates/fub-format-canvas/src/parse.rs:352-353` e `render.rs:115-128` usano
  `MarkdownProvider::new()` direttamente, fuori dal registro e dal
  `SyntaxRegistry`.
- Lo stesso testo (mermaid, `==hi==`, blocco `base`):
  - in un `.md` produce nodi `diagram`, `highlight` e `base`;
  - in un `.canvas` produce solo un `code_block` `canvas-text`.
- Nella shell `panels/document.ts:352` chiama `renderMarkdown(text)` senza
  `forms`:
  - la matematica resta codice;
  - gli embed base non si montano;
  - mermaid invece si rende perché ignora le forme dichiarate
    (`ui/mermaid.ts:259-261`), e quindi anche l'opzione del vault che lo spegne.

Una regola per un solo formato è una scelta documentata
(`crates/fub-abi/src/custom.rs:83-86`). Manca invece il concetto di grammatica
Markdown incorporata in un altro formato.

### I79. `TextEngine` legge da sé le impostazioni `editor.*`, e le celle della griglia le ereditano

**Riprodotto nel DOM; resa visiva non verificata.**

- `apps/client/src/editors/text/engine.ts:202-205` e `:431-447` applicano
  `editor.vim`, `editor.line-numbers`, `editor.line-wrap` ed `editor.indent` a
  ogni istanza.
- La griglia crea barra delle formule e editor di cella con `createTextEngine`
  (`editors/grid/engine.ts:475-492`), senza possibilità di escluderle.
- Con vim e numeri di riga attivi, formula e cella hanno la gutter dei numeri e
  i binding vim.
- Ogni mount della griglia fa inoltre due IPC `settings()` in più.

### I80. Conoscenza Markdown in moduli generici

**Verificato leggendo il codice.** Distinto da I14 e I17.

- `panels/document.ts:47-50`, `:462`, `:482`, `:2471`: il pannello generico
  invalida la cache risorse del profilo Markdown. Un altro profilo con una cache
  richiederebbe di modificare il pannello.
- `ui/link-preview.ts:31-56`, montato globalmente (`desktop-shell.ts:757`):
  - riconosce i wikilink dal DOM Markdown (`a.wikilink[data-wikilink-*]`);
  - riscrive a mano `data-fub-target`, costante del profilo
    (`livepreview.ts:113`);
  - ri-analizza `page#heading`.
- `editors/text/engine.ts:344-358`, `:761`: il `cursorContext` generico conosce
  `[[` e `frontmatter`. Lo usa solo la slash palette Markdown.
- `ui/markdown.ts:196-200` aggiunge `container` al payload solo per
  `BASE_RENDERER_NS`, perché `CustomRenderer` (`ui/custom.ts:47-51`) non riceve
  il documento contenitore. Un renderer di terze parti quindi non può averlo.

### I81. La selezione pubblicata può essere solo un intervallo di testo

**Verificato leggendo il codice.**

- `paneContext` (`panels/document.ts:2524-2563`) costruisce il `SelectionSet`
  solo da `surface.selections()`, implementato solo dalle superfici testo.
- Un intervallo di celle o un insieme di nodi del canvas non arriva a comandi e
  viste.

È l'inverso di I12.

### I82. `MemoryHost` diverge dal kernel, e il test di parità copre solo Markdown

**Verificato leggendo il codice, più una sonda sul `Workspace` reale.**

In `crates/fub-sdk/src/testing/mod.rs`:

- `format_of` conosce solo md e markdown (`:699-708`);
- `Resolve` è `Unserved` (`:1403-1407`);
- `Neighbors` ignora i `seeds` (`:1331-1364`);
- `Entries` marca tutto come documento;
- `Documents` ignora `matching`;
- `write_document` non esegue il parse (`:783-823`).

Il test di parità (`crates/fub-features/tests/both_hosts_answer_alike.rs:172-175`)
registra solo Markdown. Non risulta nessun test che passi per errore, ma I48,
I55 e I63 non possono essere catturati da un test con `MemoryHost`.

### I83. Gran parte della shell mobile non ha chiamanti in produzione

**Verificato con un conteggio statico degli import.**

- Circa 35 export di `apps/client/src/shells/mobile/` sono raggiunti solo dal
  barrel `index.ts`, da cui si importa solo `MOBILE_SHELL`.
- Morti:
  - `os-actions.ts`;
  - le azioni rapide e gli helper delle tab di `touch.ts`;
  - `submitCaptureViaCommands` (con `note.daily` e `note.from_template` cablati);
  - `mobilePaletteHost` (copia di `desktop-shell.ts:608-627`);
  - `permissions.ts` e parti di `storage.ts`.
- Vivo, dentro questo gruppo di export: `opened.ts:105`
  (`fub://daily` → `note.daily`). Fallisce con `[object Object]` (I65) se la
  feature è spenta.

### I84. `check-host-workspace-boundary.mjs` non viene mai eseguito

**Verificato.** Lo script esiste (aggiunto in `d9591ac7`) e passa sull'albero
attuale. Non lo richiamano però `.github/workflows/`, né il blocco `ci-required`
di `CONTRIBUTING.md`, né `package.json`.

### I85. La shell conosce id posseduti dalle feature

**Verificato leggendo il codice.**

- `apps/client/src/panels/settings.ts:473-479` nasconde `"properties.types"`
  per letterale, e `SettingSpec` non ha un flag "gestita altrove".
- `panels/activity.ts:164-166`, `:305` offre "Salva" per gli artefatti solo ai
  job `import.transfer` ed `export.run`, con `ExportArtifact` rispecchiato a mano
  (`:153-160`) fuori dalle fixture.

### I86. `render_markdown_safe` è codice morto, testato come invariante

**Verificato.**

- `crates/fub-services/src/publish/guard.rs:162` è un secondo renderer
  Markdown→HTML scritto a mano, ri-esportato da `publish/mod.rs:20`.
- Gli unici chiamanti sono `tests/publish_invariants.rs:106` e `:120`.
- Il test di invariante verifica quindi una sanitizzazione che la produzione non
  esegue: il server riceve HTML già proiettato dall'host.

### I87. Gli errori letterali scavalcano i cataloghi

**Verificato con un conteggio.** È un problema sistemico, di bassa gravità.

`crates/fub-abi/src/error.rs:1-40` dice che gli errori portano `Text` per
poter essere localizzati, e la shell mostra `message` così com'è
(`apps/client/src/host/errors.ts`).

Errori letterali e con chiave di catalogo nel codice non di test:

| Crate | Letterali | Con chiave |
|---|---|---|
| fub-host | 315 | 9 |
| fub-app | 56 | 0 |
| fub-kernel | 88 | 0 |
| fub-wasm-host | 31 | 0 |
| fub-features | 29 | 81 |

- I letterali italiani arrivano agli utenti inglesi, e viceversa.
- Ad esempio circa 23 in `crates/fub-host/src/support.rs`.
- Nessuna guardia lo controlla.

### I88. Minori: estensioni, segnaposto e documentazione non allineata

**Verificato.**

- `crates/fub-features/src/trash.rs:333-336` (`display_name`) e
  `template.rs:1195-1198` (`file_name`) tolgono solo `.md`: il `{{title}}` di un
  template inserito in un `.base` diventa `tab.base`. Esiste
  `DocId::page_name()`.
- `apps/client/src/editors/canvas/engine.ts:702`: un nuovo nodo file del canvas
  punta a `"allegati/nuovo.md"`, un segnaposto italiano che ignora
  `files.attachment-folder`.
- Codice morto:
  - `Host::versions/list_versions/read_version`
    (`crates/fub-host/src/session.rs:3866-3905`) hanno solo chiamanti di test;
  - `permission_granted` (`session.rs:1300`) non ha chiamanti.
- Documentazione non allineata:
  - `settings.rs` si contraddice su chi legge `versioning.enabled`: `:19` dice
    la feature, `:1385` dice l'host;
  - `docs/project/m5-wasm-runtime.md` e `status.md:66` chiamano "differiti"
    Index ed EventHandler inbound, che sono implementati;
  - `README.md:44` cita `abi@0.1.2`, mentre il WIT è `0.2.0`;
  - `docs/architecture/plugin-runtime.md:367` parla ancora di "cinque
    operazioni";
  - `docs/architecture/components-and-boundaries.md` non elenca
    `fub-format-canvas` e `fub-format-base`, né la dipendenza del canvas da
    Markdown.

## Terza ricognizione

### I89. I workspace salvati non seguono le rinomine: la nota rinominata sparisce al ripristino

**Verificato.**

- `apps/client/src/state/workspaces.ts` salva per vault layout, schede e
  cronologia di ogni pannello, con i `DocId` di allora (`persist`, `:264`).
- Nessun gestore di `document_renamed` in `workspaces.ts` né in
  `workspaces-ui.ts`. Lo gestiscono `state/vault.ts`, `recent.ts`,
  `bookmarks-ui.ts`, `organization.ts`, `panels/document.ts`,
  `panels/explorer.ts` e `editors/base/surface.ts`.
- Il layout vivo invece migra la chiave: `panels/document.ts:478-489` chiama
  `documentSessions.rename` e poi `rename(e.from, e.to)`.
- `applyWorkspace` (`workspaces.ts:422-449`) controlla i documenti con
  `existingDocuments` e scarta ogni scheda, e ogni voce di cronologia, il cui id
  non esiste più. Il vecchio id di una nota rinominata finisce in `missingDocs`.

Effetto: rinomina una nota aperta in un workspace salvato, poi ripristina il
workspace. La scheda sparisce e il rapporto la dà per mancante, anche se la
nota c'è. La ADR 0188 chiede che una rinomina aggiorni o invalidi ogni dato
derivato, e l'evento `DocumentRenamed` (`crates/fub-abi/src/event.rs`) dice che
chi tiene stato per documento deve migrare la chiave. I segnalibri e i recenti
lo fanno; i workspace salvati no.

Direzione: migrare gli id dei workspace salvati su `document_renamed`, con la
stessa regola di `rename` del layout, e aggiungere un test Vitest con
`host/fake.ts`.

### I90. La CLI interroga gli indici prima che siano pronti: risposte vuote con `ok: true`

**Riprodotto.**

- `Connection::open_vault` (`crates/fub-cli/src/commands.rs:170-196`) chiama
  `Host::open` e torna. `open` avvia il job `vault.index` e non lo aspetta.
- `Host::wait_indexed` (`crates/fub-host/src/session.rs:1390-1411`) esiste, e la
  sua documentazione nomina proprio questo caso: «un uso da riga di comando che
  apre, indicizza ed esce». `fub-cli` non la chiama mai; i chiamanti sono solo
  esempi e test.
- `diagnostics` in un comando secco riporta `"indexing": "running"`.

Prove su un vault di tre file (`b.md` con tag, proprietà e un compito; `x.md`
con `[[b]]`):

| Comando secco | Risultato | Stesso comando nel `repl`, a indice pronto |
|---|---|---|
| `query --resolve '[[b]]'` | `resolved: null` | `b.md` |
| `query --backlinks b.md` | `total: 0` | `x.md` |
| `query --neighbors x.md` | `items: []` | `b.md` |
| `query --tag etichetta` | `total: 0` | `b.md` |
| `query --property stato=aperto` | `total: 0` | `b.md` |

- Sei ripetizioni danno sei volte lo stesso esito: non è una corsa occasionale.
  `query --text` e `--resolve b.md` (un path) rispondono invece subito.
- Il caso più serio è il piano di `--dry-run`. `note.rename` chiede i backlink
  all'indice per elencare le note toccate
  (`crates/fub-features/src/commands.rs:1577-1594`). Con `x.md` e `y.md` che
  linkano `b.md`:
  - secco: `docs: ["b.md","c.md"]`;
  - `repl`: `docs: ["b.md","c.md","x.md","y.md"]`.

  L'esecuzione reale invece riscrive i link di tutte e due le note. Il piano che
  l'utente approva sottostima quindi l'impatto, cioè il «consenso strappato» che
  il commento in quel punto vuole evitare.
- L'esito non segnala che la risposta è parziale e non c'è un test CLI sulle
  query del grafo (`crates/fub-cli/tests/` ha solo `cli_contract.rs` e
  `clipper_native.rs`).

Direzione: `Connection::open_vault` chiama `wait_indexed` (o la chiamano i
comandi che leggono gli indici), e un test in `cli_contract.rs` fa
`query --backlinks` su un vault appena aperto.

Nota: le prove di I55 sono state ripetute nel `repl` a indice pronto e
reggono. Lo stesso controllo ha mostrato che due file che differiscono solo per
le maiuscole (`Nota.md`, `nota.md`) si risolvono correttamente.

### I91. Circa duecento commenti di documentazione Rust sono spezzati e attaccati all'item sbagliato

**Verificato.**

Blocchi `///` finiscono a metà frase subito prima di un item, e la frase
continua nel blocco dell'item seguente. Rustdoc attacca così metà della
documentazione all'item sbagliato. Esempi:

- `crates/fub-abi/src/model.rs:1327-1331`: la doc della variante `Unknown`
  («Ciò che non si normalizza… L'escape / hatch delle proprietà») è spezzata
  sopra `Link` e `List`. La doc del tipo che segue («Il valore di una voce di
  elenco…») finisce sulla variante `Unknown`. È API per gli autori.
- `crates/fub-kernel/src/workspace.rs:1985-2005`: la doc di `INDEX_JOB` inizia
  sopra `FEED_BATCH`, e la doc di `BeforeWriteHook` è intercalata con quella di
  `INDEX_JOB`.
- `crates/fub-features/src/commands.rs:100-105`: «Chi vuole un'altra
  estensione» sta sopra `UNTITLED`, e «la scrive nel nome.» apre la doc della
  funzione seguente.
- `crates/fub-kernel/src/index/core.rs:976-994`: dentro `resolve` i commenti dei
  bracci del `match` sono in ordine sbagliato.

Una scansione (blocco doc che termina senza punteggiatura subito prima di un
item, escluse le righe di riferimento `[x]: …`) trova 201 casi in 31 file:
`workspace.rs` 87, `index/core.rs` 25, `fub-features/src/commands.rs` 23,
`entries.rs` 11, `storage.rs` 7. La scansione ha qualche falso positivo, ma i
campioni controllati a mano nei file principali sono tutti veri.

`git blame` riporta le righe spezzate ai refactor automatici `f7c7d35e`
(2026-08-20, «i nomi del codice in inglese…») e `525578d2` («ripristina il tree
completo della tranche G3»).

Impatto: la documentazione è la fonte principale del perché nel repo, e qui
descrive l'item sbagliato. Non c'è una guardia che se ne accorga.

Direzione: ricostruire i blocchi partendo dalla versione precedente a quei
commit, e aggiungere un controllo (anche euristico) in `.github/scripts/`.

## Quarta ricognizione: sicurezza, crash e integrità dei dati

### I92. Path traversal e vault escape su Windows tramite backslash in `path_policy::fenced`

**Verificato.**

- `crates/fub-abi/src/rules/path_policy.rs:467-480`: la funzione fondamentale di
  recinto del vault `fenced(path: &str)` valida i componenti solo tramite
  `path.split('/')`. Non controlla né converte i backslash (`\`).
- Su Windows `\` è il separatore nativo del filesystem. Una stringa come
  `..\..\..\Windows\System32\drivers\etc\hosts` non contiene `/`, quindi
  `path.split('/')` produce un solo segmento.
- `ascent(segment)` fallisce (perché il segmento intero non è identico a `".."`),
  e `unit_windows(0, segment)` fallisce (perché non comincia con `[a-zA-Z]:`).
  `fenced` restituisce `Ok(())`.
- `Vault::path_for` (`crates/fub-kernel/src/vault.rs:810-816`) invoca
  `path_policy::fenced(id.as_str())?` (che passa) e restituisce
  `self.root.join(id.as_str())`. Su Windows `Path::join` risolve i separatori `\`
  e le componenti `..`, evadendo completamente dalla cartella radice del vault.
- Quando un plugin WASM chiama `read_document_bytes` o `read_document` passando
  tale stringa, il runtime (`crates/fub-wasm-host/src/guest.rs:134`) esegue
  `DocId::new(id)` senza sanitizzazione e lo passa al kernel.
- In `Workspace::prepare_document_write` nel ramo `WriteBase::DescendsFrom`, l'id
  viene clonato e scritto direttamente, consentendo la scrittura o sovrascrittura
  arbitraria su disco in ambiente Windows.
- L'autore era consapevole del rischio in `Workspace::plugin_data_path`
  (`crates/fub-kernel/src/workspace.rs:12831`), dove ha inserito espressamente
  `if rel.contains('\\') { return Err(...); }`, ma la guardia è stata omessa in
  `path_policy::fenced`.

**Impatto:** Evasione completa del sandbox del vault su Windows: lettura di file
riservati di sistema o chiavi utente e sovrascrittura arbitraria fuori dal vault.

**Direzione.** Aggiungere immediatamente in `path_policy::fenced` il rifiuto di
qualsiasi carattere `\` o convertire preventivamente con `from_outside`, e
verificare che `DocId::new` normalizzi rigorosamente i separatori.

### I93. Cancellazione permanente dei dati per-documento degli allegati al boot in `Workspace::collect_doc_data`

**Verificato.**

- I dati per-documento dei plugin (come le versioni di `fub:versioning`, annotazioni
  o metadati) risiedono in `.fub/data/plugins/<id>/per-doc/<encoded_id>/`.
- All'apertura del vault (`Workspace::reindex`) e durante `vault.repair`, viene
  chiamata `Workspace::collect_doc_data` (`crates/fub-kernel/src/workspace.rs:12560-12573`)
  per rimuovere le cartelle orfane dei documenti eliminati.
- Il predicato passato a `crate::docdata::collect` verifica:
  `metas.contains_key(doc) || trashed.contains(doc) || suspended.contains(doc)`.
- `self.indexes.core.metas` contiene **soltanto** i documenti riconosciuti dai
  provider di formato (Markdown, Canvas, Base). Tutti gli altri file del vault
  (immagini, PDF, archivi, file binari, allegati) risiedono invece in
  `self.indexes.core.entries`.
- In `crates/fub-kernel/src/workspace/removal.rs:333`, la verifica è corretta:
  `metas.contains_key(id) || entries.contains_key(id)`. In `collect_doc_data:12571`,
  `entries` è stato dimenticato.
- Di conseguenza, per qualsiasi allegato o file non-documento, `exists(&doc)`
  in `crates/fub-kernel/src/docdata.rs:280` restituisce `false`.
  `docdata::collect` considera la cartella orfana ed esegue:
  `storage.remove_dir_all(&entry.path)`.

**Impatto:** Ad ogni apertura del vault o repair, il kernel distrugge
irreversibilmente lo storico delle versioni e tutti i dati per-documento di
immagini, PDF e allegati presenti nel vault.

**Direzione.** Includere `|| self.indexes.core.entries.contains_key(doc)` nel
predicato di `collect_doc_data`.

### I94. Chiusura della tab distrugge il buffer dirty in memoria se il salvataggio su disco fallisce

**Verificato.**

- In `apps/client/src/panels/document.ts:1297-1301`, la chiusura di una scheda
  chiama sincronicamente `closeTab(paneId, index)` e avvia asincronamente
  `releaseTab(r.id, target)`.
- `releaseTab` (`:811-822`) invoca `dismissIfUnwatched(doc)`, che a sua volta
  chiama `await documentSessions.release(doc)`. Il valore restituito
  (`{ kind: "closed", dirty: true }`) viene completamente scartato a `:821`.
- In `apps/client/src/state/document-session.ts:1230-1260`:
  `await session.flush(); if (session.dirty) await session.flushDraft(); ... return this.close(id);`.
- Se il salvataggio su disco fallisce (disco pieno, permessi revocati, errore di
  I/O o disconnessione), `session.flush()` registra l'errore e `session.dirty`
  rimane `true`. Se anche il draft fallisce, o persino se viene scritto,
  `release` prosegue incondizionatamente e invoca `this.close(id)`.
- `this.close(id)` rimuove la sessione dalla mappa in memoria e ne dealloca il
  buffer.
- L'utente non riceve alcun dialogo di conferma o avviso bloccante, la tab è già
  stata rimossa dall'interfaccia e le modifiche non salvate sono irrimediabilmente
  perse.

**Impatto:** Perdita permanente di dati digitati dall'utente in caso di qualsiasi
errore transitorio o permanente di scrittura su disco alla chiusura della tab.

**Direzione.** In `release`, se la sessione resta `dirty`, non rimuoverla ma
restituire uno stato che consenta a `panels/document.ts` di mostrare un dialogo
modale di conferma ("Impossibile salvare il file: scartare le modifiche o riprovare?").

### I95. Deadlock reentrante: `sessions.read()` trattenuto durante query a provider ed event handlers

**Verificato.**

- In `Host::query_index` (`crates/fub-host/src/session.rs:2947`) e
  `Host::write_workspace` (`:3288`), le operazioni girano dentro
  `self.in_session(vault, |session| ...)`.
- `in_session` acquisisce il lock in lettura `self.sessions.read()`.
- Sotto questo lock condiviso:
  1. `query_index` invoca `query_workspace(&session.workspace, query)`, che chiama
     direttamente provider di formato o di indice (anche plugin esterni e WASM).
  2. `write_workspace` invoca `with_event_drain` e `drain_events` (`jobs.rs:596-641`),
     che recapita gli eventi agli handler registrati dai plugin (`invoke(&mut host)`).
- Se un altro thread invoca `Host::close_vault` o `Host::open`, richiede
  `self.sessions.write()`. Su piattaforme POSIX con implementazioni RwLock con
  writer-priority, il writer in attesa blocca ogni nuova acquisizione di
  `sessions.read()`.
- Se a questo punto il plugin (o un qualunque thread concorrente della shell)
  tenta di accedere all'Host tramite un metodo che usa `with_session`, si verifica
  un deadlock circolare.
- In `write_document` (`session.rs:3454`) e `render_view` (`:3565`), l'autore ha
  clonato esplicitamente `session.workspace` rilasciando il lock prima di invocare
  i provider. In `query_index` e `write_workspace` questa cautela è stata omessa,
  violando la regola di `AGENTS.md` ("Non mantenere un lock del workspace durante
  una chiamata a provider o altro codice esterno").

**Impatto:** Freeze completo dell'applicazione e blocco della coda IPC se si apre
o chiude un vault mentre un provider o un plugin sta gestendo eventi o query.

**Direzione.** Estrarre `session.workspace.clone()` e rilasciare
`self.sessions.read()` prima di eseguire la query o drenare gli eventi.

### I96. Crash del processo host da trap WASM non gestito in `WasmViewProvider::interests`

**Verificato.**

- Nel trait ABI `ViewProvider`, `fn interests(&self, instance: &ViewInstance) -> ViewInterests`
  restituisce il valore diretto anziché un `Result`.
- In `crates/fub-wasm-host/src/component.rs:1068-1088`, qualsiasi anomalia del
  guest (trap Wasmtime, timeout dell'epoch deadline dopo 5 secondi, out-of-bounds,
  superamento del limite di memoria di 64 MiB o fallimento di traduzione WIT)
  invoca direttamente `panic!("interessi view falliti: {error}")`.
- Quando un plugin registra una vista, `Workspace::register_view_provider` chiama
  `crate::providers::declared_specs` (`crates/fub-kernel/src/workspace.rs:9765`),
  che invoca `provider.interests(...)` sul thread del processo host senza alcuna
  protezione `catch_unwind`.
- Un plugin WASM malevolo o in loop infinito fa crashare istantaneamente il
  processo host. Se anche il panico venisse catturato a monte, il `Mutex<Instance>`
  rimarrebbe avvelenato (`poisoned`), rendendo inutilizzabile l'intera istanza.

**Impatto:** Denial of Service e crash del processo desktop/CLI scatenabile da
qualsiasi plugin WASM non fidato installato.

**Direzione.** In `WasmViewProvider::interests`, intercettare gli errori senza
panico, registrare l'anomalia nei log e restituire il valore di ripiego sicuro
`ViewInterests::default()`.

### I97. Bypass delle directory consentite in `Guard::restore_document` con destinazione esplicita

**Verificato.**

- `Guard` applica il confinamento dei percorsi (`write_paths`, `read_paths`) per
  i plugin non fidati. Per impedire l'accesso a note cancellate fuori dal proprio
  perimetro, `Guard::list_trash` filtra le voci controllando `entry.original`.
- In `Guard::restore_document` (`crates/fub-kernel/src/host/guard.rs:995-1012`), se
  il chiamante fornisce `to: Some(target)`:
  - il codice salta completamente `self.list_trash()?`;
  - verifica unicamente `check_path(Capability::VaultStructure, target.as_str())`;
  - il percorso originale di `entry` non viene **mai** controllato contro
    `self.policy.denies_path`.
- Un plugin confinato alla cartella `sandbox/` può specificare come `entry` l'id
  di un file cestinato da una cartella riservata (es. `confidential/passwords.md.trash-...`)
  e come destinazione `sandbox/passwords.md`. Il controllo passa perché
  `sandbox/` è consentito, e il file riservato viene ripristinato nell'area del
  plugin, che può quindi leggerne il contenuto.

**Impatto:** Evasione del confinamento di directory e accesso non autorizzato a
file riservati cestinati.

**Direzione.** Risolvere sempre `entry.original` tramite il cestino e verificare
che sia l'originale sia la destinazione rispettino le policy di percorso per
`VaultStructure` e `VaultRead`.

### I98. `vault.clear-journal` invocabile dai plugin senza autorizzazione utente

**Verificato.**

- In `crates/fub-kernel/src/maintenance.rs:63-76`, la documentazione architetturale
  stabilisce che l'azzeramento del journal è una facoltà riservata a un gesto
  esplicito dell'utente e non deve essere concessa ai plugin.
- Tuttavia `VAULT_CLEAR_JOURNAL` (`"vault.clear-journal"`, `workspace.rs:10708`)
  è registrato nel catalogo comandi del workspace come un normale comando.
- `JobHost::run_command` (`crates/fub-host/src/jobs.rs:1365-1390`) richiede
  esclusivamente `Capability::Commands`.
- Qualsiasi plugin provvisto del comune permesso `fub:commands` può eseguire
  `host.run_command("vault.clear-journal", json!({}))`, cancellando
  immediatamente `.fub/journal.jsonl` e distruggendo la storia transazionale e di
  audit del vault, senza alcun dialogo di conferma né verifica dell'attore
  interattivo.

**Impatto:** Distruzione irreversibile della cronologia e del registro di audit
del vault da parte di plugin di terze parti.

**Direzione.** Rifiutare `vault.clear-journal` quando invocato programmaticamente
da `JobHost` o da un plugin, richiedendo una verifica dell'attore utente o una
capability amministrativa dedicata.

### I99. Decodifica errata dei surrogate pair UTF-16 nel parser JSON Canvas: fallimento silente su emoji

**Verificato.**

- Nel parser streaming zero-copy del Canvas (`crates/fub-format-canvas/src/json_map.rs:126-151`),
  il ramo per le sequenze di escape `\uXXXX` riconosce i surrogate alti (`0xD800..0xDC00`)
  e legge il surrogate basso successivo (`0xDC00..0xE000`).
- Dopo aver decodificato il codice a riga 138-140, esegue `i += 4;` a riga 147
  e `i += 1;` a riga 151 (avanzamento totale di 5 byte anziché 11).
- Alla successiva iterazione, l'indice `i` atterra esattamente sul carattere `\`
  della seconda sequenza `\uXXXX`. Il parser la rilegge come unità di codice
  isolata: il valore cade in `0xDC00..0xE000` (low surrogate standalone), che
  fallisce il controllo sul surrogate alto ed entra nel ramo `else`.
- `char::from_u32(code)` per un low surrogate standalone restituisce `None`, e
  l'operatore `?` fa fallire immediatamente l'intera funzione `decode_string`.
- Qualsiasi file `.canvas` contenente testo con emoji o caratteri fuori dal BMP
  serializzati con surrogate pair UTF-16 (standard nella maggior parte dei serializzatori
  JSON) fallisce l'apertura e viene considerato corrotto.

**Impatto:** Impossibilità di aprire o parsare file Canvas contenenti emoji o
caratteri Unicode supplementari esportati in formato JSON standard.

**Direzione.** Nella gestione del surrogate pair, avanzare l'indice `i` di
ulteriori 6 byte per consumare interamente il secondo escape `\uXXXX`.

### I100. Ricorsione illimitata e stack overflow fatale (`SIGSEGV`) nei parser di formule e query

**Verificato.**

- Varie grammatiche ricorsive nel codebase non impongono alcun limite alla
  profondità dello stack:
  1. **Sheet (`crates/fub-format-sheet/src/formula.rs:734-786`, `:197-265`):**
     `primary` (`Token::LeftParen`) richiama ricorsivamente `comparison` -> `unary` ->
     `primary` senza contatore di profondità; `evaluate_ast` e `collect_dependencies`
     percorrono i nodi ricorsivamente. Formule con parentesi annidate
     (`=((((... 20.000 volte ... 1))))`) esauriscono lo stack (2MB su Linux) e
     provocano la terminazione immediata del processo con `SIGSEGV`.
  2. **Base (`crates/fub-format-base/src/formula.rs:483-537`):** Il valutatore
     ha una guardia `MAX_FORMULA_DEPTH = 32` (`:746`), ma il parser a discesa
     ricorsiva (`parse_primary`) non ha alcun limite e va in stack overflow
     durante la costruzione dell'AST prima che la formula raggiunga il valutatore.
  3. **Canvas (`crates/fub-format-canvas/src/json_map.rs:263-328`):** `skip_value`,
     `skip_object` e `skip_array` si chiamano a vicenda senza limite per oggetti
     o array annidati.
  4. **Search (`crates/fub-abi/src/rules/search_syntax.rs:235-265`):** `alternatives(depth)`
     riceve un valore `depth = 1` fisso a ogni livello di ricorsione invece di
     `depth + 1`, rendendo inefficace qualsiasi controllo di profondità.

**Impatto:** Crash non recuperabile del backend su documenti contenenti formule o
strutture annidate profonde.

**Direzione.** Introdurre un limite di profondità esplicito (es. 64) in tutti i
parser a discesa ricorsiva e restituire un errore tipizzato al superamento.

### I101. Link relativi nel Markdown navigano la webview e scaricano l'intera SPA

**Verificato.**

- In `apps/client/src/ui/sanitize.ts:234-243`, `isAllowedLink` ammette link
  relativi senza schema. La sanitizzazione (`:385-388`) aggiunge `target="_blank"`
  solo per `external(href)`. Poiché i link relativi non hanno schema, `external`
  è falso e l'attributo `target` non viene impostato.
- In `apps/client/src/editors/text/profiles/markdown/mount.ts:175-194`, il gestore
  di clic intercetta tag, percorsi interni, wikilink e ancore (`#`). Per un link
  relativo Markdown (es. `[guida](docs/manuale.html)` o `<a href="test.html">`),
  nessuna di queste condizioni corrisponde ed `event.preventDefault()` **non
  viene mai chiamato**.
- La webview di Tauri esegue la navigazione predefinita della finestra principale
  verso l'URL relativo.
- L'intera single-page application viene scaricata: tutte le sessioni documento,
  le bozze non salvate e la cronologia degli undo di tutti i pannelli vengono
  distrutti.

**Impatto:** Crash logico dell'applicazione e perdita totale dello stato in
memoria al clic su un link relativo in un documento Markdown.

**Direzione.** Intercettare in `markdown/mount.ts` tutti i link consentiti e
chiamare sempre `event.preventDefault()`, instradando i link relativi verso
l'apertura interna o verso il browser di sistema.

### I102. Modifiche concorrenti tra riquadri divisi (Split) sovrascritte senza merge né undo

**Verificato.**

- A differenza della sincronizzazione tra finestre diverse che impiega la
  trasformazione operazionale (`document-bridge.ts`), l'editing concorrente su due
  riquadri divisi (split) della stessa finestra passa per
  `DocumentSession.acceptSurfaceChange` (`apps/client/src/state/document-session.ts:303-318`).
- Quando l'utente digita in rapida successione su entrambi i riquadri dello stesso
  documento, la seconda operazione non ha come pre-immagine il testo aggiornato
  dalla prima: `tryApplyOperation` fallisce e `acceptSurfaceChange` restituisce
  `{ kind: "realigned", text: this.#state.text }`.
- In `apps/client/src/panels/document.ts:2529-2534`, l'esito `realigned` invoca
  `source.surface.buffer.syncDoc(outcome.text)`.
- `TextEngine.syncDoc` (`apps/client/src/editors/text/engine.ts:223-230`)
  sovrascrive l'intero contenuto dell'editor con `Transaction.addToHistory.of(false)`.
- Le battute digitate nel secondo riquadro vengono cancellate silenziosamente,
  senza fusione e senza possibilità di recupero tramite Ctrl+Z.

**Impatto:** Perdita silente di battute e modifiche concorrenti durante l'uso di
riquadri affiancati sulla stessa nota.

**Direzione.** Estendere la trasformazione operazionale anche alla gestione locale
in `acceptSurfaceChange` o preservare le modifiche rigettate nella cronologia
locale della superficie.

### I103. Sostituzione distruttiva di `paths.old` e blocco permanente all'avvio in `SnapshotApplier::recover_locked`

**Verificato.**

- Durante l'applicazione di uno snapshot (`crates/fub-kernel/src/snapshot.rs:537-560`),
  la procedura rinomina la radice reale in `paths.old`, registra la fase
  `Published` nel record di transazione, e sposta lo staging in `root`.
- Se si verifica un crash in questo intervallo, o se la radice pubblicata risulta
  corrotta o non conforme al manifest atteso:
- Al successivo riavvio, `SnapshotApplier::recover_locked` (`:757-805`) entra nel
  ramo `RecoveryPhase::Published`.
- Se `current.manifest.digest() != record.expected_manifest` ed esiste ancora
  `paths.old` (i dati originali dell'utente), il codice **non effettua alcun
  rollback su `paths.old`** (a differenza del ramo `OldMoved`), ma restituisce
  `Err(SnapshotError::RecoveryNeeded)`.
- In `crates/fub-host/src/session.rs:1565-1572`, l'apertura del vault fallisce
  con `PluginError::Io`.
- Ad ogni tentativo successivo di avvio dell'applicazione, il controllo si ripete
  e fallisce identicamente: il vault resta permanentemente bloccato e inaccessibile,
  lasciando i file originari dell'utente orfani nella cartella temporanea `.fub-snapshot-...old`.

**Impatto:** Blocco permanente dell'apertura del vault dopo un crash durante
l'applicazione di uno snapshot, con mancato recupero automatico dei dati originali.

**Direzione.** Nella fase `Published`, se la nuova radice non è integra ed esiste
`paths.old`, ripristinare automaticamente `paths.old` su `root` per garantire la
crash consistency.

## Affermazioni smentite o ridimensionate

Queste formulazioni della prima ricognizione erano sbagliate o eccessive; le
voci sopra sono già corrette.

- Non è vero che nessuno script faccia rispettare il confine CodeMirror:
  `.github/scripts/check-codemirror-boundary.mjs` esiste ed è in CI.
- `note.property.set` non corrompe i `.canvas`: li respinge il reparse del
  kernel (I01). Corrompe invece i `.base`.
- `import.normalize` non cerca il frontmatter. Riscrive comunque ogni formato
  (I02).
- La stampa non è neutra per tutti i formati: lo sheet non ha un provider (I14).
- Fra `ui/` e il profilo Markdown non c'è un ciclo fra moduli, solo una
  dipendenza nei due sensi fra cartelle (I17).
- Grid e canvas non fingono un buffer di testo; lo fanno media e static (I11).
- Su mobile lo stato di salvataggio compare, nel footer (I34).
- Mobile non scavalca il grant: non ha un modo di aprire un vault (I37).
- Le viste `main` si aprono da segnalibri e workspace, anche se `open_view` non
  è gestito (I38).
- `OfficialFeature` ha già `view` e `commands` dichiarativi (I26).
- Template ignora l'errore di Properties solo nel collegamento del diario (I27).
- Nessun commento dichiara migrati il rail e le preferenze della barra laterale
  (I45).
- La slash palette ammette plugin tramite un'euristica sui parametri (I42).

Candidati della seconda ricognizione scartati dopo la verifica:

- **`syntaxForms` per formato:** non è Markdown-specifico. Il kernel restituisce
  le forme della capability o una lista vuota, e non fallisce per formato. Resta
  solo un IPC superfluo, compreso in I57.
- **Renderer mermaid e base su mobile:** sono registrati anche su mobile, che
  importa `desktop-shell.ts`.
- **Isolamento delle superfici grid, canvas, base e media:** non importano
  `panels/`, `state/store` o la shell, e rilasciano i propri listener.
- **`document-session` e `document-bridge`:** sono neutri rispetto al formato.
  La history locale di grid e canvas non registra le modifiche sincronizzate.
- **Catena if dei namespace custom:** è intenzionale e documentata
  (`fub_abi::ui`). Il difetto vero è I66.
- **`context_menu` non ospitato:** è dichiarato `Uncovered` nei test di
  conformità. Il suo unico difetto è I64.
- **`shell.settings` via clic:** non può fallire in silenzio, perché
  `$("#open-settings")` lancia al mount se manca.
- **Breakpoint:** JS e CSS coincidono sui valori interi. Differiscono di un
  pixel solo a 900px, su una regola innocua.
- **Etichette del grafo, colori, `host/ipc` non iniettabile, `bridge` mobile in
  `host/ipc`:** sono per contratto o scelte documentate.
- **`fub://capture` con parametro `markdown`:** il payload del clipper è davvero
  Markdown. Rientra in I09.
- **Impronta di pubblicazione della CLI:** include già revisione, dimensione e
  mtime di ogni voce, quindi rileva le modifiche a canvas e immagini.
- **Importatori che scrivono `.md`:** sono convertitori verso Markdown per
  natura, e lasciano intatti i formati posseduti da altri. La scelta del formato
  di destinazione rientra in I03 e I07.
- **Altra conoscenza di formato nel kernel:** oltre a I30 non ci sono letterali.
  L'accoppiamento di comportamento è I55.
- **IPC dedicati per l'organizzazione (`set_icon`, …):** deliberati e
  documentati (ADR 0182, `crates/fub-app/tests/lean_ipc.rs`).
- **Store dei temi separato da quello dei plugin:** sono artefatti diversi,
  entrambi documentati. Restano i residui di I76.
- **Doppio interruttore del versioning:** è intenzionale. Restano I61 e la
  contraddizione in I88.
- **Ritenzione del cestino:** lo svuotamento è manuale, come documentato.

Candidati della terza ricognizione scartati dopo la verifica:

- **HTML ostile nel Markdown:** `render_html` scrive blocchi e inline HTML come
  testo con escape (`crates/fub-format-markdown/src/render.rs:193-222`). Gli
  `href` esterni passano così come sono, ma il client li filtra: ogni
  inserimento passa da `ui/sanitize.ts`, e mermaid gira in
  `securityLevel: "strict"` filtrando i link (`ui/mermaid.ts:22-44`, `:164`).
- **URL `javascript:` nel canvas:** il nodo link apre solo `http:` e `https:`
  (`editors/canvas/engine.ts:104`), e il publish usa `safe_external`
  (`crates/fub-host/src/publish/projection.rs:273`).
- **NFC e NFD nei nomi di file:** la chiave di risoluzione normalizza in NFC,
  con un test (`crates/fub-kernel/src/graph.rs:1013`).
- **File che differiscono solo per le maiuscole:** `LinkGraph::pick` preferisce
  la corrispondenza esatta (riprodotto, vedi I90).
- **`note.rename` dalla CLI secca:** riscrive correttamente i link anche con
  l'indice non pronto. Solo il piano di `--dry-run` è sbagliato (I90).
- **Impostazioni di macchina corrotte o di versione futura:** il file non viene
  riscritto, l'errore è chiaro e i campi sconosciuti sono conservati.
- **Versioning e indice di ricerca dopo una rinomina:** seguono l'evento
  (`crates/fub-features/src/versioning.rs:1668-1686`).
- **Altri stati per documento nel client:** la cronologia della palette salva
  id di comando, e la configurazione del grafo non contiene path.

## Ordine suggerito

1. Sicurezza e dati dell'utente (urgenza massima):
   - I92: rifiutare i separatori `\` in `path_policy::fenced` per prevenire il
     vault escape su Windows;
   - I93: correggere il predicato di `Workspace::collect_doc_data` per includere
     `self.indexes.core.entries`, fermando la cancellazione automatica dei dati
     per-documento degli allegati;
   - I94: impedire a `DocumentSession.release` di eliminare sessioni dirty se il
     salvataggio fallisce, e mostrare la conferma di chiusura;
   - I101: intercettare tutti i link in `markdown/mount.ts` con `preventDefault()`,
     impedendo lo scaricamento accidentale dell'intera applicazione;
   - I103: implementare il rollback su `paths.old` nel recupero snapshot in fase
     `Published`.
2. Crash del processo e robustezza runtime:
   - I95: rilasciare `self.sessions.read()` prima di eseguire query ai provider
     o drenare eventi, eliminando il deadlock circolare;
   - I96: catturare gli errori in `WasmViewProvider::interests` restituendo
     `ViewInterests::default()` senza mandare in panic il processo host;
   - I99: correggere l'avanzamento dell'indice nel parser surrogate pair del Canvas;
   - I100: inserire limiti di profondità espliciti nei parser a discesa ricorsiva
     (Sheet, Base, Canvas, Search) per eliminare i `SIGSEGV` da stack overflow;
   - I97 e I98: verificare il percorso originale in `Guard::restore_document` e
     riservare `vault.clear-journal` esclusivamente a gesti interattivi dell'utente.
3. Astrazioni e compatibilità dati esistenti:
   - I01, I02 e I48: guardia di capability ed errore tipizzato, con test in
     `fub-testkit` che riproducono la corruzione del `.base`;
   - I49 e I57: le superfici non devono lanciare eccezioni, e ogni pannello va
     isolato;
   - I50: writer lock preso dall'host.
4. I10: operazioni di modifica mirata sul provider e porta del formato di
   default. Chiudono I03, I04 e I05 e rendono semplici I06 e I09.
5. I14, I15 e I12: capability delle superfici, registro aperto e
   `SurfaceLocation`. Poi I16 (spostare `editor/editor.ts` nel profilo, dopo
   aver corretto il test tipografico).
6. I20, I21 e I22: `Host::with_storage`, `with_watcher` pubblico e
   `with_network`. Sono prerequisiti di mobile (I37) e della sync
   ([#9](https://github.com/Fubeo/Fub/issues/9)).
7. I29 e I31: rendere esplicito, o rifiutare al caricamento, ciò che i plugin
   non possono fare.
