import type katex from "katex";
import type { KatexOptions } from "katex";
import { onLanguage, t } from "../../../../i18n/strings";
import { openLifetime, type Teardown } from "../../../../ui/lifetime";
import { attachTooltip, setTooltip } from "../../../../ui/tooltip";

const MAX_SOURCE_LENGTH = 20_000;
/// Quanto la prima formula aspetta le macro del vault prima di disegnarsi
/// senza: arrivate dopo, le formule si ridisegnano.
const MACROS_WAIT = 400;
let library: Promise<{ default: typeof katex }> | undefined;
let styles: Promise<unknown> | undefined;
let macros: Promise<void> | undefined;

/// Le macro di KaTeX, per nome (`\\R`): le definizioni come KaTeX le legge.
export type MathMacros = Readonly<NonNullable<KatexOptions["macros"]>>;

/// La premessa di ogni formula: le macro del vault (`math/macros.ts`, T65).
let preamble: MathMacros | null = null;
const preambleListeners = new Set<() => void>();

/// Le macro del vault cambiano: le formule già disegnate si rifanno.
export function setPreamble(next: MathMacros): void {
  const empty = Object.keys(next).length === 0;
  if (empty && preamble === null) return;
  preamble = empty ? null : next;
  for (const listener of [...preambleListeners]) listener();
}

/// Ascolta i cambi della premessa; restituisce lo smontaggio.
export function onPreamble(listener: () => void): Teardown {
  preambleListeners.add(listener);
  return () => preambleListeners.delete(listener);
}

const DEFINES = /\\(?:(?:re|provide)?newcommand\*?\s*\{?\s*|[gex]?def\s*|let\s*)(\\[A-Za-z]+|\\.)/g;

/// Le macro per una formula: una copia della premessa, perché un `\\gdef`
/// della formula non la cambi per le altre, senza i nomi che la formula
/// stessa dichiara (KaTeX rifiuta un `\\newcommand` di un nome che c'è già).
function macrosFor(tex: string | undefined): NonNullable<KatexOptions["macros"]> | null {
  if (preamble === null) return null;
  const copy: NonNullable<KatexOptions["macros"]> = { ...preamble };
  if (tex !== undefined && /\\(?:newcommand|renewcommand|providecommand|[gex]?def|let)/.test(tex)) {
    for (const match of tex.matchAll(DEFINES)) delete copy[match[1]!];
  }
  return copy;
}

/// Le regole di KaTeX della resa di lettura: severo, senza fiducia (niente
/// `\\htmlData` né collegamenti), con i limiti di espansione e di misura, e
/// le macro del vault come premessa. Il riquadro di modifica
/// (`math/caret.ts`) parte da qui e fida soltanto i suoi segni. `tex`, se
/// c'è, è la formula: i nomi che dichiara da sé restano suoi.
export function readOptions(display: boolean, tex?: string): KatexOptions {
  const macros = macrosFor(tex);
  return {
    displayMode: display,
    output: "htmlAndMathml",
    throwOnError: true,
    strict: "error",
    trust: false,
    maxExpand: 1_000,
    maxSize: 20,
    ...(macros ? { macros } : {}),
  };
}

/// KaTeX e il suo foglio di stile, caricati una volta, alla prima formula.
/// Con KaTeX arrivano le macro del vault: la prima formula le aspetta un
/// poco, poi si disegna lo stesso.
export function loadKatex(): Promise<typeof katex> {
  return Promise.all([
    library ??= import("katex").catch((error) => {
      library = undefined;
      throw error;
    }),
    styles ??= import("katex/dist/katex.min.css").catch((error) => {
      styles = undefined;
      throw error;
    }),
  ]).then(([module]) => {
    const loaded = module.default;
    macros ??= import("./math/macros").then((vault) => vault.watchVaultMacros(loaded)).catch(() => undefined);
    let wait: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([macros, new Promise<void>((resolve) => { wait = setTimeout(resolve, MACROS_WAIT); })])
      .then(() => {
        clearTimeout(wait);
        return loaded;
      });
  });
}

function reasonText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1200);
}

/** Hydrates inert TeX placeholders with KaTeX. The library and its stylesheet
 * are fetched only when a rendered document actually contains a formula. */
export function mountMathBlocks(container: HTMLElement): Teardown {
  const life = openLifetime();
  for (const element of container.querySelectorAll<HTMLElement>(".math-inline[data-tex], .math-block[data-tex]")) {
    if (element.closest("[data-ui-slot]")) continue;
    const source = element.dataset.tex ?? element.textContent ?? "";
    let phase: "loading" | "ready" | "error" = "loading";
    life.add(attachTooltip(element, ""));
    let reason = "";
    // Un nome su uno `span` o un `div` senza ruolo non vale (ARIA): il ruolo
    // `math` lo ammette, e lascia leggibile il MathML che KaTeX mette dentro.
    element.setAttribute("role", "math");
    const labels = () => {
      element.dataset.state = phase;
      element.setAttribute("aria-busy", String(phase === "loading"));
      element.setAttribute("aria-label", phase === "error"
        ? t("math.error", { reason })
        : phase === "loading" ? t("math.loading") : t("math.formula"));
      setTooltip(element, phase === "error" ? t("math.error", { reason }) : "");
    };
    const fail = (error: unknown) => {
      if (life.closed) return;
      phase = "error";
      reason = reasonText(error);
      element.textContent = source;
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    };
    life.add(onLanguage(labels));
    labels();
    if (source.length > MAX_SOURCE_LENGTH) {
      fail(new Error(t("math.too_large", { limit: MAX_SOURCE_LENGTH })));
      continue;
    }
    const render = () => void loadKatex().then((library) => {
      if (life.closed) return;
      const display = element.classList.contains("math-block");
      const staging = document.createElement(display ? "div" : "span");
      library.render(source, staging, readOptions(display, source));
      if (life.closed) return;
      element.replaceChildren(...staging.childNodes);
      phase = "ready";
      labels();
      container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }).catch(fail);
    render();
    // Le macro del vault sono cambiate: la formula si rifà con le nuove.
    life.add(onPreamble(render));
  }
  return () => life.close();
}
