# Piano: K5 · Il disegno sul motore vettoriale

Branch: piano/k5-disegno
Obiettivo: nei disegni (`.svg`, profilo «vector»: gli strumenti che oggi
formano il Disegno, nei due spazi di lavoro Semplice e Completo)
selezionare, spostare, ridimensionare, ruotare, disegnare rettangoli, ellissi,
linee, frecce e testi e cambiare colore e spessore passano dal motore
vettoriale (VectorCraft, il componente «Motore del disegno»), guidato dalla
penna di Fub; un disegno del corpus si apre, si modifica e si salva senza
perdite visibili, e ciò che il motore non sa modificare si dice prima di
toccarlo.
Perché: gli strumenti del disegno scritti a mano in TypeScript non crescono
fino al «Disegno completo» (K6, 89 strumenti e ~710 comandi); un motore solo,
usato a sottoinsiemi, dà a K6 e alla lavagna (N6) gli stessi strumenti. K5 è
il primo passo: il motore entra, gli strumenti del disegno ci passano sopra e il cancello
dimostra che non si perde niente.
Fuori scope: il «Disegno completo» (tutti gli strumenti e i comandi del
motore, l'interruttore Semplice · Completo nella barra del file, «Apri nel
disegno completo»: K6, D-10); la lavagna sul motore, compreso «con il disegno
spento la lavagna dice che cosa manca» (N6, D-11); il profilo PDF, che tiene i
suoi strumenti (ADR 0231 §3); l'inchiostro dentro il motore (i tratti restano
`fub:ink` di Fub, A3); il formato `.vectorcraft`, gli importatori Affinity,
CAD, EPS, metafile e i plug-in WebAssembly, che restano spenti; ridurre
`fub-scene` e `fub-format-svg` a lettori (lo sono già, vedi «Differenze»);
togliere gli strumenti TypeScript del profilo «vector» (restano: sono gli
strumenti semplici del disegno con il motore spento, D-8 (c), e quelli del
profilo PDF); l'inclinazione della penna nel motore (D-12: la proposta a
monte si scrive in T30 e si manda dopo K5); l'MCP del motore; il caso
generale di un motore come scrittore del file (D-6).
Assunzioni: A1–A17 qui sotto. A1–A15 le ha scelte il pianificatore il
2026-11-02 di notte; l'utente ha risposto a D-1…D-13 il 2026-11-02 e le ha
approvate, con A9 e A15 riscritte dalle risposte (D-3, D-8) e A16, A17
nuove (D-8 (c)). D-14 ha la risposta (a) del 2026-11-03.
Ondate: fatti T1–T5, T8, T10, T12, T25, T26; poi T6 T7 | T9 T24 T28 | T27 T11 | T13 T14 T15 | T16 T17 T18 | T19 | T29 T20 | T21 | T22 | T23 | T30
(T21–T23 dopo il sì al prototipo di T25, arrivato il 2026-11-05; T24 anche
dopo K2; T6 solo quando c'è la copia `Fubeo/vectorcraft`)
Prototipo: `PLAN-ui/disegno-motore.html` (T25, fatto il 2026-11-05;
Artifact https://claude.ai/artifact/9eQfYxTBbkBc9WzQ1eW8D4); approvato:
2026-11-05 (l'utente: «2a: ridotto e fermo, 2b: resta, 2c: lascia così per
ora»: i due `kind` nuovi, Testo anche senza motore (A17), le parole del
prototipo).

## Modifiche

- 2026-11-02 · le risposte dell'utente a D-1…D-13: tutte come il piano
  tranne D-8, (c) invece di (a): con il motore spento si disegna con gli
  strumenti semplici e il chip lo dice. Cambiano T6, T7, T9, T13, T19, T21,
  T22, T23, T24 (non ancora fatti) e il cancello; nascono T25 (il
  prototipo), T26 (le risposte nell'ADR), T27 (le versioni dopo il motore),
  T28 (la sessione che si riapre), T29 (il motore spento nell'host), T30 (la
  CI completa e la revisione); T1, T3, T5, T8 e T10 sono «Da rivedere»; una
  domanda nuova, D-14 (il motore ha un interruttore suo?).

## Dal prototipo

Il prototipo è `PLAN-ui/disegno-motore.html` (T25, fatto). I pezzi
visibili, tutti fatti con ciò che la shell ha già, vanno così. I blocchi
`/* → skin/sheets.css */` e `/* → skin/settings.css */` della pagina sono
le regole nuove, passate intere da `sanitizeThemeCss`:

| Pezzo | Destinazione | Task |
|---|---|---|
| anteprima del gesto che dà il motore | `showShape` di `apps/client/src/editors/spatial/tools/editor/marks.ts` (c'è già), chiamato da `apps/client/src/editors/spatial/motore/gesti.ts` (c'è, T10) | T10 |
| chip «N parti restano come sono» e il riquadro «Che cosa manca?» con «Vai» | `SurfaceStanding` di `apps/client/src/editors/core/registry.ts` (c'è già), costruito da `apps/client/src/editors/spatial/motore/standing.ts` (nuovo) | T21 |
| gesto rifiutato | `announce(t("draw.rejected", …))` di `apps/client/src/editors/spatial/tools/editor/operations.ts` (c'è già) | T21 |
| strumento Testo nella barra, con il motore e senza | `apps/client/src/editors/spatial/tools/registry.ts`, la casella in `tools/editor/chrome/rail.ts`, l'icona in `apps/client/src/editors/spatial/icons.ts`; la strada semplice con `textElem` di `tools/text.ts` | T22 |
| chip «Motore spento: strumenti semplici» con «Accendi…», e «Motore fermo: strumenti semplici» con «Riprova» | lo stesso `SurfaceStanding`, costruito da `motore/standing.ts` (di T21) con lo stato del motore di `motore/gesti.ts` (T28) | T23 |
| «Accendi…» che apre Impostazioni › Componenti sulla riga del motore | una porta in `apps/client/src/ui/commands.ts` come `registerDrawingImport`, aperta da `apps/client/src/panels/settings.ts`, e `focusRow` in `apps/client/src/panels/components-page.ts` (di K2) | T24 |
| la riga «Motore del disegno» con il suo interruttore, nel gruppo «Disegnare» della pagina Componenti | la riga in `crates/fub-features/src/componenti.rs`; la pagina la disegna com'è (`panels/components-page.ts`, K2) | T13 |
| i due `kind` nuovi del chip: `"reduced"` (motore spento, e la build senza motore: segno vuoto) e `"stopped"` (motore fermo: segno `--danger`), al posto di `"body"` proposto in T23 | `SurfaceStandingKind` di `apps/client/src/editors/core/registry.ts`; le regole `.pane-standing[data-standing="reduced"\|"stopped"] .pane-standing-mark` in `skin/sheets.css` | T23 |
| l'elenco lungo di «Che cosa manca?» che scorre (`grid-template-columns: minmax(0, 1fr)`, `max-height: 232px`) e il nome che si taglia, «Vai» sempre in vista | `.pane-standing-places` e la classe nuova `pane-standing-place-name` (sullo `span` del nome) in `skin/sheets.css`, `anatomia/sheets.ts` e `apps/client/src/panels/standing.ts` | T21 |
| la riga segnata dopo «Accendi…» | la classe nuova `components-row--found` in `skin/settings.css` e `anatomia/settings.ts` (di K2), messa e tolta da `focusRow` | T24 |
| l'icona `draw-text` della casella Testo (la «T» a tre tratti del prototipo) | `apps/client/src/editors/spatial/icons.ts` | T22 |
| testi | `apps/client/src/editors/spatial/strings.ts` (IT, EN); il nome e la descrizione della riga nei cataloghi di `crates/fub-features` | T13, T21, T22, T23 |
| scene del banco con il motore acceso, spento e fermo | `apps/client/bench/scene.mjs`, `apps/client/bench/fake-ipc.ts` | T23 |

## Fonti

- I «Piani di Fub» (ricomposti il 31 ottobre 2026): `passi/13-k5-disegno.md`
  (il passo e il cancello), `02-contesto.md`, `03-rischi-e-domande.md`, e per
  i confini `10-k3-motori.md`, `12a-n3.md`, `12b-n4.md`. I coder non li
  leggono: qui c'è ciò che serve.
- Il piano K3 (`origin/piano/k3-motori`, HEAD `f1a323e1`: T1–T9 fatti, con
  T8 «scaldare e documento chiuso» unito; T10–T17 nuovi, con le risposte
  dell'utente): lo strato dei motori `crates/fub-motori` (`Pigro`,
  `Servizi`, `Motori`, `Voce`, `Lavori::in_sottofondo`, il catalogo,
  `Motori::scalda_per`), `Host::warm_engine` in `crates/fub-host/src/session.rs`
  e `crates/fub-host/src/engines.rs`, `docs/reference/budgets.json`
  (`librerie_doppie` 45), `.github/scripts/check-motori.mjs`,
  `docs/architecture/motori.md`, l'adattatore d'esempio
  `crates/fub-format-xlsx/src/motore.rs`, e la forma del suo T17 («La CI
  completa e la revisione prima del merge»). Niente di questo è su main.
- Il piano K2 (`origin/piano/k2-pagina-componenti`, HEAD `17fc151e`, tutti i
  task fatti, non ancora su main): la pagina Componenti
  (`apps/client/src/panels/components-page.ts`, `ComponentsPage` con `show`
  e `reset`, l'interruttore di una riga con `data-focus-key="switch:<id>"`),
  lo stato dei componenti nel client (`apps/client/src/state/components.ts`:
  `components()`, `onComponents`, `uiOn`), le chiavi del vault
  (`crates/fub-host/src/componenti.rs`: `components.off` per le righe senza
  bundle che si spengono a mano, `lavagna_spenta`).
- VectorCraft upstream `storytold/vectorcraft` @ `cfb30d81`, letto (non
  compilato) in `/home/fubeo/.cache/fub-k1/tmp/k5/vectorcraft-sorgente`. Le
  misure di K0 (`docs/misure/motori-2026-10-31-linux-ryzen.md`) sono di
  `ed733b7`: 64,6 MiB senza simboli, `vectorcraft_engine` 11,8 MiB.
- Nel repo: ADR 0204 (il nucleo dell'inchiostro), 0213 e 0221 (come entrano i
  motori), 0231 (gli strumenti Essenziali dopo N1), `docs/reference/scene-operations.md`,
  `docs/reference/ipc-contract.md`, `tools/vendor-craft/`, `vendor/gridcraft/`.
- Scritto su main @ `620f0acd` (2026-11-02); aggiornato con le risposte
  dell'utente lo stesso giorno, sul branch @ `32fe4712`.

## Che cosa si vede

Per chi usa Fub, alla fine di K5:

1. **Il disegno è lo stesso di oggi**, nei due spazi di lavoro (Semplice e
   Completo hanno gli stessi strumenti; Completo aggiunge l'ispettore e i
   menu), con le stesse icone e lo stesso ordine: Selezione, Mano, Lente,
   Penna, Evidenziatore, Gomma, Rettangolo, Ellisse, Linea, Freccia, e in più
   **Testo** (T22, D-7), che c'è anche con il motore spento (A17).
   Disegnare una forma, spostare, ridimensionare, ruotare, scegliere col
   riquadro si fa come oggi; l'anteprima mentre si trascina è disegnata dagli
   stessi segni della superficie (`showShape`), ma la calcola il motore. Ogni
   gesto è un solo passo di annullamento, come oggi. Penna, evidenziatore e
   gomma non cambiano (sono di Fub).
2. **Quando il file ha parti che il motore non sa modificare**, accanto al
   percorso del file compare il chip «N parti restano come sono» (lo stesso
   chip dei documenti, `SurfaceStanding`); un clic apre «Che cosa manca?» con
   l'elenco delle parti e «Vai» per ciascuna, che la seleziona e la porta in
   vista. Quelle parti si vedono e si salvano come sono; un gesto che le
   toccherebbe è rifiutato con il messaggio solito della superficie
   («Non si può: …»). È il «detto prima di salvare» del passo: Fub salva da
   sé, quindi si dice all'apertura e al gesto (vedi «Differenze»).
3. **Con il motore spento** (la sua riga spenta nella pagina Componenti,
   D-14) **o fermo per un errore**, si disegna lo stesso con gli **strumenti
   semplici**: gli stessi strumenti, nello stesso ordine, che fanno ciò che
   facevano prima del motore (gli strumenti TypeScript del client), Testo
   compreso (A17). Accanto al percorso del file il chip dice «Motore spento:
   strumenti semplici» con «Accendi…», che apre Impostazioni › Componenti
   sulla riga del motore (T24); con un errore dice «Motore fermo: strumenti
   semplici» con «Riprova». Riacceso il motore, il disegno torna al motore
   senza riaprire il file. Un gesto non cambia strada a metà: se il motore
   manca mentre lo si fa, il gesto si annulla senza scrivere niente (T23,
   T28, D-8 (c)). Le parole sono proposte: si scelgono sul prototipo (T25) e
   si guardano al banco (D-9).
4. **Nei PDF non cambia niente** (il profilo `pdf` tiene i suoi strumenti),
   e nemmeno ciò che l'ispettore e i menu dello spazio Completo scrivono
   campo per campo. L'interruttore Semplice · Completo resta dov'è oggi, nel
   menu ≡ della superficie (`tools/editor/chrome/workspace.ts`), e cambia
   soltanto l'aspetto, come oggi (D-13).
5. **Sulla lavagna non cambia niente** (N6).
6. **Nella pagina Componenti** (K2) c'è una riga nuova, «Motore del disegno»,
   nel gruppo «Disegnare» accanto a «Disegni», accesa di serie e con il suo
   interruttore (T13, D-14). Spenta, il motore non si costruisce e non
   occupa memoria; i disegni restano accesi.

## Assunzioni

Dove il codice e il piano non dicono la stessa cosa vince il codice; la
differenza è scritta in «Differenze».

- A1 · **Il motore gira nell'host, in Rust nativo**, non in WebAssembly nel
  client: K3 mette i motori nell'host (`fub-motori`), il client parla con lui
  per IPC come per i fogli. Il client non carica VectorCraft.
- A2 · **Chi scrive il file resta il client** (D-6, raccomandazione a). Il
  motore tiene una copia del disegno, ci fa girare i suoi strumenti, e
  restituisce la differenza come operazioni di scena di Fub
  (`docs/reference/scene-operations.md`, le stesse che `parseWireOp`
  accetta). Il client le applica con `ctx.commit`: un passo di annullamento,
  la `DocumentSession` le porta al file. Ciò che il gesto non tocca resta
  byte per byte com'era: è il modo più solido di non perdere niente.
- A3 · **La penna resta di Fub.** I tratti di penna ed evidenziatore restano
  `fub:ink` scritti dal client (ADR 0204, `bench:ink` invariato); il motore
  non li riceve. «La penna guida gli strumenti del motore» vuol dire che i
  campioni della pipeline della penna di Fub (`ink/dom/pointer-adapter`,
  stabilizzati e senza il palmo) sono gli eventi Down/Drag/Up dello strumento
  del motore.
- A4 · **Gli eventi arrivano in coordinate di scena** (quelle di `toPoint`
  in `tools/editor/curvature-tool.ts`), con lo zoom per le tolleranze.
- A5 · **Gli id nuovi hanno il formato di Fub**: quello di
  `apps/client/src/editors/spatial/scene/ids.ts` (prefisso del tipo e 8
  caratteri base36, byte ≥ 252 scartati), con il caso preso da `uuid` v4,
  che il workspace ha già. Il motore non scrive mai id suoi nel file.
- A6 · **La mappa elemento ↔ oggetto del motore** passa da id sintetici
  `fubtmp-<n>` dati, solo nella copia d'import, agli elementi senza id; non
  arrivano mai nel file. Un elemento senza id che un gesto modifica riceve un
  id vero con `ident` nello stesso batch (scene-operations.md).
- A7 · **La copia del motore segue il file rileggendolo.** Dopo ogni sync il
  motore reimporta il testo intero in sottofondo (`Lavori::in_sottofondo` di
  K3); un gesto che arriva prima aspetta la revisione giusta. Si ottimizza
  solo se T20 misura che serve.
- A8 · **I tetti di latenza sono miei**, da confermare con la misura di T20:
  anteprima ≤ 16 ms al 95° percentile su `concept-map`, commit ≤ 50 ms,
  reimport ≤ 150 ms su un disegno di 1 MiB.
- A9 · **Il componente si chiama `fub.motore-vettoriale`**, «Motore del
  disegno», come la mappa di K1 (`crates/fub-componenti/tests/mappa_del_piano.rs`).
  Con D-8 (c) deve potersi spegnere: è una riga del gruppo «disegnare»,
  accesa di serie, che richiede `fub.draw`, mentre `fub.draw` la usa
  (`uses`) senza richiederla; spenta, i disegni restano con gli strumenti
  semplici (D-14 (a), consigliata; T13). Il componente `caratteri` della
  mappa non c'è ancora: i caratteri arrivano come servizio di `fub-motori`
  (T7, D-5), non come riga.
- A10 · **I comandi sono solo quelli del disegno di oggi**: colore del tratto, del
  riempimento, spessore. Il catalogo completo del motore è K6.
- A11 · **Revisione `cfb30d81`** di VectorCraft (quella clonata stanotte),
  copiata dal mirror `Fubeo/vectorcraft` (D-1 (a)); K0 aveva misurato
  `ed733b7`. L'upstream ha già commit più nuovi: si resta a `cfb30d81`, la
  revisione letta e contata per questo piano, e la si cambia soltanto con un
  `update` dopo K5. Se l'utente sceglie un'altra revisione, cambia solo T6.
- A12 · **Le ADR prendono il numero libero alla fusione** (main arriva a
  0235; K3 prende 0236).
- A13 · **I vettori dei gesti si generano dagli strumenti TypeScript di oggi**
  (T3), che sono il riferimento: il motore deve fare la stessa cosa, e ogni
  differenza ammessa è scritta con il suo perché. Non sono circolari: il
  motore non li ha scritti.
- A14 · **Il motore guida gli strumenti del profilo «vector»**, nei due
  spazi di lavoro: in `apps/client/src/editors/spatial/tools/registry.ts` gli
  strumenti del disegno sono gli stessi in Semplice e in Completo (`spaces:
  { vector: "simple" }`), e i gesti non guardano lo spazio
  (`tools/editor/gesture-begin.ts`, `selection-gestures.ts`). Lo stesso
  strumento si comporta in un modo solo (D-13). Il profilo PDF resta in
  TypeScript (ADR 0231 §3) fino a P5; i campi dell'ispettore e i comandi dei
  menu restano del client (scrivono operazioni di scena come oggi).
- A15 · **Si allinea tutto ciò che si può, e `usvg` resta doppio** (D-3
  (a)). T5 ha misurato che nessun `svg2pdf` pubblicato usa `usvg` 0.48
  (`docs/misure/disegno-versioni-2026-11.md`): l'export PDF di Fub resta su
  `usvg` 0.45, il motore porta la 0.48, e con lei restano doppi i crate che
  `usvg` si porta dietro (`svgtypes`, `roxmltree`, `tiny-skia-path`,
  `imagesize`). T9 alza il tetto `librerie_doppie` una volta sola, al conto
  misurato; T27 allinea dal lato di Fub ciò che si può e lo riabbassa.
  VectorCraft non si abbassa con le patch (D-3 (b) scartata).
- A16 · **Due strade, provate tutte e due** (D-8 (c)). Nel profilo «vector»
  un gesto passa dal motore quando la sessione è aperta, e dagli strumenti
  semplici (TypeScript) quando non c'è. I vettori di T3 sono l'oracolo di
  tutte e due: `tools/gesti-vettori.test.ts` per la strada semplice,
  `motore/gesti.test.ts` sul finto e i test di `crates/fub-disegno` per il
  motore. Un gesto non cambia strada a metà: cominciato sul motore, se il
  motore manca si annulla senza scrivere niente (T28).
- A17 · **Testo anche senza motore.** Con il motore spento lo strumento Testo
  resta, e crea lo stesso `<text>` del motore con `textElem` di
  `apps/client/src/editors/spatial/tools/text.ts`: «strumenti semplici» vuol
  dire gli stessi strumenti, non meno. Si vede nel prototipo (T25): se
  l'utente lo vuole spento senza motore, cambia solo T22.

## Domande per l'utente (raccolte, non bloccano)

Ognuna con la raccomandazione per prima. Il piano procede con quella; i task
che dipendono da una risposta costosa da disfare stanno dall'ondata 3 in poi.
L'utente ha risposto a D-1…D-13 il 2026-11-02 (la riga «Risposta» sotto
ognuna); D-14 è nuova, nata dalla risposta a D-8.

- D-1 · **Da dove si copia VectorCraft.** (a) Crei `Fubeo/vectorcraft` come
  per WordCraft e GridCraft, e `upstream.lock` lo nomina come `mirror`; (b)
  `vendor/` prende direttamente da `storytold/vectorcraft` a una revisione
  fissata, con `mirror = ""`. Consiglio: (a), lo stesso schema degli altri
  motori, e una copia che resta se l'upstream sparisce. Che cosa cambia: solo
  T6 (con (b) il campo `mirror` è vuoto e `verify-upstream` prova solo
  storytold). T6 non parte senza risposta.
  Risposta (2026-11-02): (a) — la copia nostra `Fubeo/vectorcraft`, che
  l'utente crea su GitHub prima di T6.
- D-2 · **Le librerie comuni di Craft (`storytold/craft-libs`).** VectorCraft
  usa `craft-docpath` (motore, SVG) e `craft-vectorcraft-format` (formato)
  da Git, a due revisioni (`92d392c`, `14d5dbb`), e `craft-pdf` dal crate
  PDF. (a) si copiano in `vendor/craft-libs/` soltanto `docpath` e
  `vectorcraft-format`, e il crate PDF va dietro una feature spenta (patch
  0002); (b) come (a) più `craft-pdf`, e il PDF del motore resta acceso;
  (c) dipendenze Git nel `Cargo.toml` di Fub. Consiglio: (a), meno codice e
  nessuna dipendenza da Git (`deny.toml` le vieta). T6.
  Risposta (2026-11-02): (a) — si copiano soltanto `docpath` e
  `vectorcraft-format`, e il PDF del motore resta spento (patch 0002).
- D-3 · **Dipendenze e licenze nuove.** Contate sul `Cargo.lock` di
  VectorCraft partendo da `engine`, `tools`, `svg`, `doc` e `geom` (il lock
  conta anche test, importatori e PDF che in Fub saranno spenti: è un tetto,
  non il conto vero, che fa T9): **44 crate che Fub non ha** (fra gli altri
  `harfrust`, `linesweeper`, `krilla`, `wasmi`, `ruzstd`, `tiff`,
  `icu_segmenter`, `psd`) e **37 crate che Fub ha a una versione non
  compatibile** (`usvg` 0.48, `fontdb` 0.24, `skrifa` 0.44 e 0.47,
  `read-fonts`, `vello_cpu` 0.2, `peniko` 0.6, `hayro-*` 0.7, `roxmltree`
  0.21, `svgtypes` 0.16, `pdf-writer` 0.15…); i crate gestiti sono circa
  29 MiB di sorgenti. Le licenze dichiarate che ho letto sono MIT o
  Apache-2.0; ci sono anche i caratteri OFL di `assets/fonts` (3,3 MiB, solo
  per i test del motore: in Fub sono spenti). Il tetto `librerie_doppie` di
  K3 (45) «si può soltanto abbassare». (a) Si allineano le versioni dove si può (T5) e il tetto si
  alza una volta sola, con l'elenco motivato in `docs/misure/`; (b) si
  scrivono patch per abbassare le versioni di VectorCraft finché il tetto
  regge; (c) non si porta il motore. Consiglio: (a). T5 parte prima (alza
  solo versioni che Fub ha già), T6 e T9 aspettano il sì.
  Risposta (2026-11-02): (a) — si allinea dove si può e il tetto
  `librerie_doppie` si alza una volta sola, con l'elenco motivato; `usvg`
  resta doppio (A15, T9, T27).
- D-4 · **Sei comandi IPC nuovi** (`open_drawing`, `drawing_sync`,
  `drawing_gesture`, `drawing_commands`, `drawing_command`,
  `close_drawing`) e le loro righe in `permissions/default.toml`. Consiglio:
  sì, è la stessa forma dei fogli (`open_grid_bytes` e i suoi). T19 aspetta
  il sì; T4 (i tipi) e T8 (il client, sul finto host) no.
  Risposta (2026-11-02): (a) — sì ai sei comandi: T19 li registra e le
  porte di `host/ipc.ts` tornano a chiamare l'app.
- D-5 · **I caratteri del motore adesso.** Il motore non deve cercare i
  caratteri del sistema: riceve quelli di Fub (Inter, Literata, JetBrains
  Mono, già nel binario) da un servizio `caratteri` di `fub-motori`, che K3
  aveva rimandato «al primo motore che li usa». Consiglio: sì, ora, come
  servizio (T7); la riga di componente «caratteri» della mappa di K1 arriva
  con chi ne ha bisogno da solo (K6, P5).
  Risposta (2026-11-02): (a) — il motore riceve subito i caratteri di Fub
  dal servizio comune di `fub-motori` (T7).
- D-6 · **Chi scrive il file.** (a) Il client, con le operazioni di scena che
  il motore calcola (A2); (b) il motore riscrive l'SVG intero a ogni gesto.
  Consiglio: (a): con (b) ogni gesto riscriverebbe anche ciò che non tocca, e
  il cancello «senza perdite» diventerebbe una scommessa su ogni file.
  Risposta (2026-11-02): (a) — il file lo scrive il client, con le
  operazioni che il motore calcola (A2).
- D-7 · **Lo strumento Testo nel disegno.** Il passo lo mette nel semplice;
  l'ADR 0231 §2 aveva tolto «Testo» dallo Standard, e oggi un testo libero
  non si crea: si scrive l'etichetta dentro una forma
  (`tools/labels.ts`), e il testo di un `<text>` che c'è già si cambia nel
  campo «Testo» dell'ispettore. (a) Sì: Testo torna in barra, un clic crea
  un testo con la parola «Testo», lo seleziona e mette il cursore nel campo
  dell'ispettore (svuotato, il testo sparisce, come oggi un testo senza
  niente da leggere); (b) no, resta com'è oggi. Consiglio: (a), è ciò che il
  passo chiede. T22, ultima ondata.
  Risposta (2026-11-02): (a) — Testo torna in barra; un clic crea «Testo»,
  lo seleziona e mette il cursore nel campo dell'ispettore (T22).
- D-8 · **Senza motore, nel disegno.** (a) Dopo il cancello, gli
  strumenti del motore si disattivano con «Serve il Motore del disegno» e
  «Accendi…»; (b) restano per sempre gli strumenti TypeScript come ripiego
  silenzioso. Consiglio: (a), una cosa sola che si comporta in un modo solo.
  Il codice TypeScript resta comunque, perché lo usano i PDF. T23, ultima
  ondata.
  Risposta (2026-11-02): (c) — con il motore spento tornano gli strumenti
  di prima, e il chip lo dice («Motore spento: strumenti semplici» con
  «Accendi…»): cambiano T22, T23, T24 e il cancello, nascono T28 e T29
  (A16, A17, D-14).
- D-9 · **Aspetto e parole.** Testi proposti: «N parti restano come sono»,
  «Che cosa manca?», «Questa parte resta com'è: il disegno non la sa ancora
  modificare» (non «si modifica solo nel disegno completo»: «Completo» è già
  il nome di uno spazio di lavoro, dove quella parte non si modifica lo
  stesso), «Serve il Motore del disegno», «Motore del disegno spento»,
  «Accendi…», «Il disegno si sta ancora aprendo», «Testo» (la parola del
  testo nuovo). «Accendi…» apre Impostazioni › Componenti sulla riga del
  motore: oggi dalla superficie non c'è un modo di aprirla, lo aggiunge T24.
  Consiglio: questi, con i pezzi della shell elencati in «Dal prototipo»; si
  guardano al banco in T21–T24.
  Risposta (2026-11-02): (a) — le frasi vanno bene e si guardano al banco;
  con D-8 (c) «Serve il Motore del disegno» non serve più, e le frasi del
  motore spento e fermo si scelgono sul prototipo (T25).
- D-10 · **L'interruttore Semplice · Completo nella barra del file** e
  «Apri nel disegno completo». Consiglio: con K6, quando «Completo» vuol dire
  il motore intero; oggi resta nel menu ≡.
  Risposta (2026-11-02): (a) — l'interruttore nella barra e «Apri nel
  disegno completo» arrivano con K6.
- D-11 · **«Con il disegno spento la lavagna dice che cosa manca».** In K5 la
  lavagna non usa il motore (mostra i `.svg` come immagini). Consiglio: la
  frase passa a N6, quando la lavagna userà il motore; in K5 lo dice il
  disegno (T23).
  Risposta (2026-11-02): (a) — la frase passa a N6; in K5 lo dice il
  disegno (T23).
- D-12 · **L'inclinazione della penna al motore.** Consiglio: proposta a
  monte dopo K5, quando la penna entrerà nel motore (K6 o N6); in K5 la penna
  non entra nel motore (A3).
  Risposta (2026-11-02): (a) — si propone a chi fa VectorCraft dopo K5; il
  testo della proposta lo prepara T30.
- D-13 · **Il motore anche nello spazio Completo.** Il passo dice «Disegno
  semplice»; nel codice Semplice e Completo hanno gli stessi strumenti e
  cambiano solo pulsanti, ispettore e menu. (a) Il motore guida gli
  strumenti in tutti e due (A14); (b) solo nel Semplice, e nel Completo
  restano quelli TypeScript. Consiglio: (a): con (b) lo stesso rettangolo
  sullo stesso file farebbe cose diverse a seconda di un'impostazione
  d'aspetto, e il cancello andrebbe fatto due volte. Cambia T10 e T23 (con
  (b), una condizione in più sullo spazio).
  Risposta (2026-11-02): (a) — il motore guida gli strumenti nei due spazi
  di lavoro (A14).
- D-14 · **Il Motore del disegno ha un interruttore suo?** (nuova, dalla
  risposta a D-8). D-8 (c) presuppone un motore che si può spegnere, ma nel
  modello dei componenti (K1, K2) un motore di supporto che `fub.draw`
  richiede è acceso finché i disegni sono accesi, e nella pagina Componenti
  non ha un interruttore: «Motore spento» non si vedrebbe mai, e il chip
  comparirebbe soltanto dopo un errore, come «Motore fermo».
  (a) Il motore è una riga sua nel gruppo «Disegnare», accesa di serie, con
  il suo interruttore: spenta, i disegni restano con gli strumenti semplici
  e il chip dice «Accendi…» (T13, T24, T28, T29); (b) resta di supporto,
  sempre acceso con i disegni: il chip compare solo quando il motore si
  ferma per un errore, con «Riprova», e T24 e T29 non servono. Consiglio:
  (a): dà la scelta che D-8 ha promesso (disegnare anche senza motore, con
  meno memoria e meno codice in esecuzione), e di serie fa la cosa più
  completa. Il piano va avanti con (a); T13, T24 e T29 aspettano la
  risposta, T26 la scrive nell'ADR.
  Risposta (2026-11-03): (a) — il Motore del disegno è una riga sua in
  «Disegnare», accesa di serie, con il suo interruttore (T13, T24, T28,
  T29). Il repository `Fubeo/vectorcraft`: l'utente ha detto sì a crearlo
  come copia di `storytold/vectorcraft`; il classificatore ha negato il
  comando all'orchestratore, quindi lo lancia l'utente.

## Differenze dal passo 13 e dal codice

- **La penna non diventa oggetti del motore.** Il passo dice che il tratto
  finito diventa «un oggetto del motore vettoriale nei disegni». In K5 i
  tratti restano `fub:ink` scritti dal client (A3): il cancello chiede
  `bench:ink` e la latenza della penna invariati, e il nucleo dell'inchiostro
  è di Fub (ADR 0204). Il motore riceve i campioni della penna come eventi
  dei suoi strumenti (selezione, forme, testo).
- **«Detto prima di salvare» diventa «detto all'apertura e al gesto».** Fub
  salva da sé, senza un momento «Salva»; e con il client come scrittore (A2)
  ciò che il motore non sa modificare non si perde: resta com'è, e un gesto
  che lo cambierebbe è rifiutato.
- **La lavagna non usa il motore in K5**: il suo adattatore sta in
  `fub-canvas-core` (N3) e il disegno della lavagna è N6 (D-11).
- **`fub-scene` e `fub-format-svg` sono già lettori.** Il Rust non applica
  operazioni (`crates/fub-scene/tests/ops_vectors.rs` legge e basta):
  scrive solo il client. Non c'è niente da ridurre dopo il cancello.
- **Il mirror `Fubeo/vectorcraft` non esiste ancora** (controllato su GitHub
  il 2026-11-02): con D-1 (a) lo crea l'utente prima di T6. `Fubeo/craft-libs`
  c'è già, con le due revisioni che servono (`92d392c`, `14d5dbb`).
- **`vendor.mjs` non scrive il mirror di un motore nuovo**: senza
  `upstream.lock`, `update` parte da `mirror = ""` e poi copia sempre quello
  di prima (`tools/vendor-craft/vendor.mjs`, `update`); il lock dice di non
  toccarlo a mano. Per D-1 (a) T6 aggiunge il campo `mirror` alle voci di
  `motori.mjs`, invece di scriverlo a mano.
- **`vendor.mjs` tiene una revisione per cartella**, e le due librerie di
  `craft-libs` stanno a due revisioni diverse: T6 le copia come due voci,
  ognuna nella sua cartella con la sua provenienza.
- **I crate da copiare non sono quelli del passo.** Serve anche
  `crates/testkit` (dipendenza dei test del motore, che il gate fa girare);
  `three-d` resta perché lo usa `effects`; `plugins` (WebAssembly, `wasmi`)
  lo usa anche `effects`, quindi la patch 0001 lo rende facoltativo anche
  lì; il PDF del motore (`craft-pdf`) va dietro la patch 0002; `format` e
  `craft-libs` non si possono togliere (li usa il motore); `assets/fonts`
  (OFL) serve ai test con `bundled-fonts`.
- **K0 ha misurato `ed733b7`**, il piano usa `cfb30d81` (A11).
- **Il motore non usa la sua cronologia**: l'annulla è quello del client,
  un passo per gesto.
- **L'interruttore Semplice · Completo c'è già**, nel menu ≡
  (`tools/editor/chrome/workspace.ts`), non nella barra del file (D-10), ed è
  un'impostazione d'aspetto: gli strumenti del disegno sono gli stessi nei
  due spazi. Il «Disegno semplice» del passo, nel codice, è l'insieme di
  quegli strumenti, non uno spazio di lavoro (A14, D-13).
- **Lo strumento Testo non c'è** nei `TOOLS` di
  `apps/client/src/editors/spatial/tools/registry.ts` (ADR 0231 §2), anche
  se il gruppo `"text"` di `ToolGroup` c'è, e un testo libero oggi non si
  crea: c'è l'etichetta dentro una forma (D-7).
- **Le `[patch.crates-io]` di VectorCraft** (`hayro-*` e `krilla` presi da
  `craft-libs`) valgono solo nel suo workspace: dentro quello di Fub non
  contano. Con le patch 0001 e 0002 i crate che le usano (PDF, EPS) sono
  spenti; se no, D-2 torna aperta (T6, T9).
- **La mappa di K1 vuole un componente `caratteri`**, che non esiste (A9).
- **VectorCraft non ha uno strumento Freccia**: ha le punte nello stile del
  tratto (`Arrowhead` di `crates/doc/src/appearance.rs`), non uno strumento.
  In K5 la freccia è la linea del suo strumento forma con la punta scritta
  come la scrive il client oggi (T14, il vettore `freccia` di T3).
- **Un «Accendi…» che apre la riga di un componente non c'è**, nemmeno con
  la pagina Componenti di K2: le Impostazioni scelgono la scheda solo con un
  clic (`selectTab` è privata in `apps/client/src/panels/settings.ts`), e
  `ComponentsPage` ha `show` e `reset`, non un modo di portare in vista una
  riga. Lo aggiunge T24, sopra K2. Uno strumento spento nella colonna
  (`kit/tool-rail.ts`) non serve più: con D-8 (c) gli strumenti restano
  accesi.
- **Un motore di supporto non ha un interruttore suo** (K1, K2): il risolutore
  accende una riga di supporto solo se qualcuno la richiede, e la pagina non
  le dà un interruttore (`senza_bundle_spegnibile` in
  `crates/fub-host/src/componenti.rs` di K2 esclude il gruppo `supporto`).
  Con il motore richiesto da `fub.draw`, come voleva A9, «Motore spento»
  non capiterebbe mai: da qui D-14.
- **La sessione del motore nel client non dice perché manca e non si
  riapre**: `motoreDa` di `apps/client/src/editors/spatial/motore/gesti.ts`
  prende una sola apertura, `adesso()` dà `null` sia per «spento» sia per
  «errore», e `motore/sessione.ts` chiama «errore» ogni rifiuto a metà
  sessione, anche `unserved`. Con D-8 (c) servono il perché e la riapertura
  (T28).
- **Le porte del disegno di `host/ipc.ts` non chiamano l'app**: rispondono
  `unserved` da sé (`drawingNotInApp`, commit `b4409f52`, perché
  `crates/fub-app/tests/ipc_permissions.rs` vuole registrato ogni comando che
  il client chiama). T19 le riporta a `invoke`.
- **K5 non è sopra K3 nel branch**: `piano/k5-disegno` parte da main @
  `620f0acd`, e la PR #300 è una bozza con base `main`, non
  `piano/k3-motori`. Quando K2 e K3 sono fusi, l'orchestratore unisce main
  in K5 prima di T6.
- **K2 accende un formato spento direttamente dal file**: la vista «solo
  file» di un documento (`.document-surface-file-only`) ha «Accendi PDF»,
  che accende la riga senza aprire le Impostazioni. L'«Accendi…» del
  disegno invece apre la riga del motore nella pagina Componenti, come D-9
  (a) ha approvato: l'utente vede che cosa accende e lo accende lui.
- **K3 scalda i motori per estensione** (`Host::warm_engine` e
  `Motori::scalda_per`, il T8 di K3): il motore del disegno, iscritto con
  l'estensione `svg` (T11), si scalderà quando il puntatore si ferma su un
  `.svg`. Con il motore spento nel vault non deve scaldarsi (T29).
- **La lavagna oggi richiede solo `fub.penna`**, e il commento in
  `componenti.rs` dice che il motore vettoriale «sarà una riga di supporto
  che questa richiede»: in K5 la riga nasce, non di supporto (D-14), e la
  lavagna non la usa ancora (N6). T13 aggiorna il commento.

## Prove fatte

- Lettura (niente compilazione, niente script) di VectorCraft @ `cfb30d81`:
  `Cargo.toml` del workspace (usvg 0.48 senza `text`, kurbo 0.13, skrifa
  0.47, harfrust 0.13, wasmi 2.0, vello_cpu 0.2, krilla 0.8), il `Cargo.toml`
  di `engine` (dipende da tutti gli importatori, da `pdf` e da `plugins`,
  `bundled-fonts` di serie), `crates/tools/src/input.rs` (`PointerKind`
  Down, Drag, Up, Move…), le azioni `Action::Begin`/`Action::Preview` degli
  strumenti, i comandi `paint.setFill`, `paint.setStroke`, `stroke.set`.
- Gli script di build: l'unico `build.rs` vero fra i crate da copiare è
  `crates/text/build.rs` (138 righe: legge `CRAFT_FONTS_DIR`,
  `CRAFT_FONTS_REQUIRED` e `web-fonts.txt`, scrive in `OUT_DIR`, niente rete
  e niente processi); gli altri file chiamati `build.rs` stanno in `src/` e
  sono moduli. `crates/ui-egui/build.rs` resta fuori.
- Fub oggi: `resvg` 0.45.1 (con `text`), `svg2pdf` 0.13.0, `fontdb` 0.23,
  `roxmltree` 0.20, `svgtypes` 0.15.3, `kurbo` già in tre versioni (0.11,
  0.12, 0.13), `quick-xml` 0.41.
- **Non fatta**: la prova usa e getta della compilazione (`cargo check
  --offline` su una copia) perché `craft-libs` @ `14d5dbb` e i crate nuovi non
  sono nella cache di Cargo. Il peso della compilazione, le patch 0001 e 0002
  e le licenze transitive (`cargo deny`) sono quindi **non verificati**: li
  verifica T6.
- Rilettura da coder (passo 7): ogni percorso di «Tocca» esiste in questa
  copia o è segnato «nuovo», «di Tn» o «di K3» (controllato con uno script
  sui «Tocca»), e i task di una stessa ondata hanno «Tocca» disgiunti. I
  comandi di «Prova» sono scritti sulle forme che ci sono
  (`scripts/check.sh --rapido`/`--client`, `vitest run` di
  `apps/client/package.json` con i file, `cargo test -p … --test …` sui file
  di test nominati), ma **non sono stati eseguiti**: questa copia non ha
  `node_modules` e la macchina è carica; i test nuovi nascono con i loro
  task.
- Dopo le risposte (2026-11-02), solo lettura: su GitHub `Fubeo/vectorcraft`
  non c'è, `Fubeo/craft-libs` ha `92d392c…` e `14d5dbb…`, e `cfb30d81…` è
  ancora nell'upstream; il codice di K2 (`origin/piano/k2-pagina-componenti`)
  e di K3 (`origin/piano/k3-motori` @ `f1a323e1`) letto con `git show`;
  `tools/vendor-craft/vendor.mjs` letto per il mirror. Nessuna compilazione.

## Chi aspetta chi

- **Fatti**: T1–T5, T8, T10, T12 (da main, sul finto host).
- **Subito**: T25 (il prototipo, niente codice di prodotto). T26 appena
  l'utente risponde a D-14.
- **Il sì dell'utente al prototipo** (l'orchestratore glielo mostra, con D-14
  e A17): T21, T22, T23 e T24 non partono prima.
- **K3 fuso in main** (`crates/fub-motori`, `docs/reference/budgets.json`,
  `check-motori.mjs`, `docs/architecture/motori.md`, `Host::warm_engine`):
  T6, T7, T9, T11, T13–T20, T27, T29. Prima l'orchestratore unisce main in
  `piano/k5-disegno`.
- **K2 fuso in main** (la pagina Componenti, `state/components.ts`, la
  chiave `components.off`): T13, T24, T28, T29.
- **La copia `Fubeo/vectorcraft`**, che crea l'utente (D-1 (a)): T6.
  L'orchestratore gliela chiede appena K3 è fuso; senza, T6 non parte e la
  linea del motore aspetta.
- **D-14**: T13, T24, T29 (con (b), T24 e T29 non si fanno e T13 fa la riga
  di supporto: vedi T13); T26 la scrive.
- **La CI**: i passi nuovi in `.github/workflows/` li aggiunge
  l'orchestratore, integrando il task che li chiede (T6, T13).
- N3 e N4 non servono: toccano la lavagna e l'inchiostro, non questi file.

## Regole che valgono per ogni task

- L'ambiente: `mkdir -p /home/fubeo/.cache/fub-k1/tmp/k5; export
  PATH=$HOME/.cargo/bin:$HOME/.local/opt/cc/bin:$HOME/.local/opt/node/bin:$PATH
  RUSTUP_TOOLCHAIN=1.95 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
  RUSTC_WRAPPER=sccache TMPDIR=/home/fubeo/.cache/fub-k1/tmp/k5`. Niente
  build in `/tmp`; niente build complete del workspace se non servono.
- Mai il vault reale (`~/.cache/fub-live/`), mai `~/Progetti/Fub`.
- VectorCraft si cambia solo con una patch numerata in
  `vendor/vectorcraft/patches/` e la sua riga in `UPSTREAM.md`
  (`node tools/vendor-craft/vendor.mjs vectorcraft check` resta verde). Non
  si eseguono i suoi `xtask` né i suoi script; un `build.rs` di terzi si
  legge prima di compilare.
- Nessuna dipendenza esterna nuova oltre a quelle che D-3 approva, e solo in
  T5, T6, T9 e T27. Una licenza che `deny.toml` non ammette ancora non si
  aggiunge: il task si ferma e l'orchestratore chiede.
- Le due strade del disegno (motore e strumenti semplici) restano vive tutte
  e due (A16): un task che cambia un gesto lo prova con il motore acceso (sul
  finto o in Rust) e spento (`tools/gesti-vettori.test.ts`).
- I task grafici (T21–T24) partono dopo il sì dell'utente al prototipo
  (T25); le foto del banco si confrontano con il prototipo, in chiaro e
  scuro, a piena larghezza e a 700 px.
- `.github/workflows/` lo cambia solo l'orchestratore: un coder che ha
  bisogno di un passo nuovo in CI scrive nel resoconto il passo esatto.
- Solo gli adattatori nominano il motore: `crates/fub-disegno` è l'unico crate
  che dipende da `vectorcraft-*` (`check-engine-boundary.mjs`).
- Mai un lucchetto tenuto mentre il motore lavora (come in K3).
- Niente lavoro all'avvio: il motore si costruisce al primo disegno aperto,
  o quando la shell lo scalda (`warm_engine`, K3); mai con la sua riga
  spenta (T29).
- Testi nei cataloghi, in tutte le lingue; il gergo vietato di
  `apps/client/src/i18n/gergo.ts` resta fuori. Nessun nome VectorCraft,
  ArtCraft o Craft nell'interfaccia: si dice «Motore del disegno».
- Non scrivere numeri non misurati.
- Commit `tipo(scope): frase in italiano`, senza righe Co-Authored-By né
  altri trailer. Alla fine `Stato: [x] fatto` nel task.

## Cancello di K5

| Il passo chiede | Prova | Task |
|---|---|---|
| ogni disegno del corpus si apre, si modifica e si salva senza perdite visibili | `node tools/disegno-cancello/cancello.mjs`: per ogni file del corpus, sposta di (+7, +5) e torna, un rettangolo nuovo, un colore cambiato; confronto a pixel con l'oracolo di T2, al più lo 0,2% di pixel diversi fuori dalla zona toccata, zero dopo andata e ritorno | T2, T20 |
| ciò che il motore non sa conservare è detto | `crates/fub-disegno/tests/corpus.rs` con `tests/corpus/perdite.tsv`; chip e rifiuto al banco | T16, T21 |
| `bench:ink` invariato | `npm --prefix apps/client run bench:ink` prima e dopo, stesso build | T20 |
| latenza della penna invariata | la penna non chiama l'IPC (test di T10); latenza di anteprima, commit e reimport misurate in `docs/misure/` | T10, T20 |
| il disegno spento dice che cosa manca (D-8 (c): si disegna lo stesso, e lo si dice) | `motore/standing.test.ts` e `motore/sessione.test.ts` con il motore acceso, spento, fermo e riacceso; `crates/fub-host/tests/drawing.rs` con il motore spento nel vault (`Unserved`, istanze chiuse, niente riscaldamento); foto del banco `draw-engine-on`, `draw-engine-off`, `draw-engine-error`, chiaro e scuro, piena e 700 px, uguali al prototipo (la lavagna: N6, D-11) | T23, T24, T28, T29 |
| i gesti del motore fanno ciò che fanno quelli di oggi | i vettori di T3 passano sul motore, con le differenze ammesse scritte, e sugli strumenti semplici (`tools/gesti-vettori.test.ts`), Testo compreso | T3, T14, T15, T17, T22 |
| D-3 (a): le librerie in più sono motivate | `node .github/scripts/check-motori.mjs` verde con il tetto alzato una volta sola; ogni libreria doppia con il suo perché in `docs/misure/disegno-versioni-2026-11.md` | T9, T27 |
| (per ogni piano) la CI completa, la revisione riga per riga, il merge solo con il sì dell'utente | `gh pr ready 300`, poi `gh pr checks 300` tutto verde; la revisione scritta nella PR; il sì dell'utente | T30 |

## T1 · La decisione e la pagina del disegno

Perché: chi lavora dopo deve trovare in una pagina sola chi possiede che cosa
(motore, client, penna, file) e perché, prima che il codice arrivi.
Tocca: `docs/decisions/NNNN-il-disegno-sul-motore-vettoriale.md` (nuovo; NNNN
il primo numero libero quando si fonde), `docs/decisions/README.md`,
`docs/architecture/disegno.md` (nuovo), `docs/README.md`,
`docs/map/dove-sta-x.md`
Non toccare: `docs/architecture/ink-and-tools.md` ed `editor-surfaces.md` (si
aggiornano con il codice, T10 e T19); le ADR esistenti (0231 resta com'è:
la nuova la cita e ne cambia il §2 solo se D-7 è sì, scrivendolo); il passo e
i piani generali.
Dipende da: nessuno
Cosa fare:
- L'ADR, dal modello `docs/decisions/template.md`: contesto (gli strumenti
  TypeScript non arrivano a K6; un motore a sottoinsiemi), decisione (A1, A2,
  A3, A6, A7, A9, A14 di questo piano, il componente, i sei comandi IPC, il
  ripiego fino al cancello e poi D-8), conseguenze (il client resta lo
  scrittore; il motore non vede l'inchiostro; ciò che non si mappa resta
  com'è e si dice), alternative scartate (motore in WebAssembly nel client,
  motore che riscrive l'SVG, penna nel motore subito). Le domande aperte
  (D-1…D-12) come «Da decidere» con la raccomandazione.
- `docs/architecture/disegno.md`: il percorso di un gesto in un disegno
  (campioni della penna → `motore/gesti.ts` → `drawing_gesture` → strumento
  del motore sulla copia → differenza → operazioni di scena → `ctx.commit` →
  `DocumentSession` → `drawing_sync` → reimport); chi possiede che cosa
  (tabella: file, copia del motore, mappa degli id, cronologia, inchiostro);
  i limiti (20 MiB, 50 000 elementi, 10 000 operazioni, 8 MiB di operazioni,
  100 000 eventi); dove sta il codice (`crates/fub-disegno`,
  `crates/fub-host/src/drawing.rs`, `apps/client/src/editors/spatial/motore/`,
  `vendor/vectorcraft/`); che cosa vuol dire «non mappato», «approssimato»,
  «non supportato». Con «(arriva con T…)» accanto a ciò che non c'è ancora.
- Una riga in `docs/README.md`, in `docs/decisions/README.md` e in
  `docs/map/dove-sta-x.md` («il disegno sul motore» → la pagina).
Casi limite: il numero dell'ADR preso da un altro piano fuso prima (si
rinumera alla fusione, e con lui i link); un link a un file che non esiste
ancora (`check-doc-links` lo rifiuta: si nomina il percorso in codice, non
come link).
Fatto quando: `node .github/scripts/check-doc-links.mjs` e
`node .github/scripts/check-doc-orphans.mjs` escono con 0 e la pagina nuova è
raggiungibile da `docs/README.md`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto
  Da rivedere: T26 lo cambia (le risposte a D-1…D-14 nell'ADR e nella
  pagina, D-8 (c)).

## T2 · L'oracolo a pixel

Perché: il cancello confronta disegni a pixel; serve un modo di disegnare un
SVG che sia lo stesso su ogni macchina, senza i caratteri del sistema.
Tocca: `crates/fub-testkit/src/pixel.rs` (nuovo), `crates/fub-testkit/src/lib.rs`,
`crates/fub-testkit/Cargo.toml`, `crates/fub-testkit/tests/pixel.rs`
(nuovo), `crates/fub-testkit/tests/pixel/` (nuovo, due SVG piccoli),
`Cargo.toml` (radice: `resvg` in `[workspace.dependencies]`),
`crates/fub-features/Cargo.toml` (`resvg = { workspace = true, … }`),
`Cargo.lock`
Non toccare: il codice di `crates/fub-features/src/draw.rs` (usa `resvg` come
oggi); la versione di `resvg` (la cambia T5); `apps/client/bench/fidelity.mjs`.
Dipende da: nessuno
Cosa fare:
- `resvg` va in `[workspace.dependencies]` alla versione di oggi (0.45.1),
  `default-features = false`; `fub-features` lo prende `workspace = true` con
  le sue feature (`text`, `raster-images`) e `optional = true`, così il lock
  non cambia versione.
- In `fub-testkit` una feature `pixel` (spenta di serie) con `resvg`
  facoltativo, con `text`.
- `pixel.rs`: `pub struct Opzioni<'a> { pub larghezza: u32, pub facce: &'a
  [&'a [u8]] }`; `pub struct Immagine { pub larghezza: u32, pub altezza: u32,
  pub rgba: Vec<u8> }`; `pub fn disegna(svg: &str, opzioni: &Opzioni) ->
  Result<Immagine, String>` (un `fontdb` costruito solo da `facce`, mai
  `load_system_fonts`; `resources_dir: None`; l'altezza in proporzione al
  `viewBox`); `pub struct Confronto { pub diversi: u64, pub totali: u64, pub
  riquadro: Option<[u32; 4]> }`; `pub fn confronta(a: &Immagine, b:
  &Immagine, soglia: u8, fuori: Option<[u32; 4]>) -> Result<Confronto,
  String>`: un pixel è diverso se un canale differisce più di `soglia`;
  con `fuori` i pixel dentro quel riquadro non si contano; `riquadro` è il
  rettangolo che contiene i pixel diversi.
- La documentazione del modulo dice perché la soglia (antialiasing) e
  rimanda alla soglia dello 0,2% del banco di fedeltà
  (`apps/client/bench/fidelity.mjs`).
Casi limite: SVG non valido (errore, non panico); dimensioni diverse (errore);
larghezza 0 o oltre 8192 (errore); `viewBox` assente (si usano `width` e
`height`); un testo con un carattere che le facce non hanno (si disegna il
ripiego, uguale nei due lati); nessuna faccia passata (i testi spariscono:
la doc lo dice).
Fatto quando: `cargo test -p fub-testkit --features pixel --test pixel` passa
con: lo stesso SVG due volte dà 0 diversi; un rettangolo spostato di 1 px dà
un `riquadro` attorno al rettangolo; con `fuori` su quel riquadro dà 0; un
testo con le facce di `crates/fub-features/fonts/inter-400.ttf` lette dal
disco dà pixel non bianchi. `cargo tree -p fub-features` mostra lo stesso
`resvg` di prima.
Prova: scripts/check.sh --rapido; cargo test -p fub-testkit --features pixel --test pixel
Stato: [x] fatto

## T3 · I vettori dei gesti

Perché: il motore deve fare ciò che fanno gli strumenti di oggi; servono
oracoli scritti dagli strumenti TypeScript, che il motore rigioca (T14, T15,
T17) e che il finto host del client usa (T10).
Tocca: `apps/client/src/__fixtures__/disegno-gesti/` (nuovo: un JSON per
vettore), `apps/client/src/editors/spatial/tools/gesti-vettori.test.ts`
(nuovo), `docs/reference/scene-operations.md` (un §10 nuovo)
Non toccare: gli strumenti (`tools/editor/*.ts`): si registrano come sono; i
vettori delle operazioni `__fixtures__/scene-ops/` e il loro test.
Dipende da: nessuno
Cosa fare:
- Un vettore è `{ "name", "description", "input", "gesture", "expect" }`:
  `input` il testo SVG (righe LF); `gesture` = `{ "tool":
  "select"|"rect"|"ellipse"|"line"|"arrow", "layer": id|null, "selection":
  [id…], "zoom": n, "snap": { "grid": n|null, "free": bool }, "style": {
  "stroke", "width", "fill" } | null, "events": [{ "kind":
  "down"|"drag"|"up"|"move"|"double_click", "x", "y", "pressure", "shift",
  "alt", "cmd" }…] }`; `expect` = `{ "ops": [op…] | null, "selection": [id…],
  "refused": null|"unmapped"|"empty"|…, "text": testo dopo }`. È la forma che
  T4 rende un tipo: i nomi sono quelli, in `snake_case`.
- Il test monta l'editor come `tools/editor.test.ts` (`mount(source,
  options)`, `pointer()`, `drag(points)`), sceglie lo strumento, fa il gesto
  convertendo le coordinate di scena in coordinate del client, e registra le
  operazioni di `onChange` (`DrawChange.op`) e il testo. Gli id nuovi si
  scrivono `@1`, `@2`… nell'ordine in cui compaiono. Con `UPDATE_GESTI=1`
  riscrive i file; senza, li confronta.
- Un vettore di controllo (`controllo-coordinate`: rettangolo da (10, 10) a
  (60, 40), senza griglia) dimostra che le coordinate sono di scena: `x=10
  y=10 width=50 height=30`.
- Almeno 30 vettori: rettangolo, ellisse, linea, freccia; con Maiusc
  (quadrato, cerchio, 15°); sotto la misura minima (`MIN_SHAPE_PX`: nessuna
  forma); clic sul vuoto; clic su una forma; Maiusc-clic che aggiunge e
  toglie; riquadro di selezione; sposta senza griglia e con griglia;
  ridimensiona da un angolo e da un lato, con Maiusc; ruota con e senza
  Maiusc; un livello bloccato (rifiutato); un elemento estraneo (solo
  spostare); un file con righe CRLF; un elemento senza id che si sposta
  (`ident` nello stesso batch); un connettore che segue la forma spostata;
  una freccia con lo stile scelto; una selezione vuota che si sposta (niente).
- §10 di `scene-operations.md`: «Vettori dei gesti»: dove stanno, la forma,
  come si rigenerano, perché sono il riferimento, e la regola delle
  differenze ammesse (file `.tsv` accanto ai test del motore).
Casi limite: un id casuale nel testo atteso (canonicalizzato anche lì);
l'ordine delle chiavi JSON (scritto stabile); un gesto che lo strumento
rifiuta (`expect.refused` e `ops: null`); un vettore che non si rigenera
uguale due volte (il test lo fa due volte e fallisce).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/tools/gesti-vettori.test.ts` passa; con `UPDATE_GESTI=1`
due volte di fila il diff di Git è vuoto; un vettore cambiato a mano lo fa
fallire con il nome del vettore.
Prova: scripts/check.sh --rapido; npm --prefix apps/client test -- src/editors/spatial/tools/gesti-vettori.test.ts
Stato: [x] fatto
  Da rivedere: T22 lo allarga (lo strumento `text` e il vettore
  `testo-clic`, D-8 (c), A17).

## T4 · Il contratto del disegno

Perché: client, host e motore si parlano con gli stessi tipi; sono forme
condivise e vengono prima di chi le usa.
Tocca: `crates/fub-abi/src/drawing.rs` (nuovo), `crates/fub-abi/src/lib.rs`,
`crates/fub-abi/tests/drawing.rs` (nuovo), `crates/fub-abi/tests/ts_enums.rs`,
`apps/client/src/host/enums.generated.ts`, `crates/fub-features/tests/ts_mirror.rs`,
`apps/client/src/__fixtures__/mirror-samples.json`,
`apps/client/src/host/contract.ts`, `apps/client/src/host/mirror.test.ts`,
`docs/reference/ipc-contract.md`
Non toccare: `crates/fub-app` (i comandi arrivano con T19); `host/ipc.ts` e
`host/fake.ts` (T8); i tipi Grid.
Dipende da: T3
Cosa fare:
- In `drawing.rs`, con `serde` come i tipi Grid (`rename_all =
  "snake_case"`; le unioni `tag = "kind", content = "value"`):
  - limiti: `MAX_DRAWING_TEXT_BYTES = 20 MiB` (= `fub_scene::MAX_EDIT_BYTES`),
    `MAX_GESTURE_EVENTS = 100_000`, `MAX_DRAWING_OPS = 10_000` (=
    `MAX_BATCH` di `scene/ops.ts`), `MAX_DRAWING_OPS_BYTES = 8 MiB` (=
    `MAX_OP_BYTES`), `MAX_DRAWING_LOSSES = 50_000`;
  - `DrawingOpen { instance: String, revision: u64, mapped: u32, unmapped:
    u32, losses: Vec<DrawingLoss> }`; `DrawingLoss { element: String (id o
    percorso), kind: DrawingLossKind (Unmapped | Approximated |
    Unsupported), detail: String }`;
  - `DrawingSync { revision: u64, change: DrawingChange }`, `DrawingChange =
    Edits { edits: Vec<DrawingEdit>, length_before: u32, length_after: u32 }
    | Text { text: String }`; `DrawingEdit { from, to, deleted, inserted }`
    in unità UTF-16 sul testo LF, come `TextEdit` di
    `editors/core/text-operation.ts`; `DrawingSynced { revision: u64 }`;
  - `DrawingPointer { kind: Down | Drag | Up | Move | DoubleClick, x: f64, y:
    f64, pressure: f32, shift, alt, cmd: bool }`;
  - `DrawingGesture { revision, phase: Preview | Commit | Cancel, tool:
    Select | Rect | Ellipse | Line | Arrow | Text, layer: Option<String>,
    selection: Vec<String>, zoom: f64, snap: DrawingSnap { grid:
    Option<f64>, free: bool }, style: Option<DrawingStyle { stroke, width,
    fill }>, text: Option<String> (la riga del testo nuovo, solo per
    `Text`: la scrive il client nella lingua dell'interfaccia), events:
    Vec<DrawingPointer> }` (gli eventi sono quelli nuovi dall'ultima
    richiesta dello stesso gesto);
  - `DrawingPreview { shape: Option<serde_json::Value> (un `Elem` della
    scena), matrix: Option<[f64; 6]>, marquee: Option<[f64; 4]> }`;
  - `DrawingOutcome { revision, preview: Option<DrawingPreview>, ops:
    Option<String> (JSON di un array di operazioni), selection:
    Vec<String>, losses: Vec<DrawingLoss>, refused:
    Option<DrawingRefusal> }`, `DrawingRefusal = Stale | Unmapped | Empty |
    Unsupported | TooLarge | Closed | NotReady`;
  - `DrawingCommandInfo { id: String, enabled: bool }`,
    `DrawingCommandRequest { revision, id, selection, value:
    serde_json::Value }`, e le costanti degli id: `disegno.colore-tratto`,
    `disegno.colore-riempimento`, `disegno.spessore`;
  - `validate()` su ogni richiesta: limiti, numeri finiti, `zoom > 0`,
    `pressure` in 0..=1, `grid` > 0; errori `PluginError::BadArgs` con il
    campo.
- Gli specchi TypeScript come per i tipi Grid: le enumerazioni in
  `ts_enums.rs` (`UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`
  rigenera `enums.generated.ts`), i record in `ts_mirror.rs` con i campioni
  in `mirror-samples.json` (`UPDATE_MIRROR=1 cargo test -p fub-features
  --test ts_mirror`), le interfacce in `host/contract.ts` e il test in
  `mirror.test.ts`.
- In `ipc-contract.md` una sezione «Disegno» con i sei comandi, marcati
  «(arrivano con T19)».
Casi limite: testo di 20 MiB + 1 (rifiutato); 100 001 eventi (rifiutato);
`NaN` o infinito in un evento o in `matrix` (rifiutato); selezione con id
ripetuti (rifiutata); `ops` oltre 8 MiB (rifiutato da chi lo scrive, T11);
`instance` vuota (rifiutata).
Fatto quando: `cargo test -p fub-abi --test drawing` passa, compreso un test
che legge ogni `gesture` di `apps/client/src/__fixtures__/disegno-gesti/` e
la deserializza in `DrawingGesture` senza errori; gli specchi di
`ts_enums`, `ts_mirror` e `mirror.test.ts` sono verdi.
Prova: scripts/check.sh --rapido; cargo test -p fub-abi --test drawing
Stato: [x] fatto

## T5 · Le versioni in comune

Perché: VectorCraft usa `usvg` 0.48, Fub 0.45; ogni libreria in due versioni
pesa sul binario e sul tetto di K3. Allinearle prima del motore lascia a T9
solo i crate davvero nuovi.
Tocca: `Cargo.toml` (radice), `crates/fub-features/Cargo.toml`, `Cargo.lock`,
`crates/fub-features/src/draw.rs` e i moduli di `crates/fub-features/src/draw/`
(solo gli adattamenti alle API nuove),
`docs/misure/disegno-versioni-2026-11.md` (nuovo)
Non toccare: `vendor/`; il comportamento dell'export (stessi PDF e PNG: i test
di `fub-features` lo dicono); `crates/fub-testkit` (lo allinea il `workspace =
true` di T2); `crates/fub-scene` e `crates/fub-format-svg` (non usano `usvg`,
`svgtypes` né `roxmltree`: leggono l'SVG da sé).
Dipende da: T2
Cosa fare:
- Leggere le versioni del workspace di VectorCraft @ `cfb30d81` (elencate in
  «Prove fatte») e confrontarle con `Cargo.lock`.
- Portare `resvg` a 0.48 e `svg2pdf` alla prima versione che usa `usvg`
  0.48; con loro `fontdb`, `svgtypes`, `roxmltree`, `tiny-skia` dove servono.
  Se nessun `svg2pdf` pubblicato usa `usvg` 0.48, **fermarsi**: non si cambia
  niente, si scrive nel file di misura che cosa manca, e il task si chiude
  con quella nota (D-3).
- Adattare `draw.rs` e i suoi moduli alle API nuove senza cambiare il
  risultato.
- Nel file di misura: le librerie doppie prima e dopo (`cargo tree -e normal
  --all-features --target all -d -p fub-app`, lo stesso conto di
  `check-motori.mjs` di K3), e quali resteranno doppie col motore (kurbo,
  skrifa…), con il perché.
Casi limite: una feature di serie nuova di `resvg` che riaccende i caratteri
del sistema (`system-fonts` deve restare spento: il commento in
`crates/fub-features/Cargo.toml` lo spiega); un cambio di arrotondamento
nell'export PNG che fa fallire un test di confronto (si guarda prima di
toccare la soglia, e si scrive); `svg2pdf` che porta un `image` in un'altra
versione.
Fatto quando: `cargo test -p fub-features --features draw` passa;
`cargo tree -p fub-app -e normal --all-features -i usvg` mostra una versione
sola; il file di misura ha i due conti. Oppure, se `svg2pdf` non c'è: il file di misura lo dice e il lock non
è cambiato.
Prova: scripts/check.sh --rapido; cargo test -p fub-features --features draw
Stato: [x] fatto
  Da rivedere: T27 lo continua (le versioni dopo il motore, D-3 (a)).

## T6 · VectorCraft in `vendor/`

Perché: il motore entra come gli altri: upstream a uno SHA, copiato dal
nostro mirror (D-1 (a)), patch numerate, provenienza controllata in CI.
Tocca: `tools/vendor-craft/motori.mjs`, `tools/vendor-craft/vendor.mjs`
(solo il campo `mirror` di una voce nuova, e il suo `self-test`),
`vendor/vectorcraft/` (nuovo: `UPSTREAM.md`, `upstream.lock`, `Cargo.toml` e
`Cargo.lock` di Fub, i crate gestiti, `patches/0001-importatori-opzionali.patch`,
`patches/0002-pdf-opzionale.patch`, `LICENSE-MIT`, `LICENSE-APACHE`,
`NOTICE`, `ASSETS.md`, `assets/fonts/`), `vendor/craft-docpath/` e
`vendor/craft-vectorcraft-format/` (nuovi: il crate, le licenze,
`UPSTREAM.md`, `upstream.lock`), `Cargo.toml` (radice: solo `exclude`),
`scripts/check.sh` (i tre `check` nuovi e il `cargo test` del workspace di
VectorCraft, accanto a quelli di WordCraft e GridCraft)
Non toccare: `vendor/wordcraft`, `vendor/gridcraft` (salvo il campo `mirror`
della loro voce in `motori.mjs`, che dice ciò che i loro lock dicono già); i
`[workspace.dependencies]` della radice (T9); `.github/workflows/` (li
cambia l'orchestratore, vedi sotto); il resto di `vendor.mjs`.
Dipende da: T5; K3 fuso e main unito in K5; la copia `Fubeo/vectorcraft`
creata dall'utente su GitHub (D-1 (a)): se non c'è, il task non parte e
l'orchestratore la chiede all'utente.
Cosa fare:
- `motori.mjs`: un campo `mirror` per ogni voce (`https://github.com/Fubeo/wordcraft`
  e `…/gridcraft`, come nei loro `upstream.lock`); in `vendor.mjs`, `update`
  senza lock parte da quel `mirror` invece che da `""`; `self-test` lo prova.
- In `motori.mjs` la voce `vectorcraft` come `gridcraft`: `repository`
  `https://github.com/storytold/vectorcraft`, `mirror`
  `https://github.com/Fubeo/vectorcraft`, i gestiti `crates/geom`, `color`,
  `doc`, `pathops`, `brush`, `trace`, `text`, `effects`, `plugins`,
  `three-d`, `render`, `svg`, `pdf`, `format`, `eps`, `cad`, `metafile`,
  `affinity`, `scriptcheck`, `tools`, `engine`, `testkit`, e `assets/fonts`,
  `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ASSETS.md`; fuori `ui-egui`,
  `mcp`, `apps/*`, `xtask`; il `gate`: `vendor.mjs vectorcraft check`, `cargo
  test --manifest-path vendor/vectorcraft/Cargo.toml --workspace --locked
  --no-fail-fast`, `cargo test -p fub-disegno`, `check-engine-boundary.mjs`,
  `cargo deny check`.
- `node tools/vendor-craft/vendor.mjs vectorcraft update --rev
  cfb30d8139161cf1722dfabf3046741a0b21b3da --source
  https://github.com/Fubeo/vectorcraft` (A11); poi `vendor.mjs vectorcraft
  verify-upstream`, che prova la revisione sull'upstream e sul mirror.
- Patch 0001: `affinity`, `cad`, `eps`, `metafile`, `scriptcheck` (se lo usa
  solo un importatore) e `plugins` dietro feature spente in `engine` ed
  `effects`, con i `#[cfg]` dove li chiamano; patch 0002: `pdf` dietro una
  feature spenta in `engine` (D-2 (a)). Ognuna con la sua riga in
  `UPSTREAM.md` e la frase «da proporre a monte».
- Le due librerie di `craft-libs` (D-2 (a)) come due voci di `motori.mjs`,
  `craft-docpath` a `92d392cff132…` e `craft-vectorcraft-format` a
  `14d5dbb50c31…` (SHA interi letti dal mirror), con `repository`
  `https://github.com/storytold/craft-libs` e `mirror`
  `https://github.com/Fubeo/craft-libs`, i soli percorsi del loro crate più
  le licenze, e come `gate` il loro `check`. Il `Cargo.toml` di
  `vendor/vectorcraft` le prende per percorso. Se `vendor.mjs` non sa
  copiare una voce senza `Cargo.toml` di workspace, si scrive nel task che
  cosa manca e lo si chiede all'orchestratore, non si copia a mano.
- Leggere `crates/text/build.rs` prima di compilare (niente rete: «Prove
  fatte») e compilare con `CRAFT_FONTS_DIR` vuoto.
- In `scripts/check.sh`, accanto alle righe di WordCraft e GridCraft: i tre
  `vendor.mjs … check` nuovi e il `cargo test --manifest-path
  vendor/vectorcraft/Cargo.toml --workspace --locked --no-fail-fast` (con
  `CARGO_TARGET_DIR=target/vectorcraft`). Il blocco `ci-required` di
  `CONTRIBUTING.md` non nomina i motori, e resta com'è. Nel resoconto, per
  l'orchestratore: gli stessi quattro passi in `.github/workflows/ci.yml`
  (accanto a `vendor.mjs gridcraft check` e al `cargo test` di
  `vendor/gridcraft`) e `vectorcraft` nella matrice di
  `.github/workflows/motori-upstream.yml`.
Casi limite: il mirror che non ha la revisione (`update` si ferma: si chiede
all'utente di aggiornarlo, non si copia dall'upstream); il mirror che ha la
revisione con un contenuto diverso dall'upstream (`verify-upstream` rosso: ci
si ferma); una patch che non si applica (si rifà a tre vie con `update`); un
crate gestito che usa un crate escluso (si scrive, si aggiunge alla patch o
ai gestiti, con il perché); un file dell'upstream senza licenza chiara (non
si copia); `cargo deny` che trova una licenza che `deny.toml` non ammette (ci
si ferma e si chiede: è la politica delle licenze); il gate che fallisce su
un test del motore che vuole i caratteri di craft-fonts (salta da sé con
`CRAFT_FONTS` vuoto: se no, si scrive); le `[patch.crates-io]` del
workspace di VectorCraft (`hayro-*`, `krilla` da `craft-libs`) restano nel
`Cargo.toml` di `vendor/vectorcraft` solo se i suoi test le vogliono, e non
vanno mai nel `Cargo.toml` radice di Fub (si spengono i crate che le usano,
patch 0001 e 0002).
Fatto quando: `node tools/vendor-craft/vendor.mjs vectorcraft check`,
`craft-docpath check`, `craft-vectorcraft-format check` e `self-test` escono
con 0; `vendor.mjs vectorcraft verify-upstream` trova la revisione
sull'upstream e sul mirror; `upstream.lock` ha `mirror =
"https://github.com/Fubeo/vectorcraft"` scritto da `update`; `cargo test
--manifest-path vendor/vectorcraft/Cargo.toml --workspace --locked` passa (o
i test che falliscono sono elencati in `UPSTREAM.md` con il perché);
`UPSTREAM.md` dice revisione, patch, peso dei sorgenti e tempo di
compilazione misurati.
Prova: scripts/check.sh --rapido; node tools/vendor-craft/vendor.mjs self-test; node tools/vendor-craft/vendor.mjs vectorcraft check
Stato: [x] fatto (2026-11-09) · 37cf84d7..4a75895d, CI dell'orchestratore in coda · 7.722 test di VectorCraft verdi, 0 rossi, 13 `#[ignore]` dell'upstream; differenze: patch 0001 (metafile, affinity, plugins spenti) e 0002 (PDF ed EPS fuori dal grafo di `engine`, la feature `pdf` non dichiarata perché il lock vorrebbe `craft-pdf` da Git); `cad` e `scriptcheck` restano obbligatori; salvare verso `.pdf`/`.ai`/`.eps` senza `format` ora è rifiutato con un suggerimento; `vendor.mjs` ammette chiavi booleane fra percorso e versione; aperta la licenza IJG di `jpeg-encoder` (rossa in `cargo deny` da T9, domanda all'utente)

## T7 · I caratteri per i motori

Perché: il motore non deve leggere i caratteri del sistema (lo stesso disegno
deve uscire uguale ovunque); li riceve dall'host, una volta per processo.
Tocca: `crates/fub-motori/src/caratteri.rs` (nuovo), `crates/fub-motori/src/servizi.rs`
(di K3), `crates/fub-motori/src/lib.rs` (di K3), `crates/fub-motori/tests/caratteri.rs`
(nuovo), `docs/architecture/motori.md` (di K3)
Non toccare: `crates/fub-features/src/draw.rs` (dà le facce, T19); gli
adattatori dei fogli e dei documenti; il budget della memoria.
Dipende da: K3 fuso e main unito in K5 (D-5 (a): sì, adesso)
Cosa fare:
- `pub struct Caratteri { facce: Vec<&'static [u8]>, serif: String, sans:
  String, mono: String }` con `pub fn nuovi(facce, generiche: Generiche)` e
  i lettori; nessuna dipendenza da `fontdb` (ognuno costruisce il suo).
- In `Servizi`: `pub fn fornisci_caratteri(&self, caratteri: Caratteri) ->
  Result<(), Caratteri>` (una volta sola: la seconda restituisce ciò che ha
  ricevuto) e `pub fn caratteri(&self) -> Option<Arc<Caratteri>>`. Un
  `OnceLock`, niente lavoro se nessuno chiede.
- Il commento di `servizi.rs` («arrivano con il primo motore che li usa»)
  diventa: arrivati con il disegno (K5). K3 (la sua A3) ha fatto `Servizi`
  perché un campo `caratteri` si aggiunga senza cambiare chi lo usa: il
  campo va lì. Un `Pigro` non serve, perché le facce non si costruiscono:
  le dà l'host, e `fub-motori` non dipende da `fub-features`.
- Nella pagina dei motori un paragrafo «I caratteri».
Casi limite: chiesti prima che l'host li dia (`None`: il motore dice
`NotReady`, T11); dati due volte (il secondo rifiutato); zero facce
(ammesso: i testi si disegnano col ripiego, la doc lo dice); thread diversi
che li chiedono insieme.
Fatto quando: `cargo test -p fub-motori --test caratteri` passa con: prima
`None`; dopo `fornisci` le stesse facce; il secondo `fornisci` restituisce
`Err`; dieci thread che leggono insieme vedono la stessa `Arc`.
Prova: scripts/check.sh --rapido; cargo test -p fub-motori --test caratteri
Stato: [x] fatto (2026-11-09) · 4d151cd0..cec942d0 · 8 test in `tests/caratteri.rs`; differenze: `Generiche` definita come struct con `serif`, `sans`, `mono`; `nuovi` prende `impl IntoIterator`; `Debug` di `Caratteri` scritto a mano (conta facce e byte, non li stampa); il paragrafo della pagina è corto per la soglia di 450 righe

## T8 · La sessione del motore nel client

Perché: il client deve tenere il motore allineato al testo del disegno e
chiedergli i gesti, prima che il motore esista (sul finto host).
Tocca: `apps/client/src/host/ipc.ts`, `apps/client/src/host/fake.ts`,
`apps/client/bench/fake-ipc.ts`, `apps/client/src/editors/spatial/motore/sessione.ts`
(nuovo), `apps/client/src/editors/spatial/motore/sessione.test.ts` (nuovo)
Non toccare: `editors/spatial/tools/` (T10); `state/document-session.ts` (si
usa la sua API `DocumentSurface`, non si cambia); `crates/` (T19).
Dipende da: T4
Cosa fare:
- In `ipc.ts` sei metodi come `openGridBytes`, con il vault in coda come
  `revealInSystem` (`toVault(…, vault)`): `openDrawing(doc, text, vault?)`,
  `drawingSync(instance, sync, vault?)`, `drawingGesture(instance, gesture,
  vault?)`, `drawingCommands(instance, selection, vault?)`,
  `drawingCommand(instance, request, vault?)`, `closeDrawing(instance,
  vault?)`, con i nomi IPC di D-4 e i tipi di `host/contract.ts`.
- In `fake.ts` un `DrawingFake` dietro `gate(...)` come `GridBytesFake`: per
  difetto risponde `{ kind: "unserved" }` come `openGridBytes` senza la sua
  superficie (il motore non c'è); in un test si può
  accendere e dargli le risposte (una funzione `gesto(gesture) =>
  DrawingOutcome`) e registra le chiamate. Esportato anche da
  `bench/fake-ipc.ts` come gli altri.
- `sessione.ts`: `apriSessione(host, doc, text, documentSession) =>
  Promise<SessioneMotore | MotoreAssente>`; `SessioneMotore` si registra
  come superficie della `DocumentSession` (`DocumentSurface { id:
  "motore-disegno", sync(update) }`, come `editors/spatial/live/session.ts`)
  e non origina mai modifiche; a ogni `sync` manda `drawingSync` con le
  modifiche della `TextOperation` (o il testo intero per `kind: "text"`) e
  avanza `revision`; `gesto(g)` manda `drawingGesture` alla revisione
  corrente; con `refused: "stale"` rimanda il testo intero e riprova **una**
  volta; `chiudi()` chiude e si toglie dalla sessione. Le richieste vanno in
  fila (una alla volta, nell'ordine).
- `MotoreAssente { perche: "spento" | "errore" }` da `Unserved` o da un
  errore all'apertura.
Casi limite: la sessione chiusa mentre un gesto è in volo (l'esito si
scarta); due sync di fila mentre il primo è in volo (in fila, l'ordine
resta); un testo CRLF (si manda come la sessione lo ha, LF per contratto);
`stale` due volte (si arrende: `refused` resta); host che non risponde (la
fila non si blocca per sempre: un tempo limite di 10 s per richiesta, poi
`MotoreAssente { perche: "errore" }`).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/motore/sessione.test.ts` passa con: apertura su
`Unserved` dà `MotoreAssente`; una modifica della sessione arriva al finto
come `edits` con le revisioni 1, 2, 3; `stale` porta a un testo intero e a un
solo nuovo tentativo; chiusa, la sessione non manda più niente.
Prova: scripts/check.sh --rapido; npm --prefix apps/client test -- src/editors/spatial/motore/sessione.test.ts
Stato: [x] fatto
  Da rivedere: T28 lo cambia (`unserved` a metà sessione è «spento», e la
  sessione si riapre, D-8 (c), D-14); T19 cambia `host/ipc.ts` (D-4 (a)).

## T9 · Il crate `fub-disegno` e il workspace

Perché: un crate solo nomina il motore; prima di riempirlo servono il
workspace, le dipendenze, le guardie e i tetti, tutti in un posto.
Tocca: `crates/fub-disegno/` (nuovo: `Cargo.toml`, `src/lib.rs`, i moduli
vuoti `src/apertura.rs`, `src/mappa.rs`, `src/sincronia.rs`,
`src/differenza.rs`, `src/motore.rs`, `src/comandi.rs`, `src/perdite.rs`,
`src/id.rs`, `src/gesti/mod.rs`, `src/gesti/forme.rs`,
`src/gesti/selezione.rs`, `src/gesti/testo.rs`), `Cargo.toml` (radice:
membro e `vectorcraft-*` per percorso), `Cargo.lock`, `deny.toml`,
`.github/scripts/check-engine-boundary.mjs`,
`crates/fub-abi/tests/dependency_invariant.rs`, `docs/reference/budgets.json`
(di K3), `docs/misure/disegno-versioni-2026-11.md` (di T5: il conto dopo)
Non toccare: `vendor/` (T6); `crates/fub-host` (T13, T19); il codice dei
moduli (T11 e dopo).
Dipende da: T5, T6
Cosa fare:
- `crates/fub-disegno/Cargo.toml`: `vectorcraft-engine` (`default-features
  = false`, quindi senza `bundled-fonts`, PDF, importatori e plug-in),
  `vectorcraft-tools`, `vectorcraft-svg`, `vectorcraft-doc`,
  `vectorcraft-geom`, `fub-motori`, `fub-abi`, `fub-scene`, `serde_json`,
  `uuid`; dev: `fub-testkit` (`pixel`). `[lints] workspace = true`;
  `#![forbid(unsafe_code)]`.
- `src/lib.rs` dichiara i moduli con la loro documentazione di una riga e
  niente codice.
- `check-engine-boundary.mjs` e `dependency_invariant.rs`: `fub-disegno` è
  l'unico che può nominare `vectorcraft-*` (come `GRIDCRAFT_OWNERS`).
- `deny.toml`: le licenze dei crate nuovi, se `deny.toml` le ammette già
  (D-3 dice MIT o Apache-2.0); un'eccezione per un crate solo, con il
  perché. Una licenza che non è ammessa non si aggiunge: ci si ferma e
  l'orchestratore chiede (CLAUDE.md, «Reusing code»).
- `budgets.json`: il tetto di `librerie_doppie` si alza **una volta sola**
  (D-3 (a)), al conto misurato dopo questo task, con la nota che dice perché
  e rimanda al file di misura; T27 lo può soltanto abbassare. Nel file di
  misura di T5: il conto dopo, e per ogni libreria doppia nuova chi la porta
  (`cargo tree -e normal --all-features --target all -d -p fub-app -i
  <crate>`) e il perché.
- La licenza IJG di `jpeg-encoder` (scelta dell'utente del 2026-11-09, A): in `deny.toml` un'eccezione stretta, `exceptions = [{ crate = "jpeg-encoder", allow = ["IJG"] }]` col commento del perché, e non l'IJG nell'elenco generale; in `THIRD_PARTY_NOTICES.md` una sezione «Avvisi richiesti dalle dipendenze» con la frase che l'IJG chiede per chi distribuisce solo l'eseguibile: «this software is based in part on the work of the Independent JPEG Group», e quali file di `jpeg-encoder` ne derivano (`src/fdct.rs`, `src/avx2/fdct.rs`). `cargo deny check` torna verde.
Casi limite: una dipendenza che riaccende `bundled-fonts` o il PDF per
unione di feature (`cargo tree -e features -i vectorcraft-text` lo mostra:
si toglie); `cargo deny` rosso su un avviso di sicurezza (si ferma e si
scrive); il workspace che compila due `kurbo` in più del previsto (si
scrive nel file di misura).
Fatto quando: `cargo check -p fub-disegno` passa; `node
.github/scripts/check-engine-boundary.mjs` e `cargo test -p fub-abi --test
dependency_invariant` passano, e falliscono se un altro crate aggiunge
`vectorcraft-engine`; `cargo deny check` e `node
.github/scripts/check-motori.mjs` sono verdi; il file di misura ha una riga
per ogni libreria doppia nuova, con chi la porta e il perché.
Prova: scripts/check.sh --rapido; cargo check -p fub-disegno
Stato: [x] fatto (2026-11-09) · differenze: `librerie_doppie` da 45 a 60, misurato su `fub-app` più `fub-disegno` perché `fub-app` lo prende solo con T13/T19 (intanto `check-motori` dice «il tetto può scendere», ed è voluto: non abbassarlo); le `icu_*` tenute a 2.3 come il lock del vendor; `check-engine-boundary` legge anche i `Cargo.toml`; il grafo in `docs/architecture/disegno.md`; niente `[lints]` (la radice non ha `[workspace.lints]`); `rustfmt.toml` dell'upstream fra i file gestiti di vectorcraft, craft-docpath e craft-vectorcraft-format, patch 0001/0002 riformattate (decisione dell'orchestratore); `windows-registry` 0.6 da `vectorcraft-text` provato solo su Linux

## T10 · I gesti nel client

Perché: i campioni della penna di Fub devono arrivare al motore e il suo
esito tornare come un passo di annullamento, senza toccare la penna.
Tocca: `apps/client/src/editors/spatial/motore/gesti.ts` (nuovo),
`apps/client/src/editors/spatial/motore/gesti.test.ts` (nuovo),
`apps/client/src/editors/spatial/tools/editor.ts`,
`apps/client/src/editors/spatial/tools/editor/types.ts`,
`apps/client/src/editors/spatial/tools/editor/context.ts`,
`apps/client/src/editors/spatial/tools/editor/gesture-begin.ts`,
`apps/client/src/editors/spatial/tools/editor/curvature-tool.ts`,
`apps/client/src/editors/spatial/surface.ts`,
`docs/architecture/ink-and-tools.md`
Non toccare: `tools/editor/selection-gestures.ts` e gli strumenti TypeScript
(restano il ripiego fino a T23 e il profilo PDF); `editors/spatial/pdf/` (non
passa il motore); `ink/` e `crates/fub-ink`; i casi `ink`, `erase`, `note`
della pipeline; `tools/editor/styling.ts` (T12).
Dipende da: T3, T8
Cosa fare:
- `DrawEditorOptions` prende `motore?: SessioneMotore`; `surface.ts` (che è
  la superficie del profilo «vector», `VECTOR_PROFILE`) apre la sessione
  (T8) all'apertura del disegno, in tutti e due gli spazi di lavoro (A14), e
  la passa; con `MotoreAssente` non passa niente (si comporta come oggi). La
  superficie dei PDF (`editors/spatial/pdf/surface.ts`) non la passa mai.
- In `types.ts` un gesto `{ kind: "motore", tool, pending: DrawingPointer[],
  inFlight: boolean, … }`; in `gesture-begin.ts`, per `select`, `rect`,
  `ellipse`, `line`, `arrow`, con `ctx.motore` pronto, `begin` restituisce
  quel gesto invece di quello di oggi.
- In `curvature-tool.ts` i campioni del gesto `motore` vanno a `gesti.ts`:
  si accumulano; a ogni fotogramma (`requestAnimationFrame`), se nessuna
  richiesta è in volo, si manda `phase: "preview"` con gli eventi nuovi e se
  ne disegna l'esito con `showShape(elem, matrix)` e il riquadro di
  selezione di oggi; al rilascio `phase: "commit"`; all'annullo `cancel`.
- Al commit: ogni operazione di `ops` passa da `parseWireOp`; poi
  `followConnectors(model, toccati, …)` di `tools/connectors.ts` aggiunge i
  connettori che seguono; poi `ctx.commit(label, op)` con l'etichetta dello
  strumento di oggi; la selezione è quella dell'esito. `refused` →
  `announce(t("draw.rejected", …))` con il motivo (i testi definitivi in
  T21; qui le chiavi di oggi).
- Un test dice che penna, evidenziatore e gomma non chiamano mai l'IPC del
  disegno.
- `ink-and-tools.md`: un paragrafo «Gli strumenti sul motore».
Casi limite: il motore non ancora aperto al primo gesto (si aspetta fino a
2 s, poi `NotReady` e il gesto non fa niente); un `ops` che `parseWireOp`
rifiuta (niente commit, si annuncia, si scrive in console); il documento
cambiato da un'altra superficie durante il gesto (`stale`: la sessione
riprova, T8); un gesto lungo con 100 000 eventi (si spezza in più richieste:
il contratto prende gli eventi nuovi); doppio clic; un dito che diventa
pizzico a metà (si annulla, come oggi).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/motore/gesti.test.ts` passa con il `DrawingFake` che
rigioca i vettori di T3 (risponde le loro `expect.ops`): per ogni vettore il
testo dopo il gesto è uguale a `expect.text`; un gesto è un passo di
annullamento; la penna non chiama l'IPC; con il motore assente
`tools/editor.test.ts` è verde come prima.
Prova: scripts/check.sh --rapido; npm --prefix apps/client test -- src/editors/spatial/motore/gesti.test.ts src/editors/spatial/tools/editor.test.ts
Stato: [x] fatto
  Da rivedere: T28 lo cambia (il motore che dice perché manca e si riapre
  senza riaprire il file, D-8 (c)).

## T11 · Aprire, seguire il file, la differenza

Perché: il cuore del motore: una copia del disegno con la mappa degli id, che
segue il file, e la differenza fra prima e dopo un gesto scritta come
operazioni di scena.
Tocca: `crates/fub-disegno/src/apertura.rs` (di T9),
`crates/fub-disegno/src/mappa.rs` (di T9),
`crates/fub-disegno/src/sincronia.rs` (di T9),
`crates/fub-disegno/src/differenza.rs` (di T9),
`crates/fub-disegno/src/motore.rs` (di T9), `crates/fub-disegno/src/id.rs`
(di T9), `crates/fub-disegno/src/gesti/mod.rs` (di T9),
`crates/fub-disegno/src/perdite.rs` (di T9; qui solo lo scheletro),
`crates/fub-disegno/tests/common/mod.rs` (nuovo),
`crates/fub-disegno/tests/apertura.rs` (nuovo),
`crates/fub-disegno/tests/differenza.rs` (nuovo),
`docs/architecture/disegno.md` (di T1)
Non toccare: `src/gesti/forme.rs`, `selezione.rs`, `testo.rs`,
`src/comandi.rs` (T14–T18, qui restano `Unsupported`); `vendor/`;
`crates/fub-host`.
Dipende da: T4, T7, T9
Cosa fare:
- `apertura.rs`: `fub_scene::read(testo)`; se il documento non è
  modificabile (`!editable()`), la copia si apre ma ogni gesto è `Unsupported`.
  Una copia del testo in cui ogni elemento modificabile senza id riceve
  `id="fubtmp-<n>"` (mai scritta nel file); import nel motore con
  `vectorcraft-svg`; `mappa.rs` tiene oggetto del motore ↔ id di Fub o
  (percorso, tag) per gli id sintetici. Ciò che non torna nella mappa è una
  `DrawingLoss` (`perdite.rs` qui le raccoglie soltanto; T16 le classifica).
- `motore.rs`: `MotoreDisegno` (ciò che la prima apertura prepara, con la
  `FontDb` del motore costruita dai `Caratteri` di T7, senza `bundled-fonts`)
  dietro un `Pigro`; `Disegni::processo()` si iscrive in `Motori::processo()`
  con lo spazio `"disegno"` e l'estensione `svg`, come
  `crates/fub-format-xlsx/src/motore.rs`; un `Disegno` (un'istanza) tiene
  una presa; l'ultima che cade svuota le cache. API: `Disegno::apri(testo)
  -> Result<(Disegno, DrawingOpen), PluginError>`, `sincronizza(DrawingSync)
  -> DrawingSynced`, `gesto(DrawingGesture) -> DrawingOutcome`,
  `comandi(&[String])`, `comando(DrawingCommandRequest)`.
- `sincronia.rs`: applica gli `edits` al testo tenuto, controlla le
  lunghezze, avanza la revisione e reimporta in sottofondo
  (`Servizi::lavori().in_sottofondo`); un gesto a una revisione più nuova di
  quella importata aspetta il reimport; a una revisione diversa è `Stale`.
- `gesti/mod.rs`: dagli eventi alle chiamate dello strumento del motore
  (`PointerKind` Down/Drag/Up/Move, con pressione e modificatori), le azioni
  `Begin`/`Preview`/`Commit` eseguite sulla copia; `Preview` produce un
  `DrawingPreview`, `Commit` una differenza; `Cancel` riporta la copia a
  prima. Gli strumenti ancora non fatti rispondono `Unsupported`.
- `differenza.rs`: per ogni oggetto toccato confronta prima e dopo e scrive
  le operazioni più piccole sull'elemento di Fub: `set` degli attributi
  cambiati (`transform`, `fill`, `stroke`, `stroke-width`, la geometria del
  tag: `x`/`y`/`width`/`height`, `cx`/`cy`/`rx`/`ry`, `x1`…, `d`), `add`
  per i nuovi (l'`Elem` come lo scrive il client), `remove`, `move` per
  l'ordine; `ident` prima di tutto per gli elementi senza id. Se il cambio
  non si scrive come attributi dell'elemento originale, il gesto è
  `Unsupported` (niente riscritture intere). Oltre `MAX_DRAWING_OPS` o 8 MiB
  è `TooLarge`.
- `id.rs`: id nuovi nel formato di `scene/ids.ts` (A5), mai uguali a uno
  della scena.
- `tests/common/mod.rs`: legge i vettori di T3; `confronta_ops(attese,
  ottenute, ammesse)` canonicalizza gli id nuovi (`@n`), confronta i numeri
  con tolleranza 1e-3 e le `transform` come matrici (1e-6); legge un `.tsv`
  di differenze ammesse (`vettore<TAB>perché`).
Casi limite: un file di 20 MiB e 50 000 elementi (apre, e la misura va nel
test con `#[ignore]`); due elementi con lo stesso id (il documento è in sola
lettura: `fub_scene` lo dice); un elemento in `<defs>` o un `<use>` (non
mappato, resta com'è); un sync con lunghezze che non tornano (`BadArgs`,
poi il client manda il testo intero); un reimport che fallisce (la copia
resta alla revisione vecchia e i gesti sono `Stale` finché non arriva un
testo buono); un panico del motore (lo prende
`vectorcraft_engine::guard::catch_panic`, come fanno i suoi punti
d'ingresso: il gesto è `Unsupported`, la copia si ricarica dal testo,
l'istanza resta viva).
Fatto quando: `cargo test -p fub-disegno` passa con: apertura di ogni file
di `crates/fub-scene/tests/corpus/` e di `crates/fub-features/templates/`
senza errori, con `mapped + unmapped` uguale agli elementi; un elemento senza
id spostato a mano sulla copia dà `ident` + `set` sullo stesso id; un sync
con un `edit` porta la revisione a 1 e il reimport alla stessa; un gesto a
revisione vecchia dà `Stale`.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno
Stato: [ ] da fare

## T12 · Colori e spessore dal motore, nel client

Perché: nel disegno anche i colori sono comandi del motore; il client li
manda e applica l'esito come un passo di annullamento.
Tocca: `apps/client/src/editors/spatial/motore/colori.ts` (nuovo),
`apps/client/src/editors/spatial/motore/colori.test.ts` (nuovo),
`apps/client/src/editors/spatial/tools/editor/styling.ts`
Non toccare: i controlli della barra (stesso aspetto); `motore/gesti.ts`
(T10, se serve una funzione comune si importa, non si sposta);
`tools/properties.ts`.
Dipende da: T10
Cosa fare:
- In `styling.ts`, quando c'è la sessione del motore e la selezione non è
  vuota, colore del tratto, riempimento e spessore scelti si mandano con
  `drawingCommand` (`disegno.colore-tratto`, `disegno.colore-riempimento`,
  `disegno.spessore`, `value` il colore come lo scrive oggi la barra o il
  numero); l'esito passa da `parseWireOp` e `ctx.commit` con l'etichetta di
  oggi. Senza selezione cambia solo lo stile dei prossimi gesti, come oggi
  (va in `DrawingGesture.style`).
- `colori.ts` fa la richiesta e l'applicazione; `drawingCommands` dice quali
  sono attivi e la barra li disattiva se no.
Casi limite: un elemento della selezione non mappato (l'esito ha `refused`,
niente cambia, si annuncia); un colore non valido (non parte); il motore
assente (si fa come oggi); la selezione cambiata mentre la richiesta è in
volo (si applica l'esito: le operazioni portano gli id).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/motore/colori.test.ts` passa: con il finto acceso un
colore scelto manda la richiesta giusta e applica un `set` in un passo; con
il finto spento `styling.ts` scrive come prima.
Prova: scripts/check.sh --rapido; npm --prefix apps/client test -- src/editors/spatial/motore/colori.test.ts
Stato: [x] fatto

## T13 · Il componente «Motore del disegno»

Perché: il motore è un componente come gli altri: si vede nella pagina
Componenti, ha il suo interruttore (D-8 (c), D-14 (a)), e la build
senza di lui resta, con i disegni sugli strumenti semplici.
Tocca: `crates/fub-features/src/componenti.rs`, `crates/fub-features/Cargo.toml`,
`crates/fub-features/tests/componenti.rs`, `crates/fub-features/tests/catalogs.rs`,
`crates/fub-host/Cargo.toml`, `crates/fub-host/tests/componenti.rs`,
`Cargo.lock`, `scripts/check.sh` (una riga)
Non toccare: la riga della lavagna (resta com'è, N6: solo il commento si
aggiorna); `crates/fub-componenti` e la mappa di K1; il codice dell'host
(T19, T29); `crates/fub-host/src/componenti.rs` di K2 (la riga nuova si
spegne con `components.off` come Lavagna e PDF, senza codice nuovo: se non
è così, si scrive nel task e si chiede).
Dipende da: T9, T27 (tutti e due toccano `Cargo.lock`); K2 fuso; risposta
D-14
Cosa fare:
- In `fub-features/Cargo.toml` la feature `engine-drawing = ["draw"]`: il
  motore porta i disegni, i disegni non portano il motore. `draw` non lo
  include (con (b) di D-14, invece, `draw` lo include come `rich =
  ["engine-documents"]`).
- In `componenti.rs`, con D-14 (a): `#[cfg(feature = "engine-drawing")]
  Riga::motore("fub.motore-vettoriale",
  "component.motore-vettoriale.name").group("disegnare").requires(&["fub.draw"]).cargo_feature("engine-drawing").senza_bundle()`;
  `fub.draw` prende `.uses(&["fub.motore-vettoriale"])` (non `requires`:
  spento il motore, i disegni restano). Il nome («Motore del disegno»,
  «Drawing engine») e la descrizione (proposta: «Disegna, sposta e cambia le
  forme dei disegni. Spento, i disegni usano gli strumenti semplici.»; la
  frase si sceglie sul prototipo, T25) in `NOMI` e in `DESCRIZIONI` di
  `componenti.rs` (di K2), in italiano e in inglese. Il commento sopra la
  lavagna dice che la riga ora c'è e che la lavagna la userà (N6). Con D-14 (b): `.group("supporto")` e
  `fub.draw` con `.requires(&["fub.motore-vettoriale"])`, come A9 di prima.
- In `fub-host/Cargo.toml`: `engine-drawing = ["draw", "dep:fub-disegno",
  "fub-features/engine-drawing"]`, in `default` accanto a `draw`.
- I test: il nome nel catalogo italiano (`catalogs.rs`); in
  `fub-features/tests/componenti.rs` la riga non è di supporto e non è un
  bundle (`nessun_bundle_e_di_supporto` resta verde); in
  `fub-host/tests/componenti.rs` la riga c'è con `engine-drawing` e non
  c'è senza, è accesa di serie, si spegne con `components.off` lasciando
  accesi i disegni, e spenti i disegni fa ciò che il risolutore di K2 fa
  per ogni riga che ne richiede un'altra (come la Lavagna con
  `fub.penna`), scritto nel test; riaccesi i disegni, il motore torna com'era
  prima.
- In `scripts/check.sh` la riga `cargo test -p fub-host
  --no-default-features --features draw --test componenti` (i disegni senza
  il motore). Nel resoconto, per l'orchestratore: lo stesso passo in
  `.github/workflows/ci.yml`; il blocco `ci-required` di `CONTRIBUTING.md`
  resta com'è.
Casi limite: la build senza `draw` (nessuna delle due righe, nessun crate del
motore: `cargo tree -p fub-host --no-default-features` non mostra
`vectorcraft`); la build con `draw` e senza `engine-drawing` (i disegni ci
sono, il motore no: la riga non c'è, e T23 lo dice senza «Accendi…»); un
vault che ha `fub.motore-vettoriale` in `components.off` aperto da una build
senza il motore (l'id resta nel file, K2 lo dice in `mancanti`); il profilo
dei componenti scelto in K2 (`components.profile`) che non nomina la riga
(vale «acceso di serie»).
Fatto quando: `cargo test -p fub-features --test catalogs --test componenti`
e `cargo test -p fub-host --test componenti` passano, compresi i casi con e
senza `engine-drawing` e il motore spento con i disegni accesi; `cargo
check -p fub-host --no-default-features --features draw` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test componenti; cargo test -p fub-host --no-default-features --features draw --test componenti
Stato: [ ] da fare

## T14 · Le forme

Perché: rettangolo, ellisse, linea e freccia del disegno sono strumenti del
motore; devono dare ciò che danno oggi.
Tocca: `crates/fub-disegno/src/gesti/forme.rs` (di T9),
`crates/fub-disegno/tests/gesti_forme.rs` (nuovo),
`crates/fub-disegno/tests/gesti/forme.tsv` (nuovo)
Non toccare: `src/differenza.rs` e `src/gesti/mod.rs` (T11: se serve un
aggancio, una funzione nuova in `forme.rs`, e se proprio manca qualcosa lo
si scrive nel task); gli altri strumenti.
Dipende da: T11
Cosa fare:
- Lo strumento forma del motore (`crates/tools/src/shape.rs` di VectorCraft)
  per `Rect`, `Ellipse`, `Line`; `Arrow` è la linea con la punta come la
  scrive il client oggi (gli attributi del vettore `freccia` di T3).
- Lo stile del gesto (`DrawingGesture.style`) sul nuovo oggetto; il livello
  `layer` come genitore; Maiusc come oggi (quadrato, cerchio, 15°); sotto la
  misura minima nessuna forma (`Empty`).
- L'anteprima: l'`Elem` della forma provvisoria.
- Il test rigioca ogni vettore di T3 delle forme e lo confronta con
  `confronta_ops`; `forme.tsv` elenca le differenze ammesse col perché.
Casi limite: trascinare all'indietro (larghezza negativa: si normalizza come
oggi); un livello bloccato o nascosto (`Unsupported` come il rifiuto di
oggi); zoom 0,01 e 64; pressione 0.
Fatto quando: `cargo test -p fub-disegno --test gesti_forme` passa su tutti
i vettori di forme di T3, con `forme.tsv` che ha al più le righe motivate.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test gesti_forme
Stato: [ ] da fare

## T15 · Selezione, spostare, ridimensionare, ruotare

Perché: la Selezione del disegno è lo strumento del motore; deve scegliere
e trasformare come oggi, griglia compresa.
Tocca: `crates/fub-disegno/src/gesti/selezione.rs` (di T9),
`crates/fub-disegno/tests/gesti_selezione.rs` (nuovo),
`crates/fub-disegno/tests/gesti/selezione.tsv` (nuovo)
Non toccare: `src/differenza.rs`, `src/gesti/mod.rs`, `forme.rs`; i
connettori (li fa seguire il client, T10).
Dipende da: T11
Cosa fare:
- Lo strumento di selezione del motore (`crates/tools/src/select.rs`, `xform`)
  per clic, Maiusc-clic, riquadro, spostare, maniglie di ridimensione e di
  rotazione; gli elementi estranei si possono solo spostare (come
  `scene-operations.md`); i livelli bloccati non si scelgono.
- La griglia: la stessa regola di `snappedDelta` in
  `apps/client/src/editors/spatial/tools/editor/selection-gestures.ts`
  (letta, non inventata); se lo strumento del motore ha un aggancio suo, si
  usa con quei valori, se no si applica la regola agli eventi prima dello
  strumento; la doc del modulo dice quale.
- L'anteprima: la `matrix` della selezione e il `marquee`.
- Il test rigioca i vettori di selezione di T3.
Casi limite: clic su due oggetti sovrapposti (quello sopra); un oggetto
dentro un gruppo (il gruppo, come oggi); spostare di zero (niente
operazioni); ridimensionare sotto `MIN_SIZE`; ruotare un elemento con una
`transform` già girata e inclinata; selezione con un id che non esiste più
(si toglie).
Fatto quando: `cargo test -p fub-disegno --test gesti_selezione` passa su
tutti i vettori di selezione di T3, con `selezione.tsv` motivato.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test gesti_selezione
Stato: [ ] da fare

## T16 · Ciò che il motore non sa modificare, e il corpus

Perché: il passo chiede che ciò che il motore non sa conservare sia detto;
serve un elenco preciso, per file, che non cambi senza che qualcuno lo veda.
Tocca: `crates/fub-disegno/src/perdite.rs` (di T9),
`crates/fub-disegno/tests/corpus.rs` (nuovo), `crates/fub-disegno/tests/corpus/perdite.tsv` (nuovo)
Non toccare: `src/apertura.rs` e `src/mappa.rs` (T11); il corpus stesso
(`crates/fub-scene/tests/corpus/`, `crates/fub-features/templates/`).
Dipende da: T11
Cosa fare:
- `perdite.rs` classifica ciò che T11 raccoglie: `Unmapped` (il motore non
  ha un oggetto per l'elemento), `Approximated` (l'oggetto c'è ma un
  attributo non torna uguale all'export: filtri, maschere, `<use>`,
  `<foreignObject>`, testi su tracciato…), `Unsupported` (il documento non è
  modificabile). Il `detail` è una frase breve in italiano che l'interfaccia
  può mostrare (T21).
- Un gesto che cambierebbe un elemento `Unmapped` o `Approximated` in un modo
  che non è un `set` di `transform` è rifiutato con `Unmapped`.
- `corpus.rs`: per ogni file del corpus e dei modelli, apre e scrive
  `file<TAB>elemento<TAB>tipo<TAB>dettaglio`; con `UPDATE_PERDITE=1` riscrive
  `perdite.tsv`, senza lo confronta.
Casi limite: un file senza perdite (nessuna riga, ma il file è nominato
con `-`); un elemento senza id (si nomina col percorso); 50 000 perdite (il
limite del contratto); un dettaglio con un tab (si sostituisce).
Fatto quando: `cargo test -p fub-disegno --test corpus` passa; il `.tsv` ha
una riga per ogni file del corpus; un elemento `<filter>` aggiunto a un file
di prova compare come `Approximated`.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test corpus
Stato: [ ] da fare

## T17 · Il testo nel motore

Perché: il disegno ha di nuovo lo strumento Testo (D-7): un clic crea un
testo, e un testo si sposta e si ridimensiona come le forme.
Tocca: `crates/fub-disegno/src/gesti/testo.rs` (di T9),
`crates/fub-disegno/tests/gesti_testo.rs` (nuovo),
`crates/fub-disegno/tests/gesti/testo.json` (nuovo)
Non toccare: `crates/fub-disegno/src/gesti/forme.rs`, `selezione.rs`,
`differenza.rs`; i caratteri (T7); il client (T22).
Dipende da: T14, T15
Cosa fare:
- `Text` con un clic: l'oggetto testo del motore
  (`crates/tools/src/text.rs` di VectorCraft) con la riga di
  `DrawingGesture.text` e lo stile del gesto; nella differenza un `add` del
  `<text>` scritto come lo scrive oggi `textElem` di
  `apps/client/src/editors/spatial/tools/text.ts` (ancora sulla linea di
  base, `font-family` `TEXT_FAMILY`, `font-size` `TEXT_SIZE` se lo stile non
  ne dà un altro, una riga per `tspan`), selezionato.
- Senza `text`, o con una riga vuota, il gesto è `Empty` (un testo senza
  niente da leggere non si scrive, come in `tools/text.ts`).
- Il contenuto non si cambia nel motore: lo si cambia nell'ispettore come
  oggi (operazione `text` del client).
- Il vettore `testo.json` si scrive a mano, nella forma di T3 (non c'è uno
  strumento Testo da registrare): l'atteso è ciò che dà `textElem` letto, e
  il vettore lo dice nella `description`.
Casi limite: clic su un testo che c'è (lo seleziona, non ne crea un altro);
clic fuori dal foglio (si crea lì, come le forme); una riga con caratteri che
le facce di Fub non hanno (si scrive com'è: il disegno usa il ripiego); un
testo `xml:space="preserve"` già nel file (si sposta senza toccarne il
contenuto); una riga di 10 000 caratteri.
Fatto quando: `cargo test -p fub-disegno --test gesti_testo` passa: un clic
a (100, 80) con `text: "Testo"` dà un `<text>` con `x="100" y="80"` e una
`tspan` «Testo», l'id nuovo selezionato, e il testo del file dopo
l'applicazione è quello di `testo.json`; senza `text` dà `Empty`.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test gesti_testo
Stato: [ ] da fare

## T18 · I comandi del disegno

Perché: colore del tratto, del riempimento e spessore sono comandi del
motore; ognuno deve esistere e fare ciò che dice.
Tocca: `crates/fub-disegno/src/comandi.rs` (di T9),
`crates/fub-disegno/tests/comandi.rs` (nuovo)
Non toccare: i gesti; il catalogo di `fub-motori` (il catalogo completo è
K6).
Dipende da: T11
Cosa fare:
- `disegno.colore-tratto` → `paint.setStroke`, `disegno.colore-riempimento`
  → `paint.setFill`, `disegno.spessore` → `stroke.set` del motore (id letti
  in `crates/engine/src/cmd/` di VectorCraft, e i loro parametri da lì), con
  la selezione data; l'esito come differenza (T11).
- `comandi(selection)`: i tre, `enabled` se la selezione non è vuota e tutti
  i suoi elementi sono mappati.
- Un test che fallisce se uno dei tre id del motore non c'è più nel
  registro dei comandi del motore (così un aggiornamento di VectorCraft lo
  dice).
Casi limite: `value` non valido (`BadArgs`); colore `none`; spessore 0 e
negativo (0 ammesso, negativo no); selezione con un elemento non mappato
(`Unmapped`, niente cambia); un gruppo nella selezione (si colora come oggi:
si legge come fa `styling.ts`).
Fatto quando: `cargo test -p fub-disegno --test comandi` passa: su un
rettangolo `disegno.colore-tratto` con `#ff0000` dà un solo `set` di
`stroke`; un id cambiato a mano nel test fa fallire il controllo del
registro.
Prova: scripts/check.sh --rapido; cargo test -p fub-disegno --test comandi
Stato: [ ] da fare

## T19 · L'host e i comandi IPC

Perché: il client deve raggiungere il motore con i sei comandi approvati
(D-4 (a)); senza la feature o con il motore che non si costruisce, deve
sentirsi dire che non c'è, e ricadere sugli strumenti semplici (D-8 (c)).
Tocca: `crates/fub-host/src/drawing.rs` (nuovo), `crates/fub-host/src/lib.rs`,
`crates/fub-host/src/session.rs` (solo il campo in `Host`, la sua
costruzione, e la chiusura del vault che chiude i suoi disegni),
`crates/fub-host/tests/drawing.rs` (nuovo), `crates/fub-app/src/lib.rs`,
`crates/fub-app/permissions/default.toml`, `crates/fub-app/tests/lean_ipc.rs`,
`apps/client/src/host/ipc.ts`, `crates/fub-features/src/draw.rs` (solo una
funzione pubblica per le facce), `docs/reference/ipc-contract.md`,
`docs/architecture/editor-surfaces.md`, `docs/architecture/disegno.md`,
`CONTRIBUTING.md` (solo se il controllo qui sotto trova una riga da
cambiare)
Non toccare: `crates/fub-disegno` (si usa la sua API); i comandi Grid; la
logica dell'export in `draw.rs`; `crates/fub-app/tests/ipc_permissions.rs`
(deve passare così com'è: è il test di conformità che vuole ogni comando
chiamato registrato e permesso); `permissions/mobile.toml` (il disegno sul
telefono non chiama il motore); `apps/client/src/host/fake.ts`; lo stato dei
componenti (T29).
Dipende da: T11, T13 (D-4 (a): sì)
Cosa fare:
- `draw.rs`: `pub fn facce() -> &'static [&'static [u8]]` (le `FACES`) e i
  nomi delle famiglie generiche (`SERIF`, `SANS`, `MONO`).
- `drawing.rs` (`impl Host`, come `workbook.rs`): alla prima apertura
  `Servizi::processo().fornisci_caratteri(...)` con quelle facce; le istanze
  per vault in una mappa sotto un lucchetto, che si prende per trovare
  l'istanza e si lascia prima di chiamarla; `drawing_open`, `drawing_sync`,
  `drawing_gesture`, `drawing_commands`, `drawing_command`, `drawing_close`;
  ogni richiesta passa da `validate()` (T4). Senza la feature
  `engine-drawing` le funzioni ci sono e rispondono `PluginError::Unserved`
  (come il tipo vuoto di `rich.rs`).
- `fub-app/src/lib.rs`: i sei `#[tauri::command]` (`open_drawing(host, doc,
  text, vault)` ecc.) registrati accanto a quelli Grid; le sei righe in
  `permissions/default.toml` (`allow-shell`).
- `host/ipc.ts`: via `drawingNotInApp` e il suo commento; le sei porte
  tornano a `invoke("open_drawing", …)` ecc., con il vault in coda come le
  altre (`toVault(…, vault)`).
- `lean_ipc.rs`: le sei righe con un `Why::Drawing` nuovo che spiega perché
  una porta tipata (come `Why::Grid`), e un test come quello dei comandi
  Grid: ognuno dei sei è un `fn` in `lib.rs`, il client lo chiama per nome,
  e nessuna riga di `ipc.ts` passa il disegno da `invoke_command`.
- `ipc-contract.md`, sezione «Disegno»: tolti «(arrivano con T19; i nomi
  sono da confermare, D-4)» e ogni «(arriva con T19)»; il paragrafo «Finché
  l'app non registra i sei comandi (T19)…» diventa la frase su che cosa vuol
  dire `unserved` (il motore non c'è in questa build, o non si è costruito).
  `editor-surfaces.md`: il disegno ha una sessione del motore.
  `disegno.md`: tolti i «(arriva con T19)» di ciò che ora c'è.
- `CONTRIBUTING.md`: si rilegge la riga sui file del client che un crate
  nomina nei suoi test (`check-scope.mjs`, commit `b4409f52`): resta vera, e
  si cambia solo se dice ancora qualcosa delle porte che non chiamano l'app.
Casi limite: un'istanza di un vault chiuso (`UnknownView` o l'errore che i
fogli danno per un'istanza sconosciuta: lo stesso); due finestre sullo
stesso file (due istanze); il motore che fallisce a costruirsi
(`PluginError::Internal` con il motivo nel log, non `Unserved`: il client
lo dice «Motore fermo» e offre «Riprova», T23, T28; un nuovo tentativo
ricostruisce, il `Pigro` di K3 non ricorda il fallimento); la chiusura del
vault con un gesto in corso (l'istanza si chiude dopo il gesto); 1000
istanze aperte (il budget di K3 svuota le cache, le istanze restano); un
`invoke` che arriva prima che l'host abbia montato il vault (lo stesso
errore dei comandi Grid).
Fatto quando: `cargo test -p fub-host --test drawing` passa con: apri un
disegno di prova, sync di un `edit`, un gesto rettangolo che dà le
operazioni del vettore di T3, chiudi; senza `engine-drawing` (`cargo test -p
fub-host --no-default-features --features draw --test drawing`) l'apertura
dà `Unserved`; un motore che non si costruisce (un `Pigro` di prova che
fallisce) dà `Internal`; `cargo test -p fub-app --test lean_ipc --test
ipc_permissions` passa; `grep -n drawingNotInApp apps/client/src/host/ipc.ts`
non trova niente; `node .github/scripts/check-doc-links.mjs` esce con 0.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test drawing; cargo test -p fub-app --test lean_ipc --test ipc_permissions
Stato: [ ] da fare

## T20 · Il cancello

Perché: K5 è fatto quando il corpus si apre, si modifica e si salva senza
perdite visibili e la penna non è cambiata: lo deve dire una prova ripetibile.
Tocca: `tools/disegno-cancello/cancello.mjs` (nuovo), `tools/disegno-cancello/README.md`
(nuovo), `crates/fub-disegno/tests/cancello.rs` (nuovo),
`apps/client/src/editors/spatial/motore/cancello.test.ts` (nuovo),
`docs/misure/disegno-2026-11-linux-ryzen.md` (nuovo, la data del giorno
della misura), `docs/architecture/disegno.md` (di T1)
Non toccare: il codice del motore e del client (se il cancello trova un
errore, si apre un task nuovo, non si corregge qui); le soglie del banco di
fedeltà.
Dipende da: T14, T15, T16, T17, T18, T19
Cosa fare:
- `cancello.rs`, `#[ignore]`, con `FUB_DISEGNO_CANCELLO=<cartella>`: per
  ogni file del corpus (`crates/fub-scene/tests/corpus/`,
  `crates/fub-features/templates/`, `apps/client/src/__fixtures__/scene/`)
  apre, fa tre gesti sul motore (sposta di (+7, +5) il primo elemento mappato
  e lo riporta; un rettangolo nuovo; il colore del tratto del primo elemento)
  e scrive le operazioni di ognuno in `<cartella>/<file>.<gesto>.json`.
- `cancello.test.ts` (salta se la variabile non c'è): applica quelle
  operazioni con il motore della scena del client e scrive i testi dopo.
- Un secondo test `#[ignore]` in `cancello.rs` disegna prima e dopo con
  l'oracolo di T2 (facce da `crates/fub-features/fonts/`) e confronta:
  andata e ritorno ⇒ 0 pixel diversi oltre la soglia; rettangolo e colore ⇒
  al più lo 0,2% fuori dalla zona toccata; e i codici `S…` della diagnosi di
  `fub_scene` dopo non sono più di prima.
- `cancello.mjs` fa i tre passi in fila e stampa una tabella per file; esce
  con 1 se un file fallisce.
- `bench:ink` prima (main) e dopo (questo branch), stessa macchina; le
  latenze di anteprima, commit e reimport (A8) misurate su `concept-map` e
  su un disegno di 1 MiB; tutto nel file di misura, con la macchina e il
  carico.
Casi limite: un file del corpus che non ha elementi mappati (si salta lo
spostamento, e si scrive); un file in sola lettura (si salta, e si scrive);
la macchina carica (la misura dice il carico e si ripete; un numero
rumoroso non si scrive come fatto).
Fatto quando: `node tools/disegno-cancello/cancello.mjs` esce con 0; il file
di misura ha `bench:ink` prima e dopo dentro il rumore e le tre latenze con i
tetti di A8 rispettati o, se no, il numero vero e un task nuovo nel piano.
Prova: scripts/check.sh --rapido; node tools/disegno-cancello/cancello.mjs
Stato: [ ] da fare

## T21 · Che cosa resta com'è, detto

Perché: chi apre un disegno deve sapere, prima di toccarlo, che cosa il
motore non modifica, e perché un gesto non va.
Tocca: `apps/client/src/editors/spatial/motore/standing.ts` (nuovo),
`apps/client/src/editors/spatial/motore/standing.test.ts` (nuovo),
`apps/client/src/editors/spatial/surface.ts`,
`apps/client/src/editors/spatial/strings.ts`,
`apps/client/src/editors/spatial/motore/gesti.ts` (di T10 e T28)
Non toccare: `editors/core/registry.ts` (il `SurfaceStanding` si usa com'è);
`editors/rich/standing.ts` (si legge come esempio); l'avviso della sola
lettura di oggi (`vector.read_only.*` in `surface.ts`); il chip del motore
spento o fermo (T23).
Dipende da: T20, T25 (il sì dell'utente al prototipo), T28; D-9 (a)
Cosa fare:
- `standing.ts`: dalle `losses` di `DrawingOpen` (e da quelle degli esiti) un
  `SurfaceStanding` come `editors/rich/standing.ts`, con `kind: "closed"`
  (quello dei documenti con parti chiuse; i tipi in
  `editors/core/registry.ts`, `SurfaceStandingKind`): testo «N parti restano
  come sono», `placesAsk` «Che cosa manca?», un posto per perdita con il
  `detail` e «Vai» (seleziona l'elemento e lo porta in vista); nessun chip
  senza perdite. Lo stato del motore lo legge da `MotoreDelDisegno` (T28) e
  si aggiorna quando cambia: con il motore spento o fermo le perdite non si
  conoscono, e il chip è quello di T23 (qui `current()` dà `null` in quel
  caso, e T23 lo riempie).
- `surface.ts`: la superficie del disegno oggi non ha `standing`; la prende
  (il campo `standing?: SurfaceStanding` della superficie, in
  `registry.ts`), solo nel profilo «vector».
- In `gesti.ts` i motivi del rifiuto con i testi nuovi (`Unmapped`: «Questa
  parte resta com'è: il disegno non la sa ancora modificare»; `NotReady`:
  «Il disegno si sta ancora aprendo»; gli altri con le chiavi di oggi).
- Le chiavi in `strings.ts`, IT ed EN, con le parole approvate nel
  prototipo (D-9 (a)).
- Al banco (skill `banco`): foto chiaro e scuro, piena e 700 px, del chip e
  del riquadro su `illustrator.svg` del corpus, confrontate con il
  prototipo.
Dal prototipo: il chip delle parti che restano come sono e il riquadro «Che
cosa manca?» (lo stato «motore acceso, con perdite»).
Casi limite: 500 perdite (il riquadro scorre; il testo dice il numero
intero); un nome di elemento lunghissimo (si taglia); una perdita su un
elemento poi cancellato (il posto sparisce); un disegno in sola lettura (il
motore non apre gesti: il chip non si mostra, resta l'avviso di oggi); il
profilo PDF (nessun chip); il motore che si ferma con il riquadro aperto (il
riquadro si chiude e il chip diventa quello di T23).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/motore/standing.test.ts` passa; le foto del banco
mostrano il chip e il riquadro in chiaro e scuro, come nel prototipo;
`strings.test.ts` è verde.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/standing.test.ts src/editors/spatial/strings.test.ts
Stato: [ ] da fare

## T22 · Lo strumento Testo

Perché: il passo mette il testo fra gli strumenti del disegno; oggi un testo
libero non si crea (D-7 (a)). Con D-8 (c) c'è anche senza motore (A17).
Tocca: `apps/client/src/editors/spatial/tools/registry.ts`,
`apps/client/src/editors/spatial/strings.ts`,
`apps/client/src/editors/spatial/icons.ts`,
`apps/client/src/editors/spatial/tools/text.ts`,
`apps/client/src/editors/spatial/motore/gesti.ts` (di T10),
`apps/client/src/editors/spatial/motore/gesti.test.ts` (di T10),
`apps/client/src/editors/spatial/tools/editor/gesture-begin.ts`,
`apps/client/src/editors/spatial/tools/editor/chrome/rail.ts`,
`apps/client/src/editors/spatial/tools/gesti-vettori.test.ts` (di T3),
`apps/client/src/__fixtures__/disegno-gesti/testo-clic.json` (nuovo),
`crates/fub-disegno/tests/gesti_testo.rs` (di T17),
`crates/fub-disegno/tests/gesti/testo.tsv` (nuovo, se serve),
`docs/decisions/0239-il-disegno-sul-motore-vettoriale.md` (solo se il
tasto cambia)
Non toccare: il profilo PDF (non prende lo strumento); `tools/properties.ts`
(si mette a fuoco il campo che c'è); `tools/labels.ts` (l'etichetta dentro
una forma resta com'è); i comandi e i campi dello spazio Completo;
`crates/fub-disegno/src/` (se il motore non dà ciò che dà la strada
semplice, si scrive la differenza nel `.tsv` o si apre un task nuovo).
Dipende da: T17, T21, T25 (il sì dell'utente al prototipo); D-7 (a)
Cosa fare:
- In `TOOLS` (`tools/registry.ts`) lo strumento `{ id: "text", spaces: {
  vector: "simple" }, group: "text", icon: "draw-text", label:
  "draw.tool.text", description: "draw.tool.text.hint", shortcut: "t" }`,
  dopo la Freccia; `"text"` in `ToolId` e in `Feature`. Il tasto `t` è
  libero oggi (tasti usati: v, h, z, p, Shift-p, e, n, r, o, l, Shift-l, c;
  si ricontrolla `tools/editor/keys.ts` e `__fixtures__/command-keys.json`).
- In `chrome/rail.ts` la casella `["text"]` nel gruppo delle forme del
  layout `VECTOR` (non in `PDF`).
- L'icona `draw-text` in `icons.ts`, disegnata come le altre e come nel
  prototipo; `draw.tool.text`, `draw.tool.text.hint` e la parola del testo
  nuovo («Testo», «Text») in IT ed EN in `strings.ts`.
- In `gesture-begin.ts` il caso `text`: con il motore pronto, gesto del
  motore (T10) con `DrawingGesture.text` = la parola del testo nuovo; senza
  motore, la **strada semplice** (A17): un clic aggiunge con `ctx.commit` un
  `<text>` fatto da `textElem` di `tools/text.ts` (sulla linea di base,
  `TEXT_FAMILY`, `TEXT_SIZE` se lo stile non ne dà un altro), con un id nuovo
  e lo stile del gesto, nel livello attivo. Se `textElem` non esporta ciò
  che serve, una funzione nuova in `tools/text.ts` lo fa.
- Dopo il commit, per tutte e due le strade: il testo nuovo selezionato e il
  campo del testo dell'ispettore a fuoco (il `case "text"` di
  `tools/properties.ts`, la `textarea` con `draw-properties-field`);
  l'ispettore chiuso si apre.
- In `gesti-vettori.test.ts` lo strumento `text` nel registratore, e il
  vettore `testo-clic` (clic a (100, 80), la parola «Testo») registrato
  dalla strada semplice con `UPDATE_GESTI=1`. Lo stesso vettore lo rigioca
  `gesti_testo.rs` sul motore, accanto a `testo.json` di T17: il motore deve
  dare lo stesso testo del file, e ogni differenza ammessa va in
  `gesti/testo.tsv` con il perché.
- Foto del banco (skill `banco`) della colonna con lo strumento, chiaro e
  scuro, con il motore acceso e spento, confrontate con il prototipo.
Dal prototipo: lo strumento Testo nella colonna, la sua icona e il
suggerimento.
Casi limite: il tasto `t` preso nel frattempo (si sceglie un altro tasto e
si scrive nell'ADR 0239); il profilo PDF (niente strumento); chi ha scelto la
sua colonna in «Personalizza la barra…» (`chosenLayout`: Testo non compare
finché non lo aggiunge, come ogni strumento nuovo); il testo svuotato
nell'ispettore (sparisce, come oggi un testo senza niente da leggere); il
clic su una forma che c'è già (si crea il testo sopra, non l'etichetta:
quella resta di `labels.ts`); un livello bloccato (rifiutato come le forme,
sulle due strade); il motore che si spegne fra il clic e l'esito (l'esito
si scarta e il clic non crea niente: non si crea due volte).
Fatto quando: un test in `motore/gesti.test.ts` (sul finto) dice che un clic
con Testo dà un `<text>` con la parola del testo nuovo, selezionato, e il
campo dell'ispettore a fuoco; lo stesso con il motore assente (strada
semplice) in `gesti-vettori.test.ts`; `cargo test -p fub-disegno --test
gesti_testo` passa anche sul vettore `testo-clic`; `icons.test.ts` e
`strings.test.ts` verdi; le foto del banco mostrano lo strumento nella
colonna, come nel prototipo.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/gesti.test.ts src/editors/spatial/tools/gesti-vettori.test.ts src/editors/spatial/icons.test.ts src/editors/spatial/strings.test.ts; cargo test -p fub-disegno --test gesti_testo
Stato: [ ] da fare

## T23 · Senza motore, detto

Perché: con il motore spento o fermo si disegna lo stesso, con gli strumenti
semplici, e il disegno lo dice chiaramente invece di farlo in silenzio (D-8
(c)); le due strade si provano tutte e due (A16).
Tocca: `apps/client/src/editors/spatial/surface.ts`,
`apps/client/src/editors/spatial/motore/standing.ts` (di T21),
`apps/client/src/editors/spatial/motore/standing.test.ts` (di T21),
`apps/client/src/editors/spatial/strings.ts`,
`apps/client/bench/scene.mjs`, `apps/client/bench/fake-ipc.ts`,
`apps/client/src/editors/spatial/motore/due-strade.test.ts` (nuovo)
Non toccare: gli strumenti TypeScript (sono la strada semplice: non
cambiano); `tools/editor/gesture-begin.ts` (la strada semplice c'è già, T10
la sceglie quando il motore non c'è); `tools/fubdraw-inventory.mjs` (i
moduli TypeScript restano raggiunti, quindi l'inventario della 0231 §5 non
cambia); penna, evidenziatore, gomma; `ui/commands.ts`, `panels/settings.ts`
e `panels/components-page.ts` (si usano come li lascia T24); `motore/gesti.ts`
e `motore/sessione.ts` (si usano come li lascia T28); l'ADR (la scrive T26).
Dipende da: T22, T24, T28, T25 (il sì dell'utente al prototipo); D-8 (c)
Cosa fare:
- In `standing.ts`, con lo stato del motore di `MotoreDelDisegno` (T28),
  nel profilo «vector» (tutti e due gli spazi, A14), le proposte di testo
  (le parole vere sono quelle approvate sul prototipo):
  - **spento**: chip «Motore spento: strumenti semplici», titolo «Motore del
    disegno spento», spiegazione «Disegni con gli strumenti semplici: fanno
    le stesse cose, senza il motore del disegno.», e l'azione «Accendi…»,
    che chiama `showComponent("fub.motore-vettoriale")` di T24; se la porta
    non c'è o la riga non è nella mappa dei componenti (la build senza il
    motore, T13), l'azione non si mostra e la spiegazione lo dice;
  - **fermo** (un errore): chip «Motore fermo: strumenti semplici», titolo
    «Il motore del disegno si è fermato», e l'azione «Riprova», che chiama
    `riapri()` di T28;
  - **acceso**: il chip di T21 (le perdite), o nessun chip.
  Il `kind` è quello scelto sul prototipo (proposta: `"body"`, quello di un
  documento che si scrive solo in parte).
- Tutti gli strumenti restano accesi, nello stesso ordine; nessun
  suggerimento «Serve il Motore del disegno» (D-9: non serve più).
- `due-strade.test.ts`: per ogni vettore di T3 (Testo compreso), il gesto con
  il motore spento (strumenti semplici) e con il motore acceso (il
  `DrawingFake` che risponde le `expect.ops` del vettore) dà lo stesso testo
  del file, un passo di annullamento e la stessa selezione; e un gesto
  cominciato con il motore acceso, con il motore che si spegne a metà, si
  annulla senza scrivere niente.
- Le chiavi in `strings.ts`, IT ed EN, con il tono del catalogo (si legge
  `apps/client/src/i18n/gergo.ts`: «Motore del disegno», mai VectorCraft).
- Il banco: in `bench/fake-ipc.ts` il finto del disegno con tre stati da
  una domanda dell'indirizzo, `drawing=acceso|spento|errore` (acceso:
  apertura con due perdite del corpus e gesti che rispondono i vettori di
  T3; spento: `unserved`; errore: `internal`); in `bench/scene.mjs` le scene
  `draw-engine-on`, `draw-engine-off`, `draw-engine-error`, accanto a
  `draw-open`; foto chiaro e scuro, piena e 700 px, con il chip e il suo
  riquadro aperti; `npm --prefix apps/client run bench:a11y` verde su quelle
  scene.
Dal prototipo: i chip del motore spento e fermo, il loro riquadro, le
azioni «Accendi…» e «Riprova».
Casi limite: il motore che si spegne a metà sessione (il chip cambia senza
riaprire il file; il gesto in corso si annulla); il motore che torna acceso
(il chip sparisce o diventa quello delle perdite, e il gesto dopo va al
motore); «Riprova» che fallisce di nuovo (il chip resta «fermo», senza un
giro di tentativi da sé); «Accendi…» con le Impostazioni già aperte su
un'altra scheda (T24); il profilo PDF (niente cambia); un disegno in sola
lettura (resta l'avviso di oggi, nessun chip del motore); la build senza il
motore (chip senza «Accendi…»).
Fatto quando: `motore/standing.test.ts` dice, sul finto spento, fermo e
acceso, il chip e l'azione giusti, che «Accendi…» chiama la porta con
`fub.motore-vettoriale` e che «Riprova» chiama `riapri()`;
`due-strade.test.ts` passa su tutti i vettori di T3; `tools/editor.test.ts`
resta verde; le foto delle tre scene, in chiaro e scuro, piena e 700 px,
sono come il prototipo; `bench:a11y` verde.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/standing.test.ts src/editors/spatial/motore/due-strade.test.ts src/editors/spatial/tools/editor.test.ts; npm --prefix apps/client run bench:a11y
Stato: [ ] da fare

## T24 · La riga di un componente da aprire

Perché: «Accendi…» del disegno deve portare l'utente sull'interruttore del
motore nella pagina Componenti (D-8 (c), D-14 (a)), e oggi da una superficie
non si apre una riga: la scheda si sceglie solo con un clic (`selectTab` è
privata in `panels/settings.ts`), e la pagina di K2 non porta in vista una
riga.
Tocca: `apps/client/src/panels/components-page.ts` (di K2),
`apps/client/src/panels/components-page.test.ts` (di K2),
`apps/client/src/ui/commands.ts`, `apps/client/src/ui/commands.test.ts`,
`apps/client/src/panels/settings.ts`,
`apps/client/src/panels/settings.components.test.ts` (di K2)
Non toccare: `editors/` (la usa T23); le righe dei componenti e ciò che
fanno (si apre quella che c'è, non si accende niente da sé: accende
l'utente con l'interruttore); `kit/tool-rail.ts` (con D-8 (c) uno strumento
spento non serve); `kit/index.ts`.
Dipende da: K2 fuso; T25 (il sì dell'utente al prototipo); risposta D-14 (con
(b) il task non si fa)
Cosa fare:
- `components-page.ts`: `ComponentsPage.focusRow(id: string):
  Promise<boolean>`: aspetta la mappa come `show()`, toglie la ricerca che
  la nasconderebbe, apre il gruppo della riga, la porta in vista, mette il
  fuoco sul suo interruttore (`data-focus-key="switch:<id>"`) e la segna
  come nel prototipo finché l'utente non fa altro; falso se la riga non c'è.
- `ui/commands.ts`: una porta come `registerDrawingImport`:
  `registerComponentRow(open: (id: string) => void)` e `showComponent(id):
  boolean` (falso se nessuno l'ha registrata).
- `panels/settings.ts`: in `mountSettings` la registra (e la toglie alla
  chiusura): apre il pannello, sceglie la scheda `"components"` come fa il
  clic (`selectTab`), poi `componentsPage.focusRow(id)`; un `id` sconosciuto
  apre la scheda e basta.
Dal prototipo: la riga del motore messa in vista e segnata nella pagina
Componenti.
Casi limite: il pannello già aperto su un'altra scheda (cambia scheda,
l'anteprima del tema si annulla come in `selectTab`); la mappa dei
componenti non ancora arrivata (si aspetta, come `show()`); la ricerca della
pagina con un testo che nasconde la riga (si toglie); due registrazioni
(vince l'ultima, come `registerDrawingImport`); il pannello chiuso prima che
la riga arrivi (non si apre di nuovo); la riga già accesa (si apre lo
stesso: l'utente vede che è accesa).
Fatto quando: `components-page.test.ts` dice che `focusRow` apre il gruppo
chiuso, porta il fuoco sull'interruttore della riga e dà falso per un id che
non c'è; `settings.components.test.ts` dice che
`showComponent("fub.search")` (una riga che i suoi finti hanno già) apre la
scheda Componenti con quella riga a fuoco; `commands.test.ts` dice che senza
registrazione `showComponent` dà `false`; la foto del banco della riga
segnata è come il prototipo.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/panels/components-page.test.ts src/ui/commands.test.ts src/panels/settings.components.test.ts
Stato: [ ] da fare

## T25 · Il prototipo del disegno, con il motore e senza

Perché: D-8 (c), D-14 e A17 cambiano ciò che si vede (il chip del motore
spento e fermo, «Accendi…» e «Riprova», la riga del motore nella pagina
Componenti, Testo anche senza motore), e le parole vanno guardate (D-9 (a)):
i task grafici partono da un prototipo che l'utente ha approvato.
Tocca: `PLAN-ui/disegno-motore.html` (nuovo), `PLAN.md` (solo la riga
`Prototipo:` e, se un pezzo cambia file, la tabella «Dal prototipo»)
Non toccare: il codice di prodotto (`apps/`, `crates/`); i prototipi degli
altri piani.
Dipende da: nessuno
Cosa fare (con `.claude/skills/pianifica/prototipo.md`, da leggere tutto):
- Una pagina sola, con la barra in alto che cambia stato, luce (chiaro,
  scuro) e larghezza (piena, 700 px). Gli stati:
  1. motore acceso, nessuna perdita (nessun chip);
  2. motore acceso con 3 perdite, e con 500, con «Che cosa manca?» aperto
     e un nome di elemento lunghissimo;
  3. motore spento: chip «Motore spento: strumenti semplici», il riquadro
     con «Accendi…»;
  4. motore fermo: chip «Motore fermo: strumenti semplici», il riquadro con
     «Riprova»;
  5. la build senza il motore: il chip senza azione;
  6. un gesto rifiutato («Questa parte resta com'è: il disegno non la sa
     ancora modificare») e «Il disegno si sta ancora aprendo»;
  7. la colonna degli strumenti con Testo, attivo, uguale con e senza
     motore (A17), e il suo suggerimento;
  8. la pagina Componenti (di K2) con la riga «Motore del disegno» nel
     gruppo «Disegnare», accesa, spenta, e segnata come dopo «Accendi…»
     (T24); la sua descrizione;
  9. il fuoco sul controllo principale di ogni stato.
- Fatta con i pezzi di Fub: i token di `skin/foundation.css`; il chip e il
  riquadro di `skin/sheets.css` con le classi di `anatomia/sheets.ts`
  (`pane-standing*`); la colonna di `skin/draw.css` con `anatomia/draw.ts`;
  la pagina Componenti da `skin/settings.css` e `anatomia/settings.ts` di K2
  (`git show origin/piano/k2-pagina-componenti:<percorso>`). Ogni testo con
  il suo `data-i18n` (le chiavi che T13, T21, T22 e T23 aggiungeranno). Il
  CSS passa da `sanitizeThemeCss` in una prova Vitest usa e getta, fuori dal
  repo, e ogni regola scartata si corregge.
- Le foto della pagina (ogni stato, chiaro e scuro, piena e 700 px) con
  Playwright in `/home/fubeo/.cache/fub-k1/tmp/k5/prototipo-foto/`, fuori dal
  repo.
- **L'orchestratore la mostra all'utente prima di andare avanti**, come
  Artifact o con le foto, insieme a D-14 e ad A17, e scrive la data del sì
  nella riga `Prototipo:`. Ogni commento dell'utente si corregge nella
  pagina e si rimostra; T21, T22, T23 e T24 aspettano il sì.
Casi limite: 500 perdite (il riquadro scorre); un nome di elemento di 300
caratteri (si taglia); la larghezza di 700 px con il chip e il percorso del
file lunghissimo; le due luci con il chip «fermo» (il colore dice «errore»
senza essere l'unico segno: c'è la parola).
Fatto quando: `PLAN-ui/disegno-motore.html` mostra i nove stati nelle due
luci e nelle due larghezze; la prova con `sanitizeThemeCss` non scarta
nessuna regola; le foto ci sono. Il task si chiude `[x] fatto, aspetta il
sì dell'utente`; il sì lo scrive l'orchestratore nella riga `Prototipo:`.
Prova: scripts/check.sh --rapido (la pagina non tocca il prodotto); la prova usa e getta di `sanitizeThemeCss`
Stato: [x] fatto · d91ca987 · approvato dall'utente il 2026-11-05

## T26 · Le risposte dell'utente nell'ADR e nella pagina del disegno

Perché: l'ADR 0239 ha ancora «Da decidere» e il punto 9 di D-8 (a), e la
pagina del disegno descrive gli strumenti spenti senza motore: chi lavora
dopo deve leggere le scelte vere (D-1…D-14).
Tocca: `docs/decisions/0239-il-disegno-sul-motore-vettoriale.md`,
`docs/decisions/README.md` (solo lo stato della 0239),
`docs/architecture/disegno.md`
Non toccare: le ADR 0231 e 0234 (si citano); il codice; `PLAN.md`.
Dipende da: la risposta a D-14
Cosa fare:
- L'ADR: `Stato: accolta`; il punto 6 dice la riga del motore come D-14
  l'ha decisa (con (a): una riga sua nel gruppo «Disegnare», accesa di
  serie, che `fub.draw` usa senza richiederla); il punto 9 diventa «Due
  strade»: con il motore spento o fermo il disegno usa gli strumenti
  semplici (quelli TypeScript del client) e il chip lo dice, i vettori dei
  gesti sono l'oracolo di tutte e due, e l'inventario della 0231 §5 non
  cambia; «Da decidere» diventa «Le scelte dell'utente (2026-11-02)», una
  riga per domanda con la risposta. Fra le conseguenze negative: due strade
  da mantenere e da provare, e `usvg` in due versioni (A15). Fra le
  alternative scartate: gli strumenti del motore spenti senza motore (D-8
  (a)) e il ripiego in silenzio (D-8 (b)).
- `docs/decisions/README.md`: la 0239 «accolta».
- `disegno.md`, «Il motore come componente»: la riga e lo stato spento come
  D-14 li ha decisi (la riga arriva con T13); senza motore, gli strumenti
  semplici e il chip con «Accendi…» o «Riprova» (arriva con T23, T28 e
  T29); via «Serve il Motore del disegno». La pagina dice il presente e
  segna con «(arriva con T…)» ciò che non c'è ancora; niente «oggi».
Casi limite: il numero dell'ADR preso da un altro piano fuso prima (si
rinumera alla fusione, A12, e con lui i link); D-14 (b) (il punto 6 resta un
motore di supporto, e il punto 9 dice soltanto «Motore fermo» con
«Riprova»).
Fatto quando: `node .github/scripts/check-doc-links.mjs` e
`node .github/scripts/check-doc-orphans.mjs` escono con 0; `grep -rn
"Serve il Motore del disegno" docs/` non trova niente; l'ADR dice «accolta»
e ha una riga per ognuna di D-1…D-14.
Prova: scripts/check.sh --rapido; node .github/scripts/check-doc-links.mjs
Stato: [x] fatto

## T27 · Le versioni dopo il motore

Perché: D-3 (a) dice «allineo dove posso»: T5 ha guardato solo la famiglia
di `usvg`, e il conto vero delle librerie doppie si vede solo con il motore
dentro (T9). Ognuna va allineata o motivata, e il tetto si riabbassa.
Tocca: `Cargo.toml` (radice), i `Cargo.toml` dei crate di Fub le cui
dipendenze dirette si muovono, `Cargo.lock`, il codice di quei crate solo
per adattarsi alle API nuove, `docs/reference/budgets.json`,
`docs/misure/disegno-versioni-2026-11.md`
Non toccare: `vendor/` (nessuna patch che abbassa VectorCraft: D-3 (b)
scartata); il risultato dell'export (stessi PDF e PNG); `crates/fub-disegno/src/`;
`deny.toml` (una licenza nuova ferma il task).
Dipende da: T9
Cosa fare:
- L'elenco: `cargo tree -e normal --all-features --target all -d -p
  fub-app`, e per ogni libreria doppia chi porta ciascuna versione (`cargo
  tree … -i <crate>@<versione>`).
- Per ognuna, in quest'ordine: (1) è una dipendenza diretta di Fub e c'è una
  versione pubblicata uguale a quella del motore (per esempio `kurbo`,
  `skrifa`, `read-fonts`, `peniko`, `fontdb`): si sposta, si adatta il
  codice senza cambiare il risultato, e i test del crate passano; (2) arriva
  da un crate di terzi che Fub usa (per esempio `usvg` 0.45 da `svg2pdf`):
  si guarda su crates.io se c'è una versione nuova compatibile, con la data
  in cui si è guardato, e se c'è si sposta; (3) se no resta doppia: una riga
  nel file di misura con chi porta ogni versione e perché non si muove.
- `budgets.json`: `librerie_doppie` al conto nuovo (solo verso il basso), con
  la nota aggiornata; se il conto non scende, si scrive perché.
- Nel file di misura: il conto dopo T9 e dopo questo task.
Casi limite: un aggiornamento che cambia l'export (si torna indietro e si
scrive il perché); un aggiornamento che porta un crate nuovo (si conta; con
una licenza nuova ci si ferma e si chiede); una libreria doppia solo nei
test (`-e normal` non la conta: si scrive a parte); un avviso di `cargo
deny` su una versione nuova (si resta alla vecchia e si scrive).
Fatto quando: `node .github/scripts/check-motori.mjs` e `cargo deny check`
sono verdi con il tetto abbassato (o uguale, con il perché); i test dei
crate toccati passano, compreso `cargo test -p fub-features --features
draw`; il file di misura ha una riga per ogni libreria ancora doppia.
Prova: scripts/check.sh --rapido; node .github/scripts/check-motori.mjs; cargo deny check
Stato: [ ] da fare

## T28 · Il motore che manca, e che torna

Perché: con D-8 (c) il disegno deve sapere se il motore è spento o fermo
(per dirlo, T23) e tornare al motore quando si riaccende o con «Riprova»,
senza riaprire il file; e la sessione del motore deve chiudersi in ogni modo
in cui il disegno finisce.
Tocca: `apps/client/src/editors/spatial/motore/gesti.ts` (`motoreDa`,
`MotoreDelDisegno`), `apps/client/src/editors/spatial/motore/gesti.test.ts`,
`apps/client/src/editors/spatial/motore/sessione.ts`,
`apps/client/src/editors/spatial/motore/sessione.test.ts`,
`apps/client/src/editors/spatial/surface.ts` (solo `openMotore` e la sua
chiusura), `apps/client/src/host/fake.ts` (solo il `DrawingFake`: uno stato
che cambia a metà sessione), `docs/architecture/disegno.md`
Non toccare: `tools/editor/gesture-begin.ts` (sceglie già la strada semplice
quando il motore non dà una sessione); il chip (T21, T23); `host/ipc.ts`
(T19); `state/components.ts` di K2 (si usa com'è).
Dipende da: K2 fuso; risposta D-14 (con (b) resta solo «Riprova», senza
`onComponents`)
Cosa fare:
- `sessione.ts`: un `unserved` a metà sessione (a un sync, un gesto, un
  comando) dà `MotoreAssente { perche: "spento" }`: l'host ha chiuso
  l'istanza perché il motore si è spento (T29). Gli altri errori e il tempo
  scaduto restano «errore»; `quandoAssente` porta il perché.
- `gesti.ts`: `motoreDa(apri: () => Promise<SessioneMotore | MotoreAssente>)`
  prende una funzione, non una promessa; `MotoreDelDisegno` prende `assente():
  MotoreAssente | null` (il perché, quando manca), `riapri(): void` (una
  apertura nuova se il motore manca; niente se è aperto o si sta aprendo;
  una sola alla volta) e `quandoCambia(listener): Teardown`. Una sessione
  chiusa non si riusa: la nuova ha un'istanza nuova e il testo intero di
  quel momento.
- `surface.ts`: `openMotore` passa `() => apriSessione(api,
  context.documentId, session.text(), session, { vault })`, che legge il
  testo quando riapre; ascolta `onComponents` (K2): `fub.motore-vettoriale`
  spento → chiude la sessione e dà «spento» subito, senza aspettare la
  richiesta dopo; riacceso → `riapri()`. Ogni ascolto con chi lo toglie.
- Un gesto cominciato con il motore finisce con il motore; se il motore
  manca a metà, il gesto si annulla (l'anteprima sparisce, niente si
  scrive) e si annuncia con il motivo; il gesto dopo usa la strada semplice
  (A16).
- La sessione si chiude in ogni modo in cui il disegno finisce: il
  riquadro chiuso, il file cancellato, il vault chiuso, il cambio di vault;
  con il file rinominato la sessione resta (segue la `DocumentSession`).
  Un test per ognuno.
- `disegno.md`: un paragrafo «Quando il motore manca» (spento, fermo,
  riacceso), con «(arriva con T23 e T29)» per ciò che non c'è ancora.
Casi limite: `onComponents` che arriva tante volte di fila (una riapertura
alla volta; vince l'ultimo stato); `riapri` mentre un'apertura è in volo
(niente); il motore riacceso da un'altra finestra (se K2 non manda
`onComponents` alle altre finestre, si scrive, e «Riprova» resta la via);
l'esito dell'apertura che arriva dopo la chiusura della superficie (si
chiude subito, come in T10); `riapri` dopo `chiudi` (niente); un testo
cambiato mentre il motore era spento (la riapertura manda il testo
intero); il tempo limite di 10 s (errore, come T8).
Fatto quando: `sessione.test.ts` e `gesti.test.ts` passano con: `unserved` a
metà sessione dà «spento», `internal` dà «errore»; `riapri()` dopo un errore
apre un'istanza nuova con il testo del momento; `onComponents` da spento ad
acceso riapre senza rimontare l'editor; un gesto in volo quando il motore
manca si annulla e non scrive niente; chiudere il riquadro chiude l'istanza
(il finto registra `closeDrawing`); montare e smontare la superficie 20
volte non lascia ascolti vivi; `node .github/scripts/check-listeners.mjs` è
verde; `tools/editor.test.ts` resta verde.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/sessione.test.ts src/editors/spatial/motore/gesti.test.ts src/editors/spatial/tools/editor.test.ts
Stato: [ ] da fare

## T29 · Il motore spento, nell'host

Perché: con D-14 (a) il motore si spegne nella pagina Componenti: l'host non
deve costruirlo né scaldarlo, deve chiudere le istanze di quel vault e
rendere la memoria quando nessuno lo usa più, e dire `Unserved` a chi lo
chiede.
Tocca: `crates/fub-host/src/drawing.rs` (di T19), `crates/fub-host/src/componenti.rs`
(di K2: solo una funzione che dice se il motore è spento, accanto a
`lavagna_spenta`, e la chiamata dopo un cambio), `crates/fub-host/src/engines.rs`
(di K3: solo `serves` per `svg`), `crates/fub-host/tests/drawing.rs` (di
T19), `crates/fub-host/tests/engines_warm.rs` (di K3),
`docs/reference/ipc-contract.md`
Non toccare: `crates/fub-disegno`; `crates/fub-motori` (si usa l'API di K3
che svuota e libera una voce); il client (T28); le regole del risolutore di
K2.
Dipende da: T19; K2 fuso; risposta D-14 (con (b) il task non si fa)
Cosa fare:
- `motore_disegno_spento(settings)`, come `lavagna_spenta`: legge
  `components.off` per `fub.motore-vettoriale`; il motore conta spento
  anche quando lo sono i disegni.
- `drawing_open` con il motore spento in quel vault: `PluginError::Unserved`
  con il motivo («il Motore del disegno è spento in questo vault»), prima di
  costruire qualunque cosa.
- Dopo `apply_components` che cambia la riga del motore: spento → le istanze
  di quel vault si chiudono (dopo il gesto in corso, come la chiusura del
  vault di T19) e le loro richieste dopo rispondono `Unserved`; se non resta
  nessuna istanza in nessun vault, il motore svuota le cache e rende la
  memoria con l'API di K3. Acceso → niente (riapre il client, T28).
- `warm_engine("svg")` non scalda il motore del disegno se nessun vault
  aperto lo ha acceso (`serves` in `engines.rs` guarda anche lo stato della
  riga).
- `ipc-contract.md`, sezione «Disegno»: che cosa vuol dire `unserved`
  all'apertura e a metà sessione (il motore è spento nel vault, o non c'è
  in questa build) e che cosa vuol dire `internal` (il motore si è fermato:
  si può riprovare).
Casi limite: due vault, il motore spento in uno solo (le istanze dell'altro
restano, e il motore resta costruito); spento e riacceso subito (in ordine;
nessuna istanza si riapre da sé); un gesto in corso quando si spegne
(finisce, poi l'istanza si chiude); il cambio fatto dalla CLI o dall'MCP
(passa dallo stesso `apply_components`, A2 di K2); un vault che ha l'id in
`components.off` aperto da una build senza il motore (nessun errore).
Fatto quando: `cargo test -p fub-host --test drawing` passa con: apertura
con il motore spento → `Unserved` e niente costruito (la voce del motore
dice spento); apri, spegni → il gesto dopo dà `Unserved`; riacceso → una
nuova apertura funziona; il caso dei due vault; `cargo test -p fub-host
--test engines_warm` dice che con il motore spento `warm_engine("svg")` dà
falso; `node .github/scripts/check-doc-links.mjs` esce con 0.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test drawing --test engines_warm
Stato: [ ] da fare

## T30 · La CI completa e la revisione prima del merge

Perché: l'utente fonde K5 in `main` soltanto dopo la CI completa (Windows,
macOS e i banchi) e una revisione riga per riga di tutto K5: lo vuole per
ogni piano.
Tocca: la PR #300 (segnata pronta, base `main`); i file che la revisione
trova da correggere, ognuno con un task nuovo in fondo al piano (e la sua
riga in «Modifiche») o con una correzione piccola, dove `DECISIONS.md` la
lascia all'orchestratore.
Non toccare: i limiti dei banchi (nessuno si alza); i task fatti (un difetto
in un task fatto si corregge con un task nuovo); la proposta a monte (si
scrive, non si manda).
Dipende da: T6, T7, T9, T11, T13–T24, T26–T29
Cosa fare (lo fa l'orchestratore, non un coder):
- Prima: main unito in `piano/k5-disegno` (K2 e K3 fusi), la base della PR
  #300 è `main`.
- `gh pr ready 300`: parte la CI completa (Linux, Windows, macOS, i banchi
  del client).
- Legge ogni job (`gh run view <run> --json jobs`, i log con `gh api
  repos/Fubeo/Fub/actions/jobs/<job>/logs`): ogni rosso ha la sua causa
  scritta. Un test instabile con l'issue aperta si rilancia una volta; senza
  issue, prima si apre l'issue.
- Le foto del banco delle scene nuove (T21–T24) dal runner, confrontate col
  prototipo.
- Una prova nell'app vera, su un vault di prova (mai `~/.cache/fub-live/`):
  `cargo tauri dev --config crates/fub-app/tauri.conf.json`, un disegno del
  corpus, gesti con il motore acceso, il motore spento dalla pagina
  Componenti, gesti con gli strumenti semplici, «Accendi…», di nuovo il
  motore; le foto nella PR.
- La revisione riga per riga del diff di K5 contro `main` (`git diff
  origin/main...piano/k5-disegno`): correttezza, nessuna perdita di dati
  (ogni gesto tocca solo ciò che cambia), nessun lucchetto tenuto mentre il
  motore lavora, ogni registrazione con chi la toglie, `vendor/` cambiato
  solo con patch e con la provenienza, le licenze, le due strade provate
  (A16), i testi in ogni lingua, le pagine di `docs/` che dicono il
  presente, nessun file generato scritto a mano. La revisione si scrive
  nella PR, un commento per area con i file.
- Il testo delle proposte a monte per VectorCraft, come bozza in un commento
  della PR: l'inclinazione della penna (D-12 (a)) e le patch 0001 e 0002
  («da proporre a monte»). Si mandano dopo K5, con il sì dell'utente.
- Ogni difetto ha la sua correzione e la CI torna verde.
- Poi chiede all'utente il merge, con il link alla PR, l'esito della CI e il
  riassunto della revisione. Il merge si fa soltanto dopo il sì.
Casi limite: un job di Windows o macOS che non parte (si aspetta, non si
salta); un rosso che c'è uguale su `main` (si scrive con il run di `main`,
non si nasconde); il controllo di `vendor/` rosso perché il mirror non
risponde (si rilancia una volta, poi si chiede); la revisione trova un
difetto in un task fatto (task nuovo, il vecchio non si riapre); un difetto
che cambia ciò che l'utente vede o un contratto (si chiede, come dice
`DECISIONS.md`).
Fatto quando: la PR #300 è pronta e ogni job è verde; la revisione e la
prova nell'app vera sono scritte nella PR; nessun task resta aperto;
l'utente ha detto sì al merge.
Prova: gh pr checks 300
Stato: [ ] da fare
