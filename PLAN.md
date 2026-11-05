# Piano: Fub pre-alpha

Branch: piano/fub-pre-alpha
Obiettivo: la prima versione che una persona scarica, installa sul suo
computer e usa per una settimana di studio e di lavoro. Ci sono un vault di
Markdown con note, documenti Word, fogli Excel, disegni SVG, PDF e lavagne,
tutti nella stessa cornice (Scrittoio 2). Ci sono la penna sopra, i
componenti che si accendono e si spengono, un'AI che fa le stesse cose via
MCP, e nessun dato perso. Esce come pre-release pubblica
`v0.2.0-prealpha.1`, con installer per Windows, macOS e Linux e con un APK
Android di prova segnato «sperimentale».
Perché: dieci piani aperti portano pezzi della stessa versione (circa 276
task; circa 69 sono fatti sui rami, nessuno in `main`). Questo piano li
mette in fila e chiude ciò che resta fra uno e l'altro: dati, contratti,
rilascio, prova con le persone. A chi implementa dà un simulatore uguale
al pixel, da copiare.
Fuori scope: K6 (disegno completo); K4, K7, K8, K9, K10; PdfCraft P1–P5,
e con loro N6 T79–T85; N6 T88 (CSV, D-20); N5, N9, N10; l'app del
telefono e del tablet (l'APK resta di prova); la lavagna v2 e v3; A1
F2–F6; #9; gli installer firmati; i layout alternativi della shell e
`backdrop-filter` nei temi. Ognuno ha il suo posto in «Dentro e fuori».
Assunzioni: 
- Questo è un piano ombrello. I task degli altri piani restano nei loro
  `PLAN.md` e sui loro rami. Qui stanno l'ordine, i cancelli e 42 task
  nuovi («PA T1»–«PA T42»), che tengono tutto insieme. PA T34–T42 sono la
  skin facile, chiesta dal manutentore il 2026-11-05.
- Lavora un coder alla volta, più al massimo un pianificatore: è la regola
  dell'utente dal 2026-11-04, e cambia solo se la cambia l'utente. Le «ondate»
  qui sotto sono quindi file, una dopo l'altra.
- La strada degli altri piani non cambia. Fanno eccezione le decisioni
  della parte «Domande aperte», quando l'utente risponde.
- Gli stati detti «fatti» sono verificati su `origin` il 2026-11-05 (vedi
  «Differenze fra piani e codice»).
Ondate: Fase A: K3 T17 (il sì dell'utente) e #295 | K2 (#290, come dice
D13) | PA T3 T13 | T4 T5 | T6 T7 | T1 T8 T19 T25 T32 T33 | T34 T35 |
T39 T40 · Fase B: Scrittoio 2 T3–T27 (le sue ondate), con PA T2, T20 e
T21, e PA T36 T37 T38 dopo S2 T10 · Fase C: griglia, K5, N4, N6, lavagna
in codice e A1 (le loro ondate, nell'ordine di «L'ordine»), con PA T12 ·
Fase D: PA T41 | T42 | T14 T18 | T26 T27 T28 T29 T30 | T15 T17 T22 T31 |
T16 T23 | T24. PA T9, T10 e T11 partono solo con la risposta alla loro
domanda; PA T34 con D15, PA T40 con D16, PA T42 con D17.
Prototipo: `PLAN-ui/fub-pre-alpha/simulatore.html`, il simulatore di tutta
la pre-alpha (artifact «Fub pre-alpha»,
https://claude.ai/artifact/RCUxmuv2dCqbwDRagbKHcK, parte 1). È costruito dai
prototipi approvati: Scrittoio 2 (2026-11-04), K2, K3 T12 (2026-11-03),
K5 T25 (2026-11-05), N4 T20 (2026-11-02), N6 T25 (2026-11-04) e A1
(2026-11-03). Per la griglia l'approvazione non è scritta (domanda D2).
Approvato: in attesa.
Stato: secondo giro in corso, chiesto dall'utente il 2026-11-05: il
simulatore si rifà più completo (ogni scenario della pre-alpha, raggiungibile
come nel prodotto) e si correggono gli errori e le lacune dei task. Finché
questa riga c'è, il piano non va implementato.

## Modifiche

nessuna.

## La definizione

Confermata dall'utente il 2026-11-05.

### Fatto quando

1. Il tag `v0.2.0-prealpha.1` ha gli installer per Windows, macOS e Linux, e
   la CI di rilascio è verde (PA T22, T24).
2. I piani dentro sono in `main`, ognuno col suo cancello e con la CI
   completa verde (Fasi A–C).
3. Il giro della pre-alpha, circa 30 compiti, passa e2e nel banco (PA T14,
   T26–T30) e a mano sugli installer (PA T23).
4. Un corpus per formato (md, docx, xlsx, svg, canvas con l'inchiostro,
   pdf) torna byte per byte: aprire e chiudere non cambia niente, e una
   modifica non tocca il resto. Il conflitto e la sola lettura sono
   provati (PA T13).
5. Il simulatore e l'app coincidono: le foto del banco, nelle due luci, a
   tutta larghezza, a 700 e al telefono (390), stanno accanto al
   simulatore, e ogni differenza è spiegata (PA T15). L'APK di prova si
   installa e parte nell'emulatore Android della CI (PA T31) e sul telefono
   Android dell'utente, dove si apre un vault, si scrive una nota, si usa la
   lavagna con le dita e con la penna e si apre un foglio col telefono di
   lato (PA T23).
6. Le misure della WebView stanno nei budget sul runner Linux, e c'è una
   misura a mano su Windows (PA T16).
7. C'è una prova con cinque persone su N12, N13 e la lavagna (PA T17). La
   prova di K2 con una persona si fa dove dice D13.
8. `docs/project/status.md` è aggiornato, c'è la pagina «Prova la
   pre-alpha», e `fub:abi@0.2.0` è congelata (#289; PA T6, T7, T18).
9. Una skin vera si fa facile. Un tema dichiara `extends: "fub.serie"` e
   porta solo ciò che cambia; si installa da una cartella e si ricarica al
   salvataggio, con la diagnosi leggibile; porta i suoi caratteri (e le sue
   icone, se D16 è A). Due temi d'esempio passano i cancelli e sono
   guardati nelle due luci, in contrasto alto, stretti e al telefono. Gli
   hook sono congelati e un test lo tiene (PA T34–T42).

### Fuori scope, e dove va

| Che cosa | Perché fuori | Dove va |
|---|---|---|
| K6 · il disegno completo | XL, 30 task, nessuno fatto. La pre-alpha usa il disegno semplice di K5 | `piano/k6-disegno-completo`, PR #313 |
| K4 · la consegna (edizioni, dati scaricabili) | La pre-alpha esce con un installer solo e tutto dentro | «Piani di Fub», passo K4 |
| K7, K8 · foto e libreria foto | Aspettano la decisione di N9 | «Piani di Fub» |
| K9 · documenti e fogli completi | Dopo K3: la pre-alpha usa le modalità di K3 | «Piani di Fub» |
| K10 · seguire i motori | È lavoro continuo, non una tappa. Il controllo settimanale c'è già: `aggiorna.sh` gira ogni lunedì alle 4:17 sul server (cron), da `~/Progetti/fub-archivio/motori-upstream`, fuori dal repository | «Piani di Fub», K10 |
| PdfCraft P1–P5 | Non hanno un piano. Il PDF della pre-alpha è il visore pdf.js di `main` | «Piani di Fub», `riferimenti/pdfcraft.md` |
| N6 T79–T85 (PDF sui tasselli, estratti di PDF) | Dipendono da PdfCraft P1, P2 e P4 | `piano/n6-lavagna`, dopo PdfCraft |
| N6 T88 (la scheda CSV) | Dipende da D-20: un piano «I CSV nel motore dei fogli», che non c'è | N6 D-20, piano futuro |
| N5 · strati nativi | Senza un piano; aspettano le misure di N0 sui dispositivi | «Prossime fasi», N5 |
| N9 · egui o Tauri | Si decide coi numeri di N5 | «Prossime fasi», N9, decisione 7 |
| N10 · Linux (Flatpak, Wayland) | La pre-alpha esce in deb, rpm e AppImage (domanda D8) | «Prossime fasi», N10, decisione 5 |
| App del telefono e del tablet | La pre-alpha è per il computer; l'APK è solo di prova (domanda D1) | piano futuro del telefono, #90 |
| Lavagna v2 e v3 | Fuori dalla v1 di N6 (D-1 b) | `lavagna.md`, «Le tappe» |
| A1 F2–F6 | A1 consegna F1, la base | artifact «Ricette di Fub» |
| #9 · sincronizzazione | Grande e senza piano | #9 |
| Installer firmati | Una prerelease può uscire senza firma (`release.yml`); la firma arriva con la beta | `docs/development/versioning-and-releases.md` |
| #242 · il tema di CodeMirror in linea | Debito della pelle, non cambia ciò che si vede | #242 |
| #237 R05–R08 e A03 | Sono UX, non perdono dati | #237 |
| #253, #254 · upstream dei motori | Le proposte le fa l'utente (decisione 9) | #253, #254 |
| #282 · archiviare FubDraw | È un gesto dell'utente su GitHub | #282 |
| Layout alternativi (le regioni della finestra spostate) | Sono una variante della shell, non una pelle | piano futuro delle varianti della shell |
| `backdrop-filter` nei temi | Blocca WebKitGTK senza composizione | resta vietato (`NEVER_PROPERTIES` del sanificatore) |

## Dentro e fuori

Ogni fase di «Le prossime fasi di Fub» (N0–N13), ogni passo di «Piani di
Fub» (K0–K10), ogni piano aperto e ogni punto sciolto, verificato nel
codice, nei rami e nelle issue il 2026-11-05.

| Voce | Stato verificato | Pre-alpha | Ragione | Dove |
|---|---|---|---|---|
| N0 · misurare | Banco WebView in `main` (`bench/webview`, `docs/development/webview-measurements.md`); #283 aperta. Le scene S4–S6 e le tre piattaforme sono nel cancello di N0 | dentro: misure sulle tre piattaforme, S4–S6 comprese, dove si può | Fatto quando 6 | PA T16 |
| N1 · FubDraw | In `main` (ADR 0231, tag `fubdraw-completo`). I 42 file `.rs` che nominano FubDraw sono codice vivo: FubDraw è il nome del formato (ADR 0203). La prova byte per byte c'è già: `editors/spatial/corpus-open.test.ts`, `crates/fub-scene/tests/corpus.rs` e i test del provider svg (ADR 0231, «Verifica») | fatto; dentro: il nome dove le persone lo vedono, se D14 è A o C | Cancello passato; resta l'archivio | PA T33 (D14); #282, fuori |
| N2 · MCP | In `main` (`crates/fub-cli/src/mcp.rs`, ADR 0232): 17 strumenti, vedi «Contratti» qui sotto | fatto; dentro: due flussi veri nel giro a mano | L'AI della definizione passa di qui | PA T23 |
| N3 · la lavagna in Rust | In `main` (#297, #306, #307) | fatto | Base di N4, N6 e della lavagna in codice | — |
| N4 · l'inchiostro | Ramo: 14 di 25 | dentro | La penna della definizione | `piano/n4-inchiostro`, #298 |
| N5 · strati nativi | Senza piano | fuori | Vedi la tabella sopra | «Prossime fasi» |
| N6 · la lavagna v1 | Ramo: 11 di 90 | dentro, senza T79–T85 e T88 | Le lavagne della definizione | `piano/n6-lavagna`, #302 |
| N7 · file Craft | In `main` (#299) | fatto | Le anteprime ci sono | — |
| N8 · DOCX e XLSX | Sostituita da K6–K9 | — | Vedi K3 e K9 | — |
| N9 · egui o Tauri | Senza piano | fuori | Vedi sopra | «Prossime fasi» |
| N10 · Linux | Senza piano | fuori | Vedi sopra, domanda D8 | «Prossime fasi» |
| N11 · budget, documenti, upstream | Continuo | dentro: budget e documenti; fuori: upstream (le voci precise sono in «Le voci sciolte», più sotto) | Fatto quando 6 e 8 | PA T16, T18; #253, #254 |
| N12 · il menu «/» | In `main` | fatto; dentro: la prova con persone, i 16 ms nella WebView, il «/» nelle schede della lavagna; fuori: il «/» nelle celle | Fatto quando 6 e 7 | PA T16, T17; N6 T43; celle con K9 |
| N13 · i Blocchi | In `main`, coreografie comprese (`motion-rules.mjs`, regole `blocchi-*`); #281 aperta | fatto; dentro: la prova con persone, i 33 ms su 2.000 righe, la pagina del PDF nella nota | Fatto quando 6 e 7 | PA T16, T17 (chiude #281), T32 |
| K0 · misure dei motori | In `main` (`docs/misure/*-k0.md`) | fatto | — | — |
| K1 · i componenti | In `main` (#285, `crates/fub-componenti`) | fatto | — | — |
| K2 · la pagina «Componenti» | Ramo: 7 di 7; la prova con una persona di K2 D-2 non è fatta | dentro | I componenti accesi e spenti | `piano/k2-pagina-componenti`, #290; l'ordine lo dice D13 |
| K3 · lo strato dei motori | Ramo: 18 di 19 (T18 fatto); T17 aspetta solo il sì dell'utente per unire #295 (CI completa verde, run 42049126094) | dentro | Word ed Excel | `piano/k3-motori`, #295 |
| K4, K7–K10 | Senza piano | fuori | Vedi sopra | «Piani di Fub» |
| K5 · il disegno | Ramo: 10 di 30 | dentro | Il disegno SVG | `piano/k5-disegno`, #300 |
| K6 · il disegno completo | Ramo: 0 di 30 | fuori | Scelta dell'utente | #313 |
| Griglia · le celle | Ramo: 0 di 9 | dentro | Il foglio che risponde subito | `piano/griglia-celle`, senza PR |
| Scrittoio 2 | Ramo: 3 di 27 (T1, T2, T16) | dentro | La cornice | `piano/scrittoio-2`, #309 |
| La lavagna in codice | Ramo: 0 di 26 | dentro | L'AI che disegna e dispone | `piano/lavagna-in-codice`, #311 |
| A1 · la base per l'AI | Ramo: 5 di 13 | dentro (F1) | Le ricette | `piano/a1-base-per-ai`, #305 |
| #304 · `/orchestra-auto` | PR pronta | fuori dal prodotto | È un attrezzo di lavoro | #304, la decide l'utente |
| Punto sciolto: il blocco di scrittura in sola lettura | Trovato: `FubSession::invoke_command` prende `write_turn()` anche per i comandi in sola lettura (`crates/fub-host/src/session.rs`); è scritto in DECISIONS (N7, 2026-11-04) ma l'issue non è mai stata aperta | dentro | L'AI legge (MCP, `canvas.read`) mentre la persona scrive | PA T3 |
| Punto sciolto: `windows-sys` | Già in `Cargo.lock` come dipendenza indiretta (cinque versioni, 0.45–0.61); serve diretta per il job object | domanda | È una dipendenza nuova | D7, PA T9 |
| Punto sciolto: sei errori di tipo nei test dell'anteprima | Riprodotti con `tsc --noEmit` su `anteprima/tutto` (5006937c): tre in N4 e tre in K5 | dentro | Vengono dai rami indietro rispetto a `main` | PA T2 |
| Punto sciolto: una stringa inglese nel fake host | Non trovata: `bench/fake-english.test.ts` passa su `anteprima/tutto` | domanda | Da dove viene? | D10, PA T10 |
| Punto sciolto: il conto dei diagrammi Mermaid | Non trovato: `check-mermaid.mjs` dà 40 blocchi validi su `main` e 45 sull'anteprima | domanda | Da dove viene? | D10, PA T10 |
| Punto sciolto: la pagina della cornice del telefono | Manca davvero: nessuna pagina in `docs/architecture/` | dentro | Docs che descrivono il presente | PA T8 |
| Punto sciolto: il vassoio più chiaro della fila e della colonna | Sul ramo di S2, T16 lo ha già messo (`--bar-tray`) | domanda | L'utente decide qui | D6, PA T11 |
| #97 · CRLF e BOM nella lavagna | Corretto in `main` (0f39a80a, `editors/canvas/line-endings.test.ts`) | fatto | L'issue è ancora aperta | da chiudere (l'utente) |
| #216 · il vault lasciato aperto | Corretto in `main` (1d20ce96, `closeLeftVault` in `state/vault-session.ts`) | fatto | L'issue è ancora aperta | da chiudere (l'utente) |
| #237 R01–R04 | Aperti | dentro | Perdono dati | PA T4, T5, T12 |
| #289 · congelare `fub:abi@0.2.0` | Aperta | dentro | Fatto quando 8 | PA T6, T7 |
| Test instabili (#70, #98, #270–#273, #279, #280, #284, #286, #287, #292, #293, #301, #310, #312) | Aperti | dentro | Bloccano la CI di rilascio | PA T19, T20, T21 |
| #283 · S7 su una GPU | Aperta | dentro | Il portatile Windows dell'utente ha una GPU | PA T16 |
| #281 · i Blocchi con cinque persone | Aperta | dentro | Fatto quando 7 | PA T17 |
| P00–P18 (#76–#93) | Vecchia mappa | fuori | Superata da N e K | le loro issue |
| Richiesta del manutentore: la skin facile (2026-11-05) | Verificato in `main` (638358da): la pelle di un tema è tutto o niente; `install_theme` c'è ma senza IPC; la fiducia `development` («In sviluppo») c'è già; nessuna modalità sviluppatore; il contratto `theme-2` non è congelato (12 commit dal 29 ottobre al 4 novembre); le icone passano da un registro solo | dentro: sei passi | Fatto quando 9 | PA T34–T42, D15–D17 |

### Le nove decisioni di «Prossime fasi»

| Decisione | Stato | Per la pre-alpha |
|---|---|---|
| 1 · l'inchiostro in `fub:ink`, dentro `.canvas` | Presa: ADR 0238 su `piano/n4-inchiostro` | dentro, con N4 |
| 2 · il riconoscimento delle forme e della scrittura resta | Presa: N6 T87 «Forme dal tratto» (D-22 a) | dentro, con N6 |
| 3 · niente export verso Excalidraw e draw.io | Presa con la chiusura di FubDraw (ADR 0231) | fatto |
| 4 · `.fubann` letto e convertito | In `main` (`crates/fub-host/tests/fubann_vault.rs`) | fatto |
| 5 · Linux via Flatpak | Aperta | domanda D8 |
| 6 · iPad e Android: prima un'app compagna | L'utente ha scelto l'APK di prova | domanda D1 |
| 7 · le soglie di N9 | Aperta, con N9 | fuori |
| 8 · che cosa congelare in DOCX e XLSX | Il corpus di PA T13 dice ciò che non si perde; il resto va con K9 | dentro: il corpus |
| 9 · i post upstream, fatti dall'utente | Dell'utente | fuori (#253, #254) |

### Le voci sciolte

Le voci che il primo giro non metteva da nessuna parte, verificate nel
codice il 2026-11-05.

| Voce | Che cosa c'è | Pre-alpha | Dove |
|---|---|---|---|
| Blocchi · `tabIndex` sulle maniglie | Fatto: il «+» e la maniglia sono `<button>` veri, si raggiungono con Tab e si premono con Invio e Spazio (`editors/text/profiles/markdown/blocks/handles.ts`, `docs/product/editor-blocks.md`) | fatto | — |
| Blocchi · il tasto destro sulla maniglia | Fatto: il tasto destro sulla maniglia apre il menu del blocco, non quello del testo (`handles.ts`, l'ascoltatore `contextmenu`) | fatto | — |
| Blocchi · `![[x.pdf#page=3]]` | Il PDF nella nota diventa un collegamento senza la pagina (`editors/text/profiles/markdown/media.ts`); il visore la sa aprire (`editors/media/pdf-view.ts`, `initialPage`, `goToPage`) | dentro | PA T32 |
| Blocchi · trascinare un blocco fuori dall'app (DataTransfer) | Non c'è; la lavagna lo mette nella v2 (`lavagna.md` S12; N6 T84 «Non toccare») | fuori | lavagna v2, `lavagna.md` |
| Blocchi · una tavolozza unica | I nove colori dei Blocchi e quelli della lavagna sono due liste | dentro | N6 T47 (D-13 c di N6) |
| Rischio · il controllo settimanale dei motori Craft | Gira già: `aggiorna.sh` ogni lunedì (cron del server), fuori dal repository | fuori | K10 |
| Rischio · il marchio ArtCraft | Nel codice di `main` compare solo dove deve: `THIRD_PARTY_NOTICES`, l'intestazione dello stabilizzatore, i percorsi d'installazione dei Craft | dentro: un controllo | PA T18 |
| Rischio · i token del canale di controllo dei Craft | Lato motori, non lato Fub | fuori | #253, #254 (decisione 9) |
| Rischio · l'app compagna per iPad | Decisione 6 di «Prossime fasi» | fuori | D1, #90 |
| N12 · i 16 ms del «/» nella WebView | Misurati solo in Chromium | dentro | PA T16 |
| N12 · il «/» nelle schede della lavagna | N6 T43 scrive le schede in Live, con «/» se l'editor delle note lo ha | dentro | N6 T43 |
| N12 · il «/» nelle celle del foglio | Le celle non sono testo Markdown | fuori | K9 |
| N13 · le coreografie | In `main`: `motion-rules.mjs`, regole `blocchi-*` e `slash-*` | fatto | — |
| N13 · i 33 ms su 2.000 righe | Misurati solo in Chromium | dentro | PA T16 |
| N1 · i 42 file `.rs` | Codice vivo, non resti: FubDraw è il nome del formato (ADR 0203). Restano per compatibilità il namespace `fub:`, `Status::Fubdraw` e l'abbinamento `fubdraw://live`. Le persone vedono il nome in tre stringhe del Rust e in una quarantina del client | dentro, come dice D14 | PA T33 |
| N1 · la prova byte per byte | C'è: `corpus-open.test.ts`, `crates/fub-scene/tests/corpus.rs`, i test del provider svg | fatto; il corpus della pre-alpha la allarga | PA T13 |
| N0 · le tre piattaforme e S4–S6 | Il banco WebView gira su Linux; S4 c'è in Chromium | dentro, dove si può; ciò che non si può misurare si scrive | PA T16 |
| N11 · le voci da portare a monte | Un'anteprima PNG in ogni formato nativo; `info --json` stabile; istanza unica per VectorCraft, FigCraft, LightCraft, GridCraft e WordCraft; un token del canale di controllo per VectorCraft, FigCraft e LightCraft; un commento su storytold/vectorcraft#647 | fuori | #253, #254 (decisione 9: le scrive l'utente) |
| K7–K9 · le issue | Non ci sono; il testo proposto è qui sotto | fuori | issue da aprire (l'utente) |

**Le issue proposte per K7–K9.** Titolo e testo, pronti da incollare.

- **«K7 · Le foto nella modalità completa, sopra il motore di PhotoCraft»**.
  «Dopo la decisione di N9. Prima a monte: la proposta e le PR per separare
  `tools` e `viewport` dall'interfaccia di PhotoCraft (senza, la modalità
  completa vorrebbe dire riscrivere i loro strumenti). Poi il componente, la
  tela con la strada scelta in N9, le cinque finestre che PhotoCraft disegna
  a mano (Curve, Livelli, Camera Raw, Fluidifica, Stile livello) e il resto
  dagli schemi. Cancello: il tratto del pennello appare entro il fotogramma
  successivo, misurato; copertura dei comandi al 100%. Fonte: «Fub a
  componenti», K7; «Piani di Fub», passo 21.»
- **«K8 · La libreria foto, sopra il motore di LightCraft»**. «Dopo la
  decisione di N9. Il catalogo sulle cartelle del vault, senza copiare le
  foto (`mode: "add"`); il pannello di sviluppo dai 122 controlli, con la
  scheda grafica e il ripiego sul processore; l'IA come dati scaricabili, i
  volti dietro una feature; voti ed etichette come proprietà del vault (come
  in N7). Cancello: un cursore entro 16 ms sulla scheda grafica, dentro Fub;
  10.000 foto si sfogliano senza scatti, misurato; copertura dei comandi al
  100%. Fonte: «Fub a componenti», K8; «Piani di Fub», passo 21; D13 di
  «Prossime fasi».»
- **«K9 · Documenti e fogli completi»**. «Dopo K3. La facciata `engine` di
  WordCraft in `vendor/`; le modalità complete dai cataloghi, con i percorsi
  della barra multifunzione che diventano i menu di Fub; il «/» nelle celle
  (dalla pre-alpha, N12). Cancello: copertura dei comandi al 100%; i banchi
  dei fogli e dei documenti invariati. Fonte: «Fub a componenti», K9;
  «Piani di Fub», passo 22; decisione 8 di «Prossime fasi».»

## L'ordine

Quattro fasi. Una fase finisce quando tutti i suoi passi sono chiusi; la
dopo può cominciare prima solo dove la colonna «Dipende da» lo permette.
Lavora un coder alla volta, più al massimo un pianificatore (regola
dell'utente dal 2026-11-04; cambia solo se la cambia l'utente, `DECISIONS.md`).
«Taglia» è a occhio, in tempo di un coder con revisione e CI: S un'ora o
due, M mezza giornata, L due o tre giorni, XL di più.

**Quanto ci vuole, a occhio.** Restano circa 207 task negli altri piani
(circa 79 solo in N6) e circa 39 task di questo piano (PA T9, T10, T11 e
T40 dipendono da una risposta): circa 246 in tutto. Con un coder alla
volta e circa 2 ore per task, revisione e CI comprese, fanno circa 490 ore
di lavoro; i nove task della skin facile sono quasi tutti M e ne
aggiungono una ventina, quindi circa 510 ore. A circa 14 ore al giorno
(l'orchestratore lavora anche di notte con `/orchestra-auto`) sono circa
37 giorni, poco più di 5 settimane piene. Con le attese dell'utente (i
prototipi da approvare, i sì
ai merge, le risposte alle domande, la misura su Windows, la prova con le
persone, gli installer) diventano **7–9 settimane**. N6 da sola sono circa
160 ore, cioè 2–3 settimane con l'approvazione dei suoi prototipi.

Le assunzioni della stima: le 2 ore vengono dai piani recenti (il piano del
caricamento ha chiuso 4 task in circa 3 ore il 2026-11-04; i task M e L di
K3 sono durati di più); i task L e XL non rifanno pezzi grandi; le baseline
arrivano dal runner senza giri in più; l'utente risponde entro un giorno.
Se una di queste cade, la stima si allunga.

### Fase A · unire ciò che è finito e chiudere i buchi fra i piani

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| K3 T17 · il sì dell'utente | K3 | aspetta solo il sì (T1–T16, T18 e T19 fatti; CI completa verde, run 42049126094) | nessuno | medio: un crate nuovo (`fub-motori`), patch nel `vendor/`, tre sistemi | — | il sì dell'utente |
| Unire #295 (K3, con K3-IPC T8) | K3 | PR pronta, testa 165b8fa8 | il sì dell'utente | medio | S | `main` ha `crates/fub-motori` e i comandi `open_key`, `warm_engine` e `document_closed` |
| Riallineare #290 a `main` e unirla | K2 | 7 di 7; la prova con una persona non è fatta | la risposta a D13 | basso | S | CI completa verde, OK dell'utente |
| PA T1 · il finto del banco con le impostazioni dell'host | PA | da fare | #295 in `main` (d90a09d0 di K3 cambia `bench/fake-ipc.ts`) | basso | S | `bench/fake-ipc.test.ts` |
| PA T3 · i comandi in sola lettura non tengono il turno | PA | da fare | nessuno | medio: tocca il custode | M | test d'integrazione di `fub-host` |
| PA T4, T5 · #237 R01–R03 | PA | da fare | nessuno | medio: sessioni e conflitto | M + M | test di Vitest sulla sessione; R01 si chiude col test se non si riproduce |
| PA T6, T7 · #289 | PA | da fare | T7 dopo T6 | medio: confine WASM | S + M | `wit_additivity`, componente vero |
| PA T8 · la pagina della cornice del telefono | PA | da fare | nessuno | basso | S | guardie dei documenti |
| PA T13 · il corpus senza perdite | PA | da fare | nessuno; si allarga quando K5 e N4 entrano | medio | M | test d'integrazione di `fub-host` |
| PA T19 · i test instabili del Rust | PA | da fare | nessuno | medio | M | 200 giri verdi o causa trovata |
| PA T25 · il controllo degli aggiornamenti vede le pre-release | PA | da fare | nessuno | basso | S | test di `fub-host` (`updates.rs`) |
| PA T32 · `![[x.pdf#page=3]]` apre il PDF a quella pagina | PA | da fare | nessuno | basso | S | Vitest di `media.ts` e dell'apertura |
| PA T33 · il nome FubDraw dove le persone lo vedono | PA | da fare | la risposta a D14 | basso | M | test dei descrittori, di `fub-scene` e del catalogo |
| PA T34 · il manifest dice da quale tema parte | PA | da fare | la risposta a D15 | medio: la forma del manifest sul filo | M | `crates/fub-host/tests/themes.rs`, mirror |
| PA T35 · la pelle del tema sopra quella di serie | PA | da fare | T34 | medio: tocca il montaggio di ogni tema | M | `theme/inherit.test.ts`, `gate.test.ts` |
| PA T39 · i caratteri del tema | PA | da fare | T34, T35 | basso | M | test dell'host e del loader |
| PA T40 · le icone del tema | PA | solo se D16 è A o C | T34, T35, D16; mai nella stessa ondata di S2 T14 | basso | M | Vitest di `ui/icons` e di `theme/` |

### Fase B · la cornice

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Scrittoio 2 T3–T27 | S2 | 3 di 27 (T1, T2, T16) | K3 in `main` per T20 e T21, che rifanno la barra a schede dalle regole di K3 T18; T22 dopo la risposta a D5; T23 aggiunge solo l'icona (N6 vince sulla lavagna) | medio: tocca quasi ogni pelle; le baseline vengono dal runner (T25) | L | S2 T26 e la CI completa |
| PA T2 · N4 e K5 allineati a `main` | PA | da fare | #295 in `main` | basso | S | `tsc --noEmit` pulito sui due rami |
| PA T11 · il vassoio delle barre | PA | solo se D6 non è A | S2 T20 | basso | S | foto del banco |
| PA T20, T21 · i test instabili del client e del banco | PA | da fare | nessuno | medio | M + M | 50 giri verdi o causa trovata |
| PA T36 · installare da cartella, e la diagnosi | PA | da fare | T34; S2 T10 | medio: un'IPC nuova che scrive nella configurazione | M | test di `fub-host`, Vitest delle Impostazioni |
| PA T37 · collegare una cartella, il tema cambia al salvataggio | PA | da fare | T36 | medio: un osservatore nuovo | M | test di `fub-host` con l'evento, Vitest |
| PA T38 · la pagina «Tutti i componenti» | PA | da fare | T35, T36; S2 T10 | basso | M | foto del banco uguali, bundle iniziale uguale |

### Fase C · gli editor

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Griglia T1–T9 | griglia | 0 di 9 | #295 in `main` (il ramo nasce da K3); T2 e T3 mai insieme a S2 T20 (tutti e tre toccano `skin/editors.css`) | medio: il motore della griglia | L | griglia T8 (foto contro `celle-griglia`) |
| PA T12 · #237 R04 | PA | da fare | griglia T4 | medio | M | test di Vitest sulla griglia |
| N4 T12–T17, T21–T25 | N4 | 14 di 25 | PA T2; T24 aspetta l'esito della prova con Obsidian, che incolla l'utente | medio: penna e latenza | L | N4 T25 |
| N6 v1, senza T79–T85 e T88 | N6 | 11 di 90 | N4 in `main` (il ramo nasce da N4, e T90 lo chiede); i task grafici dopo l'approvazione dei prototipi T26–T28 (D3) | alto: 79 task | XL | N6 T90 |
| K5 T6, T7, T9, T11, T13–T24, T27–T30 | K5 | 10 di 30 | PA T2; T6 copia `Fubeo/vectorcraft` (c'è, pubblico, 2026-11-02); T22 dopo D5; T24 dopo K2 in `main` | alto: motore vettoriale nuovo | XL | K5 T30 |
| La lavagna in codice T1–T26 | lavagna in codice | 0 di 26 | T15–T18 dopo N4 in `main`; T14, T19, T23 e T24 dopo N6 in `main` (T72, T73, T19, T37, T48) | medio | L | lavagna in codice T26 |
| A1 T4, T5, T7, T9–T13 | A1 | 5 di 13 | T12 dopo S2 T10 (le impostazioni) | basso | M | A1 T13 |

### Fase D · la prova e la pre-release

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| PA T41 · gli hook congelati | PA | da fare | Fase C in `main`; T34–T40 | basso per il codice, alto se si sbaglia il momento | S | `contract-frozen.test.ts` |
| PA T42 · due temi d'esempio | PA | da fare | T41; la risposta a D17 | basso | M | `examples.test.ts`, scene del banco |
| PA T14 · il giro nel banco: lo scheletro e il primo avvio | PA | da fare | Fase B in `main` | medio | M | `npm run bench:giro` verde sui compiti 1–5 |
| PA T26 · il giro: le note | PA | da fare | T14 | basso | M | compiti 6–11 verdi |
| PA T27 · il giro: Word, Excel, SVG e PDF | PA | da fare | T14; griglia e K5 in `main` | medio | M | compiti 12–15 verdi |
| PA T28 · il giro: la lavagna e la penna | PA | da fare | T14; N4 e N6 in `main` | medio | M | compiti 16–17 verdi |
| PA T29 · il giro: ricette, componenti e aspetto | PA | da fare | T14; A1 e K2 in `main`; PA T36 e T42 in `main` | basso | M | compiti 18–20 verdi |
| PA T30 · il giro: conflitto, sola lettura, cestino, tastiera e guasti | PA | da fare | T14; PA T4 e T5 | medio | M | compiti 21–27 verdi |
| PA T15 · il simulatore accanto all'app | PA | da fare | Fase C; T14 e T26–T30 (le loro scene danno le foto) | basso | S | il foglio di contatto rivisto dall'utente |
| PA T16 · le misure della WebView | PA | da fare | Fase C; la misura di Windows usa l'MSI della prova di T22 | medio: Windows lo misura l'utente | M | la pagina delle misure |
| PA T17 · la prova con cinque persone | PA | da fare | PA T14 per il protocollo; la prova usa gli installer di T22 | basso per il codice; serve l'utente | S + la prova | il resoconto della prova |
| PA T18 · i documenti della pre-alpha | PA | da fare | Fase C | basso | S | guardie dei documenti |
| PA T22 · la versione e la prova del rilascio | PA | da fare | T14, T18, T25; T19–T21 | alto: MSI e versione non numerica | M | `release.yml` verde in prova |
| PA T31 · l'APK nell'emulatore della CI | PA | da fare | T22 (l'APK con la versione nuova) | medio: emulatore su runner Linux | M | il job `mobile.yml` installa, apre e fotografa l'APK |
| PA T23 · il giro a mano sugli installer e sul telefono | PA | da fare | T22, T31 | medio | M | la lista del giro spuntata |
| PA T24 · il tag e la pre-release | PA | da fare | tutti gli altri passi (T16 e T17 compresi), OK dell'utente | basso | S | la release `v0.2.0-prealpha.1` pubblicata |

## Il backend, area per area

Verificato su `origin/main` 638358da e sui rami dei piani, il 2026-11-05.

### Crate e confini

- **Chi è il padrone.** `fub-abi`, verso cui puntano tutte le dipendenze. Lo
  strato lo controllano `cargo test -p fub-abi --test dependency_invariant`
  e le guardie di Node.
- **Che cosa c'è in `main`.** 24 crate: `fub-abi`, `-app`, `-canvas-core`,
  `-canvas-wasm`, `-cli`, `-componenti`, `-features`, `-format-base`,
  `-format-canvas`, `-format-craft`, `-format-markdown`, `-format-rich`,
  `-format-svg`, `-format-xlsx`, `-host`, `-importers`, `-ink`, `-kernel`,
  `-live`, `-scene`, `-sdk`, `-services`, `-testkit` e `-wasm-host`.
- **Che cosa arriva coi piani.**
  - `fub-motori` (K3 T1, fatto; anche sul ramo della griglia, che nasce da
    K3);
  - `fub-ink-codec` (N4 T6, fatto; anche su N6, che nasce da N4);
  - `fub-disegno` (K5 T9, non c'è ancora).

  Ognuno aggiorna `docs/architecture/overview.md` e `dependency_invariant`
  nel suo task.
- **Che cosa manca.** Niente fuori dai piani.

### I motori Craft (K3)

- **Chi è il padrone.**
  - `fub-motori`: il registro pigro e i servizi comuni;
  - `fub-format-xlsx` e `fub-format-rich`: i provider;
  - `fub-host` (`workbook.rs` e i documenti aperti): apre e chiude;
  - `apps/client/src/editors/grid/` e `editors/rich/`: le barre e il menu
    «Comandi».
- **Che cosa c'è.** Sul ramo `piano/k3-motori` (165b8fa8) c'è tutto, T18
  compreso; T17 ha la CI completa verde (run 42049126094) e aspetta solo il
  sì dell'utente:
  - il catalogo dei comandi e il test di copertura;
  - la guardia `check-motori.mjs`;
  - le patch che liberano le cache dei motori;
  - i comandi IPC `open_key`, `warm_engine` e `document_closed`. Vengono da
    K3-IPC T8, #296, unito nel ramo e non in `main`.

  In `main` ci sono N7, i file Craft (`fub-format-craft`, la CLI Craft) e i
  motori già adottati (#227, #234).
- **Che cosa manca.** Il sì dell'utente e il merge di #295.
- **Rischio.** `cargo deny` sulle dipendenze dei motori: K3 T17 lo fa
  girare nella CI completa.

### I componenti (K1, K2)

- **Chi è il padrone.**
  - `fub-componenti` (in `main`, #285): la mappa e le regole;
  - `crates/fub-host/src/componenti.rs` (K2 T1): legge e applica;
  - `fub-app`: i comandi `components_map`, `components_apply`,
    `components_map_for` e `components_apply_for` (K2 T2);
  - `apps/client/src/panels/components-page.ts` (K2 T3).
- **Che cosa c'è.** K2 è finito sul ramo (fcd30123, 7 di 7). Gli strumenti
  MCP `components_*` sono già in `main` con N2.
- **Su disco.** Le chiavi `components.*` nelle impostazioni del vault, e i
  bundle spenti in `plugins.disabled`, la chiave di oggi.
- **Che cosa manca.** La prova con una persona che K2 D-2 chiede prima di
  segnare pronta la PR, e il merge di #290, nell'ordine che dice D13.

### La lavagna in Rust (N3, N6, la lavagna in codice)

- **Chi è il padrone.**
  - `fub-canvas-core`: il modello, le operazioni e la disposizione;
  - `fub-canvas-wasm`: lo stesso nucleo nella WebView (ADR 0237);
  - `fub-format-canvas`: il provider;
  - `apps/client/src/editors/canvas/`: la tela, le schede e gli strumenti.
- **Che cosa c'è.**
  - In `main`, N3: la logica in Rust, e la lavagna che Fub non può
    riscrivere si apre in sola lettura (6d5fb197, #307).
  - Su `piano/n6-lavagna`, T1–T10: il contratto delle schede, la cache
    delle immagini, i doppioni, i sei tipi di scheda, dove nascono, le porte
    per portare dentro.
- **Che cosa manca.**
  - N6: T11–T78 (i prototipi T26–T28 secondo D3), T86, T87, T89, T90.
    Nell'host, T30 e T31: «lo stesso contenuto», un campo facoltativo
    `reuse: "same-content"` di `resource_write`, additivo. Nel formato,
    T73: `fub:parts` dentro `.canvas`.
  - La lavagna in codice:
    - lo schema delle operazioni `OpSpec` nel nucleo (T6);
    - i comandi `canvas.read`, `canvas.check` e `canvas.guide`, con
      `CommandScope::read_only()` (T8);
    - gli strumenti MCP (T22);
    - la GUI che scrive con le operazioni (T23, T24).
- **Attenzione.** I comandi in sola lettura passano da
  `FubSession::invoke_command`, che oggi prende il turno di scrittura (PA
  T3). Un'AI che legge la lavagna fermerebbe i salvataggi.
- **Su disco.** `.canvas` (JSON Canvas) con le estensioni `fub:*`, in
  `docs/reference/canvas-format.md` e `canvas-operations.md`.

### L'inchiostro (N4)

- **Chi è il padrone.**
  - `fub-ink` (in `main`): la penna e il tratto;
  - `fub-ink-codec` (N4 T6): i vettori;
  - lo strato d'inchiostro in `fub-canvas-core` (N4 T8);
  - nel client, `editors/canvas/ink*` e `ink/quiet.ts`.
- **Che cosa c'è.** Sul ramo `piano/n4-inchiostro` (e1949125) ci sono
  T1–T11 e T18–T20, compresi la forma `fub:ink` e l'ADR 0238.
- **Che cosa manca.** T12–T17 e T21–T25. T24 aspetta la prova con Obsidian
  dell'utente.
- **Su disco.** `fub:ink` dentro `.canvas` (decisione 1), in
  `docs/reference/canvas-ink.md` (N4 T5).
- **Da correggere.** Tre errori di tipo nei test, dopo N3 (PA T2).

### Il disegno (K5)

- **Chi è il padrone.**
  - `fub-abi/src/drawing.rs`: il contratto, in Rust e non in WIT (K5 T4,
    fatto);
  - `fub-disegno`: il motore (T9);
  - VectorCraft in `vendor/`, da `Fubeo/vectorcraft` (T6);
  - `crates/fub-host/src/drawing.rs`: l'host e i comandi IPC `drawing_*`
    (T19);
  - nel client, `editors/spatial/motore/`.
- **Che cosa c'è.** Sul ramo `piano/k5-disegno` (07d2f435) ci sono T1–T5,
  T8, T10, T12, T25 e T26.
- **Che cosa manca.** T6, T7, T9, T11, T13–T24 e T27–T30.
- **Su disco.** L'SVG resta SVG. Ciò che il motore non sa conservare si
  dice prima di salvare (T16, T21).
- **Da correggere.** Tre errori di tipo nei test, dopo `main` (PA T2).

### La base per l'AI (A1)

- **Chi è il padrone.**
  - `crates/fub-features/src/recipes.rs` e `vocabulary.rs` (T5);
  - le forme condivise in `fub-abi` (T8, fatto);
  - l'host, che trova, adotta, scarta e prova le ricette (T9);
  - `fub-app`: `recipes_list`, `recipe_adopt`, `recipe_discard` e
    `recipe_simulate` (T10);
  - la CLI e l'MCP (T11);
  - nel client, la sezione «Ricette» (T12).
- **Che cosa c'è.** Sul ramo `piano/a1-base-per-ai` (0623ccf8) ci sono T1,
  T2, T3, T6 e T8.
- **Che cosa manca.** T4, T5, T7 e T9–T13.
- **Su disco.** Una ricetta è una nota Markdown con un blocco `fub-recipe`.
  Le ricette adottate stanno in un registro con l'impronta (T8, T9).

### I temi e la skin facile (PA T34–T42)

La richiesta del manutentore, 2026-11-05: «è importante la
personalizzazione in FUB e se non è facile creare una skin non andiamo da
nessuna parte». Verificato su `main` (638358da).

- **Chi è il padrone.**
  - Il manifest: `ThemeManifest` in `crates/fub-abi/src/theme.rs`. Il tema
    non è nella WIT (il `theme-colors` della WIT sono i colori di una
    cartella xlsx, un'altra cosa).
  - Trovare, leggere, installare e togliere: `crates/fub-host/src/theme.rs`
    (`discover_themes`, `read_theme`, `install_theme`,
    `install_theme_checked`, `update_theme`, `uninstall_theme`;
    `ThemeError` con le varianti `Malformed`, `Permissions`, `InvalidId`,
    `Traversal`, `AlreadyInstalled`, `Io` ed `Engine`).
  - Montare: `apps/client/src/theme/loader.ts` (i canali, i cancelli,
    `mountThemeBundle`) e `theme.ts` (`apply`, la preview, il ritorno alla
    serie).
  - Il vocabolario: `ui/sanitize-css.ts` e
    `apps/client/theme/author/contract.json` (generato).
- **Che cosa c'è.**
  - Due IPC, `list_themes` e `read_theme`, più il catalogo firmato
    (`catalog_install_theme` e gli aggiornamenti).
  - La fiducia: `core` per la serie, `community` per gli altri;
    `ui/permissions.ts` sa già dire anche «In sviluppo» (`development`).
  - I canali del loader: `caratteri`, `foglio`, `pelle`, `preferenze`,
    `snippets`. `replaceTheme` toglie il foglio e la pelle di prima e mette
    quelli nuovi.
  - Il contratto `theme-2`: 1.501 hook, 217 componenti, 154 ruoli
    obbligatori e 63 facoltativi, 91 coppie di contrasto e 54 facoltative,
    186 token di preferenza, 7 stati.
  - Il kit autore: `sample/` è una copia intera della serie (`skin.css` di
    18.222 righe).
  - Le icone: un registro solo, `ui/icons.ts` (43 nella mappa di serie, gli
    alias, e `registerIcon` per i moduli, che ne disegnano qualche
    centinaio), che accetta solo tracciati (`PATH_DATA`).
  - I cataloghi del banco: `bench/catalog.ts`, `samples.ts`, `kit.ts`.
  - La CSP ha già `font-src 'self' asset: data:`, e gli asset del tema
    diventano già URL `data:`.
- **Che cosa manca.**
  - Un tema che eredita: oggi la sua pelle sostituisce tutta quella di serie,
    e senza `skin.css` i componenti restano con la sola struttura.
  - Installare da una cartella dall'app, ricaricare al salvataggio, una
    diagnosi leggibile, una pagina di tutti i componenti dentro l'app.
  - I caratteri del tema (`@font-face` è vietato nel CSS) e le icone del
    tema.
  - Un contratto fermo: `contract.json` è cambiato in 12 commit dal 29
    ottobre al 4 novembre, e nessuna guardia ferma un hook tolto.
- **Come si fa, in quest'ordine.**
  1. La pelle che eredita: `extends` nel manifest (T34) e il canale
     `pelle-tema` (T35). Fase A.
  2. Gli strumenti dell'autore, in una sezione nuova «Sviluppo» delle
     Impostazioni (la chiave `developer.mode`): installare da cartella e la
     diagnosi (T36), collegare una cartella e ricaricare (T37), «Tutti i
     componenti» (T38). Fase B, dopo le Impostazioni nuove di S2 (T10).
  3. I caratteri del tema (T39). Fase A.
  4. Le icone del tema, se D16 è A o C (T40). Fase A.
  5. Gli hook congelati, per ultimi, quando la Fase C è in `main` (T41).
  6. Due temi d'esempio, la prova d'uscita (T42).
- **I canali, dopo.** `caratteri`, `caratteri-tema`, `foglio`, `pelle`,
  `pelle-tema`, `preferenze`, `snippets`. Le preferenze dell'utente restano
  dopo ogni pelle. Senza `extends` si monta tutto come oggi, byte per byte.
- **La sicurezza non cambia.**
  - Lo stesso sanificatore per la pelle del tema, con lo stesso
    vocabolario. `@font-face` resta vietato nel CSS: le regole le scrive il
    loader dai campi del manifest. `backdrop-filter` resta vietato.
  - Niente rete: caratteri e icone sono asset del tema, validati dall'host
    (la firma `wOF2`, `PATH_DATA`) e messi come URL `data:`. La CSP non
    cambia.
  - Nessuna capacità nuova per i temi.
  - Installare e collegare da cartella solo in modalità sviluppatore, e la
    regola sta nell'host.
- **Fuori.** I layout alternativi (le regioni della finestra spostate: una
  variante della shell, non una pelle); `backdrop-filter`; ereditare da un
  tema che non sia la serie.

### I contratti: IPC, WIT, su disco, MCP

- **WIT.**
  - `crates/fub-abi/wit/fub/abi.wit` è `fub:abi@0.2.0`.
  - `wit/frozen/` ha 0.1.0 e 0.1.1.
  - Nessun piano dentro tocca `abi.wit`: verificato con `git diff` su tutti
    i rami.

  Per questo #289 può congelare 0.2.0 presto (PA T6). Da lì, un cambio a
  `abi.wit` è additivo, o è una 0.2.1 da chiedere.
- **IPC nuovi.**
  - K2: quattro comandi;
  - K3: tre comandi;
  - K5: i comandi `drawing_*`;
  - A1: quattro comandi;
  - N6 T31: un campo facoltativo;
  - la skin facile: `install_theme_from_folder`, `link_theme_folder`,
    `unlink_theme_folder` e l'evento `fub://theme-changed` (PA T36, T37);
    `ThemePayload.sheet` diventa facoltativo (PA T34).

  Ognuno porta `contract.ts`, il mirror e la fixture (`UPDATE_MIRROR=1`),
  `fake.ts`, `ipc_permissions` e `lean_ipc`, nel task del suo piano.
- **Su disco.**
  - `.canvas` con `fub:ink` e `fub:parts`;
  - le chiavi `components.*`;
  - le note delle ricette;
  - docx, xlsx e svg li scrivono i motori. Il loro formato non cambia, e il
    corpus di PA T13 lo prova;
  - il manifest dei temi prende tre campi facoltativi, `extends`, `fonts` e
    `icons` (additivi: un manifest senza resta uguale byte per byte), e le
    impostazioni le chiavi `developer.mode` e `developer.theme-folder` (PA
    T34, T36, T37, T39, T40).
- **Il contratto dei temi.** Non è nella WIT. `theme-2` si congela con PA
  T41 (`apps/client/theme/author/frozen/theme-2.json`); da lì un nome tolto
  chiede un motore nuovo, `theme-3` (ADR 0206).
- **MCP (N2, in `main`).** `crates/fub-cli/src/mcp.rs`, con
  `mcp/access.rs` e `mcp/tools.rs`; la pagina è
  `docs/reference/mcp-server.md`, la ragione l'ADR 0232. Un server stdio
  (JSON-RPC 2.0, un messaggio per riga), avviato da `fub-cli mcp`.
  - **17 strumenti:** `fub_search`, `fub_query`, `fub_read`,
    `fub_read_model`, `fub_preview`, `fub_write`, `fub_create`,
    `fub_canvas_create`, `fub_canvas_apply`, `fub_commands`, `fub_invoke`,
    `fub_external_editors`, `fub_open_with`, `fub_components`,
    `fub_components_why`, `fub_components_enable` e
    `fub_components_disable`.
  - **La base è obbligatoria.** `fub_write` e `fub_canvas_apply` vogliono la
    revisione letta; una revisione superata torna `conflict`, l'agente
    rilegge e riprova. `fub_create` non sovrascrive.
  - **La prova a vuoto è di serie.** `fub_canvas_apply`, `fub_invoke`,
    `fub_open_with` e i due `fub_components_*` che cambiano qualcosa senza
    `"apply": true` rispondono col piano (`dry_run: true`) e non scrivono.
  - **Le radici.** Senza `--automation-write-root` il server è in sola
    lettura e ogni scrittura risponde `denied`; `--automation-read-root`
    restringe ciò che si legge. Le cancellazioni passano da `note.trash` e
    vanno nel cestino.
  - **Nessuna faccia nelle Impostazioni.** Le schede sono `settings`,
    `components`, `shortcuts`, `vault` e `about`: l'MCP non ha una sezione.
    Si vede di riflesso: le note cambiate sul disco (`changed_on_disk`, o un
    conflitto se c'è testo non salvato), il pannello delle attività, la
    pagina «Componenti», le ricette proposte di A1.
  - **Che cosa arriva coi piani.** Gli strumenti della lavagna in codice
    (T22) e delle ricette di A1 (T11). Una nota «proposta» dall'AI, da
    rivedere riga per riga in Fub, non è in nessun piano dentro: è A1 F5
    («L'assistente dentro Fub», artifact «Ricette di Fub»), fuori.
- **Il turno di scrittura.** È di tutto l'host, ed è PA T3.

### Il rilascio e la CI

- **Che cosa c'è.**
  - `release.yml`: parte con un tag `v*` o a mano. Fa deb, rpm, AppImage,
    dmg, msi e setup.exe. Una prerelease può uscire senza firma.
  - `mobile.yml`: l'APK di debug, artefatto `fub-android-debug`.
  - `check-release-gate.mjs`: i job che un rilascio chiede.
  - `check-release-version.mjs`: sei posti concordi. La regola accetta
    `-prealpha.1`.
  - C'è un tag, `v0.1.0-rc.1` (2026-09-21). C'è stata una corsa a mano,
    verde, sul ramo di K2 (2026-11-01).
- **Che cosa manca.**
  - La versione `0.2.0-prealpha.1` nei sei posti (PA T22).
  - L'MSI: WiX vuole una versione numerica, e Tauri rifiuta un
    identificatore di prerelease non numerico. Serve
    `bundle.windows.wix.version` = `0.2.0.N` (PA T22; l'aggiornamento da una
    pre-alpha all'altra lo prova PA T23).
  - L'APK allegato alla pre-release (PA T22), e provato nell'emulatore della
    CI (PA T31).
  - Il controllo degli aggiornamenti: chiede `releases/latest`, che salta le
    pre-release, e confronta `prealpha.10` come testo, sotto `prealpha.2`
    (`crates/fub-host/src/updates.rs`, PA T25).

## Dal prototipo

Il simulatore sta in `PLAN-ui/fub-pre-alpha/`: `simulatore.html`,
`sim-dati.js`, `solo-simulatore.js` e `piani/`. Si apre col doppio clic, o
da un server statico qualsiasi. In alto si scelgono lo stato, la luce, la
larghezza e il movimento; l'indirizzo li ricorda
(`#stato=…&luce=…&larghezza=…&moto=…`). Sotto lo schermo, «I pezzi di
questo stato» elenca per ogni pezzo il file, il task e «nuovo», «cambiato» o
«uguale». «Indica» lo segna nello schermo, «DOM» mostra il DOM da copiare.

Come si legge:

- **Il DOM** di ogni stato è quello del client vero, fotografato dal banco
  (Playwright, finto host), con le classi, i ruoli, gli ARIA e i
  `data-i18n` di oggi. I pezzi «uguale» sono quelli di `main`: si copia solo
  la pelle. Per i pezzi «cambiato» e «nuovo» il DOM è quello da costruire.
- **Il CSS nuovo** sta in testa a `simulatore.html`, un blocco
  `<style data-destinazione="…" data-task="…">` per file di destinazione,
  già senza le varianti «com'era». Ogni blocco passa il sanitizer del tema
  (`themeCssViolations`, profilo `theme-2`, `kind: "skin"`): zero
  violazioni, 2026-11-05. `structure.css`, `mobile.css` e `series.ts` nell'app
  non passano dal sanitizer.
- **«Solo simulatore»**: `solo-simulatore.js` e lo `<script>` in fondo a
  `simulatore.html`. Sono i passaggi fra gli stati, i menu sovrapposti e il
  segno di «Indica». **Non si copiano**: nell'app gli stessi comportamenti li
  danno il contratto, i registri, i comandi e le sessioni.
- **Lo stile in linea**: nel markup degli stati non c'è nessun attributo
  `style=` (0 su 252 catture). Le misure che l'app scrive in linea dal suo
  codice restano nel codice, come oggi.
- **I percorsi** senza `apps/client/` davanti stanno sotto
  `apps/client/src/`.

### I pezzi dello schermo

| Pezzo | Selettore nello schermo | Destinazione | Task | Come |
|---|---|---|---|---|
| La barra del titolo | `#topbar` | `apps/client/index.html`, `shells/scrittoio/frame/*.ts` | S2 T7 | cambiato |
| La pillola (cerca o esegui) | `#pill` | `shells/scrittoio/frame/pill.ts` | S2 T7 | cambiato |
| Il binario | `#rail` | `shells/scrittoio/frame/rail.ts`, `index.html` | S2 T7 (pelle) | uguale |
| La striscia degli spazi | `#space-strip` | `panels/explorer.ts` | S2 T8 | cambiato |
| L'albero del vault | `#file-list` | `panels/explorer.ts`, `ui/page-mark.ts` | S2 T8, T14 | cambiato |
| Il pozzetto della ricerca | `#search-input` | `index.html`, `panels/explorer.ts` | S2 T8 | cambiato |
| Le linguette | `.pane.focus .pane-tabs` | `panels/document.ts` (pelle in skin/sheets.css) | S2 T6 | uguale |
| La testata del foglio | `.pane.focus .pane-toolbar` | `panels/document.ts`, `shells/scrittoio/sheets/title-rename.ts` | S2 T5 | cambiato |
| «Salvato» nella testata | `.pane.focus .sheet-save` | `shells/scrittoio/sheets/save-state.ts` | S2 T5 | cambiato |
| La barra di formato | `.pane.focus .format-bar` | `panels/format-bar.ts`, `kit/toolbar-keys.ts` | S2 T16, T17 | cambiato |
| La modalità nel foglio (telefono) | `.pane > .pane-mode-current` | `panels/document.ts`, `mobile.css` | S2 T3 | cambiato |
| La riga dei dati sotto il titolo | `.note-facts` | `editors/text/profiles/markdown/note-facts.ts` (nuovo) | S2 T12 | nuovo |
| La banda | `#status-band` | `shells/scrittoio/frame/status-band.ts`, `index.html` | S2 T3, T4 | cambiato |
| «Si scrive» nella banda | `.status-standing` | `shells/scrittoio/frame/status-band.ts`, `panels/standing.ts` | S2 T4 | nuovo |
| La modalità nella banda | `#status-mode` | `shells/scrittoio/frame/status-band.ts`, `state/mode-menu.ts` | S2 T2, T3 | nuovo |
| L'ispettore | `#right-pane` | `ui/views.ts`, `ui/node.ts` | S2 T9 | cambiato |
| «In entrata» | `#view-panel-backlinks` | `ui/node.ts`, `crates/fub-features/src/backlinks.rs` | S2 T13 | cambiato |
| Il conflitto | `.conflict-banner` | `panels/document.ts` (drawConflict) | main; PA giro | uguale |
| Gli avvisi del foglio | `.sheet-notices:not(:empty)` | `panels/document.ts` | main | uguale |
| Il menu delle modalità | `#context-menu[aria-label="Modalità del riquadro"]` | `state/mode-menu.ts` (nuovo), `ui/menu.ts` | S2 T2, T10 | nuovo |
| Il menu del tasto destro | `#context-menu:not([aria-label="Modalità del riquadro"])` | `ui/menu.ts`, `panels/editor-menu.ts` | main (#238) | uguale |
| Il menu «/» | `.slash-panel` | `panels/slash/panel.ts` | main N12 | uguale |
| L'avvio rapido | `.launcher-layer` | `shells/scrittoio/launcher/launcher.ts` | main (pelle S2 T10) | uguale |
| Il foglietto del salvataggio | `.kit-popover` | `kit/popover.ts`, `shells/scrittoio/sheets/save-state.ts` | S2 T5 | cambiato |
| Gli avvisi | `#notify-panel:not([hidden])` | `ui/notify.ts` | main | uguale |
| Un avviso che passa | `.toast-stack:not(:empty)` | `ui/notify.ts` | main | uguale |
| Il dialogo del kit | `.kit-dialog-scrim` | `kit/dialog.ts` | main | uguale |
| Le impostazioni | `.settings-panel` | `panels/settings.ts`, `shells/scrittoio/preferences/*.ts` | main (pelle S2 T10) | uguale |
| La pagina «Componenti» | `.components-page` | `panels/components-page.ts` (nuovo) | K2 T1–T7 | nuovo |
| Il benvenuto | `.onboarding:not([hidden])` | `shells/scrittoio/frame/welcome.ts` | main (pelle S2 T10) | uguale |
| Lo strato d'avvio | `.avvio` | `avvio/consegna.ts`, `index.html` | main #308 | uguale |
| La barra a schede | `.kit-ribbon` | `kit/ribbon/ribbon.ts`, `editors/rich/ribbon.ts` | S2 T20, T21; K3 T18 | nuovo |
| La barra del PDF | `.media-pdf-toolbar` | `editors/media/pdf-view.ts` | S2 T18 | cambiato |
| La testa del disegno | `.draw-header` | `editors/spatial/tools/editor/toolbar.ts` | S2 T22; K5 | cambiato |
| La barra della lavagna di oggi | `.canvas-toolbar` | `editors/canvas/engine.ts` | N6 T26, T49 (la sostituiscono) | cambiato |
| La domanda dei file Craft | `.craft-ask` | `editors/craft/consent.ts` | main N7 (pelle S2 T19) | uguale |

### Il CSS nuovo, per file di destinazione

Ogni blocco è il CSS del prototipo approvato di Scrittoio 2, unito per
file. Il dettaglio riga per riga (quali righe, quale task) è nella tabella
«Dal prototipo» del `PLAN.md` di `piano/scrittoio-2`, che resta la fonte.

| File di destinazione (sotto `apps/client/src/`) | Blocchi del simulatore | Task | Come |
|---|---|---|---|
| `theme/scrittoio/structure.css` | struttura, kit, fila del kit | S2 T3, T4, T9, T16, T20, T21, T27 | cambiato |
| `theme/scrittoio/skin/kit.css` | kit, vassoio, fila | S2 T16 (fatto), T20 | cambiato |
| `theme/scrittoio/skin/frame.css` | cornice | S2 T3, T4, T7, T9 | cambiato |
| `theme/scrittoio/skin/drawers.css` | cassetto, icone | S2 T8, T14 | cambiato |
| `theme/scrittoio/skin/tree.css` | albero | S2 T8 | cambiato |
| `theme/scrittoio/skin/sheets.css` | fogli | S2 T5, T6, T27 | cambiato |
| `theme/scrittoio/skin/document.css` | documento | S2 T11, T12 | cambiato |
| `theme/scrittoio/skin/media.css` | PDF, Craft | S2 T18, T19 | cambiato |
| `theme/scrittoio/skin/nodes.css` | viste | S2 T9, T13 | cambiato |
| `theme/scrittoio/skin/graph.css` | grafo | S2 T10 | cambiato |
| `theme/scrittoio/skin/menus.css` | menu | S2 T10 | cambiato |
| `theme/scrittoio/skin/launcher.css` | avvio rapido | S2 T10 | cambiato |
| `theme/scrittoio/skin/centres.css` | «Salvato» | S2 T5 | cambiato |
| `theme/scrittoio/skin/settings.css` | impostazioni | S2 T10 | cambiato |
| `theme/scrittoio/skin/welcome.css` | benvenuto | S2 T10 | cambiato |
| `shells/scrittoio/mobile/mobile.css` | telefono | S2 T3, T4, T5, T7, T11, T27 | cambiato |
| `theme/scrittoio/series.ts` | corpo 18, misura 58 | S2 T11 | cambiato |
| `theme/scrittoio/recipe.ts` | `--bar-tray` (fatto), `--shadow-sheet`, `--shadow-sheet-focus` | S2 T16, T27 | cambiato |
| `theme/scrittoio/anatomia/*.ts` | i ganci nuovi elencati sotto | il task del blocco | cambiato |
| `bench/fake-ipc.ts` | la riga «Animazioni» delle impostazioni | PA T1 | cambiato |

I ganci nuovi che le pelli usano, e che `anatomia` deve dichiarare
(`anatomia.test.ts` vuole le classi della pelle e i ganci uguali nei due
versi):

- **icone ed elenchi** (S2 T8, T14, T17): `cm-fub-bullet`,
  `cm-fub-bullet-task`, `icon-button`, `icon-grid--figures`,
  `icon-picker-title`, `ui-list-item-icon`;
- **testata e cassetto** (S2 T5, T8): `crumb-name`, `crumb-sep`,
  `panel-count`, `panel-title-actions`, `row-count`, `row-pin`,
  `space-chip-icon`, `space-chip-name`, `space-well`;
- **barre** (S2 T16, fatto, e T20): `kit-bar`, `kit-bar-button`,
  `kit-bar-field`, `kit-bar-group`, `kit-ribbon`, `kit-ribbon-*`;
- **nota e media** (S2 T12, T18): `media-pdf-search`, `note-fact`,
  `note-fact-tags`, `note-facts`, `note-tag`;
- **banda** (S2 T3, T4): `status-mode`, `status-mode-arrow`,
  `status-standing`, `status-standing-mark`.

### Le pagine dei piani

Le pagine scritte a mano dai pianificatori entrano tali e quali, in
`piani/`. Non sono composte nella cornice di Scrittoio 2: lo chiede la
domanda D4.

| Pagina | Piano e task | Approvata | Dove va ogni pezzo |
|---|---|---|---|
| `piani/menu-comandi-fogli.html` | K3 T12 | 2026-11-03 | già nel codice del ramo (K3 T14) |
| `piani/celle-griglia.html` | griglia | non scritta (D2) | `PLAN.md` di `piano/griglia-celle`, «Dal prototipo» |
| `piani/disegno-motore.html` | K5 T25 | 2026-11-05 | `PLAN.md` di `piano/k5-disegno` (T21–T23) |
| `piani/lavagna-penne.html` | N4 T20 | 2026-11-02 | `PLAN.md` di `piano/n4-inchiostro` (T21) |
| `piani/lavagna-schede.html` | N6 T25 | 2026-11-04 | `PLAN.md` di `piano/n6-lavagna` |
| `piani/ricette.html` | A1 | 2026-11-03 | `PLAN.md` di `piano/a1-base-per-ai` (T12) |

Senza prototipo:

- N6 T26–T28 (D3);
- le tre voci di menu della lavagna in codice (T25, pezzi del kit che ci
  sono);
- le scene del giro (PA T14), che usano solo pezzi di questa tabella.

## Domande aperte

Ogni domanda ha le sue opzioni, il consiglio per primo, e i pro e i contro
su tempo, qualità e personalizzazione. Il criterio di `DECISIONS.md` è il
risultato migliore, anche quando costa di più. Fino alla risposta, i task
che aspettano una domanda non partono; gli altri sì.

### D1 · Il telefono, per l'APK di prova

Oggi il telefono è la variante A di Scrittoio 2, «approvata per ora».
L'utente ha detto: «sicuramente da modificare pesantemente».

- **A (consigliata).** L'APK esce con la cornice A, segnato «sperimentale»
  e lo dice. Un piano del telefono, con un prototipo suo, parte subito dopo
  la pre-alpha.
  - Tempo: niente in più adesso.
  - Qualità: chi prova l'APK vede un telefono provvisorio, ma lo sa.
  - Personalizzazione: si decide dopo, con calma, sul telefono vero.
- **B.** Un piano del telefono **prima** della pre-alpha: pianificatore,
  prototipo, poi i task.
  - Tempo: una o due settimane in più, e lavoro che si sovrappone a
    Scrittoio 2 mentre entra.
  - Qualità: la migliore, l'APK è già quello giusto.
  - Personalizzazione: piena, subito.
- **C.** Niente APK nella pre-alpha.
  - Tempo: il più corto.
  - Qualità: nessun rischio di brutta figura.
  - Contro: cambia la risposta già data («Computer + Android di prova») e
    nessuno prova Fub su un telefono.

### D2 · La griglia: approvare `celle-griglia`

Il prototipo della griglia (`piani/celle-griglia.html`) non ha una riga
«Approvato» nel suo piano. Il prompt dice che D-1…D-8 seguono i consigli,
con due preferenze nelle Impostazioni (griglia T9).

- **A (consigliata).** Approvato così com'è.
  - Tempo: la griglia parte appena K3 è in `main`.
  - Qualità: il prototipo è stato fatto sul client vero.
- **B.** Approvato con modifiche: le dice l'utente guardando la pagina.
  - Tempo: un giro in più del pianificatore della griglia.
  - Qualità e personalizzazione: le migliori, se c'è qualcosa che non
    piace.
- **C.** La griglia resta com'è oggi, e il piano esce dalla pre-alpha.
  - Tempo: meno lavoro.
  - Qualità: il foglio resta più lento a rispondere.

### D3 · N6 T26–T28: i prototipi della lavagna che mancano

**Decisa dall'utente il 2026-11-05: A.** I tre prototipi sono nel
simulatore del secondo giro, segnati «da approvare».

N6 ha quattro pagine di prototipo, e solo la prima è approvata (le schede,
T25). Mancano l'impianto (T26: la colonna degli strumenti, la riga delle
opzioni, la barra della selezione, la banda), la modifica (T27: scrivere
dentro le schede) e gli estratti (T28, senza le parti del PDF, che sono
fuori).

- **A (consigliata).** Li disegno io adesso, nel simulatore e nella
  cornice di Scrittoio 2, prima della consegna, sullo stesso link. Dopo il
  sì, N6 T26–T28 sono fatti dal piano pre-alpha, e i task grafici di N6
  partono dall'approvazione.
  - Tempo: qualche ora di pianificazione in più adesso; nessuna attesa dopo.
  - Qualità: la migliore, perché la lavagna nasce già composta con la
    cornice nuova. Il simulatore copre ogni schermata della pre-alpha, come
    vuole la definizione.
  - Personalizzazione: l'utente sceglie guardando, prima del codice.
- **B.** Come dice N6: li fa un coder con `prototipo.md`, e l'orchestratore
  li mostra all'utente. Poi un passo di PA li aggiunge al simulatore.
  - Tempo: il lavoro si sposta in Fase C, e i task grafici di N6 aspettano.
  - Qualità: buona, ma il simulatore resta senza le schermate della lavagna
    fino ad allora.
- **C.** Senza prototipo: i coder di N6 seguono il testo del piano.
  - Tempo: il più corto.
  - Qualità: la più bassa; contraddice A-26 di N6.

### D4 · Comporre le pagine dei piani nella cornice di Scrittoio 2

**Decisa dall'utente il 2026-11-05: A.** Gli editor sono composti nel
simulatore del secondo giro, con le barre nel kit, segnati «da approvare».

Le pagine di K5 (la colonna con Testo e i gettoni del motore), N4 (il menu
delle penne), N6 (le schede), A1 (le ricette), della griglia (le celle) e
di K3 (il menu «Comandi») sono state disegnate nella cornice di oggi. Nel
simulatore stanno a parte, in `piani/`.

- **A (consigliata).** Le compongo adesso nel simulatore: ogni editor nella
  cornice di Scrittoio 2, con le sue barre nel kit (fila, colonna, schede).
  Poi le mostro, e si approva sullo stesso link.
  - Tempo: un giorno di pianificazione in più.
  - Qualità: la migliore. Le contraddizioni (D5) si vedono e si chiudono
    prima del codice, e ogni coder copia da uno stato che è la pre-alpha.
  - Personalizzazione: si sceglie ogni incastro guardando.
- **B.** Restano a parte; il coder compone mentre implementa, con le regole
  di Scrittoio 2 (il kit, la banda, la testata).
  - Tempo: niente adesso.
  - Qualità: rischio di incastri decisi da un coder, e di foto del banco
    senza un riferimento.
- **C.** Le compone un secondo giro di pianificazione, dopo che Scrittoio 2
  è in `main`.
  - Tempo: nessuna attesa adesso, ma un pianificatore in più dopo.
  - Qualità: buona; il rischio è che gli editor partano prima.

### D5 · La testa del disegno: K5 contro Scrittoio 2 T22

**L'utente ha chiesto di vedere composte sia A sia B (2026-11-05).** Nel
simulatore ci sono tutte e due; la scelta resta sua.

Il prototipo di K5 (approvato il 2026-11-05) mette nella colonna degli
strumenti anche Testo, e i gettoni del motore (`pane-standing*`) nella
testata di oggi. Scrittoio 2 T22 porta la testa del disegno nella barra in
una fila del kit, e dice che T22 segue K5 T25 se K5 ha approvato altro.

- **A (consigliata).** La cornice di Scrittoio 2 con il contenuto di K5:
  - la colonna del kit tiene gli strumenti di K5, Testo compreso;
  - i gettoni del motore vanno nella banda accanto a «Si scrive», dove
    Scrittoio 2 mette lo stato del foglio;
  - la fila del kit tiene i comandi della testa.

  Si vede composta con D4 prima del codice.
  - Tempo: niente in più, se D4 è A.
  - Qualità: un solo disegno per tutti gli editor.
- **B.** K5 com'è approvato; T22 cambia solo la pelle.
  - Tempo: il più corto.
  - Qualità: il disegno ha una testata diversa dagli altri editor.
- **C.** T22 com'è scritto; K5 T21–T23 si adattano.
  - Tempo: K5 rifà una parte del suo prototipo.
  - Qualità: buona, ma tocca una scelta già approvata.

### D6 · Il vassoio più chiaro, anche per la fila e per la colonna

È la domanda aperta di Scrittoio 2: «Il vassoio più chiaro per la barra a
una riga e per la colonna degli strumenti: se ne riparla; T16 resta com'è».

Sul ramo di Scrittoio 2, T16 (fatto, 68f48788) ha già messo la fila
(`kit-bar`) e la colonna (`kit-rail`) sul ruolo nuovo `--bar-tray`:
`#f8fafc` di giorno, a metà fra la carta e `--sheet-2`, e `#1a1f27` di
notte. Di notte ci sono anche i gruppi come foglietti alzati. Nel
simulatore, gli stati con la barra di formato, il PDF e il disegno lo
mostrano già.

- **A (consigliata).** Un vassoio solo, il più chiaro, per la barra a
  schede, la fila e la colonna, com'è sul ramo.
  - Tempo: niente.
  - Qualità: tutte le barre si somigliano, e il contrasto è provato (15,78,
    6,12 e 3,50 di giorno; 13,47, 6,69 e 3,88 di notte).
  - Contro: sulla scrivania del disegno (`--draw-desk`) la colonna si
    stacca meno.
- **B.** Solo la barra a schede è più chiara; la fila e la colonna tornano a
  `--sheet-2`, il grigio di oggi.
  - Tempo: un task piccolo (PA T11).
  - Qualità: due vassoi diversi nella stessa cornice.
- **C.** A, più una preferenza in Impostazioni › Aspetto: «Le barre: chiare
  · marcate». «Marcate» rimette `--sheet-2` sotto tutte le barre.
  - Tempo: PA T11, una chiave nuova nell'host e le foto delle due varianti.
  - Qualità: come A di serie.
  - Personalizzazione: la più alta. Chi vede poco il vassoio chiaro, per
    lo schermo o per gli occhi, lo rimette.

### D7 · `windows-sys`, per fermare i figli della CLI Craft su Windows

Su Windows, quando il tempo scade, oggi si ferma solo la CLI Craft e non
i suoi figli: serve un job object (DECISIONS, N7 T8). `windows-sys` è già
in `Cargo.lock` come dipendenza indiretta (cinque versioni, 0.45–0.61). La
licenza è MIT o Apache-2.0, e la mantiene Microsoft. Diretta, è una
dipendenza nuova.

- **A (consigliata).** Sì, diretta, solo per `cfg(windows)`, alla versione
  che il lockfile ha già (PA T9).
  - Tempo: un task M.
  - Qualità: nessun processo orfano su Windows, come su Linux e macOS.
- **B.** No. Il limite resta scritto nella pagina.
  - Tempo: niente.
  - Qualità: su Windows un tempo scaduto può lasciare processi vivi.
- **C.** `taskkill /T /F` lanciato da Fub, senza dipendenze nuove.
  - Tempo: un task S.
  - Qualità: più fragile, perché è un processo in più e il PID può essere
    riusato.

### D8 · I pacchetti per Linux

- **A (consigliata).** deb, rpm e AppImage, come fa `release.yml` oggi.
  - Tempo: niente.
  - Qualità: WebKitGTK cambia da una distribuzione all'altra (lo dice N10).
- **B.** Anche Flatpak, sul runtime GNOME (decisione 5).
  - Tempo: L, con i portali per aprire un vault fuori dalla sandbox.
  - Qualità: lo stesso motore su ogni distribuzione.
- **C.** Solo AppImage.
  - Tempo: meno controlli.
  - Qualità: niente aggiornamenti dal sistema.

### D9 · Il canale dei riscontri della pre-alpha

- **A (consigliata).** I modelli di issue su GitHub, «Problema», «Ho perso
  dei dati» (con priorità) e «Idea», più le Discussions per le domande. La
  pagina «Prova la pre-alpha» li nomina (PA T18).
  - Tempo: S.
  - Qualità: tutto in un posto, e già lo strumento del lavoro.
- **B.** A, più «Segnala un problema» nel menu di Fub: apre il browser
  sulla pagina dell'issue con la versione e il sistema già scritti, e senza
  dati personali.
  - Tempo: un task M in più, con un pezzo di GUI senza prototipo.
  - Qualità e personalizzazione: le migliori, perché chi prova scrive di
    più se è facile.
- **C.** Solo le issue.
  - Tempo: il più corto.

### D10 · Due punti sciolti che non trovo

«Una stringa inglese nel fake host» e «il conto dei diagrammi Mermaid».
Ho cercato nei piani, nelle DECISIONS di tutti i rami, nelle issue, nei
messaggi di commit e nel codice:

- `bench/fake-english.test.ts` passa su `anteprima/tutto`;
- `check-mermaid.mjs` dà 40 blocchi validi su `main` e 45 sull'anteprima.

Gli altri quattro punti li ho trovati: la sola lettura (PA T3), i sei
errori di tipo (PA T2), la pagina del telefono (PA T8) e `windows-sys`
(D7).

- **A (consigliata).** L'utente dice dove li ha visti (un messaggio, un
  resoconto, una schermata). Diventano PA T10.
- **B.** All'inizio di PA T10 il coder li cerca come scritto nel task. Se
  non li riproduce, lo scrive nel registro e il punto si chiude come «non
  riprodotto».
- **C.** Fuori dalla pre-alpha.

### D11 · macOS a mano

Il «Fatto quando» 3 chiede il giro a mano sugli installer. Qui c'è Linux,
e l'utente ha un portatile Windows; un Mac non c'è.

- **A (consigliata).** Su macOS si prova solo nella CI: l'installer si
  costruisce, e l'app parte e si chiude pulita. Le note della pre-release lo
  dicono.
  - Tempo: S (PA T22).
  - Qualità: nessuno ha usato il dmg a mano.
- **B.** Una persona con un Mac fa il giro a mano.
  - Tempo: dipende da chi.
  - Qualità: la migliore.
- **C.** Niente dmg nella pre-release.
  - Qualità: chi ha un Mac non può provare.

### D12 · Densità e accento nel simulatore

**Decisa dall'utente il 2026-11-05: B.** Densità, contrasto e accento
cambiano davvero il simulatore, nelle due luci.

Il simulatore cambia davvero il tema, la luce, le animazioni, il corpo,
l'interlinea, la misura e il carattere. Non cambia la densità, il contrasto
e l'accento, perché per quelli il tema va ricompilato: quando li si sceglie,
segna la scelta e lo dice nella riga sopra lo schermo.

- **A (consigliata).** Va bene così.
  - Tempo: niente.
- **B.** Prima di consegnare preparo le varianti: tre densità, il
  contrasto alto e gli accenti, nelle due luci.
  - Tempo: qualche ora, e alcuni MB in più.
  - Qualità: si vedono anche quelle.

### D13 · La prova di K2 con una persona: prima o dopo il merge

K2 D-2 dice: la prova con persone si fa sulla PR in bozza, la fa l'utente
(se può con una persona che non conosce Fub) e «la PR non si segna pronta
prima del suo resoconto». Il primo giro di questo piano l'aveva spostata
alla fine (PA T17) senza chiedere. Il protocollo c'è già: «Prova dei
componenti di Fub», sei compiti in circa 25 minuti, sull'installer della
corsa «release» del ramo.

- **A (consigliata).** Come dice K2 D-2, e in più i compiti di K2 tornano
  nella prova finale. Prima di segnare pronta #290, riallineata a `main`,
  l'utente fa il protocollo, da solo o con una persona. Ciò che emerge
  diventa un task di K2 o una riga di `DECISIONS.md`; poi il merge. Alla
  fine PA T17 ripete i compiti di K2 nella cornice nuova, con cinque
  persone.
  - Tempo: 25–50 minuti dell'utente adesso, più una corsa di `release.yml`
    sul ramo (circa un'ora di CI). #290 aspetta il resoconto, un giorno o
    due; ciò che usa K2 (K5 T24, PA T29) viene molto dopo, quindi non
    aspetta niente.
  - Qualità: la migliore. I problemi della pagina si trovano prima che
    Scrittoio 2 la rivesta e che altri piani ci costruiscano sopra, e la
    prova finale guarda la pagina vestita.
  - Contro: la prima prova guarda la cornice di oggi, che Scrittoio 2
    cambierà.
- **B.** Si unisce subito; la prova solo alla fine, in PA T17, come diceva
  il primo giro.
  - Tempo: il più corto, nessuna attesa.
  - Qualità: ciò che la prova trova arriva quando Scrittoio 2, K5 T24 e
    A1 ci hanno già costruito sopra.
  - Contro: cambia una regola che l'utente aveva scritto (K2 D-2).
- **C.** La prova prima del merge, come K2 D-2, e niente K2 nella prova
  finale.
  - Tempo: PA T17 più corta di circa 25 minuti a persona.
  - Qualità: la pagina rivestita da Scrittoio 2 non la prova nessuno.

### D14 · Il nome «FubDraw» dove le persone lo vedono

FubDraw era l'app dei disegni; ora vive dentro Fub e la sua app è
archiviata (ADR 0231, #282). Il nome resta in una quarantina di frasi che
le persone leggono, in italiano e in inglese: «SVG (FubDraw)» fra i
formati, «Questo SVG non è stato fatto con FubDraw», «il file viene da una
versione più recente di FubDraw», «FubDraw la lascia com'è», gli avvisi
dell'import e la diagnosi S002. Chi prova la pre-alpha non sa che cosa sia
FubDraw. Per il codice non cambia niente: il namespace `fub:`, gli id, lo
stato `fubdraw` e `fubdraw://live` restano.

- **A (consigliata).** Dove si legge, il nome diventa Fub o il disegno:
  «Disegno SVG», «Annotazioni PDF», «Questo SVG non è stato fatto con
  Fub», «Fub la lascia com'è», «il formato dei disegni di Fub». Le pagine
  `docs/product/drawing*.md` seguono; le pagine `docs/reference/scene-*`
  dicono una volta che «FubDraw» è il nome tecnico del formato.
  - Tempo: un task M (PA T33), circa mezza giornata di un coder.
  - Qualità: una sola parola per il prodotto; nessuna sorpresa per chi
    prova.
  - Contro: ADR 0203 chiama il formato FubDraw; serve una riga in
    `DECISIONS.md` e una nota nell'ADR (non riscritta).
- **B.** Resta FubDraw, come nome del formato dei disegni; la pagina
  «Prova la pre-alpha» (T18) lo spiega in una riga.
  - Tempo: niente.
  - Qualità: un nome in più da imparare, e alcune frasi («non fatto con
    FubDraw») sembrano parlare di un'altra app.
- **C.** Cambiano solo i due nomi dei formati («Disegno SVG», «Annotazioni
  PDF»); le frasi restano.
  - Tempo: un task S.
  - Qualità: a metà: il nome sparisce dalla lista dei formati ma resta
    negli avvisi.

### D15 · Il nome del campo che dice da quale tema si parte

Il manifest di un tema prende un campo nuovo che dice «parto dalla serie e
porto solo ciò che cambia» (PA T34). Il nome resta per sempre: lo
scriveranno tutti i temi. Le altre chiavi del manifest sono in inglese
(`id`, `name`, `version`, `engine`, `lights`, `asset_namespace`, `motion`,
`settings`).

- **A (consigliata).** `extends`, come `"extends": "fub.serie"`.
  - Tempo: niente in più.
  - Qualità: chi ha scritto un `tsconfig.json`, una configurazione di
    ESLint o di Stylelint lo riconosce subito; è inglese come il resto del
    manifest.
  - Contro: fa pensare a un'eredità a catena, che qui non c'è (solo la
    serie, per ora).
- **B.** `base`.
  - Tempo: niente in più.
  - Qualità: corto, ma generico: base di che cosa? Si confonde facilmente
    coi colori di base di un foglio.
- **C.** `eredita`.
  - Tempo: niente in più.
  - Qualità: chiaro per chi legge l'italiano, ma sarebbe l'unica chiave
    italiana del manifest, e i temi li scrivono anche persone che non lo
    leggono.

### D16 · Le icone del tema

Le icone passano tutte da un registro solo (`ui/icons.ts`): 43 nella mappa
di serie, e qualche centinaio registrate dai moduli (il nastro del foglio,
il documento, il disegno, la barra del formato, Scrittoio). Un tema oggi
può solo ricolorarle. Il registro accetta già soltanto tracciati SVG
validati, quindi un set del tema non apre porte nuove.

- **A (consigliata).** Dentro: un tema può ridisegnare ogni icona, per nome
  (PA T40). I nomi entrano nello snapshot di PA T41, quindi restano
  stabili.
  - Tempo: un task M, circa mezza giornata di un coder.
  - Qualità: un'identità intera, coerente fra la cornice e gli editor.
  - Contro: qualche centinaio di nomi da tenere fermi; un'icona nuova di un
    modulo, sotto un tema, ha il disegno di serie finché il tema non la
    ridisegna.
- **B.** Fuori dalla pre-alpha: si congelano solo i nomi, il set del tema
  arriva dopo.
  - Tempo: niente adesso.
  - Qualità: i temi d'esempio cambiano colori, forme e caratteri, ma le
    icone restano quelle di serie.
- **C.** Solo le 43 della cornice (la mappa di serie).
  - Tempo: un task S.
  - Qualità: a metà: si vede la cucitura fra la cornice ridisegnata e le
    barre degli editor di serie.

### D17 · L'aspetto dei due temi d'esempio

La prova d'uscita della skin facile (PA T42) sono due temi: uno di circa
100 righe sopra la serie, con un'identità diversa, e uno di soli colori.
Diventano il punto di partenza di chi scrive un tema, e il simulatore li
mostra (gli stati «vestito da …», «da approvare»).

- **A (consigliata).** «Carta» e «Salvia».
  - «Carta»: carta calda, angoli dritti, maiuscoletto nelle etichette,
    nessuna ombra, filetti sottili al posto delle scatole, un suo carattere
    con le grazie (PA T39) e, se D16 è A, una decina di icone a tratto
    sottile.
  - «Salvia»: soli colori, un accento salvia e superfici appena verdi,
    nelle due luci.
  - Tempo: è quello di PA T42.
  - Qualità: mostra che cosa si cambia con 100 righe senza toccare la
    struttura; «Carta» è leggibile a lungo, adatta a un vault di studio.
  - Contro: tutti e due restano vicini allo spirito della serie.
- **B.** «Officina» e «Salvia». «Officina»: bordi spessi, etichette in
  monospazio, contrasto alto, icone quadrate.
  - Tempo: come A.
  - Qualità: più lontano dalla serie, quindi una prova più dura dei
    cancelli di contrasto; meno adatto a leggere a lungo.
- **C.** Tutti e tre.
  - Tempo: mezza giornata in più, e un tema in più da tenere verde a ogni
    cambio della serie.
  - Qualità: la prova più larga.

## Come si implementa

Per i coder con ragionamento medio e per l'orchestratore. Basta da sola: chi
la legge non ha bisogno dell'artifact. Le regole di `CLAUDE.md`,
`CLAUDE_DEVICE.md` e `.claude/agents/coder.md` valgono sempre; qui c'è ciò
che serve in più per questo piano.

### La misura di un task

- Un task è un coder in una seduta: un crate o un modulo, i suoi test, la
  sua pagina di `docs/`. Se non sta in dieci righe di «Cosa fare», si divide
  (l'orchestratore può farlo da solo, senza cambiare il «Fatto quando»).
- I task degli altri piani si fanno dal loro `PLAN.md`, sul loro ramo. Qui
  si legge solo l'ordine.
- Un task PA tocca solo i file del suo «Tocca». Il suo test, un chiamante,
  un file generato o la pagina di `docs/` che lo descrive si possono
  aggiungere: lo decide l'orchestratore e lo scrive nel registro.

### Il giro di un task grafico

1. **La pelle e i ganci.** Si copia il blocco CSS del simulatore nel file di
   destinazione: è il `<style data-destinazione="…">` in testa a
   `PLAN-ui/fub-pre-alpha/simulatore.html`, e nella stessa sezione il
   prototipo di Scrittoio 2 dà le righe esatte. Le classi nuove entrano in
   `theme/scrittoio/anatomia/<pezzo>.ts`. Le regole vecchie che il blocco
   rifà si tolgono, non si scavalcano: una regola per selettore, e un valore
   per proprietà.
2. **Il tema.** `cd apps/client && npm run theme:generate && npm run
   theme:verify`. I derivati si rigenerano uguali byte per byte; mai a mano.
3. **Il DOM.** Si apre lo stato nel simulatore (lo stato, la luce, la
   larghezza), si preme «DOM» sul pezzo, e si costruisce lo stesso albero
   nel modulo del task: classi, ruoli, ARIA e `data-i18n`. I testi vanno in
   `apps/client/src/i18n/catalog.ts`, con l'inglese.
4. **I fili.** Il pezzo si collega a ciò che c'è già: il contratto
   (`host/contract.ts`), i registri (`DocumentSurfaceRegistry`, i comandi,
   `list_views` e `render_view`), le sessioni (`DocumentSession`) e il kit
   (`kit/`). Il JS «solo simulatore» non si copia mai.
5. **Le prove.**
   - i test di Vitest accanto al modulo;
   - `npm run typecheck`;
   - la scena del banco in `apps/client/bench/scene.mjs`;
   - le foto del banco nelle due luci, a tutta larghezza e a 700, messe
     accanto allo stato del simulatore e guardate;
   - `npm run bench:a11y` per il contrasto e il fuoco.

   Le baseline nuove non si fanno in locale: le prende l'orchestratore dal
   runner.

### Il giro di un task di backend

1. Si legge il proprietario della regola (`docs/map/`,
   `docs/architecture/components-and-boundaries.md`) e la pagina di
   `docs/reference/` del contratto toccato.
2. Si scrive prima il test più basso che fallisce senza la modifica: un test
   unitario accanto, `fub-sdk::testing::MemoryHost` per un provider,
   `fub-testkit` o `crates/fub-host/tests/` per l'host.
3. La modifica più piccola nel proprietario. Mai un lucchetto del workspace
   tenuto durante la chiamata a un provider: si estrae, si lascia, si
   chiama, si rientra.
4. Se la forma attraversa Tauri:
   - `contract.ts`;
   - il mirror e la fixture (`UPDATE_MIRROR=1 cargo test -p fub-app --test
     ts_mirror_app`);
   - `host/fake.ts`;
   - `ipc_permissions` e `lean_ipc`.

   Se attraversa WASM: il Rust e la WIT insieme, e additivo rispetto a
   `wit/frozen/`. Gli `u64` passano come stringhe.
5. `scripts/check.sh --rapido`, poi i test del crate e chi lo usa.

### Copiare o scrivere

- **Si copia** dal simulatore: il CSS dei blocchi, il DOM dei pezzi
  «nuovo» e «cambiato», i testi, gli stati da fotografare.
- **Si copia** da `main`: il DOM dei pezzi «uguale». Lì si cambia solo la
  pelle.
- **Si scrive:** il comportamento, il cablaggio, i test, la scena del banco
  e i comandi.
- **Non si copia mai:** il JS «solo simulatore», gli stili in linea delle
  catture (non ce ne sono), i colori scritti a mano (si usano i ruoli del
  tema).

### Le trappole, e il controllo di ognuna

| Trappola | Il controllo |
|---|---|
| Una pelle che il sanitizer del tema rifiuta spegne lo stile di tutta l'app | `npm run theme:verify`, e `anatomia.test.ts` e `gate.test.ts` |
| Uno stile in linea (`style="…"`, `<style>` in una pagina): Tauri mette un nonce e spegne `unsafe-inline` | `node .github/scripts/check-inline-theme.mjs`; nelle pagine solo `<link>` |
| CodeMirror importato fuori dal pacchetto dell'editor di testo | `node .github/scripts/check-codemirror-boundary.mjs` |
| Un ascoltatore, un timer o un osservatore senza chi lo smonta | `node .github/scripts/check-listeners.mjs`; montare e smontare due volte nel test |
| Un'IPC o una chiamata WASM a ogni tasto | test con un finto host che conta le chiamate; `check-races.mjs` |
| Un mirror TypeScript scritto a mano | `UPDATE_MIRROR=1` col comando scritto in testa al file generato |
| Una baseline visiva fatta in locale | mai: le baseline vengono dal runner Linux (le prende l'orchestratore) |
| Un errore trasformato in stringa (`error.to_string()`) | la variante tipizzata resta; `check-error-literals.mjs` |
| Due worktree con lo stesso `CARGO_TARGET_DIR` | `cargo clean -p fub-abi` prima della verifica finale |
| La cache di Vitest che riempie `/tmp` | `TMPDIR` nella cartella temporanea del lavoro |
| Il vault vero dell'utente o le porte 1431, 1432, 1437 e 1438 | mai: i test usano le fixture e le cartelle temporanee |
| Un campo nuovo del manifest dei temi scritto sul filo anche quando manca | `skip_serializing_if`, e un test che rilegge e riscrive un manifest di oggi byte per byte |
| Un hook congelato tolto o rinominato | `contract-frozen.test.ts` (dopo PA T41); lo snapshot non si riscrive mai |
| Un'icona o un carattere di un tema che arriva da fuori | `PATH_DATA` per le icone, la firma `wOF2` per i caratteri, solo asset del tema; la CSP non cambia |

### Quando fermarsi e chiedere

Il coder si ferma e scrive un blocco nel resoconto, senza inventare, quando:

- il task chiede di cambiare ciò che si vede rispetto al simulatore;
- serve toccare un contratto pubblico che il task non nomina (ABI, WIT,
  comandi IPC, un formato su disco);
- serve una dipendenza esterna nuova o una licenza;
- un test va disattivato, saltato o messo in quarantena;
- il «Fatto quando» non si può raggiungere come è scritto;
- il codice contraddice il piano in un punto che cambia il risultato.

L'orchestratore porta all'utente le domande di «Chiede sempre» di
`DECISIONS.md`, tutte insieme, con la raccomandazione per prima. Il resto lo
decide e lo scrive nel registro.

### Il brief per un coder

```text
Piano: Fub pre-alpha (piano/fub-pre-alpha, PLAN.md) · task PA T<n>
[oppure: piano <nome> (piano/<slug>), task T<n>; l'ordine sta in Fub pre-alpha]
Worktree: <percorso> · ramo base: <ramo> @ <sha>
Leggi: la sezione del task in PLAN.md; «Come si implementa» di Fub pre-alpha;
       per un task grafico, lo stato <stato> del simulatore
       (PLAN-ui/fub-pre-alpha/simulatore.html#stato=<stato>).
Tocca solo: <file del «Tocca»>
Non toccare: <file del «Non toccare»>
Fatto quando: <il «Fatto quando» del task, parola per parola>
Prova: <il comando di «Prova»>; chiudi su scripts/check.sh --rapido verde.
Resoconto: cosa hai fatto, i file, le prove girate e il loro esito, le
           differenze dal testo e perché, ciò che non hai potuto provare.
```

### La verifica

- **Il coder** chiude su `scripts/check.sh --rapido` verde, più la «Prova»
  del task.
- **L'orchestratore**, per ogni task integrato:
  - legge il diff (file generati, duplicati, smontaggi);
  - fa girare la «Prova» sul ramo integrato;
  - spinge sulla PR bozza e aspetta la CI corta.
- **A fine piano:** la CI completa (la PR pronta), con Windows e macOS.
- **Un `SALTA`** di `check.sh` non è una prova: il resoconto lo dice.
- **Per un task grafico** ci sono anche le foto del banco accanto al
  simulatore, nelle due luci, a tutta larghezza e a 700. Le differenze si
  spiegano o si correggono.

## Differenze fra piani e codice

Verificate il 2026-11-05. Dove il piano e il codice non dicono la stessa
cosa, vince il codice.

1. **K3-IPC T8 (#296)** è unito nel ramo `piano/k3-motori` (2026-11-02), non
   in `main`: arriva con #295.
2. **Griglia.** Il prototipo `celle-griglia.html` non ha una riga
   «Approvato» nel piano (D2).
3. **N6.** Mancano i prototipi di T26–T28; è approvato solo `lavagna-schede`
   (T25, 2026-11-04) (D3).
4. **N6 «v1 senza T79».** T80–T84 dipendono da T79 e da PdfCraft P1, P2 e
   P4, e T85 dipende da T82: escono con T79. Esce anche T88, che dipende da
   D-20 (il piano dei CSV, che non c'è).
5. **Il finto del banco** (`bench/fake-ipc.ts`) non ha `appearance.motion`,
   che l'host ha (`crates/fub-host/src/settings.rs`, «Animazioni»): la foto
   approvata delle impostazioni di S2 non mostra la riga (PA T1).
6. **S2 T11** porta il corpo a 18 e la misura a 58ch, mentre il finto del
   banco dice 17 e 68. La foto approvata di S2 mostra 17; il simulatore
   scrive 18, il valore di S2 T11. È l'unica differenza fra il simulatore e
   il prototipo approvato (265 px nello stato `impostazioni`).
7. **Scrittoio 2 avanza:** T1, T2 e T16 sono fatti su `piano/scrittoio-2`
   (fe4d84c4).
8. **#216** è corretto in `main` (1d20ce96, 2026-10-19: `closeLeftVault` in
   `state/vault-session.ts`), e **#97** pure (0f39a80a), ma le due issue sono
   ancora aperte.
9. **«Il blocco di scrittura in sola lettura».** DECISIONS (N7, 2026-11-04)
   diceva «va in un'issue e nel resoconto», ma l'issue non è mai stata
   aperta. Il caso è in `FubSession::invoke_command`: `workspace.write_turn()`
   si prende per ogni comando di un provider, anche in sola lettura (PA T3).
10. **I sei errori di tipo** si riproducono con `tsc --noEmit` su
    `anteprima/tutto` (5006937c):
    - in N4, `ink-record.test.ts` (due) e `ink-vectors.test.ts`:
      `parseCanvas` e `serializeCanvas` non sono più in
      `editors/canvas/model.ts` dopo N3;
    - in K5, `motore/colori.test.ts`, `gesti.test.ts` e
      `sessione.test.ts`: il finto `DocumentSessionApi` non ha
      `openDocument` né `documentClosed`.

    Sono rami indietro rispetto a `main` (PA T2).
11. **I documenti.** `docs/project/status.md` è fermo al 2026-10-31 e dice
    «in pila» per cose unite. L'ADR 0230 non esiste su nessun ramo (il
    numero è saltato); la 0236 sta su `piano/k3-motori` (PA T18).
12. **La griglia di notte.** In Notte la griglia del foglio lascia bianco a
    destra dell'ultima colonna, anche nella foto approvata di S2
    (`foglio-dark`). In `main` la griglia arriva al bordo. È da guardare in
    S2 T20 e nella griglia; non viene dal simulatore.
13. **Il vassoio.** S2 dice «T16 resta com'è, se ne riparla» sulla fila e
    sulla colonna, ma T16 (68f48788) le ha già messe sul vassoio più chiaro
    (`--bar-tray`) (D6).

Le differenze trovate nel secondo giro (2026-11-05), fra la richiesta
dell'utente, il primo giro e il codice:

14. **La Lettura di una nota non è `view`.** La richiesta dice che la
    Lettura è la modalità `view` di `editors/core/bootstrap.ts:156`. Per una
    nota Markdown è la modalità `reading`
    (`editors/text/profiles/markdown/surface.ts:112`); `view`, a
    `bootstrap.ts:156`, sono i visori (`VIEWER_MODES`: il PDF e gli altri).
    La Lettura disegna già il buffer, anche non salvato (`redrawReading`,
    `state/document-controller.ts:2437`). PA T5 nomina `surface.ts`.
15. **R01 è già gestito in un caso.** `release()` prova a salvare e a
    scrivere la bozza e restituisce `CloseResult`
    (`state/document-session.ts:154`, `:1496`); `dismissIfUnwatched` chiede
    con `document.close_unsaved` (`keepOrDiscardUnsaved`,
    `state/document-controller.ts:1672`). Tre chiamanti ignorano il
    risultato: `state/shell-layout.ts:30`,
    `state/document-bridge.ts:350` e `state/document-controller.ts:2749`.
    Se lì si perde testo, lo deve dimostrare un test (PA T4).
16. **R02 passa da codice morto.** `forceReload()`
    (`state/document-session.ts:503`) mette `dirty = false` dopo aver
    ricaricato dal disco, ma il suo unico chiamante, `reloadCurrent()`
    (`state/document-controller.ts:2948`, ripreso in `panels/document.ts:128`),
    non ha chiamanti in `main`. Il ripristino di una versione vero passa da
    `crates/fub-features/src/versioning.rs` (`version.restore`), che
    riscrive il file: il client lo vede come una modifica dal disco (PA T4).
17. **L'MSI e il quarto numero.** La richiesta dice che Windows ignora il
    quarto numero, e quindi `0.2.0.1` e `0.2.0.2` sarebbero la stessa
    versione. Vale per un `MajorUpgrade` senza permessi; il modello di
    Tauri (`main.wxs` di tauri-bundler 2.10.4) ha `Product Id="*"` e un
    `MajorUpgrade` con `AllowDowngrades="yes"` (di serie,
    `allowDowngrades: true`) o `AllowSameVersionUpgrades="yes"`: in tutti e
    due i casi l'installer nuovo toglie quello vecchio, qualunque sia il
    quarto numero. `0.2.0.N` quindi aggiorna; PA T23 lo prova su Windows, e
    se non va le note dicono «disinstalla prima» (PA T22).
18. **Il controllo degli aggiornamenti non vede le pre-release.**
    `crates/fub-host/src/updates.rs:28` chiede `releases/latest`, che GitHub
    dà senza le pre-release; e l'ordine delle versioni confronta
    l'identificatore di prerelease come testo (`prealpha.10` < `prealpha.2`)
    (PA T25).
19. **#308 è in `main`** (il caricamento, 2026-11-05).
20. **L'MCP non ha una faccia sua.** Nelle Impostazioni non c'è una sezione
    «Automazione» o «MCP»: le schede sono `settings`, `components`,
    `shortcuts`, `vault` e `about`. Il primo giro di PA T23 chiedeva una
    proposta MCP «vista e accettata in Fub», che nessun task costruisce:
    ora T23 prova i flussi che ci sono, e la nota proposta dall'AI va ad A1
    F5, fuori.
21. **K2 D-2.** Il primo giro aveva spostato la prova con una persona dopo
    il merge di #290, contro K2 D-2, senza chiedere (D13).
22. **I 42 file `.rs` di N1** non sono resti da togliere: FubDraw è il nome
    del formato (ADR 0203), e restano per compatibilità il namespace `fub:`,
    `Status::Fubdraw` e `fubdraw://live`. Le persone vedono il nome in tre
    stringhe del Rust (i due descrittori di `fub-format-svg` e la diagnosi
    S002 di `fub-scene`) e in una quarantina di stringhe del client, in
    italiano e in inglese: `i18n/catalog.ts` (`vector.*`,
    `live.not_editable`), `editors/spatial/strings.ts`,
    `editors/spatial/import/strings.ts` e `editors/spatial/scene/diagnostics.ts`.
    Che cosa dire al posto del nome lo chiede D14 (PA T33).
23. **K3 è avanti.** Il primo giro diceva 17 di 19 con T18 integrato: T18 è
    fatto, e T17 ha la CI completa verde e aspetta solo il sì dell'utente.
24. **`aggiorna.sh` non è nel repository.** Sta in
    `~/Progetti/fub-archivio/motori-upstream` e gira col cron del server
    ogni lunedì; K10 lo porterà in `vendor.mjs` (decisione di «Fub a
    componenti», K10).
25. **Le maniglie dei Blocchi hanno già la tastiera e il tasto destro.** Il
    primo giro le dava senza fuoco e senza menu proprio: in `main` sono
    `<button>` che Tab raggiunge, e il tasto destro sulla maniglia apre il
    menu del blocco (`blocks/handles.ts`). PA T32 resta solo per la pagina
    del PDF.
26. **«FubDraw» si legge in una quarantina di frasi**, non in tre: il primo
    giro aveva guardato solo il Rust. Ora c'è D14.
27. **S8.** Il menu «/» non ha uno scenario nel banco WebView (S1–S7, R1,
    T1, I1, L1): PA T16 lo aggiunge. S4, S5 e S6 ci sono in `run.mjs` ma il
    job `webview` della CI non li fa girare.

Le differenze trovate con la richiesta della skin facile (2026-11-05,
verificate su `main` 638358da):

28. **La pelle di un tema è tutto o niente.** `replaceTheme`
    (`theme/loader.ts`) toglie la pelle di serie e mette quella del tema; un
    tema senza `skin.css` monta solo il foglio. Per questo il kit autore
    parte da una copia intera (`sample/skin.css`, 18.222 righe; la pelle di
    serie ne ha 18.145 in 23 file) (PA T34, T35).
29. **Il contratto si muove più di quanto dice la richiesta.**
    `apps/client/theme/author/contract.json` è cambiato in 12 commit dal 29
    ottobre al 4 novembre, non 11. L'unico script che lo legge, `check-inline-theme.mjs`, non ferma un hook
    tolto (PA T41).
30. **Installare da cartella c'è già nell'host,** ma solo i test lo usano:
    `install_theme` (`crates/fub-host/src/theme.rs:1932`) non ha un'IPC.
    Le Impostazioni installano solo dal catalogo firmato (PA T36).
31. **La fiducia «In sviluppo» c'è già:** `development` sta in
    `TRUST_LABELS` (`ui/permissions.ts:103`), ma nessun tema la usa (PA
    T37).
32. **Non c'è una modalità sviluppatore:** nessuna chiave in
    `crates/fub-host/src/settings.rs` (PA T36).
33. **I cataloghi per chi scrive un tema ci sono già,** nel banco:
    `bench/catalog.ts` dice di essere «la pagina di prova che si consegnerà
    a chi scriverà un tema» (PA T38 la porta nell'app).
34. **Le icone passano da un registro solo che valida già:** la mappa di
    serie, gli alias e `registerIcon` accettano solo tracciati
    (`PATH_DATA`). La richiesta diceva «stanno nel codice»: è vero, ma il
    registro è già la porta giusta per un set del tema (PA T40).
35. **La CSP ammette già i caratteri da URL `data:`** (`font-src 'self'
    asset: data:`, `crates/fub-app/tauri.conf.json`), e `materializeAssets`
    fa già degli asset URL `data:`: i caratteri del tema non toccano la CSP
    (PA T39). Il `mimeType` del loader però non conosce `woff2`.
36. **Il README del kit autore** parte dalla copia intera di `sample/`; con
    PA T42 parte dai due temi d'esempio.

## T1 · Il finto del banco dice le impostazioni d'Aspetto dell'host

Perché: l'host ha «Animazioni» (`appearance.motion`) nel gruppo Aspetto, e
il finto del banco no. Così le foto delle impostazioni non mostrano la
riga, mentre il simulatore sì (stato `aspetto`, differenza 5).
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/fake-ipc.ts`, `apps/client/bench/fake-english.ts`,
`apps/client/bench/fake-ipc.test.ts` (nuovo).
Non toccare: i valori di corpo e misura (17 e 68: li cambia S2 T11, che
tocca anche `fake-ipc.ts`, quindi i due task non vanno insieme);
`crates/fub-host/src/settings.rs`; le baseline visive.
Dipende da: #295 in `main`. K3 (d90a09d0) cambia `bench/fake-ipc.ts`
(`WORKBOOK_CHROME`): prima di #295 i due si scontrano. Non insieme a S2 T11.
Cosa fare:
- Parti da `main` con #295 dentro.
- Leggi in `crates/fub-host/src/settings.rs` tutte le voci del gruppo Aspetto
  (`C_GROUP_APPEARANCE`) e confrontale con quelle del finto. Le chiavi del
  finto oggi sono: `chrome.compactness`, `appearance.theme`, `.contrast`,
  `.density`, `.body`, `.measure`, `.font`, `.accent` e `.zoom`.
- Aggiungi quelle che mancano, nello stesso ordine dell'host, con le
  etichette e le descrizioni italiane del catalogo vero.
  `appearance.motion` è una scelta: di serie «come il sistema»
  (`fub_kernel::locale::AS_SYSTEM`), poi `calm` e `reduced`.
- In `fake-english.ts` aggiungi le traduzioni prese dai cataloghi Rust.
- `fake-ipc.test.ts`: le impostazioni del finto hanno `appearance.motion`
  con le tre scelte, e le chiavi del gruppo Aspetto sono quelle elencate nel
  test, nell'ordine dell'host.
- Le foto delle impostazioni cambiano (una riga in più): lo dici nel
  resoconto, e le baseline le prende l'orchestratore dal runner.
Casi limite: la shell in inglese (`fake-english.test.ts` resta verde);
`appearance.motion` già scelto nel `localStorage` del banco.
Fatto quando: `npx vitest run bench/fake-ipc.test.ts bench/fake-english.test.ts`
passa; la foto della scena delle impostazioni mostra «Animazioni» come lo
stato `aspetto` del simulatore.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run bench/
Stato: [ ] da fare

## T2 · N4 e K5 allineati a `main`, e i sei errori di tipo

Perché: sull'anteprima `tsc --noEmit` dà sei errori nei test di N4 e di K5,
perché i due rami sono indietro rispetto a `main` (N3, i documenti che si
chiudono). Vanno chiusi prima che N4 e K5 riprendano (differenza 10).
Ramo: `piano/n4-inchiostro` e `piano/k5-disegno` (non questo ramo). Il
merge di `main` nei due rami lo fa l'orchestratore; il coder corregge i
test.
Tocca: su N4, `apps/client/src/editors/canvas/ink-record.test.ts` e
`ink-vectors.test.ts`; su K5, `apps/client/src/editors/spatial/motore/colori.test.ts`,
`gesti.test.ts` e `sessione.test.ts`.
Non toccare: il codice di produzione dei due rami; `editors/canvas/model.ts`
(il nucleo è di N3, in Rust); `state/document-session.ts`.
Dipende da: #295 in `main` (K5 T6 vuole «K3 fuso e main unito in K5»).
Cosa fare:
- L'orchestratore unisce `origin/main` in ognuno dei due rami (merge, mai
  rebase forzato) e risolve i conflitti banali.
- N4: `parseCanvas` e `serializeCanvas` non sono più in `./model`. Trova con
  `git log -S parseCanvas origin/main` dove sono andati e come leggono e
  scrivono un `.canvas` i test di `main` dopo N3, e fai lo stesso nei due
  test, senza cambiare ciò che provano.
- K5: il finto `DocumentSessionApi` dei tre test aggiunge `openDocument` e
  `documentClosed`, con la forma dei finti dei test di `main` (cerca
  `documentClosed:` in `apps/client/src/**/*.test.ts`).
Casi limite: un test che passava solo con la vecchia forma del modello (va
detto, non ammorbidito); i conflitti di merge in `DECISIONS.md` (si tengono
le righe di tutti e due).
Fatto quando: `cd apps/client && npm run typecheck` è pulito su tutti e due
i rami; i test di N4 e di K5 sono verdi.
Prova: scripts/check.sh --rapido (su ogni ramo)
Stato: [ ] da fare

## T3 · I comandi in sola lettura non tengono il turno di scrittura

Perché: `FubSession::invoke_command` prende `workspace.write_turn()` per
ogni comando di un provider, anche in sola lettura. Un comando lungo che
legge (l'anteprima di un file Craft grande, `canvas.read` della lavagna in
codice, gli strumenti MCP che leggono) ferma i salvataggi di chi scrive.
Nella pre-alpha l'AI legge mentre la persona scrive. È il punto sciolto «il
blocco di scrittura in sola lettura» (differenza 9).
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/session.rs` (`invoke_command`),
`crates/fub-host/tests/read_only_command_turn.rs` (nuovo),
`docs/architecture/runtime-events-and-jobs.md`.
Non toccare: `crates/fub-host/src/custody.rs` (il turno resta com'è);
`fub-kernel`; il `Guard` della sola lettura (`ReadOnly`); i comandi
`FOLDER_CREATE` e gli altri trattati prima del turno.
Dipende da: nessuno.
Cosa fare:
- Scopri come l'host sa che un comando è in sola lettura. La
  `CommandSpec` del provider ha `CommandScope::read_only()`, e
  `prepared.read_only_reason()` dice perché il comando gira sotto
  `ReadOnly`. Verifica nel codice di `prepare_provider_command` se le due
  cose coincidono, e scrivilo nel resoconto.
- Per un comando in sola lettura: niente `write_turn()`. Lo prepari sotto
  `workspace.write()`, lo lasci, lo chiami sotto `Guard::new(host,
  ReadOnly { why })` come oggi, e lo finisci sotto `workspace.write()`. Per
  gli altri comandi non cambia niente.
- Se `finish_provider_command_deferred` può scrivere qualcosa anche per un
  comando in sola lettura, fermati e scrivi il caso nel resoconto.
- Il test, con un provider di prova come in `injected_backends.rs`:
  - un comando in sola lettura che si ferma su un canale;
  - mentre è fermo, `write_document` da un altro thread finisce entro un
    secondo;
  - poi il comando riparte e finisce bene.
- Il controllo negativo: un comando che scrive tiene ancora il turno, e una
  seconda scrittura aspetta.
- La pagina di `docs/`: chi prende il turno e chi no.
Casi limite: un comando in sola lettura che prova a scrivere (rifiutato da
`ReadOnly`, come oggi); un comando in sola lettura che finisce in errore; il
vault chiuso mentre il comando gira; un comando che non esiste.
Fatto quando: `cargo test -p fub-host --test read_only_command_turn` passa,
e senza la modifica il primo test va oltre il tempo; i test di `fub-host`
restano verdi.
Prova: scripts/check.sh --rapido; cargo test -p fub-host
Stato: [ ] da fare

## T4 · #237 R01 e R02: chiudere e ripristinare non perdono il testo

Perché: #237 chiede di dimostrare con un test se R01 e R02 perdono ancora
testo, e di correggere solo ciò che si riproduce. Il codice ne fa già una
parte (differenze 15 e 16):
- `release()` prova il salvataggio e la bozza e restituisce `CloseResult`
  (`state/document-session.ts:154`, `:1496`); con il buffer ancora sporco
  dà `unsaved` e la sessione resta aperta;
- `dismissIfUnwatched` gestisce `unsaved` con il dialogo
  `document.close_unsaved` (`keepOrDiscardUnsaved`,
  `state/document-controller.ts:1672`);
- tre chiamanti ignorano il risultato di `release()`:
  `state/shell-layout.ts:30` (un riquadro che si chiude),
  `state/document-bridge.ts:350` (la finestra di un documento che si
  chiude) e `state/document-controller.ts:2749` (nel `finally` di
  un'apertura);
- `forceReload()` (`state/document-session.ts:503`) mette `dirty = false`
  dopo aver riletto il disco. Il suo unico chiamante, `reloadCurrent()`
  (`state/document-controller.ts:2948`, ripreso in
  `panels/document.ts:128`), non ha chiamanti: il ripristino vero di una
  versione passa da `version.restore` (`crates/fub-features/src/versioning.rs`),
  che riscrive il file sotto al buffer.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/state/document-session.ts` (`forceReload`),
`apps/client/src/state/document-controller.ts` (`reloadCurrent`, e i
chiamanti di `release` solo se un test lo chiede),
`apps/client/src/state/shell-layout.ts` e
`apps/client/src/state/document-bridge.ts` (solo se un test lo chiede),
`apps/client/src/panels/document.ts` (solo la riga 128, che riprende
`reloadCurrent`), `apps/client/src/state/document-session.test.ts`,
`apps/client/src/state/document-bridge.test.ts`,
`apps/client/src/panels/document.test.ts` (il chiamante del controller e il
ripristino passano dal pannello), `docs/architecture/document-model.md`.
Non toccare: il catalogo dei testi (nessun testo nuovo: niente
`demo.unsaved`); l'host; il formato delle bozze su disco; il dialogo
`document.close_unsaved`.
Dipende da: nessuno.
Cosa fare:
- **R01, prima la prova.** Nel finto host (`host/fake.ts`), un test per
  ognuno dei tre chiamanti: una nota con testo non salvato, salvataggio e
  bozza che falliscono, poi il gesto (chiudere il riquadro, chiudere la
  finestra, l'apertura che finisce). Dopo il gesto: la sessione è viva e
  sporca, riaprire la nota mostra il testo, la bozza c'è appena il finto la
  lascia scrivere.
  - Se nessuno perde testo, R01 si chiude con questi test: scrivi nel
    resoconto «non riprodotto» e il testo del commento per #237.
  - Se uno perde testo, quel chiamante passa da `keepOrDiscardUnsaved`, come
    `dismissIfUnwatched`. Niente avviso nuovo, niente copia segreta altrove.
- **R02, prima la prova.** Un test con testo non salvato e un ripristino di
  versione dalla vista della cronologia (`version.restore`, poi
  `restore_confirm`) che riscrive il file nel finto host: il testo della
  persona resta, e la nota passa in conflitto (o in «cambiata sul disco»),
  come per ogni modifica da fuori. Se il testo si perde, correggi quel
  percorso e fermati prima di toccare altro.
- **R02, il codice morto.** Togli `reloadCurrent()` e la sua ripresa in
  `panels/document.ts:128`. Rendi `forceReload()` sicura per chi la
  userà: se la sessione è sporca, prima `flushDraft()`; se la bozza
  fallisce, restituisce `unavailable` e lascia testo e stato com'erano.
  Aggiorna il test di `document-session.test.ts:246` («la ricarica forzata
  pulisce e aggiorna il testo autorevole»), che oggi scarta per scelta.
Casi limite: la bozza che riesce e il salvataggio no (si chiude, il testo è
in bozza); due chiusure di fila; il vault che cambia mentre si chiude; un
documento in sola lettura (niente da salvare); una finestra chiusa mentre il
dialogo `document.close_unsaved` è aperto.
Fatto quando: i test dei tre chiamanti e quello del ripristino ci sono e
passano; se uno falliva prima, la correzione lo fa passare; il test di
`forceReload` prova che una bozza fallita lascia il testo; i test di
`state/` restano verdi; `document-model.md` dice che cosa succede al testo
non salvato quando un riquadro, una finestra o un ripristino lo toccano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/state/ src/panels/
Stato: [ ] da fare

## T5 · #237 R03: il conflitto e la Lettura dicono quale versione si vede

Perché: con un conflitto aperto il buffer non si può salvare. Non è
dichiarato se la Lettura mostra il testo della persona o la versione sul
disco.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/panels/document.ts` (`drawConflict`, :1225),
`apps/client/src/state/document-session.ts` (solo se serve esporre lo
stato), `apps/client/src/editors/text/profiles/markdown/surface.ts` (la
Lettura di una nota è la modalità `reading`, :112; `view` in
`editors/core/bootstrap.ts:156` sono i visori, non questa),
`apps/client/src/state/document-controller.ts` (`redrawReading`, :2437,
che disegna già il buffer), i loro test, `apps/client/src/i18n/catalog.ts`,
`docs/architecture/editor-surfaces.md`.
Non toccare: i comandi di risoluzione del conflitto (ci sono e restano);
l'host.
Dipende da: T4 (stessi file di stato: dopo, non insieme).
Cosa fare:
- Prima un test che fissa ciò che succede oggi: in conflitto, si passa in
  Lettura; quale testo si vede, e la fascia del conflitto c'è?
- La regola: la Lettura mostra **il testo della persona** (lo stesso di
  Live, perché è la stessa sessione), e la fascia del conflitto resta, con
  le sue azioni. Nella fascia, in Lettura, una riga dice «Stai leggendo la
  tua versione, non ancora salvata» (testo nuovo nel catalogo, con
  l'inglese).
- Se oggi la Lettura mostra la versione sul disco, il cambio è visibile:
  fermati e scrivilo nel resoconto. L'orchestratore lo chiede all'utente
  con lo stato `conflitto` del simulatore.
Casi limite: il conflitto risolto mentre si è in Lettura (la riga sparisce);
un file in sola lettura; due riquadri sulla stessa nota, uno in Live e uno
in Lettura.
Fatto quando: il test prova il testo mostrato e la riga, in conflitto e
dopo la risoluzione; la foto della scena del conflitto in Lettura sta
accanto allo stato `conflitto` del simulatore.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/panels src/state
Stato: [ ] da fare

## T6 · #289: `fub:abi@0.2.0` congelata, e la guardia stretta

Perché: con la pre-alpha `fub:abi@0.2.0` diventa pubblicata. #289 chiede di
congelarla prima del primo rilascio, e di stringere `wit_additivity`. Oggi
la guardia accetta un campo in coda a un record; contro uno snapshot
congelato, i campi dei record che attraversano il confine devono essere
uguali. Nessun piano dentro tocca `abi.wit` (verificato), quindi si può
fare subito.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-abi/wit/frozen/0.2.0.wit` (nuovo),
`crates/fub-abi/wit/frozen/README.md`, `crates/fub-abi/tests/wit_additivity.rs`,
`docs/reference/abi-and-wit.md`.
Non toccare: `crates/fub-abi/wit/fub/abi.wit`; `0.1.0.wit` e `0.1.1.wit`;
l'ADR 0235.
Dipende da: nessuno.
Cosa fare:
- `0.2.0.wit` è la copia di `wit/fub/abi.wit` di adesso, come per le
  versioni prima (`package fub:abi@0.2.0;`).
- `wit_additivity.rs` confronta `abi.wit` anche con 0.2.0. Contro 0.2.0 un
  record che attraversa il confine ha gli stessi campi, nello stesso
  ordine: niente prefisso.
- Un test della guardia su testi WIT finti: un campo in coda a un record
  congelato fa fallire; una funzione nuova, un'interfaccia nuova o un tipo
  nuovo passano.
- `abi-and-wit.md` («Compatibilità»): 0.2.0 è congelata, e la regola nuova
  vale per i record. Il resto della sezione lo scrive T7.
Casi limite: un record usato solo dentro l'host (non attraversa: la guardia
lo sa?); i commenti e gli spazi in `abi.wit` (non contano).
Fatto quando: `cargo test -p fub-abi --test wit_additivity` passa, e il caso
finto del campo in coda fallisce come atteso.
Prova: scripts/check.sh --rapido; cargo test -p fub-abi
Stato: [ ] da fare

## T7 · #289: «nuovo caso» e «nuova funzione», con un componente vero

Perché: #289 chiede di provare con un componente compilato prima della
modifica se un caso nuovo in un `enum` o in un `variant`, e una funzione
nuova in un'interfaccia esportata dal plugin, lo lasciano caricare. La
regola di «Compatibilità» dipende dalla risposta.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-wasm-host/tests/new_case_and_function.rs` (nuovo), i
componenti di prova accanto (come quelli di
`crates/fub-wasm-host/tests/published_record_does_not_grow.rs`),
`docs/reference/abi-and-wit.md`.
Non toccare: `wit/fub/abi.wit` e `wit/frozen/`; l'ADR 0235 (se la regola
cambia, l'orchestratore chiede prima di toccarla).
Dipende da: T6.
Cosa fare:
- Copia il giro di `published_record_does_not_grow.rs`: un guest compilato
  contro la WIT di prima, e un host con la WIT cresciuta.
- Caso 1: un caso nuovo in un `enum` o `variant` usato da un'interfaccia
  esportata dal plugin. Il guest vecchio si carica e funziona? E quando
  l'host gli manda il caso nuovo?
- Caso 2: una funzione nuova in un'interfaccia esportata dal plugin. Il
  guest vecchio si carica?
- I test dicono il risultato com'è, anche se è «no». La pagina scrive che
  cosa è additivo per un plugin già compilato e che cosa no.
Casi limite: il caso nuovo mandato a un guest vecchio (trap? errore
tipizzato?); un componente che non si compila sul runner (il test lo dice,
non salta in silenzio).
Fatto quando: `cargo test -p fub-wasm-host --test new_case_and_function`
passa e prova i due casi; «Compatibilità» in `abi-and-wit.md` li dice; le
voci di #289 sono spuntate nel resoconto.
Prova: scripts/check.sh --rapido; cargo test -p fub-wasm-host (col `PATH` di
`CLAUDE_DEVICE.md`: costruisce i componenti con cargo)
Stato: [ ] da fare

## T8 · La pagina della cornice del telefono

Perché: in `docs/` manca una pagina che descriva la cornice del telefono:
dove sta, quando parte, che cosa cambia rispetto al computer. L'APK di
prova la rende visibile, e Scrittoio 2 la cambia (T3, T4, T5, T7, T11,
T27).
Ramo: piano/fub-pre-alpha.
Tocca: `docs/architecture/phone-frame.md` (nuovo), `docs/README.md`,
`docs/architecture/components-and-boundaries.md` (un rimando),
`docs/map/` (la voce, se la mappa elenca le pagine).
Non toccare: il codice; `mobile.css`.
Dipende da: nessuno.
Cosa fare:
- Descrivi la cornice com'è in `main`, verificata nel codice:
  - `apps/client/src/shells/scrittoio/mobile/` e `mobile.css`;
  - la larghezza sotto cui parte la shell del telefono (oggi 800 px, da
    verificare) e quella «in piedi» (599 px);
  - `bench/fake-mobile-bridge.ts`;
  - `crates/fub-app/tauri.android.conf.json` e `cfg(desktop)`;
  - `mobile.yml` (l'APK di debug).
- Una sezione «Scrittoio 2» dice che la cornice cambia coi suoi task, e che
  ogni task che la cambia aggiorna questa pagina.
- Una sezione «Che cosa non c'è»: il telefono è provvisorio (domanda D1).
Casi limite: ciò che la pagina vorrebbe dire ma il codice non fa (si
scrive com'è, non come sarà).
Fatto quando: le guardie dei documenti passano (`check-doc-links`,
`check-doc-orphans`, `check-doc-size`, `check-markdown-style`,
`check-prose`, `check-tables`).
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T9 · Su Windows il tempo scaduto ferma anche i figli della CLI Craft

Perché: su Windows, quando il tempo scade, oggi si ferma solo la CLI Craft
e non i suoi figli. Serve un job object, cioè `windows-sys` come
dipendenza diretta. Parte solo se la risposta a D7 è A.
Ramo: piano/fub-pre-alpha.
Tocca: `Cargo.toml` (la dipendenza del workspace, solo per
`cfg(windows)`), `crates/fub-host/Cargo.toml`,
`crates/fub-host/src/craft/launch.rs`, `deny.toml` (solo se serve), la
pagina di `docs/` che oggi dice il limite (cercala per «job object»).
Non toccare: il comportamento su Linux e macOS (`kill_process_group` di
rustix); `Cargo.lock` oltre a ciò che la dipendenza diretta cambia.
Dipende da: la risposta a D7.
Cosa fare:
- `windows-sys` alla versione che il lockfile ha già (0.61.2), con le sole
  feature che servono (`Win32_System_JobObjects`, `Win32_Foundation`,
  `Win32_System_Threading`).
- In `launch.rs`, su Windows: la CLI nasce in un job object con
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Il tempo scaduto chiude il job, e
  tutti i figli con lui.
- Un test `#[cfg(windows)]` che lancia un programma di prova che lancia un
  figlio: allo scadere del tempo non resta nessuno dei due. Gira solo nella
  CI Windows.
- `cargo deny check` passa.
Casi limite: Fub già dentro un job (Windows 8+ ammette i job annidati); la
CLI che esce da sola prima del tempo; il job che non si crea (errore
tipizzato, e la CLI non parte).
Fatto quando: il test Windows è verde nella CI completa; la pagina non dice
più il limite.
Prova: scripts/check.sh --rapido (qui il test Windows non gira: lo dice
il resoconto); CI completa
Stato: [ ] da fare (aspetta D7)

## T10 · I due punti sciolti da ritrovare

Perché: «una stringa inglese nel fake host» e «il conto dei diagrammi
Mermaid» sono nella lista dei punti sciolti, ma non li ho trovati (D10).
Ramo: piano/fub-pre-alpha.
Tocca: lo dice la risposta a D10; senza risposta, solo il registro di
`DECISIONS.md`.
Non toccare: le baseline; `check-mermaid.mjs`, se non è il posto del
difetto.
Dipende da: la risposta a D10.
Cosa fare:
- Con la risposta: riproduci, correggi nel proprietario, aggiungi il test
  che fallisce prima.
- Senza risposta (D10 B):
  - la stringa: la shell in italiano sul banco; cerca in tutte le scene
    (`bench/scene.mjs`) un testo inglese che venga dal finto (`fake-ipc.ts`,
    `fake.ts`), e confronta con `fake-english.ts`;
  - i diagrammi: confronta i blocchi contati da `check-mermaid.mjs` con
    quelli resi davvero (`--render`) e con ogni numero scritto nei documenti
    o nel CHANGELOG.

  Se non si riproduce niente, scrivilo nel registro, e il punto si chiude
  come «non riprodotto».
Casi limite: un testo inglese che viene dal contenuto del vault (non è un
difetto).
Fatto quando: un test che falliva passa, oppure il registro dice «non
riprodotto» con le prove fatte.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare (aspetta D10)

## T11 · Il vassoio delle barre

Perché: è la scelta di D6 sul vassoio della fila e della colonna. Con la A
non c'è niente da fare, e il task si chiude come «non serve».
Ramo: piano/fub-pre-alpha.
Tocca:
- con B: `apps/client/src/theme/scrittoio/skin/kit.css` (le regole
  `.kit-bar` e `.kit-rail`);
- con C: anche `crates/fub-host/src/settings.rs` (una chiave nuova
  `appearance.bars`, scelta `light` o `marked`, di serie `light`), il
  modulo che applica le altre scelte d'Aspetto sulla radice (lo stesso di
  `appearance.density`), `bench/fake-ipc.ts`, `apps/client/src/i18n/catalog.ts`
  e i test di quei moduli.
Non toccare: `recipe.ts` (`--bar-tray` resta com'è); la barra a schede, che
resta sul vassoio chiaro.
Dipende da: la risposta a D6; S2 T20 in `main`.
Cosa fare:
- B: la fila e la colonna prendono `var(--sheet-2)`, e restano i foglietti
  alzati di notte.
- C: con `marked`, tutte e tre le barre prendono `--sheet-2`. Il valore sta
  sulla radice come un attributo (per esempio `data-bars="marked"`), letto
  dalla pelle; il sanitizer lo deve accettare (`npm run theme:verify`). La
  riga «Le barre» in Impostazioni › Aspetto, dopo «Densità».
- Per C, prima di scrivere: lo stato `aspetto` e uno con la barra di
  formato, nel simulatore, con le due varianti, mostrati all'utente
  dall'orchestratore.
Casi limite: il contrasto alto (resta il bordo pieno); un tema `theme-2`
senza `--bar-tray`; la colonna sulla scrivania del disegno.
Fatto quando: le foto del banco della barra di formato, del PDF e del
disegno, nelle due luci, mostrano la variante scelta; `npm run bench:a11y` è
verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:verify
Stato: [ ] da fare (aspetta D6)

## T12 · #237 R04: la griglia e le modifiche che vengono da fuori

Perché: `GridEngine.syncDoc()` applica una riscrittura che viene da fuori
anche mentre una cella è aperta e non confermata, o c'è un annulla in
sospeso. La digitazione in corso non deve sparire senza spiegazione, e un
annulla non deve far tornare dati vecchi.
Ramo: piano/fub-pre-alpha (dopo che la griglia è in `main`).
Tocca: `apps/client/src/editors/grid/engine.ts` (`syncDoc`),
`apps/client/src/editors/grid/engine.test.ts`, `apps/client/src/i18n/catalog.ts`,
`docs/architecture/grid-surface.md`.
Non toccare: `fub-format-xlsx`; la cella aperta di griglia T4 (si usa com'è);
`grid-motion.ts`.
Dipende da: griglia T4 in `main`.
Cosa fare:
- Prima due test che riproducono: una cella aperta con testo battuto, poi
  `syncDoc` con un altro testo; e un annulla dopo `syncDoc`.
- La regola:
  - la cella aperta tiene ciò che si sta battendo;
  - il resto del foglio prende la versione nuova;
  - alla conferma, la cella scrive sopra il valore nuovo di quella sola
    cella;
  - un avviso dice «Il file è cambiato fuori da Fub mentre scrivevi: il
    resto del foglio è aggiornato» (testo nuovo, con l'inglese).
- La storia dell'annulla di prima della riscrittura si svuota, e l'avviso
  lo dice: un annulla non riporta i dati di prima.
Casi limite: la riscrittura che cancella la riga della cella aperta (la
cella si chiude, e il testo battuto va negli appunti con l'avviso); due
riscritture di fila; un foglio in sola lettura.
Fatto quando: i due test falliscono prima e passano dopo; i test della
griglia restano verdi.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/grid
Stato: [ ] da fare

## T13 · Il corpus senza perdite

Perché: è il «Fatto quando» 4. Per ogni formato della pre-alpha, aprire e
chiudere non cambia un byte. Il conflitto e la sola lettura non toccano il
file. Una modifica a un formato di testo cambia solo ciò che si è
modificato. Entra presto, così ogni piano che si unisce lo deve tenere
verde.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/tests/prealpha_corpus.rs` (nuovo),
`tests/fixtures/prealpha-corpus/` (nuovo, con un `README.md` che dice da
dove viene ogni file), `docs/development/testing-and-quality.md`.
Non toccare: i corpus che ci sono (si copiano i file, non si spostano);
i provider.
Dipende da: nessuno. Quando K5 e N4 entrano, il loro task di chiusura
aggiunge al corpus un disegno del motore e una lavagna con l'inchiostro
(l'orchestratore allarga il «Tocca»).
Cosa fare:
- Il corpus, preso dai corpus che ci sono già (vedi
  `crates/fub-format-rich/tests/corpus/docx/`, i test di
  `fub-format-xlsx` e di `fub-format-svg`, e
  `crates/fub-features/tests/baselines/draw/scena.pdf`):
  - Markdown con CRLF, con BOM, col frontmatter e con caratteri fuori dal
    piano base;
  - un docx «senza perdite» e un xlsx con formule;
  - un SVG di un altro programma;
  - un `.canvas` di Obsidian con CRLF e BOM;
  - un PDF.
- Il test copia il corpus in una cartella temporanea, apre il vault con
  l'host e, per ogni file:
  - lo legge come la shell (`read_document`, e per i fogli e i documenti
    l'apertura e `document_closed` dei motori), poi controlla che i byte
    siano gli stessi;
  - lo scrive con una revisione vecchia, e ottiene il conflitto tipizzato
    coi byte uguali;
  - lo rende in sola lettura (il permesso del file, o il motivo che l'host
    già conosce), lo scrive, e ottiene il rifiuto tipizzato coi byte
    uguali.
- Per Markdown, SVG e `.canvas`: una modifica piccola (una parola; un nodo
  spostato con `canvas.apply`). Il confronto dei byte cambia solo nello
  spazio della modifica, e i fine riga e il BOM restano.
- Per docx e xlsx la modifica ha già i suoi test nei crate dei formati: il
  README li nomina.
Casi limite: il file che sparisce durante la prova; un file molto grande
(non qui: c'è il banco `large`); i nomi con spazi e accenti.
Fatto quando: `cargo test -p fub-host --test prealpha_corpus` passa sui
tre sistemi nella CI completa.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test prealpha_corpus
Stato: [ ] da fare

## T14 · Il giro della pre-alpha sul banco: lo scheletro e il primo avvio

Perché: è il «Fatto quando» 3. I compiti che una persona fa nella pre-alpha
girano sul banco, di fila, con la shell vera e il finto host, e lasciano
una foto per ognuno. Questo task fa lo scheletro e i primi cinque compiti;
T26–T30 aggiungono gli altri, un gruppo per task.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro.mjs` (nuovo: il corridore),
`apps/client/bench/giro/elenco.mjs` (nuovo: l'elenco dei gruppi, in
ordine), `apps/client/bench/giro/avvio.mjs` (nuovo: i compiti 1–5),
`apps/client/package.json` (lo script `bench:giro`),
`docs/development/testing-and-quality.md`.
Non toccare: `bench/scene.mjs` e le baseline (il giro non è un banco
visivo: le sue foto non si confrontano coi pixel); `.github/workflows/ci.yml`
(se e dove il giro entra in CI lo decide l'orchestratore, con
`check-release-gate.mjs`).
Dipende da: la Fase B in `main` (le foto sono della cornice nuova).
Cosa fare:
- `giro.mjs` usa `bench/stage.mjs` come le altre scene (la porta 1431; vedi
  la skill `banco`), e il finto host con il vault del banco. Ogni compito è
  una funzione `{ id, nome, fai(pagina), controlla(pagina, host) }`: fa i
  gesti con la tastiera o col puntatore, controlla il risultato nel DOM o
  nel finto host (non solo che non ci siano errori), e fa una foto.
- `giro/elenco.mjs` importa i gruppi in ordine; un gruppo che non c'è
  ancora non si importa (lo aggiungono T26–T30).
- `--solo=<gruppo>` fa girare un gruppo solo; `--telefono` fa girare il
  giro a 390 × 844 (la misura `PHONE` di `scene.mjs`), con i compiti che
  dicono `telefono: true`.
- I compiti di questo task:
  1. l'avvio arriva alla scrivania con lo strato d'avvio sparito;
  2. aprire il vault;
  3. l'albero: aprire una cartella e una nota;
  4. scrivere in Live (un titolo, una lista, un grassetto);
  5. le quattro modalità sulla stessa nota.
- Il giro esce col codice 1 se un compito fallisce, e dice quale. Le foto
  vanno in una cartella data con `--out`.
- In `testing-and-quality.md`: come si lancia, che cosa prova, e che cosa
  non prova (i pixel, il motore vero, il sistema operativo).
Casi limite: un compito che dipende dal precedente (il giro si ferma al
primo errore e lo dice); il moto ridotto (il giro gira con «ridotto», per
non aspettare le animazioni); la shell in inglese (non serve).
Fatto quando: `npm run bench:giro -- --out=$TMPDIR/giro` è verde con i
compiti 1–5 e le loro foto, anche con `--telefono` per 1–4.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --out=$TMPDIR/giro
Stato: [ ] da fare

## T15 · Il simulatore accanto all'app

Perché: è il «Fatto quando» 5. Ogni stato del simulatore si confronta con
la foto della stessa schermata nell'app, nelle due luci, piena, a 700 e al
telefono (390). Il telefono è la cornice A di Scrittoio 2, «provvisoria».
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore, con l'utente.
Tocca: `PLAN-ui/fub-pre-alpha/script/accosta.mjs` (nuovo), il resoconto in
`PLAN.md` (questa sezione).
Non toccare: il simulatore (se l'app è giusta e il simulatore no, si
corregge il simulatore in un passo a parte e si dice).
Dipende da: T14 e T26–T30; le fasi B e C in `main`; le baseline del
runner; T31 per le foto dell'emulatore.
Cosa fare:
- `foto-sim.mjs` fotografa ogni stato del simulatore (le due luci, piena,
  700 e telefono). Le foto dell'app vengono dalle baseline del runner
  (`bench/baseline/`, comprese le scene a 390 × 844), dalle foto del giro
  (T14, T26–T30, anche con `--telefono`) e dalla foto dell'APK
  nell'emulatore (T31).
- `accosta.mjs` mette le coppie una accanto all'altra in una pagina sola
  (simulatore a sinistra, app a destra), con il nome dello stato.
- L'orchestratore la manda all'utente. Ogni differenza diventa una riga:
  «si corregge l'app» (un task piccolo), «si corregge il simulatore», o «va
  bene così» (con la ragione, in `DECISIONS.md`).
Casi limite: uno stato del simulatore che l'app non ha in nessuna foto
(si aggiunge una scena al banco, o lo si dice); le 30 baseline che il banco
locale non riproduce (si usano quelle del runner); i gesti solo del
telefono (la penna e le dita, la pressione lunga): il banco non li prova,
li prova l'utente in T23.
Fatto quando: l'utente ha guardato la pagina, e ogni differenza è chiusa o
scritta.
Prova: la pagina accostata, guardata dall'utente.
Stato: [ ] da fare

## T16 · Le misure della WebView, sulle tre piattaforme

Perché: è il «Fatto quando» 6. I numeri di N0 (S1–S7) sulle tre WebView,
dove si possono prendere, più due cancelli rimasti misurati solo in
Chromium: il menu «/» entro 16 ms (N12) e i Blocchi entro 33 ms su 2.000
righe (N13, che è S7). Ciò che non si può misurare si scrive, con la
ragione.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/webview/run.mjs` (lo scenario S8, il menu «/»),
`apps/client/bench/webview/budgets.json` (solo `targets.S8.slashMenu.p95`
= 16,7; nessuna soglia `ci` finché il runner non l'ha misurato),
`docs/development/webview-measurements.md` (S8 nella tabella degli
scenari), `docs/misure/<data>-prealpha-webview.md` (nuovo).
Non toccare: le soglie `ci` che ci sono; gli altri scenari; il job
`webview` di `ci.yml` (S8 entra in CI solo se l'orchestratore lo decide,
dopo tre giri del runner, con la soglia a una volta e mezza il peggiore,
come dice la nota di `budgets.json`).
Dipende da: le Fasi A–C in `main`. La parte di Windows usa l'MSI della
corsa a secco di T22: la pagina si chiude dopo T22.
Cosa fare:
- S8 in `run.mjs`, sul modello di S1 e di S2: apre «Lunga», va in fondo,
  va a capo, poi venti volte arma `__fubProbe.waitFor("slashMenu",
  ".slash-panel", 1000)`, scrive «/» e chiude con Esc. Il valore è
  `S8.slashMenu.p95` dal segno `slashMenu`. Va nell'elenco di `--only` e
  nell'ordine, dopo S7.
- Linux, sul runner: i numeri di S1–S3 e S7 vengono dalla corsa del job
  `webview` sul `main` di quel giorno (`gh run view`), coi budget accanto.
- Linux, qui (Xvfb, `CLAUDE_DEVICE.md`): `misura.sh` con tutti gli scenari,
  S4, S5 (con la feature `draw`), S6 e S8 compresi. Sotto Xvfb non c'è la
  scheda grafica: i numeri sono un confronto, non il cancello, e la pagina
  lo dice.
- Windows: la procedura «Linux e Windows, passo per passo» di
  `webview-measurements.md`, con l'MSI della corsa a secco di T22 e
  msedgedriver. La fa l'utente, sul suo computer (che ha la GPU); misura
  S1–S8. L'orchestratore gli manda i passi e scrive i numeri che riceve.
  Chiude o aggiorna #283.
- macOS: niente driver WebDriver e nessun Mac a mano (D11). La pagina
  scrive «non misurato» per tutti gli scenari, con la ragione; se D11
  cambia, si usa la procedura «macOS» della stessa pagina.
- La pagina di misura ha una tabella per piattaforma: scenario, valore,
  obiettivo (`targets`), soglia (`ci`), giro o commit, e «non misurato:
  perché» dove manca.
Casi limite: un numero fuori obiettivo (si apre un task o un'issue, non si
alza l'obiettivo); la misura di Windows che non arriva (il «Fatto quando» 6
resta aperto, e il resoconto lo dice); S5 senza la feature `draw` (il
referto lo dà saltato: si ricostruisce l'app con la feature); il menu «/»
che si apre con un'animazione (il segno conta quando `.slash-panel` c'è,
non quando ha finito di muoversi: la pagina lo dice).
Fatto quando: `npm run bench:webview -- --only=S8` dà un numero qui; la
pagina di misura ha Linux (runner e qui) e Windows, e macOS scritto come
non misurato; le guardie dei documenti passano.
Prova: scripts/check.sh --rapido; apps/client/bench/webview/misura.sh --only=S1,S2,S3,S4,S5,S6,S7,S8
Stato: [ ] da fare

## T17 · Il protocollo della prova con cinque persone

Perché: è il «Fatto quando» 7. Una prova con cinque persone, alla fine,
sulla cornice nuova: il primo uso (N12, #281), l'inchiostro (N13), la
lavagna, e di nuovo i compiti dei componenti (K2), come dice D13 A. La
prima prova di K2 si fa prima, sulla sua PR (vedi Fase A e D13): questa
la ripete con la pagina rivestita.
Ramo: piano/fub-pre-alpha.
Tocca: `docs/development/prova-con-persone.md` (nuovo), `docs/README.md`.
Non toccare: i dati delle persone (niente nomi né indirizzi nel repo); il
protocollo di K2 «Prova dei componenti di Fub» (si riprende, non si
riscrive).
Dipende da: T14 e T26–T30 (il protocollo riprende i loro compiti). La
prova vera usa gli installer della corsa a secco di T22.
Cosa fare:
- Parti dal protocollo di K2 («Prova dei componenti di Fub»: sei compiti,
  circa 25 minuti) e dalle voci di #281, N12 e N13 che ci sono nei piani.
  Tieni una volta sola i compiti che si ripetono.
- Per ogni compito: che cosa si chiede, che cosa si osserva (dove si
  blocca, quanto ci mette, che cosa dice), e quando conta come riuscito.
- Come si fa: chi conduce, quanto dura (al massimo un'ora), che cosa si
  registra (niente schermo, solo note), e come si anonimizza.
- I risultati vanno in un'issue (un commento per persona, anonimo).
  L'orchestratore apre l'issue; la prova la conduce l'utente.
- Se D13 è B o C, adatta: con B questa è l'unica prova di K2; con C i
  compiti di K2 escono da qui.
Casi limite: una persona su Windows senza permessi di amministratore
(l'installer per utente); una persona che non ha mai usato Obsidian.
Fatto quando: la pagina c'è e le guardie passano. Il «Fatto quando» 7 si
chiude quando l'issue ha cinque risultati.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T18 · I documenti della pre-alpha

Perché: è il «Fatto quando» 8. Lo stato del progetto, una pagina «Prova la
pre-alpha», il README e il CHANGELOG dicono la pre-alpha com'è.
Ramo: piano/fub-pre-alpha.
Tocca: `docs/project/status.md`, `docs/getting-started/prova-la-pre-alpha.md`
(nuovo), `README.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/` (se D9 è A
o B), `docs/decisions/README.md` (l'indice, se un piano ha aggiunto ADR).
Non toccare: le ADR stesse; le pagine delle architetture (le aggiorna il
task che cambia il comportamento).
Dipende da: le Fasi A–C in `main`; la risposta a D9.
Cosa fare:
- `status.md`: che cosa c'è nella pre-alpha, che cosa no (la tabella «Fuori
  scope» del piano, con i link alle issue), e i limiti noti (telefono di
  prova, macOS solo in CI, Windows senza firma).
- `prova-la-pre-alpha.md`: scaricare (dalla pagina della release),
  installare sui tre sistemi (con l'avviso di SmartScreen e di Gatekeeper,
  perché non è firmata), aprire un vault (consigliare una copia), che cosa
  provare, come segnalare un problema.
- README: la riga in alto che rimanda alla pagina.
- CHANGELOG: la voce `0.2.0-prealpha.1`, scritta dai piani uniti (le loro
  sezioni «Cosa cambia»).
- D9: i modelli delle issue («Problema», «Ho perso dei dati», con la
  priorità, e «Idea»), con i campi del sistema e della versione, e le
  Discussions per le domande. Se D9 è B, anche il comando «Segnala un
  problema»: è un task UI a parte, con un suo stato nel simulatore.
- `status.md` oggi dice ancora «in pila» per lavori già in `main`: allinea
  ogni riga al `main` di quel giorno (`git log`, `gh pr list`).
- Il controllo dei marchi (il rischio «ArtCraft» e i nomi dei motori): i
  nomi Craft compaiono solo in `THIRD_PARTY_NOTICES`, nell'intestazione
  dello stabilizzatore e nei percorsi d'installazione delle CLI Craft; mai
  come nome di una funzione di Fub. Cerca «artcraft» e «fubdraw», senza
  badare alle maiuscole, nelle stringhe che l'utente vede (il catalogo, i
  descrittori, i testi della shell) e scrivi l'esito nella PR. «FubDraw»
  nelle stringhe lo toglie T33.
Casi limite: un link a una pagina che non c'è ancora (le guardie lo
trovano); l'indice delle ADR con un numero saltato (0230: si scrive
«non usato»).
Fatto quando: le guardie dei documenti passano; la pagina dice le cose che
gli installer fanno davvero (provato in T23).
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T19 · I test instabili di Rust

Perché: la pre-alpha chiede la CI completa verde. Sei issue di test
instabili in Rust sono aperte: #292, #301, #310, #270, #98 e #70.
Ramo: piano/fub-pre-alpha (un commit per issue).
Tocca: i test delle issue e, se la causa è nel codice, il codice che
possiede la causa.
Non toccare: i tempi dei test, per farli passare (si alza un tempo solo se
la causa è il tempo e lo si dimostra); `.config/nextest.toml` (la
quarantena chiede l'utente).
Dipende da: nessuno.
Cosa fare:
- Per ogni issue:
  - riproduci con 200 corse (`cargo nextest run -p <crate> <test>
    --retries 0`, in un ciclo, e conta);
  - se fallisce, trova la causa e correggila nel proprietario;
  - se non fallisce in 200 corse, scrivilo nell'issue con il commit.
- Un'issue si chiude solo con la causa corretta, oppure con 200 corse verdi
  e il commento. La chiusura la fa l'orchestratore.
Casi limite: un test che fallisce solo sotto carico (prova con
`--test-threads` alto); un test che fallisce solo su Windows o macOS (lo si
dice, e si guarda la CI).
Fatto quando: ogni issue ha la causa corretta o le 200 corse scritte.
Prova: scripts/check.sh --rapido; i comandi delle corse nel resoconto
Stato: [ ] da fare

## T20 · I test instabili del client e del banco visivo

Perché: come T19, per il client e il banco visivo: #279, #280, #273, #286
e #312.
Ramo: piano/fub-pre-alpha.
Tocca: i test e le scene delle issue.
Non toccare: le baseline (vengono dal runner); i tempi senza la causa.
Dipende da: nessuno.
Cosa fare:
- Per ogni issue: riproduci (Vitest: `npx vitest run <file> --repeat 50`;
  il banco: la scena 20 volte), trova la causa, correggi. Ricorda che sotto
  il Vitest completo alcuni test di tempo vanno oltre il tempo anche su un
  `main` pulito (`CLAUDE_DEVICE.md`): quello non è il difetto dell'issue.
- Come T19 per la chiusura.
Casi limite: un difetto del banco che è un difetto dell'app (si corregge
l'app).
Fatto quando: ogni issue ha la causa corretta o le corse scritte.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T21 · I test instabili della WebView

Perché: come T19, per il banco della WebView: #271, #272, #284, #287 e
#293.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/webview*.mjs` e ciò che le issue dicono.
Non toccare: i budget.
Dipende da: nessuno.
Cosa fare:
- Riproduci qui sotto Xvfb (`CLAUDE_DEVICE.md`), 20 corse per issue; per
  ciò che succede solo su macOS o Windows, leggi i log della CI
  (`gh api repos/Fubeo/Fub/actions/jobs/<job>/logs`).
- Come T19 per la chiusura.
Casi limite: la WebView di Windows o di macOS che qui non c'è (lo si dice).
Fatto quando: ogni issue ha la causa corretta o le corse scritte.
Prova: scripts/check.sh --rapido; il banco WebView qui
Stato: [ ] da fare

## T22 · La versione, e la corsa a secco del rilascio

Perché: è il «Fatto quando» 1. La versione `0.2.0-prealpha.1` va in tutti
i posti, e il rilascio deve funzionare prima del tag.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (tocca la CI).
Tocca:
- i sei posti che `.github/scripts/check-release-version.mjs` confronta
  già (la guardia c'è, con la regola
  `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`): `Cargo.toml`
  (`[workspace.package]`), `crates/fub-app/tauri.conf.json`,
  `crates/fub-app/tauri.android.conf.json`,
  `crates/fub-app/tauri.ios.conf.json`, `apps/client/package.json`,
  `apps/client/package-lock.json` (`packages[""].version`);
- `crates/fub-app/tauri.conf.json`: `bundle.windows.wix.version` =
  `0.2.0.1` (l'MSI vuole quattro numeri, e il quarto è N di
  `prealpha.N`);
- `crates/fub-app/tauri.android.conf.json`: il `versionCode` scritto a mano
  (oggi `autoIncrementVersionCode` è `false`), che cresce a ogni
  `prealpha.N`;
- `.github/scripts/check-release-version.mjs`: in più, il quarto numero di
  `wix.version` uguale a N di `prealpha.N`, e il `versionCode` presente;
  con il suo test, se la guardia ne ha uno;
- `.github/workflows/release.yml`: `--prerelease` quando il tag ha un
  trattino, l'APK di prova allegato, le note della release;
- `.github/scripts/check-release-gate.mjs` se un job cambia nome;
- `CHANGELOG.md` (la data).
Non toccare: la firma (la pre-alpha esce senza); gli altri workflow;
`mobile.yml` (lo tocca T31).
Dipende da: le Fasi A–C in `main`; T14, T18, T19–T21, T25 e T31 chiusi.
Cosa fare:
- La versione nei sei posti; `node .github/scripts/check-release-version.mjs`
  passa.
- L'MSI e l'aggiornamento. Il `main.wxs` di Tauri ha `Product Id="*"` e un
  `MajorUpgrade` che permette di scendere e di reinstallare la stessa
  versione: `0.2.0.1` → `0.2.0.2` sostituisce la voce di prima. Se la prova
  di T23 su Windows lascia due voci, le note della release dicono
  «disinstalla la versione di prima, poi installa questa», e lo dice anche
  `prova-la-pre-alpha.md` (T18).
- Il setup NSIS (`*-setup.exe`, perché `targets` è `all`): la corsa a secco
  dice se accetta la versione col trattino. Se la rifiuta, si allega solo
  l'MSI e si scrive in «Differenze».
- `release.yml`: il tag `v*-prealpha.*` fa una release `--prerelease`
  (ancora in bozza: la pubblica una persona).
- L'APK di debug di `mobile.yml` (aarch64) allegato alla release col nome
  `Fub-0.2.0-prealpha.1-android-sperimentale.apk`.
- macOS (D11): l'app costruita in CI si avvia (una prova di fumo: parte, la
  finestra c'è, si chiude), e la pagina della release dice che non è
  provata a mano.
- La corsa a secco: `gh workflow run release.yml` (`workflow_dispatch`, solo
  gli artefatti), e controlla che ci siano gli installer dei tre sistemi
  e l'APK.
Casi limite: la versione col trattino rifiutata da un passo (MSI, NSIS,
`versionCode`); il gate che chiede una CI completa verde sul commit; un
`prealpha.10` (il quarto numero dell'MSI arriva fino a 65535, il
`versionCode` deve crescere: la guardia lo controlla).
Fatto quando: la guardia della versione passa con `wix.version` e
`versionCode`; la corsa a secco è verde e ha tutti gli artefatti.
Prova: scripts/check.sh --rapido; node .github/scripts/check-release-version.mjs; la corsa a secco
Stato: [ ] da fare

## T23 · Il giro a mano sugli installer e sul telefono

Perché: è il «Fatto quando» 3 e 5, la parte a mano. I compiti del giro
(T14, T26–T30: 27) sugli installer veri, Linux qui e Windows dall'utente;
l'AI con MCP; l'APK sul telefono vero dell'utente.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (Linux) e l'utente (Windows, telefono).
Tocca: il resoconto in questa sezione; un'issue per ogni difetto trovato.
Non toccare: il vault vero dell'utente (`vault-tutti`): il giro usa una
copia temporanea.
Dipende da: T22 e T31.
Cosa fare:
- Linux: installa l'AppImage della corsa a secco (senza sudo), apri una
  copia del vault del banco, fai i 27 compiti a mano, e scrivi il
  risultato di ognuno.
- Windows: l'orchestratore manda all'utente la lista dei 27 compiti;
  l'utente li fa con l'MSI e risponde. In più: installa la corsa a secco,
  poi una seconda corsa costruita con `prealpha.2` (solo per la prova,
  senza tag), e guarda in «App installate» che ci sia una voce sola. Se
  sono due, vale il ripiego di T22.
- L'AI con MCP (N2 e A1), con `fub-cli mcp --vault <copia>
  --automation-read-root <cartella> --automation-write-root <cartella>`
  e Fub aperto sulla stessa copia:
  a) un client esterno chiama `fub_read` su una nota, poi `fub_write` con
     la sua base: Fub mostra il cambio da disco; se la nota aveva testo non
     salvato, mostra il conflitto (T5);
  b) `fub_canvas_apply` prima a secco (la risposta dice che cosa farebbe,
     la lavagna non cambia), poi davvero (la lavagna cambia, e l'annulla
     di Fub la riporta indietro);
  c) una ricetta scritta dal client compare come «proposta» nelle Ricette
     (A1 T9, T11, T12): la si simula e la si adotta.
  La nota col confronto della modifica proposta dall'AI non c'è: è fuori,
  nella fase F5 di A1 («L'assistente dentro Fub»).
- Il telefono vero dell'utente (Android): l'orchestratore manda all'utente
  l'APK sperimentale e cinque passi: installa, apri una copia del vault,
  scrivi una nota, una lavagna con le dita e con la penna (se il telefono
  ce l'ha), un foglio in orizzontale. L'utente risponde con una riga per
  passo e una foto se qualcosa non va.
- Ogni difetto: un'issue; quelli che fermano la pre-alpha diventano task.
Casi limite: un difetto che c'è solo sull'installer (i percorsi, i
permessi): non si vede sul banco; il telefono senza penna (il passo si
scrive «non provato»); il server MCP che trova il vault tenuto dall'app
(passa dal canale di controllo dell'app: è il caso da provare, non un
errore).
Fatto quando: i 27 compiti sono verdi su Linux e su Windows, i tre giri
MCP fanno ciò che dicono, il telefono ha i cinque passi; o i difetti che
restano sono accettati dall'utente come noti.
Prova: il resoconto dei giri.
Stato: [ ] da fare

## T24 · Il tag e la pre-release

Perché: è il «Fatto quando» 1, l'ultimo passo.
Ramo: `main`.
Chi: l'orchestratore, con l'OK dell'utente.
Tocca: il tag `v0.2.0-prealpha.1`; la release in bozza.
Non toccare: niente altro.
Dipende da: tutti gli altri task; la CI completa verde su `main`; l'OK
esplicito dell'utente.
Cosa fare:
- Con l'OK: `git tag v0.2.0-prealpha.1` sul commit di `main`, e il push del
  tag.
- `release.yml` fa la release in bozza. L'orchestratore la controlla (gli
  artefatti, le note dal CHANGELOG, la spunta «pre-release») e la manda
  all'utente, che la pubblica.
- `status.md` e la pagina «Prova la pre-alpha» puntano alla release.
Casi limite: la CI rossa sul tag (niente release, e si corregge su `main`
con un tag nuovo `-prealpha.2`; il tag vecchio non si sposta).
Fatto quando: la pre-release è pubblica e la pagina «Prova la pre-alpha»
porta lì.
Prova: la pagina della release.
Stato: [ ] da fare

## T25 · Il controllo degli aggiornamenti vede le pre-release

Perché: è il «Fatto quando» 1. Chi ha `0.2.0-prealpha.1` deve sapere che
c'è `prealpha.2`. Oggi `updates.rs` chiede `/releases/latest`, che GitHub
dà solo per le release vere: per una pre-alpha risponde 404 («nessuna
release») o la `0.1.x`. E due pre-release si confrontano come testo, quindi
`prealpha.10` verrebbe prima di `prealpha.2`.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/updates.rs`; `docs/reference/` o
`docs/architecture/` dove il controllo degli aggiornamenti è descritto
(cercalo con `updates.check`).
Non toccare: la forma della risposta (`{current, latest, newer, url}` e
`{current, failed, status}`), che la shell legge; il permesso di rete (solo
`api.github.com`); il catalogo.
Dipende da: niente.
Cosa fare:
- Se la versione che gira è una pre-release, chiedi
  `https://api.github.com/repos/Fubeo/Fub/releases?per_page=30` e prendi
  la versione più alta fra quelle che `Version::parse` legge (le bozze
  non arrivano senza autenticazione). Se è una release vera, resta
  `/releases/latest`.
- `Version`: le parti della pre-release si confrontano come dice semver
  (separate dai punti; numeri come numeri, testo come testo, il numero
  prima del testo, la lista più corta prima a parità).
- Estendi `versions_order_like_releases` (`prealpha.10` > `prealpha.2`,
  `0.2.0` > `0.2.0-prealpha.9`, `0.2.0-rc.1` > `0.2.0-prealpha.3`) e
  aggiungi un test con `MemoryHost` per la lista: una lista vuota, una con
  una bozza senza `tag_name`, una con un tag che non è una versione.
Casi limite: la lista che non è un array (`failed: "unreadable"`); una
pre-release più vecchia della release vera che c'è (vince la più alta);
chi ha una release vera non vede le pre-release.
Fatto quando: i test nuovi passano e quelli che c'erano restano verdi.
Prova: cargo test -p fub-host --lib updates::
Stato: [ ] da fare

## T26 · Il giro sul banco: scrivere e muoversi

Perché: è il «Fatto quando» 3. I compiti 6–11 del giro (T14).
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro/scrivere.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs` (una riga),
`docs/development/testing-and-quality.md` (la lista dei compiti).
Non toccare: `bench/giro.mjs` (il corridore è di T14: se manca qualcosa,
dillo nel resoconto); i componenti della shell.
Dipende da: T14; la Fase B in `main`.
Cosa fare: un compito per voce, ognuno coi suoi controlli nel DOM o nel
finto host:
6. «/» in una nota: si apre il menu, si sceglie una tabella, la tabella
   c'è nel testo; poi un blocco spostato con la maniglia;
7. il tasto destro sul testo: il menu c'è, «Grassetto» cambia il testo;
8. la tavolozza (Ctrl+K): si cerca un comando e lo si esegue;
9. due riquadri: una nota a sinistra, un'altra a destra, il fuoco passa;
10. rinominare una nota nell'albero: i link che la nominano cambiano
    (il finto host lo fa: controlla il testo dell'altra nota);
11. la ricerca trova una parola; il pannello «In entrata» della nota
    mostra chi la nomina.
Casi limite: il menu «/» che si chiude se il fuoco scappa (il compito
rimette il fuoco nel testo prima di scrivere); la rinomina annullata con
Esc (un compito in più non serve: lo dice il test della rinomina).
Fatto quando: `npm run bench:giro -- --solo=scrivere` è verde, e il giro
intero resta verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --out=$TMPDIR/giro
Stato: [ ] da fare

## T27 · Il giro sul banco: i quattro editor dei file degli altri

Perché: è il «Fatto quando» 3. I compiti 12–15 del giro.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro/editor.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs`, `docs/development/testing-and-quality.md`.
Non toccare: i motori (il giro usa i loro finti, come le scene del banco);
`bench/giro.mjs`.
Dipende da: T14; la griglia e K5 in `main` (Fase C).
Cosa fare:
12. un documento Word: si scrive una frase, si salva, il finto host ha il
    salvataggio;
13. un foglio Excel: una formula in una cella dà il risultato; il comando
    «Ordina» dalla barra «Comandi» cambia l'ordine;
14. un disegno SVG: lo strumento rettangolo fa una forma, la forma c'è
    nel testo del disegno;
15. un PDF: la ricerca trova una parola, si va a pagina 3.
Casi limite: il motore finto che risponde tardi (il compito aspetta lo
stato «pronto», non un tempo fisso).
Fatto quando: `npm run bench:giro -- --solo=editor` è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --solo=editor --out=$TMPDIR/giro
Stato: [ ] da fare

## T28 · Il giro sul banco: la lavagna e la penna

Perché: è il «Fatto quando» 3. I compiti 16–17 del giro.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro/lavagna.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs`, `docs/development/testing-and-quality.md`.
Non toccare: `bench/giro.mjs`; il nucleo della lavagna.
Dipende da: T14; N4 e N6 in `main` (Fase C).
Cosa fare:
16. una lavagna: si crea una scheda, si scrive dentro (T27 di N6), si fa
    un collegamento fra due schede; il testo della lavagna li ha;
17. la penna (N4): un tratto con `pointerType: "pen"`, poi la gomma lo
    toglie; il testo del file lo dice.
Casi limite: il tratto di penna che il banco non sa fare con la pressione
(si usa la pressione fissa, e il resoconto lo dice).
Fatto quando: `npm run bench:giro -- --solo=lavagna` è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --solo=lavagna --out=$TMPDIR/giro
Stato: [ ] da fare

## T29 · Il giro sul banco: ricette, componenti e aspetto

Perché: è il «Fatto quando» 3. I compiti 18–20 del giro.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro/scelte.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs`, `docs/development/testing-and-quality.md`.
Non toccare: `bench/giro.mjs`; i finti di K2 e A1 (se manca un caso, dillo).
Dipende da: T14; A1, K2 e S2 in `main`; PA T36 e T42 in `main`.
Cosa fare:
18. una ricetta (A1): la si toglie dalle Ricette e la si riprende;
19. un componente (K2): lo si spegne nelle Impostazioni, il suo editor non
    c'è più; lo si riaccende e torna;
20. l'aspetto: la luce chiara, poi il movimento «ridotto»; la cornice
    cambia (le variabili del tema sulla radice). Poi, in modalità
    sviluppatore, «Installa da cartella…» col primo tema d'esempio di PA
    T42 (il finto host dà la cartella); lo si prova in anteprima: la
    cornice cambia e `<style data-fub="pelle-tema">` c'è; «Annulla
    anteprima» torna alla serie e il canale è vuoto; lo si applica, e dopo
    un ricaricamento della pagina è ancora lì.
Casi limite: un componente che ne richiede un altro (la finestra di K2 lo
dice: il compito la accetta).
Fatto quando: `npm run bench:giro -- --solo=scelte` è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --solo=scelte --out=$TMPDIR/giro
Stato: [ ] da fare

## T30 · Il giro sul banco: quando qualcosa va storto

Perché: è il «Fatto quando» 3 e 4. I compiti 21–27 del giro: i casi in cui
una persona può perdere testo, provati come li vede.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro/guasti.mjs` (nuovo),
`apps/client/bench/giro/elenco.mjs`, `docs/development/testing-and-quality.md`.
Non toccare: `bench/giro.mjs`; `src/host/fake.ts` (usa ciò che ha già:
`fault(gate, reason)` e le scritture da fuori).
Dipende da: T14; PA T4 e T5 in `main`.
Cosa fare:
21. il conflitto: testo non salvato, poi il finto host cambia la stessa
    nota da fuori; la barra del conflitto c'è, e ogni sua azione fa ciò
    che dice (T5);
22. la sola lettura: un file che il finto dà in sola lettura non si
    scrive, e la shell lo dice;
23. il cestino: si cancella una nota, la si ritrova nel cestino, la si
    rimette;
24. la tastiera: i compiti 3–9 rifatti senza puntatore, col fuoco visibile
    a ogni passo (l'anello del fuoco c'è nella foto);
25. chiudere con testo non salvato: la finestra di R01 chiede, e
    «Annulla» lascia il testo (T4);
26. ripristinare una versione con testo non salvato: la bozza resta, e la
    shell lo dice (R02, T4);
27. il salvataggio che fallisce: `fault("writeDocument", …)`; la shell lo
    dice, il testo resta, e quando la porta torna buona il salvataggio
    riprova.
Casi limite: il conflitto che arriva mentre la finestra di R01 è aperta
(un compito solo: il conflitto vince, la finestra si chiude, il testo
resta).
Fatto quando: `npm run bench:giro -- --solo=guasti` è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --solo=guasti --out=$TMPDIR/giro
Stato: [ ] da fare

## T31 · L'APK di prova parte in un emulatore della CI

Perché: è il «Fatto quando» 5. Oggi `mobile.yml` costruisce l'APK di
debug (aarch64) e basta: nessuno lo apre. Un emulatore sul runner dice
almeno che parte, che la finestra c'è e che non si chiude da sola.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (tocca la CI).
Tocca: `.github/workflows/mobile.yml` (un job nuovo, `android-emulatore`);
`.github/scripts/check-release-gate.mjs` se il job entra nel cancello del
rilascio; `docs/development/mobile.md` o la pagina dove `mobile.yml` è
descritto.
Non toccare: il job `android` che c'è (l'APK aarch64 resta, è quello che
va nella release); gli altri workflow.
Dipende da: niente; T22 e T23 usano la sua foto.
Cosa fare:
- Il job costruisce un APK di debug x86_64 (`cargo tauri android build
  --debug --apk --target x86_64`, stessa CLI 2.11.5 e stesso JDK 17 del job
  `android`), perché l'emulatore del runner è x86_64.
- Accende KVM sul runner `ubuntu-latest` (la regola udev per `/dev/kvm`).
- Usa l'SDK che il runner ha già: `sdkmanager` per l'immagine di sistema
  (API 34, `google_apis`, x86_64), `avdmanager` per l'AVD, `emulator`
  senza finestra. **Nessuna action di terzi**: una action nuova è una
  dipendenza, e va chiesta all'utente.
- `adb install`, `adb shell am start` sull'attività di Fub, aspetta la
  finestra (`dumpsys window`), poi 20 s; controlla che `logcat` non abbia
  un crash del processo; `adb exec-out screencap -p` in un artifact
  `android-emulatore-<sha>`.
- Gira sulle PR pronte e su `main`, come il job `android`.
Casi limite: l'emulatore lento a partire (attesa fino a 5 minuti, poi il
job fallisce e lo dice); un runner senza KVM (il job lo dice e fallisce,
non salta in silenzio).
Fatto quando: il job è verde su una PR pronta e l'artifact ha la foto della
scrivania.
Prova: scripts/check.sh --rapido; la corsa del job sulla PR
Stato: [ ] da fare

## T32 · `![[x.pdf#page=3]]` apre il PDF a quella pagina

Perché: una voce rimasta aperta (vedi «Le voci sciolte»). In una nota,
`![[x.pdf#page=3]]` diventa un collegamento al PDF, ma la pagina si perde:
il PDF si apre alla prima. Il visore sa già partire da una pagina.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/editors/text/profiles/markdown/media.ts` (il PDF
incorporato, intorno alla riga 396: il collegamento e
`showEmbeddedCraft`), il punto dove il clic su un collegamento apre un
documento (seguilo da `data-wikilink-page`), le opzioni di apertura della
superficie del PDF fino a `initialPage` in
`apps/client/src/editors/media/pdf-view.ts` (riga 337), i test accanto,
`docs/product/` dove il PDF nelle note è descritto.
Non toccare: il formato dei link; il visore fuori da `initialPage`; il
risolutore dei link (`port.resolve`).
Dipende da: niente.
Cosa fare:
- Il collegamento del PDF tiene il numero di pagina (`#page=N`, intero
  positivo), e aprirlo porta `initialPage = N` alla superficie del PDF.
- Lo stesso per `[[x.pdf#page=3]]` (il collegamento senza «!»), se passa
  dallo stesso punto.
- Un numero fuori dal documento apre l'ultima pagina, come `goToPage`.
Casi limite: `#page=0`, `#page=abc`, `#page=` (prima pagina, nessun
errore); un PDF già aperto in un'altra scheda (va a quella pagina); un PDF
rotto (resta l'errore che c'è).
Fatto quando: un test di Vitest prova che il clic su
`![[x.pdf#page=3]]` apre la superficie con `initialPage` 3, e i casi
limite.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T33 · Il nome FubDraw dove le persone lo vedono

Perché: D14. Chi prova la pre-alpha non sa che cosa sia FubDraw (vedi
«Differenze», 22). Questo task vale com'è se D14 è A; con C si fanno solo
i due descrittori; con B non si fa.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-format-svg/src/lib.rs` (i descrittori: «SVG (FubDraw)»
→ «Disegno SVG», «Annotazioni PDF (FubDraw)» → «Annotazioni PDF»),
`crates/fub-scene/src/diagnostics.rs` (S002: «…che Fub conserva…»),
`apps/client/src/editors/spatial/scene/diagnostics.ts` (la stessa S002),
`apps/client/src/i18n/catalog.ts` (`vector.foreign`,
`vector.foreign.editable.hint`, `vector.read_only.future_version`,
`live.not_editable`, in italiano e in inglese),
`apps/client/src/editors/spatial/strings.ts` e
`apps/client/src/editors/spatial/import/strings.ts` (ogni frase con
«FubDraw», nelle due lingue), i messaggi di `scene/engine.ts` che arrivano
alla shell o a MCP, `docs/product/drawing*.md`, una riga nelle pagine
`docs/reference/scene-*.md` («FubDraw è il nome tecnico del formato»), i
test e le fixture che citano quelle frasi.
Non toccare: il namespace `fub:`, gli id dei formati e dei comandi,
`Status::Fubdraw`, `fubdraw://live`, i commenti del codice, le ADR (una
nota in coda a ADR 0203, non una riscrittura).
Dipende da: la risposta a D14.
Cosa fare:
- Cambia le frasi: al posto di «FubDraw» si dice «Fub», «il disegno» o «il
  formato dei disegni di Fub», come suona meglio nella frase; in inglese
  lo stesso.
- Una guardia: un test che cerca «FubDraw» nei cataloghi e nei
  descrittori e fallisce se lo trova (accanto ai test del catalogo).
- Le fixture `scene-export` e `scene-ops` hanno «FubDraw» solo nella
  descrizione del caso: restano.
Casi limite: una frase che citava FubDraw come altra app («non è stato
fatto con FubDraw» diventa «non è stato fatto con Fub»); i test che
confrontano il testo esatto (si aggiornano con la frase nuova).
Fatto quando: la guardia passa; i test dei descrittori, di `fub-scene` e
del catalogo sono verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T34 · Il manifest dice da quale tema parte

Perché: la skin facile, passo 1 (vedi «I temi e la skin facile»). Oggi un
tema porta tutto o niente: la sua pelle sostituisce per intero quella di
serie (18.145 righe in 23 file), e un tema senza `skin.css` lascia i
componenti con la sola `structure.css`. Un campo nuovo del manifest dice che
il tema parte dalla serie e porta solo ciò che cambia.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-abi/src/theme.rs` (`ThemeManifest`: il campo
`extends`), `crates/fub-host/src/theme.rs` (la validazione del manifest,
`discover_themes`, `read_theme`, `ThemePayload`, l'installazione),
`crates/fub-host/tests/themes.rs`, `crates/fub-app/tests/ts_mirror_app.rs`
(i campioni), `apps/client/src/host/contract.ts` (`ThemeManifest`,
`ThemePayload.sheet`), il mirror e la fixture (`UPDATE_MIRROR=1 cargo test
-p fub-app --test ts_mirror_app`), `apps/client/src/host/fake.ts`,
`apps/client/src/theme/theme.ts` solo dove il tipo di `sheet` lo chiede,
`docs/reference/permissions-and-security.md` («Temi installati»),
`docs/reference/on-disk-layout.md`.
Non toccare: il montaggio nel loader (è T35); la WIT (il tema non c'è); i
limiti di dimensione; il motore `theme-1`.
Dipende da: la risposta a D15 (il nome del campo; qui `extends`, la
consigliata).
Cosa fare:
- `ThemeManifest` prende `extends: Option<String>`, con `#[serde(default,
  skip_serializing_if = "Option::is_none")]`, come fa già `settings`. Un
  manifest senza il campo si legge e si scrive come oggi.
- L'unico valore accettato è `"fub.serie"` (`SERIES_ID`). Un altro valore è
  un `ThemeError::Malformed` col perché, come fa `check_settings`.
- Solo col motore `theme-2`: un tema `theme-1` con `extends` è rifiutato
  (il motore vecchio non cambia, ADR 0206).
- Con `extends` i fogli diventano facoltativi. `read_theme` dà `sheet:
  None` per una luce senza foglio, e il client userà il foglio di serie di
  quella luce e di quel contrasto (T35). Senza `extends` il foglio resta
  obbligatorio. `ThemePayload.sheet` diventa `Option<String>` (sul filo
  `string | null`), e il mirror segue.
- Un tema con `extends` che non porta niente (né fogli, né pelle, né
  caratteri, né icone) è rifiutato: «il tema non cambia niente».
- `lights` resta obbligatorio anche con `extends`: dice quali luci il tema
  offre.
- Il catalogo firmato passa dalla stessa validazione: una voce con
  `extends` si installa come le altre.
Casi limite: un manifest di `main` senza il campo, letto e riscritto, resta
uguale byte per byte (un test lo confronta, come fa già
`a_manifest_without_settings_keeps_its_wire_form` in `fub-abi`); `extends: ""`; `extends:
"fub.serie "` (con lo spazio); `extends` col motore `theme-1`; un tema con
`extends` e il solo foglio chiaro (lo scuro viene dalla serie).
Fatto quando: `crates/fub-host/tests/themes.rs` prova i casi sopra; il
mirror è quello scritto da `UPDATE_MIRROR=1`; il finto host dà un tema con
`extends`.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test themes;
cargo test -p fub-app --test ts_mirror_app
Stato: [ ] da fare

## T35 · La pelle del tema si monta sopra quella di serie

Perché: la skin facile, passo 1, la parte della shell. Con `extends` (T34)
la pelle di serie resta, e quella del tema si aggiunge sopra, in un canale
suo. Così un tema di 100 righe cambia solo ciò che vuole, e un componente
che arriva dopo resta vestito dalla serie.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/theme/loader.ts` (`ORDER`, `replaceTheme`,
`validateThemeBundle`, `mountThemeBundle`), `apps/client/src/theme/theme.ts`
(`apply` e `themeBundle`: il foglio di serie quando il tema non ne porta),
`apps/client/src/theme/gate.test.ts`, un test nuovo
`apps/client/src/theme/inherit.test.ts`,
`docs/architecture/frontend-and-ipc.md`, `apps/client/theme/author/README.md`,
una ADR nuova («La pelle che eredita») col primo numero libero quando la
scrivi (oggi 0240: 0236, 0238 e 0239 sono di K3, N4 e K5),
`docs/decisions/README.md`.
Non toccare: il sanificatore (`ui/sanitize-css.ts`): la pelle del tema passa
dallo stesso, con `kind: "skin"` e lo stesso vocabolario; i canali
`preferenze` e `snippets`; la pelle di serie.
Dipende da: T34.
Cosa fare:
- `ORDER` diventa `["caratteri", "caratteri-tema", "foglio", "pelle",
  "pelle-tema", "preferenze", "snippets"]`. Le preferenze restano dopo ogni
  pelle. `caratteri-tema` lo riempie T39: qui c'è solo il posto.
- Senza `extends`, `replaceTheme` fa ciò che fa oggi, byte per byte, e
  `pelle-tema` resta vuoto (si toglie, se c'era).
- Con `extends`:
  - il foglio è quello del tema per quella luce, o quello di serie
    (`series.sheet(light, contrast)`) se il tema non lo porta;
  - la pelle di serie resta montata in `pelle`;
  - la pelle del tema va in `pelle-tema`.
  Tutto in una commit sola, dopo che ogni cancello è verde, come oggi.
- I cancelli: il foglio (il suo o quello di serie) passa ruoli e contrasti;
  la pelle del tema passa `themeCssViolations` col vocabolario `theme-2` e
  il cancello del contenuto. Il motivo `fascio: pelle vuota` non vale per un
  tema che eredita: per lui una pelle assente è il caso normale.
- «Applica tema», «Annulla anteprima» e il ritorno alla serie dopo un
  rifiuto smontano anche `pelle-tema`: non resta niente.
- La ADR dice:
  - perché un canale e non una fusione dei due testi;
  - l'ordine dei canali;
  - che `extends` accetta solo la serie (ereditare da un altro tema è fuori,
    per ora);
  - che quando la serie cambia il tema eredita il cambio, ed è lo scopo.
Casi limite: passare da un tema che eredita a uno che non eredita e
ritorno (nessun `<style data-fub="pelle-tema">` rimasto); un tema che
eredita ed è rifiutato (si torna alla serie, pulita); la luce che cambia
con la preview aperta; il contrasto alto con un tema senza foglio (si usa il
foglio di serie del contrasto alto).
Fatto quando: `theme/inherit.test.ts` prova che:
- un tema senza `extends` monta gli stessi elementi di oggi;
- un tema con `extends` e una pelle di tre regole lascia la pelle di serie e
  aggiunge la sua dopo;
- una regola del tema vince su quella di serie a parità di specificità;
- un componente che il tema non nomina ha lo stile di serie;
- «Annulla anteprima» non lascia resti.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/theme/
Stato: [ ] da fare

## T36 · Installare un tema da una cartella, e leggere perché è rifiutato

Perché: la skin facile, passo 2. Oggi un tema si installa solo dal catalogo
firmato, o copiando la cartella a mano in `<config>/themes/<id>/`. L'host
sa già installare da una cartella (`install_theme`,
`crates/fub-host/src/theme.rs:1932`: atomico, senza link simbolici né
traversal), ma non c'è un'IPC e lo usano solo i test. E quando un tema è
rifiutato, chi lo scrive vede solo «Tema «X» rifiutato» in un avviso.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/settings.rs` (la chiave `developer.mode`:
interruttore, livello macchina, spento, gruppo «Sviluppo»), l'host (un
metodo che installa da cartella con `install_theme`),
`crates/fub-app/src/lib.rs` (il comando `install_theme_from_folder`),
`crates/fub-app/src/lean_ipc.rs` (`Why::AppSurface`),
`crates/fub-app/permissions/default.toml`, `apps/client/src/host/contract.ts`,
`ipc.ts`, `fake.ts`, `dialog.ts` (`pickFolder` c'è già),
`apps/client/src/panels/settings.ts` (in Aspetto: «Installa da cartella…»
nel blocco «Temi installati», e la lista della diagnosi),
`apps/client/src/i18n/catalog.ts`, la pelle delle Impostazioni dal
simulatore, `docs/reference/permissions-and-security.md`,
`docs/reference/ipc-contract.md`.
Non toccare: il catalogo firmato e la sua fiducia; i limiti
dell'installazione; il formato su disco di `themes/<id>/`.
Dipende da: T34; S2 T10 in `main` (le Impostazioni nuove).
Dal prototipo: gli stati di Aspetto della skin facile (la modalità
sviluppatore, «Installa da cartella», la diagnosi; gli S-numeri sono in
«Dal prototipo»).
Cosa fare:
- La chiave `developer.mode` mostra, in Aspetto, il bottone «Installa da
  cartella…». L'host rifiuta il comando se la chiave è spenta: la regola sta
  nell'host, non solo nel bottone nascosto.
- Il bottone apre `pickFolder`; l'host installa con `install_theme` (stessi
  controlli, stesso rename atomico, la serie riservata). Il tema compare in
  «Temi installati» con la fiducia «Della comunità», come ogni tema non di
  serie.
- Un id già installato: la finestra lo dice e offre «Sostituisci». Prima si
  valida la cartella nuova con le stesse porte di `install_theme`, poi si
  toglie il vecchio (`uninstall_theme`, c'è) e si installa il nuovo. Se
  l'installazione fallisce dopo aver tolto il vecchio, la finestra lo dice:
  la cartella sorgente resta dov'è, quindi niente si perde, ma il tema va
  reinstallato. Se il tema sostituito è quello in uso, si rimonta.
- La diagnosi: quando un tema è rifiutato, all'installazione o al montaggio,
  Aspetto mostra una lista con una riga per motivo:
  - il file (`manifest.json`, `skin.css`, `sheet-light.css`…);
  - riga:colonna, quando c'è;
  - il codice e il perché, in italiano.
  I motivi vengono da `validateThemeBundle` così come sono (`pelle:
  selector-hook (12:3): …`): si dividono in campi, non si riscrivono. La
  lista ha `role="alert"` solo quando compare, e un bottone «Copia la
  diagnosi».
Casi limite: la cartella senza `manifest.json`; un link simbolico dentro;
una cartella oltre i limiti di oggi (si ferma e lo dice); la modalità
sviluppatore spenta mentre la finestra di scelta è aperta (l'host rifiuta);
un tema che passa l'installazione ma che il loader rifiuta (la diagnosi è
quella del loader).
Fatto quando: un test di `fub-host` installa da una cartella temporanea, e
rifiuta con la chiave spenta; Vitest delle Impostazioni prova il bottone, la
fiducia, «Sostituisci» e la lista della diagnosi con un tema rifiutato del
finto host; mirror e fixture rigenerati.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test themes;
cd apps/client && npx vitest run src/panels/
Stato: [ ] da fare

## T37 · Collegare una cartella, e il tema cambia al salvataggio

Perché: la skin facile, passo 2. Chi scrive un tema salva il file e vuole
vederlo subito, senza reinstallare. Oggi nessuno guarda la cartella di un
tema.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/settings.rs` (la chiave
`developer.theme-folder`: testo, livello macchina, non scrivibile da
programma), `crates/fub-host/src/theme.rs` (il tema collegato:
`discover_themes` e `read_theme` leggono anche la cartella collegata, con le
stesse porte; fiducia `development`), un osservatore nuovo accanto a
`crates/fub-host/src/watcher.rs` (riusa `notify` e il debouncer che ci sono
già), `crates/fub-app/src/lib.rs` (`link_theme_folder`,
`unlink_theme_folder`, l'evento `fub://theme-changed`), `lean_ipc.rs`,
`permissions/default.toml`, `apps/client/src/host/contract.ts`, `ipc.ts`,
`fake.ts`, `apps/client/src/theme/theme.ts` (rimonta all'evento),
`apps/client/src/panels/settings.ts`, `i18n/catalog.ts`,
`docs/reference/permissions-and-security.md`,
`docs/reference/ipc-contract.md`.
Non toccare: l'osservatore del vault; i temi installati (un tema collegato
non si copia in `themes/`).
Dipende da: T36.
Dal prototipo: gli stati «tema collegato, in sviluppo» e «tema ricaricato»
di Aspetto.
Cosa fare:
- «Collega una cartella…», in modalità sviluppatore accanto a «Installa da
  cartella…», salva il percorso nella chiave. Il tema compare in «Temi
  installati» con la fiducia «In sviluppo» (`development`, che
  `ui/permissions.ts` sa già dire). Un tema collegato alla volta.
- L'host legge il tema collegato al suo posto, con le stesse porte
  dell'installazione (niente link simbolici né traversal, gli stessi
  limiti). Un id uguale a un tema installato è rifiutato, e il messaggio lo
  dice.
- L'osservatore guarda solo quella cartella, con un debounce di circa
  200 ms. Ha un padrone, il custode dei temi dell'host, e si smonta con
  «Scollega», con un'altra cartella, con la modalità sviluppatore spenta e
  alla chiusura dell'app. A ogni cambio emette `fub://theme-changed { id }`.
- Il client, se il tema cambiato è quello in uso o in preview, lo rilegge e
  lo rimonta. Se il fascio nuovo è rifiutato, **resta montato l'ultimo
  buono**: non si cade sulla serie, come fa oggi `apply`. Aspetto mostra la
  diagnosi di T36 con l'ora del tentativo.
- Una corsa vecchia non sovrascrive una nuova: si usa la generazione che
  `apply` ha già.
Casi limite: la cartella cancellata mentre è collegata (il tema sparisce,
si torna alla serie, l'avviso lo dice); un editor che salva con un rename
(il debounce ne fa un cambio solo); 50 salvataggi di fila (al massimo un
rimontaggio in volo); l'app riaperta con la cartella che non c'è più
(avviso, nessun blocco); montare e smontare l'osservatore due volte (nessun
resto, `check-listeners.mjs`).
Fatto quando: un test di `fub-host` collega una cartella temporanea, scrive
`skin.css`, riceve l'evento, e dopo «Scollega» non ne riceve più; Vitest
prova che un fascio rifiutato lascia montato l'ultimo buono e mostra la
diagnosi.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test themes;
cd apps/client && npx vitest run src/theme/ src/panels/
Stato: [ ] da fare

## T38 · La pagina «Tutti i componenti»

Perché: la skin facile, passo 2. Chi scrive un tema deve vedere tutto ciò
che il tema veste, in ogni stato, senza cercarlo nell'app. Il banco ha già i
cataloghi: `bench/catalog.ts` (componenti, tavolozza, campionario: «la
pagina di prova che si consegnerà a chi scriverà un tema») e `bench/kit.ts`
(i primitivi del kit con gli stati forzati). Stanno però fuori dall'app.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/catalog.ts`, `bench/samples.ts` e `bench/kit.ts`
(il cuore va in un modulo sotto `src/`, per esempio `src/dev/catalogo/`, che
il banco importa), una vista nuova aperta da Aspetto in modalità
sviluppatore, `apps/client/src/panels/settings.ts`, `i18n/catalog.ts`, la
pelle dal simulatore, la pagina di `docs/development/` che descrive il
banco, il README del kit autore.
Non toccare: le scene e le baseline del banco (le foto di `catalog` e `kit`
restano uguali: è la prova che lo spostamento non cambia niente); il bundle
iniziale.
Dipende da: T35, T36; S2 T10 in `main`.
Dal prototipo: «Tutti i componenti».
Cosa fare:
- Una pagina con tre schede (Componenti, Tavolozza, Caratteri) più i
  primitivi del kit, col tema in uso o in preview, e due interruttori:
  Chiaro/Scuro e Contrasto alto. Ogni componente compare in ogni stato del
  contratto (`states`: 7).
- Il codice si carica solo quando la pagina si apre (`import()`): il bundle
  iniziale non cresce.
- Un clic su un componente mostra il suo nome e gli hook che lo vestono
  (dall'anatomia, `COMPONENTS`), da copiare.
Casi limite: un tema rifiutato con la pagina aperta (la pagina resta, con la
diagnosi in testa); la pagina aperta due volte (ce n'è una sola); la
finestra stretta (una colonna).
Fatto quando: le scene `catalog` e `kit` del banco danno le stesse foto di
prima (CI); un Vitest apre e chiude la pagina due volte senza resti; il
bundle iniziale ha la stessa misura (±1 KB).
Prova: scripts/check.sh --rapido; cd apps/client && npm run build
Stato: [ ] da fare

## T39 · I caratteri del tema

Perché: la skin facile, passo 3. Un'identità vera passa dai caratteri, e
oggi un tema non può portarne: `@font-face` è vietato nel CSS
(`NEVER_AT_RULES`), e resta vietato, perché un `src:` scritto a mano
potrebbe chiamare la rete.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-abi/src/theme.rs` (il campo `fonts`),
`crates/fub-host/src/theme.rs` (la validazione: i file sono fra gli asset,
sono woff2, i limiti), `apps/client/src/theme/loader.ts` (scrive le regole
`@font-face` nel canale `caratteri-tema`; `mimeType` impara `woff2`),
`contract.ts`, mirror e fixture, `fake.ts`, i test,
`docs/reference/permissions-and-security.md`, il README del kit autore.
Non toccare: il sanificatore (niente `@font-face` nel CSS); la CSP di
`crates/fub-app/tauri.conf.json` (ha già `font-src data:`, e
`materializeAssets` fa già degli asset URL `data:`); i caratteri di serie
(`fonts.css`, canale `caratteri`).
Dipende da: T34, T35.
Cosa fare:
- Il manifest prende `fonts: Vec<ThemeFont>` (additivo, `#[serde(default,
  skip_serializing_if = "Vec::is_empty")]`). Ogni voce ha:
  - `family`: lettere, cifre, spazi e `-`, al massimo 64 caratteri, diversa
    dalle famiglie di serie;
  - `file`: un asset del tema, `fonts/<nome>.woff2` (cioè
    `theme://<id>/fonts/<nome>.woff2`);
  - `weight`: 100–900;
  - `style`: `normal` o `italic`.
- L'host controlla che il file sia fra gli asset e cominci con `wOF2`. Al
  massimo 8 file, 2 MiB l'uno, 6 MiB in tutto.
- Il loader scrive da sé le regole `@font-face`, coi valori del manifest e
  l'URL `data:` dell'asset, nel canale `caratteri-tema`. La pelle del tema
  usa la famiglia per nome (`font-family: "Carta Serif", var(--font-ui)`).
- Cambiato tema, il canale si svuota.
Casi limite: `file: "https://…"` (rifiutato: non è un asset); un `.ttf`
rinominato in `.woff2` (rifiutato dalla firma `wOF2`); una famiglia con il
nome di una di serie (rifiutata); il nono file; 6 MiB e un byte.
Fatto quando: i test dell'host provano i limiti e i casi sopra; un Vitest
prova le regole generate, e che un `@font-face` scritto nella pelle è ancora
rifiutato.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test themes;
cd apps/client && npx vitest run src/theme/
Stato: [ ] da fare

## T40 · Le icone del tema

Perché: la skin facile, passo 4 (D16). Le icone della shell e degli editor
passano tutte da un registro solo, `ui/icons.ts`: la mappa `SVG` di serie
(43 icone) e `registerIcon`, usato dal nastro del foglio, dal documento, dal
disegno, dal selettore dei colori, dalla barra del formato e da Scrittoio.
Oggi un tema può solo ricolorarle. Il registro accetta già soltanto
tracciati (`PATH_DATA`), quindi un set del tema si valida con la stessa
regola. Questo task vale com'è se D16 è A; con C si ridisegnano solo le 43
della mappa `SVG`; con B non si fa.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-abi/src/theme.rs` (il campo `icons`: il nome di un
asset JSON), `crates/fub-host/src/theme.rs` (i limiti del file),
`apps/client/src/ui/icons.ts` (una mappa `THEMED` guardata per prima;
`icon()` mette `data-icon="<nome>"` sull'`<svg>`),
`apps/client/src/theme/theme.ts` (monta e smonta il set col tema, e
ridisegna le icone già nella pagina), contract e mirror, `fake.ts`, i test,
`docs/reference/permissions-and-security.md`, il README del kit autore (con
l'elenco dei nomi, da `iconNames()`).
Non toccare: la mappa `SVG` di serie e le registrazioni dei moduli (un tema
non aggiunge nomi: ridisegna quelli che ci sono); la griglia 24, il tratto e
il colore (`currentColor`).
Dipende da: T34, T35; la risposta a D16. Mai nella stessa ondata di un task
che aggiunge icone alla mappa `SVG` (S2 T14 lo fa).
Cosa fare:
- Il manifest dichiara `icons: "icons.json"`. Il file è `{ "<nome>":
  ["<d>", …] }`; ogni `d` passa `PATH_DATA`. Al massimo 512 nomi, 8
  tracciati e 4 KB per nome, 256 KB in tutto.
- `icon(name)` guarda prima il set del tema, poi la serie, poi le
  registrazioni. Il corpo si costruisce come oggi (`<path d="…"/>`, coi
  soli dati validati). `registerIcon` non conta il set del tema come «già
  disegnato».
- Un nome che oggi nessuno disegna non rifiuta il tema, perché i moduli
  registrano le loro icone quando si caricano: la diagnosi di T36 lo
  segnala come avviso.
- Cambiato tema, o aperta la preview, un passaggio solo ridisegna gli
  `<svg data-icon>` già nella pagina. «Annulla anteprima» torna alla serie.
Casi limite: un `d` con `<` o `"` (rifiutato); un alias ridisegnato
(`folder`: vale per il nome a cui punta); l'icona di un modulo spento (resta
nel set, non si vede); 10.000 icone nella pagina al cambio di tema (un
passaggio solo, sotto i 16 ms).
Fatto quando: Vitest prova la precedenza, la validazione, il ridisegno e
«Annulla anteprima»; i test dell'host provano i limiti.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/ui/ src/theme/
Stato: [ ] da fare

## T41 · Gli hook congelati

Perché: la skin facile, passo 5. `theme-2` non è congelato:
`apps/client/theme/author/contract.json` è cambiato in 12 commit dal 29
ottobre al 4 novembre, e nessuna guardia ferma un hook tolto o rinominato
(l'unico script che legge il file, `check-inline-theme.mjs`, guarda
altro). Una pelle che nomina un hook tolto è rifiutata per intero
(`selector-hook`) e il tema cade sulla serie. Si congela per ultimo, quando
ciò che si vede nella pre-alpha è fermo.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/theme/author/frozen/theme-2.json` (nuovo: lo snapshot),
un test nuovo `apps/client/src/theme/contract-frozen.test.ts`, il README del
kit autore, `docs/architecture/frontend-and-ipc.md`, una ADR nuova («Gli
hook di `theme-2` congelati», col primo numero libero), `CLAUDE.md` (la
parte «Generated files», accanto a `wit/frozen`).
Non toccare: `contract.json` a mano (è generato); i temi.
Dipende da: tutta la Fase C in `main` (S2, griglia, K5, N4, N6, la lavagna
in codice e A1: sono loro che cambiano ciò che si vede); T34–T40.
Cosa fare:
- Lo snapshot tiene i nomi che un tema può usare: `hooks`, `components`,
  `required_roles`, `optional_roles`, `contrast_pairs`, `optional_pairs`,
  `preference_tokens`, `states` e, se D16 è A o C, i nomi delle icone.
- Il test fallisce se un nome dello snapshot manca dal contratto, o se un
  ruolo facoltativo diventa obbligatorio. Le aggiunte passano.
- Il messaggio del test dice che cosa fare: un nome tolto chiede un motore
  nuovo (`theme-3`, ADR 0206), non uno snapshot cambiato.
- Lo snapshot non si riscrive per far passare il test, come `wit/frozen/`
  con `wit_additivity`.
Casi limite: un hook rinominato (è un tolto più un aggiunto: fallisce);
l'ordine delle voci cambiato (passa); il generatore che cambia formato (il
test confronta insiemi di nomi, non testo).
Fatto quando: il test passa su `main`, e fallisce su una prova locale che
toglie un hook (scritta nel resoconto, non committata).
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run
src/theme/contract-frozen.test.ts && npm run theme:verify
Stato: [ ] da fare

## T42 · Due temi d'esempio

Perché: la skin facile, passo 6, e la sua prova d'uscita. Un tema vero di
circa 100 righe sopra la serie, con un'identità diversa, e uno di soli
colori. Tutti e due si installano da cartella, passano i cancelli e si
guardano dappertutto.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/theme/examples/<id>/` (due cartelle nuove:
`manifest.json`, i fogli, `skin.css` per il primo, i caratteri e le icone
se D16 lo dice), un test nuovo `apps/client/src/theme/examples.test.ts`, le
scene del banco dei due temi (`bench/scene.mjs`), il README del kit autore
(i due temi come punto di partenza, al posto della copia intera di
`sample/`), la pagina di `docs/product/` che parla dell'aspetto.
Non toccare: la serie; il contratto; lo snapshot di T41.
Dipende da: T41; la risposta a D17 (l'aspetto dei due temi).
Dal prototipo: i blocchi `blocchi/93-tema-*.css` del simulatore (il CSS
dei due temi, già passato dal sanificatore stretto) e gli stati «vestito da
…» (gli S-numeri sono in «Dal prototipo»).
Cosa fare:
- Il primo (in D17 il consigliato è «Carta») ha `extends: "fub.serie"`, i
  due fogli, una pelle di circa 100 righe che usa solo hook dello snapshot,
  i suoi caratteri (T39) e, se D16 è A, una decina di icone.
- Il secondo («Salvia») ha `extends`, i due fogli e nient'altro.
- Il test prova che:
  - tutti e due passano `validateThemeBundle` nelle due luci e col
    contrasto alto;
  - la pelle del primo usa solo hook di `frozen/theme-2.json`;
  - un componente che il primo non nomina ha lo stile di serie.
- Le foto del banco, per ciascun tema: la scrivania, una nota, il foglio e
  le Impostazioni, nelle due luci, in contrasto alto, a 700 e al telefono
  (390). Le baseline vengono dal runner.
- Si installano da cartella nell'app vera (T36), a mano, e il resoconto lo
  dice.
Casi limite: il contrasto alto (le coppie di contrasto passano anche lì: lo
prova il test); un componente aggiunto dopo (lo prova il test).
Fatto quando: il test è verde; le scene del banco ci sono, con le baseline
dal runner; il resoconto dice dell'installazione a mano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/theme/examples.test.ts
Stato: [ ] da fare
