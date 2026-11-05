# Piano: K6 · Il disegno completo sul motore vettoriale

Branch: piano/k6-disegno-completo
Obiettivo: nei disegni (`.svg`) lo spazio di lavoro Completo diventa
l'editor vettoriale intero. Si raggiungono in Fub tutte le funzioni del
motore del disegno (VectorCraft alla revisione `cfb30d81`):

- 100 strumenti;
- 881 comandi del motore;
- 397 voci della sua interfaccia;
- 130 effetti;
- 43 pannelli.

Sono 1551 righe in `crates/fub-disegno/mappa.tsv`, ognuna fatta, servita da
Fub o esclusa con un perché. Le funzioni hanno l'interfaccia di Fub (la
cornice di Scrittoio 2, il kit, i token), non quella del motore. Fub carica
solo le famiglie di funzioni che si usano, mai il motore intero all'avvio.
Sono i tre punti che il manutentore ha chiesto il 2026-11-05:

1. la parità completa, con la mappa intera e niente tolto in silenzio;
2. il caricamento pigro, misurato e con il suo cancello;
3. l'interfaccia di Fub.

Il piano li porta nelle sezioni «Che cosa si vede», nei task e nel cancello.
Perché: K5 fa passare dal motore gli strumenti semplici del disegno (sposta,
forme, testo, colori), ma il Completo resta quello scritto a mano in
TypeScript, che non arriva a un editor professionale. Il motore c'è già e
sa tutto: K6 lo apre per intero, a pezzi, dentro la casa di Fub.
Fuori scope:
- la lavagna sul motore (N6);
- il profilo PDF, che tiene i suoi strumenti (ADR 0231 §3);
- l'inchiostro dentro il motore: i tratti a mano libera restano `fub:ink`, e
  la penna di Fub resta come «Inchiostro» (D5);
- l'inclinazione della penna (K5 D-12);
- telefono e tablet: K6 è per il computer; a 700 px funziona, sotto resta il
  Semplice;
- i plug-in WebAssembly di terzi del motore, finché un'ADR non li ammette
  (D9);
- l'MCP del motore;
- modificare i file `.vectorcraft`, che restano in sola lettura
  (`docs/product/craft-files.md`);
- il buco `#view-panel-stats`, che è di Scrittoio 2;
- le 12 righe escluse, ognuna con il suo perché (D6).
Assunzioni: A1–A16 qui sotto. Le ha scelte il pianificatore il 2026-11-05,
senza il manutentore. D1–D12 aspettano le sue risposte e non bloccano le
prime ondate.
Ondate: T1 T2 T4 | T28 T6 | T3 | T5 T30 | T7 T27 | T8 | T9 | T10 | T11 | T12 T13 T14 T15 T16 T17 T18 T19 T20 T21 T22 T23 T26 | T24 T25 | T29

Quando parte che cosa:
- tutto parte con K5 fuso in main, che porta con sé K2 e K3;
- T6 e i task grafici partono dopo il sì al prototipo e con Scrittoio 2 fuso;
- T27 parte dopo la risposta a D10, T30 dopo D11, T23 e T26 dopo D9, T24
  dopo D8 (vedi «Chi aspetta chi»). Se una risposta tarda, il task scivola
  in un'ondata dopo, e chi lo aspetta con lui;
- T7, T8, T9 e T10 vanno uno alla volta: toccano gli stessi file della
  cornice (`editors/spatial/strings.ts`, `completo/index.ts`,
  `apps/client/bench/fake-ipc.ts` e `scene.mjs`, e T7–T9 anche
  `crates/fub-features/src/draw.rs`);
- T11 va da solo: le altre famiglie ne dipendono;
- nell'ondata delle famiglie, due alla volta, partono prima T18 e T23, che
  sbloccano T24 e T25. T25 parte dopo T23. Non corrono mai insieme T12 e
  T15, T12 e T17, T22 e T23, T22 e T25, T23 e T26 (A13).

Prototipo: `PLAN-ui/disegno-completo.html`; approvato: —. Lo mostra
all'utente l'orchestratore, con D1–D12, e scrive qui la data del sì.

## Modifiche

nessuna

## Dal prototipo

Il prototipo è `PLAN-ui/disegno-completo.html`: l'editor dentro la cornice
di Scrittoio 2, presa dal suo prototipo (`origin/piano/scrittoio-2`,
`fe4d84c4`). Usa i token veri, in giorno e notte, a 1280 e a 700 px.

Gli stati si scelgono con `?stato=`:

- completo, gruppo, cassetto, menu, finestra, tavolozza;
- risorse, solo a piena larghezza;
- spazio, vuoto, caricamento, errore, spento.

In fondo alla pagina, «I pezzi» dà a ogni pezzo la sua destinazione. I
percorsi sono sotto `apps/client/src/`, se non è scritto altro.

| Pezzo | Destinazione | Task |
|---|---|---|
| `colonna`, `colonna-gruppo`, `colonna-penna`: 6 gruppi, 15 caselle, «Tutti gli strumenti» in fondo | `kit/tool-rail.ts` e `editors/spatial/tools/editor/chrome/rail.ts` (ci sono); gruppi e caselle da `editors/spatial/completo/colonna.ts` (nuovo) | T8 |
| `tendina-penna`: il gruppo che si apre dalla casella | `kit/tool-rail.ts`, `kit/popover.ts`, `kit/list.ts` (ci sono) | T8 |
| `colonna-cassetto`, `cassetto`: «Tutti gli strumenti», con ricerca e gruppi | `editors/spatial/tools/editor/chrome/drawer.ts` (nuovo), `kit/popover.ts` | T8 |
| `opzioni-punto`: la fila delle opzioni, dalle `options()` dello strumento | `editors/spatial/tools/editor/toolbar.ts` (Scrittoio 2 T22 lo rifà), `editors/spatial/completo/opzioni.ts` (nuovo) | T8 |
| `menu-disegno`, `menu-oggetto`, `menu-tracciato`: ≡ e i suoi sottomenu | `ui/menu.ts`, `editors/spatial/tools/editor/chrome/commands.ts` (ci sono) | T9 |
| `dlg-comandi`: Ctrl+/ su tutti i comandi | `editors/spatial/tools/editor/chrome/command-search.ts` (c'è), `kit/dialog.ts` | T9 |
| `menu-spazi`, `menu-spazi-spento` | `editors/spatial/tools/editor/chrome/workspace.ts` (c'è), `ui/menu.ts`, `editors/spatial/completo/spazi.ts` (nuovo) | T7 |
| `banda`, `banda-aperta`: la voce «Spazio di lavoro» | `#status-workspace` in `apps/client/index.html`, `shells/scrittoio/frame/status-band.ts` (di Scrittoio 2 T3), `SurfaceWorkspace` in `editors/core/registry.ts`, `editors/spatial/tools/editor/chrome/status.ts` | T7 |
| lo stato `spento`: colonna corta, spazi spenti, «Apri Componenti…» | `chrome/workspace.ts`, `chrome/rail.ts`, la porta di K5 T24 che apre Componenti sulla riga | T7 |
| `tab-risorse`, `tab-risorse-scelta`, `titolo-design`, `titolo-risorse` | la scheda `resources` in `editors/spatial/tools/editor/stage.ts` e `chrome/hosts.ts`; l'ispettore la mostra com'è (`shells/scrittoio/frame/document-panels.ts`, `ui/views.ts`, di Scrittoio 2 T9) | T10 |
| `design-punto`, `design-vuoto`: Design, con la sezione Documento quando non c'è selezione | `editors/spatial/tools/properties.ts` (c'è), `registraSezione` in `editors/spatial/completo/sezioni.ts` (nuovo) | T10 |
| `pannello-risorse`, `pannello-risorse-molti` | `editors/spatial/tools/resources-panel.ts` (nuovo), `chrome/hosts.ts` | T10; i contenuti: campioni T14, stili T15, pennelli T17, simboli T22 |
| `dlg-sposta`, `dlg-ombra-caricamento`, `dlg-ombra-errore` | `kit/dialog.ts` (c'è), `kit/form.ts` (nuovo, da `ui/form-dialog.ts`), `editors/spatial/motore/finestre.ts` (nuovo) | T6 |
| gli stati `caricamento` ed `errore` di una famiglia | `editors/spatial/completo/carica.ts` (nuovo), `motore/finestre.ts` | T5, T6 |
| le classi nuove `kit-form`, `-row`, `-label`, `-choice`, `-option`, `-check`, `-checkbox`, `-note`, `-error` | `theme/scrittoio/anatomia/kit.ts`; il CSS in `theme/scrittoio/structure.css`, `kit/kit.css`, `theme/scrittoio/skin/kit.css` | T6 |
| `status-workspace`, `-name`, `-arrow` | `theme/scrittoio/anatomia/frame.ts`, `theme/scrittoio/skin/frame.css` | T7 |
| `draw-drawer*` (15 classi), `draw-all-tools` | `theme/scrittoio/anatomia/draw.ts`, `theme/scrittoio/skin/draw.css` | T8 |
| `draw-resources` | gli stessi due file | T10 |
| `draw-effect-dialog` | gli stessi | T6 |
| `draw-point-place`, `draw-point-coord` | gli stessi | T12 |
| `draw-appearance*` (10 classi) | gli stessi | T15 |
| `draw-resources-swatches` | gli stessi | T14 |
| le 52 icone nuove (strumenti, tracciatore, punti, Risorse, Documento, spazio di lavoro) | `editors/spatial/icons.ts`, tutte in T8, perché gli altri task le usano e basta | T8 |
| i testi della cornice (colonna, cassetto, banda, menu, schede, finestre) | `editors/spatial/strings.ts`, in italiano e in inglese | T6–T10 |
| i testi delle funzioni | l'indice generato (T5) e `editors/spatial/completo/famiglie/<id>/testi.ts` | T5, ogni famiglia |
| le scene del banco, una per stato, in giorno e notte, a 1280 e a 700 | `apps/client/bench/scene.mjs`, `apps/client/bench/fake-ipc.ts` | T6–T10, T29 |

Il CSS del prototipo, blocco per blocco, sta nella sua pagina, sotto «Il
CSS nuovo». Ogni blocco nomina il suo file e il suo task: va copiato com'è
e poi controllato con le foto.

## Fonti

- **La richiesta del manutentore** del 2026-11-05, arrivata dal
  coordinatore: i tre punti dell'Obiettivo. Sono vincolanti.
- **Il piano K5** (`origin/piano/k5-disegno`, HEAD `10154fba`). Sono fatti
  T1–T5, T8, T10, T12 e T26.
  - ADR 0239, il componente `fub.motore-vettoriale` e la feature
    `engine-drawing`.
  - I sei comandi IPC `drawing_open`, `drawing_gesture`, `drawing_sync`,
    `drawing_commands`, `drawing_command` e `drawing_close`, in
    `crates/fub-host/src/drawing.rs` (T19).
  - `crates/fub-disegno` (T9) e la differenza (T11).
  - Le patch 0001 `importatori-opzionali` e 0002 `pdf-opzionale`.
  - Il client in `apps/client/src/editors/spatial/motore/`.
  - K6 parte da K5 com'è scritto: ciò che manca o non torna sta in
    «Differenze da K5 e dal codice».
- **Il piano K3** (`origin/piano/k3-motori`, HEAD `53843dcc`):
  - `crates/fub-motori`: `Pigro`, `Lavori`, `Servizi::processo()`;
  - il `trait Cache` (`nome`, `byte`, `libera`, `ultimo_uso`);
  - `Budget` (`registra`, `usati`, `tetto`, `rispetta`, `svuota_tutto`,
    `rilascia_al_sistema`);
  - `Motori::registra(spazio, …)`, che rifiuta uno spazio doppio;
  - `SpecMotore` e `importa(spazio, …)`, con id `«spazio».«id»`;
  - `Posto`, `Effetto` (`Cambia`, `Legge`, `Mostra`) e `Modulo::da_schema`;
  - il test di copertura (`ogni_comando_del_motore_si_raggiunge`) e il
    catalogo generato;
  - `docs/reference/budgets.json`;
  - le patch `*_bytes()`/`release_*()` di K3 T3.
- **Il piano K2** (`origin/piano/k2-pagina-componenti`, HEAD `fcd30123`): la
  pagina Componenti, le righe (`Riga::motore(…)`), `state/components.ts`.
- **Il piano Scrittoio 2** (`origin/piano/scrittoio-2`, HEAD `fe4d84c4`),
  con il suo prototipo `PLAN-ui/scrittoio-2.html` (artifact
  Er7sWJtyct6mq471Uy73cj e RqKayaCnTaTtNg4ZQ5wd1z). K6 ne usa:
  - T3, la banda con la modalità;
  - T9, l'ispettore a 264 px;
  - T16, la colonna nel kit;
  - T22, la testa del disegno.
- **VectorCraft** a `cfb30d8139161cf1722dfabf3046741a0b21b3da`
  (`storytold/vectorcraft`, copia `Fubeo/vectorcraft`). Il pianificatore lo
  ha letto senza compilarlo:
  - `crates/tools/src/lib.rs`: il trait `Tool`, `Action`, i 12 tipi di
    `Overlay`;
  - `crates/tools/src/cursor.rs` (circa 95 cursori) e
    `crates/tools/src/input.rs`;
  - `crates/tools/src/catalog.rs` (`TOOL_GROUPS`) e
    `crates/tools/src/addons.rs`;
  - `crates/engine/src/` (le invocazioni di `cmd!`, cioè gli 881 comandi);
  - `crates/engine/src/cmd/library.rs` e `swatchlib.rs`, le librerie, che
    leggono e scrivono il disco da sole;
  - `crates/engine/src/cmd/fileio/load.rs` (`EDITING_STALE`);
  - `crates/svg/src/lib.rs` (`EDITING_NS`, `body_hash`) e
    `crates/svg/src/export/output.rs` (il blocco
    `<vectorcraft:document>`);
  - `crates/engine/src/file_access.rs` (`AutomationRoots`,
    `confine_process`, `confine`, `unconfined`) e i siti di `unconfined`
    in `cmd/library.rs`, `cmd/swatchlib.rs` e `cmd/fontfiles.rs`;
  - `crates/effects/src/` (i 130 effetti);
  - `crates/ui-egui/src/menus/ui_commands.rs`, `panels.rs` e `panels/`;
  - `crates/ui-egui/src/workspaces.rs` e `shortcut_editor.rs`;
  - `crates/ui-egui/src/i18n/it.tsv`.
- **Il codice di main** (`638358da`):
  - `apps/client/vite.config.ts`: il plugin `bundle-size-budgets`,
    `CHUNK_BUDGET` 500 000, la regola dei chunk `drawing-*` fuori da
    `surface`, `onlyExplicitManualChunks: true`;
  - `apps/client/bench/webview/run.mjs` e `budgets.json`: gli scenari S1–S7,
    R1, T1, I1 e L1;
  - `apps/client/src/editors/spatial/lazy.ts`, la superficie del disegno
    caricata quando serve;
  - `editors/spatial/tools/editor/stage.ts`, con le schede `design`,
    `layers`, `history` e `accessibility`;
  - `chrome/workspace.ts`, con Semplice e Completo;
  - `crates/fub-features/src/draw.rs`, con `draw.workspace` e
    `draw.toolbar`;
  - `docs/reference/on-disk-layout.md`: `.fub/plugins/<id>/` è per plug-in e
    autorevole;
  - `crates/fub-abi/src/traits.rs` (`data_read`, `data_list`,
    `data_write`, `data_remove` di `HostApi`) e `plugin_data_path` in
    `crates/fub-kernel/src/workspace.rs`;
  - `docs/product/craft-files.md`, con `.vectorcraft` in sola lettura.
- **La mappa**, `PLAN-mappa/mappa.tsv`: generata da
  `PLAN-mappa/strumenti/mappa.py` con `vc_cmds.py`, `vc_ui.py` e
  `vc_effects.py`, letti da una copia di VectorCraft. T2 la porta nel
  crate e la rigenera in Node.

## Che cosa si vede

1. **La banda dice lo spazio di lavoro.** Con un disegno a fuoco, in basso a
   destra accanto alla modalità di Scrittoio 2 c'è «▣ Completo ⌃». Apre il
   menu degli spazi:
   - Semplice e Completo;
   - gli otto spazi del motore, con i nomi di Fub: Completo classico,
     Automazione, Impaginazione, Pittura, Ricalco, Stampa e prova,
     Tipografia, Web;
   - «Ripristina», «Salva lo spazio di lavoro…» e «Gestisci…».

   Uno spazio sceglie la colonna, le sezioni aperte dell'ispettore e le
   famiglie da preparare. Non cambia il file.
2. **La colonna ha 6 gruppi e 15 caselle, senza scorrere.** I gruppi sono
   scegliere, disegnare, forme, modificare, colore e vista. Una casella con
   più strumenti ha il triangolino e apre il suo gruppo. In fondo, «Tutti
   gli strumenti» (Maiusc+Ctrl+T). A 700 px la colonna sta sotto il foglio,
   in una fila.
3. **Il cassetto degli strumenti.** Ha tutti i 100 strumenti in gruppi, con
   ricerca, nome e tasto. Da lì «Modifica la colonna» li mette nella
   colonna.
4. **La fila delle opzioni** nella testa del disegno è quella dello
   strumento scelto: ciò che il motore dice con `options()`, disegnato con
   i controlli del kit. Con la selezione diretta di un punto dice Angolo o
   Morbido, Taglia, Unisci, Elimina e le coordinate.
5. **≡ porta tutti i comandi**: File, Modifica, Oggetto, Testo, Selezione,
   Effetto, Visualizza, Pannelli, Spazio di lavoro. Ogni sottomenu viene
   dalla mappa. Una voce spenta dice perché («Scegli un tracciato sopra
   altri oggetti»).
6. **Ctrl+/ cerca fra tutti i comandi del disegno**, circa 1400 voci, con
   il tasto, il percorso e il perché delle voci spente. La prima apertura
   carica l'indice, e solo quello.
7. **Le finestre sono del kit e hanno l'anteprima.** «Sposta…», «Ombra
   esterna…» e ogni comando con parametri si apre in una finestra del kit
   (`kit/form.ts`). Un valore cambiato si vede sul foglio subito, prima di
   OK; Annulla toglie l'anteprima. Se la famiglia sta arrivando la finestra
   dice «Si prepara…»; se il motore rifiuta lo dice, con «Riprova».
8. **L'ispettore ha le schede Design, Livelli, Risorse, Cronologia e
   Accessibilità.** Senza selezione Design mostra la sezione Documento:
   tavole, unità, griglia, colori del documento. Risorse ha i campioni, gli
   stili, i pennelli e i simboli del documento e delle librerie. I 43
   pannelli del motore sono sezioni di queste schede, o finestre, o voci
   della banda, secondo la mappa (D2).
9. **Caricare e sbagliare si vede.** La prima volta che si usa una famiglia
   (per esempio il primo testo), lo strumento o la finestra dice che si
   prepara; un errore lo dice con «Riprova», e il disegno resta com'era.
10. **Il componente spento.** Con «Disegno completo» spento in Componenti
    il Completo è quello nativo (D3). Gli spazi del motore sono grigi con
    il perché e «Apri Componenti…»; il file si apre e si salva come prima.
11. **Solo l'aspetto di Fub.** Niente pannelli fluttuanti né barre del
    motore, niente nomi VectorCraft, ArtCraft o Craft: si dice «Motore del
    disegno». I tasti sono quelli di Fub nel Semplice e quelli del motore
    nel Completo (D1).
12. **Niente arriva prima che serva.** All'avvio e aprendo un disegno nel
    Semplice non si scarica nessun pezzo del Completo:
    - passando al Completo arrivano la cornice del Completo, l'indice e
      il nucleo;
    - il primo uso della penna aggiunge «tracciati»;
    - il primo effetto aggiunge «effetti».

    Nel processo, una famiglia occupa memoria solo da quando la si usa, ed
    entra nel `Budget` di K3, che la libera quando serve. Lo dicono il
    banco WebView (scenario C1) e il test `famiglie_pigre`.

## Assunzioni

Dove il codice e il piano non dicono la stessa cosa vince il codice; la
differenza si scrive in DECISIONS.md e, se cambia un task, in «Modifiche».

- A1 · **K2, K3 e K5 come sono scritti.** K6 usa i nomi, i file e le API
  che i tre piani promettono. Se un nome cambia alla fusione si segue il
  codice e lo si scrive in DECISIONS.md; il piano non si riapre per questo.
- A2 · **La revisione è fissa.** La parità è con VectorCraft a `cfb30d81`.
  Un motore più nuovo arriva con l'aggiornamento dei motori (K3): la mappa
  si rigenera, le righe nuove nascono «da fare» e la guardia le mostra.
- A3 · **Che cosa vuol dire parità.** Una riga della mappa è:
  - **fatta** quando si raggiunge dal suo posto (menu, colonna, ispettore,
    finestra, banda o tasto), fa sul disegno ciò che fa nel motore e si
    annulla con un passo; il caso della riga, nel banco di prova di T5, lo
    dimostra;
  - **fub** quando la serve una funzione di Fub (Salva, le schede, le
    Impostazioni, i recenti), scritta nella colonna `fub`;
  - **esclusa** quando non entra, con il suo perché e il rimando a D6.

  Alla fine nessuna riga resta «da fare»: lo controlla
  `check-disegno-mappa.mjs --finale`.
- A4 · **Il motore non tocca il disco.** Ogni byte che legge o scrive passa
  dal kernel, sia per aprire, salvare ed esportare sia per le librerie, le
  preferenze e il recupero. Il motore non ha una cartella di sessione e non
  scandisce i caratteri del sistema (i caratteri sono quelli di K5 T7). Lo
  prova `crates/fub-disegno/tests/disco.rs` (T28).
- A5 · **Le famiglie sono le unità pigre.** Le famiglie sono 26, la colonna
  `famiglia` della mappa. In Rust il codice è compilato (che cosa entra nel
  binario lo decidono le feature Cargo) e pigro è lo stato: cache, tabelle,
  librerie e lavori nascono al primo uso e li libera il `Budget` di K3.
  Nel client ogni famiglia è un chunk `drawing-fam-<id>`, caricato con
  `import()`.
- A6 · **L'indice è generato.** Etichette, posti e tasti di tutte le righe
  fatte stanno in `apps/client/src/editors/spatial/completo/indice.generated.json`,
  generato dal Rust come gli altri mirror (`UPDATE_MIRROR=1`). Nel client
  non c'è nessun elenco scritto a mano.
- A7 · **Gli id.** In Fub i comandi del motore si chiamano
  `disegno.<id del motore>`, secondo la regola `«spazio».«id»` di K3. I tre
  di K5 restano come sono: `disegno.colore-tratto`,
  `disegno.colore-riempimento` e `disegno.spessore`. La colonna `fub` della
  mappa li lega a `paint.setStroke`, `paint.setFill` e `stroke.set`.
- A8 · **L'annulla è del client**, come in K5: un gesto o un comando è un
  passo della cronologia di Fub, e quella del motore non si usa. Le righe
  `edit.undo`, `edit.redo` e `history.*` le serve l'annulla di Fub.
- A9 · **L'inchiostro resta.** I tratti a mano libera (`fub:ink`) restano
  fuori dal motore, che li vede come parti che non sa modificare (K5). La
  penna a mano libera di Fub resta, con il nome «Inchiostro» (D5).
- A10 · **I pannelli diventano sezioni.** Un pannello del motore diventa una
  sezione dell'ispettore, una finestra o una voce della banda, come dice la
  colonna `posto`. Non ci sono pannelli da agganciare o fluttuanti (D2, D6).
- A11 · **I testi.** Le etichette italiane vengono da `it.tsv` di
  VectorCraft, passate per il glossario di Fub
  (`crates/fub-disegno/glossario.tsv`: «Contorno», «Profili», …). Quelle
  inglesi vengono dal motore. Passano tutte da `i18n/gergo.ts`.
- A12 · **Dove stanno le cose dell'utente.** Le librerie stanno nel vault,
  come dati del plug-in del disegno (D11, consigliata (a):
  `.fub/plugins/fub.draw/librerie/`). Gli spazi di lavoro salvati sono
  un'impostazione di Fub, `draw.workspaces`.
- A13 · **Le sovrapposizioni ammesse.** Due task in parallelo possono
  toccare insieme solo:
  - le righe in coda di `theme/scrittoio/anatomia/draw.ts` e di
    `skin/draw.css`;
  - righe diverse di `crates/fub-disegno/mappa.tsv` e di
    `crates/fub-disegno/disco.tsv`;
  - righe d'elenco di `apps/client/bench/scene.mjs`;
  - una riga `mod` in `crates/fub-disegno/src/lib.rs`;
  - la riga di una patch in `vendor/vectorcraft/UPSTREAM.md`;
  - una riga in `scripts/check.sh` e nel blocco `ci-required` di
    `CONTRIBUTING.md`;
  - la propria sezione di `docs/architecture/disegno.md` e la propria riga
    in `docs/README.md`;
  - i file generati, che si rigenerano.

  L'orchestratore li unisce come conflitti banali («una riga in un
  elenco», DECISIONS.md), tenendo le due parti.

  **Sono indipendenti**, anche se stanno nello stesso crate o nello stesso
  pacchetto (la regola dell'orchestratore vuole che il piano lo dica):
  - T1, T2 e T4: T1 scrive solo pagine, e T2 nel crate tocca solo
    `mappa.tsv`;
  - T28 e T6, T5 e T30, T7 e T27: Rust da una parte e client dall'altra, o
    file diversi dello stesso crate;
  - i task di famiglia T12–T26 fra loro. Ognuno tocca solo i file delle sue
    famiglie (`src/famiglie/<id>.rs`, `tests/famiglie/<id>.json`,
    `completo/famiglie/<id>/`, `bench/disegno-famiglie/<id>.json`), le sue
    pagine e le sovrapposizioni qui sopra.

  Fanno eccezione le coppie che condividono una pagina o un `Cargo.toml`,
  che non corrono insieme: T12 e T15 (`drawing-masks.md`), T12 e T17
  (`drawing-pen.md`), T22 e T23, T22 e T25 (`drawing-export.md`), T23 e
  T26 (i tre `Cargo.toml`). T23 e T25, e T18 e T24, stanno già in ondate
  diverse. T30, se scivola nell'ondata delle famiglie, non corre con un
  task che tocca `crates/fub-host/src/drawing.rs`.
- A14 · **I numeri sono misurati.** I conti della mappa sono quelli di
  `mappa.py` sulla revisione fissa. Un tetto di memoria o di byte nasce da
  una misura scritta in `docs/misure/`.
- A15 · **Solo il computer.** Sul telefono il disegno resta il Semplice;
  mobile e release si provano solo in CI.
- A16 · **Le librerie PDF arrivano prima di T23.** Le righe PDF ed EPS del
  motore, e la sua stampa, hanno bisogno dentro Fub di `craft-pdf`, `krilla`
  e `hayro-*`, e delle loro sostituzioni `[patch.crates-io]` da
  `craft-libs`. La stampa ne ha bisogno perché `cmd/print.rs`,
  `printtiling.rs`, `printpresets.rs` e `printadvanced.rs` del motore
  chiamano `vectorcraft_pdf`, che la patch 0002 di K5 spegne. Si assume che
  il passo P1 (il PDF sul motore, che porta queste librerie; non ha ancora
  un branch) sia fuso prima di T23. Anche l'EPS passa da lì: il crate
  `vectorcraft-eps` dipende da `vectorcraft-pdf`. Se P1 non è fuso, 32
  righe aspettano:
  - 16 di T23: le 14 PDF ed EPS e i due `file.print`;
  - 3 di T11: `clipboard.importPdf`, `clipboard.importEps` e
    `clipboard.exportPdf`, che chiude T23;
  - 13 di T25: la stampa (`print.*`, `view.printTiling`, le due finestre
    dei preset di stampa e lo strumento `printTiling`), che chiude T25 dopo
    T23.

  Il resto di T11, T23 e T25 va avanti. DXF, EMF e Office non hanno
  bisogno di P1: bastano le feature della patch 0001, che accende T23.

## Domande per l'utente (raccolte, non bloccano)

Ognuna ha la raccomandazione per prima, e il piano procede con quella. I
task costosi da disfare stanno dopo le risposte: T7 e T8 aspettano D3, D4 e
D5; T27 aspetta D10; T30 aspetta D11; T23 e T26 aspettano D9; T24 aspetta
D8; le 4 righe dei caratteri da file di T16 aspettano D12.

- D1 · **I tasti.**
  (a) Nel Completo valgono i tasti del motore, nel Semplice quelli di Fub;
  se un tasto del motore copre un tasto globale di Fub (Ctrl+P, Ctrl+K,
  Ctrl+W, Ctrl+Tab), vince Fub e il comando del motore resta senza tasto.
  (b) Ovunque i tasti di Fub, quelli del motore solo dove Fub non ne ha.
  (c) Solo i tasti di Fub, quelli del motore da assegnare a mano.
  Consiglio: (a). Chi viene dal motore ritrova le mani, e Fub non perde i
  suoi tasti di finestra.
  Che cosa cambia: T9 e la colonna dei tasti dell'indice (T5).
- D2 · **I pannelli.**
  (a) Diventano sezioni delle schede dell'ispettore, più «Pannelli ›» in ≡,
  che apre la scheda giusta e la sezione.
  (b) Ogni pannello è una finestra del kit.
  (c) Una scheda per pannello nell'ispettore.
  Consiglio: (a). È il disegno di Scrittoio 2, e a 264 px le schede non
  possono essere 43.
  Che cosa cambia: T10 e ogni task di famiglia.
- D3 · **Che cosa è il Completo.**
  (a) Con il componente acceso è il Completo del motore (questo piano); con
  il componente spento è il Completo nativo di adesso.
  (b) Il Completo nativo resta, e quello del motore diventa un terzo
  spazio, «Professionale».
  Consiglio: (a). Uno spazio in più confonde, e lo stato spento resta come
  ripiego.
  Che cosa cambia: T7, T8 e lo stato `spento` del prototipo.
- D4 · **Dove si sceglie lo spazio di lavoro.**
  (a) Nella banda, accanto alla modalità (il prototipo).
  (b) Solo in ≡ › Spazio di lavoro, come adesso.
  (c) Nella testa del disegno.
  Consiglio: (a). Si vede sempre, ed è lo stesso gesto della modalità di
  Scrittoio 2. In ≡ resta anche lì.
  Che cosa cambia: T7.
- D5 · **La penna.**
  (a) «Penna» è la penna di Bézier del motore; la penna a mano libera di
  Fub si chiama «Inchiostro» e sta nello stesso gruppo.
  (b) «Penna» resta quella di Fub, e quella del motore si chiama «Penna di
  Bézier».
  Consiglio: (a). È il nome che ogni editor vettoriale dà alla penna di
  Bézier.
  Che cosa cambia: T8, T12 e i testi.
- D6 · **Le 12 righe escluse.**
  - 5 link del menu Aiuto del motore (Discord, sito ArtCraft, la pagina e il
    GitHub di VectorCraft, «Links»): il credito sta in Informazioni e in
    `THIRD_PARTY_NOTICES`.
  - 2 voci della barra contestuale che si sposta: in Fub è la fila delle
    opzioni.
  - 5 voci dell'aggancio libero dei pannelli: Fub ha l'ispettore a schede.

  (a) Restano escluse, con il loro perché.
  (b) Si fanno anche loro.
  Consiglio: (a). Non portano funzioni del disegno, e (b) vorrebbe dire
  un'interfaccia che non è quella di Fub.
  Che cosa cambia: T2 e T29.
- D7 · **Gli insiemi di tasti del motore** (i suoi «shortcut set»).
  (a) Diventano insiemi da scegliere in Impostazioni › Scorciatoie.
  (b) Non si portano.
  Consiglio: (a). Costa poco, ed è una riga della mappa
  (`shortcutSet.read`).
  Che cosa cambia: T9.
- D8 · **Raster e 3D** (65 righe raster, di cui 62 effetti, e 4 effetti
  3D: i 66 effetti di T24).
  (a) Compilati dentro, pigri, come le altre famiglie.
  (b) Dietro una feature spenta.
  (c) Esclusi.
  Consiglio: (a). La parità li chiede, e restano fuori dalla memoria finché
  non si usano.
  Che cosa cambia: T24.
- D9 · **Formati, script e plug-in.**
  (a) Gli importatori e gli esportatori sono un sottocomponente, «Formati
  del disegno», acceso di serie, che accende le feature delle patch 0001 e
  0002 di K5. Lo script del motore è compilato dentro. I plug-in
  WebAssembly del motore restano fuori dal binario finché un'ADR non li
  ammette: non nasce nemmeno una feature Cargo spenta, perché
  `check-cargo-feature-default.mjs` vuole ogni feature compilata da
  qualcuno. Le loro 11 righe sono «escluse» con il rimando a D9.
  (b) Tutto acceso.
  (c) Formati sì, script e plug-in esclusi.
  Ogni dipendenza nuova passa `cargo deny check` e chiede il sì
  dell'utente. Se le librerie dei formati alzano il tetto `librerie_doppie`
  di K3, T23 si ferma con il conto e l'orchestratore chiede di nuovo. Le
  righe PDF, EPS e di stampa hanno bisogno delle librerie di P1 (A16).
  Consiglio: (a). I plug-in di terzi aprono una porta che Fub governa già
  con il suo host WebAssembly, e conviene deciderla a parte.
  Che cosa cambia: T23 e T26. Il cancello accetta le 11 righe escluse
  solo se l'utente sceglie (a); con (b) diventano lavoro di T26.
- D10 · **Ciò che l'SVG non sa dire.** Effetti dal vivo, stili grafici,
  fusioni, pittura dinamica e simili, salvati in un `.svg`.
  (a) Ogni elemento ricco porta la sua ricetta come attributo.
  (b) La ricetta va in `<metadata>`, nello spazio dei nomi del motore
  (`urn:vectorcraft:editing`), con l'impronta dell'elemento. Il disegno
  resta un SVG che si vede ovunque. Un elemento cambiato fuori da Fub perde
  la sua ricetta, e solo quella: si apre come grafica semplice e lo dice.
  Spostarlo, ruotarlo o scalarlo nel Semplice la tiene. Il Rust scrive le
  ricette con la patch 0005 (togli e aggiungi, sul posto).
  (c) Un file `.vectorcraft` accanto.
  (d) I comandi ricchi si rifiutano nei `.svg`.

  In tutte e tre le prime, prima viene la forma di Fub: dove il formato
  della scena ha già la stessa cosa (effetti e fusione, stili, simboli,
  ripetizioni, spessore variabile, sfumature, motivi, punte), il ponte la
  traduce in quella forma nei due versi, così il Semplice, l'export e le
  versioni vecchie la capiscono. La ricetta serve solo a ciò che il formato
  della scena non ha, o non ha con le stesse opzioni.

  Consiglio: (b). È ciò che il motore fa già, il file resta uno e si vede
  dappertutto, e niente si perde in silenzio.
  Che cosa cambia: T27 e, dopo, le righe ricche di ogni task di famiglia
  (quelle che la tabella di `src/ricetta.rs` segna «ricetta»), soprattutto
  in T15, T17, T18, T19, T21, T24, T25 e T26.
- D11 · **Dove vivono le librerie dell'utente** (campioni, pennelli,
  simboli, stili grafici).
  (a) In `.fub/plugins/fub.draw/librerie/`, nel vault: nascoste, viaggiano
  con il vault, e «Salva libreria…» e «Apri libreria…» leggono e scrivono
  file in qualunque cartella del vault.
  (b) In una cartella visibile del vault.
  (c) Nei dati dell'app, per computer.
  Consiglio: (a). Il vault resta tutto, la cartella è del plug-in
  (`docs/reference/on-disk-layout.md`), e il motore non tocca il disco.
  Che cosa cambia: T30 e le righe di libreria di T14, T15, T17, T22 e T26.
- D12 · **I caratteri dell'utente.** Quattro righe del testo
  (`text.addFontFiles`, `text.findFontFiles`, `text.rescanFonts`,
  `ui.findFontsInFolder`) aggiungono caratteri da file. Il motore li
  cercherebbe da solo, nelle cartelle del sistema e in una sua.
  (a) I file dei caratteri stanno nel vault, in
  `.fub/plugins/fub.draw/librerie/caratteri/`: «Aggiungi caratteri…» li
  copia lì con il kernel, «Trova nella cartella…» cerca in una cartella del
  vault, e il modulo del testo li dà al motore. I caratteri del sistema non
  si scandiscono mai.
  (b) Solo i caratteri di Fub: le 4 righe sono escluse, con il perché e
  «D12».
  Consiglio: (a). Chi apre il vault su un altro computer ritrova i
  caratteri dei suoi disegni, e il motore non tocca il disco.
  Che cosa cambia: le 4 righe di T16 e la cartella `caratteri/` di T30.

## Differenze da K5 e dal codice

K5 non si tocca: ciò che non torna sta qui, e lo fa un task di K6.

1. **Gli strumenti del motore non hanno una via.** K5 ha `DrawingTool` con
   sei strumenti fissi. K6 aggiunge `DrawingTool::Engine` con l'id dello
   strumento e un ponte che fa girare qualunque `Tool` del motore (T4).
2. **Le patch 0001 e 0002 diventano feature.** Importatori, PDF e plug-in
   sono spenti in K5. K6 accende importatori e PDF con la feature
   `drawing-formats` (T23) e lo script con `drawing-script` (T26), come
   dice D9; i plug-in restano fuori. Le patch non si toccano.
3. **«Completo» cambia senso** (D3). In K5 è lo spazio nativo; con K6 e il
   componente acceso è il Completo del motore. D-10 di K5 lo prometteva.
4. **L'interruttore sta nella banda**, non nella barra del file come diceva
   K5 D-10 (D4, T7).
5. **Le finestre del motore usano `kit/form.ts`**, che nasce da
   `ui/form-dialog.ts`. K5 non ne aveva bisogno (T6).
6. **≡ e Ctrl+/ portano circa 1400 voci.** K5 ha 3 comandi; ≡ e la ricerca
   devono reggere un indice generato e caricato tardi (T5, T9).
7. **La colonna ci sta solo con 6 gruppi e 15 caselle.** Con i 100
   strumenti la colonna di K5 scorrerebbe; gli strumenti in più vanno nei
   gruppi e nel cassetto (T8).
8. **Le finestre con anteprima** hanno bisogno di `DrawingCommandRequest.preview`
   e di uno sfondo che lascia vedere il foglio (`data-preview` su
   `kit/dialog.ts`, T4 e T6).
9. **Documento sta in Design.** In K5 le proprietà del documento non hanno
   una casa; con K6 sono la sezione Documento di Design quando non c'è
   selezione (T10).
10. **I conti veri.** K5 scrive «89 strumenti e circa 710 comandi». Sono:
    100 strumenti, 881 comandi del motore, 397 voci dell'interfaccia, 130
    effetti e 43 pannelli.
11. **Le librerie del motore non si liberano.** K5 assume che le cache del
    motore si possano liberare, ma VectorCraft non ha un modo per le sue
    tabelle e librerie globali. Lo aggiunge la patch 0003 (T28).
12. **La differenza non scrive i costrutti ricchi.** La differenza di K5 T11
    sa solo impostare, aggiungere, togliere, spostare e dare un id. Per ciò
    che l'SVG non sa dire serve la ricetta di D10 (T27).
13. **K5 non dice nulla di accesso ai file, preferenze, recupero e plug-in.**
    K6 li fissa:
    - il motore non tocca il disco (T28);
    - le preferenze del motore sono impostazioni `draw.*` (T11);
    - il recupero è quello delle bozze di Fub (righe `fub`);
    - i plug-in li decide D9.
14. **ui-egui non è in `vendor/`.** K5 copia i crate del motore, non la sua
    interfaccia. Senza i suoi menu, pannelli, testi e spazi la mappa non si
    rigenera. K6 aggiunge ai percorsi gestiti di `motori.mjs` cinque file e
    una cartella di `crates/ui-egui/src/` (`menus/ui_commands.rs`,
    `panels.rs`, `panels/`, `i18n/it.tsv`, `workspaces.rs`,
    `shortcut_editor.rs`), copiati ai loro percorsi, senza il `Cargo.toml`
    del crate e fuori dal workspace di `vendor/vectorcraft`: non si
    compilano mai (T2).
15. **Il buco `#view-panel-stats`** del prototipo di Scrittoio 2 è suo, non
    di K6.
16. **`Motori::registra` rifiuta uno spazio doppio** (K3). Le famiglie non
    sono spazi: sono cache nel `Budget`, e i comandi stanno tutti nello
    spazio `disegno` (T3).
17. **Gli id di K5 non seguono la regola di K3.** K5 ha
    `disegno.colore-tratto` e simili, non `disegno.paint.setStroke`. Restano
    come sono, e la colonna `fub` della mappa li lega al comando del motore
    (A7, T2).
18. **Le librerie di VectorCraft leggono e scrivono il disco da sole**
    (`library.rs`, `std::fs::read_dir` alla riga 481, `remove_file` alla
    498; `swatchlib.rs`). Senza una cartella non ci sono librerie
    dell'utente. La patch 0004, «librerie dai byte», le fa passare dai
    byte, e il kernel scrive i file (T30, D11).
19. **Il PDF, l'EPS e la stampa del motore** hanno bisogno di `craft-pdf`
    e delle sostituzioni `hayro-*` e `krilla`, che K5 ha lasciato fuori (K5
    D-2 (a), A16, T23, T25). La stampa passa dal PDF: K5 non lo dice.
20. **K5 lascia fuori `.vectorcraft`, gli importatori e i plug-in.** K6
    porta dentro gli importatori (T23) e decide i plug-in con D9. I file
    `.vectorcraft` restano in sola lettura, come dice
    `docs/product/craft-files.md`.
21. **K5 non fa toccare al motore le forme di Fub.** In K5 i filtri, le
    maschere, i `<use>` e ciò che il motore non riporta uguale sono
    `Approximated` o `Unmapped`, e un gesto che li cambia altrimenti che
    spostandoli si rifiuta (K5 T16). Fra loro ci sono forme del formato
    della scena: gli effetti (filtri), i simboli (`<use>`), le ripetizioni,
    lo spessore variabile. Con il Completo intero il motore deve poterle
    cambiare: T27 le traduce fra la forma di Fub e il modello del motore,
    nei due versi, dove il senso è lo stesso (D10).
22. **Il motore non sa negare tutto il disco.** `AutomationRoots::new(&[],
    &[])` rende `None`, e senza radici `check_read` e `check_write` lasciano
    passare tutto; i comandi che leggono un percorso (`color.loadProfile`, i
    preset da importare, le librerie) lo aprirebbero da soli. K5 non lo
    dice. La patch 0003 aggiunge `AutomationRoots::nessuna()`, e il ponte la
    mette in vigore per tutto il processo con `file_access::confine_process`
    (T28). I siti dentro `unconfined` (preferenze, recupero, librerie,
    caratteri) restano fuori dalle radici: ognuno ha la sua riga in
    `disco.tsv` (T28), e le librerie passano dal kernel (T30).
23. **I caratteri di K5 sono fissi per il processo.** K5 T7 dà al motore i
    caratteri di Fub una volta sola (`fornisci_caratteri`), da `Servizi`.
    Le 4 righe dei caratteri da file (D12) ne aggiungono altri mentre il
    motore gira: con D12 (a) il modulo della famiglia `testo` li dà al
    database dei caratteri del motore, letti dal kernel in
    `.fub/plugins/fub.draw/librerie/caratteri/`, senza cambiare `Servizi`
    né `crates/fub-motori/src/caratteri.rs` (T16, T30).

## Prove fatte

- **Il prototipo.** `PLAN-ui/disegno-completo.html` (1 379 578 byte, 26
  pezzi, 12 stati) è stato fotografato con Chromium senza schermo, in giorno
  e notte, a 1280 e a 700 px, con e senza fuoco. Lo script è
  `node k6-shot.mjs <prototipo> <cartella> tutti`, fuori dal repo.
  - La colonna misura 44×550 senza scorrere, e 550×44 a 700 px.
  - Spenta misura 44×192.
  - Le schede dell'ispettore stanno in 240 px su 240.
  - Nessun errore nella console, nessun menu o finestra fuori dallo schermo.
- **Il sanificatore.** Il CSS del prototipo passa `sanitizeThemeCss`
  (PASS). La sonda era fuori dal repo, ed è stata tolta.
- **La mappa.** `PLAN-mappa/mappa.tsv` ha 1551 righe, rigenerate su
  `cfb30d81` con:

  ```
  python3 -I PLAN-mappa/strumenti/mappa.py <vectorcraft> <json> PLAN-mappa/mappa.tsv
  ```

  - Per fonte: motore 881, interfaccia 397, effetto 130, strumento 100,
    pannello 43.
  - Per stato: 1434 righe di famiglia, 105 servite da Fub, 12 escluse.
  - Per la colonna `pigro`: 1313 «famiglia», 70 «nucleo», 117 «—» (le righe
    di Fub e le escluse), 37 «sotto:disegno-formati» (4 di T11, 20 di T23,
    13 di T25), 11 «sotto:disegno-plugin» e 3 «sotto:disegno-script» (di
    T26).
  - Per fase: F1 614, F2 393, F3 272, F4 155, «—» 117.
  - Per task: T2 77, T7 7, T8 10, T9 11, T10 7, T11 111, T12 118, T13 91,
    T14 107, T15 192, T16 117, T17 64, T18 74, T19 67, T20 36, T21 71,
    T22 117, T23 50, T24 69, T25 100, T26 55.
  - Tre correzioni durante la scrittura del piano:
    - i recenti (`file.openRecent1…30`), il recupero (`file.recovery.*`),
      `document.open` e `document.save` passano da «formati» a «fub»;
    - le preferenze (`prefs.*`, `edit.preferences`) passano a T11;
    - la stampa (`print.*`, `file.print`, `file.export.pdf`,
      `view.printTiling`, lo strumento `printTiling`) e
      `clipboard.exportPdf` passano a «sotto:disegno-formati», perché il
      motore stampa e copia in PDF attraverso il crate del PDF.
- **Il codice letto.**
  - Le librerie di VectorCraft (`library.rs`, `swatchlib.rs`) toccano il
    disco: da qui nascono D11 e T30.
  - Il PDF del motore dipende da `craft-pdf`, `krilla 0.8`,
    `hayro-ccitt 0.3`, `hayro-jpeg2000 =0.3.5` e dalle sostituzioni di
    `craft-libs`, e la stampa passa da lì (`cmd/print.rs` e vicini): da qui
    A16.
  - `file_access.rs` del motore: `AutomationRoots::new(&[], &[])` rende
    `None`, cioè nessun controllo, e senza radici `check_read` e
    `check_write` lasciano passare tutto. `store.rs` attacca le cartelle dei
    preset PDF, dei profili ICC e dei plug-in solo se l'ospite chiama
    `attach_*_store`, e Fub non lo fa. Tutti i preset (appiattimento,
    ricalco, sfumature, nuovo documento, PDF, esportazione per schermi e per
    il web, stampa, prospettiva) stanno in `Prefs` (`prefs.rs`, righe
    214–304). Da qui T28 e il modo di T11 di salvare le preferenze.
  - L'impronta del motore (`EDITING_NS`, `body_hash` in FNV-1a,
    `EDITING_STALE`) c'è già: da qui D10 (b). Copre però il corpo intero
    (`<vectorcraft:document … hash>`), e un solo cambiamento fuori la fa
    cadere tutta: da qui l'impronta per elemento di T27.
  - `unconfined` scavalca le radici: lo usano `cmd/library.rs` (2 siti),
    `cmd/swatchlib.rs` (4) e `cmd/fontfiles.rs` (1), per le cartelle
    dell'utente. Da qui la colonna `come` di `disco.tsv` (T28), T30 e D12.
  - Le `static` globali con `OnceLock`, `LazyLock`, `Mutex` o `RwLock` dei
    crate che Fub compila sono 64 (con `grep`, fuori da `ui-egui`, `mcp`,
    `testkit` e dai test): da qui la patch 0003.
  - Lo spazio dati per plug-in del kernel c'è già (`data_read`,
    `data_list`, `data_write`, `data_remove` di `HostApi`, sotto
    `.fub/plugins/<id>/`): T30 non tocca il kernel.
  - Il bundle di main ha il plugin dei budget e la regola dei chunk
    `drawing-*`. Il banco WebView ha l'elenco degli scenari in `run.mjs`
    (`["R1","I1","S1","S6","S2","S3","S4","S5","S7","T1","L1"]`), dove C1
    entra.

