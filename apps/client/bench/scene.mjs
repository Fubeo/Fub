// **Le scene del banco: un elenco chiuso** (§31.1).
//
// # Perché un elenco, e perché chiuso
//
// L'alternativa è uno screenshot che qualcuno si ricorda di fare, e non è
// un'alternativa: non lascia un «prima», quindi non prova nessun miglioramento e
// non vede nessuna regressione. Qui ogni scena dichiara come si prepara —
// quale pagina, quali gesti, quale fuoco — e un presidio (`scene.test.ts`)
// verifica che ognuna abbia la sua baseline in **entrambe** le luci e che non ci
// siano baseline orfane. Le due direzioni servono tutte e due: senza la prima
// una scena nuova non fotografata sembra a posto, senza la seconda una scena
// cancellata lascia in repo la foto di qualcosa che non esiste più.
//
// Che l'elenco si possa svuotare in silenzio è la lezione della
// [0109](../../docs/decisions/0192-impostazioni-locale-e-temi.md):
// un elenco che si svuota è indistinguibile da un elenco verde. Qui il presidio
// pretende anche un minimo, così una `SCENE = []` è rossa e non serena.
//
// # Perché `.mjs` e non `.ts`
//
// Perché lo leggono anche programmi di Node: il fotografo (`photos.mjs`) gira
// fuori dal browser e fuori da Vite. È la stessa riga di confine del
// `tsconfig.json` di questa cartella — **`.ts` è del browser, `.mjs` è di
// Node** — e tenerla vuol dire che il fotografo non ha bisogno di un
// transpilatore per sapere cosa fotografare.
//
// # Cosa può fare un `prepare`
//
// Riceve la pagina di Playwright e la porta prima dello scatto. Può cliccare,
// scrivere, premere, e può parlare col banco da `window.bench` — che è come si
// producono le cose che nessun bottone produce: un guasto del kernel, una porta
// che rifiuta. Non deve **aspettare un tempo**: il fotografo aspetta già i
// caratteri e il montaggio, e ogni altra attesa va scritto come condizione.

import { S_CATALOGO, S_DOCUMENTO, S_KIT, S_TELEFONO } from "./scene/altre-pagine.mjs";
import { openWorkbook } from "./scene/gesti-documenti.mjs";
import { S_BASE_GRIGLIA } from "./scene/shell-base-griglia.mjs";
import { S_CORNICE } from "./scene/shell-cornice.mjs";
import { S_DISEGNO } from "./scene/shell-disegno.mjs";
import { S_LANCIATORE } from "./scene/shell-lanciatore-avvio.mjs";
import { S_SCRITTURA } from "./scene/shell-scrittura.mjs";
import { S_TESTATA } from "./scene/shell-testata-diagrammi.mjs";
export { chooseMode } from "./scene/gesti-scrittura.mjs";
export { scrimClickPoint } from "./scene/gesti-documenti.mjs";

/// Le due luci. Ogni scena si fotografa in tutte e due — è metà della promessa
/// di questo banco, perché il difetto che si cerca nasce quasi sempre in una
/// sola delle due.
export const LIGHTS = ["dark", "light"];

/// Le scene, dai pezzi di `bench/scene/` e nell'ordine di sempre: la shell
/// (`index.html`), il telefono (`mobile.html`), la finestra documento
/// (`document.html`) e i cataloghi (`bench/kit.html`, `bench/catalog.html`).
/// Una scena può dichiarare una `viewport` (le misure stanno in
/// `scene/misure.mjs`).
export const SCENE = touchLast(onPage("shell", [...S_CORNICE, ...S_BASE_GRIGLIA, ...S_DISEGNO, ...S_SCRITTURA, ...S_TESTATA, ...S_LANCIATORE]).concat(
  // **Il kit** (`bench/kit.html`): le primitive di `src/kit/` vestite dalla
  // stessa serie. Stanno in questo elenco perché sono la stessa pelle e le
  // stesse baseline, e su una pagina loro perché un catalogo non ha uno stato
  // da preparare: ha un elenco da esaurire. Ciò che si apre — il menu, il
  // riquadro, il dialogo, la scheda — non sta in una foto sola: una superficie
  // chiude l'altra.
  onPage("kit", S_KIT),
  // **Il telefono** (`mobile.html`): la stessa
  // cornice, in colonna. Il binario è la barra inferiore, i cassetti salgono
  // dal basso, la barra di formattazione sta sopra la tastiera. La finestra è
  // quella di un telefono in piedi; l'ultima scena lo sdraia.
  onPage("mobile", S_TELEFONO),
  // **La finestra documento** (`document.html`): un foglio solo, in
  // una finestra sua, che parla con la principale da un canale. Senza una
  // principale che le risponda non ha niente da mostrare, quindi la scena ne
  // apre una accanto, nello stesso contesto.
  onPage("document", S_DOCUMENTO),
  // **I tre cataloghi** (`bench/catalog.html`): tutto ciò che un tema deve
  // distinguere, su una pagina senza la shell.
  onPage("catalog", S_CATALOGO),
));

