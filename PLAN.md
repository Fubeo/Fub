# Piano: Scrittoio 2, la cornice nuova in ogni editor

Branch: piano/scrittoio-2
Obiettivo: in ogni editor di Fub (note, documenti Word e ODT, fogli, lavagna, disegni, SVG, Craft, PDF, immagini e audio) la persona trova la stessa cornice quieta del mockup. La modalità si sceglie dalla banda in basso; la testata del foglio dice solo dove sei e se è salvato; cassetto e ispettore parlano a voce bassa; il testo da leggere è più grande; tutte le barre degli strumenti hanno la forma della barra dei fogli.
Perché: oggi la testata porta quattro tasti che pesano più del contenuto, e ogni editor ha una barra disegnata a modo suo, così la persona reimpara la forma a ogni formato. Il documento dell'utente del 2026-11-04 chiede la pagina Benvenuto ridisegnata; il brief la allarga a tutti gli editor, con la barra dei fogli come standard.
Fuori scope:
- la tavolozza e i colori, che restano quelli di oggi (l'unica eccezione è la misura del testo, D2);
- contratti nuovi: IPC, WIT, `fub-abi`, formati su disco;
- il ritmo dei paragrafi, la scrittura di `Ctrl+O`, il colore del gettone del vault, il tasto «/» del filtro, i sottotitoli tenui, h5 e h6;
- l'aspetto della tela della lavagna e il suo contrasto (~4,2:1), che sono di N6 T22; la lavagna a 700 px;
- la striscia del foglio scuro della griglia (griglia T2);
- il docx a 700 px e il movimento della barra dei fogli (K3 T19);
- la colonna degli strumenti del disegno, che è di K5 (qui c'è solo la proposta);
- la WebView vera, Windows e macOS, che si vedono solo in CI.
Assunzioni:
- Valgono le risposte raccomandate (A) a D1–D9 e alle due scelte «da decidere guardando» (menu A, titolo 600), finché l'utente non dice altro.
- Valgono le «Decisioni già prese» del documento dell'utente, tranne l'eccezione di D2.
- Si apre una PR bozza sola. T1 parte subito; nessun task grafico parte prima dell'OK al prototipo. Al massimo due task insieme.
- Differenze volute dalla bozza dell'utente:
  - (a) il menu delle modalità nasce in `state/mode-menu.ts` e non in `state/document-controller.ts`, che N6 sta cambiando;
  - (b) le stringhe nuove della shell vanno in `src/i18n/catalog.ts`, in italiano e in inglese; `bench/fake-english.ts` traduce solo i testi dell'host finto e cambia solo in T13;
  - (c) `editors/text/profiles/markdown/hints.ts` non si tocca: la pastiglia `H1` oggi si vede già solo sulla riga del cursore (`hints.ts:84`);
  - (d) `#status-standing` nasce in JS dentro `status-band.ts`, non in `index.html`;
  - (e) il titolo della nota pesa 600 e non 500 (si decide guardando);
  - (f) le scorciatoie del menu si leggono da `allCommands()` e `displayBinding`, che rispettano le scorciatoie cambiate dalla persona, e non da `ui/shell-keys.generated.ts`.
Ondate: T1 T16 | T2 T11 | T5 T10 | T3 T6 | T7 T17 | T4 T8 | T18 T20 | T9 T19 | T14 T21 | T12 T22 | T13 T23 | T15 | T24 | T25 | T26
Prototipo: `PLAN-ui/scrittoio-2.html`, da approvare: nessun task grafico parte prima dell'OK dell'utente; T1 può partire subito.

## Modifiche

nessuna

## Domande per l'utente

Il piano procede sull'opzione raccomandata (la prima) come assunzione esplicita.
Ogni risposta diversa cambia solo i task indicati.

- **D1 · Fogli affiancati.**
  - A (raccomandata): basta la banda; dice e cambia la modalità del foglio a fuoco, che la cornice già segna. In pratica, per cambiare la modalità del foglio di destra ci clicchi prima dentro; le testate restano pulite.
  - B: con due o più fogli ogni testata tiene il suo bottone `.pane-mode-current`. In pratica la modalità si vede accanto a ogni foglio, con un po' di rumore in più.
  - Task: T3.
- **D2 · Corpo del testo.**
  - A (raccomandata): il predefinito passa a 18 px e la misura a 58 caratteri, in TS e in Rust; chi ha già scelto un valore in Aspetto lo tiene. In pratica chi non ha mai toccato la dimensione legge più grande, su righe più corte, con gli stessi a capo del mockup. Cambiano anche `recipe.ts` e i fogli generati, ma solo per `--text-reading` e `--content-width`: è un'eccezione esplicita alla «tavolozza intatta».
  - B: restano 17 px e 68 caratteri, e il mockup non si ottiene.
  - Task: T11.
- **D3 · La riga dei dati sotto il titolo.** È «Modificata 2 ore fa · 3 collegamenti · #tema #banco» in Live, Blocchi e Lettura.
  - A (raccomandata): sì, letta dagli indici che esistono già, senza IPC nuova; in Sorgente non c'è.
  - B: no.
  - Task: T12.
- **D4 · «In entrata».**
  - A (raccomandata): sotto la Struttura le prime 5 note che puntano qui, poi «e altri N»; nel pannello Collegamenti «Entranti» diventa «In entrata», così la parola è una sola. In pratica vedi chi cita la nota senza cambiare scheda; la Struttura fa una lettura dell'indice in più.
  - B: solo nella scheda Collegamenti, come oggi.
  - Task: T13.
- **D5 · Conteggi nel cassetto.**
  - A (raccomandata): accanto a ogni cartella il numero dei suoi file diretti (lo zero non si scrive), e sopra l'albero «Tutte le note N».
  - B: nessun numero.
  - Task: T8.
- **D6 · Il campo dei comandi.**
  - A (raccomandata): «Cerca o esegui un comando». Sul computer la pillola è sempre il campo dei comandi, perché il nome della nota sta già nella testata; sul telefono resta il nome della nota.
  - B: resta «Apri, cerca, comanda…», e la pillola mostra cartella e nota come oggi.
  - Task: T7.
- **D7 · Le figure monocrome per cartelle e note.**
  - A (raccomandata): la figura si salva come `fub:<nome>` nella stessa stringa dell'icona di oggi, quindi nessun campo nuovo e nessun cambio di contratto. In pratica una versione di Fub di prima di questo piano mostra la scritta `fub:book` dove c'era la figura, finché non si aggiorna.
  - B: un campo nuovo nel contratto per il tipo d'icona. È più lavoro, tocca `fub-abi` ed esce da «niente contratti nuovi».
  - Task: T14, T15.
- **D8 · Il gruppo raccolto nella barra a schede del documento.**
  - A (raccomandata): si apre sul posto (`openInPlace` del kit, che arriva con K3), come nei fogli.
  - B: resta il riquadro sospeso di oggi.
  - Task: T21.
- **D9 · Le PR.**
  - A (raccomandata): una PR bozza sola per tutto il piano, con le baseline rifatte una volta alla fine dal runner. In pratica una revisione lunga, ma una sola tornata di foto.
  - B: quattro PR come nella bozza, cioè quattro tornate di baseline e quattro attese della CI completa.
  - Task: T24, T25.

## Da decidere guardando

Nel prototipo le due varianti si accendono con le caselle in alto, oppure con
`?menu=menu-b` e `?titolo=titolo-500`.

1. Il menu delle modalità:
   - A (raccomandata): il punto a sinistra e la scorciatoia scritta per esteso;
   - B: la spunta blu a destra e le scorciatoie in pastiglie, come nel mockup.
   - Il CSS di B è nel blocco `data-variante="menu-b"` e andrebbe in `skin/menus.css` (T10).
2. Il peso del titolo della nota:
   - 600 (raccomandato), pieno come nel mockup;
   - 500, come scritto nella bozza.
   - Il blocco è `data-variante="titolo-500"`, in `skin/document.css` (T11).

## Domande per l'orchestratore

Sono proposte per gli altri piani: l'orchestratore le passa al loro pianificatore
o le decide secondo `DECISIONS.md`. Nessuna blocca questo piano.

- **K5 T25:** la testa del disegno va costruita in `kit-bar` e la colonna in `kit-rail`; il gettone del motore resta suo. Se K5 approva un prototipo diverso prima di T22, T22 segue quello.
- **N6 T49–T52:**
  - la barra della lavagna va costruita dentro `.kit-bar`, `kit-options` e `kit-rail`, con l'icona `layout-dashboard` per la modalità;
  - il gettone della penna di N4 resta suo;
  - N6 T41 e T50 usano `createFormatBar`, che T17 tiene con la stessa API;
  - N6 T52 tiene la sua banda;
  - l'aspetto della tela resta N6 T22.
  - Se N6 non arriva in tempo, T23 diventa lavoro di N6 o un seguito (vedi T23).
- **A1 T12:** usare `settings-section-title` e le etichette in tondo di T10.
- **N4 e N6** su `structure.css`, `skin/editors.css` e `catalog.ts`: ognuno resta nei suoi pezzi, e chi entra per secondo ribasa.
- **T25:** per avere le foto del runner basta `gh workflow run ci.yml --ref piano/scrittoio-2`, che fa girare i banchi anche fuori dalle PR. In alternativa si segna la PR pronta, con la CI completa (Windows e macOS), che serve comunque a T26.

## Che cosa cambia, editor per editor

| Editor | Che cosa vede la persona | Task |
|---|---|---|
| Note (Markdown) | - in basso a destra «✎ Live ⌃» apre Live, Blocchi, Sorgente, poi la Lettura, con le scorciatoie<br>- la testata ha le briciole (vault › cartelle › nota), «✓ Salvato» e «…»<br>- la riga dei dati sotto il titolo<br>- il testo a 18 px su 58 caratteri, il titolo 40/46, H2 25/32<br>- i punti degli elenchi in grafite, il filo dei link a metà forza, citazione e richiamo neutri<br>- la barra di formato nella fila di serie; la Struttura con la tacca blu e «In entrata» | T2, T3, T5, T11, T12, T13, T17 |
| Documenti Word e ODT | - Pagina, Scrittura e Lettura nella banda, con le loro icone<br>- «Si scrive» passa dalla testata alla banda, mentre gli altri stati (sola lettura, chiuso) restano in testata<br>- la barra a schede prende le classi del kit, e un gruppo raccolto si apre sul posto | T2, T4, T5, T20, T21 |
| Fogli di calcolo | - la barra dei fogli è l'origine dello standard: si vede come oggi, ma la sua forma passa a `kit-ribbon-*`<br>- testata e banda come le note | T5, T20 |
| Lavagna | - la barra nella fila di serie, coi comandi raccolti in foglietti<br>- la modalità con l'icona `layout-dashboard` | T23 (dopo N6) |
| Disegni | - Disegno (o Annota) e Lettura nella banda<br>- la testa del disegno nella fila di serie; la colonna degli strumenti prende la pelle `kit-rail` | T2, T3, T22 |
| SVG come testo | Diviso, Sorgente e poi Anteprima nella banda; Diviso con l'icona `split` | T2, T3 |
| File Craft | - senza anteprima, un foglietto sollevato al posto del riquadro tratteggiato<br>- le risposte sono pulsanti del kit | T19 (dopo N7) |
| PDF | - la barra di serie in cima, coi gruppi e la lente<br>- «Pagina N di M» nella banda<br>- «Apri con un'altra app» e «Copia il link alla pagina» in «…» | T18 (dopo N7) |
| Immagini e audio | solo la cornice comune: testata, linguette con la figura del formato, banda | T5, T6 |
| La shell | - la pillola diventa «Cerca o esegui un comando»<br>- i bottoni premuti del binario e della barra del titolo sono foglietti sollevati<br>- il cassetto: «Note» con ordina e nuova nota a icona, il filtro pieno con la lente, «Appuntate», «Tutte le note N», i conteggi e il gallone sottile<br>- l'ispettore a 264 px, con le schede in pozzetto e «● Segue la nota»<br>- impostazioni, componenti, avvio rapido, grafo e benvenuto con le etichette in tondo<br>- le figure accanto alle emoji nel selettore dell'icona | T7, T8, T9, T10, T14, T15 |
| Telefono | - la testata tiene il nome, il bottone della modalità a voce bassa e «…»<br>- «Si scrive» sta in «…»<br>- la pillola tiene il nome della nota | T3, T4, T5, T7 |

## Lo standard delle barre

L'origine è la barra dei fogli, `apps/client/src/kit/ribbon/ribbon.ts`, che
oggi monta i prefissi `grid-ribbon` e `rich-ribbon`. Da lì nascono tre forme,
tutte scritte una volta nel proprietario.

| Forma | Classi | Chi la usa | Dove vive |
|---|---|---|---|
| barra a schede | `kit-ribbon`, `kit-ribbon-<parte>` | fogli, documenti | comportamento in `kit/ribbon/ribbon.ts`, forma in `theme/scrittoio/structure.css`, pelle in `theme/scrittoio/skin/kit.css` |
| barra in una fila | `kit-bar`, `kit-bar-group`, `kit-bar-button`, `kit-bar-field`; per il troppo `kit-options` e `kit-options-more` (`kit/options-bar.ts`) | barra di formato delle note, testa del disegno, PDF, lavagna | classi sul DOM che c'è, frecce in `kit/toolbar-keys.ts` (nuovo), forma e pelle come sopra |
| colonna | `kit-rail` (`kit/tool-rail.ts`) | colonna degli strumenti (disegno, lavagna) | `theme/scrittoio/skin/kit.css` |

- **Barra a schede:** è il vassoio un tono sotto la carta, coi foglietti che hanno un nome. I pulsanti sono alti 28, il velo d'accento segna ciò che è acceso, e i gruppi si raccolgono quando manca spazio. T20 fa emettere al kit `kit-ribbon-<parte>` accanto a `<prefisso>-<parte>`; ai fogli e ai documenti restano solo i pezzi loro (tavolozza, galleria, campioni, «Comandi», formula, schede).
- **Barra in una fila:** lo stesso vassoio e gli stessi pulsanti, su una riga. Ciò che non ci sta va in «…», oppure scorre di lato dove oggi scorre (la lavagna). Le frecce sono le stesse dappertutto: un solo punto di Tab per barra, frecce sinistra e destra, Home ed End.
- **Colonna:** la stessa pelle, in verticale.
- **Come la adotta un editor:** mette le classi sul DOM che ha già, toglie le sue regole di forma e di pelle che le duplicano, e tiene solo ciò che è suo.
- Nessun componente nuovo oltre `kit/toolbar-keys.ts`, nessuna IPC e nessun WIT.

## Le fasi

Sono le quattro fasi della bozza, allargate a tutti gli editor, con una fase
di prova in testa e la fase delle barre prima della chiusura.

| Fase | Task | Che cosa |
|---|---|---|
| 0 · I test che fissano oggi | T1 | menu delle modalità, banda, «Si scrive», frecce della barra di formato, briciole |
| 1 · La modalità dalla banda, la testata | T2, T3, T4, T5 | il menu in un posto solo, la voce «Live» della banda, «Si scrive» nella banda, la testata con le briciole |
| 2 · La pelle della cornice e del cassetto | T6, T7, T8, T9, T10 | linguette, pillola e pulsanti premuti, cassetto, ispettore, impostazioni e affini |
| 3 · La tipografia del foglio | T11 | 18/58, titoli, elenchi, link, citazione, richiamo |
| 4 · Le novità | T12, T13, T14, T15 | riga dei dati, «In entrata», figure, vault del banco |
| 5 · Lo standard delle barre | T16–T23 | kit-bar e kit-rail, barra di formato, PDF, Craft, kit-ribbon, barra del documento, testa del disegno, lavagna |
| 6 · Banco e chiusura | T24, T25, T26 | scene nuove, baseline dal runner, CI completa e rilettura |

## Come si incastra coi piani in corso

La base è `main` a `3f4f3731`. L'orchestratore fonde `main` nel ramo del piano
ogni volta che entra uno dei piani qui sotto.

| Piano | Stato (2026-11-04) | Che cosa aspetta che cosa | Chi si adatta, quando |
|---|---|---|---|
| caricamento (PR #308) | 0/4, coder di T1 al lavoro | - T3, T7 e T8 aspettano il suo T1 (`index.html`, `mobile.html`, `catalog.ts`)<br>- T5 aspetta il suo T2 (`desktop-shell.ts`)<br>- T11, T12, T13, T15 e T24 aspettano il suo T4 (`bench/fake-ipc.ts`, `bench/scene.mjs`)<br>- T17 aggiunge solo il parametro `?formatbar=1` a `bench/fake-ipc.ts`: non aspetta, e chi entra per secondo ribasa<br>- su `docs/architecture/frontend-and-ipc.md` (T11, T16, T17) basta stare nei propri pezzi | questo piano, dopo la sua fusione |
| N7 (PR #299) | 33/34 | T18 e T19 aspettano N7 in `main` (barra del PDF, scheda Craft, le loro scene) | questo piano, dopo la fusione |
| K2 (PR #290) | 7/7, non ancora in `main` | T10 aspetta K2 in `main` (impostazioni) | questo piano |
| K3 | 16/19 (T17, T19 da fare) | T20 e T21 aspettano K3 in `main`: porta `openInPlace` e cambia `kit/ribbon/` | questo piano |
| griglia | 0/8 (la sua PR va su `piano/k3-motori` finché K3 non è in `main`) | - T20 aspetta griglia in `main` (`skin/editors.css`, parte dei fogli)<br>- T24 aspetta il suo T8 (scene) | questo piano |
| A1 | 5/13 | - A1 T12 e T10 toccano le impostazioni: chi entra per secondo ribasa<br>- T24 aspetta A1 T13 (scene) | proposta per A1 T12 (sopra) |
| K5 | 8/30 | T22 segue il prototipo di K5 T25 se è approvato prima | proposta per K5 T25 (sopra) |
| N4 | 14/25 (T12–T17, T21–T25 aperti) | nessuna attesa; ognuno resta nei suoi pezzi di `structure.css` ed `editors.css` | — |
| N6 (PR #302) | 10/90 | - T23 aspetta N6 (motore e superficie della lavagna); se N6 non chiude in tempo, T23 diventa suo o un seguito<br>- T2 non tocca `document-controller.ts` per non incrociarlo | proposte per N6 T49–T52 (sopra) |
| n7, k3, griglia, A1 e caricamento sul banco | — | - T24 aspetta le scene di griglia T8, A1 T13, caricamento T4, K3 T17 e N7 T32<br>- `bench/scene.test.ts` vuole tutte le baseline o nessuna: T24 le toglie tutte e T25 le rimette dal runner, una volta, con tutte le scene dentro | T24, T25 |

Quando un'ondata aspetta un piano esterno, l'orchestratore può anticipare un
task dell'ondata dopo che non aspetta niente, purché i «Tocca» restino
disgiunti da quelli del task che gira.

## Come funziona (per tutti i task)

- **CSS dal prototipo:**
  - si copia dai blocchi `<style data-destinazione="…">` di `PLAN-ui/scrittoio-2.html`: ogni task dice quali righe;
  - si incolla in coda al file di destinazione o accanto alla regola che sostituisce, togliendo la regola vecchia quando quella nuova la rende inutile;
  - ogni classe nuova entra nei ganci del suo pezzo in `src/theme/scrittoio/anatomia/`;
  - solo i gettoni della serie `theme-2`, nessun colore scritto a mano.
- **Le icone del prototipo:**
  - `dots` è `more` della cornice (`shells/scrittoio/icons.ts`), che ha già anche `check`, `plus` e `star`: queste non si ridisegnano;
  - le altre vanno in `ui/icons.ts`, nella forma `nome: '<path …/>'` della mappa `SVG`.
- **Dopo ogni CSS**, da `apps/client/`:
  - `npm run theme:generate && npm run theme:verify`;
  - `npx vitest run src/theme/scrittoio`.
  - Una regola rifiutata dal sanificatore toglie lo stile a tutta l'app: lo prende `src/theme/gate.test.ts`.
  - I file generati (`skin.css`, `sheet-*.css`, `theme/author/*`) sono gli unici che due task della stessa ondata possono toccare entrambi; dopo ogni fusione l'orchestratore li rigenera.
- **La foto:**
  - con una sonda del banco (skill `banco`): un file a punto in `apps/client/bench/`, per esempio `bench/.probe-t5.mjs`, che usa `openStage()` e `openPage()`; le PNG vanno in `$TMPDIR`, mai nel repo, e la sonda si cancella alla fine;
  - si fotografano giorno e notte e, dove il prototipo ha lo stato stretto, 700×800, poi si confrontano con il prototipo aperto da file: `file://<worktree>/PLAN-ui/scrittoio-2.html?stato=<id>&luce=light` (o `luce=dark`, `larghezza=700`);
  - il banco ha una porta sola (1431), quindi due coder non lo usano insieme: se `ss -ltn | grep 1431` la trova occupata, si aspetta;
  - mentre gira il banco non si cambiano file sotto `apps/client`;
  - il report allega i percorsi delle foto e dice che cosa resta diverso e perché.
- **Le baseline:** nessun task tocca `apps/client/bench/baseline/` prima di T24, che le toglie tutte; T25 le rimette tutte dal runner. Mai `bench:update` in locale.
- **Le stringhe:** in `src/i18n/catalog.ts`, italiano e inglese nello stesso task; le stringhe dell'host stanno nel catalogo Rust della feature, in tutte e due le lingue.
- **Ogni ascoltatore** passa da `lifetime.listen` o ha il suo disposer (`check-listeners`).
- **La pagina di `docs/`** che descrive il comportamento cambia nello stesso task, e le guardie dei documenti restano verdi.
- **I file che altri piani toccano** (`structure.css`, `skin/editors.css`, `catalog.ts`, `bench/fake-ipc.ts`): si cambiano solo i pezzi del task, senza riordinare né riformattare il resto.
- **Gli stati del prototipo e le scene del banco più vicine:**
  - nota → `live-01-panoramica`, `explore`;
  - documento → `document-docx`;
  - sola-lettura → `document-readonly`;
  - foglio → `grid-workbook`;
  - disegno → `draw-open`;
  - impostazioni → `settings`;
  - componenti → `settings-components`;
  - ricerca → `search`;
  - grafo → `graph`;
  - icone → `menu-albero-cartella`;
  - vuoto → `empty`;
  - zero → `launcher-empty`;
  - tel-nota → `mobile-startup`;
  - tel-doc → `mobile-document`;
  - con K3 in `main`: tel-foglio → `mobile-grid-ribbon`; caricamento, errore e molti → `grid-result-loading`, `grid-result-error` e `grid-result-many`;
  - con N7 in `main`: craft → `craft-domanda`; pdf → `pdf-domanda`;
  - barra e lavagna non hanno ancora una scena: la sonda prepara lo stato da sé, e le scene le aggiunge T24.
  - Il cassetto sul telefono (`mobile-sheet`) non ha uno stato nel prototipo: prende le stesse regole del computer.

## Dal prototipo

Le righe sono quelle di `PLAN-ui/scrittoio-2.html` al momento della consegna.

| Pezzo | Destinazione | Task |
|---|---|---|
| ispettore a 264, schede in cima, righe degli elenchi (176–179, 188–211) | `apps/client/src/theme/scrittoio/structure.css` | T9 |
| la modalità fuori dalla testata sul computer (180–187) | `structure.css` | T3 |
| la banda stretta (212–224) | `structure.css` | T4 |
| la forma della barra a schede (225–505) | `structure.css` | T20 |
| la forma della barra in una fila (506–550) | `structure.css` | T16 |
| la galleria degli stili del documento (552–561) | `structure.css` | T21 |
| la pelle della barra a schede (564–922) | `theme/scrittoio/skin/kit.css` | T20 |
| la pelle della fila e della colonna (923–1075) | `skin/kit.css` | T16 |
| il pulsante premuto e la pillola (1078–1123) | `skin/frame.css` | T7 |
| l'ispettore (1124–1171) | `skin/frame.css` | T9 |
| la modalità nella banda (1172–1198) | `skin/frame.css` | T3 |
| «Si scrive» nella banda (1199–1218) | `skin/frame.css` | T4 |
| spazi, titolo del cassetto, etichette di sezione (1221–1360) | `skin/drawers.css` | T8 |
| il selettore dell'icona (1361–1404) | `skin/drawers.css` | T14 |
| filtro, righe, conti, gallone (1406–1476) | `skin/tree.css` | T8 |
| la testata del foglio (1479–1527) | `skin/sheets.css` | T5 |
| linguette e scrivania (1528–1554) | `skin/sheets.css` | T6 |
| titoli, elenchi, link, citazione, richiamo (1557–1681) | `skin/document.css` | T11 |
| la riga dei dati (1682–1723) | `skin/document.css` | T12 |
| il PDF e il contatore delle diapositive (1726–1772) | `skin/media.css` | T18 |
| i file Craft (1773–1831) | `skin/media.css` | T19 |
| la struttura e le sezioni delle viste (1834–1877, 1938–1948) | `skin/nodes.css` | T9 |
| «In entrata» e l'icona della voce (1878–1937) | `skin/nodes.css` | T13 |
| grafo, menu, avvio rapido (1949–1981) | `skin/graph.css`, `skin/menus.css`, `skin/launcher.css` | T10 |
| «Salvato» con la spunta (1982–2006) | `skin/centres.css` | T5 |
| impostazioni e benvenuto (2007–2043) | `skin/settings.css`, `skin/welcome.css` | T10 |
| telefono: la testata (2046–2057) | `apps/client/src/shells/scrittoio/mobile/mobile.css` | T5 |
| telefono: il bottone della modalità (2058–2076) | `mobile.css` | T3 |
| telefono: «Si scrive» (2077–2081) | `mobile.css` | T4 |
| telefono: la pastiglia H1 nascosta (2082–2089) | `mobile.css` | T11 |
| 18 px e 58 caratteri (2090–2100) | `theme/scrittoio/series.ts`, `recipe.ts`, `state/zoom.ts`, `crates/fub-host/src/settings.rs` | T11 |
| variante `menu-b` (2101–2135), solo se scelta | `skin/menus.css` | T10 |
| variante `titolo-500` (2136–2144), solo se scelta | `skin/document.css` | T11 |
| icone delle modalità e del cassetto (2146–2157) | `apps/client/src/ui/icons.ts` | T2 |
| figure monocrome (2158–2170) | `ui/icons.ts` | T14 |
| testi nuovi | `apps/client/src/i18n/catalog.ts` | T5, T7, T8, T9, T12, T14, T18 |
| gli stati da fotografare | `apps/client/bench/scene.mjs` | T24 |

## T1 · I test che fissano il comportamento di oggi

Perché: le fasi 1–5 spostano la modalità, «Si scrive», la testata e le frecce della barra di formato, e prima di toccarli servono test che dicano che cosa non deve cambiare.
Tocca: `apps/client/src/panels/document.test.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/panels/standing.test.ts`, `apps/client/src/panels/format-bar.test.ts`, `apps/client/src/shell.e2e.test.ts`
Non toccare: nessun file di produzione; `apps/client/bench/baseline/`; i test che ci sono già si allargano, non si riscrivono.
Dipende da: nessuno
Cosa fare:
- `document.test.ts`, il menu della modalità:
  - il clic su `.pane-mode-current` elenca le modalità della superficie e ne segna una sola (`checked`);
  - la voce scelta cambia la modalità del riquadro a fuoco e non quella dell'altro;
  - l'ordine delle voci non si fissa, perché T2 lo cambia.
- `document.test.ts`, la testata: le briciole (le cartelle con `data-folder`, poi il nome) e il menu «…» con le voci di oggi, per nome.
- `status-band.test.ts`: con due riquadri la banda dice la modalità di quello a fuoco, e cambia quando il fuoco passa all'altro; con una modalità sola `#status-mode` resta nascosto.
- `standing.test.ts`: i quattro tipi (`writes`, `closed`, `body`, `readonly`) danno il loro testo e il loro `data-standing`; `follow(null)` nasconde il chip.
- `format-bar.test.ts`: un solo punto di Tab per la barra; ← e → passano al pulsante vicino, Home e Fine al primo e all'ultimo, e i pulsanti spenti si saltano.
- `shell.e2e.test.ts`: con due riquadri aperti, `shell.mode.source` cambia solo quello a fuoco.
- Ogni test nuovo si vede rosso rompendo a mano la riga di produzione che fissa, poi la riga torna com'era; il report dice quale riga.
Dal prototipo: niente, il task non è grafico.
Casi limite: una superficie con una modalità sola (un'immagine); un riquadro senza documento; il fuoco su un riquadro vuoto; un documento in sola lettura.
Fatto quando: i test nuovi passano su `main` senza cambiare la produzione (`git diff --stat` elenca solo i cinque file di test), e ognuno è stato visto rosso.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · Il menu delle modalità, in un posto solo

Perché: la banda, la testata del telefono e il comando devono aprire lo stesso menu, con lo stesso ordine, le stesse icone e le scorciatoie vere della persona.
Tocca: `apps/client/src/state/mode-menu.ts` (nuovo), `apps/client/src/state/mode-menu.test.ts` (nuovo), `apps/client/src/editors/core/registry.ts`, `apps/client/src/editors/text/profiles/markdown/surface.ts`, `apps/client/src/editors/text/profiles/svg.ts`, `apps/client/src/editors/rich/surface.ts`, `apps/client/src/ui/icons.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/panels/document.test.ts`, `apps/client/src/shell.e2e.test.ts`, `docs/architecture/editor-surfaces.md`
Non toccare: `apps/client/src/state/document-controller.ts` (lo cambia N6: `selectedMode` e `setMode` si usano come sono); `apps/client/src/ui/menu.ts`; `apps/client/src/editors/spatial/modes.ts`; `apps/client/src/editors/canvas/surface.ts` (T23); `apps/client/src/editors/text/profiles/markdown/hints.ts`; `apps/client/src/shells/scrittoio/icons.ts`; `apps/client/src/ui/shell-keys.generated.ts`.
Dipende da: T1
Cosa fare:
- `SurfaceMode` (`registry.ts`) prende `icon?: string`, un nome che `icon()` di `ui/icons.ts` sa disegnare.
  - Senza icona vale quella del ruolo: `live_preview` → `pen`, `source` → `code`, `reading` → `eye`.
  - Le icone esplicite:
    - Blocchi `blocks` (`markdown/surface.ts`);
    - Diviso dell'SVG `split` (`svg.ts`);
    - Pagina, Scrittura e Lettura del documento `rc-mode-page`, `rc-mode-writing` e `rc-mode-reading` (`rich/surface.ts`), che `rich/icons.ts` registra già.
- In `ui/icons.ts`, in un pezzo solo in coda alla mappa `SVG`, vanno `pen`, `blocks`, `code`, `eye`, `compose`, `sort`, `clock` e `chevron-up`, copiate dal prototipo. `compose` e `sort` servono a T8, `clock` a T12.
- `state/mode-menu.ts` esporta `modeMenuItems(paneId): MenuItem[]` e `openModeMenu(anchor, paneId, { onClose? })`.
  - L'ordine: prima le modalità `live_preview` nell'ordine dichiarato, poi `source`, poi un separatore e la `reading`. Senza lettura, niente separatore.
  - Ogni voce porta `icon`, `choice: "radio"`, `run: () => void setMode(mode.id)`, e la corrente ha sia `checked` sia `selected`.
  - `hint` è la scorciatoia del comando che porta lì, letta da `allCommands()` (`ui/commands.ts`, che rispetta le scorciatoie cambiate dalla persona) e scritta con `displayBinding`:
    - Blocchi → `shell.mode.blocks`;
    - Lettura → `shell.mode.reading`;
    - Sorgente → `shell.mode.source`;
    - la prima `live_preview` che non è Blocchi → `shell.mode.live`;
    - un comando senza tasto lascia la voce senza `hint`.
  - `openModeMenu` porta il fuoco al riquadro (`focusPane`), mette `aria-expanded="true"` sull'ancora, apre `showContextMenu(anchor, items, { onClose })` e rimette `aria-expanded="false"` alla chiusura.
- In `panels/document.ts` il clic su `.pane-mode-current` (intorno alle righe 1037–1052) chiama `openModeMenu` e non costruisce più le voci da sé.
- `shell.e2e.test.ts` (intorno alle righe 3626–3644): l'ordine diventa Live, Blocchi, Sorgente, Lettura.
- `docs/architecture/editor-surfaces.md` dice di `icon` e dell'ordine del menu.
Dal prototipo: le icone delle modalità e del cassetto (righe 2146–2157, in `ui/icons.ts`); il menu aperto dello stato `nota` per l'ordine, le icone e le scorciatoie.
Casi limite:
- una superficie con una modalità sola: nessun menu;
- la tela: Lavagna e Sorgente, senza separatore;
- il disegno: Disegno (o Annota), il separatore e Lettura;
- un comando senza tasto: niente `hint`;
- una scorciatoia cambiata dalla persona: compare quella;
- un'icona sconosciuta: vale quella del ruolo;
- il riquadro chiuso mentre il menu è aperto: la voce non fa niente e non lancia;
- in inglese, le etichette delle modalità vengono già dal catalogo.
Fatto quando:
- `mode-menu.test.ts` fissa l'ordine per Markdown, SVG, documento e disegno, le icone, gli `hint` (anche quello cambiato) e `setMode` sul riquadro giusto;
- i test di T1 restano verdi (tranne l'ordine, che qui cambia apposta) e l'e2e vede Live, Blocchi, Sorgente, Lettura.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T3 · La modalità si sceglie dalla banda

Perché: nel mockup la modalità sta in basso a destra («✎ Live ⌃»), e la testata del foglio resta pulita.
Tocca: `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/shells/scrittoio/frame/status-band.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `apps/client/src/surface-modes.e2e.test.ts`, `docs/product/editor-and-preview.md`
Non toccare: `apps/client/src/state/mode-menu.ts` (si usa com'è); `apps/client/src/panels/document.ts` (il bottone della testata resta nel DOM, il telefono lo usa); i comandi `shell.mode.*`; i bottoni `#status-fit-width`, `#status-fit-page` e `#status-zoom`.
Dipende da: T1, T2
Cosa fare:
- In `index.html` e `mobile.html` `#status-mode` diventa `<button type="button" id="status-mode" class="status-item status-item--button status-mode" aria-haspopup="menu" aria-expanded="false" hidden>`, nello stesso posto dentro `#status-end`.
- `status-band.ts` lo riempie col riquadro a fuoco:
  - l'icona della modalità (quella di T2), poi `span.status-mode-name` col nome, poi `span.status-mode-arrow` con `chevron-up` e `aria-hidden`;
  - `aria-label` da `t("document.toolbar.mode_current", { mode })`;
  - resta nascosto se la superficie a fuoco ha una modalità sola o se non c'è un documento.
- Clic, Invio, Spazio e ↑ chiamano `openModeMenu(button, focusedPaneId)`. Gli ascoltatori passano da `lifetime.listen`. Alla chiusura il fuoco torna al bottone.
- `structure.css`: sul computer la testata non mostra più `.pane-toolbar > .segmented` né `.pane-mode-current` (righe 180–187 del prototipo). Con D1 = B la regola vale solo con un riquadro solo.
- `mobile.css`: sul telefono la testata tiene il suo bottone della modalità, a voce bassa (righe 2058–2076).
- `surface-modes.e2e.test.ts`: sul computer la modalità si cambia da `#status-mode`.
- `docs/product/editor-and-preview.md`, sezione «Modalità»: il commutatore è la voce della banda per il riquadro a fuoco, e sul telefono il bottone della testata.
Dal prototipo: `structure.css` 180–187; `skin/frame.css` 1172–1198; `mobile.css` 2058–2076; gli stati `nota` (il menu aperto) e `documento` (la banda dice «Pagina»).
Casi limite:
- nessun documento aperto (il benvenuto): il bottone è nascosto;
- un'immagine o un PDF (una modalità sola): nascosto;
- due riquadri: il nome segue il fuoco;
- il riquadro si chiude col menu aperto: il menu si chiude;
- Esc chiude e il fuoco torna al bottone;
- il nome lungo in inglese («Live preview»);
- la finestra a 700 px;
- il menu vicino al bordo basso si apre verso l'alto.
Fatto quando:
- `status-band.test.ts` vede il nome e l'icona del riquadro a fuoco, il menu che si apre col bottone e `setMode` sul riquadro giusto;
- l'e2e passa;
- la foto del banco di `live-01-panoramica`, in giorno e notte, a 1280 e a 700, col menu chiuso e aperto, sta accanto a `?stato=nota`, e quella di `document-docx` accanto a `?stato=documento`; la testata non ha più il bottone della modalità.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T4 · «Si scrive» nella banda

Perché: «Si scrive» è lo stato normale di un documento, e nel mockup lo dice la banda a voce bassa invece di un chip in testata; gli stati che chiedono attenzione restano in testata.
Tocca: `apps/client/src/shells/scrittoio/frame/status-band.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/panels/standing.ts`, `apps/client/src/panels/standing.test.ts`, `apps/client/src/state/store.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `docs/product/editor-and-preview.md`, `docs/architecture/editor-surfaces.md`, `docs/product/word-documents.md`
Non toccare: `SurfaceStandingKind` e il suo testo (`editors/core/registry.ts`); i tipi `closed`, `body` e `readonly`, che restano nel chip della testata; `index.html` (il bottone nasce in JS).
Dipende da: T1, T3
Cosa fare:
- `status-band.ts` crea in JS `#status-standing` come `button.status-item.status-item--button.status-standing[data-surface-item="standing"]`, subito prima di `#status-mode`.
  - Segue `paneOf(layout.focus)?.surface?.standing` e si vede solo col tipo `writes`.
  - Il testo è quello del chip di oggi.
- Il clic apre la stessa spiegazione del chip:
  - `standing.ts` prende `openFrom(anchor)`, usato dal chip e dalla banda;
  - la banda emette il segnale nuovo `standing-open` dello store, con l'ancora come argomento, e `document.ts` lo ascolta e apre la spiegazione del riquadro a fuoco.
- `structure.css`:
  - sul computer la testata nasconde `.pane-standing[data-standing="writes"]`;
  - sotto gli 800 px la banda nasconde `[data-surface-item="language"]` (righe 212–224 del prototipo).
- Telefono:
  - `mobile.css` nasconde il chip `writes` (righe 2077–2081);
  - il menu «…» della testata prende in cima la voce «Si scrive», che apre la stessa spiegazione;
  - gli altri tipi restano dove sono.
- Le pagine di `docs/`:
  - `docs/product/word-documents.md`, il paragrafo del chip: «Si scrive» lo dice la banda;
  - `docs/product/editor-and-preview.md`;
  - `docs/architecture/editor-surfaces.md`, la parte sullo stato della superficie.
Dal prototipo: `structure.css` 212–224; `skin/frame.css` 1199–1218; `mobile.css` 2077–2081; gli stati `documento`, `sola-lettura` e `tel-doc`.
Casi limite:
- il tipo cambia con la spiegazione aperta (il file diventa di sola lettura): la banda si spegne, la spiegazione si chiude e il chip compare in testata;
- due riquadri con tipi diversi: la banda segue il fuoco;
- il fuoco passa a un riquadro vuoto;
- a 700 px la lingua sparisce, «Si scrive» e la modalità restano;
- ogni tipo ha il suo nome per il lettore di schermo.
Fatto quando:
- `status-band.test.ts` e `standing.test.ts` vedono `writes` nella banda e non in testata, gli altri tipi in testata, e la stessa spiegazione aperta dai due posti;
- la foto di `document-docx` e `document-readonly`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=documento` e `?stato=sola-lettura`;
- quella di `mobile-document` sta accanto a `?stato=tel-doc`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T5 · La testata: dove sei, se è salvato, «…»

Perché: oggi la testata porta il formato, la modalità e lo stato in quattro tasti; il mockup vuole solo il percorso, «✓ Salvato» e «…».
Tocca: `apps/client/src/panels/document.ts`, `apps/client/src/state/store.ts`, `apps/client/src/desktop-shell.ts`, `apps/client/src/shells/scrittoio/sheets/title-rename.ts`, `apps/client/src/shells/scrittoio/sheets/title-rename.test.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/skin/centres.css`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`, `apps/client/src/theme/scrittoio/anatomia/centres.ts`, `apps/client/src/shell.e2e.test.ts`, `docs/product/editor-and-preview.md`
Non toccare: `apps/client/src/shells/scrittoio/sheets/save-state.ts` (cambia solo la sua pelle); `apps/client/src/shells/scrittoio/frame/vault-chip.ts`; la rinomina in sé (stesse regole, stessi errori).
Dipende da: T2
Cosa fare:
- `drawCrumbs` (`document.ts`, intorno alla riga 976):
  - in testa la figura della cartella e il nome del vault, poi le cartelle, poi il nome della nota in `span.crumb-name`;
  - fra i pezzi uno `span.crumb-sep` con `aria-hidden`, al posto della «/» scritta;
  - le cartelle tengono `data-folder` e quello che fanno oggi, e la briciola del vault ha `data-folder=""`;
  - il nome del vault oggi è una variabile di `desktop-shell.ts`: entra nello store (`state.vaultName` e il segnale `vault-name`, nuovi), scritto da `showVaultName` (intorno alla riga 693) sia subito sia quando arriva il nome scelto dalla persona, e la testata si ridisegna al segnale.
- `title-rename.ts` trova il nome da rinominare in `.crumb-name` e non più nell'ultimo testo delle briciole.
- `.pane-format` esce dalla testata. Il formato lo dice la linguetta: `paintTab` (intorno alla riga 900) mette in testa `svg.tab-format` con la figura del formato e il nome del formato nell'`aria-label` della linguetta. La chiave nuova del catalogo va in italiano e in inglese.
- «…» (`[data-pane-menu]`) disegna l'icona `more`, non tre caratteri, con l'`aria-label` di oggi.
- `skin/centres.css`: `.save-state` prende la spunta del prototipo.
- `shell.e2e.test.ts` (intorno alle righe 612–631): le attese sulla testata si riscrivono per briciole, «Salvato» e «…».
- `docs/product/editor-and-preview.md`: com'è fatta la testata, e che il formato sta nella linguetta.
Dal prototipo: `skin/sheets.css` 1479–1527; `skin/centres.css` 1982–2006; `mobile.css` 2046–2057; gli stati `nota`, `documento` e `tel-nota`.
Casi limite:
- una nota alla radice: solo il vault e il nome;
- un percorso lunghissimo: le cartelle si stringono, il nome resta intero;
- un nome lunghissimo: ellissi, col nome intero nel tooltip;
- un vault senza nome (si usa il nome della cartella);
- un riquadro senza documento;
- la rinomina che fallisce: l'errore di oggi;
- «Salvato», «Salvataggio…» ed «Errore» in giorno e notte;
- in inglese.
Fatto quando:
- `title-rename.test.ts` e i test della testata passano con le briciole nuove;
- l'e2e passa;
- la foto di `live-01-panoramica` e `document-docx`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota` e `?stato=documento`;
- quella di `mobile-startup` sta accanto a `?stato=tel-nota`;
- la testata ha solo briciole, «Salvato» e «…».
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T6 · Le linguette e la scrivania

Perché: le linguette del mockup sono foglietti tenui con la figura del formato, e quella scelta si stacca appena; l'etichetta della scrivania parla a voce bassa.
Tocca: `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`
Non toccare: `apps/client/src/shells/scrittoio/sheets/tab-strip.ts` e `apps/client/src/shells/scrittoio/sheets/desk.ts` (solo pelle); le regole della testata che T5 ha messo nello stesso file.
Dipende da: T5
Cosa fare:
- Copiare le righe 1528–1554 del prototipo in `skin/sheets.css`, accanto alle regole di `.tab` e `.sheet-desk-label` che sostituiscono, togliendo quelle che diventano inutili.
- `.tab-format` entra nei ganci di `anatomia/sheets.ts`.
Dal prototipo: `skin/sheets.css` 1528–1554; gli stati `nota` e `documento`.
Casi limite: molte linguette (la scena `tabs`); un nome lunghissimo; una linguetta senza figura di formato; la linguetta trascinata; il fuoco da tastiera; il contrasto alto.
Fatto quando: la foto di `live-01-panoramica`, `tabs` e `desk`, in giorno e notte, sta accanto a `?stato=nota` e `?stato=documento` (le linguette e l'etichetta della scrivania), e `npx vitest run src/theme/scrittoio` passa.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T7 · La pillola e i pulsanti premuti

Perché: sul computer il nome della nota sta già nella testata, quindi la pillola può essere sempre il campo dei comandi; e un pulsante premuto deve sembrare un foglietto sollevato, non una macchia blu.
Tocca: `apps/client/src/i18n/catalog.ts`, `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/shells/scrittoio/frame/pill.ts`, `apps/client/src/shells/scrittoio/frame/pill.test.ts`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`
Non toccare: il lanciatore (`apps/client/src/shells/scrittoio/launcher/`); il comando che apre la pillola e la sua scorciatoia.
Dipende da: nessuno
Cosa fare:
- Il catalogo, in italiano e in inglese:
  - `frame.pill` diventa «Cerca o esegui un comando» («Search or run a command»);
  - `frame.pill.empty` diventa «Cerca o esegui un comando…»;
  - `frame.pill.at` resta per il telefono.
- In `index.html`:
  - la pillola prende `data-pill="command"`;
  - il testo scritto di `#pill-title` e l'`aria-label` diventano quelli nuovi.
- In `mobile.html` cambia solo il testo scritto.
- `pill.ts`: con `data-pill="command"` la pillola non scrive più la cartella né il nome, e dice sempre `frame.pill.empty`, con l'etichetta `frame.pill`. Senza l'attributo (il telefono) fa quello che fa oggi.
- `pill.test.ts`, intorno alla riga 57: il computer dice sempre il campo dei comandi, il telefono il nome.
- `skin/frame.css`: il pulsante premuto della barra del titolo e del binario (righe 1078–1096) e la pillola (righe 1097–1123).
- `docs/`: nessuna pagina cita il testo della pillola (cercato con `grep`), quindi niente da cambiare.
Dal prototipo: `skin/frame.css` 1078–1123; gli stati `nota`, `vuoto` e `tel-nota`.
Casi limite:
- nessun documento aperto;
- la scorciatoia cambiata dalla persona: il `kbd` la segue;
- in inglese il testo è più lungo, e la pillola stretta a 700 px lo taglia con l'ellissi;
- il lettore di schermo legge l'etichetta;
- il pulsante premuto col fuoco da tastiera;
- il contrasto alto.
Fatto quando:
- `pill.test.ts` passa per il computer e per il telefono;
- la foto di `live-01-panoramica` ed `empty`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota` e `?stato=vuoto`: la pillola dice «Cerca o esegui un comando» e il pulsante del binario premuto è un foglietto.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T8 · Il cassetto

Perché: il cassetto del mockup è quieto: «Note» con «ordina» e «nuova nota» a icona, il filtro pieno con la lente, le sezioni in tondo, i conteggi e il gallone sottile.
Tocca: `apps/client/src/panels/explorer.ts`, `apps/client/src/panels/explorer-filter.ts`, `apps/client/src/panels/explorer-filter.test.ts`, `apps/client/src/panels/explorer.dom.test.ts` (nuovo), `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/theme/scrittoio/skin/drawers.css`, `apps/client/src/theme/scrittoio/skin/tree.css`, `apps/client/src/theme/scrittoio/anatomia/drawers.ts`, `apps/client/src/theme/scrittoio/anatomia/tree.ts`, `apps/client/src/i18n/catalog.ts`, `docs/product/explorer-and-folders.md`
Non toccare: l'ordinamento (`sortContent`, `setSort`, `EXPLORER_SORTS`), che resta com'è; i comandi `shell.explorer.*`; le icone scelte dalla persona (T14).
Dipende da: T2
Cosa fare:
- In `index.html` e `mobile.html`, dentro `#files-title`:
  - `#new-note` diventa un bottone a icona (`compose`), con `aria-label` e tooltip da `explorer.new.hint`;
  - prima di `#new-note` c'è un bottone a icona (`sort`) con `aria-label` `explorer.sort` e `aria-haspopup="menu"`.
- Il bottone `sort` apre le stesse voci a radio del menu della radice: si fattorizzano in una funzione sola, usata dai due menu.
- Sopra l'albero c'è un `.panel-title` «Tutte le note», con `.panel-count` che dice il totale dei documenti del vault o dello spazio che si vede (`vaultEntries(...).total`). Il catalogo prende `explorer.all`, in italiano e in inglese.
- Ogni cartella dell'albero prende `.row-count` col numero delle sue voci dirette (`VaultFolder.entries`); lo zero non si scrive, e il numero non entra nel nome accessibile della riga.
- `explorer-filter.ts`: il filtro mostra la lente dentro il campo pieno. Il comportamento non cambia.
- `explorer.dom.test.ts`: i conteggi (anche lo zero), «Tutte le note N», il menu dell'ordinamento che cambia `state.explorerSort`.
- `docs/product/explorer-and-folders.md`: i conteggi e il bottone dell'ordinamento.
Dal prototipo: `skin/drawers.css` 1221–1360; `skin/tree.css` 1406–1476; gli stati `nota` e `ricerca`.
Casi limite:
- un vault senza note: «Tutte le note» senza numero;
- una cartella vuota: niente numero;
- mille voci: il numero si scrive com'è;
- uno spazio attivo: il totale è quello dello spazio;
- il filtro attivo: i conteggi restano quelli veri, non quelli filtrati;
- un nome lunghissimo con il numero;
- un vault in sola lettura: «nuova nota» spenta come oggi;
- il telefono.
Fatto quando:
- `explorer.dom.test.ts` passa;
- la foto di `live-01-panoramica`, `explore` e `search`, in giorno e notte, sta accanto a `?stato=nota` e `?stato=ricerca`;
- quella di `mobile-sheet` (il cassetto sul telefono, che il prototipo non ha) prende le stesse regole e non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T9 · L'ispettore

Perché: nel mockup l'ispettore è stretto come il cassetto, le schede stanno in cima in un pozzetto, e «● Segue la nota» dice a voce bassa a che cosa è legato.
Tocca: `apps/client/src/ui/node.ts`, `apps/client/src/ui/node.test.ts`, `apps/client/src/ui/views.ts`, `apps/client/src/ui/views.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/measures.ts`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/skin/nodes.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/theme/scrittoio/anatomia/nodes.ts`, `apps/client/src/i18n/catalog.ts`
Non toccare: i limiti del divisore (`SHELL_WIDTH_LIMITS` in `state/shell-geometry.ts`, 248–440); la larghezza che la persona ha già trascinato, che resta sua; i provider delle viste in Rust; `UiNode` e il suo mirror.
Dipende da: T4
Cosa fare:
- La larghezza:
  - `--inspector-w` passa da 300 a 264 **sulla riga che c'è**, nel primo blocco `:root` di `structure.css` (riga 48), e non in un `:root` nuovo in coda;
  - in `measures.ts` la riga diventa `["inspector-w", 264, 216]`, come il cassetto. `measures.test.ts` legge il primo `:root` e vuole il passo 0 uguale alla struttura: un `:root` aggiunto in coda lo lascerebbe verde con la larghezza vera diversa, e al passo 1 l'ispettore tornerebbe largo.
- `structure.css`: `.inspector-tabs` sale in cima (`order: -1`) e le regole di `.ui-list-item`, `.ui-tree-label` e `.ui-tree-label > span` (righe 188–211 del prototipo) entrano accanto alle regole dell'albero.
- `ui/node.ts` toglie gli stili in linea di quelle tre righe, sia dove la riga nasce sia dove si riusa (intorno alle righe 378–390, 762–770 e 886–900): ora li scrive la struttura, e la pelle li può cambiare. `node.test.ts` controlla che non ci sia più l'attributo `style`.
- `ui/views.ts`, `drawFollows`: col documento la riga dice «Segue la nota» (chiave nuova `inspector.follows_doc`, «Follows the note» in inglese), e il nome della nota va nel tooltip con il testo di oggi (`inspector.follows`). Senza documento resta `inspector.follows_none`. `views.test.ts` lo controlla.
- La pelle: `skin/frame.css` righe 1124–1171 (le schede in pozzetto, il titolo, il punto blu); `skin/nodes.css` righe 1834–1877 e 1938–1948 (la struttura col filo e la tacca blu, le sezioni in tondo).
- `docs/`: nessuna pagina dice la larghezza dell'ispettore o «Segue:» (cercato con `grep`), e i limiti del divisore non cambiano: niente da cambiare.
Dal prototipo: `structure.css` 176–179 e 188–211; `skin/frame.css` 1124–1171; `skin/nodes.css` 1834–1877 e 1938–1948; lo stato `nota` (l'ispettore sulla Struttura).
Casi limite:
- la persona ha già una larghezza salvata: resta quella;
- lo spazio dell'interfaccia al passo 4: 216, mai sotto `--inspector-min`;
- un titolo di vista lungo con «Segue la nota»: si accorcia «Segue…», il titolo no;
- una vista che non segue il documento: la riga è nascosta;
- nessuna nota aperta;
- una riga d'albero lunghissima: l'ellissi resta;
- la densità compatta: le righe non scendono sotto i 28 px;
- il telefono (`mobile-inspector`).
Fatto quando:
- `node.test.ts`, `views.test.ts` e `measures.test.ts` passano;
- la foto di `inspector` e `live-01-panoramica`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`;
- quella di `mobile-inspector` non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T10 · Impostazioni, componenti, avvio rapido, grafo, benvenuto e menu

Perché: le etichette in maiuscoletto spaziato sono l'ultimo resto della pelle vecchia; il mockup le scrive come si scrive, e il posto dove si è nell'indice delle impostazioni è un foglietto sollevato.
Tocca: `apps/client/src/theme/scrittoio/skin/settings.css`, `apps/client/src/theme/scrittoio/skin/graph.css`, `apps/client/src/theme/scrittoio/skin/launcher.css`, `apps/client/src/theme/scrittoio/skin/welcome.css`, `apps/client/src/theme/scrittoio/skin/menus.css`, `apps/client/src/theme/scrittoio/anatomia/settings.ts`, `apps/client/src/theme/scrittoio/anatomia/graph.ts`, `apps/client/src/theme/scrittoio/anatomia/launcher.ts`, `apps/client/src/theme/scrittoio/anatomia/welcome.ts`, `apps/client/src/theme/scrittoio/anatomia/menus.ts`
Non toccare: il DOM delle impostazioni e dei componenti (`apps/client/src/panels/settings*.ts`), che K2 e A1 cambiano; i segmenti delle impostazioni, che restano il velo d'accento.
Dipende da: nessuno (aspetta K2 in `main`)
Cosa fare:
- Copiare i blocchi del prototipo nei loro file: `skin/graph.css` (righe 1949–1959), `skin/menus.css` (1960–1971), `skin/launcher.css` (1972–1981), `skin/settings.css` (2007–2033), `skin/welcome.css` (2034–2043).
- Togliere le regole vecchie che mettono maiuscolo e spaziatura sulle stesse etichette, invece di scavalcarle.
- Ogni classe dei blocchi è già un gancio del suo pezzo; se una manca, entra nell'anatomia.
- Se l'utente sceglie il menu B («da decidere guardando»), il blocco `data-variante="menu-b"` (righe 2101–2135) va in `skin/menus.css` in questo task.
- `docs/`: nessuna pagina descrive queste etichette.
Dal prototipo: le righe sopra; gli stati `impostazioni`, `componenti`, `grafo`, `zero` e `vuoto` (il benvenuto con «Vault recenti»).
Casi limite: un'etichetta lunga in inglese; il contrasto alto; la densità compatta; le impostazioni a 700 px; i menu del tasto destro con un'intestazione; il pannello «/» con l'anteprima.
Fatto quando: la foto di `settings`, `settings-components`, `graph`, `launcher-search`, `launcher-empty`, `menu` ed `empty`, in giorno e notte, sta accanto a `?stato=impostazioni`, `?stato=componenti`, `?stato=grafo`, `?stato=zero` e `?stato=vuoto`, e nessuna etichetta è più in maiuscolo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T11 · La tipografia del foglio

Perché: il mockup legge a 18 px su righe da 58 caratteri, con titoli pieni, punti in grafite, link a metà forza e citazione e richiamo neutri.
Tocca: `apps/client/src/theme/scrittoio/series.ts`, `apps/client/src/state/zoom.ts`, `apps/client/src/theme/preferences.test.ts`, `apps/client/src/theme/typography.test.ts`, `apps/client/src/state/zoom.dom.test.ts`, `apps/client/src/theme/scrittoio/recipe.ts`, `apps/client/bench/fake-ipc.ts`, `crates/fub-host/src/settings.rs`, `apps/client/src/theme/scrittoio/skin/document.css`, `apps/client/src/theme/scrittoio/anatomia/document.ts`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `docs/architecture/frontend-and-ipc.md`
Non toccare: gli altri gettoni di `recipe.ts` (la tavolozza resta com'è: cambiano solo `--text-reading` e `--content-width`); `crates/fub-host/src/legacy_tests/switches.rs` (si fa girare, non si cambia); `obsidian_import.rs`; l'ADR 0208, che resta com'è; i valori che la persona ha già scelto in Aspetto.
Dipende da: nessuno
Cosa fare:
- I predefiniti, uguali in TS e in Rust:
  - `series.ts` (righe 64–67): corpo 17 → 18, giustezza 68 → 58;
  - `state/zoom.ts` (riga 33): `TEXT_SIZE.fallback` 17 → 18;
  - `settings.rs` (righe 970 e 983): `APPEARANCE_BODY` 17.0 → 18.0 e `APPEARANCE_MEASURE` 68.0 → 58.0, con gli stessi limiti;
  - `recipe.ts` (righe 536 e 544): `text-reading` 17px → 18px e `content-width` 68ch → 58ch, poi `npm run theme:generate`;
  - `bench/fake-ipc.ts` (intorno alle righe 489, 492, 515 e 518): gli stessi predefiniti.
- I test che li dicono: `preferences.test.ts` (riga 31), `typography.test.ts`, `zoom.dom.test.ts` (righe 35 e 46).
- `skin/document.css`: le righe 1557–1681 del prototipo (titolo 2,22 em e H2 1,39 em, pieni; i punti degli elenchi in grafite; il filo dei link a metà forza; citazione e richiamo neutri). Le classi nuove (`cm-fub-bullet`, `cm-fub-bullet-task`) entrano in `anatomia/document.ts`.
- `mobile.css`: le righe 2082–2089 (sul telefono la pastiglia `H1` non si vede).
- Se l'utente sceglie il titolo a 500 («da decidere guardando»), il blocco `data-variante="titolo-500"` (righe 2136–2144) va in `skin/document.css` in questo task.
- `docs/architecture/frontend-and-ipc.md`, il paragrafo sui predefiniti dell'aspetto (intorno alla riga 249): corpo 18 px e giustezza 58 caratteri. `docs/product/editor-and-preview.md` (riga 53) resta vera così com'è.
Dal prototipo: `skin/document.css` 1557–1681; `mobile.css` 2082–2089; il blocco `series.ts` 2090–2100; gli stati `nota` e `tel-nota`.
Casi limite:
- chi ha scelto 17 o 68 in Aspetto: tiene il suo valore (è una scelta salvata, non il predefinito);
- lo zoom del testo ai capi (12 e 28);
- la Lettura e i Blocchi, che usano la stessa misura;
- un titolo lunghissimo su due righe;
- gli elenchi annidati e le liste di compiti;
- un link dentro una citazione;
- il contrasto alto;
- il telefono.
Fatto quando:
- i test TS e `cargo test -p fub-host` passano, compreso il confronto fra i predefiniti di TS e di Rust;
- `npm run theme:verify` rigenera i fogli uguali al byte;
- la foto di `live-01-panoramica`, `reading` e `nota-tre-modi`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`: gli a capo del primo paragrafo sono quelli del prototipo.
Prova: scripts/check.sh --rapido, e `cargo test -p fub-host`
Stato: [ ] da fare

## T12 · La riga dei dati sotto il titolo

Perché: «Modificata 2 ore fa · 3 collegamenti · #tema #banco» dice in una riga quanto è fresca la nota, chi la cita e di che cosa parla, senza aprire l'ispettore.
Tocca: `apps/client/src/state/note-facts.ts` (nuovo), `apps/client/src/state/note-facts.test.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/note-facts.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/note-facts.test.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/profile.ts`, `apps/client/src/editors/text/profiles/markdown/surface.ts`, `apps/client/src/editors/text/profiles/markdown/blocks/page.ts`, `apps/client/src/editors/core/bootstrap.ts`, `apps/client/src/host/query.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/bench/fake-ipc.ts`, `apps/client/src/theme/scrittoio/skin/document.css`, `apps/client/src/theme/scrittoio/anatomia/document.ts`, `docs/product/editor-and-preview.md`
Non toccare: `apps/client/src/host/contract.ts` e ogni porta IPC (la riga legge porte che ci sono); il testo della nota (la riga non entra nel documento); `apps/client/src/state/document-controller.ts`.
Dipende da: T11, T14
Cosa fare:
- `host/query.ts` prende due letture piccole sulle porte di oggi:
  - le etichette di una nota: `{ kind: "tags", matching: theseDocuments([doc]) }`;
  - quante note la citano: il `total` di `{ kind: "backlinks", target: doc, page: { offset: 0, limit: 1 } }`.
- L'ultima modifica viene dall'anagrafe: `vaultEntries` con `of_kind: "document"` e `within: { path: <la cartella della nota>, descendants: false }`, in una finestra da 1000 voci, e la voce della nota fra quelle. Se la nota non c'è, la parte del tempo non si scrive.
- `state/note-facts.ts` mette insieme i tre dati per un documento:
  - un giro nuovo supera il vecchio (lo schema di `ui/race.ts`): un risultato vecchio non scrive mai sopra uno nuovo;
  - si ricalcola all'apertura, dopo un salvataggio riuscito e al segnale `documents`, mai a ogni battuta;
  - il testo del tempo viene da `relativeTime` (`ui/when.ts`).
- La riga è `div.note-facts[contenteditable=false][role=group]`, con `aria-label` dal catalogo («Dati della nota», «Note details»). Dentro:
  - `span.note-fact` con `clock` e «Modificata 2 ore fa»;
  - `span.note-fact` con l'icona dei collegamenti e «3 collegamenti» (al singolare «1 collegamento»);
  - `span.note-fact.note-fact-tags` con uno `span.note-tag` per etichetta.
  - Una parte vuota non si scrive; se sono vuote tutte e tre, la riga non c'è.
- Dove sta:
  - in Live, un widget di blocco di CodeMirror dopo la riga del primo titolo (`.cm-fub-h1-line`), scritto in `markdown/note-facts.ts` e montato da `profile.ts` e `surface.ts`; senza un H1 sta in cima;
  - nei Blocchi, sotto il titolo della testata della pagina (`blocks/page.ts`);
  - in Lettura, dopo il primo `h1` di `.markdown-rendered`;
  - in Sorgente non c'è.
  - `bootstrap.ts` passa alla superficie la lettura dei dati, così l'editor non chiama l'host da sé.
- Il clic su «3 collegamenti» apre la scheda Collegamenti dell'ispettore; il clic su un'etichetta cerca quell'etichetta, come il clic su un tag nel testo.
- `bench/fake-ipc.ts`: la nota Benvenuto risponde con due etichette e tre collegamenti, come il prototipo.
- La pelle: `skin/document.css` righe 1682–1723; i ganci `note-facts`, `note-fact`, `note-fact-tags` e `note-tag` in `anatomia/document.ts`.
- `docs/product/editor-and-preview.md`: la riga dei dati, in quali modalità c'è e da dove legge.
Dal prototipo: `skin/document.css` 1682–1723; gli stati `nota` e `tel-nota`.
Casi limite:
- una nota senza etichette né collegamenti: solo «Modificata»;
- una nota nuova, mai salvata;
- una nota fuori dall'indice (un file appena arrivato);
- cento etichette: la riga va a capo;
- la nota rinominata mentre la lettura gira: vale l'ultima;
- due riquadri sulla stessa nota;
- la riga non si seleziona col testo, e il cursore la salta con le frecce;
- copiare tutto il testo non copia la riga;
- il lettore di schermo legge il gruppo;
- in inglese («Modified 2 hours ago»);
- il telefono.
Fatto quando:
- `note-facts.test.ts` (tutti e due) passano: i tre dati, le parti vuote, il giro vecchio scartato, nessuna lettura a ogni battuta;
- in Sorgente la riga non c'è;
- la foto di `live-01-panoramica`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`, e quella di `mobile-startup` accanto a `?stato=tel-nota`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T13 · «In entrata» sotto la Struttura

Perché: chi scrive vuole vedere chi cita la nota mentre ne guarda la struttura, senza cambiare scheda; e «Entranti» e «In entrata» per la stessa cosa sono due parole di troppo.
Tocca: `crates/fub-features/src/outline.rs`, `crates/fub-features/src/backlinks.rs`, `apps/client/bench/fake-ipc.ts`, `apps/client/bench/fake-english.ts`, `apps/client/src/ui/node.ts`, `apps/client/src/ui/node.test.ts`, `apps/client/src/theme/scrittoio/skin/nodes.css`, `apps/client/src/theme/scrittoio/anatomia/nodes.ts`, `docs/product/search-links-and-graph.md`
Non toccare: `UiNode` in `fub-abi` e il WIT (la sezione si fa con `Stack`, `Section` e `ListItem` che ci sono); la chiave `incoming` della vista Collegamenti; la feature `backlinks` dentro `outline.rs` (la Struttura legge l'indice del kernel, non la feature: con `backlinks` spenta la sezione c'è lo stesso).
Dipende da: T9, T14
Cosa fare:
- `outline.rs`, `render_view`: dopo l'albero dei titoli chiede `IndexQuery::Backlinks { target: doc, page: Some(Page { offset: 0, limit: 5 }) }` con `host.query_index`.
  - Con almeno un risultato, la radice diventa uno `Stack` con l'albero e una `Section` di chiave `outline-incoming`, titolo «In entrata · N» (N è il `total`), aperta.
  - Dentro, al più 5 `ListItem`: il titolo è il nome della nota, il sottotitolo la sua cartella, l'azione la apre e `drag` è il documento.
  - Oltre 5, una riga «e altri N» porta alla scheda Collegamenti.
  - Senza risultati la sezione non c'è. Un errore della lettura lascia la Struttura com'è, senza sezione.
  - Le stringhe nel catalogo della feature, in italiano e in inglese («Incoming · N», «and N more»).
- `backlinks.rs`: «Entranti» diventa «In entrata» e «Uscenti» «In uscita», anche nei conteggi e nella banda (righe 429, 430, 457, 458 e 466); l'inglese resta «Incoming» e «Outgoing». I test della feature seguono.
- `ui/node.ts`: un `list_item` con `drag` di tipo documento prende in testa `span.ui-list-item-icon` con l'icona della nota (quella della pagina, o la figura del formato). Vale anche per le righe dei Collegamenti, e il contratto non cambia.
- `bench/fake-ipc.ts` (intorno alla riga 861) e `bench/fake-english.ts` (righe 130–131): le stesse parole, e la Struttura di Benvenuto con tre note in entrata, come il prototipo.
- La pelle: `skin/nodes.css` righe 1878–1937; il gancio `ui-list-item-icon` in `anatomia/nodes.ts`.
- `docs/product/search-links-and-graph.md` (righe 75 e 226): le parole nuove e la sezione sotto la Struttura.
Dal prototipo: `skin/nodes.css` 1878–1937; lo stato `nota` (l'ispettore).
Casi limite:
- nessuna nota in entrata: nessuna sezione;
- esattamente 5: niente «e altri»;
- una nota che cita sé stessa;
- un link da un PDF o da un disegno;
- la nota rinominata;
- la Struttura segue anche la selezione, quindi ogni pausa del cursore rifà la lettura: una sola in più, con al più 5 righe, e un test lo conta;
- la feature `backlinks` spenta (`--no-default-features` con la sola `outline`);
- in inglese.
Fatto quando:
- i test di `outline.rs` vedono la sezione con 0, 3 e 7 note in entrata, l'errore della lettura e la feature `backlinks` spenta;
- `cargo test -p fub-features` e il suo `--no-default-features` passano;
- `node.test.ts` vede l'icona sulle righe con `drag`;
- la foto di `inspector` e `live-01-panoramica`, in giorno e notte, sta accanto a `?stato=nota`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T14 · Le figure per cartelle e note

Perché: il mockup dà a cartelle e note figure monocrome che stanno nel tono della cornice; le emoji restano una scelta piena.
Tocca: `apps/client/src/ui/menu.ts`, `apps/client/src/ui/menu.test.ts`, `apps/client/src/ui/icons.ts`, `apps/client/src/ui/page-mark.ts` (nuovo), `apps/client/src/ui/page-mark.test.ts` (nuovo), `apps/client/src/state/page-icons.ts`, `apps/client/src/state/page-icons.test.ts`, `apps/client/src/panels/explorer.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/editors/text/profiles/markdown/livepreview.ts`, `apps/client/src/editors/text/profiles/markdown/blocks/page.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/drawers.css`, `apps/client/src/theme/scrittoio/anatomia/drawers.ts`, `crates/fub-abi/src/organization.rs` (solo il commento del campo `icons`), `docs/reference/on-disk-layout.md`, `docs/product/explorer-and-folders.md`, `docs/product/editor-blocks.md`
Non toccare: il tipo del campo `icons` (resta `String`) e il formato di `.fub/workspace.json` (lo schema resta 1); i comandi del kernel che scrivono l'icona; le emoji già scelte, che si mostrano come oggi.
Dipende da: T8
Cosa fare:
- `ui/icons.ts`: le undici figure del prototipo (righe 2158–2170): `book`, `calendar`, `flag`, `bulb`, `inbox`, `archive`, `image`, `heart`, `briefcase`, `people`, `music`.
- `ui/page-mark.ts` (nuovo) è il solo posto che sa leggere un valore d'icona:
  - `fub:<nome>` con un nome noto è una figura, disegnata con `icon(nome)`;
  - ogni altro testo breve è un'emoji o una lettera, come oggi;
  - un `fub:` con un nome sconosciuto non si disegna;
  - esporta l'elemento da mettere in una riga e il testo da mettere in un nome (una figura nel testo non si scrive).
- `state/page-icons.ts`, `iconValue`: oggi rifiuta ogni `:`; accetta `fub:<nome>` e continua a rifiutare path e indirizzi.
- `ui/menu.ts`, `pickIcon` (riga 955): due gruppi col titolo, «Figure» (prima) ed «Emoji», con le stesse frecce e lo stesso campo per incollare; scegliere una figura chiama `onPick("fub:<nome>")`. Ogni bottone ha `data-icon` col valore.
- I posti che mostrano l'icona la leggono da `page-mark.ts`:
  - `explorer.ts`: `rowIcon`, la riga di una nota e di una cartella e `namedFolder` (che nei menu scrive solo il nome se l'icona è una figura);
  - `document.ts`: la linguetta e la testata;
  - `livepreview.ts`: l'icona accanto ai wikilink;
  - `blocks/page.ts`: l'icona della testata della pagina, scritta nel frontmatter come `icon: fub:book`.
- La pelle: `skin/drawers.css` righe 1361–1404; i ganci `icon-picker-title` e `icon-grid--figures` in `anatomia/drawers.ts`.
- Il catalogo: i titoli dei due gruppi e il nome di ogni figura (per il lettore di schermo), in italiano e in inglese.
- `crates/fub-abi/src/organization.rs`: il commento di `icons` dice «emoji o `fub:<nome>`»; il tipo non cambia.
- Le pagine di `docs/`:
  - `docs/reference/on-disk-layout.md`, la riga di `.fub/workspace.json`: l'icona è un'emoji o `fub:<nome>`, e una versione di prima mostra il testo;
  - `docs/product/explorer-and-folders.md`: il selettore con le figure;
  - `docs/product/editor-blocks.md`, «La testata della pagina»: `icon: fub:book`.
Dal prototipo: `skin/drawers.css` 1361–1404; `ui/icons.ts` 2158–2170; gli stati `icone` e `icone-emoji`.
Casi limite:
- `fub:` con un nome sconosciuto (scritto a mano, o da una versione futura): niente figura, e nessun errore;
- `fub:book` aperto da una versione di Fub di prima: si vede il testo (D7);
- un'emoji composta (bandiere, famiglie);
- `icon:` nel frontmatter scritto da un'altra app (un URL): resta rifiutato;
- la stessa nota con l'icona nel frontmatter e nell'organizzazione: vale l'ordine di oggi;
- rinominare e spostare una cartella con una figura;
- la figura in giorno, notte e contrasto alto: prende il colore del testo;
- Esc chiude il selettore e il fuoco torna dov'era;
- il telefono.
Fatto quando:
- `page-mark.test.ts`, `page-icons.test.ts` e `menu.test.ts` passano: il valore letto, il nome sconosciuto, il rifiuto degli indirizzi, la scelta di una figura e di un'emoji;
- la foto di `menu-albero-cartella` col selettore aperto, in giorno e notte, sta accanto a `?stato=icone`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T15 · Il vault del banco con le figure

Perché: le foto del banco devono mostrare le figure come il mockup, ma le emoji vanno ancora fotografate.
Tocca: `apps/client/bench/fake-ipc.ts`
Non toccare: le altre risposte dell'host finto; `bench/scene.mjs` (le scene nuove sono di T24).
Dipende da: T14
Cosa fare:
- Le icone dell'organizzazione del vault del banco (intorno alla riga 760) diventano `{ Guida: "fub:book", Diario: "fub:calendar" }`.
- Con `?icone=emoji` l'host finto risponde con le icone di oggi, così una scena le può ancora fotografare.
- `docs/`: nessuna pagina descrive il vault del banco.
Dal prototipo: gli stati `icone` e `icone-emoji`.
Casi limite: una scena che oggi conta sull'emoji di una cartella (va cercata con `grep` in `bench/`); il parametro sconosciuto; le sonde del banco che leggono il testo di una riga.
Fatto quando: aprendo il banco con e senza `?icone=emoji` il cassetto mostra le emoji e le figure, e `npx vitest run bench` passa.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T16 · La barra in una fila e la colonna, nel kit

Perché: lo standard va scritto una volta nel proprietario, il kit, prima che una barra lo adotti; così ogni editor mette le classi e toglie le sue regole, invece di ridisegnare la stessa barra.
Tocca: `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/kit.css`, `apps/client/src/theme/scrittoio/anatomia/kit.ts`, `apps/client/bench/kit.ts`, `docs/architecture/frontend-and-ipc.md`
Non toccare: il comportamento di `apps/client/src/kit/options-bar.ts` e `apps/client/src/kit/tool-rail.ts`; `apps/client/src/kit/ribbon/` (T20); le barre degli editor (T17–T23); `apps/client/src/editors/spatial/tools/editor/chrome/rail.ts` (K5).
Dipende da: nessuno
Cosa fare:
- `structure.css`: le righe 506–550 del prototipo (la forma della fila: vassoio, foglietti, pulsanti, campo, «…»), accanto alle regole di `kit-options`.
- `skin/kit.css`: le righe 923–1075 in una sezione nuova «Barra in una fila e colonna», prima di «Garanzie». Le regole di `kit-rail` e `kit-options` che ci sono già e che il blocco rifà si tolgono, non si scavalcano.
- `anatomia/kit.ts`: un pezzo nuovo `kit-bar` coi ganci `kit-bar`, `kit-bar-group`, `kit-bar-button` e `kit-bar-field`; `kit-rail` e `kit-options` tengono i loro. `anatomia.test.ts` vuole che le classi della pelle e i ganci coincidano nei due versi.
- `bench/kit.ts`: una sezione «Barra in una fila», con una `kit-bar` di tre foglietti (un pulsante acceso, uno spento, un campo e «…» di `kit-options`) e una `kit-rail` di `createToolRail` con due gruppi, negli stati forzati della pagina (passaggio, pressione, fuoco).
- `docs/architecture/frontend-and-ipc.md`, il paragrafo su `kit/` (intorno alla riga 226): le tre forme e dove vivono, come in «Lo standard delle barre» qui sopra.
Dal prototipo: `structure.css` 506–550; `skin/kit.css` 923–1075; lo stato `barra` (la barra di formato vestita di `kit-bar`) e `disegno` (la colonna).
Casi limite:
- la colonna del disegno usa già `kit-rail` (`chrome/rail.ts`): cambia aspetto qui, e la foto di `draw-open` va guardata;
- pulsante acceso e spento insieme;
- il campo nella fila, col fuoco;
- le tre densità dell'aspetto e la compattezza (`gate.test.ts` le prova tutte);
- il contrasto alto e `forced-colors`;
- la bolla della selezione resta una bolla, senza vassoio.
Fatto quando:
- `anatomia.test.ts`, `gate.test.ts` e `npm run theme:verify` passano;
- la foto di `kit` e `kit-focus`, in giorno e notte, mostra la sezione nuova, con la fila uguale alla barra di `?stato=barra`;
- quella di `draw-open` ha la colonna come `?stato=disegno`;
- le altre scene non cambiano, perché nessun altro DOM ha ancora le classi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T17 · La barra di formato delle note, e le frecce del kit

Perché: la barra di formato è la prima barra in una fila: prende il vassoio e i pulsanti del kit, e le sue frecce diventano quelle di tutte le barre.
Tocca: `apps/client/src/kit/toolbar-keys.ts` (nuovo), `apps/client/src/kit/toolbar-keys.test.ts` (nuovo), `apps/client/src/kit/index.ts`, `apps/client/src/panels/format-bar.ts`, `apps/client/src/panels/format-bar.test.ts`, `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/bench/fake-ipc.ts`, `docs/architecture/frontend-and-ipc.md`, `docs/architecture/editor-surfaces.md`, `docs/product/editor-and-preview.md`
Non toccare: l'API di `createFormatBar` e di `toolbarGroups` (N6 T41 e T50 le usano); `apps/client/src/panels/mini-bar.ts`; la bolla della selezione (`.selection-bubble`); `apps/client/src/kit/tool-rail.ts` e `apps/client/src/kit/ribbon/ribbon.ts`, che hanno le loro frecce.
Dipende da: T6, T16
Cosa fare:
- `kit/toolbar-keys.ts` (nuovo) esporta `rovingToolbar(element, { controls, onEscape }, lifetime)`:
  - `controls` è una funzione che dà i controlli di oggi (pulsanti, elenchi e campi), perché la barra si ridisegna;
  - un solo punto di Tab (`tabIndex` 0 sul controllo corrente, -1 sugli altri);
  - le regole di oggi di `format-bar.ts` (righe 374–413): destra e sinistra avvolgono ai capi, Home ed End vanno al primo e all'ultimo, e contano solo i controlli visibili e accesi;
  - Esc resta a chi usa la barra, con `onEscape` facoltativo (la barra di formato riporta il fuoco all'editor);
  - in un campo di testo le frecce muovono il cursore del testo e passano al controllo vicino solo ai capi del testo; Home ed End restano al campo;
  - l'ascoltatore passa da `lifetime.listen`.
  - `kit/index.ts` lo esporta.
- `format-bar.ts` usa `rovingToolbar` al posto del suo codice e mette `kit-bar` sulla radice, `kit-bar-group` sui gruppi e `kit-bar-button` sui pulsanti. Le classi `format-bar*` restano, perché le usano i test, la bolla e `data-formatbar-off`.
- `skin/sheets.css`: si tolgono le regole `.format-bar*` (righe 628–696) che `kit-bar` ora veste; `.selection-bubble` e `.selection-bubble .format-bar` restano. I ganci di `anatomia/sheets.ts` seguono la pelle.
- `structure.css` (righe 997–1033): `.format-bar`, `.format-bar-group` e `.format-bar-overflow` perdono ciò che dà `.kit-bar`; restano `--format-bar-h`, `data-formatbar-off` e la bolla.
- `bench/fake-ipc.ts`: con `?formatbar=1` anche la finestra principale riceve i comandi di formato che oggi ha solo il telefono, così la barra si fotografa sul computer. È una riga sola: non aspetta il T4 di caricamento, e chi entra per secondo ribasa.
- I test: `toolbar-keys.test.ts` le frecce, i capi, Home ed End, un solo punto di Tab e una barra che si ridisegna; `format-bar.test.ts` resta verde coi test di T1 e controlla le classi del kit.
- `docs/`:
  - `frontend-and-ipc.md`: `kit/toolbar-keys.ts`;
  - `editor-surfaces.md` (intorno alla riga 164) ed `editor-and-preview.md` (intorno alla riga 442): la barra di formato veste il kit.
Dal prototipo: `structure.css` 506–550 e `skin/kit.css` 923–1075, entrati con T16; gli stati `barra` e `barra-700`.
Casi limite:
- una barra con un gruppo solo;
- tutti i pulsanti spenti (sola lettura): la barra non c'è, come oggi;
- il troppo che va in «…» a 700 px: «…» è l'ultimo punto delle frecce;
- il menu di un pulsante aperto e chiuso: il fuoco torna al pulsante;
- la bolla della selezione (`mobile-keyboard` e la mini-barra): stesse frecce, senza vassoio;
- la barra spenta dalle impostazioni;
- una scorciatoia cambiata dalla persona nel tooltip;
- un campo di testo e un elenco nella fila (li avrà il PDF, T18): il test di `toolbar-keys` li prova già.
Fatto quando:
- `toolbar-keys.test.ts` e `format-bar.test.ts` passano, e `anatomia.test.ts` resta verde;
- con `?formatbar=1` la foto della nota, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=barra`;
- quella di `mobile-keyboard` non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T18 · La barra del PDF

Perché: oggi la barra del PDF è una pillola di parole che va a capo e ha otto punti di Tab; il mockup la vuole nella fila di serie, con le figure, la lente nel campo e la pagina nella banda.
Tocca: `apps/client/src/editors/media/pdf-view.ts`, `apps/client/src/editors/media/pdf-view.test.ts` (arriva con N7), `apps/client/src/editors/media/media-surface.ts`, `apps/client/src/editors/media/media-surface.test.ts`, `apps/client/src/editors/media/icons.ts` (nuovo), `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/media.css`, `apps/client/src/theme/scrittoio/anatomia/media.ts`, `docs/product/pdf-annotations.md`
Non toccare: il motore del PDF (pdf.js e il caricamento); le annotazioni (`apps/client/src/editors/spatial/pdf/`); le parole del catalogo che ci sono, che restano per il tooltip e il nome accessibile.
Dipende da: T17 (aspetta N7 in `main`)
Cosa fare:
- `editors/media/icons.ts` (nuovo) registra con `registerIcon` (`ui/icons.ts`) le sei figure del PDF, coi tratti del prototipo: `media-page-previous`, `media-page-next`, `media-thumbnails`, `media-fit-width`, `media-two-pages`, `media-dark-pages`. Le registra come `useRichIcons` in `editors/rich/icons.ts`: alla prima barra che si monta, e le toglie quando si smonta l'ultima.
- `pdf-view.ts`, la barra:
  - `media-pdf-toolbar` prende `kit-bar`, `role="toolbar"` e `aria-label` («Strumenti del PDF»);
  - i foglietti `span.media-pdf-group.kit-bar-group[role=group]`, in quest'ordine: pagina precedente e successiva; le miniature; il sommario (`select.kit-bar-field`); la ricerca; adatta alla larghezza, due pagine e colori scuri; poi «Annota», quando c'è, in un foglietto suo;
  - i pulsanti diventano figure (`kit-bar-button`) con `aria-label` e tooltip dalle chiavi di oggi;
  - la ricerca è `span.media-pdf-search` con la lente (`search`) e il campo `kit-bar-field`;
  - «Apri con un'altra app» e «Copia il link alla pagina» vanno in «…» (`kit-options-more`, `aria-haspopup="menu"`, nome «Altre azioni del PDF»), che apre `showContextMenu`;
  - le frecce sono quelle di `rovingToolbar` (T17): un solo punto di Tab.
- `media-surface.ts` dà alla banda la voce `{ id: "page" }` con «Pagina N di M» (`SurfaceStatus`, `registry.ts`), aggiornata quando la pagina cambia. Il `p[role=status]` del visore resta per il caricamento e gli errori, e per il lettore di schermo.
- Il catalogo, in italiano e in inglese: `media.pdf.toolbar` («Strumenti del PDF»), `media.pdf.more` («Altre azioni del PDF»), `media.pdf.previous` e `media.pdf.next` («Pagina precedente» e «Pagina successiva»: oggi i due pulsanti dicono solo «‹» e «›» e non hanno un nome). Le altre parole ci sono già (`media.pdf.*`, `media.open_external`).
- La pelle: `skin/media.css` righe 1726–1772, comprese le diapositive (`.slide-status`, «3 / 12» in tondo); si tolgono le regole di `.media-pdf-toolbar` e dei suoi figli (righe 384–456 di `main`: la pillola sospesa che va a capo). I ganci `media-pdf-group` e `media-pdf-search` entrano in `anatomia/media.ts`.
- `docs/product/pdf-annotations.md`: la barra, «…» e la pagina nella banda.
Dal prototipo: `skin/media.css` 1726–1772; le figure della sonda `pdfBarra`; gli stati `pdf` e `pdf-700`.
Casi limite:
- un PDF di una pagina: precedente e successiva spente;
- un PDF senza sommario: niente elenco;
- un PDF che non si apre: la nota d'errore di oggi, e niente voce nella banda;
- la ricerca senza risultati;
- due pagine affiancate («Pagine 3–4 di 12»);
- un PDF che si può annotare e uno che no;
- 700 px: la fila scorre di lato o manda il resto in «…», e non va mai a capo;
- l'host senza «apri con un'altra app» (`onOpenExternal`): «…» ha solo il link; senza nessuno dei due, «…» non c'è;
- in inglese;
- il contrasto alto.
Fatto quando:
- `pdf-view.test.ts` vede i foglietti, i nomi accessibili, «…» col menu, un solo punto di Tab e le frecce;
- `media-surface.test.ts` vede la voce della banda e il suo cambio di pagina;
- la foto di `pdf-domanda`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=pdf`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T19 · I file Craft senza anteprima

Perché: senza anteprima la scheda Craft oggi è un riquadro tratteggiato; il mockup la vuole un foglietto di carta posato sul piano, con le risposte uguali ai pulsanti del kit.
Tocca: `apps/client/src/theme/scrittoio/skin/media.css`, `apps/client/src/theme/scrittoio/anatomia/media.ts`
Non toccare: il DOM e il comportamento di `apps/client/src/editors/craft/consent.ts` e di `apps/client/src/editors/craft/surface.ts` (arrivano con N7); le parole della domanda; la scelta salvata.
Dipende da: T18 (aspetta N7 in `main`)
Cosa fare:
- `skin/media.css`: le righe 1773–1831 del prototipo (`craft-card`, `craft-empty`, `craft-empty-name`, `craft-ask`, `craft-ask-answer`, `craft-render`), al posto delle regole di N7 che rifanno, compreso il bordo tratteggiato.
- `anatomia/media.ts`: `craft-ask` e `craft-ask-answer` entrano nei ganci di `craft-card`, se N7 non li ha già messi.
- `docs/`: nessuna pagina descrive l'aspetto della scheda.
Dal prototipo: `skin/media.css` 1773–1831; gli stati `craft` e `craft-700`.
Casi limite: un nome di file lunghissimo; la domanda e la sua risposta; «Preparo l'anteprima…»; l'anteprima fallita; le anteprime spente (`.craft-off`, col link alle impostazioni); il file oltre il peso massimo; il file che non si legge; il contrasto alto e `forced-colors` (il bordo torna); due schede Craft affiancate.
Fatto quando:
- `anatomia.test.ts` passa;
- la foto di `craft-domanda`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=craft`;
- quelle di `craft-prepara`, `craft-fallita`, `craft-spente`, `craft-peso` e `craft-rotto` hanno lo stesso foglietto e non perdono niente rispetto a N7.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T20 · La barra a schede nel kit

Perché: la barra dei fogli è l'origine dello standard; finché la sua forma si chiama `grid-ribbon-*`, la barra del documento la deve copiare. Nel kit diventa `kit-ribbon-*`, una volta sola.
Tocca: `apps/client/src/kit/ribbon/ribbon.ts`, `apps/client/src/kit/ribbon/ribbon.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/kit.css`, `apps/client/src/theme/scrittoio/skin/editors.css`, `apps/client/src/theme/scrittoio/anatomia/kit.ts`, `apps/client/src/theme/scrittoio/anatomia/editors.ts`, `docs/architecture/grid-surface.md`
Non toccare: `apps/client/src/editors/grid/ribbon/ribbon.ts` (il comportamento della barra dei fogli); le regole `.rich-ribbon-*` (T21); le parti solo dei fogli (tavolozza, galleria, campioni, «Comandi», formula, schede); l'opzione `prefix` del kit, che resta.
Dipende da: T16 (aspetta K3 e griglia in `main`)
Cosa fare:
- `kit/ribbon/ribbon.ts`:
  - la radice prende `kit-ribbon` accanto a `<prefisso>`;
  - ogni pezzo prende `kit-ribbon-<parte>` accanto a `<prefisso>-<parte>`, nello stesso punto in cui oggi nasce la classe (`cls`, intorno alla riga 207);
  - dove `cls` serve anche a cercare un elemento, si cerca ancora con la classe del prefisso.
- `ribbon.test.ts`: ogni pezzo porta le due classi, coi prefissi `grid-ribbon` e `rich-ribbon`.
- `structure.css`: le righe 225–505 del prototipo; si tolgono le regole `.grid-ribbon-<parte>` che il blocco rifà, e restano quelle delle parti solo dei fogli.
- `skin/kit.css`: le righe 564–922 in una sezione «Barra a schede»; in `skin/editors.css` (la sezione «Il foglio di calcolo») si tolgono le regole `.grid-ribbon-<parte>` che il blocco rifà.
- I ganci: i `kit-ribbon-*` in un pezzo nuovo di `anatomia/kit.ts`; quelli `grid-ribbon-*` che non hanno più regole escono da `anatomia/editors.ts`.
- Il blocco del prototipo è ricavato dalle regole `.grid-ribbon-*` di `main` a `3f4f3731`, con lo stesso testo e la stessa specificità. Se K3 o griglia le hanno cambiate, il blocco si rifà dalle regole nuove con lo stesso cambio di nome, e il report dice che cosa è cambiato.
- `docs/architecture/grid-surface.md`: la forma della barra sta nel kit, e ai fogli restano le loro parti.
Dal prototipo: `structure.css` 225–505; `skin/kit.css` 564–922; gli stati `foglio`, `caricamento`, `errore`, `molti` e `tel-foglio`.
Casi limite:
- la barra del documento prende subito le regole `kit-ribbon-*`: la foto di `document-docx` va guardata anche qui, e le differenze che restano sono di T21;
- i gruppi raccolti a 700 px, aperti sul posto;
- le schede contestuali;
- i suggerimenti dei tasti (`keytip`);
- il telefono (`mobile-grid-ribbon`);
- la barra chiusa e aperta;
- l'ordine della cascata: le regole del kit vengono prima di quelle dei fogli, così una regola sola dei fogli vince ancora.
Fatto quando:
- `ribbon.test.ts`, `anatomia.test.ts` e `npm run theme:verify` passano;
- la foto di `grid-workbook`, `grid-result-loading`, `grid-result-error`, `grid-result-many` e `mobile-grid-ribbon`, in giorno e notte, a 1280 e a 700, sta accanto agli stati `foglio`, `caricamento`, `errore`, `molti` e `tel-foglio`, e la barra dei fogli non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T21 · La barra a schede del documento

Perché: la barra del documento Word e ODT è la stessa barra a schede dei fogli: prende le regole del kit, tiene solo la sua galleria degli stili, e un gruppo raccolto si apre sul posto (D8).
Tocca: `apps/client/src/editors/rich/ribbon.ts`, `apps/client/src/editors/rich/ribbon.test.ts`, `apps/client/src/theme/scrittoio/skin/editors.css`, `apps/client/src/theme/scrittoio/anatomia/editors.ts`, `apps/client/src/theme/scrittoio/structure.css`, `docs/product/word-documents.md`, `docs/architecture/rich-surface-and-proofing.md`
Non toccare: `apps/client/src/tabella/ribbon.ts`; i comandi e le schede del documento; `apps/client/src/editors/rich/icons.ts` (le figure delle modalità, che T2 usa così come sono); `apps/client/src/kit/ribbon/ribbon.ts` (T20).
Dipende da: T20 (aspetta K3 in `main`)
Cosa fare:
- `rich/ribbon.ts` passa `openInPlace: true` al kit, come fa la barra dei fogli in K3; il riquadro sospeso di oggi non si apre più per un gruppo raccolto.
- `ribbon.test.ts`: a 700 px un gruppo raccolto si apre sul posto, Esc lo chiude e il fuoco torna al suo bottone.
- `skin/editors.css` (la sezione dei documenti di videoscrittura) e `structure.css`: si tolgono le regole `.rich-ribbon-<parte>` che `kit-ribbon-*` rifà; restano la galleria degli stili, i campioni e le parti del documento.
- `structure.css`: la galleria degli stili, righe 552–561 del prototipo (`rich-ribbon-styles`, `rich-ribbon-style`).
- I ganci `rich-ribbon-*` che non hanno più regole escono da `anatomia/editors.ts`.
- `docs/product/word-documents.md` e `docs/architecture/rich-surface-and-proofing.md`: la barra veste il kit, e il gruppo raccolto si apre sul posto.
Dal prototipo: `structure.css` 552–561; gli stati `documento`, `documento-700`, `sola-lettura` e `tel-doc`.
Casi limite:
- il documento in sola lettura (`document-readonly`): la barra resta com'è oggi, cambia solo la veste;
- la scheda contestuale della tabella (`tabella/ribbon.ts`);
- un gruppo raccolto aperto quando la finestra si allarga: fa come nei fogli con K3;
- la galleria degli stili con un nome lungo;
- la modalità Lettura, che nasconde la barra;
- il telefono (`mobile-document`).
Fatto quando:
- `ribbon.test.ts` e `anatomia.test.ts` passano;
- la foto di `document-docx`, `document-docx-narrow`, `document-readonly` e `mobile-document`, in giorno e notte, sta accanto agli stati `documento`, `documento-700`, `sola-lettura` e `tel-doc`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T22 · La testa del disegno

Perché: la testa del disegno ha la sua barra; nella fila di serie si legge come le altre, e il gettone del motore resta suo.
Tocca: `apps/client/src/editors/spatial/tools/editor/toolbar.ts`, `apps/client/src/theme/scrittoio/skin/draw.css`, `apps/client/src/theme/scrittoio/anatomia/draw.ts`, `apps/client/src/theme/scrittoio/structure.css`, `docs/product/drawing-view.md`, `docs/architecture/ink-and-tools.md`
Non toccare: `apps/client/src/editors/spatial/tools/editor/chrome/rail.ts` (K5); gli strumenti e i loro tasti; il gettone del motore; il piano del disegno.
Dipende da: T16, T17
Cosa fare:
- `toolbar.ts`: `draw-toolbar` prende `kit-bar`, `draw-group` prende `kit-bar-group`, i pulsanti `kit-bar-button`; le frecce sono quelle di `rovingToolbar`, e i pulsanti che oggi sono un punto di Tab ciascuno (menu, annulla, ripeti, esporta, intorno alla riga 360) entrano nello stesso giro.
- `skin/draw.css` e `structure.css` (`.draw-header` e `.draw-toolbar`, intorno alle righe 2960 e 2966): si tolgono le regole di forma e di pelle che `kit-bar` rifà; resta `data-bare` (riga 3215), che nasconde la testa.
- I ganci di `anatomia/draw.ts` seguono la pelle.
- Se K5 T25 approva un prototipo diverso prima di questo task, si segue quello (vedi «Domande per l'orchestratore»).
- `docs/product/drawing-view.md` e `docs/architecture/ink-and-tools.md`: la testa veste il kit.
Dal prototipo: gli stati `disegno` e `disegno-700`.
Casi limite:
- l'interfaccia nascosta (`Ctrl+.`): la testa resta nascosta;
- il colore e lo spessore nella fila;
- l'esportazione in corso;
- 700 px: il troppo in «…»;
- un PDF annotato (Annota): la stessa testa;
- il contrasto alto.
Fatto quando:
- i test del disegno passano;
- la foto di `draw-open`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=disegno`;
- la testa ha un solo punto di Tab.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T23 · La barra della lavagna

Perché: la barra della lavagna è l'ultima disegnata a modo suo; nella fila di serie i comandi stanno in foglietti, e la modalità prende la sua figura.
Tocca: `apps/client/src/editors/canvas/engine.ts`, `apps/client/src/editors/canvas/surface.ts`, `apps/client/src/theme/scrittoio/skin/editors.css`, `apps/client/src/theme/scrittoio/anatomia/editors.ts`, `apps/client/src/theme/scrittoio/structure.css`
Non toccare: l'aspetto della tela e il suo contrasto (N6 T22); il gettone della penna (N4); la banda della lavagna (N6 T52); i comandi della lavagna.
Dipende da: T16, T17 (aspetta N6)
Cosa fare:
- `engine.ts` (intorno alla riga 261): `canvas-toolbar` prende `kit-bar`; i comandi vanno in foglietti `kit-bar-group`, i pulsanti `kit-bar-button`, gli elenchi e i campi `kit-bar-field`; le frecce sono quelle di `rovingToolbar`, così la barra ha un punto di Tab solo invece di uno per pulsante.
- `surface.ts` (riga 260): la modalità `canvas` prende `icon: "layout-dashboard"`.
- `skin/editors.css` (righe 1135–1163) e `structure.css` (intorno alle righe 2643–2650): si tolgono le regole `.canvas-toolbar` che `kit-bar` rifà; resta lo scorrimento di lato.
- I ganci di `anatomia/editors.ts` (riga 32) seguono la pelle.
- Se N6 ha già rifatto la barra con `kit-bar` (vedi «Domande per l'orchestratore»), il task resta solo l'icona; se N6 non è in `main` quando arriva l'ondata, il task diventa suo o un seguito, e il report lo dice.
- `docs/`: la pagina della lavagna la cambia N6; qui nessuna.
Dal prototipo: gli stati `lavagna` e `lavagna-700`.
Casi limite: la sorgente della lavagna (la modalità `source`, senza barra); una lavagna vuota; la lavagna in sola lettura; molti comandi a 1280 (lo scorrimento di lato); il fuoco che passa dalla barra alla tela.
Fatto quando:
- i test della lavagna passano;
- la foto della lavagna, in giorno e notte, sta accanto a `?stato=lavagna`;
- la barra ha un solo punto di Tab, e il menu delle modalità mostra la figura.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T24 · Le scene nuove del banco

Perché: ciò che il piano cambia deve restare fotografato, compreso ciò che oggi non ha una scena (il menu delle modalità, la barra di formato sul computer, le figure, la nota a 700 px).
Tocca: `apps/client/bench/scene.mjs`, `apps/client/bench/a11y.mjs`, `apps/client/bench/scene.test.ts`, `apps/client/bench/baseline/` (tutte le PNG, con `git rm`), `docs/development/testing-and-quality.md`
Non toccare: le scene degli altri piani; `apps/client/bench/photos.mjs`; `.github/workflows/ci.yml`.
Dipende da: T3–T23
Cosa fare:
- Le scene nuove in `scene.mjs`, ognuna con titolo e `prepare`:
  - `banda-modalita`: la nota col menu delle modalità aperto dalla banda (stato `nota`);
  - `nota-stretta`: la nota a 700×800 (stato `nota-700`);
  - `barra-formato` e `barra-formato-stretta`: la nota con `?formatbar=1`, a 1280 e a 700 (stati `barra` e `barra-700`);
  - `icone-figure` e `icone-emoji`: il selettore dell'icona aperto su una cartella, sulle figure e con `?icone=emoji` (stati `icone` e `icone-emoji`);
  - `lavagna-barra`, solo se T23 è fatto (stato `lavagna`).
- `a11y.mjs` (`inspectKeyboard`, intorno alla riga 377): `#status-mode` apre il menu con Invio, Esc lo chiude e il fuoco torna sulla banda; la barra di formato e quella del PDF sono un punto di Tab ciascuna.
- `scene.test.ts` cambia solo se una scena nuova apre una pagina che il presidio non conosce.
- Le baseline: `bench/scene.test.ts` vuole che ci siano tutte o nessuna, quindi le scene nuove senza foto lo farebbero fallire. Il task toglie **tutte** le PNG di `bench/baseline/` con `git rm`, che è lo stato che il presidio dichiara fra le scene nuove e il loro artefatto; T25 le rimette tutte dal runner. Nessuna si rifà in locale.
- `docs/development/testing-and-quality.md`: le scene nuove.
Dal prototipo: gli stati elencati sopra; `vuoto`, `ricerca`, `grafo`, `impostazioni`, `componenti` e `zero` hanno già la loro scena.
Casi limite:
- aspetta le scene di griglia T8, A1 T13, caricamento T4, K3 T17 e N7 T32: se una arriva in `main` dopo questo task, la fusione rimette le sue baseline, e l'orchestratore le toglie di nuovo prima di spingere;
- una scena che dipende da un tempo (le animazioni ferme del banco);
- il menu aperto nella foto: la scena aspetta che sia montato;
- `?formatbar=1` non deve cambiare le scene di oggi;
- il job visivo resta rosso fino a T25, come il presidio dice.
Fatto quando:
- `npx vitest run bench` passa, con la cartella delle baseline vuota;
- in locale `npm run bench:a11y` passa sulle scene nuove;
- ogni scena nuova si apre nel banco e la sua foto locale sta accanto al suo stato del prototipo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T25 · Le baseline dal runner

Perché: le baseline sono specifiche del runner Linux e si rifanno una volta sola, alla fine, con tutte le scene dentro.
Tocca: `apps/client/bench/baseline/` (tutte le PNG)
Non toccare: ogni altro file; nessuna PNG fatta in locale.
Dipende da: T24
Cosa fare:
- Lo fa l'orchestratore, perché un coder non lancia la CI: `gh workflow run ci.yml --ref piano/scrittoio-2`, oppure la PR segnata pronta (vedi «Domande per l'orchestratore»), e l'attesa in background.
- Il job visivo, senza baseline, fallisce e carica l'artefatto `banco-visivo-<sha>`: si scarica con `gh api repos/Fubeo/Fub/actions/artifacts/<id>/zip` in una cartella nuova e vuota sotto `$TMPDIR`.
- Si controlla che `attuale/` abbia due foto (giorno e notte) per ogni scena, cioè il numero che `scene.test.ts` si aspetta, e si copia tutta in `bench/baseline/`.
- Prima del commit si guardano le foto delle scene del piano accanto ai loro stati del prototipo, in giorno e notte; una differenza che non si spiega torna al task che l'ha fatta, e le baseline si rifanno.
- Un commit solo: `test(banco): le baseline di Scrittoio 2, dal runner (banco-visivo di <sha>)`, senza trailer.
- Si rilancia la CI: il job visivo e quello dell'accessibilità passano.
Dal prototipo: tutti gli stati.
Casi limite:
- l'artefatto è di un commit vecchio: si rifà sul commit in cima al ramo;
- una scena fallisce nel runner e non ha foto: si corregge la scena (T24), non si copia a metà;
- un piano entra in `main` fra l'artefatto e il commit: si fonde prima, e si rifà l'artefatto;
- `gh run download` rifiuta l'artefatto: si usa `gh api`.
Fatto quando: `npx vitest run bench` passa con tutte le baseline, e nella CI il job visivo e quello dell'accessibilità sono verdi sul commit delle baseline.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T26 · La chiusura

Perché: il piano si chiude solo con la CI completa verde, le guardie dei documenti verdi e un ultimo giro di occhi.
Tocca: `PLAN.md` (le righe `Stato:`), `DECISIONS.md` (le scelte prese durante il lavoro)
Non toccare: il codice e le baseline; se la rilettura trova un difetto, torna al task che l'ha fatto.
Dipende da: T25
Cosa fare:
- La PR segnata pronta: la CI completa, con Windows e macOS, e i banchi.
- `scripts/check.sh` completo sullo stato finale, e tutte le guardie dei documenti elencate in `CONTRIBUTING.md` fra `ci-required:start` ed `ci-required:end`.
- Il diff intero riletto: classi senza gancio, regole vecchie rimaste accanto alle nuove, stringhe solo in una lingua, ascoltatori senza disposer, pagine di `docs/` che non dicono più il presente.
- Per ogni stato del prototipo, la foto della sua scena dal runner accanto, in giorno e notte, con le differenze che restano scritte nel resoconto.
- L'anteprima sulla 1432 aggiornata col ramo, come dice `CLAUDE_DEVICE.md`.
- Ogni `Stato:` di `PLAN.md` dice il vero, e `DECISIONS.md` registra le scelte prese strada facendo.
Dal prototipo: tutti gli stati.
Casi limite: un job rosso su Windows o macOS che in Linux non si vede; un test noto come instabile (si rilancia una volta, poi si indaga); un piano entrato in `main` dopo T25, che costringe a rifare le baseline.
Fatto quando:
- la CI completa della PR è verde;
- le guardie dei documenti passano;
- il resoconto finale elenca le differenze rimaste fra le foto e il prototipo, e l'utente può dare l'OK alla fusione.
Prova: scripts/check.sh --rapido, poi `scripts/check.sh`
Stato: [ ] da fare

## Non verificato da qui

- Nel prototipo l'ispettore e la banda degli stati `documento`, `disegno` e `pdf` mostrano ancora il contenuto di Benvenuto, perché le scene di partenza lo hanno: la foto vera dirà il contenuto giusto.
- Nella scena del disegno la scheda Collegamenti dice ancora «Entranti»: cambia con T13.
- La WebView vera, Windows e macOS: si vedono solo in CI (T26).
- I punti di Tab di oggi, contati nel prototipo: il PDF ne ha otto e la lavagna uno per pulsante; T18 e T23 li riducono a uno, ma il conto vero lo fa `a11y.mjs` (T24).
- I numeri di riga di `main` citati nei task si sposteranno con N4, N6, N7, K3 e griglia: valgono i nomi delle regole e delle funzioni.
- Se `showContextMenu` aperto dalla banda in basso si apre verso l'alto o si sposta da sé: si vede nella foto di `banda-modalita`.
- Il costo della lettura in più di T13 a ogni pausa della selezione, in un vault grande.
- La finestra da 1000 voci di T12 in una cartella molto piena: oltre, la riga non dice il tempo.
- Le regole di K3 e griglia sulla barra dei fogli dopo la loro fusione: T20 rifà il blocco se sono cambiate.
