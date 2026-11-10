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
Fuori scope: K6 (disegno completo, D24); K4, K7, K8, K9, K10; PdfCraft
P1–P5, e con loro N6 T79–T85; N6 T88 (CSV, D-20); N5, N9; di N10 Flathub
e Wayland (il Flatpak è dentro, D8); l'app del tablet; la lavagna v2 e v3;
A1 F2–F6; #9; i layout alternativi della shell (D23) e `backdrop-filter`
nei temi. Ognuno ha il suo posto in «Dentro e fuori».
Assunzioni: 
- Questo è un piano ombrello. I task degli altri piani restano nei loro
  `PLAN.md` e sui loro rami. Qui stanno l'ordine, i cancelli e 57 task
  nuovi («PA T1»–«PA T57»), che tengono tutto insieme. PA T34–T42 sono la
  skin facile, chiesta dal manutentore il 2026-11-05. PA T43–T47 vengono
  dal secondo giro del simulatore: il file nuovo col tipo, il vault da
  5.000 file, le parole della scheda di un componente e i 44 px del tocco
  sul telefono, che oggi deformano l'interruttore e troncano le schede
  delle impostazioni. PA T48–T57 vengono dalle risposte del 2026-11-07:
  il verde di serie, il logo, la firma, il Flatpak, «Segnala un problema»,
  #237 R05–R08 e A03, l'editor di testo vestito dal tema, il controllo di
  tutte le viste nel banco e i difetti che il controllo ha trovato (PA T56,
  T57).
- Il telefono ha un piano suo, prima della pre-alpha (D1 B): parte quando
  Scrittoio 2 è in `main`, e l'APK di PA T22, T23 e T31 lo aspetta.
- Lavorano due coder alla volta (Opus, ragionamento medio), e nessun altro
  agente: è la regola dell'utente dal 2026-11-07 (prima era un coder solo),
  e cambia solo se la cambia l'utente. Dal 2026-11-10 i task semplici
  e quelli medi possono andare a coder Haiku 5.5, quanti ne servono (vedi «Il ramo, le
  consegne e i due coder»). Le «ondate» qui sotto restano
  l'ordine: due task vanno insieme solo se i loro «Tocca» non si toccano e
  la tabella della fase non li tiene separati («mai con…»). Il pianificatore
  del telefono (D1 B) lo avvia l'utente.
- La strada degli altri piani non cambia. Fanno eccezione le decisioni
  della parte «Domande aperte», quando l'utente risponde.
- Gli stati detti «fatti» sono verificati su `origin` il 2026-11-05 (vedi
  «Differenze fra piani e codice»).
