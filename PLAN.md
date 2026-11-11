# Piano: L'editor di Fub

Branch: piano/editor-completo
Obiettivo: l'editor delle note diventa uno solo, «Scrittura», che a riposo
mostra solo ciò che si legge, al passaggio le azioni e su richiesta tutto,
da tastiera o col puntatore. Dentro: i blocchi come preferenza e un
trascinamento che muove solo il blocco; la testata con titolo, copertina e
proprietà, ognuna col suo editor (Selezione, Stato, Relazione comprese); i
tipi di nota; i commenti con la discussione; i compiti del vault e i
promemoria; le Basi costruite a vista, col calendario e la linea del tempo;
la trasclusione viva e il blocco sincronizzato; i diagrammi e le formule che
si toccano invece di programmarli; ogni file del vault come scheda viva
nella nota, con la tabella che prende i gesti del foglio; l'esportazione in
PDF regolata dal vivo; i menu con una lingua sola in ogni editor. I file
restano Markdown che ogni programma legge.
Perché: l'editor ha già molto (27.837 righe in `editors/text/`, quattro
modalità, il «/» con dodici sezioni, Basi, Tasks, Mermaid e KaTeX) ma sembra
acerbo: le parti non stanno insieme, mancano funzioni attese (Selezione e
Stato, i commenti nelle note, la vista dei compiti, il calendario) e alcuni
gesti si vedono sbagliati (il primo blocco solleva la testata). Il brief è
l'artifact «L'editor di Fub» (verificato su main 768caa2 il 2026-11-09),
riletto sul codice di `main` 6249d976b il 2026-11-11.
Fuori scope: le modifiche suggerite di CriticMarkup (`{++ ++}`, `{-- --}`,
`{~~ ~> ~~}`: D4 A, un piano a parte dopo i commenti); le regole CSS
scritte a mano per la stampa; la posizione libera dei blocchi sulla pagina
(D15 B: il piano libero vive nella zona lavagna); le formule nelle tabelle
Markdown (D13 e D14 ritirate); sincronizzazione, pubblicazione e
collaborazione in tempo reale (#9, #93); un assistente AI dentro l'editor
(oggi l'AI lavora via MCP); i pulsanti che eseguono comandi; il telefono
oltre ciò che serve perché l'editor non si rompa a 390 px (ha il suo
piano); le tre idee «Più avanti» del diagramma (il clic su un nodo che porta
al sorgente, la galleria dei modelli, la larghezza con la maniglia); un tipo
nuovo o un campo nuovo nella WIT (sarebbe una 0.2.1, da chiedere); le
notifiche chieste da componenti WASM; la CI (i coder non la toccano); il
vault vero.
Assunzioni: il pianificatore ha lavorato senza fare domande all'utente
(consegna del 2026-11-11: «scegli la variante di qualità più alta, che dà
più libertà a chi usa Fub, e scrivila qui»). Tre domande restano aperte
(Q1, Q2, Q3 in fondo all'elenco): i task che le aspettano lo dicono, e fino
alla risposta vale la consigliata.

- A-1 · Il brief si segue alla lettera: testo e prototipo dell'artifact
  «L'editor di Fub». Dove l'artifact e il codice non coincidono vince il
  codice, con la nota nel task (CLAUDE.md).
- A-2 · Le scelte: D1–D12 e D16 come nell'artifact; D13 e D14 ritirate;
  D15 = A e D17 = A, le consigliate, che l'artifact dice «da confermare»
  (Q2); D9 è superata: l'editor sta dentro la pre-alpha, nella Fase C del
  piano della PA («L'editor di Fub, onde 1–4»).
- A-3 · I numeri: T1–T83 restano quelli dell'artifact. **T84 è nuovo**: il
  «/» in una colonna sola, che E7 specifica senza un task. I task troppo
  grandi o che attraversano un contratto si dividono con una lettera (T2a,
  T2b, T9a, T15a, T17a, T19a, T21a, T26a, T29a, T32a, T33a, T35a, T36a,
  T41a, T69a, T69b, T77a, T77b), e la lettera del contratto viene prima del
  task che lo usa. Le taglie dell'artifact (S 2 ore, M 5, L 20, XL 40)
  restano indicative.
- A-4 · Quando parte. L'onda 1 parte con S2 in `main` (tutto il ramo
  `piano/scrittoio-2`, PR #309; oggi mancano S2 T10, T24, T25, T26), come
  dice la riga della PA. Prima possono andare T1 (già in corso) e i task di
  solo Rust che non toccano nessun file del diff di S2 né un task aperto di
  N6: T9a, T21a, T15a, T17a, T19a. L'onda 2 parte con l'onda 1 in `main`.
  L'onda 3 parte con N6 in `main` (le schede, la modifica sul posto, il
  foglio vivo, gli estratti); T50, T51 e T55 non aspettano N6 e stanno
  nell'onda 1, come l'artifact permette. L'onda 4 parte dopo l'onda 1, anche
  accanto alle onde 2 e 3, e comincia da T67.
- A-5 · La battuta è il cancello (correzione 1). T23 apre l'onda 1 dopo S2.
  Ogni task dopo misura `node bench/interaction.mjs --only=battuta` prima e
  dopo e scrive i due numeri nel suo `Stato`; un task che porta la mediana
  oltre 4 ms o il novantesimo oltre 8 sulla nota grande non si integra.
- A-6 · Le cinque regole delle sovrapposizioni, vincolanti:
  1. un ospite delle schede solo, quello di N6 (`editors/canvas/cards.ts`,
     `state/card-editors.ts`, oggi solo sul ramo di N6), portato in
     `editors/core` dal suo task (T41a): niente copie e nessuna API nuova
     prima;
  2. il contesto di una scheda lo mostra chi la ospita: sulla lavagna la
     riga delle opzioni (N6 T50), nella nota la barra di formato (E21), con
     lo stesso codice;
  3. scheda e riquadro dicono la stessa cosa: ogni task EC che cambia la
     Scrittura ha fra i casi limite «dentro una scheda di nota della
     lavagna», e con N6 in `main` `canvas-edit.e2e.test.ts` è la sua prova di
     confine; prima di N6 in `main` il caso lo prova N6 quando si unisce;
  4. dove S2 o N6 hanno già scelto, la loro scelta vince solo se l'artifact
     dice di partire da lì; altrimenti vince EC, con la nota qui;
  5. task di piani diversi sugli stessi file non corrono insieme: lo dice
     «mai con…» in `Dipende da`.
- A-7 · Le liste che si uniscono: `docs/README.md`, `docs/map/*.md`,
  `apps/client/src/i18n/catalog.ts`, `apps/client/src/i18n/lexicon.ts`,
  `apps/client/src/editors/text/profiles/markdown/strings.ts`, l'elenco
  delle scene di `apps/client/bench/scene.mjs` e `bench/motion.mjs`, le
  righe di registrazione di `crates/fub-features/src/lib.rs`, i gruppi di
  `apps/client/src/editors/text/profiles/markdown/block-groups.ts` (nasce
  con T11), l'elenco dei pezzi della pelle in
  `apps/client/src/theme/scrittoio/skin/order.ts` e
  `apps/client/src/theme/scrittoio/anatomia.ts`, le voci dei blocchi in
  `markdown/slash.ts` e `apps/client/src/panels/slash/entries.ts`, la
  registrazione delle specie di scheda in
  `apps/client/src/editors/core/bootstrap.ts`, le sezioni di
  `skin/live-cards.css` e `anatomia/live-cards.ts` (nascono con T41; ogni
  specie aggiunge la sua), l'elenco delle sezioni dell'esportatore
  (`apps/client/src/export/sections/index.ts`, T70) e i moduli di
  `crates/fub-features/src/pdf_export/mod.rs` (T67). Così anche le pagine
  nuove di questo piano (`docs/product/editor-writing.md`, `live-cards.md`,
  `tasks-and-reminders.md`, `pdf-export.md`,
  `docs/reference/pdf-export-format.md`) e il pezzo nuovo `skin/export.css`:
  ogni task scrive la sua sezione, col suo titolo, e non riscrive quelle
  degli altri. Due task della stessa riga di ondata possono aggiungerci
  righe o sezioni insieme e l'orchestratore unisce (DECISIONS, «i conflitti
  banali»). Ogni altro file in comune separa i task.
- A-8 · Il prototipo è l'artifact copiato così com'è
  (`PLAN-ui/editor.html`, 1,3 MB, coi caratteri di KaTeX dentro): non è
  costruito dalla pelle di Fub come chiede `prototipo.md`, ha nomi suoi per
  token e classi e le sue scritture sul disco sono simulate. I task ne
  prendono misure, tempi, testi, stati e moto, e li scrivono coi token e i
  ganci di Fub (la tabella «Dal prototipo» dà la corrispondenza), passando
  ogni regola nuova da `sanitizeThemeCss`.
- A-9 · I contratti.
  - `PropertyType` prende Select, Status e Url (T9a) e Relation (T35a):
    additivo, fuori dalla WIT, mirror TS rigenerato. Il registro
    `properties.types` resta alla versione 1 coi campi nuovi facoltativi:
    un registro senza opzioni resta byte per byte. Un Fub vecchio legge un
    registro coi campi nuovi come illeggibile (`deny_unknown_fields`):
    ricade sulla lettura convenzionale e non lo riscrive
    (`writable_property_types`, comportamento di oggi).
  - La WIT 0.2.0 è congelata: niente campo nuovo in `CommandSpec` né caso
    nuovo in `CommandSurface`. **Differenza dall'artifact**: il gruppo del
    blocco della barra di formato (E8) lo dichiara la superficie, come
    `contextMenu(at)` in `editors/core/registry.ts`, coi comandi che già
    esistono; un plugin entra nella barra generale come oggi, non in un
    gruppo del blocco.
  - I commenti usano i nodi custom di `fub_abi::model` (`custom_kind`),
    senza tipi nuovi nella WIT.
  - `fub:notifications` è un permesso nuovo del core (T36a), stretto come
    gli altri; nessuna capacità nuova ai componenti WASM.
  - Nessuna porta IPC nuova: dati con `query_index`, azioni con
    `list_commands`/`invoke_command`, viste con
    `list_views`/`render_view`/`view_action`. Un task che crede di averne
    bisogno si ferma e lo scrive nel suo `Stato`.
- A-10 · Due file, un annulla (correzione 4). Il lotto del kernel oggi non è
  una transazione (`Workspace::batch` in `crates/fub-kernel/src/workspace.rs`:
  «Non è una transazione»). T32a rende tutto-o-niente un piano di comando su
  più documenti; T30, T32, T48 e T52 lo usano.
- A-11 · Ogni scrittura porta la revisione; ogni ascoltatore ha il suo
  smaltimento (`check-listeners.mjs`); nessuna IPC né WASM per battuta;
  nessun lucchetto del workspace attraverso una chiamata di provider.
- A-12 · Le parole nuove (Scrittura, Sbirciata, Trasclusione viva, Blocco
  sincronizzato, Riga dei suggerimenti, Scheda viva, Zona lavagna, Estratto)
  entrano in `i18n/lexicon.ts` e nel catalogo, in italiano e in inglese, col
  primo task che le mostra.
- A-13 · La documentazione. `docs/product/editor-and-preview.md` e
  `docs/architecture/editor-surfaces.md` sono alla soglia (449 righe su
  450), `docs/reference/on-disk-layout.md` a 549 su 550: ciò che è nuovo va
  in pagine nuove, ognuna collegata da `docs/README.md`, nate col primo task
  che le riempie: `product/editor-writing.md` (T3),
  `product/command-space.md` (T13: lo spazio comandi oggi non ha una
  pagina), `reference/property-types.md` (T9a),
  `reference/note-conventions.md` (T21a), `product/editor-comments.md`
  (T21), `product/bases.md` (T15a), `product/tasks-and-reminders.md`
  (T19a), `product/editor-tables.md` (T50: vi passa anche il testo delle
  tabelle di `editor-and-preview.md`), `product/editor-diagrams.md` (T57),
  `product/editor-math.md` (T60), `product/live-cards.md` (T41),
  `product/pdf-export.md` (T70), `reference/pdf-export-format.md` (T68). La
  scelta del motore di T67 è un ADR in `docs/decisions/`. Una pagina che
  passa la soglia si divide nello stesso task. Lo stesso per la pelle: i
  pezzi nuovi `skin/diagrams.css` (T57), `skin/math.css` (T60),
  `skin/live-cards.css` (T41) e `skin/export.css` (T70) nascono ognuno col
  suo modulo in `theme/scrittoio/anatomia/`, elencati in `skin/order.ts` e
  `anatomia.ts`, perché `skin/editors.css` (2.796 righe) e `skin/menus.css`
  non crescano oltre.
- A-14 · Il tocco (correzione 2) è T26a. Ogni task che tocca la resa porta
  le foto del banco nelle due luci, a 700 px e al telefono; le baseline
  vengono solo dal runner (CLAUDE.md).
- A-15 · Le scelte fatte per l'utente, dove l'artifact lascia aperto:
  - ogni comportamento nuovo si spegne o si sceglie nelle Impostazioni, col
    valore di serie dell'artifact: `editor.blocks` (acceso),
    `editor.toolbar` (compatta), `editor.hints` (accesa),
    `editor.link-click` (apri), `editor.typewriter` (spenta),
    `editor.typography` (spenta), `editor.math.source` (spenta),
    `editor.math.help` (pieni);
  - la misura delle schede si scrive come Obsidian la capisce (`|LxA`);
  - rinominare dal titolo una nota con l'H1 ripiegato riscrive anche l'H1,
    perché il titolo e l'H1 restino uguali (T7);
  - «In evidenza» su una nota senza tipo porta la proprietà fra le prime
    quattro del frontmatter, con un annulla; con un tipo scrive nel tipo
    (T8, T33);
  - Ctrl O: i modi di oggi che perdono il prefisso (la ricerca nel testo,
    i titoli, i modelli) restano raggiungibili (Q1);
  - `editor.toolbar` prende il posto di `chrome.formatbar.visible` senza
    riscriverlo: un valore spento scritto da un Fub di prima si legge come
    `nascosta` (T11);
  - chi firma un commento: il nome è `profile.name` (della macchina,
    chiesto al primo commento con l'avviso che finisce nel file) e il vault
    sceglie con `comments.author` fra nome, iniziali e niente (T22);
  - la sbirciata è `state/note-peek.ts`, perché `shells/scrittoio/frame/peek.ts`
    è già lo sguardo nel cassetto (T20);
  - i promemoria usano le notifiche del sistema con
    `tauri-plugin-notification`, la dipendenza del gruppo Tauri (MIT o
    Apache-2.0): DECISIONS consente una dipendenza che il piano implica,
    con `cargo deny check` verde;
  - il calendario e la linea del tempo, se Obsidian non regge un tipo di
    vista che non conosce, si scrivono nella forma di ripiego (Q3).
- A-16 · T27 (la prova con cinque persone) resta all'utente (DECISIONS) ed
  è rinviata come PA T17, che l'utente ha rinviato il 2026-11-09 («la prova
  con cinque persone per ora non si fa; alla release proveranno i primi
  utenti»): T27 prepara il protocollo e si segna «rinviato», e non blocca
  T28 né l'onda 2.
- A-17 · Sicurezza delle prove: mai il vault vero
  (`~/.cache/fub-live/vault-tutti/`); mai le porte 1431, 1432, 1437, 1438,
  1447, 1448; nel banco `FUB_BENCH_PORT=1460`, o la porta del coder dalla
  1451 in su (`CLAUDE_DEVICE.md`).
- **Q1** · Ctrl O (E9) dà `@` a «Persone e giorni» e `?` all'«Aiuto»; oggi
  `?` è la ricerca nel testo e `@` i titoli
  (`shells/scrittoio/launcher/model.ts`), e Tab cambia modo. Consigliata,
  e il piano parte da qui: come l'artifact, con la ricerca nel testo e i
  titoli della nota aperta come gruppi di «Tutto», `:` che resta la riga e i
  modelli dal comando «Nuova nota da modello». Altre: tenere i prefissi di
  oggi e dare altri caratteri ad Aiuto e Persone (niente da reimparare, ma
  si perde la forma dell'artifact); oppure una settima tessera «Testo» per
  la ricerca. Aspetta la risposta: T13.
- **Q2** · D15 e D17, che l'artifact dice «da confermare». Consigliata, e
  il piano parte da qui: A e A (la nota resta una colonna con schede
  affiancate e zone lavagna; l'interruzione di pagina a mano è una riga
  `<!-- pagina -->` nella nota). Aspettano la risposta: T47 (D15) e T76
  (D17).
- **Q3** · Calendario e linea del tempo come tipi di vista del `.base`
  (D10 A), «dopo la prova con Obsidian». Se la prova mostra che Obsidian
  rifiuta tutto il file per un tipo che non conosce, consigliata: la forma
  di ripiego, `type: table` con una chiave `fub:` che Obsidian ignora (il
  file si apre ovunque, in Obsidian come tabella). Altra: scriverle lo
  stesso come `type: calendar` (in Obsidian quel file non si apre). Aspetta
  la risposta: T17a, solo se la prova va male.
Ondate: onda 1, prima di S2 in `main`: T1 T9a | T21a T15a | T17a T19a ·
onda 1, con S2 in `main`: T23 T50 | T3 T81 T13 | T4 T2a T51 | T5 T83 T55 |
T6 T14 | T2b T8 T84 | T7 T11 T15 | T9 T21 T25 | T10 T22 T16 |
T12 T20 T17 | T18 T24 T82 | T2 T19 | T26a | T26 | T27 T28 ·
onda 2, con l'onda 1 in `main`: T29a T32a T35a | T29 T33a T57 |
T32 T60 T34 | T30 T61 T33 | T31 T62 T58 | T35 T63 T59 | T36a T64 T38 |
T36 T65 T37 | T39 T66 T40 ·
onda 3, con N6 in `main`: T41a | T41 | T42 T44 T45 | T43 T46 | T47 T53 |
T48 T54 | T49 T52 | T56 ·
onda 4, dopo l'onda 1, anche accanto alle onde 2 e 3: T67 |
T68 T69a T77a | T69b T77b | T70 | T71 T73 T79 | T72 T76 T78 | T74 T75 |
T80
Prototipo: `PLAN-ui/editor.html`, l'artifact «L'editor di Fub» copiato
così com'è, col giro guidato di trenta passi (ogni passo ha il suo
«Prova:»). Le scelte che lo hanno formato sono del 2026-11-09; l'utente lo
ha dato come brief da seguire alla lettera il 2026-11-11. Si apre nel
browser dal file; i passi citati nei task sono quelli del giro.

## Modifiche

nessuna

## Dal prototipo

Il prototipo ha token suoi, dichiarati su `.win` (riga 138 circa). Si
scrivono così coi token di Fub (`theme/scrittoio/sheet-*.css`):
`--acc` → `--accent`, `--acc-soft` → `--accent-soft`, `--acc-wash` →
`--accent-wash`, `--ink` → `--text`, `--muted` → `--muted`, `--faint` →
`--muted` (Fub non ha un terzo grigio: non se ne inventa uno), `--tray` →
`--sheet-2`, `--line` → `--border`, `--line-2` → `--border-strong`,
`--mark` → `--highlight`, `--c-<colore>` → `--doc-color-<colore>` e
`--doc-tint-<colore>`; i caratteri `--f-read`, `--f-ui`, `--f-mono` →
`--font-reading`, `--font-ui`, `--font-mono`; i tempi e le ombre →
`--duration-*`, `--shadow-*`, `--elevation-floating-*`. Una misura che il
tema ha già (altezza di riga, raggi, `--row-h`) si prende dal tema; quelle
nuove dell'artifact (40 px la tessera, 34 px la riga, 352 px il «/», 392 px
il riquadro della formula, 316 px il menu del diagramma, 104 px il blocco in
mano) entrano come misure della pelle. Le classi del prototipo non si
copiano: ogni task usa i ganci di `theme/scrittoio/anatomia/*.ts` e
aggiunge lì le classi nuove. Le righe sono quelle di `PLAN-ui/editor.html`.

| Pezzo | Destinazione | Task |
|---|---|---|
| barra del titolo e campo dello spazio comandi (righe 193, 558, 1234) | `apps/client/src/theme/scrittoio/skin/launcher.css`, `shells/scrittoio/launcher/launcher.ts`, `frame/pill.ts` | T82 |
| barra di formato: fissi, gruppo del blocco, «Inserisci» (riga 252) | `skin/menus.css`, `apps/client/src/panels/format-bar.ts` | T11 |
| la pagina, la testata, la copertina (riga 274) | `skin/document.css`, `editors/text/profiles/markdown/page/` (nuovo) | T6, T7 |
| proprietà con l'icona del tipo, editor dei valori, data e scelte (righe 294, 508) | `skin/document.css`, `markdown/page/properties/` (nuovo) | T8, T9, T10 |
| i blocchi, le maniglie, il trascinamento, gli occhi (righe 323, 460, 828, 853) | `skin/editors.css`, `markdown/blocks/handles.ts`, `motion.ts` | T2a, T2b, T2 |
| trasclusione viva (riga 365) | `skin/editors.css`, `markdown/transclusion.ts` (nuovo) | T29, T30 |
| la nota come scheda (link come scheda, riga 376) | `skin/editors.css`, `markdown/link-card.ts` | T20 |
| Base: linguette, Filtro, Ordina, Proprietà, piede, bacheca, calendario (riga 386) | `skin/editors.css`, `apps/client/src/editors/base/` | T15, T16, T17, T34 |
| margine dei commenti, discussione (righe 453, 531) | `skin/document.css`, `markdown/comments/` (nuovo) | T21, T22 |
| pannelli sopra la pagina, sbirciata (righe 468, 576) | `skin/sheets.css`, `panels/document.ts`, `state/note-peek.ts` (nuovo) | T20 |
| il «/» in una colonna (riga 794; la versione a due colonne della riga 496 è quella di oggi, da togliere) | `skin/menus.css`, `apps/client/src/panels/slash/` | T84 |
| la mini-barra (riga 546) | `skin/menus.css`, `panels/mini-bar.ts` | T12 |
| anteprima con Ctrl (riga 554) | `skin/menus.css`, `state/preview.ts` | T20 |
| ispettore: Compiti e Commenti (riga 587) | `skin/drawers.css`, viste dichiarate e `SurfacePanel` | T19, T22 |
| banda: riga dei suggerimenti, somma, modalità (righe 619, 637) | `skin/frame.css`, `shells/scrittoio/frame/status-band.ts` | T14, T55 |
| tabelle, fogli e schede vive nella nota (righe 699, 748) | `skin/live-cards.css` (nuovo), `skin/tabella.css`, l'ospite delle schede in `editors/core/cards/` (nuovo) | T41–T49, T53 |
| gesti e moto della tabella (righe 861, 884) | `skin/tabella.css`, `apps/client/src/tabella/`, `docs/product/editor-tables.md` (nuovo) | T50, T51 |
| il diagramma, il suo menu, a tutto schermo (righe 900, 938, 955) | `skin/diagrams.css` (nuovo), `skin/menus.css`, `apps/client/src/ui/mermaid.ts` | T57, T58, T59 |
| le formule (righe 968, 1021) | `skin/math.css` (nuovo), `markdown/math-live.ts`, `markdown/math/` (nuovo) | T60–T66 |
| l'esportatore in PDF: pagine, tipografia, guide, pannello (righe 1040–1213) | `skin/export.css` (nuovo), `apps/client/src/export/` (nuovo) | T70–T76 |
| la lingua dei menu: tessera, riga, etichetta, scelta, piede, il moto (righe 1214, 1269) | `skin/menus.css`, `skin/kit.css`, `apps/client/src/ui/menu.ts`, `apps/client/src/kit/` | T81, T83 |
| la riga con le scelte accanto e la barra degli appunti (righe 1304, 1317) | `skin/menus.css`, `apps/client/src/ui/menu.ts` | T81 |
| testi dei trenta passi e delle voci | `i18n/catalog.ts`, `i18n/lexicon.ts`, `markdown/strings.ts` | ogni task grafico |
| stati: a riposo, al passaggio, a richiesta, vuoto, errore, al telefono | `apps/client/bench/scene.mjs`, `bench/motion.mjs` | ogni task grafico |

## T1 · Il primo blocco si solleva senza la testata

Perché: trascinando il primo blocco di una nota senza frontmatter sale anche
la testata (E2, «La correzione di oggi»): `liftUp()`
(`blocks/handles.ts`) e `visibleBoxes()` (`blocks/motion.ts`) scelgono per
posizione, e la testata è un widget ancorato a 0 con `side: -1`
(`blocks/page.ts`).
Tocca: `apps/client/src/editors/text/profiles/markdown/blocks/handles.ts`,
`blocks/motion.ts` e `motion.test.ts`, `blocks/move.ts` e `move.test.ts`,
`blocks/blocks.dom.test.ts`, `docs/product/editor-blocks.md`.
Non toccare: `blocks/page.ts` (la testata la rifà T6); il modello del
trascinamento nuovo (T2a); `livepreview.ts`.
Dipende da: nessuno (va prima di S2, in una PR sua: l'artifact lo permette)
Cosa fare:
- `liftUp()` e `visibleBoxes()` scelgono le righe per appartenenza al
  tratto del blocco, non per posizione: la testata, la riga dei dati e ogni
  widget di un altro blocco restano fermi.
- Il frontmatter resta il primo blocco: non si trascina sotto un altro
  blocco e nessun blocco gli va sopra.
- Il test DOM col primo blocco senza frontmatter fallisce prima e passa
  dopo; lo stesso con frontmatter.
Dal prototipo: passo 3 («Il primo blocco si trascina da solo»).
Casi limite: nota senza frontmatter; nota col solo frontmatter; primo
blocco che è un titolo, una tabella, un recinto di codice; ultimo blocco;
un blocco solo; il moto ridotto.
Fatto quando: `blocks.dom.test.ts` col primo blocco senza frontmatter
fallisce su `main` e passa col task; i test di `move.ts` e `motion.ts`
dicono che nessuna riga fuori dal tratto si muove.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks
Stato: [~] in corso · ramo `coder/editor-t1` (35727014f, «fix(blocchi):
Alt+↑/↓ e Mod+D non spostano il corpo dentro il frontmatter», sopra 6ddc11951
«il frontmatter resta il primo blocco»), copia di lavoro `wip/editor-t1`
(ef01eba04, da `main` 90ab04599); la PR verso `main` si chiamerà
`fix/blocchi-solleva-solo-il-blocco`.

## T2 · I gesti ai bordi, con scene e test

Perché: E2 e E18: ogni gesto dei blocchi deve reggere ai bordi della nota e
in ogni forma di blocco, e ogni gesto ha la sua scena del banco col moto
pieno e ridotto.
Tocca: `apps/client/src/editors/text/profiles/markdown/blocks/blocks.dom.test.ts`,
`blocks/keys.ts` e `blocks/move.ts` (solo le correzioni che i test
trovano), `apps/client/bench/motion.mjs`, `apps/client/bench/motion-rules.mjs`,
`apps/client/bench/scene.mjs`, `docs/product/editor-blocks.md`.
Non toccare: il modello del trascinamento (T2a, T2b: qui si prova e si
correggono i difetti, non si ridisegna); `blocks/page.ts`.
Dipende da: T2b, T5
Cosa fare:
- Un test per ogni caso limite di E2: primo e ultimo blocco, con e senza
  frontmatter; voce annidata; dentro e fuori dalle colonne (`[!columns]`);
  codice, tabella, riquadro; Vim fuori dal modo inserimento (Esc resta di
  Vim); IME in corso (i tasti dei blocchi si fanno da parte); blocchi
  spenti (`editor.blocks`).
- Una scena di `bench:motion` per ogni voce dell'elenco del trascinamento
  di E2: la presa di un blocco basso e di uno alto, il passaggio accanto a
  un blocco alto (avanti e indietro senza tremolio), «Accanto», l'annidare
  e lo staccare in un elenco, il cartellino fuori dalla colonna, lo
  scorrimento al bordo, il rilascio, Esc, Ctrl Maiusc ↑↓; ognuna col moto
  pieno e col moto ridotto.
- `motion-rules.mjs` controlla che per fotogramma cambino solo `transform`
  e `opacity`.
Dal prototipo: passi 2, 3 e 24.
Casi limite: quelli dell'elenco; una nota di un blocco solo; due riquadri
sulla stessa nota (il trascinamento in uno, l'altro si aggiorna a fine
gesto); dentro una scheda di nota della lavagna (A-6, regola 3).
Fatto quando: ogni voce dell'elenco di E2 ha il suo test e la sua scena;
`npm run bench:motion` passa nei due moti; la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks && FUB_BENCH_PORT=1460 npm run
bench:motion
Stato: [ ] da fare

## T2a · La maniglia a due occhi e il blocco in mano

Perché: E2, «La maniglia» e «Il trascinamento»: il modello è uno solo, il
blocco in mano resta compatto e il posto si apre sotto di lui; niente riga
d'inserimento, niente copia grande che copre l'arrivo. L'artifact lo
specifica senza un task suo: è la parte grande di T2 (A-3).
Tocca: `apps/client/src/editors/text/profiles/markdown/blocks/handles.ts`,
`blocks/motion.ts` e `motion.test.ts`, `blocks/move.ts` e `move.test.ts`,
`blocks/place.ts` e `place.test.ts` (nuovi: la regola del posto, senza DOM),
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`, il disegno degli
occhi fra le icone della shell (`apps/client/src/shells/scrittoio/icons.ts`),
`markdown/strings.ts`, `docs/product/editor-blocks.md`.
Non toccare: il cartellino fuori dalla colonna e lo scorrimento al bordo
(T2b); `blocks/page.ts`; `livepreview.ts`.
Dipende da: T1, T3; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`)
Cosa fare:
- La maniglia: i due occhi del marchio, due punti affiancati. A riposo non
  c'è; al passaggio sul blocco compare tenue accanto al «+»; col puntatore
  sopra prende l'accento e cresce appena; presa, gli occhi si socchiudono
  in due archetti e restano così finché il blocco è in mano. Bersaglio di
  24 × 24 px. Etichetta «Trascina per spostare, clic per il menu». «+» e
  maniglia stanno sempre a sinistra di ciò che si vede: una scheda più
  larga della colonna li sposta col suo bordo, allineati alla sua testata.
