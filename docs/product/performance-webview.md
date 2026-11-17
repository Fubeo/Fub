# Il disegno nella WebView

> **Ambito:** quanto costa a WebKit, nell'app vera, disegnare una battuta
> nelle note Markdown: le regole che tengono il lavoro dentro il foglio e le
> misure prima e dopo. Il lavoro di CodeMirror fino al layout sta in
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

WebKitGTK disegna a 60 Hz anche su schermi più veloci, quindi un fotogramma
dura almeno 16,7 ms. La prima marcatura del correttore (`proof.ts`) nel tratto
appena visibile costa ancora un fotogramma da circa 60 ms.

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
collegamenti resta grande da disegnare la prima volta (una riga per rimando, in
`crates/fub-features/src/backlinks.rs`): costa all'apertura, non a ogni
salvataggio.

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