/// Le scene col tocco acceso (`touch: true`) vanno in fondo, nel loro
/// ordine: il fotografo e il controllo d'accessibilità usano una pagina sola
/// per luce, e dopo il tocco emulato Chromium non rimette più
/// `(hover: hover)` (`touchOn`). Chi viene prima vede il puntatore.
function touchLast(scenes) {
  return [...scenes.filter((scene) => !scene.touch), ...scenes.filter((scene) => scene.touch)];
}
/// Le scene che soltanto il banco dei gesti apre (`bench/grid-gestures.mjs`):
/// non hanno una foto di riferimento né un passaggio del banco
/// dell'accessibilità, e le baseline restano tutte quelle di `SCENE`.
///
/// **La cartella grande** (griglia T1): 3000 righe per 20 colonne con la riga
/// 1 e la colonna A bloccate, fatta in codice dal finto (`?workbook=large`).
/// I controlli G1 ci scorrono sopra.
export const GESTURE_SCENE = onPage("shell", [
  {
    id: "grid-large",
    title: "Grid v2: una cartella grande, con la riga e la colonna bloccate",
    query: "workbook=large",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Le misure tirate** (griglia T5): la stessa cartella, col finto che dice
  // sì a `home.columnWidth` e `home.rowHeight` come l'host vero
  // (`?misure=si`). I controlli G5 ci tirano i bordi.
  {
    id: "grid-large-misure",
    title: "Grid v2: la cartella grande, che accetta le misure tirate",
    query: "workbook=large&misure=si",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Riempire, copiare, incollare** (griglia T6): la stessa cartella, col
  // finto che dice sì ai riempimenti e a `fub.pasteFrom` (`?risposte=si`);
  // C4 vale 10 e C5 20, come nel prototipo. I controlli G6 ci riempiono e ci
  // copiano, e la coreografia del riempimento ci aspetta la risposta.
  {
    id: "grid-large-appunti",
    title: "Grid v2: la cartella grande, che accetta riempimenti e incolla",
    query: "workbook=large&risposte=si",
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  },
  // **Le velocità della selezione** (griglia T9): la stessa cartella con
  // `editor.grid.selection-speed` scelta dal finto (`?velocita=…`). Il mouse
  // fitto di G3 ci gira con ogni scelta.
  ...[["quick", "svelta"], ["soft", "morbida"], ["none", "a scatti"]].map(([speed, name]) => ({
    id: `grid-large-${speed}`,
    title: `Grid v2: la cartella grande, con la selezione ${name}`,
    query: `workbook=large&velocita=${speed}`,
    prepare: (page) => openWorkbook(page, "Dati/Grande.xlsx"),
  })),
]);

function onPage(page, scenes) {
  return scenes.map((scene) => ({ query: "", ...scene, page }));
}

/// Il nome del file di una foto: scena e luce, che sono le due coordinate.
export function photoFilename(scene, light) {
  return `${scene.id}-${light}.png`;
}

/// Le pagine del banco, per il nome che una scena dichiara.
const PAGES = {
  catalog: "/bench/catalog.html",
  shell: "/index.html",
  kit: "/bench/kit.html",
  mobile: "/mobile.html",
  document: "/document.html",
};

/// L'indirizzo di una scena in una luce.
export function sceneUrl(base, scene, light) {
  const page = PAGES[scene.page ?? ""] ?? "/";
  const query = [`light=${light}`, scene.query].filter(Boolean).join("&");
  return `${base}${page}?${query}`;
}