- La presa: dopo 4 px di movimento dalla maniglia; al tocco dopo 300 ms di
  pressione. Più blocchi scelti si prendono insieme e il blocco in mano ne
  dice il numero.
- Il blocco in mano è il blocco vero, largo com'era, mai più alto di
  104 px: oltre si taglia con una sfumatura e porta il suo nome («Base»,
  «Tabella»). La maniglia resta sotto il puntatore. Un'ombra; se corre di
  lato si inclina al più di un grado.
- Alla presa: niente si muove se il blocco è basso; se è alto il suo spazio
  si stringe a 104 px e ciò che sta sotto sale, ciò che sta sopra e il
  punto sotto il puntatore restano fermi.
- Il posto: uno spazio alto quanto il blocco in mano, fondo d'accento
  leggero; i vicini scivolano per aprirlo; sull'origine il fondo è grigio.
  `place.ts` decide: il posto cambia quando il centro del blocco in mano
  supera il centro di un vicino, e per tornare bisogna ripassare quel
  centro (nessun tremolio sui confini, nemmeno accanto a un blocco alto).
- In orizzontale il blocco segue il puntatore per un terzo, fino a 28 px.
  In un elenco 24 px a destra annidano sotto la voce sopra, 24 a sinistra
  portano fuori. Sull'ultimo ottavo a destra o a sinistra di un blocco il
  posto diventa una barra verticale: «Accanto», cioè le colonne di oggi.
- L'etichetta nell'angolo in basso a destra del blocco in mano, solo quando
  serve: «in «I conti»» se il posto è in un'altra sezione.
- Il moto: presa 240 ms (cresce dell'1,5%, l'ombra si forma, una molla
  appena accennata); in mano segue in due o tre fotogrammi, con una
  calamita di pochi pixel vicino al posto; i vicini scivolano in 300 ms con
  una molla che supera di un paio di pixel; la posa in 340 ms, poi niente
  (nessun alone, nessun colore). Al tocco un colpetto aptico alla presa e
  alla posa, se il sistema lo offre.
- Il rilascio posa dov'è il posto, mai dov'è il puntatore; un passo
  d'annullamento; Esc o il rilascio fuori da un bersaglio rimettono il
  blocco dov'era con lo stesso moto. Ctrl Maiusc ↑↓ sposta con lo stesso
  moto. A ogni cambio di posto si annuncia «Posizione 4 di 14, in «I
  conti»».
- Il costo: i rettangoli si misurano una volta alla presa e di nuovo solo
  se cambia la parte montata da CodeMirror; per fotogramma solo
  `transform` e `opacity`; il documento cambia solo al rilascio, in una
  transazione. Col moto ridotto il posto compare e il blocco si posa senza
  volo.
Dal prototipo: righe 460, 828, 853; passi 2 e 3.
Casi limite: blocco più alto della finestra; il primo e l'ultimo blocco;
una scheda più larga della colonna (resta intera in mano); più blocchi
scelti non contigui; il trascinamento interrotto da una perdita di fuoco
(torna all'origine); la nota cambiata da fuori durante il gesto (si
annulla il gesto, il testo nuovo vince); dentro una scheda di nota della
lavagna (A-6, regola 3).
Fatto quando: `place.test.ts` prova la regola del posto con vicini bassi e
alti, avanti e indietro, senza tremolio; i test DOM provano presa, posa,
Esc e l'annuncio; le foto del banco, chiaro e scuro, somigliano alle righe
828 e 853 del prototipo; la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks
Stato: [ ] da fare

## T2b · Fuori dalla colonna e lo scorrimento al bordo

Perché: E2, «Fuori dalla colonna» e «Lo scorrimento»: gli spostamenti
lunghi senza scorrere, e una pagina che scorre solo quando la si chiede.
Tocca: `apps/client/src/editors/text/profiles/markdown/blocks/handles.ts`,
`blocks/motion.ts`, `blocks/autoscroll.ts` e `autoscroll.test.ts` (nuovi),
`blocks/drop-targets.ts` e `drop-targets.test.ts` (nuovi),
`apps/client/src/editors/core/registry.ts` (la porta dei bersagli esterni),
la Struttura nella shell che la rende (`apps/client/src/ui/views.ts`, solo
l'attributo che dice il titolo di ogni riga), `skin/editors.css`,
`anatomia/editors.ts`, `markdown/strings.ts`, `docs/product/editor-blocks.md`.
Non toccare: «Sposta in…» verso un'altra nota (T32: il cassetto come
bersaglio); la lavagna a lato come bersaglio (T48); `blocks/place.ts`
(T2a).
Dipende da: T2a; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- Oltre 90 px dal testo il blocco si stacca e diventa un cartellino largo
  al più 250 px, appeso sotto il puntatore; il posto torna all'origine.
- `drop-targets.ts`: un elenco di bersagli fuori dalla colonna, ognuno col
  suo rettangolo, la sua etichetta e la sua azione; la shell li offre con
  una porta di `editors/core/registry.ts` (nessun import del DOM della
  shell nell'editor). Qui il solo bersaglio sono i titoli della Struttura
  della stessa nota: «In fondo a …», che sposta il blocco in fondo alla
  sezione in un passo d'annullamento. T32 e T48 aggiungono il cassetto e la
  lavagna.
- Lo scorrimento: entro 72 px dal bordo alto o basso del foglio; velocità
  col quadrato della profondità fino a circa 800 px/s, raggiunta in mezzo
  secondo; sfiorare il bordo non fa partire la pagina; il blocco in mano
  non esce mai dalla parte visibile. `autoscroll.ts` è senza DOM e si prova
  da solo.
- Il cartellino porta il nome del bersaglio; l'annuncio lo dice.
Dal prototipo: riga 828 (il cartellino); passo 3.
Casi limite: Struttura chiusa (nessun bersaglio, il cartellino torna
indietro al rilascio); il titolo della Struttura che è il blocco in mano;
nota lunghissima con lo scorrimento che arriva in fondo; moto ridotto (lo
scorrimento resta, senza volo); finestra a 700 px.
Fatto quando: `autoscroll.test.ts` prova soglia, curva e tetto; un test DOM
sposta un blocco sotto un altro titolo dalla Struttura e l'annulla lo
rimette; le scene di T2 trovano il cartellino.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks
Stato: [ ] da fare

## T3 · La modalità Scrittura

Perché: D1 A, E1: una modalità sola per scrivere. Oggi Live e Blocchi
scrivono allo stesso modo e solo i Blocchi hanno maniglie e testata
(`markdown/surface.ts`, le quattro modalità).
Tocca: `apps/client/src/editors/text/profiles/markdown/surface.ts`,
`markdown/profile.ts`, `apps/client/src/editors/core/surface-modes.ts`,
`apps/client/src/state/mode-menu.ts` e `mode-menu.test.ts` (da S2 T2),
`apps/client/src/state/document-controller.ts`,
`apps/client/src/desktop-shell.ts`, `apps/client/src/ui/app-menu.ts`,
`apps/client/src/surface-modes.e2e.test.ts`, `markdown/surface.test.ts`,
`apps/client/src/i18n/lexicon.ts`, `markdown/strings.ts`,
`apps/client/bench/scene.mjs` (la scena «a riposo»),
`apps/client/bench/interaction.mjs` (la battuta misura Sorgente e
Scrittura: `blocks` esce dalle modalità),
`docs/product/editor-writing.md` (nuovo),
`docs/product/editor-and-preview.md` (le modalità passano nella pagina
nuova), `docs/README.md`.
Non toccare: `crates/fub-host/src/settings.rs` e i comandi della shell
(T4); la preferenza dei blocchi (T5); `PaneMode` e la WIT (il ruolo resta
`PaneMode::LivePreview`).
Dipende da: T23, S2 in `main`
Cosa fare:
- Le modalità del profilo Markdown diventano Scrittura, Sorgente e Lettura.
  Scrittura usa l'id `live_preview` di oggi e monta dentro i blocchi
  (maniglie, testata, selezione di blocchi) come fanno oggi i Blocchi.
  `blocks` non è più una voce: un riquadro o un comando che la chiede
  ottiene Scrittura (T4 fa lo stesso per impostazioni e comandi).
- Il menu della banda (S2 T2, `state/mode-menu.ts`): Scrittura, Sorgente
  e, dopo il separatore, Lettura.
- La rivelazione dei segni resta `editor.live-reveal`, mai di serie.
- I tre livelli di presenza: ogni elemento del foglio che compare al
  passaggio o a richiesta porta `data-presence="hover"` o `"request"`; la
  scena «a riposo» del banco controlla che a riposo non si veda nessuna
  maniglia né pulsante sul foglio. Un elemento al passaggio non sposta mai
  il testo quando compare.
- I test di Live e di Blocchi passano su Scrittura; quelli che provavano
  una differenza fra le due si riscrivono sul comportamento di Scrittura.
- La parola «Scrittura» entra nel lessico (A-12);
  `docs/product/editor-writing.md` descrive la modalità, i tre livelli e le
  tre porte («Il disegno», regole 1 e 2), e `editor-and-preview.md` la
  rimanda lì.
Dal prototipo: passi 1, 2 e 26; la banda (riga 637).
Casi limite: una nota in due riquadri, uno in Scrittura e uno in Sorgente;
la sola lettura (tutto spento, Lettura possibile); un riquadro salvato in
`blocks` (si apre in Scrittura); una nota che non è Markdown (le sue
modalità non cambiano); dentro una scheda di nota della lavagna (A-6,
regola 3).
Fatto quando: il menu ha tre voci; `surface-modes.e2e.test.ts` e
`mode-menu.test.ts` lo provano; i test di Live e Blocchi passano su
Scrittura; la scena «a riposo» è verde; la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown src/state/mode-menu.test.ts
src/surface-modes.e2e.test.ts
Stato: [ ] da fare

## T4 · Impostazioni e comandi vecchi portano a Scrittura

Perché: E1: chi aveva scelto Live o Blocchi non deve accorgersi di niente:
valori e scorciatoie della persona restano.
Tocca: `crates/fub-host/src/settings.rs` (`EDITOR_DEFAULT_MODE` e le sue
opzioni), `crates/fub-host/src/shell.rs` (`SHELL_COMMANDS`: i titoli di
`shell.mode.live` e `shell.mode.blocks`),
`apps/client/src/ui/shell-keys.generated.ts` e il mirror degli id
(rigenerati con `UPDATE_MIRROR=1 cargo test -p fub-host --test
shell_ids_mirror --test shell_keys_mirror`),
`apps/client/src/state/document-controller.ts` (i due comandi), il punto
dove si ripristina la modalità di un riquadro salvato (`state/layout.ts`,
da verificare cercando `"blocks"`), i test di `settings.rs`,
`docs/product/editor-writing.md`.
Non toccare: gli id dei comandi (`shell.mode.live`, `shell.mode.blocks`
restano); il valore scritto nelle impostazioni (non si riscrive);
`PaneMode`.
Dipende da: T3
Cosa fare:
- `editor.default-mode` legge `live_preview` e `blocks` come Scrittura e non
  riscrive il valore; le opzioni mostrate diventano Scrittura, Sorgente,
  Lettura (l'opzione `blocks` resta valida in lettura, nascosta).
- `shell.mode.live` e `shell.mode.blocks` portano tutti e due a Scrittura;
  le scorciatoie della persona (anche Mod-Shift-b di oggi) restano dove
  sono e fanno ciò che il loro titolo nuovo dice.
- Un riquadro salvato in `blocks` si riapre in Scrittura.
Casi limite: un valore sconosciuto in `editor.default-mode` (vale il
predefinito, come oggi); un comando chiamato via MCP con l'id vecchio; una
scorciatoia personale su `shell.mode.blocks`.
Fatto quando: un test di `settings.rs` legge `blocks` come Scrittura e il
file delle impostazioni resta byte per byte; i mirror sono rigenerati e
verdi; un test del controller prova i due comandi.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-host settings
Stato: [ ] da fare

## T5 · I blocchi come preferenza

Perché: D1 A, E2: i blocchi sono una preferenza (`editor.blocks`, accesa di
serie); accesi l'editor è come Notion, spenti come un editor di testo. La
tabella dei gesti dell'artifact è normativa.
Tocca: `crates/fub-host/src/settings.rs` (la chiave `editor.blocks`),
`apps/client/src/editors/text/profiles/markdown/surface.ts` (montare i
blocchi secondo la chiave), `blocks/keys.ts`, `blocks/selection.ts`, i loro
test, il menu «…» della testata del riquadro (dove si costruisce oggi:
`apps/client/src/panels/document.ts`, da verificare), `markdown/strings.ts`,
`docs/product/editor-blocks.md`, `docs/product/editor-writing.md`.
Non toccare: il trascinamento (T2a, T2b); `blocks/page.ts` (la testata
resta anche coi blocchi spenti: non è un blocco).
Dipende da: T4; mai con un task di un altro piano su `settings.rs`
Cosa fare:
- La chiave `editor.blocks` (booleana, accesa), nelle Impostazioni e nel
  menu «…» della testata del riquadro; cambia senza riaprire la nota.
- La tabella, nei due stati (accesi / spenti):
  - maniglia e «+»: al passaggio e sul blocco del cursore / non ci sono;
  - Ctrl A: la prima volta il testo del blocco, la seconda tutti i blocchi
    (selezione di blocchi) / il corpo della nota dal primo all'ultimo
    blocco, titolo e proprietà fuori; un secondo Ctrl A non fa altro;
  - Esc: seleziona il blocco del cursore, ↑ ↓ scelgono, Maiusc allarga /
    chiude ciò che è aperto; con Vim resta di Vim;
  - Ctrl Maiusc ↑ ↓: sposta il blocco o la selezione di blocchi / sposta la
    riga o le righe scelte;
  - Ctrl D: duplica il blocco / la prossima occorrenza (multi-cursore);
  - trascinare: dalla maniglia, solo il blocco / il testo scelto, come oggi;
  - «/» e menu del blocco: ci sono / il «/» c'è, «Trasforma in» sta nel
    tasto destro.
Dal prototipo: passo 24 («Blocchi spenti»).
Casi limite: cambiare la chiave con una selezione di blocchi attiva (si
riduce a una selezione di testo); Vim acceso; IME in corso; nota senza
frontmatter (Ctrl A prende tutto); nota col solo frontmatter (Ctrl A non
prende niente e non si rompe); dentro una scheda di nota della lavagna
(A-6, regola 3).
Fatto quando: un test per riga della tabella, nei due stati, passa;
cambiare la chiave non riapre la nota; la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks; cargo nextest run -p fub-host
settings
Stato: [ ] da fare

## T6 · La testata in Scrittura e Lettura

Perché: D2 A, E3: copertina, icona, titolo e proprietà in evidenza stanno
in testa alla pagina, uguali in Scrittura e Lettura; oggi solo i Blocchi
hanno una testata e la Live mostra l'H1.
Tocca: `apps/client/src/editors/text/profiles/markdown/page/` (nuovo:
`header.ts`, `cover.ts`, `featured.ts` e i loro test),
`markdown/blocks/page.ts` (passa in `page/` e resta un adattatore),
`markdown/surface.ts` (la testata anche in `renderReading`),
`markdown/render.ts` se la Lettura la chiede,
`apps/client/src/theme/scrittoio/skin/document.css`,
`apps/client/src/theme/scrittoio/anatomia/document.ts`,
`markdown/strings.ts`, `apps/client/bench/scene.mjs`,
`docs/product/editor-writing.md`.
Non toccare: il titolo come nome del file e l'H1 ripiegato (T7); gli
editor dei valori (T8); `state/note-facts.ts` (la riga dei dati è di S2
T12: qui si posa soltanto).
Dipende da: T3; mai con un task di un altro piano su `skin/document.css`
Cosa fare:
- In Scrittura e in Lettura, in quest'ordine: copertina, icona, titolo,
  proprietà in evidenza, «Altre N proprietà», «Aggiungi una proprietà»,
  poi la riga dei dati (S2 T12). In Sorgente il frontmatter com'è.
- `editor.properties`, che c'è già, resta la scelta della persona:
  `visible` è la testata qui sopra, `hidden` la testata col solo «Altre N
  proprietà», `source` il YAML sotto il titolo. Il valore scritto non
  cambia.
- Le proprietà in evidenza: senza tipo, le prime quattro del frontmatter;
  col tipo, quelle del tipo (T33 lo aggiunge).
- La copertina è alta 112 px (88 al telefono). Icona e copertina si
  scelgono al passaggio del puntatore («Cambia copertina», «Riposiziona»,
  «Aggiungi una descrizione», «Commenta la pagina»), mai da pulsanti a
  riposo; si scrivono dove li scrive oggi la testata dei Blocchi e
  `state/page-icons.ts` di S2.
- Da tastiera: ↓ dal titolo entra nelle proprietà e poi nel testo; ↑ dalla
  prima riga torna su.
- La densità della pre-alpha vale anche qui: in «Compatta» righe delle
  proprietà e spazi della testata più fitti.
- Sul disco solo le toppe mirate di oggi: commenti e ordine del YAML
  restano; aprire e chiudere non cambia un byte.
Dal prototipo: righe 274 e 294; passi 1, 2 e 4.
Casi limite: nota senza frontmatter; frontmatter illeggibile (resta il
blocco `frontmatter-unparsed` e la testata lo dice); copertina che non si
trova; trenta proprietà; un nome di proprietà lunghissimo; sola lettura;
finestra a 700 px e al telefono; dentro una scheda di nota della lavagna
(A-6, regola 3).
Fatto quando: i test DOM della testata passano nelle due modalità; il
corpus Markdown torna byte per byte dopo aprire e chiudere; le foto del
banco, chiaro e scuro, a 700 px e al telefono, somigliano alla riga 274;
la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/page
src/editors/text/profiles/markdown/corpus.test.ts
Stato: [ ] da fare

## T7 · Il titolo e il primo H1

Perché: D2 A, E3: il titolo è il nome del file; un primo H1 uguale si
ripiega nel titolo, così non ci sono due titoli.
Tocca: `apps/client/src/editors/text/profiles/markdown/page/title.ts` e
`title.test.ts` (nuovi), `markdown/livepreview.ts` (nascondere l'H1
ripiegato), `markdown/render.ts` (lo stesso in Lettura),
`apps/client/src/shells/scrittoio/sheets/title-rename.ts` e il suo test
(S2), `markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: il comando di rinomina del core (si usa com'è); il file
quando si apre (non cambia mai).
Dipende da: T6
Cosa fare:
- Il titolo è il nome del file, quello della cartella per `_index.md`.
  Invio o l'uscita dal campo rinominano il file coi link (il comando di
  oggi); Esc torna al nome di prima.
- Il primo H1: se, a parte maiuscole, spazi e punteggiatura, è uguale al
  nome, si ripiega nel titolo e in Scrittura e Lettura non si vede. Il file
  non cambia. Se è diverso resta un titolo del testo.
- Rinominare dal titolo una nota con l'H1 ripiegato riscrive anche l'H1 col
  nome nuovo, nello stesso gesto (A-15): un passo d'annullamento della nota;
  se la rinomina fallisce, l'H1 non cambia.
- La regola del confronto è una funzione pura in `title.ts`.
Casi limite: H1 con formattazione (`# **Mostra** di primavera`); H1 dopo
un commento `%%`; H1 non in cima; nota senza frontmatter; frontmatter
illeggibile; un nome con caratteri che il file system rifiuta (la rinomina
lo dice e il titolo torna); un nome già preso; sola lettura (il titolo non
si modifica); la rinomina che arriva da fuori mentre si scrive il titolo.
Fatto quando: `title.test.ts` prova la regola coi casi limite; un test DOM
prova Invio, Esc, il ripiegamento e la rinomina con l'H1; il corpus torna
byte per byte.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/page
src/shells/scrittoio/sheets/title-rename.test.ts
Stato: [ ] da fare

## T8 · Le proprietà con l'editor del tipo

Perché: E4: una riga per proprietà, e il clic sul valore apre l'editor del
suo tipo; oggi le proprietà stanno lontane dalla pagina.
Tocca: `apps/client/src/editors/text/profiles/markdown/page/properties/`
(nuovo: `row.ts`, `editors.ts`, `menu.ts` e i test),
`markdown/properties.ts` (passa lì e resta un adattatore),
`skin/document.css`, `anatomia/document.ts`, `markdown/strings.ts`,
`apps/client/bench/scene.mjs`, `docs/product/editor-writing.md`.
Non toccare: `crates/fub-features/src/properties/*` (si usano
`note.property.set` e `remove` come sono); Selezione e Stato (T9); la data
a parole (T10); la Relazione (T35).
Dipende da: T6; mai con un task di un altro piano su `skin/document.css`
Cosa fare:
- Una riga per proprietà: icona del tipo, nome, valore. Il clic sul valore
  apre l'editor del tipo; il clic sul nome apre Rinomina, Tipo, In
  evidenza, Togli.
- Gli editor dei sette tipi di oggi: testo, numero (in riga; un valore che
  non è un numero resta quello di prima e lo dice), casella, data e data e
  ora (il mese e i giorni rapidi; T10 aggiunge le parole), lista, persone
  (scelta multipla di note con la ricerca, il valore è una lista di link).
- Ogni modifica è un passo d'annullamento, con `note.property.set` e
  `note.property.remove` e la revisione.
- «In evidenza»: su una nota senza tipo porta la proprietà fra le prime
  quattro del frontmatter (A-15); con un tipo lo fa T33.
- Ogni editor si usa tutto da tastiera e col puntatore; la densità vale.
Dal prototipo: righe 294 e 508; passo 4.
Casi limite: un valore fuori dal tipo dichiarato (resta testo, segnato);
due note con lo stesso nome di proprietà e tipi diversi (vale il
registro); la revisione cambiata mentre l'editor è aperto (il conflitto lo
dice, il valore scritto non si perde); sola lettura; una lista di cento
voci; dentro una scheda di nota della lavagna (A-6, regola 3).
Fatto quando: un test per editor, da tastiera e col puntatore; un e2e
modifica una proprietà e la rilegge dal file; le foto del banco somigliano
alla riga 294.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/page
Stato: [ ] da fare

## T9 · Selezione e Stato: gli editor e la Bacheca per Stato

Perché: E4: Selezione e Stato coi nove colori dei Blocchi, lo Stato a
gruppi; la Bacheca della Base si divide per Stato.
Tocca: `markdown/page/properties/editors.ts` e il suo test,
`apps/client/src/editors/base/surface.ts` e `editors/base/data.ts` (le
corsie dello Stato), i loro test, `skin/document.css`, `markdown/strings.ts`,
`docs/reference/property-types.md`.
Non toccare: il contratto (T9a); il registro su disco oltre ciò che T9a
permette.
Dipende da: T8, T9a, T15
Cosa fare:
- Selezione e Stato: le opzioni coi nove colori dei Blocchi
  (`--doc-color-*`, `--doc-tint-*`); lo Stato le raggruppa in Da fare, In
  corso, Fatto; si crea un'opzione scrivendola (scrive nel registro col
  comando di T9a).
- Url: un link che si apre col clic e si modifica con la matita.
- Un valore fuori dalle opzioni resta testo, segnato.
- La Bacheca della Base su una proprietà di tipo Stato: le corsie nei tre
  gruppi e nell'ordine delle opzioni; trascinare una scheda in un'altra
  corsia scrive lo stato nella nota, con la revisione.
Dal prototipo: riga 508; passi 4 e 13.
Casi limite: un registro illeggibile (le opzioni non si creano e lo dice);
un'opzione rinominata nel registro (i valori vecchi restano testo
segnato); due proprietà Stato nella stessa Base; un colore sconosciuto
(grigio).
Fatto quando: test degli editor da tastiera; un test della Base prova le
corsie e lo spostamento che scrive lo stato; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/page src/editors/base
Stato: [ ] da fare

## T9a · Selezione, Stato e Url nel contratto

Perché: E4, «Contratti»: `PropertyType` prende Select, Status e Url; le
opzioni, i colori e i gruppi stanno nel registro del vault.
Tocca: `crates/fub-abi/src/model/property.rs`,
`crates/fub-abi/tests/ts_enums.rs` (se serve un caso),
`apps/client/src/host/enums.generated.ts` (rigenerato),
`crates/fub-kernel/src/properties.rs`,
`crates/fub-features/src/properties/commands.rs`,
`crates/fub-features/src/properties/view.rs`,
`crates/fub-features/src/properties/catalog.rs`,
`docs/reference/property-types.md` (nuovo), `docs/README.md`.
Non toccare: `crates/fub-abi/wit/` (il tipo non c'è, verificato);
`writable_property_types` (rifiuta di riscrivere un registro illeggibile:
resta così).
Dipende da: nessuno (prima di S2: nessun file in comune)
Cosa fare:
- `PropertyType` prende `select`, `status`, `url`: additivo.
- Il registro `PropertyTypes` (versione 1) prende per proprietà un campo
  facoltativo `options` (nome, colore fra i nove, e per lo Stato il gruppo
  fra `todo`, `doing`, `done`), saltato quando è vuoto: un registro senza
  opzioni si scrive byte per byte come oggi (A-9).
- La proiezione tipizzata: un valore Select o Status è il testo
  dell'opzione, con l'opzione trovata o «fuori dalle opzioni»; Url è un
  testo.
- Un comando per aggiungere, rinominare e colorare un'opzione, con la
  revisione e l'annulla, che non scrive un registro illeggibile o di una
  versione futura.
- Il mirror TS si rigenera con `UPDATE_MIRROR=1`.
Casi limite: un registro di una versione futura (non si riscrive); un
registro con opzioni riscritto per un'altra proprietà (le opzioni
restano); due opzioni con lo stesso nome; un colore sconosciuto; un valore
YAML che non è testo.
Fatto quando: test della proiezione coi casi limite; un test che il
registro futuro non si riscrive; un test byte per byte del registro senza
opzioni; il mirror è verde.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-abi -p
fub-kernel -p fub-features properties
Stato: [ ] da fare

