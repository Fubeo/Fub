# Piano: N6 · La lavagna v1

Branch: piano/n6-lavagna
Obiettivo: sulla lavagna una scheda mostra il contenuto vero del suo file:
la nota resa, le celle del foglio, la pagina del PDF, l'immagine, la pagina
web; ci si entra per scorrere, scegliere e copiare, e la penna (N4) ci scrive
sopra. Si trascinano note e file dall'albero e dal computer: i file esterni
si copiano nel vault una volta sola e nascono in griglia sotto il puntatore.
La lavagna resta fluida perché vivono solo le schede in vista; le altre
mostrano un'immagine ferma.
Perché: oggi una scheda di file è un segnaposto («KIND · percorso» e un link,
`#cardBody` in `apps/client/src/editors/canvas/engine.ts`), anche per una
nota `.md`; dall'albero nasce una scheda di testo col percorso, perché
`resolvePaths` non è collegato (`state/document-controller.ts`). La lavagna
è il centro del lavoro di studio (`riferimenti/lavagna.md`) solo se mostra
ciò che ci si mette.
Fuori scope (D-1 (b): dentro c'è tutta la v1 di `lavagna.md`, «Le tappe ›
v1»; fuori resta ciò che `lavagna.md` segna v2 o v3): i link delle note come
fili (D9); le viste salvate e la presentazione (B6, I1); «Metti in ordine»
(E7), «Riassumi in una nota» (I4), l'esportazione (I5); gli agenti, la riga
di comando e MCP (J, R8); la cronologia nell'ispettore (L2); collegare con la
penna (D3); la forma del filo (D6); chiudere un gruppo (C9 v2); bloccare
(C12); scegliere i simili (E3); audio e video (C6); una lavagna dentro una
lavagna (G5, H5); dal browser (G4); la lavagna da una cartella e i modelli
(A3, A4); le istantanee su disco e le 10 000 schede (A8, N2, N5); le ancore
ai blocchi; gli estratti di blocchi delle note, di fogli, documenti Word,
pagine web e lavagne, le citazioni, «Mostra anche nel PDF», le fonti che
cambiano, la figura come file, i blocchi uniti in una zona, dalla fonte
alla lavagna oltre la pagina, «su 2 lavagne» nel visore (S v2, S13, S14 v2,
S15, S7 v2, S6 v2, S12 v2, S16 v2); il testo del PDF da scegliere e
copiare (C4 v2); la modifica dei Word, della struttura dei fogli e di una
sezione sola (T v2, S8 v2); «Incolla come foglio» (G3 v2); l'immagine delle
pagine web (C7 v2); R6, R7, R9–R13; K3, K4, K5; F12; B8; I2; I3; M3; «Apri
nel disegno completo» (K6); il formato `fub:ink` e la prova con Obsidian
(N4); la CI (i coder non la toccano: CLAUDE.md); il vault vero.
Assunzioni: A-1…A-14 decise dal pianificatore il 2026-11-02 di notte, poi
riviste con le risposte dell'utente a D-1…D-19 (2026-11-02); A-15…A-29
nate dalle risposte e dai consigli di `lavagna.md` per le sue domande
aperte. N6 va avanti sopra il ramo di N4, non sopra `main` (A-15). Restano
tre domande nuove, D-20, D-21 e D-22: i task che le aspettano lo dicono.
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 T9 | T10 | T11 T25 | T26 T29 | T27 T12 | T28 T13 | T30 T14 | T24 T31 | T15 T20 | T33 T16 | T32 T19 | T48 T73 | T34 T37 | T17 | T40 T47 | T39 T21 | T38 | T41 | T42 | T43 | T44 | T35 T46 | T53 | T36 | T54 | T49 | T50 | T45 | T51 | T52 | T55 | T56 T65 | T57 | T58 T68 | T59 | T60 | T61 | T62 | T63 | T64 | T66 | T67 | T69 | T70 | T71 | T72 | T74 | T75 | T76 | T77 | T78 | T22 | T86 | T87 | T89 | T23 | T18 | T79 | T80 T88 | T81 | T82 | T83 | T84 | T85 | T90
Prototipo: quattro pagine; approvate la prima (T25) e la seconda (T26).
`PLAN-ui/lavagna-schede.html` (T25): fatta il 2026-11-04, Approvato: 2026-11-04,
con le varianti consigliate.
`PLAN-ui/lavagna-impianto.html` (T26): fatta il 2026-11-09, Approvato: 2026-11-10,
con le varianti consigliate.
`PLAN-ui/lavagna-modifica.html` (T27), `PLAN-ui/lavagna-estratti.html`
(T28): da fare. Ognuna la
costruisce un coder con `.claude/skills/pianifica/prototipo.md` e la fa
vedere l'orchestratore all'utente, finché non dice sì; nessun task
grafico che ne dipende parte prima della riga «Approvato» (A-26).

## Modifiche

- 2026-11-03 · Le risposte dell'utente a D-1…D-19 (2026-11-02): la v1
  intera di `lavagna.md` (D-1 (b)); la cartella dei file trascinati con
  un'impostazione sua (D-2 (d)); «già nel vault» vuol dire lo stesso
  contenuto ovunque (D-3 (b)); la pagina del PDF nello stato della vista
  (D-5 (c)); l'inchiostro attaccato alle celle (D-6 (b)); si scrive dentro
  le schede (D-7 (b)); la misura nuova S9 accanto a S3 (D-8 (b)); i sei
  colori e in più ogni colore esatto (D-13 (c)); il CSV aspetta il motore
  dei fogli (D-16 (c)); l'impostazione della rotella (D-17 (b)); Ctrl+clic
  apre un link (D-18 (c)); il foglio nasce 480×300 (D-11 (a), correzione).
  Con merge-n3n4 (b) N6 va avanti sopra il ramo di N4. · Perché: l'utente ha
  risposto. · Task: nuovi T24–T90; cambiati T11, T12, T13, T14, T15, T17,
  T19, T20, T21, T22, T23; «Da rivedere» su T1, T3, T4, T5, T6, T7, T9,
  T10.

## Dal prototipo

Le pagine di T25 (2026-11-04) e di T26 (2026-11-10) sono approvate;
quelle di T27 e T28 non ci sono ancora. Ogni parte visibile riusa un pezzo che c'è già; la tabella dice
dove finisce e chi la fa. I task fino a T21 usano le classi di oggi e la
sola struttura che serve a funzionare (`structure.css`); l'aspetto vero
lo danno i task che dipendono dal loro prototipo. Quando un prototipo è
approvato, l'orchestratore (T25–T28) aggiunge qui le classi nuove che la
pagina usa, una riga per pezzo, con il file e il task.

