// Le tre scene che non sono schermate ma **cataloghi** (§31.1).
//
// Una schermata mostra un caso; un catalogo esaurisce un elenco. Servono a due
// cose diverse, e la seconda è quella che manca oggi: quando la §31.2 rifarà i
// colori e la §31.5 le elevazioni, la domanda «cosa ho cambiato» non si risponde
// guardando l'app — si risponde mettendo il prima e il dopo di *tutto* uno
// accanto all'altro. Detti dall'altra parte, sono anche la pagina di prova di
// chi scrive un tema: l'app la porta con sé come «Tutti i componenti»
// (`src/dev/catalogo/`), e il cuore dei due è lo stesso.
//
//  - **componenti**: ogni `UiNode` che la shell sa disegnare, in ogni stato in
//    cui un tema lo deve distinguere. L'elenco sta in
//    `src/dev/catalogo/samples.ts` e un presidio lo confronta coi `case` di
//    `src/ui/node.ts`.
//  - **tavolozza**: ogni token del foglio col suo nome, il suo valore e — per i
//    colori — il contrasto **reso** sopra le quattro superfici. I nomi non sono
//    scritti qui: si leggono dal foglio montato, quindi un token nuovo compare
//    da solo e uno tolto sparisce da solo.
//  - **campionario**: la scala tipografica per intero, coi tre caratteri (§31.3),
//    i tre pesi, l'interlinea e la misura di lettura, su prosa vera.
//
// Il tutto **senza la shell**: qui non gira `main.ts`. Ciò che è identico è ciò
// che deve esserlo — i tre strati montati dallo stesso caricatore, e il renderer
// vero per i componenti.
import "../src/theme/scrittoio/structure.css";
import darkSheet from "../src/theme/scrittoio/sheet-dark.css?raw";
import lightSheet from "../src/theme/scrittoio/sheet-light.css?raw";
import skin from "../src/theme/scrittoio/skin.css?raw";
import fonts from "../src/theme/scrittoio/fonts.css?raw";
import { mount as mount } from "../src/theme/loader";
import { contrast } from "../src/theme/contrast";
import { mountTree, mountWebviewFocusMonitor } from "../src/ui/node";
import { openLifetime } from "../src/ui/lifetime";
import { COMPONENTS } from "../src/theme/scrittoio/anatomia";
import { anatomyProof, keepScrollersReachable } from "../src/dev/catalogo/anatomia";
import { FAMILIES, LEADINGS, PROSE, SCALE, WEIGHTS } from "../src/dev/catalogo/caratteri";
import { SAMPLES } from "../src/dev/catalogo/samples";
import { SURFACES, isColor, tokenNames as namesIn } from "../src/dev/catalogo/tavolozza";

const params = new URLSearchParams(window.location.search);
const LIGHT = params.get("light") === "light" ? "light" : "dark";
const WHICH = params.get("catalog") ?? "components";

const lifetime = openLifetime();
mountWebviewFocusMonitor(lifetime);
lifetime.listen(window, "pagehide", () => lifetime.close(), { once: true });

// I quattro strati, nell'ordine del §29 e del §31.3: la struttura arriva
// dall'`import` qui sopra, i caratteri, il foglio e la pelle dal caricatore —
// per **sostituzione**, come nell'app. Senza `mount(fonts, …)` il
// campionario mostrerebbe il ripiego di sistema e non ciò che vuole provare.
mount(fonts, "caratteri");
mount(skin, "pelle");
mount(LIGHT === "light" ? lightSheet : darkSheet, "foglio");
document.documentElement.dataset.theme = LIGHT;

const root = document.getElementById("catalogo")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function header(title: string): void {
  const t = el("div", "catalogo-testata");
  t.append(el("h1", undefined, title), el("span", "luce", LIGHT === "light" ? "chiaro" : "scuro"));
  root.append(t);
}

function section(title: string): HTMLElement {
  const s = el("section", "sezione");
  s.append(el("h2", undefined, title));
  const g = el("div", "griglia");
  s.append(g);
  root.append(s);
  return g;
}

// ---------------------------------------------------------------------------
// Componenti.
// ---------------------------------------------------------------------------

/** La scena legge la tabella chiusa: una cella per ogni coppia
 * componente/stato, e dentro ogni hook del componente ha **il suo** elemento
 * (`anatomyProof`): ogni foto è quella di un selettore reale. */
function anatomy(): void {
  const grid = section("Shell anatomy");
  for (const component of COMPONENTS) {
    for (const state of component.states) {
      const cell = el("div", "cella");
      cell.append(el("span", "didascalia", `${component.name} · ${state.label}`));
      for (const hook of component.hooks) {
        const frame = el("div", "provino provino-anatomia");
        frame.dataset.label = `${component.name} · ${state.label} · ${hook}`;
        frame.append(anatomyProof(component, state, hook));
        cell.append(frame);
      }
      grid.append(cell);
    }
  }
}