## T10 · La data a parole nelle proprietà

Perché: E4: la data si scrive come la si dice («venerdì», «fra due
settimane», «20 marzo», «3/4»), con la stessa regola delle date di @.
Tocca: `apps/client/src/state/dates.ts` e il suo test,
`markdown/dates.ts` (se la regola sta lì: una sola, condivisa),
`markdown/page/properties/editors.ts` (l'editor della data),
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: il formato delle date sul disco (quello di oggi, letto da
`date_formats`).
Dipende da: T9
Cosa fare:
- Il campo dell'editor della data capisce le parole con la regola di @
  (una funzione sola, usata dai due).
- «Aggiungi l'ora» passa a data e ora.
- Una data che non si capisce resta scritta nel campo e lo dice; il valore
  di prima non cambia.
Dal prototipo: passo 5.
Casi limite: «31/2»; un anno a due cifre; «fra 0 giorni»; l'inglese con
la lingua inglese; il fuso.
Fatto quando: un test della regola condivisa con le parole dell'artifact
e i casi limite; un test DOM dell'editor.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/dates.test.ts src/editors/text/profiles/markdown/page
Stato: [ ] da fare

## T11 · La barra che segue il blocco, «Inserisci», `editor.toolbar`

Perché: E8: oggi la barra di formato ha icone senza nome, uguali per ogni
blocco (`panels/format-bar.ts`). Deve dire dove sta il cursore, portare il
gruppo del blocco e «+ Inserisci».
Tocca: `apps/client/src/panels/format-bar.ts` e il suo test,
`apps/client/src/editors/core/registry.ts` (la porta facoltativa
`blockGroup(at)` della superficie, accanto a `contextMenu(at)`),
`apps/client/src/editors/text/profiles/markdown/block-groups.ts` e
`block-groups.test.ts` (nuovi: i gruppi del profilo Markdown coi comandi che
già esistono), `markdown/surface.ts` (solo l'aggancio della porta),
`crates/fub-host/src/settings.rs` (`editor.toolbar`),
`apps/client/src/desktop-shell.ts` (il comando che mostra e nasconde la
barra), `apps/client/src/theme/scrittoio/skin/menus.css`,
`apps/client/src/theme/scrittoio/anatomia/` (il file dei menu),
`markdown/strings.ts`, `apps/client/bench/scene.mjs`,
`docs/product/editor-writing.md`.
Non toccare: la WIT e `CommandSpec` (A-9: il gruppo lo dichiara la
superficie); `crates/fub-features/src/formatting.rs` (i comandi restano
quelli); la mini-barra (T12); il gruppo «Diagramma» (T57) e quelli delle
schede (T41).
Dipende da: T3, T84; mai con un task di un altro piano su `skin/menus.css`
o `settings.rs`
Cosa fare:
- La barra compatta: annulla e ripeti; lo stile del blocco, che dice dove
  sta il cursore («Testo», «Titolo 2», «Compito») e apre «Trasforma in»;
  grassetto, corsivo, link, elenco, compito; a destra «+ Inserisci», che
  apre gli stessi blocchi del «/» (T84) in un menu coi nomi.
- Accanto, il gruppo del blocco del cursore, col suo nome: Compito
  (Scadenza; Promemoria arriva con T36), Riquadro (tipo, ripiegabile),
  Base (a tutta pagina), Trasclusione (apri l'origine; con T29), Tabella,
  Codice (lingua, copia), Immagine (larghezza, didascalia). Li dichiara la
  superficie con `blockGroup(at)`: un elenco di id di comandi che già
  esistono e un nome. **Differenza dall'artifact**: niente campo nuovo nella
  spec del comando (A-9); un plugin entra nella barra generale come oggi.
- Il gruppo non si perde quando il fuoco va in un menu della barra; cambia
  solo quando cambia il blocco, dopo una pausa breve (niente lavoro per
  battuta). Il gruppo nuovo si annuncia una volta.
- Un solo arresto di Tab per la barra, le frecce di `kit/toolbar-keys.ts`
  (S2 T17).
- `editor.toolbar`: `compatta` (di serie), `completa` (la fila di oggi),
  `nascosta` (resta la mini-barra, con `editor.minibar` com'è). Una sola
  fonte: `chrome.formatbar.visible` spento, scritto da un Fub di prima, si
  legge come `nascosta` finché `editor.toolbar` non c'è, e non si
  riscrive; il comando del menu Vista alterna `nascosta` e l'ultima forma
  visibile.
Dal prototipo: riga 252; passi 6 e 7.
Casi limite: cursore fra due blocchi; selezione su più blocchi (nessun
gruppo); sola lettura (solo ciò che non scrive); finestra a 700 px (le voci
che non stanno vanno in «…»); al telefono (la barra sopra la tastiera di
oggi); un plugin con un comando nella barra; dentro una scheda di nota della
lavagna (A-6, regola 3).
Fatto quando: un test per gruppo; il test delle tre forme di
`editor.toolbar` e della lettura di `chrome.formatbar.visible`; le scene nelle
due luci, a 700 px e al telefono; `npm run bench:a11y` pulito; la battuta
resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/format-bar.test.ts
src/editors/text/profiles/markdown/block-groups.test.ts &&
FUB_BENCH_PORT=1460 npm run bench:a11y
Stato: [ ] da fare

## T12 · La mini-barra con Commenta e Colore

Perché: E8: sulla selezione la mini-barra scura con Trasforma, B, I, U, S,
codice, link, colore, Commenta.
Tocca: `apps/client/src/panels/mini-bar.ts` e il suo test,
`apps/client/src/panels/selection-bubble.ts` (se la mini-barra di testo
passa da lì: da verificare), `skin/menus.css`, `markdown/strings.ts`,
`docs/product/editor-writing.md`.
Non toccare: `markdown/color.ts` (si usa `setContentColor` com'è); i
comandi dei commenti (T22, si chiamano).
Dipende da: T11, T22
Cosa fare:
- In quest'ordine: Trasforma (lo stesso menu dello stile del blocco), B, I,
  U, S, codice, link, colore (i nove colori dei Blocchi, testo e fondo),
  Commenta.
- Ogni pulsante fa ciò che fa la scorciatoia: lo stesso comando, la stessa
  voce d'annullamento, e la scorciatoia vera della persona nel titolo.
- Commenta apre il primo messaggio della discussione (T22) sulla selezione.
- Se un menu le finirebbe sopra, la mini-barra si mette in testa al menu
  (E29).
Dal prototipo: riga 546; passo 9.
Casi limite: selezione su più blocchi (Commenta va nel primo, T21a);
selezione dentro codice o formula (Commenta disabilitato col perché);
selezione vuota; sola lettura; `editor.minibar` su `off`; Vim in modo
visuale; dentro una scheda di nota della lavagna (A-6, regola 3).
Fatto quando: un test per pulsante confronta il risultato con quello della
scorciatoia; le foto del banco nelle due luci.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/mini-bar.test.ts
Stato: [ ] da fare

## T13 · Ctrl O: prefissi, anteprima, azioni

Perché: E9: lo spazio comandi con sei ambiti, l'anteprima che cambia con la
specie e le azioni sul risultato.
Tocca: `apps/client/src/shells/scrittoio/launcher/model.ts`, `sources.ts`,
`actions.ts`, `preview.ts`, `commands.ts` e i loro test,
`apps/client/src/i18n/catalog.ts`, `docs/product/command-space.md` (nuovo:
lo spazio comandi oggi non ha una pagina), `docs/README.md`.
Non toccare: l'aspetto (T82: campo, tessere, banda); `ui/menu.ts` (T81);
`apps/client/src/panels/quick-switcher.ts` (la shell comune: nello
Scrittoio `shell.switcher` e `shell.palette` li prende il lanciatore, in
`launcher/commands.ts`);
`query_index` e `list_commands` (si usano come sono).
Dipende da: T23; la risposta a Q1 (fino ad allora vale la consigliata)
Cosa fare:
- Sei ambiti: Tutto, `>` Comandi, `#` Etichette, `@` Persone e giorni, `/`
  Blocchi, `?` Aiuto. Il prefisso scritto sceglie l'ambito; «Tutto» lo
  toglie. A campo vuoto: le note recenti e tre comandi per la nota aperta.
- I modi di oggi che perdono il prefisso restano raggiungibili (Q1,
  consigliata): la ricerca nel testo e i titoli della nota aperta sono
  gruppi di «Tutto»; `:` resta la riga; i modelli passano dal comando
  «Nuova nota da modello». Tab non cambia più modo: mostra le azioni.
- Invio apre; Ctrl Invio a lato; Alt Invio nella sbirciata (T20; prima di
  T20 apre a lato); Tab mostra le azioni (apri qui, a lato, sbircia,
  rinomina, sposta, copia il link, appunta); Esc torna dalle azioni, poi
  chiude.
- Niente trovato: lo dice e propone Maiusc Invio per creare la nota col
  nome scritto, o `>` per cercare fra i comandi.
- `?` elenca i tasti del contesto da cui si è aperto (T14 li fornisce;
  prima di T14 quelli dei comandi).
- L'anteprima non legge una nota a ogni freccia: una pausa breve, come oggi.
Dal prototipo: riga 558; passo 11.
Casi limite: un prefisso seguito da niente; un nome che comincia con `#`;
vault di diecimila note; una nota che sparisce mentre si guarda
l'anteprima; Maiusc Invio con un nome già preso o con caratteri rifiutati;
le scorciatoie personali; al telefono.
Fatto quando: un test per prefisso, per azione e per il niente trovato; un
test che l'anteprima non parte prima della pausa.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/shells/scrittoio/launcher src/panels/quick-switcher.dom.test.ts
Stato: [ ] da fare

## T14 · La riga dei suggerimenti

Perché: E6: al centro della banda i tasti utili per ciò che si sta facendo,
letti dalle scorciatoie vere; niente finestre che coprono il lavoro.
Tocca: `apps/client/src/shells/scrittoio/frame/status-band.ts` e il suo
test, `apps/client/src/shells/scrittoio/frame/hints-row.ts` e
`hints-row.test.ts` (nuovi: la porta dei suggerimenti),
`apps/client/src/editors/text/profiles/markdown/hints.ts` (il testo della
riga vuota), `crates/fub-host/src/settings.rs` (`editor.hints`),
`crates/fub-host/src/support.rs` (la nota d'esempio «Il giro dell'editor»
in `SEED_NOTES`), `skin/frame.css`, `markdown/strings.ts`,
`i18n/lexicon.ts`, `docs/product/editor-writing.md`.
Non toccare: `ui/commands.ts` (si leggono `allCommands()` e
`displayBinding` come sono); le superfici degli altri editor (ognuno
pubblica i suoi suggerimenti col suo task).
Dipende da: T3, T13; mai con un task di un altro piano su `settings.rs` o
`status-band.ts`
Cosa fare:
- `hints-row.ts` è la porta: chi ha il fuoco pubblica il suo contesto (riga
  vuota, selezione, compito, blocco scelto, Base, titolo, link, menu
  aperto) come elenco di id di comandi; la riga li scrive con
  `displayBinding`, quindi coi tasti della persona. Il «/», i menu (T81) e
  lo spazio comandi (T82) la usano per i loro tasti.
- Cambia dopo una pausa breve, non a ogni freccia; nessuna IPC.
- La riga vuota dice «Scrivi, oppure / per i blocchi e @ per persone e
  date».
- `editor.hints` (accesa) la spegne; non c'è al telefono né sotto i 620 px.
  È `aria-hidden`: i gesti si annunciano, la riga no.
- Il vault d'esempio ha «Il giro dell'editor», una nota con dieci cose da
  provare.
Dal prototipo: righe 619 e 637; passi 1 e 26.
Casi limite: una scorciatoia tolta dalla persona (la voce non compare);
due comandi sullo stesso tasto; la lingua inglese; un contesto senza
suggerimenti (la riga è vuota, la banda non salta); la somma della banda
(T55) che prende il posto.
Fatto quando: un test per contesto; un test che la riga segue una
scorciatoia cambiata; un test del vault d'esempio in `support.rs`; la scena
del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/shells/scrittoio/frame; cargo nextest run -p fub-host support
Stato: [ ] da fare

## T15a · Le toppe mirate del `.base`

Perché: E12, «Ogni gesto riscrive solo le chiavi toccate, con commenti e
ordine del YAML intatti». Oggi la Base non riscrive mai il suo file
(`editors/base/surface.ts`: «il file `.base` non si riscrive»): serve uno
scrittore prima dei gesti.
Tocca: `crates/fub-format-base/src/patch.rs` e il suo modulo di test
(nuovi), `crates/fub-format-base/src/lib.rs` (il modulo),
`crates/fub-format-base/tests/fixtures/` e
`crates/fub-format-base/tests/patch_corpus.rs` (nuovi: file `.base` veri,
scritti per la prova), `crates/fub-features/src/base.rs` (i comandi),
`crates/fub-features/tests/base_commands_e2e.rs` (nuovo),
`docs/product/bases.md` (nuovo), `docs/README.md`.
Non toccare: `model.rs` oltre ciò che la toppa chiede (i tipi di vista nuovi
sono di T17a); la superficie (T15).
Dipende da: nessuno (prima di S2: nessun file in comune)
Cosa fare:
- `patch.rs`: una toppa che cambia una chiave di una vista (filtro, ordine,
  colonne, raggruppamento, riepiloghi, nome, tipo), aggiunge o toglie una
  vista, e lascia ogni altro byte com'era: commenti, ordine delle chiavi,
  virgolette, rientri. Se il file non si può toccare senza riscriverlo (YAML
  di flusso, ancore), la toppa lo dice e non scrive.
- I comandi in `base.rs` (`base.view.set`, `base.view.add`,
  `base.view.remove`, nomi da confermare nel codice), con la revisione e
  l'annulla di `CommandPlan::of_edits`.
- `docs/product/bases.md` descrive la Base e ciò che si scrive sul disco.
Casi limite: un file con commenti fra le viste; una vista senza nome; un
filtro scritto come stringa e uno come albero `and`/`or`; un file oltre i
limiti di `model.rs`; un file illeggibile; la revisione cambiata.
Fatto quando: `patch_corpus.rs` prova che ogni toppa cambia solo le righe
della chiave e che il file riletto dà la definizione attesa; l'e2e dei
comandi prova annulla e conflitto.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-format-base -p
fub-features base
Stato: [ ] da fare

## T15 · Base: filtro, ordina, proprietà a vista

Perché: E12: sopra la Base le viste come linguette, «+», Filtro, Ordina,
Proprietà, Cerca e «Nuova»; ogni gesto riscrive solo le chiavi toccate.
Tocca: `apps/client/src/editors/base/surface.ts` e il suo test,
`editors/base/data.ts`, `apps/client/src/editors/base/toolbar.ts`,
`filter.ts` e `sort.ts` coi loro test (nuovi),
`apps/client/src/theme/scrittoio/skin/editors.css`, la sua anatomia,
`apps/client/src/i18n/catalog.ts`, `apps/client/bench/scene.mjs`,
`docs/product/bases.md`.
Non toccare: `fub-format-base` (le toppe sono di T15a); la nuova vista e il
menu della colonna (T16); il calendario (T17).
Dipende da: T15a, T81; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`)
Cosa fare:
- Le viste come linguette (quelle non scelte diventano icone se manca
  spazio); poi Filtro, Ordina, Proprietà, Cerca, «Nuova» (col menu dei
  modelli, che c'è già).
- Il filtro si compone a vista o come ricerca (`[stato:Arrivata]`); la Base
  mostra le due forme e passa dall'una all'altra.
- Ordina e Proprietà (quali colonne, in che ordine, trascinando) scrivono
  con i comandi di T15a, con la revisione.
- «Nel file .base» mostra le righe che i gesti hanno scritto.
Dal prototipo: riga 386; passi 12 e 13.
Casi limite: una Base incorporata in una nota (gli stessi gesti); una Base
in sola lettura; un filtro che la forma a vista non sa dire (resta come
ricerca, e lo dice); la toppa rifiutata da T15a (il gesto non scrive e lo
dice); la revisione cambiata da fuori.
Fatto quando: un test per gesto confronta le righe scritte; le foto del
banco nelle due luci; la battuta resta nel budget (la Base dentro la nota).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/base
Stato: [ ] da fare

## T16 · Base: nuova vista, menu della colonna, riepiloghi

Perché: E12: «+» crea una vista; la colonna ha il suo menu; il piede mostra
i riepiloghi, che il core calcola già (`summaries` in
`editors/base/data.ts`) ma nessuno mostra.
Tocca: `editors/base/surface.ts`, `editors/base/toolbar.ts`,
`apps/client/src/editors/base/column-menu.ts` e
`apps/client/src/editors/base/footer.ts` coi loro test (nuovi),
`skin/editors.css`, `i18n/catalog.ts`, `docs/product/bases.md`.
Non toccare: `fub-format-base`; il calcolo dei riepiloghi (resta nel core).
Dipende da: T15; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- «+»: Tabella, Schede, Elenco, Bacheca, Mappa (e Calendario con T17);
  la vista nuova eredita filtro e colonne di quella aperta.
- Il menu della colonna, nella lingua di E29: ordina, raggruppa, nascondi,
  riepilogo (conteggio, somma, media, minimo, massimo, vuote, piene),
  rinomina la proprietà (comando che c'è), tipo.
- Il piede coi riepiloghi scelti, coi numeri nel formato della lingua.
Dal prototipo: riga 386; passo 12.
Casi limite: venti viste (linguette in icone); un riepilogo su una colonna
di testo (solo conteggio, vuote, piene); una vista eliminata mentre è
aperta altrove; la Base incorporata.
Fatto quando: un test per voce del menu che scrive la chiave giusta; il
piede in un test DOM; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/base
Stato: [ ] da fare

## T17a · Calendario e linea del tempo nel modello del `.base`

Perché: E12, D10 A: calendario e linea del tempo sono tipi di vista del
`.base`, «dopo la prova con Obsidian».
Tocca: `crates/fub-format-base/src/model.rs` (`ViewType` e le chiavi della
vista: la data, l'inizio e la fine), `crates/fub-format-base/src/patch.rs`
(se T15a è già unito; altrimenti dopo), `crates/fub-features/src/base.rs`
(la valutazione per giorno e per intervallo),
`crates/fub-format-base/tests/fixtures/` (il file della prova con Obsidian),
`apps/client/src/host/` (il mirror TS, se il tipo ne ha uno: rigenerato),
`docs/product/bases.md`.
Non toccare: la superficie (T17, T34).
Dipende da: T15a; Q3 solo se la prova va male
Cosa fare:
- La prova con Obsidian, per prima: un `.base` con una vista `calendar` e
  una `timeline` aperto in Obsidian. Su questa macchina Obsidian non c'è:
  l'orchestratore chiede all'utente di aprire il file di fixture (due
  minuti) e scrive l'esito qui. Fino all'esito si scrive la forma di
  ripiego (Q3), dietro una funzione sola, così il cambio è una riga.
- `ViewType` prende `Calendar` e `Timeline`, additivi; una vista di un tipo
  sconosciuto continua a leggersi come oggi.
- La forma di ripiego: `type: table` con una chiave `fub:` che Obsidian
  ignora e che Fub legge come calendario o linea del tempo.
Casi limite: la chiave della data assente o non di tipo data; due viste con
lo stesso nome; il file scritto da un Fub vecchio (`type: table` senza la
chiave `fub:`, resta una tabella).
Fatto quando: test del modello nelle due forme; il file di fixture letto e
riscritto byte per byte; l'esito della prova con Obsidian scritto in
`Stato`.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-format-base -p
fub-features base
Stato: [ ] da fare

## T17 · Base: Calendario col trascinamento

Perché: E12: la vista Calendario; trascinare una nota sul giorno scrive la
data.
Tocca: `apps/client/src/editors/base/calendar.ts` e `calendar.test.ts`
(nuovi), `editors/base/surface.ts` (la vista), `skin/editors.css`,
`i18n/catalog.ts`, `apps/client/bench/scene.mjs`, `docs/product/bases.md`.
Non toccare: il modello (T17a); la linea del tempo (T34).
Dipende da: T16, T17a; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- Il mese, con le note nei giorni della proprietà scelta; più di tre in un
  giorno si raccolgono in «+N».
- Trascinare una nota su un altro giorno scrive la data nella nota, con la
  revisione e l'annulla (`note.property.set`); il formato resta quello che
  la proprietà ha.
- Da tastiera: le frecce fra i giorni, Invio apre, Maiusc con le frecce
  sposta la nota scelta.
Dal prototipo: riga 386; passo 13.
Casi limite: una data con l'ora (l'ora resta); una data fuori dal mese;
una nota in sola lettura; la revisione cambiata durante il trascinamento;
il primo giorno della settimana della lingua; al telefono (una colonna di
giorni).
Fatto quando: un test DOM del trascinamento che rilegge la data dal file;
le foto del banco nelle due luci.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/base
Stato: [ ] da fare

## T18 · La Base nella nota dal «/»

Perché: E12: «/base» crea `Nome.base` accanto e scrive
`![[Nome.base#Tabella]]`; dentro una nota la Base si allarga oltre la
colonna del testo fino al margine.
Tocca: `apps/client/src/editors/text/profiles/markdown/slash.ts` (la voce),
`apps/client/src/panels/slash/entries.ts`, `markdown/media.ts` (la
larghezza della Base incorporata), `skin/editors.css`, `markdown/strings.ts`,
`docs/product/bases.md`.
Non toccare: la resa della Base (`editors/base/`, la monta già il widget
dell'embed); l'ospite delle schede (T41).
Dipende da: T16, T84; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- «/base» chiede il nome (di serie il titolo della nota), crea il file
  accanto alla nota con una vista Tabella sulle note della cartella, poi
  scrive l'embed al posto della riga. Se la creazione fallisce, la nota non
  cambia. Ctrl Z toglie l'embed e lascia il file, come un allegato.
- La Base incorporata si allarga oltre la colonna del testo fino al margine
  (64 px oltre, come le schede larghe; E19).
Dal prototipo: passo 12.
Casi limite: un nome già preso (propone «Nome 2»); una cartella in sola
lettura; la nota in una cartella con mille note; finestra a 700 px e al
telefono (la Base resta nella colonna).
Fatto quando: un test che il file e l'embed nascono insieme e che un errore
di creazione lascia la nota com'era; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/slash.test.ts src/panels/slash
Stato: [ ] da fare

## T19a · Il provider dei compiti

Perché: E10, D5 A: «Compiti» dall'ispettore, da tutto il vault, da un
provider `tasks` in `fub-features` dietro la sua feature Cargo.
Tocca: `crates/fub-features/src/tasks.rs` (nuovo),
`crates/fub-features/src/lib.rs` (la registrazione, A-7),
`crates/fub-features/Cargo.toml` (la feature `tasks`, nelle `default`),
`crates/fub-features/tests/tasks_e2e.rs` (nuovo),
`docs/product/tasks-and-reminders.md` (nuovo), `docs/README.md`.
Non toccare: l'indice di ricerca (si legge con `query_index`: le foglie
`task:` e `due:` di `crates/fub-abi/src/rules/search_syntax.rs`); la
spunta (si usa il comando di oggi, coi ricorrenti di
`commands/recurrence.rs`); i promemoria (T36a, T36).
Dipende da: nessuno (prima di S2: nessun file in comune)
Cosa fare:
- Una vista dichiarata «Compiti» (`list_views`/`render_view`): Scaduti,
  Questa settimana, Più avanti, Senza data, da tutto il vault, con la nota
  d'origine per ogni compito.
- `view_action` sulla spunta chiama il comando di oggi, che scrive nella
  nota d'origine con la revisione.
- La settimana e «oggi» seguono il fuso e la lingua della macchina.
- La build senza la feature resta verde.
Casi limite: un compito senza data; una data illeggibile; un compito
ricorrente; diecimila compiti (la vista ha un tetto e lo dice); il fuso che
cambia a mezzanotte; una nota in sola lettura.
Fatto quando: `tasks_e2e.rs` con `MemoryHost` coi fusi prova i quattro
gruppi e la spunta; le build con e senza la feature passano.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features tasks;
cargo build -p fub-features --no-default-features
Stato: [ ] da fare

## T19 · La vista Compiti e il recinto ```tasks

Perché: E10: la scheda «Compiti» dell'ispettore e il recinto ```tasks che
mostra i compiti che rispondono a una ricerca; scadenza e promemoria come
pastiglie.
Tocca: `apps/client/src/editors/text/profiles/markdown/query-block.ts` (il
recinto `tasks`), `apps/client/src/editors/text/profiles/markdown/tasks-query.ts`
e il suo test (nuovi: le righe del plugin Tasks tradotte nella ricerca),
`markdown/livepreview.ts` (la pastiglia della scadenza), `skin/editors.css`,
`skin/drawers.css` (la scheda dell'ispettore), `markdown/strings.ts`,
`docs/product/tasks-and-reminders.md`.
Non toccare: il provider (T19a); i promemoria (T36).
Dipende da: T19a, T23; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`, `skin/drawers.css`)
Cosa fare:
- La scheda «Compiti» dell'ispettore mostra la vista di T19a.
- Il recinto ```tasks capisce le righe più usate del plugin Tasks (`not
  done`, `done`, `due before|after|on <data>`, `path includes`, `tag
  includes`) e le traduce nella ricerca di oggi; una riga che non capisce
  la mostra come tale e la salta, senza rompere il recinto.
- La scadenza vicina è una pastiglia arancio nel compito, in Scrittura e
  Lettura.
Dal prototipo: riga 587 (la linguetta Compiti dell'ispettore); passo 6 (il gruppo «Compito»).
Casi limite: un recinto vuoto; una riga sconosciuta; un compito spuntato
dal recinto mentre la nota d'origine è aperta in un altro riquadro; la
feature `tasks` spenta (il recinto dice che manca); al telefono.
Fatto quando: `tasks-query.test.ts` per ogni riga capita e per quella
sconosciuta; un test DOM del recinto e della spunta; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/tasks-query.test.ts
Stato: [ ] da fare

## T20 · Sbirciata, Alt clic, link come scheda

Perché: E11: Alt clic su un link apre la nota in un pannello sopra la
destra del foglio, in cui si scrive; un paragrafo fatto solo di un wikilink
si vede come scheda.
Tocca: `apps/client/src/state/note-peek.ts` e il suo test (nuovi; il nome
non è `peek.ts` perché `shells/scrittoio/frame/peek.ts` è il cassetto che
si affaccia), `apps/client/src/panels/document.ts` (il pannello),
`apps/client/src/state/preview.ts` (Ctrl sopra un link, che c'è: solo
l'aggancio), `markdown/link-card.ts` (la scheda della nota accanto a quella
web), `markdown/open-link.ts` (Alt clic e `editor.link-click`),
`crates/fub-host/src/settings.rs` (`editor.link-click`),
`apps/client/src/theme/scrittoio/skin/sheets.css`, `markdown/strings.ts`,
`i18n/lexicon.ts` (Sbirciata), `docs/product/editor-writing.md`.
Non toccare: `state/document-session.ts` (la sbirciata è una superficie come
quella di un riquadro, che la sessione già regge); il visore web.
Dipende da: T3, T13; mai con un task di un altro piano su `settings.rs`
o `panels/document.ts`
Cosa fare:
- Alt clic o Alt Invio su un link apre la sbirciata: un pannello sopra la
  destra del foglio, con la nota in Scrittura. «Apri qui» e «A lato» la
  promuovono; Esc salva e chiude.
- È una superficie della sessione della nota: se la nota è aperta anche in
  un riquadro, il buffer è lo stesso; cursore e annulla sono della
  superficie.
- Il clic semplice apre come oggi; `editor.link-click` (`apri` di serie,
  `sbircia`) lo cambia.
- Il link come scheda: un paragrafo fatto solo di un wikilink, fuori dal
  cursore, si vede come scheda (icona, titolo, descrizione, data,
  copertina, dalle proprietà via `query_index`); col cursore dentro torna il
  link, come la scheda web di oggi.
Dal prototipo: righe 376, 554 e 576; passo 23.
Casi limite: la sbirciata con modifiche in coda chiusa da Esc (salva); la
stessa nota nel riquadro; la nota sbirciata cancellata o rinominata da
fuori; un link a una nota che non esiste (la sbirciata offre di crearla);
un link a un PDF (si apre a lato, la sbirciata è per le note); al telefono
(la sbirciata è un foglio intero); dentro una scheda di nota della lavagna.
Fatto quando: un test di `note-peek.ts` per apri, promuovi, Esc con la coda
piena; un test della scheda della nota; `check-listeners` verde; le foto
del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/note-peek.test.ts src/editors/text/profiles/markdown/link-card.dom.test.ts
Stato: [ ] da fare

## T21a · I commenti nel formato: CriticMarkup nel provider Markdown

Perché: E16, D3 B: i commenti stanno nel testo come CriticMarkup
(`{==testo==}{>>@Anna Bianchi 2026-11-08 17:40: messaggio<<}`); il provider
li legge e li riscrive byte per byte, la ricerca li trova con `comment:`,
l'export li toglie.
Tocca: `crates/fub-format-markdown/src/parse/inlines.rs` (i due segni),
`crates/fub-format-markdown/src/serialize.rs`,
`crates/fub-format-markdown/src/render.rs` (l'HTML: tolti, o note a piè di
pagina con «con i commenti»), `crates/fub-abi/src/model.rs` (due kind nel
registro `custom_kind`, additivi, accanto a `HIGHLIGHT` e `COMMENT`),
`crates/fub-abi/src/rules/search_syntax.rs` (`comment:`),
`crates/fub-features/src/search/schema.rs` e `search/engine.rs` (il campo
dei commenti, fuori da `content:`), `crates/fub-importers/src/export_html.rs`
(l'opzione «con i commenti»), `crates/fub-format-markdown/tests/corpus/` e
`tests/the_corpus.rs` (i casi e il fuzzer), `crates/fub-features/tests/search_e2e.rs`,
`docs/reference/note-conventions.md` (nuovo), `docs/README.md`.
Non toccare: la WIT (nessun tipo nuovo: i nodi `Inline::Custom` di oggi);
le modifiche suggerite (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`: fuori scope,
restano testo); il client (T21, T22).
Dipende da: nessuno (prima di S2: nessun file in comune)
Cosa fare:
- Un commento è un evidenziato `{==…==}` seguito da uno o più `{>>…<<}`;
  ogni messaggio comincia con autore, data e i due punti. Un `{>>…<<}` senza
  evidenziato commenta il punto in cui sta. Un messaggio senza autore si
  legge «Senza nome».
- Il testo dei messaggi non fa link né etichette e non entra in
  `content:`; si cerca con `comment:`.
- CriticMarkup non attraversa i paragrafi: un segno aperto e non chiuso nel
  paragrafo resta testo. Dentro codice e formule non c'è. `\{==` è un
  `{==` letterale.
- Nelle celle di tabella la `|` di un messaggio si scrive `\|`; il fuzzer
  del provider copre tabelle e commenti insieme.
- L'export HTML li toglie; «con i commenti» li fa note a piè di pagina.
- `docs/reference/note-conventions.md` scrive le convenzioni di Fub nelle
  note (i commenti qui; i tipi con T33, i promemoria con T36, l'interruzione
  di pagina con T76).
Casi limite: un evidenziato senza commento (resta l'evidenziato di oggi,
`==testo==` non cambia); messaggi con `<<` o `>>` dentro; un commento in un
titolo, in una voce, in un riquadro, in una cella; il fuzzer con 2000 casi;
un file scritto da un'app che non conosce CriticMarkup e riaperto.
Fatto quando: il corpus coi commenti torna byte per byte; la ricerca trova
`comment:` e non trova i messaggi in `content:`; l'export toglie e, con
l'opzione, mette le note. Dopo il task l'orchestratore chiede il giro
`fuzz_completo` (CLAUDE.md).
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-format-markdown
-p fub-abi -p fub-importers; cargo nextest run -p fub-features search
Stato: [ ] da fare

## T21 · Commenti: lettura e scrittura nell'editor

Perché: E16, «Il mascheramento»: in Scrittura e Lettura i segni non si
vedono, il testo commentato ha un fondo giallo leggero, e scrivere
nell'evidenziato è scrivere nel testo.
Tocca: `apps/client/src/editors/text/profiles/markdown/comments/` (nuovo:
`syntax.ts` per la grammatica, `mask.ts` per i segni nascosti e il cursore
che li salta, coi loro test), `markdown/parser.ts` o `markdown/grammar.ts`
(l'aggancio della grammatica: dove si registrano oggi le estensioni),
`markdown/livepreview.ts` (solo l'aggancio), `markdown/render.ts` (la
Lettura), `markdown/copy-html.ts` (si copia il testo senza segni),
`apps/client/src/state/note-facts.ts` (S2: le parole dei commenti non
contano), `apps/client/src/theme/scrittoio/skin/editors.css`,
`markdown/strings.ts`, `i18n/lexicon.ts`,
`docs/product/editor-comments.md` (nuovo), `docs/README.md`.
Non toccare: il margine, la discussione, Risolvi (T22); il formato su disco
(T21a: si segue com'è).
Dipende da: T21a, T3; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`)
Cosa fare:
- I segni non si vedono in Scrittura e Lettura; il cursore li salta come un
  pezzo solo; scrivere dentro l'evidenziato è scrivere nel testo. La
  Sorgente mostra tutto, colorato.
- Cancellare tutto il testo evidenziato toglie il commento, con un avviso e
  un annulla.
- Copiare il testo evidenziato copia il testo senza segni.
- Le parole dei messaggi non contano nella riga dei dati.
- Nessun lavoro per battuta oltre la resa incrementale di oggi (A-5).
Dal prototipo: righe 453 e 531; passo 10.
Casi limite: incollare un testo con commenti (restano); tagliare e
incollare l'evidenziato in un altro paragrafo; duplicare il blocco
(Ctrl D); la rivelazione `editor.live-reveal` accesa; Vim; un commento in una
cella di tabella; dentro una scheda di nota della lavagna (A-6, regola 3).
Fatto quando: i test della grammatica e del mascheramento; un test DOM di
scrittura nell'evidenziato, cancellazione e copia; il corpus del client
(`corpus.test.ts`) coi commenti torna byte per byte; la battuta resta nel
budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/comments
src/editors/text/profiles/markdown/corpus.test.ts
Stato: [ ] da fare

## T22 · Commenti: margine, discussione, Risolvi

Perché: E16: nel margine destro un segno con l'iniziale di chi ha
cominciato e il numero dei messaggi; il clic apre la discussione; Risolvi
archivia in fondo alla nota; l'ispettore li elenca tutti.
Tocca: `markdown/comments/margin.ts`, `thread.ts`, `resolve.ts` e i loro
test (nuovi), `markdown/surface.ts` (il `SurfacePanel` «Commenti», che
`shells/scrittoio/frame/document-panels.ts` già mostra),
`crates/fub-host/src/settings.rs` (`profile.name`, macchina; `comments.author`,
vault: `nome`, `iniziali`, `niente`),
`apps/client/src/theme/scrittoio/skin/document.css`, la sua anatomia,
`markdown/strings.ts`, `apps/client/bench/scene.mjs`,
`docs/product/editor-comments.md`.
Non toccare: la grammatica e il mascheramento (T21); la mini-barra (T12, che
chiama Commenta); `document-panels.ts` (mostra già i pannelli della
superficie).
Dipende da: T21; mai con un task di un altro piano su `settings.rs` o
`skin/document.css`
Cosa fare:
- Il segno nel margine: l'iniziale di chi ha cominciato e il numero dei
  messaggi; il clic apre la discussione: citazione, messaggi, risposta,
  Risolvi, Elimina.
- Chi scrive (D11 A): il nome di Impostazioni › Profilo, chiesto al primo
  commento con l'avviso che finisce nel file; per vault si sceglie nome,
  iniziali o niente.
- Risolvi (D12 C) toglie i segni dal paragrafo e archivia la discussione in
  fondo alla nota, in un commento `%%` con data, citazione e messaggi.
  Elimina toglie tutto. Ogni gesto è un passo d'annullamento della nota.
- Il pannello «Commenti» dell'ispettore: gli aperti, poi i «Risolti»
  dall'archivio; «Svuota i risolti» toglie l'archivio con un annulla.
  **Differenza dall'artifact**: è un pannello della superficie, non un
  provider del core: legge il buffer, così mostra anche ciò che non è
  ancora salvato, senza IPC. Fra note diverse si cerca con `comment:`.
- Una selezione su più blocchi diventa un commento nel primo, e la
  discussione lo dice; in codice e formule il commento va dopo il blocco.
Dal prototipo: righe 453, 531 e 587; passo 10.
Casi limite (il mascheramento, tutti con un test): modifiche che spostano,
tagliano, duplicano il testo commentato; Risolvi con la nota cambiata da
fuori; l'archivio che cresce (cento discussioni); `comments.author` su
`niente`; un messaggio scritto da un altro programma senza autore; finestra a
700 px (il margine diventa un segno nel testo) e al telefono; sola lettura
(si legge, non si scrive).
Fatto quando: i test di margine, discussione e Risolvi; un e2e che scrive,
risponde, risolve, svuota e annulla e rilegge il file; le foto del banco
nelle due luci, a 700 px e al telefono; la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/comments; cargo nextest run -p fub-host
settings
Stato: [ ] da fare

## T23 · La battuta nei 4 ms

Perché: E18, correzione 1: la battuta è il cancello della prima onda. Oggi
in Live sulla nota da 7.201 righe costa 6,4 · 8,8 · 17,6 ms (mediana ·
novantesimo · massimo, `docs/product/performance-budget.md`, su
server-di-fub) contro 4 ms di mediana: a ogni battuta la Live scorre tutti i
2.800 blocchi di primo livello.
Tocca: `apps/client/src/editors/text/profiles/markdown/livepreview.ts` e
`markdown/render-incremental.test.ts`, `markdown/render.ts` (la resa
incrementale), `markdown/blocks/` (solo ciò che la misura trova),
`apps/client/bench/interaction.mjs` (il novantesimo nel budget),
`docs/product/performance-budget.md`.
Non toccare: `apps/client/src/tabella/` e `markdown/table-grid.ts` (T50
corre accanto); il comportamento visibile (questo task non cambia ciò che
si vede).
Dipende da: S2 in `main`
Cosa fare:
- Misura prima, sulla macchina dove lavora il coder, e scrivi i numeri e la
  macchina in `Stato`.
- Trova ciò che scorre tutto il documento a ogni battuta e fallo lavorare
  solo sui blocchi toccati dalla transazione (le posizioni del cambio, non
  un giro sui blocchi di primo livello); lo stesso per maniglie e testata:
  i widget fuori vista non si montano.
- `interaction.mjs`: il budget diventa mediana 4 ms e novantesimo 8 ms, e
  un valore oltre fa uscire il banco con errore.
- `render-incremental.test.ts` conta anche i blocchi visitati: una battuta in
  un paragrafo non ne visita più di una manciata. È la guardia della CI,
  perché il banco non ci sta.
Casi limite: battuta dentro un recinto di codice lungo, una tabella, un
riquadro; incolla di mille righe; una battuta che cambia le definizioni
(resa intera, ammessa); Vim; IME.
Fatto quando: sulla nota da 7.201 righe Scrittura (e Blocchi finché c'è)
sta in 4 ms di mediana e 8 al novantesimo sulla macchina scritta in
`Stato`; il test dei blocchi visitati fallisce prima e passa dopo; il banco
esce con errore oltre il budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/render-incremental.test.ts && node
bench/interaction.mjs --only=battuta
Stato: [ ] da fare

## T24 · Concentrazione nelle pagine e macchina da scrivere

Perché: E15: la concentrazione c'è già (`data-focus-mode` in
`desktop-shell.ts`, scena `concentration`) ma non è scritta nelle pagine
del prodotto; la macchina da scrivere tiene la riga del cursore a metà
altezza.
Tocca: `apps/client/src/editors/text/engine.ts` (una faccetta come
`smartLists`), `apps/client/src/editors/text/typewriter.ts` e il suo test
(nuovi), `apps/client/src/desktop-shell.ts` (Esc esce; «Esci dalla
concentrazione» nella banda; il comando nel menu «…» e in Ctrl O),
`crates/fub-host/src/settings.rs` (`editor.typewriter`), il CSS della
concentrazione dove sta oggi (da verificare cercando `data-focus-mode`),
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: la scena `concentration` oltre i casi nuovi; la banda oltre la
voce «Esci».
Dipende da: T14; mai con un task di un altro piano su `settings.rs` o
`engine.ts` (PA T56 tocca `FIELD_LAYOUT`)
Cosa fare:
- Concentrazione: cassetti, linguette e barra si ritirano; la cornice si
  attenua e torna al passaggio; il blocco del cursore resta acceso e gli
  altri si attenuano. Esc esce (se nessun menu è aperto); «Esci dalla
  concentrazione» nella banda.
- Macchina da scrivere (`editor.typewriter`, spenta): la riga del cursore
  resta a metà altezza; nessun costo alla battuta (uno scorrimento per
  transazione, solo se la riga è cambiata).
- Le due funzioni scritte in `docs/product/editor-writing.md`.
Dal prototipo: passo 25.
Casi limite: Esc con un menu aperto (chiude il menu, non la concentrazione);
Vim (Esc resta di Vim); nota corta (la macchina da scrivere non scorre oltre
l'inizio); moto ridotto; due riquadri.
Fatto quando: un test della faccetta; la scena del banco; la battuta resta
nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/typewriter.test.ts
Stato: [ ] da fare

## T25 · Incollare un indirizzo: link e scheda

Perché: E7: un indirizzo incollato su una selezione la fa diventare link
(c'è già, `paste.ts`); incollato da solo su una riga vuota offre Link,
Scheda e, con T37, Incorpora; Invio tiene Link.
Tocca: `apps/client/src/editors/text/profiles/markdown/paste.ts` e
`paste.test.ts`, `markdown/link-card.ts` (la scheda web che c'è),
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: `ui/web-viewer.ts` e l'incorporare (T37).
Dipende da: T23
Cosa fare:
- Su una riga vuota un indirizzo incollato si scrive come link e sotto
  compare una scelta piccola: Link (scelto), Scheda (il segnalibro web di
  oggi, `fub.linkcard`, a richiesta). Invio o un'altra battuta tengono
  Link.
- Il testo arriva in un colpo: la scelta non parte per un indirizzo scritto
  a mano.
Dal prototipo: la sezione E7, «Comportamento» (nessun passo del giro lo mostra).
Casi limite: un indirizzo `mailto:`; un indirizzo con spazi; incolla dentro
codice; incolla in una cella di tabella; incolla con più righe; IME.
Fatto quando: i tre casi dell'incolla (su selezione, su riga vuota, dentro
testo) hanno un test; un test DOM della scelta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/paste.test.ts
Stato: [ ] da fare

## T26a · La regola al tocco

Perché: correzione 2 (E18, «Al tocco»): dove non c'è il puntatore il
secondo livello di presenza compare sul blocco che ha il cursore e nella
barra sopra la tastiera; una scheda si attiva col tocco e si lascia con
«Fine».
Tocca: `markdown/blocks/handles.ts` (maniglia e «+» sul blocco del cursore
quando il puntatore non c'è), `apps/client/src/panels/format-bar.ts` (il
gruppo del blocco nella barra sopra la tastiera),
`apps/client/src/shells/scrittoio/mobile/mobile.css`, `skin/editors.css`,
`apps/client/bench/scene.mjs` (le scene al tocco), `markdown/strings.ts`,
`docs/product/editor-writing.md`.
Non toccare: le schede (la regola la applica T41 con «Fine»); la tabella
(T50 ha il suo tocco).
Dipende da: T2b, T11; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`)
Cosa fare:
- Il secondo livello (`data-presence="hover"`) con `(hover: none)`
  compare sul blocco del cursore, non al passaggio.
- La barra sopra la tastiera porta il gruppo del blocco del cursore (T11).
- La presa del blocco dopo 300 ms di pressione (T2a) e il colpetto aptico
  dove il sistema lo offre.
- Le scene al tocco: a riposo, cursore in un blocco, presa.
Dal prototipo: passi 2, 24 e 27 (al telefono).
Casi limite: un tablet con la tastiera e il puntatore (vale il puntatore);
lo zoom del sistema; la tastiera che si chiude.
Fatto quando: le scene al tocco nelle due luci; un test che col tocco la
maniglia segue il cursore.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks src/panels/format-bar.test.ts
Stato: [ ] da fare

## T26 · Il giro della scrittura sul banco

Perché: E18: «Il giro della scrittura», quaranta compiti presi dal lavoro in
Notion e Obsidian, e2e nel banco, accanto al giro della pre-alpha (PA T14,
PA T26).
Tocca: `apps/client/bench/giro/scrittura.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs` (una riga),
`docs/development/testing-and-quality.md` (l'elenco dei quaranta compiti;
se la pagina passa la soglia, in una pagina nuova
`docs/development/giro-della-scrittura.md`).
Non toccare: `bench/giro.mjs` (il corridore è di PA T14); i compiti di PA
T26.
Dipende da: T2, T26a, PA T14, PA T26
Cosa fare:
- Quaranta compiti, ognuno con ciò che si fa e ciò che conta come riuscito,
  dai flussi di E1–E18: scrivere e formattare, i blocchi coi blocchi accesi
  e spenti, la testata e le proprietà, i commenti, la Base, i compiti, la
  sbirciata, Ctrl O, l'incolla, la concentrazione.
- Ogni compito gira e2e nel banco (`FUB_BENCH_PORT=1460`) sul vault
  d'esempio e su una copia temporanea, mai sul vault vero.
Casi limite: un compito che dipende da un task non ancora unito (si salta e
lo dice); il moto ridotto; la lingua inglese.
Fatto quando: quaranta compiti e2e verdi nel banco.
Prova: scripts/check.sh --rapido; cd apps/client && FUB_BENCH_PORT=1460 npm
run bench:giro
Stato: [ ] da fare

## T27 · La prova con cinque persone

Perché: E18: il giro della scrittura con cinque persone; i riscontri
diventano issue.
Tocca: `docs/development/prova-con-persone.md` (di PA T17: i compiti della
scrittura si aggiungono lì).
Non toccare: i dati delle persone (niente nomi né indirizzi nel repo).
Dipende da: T26, PA T17
Cosa fare:
- Prendi dieci dei quaranta compiti di T26, quelli che una persona nuova
  incontra per primi, e aggiungili al protocollo di PA T17.
- La prova la conduce l'utente (A-16); l'orchestratore apre l'issue.
Casi limite: una persona che non finisce un compito (si scrive dove si è
fermata); un riscontro che è già un'issue aperta (si collega, non si
duplica); nessun dato personale nell'issue.
Fatto quando: il protocollo ha i compiti della scrittura; l'issue ha cinque
risultati.
Prova: scripts/check.sh --rapido
Stato: [ ] rinviato · come PA T17 (2026-11-09, l'utente: la prova con
cinque persone per ora non si fa; alla release proveranno i primi utenti).
Non blocca T28 né le onde dopo.

## T28 · Le pagine della documentazione

Perché: ogni task aggiorna la sua pagina; alla fine dell'onda 1 le pagine
devono stare insieme, sotto le soglie, coi collegamenti giusti.
Tocca: `docs/product/editor-writing.md`, `docs/product/editor-blocks.md`,
`docs/product/editor-and-preview.md`, `docs/product/editor-comments.md`,
`docs/product/bases.md`, `docs/product/tasks-and-reminders.md`,
`docs/product/editor-menus.md`, `docs/product/command-space.md`,
`docs/product/editor-tables.md`, `docs/reference/property-types.md`,
`docs/reference/note-conventions.md`, `docs/architecture/editor-surfaces.md`,
`docs/map/*.md`, `docs/README.md`, `CLAUDE.md` solo se una regola di lavoro
è cambiata.
Non toccare: il codice (un difetto trovato si scrive come issue o come nota
per l'orchestratore).
Dipende da: tutti i task dell'onda 1 tranne T27
Cosa fare:
- Rileggi ogni pagina sul codice di `main`: ciò che descrive c'è, ciò che
  c'è è descritto; niente futuro nelle pagine canoniche
  (`docs/development/documentation-style.md`).
- Le parole nuove sono nel lessico (A-12) e le pagine le usano uguali.
- `docs/map/dove-sta-x.md` dice dove stanno le parti nuove.
Casi limite: una pagina che passa la soglia (si divide nello stesso task);
un collegamento a una pagina nata con un altro nome; una regola di lavoro
cambiata (allora anche `CLAUDE.md`).
Fatto quando: `check-doc-size`, `check-doc-links` e `check-doc-orphans`
verdi; nessuna pagina descrive un comportamento che il codice non ha.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T29a · Una superficie su una parte della sessione

Perché: E14: la trasclusione viva scrive nella `DocumentSession`
dell'origine con una superficie sua (cursore, selezione e annulla suoi).
Oggi una superficie mostra tutto il documento: serve una superficie su un
tratto (una sezione, un blocco), che segue il tratto quando il testo intorno
cambia. È la parte di contratto di T29 (A-3), ad alto rischio.
Tocca: `apps/client/src/state/document-session.ts` e il suo test,
`apps/client/src/editors/core/` (il tipo della superficie su un tratto,
accanto a `EditorSurface`: il file da verificare), `apps/client/src/editors/text/engine.ts`
(una vista CodeMirror ristretta a un tratto, se serve), i loro test,
`docs/architecture/editor-surfaces.md` (o la sua divisione se passa la
soglia, A-13).
Non toccare: il widget dell'embed (T29); il core (nessuna porta nuova).
Dipende da: onda 1 in `main`; mai con un task di un altro piano su
`document-session.ts` o `engine.ts`
Cosa fare:
- Una superficie si può aprire su un tratto della sessione, dato da un'àncora
  (`#Titolo` o `#^id`) e risolto sul testo di ora; il tratto segue le
  modifiche fatte altrove (le mappe di posizione della sessione).
- Le modifiche della superficie ristretta entrano nella sessione come
  quelle di un riquadro: la coda di salvataggio e la revisione sono della
  sessione; l'annulla è della superficie. Le modifiche che arrivano da
  un'altra superficie non sono battute nell'annulla locale (CLAUDE.md).
- Se l'àncora sparisce (titolo rinominato, blocco cancellato) la superficie
  lo dice e diventa di sola lettura sull'ultimo testo.
- Ogni ascoltatore ha il suo smaltimento.
Casi limite: due superfici più la superficie ristretta; il tratto
cancellato da un'altra superficie; la sessione chiusa con la coda piena; una
modifica esterna che arriva mentre si scrive nel tratto; un tratto vuoto.
Fatto quando: test della sessione con tre superfici (due intere e una
ristretta) che si scambiano modifiche senza perderne; l'annulla locale non
contiene le modifiche altrui; `check-listeners` verde.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/document-session.test.ts
Stato: [ ] da fare

## T29 · La trasclusione viva

Perché: E14: `![[Nota#^id]]` ha «Modifica qui» e «Apri» al passaggio; in
modifica un bordo d'accento e una fascia: «Scrivi in Riunioni/2026-11-04:
si salva là, con la sua revisione. Esc esce.»
Tocca: `apps/client/src/editors/text/profiles/markdown/transclusion.ts` e
il suo test (nuovi), `markdown/livepreview.ts` e `markdown/media.ts` (il
widget dell'embed di una nota), `markdown/block-groups.ts` (il gruppo
Trasclusione, A-7), `skin/editors.css`, `markdown/strings.ts`,
`i18n/lexicon.ts` (Trasclusione viva), `docs/product/editor-writing.md`.
Non toccare: `state/document-session.ts` (T29a); il blocco sincronizzato
(T30); l'ospite delle schede (T41).
Dipende da: T29a, T3; mai con N6 T22 o T42, la griglia T2–T3, PA T56
(`skin/editors.css`)
Cosa fare:
- Al passaggio «Modifica qui» e «Apri»; «Modifica qui» (o Invio sul blocco
  scelto) apre la superficie ristretta di T29a dentro l'embed, col bordo
  d'accento e la fascia; Esc esce.
- Si scrive un livello solo: una trasclusione dentro la trasclusione resta
  di sola lettura; un giro (la nota che include sé stessa) si ferma e lo
  dice.
- Un conflitto si mostra dentro la trasclusione, con le scelte di oggi.
- Il gruppo «Trasclusione» della barra: Apri l'origine, Modifica qui.
Dal prototipo: riga 365; passo 22.
Casi limite: l'origine aperta in un altro riquadro con modifiche non
salvate; l'origine cancellata o rinominata mentre si scrive; la chiusura
dell'ospite con la coda piena (salva); un embed di una sezione intera; un
embed di un blocco senza id; l'origine in sola lettura; dentro una scheda
di nota della lavagna (A-6, regola 3).
Fatto quando: un test con due superfici più la trasclusione; la chiusura
con la coda piena; `check-listeners` verde; le foto del banco nelle due luci;
la battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/transclusion.test.ts
Stato: [ ] da fare

## T30 · Il blocco sincronizzato

Perché: E14: lo stesso blocco in più note, che cambia ovunque quando
cambia; è la trasclusione viva di un blocco, mostrata come blocco della
nota.
Tocca: `markdown/transclusion.ts` e il suo test, `markdown/slash.ts` e
`panels/slash/entries.ts` («Blocco di un'altra nota»), il comando che dà
l'id a un blocco e scrive l'embed (`crates/fub-features/src/blocks.rs` o
`commands/`: da verificare dove si dà oggi un `^id`), `skin/editors.css`,
`markdown/strings.ts`, `i18n/lexicon.ts` (Blocco sincronizzato),
`docs/product/editor-writing.md`.
Non toccare: `state/document-session.ts`; il formato (resta `![[Nota#^id]]`,
che Obsidian legge).
Dipende da: T29, T32a; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- «Sincronizza in un'altra nota» dal menu del blocco: dà l'id al blocco se
  manca e scrive `![[Nota#^id]]` nella nota scelta; due file in un piano solo
  (T32a), un annulla.
- Nella nota che lo ospita il blocco sincronizzato si modifica direttamente
  (la superficie ristretta di T29a, senza «Modifica qui»), con un segno
  discreto a sinistra e «Sincronizzato con …» al passaggio.
Dal prototipo: riga 365; passo 22.
Casi limite: l'id che esiste già in un'altra nota; il blocco originale
cancellato (l'embed dice «Blocco non trovato»); la nota d'arrivo cambiata
da fuori (non si scrive niente, T32a); dieci sincronizzati in una nota (la
battuta).
Fatto quando: un e2e che crea il sincronizzato, scrive in una nota e legge
nell'altra; l'annulla rimette tutti e due i file; la battuta resta nel
budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/transclusion.test.ts
Stato: [ ] da fare

## T31 · `[[^^` cerca i blocchi del vault

Perché: E13: `[[^^parole` trova i blocchi del vault con la foglia `block:`
dell'indice; la scelta dà l'id al blocco se manca e scrive `[[Nota#^id]]`.
Tocca: `apps/client/src/editors/text/profiles/markdown/completions.ts` e il
suo test, il comando che dà l'id (lo stesso di T30, usato com'è),
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: l'indice (la foglia `block:` c'è,
`crates/fub-abi/src/rules/search_syntax.rs`).
Dipende da: T30
Cosa fare:
- `[[^^` seguito da parole cerca con `block:` dopo una pausa breve (nessuna
  IPC per battuta); ogni risultato mostra il testo del blocco e la nota.
- La scelta dà l'id al blocco nella nota d'origine se manca (una scrittura
  con la revisione) e scrive `[[Nota#^id]]`; se la scrittura dell'id non
  passa, il link non si scrive e lo dice.
Casi limite: un blocco nella nota aperta; un blocco in una nota in sola
lettura (si offre il link alla sezione); diecimila risultati (un tetto);
IME; testo incollato.
Fatto quando: un test del completamento con l'id che c'è e con quello che
manca; un test del conflitto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/completions.test.ts
Stato: [ ] da fare

## T32a · Un piano su più documenti, tutto o niente

Perché: A-10, correzione 4: «Sposta in…», il blocco sincronizzato e
«Trasforma in foglio» scrivono due file con un annulla solo; oggi il lotto
del kernel «non è una transazione» (`Workspace::batch`,
`crates/fub-kernel/src/workspace.rs`).
Tocca: `crates/fub-kernel/src/workspace.rs` (il lotto),
il tipo del piano di comando (`CommandPlan`, dove sta: da verificare in
`crates/fub-abi/src/` o `crates/fub-kernel/src/`), l'annulla dei comandi del
core (`vault.undo`), i loro test, `docs/architecture/runtime-events-and-jobs.md`
(o la pagina dei comandi che descrive l'annulla).
Non toccare: la WIT; l'IPC; i comandi che lo useranno (T30, T32, T48,
T52).
Dipende da: onda 1 in `main`; mai con un task di un altro piano su
`workspace.rs`
Cosa fare:
- Un piano con modifiche su più documenti si controlla tutto prima di
  scrivere (ogni revisione); se una non passa non si scrive niente.
- Se una scrittura fallisce a metà, quelle già fatte si rimettono com'erano
  prima di tornare l'errore; un errore anche lì lascia un avviso con i file
  coinvolti e la copia di prima in `.fub/` (nessuna perdita silenziosa).
- L'annulla del comando rimette tutti i file in un passo; se uno è cambiato
  dopo, l'annulla non tocca niente e lo dice.
- Gli eventi escono una volta, dopo, come fatti in coda.
Casi limite: una revisione cambiata su uno dei due file; il disco pieno al
secondo file; un file nuovo più una modifica; una rinomina più una
modifica; l'annulla dopo che un file è cambiato.
Fatto quando: test del kernel con `MemoryHost` per ogni caso limite;
nessun lucchetto del workspace attraverso una chiamata di provider.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-kernel batch
Stato: [ ] da fare

## T32 · «Sposta in…» e il blocco lasciato sul cassetto

Perché: E13: «Sposta in…» manda il blocco in fondo a un'altra nota o sotto un
suo titolo; al suo posto resta niente, un link o una trasclusione. Due
scritture, un piano, un annulla.
Tocca: `crates/fub-features/src/commands/move_block.rs` (nuovo),
`crates/fub-features/src/commands/catalog.rs` (la voce),
`crates/fub-features/tests/commands_e2e.rs`, il menu del blocco e il dialogo
«Sposta in…» nel client (`markdown/blocks/` e `markdown/menu.ts`),
`markdown/blocks/drop-targets.ts` (il cassetto come bersaglio),
`apps/client/src/panels/explorer.ts` (le note dell'albero offrono il
bersaglio con la porta di T2b), `markdown/strings.ts`,
`docs/product/editor-blocks.md`.
Non toccare: il kernel (T32a); la lavagna come bersaglio (T48).
Dipende da: T32a, T2b; mai con PA T43 (`panels/explorer.ts`)
Cosa fare:
- «Sposta in…» (menu del blocco, Ctrl O): la nota, poi in fondo o sotto un
  titolo; poi che cosa resta: niente, un link, una trasclusione.
- Trascinare un blocco fuori dalla colonna su una nota del cassetto fa la
  stessa cosa, in fondo; l'etichetta del cartellino dice la nota.
- Un comando del core con un piano su due documenti (T32a): o tutti e due,
  o nessuno; un annulla.
Dal prototipo: riga 828; passo 3.
Casi limite: la nota d'arrivo cambiata da fuori (non si muove niente); la
nota d'arrivo è la stessa (si sposta dentro la nota); un blocco con un id
citato altrove (l'id resta col blocco, i link seguono la nota nuova); una
selezione di più blocchi; la nota d'arrivo in sola lettura.
Fatto quando: l'e2e con `MemoryHost` con un conflitto su una delle due note;
un test DOM del trascinamento sul cassetto; l'annulla rimette le due note.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
move_block; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/blocks
Stato: [ ] da fare

## T33a · I tipi di nota nel core

Perché: E5, D7 A: una nota Markdown per tipo nella cartella
`files.types-folder` (di serie `Tipi/`): il frontmatter dice icona,
proprietà, quelle in evidenza e la cartella delle note nuove; il testo è il
modello.
Tocca: `crates/fub-features/src/template.rs` e `template/create.rs`
(creare da un tipo), `crates/fub-features/src/properties/` (il tipo della
nota e «cambia tipo»), `crates/fub-host/src/settings.rs`
(`files.types-folder`, vault), i test (`template/tests.rs`,
`crates/fub-features/tests/`), `docs/reference/note-conventions.md`.
Non toccare: la WIT; il registro dei tipi di proprietà (resta uno per
vault: se il tipo dichiara per una proprietà un tipo diverso dal registro,
vale il registro e la pagina del tipo lo dice).
Dipende da: onda 1 in `main`, PA T43; mai con un task di un altro piano su
`settings.rs`
Cosa fare:
- Una nota dice il suo tipo con `tipo: "[[Tipi/Libro]]"`, un link vero.
- Creare una nota da un tipo: le proprietà del tipo, il testo del modello,
  la cartella del tipo; un comando con la revisione.
- Cambiare tipo aggiunge le proprietà che mancano e non toglie niente; un
  annulla.
- Un tipo che manca o non si legge lascia la nota com'è; la proiezione lo
  dice (la testata lo mostrerà, T33).
- L'elenco dei tipi coi conteggi, per il cassetto, con `query_index`.
Casi limite: la cartella dei tipi che non c'è; due tipi con lo stesso
nome in sottocartelle; un tipo il cui frontmatter non si legge; una nota col
tipo scritto come testo e non come link (si legge lo stesso); una rinomina
del tipo (i link seguono, come ogni rinomina).
Fatto quando: test con `MemoryHost`: creare, cambiare tipo, tipo guasto,
cartella cambiata.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
template properties; cargo nextest run -p fub-host settings
Stato: [ ] da fare

## T33 · I tipi di nota nell'editor

Perché: E5: «Nuova nota» chiede il tipo; il tipo dà icona, proprietà in
evidenza e modello; nel cassetto la sezione «Tipi» coi conteggi; il clic
apre la pagina del tipo con la Base delle sue note.
Tocca: `apps/client/src/state/new-note.ts` e il suo test,
`markdown/page/header.ts` e `markdown/page/featured.ts` (le proprietà del
tipo, l'avviso del tipo guasto), `markdown/page/properties/menu.ts` («In
evidenza» che scrive nel tipo, A-15), la sezione «Tipi» del cassetto
(`apps/client/src/panels/explorer.ts` o la vista dichiarata, da verificare),
`skin/document.css`, `skin/drawers.css`, `markdown/strings.ts`,
`docs/product/editor-writing.md`.
Non toccare: il core (T33a); il menu «Nuovo» di PA T43 (si usa: il tipo
viene dopo «Nota»).
Dipende da: T33a, T8; mai con PA T43 o un task di un altro piano su
`skin/document.css`
Cosa fare:
- «Nuova nota» chiede il tipo (Invio tiene «Nessuno»).
- La testata mostra icona e proprietà in evidenza del tipo; un tipo che
  manca lo dice nella testata, con «Scegli il tipo».
- «In evidenza» su una nota con un tipo scrive nel tipo, con un annulla.
- La sezione «Tipi» del cassetto coi conteggi; il clic apre la nota del
  tipo, che ha la Base delle sue note (un embed, scritto alla creazione).
Dal prototipo: passo 4.
Casi limite: nessun tipo nel vault (la domanda non compare); un tipo in
sola lettura; la nota del tipo aperta mentre se ne cambia una proprietà; al
telefono.
Fatto quando: un e2e crea una nota da un tipo e la rilegge; un test della
testata col tipo guasto; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/new-note.test.ts src/editors/text/profiles/markdown/page
Stato: [ ] da fare

## T34 · La linea del tempo

Perché: E12: la vista Linea del tempo; trascinare inizio e fine scrive le
date.
Tocca: `apps/client/src/editors/base/timeline.ts` e il suo test (nuovi),
`editors/base/surface.ts`, `skin/editors.css`, `i18n/catalog.ts`,
`apps/client/bench/scene.mjs`, `docs/product/bases.md`.
Non toccare: il modello (T17a); il calendario (T17).
Dipende da: T17, T17a; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- Le note come barre fra la proprietà d'inizio e quella di fine; senza fine,
  un punto.
- Trascinare una barra sposta tutte e due le date; trascinare un bordo ne
  cambia una; con la revisione e l'annulla.
- Lo zoom: settimane, mesi, anni; da tastiera come il calendario.
Dal prototipo: riga 386.
Casi limite: fine prima dell'inizio (si mostra e si segna); date con l'ora;
mille note; una nota in sola lettura; al telefono.
Fatto quando: un test DOM del trascinamento che rilegge le date dal file;
le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/base
Stato: [ ] da fare

## T35a · La Relazione nel contratto e i riepiloghi nel core

Perché: E4: la proprietà Relazione lega una nota ad altre (di un tipo o di
una cartella) e la Base ne fa i riepiloghi.
Tocca: `crates/fub-abi/src/model/property.rs` (`Relation`, additivo),
`apps/client/src/host/enums.generated.ts` (rigenerato),
`crates/fub-kernel/src/properties.rs`, `crates/fub-features/src/properties/`
(l'opzione `target` nel registro, facoltativa, A-9),
`crates/fub-format-base/src/formula.rs` e `crates/fub-features/src/base.rs`
(il riepilogo su una relazione), i loro test,
`docs/reference/property-types.md`.
Non toccare: la WIT; l'editor (T35).
Dipende da: T9a in `main`, onda 1 in `main`
Cosa fare:
- `PropertyType::Relation`: il valore è una lista di link a note; il
  registro può dire il bersaglio (un tipo, `[[Tipi/Libro]]`, o una
  cartella). Senza bersaglio, ogni nota.
- Un riepilogo della Base su una relazione: conteggio, somma, media,
  minimo, massimo di una proprietà delle note legate; valutato nel core.
- La relazione inversa («Collegata da») si legge dai link entranti, senza
  scrivere niente nelle altre note.
Casi limite: un link rotto nella relazione; una relazione verso sé stessa;
un giro di relazioni nel riepilogo (un livello solo); un registro di una
versione futura (non si riscrive).
Fatto quando: test della proiezione e dei riepiloghi; il registro senza
`target` torna byte per byte; il mirror è verde.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-abi -p
fub-kernel -p fub-features -p fub-format-base properties base
Stato: [ ] da fare

## T35 · Relazioni e riepiloghi nell'editor e nella Base

Perché: E4: l'editor della Relazione (scelta di note, ristretta al
bersaglio), la relazione inversa nella testata, i riepiloghi come colonne
della Base.
Tocca: `markdown/page/properties/editors.ts` e il suo test,
`editors/base/column-menu.ts` (il riepilogo su una relazione),
`skin/document.css`, `markdown/strings.ts`, `i18n/catalog.ts`,
`docs/reference/property-types.md`, `docs/product/bases.md`.
Non toccare: il core (T35a).
Dipende da: T35a, T9, T15; mai con un task di un altro piano su
`skin/document.css`
Cosa fare:
- L'editor della Relazione: la ricerca fra le note del bersaglio, scelta
  multipla, il valore è una lista di link; «Crea …» se il nome non c'è.
- Nella testata «Collegata da» mostra le note che legano questa, in sola
  lettura.
- Nel menu della colonna di una Base, una relazione offre i riepiloghi.
Dal prototipo: riga 508; passo 4.
Casi limite: il bersaglio senza note; cento note legate; una nota legata
rinominata (il link segue); sola lettura.
Fatto quando: test dell'editor da tastiera e col puntatore; un test della
colonna di riepilogo; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/page src/editors/base
Stato: [ ] da fare

## T36a · Il permesso delle notifiche e l'indice dei promemoria

Perché: E10, D5 A: `⏰ 2026-11-13 09:00` nel compito; la notifica del
sistema ad app aperta e, all'avvio, l'elenco dei promemoria passati; serve
il permesso `fub:notifications`, che si spegne come gli altri.
Tocca: `crates/fub-abi/src/options.rs` (la costante nel modulo dei
permessi), il `Guard` che lo controlla (dove stanno oggi i permessi del
core: da verificare a partire da `fub:network`),
`crates/fub-format-markdown/src/parse.rs` (il segno `⏰` fra i dati del
compito, accanto a `📅`), `crates/fub-features/src/tasks.rs` (l'indice dei
promemoria, ricostruibile), `crates/fub-app/Cargo.toml` e il notificatore in
`crates/fub-app/src/` (`tauri-plugin-notification`, A-15),
`crates/fub-app/capabilities/` (il permesso Tauri del plugin, se serve),
`Cargo.lock`, i test, `docs/reference/permissions-and-security.md`,
`docs/product/tasks-and-reminders.md`, `docs/reference/note-conventions.md`.
Non toccare: la WIT (nessuna capacità ai componenti WASM); la CI.
Dipende da: T19a in `main`, onda 1 in `main`
Cosa fare:
- `fub:notifications`: un permesso del core, stretto come gli altri, che si
  spegne dalle Impostazioni; spento, i promemoria restano nella nota e
  nell'elenco all'avvio, senza notifiche.
- L'indice dei promemoria è nuovo e ricostruibile dall'indice delle note;
  un promemoria cancellato o spuntato esce.
- Ad app aperta, all'ora la notifica del sistema; il clic apre la nota sul
  compito. All'avvio, l'elenco dei promemoria passati mentre l'app era
  chiusa.
- La dipendenza nuova passa `cargo deny check` (DECISIONS); se non passa, il
  task si ferma e lo scrive.
Casi limite: il fuso che cambia; l'ora legale; un promemoria nel passato
appena scritto; mille promemoria; il sistema che rifiuta le notifiche;
macOS, Windows e Linux (da provare dove si può, il resto scritto in
`Stato`).
Fatto quando: test con `MemoryHost` coi fusi; il permesso spento non
notifica; `cargo deny check` verde; la build senza la feature `tasks` verde.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features tasks;
cargo nextest run -p fub-format-markdown; cargo deny check
Stato: [ ] da fare

## T36 · I promemoria nell'editor

Perché: E10: il promemoria è una pastiglia blu con l'ora nel compito; si
mette dal gruppo Compito della barra, dal «/» e scrivendo.
Tocca: `markdown/livepreview.ts` (la pastiglia), `markdown/block-groups.ts`
(Promemoria nel gruppo Compito, A-7), `markdown/slash.ts` e
`panels/slash/entries.ts` («Promemoria»), l'elenco dei promemoria passati
all'avvio (`apps/client/src/panels/` o la banda: da decidere sul codice),
`skin/editors.css`, `markdown/strings.ts`,
`docs/product/tasks-and-reminders.md`.
Non toccare: il core (T36a); la data a parole (T10: si usa).
Dipende da: T36a, T19, T10; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- `⏰ 2026-11-13 09:00` si vede come pastiglia blu con l'ora (e il giorno se
  non è oggi); il clic apre la scelta di giorno e ora con le parole di T10.
- «Promemoria» nel gruppo Compito e nel «/» («/promemoria venerdì 9»).
- All'avvio l'elenco dei promemoria passati, ognuno con «Apri» e «Fatto».
Dal prototipo: riga 587; passo 6 (Scadenza e Promemoria nel gruppo «Compito»).
Casi limite: un promemoria in un compito spuntato (non notifica); un
promemoria senza ora (le 9); il permesso spento (la pastiglia lo dice al
passaggio); al telefono.
Fatto quando: test della pastiglia e dell'inserimento; un e2e dal «/» al
file; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown
Stato: [ ] da fare

## T37 · Incorporare pagine web

Perché: E7, D6 A: un elenco chiuso di siti (video, mappe, disegni) diventa
un segnaposto «Carica» che apre la pagina nel visore web isolato, mai in un
iframe della shell.
Tocca: `apps/client/src/editors/text/profiles/markdown/web-embed.ts` e il
suo test (nuovi: l'elenco dei siti e il segnaposto), `markdown/media.ts`
(l'embed di un indirizzo), `markdown/paste.ts` («Incorpora» nella scelta di
T25), `apps/client/src/ui/web-viewer.ts` (aprire da un embed: solo
l'aggancio), `apps/client/src/theme/scrittoio/skin/media.css`,
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: la finestra del visore (`fub-viewer` in `fub-app`) e il suo
consenso; il CSP della shell.
Dipende da: T25
Cosa fare:
- Sul disco `![](https://…)`, che Obsidian incorpora a sua volta per i video.
- Un indirizzo di un sito dell'elenco chiuso si vede come segnaposto col
  nome del sito e «Carica»; il clic apre la pagina nel visore isolato col
  consenso di oggi (`viewer.hosts`). Fuori dall'elenco resta un link o una
  scheda.
- Nessuna rete all'apertura della nota.
Dal prototipo: la sezione E7, D6 A (nessun passo del giro lo mostra).
Casi limite: un sito nell'elenco ma rifiutato dalla persona; un indirizzo
`http:`; un indirizzo con parametri di tracciamento; la Lettura; l'export
(un link).
Fatto quando: test dell'elenco e del segnaposto; un test che nessun iframe
entra nella shell; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/web-embed.test.ts
Stato: [ ] da fare

## T38 · La tipografia italiana

Perché: E7, D8 A: spenta di serie; accesa, « », —, … e ’ mentre si scrive,
fuori da codice, formule e incolla.
Tocca: `apps/client/src/editors/text/profiles/markdown/typography.ts` e il
suo test (nuovi), `markdown/profile.ts` (l'aggancio),
`crates/fub-host/src/settings.rs` (`editor.typography`),
`markdown/strings.ts`, `docs/product/editor-writing.md`.
Non toccare: l'incolla (non si trasforma); le altre lingue (la regola segue
la lingua della nota o dell'app: da verificare).
Dipende da: onda 1 in `main`; mai con un task di un altro piano su
`settings.rs`
Cosa fare:
- `"` diventa « o » secondo il posto; `--` diventa —; `...` diventa …;
  l'apostrofo diventa ’.
- Mai in codice, formule, link, frontmatter, nell'incolla e nell'IME.
- Backspace subito dopo rimette ciò che si era scritto.
Casi limite: virgolette annidate; un apostrofo a inizio parola; `---` (il
separatore resta); Vim; testo arrivato in un colpo.
Fatto quando: un test per regola e per ogni luogo dove non vale.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/typography.test.ts
Stato: [ ] da fare

## T39 · La pagina del giorno

Perché: E17: in fondo alla giornaliera, reso e non scritto: i compiti che
scadono, le note con quella data in una proprietà («Stesso giorno»), le
note create e cambiate quel giorno.
Tocca: `crates/fub-features/src/template/view.rs` o una vista nuova accanto
(la giornaliera c'è già in `template`), `crates/fub-features/src/backlinks.rs`
(«Stesso giorno», se sta lì), `markdown/livepreview.ts` (il fondo reso, come
widget dopo l'ultima riga), `skin/editors.css`, `markdown/strings.ts`,
`docs/product/tasks-and-reminders.md`.
Non toccare: il file della giornaliera (non si scrive niente); il provider
dei compiti (T19a: si interroga).
Dipende da: T19; mai con N6 T22 o T42, la griglia T2–T3, PA T56
Cosa fare:
- In fondo alla giornaliera tre gruppi chiusi su richiesta: Compiti di
  oggi, Stesso giorno, Create e cambiate; da `query_index`, una volta
  all'apertura e dopo un evento dell'indice, mai per battuta.
- Non è nel file, né in ciò che si copia, né nell'export.
Casi limite: una giornaliera di un giorno passato o futuro; un vault senza
giornaliere; mille note cambiate in un giorno (un tetto); il fuso.
Fatto quando: un test con `MemoryHost`; un test DOM che il fondo non entra
nel testo; le foto del banco.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
template; cd apps/client && npx vitest run src/editors/text/profiles/markdown
Stato: [ ] da fare

## T40 · La Scrivania

Perché: E17: una vista a riquadri (appuntate, recenti, compiti di oggi, una
Base, il mese) che si ordina trascinando.
Tocca: `crates/fub-features/src/dashboard.rs` (una vista principale
dichiarata accanto a quella del cassetto), `crates/fub-host/src/settings.rs`
(l'ordine dei riquadri, vault), `apps/client/src/ui/views.ts` (il
trascinamento dei riquadri, se la resa dei `UiNode` non lo ha),
`apps/client/src/theme/scrittoio/skin/nodes.css`, `i18n/catalog.ts`,
`docs/product/tasks-and-reminders.md`.
Non toccare: la WIT (i `UiNode` di oggi; se manca un nodo, il task si ferma
e lo scrive); la dashboard del cassetto.
Dipende da: T19, T16; mai con un task di un altro piano su `settings.rs` o
`ui/views.ts`
Cosa fare:
- «Scrivania» (dallo spazio comandi e dal menu Vista): appuntate, recenti,
  compiti di oggi, una Base scelta, il mese; ogni riquadro si toglie e si
  rimette.
- Trascinare un riquadro lo sposta; da tastiera Ctrl Maiusc ↑↓; l'ordine è
  un'impostazione del vault.
Casi limite: nessuna nota appuntata; la Base scelta cancellata; finestra a
700 px (una colonna); al telefono.
Fatto quando: un test della vista e dell'ordine; le foto del banco.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
dashboard
Stato: [ ] da fare

## T41a · L'ospite delle schede passa in `editors/core`

Perché: A-6, regola 1: un ospite delle schede solo, quello di N6, portato
in `editors/core` perché lo usino lavagna e nota, senza copie.
Tocca: `apps/client/src/editors/canvas/cards.ts` e
`apps/client/src/state/card-editors.ts` (di N6: si spostano in
`apps/client/src/editors/core/cards/`, con un nome da decidere sul codice
di allora), `apps/client/src/editors/canvas/cards/note.ts`, `image.ts`,
`pdf.ts`, `web.ts` (in `editors/core/cards/kinds/`),
`apps/client/src/editors/grid/card.ts` (resta del foglio: cambia solo
l'import), `apps/client/src/editors/canvas/engine.ts` (gli import),
`apps/client/src/editors/core/bootstrap.ts` (la registrazione delle specie),
i loro test, `apps/client/src/canvas-edit.e2e.test.ts` (resta verde, gli
import cambiano), `docs/reference/canvas-cards.md` (di N6: il posto nuovo),
`docs/map/repo.md`.
Non toccare: il comportamento (nessuna riga di logica cambia: è uno
spostamento); la nota (T41).
Dipende da: N6 in `main` (le schede, la modifica sul posto, il foglio vivo,
gli estratti: N6 T42, T43, T44, T93, T96 compresi); onda 1 in `main`
Cosa fare:
- Sposta l'ospite, il registro delle specie e le specie in
  `editors/core/cards/`; la lavagna li importa da lì. Nessuna API nuova:
  l'ospite espone ciò che espone oggi.
- `data-card-kind` e `data-card-mode` (`snapshot`, `live`) restano il
  contratto, come in `docs/reference/canvas-cards.md`.
- Una guardia (un test di struttura) che nessun file di `editors/canvas/`
  ridefinisca l'ospite.
Casi limite: una specie registrata da un plugin; l'ordine di registrazione
all'avvio; la shell al telefono.
Fatto quando: `canvas-edit.e2e.test.ts` e i test di N6 passano senza cambiare
asserzioni; `check-listeners` verde; la guardia c'è.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-edit.e2e.test.ts src/editors/core src/editors/canvas
Stato: [ ] da fare

## T41 · L'ospite delle schede nella nota

Perché: E19, D15 A: ogni file incorporato in una nota (`![[file]]`) è una
scheda viva: si guarda, e con un gesto si modifica sul posto con l'editor
del suo formato. Tre stati, la testata, una attiva alla volta.
Tocca: `apps/client/src/editors/text/profiles/markdown/live-cards.ts` e il
suo test (nuovi: l'ospite di `editors/core/cards/` montato come widget di
blocco), `markdown/media.ts` e `markdown/livepreview.ts` (gli embed che
diventano schede), `markdown/block-groups.ts` (il gruppo della scheda, A-7),
`apps/client/src/theme/scrittoio/skin/live-cards.css` e
`apps/client/src/theme/scrittoio/anatomia/live-cards.ts` (nuovi pezzi della
pelle; `skin/order.ts` e `anatomia.ts` li elencano, A-7),
`markdown/strings.ts`, `i18n/lexicon.ts` (Scheda viva),
`docs/product/live-cards.md` (nuovo), `docs/README.md`.
Non toccare: l'ospite (`editors/core/cards/`, T41a: si usa com'è; se manca
qualcosa, il task si ferma e lo scrive); le specie (T43–T47).
Dipende da: T41a, T3, T26a
Cosa fare:
- A riposo: un'istantanea col nome del file in testa; la rotella scorre la
  nota, mai la scheda; nessun calcolo e nessuna scrittura partono da soli.
- Scelta: un clic sul bordo o sulla maniglia, o le frecce a blocchi accesi;
  Invio la attiva; Canc toglie l'embed dalla nota, mai il file.
- Attiva: un clic dentro o Invio; bordo d'accento e «Esc per uscire» nella
  testata; tasti, rotella e selezione sono della scheda e la riga dei
  suggerimenti dice i suoi tasti; Esc o un clic fuori esce e lascia la
  scheda scelta. Una sola attiva alla volta. Al tocco si attiva col tocco e
  si lascia con «Fine» (T26a).
- La testata: icona della specie, nome del file e parte mostrata; al
  passaggio o da attiva «Apri» e «A tutta pagina»; il resto nel menu del
  blocco. Il contesto della scheda lo mostra la barra di formato, con lo
  stesso codice della riga delle opzioni di N6 (A-6, regola 2).
- L'annulla: dentro la scheda attiva annulla nel file della scheda; nella
  nota ciò che è della nota.
- I limiti: fuori vista restano istantanee; al più quante ne tiene vive la
  lavagna; file mancante («File mancante: …», «Ritrova…», «Togli dalla
  nota»); formato senza superficie («SPECIE · percorso» e «Apri»); oltre tre
  livelli di nota che include sé stessa la scheda diventa un link.
- Il provider Markdown non cambia: legge e scrive l'embed com'è.
Dal prototipo: righe 699 e 748; passi 16, 17 e 18.
Casi limite: venti schede in una nota; il file aperto anche in una
linguetta (una sessione, due superfici); il componente del formato spento;
un formato aggiunto da un plugin; la nota in sola lettura (le schede si
guardano); finestra a 700 px e al telefono.
Fatto quando: montare e smontare venti volte senza ascoltatori rimasti;
attivare, scrivere, uscire, annullare; file mancante; componente spento;
venti schede vive con la battuta nel budget; le foto del banco per stato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/live-cards.test.ts
src/canvas-edit.e2e.test.ts
Stato: [ ] da fare

## T42 · Misura, «Mostra come», affiancare con le colonne

Perché: E19: la larghezza (colonna, larga, tutta la pagina), l'altezza col
bordo, la misura scritta come Obsidian la capisce (`|LxA`, A-15), «Mostra
come» e le schede affiancate con le colonne che l'editor ha già.
Tocca: `markdown/live-cards.ts` e il suo test, `markdown/media.ts` (la
misura nell'embed), `markdown/callout.ts` (le colonne `[!columns]`: solo
ciò che serve per affiancare due schede), `skin/live-cards.css` (la sua
sezione, A-7), `markdown/strings.ts`, `docs/product/live-cards.md`.
Non toccare: le specie; l'ospite.
Dipende da: T41
Cosa fare:
- Larghezza: la colonna del testo, larga (64 px oltre, come la Base) o
  tutta la pagina; altezza della specie, cambiata trascinando il bordo in
  basso; nel file `![[Percorso.canvas|640x300]]`.
- «Mostra come»: scheda, link, riga (icona e nome).
- Affiancare: trascinando una scheda sul fianco di un'altra («Accanto» di
  T2a) o con «Affianca»: le colonne `[!columns]`, da due a quattro; al
  telefono tornano una sotto l'altra.
Dal prototipo: riga 748; passo 17.
Casi limite: una misura scritta da Obsidian (`|300`, solo larghezza); una
misura assurda (`|0x0`); un'immagine (la misura di oggi resta); cinque
schede da affiancare (quattro al più, e lo dice).
Fatto quando: test della misura scritta e riletta; un test DOM di
«Affianca»; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/live-cards.test.ts
Stato: [ ] da fare

## T43 · La scheda di foglio nella nota

Perché: E21: le celle di un intervallo coi formati del file; da attiva si
modificano con l'editor dei fogli sulla stessa sessione; la nota non cambia
di un byte.
Tocca: la specie foglio dell'ospite (`editors/grid/card.ts` di N6, in forma
di scheda di nota), `apps/client/src/tabella/adapter.ts` (`TableCaps` dice che
cosa la scheda concede), `apps/client/src/panels/format-bar.ts` (il contesto
«Foglio C3 860 €», con lo stesso codice della riga delle opzioni di N6),
`crates/fub-format-xlsx/src/` (le parti: foglio, intervallo, nome definito,
tabella del file), `skin/live-cards.css` (la sua sezione, A-7),
`markdown/strings.ts`, `docs/product/live-cards.md`.
Non toccare: il motore dei fogli e GridCraft (si usano); l'editor delle
note non importa il motore (`check-tabella-boundary.mjs`).
Dipende da: T41
Cosa fare:
- `![[Conti.xlsx#Budget!A1:E7]]`: la parte è un foglio, un intervallo, un
  nome o una tabella; senza parte il foglio attivo dalla prima cella usata.
- A riposo i valori salvati: aprire la nota non ricalcola e non scrive; un
  valore non ricalcolato porta il segno del foglio.
- Da attiva: selezione, Ctrl C a tabulazioni; Invio, F2, doppio clic o un
  carattere modificano la cella; alla conferma GridCraft ricalcola e il file
  si salva con la sua revisione.
- Lettere e numeri di riga solo da attiva; righe, colonne, formati e
  grafici in «Apri».
- «Intervallo non trovato: Budget!A1:E7» con «Scegli di nuovo».
Dal prototipo: riga 699; passo 16.
Casi limite: il foglio aperto in una linguetta con modifiche non salvate
(le due superfici mostrano lo stesso stato); un intervallo che cresce (lo
segue solo un nome o una tabella); un file aperto da Excel e riaperto;
venti schede di foglio vive.
Fatto quando: modificare una cella dalla nota e rileggere il file; la stessa
cella da due superfici; venti schede vive con la battuta nel budget, come il
cancello di N6.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-format-xlsx; cd
apps/client && npx vitest run src/editors/grid
Stato: [ ] da fare

## T44 · La scheda di documento

Perché: E20: `.docx` e `.odt` nella nota: il testo reso in continuo, senza
pagine; da attiva si scrive con l'editor dei documenti, stili e
impaginazione restano i suoi.
Tocca: `apps/client/src/editors/core/cards/kinds/document.ts` e il suo test
(nuovi), la registrazione delle specie (A-7), la superficie dei documenti in
forma di scheda (`apps/client/src/editors/rich/`: solo ciò che la monta
senza pagine), `skin/live-cards.css` (la sua sezione, A-7),
`docs/product/live-cards.md`.
Non toccare: il formato dei documenti; l'editor delle note.
Dipende da: T41
Cosa fare:
- A riposo il testo reso in continuo; da attiva l'editor dei documenti sulla
  stessa sessione del file.
- La parte `#Titolo`: da verificare per prima sul codice (l'artifact la dice
  «da verificare in T41»); se il modello dei documenti non regge una
  sezione, la scheda mostra tutto il documento e la parte resta scritta.
Dal prototipo: passo 17.
Casi limite: un documento di cento pagine (istantanea troncata con «Apri»);
il componente spento; il documento aperto in una linguetta.
Fatto quando: una scena del banco nei tre stati e nelle due luci; un test che
scrivere nella scheda salva il documento e non la nota.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/core/cards
Stato: [ ] da fare

## T45 · La scheda PDF

Perché: E20: una pagina intera, «2 / 6»; si sfoglia e si sceglie il testo;
`#page=3`.
Tocca: la specie PDF dell'ospite (`editors/core/cards/kinds/pdf.ts`, di N6),
`apps/client/src/editors/media/pdf-view.ts` (la vista in forma di scheda:
solo ciò che serve), `skin/live-cards.css` (la sua sezione, A-7),
`docs/product/live-cards.md`.
Non toccare: gli estratti (T49); PdfCraft.
Dipende da: T41
Cosa fare:
- A riposo la pagina della parte (`#page=3`, di serie la prima) con «2 / 6»;
  da attiva si sfoglia e si sceglie il testo.
- La pagina dove si è, lo scorrimento e lo zoom sono stato della vista, non
  del file.
Dal prototipo: passo 17.
Casi limite: un PDF protetto; un PDF di mille pagine; `#page=` oltre la fine;
il componente spento.
Fatto quando: una scena del banco nei tre stati; un test della parte.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/core/cards src/editors/media/pdf-view.test.ts
Stato: [ ] da fare

## T46 · Il disegno che si modifica sul posto

Perché: E20: un disegno `.svg` nella nota oggi è un'immagine ferma (ADR
0203); diventa una scheda che si disegna sul posto: penna, forme, testo.
Tocca: `apps/client/src/editors/core/cards/kinds/drawing.ts` e il suo test
(nuovi), la registrazione delle specie (A-7), l'editor dei disegni in forma
di scheda (`apps/client/src/editors/spatial/`: solo ciò che lo monta senza
la colonna degli strumenti), `skin/live-cards.css` (la sua sezione, A-7),
`docs/product/live-cards.md`; un ADR in `docs/decisions/` che aggiorna
la 0203.
Non toccare: il formato dei disegni.
Dipende da: T41
Cosa fare:
- A riposo il disegno fermo; da attiva la penna, le forme e il testo, con la
  barra della selezione; il resto in «A tutta pagina».
- Ciò che cambia della 0203 lo dice un ADR nuovo.
Dal prototipo: passo 17.
Casi limite: un `.svg` che non è un disegno di Fub (resta immagine ferma);
un disegno grande; il componente spento.
Fatto quando: una scena del banco nei tre stati; un test che disegnare nella
scheda salva il disegno e non la nota.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/core/cards
Stato: [ ] da fare

## T47 · La lavagna nella nota

Perché: E25, D15 A: dove serve lo spazio libero un pezzo di nota è una
lavagna (`![[Percorso della visita.canvas|640x300]]`): a riposo si vede
tutta, da attiva è la lavagna di N6 sulla stessa sessione.
Tocca: la specie lavagna (`editors/core/cards/kinds/canvas.ts`, nuova, che
monta `editors/canvas/` in forma di scheda), la registrazione delle specie
(A-7), `markdown/slash.ts` e `panels/slash/entries.ts` («Lavagna»),
`skin/live-cards.css` (la sua sezione, A-7), `i18n/lexicon.ts` (Zona
lavagna), `docs/product/live-cards.md`.
Non toccare: il formato `.canvas`; il motore della lavagna oltre la forma di
scheda.
Dipende da: T41; Q2 (D15)
Cosa fare:
- A riposo tutta la lavagna adattata alla scheda; la rotella scorre la nota.
- Da attiva: spostare le schede, tirare i fili, la penna, con la barra
  della selezione e senza la colonna degli strumenti (che sta in «A tutta
  pagina»).
- «Lavagna» nel «/» ne crea una accanto alla nota e la apre già attiva.
Dal prototipo: passo 18.
Casi limite: una lavagna che incorpora la nota stessa (oltre tre livelli un
link); una lavagna vuota; una lavagna enorme; il moto ridotto.
Fatto quando: spostare una scheda nella zona e rileggere il `.canvas`; la
rotella che scorre la nota a riposo; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/core/cards src/canvas-edit.e2e.test.ts
Stato: [ ] da fare

## T48 · Dalla nota alla lavagna, e ritorno

Perché: E25: «Porta su una lavagna» e «Porta in una nota»; trascinare una
scheda fra una nota e una lavagna affiancate.
Tocca: `crates/fub-features/src/lavagna.rs` (i due comandi, col piano su più
documenti di T32a), `crates/fub-features/tests/` (l'e2e),
`markdown/blocks/drop-targets.ts` (la lavagna a lato come bersaglio),
`markdown/strings.ts`, `docs/product/live-cards.md`.
Non toccare: il formato `.canvas`; l'ospite.
Dipende da: T47, T32a
Cosa fare:
- «Porta su una lavagna» su una scelta di blocchi e schede: una lavagna con
  una scheda per blocco, nello stesso ordine, aperta a lato; i file
  incorporati restano gli stessi.
- «Porta in una nota» dalla lavagna: le schede in colonna, da in alto a
  sinistra a in basso a destra; i fili diventano link.
- Trascinare una scheda fra nota e lavagna affiancate la sposta; con Ctrl la
  copia. Due file, un annulla (T32a).
Dal prototipo: passo 18.
Casi limite: un blocco che è un titolo con sotto una sezione; una lavagna
con gruppi; un filo verso una scheda di file; la revisione cambiata.
Fatto quando: andata e ritorno nota, lavagna, nota con lo stesso testo;
l'annulla rimette i due file.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
lavagna
Stato: [ ] da fare

## T49 · Gli estratti nella nota e «Annota»

Perché: E25: un pezzo di un file legato alla sua fonte (un passo di PDF,
una sezione di nota, un intervallo, un ritaglio), fatto con «Estrai»; la
penna non sta mai nella nota: «Annota» avvolge la scheda in una zona
lavagna.
Tocca: gli estratti di N6 (`apps/client/src/editors/canvas/parts.ts` e
`parts-picker.ts`: si usano dalla nota; **differenza dall'artifact**, che
li chiama `excerpt.ts`), `markdown/live-cards.ts` («Estrai», «Vai al
passo»), `markdown/media.ts` (il subpath dell'embed), la specie lavagna
(«Annota»), `markdown/strings.ts`, `docs/product/live-cards.md`.
Non toccare: il formato degli estratti di N6 (`fub:parts`, N6 T73); PdfCraft.
Dipende da: T45, T47; per gli estratti di PDF, PdfCraft (come in N6)
Cosa fare:
- «Estrai» dalla scheda attiva mette sotto una citazione con la fonte; la
  fonte è il subpath dell'embed (`#page=2&selection=…`, `#^id`,
  `#Budget!A1:B3`).
- «Vai al passo» apre la fonte col passo evidenziato; se il passo non si
  trova più: «Passo non trovato» e «Vai alla pagina».
- «Annota» avvolge la scheda in una zona lavagna con dentro quella scheda;
  l'inchiostro resta attaccato alla pagina (`fub:ink`).
- Senza PdfCraft gli estratti di PDF non ci sono e lo dicono; note, fogli e
  immagini sì.
Dal prototipo: passo 18.
Casi limite: la fonte cambiata dopo l'estratto; la fonte cancellata; un
estratto di un estratto; «Annota» su una scheda già in una zona.
Fatto quando: un estratto dopo che la fonte è cambiata; «Annota» che scrive
il `.canvas` e non la nota.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/live-cards.test.ts src/editors/canvas
Stato: [ ] da fare

## T50 · La Tabella prende i gesti del foglio

Perché: E22: i gesti che oggi stanno solo nel motore del foglio
(`editors/grid/engine.ts`, `shortcuts.ts`) passano nella Tabella condivisa
(`apps/client/src/tabella/`, decisione 0225), e li prendono anche le note.
Tocca: `apps/client/src/tabella/keys.ts`, `navigation.ts`, `selection.ts`,
`commands.ts`, `clipboard.ts`, `frame/frame.ts`, `conformance.ts` e i loro
test, `apps/client/src/editors/grid/engine.ts` e `shortcuts.ts` (cedono le
regole alla Tabella), `markdown/table-grid.ts` (le capacità della tabella
Markdown), `apps/client/src/theme/scrittoio/skin/tabella.css`,
`docs/product/editor-tables.md` (nuovo: i gesti della Tabella, in note,
documenti e fogli), `docs/product/editor-and-preview.md` (è alla soglia:
ciò che dice delle tabelle passa nella pagina nuova e resta il rimando),
`docs/README.md`.
Non toccare: il confine (`check-tabella-boundary.mjs` resta verde: l'editor
delle note non importa il motore dei fogli); i gesti nuovi (T51).
Dipende da: S2 in `main`; mai con N6 T42 o la griglia T2–T3
(`editors/grid/`)
Cosa fare:
- Maiusc Spazio sceglie la riga, Ctrl Spazio la colonna, tutti e due la
  tabella.
- Ctrl con una freccia si ferma al bordo dei dati.
- Con più celle scelte, Invio e Tab girano dentro la selezione.
- Il segno del taglio: le celle tagliate restano tratteggiate finché non si
  incolla; Esc rinuncia.
- Ctrl D riempie in giù, Ctrl R a destra; Ctrl + e Ctrl − inseriscono e
  tolgono righe o colonne secondo ciò che è scelto; più intervalli insieme
  (Maiusc F8).
- Il moto di E22 (selezione 120 ms, righe 260 ms, togliere 170 ms, valori
  a cascata 16 ms, annulla al contrario; solo `transform` e `opacity`;
  spento oltre 600 celle e col moto ridotto); il puntatore resta la freccia.
- Ogni gesto riscrive solo la tabella, in un passo d'annullamento; sul
  disco una tabella GFM incolonnata (`\|` in cella, `<br>` per l'a capo).
Dal prototipo: righe 861 e 884; passo 14.
Casi limite: una tabella di una cella; una cella con `\|`; il foglio
(gli stessi gesti, nessuna regressione); il documento; Vim; al tocco
(maniglie agli angoli, tocco lungo, nella barra Tab, Invio e «+ riga»).
Fatto quando: `conformance.ts` allargato prova ogni gesto una volta sui tre
adattatori (Markdown, documento, foglio); una nota con dieci tabelle con la
battuta nel budget; il confine verde.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/tabella src/editors/grid src/editors/text/profiles/markdown/table-grid.test.ts
Stato: [ ] da fare

## T51 · I gesti nuovi, per tabella e foglio

Perché: E22, «Nuove, per tabella e foglio»: il completamento dalla
colonna, le serie di giorni e mesi, la somma come valore, la data di oggi,
le intestazioni che si cliccano.
Tocca: `apps/client/src/tabella/completion.ts` e il suo test (nuovi),
`tabella/series.ts`, `tabella/keys.ts`, `tabella/frame/frame.ts`,
`tabella/conformance.ts` e i loro test, `skin/tabella.css`,
`docs/product/editor-tables.md`.
Non toccare: il motore dei fogli (la somma nel foglio resta la formula di
oggi); il confine.
Dipende da: T50
Cosa fare:
- Il completamento: scrivendo in una cella propone un valore già nella
  colonna col resto selezionato; Invio o Tab accetta, continuare lo ignora,
  Canc lo toglie; solo testo, mai nell'intestazione; la colonna si legge
  quando si apre la cella, non a ogni battuta.
- Le serie di giorni e mesi nella maniglia (lun, mar…; gennaio,
  febbraio…), nella lingua della tabella; il doppio clic riempie fino in
  fondo.
- Alt = scrive la somma delle celle sopra: nella tabella un numero che non
  si aggiorna, e lo dice una volta; nel foglio la formula di oggi.
- Ctrl ; scrive la data di oggi. Alt con le frecce sposta righe o colonne.
- Le intestazioni si cliccano: una lettera sceglie la colonna, un numero la
  riga; trascinarle le sposta. Da verificare prima: se oggi si cliccano, e
  che cosa fa Alt Invio in una cella aperta (l'artifact non l'ha letto).
- Chi scrive `=` in una tabella vede una volta che lì resta testo e che «In
  foglio» porta dove le formule ci sono (T52).
Dal prototipo: riga 884; passo 14.
Casi limite: numeri all'italiana e all'inglese nella somma; una colonna di
mille valori; il completamento con l'IME; mesi in inglese.
Fatto quando: ogni gesto nuovo ha il suo caso in `conformance.ts` e gira sui
tre adattatori; gli appunti con campioni veri di Excel, LibreOffice, Fogli e
Word.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/tabella
Stato: [ ] da fare

## T52 · Tabella in foglio, foglio in tabella, incolla celle

Perché: E23: «Trasforma in foglio» crea `Nome.xlsx` coi valori e mette
l'embed al posto della tabella; «Stacca come tabella» fa il contrario;
celle incollate diventano una tabella.
Tocca: `crates/fub-features/src/` (il comando «Trasforma in foglio», col
piano su più documenti di T32a; il file da scegliere accanto ai comandi dei
fogli), `crates/fub-format-xlsx/src/` (scrivere un foglio coi valori),
`crates/fub-features/tests/` (l'e2e), `markdown/table-grid.ts` (le due voci),
`markdown/paste.ts` («Incolla come scheda»), `markdown/strings.ts`,
`docs/product/live-cards.md`.
Non toccare: il confine di `tabella/`; il motore dei fogli nel client.
Dipende da: T43, T50, T32a
Cosa fare:
- «Trasforma in foglio» (barra della tabella, menu del blocco): crea il file
  accanto alla nota e scrive l'embed dell'intervallo; un comando del core,
  un annulla che rimette la tabella e toglie il file.
- «Stacca come tabella» sulla scheda di foglio: una tabella Markdown coi
  valori mostrati; le formule restano nel foglio, e lo dice; il foglio non
  cambia.
- Celle copiate da un foglio diventano una tabella Markdown; «Incolla come
  scheda» incorpora l'intervallo quando l'origine è un file del vault.
- Una tabella oltre la soglia (si parte da 200 righe o 30 colonne, da
  misurare) propone il foglio.
Casi limite: un nome di file già preso; numeri all'italiana; una cella con
`\|`; l'annulla dopo che il foglio è cambiato (non tocca niente e lo dice).
Fatto quando: andata e ritorno tabella, foglio, tabella coi valori uguali;
l'annulla sui due file.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features -p
fub-format-xlsx
Stato: [ ] da fare

## T53 · Un valore di cella nel testo

Perché: E23: `![[Conti.xlsx#Budget!C7]]` dentro un paragrafo si legge come
valore col formato del foglio («2.520 €») e un tratteggio d'accento sotto.
Tocca: `markdown/livepreview.ts` e `markdown/render.ts` (l'embed in riga di
una cella), `apps/client/src/editors/text/profiles/markdown/cell-value.ts` e
il suo test (nuovi), `skin/live-cards.css` (la sua sezione, A-7),
`docs/product/live-cards.md`.
Non toccare: il motore dei fogli; il provider Markdown.
Dipende da: T43
Cosa fare:
- Il valore col formato del foglio e un tratteggio d'accento; il clic apre
  il foglio su quella cella.
- Segue il file: cambia quando la cella cambia (un evento, non un giro); in
  Lettura è testo come il resto.
- «Mostra come» di una cella sola offre «valore nel testo» (T42).
Casi limite: la cella vuota; un errore di formula (`#DIV/0!` col segno); il
file mancante; cento valori in una nota (la battuta).
Fatto quando: un valore nel testo che cambia quando la cella cambia; la
battuta resta nel budget.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/cell-value.test.ts
Stato: [ ] da fare

## T54 · I grafici: dal foglio e da una tabella

Perché: E23: un grafico del foglio (`![[Conti.xlsx#Grafico spese]]`) lo
disegna GridCraft in SVG e segue i dati; da una tabella Markdown «Grafico da
questa tabella» scrive sotto un blocco Mermaid coi dati di adesso.
Tocca: `crates/fub-format-xlsx/src/objects.rs` (il grafico come parte),
la specie foglio (la parte grafico), `markdown/table-grid.ts` («Grafico da
questa tabella»), `markdown/strings.ts`, `docs/product/live-cards.md`.
Non toccare: Mermaid (si scrive un recinto normale).
Dipende da: T43; mai con T52 (`markdown/table-grid.ts`)
Cosa fare:
- Il grafico del foglio come scheda, disegnato da GridCraft come nel foglio
  aperto, che segue i dati.
- «Grafico da questa tabella»: un recinto Mermaid (`xychart-beta` o `pie`,
  secondo i dati) coi valori di adesso, che si rigenera a richiesta e lo
  dice: non è un grafico vivo.
Casi limite: un grafico che il file nomina ma non c'è; una tabella senza
numeri (la voce non c'è); numeri all'italiana.
Fatto quando: un test della parte grafico; un test del recinto generato.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-format-xlsx
Stato: [ ] da fare

## T55 · La somma nella banda

Perché: E24: con due o più celle numeriche scelte la banda mostra «Somma
2.520 · Media 840 · Conteggio 3» al posto del conto delle parole, uguale
nella tabella Markdown, nella Base e nella scheda di foglio.
Tocca: `apps/client/src/tabella/selection.ts` (la selezione esposta coi
valori mostrati), `apps/client/src/editors/base/surface.ts` (la selezione
della Base, esposta allo stesso modo), `apps/client/src/shells/scrittoio/frame/status-band.ts`
e il suo test, `apps/client/src/shells/scrittoio/frame/selection-sum.ts` e
il suo test (nuovi), `skin/frame.css`, `markdown/strings.ts`,
`docs/product/editor-tables.md`.
Non toccare: il core (nessuna IPC per una selezione); la riga dei
suggerimenti (T14).
Dipende da: T50; mai con un task di un altro piano su `status-band.ts`
Cosa fare:
- I numeri si leggono col formato della tabella (`lang`) o del foglio;
  testo e celle vuote non contano; l'intestazione è esclusa.
- Un clic su un numero lo copia; il menu della banda sceglie che cosa
  mostrare (anche minimo e massimo).
- La scheda di foglio la prende quando arriva (T43): la porta è la stessa.
Dal prototipo: riga 637; passo 15.
Casi limite: numeri italiani e inglesi; celle di testo nella selezione;
una selezione di diecimila celle; una sola cella (niente somma).
Fatto quando: la tabella e la Base con la stessa selezione danno lo stesso
numero (la scheda di foglio con T43); i test dei formati.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/shells/scrittoio/frame src/tabella
Stato: [ ] da fare

## T56 · Misure, prova con Obsidian, documentazione

Perché: E19: «Che cosa si vede di preciso in Obsidian lo dice una prova
(T56), non una promessa»; le schede vive hanno il cancello della battuta.
Tocca: `apps/client/bench/interaction.mjs` (la nota con venti schede vive),
`apps/client/bench/scene.mjs` (le scene per specie), una nota di prova in
`crates/fub-host/tests/fixtures/` o nel vault d'esempio (da scegliere sul
codice), `docs/product/live-cards.md`, `docs/README.md`, `docs/map/*.md`.
Non toccare: il codice delle schede (un difetto trovato è un task o
un'issue).
Dipende da: T41–T55
Cosa fare:
- La battuta su una nota con venti schede vive, misurata e scritta.
- Quante schede vive al più (la misura di N6, 40 da confermare), scritto
  nella pagina.
- La prova con Obsidian: una nota con ogni specie aperta in Obsidian; su
  questa macchina Obsidian non c'è, quindi l'orchestratore chiede all'utente
  di aprire il file di prova (pochi minuti) e scrive l'esito nella pagina:
  che cosa Obsidian incorpora e che cosa diventa link.
- Una scena del banco per specie, nei tre stati, nelle due luci, a 700 px e
  al telefono.
Casi limite: una specie che in Obsidian diventa solo un link (si scrive
così); venti schede di cui una con il file sparito; l'utente che non può
aprire Obsidian (l'esito resta «da provare» nella pagina e in `Stato`).
Fatto quando: i numeri e l'esito sono nella pagina; le guardie dei documenti
verdi.
Prova: scripts/check.sh --rapido; cd apps/client && node
bench/interaction.mjs --only=battuta
Stato: [ ] da fare

## T57 · Diagramma: via la barra, il menu del tasto destro, il gruppo, i tasti

Perché: E26: a riposo e al passaggio solo il disegno; le azioni stanno
nelle tre porte (tasto destro, barra di formato, maniglia e Ctrl O), non
sopra il disegno. Oggi al passaggio compare una barra con lo stile,
«Esporta» e «Schermo intero».
Tocca: `apps/client/src/ui/mermaid.ts` (via la barra; il menu come dati) e
il suo test, `markdown/diagram-live.ts` (il menu della superficie e i
tasti), `markdown/block-groups.ts` (il gruppo «Diagramma», A-7),
`apps/client/src/theme/diagram-style.ts` (lo stile «Questo» e «Tutti»),
`apps/client/src/theme/scrittoio/skin/diagrams.css` e
`apps/client/src/theme/scrittoio/anatomia/diagrams.ts` (nuovi pezzi della
pelle; `skin/order.ts` e `anatomia.ts` li elencano, A-7), `skin/menus.css`
(il menu largo 316 px), `markdown/strings.ts`, `apps/client/bench/scene.mjs`,
`docs/product/editor-diagrams.md` (nuovo), `docs/README.md`.
Non toccare: la sicurezza di Mermaid (SVG inerte, `strict`, 50.000
caratteri, 500 archi); il sorgente affiancato (T58); il tracciato (T59).
Dipende da: onda 1 in `main`
Cosa fare:
- Niente barra, pulsanti né contorno sul diagramma. Con Armonia sta sulla
  pagina senza fondo; gli stili con una carta loro su una tavola con gli
  angoli morbidi. Sotto, la didascalia (T58). A sinistra «+» e maniglia.
- Il menu del tasto destro, largo 316 px: Lo stile (le cinque miniature
  disegnate coi loro colori; il passaggio lo mostra sul diagramma in
  dissolvenza, l'uscita lo rimette, il clic lo sceglie); Vale per
  («Questo» scrive `%% stile: nome` in cima al recinto dopo l'eventuale
  frontmatter di Mermaid, «Tutti» cambia `appearance.diagram-style` e toglie
  il commento; parte da «Questo» se il diagramma ha uno stile suo);
  Orientamento, solo nei flussi («Dall'alto», «Da sinistra», che riscrive
  `flowchart TD` o `LR`); Modifica il sorgente, Ingrandisci, Copia come
  immagine, Esporta.
- Il gruppo «Diagramma» nella barra quando il blocco è scelto o si scrive
  il sorgente: Stile, Sorgente, Ingrandisci. Le stesse voci dalla maniglia e
  da Ctrl O.
- I tasti col blocco scelto: Invio apre il sorgente, Spazio ingrandisce,
  Ctrl C copia.
- «Copia come immagine» mette negli appunti l'immagine, l'SVG e il
  sorgente.
- Cambiare stile è una dissolvenza dei colori di 220 ms; col moto ridotto
  niente.
Dal prototipo: righe 900 e 938; passo 19.
Casi limite: un recinto con frontmatter di Mermaid; un `%% stile:` con un
nome sconosciuto (vale lo stile generale, il menu lo dice); un diagramma
con errore; la sola lettura (lo stile «Questo» non si scrive); dentro una
scheda di nota della lavagna (A-6, regola 3).
Fatto quando: scene del banco a riposo, al passaggio (nessun controllo nel
riquadro), col menu, ogni stile nelle due luci; l'anteprima che torna
indietro uscendo dal menu; `%% stile:` scritto e tolto senza toccare il
resto del recinto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/ui/mermaid.test.ts src/editors/text/profiles/markdown/diagram-live.test.ts
Stato: [ ] da fare

## T58 · Diagramma: sorgente affiancato, errore con la riga, didascalia, misura

Perché: E26: il sorgente si apre accanto al disegno; un errore dice dove;
la didascalia è il `title` del frontmatter di Mermaid; il diagramma non si
rimpicciolisce sotto il 72%.
Tocca: `markdown/diagram-live.ts` e il suo test, `apps/client/src/ui/mermaid.ts`
(la riga dell'errore, la misura, Ingrandisci), `skin/diagrams.css`,
`markdown/strings.ts`, `docs/product/editor-diagrams.md`.
Non toccare: il menu (T57); il tracciato (T59).
Dipende da: T57
Cosa fare:
- Il sorgente accanto al disegno, metà e metà (uno sopra l'altro sotto i
  940 px); il blocco si allarga come le schede. Il disegno si rifà dopo
  300 ms di pausa, come oggi. «Fatto» o Esc chiude.
- Con un errore l'ultimo disegno buono resta, attenuato, e sotto il
  sorgente una riga sola dice dove, in chiaro («Riga 12: questa riga non è
  un nodo né un collegamento»), mai il messaggio grezzo.
- La didascalia: il `title` del frontmatter di Mermaid, sotto il disegno
  coi caratteri della nota; si scrive lì e va nel sorgente; vuota non
  occupa spazio.
- La misura: mai oltre la sua né sotto il 72%; oltre scorre di lato.
  «Ingrandisci» lo apre su tutta la finestra sul fondo del suo stile: la
  rotella ingrandisce, si trascina, Esc o Spazio chiude.
- Un ridisegno entra in 200 ms; se l'altezza cambia i blocchi sotto
  scivolano.
Dal prototipo: righe 938 e 955; passo 19.
Casi limite: un errore senza riga nel messaggio di Mermaid; un sorgente di
50.000 caratteri; il `title` con caratteri speciali; finestra a 700 px e al
telefono.
Fatto quando: test della riga dell'errore e della didascalia scritta nel
sorgente; scene col sorgente con errore e ingrandito.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/diagram-live.test.ts
Stato: [ ] da fare

## T59 · Diagramma: tracciato e punte per ogni stile, orientamento

Perché: E26, «I collegamenti»: ogni freccia arriva al nodo con un tratto
dritto, l'etichetta sta sul tratto lungo, la punta è sottile e tocca il
nodo, i gomiti sono arrotondati, un ritorno gira di lato e rientra dritto.
Nell'app lo fa Mermaid: va ottenuto con le sue opzioni e col CSS di ogni
stile.
Tocca: `apps/client/src/ui/mermaid-styles.ts`, `apps/client/src/ui/mermaid-drawing.ts`
e i loro test, `skin/diagrams.css`, `docs/product/editor-diagrams.md`.
Non toccare: la sicurezza (resta `strict`); il sorgente del diagramma.
Dipende da: T57
Cosa fare:
- Una prova per prima: quali opzioni di Mermaid 11 (curva, `rankSpacing`,
  marcatori) e quale CSS danno il tracciato di E26. Scrivi l'esito in
  `Stato`; ciò che Mermaid non permette si scrive, non si finge.
- Per ognuno dei cinque stili, nelle due varianti, le punte e il tratto.
Dal prototipo: riga 900 (il tracciato è del prototipo, non di Mermaid).
Casi limite: un flusso con un ritorno; etichette lunghe; un diagramma di
sequenza (le regole valgono dove hanno senso); 500 archi.
Fatto quando: scene di un flusso per stile nelle due luci, confrontate a
occhio con la riga 900 e descritte in `Stato`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/ui/mermaid-styles.test.ts
Stato: [ ] da fare

## T60 · Formule: la formula che si modifica toccandola

Perché: E27, D16: di serie il codice non si vede; la formula si apre e
resta una formula, col cursore dentro. È disegnata da KaTeX, come quella
che si legge: in ogni punto dove il cursore può stare un segno invisibile
(`\htmlData`) serve a disegnare il cursore e a capire dove cade un clic.
Tocca: `apps/client/src/editors/text/profiles/markdown/math/` (nuovo:
`points.ts` per i punti del cursore, `caret.ts`, `edit.ts` per le regole
senza DOM, coi loro test e un corpus di formule vere),
`markdown/math-live.ts` e `markdown/math.ts` (il riquadro in riga e il blocco
sul posto), `crates/fub-host/src/settings.rs` (`editor.math.source`),
`apps/client/src/theme/scrittoio/skin/math.css` e
`apps/client/src/theme/scrittoio/anatomia/math.ts` (nuovi pezzi della
pelle; `skin/order.ts` e `anatomia.ts`, A-7), `markdown/strings.ts`,
`docs/product/editor-math.md` (nuovo), `docs/README.md`.
Non toccare: la resa di lettura (KaTeX resta con `trust: false`: `\htmlData`
e il `trust` ristretto valgono solo nella resa del riquadro di modifica);
la tavolozza (T62); il LaTeX a vista (T63).
Dipende da: onda 1 in `main`; mai con un task di un altro piano su
`settings.rs`
Cosa fare:
- La prova per prima: `\htmlData` con KaTeX 0.19 (l'artifact l'ha provato
  sulla 0.16.11), con `trust` ristretto a `htmlData` solo nel riquadro di
  modifica. Se non regge, il task si ferma e lo scrive.
- `points.ts`: i punti buoni dal LaTeX (fra un pezzo e l'altro, mai a metà
  di un comando); scrivere in un punto buono non rompe mai la formula.
- In riga: sotto la formula un riquadro di 392 px; in alto la formula
  grande, dove si scrive; mentre si scrive cambia anche quella nella frase.
  A blocco: si modifica sul posto, col bordo d'accento.
- Il clic porta il cursore nel punto (numeratore, denominatore, esponente,
  radice: decide l'altezza); le frecce attraversano un pezzo alla volta;
  su e giù fra numeratore e denominatore; gli spazi vuoti sono quadretti
  (Tab e Maiusc Tab); lo spazio esce dal pezzo; Backspace non rompe mai la
  formula.
- Una formula aperta e richiusa senza toccarla resta byte per byte.
- `editor.math.source` (spenta) è la chiave che T63 userà; i tasti di Vim e
  la preferenza «elemento» restano com'erano.
- Si annuncia dove si è («numeratore», «esponente di x»).
Dal prototipo: righe 968 e 1021; passo 20.
Casi limite: `\begin{aligned}`; una matrice; una formula con un errore
aperta (si apre col LaTeX); `$` letterali; una formula di 2.000 caratteri;
dentro una cella di tabella; Vim; al telefono.
Fatto quando: la funzione dei punti sul corpus di formule vere, con la
regola che scrivere in un punto buono non rompe mai la formula; clic su
numeratore, denominatore, esponente, radice; il corpus Markdown byte per
byte; le scene nelle due luci e al telefono; la battuta sotto i 4 ms.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
src/editors/text/profiles/markdown/math-live.dom.test.ts
Stato: [ ] da fare

## T61 · Formule: i simboli per nome e i pezzi coi loro spazi vuoti

Perché: E27: una barra rovesciata e le prime lettere (`\alf`) mostrano le
proposte col simbolo disegnato; i pezzi entrano coi loro spazi vuoti.
Tocca: `markdown/math/symbols.ts` e il suo test (nuovi: il catalogo dei
simboli coi nomi italiani e inglesi), `markdown/math/edit.ts`,
`markdown/math-live.ts`, `skin/math.css`, `i18n/lexicon.ts` (i nomi dei
simboli), `docs/product/editor-math.md`.
Non toccare: la tavolozza (T62).
Dipende da: T60
Cosa fare:
- `\` e le prime lettere: le proposte col simbolo disegnato; Invio o lo
  spazio lo mette; il nome si vede in una pastiglia finché non si sceglie,
  mai come codice nella formula.
- I pezzi (frazione, potenza, pedice, radice, sommatoria, integrale,
  limite, testo) entrano coi loro spazi vuoti.
- Ogni simbolo ha il nome in italiano e la sua scrittura veloce.
Casi limite: un nome che non esiste (`\alfa`: la proposta più vicina); un
comando con argomenti; la lingua inglese.
Fatto quando: test del catalogo e delle proposte; ogni pezzo con i suoi
spazi vuoti.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T62 · Formule: la tavolozza e la ricerca a parole

Perché: E27: gli otto pezzi più usati e «Tutti», con sette gruppi e una
ricerca a parole in italiano e in inglese.
Tocca: `markdown/math/palette.ts` e il suo test (nuovi), `markdown/math-live.ts`,
`skin/math.css`, `markdown/strings.ts`, `docs/product/editor-math.md`.
Non toccare: il catalogo (T61: si usa).
Dipende da: T61
Cosa fare:
- Sotto la formula gli otto pezzi e «Tutti»; in fondo il nome del simbolo
  sotto il puntatore.
- «Tutti»: sette gruppi e la ricerca («radice», «alfa», «freccia»,
  «minore»); nella lingua di E29 (tessere, righe).
- Ogni simbolo con il nome in italiano per il lettore di schermo.
Casi limite: una ricerca senza risultati; la finestra stretta; al telefono
(la tavolozza sotto, a tutta larghezza).
Fatto quando: test della ricerca; le scene nelle due luci.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T63 · Formule: «Mostra il LaTeX», la scrittura veloce, le tre misure di aiuto

Perché: E27: la scrittura veloce (`/` frazione, `^` `_`, `*`, `(`, `->`,
`pi`, `3,14`, `"due parole"`) col suo annulla; «Mostra il LaTeX» e le tre
misure di aiuto (`editor.math.help`: Pieni, Discreti, Spenti).
Tocca: `markdown/math/edit.ts` (la scrittura veloce) e il suo test,
`markdown/math-live.ts` (il campo del LaTeX), `crates/fub-host/src/settings.rs`
(`editor.math.help`), `skin/math.css`, `markdown/strings.ts`,
`docs/product/editor-math.md`.
Non toccare: i punti (T60).
Dipende da: T62; mai con un task di un altro piano su `settings.rs`
Cosa fare:
- La tabella della scrittura veloce di E27; ogni trasformazione si annulla
  con Backspace subito dopo.
- «Mostra il LaTeX» (Impostazioni e tre puntini del riquadro): sotto la
  formula il campo del LaTeX; il clic sulla formula porta solo agli spazi
  vuoti.
- Le tre misure col campo: Pieni (parentesi, completamento, scrittura
  veloce, tavolozza al clic), Discreti (parentesi e completamento,
  tavolozza a richiesta), Spenti (il LaTeX e la sua anteprima, nient'altro).
Dal prototipo: passo 21 («Il LaTeX, per chi lo vuole»).
Casi limite: `->` dentro un `\text{}`; `3,14` in inglese; la scrittura
veloce con l'IME.
Fatto quando: ogni tasto della tabella col suo annulla; le tre misure.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T64 · Formule: gli errori in chiaro con la correzione

Perché: E27: dove capitano gli errori, dopo 450 ms di pausa una frase in
chiaro con la correzione quando è una sola; mai il messaggio grezzo.
Tocca: `markdown/math/errors.ts` e il suo test (nuovi),
`markdown/math-live.ts`, `skin/math.css`, `markdown/strings.ts`,
`docs/product/editor-math.md`.
Non toccare: KaTeX.
Dipende da: T63
Cosa fare:
- I messaggi di KaTeX tradotti in frasi: «Manca una } di chiusura» ·
  Chiudi; «Non conosco \alfa. Forse volevi \alpha?» · Usa \alpha.
- Niente lampeggia mentre si scrive; la frase dopo 450 ms.
Casi limite: un errore con più correzioni (nessun pulsante); un errore che
KaTeX non spiega (una frase generica col punto); la lingua inglese.
Fatto quando: un test per messaggio noto di KaTeX.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T65 · Formule: copia e incolla, Invio che allinea, le macro del vault

Perché: E27: una formula incollata coi suoi delimitatori entra senza;
Invio a blocco va a capo e allinea gli uguali; le macro del vault in una
nota normale.
Tocca: `markdown/math/paste.ts` e il suo test (nuovi), `markdown/profile.ts`
(l'aggancio dell'incolla delle formule), `markdown/math-live.ts`,
`markdown/menu.ts` (le voci del tasto destro sulla formula),
`markdown/math.ts` (le macro come premessa), `markdown/strings.ts`,
`docs/product/editor-math.md`, `docs/reference/note-conventions.md`.
Non toccare: `markdown/paste.ts` (T37 corre accanto).
Dipende da: T64
Cosa fare:
- Incollare `\( \)`, `\[ \]` o i dollari: entra senza delimitatori, nel
  riquadro e nella nota.
- Col tasto destro su una formula: Modifica, Copia come immagine, Copia per
  Word (MathML), Copia il LaTeX, Da riga a blocco; al passaggio niente
  sopra.
- A blocco Invio va a capo e allinea gli uguali; Ctrl Invio o Esc finisce.
- Le macro del vault: una nota normale (di serie `Formule/Macro.md`) coi
  suoi `\newcommand`, letta come premessa di ogni formula.
Casi limite: una macro che si chiama da sola; una nota delle macro
illeggibile (si ignora e lo dice); incollare testo con dollari non di
formula.
Fatto quando: test dell'incolla e delle macro; un test della copia per Word.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T66 · Formule: scegliere un pezzo, le celle delle matrici, il tocco

Perché: E27, «Che cosa manca nel prototipo»: scegliere un pezzo di formula
(con Maiusc o trascinando) per copiarlo o metterlo sotto una radice;
passare fra le celle di una matrice con Tab; il tocco.
Tocca: `markdown/math/edit.ts`, `markdown/math/caret.ts` e i loro test,
`markdown/math-live.ts`, `skin/math.css`, `docs/product/editor-math.md`.
Non toccare: la resa di lettura.
Dipende da: T65
Cosa fare:
- Maiusc con le frecce o il trascinamento sceglie un pezzo intero; un pezzo
  scelto si copia o va sotto una radice, una frazione, un esponente.
- In una matrice Tab passa alla cella dopo, Invio alla riga dopo.
- Al tocco: il cursore col dito, la tavolozza sotto, nessun passaggio.
Casi limite: una scelta a metà di una frazione (si allarga al pezzo); una
matrice vuota; al telefono.
Fatto quando: test della scelta e della matrice; le scene al tocco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/text/profiles/markdown/math
Stato: [ ] da fare

## T67 · La prova del motore

Perché: E28, «Il motore»: tre strade; A (la pagina la compone la vista, il
PDF lo scrive Fub) è la consigliata e si prova per prima. È una prova, non
una promessa: se A non regge, il piano della stampa si rifà prima di
spendere il resto.
Tocca: `crates/fub-features/src/pdf_export/` (nuovo: `mod.rs` e lo scrittore
minimo della prova, dietro una feature Cargo `pdf-export` che usa le crate
già nel `Cargo.lock`: `pdf-writer`, `subsetter`, `svg2pdf`, `skrifa`, `lopdf`,
`hayro`), `crates/fub-features/Cargo.toml`, `crates/fub-features/src/lib.rs`
(la registrazione, A-7), `apps/client/src/export/probe.ts` (nuovo: la vista
che impagina una nota e misura le righe), i test della prova, un ADR in
`docs/decisions/` (il numero libero dopo l'ultimo) con la scelta fra A e B.
Non toccare: le due voci di oggi («Stampa», `importers.pdf.single`); la UI
(T70); la WIT; nessuna porta IPC nuova se `invoke_command` e i lavori
bastano (se non bastano, l'ADR lo dice e il task si ferma).
Dipende da: onda 1 in `main`
Cosa fare:
- Una nota vera del vault d'esempio, con titoli, tabella, codice, una
  formula, un diagramma e un'immagine, dall'impaginatore della vista al PDF:
  la vista misura le righe (posizione, carattere, testo) e passa al core un
  elenco di cose con la loro posizione per pagina; il core scrive il PDF con
  testo vero, caratteri incorporati e sotto-insiemi, diagramma e formula in
  vettoriale.
- Il confronto: ogni pagina del PDF ridisegnata con `hayro` e confrontata con
  la pagina della vista entro una tolleranza; il testo estratto dal PDF
  uguale al testo della nota.
- Le misure: quanto costa prendere le righe dalla vista; quanto pesa
  l'elenco di una pagina nel JSON (contro i limiti dell'IPC); quanto ci mette
  il core.
- L'ADR sceglie fra A e B coi numeri; se A non regge, si ferma l'onda 4 e
  l'orchestratore lo dice all'utente.
Casi limite: una riga con due caratteri diversi; un carattere che non si
può incorporare; un'immagine grande; la stessa nota su due macchine (lo
scrive: coincidono sulla macchina che esporta, non fra macchine).
Fatto quando: il PDF della nota di prova passa il confronto con `hayro` e il
testo estratto; l'ADR c'è coi numeri.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export
Stato: [ ] da fare

## T68 · Il modello: profilo, tema di stampa, colori, memoria per nota

Perché: E28: tema, colori, pagina e contenuto stanno nel profilo; lo stile
dato a un diagramma solo per l'esportazione e i blocchi lasciati fuori
stanno nella memoria d'esportazione di quella nota, fuori dal file.
Tocca: `crates/fub-features/src/pdf_export/profile.rs` e
`pdf_export/memory.rs` coi loro test (nuovi), `pdf_export/mod.rs` (A-7),
il mirror TS dei tipi se serve (rigenerato con `UPDATE_MIRROR=1`),
`docs/reference/pdf-export-format.md` (nuovo: `on-disk-layout.md` è alla
soglia e lo rimanda lì con una riga), `docs/reference/on-disk-layout.md`
(la riga), `docs/README.md`.
Non toccare: la nota (non si scrive niente nel file, salvo D17 con T76).
Dipende da: T67
Cosa fare:
- Il profilo: un file JSON con la sua versione, in `.fub/` del vault (il
  posto esatto nella pagina nuova), uno per profilo, che si copia. Un
  profilo di una versione più nuova si legge per ciò che si conosce, il
  resto si conserva e non si riscrive.
- Il tema di stampa e i colori propri (ciò che la persona ha cambiato resta
  cambiando tema ed è segnato «tuo»).
- La memoria per nota: lo stile di un diagramma e i blocchi lasciati fuori,
  riconosciuti da sezione e contenuto; se il blocco cambia, la memoria dice
  che l'esclusione non vale più.
- Una scrittura che fallisce lascia il valore di prima.
Casi limite: un profilo illeggibile; due profili con lo stesso nome; una
nota rinominata (la memoria la segue con la rinomina); una nota cancellata
(la memoria si toglie).
Fatto quando: test del modello coi casi limite; un test che il profilo
futuro conserva i campi sconosciuti.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export
Stato: [ ] da fare

## T69a · Le regole dell'impaginazione, senza DOM

Perché: E28, «Le regole dell'impaginazione»: un titolo non resta solo in
fondo; niente vedove e orfane; tabelle corte, figure, formule, riquadri e
diagrammi non si spezzano; una tabella lunga continua con l'intestazione; il
codice si spezza fra le righe; ciò che è più alto di una pagina si
rimpicciolisce e la pagina lo dice. È la parte senza DOM di T69 (A-3).
Tocca: `apps/client/src/export/paginate/` (nuovo: `rules.ts`, `breaks.ts`,
`model.ts` coi test e un corpus di note misurate a mano),
`docs/product/pdf-export.md` non ancora (nasce con T70): le regole stanno nei
commenti e nei test.
Non toccare: la misura col DOM (T69b); il core.
Dipende da: T67
Cosa fare:
- L'impaginatore lavora su scatole con altezza, righe e regole («tieni col
  seguito», «non spezzare», «ripeti l'intestazione», «spezza fra le righe»)
  e dà le pagine.
- Le regole sempre, senza interruttori; le interruzioni a mano (ogni Titolo
  2, il separatore, D17) come scatole speciali.
- Le note al margine accanto al loro paragrafo; con margini stretti o due
  colonne vanno in fondo da sole.
Casi limite: una pagina di un titolo solo; una tabella di una riga più alta
della pagina; un paragrafo di due righe a fine pagina; due colonne; una nota
vuota.
Fatto quando: ogni regola ha un test sul corpus, senza DOM.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export/paginate
Stato: [ ] da fare

## T69b · L'impaginatore sulla vista, a fette

Perché: E28: la vista misura le scatole e impagina; le note lunghe vanno a
fette, prima le pagine che si vedono; obiettivo da misurare: la pagina sotto
gli occhi aggiornata entro 100 ms anche in una nota di 200 pagine.
Tocca: `apps/client/src/export/paginate/measure.ts` e `slices.ts` coi loro
test (nuovi), `apps/client/src/editors/media/print-view.ts` (la resa per la
stampa che c'è: solo ciò che serve a misurarla),
`apps/client/bench/interaction.mjs` (i tempi su 5, 50 e 200 pagine).
Non toccare: le regole (T69a); il core.
Dipende da: T69a
Cosa fare:
- La resa per la stampa si chiede al core una volta, all'apertura; la vista
  misura le scatole (paragrafi riga per riga) e passa a `rules.ts`.
- A fette: prima le pagine che si vedono, poi le altre nei tempi morti;
  finché non ha finito il totale è «…» e l'indice aspetta i suoi numeri.
- Due velocità: colori e link cambiano solo variabili (nessuna nuova
  impaginazione); caratteri, margini, formato e contenuto la rifanno.
- Diagrammi e immagini che non arrivano entro il tempo (`PRINT_WAIT_MS`):
  il riquadro col nome e «non disegnato».
Casi limite: una nota cambiata in un altro riquadro durante l'impaginazione
(segue la revisione nuova e tiene le regolazioni); un'immagine che non
arriva; 200 pagine.
Fatto quando: i tempi su 5, 50 e 200 pagine misurati e scritti; un test delle
fette; un test che il cambio di colore non rifà l'impaginazione.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export/paginate src/editors/media/print-view.test.ts
Stato: [ ] da fare

## T70 · Lo spazio «Esporta in PDF»

Perché: E28: uno spazio a tutta finestra, nessun pulsante «Aggiorna»: a
sinistra le pagine come usciranno, a destra le regolazioni, in fondo la
banda; «Stampa…» manda al sistema le stesse pagine.
Tocca: `apps/client/src/export/space.ts`, `export/pages.ts`,
`export/toolbar.ts`, `export/band.ts`, `export/sections/index.ts` (l'elenco
delle sezioni, A-7) coi loro test (nuovi),
`apps/client/src/theme/scrittoio/skin/export.css` e
`apps/client/src/theme/scrittoio/anatomia/export.ts` (nuovi pezzi; `order.ts`
e `anatomia.ts`, A-7), `apps/client/src/panels/document.ts` (la voce
«Esporta in PDF…» nel menu «…» del riquadro, accanto a «Stampa», verso la
riga 1260) e un comando di shell che apre lo spazio (`registerShellCommand`,
così lo trova lo spazio comandi), `editors/media/print-view.ts`
(«Stampa…»), `i18n/catalog.ts`,
`apps/client/bench/scene.mjs`, `docs/product/pdf-export.md` (nuovo),
`docs/README.md`.
Non toccare: le sezioni (T71–T76 ne scrivono una ciascuno); lo scrittore
(T77a).
Dipende da: T69b, T68, T81
Cosa fare:
- In alto: «Torna alla nota», lo zoom, tre viste (una pagina, due
  affiancate, tutte in miniatura), il profilo, «Esporta». Sotto, le pagine
  su un fondo neutro. A destra le dieci sezioni che si aprono e si chiudono;
  chiusa, ogni sezione dice in testa ciò che vale adesso. In fondo la banda:
  pagine, formato, margini, segnalibri, millisecondi dell'impaginazione.
- Si apre da «…» › «Esporta in PDF…» e dallo spazio comandi; Esc torna alla
  nota. All'apertura la nota si salva.
- Mentre si trascina un controllo il pannello non si ridisegna: cambiano
  solo le pagine.
- «Stampa…» manda alla stampa del sistema le stesse pagine.
- Accessibilità: ogni controllo ha il suo nome, gli interruttori dicono lo
  stato, tutto da tastiera, la banda annuncia il numero di pagine quando
  cambia.
Dal prototipo: righe 1040–1213; passi 28 e 29.
Casi limite: una nota vuota; la nota cambiata in un altro riquadro; la
finestra a 700 px; al telefono (una prima forma, col pannello sotto); il
moto ridotto.
Fatto quando: un e2e apre lo spazio, cambia vista e torna; le foto del banco
nelle due luci, a 700 px e al telefono.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T71 · Temi e colori

Perché: E28: otto temi di stampa (Fub, Classico, Relazione, Rivista,
Accademico, Quaderno, Essenziale, Notte); undici colori uno per uno; bianco
e nero, risparmio d'inchiostro; il contrasto; l'anteprima al passaggio e
«dove sta questo colore».
Tocca: `apps/client/src/export/themes.ts` e il suo test (nuovi),
`export/sections/theme.ts` e `export/sections/colors.ts` (nuovi),
`export/sections/index.ts` (A-7), `skin/export.css`, `i18n/catalog.ts`,
`docs/product/pdf-export.md`.
Non toccare: il tema dell'app (si stampa chiaro anche al buio).
Dipende da: T70
Cosa fare:
- Gli otto temi con colori, caratteri e impostazione; il passaggio su un
  tema lo mostra sulle pagine prima di sceglierlo.
- Undici colori (carta, testo, titoli, accento, link, testo secondario,
  linee, evidenziato, riquadri, codice, intestazioni di tabella): tondi
  pronti, selettore libero, codice a mano. Il passaggio su un colore
  contorna i punti dove è usato.
- Il contrasto fra testo e carta avvisa sotto 4,5 a 1, l'accento sotto 3 a
  1, ricalcolato a ogni colore.
- Ciò che la persona cambia resta cambiando tema, segnato «tuo» con «torna
  al tema», uno per uno o tutti.
Dal prototipo: passo 28.
Casi limite: Notte (carta scura) all'esportazione; un colore scritto male;
bianco e nero con un diagramma colorato.
Fatto quando: test dei temi e del contrasto; un test che il colore cambia
solo variabili; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T72 · Caratteri e pagina

Perché: E28: i caratteri di Fub e del vault incorporati; corpo, interlinea,
scala dei titoli; formati, margini con le guide, colonne, specchio,
filigrana.
Tocca: `export/sections/fonts.ts`, `export/sections/page.ts`,
`apps/client/src/export/guides.ts` e i loro test (nuovi),
`export/sections/index.ts` (A-7), `crates/fub-features/src/pdf_export/fonts.rs`
e il suo test (nuovo: i caratteri del vault e il permesso d'incorporarli),
`pdf_export/mod.rs` (A-7), `skin/export.css`, `i18n/catalog.ts`,
`docs/product/pdf-export.md`.
Non toccare: i caratteri dell'app.
Dipende da: T70, T77a
Cosa fare:
- Carattere del testo e dei titoli fra quelli di Fub e del vault; corpo,
  interlinea, scala; paragrafi staccati o col rientro; allineamento,
  giustificato, sillabazione, titoli numerati.
- A4, A5, A3, Lettera e una misura propria; verticale o orizzontale; una o
  due colonne; margini coi numeri, coi tre pronti o trascinando le guide
  sulla pagina con la misura accanto al puntatore; a specchio; filigrana.
- Un carattere del vault che non permette d'incorporarlo: avviso, e si
  ricade su quello di Fub.
Dal prototipo: passo 28.
Casi limite: un carattere senza corsivo; una misura propria assurda;
margini più larghi della pagina.
Fatto quando: test delle guide e del permesso dei caratteri; le foto del
banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export; cargo nextest run -p fub-features pdf_export
Stato: [ ] da fare

## T73 · Testata e piè, frontespizio, indice, segnalibri

Perché: E28: sei posti per testata e piè; frontespizio; indice coi numeri
di pagina veri; segnalibri nel PDF.
Tocca: `export/sections/header-footer.ts`, `export/sections/cover-toc.ts`
(nuovi), `export/sections/index.ts` (A-7), `export/paginate/toc.ts` e il suo
test (nuovi: l'indice in due passate), `skin/export.css`, `i18n/catalog.ts`,
`docs/product/pdf-export.md`.
Non toccare: le regole delle interruzioni (T69a).
Dipende da: T70
Cosa fare:
- Sei posti (sinistra, centro, destra, sopra e sotto), in ognuno: titolo,
  sezione corrente, data, pagina, «pagina di pagine», autore, percorso, un
  testo proprio. Filo sotto la testata, prima pagina senza testata, numeri
  romani per frontespizio e indice.
- Frontespizio con titolo, icona, proprietà in evidenza, chi e quando.
- Indice coi numeri veri fino ai Titoli 2 o 3; i segnalibri nel PDF (lo
  scrittore li scrive, T77a).
Dal prototipo: passo 29.
Casi limite: una nota senza titoli (niente indice); l'indice più lungo di
una pagina; una sezione corrente vuota.
Fatto quando: test dell'indice in due passate; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T74 · Il contenuto

Perché: E28, la sezione Contenuto: proprietà, commenti, link, compiti,
ripiegabili, trasclusioni, schede vive, Base, tabelle, codice.
Tocca: `export/sections/content.ts` (nuovo), `export/sections/index.ts`
(A-7), `apps/client/src/export/content/` (nuovo: un modulo per specie di
blocco, coi test), `skin/export.css`, `i18n/catalog.ts`,
`docs/product/pdf-export.md`.
Non toccare: i commenti e le schede nell'editor (si leggono dalla resa).
Dipende da: T70; T21 per i commenti e T41 per le schede (senza, quei
blocchi escono come oggi)
Cosa fare:
- Proprietà (nessuna, in evidenza, tutte); commenti (no, nel margine, in
  fondo); link (colorati, sottolineati, come il testo); compiti fatti;
  ripiegabili aperti o chiusi; trasclusioni svolte con la provenienza;
  schede vive (l'anteprima, solo il nome, o per un PDF tutte le sue pagine
  in coda); tabelle a linee, a righe alterne, a griglia; codice con le
  righe numerate; i blocchi lasciati fuori.
Dal prototipo: passo 29.
Casi limite: una trasclusione di sé stessa; una Base di mille righe (la
tabella continua con l'intestazione); un commento in una cella.
Fatto quando: un test per voce; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T75 · Diagrammi e formule in vettoriale

Perché: E28, la sezione Diagrammi: lo stile Mermaid per l'esportazione,
quello di un solo diagramma, quattro colori dati a mano; diagrammi e
formule in vettoriale.
Tocca: `export/sections/diagrams.ts` (nuovo), `export/sections/index.ts`
(A-7), `apps/client/src/export/vectors.ts` e il suo test (nuovi: l'SVG di
diagrammi e formule passato al core), `skin/export.css`, `i18n/catalog.ts`,
`docs/product/pdf-export.md`.
Non toccare: `%% stile:` nella nota (resta quello della nota).
Dipende da: T70, T59
Cosa fare:
- Lo stile per l'esportazione: come nella nota, come il tema di stampa, o
  uno dei quattro stili col fondo; uno stile diverso per un diagramma solo
  (nella memoria della nota, T68); quattro colori a mano (nodi, decisioni,
  inizio e fine, linee) che vincono sullo stile; fondo sì o no.
- Diagrammi e formule entrano nel PDF come vettori (`svg2pdf`), col testo
  selezionabile dove il disegno lo ha.
Dal prototipo: passo 29.
Casi limite: un diagramma con errore (l'ultimo disegno buono o il riquadro
«non disegnato»); una formula enorme (si rimpicciolisce e lo dice).
Fatto quando: un test dei vettori; le foto del banco.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T76 · Il clic sulla pagina

Perché: E28: un clic su un blocco della pagina apre le sue regolazioni:
«Comincia qui una pagina nuova», «Lascia fuori dal PDF», lo stile di quel
diagramma, «Regola: …» che apre la sezione giusta, «Vai al blocco nella
nota».
Tocca: `apps/client/src/export/block-actions.ts` e il suo test (nuovi),
`export/paginate/breaks.ts` (l'interruzione a mano), il riconoscimento di
`<!-- pagina -->` nella resa per la stampa, `markdown/strings.ts`,
`docs/product/pdf-export.md`, `docs/reference/note-conventions.md`.
Non toccare: le altre sezioni.
Dipende da: T70; Q2 (D17)
Cosa fare:
- Il menu del blocco sulla pagina, nella lingua di E29.
- «Comincia qui una pagina nuova» (D17 A, Q2): scrive `<!-- pagina -->`
  prima del blocco nella nota, invisibile altrove, con un annulla della
  nota; il separatore continua a voltare pagina.
- «Lascia fuori dal PDF»: nella memoria della nota (T68).
Dal prototipo: passo 29.
Casi limite: un blocco che è già il primo della pagina; la nota in sola
lettura (la pagina nuova non si scrive e lo dice); un blocco escluso che
poi cambia.
Fatto quando: un test per voce; un test che `<!-- pagina -->` volta pagina e
non si vede nell'editor né in Lettura.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/export
Stato: [ ] da fare

## T77a · Lo scrittore del PDF

Perché: E28: il core scrive il PDF dagli elenchi di pagina della vista:
testo vero che si seleziona e si cerca, caratteri incorporati, vettori,
immagini, link interni, segnalibri, dati del documento; un lavoro che si
annulla; il file arriva intero o non arriva.
Tocca: `crates/fub-features/src/pdf_export/writer.rs`, `text.rs`,
`images.rs`, `outline.rs` coi loro test (nuovi), `pdf_export/mod.rs` (A-7),
il comando d'esportazione e il suo lavoro (`invoke_command`, i lavori del
core: nessuna porta nuova), `crates/fub-features/tests/pdf_export_e2e.rs`
(nuovo), `docs/reference/pdf-export-format.md`.
Non toccare: lo scrittore dei disegni (`crates/fub-features/src/draw/pdf.rs`:
si riusa ciò che si può, senza cambiarne il comportamento); i tag e PDF/A
(T77b).
Dipende da: T67
Cosa fare:
- Testo coi caratteri incorporati in sotto-insieme (`subsetter`), vettori
  (`svg2pdf`), immagini (piene o alleggerite), link interni e verso fuori,
  segnalibri, titolo, autore e lingua dai dati della nota.
- Un lavoro col suo stato nel centro attività, che si annulla; il file si
  scrive in un temporaneo e si rinomina alla fine: arriva intero o non
  arriva.
- I limiti: pagine, peso dell'elenco, tempo; oltre, un errore tipato.
Casi limite: il disco pieno; l'annullamento a metà; un'immagine rotta; un
percorso d'uscita in sola lettura; un carattere senza glifi per un testo.
Fatto quando: l'e2e scrive un PDF, lo rilegge con `lopdf` e `hayro`, trova
testo, link e segnalibri; l'annullamento non lascia file.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export
Stato: [ ] da fare

## T77b · PDF accessibile e PDF/A

Perché: E28, «Accessibilità»: titoli, elenchi, tabelle con le celle
d'intestazione, testi alternativi, lingua e ordine di lettura marcati;
PDF/A per l'archivio.
Tocca: `crates/fub-features/src/pdf_export/tags.rs` e `pdfa.rs` coi loro
test (nuovi), `pdf_export/mod.rs` (A-7), `pdf_export/writer.rs` (solo gli
agganci), `docs/reference/pdf-export-format.md`.
Non toccare: la vista.
Dipende da: T77a
Cosa fare:
- La struttura dei tag dagli elenchi della vista (la vista dice la specie
  di ogni cosa); il testo alternativo delle immagini; la lingua.
- PDF/A: i caratteri tutti incorporati, il profilo di colore, i metadati;
  ciò che PDF/A non permette lo dice prima di scrivere.
- Un controllo d'accessibilità sul file nei test.
Casi limite: un'immagine senza testo alternativo (avviso); una tabella
senza intestazione; un diagramma.
Fatto quando: un test della struttura dei tag; un controllo PDF/A sul file
(con lo strumento che si trova nel workspace; se non c'è, scritto in
`Stato`).
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export
Stato: [ ] da fare

## T78 · Più note in un PDF

Perché: E28: una cartella o una selezione, ogni nota un capitolo, un indice
solo, i link fra note che diventano interni. Sostituisce il vecchio
esportatore di solo testo per l'export di tutto il vault.
Tocca: `crates/fub-features/src/pdf_export/book.rs` e il suo test (nuovi),
`pdf_export/mod.rs` (A-7), `export/space.ts` (più note), il menu
dell'albero («Esporta in PDF…» su una cartella o una selezione:
`apps/client/src/panels/explorer.ts`), `crates/fub-importers/src/export_pdf.rs`
(il vecchio resta finché questo non regge, poi si toglie con T80),
`docs/product/pdf-export.md`.
Non toccare: lo scrittore oltre `book.rs`.
Dipende da: T70, T77a; mai con PA T43 (`panels/explorer.ts`)
Cosa fare:
- Ogni nota un capitolo nell'ordine dell'albero o della selezione; un
  indice solo; i link fra le note esportate diventano interni, gli altri
  restano verso fuori.
- Un lavoro solo, che si annulla.
Casi limite: cento note; una nota che non si legge (si salta e lo dice);
due note con lo stesso titolo; un link a una nota non esportata.
Fatto quando: un e2e con tre note e i link interni che portano al posto
giusto.
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export
Stato: [ ] da fare

## T79 · I profili e l'esportazione come comando

Perché: E28: i profili si salvano, si copiano, si danno come predefinito a
un tipo di nota; «esporta questa nota col profilo X», anche via MCP, senza
aprire lo spazio.
Tocca: `crates/fub-features/src/pdf_export/command.rs` e il suo test
(nuovi: il comando coi parametri nota e profilo), `pdf_export/mod.rs` (A-7),
`export/toolbar.ts` (il menu del profilo: salva, copia, rinomina,
predefinito), `export/headless.ts` (nuovo: l'impaginazione fuori schermo
quando il comando arriva ad app aperta), `i18n/catalog.ts`,
`docs/product/pdf-export.md`, `docs/reference/mcp-server.md` (il comando).
Non toccare: lo spazio oltre il menu del profilo.
Dipende da: T70, T68, T77a; il predefinito per tipo aspetta T33 in `main`
(prima vale il predefinito del vault)
Cosa fare:
- Il menu del profilo nella barra dello spazio.
- Il comando: ad app aperta la shell impagina fuori schermo e il core
  scrive; senza l'app (il server MCP da solo) risponde con un errore tipato
  che chiede l'app aperta. Come la vista impagina fuori schermo lo dice T67.
Casi limite: un profilo che non c'è; un profilo futuro; il comando su una
nota aperta con modifiche non salvate (si salva prima).
Fatto quando: un test del comando ad app aperta e senza; un test del
predefinito per tipo (con T33).
Prova: scripts/check.sh --rapido; cargo nextest run -p fub-features
pdf_export; cd apps/client && npx vitest run src/export
Stato: [ ] da fare

## T80 · Misure, banco, documentazione; le due voci di oggi

Perché: E28: chiudere la stampa con le misure, il banco e le pagine; e
decidere che cosa resta delle due voci di oggi («Stampa» e «Esporta come
PDF»).
Tocca: `docs/product/pdf-export.md`, `docs/reference/pdf-export-format.md`,
`docs/product/import-and-export.md`, `apps/client/bench/scene.mjs`,
`apps/client/bench/interaction.mjs`,
`apps/client/src/editors/text/profiles/markdown/exports.ts` (la voce
`importers.pdf.single` di oggi), `apps/client/src/panels/document.ts`
(«Stampa» del menu «…», `presentPrint`),
`crates/fub-importers/src/export_pdf.rs` (si toglie se T78 regge),
`docs/README.md`.
Non toccare: lo spazio e lo scrittore (un difetto è un task o un'issue).
Dipende da: T67–T79
Cosa fare:
- «Esporta come PDF» apre lo spazio; l'id `importers.pdf.single` resta come
  sinonimo del comando nuovo (chi lo chiama via MCP non si rompe); il vecchio
  esportatore di solo testo si toglie.
- «Stampa» resta «Stampa…» dello spazio.
- I tempi su 5, 50 e 200 pagine nella pagina; le scene nelle due luci, a
  700 px e al telefono; la nota che resta byte per byte.
Casi limite: chi chiama `importers.pdf.single` via MCP coi parametri
vecchi (il sinonimo li accetta o risponde con un errore tipato); un
profilo salvato prima di T80; la stampa senza nessuna stampante.
Fatto quando: le guardie dei documenti verdi; nessuna strada vecchia
rimasta senza un sinonimo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T81 · I menu: una lingua sola

Perché: E29: il menu del tasto destro è un componente solo
(`ui/menu.ts`, `showContextMenu`) con un'anatomia che c'è già; cambia
l'aspetto, in un posto, e quindi cambia insieme in ogni editor (note,
documenti di Word, fogli, lavagne, Basi, PDF, immagini). Il «/» ha trovato
la lingua giusta e i menu la prendono.
Tocca: `apps/client/src/ui/menu.ts` e `ui/menu.test.ts`,
`apps/client/src/ui/menu-cases.ts` (i posti che mancano fra quelli del
passo 30), `apps/client/src/ui/icons.ts` (le tre icone di «Copia come»),
`apps/client/src/theme/scrittoio/skin/menus.css`,
`apps/client/src/theme/scrittoio/anatomia/menus.ts`,
`apps/client/src/i18n/catalog.ts`, `apps/client/bench/scene.mjs` e
`bench/motion.mjs` (A-7), `docs/product/editor-menus.md`.
Non toccare: `MenuItem`, `ContextMenuOptions`, `SurfaceMenu` (restano come
sono); le voci degli editor (`contextMenu(at)` in
`apps/client/src/editors/core/registry.ts` e i loro file) e la
composizione in `apps/client/src/panels/editor-menu.ts`; il lanciatore
(T82); il «/» (T84); i pezzi del kit (T83 li estrae dopo).
Dipende da: T23; mai con un task di un altro piano su `ui/menu.ts` o
`skin/menus.css`
Cosa fare:
- La lingua, nel componente: la barra a parti per gli appunti (Taglia,
  Copia, Incolla) con un fondo tenue, angoli da 11 e la parte scelta come
  linguetta chiara e rialzata che scivola; righe di una linea sola, 34 px,
  con icona, nome e a destra in monospazio grigio la scorciatoia o la
  freccia del sottomenu, mai una seconda riga di spiegazione; etichette di
  gruppo quiete a 11,5 px; la testata di una riga («Cella · C3 ·
  Conti.xlsx»: icona d'accento, la specie in grassetto, il nome in grigio);
  il piede, una fascia tenue con «Scrivi per trovare altro».
- Una scelta fra pochi formati sta nella riga: «Copia come» ha accanto le
  tre icone (la M con la freccia in giù, le parentesi angolari con la
  barra, il foglio di sole righe); il nome del formato compare nella riga
  al passaggio o con le frecce («Copia come Markdown»); il nome del
  pulsante lo dice a chi ascolta; ← e → cambiano icona, Invio copia. Vale
  per ogni voce con due o tre alternative che hanno un segno riconoscibile;
  altrimenti resta il sottomenu.
- Una scelta sola fra barra ed elenco: ciò che è acceso resta acceso
  quando il puntatore esce; mai due cose accese insieme; ↑ dalla prima riga
  sale alla barra, ↓ dall'ultima ci torna, ← e → cambiano parte. Aperto col
  mouse non accende niente; dal tasto Menu o da Maiusc F10 parte dalla
  prima voce; Maiusc col tasto destro dà il menu del sistema (regole di
  oggi, da non perdere).
- Scrivere a menu aperto riempie il piede e filtra: prima le voci del menu,
  poi «Altri comandi»; la nota non riceve le lettere; Backspace torna
  indietro (oggi c'è: si ridisegna, non si rifà).
- La mini-barra resta sulla selezione; se il menu le finirebbe sopra, si
  mette in testa al menu. Da una griglia il menu prende il fuoco.
- Il moto: mai più di un quinto di secondo; il menu nasce dal punto del
  clic; testata, tessere e righe arrivano a 15 ms di distanza; la scelta è
  una pastiglia che scivola; un sottomenu entra da destra e torna da
  sinistra; una parte premuta risponde con una spunta d'accento prima che
  il menu si chiuda; l'uscita è una dissolvenza breve, ferma. Con «meno
  movimento» niente si muove. Gli altri menu dell'app prendono la pastiglia
  che scivola, non l'entrata a scalare.
- I tasti per muoversi nel menu (frecce, Invio, Esc) non si scrivono nel
  menu: li mostra la riga dei suggerimenti (T14 aggiunge il contesto «menu
  aperto» quando arriva); fino ad allora non ci sono, come oggi.
Dal prototipo: passi 30 e 11.
Casi limite: un menu con un solo gruppo; un sottomenu dentro un sottomenu;
una voce con la scorciatoia tolta dalla persona (la destra resta vuota);
l'inglese con nomi lunghi; il menu al bordo dello schermo; al tocco (il
sottomenu si apre al posto del menu, come oggi col dito); il contrasto
del grigio delle scorciatoie nelle due luci; il menu aperto da una cella
di foglio.
Fatto quando: le scene di `ui/menu-cases.ts` rifotografate nelle due luci,
a 700 px e col dito, per ogni editor; un test della scelta sola fra barra
ed elenco; un test di «Copia come» da tastiera; il moto a fotogrammi fermi
in `bench/motion.mjs`; il contrasto delle scorciatoie misurato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/ui/menu.test.ts src/ui/menu-budget.test.ts src/panels/editor-menu.test.ts
Stato: [ ] da fare

## T82 · Lo spazio comandi nella stessa lingua

Perché: E9 ed E29: il campo della barra in alto si apre nello stesso punto,
non è una finestra che arriva da un'altra parte; sotto, sei ambiti come
tessere piccole; a sinistra i risultati di una riga; a destra l'anteprima
che cambia con la specie; i tasti nella banda. Nello Scrittoio lo spazio
comandi è il lanciatore (`shells/scrittoio/launcher/`), che prende anche
`shell.switcher` (Ctrl O) e `shell.palette`; `panels/quick-switcher.ts` è
la shell comune e non si ridisegna.
Tocca: `apps/client/src/shells/scrittoio/launcher/launcher.ts`,
`launcher/launcher.css`, `launcher/preview.ts` (solo il disegno: i dati
sono di T13) e `launcher/launcher.test.ts`,
`apps/client/src/shells/scrittoio/frame/pill.ts` e `pill.test.ts` (il
campo che si apre sul posto), `apps/client/src/theme/scrittoio/skin/launcher.css`,
`apps/client/src/theme/scrittoio/anatomia/launcher.ts`,
`apps/client/src/i18n/catalog.ts`, `apps/client/bench/scene.mjs` e
`bench/motion.mjs` (A-7), `docs/product/command-space.md` (nato con T13).
Non toccare: `launcher/model.ts`, `sources.ts`, `actions.ts` (T13);
`ui/menu.ts` (T81); `apps/client/src/panels/quick-switcher.ts`; la porta
dei suggerimenti (si usa com'è).
Dipende da: T13, T81, T14
Cosa fare:
- Il campo della pillola si allarga sul posto in campo di ricerca; sotto,
  le sei tessere degli ambiti (Tutto, `>` Comandi, `#` Etichette, `@`
  Persone e giorni, `/` Blocchi, `?` Aiuto), quella attiva d'accento.
- I risultati: una riga ciascuno, 38 px, icona, nome con le lettere trovate
  in evidenza, a destra in grigio ciò che serve (la cartella, la
  scorciatoia, la sintassi di un blocco). La scelta è la pastiglia che
  scivola di T81.
- L'anteprima per specie: una nota è un piccolo foglio col suo testo; un
  comando dice che cosa fa, la scorciatoia e in quale menu sta; un blocco
  ha lo stesso disegno del «/» (T84 quando c'è; prima l'icona e la
  sintassi).
- I tasti non stanno nel pannello: il lanciatore pubblica il suo contesto
  sulla porta di T14 e la banda li mostra, cambiando con la riga.
- Il moto come T81; col moto ridotto niente.
Dal prototipo: riga 558; passo 11.
Casi limite: la finestra a 700 px (l'anteprima sparisce, come oggi); al
telefono (la cornice del telefono ha il suo lanciatore: si ridisegna con
le stesse regole, `docs/architecture/phone-frame.md`); una risposta lenta
(le righe grigie di oggi restano); l'inglese; la tessera scelta col
prefisso scritto.
Fatto quando: le scene del banco a campo vuoto, con un prefisso, con
l'anteprima di nota, comando e blocco, nelle due luci, a 700 px e al
telefono; un test che i tasti arrivano alla banda e non stanno nel
pannello.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/shells/scrittoio/launcher src/shells/scrittoio/frame/pill.test.ts
Stato: [ ] da fare

## T83 · Tessera, etichetta e riga nel kit; le guardie

Perché: E29: tessera, etichetta e riga diventano pezzi del kit, usati dal
menu, dallo spazio comandi e dal «/», perché le tre superfici non tornino a
divergere; una guardia conta voci e gruppi; una guardia tiene le tre porte.
Tocca: `apps/client/src/kit/tile.ts`, `kit/row.ts`, `kit/group-label.ts`
e i loro test (nuovi), `apps/client/src/kit/index.ts`, `kit/kit.css`,
`apps/client/src/theme/scrittoio/skin/kit.css`,
`apps/client/src/theme/scrittoio/anatomia/kit.ts`, `apps/client/src/ui/menu.ts`
(usa i pezzi, senza cambiare ciò che si vede), `ui/menu-budget.test.ts`
(c'è già: si allarga a ogni posto di `ui/menu-cases.ts`),
`apps/client/src/editors/text/profiles/markdown/three-doors.test.ts`
(nuovo), `apps/client/bench/scene.mjs` (A-7),
`docs/product/editor-menus.md`, `docs/development/testing-and-quality.md`
(le due guardie nella matrice).
Non toccare: il lanciatore e il «/» (li portano sui pezzi T82 e T84, ognuno
il suo); i contratti dei menu.
Dipende da: T81
Cosa fare:
- I tre pezzi con le misure di T81 (tessera 40 px con angoli da 11, riga di
  34 px o 38 nello spazio comandi, etichetta quieta a 11,5 px) e i loro
  stati (accesa, premuta, spenta con il perché); `ui/menu.ts` li usa, e le
  foto di T81 non cambiano.
- `menu-budget.test.ts`: al massimo nove voci e quattro gruppi al primo
  livello per ogni posto, nessun tasto per muoversi scritto dentro un menu.
- `three-doors.test.ts`: per ogni specie di blocco con un gruppo (A-9), le
  stesse azioni dal tasto destro, dalla barra di formato e da maniglia e
  Ctrl O; nessun pulsante sopra un blocco a riposo.
- Rifotografa i menu per ogni editor (A-11).
Casi limite: una tessera senza icona; una riga con un nome lunghissimo; la
tessera premuta col moto ridotto.
Fatto quando: i test dei pezzi; le due guardie che falliscono su un caso
finto e passano sul vero; le foto di T81 uguali.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/kit src/ui/menu-budget.test.ts
src/editors/text/profiles/markdown/three-doors.test.ts
Stato: [ ] da fare

## T84 · Il «/» in una colonna

Perché: E7: il «/» è una colonna sola, larga 352 px, che copre poco testo:
in alto i sei più usati come tessere, poi le righe a gruppi con la sintassi
a destra, in fondo il disegno del blocco scelto; scrivendo, un elenco solo.
Spariscono le linguette delle sezioni, le due righe per voce e
l'anteprima a destra.
Tocca: `apps/client/src/panels/slash/panel.ts`, `entries.ts`, `rank.ts`,
`quick.ts`, `prefs.ts`, `preview.ts` e i loro test,
`apps/client/src/theme/scrittoio/skin/menus.css` (la parte del «/», oggi
`.cm-tooltip.slash-panel` 620 × 400), `apps/client/src/theme/scrittoio/anatomia/menus.ts`,
`markdown/strings.ts`, `apps/client/bench/scene.mjs` (A-7),
`docs/product/editor-menus.md` («Il «/» nel testo»).
Non toccare: `panels/slash/pickers/` (le scelte dopo il «/», come la
data); la porta dei suggerimenti (si usa com'è); le voci dei blocchi che
nascono con altri task (Base, Compiti, Trasclusione, Blocco di un'altra
nota, Promemoria, le schede vive: ognuno aggiunge la sua voce in
`entries.ts` col suo task).
Dipende da: T83, T14
Cosa fare:
- Una colonna di 352 px. In alto sei tessere (i pezzi di T83) coi blocchi
  più usati nel vault, all'inizio Attività, Titolo, Riquadro, Tabella, Base,
  Scheda; l'ordine segue l'uso (`rank.ts`); a menu appena aperto Invio mette
  il primo.
- Sotto, le righe a gruppi con la sintassi a destra in grigio; i titoli dei
  gruppi restano in cima mentre si scorre; `editor.slash.sections` ordina i
  gruppi invece delle linguette, `editor.slash.hidden` toglie le voci come
  oggi.
- In fondo il disegno del blocco scelto (`preview.ts`).
- Scrivendo: un elenco solo, ordinato, coi sinonimi; in fondo «Cerca fra
  tutti i comandi».
- I tasti (frecce, Tab per il gruppo dopo, Esc che lascia il testo
  scritto) li mostra la banda: il «/» pubblica il suo contesto sulla porta
  di T14.
- Il menu segue il cursore mentre la nota scorre e si chiude se il cursore
  esce dalla parola (oggi lo fa: da non perdere).
- Via la versione a due colonne e il suo stile.
Dal prototipo: riga 794; passo 7.
Casi limite: un vault nuovo senza uso (vale l'ordine scritto sopra); una
voce nascosta fra le sei; nessun risultato; l'inglese; il «/» a fondo
finestra (si apre sopra); al telefono (la forma di oggi a tutta larghezza
sopra la tastiera); `editor.slash` spento.
Fatto quando: le scene del banco a menu aperto, scrivendo e senza
risultati, nelle due luci; un test dell'ordine per uso; un test che i tasti
arrivano alla banda; nessuna classe della versione a due colonne rimasta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/panels/slash
Stato: [ ] da fare
