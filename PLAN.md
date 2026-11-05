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
F2–F6; #9; gli installer firmati. Ognuno ha il suo posto in «Dentro e
fuori».
Assunzioni: 
- Questo è un piano ombrello. I task degli altri piani restano nei loro
  `PLAN.md` e sui loro rami. Qui stanno l'ordine, i cancelli e 24 task
  nuovi («PA T1»–«PA T24»), che tengono tutto insieme.
- La strada degli altri piani non cambia. Fanno eccezione le decisioni
  della parte «Domande aperte», quando l'utente risponde.
- Gli stati detti «fatti» sono verificati su `origin` il 2026-11-05 (vedi
  «Differenze fra piani e codice»).
Ondate: Fase A: PA T1 T3 T13 | T4 T6 T8 | T5 T7 T19, con K3 T17 e poi
#295, e K2 (#290) · Fase B: Scrittoio 2 T3–T27 (le sue ondate), con PA T2,
T20 e T21 · Fase C: griglia, K5, N4, N6, lavagna in codice e A1 (le loro
ondate, nell'ordine di «L'ordine»), con PA T12 · Fase D: PA T14 T18 |
T15 T17 T22 | T16 T23 | T24. PA T9, T10 e T11 partono solo con la risposta
alla loro domanda.
Prototipo: `PLAN-ui/fub-pre-alpha/simulatore.html`, il simulatore di tutta
la pre-alpha (artifact «Fub pre-alpha», parte 1). È costruito dai
prototipi approvati: Scrittoio 2 (2026-11-04), K2, K3 T12 (2026-11-03),
K5 T25 (2026-11-05), N4 T20 (2026-11-02), N6 T25 (2026-11-04) e A1
(2026-11-03). Per la griglia l'approvazione non è scritta (domanda D2).
Approvato: in attesa.

## Modifiche

nessuna.

## La definizione

Confermata dall'utente il 2026-11-05.

### Fatto quando

1. Il tag `v0.2.0-prealpha.1` ha gli installer per Windows, macOS e Linux, e
   la CI di rilascio è verde (PA T22, T24).
2. I piani dentro sono in `main`, ognuno col suo cancello e con la CI
   completa verde (Fasi A–C).
3. Il giro della pre-alpha, circa 24 compiti, passa e2e nel banco (PA T14)
   e a mano sugli installer (PA T23).
4. Un corpus per formato (md, docx, xlsx, svg, canvas con l'inchiostro,
   pdf) torna byte per byte: aprire e chiudere non cambia niente, e una
   modifica non tocca il resto. Il conflitto e la sola lettura sono
   provati (PA T13).
5. Il simulatore e l'app coincidono: le foto del banco, nelle due luci, a
   tutta larghezza e a 700, stanno accanto al simulatore, e ogni differenza
   è spiegata (PA T15).
6. Le misure della WebView stanno nei budget sul runner Linux, e c'è una
   misura a mano su Windows (PA T16).
7. C'è una prova unica con cinque persone, su K2, N12, N13 e la lavagna
   (PA T17).