Ondate: Fase A: K3 T17 (il sì dell'utente) e #295 | K2 (#290, dopo la
prova dell'utente, D13 A) | PA T3 T13 | T4 T5 | T6 T7 | T1 T8 T9 T10 T19
T25 T32 T33 | T48 | T34 T35 | T54 | T39 T40 | T44 T46 T47 | T53 · Fase B:
Scrittoio 2 T3–T27 (le sue ondate), con PA T2, T11 (dopo S2 T20), T20 e
T21, e PA T36 T37 T38 dopo S2 T10, PA T43 dopo S2 T8 e T14, PA T56 T57
quando S2 è in `main`; poi il piano del telefono (pianificatore e task,
D1 B) · Fase C: griglia, K5, N4, N6,
lavagna in codice e A1 (le loro ondate, nell'ordine di «L'ordine»), con PA
T12 · Fase D: PA T41 | T42 | T49 (dopo D28) | T14
T18 T55 | T26 T27 T28 T29 T30 | T52 | T50 T51 | T15 T17 T22 T31 | T16 T45
T23 | T24. PA T49 parte dopo la licenza del logo (D28); PA T50 dopo la
risposta di SignPath Foundation (D20).
Prototipo: `PLAN-ui/fub-pre-alpha/simulatore.html`, il simulatore di tutta
la pre-alpha (artifact «Fub pre-alpha»,
https://claude.ai/artifact/RCUxmuv2dCqbwDRagbKHcK, parte 1). È costruito dai
prototipi approvati: Scrittoio 2 (2026-11-04), K2, K3 T12 (2026-11-03),
K5 T25 (2026-11-05), N4 T20 (2026-11-02), N6 T25 (2026-11-04) e A1
(2026-11-03). La griglia (`celle-griglia`) l'ha approvata l'utente il
2026-11-07 (D2 A).
Approvato: sì, dall'utente il 2026-11-07: «Per il resto il piano è
approvato». Il sì vale per il piano e per i 130 stati composti e nuovi del
simulatore; la licenza del logo resta da confermare prima di PA T49 (D28).
Stato: il 2026-11-07 l'utente ha risposto a tutte le domande (D1–D28),
ha approvato i 118 stati composti e nuovi e ha dato il via A: «scrivi le
risposte nel piano e nel simulatore, fai il controllo di D19, mostrami gli
stati cambiati; poi approvo sul simulatore aggiornato». Le risposte sono
scritte qui (ogni domanda in testa), i task nuovi sono PA T48–T57, e il
simulatore è rifatto in verde, col logo e con gli stati che le
risposte hanno cambiato o aggiunto. Lo stesso giorno l'utente ha portato il
logo definitivo, Marcuzzo (D26), con la cartella che prende il colore del
tema: le catture sono rifatte con lui, con le forme piccole che non
ingrandiscono niente (l'utente: «non mi piace l'icona con l'occhio
strizzato ingrandito»). Il controllo di D19 è fatto («Il controllo di
tutte le viste»): i difetti che ha trovato sono PA T56, T57 e due punti di
T47, e il simulatore li mostra già corretti. Poi l'utente ha detto che
Marcuzzo l'ha disegnato lui e l'ha ritoccato con l'AI in ArtCraft e poi in
VectorCraft (D28: la licenza resta da confermare), che la firma di Apple
per ora non si fa (D20), e ha approvato il piano: «Per il resto il piano è
approvato». Lavorano due coder alla volta. Il piano si implementa, dalla
Fase A.

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
   salvataggio, con la diagnosi leggibile; porta i suoi caratteri e le sue
   icone, e veste anche l'editor di testo. Tre temi d'esempio («Carta»,
   «Officina», «Mare») passano i cancelli e sono guardati nelle due luci,
   in contrasto alto, stretti e al telefono. Gli hook sono congelati e un
   test lo tiene (PA T34–T42, T54).
10. Fub è verde di serie e ha il suo logo (PA T48, T49); gli installer per
   Windows sono firmati (quelli per macOS no, per ora: D20), e c'è il
   Flatpak (PA T50, T51); «Segnala un problema» apre la issue con versione
   e sistema (PA T52); un controllo
   del banco passa tutte le viste (PA T55).

### Fuori scope, e dove va

| Che cosa | Perché fuori | Dove va |
|---|---|---|
| K6 · il disegno completo | XL, 30 task, nessuno fatto. La pre-alpha usa il disegno semplice di K5 (D24 B, 2026-11-07: un piano dopo la pre-alpha, coi riscontri) | `piano/k6-disegno-completo`, PR #313 |
| K4 · la consegna (edizioni, dati scaricabili) | La pre-alpha esce con un installer solo e tutto dentro | «Piani di Fub», passo K4 |
| K7, K8 · foto e libreria foto | Aspettano la decisione di N9 | «Piani di Fub» |
| K9 · documenti e fogli completi | Dopo K3: la pre-alpha usa le modalità di K3 | «Piani di Fub» |
| K10 · seguire i motori | È lavoro continuo, non una tappa. Il controllo settimanale c'è già: `aggiorna.sh` gira ogni lunedì alle 4:17 sul server (cron), da `~/Progetti/fub-archivio/motori-upstream`, fuori dal repository | «Piani di Fub», K10 |
| PdfCraft P1–P5 | Non hanno un piano. Il PDF della pre-alpha è il visore pdf.js di `main` | «Piani di Fub», `riferimenti/pdfcraft.md` |
| N6 T79–T85 (PDF sui tasselli, estratti di PDF) | Dipendono da PdfCraft P1, P2 e P4 | `piano/n6-lavagna`, dopo PdfCraft |
| N6 T88 (la scheda CSV) | Dipende da D-20: un piano «I CSV nel motore dei fogli», che non c'è | N6 D-20, piano futuro |
| N5 · strati nativi | Senza un piano; aspettano le misure di N0 sui dispositivi | «Prossime fasi», N5 |
| N9 · egui o Tauri | Si decide coi numeri di N5 | «Prossime fasi», N9, decisione 7 |
| N10 · Flathub e Wayland | Il Flatpak è dentro (D8 B, PA T51), ma come file allegato alla release; Flathub e Wayland restano | «Prossime fasi», N10, decisione 5 |
| App del tablet | Il telefono ha un piano suo prima della pre-alpha (D1 B); il tablet no | piano futuro del tablet, #90 |
| Lavagna v2 e v3 | Fuori dalla v1 di N6 (D-1 b) | `lavagna.md`, «Le tappe» |
| A1 F2–F6 | A1 consegna F1, la base | artifact «Ricette di Fub» |
| #9 · sincronizzazione | Grande e senza piano | #9 |
| #253, #254 · upstream dei motori | Le proposte le fa l'utente (decisione 9) | #253, #254 |
| #282 · archiviare FubDraw | È un gesto dell'utente su GitHub | #282 |
| Layout alternativi (le regioni della finestra spostate) | Sono una variante della shell, non una pelle (D23 B, 2026-11-07: un piano dopo la pre-alpha, coi riscontri di PA T17) | piano futuro delle varianti della shell |
| `backdrop-filter` nei temi | Blocca WebKitGTK senza composizione | resta vietato (`NEVER_PROPERTIES` del sanificatore) |

## Dentro e fuori

Ogni fase di «Le prossime fasi di Fub» (N0–N13), ogni passo di «Piani di
Fub» (K0–K10), ogni piano aperto e ogni punto sciolto, verificato nel
codice, nei rami e nelle issue il 2026-11-05.

| Voce | Stato verificato | Pre-alpha | Ragione | Dove |
|---|---|---|---|---|
| N0 · misurare | Banco WebView in `main` (`bench/webview`, `docs/development/webview-measurements.md`); #283 aperta. Le scene S4–S6 e le tre piattaforme sono nel cancello di N0 | dentro: misure sulle tre piattaforme, S4–S6 comprese, dove si può | Fatto quando 6 | PA T16 |
| N1 · FubDraw | In `main` (ADR 0231, tag `fubdraw-completo`). I 42 file `.rs` che nominano FubDraw sono codice vivo: FubDraw è il nome del formato (ADR 0203). La prova byte per byte c'è già: `editors/spatial/corpus-open.test.ts`, `crates/fub-scene/tests/corpus.rs` e i test del provider svg (ADR 0231, «Verifica») | fatto; dentro: il nome dove le persone lo vedono (D14 A) | Cancello passato; resta l'archivio | PA T33; #282, fuori |
| N2 · MCP | In `main` (`crates/fub-cli/src/mcp.rs`, ADR 0232): 17 strumenti, vedi «Contratti» qui sotto | fatto; dentro: due flussi veri nel giro a mano | L'AI della definizione passa di qui | PA T23 |
| N3 · la lavagna in Rust | In `main` (#297, #306, #307) | fatto | Base di N4, N6 e della lavagna in codice | — |
| N4 · l'inchiostro | Ramo: 22 di 25 (T15 la prima misura, 205 ms sotto Xvfb) | dentro | La penna della definizione | `piano/n4-inchiostro`, #298 |
| N5 · strati nativi | Senza piano | fuori | Vedi la tabella sopra | «Prossime fasi» |
| N6 · la lavagna v1 | Ramo: 17 di 90 (T14 entrare e uscire) | dentro, senza T79–T85 e T88 | Le lavagne della definizione | `piano/n6-lavagna`, #302 |
| N7 · file Craft | In `main` (#299) | fatto | Le anteprime ci sono | — |
| N8 · DOCX e XLSX | Sostituita da K6–K9 | — | Vedi K3 e K9 | — |
| N9 · egui o Tauri | Senza piano | fuori | Vedi sopra | «Prossime fasi» |
| N10 · Linux | Senza piano | dentro: il Flatpak come file della release (D8 B); fuori: Flathub e Wayland | Lo stesso WebKitGTK per tutti | PA T51; «Prossime fasi» |
| N11 · budget, documenti, upstream | Continuo | dentro: budget e documenti; fuori: upstream (le voci precise sono in «Le voci sciolte», più sotto) | Fatto quando 6 e 8 | PA T16, T18; #253, #254 |
| N12 · il menu «/» | In `main` | fatto; dentro: la prova con persone, i 16 ms nella WebView, il «/» nelle schede della lavagna; fuori: il «/» nelle celle | Fatto quando 6 e 7 | PA T16, T17; N6 T43; celle con K9 |
| N13 · i Blocchi | In `main`, coreografie comprese (`motion-rules.mjs`, regole `blocchi-*`); #281 aperta | fatto; dentro: la prova con persone, i 33 ms su 2.000 righe, la pagina del PDF nella nota | Fatto quando 6 e 7 | PA T16, T17 (chiude #281), T32 |
| K0 · misure dei motori | In `main` (`docs/misure/*-k0.md`) | fatto | — | — |
| K1 · i componenti | In `main` (#285, `crates/fub-componenti`) | fatto | — | — |
| K2 · la pagina «Componenti» | In `main` (#290, cd080044, 2026-11-09); la prova D-2 fatta dall'utente il 2026-11-09 | dentro | I componenti accesi e spenti | `piano/k2-pagina-componenti`, #290; la prova dell'utente prima del merge (D13 A) |
| K3 · lo strato dei motori | Fatto: in `main` con #295 (fb722164, 2026-11-08, unita dall'utente) | dentro | Word ed Excel | `piano/k3-motori`, #295 |
| K4, K7–K10 | Senza piano | fuori | Vedi sopra | «Piani di Fub» |
| K5 · il disegno | Ramo: 13 di 30; T9 fatto (il crate `fub-disegno`, la licenza IJG con eccezione stretta) | dentro | Il disegno SVG | `piano/k5-disegno`, #300 |
| K6 · il disegno completo | Ramo: 0 di 30 | fuori | Scelta dell'utente (D24 B) | #313 |
| Griglia · le celle | Ramo: 2 di 9 (T1 il piano a strati, T2 la carta e le righe che restano); il prototipo approvato dall'utente il 2026-11-07 (D2 A) | dentro | Il foglio che risponde subito | `piano/griglia-celle`, senza PR |
| Scrittoio 2 | Ramo: 25 di 29 (T1–T9, T11–T23, T27–T29; main unito, 54348679) | dentro | La cornice | `piano/scrittoio-2`, #309 |
| La lavagna in codice | Ramo: 0 di 26 | dentro | L'AI che disegna e dispone | `piano/lavagna-in-codice`, #311 |
| A1 · la base per l'AI | Ramo: 5 di 13 | dentro (F1) | Le ricette | `piano/a1-base-per-ai`, #305 |
| #304 · `/orchestra-auto` | PR pronta | fuori dal prodotto | È un attrezzo di lavoro | #304, la decide l'utente |
| Punto sciolto: il blocco di scrittura in sola lettura | Trovato: `FubSession::invoke_command` prende `write_turn()` anche per i comandi in sola lettura (`crates/fub-host/src/session.rs`); è scritto in DECISIONS (N7, 2026-11-04) ma l'issue non è mai stata aperta | dentro | L'AI legge (MCP, `canvas.read`) mentre la persona scrive | PA T3 |
| Punto sciolto: `windows-sys` | Già in `Cargo.lock` come dipendenza indiretta (cinque versioni, 0.45–0.61); serve diretta per il job object | dentro (D7 A) | È una dipendenza nuova, accettata | PA T9 |
| Punto sciolto: sei errori di tipo nei test dell'anteprima | Riprodotti con `tsc --noEmit` su `anteprima/tutto` (5006937c): tre in N4 e tre in K5 | dentro | Vengono dai rami indietro rispetto a `main` | PA T2 |
| Punto sciolto: una stringa inglese nel fake host | Non trovata: `bench/fake-english.test.ts` passa su `anteprima/tutto` | dentro: la cerca il coder (D10 B) | Da dove viene? | PA T10 |
| Punto sciolto: il conto dei diagrammi Mermaid | Non trovato: `check-mermaid.mjs` dà 40 blocchi validi su `main` e 45 sull'anteprima | dentro: lo cerca il coder (D10 B) | Da dove viene? | PA T10 |
| Punto sciolto: la pagina della cornice del telefono | Manca davvero: nessuna pagina in `docs/architecture/` | dentro | Docs che descrivono il presente | PA T8 |
| Punto sciolto: il vassoio più chiaro della fila e della colonna | Sul ramo di S2, T16 lo ha già messo (`--bar-tray`) | dentro: chiaro di serie, «marcate» in Aspetto (D6 C) | Qualità e accessibilità | PA T11 |
| #97 · CRLF e BOM nella lavagna | Corretto in `main` (0f39a80a, `editors/canvas/line-endings.test.ts`) | fatto | L'issue è ancora aperta | da chiudere (l'utente) |
| #216 · il vault lasciato aperto | Corretto in `main` (1d20ce96, `closeLeftVault` in `state/vault-session.ts`) | fatto | L'issue è ancora aperta | da chiudere (l'utente) |
| #237 R01–R04 | Aperti | dentro | Perdono dati | PA T4, T5, T12 |
| #237 R05–R08 e A03 | Aperti | dentro (D21 A) | Intoppi che chi prova incontra | PA T53 |
| #242 · il tema di CodeMirror in linea | Aperta | dentro (D22 A) | Un tema deve vestire anche l'editor di testo | PA T54 |
| #289 · congelare `fub:abi@0.2.0` | Aperta | dentro | Fatto quando 8 | PA T6, T7 |
| Test instabili (#70, #98, #270–#273, #279, #280, #284, #286, #287, #292, #293, #301, #310, #312) | Aperti | dentro | Bloccano la CI di rilascio | PA T19, T20, T21 |
| #283 · S7 su una GPU | Aperta | dentro | Il portatile Windows dell'utente ha una GPU | PA T16 |
| #281 · i Blocchi con cinque persone | Aperta | dentro | Fatto quando 7 | PA T17 |
| P00–P18 (#76–#93) | Vecchia mappa | fuori | Superata da N e K | le loro issue |
| Richiesta dell'utente: Fub verde di serie, col suo logo (2026-11-07) | La tinta di serie è la matita blu (265, `recipe.ts`); l'icona è un quadrato viola con una «F» (`crates/fub-app/icons`) | dentro | Fatto quando 10 | PA T48, T49; D25–D28 |
| La firma degli installer | `release.yml` costruisce senza firma | dentro per Windows; macOS per ora senza notarizzazione (D20) | Nessun avviso a chi installa su Windows | PA T50 |
| I riscontri della pre-alpha | Nessun modello di issue, nessuna voce nel menu | dentro (D9 B) | Più riscontri, più completi | PA T18, T52 |
| Il controllo di tutte le viste | Le viste del simulatore guardate a campione | dentro (D19 A) | Il difetto dei 44 px è venuto fuori guardando | sonda del 2026-11-07; PA T55 |
| Il telefono | La variante A di Scrittoio 2, «approvata per ora» | dentro: un piano suo prima dell'APK (D1 B) | L'APK deve essere quello giusto | piano del telefono, `PLAN-ui/fub-pre-alpha/prompt-piano-telefono.md` |
| Richiesta del manutentore: la skin facile (2026-11-05) | Verificato in `main` (638358da): la pelle di un tema è tutto o niente; `install_theme` c'è ma senza IPC; la fiducia `development` («In sviluppo») c'è già; nessuna modalità sviluppatore; il contratto `theme-2` non è congelato (12 commit dal 29 ottobre al 4 novembre); le icone passano da un registro solo | dentro: sei passi, più l'editor di testo (D22 A) | Fatto quando 9 | PA T34–T42, T54 |

### Le nove decisioni di «Prossime fasi»

| Decisione | Stato | Per la pre-alpha |
|---|---|---|
| 1 · l'inchiostro in `fub:ink`, dentro `.canvas` | Presa: ADR 0238 su `piano/n4-inchiostro` | dentro, con N4 |
| 2 · il riconoscimento delle forme e della scrittura resta | Presa: N6 T87 «Forme dal tratto» (D-22 a) | dentro, con N6 |
| 3 · niente export verso Excalidraw e draw.io | Presa con la chiusura di FubDraw (ADR 0231) | fatto |
| 4 · `.fubann` letto e convertito | In `main` (`crates/fub-host/tests/fubann_vault.rs`) | fatto |
| 5 · Linux via Flatpak | Presa dall'utente il 2026-11-07 (D8 B) | dentro: il Flatpak come file della release (PA T51); Flathub fuori |
| 6 · iPad e Android: prima un'app compagna | L'utente ha scelto l'APK di prova, con un piano del telefono prima (D1 B) | dentro: il telefono; fuori: il tablet e l'iPad |
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
| Rischio · l'app compagna per iPad | Decisione 6 di «Prossime fasi» | fuori (D1 B porta dentro solo il telefono) | #90 |
| N12 · i 16 ms del «/» nella WebView | Misurati solo in Chromium | dentro | PA T16 |
| N12 · il «/» nelle schede della lavagna | N6 T43 scrive le schede in Live, con «/» se l'editor delle note lo ha | dentro | N6 T43 |
| N12 · il «/» nelle celle del foglio | Le celle non sono testo Markdown | fuori | K9 |
| N13 · le coreografie | In `main`: `motion-rules.mjs`, regole `blocchi-*` e `slash-*` | fatto | — |
| N13 · i 33 ms su 2.000 righe | Misurati solo in Chromium | dentro | PA T16 |
| N1 · i 42 file `.rs` | Codice vivo, non resti: FubDraw è il nome del formato (ADR 0203). Restano per compatibilità il namespace `fub:`, `Status::Fubdraw` e l'abbinamento `fubdraw://live`. Le persone vedono il nome in tre stringhe del Rust e in una quarantina del client | dentro (D14 A) | PA T33 |
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
Lavorano due coder alla volta, Opus con ragionamento medio, e nessun altro
agente (regola dell'utente dal 2026-11-07, prima era un coder solo; cambia
solo se la cambia l'utente, `DECISIONS.md`); dal 2026-11-10, in più, coder
Haiku 5.5 per i task piccoli e medi. Dove va il codice e come entra
in `main` lo dice «Come si implementa», «Il ramo, le consegne e i due coder».
«Taglia» è a occhio, in tempo di un coder con revisione e CI: S un'ora o
due, M mezza giornata, L due o tre giorni, XL di più.

**Quanto ci vuole, a occhio.** Restano circa 207 task negli altri piani
(circa 79 solo in N6) e i 57 task di questo piano (PA T1–T57, tutti da
fare): circa 264 in tutto, più il piano del telefono (D1 B), che a occhio
ne porta una quindicina. Con circa 2 ore di un coder per task, revisione
e CI comprese, fanno circa 530 ore; i task della skin facile, del
secondo giro (T43–T47) e delle risposte (T48–T57) sono quasi tutti M e ne
aggiungono una quarantina; il telefono circa altre 40. In tutto circa 610
ore di lavoro. Con due coder insieme il tempo non si dimezza: la
revisione, la CI e le catene di «Dipende da» restano una alla volta, e
molti passi aspettano quello prima. A occhio il calendario scende a circa
due terzi, cioè circa 400 ore; a circa 14 ore al giorno sono circa 29
giorni, poco più di 4 settimane piene. Con le attese dell'utente (i
prototipi da approvare, il piano del telefono, i sì ai merge, la misura su
Windows, la prova con le persone, la firma di Windows, gli installer)
diventano **6–8 settimane**. N6 da
sola sono circa 160 ore, cioè 2–3 settimane con l'approvazione dei suoi
prototipi. La firma di Windows può allungare la coda: la risposta di
SignPath Foundation richiede giorni o settimane, e senza la firma PA T22
non chiude (D20).

Le assunzioni della stima: le 2 ore vengono dai piani recenti (il piano del
caricamento ha chiuso 4 task in circa 3 ore il 2026-11-04; i task M e L di
K3 sono durati di più); i task L e XL non rifanno pezzi grandi; le baseline
arrivano dal runner senza giri in più; l'utente risponde entro un giorno.
Se una di queste cade, la stima si allunga.

### Fase A · unire ciò che è finito e chiudere i buchi fra i piani

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| K3 T17 · il sì dell'utente | K3 | fatto: il sì è arrivato, #295 in `main` (fb722164) | nessuno | medio: un crate nuovo (`fub-motori`), patch nel `vendor/`, tre sistemi | — | il sì dell'utente |
| Unire #295 (K3, con K3-IPC T8) | K3 | fatto: in `main` (fb722164, 2026-11-08) | il sì dell'utente | medio | S | `main` ha `crates/fub-motori` e i comandi `open_key`, `warm_engine` e `document_closed` |
| Riallineare #290 a `main` e unirla | K2 | fatto: in `main` come cd080044 (2026-11-09), CI completa verde | la prova dell'utente col protocollo di K2, prima di segnarla pronta (D13 A) | basso | S | CI completa verde, OK dell'utente |
| PA T1 · il finto del banco con le impostazioni dell'host | PA | fatto (baseline delle impostazioni dal runner) | #295 in `main` (d90a09d0 di K3 cambia `bench/fake-ipc.ts`) | basso | S | `bench/fake-ipc.test.ts` |
| PA T3 · i comandi in sola lettura non tengono il turno | PA | fatto (5432f8b4) | nessuno | medio: tocca il custode | M | test d'integrazione di `fub-host` |
| PA T4, T5 · #237 R01–R03 | PA | T4 e T5 fatti (baseline di `conflitto-lettura` dal runner) | nessuno | medio: sessioni e conflitto | M + M | test di Vitest sulla sessione; R01 si chiude col test se non si riproduce |
| PA T6, T7 · #289 | PA | T6 e T7 fatti | T7 dopo T6 | medio: confine WASM | S + M | `wit_additivity`, componente vero |
| PA T58 · la guardia stretta anche per enum, variant e funzioni esportate | PA | fatto (ADR 0238) | T7 | medio: confine WASM, ADR 0235 | M | `wit_additivity`, componente vero anche per gli import |
| PA T8 · la pagina della cornice del telefono | PA | fatto | nessuno | basso | S | guardie dei documenti |
| PA T9 · su Windows il tempo scaduto ferma anche i figli | PA | fatto (in main, #317) | nessuno | medio: `windows-sys` diretta, solo Windows | M | test di `fub-motori` su Windows nella CI completa |
| PA T10 · i due punti sciolti da ritrovare | PA | fatto (in main, #319) | nessuno | basso | S | la causa trovata o la riga che chiude |
| PA T13 · il corpus senza perdite | PA | fatto (in main, #317) | nessuno; si allarga quando K5 e N4 entrano | medio | M | test d'integrazione di `fub-host` |
| PA T59 · un file in sola lettura non si sovrascrive | PA | fatto (in main, #317) | T13 | medio: la scrittura del kernel, tre sistemi | S | test del kernel e `prealpha_corpus` sui tre sistemi |
| PA T60 · le altre prove del lucchetto a un colpo solo | PA | fatto (in main, #319) | T19 | basso: solo test | M | 200 corse verdi delle due cadute |
| PA T61 · la CI Mobile per la cornice del telefono | PA | fatto (in main, #319; la CI Mobile è partita e passata) | nessuno | basso: solo il filtro di un workflow | S | una PR che tocca solo la cornice fa partire `mobile.yml` |
| PA T62 · la WebView fa pulizia prima di leggere la memoria | PA | fatto | T21 | basso: un gancio spento di serie, acceso solo dal banco | M | 5 corse di R1 sotto soglia, confrontate con 5 senza |
| PA T19 · i test instabili del Rust | PA | fatto | nessuno | medio | M | 200 giri verdi o causa trovata |
| PA T25 · il controllo degli aggiornamenti vede le pre-release | PA | fatto | nessuno | basso | S | test di `fub-host` (`updates.rs`) |
| PA T32 · `![[x.pdf#page=3]]` apre il PDF a quella pagina | PA | fatto | nessuno | basso | S | Vitest di `media.ts` e dell'apertura |
| PA T33 · il nome FubDraw dove le persone lo vedono | PA | fatto | nessuno | basso | M | test dei descrittori, di `fub-scene` e del catalogo |
| PA T34 · il manifest dice da quale tema parte | PA | fatto (in main, #319) | nessuno | medio: la forma del manifest sul filo | M | `crates/fub-host/tests/themes.rs`, mirror |
| PA T35 · la pelle del tema sopra quella di serie | PA | fatto (ADR 0240; in main, #319) | T34 | medio: tocca il montaggio di ogni tema | M | `theme/inherit.test.ts`, `gate.test.ts` |
| PA T39 · i caratteri del tema | PA | fatto (in main, #319) | T34, T35 | basso | M | test dell'host e del loader |
| PA T40 · le icone del tema | PA | fatto (D16 A; in main, #320) | T34, T35; mai nella stessa ondata di S2 T14 | basso | M | Vitest di `ui/icons` e di `theme/` |
| PA T44 · un documento e un foglio vuoti | PA | fatto (in main, #319) | nessuno | basso: due comandi che creano file, dietro le loro feature | M | test d'integrazione di `fub-host`, anche con `--no-default-features` |
| PA T46 · le parole della scheda di un componente | PA | fatto sul ramo del piano (2026-11-09) | K2 in `main` (fatto) | basso: solo testi del catalogo | S | `i18n/lexicon-settings.test.ts` |
| PA T47 · i 44 px del tocco sul telefono, senza deformare | PA | fatto (in main, #319, con le baseline del runner) | nessuno | basso: solo CSS del telefono | S | la scena `mobile-settings` di `bench/scene.mjs` (`bench:verify`, `bench:a11y`) |
| PA T48 · il verde di serie | PA | fatto (D25 C; in main, #320, con le baseline dal runner) | niente (il logo definitivo conferma 160); mai con un task che rifà baseline | medio: cambia ogni schermata, le baseline vengono dal runner | M | `recipe.test.ts`, `colori.test.ts`, `theme:verify`, `cargo test -p fub-host` |
| PA T53 · #237 R05–R08 e A03 | PA | R05–R08 fatte (in main, #320); A03 dopo S2 T10 (D21 A) | S2 T10 per A03 | basso | M | un test per voce nel proprietario |
| PA T54 · l'editor di testo vestito dal tema | PA | fatto | T35; prima di T41; mai con S2 T20 o la griglia T2–T3 | medio: tocca la pelle di ogni tema | M | Vitest di `theme.ts`, `check-inline-theme.mjs` |

### Fase B · la cornice

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Scrittoio 2 T3–T29 | S2 | 25 di 29 (T1–T9, T11–T23, T27–T29; T29 le annotazioni nel visore del PDF); T10 sbloccato (K2 in `main`) | K3 in `main` per T20 e T21, che rifanno la barra a schede dalle regole di K3 T18; T22 costruisce la forma A (D5 A); T23 aggiunge solo l'icona (N6 vince sulla lavagna) | medio: tocca quasi ogni pelle; le baseline vengono dal runner (T25) | L | S2 T26 e la CI completa |
| PA T2 · N4 e K5 allineati a `main` | PA | fatto | #295 in `main` | basso | S | `tsc --noEmit` pulito sui due rami |
| PA T11 · il vassoio delle barre | PA | da fare (D6 C: chiaro di serie, «marcate» in Aspetto) | S2 T20 | basso | S | Vitest delle preferenze, foto del banco |
| Il piano del telefono | telefono | da pianificare (D1 B) | S2 in `main`; un pianificatore alla volta | medio: rifà la cornice del telefono prima dell'APK | L | il piano approvato e i suoi task in `main` |
| PA T20, T21 · i test instabili del client e del banco | PA | T20 fatto (in main, #320); T21 integrato (#284 in parte) | nessuno | medio | M + M | 50 giri verdi o causa trovata |
| PA T36 · installare da cartella, e la diagnosi | PA | da fare | T34; S2 T10 | medio: un'IPC nuova che scrive nella configurazione | M | test di `fub-host`, Vitest delle Impostazioni |
| PA T37 · collegare una cartella, il tema cambia al salvataggio | PA | da fare | T36 | medio: un osservatore nuovo | M | test di `fub-host` con l'evento, Vitest |
| PA T38 · la pagina «Tutti i componenti» | PA | da fare | T35, T36; S2 T10 | basso | M | foto del banco uguali, bundle iniziale uguale |
| PA T43 · «Nuovo» chiede il tipo | PA | da fare | S2 T8 e T14; l'approvazione di S34; T44 per due voci | basso | M | Vitest di `ui/commands` e dell'albero, la scena di S34 nel banco |
| PA T56 · la carta del file e il fuoco | PA | da fare (D19 A) | S2 in `main`; T48; mai nella stessa ondata di T54, della griglia T2–T3 o di S2 T20 | basso: CSS e due tabelle in TypeScript; le baseline vengono dal runner | M | Vitest di `FIELD_LAYOUT` e di `nodeFill`, `bench:a11y` |
| PA T57 · i bersagli e i nomi interi | PA | da fare (D19 A) | T56 | basso: la barra a schede si allunga di 10 px per pulsante diviso | M | Vitest dei suggerimenti, `bench:a11y` |

### Fase C · gli editor

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| Griglia T1–T9 | griglia | 2 di 9 | #295 in `main` (il ramo nasce da K3); T2 e T3 mai insieme a S2 T20 (tutti e tre toccano `skin/editors.css`) | medio: il motore della griglia | L | griglia T8 (foto contro `celle-griglia`) |
| PA T12 · #237 R04 | PA | da fare | griglia T4 | medio | M | test di Vitest sulla griglia |
| N4 T23–T25 | N4 | 22 di 25 | PA T2; T24 aspetta l'esito della prova con Obsidian, che incolla l'utente | medio: penna e latenza | L | N4 T25 |
| N6 v1, senza T79–T85 e T88 | N6 | 17 di 90 | N4 in `main` (il ramo nasce da N4, e T90 lo chiede); i task grafici dopo l'approvazione dei prototipi T26–T28 (D3) | alto: 79 task | XL | N6 T90 |
| K5 T11, T13–T24, T27–T30 | K5 | 13 di 30 | PA T2; T6 copia `Fubeo/vectorcraft` (c'è, pubblico, 2026-11-02); T22 dopo D5; T24 dopo K2 in `main` (fatto) | alto: motore vettoriale nuovo | XL | K5 T30 |
| La lavagna in codice T1–T26 | lavagna in codice | 0 di 26 | T15–T18 dopo N4 in `main`; T14, T19, T23 e T24 dopo N6 in `main` (T72, T73, T19, T37, T48) | medio | L | lavagna in codice T26 |
| A1 T4, T5, T7, T9–T13 | A1 | 5 di 13 | T12 dopo S2 T10 (le impostazioni) | basso | M | A1 T13 |

### Fase D · la prova e la pre-release

| Passo | Fonte | Stato | Dipende da | Rischio | Taglia | Prova di chiusura |
|---|---|---|---|---|---|---|
| PA T41 · gli hook congelati | PA | da fare | Fase C in `main`; T34–T40 | basso per il codice, alto se si sbaglia il momento | S | `contract-frozen.test.ts` |
| PA T42 · tre temi d'esempio | PA | da fare (D17 C: Carta, Officina, Mare) | T41, T54 | basso | M | `examples.test.ts`, scene del banco |
| PA T49 · il logo | PA | fatto sul ramo del piano (2026-11-09; D28: logo e nome riservati, codice libero); baseline dal runner con la consegna 4 | T48 | medio: icone, la ricetta e la serie dei temi; gli hook restano | M | le icone generate, le scene del banco |
| PA T55 · il controllo di tutte le viste nel banco | PA | da fare (D19 A) | S2 in `main`; T47, T56 e T57; prima di T15 | basso | M | `bench:viste` verde, rosso sulla scena di prova |
| PA T14 · il giro nel banco: lo scheletro e il primo avvio | PA | da fare | Fase B in `main` | medio | M | `npm run bench:giro` verde sui compiti 1–5 |
| PA T26 · il giro: le note | PA | da fare | T14 | basso | M | compiti 6–11 verdi |
| PA T27 · il giro: Word, Excel, SVG e PDF | PA | da fare | T14; griglia e K5 in `main` | medio | M | compiti 12–15 verdi |
| PA T28 · il giro: la lavagna e la penna | PA | da fare | T14; N4 e N6 in `main` | medio | M | compiti 16–17 verdi |
| PA T29 · il giro: ricette, componenti e aspetto | PA | da fare | T14; A1 e K2 in `main`; PA T36 e T42 in `main` | basso | M | compiti 18–20 verdi |
| PA T30 · il giro: conflitto, sola lettura, cestino, tastiera e guasti | PA | da fare | T14; PA T4 e T5 | medio | M | compiti 21–27 verdi |
| PA T15 · il simulatore accanto all'app | PA | da fare | Fase C; T14 e T26–T30 (le loro scene danno le foto) | basso | S | il foglio di contatto rivisto dall'utente |
| PA T16 · le misure della WebView | PA | da fare | Fase C; la misura di Windows usa l'MSI della prova di T22 | medio: Windows lo misura l'utente | M | la pagina delle misure |
| PA T45 · cinquemila file: la misura | PA | da fare | S2 in `main` | basso: misura, non cambia l'albero | M | `npm run bench:tree` con le soglie; se una salta, la issue |
| PA T17 · la prova con cinque persone | PA | da fare | PA T14 per il protocollo; la prova usa gli installer di T22 | basso per il codice; serve l'utente | S + la prova | il resoconto della prova |
| PA T18 · i documenti della pre-alpha | PA | da fare | Fase C | basso | S | guardie dei documenti |
| PA T52 · «Segnala un problema» | PA | da fare (D9 B) | T18; S2 in `main` | basso: il browser apre la pagina, Fub non manda niente | S | Vitest della funzione dell'indirizzo e del menu |
| PA T50 · la firma degli installer di Windows | PA | aspetta la risposta di SignPath Foundation (D20: Windows sì, macOS per ora no) | i segreti nel repository | medio: la firma nella CI di rilascio | M | `signtool verify` nella corsa a secco; `codesign --verify` sulla firma ad hoc del dmg |
| PA T51 · Flatpak | PA | da fare (D8 B) | prima di T22 | medio: i permessi e l'osservatore dei file | M | `flatpak install --user` e i compiti 1, 6 e 21 |
| PA T31 · l'APK nell'emulatore della CI | PA | da fare | niente; la foto si rifà quando il piano del telefono è in `main` | medio: emulatore su runner Linux | M | il job `mobile.yml` installa, apre e fotografa l'APK |
| PA T22 · la versione e la prova del rilascio | PA | da fare | T14, T18, T25; T19–T21; T31, T50, T51; il piano del telefono in `main` (D1 B) | alto: MSI e versione non numerica | M | `release.yml` verde in prova, installer firmati, `.flatpak` e APK |
| PA T23 · il giro a mano sugli installer e sul telefono | PA | da fare | T22, T31; per macOS la persona o il Mac trovati dall'utente (D11 B) | medio | M | la lista del giro spuntata |
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
- **Che cosa c'è.** K2 è in `main` (#290, cd080044, 2026-11-09). Gli
  strumenti MCP `components_*` erano già in `main` con N2.
- **Su disco.** Le chiavi `components.*` nelle impostazioni del vault, e i
  bundle spenti in `plugins.disabled`, la chiave di oggi.
- **Che cosa manca.** Niente: la prova D-2 l'ha fatta l'utente il
  2026-11-09, prima del merge (D13 A).

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
  6. Tre temi d'esempio, la prova d'uscita (T42).
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

Il simulatore sta in `PLAN-ui/fub-pre-alpha/`. Si apre col doppio clic su
`simulatore.html`, senza server (va bene anche un server statico
qualsiasi). In questa sezione i percorsi senza `apps/client/` davanti
stanno sotto `apps/client/src/`.

| File | Che cos'è | Si copia nell'app? |
|---|---|---|
| `simulatore.html` | la pagina: i comandi in alto, lo schermo, la didascalia e gli elenchi sotto; in testa il CSS nuovo, un blocco `<style data-destinazione="…" data-task="…">` per file | i blocchi `data-destinazione` sì, il resto no |
| `sim-dati-1.js` | i 298 stati impacchettati (5 MB): il DOM e il CSS di ogni cattura nelle due luci, le toppe, i temi e i caratteri | il DOM, come dice «Come si leggono il DOM e il CSS» |
| `sim-stati.js` | l'elenco degli stati (numero, nome, gruppo, provenienza, task, pagina del piano) e gli scenari | no |
| `vista-sim.js`, `solo-simulatore.js` | il motore: monta uno stato, risponde ai clic e ai tasti, fa i passi degli scenari e i gesti del telefono | no |
| `piani/*.html` | le sei pagine approvate dei piani, tali e quali | restano la fonte dei loro piani |
| `blocchi/*.css` | il CSS nuovo, un file per blocco, con la destinazione e il task nella prima riga | sì |
| `toppe/*.html` | il DOM scritto a mano dei pezzi nuovi, un `<template>` per pezzo, con la destinazione e il task | sì |
| `script/` | ciò che rifà il simulatore e le sue prove («Rifare il simulatore», sotto) | no |
| `dal-prototipo.md` | le tabelle in fondo a questa sezione, generate dalla costruzione | no |
| `scelte.html` | la pagina delle scelte (artifact «Le scelte di Fub pre-alpha»): le domande, le risposte, gli stati da approvare | no |
| `prompt-piano-telefono.md` | il prompt del pianificatore del telefono (D1 B), da avviare quando Scrittoio 2 è in `main` | no |
| `logo/`, `verde/` | Marcuzzo (D26): gli originali dell'utente in `logo/originali/`, le quattro forme (intera, minima 24 e 16, simbolica), i contrasti misurati in `logo/misure.json`; le foto delle tinte di D25 della pagina delle scelte | sì: le forme si copiano in `assets/logo/` con PA T49 |

In alto si scelgono lo stato, lo scenario, la luce (Giorno, Notte), la
larghezza (Piena, 700 px, Telefono) e il movimento (Pieno, Calmo, Ridotto).
«Fuoco sul controllo principale» mette il fuoco dove lo metterebbe l'app.
«Segna il nuovo» contorna il DOM scritto a mano (in rosa) e quello composto
(in verde). L'indirizzo ricorda tutto (`#stato=…&luce=…&larghezza=…&moto=…`,
più `scenario=…&passo=…`), così un link porta a uno stato preciso. Uno
scenario mostra i suoi passi sopra lo schermo, con «← Indietro», «Avanti →»
e, quando un clic ha portato altrove, «Torna al passo». Quando uno stato ha
un'altra forma da confrontare (D5, D9), una seconda figura la mostra
accanto.

Sotto lo schermo:

- **la didascalia**: il numero, il nome e la provenienza dello stato, che
  cosa dice, il task e la pagina del piano. «Da rivedere» (solo sugli stati
  composti e nuovi) lo mette nell'elenco dell'approvazione; «Aspetto di
  serie» toglie le scelte fatte in Impostazioni › Aspetto;
- **«I pezzi di questo stato»**: per ogni pezzo il file, il task e «nuovo»,
  «composto», «cambiato» o «uguale». «Indica» lo segna nello schermo, «DOM»
  mostra il DOM da copiare;
- **«Approvare gli stati nuovi e composti»**: l'elenco e la frase pronta
  (sotto);
- **«Che cosa si può fare nello schermo»** e **«I clic che non portano
  altrove»** (oggi nessuno);
- **«Il CSS nuovo, per file di destinazione»** e **«Le pagine dei piani»**.

### Gli stati, la provenienza e l'approvazione

Gli stati sono 298, da S1 a S298. I numeri sono fissi
(`script/numeri-sim.json`): uno stato nuovo prende il numero dopo l'ultimo,
uno tolto lascia il buco. Ogni stato dice la sua provenienza nella
didascalia, nel menu degli stati e nella tabella «Gli stati», sotto:

- **cattura** (168): il DOM del client vero, fotografato dal banco
  (Playwright, finto host) con i ritocchi di Scrittoio 2 già montati. Il
  client è quello che ha fotografato il prototipo approvato di Scrittoio 2
  (il ramo locale `anteprima/tutto`); gli stati d'avvio vengono dallo stesso
  ramo con #308 (5006937c). Dal 2026-11-07 le catture sono rifatte col
  verde di serie e col logo Marcuzzo (le toppe verdi del finto, «Rifare
  il simulatore»). Non è nell'elenco da approvare: è il client di oggi con i
  ritocchi già approvati, più il verde di D25 e il logo di D26.
- **composta** (67): DOM vero, spostato o ritoccato. Sono gli editor delle
  pagine dei piani messi nella cornice di Scrittoio 2 (D4 A: la griglia, il
  disegno di K5, le schede della lavagna, le penne, i componenti del disegno,
  le ricette e le loro Impostazioni), più cinque catture cambiate solo nel
  testo o nelle righe (D4). La pagina del piano resta la fonte del pezzo; lo
  stato composto dice dove sta nella cornice.
- **nuova** (63): DOM scritto a mano (`toppe/*.html`), con il CSS dei
  blocchi `92-*` e `93-*`. Sono gli stati che nessun piano aveva disegnato:
  N6 T26–T28 (D3), la banda del motore di D5 A, i file che non si aprono, i
  componenti della comunità, i temi d'esempio e la skin facile, «Le barre»
  di D6 C, i riscontri di D9 B, ciò che ha fatto un agente (N2), `#page=3`,
  il foglio vuoto e quello enorme.

**L'approvazione.** Il 2026-11-07 l'utente ha approvato i 118 stati
composti e nuovi di allora, per gruppi. Le risposte dello stesso giorno ne
hanno cambiati alcuni e ne hanno aggiunti dodici (S287–S298): «Gli stati
cambiati dalle risposte», sotto, li elenca, e lo scenario «Che cosa è
cambiato» li passa in ordine. Il sì sul simulatore aggiornato è arrivato
lo stesso giorno («Per il resto il piano è approvato») e vale per tutti i
130 stati composti e nuovi. In «Approvare gli stati nuovi e
composti» si segnano quelli da rivedere (anche con «Da rivedere» sotto lo
schermo), e la frase si scrive da sola, per esempio «Approvo tutti gli stati
nuovi e composti tranne S23, S41.». «Copia la frase» la copia; i segni
restano in quel browser. Uno stato approvato diventa la fonte del suo task,
come una pagina approvata di un piano.

**Gli scenari** sono 18: i 16 chiesti, la skin facile e «Che cosa è
cambiato». La tabella «Gli scenari», sotto, dà per ognuno i passi e gli
stati in ordine.

### Gli stati cambiati dalle risposte

Le risposte del 2026-11-07 cambiano questi stati, già approvati, e ne
aggiungono dodici. Lo scenario «Che cosa è cambiato» li mostra uno dopo
l'altro.

| Stati | Che cosa cambia | Da dove |
|---|---|---|
| tutti | il verde di serie, tinta 160 «Smeraldo», al posto del blu 265: la cornice, i bottoni, la scelta, i collegamenti, l'anello del fuoco e il velo sulle superfici, nelle due luci e col contrasto alto. Il vassoio delle barre segue la tinta (`#f8faf8`, `#18211c`). I colori di stato restano 30° lontani dall'accento: il «salvato» va a 130 | D25 C, PA T48 |
| tutti quelli col marchio, S246, S248–S250, S267 | Marcuzzo nel marchio, in Informazioni e nell'avvio, al posto della «f» corsiva; la cartella ha il colore della tinta o del tema e regge il contrasto col fondo | D26, PA T49 |
| S234 | Aspetto: «Smeraldo» è il primo campione e quello di serie; «Matita blu» resta fra i campioni | D25 C, PA T48 |
| S294–S296, nuovi | «Le barre: chiare · marcate» in Aspetto, e una nota con le barre marcate | D6 C, PA T11 |
| S125–S130 | il disegno nella forma A, quella scelta: senza la figura di confronto accanto | D5 A |
| S287–S293, nuovi | i casi che c'erano solo in B, nella forma A: 500 parti, senza motore, la modifica rifiutata (con l'annuncio per il lettore di schermo), Testo spento, la mano, la gomma, il rettangolo | D5 A |
| S111–S124 | la forma B resta solo come confronto: la didascalia dice «D5 B: non si costruisce» | D5 A |
| S255, S256 | «Segnala un problema» nel menu: la forma scelta, senza confronto | D9 B, PA T52 |
| S254 | la forma A dei riscontri: «non si costruisce» | D9 B |
| S204–S207 | la scheda del componente con le parole del lessico: «Acceso», «Togli» | D18 A, PA T46 |
| S282, S283 | «Carta»: i titoli, la citazione e i tag dell'editor vestiti dal tema; la linguetta accesa con un filo d'accento dentro la linguetta; il vassoio delle barre e l'ombra del foglio ripiegano su quelli del tema (`var(--bar-tray, var(--sheet-2))`), come nel prodotto: prima il simulatore teneva quelli della serie | D22 A, PA T42, PA T54 |
| S284, S285 | «Salvia» diventa «Mare»: un blu profondo e superfici grigio-azzurre, soli colori | D27 A, PA T42 |
| S297, S298, nuovi | «Officina», chiaro e scuro: acciaio e arancio, angoli vivi, bordi di 2 px, etichette in monospazio, l'editor vestito | D17 C, PA T42, PA T54 |

Il controllo di tutte le viste (D19 A, «Il controllo di tutte le viste»)
cambia anche questi. Quasi tutti si vedono solo in un punto, o solo col
bottone «Fuoco»:

| Stati | Che cosa cambia | Da dove |
|---|---|---|
| i fogli con la barra a schede (27 stati fra S42 e S82) | la freccia di un pulsante diviso è larga 24 px, non 14: la fila si allunga di 10 px per pulsante diviso. È il cambio che si vede di più | D19 A, PA T57 |
| i fogli (S42–S82) al buio | sulla carta del file la cella attiva, la selezione e il quadratino del riempimento hanno l'accento della carta (verde scuro), non quello del tema; la formula nella cella in modifica è d'inchiostro, come in Excel, senza la striscia scura a sinistra; l'anello della griglia è dell'accento della carta | D19 A, PA T56 |
| S5, S33, S210, ogni editor, col bottone «Fuoco» | l'anello dell'editor, dell'anteprima e del grafo sta dentro il bordo, e si vede | D19 A, PA T56 |
| S83 nello stretto, col bottone «Fuoco» | l'anello della pillola dei commenti sta dentro la pillola | D19 A, PA T56 |
| S23, S30, S32, S33, S41 | l'azione di un avviso («Decidi dopo», «Riprova», «Chiudi», «Scegli ora») è un verde più scuro | D19 A, PA T56 |
| S132 | le schede colorate della lavagna sono piene: il colore sulla carta della scheda, senza la scrivania sotto | D19 A, PA T56 |
| S3, S8 | il «+» e la maniglia del blocco sono 24 × 24 e un po' meno tenui | D19 A, PA T57 |
| S56 | i quadretti della tavolozza stanno a 6 px l'uno dall'altro: la tavolozza è larga 234 px | D19 A, PA T57 |
| S7, S19, S179, le impostazioni (S183–S208, S233–S246) | il percorso a briciole e le etichette XMP alti 24 px; nell'indice delle impostazioni «Permessi dei componenti inclusi» va a capo invece di finire in «…» | D19 A, PA T57 |
| S166 | il campo «Pagine» è il campo del kit (`kit/field.ts`), con la sua scatola e il suo anello: prima era un campo nudo, senza fuoco visibile | D19 A, N6 T28 |
| S232 | la riga dell'agente ha il testo intero nel suggerimento | D19 A, PA T26 |
| S26, S28 al telefono | nel cestino e nelle versioni i bottoni di 44 px stanno a 8 px l'uno dall'altro | D19 A, PA T47 |
| S83 al telefono, col bottone «Fuoco» | l'anello del tondo della modalità sta dentro il tondo | D19 A, PA T47 |

### Come si leggono il DOM e il CSS

- **Il DOM, secondo la provenienza.**
  - *cattura*: il DOM di oggi, con le classi, i ruoli, gli ARIA e i
    `data-i18n` del client. Dove «I pezzi di questo stato» dice «uguale», il
    DOM è quello di `main` e si copia solo la pelle. Dove dice «cambiato», è
    il DOM che il task di Scrittoio 2 costruisce (il ritocco montato nella
    foto), e la fonte resta il prototipo di Scrittoio 2.
  - *composta*: il DOM della pagina del piano, nella cornice. Si costruisce
    dal piano e dal suo `PLAN.md`; il simulatore dice solo dove sta.
  - *nuova*: il DOM di `toppe/*.html`. Ogni `<template>` ha in testa il
    commento `<!-- → file di destinazione; task -->`, e nello schermo il
    pezzo porta `data-sim-toppa` (si vede con «Segna il nuovo»). La tabella
    «I pezzi nuovi», sotto, li elenca tutti.
- **Una fonte sola per il CSS.**
  - Per Scrittoio 2 vince il prototipo approvato del suo piano
    (`PLAN-ui/scrittoio-2.html` sul ramo `piano/scrittoio-2`). I 18 blocchi
    del simulatore che vengono da lì (struttura, pelle, telefono, serie)
    devono coincidere con i suoi, tolte le varianti «com'era», i commenti e
    gli spazi. Lo controlla `script/prova-css-fonte.mjs`: 18 uguali su 18,
    2026-11-06, contro fe4d84c4. Se il prototipo di Scrittoio 2 cambia, si
    ricopia il blocco da lì e si rifà il simulatore, mai il contrario.
  - Per i pezzi di questo giro la fonte è il blocco del simulatore:
    `blocchi/92-prealpha-*.css` e `blocchi/93-tema-*.css`, ognuno col file di
    destinazione e il task nella prima riga. La tabella «Il CSS nuovo»,
    sotto, li elenca.
  - Le catture non portano il CSS nuovo: il banco lo monta per la foto, ma
    nei dati finisce il CSS del client (`script/cattura.mjs`). Il simulatore
    rimonta i blocchi sopra ogni cattura, così ne esiste una copia sola.
  - I tre temi d'esempio (`93-tema-carta.css`, `93-tema-officina.css`,
    `93-tema-mare.css`; PA T42, D17 C, D27 A) non sono CSS del prodotto: il
    simulatore li monta solo quando Impostazioni › Aspetto sceglie «Carta»
    (che ha solo la luce del giorno: di notte resta il tema di serie),
    «Officina» o «Mare». Non entrano nelle catture, e il confronto dei
    pixel li lascia fuori.
- **Il sanitizer del tema.** I blocchi che vanno in `skin/` passano
  `themeCssViolations` col profilo `theme-2` e `kind: "skin"`, con i ganci di
  oggi più quelli nuovi elencati sotto: zero violazioni, 2026-11-07. I tre
  temi d'esempio (`93-tema-*`) passano coi soli ganci di oggi, e tengono le
  coppie di contrasto di `theme-2` in ogni luce che hanno, col contrasto
  normale e con l'alto. Le prove sono `script/sonda/pelle.test.ts` e
  `script/sonda/temi.test.ts`. Nell'app `structure.css`, `mobile.css` e
  `series.ts` non passano dal sanitizer.
- **«Solo simulatore».** `vista-sim.js`, `solo-simulatore.js`, lo
  `<script>` in fondo a `simulatore.html` e gli attributi `data-sim-*`: i
  passaggi fra gli stati, i menu sovrapposti, i gesti, il segno di «Indica».
  **Non si copiano**: nell'app gli stessi comportamenti li danno il
  contratto, i registri, i comandi e le sessioni.
- **Lo stile in linea.** Nel markup degli stati non c'è nessun attributo
  `style=`: 0 nelle 632 catture impacchettate (316 schermi nelle due luci),
  0 nelle toppe, e la costruzione rifiuta una toppa che ne ha uno. Le misure
  che l'app scrive in linea dal suo codice restano nel codice, come oggi.

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

La tabella «Il CSS nuovo», in fondo alla sezione, dà per ogni file di
destinazione i blocchi, il task e il peso. Due fonti, secondo la regola di
«Una fonte sola per il CSS»:

- i blocchi `00-*` … `90-*` sono il CSS del prototipo approvato di
  Scrittoio 2, unito per file. Il dettaglio riga per riga (quali righe,
  quale task) è nella tabella «Dal prototipo» del `PLAN.md` di
  `piano/scrittoio-2`, che resta la fonte;
- i blocchi `92-prealpha-*` e `93-tema-*` sono di questo giro, e la fonte
  sono loro.

Fuori dai blocchi restano due cambi: `theme/scrittoio/anatomia/*.ts`
dichiara i ganci nuovi elencati sotto (col task del blocco che li usa), e
`bench/fake-ipc.ts` aggiunge la riga «Animazioni» delle impostazioni
(PA T1).

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
  `status-standing`, `status-standing-mark`;
- **lavagna** (N6 T26–T28, PA T28, `92-prealpha-lavagna.css`): `lav-empty`,
  `lav-empty-body`, `lav-empty-title`, `lav-exit-hint`, `lav-format-bar`,
  `lav-lasso`, `lav-option-text`, `lav-parts`, `lav-parts-field`,
  `lav-parts-hint`, `lav-parts-thumb`, `lav-parts-thumbs`,
  `lav-parts-title`, `lav-selection`, `lav-selection-count`;
- **disegno e file Craft vuoti** (PA T27, T30): `draw-empty-hint`,
  `craft-empty-actions`;
- **i temi** (PA T36–T38, `92-prealpha-impostazioni.css`): `tema-diagnosi`,
  `tema-diagnosi-codice`, `tema-diagnosi-dove`, `tema-diagnosi-file`,
  `tema-diagnosi-lista`, `tema-diagnosi-perche`, `tema-diagnosi-riga`,
  e per «Tutti i componenti» `dev-catalog`, `dev-catalog-*`, `dev-font`,
  `dev-font-sample`, `dev-swatch`, `dev-swatch-chip`, `dev-swatches`.

### Le pagine dei piani

Le pagine scritte a mano dai pianificatori stanno tali e quali in `piani/`,
e restano la fonte dei loro pezzi. Con D4 A sono anche composte nella
cornice di Scrittoio 2: gli stati composti dicono dove sta ogni pezzo, la
pagina dice com'è fatto. La didascalia di ogni stato composto porta alla
sua pagina.

| Pagina | Piano e task | Approvata | Stati composti | Dove va ogni pezzo |
|---|---|---|---|---|
| `piani/menu-comandi-fogli.html` | K3 T12 | 2026-11-03 | nessuno: è una cattura (S44–S48) | già nel codice del ramo (K3 T14) |
| `piani/celle-griglia.html` | griglia | non scritta (D2) | S73–S80 | `PLAN.md` di `piano/griglia-celle`, «Dal prototipo» |
| `piani/disegno-motore.html` | K5 T25 | 2026-11-05 | S111–S124, S188–S190 | `PLAN.md` di `piano/k5-disegno` (T21–T23) |
| `piani/lavagna-penne.html` | N4 T20 | 2026-11-02 | S148–S154, S245 | `PLAN.md` di `piano/n4-inchiostro` (T21) |
| `piani/lavagna-schede.html` | N6 T25 | 2026-11-04 | S133–S147, S244 | `PLAN.md` di `piano/n6-lavagna` |
| `piani/ricette.html` | A1 | 2026-11-03 | S191–S203 | `PLAN.md` di `piano/a1-base-per-ai` (T12) |

Senza una pagina approvata, e quindi stati nuovi da approvare in questo
giro:

- N6 T26–T28 (D3): S155–S166;
- le tre voci della lavagna in codice (pezzi del kit che ci sono):
  S167–S169;
- la forma A di D5 (il motore nella banda, la colonna con Testo):
  S125–S130;
- i file che non si aprono, i componenti della comunità, i temi, i
  riscontri di D9 B, N2, `#page=3` e i fogli ai bordi: gli altri stati
  «nuova» della tabella «Gli stati»;
- le scene del giro (PA T14), che usano solo stati di questa sezione.

### Si usa come il prodotto

`script/prova-sim.mjs` apre il simulatore com'è sul ramo e fa tre giri.

1. **Ogni stato, ogni controllo.** Monta ogni stato a ogni larghezza (a
   tutta larghezza nelle due luci) e chiede al simulatore che cosa farebbe
   ogni controllo visibile: bottoni, voci, campi, righe dell'albero,
   linguette. Un esito va bene quando porta a un altro stato, torna
   indietro, apre un menu o un cassetto, cambia lo schermo, dice con un
   avviso preciso che cosa farebbe l'app, o è un controllo spento o nativo
   (un campo che prende il testo). Non va bene l'avviso generico, che non
   dice niente: un controllo così deve avere un esito suo, o stare fra le
   eccezioni scritte (`script/eccezioni-sim.mjs`) con la ragione.
2. **Clic veri.** Per ogni stato, un controllo per ogni tipo di esito
   riceve un clic di Playwright nello schermo, e il clic deve cambiare
   qualcosa: lo stato, l'avviso sotto lo schermo o il DOM. Un clic sul velo
   di un dialogo o di un cassetto deve chiuderlo.
3. **Gli scenari.** Ognuno si percorre coi bottoni della pagina, e ogni
   passo si fotografa.

Il giro del 2026-11-07 sera, sul simulatore di questo ramo con Marcuzzo
(298 stati, coi blocchi di PA T47, T56 e T57), dice «errori: nessuno»:

| Larghezza | Stati montati | Controlli chiesti | Clic veri | Coperti |
|---|---|---|---|---|
| piena (nelle due luci) | 596 | 19.342 | 1.309 | 71 |
| 700 px | 298 | 13.176 | 1.293 | 101 |
| telefono | 298 | 7.656 | 409 | 53 |

Rispetto al giro col primo logo cambia solo `g2-foglio-ribbon-palette`,
ricatturata: la tavolozza si apre 20 px più a destra (la freccia del
pulsante diviso è larga 24, PA T57), e copre sei celle del foglio in più a
tutta larghezza e a 700; al telefono otto quadretti di colore escono dallo
schermo ed entra «Bordi». In `g2-raw-girato` lo zoom della foto dice −77 %
invece di −78 %. Rifatto la notte del 2026-11-07 sul simulatore con le
forme piccole del logo senza l'occhio ingrandito (`sim/out-v9`), dà gli
stessi numeri e di nuovo «errori: nessuno».

Al telefono le schede «Vault» e «Informazioni» degli stati delle
impostazioni scorrono fuori dalla riga, intere (PA T47), invece di starci
dentro troncate: fuori vista non si chiedono. A tutta larghezza e a 700 il
blocco del telefono non vale.

Gli esiti dei 19.342 controlli a tutta larghezza: porta a un altro stato
7.932, cambia lo schermo 5.104, avviso preciso 2.781, nativo (un campo che
prende il testo, una zona che prende il fuoco o scorre) 1.022, apre un
menu, un cassetto o un dialogo 855, avviso della zona 847 (dice che cosa fa
nel prodotto quella zona, per esempio la griglia del foglio, e il task che
la costruisce), spento 474, torna indietro 314, menu dell'applicazione 13.
Nessun avviso generico.

«Coperti» sono controlli che stanno sotto qualcosa che non è un controllo
(il velo di un dialogo, un livello sopra): nell'app il clic non li
raggiunge, e nel simulatore nemmeno. Non sono clic morti; l'elenco è in
`coperti-<larghezza>.tsv`, accanto alle foto della prova.

Gli scenari: 18, e i loro 136 passi fotografati.

### I pixel contro la fonte

`script/foto-sim.mjs` fotografa ogni stato del simulatore nelle due luci,
a ogni larghezza che ha, col movimento ridotto, e lo confronta con la sua
fonte (pixelmatch, soglia di colore 0,1):

- uno stato **cattura** contro la foto del client presa dal banco nello
  stesso momento del DOM;
- uno stato **composto** o **nuovo**: la parte di client fuori dagli
  strati, dalle toppe e dai pezzi presi da un'altra cattura, contro la foto
  del client da cui viene; ogni strato (una pagina di un piano messa nella
  cornice) contro la pagina approvata, a tutta larghezza, portato per un
  momento alla misura della pagina. A 700 px e sul telefono la pagina
  approvata non ha una foto sua, quindi lo strato lì non si confronta;
- il DOM scritto a mano (le toppe) non ha una fonte in pixel: la sua fonte
  è lui stesso, e si approva guardandolo (S-numeri in «Gli stati»).

Sopra lo 0,5 % dei punti una differenza va spiegata. Una spiegazione vale
solo se, tolta dal confronto la zona che spiega, il resto scende sotto la
soglia: la riga del confronto (`confronto.tsv`) scrive quanto resta. Le
zone si sommano, nell'ordine:

1. il DOM nuovo (toppe e pezzi di altre catture) e gli elementi a cui una
   toppa cambia testo, attributi o classi;
2. S2 T3 sul telefono: la testata, il bottone della modalità, la barra di
   formato e il bottone del lato, che nel simulatore stanno dove li mette
   T3 e nella foto dove sono oggi;
3. l'anello del fuoco della pagina approvata, che il DOM copiato non porta
   (nel simulatore si vede col bottone «Fuoco»);
4. PA T56 e T57: le correzioni del controllo delle viste che si vedono
   senza fuoco (`92-prealpha-viste.css`), cioè l'azione d'un avviso, le
   maniglie del blocco, la scheda colorata della lavagna, la tavolozza, la
   fila col pulsante diviso, le etichette XMP, l'indice delle impostazioni
   e la cella in modifica sulla carta del file; nella foto sono com'erano
   (Differenze 49–53);
5. PA T47 sul telefono: gli interruttori, la riga delle schede delle
   impostazioni e le righe di un elenco, che nel simulatore sono corretti
   (`92-prealpha-telefono.css`) e nella foto sono il cerchio di 44 px, i
   nomi in «…» e i bottoni che si toccano (Differenze 47 e 48);
6. lo spazio che il DOM nuovo prende. Ciò che gli viene dopo scende, sale o
   va di lato, e ogni suo punto conta come differenza. Se il DOM nuovo sta
   sopra ciò che la foto mostra, il simulatore si riprova scorso in più di
   quanto lo spinge giù (i tre spostamenti più pesanti; si tiene il
   migliore). Poi ogni quadretto di 16 px che ancora differisce conta come
   spiegato solo se si ritrova uguale nella foto del client spostato in
   verticale o di lato, al massimo dell'altezza del DOM nuovo più 64 px
   (con PA T47, 26 px per interruttore visibile più 64, mai oltre 480; con
   PA T56 e T57, 10 px per ogni freccia d'un pulsante diviso e 8 per ciò
   che si alza, mai oltre 96).
   `confronto.tsv` scrive gli spostamenti trovati e quanto resta;
   `<stato>.resto.png` mostra i punti che restano.

Due differenze si spiegano per stato, senza zona, perché toccano tutto lo
schermo: il tema d'esempio (PA T42 cambia i colori di ogni punto, e la foto
del client è col tema di serie) e l'ispettore compatto di S2 T9 (264 px
nella foto, 216 nel simulatore: tutto ciò che gli sta a sinistra si sposta,
e il passo 6 lo misura).

Il giro del 2026-11-07 notte, sul simulatore di questo ramo con Marcuzzo
nelle forme piccole senza ingrandimento (le catture rifatte col verde di
serie, D25, e col logo, D26, le risposte dell'utente e i blocchi di PA T47,
T56 e T57): 1.424 confronti, uno per stato, larghezza, luce e fonte.

| Fonte | Confronti | Misurati | Media | Sopra lo 0,5 % | Dopo le zone |
|---|---|---|---|---|---|
| cattura pura contro la sua foto | 510 | 510 | 0,13 % | 43 | tutti sotto |
| client fuori dagli strati e dal DOM nuovo | 570 | 494 | 1,00 % | 132 | 90 sotto, 22 lavagna, 17 tema, 2 tinte, 1 ombra |
| strato contro la pagina approvata | 344 | 152 | 0,10 % | 2 | tutti sotto |

Rispetto al giro di prima, col primo logo, nessuna riga sale di 0,3 punti
e 92 scendono, 82 sotto lo 0,05 %. Le catture si rifanno col CSS di oggi
(`ricattura-tutto.sh`), e quelle per Marcuzzo hanno preso anche le
correzioni di PA T56 e T57: la freccia del pulsante diviso larga 24, per
esempio, ora sta anche nella foto di `s2/foglio`, e le celle e i fogli
fuori dagli strati non differiscono più.

Rifatte le catture per le forme piccole senza l'occhio ingrandito, cambiano
30 righe e nessuna sale di 0,3 punti: 22 righe della lavagna a 700 nella
luce scura passano dallo 0,52 allo 0,51 %, due del foglio salgono allo
0,35 % al più, e il menu «/» della nota (S9, S10, S11) scende sotto la
soglia in due righe: la foto e il DOM lo prendono in un punto diverso del
suo assestarsi, come nel controllo delle viste.

Non misurati, 268: 192 strati a 700 px e sul telefono (la pagina approvata
ha una foto sola, alla sua misura) e 76 schermi in cui il DOM nuovo copre
tutto il client (un dialogo col suo velo: `comp-permesso`, le sette ricette
col dialogo, `riscontri-b-apre`, `tema-installa`, `tema-sostituisci`,
`tema-sostituisci-fallito`, `lav-codice-riepilogo`, `lav-codice-problema`,
e le barre marcate di D6, `aspetto-barre-marcate` e `barra-marcate`, che
ridisegnano tutta la cornice).

Le 177 righe sopra la soglia, per motivo:

- **S2 T3 sul telefono**: la testata, il bottone della modalità e la barra
  di formato stanno dove li mette T3; tolti, resta al massimo lo 0,07 %;
- **PA T47 sul telefono**: tolti gli interruttori e le schede, e ritrovati
  i quadretti spostati, resta lo 0,00 %;
- **PA T56 e T57** (95 righe: 68 della lavagna, 11 dei temi, le altre
  del documento, del foglio, dei file, delle impostazioni e del telefono):
  tolte le correzioni e ritrovati i quadretti spostati,
  fuori dalla lavagna e dai temi resta al massimo lo 0,09 % (S276
  `tema-rifiutato` a piena larghezza);
- **il DOM nuovo prende spazio**: tolto il DOM nuovo e ritrovati i
  quadretti spostati, la riga scende sotto; il simulatore si riprova scorso
  in più dove il DOM nuovo sta sopra ciò che la foto mostra (per esempio
  306 px in `tema-sviluppo`);
- **l'anello del fuoco** della pagina approvata: tolto, la riga scende
  sotto;
- **S2 T9, l'ispettore compatto** (`g2-compatta`): i quadretti si ritrovano
  spostati di lato, resta lo 0,00 %;
- **la lavagna ancora blu** (22 righe, tutte a 700 nella luce scura):
  `s2/lavagna` e `s2/lavagna-700` hanno il DOM verde (`verde-lavagna.mjs`)
  e la foto blu di prima di N6 (vedi «Rifare il simulatore»). Il colore
  conta come differenza: a tutta larghezza resta sotto la soglia, a 700
  nella luce chiara arriva allo 0,50 %, nella scura resta lo 0,55 %. È
  l'unica eccezione ai pixel, e la riga lo scrive;
- **il tema d'esempio** (17 righe): «carta», «officina» e l'anteprima di
  «carta» cambiano i colori di tutto lo schermo, e la foto del client è col
  tema di serie. Si spiegano per stato:

| Stato | Larghezza | Luce | Differenza | Resta dopo le zone |
|---|---|---|---|---|
| S278 `tema-anteprima` | piena | chiara | 7,45 % | 1,67 % |
| S278 `tema-anteprima` | 700 | chiara | 8,70 % | 1,83 % |
| S282 `tema-carta` | piena | chiara | 1,79 % | 0,77 % |
| S282 `tema-carta` | 700 | chiara | 3,01 % | 1,51 % |
| S282 `tema-carta` | telefono | chiara | 4,03 % | 0,87 % |
| S283 `tema-carta-impostazioni` | piena | chiara | 1,78 % | 1,87 % |
| S283 `tema-carta-impostazioni` | 700 | chiara | 2,26 % | 2,21 % |
| S297 `tema-officina` | piena | chiara, scura | 2,97 %, 2,70 % | 1,64 %, 1,35 % |
| S297 `tema-officina` | 700 | chiara, scura | 4,86 %, 4,50 % | 2,49 %, 1,86 % |
| S297 `tema-officina` | telefono | chiara, scura | 5,21 %, 5,00 % | 1,88 %, 1,84 % |
| S298 `tema-officina-impostazioni` | piena | chiara, scura | 2,64 %, 1,90 % | 2,80 %, 2,02 % |
| S298 `tema-officina-impostazioni` | 700 | chiara, scura | 3,57 %, 2,50 % | 3,52 %, 2,44 % |

Coi temi d'esempio anche la cartella del logo prende i colori del tema, e
la foto del client ha quella di serie: per questo, rispetto al giro di
prima, la differenza sale di qualche centesimo e ciò che resta dopo le
zone fino a 0,17 punti.

In S283 e S298 a piena larghezza ciò che resta supera la differenza: la
percentuale si conta sui punti che restano, e l'indice delle impostazioni,
tolto come zona di PA T57, differiva meno della media, perché il tema
cambia i colori di tutto lo schermo.

- **le tinte dell'accento** (2 righe, S276 `tema-rifiutato` a 700): 0,55 %
  nella luce chiara e 0,56 % nella scura dopo le zone. Ciò che resta
  (`tema-rifiutato--700-*.resto.png`) sono i nove cerchi delle tinte: la
  foto del client ha la serie di prima, il simulatore ha Smeraldo per primo
  (D25, PA T48), e gli orli dei caratteri che il DOM nuovo sposta di
  frazioni di pixel;
- **l'ombra del riquadro «Attività»** (1 riga, S232 `mcp-riflesso` a 700,
  luce chiara): 0,52 % dopo le zone. La riga dell'agente ora sta intera
  (PA T26), e il riquadro è più alto di 23 px; ciò che resta
  (`mcp-riflesso--700-light.resto.png`) è la sua ombra sul documento, che
  sta fuori dal rettangolo del DOM nuovo.

Nessuna riga sopra la soglia è senza motivo. Il DOM scritto a mano (le
toppe) non ha una foto da cui venire: si approva guardandolo (gli stati
«nuova» e «composta» di «Gli stati»).

### Il controllo di tutte le viste

I pixel provano che il simulatore è uguale al client, non che il client sia
senza difetti: il difetto dei 44 px (Differenze 47) è venuto fuori guardando.
Per D19 A `script/sonda-viste.mjs` passa ogni vista del simulatore, 1.724 in
tutto: i 282 stati del computer a piena larghezza, a 700 e al telefono, i 16
del telefono solo al telefono, ognuno nelle due luci, col movimento ridotto.
In ogni vista guarda lo schermo e, dentro, gli strati (le pagine dei piani
messe nella cornice), e cerca:

- **taglio**: un testo che finisce in «…» (`text-overflow: ellipsis` con
  `scrollWidth` maggiore di `clientWidth`) o tagliato a righe
  (`line-clamp`). Non è un difetto se il testo intero sta nel `title`,
  nell'`aria-label` o in un suggerimento;
- **tagliato** ed **esce**: un testo o un controllo tagliato in parte da un
  contenitore che non scorre, o dal bordo dello schermo; la pagina che
  scorre di lato;
- **sovrapposti** e **testi-sovrapposti**: due controlli o due testi che si
  coprono in parte, nella parte che si vede e nello stesso livello. Un menu,
  un dialogo, un elenco a comparsa, un suggerimento o uno strato fisso
  stanno sopra ciò che coprono, non ci si sovrappongono; una superficie di
  testo (l'editor, la griglia, un albero) ospita i suoi bottoni;
- **bersaglio**: un controllo sotto i 24 px (44 al telefono), misurato dove
  il clic lo prende davvero (`elementFromPoint`: conta anche un `::after`
  più largo o l'etichetta di un campo), che non sia un collegamento in una
  frase. Sotto i 24 px vale l'eccezione della distanza di WCAG 2.5.8: un
  cerchio di 24 px attorno al bersaglio che non tocca i vicini, contando
  solo i vicini che il clic raggiunge (un controllo coperto da un livello
  non è un bersaglio). Quelli si contano a parte
  (**bersaglio-distanziato**), e non sono difetti;
- **contrasto**: un testo sotto 4,5:1 (3 se grande), un segnaposto o un
  valore sotto 4,5, l'icona di un bottone senza testo sotto 3: le soglie
  «normal» del contratto del tema (`recipe.ts`, `THRESHOLDS`). Lo sfondo è
  quello che si vede davvero sotto il testo (`elementsFromPoint`, con veli,
  sfumature e opacità, rimettendo nella pila gli antenati con
  `pointer-events: none`). Un testo spento non conta, come in WCAG. Il
  testo colorato dal file sulla carta del file si conta a parte
  (**contrasto-file**): il colore è di chi ha scritto il file, non di Fub;
- **fuoco**: col fuoco della tastiera il controllo non cambia niente
  (**fuoco-invisibile**), cambia solo un colore (**fuoco-debole**), mostra
  solo il cursore del testo (**fuoco-solo-cursore**), ha l'anello sotto 3:1
  contro lo sfondo accanto su tutti e quattro i lati (**anello-contrasto**)
  o tagliato su tutti e quattro (**anello-tagliato**).

Una vista è **rigorosa** quando ha la sua cattura a quella misura (o è del
telefono); le altre sono ricomposte dal simulatore (una cattura a tutta
larghezza mostrata a 700 o al telefono), e un riscontro lì può essere della
ricomposizione, non del prodotto: si guarda, ma non decide da solo.

Le regole sono state affinate in cinque giri, ognuno guardando a mano i
riscontri: prima l'anello si giudicava su un lato solo, i livelli si
sovrapponevano al resto, i `details` chiusi contavano, il colore di un
testo dentro un antenato con `pointer-events: none` veniva preso dal fondo
sbagliato, un bersaglio si misurava sul suo rettangolo e non dove il clic
arriva. PA T55 porta nel banco le stesse regole, già affinate.

**Il giro finale** (2026-11-07, `sim/out-v7`, con i blocchi di PA T47, T56
e T57): 1.724 viste, tutte montate, 770 rigorose, in 622 secondi. Ha
guardato 70.020 testi, 90.860 controlli e 73.918 fuochi. 646 bersagli sotto
i 24 px hanno la loro distanza (bersaglio-distanziato) e non sono difetti.
Rifatto su `sim/out-v8`, con Marcuzzo (D26), dà gli stessi riscontri
rigorosi. Fuori da quelli cambia solo la tavolozza della barra dei fogli al
telefono (`g2-foglio-ribbon-palette`, ricatturata: con la freccia del
pulsante diviso larga 24, PA T57, si apre 20 px più a destra), con
quattordici sovrapposti in meno e quattro nuovi (due pulsanti della barra
coperti, nelle due luci), più un taglio in meno in `slash-nessuno`; il
telefono è del suo piano. Rifatto ancora su `sim/out-v9`, con le forme
piccole di Marcuzzo che non ingrandiscono niente, dà di nuovo gli stessi
riscontri rigorosi; fuori da quelli i tagli tornano 3.980, come nella
tabella: la linguetta «Benvenuto» dietro il menu «/» (S10, S11, non
rigorose) la cattura la prende in un punto diverso del suo assestarsi.
Ogni cella dice i riscontri, fra parentesi quanti
nelle viste rigorose, e i gruppi (lo stesso tipo sullo stesso selettore):

| Tipo | Computer | Telefono | Strati |
|---|---|---|---|
| taglio | 236 (56), 8 | 888 (58), 7 | 2.856 (1.158), 8 |
| tagliato | 26 (14), 8 | 2 (0), 1 | 366 (102), 10 |
| sovrapposti | – | 532 (10), 8 | 266 (94), 7 |
| testi-sovrapposti | – | – | 16 (8), 3 |
| bersaglio | 52 (26), 1 | 1.966 (190), 54 | 1.490 (2), 55 |
| bersaglio-distanziato | 506 (298), 46 | – | 140 (104), 11 |
| contrasto | 471 (350), 2 | 1 (0), 1 | 67 (23), 2 |
| contrasto-file | 332 (202), 2 | 202 (24), 2 | – |
| fuoco-debole | 104 (56), 3 | 56 (6), 3 | – |
| fuoco-solo-cursore | 274 (198), 1 | 152 (20), 1 | – |
| fuoco-invisibile | – | – | 66 (24), 2 |
| anello-contrasto | – | 45 (0), 13 | – |

Sul computer ogni gruppo che resta ha il suo perché, scritto sotto: i
falsi allarmi (la «/» e la «›», la griglia, il cursore, le linguette, lo
«/» che scorre, i titoli del filo in S17, i colori del file, le viste
ricomposte S109 e S156) e i nomi di Differenze 54, che aspettano i
suggerimenti di PA T57. Non resta nessun anello tagliato o sotto il 3:1,
nessun fuoco invisibile e nessun bersaglio senza distanza fuori da S17.
Rispetto al giro di prima, con la prima versione delle correzioni, le
intestazioni della griglia al buio non hanno più riscontri (164 in meno),
la tavolozza di S56 è tutta distanziata (280 bersagli diventano distanziati),
la pastiglia del titolo di S20 passa e il campo di S166 non ha più
riscontri. Al telefono e negli strati i numeri sono quelli dei piani che li
possiedono (sotto).

**I difetti veri.** Vanno in «Differenze fra piani e codice», coi loro
task; il simulatore li mostra già corretti, nel blocco
`92-prealpha-viste.css` (PA T56, T57) e in `92-prealpha-telefono.css` (PA
T47), e il confronto dei pixel toglie le loro zone.

| Differenza | Che cosa | Stati | Task |
|---|---|---|---|
| 48 | al telefono le righe di un elenco che si toccano; il tondo della modalità con l'anello fuori, sulla carta | S26, S28, S83 al telefono | PA T47 |
| 49 | l'anello tagliato su tutti i lati (l'editor, l'anteprima, il grafo); l'anello della pillola dei commenti fuori, sul bianco | S5, S33, S210, ogni editor; S83 nello stretto | PA T56 |
| 50 | la carta del file al buio coi segni del tema: l'anello e la cella attiva a 2,2:1, la formula a 1,8:1, la cella in modifica scura col margine delle pieghe | i fogli al buio (S43, S50, S51, S56) | PA T56 |
| 51 | l'azione di un avviso a 4,40–4,48:1 | S23, S30, S32, S33, S41 | PA T56 |
| 52 | le schede colorate della lavagna trasparenti: titolo e azioni a 4,19–4,27:1 | S132 | PA T56 |
| 53 | bersagli sotto i 24 px senza distanza: la freccia del pulsante diviso, la tavolozza, la modalità nella banda, il percorso a briciole, le etichette XMP, le maniglie del blocco, la pastiglia del titolo | 27 stati dei fogli, S56, S7, S179, S3, S8, S20 | PA T57 |
| 54 | nomi in «…» senza il testo intero da nessuna parte | S183–S208, S106, S132, S210, S211 | PA T57 |

I suggerimenti di Differenze 54 sono TypeScript (`setTooltip`): il
simulatore non li ha, e la sonda continua a segnalare quei nomi finché PA
T57 non li scrive. Due difetti erano del simulatore e sono corretti nelle
toppe: la riga dell'agente in S232 senza il testo intero, e il campo
«Pagine» di S166 scritto come un campo nudo, senza la scatola del kit e
quindi senza un fuoco visibile (ora è `textField` di `kit/field.ts`, come lo
scriverà N6 T28).

Il controllo ha trovato anche due difetti delle correzioni stesse, al primo
giro: la regola dei segni della carta messa sulla riga della griglia
coloriva anche l'intestazione scelta, che sta sul fondo del tema, e al buio
la portava a 2,7:1 (ora la regola è sulle celle, PA T56); la tavolozza con
6 px fra i quadretti, al telefono, fa sovrapporre i quadretti di 44 px
(una vista ricomposta: va al piano del telefono, sotto).

**I falsi allarmi**, col perché:

- `crumb-sep`, la «/» del percorso a briciole, a 3,07:1: è un segno
  nascosto ai lettori di schermo, che Scrittoio 2 disegna apposta sopra il
  3:1 dei segni grafici (`40-sheets.css`); non è testo da leggere;
- `menu-more`, la «›» di un sottomenu, a 4,20:1: un glifo nascosto ai
  lettori di schermo, cioè un'icona, e le icone vogliono 3;
- `fuoco-debole` della griglia: quando la griglia ha una cella attiva
  (`aria-activedescendant`) il suo fuoco è il bordo della cella, non un
  anello attorno a tutto (`skin/editors.css`), come in ogni foglio di
  calcolo. Il bordo però al buio, sulla carta, stava a 2,2:1: quello era un
  difetto vero (Differenze 50); con PA T56 sta a 6,0:1. Lo stesso vale per
  la griglia della pagina `celle-griglia` negli strati;
- `fuoco-solo-cursore`: un editor o un campo di testo col fuoco mostra il
  cursore che lampeggia, come ogni editor; un anello attorno al testo lo
  coprirebbe. Il riquadro che scorre (`.cm-scroller`) ha il suo anello (PA
  T56);
- i nomi in «…» delle linguette, del percorso a briciole e delle righe
  dell'albero: il testo intero sta nell'`aria-label` e nel suggerimento del
  client (`ui/tooltip.ts`), che è JavaScript e nel simulatore non c'è; nel
  banco (PA T55) si legge;
- il campo della barra a schede in S59 (`kit-ribbon-input`): un campo fa
  scorrere il suo valore;
- le schede e l'elenco del «/» in S9, tagliati di lato o in basso:
  scorrono (`panel.ts`, i due contenitori con `overflow: auto`);
- i tagli nelle viste ricomposte a 700 (S109, S156): la ricomposizione
  tiene aperti insieme il cassetto e l'ispettore, che a 700 il client non
  apre insieme;
- un collegamento in una frase (`wikilink`, 106 × 19): WCAG 2.5.8 esclude i
  bersagli in linea nel testo;
- i titoli del filo in S17 (`sheet-thread-item`, 12 × 9): l'eccezione
  «equivalente» di WCAG 2.5.8, perché gli stessi titoli stanno nella
  struttura dell'ispettore, con righe intere;
- `contrasto-file`: i colori che il file dà alle sue celle sono
  dell'autore del file;
- negli strati: i tagli e le sovrapposizioni della lavagna da lontano (la
  lavagna è infinita e il bordo la taglia; un gruppo contiene le sue
  schede); i colori delle penne «poco leggibili», che lo dicono nel nome;
  le righe e le colonne fermate di `celle-oltre`, che stanno sopra le
  celle che scorrono; il nome del posto in piedi, che ha il `title`.

**Al telefono.** Il telefono si ridisegna nel suo piano (D1 B), che parte
da questi riscontri (`prompt-piano-telefono.md`). PA T47 corregge solo ciò
che la regola dei 44 px deforma. Il resto va al piano del telefono:

- bersagli sotto i 44 px: le celle della griglia (28 px), i campi (30), la
  ricerca delle impostazioni, le tendine, i cursori, le voci dell'albero,
  le righe del lanciatore, la maniglia del foglio (28);
- la barra a schede, che con la regola dei 44 px si sovrappone (S269), e la
  tavolozza;
- il titolo della pillola in «…» (il testo intero è nell'etichetta);
- i suggerimenti, che al tocco non ci sono: un nome tagliato deve stare
  intero da un'altra parte;
- gli anelli degli interruttori nelle viste ricomposte.

**Negli strati**, cioè nelle pagine approvate di altri piani, i riscontri
vanno ai piani che le possiedono, quando la loro pagina si rifà nella
cornice:

- N6 (`lavagna-schede`): «Converti in nota» (74 × 16) e «Collega» (18 ×
  18) sotto i 24 px fra schede vicine (S143); una scheda col fuoco
  che non cambia (S138, S162–S164);
- A1 (`ricette`): il codice di un problema a 4,36:1 (S193);
- K5 (`disegno-motore`): l'indice delle impostazioni di `p-dis-8` col nome
  in «…»; nella cornice lo corregge PA T57.

### Rifare il simulatore

Tutto ciò che serve per rifare il simulatore sta sul ramo, in
`PLAN-ui/fub-pre-alpha/`. Le foto e i JSON grezzi delle catture (circa
560 MB) no: restano sulla macchina che li ha presi.

**La fonte del DOM catturato è `sim-dati-1.js`.** Contiene, compressi, il
DOM e il CSS di ogni cattura nelle due luci, i temi e i caratteri. Quasi
tutto si cambia senza catturare di nuovo:

| Cosa cambia | Dove |
|---|---|
| il DOM dei pezzi nuovi | `toppe/*.html` (un `<template data-toppa>` per pezzo) |
| il CSS nuovo | `blocchi/*.css` |
| uno stato composto o nuovo sopra una cattura | `script/stati-composte-sim.mjs`, `script/stati-nuove-sim.mjs` |
| gli scenari e i loro passi | `script/scenari-sim.mjs` |
| i pezzi, i menu sovrapposti, le eccezioni ai clic | `script/pezzi-sim.mjs`, `script/eccezioni-sim.mjs` |
| le interazioni finte | `script/solo-simulatore.js` |

Poi, dalla radice del repository:

```bash
DATI=PLAN-ui/fub-pre-alpha node PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs PLAN-ui/fub-pre-alpha
```

Con `DATI` la costruzione riusa le catture impacchettate. Senza altri
cambi riscrive gli stessi byte di `simulatore.html`, `sim-dati-1.js`,
`sim-stati.js` e `dal-prototipo.md`: lo si controlla così prima di
committare un cambio.

**Catturare di nuovo uno stato**, anche da un'altra macchina. La ricetta
intera, coi comandi, è in `script/finto/LEGGIMI.md`. In breve:

1. *Il client delle catture.* È il client vero col banco e l'host finto,
   nel punto della storia in cui sono state prese le catture, più le toppe
   del finto in `script/finto/`:
   - `cattura.patch` su `0c2a7e91` (`anteprima/tutto` del 2026-11-04), per
     tutte le catture tranne l'avvio. Cambia nove file: il corpus e l'host
     finto del banco, le scene del secondo giro, le sonde di Scrittoio 2
     (icone, gruppo Carattere, striscia degli spazi: DOM che i task di
     Scrittoio 2 scriveranno davvero) e l'errore dell'inchiostro della
     facciata WebAssembly;
   - `avvio.patch` su `5006937c` (`anteprima/tutto` con #308), per le
     quattro catture dell'avvio;
   - sopra ognuna, `verde.patch` e `verde-avvio.patch`: il verde di serie
     (D25, PA T48) nel client delle catture, come lo porterà PA T48 nel
     codice. Le pagine dei piani, che non hanno un client, si ricolorano
     con `finto/verde-mappa.json` (`VERDE=` per `cattura-piani.mjs`). Il
     come è in `script/finto/LEGGIMI.md`, «Il verde di serie».

   `anteprima/tutto` è un ramo locale: i suoi 23 commit d'unione stanno in
   `script/finto/anteprima-tutto.bundle` (115 KB), gli altri 21 sono già su
   `origin`.
2. *Gli stati.* `script/ricattura.mjs`, con `DATI` che punta a
   `PLAN-ui/fub-pre-alpha`, sa dai dati impacchettati quali catture ci
   sono e prende la definizione di ognuna da `script/stati-*.json`
   (`secco=1` dice solo che cosa catturerebbe). Le pagine dei piani (gli
   stati `p-*`) si catturano con `cartelle=piani`, da `file://` e senza
   client. Le catture nuove vanno in `catture-r/<cartella>/`.
   `script/ricattura-tutto.sh <client delle catture> <client dell'avvio>`
   le rifà tutte, tranne le pagine dei piani: è come sono state prese le
   632 catture del 2026-11-06, in circa un'ora, e come sono state rifatte
   verdi il 2026-11-07.
3. *Dentro il simulatore.* `RIFATTE=catture-r/<cartella>` insieme a `DATI`
   fa entrare nella costruzione solo le catture rifatte.

`s2/lavagna` e `s2/lavagna-700` non hanno definizione: sono le catture
della lavagna di prima di N6 e restano quelle impacchettate.
`verde-lavagna.mjs` dà al loro DOM il foglio di serie verde di una cattura
della stessa luce; la loro foto PNG resta blu, ed è l'unica eccezione ai
pixel: `foto-sim.mjs` la scrive nel motivo della riga.

**Dopo la Fase A**, quando i piani sono in `main`, la base del client delle
catture diventa `main`. Le toppe si riportano a mano: `bench/` e
`src/host/fake.ts` restano toppe del finto, le sonde di Scrittoio 2 restano
finché i loro task non le hanno scritte nel codice.

**Le prove**, dalla cartella `script/`:

- `node prova-sim.mjs <cartella del simulatore> <cartella delle foto>`:
  monta ogni stato, prova ogni controllo visibile, fa un clic vero su un
  campione e percorre gli scenari («Si usa come il prodotto»);
- `node foto-sim.mjs <cartella del simulatore> <cartella delle foto>`:
  il confronto dei pixel con la fonte («I pixel contro la fonte»), in
  `confronto.tsv`, con il perché di ogni riga sopra lo 0,5 %. Vuole le
  foto delle catture, quindi gira solo dopo aver catturato tutto (dopo,
  `catture-r/` si rinomina in `catture/`);
- `node sonda-viste.mjs <cartella del simulatore> <cartella d'uscita>`: il
  controllo di tutte le viste di D19 («Il controllo di tutte le viste»), in
  `viste.tsv`, `gruppi.tsv` e `riassunto.json`;
- `node prova-css-fonte.mjs <scrittoio-2.html> <simulatore.html>`: il CSS
  di Scrittoio 2 uguale alla sua fonte (prima
  `git show origin/piano/scrittoio-2:PLAN-ui/scrittoio-2.html > <file>`);
- `CLIENT=<apps/client> <CLIENT>/node_modules/.bin/vitest run --config sonda/vitest.config.mjs`:
  i blocchi della pelle e i temi contro il sanitizer di `theme-2`.

Gli script del browser trovano Playwright, pngjs, pixelmatch e happy-dom
nel client di `FUB_CLIENT` (`script/client.mjs`). Il Vite delle catture
usa la porta 1468. Gli `script/genera-*.py` hanno scritto gli
`stati-*.json` dei lotti di catture di questo giro: restano come memoria,
perché la definizione di ogni cattura sta già nei JSON, e non servono per
rifare uno stato.

<!-- dal-prototipo:inizio -->
<!-- Generato da PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs: non si modifica a mano. -->

298 stati: 168 catture, 67 composti, 63 nuovi da approvare. 18 scenari.

#### Gli stati

| S | Stato | Gruppo | Provenienza | Task | Da dove si copia |
|---|---|---|---|---|---|
| S1 | `nota-riposo` | La nota | cattura | S2 T2–T13, main N12 N13 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S2 | `nota` | La nota | cattura | S2 T2, S2 T3, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S3 | `nota-blocchi` | La nota | cattura | main N13, S2 T3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S4 | `nota-sorgente` | La nota | cattura | main, S2 T3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S5 | `nota-lettura` | La nota | cattura | main, S2 T3, S2 T11 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S6 | `barra` | La nota | cattura | S2 T16, S2 T17 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S7 | `live-tabella` | La nota | cattura | main, S2 T11 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S8 | `blocchi-menu` | La nota | cattura | main N13, PA (rifiniture di Blocchi) | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S9 | `slash` | La nota | cattura | main N12, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S10 | `slash-filtro` | La nota | cattura | main N12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S11 | `slash-nessuno` | La nota | cattura | main N12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S12 | `schede` | La nota | cattura | S2 T6 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S13 | `concentrazione` | La nota | cattura | main, S2 T6 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S14 | `nota-pdf` | La nota | cattura | main, PA (`#page=3`) | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S15 | `icone` | La nota | cattura | S2 T14, S2 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S16 | `icone-emoji` | La nota | cattura | S2 T14, S2 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S17 | `g2-filo-titoli` | La nota | cattura | S2 T5, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S18 | `g2-nota-pdf-senza` | La nota | cattura | main, PA T32 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S19 | `g2-due-riquadri` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S20 | `g2-live-lettura` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S21 | `g2-trascina` | I riquadri | cattura | S2 T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S22 | `g2-menu-riquadro` | I riquadri | cattura | S2 T4, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S23 | `conflitto` | I file, i salvataggi, i conflitti | cattura | main (U59–U60), S2 T5, PA giro della pre-alpha | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S24 | `g2-rinomina` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S25 | `g2-titolo-rinomina` | I file, i salvataggi, i conflitti | cattura | main, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S26 | `g2-cestino` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S27 | `g2-cestino-vuoto` | I file, i salvataggi, i conflitti | cattura | main, S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S28 | `g2-ispettore-3` | I file, i salvataggi, i conflitti | cattura | PA T4, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S29 | `g2-bozza` | I file, i salvataggi, i conflitti | cattura | main, PA T4 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S30 | `g2-bozza-divergente` | I file, i salvataggi, i conflitti | cattura | main, PA T4, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S31 | `g2-non-salvata` | I file, i salvataggi, i conflitti | cattura | PA T4 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S32 | `g2-salvataggio-fallito` | I file, i salvataggi, i conflitti | cattura | main, PA T4, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S33 | `g2-conflitto-lettura` | I file, i salvataggi, i conflitti | cattura | PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S34 | `file-nuovo-tipo` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T43, PA T44 | toppe: panels/explorer.ts (il pulsante #new-note apre il menu), ui/menu.ts |
| S35 | `file-troppo-grande` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30 | toppe: editors/craft/surface.ts (.craft-empty, azioni per il file troppo grande), skin/media.css |
| S36 | `file-sconosciuto` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30 | toppe: editors/craft/surface.ts (la stessa vista .craft-empty di craft-rotto, più una riga d'azioni), skin/media.css |
| S37 | `vault-irraggiungibile` | I file, i salvataggi, i conflitti | nuova, da approvare | PA T30, N7 | toppe: apps/client/index.html e src/avvio/*.ts (la schermata d'avvio di N7, già in main: un terzo bottone nel guasto del vault) |
| S38 | `g4-conflitto-confronta` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S39 | `g4-conflitto-mio` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S40 | `g4-conflitto-disco` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S41 | `g4-conflitto-dopo` | I file, i salvataggi, i conflitti | cattura | main, PA T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S42 | `foglio` | Il foglio | cattura | K3 T18, S2 T20, griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S43 | `foglio-modifica` | Il foglio | cattura | griglia T4, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S44 | `foglio-comandi` | Il foglio | cattura | K3 T12–T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S45 | `foglio-comandi-cerca` | Il foglio | cattura | K3 T12–T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S46 | `caricamento` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S47 | `errore` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S48 | `molti` | Il foglio | cattura | K3 T15, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S49 | `g2-foglio-selection` | Il foglio | cattura | griglia T1–T9, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S50 | `g2-foglio-formula` | Il foglio | cattura | griglia T1–T9, K3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S51 | `g2-foglio-scrive` | Il foglio | cattura | griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S52 | `g3-foglio-errore` | Il foglio | cattura | griglia T1–T9, K3 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S53 | `g2-foglio-resize` | Il foglio | cattura | griglia T1–T9 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S54 | `g2-foglio-secondo` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S55 | `g2-foglio-ribbon-open` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S56 | `g2-foglio-ribbon-palette` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S57 | `g2-foglio-ribbon-keytips` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S58 | `g2-foglio-ribbon-collapsed` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S59 | `g2-foglio-ribbon-table` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S60 | `g2-foglio-ribbon-readonly` | Il foglio | cattura | K3 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S61 | `g2-foglio-tab-inserisci` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S62 | `g2-foglio-tab-layout` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S63 | `g2-foglio-tab-formule` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S64 | `g2-foglio-tab-dati` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S65 | `g2-foglio-tab-revisione` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S66 | `g2-foglio-tab-visualizza` | Il foglio | cattura | K3 T18, S2 T20 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S67 | `g2-foglio-command-form` | Il foglio | cattura | K3 T12, K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S68 | `g2-foglio-commands-table` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S69 | `g2-foglio-commands-context-off` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S70 | `g2-foglio-commands-readonly` | Il foglio | cattura | K3 T12 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S71 | `g2-foglio-result-table` | Il foglio | cattura | K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S72 | `g2-foglio-result-empty` | Il foglio | cattura | K3 T15 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S73 | `celle-riposo` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S74 | `celle-intervallo` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S75 | `celle-oltre` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S76 | `celle-editor` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S77 | `celle-misura` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S78 | `celle-riempimento` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S79 | `celle-copiata` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S80 | `celle-tagliata` | Il foglio | composta, da approvare | griglia T1–T9, PA T27 | piani/celle-griglia.html |
| S81 | `foglio-vuoto` | Il foglio | nuova, da approvare | griglia T1, PA T27 | toppe: editors/grid/surface.ts (.grid-notice, testo nuovo) |
| S82 | `foglio-enorme` | Il foglio | nuova, da approvare | griglia T8, PA T27 | toppe: editors/grid/surface.ts (la stessa .grid-notice di oggi, un testo nuovo in i18n/catalog.ts) |
| S83 | `documento` | Il documento | cattura | S2 T5, S2 T20, S2 T21 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S84 | `documento-oggetti` | Il documento | cattura | main, S2 T21 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S85 | `sola-lettura` | Il documento | cattura | S2 T4, S2 T5, PA sola lettura | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S86 | `g2-doc-tab-inserisci` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S87 | `g2-doc-tab-disegna` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S88 | `g2-doc-tab-layout` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S89 | `g2-doc-tab-revisione` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S90 | `g2-doc-tab-visualizza` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S91 | `g3-doc-trova` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S92 | `g3-doc-chiuse` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S93 | `g3-doc-chiuse-pannello` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S94 | `g3-doc-oggetti` | Il documento | cattura | S2 T21, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S95 | `g3-doc-odt` | Il documento | cattura | main, PA T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S96 | `g2-doc-prestato` | Il documento | cattura | main, K2 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S97 | `disegno` | Il disegno | cattura | S2 T16, S2 T22, K5 T25 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S98 | `disegno-selezione` | Il disegno | cattura | K5, S2 T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S99 | `craft` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S100 | `craft-prepara` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S101 | `craft-rotto` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S102 | `g2-disegno-penna` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S103 | `g2-disegno-gomma` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S104 | `g2-disegno-rettangolo` | Il disegno | cattura | S2 T22, K5 T21–T23 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S105 | `g2-disegno-mano` | Il disegno | cattura | S2 T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S106 | `g3-disegno-livelli` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S107 | `g3-disegno-tutto` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S108 | `g3-disegno-zoom` | Il disegno | cattura | S2 T22, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S109 | `g2-craft-peso` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S110 | `g2-craft-fallita` | Il disegno | cattura | main N7, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S111 | `dis-b-pronto` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S112 | `dis-b-perse` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S113 | `dis-b-cinquecento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S114 | `dis-b-spento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S115 | `dis-b-fermo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S116 | `dis-b-senza` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S117 | `dis-b-rifiutato` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S118 | `dis-b-si-apre` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S119 | `dis-b-testo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S120 | `dis-b-testo-spento` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S121 | `dis-b-mano` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S122 | `dis-b-penna` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S123 | `dis-b-gomma` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S124 | `dis-b-rettangolo` | Il disegno | composta, da approvare | K5 T21–T23, PA T27 | piani/disegno-motore.html |
| S125 | `disegno-a-pronto` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S126 | `disegno-a-perse` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S127 | `disegno-a-spento` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S128 | `disegno-a-fermo` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-4) |
| S129 | `disegno-a-apre` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S287 | `disegno-a-cinquecento` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-2b) |
| S288 | `disegno-a-senza` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-5) |
| S289 | `disegno-a-rifiutato` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; toppe: editors/craft/surface.ts (l'annuncio di K5 6a nella regione viva del disegno; il testo da i18n/catalog.ts); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S290 | `disegno-a-testo-spento` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts, skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-7b) |
| S291 | `disegno-a-mano` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S292 | `disegno-a-gomma` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S293 | `disegno-a-rettangolo` | Il disegno | nuova, da approvare | K5 T21, K5 T22, K5 T23, S2 T4, PA T27 | toppe: shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css; un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S130 | `disegno-a-testo` | Il disegno | nuova, da approvare | K5 T21, K5 T22, PA T27 | un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-7a) |
| S131 | `disegno-vuoto` | Il disegno | nuova, da approvare | K5 T21, PA T27 | toppe: editors/craft/surface.ts (il foglio vuoto, testo nuovo in i18n/catalog.ts); un pezzo di piani/disegno-motore.html (la pagina approvata, cattura p-dis-1) |
| S132 | `lavagna` | La lavagna | cattura | N6, N4, S2 T23, lavagna in codice | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S133 | `lav-schede` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S134 | `lav-schede-vive` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S135 | `lav-una-scelta` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S136 | `lav-attive` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S137 | `lav-testate` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S138 | `lav-inchiostro` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S139 | `lav-filo` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S140 | `lav-mancante` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S141 | `lav-rilascio3` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S142 | `lav-rilascio47` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S143 | `lav-colori` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S144 | `lav-notifiche` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S145 | `lav-lontano` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S146 | `lav-lontanissimo` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S147 | `lav-cinquecento` | La lavagna | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S148 | `pen-chiuso` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S149 | `pen-penna` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S150 | `pen-evidenziatore` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S151 | `pen-gomma` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S152 | `pen-mia` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S153 | `pen-mouse` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S154 | `pen-sola-lettura` | La lavagna | composta, da approvare | N4 T20, N4 T21, PA T28 | piani/lavagna-penne.html |
| S155 | `lav-impianto` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); piani/lavagna-schede.html |
| S156 | `lav-vuota` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/empty.ts (nuovo) |
| S157 | `lav-sel-una` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/selection.ts (nuovo, sul posto di panels/selection-bubble.ts); piani/lavagna-schede.html |
| S158 | `lav-sel-molte` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/selection.ts (nuovo); piani/lavagna-schede.html |
| S159 | `lav-scrive` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28, N6 T27 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga); piani/lavagna-schede.html |
| S160 | `lav-scrive-slash` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga); un pezzo della cattura slash (il DOM del client delle catture, spostato); piani/lavagna-schede.html |
| S161 | `lav-filo-nuovo` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); piani/lavagna-schede.html |
| S162 | `lav-penna` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S163 | `lav-evidenziatore` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S164 | `lav-gomma` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); piani/lavagna-schede.html |
| S165 | `lav-lazo` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/tools/lasso.ts (nuovo, N6 T86 con D-22 a); piani/lavagna-schede.html |
| S166 | `lav-estratti` | La lavagna | nuova, da approvare | N6 T26, N6 T27, N6 T28, PA T28, N6 T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/parts-picker.ts (nuovo, su kit/popover.ts, kit/list.ts e kit/field.ts); piani/lavagna-schede.html |
| S167 | `lav-codice-menu` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts ed engine.ts (il menu contestuale, ui/menu.ts); toppe: editors/canvas/chrome/commands.ts (canvas.layout.grid, .row, .column, .tree); piani/lavagna-schede.html |
| S168 | `lav-codice-riepilogo` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts (canvas.paste_code con kit/dialog.ts); piani/lavagna-schede.html |
| S169 | `lav-codice-problema` | La lavagna | nuova, da approvare | lavagna in codice, PA T28 | toppe: editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno); toppe: editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts); toppe: editors/canvas/chrome/commands.ts (canvas.check: niente si scrive); piani/lavagna-schede.html |
| S170 | `pdf` | PDF e foto | cattura | S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S171 | `foto` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S172 | `g2-pdf-cerca` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S173 | `g2-pdf-nessuno` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S174 | `g2-pdf-miniature` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S175 | `g2-pdf-due` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S176 | `g2-pdf-scuro` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S177 | `g3-pdf-rotto` | PDF e foto | cattura | main, S2 T18 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S178 | `g2-foto-senza` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S179 | `g2-raw-girato` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S180 | `g2-raw-senza` | PDF e foto | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S181 | `pdf-pagina3` | PDF e foto | nuova, da approvare | PA T32 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S182 | `craft-spente` | Componenti e ricette | cattura | main N7, K2, S2 T19 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S183 | `componenti` | Componenti e ricette | cattura | K2 T1–T7, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S184 | `nuovo-vault` | Componenti e ricette | cattura | K2 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S185 | `g2-comp-spegni` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S186 | `g2-comp-orfani` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S187 | `g2-comp-cerca` | Componenti e ricette | cattura | K2 T1–T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S188 | `dis-comp-acceso` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S189 | `dis-comp-spento` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S190 | `dis-comp-accendi` | Componenti e ricette | composta, da approvare | K5 T23, K2 T1–T7 | piani/disegno-motore.html |
| S191 | `ricette` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S192 | `ricette-vuote` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S193 | `ricette-problemi` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S194 | `ricette-carica` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S195 | `ricette-errore` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S196 | `ricette-cinquecento` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S197 | `ricetta-dialogo` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S198 | `ricetta-prova` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S199 | `ricetta-prova-errore` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S200 | `ricetta-nessuna-nota` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S201 | `ricetta-venti` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S202 | `ricetta-cambiata` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S203 | `ricetta-fatta` | Componenti e ricette | composta, da approvare | A1 T12, PA T29 | piani/ricette.html |
| S204 | `comp-installato` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29, PA T46 | toppe: panels/settings.ts renderInstalledComponent, con le parole del lessico (D18 A, PA T46) (nel banco: host/fake.ts, un InstalledPluginInfo con installation "41") |
| S205 | `comp-permesso` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29, PA T46 | toppe: panels/settings.ts renderInstalledComponent, con le parole del lessico (D18 A, PA T46) (nel banco: host/fake.ts, un InstalledPluginInfo con installation "41"); toppe: panels/settings.ts renderInstalledComponent (il consenso «Concesso» chiede con confirm, che la Scrivania mostra con shells/scrittoio/confirm.ts e kit/dialog.ts), così com'è oggi |
| S206 | `comp-rotto-tempo` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29, PA T46 | toppe: panels/settings.ts renderInstalledComponent: nuovi data-state="stopped" sulla scheda, la riga dello stato al posto di «Attivo in questo vault» e «Riavvia» (fub-wasm-host: timeout; il motivo arriva con InstalledPluginInfo); il resto è la scheda di oggi |
| S207 | `comp-rotto-errore` | Componenti e ricette | nuova, da approvare | K1, K2 T3, PA T29, PA T46 | toppe: panels/settings.ts renderInstalledComponent: nuovi data-state="stopped" sulla scheda, la riga dello stato al posto di «Attivo in questo vault», «Copia il motivo» e «Riavvia» (fub-wasm-host: trap; il motivo arriva con InstalledPluginInfo); il resto è la scheda di oggi |
| S208 | `comp-aggiorna` | Componenti e ricette | nuova, da approvare | dopo la pre-alpha | toppe: panels/settings.ts renderInstalledComponent: nuovi la riga della versione nuova e «Vedi cosa cambia» (nessun piano lo copre: «Differenze fra piani e codice») |
| S209 | `ricerca` | La cornice | cattura | S2 T8 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S210 | `grafo` | La cornice | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S211 | `palette` | La cornice | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S212 | `palette-file` | La cornice | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S213 | `zero` | La cornice | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S214 | `salvataggio` | La cornice | cattura | main, S2 T5 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S215 | `avvisi` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S216 | `toast` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S217 | `conferma` | La cornice | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S218 | `g2-menu` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S219 | `g2-vault` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S220 | `g2-attivita` | La cornice | cattura | S2 T7, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S221 | `g2-ispettore-0` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S222 | `g2-ispettore-1` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S223 | `g2-ispettore-2` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S224 | `g2-ispettore-chiuso` | La cornice | cattura | S2 T9, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S225 | `g2-compatta` | La cornice | cattura | S2 T14, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S226 | `g2-stretta` | La cornice | cattura | S2 T14 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S227 | `g2-stretta-cassetto` | La cornice | cattura | S2 T14 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S228 | `g2-lanciatore-anteprima` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S229 | `g2-lanciatore-cerca` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S230 | `g2-lanciatore-comandi` | La cornice | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S231 | `g2-conferma` | La cornice | cattura | S2 T16, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S232 | `mcp-riflesso` | La cornice | nuova, da approvare | N2, PA T26 | toppe: panels/activity.ts (una riga per le scritture di fub-mcp, N2 T9) |
| S233 | `impostazioni` | Le impostazioni | cattura | S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S234 | `aspetto` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S235 | `impostazioni-vault` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S236 | `g2-imp-editor` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S237 | `g2-imp-diagnostica` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S238 | `g2-imp-profili` | Le impostazioni | cattura | K2, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S239 | `g2-imp-tasti` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S240 | `g2-imp-vault` | Le impostazioni | cattura | main, S2 T10 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S241 | `g2-imp-info` | Le impostazioni | cattura | main, PA T22 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S242 | `g2-tema` | Le impostazioni | cattura | S2 T10, main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S243 | `g2-app-esterne` | Le impostazioni | cattura | main | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S244 | `lav-impostazioni` | Le impostazioni | composta, da approvare | N6 T25, PA T28 | piani/lavagna-schede.html |
| S245 | `pen-impostazioni` | Le impostazioni | composta, da approvare | N4 T20, PA T28 | piani/lavagna-penne.html |
| S246 | `imp-info-prealpha` | Le impostazioni | composta, da approvare | PA T22, PA T48, PA T49 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S294 | `aspetto-barre` | Le impostazioni | nuova, da approvare | PA T11 | toppe: panels/settings.ts (la riga dal registro: chiave d'host appearance.bars, light \| marked, di serie light; la scrive crates/fub-host/src/settings.rs), il modulo che mette le scelte d'Aspetto sulla radice (data-bars, come appearance.density), i18n/catalog.ts |
| S295 | `aspetto-barre-marcate` | Le impostazioni | nuova, da approvare | PA T11 | toppe: panels/settings.ts (la stessa riga, scelta cambiata: il segno di modifica e «Azzera» come le altre righe), i18n/catalog.ts |
| S296 | `barra-marcate` | Le impostazioni | nuova, da approvare | PA T11 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S247 | `vuoto` | Casi ai margini | cattura | S2 T7 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S248 | `avvio-attesa` | Casi ai margini | cattura | main #308, PA T48, PA T49 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S249 | `avvio-lento` | Casi ai margini | cattura | main #308, PA T48, PA T49 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S250 | `avvio-guasto` | Casi ai margini | cattura | main #308, PA T48, PA T49 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S251 | `dati-uno` | Casi ai margini | composta, da approvare | main | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S252 | `dati-nome-lungo` | Casi ai margini | composta, da approvare | main | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S253 | `dati-cinquemila` | Casi ai margini | composta, da approvare | PA T45 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S254 | `riscontri-a` | I riscontri | composta, da approvare | PA T18 | catture del client, ritoccate nel testo o nelle righe; CSS dai blocchi |
| S255 | `riscontri-b-menu` | I riscontri | nuova, da approvare | PA T52, PA T18 | toppe: ui/app-menu.ts (una voce prima di «Impostazioni»), i18n/catalog.ts |
| S256 | `riscontri-b-apre` | I riscontri | nuova, da approvare | PA T52 | toppe: ui/app-menu.ts (kit/dialog.ts, poi l'apertura del browser che c'è) |
| S257 | `tel-nota` | Il telefono (Android di prova) | cattura | S2 T2–T7, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S258 | `tel-ferma` | Il telefono (Android di prova) | cattura | S2 T3, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S259 | `tel-tastiera` | Il telefono (Android di prova) | cattura | S2 T17, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S260 | `tel-sdraiato` | Il telefono (Android di prova) | cattura | S2 T3, S2 T7, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S261 | `tel-doc` | Il telefono (Android di prova) | cattura | S2 T21, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S262 | `tel-foglio` | Il telefono (Android di prova) | cattura | S2 T20, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S263 | `tel-cassetto` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S264 | `tel-ispettore` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S265 | `tel-lanciatore` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S266 | `tel-avvio` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S267 | `tel-avvio-attesa` | Il telefono (Android di prova) | cattura | main #308, PA T48, PA T49 | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S268 | `g2-tel-doc-pannello` | Il telefono (Android di prova) | cattura | S2 T21, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S269 | `g2-tel-foglio-aperto` | Il telefono (Android di prova) | cattura | S2 T20, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S270 | `t-cassetto-file` | Il telefono (Android di prova) | cattura | main, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S271 | `t-foglio-risultato` | Il telefono (Android di prova) | cattura | K3 T15, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S286 | `t-foglio-errore` | Il telefono (Android di prova) | cattura | K3 T15, PA telefono | la cattura: DOM del client (uguale a main o ritocco di S2, per pezzo), CSS dai blocchi |
| S272 | `tema-sviluppo` | I temi e la skin facile | nuova, da approvare | PA T36, PA T37 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre |
| S273 | `tema-installa` | I temi e la skin facile | nuova, da approvare | PA T36, PA T37 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre; un pezzo della cattura palette-file (il DOM del client delle catture, spostato) |
| S274 | `tema-sostituisci` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (kit/dialog.ts, prima di uninstall_theme e install_theme), i18n/catalog.ts |
| S275 | `tema-sostituisci-fallito` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (kit/dialog.ts, l'esito d'errore di T36) |
| S276 | `tema-rifiutato` | I temi e la skin facile | nuova, da approvare | PA T36 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; toppe: panels/settings.ts (i motivi di theme/loader.ts validateThemeBundle divisi in campi, non riscritti), skin/settings.css |
| S277 | `tema-collegato` | I temi e la skin facile | nuova, da approvare | PA T37 | toppe: panels/settings.ts (sotto «Temi installati», con la chiave developer.theme-folder), theme/theme.ts rimonta a fub://theme-changed; toppe: crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre |
| S278 | `tema-anteprima` | I temi e la skin facile | nuova, da approvare | PA T37, PA T38 | toppe: panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts; theme/examples/carta/ (fogli e skin.css) |
| S279 | `tema-tutti-componenti` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css |
| S280 | `tema-tutti-tavolozza` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css; toppe: src/dev/catalogo/ (la tavolozza di bench/catalog.ts), skin/settings.css |
| S281 | `tema-tutti-caratteri` | I temi e la skin facile | nuova, da approvare | PA T38, PA T39 | toppe: src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css; toppe: src/dev/catalogo/ (il campionario di bench/samples.ts), skin/settings.css |
| S282 | `tema-carta` | I temi e la skin facile | nuova, da approvare | PA T42, PA T54 | theme/examples/carta/ (fogli e skin.css) |
| S283 | `tema-carta-impostazioni` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/carta/ (fogli e skin.css) |
| S284 | `tema-mare` | I temi e la skin facile | nuova, da approvare | PA T42, PA T54 | theme/examples/mare/ (i due fogli) |
| S285 | `tema-mare-impostazioni` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/mare/ (i due fogli) |
| S297 | `tema-officina` | I temi e la skin facile | nuova, da approvare | PA T42, PA T54 | theme/examples/officina/ (i due fogli e skin.css) |
| S298 | `tema-officina-impostazioni` | I temi e la skin facile | nuova, da approvare | PA T42 | theme/examples/officina/ (i due fogli e skin.css) |

#### Gli scenari

| Scenario | Che cosa fa la persona | Passi | Gli stati, in ordine |
|---|---|---|---|
| `primo-avvio` | Il primo avvio | 5 | S248 → S249 → S247 → S184 → S1 |
| `scrivere` | Scrivere una nota | 6 | S1 → S9 → S10 → S6 → S214 → S5 |
| `riquadri` | Due riquadri | 4 | S21 → S19 → S20 → S22 |
| `foglio` | Un foglio di calcolo | 8 | S42 → S49 → S78 → S50 → S52 → S64 → S44 → S71 |
| `disegno` | Un disegno | 7 | S125 → S130 → S293 → S106 → S126 → S289 → S128 |
| `lavagna` | Una lavagna | 12 | S156 → S155 → S157 → S158 → S160 → S161 → S162 → S165 → S166 → S167 → S168 → S147 |
| `conflitto` | Un conflitto | 5 | S23 → S38 → S39 → S41 → S33 |
| `r01-versione` | Una bozza ritrovata e una versione | 4 | S29 → S30 → S28 → S31 |
| `cestino` | Il cestino | 3 | S26 → S217 → S27 |
| `componente` | Un componente | 7 | S183 → S205 → S204 → S206 → S207 → S208 → S185 |
| `ricetta` | Una ricetta (A1) | 5 | S191 → S197 → S198 → S199 → S203 |
| `vault` | Cambiare vault | 3 | S219 → S235 → S37 |
| `aspetto` | L'aspetto | 9 | S234 → S234 → S234 → S1 → S1 → S294 → S295 → S296 → S282 |
| `tastiera` | Solo con la tastiera | 5 | S212 → S230 → S2 → S8 → S239 |
| `errori` | Quando qualcosa va storto | 6 | S32 → S177 → S36 → S35 → S47 → S250 |
| `telefono` | Al telefono | 9 | S266 → S257 → S259 → S263 → S270 → S261 → S269 → S286 → S157 |
| `skin` | Una skin facile | 7 | S272 → S273 → S276 → S277 → S279 → S284 → S297 |
| `cambiato` | Che cosa è cambiato (risposte del 2026-11-07) | 31 | S1 → S1 → S248 → S246 → S234 → S294 → S295 → S296 → S125 → S287 → S288 → S289 → S290 → S291 → S111 → S255 → S204 → S26 → S232 → S56 → S51 → S23 → S132 → S3 → S183 → S166 → S282 → S284 → S297 → S297 → S298 |

#### I pezzi nuovi (DOM scritto a mano, `toppe/*.html`)

| Modello | Che cos'è | Destinazione | Task | Stati |
|---|---|---|---|---|
| `aspetto-barre` | D6 C: la riga «Le barre» in Aspetto (di serie: chiare) | panels/settings.ts (la riga dal registro: chiave d'host appearance.bars, light \| marked, di serie light; la scrive crates/fub-host/src/settings.rs), il modulo che mette le scelte d'Aspetto sulla radice (data-bars, come appearance.density), i18n/catalog.ts | PA T11, D6 C. Dopo «Densità». | S294 |
| `aspetto-barre-marcate` | D6 C: la riga «Le barre» con «Marcate» scelta | panels/settings.ts (la stessa riga, scelta cambiata: il segno di modifica e «Azzera» come le altre righe), i18n/catalog.ts | PA T11, D6 C | S295 |
| `comp-installato` | Un componente della comunità installato | panels/settings.ts renderInstalledComponent, con le parole del lessico (D18 A, PA T46) (nel banco: host/fake.ts, un InstalledPluginInfo con installation "41") | K1, K2 T3, PA T29 | S204, S205 |
| `comp-permesso` | Concedere il consenso: i permessi | panels/settings.ts renderInstalledComponent (il consenso «Concesso» chiede con confirm, che la Scrivania mostra con shells/scrittoio/confirm.ts e kit/dialog.ts), così com'è oggi | K1, K2 T3, PA T29 | S205 |
| `comp-fermo-tempo` | Un componente fermato: ha superato il tempo | panels/settings.ts renderInstalledComponent: nuovi data-state="stopped" sulla scheda, la riga dello stato al posto di «Attivo in questo vault» e «Riavvia» (fub-wasm-host: timeout; il motivo arriva con InstalledPluginInfo); il resto è la scheda di oggi | K1, PA T29 | S206 |
| `comp-fermo-errore` | Un componente fermato: un errore interno | panels/settings.ts renderInstalledComponent: nuovi data-state="stopped" sulla scheda, la riga dello stato al posto di «Attivo in questo vault», «Copia il motivo» e «Riavvia» (fub-wasm-host: trap; il motivo arriva con InstalledPluginInfo); il resto è la scheda di oggi | K1, PA T29 | S207 |
| `comp-aggiorna` | Un componente con una versione nuova (fuori dalla pre-alpha) | panels/settings.ts renderInstalledComponent: nuovi la riga della versione nuova e «Vedi cosa cambia» (nessun piano lo copre: «Differenze fra piani e codice») | fuori dalla pre-alpha | S208 |
| `banda-motore-pronto` | D5 A: il motore del disegno nella banda (pronto) | shells/scrittoio/frame/status-band.ts (il bottone #status-standing di S2 T4, anche per il disegno), skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S125, S291, S292, S293 |
| `banda-motore-perse` | D5 A: 3 parti restano come sono, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S126, S289 |
| `banda-motore-spento` | D5 A: motore spento, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S127, S290 |
| `banda-motore-fermo` | D5 A: motore fermo, nella banda (aperto) | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 | S128 |
| `banda-motore-apre` | D5 A: il disegno si sta aprendo, nella banda | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 (K5 non ha un segno per «si apre»: Differenze) | S129 |
| `banda-motore-cinquecento` | D5 A: 500 parti restano come sono, nella banda (aperto) | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 (il riquadro è quello di K5 2b) | S287 |
| `banda-motore-senza` | D5 A: senza motore, nella banda (aperto) | shells/scrittoio/frame/status-band.ts, skin/frame.css | D5 A: K5 T21–T23 con S2 T4 (il riquadro è quello di K5 5) | S288 |
| `disegno-rifiutato-annuncio` | D5 A: la modifica rifiutata, detta al lettore di schermo | editors/craft/surface.ts (l'annuncio di K5 6a nella regione viva del disegno; il testo da i18n/catalog.ts) | K5 T22 | S289 |
| `disegno-vuoto` | Un disegno vuoto: l'invito | editors/craft/surface.ts (il foglio vuoto, testo nuovo in i18n/catalog.ts) | K5 T21, PA T27 | S131 |
| `menu-nuovo` | «Nuovo»: la scelta del tipo | panels/explorer.ts (il pulsante #new-note apre il menu), ui/menu.ts | PA T43 | S34 |
| `altra-app` | «Apri con un'altra app» sotto un file che Fub non apre | editors/craft/surface.ts (la stessa vista .craft-empty di craft-rotto, più una riga d'azioni), skin/media.css | PA T30 | S36 |
| `altra-app-grande` | «Apri il sorgente» sotto un file troppo grande | editors/craft/surface.ts (.craft-empty, azioni per il file troppo grande), skin/media.css | PA T30 | S35 |
| `vault-scegli` | «Scegli un altro vault…» nell'avvio guasto | apps/client/index.html e src/avvio/*.ts (la schermata d'avvio di N7, già in main: un terzo bottone nel guasto del vault) | PA T30 | S37 |
| `foglio-enorme` | Un foglio enorme: l'avviso della lettura a pezzi | editors/grid/surface.ts (la stessa .grid-notice di oggi, un testo nuovo in i18n/catalog.ts) | griglia T8, PA T27 | S82 |
| `foglio-vuoto` | Un foglio vuoto: l'invito a scrivere | editors/grid/surface.ts (.grid-notice, testo nuovo) | griglia T1, PA T27 | S81 |
| `lav-colonna` | La colonna degli strumenti della lavagna (8 strumenti) | editors/canvas/chrome/rail.ts (nuovo, su kit/tool-rail.ts come il disegno) | N6 T26 e T49, PA T28 | S155, S156, S157, S158, S159, S160, S161, S162, S163, S164, S165, S166, S167, S168, S169 |
| `lav-opzioni` | La riga delle opzioni della lavagna (Selezione, niente scelto) | editors/canvas/chrome/options.ts (nuovo, su kit/options-bar.ts) | N6 T26 e T50, PA T28 | S155, S156, S157, S158, S161, S165, S166, S167, S168, S169 |
| `lav-opzioni-scrive` | La riga delle opzioni mentre si scrive in una scheda: la barra di formato | editors/canvas/chrome/options.ts (la barra di formato di panels/format-bar.ts dentro la riga) | N6 T27 e T41, PA T28 | S159, S160 |
| `lav-bolla-una` | La barra della selezione sopra una scheda | editors/canvas/chrome/selection.ts (nuovo, sul posto di panels/selection-bubble.ts) | N6 T26 e T51, PA T28 | S157 |
| `lav-bolla-molte` | La barra della selezione sopra molte schede | editors/canvas/chrome/selection.ts (nuovo) | N6 T26 e T51, PA T28 | S158 |
| `lav-vuota` | La lavagna vuota che spiega da sé | editors/canvas/chrome/empty.ts (nuovo) | N6 T26 e T62, PA T28 | S156 |
| `lav-lazo` | Il lazo che prende schede e tratti | editors/canvas/tools/lasso.ts (nuovo, N6 T86 con D-22 a) | PA T28 | S165 |
| `lav-estratti` | Il selettore delle parti attaccato alla scheda rilasciata (PDF) | editors/canvas/parts-picker.ts (nuovo, su kit/popover.ts, kit/list.ts e kit/field.ts) | N6 T28 e T74–T76, PA T28 | S166 |
| `lav-codice-menu` | Le tre voci della lavagna in codice nel menu della scheda | editors/canvas/chrome/commands.ts ed engine.ts (il menu contestuale, ui/menu.ts) | lavagna in codice T25, PA T28 | S167 |
| `lav-codice-disponi` | «Disponi»: il sottomenu | editors/canvas/chrome/commands.ts (canvas.layout.grid, .row, .column, .tree) | lavagna in codice T25, PA T28 | S167 |
| `lav-codice-riepilogo` | «Incolla codice»: il riassunto prima di scrivere | editors/canvas/chrome/commands.ts (canvas.paste_code con kit/dialog.ts) | lavagna in codice T25, PA T28 | S168 |
| `lav-codice-problema` | «Incolla codice» con un problema: il primo, col suggerimento | editors/canvas/chrome/commands.ts (canvas.check: niente si scrive) | lavagna in codice T25, PA T28 | S169 |
| `mcp-riga` | N2: ciò che ha fatto un agente (MCP), nel centro attività | panels/activity.ts (una riga per le scritture di fub-mcp, N2 T9) | PA T26 | S232 |
| `riscontri-voce` | D9 B: «Segnala un problema…» nel menu dell'applicazione | ui/app-menu.ts (una voce prima di «Impostazioni»), i18n/catalog.ts | D9 B: un task M in più dopo PA T18 | S255 |
| `riscontri-apre` | D9 B: che cosa si apre e che cosa si manda | ui/app-menu.ts (kit/dialog.ts, poi l'apertura del browser che c'è) | D9 B | S256 |
| `tema-sviluppo` | Il gruppo «Sviluppo» con la modalità sviluppatore | crates/fub-host/src/settings.rs (la chiave developer.mode, gruppo «Sviluppo»), panels/settings.ts la rende come le altre | PA T36 | S272, S273, S277 |
| `tema-catalogo` | «Temi installati» in modalità sviluppatore | panels/settings.ts (renderThemeCatalog: due bottoni in più quando developer.mode è acceso), i18n/catalog.ts | PA T36 e T37 | S272, S273, S274, S275, S276, S278 |
| `tema-collegato` | Il tema collegato, in sviluppo | panels/settings.ts (sotto «Temi installati», con la chiave developer.theme-folder), theme/theme.ts rimonta a fub://theme-changed | PA T37 | S277 |
| `tema-diagnosi` | Perché un tema è rifiutato: la diagnosi | panels/settings.ts (i motivi di theme/loader.ts validateThemeBundle divisi in campi, non riscritti), skin/settings.css | PA T36 e T37 | S276 |
| `tema-sostituisci` | Un tema con lo stesso id: «Sostituisci» | panels/settings.ts (kit/dialog.ts, prima di uninstall_theme e install_theme), i18n/catalog.ts | PA T36 | S274 |
| `tema-sostituisci-fallito` | La sostituzione fallita a metà | panels/settings.ts (kit/dialog.ts, l'esito d'errore di T36) | PA T36 | S275 |
| `tutti-componenti` | La pagina «Tutti i componenti»: i componenti negli stati del contratto | src/dev/catalogo/ (nuovo: il cuore di bench/catalog.ts e bench/kit.ts, caricato con import()), una vista aperta da Aspetto, skin/settings.css | PA T38 | S279, S280, S281 |
| `tutti-tavolozza` | «Tutti i componenti»: la tavolozza | src/dev/catalogo/ (la tavolozza di bench/catalog.ts), skin/settings.css | PA T38 | S280 |
| `tutti-caratteri` | «Tutti i componenti»: i caratteri | src/dev/catalogo/ (il campionario di bench/samples.ts), skin/settings.css | PA T38 e T39 | S281 |

#### Il CSS nuovo

| File | Posto | Blocchi | Task | Peso |
|---|---|---|---|---|
| `theme/scrittoio/structure.css` | struttura | `00-structure.css`, `70-kit-struttura.css`, `70f-kit-fila-struttura.css` | S2 T3, T4, T9, T16, T20, T21, T27 | 13 KB |
| `theme/scrittoio/skin/kit.css` | pelle | `71-kit.css`, `72-kit-vassoio.css`, `71f-kit-fila.css` | S2 T16, T20 | 19.4 KB |
| `theme/scrittoio/skin/frame.css` | pelle | `10-frame.css` | S2 T3, T4, T7, T9 | 3.7 KB |
| `theme/scrittoio/skin/drawers.css` | pelle | `20-drawers.css`, `21-icone.css` | S2 T8, T14 | 4.7 KB |
| `theme/scrittoio/skin/tree.css` | pelle | `30-tree.css` | S2 T8 | 2 KB |
| `theme/scrittoio/skin/sheets.css` | pelle | `40-sheets.css` | S2 T5, T6, T27 | 2.5 KB |
| `theme/scrittoio/skin/document.css` | pelle | `50-document.css` | S2 T11, T12 | 5 KB |
| `theme/scrittoio/skin/media.css` | pelle | `85-media.css`, `86-craft.css` | S2 T18, T19 | 2.9 KB |
| `theme/scrittoio/skin/nodes.css` | pelle | `60-nodes.css`, `61-nodes.css` | S2 T9, T13 | 3.9 KB |
| `theme/scrittoio/skin/graph.css` | pelle | `81-graph.css` | S2 T10 | 0.3 KB |
| `theme/scrittoio/skin/menus.css` | pelle | `65-menus.css` | S2 T10 | 1.4 KB |
| `theme/scrittoio/skin/launcher.css` | pelle | `82-launcher.css` | S2 T10 | 0.2 KB |
| `theme/scrittoio/skin/centres.css` | pelle | `45-centres.css` | S2 T5 | 0.8 KB |
| `theme/scrittoio/skin/settings.css` | pelle | `80-settings.css` | S2 T10 | 0.8 KB |
| `theme/scrittoio/skin/welcome.css` | pelle | `83-welcome.css` | S2 T10 | 0.2 KB |
| `shells/scrittoio/mobile/mobile.css` | telefono | `90-mobile.css` | S2 T3, T4, T5, T7, T11, T27 | 7.6 KB |
| `theme/scrittoio/series.ts` | serie | `01-series.css` | S2 T11 | 0.3 KB |
| `theme/scrittoio/recipe.ts` | serie | `02-ruoli.css` | S2 T16, T27 | 2.1 KB |
| `theme/scrittoio/skin/frame.css` | prealpha | `92-prealpha-banda.css` | D5 A: K5 T21–T23 con S2 T4 | 0.9 KB |
| `theme/scrittoio/skin/draw.css` | prealpha | `92-prealpha-disegno.css` | K5 T21, PA T27 | 0.6 KB |
| `theme/scrittoio/skin/settings.css` | prealpha | `92-prealpha-impostazioni.css` | PA T29, T36–T38 | 6 KB |
| `theme/scrittoio/skin/nodes.css` | prealpha | `92-prealpha-lavagna.css` | N6 T26–T28, PA T28 | 3.5 KB |
| `theme/scrittoio/skin/media.css` | prealpha | `92-prealpha-media.css` | PA T30 | 0.3 KB |
| `più file (ogni sezione dice il suo)` | prealpha | `92-prealpha-viste.css` | PA T56, T57 | 8.5 KB |
| `shells/mobile/mobile.css` | prealpha | `92-prealpha-telefono.css` | PA T47 | 2.4 KB |
| `theme/scrittoio/skin/frame.css e skin/settings.css` | prealpha | `92-prealpha-logo.css` | PA T49, D26 | 2.3 KB |
| `public/avvio/avvio.css` | prealpha | `92-prealpha-logo-avvio.css` | PA T49, D26 | 2.6 KB |
| `theme/examples/carta/ (fogli e skin.css)` | tema | `93-tema-carta.css` | PA T42, D17 | 5.4 KB |
| `theme/examples/officina/ (i due fogli e skin.css)` | tema | `93-tema-officina.css` | PA T42, D17 | 6.2 KB |
| `theme/examples/mare/ (i due fogli)` | tema | `93-tema-mare.css` | PA T42, D17, D27 | 3.1 KB |
| `nessun file: la serie calcola al montaggio del tema (theme/theme.ts, scrittoio/series.ts) i colori del logo di Carta` | tema | `93-tema-carta-logo.css` | PA T49, D26 | 0.9 KB |
| `nessun file: la serie calcola al montaggio del tema (theme/theme.ts, scrittoio/series.ts) i colori del logo di Officina` | tema | `93-tema-officina-logo.css` | PA T49, D26 | 1.4 KB |
| `nessun file: la serie calcola al montaggio del tema (theme/theme.ts, scrittoio/series.ts) i colori del logo di Mare` | tema | `93-tema-mare-logo.css` | PA T49, D26 | 1.4 KB |
<!-- dal-prototipo:fine -->

## Domande aperte

Ogni domanda ha le sue opzioni, il consiglio segnato, e i pro e i contro
su tempo, qualità e personalizzazione. Il criterio di `DECISIONS.md` è il
risultato migliore, anche quando costa di più. Fino alla risposta, i task
che aspettano una domanda non partono; gli altri sì.

Il 2026-11-07 l'utente ha fissato il criterio dei consigli: la qualità
massima del risultato (aperto, personalizzabile, senza problemi), e il
tempo non conta. Con quel criterio cambiano sei consigli (D1 B, D6 C, D8 B,
D9 B, D11 B, D17 C) e arrivano sei domande nuove (D19–D24). Le domande si
rispondono nella pagina «Le scelte di Fub pre-alpha»
(https://claude.ai/artifact/Q5Lydynyn4DV8xwFDLZt18,
`PLAN-ui/fub-pre-alpha/scelte.html`), con i 118 stati da approvare per
gruppi. Le risposte restano salvate nella pagina; il pianificatore le legge
da lì e le scrive qui e in `DECISIONS.md`.

Il 2026-11-07 l'utente ha risposto a tutte: D1–D24 e il via nella pagina,
D25–D28 in chat e poi nella pagina. Ha approvato anche i 14 gruppi di
stati. Dopo le prime risposte ha chiesto un Fub verde di serie e ha
mandato il suo logo: da lì vengono D25–D28. Ogni domanda dice in testa la
scelta e che cosa cambia nel piano. Più tardi, lo stesso giorno, l'utente ha
portato il logo definitivo, Marcuzzo (D26): D28 si è riaperta, perché la sua
risposta riguardava il primo logo. Poi ha detto con che cosa ha fatto
Marcuzzo, ha messo da parte la firma di Apple (D20) e ha approvato il
piano: di D28 resta solo la licenza, da confermare prima di PA T49.

### D1 · Il telefono, per l'APK di prova

**Decisa dall'utente il 2026-11-07: B.** Il telefono ha un piano suo
prima della pre-alpha: pianificatore, prototipo, poi i task. Il
pianificatore parte quando Scrittoio 2 è in `main`, per non disegnare due
volte la cornice; lo avvia l'utente col prompt
`PLAN-ui/fub-pre-alpha/prompt-piano-telefono.md`. Mentre gira, i coder
dell'orchestratore restano due al più (la regola del 2026-11-07). PA T22, PA T31 e la parte del telefono
di PA T23 aspettano che il piano del telefono sia in `main`. PA T8 e PA T47
restano: correggono la cornice di oggi, e il piano nuovo parte da lì. Gli
stati del telefono (S257–S271) restano la variante A, il punto di partenza
del piano. Il tablet resta fuori.

Oggi il telefono è la variante A di Scrittoio 2, «approvata per ora».
L'utente ha detto: «sicuramente da modificare pesantemente».

Col criterio del 2026-11-07 il consiglio passa da A a B: un telefono che si
sa già di voler rifare è un problema che chi prova vede subito. B parte
quando Scrittoio 2 è in `main`, per non lavorare due volte sulla cornice.

- **A.** L'APK esce con la cornice A, segnato «sperimentale»
  e lo dice. Un piano del telefono, con un prototipo suo, parte subito dopo
  la pre-alpha.
  - Tempo: niente in più adesso.
  - Qualità: chi prova l'APK vede un telefono provvisorio, ma lo sa.
  - Personalizzazione: si decide dopo, con calma, sul telefono vero.
- **B (consigliata dal 2026-11-07).** Un piano del telefono **prima** della pre-alpha: pianificatore,
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

**Decisa dall'utente il 2026-11-07: A.** `celle-griglia` è approvato così
com'è, con le due preferenze di griglia T9. Prima del primo task grafico
della griglia l'orchestratore scrive nel `PLAN.md` della griglia
«Approvato: sì, dall'utente il 2026-11-07 (PA D2)», e lo segna in
`DECISIONS.md`.

Il prototipo della griglia (`piani/celle-griglia.html`) non ha una riga
«Approvato» nel suo piano. Il prompt dice che D-1…D-8 seguono i consigli,
con due preferenze nelle Impostazioni (griglia T9).

Nel simulatore: S73–S80 (la griglia composta nella cornice), più S81 e S82
(il foglio vuoto e quello enorme, nuovi).

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
simulatore del secondo giro, segnati «da approvare»: S155–S166 (l'impianto,
la modifica e gli estratti), più S167–S169 per la lavagna in codice. Lo
scenario `lavagna` li passa in fila.

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
Gli stati composti sono 67: la griglia S73–S80, il disegno S111–S124 (K5
com'è approvato), le schede della lavagna S133–S147, le penne S148–S154, i
componenti S188–S190, le ricette S191–S203, e le loro Impostazioni S244 e
S245 (62 stati). Gli altri cinque sono catture ritoccate solo nel testo o
nelle righe: le Informazioni con la versione della pre-alpha (S246), i tre
casi dei dati (S251–S253) e il menu di oggi per D9 A (S254). Il menu
«Comandi» di K3 non è composto: è già nel client, ed è una cattura
(S44–S48).

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

**Decisa dall'utente il 2026-11-07: A.** Si costruisce la forma A: la
colonna del kit con gli strumenti di K5 e Testo, i gettoni del motore nella
banda, la fila del kit coi comandi della testa. La forma B (S111–S124)
resta nel simulatore solo come confronto, e la sua didascalia dice «D5 B:
non si costruisce». I casi che c'erano solo in B sono composti nella forma
A: 500 parti (S287), senza motore (S288), la modifica rifiutata (S289),
Testo spento (S290), la mano, la gomma e il rettangolo (S291–S293); la
penna è S125. Lo scenario `disegno` passa solo per A (S125, S130, S293,
S106, S126, S289, S128). Per K5 T21–T23 e S2
T22 la pagina di K5 resta la fonte dei pezzi (la colonna, le righe
d'opzioni, i riquadri del motore); lo stato A dice dove stanno nella
cornice.

L'utente aveva chiesto di vedere composte tutte e due le forme
(2026-11-05), e ha scelto guardandole. A è S125–S130 e S287–S293 (la banda
col motore, la colonna con Testo), B è S111–S124 (la testata di K5).

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

**Decisa dall'utente il 2026-11-07: C.** Di serie il vassoio chiaro sotto
tutte le barre, com'è sul ramo; in Impostazioni › Aspetto la riga «Le
barre: chiare · marcate» (chiave d'host `appearance.bars`, `light` di
serie, oppure `marked`). La fa PA T11. Nel simulatore la riga è in S294
(la pagina Aspetto, dopo «Densità») e cambia davvero tutti gli stati, come
la densità (D12): S295 è la stessa pagina con «marcate» scelta, S296 un
documento con la barra di formato e le barre marcate. Sono le due varianti
che T11 chiedeva di mostrare prima del codice. Il vassoio segue la tinta
da solo (la formula di S2 T16 parte dalla tinta della carta): col verde di
serie è `#f8faf8` di giorno e `#18211c` di notte, e il contrasto resta
sopra le soglie: 15,63, 6,06 e 3,43 di giorno, 13,43, 6,67 e 3,89 di
notte.

È la domanda aperta di Scrittoio 2: «Il vassoio più chiaro per la barra a
una riga e per la colonna degli strumenti: se ne riparla; T16 resta com'è».

Sul ramo di Scrittoio 2, T16 (fatto, 68f48788) ha già messo la fila
(`kit-bar`) e la colonna (`kit-rail`) sul ruolo nuovo `--bar-tray`:
`#f8fafc` di giorno, a metà fra la carta e `--sheet-2`, e `#1a1f27` di
notte. Di notte ci sono anche i gruppi come foglietti alzati. Nel
simulatore, gli stati con la barra di formato, il PDF e il disegno lo
mostrano già.

Col criterio del 2026-11-07 il consiglio passa da A a C: la stessa qualità
di A, più la libertà di cambiarla, che è anche accessibilità.

- **A.** Un vassoio solo, il più chiaro, per la barra a
  schede, la fila e la colonna, com'è sul ramo.
  - Tempo: niente.
  - Qualità: tutte le barre si somigliano, e il contrasto è provato (il
    testo, il testo tenue e il contorno: 15,78, 6,12 e 3,50 di giorno;
    13,47, 6,69 e 3,88 di notte, col blu di allora).
  - Contro: sulla scrivania del disegno (`--draw-desk`) la colonna si
    stacca meno.
- **B.** Solo la barra a schede è più chiara; la fila e la colonna tornano a
  `--sheet-2`, il grigio di oggi.
  - Tempo: un task piccolo (PA T11).
  - Qualità: due vassoi diversi nella stessa cornice.
- **C (consigliata dal 2026-11-07).** A, più una preferenza in Impostazioni › Aspetto: «Le barre: chiare
  · marcate». «Marcate» rimette `--sheet-2` sotto tutte le barre.
  - Tempo: PA T11, una chiave nuova nell'host e le foto delle due varianti.
  - Qualità: come A di serie.
  - Personalizzazione: la più alta. Chi vede poco il vassoio chiaro, per
    lo schermo o per gli occhi, lo rimette.

### D7 · `windows-sys`, per fermare i figli della CLI Craft su Windows

**Decisa dall'utente il 2026-11-07: A.** `windows-sys` diretta, solo per
`cfg(windows)`, alla versione che il lockfile ha già. PA T9 può partire.

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

**Decisa dall'utente il 2026-11-07: B.** La pre-alpha esce anche in
Flatpak, sul runtime GNOME, accanto a deb, rpm e AppImage: PA T51, in Fase
D prima di PA T22. Il pacchetto è un file `.flatpak` fra quelli della
pre-release. Flathub e Wayland restano in N10, fuori.

Col criterio del 2026-11-07 il consiglio passa da A a B: con lo stesso
WebKitGTK per tutti, ciò che si prova è ciò che vede chi prova.

- **A.** deb, rpm e AppImage, come fa `release.yml` oggi.
  - Tempo: niente.
  - Qualità: WebKitGTK cambia da una distribuzione all'altra (lo dice N10).
- **B (consigliata dal 2026-11-07).** Anche Flatpak, sul runtime GNOME (decisione 5), accanto ai tre di oggi.
  - Tempo: L, con i portali per aprire un vault fuori dalla sandbox.
  - Qualità: lo stesso motore su ogni distribuzione.
  - Contro: porta dentro una parte di N10. Vanno provati il vault fuori
    dalla sandbox e il watcher, che deve vedere le modifiche fatte da altri
    programmi.
- **C.** Solo AppImage.
  - Tempo: meno controlli.
  - Qualità: niente aggiornamenti dal sistema.

### D9 · Il canale dei riscontri della pre-alpha

**Decisa dall'utente il 2026-11-07: B.** I modelli di issue e le
Discussions di A (PA T18), più «Segnala un problema» nel menu di Fub: PA
T52, in Fase D. La fonte è S255 e S256; S254, il menu di oggi, resta come
confronto.

Col criterio del 2026-11-07 il consiglio passa da A a B: più è facile
mandare un riscontro, più ne arrivano, e più sono completi.

- **A.** I modelli di issue su GitHub, «Problema», «Ho perso
  dei dati» (con priorità) e «Idea», più le Discussions per le domande. La
  pagina «Prova la pre-alpha» li nomina (PA T18).
  - Tempo: S.
  - Qualità: tutto in un posto, e già lo strumento del lavoro.
- **B (consigliata dal 2026-11-07).** A, più «Segnala un problema» nel menu di Fub: apre il browser
  sulla pagina dell'issue con la versione e il sistema già scritti, e senza
  dati personali.
  - Tempo: un task M in più; il pezzo di GUI è nel simulatore (S255, S256).
  - Qualità e personalizzazione: le migliori, perché chi prova scrive di
    più se è facile.
- **C.** Solo le issue.
  - Tempo: il più corto.

### D10 · Due punti sciolti che non trovo

**Decisa dall'utente il 2026-11-07: B.** All'inizio di PA T10 il coder
cerca i due punti come dice il task. Se non li riproduce, lo scrive nel
registro e li chiude come «non riprodotti». PA T10 può partire.

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

**Decisa dall'utente il 2026-11-07: B.** Il giro a mano su macOS lo fa una
persona con un Mac, o un Mac in affitto nel cloud, con la lista di PA T23.
Trovare la persona o il Mac tocca all'utente, prima di PA T23;
l'orchestratore glielo ricorda quando PA T22 è chiuso.

Il «Fatto quando» 3 chiede il giro a mano sugli installer. Qui c'è Linux,
e l'utente ha un portatile Windows; un Mac non c'è.

Col criterio del 2026-11-07 il consiglio passa da A a B: la CI vede se
l'app parte, non se si usa bene.

- **A.** Su macOS si prova solo nella CI: l'installer si
  costruisce, e l'app parte e si chiude pulita. Le note della pre-release lo
  dicono.
  - Tempo: S (PA T22).
  - Qualità: nessuno ha usato il dmg a mano.
- **B (consigliata dal 2026-11-07).** Una persona con un Mac fa il giro a mano, o un Mac in affitto
  nel cloud, con la lista di compiti di PA T23.
  - Tempo: dipende da chi.
  - Qualità: la migliore.
- **C.** Niente dmg nella pre-release.
  - Qualità: chi ha un Mac non può provare.

### D12 · Densità e accento nel simulatore

**Decisa dall'utente il 2026-11-05: B.** Densità, contrasto e accento
cambiano davvero il simulatore, nelle due luci. Si scelgono nella pagina
Aspetto (S234), restano negli altri 285 stati finché «Aspetto di serie»,
sotto lo schermo, non le toglie: le tre densità vengono dalle misure di
`series.ts`, il contrasto alto e gli accenti dalla ricetta di `recipe.ts`
(`temi.json`).

La domanda, com'era nel primo giro: il simulatore cambiava davvero il
tema, la luce, le animazioni, il corpo, l'interlinea, la misura e il
carattere. Non cambiava la densità, il contrasto e l'accento, perché per
quelli il tema va ricompilato: quando li si sceglieva, segnava la scelta e
lo diceva nella riga sopra lo schermo.

- **A (consigliata nel primo giro).** Va bene così.
  - Tempo: niente.
- **B.** Prima di consegnare preparo le varianti: tre densità, il
  contrasto alto e gli accenti, nelle due luci.
  - Tempo: qualche ora, e alcuni MB in più.
  - Qualità: si vedono anche quelle.

### D13 · La prova di K2 con una persona: prima o dopo il merge

**Decisa dall'utente il 2026-11-07: A.** Prima di segnare pronta #290,
riallineata a `main`, l'utente fa il protocollo «Prova dei componenti di
Fub», da solo o con una persona. Ciò che emerge diventa un task di K2 o
una riga di `DECISIONS.md`; poi il merge. PA T17 ripete i compiti di K2
nella cornice nuova, con cinque persone.

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

**Decisa dall'utente il 2026-11-07: A.** Dove si legge, FubDraw diventa
Fub o il disegno (PA T33).

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

**Decisa dall'utente il 2026-11-07: A.** Il campo si chiama `extends`
(PA T34).

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

**Decisa dall'utente il 2026-11-07: A.** Un tema può ridisegnare ogni
icona, per nome (PA T40).

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

### D17 · L'aspetto dei temi d'esempio

**Decisa dall'utente il 2026-11-07: C, e «Salvia» diventa «Mare» (D27).**
I temi d'esempio sono tre: «Carta», «Officina» e «Mare». Col verde di
serie (D25) «Salvia» non mostrerebbe niente: sarebbe quasi Fub stesso. PA
T42 diventa «Tre temi d'esempio». Nel simulatore: «Carta» in S282 e S283,
«Mare» in S284 e S285 (al posto di «Salvia»), «Officina» in S297 e S298,
nuovi, da approvare.

La prova d'uscita della skin facile (PA T42) sono due temi: uno di circa
100 righe sopra la serie, con un'identità diversa, e uno di soli colori.
Diventano il punto di partenza di chi scrive un tema, e il simulatore li
mostra (gli stati «vestito da …», «da approvare»).

Col criterio del 2026-11-07 il consiglio passa da A a C: tre punti di
partenza più lontani fra loro, e la prova più dura dei cancelli. Con C il
terzo tema va disegnato nel simulatore prima dell'approvazione.

- **A.** «Carta» e «Salvia».
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
- **C (consigliata dal 2026-11-07).** Tutti e tre.
  - Tempo: mezza giornata in più, e un tema in più da tenere verde a ogni
    cambio della serie.
  - Qualità: la prova più larga.

### D18 · Le parole della scheda di un componente installato

**Decisa dall'utente il 2026-11-07: A.** La scheda segue il lessico (PA
T46). Le toppe `comp-*` del simulatore (S204–S208) hanno già le parole
nuove.

Nella stessa finestra delle Impostazioni, la pagina Componenti dice
«Spegni» e la scheda di un componente installato dice «Abilitato»,
«Disabilita il componente prima di rimuoverlo.» e «Rimuovi». Il lessico di
K2 vuole «Accendi», «Spegni» e «Togli» dappertutto, ma la sua guardia
guarda solo i menu (S204–S208, «Differenze fra piani e codice» 46).

- **A (consigliata).** La scheda segue il lessico: «Acceso», «Spegni il
  componente prima di toglierlo.», «Togli» (PA T46), e una guardia nuova
  sui testi `settings.components.*`.
  - Tempo: un task S, un'ora o due.
  - Qualità: una parola per ogni azione, come promette il lessico; chi
    prova la pre-alpha non si chiede se «spegnere» e «disabilitare» siano
    due cose.
  - Contro: la scheda di un componente installato e la pagina dei
    componenti di serie restano due pezzi diversi; questo li allinea solo
    nelle parole.
- **B.** Restano le parole di oggi; il lessico dice che vale solo per i
  menu e per la pagina Componenti.
  - Tempo: niente.
  - Qualità: due parole per la stessa azione nella stessa finestra.

### D19 · Il controllo automatico di tutte le viste

**Decisa dall'utente il 2026-11-07: A.** La sonda è passata il 2026-11-07
su tutte le viste del simulatore verde («Il controllo di tutte le viste»,
sotto «I pixel contro la fonte»). I difetti veri sono in «Differenze fra
piani e codice» (48–54), e li correggono PA T47 (due punti in più), PA
T56 (la carta del file e il fuoco) e PA T57 (i bersagli e i nomi interi);
il simulatore li mostra già corretti. I falsi allarmi sono spiegati
nell'elenco; i riscontri del telefono vanno al piano del telefono, quelli
dentro le pagine di altri piani ai piani che le possiedono. PA T55 porta
gli stessi controlli nel banco.

Il difetto dei 44 px (Differenze 47, PA T47) è venuto fuori guardando, non
da un controllo. «I pixel contro la fonte» prova che il simulatore è uguale
al client, non che il client sia senza difetti. Le viste sono 1.724 (298
stati: i 282 del computer a 3 larghezze × 2 luci, i 16 del telefono solo al
telefono, nelle 2 luci), e prima della sonda erano state guardate a
campione.

- **A (consigliata).** Prima dell'approvazione una sonda passa tutte le
  viste del simulatore e cerca:
  - testi tagliati con «…»;
  - elementi che escono dallo schermo o si sovrappongono;
  - bersagli del tocco sotto i 24 px (44 al telefono);
  - contrasto sotto le soglie del contratto del tema;
  - fuoco invisibile.

  Ogni difetto vero va in «Differenze fra piani e codice» con il suo task;
  i falsi allarmi si spiegano in un elenco. Poi un task nuovo porta gli
  stessi controlli nel banco, accanto a `bench:a11y`, così una modifica
  futura non li riporta.
  - Tempo: mezza giornata di pianificazione adesso, più un task M.
  - Qualità: la migliore. I difetti si trovano prima che un coder li copi,
    e la guardia li tiene lontani.
  - Contro: falsi allarmi da spiegare a mano (un «…» voluto, un'icona
    decorativa).
- **B.** Solo la sonda di adesso, senza guardia nel banco.
  - Qualità: un difetto simile può tornare con una modifica futura.
- **C.** Solo la guardia nel banco, durante l'implementazione.
  - Qualità: i difetti si trovano dopo che i coder li hanno copiati.
- **D.** Niente: restano il confronto dei pixel e l'occhio.

### D20 · La firma degli installer

**Sospesa dall'utente il 2026-11-09:** «se c'è da pagare Windows per ora
evitiamo […] queste cose si vedranno più avanti al momento della release».
PA T50 è rinviato; gli installer di Windows escono senza firma come il dmg.

**Decisa dall'utente il 2026-11-07: Windows firmato, macOS per ora no.**
Prima l'utente aveva scelto A (firmati tutti e due); poi, lo stesso giorno:
«Quello di Apple per ora ce ne freghiamo assolutamente». Quindi niente
Apple Developer Program. PA T50, in Fase D prima di PA T22, firma solo gli
installer di Windows, con SignPath Foundation, o con un certificato OV
(circa 150–300 USD l'anno) se Fub non è ammesso. Prima del task serve un
gesto dell'utente: la domanda a SignPath Foundation per Fub. Le chiavi
stanno solo nei segreti della CI: il coder non le vede.

Il dmg esce senza Developer ID e senza notarizzazione, con la sola firma
«ad hoc» che non chiede account (`bundle.macOS.signingIdentity: "-"`):
la documentazione di Tauri la consiglia per i Mac con Apple Silicon, che
non avviano codice scaricato senza nessuna firma (da riverificare nel
task). La prima volta macOS lo blocca, e la pagina «Prova la pre-alpha»
(PA T18) spiega come aprirlo da Impostazioni di sistema › Privacy e
sicurezza › «Apri comunque». La firma di Apple torna una domanda quando
l'utente la vuole, dopo la pre-alpha.

La pre-alpha esce senza firma («Fuori scope», installer firmati). Senza
firma Windows mostra SmartScreen («Windows ha protetto il PC»), e macOS
blocca l'app finché non la si apre da Impostazioni di sistema › Privacy e
sicurezza. Firmare chiede account a nome dell'utente e denaro.

Verificato il 2026-11-07, da riverificare quando si fa il task:
- Azure Artifact Signing (prima Trusted Signing) accetta persone singole
  solo negli Stati Uniti e in Canada;
- SignPath Foundation firma gratis i progetti open source che ammette: tutto
  il codice aperto, la firma fatta dalla CI, e l'editore mostrato è
  «SignPath Foundation»;
- un certificato OV di un'autorità costa circa 150–300 USD l'anno;
- l'Apple Developer Program costa 99 USD l'anno.

- **A (consigliata).** Firmati tutti e due. macOS con Developer ID e
  notarizzazione nella CI di rilascio. Windows con SignPath Foundation, o con
  un certificato OV se Fub non è ammesso. Un task nuovo in Fase D, prima di
  PA T22.
  - Tempo: L, più l'attesa delle verifiche di Apple e di SignPath.
  - Qualità: la migliore. Su macOS si installa senza blocchi, e su Windows
    l'editore è verificato.
  - Contro: su Windows SmartScreen può avvisare nelle prime settimane,
    finché la firma non si fa una reputazione. I segreti vanno tenuti nella
    CI.
- **B.** Solo macOS firmato e notarizzato. Su Windows resta l'avviso, e la
  pagina «Prova la pre-alpha» spiega come andare avanti.
  - Qualità: su Windows il primo incontro con Fub è un avviso.
- **C.** Come oggi, senza firma. Le note spiegano come aprire l'app.
  - Qualità: ogni persona che prova incontra un avviso o un blocco.

### D21 · Cinque difetti di #237 che non perdono dati

**Decisa dall'utente il 2026-11-07: A.** Dentro, in Fase A: PA T53, una
voce alla volta, con la regola di #237.

#237 tiene aperte cinque voci, fuori dal piano perché «sono UX, non perdono
dati»:
- R05: dopo un errore, Attività può tenere la lista vecchia senza dirlo;
- R06: i suggerimenti dei documenti chiedono una finestra di 200 documenti,
  e in un vault grande una nota può non comparire;
- R07: che cosa ricordano la barra laterale e le ricerche, per vault; un
  vault non deve ereditare la ricerca di un altro;
- R08: le viste dopo un cambio di vault (il grafo, dopo il cambio e dopo la
  chiusura);
- A03: Spazio su una casella delle Impostazioni lasciava il fuoco sul fondo
  della pagina; va riprovato.

- **A (consigliata).** Dentro, in Fase A: un task nuovo, una voce alla volta,
  con la regola di #237. Prima un test che la riproduce nel proprietario,
  poi la correzione lì; se non si riproduce, si chiude col test che lo
  dimostra.
  - Tempo: M–L.
  - Qualità: chi prova non incontra questi intoppi. R06 conta col vault da
    5.000 file (PA T45), A03 per chi usa la tastiera.
- **B.** Dentro solo R06 e A03, i due che una persona incontra di sicuro.
  - Qualità: gli altri tre restano possibili.
- **C.** Fuori, come oggi.

### D22 · L'editor di testo vestito dal tema (#242)

**Decisa dall'utente il 2026-11-07: A.** I colori dell'editor di testo
vanno nella pelle: PA T54, in Fase A dopo PA T35 e prima di PA T41, mai
nella stessa ondata di S2 T20 o della griglia T2–T3. Nel simulatore i tre
temi d'esempio vestono anche l'editor di testo (S282, S284, S297).

`editors/text/theme.ts` scrive i colori con `EditorView.theme` (42
`var(--ruolo)`), e alcuni profili Markdown passano ruoli in linea.
`check-inline-theme.mjs` tiene `theme.ts` in `SEPARATE`. Un tema cambia i
ruoli, ma la sua pelle non veste l'editor di testo come veste il resto.
#242 chiede di scegliere.

- **A (consigliata).** I colori nella pelle (`skin/editors.css`, sotto le
  classi `.cm-*`), la sola geometria in `EditorView.theme`. Gli hook nuovi
  entrano nel contratto prima di PA T41. Un task nuovo in Fase A, dopo PA
  T35. Non insieme a S2 T20 e alla griglia T2–T3, che toccano lo stesso
  file.
  - Tempo: M.
  - Qualità: un tema veste anche l'editor di testo, con gli stessi
    cancelli, e `theme.ts` esce da `SEPARATE`.
  - Contro: le foto dell'editor di testo si rifanno, e devono tornare
    uguali a oggi.
- **B.** L'editor di testo resta a parte per sempre, scritto in
  `docs/architecture/editor-surfaces.md`.
  - Personalizzazione: un tema non arriva dove si scrive.
- **C.** Dopo la pre-alpha. Gli hook si congelano senza l'editor di testo e
  si aggiungono dopo (le aggiunte sono ammesse), ma i temi d'esempio
  nascono senza.

### D23 · Spostare le parti della finestra

**Decisa dall'utente il 2026-11-07: B.** Fuori: un piano subito dopo la
pre-alpha, col prototipo e coi riscontri di PA T17.

La skin facile cambia l'aspetto (colori, forme, caratteri, icone), non dove
stanno le regioni della finestra: per esempio la barra laterale a destra o
le proprietà in basso. È fuori come «variante della shell».

- **A.** Dentro: un piano suo, con pianificatore e prototipo, dopo
  Scrittoio 2.
  - Personalizzazione: piena, già nella pre-alpha.
  - Contro: le varianti si disegnano prima dei riscontri sulla cornice
    nuova, e la prova con cinque persone (PA T17) si divide fra più
    varianti.
- **B (consigliata).** Un piano subito dopo la pre-alpha, col prototipo e
  con i riscontri di PA T17.
  - Qualità: le varianti nascono dall'uso vero, e la pre-alpha prova a
    fondo una cornice sola. Il motivo è la qualità, non il tempo.
  - Contro: chi prova la pre-alpha non può spostare le parti.
- **C.** Mai: solo la pelle.

### D24 · Il disegno completo (K6)

**Decisa dall'utente il 2026-11-07: B.** Fuori: K6 (#313) parte dopo la
pre-alpha, coi riscontri.

Il 2026-11-05 l'utente ha scelto «Tutti tranne K6», col consiglio di allora,
che pesava anche il tempo. K6 apre tutto il motore del disegno (100
strumenti, 881 comandi, 130 effetti, 43 pannelli: 1.551 righe di mappa). Il
suo piano è pronto (#313) e ha D1–D12 aperte.

- **A.** Dentro, dopo K5.
  - Qualità: i disegni hanno già l'editor professionale.
  - Contro: la prova con le persone si allarga a 1.551 funzioni prima che
    la base sia provata: più superficie, più punti dove può rompersi.
- **B (consigliata).** Fuori, come deciso: un piano subito dopo la
  pre-alpha, con i riscontri.
  - Qualità: la pre-alpha prova a fondo la base (dati, cornice, editor), e
    K6 si costruisce su una base già provata. Anche qui il motivo è la
    qualità, non il tempo.
  - Contro: chi prova la pre-alpha ha il disegno semplice di K5.

### D25 · Quale verde, di serie

**Decisa dall'utente il 2026-11-07: C, il verde del logo.** Dopo le prime
risposte l'utente ha scritto: «vorrei che il tema base di Fub fosse il
verde». Ha scelto prima B («Foglia», 145), poi, visto il logo, il verde del
logo (nella pagina, «tinta 159»). La tinta di serie è **160**, «Smeraldo»:
le tinte della «f» del primo logo vanno da 157,6 a 164 e il foglio scuro sta
a 160,6; 160 è un passo di 5°, che il simulatore mostra esatto. Fra 159 e 160
l'occhio non vede differenza. La «matita blu» (265) resta fra i campioni.
Lo porta nel codice PA T48. Il logo definitivo (D26, Marcuzzo) conferma
160: la sua cartella sta a 160,1 nelle due versioni a colori dell'utente,
Smeraldo (`#399b6e`) e Menta (`#89cca8`). PA T48 non aspetta altro.

In Fub una sola tinta fa tutto: i bottoni, la scelta, i collegamenti,
l'anello del fuoco, e un velo dello stesso colore sulle superfici
(`theme/scrittoio/recipe.ts`). Cambiare la tinta di serie cambia quindi
tutto, nelle due luci e col contrasto alto.

Il verde dice anche «fatto, salvato», fisso alla tinta 155: con un accento
a 160 sarebbero lo stesso colore. Per questo PA T48 porta nella ricetta una
regola: un colore di stato resta almeno 30° lontano dall'accento, dal lato
dove stava (`statusHue`). Con 160 il «salvato» va a 130, più verso il
giallo, e resta verde. La regola vale anche per le tinte libere, che oggi
possono già cadere sopra il rosso o il verde degli avvisi; con la matita
blu sposta l'informazione da 240 a 235.

- **A.** «Salvia» (130), il verde che c'è già fra i campioni.
  - Qualità: già provato coi cancelli del contrasto; lontano dal
    «salvato» anche senza regola. Tira all'oliva, e di notte al lime.
- **B (consigliata).** «Foglia» (145), il verde pieno.
  - Qualità: si legge subito come verde, nelle due luci. Serve la regola
    dei 30°.
- **C.** «Smeraldo» (160), un verde che tira al blu: il verde del logo.
  - Qualità: il più fresco; di notte il più luminoso. Serve la regola dei
    30°; è il più vicino a «Petrolio» fra i campioni.
- **D.** Una tinta scelta dall'utente nel simulatore.

### D26 · L'icona di Fub: Marcuzzo

**Decisa dall'utente il 2026-11-07: il logo è Marcuzzo.** Marcuzzo è un
gufo che sbuca da una cartella piena di fogli. L'utente ne ha dato tre
versioni, in `PLAN-ui/fub-pre-alpha/logo/originali/`: Smeraldo (la
cartella verde), Menta (verde chiaro, per i fondi scuri) e Kraft (la
cartella color cartone). Ha scritto: «Sicuramente voglio questi come loghi
ufficiali dell'applicazione», e poi che la cartella «dovrà avere il colore
del tema scelto in qualche modo, comunque gestendolo anche in modo tale che
non si vada a sovrapporre il colore attuale con quello di sfondo».
Marcuzzo prende il posto dell'icona di oggi (un quadrato viola con una «F»
bianca, `crates/fub-app/icons`) e della «f» corsiva sul colore dell'accento
dentro la finestra. Il primo ridisegno, la «f» a nastro sopra i fogli,
esce dal piano.

**Il gufo resta fermo, la cartella segue il tema.** Le piume, la pancia, le
facce, gli occhi, il becco e le zampe hanno sempre i colori del disegno
dell'utente. La cartella (davanti, retro e la sua ombra) e i due fogli
prendono la tinta dell'accento, con una regola nuova della ricetta,
`logoColors` in `theme/scrittoio/recipe.ts`:

- La scala viene dai file dell'utente: di giorno quella di Smeraldo, di
  notte quella di Menta. Tutte e due stanno alla tinta 160 (la cartella a
  160,1), quindi con la tinta di serie il logo è il disegno dell'utente.
  Per un'altra tinta ogni parte tiene la sua luminosità (L) e la sua croma
  (C) e prende la tinta nuova (t); i fogli restano spostati come nel
  disegno.

  | Parte | Giorno (Smeraldo): L · C · tinta | Notte (Menta): L · C · tinta |
  |---|---|---|
  | cartella davanti | 0,62 · 0,115 · t | 0,79 · 0,086 · t |
  | retro | 0,519 · 0,099 · t | 0,691 · 0,090 · t |
  | ombra della cartella | 0,549 · 0,094 · t | 0,719 · 0,080 · t |
  | foglio 1 | 0,78 · 0,055 · t + 35 | 0,475 · 0,108 · t |
  | foglio 2 | 0,709 · 0,059 · t − 30 | 0,581 · 0,090 · t + 35 |

- La tenuta: la cartella davanti e il retro si staccano dal fondo almeno
  3:1, 4,5:1 col contrasto alto (`THRESHOLDS[level].ui`), contro i due
  fondi dove sta il logo: `--bg` (la barra della finestra e l'avvio) e
  `--bg-elev` (le Informazioni). Dove non ci arrivano, la ricetta sposta
  solo la loro luminosità (più scura di giorno, più chiara di notte) fino
  alla soglia; l'ombra segue la cartella dello stesso passo. È la tenuta
  che la ricetta usa già per gli altri colori (`hold`).
- Con 160, di notte i colori sono esattamente quelli di Menta (`#89cca8`,
  `#67ad88`, `#77b493`, `#006e46`, `#238b8b`). Di giorno sono quelli di
  Smeraldo, con la cartella appena più scura per la tenuta: `#37996c` al
  posto di `#399b6e`, 3,02:1 sul fondo della barra. Col contrasto alto di
  giorno la cartella scende a `#077b50`.
- La regola regge per gli otto campioni e per i tre temi d'esempio, nelle
  due luci e nei due contrasti: nessuna delle 42 varianti scende sotto la
  soglia, e dove la scala dell'utente non basta la tenuta si ferma sulla
  soglia (Officina di giorno: 3,00:1). I valori e i rapporti sono nella
  pagina «Il logo» dell'artifact e in `logo/misure.json`
  (`script/logo-misure.mjs`).
- I gettoni sono cinque ruoli facoltativi della serie: `--logo-cartella`,
  `--logo-cartella-retro`, `--logo-cartella-ombra`, `--logo-foglio-1` e
  `--logo-foglio-2`. Una tinta scelta dalla persona li ricalcola con il
  resto della tavolozza (`accentPalette`). Un tema fatto a mano può
  dichiararli; se non lo fa, la serie li calcola quando il tema si monta,
  dalla tinta e dalla croma del suo `--accent` e dai suoi `--bg` e
  `--bg-elev`: un tema non si ritrova mai il logo verde di serie sopra i
  suoi colori.
- Con i colori forzati (il contrasto alto di Windows) il logo diventa una
  sagoma: il contorno in `CanvasText`, il gufo in `GrayText`, le facce, gli
  occhi e i fogli in `Canvas`.

**Le forme.** Stanno in `PLAN-ui/fub-pre-alpha/logo/`, con le classi
`logo-*` e coordinate intere, e si rifanno da
`originali/marcuzzo-smeraldo.svg` con gli script `logo-forme.py`,
`logo-minima.py` e `logo-simbolico.mjs` (in `script/`):

| Forma | File | Dove | Che cosa cambia |
|---|---|---|---|
| intera | `marcuzzo.svg` | da 32 px in su: le Informazioni (48), l'avvio (56), l'icona dell'app | niente: è il disegno dell'utente |
| minima 24 | `marcuzzo-24.svg` | 24 px: il marchio della barra | via le ombre, i puntini, le zampe e la luce del becco; l'occhio, la pupilla, l'occhiolino e il becco restano quelli del disegno |
| minima 16 | `marcuzzo-16.svg` | 16 px: la favicon, le icone piccole del sistema | in più via il riflesso dell'occhio e le strisce dei fogli sopra la testa |
| simbolica | `marcuzzo-simbolico.svg` | un colore solo: le icone simboliche di Linux, il livello monocromo di Android, il vassoio | un path pieno pari-dispari, dalla minima 24; un filo vuoto stacca la cartella davanti |

Le forme piccole tolgono e non ingrandiscono: la prima minima aveva
l'occhiolino più spesso e la pupilla più grande, e all'utente l'occhio
strizzato ingrandito non piace (2026-11-07). Alle misure piccole il gufo
resta quello del disegno, solo con meno dettagli.

**L'icona del sistema** (l'installer, il dock, il menu delle applicazioni,
Android) non conosce il tema: è Smeraldo, coi suoi colori fissi, su fondo
trasparente. È una scelta del pianificatore, e l'utente può cambiarla in
Menta o in Kraft, che restano fra gli originali. Kraft non entra nel tema:
resta il file dell'utente, per esempio per la stampa.

Lo porta nel codice PA T49, dopo D28.

### D27 · Il tema d'esempio «Salvia»

**Decisa dall'utente il 2026-11-07: A, diventa «Mare».** Soli colori: un
blu profondo e superfici grigio-azzurre, nelle due luci, scelti a mano e
non dalla ricetta. È il più lontano dal verde di serie, e chi preferiva il
Fub blu lo ritrova come tema. PA T42.

- **A (consigliata).** «Mare».
- **B.** «Prugna»: viola e superfici rosate; più difficile da tenere sopra
  le soglie del contrasto.
- **C.** Resta «Salvia»: quasi uguale a Fub di serie.

### D28 · Da dove viene il logo, e con quale licenza

**Lo strumento: risposto. La licenza: da confermare prima di PA T49.**
Il 2026-11-07 l'utente ha detto: «Ho fatto il logo di Marcuzzo. Con
l'intelligenza artificiale l'ho ritoccato dopo con Artcraft. Vectorcraft.»
Marcuzzo è quindi un disegno dell'utente, ritoccato con l'AI in ArtCraft e
poi passato in VectorCraft. ArtCraft (di storytold, codice `MIT OR
Apache-2.0`) è il programma: per il ritocco ha chiamato un modello di
immagini, e le condizioni che contano sono quelle di quel modello o del
servizio che lo serve. VectorCraft trasforma un'immagine in vettori sul
computer, e il risultato è di chi l'ha disegnata. Lo stesso giorno
l'utente ha approvato il piano «per il resto», senza nominare la licenza.

Fub è open source (il codice è MIT o Apache-2.0): il logo entra nel
repository pubblico e ha bisogno di una licenza scritta, e le due licenze
di Fub vanno bene per il codice, non per un disegno. **PA T49 non parte**
finché: l'utente conferma la licenza (il consiglio resta A); l'utente dice
quale modello ha usato in ArtCraft per il ritocco; l'orchestratore ha
letto le condizioni di quel modello e scritto in `DECISIONS.md` che
permettono l'uso in un progetto pubblico. Le due domande le fa
l'orchestratore all'utente, insieme, prima di T49.

- **A (consigliata).** CC BY-SA 4.0 per i file del logo, con una nota in
  `assets/logo/LEGGIMI.md` che chiede a chi fa un fork di cambiare nome e
  logo.
  - Qualità: è aperta come il resto di Fub; chi ridistribuisce Fub intero
    (una distribuzione Linux, Flathub) tiene l'icona senza chiedere, e chi
    modifica il logo deve ridarlo con la stessa licenza. È la scelta di
    molti progetti aperti per le immagini.
  - Contro: la nota sul fork è una richiesta, non un obbligo: nessuna
    licenza aperta impedisce di usare il logo.
- **B.** Tutti i diritti riservati sul logo, con il permesso scritto di
  usarlo per Fub e per chi lo ridistribuisce senza cambiarlo (come
  Firefox).
  - Qualità: il nome e il logo restano riconoscibili come di Fub.
  - Contro: il pacchetto non è più tutto libero; qualche distribuzione
    sostituisce l'icona, e serve una pagina di regole da tenere.
- **C.** Pubblico dominio (CC0).
  - Qualità: la più semplice, nessuna condizione.
  - Contro: chiunque può usare Marcuzzo, anche per un altro prodotto.

Se Marcuzzo è fatto con un'AI, si leggono anche le condizioni dello
strumento: alcune non danno i diritti sull'immagine a chi la genera, o li
danno solo con un abbonamento.

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

### Il ramo, le consegne e i due coder

- **Due coder alla volta**, Opus con ragionamento medio
  (`.claude/agents/coder.md`), ognuno nel suo worktree. Due task vanno
  insieme solo se i loro «Tocca» non si toccano, non stanno nello stesso
  crate (salvo che il piano li dica indipendenti) e la tabella della fase
  non li tiene separati: le note «mai con…» (per esempio T48 con un task
  che rifà le baseline, T54 con S2 T20 o con la griglia T2–T3). Nel
  dubbio, uno alla volta.
- **I task medi e piccoli a Haiku** (regola dell'utente del 2026-11-10): un
  task può andare a un coder Haiku 5.5 con ragionamento alto
  (`model: "haiku"`, `effort: "xhigh"`, dal 2026-11-10 sera; prima `max`), in più dei due Opus e senza un
  numero massimo fissato dall'utente. Haiku è un buon coder: gli vanno anche
  task non banali, non solo i ritocchi. Va a Haiku un task che il piano
  descrive bene («Cosa fare», casi limite e prova scritti), di taglia
  piccola o media, anche con logica vera, test nuovi, Rust o più file della
  stessa area. Resta a Opus un task molto complesso: scelte di disegno che il
  piano lascia aperte; un contratto pubblico nuovo o cambiato (ABI, WIT,
  IPC) o un formato su disco; sicurezza e `Guard`; un movimento o una resa
  delicata (i motori dei segni, la penna); i prototipi grafici; un task che
  attraversa molte aree. Nel dubbio fra i due, Opus. Quanti Haiku insieme lo
  dice il computer (15 GB di RAM, il disco, una porta del banco per
  ognuno), e le regole sui «Tocca» qui sopra valgono anche per loro. Il
  brief, la revisione e l'integrazione sono gli stessi; un task che Haiku
  non chiude bene torna a Opus.
- **I task PA** si integrano su `piano/fub-pre-alpha` (la riga «Ramo:»):
  il coder parte dalla testa di quel ramo e trova nel suo worktree il
  simulatore, le toppe e i blocchi di `PLAN-ui/`. La PR del ramo del piano
  resta bozza, per la CI corta, e non si unisce mai così com'è: porta
  `PLAN-ui/` (13 MB).
- **Le consegne.** Il codice dei task PA entra in `main` a pezzi, con un
  ramo di consegna `pre-alpha/consegna-<n>` nato da `origin/main`.
  L'orchestratore ci porta con `cherry-pick -x`, nell'ordine, i commit
  integrati dopo la consegna di prima, tranne quelli che toccano solo
  `PLAN.md`, `PLAN-ui/` e `NOTE-pianificazione.md`. Poi apre la PR, la
  segna pronta (la CI completa, con Windows e macOS) e, quando è verde,
  chiede all'utente il merge. Dopo il merge unisce `origin/main` nel ramo
  del piano: merge, mai rebase né force.
- **Quando si consegna:** quando un passo che viene dopo ha bisogno di quel
  codice in `main` (la colonna «Dipende da»: per esempio T48 e la skin
  facile prima della Fase B), alla fine di ogni fase, e comunque quando una
  consegna arriva a circa sei task, perché una PR più lunga si rivede male.
- **`DECISIONS.md`.** Le righe che l'orchestratore aggiunge al registro sono
  commit a parte (`docs(decisioni): …`) e viaggiano con la consegna. La
  prima consegna porta anche le righe scritte durante la pianificazione:
  il diff di `DECISIONS.md` fra il punto in cui il ramo del piano è nato da
  `main` (il `merge-base`) e la testa del ramo, applicato con `apply -3`.
- **I task degli altri piani** si fanno dal loro `PLAN.md`, sul loro ramo e
  con la loro PR. Il coder parte dalla testa di quel ramo. Il merge di
  `origin/main` nei loro rami lo fa l'orchestratore (merge, mai rebase né
  force), e il loro merge in `main` chiede l'OK dell'utente come ogni altro.
- **Alla fine** (PA T24 fatto): il piano si chiude come dice `/orchestra`
  (la CI completa, il resoconto), ma il ramo del piano non si unisce. Il
  codice è già entrato con le consegne; `PLAN.md` e `PLAN-ui/` restano
  nella storia del ramo su GitHub, fuori da `main`, e la PR del piano si
  chiude senza merge, con l'OK dell'utente.

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
3. **Il DOM.** Si apre lo stato nel simulatore col suo numero S (lo stato,
   la luce, la larghezza) e si guarda «I pezzi di questo stato». La fonte
   del DOM dipende da che cosa dice il pezzo:
   - **uguale**: il DOM è già in `main`; si cambia solo la pelle;
   - **cambiato**: il DOM che il task di Scrittoio 2 costruisce. La fonte è
     il prototipo di Scrittoio 2; nel simulatore lo si vede montato;
   - **composto**: il DOM della pagina approvata del piano (il link è nella
     didascalia). Il simulatore dice solo dove sta nella cornice;
   - **nuovo**: il `<template>` di `PLAN-ui/fub-pre-alpha/toppe/*.html` che
     ha il task in testa. «DOM» lo mostra, «Segna il nuovo» lo contorna.

   Si costruisce lo stesso albero nel modulo del task: classi, ruoli, ARIA e
   `data-i18n`. I testi vanno in `apps/client/src/i18n/catalog.ts`, con
   l'inglese. Uno stato composto o nuovo si costruisce solo dopo il sì
   dell'utente al suo numero («Approvato:» in testa al piano); se manca, il
   task aspetta. Al telefono uno stato «ricomposto col guscio mobile» è
   provvisorio come il telaio A (D1): non è una fonte.
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
  «nuovo» (da `toppe/*.html`), i testi, gli stati da fotografare.
- **Si copia** dal prototipo di Scrittoio 2: il DOM dei pezzi «cambiato».
- **Si copia** dalla pagina approvata del piano: il DOM dei pezzi
  «composto».
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
       per un task grafico, gli stati S<n> del simulatore
       (PLAN-ui/fub-pre-alpha/simulatore.html#stato=<id>), già approvati,
       e la fonte del DOM di ogni pezzo (uguale, cambiato, composto, nuovo).
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
- **A ogni consegna:** la CI completa (la PR di consegna pronta), con
  Windows e macOS, prima di chiedere il merge.
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
   (T25, 2026-11-04). Con D3 A li disegna questo giro: S155–S166, da
   approvare.
4. **N6 «v1 senza T79».** T80–T84 dipendono da T79 e da PdfCraft P1, P2 e
   P4, e T85 dipende da T82: escono con T79. Esce anche T88, che dipende da
   D-20 (il piano dei CSV, che non c'è).
5. **Il finto del banco** (`bench/fake-ipc.ts`) non ha `appearance.motion`,
   che l'host ha (`crates/fub-host/src/settings.rs`, «Animazioni»): la foto
   approvata delle impostazioni di S2 non mostra la riga (PA T1).
6. **S2 T11** porta il corpo a 18 e la misura a 58ch, mentre il finto del
   banco dice 17 e 68. La foto approvata di S2 mostra 17; il simulatore
   scrive 18, il valore di S2 T11. Il client delle catture
   (`script/finto/cattura.patch`) dice già 18, quindi il simulatore coincide
   con la sua foto (S233 `impostazioni`: 0,00 %); la differenza resta solo
   contro la foto approvata di S2.
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
    (`--bar-tray`) (D6). Il piano di S2 scrive `#f8fafc` e `#1a1f27`, ma
    sono la sua formula con la matita blu: la formula parte dalla tinta
    della carta, e col verde di serie (PA T48) dà `#f8faf8` e `#18211c`.

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
    PA T42 parte dai tre temi d'esempio.

Le differenze trovate costruendo il simulatore del secondo giro
(2026-11-06, verificate su `main` 638358da e sul client delle catture):

37. **Un collegamento si segue con Ctrl+clic** (⌘+clic sul Mac), non col
    clic semplice, che mette il cursore nel testo
    (`editors/text/profiles/markdown/livepreview.ts:1506`, `:1516`). Il
    simulatore fa lo stesso e lo dice con un avviso. Gli scenari che
    seguono un collegamento lo scrivono nel passo.
38. **Sul telefono i menu mostrano i tasti.** Il piede del menu del tasto
    destro e le voci scrivono la scorciatoia in un `<kbd>`
    (`ui/menu.ts:484`, `:580`), e nessuna regola di
    `shells/scrittoio/mobile/mobile.css` li nasconde. Le catture del
    telefono li mostrano così; è un punto della cornice del telefono, che
    resta provvisoria (D1).
39. **I gesti del telefono sono in parte nuovi.** La pressione lunga apre
    già il menu del tocco (`ui/long-press.ts`, 500 ms, montata in
    `desktop-shell.ts:802`), e il simulatore la imita coi suoi tempi. Le
    strisciate che aprono i cassetti e il bordo che torna indietro non ci
    sono in `main`: nel simulatore sono provvisorie, come la cornice (D1).
    Sul computer l'affaccio dei cassetti (`shells/scrittoio/frame/peek.ts`:
    il puntatore sosta 160 ms sul bordo) il simulatore non lo fa, perché è
    un gesto nel tempo che una cattura non prende.
40. **Le catture della lavagna di oggi** (`s2/lavagna`, `s2/lavagna-700`)
    sono di prima di N6 e mostrano `.canvas-toolbar`, la barra che N6 T26 e
    T49 sostituiscono. Non hanno una definizione per rifarle; gli stati
    della lavagna di questo giro sono composti da `piani/lavagna-schede.html`
    o nuovi (D3).
41. **La riga dei dati della nota** (S2 T12, `.note-facts`) non c'è nel
    client: la disegna il prototipo di Scrittoio 2. Nelle catture la mette
    `script/mods.mjs` solo nel DOM copiato, non nella foto, quindi il
    confronto dei pixel la toglie prima di fotografare il simulatore.
42. **Le catture non sono `main`.** Vengono da `anteprima/tutto` (i piani
    approvati uniti a `main`) con le sonde di Scrittoio 2 in `src/` (le
    icone nuove, il gruppo Carattere, la striscia degli spazi:
    `script/finto/cattura.patch`). «I pezzi di questo stato» dice per ogni
    pezzo se il DOM è quello di `main` («uguale») o un ritocco di Scrittoio 2
    («cambiato»).
43. **`ricette.html` non ha `<!doctype>`.** La pagina approvata di A1
    (`PLAN-ui/ricette.html` su `piano/a1-base-per-ai`) comincia da
    `<title>`: l'artifact la pubblica dentro uno scheletro con il doctype,
    mentre aperta da sola va in modalità quirks e cambia le misure. Il
    simulatore la copia in `piani/` con lo scheletro, e le sue foto
    (`p-ricette-*`) si prendono da quella copia, cioè come l'ha vista
    l'utente. Lo stesso vale per `a1-piano.html`, che il simulatore non usa.
44. **Quattro pagine dei piani prendono i caratteri da Google.**
    `ricette.html`, `disegno-motore.html`, `celle-griglia.html` e
    `menu-comandi-fogli.html` caricano Hanken Grotesk, Newsreader e IBM Plex
    Mono da `fonts.googleapis.com`. L'app non può (`font-src 'self' asset:
    data:` in `crates/fub-app/tauri.conf.json`) e non ne ha bisogno: gli
    stessi caratteri sono nei pacchetti `@fontsource` del client. Il
    simulatore, che gira senza rete, li prende da lì (`vista-sim.js`,
    `caratteriPiano`). Chi copia un pezzo da quelle pagine non copia il
    `<link>` ai caratteri.
45. **L'ispettore compatto nelle catture.** Il banco monta i blocchi dopo
    tutto il CSS del client, quindi nella foto `--inspector-w: 264px` di
    `00-structure.css` vince anche sul passo compatto delle preferenze (260
    px, `measures.ts` di oggi). Nell'app `structure.css` viene prima di
    `fub:preferenze`, e dopo S2 T9 il passo compatto arriva a 216 px. Il
    simulatore mostra 216; la foto di `g2-compatta` resta quella del banco,
    e il confronto dei pixel lo dice («I pixel contro la fonte»).
46. **Le parole dei componenti.** Il lessico di K2 (`i18n/lexicon.ts`,
    «I componenti (K2): le parole della pagina Componenti … sono queste,
    dappertutto») vuole «Accendi», «Spegni» e «Togli» al posto di
    «Abilita», «Disabilita» e «Disinstalla». La scheda di un componente
    installato (`panels/settings.ts`, `renderInstalledComponent`) dice
    «Abilitato», «Disabilita il componente prima di rimuoverlo.» e
    «Rimuovi», e la guardia (`ui/menu-budget.test.ts`) guarda solo le voci
    dei menu. Il primo giro del simulatore aveva inventato una scheda con
    «Disinstalla» e un dialogo «Installare …?» che il codice non ha: ora le
    toppe `comp-*` copiano la scheda e il dialogo del consenso veri, con le
    parole di oggi (D18, PA T46).
47. **I 44 px del tocco sul telefono.** `shells/mobile/mobile.css` dà
    `min-width` e `min-height` di 44 px a `button`, `[role="button"]`,
    `input[type="checkbox"]` e `input[type="radio"]`, con
    `:root[data-client-shell="mobile"]` davanti. Così vince su
    `input[role="switch"]` di `skin/controls.css` (32 × 18): sul telefono
    ogni interruttore è un cerchio di 44 px col pomello in mezzo, che
    sembra un bottone di scelta. Lo stesso minimo prende il posto di
    `min-width: auto` dei bottoni, quindi in una fila flessibile si
    stringono fino a 44 px: le schede delle impostazioni diventano «Co…»,
    «C…», «S…», mentre la riga doveva scorrere (`skin/settings.css`, sotto i
    760 px: `overflow-x: auto` e `white-space: nowrap`). Si vede nelle
    catture vere (`catture/tel/t-comp-spegni-*.png`) e c'è in `origin/main`
    (638358da). Nessun piano lo copre, e le scene del telefono del banco non
    aprono le impostazioni. Il simulatore mostra la correzione
    (`92-prealpha-telefono.css`, PA T47); il confronto dei pixel lo dice.
48. **Altri due effetti dei 44 px al telefono.** Il controllo di tutte le
    viste (D19) li ha trovati. In un elenco dichiarato (`.ui-list`: il
    cestino, le versioni) la riga diventa alta quanto il bottone di 44 px, e
    fra un «Ripristina» pieno e l'altro resta 1 px: sembrano un bottone solo,
    e l'anello del fuoco cade sul vicino (S26 al telefono). Il tondo della
    modalità galleggia sulla carta del documento, bianca anche al buio, e il
    suo anello verde chiaro sta fuori, sul bianco, a 2,2:1 (S83 al
    telefono). PA T47 li corregge con la regola dei 44 px.
49. **Anelli del fuoco che non si vedono.** L'anello di serie sta 2 px fuori
    dal controllo. L'editor (`.cm-editor > .cm-scroller`), l'anteprima
    (`.pane-preview`) e il grafo (`.graph-main`) riempiono il loro riquadro,
    che taglia l'anello su tutti e quattro i lati: col fuoco della tastiera
    non cambia niente (S5, S33, S210). La pillola dei commenti nello
    stretto (`.rich-side-open`) galleggia sulla carta del documento e ha
    l'anello d'ombra fuori, sul bianco: al buio 2,2:1 (S83). PA T56.
50. **La carta del file al buio coi segni del tema.** In `look-file` la
    carta è chiara in ogni luce, e `structure.css` ricollega i ruoli
    `--doc-*` ai `--paper-*`. Non ricollega l'anello (`--focus-ring`), la
    sintassi (`--syn-*`) e l'accento dei segni della griglia (la cella
    attiva, la selezione, il riempimento, la cella in modifica:
    `skin/editors.css`, `var(--accent)`). Al buio sul bianco l'anello e la
    cella attiva stanno a 2,2:1, il «=» e i numeri della formula a 1,8:1
    (S43, S50, S51). La cella in modifica ha il fondo dei pannelli
    (`--bg-elev`, scuro) attorno alla riga, e a sinistra la striscia scura
    del margine delle pieghe: `FIELD_LAYOUT` di `editors/text/engine.ts`
    toglie i numeri di riga a un campo ma non le pieghe, anche nella barra
    delle formule. PA T56.
51. **L'azione di un avviso.** `.link-button` ha l'accento, e sul velo
    rosso o giallo di un avviso (`.conflict-banner`, `.sheet-notice`) sta a
    4,40–4,48:1 alla luce, sotto il 4,5 di un testo di 12 px: «Decidi dopo»,
    «Riprova», «Chiudi», «Scegli ora» (S23, S30, S32, S33, S41). PA T56.
52. **Le schede colorate della lavagna.** `nodeFill`
    (`editors/canvas/engine.ts`) dà a una scheda colorata il colore al
    18–22 % su `transparent`: si vede la scrivania sotto, più scura della
    carta, e il titolo in grafite, la freccia e «Converti in nota» scendono a
    4,19–4,27:1 (S132). Una scheda senza colore ha `var(--doc-bg)`. Le linee
    usano la stessa tabella (`PRESET_FILL`), e lì `transparent` va bene.
    PA T56.
53. **Bersagli sotto i 24 px senza distanza.** Sul computer WCAG 2.5.8
    chiede 24 px, o un cerchio di 24 px attorno al bersaglio che non tocchi
    i vicini. Non lo hanno: la freccia di un pulsante diviso della barra a
    schede (14 × 28, in 27 stati), i quadretti della tavolozza (18 × 18 a
    2 px l'uno dall'altro, S56), la modalità nella banda (22 px), il percorso
    a briciole che si rinomina (18–20 px, S7), le etichette XMP (20 px,
    S179), il «+» e la maniglia del blocco (19 × 20, e a riposo a 2,2:1,
    S3, S8), la pastiglia del titolo (20 × 14, S20). PA T57.
54. **Nomi in «…» senza il testo intero.** Un nome tagliato si può lasciare
    se il testo intero sta nel suggerimento o nell'etichetta. Non ci sta:
    «Permessi dei componenti inclusi» nell'indice delle impostazioni (185
    px in 183, S183–S208), i nomi degli oggetti del disegno (S106), il
    titolo di una scheda della lavagna (S132), «Nessuna nota in primo piano»
    nell'ispettore (S210), il dettaglio di una riga del lanciatore (S211).
    PA T57.

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
Stato: [x] fatto · c9d458e6 · il finto ha tutto il gruppo Aspetto dell'host
(18 voci, non solo Animazioni; registro 2026-11-08); cambiano le scene
`settings` e `prefs-appearance`, forse `prefs-theme-settings` e
`confirm-danger`: baseline dal runner

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
Stato: [x] fatto (K5 a dec329f3, N4 a a2ff0415: main dentro, `tsc` pulito, `check.sh --rapido` verde salvo due test di tempo rossi sotto carico e verdi da soli; l'ADR dell'inchiostro di N4 diventa la 0241, i vettori `ink-*` vanno da 87 a 103)

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
Stato: [x] fatto · 9369b042..5432f8b4 · frame della sola lettura nel kernel,
niente turno nell'host, una bandiera per lettura (spegnere il plugin ferma la
lettura, non il job), la sbarra allo smontaggio; `check.sh --rapido` verde
tranne craft_ranged (#310, noto, va in T19); resta: una richiesta di rete
dentro una lettura guarda solo la bandiera della lettura

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
Stato: [x] fatto · c0bf4733..8aa22806 · R01 non riprodotto (test sui tre chiamanti), R02 non perde testo (cambiata sul disco, poi conflitto); forceReload passa dalla bozza, reloadCurrent tolto · check --rapido 18/19 sull'integrazione: rosso solo il vitest per tempi scaduti sotto carico (load 24), i 14 file rilanciati da soli 371/371 verdi

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
Stato: [x] fatto · 6fb1c4de..8d1f6614 · la Lettura mostrava già il buffer e teneva la fascia: si aggiunge solo la riga «Stai leggendo la tua versione, non ancora salvata» (anche in inglese), scena del banco `conflitto-lettura`, foto confrontate con S33 · check --rapido 18/19: rosso solo scene.test «ci sono tutte», le 2 baseline della scena nuova vengono dal runner (con la consegna 1, o prima se si lancia ci.yml sul ramo); i tempi scaduti sotto carico verdi da soli

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
Stato: [x] fatto · 9faa3dbb · `check.sh --rapido` verde tranne tre test di
`fub-host` a tempo (craft open_with, launch, craft_ranged #310) caduti col
carico a 37 e verdi da soli; varianti, enum e funzioni esportate restano
con la regola di prima (li prova T7)

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
Stato: [x] fatto · d51efa75..b28d5886 · la risposta è «no»: un caso nuovo in un
`enum`/`variant` o una funzione nuova in un'interfaccia esportata rompono il
plugin già compilato (voci 3, 4 e 5 di #289); `cargo test -p fub-wasm-host`
verde dal worktree dell'orchestratore; aperta per l'utente la regola della
guardia e dell'ADR 0235 (stringere enum, variant e funzioni esportate come i
record?)

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
Stato: [x] fatto · 774e24d2 · la soglia del telefono non è
800 px (quello è il `minWidth` della finestra desktop): il telefono è un
altro ingresso (`mobile.html`), con la sola soglia dei 600 px; le cartelle
sono due (`shells/mobile/` e `shells/scrittoio/mobile/`). Trovato:
i filtri `paths` di `mobile.yml` non coprono `shells/scrittoio/mobile/**`
né `theme/scrittoio/`, quindi una PR che cambia solo la cornice del
telefono non costruisce l'APK (da correggere fuori da T8)

## T9 · Su Windows il tempo scaduto ferma anche i figli della CLI Craft

Perché: su Windows, quando il tempo scade, oggi si ferma solo la CLI Craft
e non i suoi figli. Serve un job object, cioè `windows-sys` come
dipendenza diretta. D7 è A (2026-11-07).
Ramo: piano/fub-pre-alpha.
Tocca: `Cargo.toml` (la dipendenza del workspace, solo per
`cfg(windows)`), `crates/fub-host/Cargo.toml`,
`crates/fub-host/src/craft/launch.rs`, `deny.toml` (solo se serve), la
pagina di `docs/` che oggi dice il limite (cercala per «job object»).
Non toccare: il comportamento su Linux e macOS (`kill_process_group` di
rustix); `Cargo.lock` oltre a ciò che la dipendenza diretta cambia.
Dipende da: nessuno (D7 A, 2026-11-07).
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
Stato: [x] fatto · c3b6f304..44ecd93a · in main con la consegna 1 (#317,
c1ad9eaa), «build + test (windows-latest)» verde nella CI completa (corsa
42484380329); prima il codice Windows qui solo con clippy su `x86_64-pc-windows-msvc` in un crate
di prova): la CLI parte sospesa, entra nel job con
`KILL_ON_JOB_CLOSE`, poi riparte; il job si chiude dopo la raccolta, come
il gruppo su unix; un job che non si crea è `LaunchError::Io` e la CLI non
parte; `windows-sys` era già diretta in `fub-kernel`: la versione va alla
radice, le feature in ogni crate (guardia `check-cargo-versions`)

## T10 · I due punti sciolti da ritrovare

Perché: «una stringa inglese nel fake host» e «il conto dei diagrammi
Mermaid» sono nella lista dei punti sciolti, ma non li ho trovati (D10).
Ramo: piano/fub-pre-alpha.
Tocca: D10 è B (2026-11-07): ciò che si trova cercando, oppure solo il registro di
`DECISIONS.md`.
Non toccare: le baseline; `check-mermaid.mjs`, se non è il posto del
difetto.
Dipende da: nessuno (D10 B, 2026-11-07).
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
Stato: [x] fatto · ea3c4fa9..17a7a4fa · la stringa: in tutte le 183 scene in
italiano l'unico inglese dal finto è in `grid-result-error`; tradotti
quello e gli altri errori del finto rivolti alla shell, test
`host/fake-lingua.test.ts` (3 rossi prima, verdi dopo); le baseline
`grid-result-error-*` dal runner. I diagrammi: 43 contati e 43 resi, ma il
README (fuori dal controllo) dichiarava l'id `ENTRY` due volte e disegnava
un ingresso solo; corretto, e `check-mermaid.mjs` ora guarda anche il
README e trova un id con due etichette (44 blocchi)

## T11 · Il vassoio delle barre

Perché: è la scelta di D6 (C, 2026-11-07): di serie il vassoio chiaro sotto
tutte le barre, e in Impostazioni › Aspetto la riga «Le barre: chiare ·
marcate», per chi il vassoio chiaro lo vede poco.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/settings.rs` (una chiave nuova
`appearance.bars`, scelta `light` o `marked`, di serie `light`, ambito
macchina come la densità); il modulo che applica le altre scelte d'Aspetto
sulla radice (`apps/client/src/theme/theme.ts`, lo stesso di
`appearance.density`); la pelle di serie in `theme/scrittoio/skin/`;
`apps/client/src/panels/settings.ts` (la riga); `bench/fake-ipc.ts`;
`apps/client/src/i18n/catalog.ts`; i test di quei moduli.
Non toccare: `recipe.ts` (il valore di `--bar-tray` è di S2 T16 e segue la
tinta); la barra
a schede, che resta sul vassoio delle altre barre.
Dipende da: S2 T20 in `main`.
Cosa fare:
- Con `marked` il modulo mette `data-bars="marked"` sulla radice, e la
  pelle di serie rimette `--sheet-2` sotto tutte e tre le barre:
  `:root[data-bars="marked"] { --bar-tray: var(--sheet-2); }`, accanto alla
  regola del contrasto alto che fa già lo stesso. Con `light` l'attributo
  non c'è. Il sanitizer dei temi lo deve accettare (`npm run theme:verify`).
- La riga «Le barre» in Impostazioni › Aspetto, dopo «Densità», con le due
  scelte «Chiare» e «Marcate», la riga cambiata e «Azzera» come le altre
  scelte di macchina.
Dal prototipo: S294 (la riga, chiare), S295 (marcate, con «Azzera»), S296
(una nota con la barra di formato e le barre marcate). Il DOM della riga è
in `toppe/aspetto.html` (`aspetto-barre`, `aspetto-barre-marcate`), la
regola in `blocchi/02-ruoli.css`.
Casi limite: il contrasto alto (resta `--sheet-2` e il bordo pieno); un
tema `theme-2` senza `--bar-tray` (la pelle ripiega su `--sheet-2`); la
colonna sulla scrivania del disegno; cambiare scelta senza ricaricare.
Fatto quando: la scelta si salva nell'host e sopravvive al riavvio; le foto
del banco della barra di formato, del PDF e del disegno, nelle due luci,
mostrano le due varianti; `npm run bench:a11y` è verde.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:verify
Stato: [ ] da fare

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
Stato: [x] fatto · 2c9c9523 · in main con la consegna 1 (#317, c1ad9eaa),
verde anche su Windows e macOS (corsa 42484380329) · 8 test verdi su Linux (aprire e
chiudere, conflitto, file sparito, modifiche piccole; sola lettura coi motivi
dell'host: docx protetto e cartella xlsx); manca la sola lettura per
permesso del file: su Linux un file 0444 viene sovrascritto (rename in
`storage/rooted.rs`); l'utente ha scelto di rifiutare, lo fa PA T59, che
aggiunge il caso al corpus (integrato, b14b488c); Windows e macOS dalla CI
completa

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
Stato: [ ] rinviato (2026-11-09, l'utente: la prova con cinque persone per ora non si fa; alla release proveranno i primi utenti). Non blocca T22 né T24

## T18 · I documenti della pre-alpha

Perché: è il «Fatto quando» 8. Lo stato del progetto, una pagina «Prova la
pre-alpha», il README e il CHANGELOG dicono la pre-alpha com'è.
Ramo: piano/fub-pre-alpha.
Tocca: `docs/project/status.md`, `docs/getting-started/prova-la-pre-alpha.md`
(nuovo), `README.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/` (se D9 è A
o B), `docs/decisions/README.md` (l'indice, se un piano ha aggiunto ADR).
Non toccare: le ADR stesse; le pagine delle architetture (le aggiorna il
task che cambia il comportamento).
Dipende da: le Fasi A–C in `main` (D9 B, 2026-11-07: «Segnala un problema» lo fa PA T52).
Cosa fare:
- `status.md`: che cosa c'è nella pre-alpha, che cosa no (la tabella «Fuori
  scope» del piano, con i link alle issue), e i limiti noti (telefono di
  prova, il dmg di macOS non notarizzato, D20).
- `prova-la-pre-alpha.md`: scaricare (dalla pagina della release),
  installare sui tre sistemi (su Windows SmartScreen può avvisare nelle
  prime settimane anche con la firma; su macOS il primo avvio è bloccato,
  perché il dmg non è notarizzato, e la pagina dà i passi per «Apri
  comunque», D20), aprire un vault (consigliare una copia), che cosa
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
Stato: [x] fatto · d9de814f..156cb2aa · le sei cause corrette, 200 corse verdi
dopo per ognuna; commenti nelle issue, che si chiudono quando il codice è in
`main`; restano: la grana del timbro (4 ms) e altri test con un solo
`try_read` che cadono sotto carico, da due issue nuove (#318; la seconda è PA T60)

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
Stato: [~] integrato · 4bea6b45..eb3e85d5 · le cinque cause corrette:
#312 e proof.test (albero parziale nel confronto; e il correttore non
ricontrollava la prosa che il parser raggiunge dopo l'apertura, ora sì),
#286 (memo della pelle nel cancello, finestra della griglia, punte in sei
prove), #279 e #273 (la Live si fotografa a salvataggio finito e a formule
disegnate), #280 (orologio fisso nel banco del moto); 50 corse verdi;
restano: le baseline di live-07…11 dal runner con la consegna 3

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
Stato: [x] fatto · 6af52ae4 078148f1 831446ab · #287: il banco tiene un client X aperto (142/500 → 0/500 in prova); #293: la barra del formato non costruisce transazioni per i colori (keyToPaint p95 55–85 ms contro 124–176); #284 solo in parte (minimo a 60 s; serve una raccolta forzata da un gancio in fub-app, task a parte); #271 e #272 già risolti da #269; resta da aggiungere `-noreset` a Xvfb in `ci.yml`

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
Non toccare: la firma (la porta T50, D20) e il Flatpak (T51, D8 B):
qui si controlla solo che ci siano; gli altri workflow; `mobile.yml` (lo
tocca T31).
Dipende da: le Fasi A–C in `main`; T14, T18, T19–T21, T25, T31, T50 e T51
chiusi; il piano del telefono in `main` (D1 B).
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
- macOS: l'app costruita in CI si avvia (una prova di fumo: parte, la
  finestra c'è, si chiude). Il giro a mano lo fa T23 (D11 B).
- La corsa a secco: `gh workflow run release.yml` (`workflow_dispatch`, solo
  gli artefatti), e controlla che ci siano gli installer dei tre sistemi,
  quelli di Windows firmati e il dmg con la firma ad hoc (T50, D20), il
  `.flatpak` (T51) e l'APK.
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
(T14, T26–T30: 27) sugli installer veri, Linux qui, Windows dall'utente e
macOS da una persona con un Mac (D11 B); l'AI con MCP; l'APK sul telefono
vero dell'utente.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (Linux), l'utente (Windows, telefono) e la persona o
il Mac in affitto che trova l'utente (macOS).
Tocca: il resoconto in questa sezione; un'issue per ogni difetto trovato.
Non toccare: il vault vero dell'utente (`vault-tutti`): il giro usa una
copia temporanea.
Dipende da: T22 e T31; per macOS, la persona o il Mac trovati dall'utente
(D11 B).
Cosa fare:
- Linux: installa l'AppImage della corsa a secco (senza sudo), apri una
  copia del vault del banco, fai i 27 compiti a mano, e scrivi il
  risultato di ognuno. Poi installa il `.flatpak` (T51) con `flatpak
  install --user`, apri un vault fuori dalla sandbox e ripeti i compiti 1,
  6 e 21 (il primo avvio, una nota, una modifica fatta da un altro
  programma mentre Fub è aperto).
- macOS: la persona riceve la lista dei 27 compiti e il dmg, che non è
  notarizzato (D20); lo apre coi passi della pagina «Prova la pre-alpha»
  (Impostazioni di sistema › Privacy e sicurezza › «Apri comunque») e
  scrive se bastano, poi fa i compiti e risponde con una riga per
  compito.
- Windows: l'orchestratore manda all'utente la lista dei 27 compiti;
  l'utente li fa con l'MSI e risponde. In più: installa la corsa a secco,
  poi una seconda corsa costruita con `prealpha.2` (solo per la prova,
  senza tag), e guarda in «App installate» che ci sia una voce sola. Se
  sono due, vale il ripiego di T22. L'installer firmato (T50) mostra
  l'editore nella finestra di Windows; un eventuale avviso di SmartScreen
  si scrive nel resoconto, com'è.
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
Fatto quando: i 27 compiti sono verdi su Linux, su Windows e su macOS, il
Flatpak fa i suoi tre compiti, i tre giri MCP fanno ciò che dicono, il
telefono ha i cinque passi; o i difetti che
restano sono accettati dall'utente come noti.
Prova: il resoconto dei giri.
Stato: [ ] rinviato (2026-11-09, l'utente: il giro a mano sugli installer «lo faremo con calma quando avrò tempo»). Non blocca T22; T24 lo aspetta solo se l'utente lo chiede

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
Stato: [x] fatto · 76bbd836 · `check.sh --rapido` del coder verde tranne
craft_ranged (#310); la lista senza tag dà `latest: null`, i tag illeggibili
`failed: "version"`, le bozze si saltano; resta: la lista guarda le ultime 30

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
Dipende da: niente: il job si fa quando si vuole. T22 e T23 usano la sua foto, che si rifà quando il piano del telefono è in `main` (D1 B).
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
Stato: [x] fatto · f2fb4f79..092de966 · la pagina viaggia in `OpenOptions.page`
fino a `initialPage`, e `showPage` per la scheda già aperta; resta: i link a
percorso `[a](x.pdf#page=3)` non sono coperti, e una pagina chiesta mentre il
PDF della scheda attiva carica si perde

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
Dipende da: nessuno (D14 A, 2026-11-07).
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
Stato: [x] fatto · 407fd22f..42360fd8 · guardia `i18n/fubdraw.test.ts` e due
test Rust (descrittori, diagnostica di `fub-scene`); fuori dal «Tocca» i
due errori di `retitle` in `fub-format-svg/src/serialize.rs`, che arrivano
alla shell, e una riga di `fub-host/tests/draw_feature.rs`; il nome
tecnico resta in `scene-format.md` e in una nota dell'ADR 0203

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
Dipende da: nessuno; D15 è A (2026-11-07): il campo è `extends`, la
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
Stato: [x] fatto · bde0c064..1df5f926 · 9 test nuovi in `themes.rs`; mirror da
`UPDATE_MIRROR=1`; il finto espone `extendingTheme()` (non è fra i temi di
serie del finto, per non cambiare banco e pannelli); finché non c'è T35 un
fascio con `sheet: null` non si monta: il catalogo lo tiene fuori e lo dice
nella diagnosi, `apply()` ripiega sulla serie; senza `extends` un foglio
mancante resta l'errore `Io` di prima

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
Stato: [x] fatto · b8aac8dc..fb734855 · ADR 0240; il fascio porta
`inherited: { skin }` (lo riempie `theme.ts` per `extends: "fub.serie"`), e
un fascio con `extends` senza di esso è rifiutato; la pelle di serie
ereditata non ripassa dal sanificatore (è di serie); `replaceTheme`
inserisce davanti al primo canale dopo `pelle-tema`, così i frammenti
restano ultimi anche senza preferenze; via `INHERITED_SHEET_REASON` e il
filtro del catalogo; toccati anche `runtime.test.ts`, `generate.mjs` e
`permissions-and-security.md`, che descrivevano il rifiuto di prima

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
Stato: [x] fatto · 35183cb4..a0898d46 · la regola di una voce è
`fub_abi::rules::theme_font::theme_font_fault`, legata al TS dal mirror
delle regole (43 casi e 8 limiti); `fonts` solo con `theme-2`; `file`
relativo, `fonts/<nome>.woff2`; famiglia ASCII senza maiuscole, niente
parole chiave CSS; la stessa faccia due volte è rifiutata; il loader ripete
i controlli sul fascio; `ThemeManifest` non passa da WIT. Rischio: con
6 MiB di caratteri il canale porta circa 8 MB di base64, rifatti a ogni
cambio di tema o di luce

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
Dipende da: T34, T35; D16 A (2026-11-07). Mai nella stessa ondata di un task
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
Stato: [x] fatto · 164571d3..e6419d62 · la regola sta in
`fub_abi::rules::theme_icons`, legata al TS dal mirror delle regole, e
l'host applica anche `PATH_DATA`; il set lo monta `mountThemeBundle` nella
stessa transazione dei canali (rifiutato il fascio, resta il set di prima),
e la finestra documento lo rispecchia; `undrawnThemeIcons()` aspetta la
diagnosi di T36; i nomi ridisegnabili sono 440 su 512 (S2 T14 guardi il
margine); 10.000 icone cambiate si ridisegnano in un passaggio solo, in
18–35 ms headless sotto carico, non sotto i 16 ms del piano

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

## T42 · Tre temi d'esempio

Perché: la skin facile, passo 6, e la sua prova d'uscita (D17 C, D27 A).
Tre punti di partenza lontani fra loro: «Carta», un tema di circa 100 righe
sopra la serie con un'identità diversa e leggibile a lungo; «Officina»,
il più lontano dalla serie, la prova più dura dei cancelli; «Mare», di soli
colori. Tutti e tre si installano da cartella, passano i cancelli e si
guardano dappertutto.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/theme/examples/<id>/` (tre cartelle nuove, `carta`,
`officina` e `mare`: `manifest.json`, i fogli, `skin.css` per i primi due,
i caratteri e le icone), un test nuovo
`apps/client/src/theme/examples.test.ts`, le scene del banco dei tre temi
(`bench/scene.mjs`), il README del kit autore (i tre temi come punto di
partenza, al posto della copia intera di `sample/`), la pagina di
`docs/product/` che parla dell'aspetto.
Non toccare: la serie; il contratto; lo snapshot di T41.
Dipende da: T41; T54 (l'editor di testo vestito dalla pelle, D22 A); le
icone di «Carta» e «Officina» (D16 A) disegnate da un pianificatore e
approvate dall'utente prima del task: il simulatore mostra le icone di
serie, e un coder non le disegna.
Dal prototipo: i blocchi `blocchi/93-tema-carta.css`,
`93-tema-officina.css` e `93-tema-mare.css` del simulatore (il CSS dei tre
temi, già passato dal sanificatore stretto), e gli stati «vestito da …»:
«Carta» S282 e S283, «Mare» S284 e S285, «Officina» S297 e S298.
Cosa fare:
- «Carta» ha `extends: "fub.serie"`, il solo foglio del giorno
  (`lights: ["light"]`, col suo contrasto alto: di notte resta la serie),
  una pelle di circa 100
  righe che usa solo hook dello snapshot, il suo carattere con le grazie
  (T39) e una decina di icone a tratto sottile (T40). La pelle veste anche
  l'editor di testo, con gli hook che porta T54.
- «Officina» ha `extends`, i due fogli, una pelle con bordi spessi, angoli
  dritti ed etichette in monospazio, un carattere monospazio libero (OFL)
  per le etichette (T39) e una decina di icone quadrate (T40). Di serie è
  più contrastato della serie; il suo contrasto alto lo è ancora di più.
- «Mare» ha `extends`, i due fogli e nient'altro: un blu profondo e
  superfici grigio-azzurre, scelti a mano, come nel blocco del simulatore.
- Il test prova che:
  - tutti e tre passano `validateThemeBundle` nelle due luci e col
    contrasto alto;
  - le pelli di «Carta» e «Officina» usano solo hook di
    `frozen/theme-2.json`;
  - un componente che una pelle non nomina ha lo stile di serie.
- Le foto del banco, per ciascun tema: la scrivania, una nota, il foglio e
  le Impostazioni, nelle due luci, in contrasto alto, a 700 e al telefono
  (390). Le baseline vengono dal runner.
- Si installano da cartella nell'app vera (T36), a mano, e il resoconto lo
  dice.
Casi limite: il contrasto alto (le coppie di contrasto passano anche lì: lo
prova il test); un componente aggiunto dopo (lo prova il test); le
etichette in monospazio di «Officina» nelle schede strette (si tagliano con
«…» come quelle di serie, mai sopra il bordo).
Fatto quando: il test è verde; le scene del banco ci sono, con le baseline
dal runner; il resoconto dice dell'installazione a mano.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/theme/examples.test.ts
Stato: [ ] da fare

## T43 · «Nuovo» chiede il tipo

Perché: la richiesta del secondo giro vuole «un file nuovo, con la scelta
del tipo». Oggi il «+» dell'albero (`#new-note`, `index.html:227`) fa solo
una nota (`panels/explorer.ts:170`); un disegno si crea dal menu File, dal
contestuale di una cartella («Nuovo ▸», `explorer.ts:1337`) o del titolo
dell'albero (`explorer.ts:1385`); al telefono c'è «+ Disegno» accanto
(`shells/mobile/creation.ts`). Una lavagna, un documento e un foglio non
hanno una porta nella shell (verificato su `main` 638358da).
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/ui/commands.ts` (l'elenco dei tipi che si possono
creare), `apps/client/src/panels/explorer.ts` (il «+» apre il menu; «Nuovo ▸»
e il menu del titolo leggono lo stesso elenco), `apps/client/src/ui/app-menu.ts`
(il menu File), `apps/client/src/shells/mobile/creation.ts` (al telefono il
«+» apre lo stesso elenco, e «+ Disegno» non serve più), il catalogo
(`i18n/catalog.ts`, IT e EN), i loro test.
Non toccare: i comandi del kernel (li aggiunge T44); `ui/menu.ts` oltre a ciò
che il menu ha già (voci, suggerimenti, separatori).
Dipende da: S2 T8 e T14 in `main` (toccano `explorer.ts` e `ui/menu.ts`);
l'approvazione di S34. Le voci «Documento» e «Foglio» si vedono quando T44 è
in `main`: T43 può entrare prima e le mostra da sé appena il kernel dichiara
i comandi.
Dal prototipo: S34 (`file-nuovo-tipo`), la toppa `menu-nuovo` in
`toppe/file.html`.
Cosa fare:
- Un elenco solo dei tipi, in `ui/commands.ts`, nell'ordine di S34: Nota,
  Documento (.docx), Foglio (.xlsx), Disegno (.svg), Lavagna (.canvas), poi
  un separatore, «Nota da un modello…» e Cartella.
- Ogni voce c'è soltanto se si può fare, come `canCreateDrawing`: la nota e
  la cartella sempre; le altre se il kernel dichiara `document.create`,
  `sheet.create`, `drawing.create` e `canvas.create`; «da un modello» se c'è
  la vista dei modelli (`templates`). Si rilegge a ogni apertura e a ogni
  `on("commands")`.
- Il «+» dell'albero apre il menu sotto di sé. Ctrl+N (`shell.note.new`)
  resta una nota diretta, senza menu, e la voce Nota mostra la scorciatoia.
- «Nuovo ▸» della cartella, il menu del titolo e il menu File usano lo
  stesso elenco, con la cartella dove nasce il file.
- Il menu si apre e si chiude con la tastiera come gli altri menu (frecce,
  Invio, Esc che torna al «+»).
Casi limite: nessun componente acceso oltre alle note (il menu ha Nota,
Cartella e «da un modello» se c'è); uno spazio attivo (il file nasce lì,
come oggi la nota); un comando che sparisce a menu aperto (la voce resta
fino alla chiusura e il comando dice il suo errore).
Fatto quando: S34 si riproduce nel banco (la foto della scena nuova
coincide con la toppa, a parte il testo delle voci che mancano); i test
dicono quali voci si vedono con quali comandi.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/ui/commands.test.ts src/panels/explorer.test.ts
Stato: [ ] da fare

## T44 · Un documento e un foglio vuoti

Perché: T43 offre «Documento» e «Foglio», ma il kernel non sa crearli. Un
`.docx` nuovo in realtà nasce già: scrivere la proiezione di un documento
che non c'è parte da `fub_format_rich::blank` (`fub-host/src/session.rs:3657`,
`rich.rs:135`). Un `.xlsx` nuovo no: `write_workbook_in` risponde
`workbook::missing` quando il file non c'è (`session.rs:3696`). Nessun
comando `*.create` esiste per i due formati (verificato su `main` 638358da).
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-host/src/rich.rs` e `crates/fub-host/src/workbook.rs`
(o il modulo che il coder trova padrone del formato), la registrazione dei
comandi in `fub-host` (accanto a `folder.create`, `session.rs:92`), il
catalogo dei comandi (IT e EN), i test d'integrazione di `fub-host`.
Non toccare: `fub-features` (i due formati stanno in `fub-host`, e
`fub-features` ha per loro solo le righe della mappa, `Cargo.toml:118`);
la shell (T43).
Dipende da: nessuno.
Dal prototipo: S34 (le due voci).
Cosa fare:
- `document.create` dietro la feature `rich` di `fub-host`: argomenti
  `folder` e `name` come `canvas.create`; scrive `blank(Codec::Docx)` col
  nome libero più vicino («Documento senza titolo.docx», poi « 2», « 3»…),
  e apre il file.
- `sheet.create` dietro la feature `xlsx`: i byte di una cartella vuota con
  un foglio («Foglio1»), scritti da GridCraft (`save_bytes_as` in
  `vendor/gridcraft/crates/engine/src/io.rs:236`, sopra `Workbook::new()`)
  attraverso il padrone che oggi innesta il giornale. Niente codice nuovo
  nel `vendor/`.
- Tutti e due passano dal `Guard` e dalla scrittura atomica come gli altri
  comandi che creano file, e hanno una prova a secco (`InvokeMode::DryRun`)
  che dice il nome senza scrivere.
Casi limite: la feature spenta (il comando non è dichiarato: lo prova
`--no-default-features`); un nome già preso; una cartella in sola lettura
(l'errore tipato, non una stringa); il file aperto subito dopo dal suo
editor, letto dal motore senza avvisi.
Fatto quando: i due comandi creano file che i loro editor aprono e salvano
(un test scrive, rilegge con il codec e salva una modifica); spenta la
feature il comando non c'è.
Prova: scripts/check.sh --rapido; cargo test -p fub-host --test rich_documents; cargo test -p fub-host --no-default-features --lib
Stato: [x] fatto · 12a8dedd..a3d55da9 · i due comandi sono provider dei
bundle `fub.rich` e `fub.xlsx` (come `canvas.create`): stesso `Guard`,
scrittura solo se il nome è libero, cestino, `Navigate`, e spariscono col
bundle spento; nomi da `free_name` nella lingua di chi crea («Documento
senza titolo», poi « 1», « 2»; il foglio «Foglio1» o «Sheet1»);
`fub_format_xlsx::blank` sopra `Workbook::new()`; una cartella in sola
lettura arriva come `Io` tipizzato (da T59 solo il file in sola lettura è
`PermissionDenied`); pagina nuova `docs/product/new-documents.md`.
Trovato: `cargo test -p fub-host --no-default-features --lib` non compila
nemmeno alla base (errori in `legacy_tests/` e `fub-features`)

## T45 · Cinquemila file: la misura

Perché: la richiesta vuole «un vault da 5.000 file». L'albero non è
virtualizzato (`panels/explorer-motion.ts:8`: «L'albero non è
virtualizzato: basta FLIP»), e nessun banco ha un vault grande: `large.mjs`
misura un disegno grande, non un albero. S253 mostra le cartelle chiuse che
contano i file; prima di cambiare l'albero si misura.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/vault-fixture.ts` (nuovo: un vault finto di 5.000
file in cinque cartelle, una da 1.500 note), `apps/client/bench/fake-ipc.ts`
(`?vault=5000`, come `?large=N`), `apps/client/bench/tree.mjs` (nuovo),
`package.json` (`bench:tree`), un test d'integrazione di `fub-host` che
monta un vault temporaneo di 5.000 file e misura il montaggio e l'elenco
dell'albero.
Non toccare: `panels/explorer.ts` (questo task misura, non cambia);
il vault vero dell'utente.
Dipende da: S2 in `main` (l'albero col cassetto); vicino a T16.
Dal prototipo: S253 (`dati-cinquemila`).
Cosa fare:
- Il banco apre il vault da 5.000 file nell'app vera e misura: il primo
  disegno dell'albero dopo l'arrivo dell'elenco; l'apertura della cartella
  da 1.500 note (il fotogramma più lungo); lo scorrimento fino in fondo
  (i fotogrammi oltre 50 ms); la ricerca rapida di un nome.
- Le soglie, al livello Standard e con la CPU quattro volte più lenta:
  primo disegno entro 300 ms; nessun fotogramma oltre 100 ms aprendo la
  cartella; nessuno oltre 50 ms scorrendo.
- Il test di `fub-host` misura il montaggio e l'elenco su disco vero (una
  cartella temporanea), e stampa i tempi; fallisce solo oltre il doppio
  delle soglie, per non diventare instabile.
- Una soglia superata apre una issue con i numeri e le foto, e la
  virtualizzazione dell'albero diventa un piano a parte: non entra qui.
Casi limite: la CPU lenta (i numeri si scrivono tutti e due); nomi lunghi
(S252); cartelle annidate a dieci livelli.
Fatto quando: `npm run bench:tree` stampa le misure con le soglie; il test
di `fub-host` passa; il resoconto dice i numeri e, se serve, il numero
della issue.
Prova: scripts/check.sh --rapido; cd apps/client && npm run bench:tree
Stato: [ ] da fare

## T46 · Le parole della scheda di un componente installato

Perché: la scheda di un componente in «Installati su questa macchina»
(`panels/settings.ts`, `renderInstalledComponent`) dice «Abilitato»,
«Disabilita il componente prima di rimuoverlo.» e «Rimuovi». Il lessico di
K2 (`i18n/lexicon.ts`) dice che le parole dei componenti sono «Accendi»,
«Spegni» e «Togli», dappertutto, e la pagina Componenti dice già «Spegni».
La guardia del lessico (`ui/menu-budget.test.ts`) guarda solo le voci dei
menu, quindi non se ne accorge (D18, «Differenze fra piani e codice» 46).
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/i18n/catalog.ts` (i testi di
`settings.components.enabled*`, `settings.components.consent.hint` e
`settings.components.remove*`, in italiano e in inglese),
`apps/client/src/panels/settings.components.test.ts`,
`apps/client/src/i18n/lexicon-settings.test.ts` (nuovo).
Non toccare: le chiavi del catalogo e gli id degli elementi (cambiano i
testi, non le chiavi); `panels/components-page.ts`; la logica della scheda
(«Togli» resta spento finché il componente è acceso).
Dipende da: K2 in `main` (#290, che porta il lessico); D18 è A (2026-11-07).
Dal prototipo: S204–S207 (`comp-*`, `toppe/componenti.html`): le toppe
hanno già le parole nuove, rifatte il 2026-11-07 con D18 A. S208 è dopo la
pre-alpha.
Cosa fare:
- I testi italiani diventano: «Abilitato» → «Acceso»; «Scelta
  di abilitazione non cambiata: {reason}» → «Componente non acceso né
  spento: {reason}»; «Rimuovi» → «Togli»; «Rimuove l'installazione ma
  conserva i suoi dati nel vault.» → «Toglie l'installazione; i suoi dati
  restano nel vault.»; «Disabilita il componente prima di rimuoverlo.» →
  «Spegni il componente prima di toglierlo.»; «Rimuovi componente» →
  «Togli il componente»; «Rimuovere «{name}»? I dati che il componente ha
  salvato nei vault verranno conservati.» → «Togliere «{name}»? I dati che
  il componente ha salvato nei vault restano.»; «Componente non rimosso:
  {reason}» → «Componente non tolto: {reason}»; «È distinto
  dall'abilitazione: …» → «È distinto da acceso e spento: …». In inglese:
  «Enabled» → «On»; «Turn the component off before removing it.»; «This is
  separate from turning it on or off: …»; «Remove» resta.
- `lexicon-settings.test.ts` passa ogni testo italiano
  `settings.components.*` per le varianti vietate del lessico (`FORBIDDEN`),
  come `menu-budget.test.ts` fa con le voci dei menu.
Casi limite: la descrizione accessibile del bottone spento
(`aria-describedby`) dice la frase nuova; l'avviso di errore di un
interruttore che non cambia.
Fatto quando: la scheda dice le parole del lessico; il test nuovo fallisce
se una variante vietata torna in un testo `settings.components.*`.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/i18n src/panels/settings.components.test.ts
Stato: [x] fatto (2026-11-09) · in più: `settings.components.install.hint` («non lo accende») e l'inglese di `enabled_failed`; la guardia confronta senza maiuscole e fissa le frasi intere della scheda («Rimuovi» non è in `FORBIDDEN`); resta il motivo inglese/italiano che arriva dall'host (`fub-wasm-host/src/managed.rs`, «disabilitare il componente prima di rimuoverlo») dentro «Componente non tolto: {reason}»

## T47 · I 44 px del tocco sul telefono, senza deformare

Perché: `shells/mobile/mobile.css` dà `min-width` e `min-height` di 44 px a
`button`, `[role="button"]`, `input[type="checkbox"]` e
`input[type="radio"]`, con `:root[data-client-shell="mobile"]` davanti, che
pesa più di `input[role="switch"]` in `skin/controls.css`. Sul telefono
ogni interruttore diventa un cerchio di 44 px col pomello in mezzo, e
sembra un bottone di scelta. Lo stesso minimo prende il posto di
`min-width: auto` dei bottoni: le schede delle impostazioni si stringono
fino a 44 px e diventano «Co…», «C…», «S…», invece di scorrere come vuole
`skin/settings.css` sotto i 760 px. È in `origin/main` (638358da) e nelle
catture vere («Differenze fra piani e codice» 47). Con l'APK di prova le
persone lo vedrebbero in ogni pagina di impostazioni. Il controllo di tutte
le viste ha trovato altri due difetti della stessa regola (Differenze 48):
in un elenco dichiarato (il cestino, le versioni) le righe diventano alte
quanto il bottone di 44 px e fra un «Ripristina» e l'altro resta 1 px, così
tre bottoni pieni sembrano uno solo e l'anello del fuoco cade sul vicino; e
il tondo della modalità, che galleggia sulla carta bianca del documento, al
buio ha l'anello verde chiaro fuori, sul bianco, a 2,2:1.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/shells/mobile/mobile.css`,
`apps/client/bench/scene.mjs` (una scena nuova, `mobile-settings`, e i
controlli nuovi di `mobile-trash` e `mobile-document`, se ci sono; se no due
scene nuove con questi nomi).
Non toccare: `theme/scrittoio/skin/controls.css` (l'interruttore del
computer resta com'è); `shells/scrittoio/mobile/mobile.css`; il minimo di
44 px degli altri bottoni, che resta.
Dipende da: nessuno.
Dal prototipo: il blocco `92-prealpha-telefono.css` (`<style
data-destinazione="shells/mobile/mobile.css">` in testa al simulatore); al
telefono S185 (`g2-comp-spegni`), S183 (`componenti`), S206 e S207
(`comp-rotto-*`), S233 (`impostazioni`); le righe dell'elenco in S26
(`g2-cestino`) e S28 (`g2-ispettore-3`) al telefono; il tondo della
modalità in S83 (`documento`) al telefono, al buio, col fuoco (il bottone
«Fuoco» del simulatore).
Cosa fare:
- Nella regola dei 44 px, `input[type="checkbox"]` diventa
  `input[type="checkbox"]:not([role="switch"])`. Le due righe `min-width` e
  `min-height` del blocco non si copiano: servono solo al simulatore, che
  ha la regola di oggi (il blocco lo dice in testa).
- L'interruttore prende il tocco di 44 px senza cambiare aspetto: si
  copiano `position: relative` e il suo `::after` trasparente con
  `inset: -13px -6px`, come nel blocco.
- `.settings-tab` sul telefono prende `flex: none`, come nel blocco: la
  riga delle schede scorre di lato, coi nomi interi.
- Fra due righe di un elenco dichiarato (`.ui-list > .ui-stack[data-dir="row"]
  + .ui-stack[data-dir="row"]`) 8 px (`--space-4`), come nel blocco. È il solo
  posto dove la regola dei 44 px fa toccare due bottoni pieni: le righe dei
  menu e degli alberi hanno già il loro passo.
- Il tondo della modalità (`.pane > .pane-mode-current`, nelle due media
  query dove galleggia) col fuoco ha l'anello dentro:
  `outline-offset: calc(-1 * var(--focus-ring-width) - var(--space-2))`,
  come nel blocco. Dentro il tondo l'anello sta su `--bg-elev`, in tutte e
  due le luci.
- La scena `mobile-settings` apre le impostazioni sul telefono, scheda
  «Componenti». Nel suo `prepare` aspetta che ogni interruttore visibile
  misuri 32 × 18; che `document.elementFromPoint` 10 px sopra e sotto il
  suo centro, e 5 px a sinistra, renda l'interruttore stesso; che nessuna
  `.settings-tab` abbia `scrollWidth` maggiore di `clientWidth`. Se una di
  queste cade, la scena non si prepara e `bench:verify` fallisce.
- `mobile-trash` (il cestino con tre file, al telefono) aspetta che fra due
  bottoni «Ripristina» vicini ci siano almeno 8 px; `mobile-document` (un
  documento di videoscrittura al telefono, al buio) dà il fuoco della
  tastiera al tondo e aspetta che il contorno stia dentro il suo rettangolo
  (`outline-offset` negativo, più largo della linea).
Casi limite: in colori forzati l'interruttore torna nativo, 16 × 16
(`controls.css`, «Garanzie»): con la regola nuova non diventa un quadrato
di 44 px. Il `::after` trasparente non è un secondo pomello, e la regola
«Un pomello solo» di `controls.css` resta per il computer. La scheda scelta
deve vedersi quando le impostazioni si aprono su «Informazioni»: se resta
fuori dalla riga, si porta in vista con `scrollIntoView({ inline: "nearest"
})`. Il telefono sdraiato (`mobile-landscape`).
Fatto quando: sul telefono l'interruttore è il binario della pelle con un
tocco di 44 px, le schede delle impostazioni scorrono intere, i bottoni di
un elenco non si toccano e il tondo della modalità ha l'anello dentro; le
scene lo controllano; le baseline nuove vengono dal runner.
Prova: scripts/check.sh --rapido; cd apps/client && npm run bench:verify && npm run bench:a11y
Stato: [x] fatto · dc573a6e..d75d5b95, 448e871a, f0da5712 · in main con
#319, con le baseline del runner; le baseline mostravano la maniglia del
cassetto a 44 px (le esclusioni `:not(.classe)` pesavano), corretta con
`:not(:where(…))` e un controllo nella scena `mobile-sheet` · il tondo galleggiante non c'è ancora (viene da
S2 T3): la regola dell'anello dentro è scritta e non agisce, da riguardare
con S2 T3; il cestino del banco prende tre file con `?cestino=3`; allargato
dall'orchestratore al pallino dello stato (`button.pane-standing-chip`,
21 × 24 come sul computer, tocco 44 × 37 per non rubare quello della
modalità accanto). Gonfiati senza vedersi, lasciati a PA T55: la pillola H1
nel margine della nota, ‹ › della barra PDF, le icone 16 × 16 del disegno

## T48 · Il verde di serie

Perché: D25. L'utente vuole Fub verde di serie: la tinta di serie passa
dalla matita blu (265) allo smeraldo (160), il verde del logo. In Fub una
sola tinta fa tutto, quindi cambia l'aspetto di ogni schermata. Con
l'accento verde il «salvato» (155) diventerebbe lo stesso colore: serve la
regola dei 30° fra i colori di stato e l'accento.
Ramo: piano/fub-pre-alpha.
Tocca:
- `apps/client/src/theme/scrittoio/recipe.ts`: `DEFAULT_ACCENT_HUE` = 160;
  `STATUS_HUE_GAP` = 30 e `statusHue()` nuovi; i quattro colori di stato
  passano da `statusHue`; il campione `smeraldo` (160) primo in
  `ACCENT_SWATCHES`, la `matita-blu` resta;
- `apps/client/src/shells/scrittoio/preferences/accent-control.ts` (il nome
  del campione) e `apps/client/src/i18n/catalog.ts`
  (`prefs.accent.smeraldo`: «Smeraldo», «Emerald»);
- i quattro fogli `theme/scrittoio/sheet-*.css`, rigenerati con `npm run
  theme:generate`, mai a mano;
- `crates/fub-host/src/settings.rs`: il valore di serie di
  `APPEARANCE_ACCENT` (oggi `265.0`);
- `apps/client/bench/fake-ipc.ts`: il valore e il valore di serie di
  `appearance.accent`;
- `apps/client/public/avvio/avvio.css`: i colori dell'avvio, nelle due luci
  e nel contrasto alto;
- un test nuovo `apps/client/src/avvio/colori.test.ts`;
- i test che nominano 265 o la matita blu come serie
  (`theme/recipe.test.ts`, `theme/preferences.test.ts`,
  `shells/scrittoio/preferences/preferences.test.ts`,
  `theme/contrast-fixture.ts`);
- la pagina di `docs/` che descrive la ricetta (oggi
  `docs/architecture/frontend-and-ipc.md`, cercala per «accento»).
Non toccare: le tinte degli altri campioni; i neutri della ricetta, che
seguono già la tinta da soli, e con loro il vassoio delle barre di S2 T16
(`--bar-tray`, dalla tinta della carta: `#f8faf8` e `#18211c` col verde);
`docs/decisions/0208-*.md`, che si cita e non si riscrive; il logo e i
suoi colori (`logoColors`, T49).
Dipende da: niente (il logo definitivo conferma 160, D25). Mai nella
stessa ondata di un task che rifà baseline del banco.
Dal prototipo: tutto il simulatore è verde. Le catture vengono dai client
con la ricetta nuova; il diff da copiare è in
`script/finto/verde.patch` (il client delle catture) e
`script/finto/verde-avvio.patch` (il client dell'avvio), nelle parti di
`recipe.ts`, `accent-control.ts`, `catalog.ts`, `fake-ipc.ts` e
`avvio.css`. I fogli si rigenerano, non si copiano. Le parti del logo
negli stessi diff sono di T49 e qui non si copiano: in `recipe.ts`
`LOGO_ROLES`, `logoColors`, `holdLightness`, la riga `...logoColors` in
fondo a `palette` e `logo-` in `OPTIONAL_ROLES`; le righe `--logo-*` dei
fogli; il marchio in `index.html` e in `settings.ts`;
`public/avvio/luce.js`, `src/avvio/consegna.ts` e il disegno nelle pagine
dell'avvio.
Cosa fare:
- La ricetta come nel diff: `statusHue(hue, accent)` sposta una tinta di
  stato a `accent ± 30` quando le sta più vicino di 30°, dal lato dove
  stava; altrimenti la lascia. Con 160 il «salvato» va a 130; con la
  matita blu l'informazione va da 240 a 235; il pericolo (27) e
  l'avvertenza (70) non cambiano.
- `npm run theme:generate && npm run theme:verify`: i fogli tornano uguali
  byte per byte alla seconda generazione.
- Il valore di serie nell'host e nel finto. Il test di
  `crates/fub-host/src/legacy_tests/switches.rs` lega già il valore
  dell'host a `DEFAULT_ACCENT_HUE`: deve passare senza toccarlo.
- `avvio.css` prende i colori dei fogli nuovi (sfondo, testo, tenue,
  accento, inchiostro, bordo, guasto e i veli), come nel diff.
- `colori.test.ts` lega l'avvio alla ricetta: per la tinta di serie, nelle
  due luci e nel contrasto alto, ogni colore di `avvio.css` è uguale al
  ruolo della ricetta da cui viene. Oggi nessun test lo fa, e un cambio
  della ricetta lascerebbe l'avvio blu.
- I mirror, se un valore di serie delle impostazioni entra in un mirror:
  `UPDATE_MIRROR=1` col comando scritto in testa al file generato.
Casi limite: chi ha già salvato una tinta resta con la sua (si cambia solo
il valore di serie, non la preferenza scritta); una tinta libera vicina al
rosso (27) o all'ambra (70): la regola sposta il segno, e il test lo prova;
`accentPalette` rende `{}` per la tinta di serie (nessun foglio di
preferenze in più); il contrasto alto; l'informazione sotto la matita blu.
Fatto quando: la serie è verde nelle due luci e nel contrasto alto; il
«salvato» si distingue dall'accento (`recipe.test.ts` prova la distanza
per ogni campione e per dieci tinte libere); `colori.test.ts` è verde; le
baseline nuove vengono dal runner.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:generate && npm run theme:verify && npx vitest run src/theme src/avvio; cargo test -p fub-host
Stato: [~] integrato · 6dc284af..b0d938cf (cherry-pick fino a b0d938cf) ·
smeraldo 160 di serie, `statusHue` coi 30°, l'avvio legato alla ricetta da
`colori.test.ts`; in più i ripieghi `--paper-*` di `structure.css` e il
fondo nativo delle finestre (`fub-app/src/avvio.rs`), legati dai loro test;
chi aveva salvato 265 lo ritrova · mancano tutte le baseline, dal runner con
la consegna 3

## T49 · Il logo

Perché: D26. Marcuzzo prende il posto dell'icona dell'app (un quadrato viola
con una «F» bianca, `crates/fub-app/icons`) e della «f» corsiva sul colore
dell'accento dentro la finestra. Il gufo ha colori fissi; la cartella e i
fogli seguono la tinta, il tema e il contrasto, e restano staccati dal
fondo.
Ramo: piano/fub-pre-alpha.
Tocca:
- `apps/client/src/theme/scrittoio/recipe.ts`: `LOGO_ROLES`,
  `logoColors()`, `holdLightness()` (la luminosità che `hold` cerca già,
  resa da sola), la riga `...logoColors(light, level, hue, [bg, raise])` in
  fondo a `palette`, `logo-` in `OPTIONAL_ROLES`; i quattro fogli
  `theme/scrittoio/sheet-*.css`, rigenerati;
- `apps/client/src/theme/theme.ts` e `theme/scrittoio/series.ts`: un campo
  facoltativo nuovo di `ThemeSeries` (per esempio
  `completeSheet(sheet, light, contrast)`) che dà i colori del logo a un
  tema installato che non li dichiara, prima di `mountThemeBundle`;
- `apps/client/theme/author/contract.json`: i cinque gettoni, facoltativi;
- `theme/scrittoio/skin/frame.css` e `skin/settings.css`: il marchio
  trasparente, le misure, i colori delle parti, i colori forzati;
- `apps/client/index.html` (il marchio della barra), `panels/settings.ts`
  (le Informazioni);
- l'avvio: `public/avvio/avvio.css`, le tre pagine (`index.html`,
  `document.html`, `mobile.html`), `public/avvio/luce.js` e
  `src/avvio/consegna.ts` (cinque chiavi nuove della memoria dei colori),
  `src/avvio/colori.test.ts` (di T48);
- una cartella nuova `assets/logo/`: gli originali, le quattro forme,
  `LEGGIMI.md` e la licenza di D28;
- `crates/fub-app/icons/` (tutte le misure, `icon.icns`, `icon.ico`,
  `source.png`) e le icone Android nate da `cargo tauri icon`;
- `THIRD_PARTY_NOTICES.md` se la licenza lo chiede; la pagina di `docs/`
  sull'aspetto (cercala per «accento»): la ricetta e i gettoni del logo.
Non toccare: gli hook `brand-mark` e `brand-glyph`, che restano (il glifo
diventa l'SVG, quindi T49 può venire dopo T41); i colori del gufo, che sono
gli attributi `fill` del disegno; le soglie del contrasto; le tinte dei
campioni.
Dipende da: T48 (la ricetta verde e `colori.test.ts`); D28 chiusa: l'utente
conferma la licenza e dice quale modello ha usato in ArtCraft per il
ritocco, e l'orchestratore legge le condizioni di quel modello e scrive in
`DECISIONS.md` che permettono l'uso in un progetto pubblico.
Dal prototipo: tutto. Le forme in `logo/`, da copiare e non da ridisegnare;
il diff del client delle catture in `script/finto/verde.patch` (le parti
del logo di `recipe.ts` e dei fogli, il marchio in `index.html`, le
Informazioni in `settings.ts`) e in `verde-avvio.patch` (le pagine
dell'avvio, `luce.js`, `consegna.ts`); i blocchi `92-prealpha-logo.css` (la
barra a 24 px, le Informazioni a 48, i colori forzati) e
`92-prealpha-logo-avvio.css` (l'avvio a 56, coi colori di riserva); per i
temi `93-tema-*-logo.css`, fatti da `script/logo-temi.mjs`; i valori
attesi in `logo/misure.json`; la pagina «Il logo» dell'artifact.
Cosa fare:
- La ricetta come nel diff, poi `npm run theme:generate && npm run
  theme:verify`. Con 160 i colori sono quelli di D26.
- Il marchio: `marcuzzo-24.svg` in linea dentro `.brand-mark`, con
  `class="brand-logo marcuzzo"`, `aria-hidden="true"` e
  `focusable="false"` (il nome resta quello del bottone), a 24 px, col
  bottone trasparente. Le Informazioni: `marcuzzo.svg` a 48 px accanto
  alla versione, costruito come nel diff (`DOMParser` e `importNode`, mai
  `innerHTML`).
- L'avvio: `marcuzzo.svg` a 56 px al posto della tessera con la «f». I
  colori della cartella vengono dalla memoria dell'avvio (`consegna.ts`
  scrive i gettoni `--logo-*`, `luce.js` li rimette prima dei fogli) e, la
  prima volta, da `avvio.css`, che ha quelli di serie per le due luci e il
  contrasto alto. `colori.test.ts` li lega alla ricetta come gli altri.
- Le forme portano i `fill` di Smeraldo come ripiego; la pelle colora le
  cinque parti della cartella con `var(--logo-…)`, il gufo resta coi suoi
  `fill`.
- Un tema senza `--logo-cartella`: la serie aggiunge una regola `:root` con
  `logoColors(luce, contrasto, tinta di --accent, [--bg, --bg-elev],
  min(1, croma di --accent / 0,08))`, coi gettoni letti dalle regole del
  foglio per quella luce e quel contrasto. Un tema che lo dichiara si tiene
  i suoi.
- I colori forzati come nel blocco: `forced-color-adjust: none`, la sagoma
  `CanvasText`, il gufo `GrayText`, facce, occhi e fogli `Canvas`.
- Le icone: un PNG 1024 × 1024 da `originali/marcuzzo-smeraldo.svg`, fondo
  trasparente, poi `cargo tauri icon`; le misure 16, 24 e 32 si rifanno da
  `marcuzzo-16.svg` (16) e `marcuzzo-24.svg` (24 e 32) rese a quella
  misura, non ridotte dalla grande. Android: il davanti è Marcuzzo dentro la
  zona sicura (66 su 108 dp), il dietro un colore pieno (`#e7efe9`), il
  livello monocromo `marcuzzo-simbolico.svg`; la stessa forma è l'icona
  simbolica di Linux dove il pacchetto la installa.
Casi limite: una tinta libera qualsiasi (`recipe.test.ts` prova la soglia
per gli otto campioni e dieci tinte libere, due luci, due contrasti, sui
due fondi); un tema che dichiara solo una parte dei gettoni (quelli che
mancano cadono nel ripiego della pelle); un accento quasi grigio (la croma
scala, la cartella diventa grigia e non verde); l'avvio senza memoria e con
la memoria di un altro tema; il contrasto alto e i colori forzati; l'icona
su una barra delle applicazioni scura.
Fatto quando: le icone dell'app, il marchio, le Informazioni e l'avvio
mostrano Marcuzzo; la cartella segue la tinta, il tema e il contrasto e
regge la soglia (`recipe.test.ts`, un test della serie per un tema senza
gettoni del logo); `colori.test.ts` copre i colori del logo dell'avvio; la
licenza è scritta in `assets/logo/`; le foto del banco (barra,
Informazioni, avvio) hanno le baseline nuove dal runner.
Prova: scripts/check.sh --rapido; cd apps/client && npm run theme:generate && npm run theme:verify && npx vitest run src/theme src/avvio src/panels; npm run bench:verify
- La licenza (D28, chiusa il 2026-11-09): `assets/logo/LICENZA.md` dice
  «tutti i diritti riservati» per i file del logo e per le icone che ne
  nascono, con la catena (Google Flow, Recraft via API a pagamento, ritocchi
  in ArtCraft); `TRADEMARKS.md` alla radice dice che il nome «Fub» e
  Marcuzzo sono segni dell'autore, che un fork deve toglierli e cambiare
  nome, e che il codice resta `MIT OR Apache-2.0`; il `README.md` e
  `THIRD_PARTY_NOTICES.md` lo nominano in una riga; `cargo deny` e lo SBOM
  non cambiano (il logo non è una dipendenza).
Stato: [x] fatto (2026-11-09, sul ramo del piano; le baseline delle scene col marchio vengono dal runner con la consegna 4) · differenze: i colori forzati in `structure.css` (la pelle vieta `forced-color-adjust`); pezzi nuovi dell'anatomia `logo` e `about-version`; anche `mobile.html`; una copia di `marcuzzo.svg` in `ui/marcuzzo.ts` con un test di guardia; `icon.png` a 512 come `cargo tauri icon` (il vecchio `icon.icns` era un PNG); le icone Android non arrivano ancora in `gen/android` (`install-mobile.sh`), la simbolica di Linux aspetta T51

## T50 · La firma degli installer

Perché: D20. Senza firma Windows mostra «Windows ha protetto il PC». Chi
prova la pre-alpha deve poterla installare su Windows senza quell'avviso.
macOS per ora resta senza Developer ID e senza notarizzazione (l'utente,
2026-11-07: «Quello di Apple per ora ce ne freghiamo assolutamente»): il
dmg ha solo la firma «ad hoc», e la pagina «Prova la pre-alpha» dice come
aprirlo.
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (tocca la CI); l'utente fa la domanda a SignPath
Foundation e mette i segreti.
Tocca: `.github/workflows/release.yml` (la firma di Windows),
`crates/fub-app/tauri.conf.json` (`bundle.windows`: il comando di firma o
i suoi parametri; `bundle.macOS.signingIdentity: "-"`, la firma ad hoc),
`.github/scripts/check-release-gate.mjs` se un job cambia nome,
`docs/development/versioning-and-releases.md`.
Non toccare: i workflow dei PR (i segreti non devono mai arrivare a un PR,
nemmeno da un fork); `ci.yml`.
Dipende da: la domanda a SignPath Foundation (o un certificato OV, se Fub
non è ammesso) e i segreti messi dall'utente nel repository (D20). Prima
di PA T22.
Cosa fare:
- Windows, se SignPath ammette Fub: la CI manda gli artefatti senza firma a
  SignPath con la sua azione GitHub, e riprende l'exe, l'MSI e il setup
  firmati (la configurazione di SignPath firma anche l'exe dentro l'MSI e
  dentro il setup). L'editore mostrato è «SignPath Foundation».
- Windows, se SignPath non ammette Fub: un certificato OV. La chiave oggi
  sta per regola in un modulo hardware, quindi si firma dalla CI col
  servizio cloud dell'autorità, chiamato da `bundle.windows.signCommand`.
- macOS: la firma ad hoc (`signingIdentity: "-"`), senza account e senza
  segreti; niente notarizzazione. Si verifica prima nella documentazione
  di Tauri che sia ancora la strada per i Mac con Apple Silicon.
- Un passo di controllo dopo la firma: `signtool verify /pa` su exe, MSI e
  setup; su macOS `codesign --verify --deep --strict` (la firma ad hoc è
  valida) e la prova di fumo di T22. Se uno fallisce, il rilascio si
  ferma.
- La pagina dei rilasci dice come si rinnova la firma di Windows, chi la
  tiene e che cosa fare se scade, e che il dmg non è notarizzato (D20).
Casi limite: un segreto che manca (il job fallisce con un messaggio chiaro,
non esce un installer di Windows senza firma per sbaglio; una corsa a
secco senza segreti lo dice e non pubblica); il server del timestamp giù
(si riprova); SmartScreen che avvisa nelle prime settimane anche con la
firma (la pagina «Prova la pre-alpha» lo dice); un certificato scaduto;
`spctl` che rifiuta il dmg (è atteso: non è notarizzato, e non è un
errore del rilascio).
Fatto quando: la corsa a secco di T22 produce gli installer di Windows
firmati e il dmg con la firma ad hoc, e i controlli dopo la firma passano.
Prova: la corsa a secco (`gh workflow run release.yml`), coi log dei
controlli.
Stato: [ ] rinviato alla release (2026-11-09, l'utente: niente spese per la firma di Windows ora; si decide al momento della release). D20 sospesa: gli installer escono senza firma, e T22 non aspetta T50

## T51 · Flatpak

Perché: D8 B. Con Flatpak tutti hanno lo stesso WebKitGTK, quello del
runtime GNOME: ciò che si prova è ciò che vede chi prova, su ogni
distribuzione. Flathub resta fuori (N10).
Ramo: piano/fub-pre-alpha.
Chi: l'orchestratore (tocca la CI).
Tocca: `packaging/flatpak/` (nuova: il manifest, il file `.desktop`, il
metainfo di AppStream), `.github/workflows/release.yml` (un job che
costruisce il `.flatpak`), `.github/scripts/check-release-gate.mjs`,
`docs/development/versioning-and-releases.md`, la pagina «Prova la
pre-alpha» (T18: come si installa).
Non toccare: deb, rpm e AppImage, che restano; i permessi dell'app nel
codice.
Dipende da: nessuno per il manifest; prima di PA T22.
Cosa fare:
- L'id dell'app è `io.github.Fubeo.Fub`: Flathub, più avanti, accetta un
  id `io.github.<organizzazione>` verificato su GitHub, mentre `dev.fub.app`
  chiederebbe di provare il dominio. Cambiare l'id dopo vorrebbe dire
  perdere gli aggiornamenti, quindi si sceglie adesso e si scrive in
  `DECISIONS.md`.
- Il manifest usa il runtime e l'SDK GNOME alla versione corrente e
  costruisce Fub dai sorgenti, con le dipendenze di Cargo e di npm
  scaricate prima e dichiarate nel manifest (il builder non ha la rete).
- I permessi: `--share=ipc`, `--socket=wayland`, `--socket=fallback-x11`,
  `--device=dri`. Il vault si apre col portale dei file. Prima di
  scegliere i permessi dei file, prova che il watcher veda una modifica
  fatta da un altro programma a un vault aperto dal portale: se non la
  vede, il manifest prende `--filesystem=home` e i dischi esterni, e
  `DECISIONS.md` dice perché.
- Il job costruisce il `.flatpak` in un contenitore col builder di
  Flatpak e lo allega alla release col nome
  `Fub-<versione>-linux-x86_64.flatpak`.
Casi limite: un vault su un disco esterno (`/run/media`, `/media`); la CLI
`fub-cli` dentro la sandbox (il server MCP di T23); i caratteri di sistema;
la cartella della configurazione, che nella sandbox sta altrove (il primo
avvio la crea, e il vault non cambia).
Fatto quando: il job della release produce il `.flatpak`; T23 lo installa
e fa i suoi tre compiti.
Prova: la corsa a secco della release; il giro a mano di T23.
Stato: [ ] da fare

## T52 · «Segnala un problema»

Perché: D9 B. Più è facile mandare un riscontro, più ne arrivano, e più
sono completi. Una voce nel menu dell'applicazione apre la pagina della
issue su GitHub con la versione e il sistema già scritti, e nient'altro.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/ui/app-menu.ts` (la voce prima di
«Impostazioni»), `apps/client/src/i18n/catalog.ts`, il dialogo con
`kit/dialog.ts`, l'apertura del browser che c'è già nel host, i loro
test; i modelli delle issue di T18 (il campo della versione e del
sistema, che la voce riempie).
Non toccare: niente telemetria, niente invii da Fub: è il browser
dell'utente che apre la pagina; i nomi di file, il testo delle note e il
percorso del vault non entrano mai nell'indirizzo.
Dipende da: PA T18 (i modelli delle issue); S2 in `main` (il menu
dell'applicazione).
Dal prototipo: S255 (la voce nel menu) e S256 (il dialogo che dice che
cosa si manda); le toppe `riscontri-voce` e `riscontri-apre` di
`toppe/riscontri.html`.
Cosa fare:
- La voce «Segnala un problema…» apre il dialogo di S256: dice la
  versione e il sistema che finiranno nella pagina, e che non si manda
  altro. «Apri GitHub» apre
  `https://github.com/Fubeo/Fub/issues/new?template=…` con la versione e
  il sistema nei campi del modello; «Annulla» chiude.
- L'indirizzo si costruisce da una funzione pura con il suo test: solo la
  versione dell'app, il sistema e l'architettura, codificati.
Casi limite: nessun browser predefinito (l'errore del host si mostra
com'è, con l'indirizzo da copiare); la versione di sviluppo (`0.0.0-dev`);
il menu aperto da tastiera.
Fatto quando: la voce c'è, il dialogo dice il vero, il test prova che
l'indirizzo non porta altro.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/ui
Stato: [ ] da fare

## T53 · Cinque difetti di #237 che non perdono dati

Perché: D21 A. #237 tiene aperte R05–R08 e A03: intoppi che chi prova la
pre-alpha incontrerebbe. R06 conta col vault da 5.000 file (PA T45), A03
per chi usa la tastiera.
Ramo: piano/fub-pre-alpha.
Tocca, per voce:
- R05: `apps/client/src/panels/activity.ts` (dopo una riconciliazione
  fallita la lista vecchia resta senza dirlo);
- R06: `paletteHost.listDocuments` in `desktop-shell.ts` (una finestra di
  200 documenti: una nota fuori finestra non compare);
- R07: `syncRail()` e `clearSearch()` (che cosa si ricorda per vault; un
  vault non eredita la ricerca o la scelta di un altro);
- R08: il montaggio delle viste e `synchronize()` (la scheda del grafo
  dopo un cambio di vault e dopo la chiusura);
- A03: la casella delle impostazioni e il fuoco dopo Spazio.
Non toccare: R01–R04, che sono PA T4, T5 e T12.
Dipende da: S2 T10 per A03 (le impostazioni nuove).
Cosa fare: la regola di #237, una voce alla volta. Prima un test che la
riproduce nel proprietario; poi la correzione lì. Se non si riproduce, la
voce si chiude col test che lo dimostra, e la casella di #237 si spunta
solo quando il cambio è in `main`.
- R05: uno stato esplicito nell'elenco quando la lista non è aggiornata
  («Non aggiornato: {motivo}» e «Riprova»), col testo nuovo nel catalogo.
- R06: la ricerca o la paginazione che c'è già, mai tutto il vault in
  memoria.
- R07: per vault si ricordano la vista della barra laterale e la ricerca
  scritta; al cambio di vault si parte puliti.
- R08: non si toglie una chiamata che sembra in più senza una prova che la
  riproduca.
- A03: dopo Spazio il fuoco resta sulla casella.
Casi limite: il vault da 5.000 file (R06); due cambi di vault di fila
(R07, R08); la tastiera sola (A03).
Fatto quando: ogni voce ha un test che falliva e passa, o un test che
prova che non si riproduce; le caselle di #237 si spuntano dopo il merge.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/panels src/shells
Stato: [~] R05–R08 fatte · dcd06be8..46bee689 · ogni voce col suo test rosso
alla base; R05: sotto «Elenco non aggiornato» non si dice più «nessun
lavoro»; R06 (in `state/palette-host.ts` e `ui/palette.ts`): scrivendo, la
domanda per nome (`notesByName`) 120 ms dopo l'ultima battuta, come il
lanciatore; R07: vista e ricerca per vault in RAM (`state/per-vault.ts`, al
più 32); R08: la scheda della view resta davanti, e la seconda
`synchronize()` resta perché toglierla fa fallire la prova · resta A03, dopo
S2 T10; le caselle di #237 dopo il merge

## T54 · L'editor di testo vestito dal tema

Perché: D22 A (#242). `editors/text/theme.ts` scrive i colori con
`EditorView.theme` (42 `var(--ruolo)`), e alcuni profili Markdown passano
ruoli in linea. Un tema cambia i ruoli, ma la sua pelle non arriva
all'editor di testo, che è dove si scrive.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/src/editors/text/theme.ts`, i profili Markdown che
passano colori in linea (`editors/text/profiles/markdown/`:
`code-block.ts`, `details-live.ts`, `proof.ts`, `hanging.ts`,
`livepreview.ts`, `blocks/handles.ts`, `pending.ts`, `hints.ts`,
`math-live.ts`: solo le righe di colore), `theme/scrittoio/skin/editors.css`,
`theme/author/contract.json` e l'anatomia degli editor (gli hook nuovi),
`.github/scripts/check-inline-theme.mjs` (`theme.ts` esce da `SEPARATE`),
`docs/architecture/editor-surfaces.md`.
Non toccare: la geometria dell'editor (resta in `EditorView.theme`); gli
import di CodeMirror, che restano dentro il pacchetto dell'editor di testo
(`check-codemirror-boundary.mjs`); le classi `.cm-*`, che non cambiano.
Dipende da: PA T35 (la pelle del tema sopra quella di serie). Prima di PA
T41. Mai nella stessa ondata di S2 T20 o della griglia T2–T3, che toccano
`skin/editors.css`.
Dal prototipo: i tre temi d'esempio vestono anche l'editor di testo
(S282, S284, S297); le loro regole `.cm-*` stanno nei blocchi
`93-tema-*.css`.
Cosa fare:
- I colori vanno in `skin/editors.css`, sotto le classi `.cm-*`, con gli
  stessi ruoli di oggi; in `EditorView.theme` resta solo la geometria.
- Gli hook nuovi (il contenuto, la riga attiva, la selezione, il cursore,
  il margine, i segni del Markdown dal vivo) entrano nel contratto e
  nell'anatomia, così il cancello del tema li conosce e T41 li congela.
- `check-inline-theme.mjs` non ha più `theme.ts` in `SEPARATE`, e la sua
  guardia passa.
Casi limite: le foto dell'editor di testo si rifanno e devono tornare
uguali a oggi, pixel per pixel, nelle due luci e nel contrasto alto (se
una cambia, è un difetto); l'ordine dei fogli (la pelle deve vincere sul
tema base di CodeMirror senza `!important`); i colori forzati.
Fatto quando: un tema veste l'editor di testo con gli stessi cancelli del
resto; le foto del banco dell'editor di testo sono uguali a prima; la
guardia del tema in linea passa senza il caso a parte.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/text src/theme && npm run bench:verify; node ../../.github/scripts/check-inline-theme.mjs
Stato: [x] fatto · c17a6742..ed920bf4 · i colori dell'editor di testo stanno nella pelle (`skin/editors.css`), il tema di CodeMirror dà solo le classi `fub-syn-*` (non `cm-fub-*`: `profile.test` le conterebbe come decorazioni Live) e la luce; tolto il caso a parte da `check-inline-theme`; pixelmatch a soglia 0 su 821 foto, 53 diverse tutte instabili (almeno un giro nuovo uguale byte per byte a un giro base) · resta: ruoli in linea in profile.ts, properties.ts, table-widget.ts (nell'elenco della guardia); bench:verify sulle baseline del runner alla consegna

## T55 · Il controllo di tutte le viste nel banco

Perché: D19 A. Il difetto dei 44 px è venuto fuori guardando, non da un
controllo. La sonda del 2026-11-07 ha passato tutte le viste del
simulatore («Il controllo di tutte le viste»); questo task porta gli
stessi controlli nel banco, così una modifica futura non riporta difetti
simili.
Ramo: piano/fub-pre-alpha.
Tocca: `apps/client/bench/viste.mjs` (nuovo), un file delle eccezioni
`apps/client/bench/viste-eccezioni.json` (nuovo), `apps/client/package.json`
(`bench:viste`), `.github/workflows/ci.yml` (il passo nel job del banco,
accanto a `bench:a11y`), `CONTRIBUTING.md` (fra `ci-required:start/end`),
`docs/development/testing-and-quality.md`.
Non toccare: `bench:a11y` e le sue regole; le baseline.
Dipende da: S2 in `main` (le scene della cornice nuova); dopo PA T47, T56 e
T57, che tolgono i difetti trovati; prima di PA T15.
Dal prototipo: `script/sonda-viste.mjs` del simulatore, la sonda del
2026-11-07, coi suoi controlli, le sue soglie e le regole affinate in
cinque giri; l'elenco dei falsi allarmi in «Il controllo di tutte le
viste», che diventa il file delle eccezioni.
Cosa fare:
- `bench:viste` passa ogni scena di `bench/scene.mjs` a piena larghezza, a
  700 e al telefono (390), nelle due luci, col movimento ridotto, e cerca
  ciò che cerca la sonda, con le stesse regole:
  - un testo in «…» o tagliato a righe, quando il testo intero non sta né
    nel `title`, né nell'`aria-label`, né nel suggerimento di
    `ui/tooltip.ts` (nel banco gira il JavaScript vero, quindi il
    suggerimento si legge: è ciò che il simulatore non sa fare);
  - un testo o un controllo tagliato da un contenitore che non scorre o dal
    bordo; la pagina che scorre di lato;
  - due controlli o due testi che si coprono nella parte che si vede e
    nello stesso livello (menu, dialogo, elenco a comparsa, suggerimento,
    strato fisso stanno sopra; una superficie di testo ospita i suoi
    bottoni; un `details` chiuso non conta);
  - un bersaglio sotto i 24 px (44 al telefono), misurato dove il clic lo
    prende (`elementFromPoint`), che non sia in linea in una frase, con
    l'eccezione della distanza di WCAG 2.5.8 contata a parte (i vicini
    contano solo se il clic li raggiunge);
  - un contrasto sotto le soglie «normal» del contratto del tema, contro lo
    sfondo che si vede davvero (veli, sfumature, opacità, gli antenati con
    `pointer-events: none` rimessi nella pila), senza i testi spenti; il
    testo colorato dal file sulla carta del file a parte;
  - un fuoco che non cambia niente, che cambia solo un colore, o il cui
    anello sta sotto 3:1 o è tagliato su tutti e quattro i lati.
- Ogni eccezione ha la scena, il selettore e il perché; un'eccezione che
  non serve più fa fallire il controllo, come le eccezioni di
  `check-inline-theme.mjs`. Le prime sono i falsi allarmi di «Il controllo
  di tutte le viste»; i riscontri del telefono che aspettano il suo piano
  sono eccezioni con quel perché, e il piano del telefono le toglie.
Casi limite: un «…» voluto (un nome lungo in una scheda: eccezione col
perché); un'icona decorativa (glifi nascosti ai lettori di schermo:
soglia 3); un elemento nascosto per i lettori di schermo; la griglia, il
cui fuoco è il bordo della cella attiva (`aria-activedescendant`); il
cursore di un editor; le animazioni (il controllo gira col movimento
ridotto).
Fatto quando: `bench:viste` è verde sulle scene di oggi con le sole
eccezioni spiegate, e fallisce su una scena di prova con un taglio, un
bersaglio piccolo e un fuoco invisibile.
Prova: cd apps/client && npm run bench:viste && npm run bench:a11y
Stato: [ ] da fare

## T56 · La carta del file e il fuoco, dal controllo delle viste

Perché: D19 A. Il controllo di tutte le viste ha trovato sul computer
difetti veri di contrasto e di fuoco che nessun piano copre (Differenze
49–52). Al buio la carta del file resta bianca ma tiene i segni del
tema: la cella attiva, la selezione e l'anello stanno a 2,2:1, il «=» e i
numeri della formula a 1,8:1, e la cella in modifica ha un bordo scuro.
Tre superfici hanno l'anello tagliato su tutti i lati; l'azione di un
avviso sta a 4,4:1; una scheda colorata della lavagna lascia vedere la
scrivania sotto.
Ramo: piano/fub-pre-alpha.
Tocca:
- `theme/scrittoio/structure.css`: l'anello che rientra; nella carta del
  file (`.look-file .rich-desk, .look-file .grid-viewport`), l'anello e la
  sintassi;
- `theme/scrittoio/skin/editors.css`: i segni della griglia sulla carta, la
  cella in modifica, la pillola dei commenti;
- `theme/scrittoio/skin/drawers.css`: l'azione di un avviso;
- `editors/text/engine.ts` (`FIELD_LAYOUT`) e il suo test dei campi
  (`editors/grid/engine.test.ts`, «barra delle formule ed editor di cella
  sono campi»);
- `editors/canvas/engine.ts` (`nodeFill`) e il suo test;
- `docs/architecture/rich-surface-and-proofing.md` (la carta del file).
Non toccare: il contratto del tema (`theme/author/contract.json`): nessun
ruolo nuovo, la carta usa quelli che ha (`--paper-link`, `--doc-fg`,
`--doc-gutter-fg`, `--doc-danger`); le intestazioni della griglia, che sono
cornice e tengono il tema; `PRESET_FILL` per le linee della lavagna; il
colore che un file dà alle sue celle; `look-adattato`; il telefono (PA T47).
Dipende da: S2 in `main`; dopo PA T48 (i rapporti si rimisurano col verde
di serie). Mai nella stessa ondata di PA T54, della griglia T2–T3 o di S2
T20, che toccano `skin/editors.css`. Prima di PA T55, che lo controlla.
Dal prototipo: le sezioni «PA T56» del blocco `92-prealpha-viste.css`, ognuna
col suo file; al buio S43 (`foglio-modifica`), S50 (`g2-foglio-formula`),
S51 (`g2-foglio-scrive`), S56 (la cella attiva); alla luce S23
(`conflitto`), S30, S32, S33, S41 (gli avvisi), S132 (`lavagna`); col bottone
«Fuoco» S5 e S33 (l'anteprima), S210 (il grafo), S83 nello stretto (la
pillola dei commenti).
Cosa fare:
- L'anello di `.cm-editor > .cm-scroller`, `.pane-preview` e `.graph-main`
  rientra della sua larghezza (`outline-offset: calc(-1 *
  var(--focus-ring-width))`), accanto a `:focus-visible` in `structure.css`.
- Nella regola della carta di `structure.css` si aggiungono `--focus-ring:
  var(--paper-link, #2c57cd)`, i dieci `--syn-*` sull'inchiostro della carta
  (`--doc-fg`; `--syn-comment` su `--doc-gutter-fg`, `--syn-invalid` su
  `--doc-danger`), con le righe del blocco. Come in Excel, nella formula
  hanno colore solo i riferimenti, che usano già `--doc-author-*`.
- In `skin/editors.css`, sotto la regola dei segni della griglia, i segni
  della carta (le celle, `.grid-cell`, che portano `.active` e `.selected`;
  `.grid-selection`, il riempimento, lo spostamento, il taglio, la cella in
  modifica, gli oggetti, il segno dei commenti) ridichiarano `--accent` e
  `--accent-veil` dalla carta; la cella in modifica ha `background:
  var(--doc-bg)` e il quadratino del riempimento il bordo della carta. Le
  regole sono quelle del blocco. Non la riga (`.grid-row`): contiene anche
  l'intestazione, che sta sul fondo del tema, e al buio l'intestazione
  scelta scenderebbe a 2,7:1 (il primo giro del simulatore l'ha fatto, e il
  controllo l'ha trovato).
- `FIELD_LAYOUT` prende `foldGutter: false`; il test dei campi controlla
  anche che non ci sia `.cm-foldGutter`.
- `.rich-side-open:focus-visible` ha l'anello dentro la pillola (`box-shadow:
  inset …, var(--shadow-2)`).
- `.conflict-banner .link-button` e `.sheet-notice .link-button` hanno
  `color: var(--accent-soft)`; il passaggio resta com'è.
- In `editors/canvas/engine.ts` la scheda colorata mescola il colore nella
  carta: una tabella `NODE_FILL` con `var(--doc-bg)` al posto di
  `transparent`, usata da `nodeFill`; `PRESET_FILL` resta per `edge.color`.
  Il test: una scheda col colore 4 ha uno sfondo che finisce in
  `var(--doc-bg))`, una linea col colore 4 un tratto che finisce in
  `transparent)`.
- La pagina della carta in `docs/` dice che l'anello, la sintassi e i segni
  della griglia stanno sulla carta.
Casi limite: un tema senza `--paper-*` (i ripieghi della serie, `#2c57cd`);
il contrasto alto (`--paper-link` del contrasto alto è più scuro, i
rapporti si rimisurano); i colori forzati (gli anelli restano `outline`, e
`box-shadow` sparisce: la pillola ha già un bordo); una scheda con un colore
libero (`#rrggbb`) resta del suo autore; la riga attiva della cella in
modifica resta `--doc-active-line` della carta; un documento di
videoscrittura al buio con un'immagine selezionata (i segni della carta del
documento: se usano `--accent`, stessa regola sui segni, non su tutta la
scrivania).
Fatto quando: le viste dette sopra passano `bench:viste` (PA T55) senza le
righe di Differenze 49–52; i test di `FIELD_LAYOUT` e di `nodeFill`
sono verdi; le baseline nuove vengono dal runner.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/text src/editors/grid src/editors/canvas && npm run typecheck && npm run bench:verify && npm run bench:a11y
Stato: [ ] da fare

## T57 · I bersagli e i nomi interi, dal controllo delle viste

Perché: D19 A. Il controllo di tutte le viste ha trovato sul computer
bersagli sotto i 24 px che non hanno distanza dai vicini (WCAG 2.5.8) e nomi
in «…» il cui testo intero non sta da nessuna parte, né nel suggerimento né
nell'etichetta (Differenze 53 e 54).
Ramo: piano/fub-pre-alpha.
Tocca:
- `theme/scrittoio/skin/document.css` e
  `editors/text/profiles/markdown/blocks/handles.ts` (le maniglie del
  blocco), `editors/text/profiles/markdown/hints.ts` (la pastiglia del
  titolo);
- `theme/scrittoio/skin/editors.css` (la tavolozza), `structure.css`
  (`.kit-ribbon-arrow`), `skin/frame.css`, `skin/sheets.css`,
  `skin/media.css`, `skin/settings.css`;
- i suggerimenti: `editors/spatial/tools/objects.ts`,
  `editors/canvas/engine.ts`, `ui/views.ts`,
  `shells/scrittoio/launcher/launcher.ts`, coi test accanto.
Non toccare: `ui/tooltip.ts` (si usa `setTooltip` com'è); i bersagli del
telefono (PA T47 e il piano del telefono); le eccezioni del controllo
(«Il controllo di tutte le viste»: un collegamento in una frase, il segno
di un commento in una cella, le celle della griglia).
Dipende da: PA T56 (tocca anche `editors/canvas/engine.ts` e
`skin/editors.css`). Mai nella stessa ondata di PA T54, della griglia T2–T3
o di S2 T20. Prima di PA T55.
Dal prototipo: le sezioni «PA T57» del blocco `92-prealpha-viste.css`; S3
(`nota-blocchi`) e S8 (`blocchi-menu`), S20 (la pastiglia), S56
(`g2-foglio-ribbon-palette`: tavolozza e frecce), S179 (`g2-raw-girato`, le
etichette XMP), S183 (`componenti`, l'indice), S106 (gli oggetti del
disegno), S132 (la lavagna), S210 («Segue»), S211 (il lanciatore).
Cosa fare:
- Le maniglie del blocco: 24 × 24 nella forma di `handles.ts` (base theme),
  `opacity: 0.75` a riposo in `skin/document.css`.
- La pastiglia del titolo: un `::after` trasparente con `inset: -6px -4px
  -6px 0` nella forma di `hints.ts` (24 × 25); non cambia aspetto. Verso
  destra e non verso sinistra: nel riquadro di destra, a sinistra della
  pastiglia, c'è il divisorio dei riquadri, che prende il clic.
- La tavolozza: `gap: var(--space-3)`, passo 24.
- `.kit-ribbon-arrow`: `min-width: 24px`. La fila si allunga di 10 px per
  ogni pulsante diviso: il gruppo che non ci sta va nel «più», come oggi.
- `.status-item--button`, `.sheet-title` e `.craft-xmp-tag`: `min-height:
  var(--space-8)`.
- L'indice delle impostazioni: il nome va a capo (`.settings-toc-link`
  alta quanto serve, `.settings-toc-name` senza «…»), come nel blocco.
- `setTooltip` col testo intero sull'elemento che prende passaggio e
  fuoco: la riga di un oggetto del disegno (il nome della riga), la testata
  di una scheda della lavagna (il titolo), l'intestazione dell'ispettore
  («Segue: …»), la riga del lanciatore (titolo, dettaglio e scorciatoia).
  Quando il testo cambia, `setTooltip` di nuovo; il suggerimento muore con
  l'elemento.
- I test accanto: ogni riga detta sopra ha il suggerimento col testo
  intero, anche lungo.
Casi limite: la maniglia più larga nel margine stretto della Live a 700
(non deve uscire dalla carta); la pastiglia di un titolo di sesto livello,
dove la riga è alta 24 px; una fila della barra a schede alla 700; un nome
dell'indice di tre righe (con un carattere grande d'Aspetto); i
suggerimenti con la tastiera (il fuoco li apre, Esc li chiude) e il
movimento ridotto.
Fatto quando: le viste dette sopra passano `bench:viste` senza le righe di
Differenze 53 e 54; i test dei suggerimenti sono verdi; le baseline nuove
vengono dal runner.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors src/ui src/shells/scrittoio/launcher src/panels && npm run typecheck && npm run bench:verify && npm run bench:a11y
Stato: [ ] da fare

## T58 · La guardia stretta anche per enum, variant e funzioni esportate

Perché: T7 ha provato con componenti veri che un caso nuovo in un `enum` o
in un `variant` raggiunto da un'interfaccia esportata, e una funzione nuova
in un'interfaccia esportata, impediscono di caricare un plugin già
compilato. `wit_additivity.rs` contro 0.2.0 li ammette ancora in coda, e
l'ADR 0235 e alcuni commenti di `abi.wit` dicono il contrario dei test.
L'utente ha scelto la regola stretta (registro 2026-11-08).
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-abi/tests/wit_additivity.rs`;
`crates/fub-wasm-host/tests/new_case_and_function.rs` e i suoi componenti
(`esempi/plugin-prima-*`, `esempi/servizio-prima`), se serve il caso degli
import; i commenti di `crates/fub-abi/wit/fub/abi.wit` che dicono «un caso
nuovo va in coda» (solo commenti: la forma non cambia);
`docs/decisions/0235-un-record-pubblicato-non-cresce.md` (allargata, o una
decisione nuova che la estende, secondo `documentation-style.md`);
`docs/reference/abi-and-wit.md` («Compatibilità»);
`crates/fub-abi/wit/frozen/README.md`.
Non toccare: `wit/frozen/*.wit`; la forma di `abi.wit`; le regole per
0.1.0 e 0.1.1.
Dipende da: T6, T7.
Cosa fare:
- Prima la prova degli import, col giro di T7: un guest compilato contro
  la WIT di prima e un host con un caso in più in un `enum`/`variant` che
  il guest riceve da un'interfaccia importata, e un host che dà una
  funzione in più in un'interfaccia importata. I test dicono il risultato
  com'è.
- Contro 0.2.0 e dopo, la guardia rifiuta: un caso nuovo, tolto o
  spostato in un `enum` o `variant` che attraversa il confine (stessa
  raggiungibilità dei record di T6); una funzione nuova, tolta o cambiata
  in un'interfaccia esportata dal plugin. Per le interfacce importate
  segue quello che dice la prova degli import.
- Passano ancora: interfacce nuove, tipi nuovi, funzioni nuove dove la
  prova dice che non rompono.
- Test della guardia su testi WIT finti, uno per regola, col messaggio
  che nomina tipo e caso o funzione.
- I commenti di `abi.wit`, l'ADR e la pagina dicono la regola nuova;
  nessun testo dice più «un caso nuovo va in coda» per il confine.
Casi limite: un `enum` usato solo dentro l'host (non attraversa: passa);
un `variant` raggiunto solo da un import; un `flags` (trattalo come un
`enum`, e scrivi perché).
Fatto quando: `cargo test -p fub-abi --test wit_additivity` passa coi
casi finti nuovi che falliscono come atteso; `cargo test -p fub-wasm-host
--test new_case_and_function` prova anche gli import; ADR e pagina dicono
la regola.
Prova: scripts/check.sh --rapido; cargo test -p fub-abi; cargo test -p
fub-wasm-host
Stato: [x] fatto · 99fd7e22..7d2b157e · ADR 0238 (estende la 0235); contro
0.2.0 enum, variant e flags del confine (import compresi) non prendono casi,
le interfacce esportate non prendono funzioni; una funzione nuova in
un'interfaccia importata resta additiva; `check.sh --rapido` del coder verde

## T59 · Un file in sola lettura non si sovrascrive

Perché: T13 ha trovato che su Linux un file coi permessi 0444 viene
sovrascritto: `write_inner` in `crates/fub-kernel/src/storage/rooted.rs`
scrive un temporaneo accanto, gli copia i permessi del file e lo rinomina
sopra, e il rename non guarda i permessi del file. Su Windows il rename
sopra un file con l'attributo di sola lettura probabilmente fallisce, ma
come errore di I/O generico. L'utente ha scelto che Fub rifiuti (registro
2026-11-08): il «Fatto quando» 4 dice che la sola lettura non tocca il
file.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-kernel/src/storage/rooted.rs` (e `storage.rs` se un
altro percorso sostituisce i byte di un file che c'è già); un test di
`crates/fub-kernel/tests/` (nuovo o accanto a `guarded_write.rs`);
`crates/fub-host/tests/prealpha_corpus.rs` (il caso del permesso del
file); `apps/client/src/state/document-controller.ts`, il suo test e
`apps/client/src/i18n/catalog.ts`, solo se il messaggio del salvataggio
fallito non dice già che il file è in sola lettura;
`docs/reference/` o `docs/architecture/` dove si descrive la scrittura
atomica (la pagina che ne parla oggi).
Non toccare: la forma di `PluginError` (c'è già `PermissionDenied`, e
`kernel/src/error.rs` ci porta `io::ErrorKind::PermissionDenied`); i
provider; la cancellazione e il cestino.
Dipende da: T13.
Cosa fare:
- Prima di creare il temporaneo, se il file c'è e non è scrivibile, la
  scrittura si ferma con `io::ErrorKind::PermissionDenied` e un messaggio
  che nomina il file; il file e la cartella restano come erano (nessun
  temporaneo lasciato).
- «Non scrivibile»: su Windows l'attributo di sola lettura; su Unix
  nessun permesso di scrittura per chi fa girare Fub (il bit del
  proprietario, del gruppo o degli altri che si applica al processo, non
  solo `readonly()` che guarda tutti e tre). Scrivi nel codice perché.
- Il rifiuto arriva alla shell come `PermissionDenied` tipizzato: la bozza
  resta sporca, nessun byte perso; il messaggio dice che il file è in sola
  lettura (non un errore di I/O), e il salvataggio automatico non lo
  ripete a ogni battuta.
- Un file nuovo e un file scrivibile si scrivono come prima.
Casi limite: il permesso tolto fra l'apertura e il salvataggio; un file
scrivibile in una cartella senza permesso di scrittura (già un errore del
sistema: resta tipizzato); un symlink (già rifiutato prima); Fub che gira
come root su Unix (il controllo è esplicito, non dipende dal sistema).
Fatto quando: il test del kernel e il caso nuovo di `prealpha_corpus`
(file in sola lettura: rifiuto tipizzato e byte uguali) passano sui tre
sistemi nella CI completa; il test della shell prova il messaggio e la
bozza che resta.
Prova: scripts/check.sh --rapido; cargo test -p fub-kernel; cargo test -p
fub-host --test prealpha_corpus
Stato: [x] fatto · 7c585e1f..b14b488c · in main con la consegna 1 (#317,
c1ad9eaa), verde su Linux, Windows e macOS (corsa 42484380329) · su Unix conta la classe che si applica al processo
(per root, nessun bit di scrittura); solo questo rifiuto diventa
`PermissionDenied` (un `ReadOnlyFile` dentro l'`io::Error`), gli altri
permessi negati restano `Io`; l'avviso esce una volta per documento e il
salvataggio automatico riprova a ogni pausa; resta generico
`notice.save_failed` in `panels/document.ts` (fuori dal «Tocca»)

## T60 · Le altre prove del lucchetto a un colpo solo

Perché: T19 ha trovato la causa di #292, #270, #98 e #70: una prova che
chiede il lucchetto del workspace una volta sola (`try_read`/`try_write`)
e si aspetta di averlo libero, mentre un `fub-job-*` del runner lo può
prendere per un istante. T19 ha corretto quei test con
`try_read_within`/`try_write_within`/`comes_free` (`legacy_tests.rs`), ma
nel repo ci sono ancora 95 chiamate a un colpo solo. Due sono già cadute:
`a_nested_command_provider_runs_without_holding_the_workspace_lock` (1 su
8 in locale, PA T9) e `a_command_provider_runs_without_holding_the_workspace_lock`
(`concurrency.rs:501`, macOS, corsa 42481723853 della consegna 1).
Ramo: piano/fub-pre-alpha.
Tocca: i test di `crates/fub-host/src/legacy_tests/` e i test in
`crates/fub-host/src/runner.rs` che aspettano un lucchetto libero; gli
aiuti di `legacy_tests.rs` se ne serve uno in più.
Non toccare: il codice che non è di test; le prove che si aspettano il
lucchetto **preso** (lì un colpo solo è giusto: un lucchetto preso non si
libera da sé, e una scadenza nasconderebbe il difetto).
Dipende da: T19.
Cosa fare:
- Per ogni chiamata a un colpo solo, decidi se la prova aspetta il
  lucchetto libero o preso. Libero: l'aiuto con la scadenza, come T19.
  Preso: resta, con un commento di una riga che dice perché.
- Se una sonda guarda il lucchetto da dentro un `Drop` o un provider (il
  caso di #98), segui lo schema di T19 (`Probe::drop_resource`).
- Le due prove cadute girano 200 volte da sole, verdi.
Casi limite: una prova che oggi passa solo perché il colpo solo cade
sempre nello stesso verso (la si riscrive perché dica ciò che vuole);
`the_watcher_batch.rs`, dove alcune prove aspettano il lucchetto preso.
Fatto quando: nessuna prova che aspetta un lucchetto libero lo chiede una
volta sola (`grep` nel resoconto); 200 corse verdi delle due cadute.
Prova: scripts/check.sh --rapido; cargo nextest run --retries 0 -p
fub-host --lib legacy_tests::concurrency (200 volte)
Stato: [x] fatto · 8fc9e15a..cb1e66c4 · aiuti `read_comes_free` e
`write_comes_free` in `legacy_tests.rs`; le due cadute 200/200 da sole;
622 prove della lib di `fub-host` verdi. Restano a un colpo solo, con un
commento: le 4 sonde che aspettano il lucchetto preso (`long_running.rs`,
`read_model_lock.rs`, `watcher_factory_lock.rs`). Allargato dall'orchestratore
alle 4 sonde di test di `session.rs` (DECISIONS); il codice vero di
`session.rs` e `custody.rs` non cambia

## T61 · La CI Mobile parte anche per la cornice del telefono

Perché: T8 ha trovato che i filtri `paths` di `mobile.yml` non coprono
`apps/client/src/shells/scrittoio/mobile/**` né `apps/client/src/theme/scrittoio/`:
una PR che cambia solo la cornice del telefono o i suoi stili non
costruisce l'APK, e un guasto del telefono arriva in `main` senza che la CI
lo veda. L'utente ha detto sì al task (2026-11-08).
Ramo: piano/fub-pre-alpha.
Tocca: `.github/workflows/mobile.yml` (solo `on.pull_request.paths`), la
pagina dove `mobile.yml` è descritto (`docs/development/` o
`docs/architecture/phone-frame.md`) se nomina i percorsi.
Non toccare: i job di `mobile.yml`; `ci.yml`; i nomi dei job
(`check-release-gate.mjs`).
Dipende da: niente.
Cosa fare:
- Elenca i percorsi che l'ingresso del telefono (`mobile.html`,
  `entrypoints/mobile*`) importa davvero: segui gli import, non i nomi delle
  cartelle. Aggiungi ai `paths` ciò che è solo del telefono (almeno
  `shells/scrittoio/mobile/**`) e gli stili che solo il telefono monta.
- Non allargare a tutto `apps/client/**`: la CI Mobile è lenta, e i
  cambi comuni passano già dai job del desktop. Se un percorso è comune
  (per esempio `theme/scrittoio/`), mettilo solo se una sua rottura si vede
  solo sul telefono; la scelta va scritta nel resoconto.
Casi limite: un percorso rinominato da Scrittoio 2 (il filtro lo deve
seguire quando Scrittoio 2 entra: una riga nel resoconto per il prossimo
allineamento).
Fatto quando: i `paths` coprono la cornice del telefono; la PR di consegna
che porta T61 fa partire `mobile.yml` (la si vede nella lista dei check).
Prova: scripts/check.sh --rapido; `actionlint` se c'è, altrimenti la CI
Stato: [x] fatto · 9cbd4be1..b8b30682 · in main con #319, dove `mobile.yml` è partito ed è passato · entra `shells/scrittoio/mobile/**`
(solo il telefono la importa) e, per scelta dell'orchestratore,
`Cargo.lock`; restano fuori `theme/scrittoio/` e il resto del client
(comuni, il build Vite del desktop fa anche `mobile.html`) e le righe `cfg`
del telefono nei crate comuni (provate sul push in main). Se Scrittoio 2 rinomina
`shells/scrittoio/mobile/`, il filtro va spostato

## T62 · La WebView fa pulizia prima di ogni lettura della memoria

Perché: #284. `R1.giri.pendenza` sullo stesso albero è uscita 10 e 56 MiB
(soglia 20): la WebView restituisce la memoria quando vuole, e la retta dei
giri misura quando lo fa più che quanto resta. T21 ha già preso la lettura
più bassa in 60 s a ogni giro e ha concluso che serve una raccolta forzata
da un gancio in fub-app. Ogni rosso a caso costa alla consegna una mezz'ora
di CI completa in più (consegna 3, #320). Task chiesto dall'orchestratore il
2026-11-09.
Ramo: piano/fub-pre-alpha.
Tocca: `crates/fub-app/src/` (il gancio, solo Linux), `apps/client/bench/webview/`
(`run.mjs`, `memory.mjs` e i loro test), `docs/development/webview-measurements.md`.
Non toccare: le soglie di R1 (né `docs/misure/`); l'IPC pubblica e il suo
mirror TS; `ci.yml` oltre a una variabile d'ambiente del job `webview`, se
serve; i nomi dei job (`check-release-gate.mjs`).
Dipende da: T21 (integrato).
Cosa fare:
- Prima la prova: misura in locale quanto la raccolta cambia R1
  (WebKitGTK 4.1: `WebContextExt::garbage_collect_javascript_objects` sul
  contesto della WebView, via `with_webview`; guarda se basta o se serve
  altro della WebView per restituire memoria al sistema).
- Il gancio è spento di serie e acceso solo dal banco (una variabile
  d'ambiente letta all'avvio, per esempio `FUB_BENCH_GC=1`). La via più
  stretta: niente comando IPC nuovo nella build normale; se un comando serve,
  esiste solo col gancio acceso e non entra nel contratto. Il gancio non
  legge né scrive file del vault e non apre porte.
- Il banco chiede la raccolta prima di ogni lettura di R1 (vuota, chiuse,
  giri, tardi) e aspetta che sia finita prima di leggere; il resto delle
  misure non cambia.
Casi limite: il gancio chiesto con la variabile spenta non fa niente e il
banco lo dice nel referto; Windows e macOS non lo hanno (R1 è solo Linux);
la raccolta con un documento aperto non deve toccarne lo stato.
Fatto quando: in locale R1 per 5 corse di fila (mai due banchi WebView
insieme: l'app è una sola sul bus di sessione) dà `R1.giri.pendenza` sotto
soglia in tutte e 5, con lo scarto fra la più alta e la più bassa scritto
nel resoconto e confrontato con 5 corse senza il gancio; un test prova che
senza la variabile il gancio non c'è.
Prova: scripts/check.sh --rapido; i test di `fub-app` del gancio; i test del
banco; le 10 corse di R1 (5 con, 5 senza)
Stato: [x] fatto · fc4333a6..db322aaa · un'estensione web del banco (WebKitGTK 4.1 non ha un'API per la raccolta), caricata solo da una build con la feature `bench-gc`, che il job `webview` accende e il rilascio no; 5+5 corse R1 a macchina libera: col gancio la pendenza resta fra 1,8 e 3,2 MiB, senza va da 0,7 a 17,5
