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
dura almeno 16,7 ms. Sulla nota lunga resta, prima e dopo, un blocco da 130 a
190 ms poco dopo il salvataggio, e la prima marcatura del correttore
(`proof.ts`) nel tratto appena visibile costa un fotogramma da circa 60 ms.