## Chi aspetta chi

- **K5 fuso in main** (e con lui K2 e K3): tutti i task. Prima di T1
  l'orchestratore unisce main in `piano/k6-disegno-completo`.
- **Il sì dell'utente al prototipo**, che l'orchestratore gli mostra con
  D1–D12: T6 e tutti i task grafici (T7–T10 e la parte client dei task di
  famiglia).
- **Scrittoio 2 fuso in main**: T7 (la banda, S2 T3), T8 (la colonna e la
  testa, S2 T16 e T22) e T10 (l'ispettore, S2 T9). T1–T6, T27, T28 e T30
  non lo aspettano.
- **Le risposte:**
  - D3, D4 e D5: T7 e T8;
  - D1 e D7: T9;
  - D2: T10;
  - D6: il cancello (T29);
  - D8: T24;
  - D9: T23 e T26;
  - D10: T27, e dopo le righe ricche dei task di famiglia, soprattutto in
    T15, T17, T18, T19, T21, T24, T25 e T26;
  - D11: T30, e dopo le righe di libreria di T14, T15, T17, T22 e T26;
  - D12: le 4 righe dei caratteri da file di T16, e la cartella
    `caratteri/` di T30.
- **P1** (le librerie PDF in Fub): 32 righe, 16 di T23, 3 di T11 e le 13
  della stampa di T25, che aspettano anche T23 (A16). Come si chiudono lo
  dice «Le righe che aspettano», nel modello dei task di famiglia.
- **La CI:** i passi nuovi in `.github/workflows/` li aggiunge
  l'orchestratore quando integra il task che li chiede (T2, T5).
- N6 (la lavagna) non serve e non si tocca.

## Regole che valgono per ogni task

- **L'ambiente.**

  ```
  mkdir -p /home/fubeo/.cache/fub-k6/tmp/k6
  export PATH=$HOME/.cargo/bin:$HOME/.local/opt/cc/bin:$HOME/.local/opt/node/bin:$PATH \
    RUSTUP_TOOLCHAIN=1.95 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
    RUSTC_WRAPPER=sccache TMPDIR=/home/fubeo/.cache/fub-k6/tmp/k6 \
    FONTCONFIG_FILE=$HOME/.local/opt/chrome-libs/fonts.conf
  ```

  Niente build in `/tmp`; niente build complete del workspace se non
  servono; prima di una build grande, `df -h /`.
- **Mai i file veri.** Mai il vault reale (`~/.cache/fub-live/`), mai
  `~/Progetti/Fub`, mai `~/.cache/fub-k1/`. Le prove usano il corpus del
  banco e cartelle temporanee.
- **VectorCraft si cambia solo con una patch numerata** in
  `vendor/vectorcraft/patches/`, con la sua riga in `UPSTREAM.md`;
  `node tools/vendor-craft/vendor.mjs vectorcraft check` resta verde. Non
  si eseguono i suoi `xtask` né i suoi script, e un `build.rs` di terzi si
  legge prima di compilare. Le patch di K6 sono, nell'ordine delle ondate,
  0003 (T28), 0004 (T30) e 0005 (T27), e, se servono, quelle
  d'esportazione di T23, al primo numero libero. Un task che si integra
  fuori da quest'ordine prende il primo numero libero, e l'orchestratore lo
  scrive in «Modifiche».
- **Nessuna dipendenza nuova** oltre a quelle che porta P1 e a quelle che
  l'utente approva con D9. Una licenza che `deny.toml` non ammette ferma il
  task, e l'orchestratore chiede. Il tetto `librerie_doppie` di
  `docs/reference/budgets.json` (K3) e i tetti di
  `tools/motori-prova/budgets.json` non si alzano: se una feature nuova li
  supera, il task si ferma con il conto e chi porta ogni libreria, e
  l'orchestratore chiede.
- **Le due strade del disegno restano vive.** Con il componente
  «Disegno completo» spento il Completo è quello nativo, e con il motore
  spento valgono gli strumenti semplici (K5 A16).
  `tools/gesti-vettori.test.ts` passa in ogni task che tocca un gesto.
- **I task grafici partono dopo il sì al prototipo.** Le foto del banco si
  confrontano con lo stato del prototipo, in giorno e notte, a 1280 e a
  700 px.
- **`.github/workflows/` lo cambia solo l'orchestratore.** Un coder che ha
  bisogno di un passo nuovo in CI scrive il passo esatto nel resoconto.
- **Solo `crates/fub-disegno` nomina `vectorcraft-*`**
  (`check-engine-boundary.mjs`). Il client non sa che c'è VectorCraft.
- **Mai un lucchetto tenuto mentre il motore lavora** (K3). Una famiglia si
  prepara in un lavoro, e il custode del workspace non aspetta.
- **Niente lavoro all'avvio.** Il motore nasce al primo disegno aperto (o
  con `warm_engine` di K3), una famiglia al suo primo uso o con
  `famiglia.prepara`, e mai con il suo componente spento.
- **Niente pezzo del Completo nel bundle d'avvio.** Fuori da
  `editors/spatial/completo/` si importa solo `completo/index.ts`, e solo
  con `import()`. L'indice e le famiglie arrivano da lì, ancora con
  `import()`, e una famiglia non importa un'altra. La regola di Vite (T5)
  fa cadere tutto il resto.
- **I testi stanno nei cataloghi**, in italiano e in inglese, e il gergo
  vietato di `apps/client/src/i18n/gergo.ts` resta fuori. Nessun nome
  VectorCraft, ArtCraft o Craft nell'interfaccia: si dice «Motore del
  disegno».
- **Una riga della mappa cambia stato solo con la sua prova.** «fatto» vuol
  dire che il suo caso nel banco di prova passa e che la sua voce si vede
  dove dice la colonna `posto`.
- **Ogni task di famiglia aggiorna la sua pagina** in `docs/product/` nella
  stessa PR.
- **Non scrivere numeri non misurati.**
- **I commit** sono nella forma `tipo(scope): frase in italiano`, senza
  Co-Authored-By né altri trailer. Alla fine il task dice
  `Stato: [x] fatto`.

## Cancello di K6

