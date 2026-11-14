// Il catalogo del kit: ogni primitiva di `src/kit/` col suo campione, negli
// stati in cui una pelle la deve distinguere.
//
// Non è la shell — qui non gira nessun `bootstrap` — ma ciò che conta è lo
// stesso: i tre strati montati dallo stesso caricatore, e le primitive vere.
// Un campione è un'istanza, non markup che le somiglia: il menu si apre, il
// divisore si trascina, le schede rispondono alle frecce. Per questo la pagina
// è anche il palco su cui il banco del movimento prova le coreografie del kit
// (`motion.mjs`), e i campioni che si muovono hanno un `id` che comincia per
// `sample-`.
//
// I campioni stanno in `src/dev/catalogo/kit.ts`, che la pagina «Tutti i
// componenti» dell'app condivide; qui restano gli strati, la testata e le due
// colonne. Gli stati che non stanno fermi li tiene fermi
// `src/dev/catalogo/forza.ts`, e la scena `kit-focus` li riprova col fuoco vero.
import "../src/theme/scrittoio/structure.css";
import { holdForcedStates } from "../src/dev/catalogo/forza";
import { renderKit } from "../src/dev/catalogo/kit";
import { mount } from "../src/theme/loader";
import { SCRITTOIO_SERIES } from "../src/theme/scrittoio/series";
import { openLifetime } from "../src/ui/lifetime";

const params = new URLSearchParams(window.location.search);
const LIGHT = params.get("light") === "light" ? "light" : "dark";
const CONTRAST = params.get("contrast") === "high" ? "high" : "normal";

const lifetime = openLifetime();
lifetime.listen(window, "pagehide", () => lifetime.close(), { once: true });

// Gli strati, per sostituzione, come nell'app: la struttura arriva
// dall'`import` qui sopra, i caratteri, la pelle e il foglio dal caricatore.
mount(SCRITTOIO_SERIES.fonts, "caratteri");
mount(SCRITTOIO_SERIES.skin, "pelle");
mount(SCRITTOIO_SERIES.sheet(LIGHT, CONTRAST), "foglio");
document.documentElement.dataset.theme = LIGHT;

// Prima dei campioni: nati già nel loro stato, non hanno una transizione da
// finire quando arriva il fotografo.
holdForcedStates(lifetime);

// ── La cornice ───────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const root = document.getElementById("kit")!;
const header = el("header", "testata");
header.append(el("h1", undefined, "Kit"), el("span", "luce", CONTRAST === "high" ? `${LIGHT} · alto contrasto` : LIGHT));
const table = el("div", "tavola");
const COLUMNS = { left: el("div", "colonna"), right: el("div", "colonna") };
table.append(COLUMNS.left, COLUMNS.right);
root.append(header, table);

let sections = 0;
renderKit({
  lifetime,
  section(title, column, ...content) {
    const node = el("section", "sezione");
    const heading = el("h2", undefined, title);
    sections += 1;
    heading.id = `sezione-${sections}`;
    node.setAttribute("aria-labelledby", heading.id);
    node.append(heading, ...content);
    COLUMNS[column].append(node);
  },
});

// Il contenitore scorre e i suoi campioni prendono il fuoco: non gli serve un
// posto suo nell'ordine di Tab.
document.documentElement.dataset.bench = "ready";
