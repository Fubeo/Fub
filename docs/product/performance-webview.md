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
fotogramma dura almeno 16,7 ms. Restano, senza la nota lunga: la prima
apertura del grafo nel binario (un blocco da circa 120 ms, una volta per
sessione), l'apertura del lanciatore (circa 38 ms sincroni), quella di un
menu (11–28 ms), e un fotogramma da 30–40 ms a ogni cambio di zoom o di
accento, che ricalcolano lo stile di tutta la pagina.