| Il passo chiede | Prova | Task |
|---|---|---|
| **Parità (1)**: ogni funzione di VectorCraft è mappata, e nessuna sparisce in silenzio | `node .github/scripts/check-disegno-mappa.mjs --finale`: l'insieme delle righe è uguale a quello estratto da `vendor/vectorcraft` a `cfb30d81`; ogni riga è «fatto», «fub» con il suo id o «escluso» con il perché e D6 (con D9 (a): le 11 righe dei plug-in sono «escluse» con il rimando all'ADR; con D12 (b): le 4 righe dei caratteri da file) | T2, T29 |
| **Parità (1)**: ogni riga fatta funziona | `cargo test -p fub-disegno --test famiglie` (un caso per riga fatta: i 100 strumenti, i 130 effetti, i comandi); `cargo test -p fub-disegno --test copertura`; `npx vitest run src/editors/spatial/completo` (ogni riga fatta ha la sua voce, il suo posto e i suoi testi) | T5, T11–T26 |
| **Pigro (2)**: il Completo non entra nel bundle d'avvio | la regola di `apps/client/vite.config.ts`: `npm run build` cade se un chunk `drawing-completo`, `drawing-indice` o `drawing-fam-*` è nel grafo statico di `index.html`, o se una famiglia ne importa un'altra | T5 |
| **Pigro (2)**: si carica solo ciò che si usa | il banco WebView, scenario C1: all'avvio e nel Semplice nessun `drawing-completo`, `drawing-indice` o `drawing-fam-*`; con il Completo questi tre: `drawing-completo`, `drawing-indice` e il nucleo; con la penna i tracciati; con un effetto gli effetti, e nient'altro. Memoria e tempi di ogni passo in `docs/misure/k6-disegno-<data>-<macchina>.md`, con le soglie in `apps/client/bench/webview/budgets.json` scritte dopo la misura | T5, T29 |
| **Pigro (2)**: nel processo una famiglia occupa memoria solo dopo il primo uso, e il `Budget` la libera | `cargo test -p fub-host --test famiglie_pigre`; la memoria di ogni famiglia (byte della sua cache e crescita del processo, prima e dopo `libera`) misurata con `crates/fub-disegno/tests/famiglie_memoria.rs` e scritta in `docs/misure/k6-disegno-<data>-<macchina>.md`; `node .github/scripts/check-motori.mjs` verde, con `librerie_doppie` di `docs/reference/budgets.json` che sale solo con il sì di D9 | T3, T28, T29 |
| **L'interfaccia di Fub (3)** | le foto del banco dei 12 stati accanto al prototipo, in giorno e notte, a 1280 e a 700 px; `npm run bench:a11y` verde; la colonna non scorre (misura del banco); `check-engine-boundary.mjs`; il gergo e nessun nome Craft nei testi generati (test di T5) | T6–T10, T29 |
| **Il motore non tocca il disco** | `cargo test -p fub-disegno --test disco`; `node tools/disegno-disco/elenco.mjs --check` (ogni sito del motore che tocca il disco ha la sua riga e il suo `come`); `cargo test -p fub-host --test librerie_disegno` (le librerie passano dal kernel); `cargo deny check` verde con le dipendenze di D9 e P1 | T28, T30, T23, T29 |
| **Niente perdite di dati** | il cancello di K5 (`node tools/disegno-cancello/cancello.mjs`) ancora verde; l'andata e ritorno della ricetta (D10) su ogni costrutto ricco; un elemento cambiato fuori da Fub che perde solo la sua ricetta, si apre come grafica semplice e lo dice; una ricetta di una versione più nuova che si apre in sola lettura | T27, T29 |
| **Le due strade vive** | con «Disegno completo» spento: il Completo nativo, i file si aprono e si salvano, `Unserved` per i comandi `disegno.*` oltre ai tre di K5 (`crates/fub-host/tests/famiglie_pigre.rs`); `tools/gesti-vettori.test.ts` verde | T3, T7, T29 |
| **(per ogni piano) la CI completa, la revisione riga per riga, il merge solo con il sì dell'utente** | `gh pr ready`, poi `gh pr checks` tutto verde; la revisione scritta nella PR; il sì dell'utente | T29 |

## Il modello dei task di famiglia

T11–T26 portano le 26 famiglie, una o più per task. Ognuno segue questo
modello. Il task scrive solo ciò che la sua famiglia ha di diverso, e il
coder legge qui il resto.

| Task | Famiglie | Righe | Strumenti | Pagine in `docs/product/` |
|---|---|---|---|---|
| T11 | nucleo, vista, e le 5 righe delle preferenze | 111 | 7 | `drawing-selection.md`, `drawing-view.md`, `drawing-history.md`, `drawing-clipboard.md` |
| T12 | tracciati | 118 | 21 | `drawing-pen.md` |
| T13 | forme, trasforma | 91 | 21 | `drawing-shapes.md`, `drawing-transform.md` |
| T14 | colore | 107 | 2 | `drawing-colors.md`, `drawing-gradients.md` |
| T15 | aspetto, livelli | 192 | 1 | `drawing-styles.md`, `drawing-properties.md`, `drawing-layers.md`, `drawing-masks.md` |
| T16 | testo | 117 | 7 | `drawing-typography.md`, `drawing-fonts.md` |
| T17 | pennelli, pulizia | 64 | 10 | `drawing-pen.md`, `drawing.md` |
| T18 | effetti | 74, di cui 63 effetti | 0 | `drawing-effects.md` |
| T19 | tavole | 67 | 4 | `drawing-boards.md`, `drawing-rulers.md` |
| T20 | immagini | 36 | 0 | `drawing-images.md` |
| T21 | trame, dinamici | 71 | 5 | `drawing-patterns.md`, `drawing-blends.md` (nuova) |
| T22 | web, simboli | 117 | 10 | `drawing-symbols.md`, `drawing-export.md` |
| T23 | formati | 50 | 0 | `drawing-import.md`, `drawing-export.md`, `craft-files.md` |
| T24 | raster, tre-d | 69, di cui 66 effetti | 0 | `drawing-effects.md` |
| T25 | stampa, prospettiva, grafici | 100 | 12 | `drawing-export.md`, `drawing-perspective.md` e `drawing-graphs.md` (nuove) |
| T26 | dati, automazione | 55 | 0 | `drawing-data.md` (nuova) |

Le righe di ogni task sono quelle con il suo numero nella colonna `task` di
`crates/fub-disegno/mappa.tsv`. Le si legge con:

```
awk -F'\t' '$7=="T12"' crates/fub-disegno/mappa.tsv
```

**Tocca** (ogni task di famiglia, per ognuna delle sue famiglie `<id>`):

- `crates/fub-disegno/src/famiglie/<id>.rs` (di T3, vuoto: la famiglia lo
  riempie; `mod.rs` non si tocca);
- `crates/fub-disegno/tests/famiglie/<id>.json` e i suoi `.svg` di prova
  (nuovi);
- le righe della famiglia in `crates/fub-disegno/mappa.tsv`;
- i generati `apps/client/src/editors/spatial/completo/indice.generated.json`
  e `completo/famiglie/<id>/schema.generated.json`;
- `apps/client/src/editors/spatial/completo/famiglie/<id>/` (`index.ts`,
  `testi.ts`, i test, e i file che servono alla famiglia);
- le righe in coda di `theme/scrittoio/anatomia/draw.ts` e di
  `theme/scrittoio/skin/draw.css`, solo per le classi nuove;
- una scena in `apps/client/bench/scene.mjs` e le sue risposte in
  `apps/client/bench/disegno-famiglie/<id>.json` (di T5, vuoto), che
  `fake-ipc.ts` legge: il task non tocca `fake-ipc.ts`;
- le pagine della tabella.

**Non toccare:**

- le altre famiglie, in Rust e nel client: una famiglia non importa
  un'altra (la regola di Vite di T5 lo fa cadere);
- la cornice: colonna, cassetto, ≡, Ctrl+/, banda e schede (T7–T10). Una
  voce arriva al suo posto dall'indice, senza codice nella cornice;
- `editors/spatial/icons.ts` (le icone sono tutte di T8: se ne manca una,
  il coder lo scrive nel resoconto e l'orchestratore la aggiunge);
- il Completo nativo e gli strumenti TypeScript che ci sono: sono il
  ripiego con il componente spento (D3);
- `vendor/vectorcraft/`, salvo una patch numerata che il task nomina.

**Cosa fare**, per ogni famiglia:

1. **Il Rust.** `famiglie/<id>.rs` tiene lo stato della famiglia (le sue
   cache e tabelle), che nasce alla prima chiamata o con
   `famiglia.prepara`. Il suo `byte()` somma i `*_bytes()` della patch 0003
   (T28) che le appartengono, e `libera()` chiama i `release_*()`. Il
   modulo adatta gli argomenti che il motore vuole in un'altra forma (un
   carattere da K5 T7, un colore del documento). Dà alle letture
   (`Effetto::Legge`) la forma JSON di `DrawingOutcome.reading`. Ha la
   tabella di quando un comando della famiglia si può, con il codice del
   perché (T4). Le righe che creano un costrutto ricco passano da T27.
2. **I casi.** Un caso per ogni riga in `tests/famiglie/<id>.json`, nella
   forma di T5:
   - un comando: il disegno di prova, la selezione, gli argomenti e
     l'esito (le operazioni, la lettura o il rifiuto);
   - uno strumento: un gesto (i suoi eventi, come i vettori di K5 T3) e le
     operazioni che deve dare;
   - un effetto: applicato con i valori di serie, e confrontato a pixel con
     il disegno del motore stesso (l'oracolo di K5 T2);
   - una voce dell'interfaccia o un pannello: il test del client che la
     trova al suo posto.
3. **La mappa.** Una riga passa da «da fare» a «fatto» solo con il suo caso
   verde. Poi si rigenerano l'indice e gli schemi:

   ```
   UPDATE_MIRROR=1 cargo test -p fub-disegno --test ts_indice
   ```

4. **Il client.** `completo/famiglie/<id>/index.ts` esporta
   `registra(ctx)`, che `carica.ts` (T5) chiama una volta. Registra:
   - le sezioni dell'ispettore, con `registraSezione` (T10);
   - le finestre che la finestra generica di T6 non sa fare da sola;
   - gli adattatori delle opzioni di uno strumento, solo se la fila
     generica di T8 non basta.

   `testi.ts` ha i testi della famiglia che l'indice non porta (titoli di
   sezione, frasi delle finestre), in italiano e in inglese, e passa il
   test del gergo.
5. **I posti**, come dice la colonna `posto`:
   - `menu/<sottomenu>`: in ≡, dall'indice (T9);
   - `colonna/<gruppo>`: nel suo gruppo della colonna e nel cassetto,
     dall'indice (T8);
   - `ispettore/<scheda>[/<sezione>]`: una sezione registrata dalla
     famiglia;
   - `finestra`: una finestra del kit (T6);
   - `banda`: una voce della banda, con `SurfaceStatusItem` di
     `chrome/status.ts`;
   - `tasto-destro`: il menu contestuale del disegno;
   - `tavolozza`: solo Ctrl+/;
   - `testata`: la testa del disegno;
   - `interno`: una riga che si raggiunge da un'altra (la `nota` dice da
     quale); il caso la chiama direttamente.

   Ogni voce si trova anche con Ctrl+/.
6. **Le pagine.** Ogni pagina della tabella dice che cosa fa il Completo
   con il motore, in parole semplici, senza nomi Craft; una pagina nuova
   entra in `docs/README.md`.
7. **Il banco.** Una scena `disegno-fam-<id>` mostra la sezione o la
   finestra principale della famiglia, in giorno e notte, a 1280 e a 700
   px.

**Casi limite comuni**, da provare in ogni famiglia:

- il chunk che non arriva: lo stato d'errore con «Riprova», e il disegno
  resta com'era;
- il disegno chiuso mentre la famiglia arriva: niente si applica dopo;
- `NoMemory` dal motore: lo si dice, con «Riprova»;
- la selezione vuota o sbagliata: la voce è spenta e dice perché;
- l'annulla: un comando è un passo; un'anteprima non entra mai nella
  cronologia;
- il componente spento: le voci non ci sono, e il Rust risponde
  `Unserved`;
- il file in sola lettura o in conflitto: le voci che cambiano sono spente
  e dicono perché;
- 50 000 elementi (il limite di K5): il comando sta nei limiti o si
  rifiuta con il suo errore, senza bloccare l'interfaccia;
- una selezione con parti che il motore non sa modificare: `Unmapped`, e
  niente cambia.

**Fatto quando** (oltre a ciò che il task aggiunge):

- tutte le righe del task sono «fatto» o «fub», salvo quelle che
  aspettano (qui sotto);
- `node .github/scripts/check-disegno-mappa.mjs` esce con 0;
- `cargo test -p fub-disegno --test famiglie` passa;
- `npx vitest run src/editors/spatial/completo/famiglie/<id>` passa;
- le foto della scena stanno accanto al prototipo;
- le pagine sono aggiornate.

**Prova:** `scripts/check.sh --rapido`, più i test della famiglia.

**Le righe che aspettano.** Una riga che ha bisogno di un task non ancora
integrato (T23, T27, T30) o di P1 resta «da fare», con `aspetta T27` (o
`aspetta T30`, `aspetta T23`, `aspetta P1`) nella sua `nota`, e il task di
famiglia si integra senza di lei. La chiude il task che la sblocca: se la
famiglia è già integrata, il suo `Tocca` comprende quelle righe e i file
della famiglia che servono, e non corre con il task che possiede quei
file. Le righe di P1 le chiudono T23 e T25, se P1 è già fuso; se no,
l'orchestratore scrive in «Modifiche» il task «T31 · Le righe del PDF»,
che le chiude dopo P1, e T29 lo aspetta.

Un task di famiglia può arrivare in più commit (una famiglia alla volta),
ma si integra intero, salvo le righe che aspettano.

## T1 · Le pagine e l'ADR del disegno completo

Perché: chi lavora dopo deve trovare in una pagina sola che cosa vuol dire
parità, che cosa è pigro, chi possiede che cosa e perché, prima che il
codice arrivi.
Tocca: `docs/decisions/NNNN-il-disegno-completo-sul-motore.md` (nuovo; NNNN
è il primo numero libero quando si fonde), `docs/decisions/README.md`,
`docs/architecture/disegno.md` (di K5 T1), `docs/map/dove-sta-x.md`
Non toccare: l'ADR di K5 (0239), che la nuova cita senza cambiarla; le
pagine di prodotto (arrivano con i loro task); `docs/project/`.
Dipende da: K5 fuso in main
Cosa fare:
- L'ADR, dal modello `docs/decisions/template.md`:
  - contesto: la richiesta del manutentore del 2026-11-05 (i tre punti),
    K5 che porta solo gli strumenti semplici, i conti della mappa;
  - decisione: A3–A8, A10–A12 e A14 di questo piano; il componente
    «Disegno completo» e il sottocomponente «Formati del disegno»; le
    feature `drawing-complete`, `drawing-formats` e `drawing-script`;
    nessuna feature per i plug-in;
  - conseguenze: la mappa è il contratto della parità; il client non
    nomina il motore; ogni pezzo del Completo arriva tardi;
  - alternative scartate: il Completo del motore come terzo spazio, i
    pannelli del motore fluttuanti, il motore in WebAssembly nel client,
    un chunk unico per il Completo;
  - D1–D12 come «Da decidere», con la raccomandazione.
- `docs/architecture/disegno.md`, una sezione «Il disegno completo»:
  - il percorso di un comando: voce di ≡ → indice → `carica.ts` → chunk
    della famiglia → `drawing_command` → `fub-disegno` (famiglia) → motore
    → differenza → operazioni di scena;
  - il percorso di uno strumento del motore (T4);
  - chi possiede che cosa: la mappa, l'indice, le famiglie, il `Budget`,
    le librerie;
  - la differenza fra `mappa.tsv` (le funzioni del motore e il loro posto)
    e `src/mappa.rs` di K5 (gli id degli elementi);
  - accanto a ciò che non c'è ancora, «(arriva con T…)».
- Una riga in `docs/decisions/README.md` e in `docs/map/dove-sta-x.md` («il
  disegno completo» → la sezione).
Dal prototipo: niente.
Casi limite: il numero dell'ADR preso da un altro piano fuso prima (si
rinumera alla fusione, con i link); un link a un file che non esiste ancora
(lo si scrive come percorso in codice).
Fatto quando: `node .github/scripts/check-doc-links.mjs` e
`node .github/scripts/check-doc-orphans.mjs` escono con 0; la sezione si
raggiunge da `docs/README.md`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · La mappa nel repo e la sua guardia

Perché: la parità si prova solo se l'elenco di tutte le funzioni del motore
sta nel repo, si rigenera dal motore copiato e una guardia rifiuta una riga
sparita, una riga nuova senza famiglia o una riga «fatta» senza prova
(punto 1).
Tocca: `crates/fub-disegno/mappa.tsv` (nuovo),
`tools/disegno-mappa/estrai.mjs` e `tools/disegno-mappa/estrai.test.mjs`
(nuovi), `.github/scripts/check-disegno-mappa.mjs` (nuovo),
`tools/vendor-craft/motori.mjs` (solo i percorsi gestiti della voce
`vectorcraft`), i file nuovi sotto `vendor/vectorcraft/crates/ui-egui/src/`
(copiati da `vendor.mjs`), `vendor/vectorcraft/UPSTREAM.md`,
`scripts/check.sh` (una riga), `CONTRIBUTING.md` (una riga nel blocco
`ci-required`), `docs/architecture/disegno.md` (la sezione «La mappa»)
Non toccare: `.github/workflows/` (l'orchestratore); `src/mappa.rs` di K5,
che è un'altra cosa; il resto di `vendor/vectorcraft/`; il `Cargo.toml` del
workspace di `vendor/vectorcraft`, che non deve vedere `ui-egui`.
Dipende da: K5 fuso in main
Cosa fare:
- `motori.mjs`: alla voce `vectorcraft` si aggiungono i percorsi gestiti
  `crates/ui-egui/src/menus/ui_commands.rs`, `crates/ui-egui/src/panels.rs`,
  `crates/ui-egui/src/panels/`, `crates/ui-egui/src/i18n/it.tsv`,
  `crates/ui-egui/src/workspaces.rs` e
  `crates/ui-egui/src/shortcut_editor.rs`, senza il `Cargo.toml` del crate.
  Poi `node tools/vendor-craft/vendor.mjs vectorcraft update --rev
  cfb30d8139161cf1722dfabf3046741a0b21b3da --source
  https://github.com/Fubeo/vectorcraft`: la revisione è la stessa, quindi
  arrivano solo i file nuovi. `UPSTREAM.md` dice perché ci sono e che non
  si compilano.
- `crates/fub-disegno/mappa.tsv`: la copia di `PLAN-mappa/mappa.tsv` con
  una colonna in più, `stato`, dopo `task`:
  - `fub` per le 65 righe di T2, servite da una funzione di Fub che c'è
    già, con la funzione nella `nota`;
  - `escluso` per le 12 righe di D6, con il perché e «D6»;
  - `da fare` per tutte le altre, comprese le righe `fub` di T7–T11, che
    passano a `fub` con il loro task.

  La prima riga dice come la si rigenera.
- `estrai.mjs`, la stessa estrazione degli script Python di `PLAN-mappa/`
  (`mappa.py`, `vc_cmds.py`, `vc_ui.py`, `vc_effects.py`), scritta in
  Node senza dipendenze. Legge `vendor/vectorcraft/`:
  - le invocazioni di `cmd!` in `crates/engine/src/`, saltando quelle di
    test;
  - `TOOL_GROUPS` in `crates/tools/src/catalog.rs`;
  - gli effetti in `crates/effects/src/`;
  - `ui_commands.rs`, `panels.rs`, `panels/` e `it.tsv`.

  La chiave di una riga è la coppia (`fonte`, `id`). Rigenerando, le righe
  che c'erano tengono le colonne scritte a mano (`famiglia`, `fase`,
  `task`, `posto`, `pigro`, `nota`, `stato`); una riga nuova nasce
  «da fare» senza famiglia, e la guardia la mostra.
- `estrai.test.mjs` (`node --test`): su `cfb30d81` l'estrazione dà le 1551
  righe, con gli stessi conti di «Prove fatte»; un `cmd!` in un blocco
  `#[cfg(test)]` non conta; un'etichetta con un tab si legge giusta.
- `check-disegno-mappa.mjs`:
  - l'insieme delle righe è uguale a quello di `estrai.mjs`, e la guardia
    nomina ogni riga che manca o che avanza;
  - le colonne hanno valori ammessi: la famiglia fra le 26 più `fub` ed
    `escluso`, il task quello della famiglia (una tabella nella guardia),
    il posto fra quelli del modello dei task di famiglia più `fub` ed
    `escluso`, lo stato fra i quattro;
  - una riga `fub` ha la funzione di Fub nella `nota`; una riga `escluso`
    ha il perché e «D6», «D9» o «D12»;
  - un `aspetta` nella `nota` di una riga «da fare» nomina un task del
    piano o P1 (vedi «Le righe che aspettano» nel modello);
  - una riga `fatto` ha il suo caso in
    `crates/fub-disegno/tests/famiglie/<famiglia>.json`;
  - con `--finale`, nessuna riga «da fare»;
  - stampa i conti per stato e per famiglia.
- `scripts/check.sh` e il blocco `ci-required` di `CONTRIBUTING.md`: la
  riga `node .github/scripts/check-disegno-mappa.mjs`. Nel resoconto, per
  l'orchestratore, lo stesso passo in `.github/workflows/ci.yml`, accanto
  a `check-engine-boundary.mjs`: `check-locale-loop.mjs` vuole ogni riga
  del blocco anche nei workflow.
