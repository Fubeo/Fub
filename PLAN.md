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
l'inclinazione della penna nel motore (D-12); l'MCP del motore; il caso
generale di un motore come scrittore del file (D-6).
Assunzioni: A1–A15 qui sotto, scelte dal pianificatore il 2026-11-02 di notte
(l'utente non poteva rispondere; le domande sono in «Domande per l'utente»).
Ondate: T1 T2 T3 | T4 T5 | T6 T7 T8 | T9 T10 | T11 T12 T13 | T14 T15 T16 | T17 T18 T19 | T20 | T21 T24 | T22 | T23
Prototipo: nessuno (stanotte non si poteva mostrare: «Che cosa si vede»
descrive ogni parte visibile con i pezzi della shell che ci sono già, e le
scelte d'aspetto dell'utente sono in D-9).

## Modifiche

nessuna

## Dal prototipo

Nessun prototipo. I pezzi visibili, tutti fatti con ciò che la shell ha già:

| Pezzo | Destinazione | Task |
|---|---|---|
| anteprima del gesto che dà il motore | `showShape` di `apps/client/src/editors/spatial/tools/editor/marks.ts` (c'è già), chiamato da `apps/client/src/editors/spatial/motore/gesti.ts` (nuovo) | T10 |
| chip «N parti restano come sono» e il riquadro «Che cosa manca?» con «Vai» | `SurfaceStanding` di `apps/client/src/editors/core/registry.ts` (c'è già), costruito da `apps/client/src/editors/spatial/motore/standing.ts` (nuovo) | T21 |
| gesto rifiutato | `announce(t("draw.rejected", …))` di `apps/client/src/editors/spatial/tools/editor/operations.ts` (c'è già) | T21 |
| strumento Testo nella barra | `apps/client/src/editors/spatial/tools/registry.ts`, icona in `apps/client/src/editors/spatial/icons.ts` | T22 |
| strumenti spenti senza motore, con «Accendi…» | uno strumento spento nella colonna (`apps/client/src/kit/tool-rail.ts`, che oggi spegne solo la colonna intera: lo aggiunge T24), la colonna del disegno `apps/client/src/editors/spatial/tools/editor/chrome/rail.ts`, e un `SurfaceStanding` | T23, T24 |
| «Accendi…» che apre Impostazioni › Componenti sulla riga del motore | una porta in `apps/client/src/ui/commands.ts` come `registerDrawingImport`, aperta da `apps/client/src/panels/settings.ts` (oggi non c'è) | T24 |
| testi | `apps/client/src/editors/spatial/strings.ts` (IT, EN) | T21, T22, T23 |

## Fonti

- I «Piani di Fub» (ricomposti il 31 ottobre 2026): `passi/13-k5-disegno.md`
  (il passo e il cancello), `02-contesto.md`, `03-rischi-e-domande.md`, e per
  i confini `10-k3-motori.md`, `12a-n3.md`, `12b-n4.md`. I coder non li
  leggono: qui c'è ciò che serve.
- Il piano K3 (`piano/k3-motori`, HEAD `c5851334`, T1–T7 fatti): lo strato
  dei motori `crates/fub-motori` (`Pigro`, `Servizi`, `Motori`, `Voce`,
  `Lavori::in_sottofondo`, il catalogo), `docs/reference/budgets.json`
  (`librerie_doppie` 45), `.github/scripts/check-motori.mjs`,
  `docs/architecture/motori.md`, l'adattatore d'esempio
  `crates/fub-format-xlsx/src/motore.rs`. Niente di questo è su main.
- VectorCraft upstream `storytold/vectorcraft` @ `cfb30d81`, letto (non
  compilato) in `/home/fubeo/.cache/fub-k1/tmp/k5/vectorcraft-sorgente`. Le
  misure di K0 (`docs/misure/motori-2026-10-31-linux-ryzen.md`) sono di
  `ed733b7`: 64,6 MiB senza simboli, `vectorcraft_engine` 11,8 MiB.
- Nel repo: ADR 0204 (il nucleo dell'inchiostro), 0213 e 0221 (come entrano i
  motori), 0231 (gli strumenti Essenziali dopo N1), `docs/reference/scene-operations.md`,
  `docs/reference/ipc-contract.md`, `tools/vendor-craft/`, `vendor/gridcraft/`.
- Scritto su main @ `620f0acd` (2026-11-02).

## Che cosa si vede

Per chi usa Fub, alla fine di K5:

1. **Il disegno è lo stesso di oggi**, nei due spazi di lavoro (Semplice e
   Completo hanno gli stessi strumenti; Completo aggiunge l'ispettore e i
   menu), con le stesse icone e lo stesso ordine: Selezione, Mano, Lente,
   Penna, Evidenziatore, Gomma, Rettangolo, Ellisse, Linea, Freccia, e in più
   **Testo** (T22, D-7).
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
3. **Con il motore spento** (componente spento, o un errore del motore), nel
   disegno gli strumenti del motore (Selezione, forme, Testo) restano
   in barra ma disattivati, con il suggerimento «Serve il Motore del disegno»,
   e il chip dice «Motore del disegno spento» con «Accendi…», che apre la riga
   del componente in Impostazioni › Componenti (T24). Mano, Lente, Penna,
   Evidenziatore e Gomma funzionano (T23, D-8). Fino a T23, senza motore gli
   strumenti funzionano come oggi (TypeScript).
4. **Nei PDF non cambia niente** (il profilo `pdf` tiene i suoi strumenti),
   e nemmeno ciò che l'ispettore e i menu dello spazio Completo scrivono
   campo per campo. L'interruttore Semplice · Completo resta dov'è oggi, nel
   menu ≡ della superficie (`tools/editor/chrome/workspace.ts`), e cambia
   soltanto l'aspetto, come oggi (D-13).
5. **Sulla lavagna non cambia niente** (N6).

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
  `fub.draw` lo richiede, come `fub.rich` richiede `fub.motore-documenti`.
  Il componente `caratteri` della mappa non c'è ancora: i caratteri arrivano
  come servizio di `fub-motori` (T7, D-5), non come riga.
- A10 · **I comandi sono solo quelli del disegno di oggi**: colore del tratto, del
  riempimento, spessore. Il catalogo completo del motore è K6.
- A11 · **Revisione `cfb30d81`** di VectorCraft (quella clonata stanotte); K0
  aveva misurato `ed733b7`. Se l'utente sceglie un'altra revisione, cambia
  solo T6.
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
- A15 · **Le versioni in comune si allineano verso l'alto** (T5): Fub sale a
  `resvg`/`usvg` 0.48 e a un `svg2pdf` che le usa, invece di abbassare
  VectorCraft con una patch. Se un `svg2pdf` compatibile non esiste, T5 si
  ferma e lo scrive (D-3).

## Domande per l'utente (raccolte, non bloccano)

Ognuna con la raccomandazione per prima. Il piano procede con quella; i task
che dipendono da una risposta costosa da disfare stanno dall'ondata 3 in poi.

- D-1 · **Da dove si copia VectorCraft.** (a) Crei `Fubeo/vectorcraft` come
  per WordCraft e GridCraft, e `upstream.lock` lo nomina come `mirror`; (b)
  `vendor/` prende direttamente da `storytold/vectorcraft` a una revisione
  fissata, con `mirror = ""`. Consiglio: (a), lo stesso schema degli altri
  motori, e una copia che resta se l'upstream sparisce. Che cosa cambia: solo
  T6 (con (b) il campo `mirror` è vuoto e `verify-upstream` prova solo
  storytold). T6 non parte senza risposta.
- D-2 · **Le librerie comuni di Craft (`storytold/craft-libs`).** VectorCraft
  usa `craft-docpath` (motore, SVG) e `craft-vectorcraft-format` (formato)
  da Git, a due revisioni (`92d392c`, `14d5dbb`), e `craft-pdf` dal crate
  PDF. (a) si copiano in `vendor/craft-libs/` soltanto `docpath` e
  `vectorcraft-format`, e il crate PDF va dietro una feature spenta (patch
  0002); (b) come (a) più `craft-pdf`, e il PDF del motore resta acceso;
  (c) dipendenze Git nel `Cargo.toml` di Fub. Consiglio: (a), meno codice e
  nessuna dipendenza da Git (`deny.toml` le vieta). T6.
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
- D-4 · **Sei comandi IPC nuovi** (`open_drawing`, `drawing_sync`,
  `drawing_gesture`, `drawing_commands`, `drawing_command`,
  `close_drawing`) e le loro righe in `permissions/default.toml`. Consiglio:
  sì, è la stessa forma dei fogli (`open_grid_bytes` e i suoi). T19 aspetta
  il sì; T4 (i tipi) e T8 (il client, sul finto host) no.
- D-5 · **I caratteri del motore adesso.** Il motore non deve cercare i
  caratteri del sistema: riceve quelli di Fub (Inter, Literata, JetBrains
  Mono, già nel binario) da un servizio `caratteri` di `fub-motori`, che K3
  aveva rimandato «al primo motore che li usa». Consiglio: sì, ora, come
  servizio (T7); la riga di componente «caratteri» della mappa di K1 arriva
  con chi ne ha bisogno da solo (K6, P5).
- D-6 · **Chi scrive il file.** (a) Il client, con le operazioni di scena che
  il motore calcola (A2); (b) il motore riscrive l'SVG intero a ogni gesto.
  Consiglio: (a): con (b) ogni gesto riscriverebbe anche ciò che non tocca, e
  il cancello «senza perdite» diventerebbe una scommessa su ogni file.
- D-7 · **Lo strumento Testo nel disegno.** Il passo lo mette nel semplice;
  l'ADR 0231 §2 aveva tolto «Testo» dallo Standard, e oggi un testo libero
  non si crea: si scrive l'etichetta dentro una forma
  (`tools/labels.ts`), e il testo di un `<text>` che c'è già si cambia nel
  campo «Testo» dell'ispettore. (a) Sì: Testo torna in barra, un clic crea
  un testo con la parola «Testo», lo seleziona e mette il cursore nel campo
  dell'ispettore (svuotato, il testo sparisce, come oggi un testo senza
  niente da leggere); (b) no, resta com'è oggi. Consiglio: (a), è ciò che il
  passo chiede. T22, ultima ondata.
- D-8 · **Senza motore, nel disegno.** (a) Dopo il cancello, gli
  strumenti del motore si disattivano con «Serve il Motore del disegno» e
  «Accendi…»; (b) restano per sempre gli strumenti TypeScript come ripiego
  silenzioso. Consiglio: (a), una cosa sola che si comporta in un modo solo.
  Il codice TypeScript resta comunque, perché lo usano i PDF. T23, ultima
  ondata.
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
- D-10 · **L'interruttore Semplice · Completo nella barra del file** e
  «Apri nel disegno completo». Consiglio: con K6, quando «Completo» vuol dire
  il motore intero; oggi resta nel menu ≡.
- D-11 · **«Con il disegno spento la lavagna dice che cosa manca».** In K5 la
  lavagna non usa il motore (mostra i `.svg` come immagini). Consiglio: la
  frase passa a N6, quando la lavagna userà il motore; in K5 lo dice il
  disegno (T23).
- D-12 · **L'inclinazione della penna al motore.** Consiglio: proposta a
  monte dopo K5, quando la penna entrerà nel motore (K6 o N6); in K5 la penna
  non entra nel motore (A3).
- D-13 · **Il motore anche nello spazio Completo.** Il passo dice «Disegno
  semplice»; nel codice Semplice e Completo hanno gli stessi strumenti e
  cambiano solo pulsanti, ispettore e menu. (a) Il motore guida gli
  strumenti in tutti e due (A14); (b) solo nel Semplice, e nel Completo
  restano quelli TypeScript. Consiglio: (a): con (b) lo stesso rettangolo
  sullo stesso file farebbe cose diverse a seconda di un'impostazione
  d'aspetto, e il cancello andrebbe fatto due volte. Cambia T10 e T23 (con
  (b), una condizione in più sullo spazio).

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
- **Il mirror `Fubeo/vectorcraft` non esiste** (D-1).
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
- **Un «Accendi…» che apre la riga di un componente non c'è**: le
  Impostazioni scelgono la scheda solo con un clic (`selectTab` è privata in
  `apps/client/src/panels/settings.ts`), e la colonna degli strumenti del kit
  (`kit/tool-rail.ts`) spegne solo tutta la colonna. Li aggiunge T24.
- **La lavagna oggi richiede solo `fub.penna`**, e il commento in
  `componenti.rs` dice già che «sarà una riga di supporto che questa
  richiede»: in K5 la riga nasce, la lavagna non la richiede ancora (N6).

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

## Chi aspetta chi

- **Ondate 1 e 2 (T1–T5) partono subito da main.** Non toccano `vendor/`, non
  aggiungono crate (T5 alza solo versioni che Fub ha già) e non hanno bisogno
  di K3.
- **La linea del client (T3 → T8 → T10 → T12) non aspetta né K3 né le
  risposte**: lavora sul finto host. T8 può partire appena T4 è fuso.
- **Dall'ondata 3 la linea del motore (T6, T7, T9, T11, T13–T20) aspetta K3
  fuso in main** (`crates/fub-motori`, `docs/reference/budgets.json`,
  `check-motori.mjs`, `docs/architecture/motori.md`) **e le risposte D-1,
  D-2, D-3, D-5**; T19 anche D-4.
- **T21–T23 (grafica) aspettano D-7, D-8, D-9** e il cancello (T20). T24 non
  ha bisogno del motore (è della shell), ma serve solo se D-8 è (a): va
  nell'ondata di T21, con i «Tocca» disgiunti.
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
  T5, T6 e T9.
- Solo gli adattatori nominano il motore: `crates/fub-disegno` è l'unico crate
  che dipende da `vectorcraft-*` (`check-engine-boundary.mjs`).
- Mai un lucchetto tenuto mentre il motore lavora (come in K3).
- Niente lavoro all'avvio: il motore si costruisce al primo disegno aperto.
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
| il disegno spento dice che cosa manca | nel disegno: test e foto del banco (la lavagna: N6, D-11) | T23, T24 |
| i gesti del motore fanno ciò che fanno quelli di oggi | i vettori di T3 passano sul motore, con le differenze ammesse scritte | T3, T14, T15, T17 |

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
Stato: [ ] da fare

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
Stato: [ ] da fare

## T6 · VectorCraft in `vendor/`

Perché: il motore entra come gli altri: upstream a uno SHA, patch numerate,
provenienza controllata in CI.
Tocca: `tools/vendor-craft/motori.mjs`, `vendor/vectorcraft/` (nuovo:
`UPSTREAM.md`, `upstream.lock`, `Cargo.toml` e `Cargo.lock` di Fub, i crate
gestiti, `patches/0001-importatori-opzionali.patch`,
`patches/0002-pdf-opzionale.patch`, `LICENSE-MIT`, `LICENSE-APACHE`,
`NOTICE`, `ASSETS.md`, `assets/fonts/`), `vendor/craft-libs/` (nuovo:
`docpath`, `vectorcraft-format`, le loro licenze, `UPSTREAM.md`), `Cargo.toml`
(radice: solo `exclude`)
Non toccare: `vendor/wordcraft`, `vendor/gridcraft`; i `[workspace.dependencies]`
della radice (T9); `tools/vendor-craft/vendor.mjs` (se gli manca qualcosa,
si scrive nel task e si chiede, non si cambia qui).
Dipende da: T5; K3 fuso; risposte D-1, D-2, D-3
Cosa fare:
- In `motori.mjs` la voce `vectorcraft` come `gridcraft`: `repository`
  `https://github.com/storytold/vectorcraft`, i gestiti `crates/geom`,
  `color`, `doc`, `pathops`, `brush`, `trace`, `text`, `effects`, `plugins`,
  `three-d`, `render`, `svg`, `pdf`, `format`, `eps`, `cad`, `metafile`,
  `affinity`, `scriptcheck`, `tools`, `engine`, `testkit`, e `assets/fonts`,
  `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, `ASSETS.md`; fuori `ui-egui`,
  `mcp`, `apps/*`, `xtask`; il `gate`: `vendor.mjs vectorcraft check`, `cargo
  test --manifest-path vendor/vectorcraft/Cargo.toml --workspace --locked
  --no-fail-fast`, `cargo test -p fub-disegno`, `check-engine-boundary.mjs`,
  `cargo deny check`.
- `node tools/vendor-craft/vendor.mjs vectorcraft update --rev cfb30d81…`
  (SHA intero dall'upstream, `--source` il mirror se D-1 è (a)).
- Patch 0001: `affinity`, `cad`, `eps`, `metafile`, `scriptcheck` (se lo usa
  solo un importatore) e `plugins` dietro feature spente in `engine` ed
  `effects`, con i `#[cfg]` dove li chiamano; patch 0002: `pdf` dietro una
  feature spenta in `engine`. Ognuna con la sua riga in `UPSTREAM.md` e la
  frase «da proporre a monte».
- `vendor/craft-libs/`: `docpath` a `92d392c` e `vectorcraft-format` a
  `14d5dbb`, come copia con la loro provenienza in `UPSTREAM.md` (D-2 (a));
  il `Cargo.toml` di `vendor/vectorcraft` li prende per percorso.
- Leggere `crates/text/build.rs` prima di compilare (niente rete: «Prove
  fatte») e compilare con `CRAFT_FONTS_DIR` vuoto.
Casi limite: una patch che non si applica (si rifà a tre vie con `update`);
un crate gestito che usa un crate escluso (si scrive, si aggiunge alla patch
o ai gestiti, con il perché); un file dell'upstream senza licenza chiara (non
si copia); `cargo deny` che trova una licenza nuova (si ferma: D-3); il
gate che fallisce su un test del motore che vuole i caratteri di craft-fonts
(salta da sé con `CRAFT_FONTS` vuoto: se no, si scrive); le
`[patch.crates-io]` del workspace di VectorCraft (`hayro-*`, `krilla` da
`craft-libs`) restano nel `Cargo.toml` di `vendor/vectorcraft` solo se i suoi
test le vogliono, e non vanno mai nel `Cargo.toml` radice di Fub (si
spengono i crate che le usano, patch 0001 e 0002).
Fatto quando: `node tools/vendor-craft/vendor.mjs vectorcraft check` esce con
0; `cargo test --manifest-path vendor/vectorcraft/Cargo.toml --workspace
--locked` passa (o i test che falliscono sono elencati in `UPSTREAM.md` con
il perché); `UPSTREAM.md` dice revisione, patch, peso dei sorgenti e tempo di
compilazione misurati.
Prova: scripts/check.sh --rapido; node tools/vendor-craft/vendor.mjs vectorcraft check
Stato: [ ] da fare

## T7 · I caratteri per i motori

Perché: il motore non deve leggere i caratteri del sistema (lo stesso disegno
deve uscire uguale ovunque); li riceve dall'host, una volta per processo.
Tocca: `crates/fub-motori/src/caratteri.rs` (nuovo), `crates/fub-motori/src/servizi.rs`
(di K3), `crates/fub-motori/src/lib.rs` (di K3), `crates/fub-motori/tests/caratteri.rs`
(nuovo), `docs/architecture/motori.md` (di K3)
Non toccare: `crates/fub-features/src/draw.rs` (dà le facce, T19); gli
adattatori dei fogli e dei documenti; il budget della memoria.
Dipende da: K3 fuso; risposta D-5
Cosa fare:
- `pub struct Caratteri { facce: Vec<&'static [u8]>, serif: String, sans:
  String, mono: String }` con `pub fn nuovi(facce, generiche: Generiche)` e
  i lettori; nessuna dipendenza da `fontdb` (ognuno costruisce il suo).
- In `Servizi`: `pub fn fornisci_caratteri(&self, caratteri: Caratteri) ->
  Result<(), Caratteri>` (una volta sola: la seconda restituisce ciò che ha
  ricevuto) e `pub fn caratteri(&self) -> Option<Arc<Caratteri>>`. Un
  `OnceLock`, niente lavoro se nessuno chiede.
- Il commento di `servizi.rs` («arrivano con il primo motore che li usa»)
  diventa: arrivati con il disegno (K5).
- Nella pagina dei motori un paragrafo «I caratteri».
Casi limite: chiesti prima che l'host li dia (`None`: il motore dice
`NotReady`, T11); dati due volte (il secondo rifiutato); zero facce
(ammesso: i testi si disegnano col ripiego, la doc lo dice); thread diversi
che li chiedono insieme.
Fatto quando: `cargo test -p fub-motori --test caratteri` passa con: prima
`None`; dopo `fornisci` le stesse facce; il secondo `fornisci` restituisce
`Err`; dieci thread che leggono insieme vedono la stessa `Arc`.
Prova: scripts/check.sh --rapido; cargo test -p fub-motori --test caratteri
Stato: [ ] da fare

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
Stato: [ ] da fare

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
- `deny.toml`: le licenze nuove approvate in D-3, una per riga con il crate.
- `budgets.json`: il tetto nuovo di `librerie_doppie` (se D-3 è (a)), con
  la nota che dice perché e rimanda al file di misura; il conto dopo nel
  file di misura di T5.
Casi limite: una dipendenza che riaccende `bundled-fonts` o il PDF per
unione di feature (`cargo tree -e features -i vectorcraft-text` lo mostra:
si toglie); `cargo deny` rosso su un avviso di sicurezza (si ferma e si
scrive); il workspace che compila due `kurbo` in più del previsto (si
scrive nel file di misura).
Fatto quando: `cargo check -p fub-disegno` passa; `node
.github/scripts/check-engine-boundary.mjs` e `cargo test -p fub-abi --test
dependency_invariant` passano, e falliscono se un altro crate aggiunge
`vectorcraft-engine`; `cargo deny check` e `node
.github/scripts/check-motori.mjs` sono verdi.
Prova: scripts/check.sh --rapido; cargo check -p fub-disegno
Stato: [ ] da fare

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
Stato: [ ] da fare

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
Stato: [ ] da fare

## T13 · Il componente «Motore del disegno»

Perché: il motore è un componente come gli altri: si vede nella riga dei
componenti, si accende con il disegno, e la build senza di lui resta.
Tocca: `crates/fub-features/src/componenti.rs`, `crates/fub-features/Cargo.toml`,
`crates/fub-features/tests/catalogs.rs`, `crates/fub-host/Cargo.toml`,
`crates/fub-host/tests/componenti.rs`, `Cargo.lock`
Non toccare: la riga della lavagna (resta com'è, N6: solo il commento si
aggiorna); `crates/fub-componenti` e la mappa di K1; il codice dell'host
(T19).
Dipende da: T9
Cosa fare:
- In `fub-features/Cargo.toml` la feature `engine-drawing = []`, e `draw`
  la include (come `rich = ["engine-documents"]`).
- In `componenti.rs`: `#[cfg(feature = "engine-drawing")]
  Riga::motore("fub.motore-vettoriale",
  "component.motore-vettoriale.name").group("supporto").cargo_feature("engine-drawing").senza_bundle()`;
  `fub.draw` prende `.requires(&["fub.motore-vettoriale"])`; il nome
  («Motore del disegno», «Drawing engine») accanto agli altri; il commento
  sopra la lavagna dice che la riga ora c'è e che la richiederà N6.
- In `fub-host/Cargo.toml`: `draw` aggiunge `dep:fub-disegno` e
  `fub-features/engine-drawing`.
- I test: il nome nel catalogo italiano (`catalogs.rs`); in
  `tests/componenti.rs` la riga c'è con `draw` e non c'è senza.
Casi limite: la build senza `draw` (nessuna riga, nessun crate del motore:
`cargo tree -p fub-host --no-default-features` non mostra `vectorcraft`); un
componente di supporto che nessuno richiede (si spegne: per questo `draw` lo
richiede).
Fatto quando: `cargo test -p fub-features --test catalogs` e `cargo test -p
fub-host --test componenti` passano, compresi i due casi con e senza `draw`.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test componenti
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

Perché: il client deve raggiungere il motore; senza la feature o con il
motore spento, deve sentirsi dire che non c'è.
Tocca: `crates/fub-host/src/drawing.rs` (nuovo), `crates/fub-host/src/lib.rs`,
`crates/fub-host/src/session.rs` (solo il campo in `Host`, la sua
costruzione, e la chiusura del vault che chiude i suoi disegni),
`crates/fub-host/tests/drawing.rs` (nuovo), `crates/fub-app/src/lib.rs`,
`crates/fub-app/permissions/default.toml`, `crates/fub-app/tests/lean_ipc.rs`,
`crates/fub-features/src/draw.rs` (solo una funzione pubblica per le facce),
`docs/reference/ipc-contract.md`, `docs/architecture/editor-surfaces.md`
Non toccare: `crates/fub-disegno` (si usa la sua API); i comandi Grid; la
logica dell'export in `draw.rs`.
Dipende da: T11, T13; risposta D-4
Cosa fare:
- `draw.rs`: `pub fn facce() -> &'static [&'static [u8]]` (le `FACES`) e i
  nomi delle famiglie generiche (`SERIF`, `SANS`, `MONO`).
- `drawing.rs` (`impl Host`, come `workbook.rs`): alla prima apertura
  `Servizi::processo().fornisci_caratteri(...)` con quelle facce; le istanze
  per vault in una mappa sotto un lucchetto, che si prende per trovare
  l'istanza e si lascia prima di chiamarla; `drawing_open`, `drawing_sync`,
  `drawing_gesture`, `drawing_commands`, `drawing_command`, `drawing_close`;
  ogni richiesta passa da `validate()` (T4). Senza la feature `draw` le
  funzioni ci sono e rispondono `PluginError::Unserved` (come il tipo vuoto
  di `rich.rs`).
- `fub-app/src/lib.rs`: i sei `#[tauri::command]` (`open_drawing(host, doc,
  text, vault)` ecc.) registrati accanto a quelli Grid; le sei righe in
  `permissions/default.toml`; in `lean_ipc.rs` le righe con un `Why::Drawing`
  nuovo che spiega perché una porta tipata (come `Why::Grid`).
- `ipc-contract.md`: tolto «(arrivano con T19)»; `editor-surfaces.md`: il
  disegno ha una sessione del motore.
Casi limite: un'istanza di un vault chiuso (`UnknownView` o l'errore che i
fogli danno per un'istanza sconosciuta: lo stesso); due finestre sullo
stesso file (due istanze); il motore che fallisce a costruirsi (l'apertura
dice `Unserved` con il motivo nel log); la chiusura del vault con un gesto in
corso (l'istanza si chiude dopo il gesto); 1000 istanze aperte (il budget di
K3 svuota le cache, le istanze restano).
Fatto quando: `cargo test -p fub-host --test drawing` passa con: apri un
disegno di prova, sync di un `edit`, un gesto rettangolo che dà le
operazioni del vettore di T3, chiudi; senza `draw`
(`cargo test -p fub-host --no-default-features --test drawing`) l'apertura
dà `Unserved`; `cargo test -p fub-app --test lean_ipc` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test drawing; cargo test -p fub-app --test lean_ipc
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
`apps/client/src/editors/spatial/motore/gesti.ts` (di T10)
Non toccare: `editors/core/registry.ts` (il `SurfaceStanding` si usa com'è);
`editors/rich/standing.ts` (si legge come esempio); l'avviso della sola
lettura di oggi (`vector.read_only.*` in `surface.ts`).
Dipende da: T20; risposta D-9
Cosa fare:
- `standing.ts`: dalle `losses` di `DrawingOpen` (e da quelle degli esiti) un
  `SurfaceStanding` come `editors/rich/standing.ts`, con `kind: "closed"`
  (quello dei documenti con parti chiuse; i tipi in
  `editors/core/registry.ts`, `SurfaceStandingKind`): testo «N parti restano
  come sono», `placesAsk` «Che cosa manca?», un posto per perdita con il
  `detail` e «Vai» (seleziona l'elemento e lo porta in vista); nessun chip
  senza perdite.
- `surface.ts`: la superficie del disegno oggi non ha `standing`; la prende
  (il campo `standing?: SurfaceStanding` della superficie, in
  `registry.ts`), solo nel profilo «vector».
- In `gesti.ts` i motivi del rifiuto con i testi nuovi (`Unmapped`: «Questa
  parte resta com'è: il disegno non la sa ancora modificare»; `NotReady`:
  «Il disegno si sta ancora aprendo»; gli altri con le chiavi di oggi).
- Le chiavi in `strings.ts`, IT ed EN.
- Al banco (skill `banco`): foto chiaro e scuro, piena e 700 px, del chip e
  del riquadro su `illustrator.svg` del corpus.
Casi limite: 500 perdite (il riquadro scorre; il testo dice il numero
intero); un nome di elemento lunghissimo (si taglia); una perdita su un
elemento poi cancellato (il posto sparisce); un disegno in sola lettura (il
motore non apre gesti: il chip non si mostra, resta l'avviso di oggi); il
profilo PDF (nessun chip).
Fatto quando: `npm --prefix apps/client test --
src/editors/spatial/motore/standing.test.ts` passa; le foto del banco
mostrano il chip e il riquadro in chiaro e scuro; `strings.test.ts` è verde.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/standing.test.ts src/editors/spatial/strings.test.ts
Stato: [ ] da fare

## T22 · Lo strumento Testo

Perché: il passo mette il testo fra gli strumenti del disegno; oggi un testo
libero non si crea (D-7).
Tocca: `apps/client/src/editors/spatial/tools/registry.ts`,
`apps/client/src/editors/spatial/strings.ts`,
`apps/client/src/editors/spatial/icons.ts`,
`apps/client/src/editors/spatial/motore/gesti.ts` (di T10),
`apps/client/src/editors/spatial/motore/gesti.test.ts` (di T10),
`apps/client/src/editors/spatial/tools/editor/gesture-begin.ts`,
`apps/client/src/editors/spatial/tools/editor/chrome/rail.ts`,
`docs/decisions/NNNN-il-disegno-sul-motore-vettoriale.md` (di T1)
Non toccare: il profilo PDF (non prende lo strumento); `tools/properties.ts`
(si mette a fuoco il campo che c'è); `tools/labels.ts` (l'etichetta dentro
una forma resta com'è); i comandi e i campi dello spazio Completo.
Dipende da: T17, T21; risposta D-7
Cosa fare:
- In `TOOLS` (`tools/registry.ts`) lo strumento `{ id: "text", spaces: {
  vector: "simple" }, group: "text", icon: "draw-text", label:
  "draw.tool.text", description: "draw.tool.text.hint", shortcut: "t" }`,
  dopo la Freccia; `"text"` in `ToolId` e in `Feature`. Il tasto `t` è
  libero oggi (tasti usati: v, h, z, p, Shift-p, e, n, r, o, l, Shift-l, c;
  si ricontrolla `tools/editor/keys.ts` e `__fixtures__/command-keys.json`).
- In `chrome/rail.ts` la casella `["text"]` nel gruppo delle forme del
  layout `VECTOR` (non in `PDF`).
- L'icona `draw-text` in `icons.ts`, disegnata come le altre; `draw.tool.text`,
  `draw.tool.text.hint` e la parola del testo nuovo («Testo», «Text») in IT ed
  EN in `strings.ts`.
- In `gesture-begin.ts` il caso `text` → gesto del motore (T10) con
  `DrawingGesture.text` = la parola del testo nuovo; senza motore `refused`.
- Dopo il commit: il testo nuovo selezionato e il campo del testo
  dell'ispettore a fuoco (il `case "text"` di `tools/properties.ts`, la
  `textarea` con `draw-properties-field`); l'ispettore chiuso si apre.
- L'ADR di T1 aggiornata: il §2 della 0231 («Testo» va via) cambia per lo
  strumento Testo.
- Foto del banco (skill `banco`) della colonna con lo strumento, chiaro e
  scuro.
Casi limite: il tasto `t` preso nel frattempo (si sceglie un altro tasto e
si scrive nell'ADR); il profilo PDF (niente strumento); chi ha scelto la sua
colonna in «Personalizza la barra…» (`chosenLayout`: Testo non compare finché
non lo aggiunge, come ogni strumento nuovo); il testo svuotato
nell'ispettore (sparisce, come oggi un testo senza niente da leggere); il
clic su una forma che c'è già (si crea il testo sopra, non l'etichetta: quella
resta di `labels.ts`).
Fatto quando: un test in `motore/gesti.test.ts` (sul finto) dice che un clic
con Testo dà un `<text>` con la parola del testo nuovo, selezionato, e il
campo dell'ispettore a fuoco; `icons.test.ts` e `strings.test.ts` verdi; la
foto del banco mostra lo strumento nella colonna.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/gesti.test.ts src/editors/spatial/icons.test.ts src/editors/spatial/strings.test.ts
Stato: [ ] da fare

## T23 · Senza motore, detto

Perché: con il motore spento il disegno non deve fare in un altro modo di
nascosto: dice che cosa manca e come accenderlo (D-8).
Tocca: `apps/client/src/editors/spatial/surface.ts`,
`apps/client/src/editors/spatial/motore/standing.ts` (di T21),
`apps/client/src/editors/spatial/motore/standing.test.ts` (di T21),
`apps/client/src/editors/spatial/strings.ts`,
`apps/client/src/editors/spatial/tools/editor/gesture-begin.ts`,
`apps/client/src/editors/spatial/tools/editor/chrome/rail.ts`,
`docs/decisions/NNNN-il-disegno-sul-motore-vettoriale.md` (di T1)
Non toccare: gli strumenti TypeScript (li usa il profilo PDF);
`tools/fubdraw-inventory.mjs` (i moduli TypeScript restano raggiunti dal
profilo PDF, quindi l'inventario della 0231 §5 non cambia); penna,
evidenziatore, gomma;
`kit/tool-rail.ts`, `ui/commands.ts` e `panels/settings.ts` (si usano come
li lascia T24).
Dipende da: T22, T24; risposta D-8
Cosa fare:
- Con `MotoreAssente` nel profilo «vector» (tutti e due gli spazi, A14):
  Selezione, forme e Testo spenti nella colonna (`chrome/rail.ts`, con lo
  strumento spento di T24) con il suggerimento «Serve il Motore del disegno»;
  Mano, Lente, Penna, Evidenziatore e Gomma restano accesi.
- In `standing.ts` il chip «Motore del disegno spento» (`kind: "closed"`)
  con l'azione «Accendi…», che chiama la porta di T24 sulla riga
  `fub.motore-vettoriale`; se la porta non c'è (`false`), l'azione non si
  mostra.
- `gesture-begin.ts` rifiuta quei gesti con lo stesso motivo invece di
  passare agli strumenti TypeScript.
- Nell'ADR di T1: nel profilo «vector» il ripiego TypeScript è finito;
  l'inventario della 0231 §5 non cambia, perché quei moduli restano del
  profilo PDF.
- Foto del banco, chiaro e scuro.
Casi limite: il motore che si spegne a metà sessione (la sessione chiude, la
colonna si aggiorna; il gesto in corso si annulla); il motore che torna acceso
(la sessione si riapre senza riaprire il file e la colonna si riaccende); lo
strumento scelto spento (si torna alla Mano, che c'è sempre); il profilo PDF
(niente cambia); un disegno in sola lettura (resta l'avviso di oggi, la
colonna è già tutta spenta).
Fatto quando: un test in `motore/standing.test.ts` sul finto spento dice che
Selezione, forme e Testo sono spenti con il suggerimento, che Penna e Mano
no, e che «Accendi…» chiama la porta con `fub.motore-vettoriale`;
`tools/editor.test.ts` resta verde; foto del banco.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/editors/spatial/motore/standing.test.ts src/editors/spatial/tools/editor.test.ts
Stato: [ ] da fare

## T24 · Uno strumento spento, e la riga di un componente da aprire

Perché: T23 ha bisogno di due pezzi della shell che oggi non ci sono: la
colonna degli strumenti del kit spegne solo tutta la colonna
(`setDisabled`), e da una superficie non si apre Impostazioni › Componenti
su una riga (la scheda si sceglie solo con un clic: `selectTab` è privata in
`panels/settings.ts`).
Tocca: `apps/client/src/kit/tool-rail.ts`,
`apps/client/src/kit/tool-rail.test.ts`, `apps/client/src/ui/commands.ts`,
`apps/client/src/ui/commands.test.ts`, `apps/client/src/panels/settings.ts`,
`apps/client/src/panels/settings.components.test.ts`
Non toccare: `editors/` (la usa T23); le righe dei componenti e ciò che
fanno (si apre quella che c'è); `kit/index.ts` se il tipo esportato non
cambia nome.
Dipende da: risposta D-8 (non dal motore)
Cosa fare:
- `kit/tool-rail.ts`: `RailTool` prende `disabled?: boolean`; il pulsante e
  la voce della tendina spenti, con la `description` come suggerimento;
  `setDisabled` resta e vince (spegne tutto).
- `ui/commands.ts`: una porta come `registerDrawingImport`:
  `registerComponentRow(open: (id: string) => void)` e `showComponent(id):
  boolean` (falso se nessuno l'ha registrata).
- `panels/settings.ts`: in `mountSettings` la registra (e la toglie alla
  chiusura): apre il pannello, sceglie la scheda `"components"`, porta in
  vista la riga `id` e la tiene ferma come `pinnedRow`; un `id` sconosciuto
  apre la scheda e basta.
Casi limite: una tendina con tutti gli strumenti spenti (la casella è spenta);
lo strumento attivo spento (la colonna lo mostra spento; chi lo usa, T23,
sceglie un altro strumento); il pannello già aperto su un'altra scheda (cambia
scheda, l'anteprima del tema si annulla come oggi in `selectTab`); due
registrazioni (vince l'ultima, come `registerDrawingImport`).
Fatto quando: `tool-rail.test.ts` dice che uno strumento con `disabled` ha
il pulsante spento e il suggerimento, e che gli altri no;
`settings.components.test.ts` dice che `showComponent("fub.search")` (una
riga che i suoi finti hanno già) apre la scheda Componenti con quella riga
in vista; `commands.test.ts` dice che senza
registrazione `showComponent` dà `false`.
Prova: scripts/check.sh --rapido --client; npm --prefix apps/client test -- src/kit/tool-rail.test.ts src/ui/commands.test.ts src/panels/settings.components.test.ts
Stato: [ ] da fare
