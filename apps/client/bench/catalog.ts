// Le tre scene che non sono schermate ma **cataloghi** (§31.1).
//
// Una schermata mostra un caso; un catalogo esaurisce un elenco. Servono a due
// cose diverse, e la seconda è quella che manca oggi: quando la §31.2 rifarà i
// colori e la §31.5 le elevazioni, la domanda «cosa ho cambiato» non si risponde
// guardando l'app — si risponde mettendo il prima e il dopo di *tutto* uno
// accanto all'altro. Sono anche, dette dall'altra parte, la pagina di prova che
// si consegnerà a chi scriverà un tema (§31.9).
//
//  - **componenti**: ogni `UiNode` che la shell sa disegnare, in ogni stato in
//    cui un tema lo deve distinguere. L'elenco sta in `samples.ts` e un
//    presidio lo confronta coi `case` di `src/ui/node.ts`.
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
import "../src/theme/structure.css";
import darkSheet from "../src/theme/serie/sheet-dark.css?raw";
import lightSheet from "../src/theme/serie/sheet-light.css?raw";
import skin from "../src/theme/serie/skin.css?raw";
import fonts from "../src/theme/serie/fonts.css?raw";
import { mount as mount } from "../src/theme/loader";
import { contrast } from "../src/theme/contrast";
import { mountTree } from "../src/ui/node";
import { COMPONENTS } from "../src/theme/serie/anatomia";
import { SAMPLES } from "./samples";

const params = new URLSearchParams(window.location.search);
const LIGHT = params.get("light") === "light" ? "light" : "dark";
const WHICH = params.get("catalog") ?? "components";

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
 * componente/stato, e dentro ogni hook del componente ha **il suo** elemento.
 *
 * Non un solo nodo con tutte le classi addosso: nel DOM vero gli hook stanno
 * su nodi in rapporto — un `.tab` contiene un `.tab-name`, `.views-modal` è
 * un fisso a sé — e la pila piatta li fa combattere su uno stesso elemento
 * con esiti (scrim sotto testo, accent sotto danger) che nessun selettore
 * della pelle produce davvero. Il banco fotograferebbe quei composti come se
 * fossero verità, e il presidio del contrasto li condannerebbe a nome della
 * pelle. Un hook, un elemento: ogni foto è quella di un selettore reale. */
/** Hook che **sono** una superficie di copertura a sé (scrim a pagina
 * intera), non un contenuto: si fotografano senza prosa addosso. */
const SUPERFICI: Set<string> = new Set(["modale", "views-modal"]);

function anatomy(): void {
  const grid = section("Shell anatomy");
  for (const component of COMPONENTS) {
    for (const state of component.states) {
      const cell = el("div", "cella");
      cell.append(el("span", "didascalia", `${component.name} · ${state.label}`));
      for (const hook of component.hooks) {
        const proof = el("div", hook);
        proof.dataset.component = component.name;
        proof.dataset.state = state.name;
        // Le superfici di copertura (`.modale`, `.views-modal`) sono un velo
        // a pagina intera: il loro testo vero sta dentro il pannello che
        // ospitano — che qui arriva per conto suo, come hook a sé. Mettere
        // della prosa **sul velo** fotograferebbe uno stato che la pelle non
        // produce: il velo si fotografa nudo.
        if (!SUPERFICI.has(hook)) proof.textContent = `${component.name} · ${hook}`;
        cell.append(proof);
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
}

// ---------------------------------------------------------------------------
// Tavolozza.
// ---------------------------------------------------------------------------
/// I nomi dei token, **letti dal foglio montato** e nel suo ordine.
///
/// Non da un elenco scritto qui: un elenco a mano è la seconda metà di una
/// coppia che nessuno tiene insieme, e il giorno che diverge il catalogo non
/// diventa rosso — smette solo di mostrare un token, che è il difetto che
/// questa seduta è nata per non avere più.
function tokenNames(): string[] {
  const stylesheet = LIGHT === "light" ? lightSheet : darkSheet;
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!);
}

/// Le quattro superfici su cui un inchiostro può stare. Sono i quattro fondi che
/// la pelle usa davvero, e sono anche quelle che `contrast.test.ts` enumera:
/// il catalogo mostra lo stesso conto, misurato sull'altro lato — lì dal foglio
/// come testo, qui da `getComputedStyle` sulla pagina.
const SURFACES = ["--bg", "--bg-chrome", "--bg-elev", "--bg-input"] as const;

/// Un token è un colore se il suo valore, reso, è un colore pieno che il conto
/// sa leggere. I veli e le ombre (`rgb(… / …)`, `0 1px 2px …`) non lo sono, e
/// il loro contrasto non è una funzione dei soli token: si mostrano col loro
/// valore e senza conti, che è la cosa vera da dire.
function isColor(value: string): boolean {
  return /^#|^rgba?\(/i.test(value.trim()) && !/\/\s*0?\.\d/.test(value);
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

const PROSE =
  "Non si migliora ciò che non si guarda: un gradino che non si vede, un allineamento che salta, un'ombra che non stacca.";

function samples(): void {
  header("Samples");

  const scale = [
    "--text-xs",
    "--text-sm",
    "--text-base",
    "--text-md",
    "--text-lg",
    "--text-xl",
    "--text-2xl",
    "--text-3xl",
  ];
  const weights: [string, string][] = [
    ["normale", "400"],
    ["medium", "var(--weight-medium)"],
    ["bold", "var(--weight-bold)"],
  ];

  for (const [family, token] of [
    ["Carattere dell'interfaccia", "--font-ui"],
    ["Carattere di lettura", "--font-reading"],
    ["Carattere monospaziato", "--font-mono"],
  ] as const) {
    const s = el("section", "sezione");
    s.append(el("h2", undefined, family));
    for (const size of scale) {
      for (const [weightName, weight] of weights) {
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
  for (const [name, style] of [
    ["normale", ""],
    ["leading-tight", "line-height: var(--leading-tight)"],
    ["leading-normal", "line-height: var(--leading-normal)"],
    ["leading-relaxed", "line-height: var(--leading-relaxed)"],
    ["tracking-caps", "letter-spacing: var(--tracking-caps); text-transform: uppercase"],
  ] as const) {
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