function components(): void {
  header("Components");
  anatomy();
  for (const sample of SAMPLES) {
    const grid = section(sample.title);
    for (const state of sample.states) {
      const cell = el("div", "cella");
      cell.append(el("span", "didascalia", state.label));
      const proof = el("div", "provino");
      // Il renderer **vero**, con una porta che non fa niente: un click dentro
      // un catalogo non ha un provider a cui arrivare, e non deve avere un
      // errore da mostrare.
      mountTree(proof, state.node, async () => {});
      cell.append(proof);
      grid.append(cell);
    }
  }
  // Il ritaglio conserva la geometria dei campioni posizionati. Quando
  // serve scorrere, anche la tastiera deve poter raggiungere il provino.
  lifetime.add(
    keepScrollersReachable(
      root.querySelectorAll<HTMLElement>(".provino-anatomia, .provino-anatomia > :not([tabindex])"),
      (frame) => frame.closest<HTMLElement>(".provino-anatomia")!.dataset.label!,
    ),
  );
}

// ---------------------------------------------------------------------------
// Tavolozza.
// ---------------------------------------------------------------------------

/// I nomi dei token del foglio montato, nel suo ordine.
function tokenNames(): string[] {
  return namesIn(LIGHT === "light" ? lightSheet : darkSheet);
}

function palette(): void {
  header("Palette");
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim();
  const backgrounds = Object.fromEntries(SURFACES.map((s) => [s, value(s)])) as Record<string, string>;

  const s = el("section", "sezione");
  s.append(el("h2", undefined, `${tokenNames().length} token del sheet`));
  root.append(s);

  for (const name of tokenNames()) {
    const tokenValue = value(name);
    const row = el("div", "token");

    const swatch = el("span", "campione-colore");
    if (isColor(tokenValue)) swatch.style.background = tokenValue;
    else swatch.style.background = "transparent";
    row.append(swatch);

    const text = el("div");
    text.append(el("span", "token-nome", name), el("span", "token-valore", tokenValue));
    row.append(text);

    const ratios = el("div", "conti");
    if (isColor(tokenValue)) {
      for (const background of SURFACES) {
        if (name === background) continue;
        let ratio: number;
        try {
          ratio = contrast(tokenValue, backgrounds[background]!);
        } catch {
          continue;
        }
        const result = el("span", "conto");
        result.dataset.result = ratio >= 4.5 ? "aa" : ratio >= 3 ? "ui" : "sotto";
        result.append(
          document.createTextNode(`${background.slice(2)} `),
          el("b", undefined, ratio.toFixed(1)),
        );
        ratios.append(result);
      }
    }
    row.append(ratios);
    s.append(row);
  }
}

// ---------------------------------------------------------------------------
// Campionario.
// ---------------------------------------------------------------------------

function samples(): void {
  header("Samples");

  for (const [family, token] of FAMILIES) {
    const s = el("section", "sezione");
    s.append(el("h2", undefined, family));
    for (const size of SCALE) {
      for (const [weightName, weight] of WEIGHTS) {
        const row = el("div", "riga-scala");
        row.append(el("span", "didascalia", `${size.slice(2)} · ${weightName}`));
        const text = el("p", "misura", PROSE);
        text.style.margin = "0";
        text.style.fontFamily = `var(${token})`;
        text.style.fontSize = `var(${size})`;
        text.style.fontWeight = weight;
        row.append(text);
        s.append(row);
      }
    }
    root.append(s);
  }

  // L'interlinea e la spaziatura, che sono gli altri due token della voce del
  // tema e non si vedono su una riga sola.
  const s = el("section", "sezione");
  s.append(el("h2", undefined, "Interlinea e spaziatura"));
  for (const [name, style] of LEADINGS) {
    const row = el("div", "riga-scala");
    row.append(el("span", "didascalia", name));
    const paragraph = el("p", "misura", `${PROSE} ${PROSE}`);
    paragraph.style.margin = "0";
    paragraph.setAttribute("style", `${paragraph.getAttribute("style") ?? ""};${style}`);
    row.append(paragraph);
    s.append(row);
  }
  root.append(s);

  // `--font-reading`, `--text-reading`, `--leading-relaxed` e
  // `--content-width` insieme: nessuna riga della scala sopra li mostra
  // combinati, ed è precisamente così che li userà una superficie di lettura
  // (§31.8). `--content-width` non si vede su `.misura` (che ha già un
  // `max-width` suo, per non far scappare le altre righe): qui lo sostituisce.
  const reading = el("section", "sezione");
  reading.append(el("h2", undefined, "Lettura"));
  const readingRow = el("div", "riga-scala");
  readingRow.append(el("span", "didascalia", "content-width · leading-relaxed"));
  const readingParagraph = el("p", "misura", `${PROSE} ${PROSE} ${PROSE}`);
  readingParagraph.setAttribute(
    "style",
    "margin: 0; max-width: var(--content-width); font-family: var(--font-reading); " +
      "font-size: var(--text-reading); line-height: var(--leading-relaxed);",
  );
  readingRow.append(readingParagraph);
  reading.append(readingRow);
  root.append(reading);
}

// ---------------------------------------------------------------------------

const CATALOGS: Record<string, () => void> = { components, palette, samples };

const draw = CATALOGS[WHICH];
if (!draw) {
  // Un catalogo che non esiste è un errore del fotografo, non uno stato da
  // fotografare: si vede subito e dice quali ce ne sono.
  root.textContent = `Non esiste il catalogo «${WHICH}». Ce ne sono tre: ${Object.keys(CATALOGS).join(", ")}.`;
} else {
  draw();
}

// Il segnale che il fotografo aspetta. Un `networkidle` non basta a un catalogo
// che non chiede niente alla rete, e un tempo fisso è la cosa che rende un banco
// visivo intermittente: qui la pagina dice da sé quando ha finito di disegnare.
document.documentElement.dataset.bench = "ready";