Dal prototipo: niente.
Casi limite:
- un id con la stessa scritta in due fonti (`file.place` è sia del motore
  sia dell'interfaccia): due righe;
- un comando rinominato a monte: una riga sparita e una nuova, e la guardia
  le nomina tutte e due;
- `it.tsv` con righe vuote, CRLF o una traduzione che manca: l'etichetta
  inglese;
- un file di `panels/` che non è un pannello (`mod.rs`, aiuti): lo salta
  come `vc_ui.py`;
- la mappa con una riga doppia: errore.
Fatto quando:
- `node .github/scripts/check-disegno-mappa.mjs` esce con 0 e stampa 1551
  righe: 1474 da fare (le 1434 di famiglia e le 40 `fub` di T7–T11), 65
  fub e 12 escluse;
- una riga tolta a mano dalla mappa la fa cadere, nominandola, e così una
  riga aggiunta in una copia di prova di `vendor/vectorcraft`;
- `--finale` cade;
- `node --test tools/disegno-mappa/estrai.test.mjs` passa;
- `node tools/vendor-craft/vendor.mjs vectorcraft check` esce con 0;
- `cargo metadata --manifest-path vendor/vectorcraft/Cargo.toml` non
  nomina `ui-egui`.
Prova: scripts/check.sh --rapido; node .github/scripts/check-disegno-mappa.mjs; node --test tools/disegno-mappa/estrai.test.mjs
Stato: [ ] da fare

## T3 · Il componente e le famiglie pigre

Perché: il punto 2 nel processo. Il codice del Completo è compilato, ma lo
stato di ogni famiglia nasce al suo primo uso, il `Budget` di K3 lo libera,
e con il componente spento non nasce niente.
Tocca: `crates/fub-features/src/componenti.rs` (una riga),
`crates/fub-features/Cargo.toml` e `crates/fub-host/Cargo.toml` (la feature
`drawing-complete`), `crates/fub-disegno/Cargo.toml` (la feature
`completo`), `crates/fub-disegno/src/famiglie/mod.rs` e i 26
`famiglie/<id>.rs` (nuovi),
`crates/fub-disegno/src/lib.rs`, `crates/fub-disegno/src/comandi.rs` (di
K5 T18), `crates/fub-host/src/drawing.rs` (di K5 T19),
`crates/fub-host/tests/famiglie_pigre.rs` (nuovo), i testi del componente
nei cataloghi dove stanno quelli di `fub.motore-vettoriale`,
`docs/architecture/disegno.md` (la sezione di T1), la pagina dei componenti
in `docs/product/` dove K2 li elenca
Non toccare: il client (T5); i tre comandi di K5, che restano come sono;
`vendor/vectorcraft/`; le feature `drawing-formats` e `drawing-script`, che
nascono con T23 e T26 dopo D9.
Dipende da: T2, T4, T28
Cosa fare:
- La riga del componente:

  ```
  Riga::motore("fub.disegno-completo", "component.disegno-completo.name")
      .group("disegnare")
      .requires(&["fub.motore-vettoriale"])
      .cargo_feature("drawing-complete")
      .senza_bundle()
  ```

  Acceso di serie. Spegnere il motore vettoriale spegne anche lui (K2).
- Le feature, tutte raggiungibili da `default`
  (`check-cargo-feature-default.mjs`):
  - `fub-features`: `drawing-complete = ["engine-drawing"]`;
  - `fub-host`: `drawing-complete = ["engine-drawing",
    "fub-disegno/completo", "fub-features/drawing-complete"]`, in
    `default`;
  - `fub-disegno`: `completo`, che compila `famiglie/` e accende le feature
    del motore che servono alle famiglie e che K5 ha lasciato spente, tranne
    importatori, PDF, script e plug-in. Se non ne serve nessuna, `completo`
    compila solo `famiglie/`.
- `famiglie/mod.rs`:
  - `Famiglia`, le 26 famiglie della mappa, e `famiglia_di(id)`, letta
    dalla mappa con `include_str!("../../mappa.tsv")` e analizzata una volta
    sola (`OnceLock`), solo per le righe del motore, degli effetti e degli
    strumenti;
  - per ogni famiglia uno stato in un `Pigro` di K3, che nasce alla prima
    chiamata. Implementa il `trait Cache`: nome `disegno.<famiglia>`,
    `byte()` dai `*_bytes()` della patch 0003 (T28), `libera()` dai
    `release_*()`, dopo la quale lo stato torna da nascere. Si iscrive nel
    `Budget` quando nasce, non prima;
  - `esegui(id, argomenti, sessione, filtro)`: i tre comandi di K5 come
    sono; per `disegno.<id>` prepara la famiglia, fa girare il comando nel
    motore (la sessione di K5), passa per la differenza (K5 T11) e rende le
    operazioni o la lettura. `Filtro::Fatte` accetta solo le righe «fatto»
    della mappa, `Filtro::Tutte` (solo per i test) anche le altre.
- I 26 `famiglie/<id>.rs`, uno per famiglia, con lo stato vuoto: `byte()`
  rende zero e `libera()` non fa niente, finché il task della famiglia non
  li riempie. Così un task di famiglia non tocca `mod.rs`, e due task di
  famiglia possono correre insieme (A13).
- `drawing_commands` elenca le righe «fatto» e i tre di K5, e nient'altro.
- `disegno.famiglia.prepara { famiglia }` (validato da T4) avvia un lavoro
  di K3 (`Lavori::in_sottofondo`) senza tenere il lucchetto del workspace e
  risponde subito. L'esito del lavoro è pronta, `NoMemory` o un errore
  tipato. Una seconda chiamata mentre il lavoro gira si unisce allo stesso
  lavoro.
- Il componente spento: ogni `disegno.*` tranne i tre di K5 risponde
  `Unserved`, e così `famiglia.prepara`; nessuna famiglia nasce. Spegnerlo
  mentre gira libera gli stati delle famiglie e li toglie dal `Budget`.
  «Chiudi tutto» rende il motore (K3), e con lui le famiglie.
- `famiglie_pigre.rs`, con le fixture di `fub-testkit` in una cartella
  temporanea e `Filtro::Tutte` (una configurazione dei test che l'IPC non
  può accendere):
  - un disegno aperto nel Semplice: nessuna cache `disegno.*` nel `Budget`;
  - un comando del nucleo: solo `disegno.nucleo`; poi uno dei tracciati:
    anche `disegno.tracciati`, e nessun'altra;
  - `Budget::svuota_tutto()`: i byte delle famiglie tornano a zero, e il
    comando dopo le rifà;
  - il componente spento: `Unserved`, nessuna cache, i tre di K5
    funzionano, e il file si salva e si riapre uguale;
  - due `famiglia.prepara` insieme: un lavoro solo;
  - con `Filtro::Fatte`, una riga «da fare» risponde `Unserved`.
Dal prototipo: niente (lo stato `spento` del client è di T7).
Casi limite:
- una famiglia della mappa che `Famiglia` non conosce: un test di
  `famiglie/mod.rs` cade;
- un comando che arriva mentre la sua famiglia si prepara: aspetta lo
  stesso lavoro;
- il `Budget` che libera una famiglia mentre un suo comando gira: il
  comando tiene il suo `Arc`, e la famiglia si libera dopo;
- `NoMemory` mentre una famiglia si prepara: errore tipato, niente si
  applica;
- il componente spento mentre un lavoro gira: l'esito del lavoro si butta
  (un numero di giro, come in K3);
- le righe dell'interfaccia e dei pannelli non hanno stato in Rust.
Fatto quando:
- `cargo test -p fub-host --test famiglie_pigre` e `cargo test -p
  fub-disegno --lib famiglie` passano;
- `node .github/scripts/check-cargo-feature-default.mjs` esce con 0;
- `cargo check -p fub-features --no-default-features` e `cargo check -p
  fub-host --no-default-features --features engine-drawing` compilano;
- `cargo test -p fub-abi --test dependency_invariant` passa;
- la riga si vede in Componenti, sotto «Disegnare».
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test famiglie_pigre; cargo test -p fub-disegno --lib famiglie
Stato: [ ] da fare

## T4 · Il ponte degli strumenti e il contratto

Perché: i 100 strumenti del motore hanno bisogno di una via. I pannelli
hanno bisogno di letture, le finestre di un'anteprima, e le famiglie di
`prepara` e di `NoMemory`. Il contratto di K5 non ha niente di questo
(Differenze 1 e 8).
Tocca: `crates/fub-abi/src/drawing.rs` (di K5 T4),
`crates/fub-disegno/src/gesti/strumento.rs` (nuovo),
`crates/fub-disegno/src/gesti/mod.rs` e `src/sessione.rs` (di K5),
`crates/fub-host/src/drawing.rs`, il file dei comandi IPC del disegno in
`crates/fub-app/src/` (di K5), i mirror e le fixture:
`apps/client/src/host/enums.generated.ts`, `host/contract.ts`,
`host/fake.ts`, `src/__fixtures__/mirror-samples*.json`, i test di
conformità di K5, `docs/reference/ipc-contract.md`
Non toccare: la WIT (`crates/fub-abi/wit/`): il contratto del disegno non
attraversa WebAssembly; gli strumenti del client (T8);
`editors/spatial/motore/gesti.ts`, se non per i tipi.
Dipende da: K5 fuso in main
Cosa fare:
- In `fub-abi`, additivo, serde `snake_case` come K5:
  - `DrawingTool::Engine { id }`: `id` è l'id dello strumento in
    `TOOL_GROUPS` (`pen`, `blobBrush`, …). Un id che il motore non ha è
    l'errore tipato `UnknownTool`.
  - Negli eventi del gesto, accanto ai puntatori di K5: `Key { key, code,
    mods, pressed }`, `Text { text }` e `Ime { preedit, active }`. Servono
    agli strumenti di testo e ai numeri scritti durante un gesto.
  - `DrawingOverlay`, uno per ognuno dei 12 tipi di `Overlay` del motore:
    `marquee`, `path`, `line`, `anchor`, `curve_point`, `handle`, `label`,
    `measure`, `distance`, `highlight`, `swatch`, `grid_line`. Il `match`
    del ponte è esaustivo, così un tipo nuovo del motore non compila senza
    la sua forma. I colori RGB del motore diventano ruoli di Fub
    (`selezione`, `guida`, `anteprima`, `misura`, `prospettiva`), da una
    tabella dei colori che il motore usa; un colore sconosciuto è
    `anteprima`. Il client li colora con i token.
  - `DrawingToolState { busy, transforming, wants_text, composing, cursor,
    options }`: `cursor` è un nome fra i circa 95 di
    `crates/tools/src/cursor.rs`, che il client traduce in un cursore CSS
    (T8); `options` è il JSON di `Tool::options()`.
  - `DrawingCommandRequest.preview: bool`: il comando gira su una copia e
    rende le operazioni senza applicarle né entrare nella cronologia.
  - `DrawingOutcome.reading: Option<serde_json::Value>`: la lettura di un
    comando `Effetto::Legge` (K3), per i pannelli.
  - `DrawingError::NoMemory`, quando il `Budget` non ha spazio per una
    famiglia o un comando.
  - Nella risposta di `drawing_commands`, per ogni comando: `enabled` e
    `disabled_reason`, calcolati sulla selezione di adesso. Il perché è un
    codice tipato (`no_selection`, `needs_path`, `needs_text`,
    `needs_group`, `needs_two`, `read_only`, `unmapped`, `other`), che il
    client dice con i suoi testi; `other` porta il testo del motore passato
    per il glossario. Il client chiama `drawing_commands` quando apre ≡ o
    Ctrl+/ e quando la selezione cambia mentre sono aperti, mai a ogni
    tasto.
  - Il comando `disegno.strumento.opzione { chiave, valore }` (lo chiama
    `Tool::set_option`) e la convalida di `disegno.famiglia.prepara {
    famiglia }`: la famiglia deve essere una delle 26.

  Gli id e le revisioni `u64` attraversano JSON come stringhe.
- `gesti/strumento.rs`, il ponte: tiene lo strumento attivo del motore per
  sessione e gli dà il `ToolContext` (documento, selezione, `ScreenFrame`
  dallo zoom del client). Passa i puntatori a `Tool::pointer`, i tasti a
  `key` e `claims_key`, il testo a `text_input` e l'IME a `ime_preedit`. Le
  `Action` che rende passano per la differenza di K5. Un gesto è un passo
  della cronologia di Fub (A8); un gesto annullato a metà (Esc, perdita del
  fuoco) chiama `cancel` dello strumento e non lascia operazioni.
- `drawing_gesture` rende, accanto alle operazioni, `overlays` e `state`.
  Le sovrapposizioni non passano a ogni movimento: il client chiede al più
  un aggiornamento per fotogramma (`requestAnimationFrame`), e quello vecchio
  si butta quando ne arriva uno nuovo.
- I mirror con `UPDATE_MIRROR=1`, le fixture, `fake.ts` (lo strumento finto
  rende un `marquee` e un `anchor`) e i test di conformità.
- `docs/reference/ipc-contract.md`: le forme nuove, con un esempio per
  ognuna.
Dal prototipo: niente.
Casi limite:
- lo strumento cambiato a metà gesto: il gesto vecchio si annulla prima;
- un evento di un gesto vecchio che arriva dopo l'annullamento: si butta
  (il numero di gesto di K5);
- `preview` con un comando che non ha anteprima: lo si dice
  (`NoPreview`), e la finestra di T6 nasconde l'anteprima;
- `wants_text`: le scorciatoie a un tasto non partono, e Esc chiude il
  testo prima di cambiare strumento;
- un IME che compone: tasti, scorciatoie e annulla aspettano (`composing`);
- un cursore che il client non conosce: la freccia;
- le coordinate in byte UTF-8 dell'IME, che nel client sono indici
  JavaScript: la conversione sta nel client (CLAUDE.md).
Fatto quando:
- `cargo test -p fub-abi`, `cargo test -p fub-disegno --test gesti` (un
  gesto della penna del motore, uno del rettangolo e uno di testo con IME,
  con le sovrapposizioni e le operazioni attese) e i test di conformità
  passano;
- i mirror rigenerati sono uguali a quelli scritti;
- `npm run typecheck` e `npx vitest run src/host` passano;
- `cargo test -p fub-abi --test wit_additivity` passa, senza toccare la
  WIT.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test gesti; UPDATE_MIRROR=1 per i mirror e poi senza
Stato: [ ] da fare

## T5 · L'indice dei comandi, il banco di prova delle righe e i pezzi pigri del client

Perché: il punto 2 nel client e la prova del punto 1. Ogni riga fatta ha un
caso che la prova; l'indice dice al client che cosa c'è e dove, senza un
elenco scritto a mano; e ogni famiglia è un chunk che arriva solo quando
serve.
Tocca:
- Rust: `crates/fub-disegno/src/catalogo.rs` (nuovo),
  `crates/fub-disegno/glossario.tsv` (nuovo),
  `crates/fub-disegno/tests/copertura.rs`, `tests/famiglie.rs` e
  `tests/ts_indice.rs` (nuovi), `crates/fub-disegno/tests/famiglie/`
  (nuova, con un file per famiglia, ancora vuoto),
  `crates/fub-disegno/tests/disco.rs` (di T28, perché giri anche sui casi);
- client: `apps/client/src/editors/spatial/completo/index.ts`,
  `completo/indice.ts`, `completo/indice.generated.json`,
  `completo/carica.ts` e i loro test (nuovi),
  `editors/spatial/tools/editor/chrome/workspace.ts` (solo la chiamata a
  `import()`), le 26 cartelle `completo/famiglie/<id>/` con `index.ts` e
  `testi.ts` vuoti, `apps/client/vite.config.ts`,
  `apps/client/bench/webview/run.mjs` (lo scenario C1),
  `apps/client/bench/fake-ipc.ts` (le risposte delle famiglie, lette da
  file), `apps/client/bench/disegno-famiglie/` (nuova, con un file JSON
  vuoto per famiglia),
  `docs/architecture/disegno.md` (la sezione «L'indice e i pezzi pigri»).
Non toccare: la cornice (T7–T10); `bench/webview/budgets.json` (le soglie
di C1 le scrive T29 dopo la misura); `.github/workflows/`.
Dipende da: T2, T3, T4
Cosa fare (prima il commit del Rust, poi quello del client):
- `catalogo.rs`: per ogni riga fatta, la `SpecMotore` di K3 (`id`,
  `etichetta`, `menu`, `parametri`) importata con
  `importa("disegno", …)`, il `Posto` dalla colonna `posto` e l'`Effetto`
  (`Cambia`, `Legge`, `Mostra`). I parametri di un comando con finestra
  diventano un `Modulo::da_schema` (K3), che T6 disegna.
- `glossario.tsv`: le parole del motore e quelle di Fub («Stroke» →
  «Contorno», «Artboard» → «Tavola», …). L'etichetta italiana è quella di
  `it.tsv` passata per il glossario; un test vuole che nessuna etichetta
  generata contenga un nome Craft o una parola del gergo
  (`apps/client/src/i18n/gergo.ts`, letto dal test).
- `copertura.rs`: la versione del disegno di
  `ogni_comando_del_motore_si_raggiunge` di K3. Ogni riga «fatto» ha un
  posto e un'etichetta, e ogni `cmd!` del motore ha la sua riga.
- `famiglie.rs`, il banco di prova delle righe. Legge
  `tests/famiglie/<famiglia>.json` e i suoi `.svg`, e fa girare ogni caso
  con `Filtro::Tutte`:
  - un comando: disegno, selezione, argomenti, ed esito atteso
    (operazioni, lettura o errore tipato);
  - uno strumento: gli eventi di un gesto e le operazioni attese;
  - un effetto: applicato con i valori di serie e confrontato a pixel con
    il disegno del motore stesso (l'oracolo di K5 T2), con la tolleranza di
    K5;
  - ogni caso si annulla in un passo e torna al disegno di partenza, byte
    per byte.

  Una riga «fatto» senza caso cade. Un caso senza riga cade.
- `ts_indice.rs`: scrive `completo/indice.generated.json` con
  `UPDATE_MIRROR=1`, e senza controlla che sia uguale. Una voce per riga
  fatta e una per riga `fub` che ha un posto: `id`, etichetta italiana e
  inglese, posto, famiglia, tasto del motore, effetto e se ha una finestra.
  Più gli schemi delle finestre, uno per famiglia, in
  `completo/famiglie/<id>/schema.generated.json`.
- `completo/index.ts`, l'ingresso del Completo: `apri(ctx)`, che
  `chrome/workspace.ts` chiama con `import()` quando si entra nel Completo
  con il componente acceso. Terrà i pezzi della cornice del Completo (lo
  spazio, la colonna, le opzioni, i tasti e le sezioni di T7–T10), e dà
  `indice` e `carica`. In T5 `apri` carica l'indice e prepara il nucleo, e
  basta. Vite lo mette nel chunk `drawing-completo`.
- `completo/indice.ts`: `indice()` importa il JSON con `import()` una volta
  sola (memorizzato) e dà ricerche per posto, per famiglia e per testo. Vite
  lo mette nel chunk `drawing-indice`.
- `completo/carica.ts`: `famiglia(id)` porta il chunk della famiglia con
  `import.meta.glob("./famiglie/*/index.ts")` e, insieme, chiede al Rust
  `disegno.famiglia.prepara`. È una macchina a stati per famiglia:
  - assente → in arrivo → pronta, oppure → errore;
  - «Riprova» torna a in arrivo;
  - ogni giro ha un numero, e l'esito di un giro vecchio si butta;
  - la famiglia pronta chiama `registra(ctx)` una volta sola.

  Chi aspetta (una finestra, una sezione) riceve una promessa e lo stato,
  per mostrare il caricamento e l'errore.
- `vite.config.ts`:
  - `manualChunks`: `drawing-completo` per `completo/` fuori dalle
    famiglie, `drawing-indice` per l'indice e `drawing-fam-<id>` per ogni
    cartella di famiglia;
  - una regola nel plugin `bundle-size-budgets`: la build cade se uno di
    questi chunk è nel grafo statico di `index.html`, se un file fuori da
    `completo/` ne importa uno che non sia `completo/index.ts`, o se un
    file di una famiglia importa quello di un'altra;
  - ogni chunk nuovo sta sotto `CHUNK_BUDGET`.
- Lo scenario C1 in `bench/webview/run.mjs`, accanto agli altri. Apre Fub,
  apre un disegno nel Semplice, passa al Completo, sceglie la penna, apre
  un effetto. A ogni passo scrive i chunk caricati (dalle richieste della
  WebView), la memoria del processo e della WebView e il tempo.
- Il banco visivo: `bench/fake-ipc.ts` risponde ai `disegno.*` con le
  risposte di `bench/disegno-famiglie/<id>.json` (comando, argomenti,
  esito), prese con `import.meta.glob`; un comando senza risposta rende
  `Unserved`, come il Rust per una riga «da fare». Così le scene delle
  famiglie non toccano `fake-ipc.ts`.
- I test del client:
  - `indice.test.ts`: una sola `import()` per più chiamate;
  - `carica.test.ts`: il giro vecchio buttato, «Riprova», `registra` una
    volta, `NoMemory`;
  - un test di build che legge il manifest di Vite e vuole i chunk dove
    devono essere.
Dal prototipo: gli stati `caricamento` ed `errore` (la logica; la vista è
di T6 e di T10).
Casi limite:
- il JSON dell'indice che non arriva: ≡ e Ctrl+/ dicono che non si sono
  caricati, con «Riprova», e il Semplice funziona;
- due chiamate a `famiglia(id)` insieme: un giro solo;
- il disegno chiuso durante il giro: l'esito si butta;
- una famiglia senza righe fatte: la cartella c'è, il chunk è minimo e
  nessuna voce la chiama;
- il componente spento: `indice()` non si chiama mai;
- un'etichetta italiana che manca in `it.tsv`: l'inglese, segnata nel test.
Fatto quando:
- `cargo test -p fub-disegno --test copertura --test famiglie --test
  ts_indice` passa;
- `npm run build` passa, e cade con un'importazione statica di prova da
  `completo/` in `main.ts`;
- `npx vitest run src/editors/spatial/completo` passa;
- lo scenario C1 gira sul banco WebView (CLAUDE_DEVICE.md) e stampa i
  chunk e la memoria di ogni passo: all'avvio e nel Semplice nessun
  `drawing-completo`, `drawing-indice` né `drawing-fam-*`; con il Completo
  `drawing-completo`, `drawing-indice` e `drawing-fam-nucleo`.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npm run build; lo scenario C1 sul banco WebView
Stato: [ ] da fare

## T6 · Le finestre del kit con l'anteprima

Perché: le 91 righe con il posto `finestra`, i 130 effetti e molte voci di
≡ chiedono dei parametri prima di agire. Con l'interfaccia di Fub (punto 3)
sono finestre del kit: una sola finestra generica che legge lo schema, con
l'anteprima sul foglio, e il caricamento e l'errore che si vedono.
Tocca: `apps/client/src/kit/form.ts` (nuovo, da `ui/form-dialog.ts`),
`apps/client/src/ui/form-dialog.ts` (che usa `kit/form.ts`),
`apps/client/src/kit/dialog.ts` (`data-preview`),
`apps/client/src/editors/spatial/motore/finestre.ts` (nuovo),
`theme/scrittoio/anatomia/kit.ts`, `theme/scrittoio/structure.css`,
`kit/kit.css`, `theme/scrittoio/skin/kit.css`, le righe in coda di
`theme/scrittoio/anatomia/draw.ts` e `skin/draw.css`
(`draw-effect-dialog`), `editors/spatial/strings.ts`,
`apps/client/bench/scene.mjs` e `fake-ipc.ts`, `docs/product/drawing.md`
(un paragrafo sulle finestre)
Non toccare: le finestre che ci sono (devono restare uguali: le loro foto
del banco non cambiano); `completo/` (le finestre non sanno di famiglie:
ricevono uno schema e una promessa).
Dipende da: T4, il sì al prototipo
Cosa fare:
- `kit/form.ts`: i campi di `ui/form-dialog.ts` portati nel kit (testo,
  numero con unità, scelta, opzioni, casella, nota, errore), con le classi
  `kit-form`, `-row`, `-label`, `-choice`, `-option`, `-check`,
  `-checkbox`, `-note` e `-error` del prototipo. `ui/form-dialog.ts` lo usa
  e resta com'è per chi lo chiama.
- `kit/dialog.ts`: `data-preview` sulla finestra, che fa trasparente lo
  sfondo dove c'è il foglio e sposta la finestra di lato se lo copre. Senza
  `data-preview` niente cambia.
- `motore/finestre.ts`: `apriFinestra(schema, pronto, esegui)`:
  - `schema` è un `Modulo` di K3, `pronto` la promessa di `carica.ts`;
  - mentre la famiglia arriva, la finestra mostra il caricamento (lo stato
    `dlg-ombra-caricamento`); se sbaglia, l'errore con «Riprova»
    (`dlg-ombra-errore`);
  - «Anteprima» manda il comando con `preview: true` al più ogni 120 ms, e
    disegna le operazioni sul foglio senza applicarle; un esito vecchio si
    butta;
  - «OK» manda il comando una volta, un passo della cronologia; «Annulla»
    toglie l'anteprima;
  - i valori dell'ultima volta si ricordano per sessione, non sul disco.
- Il CSS dal prototipo, blocco per blocco, nei file che il prototipo
  nomina, poi controllato con le foto.
- Le scene del banco: `disegno-finestra` (la finestra «Sposta…»),
  `disegno-finestra-caricamento` e `disegno-finestra-errore`, in giorno e
  notte, a 1280 e a 700 px, con risposte finte in `fake-ipc.ts`.
Dal prototipo: `dlg-sposta`, `dlg-ombra-caricamento`, `dlg-ombra-errore`,
le classi `kit-form*` e `draw-effect-dialog`.
Casi limite:
- un numero fuori dai limiti dello schema: l'errore accanto al campo, e OK
  è spento;
- un'anteprima che arriva dopo «Annulla»: si butta;
- `NoPreview` dal Rust: niente casella «Anteprima»;
- `NoMemory`: lo si dice nella finestra, con «Riprova»;
- la finestra aperta e il disegno chiuso: la finestra si chiude, senza
  comando;
- a 700 px la finestra sta nello schermo e scorre dentro;
- tastiera: Tab fra i campi, Invio è OK, Esc è Annulla, il fuoco torna
  dove era.
Fatto quando:
- `npx vitest run src/kit src/editors/spatial/motore` passa (anteprima,
  esito vecchio buttato, OK un passo, Esc);
- le foto delle scene stanno accanto agli stati del prototipo;
- `npm run bench:a11y` è verde sulle scene nuove;
- le foto delle finestre che c'erano non cambiano (`bench:verify`, a parte
  le 30 note di CLAUDE_DEVICE.md);
- `npm run theme:generate && npm run theme:verify` passano.
Prova: scripts/check.sh --rapido; npx vitest run src/kit src/editors/spatial/motore; npm run bench:a11y
Stato: [ ] da fare

## T7 · Lo spazio di lavoro nella banda

Perché: il punto 3, lo spazio di lavoro si sceglie nella cornice di Fub
(D4); e il punto 2, perché uno spazio dice quali famiglie preparare prima
che servano.
Tocca: `apps/client/index.html` (`#status-workspace`),
`shells/scrittoio/frame/status-band.ts` (di Scrittoio 2 T3),
`editors/core/registry.ts` (`SurfaceWorkspace`),
`editors/spatial/tools/editor/chrome/workspace.ts`, `chrome/status.ts`,
`editors/spatial/completo/spazi.ts` (nuovo), `completo/index.ts`,
`crates/fub-features/src/draw.rs` (`draw.workspaces`) e il suo mirror,
`theme/scrittoio/anatomia/frame.ts` e `skin/frame.css`,
`editors/spatial/strings.ts` e i testi della banda, le 7 righe di T7 in
`crates/fub-disegno/mappa.tsv`, `apps/client/bench/scene.mjs` e
`fake-ipc.ts`, `docs/product/drawing-custom.md`
Non toccare: la modalità di Scrittoio 2 (`#status-mode`); la colonna e le
schede (T8, T10), che leggono lo spazio scelto e basta; il Semplice.
Dipende da: T3, T5, Scrittoio 2 fuso (S2 T3), il sì al prototipo, D3 e D4
Cosa fare:
- `SurfaceWorkspace` in `registry.ts`: una superficie può dire
  `{ corrente(), elenco(), scegli(id), sottoscrivi(cb) → disposer }`. La
  banda mostra `#status-workspace` solo quando la superficie a fuoco lo
  dice, come fa con la modalità.
- `index.html`: `#status-workspace` in `#status-end`, accanto a
  `#status-mode`, nascosto di serie, dove lo mette il prototipo.
- `status-band.ts`: icona, nome e freccia; il menu si apre verso l'alto con
  `ui/menu.ts`; Invio, Spazio e le frecce; `aria-haspopup` e
  `aria-expanded`; ogni ascoltatore ha il suo disposer.
- `chrome/workspace.ts`: Semplice e Completo ci sono senza il chunk del
  Completo. Con il componente acceso, il Completo o uno degli otto spazi
  carica `completo/index.ts` con `import()`, e `apri(ctx)` porta
  `completo/spazi.ts`.
- `completo/spazi.ts`: i preset di `crates/ui-egui/src/workspaces.rs`, con
  i nomi di Fub:
  - Essentials → Completo;
  - Essentials Classic → Completo classico;
  - Automation, Layout, Painting, Printing and Proofing, Tracing,
    Typography, Web → Automazione, Impaginazione, Pittura, Stampa e prova,
    Ricalco, Tipografia, Web;
  - Touch non si porta: sul computer è il Semplice (A15), e la `nota` di
    `window.workspace` lo dice.

  Ogni preset è un dato: la colonna (gruppi e caselle), la scheda e le
  sezioni aperte, i righelli, la fila delle opzioni e le famiglie da
  preparare. Viene dai campi del preset (`open_panel` → una sezione,
  `dock_tab` → una scheda, `rulers`, `control_bar`, `toolbar_advanced`).
  Una casella il cui strumento non è ancora nell'indice si salta.
- Scegliere uno spazio sistema la colonna (T8), apre la scheda e la
  sezione (T10) e chiama `famiglia.prepara` in sottofondo per le sue
  famiglie. Non cambia il file e non è un passo della cronologia. Lo
  spazio è uno per tutti i disegni, come `draw.workspace` adesso.
- «Ripristina» riporta il preset ai suoi dati. «Salva lo spazio di
  lavoro…» salva colonna, scheda, sezioni e righelli con un nome in
  `draw.workspaces`. «Gestisci…» è una finestra del kit che rinomina ed
  elimina.
- `draw.workspaces` in `draw.rs`: un elenco con la sua versione (`v: 1`).
  Una versione più nuova si legge e non si scrive, e lo si dice; un valore
  rotto si ignora con un avviso, e non si sovrascrive. `draw.workspace`
  accetta anche gli id dei preset e degli spazi salvati; un id sconosciuto
  vale Completo, o Semplice con il componente spento. Il mirror con
  `UPDATE_MIRROR=1 cargo test -p fub-features --test ts_mirror`.
- Il componente spento (lo stato `spento`): il menu ha Semplice e Completo
  (nativo); gli otto spazi sono grigi, con il perché e «Apri
  Componenti…», che chiama `showComponent("fub.disegno-completo")` (K5
  T24).
- Le 7 righe `window.workspace*` passano a `fub`, con la funzione nella
  `nota`.
- Le classi `status-workspace`, `-name` e `-arrow` dal prototipo.
- Le scene `disegno-banda`, `disegno-banda-aperta` e `disegno-spento`, in
  giorno e notte, a 1280 e a 700 px.
Dal prototipo: `banda`, `banda-aperta`, `menu-spazi`, `menu-spazi-spento`,
gli stati `spazio` e `spento`.
Casi limite:
- il fuoco su una superficie che non è un disegno: la voce sparisce, e
  torna con il disegno;
- il chunk del Completo che non arriva: si resta nello spazio di prima, e
  il menu dice l'errore con «Riprova»;
- uno spazio salvato con uno strumento che non c'è più: lo si salta;
- un nome uguale a un preset: rifiutato, con il perché;
- a 700 px la voce mostra l'icona, con il nome in `aria-label`;
- il menu aperto e il disegno che si chiude: il menu si chiude;
- tutto con la sola tastiera.
Fatto quando:
- `npx vitest run src/shells/scrittoio/frame src/editors/spatial/completo
  src/editors/spatial/tools/editor/chrome` passa;
- `cargo test -p fub-features --test ts_mirror` passa;
- le foto stanno accanto agli stati del prototipo, e `npm run bench:a11y`
  è verde;
- la guardia della mappa conta le 7 righe come `fub`;
- con il componente spento, il file si apre e si salva come prima.
Prova: scripts/check.sh --rapido; npx vitest run src/shells/scrittoio/frame src/editors/spatial; npm run bench:a11y
Stato: [ ] da fare

## T8 · La colonna, il cassetto, la fila delle opzioni e le icone

Perché: il punto 3 per gli strumenti. I 100 strumenti del motore stanno in
una colonna del kit che non scorre, in un cassetto con la ricerca e in una
fila delle opzioni fatta di controlli del kit, non nelle barre del motore.
Tocca: `editors/spatial/completo/colonna.ts` e `completo/opzioni.ts`
(nuovi), `completo/index.ts`, `editors/spatial/tools/editor/chrome/rail.ts`,
`chrome/drawer.ts` (nuovo), `editors/spatial/tools/editor/toolbar.ts` (di
Scrittoio 2 T22), `editors/spatial/motore/gesti.ts`,
`editors/spatial/icons.ts`, le righe in coda di
`theme/scrittoio/anatomia/draw.ts` e `skin/draw.css` (`draw-drawer*`,
`draw-all-tools`), `editors/spatial/strings.ts`,
`crates/fub-features/src/draw.rs` (`draw.toolbar`) e il suo mirror, le 10
righe di T8 nella mappa, `apps/client/bench/scene.mjs` e `fake-ipc.ts`,
`docs/product/drawing.md`, `docs/product/drawing-custom.md`
Non toccare: `kit/tool-rail.ts`, `kit/popover.ts` e `kit/list.ts`, se non
per un difetto che il task mostra con un test; gli strumenti di
TypeScript che ci sono (il ripiego); le righe degli strumenti, che passano a
«fatto» con i loro task di famiglia.
Dipende da: T4, T5, T7, Scrittoio 2 fuso (S2 T16 e T22), il sì al
prototipo, D3 e D5
Cosa fare:
- `colonna.ts`: i 6 gruppi (scegliere, disegnare, forme, modificare,
  colore, vista) e le 15 caselle del prototipo. Ogni casella è un gruppo di
  strumenti del motore, preso dal posto `colonna/<gruppo>` della mappa. La
  casella mostra l'ultimo strumento usato del suo gruppo, e il triangolino
  apre il gruppo (`tendina-penna`) con il popover e la lista del kit. Si
  vedono solo gli strumenti con le righe fatte. In fondo «Tutti gli
  strumenti» (Maiusc+Ctrl+T).
- La colonna non scorre. Quando l'altezza non basta, le caselle in fondo
  passano nel cassetto. A 700 px sta sotto il foglio, in una fila.
- `chrome/drawer.ts`: il cassetto, un popover del kit con la ricerca, i
  gruppi, il nome e il tasto di ogni strumento fatto. «Modifica la
  colonna» aggiunge, toglie e riordina le caselle, e salva in
  `draw.toolbar` (le righe `toolbar.addTool`, `toolbar.removeTool`,
  `toolbar.reset` e `window.editToolbar`).
- `motore/gesti.ts`: uno strumento del motore manda `DrawingTool::Engine
  { id }`. Le sovrapposizioni si disegnano nello strato del foglio, con i
  colori dei ruoli presi dai token. Il cursore viene da
  `DrawingToolState.cursor`, tradotto in CSS con una tabella; uno
  sconosciuto è quello di serie.
- D5 (a): «Penna» è la penna del motore, che arriva con T12. La penna a
  mano libera di Fub resta, si chiama «Inchiostro» e sta in «disegnare».
- `completo/opzioni.ts`: la fila delle opzioni nella testa del disegno (la
  `kit-bar` di S2 T22). Legge `DrawingToolState.options` e disegna ogni
  chiave con un controllo del kit, secondo il valore:
  - un sì o no è una casella;
  - un numero è un campo con l'unità;
  - un testo con le sue scelte è una scelta;
  - un colore è un campione.

  Un cambio passa da `disegno.strumento.opzione`. Le etichette vengono dal
  `testi.ts` della famiglia dello strumento. Una chiave che il disegno
  generico non sa fare non si mostra, e un test la elenca: ogni opzione dei
  100 strumenti è disegnata o elencata con il perché.
- Le 52 icone del prototipo in `icons.ts`, tutte qui: gli altri task le
  usano e basta.
- Le 10 righe di T8 passano a `fub`.
- Con il componente spento, la colonna del Completo nativo (lo stato
  `spento`, 44×192).
- Le scene `disegno-completo`, `disegno-gruppo`, `disegno-cassetto` e
  `disegno-opzioni`, in giorno e notte, a 1280 e a 700 px.
Dal prototipo: `colonna`, `colonna-gruppo`, `colonna-penna`,
`tendina-penna`, `colonna-cassetto`, `cassetto`, `opzioni-punto`, le classi
`draw-drawer*` e `draw-all-tools`, le 52 icone.
Casi limite:
- uno strumento scelto mentre la sua famiglia arriva: la casella dice che
  si prepara, e il gesto aspetta; se sbaglia, l'errore con «Riprova», e lo
  strumento di prima resta;
- un'opzione cambiata durante un gesto: vale dal gesto dopo;
- `draw.toolbar` con uno strumento che non c'è: lo si salta;
- la colonna salvata con più di 15 caselle: le altre vanno nel cassetto;
- Esc durante un gesto: lo annulla (T4), e lo strumento resta;
- tastiera e lettore di schermo: le caselle sono una toolbar con le
  frecce, e il triangolino ha il suo nome.
Fatto quando:
- `npx vitest run src/editors/spatial/completo src/editors/spatial/motore
  src/editors/spatial/tools/editor/chrome` passa, e così
  `tools/gesti-vettori.test.ts`;
- il banco misura la colonna senza scorrere a 1280×800, come il prototipo
  (44×550, e 550×44 a 700 px);
- le foto stanno accanto agli stati del prototipo, e `npm run bench:a11y`
  è verde;
- `cargo test -p fub-features --test ts_mirror` passa.
Prova: scripts/check.sh --rapido; npx vitest run src/editors/spatial; npm run bench:a11y
Stato: [ ] da fare

## T9 · Il menu ≡, Ctrl+/ e i tasti

Perché: i punti 1 e 3. Ogni comando fatto si raggiunge da ≡ e da Ctrl+/,
con il suo tasto, nella cornice di Fub, e le voci spente dicono perché.
Tocca: `editors/spatial/tools/editor/chrome/commands.ts`,
`chrome/command-search.ts`, `editors/spatial/completo/tasti.ts` (nuovo),
`completo/index.ts`, `editors/spatial/tools/editor/keys.ts`,
`apps/client/src/panels/settings.ts` (la sezione «Disegno completo» in
Scorciatoie), `crates/fub-features/src/draw.rs` (`draw.keys`) e il suo
mirror, `editors/spatial/strings.ts`, le 11 righe di T9 nella mappa,
`apps/client/bench/scene.mjs` e `fake-ipc.ts`, `docs/product/drawing.md`,
la pagina di `docs/product/` che descrive Impostazioni › Scorciatoie
Non toccare: `ui/menu.ts` e `kit/dialog.ts`, se non per un difetto che il
task mostra con un test; i tasti globali di Fub e il loro mirror
(`-p fub-host --test shell_keys_mirror`).
Dipende da: T5, T6, T8, il sì al prototipo, D1 e D7
Cosa fare:
- ≡: con il Completo aperto, le voci vengono dall'indice. I sottomenu sono
  File, Modifica, Oggetto, Testo, Selezione, Effetto, Visualizza, Pannelli
  e Spazio di lavoro, come dice il posto `menu/<sottomenu>[/<sotto>]`,
  nell'ordine dei menu del motore (l'indice lo tiene). Una voce spenta dice
  il suo perché (T4). Una voce con parametri apre la finestra di T6; le
  altre girano subito.
- Ctrl+/ (`command-search.ts`): cerca fra le voci dell'indice, in italiano
  e in inglese, con il tasto, il percorso e il perché delle spente. La
  prima apertura carica l'indice, e nessuna famiglia. Invio su una voce
  spenta non fa niente e ripete il perché.
- `completo/tasti.ts`, D1 (a): nel Completo valgono i tasti del motore,
  presi dall'indice. Vincono i tasti globali di Fub (Ctrl+P, Ctrl+K,
  Ctrl+W, Ctrl+Tab e l'elenco di `keys.ts`), e il comando del motore resta
  senza tasto. I tasti a una lettera non partono quando lo strumento vuole
  il testo o l'IME compone (T4). Le modifiche dell'utente stanno in
  `draw.keys`, con la sua versione.
- Impostazioni › Scorciatoie: una sezione «Disegno completo», che carica
  `completo/index.ts` con `import()` solo quando la si apre. Elenca i
  comandi dell'indice con i tasti; si cambiano, si ripristinano, e i
  conflitti si vedono (le righe `shortcuts.*`). D7 (a): gli insiemi di
  tasti del motore si scelgono qui (`shortcuts.preset`), e un file di un
  insieme si importa e si esporta con la scelta dei file di Fub,
  attraverso il kernel (`shortcutSet.read`, `shortcuts.import`,
  `shortcuts.export`).
- Le 11 righe di T9 passano a `fub`.
- Le scene `disegno-menu`, `disegno-menu-oggetto` e `disegno-tavolozza`,
  in giorno e notte, a 1280 e a 700 px.
Dal prototipo: `menu-disegno`, `menu-oggetto`, `menu-tracciato`,
`dlg-comandi`, lo stato `tavolozza`.
Casi limite:
- due comandi con lo stesso tasto: il conflitto si vede, e vince l'ultimo
  assegnato, con l'avviso;
- un tasto premuto in un campo di testo: non parte;
- un tasto di un comando la cui famiglia arriva: il comando aspetta, e si
  vede;
- un file d'insieme rotto: l'errore, e niente cambia;
- l'indice che non arriva: ≡ e Ctrl+/ lo dicono, con «Riprova»;
- macOS: Cmd al posto di Ctrl, come il resto dei tasti di Fub;
- un menu lungo a 700 px: scorre dentro lo schermo.
Fatto quando:
- `npx vitest run src/editors/spatial src/panels` passa: una voce per
  ogni riga fatta con il posto `menu/…`, i tasti globali che vincono, la
  sezione caricata solo all'apertura;
- `cargo test -p fub-features --test ts_mirror` passa;
- le foto stanno accanto agli stati del prototipo, e `npm run bench:a11y`
  è verde.
Prova: scripts/check.sh --rapido; npx vitest run src/editors/spatial src/panels; npm run bench:a11y
Stato: [ ] da fare

## T10 · L'ispettore

Perché: il punto 3 per i pannelli. I 43 pannelli del motore diventano
sezioni delle schede dell'ispettore di Fub (D2), che le famiglie
registrano quando arrivano.
Tocca: `editors/spatial/tools/editor/chrome/hosts.ts` (`"resources"`),
`editors/spatial/tools/editor/stage.ts` (la scheda),
`editors/spatial/tools/resources-panel.ts` (nuovo; `tools/resources.ts` c'è già ed è il modello delle `defs`),
`editors/spatial/tools/properties.ts` (la sezione Documento),
`editors/spatial/completo/sezioni.ts` (nuovo), `completo/index.ts`, le
righe in coda di `theme/scrittoio/anatomia/draw.ts` e `skin/draw.css`
(`draw-resources`), `editors/spatial/strings.ts`, le 7 righe di T10 nella
mappa, `apps/client/bench/scene.mjs` e `fake-ipc.ts`,
`docs/product/drawing-properties.md`, `docs/product/drawing-resources.md`
Non toccare: l'ispettore di Scrittoio 2 (`document-panels.ts`,
`ui/views.ts`), che mostra le schede com'è; le schede che ci sono, che non
cambiano.
Dipende da: T5, Scrittoio 2 fuso (S2 T9), il sì al prototipo, D2
Cosa fare:
- La scheda «Risorse» (`resources`), fra Livelli e Cronologia, solo con
  il Completo del motore. Le cinque schede stanno in 240 px (la misura del
  prototipo).
- `resources-panel.ts`: le sezioni registrate dalle famiglie (i campioni da T14,
  gli stili da T15, i pennelli da T17, i simboli da T22), con le cose del
  documento e quelle delle librerie. Ha lo stato vuoto e lo stato con
  molte voci, che scorre dentro la scheda senza spostare il resto.
- Design senza selezione: la sezione «Documento» con ciò che K5 ha già
  (misure, unità). Le famiglie aggiungono i loro campi: tavole (T19),
  griglia (T11), colori del documento (T14).
- `sezioni.ts`: `registraSezione({ id, scheda, titolo, quando(sel),
  disegna(ctx) → disposer })`, in ordine come dice la mappa. «Pannelli ›»
  in ≡ (le righe `window.panel*`) apre la scheda, porta la sezione in
  vista e le dà il fuoco.
- Le 7 righe di T10 passano a `fub`.
- Le scene `disegno-risorse`, `disegno-risorse-molti`, `disegno-design` e
  `disegno-design-vuoto`, in giorno e notte, a 1280 (e a 700 per Design).
Dal prototipo: `tab-risorse`, `tab-risorse-scelta`, `titolo-design`,
`titolo-risorse`, `design-punto`, `design-vuoto`, `pannello-risorse`,
`pannello-risorse-molti`, la classe `draw-resources`.
Casi limite:
- una sezione registrata due volte con lo stesso id: la seconda si
  rifiuta, e un test lo prova;
- montare e smontare il disegno dieci volte: nessun ascoltatore resta vivo
  (`check-listeners.mjs`);
- la selezione che cambia in fretta: le sezioni si aggiornano al più una
  volta per fotogramma, e una lettura vecchia si butta;
- una sezione la cui famiglia sbaglia: la sezione dice l'errore con
  «Riprova», e le altre restano;
- il componente spento: niente scheda Risorse, e le schede del Completo
  nativo come adesso;
- a 700 px l'ispettore fa ciò che dice Scrittoio 2; Risorse si prova a
  piena larghezza, come nel prototipo, e a 700 px deve solo stare nello
  schermo.
Fatto quando:
- `npx vitest run src/editors/spatial` passa;
- `node .github/scripts/check-listeners.mjs` esce con 0;
- le foto stanno accanto agli stati del prototipo, e `npm run bench:a11y`
  è verde.
Prova: scripts/check.sh --rapido; npx vitest run src/editors/spatial; npm run bench:a11y
Stato: [ ] da fare


## T11 · Il nucleo, la vista e le preferenze del motore

Perché: il punto 1 per ciò che serve a tutte le altre famiglie: scegliere,
copiare e incollare, raggruppare, bloccare, nascondere, disporre, la vista e
lo zoom. Il nucleo è la famiglia che il Completo prepara quando si apre
(T5); la vista è pigra come le altre. Qui nascono anche le preferenze del
motore come impostazione di Fub, dove poi restano i preset di tutte le
famiglie.
Tocca: il modello, per le famiglie `nucleo` e `vista`; più:
- `editors/spatial/tools/editor/chrome/status.ts` (la voce dello zoom che
  c'è, e le misure della selezione accanto al puntatore);
- `editors/spatial/tools/editor/chrome/navigator.ts` (la panoramica che
  c'è, accesa da una voce della banda);
- `editors/spatial/tools/editor/clipboard-commands.ts` e
  `editors/spatial/tools/clipboard.ts` (gli appunti nel Completo);
- `editors/spatial/tools/editor/selection-commands.ts` (isola ed esci, nel
  tasto destro);
- `editors/spatial/tools/grid.ts`, `tools/rulers.ts`, `tools/outline.ts` e
  `editors/spatial/view.ts`, solo per ciò che la vista del motore chiede e
  lì manca;
- `crates/fub-features/src/draw.rs` (`draw.motore`) e il suo mirror;
- `crates/fub-host/src/drawing.rs` (le preferenze lette e salvate);
- `apps/client/src/panels/settings.ts` (Impostazioni › Disegno) e la sua
  pagina in `docs/product/`;
- le 5 righe delle preferenze.
Non toccare: l'annulla di Fub e la scheda Cronologia
(`tools/history-panel.ts`), che restano come sono (A8); il Semplice e i
suoi strumenti; la cornice (T7–T10).
Dipende da: T5, T6, T7, T8, T9, T10, T28
Cosa fare:
- **Gli strumenti.** `selection`, `directSelection`, `groupSelection`,
  `lasso`, `hand`, `rotateView` e `zoom` passano dal ponte di T4 nel
  Completo; il Semplice tiene quelli di K5. Con `directSelection` la fila
  delle opzioni mostra le coordinate del punto (`opzioni-punto`). Le azioni
  sul punto (angolo, morbido, taglia, unisci, elimina) arrivano con T12, e
  fino ad allora non si vedono. `tool.select`, `tool.setOption` e
  `tool.options` sono ciò che il ponte di T4 chiama: i loro casi lo
  provano.
- **Le righe che passano a `fub`:**
  - `edit.undo`, `edit.redo` e il pannello `history`: l'annulla e la
    Cronologia di Fub (A8);
  - `edit.undoGroup.begin` e `.end`: un comando o un gesto è già un passo
    della cronologia di Fub;
  - il pannello `properties`: la scheda Design (T10);
  - `ui.paramDialog`: la finestra generica di T6 (`apriFinestra`);
  - `prefs.get`, `prefs.set`, `prefs.reset`, `prefs.list` e
    `edit.preferences`: Impostazioni › Disegno, qui sotto.
- **`edit.clearHistory`** sta solo in Ctrl+/ (`tavolozza`), con una
  conferma del kit. Svuota la cronologia della superficie, non le versioni
  del file, e la conferma lo dice.
- **Gli appunti.** Nel Completo copiare e incollare passano dal motore,
  così un costrutto ricco resta tale fra due disegni:
  - «Copia» e «Taglia» chiamano `edit.copy` o `edit.cut`, poi
    `clipboard.flavours`, e mettono negli appunti del sistema l'SVG, il PNG
    e il testo che il motore rende (`clipboard.exportSvg`, `exportPng`,
    `exportText`), con la via che c'è in `clipboard-commands.ts`;
  - «Incolla»: se negli appunti c'è ciò che il Completo ha appena copiato
    (la stessa impronta), `edit.paste` e basta; altrimenti i byte passano
    al motore (`clipboard.importSvg`, `importImage`, `importText`), poi
    `edit.paste`. I conflitti di nomi passano da `clipboard.conflicts`;
  - l'SVG negli appunti è un SVG qualunque: ciò che si copia nel Completo
    si incolla nel Semplice, e viceversa;
  - `clipboard.importPdf`, `importEps`, `exportPdf` e `importEmf` restano
    «da fare», con la nota «aspetta T23» (le prime tre anche P1, A16): le
    chiude T23.
- **La banda.**
  - Nel Completo del motore la voce dello zoom che c'è in `status.ts`
    apre un menu: ingrandisci, rimpicciolisci, 100 %, adatta tutto e un
    campo per lo zoom (`view.zoomIn`, `zoomOut`, `actualSize`, `fitAll`,
    `setZoom`). Negli altri spazi resta com'è.
  - Il pannello `info` diventa le misure della selezione accanto alla
    posizione del puntatore, aggiornate al più una volta per fotogramma.
  - Il pannello `navigator` diventa una voce che accende e spegne la
    panoramica di `navigator.ts`.
- **Il tasto destro.** `object.isolate` e `object.exitIsolation` nel menu
  contestuale del disegno (`selection-commands.ts`). Esc esce
  dall'isolamento prima di togliere la selezione.
- **La vista.** Le righe `view.*` di ≡ › Visualizza cambiano lo stato della
  vista del motore: griglia, righelli, guide intelligenti, contorno,
  anteprima dei pixel, aggancio, rotazione della vista, modalità dello
  schermo, presentazione e viste salvate. Il client lo disegna con
  `grid.ts`, `rulers.ts`, `outline.ts` e `view.ts`, e aggiunge lì ciò che
  manca senza cambiare il Semplice. È stato della superficie, non del
  file. Le viste salvate (`view.saved.*`) stanno nel documento: se la
  tabella di `src/ricetta.rs` (T27) le segna «ricetta», passano da lì.
- **Le preferenze del motore**, `draw.motore`:
  - un'impostazione in `draw.rs` con la sua versione (`v: 1`): il JSON
    delle preferenze del motore, che `fub-host` dà al motore con
    `prefs.set` quando il motore nasce;
  - dopo ogni comando `fub-host` confronta l'impronta del JSON con quella
    di prima e, se cambia, salva l'impostazione. Così restano anche i preset
    che le altre famiglie tengono nelle preferenze del motore (PDF, stampa,
    ricalco, esportazione, nuovo documento: `Prefs`, `prefs.rs` righe
    214–304), senza codice in quei task;
  - le quattro preferenze che sono cartelle (`fonts_folder`,
    `plugins_folder`, `recovery_folder`, `templates_folder`) non si
    mostrano e non si scrivono mai (A4, T28);
  - una versione più nuova si legge e non si scrive, e lo si dice; un
    valore rotto si ignora con un avviso, e non si sovrascrive;
  - Impostazioni › Disegno: una sezione «Motore del disegno» fatta da
    `prefs.list` con `kit/form.ts` (T6), con i nomi passati per il
    glossario. Si carica con `import()` solo quando la si apre, e c'è solo
    con il componente acceso. «Ripristina» chiama `prefs.reset`.
  - Il mirror con `UPDATE_MIRROR=1 cargo test -p fub-features --test
    ts_mirror`.
- Le pagine `drawing-selection.md`, `drawing-view.md`, `drawing-history.md`
  e `drawing-clipboard.md`; le scene `disegno-fam-nucleo` (la selezione
  diretta con le coordinate) e `disegno-fam-vista` (il menu dello zoom).
Dal prototipo: `opzioni-punto` (le coordinate), `menu-disegno` (≡ ›
Visualizza), `banda`.
Casi limite:
- incolla con negli appunti un formato che il motore non sa leggere: lo si
  dice, e niente cambia;
- incolla di un SVG grande: sta nei limiti di K5, o si rifiuta con il suo
  errore;
- la scelta di un elemento `fub:ink` con gli strumenti del motore: lo si
  sceglie e lo si sposta, e niente altro (K5);
- lo zoom fuori dai limiti del motore: il campo lo dice e non cambia;
- le misure della selezione con 50 000 elementi: si aggiornano al più una
  volta per fotogramma, e una lettura vecchia si butta;
- `draw.motore` di una versione più nuova: si legge, non si scrive, e
  Impostazioni › Disegno è in sola lettura con il perché;
- un `prefs.set` con una cartella: si rifiuta prima del motore (T28);
- l'isolamento aperto e il disegno chiuso: alla riapertura non c'è.
Fatto quando:
- il modello;
- `cargo test -p fub-features --test ts_mirror` e `cargo test -p fub-host`
  (le preferenze salvate, la versione più nuova, il valore rotto)
  passano;
- `npx vitest run src/editors/spatial src/panels` passa (la voce dello zoom
  negli altri spazi uguale, gli appunti fra Completo e Semplice);
- `tools/gesti-vettori.test.ts` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial src/panels
Stato: [ ] da fare

## T12 · I tracciati e la penna di Bézier

Perché: il punto 1 per il cuore di un editor vettoriale: la penna di
Bézier, i punti e le maniglie, tagliare, unire, semplificare, le maschere
di ritaglio e le operazioni fra tracciati.
Tocca: il modello, per la famiglia `tracciati`; più
`completo/famiglie/tracciati/opzioni-punto.ts` (l'adattatore delle opzioni
dei punti), le classi `draw-point-place` e `draw-point-coord` in coda a
`theme/scrittoio/anatomia/draw.ts` e `skin/draw.css`, e il paragrafo delle
maschere di ritaglio in `docs/product/drawing-masks.md`.
Non toccare: la penna a mano libera di Fub e `fub:ink` (A9); gli strumenti
di forma (T13).
Dipende da: T11; T27 per le maschere di ritaglio; D5
Cosa fare:
- **Gli strumenti**, tutti in «disegnare» (`colonna/disegna`): `pen`,
  `addAnchor`, `deleteAnchor`, `anchorPoint`, `curvature`, `smart_pen`,
  `pencil`, `smooth`, `pathEraser`, `eraser`, `anchor_eraser`, `join`,
  `extend_path`, `corner_tool`, `slide_anchor`, `shared_edge`,
  `scissors`, `knife`, `mirrorCut`, `lineCut` e `rectCut`. D5 (a):
  «Penna» è `pen`; la penna di Fub si chiama «Inchiostro», sta nello stesso
  gruppo e fa ancora `fub:ink`. `pencil` è la «Matita» del motore, che fa
  tracciati di Bézier.
- **La fila delle opzioni dei punti.** `opzioni-punto.ts` aggiunge alla
  fila generica di T8, con `directSelection` e `anchorPoint`, le azioni sul
  punto scelto: angolo, morbido, taglia, unisci ed elimina
  (`path.convertAnchors`, `path.cutAtAnchors`, `path.join`,
  `path.removeAnchors`), accanto alle coordinate di T11. Una voce spenta
  dice perché (T4).
- **La sezione «Tracciato»** in Design (59 righe con il posto
  `ispettore/design`): le coordinate e il tipo dei punti scelti, le
  maniglie, la regola di riempimento, il verso, e gli strumenti di
  `addon.pathtools` e `addon.pen`, ognuno con la sua finestra di T6 quando
  ha parametri.
- **Oggetto › Tracciato** (`menu-tracciato`, 32 righe): unisci, media,
  contorna il tratto, sposta il tracciato, semplifica, dividi sotto, le
  operazioni di `object.pathfinder.*`, i tracciati composti, le maschere di
  ritaglio ed «Espandi». «Semplifica», «Leviga» ed «Espandi» hanno la loro
  finestra con l'anteprima (`ui.simplifyAuto`, `ui.simplifyMoreOptions`,
  `ui.smoothAuto`, `ui.expandDialog`).
- **Le maschere di ritaglio** (`object.clippingMask.*`) usano la forma
  della scena dove c'è (T27, Differenze 21); fino a T27 restano «da fare».
- Il tema `draw-point-place` e `draw-point-coord` dal prototipo.
- La pagina `drawing-pen.md` (la penna, i punti, le forbici e il coltello,
  la matita) e il paragrafo in `drawing-masks.md`; la scena
  `disegno-fam-tracciati` (la sezione Tracciato con un punto scelto).
Dal prototipo: `design-punto`, `opzioni-punto`, `menu-tracciato`,
`colonna-penna`, `tendina-penna`, le classi `draw-point-place` e
`draw-point-coord`.
Casi limite:
- un tracciato aperto con la penna e lo strumento cambiato: il tracciato
  resta aperto, ed è un passo;
- Esc o Invio con la penna: il tracciato si chiude come fa il motore, e un
  secondo Esc torna alla selezione;
- coltello, forbici o gomma su un elemento `fub:ink`: spenti con
  `unmapped`, e niente cambia;
- un'operazione fra tracciati che dà un risultato vuoto: niente cambia, e
  lo si dice;
- «Semplifica» su 50 000 punti: l'anteprima resta al più ogni 120 ms (T6),
  e un'anteprima vecchia si butta;
- un tracciato composto con un buco e la regola di riempimento cambiata:
  andata e ritorno uguale nel file.
Fatto quando: il modello, e `tools/gesti-vettori.test.ts` passa
(l'Inchiostro fa ancora `fub:ink`).
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/tracciati src/editors/spatial/tools/gesti-vettori.test.ts
Stato: [ ] da fare

## T13 · Le forme e le trasformazioni

Perché: il punto 1 per le forme (anche quelle dal vivo, con angoli e lati
che si cambiano dopo), allineare e distribuire, e le trasformazioni a mano e
a numeri.
Tocca: il modello, per le famiglie `forme` e `trasforma`.
Non toccare: gli strumenti di forma del Semplice (K5), che restano quelli
di K5.
Dipende da: T11; T27 per le forme dal vivo, le forme composte e il
costruttore di forme
Cosa fare:
- **Gli strumenti.** In «forme» (`colonna/forme`): `lineSegment`, `arc`,
  `spiral`, `rectangularGrid`, `polarGrid`, `rectangle`,
  `roundedRectangle`, `ellipse`, `polygon`, `star`, `flare`, `shaper`,
  `shapeBuilder` e `parametric_shape`. In «modificare»
  (`colonna/trasforma`): `rotate`, `reflect`, `scale`, `shear`, `reshape`,
  `freeTransform` e `puppetWarp`.
- Un clic senza trascinare con uno strumento di forma apre la finestra
  delle misure del suo comando (`shape.rectangle`, `shape.ellipse`, …),
  come fa il motore.
- **Le sezioni in Design** (i pannelli `align`, `pathfinder` e
  `transform`):
  - «Allinea»: le righe `align.*`, `object.align`, `object.distribute` e
    `object.distributeSpacing`, con «allinea a» (selezione, oggetto chiave,
    tavola);
  - «Elaborazione tracciati»: le forme composte (`object.compoundShape.*`),
    `object.expandShape` e `pathfinder.repeat`;
  - «Trasforma»: posizione, misura, rotazione e inclinazione
    (`object.setBounds`, `object.transform`), le forme dal vivo
    (`object.setLiveShape`, `object.shape`, «Angoli…» con `ui.corners`),
    `object.makePixelPerfect` e `object.resetBoundingBox`.
- **Le finestre con l'anteprima** (T6): Sposta, Ruota, Rifletti, Scala,
  Inclina, Trasforma ciascuno e Distorci (`object.move`, `rotate`,
  `reflect`, `scale`, `shear`, `transformEach`, `distort`). «Sposta» è il
  modello: è `dlg-sposta` del prototipo. `object.transformAgain` ripete
  l'ultima.
- **Il costruttore di forme**: le regioni (`shapeBuilder.regions`, una
  lettura) si disegnano come sovrapposizioni `highlight`, e il gesto unisce
  o toglie (`shapeBuilder.merge`).
- **La deformazione con i perni** (`puppetWarp`): i perni vivono nello
  stato dello strumento finché lo si usa; il risultato è un tracciato.
- **Lo strumento forma** (`shaper`): uno scarabocchio diventa una forma
  (`shaper.scribble`); il gruppo che ne nasce si espande o si scioglie
  (`shaper.expand`, `release`, `releaseSource`, `select`).
- `addon.arrange.*` in ≡ › Oggetto, con le loro finestre.
- Le forme dal vivo, le forme composte e il gruppo dello strumento forma
  passano dalla forma della scena o dalla ricetta, come dice la tabella di
  `src/ricetta.rs` (T27).
- Le pagine `drawing-shapes.md` e `drawing-transform.md`; la scena
  `disegno-fam-trasforma` (la finestra «Ruota…» con l'anteprima).
Dal prototipo: `dlg-sposta`, `menu-oggetto`, `colonna-gruppo`.
Casi limite:
- una trasformazione su una selezione con un elemento bloccato: il motore
  lo salta, e lo si dice;
- «Scala» a 0 % o un numero fuori dai limiti: l'errore accanto al campo, e
  OK è spento (T6);
- allinea con un solo oggetto e «allinea alla selezione»: la voce è spenta
  con il perché (`needs_two`);
- un rettangolo dal vivo con gli angoli diversi, salvato e riaperto: torna
  uguale (T27), e il Semplice lo vede come un tracciato;
- la deformazione con i perni annullata a metà: niente resta.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/forme src/editors/spatial/completo/famiglie/trasforma
Stato: [ ] da fare

## T14 · Il colore

Perché: il punto 1 per riempimento e tratto, i campioni e i loro gruppi,
la guida dei colori, i temi, la ricolorazione, il contagocce e i profili
colore.
Tocca: il modello, per la famiglia `colore`; più la sezione «Campioni» di
Risorse (la classe `draw-resources-swatches` in coda a
`theme/scrittoio/anatomia/draw.ts` e `skin/draw.css`).
Non toccare: `kit/color/` (lo si usa com'è: un difetto lo mostra un test, e
l'orchestratore decide); il pannello delle sfumature, che è di T15.
Dipende da: T11; T30 e D11 per le righe di libreria; T27 per le sfumature
libere
Cosa fare:
- **Risorse › Campioni** (`swatches`, `draw-resources-swatches`): i
  campioni del documento, i gruppi, i colori tinta piatta, «Aggiungi i
  colori usati», ordina, unisci, togli quelli non usati
  (`swatch.*`), con le finestre «Nuovo campione», «Opzioni del campione»
  e «Nuovo gruppo di colori».
- **Risorse › Temi di colore** (`color_themes`, `colorTheme.*`).
- **Design › Colore** (`color`) e **Guida dei colori** (`color_guide`),
  con `kit/color`: riempimento e tratto attivi, scambia, nessuno, di serie,
  ultimo colore e ultima sfumatura, recenti (`paint.*`); le armonie della
  guida (`color.harmony`, `ui.colorGuideOptions`, `ui.colorGuideLimit`).
- **Modifica › Modifica colori** (`edit.colors.*`): ogni voce con la sua
  finestra e l'anteprima (`ui.colorBalanceDialog`, `ui.saturateDialog`).
  «Ricolora la grafica» (`recolor.*`, `ui.recolorDialog`) è una finestra
  della famiglia, perché quella generica non la sa fare: i colori di adesso
  in una colonna, i nuovi accanto, con `kit/color`, e l'anteprima.
- **Gli strumenti** `gradient` ed `eyedropper` (`colonna/colore`), con
  `eyedropper.setOptions`. `ui.sampleScreenColor` usa l'`EyeDropper` della
  WebView dove c'è; dove non c'è, la voce è spenta con il perché
  (`other`).
- **Le sfumature libere** (`paint.freeform.*`) passano dalla ricetta, se la
  tabella di T27 lo dice; `paint.editGradient` e `paint.setGradientGeom`
  usano la sfumatura della scena.
- **I profili colore.** `color.loadProfile`: la scelta dei file di Fub, il
  kernel legge i byte, e il modulo della famiglia chiama
  `cms::register_icc(&bytes, None)`; il motore non vede mai il percorso
  (T28). I profili restano in `profili/` della cartella di T30 e tornano
  quando il motore rinasce. `color.removeProfile`, `color.gamutCheck`,
  `color.convert` e `color.plates` lavorano sui profili registrati.
- **Le librerie** (le 19 righe di `swatch.library*`,
  `window.swatchLibrary*`, `window.userSwatchLibrary1`–`10` e
  `ui.saveSwatchLibrary`) aspettano T30; le librerie che il motore porta
  dentro, che non toccano il disco, si fanno qui.
- **I colori del documento** nella sezione Documento di Design (T10).
- `addon.color.*` in ≡ › Modifica.
- Le pagine `drawing-colors.md` e `drawing-gradients.md`; le scene
  `disegno-fam-colore` (Risorse › Campioni) e `disegno-fam-ricolora`.
Dal prototipo: `pannello-risorse`, `pannello-risorse-molti`,
`draw-resources-swatches`.
Casi limite:
- un profilo ICC rotto: l'errore, e niente cambia;
- 2 000 campioni: la sezione scorre dentro la scheda (T10);
- un campione globale cambiato: ogni elemento che lo usa cambia in un
  passo;
- una tinta piatta senza profilo: la si mostra con il suo nome, e
  l'esportazione la tiene;
- il contagocce su un elemento `fub:ink`: prende il suo colore, e
  l'inchiostro non cambia;
- «Ricolora» con l'anteprima e poi Annulla: niente resta.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/colore
Stato: [ ] da fare

## T15 · L'aspetto e i livelli

Perché: il punto 1 per l'aspetto (più riempimenti e tratti, effetti in
pila), gli stili grafici, il tratto avanzato con i profili di spessore, la
trasparenza e le maschere d'opacità, i livelli e il menu Selezione.
Tocca: il modello, per le famiglie `aspetto` e `livelli`; più le classi
`draw-appearance*` in coda a `theme/scrittoio/anatomia/draw.ts` e
`skin/draw.css`.
Non toccare: `editors/spatial/tools/layers.ts`, che resta la scheda Livelli
del Completo nativo; `drawing-gradients.md` (la sezione Sfumatura si
descrive in `drawing-properties.md`, perché T14 tocca quella pagina nella
stessa ondata).
Dipende da: T11; T27 per le righe ricche; T30 e D11 per le righe di
libreria
Cosa fare:
- **Design › Aspetto** (`appearance`, le 10 classi `draw-appearance*`): la
  pila dei riempimenti, dei tratti e degli effetti dell'elemento, con
  aggiungi, duplica, sposta, togli, nascondi e «Riduci all'aspetto di base»
  (`appearance.*`). Più riempimenti o tratti su un elemento, e gli effetti
  in pila, passano dalla forma della scena o dalla ricetta (T27).
- **Design › Contorno** (`stroke`): spessore, estremi, angoli, tratteggio,
  frecce, allineamento (`stroke.set`, `stroke.setAdvanced`). I profili di
  spessore e i punti di spessore (`stroke.widthProfile.*`,
  `stroke.widthPoint.*`) usano lo spessore variabile della scena (T27).
- **Design › Trasparenza** (`transparency`): opacità, fusione, gruppo a
  foratura e fusione isolata, e le maschere d'opacità (crea, scollega,
  modifica, inverti, ritaglia: `transparency.*`), che usano la maschera
  della scena dove c'è (T27).
- **Design › Sfumatura** (`gradient`): i preset (`gradient.presets.*`), la
  scelta dei punti (`gradient.selectStop`) e la guida sul foglio
  (`view.gradientAnnotator`).
- **Risorse › Stili grafici** (`graphic_styles`): nuovo, applica,
  ridefinisci, scollega, unisci, rinomina, ordina, togli quelli non usati
  (`graphicStyle.*`), con le finestre delle opzioni e dell'unione. Le
  righe di libreria (`graphicStyle.libraries`, `library`,
  `addFromLibrary`, `loadLibrary`, `saveLibrary`,
  `window.graphicStyleLibrary*`, `window.userGraphicStyleLibrary1`–`10` e
  `ui.saveGraphicStyleLibrary`) aspettano T30.
- **La scheda Livelli** (`layers`): una sezione registrata nella scheda
  `livelli`, che con il Completo del motore prende il posto di quella
  nativa. Livelli e sottolivelli in albero, con nome, colore, occhio,
  lucchetto, modello, contorno e stampa (`layer.*`); trascinare sposta
  (`node.move`); «Raccogli in un nuovo livello», «Sciogli in livelli»
  (sequenza e costruzione), «Unisci», «Appiattisci», «Inverti l'ordine»,
  «Trova l'oggetto»; il filtro e le opzioni del pannello (`ui.layers*`).
  I dati vengono da `document.inspect` (T11), una lettura per fotogramma
  al più.
- **≡ › Selezione** (59 righe): uguale (`select.same.*`), oggetto
  (`select.object.*`), le selezioni salvate (`select.save`, `editSaved`,
  `savedList`, `update`, e `select.recall.*` in una voce sola che le
  elenca), punti e segmenti, colore, carattere, oggetto chiave, tutto
  nella tavola, la modifica globale. Le selezioni salvate stanno nel
  documento: se la tabella di T27 le segna «ricetta», passano da lì.
- **La bacchetta magica**: lo strumento `magicWand` (`colonna/scegli`) e
  il pannello `magic_wand`, che è la fila delle sue opzioni nella testa del
  disegno (T8), con `magicWand.options` e `magicWand.set`.
- Le pagine `drawing-styles.md`, `drawing-properties.md`,
  `drawing-layers.md` e `drawing-masks.md` (le maschere d'opacità); le
  scene `disegno-fam-aspetto` (Design › Aspetto) e `disegno-fam-livelli`.
Dal prototipo: le classi `draw-appearance*`, `titolo-design`,
`pannello-risorse`.
Casi limite:
- un elemento con tre riempimenti salvato e riaperto: torna uguale (T27),
  e il Semplice ne vede uno, con l'avviso di K5 che il resto non si
  modifica lì;
- 5 000 livelli e sottolivelli: la scheda resta fluida come quella
  nativa con lo stesso numero, e lo misura una prova;
- un livello bloccato: i comandi che lo cambiano sono spenti con il
  perché;
- trascinare un livello dentro se stesso: si rifiuta, e niente cambia;
- uno stile grafico applicato a un elemento `fub:ink`: spento con
  `unmapped`;
- una maschera d'opacità modificata e poi Esc: si esce dalla modifica
  della maschera, e niente altro cambia.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/aspetto src/editors/spatial/completo/famiglie/livelli
Stato: [ ] da fare

## T16 · Il testo

Perché: il punto 1 per il testo: punto, area, su tracciato e verticale, i
pannelli Carattere, Paragrafo e OpenType, i glifi, gli stili di carattere e
di paragrafo, i fili fra caselle, il testo attorno, cerca e sostituisci, i
caratteri mancanti.
Tocca: il modello, per la famiglia `testo`.
Non toccare: `kit/font-picker.ts` (lo si usa com'è); i caratteri di K5 T7
(`crates/fub-motori/src/caratteri.rs`); il testo del Semplice.
Dipende da: T11; T27 per le righe ricche; D12 e T30 per le 4 righe dei
caratteri da file
Cosa fare:
- **Gli strumenti** in «testo» (`colonna/testo`): `type`, `areaType`,
  `typeOnPath`, `verticalType`, `verticalAreaType`, `verticalTypeOnPath` e
  `touchType`. Passano dal ponte di T4 con i tasti, il testo e l'IME; gli
  offset UTF-8 del motore diventano indici JavaScript nel client, e i fine
  riga restano come sono (CLAUDE.md).
- **Design › Carattere, Paragrafo, OpenType** (`character`, `paragraph`,
  `opentype`): famiglia e stile con `kit/font-picker.ts`, corpo,
  interlinea, crenatura, spaziatura, scala, spostamento della linea di
  base; allineamento, rientri, spazi, sillabazione, giustificazione,
  allineamento ottico, composizione; le funzioni OpenType
  (`text.setFormat`, `text.setRangeStyle`, `type.*`), con le finestre
  «Sillabazione…» e «Giustificazione…».
- **Risorse › Glifi e Stili di testo** (`glyphs`, `text_styles`): inserisci
  un glifo (`type.insert`); gli stili di carattere e di paragrafo, con
  nuovo, opzioni e applica (`ui.newCharStyle`, `ui.newParaStyle`,
  `ui.charStyleOptions*`, `text.setStyle`).
- **≡ › Testo** (52 righe): area e punto (`type.convertToAreaType`,
  `convertToPointType`), opzioni dell'area e del tracciato
  (`text.areaOptions`, `type.pathOptions`), i fili (`text.thread.*`), il
  testo attorno (`object.textWrap.*`), le tabulazioni (`text.tabs.*`),
  elenchi puntati e numerati, ruby, maiuscole e minuscole, punteggiatura
  tipografica, «Crea contorni», «Adatta il titolo», segnaposto, caratteri
  nascosti, orientamento, «Caratteri recenti ›» (`type.recentFont.*` in
  una voce sola che li elenca), i quattro `type.size.*` con i loro tasti.
- **I caratteri.** L'elenco è quello di K5 T7, dato dal modulo della
  famiglia (`text.fontList`, `text.fonts`); il motore non scandisce quelli
  del sistema (A4). «Caratteri mancanti» (`text.missingFonts`,
  `ui.missingFontsDialog`, `text.replaceFont`, `type.findFont`) è una
  finestra del kit: elenca quelli che il disegno usa e Fub non ha, e li
  sostituisce in un passo. Le 4 righe dei caratteri da file
  (`text.addFontFiles`, `text.findFontFiles`, `text.rescanFonts`,
  `ui.findFontsInFolder`), con D12 (a): «Aggiungi caratteri…» copia i file
  scelti con il kernel in `caratteri/` della cartella di T30; «Trova nella
  cartella…» cerca in una cartella del vault, con il kernel, i file dei
  caratteri che mancano; «Ricarica» rilegge `caratteri/`. Il modulo dà i
  byte al database dei caratteri del motore, senza passare da `Servizi`
  (Differenze 23). Con D12 (b) le 4 righe sono escluse.
- **Cerca e sostituisci** (`edit.findReplace`, `edit.findNext`): una
  finestra del kit, in ≡ › Modifica.
- Il testo d'area, verticale, sul tracciato, i fili, il testo attorno e
  gli stili passano dalla forma della scena o dalla ricetta, come dice la
  tabella di T27.
- `view.textThreads`, `view.snapToGlyph.*` e `type.hiddenCharacters` sono
  stato della vista (T11).
- Le pagine `drawing-typography.md` e `drawing-fonts.md`; le scene
  `disegno-fam-testo` (Design › Carattere) e
  `disegno-fam-caratteri-mancanti`.
Dal prototipo: `titolo-design`, `pannello-risorse`.
Casi limite:
- un IME che compone mentre arriva la famiglia: il testo aspetta e non si
  perde;
- emoji, combinazioni e testo da destra a sinistra: gli offset tornano
  giusti nei due versi;
- un carattere che manca: il ripiego si vede, e «Caratteri mancanti» lo
  dice;
- un file di carattere rotto in `caratteri/`: lo si salta con un avviso, e
  gli altri si caricano;
- un filo fra caselle con una casella cancellata: il testo torna nella
  casella prima, come fa il motore;
- «Crea contorni» su 10 000 caratteri: sta nei limiti di K5, o si rifiuta
  con il suo errore.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/testo
Stato: [ ] da fare

## T17 · I pennelli, le deformazioni e la pulizia

Perché: il punto 1 per i pennelli (calligrafico, a dispersione, artistico,
a motivo, a setole), il pennello a macchia, lo strumento spessore, le sette
deformazioni a mano libera, e gli strumenti di pulizia e del documento del
motore.
Tocca: il modello, per le famiglie `pennelli` e `pulizia`.
Non toccare: l'Inchiostro di Fub (A9); la cartella di T30.
Dipende da: T11; T27 per i pennelli e lo spessore variabile; T30 e D11 per
le righe di libreria; T23 per `exportAllOpen` in PDF
Cosa fare:
- **Gli strumenti**, in «disegnare» (`colonna/disegna`): `paintbrush`,
  `blobBrush` e `width`, e le deformazioni `warp`, `twirl`, `pucker`,
  `bloat`, `scallop`, `crystallize` e `wrinkle` (con `object.liquify`).
  Le deformazioni hanno le loro opzioni (raggio, intensità, dettaglio)
  nella fila generica di T8. `width` apre `ui.widthPointEdit` con un doppio
  clic su un punto di spessore.
- **Risorse › Pennelli** (`brushes`): l'elenco dei pennelli del documento
  per tipo, con nuovo, opzioni, duplica, sposta, elimina, togli quelli non
  usati, applica e togli il pennello (`brush.*`); «Nuovo pennello…» e
  «Opzioni del pennello…» sono finestre della famiglia (`ui.newBrush`,
  `ui.brushOptions`), perché l'anteprima del tratto non è un campo di
  modulo. `object.expandBrush` in ≡ › Oggetto.
- **I pennelli nel file.** Un tratto con un pennello che il formato della
  scena ha (le punte) passa da lì, il resto dalla ricetta, come dice la
  tabella di T27. Lo spessore variabile usa quello della scena.
- **Le librerie** (`brush.libraries`, `library`, `addFromLibrary`,
  `saveLibrary`, `loadLibrary`, `window.brushLibrary*`,
  `window.userBrushLibrary1`–`10`, `ui.saveBrushLibrary`): aspettano T30.
- **La pulizia** (`addon.cleanup.*`, in ≡ › Oggetto › Pulizia): semplifica
  tenendo la forma, il controllo di salute con «Mostra» e «Correggi tutto»,
  scioglie i gruppi annidati, ricuce i pezzi, e gli strumenti del testo
  (spezza, unisci, combina, togli gli a capo, dividi al cursore, allinea
  sul posto, azzera la trasformazione, sostituisci i caratteri mancanti,
  che apre la finestra di T16).
- **Gli strumenti del documento**:
  - `addon.document.saveTimestampedCopy`: una copia del disegno accanto al
    file, scritta dal kernel, con il nome `<nome>_AAAA-MM-GG_HH-MM.svg`; la
    data viene dal client, non dal motore. Un nome che c'è già prende un
    numero, e niente si sovrascrive;
  - `addon.document.exportAllOpen`: esporta ogni disegno aperto in una
    cartella del vault scelta con la scelta delle cartelle di Fub, scritto
    dal kernel. Il formato è uno di quelli che il componente ha; il PDF,
    che è quello di serie del motore, c'è solo dopo T23 e P1, e fino ad
    allora la finestra propone l'SVG;
  - `addon.document.symbolsFromLayers`: un simbolo per livello. Usa i
    simboli della scena (T27); se T22 non è ancora integrato, la voce
    funziona lo stesso, perché il simbolo è del documento.
- Le pagine `drawing-pen.md` (i pennelli e le deformazioni) e `drawing.md`
  (la pulizia e gli strumenti del documento); la scena
  `disegno-fam-pennelli` (Risorse › Pennelli).
Dal prototipo: `pannello-risorse`, `colonna-gruppo`.
Casi limite:
- un pennello artistico su un tracciato di 50 000 punti: sta nei limiti di
  K5, o si rifiuta con il suo errore;
- le deformazioni su un elemento `fub:ink`: spente con `unmapped`;
- `saveTimestampedCopy` con il file in sola lettura: la copia si scrive lo
  stesso, perché è un file nuovo; con il vault in sola lettura si rifiuta;
- `exportAllOpen` con un disegno non salvato: esporta ciò che si vede, e lo
  dice;
- «Correggi tutto» sono molti passi del motore: per Fub è un passo solo;
- un pennello del documento che nessun tratto usa: «Togli quelli non
  usati» lo toglie, e l'annulla lo rimette.
Fatto quando: il modello, e `tools/gesti-vettori.test.ts` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/pennelli src/editors/spatial/completo/famiglie/pulizia
Stato: [ ] da fare

## T18 · Gli effetti

Perché: il punto 1 per i 63 effetti vettoriali del motore (distorsioni,
deformazioni, elaborazione tracciati, regolazioni del colore, stilizzazione
e i componenti aggiuntivi), dal vivo, con l'anteprima e modificabili dopo.
Tocca: il modello, per la famiglia `effetti`.
Non toccare: gli effetti raster e 3D (T24); la sezione Aspetto (T15), dove
gli effetti applicati si vedono in pila e si riaprono.
Dipende da: T11; T27 per gli effetti che la scena non ha
Cosa fare:
- **≡ › Effetto**: i 63 effetti nei loro sottomenu (Converti in forma,
  Distorci e trasforma, Tracciato, Elaborazione tracciati, Regola,
  Stilizza, Deformazione, e i componenti aggiuntivi di colore e
  tracciato). In testa «Applica l'ultimo effetto» e «Ultimo effetto…»
  (`effect.applyLast`, `effect.last`).
- **Ogni effetto è una finestra di T6** con i parametri del suo schema e
  l'anteprima (`effect.dialog`, `effect.setParams`). Si applica con
  `effect.apply` e il suo id; il Rust prepara la famiglia `effetti` e,
  quando l'effetto appartiene a un'altra famiglia (per esempio
  `pathfinder.*` o `addon.path.*`), anche quella.
- `effect.remove`, `duplicate`, `move` e `lightingPreset` in ≡ › Effetto e
  nella sezione Aspetto (T15), che li elenca; `effect.expandAppearance` in
  ≡ › Oggetto.
- **L'oracolo.** Il caso di ogni effetto confronta i pixel del disegno con
  l'effetto applicato (resvg, K5 T2) con quelli che il motore stesso
  disegna, con i valori di serie e con un secondo insieme di valori.
- **Nel file.** Un effetto che il formato della scena sa dire (un filtro
  con lo stesso senso) passa da lì; il resto dalla ricetta, come dice la
  tabella di T27. Un effetto dalla ricetta, aperto dove la ricetta non si
  legge, si vede come la grafica espansa che il motore scrive nel corpo.
- La pagina `drawing-effects.md`; la scena `disegno-fam-effetti` (la
  finestra «Distorsione libera…» con l'anteprima).
Dal prototipo: `dlg-sposta` (la forma delle finestre con l'anteprima),
`menu-disegno`.
Casi limite:
- un effetto su un gruppo con un elemento `fub:ink`: si applica al gruppo,
  e l'inchiostro resta com'è dentro;
- un effetto su 50 000 elementi: l'anteprima resta al più ogni 120 ms, e
  un'anteprima vecchia si butta (T6);
- «Applica l'ultimo effetto» senza un effetto prima: la voce è spenta con il
  perché;
- un effetto con parametri fuori dai limiti: l'errore accanto al campo, e OK
  è spento;
- un effetto rimosso dalla pila: il disegno torna com'era, in un passo.
Fatto quando: il modello, e un caso con l'oracolo per ognuno dei 63
effetti.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/effetti
Stato: [ ] da fare

## T19 · Le tavole, i righelli e le misure

Perché: il punto 1 per le tavole da disegno (più di una per documento), le
guide, l'origine dei righelli, le unità, le quote e gli strumenti di misura.
Tocca: il modello, per la famiglia `tavole`.
Non toccare: `tools/rulers.ts` e `tools/grid.ts` oltre a ciò che T11 ci ha
messo; la sezione Documento di T10, a cui si aggiungono sezioni senza
cambiarla.
Dipende da: T11; T27 per le tavole e le quote, se la tabella lo dice
Cosa fare:
- **Gli strumenti** in «misurare» (`colonna/misura`): `artboard`,
  `measure`, `measure_inspect` e `dimension`. `measure` mostra la misura
  sul foglio, come sovrapposizione, e nella banda.
- **Design › Documento › Tavole** (`artboards`): l'elenco delle tavole con
  nuova, duplica, elimina, togli quelle vuote, riordina, copia, taglia,
  sposta e le proprietà (`artboard.*`), con la finestra «Nuova tavola…»
  (`ui.newArtboard`). In ≡ › Oggetto › Tavole: adatta al disegno, adatta
  alla selezione, converti in tavole, ridisponi.
- **La banda.** «Adatta la tavola» (`view.fitArtboard`) e «Vai alla tavola
  ›», una voce sola che elenca le tavole del documento: serve
  `view.goto1`–`25`, che sono la stessa azione con un numero.
  `view.goToArtboard` è in ≡ › Visualizza.
- **Le guide** (`view.guides.*`, `guide.*`): fai, sciogli, blocca, togli; le
  guide della selezione nella sezione Documento › Guide, con posizione e
  livello.
- **Le unità e i righelli**: le unità del documento (`document.setUnits`,
  `switchUnits`), l'origine (`document.setRulerOrigin`,
  `resetRulerOrigin`); `document.setup` è la sezione Documento.
- **Le quote** (`dimension.*`): crea, aggiorna, applica a tutte, nella
  sezione Documento › Quote.
- Le tavole stanno nel corpo dell'SVG come le scrive il motore; ciò che il
  formato della scena non sa dire passa dalla ricetta, come dice la tabella
  di T27. Con il Semplice le tavole si vedono, e non si modificano.
- Le pagine `drawing-boards.md` e `drawing-rulers.md`; la scena
  `disegno-fam-tavole` (Documento › Tavole con tre tavole).
Dal prototipo: `titolo-design` (la sezione Documento), `banda`.
Casi limite:
- l'ultima tavola: «Elimina» è spenta con il perché;
- 25 tavole e una ventiseiesima: «Vai alla tavola ›» le elenca tutte, anche
  oltre la venticinquesima;
- una tavola fuori dal foglio di Fub: si vede, e «Adatta la tavola» la
  porta in vista;
- le unità cambiate: i campi delle sezioni aperte si aggiornano senza
  perdere il fuoco;
- una guida su un livello bloccato: non si sposta, e lo si dice.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/tavole
Stato: [ ] da fare

## T20 · Le immagini, il ricalco e i collegamenti

Perché: il punto 1 per le immagini dentro un disegno: il ricalco
dell'immagine con i suoi preset, il retino vettoriale, il mosaico, il
ritaglio, la rasterizzazione e i collegamenti ai file.
Tocca: il modello, per la famiglia `immagini`; più l'uso di
`reveal_in_system` (`crates/fub-app/src/reveal.rs`, così com'è) dal client.
Non toccare: `crates/fub-app/src/reveal.rs` e `lib.rs`; il kernel.
Dipende da: T11
Cosa fare:
- **Design › Ricalco dell'immagine** (`image_trace`), quando la selezione è
  un'immagine: preset, modo, soglia, colori, percorsi, angoli, rumore,
  «Ricalca», «Ricalca ed espandi», «Sciogli», «Espandi», la vista
  (`imageTrace.*`). Il ricalco è un lavoro di K3, con «Annulla» e lo stato
  nella sezione (`imageTrace.cancelRuns`, `hideRuns`); l'anteprima
  (`imageTrace.preview`) si rifà al più ogni 120 ms, e un valore nuovo
  annulla il lavoro vecchio. I preset in una finestra della famiglia
  (`ui.imageTracePresetDialog`, `imageTrace.presets.*`), salvati nelle
  preferenze del motore (T11).
- **≡ › Oggetto › Immagine**: retino vettoriale, rasterizza, mosaico,
  ritaglia (`ui.cropImage`, una finestra della famiglia con le maniglie
  del ritaglio), maschera.
- **I collegamenti.**
  - Risorse › Collegamenti (`links`): l'elenco delle immagini collegate e
    incorporate del documento, con lo stato (c'è, manca, cambiato).
  - Design › Immagine, quando la selezione è un'immagine collegata:
    aggiorna, ricollega, vai, incorpora, scollega, le opzioni di
    posizionamento (`ui.placementOptionsDialog`).
  - Un collegamento si apre solo dentro il vault e passa dal kernel. Un
    percorso fuori dal vault o assoluto si mostra «manca», con
    «Ricollega…», che apre la scelta dei file di Fub nel vault.
  - «Mostra nel file manager» (`links.reveal`) e «Modifica l'originale»
    (`links.editOriginal`) chiamano `reveal_in_system` con `open` falso o
    vero, come fa il resto di Fub; dove non c'è un'app di sistema, il suo
    esito `no_opener` diventa il messaggio del kit.
  - «Trova nella cartella…» (`links.findFiles`, `ui.findLinksInFolder`)
    cerca con il kernel i file che mancano in una cartella del vault.
- La pagina `drawing-images.md`; le scene `disegno-fam-immagini` (Design ›
  Ricalco dell'immagine) e `disegno-fam-collegamenti`.
Dal prototipo: `titolo-design`, `pannello-risorse`.
Casi limite:
- il ricalco di un'immagine di 8000×8000: un lavoro con l'avanzamento e
  «Annulla»; `NoMemory` lo ferma con l'errore;
- il disegno chiuso durante il ricalco: il lavoro si annulla, e niente si
  applica;
- un collegamento a `../fuori/del/vault.png`: «manca», senza leggere il
  file;
- un collegamento a un file cambiato fuori da Fub: «cambiato», con
  «Aggiorna»;
- «Modifica l'originale» su un'immagine incorporata: spenta con il perché.
Fatto quando: il modello, e il caso di `../fuori/del/vault.png` in
`crates/fub-disegno/tests/disco.rs` (T28) passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; cargo test -p fub-disegno --test disco; npx vitest run src/editors/spatial/completo/famiglie/immagini
Stato: [ ] da fare

## T21 · Le trame e gli oggetti dinamici

Perché: il punto 1 per la pittura dinamica, le trame (pattern) e la loro
modifica, le maglie di sfumatura, le fusioni, gli inviluppi, le
ripetizioni, gli oggetti su un tracciato e l'intreccio.
Tocca: il modello, per le famiglie `trame` e `dinamici`; più
`docs/product/drawing-blends.md` (nuova) e la sua riga in
`docs/README.md`.
Non toccare: le altre famiglie; la ricetta (T27), che si usa com'è.
Dipende da: T11, T27
Cosa fare:
- **Gli strumenti**: `livePaintBucket`, `livePaintSelection` e `mesh` in
  «colore» (`colonna/colore`); `blend` e `objectsOnPath` in «oggetti»
  (`colonna/oggetti`).
- **≡ › Oggetto**: Pittura dinamica, Trama (crea, modifica), Fusione,
  Inviluppo, Ripeti, Oggetti sul tracciato, Intreccio e Maglia, ognuno con
  crea, opzioni, sciogli ed espandi. Le opzioni sono finestre di T6
  (`ui.blendOptions`, `ui.livePaintGapOptions`); il pannello `blend` è la
  finestra delle opzioni della fusione.
- **Design › Trama** (`pattern_options`), durante la modifica di una
  trama: tipo di ripetizione, misura, sovrapposizione, copie, e «Fatto»,
  «Annulla» e «Salva una copia» (`object.pattern.*`, `pattern.*`). La
  modifica di una trama è un modo della superficie: Esc la chiude come
  «Annulla».
- **Design › Pittura dinamica e Maglia**, quando la selezione è un gruppo
  di pittura dinamica o una maglia: le lacune, il riempimento e il tratto
  dei bordi; i punti della maglia e il loro colore.
- **Nel file.** Le ripetizioni e le trame usano la forma della scena; la
  pittura dinamica, la maglia, la fusione, l'inviluppo, gli oggetti sul
  tracciato e l'intreccio passano dalla ricetta, come dice la tabella di
  T27, con nel corpo la grafica espansa.
- Le pagine `drawing-patterns.md` e `drawing-blends.md`; la scena
  `disegno-fam-trame` (Design › Trama durante la modifica).
Dal prototipo: `titolo-design`, `menu-oggetto`, `colonna-gruppo`.
Casi limite:
- una fusione di 1000 passi: sta nei limiti di K5, o si rifiuta con il suo
  errore;
- una fusione con un capo cancellato: il motore la scioglie, e lo si dice;
- la modifica di una trama e il disegno chiuso: la trama resta com'era;
- un file con la ricetta di una fusione, cambiato fuori da Fub: si apre con
  la grafica espansa e l'avviso, e la ricetta vecchia non si riscrive
  (T27);
- l'intreccio su elementi di livelli diversi: si rifiuta con il perché.
Fatto quando: il modello, e l'andata e ritorno della ricetta di ogni
costrutto della famiglia in `crates/fub-disegno/tests/ricetta.rs` (T27)
passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; cargo test -p fub-disegno --test ricetta; npx vitest run src/editors/spatial/completo/famiglie/trame src/editors/spatial/completo/famiglie/dinamici
Stato: [ ] da fare

## T22 · I simboli e il web

Perché: il punto 1 per i simboli e i loro strumenti, le librerie di
elementi, le sezioni (slice), il CSS, l'interattività dell'SVG e
l'esportazione per il web e per gli schermi.
Tocca: il modello, per le famiglie `simboli` e `web`.
Non toccare: `document.export` e le righe dei formati (T23); la cartella
di T30.
Dipende da: T11; T27 per i simboli; T30 e D11 per le righe di libreria
Cosa fare:
- **Gli strumenti**: gli 8 strumenti dei simboli (spruzza, sposta,
  comprimi, ridimensiona, ruota, colora, scherma, stile) in «oggetti»
  (`colonna/oggetti`); `slice` e `sliceSelection` in «misurare»
  (`colonna/misura`).
- **Risorse › Simboli** (`symbols`): nuovo, opzioni (`ui.symbolOptions`),
  posiziona, modifica ed esci, aggiorna, duplica, sostituisci, elimina,
  scollega, togli quelli non usati, scegli le istanze, l'aspetto
  dell'istanza (`symbol.*`). Un simbolo è un `<symbol>` con i suoi `<use>`,
  la forma della scena (T27, Differenze 21), così il Semplice lo vede e
  l'export lo tiene.
- **Risorse › Librerie** (`libraries`, `library_panel`): le librerie di
  elementi del documento con i loro gruppi (`library.*`); importa ed
  esporta passano come byte dalla scelta dei file di Fub. Le righe delle
  librerie dei simboli dell'utente (`symbol.libraries`, `library`,
  `addFromLibrary`, `saveLibrary`, `loadLibrary`, `window.symbolLibrary*`,
  `window.userSymbolLibrary1`–`10`, `ui.saveSymbolLibrary`) aspettano
  T30.
- **Le sezioni** (`object.slice.*`, `slice.list`): in ≡ › Oggetto ›
  Sezione, e nella sezione Documento › Sezioni con posizione e misura;
  `view.slices.hide` e `lock` in ≡ › Visualizza.
- **Design › Documento**: Esporta le risorse (`asset_export`,
  `assets.*`), Proprietà CSS (`css_properties`, `css.*`: copia negli
  appunti, esporta in un file), Interattività SVG (`svg_interactivity`,
  `svgInteractivity.*`).
- **L'interattività SVG.** Gli attributi degli eventi e i file di script
  collegati si tengono nel file come li scrive il motore, ma Fub non li
  esegue mai: nel foglio, nell'anteprima e nell'export per il web non
  gira nessun `on*` e nessuno `<script>`. Un test con un `onclick` lo
  prova.
- **Esportare per il web e per gli schermi** (`document.exportForWeb`, con
  l'anteprima, `webExport.*`, `document.exportForScreens`,
  `document.exportPresets.*`, `document.exportSettings`): una finestra
  della famiglia con l'anteprima del file che esce e la sua misura in byte;
  il motore rende i byte, e il kernel li scrive in una cartella del vault
  scelta con la scelta delle cartelle di Fub. I preset restano nelle
  preferenze del motore (T11).
- Le pagine `drawing-symbols.md` e `drawing-export.md` (il web e gli
  schermi); le scene `disegno-fam-simboli` (Risorse › Simboli) e
  `disegno-fam-web` (la finestra «Esporta per il web»).
Dal prototipo: `pannello-risorse`, `pannello-risorse-molti`,
`titolo-design`.
Casi limite:
- un simbolo modificato con 2000 istanze: si aggiornano in un passo;
- un simbolo eliminato con istanze: il motore chiede se scollegarle; la
  domanda è una conferma del kit;
- un `<use>` che punta a un simbolo che non c'è: lo si mostra come K5, e non
  si perde;
- un SVG con `onload` aperto e salvato: l'attributo resta, e non gira mai;
- l'esportazione per gli schermi in una cartella in sola lettura: si
  rifiuta con il perché, e niente si scrive a metà.
Fatto quando: il modello, e il test dell'`onclick` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/simboli src/editors/spatial/completo/famiglie/web
Stato: [ ] da fare

## T23 · I formati: aprire, posizionare, esportare, stampare

Perché: il punto 1 per gli importatori e gli esportatori del motore (PDF,
EPS, AI, DXF, EMF, Office), «Posiziona…», «Esporta come…», il pacchetto, i
preset del nuovo documento, salva come modello e la stampa. Sono un
sottocomponente, così chi non li vuole non li porta (D9).
Tocca: il modello, per la famiglia `formati`; più:
- `crates/fub-features/src/componenti.rs` (la riga
  `fub.disegno-formati`), `crates/fub-features/Cargo.toml`,
  `crates/fub-host/Cargo.toml` e `crates/fub-disegno/Cargo.toml` (le
  feature `drawing-formats` e `formati`);
- `Cargo.lock`, `deny.toml` solo se una licenza nuova la chiede (e allora
  si ferma e chiede, Regole);
- `vendor/vectorcraft/patches/` (una patch d'esportazione al primo numero
  libero, solo se serve) e `UPSTREAM.md`;
- `apps/client/src/editors/spatial/templates/gallery.ts` e
  `templates/choices.ts` (i preset del nuovo documento);
- l'uso di `print_artifact` e `reveal_in_system` dal client;
- le righe `aspetta T23` di T11 e di T17 e i file delle loro famiglie che
  le chiudono (`nucleo`, `pennelli`; vedi «Le righe che aspettano»);
- `docs/product/drawing-new.md`.
Non toccare: `crates/fub-app/src/print.rs` e `reveal.rs`; il salvataggio
dei disegni (K5), che resta quello di Fub; `docs/reference/budgets.json`
(`librerie_doppie` non sale senza il sì).
Dipende da: T11, D9; P1 per le 16 righe PDF, EPS e di stampa (A16)
Cosa fare:
- **Il sottocomponente**, con D9 (a):

  ```
  Riga::motore("fub.disegno-formati", "component.disegno-formati.name")
      .group("disegnare")
      .requires(&["fub.disegno-completo"])
      .cargo_feature("drawing-formats")
      .senza_bundle()
  ```

  Acceso di serie. La feature `drawing-formats` di `fub-host` accende
  `fub-disegno/formati`, che accende le feature del motore che le patch
  0001 e 0002 di K5 spengono (importatori; il PDF solo con P1 fuso). Le
  righe con `sotto:disegno-formati` nella colonna `pigro` rispondono
  `Unserved` con il sottocomponente spento.
- **Le dipendenze.** `cargo deny check` verde; il conto di
  `librerie_doppie` (`node .github/scripts/check-motori.mjs`) prima e dopo
  nel resoconto. Se sale, il task si ferma con il conto e chi porta ogni
  libreria (Regole).
- **Aprire e posizionare.** «Posiziona…» (`file.place`, `place.info`,
  `place.queue`) apre la scelta dei file di Fub nel vault; il kernel legge
  i byte e il motore li importa. I formati sono quelli compilati
  (`document.formats`): SVG e immagini sempre; DXF, EMF e Office con la
  feature; PDF, EPS e AI dopo P1. `importMatches.*` (le corrispondenze di
  un import) è interno a «Posiziona…».
- **Esportare.** «Esporta come…» (`file.exportAs`, `document.export`,
  `document.exportSelection`, `file.export.svg`, `file.export.png`,
  `file.formatOptions`, le finestre delle opzioni di ogni formato) usa la
  finestra d'esportazione che c'è (`tools/export-dialog.ts`) quando il
  formato ce l'ha, e una finestra di T6 per gli altri; il motore rende i
  byte e il kernel li scrive. `file.exportInBackground` e
  `file.cancelExport` sono un lavoro di K3 con «Annulla».
  `file.exportForScreens` porta a T22.
- **Le righe che passano a `fub`:**
  - `file.saveAsTemplate`: copia il disegno nella cartella dei modelli del
    vault (`draw.templates`, `docs/product/drawing-new.md`);
  - `file.documentSetup`: la sezione Documento di Design (T10);
  - `file.print`: `print_artifact` di Fub, con il PDF che il motore rende
    (dopo P1);
  - il resto di ≡ › File che Fub ha già (apri, salva, recenti, chiudi), come
    nella mappa.
- **I preset del nuovo documento** (`file.newPresets`, `.save`, `.delete`)
  stanno nella finestra «Nuovo disegno» che c'è
  (`templates/gallery.ts`), in una sezione «Preset del motore» che si
  carica con `import()` solo quando la si apre e solo con il componente
  acceso.
- **Il pacchetto** (`file.package`, `ui.packageDialog`): il disegno e le sue
  immagini collegate copiati dal kernel in una cartella nuova del vault;
  «Mostra il pacchetto» (`file.showPackage`) chiama `reveal_in_system`.
- **Salva per il web** (`file.saveForWeb`): la finestra di T22;
  `file.saveForWeb.browser` scrive l'HTML e l'immagine in una cartella del
  vault con il kernel, poi `reveal_in_system` con `open: true`.
- **Le righe di P1** (A16): `document.exportPdf`, `exportEps`,
  `pdfInfo`, `pdfSettings`, `pdf.preset.*`, `file.export.pdf`,
  `ui.savePdfDialog`, `ui.pdfPresetsDialog`, `ui.pdfPresetDialog`,
  `ui.epsOptionsDialog` e i due `file.print`, e da T11
  `clipboard.importPdf`, `importEps` ed `exportPdf`. Si fanno quando P1 è
  fuso; fino ad allora restano «da fare» con `aspetta P1`.
- `file.documentColorMode` in ≡ › File, sul documento.
- Le pagine `drawing-import.md`, `drawing-export.md`, `craft-files.md`
  (che cosa si apre e che cosa no; i `.vectorcraft` restano in sola
  lettura) e `drawing-new.md` (i preset); la scena `disegno-fam-formati`
  («Esporta come…» con DXF).
Dal prototipo: `menu-disegno` (≡ › File).
Casi limite:
- un file da posizionare più grande dei limiti di K5: si rifiuta con il suo
  errore, prima di leggerlo tutto;
- un PDF da posizionare con P1 non fuso: il formato non c'è nella scelta, e
  la voce lo dice;
- un DXF rotto: l'errore dell'importatore, e niente cambia;
- l'esportazione annullata a metà: niente si scrive, e il file vecchio
  resta;
- un modello con lo stesso nome di uno che c'è: prende un numero, e niente
  si sovrascrive;
- il sottocomponente spento: le voci non ci sono, `Unserved`, e il disegno
  si apre e si salva uguale;
- un importatore che cerca un file accanto (un font, un'immagine): non lo
  trova, perché il motore non tocca il disco (T28), e lo dice.
Fatto quando:
- il modello;
- `cargo deny check` e `node .github/scripts/check-motori.mjs` verdi;
- `node .github/scripts/check-cargo-feature-default.mjs` esce con 0;
- `cargo check -p fub-host --no-default-features --features
  drawing-complete` compila (i formati spenti);
- `cargo test -p fub-disegno --test disco` passa con gli importatori
  accesi.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; cargo test -p fub-disegno --test disco; cargo deny check; npx vitest run src/editors/spatial/completo/famiglie/formati src/editors/spatial/templates
Stato: [ ] da fare

## T24 · Gli effetti raster e il 3D

Perché: il punto 1 per i 62 effetti raster (sfocature, ombre, bagliori,
artistici, pennellate, schizzo, texture, pixel, video) e i 4 effetti 3D,
con le impostazioni raster del documento e la galleria degli effetti.
Tocca: il modello, per le famiglie `raster` e `tre-d`.
Non toccare: la famiglia `effetti` (T18) e la sua pagina oltre alla sezione
nuova.
Dipende da: T18, D8
Cosa fare:
- Con D8 (a): le due famiglie compilate dentro e pigre come le altre. Con
  (b) dietro una feature spenta, raggiungibile da `default` come vuole
  `check-cargo-feature-default.mjs`; con (c) le 69 righe sono «escluse».
- **≡ › Effetto**: i sottomenu raster e 3D, come in T18: ogni effetto è una
  finestra di T6 con l'anteprima e l'oracolo dei pixel.
- **L'anteprima raster è un lavoro.** Un effetto raster su un'area grande
  può essere lento: l'anteprima passa da un lavoro di K3, e un valore nuovo
  annulla quello vecchio (il numero di giro). L'interfaccia non aspetta.
- **La galleria degli effetti** (`ui.effectGalleryDialog`): una finestra
  della famiglia con le miniature degli effetti raster, fatte al primo uso
  e tenute nella cache della famiglia (liberata dal `Budget`).
- **Le impostazioni raster del documento** (`document.rasterEffectsSettings`,
  `ui.rasterEffectsSettingsDialog`): risoluzione, sfondo, margine, nella
  sezione Documento e in ≡ › Effetto.
- **Il 3D** (`threeD.revolve`, `extrude`, `inflate`, `rotate`): finestre con
  l'anteprima; il risultato dal vivo passa dalla ricetta, con nel corpo la
  grafica espansa (T27).
- Le ombre, i bagliori e la sfocatura che il formato della scena ha già
  (`stylize.dropShadow`, `innerGlow`, `outerGlow`, `blur.gaussian`) passano
  da lì nei due versi; gli altri dalla ricetta, come dice la tabella di
  T27.
- La pagina `drawing-effects.md` (gli effetti raster e il 3D); la scena
  `disegno-fam-raster` (la galleria degli effetti).
Dal prototipo: `dlg-sposta`, `menu-disegno`.
Casi limite:
- un effetto raster a 300 ppi su una tavola grande: il lavoro rispetta i
  limiti di K5 e `NoMemory` lo ferma con l'errore;
- l'anteprima chiesta dieci volte in fila: gira l'ultima, le altre si
  annullano;
- la galleria chiusa mentre fa le miniature: il lavoro si ferma;
- un'ombra applicata, salvata e riaperta nel Semplice: si vede ed è un
  filtro della scena;
- un effetto 3D su un testo: si applica al testo dal vivo, e il testo resta
  modificabile, come fa il motore.
Fatto quando: il modello, con un caso con l'oracolo per ognuno dei 66
effetti.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/raster src/editors/spatial/completo/famiglie/tre-d
Stato: [ ] da fare

## T25 · La stampa, la prospettiva e i grafici

Perché: il punto 1 per la gestione del colore di stampa, la prova colori,
le sovrastampe, le separazioni, l'appiattimento della trasparenza, i segni
di taglio, la griglia prospettica con i suoi preset e i nove grafici.
Tocca: il modello, per le famiglie `stampa`, `prospettiva` e `grafici`;
più `docs/product/drawing-perspective.md` e `drawing-graphs.md` (nuove) e
le loro righe in `docs/README.md`.
Non toccare: `crates/fub-app/src/print.rs`; le righe dei formati (T23).
Dipende da: T11, T23; P1 per le 13 righe della stampa (A16)
Cosa fare:
- **La stampa e il colore.** In ≡ › Modifica: impostazioni del colore e
  assegna il profilo (con i profili di T14). In ≡ › Visualizza: imposta la
  prova, prova i colori, anteprima della sovrastampa, area di taglio,
  righelli video. In ≡ › Oggetto: crea i segni di taglio, appiattisci la
  trasparenza (`ui.flattenTransparencyDialog`, con i preset in
  `ui.flattenerPresetsDialog` e l'anteprima in `ui.flattenerPreview`).
  `object.setOverprint` e `object.convertDocumentColorMode` in ≡ › File.
  `cropMarks` in ≡ › Effetto, come effetto dal vivo.
- **Design › Documento**: Anteprima dell'appiattimento
  (`flattener_preview`) e Separazioni (`separations`,
  `view.separationsPreview`), che mostrano le lastre del documento.
- **La stampa del motore** (`print.setup`, `preview`, `presets.*`,
  `tiling`, `view.printTiling`, lo strumento `printTiling` e le due
  finestre dei preset): passa dal PDF, e quindi da P1 e T23 (A16). La
  stampa vera è `print_artifact` di Fub con il PDF che il motore rende,
  con i preset del motore (segni, margini, affiancamento) applicati prima.
  `print.printers` e `print.printerSetup` passano a `fub`: le stampanti le
  sceglie la finestra di stampa del sistema, come nel resto di Fub. Fino a
  P1 queste righe restano «da fare» con `aspetta P1`.
- **La prospettiva.** Gli strumenti `perspectiveGrid` e
  `perspectiveSelection` (`colonna/prospettiva`); in ≡ › Visualizza ›
  Griglia prospettica: mostra, blocca, aggancia, righelli, i preset (uno,
  due, tre punti) e «Definisci griglia…» (`ui.perspectiveGridDialog`).
  Il piano attivo si sceglie con il widget dei piani, una sovrapposizione
  sul foglio (`ui.perspectivePlane`, `perspective.widget.options`). I
  preset dell'utente (`ui.perspectiveUserPreset1.1`–`3.5`) sono una voce
  sola che li elenca; salva, elimina, importa ed esporta
  (`perspective.presets.*`) passano come byte dalla scelta dei file di Fub,
  e restano nelle preferenze del motore (T11). Attacca e stacca in ≡ ›
  Oggetto.
- **I grafici.** I nove strumenti in «oggetti» (`colonna/oggetti`), e
  `graph.create` con un clic. I dati di un grafico (`graph.setData`) in una
  finestra del kit con una tabella che si modifica (righe, colonne,
  incolla da un foglio come testo con tabulazioni); tipo, design, colonna e
  segno in ≡ › Oggetto › Grafico. Il grafico passa dalla ricetta, con nel
  corpo la grafica espansa (T27).
- Le pagine `drawing-export.md` (la stampa), `drawing-perspective.md` e
  `drawing-graphs.md`; le scene `disegno-fam-prospettiva` (la griglia a due
  punti con il widget) e `disegno-fam-grafici` (la finestra dei dati).
Dal prototipo: `menu-disegno`, `titolo-design`, `colonna-gruppo`.
Casi limite:
- la prova colori senza un profilo: la voce è spenta con il perché;
- la stampa con P1 non fuso: le voci non ci sono, e ≡ › File › Stampa…
  resta quella di Fub per il disegno come immagine, com'è adesso;
- un oggetto attaccato alla prospettiva e la griglia cambiata: segue la
  griglia, come fa il motore;
- i dati di un grafico con una cella non numerica: la si segna nella
  tabella, e OK è spento;
- un grafico con 10 000 valori: sta nei limiti di K5, o si rifiuta con il
  suo errore;
- l'appiattimento annullato: niente resta.
Fatto quando: il modello.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; npx vitest run src/editors/spatial/completo/famiglie/stampa src/editors/spatial/completo/famiglie/prospettiva src/editors/spatial/completo/famiglie/grafici
Stato: [ ] da fare

## T26 · I dati e l'automazione

Perché: il punto 1 per le variabili e i set di dati, gli attributi e le
informazioni del documento, le azioni e il lavoro in serie, lo script del
motore; e la decisione sui plug-in del motore (D9).
Tocca: il modello, per le famiglie `dati` e `automazione`; più
`crates/fub-features/Cargo.toml`, `crates/fub-host/Cargo.toml` e
`crates/fub-disegno/Cargo.toml` (la feature `drawing-script`, con D9 (a) o
(b)), `docs/product/drawing-data.md` (nuova) e la sua riga in
`docs/README.md`.
Non toccare: `crates/fub-wasm-host/` (i plug-in di Fub); l'ADR di T1 oltre
alla riga di D9.
Dipende da: T11, D9; T30 e D11 per `variable.loadLibrary`
Cosa fare:
- **Design › Documento**: Variabili (`variables`: definisci, rinomina,
  elimina, rendi dinamico il testo, la visibilità, l'immagine o il grafico,
  lega, slega, blocca, evidenzia), Set di dati (nuovo, scegli, rinomina,
  cattura, aggiorna, elimina, precedente, successivo, importa ed esporta
  come byte con la scelta dei file di Fub), Informazioni sul documento
  (`doc_info`, `docInfo.save`, che scrive con il kernel), Memo (`memo`).
  `variable.loadLibrary` aspetta T30.
- **Design › Attributi** (`attributes`), sulla selezione: note, URL,
  mappa immagine. «Apri l'URL» (`attributes.openUrl`) apre il web viewer
  isolato di Fub (`crates/fub-app/src/web_viewer.rs`), con le sue regole
  (solo https, il remoto come dice la sua impostazione).
- **Informazioni sul file** (`ui.fileInfoDialog`): una finestra di T6.
- **Cronologia › Azioni** (`actions`): una sezione registrata nella scheda
  Cronologia, sotto la cronologia di Fub, con gli insiemi di azioni, il
  registra, il riproduci, duplica ed elimina (`ui.actionSet.*`). Un'azione
  riprodotta è un passo solo della cronologia di Fub (A8). Il lavoro in
  serie (`action.batch`, `command.batch`, `ui.batchDialog`) è un lavoro di
  K3 con «Annulla», sui disegni di una cartella del vault, letti e scritti
  dal kernel.
- **Lo script** (con D9 (a) o (b), feature `drawing-script`):
  `script.check` e `ui.checkScript` controllano uno script;
  `ui.javascriptFilesDialog` sceglie i file degli script nel vault, che il
  kernel legge. Lo script gira nel motore dentro `file_access::confine` con
  `AutomationRoots::nessuna()` (T28): non legge e non scrive file, e un
  comando che lo chiede si rifiuta.
- **I plug-in del motore** (le 11 righe `sotto:disegno-plugin`): con D9
  (a) sono «escluse» con il rimando a D9 e all'ADR di T1; con (b) un
  sottocomponente come T23, con un'ADR nuova prima del codice; con (c)
  escluse come lo script.
- La pagina `drawing-data.md`; le scene `disegno-fam-dati` (Documento ›
  Variabili) e `disegno-fam-azioni`.
Dal prototipo: `titolo-design`, `design-punto` (la forma delle sezioni;
la sezione Azioni della Cronologia non ha un pezzo suo e segue quella).
Casi limite:
- un set di dati importato con una colonna che non c'è fra le variabili: lo
  si dice, e il resto si importa;
- un'azione registrata con un comando che poi è «escluso» (un plug-in):
  la riproduzione si ferma lì con il perché;
- il lavoro in serie su 500 disegni: un lavoro con l'avanzamento e
  «Annulla», e un errore su un file non ferma gli altri;
- uno script che chiede un file: rifiutato prima del disco;
- un URL `http:` o `file:` negli attributi: il web viewer lo rifiuta con il
  suo errore.
Fatto quando: il modello, e il caso dello script che chiede un file in
`crates/fub-disegno/tests/disco.rs` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test famiglie; cargo test -p fub-disegno --test disco; npx vitest run src/editors/spatial/completo/famiglie/dati src/editors/spatial/completo/famiglie/automazione
Stato: [ ] da fare

## T27 · La ricetta e le forme della scena

Perché: il punto 1 per ciò che l'SVG non sa dire (D10, Differenze 12 e
21). Un effetto dal vivo, un aspetto con tre riempimenti o una fusione
devono tornare uguali dopo un salvataggio, e il file deve restare un SVG
che si vede ovunque. Dove il formato della scena ha già la stessa cosa, il
motore deve poterla cambiare nella forma di Fub, così il Semplice,
l'esportazione e le versioni vecchie di Fub la capiscono.
Tocca:
- `vendor/vectorcraft/patches/0005-ricetta-per-elemento.patch` (nuova) e
  la sua riga in `vendor/vectorcraft/UPSTREAM.md`;
- `crates/fub-disegno/src/ricetta.rs` (nuovo) e una riga `mod` in
  `src/lib.rs`;
- di K5: `crates/fub-disegno/src/apertura.rs` (leggere le ricette),
  `src/differenza.rs` (scriverle), `src/mappa.rs` (la ricetta accanto
  all'id dell'elemento), `src/perdite.rs` e le righe di
  `tests/corpus/perdite.tsv` che con T27 cambiano, ognuna con il perché;
- `crates/fub-disegno/tests/ricetta.rs` e `tests/ricetta/*.svg` (nuovi);
- `docs/reference/scene-format-recipe.md` (nuova) e la sua riga in
  `docs/README.md`;
- `docs/architecture/disegno.md` (la sezione «La ricetta»);
- se D10 arriva tardi e un task di famiglia è già integrato: le sue righe
  `aspetta T27` e i file della famiglia che le chiudono (vedi «Le righe
  che aspettano»).
Non toccare: `crates/fub-scene/` (il formato della scena non cambia: la
ricetta sta in `<metadata>`, che la scena conserva già); il client (gli
avvisi passano dalla via che K5 usa per le perdite); le famiglie, che
leggono la tabella di `ricetta.rs` quando arrivano; il blocco
`<vectorcraft:document>` che il motore scrive per sé.
Dipende da: T28 (la patch 0003 si applica prima), D10
Cosa fare:
- **La patch 0005**, nel motore:
  - `node_recipe(doc, node) -> Option<Vec<u8>>`: la parte nativa di un
    elemento che il corpo SVG non porta (effetti dal vivo, aspetto in
    pila, parametri di una forma dal vivo, di una fusione, di un oggetto
    dinamico), nel formato nativo del motore e con la sua versione;
  - `apply_recipe(doc, node, bytes) -> Result<(), RecipeError>`: la rimette
    sull'elemento, con un errore tipato per i byte rotti e uno per una
    versione più nuova;
  - `body_hash` diventa pubblico, e `element_hash(markup)` lo applica al
    corpo di un elemento senza il suo `transform`;
  - l'elemento `<vectorcraft:recipe for="<id>" hash="…" v="1">` (base64)
    dentro `<metadata>`, nello spazio dei nomi `urn:vectorcraft:editing`.
    Non è `<vectorcraft:document>`: il motore, aperto da solo su un file
    di Fub, non scambia una ricetta per il documento intero.

  La patch si propone a monte (`Fubeo/vectorcraft`), e `UPSTREAM.md` dice
  il numero della PR.
- **L'impronta è per elemento.** Copre il corpo dell'elemento (lui e i
  figli) senza il suo `transform`, con le regole di `body_hash` (gli spazi
  fra i tag non contano). Così:
  - spostare, ruotare o scalare l'elemento nel Semplice, che cambia solo il
    `transform`, tiene la ricetta;
  - un elemento cambiato altrimenti, nel Semplice o fuori da Fub, perde la
    sua ricetta e solo quella: si apre come grafica semplice, l'avviso lo
    dice, e la ricetta vecchia non si riscrive mai;
  - una ricetta orfana (l'elemento non c'è più) cade alla scrittura dopo.

  Il Semplice, che non sa niente della ricetta, la lascia com'è; alla
  scrittura dopo la differenza ricalcola le impronte e toglie le ricette
  che non tornano.
- **Le versioni.** `v="1"`. Una ricetta con una `v` più grande apre il
  disegno in sola lettura, con il perché, come K5 fa per un file che non sa
  scrivere. I metadati che Fub non conosce, anche di altri spazi dei nomi,
  restano parola per parola.
- **`ricetta.rs`**, la tabella dei costrutti, con un `match` esaustivo sui
  costrutti del motore: un costrutto nuovo a monte non compila finché non
  ha la sua riga.

  | Esito | Quando | Esempi |
  |---|---|---|
  | `Scena` | il formato della scena ha la stessa cosa con le stesse opzioni: si traduce nei due versi | effetti e fusione (`scene-format-effects.md`), simboli e `<use>` (`scene-format-symbols.md`), ripetizioni (`scene-format-repeats.md`), spessore variabile (`scene-format-width.md`), sfumature e motivi (`scene-format-resources.md`), punte (`scene-format-pens.md`) |
  | `Ricetta` | la scena non ce l'ha, o non con le stesse opzioni: il corpo porta la grafica espansa e la ricetta il resto | aspetto in pila, effetti dal vivo che la scena non ha, forme dal vivo, fusioni, oggetti dinamici, prospettiva, grafici |
  | `Corpo` | l'SVG semplice basta | tracciati, forme semplici, testo semplice |

  Le famiglie leggono la tabella: un comando che crea un costrutto
  `Ricetta` passa da qui, un costrutto `Scena` usa la forma della scena.
- **La differenza** (K5 T11) scrive le ricette come togli e aggiungi sul
  posto, dentro il `<metadata>` che c'è (o in uno nuovo, primo figlio di
  `<svg>`), senza toccare il resto del file. **L'apertura** legge le
  ricette, controlla le impronte e le applica con `apply_recipe`; una
  ricetta che non si applica dà l'avviso, e l'elemento resta grafica
  semplice.
- `docs/reference/scene-format-recipe.md`: la forma dell'elemento,
  l'impronta, le versioni, che cosa succede quando un elemento cambia, la
  tabella `Scena`/`Ricetta`/`Corpo`. `docs/architecture/disegno.md`, la
  sezione «La ricetta»: chi la possiede (il ponte) e il rimando alla
  pagina.
Dal prototipo: niente.
Casi limite:
- un file scritto da VectorCraft con il suo `<vectorcraft:document>`: Fub
  lo apre dal corpo, come K5, e lascia il blocco com'è; dopo la prima
  scrittura di Fub il motore, aperto da solo, lo trova non intatto e apre
  il corpo (`EDITING_STALE`), che è ciò che fa già;
- due ricette per lo stesso id: vale la prima, la seconda cade con
  l'avviso;
- un base64 rotto o una ricetta che `apply_recipe` rifiuta: l'elemento
  resta grafica semplice, con l'avviso;
- l'id dell'elemento cambiato fuori da Fub: la ricetta è orfana;
- due elementi con lo stesso id (K5 li rinomina): la ricetta segue
  l'elemento che tiene l'id;
- un `<metadata>` con contenuto di altri (RDF, Inkscape): resta;
- 50 000 elementi con la ricetta: l'apertura sta nei limiti di K5 o si
  rifiuta con il suo errore;
- un file con le ricette aperto con il componente spento: si vede come
  grafica semplice, e le ricette restano parola per parola.
Fatto quando:
- `cargo test -p fub-disegno --test ricetta` passa, con: l'andata e
  ritorno di ogni riga `Scena` e `Ricetta` della tabella; un elemento
  cambiato fuori da Fub che perde solo la sua ricetta e lo dice; uno
  spostamento nel Semplice che la tiene; una versione più nuova in sola
  lettura; i metadati sconosciuti uguali; un base64 rotto ignorato con
  l'avviso;
- il cancello di K5 (`node tools/disegno-cancello/cancello.mjs`) resta
  verde, e le righe cambiate di `perdite.tsv` hanno il perché;
- `node tools/vendor-craft/vendor.mjs vectorcraft check` esce con 0;
- `node .github/scripts/check-doc-links.mjs` esce con 0.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test ricetta; node tools/disegno-cancello/cancello.mjs; node tools/vendor-craft/vendor.mjs vectorcraft check
Stato: [ ] da fare

## T28 · Il motore non tocca il disco, e le sue tabelle si contano

Perché: A4 e il punto 2. Senza radici il motore lascia passare ogni
percorso (Differenze 22), e le sue tabelle globali crescono senza un modo
di contarle e di liberarle (Differenze 11). Prima che una famiglia nasca
(T3), il motore deve rifiutare ogni file che non gli dà il kernel, e ogni
tabella che cresce deve dire quanto pesa e potersi svuotare.
Tocca:
- `vendor/vectorcraft/patches/0003-nessuna-radice-e-tabelle.patch` (nuova)
  e la sua riga in `vendor/vectorcraft/UPSTREAM.md`;
- di K5: `crates/fub-disegno/src/motore.rs`;
- `crates/fub-disegno/src/disco.rs` (nuovo) e una riga `mod` in
  `src/lib.rs`;
- `tools/disegno-disco/elenco.mjs` e `tools/disegno-disco/elenco.test.mjs`
  (nuovi);
- `crates/fub-disegno/disco.tsv` (nuovo);
- `crates/fub-disegno/tests/disco.rs` e `tests/famiglie_memoria.rs`
  (nuovi);
- `scripts/check.sh` (una riga) e `CONTRIBUTING.md` (una riga nel blocco
  `ci-required`);
- `docs/architecture/disegno.md` (la sezione «Il disco»).
Non toccare: `.github/workflows/` (l'orchestratore); le patch 0001 e 0002
di K5; il kernel, che il motore non chiama (riceve byte); il client.
Dipende da: T2 (l'elenco si controlla contro la mappa)
Cosa fare:
- **La patch 0003**, nel motore:
  - `AutomationRoots::nessuna() -> Arc<AutomationRoots>`: radici vuote ma
    in vigore, con cui `check_read` e `check_write` rifiutano ogni percorso
    con il loro errore. A `cfb30d81`, `AutomationRoots::new(&[], &[])`
    rende `None`, e senza radici non si controlla niente
    (`crates/engine/src/file_access.rs`);
  - per ogni tabella globale che cresce con l'uso, un `<tabella>_bytes()`
    che ne stima il peso e un `release_<tabella>()` che la svuota. Sono le
    `static` con `OnceLock`, `LazyLock`, `Mutex` o `RwLock` dei crate che
    Fub compila: il pianificatore ne ha trovate 64 con `grep`, fuori da
    `ui-egui`, `mcp`, `testkit` e dai test, per esempio in
    `render/src/placed_document.rs`, `doc/src/placed_document.rs`,
    `color/src/cms.rs`, `text/src/fontdb/`, `text/src/shape.rs`,
    `engine/src/cmd/patternlib.rs`, `brushlib.rs`, `symbollib.rs`,
    `color/src/libraries.rs` e `doc/src/style_libs.rs`. Quali crescono lo
    dice la lettura del codice: una tabella costante (un catalogo) non ne
    ha bisogno; una che cresce e non si può svuotare senza rompere il
    motore va in DECISIONS.md con il perché, e il suo peso entra lo stesso
    nei conti;
  - in testa alla patch, l'elenco delle tabelle con il crate, il nome e la
    famiglia della mappa che la fa crescere: T3 lo usa per `byte()` e
    `libera()`.

  La patch si propone a monte.
- **`motore.rs`** (K5): alla nascita di `Disegni`,
  `file_access::confine_process(nessuna)`, una volta per processo, con le
  radici tenute in un `OnceLock` di `disco.rs`. Se `confine_process` rende
  `false` e le radici in vigore (`file_access::current()`) non sono quelle,
  è un errore tipato e il motore non nasce. Le radici del processo valgono
  in ogni thread del motore, fuori da `confine` e da `unconfined`.
- **`unconfined`** non si ferma con le radici: il motore lo usa per ciò che
  fa la persona alla tastiera e per le sue cartelle (preferenze, recupero,
  librerie, caratteri). Per questo ogni comando che arriva a un
  `unconfined` dev'essere `kernel`, `fub` o `escluso` nell'elenco, mai
  `rifiutato`.
- **`disco.rs`**: prima del motore, un comando con un argomento che è un
  percorso (come dice lo schema del comando) si rifiuta con l'errore tipato
  di argomento non valido di K5 (A1), salvo che `disco.tsv` dica `byte` o
  `kernel` per quella forma; un comando `escluso` si rifiuta con il suo
  perché. `disco.tsv` entra con `include_str!` e si analizza una volta.
- **`elenco.mjs`** legge i crate di `vendor/vectorcraft/` che Fub compila
  e trova ogni sito di `check_read`, `check_write`, `unconfined`,
  `confine_process`, `std::fs`, `File::open`, `File::create`,
  `OpenOptions`, `read_dir`, `canonicalize`, `std::env::var`,
  `std::env::var_os`, `std::env::temp_dir` e `home_dir`. Ogni sito è una
  riga di `crates/fub-disegno/disco.tsv`, con chiave (file, funzione,
  primitiva) e le colonne `comandi` (gli id della mappa che ci arrivano,
  scritti a mano dopo aver letto il codice), `come`, `task` e `nota`.
  `come` vale:
  - `byte`: il motore lavora sui byte che Fub gli passa;
  - `kernel`: Fub legge o scrive con il kernel e passa i byte (il task che
    lo fa);
  - `fub`: una funzione di Fub serve il comando;
  - `rifiutato`: `nessuna()` lo ferma (un `check_read` o un
    `check_write` fuori da `unconfined`);
  - `escluso`: il comando si rifiuta (D6, D9);
  - `spento`: il sito sta dietro una feature che Fub non accende.

  Con `--check` cade se un sito c'è nel motore e non nell'elenco o
  viceversa, se un id di `comandi` non è una riga della mappa, se un valore
  non è ammesso o se una riga `kernel` o `byte` non ha il suo task.
- **`tests/disco.rs`**: prima di toccare il motore punta `HOME`,
  `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`,
  `TMPDIR`, `APPDATA`, `LOCALAPPDATA` e la cartella corrente a cartelle
  temporanee vuote. Lo fa una volta, in un `OnceLock`, perché ambiente e
  cartella corrente sono del processo: così va sia con `cargo test` sia con
  nextest. Poi:
  - apre, cambia e salva un disegno del corpus attraverso `Disegni` (byte
    dentro, byte fuori);
  - fa girare ogni comando dell'elenco che prende un percorso (con
    `/etc/hostname`, la cartella del test e `../fuori`) e si aspetta il
    rifiuto tipato prima del motore;
  - `color.loadProfile`, un preset da importare e una libreria da aprire
    con un percorso: rifiutati;
  - dopo ogni caso, le cartelle vuote sono ancora vuote.

  T5 lo fa girare anche su ogni caso del banco di prova.
- **`tests/famiglie_memoria.rs`**, `#[ignore]`, si lancia a mano con
  `cargo test -p fub-disegno --release --test famiglie_memoria --
  --ignored --nocapture`: per ogni tabella della patch, un comando che la
  fa crescere (scritto accanto alla tabella), il suo `*_bytes()` prima,
  dopo e dopo `release_*()`, e la crescita del processo (da
  `/proc/self/statm` su Linux; altrove dice che non misura). Stampa una
  tabella e non scrive numeri: T29 aggiunge il passo per famiglia e li
  scrive in `docs/misure/`. Un test che gira sempre controlla che dopo
  `release_*()` la tabella sia vuota e che il comando dopo funzioni.
- `docs/architecture/disegno.md`, la sezione «Il disco»: chi legge e
  scrive (il kernel), `nessuna()`, l'elenco e i valori di `come`, che cosa
  si fa quando il motore cambia (A2).
- `scripts/check.sh` e il blocco `ci-required` di `CONTRIBUTING.md`: la
  riga `node tools/disegno-disco/elenco.mjs --check`. Nel resoconto, per
  l'orchestratore, lo stesso passo in `.github/workflows/ci.yml`.
Dal prototipo: niente.
Casi limite:
- un sito dentro `unconfined` (preferenze, recupero, librerie, cartella
  dei caratteri): `nessuna()` non lo ferma, e il comando che ci arriva è
  `kernel`, `fub` o `escluso`;
- `confine_process` chiamato due volte (due `Disegni` nello stesso
  processo, i test): la seconda rende `false`, e va bene perché le radici
  in vigore sono già quelle di `disco.rs`;
- `system_font_dirs()` legge `HOME` e le cartelle del sistema: i caratteri
  sono quelli di K5 T7, il sito non si raggiunge, e lo provano la sua riga
  e la `HOME` vuota;
- un sito nuovo a monte (A2): `elenco.mjs --check` cade e lo nomina;
- un `*_bytes()` che stima poco: il test della memoria lo mette accanto
  alla crescita del processo, e T29 scrive tutti e due i numeri.
Fatto quando:
- `cargo test -p fub-disegno --test disco` passa;
- `node tools/disegno-disco/elenco.mjs --check` esce con 0, `node --test
  tools/disegno-disco/elenco.test.mjs` passa, e un sito aggiunto in una
  copia di prova del motore lo fa cadere nominandolo;
- `cargo test -p fub-disegno --release --test famiglie_memoria --
  --ignored` gira e stampa una riga per tabella;
- `node tools/vendor-craft/vendor.mjs vectorcraft check` esce con 0;
- i test di `fub-disegno` di K5 passano ancora.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test disco; node tools/disegno-disco/elenco.mjs --check; node --test tools/disegno-disco/elenco.test.mjs; node tools/vendor-craft/vendor.mjs vectorcraft check
Stato: [ ] da fare

## T29 · La chiusura: le misure, il cancello e la revisione

Perché: il cancello di K6 chiede numeri misurati, la mappa senza righe
«da fare», le foto del runner e la revisione, prima del sì dell'utente al
merge.
Tocca:
- `docs/product/drawing-complete.md` (nuova) e la sua riga in
  `docs/README.md`;
- `docs/misure/k6-disegno-<data>-<macchina>.md` (nuova);
- `apps/client/bench/webview/budgets.json` (le soglie dello scenario C1,
  dopo la misura);
- `crates/fub-disegno/tests/famiglie_memoria.rs` (il passo per famiglia);
- l'ADR di T1 (lo stato e le risposte a D1–D12);
- `docs/architecture/disegno.md` (i «(arriva con T…)» che restano);
- le baseline del banco visivo delle scene `disegno-*`, prese dal runner;
- `PLAN.md` (gli `Stato:`) e `DECISIONS.md`.
Non toccare: il codice delle famiglie, se non per un difetto che la
revisione trova, con il suo test; `.github/workflows/`.
Dipende da: tutti gli altri task (T1–T28 e T30), le risposte a D1–D12, P1
fuso (o il task «Le righe del PDF», vedi «Le righe che aspettano» nel
modello)
Cosa fare (il coder):
- **Le misure**, su questo computer (Linux, con lo Xvfb di
  `CLAUDE_DEVICE.md`):
  - il banco WebView, scenario C1 (T5): all'avvio, nel Semplice, con il
    Completo, con la penna e con un effetto, i chunk caricati, la memoria
    della WebView e il tempo di ogni passo, in cinque giri, con la mediana
    e il peggiore;
  - `famiglie_memoria.rs`, con il passo per famiglia: per ognuna delle 26,
    `famiglia.prepara`, un comando tipico, il `byte()` della famiglia e la
    crescita del processo, poi `libera()` e di nuovo le due misure; e le
    tabelle della patch 0003 che restano piene;
  - i byte dei chunk `drawing-completo`, `drawing-indice` e
    `drawing-fam-*` dal rapporto di `npm run build`;
  - tutto in `docs/misure/k6-disegno-<data>-<macchina>.md`, con la
    revisione, la macchina, i comandi esatti e i numeri.
- **Le soglie.** In `apps/client/bench/webview/budgets.json` le soglie di
  C1 vengono dalla misura (il peggiore, più il margine che usano gli altri
  scenari del file). `docs/reference/budgets.json` cambia solo con il sì di
  D9.
- **La pagina** `drawing-complete.md`: che cos'è il Completo con il motore,
  come lo si sceglie e come lo si spegne (il componente), che cosa carica e
  quando, dove stanno le cose (≡, la colonna, l'ispettore, la banda), i
  rimandi alle pagine di famiglia e le righe escluse con il loro perché (D6,
  D9).
- **L'ADR** di T1: «Accettata», con le risposte a D1–D12 e il rimando alle
  misure.
- **Il cancello**, riga per riga (la tabella «Cancello di K6»): l'esito di
  ogni prova in un file per la PR.

Cosa fa l'orchestratore, dopo il coder:
- le baseline delle scene `disegno-*` dal runner (artifact della CI), mai
  rigenerate in locale;
- la revisione del diff intero di K6, riga per riga (cose in più,
  doppioni, API premature, generati scritti a mano, disposer mancanti),
  scritta nella PR;
- `gh pr ready`, la CI completa (Windows e macOS compresi) verde, e il
  merge solo con il sì dell'utente.
Dal prototipo: tutti gli stati, come confronto finale.
Casi limite:
- P1 non fuso: le righe che lo aspettano restano «da fare»,
  `check-disegno-mappa.mjs --finale` cade e K6 non chiude; l'orchestratore
  lo dice all'utente con il conto delle righe;
- una misura che supera un tetto di K3 (`librerie_doppie`,
  `tools/motori-prova/budgets.json`): ci si ferma con il conto e chi porta
  ogni libreria, e l'orchestratore chiede;
- una famiglia la cui `libera()` non riporta i suoi byte a zero: lo si
  scrive nelle misure con la tabella che resta, e la riga di DECISIONS.md
  di T28 dice perché;
- la CI di macOS o di Windows rossa su un test di K6: si guarda prima di
  chiamarla instabile;
- una baseline del runner che cambia una scena fuori dal disegno: è una
  regressione, e si torna al task che l'ha portata.
Fatto quando:
- `node .github/scripts/check-disegno-mappa.mjs --finale` esce con 0;
- ogni riga del cancello ha la sua prova verde, scritta nella PR;
- le misure stanno in `docs/misure/`, e le soglie di C1 in `budgets.json`
  vengono da lì;
- `node .github/scripts/check-doc-links.mjs` e
  `node .github/scripts/check-doc-orphans.mjs` escono con 0;
- `gh pr checks` è tutto verde con la CI completa;
- l'utente ha detto sì al merge.
Prova: scripts/check.sh; node .github/scripts/check-disegno-mappa.mjs --finale; node tools/disegno-disco/elenco.mjs --check; cargo test -p fub-disegno; cargo test -p fub-host --test famiglie_pigre; npm run bench:a11y
Stato: [ ] da fare

## T30 · Le librerie dell'utente

Perché: D11, A12 e il punto 1 per le librerie (campioni, stili grafici,
pennelli, simboli, profili di colore). Il motore legge e scrive da solo la
cartella delle librerie dell'utente (`library.rs`, `swatchlib.rs`,
Differenze 18), dentro `unconfined`, e T28 glielo vieta. Senza una via per
i byte non ci sono librerie dell'utente, e restano ferme le righe di
libreria di T14, T15, T17, T22 e T26 e, con D12 (a), i caratteri da file
di T16.
Tocca:
- `vendor/vectorcraft/patches/0004-librerie-dai-byte.patch` (nuova) e la
  sua riga in `vendor/vectorcraft/UPSTREAM.md`;
- `crates/fub-disegno/src/librerie.rs` (nuovo) e una riga `mod` in
  `src/lib.rs`;
- `crates/fub-host/src/drawing.rs` (la cartella letta e scritta con il
  kernel);
- `crates/fub-disegno/tests/librerie.rs` e
  `crates/fub-host/tests/librerie_disegno.rs` (nuovi);
- le righe dei siti delle librerie in `crates/fub-disegno/disco.tsv`, che
  passano a `kernel` con T30;
- `docs/reference/on-disk-layout.md` (la riga di
  `.fub/plugins/fub.draw/librerie/`);
- `docs/architecture/disegno.md` (la sezione «Le librerie»);
- se T14, T15, T16, T17, T22 o T26 sono già integrati: le loro righe
  `aspetta T30` e i file delle loro famiglie che le chiudono.
Non toccare: il kernel, che ha già lo spazio dati per plug-in
(`data_read`, `data_write`, `data_list`, `data_remove` di `HostApi`); le
librerie che il motore porta con sé, che restano in sola lettura dal
binario; il client delle famiglie non ancora integrate.
Dipende da: T3, T28, D11; D12 per la cartella `caratteri/`
Cosa fare:
- **La patch 0004**, «librerie dai byte», nel motore:
  - al posto della cartella (`set_dir` di `library.rs`, `set_user_dir` di
    `swatchlib.rs`), `fornisci_librerie(tipo, voci)`: le librerie
    dell'utente come coppie (nome del file, byte), date da chi ospita il
    motore;
  - i comandi che scrivono o tolgono un file nella cartella (salva nella
    cartella dell'utente, copia nell'utente, elimina) non toccano il disco:
    il loro esito porta `scrivi: [{file, byte}]` e `togli: [file]`, con la
    regola del motore per i nomi (un nome che c'è già prende un numero,
    «Brand 2.ase», e niente si sostituisce);
  - via gli `unconfined` di lettura e scrittura delle librerie, e via
    `library_paths` e il `remove_file` della cartella (`library.rs`, righe
    481 e 498).

  La patch si propone a monte.
- **`librerie.rs`**: i tipi (`campioni`, `stili`, `pennelli`, `simboli`,
  `profili`, e `caratteri` se D12 è (a)), con le estensioni che il motore
  legge per ognuno; la traduzione fra le voci della cartella e
  `fornisci_librerie`; l'applicazione di `scrivi` e `togli`. I `caratteri`
  non passano da `fornisci_librerie`: la cartella si legge allo stesso
  modo, e i byte li dà al database dei caratteri il modulo del testo (T16,
  Differenze 23).
- **`drawing.rs`** (`fub-host`), dentro il lavoro della famiglia e senza
  tenere il lucchetto del workspace mentre il motore lavora:
  1. legge `.fub/plugins/fub.draw/librerie/<tipo>/` con `data_list` e
     `data_read` del plug-in `fub.draw`, e rilascia;
  2. passa i byte al motore con `fornisci_librerie` quando la famiglia
     nasce, e fa girare il comando;
  3. rientra e applica `scrivi` e `togli` con `data_write` e `data_remove`,
     che scrivono in modo atomico; poi ridà al motore l'elenco nuovo.

  Se una scrittura fallisce, il motore riceve l'elenco di prima, e l'esito
  del comando dice, con l'errore tipato, che la libreria non è stata
  salvata.
- **«Salva libreria…» e «Apri libreria…»** in qualunque cartella del vault
  usano le forme a byte dei comandi (`data`, `dataBase64`, senza `path`):
  il client chiede dove con il selettore del vault di Fub, e il kernel
  scrive o legge il file come ogni altro file del vault. Le famiglie le
  mettono al loro posto.
- **I dati sul disco**, in `on-disk-layout.md`: la cartella è dato
  autorevole dell'utente, del plug-in `fub.draw`; il formato di ogni file è
  quello del motore per quel tipo (`.vcswatches`, `.gpl`, `.ase`, `.acb` in
  sola lettura, `.vcstyles`, documenti nativi per pennelli e simboli, ICC
  per i profili); un file che il motore non sa leggere si mostra come
  rovinato, con il perché, e non si cancella né si riscrive mai; uno di una
  versione più nuova si legge in sola lettura, se il motore lo sa fare, o
  si mostra come rovinato.
Dal prototipo: niente (le voci delle librerie stanno in `pannello-risorse`
e arrivano con le famiglie).
Casi limite:
- la cartella che non c'è: nessuna libreria dell'utente, e la prima
  scrittura la crea;
- due finestre dello stesso vault che salvano due librerie con lo stesso
  nome: il custode le serializza, e la seconda prende il numero;
- un file cambiato nella cartella da fuori (una sincronizzazione): lo si
  vede alla nascita dopo della famiglia, o alla riapertura del disegno;
- un nome di file con `/`, `\` o `..`: lo rifiuta lo spazio dati del
  kernel;
- il disco pieno a metà di una scrittura: la libreria di prima resta (la
  scrittura è atomica), e l'esito lo dice;
- 1000 file nella cartella: la lettura sta in un lavoro, e la famiglia è
  pronta quando arriva;
- il componente spento: la cartella non si legge.
Fatto quando:
- `cargo test -p fub-disegno --test librerie` passa: andata e ritorno di
  ogni tipo, il nome con il numero, un file rovinato mostrato e non
  toccato;
- `cargo test -p fub-host --test librerie_disegno` passa, con un vault
  temporaneo di `fub-testkit`: salvare, riaprire, togliere, la scrittura
  che fallisce;
- `cargo test -p fub-disegno --test disco` e
  `node tools/disegno-disco/elenco.mjs --check` passano, con le righe delle
  librerie a `kernel`;
- `node tools/vendor-craft/vendor.mjs vectorcraft check` esce con 0.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test librerie; cargo test -p fub-host --test librerie_disegno; cargo test -p fub-disegno --test disco; node tools/disegno-disco/elenco.mjs --check
Stato: [ ] da fare
