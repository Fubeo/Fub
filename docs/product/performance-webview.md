# Il disegno nella WebView

> **Ambito:** quanto costa a WebKit, nell'app vera, disegnare una battuta
> nelle note Markdown e gli elenchi lunghi delle viste: le regole che tengono
> il lavoro dentro il foglio e fuori dal DOM, e le misure prima e dopo. Il lavoro di CodeMirror fino al layout sta in
> [La battuta](performance-budget.md#la-battuta).

Il [banco della battuta](performance-budget.md#la-battuta) misura il lavoro
fino al layout; nella WebView vera conta anche quanto WebKit rifà e
ridipinge. Tre regole tengono una battuta dentro il foglio:

- **lo scorrimento del foglio è una radice di layout**: `.cm-scroller` delle
  note Markdown ha `contain: size layout` (`theme/scrittoio/structure.css`).
  WebKit ferma il layout a un elemento solo se ha contenimento di misura e di
  layout (o un taglio con misure fisse), e la catena flessibile del riquadro
  non ne ha: senza la regola ogni battuta rifaceva il layout di tutta la
  finestra e la ridipingeva intera (204 su 226 battute in una prova); con la
  regola ne restano 4, e il lavoro sincrono della battuta scende da 5 a 1 ms
  di mediana. Niente `paint`: i menu di CodeMirror stanno in `.cm-editor`,
  fuori dallo scorrimento, e le maniglie dei blocchi dentro, ma non devono
  essere tagliate. La guardia è `structure.test.ts`;
- **i controlli scrivono solo quello che cambia**: la barra di formato, la
  bolla di selezione, le scorciatoie delle barre e le maniglie dei blocchi
  confrontano prima di scrivere un attributo, perché in WebKit anche un
  attributo riscritto uguale invalida e ridipinge (`format-bar.test.ts`,
  `selection-bubble.test.ts`);
- **le viste si disegnano fuori dal thread della finestra**: `render_view`
  corre nella corsia `viste` delle domande (vedi
  [contratto IPC](../reference/ipc-contract.md)); prima era un comando
  sincrono, e dopo un salvataggio una ventina di viste si disegnavano in fila
  sul thread principale, con un fotogramma fino a 258 ms.

Misura con la sonda WebDriver sull'app vera (GPU, schermo a 60 Hz,
pc-debian-di-fub, 16 novembre 2026, giri alternati prima/dopo, `7134e49c1`
contro questo codice), tasto→schermo di mediana e novantesimo percentile in
ms; il carico medio della macchina è fra parentesi e nei giri «prima» era più
alto:

| Nota | Modalità | Prima | Dopo |
|---|---|---:|---:|
| corta | Sorgente | 38 · 57, 37 · 55 (7–16) | 33 · 44, 31 · 37 (7) |
| corta | Live | 51 · 79, 51 · 89 (16–17) | 31 · 47, 29 · 41 (6) |
| corta | Blocchi | 26 · 37, 40 · 64 (14–31) | 24 · 40, 27 · 39 (5) |
| lunga | Sorgente | 30 · 47, 38 · 61 (12–24) | 33 · 47, 52 · 68 (4–22) |
| lunga | Live | 30 · 50, 35 · 47 (10–16) | 30 · 43, 26 · 51 (3–20) |
| lunga | Blocchi | 48 · 80, 34 · 53 (9–12) | 29 · 41, 27 · 41 (7–12) |

Lo schermo di questa misura va a 60 Hz, quindi un fotogramma dura almeno
16,7 ms. Su NVIDIA anche uno schermo più veloce non accorcia molto il
fotogramma: col vblank emulato il rAF segue lo schermo, ma WebKitGTK di
Debian passa i fotogrammi in memoria condivisa e ne consegna al più 54 al
secondo ([perché](../architecture/desktop-webview.md#il-tetto-dei-60-hz-di-webkitgtk),
[misure](../misure/2026-11-17-linux-vblank-emulato.md)). La prima marcatura
del correttore (`proof.ts`) nel tratto appena visibile costa ancora un
fotogramma da circa 60 ms.

## Dopo il salvataggio

Un salvataggio ridisegna le viste che dipendono dalla nota (collegamenti,
statistiche, struttura), anche quelle nascoste nel cassetto quando la finestra
è stretta. Sulla nota lunga del banco la view dei collegamenti in uscita ha una
riga per rimando, circa 4900 righe e 33 000 nodi, e ogni salvataggio la
ricostruiva da capo: un blocco del thread da 130 a 210 ms circa 100 ms dopo
`write_document`. Due regole lo tolgono:

- **un sottoalbero uguale non si tocca**: la riconciliazione di `ui/node.ts`
  lascia com'è un nodo il cui `UiNode` è uguale al precedente (confronto
  profondo), se non sono cambiati gli ingressi lato client del disegno:
  le icone registrate, quelle delle pagine e la lingua (`drawInputs`). Un campo
  (testo, scelta, interruttore…) e un `custom` si aggiornano sempre, perché il
  loro stato vive anche nel DOM. La guardia è `node.test.ts` («un sottoalbero
  uguale non si tocca»);
- **niente `:empty` dentro un `:has()`**: in WebKit un testo cambiato in un
  punto qualunque della finestra (la parola «Salvato» in `#save-state`)
  rimette in discussione `:empty`, e la regola
  `.setting-row:has(.setting-diagnostic:not(:empty)) + *` delle impostazioni
  faceva ricontrollare tutta la finestra: 10–26 ms per ogni testo dello stato
  di salvataggio, in proporzione ai nodi. Uno stato che serve a un selettore lo
  scrive il codice come attributo (`data-issue` sulla riga della scorciatoia,
  `data-empty` sul foglio dell'anteprima del lanciatore quando la pagina non
  ha nodi). Le guardie sono `structure.test.ts`, che rifiuta `:empty` dentro
  `:has()` in ogni foglio di `apps/client/src/`, `settings.shortcuts.test.ts`
  e `launcher.test.ts`.

Misura con una sonda sull'ispettore remoto di WebKit (senza WebDriver) nell'app vera,
pc-debian-di-fub, 16 novembre 2026, nota lunga (5000 righe con rimandi), 20
caratteri a 60 ms, poi 3 s dopo il salvataggio automatico; blocco massimo del
thread e fotogramma più lungo in ms, carico medio a un minuto fra parentesi:

| Modalità | Prima: blocco · fotogramma | Dopo: blocco · fotogramma |
|---|---:|---:|
| Sorgente | 150 · 164, 138 · 149 (0,5–0,8) | 0 · 25, 0 · 25 (0,3) |
| Live | 207 · 218, 151 · 140 (2,5–2,7) | 0 · 24, 0 · 20 (1,1–2,0) |
| Blocchi | 151 · 162, 141 · 156 (0,3) | 0 · 32, 0 · 32 (0,2) |

«Prima» è `2352d9b61`. Un blocco è un giro di `setTimeout(0)` in ritardo di
oltre 40 ms; dopo il salvataggio non ne resta nessuno. La view dei
collegamenti resta grande da calcolare e da mandare (una riga per rimando, in
`crates/fub-features/src/backlinks.rs`); il disegno si ferma alle prime 200
voci (vedi [Gli elenchi lunghi nelle viste](#gli-elenchi-lunghi-nelle-viste)).

## Gli elenchi lunghi nelle viste

Un elemento nel DOM costa anche quando non si vede: ogni ricalcolo di stile,
ogni fuoco spostato e ogni misura lo attraversano. Sulla nota lunga del banco
la view dei collegamenti in uscita ha 4756 voci, circa 33 000 elementi nel
cassetto destro, e la view resta montata anche a cassetto chiuso. Con quella
nota aperta aprire il cassetto costava circa 300 ms di lavoro sincrono più un
fotogramma da 800 ms, chiuderlo un blocco da 600 ms, e la barra laterale, il
menu contestuale e il binario 20–80 ms per gesto invece di 2–6.

La regola: **un `list` di una view disegna al più 200 voci** (`LIST_PAGE` in
`ui/node.ts`). Le altre restano nel nodo e non entrano nel DOM; in coda
all'elenco una riga «Mostra altre N · T in tutto» (`.ui-list-more`, una voce
dell'elenco per le tecnologie assistive) ne aggiunge altre 200 per clic. Le
voci chieste restano mostrate quando la view si ridisegna (un salvataggio), la
riga non si sposta e tiene il fuoco; quando le voci finiscono il fuoco passa
alla prima voce nuova. La guardia è `node.test.ts` («un elenco lungo mostra
una pagina di voci»). Il provider continua a mandare l'elenco intero: la
soglia è del disegno, non del contratto.

Misura con la sonda sull'ispettore remoto di WebKit nell'app vera,
pc-debian-di-fub, 17 novembre 2026, «prima» = `c9a346bae`; nota lunga aperta
(5000 righe con rimandi), finestra stretta (il cassetto destro è un
cassetto); fotogramma più lungo e blocco massimo del thread in ms, carico
medio a un minuto fra parentesi. La serie completa a giri alternati sta nella
ricetta del ramo.

| Gesto | Prima: fotogramma · blocco | Dopo: fotogramma · blocco |
|---|---:|---:|
| cassetto destro, tre aperture e chiusure | 835 · 651 (2,0) | 44 · 73 (3,5) |
| cassetto destro, un'apertura e chiusura | 33 · 561 (2,1) | 42 · 53 (3,3) |
| barra laterale ×6 | 82 · 75 (2,1) | 25 · 26 (3,1) |
| menu contestuale ×5 | 84 · 81 (2,0) | 44 · 27 (3,5) |
| binario, sei pannelli ×2 | 79 · 98 (2,0) | 22 · 21 (3,6) |

WebKitGTK disegna a 60 Hz anche su uno schermo a 180 Hz, quindi un
fotogramma dura almeno 16,7 ms. La prima apertura del grafo, del
lanciatore e di un menu sono in [Le prime volte](#le-prime-volte); resta un
fotogramma da 30–40 ms a ogni cambio di zoom o di accento, che ricalcolano lo
stile di tutta la pagina.

## Le prime volte

Certe superfici costavano care solo la prima volta in una sessione, per ragioni
che non erano di chi le apre. Tre regole le tolgono dal fotogramma del gesto:

- **il fuoco si sposta una volta sola**: in WebKit ogni `focus()` ricalcola lo
  stile della pagina, e cercare il primo elemento raggiungibile ne forza il
  layout (`offsetParent`). `trapFocus` (`ui/a11y.ts`) metteva il fuoco sul
  primo elemento e subito dopo il menu o il lanciatore lo rimettevano dove
  volevano loro. Chi sa già dove va il fuoco passa `{ moveFocus: false }` e lo
  mette lui, dentro la superficie: il menu contestuale e i suoi sottomenu, il
  selettore di icona, il lanciatore. La trappola resta la stessa (Tab che non
  esce, Escape, fuoco restituito alla chiusura). Le guardie sono `a11y.test.ts`,
  `menu.test.ts` («aprendosi sposta il fuoco una volta sola») e
  `launcher.test.ts` («aprendosi mette il fuoco nel campo una volta sola»);
- **il lavoro che si può fare prima si fa a riposo**: `ui/warmup.ts` tiene una
  coda di compiti che la shell fa partire a consegna finita
  (`shells/scrittoio/bootstrap.ts`). Il primo aspetta 2 s, ogni passo aspetta
  che puntatore, tastiera e rotella stiano fermi da 600 ms e poi un
  fotogramma; uno alla volta, un errore non ferma gli altri, e la vita della
  shell la chiude. I compiti sono due:
  - i **caratteri** (`theme/font-warmup.ts`): le facce con
    `font-display: swap` ancora da caricare si caricano una per passo. Prima il
    Plex Mono degli accordi arrivava nel fotogramma in cui si apriva il primo
    menu o il lanciatore, e la WebView ricalcolava lo stile di tutta la pagina;
  - il **grafo** (`graph/warmup.ts`, registrato da `mountGraph`): l'atlas dei
    nodi con i colori del tema, poi un grafico minuscolo montato per tre
    fotogrammi su un host invisibile (`inert`, `aria-hidden`, opacità 0, senza
    puntatore), che non salva niente. La WebView compila lì le sue procedure di
    disegno del canvas (gradienti, `drawImage` dall'atlas, curve, testo), che
    alla prima apertura vera costavano un fotogramma da ~50 ms di script e uno
    da ~90 di pittura;
- **l'atlas si cuoce una volta per colori**: `atlasFor` (`graph/render/atlas.ts`)
  tiene l'ultimo atlas e il pittore lo riprende se i colori sono gli stessi; un
  tema nuovo lo rifà. La guardia è `atlas.test.ts` («il secondo pittore con gli
  stessi colori riprende l'atlas del primo»).

Misura con una sonda sull'ispettore remoto di WebKit nell'app vera,
pc-debian-di-fub, 17 novembre 2026, vault del banco; tempo sincrono del gesto
(per il grafo il blocco più lungo del thread) in ms, carico medio a un minuto
fra parentesi:

| Gesto | Prima | Dopo |
|---|---:|---:|
| Prima apertura del grafo dalla rail (blocco) | 138–145 (0,5–1) | 50–52, preceduto da uno di 23–24 (1,1–2,3) |
| Primo menu contestuale | 24–32 (0,2–0,3) | 11–21 (0,3) |
| Secondo menu contestuale | 20–21 | 9–14 |
| Primo lanciatore (Ctrl O) | 39–49 | 22–23 |
| Secondo lanciatore | 10–16 | 5–9 |

«Prima» è `a32ce1f6a`. Il riscaldamento costa, una volta per sessione e a
riposo, tre blocchi di fila di 38–42, 55–57 e 30–32 ms (il grafo) e poi
blocchi di 10–22 ms (i caratteri). Il menu e il lanciatore aperti prima che i
caratteri siano caricati costano come prima per la parte dei caratteri, meno il
fuoco doppio (primo menu 19).

## Il gesto che misura

Un gesto che prima scrive e poi misura fa rifare il layout alla WebView dentro
il gesto stesso; se dopo la misura scrive ancora, il layout del fotogramma lo
rifà da capo; e un conto rifatto a ogni prova costa anche se non tocca il DOM.
Due regole:

- **il menu della maniglia seleziona la tratta dopo essersi messo al suo
  posto**: `openMenu` (`blocks/handles.ts`) selezionava i blocchi e poi
  apriva il menu, e `placeBeside` misurava la maniglia su un editor appena
  riscritto dalla selezione; con il fuoco ancora nell'editor CodeMirror
  riscriveva anche la selezione del documento. Adesso il menu si apre, si
  mette accanto alla maniglia e prende il fuoco, e la selezione arriva dopo,
  nello stesso gesto. Le voci ritrovano il blocco dalla sua chiave
  (`withRun`), non dalla selezione. Il primo menu della maniglia scende da
  29 a 25 ms di mediana; restano ~10 ms del primo layout del menu stesso
  (le tre misure di `placeBeside`) e ~10 dell'aggiornamento di CodeMirror per
  la selezione, entrambi solo la prima volta. La guardia è
  `blocks.dom.test.ts` («seleziona la tratta dopo che il menu è al suo posto
  e ha il fuoco»);
- **la ricetta del tema conta i fondi una volta**: a ogni cambio d'accento la
  tavolozza si ricalcola, e `hold` (`theme/scrittoio/recipe.ts`) cerca la
  luminosità di ogni colore con una bisezione che, a ogni tentativo, rileggeva
  dal testo l'esadecimale del colore e quello di ogni fondo. Le luminanze dei
  fondi si contano una volta per colore e quella del colore dai suoi canali,
  con la stessa aritmetica di `contrast`: i fogli generati restano uguali byte
  per byte (`npm run theme:verify`) e una tavolozza costa in Node 1,0 ms
  invece di 3,4. La guardia è `recipe-cost.test.ts`.

Misura con una sonda sull'ispettore remoto di WebKit nell'app vera,
pc-debian-di-fub, 17 novembre 2026, vault del banco, cinque giri alternati per
build, carico medio a un minuto fino a 0,93; mediana e massimo in ms:

| Gesto | Prima: sincrono · blocco | Dopo: sincrono · blocco |
|---|---:|---:|
| Primo menu della maniglia | 30, 38 · 37, 46 | 26, 35 · 32, 42 |
| Cambio d'accento (30 cambi): fotogramma più lungo | 28–49 | 27–47 |

«Prima» è `2890f9e8f`. Il cambio d'accento resta dominato dal ricalcolo
dello stile (sotto): la differenza sta dentro il rumore. Sul 13600KF di questa
macchina lo stesso gesto costa quasi il doppio quando il thread della WebView
gira su un core E (CPU 12–19): primo menu contestuale 21–29 ms contro 14,
primo lanciatore 44–45 contro 24. Senza fissare l'app sui core P (`taskset`)
ogni gesto ha due mode a circa 10 ms l'una dall'altra, in tutte e due le
build, e cinque giri non bastano a separare una differenza più piccola.

Quello che resta non è di chi apre il gesto, o non vale il rischio:

- **l'accento** cambia proprietà sulla radice, e WebKit ricalcola lo stile di
  tutta la pagina (circa 1350 elementi): ~25 ms comunque lo si scriva (foglio
  sostituito, testo del foglio, CSSOM, stile in linea su `<html>`);
- **lo zoom** è della finestra (`set_zoom` in `crates/fub-app/src/lib.rs`):
  WebKit rifà il layout di tutto in 20–30 ms fuori da JavaScript. Dentro, la
  barra di formato (`fit` in `panels/format-bar.ts`) rilegge `scrollWidth`
  una volta per gruppo nascosto, fino a 9 letture e 2–6 ms quando la barra è
  stretta; una stima a posizioni la porterebbe a due letture, ma i gruppi
  della barra possono restringersi e la stima rischia di nascondere un gruppo
  di troppo;
- **il primo lanciatore** paga 10–16 ms prima del suo codice (CodeMirror
  costruisce la mappa dei tasti al primo tasto premuto in un editor, e la
  prima volta il passo delle scorciatoie della shell compila) e 9–11 ms per il
  primo layout della superficie. Un HTML uguale montato a riposo non lo
  abbassa; un'apertura e chiusura vera a riposo sì (9 ms invece di 25), ma
  toccherebbe fuoco, pillola e memoria dei modi, e non si fa. Misurare la
  fila dei modi dopo la superficie, invece che dentro `setMode`, toglie un
  layout forzato da 3–4 ms nelle marcature, ma nelle serie fissate sui core P
  non si vede (primo lanciatore 19 ms di mediana in tutte e due le build): non
  si fa;
- **la prima apertura del grafo** resta un fotogramma da ~50 ms
  (`graph/chart.ts`), che si potrebbe dividere separando il montaggio dal
  primo `tick`.