| Pezzo | Destinazione | Task |
|---|---|---|
| Il corpo di ogni specie di scheda | `apps/client/src/editors/canvas/cards/*.ts`, `apps/client/src/editors/grid/card.ts` | T4–T8 |
| La scheda ferma (istantanea) e quella da lontano | i renderer, con `data-card-mode` sul `.canvas-node` | T4–T8, T13 |
| La scheda attiva (bordo d'accento, «Esc per uscire») | `engine.ts`, `structure.css`; aspetto in `skin/editors.css` | T14, T22 |
| Il fantasma delle schede mentre si trascina | `engine.ts`, `drop-layout.ts`, `structure.css` | T15, T22 |
| Le notifiche «Già nel vault, uso quello» e «Cambia cartella» | `notify` di `ui/notify.ts`, testi in `catalog.ts` | T10 |
| La scheda «File mancante» con «Ritrova…» e «Togli dalla lavagna» | `engine.ts`, `canvas-media-placeholder` e i pulsanti del kit | T16, T22 |
| Il menu della scheda, con la testata | il menu contestuale di `engine.ts` (`SurfaceMenu`) | T17 |
| Le testate con «↩ 2» e «×2» | `engine.ts` (testata di oggi, `canvas-node-title`) | T22 |
| Classi nuove dell'aspetto | `apps/client/src/theme/scrittoio/skin/editors.css` e `anatomia/editors.ts` | T22 |
| Il titolo sopra la scheda di file (D-21) | `engine.ts` (`#nodeEl`), `structure.css`, `skin/editors.css` | T25, T39 |
| La notifica «Già nel vault» con «Fanne una copia» | `ui/notify.ts`, testi in `catalog.ts` | T25, T32 |
| Le righe di «Impostazioni › Lavagna» | `crates/fub-features/src/lavagna.rs` (le disegna `panels/settings.ts`) | T25, T33 |
| Il menu dei colori: sei colori, «Colori delle note», «Altro…» | `editors/canvas/colors.ts` (nuovo), `engine.ts`, `kit/color/` | T25, T47 |
| La scheda da lontano (due livelli) | `editors/canvas/lod.ts` (nuovo), `skin/editors.css` | T25, T54 |
| Le maniglie, i quattro punti, il filo al passaggio, l'etichetta «Si attacca a…» | `engine.ts`, `structure.css`, `skin/editors.css` | T25, T66, T67, T69 |
| La colonna degli strumenti, la riga delle opzioni, la barra della selezione, la banda | `editors/canvas/chrome/*.ts` (nuovi), `kit/tool-rail.ts`, `kit/options-bar.ts` | T26, T49–T52 |
| Il navigatore, il lampo di un link seguito, l'ispettore, la ricerca, la lavagna vuota, il menu radiale, lo spazio Semplice | `editors/canvas/chrome/*.ts`, `engine.ts`, `skin/editors.css` | T26, T55, T57–T65 |
| La modifica dentro le schede, «Apri a lato per questo» | `state/card-editors.ts` (nuovo), `editors/canvas/cards/*.ts`, `editors/grid/card.ts` | T27, T41–T45 |
| Il selettore, la scheda-estratto, il lettore, le fonti, il ritaglio di un'immagine | `editors/canvas/parts-picker.ts`, `excerpt.ts`, `reader.ts`, `sources.ts`, `crop.ts` (nuovi) | T28, T74–T78, T80–T85 |
| La pagina di prodotto | `docs/product/lavagna.md` (nuovo) | T23 |

Le classi nuove di `PLAN-ui/lavagna-schede.html` (T25, approvata il
2026-11-04 con le varianti consigliate; se l'utente cambia una scelta, si
correggono qui). Ogni blocco `<style>` della pagina dice il suo file; il CSS
nuovo passa da `sanitizeThemeCss`. Ogni classe va anche negli agganci di
`anatomia/editors.ts`.

| Pezzo | Destinazione | Task |
|---|---|---|
| Specie e modo della scheda: `data-card-kind`, `data-card-mode` (`snapshot`, `live`), il nome «Scheda di {kind}, {name}» | `engine.ts` (`#nodeEl`), i renderer di `cards/*.ts` | T11, T13, T61 |
| Le schede di oggi nel tema: `canvas-card-note`, `-note-content`, `-image`, `-picture`, `-pdf`, `-pdf-page`, `-pdf-status`, `-pdf-previous`, `-pdf-next`, `-sheet`, `-web`, `-web-title`, `-web-description`, `-web-site`, `-web-host`, `-web-domain`, `-web-actions`, `-web-preview`, `canvas-node-file`, `canvas-node-link`, `canvas-node-title`, `canvas-edge` (il codice le ha, il tema no) | `skin/editors.css`, `anatomia/editors.ts` | T22 |
| La scheda di file (CSV, audio): `canvas-media-placeholder` col tipo e il percorso, «Apri» | `skin/editors.css` | T22 |
| Il titolo sopra (D-21 (a)): la testata di `canvas-node-file` e `canvas-node-link` fuori dal bordo; il contenuto isolato (`isolation`) sotto le maniglie | `structure.css`, `skin/editors.css` | T39 |
| La testata: `canvas-node-cites` («↩ 2»), `canvas-node-twins` («×2»), le gemelle illuminate `data-card-twin` | `engine.ts`, `structure.css`, `skin/editors.css` | T22 |
| La scheda attiva: `data-card-active`, `canvas-exit-hint` («Esc per uscire») al posto di → | `engine.ts`, `structure.css`, `skin/editors.css` | T14, T22 |
| Il fantasma del rilascio: `canvas-drop-ghost`, `canvas-drop-ghost-group`, `canvas-drop-ghost-name` | `engine.ts`, `structure.css`, `skin/editors.css` | T15, T22 |
| File mancante: `canvas-card-missing`, `canvas-card-missing-actions` (con `data-card-state="missing"`) | `cards/*.ts`, `structure.css`, `skin/editors.css` | T16, T22 |
| La scheda Craft: `canvas-card-craft`, `canvas-card-craft-actions` («Apri», «Apri con…») | `cards/craft.ts`, `structure.css`, `skin/editors.css` | T18 |
| I colori: `data-canvas-color` (1–6, i nove nomi delle note, `custom`), `--canvas-paper`, `--canvas-color`, l'anello sopra foto, PDF, Craft e foglio; il pallino `menu-swatch` del menu | `editors/canvas/colors.ts`, `engine.ts` (via lo stile in linea), `structure.css`, `skin/editors.css`, `skin/menus.css` | T47 |
| Da lontano: `canvas-node-far`, `data-card-detail` (`far`, `block`), `--canvas-zoom` | `editors/canvas/lod.ts`, `structure.css`, `skin/editors.css` | T54 |
| Le maniglie: `canvas-resize` con `data-corner` | `engine.ts`, `structure.css`, `skin/editors.css` | T66 |
| I quattro punti e il filo al passaggio: `canvas-port` con `data-side`, `canvas-edge` con `data-hover` | `engine.ts`, `structure.css`, `skin/editors.css` | T67 |
| L'etichetta «Si attacca a…»: `canvas-ink-label` (`data-free` se il tratto resta libero), la scheda bersaglio `data-ink-target` | `engine.ts`, `structure.css`, `skin/editors.css` | T69 |

Le classi nuove di `PLAN-ui/lavagna-impianto.html` (T26, fatta il
2026-11-09, Approvato: 2026-11-10, con le varianti consigliate). Le
regole segnate «come .draw-…» copiano i valori del disegno di oggi con i
nomi della lavagna: `editors/spatial/` non si tocca (K5). Il blocco
→ `skin/editors.css` passa `sanitizeThemeCss` senza scarti; gli avvisi
«hook non dichiarato» spariscono quando le classi entrano in
`anatomia/editors.ts`. Ogni classe va anche lì.

| Pezzo | Destinazione | Task |
|---|---|---|
| La testata: `canvas-header`, `canvas-top`, `canvas-group`, `canvas-button` (con `data-label` se ha un nome scritto), `canvas-options`, `canvas-options-item`, `canvas-options-hint`; la superficie misura sé stessa (`container-type`) e si stringe con `data-narrow` | `editors/canvas/chrome/header.ts` (nuovo), `kit/options-bar.ts`, `structure.css`, `skin/editors.css` | T49, T50 |
| Il menu delle penne di N4 nella riga delle opzioni: `canvas-ink-pen` prende `canvas-button` e il suo stato aperto in `.canvas-options` | `editors/canvas/chrome/header.ts`, `skin/editors.css` | T50 |
| La colonna: `canvas-body`, `canvas-rail`, `canvas-tool`, `canvas-rail-finger` («Il dito scrive»), `canvas-rail-full` («Completo» nello spazio Semplice), `canvas-area`; le tendine sono `kit-rail-popover` di oggi; uno strumento spento in sola lettura `aria-disabled` | `editors/canvas/chrome/rail.ts` (nuovo), `kit/tool-rail.ts`, `structure.css`, `skin/editors.css` | T49, T64, T65 |
| Le icone nuove `canvas-lasso`, `canvas-connect`, `canvas-finger`; Testo usa `fmt-text`, le punte dei fili `draw-tip-*` (con `ensureDrawIcons`) | `ui/icons.ts` (o il registro delle icone della lavagna) | T49, T50 |
| La barra della selezione: `canvas-selection-bar`, il posto scritto dalla tela come `bubblePlace` | `editors/canvas/chrome/selection-bar.ts` (nuovo), `structure.css`, `skin/editors.css` | T51 |
| La banda: gli `status-item` di oggi con `data-surface-item` (`zoom`, `chosen`, `twins`, `readonly`, `folder`); la cartella lunga si accorcia | `editors/canvas/chrome/band.ts` (nuovo), `structure.css` | T52 |
| Senza interfaccia (Ctrl+.): `data-bare` sulla superficie | `engine.ts`, `structure.css` | T65 |
| Il navigatore: `canvas-navigator` con una sola `<canvas>` `canvas-navigator-map` | `editors/canvas/chrome/navigator.ts` (nuovo), `structure.css`, `skin/editors.css` | T55 |
| La ricerca (Ctrl+F): `canvas-find`, `canvas-find-input`, `canvas-find-count` (`data-none`), `canvas-find-mark`; le schede `data-card-found` (`current`) e `data-card-veiled` | `editors/canvas/chrome/find.ts` (nuovo), `engine.ts`, `structure.css`, `skin/editors.css` | T60 |
| La lavagna vuota: `canvas-blank`, `canvas-blank-lines`, `canvas-blank-actions` (con «Incolla»), i pulsanti del kit | `editors/canvas/chrome/blank.ts` (nuovo), `structure.css`, `skin/editors.css` | T62 |
| L'ispettore: `canvas-inspector`, `-filter`, `-heading`, `-list`, `-row` (`data-group`, `data-depth`), `-name`, `-kind`, `-numbers` (i `kit-number`), `-fields`, `-field` (`data-wide`), `-path`, `-raw` (`tr[data-locked]`), `-note`, `-actions`; il pallino del colore è `kit-color-well` | `editors/canvas/chrome/inspector.ts` (nuovo), `structure.css`, `skin/editors.css` | T58, T59, T61 |
| Le fonti nell'ispettore: `canvas-sources-file`, `-head`, `-name`, `-count`, `-bar`, `-piece` (`data-used`) | `editors/canvas/sources.ts`, `structure.css`, `skin/editors.css` | T77 |
| Il menu radiale e Ctrl+/: le classi `draw-radial-*` e `draw-commands-dialog` così come sono | `editors/spatial/` (si riusa, non si tocca), `engine.ts` | T48, T63 |
| Lo spazio Semplice: `data-workspace="simple"` sulla superficie, caselle da 44 px | `editors/canvas/chrome/rail.ts`, `structure.css` | T65 |
| La notifica «Tolta dalla lavagna. Il file resta.» con «Annulla» | `ui/notify.ts`, testi in `catalog.ts` | T17 |
| I testi nuovi `canvas.*` della pagina | `apps/client/src/i18n/catalog.ts` | T49–T65 |

## Che cosa si vede

Nessun pezzo nuovo del kit: tutto è fatto con ciò che la shell ha già.
L'aspetto preciso (misure, colori, ombre) si decide coi prototipi T25–T28
(D-10 (a): bordo d'accento, «Esc per uscire», testata con «↩ 2» e «×2»).
Ciò che segue è la prima versione; dove le risposte dell'utente l'hanno
cambiata, lo dice tra parentesi.

- **La scheda di nota** (un `.md`, e anche un `.docx` o un `.odt`, D-14).
  La testata è quella di oggi (titolo e →). Sotto, la nota resa come
  nell'anteprima delle note, con titoli, elenchi, immagini e formule,
  tagliata alla misura della scheda; se continua, un'ombra in fondo lo dice.
  Con un `subpath` (`Nota#Titolo`) si vede solo quella sezione. Un clic
  sceglie la scheda anche se cade su un link; Ctrl+clic (Cmd+clic su
  macOS) su un link lo apre subito (D-18 (c)); entrati nella scheda, i
  link si seguono e il testo si scorre e si seleziona. Doppio clic, o Invio
  con la scheda scelta, scrive dentro la nota con l'editor delle note, sulla
  stessa sessione del riquadro (D-7 (b), T41).
- **Il titolo delle schede di file** sta sopra la scheda, fuori dal suo
  rettangolo, come in Obsidian; la scheda è tutta contenuto (D-21, da
  decidere guardando il prototipo T25).
- **La scheda di foglio** (un `.xlsx`). Le celle del foglio attivo, con i
  colori del file e la carta del tema come nel foglio aperto, la riga e la
  colonna di intestazione; niente nastro, niente barra della formula,
  niente linguette dei fogli (D-10). La rotella sopra la scheda sposta la
  lavagna. Un clic dentro, o Invio con la scheda scelta, la rende attiva:
  bordo d'accento e «Esc per uscire»; allora la rotella scorre il foglio,
  il trascinamento sceglie le celle e Ctrl+C le copia (come testo a
  tabulazioni). Esc o un clic fuori esce. Doppio clic su una cella la
  modifica, valori e formule, con l'editor del foglio sulla stessa sessione
  (D-7 (b), T42); righe, colonne e formati restano dell'editor intero
  («Apri a lato per questo», T45). Un tratto a penna sopra le celle segue
  la cella quando il foglio scorre (D-6 (b), T38).
- **La scheda PDF.** Una pagina alla volta, intera dentro la scheda (A-20),
  con «3 / 24» in basso; al passaggio, ‹ e › ai lati; con la scheda scelta
  PgSu e PgGiù cambiano pagina. Si parte dalla pagina dove eri (lo stato
  della vista, D-5 (c), T36), sennò da quella del `subpath` (`#page=3`),
  sennò dalla prima; sfogliare non cambia il file. L'inchiostro sopra resta
  sulla sua pagina (D-4 (a), T19).
- **La scheda d'immagine** (PNG, JPG, WebP, GIF, SVG). L'immagine intera,
  con le sue proporzioni, dentro la scheda; il doppio clic apre il visore
  (`ui/lightbox.ts`). Un SVG è un'immagine ferma, mai il disegno vivo.
- **La scheda di pagina web.** Come oggi: indirizzo e dominio, mai la
  pagina. In più «Mostra l'anteprima», che chiede titolo, sito e
  descrizione con la stessa richiesta delle schede di link delle note (e il
  suo permesso di rete); dopo, si vedono quelli. Senza rete: solo indirizzo
  e dominio, niente rosso.
- **La scheda di file** (CSV finché il motore dei fogli non li legge: D-16
  (c), D-20; ZIP, audio, video, `.canvas`, i file Craft finché N7 non c'è,
  ogni formato con il componente spento): il segnaposto di oggi, «SPECIE ·
  percorso» e «Apri».
- **Da lontano** (D-12 (a), A-22). Fra lo zoom 0,15 e 0,35 la scheda mostra
  l'ultima immagine ferma che ha avuto, o il suo titolo grande se non l'ha
  mai avuta; sotto 0,15 un blocco del suo colore col titolo grande.
  Spostandosi, le schede che entrano in vista si accendono quando il gesto
  finisce, non durante.
- **I colori** (D-13 (c), T47). Nel menu, nella barra della selezione e
  nell'ispettore: i sei colori di JSON Canvas col loro nome; «Colori delle
  note», i nove dei Blocchi; «Altro…» col selettore del kit. Le lavagne che
  ci sono si vedono come prima.
- **L'impianto** (T26, T49–T65): la colonna degli strumenti a sinistra, la
  riga delle opzioni in alto, la barra della selezione sopra ciò che è
  scelto, la banda di stato, il navigatore in basso a destra, l'ispettore,
  la ricerca (Ctrl+F), la lavagna vuota che spiega da sé, il menu radiale,
  lo spazio Semplice: come il prototipo T26.
- **Gli estratti** (T28, T73–T85): il selettore attaccato alla scheda, la
  scheda-estratto, il lettore da vicino, le fonti nell'ispettore. Per le
  note e le immagini subito; per i PDF quando c'è PdfCraft (A-24).
- **La scheda «File mancante».** Grigia: «File mancante: Statistica/voti.xlsx»,
  con «Ritrova…» (cerca per nome nel vault, propone per primo lo stesso
  nome) e «Togli dalla lavagna».
- **Trascinare.** Mentre si trascina sopra la lavagna, rettangoli
  tratteggiati mostrano dove nasceranno le schede (uno per elemento, in
  griglia, a partire dal puntatore). Al rilascio nascono lì, in ordine di
  nome; oltre 12 elementi finiscono in un gruppo «47 file», già scelto.
  Dal computer: la prima volta una notifica dice dove sono andati i file
  («Copiati in attachments/») con «Cambia cartella», che apre la voce
  «Dove vanno i file trascinati» della lavagna (D-2 (d), T34); un file con lo
  stesso contenuto di un file del vault, anche con un altro nome e in
  un'altra cartella: «Già nel vault, uso quello», con «Fanne una copia»
  (D-3 (b), T32).
- **Incollare.** Sotto il puntatore se è sulla lavagna, sennò al centro
  della vista. Celle copiate da un foglio: una scheda di testo con una
  tabella Markdown.
- **Il menu della scheda** (tasto destro). Testata «Scheda di foglio ·
  voti.xlsx»; poi Apri, Apri a lato, Collega… (C); Colore › (i sei colori
  in T17, il resto in T47); Disponi › (Davanti, Dietro, Allinea,
  Distribuisci); Duplica (Ctrl+D); in fondo, rosso, «Togli dalla lavagna»
  (Canc), perché il file resta nel vault, e «Sposta anche il file nel
  cestino».

## Fonti

- Il passo 15 (N6) dei «Piani di Fub», le regole e i rischi
  (`01-regole-e-decisioni.md`, `03-rischi-e-domande.md`), `riferimenti/lavagna.md`
  (aree C, G, N, P, le tappe e le domande aperte) e `riferimenti/tasto-destro.md`
  (il menu «Scheda della lavagna»). I coder non li leggono: qui c'è ciò che
  serve, e dove il codice dice altro vince il codice (sezione «Differenze
  dal passo 15 e da `lavagna.md`»).
- I piani su cui N6 poggia, letti e non cambiati: N3 (`piano/n3-logica-in-rust`
  @ 7a27eeca: fatti T1–T8), N4 (`piano/n4-inchiostro` @ ae7e299a: fatti
  T1–T7 e T9), N7 (`piano/n7-file-craft` @ b718e196), K3 (`piano/k3-motori`),
  K5 (`piano/k5-disegno`, solo il piano). Riletti con le risposte, il
  2026-11-03: N3 @ 16e3ae76 (T16, T19–T22), N4 @ 44647c9c (T18, T19, T21,
  T23 e «Un nodo con N6»; il prototipo delle penne approvato, lo spessore a
  cursore), K5 @ e66a5669 (A3, D-11, D-12), N7 @ a04094f5 (il suo
  pianificatore ci lavora in questo momento), `riferimenti/pdfcraft.md`
  (P1, P2, P4).
- Riletto per D-1 (b): tutto `riferimenti/lavagna.md` (le aree A–T, «Il
  pigro alla prova», «Tasti», «Le tappe», le domande aperte).
- Il codice letto, su `main` @ 620f0acd: `editors/canvas/` (`engine.ts`,
  `surface.ts`, `engine.test.ts`), `editors/core/bootstrap.ts`,
  `state/document-controller.ts`, `editors/media/` (`attachment-target.ts`,
  `resource-port.ts`, `image-view.ts`, `pdf-view.ts`, `media-types.ts`),
  `editors/grid/` (`engine.ts`, `paint.ts`), `crates/fub-host/src/session.rs`
  (`grid_bytes_open`), `crates/fub-host/src/resources.rs`,
  `crates/fub-abi/src/grid_bytes.rs`, `ui/` (`format-kind.ts`, `lightbox.ts`,
  `notify.ts`, `drag-types.ts`, `sanitize.ts`), `host/query.ts`
  (`renderEmbed`, `existingDocuments`), `state/link-cards.ts`,
  `panels/settings.ts`, `panels/explorer.ts`, `bench/webview/`, i presidi in
  `.github/scripts/`; su N4: `ink/quiet.ts` (`PenQuiet.defer(key, work)`),
  `editors/canvas/ink-record.ts`, `anchor.ts`, `docs/reference/canvas-ink.md`.

## Chi aspetta chi

| Task N6 | Parte subito? Dopo quali task di N6 | Aspetta in altri piani | Aspetta una risposta |
|---|---|---|---|
| T1 · il contratto delle schede | subito | nessuno | D-1 (l'elenco delle specie) |
| T2 · la cache delle immagini ferme | subito | nessuno | nessuna |
| T3 · lo stesso file non si duplica | subito | nessuno | D-3 |
| T4 · la scheda di nota | dopo T1, T2 | nessuno | D-14 |
| T5 · la scheda d'immagine | dopo T1, T2 | nessuno | nessuna |
| T6 · la scheda PDF | dopo T1, T2 | nessuno | D-5 |
| T7 · la scheda di foglio | dopo T1, T2 | nessuno | D-6, D-7 |
| T8 · la scheda di pagina web | dopo T1 | nessuno | nessuna |
| T9 · dove nascono le schede | dopo T1 | nessuno | D-11 |
| T10 · le porte per portare dentro | dopo T3 | nessuno (N7 T17 e K5 T24 toccano gli stessi file: chi si fonde dopo ricuce) | D-2, D-3 |
| T11 · la tela tiene le schede | dopo T1 | la base di N4 (sotto) | nessuna |
| T12 · il collegamento | dopo T4–T8, T10, T11 | N3 T16 (nella base) | nessuna |
| T13 · vive solo le utili | dopo T11 | N4 T2 e T12 (nella base) | nessuna |
| T14 · entrare e uscire | dopo T12, T13 | nessuno oltre la base | D-18 (c) data |
| T15 · trascinare e incollare | dopo T9, T12, T14, T29 | nessuno oltre la base | nessuna |
| T16 · il file mancante | dopo T15 | nessuno oltre la base | nessuna |
| T17 · il menu della scheda | dopo T16, T48 | nessuno oltre la base | nessuna |
| T18 · la scheda dei file Craft | dopo T12 | N7 T14 e T16; K5 T24 per «Accendi…» | nessuna |
| T19 · l'inchiostro sulla pagina del PDF | dopo T6, T13 | N4 T8–T12 (nella base) | D-4 (a) data |
| T20 · la misura S9 | dopo T13, T14 | N3 T15, N4 T15 (nel ramo); K3 T9 se è in `main` | nessuna |
| T21 · la prova del cancello | dopo T15, T17, T32, T34 | N4 T12 (nella base) | nessuna |
| T22 · l'aspetto | dopo T21, T25 | nessuno | il prototipo T25 |
| T23 · la pagina di prodotto | dopo T22, T89 | nessuno | nessuna |
| T24 · la seconda misura di N4 | dopo T13 | N4 T15 e il commit di N4 T23 | nessuna |
| T25–T28 · i quattro prototipi | subito | nessuno | il sì dell'utente; D-21 in T25 |
| T29 · il foglio 480×300 | subito | nessuno | nessuna |
| T30 · lo stesso contenuto, l'host | subito | nessuno | nessuna |
| T31 · lo stesso contenuto, l'IPC | dopo T30 | nessuno | nessuna |
| T32 · la lavagna riusa | dopo T31, T25 | nessuno | nessuna |
| T33 · le impostazioni, seconda parte | dopo T25 | N4 T19 (nella base) | nessuna |
| T34 · dove vanno i file | dopo T32, T33 | nessuno | nessuna |
| T35 · la rotella | dopo T14, T33 | nessuno | nessuna |
| T36 · riaprire dove eri | dopo T13, T14 | nessuno | nessuna |
| T37 · l'ancora alle celle, il formato | dopo T19 | nessuno | nessuna |
| T38 · il tratto segue la cella | dopo T37, T14 | nessuno | nessuna |
| T39 · il titolo sopra, l'inchiostro sul contenuto | dopo T19, T25 | N4 T18 (nella base) | **D-21** (col prototipo) |
| T40 · la porta per scrivere dentro | dopo T12 | nessuno | nessuna |
| T41 · scrivere in una nota | dopo T40, T27, T14 | nessuno | nessuna |
| T42 · scrivere nelle celle | dopo T41, T27 | nessuno | nessuna |
| T43 · la scheda di testo in Live | dopo T41, T27 | N3 T16, T19 (nella base) | nessuna |
| T44 · la scheda di testo cresce | dopo T43 | nessuno | nessuna |
| T45 · «Apri a lato per questo» | dopo T41, T42, T50 | nessuno | nessuna |
| T46 · le misure dopo la modifica | dopo T20, T41–T44 | nessuno | nessuna |
| T47 · i colori | dopo T17, T25 | nessuno | nessuna |
| T48 · il catalogo dei comandi | dopo T16 | nessuno | nessuna |
| T49 · la colonna degli strumenti | dopo T26, T48 | nessuno | nessuna |
| T50 · la riga delle opzioni | dopo T49 | N4 T21 (nella base) | nessuna |
| T51 · la barra della selezione | dopo T50, T47 | nessuno | nessuna |
| T52 · la banda di stato | dopo T49 | nessuno | nessuna |
| T53 · spostare e ingrandire | dopo T35 | N4 T14 (nella base) | nessuna |
| T54 · i livelli di dettaglio | dopo T53, T25 | nessuno | nessuna |
| T55 · il navigatore | dopo T53, T36, T26 | nessuno | nessuna |
| T56 · Indietro e Avanti | dopo T55 | nessuno | nessuna |
| T57 · seguire un link | dopo T56, T14 | nessuno | nessuna |
| T58 · l'ispettore, le schede | dopo T26, T49 | nessuno | nessuna |
| T59 · l'ispettore, la scheda | dopo T58, T47 | nessuno | nessuna |
| T60 · cerca nella lavagna | dopo T56, T26 | nessuno | nessuna |
| T61 · tastiera e lettore di schermo | dopo T58, T48 | nessuno | nessuna |
| T62 · la lavagna vuota | dopo T26, T48 | nessuno | nessuna |
| T63 · il menu radiale e i gesti | dopo T48, T26, T33 | N4 T14 (nella base) | nessuna |
| T64 · il dito scrive | dopo T49, T33 | N4 T14 (nella base) | nessuna |
| T65 · lo spazio Semplice | dopo T49–T51, T33 | nessuno | nessuna |
| T66 · ridimensionare | dopo T25 | nessuno | nessuna |
| T67 · i fili | dopo T25 | N3 T20 (nella base) | nessuna |
| T68 · copia e incolla le schede | dopo T15 | N3 T20 (nella base) | nessuna |
| T69 · a chi appartiene un tratto | dopo T25 | N4 T12 (nella base) | nessuna |
| T70 · convertire | dopo T17, T48 | nessuno | nessuna |
| T71 · le guide e la griglia | dopo T50, T33 | nessuno | nessuna |
| T72 · spargi le pagine | dopo T17, T48 | nessuno | nessuna |
| T73 · il formato degli estratti | sulla base di N4 (A-15) | N3 (il nucleo, nella base) | nessuna |
| T74 · il selettore delle sezioni | dopo T73, T48, T28, T33 | nessuno | nessuna |
| T75 · la scheda-estratto | dopo T74, T39 | nessuno | nessuna |
| T76 · leggere da vicino | dopo T75 | nessuno | nessuna |
| T77 · le fonti di questa lavagna | dopo T58, T75 | nessuno | nessuna |
| T78 · la zona di un'immagine | dopo T73, T51, T28 | nessuno | nessuna |
| T79 · la scheda PDF sui tasselli | dopo T39 | **PdfCraft P1** (nessun piano ancora) | nessuna |
| T80 · il selettore delle pagine | dopo T79, T74 | **PdfCraft P4** | nessuna |
| T81 · blocchi, zone e figure | dopo T80 | **PdfCraft P4** | nessuna |
| T82 · l'estratto di PDF | dopo T81, T75 | **PdfCraft P1 e P4** | nessuna |
| T83 · il lettore per i PDF | dopo T82, T76 | **PdfCraft P4** | nessuna |
| T84 · dalla fonte alla lavagna | dopo T82 | **PdfCraft P2** | nessuna |
| T85 · l'inchiostro sugli estratti | dopo T82, T19 | nessuno oltre T82 | nessuna |
| T86 · il lazo e l'inchiostro che si sposta | dopo T49, T69, T26 | K5 solo con D-22 (b) | **D-22** |
| T87 · forme e linee dritte | dopo T86 | K5 solo con D-22 (b) | **D-22** |
| T88 · la scheda CSV | dopo T7 | il lavoro che porta i CSV al motore dei fogli | **D-20** |
| T89 · il pigro alla prova | dopo T49–T72, T86, T87 | nessuno | nessuna |
| T90 · la CI e la revisione | dopo tutti | N3 e N4 in `main` | il sì al merge |

**La base di N4** (A-15). Con merge-n3n4 (b) N3 e N4 entrano in `main` solo
alla fine dei loro piani, e N4 T23 vuole la scheda di foglio viva di N6
(«Un nodo con N6» nel piano di N4). Per questo T1–T10 restano su `main`, e
da T11 N6 va avanti sopra `piano/n4-inchiostro` con fatti N4 T12, T13, T14,
T16, T21, T22 e ciò da cui dipendono (T17, T18, T19, T20): dentro c'è N3
fino a T22. L'orchestratore riallinea N6 a `piano/n4-inchiostro` prima di
T11, e di nuovo quando N4 o N3 fanno un task che N6 usa (N4 T15 per S9, N4
T23 e T24, N3 T23); se un riallineamento cambia `engine.ts` mentre un task
di N6 lo tocca, prima si finisce il task, poi si riallinea. N4 T23 si
misura su questo ramo (T24). K5 serve solo con D-22 (b); PdfCraft per
T79–T84, che aspettano un piano che non c'è ancora.

## Domande per l'utente (raccolte, non bloccano)

D-1…D-19 hanno la risposta dell'utente (2026-11-02), scritta sotto ognuna.
D-20, D-21 e D-22 sono nuove: le ha aperte la revisione del piano con le
risposte, e i task che le aspettano lo dicono.

- D-1 · Fin dove arriva la v1 (tutto il piano). (a) Consigliata: N6 è il
  passo 15 più le parti di `lavagna.md` che servono a quel lavoro: G1, G2,
  G3 senza «Incolla come foglio», G6; C2, C3 (in lettura), C4, C5, C7, C8
  (i Craft dopo N7), C14 (solo «×2» nella testata, T22), C15; N1, N3, N4 e
  la misura di N5 sulle 300 schede; il menu della scheda di
  `tasto-destro.md`. Fuori: le aree S (estratti) e T (modifica sul posto),
  la ricerca, il navigatore, la colonna degli strumenti, lo spazio
  Semplice, le 10 000 schede, i fili dai link, il testo che cresce fino a
  480 px (C1). (b) Tutta la v1 di `lavagna.md`. (c) Il passo 15 alla
  lettera, senza «File mancante», gruppo oltre 12 file e menu. Conseguenza:
  (b) è almeno il doppio dei task, e una metà aspetta K5 e PdfCraft, che
  sono bloccati dai mirror; (c) lascia buchi che chi usa vede subito (una
  scheda rotta senza spiegazione, 40 foto da raccogliere a mano).
  Risposta (2026-11-02): (b) — tutta la v1 di `lavagna.md`, divisa in task
  piccoli (T24–T90); le parti che aspettano PdfCraft (e K5, se D-22 è (b))
  si fanno quando arrivano, e N6 si chiude solo allora.
- D-2 · Dove vanno i file trascinati dal computer (T10, T15). (a)
  Consigliata: nella stessa cartella degli allegati delle note, l'impostazione
  `files.attachment-folder` che c'è già (di serie `attachments`, alla radice);
  «Cambia cartella» apre le Impostazioni su quella voce. Chi la vuole accanto
  alla lavagna scrive `./Allegati`, che il codice sa già fare
  (`folderForNote`). (b) Un'impostazione nuova «Impostazioni › Lavagna ›
  Dove metto i file trascinati», di serie `Allegati/` accanto alla lavagna,
  come dice `lavagna.md` (P). (c) Cambiare il valore di serie di
  `files.attachment-folder` in `./Allegati` per tutti. Conseguenza: (b) è
  un'impostazione nuova nell'host (`crates/fub-host/src/settings.rs`), cioè
  contratto pubblico: un task Rust in più, dopo la risposta; (c) cambia dove
  finiscono anche gli allegati delle note e quelli importati da Obsidian.
  Risposta (2026-11-02): (d) — un'impostazione della lavagna, «Dove vanno i
  file trascinati», che di serie segue la cartella degli allegati delle note
  e fra le scelte ha «Accanto alla lavagna»; le note non cambiano (T33,
  T34).
- D-3 · Quando un file «è già nel vault» (T3, T10). (a) Consigliata: quando
  nella cartella degli allegati c'è un file con lo stesso nome (o una delle
  varianti «nome 1.ext» che Fub crea) e gli stessi byte; vale per la
  lavagna, le note restano come oggi (un doppione diventa «nome 1.ext»).
  (b) Lo stesso contenuto ovunque nel vault, anche con un altro nome. (c)
  Come (a), anche nelle note. Conseguenza: (b) chiede un indice delle
  impronte nell'host, cioè un IPC nuovo; (a) non riconosce lo stesso file
  rinominato a mano.
  Risposta (2026-11-02): (b) — un file è «già nel vault» se un file
  qualsiasi del vault ha lo stesso contenuto, anche con un altro nome;
  l'impronta è un dato derivato, che si rifà dai file, e nel dubbio si copia
  (T30–T32).
- D-4 · L'inchiostro attaccato alla pagina di un PDF (T19). (a) Consigliata:
  un'ancora nuova `{"kind":"page","page":3,…}` nei campi `fub:ink` di N4,
  con i vettori in Rust e in TypeScript e un ADR: cambiando pagina il tratto
  sparisce con lei e torna tornandoci, come chiede C4. (b) In v1 l'inchiostro
  sopra un PDF è della scheda, sopra ogni pagina. Conseguenza: (a) cambia il
  formato su disco di N4, che altri programmi leggeranno: per questo T19
  aspetta la risposta e N4 fuso; con (b) i segni della pagina 3 restano
  sopra la pagina 4.
  Risposta (2026-11-02): (a) — un'ancora di pagina nei campi `fub:ink`: il
  tratto sparisce cambiando pagina e torna tornandoci (T19).
- D-5 · La pagina che una scheda PDF mostra (T6). (a) Consigliata: non si
  salva; si parte da `#page=N` del `subpath` se c'è, sennò dalla prima.
  (b) Si salva in un campo `fub:page` sulla scheda: riaprendo si torna dove
  si era. Conseguenza: con (b) ogni pagina sfogliata è una modifica del
  `.canvas` (un passo di annulla, un file che cambia anche per Obsidian), e
  un campo nuovo del formato.
  Risposta (2026-11-02): (c) — la pagina la ricorda Fub nello stato della
  vista di quella lavagna, su questo computer; il file non cambia (T36).
- D-6 · Le ancore alle celle (T7). (a) Consigliata: in v2, come dice
  `lavagna.md`; in v1 l'inchiostro sopra un foglio si attacca alla scheda
  (N4) e, scorrendo il foglio dentro la scheda, resta fermo. (b) Ora, come
  scrive il passo 15. Conseguenza: (b) è un'altra ancora del formato su disco
  e un task in Rust in più, dopo N4; con (a) chi scrive su una cella e poi
  scorre vede il tratto staccarsi dalla cella.
  Risposta (2026-11-02): (b) — i tratti sopra un foglio si attaccano alla
  cella e la seguono quando il foglio scorre: un'ancora nuova, scritta in
  `docs/reference/canvas-ink.md` come quelle di N4 (T37, T38).
- D-7 · Scrivere dentro le schede (T14). (a) Consigliata: dopo N6, in un
  piano suo (area T); in v1 entrare in una scheda vuol dire leggere,
  scorrere, scegliere e copiare; per cambiare si apre il file («Apri», o
  Ctrl+clic sulla testata). (b) In N6: la nota con l'editor vero sulla
  stessa sessione (C2) e i valori del foglio (C3). Conseguenza: (b) porta
  CodeMirror e il giornale del foglio dentro la lavagna: almeno tre task in
  più, e la misura S3 va rifatta.
  Risposta (2026-11-02): (b) — si scrive dentro le schede di nota e di
  foglio (valori e formule) in N6, con l'editor vero sulla stessa sessione;
  le misure di velocità si rifanno dopo (T40–T46).
- D-8 · Lo scenario S3 (T20). (a) Consigliata: S3 cambia come dice il
  cancello: 20 schede di foglio vive (20 `.xlsx` in un blocco, guardati a
  zoom 0,5), le 20 note restano come schede di nota, le soglie della CI si
  ritarano dopo la prima misura sul runner. (b) Uno scenario nuovo accanto
  a S3, che resta com'è. Conseguenza: (a) interrompe la serie delle misure
  di S3 (la pagina in `docs/misure/` lo dice); (b) tiene la serie ma il
  cancello guarda un nome nuovo, e il banco cresce di un giro.
  Risposta (2026-11-02): (b) — S3 resta com'è e nasce lo scenario S9, con 20
  fogli veri vivi; il cancello guarda S9 (T20).
- D-9 · Windows e macOS (il cancello). (a) Consigliata: le misure le prendi
  tu sulle tue macchine col comando di `docs/development/webview-measurements.md`;
  il cancello resta aperto finché non ci sono. (b) Il cancello si chiude con
  la sola misura di Linux, e le altre due arrivano quando arrivano.
  Conseguenza: con (a) N6 non è finito finché qualcuno non lancia la misura
  su una macchina Windows e una macOS.
  Risposta (2026-11-02): (a) — le misure su Windows e macOS le prende
  l'utente; N6 resta aperto finché non ci sono.
- D-10 · L'aspetto della scheda attiva e delle testate (T14, T22). (a)
  Consigliata: bordo del colore d'accento e «Esc per uscire» in piccolo
  sopra la scheda; la testata con il titolo, «↩ 2» (quanti la citano) e
  «×2» (la stessa nota due volte); nella scheda di foglio solo il foglio
  attivo, senza linguette. (b) Altro, dal prototipo. Conseguenza: è solo
  aspetto; si decide col prototipo prima di T22.
  Risposta (2026-11-02): (a) — bordo d'accento e «Esc per uscire»; nella
  testata il titolo, «↩ 2» e «×2»; il prototipo si guarda comunque con
  l'utente prima di T22 (T25).
- D-11 · Quanto è grande una scheda appena nata (T9). (a) Consigliata: nota
  e documento 320×240, foglio 480×300, PDF 360 di larghezza con le
  proporzioni della prima pagina (360×480 finché non si sanno), immagine con
  il lato lungo di 480 e le sue proporzioni (C5), pagina web 320×120, file
  320×160 come oggi; in griglia con 24 px fra le schede. (b) Altre misure.
  Conseguenza: cambiano solo le costanti di `drop-layout.ts`.
  Risposta (2026-11-02): (a) — le misure del piano, e il foglio nasce
  480×300: il 304 di oggi è un errore e si corregge (T29).
- D-12 · La scheda da lontano (T13). (a) Consigliata: sotto lo zoom 0,35 una
  scheda mostra l'ultima immagine ferma che ha avuto in questa seduta; se
  non l'ha mai avuta, il titolo e la specie come oggi. (b) Sempre e solo
  titolo e specie da lontano. Conseguenza: (a) usa memoria (la cache di T2,
  64 MiB di partenza); (b) è più leggera ma da lontano tutte le schede si
  somigliano.
  Risposta (2026-11-02): (a) — da lontano la scheda mostra l'ultima immagine
  ferma che ha avuto (T13, T54).
- D-13 · I colori della scheda (T17). (a) Consigliata: in N6 restano i sei
  colori di oggi, nel menu come pallini; i nove colori dei Blocchi col loro
  nome (C10) arrivano dopo, insieme alle note. (b) I nove colori in N6.
  Conseguenza: (b) cambia l'aspetto di tutte le lavagne che esistono (il
  «Viola» di oggi è il colore d'accento) e scrive colori esadecimali nel
  file.
  Risposta (2026-11-02): (c) — i sei colori di JSON Canvas restano, e in più
  ogni colore esatto `#rrggbb`, compresi i nove dei Blocchi; le lavagne che
  ci sono non cambiano e Obsidian le apre uguali (T47).
- D-14 · DOCX e ODT (T4). (a) Consigliata: in v1 la scheda mostra
  l'anteprima di lettura che Fub sa già fare (la stessa delle note), non la
  prima pagina impaginata; la pagina vera quando il motore di videoscrittura
  la saprà dare. (b) Una scheda di file finché non c'è la prima pagina.
  Conseguenza: con (a) un documento lungo si vede come testo che scorre, non
  come foglio A4.
  Risposta (2026-11-02): (a) — un DOCX o un ODT mostra il testo, come una
  nota.
- D-15 · Il disegno spento (D-11 di K5, passato a N6). (a) Consigliata: se
  ne parla quando la lavagna avrà gli strumenti del disegno (K5): oggi la
  lavagna non usa il motore del disegno, e non le manca niente da dire. Per
  i file Craft con il componente spento, la scheda offre «Apri con» (N7) e,
  quando K5 T24 c'è, «Accendi…». (b) Ora una riga nella barra della lavagna
  che dice che gli strumenti del disegno arrivano col componente.
  Conseguenza: (b) annuncia una funzione che non c'è.
  Risposta (2026-11-02): (a) — non ora: la lavagna non usa il motore del
  disegno (con D-22 (b) se ne riparla).
- D-16 · I file CSV (T1). (a) Consigliata: in v1 un `.csv` è una scheda di
  file (nome e «Apri»), perché Fub non ha ancora un foglio per il CSV
  (`fub-format-xlsx` lo rifiuta). (b) Una scheda di foglio in sola lettura
  con un lettore CSV nuovo nel client. Conseguenza: (b) è codice nuovo che
  il motore dei fogli farà comunque, dopo.
  Risposta (2026-11-02): (c) — niente foglio provvisorio: la scheda CSV
  mostra nome e «Apri» finché il motore dei fogli non legge i CSV, poi il
  foglio vero; nessun piano lo porta ancora, per questo c'è D-20 (T88).
- D-17 · La rotella sposta o ingrandisce (domanda aperta di `lavagna.md`).
  Consiglio di `lavagna.md`: sposta, con un'impostazione per cambiarlo.
  (a) Consigliata per N6: sposta (è già così), e l'impostazione arriva con
  le altre di «Impostazioni › Lavagna», dopo. (b) L'impostazione in N6.
  Conseguenza: (b) è un'impostazione nuova nell'host.
  Risposta (2026-11-02): (b) — un'impostazione per la rotella, «sposta» o
  «ingrandisce», di serie «sposta» (T33, T35).
- D-18 · Un clic su un link lo segue subito? (domanda aperta). Consiglio di
  `lavagna.md`: no in Lavagna (prima si sceglie la scheda), sì in Lettura.
  (a) Consigliata: così; dentro una scheda attiva, sì. (b) Sempre sì.
  Conseguenza: con (b) è facile aprire una nota per sbaglio mentre si
  sceglie una scheda.
  Risposta (2026-11-02): (c) — un clic su una scheda la sceglie anche sopra
  un link, e Ctrl+clic (Cmd+clic su macOS) apre il link subito, anche sulla
  lavagna (T14, T57).
- D-19 · Il tasto per collegare (domanda aperta). Consiglio di `lavagna.md`:
  C, libero nel disegno e nello Scrittoio. (a) Consigliata: C con una
  scheda scelta fa ciò che fa il pulsante → della testata, e compare nel
  menu come «Collega… · C». (b) Nessun tasto. Conseguenza: nessuna oltre
  la scorciatoia.
  Risposta (2026-11-02): (a) — il tasto C con una scheda scelta comincia il
  collegamento (T17).
- D-20 · Chi porta i CSV nel motore dei fogli (T88, da D-16 (c)). Oggi
  `fub-format-xlsx` rifiuta i CSV; GridCraft ha `read_csv` e `write_csv`, ma
  nessun piano li porta in Fub (N7 li lascia fuori: «gridcraft xlsx/csv/tsv»
  è fuori da N7). (a) Consigliata: un piano suo, «I CSV nel motore dei
  fogli» (lettura e scrittura, separatore, codifica, righe lunghe,
  formule che un CSV non tiene), che finisce con la scheda CSV di T88; N6
  non lo aspetta per il resto, ma si chiude solo con T88 fatto. (b) N6
  porta la sola lettura dei CSV nel motore, in un task Rust suo. (c) N6
  porta lettura e scrittura. Conseguenza: (b) e (c) mettono in N6 un
  lavoro del motore dei fogli che serve a tutto Fub, non solo alla lavagna;
  con (a) un CSV sulla lavagna resta una scheda di file finché quel piano
  non c'è.
  Risposta (2026-11-03): (a) — un piano suo, «I CSV nel motore dei fogli»,
  che finisce con T88; N6 si chiude solo con T88 fatto.
- D-21 · Dove sta il titolo di una scheda di file (T39, si decide guardando
  il prototipo T25). (a) Consigliata: sopra la scheda, fuori dal suo
  rettangolo, come fa Obsidian; la scheda è tutta contenuto, e l'inchiostro
  sopra un'immagine o una pagina si attacca al contenuto con una regola che
  un altro programma rifà con i soli dati del file. (b) Dentro la scheda,
  come oggi (una testata alta qualche decina di pixel). (c) Sopra il
  contenuto, solo al passaggio del mouse. Conseguenza: con (b) la regola
  dell'inchiostro deve nominare l'altezza della testata di Fub, che Obsidian
  e gli altri non conoscono; con (c) chi usa la tastiera o la penna non
  vede il nome. N4 aspetta questa risposta per il riquadro dell'inchiostro
  (la sua nota per N6 su T5, T6, T19).
  Risposta (2026-11-03): (a) — il titolo sopra la scheda, fuori dal suo
  rettangolo, come Obsidian; l'utente lo rivede nel prototipo T25. Da dire a
  N4 (riquadro dell'inchiostro).
- D-22 · Gli strumenti di disegno della lavagna: lazo, spostare l'inchiostro,
  forme dal tratto, linea dritta e righello (E2, F5, F6, F7; T86, T87).
  `lavagna.md` dice che sono un sottoinsieme del motore del disegno (K5);
  K5 però tiene i tratti di penna fuori dal motore, in `fub:ink` (A3 di K5).
  (a) Consigliata: adesso, sull'inchiostro di N4 e sui pezzi che Fub ha già
  (`editors/spatial/tools/recognize.ts` per riconoscere le forme, il
  righello del disegno); una forma riconosciuta resta un tratto `fub:ink`,
  nessun formato nuovo, e N6 non aspetta K5 per queste. (b) Sul motore di
  K5, con un adattatore nuovo, come dice `lavagna.md`: l'inchiostro entra
  nel motore e N6 si chiude dopo K5. (c) (a) adesso, e il passaggio al
  motore più avanti, in K6. Conseguenza: con (b) le forme sulla lavagna
  diventerebbero elementi del motore, che un `.canvas` non sa tenere senza
  un campo nuovo; con (a) e (c) si fanno ora, e restano tratti che Obsidian
  conserva come il resto dell'inchiostro.
  Risposta (2026-11-03): (a) — lazo, forme e righello adesso,
  sull'inchiostro di N4 e sui pezzi che Fub ha già; nessun formato nuovo, N6
  non aspetta K5.

Le altre domande aperte di `lavagna.md` entrano con D-1 (b): il piano segue
il consiglio di `lavagna.md` per ognuna (A-25). La rotella e il link sono
D-17 e D-18; il tasto per collegare è D-19; dove si salva l'inchiostro è
D-1 di N4.

## Assunzioni

- A-1 · Lo scope è quello di D-1 (b): la v1 intera di `lavagna.md` («Le
  tappe › v1»), divisa nei task T24–T90; ciò che `lavagna.md` segna v2 o v3
  è fuori (vedi «Fuori scope»).
- A-2 · Le cartelle trascinate dall'albero non entrano: l'albero non le mette
  fra le voci (`panels/explorer.ts`, «le cartelle non ci entrano»). Quelle
  trascinate dal computer entrano con tutti i loro file, come oggi
  (`droppedFiles` in `document-controller.ts`).
- A-3 · Una specie senza renderer (il componente spento, un formato senza
  superficie) è una scheda di file, con «Apri».
- A-4 · Un renderer non scrive mai il file della sua scheda. Con D-7 (b)
  chi scrive dentro una scheda è l'editor vero del file, sulla sessione del
  documento (T40), con le sue bozze, i suoi conflitti e il suo salvataggio,
  come in un riquadro. Le altre scritture di N6 sono il `.canvas` e i file
  depositati dal computer o incollati.
- A-5 · Le immagini ferme stanno in memoria (una cache a byte, 64 MiB di
  partenza), non su disco: le istantanee su disco sono N2 di `lavagna.md`,
  v2.
- A-6 · I valori di partenza: vive dallo zoom 0,35 in su (il passo), con un
  margine di mezza vista per lato (il passo, `inflate(view, 0.5)`), al più
  40 schede vive (`MAX_LIVE_CARDS`); la misura di T20 (S9) li conferma o li
  cambia, e `docs/reference/canvas-cards.md` dice da dove vengono.
- A-7 · «A fine gesto» vuol dire: al rilascio del puntatore dopo uno
  spostamento, un pizzico o un trascinamento di schede, e 150 ms dopo
  l'ultimo scatto della rotella.
- A-8 · Lasciare cadere un file su una scheda di file ne sostituisce il file,
  come oggi (`#intake`), anche se la scheda è viva.
- A-9 · La scheda di foglio mostra il file salvato; se il file è aperto in un
  riquadro, mostra ciò che mostra il riquadro (il giornale della sessione e
  la sua base).
- A-10 · Il foglio mostrato è quello attivo del file; cambiare foglio dentro
  la scheda non c'è in v1.
- A-11 · Fuori da una scheda attiva la rotella fa ciò che dice
  l'impostazione `canvas.wheel` (D-17 (b)): di serie sposta, come oggi;
  Ctrl+rotella e il pizzico ingrandiscono sempre. Dentro una scheda attiva,
  la rotella scorre la scheda.
- A-12 · Un clic su una scheda non attiva la sceglie, anche sopra un link;
  Ctrl+clic (Cmd+clic su macOS) su un link lo apre subito; dentro una
  scheda attiva e in Lettura basta un clic (D-18 (c)).
- A-13 · I file del sistema passano tutti dal deposito degli allegati
  (`depositOrReuse` in `editors/media/attachment-target.ts`, sopra la porta
  `resource_write`): nessun byte entra nel vault senza la conferma
  dell'host (`already_exists`, limite di 64 MiB). Con D-3 (b) la stessa
  porta, con un'opzione nuova, risponde «c'è già» senza scrivere (T31).
- A-14 · Il registro delle schede si costruisce dentro il montaggio pigro
  della tela (N3 T16): i renderer non pesano sull'avvio di Fub.
- A-15 · N6 va avanti sopra il ramo di N4 (merge-n3n4 (b)): da T11 la base
  è `piano/n4-inchiostro` con N4 fino a T22 fatto, salvo T15, T23–T25, e
  dentro N3 fino a T22 («La base di N4» in «Chi aspetta chi»). N6 entra in
  `main` dopo N3 e N4 (T90).
- A-16 · Le misure di nascita non si agganciano alla griglia di 8 px (il
  foglio è 480×300, un'immagine tiene le sue proporzioni esatte); le
  posizioni sì, e la riga dopo un foglio parte al primo multiplo di 8 dopo
  i 24 px (T29). Ridimensionare a mano aggancia come oggi.
- A-17 · «Già nel vault» (D-3 (b)) vuol dire: un file del vault, fuori dal
  cestino, da `.fub/` e dalle cartelle escluse, con gli stessi byte, provati
  uno per uno prima di rispondere. L'impronta (SHA-256) è un dato derivato
  nella tabella delle voci (`.fub/data/entries.json`), che si rifà dai file
  e si butta quando misura, data o identità del file cambiano; si calcola
  solo per i file della stessa misura, al più 64 candidati e 512 MiB letti
  per deposito (valori di partenza). Oltre il limite, senza tabella, con un
  errore di lettura o un file cambiato a metà: si copia, e nessun byte va
  perso. Vale per la lavagna; le note restano come oggi (T32).
- A-18 · Lo stato della vista di una lavagna (`canvas.view:<id>`, per
  computer e per vault, con `api.viewState`): la camera, le schede scelte
  (al più 500) e la pagina di ogni scheda PDF (al più 1000 schede). Non va
  nel file; una lavagna rinominata riparte dalla vista intera, a meno che
  la shell sposti già gli stati di vista con il nome (T36 lo controlla).
- A-19 · Il titolo di una scheda di file sta sopra la scheda, fuori dal suo
  rettangolo (D-21 (a), da confermare col prototipo T25).
- A-20 · La pagina del PDF sta intera dentro la scheda, centrata, con le sue
  proporzioni (non più «adattata alla larghezza»): così il riquadro del
  contenuto si sa dai soli dati del file (T39).
- A-21 · L'annulla è di ogni superficie (CLAUDE.md): sulla lavagna Ctrl+Z
  annulla i gesti della lavagna; dentro una scheda in scrittura annulla ciò
  che si è scritto lì; le modifiche arrivate da un altro riquadro non
  entrano nel suo annulla. `lavagna.md` T2 dice «un solo Annulla per file»:
  vince il codice (sezione «Differenze»).
- A-22 · I livelli di dettaglio: da 0,35 la scheda è viva; fra 0,15 e 0,35
  l'ultima immagine ferma (D-12 (a)) o il titolo grande; sotto 0,15 un
  blocco del suo colore col titolo grande (B2). Lo zoom va dal 5% al 400%
  (oggi da 0,1 a 4).
- A-23 · La griglia resta di 8 px, le frecce spostano di 8 (32 con Maiusc) e
  in più di 1 con Alt+Maiusc (Alt da solo va alla scheda più vicina, M1);
  `lavagna.md` dice 20 px e 10, 50, 1 con Alt. Così le schede di oggi, i 24
  px fra le schede (D-11 (a)) e lo spostamento a tastiera restano sulla
  stessa griglia.
- A-24 · Gli estratti di PDF aspettano PdfCraft P1 e P4, come dice
  `lavagna.md` («Le tappe»): T79–T84. Con pdf.js si fa solo ciò che non è un
  estratto («Spargi le pagine», T72). Gli estratti di note e immagini non
  aspettano.
- A-25 · Le domande aperte di `lavagna.md`, col suo consiglio: la scheda di
  testo cresce fino a 480 px di larghezza (C1, T44); il selettore si apre
  rilasciando un PDF con più pagine o una nota con più sezioni, Esc tiene
  tutto, Alt lo salta, un'impostazione lo spegne (T74); Spazio toccato legge
  da vicino, tenuto sposta, con 0,3 s di soglia (T76); l'inchiostro di un
  estratto resta della lavagna, attaccato alla pagina (T85); una figura è
  di serie una zona (T81); i link delle note come fili restano v2.
- A-26 · Ogni task grafico dipende dal suo prototipo (T25–T28). Il
  prototipo lo costruisce un coder con
  `.claude/skills/pianifica/prototipo.md`, e l'orchestratore lo fa vedere
  all'utente prima di far partire i task che ne dipendono; «Approvato:
  AAAA-MM-GG» nella testa della pagina e nella riga «Prototipo:» lo dice.
- A-27 · L'impianto della lavagna (colonna, riga delle opzioni, barra della
  selezione, banda, navigatore, ispettore, menu radiale) è fatto coi pezzi
  del kit (`kit/tool-rail.ts`, `kit/options-bar.ts`, `kit/popover.ts`,
  `kit/number-field.ts`, `kit/color/`) e imita il disegno senza cambiarlo:
  `editors/spatial/` lo cambia K5 finché K5 non è fuso. Le funzioni pure che
  il disegno esporta (`navigatorBox`, `openRadial`, `sectorOf`) si
  importano.
- A-28 · «Già nel vault, uso quello» ha l'azione «Fanne una copia»: chi
  vuole un file suo lo ottiene senza cercare (da confermare col prototipo
  T25).
- A-29 · Gli «otto scenari principali» del «pigro alla prova» (il cancello
  della v1 di `lavagna.md`) sono i primi otto della sezione: il PDF da
  scriverci sopra, collegare due idee, l'idea senza posto, non so dove sono,
  la scheda sbagliata, la scheda tolta con mezz'ora di testo, il
  salvataggio dimenticato, le 40 foto (`lavagna.md` non dice quali).

## Il contratto delle schede

Il modulo `apps/client/src/editors/canvas/cards.ts` (T1) è la forma che
tutti i renderer e la tela condividono. Questa è la sua forma; i nomi sono
quelli che i task usano.

```ts
export type CardMode = "live" | "snapshot";
export type CardKind = "note" | "document" | "sheet" | "pdf" | "image" | "web" | "craft" | "file";

/// La specie di una scheda dalla sua forma: `null` per testo e gruppi, che
/// la tela disegna da sé come oggi.
export function cardKindOf(node: CanvasNode): CardKind | null;

export interface CardSize { readonly width: number; readonly height: number }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/// Le immagini ferme di un file, per parte («w640», «page-3@640»: la parte
/// dice anche la larghezza, arrotondata a 32 px); la cache di T2 ha questa forma.
export interface CardSnapshots {
  get(path: string, part: string): CardSnapshot | undefined;
  put(path: string, part: string, snapshot: CardSnapshot): void;
  forget(path: string): void;
}
export interface CardSnapshot { readonly bitmap: ImageBitmap | HTMLCanvasElement; readonly bytes: number }
export function snapshotPart(prefix: string, width: number): string; // "page-3@640"

export interface CardContext {
  readonly path: string;          // il file, dal vault, senza subpath
  readonly subpath: string | null; // "#page=3", "#Titolo"…
  readonly documentId: string;    // la lavagna
  readonly lifetime: Lifetime;    // si chiude con destroy
  readonly snapshots: CardSnapshots;
  size(): CardSize;               // in unità della lavagna
  zoom(): number;
  missing(): void;                // il file non c'è: la tela mostra C15 (T16)
  readonly initialPage?: number;  // la pagina ricordata (T36)
  pageChanged?(page: number): void; // la scheda ha cambiato pagina (T36)
  contentMoved?(): void;          // il contenuto è scorso dentro la scheda (T38)
  readonly parts?: CanvasParts | null; // l'estratto, da `fub:parts` (T73, T75)
}

export interface CardView {
  setMode(mode: CardMode): void;
  resize?(): void;                // la scheda ha cambiato misura (fine gesto)
  enter?(): boolean;              // false: non c'è niente in cui entrare
  leave?(): void;
  key?(event: KeyboardEvent): boolean; // true: il tasto è della scheda
  page?(): number;                // la pagina mostrata, da 1 (il PDF; la usa T19)
  pageBox?(): { readonly width: number; readonly height: number; readonly rect: Rect } | null;
                                  // la pagina mostrata: misura in punti PDF e dove sta nella scheda (T19)
  contentAspect?(): number | null; // larghezza / altezza del contenuto (T39)
  cellAt?(point: { x: number; y: number }): { sheet: string; cell: string } | null; // T38
  cellRect?(sheet: string, cell: string): Rect | null; // nella scheda, null se non si vede (T38)
  edit?(): boolean;               // entra in scrittura; false: non si può (T41, T42)
  destroy(): void;
}

export interface CardRenderer {
  readonly kinds: readonly CardKind[];
  mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView;
}

export interface CardRegistry { rendererFor(kind: CardKind): CardRenderer | null }
export function createCardRegistry(renderers: readonly CardRenderer[]): CardRegistry;

export const LIVE_ZOOM_MIN = 0.35;
export const LIVE_MARGIN = 0.5;
export const MAX_LIVE_CARDS = 40;

/// Le schede che devono essere vive: dentro la vista allargata di metà per
/// lato, dallo zoom 0,35 in su, al più `limit`, le più vicine al centro.
export function liveCardIds(nodes: readonly CanvasNode[], view: Rect, zoom: number, limit?: number): Set<string>;

/// Mette ogni scheda nel modo voluto, nel lavoro rimandato «cards» di PenQuiet.
export function updateLiveCards(
  cards: ReadonlyMap<string, CardView>,
  wanted: ReadonlySet<string>,
  current: Map<string, CardMode>,
  quiet: { defer(key: string, work: () => void): void },
): void;
```

Il passo dava al renderer gli id dei FormatProvider (`formats`) e due metodi
per le ancore di contenuto (`anchorAt`, `place`): qui la specie viene
dall'estensione, come fa la shell in `ui/format-kind.ts` (il client non sa
il provider di un file senza chiederlo), e le ancore non ci sono in T1, che
dà solo `page()`. I membri segnati con un task li aggiunge quel task, tutti
facoltativi, così un renderer che non li ha resta valido: l'ancora di
pagina (`pageBox`, T19, D-4 (a)), la pagina ricordata (T36, D-5 (c)),
l'ancora alle celle (`cellAt`, `cellRect`, T38, D-6 (b)), il riquadro del
contenuto (`contentAspect`, T39) e la scrittura dentro la scheda (`edit`,
T41 e T42, D-7 (b)), lo scorrimento del contenuto che l'inchiostro segue
(`contentMoved`, T38) e l'estratto letto da `fub:parts` (`parts`, T73).
Le ancore ai blocchi di una nota restano v2. `quiet`
è la forma di `PenQuiet` di N4 (`ink/quiet.ts`), che chiede una chiave.

## Differenze dal passo 15 e da `lavagna.md`

Il codice di `main` @ 620f0acd, e i piani N3 e N4, dicono altro in questi
punti; il piano segue il codice.

- Il passo dice che la Markdown ha già «l'anteprima che esiste»: nella
  lavagna no. Ogni scheda di file è un segnaposto, anche un `.md`
  (`#cardBody` di `engine.ts`). `lavagna.md` segna C2–C5 «c'è già»: c'è nel
  resto di Fub (anteprima, foglio, pdf.js, visore), non nella lavagna.
- Dall'albero oggi nasce una scheda di testo col percorso: `resolvePaths` è
  nella porta della tela ma `document-controller.ts` non lo collega (T10).
- La cartella dei file trascinati c'è già ed è una sola per tutto il vault:
  `files.attachment-folder`, di serie `attachments` alla radice, non
  `Allegati/` accanto alla lavagna. Con D-2 (d) la lavagna ha
  un'impostazione sua che di serie segue quella (T33, T34).
- Il PDF: il passo dice `PdfEngine.renderPage` (pdf.js), `lavagna.md` C4 i
  tasselli di PdfCraft. Si usa pdf.js, che c'è; la scheda passa ai tasselli
  di PdfCraft quando c'è il suo piano (T79), e gli estratti di PDF lo
  aspettano (A-24). Nessun piano di PdfCraft esiste ancora.
- La scheda PDF di T6 adatta la pagina alla larghezza; T39 la mette intera
  dentro la scheda (A-20), così l'inchiostro si attacca al contenuto con una
  regola che un altro programma rifà.
- L'anteprima di un `.xlsx` esiste già come HTML (`renderEmbed`), ma il
  passo vuole la superficie del foglio: la scheda usa la sessione dei byte
  del foglio (`GridHost`), sola lettura, e la sessione di oggi chiede il
  giornale e la base (`grid_bytes_open` rifiuta una base vecchia con
  `Stale`).
- S3 oggi ha 20 note in schede di file, non 20 fogli, e la lavagna si apre
  inquadrando tutte le 300 schede: a quello zoom (sotto 0,35) nessuna
  sarebbe viva. Con D-8 (b) S3 resta com'è e T20 aggiunge S9.
- `MAX_INTERACTIVE_NODES` di `engine.ts` è 2000; `lavagna.md` N5 parla di
  10 000 schede: fuori da N6.
- `#render` di `engine.ts` rifà tutte le schede a ogni cambio: una scheda
  viva (una sessione di foglio, un PDF aperto) morirebbe a ogni modifica.
  T11 lo cambia prima di tutto il resto.
- La rotella oggi sposta, Ctrl+rotella ingrandisce (`#wheel`): coincide col
  consiglio di `lavagna.md`; l'impostazione per cambiarlo non c'è (D-17 (b),
  T35).
- Lo zoom oggi va da 0,1 a 4 (`clampZoom`); `lavagna.md` dice dal 5% al 400%
  (T53).
- La griglia oggi è di 8 px (`CANVAS_SNAP`), le frecce spostano di 8 e 32;
  `lavagna.md` dice 20 px e 10, 50, 1. Resta 8 (A-23), e Alt+Maiusc sposta
  di 1.
- `lavagna.md` dà Alt+frecce a due cose: il passo di 1 px (E4, «Tasti») e la
  scheda più vicina (M1). Il piano dà Alt+frecce alla scheda più vicina e
  Alt+Maiusc+frecce al passo di 1 (T61).
- `lavagna.md` dà Alt+trascina a due cose: duplicare (E8) e collegare dal
  corpo della scheda (D7, il secondo scenario del pigro). Il piano dà
  Alt+trascina su una scheda al collegamento (T67); si duplica con Ctrl+D.
  Oggi Ctrl, Cmd e Alt+trascina spostano la vista ovunque (`#pointerDown`):
  restano così nel vuoto (T53).
- `lavagna.md` T dice «doppio clic entra» per ogni scheda, C5 che il doppio
  clic su un'immagine apre il visore. Il piano tiene C5 (T5); il ritaglio e
  la rotazione si fanno con «Ritaglia e ruota» (T78).
- `lavagna.md` S19 nomina `canvas.add_excerpt` e `pdf.parts` per gli
  agenti: gli agenti sono fuori (J); il formato `fub:parts` c'è (T73) e loro
  lo useranno.
- `lavagna.md` S non dice chi vince se il `subpath` e `fub:parts` non vanno
  d'accordo: vince il `subpath`, che è ciò che vede Obsidian (T73).
- `lavagna.md` S12 propone Ctrl+Alt+L «da confermare»: il piano lo prende,
  e il registro dei tasti della shell dice se è libero (T84).
- `lavagna.md` B5 segna «c'è già» il riaprire dove si era: non c'è, `setDoc`
  inquadra tutto a ogni apertura (T36).
- `lavagna.md` B4 vuole Indietro e Avanti sulla lavagna; la cronologia dei
  riquadri (`PaneHistory`) tiene solo le schede aperte, non i punti di una
  lavagna (T56).
- `lavagna.md` T2 dice «un solo Annulla per file» fra la lavagna e la
  scheda; in Fub l'annulla è di ogni superficie (CLAUDE.md). Vince il
  codice (A-21).
- `lavagna.md` F dice che lazo e forme sono «il motore del disegno»; K5 A3
  tiene i tratti di penna fuori dal motore, in `fub:ink` (D-22).
- `lavagna.md` B7 segue un link con un clic in Lettura; con D-18 (c) sulla
  lavagna lo segue Ctrl+clic, e un clic solo dentro una scheda attiva.
- Gli estratti di sezioni di `lavagna.md` S chiedono un elenco delle parti
  di un file: non c'è un tratto `Parts`; per le note si usa la richiesta
  `outline` che c'è (`host/query.ts`), per i PDF i dati di PdfCraft.
- Nella tabella di `lavagna.md` T il testo del PDF si sceglie e si copia in
  v1; C4 lo segna v2. Il piano segue C4.
- «Incolla» sulla lavagna vuota: il menu non sa se negli appunti c'è
  qualcosa senza leggerli, e leggerli senza un gesto chiede un permesso.
  Resta sempre attivo e legge gli appunti solo al clic (T62).
- La scheda di testo oggi è una `textarea` (`#beginCardEdit`); `lavagna.md`
  C1 la vuole in Live come le note (T43).
- Nel passo `board.cards`, `Board` e `cardsIn` non esistono; `PenQuiet.defer`
  di N4 vuole una chiave.
- Il registro per id di FormatProvider diventa un registro per specie
  dall'estensione (sezione sopra).
- Le ancore alle celle del passo sono v2 per `lavagna.md`; con D-6 (b) sono
  in N6 (T37, T38). Quella alla pagina è v1 per tutti e due, e cambia il
  formato di N4 (D-4 (a), T19).
- I colori: `lavagna.md` C10 vuole i nove colori dei Blocchi; la tela ha i
  colori 1–6 scritti come `var(--…)` in `PRESET_FILL`, e un colore
  esadecimale lo tiene ma lo disegna pieno, senza tinta. Con D-13 (c)
  restano i sei e ogni `#rrggbb` (T47).
- Il passo dice «istantanee (immagini in cache)»: una nota e un foglio sono
  DOM, e farne un'immagine chiederebbe una libreria che non c'è. Nel piano
  la loro istantanea è il loro DOM fermo (`inert`, nessuna sessione
  aperta); le immagini vere sono quelle di PDF e foto (T2).
- «Cambia cartella» chiede di aprire le Impostazioni su una voce: oggi non
  c'è un modo (T10 aggiunge `revealSetting`).
- Il CSV di C3 non ha una specie né un foglio in Fub, e nessun piano lo
  porta (D-16 (c), D-20, T88).
- Il foglio nasce 480×304 (`BORN_SIZE` di `drop-layout.ts`, agganciato a
  8 px); D-11 (a) vuole 480×300 (T29).
- Incollare un'immagine e incollare un indirizzo ci sono già (`#intake`);
  manca solo il «sotto il puntatore» e le celle come tabella (T15).
- La v1 di `lavagna.md` è molto più grande del passo 15 (impianto del
  disegno, ricerca, navigatore, Semplice, estratti, modifica sul posto):
  con D-1 (b) entra tutta (T24–T90).
- `lavagna.md` non dice quali sono gli «otto scenari principali» del suo
  cancello (A-29).

## Cancello di N6

| Fatto quando | Prova | Task |
|---|---|---|
| S3 resta com'è e la sua serie continua: nessun peggioramento oltre le soglie di oggi | `npm run bench:webview -- --only=S3 --budgets=targets`, la pagina in `docs/misure/` | T20, T46 |
| S9, 20 schede di foglio vive: p95 entro 16,7 ms e massimo entro 50 ms fra fotogrammi, su Linux (WebKitGTK) | `npm run bench:webview -- --only=S9 --budgets=targets`, la pagina in `docs/misure/` | T20, T46 |
| scrivendo in una scheda di nota, dal tasto al fotogramma entro 16,7 ms (`S9.keyToPaint`, p95) | `npm run bench:webview -- --only=S9 --budgets=targets` | T46 |
| le stesse misure su Windows (WebView2) e macOS (WKWebView) | il comando di `webview-measurements.md`, lanciato dall'utente | l'utente (D-9) |
| trascini un `.xlsx` dal sistema, ci scrivi sopra, chiudi e riapri: tutto al suo posto, il file con gli stessi byte | `src/canvas-cards.e2e.test.ts` e la prova a mano in `docs/development/ink-input-smoke-test.md` | T21 |
| nota, documento, foglio, PDF, immagine, pagina web, file Craft e file qualsiasi si vedono nella scheda | i test dei renderer e `src/canvas-cards.e2e.test.ts` | T4–T8, T12, T18 |
| vive solo le schede utili; sotto 0,35 nessuna; mai più di `MAX_LIVE_CARDS` | `editors/canvas/engine-cards.test.ts` | T13 |
| mentre la penna è giù nessuna scheda cambia modo | `engine-cards.test.ts` (penna finta) | T13 |
| lo stesso contenuto, anche con un altro nome e in un'altra cartella, non si copia due volte; nel dubbio si copia | `cargo test -p fub-kernel --test same_content`, `cargo test -p fub-app --lib resources`, `state/canvas-intake.test.ts` | T30–T32 |
| l'inchiostro attaccato a una pagina di PDF e a una cella di foglio: vettori uguali in Rust e TypeScript, il tratto torna con la sua pagina e segue la sua cella | `cargo test -p fub-canvas-core`, `editors/canvas/anchor.test.ts`, `editors/canvas/engine-ink-anchors.test.ts` | T19, T37, T38 |
| si scrive in una nota e in un foglio dentro la lavagna sulla stessa sessione del riquadro: bozze, conflitti e annulla come in un riquadro | `state/card-editors.test.ts`, `src/canvas-edit.e2e.test.ts` | T40–T44 |
| riaprendo una lavagna torni alla vista, alle schede scelte e alle pagine dei PDF di prima | `editors/canvas/view-state.test.ts` | T36 |
| gli estratti di note e immagini: `fub:parts` letto e scritto uguale in Rust e TypeScript, un estratto sconosciuto torna byte per byte, Obsidian vede il `subpath` | `cargo test -p fub-canvas-core --test parts_vectors`, `editors/canvas/parts.test.ts`, `editors/canvas/parts-picker.test.ts` | T73–T78 |
| ciò che si vede somiglia ai quattro prototipi approvati, in chiaro e in scuro | le foto del banco (skill `banco`) accanto a quelle dei prototipi, nel rapporto di ogni task grafico | T22, T25–T28 e i task grafici |
| gli otto scenari principali del «pigro alla prova» passano | `src/canvas-lazy.e2e.test.ts` e la prova a mano in `docs/development/canvas-smoke-test.md` | T89 |
| la scheda PDF sui tasselli e gli estratti di PDF: i cancelli di PdfCraft P1 e P4 e i test degli estratti | i test di T79–T85 | T79–T85 |
| lazo, spostare l'inchiostro, forme dal tratto e linea dritta | i test di T86 e T87 | T86, T87 |
| una lavagna scritta da Fub si apre in Obsidian e torna uguale | la prova di N4 (il cancello di N4) | N4 |
| un `.csv` si vede come foglio nella scheda | il test di T88 | T88 |
| la CI completa è verde su Linux, Windows e macOS e la revisione non ha trovato errori aperti | `gh pr checks 302`, il rapporto della revisione | T90 |

N6 si chiude solo con tutte le righe verdi: anche quelle di PdfCraft (T79–T85),
del CSV (T88) e, se D-22 è (b), quelle che aspettano K5. Una riga che aspetta un
altro piano resta aperta, non si toglie.

## Regole che valgono per ogni task

- Vince il codice: se un percorso o una funzione non è come scritto qui, il
  coder lo dice nel suo rapporto e segue il codice.
- I numeri di riga e i nomi privati di `engine.ts` (`#render`,
  `#renderLive`, `#cardBody`, `#intake`, `#wheel`, `#keydown`,
  `#applyCamera`, il menu contestuale) sono quelli di `main` @ 620f0acd;
  N3 T16 e N4 T12–T16 cambiano il motore: dopo, si cercano per nome e per
  ruolo.
- Nessuna dipendenza esterna nuova, né in npm né in Rust, e niente in
  `vendor/`.
- CodeMirror e ProseMirror solo nei loro pacchetti
  (`check-codemirror-boundary.mjs`, `check-prosemirror-boundary.mjs`): la
  tela non importa moduli di `editors/text/` (che li tirano dentro), ma
  riceve porte (funzioni) da `bootstrap.ts` o tipi strutturali suoi.
- Il nucleo dell'inchiostro (`apps/client/src/ink/` fuori da `ink/dom/`) non
  usa il DOM (ADR 0204).
- Ascoltatori, osservatori e timer passano da una `Lifetime`
  (`ui/lifetime.ts`) o da un `AbortSignal` come fa la tela:
  `check-listeners.mjs` vieta il resto.
- Il TypeScript degli editor non scrive `var(--ruolo)`
  (`check-inline-theme.mjs`).
- Le classi nuove che hanno un aspetto vanno in
  `theme/scrittoio/skin/editors.css` e sono dichiarate in
  `theme/scrittoio/anatomia/editors.ts` (`anatomia.test.ts`); la struttura
  in `theme/scrittoio/structure.css`. Una classe usata solo dal TypeScript
  non serve dichiararla.
- Testi in `apps/client/src/i18n/catalog.ts`, in italiano (blocco `canvas.*`
  verso la riga 2471) e in inglese (verso la 5390), con gli stessi
  argomenti, senza le parole di `i18n/gergo.ts` (niente «render», «view»,
  «snapshot»: si dice «resa», «vista», «immagine ferma»). `catalog.ts` lo
  tocca al più un task per ondata.
- Rust: niente `unwrap` o `expect` fuori dai test, errori con `thiserror`
  dove il crate lo usa, nessun errore letterale nuovo
  (`check-error-literals.mjs`).
- Le pagine di `docs/` sono in italiano e restano nei limiti di
  `check-doc-size.mjs` (`docs/README.md` 150 righe, riferimento 550,
  decisione 180, il resto 450); `docs/architecture/editor-surfaces.md` è a
  449 e non si tocca. Una pagina nuova è linkata da `docs/README.md`.
- Non scrivere numeri non misurati come misure: i valori di partenza si
  chiamano così.
- Mai il vault vero (`~/.cache/fub-live/`), mai `~/Progetti/Fub`; nei test
  solo vault finti (`host/fake.ts`, cartelle temporanee).
- Prima di una prova Vitest: `npm ci` in `apps/client` se manca
  `node_modules`.
- `editors/canvas/engine.ts` lo tocca un task alla volta: due task della
  stessa ondata che lo cambiano non partono insieme. Un pezzo nuovo che può
  stare fuori (un modulo in `editors/canvas/`, `editors/canvas/chrome/`,
  `editors/canvas/cards/`) va fuori, e il motore lo chiama.
- Come N3 (l'accordo in «Chi aspetta chi»): ogni modifica della lavagna
  passa dal commit del nucleo di N3 e il suo annulla torna agli stessi byte
  (N3 T21); il testo di una scheda in scrittura è «in attesa» come in N3 T16
  e T19 (`CARD_PAUSE_MS`, 250 ms, e la bozza); un filo si toglie con la
  patch che dice `at` (N3 T20). Nessun task scrive il `.canvas` da sé.
- Sola lettura (la chiave doppia di N3 T22, il pannello in sola lettura):
  ogni gesto che cambierebbe il file è spento e dice perché; guardare,
  scorrere, scegliere e copiare restano.
- Al più due task insieme (`/orchestra`: mai più di due coder al lavoro), e
  i task grafici partono solo con la riga «Approvato» del loro prototipo
  (A-26).
- Chi cambia `theme/scrittoio/skin/editors.css` o `anatomia/editors.ts`
  rigenera i derivati con `npm run theme:generate` in `apps/client` (fra
  gli altri `src/theme/scrittoio/skin.css`, `theme/author/sample/skin.css`
  e, con l'anatomia, `theme/author/contract.json`) e prova con `npm run
  theme:verify`.
- Un'impostazione nuova della lavagna sta nella feature
  (`crates/fub-features/src/lavagna.rs`, come quelle di N4 T19) e nel suo
  specchio del client (`editors/canvas/preferences.ts`), con le sue prove;
  il nome e il testo vengono dal prototipo T25.

## T1 · Il contratto delle schede

Perché: tutti i renderer (T4–T8, T18) e la tela (T11–T17) parlano la
stessa forma; scritta prima, i renderer si fanno in parallelo.
Tocca: `apps/client/src/editors/canvas/cards.ts` (nuovo),
`apps/client/src/editors/canvas/cards.test.ts` (nuovo),
`apps/client/src/i18n/catalog.ts` (le chiavi `canvas.card.*` dei renderer),
`docs/reference/canvas-cards.md` (nuovo), `docs/README.md` (una riga).
Non toccare: `engine.ts`, `surface.ts`, `model.ts` (N3 T18 lo svuota tenendo
i tipi: `cards.ts` importa solo `type CanvasNode`); `ui/format-kind.ts` (N7
ci aggiunge specie: `cardKindOf` lo usa, non lo cambia); le righe che N3 e
N4 aggiungono a `docs/README.md` prima del «server MCP».
Dipende da: nessuno
Cosa fare:
- I tipi e le funzioni della sezione «Il contratto delle schede», con i
  commenti in italiano.
- `cardKindOf`: `text` e `group` → `null`; `link` → `web`; `file`: si
  guarda l'estensione del percorso, in minuscolo, senza `subpath`; `md`,
  `markdown` → `note`; ciò che `formatKindOf` dice `word` o `odt` →
  `document`; `sheet` → `sheet`; `mediaKindOfId` `pdf` → `pdf`, `image` →
  `image` (l'SVG è un'immagine, anche se `formatKindOf` lo dice `drawing`);
  tutto il resto (CSV, `.canvas`, audio, video, ZIP, senza estensione) →
  `file`. `craft` è nel tipo ma nessuna estensione ci porta finché T18 non
  la aggiunge.
- `createCardRegistry`: una specie con due renderer è un errore
  (`Error("card kind <specie> has two renderers")`), detto subito, non al
  primo uso.
- `liveCardIds`: niente sotto `LIVE_ZOOM_MIN` (insieme vuoto); la vista
  allargata di `LIVE_MARGIN` della sua larghezza e altezza per lato; dentro
  vuol dire che il rettangolo della scheda la tocca; solo le schede con una
  specie (`cardKindOf` non `null`); se sono più di `limit`, restano le più
  vicine al centro della vista (a pari distanza, l'ordine del file).
- `updateLiveCards`: confronta `wanted` con `current` e chiama `setMode`
  solo dove il modo cambia, tutto dentro `quiet.defer("cards", …)`;
  `current` si aggiorna nel lavoro rimandato, non prima.
- Le parti delle immagini ferme si scrivono come dice il commento di
  `CardSnapshots` (larghezza arrotondata a 32 px): i renderer le
  costruiscono con una funzione `snapshotPart(prefix, width)` esportata qui.
- In `catalog.ts`, IT ed EN: `canvas.card.loading` («Apro…»),
  `canvas.card.unreadable` («Non riesco a mostrare {name}»),
  `canvas.card.page` («{page} / {pages}»), `canvas.card.previous_page`,
  `canvas.card.next_page`, `canvas.card.sheet_unavailable` («Il foglio non
  si può mostrare qui: aprilo»), `canvas.card.show_preview` («Mostra
  l'anteprima»), `canvas.card.open` («Apri»), `canvas.card.too_large`
  («{name} è troppo grande per la scheda»). Il coder sistema le parole, non
  il loro numero.
- `docs/reference/canvas-cards.md`: che cos'è una scheda viva e una ferma,
  le specie e da quale estensione, il contratto, le regole di
  `liveCardIds` con i valori di partenza (A-6) e da dove vengono, che un
  renderer non scrive mai il file (A-4). Una riga in `docs/README.md`
  subito dopo «Il server MCP» (N3 e N4 aggiungono le loro prima: così il
  merge non si tocca).
Casi limite: un percorso con un punto nel nome di una cartella e nessuna
estensione (`Corsi.2026/leggimi`) → `file`; estensione maiuscola (`FOTO.JPG`)
→ `image`; un `subpath` con un punto (`Nota.md#1.2 Titolo`) non conta per
l'estensione; zoom esattamente 0,35 → vive; vista vuota (larghezza zero) →
nessuna; due schede alla stessa distanza dal centro; `limit` 0; una scheda
più grande della vista che la contiene tutta.
Fatto quando: `cards.test.ts` prova ogni ramo di `cardKindOf`, il doppione
nel registro, `liveCardIds` (sotto e sopra 0,35, margine, limite, ordine) e
che `updateLiveCards` chiama `setMode` solo nel lavoro rimandato e solo
dove il modo cambia (un `quiet` finto che tiene i lavori finché il test non
li lascia andare).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards.test.ts
Stato: [x] fatto
  Da rivedere: T19, T36, T38, T39, T41 e T73 lo cambiano (D-4 (a), D-5 (c),
  D-6 (b), D-7 (b), D-21; T73 per gli estratti di D-1 (b)).

## T2 · La cache delle immagini ferme

Perché: tornando su una scheda PDF o d'immagine, la sua immagine ferma deve
esserci subito, senza rileggere e ridisegnare il file; e la memoria deve
avere un tetto.
Tocca: `apps/client/src/editors/canvas/card-cache.ts` (nuovo),
`apps/client/src/editors/canvas/card-cache.test.ts` (nuovo).
Non toccare: `cards.ts` (T1, stessa ondata: la cache ha la forma
`CardSnapshots` di T1 per struttura, senza importarla); le cache di
`state/document-caches.ts` (sono dei documenti, non delle schede).
Dipende da: nessuno
Cosa fare:
- `export class CardCache` con `constructor(limitBytes = 64 * 1024 * 1024)`,
  `get(path, part)`, `put(path, part, snapshot: { bitmap, bytes })`,
  `forget(path)`, `clear()`, `size()` (i byte tenuti). Dentro, una mappa per
  percorso e un ordine d'uso comune a tutte le voci.
- Il più vecchio usato esce per primo quando i byte superano il tetto; chi
  esce viene chiuso (`ImageBitmap.close()` se c'è; un `HTMLCanvasElement`
  si rimpicciolisce a 0×0 perché il motore liberi la memoria).
- `get` rinfresca l'età; `put` con una chiave che c'è sostituisce e chiude
  la vecchia; una voce più grande del tetto intero non entra (e si chiude
  subito).
- `forget(path)` toglie e chiude tutte le parti di quel file, solo di quello.
Casi limite: tetto 0; `put` della stessa voce due volte; `forget` di un
percorso che è il prefisso di un altro (`a.pdf` e `a.pdf.bak`: il secondo
resta); `bytes` 0 o negativo (si tratta come 1); `close` che lancia (si
ignora, la voce esce lo stesso); un percorso con caratteri strani (la
mappa non li interpreta).
Fatto quando: `card-cache.test.ts` prova l'ordine di uscita, il tetto,
`forget` col prefisso, la chiusura di chi esce (bitmap finti che contano le
chiusure).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/card-cache.test.ts
Stato: [x] fatto

## T3 · Lo stesso file non si duplica

Perché: G2 di `lavagna.md`: trascinare due volte lo stesso file non deve
fare «foto 1.jpg», «foto 2.jpg».
Tocca: `apps/client/src/editors/media/attachment-target.ts`,
`apps/client/src/editors/media/attachment-target.test.ts` (nuovo).
Non toccare: `depositAttachment` e `depositFiles`, che le note e il
registratore usano (`recorder.ts`, `mountAttachmentDropPaste`): il loro
comportamento resta identico (D-3); l'host (`resources.rs`).
Dipende da: nessuno
Cosa fare:
- `export async function depositOrReuse(target: AttachmentDeposit, name,
  bytes, same: (id: string, bytes: Uint8Array) => Promise<boolean>):
  Promise<{ receipt: AttachmentReceipt; reused: boolean }>`.
- Prova i candidati nello stesso ordine di `depositAttachment`
  (`attachmentCandidate`); quando l'host risponde `already_exists`, chiede
  `same(id, bytes)`: se `true` restituisce quell'id con `reused: true`
  (la revisione è quella del descrittore, o `null` se il lease non la
  porta); se `false`, o se `same` lancia, passa al candidato dopo.
- Gli stessi limiti di `depositAttachment` (64 MiB, nome vuoto →
  `errors.attachment.no_name`).
- Test anche per `depositAttachment`, che oggi non ne ha: il candidato
  dopo un `already_exists`, il nome vuoto, il limite.
Casi limite: il file c'è con lo stesso nome ma byte diversi (nasce «nome
1.ext»); c'è «nome 1.ext» uguale e «nome.ext» diverso (si riusa «nome
1.ext»); `same` lento e la scrittura di un altro nel frattempo; byte vuoti;
nome con caratteri che il vault rifiuta (lo dice l'host, come oggi).
Fatto quando: `attachment-target.test.ts` passa con un `write` finto che
risponde `already_exists` e un `same` finto; le prove di oggi delle note
passano senza cambiare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/media/attachment-target.test.ts
Stato: [x] fatto
  Da rivedere: T32 lo cambia (D-3 (b)).

## T4 · La scheda di nota

Perché: C2 di `lavagna.md` e il primo punto del passo: una nota sulla
lavagna si legge, non è un nome.
Tocca: `apps/client/src/editors/canvas/cards/note.ts` (nuovo),
`apps/client/src/editors/canvas/cards/note.test.ts` (nuovo).
Non toccare: `engine.ts` (la tela la monta in T11–T13); `host/query.ts` e
`state/preview.ts` (la resa arriva da una porta); `editors/text/` (niente
editor dentro la scheda: D-7).
Dipende da: T1, T2
Cosa fare:
- `export function noteCardRenderer(port: NoteCardPort): CardRenderer` con
  `kinds: ["note", "document"]` e `interface NoteCardPort { show(path,
  heading: string | null, host: HTMLElement, life: Lifetime): Promise<void>;
  watch(path, changed: () => void): () => void }`. In T12 la porta è
  `renderEmbed` più la stessa montatura sicura che usano le schede di testo
  (`mountMarkdown` o `setSanitizedHtml`), fatta in `document-controller.ts`.
- `heading` viene dal `subpath` (`#Titolo` → `Titolo`; `#^blocco` → nessun
  titolo, la nota intera).
- Vivo: chiama `show`; mentre aspetta, «Apro…»; se `show` lancia, la scheda
  di file di oggi con `canvas.card.unreadable`; se l'errore dice che il file
  non c'è, chiama `context.missing()`.
- Fermo: il contenuto che c'era resta, con `inert` e senza ascoltatori;
  se non è mai stato vivo, titolo e specie (il segnaposto di oggi).
- `watch`: quando il file cambia, se vivo si ridisegna, se fermo si segna
  da rifare alla prossima accensione.
- `enter()` restituisce `true` (si scorre e si seleziona); `leave()` lascia
  lo scorrimento dov'è.
Casi limite: nota vuota; nota enorme (la resa la taglia l'host come per gli
embed); un titolo del `subpath` che non c'è (la nota intera, come gli embed);
`destroy` mentre `show` aspetta (il risultato non tocca più il DOM); la
stessa nota due volte sulla lavagna; un `.docx` che `renderEmbed` non sa
rendere (scheda di file, D-14).
Fatto quando: `note.test.ts`, con una porta finta, prova vivo, fermo, mai
stato vivo, errore, file mancante, cambio del file da fermo e da vivo, e
che dopo `destroy` nessuna risposta tardiva scrive nel DOM.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/note.test.ts
Stato: [x] fatto
  Da rivedere: T41 e T75 lo cambiano (D-7 (b); T75 per gli estratti di
  D-1 (b)).

## T5 · La scheda d'immagine

Perché: C5: foto e schermate si vedono nella scheda.
Tocca: `apps/client/src/editors/canvas/cards/image.ts` (nuovo),
`apps/client/src/editors/canvas/cards/image.test.ts` (nuovo).
Non toccare: `editors/media/image-view.ts` (si usa `decodeImage`, non si
cambia); `ui/lightbox.ts` (arriva da una porta).
Dipende da: T1, T2
Cosa fare:
- `export function imageCardRenderer(port: ImageCardPort): CardRenderer`,
  `kinds: ["image"]`, con `interface ImageCardPort { read(path):
  Promise<{ bytes: Uint8Array; descriptor: ResourceDescriptor } | null>;
  open(path): void; watch(path, changed): () => void }` (in T12: la
  `ResourceTransport` di `options.media` con `openResourcePort`, e il
  visore).
- Vivo: legge, `decodeImage`; un raster diventa un `ImageBitmap` largo al
  più il doppio della scheda (`createImageBitmap` con `resizeWidth`; se il
  motore non lo sa fare, un `<canvas>` 2D), messo in `context.snapshots`
  con la parte `snapshotPart("w", width)`; un SVG resta un `<img>` inerte con
  l'URL del blob (mai nel DOM come SVG). L'URL si revoca con la `Lifetime`.
- Fermo: l'immagine in cache se c'è, sennò titolo e specie.
- Doppio clic: `port.open(path)` (la tela lo instrada in T14).
- Il lettore ha un tetto: oltre 64 MiB `canvas.card.too_large`.
Casi limite: immagine 1×1 e 20 000×20 000 (si riduce, non si decodifica
intera due volte); formato che il motore non decodifica (HEIC, AVIF:
scheda di file con `canvas.card.unreadable`); GIF animata (la prima
immagine, ferma); file che cambia mentre si decodifica; `null` dalla porta
(`context.missing()`).
Fatto quando: `image.test.ts` prova la riduzione (larghezza chiesta a
`createImageBitmap`), la cache (seconda accensione senza `read`), SVG come
`<img>`, il tetto, il file mancante, la revoca dell'URL a `destroy`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/image.test.ts
Stato: [x] fatto
  Da rivedere: T39 e T78 lo cambiano (D-21; T78 per la zona di
  un'immagine, D-1 (b)).

## T6 · La scheda PDF

Perché: C4 e il passo: una pagina del PDF nella scheda, sfogliabile.
Tocca: `apps/client/src/editors/canvas/cards/pdf.ts` (nuovo),
`apps/client/src/editors/canvas/cards/pdf.test.ts` (nuovo).
Non toccare: `editors/media/pdf-view.ts` (si usa `PdfEngine` così com'è);
`editors/spatial/pdf/` (le annotazioni); il formato `.canvas` (la pagina non
si salva: D-5).
Dipende da: T1, T2
Cosa fare:
- `export function pdfCardRenderer(port: PdfCardPort): CardRenderer`,
  `kinds: ["pdf"]`, con `interface PdfCardPort { read(path): Promise<Uint8Array
  | null>; load: PdfEngineLoader; watch(path, changed): () => void }` (in
  T12: la `ResourceTransport` e `options.media.pdfLoader ?? loadPdf`, come
  le annotazioni in `bootstrap.ts`).
- Vivo: apre il `PdfEngine`, disegna la pagina corrente con `renderPage` in
  un `<canvas>` largo quanto la scheda per lo zoom (al più 2× la scheda),
  mette i pixel in cache (parte `snapshotPart("page-N", width)`); «3 / 24»
  in basso, ‹ e › ai lati.
- La pagina di partenza: `#page=N` del `subpath` (da 1), sennò la prima;
  fuori dall'intervallo, la prima.
- `key()`: PgSu e PgGiù cambiano pagina e restituiscono `true`; Home e Fine
  la prima e l'ultima.
- Fermo: `destroy` del `PdfEngine` (un PDF chiuso non tiene il worker), resta
  l'immagine della pagina dalla cache.
- `resize()`: ridisegna alla nuova larghezza a fine gesto.
- `page()` del `CardView` dà la pagina mostrata (da 1): la usa T19.
Casi limite: PDF di una pagina (niente frecce); PDF cifrato o rotto
(`canvas.card.unreadable`); pagina orizzontale; una resa interrotta da
un'altra (vince l'ultima); `destroy` mentre pdf.js carica; cambio pagina
mentre la scheda è ferma (non si può: i tasti arrivano solo da viva);
`subpath` `#page=0` o `#page=abc`.
Fatto quando: `pdf.test.ts`, con un `PdfEngine` finto, prova la pagina di
partenza, PgSu/PgGiù, la cache, la chiusura del motore da fermo, il
file mancante, la risposta tardiva dopo `destroy`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/pdf.test.ts
Stato: [x] fatto
  Da rivedere: T19, T36, T39, T79 e T82 lo cambiano (D-4 (a), D-5 (c),
  D-21; T79 e T82 per PdfCraft e gli estratti, D-1 (b)).

## T7 · La scheda di foglio

Perché: C3 e il passo: un `.xlsx` sulla lavagna mostra le sue celle, in
lettura, con la selezione e la copia.
Tocca: `apps/client/src/editors/grid/card.ts` (nuovo),
`apps/client/src/editors/grid/card.test.ts` (nuovo).
Non toccare: `editors/grid/engine.ts` e `paint.ts` (si importano tipi e
`paintCell`, non si cambiano); l'host (`grid_bytes_open`); la Tabella
(`src/tabella/`); `applyGridBytes`: la scheda non scrive (A-4, D-7).
Dipende da: T1, T2
Cosa fare:
- `export function sheetCardRenderer(port: SheetCardPort): CardRenderer`,
  `kinds: ["sheet"]`, con `interface SheetCardPort { host: GridHost;
  source(path): Promise<{ journal: string; base: string; format: string |
  null } | null>; paper(): GridPaper | undefined; watch(path, changed):
  () => void }`. In T12 `source` dà il giornale e la base della sessione
  aperta del documento se c'è (A-9), sennò `readDocument` (giornale vuoto,
  revisione dei byte su disco).
- Vivo: sceglie la superficie come fa il foglio (`family === "grid"`, la
  versione del protocollo, il formato), `openGridBytes`, il foglio attivo
  visibile, chiede con `gridBytesWindow` solo le righe e colonne che si
  vedono, disegna ogni cella con `paintCell` (le intestazioni comprese).
  Senza superficie o con un errore: `canvas.card.sheet_unavailable` e
  «Apri».
- `enter()`: lo scorrimento interno (rotella) chiede le finestre nuove; il
  trascinamento sceglie un rettangolo di celle; Ctrl+C copia come testo a
  tabulazioni (`tsvRows` di `editors/core/tsv.ts`, via `writeClipboardText`).
  `leave()`: la selezione si toglie, lo scorrimento resta.
- Fermo: `closeGridBytes` (nessuna sessione aperta per una scheda ferma);
  resta il DOM delle celle, `inert`.
- `watch`: il file cambia → da viva si riapre la sessione, da ferma si segna.
Casi limite: `Stale` all'apertura (il file è cambiato fra `source` e
l'apertura: si riprova una volta, poi `sheet_unavailable`); foglio vuoto;
foglio di 1 048 576 righe (solo la finestra); tutti i fogli nascosti; celle
unite (`merges`); `destroy` con una finestra in volo (la sessione si chiude
lo stesso, una volta sola); due schede dello stesso file (due sessioni).
Fatto quando: `card.test.ts`, con un `GridHost` finto, prova apertura,
finestra, scorrimento da attiva, selezione e copia, chiusura della
sessione da ferma e a `destroy`, `Stale`, e che `applyGridBytes` non è mai
chiamato.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/grid/card.test.ts
Stato: [x] fatto
  Da rivedere: T38, T42 e T88 lo cambiano (D-6 (b), D-7 (b), D-16 (c)).

## T8 · La scheda di pagina web

Perché: C7: titolo, sito e descrizione di una pagina, solo su richiesta.
Tocca: `apps/client/src/editors/canvas/cards/web.ts` (nuovo),
`apps/client/src/editors/canvas/cards/web.test.ts` (nuovo).
Non toccare: `editors/text/profiles/markdown/link-card.ts` (porta
CodeMirror: la scheda ha un tipo strutturale suo); `state/link-cards.ts`
(arriva da una porta in T12).
Dipende da: T1
Cosa fare:
- `export function webCardRenderer(port: WebCardPort): CardRenderer`,
  `kinds: ["web"]`, con `WebCardPort` della stessa forma di `LinkCardSource`
  (`view(url)`, `request(url)`, `watch(changed)`), tipi copiati in
  struttura, e `open(url)` (il visore di oggi, `media.openViewer`).
- Sempre: indirizzo e dominio come oggi (`canvas-url-text`,
  `canvas-open-url`); se `view(url)` ha una scheda, titolo, sito,
  descrizione e icona (l'icona solo se `isAllowedLink` di `ui/sanitize.ts`
  la ammette); se non c'è, «Mostra l'anteprima» chiama `request(url)`.
- Mai un iframe, mai una richiesta di rete fatta dalla scheda.
Casi limite: indirizzo non valido (resta il testo, nessun pulsante);
anteprima fallita (indirizzo e dominio, niente rosso); `watch` dopo
`destroy`; titolo lunghissimo (si taglia con i puntini dal CSS).
Fatto quando: `web.test.ts` prova i quattro stati della porta, che la
scheda non fa richieste da sé e che «Mostra l'anteprima» chiama `request`
una volta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/web.test.ts
Stato: [x] fatto

## T9 · Dove nascono le schede

Perché: G1, G3, G6: più file insieme in griglia, in ordine di nome, sotto
il puntatore; oltre 12 in un gruppo.
Tocca: `apps/client/src/editors/canvas/drop-layout.ts` (nuovo),
`apps/client/src/editors/canvas/drop-layout.test.ts` (nuovo).
Non toccare: `engine.ts` (la usa T15); il gruppo di Ctrl+G della tela (la
regola dei 24 px è la stessa, il codice no).
Dipende da: T1
Cosa fare:
- Funzioni pure, senza DOM: `bornSize(kind: CardKind, image?: { width;
  height }): CardSize` con le misure di D-11; `dropLayout(items: readonly {
  path: string; kind: CardKind; size: CardSize }[], at: { x; y }):
  { cards: { path; x; y; width; height }[]; group: Rect | null }`.
- Ordine per nome con `Intl.Collator(undefined, { numeric: true })` sul
  nome del file; colonne `ceil(sqrt(n))`; 24 px fra le schede; l'angolo in
  alto a sinistra della prima al punto; tutto agganciato a 8 px come la
  tela (`CANVAS_SNAP`).
- Oltre 12 elementi: `group` è il rettangolo che li contiene con 24 px di
  margine (l'etichetta la mette T15, con il numero).
- `markdownTable(rows: readonly string[][]): string`: la prima riga è
  l'intestazione, le barre verticali nelle celle si scrivono `\|`, le
  righe corte si allungano.
Casi limite: zero elementi; un elemento; 13 (il gruppo); 500; nomi uguali
in cartelle diverse; nomi con numeri («foto 2», «foto 10»); un'immagine
senza misura; una tabella di una cella; celle con a capo (diventano
spazi).
Fatto quando: `drop-layout.test.ts` prova ordine, griglia, aggancio,
gruppo, le misure per specie, l'immagine 4000×1000 → 480×120, e la tabella.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/drop-layout.test.ts
Stato: [x] fatto
  Da rivedere: T29 lo cambia (D-11 (a)).

## T10 · Le porte per portare dentro

Perché: G1 e G2: dall'albero nasce una scheda di file (oggi testo); dal
computer il file si copia una volta sola, con la notifica la prima volta.
Tocca: `apps/client/src/state/canvas-intake.ts` (nuovo),
`apps/client/src/state/canvas-intake.test.ts` (nuovo),
`apps/client/src/state/document-controller.ts` (solo `canvasAttachments`),
`apps/client/src/panels/settings.ts`, `apps/client/src/panels/settings.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `engine.ts` (la porta `CanvasAttachmentPort` ha già
`resolvePaths`); le note (`mountDocumentAttachments`); l'host e
`files.attachment-folder` (D-2); `ui/drag-types.ts`.
Dipende da: T3
Cosa fare:
- `canvas-intake.ts`, con le dipendenze passate (per i test):
  `resolveCanvasPaths(data, deps)`: legge `ENTRIES_DRAG_TYPE`
  (`draggedEntries`) o, se manca, `NOTE_DRAG_TYPE`; tiene solo gli id che
  l'host conferma (`existingDocuments`; se non risponde per i file che non
  sono note, un `resourceOpen` chiuso subito: il coder sceglie e lo
  scrive); mai il `text/plain`.
  `depositCanvasFiles(files, documentId, deps)`: `attachmentDeposit` di
  oggi, per ogni file `depositOrReuse` con `same` che legge il file del vault
  (`openResourcePort`, prima la lunghezza, poi i byte) e li confronta; alla
  fine, se uno almeno è stato riusato, `notify` «Già nel vault, uso quello»
  (uno solo, col numero); la prima volta che la lavagna copia file
  (`readState`/`writeState` con la chiave `canvas.attachments-noticed`),
  `notify` «Copiati in {folder}» con l'azione «Cambia cartella».
- `document-controller.ts`: `canvasAttachments` usa le due funzioni.
- `panels/settings.ts`: `export function revealSetting(key: string):
  Promise<void>`: apre le Impostazioni come `#open-settings`, sceglie la
  scheda dove la voce sta, la tiene in vista (`pinnedRow`), la scorre in
  vista e dà il fuoco al suo campo. «Cambia cartella» la chiama con
  `files.attachment-folder`.
- `catalog.ts`, IT ed EN: `canvas.intake.reused` (con il conteggio),
  `canvas.intake.copied` («Copiati in {folder}»), `canvas.intake.change_folder`
  («Cambia cartella»).
Casi limite: un id dell'albero che è stato cancellato nel frattempo (si
scarta); voci miste note e file; 500 voci (una domanda sola all'host);
`readState` che fallisce (la notifica si mostra, e va bene); il file del
vault più lungo di 64 MiB (non è uguale, senza leggerlo); `revealSetting`
con una chiave che non c'è (apre le Impostazioni e basta); Impostazioni già
aperte.
Fatto quando: `canvas-intake.test.ts` prova che dall'albero arrivano solo
id confermati, che il doppione si riusa con una notifica, che la prima
volta c'è «Cambia cartella» e la seconda no; `settings.test.ts` prova
`revealSetting` su una voce di un'altra scheda.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/canvas-intake.test.ts src/panels/settings.test.ts
Stato: [x] fatto
  Da rivedere: T32 e T34 lo cambiano (D-3 (b), D-2 (d)).

## T11 · La tela tiene le schede

Perché: oggi `#render` rifà tutte le schede a ogni cambio; una scheda viva
deve sopravvivere a una modifica che non la riguarda.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (nuovo),
`docs/reference/canvas-cards.md` (da T1).
Non toccare: lo strato d'inchiostro di N4 (`ink-layer.ts`, `ink-paint.ts`);
il nucleo di N3 (`wasm/core.ts`, `fub-canvas-core`); `surface.ts` e
`bootstrap.ts` (T12); le schede di testo e i gruppi (si disegnano come
oggi).
Dipende da: T1; la base di N4 (A-15, «La base di N4» in «Chi aspetta
chi»): N6 riallineato a `piano/n4-inchiostro` con N4 fino a T21 e T22
fatti (salvo T15), e dentro N3 fino a T22
Cosa fare:
- Un'opzione nuova `cards?: CanvasCards` in `CanvasEngineOptions`, con
  `CanvasCards { registry: CardRegistry; snapshots: CardSnapshots }`.
- La resa diventa a chiavi: una mappa id → elemento e vista; a ogni resa
  si aggiornano posizione e misura di chi c'è, si crea chi è nuovo, si
  distrugge chi è sparito; il corpo di una scheda si rifà solo se cambiano
  `type`, `file`, `subpath`, `url`, `text` o `label`.
- Per ogni scheda con una specie e un renderer: `mount(node, corpo,
  "snapshot", context)`, con una `Lifetime` sua; senza renderer, il corpo
  di oggi. `data-card-kind` e `data-card-mode` sul `.canvas-node`.
- `context.missing()` per ora mostra il segnaposto di oggi (T16 lo cambia).
- `destroy` della tela distrugge ogni vista, una volta.
- Nella pagina: la sezione «Come la tela tiene le schede».
Casi limite: `setDoc` dall'esterno con le stesse schede (nessuna
rimontatura); annulla che riporta una scheda tolta (nuova vista); id
cambiato con lo stesso file (vista nuova); 2000 schede
(`MAX_INTERACTIVE_NODES`, oltre il limite come oggi); la lavagna in sola
lettura; un renderer che lancia in `mount` (la scheda di file di oggi, la
tela va avanti).
Fatto quando: `engine-cards.test.ts`, con un renderer finto che conta
`mount` e `destroy`, prova che spostare, ridimensionare, colorare o
scrivere in un'altra scheda non rimonta niente, che cambiare il file
rimonta, che togliere distrugge; i test di `engine.test.ts` e di N4
passano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [x] fatto (2026-11-10: resa a chiavi in `#placeCards`, il corpo si rifà solo se cambia `cardBodyKey`; 13 prove in `engine-cards.test.ts`, rosse tutte sul `#render` di prima; la frase sugli 879 ms in `docs/misure/lavagna-inchiostro-2026-11-09.md` si aggiorna con la rimisura di T24)

## T12 · Il collegamento

Perché: i renderer di T4–T8 e le porte di T10 arrivano alla tela vera.
Tocca: `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/state/document-controller.ts`,
`apps/client/src/canvas-cards.e2e.test.ts` (nuovo).
Non toccare: `engine.ts` (T13 nella stessa ondata); `canvas-intake.ts`
(T10); `host/fake.ts`, salvo ciò che manca per la prova (lo dice il
rapporto).
Dipende da: T4, T5, T6, T7, T8, T10, T11; N3 T16 (nella base, A-15)
Cosa fare:
- `bootstrap.ts`: dentro il montaggio pigro della tela (A-14) costruisce il
  registro con i cinque renderer e una `CardCache` per finestra; le porte
  vengono da un'opzione nuova `canvasCards?: CanvasCardPorts` (note,
  immagini, PDF, foglio, web), più `options.media` e `gridHost` che ci sono.
  La scheda di foglio arriva con `import()` al primo foglio.
- `surface.ts`: passa `cards` alla tela.
- `document-controller.ts`: le porte: la nota con `renderEmbed` e la stessa
  montatura delle schede di testo; immagini e PDF con `mediaTransport`;
  il foglio con `documentSessions.inspect(doc)` o `api.readDocument`, e
  `gridHost`; il web con `linkCardView`, `requestLinkCard`,
  `on("link-cards")`; ogni `watch` con `onEvent("entry_changed")` per quel
  percorso, che chiama anche `snapshots.forget(path)`.
- `canvas-cards.e2e.test.ts`, sulla shell vera e l'host finto: una lavagna
  con una scheda di nota e una d'immagine; aperta e inquadrata, la nota
  mostra il suo titolo reso, l'immagine ha il suo `<img>` o `<canvas>`.
Casi limite: la tela senza porte (un'altra finestra, le prove vecchie):
tutto come oggi; il vault che cambia mentre una scheda carica; un evento
`entry_changed` per un file che nessuna scheda mostra; due lavagne aperte
sullo stesso file.
Fatto quando: la prova e2e passa; con `canvasCards` assente
`engine.test.ts` e `shell.e2e.test.ts` passano senza cambiare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-cards.e2e.test.ts
Stato: [x] fatto (2026-11-10: `CanvasCardPorts` in `bootstrap.ts` = nota, foglio, web, `open`, `watch`; immagini e PDF dalla `transport` di `options.media`; registro per superficie, `CardCache` una per finestra e svuotata al cambio di vault; `watch` ascolta anche `document_*`, perché note e fogli non mandano `entry_*`; l'e2e accende le viste a mano finché T13 non c'è)

## T13 · Vive solo le schede utili

Perché: N1 e N4 di `lavagna.md`, terzo punto del passo: la lavagna resta
fluida con 300 schede.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`docs/reference/canvas-cards.md` (da T1).
Non toccare: `cards.ts` (le regole stanno lì, da T1); `ink/quiet.ts` (si
usa la stessa `PenQuiet` della tela di N4); la camera (`#applyCamera`: lo
spostamento resta una trasformazione, N3).
Dipende da: T11; N4 T2 e T12 (nella base, A-15)
Cosa fare:
- A fine gesto (A-7), al cambio del documento e quando la vista cambia
  misura: `liveCardIds` con la vista in coordinate della lavagna e lo zoom,
  poi `updateLiveCards` con la `PenQuiet` della tela.
- Durante un gesto nessuna scheda cambia modo; con la penna giù il lavoro
  aspetta che si alzi (PenQuiet).
- `resize()` delle schede ridimensionate a fine gesto.
- Nella pagina: la sezione «Vive e ferme», con il percorso di un gesto.
Casi limite: zoom che attraversa 0,35 in un gesto solo; una scheda
trascinata da fuori a dentro la vista; la lavagna nascosta (un'altra
linguetta: niente cambi finché non torna in vista); 300 schede tutte in
vista a zoom 0,4 (ne vivono 40); la penna giù durante uno spostamento col
dito (N4 T14).
Fatto quando: `engine-cards.test.ts` prova che dopo lo spostamento le
schede in vista sono vive e le altre ferme, che sotto 0,35 nessuna è viva,
che mai più di `MAX_LIVE_CARDS`, e che con la penna finta giù nessuna
cambia modo fino a quando si alza.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [x] fatto (2026-11-10). Differenze: la lavagna nascosta è anche
un antenato `[hidden]` o `checkVisibility()` falso, e il ritorno lo dice il
`ResizeObserver` del viewport; la scelta si rifà anche dopo ogni resa e con
lo zoom dai pulsanti e dai tasti; a `liveCardIds` vanno solo le schede con
una vista; `WHEEL_SETTLE_MS = 150` esportato; `data-card-mode` cambia solo
se `setMode` riesce. La prova e2e non chiama più `setMode`.

## T14 · Entrare e uscire

Perché: C3: la rotella sopra un foglio sposta la lavagna finché non ci si
entra; dentro, scorre il foglio, senza restarci intrappolati.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: i renderer (hanno già `enter`, `leave`, `key`); la scrittura
delle schede di testo (`#beginCardEdit`); l'inchiostro (la penna scrive
sopra anche una scheda attiva: N4).
Dipende da: T12, T13
Cosa fare:
- Un clic su una scheda la sceglie (come oggi), anche sopra un link (A-12).
- Ctrl+clic (Cmd+clic su macOS) su un link dentro una scheda, attiva o no,
  lo segue subito, come lo segue un clic dentro una scheda attiva
  (D-18 (c)): il link di una nota apre la nota (`[[…]]` e Markdown), un
  indirizzo web passa dall'apertura sicura dei link di Fub. Ctrl+clic fuori
  da un link fa ciò che fa oggi (aggiunge alla scelta).
- Un clic dentro una scheda già scelta, o Invio con una scheda scelta che
  non è di testo, chiama `enter()`; se `true`, la scheda è attiva
  (`data-card-active`): il contenuto riceve puntatore e tastiera; la
  rotella sopra di lei va a lei; «Esc per uscire» (`canvas.card.exit_hint`)
  compare sopra.
- Esc, un clic fuori, o la scheda che esce dalla vista: `leave()`.
- Con la scheda scelta e non attiva, `key()` riceve PgSu, PgGiù, Home,
  Fine (il PDF).
- Una scheda attiva resta viva anche se la regola di T13 la spegnerebbe.
- Doppio clic su una scheda d'immagine: il visore; su una nota o un
  foglio: come Invio.
- `structure.css`: fuori da una scheda attiva il contenuto non prende il
  puntatore (`pointer-events`), dentro sì; lo scorrimento interno.
Casi limite: Esc mentre si sceglie un rettangolo di celle; entrare in una
scheda ferma (diventa viva, poi entra); due clic veloci; sola lettura;
tastiera sola (Tab arriva alla scheda, Invio entra, Esc esce); la scheda
attiva tolta da un annulla.
Fatto quando: `engine-cards.test.ts` prova rotella fuori e dentro, Esc,
clic fuori, Invio, PgGiù sulla scheda scelta, che un clic su un link di
una scheda non attiva non lo segue, che Ctrl+clic (e Meta+clic) sullo
stesso link lo segue subito e Ctrl+clic fuori da un link aggiunge alla
scelta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [x] fatto (2026-11-10). Differenze: Ctrl+trascinare sposta ancora la
lavagna (il codice lo faceva già); Ctrl+clic fermo su una scheda la
aggiunge o la toglie dalla scelta. Invio o doppio clic dove non si entra
(PDF, web) aprono il campo come prima; il doppio clic sull'immagine lo
lascia al visore (T5). Link, pulsanti e immagine prendono il puntatore
anche fuori dalla scheda attiva; il clic semplice lo ferma la tela. Il
link lo segue la montatura sicura di `mount.ts`. `cards.ts` non cambia.

## T15 · Trascinare e incollare

Perché: G1, G3, G6 e il primo punto del passo, nella tela.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `drop-layout.ts` (si usa); `canvas-intake.ts` (si usa dalla
porta); `editors/text/profiles/markdown/paste.ts` (arriva da una porta).
Dipende da: T9, T12, T14, T29 (le misure di nascita senza aggancio)
Cosa fare:
- `#intake`: le schede nascono con `bornSize` e `dropLayout` al punto del
  rilascio; per le immagini la misura viene da una porta nuova
  `measureImage?(path): Promise<{ width; height } | null>` (in
  `bootstrap.ts` dalla `ResourceTransport` e `decodeImage`); oltre 12 un
  gruppo con l'etichetta `canvas.intake.group` («{count} file»), già scelto;
  tutto in un commit solo (un annulla).
- Incollare: sotto il puntatore se è sulla lavagna (l'ultima posizione
  vista dentro la vista), sennò al centro come oggi; celle copiate (HTML
  con una tabella, o testo a tabulazioni su più righe): una porta nuova
  `clipboardMarkdown?(data): Promise<string | null>` (in `bootstrap.ts`
  `markdownFromClipboard`), e per il testo a tabulazioni `parseTsv` più
  `markdownTable`: una scheda di testo.
- Il fantasma: durante `dragover` con file o voci dell'albero, rettangoli
  tratteggiati (`canvas-drop-ghost`, solo struttura) dove nasceranno; il
  numero da `dataTransfer.items.length`, 1 se non si sa; spariscono a
  `dragleave` e `drop`.
- Il rilascio su una scheda di file ne cambia il file come oggi (A-8).
Casi limite: rilascio fuori dalla vista (non c'è); 40 foto; un file che
l'host rifiuta a metà (le schede dei file andati nascono, l'errore come
oggi in `canvas-intake-error`); una cartella del sistema con 500 file;
`dragover` senza tipi leggibili (WebKit); incollare mentre si scrive in una
scheda di testo (va nel testo, come oggi); misura dell'immagine che non
arriva (la misura di serie).
Fatto quando: `engine.test.ts` (i rilasci simulati di oggi) prova griglia,
ordine, gruppo oltre 12, un solo annulla, incolla sotto il puntatore, celle
come tabella.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [x] fatto (2026-11-10). Differenze: durante `dragover` si contano
solo gli item di tipo file (le voci dell'albero non si contano prima del
rilascio): zero fa un fantasma. La misura di un'immagine aspetta al più 3 s
(`MEASURE_IMAGE_TIMEOUT_MS`), quattro alla volta, e legge al più 64 MiB; le
porte `measureImage` e `clipboardMarkdown` in `bootstrap.ts` caricano il
loro codice solo quando servono. Punto e scheda sotto il puntatore si
prendono prima del deposito. La scheda nata dalle celle resta 320×160
(D-11 non dà misura alle schede di testo). Il caso «l'host rifiuta un file
a metà» non è fatto (serve `canvas-intake.ts`): va a T15b. In più la
pagina `docs/reference/canvas-cards.md` («Il rilascio e l'incolla»).

## T15b · Il rifiuto a metà del deposito

Perché: caso limite di T15 rimasto aperto: oggi `depositCanvasFiles` lancia
l'errore e scarta i percorsi già depositati, così non nasce nessuna scheda
e i file già copiati restano nel vault senza scheda.
Tocca: `apps/client/src/state/canvas-intake.ts`, `canvas-intake.test.ts`,
`apps/client/src/editors/canvas/engine.ts`, `engine.test.ts`,
`docs/reference/canvas-cards.md`.
Non toccare: l'host; `drop-layout.ts`.
Dipende da: T15, T32, T34 (toccano `canvas-intake.ts` prima)
Cosa fare: un errore tipizzato del deposito che porta i percorsi già
depositati; `#intake` fa nascere le loro schede (griglia e un annulla come
T15) e poi mostra l'errore in `canvas-intake-error` come oggi.
Casi limite: il primo file già rifiutato (nessuna scheda, solo l'errore);
la lavagna cambiata durante il deposito (niente schede, come oggi).
Fatto quando: `canvas-intake.test.ts` prova che l'errore porta i percorsi
andati; `engine.test.ts` che le loro schede nascono e l'errore si vede.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/canvas-intake.test.ts src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T16 · Il file mancante

Perché: C15: una scheda il cui file non c'è più resta, e dice che cosa fare.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts` (da T11),
`apps/client/src/editors/core/bootstrap.ts` (la firma di
`onPickCanvasFile`), `apps/client/src/state/document-controller.ts`
(`pickCanvasFile`), `apps/client/src/i18n/catalog.ts`.
Non toccare: `pickFromList` (le voci arrivano già ordinate); `rewrite_links` del provider (rinominare dentro Fub aggiorna
già i percorsi: O2); i renderer (chiamano già `missing()`).
Dipende da: T15
Cosa fare:
- `context.missing()`: il corpo diventa «File mancante: {path}»
  (`canvas.card.missing`) con «Ritrova…» e «Togli dalla lavagna».
- «Ritrova…»: il selettore di file di oggi (`onPickFile`, in
  `document-controller.ts` `pickCanvasFile`) prende un nome facoltativo e
  mette per prime le voci con quel nome; il file scelto sostituisce il
  percorso nella scheda (un commit, un annulla).
- «Togli dalla lavagna»: toglie la scheda, come Canc.
- Quando il file torna (`watch`), la scheda si rimonta da sé.
Casi limite: il file torna mentre il selettore è aperto; sola lettura
(nessun pulsante); una scheda di link (non manca mai); molte schede
mancanti insieme (una cartella spostata fuori da Fub).
Fatto quando: `engine-cards.test.ts` prova lo stato, «Ritrova…» con un
percorso scelto e annullato, «Togli», e il ritorno del file.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [ ] da fare

## T17 · Il menu della scheda

Perché: il menu «Scheda della lavagna» di `tasto-destro.md`: rosso in fondo,
colori come scelte esclusive, «Togli» perché il file resta.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/core/editor-menu.ts` (il menu ha già voci, sottomenu,
`checked`, `danger`); il menu del vuoto e quello dei fili; i colori oltre i
sei e il loro aspetto (T47, D-13 (c)).
Dipende da: T16, T48 (le voci vengono dal catalogo dei comandi)
Cosa fare:
- La testata del menu: «Scheda di {specie} · {nome}» (`canvas_menu.header`).
- L'ordine: la riga degli appunti come oggi; Apri; Apri a lato (una porta
  nuova `onOpenPathBeside?`, come `onOpenWikilinkBeside` delle note, in
  `surface.ts`, `bootstrap.ts` e `document-controller.ts`); Collega… · C;
  ———; Colore › con i sei colori di oggi come scelte esclusive (radio, non
  spunta); Disponi › (Davanti Ctrl+], Dietro Ctrl+[, ———, Allinea…,
  Distribuisci…, con le voci di oggi); Duplica · Ctrl+D; ———; Togli dalla
  lavagna · Canc, rosso; Sposta anche il file nel cestino, rosso, in fondo,
  solo sulle schede di file. Ogni voce è un comando del catalogo di T48,
  con il suo nome e il suo tasto.
- «Togli dalla lavagna» (anche Canc e Backspace) toglie la scheda, mai il
  file, e dice «Tolta dalla lavagna. Il file resta.» (`canvas.card.removed`)
  con «Annulla», che fa ciò che fa Ctrl+Z; più schede: «{n} schede tolte
  dalla lavagna. I file restano.». Una scheda di testo o un gruppo, senza
  file: «Scheda tolta.» con lo stesso «Annulla» (il sesto scenario del
  pigro, T89); «I file restano» solo se fra le tolte c'è una scheda di
  file.
- «Sposta anche il file nel cestino» toglie la scheda e manda il file nel
  cestino di Fub con il comando che usa l'albero (`COMMANDS.trash`, una
  porta nuova `onTrashPath?` come le altre in `surface.ts`, `bootstrap.ts`
  e `document-controller.ts`); il file si ritrova nel cestino, e la
  notifica dice dove. Non è mai la conseguenza di un tasto (`lavagna.md`).
- Il tasto C con una scheda scelta comincia il collegamento come il
  pulsante → della testata; Ctrl+] e Ctrl+[ come «Davanti» e «Dietro».
- Su una scheda di pagina web, «Mostra l'anteprima»; su una scheda d'immagine,
  «Apri nel visore».
Casi limite: più schede scelte (la testata dice «{n} schede», niente
Apri); un gruppo (il suo menu di oggi); sola lettura (le voci che
cambiano sono spente, non nascoste); C mentre si scrive in una scheda di
testo (va nel testo); la stessa nota in due schede e «Sposta anche il file
nel cestino» (tolte tutte e due, la notifica lo dice); il cestino che
rifiuta (la scheda resta, l'errore dell'host); un'altra modifica dopo il
togliere (la notifica sparisce, così il suo «Annulla» annulla sempre il
togliere e niente altro).
Fatto quando: `engine.test.ts` prova l'ordine delle voci, il pericoloso in
fondo, i colori radio, C, Ctrl+] e Ctrl+[, la notifica di «Togli» col suo
«Annulla», e che «Sposta anche il file nel cestino» chiama la porta del
cestino una volta per file e mai da tastiera.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T18 · La scheda dei file Craft

Perché: C8 e il passo: un file di VectorCraft, PhotoCraft o FigCraft mostra
l'anteprima di N7, con «Apri con».
Tocca: `apps/client/src/editors/canvas/cards/craft.ts` (nuovo),
`apps/client/src/editors/canvas/cards/craft.test.ts` (nuovo),
`apps/client/src/editors/canvas/cards.ts` (da T1: le estensioni Craft in
`cardKindOf`), `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts`.
Non toccare: `editors/craft/` e `state/craft-previews.ts` di N7 (si usano);
`panels/open-with.ts` di N7.
Dipende da: T12; N7 T14 e T16; K5 T24 per «Accendi…»
Cosa fare:
- `cardKindOf`: le estensioni che N7 dà alle specie Craft in
  `ui/format-kind.ts` → `craft`.
- `craftCardRenderer(port)`: l'immagine di `previewOf(path)` (N7) in cache
  come le immagini; «Apri con» apre il pannello di N7; con il componente
  acceso «Apri» apre la modalità di Fub; con il componente spento e K5 T24
  fuso, «Accendi…».
Casi limite: anteprima che non c'è (scheda di file); componente acceso
mentre la scheda è viva; un file Craft rotto.
Fatto quando: `craft.test.ts` prova anteprima, «Apri con», componente
spento; `cards.test.ts` prova le estensioni nuove.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards
Stato: [ ] da fare

## T19 · L'inchiostro sulla pagina del PDF

Perché: C4 e D-4 (a): i segni della pagina 3 non devono restare sopra la
pagina 4; cambiando pagina il tratto sparisce con lei e torna tornandoci.
Tocca: `crates/fub-canvas-core/src/ink.rs` (di N3 e N4),
`crates/fub-canvas-core/tests/` (di N3: i vettori),
`apps/client/src/__fixtures__/canvas-ink/` (di N4: vettori nuovi,
scritti a mano), `apps/client/src/editors/canvas/ink-record.ts` (di N4),
`apps/client/src/editors/canvas/anchor.ts` (di N4),
`apps/client/src/editors/canvas/cards.ts` (da T1: `pageBox?()` nel
`CardView`), `apps/client/src/editors/canvas/cards/pdf.ts` e `pdf.test.ts`
(da T6: `pageBox()`), `apps/client/src/editors/canvas/engine.ts` (dà ad
`anchor.ts` la pagina e il riquadro della scheda sotto il tratto),
`apps/client/src/editors/canvas/engine-ink-anchors.test.ts` (nuovo),
`docs/reference/canvas-ink.md` (di N4), `docs/reference/canvas-cards.md`
(da T1), `docs/decisions/` (un ADR nuovo, «Le ancore di contenuto», il
primo numero libero quando si fonde), `docs/decisions/README.md`.
Non toccare: le ancore `card` e `free` di N4 (restano identiche, byte per
byte); il `.fubann` del PDF (l'inchiostro resta della lavagna: domanda
aperta di `lavagna.md`, A-25); la regola `inkFit` di N4 (`ink-fit.ts`: la
allarga T39).
Dipende da: T6, T13; N4 T8–T12 (nella base, A-15); D-4 (a), risposta del
2026-11-02
Cosa fare:
- L'ancora `{"kind":"page","page":3,"width":595,"height":842}`: la pagina
  da 1, e la misura della pagina in punti PDF (1/72 di pollice, la pagina
  come si vede, con la sua rotazione); i punti del tratto sono in punti PDF
  dall'angolo in alto a sinistra di quella pagina. Così un altro programma
  che ha il PDF ritrova il posto senza sapere come Fub disegna la scheda.
  In Rust e TypeScript, letta e scritta allo stesso modo (i vettori nuovi
  passano in tutti e due); un campo sconosciuto si conserva come per le
  altre (A11 di N3); `page` non intero o minore di 1, `width` o `height`
  non positivi: l'ancora non vale, il tratto resta nel file com'era e non si
  disegna.
- `pageBox()` della scheda PDF: la misura della pagina mostrata in punti e
  il rettangolo dove la scheda la disegna, in unità della lavagna dentro la
  scheda; `null` se nessuna pagina si vede (la scheda non è mai stata viva
  e non ha un'immagine ferma). Vale da viva e da ferma: la scheda ferma
  mostra l'immagine di una pagina, e quella pagina ha la sua ancora.
- Un tratto che comincia sopra la pagina di una scheda PDF prende
  l'ancora di quella pagina (`page()` e `pageBox()`); sopra la scheda ma
  fuori dalla pagina, l'ancora `card` di N4. Si disegna solo quando la
  scheda mostra quella pagina, mappando la pagina sul rettangolo di
  `pageBox()`, e tagliato alla scheda.
- L'ADR «Le ancore di contenuto»: perché un'ancora nuova e non un campo
  della scheda, perché i punti PDF, che cosa vede Obsidian (niente: i campi
  `fub:ink` restano suoi), come cresce (T37 aggiunge le celle).
- `canvas-ink.md`: la sezione dell'ancora di pagina, con un esempio;
  `canvas-cards.md`: `pageBox()`.
Casi limite: un tratto che parte su una pagina e finisce fuori dalla
pagina o dalla scheda (resta della pagina, tagliato); la scheda che diventa
ferma con la pagina 5 (l'immagine ferma ha l'inchiostro della 5); il PDF
sostituito con uno più corto (l'ancora a una pagina che non c'è: il tratto
resta nel file e non si mostra); una pagina con un'altra misura nel PDF
nuovo (il tratto si scala sulla pagina nuova: la misura scritta serve a chi
non ha il PDF); una pagina ruotata; un file scritto da una versione di Fub
che non conosce `page` (il tratto resta e non si mostra, come un'ancora
sconosciuta di N4); sola lettura (non si scrive, si vede).
Fatto quando: i vettori nuovi passano in `cargo test -p fub-canvas-core`
e in Vitest; `engine-ink-anchors.test.ts` scrive sulla pagina 2, va alla 3
(il tratto sparisce) e torna (ricompare), e scrive fuori dalla pagina
(ancora `card`); `pdf.test.ts` prova `pageBox()` da viva, da ferma e
senza pagina; i tratti con le ancore di N4 restano identici byte per byte.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T20 · La misura S9

Perché: il primo punto del cancello: 300 schede, 20 fogli vivi, entro gli
obiettivi di N0. Con D-8 (b) S3 resta com'è, e la sua serie di misure
continua; nasce lo scenario S9 accanto (S8 è di N4 T15).
Tocca: `apps/client/bench/webview/fixtures.mjs`,
`apps/client/bench/webview/run.mjs`, `apps/client/bench/webview/budgets.json`,
`docs/development/webview-measurements.md`, `docs/misure/` (una pagina
nuova con la data), `docs/misure/README.md`.
Non toccare: S3 e gli altri scenari, con le loro soglie; il job `webview`
della CI (i coder non la toccano).
Dipende da: T13, T14; N3 T15 e N4 T15 (nel ramo, A-15); K3 T9 se è già in
`main` (tocca gli stessi file: chi si fonde dopo ricuce)
Cosa fare:
- `fixtures.mjs`: la lavagna `S9/Lavagna.canvas` con le 300 schede di S3
  e in più 20 `.xlsx` (`S9/Conti-01.xlsx`…, dal `workbook()` di oggi) in un
  blocco 5×4 in alto a sinistra; le note di S3 restano schede di nota. S3
  non cambia.
- `run.mjs`: S9 nella lista di default di `--only`; porta la vista sul
  blocco a zoom fra 0,4 e 0,6 con i gesti della tela (il coder sceglie quali
  e lo scrive); aspetta che le schede di foglio vive siano almeno 20
  (`[data-card-kind=sheet][data-card-mode=live]`); poi lo spostamento e lo
  zoom di S3; i valori `S9.liveCards` e `S9.frameGap` (p95 e massimo).
- `budgets.json`: in `targets` `S9.frameGap.p95: 16.7` e
  `S9.frameGap.max: 50`; le soglie della CI per S9 si ritarano dopo la prima
  misura sul runner, con il numero del giro nella nota (ci-soglia (a):
  nessun limite che c'è si alza).
- La pagina in `docs/misure/`: macchina, WebView, numeri di S3 e di S9,
  sha.
Casi limite: il driver senza rotella (il referto lo dice, come oggi);
meno di 20 schede vive dopo l'attesa (lo scenario fallisce, non misura
altro); WebKitGTK sotto Xvfb in software (i numeri dicono poco di una GPU:
la pagina lo scrive); S3 che cambia per le schede vive (il numero va nella
pagina accanto a quello di prima, ed è un difetto da riportare, non una
soglia da alzare).
Fatto quando: il comando gira e scrive S9 con `liveCards` ≥ 20 e S3 come
prima; la pagina delle misure c'è; la riga S9 di
`webview-measurements.md` dice «20 fogli vivi».
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && cd
../.. && cargo build --release --locked -p fub-app --features
tauri/custom-protocol && cd apps/client && xvfb-run -a npm run bench:webview
-- --only=S3,S9 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T21 · La prova del cancello

Perché: il secondo punto del cancello: trascini un `.xlsx` dal sistema, ci
scrivi sopra, chiudi e riapri; tutto al suo posto, il file intatto.
Tocca: `apps/client/src/canvas-cards.e2e.test.ts` (da T12),
`docs/development/ink-input-smoke-test.md` (una sezione «Le schede vive»).
Non toccare: il codice di prodotto (se la prova trova un difetto, il coder
lo scrive nel rapporto e il pianificatore apre un task).
Dipende da: T15, T17, T32 (lo stesso contenuto), T34 (la cartella); N4 T12
(nella base)
Cosa fare:
- Nella prova e2e: un `File` `.xlsx` (byte noti) rilasciato sulla lavagna;
  si controlla che l'host finto abbia scritto quei byte nella cartella degli
  allegati e che sia nata una scheda di foglio; un tratto con la penna
  finta di N4 sopra la scheda; si chiude e si riapre la lavagna: la scheda
  e il tratto ci sono; i byte del `.xlsx` sono gli stessi; nessuna scrittura
  oltre il `.canvas` e il file depositato. Un secondo rilascio dello stesso
  file non crea un file nuovo («Già nel vault»), neanche dopo averlo
  rinominato nel vault (T32); il file va nella cartella che dice
  `canvas.drop_folder` (T34).
- La prova a mano: i passi sulla app vera, con un `.xlsx` vero, e lo sha256
  prima e dopo.
Casi limite: l'host finto che non sa aprire un foglio (conta il file, non
le celle: lo scrive la prova); la prova a mano su Windows e macOS la fa
l'utente.
Fatto quando: la prova e2e passa; la sezione c'è e dice i comandi.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-cards.e2e.test.ts
Stato: [ ] da fare

## T22 · L'aspetto

Perché: le scelte d'aspetto (D-10–D-13) si fanno col prototipo, e qui
diventano il tema.
Tocca: `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/editors/canvas/engine.ts` (la testata: «↩ N» e «×2»),
`apps/client/src/i18n/catalog.ts`.
Non toccare: i renderer, salvo le classi che il prototipo chiede (lo dice
il prototipo); i colori dei tratti (sono del file).
Dipende da: T21, T25 approvato (D-10 (a): bordo d'accento, «Esc per
uscire», «↩ N» e «×2»; l'orchestratore fa vedere all'utente il prototipo
prima di far partire T22)
Cosa fare:
- Ciò che il prototipo approvato dice, per: la scheda attiva, «Esc per
  uscire», il fantasma del rilascio, la scheda «File mancante», l'ombra
  che dice «continua», le frecce e «3 / 24» del PDF, la scheda da lontano,
  le testate con «↩ N» (quante note la citano, dall'indice) e «×2».
- C14: passando sopra «×2» (o col fuoco), le altre schede della stessa
  nota si illuminano (`data-card-twin`), anche fuori vista: la banda di
  stato dice dove (T52, se c'è).
- Le classi nuove dichiarate in `anatomia/editors.ts`.
Casi limite: tema scuro e alto contrasto; moto ridotto (niente animazioni
sulle schede che si accendono); una testata stretta (i numeri prima del
titolo che si taglia); «×2» su 30 copie della stessa nota; la copia tolta
mentre è illuminata.
Fatto quando: `anatomia.test.ts` passa; `engine-cards.test.ts` prova
l'illuminazione delle gemelle; le foto del banco (skill `banco`), chiaro e
scuro, mostrano gli stati del prototipo accanto alle sue foto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/theme/scrittoio/anatomia.test.ts
Stato: [ ] da fare

## T23 · La pagina di prodotto

Perché: la pagina `product/lavagna.md` è riservata in `docs/README.md`
(«Le pagine che verranno»): nasce quando la lavagna v1 passa il cancello.
Tocca: `docs/product/lavagna.md` (nuovo), `docs/README.md`,
`docs/map/ownership.md`, `docs/map/dove-sta-x.md`.
Non toccare: `docs/architecture/editor-surfaces.md` (è a 449 righe);
`docs/reference/canvas-cards.md` (è il riferimento, non il prodotto).
Dipende da: T22, T89 (la pagina descrive la v1 intera, D-1 (b))
Cosa fare:
- La pagina: che cosa mostra una scheda per specie, come si entra ed esce,
  come si scrive dentro, come si porta dentro, dove vanno i file e quando
  un file «c'è già», l'impianto (colonna, opzioni, navigatore, ispettore,
  ricerca, Semplice), gli estratti, che cosa non fa ancora (con i rimandi
  a ciò che verrà), le scorciatoie. Se è troppo per 450 righe, la pagina
  rimanda a `docs/reference/canvas-cards.md` per i dettagli.
- `docs/README.md`: la riga passa da «Le pagine che verranno» alla tabella
  «Capire il prodotto».
- `ownership.md`: le regole «vive solo le utili», «un renderer non scrive:
  scrive l'editor vero, sulla sessione» (A-4) e «lo stesso contenuto non si
  copia due volte» con il file e il test che le presidiano; `dove-sta-x.md`: «le schede vive
  della lavagna» → `editors/canvas/cards.ts`.
Casi limite: i limiti di righe; i link verso pagine che N3 e N4 hanno
aggiunto (esistono solo dopo la loro fusione).
Fatto quando: `check-doc-links`, `check-doc-orphans` e `check-doc-size`
passano.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T24 · La seconda misura di N4 su questo ramo

Perché: l'accordo con N4 («Un nodo con N6» nel piano di N4): N4 T23 misura
la penna sopra la scheda di foglio viva, che c'è solo sul ramo di N6 da
T13; N4 entra in `main` solo dopo quella misura.
Tocca: niente sul ramo di N6, salvo lo `Stato:` di questo task; la pagina
e lo `Stato:` di N4 T23 stanno sul ramo di N4
(`docs/misure/lavagna-inchiostro-foglio-AAAA-MM-GG.md`,
`docs/misure/README.md`).
Non toccare: il codice di N6 e di N4; `budgets.json`; il prodotto (un
fotogramma lento si scrive con dove va il tempo, non si corregge qui).
Dipende da: T13; N4 T15 (lo scenario S8) e N4 T21 fatti; la base di N4
(A-15)
Cosa fare (lo fa l'orchestratore):
- Una cartella di lavoro a parte (`git worktree add` sotto
  `~/.cache/fub-k1/`, mai in `/tmp`), dal ramo di N6 dopo T13, con dentro
  N4 T15; se lo scenario di N4 T23 ha un commit suo sul ramo di N4, lo
  porta in quella copia (`git cherry-pick`), mai nel ramo di N6.
- Lancia lo scenario S8 come dice N4 T23: la scheda `voti.xlsx` viva prima
  della penna, dieci tratti sopra le celle, lo spostamento, tre giri, lo
  sha256 del `.xlsx` prima e dopo.
- La pagina delle misure e lo `Stato:` di N4 T23 vanno sul ramo di N4, col
  commit di N6 che si è usato; qui lo `Stato:` dice quel commit.
- Se un fotogramma supera 33 ms, la pagina dice dove va il tempo; se va
  nelle schede di N6 e non nell'inchiostro, l'orchestratore chiede al
  pianificatore di N6 un task.
- Alla fine toglie la cartella di lavoro (`git worktree remove`).
Casi limite: N4 T15 non ancora fatto (si aspetta); la scheda che non
diventa viva sotto Xvfb (la misura non vale: si dice, non si chiude); N6
riallineato dopo la misura (resta valida per il suo commit, che la pagina
nomina); il primo giro più lento (si dice, conta il peggiore).
Fatto quando: la pagina di N4 T23 è sul ramo di N4, con i tre giri, l'hash
e il commit di N6; lo `Stato:` di N4 T23 e quello di T24 lo dicono.
Prova: (nella cartella di lavoro) cd apps/client && npm run build && cd
../.. && cargo build --release --locked -p fub-app --features
tauri/custom-protocol && cd apps/client && xvfb-run -a npm run bench:webview
-- --only=S8 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T25 · Il prototipo delle schede

Perché: D-10 (a), D-13 (c), D-21, D-3 (b) e D-2 (d): come appaiono le
schede, i colori, le notifiche e le impostazioni si decide guardando,
prima dei task grafici che ne dipendono (A-26).
Tocca: `PLAN-ui/lavagna-schede.html` (nuovo), `PLAN.md` (la riga
«Prototipo:», la tabella «Dal prototipo», la risposta a D-21, A-19 e A-28
se cambiano), `DECISIONS.md` (una riga all'approvazione).
Non toccare: il prodotto; gli altri prototipi.
Dipende da: niente; parte subito
Cosa fare (la pagina la costruisce un coder; la fa vedere l'orchestratore):
- Il coder segue `.claude/skills/pianifica/prototipo.md`: token e classi di
  Fub (`theme/scrittoio/skin/editors.css`, `foundation.css`,
  `anatomia/editors.ts`), un blocco `<style>` per file di destinazione, solo
  il vocabolario `theme-2` (lo prova con `sanitizeThemeCss` in un test usa
  e getta), testi veri con `data-i18n`, nessuno stile in linea, gli stessi
  elementi e ruoli ARIA che il codice costruirà.
- La barra della pagina fa vedere: ogni specie di scheda (nota, documento,
  foglio, PDF, immagine, pagina web, Craft, file, CSV) ferma, viva, scelta e
  attiva con «Esc per uscire»; il titolo nelle tre varianti di D-21 (sopra,
  dentro, al passaggio), con un tratto a penna sopra un'immagine e sopra una
  pagina; la testata con «↩ 2» e «×2» e le gemelle illuminate (C14); «File
  mancante» con «Ritrova…» e «Togli dalla lavagna»; il fantasma del rilascio
  con 3 e con 47 elementi; il menu dei colori (i sei col nome, «Colori delle
  note», «Altro…»); le notifiche «Già nel vault come {path}, uso quello» con
  «Fanne una copia» e «Copiati in {folder}» con «Cambia cartella»; le righe
  di «Impostazioni › Lavagna» di T33 (nomi, descrizioni, valori di serie);
  i due livelli di dettaglio da lontano (A-22); le maniglie, i quattro
  punti, il filo al passaggio, l'etichetta «Si attacca a…» di un tratto;
  chiaro e scuro, piena e 700 px; un nome lunghissimo, 500 schede.
- In testa le note «Da decidere guardando»: D-21; il colore delle gemelle;
  dove sta «Esc per uscire»; i nomi delle impostazioni; il testo delle
  notifiche.
- L'orchestratore pubblica la pagina come Artifact e la fa vedere
  all'utente; ogni cambio chiesto va nella pagina, negli stessi blocchi
  `<style>`, poi si ripubblica e si rimostra.
- Al sì: «Approvato: AAAA-MM-GG» nella testa della pagina e nella riga
  «Prototipo:» del piano; la risposta a D-21 sotto D-21; una riga in
  DECISIONS.md; le classi nuove nella tabella «Dal prototipo», col file e
  il task. Se una scelta cambia, il pianificatore rivede A-19, A-28 e i task
  che ne dipendono prima che partano.
Casi limite: l'utente vuole un pezzo che chiede lavoro nuovo (un'icona nel
kit: si chiede al pianificatore); D-21 (b) o (c) (T39 cambia: il
pianificatore lo riscrive prima che parta); una regola che
`sanitizeThemeCss` scarta (si corregge prima di mostrare).
Fatto quando: la pagina c'è, passa la prova di `sanitizeThemeCss`, e ha
«Approvato» con la data nella pagina e nel piano; D-21 ha la risposta.
Prova: grep -n "Approvato" PLAN-ui/lavagna-schede.html PLAN.md
Stato: [x] fatto

## T26 · Il prototipo dell'impianto

Perché: D-1 (b): la lavagna prende l'impianto del disegno (R1, la colonna,
la riga delle opzioni, la barra della selezione, la banda, il navigatore,
l'ispettore, la ricerca, la lavagna vuota, il menu radiale, lo spazio
Semplice); si decide guardando, prima di T49–T65 (A-26).
Tocca: `PLAN-ui/lavagna-impianto.html` (nuovo), `PLAN.md` (la riga
«Prototipo:», la tabella «Dal prototipo»), `DECISIONS.md` (una riga).
Non toccare: il prodotto; `PLAN-ui/lavagna-penne.html` di N4 (si riusa il
suo menu delle penne così com'è, approvato).
Dipende da: niente; parte subito
Cosa fare (la pagina la costruisce un coder; la fa vedere l'orchestratore):
- Come T25, con `.claude/skills/pianifica/prototipo.md`, partendo dal DOM
  di `kit/tool-rail.ts`, `kit/options-bar.ts`, `kit/popover.ts`,
  `panels/selection-bubble.ts` e dell'impianto del disegno
  (`editors/spatial/tools/editor/chrome/`), con le loro classi.
- La barra della pagina fa vedere: la colonna (Selezione V, Mano H, Penna
  P, Evidenziatore, Gomma E, Lazo Q, Testo T, Collega C), con le tendine;
  la riga delle opzioni per ogni strumento, con dentro il menu delle penne
  di N4 così com'è; la barra della selezione sopra una, tre e venti schede;
  la banda di stato (zoom, schede scelte, «sola lettura», la cartella dei
  file); il navigatore chiuso e aperto; l'ispettore con «Schede» (in
  ordine di lettura), «Scheda» (numeri, colore, nodo grezzo), «Fili» e
  «Fonti»; Ctrl+F con 0, 3 e 200 risultati; la lavagna vuota che spiega da
  sé, con «Incolla»; il menu radiale; lo spazio Semplice; la notifica
  «Tolta dalla lavagna. Il file resta.» con «Annulla»; chiaro e scuro,
  piena e 700 px; focus su ogni controllo.
- Ctrl+/ (cerca fra i comandi) è quello del disegno così com'è
  (`command-search.ts`): la pagina lo mostra, non lo ridisegna.
- Note «Da decidere guardando»: quali strumenti stanno nella colonna di
  serie; dove sta il navigatore; l'ispettore aperto o chiuso di serie; che
  cosa resta nello spazio Semplice.
- Pubblicazione, cambi e approvazione come T25.
Casi limite: la colonna a 700 px (le tendine non escono dalla finestra);
la riga delle opzioni con il menu delle penne e una selezione insieme;
l'utente che chiede un pezzo del disegno che K5 sta cambiando (si chiede
al pianificatore: `editors/spatial/` non si tocca).
Fatto quando: la pagina c'è, passa `sanitizeThemeCss`, e ha «Approvato» con
la data nella pagina e nel piano.
Prova: grep -n "Approvato" PLAN-ui/lavagna-impianto.html PLAN.md
Stato: [x] fatto (2026-11-10: Approvato con le varianti consigliate: la colonna del disegno con le tendine, il navigatore in basso a destra, l'ispettore chiuso la prima volta e poi come lo si lascia, sei strumenti nello spazio Semplice; il menu delle penne nella riga delle opzioni resta solo da guardare)

## T27 · Il prototipo della modifica

Perché: D-7 (b): si scrive dentro le schede di nota, di foglio e di testo;
come si vede scrivere, uscire, una bozza, un conflitto e «Apri a lato per
questo» si decide guardando, prima di T41–T45 (A-26).
Tocca: `PLAN-ui/lavagna-modifica.html` (nuovo), `PLAN.md` (la riga
«Prototipo:», la tabella «Dal prototipo»), `DECISIONS.md` (una riga).
Non toccare: il prodotto; `editors/text/` e `editors/grid/` (la pagina ne
copia il DOM, non li cambia).
Dipende da: niente; parte subito
Cosa fare (la pagina la costruisce un coder; la fa vedere l'orchestratore):
- Come T25, partendo dal DOM della nota in Live (`editors/text/`), della
  barra di formato (`panels/format-bar.ts`) e del foglio
  (`editors/grid/card.ts`, la barra della formula).
- La barra della pagina fa vedere: una scheda di nota in scrittura, con la
  barra di formato nella riga delle opzioni; una cella del foglio in
  modifica, con la formula nella riga delle opzioni; una scheda di testo
  in Live che cresce fino a 480 px, poi va a capo; «Esc per uscire» e il
  secondo Esc; Ctrl+Invio che apre una scheda sotto; Ctrl+Maiusc+Invio a
  destra, collegata; la stessa nota aperta anche in un riquadro (le due
  copie si aggiornano); una bozza non salvata; un conflitto con la scelta;
  sola lettura (perché non si scrive); «Apri a lato per questo» per righe,
  colonne e formati; chiaro e scuro, piena e 700 px.
- Note «Da decidere guardando»: dove va la barra di formato; come si vede
  che la scheda è in scrittura e non solo attiva; il testo di «Apri a lato
  per questo».
- Pubblicazione, cambi e approvazione come T25.
Casi limite: una nota lunghissima in una scheda piccola; una formula
lunga; una scheda di testo con una riga di 2000 caratteri; il tema scuro
nelle celle colorate del file.
Fatto quando: la pagina c'è, passa `sanitizeThemeCss`, e ha «Approvato» con
la data nella pagina e nel piano.
Prova: grep -n "Approvato" PLAN-ui/lavagna-modifica.html PLAN.md
Stato: [ ] da fare

## T28 · Il prototipo degli estratti

Perché: D-1 (b) porta l'area S di `lavagna.md` (prendere solo il pezzo che
serve): il selettore, la scheda-estratto, il lettore da vicino e le fonti
si decidono guardando, prima di T74–T85 (A-26).
Tocca: `PLAN-ui/lavagna-estratti.html` (nuovo), `PLAN.md` (la riga
«Prototipo:», la tabella «Dal prototipo», A-25 se cambia),
`DECISIONS.md` (una riga).
Non toccare: il prodotto.
Dipende da: niente; parte subito
Cosa fare (la pagina la costruisce un coder; la fa vedere l'orchestratore):
- Come T25, partendo dal DOM di `kit/popover.ts`, `kit/list.ts`,
  `kit/number-field.ts` e delle schede di T4–T6.
- La barra della pagina fa vedere: il selettore attaccato alla scheda
  appena rilasciata, per una nota (le sezioni, dal sommario) e per un PDF
  (le miniature, il campo «3-5, 8, 20-», «#124», Maiusc+clic); «Esc tiene
  tutto», «Alt salta il selettore»; la scheda-estratto con pagine «una alla
  volta», «in riga» e «in colonna», una zona, una sezione, una figura;
  il lettore da vicino (Spazio) col posto che resta; le fonti di questa
  lavagna nell'ispettore; la zona di un'immagine (taglio e rotazione);
  blocchi e figure di un PDF al passaggio (segnati «aspetta PdfCraft»);
  chiaro e scuro, piena e 700 px; un PDF di 500 pagine, una nota senza
  titoli.
- Note «Da decidere guardando»: quando si apre il selettore (A-25); come
  si vede che una scheda è un estratto e non il file intero; dove va
  «Mostra tutto il file».
- Pubblicazione, cambi e approvazione come T25.
Casi limite: un PDF senza numeri stampati; un estratto di una sezione che
non c'è più; il selettore su una finestra di 700 px.
Fatto quando: la pagina c'è, passa `sanitizeThemeCss`, e ha «Approvato» con
la data nella pagina e nel piano.
Prova: grep -n "Approvato" PLAN-ui/lavagna-estratti.html PLAN.md
Stato: [ ] da fare

## T29 · Il foglio nasce 480×300

Perché: D-11 (a): il foglio nasce 480×300; oggi nasce 480×304 perché
`bornSize` aggancia anche le misure alla griglia di 8 px. Lo stesso
aggancio cambia le proporzioni esatte di un'immagine (A-16).
Tocca: `apps/client/src/editors/canvas/drop-layout.ts`,
`apps/client/src/editors/canvas/drop-layout.test.ts`,
`docs/reference/canvas-cards.md` (da T1: le misure di nascita).
Non toccare: `engine.ts` (ridimensionare a mano aggancia come oggi); le
lavagne che ci sono (le schede nate non cambiano misura).
Dipende da: niente; parte subito
Cosa fare:
- `BORN_SIZE`: il foglio 480×300.
- `bornSize` e `dropLayout` non agganciano più le misure: le arrotondano a
  interi e le tengono almeno `DROP_MIN_SIZE`; le posizioni sì
  (`DROP_SNAP`).
- In riga e in colonna la scheda dopo parte al primo multiplo di 8 che
  lascia almeno `DROP_GAP` (24 px): dopo un foglio alto 300 la riga sotto
  parte 328 px più in basso (28 px di spazio).
- Nella pagina: le misure di nascita e la regola dello spazio.
Casi limite: un'immagine 1×4000 (il lato corto resta 40, la proporzione
non si tiene: si dice); un PDF con la prima pagina orizzontale; le misure
che non si sanno ancora (la misura di serie); 47 elementi in griglia (tutte
le posizioni multiple di 8); un rilascio a una posizione con decimali.
Fatto quando: `drop-layout.test.ts` prova il foglio 480×300, un'immagine
16:9 nata 480×270 esatta, le posizioni tutte multiple di 8 e gli spazi
almeno 24; gli altri test di T9 passano senza cambiare, salvo il 304 che
diventa 300.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/drop-layout.test.ts
Stato: [x] fatto (2026-11-10). Differenza: arrotondare a interi (A-16)
cambia anche altri test di T9: il PDF 360×512 nasce 360×509 (256 → 254) e
la misura 321×243 resta tale, con la colonna dopo a 368; riscritti. Il
rettangolo del gruppo (oltre 12) ha lati non multipli di 8, come le
schede.

## T30 · Lo stesso contenuto: l'host

Perché: D-3 (b): un file è «già nel vault» se un file qualsiasi del vault
ha gli stessi byte, anche con un altro nome. Oggi il kernel sa
l'impronta di un file (`Vault::fingerprint`, SHA-256 a pezzi) e la tabella
delle voci la tiene (`StoredEntry::fingerprint`), ma nessuno cerca per
contenuto.
Tocca: `crates/fub-kernel/src/same_content.rs` (nuovo),
`crates/fub-kernel/src/lib.rs` (il modulo), `crates/fub-kernel/src/entries.rs`
(le voci della stessa misura, l'impronta registrata),
`crates/fub-kernel/src/vault.rs` (la chiamata pubblica),
`crates/fub-kernel/tests/same_content.rs` (nuovo),
`crates/fub-host/src/session.rs` (la funzione dell'host),
`docs/architecture/storage-and-identity.md` (una sezione «Lo stesso
contenuto»).
Non toccare: il formato di `.fub/data/entries.json` (l'impronta c'è già,
schema 5: nessun campo nuovo); `docs/reference/on-disk-layout.md` (è a 549
righe e il formato non cambia); l'IPC (T31); il client.
Dipende da: niente; parte subito
Cosa fare:
- `Vault::same_content(bytes_len, reader) -> Result<SameContent>`: i
  candidati sono le voci della stessa misura, fuori dal cestino, da
  `.fub/` e dalle cartelle escluse; per ognuno l'impronta che la voce ha,
  o quella calcolata a pezzi (`fingerprint_of`); i byte che arrivano si
  misurano nello stesso passaggio (`RevisionHasher`).
- Prima di rispondere «c'è», i byte del candidato si confrontano uno per
  uno con quelli che arrivano: l'impronta sceglie, i byte decidono.
- Un'impronta calcolata si registra nella voce solo se misura, data,
  segno del cambio e identità sono ancora quelli letti (come fa `enrich`):
  un file cambiato a metà non lascia un'impronta sbagliata.
- Il limite (A-17): al più 64 candidati e 512 MiB letti per domanda (valori
  di partenza, costanti con nome); oltre, o senza tabella delle voci, la
  risposta è «non so» e chi chiede copia.
- Mai un lucchetto del vault tenuto mentre si legge: si prendono le voci,
  si lascia, si legge, si rientra e si ricontrolla il segno del cambio
  prima di registrare.
- `SameContent`: `Found { id }`, `NotFound`, `Unknown { reason }`; un
  errore di lettura di un candidato lo salta, non fa fallire la domanda.
- La sezione nella pagina dell'architettura: che cosa vuol dire «lo stesso
  contenuto», i limiti, perché nel dubbio si copia.
Casi limite: due file uguali nel vault (il primo per percorso, sempre lo
stesso); un file nel cestino uguale (non conta); un file cambiato mentre
si legge (non conta, nessuna impronta registrata); 10 000 file della
stessa misura (il limite, «non so»); un file da 0 byte (si cerca come gli
altri); un file in `.fub/` o in una cartella esclusa (non conta); un
collegamento simbolico che esce dal vault (non lo segue: lo storage è
radicato); la tabella delle voci rotta o di una versione futura («non
so»).
Fatto quando: `cargo test -p fub-kernel --test same_content` prova trovato
con un altro nome, non trovato con la stessa misura e byte diversi, il
cestino escluso, il limite, il file cambiato a metà senza impronta
registrata, l'errore di lettura saltato; i test di `entries.rs` passano.
Prova: scripts/check.sh --rapido; cargo test -p fub-kernel; cargo test -p
fub-host
Stato: [ ] da fare

## T31 · Lo stesso contenuto: `resource_write`

Perché: D-3 (b): la lavagna deve poter chiedere all'host «se c'è già,
dimmelo e non scrivere» con la porta che usa già per depositare i file
(A-13). È un contratto pubblico: forma, specchio, prove e pagina.
Tocca: `crates/fub-host/src/resources.rs` (`ResourceWrite`,
`ResourceWriteReceipt`), `crates/fub-host/src/session.rs`,
`crates/fub-app/src/resources.rs` (`decode_resource_write_meta`,
`resource_write_body`), le prove dell'IPC in `crates/fub-app/`,
`apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`
(`resourceWrite`), `apps/client/src/host/fake.ts`,
`apps/client/src/__fixtures__/mirror-samples*.json` (rigenerati),
`docs/reference/ipc-contract.md` (una sezione nuova «Depositare un
file»).
Non toccare: la lavagna e `attachment-target.ts` (T32); il formato su
disco; gli altri campi della testata `x-fub-resource-write`.
Dipende da: T30
Cosa fare:
- Un campo nuovo, facoltativo, nella testata: `"reuse": "same-content"`,
  valido solo con `expected` nullo (un file nuovo); con `expected` dato è
  `BadArgs`. Senza il campo, tutto come oggi.
- Con il campo: l'host chiede a T30; `Found` → nessuna scrittura, la
  ricevuta dice il file che c'è; `NotFound` e `Unknown` → la scrittura di
  oggi.
- `ResourceWriteReceipt` ha un campo nuovo `reused: bool`
  (`#[serde(default)]`, così una ricevuta vecchia si legge) e, quando è
  vero, il `DocId` e la revisione del file che c'era.
- Lo specchio TypeScript (`contract.ts`), `resourceWrite(id, bytes,
  expected, vault?, options?)` in `ipc.ts` con `{ reuse: "same-content" }`,
  e l'host finto che fa la stessa cosa (confronto dei byte su tutti i file
  finti, gli stessi limiti); i campioni dello specchio rigenerati con
  `UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app`.
- La sezione «Depositare un file» in `ipc-contract.md`: la testata, i
  campi, `reuse`, la ricevuta, gli errori, i 64 MiB, e che nel dubbio si
  scrive.
Casi limite: `reuse` con un valore sconosciuto (`BadArgs`, mai ignorato
in silenzio); un client nuovo con un host vecchio (l'host rifiuta il
campo sconosciuto: il client lo prende come «non so» e deposita senza,
lo dice il rapporto); 64 MiB esatti; il file trovato che sparisce prima
della risposta (si scrive); i permessi (la stessa `Guard` di oggi).
Fatto quando: le prove dell'IPC in `fub-app` provano `reused` vero e falso,
`reuse` con `expected` (rifiutato), il valore sconosciuto e la ricevuta
vecchia senza `reused`; `npx vitest run src/host` passa con i campioni
nuovi; il fake e il vero rispondono uguale sugli stessi casi.
Prova: scripts/check.sh --rapido; cargo test -p fub-app; cargo test -p
fub-host; cd apps/client && npx vitest run src/host
Stato: [ ] da fare

## T32 · La lavagna riusa lo stesso contenuto

Perché: D-3 (b): un file trascinato dal computer che il vault ha già, con
qualsiasi nome, non si copia; la scheda mostra quello. Oggi
`depositOrReuse` legge i file della cartella degli allegati dal client
per confrontarli (T3, T10).
Tocca: `apps/client/src/editors/media/attachment-target.ts`
(`depositOrReuse`) e `attachment-target.test.ts`,
`apps/client/src/state/canvas-intake.ts` e `canvas-intake.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `depositAttachment` e il deposito delle note (le note
restano come oggi: D-3 riguarda la lavagna); `engine.ts`; l'host (T30,
T31).
Dipende da: T31, T25 approvato (il testo della notifica e «Fanne una
copia»)
Cosa fare:
- `depositOrReuse` chiede a `resourceWrite` con `{ reuse: "same-content"
  }` e non legge più i file del vault dal client; la risposta `reused`
  vuol dire «uso quello».
- La notifica «Già nel vault come {path}, uso quello» (`notify`, con
  l'azione «Fanne una copia»): «Fanne una copia» deposita i byte senza
  `reuse`, come una scrittura nuova, e la scheda passa al file nuovo con
  un commit che si annulla. Più file insieme: una notifica sola, «{n} file
  già nel vault, uso quelli», con «Fanne delle copie».
- Il resto del deposito come oggi (nomi, cartella, 64 MiB, errori).
Dal prototipo: la notifica e la sua azione (T25), i testi con le loro
chiavi.
Casi limite: lo stesso file rinominato a mano nel vault (lo trova); il
file del vault cambiato dopo (byte diversi: si copia); un file oltre i 64
MiB (rifiutato come oggi, prima di chiedere); un file uguale solo nel
cestino (si copia); un host che non sa `reuse` (si deposita senza, una
volta, e lo si ricorda per la seduta); «Fanne una copia» dopo che la
lavagna è stata chiusa (l'azione non c'è più: la notifica vive quanto il
suo toast); 40 foto di cui 10 già nel vault.
Fatto quando: `canvas-intake.test.ts` e `attachment-target.test.ts`, con
l'host finto, provano il riuso con un altro nome, la copia quando i byte
cambiano, «Fanne una copia», la notifica unica per più file, l'host che
non sa `reuse`, e che il client non legge più i file del vault per
confrontare; la foto della notifica somiglia al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/canvas-intake.test.ts src/editors/media/attachment-target.test.ts
Stato: [ ] da fare

## T33 · Le impostazioni della lavagna, seconda parte

Perché: D-2 (d), D-17 (b) e la sezione P di `lavagna.md`: la lavagna ha
le sue impostazioni; N4 T19 ha messo le prime due («Ricorda se scrivi col
mouse», «Il dito sposta le schede»), qui arrivano le altre che i task di
N6 leggono.
Tocca: `crates/fub-features/src/lavagna.rs` (le chiavi, `settings()`, le
stringhe in italiano e inglese, i test),
`crates/fub-host/tests/lavagna_feature.rs` (di N4 T19),
`apps/client/src/editors/canvas/preferences.ts` e `preferences.test.ts` (di
N4 T19), `settings-mirror.test.ts` (di N4 T19),
`docs/architecture/ink-and-tools.md` (la parte della lavagna).
Non toccare: le due impostazioni di N4 T19 (restano com'erano);
`files.attachment-folder` (le note non cambiano); `panels/settings.ts` (le
righe le disegna da sé); `engine.ts` (le leggono i task che le usano).
Dipende da: T25 approvato (nomi, descrizioni, valori di serie); N4 T19
(nella base, A-15)
Cosa fare:
- Le chiavi nuove, nel gruppo «Lavagna», come `draw.workspace` e
  `draw.suggestions` in `draw.rs`:

  | Chiave | Tipo | Di chi | Valori, di serie per primo |
  |---|---|---|---|
  | `canvas.drop_folder` | scelta | vault | `notes` (segue la cartella degli allegati delle note), `board` (accanto alla lavagna), `folder` (una cartella del vault) |
  | `canvas.drop_folder_path` | testo | vault | `Allegati`: la sottocartella accanto alla lavagna per `board`, il percorso nel vault per `folder` |
  | `canvas.wheel` | scelta | macchina | `pan` (sposta), `zoom` (ingrandisce) |
  | `canvas.finger_writes` | interruttore | macchina | spento |
  | `canvas.pen_button` | scelta | macchina | `radial` (il menu radiale), `eraser`, `pan` |
  | `canvas.grid` | interruttore | vault | acceso |
  | `canvas.snap` | interruttore | vault | acceso |
  | `canvas.workspace` | scelta | vault | `auto` (Semplice sui dispositivi solo a tocco), `full`, `simple` |
  | `canvas.parts_picker` | interruttore | vault | acceso |
  | `canvas.toolbar` | lista | vault | vuota: la colonna di serie (T49), come `draw.toolbar` |

- Nello specchio del client: ogni lettura da `settings()` di `host/query`,
  seguita con `onEvent("setting_changed")`, con un proprietario e un
  disposer; un valore che il client non conosce vale quello di serie.
- I test: in Rust le chiavi, i tipi, la macchina o il vault, i valori di
  serie, i testi nelle due lingue; in `fub-host` che con la feature accesa
  ci sono e spenta no; nel client lo specchio delle chiavi e dei valori
  (`settings-mirror.test.ts`) e il cambio da `setting_changed`.
- La pagina dell'architettura: le impostazioni della lavagna, chi le legge.
Dal prototipo: le righe di «Impostazioni › Lavagna» (T25): nomi,
descrizioni, l'ordine; le disegna `panels/settings.ts`, niente CSS nuovo.
Casi limite: la feature `lavagna` spenta (`--no-default-features`); un
valore scritto a mano che non è fra le scelte (vale quello di serie, e il
file non si riscrive); `canvas.drop_folder_path` vuoto, con `..` o dentro
`.fub/` (vale `Allegati`, e la riga lo dice); il cambio da un'altra
finestra; l'interfaccia in inglese; «Il tasto della penna» su un computer
senza penna (la riga c'è, non fa niente).
Fatto quando: `cargo test -p fub-features` e `cargo test -p fub-host
--test lavagna_feature` passano; `preferences.test.ts` e
`settings-mirror.test.ts` passano; le foto della sezione, chiaro e scuro,
sono nel rapporto accanto a quelle del prototipo.
Prova: scripts/check.sh --rapido; cargo test -p fub-features; cargo test
-p fub-host --test lavagna_feature; cd apps/client && npx vitest run
src/editors/canvas/preferences.test.ts src/editors/canvas/settings-mirror.test.ts
Stato: [ ] da fare

## T34 · Dove vanno i file trascinati

Perché: D-2 (d): i file trascinati dal computer vanno dove dice
`canvas.drop_folder`, che di serie segue la cartella degli allegati delle
note; «Cambia cartella» apre quella voce.
Tocca: `apps/client/src/state/canvas-intake.ts` e `canvas-intake.test.ts`,
`apps/client/src/state/document-controller.ts` (la cartella per la
lavagna, `revealSetting`), `apps/client/src/i18n/catalog.ts`.
Non toccare: `files.attachment-folder` e `folderForNote` (si usano così
come sono); `engine.ts`; le note.
Dipende da: T32, T33
Cosa fare:
- La cartella per una lavagna: `notes` → quella di
  `files.attachment-folder` per quella lavagna, come oggi (anche `./…`
  relativo alla lavagna); `board` → `canvas.drop_folder_path` accanto
  alla lavagna (`Corsi/Statistica/Allegati/` per
  `Corsi/Statistica/Lezioni.canvas`); `folder` → `canvas.drop_folder_path`
  dalla radice del vault.
- Il percorso passa dalla stessa pulizia dei percorsi degli allegati
  (`sanitizeFileName` per ogni pezzo, niente `..`, niente `.fub/`); un
  valore che non vale usa la cartella delle note, e la notifica lo dice.
- La prima notifica («Copiati in {folder}») e «Cambia cartella» aprono
  `canvas.drop_folder` (`revealSetting`), non più
  `files.attachment-folder`.
- La cartella che non c'è la crea il deposito, come oggi.
Casi limite: la lavagna alla radice del vault con `board`
(`Allegati/` alla radice); una lavagna rinominata o spostata (i file nuovi
vanno nella cartella nuova, i vecchi restano dove sono e le schede li
trovano); una cartella esclusa dall'indice (i file ci vanno, e la
notifica lo dice: non si troveranno con la ricerca); un nome di cartella
con caratteri che il sistema vieta; il riuso di T32 (un file già nel
vault non si copia in nessuna cartella).
Fatto quando: `canvas-intake.test.ts` prova le tre scelte, il valore
rotto, la lavagna alla radice, «Cambia cartella» che apre la voce giusta,
e che le note continuano a usare `files.attachment-folder`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/canvas-intake.test.ts
Stato: [ ] da fare

## T35 · La rotella

Perché: D-17 (b): la rotella sposta o ingrandisce come dice
`canvas.wheel`; oggi sposta sempre, e Ctrl+rotella ingrandisce (A-11).
Tocca: `apps/client/src/editors/canvas/engine.ts` (`#wheel`),
`apps/client/src/editors/canvas/engine.test.ts`,
`docs/reference/canvas-cards.md` (da T1: la rotella).
Non toccare: la rotella dentro una scheda attiva (va alla scheda: T14);
`preferences.ts` (si legge, da T33).
Dipende da: T14, T33
Cosa fare:
- `pan` (di serie): come oggi; Maiusc+rotella sposta di lato;
  Ctrl+rotella (e Cmd+rotella su macOS) ingrandisce intorno al puntatore.
- `zoom`: la rotella ingrandisce intorno al puntatore; Maiusc+rotella
  sposta di lato; Ctrl+rotella ingrandisce come sempre. Un evento con una
  parte orizzontale (le due dita sul touchpad) sposta anche in `zoom`, così
  il touchpad resta usabile; la regola sta nella pagina.
- Il pizzico (che arriva come Ctrl+rotella) ingrandisce sempre.
- Il cambio dell'impostazione vale subito, senza riaprire.
Casi limite: un mouse che manda scatti in righe (`deltaMode` 1) o in
pagine (2); un touchpad su WebKitGTK che non manda `deltaX`; la rotella
sopra una scheda non attiva (la lavagna); la rotella mentre la penna è giù
(niente, come oggi); lo zoom ai limiti (fermo, niente salto).
Fatto quando: `engine.test.ts` prova le due scelte con rotella, Maiusc e
Ctrl, un evento col pizzico, un evento orizzontale in `zoom`, e il cambio
dell'impostazione a lavagna aperta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T36 · Riaprire dove eri

Perché: B5 di `lavagna.md` (segnato «c'è già», ma `setDoc` inquadra tutto
a ogni apertura) e D-5 (c): riaprendo una lavagna torni alla vista di
prima, alle schede scelte e alla pagina di ogni PDF, ricordate da Fub su
questo computer; il file non cambia (A-18).
Tocca: `apps/client/src/editors/canvas/view-state.ts` (nuovo) e
`view-state.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`
(la camera e la scelta di partenza), `apps/client/src/editors/canvas/surface.ts`
(lo stato di vista dalla porta), `apps/client/src/editors/canvas/cards.ts`
(da T1: `initialPage` e `pageChanged` nel `CardContext`),
`apps/client/src/editors/canvas/cards/pdf.ts` e `pdf.test.ts` (da T6),
`docs/reference/canvas-cards.md` (da T1).
Non toccare: il formato `.canvas` (niente `fub:page`, niente campi nuovi);
gli stati di vista degli altri editor.
Dipende da: T13, T14
Cosa fare:
- La chiave `canvas.view:<documentId>` con `api.viewState` e
  `api.setViewState` (come `canvas.ink_mouse` di N4 T19), con dentro
  `{ "version": 1, "camera": { x, y, zoom }, "selection": [id…],
  "pages": { nodeId: page } }`: al più 500 schede scelte e 1000 pagine (le
  più recenti); una versione che non si conosce si ignora e non si
  riscrive. I campi in più della versione 1 si conservano riscrivendo:
  T55 (`navigator`), T71 (`grid`) e T82 (`dark`, per scheda) ne
  aggiungono senza cambiare versione.
- All'apertura: la camera di prima se almeno una scheda cade nella vista
  ricordata, sennò «inquadra tutto» come oggi; la scelta di prima, con le
  sole schede che ci sono ancora.
- La pagina di una scheda PDF: quella ricordata, sennò `#page=N` del
  `subpath`, sennò la prima (`initialPage`); la scheda dice quando la
  cambia (`pageChanged`), e lo stato si scrive con un ritardo (500 ms dopo
  l'ultimo cambio, e alla chiusura).
- Una lavagna rinominata riparte dalla vista intera, se la shell non
  porta già gli stati di vista con il nome (il coder lo controlla e lo
  scrive).
Casi limite: lo stato rotto o di un'altra versione (si parte come oggi);
una scheda PDF tolta e rimessa (nuovo id: la prima pagina); una pagina
ricordata oltre la fine del PDF (la prima); due finestre sulla stessa
lavagna (vince l'ultima scrittura, nessun errore); lo stato di vista che
non si può scrivere (si va avanti, una riga nel registro); 5000 schede
scelte (se ne ricordano 500).
Fatto quando: `view-state.test.ts` prova lettura, scrittura, i limiti,
la versione sconosciuta e lo stato rotto; `engine-cards.test.ts` prova
che riaprendo la camera, la scelta e la pagina del PDF tornano, e che una
vista ricordata vuota inquadra tutto; `pdf.test.ts` prova `initialPage` e
`pageChanged`; il `.canvas` resta identico byte per byte.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T37 · L'ancora alle celle: il formato

Perché: D-6 (b): i tratti sopra un foglio si attaccano alla cella e la
seguono quando il foglio scorre. È un'ancora nuova del formato su disco di
N4, che altri programmi leggeranno: prima il formato, con i vettori e la
pagina, poi la tela (T38).
Tocca: `crates/fub-canvas-core/src/ink.rs` e i suoi test,
`crates/fub-canvas-core/tests/` (i vettori),
`apps/client/src/__fixtures__/canvas-ink/` (vettori nuovi, scritti a
mano), `apps/client/src/editors/canvas/ink-record.ts`,
`apps/client/src/editors/canvas/anchor.ts`, `docs/reference/canvas-ink.md`,
l'ADR «Le ancore di contenuto» (da T19).
Non toccare: le ancore `card`, `free` e `page` (restano identiche);
`engine.ts` (T38).
Dipende da: T19 (l'ADR e la forma delle ancore di contenuto)
Cosa fare:
- L'ancora `{"kind":"cell","sheet":"Foglio1","cell":"B3"}`: il nome del
  foglio com'è nel file e la cella in notazione A1; i punti del tratto sono
  in pixel del foglio al 100%, dall'angolo in alto a sinistra della cella.
- Vale solo sopra una scheda di foglio; un tratto si attacca alla cella
  sotto il centro del suo riquadro; sopra le intestazioni o fuori dalla
  griglia prende l'ancora `card`.
- L'ancora segue l'indirizzo, non il contenuto: una riga inserita sopra
  in un altro programma sposta il tratto sulla cella che ora ha quel nome.
  La pagina lo dice chiaro, con un esempio.
- Rust e TypeScript leggono e scrivono allo stesso modo (i vettori nuovi
  passano in tutti e due); un campo sconosciuto si conserva; `cell` che non
  è A1 valido o `sheet` vuoto: l'ancora non vale, il tratto resta e non si
  disegna.
- L'ADR cresce di un paragrafo: perché la cella e non le coordinate,
  perché l'indirizzo, che cosa succede se il foglio cambia.
Casi limite: un foglio con un nome con spazi o virgolette; `XFD1048576`
(l'ultima cella); `A0` o `B` (non vale); un foglio rinominato (il tratto
resta e non si mostra: si dice); celle unite (il tratto va con la cella
in alto a sinistra dell'unione).
Fatto quando: i vettori nuovi passano in `cargo test -p fub-canvas-core` e
in Vitest; i vettori di N4 e di T19 passano senza cambiare; la sezione di
`canvas-ink.md` c'è.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T38 · Il tratto segue la cella

Perché: D-6 (b): sulla lavagna, un tratto scritto sopra una cella si
sposta con lei quando il foglio scorre dentro la scheda, e sparisce quando
la cella esce dalla vista della scheda.
Tocca: `apps/client/src/editors/grid/card.ts` e `card.test.ts` (da T7:
`cellAt`, `cellRect`, lo scorrimento),
`apps/client/src/editors/canvas/cards.ts` (da T1: i due metodi nel
`CardView`), `apps/client/src/editors/canvas/engine.ts` (dà ad `anchor.ts`
la cella sotto il tratto; ridisegna i tratti della scheda quando scorre),
`apps/client/src/editors/canvas/engine-ink-anchors.test.ts` (da T19),
`docs/reference/canvas-cards.md`.
Non toccare: il formato (T37); lo strato d'inchiostro di N4 oltre ciò che
serve a tagliare i tratti alla scheda (lo dice il rapporto).
Dipende da: T37, T14
Cosa fare:
- `cellAt(point)`: la cella sotto un punto della scheda, o `null` sopra
  le intestazioni e fuori dalla griglia; `cellRect(sheet, cell)`: dove sta
  la cella nella scheda adesso, o `null` se non si vede.
- La scheda dice quando scorre (un richiamo nel `CardContext`, con un
  proprietario), e la tela ridisegna i tratti con ancora `cell` di quella
  scheda allo stesso fotogramma.
- Un tratto con ancora `cell` si disegna tagliato alla scheda; la cella
  fuori vista: il tratto non c'è.
- La scheda ferma: i tratti come nell'ultima vista della scheda viva.
Casi limite: uno scorrimento veloce (nessun fotogramma con il tratto al
posto vecchio); lo zoom della lavagna mentre il foglio è scorso; il foglio
cambiato in un riquadro accanto (la cella c'è ancora: il tratto la
segue); la scheda rimpicciolita che nasconde la cella; la penna giù
mentre il foglio scorre (non scorre: N4).
Fatto quando: `engine-ink-anchors.test.ts` scrive sopra B3, scorre il
foglio di tre righe (il tratto si sposta con B3), lo scorre finché B3 esce
(il tratto sparisce) e torna (ricompare); `card.test.ts` prova `cellAt` e
`cellRect`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas src/editors/grid/card.test.ts
Stato: [ ] da fare

## T39 · Il titolo sopra la scheda e l'inchiostro sul contenuto

Perché: D-21 e la nota di N4 per N6 (T5, T6, T19): un tratto sopra
un'immagine o una pagina deve stare sul contenuto con una regola che un
altro programma rifà con i soli dati del file. Con il titolo sopra la
scheda (D-21 (a)) e la pagina intera dentro la scheda (A-20), il riquadro
del contenuto è «il contenuto, contenuto nella scheda, al centro».
Tocca: `apps/client/src/editors/canvas/engine.ts` (`#nodeEl`: il titolo
fuori dal rettangolo), `apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/editors/canvas/ink-fit.ts` (di N4 T18) e il suo test,
`apps/client/src/__fixtures__/canvas-ink-fit/` (vettori nuovi),
`apps/client/src/editors/canvas/cards/image.ts` e `cards/pdf.ts` (da T5 e
T6: `contentAspect()`, la pagina intera), i loro test,
`apps/client/src/editors/canvas/cards.ts` (da T1),
`docs/reference/canvas-ink.md`, `docs/reference/canvas-cards.md`.
Non toccare: le schede di testo e i gruppi (il loro titolo resta com'è);
`inkFit` con tre argomenti (resta identico: i vettori di N4 passano).
Dipende da: T19, T25 approvato e **la risposta a D-21**; N4 T18 (nella
base)
Cosa fare:
- Solo con D-21 (a). Il titolo di una scheda di file sta sopra il
  rettangolo della scheda, fuori; il rettangolo è tutto contenuto. Il
  titolo non cambia `x`, `y`, `width`, `height` del nodo.
- `contentAspect()`: larghezza su altezza del contenuto (l'immagine, la
  pagina mostrata), o `null` se non si sa.
- `inkFit(mode, ref, size, aspect?)`: con `aspect`, la regola porta il
  riquadro «contenuto» (`aspect` contenuto in `ref`, al centro) sul
  riquadro contenuto in `size`; con `aspect = W/H` di `ref` è la regola di
  N4. Vettori nuovi, scritti a mano.
- La scheda PDF mostra la pagina intera, centrata (non più adattata alla
  larghezza): T19 usa `pageBox()` che ora segue questa regola.
- `canvas-ink.md`: la regola con `aspect`, con un esempio che un altro
  programma rifà; `canvas-cards.md`: il titolo fuori e `contentAspect`.
- Con D-21 (b) o (c) questo task si riscrive prima di partire.
Dal prototipo: il titolo sopra la scheda, i suoi stati (scelto, attivo,
lungo), le classi nuove della tabella «Dal prototipo» (T25).
Casi limite: un titolo lunghissimo (si taglia alla larghezza della
scheda); due schede vicine in verticale (il titolo di una non copre
l'altra: il fantasma del rilascio di T15 ne tiene conto); una scheda
dentro un gruppo; un'immagine che cambia proporzioni (il file sostituito:
i tratti si riadattano con la regola); il tema scuro; la lettura a schermo
del titolo (resta il nome della scheda).
Fatto quando: i vettori nuovi e quelli di N4 passano; `image.test.ts` e
`pdf.test.ts` provano `contentAspect` e la pagina intera;
`engine-cards.test.ts` prova che il titolo sta fuori senza cambiare il
nodo; le foto del banco, chiaro e scuro, somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas src/theme/scrittoio/anatomia.test.ts
Stato: [ ] da fare

## T40 · La porta per scrivere dentro le schede

Perché: D-7 (b) e T2 di `lavagna.md` («stessa sessione, ovunque»): chi
scrive dentro una scheda usa l'editor vero del file, sulla stessa
`DocumentSession` di un riquadro, con le sue bozze, i suoi conflitti e il
suo salvataggio (A-4). La tela non può importare `editors/text/` (il
confine di CodeMirror): riceve una porta.
Tocca: `apps/client/src/state/card-editors.ts` (nuovo) e
`card-editors.test.ts` (nuovo),
`apps/client/src/state/document-controller.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/editors/canvas/surface.ts` (la porta passa alla tela),
`apps/client/src/editors/canvas/cards.ts` (da T1: i tipi strutturali della
porta), `docs/reference/canvas-cards.md` (la sezione «Scrivere dentro una
scheda»).
Non toccare: `state/document-session.ts` (si usa com'è: `retain`,
`attachSurface`, `release`); `editors/text/` e `editors/grid/` (si montano
come in un riquadro); `docs/architecture/editor-surfaces.md` (è a 449
righe: la sezione va in `canvas-cards.md`); `engine.ts` (T41).
Dipende da: T12
Cosa fare:
- I tipi, in `cards.ts`: `CardEditorPort { open(path, host, options):
  Promise<CardEditor | null> }` con `options = { compact: boolean;
  readOnly: boolean; lifetime: Lifetime }`, e `CardEditor { focus():
  void; leave(): Promise<void>; state(): "clean" | "pending" | "conflict"
  | "readonly"; onState(listener): () => void; destroy(): void }`.
- In `card-editors.ts`: `createCardEditorPort(deps)` che, per un percorso,
  prende la sessione con `documentSessions.retain(id)`, chiede la
  superficie al `DocumentSurfaceRegistry` come per un riquadro (per
  `format_id` e `source_kind`), la monta in `host` e la attacca con
  `attachSurface(id, surface)`; `destroy` stacca e rilascia, una volta.
  Un formato senza superficie, o la sessione che non si apre: `null`, e
  la scheda resta in lettura.
- L'annulla è della superficie (A-21); le modifiche arrivate da un altro
  riquadro non entrano nel suo annulla; bozze e conflitti come in un
  riquadro.
- In `bootstrap.ts` e `document-controller.ts`: la porta costruita con la
  collezione delle sessioni e il registro delle superfici della finestra,
  passata alla tela da `surface.ts`.
- La sezione in `canvas-cards.md`: chi scrive, su quale sessione, che cosa
  succede chiudendo la lavagna con una bozza.
Casi limite: lo stesso file aperto in un riquadro (una sessione, due
superfici: si aggiornano tutte e due); il file rinominato o tolto mentre
si scrive (la sessione lo segue o lo dice, come in un riquadro); un
conflitto con un cambio da fuori; la lavagna chiusa con una bozza (la
bozza resta, come chiudendo un riquadro); due `open` sullo stesso percorso
(due superfici, una sessione); `destroy` mentre `open` aspetta; la sola
lettura della policy.
Fatto quando: `card-editors.test.ts`, con l'host finto e una superficie
finta, prova `open` e `destroy` (nessuna sessione resta trattenuta), lo
stesso file in un riquadro e in una scheda (un cambio da una parte arriva
all'altra e non entra nel suo annulla), il conflitto, la bozza alla
chiusura, il formato senza superficie; `check-codemirror-boundary.mjs`
passa.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/state/card-editors.test.ts; node .github/scripts/check-codemirror-boundary.mjs
Stato: [ ] da fare

## T41 · Scrivere in una scheda di nota

Perché: D-7 (b) e C2: doppio clic, o Invio con la scheda scelta, scrive
dentro la nota con l'editor delle note in Live, sulla stessa sessione del
riquadro.
Tocca: `apps/client/src/editors/canvas/cards/note.ts` e `note.test.ts` (da
T4: `edit()`), `apps/client/src/editors/canvas/engine.ts` (entrare in
scrittura, uscire), `apps/client/src/editors/canvas/engine-cards.test.ts`,
`apps/client/src/canvas-edit.e2e.test.ts` (nuovo),
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-cards.md`.
Non toccare: `editors/text/` (si usa dalla porta di T40); le schede di
documento Word e ODT (restano in lettura: D-14 (a)); la riga delle opzioni
(T50).
Dipende da: T40, T27 approvato, T14
Cosa fare:
- `edit()` della scheda di nota: chiede la porta di T40 per il file della
  scheda e monta l'editor nel corpo, al posto della resa; `false` se la
  porta dà `null`.
- Doppio clic su una scheda di nota, o Invio con la scheda attiva, entra
  in scrittura (`data-card-editing`); il primo Esc esce dalla scrittura e
  lascia la scheda scelta; un clic fuori fa lo stesso. Uscendo, la scheda
  torna alla resa con il testo nuovo.
- La barra di formato dell'editor dove dice il prototipo T27 (T50 la porta
  nella riga delle opzioni).
- Mentre si scrive: i tasti di una lettera della lavagna non valgono;
  Ctrl+Z annulla nella nota; la penna scrive sopra la scheda come sempre
  (N4) e non sposta il cursore.
- Con un `subpath` (`Nota#Titolo`) l'editor mostra la nota intera
  scorsa a quella sezione (scrivere solo una sezione è v2, S8).
- `canvas-edit.e2e.test.ts`: una nota sulla lavagna e nello stesso tempo
  in un riquadro; si scrive nella scheda, il riquadro lo mostra; si scrive
  nel riquadro, la scheda lo mostra; Ctrl+Z nella scheda annulla solo ciò
  che si è scritto lì.
Dal prototipo: la scheda in scrittura, la barra di formato, «Esc per
uscire», la bozza e il conflitto (T27).
Casi limite: la nota in sola lettura (la scheda dice perché, non entra);
la nota cambiata da fuori mentre si scrive (il conflitto come in un
riquadro, dentro la scheda); la scheda rimpicciolita mentre si scrive; la
scheda che esce dalla vista mentre si scrive (resta viva finché si
scrive); lo zoom sotto 0,35 mentre si scrive (resta viva); due schede della
stessa nota (una scrive, l'altra si aggiorna a fine gesto); il tasto C
mentre si scrive (va nel testo).
Fatto quando: `note.test.ts` e `engine-cards.test.ts` provano entrare,
uscire con Esc e con un clic fuori, i tasti di una lettera spenti, la
sola lettura; la prova e2e passa; le foto del banco, chiaro e scuro,
somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas src/canvas-edit.e2e.test.ts
Stato: [ ] da fare

## T42 · Scrivere nelle celle di un foglio

Perché: D-7 (b) e C3: dentro la scheda di foglio si cambiano valori e
formule, con l'editor del foglio sulla stessa sessione; righe, colonne e
formati restano dell'editor intero (T45).
Tocca: `apps/client/src/editors/grid/card.ts` e `card.test.ts` (da T7:
`edit()`, il modo compatto), `apps/client/src/editors/canvas/engine.ts`
(il doppio clic su una cella), `apps/client/src/canvas-edit.e2e.test.ts`
(da T41), `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-cards.md`.
Non toccare: il motore del foglio (`editors/grid/engine.ts`, il giornale,
`grid_bytes_open`: si usano come in un riquadro); il nastro e i menu del
foglio (non entrano nella scheda).
Dipende da: T41, T27 approvato
Cosa fare:
- `edit()` della scheda di foglio: la superficie del foglio dalla porta di
  T40, in modo compatto (niente nastro, niente linguette, niente menu di
  struttura); la scheda attiva diventa la stessa griglia che si può
  scrivere.
- Doppio clic su una cella, o Invio sulla cella scelta, la modifica; Invio
  conferma e scende, Tab conferma e va a destra, Esc annulla la cella; un
  secondo Esc esce dalla scrittura.
- La formula della cella dove dice il prototipo T27 (T50 la porta nella
  riga delle opzioni).
- Inserire o togliere righe e colonne, unire, formattare: non ci sono
  nella scheda; il tasto destro offre «Apri a lato per questo» (T45).
- `canvas-edit.e2e.test.ts`: un foglio sulla lavagna e in un riquadro; un
  valore scritto nella scheda arriva al riquadro e al file salvato.
Dal prototipo: la cella in modifica, la formula, il modo compatto (T27).
Casi limite: una formula con un errore (lo dice la cella, come nel
foglio); un foglio protetto o in sola lettura; un foglio molto grande
(scrive solo il foglio attivo); la base vecchia (`Stale`: la scheda si
ricarica e lo dice); l'incolla di un blocco di celle; Ctrl+Z dentro la
scheda (annulla nel foglio, non sulla lavagna); la penna sopra le celle
mentre si scrive (N4: scrive).
Fatto quando: `card.test.ts` prova la modifica, Invio, Tab, Esc due volte,
l'assenza dei menu di struttura e `Stale`; la prova e2e passa; le foto del
banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/grid/card.test.ts src/canvas-edit.e2e.test.ts
Stato: [ ] da fare

## T43 · La scheda di testo in Live

Perché: C1 di `lavagna.md`: la scheda di testo si scrive come una nota, in
Live, non in una `textarea` (`#beginCardEdit` di oggi). Il testo sta nel
`.canvas`, non in un file: passa dal testo «in attesa» di N3 (T16, T19).
Tocca: `apps/client/src/state/card-editors.ts` (da T40: `openText`),
`apps/client/src/editors/canvas/engine.ts` (`#beginCardEdit`),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/cards.ts` (da T1: il tipo di `openText`),
`apps/client/src/editors/core/bootstrap.ts`, `docs/reference/canvas-cards.md`.
Non toccare: il testo in attesa di N3 (`CARD_PAUSE_MS`, 250 ms, `#pending`,
la bozza di N3 T19: si usano così); il formato del `.canvas`; il nucleo di
N3.
Dipende da: T41, T27 approvato; N3 T16 e T19 (nella base, A-15)
Cosa fare:
- `openText(host, text, { onText(text), readOnly, lifetime })` nella porta
  di T40: l'editor delle note in Live sopra un testo che non è un file,
  con il suo annulla; ogni cambio chiama `onText`.
- `#beginCardEdit` monta questo editor al posto della `textarea`; `onText`
  va nel testo in attesa come oggi (dopo 250 ms di pausa il commit del
  nucleo, la bozza nel frattempo), e chiudendo si registra come oggi
  (A14 e A15 di N3: Esc e Ctrl+Invio registrano e chiudono).
- Il menu «/» solo se l'editor delle note ce l'ha già; nessun comando
  nuovo.
- Il testo che non è Markdown valido resta com'è, byte per byte.
Casi limite: una scheda di testo con 2000 righe; un testo con `\r\n` (resta
`\r\n`: `line-endings.test.ts`); la lavagna chiusa a metà pausa (la bozza
di N3 T19); la stessa lavagna in due riquadri (il testo arriva all'altro
dopo il commit); la sola lettura (non entra); un annulla della lavagna
mentre si scrive (prima si esce dalla scrittura); l'editor che non si
monta (resta la `textarea` di oggi, e il rapporto lo dice).
Fatto quando: `engine.test.ts` prova che la scheda di testo monta l'editor
in Live, che il testo arriva al `.canvas` dopo la pausa e alla chiusura,
che Esc e Ctrl+Invio registrano, che i byte di un testo non toccato non
cambiano, e che i test di N3 su `#pending` passano senza cambiare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T44 · La scheda di testo cresce, e i suoi tasti

Perché: C1 e A-25: la scheda di testo cresce mentre si scrive fino a 480
px di larghezza, poi va a capo e cresce in altezza; e i tasti di
`lavagna.md` per creare: Ctrl+Invio, Ctrl+Maiusc+Invio, Esc due volte.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-cards.md`.
Non toccare: le schede di file (la loro misura la decide chi le usa); il
nucleo di N3.
Dipende da: T43
Cosa fare:
- Mentre si scrive, la scheda cresce in larghezza con il testo fino a 480
  px, poi va a capo e cresce in altezza; non si restringe da sola. La
  misura nuova va nel `.canvas` con il testo, nello stesso commit.
- Una scheda ridimensionata a mano non cresce più in larghezza (la sua
  misura l'ha scelta chi usa); in altezza sì, se il testo esce.
- Esc esce dalla scrittura e lascia la scheda scelta; un secondo Esc
  toglie la scelta (come dice «Tasti» di `lavagna.md`).
- Ctrl+Invio registra, chiude e apre una scheda nuova sotto (a 24 px, la
  stessa larghezza), già in scrittura: allarga A15 di N3, che registra e
  chiude.
- Ctrl+Maiusc+Invio: come Ctrl+Invio, ma la scheda nuova nasce a destra,
  collegata con un filo.
- Una scheda nuova lasciata vuota sparisce uscendo, senza un passo di
  annulla («Ho creato schede vuote per sbaglio»).
Casi limite: una parola di 600 px senza spazi (va a capo a 480); la scheda
nuova che cadrebbe sopra un'altra (scende fino al primo posto libero,
cercato al più 20 volte, poi sopra); Ctrl+Invio in sola lettura (niente);
una scheda vuota che esisteva già (non sparisce: solo quelle nuove); il
testo cancellato tutto in una scheda vecchia (resta vuota, non sparisce).
Fatto quando: `engine.test.ts` prova la crescita fino a 480 e poi in
altezza, la scheda ridimensionata a mano, Esc due volte, Ctrl+Invio,
Ctrl+Maiusc+Invio col filo, la scheda nuova vuota che sparisce senza
annulla e quella vecchia che resta.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T45 · «Apri a lato per questo»

Perché: T3 di `lavagna.md` («Quando dentro non basta»): ciò che la scheda
non fa (righe, colonne e formati del foglio; la modifica di un Word; una
sezione sola) si fa nell'editor intero, aperto accanto allo stesso punto,
senza cercarlo.
Tocca: `apps/client/src/editors/canvas/engine.ts` (le voci),
`apps/client/src/editors/canvas/chrome/options.ts` (da T50: il pulsante),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `onOpenPathBeside` (c'è da T17: si usa con un punto in più);
gli editor (ricevono il punto come oggi da un link).
Dipende da: T41, T42, T50
Cosa fare:
- Un comando del catalogo (T48), `canvas.open_beside_here`: apre il file
  della scheda in un riquadro accanto, allo stesso punto: la cella scelta
  (`#Foglio1!B3`), la sezione (`#Titolo`), la pagina (`#page=3`).
- Compare: nel tasto destro di una cella e di una scheda in scrittura, al
  posto delle voci di struttura che mancano; nella riga delle opzioni di
  una scheda attiva; in Ctrl+/.
- Se il riquadro accanto mostra già quel file, ci va e porta il punto.
Dal prototipo: il pulsante e il testo (T27).
Casi limite: un punto che l'editor non sa raggiungere (apre il file in
cima, e lo dice); una cella in un foglio che non c'è più; la finestra
stretta (apre nello stesso riquadro, come «Apri»); sola lettura (si
apre, è solo guardare).
Fatto quando: `engine.test.ts` prova il comando con una cella, una
sezione e una pagina, la voce nel tasto destro di una cella, e il
riquadro già aperto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T46 · Le misure dopo la modifica

Perché: D-7 (b): con l'editor vero dentro le schede la misura S9 va
rifatta, e serve anche il tempo dal tasto al fotogramma scrivendo in una
scheda di nota.
Tocca: `apps/client/bench/webview/run.mjs`,
`apps/client/bench/webview/fixtures.mjs`,
`apps/client/bench/webview/budgets.json` (solo `targets`),
`docs/development/webview-measurements.md`, `docs/misure/` (una pagina nuova
con la data), `docs/misure/README.md`.
Non toccare: il prodotto (un fotogramma lento si scrive con dove va il
tempo; se serve, il pianificatore apre un task); le soglie degli altri
scenari.
Dipende da: T20, T41, T42, T43, T44
Cosa fare:
- S3 e S9 rilanciati com'erano; i numeri accanto a quelli di T20.
- In S9, `S9.keyToPaint`: si entra in scrittura in una scheda di nota e si
  scrivono 200 caratteri, come S1 fa nel riquadro; in `targets`
  `S9.keyToPaint.p95: 16.7`.
- La pagina in `docs/misure/`: macchina, WebView, numeri, sha, e il
  confronto col riquadro (S1).
Casi limite: il driver che non sa scrivere in un elemento modificabile
dentro la tela (il referto lo dice, la misura non vale); il primo
carattere lento (il montaggio dell'editor: si scrive a parte).
Fatto quando: il comando gira e scrive S3, S9 e `S9.keyToPaint`; la pagina
delle misure c'è; il cancello ha i numeri.
Prova: cd apps/client && npm run build && cd ../.. && cargo build --release
--locked -p fub-app --features tauri/custom-protocol && cd apps/client &&
xvfb-run -a npm run bench:webview -- --only=S1,S3,S9 --budgets=targets
--native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T47 · I colori

Perché: D-13 (c) e C10: i sei colori di JSON Canvas restano, e in più ogni
colore esatto `#rrggbb`, compresi i nove dei Blocchi delle note; le
lavagne che ci sono non cambiano e Obsidian le apre uguali. Oggi un colore
esadecimale si tiene ma si disegna pieno, e i sei sono `var(--…)` scritti
nel TypeScript (`PRESET_FILL`).
Tocca: `apps/client/src/editors/canvas/colors.ts` (nuovo) e `colors.test.ts`
(nuovo), `apps/client/src/editors/canvas/engine.ts` (il colore sul nodo, il
sottomenu «Colore»), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`.github/scripts/check-inline-theme.mjs` (solo il conto di `engine.ts` in
`EXCEPTIONS`, che scende: lo chiede la guardia stessa),
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-format.md` (di N3:
i colori).
Non toccare: `CANVAS_COLOR` in TypeScript e `CanvasColor::Hex` in Rust
(leggono già 3, 4, 6 e 8 cifre: restano); `kit/color/` (si usa); i colori
dei tratti (sono di N4).
Dipende da: T17, T25 approvato
Cosa fare:
- In `colors.ts`: i sei colori col loro nome (1 Rosso, 2 Arancione, 3
  Giallo, 4 Verde, 5 Azzurro, 6 Viola); i nove «Colori delle note» scritti
  come esadecimali chiari fissi: grigio `#5e626b`, marrone `#84573e`,
  arancione `#984b00`, giallo `#795f00`, verde `#007231`, blu `#0064b0`,
  viola `#7847a6`, rosa `#9e366f`, rosso `#b7191c`; `colorName(value)`
  per il lettore di schermo.
- Il sottomenu «Colore»: i sei come scelte esclusive col nome; «Colori
  delle note» con i nove; «Altro…» apre il selettore di `kit/color/`;
  «Nessuno».
- Si scrive in minuscolo `#rrggbb`; un colore letto (`#ABC`, `#aabbccdd`)
  resta com'è nel file finché nessuno lo cambia.
- L'aspetto va nel CSS della pelle: il nodo ha `data-canvas-color` (1–6, o
  il nome dei nove) e, per un esadecimale qualsiasi, la proprietà
  `--file-color` col suo valore (è un dato del file, non un ruolo del
  tema); i nove si disegnano con `--doc-color-*` e `--doc-tint-*`, così
  nel tema scuro seguono i Blocchi; un esadecimale qualsiasi con una tinta
  dal suo colore (`color-mix` nel CSS). `PRESET_FILL` sparisce e il conto
  di `engine.ts` in `check-inline-theme.mjs` scende.
- `canvas-format.md`: che cosa Fub scrive e che cosa legge, e che Obsidian
  mostra i nove come colori esatti.
Dal prototipo: il menu dei colori, i pallini, i nomi, il disegno dei
colori nei due temi (T25).
Casi limite: un colore `"7"` o `"rosso"` scritto a mano (si tiene, si
disegna senza colore); `#ABC` (si tiene, si disegna); un colore molto
chiaro nel tema chiaro (il bordo resta leggibile: il CSS lo garantisce con
il contrasto del tema); più schede scelte con colori diversi (nessuna
scelta segnata); un gruppo; un filo (i fili hanno lo stesso menu dei
colori).
Fatto quando: `colors.test.ts` prova i nomi, i nove esadecimali, la
scrittura in minuscolo e la lettura che non riscrive; `engine.test.ts`
prova il menu (radio, «Colori delle note», «Altro…»), che una lavagna con i
sei colori di oggi resta identica byte per byte, e che il nome arriva al
lettore di schermo; `check-inline-theme.mjs` passa col conto nuovo; le
foto del banco, chiaro e scuro, somigliano al prototipo.
Prova: scripts/check.sh --rapido; node .github/scripts/check-inline-theme.mjs;
cd apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T48 · Il catalogo dei comandi

Perché: R2 di `lavagna.md` («Ogni funzione è un comando»): un comando entra
una volta e compare in Ctrl+/, nel menu ≡, nel tasto destro e nel menu
radiale, con il suo nome e il suo tasto, come nel disegno.
Tocca: `apps/client/src/editors/canvas/chrome/commands.ts` (nuovo) e
`commands.test.ts` (nuovo),
`apps/client/src/editors/canvas/chrome/command-search.ts` (nuovo) e il suo
test, `apps/client/src/editors/canvas/engine.ts` (i comandi di oggi entrano
nel catalogo; il menu contestuale li legge),
`apps/client/src/i18n/catalog.ts`, `docs/reference/canvas-cards.md` (la
sezione «Comandi e tasti»).
Non toccare: `editors/spatial/` (K5: si importa solo `rankCommands` da
`tools/editor/chrome/command-search.ts`); i tasti dello Scrittoio (nessuno
preso senza dichiararlo, ADR 0223).
Dipende da: T16
Cosa fare:
- `CanvasCommand { id, label, path, keys, context: "always" | "tool" |
  "selection", disabled(), run() }`, come `DrawCommand`; ogni id comincia
  con `canvas.`; un id è un dato stabile.
- I comandi che la tela ha già (il menu del vuoto, quello della scheda,
  quello dei fili, i tasti di `#keydown`) entrano nel catalogo, con i tasti
  della tabella «Tasti» di `lavagna.md` dove fanno la stessa cosa; i tasti
  che la tela usa oggi in modo diverso restano come sono, e la pagina lo
  dice.
- Ctrl+/: la ricerca fra i comandi con `rankCommands` del disegno e
  l'aspetto della sua ricerca (le stesse classi), in un `kit/popover.ts`;
  gli usati di recente per primi, per lavagna.
- Cambiare un tasto: solo se Fub lo sa già fare per una superficie (il
  coder lo controlla); sennò come nel disegno, e la differenza va nella
  pagina.
- La sezione nella pagina: i comandi, i loro id e i loro tasti.
Casi limite: un tasto di una lettera mentre si scrive in una scheda (non
vale); Ctrl+/ con una scheda in scrittura (si apre, e Esc torna dove si
era); un comando spento (si vede, spento, con il perché); la ricerca con
una parola che non trova niente; due comandi con lo stesso tasto (il test
lo vieta).
Fatto quando: `commands.test.ts` prova che ogni voce dei menu di oggi è
un comando, che gli id sono unici e stabili, che nessun tasto è doppio, e
che un tasto di una lettera non vale mentre si scrive;
`command-search.test.ts` prova la ricerca e i recenti; i test di
`engine.test.ts` sui menu passano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T49 · La colonna degli strumenti

Perché: R1 e la tabella «Tasti» di `lavagna.md`: la lavagna ha la colonna
degli strumenti del disegno (Selezione, Mano, Penna, Evidenziatore, Gomma,
Testo, Collega), personalizzabile.
Tocca: `apps/client/src/editors/canvas/chrome/rail.ts` (nuovo) e
`rail.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts` (lo
strumento attivo), `apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `kit/tool-rail.ts` (si usa com'è); `editors/spatial/` (K5);
gli strumenti a penna di N4 (la colonna li chiama, non li rifà).
Dipende da: T26 approvato, T48
Cosa fare:
- `createCanvasRail(ctx)` con `createToolRail`: Selezione V, Mano H, Penna
  P, Evidenziatore Maiusc+P, Gomma E, Testo T, Collega C; ogni strumento è
  un comando del catalogo di T48. Il lazo (Q) lo aggiunge T86.
- La colonna personalizzabile con `canvas.toolbar` (T33), come
  `draw.toolbar`: vuota vuol dire la colonna di serie; uno strumento tolto
  resta raggiungibile dai tasti e da Ctrl+/.
- D tenuto presta la penna a ogni strumento col mouse (N4); lo
  spostamento con Spazio tenuto è di T53.
- Esc torna alla Selezione (dopo aver tolto la scelta, come dice «Tasti»).
- La barra di N4 (`#drawToolbar`) lascia il posto alla colonna; il menu
  delle penne va nella riga delle opzioni (T50).
Dal prototipo: la colonna, le tendine, gli stati (T26).
Casi limite: la finestra a 700 px; una colonna personalizzata con uno
strumento che non c'è (si salta); la sola lettura (Penna e Testo spenti,
col perché); lo spazio Semplice (T65); la tastiera sola (la colonna è un
punto di tabulazione con le frecce, come il kit).
Fatto quando: `rail.test.ts` prova gli strumenti, i tasti, la colonna
personalizzata e la sola lettura; i test di N4 sugli strumenti a penna
passano; le foto del banco, chiaro e scuro, piena e 700 px, somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T50 · La riga delle opzioni

Perché: R1: sopra la lavagna la riga delle opzioni dello strumento e della
scheda attiva, come nel disegno; il menu delle penne di N4 ci va dentro.
Tocca: `apps/client/src/editors/canvas/chrome/options.ts` (nuovo) e
`options.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/pen-menu.ts` (di N4 T21: dove si monta,
non che cosa fa), `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `kit/options-bar.ts` (si usa com'è); il menu delle penne di N4
nel suo contenuto (approvato: `PLAN-ui/lavagna-penne.html`).
Dipende da: T49; N4 T21 (nella base)
Cosa fare:
- `createCanvasOptions(ctx)` con `createOptionsBar`: per la Penna,
  l'Evidenziatore e la Gomma il menu delle penne di N4; per il Testo la
  misura e l'allineamento; per la Selezione con schede scelte, ciò che
  dice il prototipo (colore, disponi).
- Con una scheda in scrittura: la barra di formato della nota (T41) o la
  formula della cella (T42) vengono qui, al posto di dove le aveva messe
  il prototipo T27 per T41 e T42.
- Ogni controllo è un comando del catalogo (T48).
Dal prototipo: la riga per ogni strumento, con il menu delle penne dentro
(T26).
Casi limite: la riga a 700 px (i controlli che non stanno vanno in «Altro»,
come nel kit); il cambio di strumento con un menu aperto (si chiude); la
sola lettura; una scheda in scrittura che esce (la riga torna allo
strumento).
Fatto quando: `options.test.ts` prova la riga di ogni strumento, il menu
delle penne dentro, la barra di formato e la formula durante la scrittura;
i test di N4 su `pen-menu.ts` passano; le foto del banco somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T51 · La barra della selezione

Perché: «Che cosa si riusa» di `lavagna.md`: sopra ciò che è scelto, le
azioni che servono (Colore, Collega, Raggruppa, Allinea, Apri, Togli),
senza andare al menu.
Tocca: `apps/client/src/editors/canvas/chrome/selection-bar.ts` (nuovo) e
il suo test, `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `panels/selection-bubble.ts` (si usa `bubblePlace` per il
posto; la bolla del testo resta com'è).
Dipende da: T50, T47
Cosa fare:
- La barra compare sopra la selezione a fine gesto, mai durante; il posto
  con `bubblePlace`, dentro la vista.
- Le azioni sono comandi del catalogo: Colore (il menu di T47), Collega,
  Raggruppa, Allinea e Distribuisci (con più schede), Apri (con una), Togli
  dalla lavagna.
- Sparisce mentre si scrive in una scheda, con la penna giù e mentre si
  sposta la vista.
Dal prototipo: la barra con una, tre e venti schede (T26).
Casi limite: la selezione fuori vista (la barra non c'è); la selezione al
bordo alto (la barra va sotto); lo zoom che cambia (la barra si
riposiziona a fine gesto); la sola lettura (le azioni che cambiano sono
spente).
Fatto quando: il test prova quando compare e sparisce, le azioni per una
e più schede, la sola lettura; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T52 · La banda di stato

Perché: R1 e B2: in basso la banda dice lo zoom, quante schede sono
scelte, se la lavagna è in sola lettura e dove vanno i file trascinati;
un clic sullo zoom lo cambia.
Tocca: `apps/client/src/editors/canvas/chrome/status.ts` (nuovo) e il suo
test, `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: la banda di stato dello Scrittoio (la lavagna ha la sua, come
il disegno: `editors/spatial/tools/editor/chrome/status.ts` è il modello).
Dipende da: T49
Cosa fare:
- Zoom in percentuale (un clic apre 50%, 100%, 200%, Tutto, La selezione);
  «{n} schede scelte»; «Sola lettura» col perché; la cartella dei file
  trascinati (T34) con un clic che apre la voce.
- Le gemelle di C14 (T22): «{n} copie di questa nota», con un clic che le
  inquadra.
- Aggiornata a fine gesto, non a ogni fotogramma.
Dal prototipo: la banda (T26).
Casi limite: la finestra stretta (lo zoom resta, il resto si accorcia); un
nome di cartella lunghissimo; nessuna scheda scelta.
Fatto quando: il test prova i valori, il menu dello zoom, il clic sulla
cartella e l'aggiornamento a fine gesto; le foto del banco somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T53 · Spostare e ingrandire

Perché: B1 e B2 di `lavagna.md`: spostare con Spazio tenuto, col tasto
centrale e trascinando verso il bordo; ingrandire dal 5% al 400% (oggi da
0,1 a 4), con + − 0, Maiusc+1 e Maiusc+2; l'inerzia, e niente inerzia col
movimento ridotto.
Tocca: `apps/client/src/editors/canvas/engine.ts` (`clampZoom`, la
camera, i tasti), `apps/client/src/editors/canvas/engine.test.ts`,
`docs/reference/canvas-cards.md` (la sezione «Muoversi»).
Non toccare: `spatial/camera.ts` (si usano `zoomAtPoint`, `fit`,
`stepCamera` e `INERTIA_MS` così come sono); la rotella (T35); il dito di
N4 (T14 di N4: il dito sposta).
Dipende da: T35; N4 T14 (nella base)
Cosa fare:
- Lo zoom fra 0,05 e 4; + e − a passi (gli stessi del disegno), 0 al 100%
  sul centro della vista, Maiusc+1 tutto, Maiusc+2 la selezione; sono
  comandi del catalogo (T48).
- Spazio tenuto e trascina sposta con qualsiasi strumento; mentre si
  scrive in una scheda Spazio è uno spazio. Il tasto centrale trascina e
  sposta. Ctrl, Cmd e Alt+trascina spostano la vista come oggi
  (`#pointerDown`); su una scheda Alt+trascina collegherà (T67).
- Trascinando una scheda, un filo o un rettangolo di scelta a meno di 40 px
  dal bordo, la vista scorre da sola, più veloce più si è vicini.
- L'inerzia dopo uno spostamento col touchpad o col dito, con
  `stepCamera`; con `prefers-reduced-motion` niente inerzia e i salti
  (Maiusc+1, Maiusc+2) senza volo.
Casi limite: lo zoom al 5% con 2000 schede (nessuna viva: T13); Spazio
tenuto mentre la penna è giù (niente: la penna ha la precedenza); il
trascinamento al bordo che esce dalla finestra (si ferma al rilascio);
Maiusc+2 senza selezione (niente); il movimento ridotto cambiato a
lavagna aperta.
Fatto quando: `engine.test.ts` prova i limiti dello zoom, i tasti, Spazio
tenuto con ogni strumento e dentro una scheda in scrittura, il tasto
centrale, lo scorrimento al bordo, l'inerzia e il movimento ridotto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T54 · I livelli di dettaglio

Perché: B2 e D-12 (a): da lontano la lavagna si legge ancora; fra 0,15 e
0,35 una scheda mostra l'ultima immagine ferma che ha avuto o il titolo
grande, sotto 0,15 un blocco del suo colore col titolo grande (A-22).
Tocca: `apps/client/src/editors/canvas/lod.ts` (nuovo) e `lod.test.ts`
(nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`docs/reference/canvas-cards.md`.
Non toccare: la regola delle schede vive (`cards.ts`, T13); la cache delle
immagini ferme (T2: si legge).
Dipende da: T53, T25 approvato
Cosa fare:
- `lod.ts`: `detailLevel(zoom)` → `"live" | "far" | "block"` con le
  soglie di A-22 (costanti con nome); il titolo grande ha una misura
  fissa sullo schermo, non sulla lavagna.
- La tela mette `data-card-detail` sul nodo a fine gesto; il CSS fa il
  resto. Le schede di testo da lontano mostrano la prima riga, grande; i
  gruppi il loro nome, grande.
- L'inchiostro resta disegnato a ogni livello (N4).
Dal prototipo: i due livelli da lontano (T25).
Casi limite: una scheda senza titolo (il nome del file); un titolo
lunghissimo da lontano (si taglia); 2000 schede al 5% (un solo cambio di
attributo per scheda, a fine gesto); il tema scuro; l'alto contrasto (i
blocchi hanno un bordo).
Fatto quando: `lod.test.ts` prova le soglie; `engine-cards.test.ts` prova
che l'attributo cambia solo a fine gesto e mai durante; le foto del banco
a 0,25 e a 0,1, chiaro e scuro, somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T55 · Il navigatore

Perché: B3: in basso a destra gruppi, schede e il riquadro di ciò che si
vede; premi per andare, trascina per spostare; sparisce da solo quando
tutta la lavagna è già in vista.
Tocca: `apps/client/src/editors/canvas/chrome/navigator.ts` (nuovo) e il
suo test, `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/spatial/tools/editor/chrome/navigator.ts` (si
importa `navigatorBox`, che è pura).
Dipende da: T53, T36 (lo stato della vista), T26 approvato
Cosa fare:
- Il navigatore disegna i gruppi e le schede come rettangoli del loro
  colore, e il riquadro della vista; il riquadro della mappa con
  `navigatorBox`.
- Un clic porta la vista lì (un salto: T56 lo ricorda); trascinare il
  riquadro sposta la vista.
- Sparisce quando tutta la lavagna sta già nella vista; «Nascondi il
  navigatore» nel menu Vista lo spegne per questa lavagna (stato di vista,
  T36).
- Ridisegnato a fine gesto, e al cambio del documento.
Dal prototipo: il navigatore chiuso e aperto (T26).
Casi limite: una lavagna vuota (non c'è); una lavagna di 2000 schede (un
solo `<canvas>`, non 2000 elementi); una scheda lontanissima (la mappa la
include); la finestra stretta; la tastiera (il navigatore si raggiunge con
F6 e le frecce spostano il riquadro).
Fatto quando: il test prova il clic, il trascinamento, quando sparisce e
«Nascondi»; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T56 · Indietro e Avanti

Perché: B4: le frecce della barra del titolo e Alt+← Alt+→ ricordano
anche i salti dentro la lavagna (Maiusc+1, un link seguito, un risultato
di ricerca, un clic nel navigatore), non ogni piccolo spostamento. Oggi
la cronologia del riquadro (`PaneHistory` in `state/layout.ts`) tiene solo
le schede aperte.
Tocca: `apps/client/src/editors/canvas/jumps.ts` (nuovo) e `jumps.test.ts`
(nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/registry.ts` (un membro facoltativo nuovo
di `EditorSurface`), `apps/client/src/state/document-controller.ts`
(`paneBack`, `paneForward`), `docs/reference/canvas-cards.md`.
Non toccare: `PaneHistory` e il suo formato salvato in `state/layout.ts`
(restano com'erano); le altre superfici (il membro è facoltativo).
Dipende da: T55
Cosa fare:
- `jumps.ts`: una pila di salti per lavagna aperta, al più 50, solo in
  memoria (non nel file, non nello stato di vista); un salto è la camera
  prima e dopo.
- Fanno un salto: Maiusc+1, Maiusc+2, 0, un clic nel navigatore, un link
  seguito sulla stessa lavagna (T57), un risultato di ricerca (T60), le
  gemelle di C14 (T52).
- `EditorSurface.jumps?: { back(): boolean; forward(): boolean }`;
  `paneBack` e `paneForward` chiedono prima alla superficie col fuoco, e
  solo se lei dice `false` usano la cronologia del riquadro.
- Alt+← e Alt+→ sono comandi del catalogo (T48).
Casi limite: Indietro con la pila vuota (la cronologia del riquadro, come
oggi); un salto dopo un Indietro (l'Avanti si perde, come nel browser);
la lavagna chiusa e riaperta (la pila riparte vuota); la stessa lavagna
in due riquadri (due pile); il movimento ridotto (salti senza volo).
Fatto quando: `jumps.test.ts` prova la pila; `engine.test.ts` prova che
Maiusc+1 e un clic nel navigatore fanno un salto e uno spostamento col
mouse no; una prova del controller prova che le frecce chiedono prima
alla lavagna e poi al riquadro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas src/state
Stato: [ ] da fare

## T57 · Seguire un link

Perché: B7 e D-18 (c): se la nota del link è sulla stessa lavagna, la
vista vola fino a lei e la scheda lampeggia una volta; altrimenti si apre
nell'editor accanto. T14 ha deciso quando un clic segue un link; qui
dove porta.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`.
Non toccare: i renderer (dicono il link, non dove va); `onOpenWikilinkBeside`
(si usa).
Dipende da: T56, T14
Cosa fare:
- Un link seguito (T14: Ctrl+clic, o un clic dentro una scheda attiva o
  in Lettura) a una nota che ha una scheda su questa lavagna: un salto
  (T56) fino alla scheda e un lampo solo (`data-card-flash`); con più
  schede della stessa nota, la più vicina alla vista.
- A una nota che non è sulla lavagna: l'editor accanto, come
  `onOpenWikilinkBeside` delle note; a un indirizzo web: l'apertura sicura
  dei link di Fub.
- Un link con una sezione (`[[Nota#Titolo]]`) porta alla scheda di quella
  nota e, se ha la sezione nel `subpath`, a quella.
Dal prototipo: il lampo della scheda raggiunta (T26).
Casi limite: un link a una nota che non c'è (la stessa cosa di un link
rotto nelle note); il movimento ridotto (niente volo, niente lampo
animato: un bordo che resta un momento); un link alla lavagna stessa; una
scheda di link a una pagina web (si apre fuori, come oggi).
Fatto quando: `engine-cards.test.ts` prova il salto alla scheda della
stessa lavagna con il lampo, la più vicina fra due, l'apertura accanto per
una nota che non c'è sulla lavagna, e che Indietro torna al punto di
partenza.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine-cards.test.ts
Stato: [ ] da fare

## T58 · L'ispettore: le schede in ordine di lettura

Perché: H2 e M2: nell'ispettore, «Schede» elenca tutto in ordine di
lettura, coi gruppi come cartelle, filtrabile; un clic porta la vista lì.
È anche il percorso del lettore di schermo.
Tocca: `apps/client/src/editors/canvas/reading-order.ts` (nuovo) e
`reading-order.test.ts` (nuovo),
`apps/client/src/editors/canvas/chrome/inspector.ts` (nuovo) e il suo test,
`apps/client/src/editors/canvas/surface.ts` (i pannelli della superficie),
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/spatial/` (si imita `inspectorChrome`; se si può usare
così com'è, si importa, e il rapporto lo dice); `engine.ts` (l'ispettore
legge il documento e chiama i comandi).
Dipende da: T26 approvato, T49
Cosa fare:
- `readingOrder(nodes)`: prima i gruppi, dall'alto a sinistra; dentro un
  gruppo il suo contenuto, nello stesso ordine; due schede sono sulla
  stessa riga se si sovrappongono in altezza per più di metà della più
  bassa. È pura, e la usa anche T61.
- L'ispettore con le parti «Schede», «Scheda» (T59), «Fili» (T59),
  «Fonti» (T77), con `SurfacePanels` come fa il disegno.
- «Schede»: l'elenco, con il filtro per nome e per specie; un clic è un
  salto (T56) alla scheda e la sceglie.
Dal prototipo: l'ispettore e «Schede» (T26).
Casi limite: 2000 schede (l'elenco è virtuale, come `kit/list.ts`); due
schede esattamente sovrapposte (prima quella sotto); un gruppo vuoto; un
gruppo dentro un gruppo; la lavagna che cambia mentre l'elenco è aperto
(si aggiorna a fine gesto).
Fatto quando: `reading-order.test.ts` prova l'ordine con righe, gruppi,
sovrapposizioni; il test dell'ispettore prova l'elenco, il filtro e il
clic; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T59 · L'ispettore: la scheda, i numeri, il nodo grezzo, i fili

Perché: R3 e R4: nell'ispettore X, Y, larghezza e altezza della selezione
con i campi del kit (che accettano `120+15` e `*2`); «Avanzate» mostra il
nodo grezzo, i suoi campi JSON Canvas e `fub:`, e i campi sconosciuti si
vedono e si conservano; per un filo l'etichetta, le punte e i lati.
Tocca: `apps/client/src/editors/canvas/chrome/inspector.ts` (da T58) e il
suo test, `apps/client/src/editors/canvas/chrome/raw-node.ts` (nuovo) e il
suo test, `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `kit/number-field.ts` (si usa); il nucleo di N3 (ogni
modifica passa dal suo commit); `engine.ts`.
Dipende da: T58, T47
Cosa fare:
- «Scheda»: X, Y, larghezza, altezza con `kit/number-field.ts`; con più
  schede, i valori comuni e «—» per quelli diversi; il colore (T47); il
  file e «Sostituisci il file…» (T70).
- «Avanzate»: l'id, i campi del nodo come tabella chiave-valore,
  modificabili; un valore si scrive come JSON e si controlla prima del
  commit; i campi `fub:` di Fub si vedono e non si cambiano qui se hanno
  una forma loro (l'inchiostro: «modificabile dalla penna»).
- «Fili»: per il filo scelto, l'etichetta, le punte, i lati (`fromSide`,
  `toSide`), «Inverti la direzione».
- Ogni modifica è un commit del nucleo di N3, con il suo annulla.
Dal prototipo: «Scheda», «Avanzate», «Fili» (T26).
Casi limite: un JSON non valido in «Avanzate» (non si scrive, la riga lo
dice); cambiare `id` (vietato: è l'identità della scheda); cambiare
`type` (vietato qui: è «Converti», T70); un campo sconosciuto di un altro
programma (si vede, si conserva, si può cambiare come testo); una misura
negativa o zero (il minimo di `DROP_MIN_SIZE`); la sola lettura (tutto si
legge, niente si cambia).
Fatto quando: il test dell'ispettore prova i numeri con le operazioni, i
valori misti, il colore, i lati di un filo; `raw-node.test.ts` prova la
modifica, il JSON non valido, `id` e `type` vietati, il campo sconosciuto
che resta; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T60 · Cerca nella lavagna

Perché: H1: Ctrl+F cerca nel testo delle schede, nei titoli e nel
contenuto delle note, nei nomi dei file e nelle etichette dei fili; le
schede che non c'entrano si velano; Invio passa alla successiva e la vista
vola lì; Esc chiude e la vista resta dove sei arrivato.
Tocca: `apps/client/src/editors/canvas/find.ts` (nuovo) e `find.test.ts`
(nuovo), `apps/client/src/editors/canvas/chrome/find-bar.ts` (nuovo) e il
suo test, `apps/client/src/editors/canvas/engine.ts` (il velo, il salto),
`apps/client/src/editors/canvas/surface.ts` (`find()` della superficie),
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: la ricerca del vault (si usa `searchExpression` di
`host/query.ts`); l'indice.
Dipende da: T56, T26 approvato
Cosa fare:
- `find.ts`: le corrispondenze nel documento della lavagna (testo delle
  schede di testo, etichette dei gruppi e dei fili, nomi dei file), in
  ordine di lettura (`readingOrder` di T58 se c'è, sennò dall'alto a
  sinistra).
- Il contenuto delle note: una richiesta `documents` con
  `searchExpression` e il predicato `docs` delle sole note della lavagna,
  una per ricerca, 200 ms dopo l'ultimo tasto; una risposta vecchia non
  copre una nuova.
- La barra con il campo, «3 di 12», ‹ e ›; Invio e Maiusc+Invio; ogni
  risultato è un salto (T56); le schede senza risultati velate
  (`data-card-veiled`).
- Esc chiude e la vista resta; Indietro torna al punto di partenza.
- `find()` della superficie apre la barra, così Ctrl+F dello Scrittoio
  arriva qui.
Dal prototipo: la barra con 0, 3 e 200 risultati, il velo (T26).
Casi limite: una ricerca vuota (niente velo); 0 risultati («Nessun
risultato», niente salto); una nota cambiata dopo la ricerca (il risultato
resta finché non si cerca di nuovo); una lavagna di 2000 schede; una
parola con accenti e maiuscole (come la ricerca del vault); il vault senza
indice (solo ciò che sta nel `.canvas`, e la barra lo dice); il movimento
ridotto (salti senza volo).
Fatto quando: `find.test.ts` prova le corrispondenze nel documento e
l'ordine; il test della barra prova Invio, Maiusc+Invio, Esc, il contatore
e la risposta vecchia scartata; `engine-cards.test.ts` prova il velo e il
salto; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T61 · Tutto da tastiera e col lettore di schermo

Perché: M1 e M2: Tab percorre le schede in ordine di lettura; Alt+frecce
vanno alla scheda più vicina in quella direzione; Invio scrive o apre; F6
passa fra lavagna, colonna, riga e ispettore; Maiusc+F10 apre il menu; il
lettore di schermo dice che scheda è, in che gruppo, a che cosa è
collegata.
Tocca: `apps/client/src/editors/canvas/engine.ts` (`#keydown`, il fuoco, le
etichette), `apps/client/src/editors/canvas/a11y.ts` (nuovo) e
`a11y.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`, `apps/client/bench/` (gli stati della
lavagna nel banco dell'accessibilità, se non ci sono),
`docs/reference/canvas-cards.md`.
Non toccare: le frecce che spostano (8, 32 con Maiusc, e 1 con Alt+Maiusc:
A-23; Alt da solo va alla scheda vicina); i tasti dello Scrittoio.
Dipende da: T58, T48
Cosa fare:
- Tab e Maiusc+Tab: la scheda dopo e prima in `readingOrder`; il fuoco
  segue la scelta, e la vista porta la scheda in vista (senza volo col
  movimento ridotto).
- Alt+frecce: la scheda più vicina in quella direzione (il centro più
  vicino dentro un cono di 90°); le frecce da sole spostano come oggi, e
  Alt+Maiusc+frecce di 1 px (A-23).
- F6 e Maiusc+F6 fra la lavagna, la colonna, la riga e l'ispettore.
- `a11y.ts`: `cardLabel(node, doc)` → «Scheda di nota Varianza, nel gruppo
  Media e varianza, collegata a 2 schede: Media aritmetica, vedi;
  istogramma, si vede qui.»; il nodo ha quel nome; ciò che cambia
  (spostata, tolta, collegata) si annuncia nella regione viva della tela.
- Gli stati della lavagna (vuota, con schede, con una scheda attiva) nel
  banco dell'accessibilità.
Casi limite: Tab con una scheda in scrittura (il Tab va all'editor:
Esc prima); una lavagna vuota (Tab va alla lavagna vuota e ai suoi
pulsanti, T62); due schede alla stessa distanza (quella prima in ordine
di lettura); un filo senza etichetta («collegata a Media aritmetica»);
200 fili su una scheda (il nome dice «collegata a 200 schede», l'elenco
sta nell'ispettore).
Fatto quando: `a11y.test.ts` prova i nomi; `engine.test.ts` prova Tab,
Maiusc+Tab, Alt+frecce, F6 e Maiusc+F10; `npm run bench:a11y` passa con
gli stati della lavagna.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas && npm run bench:a11y
Stato: [ ] da fare

## T62 · La lavagna vuota

Perché: A2: al centro di una lavagna vuota tre righe e tre pulsanti:
«Scrivi una scheda», «Aggiungi file…», «Incolla»; spariscono alla prima
scheda.
Tocca: `apps/client/src/editors/canvas/chrome/empty.ts` (nuovo) e il suo
test, `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/surface.ts` (la porta per scegliere i
file), `apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `host/dialog.ts` (si usa); il deposito (T32, T34: si usa).
Dipende da: T26 approvato, T48
Cosa fare:
- «Scrivi una scheda»: una scheda di testo al centro, già in scrittura.
- «Aggiungi file…»: il selettore dei file del sistema (`host/dialog.ts`),
  e i file passano dal deposito come quelli trascinati.
- «Incolla»: sempre acceso; legge gli appunti solo al clic (leggerli prima
  chiederebbe un permesso senza un gesto: «Differenze»), e fa ciò che fa
  Ctrl+V; se negli appunti non c'è niente che diventa una scheda, lo dice.
- Spariscono alla prima scheda, tornano quando la lavagna torna vuota; la
  lavagna in sola lettura mostra solo le tre righe.
Dal prototipo: la lavagna vuota (T26).
Casi limite: una lavagna con solo inchiostro (non è vuota); una lavagna con
solo un gruppo vuoto (non è vuota); il selettore annullato; gli appunti
negati dal sistema (lo dice, non un errore rosso); la tastiera (i tre
pulsanti sono nell'ordine di Tab, T61).
Fatto quando: il test prova i tre pulsanti, quando spariscono e tornano,
la sola lettura, gli appunti vuoti; le foto del banco somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T63 · Il menu radiale e i gesti

Perché: F10, F11 e K2: col tasto laterale della penna, col tocco lungo o
da Maiusc+F10, il menu radiale (Annulla in alto, Ripeti in basso, gli
ultimi tre strumenti a destra, gli ultimi tre colori a sinistra); due dita
che toccano annullano, tre ripetono; doppio tocco nel vuoto crea una
scheda.
Tocca: `apps/client/src/editors/canvas/chrome/radial.ts` (nuovo) e il suo
test, `apps/client/src/editors/canvas/engine.ts` (i gesti),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/spatial/tools/radial.ts` (si importano `openRadial`,
`sectorOf`, `DIRECTIONS`); il dito che sposta di N4 (T14 di N4).
Dipende da: T48, T26 approvato, T33; N4 T14 (nella base)
Cosa fare:
- Il menu con `openRadial`; le voci sono comandi del catalogo; gli ultimi
  tre strumenti e colori vengono dalla seduta.
- Si apre: col tasto laterale della penna se `canvas.pen_button` è
  `radial` (con `eraser` il tasto fa la gomma, con `pan` sposta); col tocco
  lungo (500 ms senza muoversi più di 8 px); dal menu di Maiusc+F10
  («Menu radiale»).
- Due dita che toccano e si alzano entro 250 ms annullano, tre ripetono;
  con niente da annullare si annuncia «Niente da annullare.».
- Doppio tocco nel vuoto: una scheda di testo lì, già in scrittura.
Dal prototipo: il menu radiale sulla lavagna (T26); l'aspetto è quello del
disegno (`openRadial`), senza classi nuove se il prototipo non le chiede.
Casi limite: il tocco lungo sopra una scheda (il menu della scheda, non il
radiale); due dita che si muovono (è un pizzico, non un annulla); la
penna giù mentre un dito tocca (vince la penna); il palmo (lo scarta N4);
il menu a un bordo della finestra (`radialCenter`); la sola lettura
(Annulla e Ripeti spenti).
Fatto quando: il test del radiale prova le voci e le direzioni;
`engine.test.ts` prova il tasto della penna con le tre scelte, il tocco
lungo, due e tre dita, il doppio tocco nel vuoto e il pizzico che non
annulla.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T64 · Il dito scrive

Perché: F13: per le tavolette senza penna, un interruttore in fondo alla
colonna; allora un dito scrive e due dita spostano.
Tocca: `apps/client/src/editors/canvas/engine.ts` (chi scrive),
`apps/client/src/editors/canvas/chrome/rail.ts` (da T49: l'interruttore),
`apps/client/src/editors/canvas/engine-ink.test.ts` (di N4),
`apps/client/src/i18n/catalog.ts`.
Non toccare: `apps/client/src/ink/` (il palmo, la pressione: N4); la penna
(scrive sempre).
Dipende da: T49, T33; N4 T14 (nella base)
Cosa fare:
- Con `canvas.finger_writes` acceso un dito scrive con la penna scelta;
  due dita spostano e pizzicano; `canvas.finger_moves_card` di N4 non vale
  finché il dito scrive (l'interruttore lo dice).
- L'interruttore in fondo alla colonna cambia l'impostazione (è della
  macchina).
Casi limite: il palmo appoggiato mentre un dito scrive (lo scarta N4);
due dita che arrivano a 30 ms una dall'altra (spostano, il primo segno si
toglie); una penna vera mentre il dito scrive (scrive la penna); lo spazio
Semplice (l'interruttore c'è).
Fatto quando: `engine-ink.test.ts` prova che con l'interruttore un dito
scrive e due spostano, e senza il dito sposta come oggi; il primo segno
tolto quando arriva il secondo dito.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T65 · Lo spazio Semplice

Perché: K1 e R1: sulle tavolette caselle da 44 px, colonna ridotta
(Selezione, Mano, Penna, Evidenziatore, Gomma, Testo, Annulla, Ripeti),
barra della selezione grande; sul computer lo spazio Completo.
Tocca: `apps/client/src/editors/canvas/chrome/workspace.ts` (nuovo) e il
suo test, `apps/client/src/editors/canvas/chrome/rail.ts`,
`apps/client/src/editors/canvas/chrome/options.ts`,
`apps/client/src/editors/canvas/chrome/selection-bar.ts`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: lo spazio Semplice del disegno (`chrome/workspace.ts` del
disegno è il modello, non si cambia).
Dipende da: T49, T50, T51, T33
Cosa fare:
- `canvas.workspace`: `auto` sceglie Semplice se il dispositivo ha solo il
  tocco (nessun puntatore fine), sennò Completo; `full` e `simple` lo
  fissano.
- Semplice: la colonna ridotta, caselle da 44 px, la riga delle opzioni
  ridotta, la barra della selezione grande, il navigatore e l'ispettore
  chiusi di serie.
- Ctrl+. nasconde l'interfaccia (colonna, riga, banda, navigatore) e la
  riporta, in tutti e due gli spazi.
Dal prototipo: lo spazio Semplice (T26).
Casi limite: un portatile col tocco e il mouse (`auto` → Completo); il
cambio da un'altra finestra; la finestra stretta nello spazio Completo
(resta Completo); Ctrl+. mentre si scrive in una scheda (va all'editor, se
lo usa; sennò alla lavagna).
Fatto quando: il test prova `auto` coi due dispositivi finti, `full`,
`simple`, Ctrl+.; le foto del banco, chiaro e scuro, a 700 px, somigliano
al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T66 · Ridimensionare

Perché: C11: maniglie agli angoli con un'area di presa di 20 px anche se
il segno ne misura 10; doppio clic su una maniglia adatta la scheda al
contenuto; Maiusc tiene le proporzioni, Alt ridimensiona dal centro.
Tocca: `apps/client/src/editors/canvas/engine.ts` (le maniglie),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`.
Non toccare: l'aggancio delle misure (resta come oggi, 8 px: A-23; Alt lo
spegne in T71); i renderer (dicono la misura del contenuto con
`contentAspect`, T39).
Dipende da: T25 approvato
Cosa fare:
- Quattro maniglie agli angoli, con l'area di presa di 20 px sullo schermo
  a ogni zoom; il cursore giusto per ognuna.
- Maiusc tiene le proporzioni; Alt dal centro; tutti e due insieme.
- Doppio clic su una maniglia: una scheda di testo prende la misura del
  suo testo (fino a 480 px di larghezza, T44); un'immagine o un PDF le
  proporzioni del contenuto alla larghezza di adesso; le altre non
  cambiano.
- Un ridimensionamento è un commit, un annulla; l'inchiostro attaccato
  segue (N4).
Dal prototipo: le maniglie e i loro stati (T25).
Casi limite: una scheda piccolissima a zoom basso (le maniglie non si
coprono: si vede solo quella in basso a destra sotto 24 px sullo
schermo); il minimo di `DROP_MIN_SIZE`; più schede scelte (le maniglie
della selezione, che scala tutto); la sola lettura (nessuna maniglia); il
dito (l'area di presa 44 px nello spazio Semplice).
Fatto quando: `engine.test.ts` prova le quattro maniglie, l'area di
presa, Maiusc, Alt, il doppio clic per testo e immagine, e un solo
annulla; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T67 · I fili: collegare senza mirare, prendere un filo

Perché: D1, D2, D7 e D8: al passaggio su una scheda quattro punti sui
lati; tutta la scheda è il bersaglio e il lato lo sceglie Fub;
rilasciando nel vuoto nasce una scheda di testo collegata; Alt+trascina dal
corpo collega; con due schede scelte C le collega; un'estremità
riattaccata nel vuoto torna dov'era; un filo si prende entro 8 px.
Tocca: `apps/client/src/editors/canvas/edges.ts` (nuovo) e `edges.test.ts`
(nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: la forma del filo (D6, v2); il nucleo di N3 (un filo si
toglie con la patch che dice `at`, N3 T20).
Dipende da: T25 approvato; N3 T20 (nella base)
Cosa fare:
- `edges.ts`, puro: il lato più vicino fra due schede, la distanza di un
  punto da un filo, il filo sotto un punto entro 8 px sullo schermo.
- Quattro punti sui lati al passaggio; si tira da un punto, si rilascia
  su qualsiasi parte di un'altra scheda; il lato lo sceglie `edges.ts`.
- Rilasciando nel vuoto: una scheda di testo lì, collegata, già in
  scrittura, in un commit solo; Esc durante il trascinamento annulla tutto.
- Alt+trascina dal corpo di una scheda tira un filo (nel vuoto sposta
  ancora la vista, T53); «Collega» nella barra della selezione (T51) e poi
  un clic sulla seconda; C con due schede scelte le collega, con una
  comincia il collegamento (D-19 (a)).
- Riattaccare: si trascina un'estremità su un'altra scheda; nel vuoto
  torna dov'era, niente cancellato.
- Al passaggio il filo si scurisce; un clic lo sceglie; Canc lo toglie.
Dal prototipo: i quattro punti, il filo al passaggio, il filo scelto
(T25).
Casi limite: due schede sovrapposte (il bersaglio è quella sopra); un filo
sopra una scheda (la scheda vince fuori dagli 8 px); 200 fili (la ricerca
del filo sotto il puntatore guarda solo quelli in vista); un filo da una
scheda a sé stessa; la sola lettura (niente punti, i fili si scelgono per
leggerli); la penna (scrive, non collega: D3 è v2).
Fatto quando: `edges.test.ts` prova il lato più vicino e la distanza;
`engine.test.ts` prova il tiro su tutta la scheda, il rilascio nel vuoto
in un solo annulla, Esc, Alt+trascina, C con una e con due schede, il
riattacco nel vuoto che non cancella, la presa entro 8 px e Canc con la
patch `at`; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T68 · Copia e incolla le schede

Perché: E9 ed E8: si copiano le schede, i fili fra loro e l'inchiostro
attaccato; si incollano sotto il puntatore, anche in un'altra lavagna;
verso altri programmi va il Markdown delle schede. Ctrl+D ripete l'ultimo
sfalsamento.
Tocca: `apps/client/src/editors/canvas/clipboard.ts` (nuovo) e
`clipboard.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`
(copia, taglia, incolla, duplica),
`apps/client/src/editors/canvas/engine.test.ts`,
`docs/reference/canvas-format.md` (di N3: la sezione «Negli appunti»).
Non toccare: incollare un'immagine, un indirizzo e le celle (T15, come
oggi); il nucleo di N3 (le schede incollate passano dal suo commit).
Dipende da: T15; N3 T20 (nella base)
Cosa fare:
- Copiando: negli appunti `application/x-fub-canvas+json` con
  `{ "version": 1, "nodes": [...], "edges": [...] }` (i soli fili fra
  schede copiate, l'inchiostro attaccato nei loro campi `fub:ink`, i campi
  sconosciuti com'erano), e `text/plain` con il Markdown delle schede in
  ordine di lettura (il testo; per un file, il suo link `[[…]]`).
- Incollando la forma di Fub: id nuovi, le stesse distanze fra le
  schede, sotto il puntatore (T15); un commit, un annulla. Una versione
  futura si rifiuta con una notifica, mai a metà.
- Taglia: copia e toglie (le schede di file restano file: «Tolta dalla
  lavagna. Il file resta.»).
- Ctrl+D dopo aver spostato la copia ripete lo stesso spostamento (se la
  tela non lo fa già: il coder lo controlla).
- La sezione «Negli appunti» in `canvas-format.md`: la forma, la versione,
  che cosa succede in un'altra lavagna e in un altro vault.
Casi limite: incollare in un altro vault (i file che non ci sono:
schede «File mancante», T16); incollare due volte (due copie, la seconda
sfalsata); 500 schede negli appunti; un JSON rotto negli appunti (si
incolla come testo); una lavagna in sola lettura (niente); un tratto
libero copiato insieme alle schede (va con loro).
Fatto quando: `clipboard.test.ts` prova la forma, il Markdown, la
versione futura e il JSON rotto; `engine.test.ts` prova copia e incolla
in un'altra lavagna con fili e inchiostro, taglia, un solo annulla e
Ctrl+D ripetuto.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T69 · A chi appartiene un tratto

Perché: F8: mentre si scrive, la scheda sotto si accende con un bordo
tratteggiato e vicino alla penna un'etichetta dice «Si attacca a
voti.xlsx»; a cavallo di due schede «Libero sulla lavagna»; con Alt
tenuto il tratto resta libero. Si sa prima di alzare la penna.
Tocca: `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/anchor.ts` (di N4: la scelta dell'ancora
mentre si scrive, non solo alla fine),
`apps/client/src/editors/canvas/engine-ink.test.ts` (di N4),
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: il formato delle ancore; `apps/client/src/ink/` (la scia è di
N4); la latenza della penna (l'etichetta non tocca il percorso della
scia).
Dipende da: T25 approvato; N4 T12 (nella base)
Cosa fare:
- Mentre la penna è giù, l'ancora che il tratto avrebbe se finisse ora
  (la stessa regola di N4, e di T19 e T38 se ci sono); quando cambia, il
  bordo tratteggiato passa alla scheda nuova e l'etichetta cambia; al più
  una volta per fotogramma.
- Alt tenuto: l'ancora `free`, e l'etichetta lo dice.
- L'etichetta sta vicino alla penna, mai sotto la punta; sparisce
  all'alzata.
Dal prototipo: il bordo e l'etichetta (T25).
Casi limite: un tratto che passa da una scheda a un'altra (l'etichetta
segue la regola, che guarda il riquadro del tratto); una scheda in
scrittura sotto la penna; il movimento ridotto (niente animazione del
bordo); il lettore di schermo (l'ancora si annuncia all'alzata, non a ogni
cambio); 200 tratti al minuto (nessun lavoro in più per campione).
Fatto quando: `engine-ink.test.ts` prova l'etichetta su una scheda, a
cavallo di due, con Alt, e che all'alzata l'ancora del tratto è quella
dell'etichetta; S8 di N4 non peggiora (il numero nel rapporto); le foto
del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T70 · Convertire

Perché: C13: testo → nota («Estrai in una nota», chiede solo il nome,
proposto dalla prima riga, nella cartella della lavagna); nota → testo
(«Copia il testo qui»); file → altro file («Sostituisci il file…», che
tiene posto, fili e inchiostro).
Tocca: `apps/client/src/editors/canvas/engine.ts` (le voci, la scheda che
cambia specie), `apps/client/src/editors/canvas/surface.ts`,
`apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts` (le porte per creare e
leggere una nota), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `COMMANDS.create` e la lettura delle note (si usano); il
nucleo di N3.
Dipende da: T17, T48
Cosa fare:
- «Estrai in una nota» su una scheda di testo: il nome proposto dalla
  prima riga (senza `#`, pulito come i nomi delle note), nella cartella
  della lavagna; la nota nasce col testo; la scheda diventa una scheda di
  file su quella nota, allo stesso posto, coi suoi fili e il suo
  inchiostro; un annulla riporta la scheda di testo, e la nota resta nel
  vault (la notifica lo dice, con «Apri»).
- «Copia il testo qui» su una scheda di nota: una scheda di testo col
  testo della nota, accanto; la nota non cambia.
- «Sostituisci il file…» su una scheda di file: il selettore di file di
  oggi; la scheda tiene posto, misura, fili e inchiostro.
- Sono comandi del catalogo (T48), nel tasto destro e in Ctrl+/.
Casi limite: un nome che c'è già (Fub propone «nome 1»); una prima riga
vuota o lunghissima (il nome di serie, tagliato a 80 caratteri); una
nota molto lunga in «Copia il testo qui» (la scheda nasce alta al più
come la vista, e scorre); la sola lettura (le voci sono spente); il file
sostituito con uno di un'altra specie (la scheda cambia specie, e
l'inchiostro attaccato a una pagina che non c'è resta nel file e non si
mostra).
Fatto quando: `engine.test.ts` prova i tre comandi, il nome proposto, il
nome che c'è già, un solo annulla per ognuno, e che fili e inchiostro
restano attaccati.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T71 · Le guide e la griglia

Perché: E5: guide intelligenti (bordi e centri delle altre schede, spazi
uguali, la griglia); Ctrl+' mostra la griglia; Alt tenuto spegne l'aggancio
per quel gesto. La griglia resta di 8 px (A-23).
Tocca: `apps/client/src/editors/canvas/guides.ts` (nuovo) e
`guides.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`.
Non toccare: `CANVAS_SNAP` (resta 8); le guide del disegno (`editors/spatial/`:
si imitano).
Dipende da: T50, T33
Cosa fare:
- `guides.ts`, puro: per la scheda che si sposta o si ridimensiona, le
  guide verso i bordi e i centri delle schede in vista entro 6 px sullo
  schermo, e gli spazi uguali fra tre schede in fila; vince la guida più
  vicina, poi la griglia.
- Le guide si disegnano durante il gesto, in un solo elemento; l'aggancio
  le usa al posto della griglia quando ci sono.
- `canvas.grid` mostra i punti della griglia; `canvas.snap` accende
  l'aggancio; Ctrl+' cambia `canvas.grid` per questa lavagna (stato di
  vista); Alt tenuto spegne l'aggancio per quel gesto.
Dal prototipo: le guide e la griglia (T26).
Casi limite: 2000 schede (solo quelle in vista); una scheda che si sposta
dentro un gruppo; lo zoom al 5% (la griglia non si disegna sotto i 4 px
sullo schermo); Alt mentre si ridimensiona (anche T66).
Fatto quando: `guides.test.ts` prova bordi, centri, spazi uguali e la
precedenza; `engine.test.ts` prova l'aggancio con le guide, Alt, Ctrl+' e
le due impostazioni.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T72 · Spargi le pagine

Perché: C4: «Spargi le pagine» crea una scheda per pagina, in riga, anche
solo per un intervallo («3–7»). Non è un estratto: ogni scheda è il PDF
con `#page=N`, che Obsidian legge (A-24), e si fa con pdf.js.
Tocca: `apps/client/src/editors/canvas/engine.ts` (la voce, le schede
nuove), `apps/client/src/editors/canvas/cards/pdf.ts` (il numero delle
pagine), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: i tasselli di PdfCraft (T79); il formato (`#page=N` c'è già).
Dipende da: T17, T48
Cosa fare:
- «Spargi le pagine…» nel tasto destro di una scheda PDF e in Ctrl+/:
  chiede l'intervallo («3-7, 9», di serie tutte), con lo stesso campo che
  userà il selettore (T80) se c'è già, sennò `kit/field.ts`.
- Le schede nascono in riga accanto alla scheda (a capo dopo 10), con le
  misure di nascita del PDF (T29), oltre 12 in un gruppo (come T15); un
  commit, un annulla.
Casi limite: un PDF di 600 pagine (oltre 200 chiede conferma); un
intervallo fuori dalle pagine (si taglia e si dice); «20-» (fino alla
fine); un PDF che non si apre (la voce è spenta); la sola lettura.
Fatto quando: `engine.test.ts` prova tutte le pagine, un intervallo, il
gruppo oltre 12, la conferma oltre 200 e un solo annulla.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/engine.test.ts
Stato: [ ] da fare

## T73 · Il formato degli estratti: `fub:parts`

Perché: S1 e S19 di `lavagna.md`: un estratto è una finestra sul file
vero, non una copia. Nel `.canvas` è un nodo `file` con il `subpath` sulla
prima parte (`#page=3`, `#Formula`), così Obsidian ne mostra almeno quella,
e il resto in un campo `fub:parts`. È un formato pubblico: lo leggono il
TypeScript, il nucleo Rust e chi apre il file senza Fub.
Tocca: `crates/fub-canvas-core/src/parts.rs` (nuovo),
`crates/fub-canvas-core/src/lib.rs`,
`crates/fub-canvas-core/tests/parts_vectors.rs` (nuovo),
`apps/client/src/__fixtures__/canvas-parts/` (nuovo: i vettori, scritti a
mano), `apps/client/src/editors/canvas/parts.ts` (nuovo) e `parts.test.ts`
(nuovo), `apps/client/src/editors/canvas/cards.ts` (da T1: `parts` nel
`CardContext`), `docs/reference/canvas-parts.md` (nuovo),
`docs/reference/canvas-format.md` (di N3: un rimando), `docs/README.md` (la
riga accanto a «L'inchiostro della lavagna»), `docs/decisions/` (un ADR
nuovo, «Gli estratti sono finestre», il primo numero libero quando si
fonde), `docs/decisions/README.md`.
Non toccare: il resto del formato di N3 (le regole di lettura e scrittura,
l'ordine dei campi); `fub:ink` di N4; `engine.ts` (le schede-estratto le fa
T75).
Dipende da: niente in N6; la base di N4 (A-15: `fub-canvas-core` c'è solo
lì)
Cosa fare:
- `fub:parts` è un oggetto con `kind`; quattro specie in v1:
  - `pages`: `{ "kind": "pages", "pages": [3, 4, 5, 8], "layout": "one" }`;
    le pagine da 1, in ordine di scelta, senza doppioni; `layout` è `one`,
    `row` o `column`, e se manca vale la regola di serie (una pagina sola
    grande, fino a tre in fila, da quattro in su una alla volta);
  - `region`: `{ "kind": "region", "page": 7, "rect": [0.1, 0.306, 0.8,
    0.141], "key": "…" }`; `rect` è `[x, y, larghezza, altezza]` in
    frazioni della pagina come si vede, dall'angolo in alto a sinistra;
    `key`, facoltativo, è l'impronta della pagina che darà PdfCraft P4
    (serve alle fonti che cambiano, S15, v2);
  - `sections`: `{ "kind": "sections", "sections": ["Varianza", "Media"] }`;
    ogni voce come Obsidian la scrive dopo il `#` (anche `Capitolo#Varianza`);
  - `image`: `{ "kind": "image", "rect": [0, 0.25, 1, 0.5], "rotate": 90 }`;
    `rotate` in gradi in senso orario, di serie 0; Fub ne scrive solo
    multipli di 90, e ne legge qualsiasi.
- Il `subpath` lo scrive Fub dalla prima parte: `#page=3` per `pages`,
  `#page=7` per `region`, `#Varianza` per `sections`; niente per `image`
  (Obsidian mostra l'immagine intera, e la pagina lo dice). Una parte sola
  che il `subpath` dice già tutta (una pagina, una sezione) non scrive
  `fub:parts`.
- Leggere: una specie sconosciuta, un campo che non vale (una pagina non
  intera o minore di 1, un `rect` fuori da 0…1 o con un lato non positivo,
  una lista vuota) o un `subpath` diverso da quello che la prima parte
  darebbe (qualcuno l'ha cambiato fuori da Fub): la scheda mostra ciò che
  dice il `subpath`, come Obsidian, e `fub:parts` resta nel file byte per
  byte finché non si sceglie di nuovo. I campi sconosciuti dentro
  `fub:parts` si conservano (A11 di N3).
- In Rust e in TypeScript la stessa lettura e la stessa scrittura, con i
  numeri scritti come li scrive JavaScript (`js.rs` di N3); i vettori
  nuovi passano in tutti e due.
- `CardContext` riceve `readonly parts?: CanvasParts | null` (letto, già
  provato), e `canvas-cards.md` lo dice.
- `canvas-parts.md`: le quattro specie con un esempio ciascuna, le regole
  di lettura, che cosa vede Obsidian, come cresce (v2: blocchi `^id`,
  fogli, pagine web). L'ADR: perché un campo accanto al `subpath` e non un
  nodo nuovo, perché le frazioni della pagina, perché vince il `subpath`.
Casi limite: `pages` con 2000 pagine (si legge; Fub ne scrive al più 1000,
e il selettore lo dice); `pages` non ordinate (l'ordine di scelta si
tiene); un `rect` con 0,9999999 per errori d'arrotondamento (si accetta
entro 1e-6); `fub:parts` su un nodo di testo o di gruppo (si conserva e si
ignora); `fub:parts` con `kind` di un'altra specie di file (`image` su un
PDF: non vale, si mostra il `subpath`); un file scritto da una versione
futura di Fub con `"kind": "cells"` (si conserva, si mostra il `subpath`).
Fatto quando: `cargo test -p fub-canvas-core --test parts_vectors` e
`parts.test.ts` leggono e riscrivono ogni vettore con gli stessi byte;
un file con `fub:parts` sconosciuto torna identico dopo uno spostamento
della scheda; la pagina e l'ADR ci sono e `check-doc-links` passa.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas/parts.test.ts
Stato: [ ] da fare

## T74 · Il selettore delle sezioni

Perché: S2 e S8 di `lavagna.md`: rilasciando una nota con più sezioni la
scheda nasce subito e accanto si apre il selettore, attaccato alla scheda;
si scrive, si sceglie, Invio. Chi non vuole scegliere non perde niente
(A-25).
Tocca: `apps/client/src/editors/canvas/parts-picker.ts` (nuovo) e
`parts-picker.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`
(l'apertura dopo il rilascio, la voce «Parti…»),
`apps/client/src/editors/canvas/surface.ts` (una porta per il sommario di
una nota), `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: `host/query.ts` (il sommario c'è: `runQuery({kind:"outline",
doc})`); `kit/popover.ts` e `kit/list.ts` (si usano); i blocchi `^id` (v2,
la tabella dell'area S); i PDF (T80).
Dipende da: T73, T48, T28 approvato, T33 (`canvas.parts_picker`)
Cosa fare:
- Dopo il rilascio di una sola nota con almeno due titoli, sulla lavagna
  in scrittura, con `canvas.parts_picker` acceso e senza Alt: la scheda
  nasce con la nota intera, e accanto (dove il prototipo dice) si apre il
  selettore, sopra `kit/popover.ts`, che segue la scheda quando la vista
  si muove.
- Dentro: il campo con il fuoco, che filtra i titoli; la lista dei titoli
  con una casella e il rientro del loro livello (`kit/list.ts`,
  virtualizzata); a destra l'anteprima della sezione sotto il cursore
  (`renderEmbed` con il suo `subpath`, come T4); il piede dice che cosa
  farà Invio: «Metti 2 sezioni», «Metti la sezione», «Metti tutta la nota».
- Invio: una sezione → il `subpath` `#Titolo`; due o più → `fub:parts`
  `sections` e il `subpath` della prima (T73); un commit, e un annulla
  riporta la nota intera (un altro toglie la scheda).
- Esc, la crocetta o un clic fuori: la nota intera resta, niente cambia.
  Alt tenuto al rilascio salta il selettore. «Parti…» (menu della scheda e
  Ctrl+/, un comando del catalogo T48) lo riapre quando si vuole, con le
  sezioni di adesso già spuntate.
- Tastiera: ↑ e ↓ muovono, Spazio spunta, Invio mette, Esc chiude; il
  lettore di schermo sente la lista con le caselle e quante sono scelte.
Dal prototipo: il selettore attaccato alla scheda, la lista, l'anteprima,
il piede (T28).
Casi limite: una nota senza titoli o con un titolo solo (niente
selettore, `lavagna.md`); 300 titoli; due titoli con lo stesso testo (si
usa il percorso `Capitolo#Titolo` come Obsidian; se anche quello è doppio
il piede dice che si vedrà il primo); più file rilasciati insieme (niente
selettore: «Parti…» dopo); una nota dal computer appena depositata, non
ancora nell'indice (niente selettore, «Parti…» dopo); la sola lettura
(niente selettore, la voce spenta); la scheda tolta o annullata col
selettore aperto (si chiude); la finestra di 700 px (il selettore va dove
c'è posto, come dice il prototipo).
Fatto quando: `parts-picker.test.ts` prova filtro, spunte, tastiera e il
piede; `engine.test.ts` prova l'apertura dopo il rilascio, Alt, Esc che
non cambia niente, l'impostazione spenta, una e due sezioni scritte nel
file come dice `canvas-parts.md`, un solo annulla e «Parti…»; le foto del
banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T75 · La scheda-estratto di una nota

Perché: S9, S8 e S11 di `lavagna.md`: l'estratto si riconosce (la fonte e
le parti in colore d'accento, ↗), mostra le sezioni scelte del file vero e
porta alla fonte intera con un gesto. In v1 per le note; i PDF arrivano con
T82.
Tocca: `apps/client/src/editors/canvas/excerpt.ts` (nuovo: la testata e la
cornice di ogni estratto) e `excerpt.test.ts` (nuovo),
`apps/client/src/editors/canvas/cards/note.ts` e `note.test.ts` (da T4: più
sezioni), `apps/client/src/editors/canvas/engine.ts` (la testata, «Mostra
tutto il file»), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: la scrittura di una sezione sola (v2, S8): in v1 la sezione
si legge, come le note incorporate nelle note; la scrittura della nota
intera resta quella di T41; `fub:parts` (T73).
Dipende da: T74, T39 (il titolo sopra la scheda)
Cosa fare:
- La testata dell'estratto (sopra la scheda, con D-21 (a), T39): l'icona
  e il nome della fonte, le parti in colore d'accento («§ Varianza · §
  Media»), ↗ per aprire la fonte.
- Il corpo: le sezioni scelte una sotto l'altra, ognuna col suo titolo in
  piccolo, rese come T4; il file vero, quindi se la nota cambia la scheda
  la segue (S1).
- Doppio clic sulla testata o ↗: la nota si apre in un riquadro a destra,
  alla prima sezione, illuminata per un secondo; Ctrl+clic (Cmd+clic) in
  una scheda dell'editor (S11). Entrare nella scheda (doppio clic sul
  corpo, Invio) scorre e sceglie il testo; «Apri a lato» per scrivere.
- «Mostra tutto il file» (menu e Ctrl+/): toglie `fub:parts` e il
  `subpath` in un commit.
- Da lontano come le altre schede (T54): il titolo grande; le sezioni
  tornano avvicinandosi.
Dal prototipo: la testata, le parti, la cornice (T28).
Casi limite: una sezione rinominata o tolta nella nota (la scheda dice
«Sezione non trovata: Media» con «Scegli di nuovo…» e «Mostra tutta la
nota», e le altre sezioni si vedono); tutte le sezioni sparite; la nota
rinominata (il link si aggiorna come oggi, le parti restano); 20 sezioni
in una scheda piccola (l'ombra «continua», T4); la stessa nota intera e in
estratto sulla stessa lavagna («×2» conta tutte e due, T22); la sola
lettura (si legge, niente «Mostra tutto il file»).
Fatto quando: `excerpt.test.ts` prova la testata e le parti;
`note.test.ts` prova due sezioni e la sezione che non c'è più;
`engine.test.ts` prova ↗, il doppio clic sulla testata, Ctrl+clic e
«Mostra tutto il file» in un solo annulla; le foto del banco somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T76 · Leggere da vicino

Perché: S10 di `lavagna.md`: Spazio toccato e lasciato, con un estratto o
una nota scelti, apre il lettore sopra la lavagna; Esc o di nuovo Spazio
tornano esattamente dov'eri. Spazio tenuto sposta ancora la vista (T53).
In v1 per le note; i PDF arrivano con T83.
Tocca: `apps/client/src/editors/canvas/reader.ts` (nuovo) e
`reader.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts` (il
tocco di Spazio), `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: lo spostamento con Spazio tenuto (T53: resta com'è, e il
tocco non lo ritarda); `ui/lightbox.ts` (le immagini hanno il loro
visore).
Dipende da: T75
Cosa fare:
- Il tocco: Spazio giù e su entro 0,3 s, senza che il puntatore si muova,
  con una scheda di nota o un estratto di nota scelti, fuori da un campo e
  da una scheda in scrittura: si apre il lettore. Oltre 0,3 s, o col
  puntatore che si muove, è lo spostamento di T53.
- Il lettore copre l'area della lavagna (non la finestra): la nota intera,
  resa grande, con le sezioni dell'estratto segnate e la prima già in
  vista; a lato i titoli della nota, quelli dell'estratto segnati.
- Le frecce, PgSu e PgGiù scorrono tutta la nota; una sezione fuori
  dall'estratto, sotto il cursore, si aggiunge con Invio o «+ Aggiungi
  all'estratto» (un commit su `fub:parts`, T73); su una nota intera il
  lettore legge e basta.
- Esc o Spazio: il lettore si chiude e tutto è com'era (vista, scelta,
  fuoco sulla scheda).
- È un dialogo per il lettore di schermo (`role="dialog"`, il fuoco dentro
  finché è aperto, poi torna alla scheda).
Dal prototipo: il lettore e il posto che resta (T28).
Casi limite: Spazio toccato senza niente scelto (niente); più schede
scelte (niente); la nota cambiata da un riquadro mentre il lettore è
aperto (si aggiorna); la nota tolta dal vault (il lettore si chiude e la
scheda diventa «File mancante», T16); la sola lettura (si legge, niente
«+ Aggiungi»); una tastiera senza tasto di ripetizione lenta (la soglia
di 0,3 s non dipende dalla ripetizione del sistema); il movimento ridotto.
Fatto quando: `reader.test.ts` prova le sezioni segnate, la navigazione e
«+ Aggiungi all'estratto»; `engine.test.ts` prova il tocco sotto e sopra
0,3 s, lo spostamento con Spazio tenuto ancora uguale, e che dopo Esc
camera, scelta e fuoco sono gli stessi; le foto del banco somigliano al
prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T77 · Le fonti di questa lavagna

Perché: S16 di `lavagna.md`: nell'ispettore, in fondo all'elenco delle
schede, «Fonti su questa lavagna»: per ogni file una barra con le pagine o
le sezioni già usate; si vede che cosa del capitolo è già lì e che cosa no.
Tocca: `apps/client/src/editors/canvas/sources.ts` (nuovo, puro) e
`sources.test.ts` (nuovo), `apps/client/src/editors/canvas/chrome/inspector.ts`
(da T58), `apps/client/src/editors/canvas/chrome/inspector.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: il visore PDF («su 2 lavagne» è v2); l'indice del vault.
Dipende da: T58, T75
Cosa fare:
- `sources.ts`: dalle schede della lavagna, per ogni file usato più di
  zero volte, le parti usate (le pagine di `#page=N`, di «Spargi le
  pagine» e di `fub:parts`; le sezioni di `subpath` e `fub:parts`; il file
  intero), in ordine di nome.
- Nell'ispettore, «Fonti su questa lavagna»: una riga per file con la
  barra delle pagine (quante sono, dal PDF quando si sa) o delle sezioni
  (dal sommario della nota), le usate in colore d'accento; il numero delle
  schede.
- Un clic su un pezzo della barra porta alla scheda che lo mostra (T56:
  un salto, Indietro torna); un clic sulla barra fuori dai pezzi usati apre
  il selettore per prenderne un altro (T74 per le note; per i PDF quando
  c'è T80, prima sceglie le schede di quel file).
Dal prototipo: le fonti nell'ispettore (T28).
Casi limite: un PDF di cui non si sa ancora quante pagine ha (la barra
elenca «pp. 3, 7»); 80 file sulla lavagna (la lista virtualizzata);
una nota senza titoli (solo «tutta»); un file mancante (la riga grigia,
come la scheda); una lavagna senza file (la sezione non c'è).
Fatto quando: `sources.test.ts` prova pagine, sezioni, file intero,
file mancante e l'ordine; `inspector.test.ts` prova la sezione, il clic
su un pezzo che porta alla scheda e quello che apre il selettore; le foto
del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T78 · La zona di un'immagine

Perché: la tabella dell'area S e la riga «Immagine» dell'area T di
`lavagna.md`: di un'immagine si prende una zona, la si ruota, senza toccare
il file. Il doppio clic resta il visore (C5): si ritaglia con «Ritaglia e
ruota».
Tocca: `apps/client/src/editors/canvas/cards/image.ts` e `image.test.ts`
(da T5), `apps/client/src/editors/canvas/crop.ts` (nuovo, il gesto) e
`crop.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts` (la
voce, la scheda che prende le proporzioni del ritaglio),
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: il file dell'immagine (mai scritto);
`editors/spatial/tools/crop.ts` (del disegno: si imita, A-27);
`ui/lightbox.ts`.
Dipende da: T73, T51 (la barra della selezione), T28 approvato
Cosa fare:
- «Ritaglia e ruota» (menu, barra della selezione, Ctrl+/): sopra la
  scheda le maniglie del taglio sull'immagine intera e due pulsanti ↺ ↻;
  Invio o «Fatto» scrive `fub:parts` `image` (T73) in un commit; Esc lascia
  com'era; «Togli il ritaglio» torna all'immagine intera.
- La scheda tiene la larghezza e prende le proporzioni della zona ruotata;
  l'immagine ferma (T2) ha la parte con la zona nel nome, così due tagli
  dello stesso file non si confondono.
- La zona resta nitida a ogni zoom: è l'immagine vera mostrata a pezzi,
  non un'immagine nuova.
Dal prototipo: il taglio e la rotazione (T28).
Casi limite: un SVG (si taglia come le altre); una GIF animata (si taglia
il primo fotogramma, come la scheda ferma); un taglio di 1 px (il minimo
è 1/100 del lato); l'immagine sostituita con una di altre proporzioni (la
zona in frazioni resta, e può tagliare altro: si vede, il file è intatto);
l'inchiostro già sulla scheda (resta attaccato alla scheda, come dice la
regola di N4, e il piede del taglio lo dice); Obsidian (mostra l'immagine
intera: lo dice `canvas-parts.md`); la sola lettura (niente voce).
Fatto quando: `crop.test.ts` prova il gesto, i limiti e la rotazione;
`image.test.ts` prova la zona e la rotazione disegnate e la parte della
cache; `engine.test.ts` prova «Fatto» in un solo annulla, Esc, «Togli il
ritaglio» e che il file dell'immagine non riceve mai una scrittura; le
foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T79 · La scheda PDF sui tasselli di PdfCraft

Perché: S18 di `lavagna.md` e A-24: con PdfCraft (P1) una scheda PDF
chiede al motore solo i tasselli di ciò che si vede, alla scala a cui si
vede, e condivide la cache del visore; il limite dei 64 MiB sparisce per i
PDF. È la base degli estratti di PDF (T80–T85).
Tocca: `apps/client/src/editors/canvas/cards/pdf.ts` e `pdf.test.ts` (da
T6), `apps/client/src/editors/canvas/cards.ts` (se il contratto chiede una
porta per i tasselli: la dice `canvas-cards.md`),
`docs/reference/canvas-cards.md`, `docs/misure/` (una pagina nuova con la
data), `docs/misure/README.md`.
Non toccare: `editors/media/pdfcraft-engine.ts` e la cache dei tasselli
(sono di PdfCraft P1: si usano); `pdf-view.ts`; la scelta del motore
(`pdf.motore`, di P1).
Dipende da: T39 (il contenuto della scheda è la pagina intera, A-20);
PdfCraft P1 in `main` (nessun piano ancora: «Non verificato stanotte»)
Cosa fare:
- Con `pdf.motore` su PdfCraft, la scheda viva disegna la pagina coi
  tasselli del motore per la sua zona e il suo zoom, nella cache condivisa
  col visore; con pdf.js resta com'è (T6). Lo stesso `PdfEngine` di oggi
  per tutti e due, se P1 lo tiene (`pdfcraft.md`: «lo stesso `PdfEngine` di
  oggi sopra PdfCraft»).
- Sotto lo zoom 0,35 l'immagine ferma (T13), come oggi.
- `pageBox()` (T19) e `contentAspect()` (T39) danno gli stessi numeri con i
  due motori.
Casi limite: un PDF di 300 MiB (si apre: il limite è sparito con P1); 30
schede PDF vive (i tasselli in coda, prima quelli al centro della vista);
il motore che non sa una pagina (quella pagina con pdf.js, se P1 lo fa
così, o «Apri con l'app di sistema»); il motore cambiato a lavagna aperta
(le schede si rifanno al prossimo fine gesto).
Fatto quando: `pdf.test.ts` passa con il motore finto di pdf.js e con
quello di PdfCraft, con gli stessi `pageBox()` e `contentAspect()`;
S3 e S9, rifatte col comando di T20 e il motore di PdfCraft, non
peggiorano, e i numeri vanno in una pagina nuova di `docs/misure/`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas/cards/pdf.test.ts; cd apps/client && npm run build && cd ../.. && cargo build --release
--locked -p fub-app --features tauri/custom-protocol && cd apps/client &&
xvfb-run -a npm run bench:webview -- --only=S3,S9 --budgets=targets
--native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T80 · Il selettore delle pagine

Perché: S2, S3, S4 e S5 di `lavagna.md`: rilasciando un PDF con più pagine
si apre lo stesso selettore delle note (T74): «12» e Invio, «3-5, 8, 20-»,
i numeri stampati del libro («p. 112 (124ª del file)», «#124» per la
posizione), le miniature, il sommario, la ricerca per parola.
Tocca: `apps/client/src/editors/canvas/parts-picker.ts` e
`parts-picker.test.ts` (da T74), `apps/client/src/editors/canvas/page-range.ts`
(nuovo, puro: «3-5, 8, 20-», le etichette) e `page-range.test.ts` (nuovo),
`apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: il sommario, le etichette e la ricerca dentro il PDF (sono di
PdfCraft P1 e P4: si chiedono); «Spargi le pagine» (T72: usa
`page-range.ts` quando c'è).
Dipende da: T79, T74; PdfCraft P4 in `main`
Cosa fare:
- Dopo il rilascio di un solo PDF con più di una pagina (le stesse regole di
  T74: `canvas.parts_picker`, Alt, Esc tiene tutto, «Parti…» dopo), il
  selettore con le miniature virtualizzate, disegnate leggere e solo quando
  si vedono, e il campo pronto.
- Il campo: «12», «3-5, 8, 20-» (da 20 alla fine), «#124»; i numeri
  stampati (le etichette di P4) e il campo lo dice: «p. 112 (124ª del
  file)». `page-range.ts` legge e scrive il campo, con le etichette.
- Le miniature: clic sceglie o toglie, Maiusc+clic l'intervallo, doppio clic
  mette solo quella e chiude; il numero dell'ordine di scelta sulla
  miniatura; le pagine già sulla lavagna col pallino verde, e sceglierle di
  nuovo chiede «È già lì: vai, o mettine un'altra?».
- La linguetta «Sommario»: i capitoli col loro intervallo; un clic sceglie
  le pagine del capitolo. Una parola nel campo accende le pagine che la
  contengono e vela le altre; «Scegli le pagine trovate» o Invio le prende.
- Invio: una pagina → il `subpath` `#page=N`; più pagine → `fub:parts`
  `pages` (T73); il piede dice «Metti 3 pagine», «Metti tutto il PDF».
Dal prototipo: il selettore dei PDF (T28).
Casi limite: un libro di 600 pagine (si apre subito); un PDF senza
etichette (i numeri sono quelli del file, e «#» non serve); etichette
romane («iv»); un intervallo fuori dal PDF (si taglia e il piede lo dice);
una parola che non c'è (nessuna pagina accesa, il piede lo dice); un PDF
protetto da password (niente selettore: la scheda dice che è protetto,
come oggi); oltre 1000 pagine scelte (il limite di T73, il piede lo dice).
Fatto quando: `page-range.test.ts` prova intervalli, «20-», «#124», le
etichette e gli errori; `parts-picker.test.ts` prova clic, Maiusc+clic,
doppio clic, il pallino verde, il sommario e la parola con un motore finto;
`engine.test.ts` prova una pagina e più pagine scritte come dice
`canvas-parts.md`; le foto del banco somigliano al prototipo.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T81 · Blocchi, zone e figure

Perché: S6 e S7 di `lavagna.md`: a destra del selettore la pagina è
grande; passandoci sopra si accendono i blocchi che il motore ha trovato
(titoli, paragrafi, formule, tabelle, figure); un clic prende esattamente
quel blocco, trascinando si ritaglia una zona a mano. Una figura è di serie
una zona (A-25).
Tocca: `apps/client/src/editors/canvas/parts-picker.ts` e
`parts-picker.test.ts`, `apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: i blocchi e le figure (`edit::reading_blocks`,
`edit::page_images`: di PdfCraft P4, si chiedono); «Come file immagine» e
Maiusc+clic che unisce i blocchi (v2, S7 e S6).
Dipende da: T80; PdfCraft P4 in `main`
Cosa fare:
- La pagina grande nel selettore, coi tasselli di P4 per la zona a ogni
  zoom; le frecce sopra l'anteprima e PgSu/PgGiù cambiano pagina senza
  lasciare il selettore.
- Al passaggio i blocchi di quella pagina si accendono; un clic ne prende
  uno; trascinando si disegna una zona a mano. Il piede: «Metti la zona».
- Una figura scelta è una zona della pagina (nitida, segue il PDF); il
  piede lo dice.
- Invio: `fub:parts` `region` con `page`, `rect` in frazioni della pagina e
  `key` (l'impronta della pagina di P4), e il `subpath` `#page=N` (T73).
Dal prototipo: i blocchi accesi, la zona a mano (T28).
Casi limite: una pagina senza blocchi trovati (solo la zona a mano); un
blocco che esce dalla pagina (si taglia alla pagina); una zona di meno di
8 px sullo schermo (non vale, il piede lo dice); una pagina ruotata
(frazioni della pagina come si vede, T73); la tastiera (Tab passa da un
blocco all'altro, Invio prende).
Fatto quando: `parts-picker.test.ts` prova il blocco al passaggio, il
clic, la zona a mano, la figura come zona e il cambio pagina con un motore
finto; `engine.test.ts` prova la `region` scritta come dice
`canvas-parts.md`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T82 · L'estratto di PDF

Perché: S9, S11, S17 e S18 di `lavagna.md` per i PDF: la scheda-estratto
con le pagine una alla volta, in fila o in colonna, la zona nitida, «+ p.
2» e «+ p. 6» per allargare, le pagine scure per estratto, veloce anche
con cento estratti.
Tocca: `apps/client/src/editors/canvas/excerpt.ts` e `excerpt.test.ts`
(da T75), `apps/client/src/editors/canvas/cards/pdf.ts` e `pdf.test.ts`,
`apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/editors/canvas/engine-cards.test.ts`,
`apps/client/src/editors/canvas/chrome/options.ts` (da T50: «Pagine
scure»), `docs/misure/` (una pagina nuova con la data),
`docs/misure/README.md`, `apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: la cache dei tasselli e i colori di lettura (di PdfCraft P1 e
P4); «Fissa com'è ora» e le fonti che cambiano (v2, S15).
Dipende da: T81, T75; PdfCraft P1 e P4 in `main`
Cosa fare:
- `pages`: le tre disposizioni (una alla volta con le frecce e «p. 4 · 2
  di 3», in fila, in colonna) e la regola di serie di T73; PgSu e PgGiù
  sfogliano un estratto «una alla volta»; la disposizione si cambia dalla
  riga delle opzioni e va in `layout`.
- `region`: la zona della pagina, disegnata coi tasselli di P4 per quella
  zona alla scala a cui si vede; sotto 0,35 l'immagine ferma (T13).
- Con l'estratto scelto, «+ p. 2» e «+ p. 6» ai lati aggiungono la pagina
  prima o dopo, in un commit.
- La testata e ↗ come T75; doppio clic sulla testata o ↗ apre il PDF in un
  riquadro a destra alla pagina, con il pezzo illuminato per un secondo;
  Ctrl+clic in una scheda dell'editor.
- «Pagine scure» nella riga delle opzioni dell'estratto, coi colori di
  lettura del motore (le figure restano come sono); è dello stato della
  vista della lavagna, non del file.
- `pageBox()` (T19) dà la pagina e il riquadro dentro la scheda per ogni
  pagina mostrata, così l'inchiostro sta sulla pagina (T85).
Dal prototipo: le tre disposizioni, la zona, «+ p.» (T28).
Casi limite: cento estratti sulla lavagna (solo i tasselli delle schede
vive, prima quelli al centro); un estratto di 40 pagine in fila (oltre
otto diventa «una alla volta», e il piede della riga lo dice); il PDF
cambiato con meno pagine (le pagine che non ci sono: «Pagina 30 non c'è
più» con «Mostra tutto il file»; S15 è v2); la `key` diversa dalla pagina
di adesso (in v1 si mostra la pagina scritta; la ricollocazione è v2);
la sola lettura (si sfoglia, niente «+ p.»).
Fatto quando: `excerpt.test.ts` e `pdf.test.ts` provano le tre
disposizioni, la regola di serie, la zona, «+ p.» e la pagina che non c'è
più con un motore finto; `engine.test.ts` prova PgSu/PgGiù, ↗, Ctrl+clic e
«Pagine scure» nello stato della vista; S3 e S9, rifatte col comando di
T20, non peggiorano, e i numeri vanno in una pagina nuova di `docs/misure/`;
`engine-cards.test.ts` prova che con cento estratti chiedono tasselli solo
le schede vive, e solo per la loro zona.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas; cd apps/client && npm run build && cd ../.. && cargo build --release
--locked -p fub-app --features tauri/custom-protocol && cd apps/client &&
xvfb-run -a npm run bench:webview -- --only=S3,S9 --budgets=targets
--native-driver=/usr/bin/WebKitWebDriver
Stato: [ ] da fare

## T83 · Il lettore per i PDF

Perché: S10 di `lavagna.md` per i PDF: Spazio toccato con un estratto di PDF
o un PDF scelti apre il lettore: la pagina grande, la zona dell'estratto
illuminata dentro la pagina intera, sotto la striscia di tutte le pagine;
una pagina fuori dall'estratto si aggiunge con Invio.
Tocca: `apps/client/src/editors/canvas/reader.ts` e `reader.test.ts` (da
T76), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine.test.ts`,
`apps/client/src/theme/scrittoio/structure.css`,
`apps/client/src/theme/scrittoio/skin/editors.css`,
`apps/client/src/theme/scrittoio/anatomia/editors.ts`,
`apps/client/src/i18n/catalog.ts`.
Non toccare: il tocco di Spazio (T76: si usa); i tasselli (di P4).
Dipende da: T82, T76; PdfCraft P4 in `main`
Cosa fare:
- Il lettore di T76 per un PDF: la pagina grande, con la zona
  dell'estratto illuminata; la striscia di tutte le pagine sotto, con
  quelle dell'estratto segnate; le frecce sfogliano tutto il PDF.
- Una pagina fuori dall'estratto è segnata, e Invio o «+ Aggiungi
  all'estratto» la aggiunge (`fub:parts`, un commit); su una scheda PDF
  intera il lettore legge e basta.
- «Metti sulla lavagna» nel lettore: una scheda di quella pagina nasce
  accanto all'estratto da cui viene, già collegata con un filo (S12), in un
  commit.
- Esc o Spazio tornano esattamente dov'eri (T76).
Dal prototipo: il lettore dei PDF (T28).
Casi limite: un PDF di 600 pagine (la striscia virtualizzata); una zona
su una pagina che non c'è più (il lettore apre la prima pagina e lo dice);
la sola lettura (niente «+» e niente «Metti»).
Fatto quando: `reader.test.ts` prova la zona illuminata, la striscia,
«+ Aggiungi all'estratto» e «Metti sulla lavagna» con un motore finto;
`engine.test.ts` prova la scheda nuova collegata in un solo annulla.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T84 · Dalla fonte alla lavagna

Perché: S12 di `lavagna.md`, in v1 la sola pagina: mentre si legge nel
visore PDF, una pagina va sulla lavagna con un gesto: si trascina la
miniatura o la pagina sulla lavagna aperta accanto, «Metti sulla lavagna»
la manda all'ultima lavagna usata, Ctrl+Alt+L manda la pagina corrente.
Tocca: `apps/client/src/editors/canvas/surface.ts` (il comando che riceve
una pagina), `apps/client/src/editors/core/bootstrap.ts`,
`apps/client/src/state/document-controller.ts` (l'ultima lavagna usata),
`apps/client/src/ui/drag-types.ts` (un tipo per la pagina di un PDF),
`crates/fub-host/src/shell.rs` (una riga in `SHELL_COMMANDS`),
`apps/client/src/ui/shell-keys.generated.ts` (rigenerato),
`apps/client/src/state/shell-commands.ts` (il comando),
`apps/client/src/editors/canvas/engine.ts` (il rilascio della pagina),
`apps/client/src/editors/canvas/engine.test.ts`, i file del visore nuovo di
PdfCraft P2 (i nomi li dà il suo piano: `editors/pdf/`),
`apps/client/src/i18n/catalog.ts`.
Non toccare: il resto di S12 (zone, testo scelto, pagine copiate, risultati
della ricerca, la maniglia dei Blocchi: v2); il visore di oggi
(`pdf-view.ts`).
Dipende da: T82; PdfCraft P2 in `main`
Cosa fare:
- Il comando della shell `shell.canvas.put_page` (`{ file, page }`): una
  scheda `#page=N` del PDF nell'ultima lavagna usata, al centro della sua
  vista, con le misure di nascita (T29); la notifica dice «Messa su
  {lavagna}» con «Vai» e «Annulla». Senza nessuna lavagna usata, chiede
  quale.
- Il tasto di serie Ctrl+Alt+L (`lavagna.md`; Ctrl+Maiusc+L è già «Blocca»
  nel disegno): la riga in `SHELL_COMMANDS`, nella forma delle vicine, e
  `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_keys_mirror`
  rigenera lo specchio; il test dei conflitti fra i due registri dice se è
  libero, e se non lo è il coder lo scrive nel rapporto e lascia `None`.
- Il trascinamento: una miniatura o la pagina del visore porta il tipo
  nuovo di `drag-types.ts`; la lavagna la riceve come una scheda `#page=N`
  sotto il puntatore (T15).
- «Metti sulla lavagna» nel visore di P2, sulla pagina e sulla miniatura.
- L'ultima lavagna usata: quella che ha avuto il fuoco per ultima, per
  finestra, in memoria.
Casi limite: l'ultima lavagna chiusa (si riapre in un riquadro, non in
primo piano); la lavagna in sola lettura (chiede un'altra); il PDF fuori
dal vault (non si può: la voce è spenta); la stessa pagina già sulla
lavagna (la notifica offre «Vai a quella»); una lavagna in un'altra
finestra (vale quella della finestra del visore).
Fatto quando: `engine.test.ts` prova il rilascio del tipo nuovo e il
comando con una lavagna finta in un solo annulla; una prova nel visore di
P2 trascina una miniatura sulla lavagna accanto; `cargo test -p fub-host
--test shell_keys_mirror` passa e il comando è in «Impostazioni › Tasti».
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test
shell_keys_mirror; cd apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T85 · L'inchiostro sugli estratti

Perché: S14 di `lavagna.md`, in v1 sulla lavagna: un tratto su un estratto
di PDF si attacca alla pagina, in coordinate della pagina (l'ancora di T19);
cambiando disposizione, allargando l'intervallo o la zona, il tratto resta
sulla parola che cerchiava.
Tocca: `apps/client/src/editors/canvas/engine.ts` (dà ad `anchor.ts` la
pagina sotto il tratto in un estratto),
`apps/client/src/editors/canvas/anchor.ts` (di N4),
`apps/client/src/editors/canvas/engine-ink-anchors.test.ts` (da T19),
`docs/reference/canvas-ink.md` (l'ancora di pagina negli estratti).
Non toccare: il formato dell'ancora di pagina (T19: resta quello); il
`.fubann` del PDF («Mostra anche nel PDF» è v2); gli estratti di note (il
tratto è della scheda, come dice N4).
Dipende da: T82, T19
Cosa fare:
- Un tratto che comincia sopra una pagina di un estratto di PDF prende
  l'ancora di pagina di T19 per quella pagina, coi punti in punti PDF;
  sopra la scheda ma fuori da ogni pagina, l'ancora `card`.
- Si disegna dovunque l'estratto mostra quel punto della pagina: in fila,
  in colonna, una alla volta (solo con quella pagina in vista), nella zona
  (tagliato alla zona); una scheda PDF intera con la stessa pagina e
  un'altra copia dell'estratto non lo mostrano: l'ancora è della scheda che
  lo tiene.
Casi limite: un tratto a cavallo di due pagine in fila (va alla pagina
dove comincia, tagliato); la zona ristretta dopo il tratto (il tratto
resta nel file, si vede la parte dentro); la disposizione cambiata (il
tratto segue la pagina); il PDF cambiato (come T19).
Fatto quando: `engine-ink-anchors.test.ts` scrive su un estratto in fila,
cambia in colonna e in «una alla volta», allarga l'intervallo, e il tratto
resta sulla stessa pagina allo stesso punto; un tratto sulla zona ha
l'ancora di pagina coi punti in punti PDF.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T86 · Il lazo e l'inchiostro che si sposta

Perché: E2 e F7 di `lavagna.md`, e il quinto scenario del pigro («Ho scritto
sulla scheda sbagliata»): Q, un giro a mano libera sceglie schede e
tratti; i tratti scelti si spostano, si ricolorano, si ingrossano; lasciati
sopra un'altra scheda passano a lei: «Ora fa parte di voti.xlsx», con
«Annulla» e «Rendilo libero».
Tocca: `apps/client/src/editors/canvas/lasso.ts` (nuovo, puro) e
`lasso.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-ink.test.ts` (di N4),
`apps/client/src/editors/canvas/chrome/rail.ts` (da T49: Q),
`apps/client/src/editors/canvas/chrome/selection-bar.ts` (da T51: colore e
spessore dei tratti), `crates/fub-canvas-core/src/ops.rs` (di N3: due
operazioni nuove), `apps/client/src/editors/canvas/operation.ts`,
`apps/client/src/__fixtures__/canvas-ops/` (vettori nuovi),
`docs/reference/canvas-operations.md` (di N3),
`crates/fub-features/src/lavagna.rs` e
`apps/client/src/editors/canvas/preferences.ts` (il valore `lasso` di
`canvas.pen_button`), `apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/spatial/` (il lazo del disegno, `tools/hit.ts`, non
è esportato: si imita, A-27); le operazioni che ci sono (`add-strokes`,
`erase-strokes`: restano identiche); `apps/client/src/ink/` (di N4).
Dipende da: T49, T69, T26 approvato; D-22 (a) (se la risposta è (b), il
task si riscrive sul motore di K5)
Cosa fare:
- `lasso.ts`: il giro chiuso, una scheda dentro se il suo rettangolo è
  tutto dentro, un tratto se tutti i suoi punti lo sono.
- Q nella colonna (T49) e nel catalogo (T48); col lazo si sceglie come col
  rettangolo, e Maiusc aggiunge.
- Due operazioni nuove nel nucleo, nella forma delle sorelle
  (`add-strokes`, `erase-strokes`): `move-strokes` (i tratti, lo
  spostamento, e la nuova ancora quando cambiano scheda: i punti si
  riportano nelle unità della nuova ancora, come fa `strokeRecord` di N4) e
  `restyle-strokes` (colore e spessore). Atomiche, un annulla per gesto; i
  vettori in Rust e Vitest; la pagina `canvas-operations.md` le dice.
- Trascinando i tratti scelti sopra un'altra scheda, quella si accende come
  in T69; al rilascio i tratti passano a lei e la notifica dice «Ora fa
  parte di {nome}» con «Annulla» e «Rendilo libero» (ancora `free`).
- Con tratti scelti la barra della selezione mostra il colore e lo
  spessore (il cursore delle penne di N4, approvato nel suo prototipo).
- `canvas.pen_button` prende il valore `lasso`.
Dal prototipo: il lazo e la barra coi tratti (T26).
Casi limite: un lazo che prende schede e tratti insieme (si spostano
insieme; i tratti attaccati alle schede scelte vanno con loro); un tratto
attaccato a una pagina di PDF portato su una nota (diventa della scheda);
un tratto `foreign` di un livello estraneo (non si sceglie, N4); 2000 tratti
nel lazo (un'operazione sola); la sola lettura (il lazo sceglie, niente
sposta).
Fatto quando: `lasso.test.ts` prova dentro e fuori; i vettori nuovi passano
in `cargo test -p fub-canvas-core` e in Vitest; `engine-ink.test.ts` prova
il passaggio a un'altra scheda, la notifica con i suoi due pulsanti, il
colore e lo spessore in un solo annulla ciascuno; i tratti non toccati
restano identici byte per byte.
Prova: scripts/check.sh --rapido; cargo test -p fub-canvas-core; cd
apps/client && npx vitest run src/editors/canvas
Stato: [ ] da fare

## T87 · Forme dal tratto e linea dritta

Perché: F5 e F6 di `lavagna.md`: si tiene ferma la penna mezzo secondo alla
fine del tratto e diventa una linea, una freccia, un rettangolo, un'ellisse,
un poligono o una stella; due passi d'annulla, il primo riporta il tratto
com'era. Maiusc durante il tratto lo tiene dritto a passi di 15°; il
righello del disegno per le linee lunghe.
Tocca: `apps/client/src/editors/canvas/ink-shapes.ts` (nuovo) e
`ink-shapes.test.ts` (nuovo), `apps/client/src/editors/canvas/engine.ts`,
`apps/client/src/editors/canvas/engine-ink.test.ts`,
`apps/client/src/editors/canvas/chrome/rail.ts` (il righello),
`apps/client/src/i18n/catalog.ts`.
Non toccare: `editors/spatial/tools/recognize.ts` e `ruler.ts` (si
importano le funzioni pure, A-27); il formato `fub:ink` (una forma resta un
tratto); la latenza della penna (il riconoscimento parte dopo l'alzata o
dopo il mezzo secondo fermo, mai a ogni campione).
Dipende da: T86; D-22 (a)
Cosa fare:
- `ink-shapes.ts`: dai punti del tratto, con `heldShape`, `recognize` e
  `regular` di `recognize.ts`, la forma; dalla forma i punti di un tratto
  `fub:ink` con la stessa penna, lo stesso colore e lo stesso spessore.
- La penna ferma mezzo secondo alla fine (`stillFrom`, `HOLD_MIN_PX`): il
  tratto diventa la forma; il primo annulla riporta il tratto com'era, il
  secondo lo toglie.
- Maiusc durante il tratto: una linea dritta a passi di 15° (`RULER_STEP`).
- Il righello: «Righello» nella colonna e nel catalogo; si mostra sopra la
  lavagna, si gira, e la penna lungo il bordo scrive dritto (`rulerEdge`,
  `alongEdge`).
Dal prototipo: il righello sulla lavagna (T26).
Casi limite: un tratto che non è nessuna forma (resta com'è); un tratto
corto (sotto `HOLD_MIN_PX` niente forma); una forma sopra una scheda
(l'ancora come per ogni tratto, T69); l'evidenziatore (nessuna forma, come
nel disegno se lo fa); Maiusc premuto a metà tratto; il righello a zoom
diversi (la sua misura è sullo schermo).
Fatto quando: `ink-shapes.test.ts` prova le sei forme e il tratto che non
è una forma; `engine-ink.test.ts` prova la penna ferma, i due annulla,
Maiusc a 15° e la penna lungo il righello; il file ha solo tratti `fub:ink`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/canvas
Stato: [ ] da fare

## T88 · La scheda CSV

Perché: D-16 (c): un `.csv` sulla lavagna si vede come foglio solo quando
il motore dei fogli lo sa leggere; fino ad allora è una scheda di file
(«Che cosa si vede»). Chi porta i CSV nel motore lo dice D-20.
Tocca: `apps/client/src/editors/canvas/cards.ts` (`cardKindOf`),
`apps/client/src/editors/grid/card.ts` (da T7),
`apps/client/src/editors/grid/card.test.ts`,
`docs/reference/canvas-cards.md`.
Non toccare: il motore dei fogli e `fub-format-xlsx` (sono del lavoro di
D-20); le schede `.xlsx`.
Dipende da: T7; D-20; il lavoro che porta i CSV nel motore dei fogli (con
D-20 (a) un piano suo, in `main`)
Cosa fare:
- `cardKindOf` dà `sheet` a un `.csv` (e a un `.tsv`, se il motore lo
  legge) solo quando l'host dice che il motore dei fogli lo apre (la stessa
  domanda che fa il riquadro), mai da una lista scritta nel client; sennò
  resta `file`.
- La scheda di foglio di T7 per un CSV: le celle, la riga e la colonna di
  intestazione; scrivere nelle celle (T42) solo se il motore scrive i CSV,
  sennò la scheda è in sola lettura e lo dice.
Casi limite: un CSV di un milione di righe; un separatore `;`; una codifica
che non è UTF-8; un CSV con una formula scritta (`=A1+1`: la mostra come il
motore la legge); il motore che dice di no a un CSV rotto (scheda di file,
con «Apri»).
Fatto quando: `card.test.ts` prova un CSV letto, uno rifiutato e la sola
lettura; con il motore che non legge i CSV, `cardKindOf` dà `file`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/editors/grid/card.test.ts src/editors/canvas
Stato: [ ] da fare

## T89 · Il pigro alla prova

Perché: il cancello della v1 di `lavagna.md`: gli otto scenari principali
del «pigro alla prova» passano (A-29). Si provano tutti insieme, alla fine,
sulla lavagna vera.
Tocca: `apps/client/src/canvas-lazy.e2e.test.ts` (nuovo),
`docs/development/canvas-smoke-test.md` (nuovo), `docs/README.md` (la riga
«Prove manuali»).
Non toccare: il codice di prodotto (se la prova trova un difetto, il coder
lo scrive nel rapporto e il pianificatore apre un task).
Dipende da: T49–T72, T86, T87
Cosa fare:
- Una prova e2e per scenario, coi gesti che il piano dà:
  1. il PDF da scriverci sopra: rilasciato, PgGiù fino alla 7, un tratto,
     la 8 e di nuovo la 7 (il tratto c'è solo lì); «Spargi le pagine» 5–9;
  2. collegare due idee: Alt+trascina dalla scheda intera; «Collega» e un
     clic sull'altra;
  3. l'idea senza posto: doppio clic nel vuoto, si scrive; Ctrl+Invio sotto,
     Ctrl+Maiusc+Invio a destra, collegata;
  4. non so dove sono: Maiusc+1, il navigatore, «Indietro» dopo un salto;
  5. la scheda sbagliata: lazo sul tratto, sull'altra scheda, «Ora fa parte
     di…», «Rendilo libero»;
  6. la scheda tolta con mezz'ora di testo: Canc, poi Ctrl+Z, poi di nuovo
     Canc e «Annulla» nella notifica; la nota tolta non riceve scritture;
  7. il salvataggio dimenticato: dopo ogni gesto il `.canvas` è scritto, e
     la banda lo dice;
  8. le 40 foto: 40 file rilasciati, un gruppo «40 file» scelto, un
     trascinamento le sposta tutte.
- La prova a mano: gli stessi otto, sulla app vera, con i file veri e i
  passi; una riga per scenario con ciò che si vede.
Casi limite: l'host finto che non sa disegnare una pagina PDF (conta la
pagina che la scheda dice, non i pixel); la prova a mano su Windows e
macOS la fa l'utente.
Fatto quando: la prova e2e passa con otto scenari verdi; la pagina c'è,
`check-doc-links` e `check-doc-orphans` passano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/canvas-lazy.e2e.test.ts
Stato: [ ] da fare

## T90 · La CI completa e la revisione prima del merge

Perché: N6 entra in `main` solo dopo N3 e N4 (merge-n3n4 (b), A-15), con la
CI completa verde e una revisione riga per riga. Lo fa l'orchestratore, come
N4 T25.
Tocca: niente nel codice; la PR #302 (base, stato, commenti).
Non toccare: il codice di prodotto (un errore trovato diventa un task
nuovo prima del merge); la CI.
Dipende da: tutti gli altri task; N3 e N4 in `main`
Cosa fare (l'orchestratore):
- Quando N3 e N4 sono in `main`: riallinea il ramo a `main`, sposta la
  base della PR su `main` (`gh api -X PATCH repos/Fubeo/Fub/pulls/302 -f
  base=main`), la segna pronta.
- Legge ogni job della CI su Linux, Windows e macOS; un job rosso diventa
  un task.
- La revisione: tutto il diff riga per riga (skill `code-review`); ogni riga
  del cancello con la sua prova accanto; gli errori trovati diventano
  task.
- Chiede all'utente il merge, con il rapporto: le righe del cancello, le
  misure, le foto del banco, ciò che resta fuori.
Casi limite: N3 o N4 che cambiano dopo il riallineamento (si rifà); un
job lento o instabile (si rilancia una volta, poi è un difetto da
riportare, mai una soglia da alzare: ci-soglia (a)).
Fatto quando: `gh pr checks 302` è tutto verde; il rapporto della
revisione non ha errori aperti; l'utente ha detto sì al merge.
Prova: gh pr checks 302; scripts/check.sh
Stato: [ ] da fare

## Non verificato stanotte

- Niente è stato compilato né provato: la macchina era carica e il disco
  pieno. Percorsi, firme e numeri di riga sono letti su `main` @ 620f0acd.
- Che `render_embed` sappia rendere un DOCX o un ODT (D-14): se no, T4 dà
  una scheda di file e lo dice.
- Che `existingDocuments` risponda anche per i file che non sono note (T10
  ha l'alternativa).
- Che `createImageBitmap` con `resizeWidth` funzioni in WebKitGTK e
  WKWebView (T5 ha il ripiego col `<canvas>`), e che HEIC e AVIF si
  decodifichino.
- Quanta memoria prendono 20 sessioni di foglio aperte nell'host, e quanti
  worker apre pdf.js con molti PDF vivi: lo dice T20, e se serve un tetto
  per specie si aggiunge a `liveCardIds`.
- Che WebKitWebDriver sappia portare la vista sul blocco dei fogli con i
  gesti della tela (T20 sceglie i gesti).
- Che `dataTransfer.items.length` sia leggibile in `dragover` in tutte e
  tre le WebView (il fantasma ripiega su 1).
- I nomi di `engine.ts` dopo N3 T16 e N4 T12–T16, che non sono ancora
  fatti.
- Che la riga di `docs/README.md` dopo «Il server MCP» si fonda senza
  conflitti con quelle di N3 e N4.
- Le estensioni Craft e i nomi di N7 (`previewOf`, `panels/open-with.ts`):
  letti nel piano di N7, non nel codice.
- I task T24–T90 sono scritti il 2026-11-03 leggendo `main` @ 620f0acd e
  `piano/n4-inchiostro` @ 44647c9c; niente è stato compilato. I nomi di N4
  e N3 (`anchor.ts`, `ink-record.ts`, `pen-menu.ts`, `ops.rs`,
  `operation.ts`, `lavagna.rs`) si ricontrollano dopo il riallineamento
  sulla base di N4 (A-15).
- Che «Impostazioni › Tasti» sappia cambiare i tasti dei comandi di una
  superficie (il catalogo di T48), non solo quelli della shell e del
  kernel: se no, T48 lo scrive nel rapporto e i tasti restano fissi.
- Che la richiesta `outline` dia il livello e il testo di ogni titolo come
  li scrive Obsidian dopo il `#` (T74, T75); se no, `parts-picker.ts` li
  ricava dal testo della nota.
- Che l'editor delle note sappia scrivere un testo che non è un file (la
  scheda di testo in Live, T43).
- Che l'editor del foglio accetti `#Foglio1!B3` per aprirsi su una cella
  («Apri a lato per questo», T45).
- Nessun piano di PdfCraft esiste: T79–T85 aspettano P1, P2 e P4, e i nomi
  (`pdfcraft-engine.ts`, i tasselli, `editors/pdf/`) vengono da
  `riferimenti/pdfcraft.md`.
- Che gli «otto scenari principali» siano i primi otto del «pigro alla
  prova» (A-29): `lavagna.md` non lo dice.
- Che la shell porti gli stati di vista con il nome quando una lavagna si
  rinomina (A-18, T36).
- Che `inspectorChrome()` del disegno si possa usare per la lavagna così
  com'è (T58).
- Che Obsidian, modificando un nodo, tenga i campi che non conosce
  (`fub:parts`, T73): se li toglie, resta il `subpath`, che vince comunque.
- Che Ctrl+Alt+L sia libero nei due registri dei tasti (T84).
- Che importare `recognize.ts` e `ruler.ts` (T87) non porti il motore del
  disegno nel pezzo della lavagna che si carica per primo (N3 T16, il
  montaggio pigro): se lo porta, T87 li carica quando serve.