8. `docs/project/status.md` è aggiornato, c'è la pagina «Prova la
   pre-alpha», e `fub:abi@0.2.0` è congelata (#289; PA T6, T7, T18).

### Fuori scope, e dove va

| Che cosa | Perché fuori | Dove va |
|---|---|---|
| K6 · il disegno completo | XL, 30 task, nessuno fatto. La pre-alpha usa il disegno semplice di K5 | `piano/k6-disegno-completo`, PR #313 |
| K4 · la consegna (edizioni, dati scaricabili) | La pre-alpha esce con un installer solo e tutto dentro | «Piani di Fub», passo K4 |
| K7, K8 · foto e libreria foto | Aspettano la decisione di N9 | «Piani di Fub» |
| K9 · documenti e fogli completi | Dopo K3: la pre-alpha usa le modalità di K3 | «Piani di Fub» |
| K10 · seguire i motori | È lavoro continuo, non una tappa (`aggiorna.sh` c'è già) | «Piani di Fub» |
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

## Dentro e fuori

Ogni fase di «Le prossime fasi di Fub» (N0–N13), ogni passo di «Piani di
Fub» (K0–K10), ogni piano aperto e ogni punto sciolto, verificato nel
codice, nei rami e nelle issue il 2026-11-05.

| Voce | Stato verificato | Pre-alpha | Ragione | Dove |
|---|---|---|---|---|
| N0 · misurare | Banco WebView in `main` (`bench/webview`, `docs/development/webview-measurements.md`); #283 aperta | dentro: misure | Fatto quando 6 | PA T16 |
| N1 · FubDraw | In `main` (ADR 0231, tag `fubdraw-completo`) | fatto | Cancello passato; resta l'archivio | #282, fuori |
| N2 · MCP | In `main` (`crates/fub-cli/src/mcp.rs`, ADR 0232) | fatto | L'AI della definizione passa di qui | — |
| N3 · la lavagna in Rust | In `main` (#297, #306, #307) | fatto | Base di N4, N6 e della lavagna in codice | — |
| N4 · l'inchiostro | Ramo: 14 di 25 | dentro | La penna della definizione | `piano/n4-inchiostro`, #298 |
| N5 · strati nativi | Senza piano | fuori | Vedi la tabella sopra | «Prossime fasi» |
| N6 · la lavagna v1 | Ramo: 11 di 90 | dentro, senza T79–T85 e T88 | Le lavagne della definizione | `piano/n6-lavagna`, #302 |
| N7 · file Craft | In `main` (#299) | fatto | Le anteprime ci sono | — |
| N8 · DOCX e XLSX | Sostituita da K6–K9 | — | Vedi K3 e K9 | — |
| N9 · egui o Tauri | Senza piano | fuori | Vedi sopra | «Prossime fasi» |
| N10 · Linux | Senza piano | fuori | Vedi sopra, domanda D8 | «Prossime fasi» |
| N11 · budget, documenti, upstream | Continuo | dentro: budget e documenti; fuori: upstream | Fatto quando 6 e 8 | PA T16, T18; #253, #254 |
| N12 · il menu «/» | In `main` | fatto, prova con persone dentro | Fatto quando 7 | PA T17 |
| N13 · i Blocchi | In `main`; #281 aperta | fatto, prova con persone dentro | Fatto quando 7 | PA T17 (chiude #281) |
| K0 · misure dei motori | In `main` (`docs/misure/*-k0.md`) | fatto | — | — |
| K1 · i componenti | In `main` (#285, `crates/fub-componenti`) | fatto | — | — |
| K2 · la pagina «Componenti» | Ramo: 7 di 7 | dentro | I componenti accesi e spenti | `piano/k2-pagina-componenti`, #290 |
| K3 · lo strato dei motori | Ramo: 17 di 19, T18 integrato, manca T17 | dentro | Word ed Excel | `piano/k3-motori`, #295 |
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

## L'ordine

Quattro fasi. Una fase finisce quando tutti i suoi passi sono chiusi; la
dopo può cominciare prima solo dove la colonna «Dipende da» lo permette.
Al massimo tre coder insieme (`DECISIONS.md`), o meno se l'utente lo dice;
mai due coder sullo stesso file. «Taglia» è a occhio: S è mezza giornata di
un coder, M una giornata o due, L una settimana, XL di più.

### Fase A · unire ciò che è finito e chiudere i buchi fra i piani

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| K3 T17 · la CI completa e la revisione | K3 | da fare (T1–T16, T19 fatti; T18 integrato) | nessuno | medio: un crate nuovo (`fub-motori`), patch nel `vendor/`, tre sistemi | M | CI completa verde su #295, la revisione senza difetti alti |
| Unire #295 (K3, con K3-IPC T8) | K3 | PR pronta | K3 T17, OK dell'utente | medio | S | `main` ha `crates/fub-motori` e i comandi `open_key`, `warm_engine` e `document_closed` |
| Riallineare #290 a `main` e unirla | K2 | 7 di 7 | nessuno | basso | S | CI completa verde, OK dell'utente |
| PA T1 · il finto del banco con le impostazioni dell'host | PA | da fare | nessuno | basso | S | `bench/fake-ipc.test.ts` |
| PA T3 · i comandi in sola lettura non tengono il turno | PA | da fare | nessuno | medio: tocca il custode | M | test d'integrazione di `fub-host` |
| PA T4, T5 · #237 R01–R03 | PA | da fare | nessuno | medio: sessioni e conflitto | M + M | test di Vitest sulla sessione |
| PA T6, T7 · #289 | PA | da fare | T7 dopo T6 | medio: confine WASM | S + M | `wit_additivity`, componente vero |
| PA T8 · la pagina della cornice del telefono | PA | da fare | nessuno | basso | S | guardie dei documenti |
| PA T13 · il corpus senza perdite | PA | da fare | nessuno; si allarga quando K5 e N4 entrano | medio | M | test d'integrazione di `fub-host` |
| PA T19 · i test instabili del Rust | PA | da fare | nessuno | medio | M | 200 giri verdi o causa trovata |

### Fase B · la cornice

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Scrittoio 2 T3–T27 | S2 | 3 di 27 (T1, T2, T16) | K3 in `main` per T20 e T21, che rifanno la barra a schede dalle regole di K3 T18; T22 dopo la risposta a D5; T23 aggiunge solo l'icona (N6 vince sulla lavagna) | medio: tocca quasi ogni pelle; le baseline vengono dal runner (T25) | L | S2 T26 e la CI completa |
| PA T2 · N4 e K5 allineati a `main` | PA | da fare | #295 in `main` | basso | S | `tsc --noEmit` pulito sui due rami |
| PA T11 · il vassoio delle barre | PA | solo se D6 non è A | S2 T20 | basso | S | foto del banco |
| PA T20, T21 · i test instabili del client e del banco | PA | da fare | nessuno | medio | M + M | 50 giri verdi o causa trovata |

### Fase C · gli editor

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Griglia T1–T9 | griglia | 0 di 9 | #295 in `main` (il ramo nasce da K3); T2 e T3 mai insieme a S2 T20 (tutti e tre toccano `skin/editors.css`) | medio: il motore della griglia | L | griglia T8 (foto contro `celle-griglia`) |
| PA T12 · #237 R04 | PA | da fare | griglia T4 | medio | M | test di Vitest sulla griglia |
| N4 T12–T17, T21–T25 | N4 | 14 di 25 | PA T2; T24 aspetta l'esito della prova con Obsidian, che incolla l'utente | medio: penna e latenza | L | N4 T25 |
| N6 v1, senza T79–T85 e T88 | N6 | 11 di 90 | N4 in `main` (il ramo nasce da N4, e T90 lo chiede); i task grafici dopo l'approvazione dei prototipi T26–T28 (D3) | alto: 79 task | XL | N6 T90 |
| K5 T6, T7, T9, T11, T13–T24, T27–T30 | K5 | 10 di 30 | PA T2; T6 copia `Fubeo/vectorcraft` (c'è, pubblico, 2026-11-02); T22 dopo D5; T24 dopo K2 in `main` | alto: motore vettoriale nuovo | XL | K5 T30 |
| La lavagna in codice T1–T26 | lavagna in codice | 0 di 26 | T15–T18 dopo N4 in `main`; T14, T19, T23 e T24 dopo N6 in `main` (T72, T73, T19, T37, T48) | medio | L | lavagna in codice T26 |
| A1 T4, T5, T7, T9–T13 | A1 | 5 di 13 | T12 mai insieme a S2 T10 (le impostazioni) | basso | M | A1 T13 |

### Fase D · la prova e la pre-release

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| PA T14 · il giro della pre-alpha nel banco | PA | da fare | tutte le Fasi A–C in `main` | medio | M | `npm run bench:giro` verde |
| PA T15 · il simulatore accanto all'app | PA | da fare | Fase C | basso | S | il foglio di contatto rivisto dall'utente |
| PA T16 · le misure della WebView | PA | da fare | Fase C; la misura di Windows usa l'MSI della prova di T22 | medio: Windows lo misura l'utente | M | la pagina delle misure |
| PA T17 · la prova con cinque persone | PA | da fare | PA T14 per il protocollo; la prova usa gli installer di T22 | basso per il codice; serve l'utente | S + la prova | il resoconto della prova |
| PA T18 · i documenti della pre-alpha | PA | da fare | Fase C | basso | S | guardie dei documenti |
| PA T22 · la versione e la prova del rilascio | PA | da fare | T14, T18; T19–T21 | alto: MSI e versione non numerica | M | `release.yml` verde in prova |
| PA T23 · il giro a mano sugli installer | PA | da fare | T22 | medio | M | la lista del giro spuntata |
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
- **Che cosa c'è.** Sul ramo `piano/k3-motori` (6e6fc623) c'è tutto, salvo
  T17:
  - il catalogo dei comandi e il test di copertura;
  - la guardia `check-motori.mjs`;
  - le patch che liberano le cache dei motori;
  - i comandi IPC `open_key`, `warm_engine` e `document_closed`. Vengono da
    K3-IPC T8, #296, unito nel ramo e non in `main`.

  In `main` ci sono N7, i file Craft (`fub-format-craft`, la CLI Craft) e i
  motori già adottati (#227, #234).
- **Che cosa manca.** K3 T17 e il merge di #295.
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
- **Che cosa manca.** Il merge di #290 e la prova con le persone (PA T17).

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
  - N6 T31: un campo facoltativo.

  Ognuno porta `contract.ts`, il mirror e la fixture (`UPDATE_MIRROR=1`),
  `fake.ts`, `ipc_permissions` e `lean_ipc`, nel task del suo piano.
- **Su disco.**
  - `.canvas` con `fub:ink` e `fub:parts`;
  - le chiavi `components.*`;
  - le note delle ricette;
  - docx, xlsx e svg li scrivono i motori. Il loro formato non cambia, e il
    corpus di PA T13 lo prova.
- **MCP.** `docs/reference/mcp-server.md`. Gli strumenti nuovi vengono
  dalla lavagna in codice (T22) e da A1 (T11).
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
  - La versione `0.2.0-prealpha.1` nei sei posti.
  - L'MSI: WiX vuole una versione numerica, e Tauri rifiuta un
    identificatore di prerelease non numerico. Serve `bundle.windows.wix.version`.
  - L'APK allegato alla pre-release.

  Tutto questo è PA T22.

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
Dipende da: nessuno.
Cosa fare:
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

Perché: R01. Quando `DocumentSessionCollection.release()` chiude un
documento, prova il flush e la bozza: se falliscono tutti e due, la UI non
deve far sparire l'unica copia recuperabile. R02. `reloadCurrent()` chiama
`forceReload()`, che azzera lo stato «da salvare» prima di rileggere: il
ripristino di una versione con modifiche non salvate può perderle.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/state/document-session.ts` (`release`,
`forceReload`), `apps/client/src/state/document-controller.ts`
(`reloadCurrent`), `apps/client/src/state/document-session.test.ts`,
`apps/client/src/i18n/catalog.ts` (se serve un testo), `docs/architecture/document-model.md`.
Non toccare: `panels/document.ts`; l'host; le bozze su disco (il loro
formato).
Dipende da: nessuno.
Cosa fare:
- Prima i due test che riproducono, nel finto host (`host/fake.ts`):
  - R01: una sessione con testo non salvato; flush e bozza che falliscono;
    `release()`. Oggi la sessione sparisce?
  - R02: testo non salvato e `reloadCurrent()`. Oggi il testo si perde?
- R01: se nessuna delle due strade ha reso il testo durevole, `release()`
  non chiude. Restituisce un `CloseResult` che lo dice, e la sessione resta
  viva e «da salvare». Chi chiama (la linguetta, il cambio di vault) mostra
  l'avviso che usa già per i file non salvati (`demo.unsaved`). Niente
  copia segreta in un altro posto.
- R02: tutti i chiamanti del ripristino (cercali). Se c'è testo non salvato,
  `forceReload()` non lo azzera prima di rileggere: lo mette prima in bozza.
  Se la bozza fallisce, non rilegge e lo dice. Non si aggiunge una conferma
  dopo una scrittura già fatta.
Casi limite: la bozza che riesce e il flush no (si chiude, il testo è in
bozza); due chiusure di fila; il vault che cambia mentre si chiude; un
documento in sola lettura (niente da salvare).
Fatto quando: i due test falliscono prima e passano dopo; i test di
`state/` restano verdi.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/state/
Stato: [ ] da fare

## T5 · #237 R03: il conflitto e la Lettura dicono quale versione si vede

Perché: con un conflitto aperto il buffer non si può salvare. Non è
dichiarato se la Lettura mostra il testo della persona o la versione sul
disco.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/panels/document.ts` (`drawConflict`),
`apps/client/src/state/document-session.ts` (solo se serve esporre lo
stato), il modulo della Lettura (parti da `editors/core/bootstrap.ts`, dove
le modalità si registrano), i loro test, `apps/client/src/i18n/catalog.ts`,
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

## T14 · Il giro della pre-alpha sul banco

Perché: è il «Fatto quando» 3. I compiti che una persona fa nella pre-alpha
girano sul banco, di fila, con la shell vera e il finto host, e lasciano
una foto per ognuno.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/giro.mjs` (nuovo), `apps/client/bench/giro-compiti.mjs`
(nuovo: l'elenco dei compiti e dei controlli), `apps/client/package.json`
(lo script `bench:giro`), `docs/development/testing-and-quality.md`.
Non toccare: `bench/scene.mjs` e le baseline (il giro non è un banco
visivo: le sue foto non si confrontano coi pixel); `.github/workflows/ci.yml`
(se e dove il giro entra in CI lo decide l'orchestratore, con
`check-release-gate.mjs`).
Dipende da: le Fasi A–C in `main` (il giro passa per ogni editor).
Lo scheletro e i compiti già possibili si scrivono prima; ogni piano che si
unisce aggiunge i suoi.
Cosa fare:
- `giro.mjs` usa `bench/stage.mjs` come le altre scene (la porta 1431; vedi
  la skill `banco`), e il finto host con il vault del banco. Ogni compito è
  una funzione che fa i gesti con la tastiera o col puntatore, controlla il
  risultato nel DOM o nel finto host (non solo che non ci siano errori), e
  fa una foto.
- I 24 compiti, in quest'ordine:
  1. l'avvio arriva alla scrivania con lo strato d'avvio sparito;
  2. aprire il vault;
  3. l'albero: aprire una cartella e una nota;
  4. scrivere in Live (un titolo, una lista, un grassetto);
  5. le quattro modalità sulla stessa nota;
  6. «/» e un blocco;
  7. il tasto destro su una parola;
  8. la tavolozza dei comandi;
  9. due riquadri affiancati;
  10. rinominare una nota (i collegamenti seguono);
  11. la ricerca e «In entrata»;
  12. un documento Word: scrivere e salvare;
  13. un foglio Excel: una formula e la modalità «Comandi»;
  14. un disegno SVG: una forma;
  15. un PDF: cercare e andare a una pagina;
  16. la lavagna: una scheda e un collegamento;
  17. la penna e la gomma sulla lavagna;
  18. le ricette (una ricetta tolta e rimessa);
  19. Componenti: spegnere e riaccendere un editor;
  20. Aspetto: la luce e il movimento;
  21. un conflitto e la sua risoluzione;
  22. un file in sola lettura;
  23. il cestino e il ripristino;
  24. un giro solo con la tastiera (dal 3 al 9, senza puntatore).
- Il giro esce col codice 1 se un compito fallisce, e dice quale. Le foto
  vanno in una cartella data con `--out`.
- In `testing-and-quality.md`: come si lancia, che cosa prova, e che cosa
  non prova (i pixel, il motore vero, il sistema operativo).
Casi limite: un compito che dipende dal precedente (il giro si ferma al
primo errore e lo dice); il moto ridotto (il giro gira con «ridotto», per
non aspettare le animazioni); la shell in inglese (non serve).
Fatto quando: `npm run bench:giro -- --out=$TMPDIR/giro` è verde sul
ramo con tutti i piani uniti, e le 24 foto ci sono.
Prova: scripts/check.sh --rapido; cd apps/client && npm run build && npm run bench:giro -- --out=$TMPDIR/giro
Stato: [ ] da fare

## T15 · Il simulatore accanto all'app

Perché: è il «Fatto quando» 5. Ogni stato del simulatore si confronta con
la foto della stessa schermata nell'app, nelle due luci, piena e a 700.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore, con l'utente.
Tocca: `PLAN-ui/fub-pre-alpha/script/accosta.mjs` (nuovo), il resoconto in
`PLAN.md` (questa sezione).
Non toccare: il simulatore (se l'app è giusta e il simulatore no, si
corregge il simulatore in un passo a parte e si dice).
Dipende da: T14; le fasi B e C in `main`; le baseline del runner.
Cosa fare:
- `foto-sim.mjs` fotografa ogni stato del simulatore (le due luci, piena e
  700). Le foto dell'app vengono dalle baseline del runner (`bench/baseline/`)
  e dalle foto di T14.
- `accosta.mjs` mette le coppie una accanto all'altra in una pagina sola
  (simulatore a sinistra, app a destra), con il nome dello stato.
- L'orchestratore la manda all'utente. Ogni differenza diventa una riga:
  «si corregge l'app» (un task piccolo), «si corregge il simulatore», o «va
  bene così» (con la ragione, in `DECISIONS.md`).
Casi limite: uno stato del simulatore che l'app non ha in nessuna foto
(si aggiunge una scena al banco, o lo si dice); le 30 baseline che il banco
locale non riproduce (si usano quelle del runner).
Fatto quando: l'utente ha guardato la pagina, e ogni differenza è chiusa o
scritta.
Prova: la pagina accostata, guardata dall'utente.
Stato: [ ] da fare

## T16 · Le misure della WebView

Perché: è il «Fatto quando» 6. I budget della WebView (`ci`) sul runner
Linux, e una misura a mano su Windows, sul computer dell'utente.
Ramo: piano/fub-pre-alpha.
Tocca: `docs/misure/<data>-prealpha-webview.md` (nuovo),
`docs/development/webview-measurements.md` (la procedura per Windows, se
manca).
Non toccare: i budget; `bench/webview*.mjs`.
Dipende da: le Fasi A–C in `main`. La parte di Windows usa l'MSI della
corsa a secco di T22: la pagina si chiude dopo T22.
Cosa fare:
- Prendi i numeri della corsa del banco WebView del runner Linux sul `main`
  di quel giorno (`gh run view`), per S1, S2 e S3, e scrivili con i budget
  accanto.
- La misura a mano qui (Xvfb, `CLAUDE_DEVICE.md`) come confronto.
- La procedura per Windows: installare l'MSI della corsa a secco di T22,
  aprire il vault di prova, misurare S1–S3 (con lo strumento che la pagina
  dice). La fa l'utente; l'orchestratore gli manda la procedura e scrive i
  numeri che riceve.
- #283 (la GPU sul computer dell'utente): la misura di Windows la chiude o
  la aggiorna.
Casi limite: un numero fuori budget (si apre un task, non si alza il
budget); la misura di Windows che non arriva (il «Fatto quando» 6 resta
aperto, e il resoconto lo dice).
Fatto quando: la pagina di misura ha Linux (runner e qui) e Windows; le
guardie dei documenti passano.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T17 · Il protocollo della prova con cinque persone

Perché: è il «Fatto quando» 7. Una prova con cinque persone sola, che
unisce quella dei componenti (K2), quella del primo uso (N12, #281), quella
dell'inchiostro (N13) e quella della lavagna.
Ramo: piano/fub-pre-alpha.
Tocca: `docs/development/prova-con-persone.md` (nuovo), `docs/README.md`.
Non toccare: i dati delle persone (niente nomi né indirizzi nel repo).
Dipende da: T14 (il protocollo riprende i suoi compiti). La prova vera usa
gli installer della corsa a secco di T22.
Cosa fare:
- Parti dalla pagina «Prova componenti» di K2 (i suoi sei compiti) e dalle
  voci di #281, N12 e N13 che ci sono nei piani. Tieni i compiti che si
  ripetono una volta sola.
- Per ogni compito: che cosa si chiede, che cosa si osserva (dove si
  blocca, quanto ci mette, che cosa dice), e quando conta come riuscito.
- Come si fa: chi conduce, quanto dura (al massimo un'ora), che cosa si
  registra (niente schermo, solo note), e come si anonimizza.
- I risultati vanno in un'issue (un commento per persona, anonimo).
  L'orchestratore apre l'issue; la prova la conduce l'utente.
Casi limite: una persona su Windows senza permessi di amministratore (l'MSI
per utente); una persona che non ha mai usato Obsidian.
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
- D9: i modelli delle issue (un difetto, un'idea), con i campi del sistema
  e della versione; se D9 è B, anche il comando «Segnala un problema» (è un
  task UI a parte, con un suo stato nel simulatore).
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
Tocca: la versione nei sei posti (`Cargo.toml` del workspace,
`crates/fub-app/tauri.conf.json`, `apps/client/package.json` e
`package-lock.json`, e gli altri che `check-release-gate.mjs` o
`release.yml` controllano: cercali); `bundle.windows.wix.version`
(`0.2.0.1`, perché l'MSI vuole solo numeri); il `versionCode` di Android,
se serve; `.github/workflows/release.yml` (`--prerelease`, e l'APK di
prova allegato e segnato «sperimentale»); `.github/scripts/check-release-gate.mjs`
se un job cambia nome; `CHANGELOG.md` (la data).
Non toccare: la firma (la pre-alpha esce senza); gli altri workflow.
Dipende da: le Fasi A–C in `main`; T14, T18 e T19–T21 chiusi.
Cosa fare:
- La versione in tutti i posti; un test o una guardia che le confronta, se
  non c'è già.
- `release.yml`: il tag `v*-prealpha.*` fa una release `--prerelease`
  (ancora in bozza: la pubblica una persona).
- L'APK di debug di `mobile.yml` allegato alla release col nome
  `Fub-0.2.0-prealpha.1-android-sperimentale.apk`.
- macOS (D11): l'app costruita in CI si avvia (una prova di fumo: parte, la
  finestra c'è, si chiude), e la pagina della release dice che non è
  provata a mano.
- La corsa a secco: `gh workflow run release.yml` (`workflow_dispatch`, solo
  gli artefatti), e controlla che ci siano gli installer dei tre sistemi
  e l'APK.
Casi limite: la versione con il trattino rifiutata da un passo (l'MSI, il
`versionCode`); il gate che chiede una CI completa verde sul commit.
Fatto quando: la corsa a secco è verde e ha tutti gli artefatti.
Prova: scripts/check.sh --rapido; la corsa a secco
Stato: [ ] da fare

## T23 · Il giro a mano sugli installer

Perché: è il «Fatto quando» 3, la parte a mano. Il giro di T14 sugli
installer veri: Linux qui, Windows dall'utente.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (Linux) e l'utente (Windows).
Tocca: il resoconto in questa sezione; un'issue per ogni difetto trovato.
Non toccare: il vault vero dell'utente (`vault-tutti`): il giro usa una
copia temporanea.
Dipende da: T22.
Cosa fare:
- Linux: installa il `.deb` o l'AppImage della corsa a secco (senza sudo:
  l'AppImage), apri una copia del vault del banco, fai i 24 compiti a mano,
  e scrivi il risultato di ognuno.
- Windows: l'orchestratore manda all'utente la lista dei 24 compiti; l'utente
  li fa con l'MSI e risponde.
- L'AI (A1): con il server MCP acceso, un client esterno legge una nota e
  ne propone una modifica, e la proposta si vede e si accetta in Fub.
- Ogni difetto: un'issue; quelli che fermano la pre-alpha diventano task.
Casi limite: un difetto che c'è solo sull'installer (i percorsi, i
permessi): non si vede sul banco.
Fatto quando: i 24 compiti sono verdi su Linux e su Windows, o i difetti
che restano sono accettati dall'utente come noti.
Prova: il resoconto dei due giri.
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
